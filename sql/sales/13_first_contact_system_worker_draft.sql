-- SALES V2 BOUNDED FIRST-CONTACT SYSTEM WORKER -- DESIGN ONLY, 2026-09-18.
-- NEVER RUN ON SUPABASE. Depends on UNAPPLIED base and companions 04--12,
-- including09's private shared apply core. Not a deployable migration.
-- No cron/extension/job, login, password, membership, JWT, service-role bypass,
-- dispatcher, durable pre-call intent, timer, retry or feature activation here.
-- One explicit privileged system call, at most ten tasks, ONE atomic transaction.
BEGIN;
DO $draft_only$
BEGIN
  RAISE EXCEPTION 'DESIGN ONLY: system worker is not authorized for database execution';
END;
$draft_only$;

-- A familiar role name is NOT proof of a safe identity. Refuse any collision;
-- never reuse or weaken an existing role or grant a caller its membership.
DO $worker_identity$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='buildtrack_sales_sla_worker') THEN
    RAISE EXCEPTION 'CRM_SLA_WORKER_ROLE_COLLISION';
  END IF;
  CREATE ROLE buildtrack_sales_sla_worker NOLOGIN NOINHERIT NOSUPERUSER
    NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
END;
$worker_identity$;

ALTER TABLE public.crm_settings ADD COLUMN sla_worker_enabled boolean NOT NULL DEFAULT false;

-- System receipts deliberately have no auth.users actor FK or Admin identity.
-- The child and parent ledgers, audit effects and shared cursor commit together.
CREATE TABLE sales_private.crm_first_contact_worker_requests (
  request_id uuid PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES public.crm_sla_tasks(id) ON DELETE RESTRICT,
  response jsonb NOT NULL CHECK (jsonb_typeof(response)='object'),
  created_at timestamptz NOT NULL CHECK (isfinite(created_at))
);
CREATE TABLE sales_private.crm_first_contact_worker_cycles (
  request_id uuid PRIMARY KEY,
  response jsonb NOT NULL CHECK (jsonb_typeof(response)='object'),
  created_at timestamptz NOT NULL CHECK (isfinite(created_at))
);
ALTER TABLE sales_private.crm_first_contact_worker_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_private.crm_first_contact_worker_cycles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sales_private.crm_first_contact_worker_requests FROM PUBLIC, anon, authenticated, buildtrack_sales_sla_worker;
REVOKE ALL ON sales_private.crm_first_contact_worker_cycles FROM PUBLIC, anon, authenticated, buildtrack_sales_sla_worker;
CREATE TRIGGER crm_first_contact_worker_receipt_immutable
  BEFORE UPDATE OR DELETE ON sales_private.crm_first_contact_worker_requests
  FOR EACH ROW EXECUTE FUNCTION sales_private.crm_first_contact_history_immutable();
CREATE TRIGGER crm_first_contact_worker_cycle_immutable
  BEFORE UPDATE OR DELETE ON sales_private.crm_first_contact_worker_cycles
  FOR EACH ROW EXECUTE FUNCTION sales_private.crm_first_contact_history_immutable();

