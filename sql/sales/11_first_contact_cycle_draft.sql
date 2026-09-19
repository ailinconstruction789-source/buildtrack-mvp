-- SALES V2 BOUNDED FIRST-CONTACT CYCLE -- DESIGN ONLY, 2026-09-17.
-- NEVER RUN ON SUPABASE. Depends on UNAPPLIED base and companions 04--10.
-- Not an installation migration, scheduler, background worker or production approval.
-- One explicit Admin call, at most ten existing09 commands, ONE atomic transaction.
-- Static checks cannot establish PostgreSQL/RLS/concurrency behavior. Local synthetic
-- runtime checks are separate and do not establish live deployment compatibility.
BEGIN;
DO $draft_only$
BEGIN
  RAISE EXCEPTION 'DESIGN ONLY: first-contact cycles are not authorized for database execution';
END;
$draft_only$;

ALTER TABLE public.crm_settings ADD COLUMN sla_cycle_enabled boolean NOT NULL DEFAULT false;
-- Supports keyset selection. LIMIT bounds returned rows, not a hard work/time cap.
CREATE INDEX crm_first_contact_cycle_scan_idx ON public.crm_sla_tasks(created_at,id)
  WHERE task_type='first_contact' AND project_interest_id IS NULL AND source_activity_id IS NULL AND status='open';

CREATE TABLE sales_private.crm_first_contact_cycle_cursor (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  after_created_at timestamptz,
  after_task_id uuid,
  CHECK ((after_created_at IS NULL)=(after_task_id IS NULL))
);
INSERT INTO sales_private.crm_first_contact_cycle_cursor(id) VALUES(true);
ALTER TABLE sales_private.crm_first_contact_cycle_cursor ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sales_private.crm_first_contact_cycle_cursor FROM PUBLIC, anon, authenticated;

CREATE TABLE sales_private.crm_first_contact_cycle_requests (
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL,
  response jsonb NOT NULL CHECK (jsonb_typeof(response)='object'),
  created_at timestamptz NOT NULL CHECK (isfinite(created_at)),
  PRIMARY KEY (actor_user_id,request_id)
);
ALTER TABLE sales_private.crm_first_contact_cycle_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sales_private.crm_first_contact_cycle_requests FROM PUBLIC, anon, authenticated;
CREATE TRIGGER crm_first_contact_cycle_receipt_immutable
  BEFORE UPDATE OR DELETE ON sales_private.crm_first_contact_cycle_requests
  FOR EACH ROW EXECUTE FUNCTION sales_private.crm_first_contact_history_immutable();

-- Whitelist BOTH levels. Future private response fields must not escape through
-- cached command replay or read-only recovery. Preserve stored JSON values/types.
CREATE FUNCTION sales_private.crm_first_contact_cycle_projection(p_response jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = pg_catalog
AS $projection$
  SELECT jsonb_build_object(
    'actor',jsonb_build_object('userId',p_response#>'{actor,userId}','role',p_response#>'{actor,role}'),
    'requestId',p_response->'requestId','startedAt',p_response->'startedAt','finishedAt',p_response->'finishedAt',
    'replayed',p_response->'replayed','maxItems',p_response->'maxItems','processedCount',p_response->'processedCount',
    'sweepFinished',p_response->'sweepFinished','receipts',COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'actor',jsonb_build_object('userId',child#>'{actor,userId}','role',child#>'{actor,role}'),
        'requestId',child->'requestId','taskId',child->'taskId',
        'processedAt',child->'processedAt','replayed',child->'replayed',
        'outcome',child->'outcome','reason',child->'reason',
        'serviceDueAt',child->'serviceDueAt','staffDueAt',child->'staffDueAt',
        'notificationId',child->'notificationId','notificationType',child->'notificationType',
        'completedByActivityId',child->'completedByActivityId','completedAt',child->'completedAt',
        'withdrawnCount',child->'withdrawnCount') ORDER BY ordinal)
      FROM jsonb_array_elements(p_response->'receipts') WITH ORDINALITY AS children(child,ordinal)
    ),'[]'::jsonb));
$projection$;
REVOKE ALL ON FUNCTION sales_private.crm_first_contact_cycle_projection(jsonb) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.crm_v2_sla_cycle_capabilities()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $capabilities$
  WITH readiness AS (
    SELECT public.crm_v2_role()='admin' AND COALESCE((SELECT central_intake_enabled AND lead_work_enabled
      AND lead_lifecycle_enabled AND work_schedule_enabled AND notifications_enabled AND sla_preview_enabled
      FROM public.crm_settings WHERE id),false) AS enabled,
      COALESCE((SELECT sla_processing_enabled AND sla_cycle_enabled FROM public.crm_settings WHERE id),false) AS processing
  )
  SELECT jsonb_build_object('contract_version','first_contact_cycle_v1','enabled',enabled,
    'processing_enabled',enabled AND processing) FROM readiness;
$capabilities$;
REVOKE ALL ON FUNCTION public.crm_v2_sla_cycle_capabilities() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_v2_sla_cycle_capabilities() TO authenticated;

CREATE FUNCTION public.crm_v2_process_first_contact_cycle(p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog SET timezone = 'UTC'
SET lock_timeout = '500ms'
AS $cycle$
DECLARE
  actor_id uuid:=auth.uid(); actor_role text:=public.crm_v2_role(); request_id_value uuid;
  uuid_pattern text:='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  settings_row public.crm_settings%ROWTYPE; cursor_row sales_private.crm_first_contact_cycle_cursor%ROWTYPE;
  cached_response jsonb; response_value jsonb; children jsonb:='[]'::jsonb; child_response jsonb; child_request_id uuid;
  selected_ids uuid[]; selected_times timestamptz[]; selected_customers uuid[]; selected_owners uuid[]:='{}'::uuid[];
  selected_count integer; processed_count integer; item integer; locked_customer_count integer:=0;
  customer_id_value uuid; owner_id_value uuid; selected_task public.crm_sla_tasks%ROWTYPE;
  role_row sales_private.crm_user_roles%ROWTYPE;
  started_at_value timestamptz; finished_at_value timestamptz; sweep_finished boolean;
  child_processed_at timestamptz; latest_child_at timestamptz;
  minimum_at constant timestamptz:=TIMESTAMPTZ '0001-01-01 00:00:00+00';
  maximum_at constant timestamptz:=TIMESTAMPTZ '9999-12-31 23:59:59.999999+00';
BEGIN
  IF actor_id IS NULL OR actor_role IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'CRM_SLA_CYCLE_FORBIDDEN'; END IF;
  SELECT * INTO settings_row FROM public.crm_settings WHERE id FOR SHARE;
  IF NOT FOUND OR (settings_row.central_intake_enabled AND settings_row.lead_work_enabled
    AND settings_row.lead_lifecycle_enabled AND settings_row.work_schedule_enabled AND settings_row.notifications_enabled
    AND settings_row.sla_preview_enabled AND settings_row.sla_processing_enabled AND settings_row.sla_cycle_enabled) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'CRM_SLA_CYCLE_SETUP_REQUIRED';
  END IF;
  IF jsonb_typeof(p_request) IS DISTINCT FROM 'object' OR octet_length(p_request::text)>1024 THEN
    RAISE EXCEPTION 'CRM_SLA_CYCLE_INVALID_INPUT';
  END IF;
  IF NOT (p_request ? 'requestId')
    OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_request) k WHERE k<>'requestId')
    OR jsonb_typeof(p_request->'requestId') IS DISTINCT FROM 'string'
    OR length(p_request->>'requestId')<>36 OR (p_request->>'requestId') !~ uuid_pattern THEN
    RAISE EXCEPTION 'CRM_SLA_CYCLE_INVALID_INPUT';
  END IF;
  request_id_value:=(p_request->>'requestId')::uuid;
  PERFORM pg_advisory_xact_lock(hashtextextended('sla-cycle-request:'||actor_id::text||':'||request_id_value::text,0));
  SELECT response INTO cached_response FROM sales_private.crm_first_contact_cycle_requests
    WHERE actor_user_id=actor_id AND request_id=request_id_value;
  IF FOUND THEN
    -- Terminal replay takes no customer/calendar locks, so its role lock cannot
    -- invert09's customer -> calendar -> ordered roles order. No new children.
    SELECT role INTO actor_role FROM sales_private.crm_user_roles WHERE user_id=actor_id AND is_active FOR SHARE;
    IF actor_role IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'CRM_SLA_CYCLE_FORBIDDEN'; END IF;
    RETURN sales_private.crm_first_contact_cycle_projection(cached_response)||jsonb_build_object('replayed',true);
  END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended('sla-first-contact-cycle:global',0)) THEN
    RAISE EXCEPTION 'CRM_SLA_CYCLE_BUSY';
  END IF;
  -- Do not prelock the Admin role before customer/calendar locks. All customers,
  -- Sales advisories/heads and roles needed by ALL children are acquired in that
  -- order below. Otherwise child1's retained calendar lock can deadlock against
  -- manual09 holding child2's customer and waiting for that same calendar.
  IF public.crm_v2_role() IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'CRM_SLA_CYCLE_FORBIDDEN'; END IF;
  SELECT * INTO cursor_row FROM sales_private.crm_first_contact_cycle_cursor WHERE id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CRM_SLA_CYCLE_SETUP_REQUIRED'; END IF;
  started_at_value:=clock_timestamp();
  IF NOT isfinite(started_at_value) OR started_at_value<minimum_at OR started_at_value>maximum_at THEN
    RAISE EXCEPTION 'CRM_SLA_CYCLE_SETUP_REQUIRED';
  END IF;
  SELECT COALESCE(array_agg(id ORDER BY created_at,id),'{}'::uuid[]),
    COALESCE(array_agg(created_at ORDER BY created_at,id),'{}'::timestamptz[]),
    COALESCE(array_agg(customer_id ORDER BY created_at,id),'{}'::uuid[])
    INTO selected_ids,selected_times,selected_customers FROM (
      SELECT id,created_at,customer_id FROM public.crm_sla_tasks
      WHERE task_type='first_contact' AND project_interest_id IS NULL AND source_activity_id IS NULL AND status='open'
        AND (cursor_row.after_task_id IS NULL OR (created_at,id)>(cursor_row.after_created_at,cursor_row.after_task_id))
      ORDER BY created_at,id LIMIT 11
    ) selected;
  selected_count:=cardinality(selected_ids); processed_count:=LEAST(selected_count,10); sweep_finished:=selected_count<=10;
  IF processed_count=0 THEN
    SELECT role INTO actor_role FROM sales_private.crm_user_roles WHERE user_id=actor_id AND is_active FOR SHARE;
    IF actor_role IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'CRM_SLA_CYCLE_FORBIDDEN'; END IF;
  ELSE
    FOR customer_id_value IN SELECT id FROM public.sales_customers
      WHERE id=ANY(selected_customers[1:processed_count]) ORDER BY id FOR UPDATE
    LOOP locked_customer_count:=locked_customer_count+1; END LOOP;
    IF locked_customer_count<>(SELECT count(DISTINCT id) FROM unnest(selected_customers[1:processed_count]) AS ids(id)) THEN
      RAISE EXCEPTION 'CRM_SLA_CYCLE_SETUP_REQUIRED';
    END IF;
    -- Customer locks serialize04/05/09 changes. Refresh owners only AFTER those
    -- locks; a normal lifecycle change is then handled conservatively by09.
    FOR item IN 1..processed_count LOOP
      SELECT * INTO selected_task FROM public.crm_sla_tasks WHERE id=selected_ids[item];
      IF NOT FOUND OR selected_task.customer_id IS DISTINCT FROM selected_customers[item]
        OR selected_task.created_at IS DISTINCT FROM selected_times[item]
        OR selected_task.task_type<>'first_contact' OR selected_task.project_interest_id IS NOT NULL
        OR selected_task.source_activity_id IS NOT NULL THEN RAISE EXCEPTION 'CRM_SLA_CYCLE_SETUP_REQUIRED'; END IF;
      selected_owners:=array_append(selected_owners,selected_task.owner_user_id);
    END LOOP;
    FOR owner_id_value IN SELECT DISTINCT id FROM unnest(selected_owners) AS owners(id) WHERE id IS NOT NULL ORDER BY id LOOP
      PERFORM pg_advisory_xact_lock(hashtextextended('work-schedule-sales:'||owner_id_value::text,0));
    END LOOP;
    PERFORM id FROM sales_private.crm_work_calendars WHERE sales_user_id=ANY(selected_owners) ORDER BY sales_user_id FOR SHARE;
    actor_role:=NULL;
    FOR role_row IN SELECT * FROM sales_private.crm_user_roles
      WHERE user_id=actor_id OR user_id=ANY(selected_owners) ORDER BY user_id FOR SHARE
    LOOP
      IF role_row.user_id=actor_id AND role_row.is_active THEN actor_role:=role_row.role; END IF;
    END LOOP;
    IF actor_role IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'CRM_SLA_CYCLE_FORBIDDEN'; END IF;
    -- Lock/revalidate the exact task targets before invoking09. Never allow a
    -- privileged out-of-protocol scope/owner edit to introduce a new parent lock.
    PERFORM id FROM public.crm_sla_tasks WHERE id=ANY(selected_ids[1:processed_count]) ORDER BY id FOR UPDATE;
    FOR item IN 1..processed_count LOOP
      SELECT * INTO selected_task FROM public.crm_sla_tasks WHERE id=selected_ids[item];
      IF NOT FOUND OR selected_task.customer_id IS DISTINCT FROM selected_customers[item]
        OR selected_task.owner_user_id IS DISTINCT FROM selected_owners[item]
        OR selected_task.created_at IS DISTINCT FROM selected_times[item]
        OR selected_task.task_type<>'first_contact' OR selected_task.project_interest_id IS NOT NULL
        OR selected_task.source_activity_id IS NOT NULL THEN RAISE EXCEPTION 'CRM_SLA_CYCLE_SETUP_REQUIRED'; END IF;
    END LOOP;
    FOR item IN 1..processed_count LOOP
      child_request_id:=gen_random_uuid();
      -- UUIDs are server-generated. A fantastically unlikely collision aborts
      -- the whole cycle rather than borrowing/replaying an unrelated receipt.
      IF EXISTS (SELECT 1 FROM sales_private.crm_first_contact_processing_requests
        WHERE actor_user_id=actor_id AND request_id=child_request_id) THEN
        RAISE EXCEPTION 'CRM_SLA_CYCLE_INVALID_INPUT';
      END IF;
      child_response:=public.crm_v2_process_first_contact(jsonb_build_object('requestId',child_request_id,'taskId',selected_ids[item]));
      IF jsonb_typeof(child_response) IS DISTINCT FROM 'object'
        OR child_response->'actor' IS DISTINCT FROM jsonb_build_object('userId',actor_id,'role','admin')
        OR child_response->>'requestId' IS DISTINCT FROM child_request_id::text
        OR child_response->>'taskId' IS DISTINCT FROM selected_ids[item]::text
        OR child_response->'replayed' IS DISTINCT FROM 'false'::jsonb
        OR jsonb_typeof(child_response->'processedAt') IS DISTINCT FROM 'string' THEN
        RAISE EXCEPTION 'CRM_SLA_CYCLE_SETUP_REQUIRED';
      END IF;
      -- Only timestamp parsing is mapped to setup failure. The09 invocation is
      -- OUTSIDE this block: all original child failures propagate unmodified.
      BEGIN
        child_processed_at:=sales_private.crm_work_timestamp(child_response->>'processedAt');
      EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'CRM_SLA_CYCLE_SETUP_REQUIRED';
      END;
      IF NOT isfinite(child_processed_at) OR child_processed_at<started_at_value OR child_processed_at>maximum_at THEN
        RAISE EXCEPTION 'CRM_SLA_CYCLE_SETUP_REQUIRED';
      END IF;
      latest_child_at:=GREATEST(latest_child_at,child_processed_at);
      children:=children||jsonb_build_array(child_response);
    END LOOP;
  END IF;
  -- Advance even past held reviews. End-of-sweep resets for the NEXT explicit
  -- call; no wrap/reprocess within this call. New earlier rows await next sweep.
  -- Fairness applies to committed rounds only: a persistent child error leaves
  -- the cursor unchanged and needs Admin remediation, never silent skipping.
  UPDATE sales_private.crm_first_contact_cycle_cursor SET
    after_created_at=CASE WHEN sweep_finished THEN NULL ELSE selected_times[10] END,
    after_task_id=CASE WHEN sweep_finished THEN NULL ELSE selected_ids[10] END WHERE id;
  finished_at_value:=clock_timestamp();
  IF NOT isfinite(finished_at_value) OR finished_at_value<started_at_value OR finished_at_value>maximum_at
    OR (latest_child_at IS NOT NULL AND finished_at_value<latest_child_at) THEN
    RAISE EXCEPTION 'CRM_SLA_CYCLE_SETUP_REQUIRED';
  END IF;
  response_value:=jsonb_build_object('actor',jsonb_build_object('userId',actor_id,'role','admin'),
    'requestId',request_id_value,'startedAt',started_at_value,'finishedAt',finished_at_value,'replayed',false,
    'maxItems',10,'processedCount',processed_count,'sweepFinished',sweep_finished,'receipts',children);
  INSERT INTO sales_private.crm_first_contact_cycle_requests(actor_user_id,request_id,response,created_at)
    VALUES(actor_id,request_id_value,response_value,finished_at_value);
  RETURN sales_private.crm_first_contact_cycle_projection(response_value);
  -- No outer exception handler: child errors, lock timeouts and receipt failures must
  -- roll back ALL child effects/cursor/parent receipt. lock_timeout bounds each
  -- lock wait, NOT total wall time. No scheduler or statement_timeout workaround.