-- Separate system projections:11's Admin actor whitelist is NOT applicable.
-- Explicit fields at BOTH levels keep future private details out of recovery.
CREATE FUNCTION sales_private.crm_first_contact_worker_child_projection(p_response jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = pg_catalog
AS $child_projection$
  SELECT jsonb_build_object(
    'actor',jsonb_build_object('kind',p_response#>'{actor,kind}','name',p_response#>'{actor,name}'),
    'requestId',p_response->'requestId','taskId',p_response->'taskId',
    'processedAt',p_response->'processedAt','replayed',p_response->'replayed',
    'outcome',p_response->'outcome','reason',p_response->'reason',
    'serviceDueAt',p_response->'serviceDueAt','staffDueAt',p_response->'staffDueAt',
    'notificationId',p_response->'notificationId','notificationType',p_response->'notificationType',
    'completedByActivityId',p_response->'completedByActivityId','completedAt',p_response->'completedAt',
    'withdrawnCount',p_response->'withdrawnCount');
$child_projection$;
REVOKE ALL ON FUNCTION sales_private.crm_first_contact_worker_child_projection(jsonb) FROM PUBLIC, anon, authenticated, buildtrack_sales_sla_worker;

CREATE FUNCTION sales_private.crm_first_contact_worker_cycle_projection(p_response jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = pg_catalog
AS $cycle_projection$
  SELECT jsonb_build_object(
    'actor',jsonb_build_object('kind',p_response#>'{actor,kind}','name',p_response#>'{actor,name}'),
    'requestId',p_response->'requestId','startedAt',p_response->'startedAt','finishedAt',p_response->'finishedAt',
    'replayed',p_response->'replayed','maxItems',p_response->'maxItems','processedCount',p_response->'processedCount',
    'sweepFinished',p_response->'sweepFinished','receipts',COALESCE((
      SELECT jsonb_agg(sales_private.crm_first_contact_worker_child_projection(child) ORDER BY ordinal)
      FROM jsonb_array_elements(p_response->'receipts') WITH ORDINALITY AS children(child,ordinal)
    ),'[]'::jsonb));
$cycle_projection$;
REVOKE ALL ON FUNCTION sales_private.crm_first_contact_worker_cycle_projection(jsonb) FROM PUBLIC, anon, authenticated, buildtrack_sales_sla_worker;

-- EXECUTE ACL is authority, NOT auth.uid(), JWT fields, a claimed actor or role
-- name in a session GUC. The function owner/DBA remains privileged by design.
-- No ordinary API role or worker gets direct table access or shared-core access.
CREATE FUNCTION sales_private.crm_first_contact_worker_cycle(p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog SET timezone = 'UTC'
SET lock_timeout = '500ms'
AS $worker_cycle$
DECLARE
  settings_row public.crm_settings%ROWTYPE; cursor_row sales_private.crm_first_contact_cycle_cursor%ROWTYPE;
  cached_response jsonb; response_value jsonb; children jsonb:='[]'::jsonb; child_response jsonb; child_request_id uuid;
  selected_ids uuid[]; selected_times timestamptz[]; selected_customers uuid[]; selected_owners uuid[]:='{}'::uuid[];
  selected_count integer; processed_count integer; item integer; locked_customer_count integer:=0;
  customer_id_value uuid; owner_id_value uuid; selected_task public.crm_sla_tasks%ROWTYPE;
  customer_row public.sales_customers%ROWTYPE; head_row sales_private.crm_work_calendars%ROWTYPE;
  role_row sales_private.crm_user_roles%ROWTYPE; active_owner_ids uuid[]:='{}'::uuid[]; owner_active boolean;
  started_at_value timestamptz; finished_at_value timestamptz; sweep_finished boolean;
  child_processed_at timestamptz; latest_child_at timestamptz;
  minimum_at constant timestamptz:=TIMESTAMPTZ '0001-01-01 00:00:00+00';
  maximum_at constant timestamptz:=TIMESTAMPTZ '9999-12-31 23:59:59.999999+00';
BEGIN
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'CRM_SLA_WORKER_INVALID_INPUT'; END IF;
  SELECT * INTO settings_row FROM public.crm_settings WHERE id FOR SHARE;
  IF NOT FOUND OR (settings_row.central_intake_enabled AND settings_row.lead_work_enabled
    AND settings_row.lead_lifecycle_enabled AND settings_row.work_schedule_enabled AND settings_row.notifications_enabled
    AND settings_row.sla_preview_enabled AND settings_row.sla_processing_enabled AND settings_row.sla_cycle_enabled
    AND settings_row.sla_worker_enabled) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'CRM_SLA_WORKER_SETUP_REQUIRED';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('sla-worker-cycle-request:'||p_request_id::text,0));
  SELECT response INTO cached_response FROM sales_private.crm_first_contact_worker_cycles WHERE request_id=p_request_id;
  IF FOUND THEN
    RETURN sales_private.crm_first_contact_worker_cycle_projection(cached_response)||jsonb_build_object('replayed',true);
  END IF;
  -- Same global lock and cursor as11: manual and system cycles never sweep over
  -- one another. Parent receipt namespaces are separate, business state is not.
  IF NOT pg_try_advisory_xact_lock(hashtextextended('sla-first-contact-cycle:global',0)) THEN
    RAISE EXCEPTION 'CRM_SLA_WORKER_BUSY';
  END IF;
  SELECT * INTO cursor_row FROM sales_private.crm_first_contact_cycle_cursor WHERE id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CRM_SLA_WORKER_SETUP_REQUIRED'; END IF;
  started_at_value:=clock_timestamp();
  IF NOT isfinite(started_at_value) OR started_at_value<minimum_at OR started_at_value>maximum_at THEN
    RAISE EXCEPTION 'CRM_SLA_WORKER_SETUP_REQUIRED';
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
  IF processed_count>0 THEN
    -- Lock ALL parents before ANY calendar or task. Retained child1 locks must
    -- not invert manual09/customer2's customer -> calendar -> roles order.
    FOR customer_id_value IN SELECT id FROM public.sales_customers
      WHERE id=ANY(selected_customers[1:processed_count]) ORDER BY id FOR UPDATE
    LOOP locked_customer_count:=locked_customer_count+1; END LOOP;
    IF locked_customer_count<>(SELECT count(DISTINCT id) FROM unnest(selected_customers[1:processed_count]) AS ids(id)) THEN
      RAISE EXCEPTION 'CRM_SLA_WORKER_SETUP_REQUIRED';
    END IF;
    -- Refresh owners AFTER customer locks serialize04/05/09 lifecycle changes.
    FOR item IN 1..processed_count LOOP
      SELECT * INTO selected_task FROM public.crm_sla_tasks WHERE id=selected_ids[item];
      IF NOT FOUND OR selected_task.customer_id IS DISTINCT FROM selected_customers[item]
        OR selected_task.created_at IS DISTINCT FROM selected_times[item]
        OR selected_task.task_type<>'first_contact' OR selected_task.project_interest_id IS NOT NULL
        OR selected_task.source_activity_id IS NOT NULL THEN RAISE EXCEPTION 'CRM_SLA_WORKER_SETUP_REQUIRED'; END IF;
      selected_owners:=array_append(selected_owners,selected_task.owner_user_id);
    END LOOP;
    FOR owner_id_value IN SELECT DISTINCT id FROM unnest(selected_owners) AS owners(id) WHERE id IS NOT NULL ORDER BY id LOOP
      -- Exact06 namespace also serializes the ABSENCE of a calendar head.
      PERFORM pg_advisory_xact_lock(hashtextextended('work-schedule-sales:'||owner_id_value::text,0));
    END LOOP;
    PERFORM id FROM sales_private.crm_work_calendars WHERE sales_user_id=ANY(selected_owners) ORDER BY sales_user_id FOR SHARE;
    FOR role_row IN SELECT * FROM sales_private.crm_user_roles WHERE user_id=ANY(selected_owners) ORDER BY user_id FOR SHARE LOOP
      IF role_row.role='sales' AND role_row.is_active THEN active_owner_ids:=array_append(active_owner_ids,role_row.user_id); END IF;
    END LOOP;
    PERFORM id FROM public.crm_sla_tasks WHERE id=ANY(selected_ids[1:processed_count]) ORDER BY id FOR UPDATE;
    FOR item IN 1..processed_count LOOP
      SELECT * INTO selected_task FROM public.crm_sla_tasks WHERE id=selected_ids[item];
      IF NOT FOUND OR selected_task.customer_id IS DISTINCT FROM selected_customers[item]
        OR selected_task.owner_user_id IS DISTINCT FROM selected_owners[item]
        OR selected_task.created_at IS DISTINCT FROM selected_times[item]
        OR selected_task.task_type<>'first_contact' OR selected_task.project_interest_id IS NOT NULL
        OR selected_task.source_activity_id IS NOT NULL THEN RAISE EXCEPTION 'CRM_SLA_WORKER_SETUP_REQUIRED'; END IF;
    END LOOP;
    FOR item IN 1..processed_count LOOP
      -- Re-read trusted locked snapshots for EACH child. Earlier children may
      -- have legitimately updated a shared customer; do not pass stale values.
      SELECT * INTO selected_task FROM public.crm_sla_tasks WHERE id=selected_ids[item];
      SELECT * INTO customer_row FROM public.sales_customers WHERE id=selected_task.customer_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'CRM_SLA_WORKER_SETUP_REQUIRED'; END IF;
      SELECT * INTO head_row FROM sales_private.crm_work_calendars WHERE sales_user_id=selected_task.owner_user_id;
      -- Capture role eligibility from rows actually locked above. A previously
      -- absent role inserted concurrently must not become an unlocked authority.
      owner_active:=COALESCE(selected_task.owner_user_id=ANY(active_owner_ids),false);
      child_request_id:=gen_random_uuid();
      IF child_request_id=p_request_id OR EXISTS (SELECT 1 FROM sales_private.crm_first_contact_worker_requests
        WHERE request_id=child_request_id) THEN RAISE EXCEPTION 'CRM_SLA_WORKER_INVALID_INPUT'; END IF;
      -- Shared09 business core, never impersonate an Admin or dispatch a public
      -- RPC through fabricated auth claims. Child errors propagate unchanged.
      child_response:=sales_private.crm_first_contact_apply(settings_row,customer_row,selected_task,head_row,
        owner_active,NULL,'First-contact system worker','system',child_request_id);
      IF jsonb_typeof(child_response) IS DISTINCT FROM 'object'
        OR child_response->'actor' IS DISTINCT FROM jsonb_build_object('kind','system','name','first_contact_worker_v1')
        OR child_response->>'requestId' IS DISTINCT FROM child_request_id::text
        OR child_response->>'taskId' IS DISTINCT FROM selected_ids[item]::text
        OR child_response->'replayed' IS DISTINCT FROM 'false'::jsonb
        OR jsonb_typeof(child_response->'processedAt') IS DISTINCT FROM 'string' THEN
        RAISE EXCEPTION 'CRM_SLA_WORKER_SETUP_REQUIRED';
      END IF;
      -- Only receipt timestamp parsing is mapped. No child error is swallowed.
      BEGIN
        child_processed_at:=sales_private.crm_work_timestamp(child_response->>'processedAt');
      EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'CRM_SLA_WORKER_SETUP_REQUIRED';
      END;
      IF NOT isfinite(child_processed_at) OR child_processed_at<started_at_value OR child_processed_at>maximum_at THEN
        RAISE EXCEPTION 'CRM_SLA_WORKER_SETUP_REQUIRED';
      END IF;
      latest_child_at:=GREATEST(latest_child_at,child_processed_at);
      child_response:=sales_private.crm_first_contact_worker_child_projection(child_response);
      INSERT INTO sales_private.crm_first_contact_worker_requests(request_id,task_id,response,created_at)
        VALUES(child_request_id,selected_task.id,child_response,child_processed_at);
      children:=children||jsonb_build_array(child_response);
    END LOOP;
  END IF;
  -- Held tasks advance only in COMMITTED cycles. A poison child rolls back the
  -- entire cycle/cursor and needs remediation; no skip, subtransaction or retry.
  UPDATE sales_private.crm_first_contact_cycle_cursor SET
    after_created_at=CASE WHEN sweep_finished THEN NULL ELSE selected_times[10] END,
    after_task_id=CASE WHEN sweep_finished THEN NULL ELSE selected_ids[10] END WHERE id;
  finished_at_value:=clock_timestamp();
  IF NOT isfinite(finished_at_value) OR finished_at_value<started_at_value OR finished_at_value>maximum_at
    OR (latest_child_at IS NOT NULL AND finished_at_value<latest_child_at) THEN
    RAISE EXCEPTION 'CRM_SLA_WORKER_SETUP_REQUIRED';
  END IF;
  response_value:=jsonb_build_object('actor',jsonb_build_object('kind','system','name','first_contact_worker_v1'),
    'requestId',p_request_id,'startedAt',started_at_value,'finishedAt',finished_at_value,'replayed',false,
    'maxItems',10,'processedCount',processed_count,'sweepFinished',sweep_finished,'receipts',children);
  INSERT INTO sales_private.crm_first_contact_worker_cycles(request_id,response,created_at)
    VALUES(p_request_id,response_value,finished_at_value);
  RETURN sales_private.crm_first_contact_worker_cycle_projection(response_value);
  -- No outer exception handler: rollback child writes, notices, audits, both
  -- system ledgers and cursor together.500ms bounds EACH lock wait, not runtime.
END;
$worker_cycle$;
REVOKE ALL ON FUNCTION sales_private.crm_first_contact_worker_cycle(uuid) FROM PUBLIC, anon, authenticated;

-- Historical lookup is read-only, independent of processing/cycle/worker gates.
-- found=false never proves noncommit: a request may still be in flight. A later
-- dispatcher must durably retain its exact request ID BEFORE invoking a cycle.
CREATE FUNCTION sales_private.crm_first_contact_worker_receipt(p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog SET timezone = 'UTC'
AS $worker_receipt$
DECLARE
  stored_response jsonb; found_receipt boolean; projected_receipt jsonb:=NULL;
BEGIN
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'CRM_SLA_WORKER_INVALID_INPUT'; END IF;
  IF NOT COALESCE((SELECT central_intake_enabled AND lead_work_enabled AND lead_lifecycle_enabled
    AND work_schedule_enabled AND notifications_enabled AND sla_preview_enabled
    FROM public.crm_settings WHERE id),false) THEN RAISE EXCEPTION 'CRM_SLA_WORKER_SETUP_REQUIRED'; END IF;
  SELECT response INTO stored_response FROM sales_private.crm_first_contact_worker_cycles WHERE request_id=p_request_id;
  found_receipt:=FOUND;
  IF found_receipt THEN projected_receipt:=sales_private.crm_first_contact_worker_cycle_projection(stored_response); END IF;
  RETURN jsonb_build_object('actor',jsonb_build_object('kind','system','name','first_contact_worker_v1'),
    'requestId',p_request_id,'found',found_receipt,'receipt',projected_receipt);
END;
$worker_receipt$;
REVOKE ALL ON FUNCTION sales_private.crm_first_contact_worker_receipt(uuid) FROM PUBLIC, anon, authenticated;

GRANT USAGE ON SCHEMA sales_private TO buildtrack_sales_sla_worker;
GRANT EXECUTE ON FUNCTION sales_private.crm_first_contact_worker_cycle(uuid) TO buildtrack_sales_sla_worker;
GRANT EXECUTE ON FUNCTION sales_private.crm_first_contact_worker_receipt(uuid) TO buildtrack_sales_sla_worker;
-- No CONNECT/login binding, role membership, direct table/core/projection grant,
-- default-privilege change, cron registration or production activation.
ROLLBACK;