END;
$cycle$;
REVOKE ALL ON FUNCTION public.crm_v2_process_first_contact_cycle(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_v2_process_first_contact_cycle(jsonb) TO authenticated;

-- Historical read only: processing/cycle kill switches do not block recovery.
-- found=false is not proof of noncommit (including a still-in-flight command).
CREATE FUNCTION public.crm_v2_first_contact_cycle_receipt(p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog SET timezone = 'UTC'
AS $receipt$
DECLARE
  actor_id uuid:=auth.uid(); actor_role text:=public.crm_v2_role(); request_id_value uuid;
  uuid_pattern text:='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  stored_response jsonb; found_receipt boolean; projected_receipt jsonb:=NULL;
BEGIN
  IF actor_id IS NULL OR actor_role IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'CRM_SLA_CYCLE_FORBIDDEN'; END IF;
  IF NOT COALESCE((SELECT central_intake_enabled AND lead_work_enabled AND lead_lifecycle_enabled
    AND work_schedule_enabled AND notifications_enabled AND sla_preview_enabled
    FROM public.crm_settings WHERE id),false) THEN RAISE EXCEPTION 'CRM_SLA_CYCLE_SETUP_REQUIRED'; END IF;
  IF jsonb_typeof(p_request) IS DISTINCT FROM 'object' OR octet_length(p_request::text)>1024 THEN
    RAISE EXCEPTION 'CRM_SLA_CYCLE_INVALID_INPUT';
  END IF;
  IF NOT (p_request ? 'requestId')
    OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_request) k WHERE k<>'requestId')
    OR jsonb_typeof(p_request->'requestId') IS DISTINCT FROM 'string'
    OR length(p_request->>'requestId')<>36 OR (p_request->>'requestId') !~ uuid_pattern THEN
    RAISE EXCEPTION 'CRM_SLA_CYCLE_INVALID_INPUT';
  END IF;
  request_id_value:=(p_request->>'requestId')::uuid;
  SELECT response INTO stored_response FROM sales_private.crm_first_contact_cycle_requests
    WHERE actor_user_id=actor_id AND request_id=request_id_value;
  found_receipt:=FOUND;
  IF found_receipt THEN projected_receipt:=sales_private.crm_first_contact_cycle_projection(stored_response); END IF;
  RETURN jsonb_build_object('actor',jsonb_build_object('userId',actor_id,'role','admin'),
    'requestId',request_id_value,'found',found_receipt,'receipt',projected_receipt);
END;
$receipt$;
REVOKE ALL ON FUNCTION public.crm_v2_first_contact_cycle_receipt(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_v2_first_contact_cycle_receipt(jsonb) TO authenticated;

ROLLBACK;
