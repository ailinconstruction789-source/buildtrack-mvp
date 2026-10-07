-- LOCAL INSTALLATION CANDIDATE. Not executed or approved for production yet.
-- Do NOT db push this directory; remote account migration timestamps differ.
-- Prerequisites: sealed foundation, reviewed snapshot/materialization, replaced
-- sales and verified evidence reader. This package neither imports nor activates.
-- Attestations below are operator evidence references, not proof by themselves.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='30s';
SET LOCAL transaction_timeout='30s';
DO $commands_review$
DECLARE batch crm_external_private.snapshot_batches%ROWTYPE; rows_seen integer[];
BEGIN
  PERFORM crm_external_private.cutover_operator_check();
  PERFORM pg_advisory_xact_lock(20260925,3);
  IF current_setting('buildtrack.booking_commands_release',true) IS DISTINCT FROM 'central_booking_rows_2_966_v1'
    OR current_setting('buildtrack.booking_commands_project',true) IS DISTINCT FROM 'kbthmdedilswdmmczfay'
    OR length(btrim(coalesce(current_setting('buildtrack.booking_commands_backup',true),'')))<8
    OR length(btrim(coalesce(current_setting('buildtrack.booking_commands_app_review',true),'')))<8
    OR length(btrim(coalesce(current_setting('buildtrack.booking_commands_review',true),'')))<8 THEN
    RAISE EXCEPTION 'CENTRAL_BOOKING_REVIEW_REQUIRED';
  END IF;
  SELECT * INTO batch FROM crm_external_private.snapshot_batches
    WHERE id=NULLIF(current_setting('buildtrack.booking_commands_batch',true),'')::uuid;
  IF batch.id IS NULL
    OR batch.source_sha256 IS DISTINCT FROM current_setting('buildtrack.booking_commands_source_sha256',true)
    OR batch.plan_digest IS DISTINCT FROM current_setting('buildtrack.booking_commands_plan_digest',true)
    OR NOT EXISTS(SELECT 1 FROM crm_external_private.sales_cutover_receipts
      WHERE batch_id=batch.id AND request->>'planDigest'=batch.plan_digest)
    OR EXISTS(SELECT 1 FROM crm_external_private.sales_rollback_receipts WHERE batch_id=batch.id) THEN
    RAISE EXCEPTION 'CENTRAL_BOOKING_SOURCE_CHANGED';
  END IF;
  SELECT array_agg(n ORDER BY n) INTO rows_seen FROM (
    SELECT (r->>'sourceRow')::integer n FROM jsonb_array_elements(batch.payload->'sourceRecords') r
    UNION ALL SELECT r::integer FROM jsonb_array_elements_text(batch.payload->'skippedSourceRows') r
  ) rows;
  IF rows_seen IS DISTINCT FROM ARRAY(SELECT generate_series(2,966)) THEN
    RAISE EXCEPTION 'CENTRAL_BOOKING_SOURCE_WINDOW_REQUIRED';
  END IF;
  IF to_regclass('crm_external_private.booking_writer_releases') IS NOT NULL
    OR to_regprocedure('crm_external_private.sale_history(jsonb)') IS NULL THEN
    RAISE EXCEPTION 'CENTRAL_BOOKING_INSTALL_STATE_CHANGED';
  END IF;
  PERFORM crm_external_private.revalidate_cutover_identity(batch.id,batch.plan_digest);
  IF EXISTS(SELECT 1 FROM public.crm_settings t,LATERAL jsonb_each(to_jsonb(t)) j
    WHERE (j.key LIKE '%\_enabled' ESCAPE '\' OR j.key='booking_cutover_reviewed') AND j.value='true') THEN
    RAISE EXCEPTION 'CENTRAL_BOOKING_DISABLED_REQUIRED';
  END IF;
END;
$commands_review$;
-- DDL/unique-index creation must not wait behind live construction work.
-- Fail and review timing if these short locks cannot be acquired.
LOCK TABLE public.sales,public.plots,public.crm_settings,public.sales_customers,public.lead_project_interests IN SHARE ROW EXCLUSIVE MODE;
CREATE TEMP TABLE central_booking_baseline ON COMMIT DROP AS
SELECT c.oid,c.relacl,c.relrowsecurity,c.relowner,c.relname,NULL::text AS data_hash
FROM pg_class c WHERE c.relnamespace='public'::regnamespace
  AND c.relname IN ('sales','plots','leads','customer_voices','projects','sales_customers','lead_project_interests');
DO $before_commands$
DECLARE r record; result text;
BEGIN
  FOR r IN SELECT * FROM central_booking_baseline LOOP
    EXECUTE format('SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,''[]'')) FROM public.%I t',r.relname) INTO result;
    UPDATE central_booking_baseline SET data_hash=result WHERE oid=r.oid;
  END LOOP;
END;
$before_commands$;

-- Reviewed source: sql/sales/04_lead_work_foundation_draft.sql
-- LF-normalized SHA256: 058afbf28e90cd5ad63a4c5718d0f3640c4497772a1abcfbe0c9ed93a7c31077
-- SALES V2 LEAD WORK -- DESIGN ONLY, 2026-09-16.
-- Companion to the UNAPPLIED sales_workflow_v2_draft.sql, not a deployment migration.
-- Reuses lead_activities and crm_audit_events; no second contact/audit ledger.
-- Never run this file on Supabase. A separately reviewed migration and isolated
-- PostgreSQL/RLS/concurrency tests are required before any installation or enablement.
-- No legacy/backfill, stage/owner changes, SLA completion, Qualified credit or KPI score.


ALTER TABLE public.crm_settings
  ADD COLUMN lead_work_enabled boolean NOT NULL DEFAULT false;

-- Opaque per-scope token for future lifecycle commands; not a timestamp/owner ABA check.
ALTER TABLE public.sales_customers
  ADD COLUMN lifecycle_revision uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.lead_project_interests
  ADD COLUMN lifecycle_revision uuid NOT NULL DEFAULT gen_random_uuid();

-- A versioned plan, NOT a completed-work score. Replacement retains old due dates.
-- Non-null generated scope keys prevent NULL composite-FK bypass for central work.
CREATE TABLE public.crm_next_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.sales_customers(id) ON DELETE RESTRICT,
  project_interest_id uuid,
  scope_key text GENERATED ALWAYS AS (
    CASE WHEN project_interest_id IS NULL THEN 'customer:'||customer_id::text
         ELSE 'interest:'||project_interest_id::text END
  ) STORED NOT NULL,
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  action_text text NOT NULL CHECK (length(btrim(action_text)) BETWEEN 1 AND 500),
  due_at timestamptz NOT NULL CHECK (isfinite(due_at)),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','superseded','cancelled')),
  plan_started_at timestamptz NOT NULL DEFAULT now(),
  previous_action_id uuid,
  source_activity_id uuid,
  recorded_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  closed_by_user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  close_reason text,
  UNIQUE (id,customer_id,scope_key),
  FOREIGN KEY (project_interest_id,customer_id)
    REFERENCES public.lead_project_interests(id,customer_id) ON DELETE RESTRICT,
  FOREIGN KEY (previous_action_id,customer_id,scope_key)
    REFERENCES public.crm_next_actions(id,customer_id,scope_key) ON DELETE RESTRICT,
  CHECK (previous_action_id IS NULL OR previous_action_id <> id),
  -- Owner transfer copies the original plan clock, including already-overdue work.
  CHECK (isfinite(plan_started_at) AND plan_started_at <= recorded_at AND due_at > plan_started_at),
  CHECK ((status='open' AND closed_at IS NULL AND closed_by_user_id IS NULL AND close_reason IS NULL)
    OR (status IN ('superseded','cancelled') AND closed_at IS NOT NULL AND closed_at >= recorded_at
      AND closed_by_user_id IS NOT NULL AND close_reason IS NOT NULL AND btrim(close_reason) <> ''))
);
CREATE UNIQUE INDEX crm_next_actions_one_open_idx ON public.crm_next_actions(customer_id,scope_key)
  WHERE status='open';
CREATE INDEX crm_next_actions_due_idx ON public.crm_next_actions(owner_user_id,due_at) WHERE status='open';
CREATE INDEX crm_next_actions_scope_history_idx
  ON public.crm_next_actions(customer_id,scope_key,recorded_at DESC,id DESC);

-- Nullable extension fields leave existing/base activity contracts intact. Only
-- this new command fills all fields; no legacy record is retroactively invented.
ALTER TABLE public.lead_activities
  ADD COLUMN contact_channel text CHECK (contact_channel IN ('phone','chat','email','in_person','other')),
  ADD COLUMN action_text text CHECK (length(btrim(action_text)) BETWEEN 1 AND 500),
  ADD COLUMN performed_by_user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  ADD COLUMN related_next_action_id uuid,
  ADD COLUMN crm_scope_key text GENERATED ALWAYS AS (
    CASE WHEN project_interest_id IS NULL THEN 'customer:'||customer_id::text
         ELSE 'interest:'||project_interest_id::text END
  ) STORED NOT NULL,
  ADD CONSTRAINT crm_activity_scope_unique UNIQUE (id,customer_id,crm_scope_key),
  ADD CONSTRAINT crm_activity_action_scope_fk FOREIGN KEY (related_next_action_id,customer_id,crm_scope_key)
    REFERENCES public.crm_next_actions(id,customer_id,scope_key) ON DELETE RESTRICT;
ALTER TABLE public.crm_next_actions
  ADD CONSTRAINT crm_next_action_activity_scope_fk FOREIGN KEY (source_activity_id,customer_id,scope_key)
    REFERENCES public.lead_activities(id,customer_id,crm_scope_key) ON DELETE RESTRICT;
CREATE INDEX crm_activities_scope_history_idx
  ON public.lead_activities(customer_id,crm_scope_key,recorded_at DESC,id DESC);

ALTER TABLE public.crm_next_actions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_next_actions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.crm_next_actions TO authenticated;
CREATE POLICY crm_next_actions_read ON public.crm_next_actions FOR SELECT TO authenticated
  USING (public.crm_v2_role() IN ('sales','admin','owner'));
-- Base draft already closes direct writes to lead_activities and crm_audit_events.
-- No new browser mutation grants or policies are introduced here.

CREATE TABLE sales_private.lead_work_command_requests (
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL,
  request_payload jsonb NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_user_id,request_id)
);
ALTER TABLE sales_private.lead_work_command_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sales_private.lead_work_command_requests FROM PUBLIC, anon, authenticated;

-- Direct RPC callers receive the same strict timestamp contract as the app.
-- Explicit Gregorian date, timezone, <=6 fractional digits; no rollover, 24:00,
-- leap second, unknown -00:00, infinity, local timestamp or permissive PG cast.
CREATE FUNCTION sales_private.crm_work_timestamp(p_value text)
RETURNS timestamptz LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog
AS $timestamp$
DECLARE
  parts text[];
  yyyy integer; mm integer; dd integer; hh integer; mi integer; ss integer;
  offset_hours integer; offset_minutes integer; offset_total integer;
BEGIN
  IF p_value IS NULL OR p_value ~ '[^0-9TZ:+.-]' THEN RAISE EXCEPTION 'CRM_WORK_TIME_INVALID'; END IF;
  parts := regexp_match(p_value,
    '^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})([.][0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$');
  IF parts IS NULL THEN RAISE EXCEPTION 'CRM_WORK_TIME_INVALID'; END IF;
  yyyy:=parts[1]::integer; mm:=parts[2]::integer; dd:=parts[3]::integer;
  hh:=parts[4]::integer; mi:=parts[5]::integer; ss:=parts[6]::integer;
  IF yyyy<1 OR hh>23 OR mi>59 OR ss>59 OR parts[8]='-00:00' THEN
    RAISE EXCEPTION 'CRM_WORK_TIME_INVALID';
  END IF;
  offset_total:=0;
  IF parts[8]<>'Z' THEN
    offset_hours:=substring(parts[8] FROM 2 FOR 2)::integer;
    offset_minutes:=substring(parts[8] FROM 5 FOR 2)::integer;
    IF offset_hours>23 OR offset_minutes>59 THEN RAISE EXCEPTION 'CRM_WORK_TIME_INVALID'; END IF;
    offset_total:=(offset_hours*60+offset_minutes) * CASE WHEN left(parts[8],1)='-' THEN -1 ELSE 1 END;
  END IF;
  RETURN (make_date(yyyy,mm,dd)::timestamp + make_interval(hours=>hh,mins=>mi,secs=>ss)
    + COALESCE(rpad(substring(parts[7] FROM 2),6,'0')::integer,0) * interval '1 microsecond'
    - offset_total * interval '1 minute') AT TIME ZONE 'UTC';
EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format OR invalid_text_representation THEN
  RAISE EXCEPTION 'CRM_WORK_TIME_INVALID';
END;
$timestamp$;
REVOKE ALL ON FUNCTION sales_private.crm_work_timestamp(text) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION sales_private.crm_work_text(p_value text,p_limit integer)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog
AS $text$
DECLARE
  -- ECMAScript trim whitespace except control characters, rejected before trimming.
  trim_chars text := U&' \00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
  normalized text;
BEGIN
  IF p_value IS NULL OR p_value ~ U&'[\0001-\001F\007F-\009F\2028\2029]' THEN
    RAISE EXCEPTION 'CRM_WORK_INVALID_INPUT';
  END IF;
  normalized:=btrim(p_value,trim_chars);
  IF length(normalized) NOT BETWEEN 1 AND p_limit THEN RAISE EXCEPTION 'CRM_WORK_INVALID_INPUT'; END IF;
  RETURN normalized;
END;
$text$;
REVOKE ALL ON FUNCTION sales_private.crm_work_text(text,integer) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.crm_v2_lead_work_capabilities()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $capabilities$
  SELECT jsonb_build_object('contract_version','lead_work_v1','read_contract_version','lead_work_read_v2','enabled',
    public.crm_v2_role() IN ('sales','admin','owner') AND COALESCE((
      SELECT central_intake_enabled AND lead_work_enabled FROM public.crm_settings WHERE id
    ),false));
$capabilities$;
REVOKE ALL ON FUNCTION public.crm_v2_lead_work_capabilities() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_v2_lead_work_capabilities() TO authenticated;

-- Read-only projection. STABLE uses the caller's statement snapshot for these
-- reads; no UPDATE/last_seen, advisory locks, SLA recalculation or request receipts.
-- All active Sales can read any project. canWrite is a hint from trusted state,
-- never authorization for the subsequent command, which rechecks under locks.
CREATE FUNCTION public.crm_v2_lead_work_snapshot(p_customer_id uuid,p_interest_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $snapshot$
DECLARE
  actor_id uuid:=auth.uid();
  actor_role text:=public.crm_v2_role();
  customer_row public.sales_customers%ROWTYPE;
  interest_row public.lead_project_interests%ROWTYPE;
  current_row public.crm_next_actions%ROWTYPE;
  scope_owner uuid; scope_revision uuid; owner_name text; owner_active boolean;
  scope_key_value text; closed boolean;
  actions_json jsonb; activities_json jsonb; current_json jsonb;
  more_actions boolean; more_activities boolean;
BEGIN
  IF actor_id IS NULL OR actor_role IS NULL OR actor_role NOT IN ('sales','admin','owner') THEN
    RAISE EXCEPTION 'CRM_WORK_FORBIDDEN';
  END IF;
  IF NOT COALESCE((SELECT central_intake_enabled AND lead_work_enabled
    FROM public.crm_settings WHERE id),false) THEN RAISE EXCEPTION 'CRM_WORK_SETUP_REQUIRED'; END IF;
  IF p_customer_id IS NULL THEN RAISE EXCEPTION 'CRM_WORK_INVALID_INPUT'; END IF;
  SELECT * INTO customer_row FROM public.sales_customers WHERE id=p_customer_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'CRM_WORK_NOT_FOUND'; END IF;
  scope_owner:=customer_row.owner_user_id;
  scope_revision:=customer_row.lifecycle_revision;
  scope_key_value:='customer:'||p_customer_id::text;
  closed:=customer_row.merged_into_customer_id IS NOT NULL OR customer_row.intake_status='lost';
  IF p_interest_id IS NOT NULL THEN
    SELECT * INTO interest_row FROM public.lead_project_interests
      WHERE id=p_interest_id AND customer_id=p_customer_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'CRM_WORK_NOT_FOUND'; END IF;
    scope_owner:=interest_row.owner_user_id;
    scope_revision:=interest_row.lifecycle_revision;
    scope_key_value:='interest:'||p_interest_id::text;
    closed:=customer_row.merged_into_customer_id IS NOT NULL OR interest_row.engagement_status='lost';
  END IF;
  SELECT display_name,(role='sales' AND is_active) INTO owner_name,owner_active
    FROM sales_private.crm_user_roles WHERE user_id=scope_owner;
  owner_active:=COALESCE(owner_active,false);
  SELECT * INTO current_row FROM public.crm_next_actions
    WHERE customer_id=p_customer_id AND scope_key=scope_key_value AND status='open';
  current_json:=CASE WHEN current_row.id IS NULL THEN NULL ELSE jsonb_build_object(
    'id',current_row.id,'customerId',current_row.customer_id,'interestId',current_row.project_interest_id,
    'ownerUserId',current_row.owner_user_id,'action',current_row.action_text,'dueAt',current_row.due_at,
    'recordedAt',current_row.recorded_at,'status',current_row.status,
    'closedAt',current_row.closed_at,'closeReason',current_row.close_reason) END;

  -- Fetch at most 21 per history, returning 20 plus an explicit partial-history flag.
  -- Order by recording time and unique ID so backdated occurrences stay visible.
  WITH recent AS (
    SELECT a.* FROM public.crm_next_actions a
      WHERE a.customer_id=p_customer_id AND a.scope_key=scope_key_value
      ORDER BY a.recorded_at DESC,a.id DESC LIMIT 21
  ), numbered AS (
    SELECT r.*,row_number() OVER (ORDER BY r.recorded_at DESC,r.id DESC) AS rn FROM recent r
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',a.id,'customerId',a.customer_id,'interestId',a.project_interest_id,
    'ownerUserId',a.owner_user_id,'action',a.action_text,'dueAt',a.due_at,
    'recordedAt',a.recorded_at,'status',a.status,'closedAt',a.closed_at,'closeReason',a.close_reason
  ) ORDER BY a.recorded_at DESC,a.id DESC) FILTER (WHERE a.rn<=20),'[]'::jsonb),count(*)>20
    INTO actions_json,more_actions FROM numbered a;

  WITH recent AS (
    SELECT a.* FROM public.lead_activities a
      WHERE a.customer_id=p_customer_id AND a.crm_scope_key=scope_key_value
      ORDER BY a.recorded_at DESC,a.id DESC LIMIT 21
  ), numbered AS (
    SELECT r.*,row_number() OVER (ORDER BY r.recorded_at DESC,r.id DESC) AS rn FROM recent r
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',a.id,'customerId',a.customer_id,'interestId',a.project_interest_id,
    'activityType',a.activity_type,'action',a.action_text,'channel',a.contact_channel,'result',a.result,
    'occurredAt',a.occurred_at,'recordedAt',a.recorded_at,
    'performedByUserId',a.performed_by_user_id,'recordedByUserId',a.recorded_by_user_id,'note',a.note
  ) ORDER BY a.recorded_at DESC,a.id DESC) FILTER (WHERE a.rn<=20),'[]'::jsonb),count(*)>20
    INTO activities_json,more_activities FROM numbered a;

  RETURN jsonb_build_object(
    'actor',jsonb_build_object('userId',actor_id,'role',actor_role),
    'scope',jsonb_build_object('customerId',p_customer_id,'interestId',p_interest_id),
    'customer',jsonb_build_object('id',customer_row.id,'name',customer_row.customer_name,
      'phone',customer_row.phone,'leadCreatedAt',customer_row.lead_created_at),
    'projectName',interest_row.project_name,
    'owner',jsonb_build_object('userId',scope_owner,'displayName',owner_name,'active',owner_active),
    'scopeClosed',closed,
    'lifecycleRevision',scope_revision,
    'canWrite',NOT closed AND owner_active AND (actor_role='admin' OR (actor_role='sales' AND actor_id=scope_owner)),
    'asOf',statement_timestamp(),'currentAction',current_json,'actions',actions_json,'activities',activities_json,
    'history',jsonb_build_object('limit',20,'actionsHasMore',more_actions,'activitiesHasMore',more_activities)
  );
END;
$snapshot$;
REVOKE ALL ON FUNCTION public.crm_v2_lead_work_snapshot(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_v2_lead_work_snapshot(uuid,uuid) TO authenticated;

CREATE FUNCTION public.crm_v2_record_lead_work(p_request_id uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $command$
DECLARE
  actor_id uuid:=auth.uid();
  actor_role text; actor_name text; scope_owner uuid;
  role_row sales_private.crm_user_roles%ROWTYPE; scope_owner_active boolean:=false;
  command_name text; customer_id_value uuid; interest_id_value uuid; expected_id uuid;
  customer_row public.sales_customers%ROWTYPE;
  interest_row public.lead_project_interests%ROWTYPE;
  prior_action public.crm_next_actions%ROWTYPE;
  request_row sales_private.lead_work_command_requests%ROWTYPE;
  enabled boolean;
  reason_value text; action_value text; attempt_action text;
  due_value timestamptz; occurred_value timestamptz;
  server_now timestamptz;
  new_action_id uuid:=gen_random_uuid();
  new_activity_id uuid;
  response_value jsonb;
  uuid_pattern text:='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
BEGIN
  IF actor_id IS NULL OR public.crm_v2_role() NOT IN ('sales','admin') THEN
    RAISE EXCEPTION 'CRM_WORK_FORBIDDEN';
  END IF;
  -- DB kill switch protects direct RPC calls as well as the disabled app route.
  SELECT central_intake_enabled AND lead_work_enabled INTO enabled
    FROM public.crm_settings WHERE id FOR SHARE;
  IF enabled IS DISTINCT FROM true THEN RAISE EXCEPTION 'CRM_WORK_SETUP_REQUIRED'; END IF;
  IF p_request_id IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object'
    OR octet_length(p_payload::text)>16384 THEN RAISE EXCEPTION 'CRM_WORK_INVALID_INPUT'; END IF;
  IF NOT (p_payload ?& ARRAY['command','customerId','interestId','expectedActionId','nextAction','reason'])
    OR jsonb_typeof(p_payload->'command') IS DISTINCT FROM 'string'
    OR (p_payload->>'command') NOT IN ('set_next_action','record_attempt') THEN
    RAISE EXCEPTION 'CRM_WORK_INVALID_INPUT';
  END IF;
  command_name:=p_payload->>'command';
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN (
      'command','customerId','interestId','expectedActionId','nextAction','reason','attempt'))
    OR (command_name='set_next_action' AND p_payload ? 'attempt')
    OR (command_name='record_attempt' AND NOT (p_payload ? 'attempt')) THEN
    RAISE EXCEPTION 'CRM_WORK_INVALID_INPUT';
  END IF;
  IF jsonb_typeof(p_payload->'customerId') IS DISTINCT FROM 'string'
    OR length(p_payload->>'customerId')<>36 OR (p_payload->>'customerId') !~ uuid_pattern
    OR jsonb_typeof(p_payload->'interestId') NOT IN ('string','null')
    OR (jsonb_typeof(p_payload->'interestId')='string'
      AND (length(p_payload->>'interestId')<>36 OR (p_payload->>'interestId') !~ uuid_pattern))
    OR jsonb_typeof(p_payload->'expectedActionId') NOT IN ('string','null')
    OR (jsonb_typeof(p_payload->'expectedActionId')='string'
      AND (length(p_payload->>'expectedActionId')<>36 OR (p_payload->>'expectedActionId') !~ uuid_pattern))
    OR jsonb_typeof(p_payload->'reason') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_payload->'nextAction') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'CRM_WORK_INVALID_INPUT';
  END IF;
  IF NOT ((p_payload->'nextAction') ?& ARRAY['action','dueAt'])
    OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_payload->'nextAction') k WHERE k NOT IN ('action','dueAt'))
    OR jsonb_typeof(p_payload#>'{nextAction,action}') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_payload#>'{nextAction,dueAt}') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'CRM_WORK_INVALID_INPUT';
  END IF;
  reason_value:=sales_private.crm_work_text(p_payload->>'reason',1000);
  action_value:=sales_private.crm_work_text(p_payload#>>'{nextAction,action}',500);
  due_value:=sales_private.crm_work_timestamp(p_payload#>>'{nextAction,dueAt}');
  IF command_name='record_attempt' THEN
    IF jsonb_typeof(p_payload->'attempt') IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'CRM_WORK_INVALID_INPUT';
    END IF;
    IF NOT ((p_payload->'attempt') ?& ARRAY['action','channel','result','occurredAt'])
      OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_payload->'attempt') k
        WHERE k NOT IN ('action','channel','result','occurredAt'))
      OR jsonb_typeof(p_payload#>'{attempt,action}') IS DISTINCT FROM 'string'
      OR jsonb_typeof(p_payload#>'{attempt,channel}') IS DISTINCT FROM 'string'
      OR jsonb_typeof(p_payload#>'{attempt,result}') IS DISTINCT FROM 'string'
      OR jsonb_typeof(p_payload#>'{attempt,occurredAt}') IS DISTINCT FROM 'string'
      OR (p_payload#>>'{attempt,channel}') NOT IN ('phone','chat','email','in_person','other')
      OR (p_payload#>>'{attempt,result}') NOT IN ('contact_success','no_answer','customer_requested_later','other') THEN
      RAISE EXCEPTION 'CRM_WORK_INVALID_INPUT';
    END IF;
    attempt_action:=sales_private.crm_work_text(p_payload#>>'{attempt,action}',500);
    occurred_value:=sales_private.crm_work_timestamp(p_payload#>>'{attempt,occurredAt}');
  END IF;
  customer_id_value:=(p_payload->>'customerId')::uuid;
  interest_id_value:=(p_payload->>'interestId')::uuid;
  expected_id:=(p_payload->>'expectedActionId')::uuid;

  -- Serialization order: settings -> request -> customer -> interest -> role rows.
  -- Future assignment/closure commands must follow compatible scope/role locking.
  PERFORM pg_advisory_xact_lock(hashtextextended('lead-work:'||actor_id::text||':'||p_request_id::text,0));
  SELECT * INTO customer_row FROM public.sales_customers WHERE id=customer_id_value FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CRM_WORK_NOT_FOUND'; END IF;
  scope_owner:=customer_row.owner_user_id;
  IF interest_id_value IS NOT NULL THEN
    SELECT * INTO interest_row FROM public.lead_project_interests
      WHERE id=interest_id_value AND customer_id=customer_id_value FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'CRM_WORK_NOT_FOUND'; END IF;
    scope_owner:=interest_row.owner_user_id;
  END IF;
  -- Use only the trusted role rows actually locked, including the current owner.
  -- A role inserted after this scan must not authorize an unlocked write.
  FOR role_row IN SELECT * FROM sales_private.crm_user_roles WHERE user_id IN (actor_id,scope_owner)
    ORDER BY user_id FOR SHARE
  LOOP
    IF role_row.user_id=actor_id AND role_row.is_active THEN
      actor_role:=role_row.role; actor_name:=role_row.display_name;
    END IF;
    IF role_row.user_id=scope_owner THEN
      scope_owner_active:=role_row.role='sales' AND role_row.is_active;
    END IF;
  END LOOP;
  IF actor_role IS NULL OR actor_role NOT IN ('sales','admin')
    OR (actor_role='sales' AND actor_id<>scope_owner) THEN
    RAISE EXCEPTION 'CRM_WORK_FORBIDDEN';
  END IF;
  IF scope_owner_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'CRM_WORK_INACTIVE_OWNER';
  END IF;

  -- Re-check ownership BEFORE replay. A former owner must not replay a saved receipt.
  SELECT * INTO request_row FROM sales_private.lead_work_command_requests
    WHERE actor_user_id=actor_id AND request_id=p_request_id;
  IF FOUND THEN
    IF request_row.request_payload IS DISTINCT FROM p_payload THEN
      RAISE EXCEPTION 'CRM_WORK_IDEMPOTENCY_CONFLICT';
    END IF;
    RETURN request_row.response || jsonb_build_object('replayed',true);
  END IF;
  IF customer_row.merged_into_customer_id IS NOT NULL
    OR (interest_id_value IS NULL AND customer_row.intake_status='lost')
    OR (interest_id_value IS NOT NULL AND interest_row.engagement_status='lost') THEN
    RAISE EXCEPTION 'CRM_WORK_SCOPE_CLOSED';
  END IF;
  SELECT * INTO prior_action FROM public.crm_next_actions
    WHERE customer_id=customer_id_value AND project_interest_id IS NOT DISTINCT FROM interest_id_value
      AND status='open' FOR UPDATE;
  IF prior_action.id IS DISTINCT FROM expected_id THEN RAISE EXCEPTION 'CRM_WORK_STALE_ACTION'; END IF;

  -- Trusted clock sampled AFTER lock waits, not a browser date or transaction start.
  -- Cached retries above remain valid after the original deadline has passed.
  server_now:=clock_timestamp();
  IF due_value<=server_now OR (command_name='record_attempt' AND occurred_value>server_now) THEN
    RAISE EXCEPTION 'CRM_WORK_TIME_INVALID';
  END IF;
  -- An older event must not replace a plan created after that event. A future
  -- history-only command can append such evidence without touching the open plan.
  IF command_name='record_attempt' AND prior_action.id IS NOT NULL
    AND occurred_value<prior_action.recorded_at THEN
    RAISE EXCEPTION 'CRM_WORK_TIME_INVALID';
  END IF;
  IF command_name='record_attempt' THEN
    new_activity_id:=gen_random_uuid();
    INSERT INTO public.lead_activities (
      id,customer_id,project_interest_id,activity_type,result,occurred_at,recorded_at,
      recorded_by_user_id,performed_by_user_id,contact_channel,action_text,
      related_next_action_id,next_follow_up_at,note
    ) VALUES (
      new_activity_id,customer_id_value,interest_id_value,'follow_up',p_payload#>>'{attempt,result}',
      occurred_value,server_now,actor_id,actor_id,p_payload#>>'{attempt,channel}',attempt_action,
      prior_action.id,due_value,reason_value
    );
  END IF;
  -- Superseded is NOT done. Neither success nor no_answer erases the previous due date.
  IF prior_action.id IS NOT NULL THEN
    UPDATE public.crm_next_actions SET status='superseded',closed_at=server_now,
      closed_by_user_id=actor_id,close_reason=reason_value WHERE id=prior_action.id;
  END IF;
  INSERT INTO public.crm_next_actions (
    id,customer_id,project_interest_id,owner_user_id,action_text,due_at,previous_action_id,
    source_activity_id,recorded_by_user_id,recorded_at,plan_started_at
  ) VALUES (
    new_action_id,customer_id_value,interest_id_value,scope_owner,action_value,due_value,prior_action.id,
    new_activity_id,actor_id,server_now,server_now
  );
  INSERT INTO public.crm_audit_events (
    customer_id,entity_type,entity_id,event_type,reason_text,actor_user_id,actor_kind,
    actor_name_snapshot,old_values,new_values,occurred_at,recorded_at
  ) VALUES (
    customer_id_value,'crm_next_action',new_action_id,command_name,reason_value,actor_id,'staff',
    actor_name,CASE WHEN prior_action.id IS NULL THEN NULL ELSE to_jsonb(prior_action) END,
    jsonb_build_object('nextActionId',new_action_id,'activityId',new_activity_id,
      'interestId',interest_id_value,'ownerUserId',scope_owner,'action',action_value,'dueAt',due_value,
      'priorWasOverdue',CASE WHEN prior_action.id IS NULL THEN NULL ELSE prior_action.due_at<server_now END),
    server_now,server_now
  );
  response_value:=jsonb_build_object('nextActionId',new_action_id,'activityId',new_activity_id,'replayed',false);
  INSERT INTO sales_private.lead_work_command_requests (actor_user_id,request_id,request_payload,response,created_at)
    VALUES (actor_id,p_request_id,p_payload,response_value,server_now);
  RETURN response_value;
END;
$command$;
REVOKE ALL ON FUNCTION public.crm_v2_record_lead_work(uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_v2_record_lead_work(uuid,jsonb) TO authenticated;

-- NOT A FULL WORKFLOW: companion 05 designs scoped owner transfer/pre-booking lost.
-- Wire evidence corrections, other terminal events, SLA/calendar/notifications and qualification
-- separately before cutover. Never interpret superseded as on-time/done, nor
-- performed_by=Admin as work performed by the owning Sales. No automatic KPI credit.

-- Reviewed source: sql/sales/05_lead_lifecycle_draft.sql
-- LF-normalized SHA256: 45331fa0b43cd7c2f6517cc17a407efbf6642144f1f137280776d6cedb7053df
-- SALES V2 LIFECYCLE -- DESIGN ONLY, 2026-09-16. NEVER RUN ON SUPABASE.
-- Depends on the UNAPPLIED base draft and revised companion 04 (read v2).
-- This is not a deployment migration. Static tests are NOT PostgreSQL/RLS tests.


ALTER TABLE public.crm_settings
  ADD COLUMN lead_lifecycle_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.crm_sla_tasks
  ADD COLUMN cancelled_at timestamptz,
  ADD COLUMN cancelled_by_user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  ADD COLUMN cancellation_reason text,
  ADD CONSTRAINT crm_sla_cancellation_evidence CHECK (
    (cancelled_at IS NULL AND cancelled_by_user_id IS NULL AND cancellation_reason IS NULL)
    OR (status='cancelled' AND cancelled_at IS NOT NULL AND isfinite(cancelled_at)
      AND cancelled_at >= created_at AND cancelled_by_user_id IS NOT NULL
      AND cancellation_reason IS NOT NULL AND btrim(cancellation_reason)<>''));
ALTER TABLE public.crm_notifications
  ADD COLUMN withdrawn_at timestamptz,
  ADD COLUMN withdrawal_reason text,
  ADD CONSTRAINT crm_notification_withdrawal_evidence CHECK (
    (withdrawn_at IS NULL AND withdrawal_reason IS NULL)
    OR (withdrawn_at IS NOT NULL AND isfinite(withdrawn_at)
      AND withdrawal_reason IS NOT NULL AND btrim(withdrawal_reason)<>''));
-- Future read/delivery code must exclude withdrawn notifications and recheck the
-- task's current owner/status. Never move another person's read receipt to a new owner.

CREATE FUNCTION public.crm_v2_lead_lifecycle_capabilities()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $capabilities$
  SELECT jsonb_build_object('contract_version','lead_lifecycle_v1','read_contract_version','lead_lifecycle_read_v1','enabled',
    public.crm_v2_role() IN ('sales','admin','owner') AND COALESCE((
      SELECT central_intake_enabled AND lead_work_enabled AND lead_lifecycle_enabled
      FROM public.crm_settings WHERE id),false));
$capabilities$;
REVOKE ALL ON FUNCTION public.crm_v2_lead_lifecycle_capabilities() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_v2_lead_lifecycle_capabilities() TO authenticated;

-- Read-only review context: one statement snapshot, no locks or mutation effects.
-- Preview counts may change before confirmation; the write rechecks scope, owner,
-- revision, open action and booking blockers under its transaction locks.
CREATE FUNCTION public.crm_v2_lead_lifecycle_context(p_customer_id uuid,p_interest_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $context$
DECLARE
  actor_id uuid:=auth.uid(); actor_role text:=public.crm_v2_role();
  work_json jsonb; candidates_json jsonb:='[]'::jsonb; candidates_more boolean:=false;
  source_lead_id uuid; scope_owner uuid; closed boolean;
  has_bookings boolean; has_open_interests boolean:=false;
  open_tasks bigint; pending_notices bigint;
BEGIN
  IF actor_id IS NULL OR actor_role IS NULL OR actor_role NOT IN ('sales','admin','owner') THEN
    RAISE EXCEPTION 'CRM_LIFECYCLE_FORBIDDEN';
  END IF;
  IF NOT COALESCE((SELECT central_intake_enabled AND lead_work_enabled AND lead_lifecycle_enabled
    FROM public.crm_settings WHERE id),false) THEN RAISE EXCEPTION 'CRM_LIFECYCLE_SETUP_REQUIRED'; END IF;
  IF p_customer_id IS NULL THEN RAISE EXCEPTION 'CRM_LIFECYCLE_INVALID_INPUT'; END IF;
  -- The shared read-v2 projection validates the customer/interest relationship.
  work_json:=public.crm_v2_lead_work_snapshot(p_customer_id,p_interest_id);
  scope_owner:=(work_json#>>'{owner,userId}')::uuid;
  closed:=(work_json->>'scopeClosed')::boolean;
  SELECT legacy_source_lead_id INTO source_lead_id FROM public.sales_customers WHERE id=p_customer_id;
  has_bookings:=EXISTS (SELECT 1 FROM public.sales s
    JOIN public.lead_project_interests i ON i.id=s.project_interest_id
    WHERE i.customer_id=p_customer_id AND (p_interest_id IS NULL OR i.id=p_interest_id))
    OR EXISTS (SELECT 1 FROM public.sales s WHERE s.lead_id=source_lead_id AND s.project_interest_id IS NULL);
  IF p_interest_id IS NULL THEN
    has_open_interests:=EXISTS (SELECT 1 FROM public.lead_project_interests
      WHERE customer_id=p_customer_id AND engagement_status<>'lost');
  END IF;
  IF actor_role='admin' THEN
    WITH recent AS (
      SELECT user_id,display_name FROM sales_private.crm_user_roles
        WHERE role='sales' AND is_active ORDER BY user_id LIMIT 201
    ), numbered AS (
      SELECT r.*,row_number() OVER (ORDER BY user_id) AS rn FROM recent r
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object('userId',n.user_id,'displayName',n.display_name)
      ORDER BY n.user_id) FILTER (WHERE n.rn<=200),'[]'::jsonb),count(*)>200
      INTO candidates_json,candidates_more FROM numbered n;
  END IF;
  SELECT count(*) INTO open_tasks FROM public.crm_sla_tasks t
    WHERE t.customer_id=p_customer_id AND t.project_interest_id IS NOT DISTINCT FROM p_interest_id AND t.status='open';
  SELECT count(*) INTO pending_notices FROM public.crm_notifications n
    JOIN public.crm_sla_tasks t ON t.id=n.task_id
    WHERE t.customer_id=p_customer_id AND t.project_interest_id IS NOT DISTINCT FROM p_interest_id
      AND t.status='open' AND n.withdrawn_at IS NULL;
  RETURN jsonb_build_object('work',work_json,'candidates',candidates_json,'candidatesTruncated',candidates_more,
    'canReassign',NOT closed AND actor_role='admin',
    'canClose',NOT closed AND (actor_role='admin' OR (actor_role='sales' AND actor_id=scope_owner))
      AND NOT has_bookings AND NOT has_open_interests,
    'blockers',jsonb_build_object('hasBookingHistory',has_bookings,'hasOpenInterests',has_open_interests),
    'impact',jsonb_build_object('openSlaCount',open_tasks,'pendingNotificationCount',pending_notices));
END;
$context$;
REVOKE ALL ON FUNCTION public.crm_v2_lead_lifecycle_context(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_v2_lead_lifecycle_context(uuid,uuid) TO authenticated;

CREATE FUNCTION public.crm_v2_change_lead_lifecycle(p_request_id uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $lifecycle$
DECLARE
  actor_id uuid:=auth.uid(); actor_role text:=public.crm_v2_role(); actor_name text;
  enabled boolean; command_name text; reason_value text;
  customer_id_value uuid; interest_id_value uuid; expected_revision uuid; expected_action uuid;
  new_owner uuid; scope_owner uuid; scope_revision uuid; scope_status text;
  customer_row public.sales_customers%ROWTYPE;
  interest_row public.lead_project_interests%ROWTYPE;
  prior_action public.crm_next_actions%ROWTYPE;
  request_row sales_private.lead_work_command_requests%ROWTYPE;
  task_row public.crm_sla_tasks%ROWTYPE;
  role_row sales_private.crm_user_roles%ROWTYPE; target_active boolean:=false;
  next_action_id uuid; next_revision uuid:=gen_random_uuid(); server_now timestamptz;
  affected_tasks uuid[]:=ARRAY[]::uuid[]; old_tasks jsonb:='[]'::jsonb;
  response_value jsonb;
  uuid_pattern text:='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
BEGIN
  IF actor_id IS NULL OR actor_role IS NULL OR actor_role NOT IN ('sales','admin') THEN
    RAISE EXCEPTION 'CRM_LIFECYCLE_FORBIDDEN';
  END IF;
  SELECT central_intake_enabled AND lead_work_enabled AND lead_lifecycle_enabled INTO enabled
    FROM public.crm_settings WHERE id FOR SHARE;
  IF enabled IS DISTINCT FROM true THEN RAISE EXCEPTION 'CRM_LIFECYCLE_SETUP_REQUIRED'; END IF;
  IF p_request_id IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object'
    OR octet_length(p_payload::text)>16384 THEN RAISE EXCEPTION 'CRM_LIFECYCLE_INVALID_INPUT'; END IF;
  IF NOT (p_payload ?& ARRAY['command','customerId','interestId','expectedRevision','expectedActionId','reason'])
    OR jsonb_typeof(p_payload->'command') IS DISTINCT FROM 'string'
    OR (p_payload->>'command') NOT IN ('reassign_owner','close_lost') THEN
    RAISE EXCEPTION 'CRM_LIFECYCLE_INVALID_INPUT';
  END IF;
  command_name:=p_payload->>'command';
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN (
      'command','customerId','interestId','expectedRevision','expectedActionId','reason','newOwnerUserId'))
    OR (command_name='close_lost' AND p_payload ? 'newOwnerUserId')
    OR (command_name='reassign_owner' AND NOT (p_payload ? 'newOwnerUserId')) THEN
    RAISE EXCEPTION 'CRM_LIFECYCLE_INVALID_INPUT';
  END IF;
  IF jsonb_typeof(p_payload->'customerId') IS DISTINCT FROM 'string'
    OR length(p_payload->>'customerId')<>36 OR (p_payload->>'customerId') !~ uuid_pattern
    OR jsonb_typeof(p_payload->'expectedRevision') IS DISTINCT FROM 'string'
    OR length(p_payload->>'expectedRevision')<>36 OR (p_payload->>'expectedRevision') !~ uuid_pattern
    OR jsonb_typeof(p_payload->'interestId') NOT IN ('string','null')
    OR (jsonb_typeof(p_payload->'interestId')='string'
      AND (length(p_payload->>'interestId')<>36 OR (p_payload->>'interestId') !~ uuid_pattern))
    OR jsonb_typeof(p_payload->'expectedActionId') NOT IN ('string','null')
    OR (jsonb_typeof(p_payload->'expectedActionId')='string'
      AND (length(p_payload->>'expectedActionId')<>36 OR (p_payload->>'expectedActionId') !~ uuid_pattern))
    OR jsonb_typeof(p_payload->'reason') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'CRM_LIFECYCLE_INVALID_INPUT';
  END IF;
  IF command_name='reassign_owner' THEN
    IF jsonb_typeof(p_payload->'newOwnerUserId') IS DISTINCT FROM 'string'
      OR length(p_payload->>'newOwnerUserId')<>36 OR (p_payload->>'newOwnerUserId') !~ uuid_pattern THEN
      RAISE EXCEPTION 'CRM_LIFECYCLE_INVALID_INPUT';
    END IF;
    new_owner:=(p_payload->>'newOwnerUserId')::uuid;
  END IF;
  -- Only translate the text-validator error, before any mutation. Never swallow a
  -- later transaction failure or record a receipt for a partially applied command.
  BEGIN
    reason_value:=sales_private.crm_work_text(p_payload->>'reason',1000);
  EXCEPTION WHEN raise_exception THEN
    RAISE EXCEPTION 'CRM_LIFECYCLE_INVALID_INPUT';
  END;
  customer_id_value:=(p_payload->>'customerId')::uuid;
  interest_id_value:=(p_payload->>'interestId')::uuid;
  expected_revision:=(p_payload->>'expectedRevision')::uuid;
  expected_action:=(p_payload->>'expectedActionId')::uuid;

  -- SAME lock order and receipt namespace as 04: settings -> request -> customer
  -- -> selected interest -> ordered role rows -> action -> ordered SLA tasks.
  -- Every future interest-create/booking/reopen/merge command MUST lock customer
  -- first too. Broad legacy writes must be cut off before enabling this feature.
  PERFORM pg_advisory_xact_lock(hashtextextended('lead-work:'||actor_id::text||':'||p_request_id::text,0));
  SELECT * INTO customer_row FROM public.sales_customers WHERE id=customer_id_value FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CRM_LIFECYCLE_NOT_FOUND'; END IF;
  scope_owner:=customer_row.owner_user_id;
  scope_revision:=customer_row.lifecycle_revision;
  scope_status:=customer_row.intake_status;
  IF interest_id_value IS NOT NULL THEN
    SELECT * INTO interest_row FROM public.lead_project_interests
      WHERE id=interest_id_value AND customer_id=customer_id_value FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'CRM_LIFECYCLE_NOT_FOUND'; END IF;
    scope_owner:=interest_row.owner_user_id;
    scope_revision:=interest_row.lifecycle_revision;
    scope_status:=interest_row.engagement_status;
  END IF;
  -- Derive authority only from rows actually locked by this ordered scan. A role
  -- inserted after the scan must not become an unlocked active actor/target.
  actor_role:=NULL;
  FOR role_row IN SELECT * FROM sales_private.crm_user_roles
    WHERE user_id IN (actor_id,scope_owner,new_owner) ORDER BY user_id FOR SHARE
  LOOP
    IF role_row.user_id=actor_id AND role_row.is_active THEN
      actor_role:=role_row.role; actor_name:=role_row.display_name;
    END IF;
    IF role_row.user_id=new_owner THEN
      target_active:=role_row.role='sales' AND role_row.is_active;
    END IF;
  END LOOP;
  IF actor_role IS NULL OR actor_role NOT IN ('sales','admin')
    OR (command_name='reassign_owner' AND actor_role<>'admin')
    OR (command_name='close_lost' AND actor_role='sales' AND actor_id<>scope_owner) THEN
    RAISE EXCEPTION 'CRM_LIFECYCLE_FORBIDDEN';
  END IF;
  -- Authorization first; replay before state/version checks so a successful close
  -- or transfer can be recovered with exactly the same payload. Admin may rescue
  -- work whose OLD owner is inactive. The NEW owner must be active for new writes.
  SELECT * INTO request_row FROM sales_private.lead_work_command_requests
    WHERE actor_user_id=actor_id AND request_id=p_request_id;
  IF FOUND THEN
    IF request_row.request_payload IS DISTINCT FROM p_payload THEN
      RAISE EXCEPTION 'CRM_LIFECYCLE_IDEMPOTENCY_CONFLICT';
    END IF;
    RETURN request_row.response || jsonb_build_object('replayed',true);
  END IF;
  IF customer_row.merged_into_customer_id IS NOT NULL OR scope_status='lost' THEN
    RAISE EXCEPTION 'CRM_LIFECYCLE_SCOPE_CLOSED';
  END IF;
  IF scope_revision IS DISTINCT FROM expected_revision THEN RAISE EXCEPTION 'CRM_LIFECYCLE_STALE_SCOPE'; END IF;
  SELECT * INTO prior_action FROM public.crm_next_actions
    WHERE customer_id=customer_id_value AND project_interest_id IS NOT DISTINCT FROM interest_id_value
      AND status='open' FOR UPDATE;
  IF prior_action.id IS DISTINCT FROM expected_action THEN RAISE EXCEPTION 'CRM_LIFECYCLE_STALE_ACTION'; END IF;
  IF command_name='reassign_owner' THEN
    IF new_owner=scope_owner THEN RAISE EXCEPTION 'CRM_LIFECYCLE_UNCHANGED_OWNER'; END IF;
    IF target_active IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'CRM_LIFECYCLE_INACTIVE_TARGET';
    END IF;
  ELSE
    -- Lost is pre-booking ONLY, including cancelled/finished booking history.
    -- An unmapped legacy sale for this source customer also requires review first.
    IF EXISTS (SELECT 1 FROM public.sales s
      JOIN public.lead_project_interests i ON i.id=s.project_interest_id
      WHERE i.customer_id=customer_id_value AND (interest_id_value IS NULL OR i.id=interest_id_value))
      OR EXISTS (SELECT 1 FROM public.sales s
        WHERE s.lead_id=customer_row.legacy_source_lead_id AND s.project_interest_id IS NULL) THEN
      RAISE EXCEPTION 'CRM_LIFECYCLE_BOOKING_HISTORY_EXISTS';
    END IF;
    -- Closing intake is NOT closing all projects. Do not hide an active interest.
    IF interest_id_value IS NULL AND EXISTS (SELECT 1 FROM public.lead_project_interests
      WHERE customer_id=customer_id_value AND engagement_status<>'lost') THEN
      RAISE EXCEPTION 'CRM_LIFECYCLE_OPEN_INTERESTS';
    END IF;
  END IF;
  -- Lock all affected open obligations before sampling authoritative time.
  FOR task_row IN SELECT * FROM public.crm_sla_tasks
    WHERE customer_id=customer_id_value AND project_interest_id IS NOT DISTINCT FROM interest_id_value
      AND status='open' ORDER BY id FOR UPDATE
  LOOP
    affected_tasks:=array_append(affected_tasks,task_row.id);
    -- No leave/HR details or unrestricted evaluation_snapshot in the public audit.
    old_tasks:=old_tasks || jsonb_build_array(jsonb_build_object('id',task_row.id,
      'ownerUserId',task_row.owner_user_id,'serviceDueAt',task_row.service_due_at,
      'staffDueAt',task_row.staff_due_at,'accountabilityState',task_row.accountability_state));
  END LOOP;
  server_now:=clock_timestamp();

  IF prior_action.id IS NOT NULL THEN
    UPDATE public.crm_next_actions SET
      status=CASE WHEN command_name='reassign_owner' THEN 'superseded' ELSE 'cancelled' END,
      closed_at=server_now,closed_by_user_id=actor_id,close_reason=reason_value WHERE id=prior_action.id;
    IF command_name='reassign_owner' THEN
      next_action_id:=gen_random_uuid();
      INSERT INTO public.crm_next_actions (
        id,customer_id,project_interest_id,owner_user_id,action_text,due_at,plan_started_at,
        previous_action_id,source_activity_id,recorded_by_user_id,recorded_at
      ) VALUES (
        next_action_id,customer_id_value,interest_id_value,new_owner,prior_action.action_text,
        prior_action.due_at,prior_action.plan_started_at,prior_action.id,prior_action.source_activity_id,actor_id,server_now
      );
    END IF;
  END IF;
  IF interest_id_value IS NULL THEN
    UPDATE public.sales_customers SET
      owner_user_id=CASE WHEN command_name='reassign_owner' THEN new_owner ELSE owner_user_id END,
      owner_assigned_at=CASE WHEN command_name='reassign_owner' THEN server_now ELSE owner_assigned_at END,
      intake_status=CASE WHEN command_name='close_lost' THEN 'lost' ELSE intake_status END,
      lifecycle_revision=next_revision,updated_at=server_now WHERE id=customer_id_value;
  ELSE
    UPDATE public.lead_project_interests SET
      owner_user_id=CASE WHEN command_name='reassign_owner' THEN new_owner ELSE owner_user_id END,
      owner_assigned_at=CASE WHEN command_name='reassign_owner' THEN server_now ELSE owner_assigned_at END,
      engagement_status=CASE WHEN command_name='close_lost' THEN 'lost' ELSE engagement_status END,
      lifecycle_revision=next_revision,updated_at=server_now
      WHERE id=interest_id_value AND customer_id=customer_id_value;
  END IF;
  IF command_name='reassign_owner' THEN
    -- Keep service clock/source/status. New-owner staff fairness requires separate
    -- policy/calendar review: do not inherit the old owner's deadline or score.
    UPDATE public.crm_sla_tasks SET owner_user_id=new_owner,staff_due_at=NULL,notify_at=NULL,
      accountability_state='needs_schedule',
      evaluation_snapshot=evaluation_snapshot || jsonb_build_object('lifecycleReview',jsonb_build_object(
        'state','owner_change_pending_review','revision',next_revision,'changedAt',server_now))
      WHERE id=ANY(affected_tasks);
    INSERT INTO public.crm_sla_exceptions (task_id,exception_type,reason,recorded_by_user_id,created_at)
      SELECT task_id,'owner_change',reason_value,actor_id,server_now FROM unnest(affected_tasks) AS t(task_id);
  ELSE
    -- Cancellation is not contact success/done. Retain deadlines and any existing
    -- lateness; reporting must include cancelled obligations and their close time.
    UPDATE public.crm_sla_tasks SET status='cancelled',cancelled_at=server_now,
      cancelled_by_user_id=actor_id,cancellation_reason=reason_value WHERE id=ANY(affected_tasks);
  END IF;
  UPDATE public.crm_notifications SET withdrawn_at=server_now,withdrawal_reason=reason_value
    WHERE task_id=ANY(affected_tasks) AND withdrawn_at IS NULL;
  INSERT INTO public.crm_audit_events (
    customer_id,entity_type,entity_id,event_type,reason_text,actor_user_id,actor_kind,
    actor_name_snapshot,old_values,new_values,occurred_at,recorded_at
  ) VALUES (
    customer_id_value,CASE WHEN interest_id_value IS NULL THEN 'sales_customer' ELSE 'lead_project_interest' END,
    COALESCE(interest_id_value,customer_id_value),command_name,reason_value,actor_id,'staff',actor_name,
    jsonb_build_object('revision',scope_revision,'ownerUserId',scope_owner,'status',scope_status,
      'nextAction',CASE WHEN prior_action.id IS NULL THEN NULL ELSE to_jsonb(prior_action) END,'openSlaTasks',old_tasks),
    jsonb_build_object('revision',next_revision,'interestId',interest_id_value,
      'ownerUserId',CASE WHEN command_name='reassign_owner' THEN new_owner ELSE scope_owner END,
      'status',CASE WHEN command_name='close_lost' THEN 'lost' ELSE scope_status END,
      'nextActionId',next_action_id,'affectedSlaTaskIds',to_jsonb(affected_tasks),
      'priorWasOverdue',CASE WHEN prior_action.id IS NULL THEN NULL ELSE prior_action.due_at<server_now END),
    server_now,server_now
  );
  response_value:=jsonb_build_object('revision',next_revision,'nextActionId',next_action_id,'replayed',false);
  INSERT INTO sales_private.lead_work_command_requests (actor_user_id,request_id,request_payload,response,created_at)
    VALUES (actor_id,p_request_id,p_payload,response_value,server_now);
  RETURN response_value;
END;
$lifecycle$;
REVOKE ALL ON FUNCTION public.crm_v2_change_lead_lifecycle(uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_v2_change_lead_lifecycle(uuid,jsonb) TO authenticated;

-- No scheduler, SQL execution, legacy sync, sales/plot mutation,
-- reopening, merging, booking cancellation or transfer confirmation in this draft.
-- Pending uncertain commands remain pending: ownership changes never prove a prior
-- write failed. Request reconciliation and lifecycle UI remain separate work.

-- Reviewed source: sql/sales/18_booking_history_draft.sql
-- LF-normalized SHA256: e9b146e7ce9ad88eda683193640ed55ffe81bb03c9fd2e8b7da74ceead72f563
-- SALES V2 CENTRAL BOOKING/HISTORY -- DESIGN ONLY, 2026-09-23.
-- Depends on the guarded base + 04/05 and reviewed legacy sales money columns.
-- NEVER RUN ON SUPABASE. No backfill, live flag changes, discount approval or deploy.
-- A customer stays in the central workspace; sales rows are project/plot bookings.


ALTER TABLE public.crm_settings
  ADD COLUMN booking_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN booking_cutover_reviewed boolean NOT NULL DEFAULT false;
ALTER TABLE public.sales
  ADD COLUMN booking_revision uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN booking_visit_id uuid,
  ADD CONSTRAINT sales_booking_visit_interest_fk FOREIGN KEY (booking_visit_id,project_interest_id)
    REFERENCES public.lead_visits(id,project_interest_id) ON DELETE RESTRICT;

CREATE TABLE sales_private.booking_command_requests (
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL,
  request_payload jsonb NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(actor_user_id,request_id)
);
-- A private, transaction-local write capability. A caller-controlled GUC would
-- be spoofable and is deliberately NOT used. Only reviewed definer commands can
-- create the permit. Permit creation, sale change and removal are one transaction.
CREATE TABLE sales_private.booking_write_permits (
  transaction_id bigint PRIMARY KEY,
  backend_pid integer NOT NULL
);
ALTER TABLE sales_private.booking_command_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_private.booking_write_permits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sales_private.booking_command_requests,sales_private.booking_write_permits
  FROM PUBLIC,anon,authenticated;

CREATE FUNCTION sales_private.crm_booking_protect_sale()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $protect$
DECLARE linked boolean;
BEGIN
  linked:=CASE WHEN TG_OP='INSERT' THEN NEW.project_interest_id IS NOT NULL
    WHEN TG_OP='DELETE' THEN OLD.project_interest_id IS NOT NULL
    ELSE OLD.project_interest_id IS NOT NULL OR NEW.project_interest_id IS NOT NULL END;
  IF NOT linked THEN RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END IF;
  IF NOT EXISTS(SELECT 1 FROM sales_private.booking_write_permits
    WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid()) THEN
    RAISE EXCEPTION 'CRM_BOOKING_FORBIDDEN';
  END IF;
  IF TG_OP='DELETE' OR (TG_OP='UPDATE' AND OLD.crm_stage='cancelled' AND to_jsonb(OLD) IS DISTINCT FROM to_jsonb(NEW)) THEN
    RAISE EXCEPTION 'CRM_BOOKING_CONFLICT';
  END IF;
  IF TG_OP='UPDATE' AND (NEW.id IS DISTINCT FROM OLD.id
    OR NEW.project_interest_id IS DISTINCT FROM OLD.project_interest_id
    OR NEW.booking_round IS DISTINCT FROM OLD.booking_round
    OR NEW.previous_sale_id IS DISTINCT FROM OLD.previous_sale_id) THEN
    RAISE EXCEPTION 'CRM_BOOKING_CONFLICT';
  END IF;
  RETURN NEW;
END;
$protect$;
REVOKE ALL ON FUNCTION sales_private.crm_booking_protect_sale() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER crm_booking_protect_sale BEFORE INSERT OR UPDATE OR DELETE ON public.sales
  FOR EACH ROW EXECUTE FUNCTION sales_private.crm_booking_protect_sale();

CREATE FUNCTION sales_private.crm_booking_uuid(value jsonb,nullable boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog
AS $uuid$
BEGIN
  IF nullable AND value='null'::jsonb THEN RETURN NULL; END IF;
  IF jsonb_typeof(value) IS DISTINCT FROM 'string' OR (value#>>'{}') !~*
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'CRM_BOOKING_INVALID_INPUT';
  END IF;
  RETURN (value#>>'{}')::uuid;
END;
$uuid$;
REVOKE ALL ON FUNCTION sales_private.crm_booking_uuid(jsonb,boolean) FROM PUBLIC,anon,authenticated;

-- Optional external history evidence. Native installations have neither the
-- external columns nor schema; do not reference either at SQL parse time.
-- This private INVOKER helper is reached through the role-checked read RPCs only.
CREATE OR REPLACE FUNCTION sales_private.crm_booking_imported_history(p_sale jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog
AS $imported$
DECLARE evidence jsonb;
BEGIN
  IF p_sale->>'external_booking_id' IS NULL AND p_sale->>'external_source_stage' IS NULL THEN RETURN NULL; END IF;
  IF p_sale->>'external_booking_id' IS NULL OR p_sale->>'external_source_stage' IS NULL
    OR to_regprocedure('crm_external_private.sale_history(jsonb)') IS NULL THEN
    RAISE EXCEPTION 'CRM_BOOKING_SETUP_REQUIRED';
  END IF;
  EXECUTE 'SELECT crm_external_private.sale_history($1)' INTO evidence USING p_sale;
  IF evidence IS NULL THEN RAISE EXCEPTION 'CRM_BOOKING_SETUP_REQUIRED'; END IF;
  RETURN evidence;
END;
$imported$;
DO $imported_acl$
DECLARE grantee_name text;
BEGIN
  FOR grantee_name IN SELECT DISTINCT CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(a.grantee)) END
    FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    WHERE p.oid='sales_private.crm_booking_imported_history(jsonb)'::regprocedure AND a.grantee<>p.proowner LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION sales_private.crm_booking_imported_history(jsonb) FROM %s',grantee_name);
  END LOOP;
END;
$imported_acl$;

-- Optional reviewed external writer; native-only installs have no such schema.
CREATE FUNCTION sales_private.crm_booking_external_ready()
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE ready boolean:=false;
BEGIN
  IF to_regprocedure('crm_external_private.booking_writer_ready()') IS NOT NULL THEN
    EXECUTE 'SELECT crm_external_private.booking_writer_ready()' INTO ready;
  END IF;
  RETURN ready;
END;
$$;
REVOKE ALL ON FUNCTION sales_private.crm_booking_external_ready() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.crm_v2_booking_capabilities()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog
AS $capabilities$
  SELECT jsonb_build_object('contract_version','booking_history_v1','enabled',
    COALESCE(public.crm_v2_role() IN ('sales','admin','owner'),false) AND COALESCE((
      SELECT central_intake_enabled AND lead_work_enabled AND lead_lifecycle_enabled
        AND booking_enabled AND booking_cutover_reviewed FROM public.crm_settings WHERE id),false));
$capabilities$;
REVOKE ALL ON FUNCTION public.crm_v2_booking_capabilities() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_v2_booking_capabilities() TO authenticated;

CREATE FUNCTION public.crm_v2_booking_search(p_query text,p_page integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog
AS $search$
DECLARE result jsonb; more boolean; search_value text;
BEGIN
  IF auth.uid() IS NULL OR COALESCE(public.crm_v2_role(),'') NOT IN ('sales','admin','owner') THEN
    RAISE EXCEPTION 'CRM_BOOKING_FORBIDDEN';
  END IF;
  IF NOT (public.crm_v2_booking_capabilities()->>'enabled')::boolean THEN RAISE EXCEPTION 'CRM_BOOKING_SETUP_REQUIRED'; END IF;
  IF p_query IS NULL OR length(btrim(p_query)) NOT BETWEEN 2 AND 200
    OR p_page IS NULL OR p_page NOT BETWEEN 0 AND 100000 THEN RAISE EXCEPTION 'CRM_BOOKING_INVALID_INPUT'; END IF;
  BEGIN search_value:=sales_private.crm_work_text(p_query,200);
  EXCEPTION WHEN raise_exception THEN RAISE EXCEPTION 'CRM_BOOKING_INVALID_INPUT'; END;
  IF length(search_value)<2 THEN RAISE EXCEPTION 'CRM_BOOKING_INVALID_INPUT'; END IF;
  -- strpos implements literal substring matching: %, _ and backslash are not wildcards.
  WITH rows AS (
    SELECT id,customer_name,phone FROM public.sales_customers
      WHERE merged_into_customer_id IS NULL AND (strpos(lower(customer_name),lower(search_value))>0
        OR strpos(COALESCE(phone,''),search_value)>0)
      ORDER BY customer_name,id LIMIT 26 OFFSET p_page*25
  ), numbered AS (SELECT *,row_number() OVER(ORDER BY customer_name,id) rn FROM rows)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'name',customer_name,'phone',phone)
    ORDER BY customer_name,id) FILTER(WHERE rn<=25),'[]'::jsonb),count(*)>25 INTO result,more FROM numbered;
  RETURN jsonb_build_object('customers',result,'page',p_page,'hasMore',more);
END;
$search$;
REVOKE ALL ON FUNCTION public.crm_v2_booking_search(text,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_v2_booking_search(text,integer) TO authenticated;

CREATE FUNCTION public.crm_v2_booking_context(p_customer_id uuid DEFAULT NULL,p_page integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog
AS $context$
DECLARE
  actor_id uuid:=auth.uid(); actor_role text:=public.crm_v2_role();
  customer_row public.sales_customers%ROWTYPE;
  customer_json jsonb:='null'::jsonb; interests_json jsonb:='[]'::jsonb; sales_json jsonb:='[]'::jsonb;
  more boolean:=false;
BEGIN
  IF actor_id IS NULL OR COALESCE(actor_role,'') NOT IN ('sales','admin','owner') THEN RAISE EXCEPTION 'CRM_BOOKING_FORBIDDEN'; END IF;
  IF NOT (public.crm_v2_booking_capabilities()->>'enabled')::boolean THEN RAISE EXCEPTION 'CRM_BOOKING_SETUP_REQUIRED'; END IF;
  IF p_page IS NULL OR p_page NOT BETWEEN 0 AND 100000 THEN RAISE EXCEPTION 'CRM_BOOKING_INVALID_INPUT'; END IF;
  IF p_customer_id IS NOT NULL THEN
    SELECT * INTO customer_row FROM public.sales_customers WHERE id=p_customer_id AND merged_into_customer_id IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'CRM_BOOKING_NOT_FOUND'; END IF;
    IF EXISTS(SELECT 1 FROM public.sales WHERE lead_id=customer_row.legacy_source_lead_id AND project_interest_id IS NULL) THEN
      RAISE EXCEPTION 'CRM_BOOKING_SETUP_REQUIRED';
    END IF;
    -- Validate every related row before pagination, including imported rows
    -- whose round number was never recorded. Never manufacture round one.
    IF EXISTS(SELECT 1 FROM public.sales s JOIN public.lead_project_interests i ON i.id=s.project_interest_id
      WHERE i.customer_id=p_customer_id AND (s.booking_round IS NULL
        OR to_jsonb(s)->>'external_booking_id' IS NOT NULL OR to_jsonb(s)->>'external_source_stage' IS NOT NULL)
        AND sales_private.crm_booking_imported_history(to_jsonb(s)) IS NULL) THEN
      RAISE EXCEPTION 'CRM_BOOKING_SETUP_REQUIRED';
    END IF;
    customer_json:=jsonb_build_object('id',customer_row.id,'name',customer_row.customer_name,'phone',customer_row.phone,
      'ownerUserId',customer_row.owner_user_id,'revision',customer_row.lifecycle_revision);
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id',i.id,'projectName',i.project_name,'ownerUserId',i.owner_user_id,
      'revision',i.lifecycle_revision,'status',i.engagement_status,
      'currentActionId',(SELECT a.id FROM public.crm_next_actions a WHERE a.project_interest_id=i.id AND a.status='open'),
      'canEdit',(actor_role='admin' OR (actor_role='sales' AND actor_id=i.owner_user_id))
        AND i.engagement_status<>'lost' AND EXISTS(SELECT 1 FROM sales_private.crm_user_roles r WHERE r.user_id=i.owner_user_id AND r.role='sales' AND r.is_active),
      'visits',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',v.id,'checkedInAt',v.checked_in_at) ORDER BY v.checked_in_at DESC,v.id)
        FROM (SELECT id,checked_in_at FROM public.lead_visits WHERE project_interest_id=i.id AND status='completed'
          AND completed_at<=statement_timestamp() AND completion_evidence_state='submitted'
          ORDER BY checked_in_at DESC,id LIMIT 50) v),'[]'::jsonb)) ORDER BY i.project_name,i.id),'[]'::jsonb)
      INTO interests_json FROM public.lead_project_interests i WHERE i.customer_id=p_customer_id;
    WITH rows AS (
      SELECT s.*,i.project_name,i.owner_user_id,i.engagement_status FROM public.sales s
        JOIN public.lead_project_interests i ON i.id=s.project_interest_id WHERE i.customer_id=p_customer_id
        ORDER BY s.booked_at DESC NULLS LAST,s.id LIMIT 51 OFFSET p_page*50
    ), numbered AS(SELECT *,row_number() OVER(ORDER BY booked_at DESC NULLS LAST,id) rn FROM rows)
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id',s.id,'interestId',s.project_interest_id,'projectName',s.project_name,
      'plotId',s.plot_id,'stage',s.crm_stage,'revision',s.booking_revision,'bookingRound',s.booking_round,
      'importedHistory',sales_private.crm_booking_imported_history(to_jsonb(s)),
      'previousSaleId',s.previous_sale_id,'bookedAt',s.booked_at,'cancelledAt',s.cancelled_at,
      'cancellationReason',s.cancellation_reason,'cancellationCategory',s.cancellation_category,
      'listPrice',s.list_price,'discountAmount',s.discount_amount,'salePrice',s.sale_price,'depositAmount',s.booking_amount,'paymentMethod',s.payment_method,
      'canCancel',(actor_role='admin' OR (actor_role='sales' AND actor_id=s.owner_user_id))
        AND (sales_private.crm_booking_imported_history(to_jsonb(s)) IS NULL OR sales_private.crm_booking_external_ready())
        AND EXISTS(SELECT 1 FROM sales_private.crm_user_roles r WHERE r.user_id=s.owner_user_id AND r.role='sales' AND r.is_active)
        AND s.crm_stage IN ('booked','contracted','downpayment','document_prep','loan_submitted','loan_rejected','loan_approved','transfer_pending'),
      'canResume',(actor_role='admin' OR (actor_role='sales' AND actor_id=s.owner_user_id)) AND s.crm_stage='cancelled'
        AND NOT sales_private.crm_booking_external_ready()
        AND sales_private.crm_booking_imported_history(to_jsonb(s)) IS NULL
        AND EXISTS(SELECT 1 FROM sales_private.crm_user_roles r WHERE r.user_id=s.owner_user_id AND r.role='sales' AND r.is_active))
      ORDER BY s.booked_at DESC NULLS LAST,s.id) FILTER(WHERE rn<=50),'[]'::jsonb),count(*)>50 INTO sales_json,more FROM numbered s;
  END IF;
  RETURN jsonb_build_object('actor',jsonb_build_object('userId',actor_id,'role',actor_role),'customer',customer_json,
    'projects',COALESCE((SELECT jsonb_agg(jsonb_build_object('name',name) ORDER BY name) FROM public.projects WHERE is_closed IS NOT TRUE),'[]'::jsonb),
    'salesOwners',COALESCE((SELECT jsonb_agg(jsonb_build_object('userId',user_id,'displayName',COALESCE(NULLIF(btrim(display_name),''),user_id::text)) ORDER BY display_name,user_id)
      FROM sales_private.crm_user_roles WHERE role='sales' AND is_active),'[]'::jsonb),
    'interests',interests_json,'sales',sales_json,'page',p_page,'hasMore',more);
END;
$context$;
REVOKE ALL ON FUNCTION public.crm_v2_booking_context(uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_v2_booking_context(uuid,integer) TO authenticated;

CREATE FUNCTION public.crm_v2_booking_command(p_request_id uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $command$
DECLARE
  actor_id uuid:=auth.uid(); actor_role text:=public.crm_v2_role(); actor_name text;
  command_name text; reason_value text; key_name text; allowed_keys text[]; enabled boolean;
  customer_id_value uuid; sale_id_value uuid; expected_sale uuid; expected_interest uuid; expected_action uuid;
  previous_id uuid; visit_id_value uuid; project_value text; plot_value text; owner_id uuid;
  owner_active boolean:=false; actor_active boolean:=false; role_row sales_private.crm_user_roles%ROWTYPE;
  customer_row public.sales_customers%ROWTYPE; interest_row public.lead_project_interests%ROWTYPE;
  sale_row public.sales%ROWTYPE; previous_row public.sales%ROWTYPE;
  request_row sales_private.booking_command_requests%ROWTYPE;
  new_customer jsonb; create_payload jsonb; created jsonb; work_result jsonb; response_value jsonb;
  list_satang bigint; discount_satang bigint; deposit_satang bigint; next_round integer;
  next_action uuid; server_now timestamptz; old_values jsonb; old_interest jsonb;
BEGIN
  IF actor_id IS NULL OR COALESCE(actor_role,'') NOT IN ('sales','admin') THEN RAISE EXCEPTION 'CRM_BOOKING_FORBIDDEN'; END IF;
  SELECT central_intake_enabled AND lead_work_enabled AND lead_lifecycle_enabled AND booking_enabled AND booking_cutover_reviewed
    INTO enabled FROM public.crm_settings WHERE id FOR SHARE;
  IF enabled IS DISTINCT FROM true THEN RAISE EXCEPTION 'CRM_BOOKING_SETUP_REQUIRED'; END IF;
  IF p_request_id IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR octet_length(p_payload::text)>16384
    OR jsonb_typeof(p_payload->'command') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'CRM_BOOKING_INVALID_INPUT'; END IF;
  command_name:=p_payload->>'command';
  IF command_name='resume_follow_up' AND sales_private.crm_booking_external_ready() THEN
    RAISE EXCEPTION 'CRM_BOOKING_FORBIDDEN';
  END IF;
  allowed_keys:=CASE command_name
    WHEN 'book' THEN ARRAY['command','reason','customerId','newCustomer','projectName','expectedInterestRevision','plotId','paymentMethod','bookingRoute','visitId','listPriceSatang','discountSatang','depositSatang','previousSaleId']
    WHEN 'cancel' THEN ARRAY['command','reason','customerId','saleId','expectedSaleRevision','cancellationCategory']
    WHEN 'resume_follow_up' THEN ARRAY['command','reason','customerId','saleId','expectedSaleRevision','expectedInterestRevision','expectedActionId','nextAction']
    ELSE NULL END;
  IF allowed_keys IS NULL OR NOT (p_payload ?& allowed_keys)
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE NOT(k=ANY(allowed_keys)))
    OR jsonb_typeof(p_payload->'reason') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'CRM_BOOKING_INVALID_INPUT'; END IF;
  BEGIN reason_value:=sales_private.crm_work_text(p_payload->>'reason',1000);
  EXCEPTION WHEN raise_exception THEN RAISE EXCEPTION 'CRM_BOOKING_INVALID_INPUT'; END;
  customer_id_value:=sales_private.crm_booking_uuid(p_payload->'customerId',command_name='book');
  IF command_name='book' THEN
    expected_interest:=sales_private.crm_booking_uuid(p_payload->'expectedInterestRevision',true);
    previous_id:=sales_private.crm_booking_uuid(p_payload->'previousSaleId',true);
    visit_id_value:=sales_private.crm_booking_uuid(p_payload->'visitId',true);
    IF jsonb_typeof(p_payload->'projectName') IS DISTINCT FROM 'string'
      OR jsonb_typeof(p_payload->'plotId') IS DISTINCT FROM 'string'
      OR jsonb_typeof(p_payload->'paymentMethod') IS DISTINCT FROM 'string' OR p_payload->>'paymentMethod' NOT IN ('cash','mortgage')
      OR jsonb_typeof(p_payload->'bookingRoute') IS DISTINCT FROM 'string' OR p_payload->>'bookingRoute' NOT IN ('visited','without_visit')
      OR ((p_payload->>'bookingRoute'='visited') IS DISTINCT FROM (visit_id_value IS NOT NULL)) THEN RAISE EXCEPTION 'CRM_BOOKING_INVALID_INPUT'; END IF;
    BEGIN project_value:=sales_private.crm_work_text(p_payload->>'projectName',200); plot_value:=sales_private.crm_work_text(p_payload->>'plotId',200);
    EXCEPTION WHEN raise_exception THEN RAISE EXCEPTION 'CRM_BOOKING_INVALID_INPUT'; END;
    FOREACH key_name IN ARRAY ARRAY['listPriceSatang','discountSatang','depositSatang'] LOOP
      IF jsonb_typeof(p_payload->key_name) IS DISTINCT FROM 'number' OR (p_payload->>key_name) !~ '^[0-9]{1,11}$' THEN
        RAISE EXCEPTION 'CRM_BOOKING_INVALID_INPUT';
      END IF;
    END LOOP;
    list_satang:=(p_payload->>'listPriceSatang')::bigint; discount_satang:=(p_payload->>'discountSatang')::bigint; deposit_satang:=(p_payload->>'depositSatang')::bigint;
    IF list_satang<=discount_satang OR deposit_satang>list_satang-discount_satang THEN RAISE EXCEPTION 'CRM_BOOKING_INVALID_INPUT'; END IF;
    new_customer:=p_payload->'newCustomer';
    IF customer_id_value IS NOT NULL THEN
      IF new_customer<>'null'::jsonb THEN RAISE EXCEPTION 'CRM_BOOKING_INVALID_INPUT'; END IF;
    ELSE
      IF jsonb_typeof(new_customer) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'CRM_BOOKING_INVALID_INPUT'; END IF;
      IF NOT(new_customer ?& ARRAY['name','phone','channel','notes','assignedSalesUserId'])
        OR EXISTS(SELECT 1 FROM jsonb_object_keys(new_customer) k WHERE k NOT IN ('name','phone','channel','notes','assignedSalesUserId')) THEN RAISE EXCEPTION 'CRM_BOOKING_INVALID_INPUT'; END IF;
      FOREACH key_name IN ARRAY ARRAY['name','phone','channel','notes'] LOOP
        IF jsonb_typeof(new_customer->key_name) IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'CRM_BOOKING_INVALID_INPUT'; END IF;
      END LOOP;
      owner_id:=sales_private.crm_booking_uuid(new_customer->'assignedSalesUserId',actor_role='sales');
      IF actor_role='sales' AND owner_id IS NOT NULL THEN RAISE EXCEPTION 'CRM_BOOKING_FORBIDDEN'; END IF;
      IF expected_interest IS NOT NULL OR previous_id IS NOT NULL OR visit_id_value IS NOT NULL THEN RAISE EXCEPTION 'CRM_BOOKING_INVALID_INPUT'; END IF;
      create_payload:=(new_customer-'assignedSalesUserId')||jsonb_build_object('interests','[]'::jsonb);
      IF actor_role='admin' THEN create_payload:=create_payload||jsonb_build_object('assignedSalesUserId',owner_id); END IF;
    END IF;
  ELSE
    sale_id_value:=sales_private.crm_booking_uuid(p_payload->'saleId');
    expected_sale:=sales_private.crm_booking_uuid(p_payload->'expectedSaleRevision');
    IF command_name='cancel' THEN
      IF jsonb_typeof(p_payload->'cancellationCategory') IS DISTINCT FROM 'string'
        OR p_payload->>'cancellationCategory' NOT IN ('booking_cancelled','downpayment_abandoned','final_loan_rejection','other') THEN RAISE EXCEPTION 'CRM_BOOKING_INVALID_INPUT'; END IF;
    ELSE
      expected_interest:=sales_private.crm_booking_uuid(p_payload->'expectedInterestRevision');
      expected_action:=sales_private.crm_booking_uuid(p_payload->'expectedActionId',true);
      IF jsonb_typeof(p_payload->'nextAction') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'CRM_BOOKING_INVALID_INPUT'; END IF;
      IF NOT((p_payload->'nextAction') ?& ARRAY['action','dueAt'])
        OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload->'nextAction') k WHERE k NOT IN ('action','dueAt'))
        OR jsonb_typeof(p_payload#>'{nextAction,action}') IS DISTINCT FROM 'string'
        OR jsonb_typeof(p_payload#>'{nextAction,dueAt}') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'CRM_BOOKING_INVALID_INPUT'; END IF;
    END IF;
  END IF;
  -- Serialize booking commands globally, then take the same customer/interest
  -- order used by lifecycle/work commands. No client holds a database lock.
  PERFORM pg_advisory_xact_lock(hashtextextended('crm-booking-command',0));
  SELECT * INTO request_row FROM sales_private.booking_command_requests WHERE actor_user_id=actor_id AND request_id=p_request_id;
  IF FOUND THEN customer_id_value:=(request_row.response->>'customerId')::uuid; END IF;
  IF customer_id_value IS NULL THEN
    BEGIN created:=public.crm_v2_create_customer(gen_random_uuid(),create_payload);
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM='CRM_DUPLICATE_REVIEW_REQUIRED' THEN RAISE EXCEPTION 'CRM_BOOKING_DUPLICATE_REVIEW_REQUIRED'; END IF;
      IF SQLERRM IN ('CRM_FORBIDDEN','CRM_SALES_OWNER_REQUIRED') THEN RAISE EXCEPTION 'CRM_BOOKING_FORBIDDEN'; END IF;
      RAISE EXCEPTION 'CRM_BOOKING_INVALID_INPUT';
    END;
    customer_id_value:=(created->>'customerId')::uuid;
  END IF;
  SELECT * INTO customer_row FROM public.sales_customers WHERE id=customer_id_value FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CRM_BOOKING_NOT_FOUND'; END IF;
  IF customer_row.merged_into_customer_id IS NOT NULL THEN RAISE EXCEPTION 'CRM_BOOKING_CONFLICT'; END IF;
  IF EXISTS(SELECT 1 FROM public.sales WHERE lead_id=customer_row.legacy_source_lead_id AND project_interest_id IS NULL) THEN RAISE EXCEPTION 'CRM_BOOKING_SETUP_REQUIRED'; END IF;
  IF request_row.request_id IS NOT NULL THEN
    SELECT * INTO interest_row FROM public.lead_project_interests WHERE id=(request_row.response->>'interestId')::uuid AND customer_id=customer_id_value FOR UPDATE;
  ELSIF command_name='book' THEN
    SELECT * INTO interest_row FROM public.lead_project_interests WHERE customer_id=customer_id_value AND project_name=project_value FOR UPDATE;
  ELSE
    SELECT i.* INTO interest_row FROM public.lead_project_interests i JOIN public.sales s ON s.project_interest_id=i.id
      WHERE s.id=sale_id_value AND i.customer_id=customer_id_value FOR UPDATE OF i;
    IF NOT FOUND THEN RAISE EXCEPTION 'CRM_BOOKING_NOT_FOUND'; END IF;
  END IF;
  owner_id:=COALESCE(interest_row.owner_user_id,customer_row.owner_user_id);
  FOR role_row IN SELECT * FROM sales_private.crm_user_roles WHERE user_id IN(actor_id,owner_id) ORDER BY user_id FOR SHARE LOOP
    IF role_row.user_id=actor_id AND role_row.is_active THEN actor_role:=role_row.role; actor_name:=role_row.display_name; actor_active:=true; END IF;
    IF role_row.user_id=owner_id THEN owner_active:=role_row.is_active AND role_row.role='sales'; END IF;
  END LOOP;
  IF NOT actor_active OR NOT owner_active OR actor_role NOT IN ('sales','admin') OR (actor_role='sales' AND actor_id<>owner_id) THEN RAISE EXCEPTION 'CRM_BOOKING_FORBIDDEN'; END IF;
  IF request_row.request_id IS NOT NULL THEN
    IF request_row.request_payload IS DISTINCT FROM p_payload THEN RAISE EXCEPTION 'CRM_BOOKING_IDEMPOTENCY_CONFLICT'; END IF;
    RETURN request_row.response||jsonb_build_object('replayed',true);
  END IF;
  IF command_name='book' AND (customer_row.intake_status='lost' OR interest_row.engagement_status='lost') THEN RAISE EXCEPTION 'CRM_BOOKING_CONFLICT'; END IF;
  server_now:=clock_timestamp();
  old_interest:=CASE WHEN interest_row.id IS NULL THEN NULL ELSE to_jsonb(interest_row) END;
  IF command_name='book' THEN
    PERFORM 1 FROM public.projects WHERE name=project_value AND is_closed IS NOT TRUE FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'CRM_BOOKING_NOT_FOUND'; END IF;
    IF interest_row.lifecycle_revision IS DISTINCT FROM expected_interest THEN RAISE EXCEPTION 'CRM_BOOKING_STALE_STATE'; END IF;
    IF interest_row.id IS NULL THEN
      INSERT INTO public.lead_project_interests(customer_id,project_name,owner_user_id,created_by_user_id,interest_created_at,owner_assigned_at)
        VALUES(customer_id_value,project_value,owner_id,actor_id,server_now,server_now) RETURNING * INTO interest_row;
      INSERT INTO public.crm_audit_events(customer_id,entity_type,entity_id,event_type,reason_text,actor_user_id,actor_kind,actor_name_snapshot,new_values,occurred_at,recorded_at)
        VALUES(customer_id_value,'interest',interest_row.id,'created_for_booking',reason_value,actor_id,'staff',actor_name,
          jsonb_build_object('projectName',project_value,'ownerUserId',owner_id),server_now,server_now);
    END IF;
    IF previous_id IS NOT NULL THEN
      SELECT * INTO previous_row FROM public.sales WHERE id=previous_id AND project_interest_id=interest_row.id FOR UPDATE;
      IF NOT FOUND OR previous_row.crm_stage<>'cancelled' THEN RAISE EXCEPTION 'CRM_BOOKING_CONFLICT'; END IF;
    END IF;
    IF visit_id_value IS NOT NULL THEN
      PERFORM 1 FROM public.lead_visits WHERE id=visit_id_value AND project_interest_id=interest_row.id AND status='completed'
        AND completion_evidence_state='submitted' AND completed_at<=server_now FOR SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION 'CRM_BOOKING_CONFLICT'; END IF;
    END IF;
    PERFORM 1 FROM public.plots WHERE id=plot_value AND project_name=project_value AND has_customer IS FALSE
      AND lower(btrim(COALESCE(sale_status,''))) IN ('','active','normal','ready_for_sale','available','vacant') FOR UPDATE;
    -- Match the existing active-plot UNIQUE index exactly. Malformed legacy
    -- status text is unknown/occupied, not a cancellation inferred by trimming.
    IF NOT FOUND OR EXISTS(SELECT 1 FROM public.sales WHERE plot_id=plot_value AND COALESCE(crm_stage,lower(contract_status),'unknown')<>'cancelled') THEN
      RAISE EXCEPTION 'CRM_BOOKING_PLOT_UNAVAILABLE';
    END IF;
    SELECT COALESCE(max(booking_round),0)+1 INTO next_round FROM public.sales WHERE project_interest_id=interest_row.id;
    -- Recorded sequence only; this does not infer unknown historical rounds.
    sale_id_value:=gen_random_uuid();
    IF to_regprocedure('crm_external_private.begin_booking_write(uuid,uuid,uuid,uuid,text)') IS NOT NULL THEN
      EXECUTE 'SELECT crm_external_private.begin_booking_write($1,$2,$3,$4,$5)'
        USING actor_id,customer_id_value,interest_row.id,sale_id_value,command_name;
    END IF;
    INSERT INTO sales_private.booking_write_permits VALUES(txid_current(),pg_backend_pid());
    INSERT INTO public.sales(id,lead_id,project_interest_id,plot_id,booking_round,previous_sale_id,crm_stage,contract_status,payment_method,
      booking_route,booking_route_reason,booking_visit_id,list_price,discount_amount,sale_price,booking_amount,booked_at,closing_sales_user_id)
      VALUES(sale_id_value,NULL,interest_row.id,plot_value,next_round,previous_id,'booked','Reserved',p_payload->>'paymentMethod',p_payload->>'bookingRoute',
        reason_value,visit_id_value,list_satang/100.0,discount_satang/100.0,(list_satang-discount_satang)/100.0,deposit_satang/100.0,server_now,owner_id)
      RETURNING * INTO sale_row;
    DELETE FROM sales_private.booking_write_permits WHERE transaction_id=txid_current();
    UPDATE public.plots SET has_customer=true WHERE id=plot_value;
    -- This flag records the first booking association, not a separate Lead page.
    -- Visits/follow-up continue in the central workspace; cohort dates stay put.
    UPDATE public.lead_project_interests SET lifecycle_revision=gen_random_uuid(),updated_at=server_now,
      workspace_state='project_active',
      activated_at=CASE WHEN workspace_state='central_interest' THEN server_now ELSE activated_at END,
      activation_reason=CASE WHEN workspace_state='central_interest' THEN 'booking' ELSE activation_reason END
      WHERE id=interest_row.id RETURNING * INTO interest_row;
    old_values:=NULL;
  ELSE
    SELECT * INTO sale_row FROM public.sales WHERE id=sale_id_value AND project_interest_id=interest_row.id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'CRM_BOOKING_NOT_FOUND'; END IF;
    IF sale_row.booking_revision IS DISTINCT FROM expected_sale THEN RAISE EXCEPTION 'CRM_BOOKING_STALE_STATE'; END IF;
    old_values:=to_jsonb(sale_row);
    IF command_name='cancel' THEN
      IF sale_row.crm_stage NOT IN ('booked','contracted','downpayment','document_prep','loan_submitted','loan_rejected','loan_approved','transfer_pending') THEN
        RAISE EXCEPTION 'CRM_BOOKING_CONFLICT';
      END IF;
      PERFORM 1 FROM public.plots WHERE id=sale_row.plot_id FOR UPDATE;
      IF to_regprocedure('crm_external_private.begin_booking_write(uuid,uuid,uuid,uuid,text)') IS NOT NULL THEN
        EXECUTE 'SELECT crm_external_private.begin_booking_write($1,$2,$3,$4,$5)'
          USING actor_id,customer_id_value,interest_row.id,sale_row.id,command_name;
      END IF;
      INSERT INTO sales_private.booking_write_permits VALUES(txid_current(),pg_backend_pid());
      UPDATE public.sales SET crm_stage='cancelled',contract_status='Cancelled',cancelled_at=server_now,
        cancellation_category=p_payload->>'cancellationCategory',cancellation_reason=reason_value,booking_revision=gen_random_uuid()
        WHERE id=sale_row.id RETURNING * INTO sale_row;
      DELETE FROM sales_private.booking_write_permits WHERE transaction_id=txid_current();
      UPDATE public.plots SET has_customer=false WHERE id=sale_row.plot_id
        AND NOT EXISTS(SELECT 1 FROM public.sales WHERE plot_id=sale_row.plot_id AND COALESCE(crm_stage,lower(contract_status),'unknown')<>'cancelled');
      UPDATE public.lead_project_interests SET lifecycle_revision=gen_random_uuid(),updated_at=server_now WHERE id=interest_row.id RETURNING * INTO interest_row;
      -- No implicit next action, status reset or reopening of this cancelled sale.
    ELSE
      IF sale_row.crm_stage<>'cancelled' THEN RAISE EXCEPTION 'CRM_BOOKING_CONFLICT'; END IF;
      IF interest_row.lifecycle_revision IS DISTINCT FROM expected_interest THEN RAISE EXCEPTION 'CRM_BOOKING_STALE_STATE'; END IF;
      UPDATE public.lead_project_interests SET engagement_status='follow_up',lifecycle_revision=gen_random_uuid(),updated_at=server_now
        WHERE id=interest_row.id RETURNING * INTO interest_row;
      BEGIN
        work_result:=public.crm_v2_record_lead_work(gen_random_uuid(),jsonb_build_object('command','set_next_action',
          'customerId',customer_id_value,'interestId',interest_row.id,'expectedActionId',expected_action,
          'nextAction',p_payload->'nextAction','reason',reason_value));
      EXCEPTION WHEN raise_exception THEN
        IF SQLERRM='CRM_WORK_STALE_ACTION' THEN RAISE EXCEPTION 'CRM_BOOKING_STALE_STATE'; END IF;
        IF SQLERRM IN ('CRM_WORK_FORBIDDEN','CRM_WORK_INACTIVE_OWNER') THEN RAISE EXCEPTION 'CRM_BOOKING_FORBIDDEN'; END IF;
        IF SQLERRM='CRM_WORK_SCOPE_CLOSED' THEN RAISE EXCEPTION 'CRM_BOOKING_CONFLICT'; END IF;
        RAISE EXCEPTION 'CRM_BOOKING_INVALID_INPUT';
      END;
      next_action:=(work_result->>'nextActionId')::uuid;
      -- Do not UPDATE the cancelled sale, even its revision/timestamps.
    END IF;
  END IF;
  IF command_name IN ('book','cancel') AND to_regprocedure('crm_external_private.end_booking_write()') IS NOT NULL THEN
    EXECUTE 'SELECT crm_external_private.end_booking_write()';
  END IF;
  INSERT INTO public.crm_audit_events(customer_id,entity_type,entity_id,event_type,reason_text,actor_user_id,actor_kind,
    actor_name_snapshot,old_values,new_values,occurred_at,recorded_at)
    VALUES(customer_id_value,'sale',sale_row.id,command_name,reason_value,actor_id,'staff',actor_name,
      jsonb_build_object('sale',old_values,'interest',old_interest),
      jsonb_build_object('sale',to_jsonb(sale_row),'interest',to_jsonb(interest_row),'interestRevision',interest_row.lifecycle_revision,'nextActionId',next_action),server_now,server_now);
  response_value:=jsonb_build_object('command',command_name,'customerId',customer_id_value,'interestId',interest_row.id,
    'saleId',sale_row.id,'saleRevision',sale_row.booking_revision,'interestRevision',interest_row.lifecycle_revision,'nextActionId',next_action,'replayed',false);
  INSERT INTO sales_private.booking_command_requests(actor_user_id,request_id,request_payload,response,created_at)
    VALUES(actor_id,p_request_id,p_payload,response_value,server_now);
  RETURN response_value;
END;
$command$;
REVOKE ALL ON FUNCTION public.crm_v2_booking_command(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_v2_booking_command(uuid,jsonb) TO authenticated;

-- Enablement requires legacy-writer retirement, full RLS/trigger/NOT NULL review,
-- evidence-preserving legacy backfill and a separate approved migration. This
-- draft intentionally neither revokes unrelated legacy writes nor imports rows.

-- Reviewed source: sql/sales/19_project_sales_read_draft.sql
-- LF-normalized SHA256: eabf46f0c690a9adaff3af2bd364d265ed844315a18835f5f4f4650933552419
-- SALES V2 PROJECT BOOKING READER -- DESIGN ONLY, 2026-09-23.
-- NEVER RUN ON SUPABASE. Depends on the guarded base + 04/05/18 drafts.
-- Read-only projection of actual sale rounds, not a per-project Lead workspace.
-- No backfill, legacy writer retirement, flag changes, stock changes or deploy.
-- The reviewed legacy schema must expose plots.plot_name as nullable text.


CREATE FUNCTION public.crm_v2_project_sales_capabilities()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC'
AS $capabilities$
  SELECT jsonb_build_object('contract_version','project_sales_v1','enabled',
    COALESCE((public.crm_v2_booking_capabilities()->>'enabled')::boolean,false));
$capabilities$;
REVOKE ALL ON FUNCTION public.crm_v2_project_sales_capabilities() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_v2_project_sales_capabilities() TO authenticated;

-- One STABLE snapshot; no locks, processing commands, receipts or audit writes.
-- Include closed registered projects: closing new intake must not hide history.
-- Null project is discovery only. Missing legacy identity links fail closed rather
-- than silently presenting an incomplete list or matching customers by name/phone.
CREATE FUNCTION public.crm_v2_project_sales(p_project_name text DEFAULT NULL,
  p_tab text DEFAULT 'booked',p_query text DEFAULT '',p_page integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC'
AS $snapshot$
DECLARE
  actor_id uuid:=auth.uid(); actor_role text:=public.crm_v2_role();
  trim_chars text:=U&' \00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
  search_value text; rows_json jsonb:='[]'::jsonb; more boolean:=false;
BEGIN
  IF actor_id IS NULL OR COALESCE(actor_role,'') NOT IN ('sales','admin','owner') THEN
    RAISE EXCEPTION 'CRM_PROJECT_SALES_FORBIDDEN';
  END IF;
  IF (public.crm_v2_project_sales_capabilities()->>'enabled')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'CRM_PROJECT_SALES_SETUP_REQUIRED';
  END IF;
  IF p_tab IS NULL OR p_tab NOT IN ('booked','transferred','cancelled','all')
    OR p_page IS NULL OR p_page NOT BETWEEN 0 AND 100000
    OR p_query IS NULL OR p_query ~ U&'[\0001-\001F\007F-\009F\2028\2029]'
    OR length(btrim(p_query,trim_chars))>200 OR length(btrim(p_query,trim_chars))=1
    OR (p_project_name IS NOT NULL AND (length(p_project_name) NOT BETWEEN 1 AND 200
      OR p_project_name ~ U&'[\0001-\001F\007F-\009F\2028\2029]')) THEN
    RAISE EXCEPTION 'CRM_PROJECT_SALES_INVALID_INPUT';
  END IF;
  search_value:=btrim(p_query,trim_chars);
  IF p_project_name IS NULL AND (p_page<>0 OR search_value<>'') THEN
    RAISE EXCEPTION 'CRM_PROJECT_SALES_INVALID_INPUT';
  END IF;
  IF p_project_name IS NOT NULL THEN
    IF NOT EXISTS(SELECT 1 FROM public.projects WHERE name=p_project_name) THEN
      RAISE EXCEPTION 'CRM_PROJECT_SALES_NOT_FOUND';
    END IF;
    -- An unlinked sale can be assigned to a project only through its actual plot.
    -- Unknown/missing plots or unregistered plot projects are a global review gap.
    IF EXISTS(SELECT 1 FROM public.sales s LEFT JOIN public.plots p ON p.id=s.plot_id
      LEFT JOIN public.projects pr ON pr.name=p.project_name
      WHERE s.project_interest_id IS NULL AND (p.project_name=p_project_name OR p.id IS NULL OR pr.name IS NULL)) THEN
      RAISE EXCEPTION 'CRM_PROJECT_SALES_SETUP_REQUIRED';
    END IF;
    -- Check integrity BEFORE tab/search/pagination so a filter cannot conceal a
    -- broken mapping. A plot mismatch blocks either affected project's view.
    IF EXISTS(SELECT 1 FROM public.sales s
      LEFT JOIN public.lead_project_interests i ON i.id=s.project_interest_id
      LEFT JOIN public.sales_customers c ON c.id=i.customer_id
      LEFT JOIN sales_private.crm_user_roles owner_role ON owner_role.user_id=i.owner_user_id
      LEFT JOIN public.plots p ON p.id=s.plot_id
      LEFT JOIN public.sales previous ON previous.id=s.previous_sale_id
      WHERE s.project_interest_id IS NOT NULL
        AND (i.id IS NULL OR i.project_name=p_project_name OR p.project_name=p_project_name)
        AND (i.id IS NULL OR c.id IS NULL OR c.merged_into_customer_id IS NOT NULL
          OR owner_role.user_id IS NULL OR owner_role.role<>'sales'
          OR s.crm_stage IS NULL OR ((s.booking_round IS NULL
            OR to_jsonb(s)->>'external_booking_id' IS NOT NULL OR to_jsonb(s)->>'external_source_stage' IS NOT NULL)
            AND sales_private.crm_booking_imported_history(to_jsonb(s)) IS NULL)
          OR (s.plot_id IS NOT NULL AND (p.id IS NULL OR p.project_name IS DISTINCT FROM i.project_name))
          OR (s.plot_id IS NULL AND s.crm_stage<>'cancelled')
          OR (s.previous_sale_id IS NOT NULL AND (previous.id IS NULL
            OR previous.project_interest_id IS DISTINCT FROM s.project_interest_id
            OR previous.crm_stage IS DISTINCT FROM 'cancelled' OR previous.booking_round>=s.booking_round))
          OR (s.booked_at IS NOT NULL AND (NOT isfinite(s.booked_at)
            OR s.booked_at<TIMESTAMPTZ '0001-01-01 00:00:00+00' OR s.booked_at>=TIMESTAMPTZ '10000-01-01 00:00:00+00'))
          OR (s.cancelled_at IS NOT NULL AND (NOT isfinite(s.cancelled_at)
            OR s.cancelled_at<TIMESTAMPTZ '0001-01-01 00:00:00+00' OR s.cancelled_at>=TIMESTAMPTZ '10000-01-01 00:00:00+00')))) THEN
      RAISE EXCEPTION 'CRM_PROJECT_SALES_SETUP_REQUIRED';
    END IF;
    WITH page_rows AS (
      SELECT s.*,i.customer_id,i.project_name,i.owner_user_id,c.customer_name,c.phone,p.plot_name,
        COALESCE(NULLIF(btrim(owner_role.display_name),''),owner_role.user_id::text) AS owner_name
      FROM public.sales s
      JOIN public.lead_project_interests i ON i.id=s.project_interest_id
      JOIN public.sales_customers c ON c.id=i.customer_id
      JOIN sales_private.crm_user_roles owner_role ON owner_role.user_id=i.owner_user_id
      LEFT JOIN public.plots p ON p.id=s.plot_id
      WHERE i.project_name=p_project_name
        AND (p_tab='all' OR (p_tab='booked' AND s.crm_stage IN
          ('booked','contracted','downpayment','document_prep','loan_submitted','loan_rejected','loan_approved','transfer_pending'))
          OR (p_tab='transferred' AND s.crm_stage IN ('transferred','handover'))
          OR (p_tab='cancelled' AND s.crm_stage='cancelled'))
        AND (search_value='' OR strpos(lower(c.customer_name),lower(search_value))>0
          OR strpos(lower(COALESCE(c.phone,'')),lower(search_value))>0
          OR strpos(lower(COALESCE(s.plot_id,'')),lower(search_value))>0
          OR strpos(lower(COALESCE(p.plot_name,'')),lower(search_value))>0)
      ORDER BY s.booked_at DESC NULLS LAST,s.id LIMIT 51 OFFSET p_page*50
    ), numbered AS (SELECT *,row_number() OVER(ORDER BY booked_at DESC NULLS LAST,id) rn FROM page_rows)
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'saleId',s.id,'customerId',s.customer_id,'customerName',s.customer_name,'phone',s.phone,
      'interestId',s.project_interest_id,'projectName',s.project_name,'ownerUserId',s.owner_user_id,'ownerName',s.owner_name,
      'plotId',s.plot_id,'plotName',s.plot_name,'stage',s.crm_stage,'bookingRound',s.booking_round,
      'importedHistory',sales_private.crm_booking_imported_history(to_jsonb(s)),
      'previousSaleId',s.previous_sale_id,'bookedAt',s.booked_at,'cancelledAt',s.cancelled_at,
      'cancellationReason',s.cancellation_reason,'listPrice',s.list_price,'discountAmount',s.discount_amount,
      'salePrice',s.sale_price,'depositAmount',s.booking_amount,'paymentMethod',s.payment_method)
      ORDER BY s.booked_at DESC NULLS LAST,s.id) FILTER(WHERE rn<=50),'[]'::jsonb),count(*)>50
      INTO rows_json,more FROM numbered s;
  END IF;
  RETURN jsonb_build_object('actor',jsonb_build_object('userId',actor_id,'role',actor_role),
    'projectName',p_project_name,'projects',COALESCE((SELECT jsonb_agg(jsonb_build_object('name',name) ORDER BY name)
      FROM public.projects),'[]'::jsonb),'tab',p_tab,'query',search_value,'page',p_page,'hasMore',more,'rows',rows_json);
END;
$snapshot$;
REVOKE ALL ON FUNCTION public.crm_v2_project_sales(text,text,text,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_v2_project_sales(text,text,text,integer) TO authenticated;

-- Reviewed source: sql/sales/22_central_search_draft.sql
-- LF-normalized SHA256: 6b04aa0e6901c3159fba66b2f8114e29bfc127ce613b27ae9e1be704370d7596
-- SALES V2 CENTRAL REGISTRY SEARCH -- DESIGN ONLY, 2026-09-23.
-- NEVER RUN ON SUPABASE. Depends on the guarded base draft; no writes or backfill.
-- Uses the existing default-disabled central_intake_enabled switch. Intake v1
-- and its create RPC remain unchanged. Search is a separately versioned reader.


CREATE FUNCTION public.crm_v2_central_search_capabilities()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC'
AS $capabilities$
  SELECT jsonb_build_object('contract_version','central_search_v1','enabled',
    COALESCE((public.crm_v2_capabilities()->>'enabled')::boolean,false));
$capabilities$;
REVOKE ALL ON FUNCTION public.crm_v2_central_search_capabilities() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_v2_central_search_capabilities() TO authenticated;

CREATE FUNCTION public.crm_v2_central_search(p_filters jsonb,p_page integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC'
AS $snapshot$
DECLARE
  actor_id uuid:=auth.uid(); actor_role text:=public.crm_v2_role();
  trim_chars text:=U&' \00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
  search_value text; project_value text; channel_value text; owner_value uuid; status_value text; unassigned boolean;
  filters_json jsonb; customers_json jsonb; channels_json jsonb; more_rows boolean; more_channels boolean;
BEGIN
  IF actor_id IS NULL OR COALESCE(actor_role,'') NOT IN ('sales','admin','owner') THEN
    RAISE EXCEPTION 'CRM_FORBIDDEN';
  END IF;
  IF (public.crm_v2_central_search_capabilities()->>'enabled')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'CRM_SETUP_REQUIRED';
  END IF;
  IF p_page IS NULL OR p_page NOT BETWEEN 0 AND 100000 OR p_filters IS NULL OR jsonb_typeof(p_filters)<>'object' THEN
    RAISE EXCEPTION 'CRM_INVALID_INPUT';
  END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(p_filters))<>6
    OR NOT p_filters ?& ARRAY['search','project','channel','owner','status','unassignedOnly']
    OR jsonb_typeof(p_filters->'unassignedOnly') IS DISTINCT FROM 'boolean'
    OR EXISTS(SELECT 1 FROM jsonb_each(p_filters) e WHERE e.key<>'unassignedOnly'
      AND (jsonb_typeof(e.value)<>'string' OR (e.value#>>'{}') ~ U&'[\0001-\001F\007F-\009F\2028\2029]')) THEN
    RAISE EXCEPTION 'CRM_INVALID_INPUT';
  END IF;
  search_value:=btrim(p_filters->>'search',trim_chars); project_value:=p_filters->>'project';
  channel_value:=p_filters->>'channel'; status_value:=p_filters->>'status'; unassigned:=(p_filters->>'unassignedOnly')::boolean;
  IF length(search_value)>200 OR length(project_value)>200 OR length(channel_value)>80
    OR status_value NOT IN ('','new','contacted','considering','follow_up','nurture','lost','legacy_unclassified')
    OR (unassigned AND project_value<>'')
    OR ((p_filters->>'owner')<>'' AND (p_filters->>'owner')!~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN
    RAISE EXCEPTION 'CRM_INVALID_INPUT';
  END IF;
  owner_value:=NULLIF(p_filters->>'owner','')::uuid;
  filters_json:=jsonb_build_object('search',search_value,'project',project_value,'channel',channel_value,
    'owner',COALESCE(owner_value::text,''),'status',status_value,'unassignedOnly',unassigned);

  -- Every filter is evaluated on the whole registry BEFORE the bounded page.
  -- Literal strpos means %, _ and backslash are text, not wildcard instructions.
  -- EXISTS preserves one row per customer ID, never a name/phone deduplication.
  WITH page_rows AS (
    SELECT c.* FROM public.sales_customers c
    WHERE c.merged_into_customer_id IS NULL
      AND (channel_value='' OR c.intake_channel=channel_value)
      AND (NOT unassigned OR NOT EXISTS(SELECT 1 FROM public.lead_project_interests i WHERE i.customer_id=c.id))
      AND (search_value='' OR strpos(lower(c.customer_name),lower(search_value))>0
        OR strpos(lower(COALESCE(c.phone,'')),lower(search_value))>0
        OR strpos(lower(COALESCE(c.intake_notes,'')),lower(search_value))>0
        OR EXISTS(SELECT 1 FROM public.lead_project_interests i WHERE i.customer_id=c.id
          AND (strpos(lower(i.project_name),lower(search_value))>0
            OR strpos(lower(COALESCE(i.interested_plot_id,'')),lower(search_value))>0)))
      AND ((project_value='' AND (owner_value IS NULL OR c.owner_user_id=owner_value)
          AND (status_value='' OR CASE WHEN c.intake_status='following_up' THEN 'follow_up' ELSE c.intake_status END=status_value))
        OR EXISTS(SELECT 1 FROM public.lead_project_interests i WHERE i.customer_id=c.id
          AND (project_value='' OR i.project_name=project_value)
          AND (owner_value IS NULL OR i.owner_user_id=owner_value)
          AND (status_value='' OR i.engagement_status=status_value)))
    ORDER BY c.created_at DESC,c.id LIMIT 51 OFFSET p_page*50
  ), numbered AS (SELECT *,row_number() OVER(ORDER BY created_at DESC,id) rn FROM page_rows)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',c.id,'name',c.customer_name,'phone',c.phone,'channel',c.intake_channel,'notes',c.intake_notes,
    'ownerUserId',c.owner_user_id,'leadCreatedAt',c.lead_created_at,'intakeStatus',c.intake_status,
    'interests',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',i.id,'projectName',i.project_name,
      'ownerUserId',i.owner_user_id,'workspaceState',i.workspace_state,'engagementStatus',i.engagement_status,
      'plotId',i.interested_plot_id) ORDER BY i.interest_created_at,i.id)
      FROM public.lead_project_interests i WHERE i.customer_id=c.id),'[]'::jsonb)
  ) ORDER BY c.created_at DESC,c.id) FILTER(WHERE rn<=50),'[]'::jsonb),count(*)>50
  INTO customers_json,more_rows FROM numbered c;
  -- Global suggestions are independent of page/filter. Free-text exact channel
  -- remains supported when the bounded list has more than 200 distinct values.
  WITH distinct_channels AS (
    SELECT DISTINCT intake_channel FROM public.sales_customers
    WHERE merged_into_customer_id IS NULL AND intake_channel IS NOT NULL AND intake_channel<>''
    ORDER BY intake_channel LIMIT 201
  ), numbered AS (SELECT intake_channel,row_number() OVER(ORDER BY intake_channel) rn FROM distinct_channels)
  SELECT COALESCE(jsonb_agg(intake_channel ORDER BY intake_channel) FILTER(WHERE rn<=200),'[]'::jsonb),count(*)>200
  INTO channels_json,more_channels FROM numbered;
  RETURN jsonb_build_object('actor',jsonb_build_object('userId',actor_id,'role',actor_role),
    'projects',COALESCE((SELECT jsonb_agg(jsonb_build_object('name',name) ORDER BY name)
      FROM public.projects WHERE is_closed IS NOT TRUE),'[]'::jsonb),
    'salesOwners',COALESCE((SELECT jsonb_agg(jsonb_build_object('userId',user_id,
      'displayName',COALESCE(NULLIF(btrim(display_name),''),user_id::text)) ORDER BY display_name,user_id)
      FROM sales_private.crm_user_roles WHERE is_active AND role='sales'),'[]'::jsonb),
    'customers',customers_json,'page',p_page,'hasMore',more_rows,
    'search',jsonb_build_object('contractVersion','central_search_v1','filters',filters_json,
      'projects',COALESCE((SELECT jsonb_agg(name ORDER BY name) FROM public.projects),'[]'::jsonb),
      'owners',COALESCE((SELECT jsonb_agg(jsonb_build_object('userId',user_id,
        'displayName',COALESCE(NULLIF(btrim(display_name),''),user_id::text)) ORDER BY display_name,user_id)
        FROM sales_private.crm_user_roles WHERE role='sales'),'[]'::jsonb),
      'channels',channels_json,'hasMoreChannels',more_channels));
END;
$snapshot$;
REVOKE ALL ON FUNCTION public.crm_v2_central_search(jsonb,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_v2_central_search(jsonb,integer) TO authenticated;

-- Reviewed source: sql/sales/external_booking_writer_draft.sql
-- LF-normalized SHA256: 68242b195c841e61909ebcdf843966fc5f48a22c38d223c31ab5e9849ddb1cc4
-- DESIGN ONLY. Composed AFTER external replacement and companions 04/05/18/19/22.
-- No remote installer. Activation is an explicit private operator transition.

SET LOCAL lock_timeout='2s';

CREATE TABLE crm_external_private.booking_writer_releases (
  batch_id uuid PRIMARY KEY REFERENCES crm_external_private.sales_cutover_receipts(batch_id),
  plan_digest text NOT NULL,review_reference text NOT NULL CHECK(length(btrim(review_reference))>0),
  activated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE crm_external_private.booking_writer_permits (
  transaction_id bigint PRIMARY KEY,backend_pid integer NOT NULL,
  actor_id uuid NOT NULL,customer_id uuid NOT NULL,interest_id uuid NOT NULL,sale_id uuid NOT NULL,
  command text NOT NULL CHECK(command IN ('book','cancel'))
);
CREATE TABLE crm_external_private.booking_activation_permits (
  transaction_id bigint PRIMARY KEY,backend_pid integer NOT NULL,batch_id uuid NOT NULL
);
ALTER TABLE crm_external_private.booking_writer_releases ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_external_private.booking_writer_permits ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_external_private.booking_activation_permits ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER booking_writer_release_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
  ON crm_external_private.booking_writer_releases FOR EACH STATEMENT
  EXECUTE FUNCTION account_security_private.prevent_role_review_change();

CREATE UNIQUE INDEX sales_active_plot_booking_idx ON public.sales(plot_id)
  WHERE plot_id IS NOT NULL
    AND COALESCE(crm_stage, lower(contract_status), 'unknown') <> 'cancelled';

CREATE FUNCTION crm_external_private.booking_writer_ready()
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT EXISTS(SELECT 1 FROM crm_external_private.booking_writer_releases w
    WHERE NOT EXISTS(SELECT 1 FROM crm_external_private.sales_rollback_receipts r WHERE r.batch_id=w.batch_id))
    AND COALESCE((SELECT central_intake_enabled AND lead_work_enabled AND lead_lifecycle_enabled
      AND booking_enabled AND booking_cutover_reviewed FROM public.crm_settings WHERE id),false);
$$;

CREATE FUNCTION crm_external_private.begin_booking_write(p_actor uuid,p_customer uuid,p_interest uuid,p_sale uuid,p_command text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE owner_id uuid; actor_role text;
BEGIN
  IF NOT crm_external_private.booking_writer_ready() THEN RAISE EXCEPTION 'CRM_BOOKING_SETUP_REQUIRED'; END IF;
  actor_role:=public.crm_v2_role();
  SELECT owner_user_id INTO owner_id FROM public.lead_project_interests WHERE id=p_interest AND customer_id=p_customer;
  IF p_actor IS DISTINCT FROM auth.uid() OR actor_role NOT IN ('admin','sales') OR owner_id IS NULL
    OR (actor_role='sales' AND p_actor IS DISTINCT FROM owner_id)
    OR p_sale IS NULL OR p_command NOT IN ('book','cancel')
    OR NOT EXISTS(SELECT 1 FROM sales_private.crm_user_roles WHERE user_id=owner_id AND role='sales' AND is_active) THEN
    RAISE EXCEPTION 'CRM_BOOKING_FORBIDDEN';
  END IF;
  INSERT INTO crm_external_private.booking_writer_permits VALUES(txid_current(),pg_backend_pid(),p_actor,p_customer,p_interest,p_sale,p_command);
END;
$$;
CREATE FUNCTION crm_external_private.end_booking_write()
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
  DELETE FROM crm_external_private.booking_writer_permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid();
$$;

CREATE FUNCTION crm_external_private.booking_sale_allowed(p_operation text,p_old jsonb,p_new jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE permit crm_external_private.booking_writer_permits%ROWTYPE;
  mutable text[]:=ARRAY['crm_stage','contract_status','cancelled_at','cancellation_category','cancellation_reason','booking_revision','updated_at'];
BEGIN
  SELECT * INTO permit FROM crm_external_private.booking_writer_permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid();
  IF permit.actor_id IS DISTINCT FROM auth.uid() OR permit.transaction_id IS NULL
    OR NOT crm_external_private.booking_writer_ready() OR p_operation NOT IN ('INSERT','UPDATE')
    OR p_new->>'id' IS DISTINCT FROM permit.sale_id::text
    OR p_new->>'project_interest_id' IS DISTINCT FROM permit.interest_id::text THEN RETURN false; END IF;
  IF p_operation='INSERT' THEN
    RETURN permit.command='book' AND p_old IS NULL AND p_new->>'crm_stage'='booked'
      AND p_new->>'contract_status'='Reserved' AND p_new->>'external_booking_id' IS NULL
      AND p_new->>'external_source_stage' IS NULL AND p_new->>'lead_id' IS NULL
      AND p_new->>'booking_route' IN ('visited','without_visit')
      AND (p_new->>'booking_round')::integer>0 AND p_new->>'booked_at' IS NOT NULL;
  END IF;
  RETURN permit.command='cancel' AND p_old->>'crm_stage' IN
    ('booked','contracted','downpayment','document_prep','loan_submitted','loan_rejected','loan_approved','transfer_pending')
    AND p_new->>'crm_stage'='cancelled' AND p_new->>'contract_status'='Cancelled'
    AND p_new->>'cancelled_at' IS NOT NULL AND p_new->>'cancellation_category' IS NOT NULL
    AND length(btrim(p_new->>'cancellation_reason'))>0
    AND p_old-mutable=p_new-mutable;
END;
$$;

CREATE FUNCTION crm_external_private.booking_interest_allowed(p_old jsonb,p_new jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE permit crm_external_private.booking_writer_permits%ROWTYPE;
  mutable text[]:=ARRAY['lifecycle_revision','updated_at','workspace_state','activated_at','activation_reason'];
BEGIN
  SELECT * INTO permit FROM crm_external_private.booking_writer_permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid();
  IF permit.actor_id IS DISTINCT FROM auth.uid() OR permit.transaction_id IS NULL
    OR NOT crm_external_private.booking_writer_ready()
    OR p_new->>'id' IS DISTINCT FROM permit.interest_id::text
    OR p_new->>'customer_id' IS DISTINCT FROM permit.customer_id::text THEN RETURN false; END IF;
  IF permit.command='cancel' THEN
    RETURN p_old-ARRAY['lifecycle_revision','updated_at']=p_new-ARRAY['lifecycle_revision','updated_at'];
  END IF;
  RETURN p_old-mutable=p_new-mutable AND p_new->>'workspace_state'='project_active'
    AND ((p_old->>'workspace_state'='central_interest' AND p_new->>'activation_reason'='booking' AND p_new->>'activated_at' IS NOT NULL)
      OR (p_old->>'workspace_state'='project_active' AND p_new->'activated_at'=p_old->'activated_at'
        AND p_new->'activation_reason'=p_old->'activation_reason'));
END;
$$;

CREATE FUNCTION crm_external_private.booking_activation_allowed(p_settings jsonb)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT EXISTS(SELECT 1 FROM crm_external_private.booking_activation_permits p
      WHERE p.transaction_id=txid_current() AND p.backend_pid=pg_backend_pid())
    AND NOT EXISTS(SELECT 1 FROM jsonb_each(p_settings) j
      WHERE (j.key LIKE '%\_enabled' ESCAPE '\' OR j.key='booking_cutover_reviewed')
        AND j.value='true' AND j.key NOT IN
          ('central_intake_enabled','lead_work_enabled','lead_lifecycle_enabled','booking_enabled','booking_cutover_reviewed'));
$$;

-- Protect only sales stock fields. Construction-only UPDATEs return unchanged
-- before inspecting private state; no construction grants or values are edited.
CREATE FUNCTION crm_external_private.guard_booking_plot_stock()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE permit crm_external_private.booking_writer_permits%ROWTYPE; expected_occupied boolean;
BEGIN
  IF TG_OP='INSERT' THEN
    IF EXISTS(SELECT 1 FROM crm_external_private.booking_writer_releases)
      AND (NEW.has_customer IS DISTINCT FROM false OR lower(btrim(NEW.sale_status))='transferred') THEN
      RAISE EXCEPTION 'EXTERNAL_WRITER_STOCK_COMMAND_REQUIRED';
    END IF;
    RETURN NEW;
  END IF;
  IF EXISTS(SELECT 1 FROM crm_external_private.booking_writer_releases)
    AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.project_name IS DISTINCT FROM OLD.project_name)
    AND EXISTS(SELECT 1 FROM public.sales WHERE plot_id=OLD.id) THEN
    RAISE EXCEPTION 'EXTERNAL_WRITER_STOCK_COMMAND_REQUIRED';
  END IF;
  -- Existing construction pause/resume is NOT a transfer or occupancy change.
  -- Delegate its authorization to the unchanged plot policies, not CRM roles:
  -- other departments are not required to enroll in the Sales role registry.
  IF NEW.id IS NOT DISTINCT FROM OLD.id AND NEW.project_name IS NOT DISTINCT FROM OLD.project_name
    AND NEW.has_customer IS NOT DISTINCT FROM OLD.has_customer
    AND COALESCE(OLD.sale_status,'') IN ('','active','ready_for_sale')
    AND NEW.sale_status IN ('active','ready_for_sale') THEN RETURN NEW; END IF;
  IF NEW.has_customer IS NOT DISTINCT FROM OLD.has_customer
    AND NEW.sale_status IS NOT DISTINCT FROM OLD.sale_status THEN RETURN NEW; END IF;
  IF NOT EXISTS(SELECT 1 FROM crm_external_private.booking_writer_releases) THEN RETURN NEW; END IF;
  SELECT * INTO permit FROM crm_external_private.booking_writer_permits
    WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid();
  IF permit.transaction_id IS NULL OR permit.actor_id IS DISTINCT FROM auth.uid()
    OR NOT EXISTS(SELECT 1 FROM public.sales s WHERE s.id=permit.sale_id
      AND s.project_interest_id=permit.interest_id AND s.plot_id=NEW.id)
    OR NEW.id IS DISTINCT FROM OLD.id OR NEW.project_name IS DISTINCT FROM OLD.project_name
    OR NEW.sale_status IS DISTINCT FROM OLD.sale_status THEN
    RAISE EXCEPTION 'EXTERNAL_WRITER_STOCK_COMMAND_REQUIRED';
  END IF;
  SELECT EXISTS(SELECT 1 FROM public.sales WHERE plot_id=NEW.id
    AND COALESCE(crm_stage,lower(contract_status),'unknown')<>'cancelled') INTO expected_occupied;
  IF NEW.has_customer IS DISTINCT FROM expected_occupied THEN RAISE EXCEPTION 'EXTERNAL_WRITER_STOCK_EVIDENCE_REQUIRED'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER external_booking_plot_stock BEFORE INSERT OR UPDATE ON public.plots
  FOR EACH ROW EXECUTE FUNCTION crm_external_private.guard_booking_plot_stock();

CREATE FUNCTION crm_external_private.enable_booking_writer(p_batch uuid,p_plan_digest text,p_review_ref text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE receipt crm_external_private.sales_cutover_receipts%ROWTYPE; s public.sales%ROWTYPE;
  old_row jsonb; g record; column_record record; target text;
BEGIN
  PERFORM crm_external_private.cutover_operator_check();
  PERFORM pg_advisory_xact_lock(20260925,3);
  LOCK TABLE public.sales,public.plots,public.crm_settings IN SHARE ROW EXCLUSIVE MODE;
  IF p_review_ref IS NULL OR length(btrim(p_review_ref))=0 THEN RAISE EXCEPTION 'EXTERNAL_WRITER_REVIEW_REQUIRED'; END IF;
  SELECT * INTO receipt FROM crm_external_private.sales_cutover_receipts WHERE batch_id=p_batch;
  IF receipt.batch_id IS NULL OR receipt.request->>'planDigest' IS DISTINCT FROM p_plan_digest
    OR EXISTS(SELECT 1 FROM crm_external_private.sales_rollback_receipts WHERE batch_id=p_batch)
    OR EXISTS(SELECT 1 FROM crm_external_private.booking_writer_releases)
    OR to_regprocedure('public.crm_v2_booking_command(uuid,jsonb)') IS NULL
    OR to_regprocedure('public.crm_v2_project_sales(text,text,text,integer)') IS NULL
    OR to_regprocedure('public.crm_v2_central_search(jsonb,integer)') IS NULL
    OR to_regprocedure('public.crm_v2_central_search_capabilities()') IS NULL
    OR to_regprocedure('account_security_private.current_crm_role()') IS NULL THEN
    RAISE EXCEPTION 'EXTERNAL_WRITER_PREREQUISITES_REQUIRED';
  END IF;
  PERFORM crm_external_private.revalidate_cutover_identity(p_batch,p_plan_digest);
  IF EXISTS(SELECT 1 FROM public.crm_settings t,LATERAL jsonb_each(to_jsonb(t)) j
    WHERE (j.key LIKE '%\_enabled' ESCAPE '\' OR j.key='booking_cutover_reviewed') AND j.value='true') THEN
    RAISE EXCEPTION 'EXTERNAL_WRITER_DISABLED_CRM_REQUIRED';
  END IF;
  IF (SELECT count(*) FROM public.sales)<>jsonb_array_length(receipt.after_sales) THEN
    RAISE EXCEPTION 'EXTERNAL_WRITER_SALE_BASELINE_CHANGED';
  END IF;
  IF crm_external_private.cutover_plot_flags(receipt.after_plot_flags) IS DISTINCT FROM receipt.after_plot_flags THEN
    RAISE EXCEPTION 'EXTERNAL_WRITER_PLOT_BASELINE_CHANGED';
  END IF;
  FOR s IN SELECT * FROM public.sales LOOP
    SELECT e INTO old_row FROM jsonb_array_elements(receipt.after_sales) e WHERE e->>'id'=s.id::text;
    IF old_row IS NULL OR to_jsonb(s)-ARRAY['booking_revision','booking_visit_id'] IS DISTINCT FROM old_row THEN
      RAISE EXCEPTION 'EXTERNAL_WRITER_SALE_BASELINE_CHANGED';
    END IF;
    PERFORM crm_external_private.sale_history(to_jsonb(s));
  END LOOP;
  -- Retire table and column DML grants for every non-owner legacy client.
  -- SELECT and every other department's tables/permissions stay unchanged.
  FOR g IN SELECT DISTINCT a.grantee FROM pg_class c,
      LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
      WHERE c.oid='public.sales'::regclass AND a.grantee<>c.relowner
      UNION SELECT DISTINCT a.grantee FROM pg_attribute col JOIN pg_class c ON c.oid=col.attrelid,
      LATERAL aclexplode(col.attacl) a WHERE c.oid='public.sales'::regclass AND a.grantee<>c.relowner LOOP
    target:=CASE WHEN g.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(g.grantee)) END;
    EXECUTE format('REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON public.sales FROM %s',target);
    FOR column_record IN SELECT attname FROM pg_attribute WHERE attrelid='public.sales'::regclass AND attnum>0 AND NOT attisdropped LOOP
      EXECUTE format('REVOKE INSERT (%I),UPDATE (%I),REFERENCES (%I) ON public.sales FROM %s',column_record.attname,column_record.attname,column_record.attname,target);
    END LOOP;
  END LOOP;
  INSERT INTO crm_external_private.booking_activation_permits VALUES(txid_current(),pg_backend_pid(),p_batch);
  INSERT INTO public.crm_settings(id,central_intake_enabled,lead_work_enabled,lead_lifecycle_enabled,booking_enabled,booking_cutover_reviewed)
    VALUES(true,true,true,true,true,true) ON CONFLICT(id) DO UPDATE SET central_intake_enabled=true,
      lead_work_enabled=true,lead_lifecycle_enabled=true,booking_enabled=true,booking_cutover_reviewed=true;
  DELETE FROM crm_external_private.booking_activation_permits WHERE transaction_id=txid_current();
  INSERT INTO crm_external_private.booking_writer_releases(batch_id,plan_digest,review_reference) VALUES(p_batch,p_plan_digest,p_review_ref);
  GRANT EXECUTE ON FUNCTION public.crm_v2_role(),account_security_private.current_crm_role(),public.crm_v2_capabilities(),
    public.crm_v2_central_snapshot(integer,integer),public.crm_v2_create_customer(uuid,jsonb),
    public.crm_v2_central_search_capabilities(),public.crm_v2_central_search(jsonb,integer),
    public.crm_v2_booking_capabilities(),public.crm_v2_booking_search(text,integer),
    public.crm_v2_booking_context(uuid,integer),public.crm_v2_booking_command(uuid,jsonb),
    public.crm_v2_project_sales_capabilities(),public.crm_v2_project_sales(text,text,text,integer) TO authenticated;
  RETURN jsonb_build_object('batchId',p_batch,'bookingEnabled',true,'notificationsEnabled',false);
END;
$$;

-- Inherited Supabase/custom default grants are additive: revoke every grantee.
-- Companion 04/05/18/19/22 grants are deliberately closed again in this release.
-- Their flags are dependencies of booking, not permission to expose extra work.
DO $companion_seal$
DECLARE r record; g record; col record; target text;
BEGIN
  FOR r IN SELECT p.oid,p.proowner,p.proacl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE (n.nspname='sales_private' AND p.proname IN ('crm_work_timestamp','crm_work_text',
      'crm_booking_protect_sale','crm_booking_uuid','crm_booking_imported_history','crm_booking_external_ready'))
      OR (n.nspname='public' AND p.proname IN ('crm_v2_lead_work_capabilities','crm_v2_lead_work_snapshot',
        'crm_v2_record_lead_work','crm_v2_lead_lifecycle_capabilities','crm_v2_lead_lifecycle_context',
        'crm_v2_change_lead_lifecycle','crm_v2_booking_capabilities','crm_v2_booking_search',
        'crm_v2_booking_context','crm_v2_booking_command','crm_v2_project_sales_capabilities','crm_v2_project_sales',
        'crm_v2_central_search_capabilities','crm_v2_central_search')) LOOP
    FOR g IN SELECT DISTINCT grantee FROM aclexplode(coalesce(r.proacl,acldefault('f',r.proowner))) WHERE grantee<>r.proowner LOOP
      target:=CASE WHEN g.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(g.grantee)) END;
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %s',r.oid::regprocedure,target);
    END LOOP;
  END LOOP;
  FOR r IN SELECT c.oid,c.relowner,c.relacl,n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE (n.nspname='public' AND c.relname='crm_next_actions')
      OR (n.nspname='sales_private' AND c.relname IN ('lead_work_command_requests','booking_command_requests','booking_write_permits')) LOOP
    FOR g IN SELECT DISTINCT grantee FROM aclexplode(coalesce(r.relacl,acldefault('r',r.relowner))) WHERE grantee<>r.relowner
      UNION SELECT DISTINCT a.grantee FROM pg_attribute c,LATERAL aclexplode(c.attacl) a
        WHERE c.attrelid=r.oid AND a.grantee<>r.relowner LOOP
      target:=CASE WHEN g.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(g.grantee)) END;
      EXECUTE format('REVOKE ALL ON %I.%I FROM %s',r.nspname,r.relname,target);
      FOR col IN SELECT attname FROM pg_attribute WHERE attrelid=r.oid AND attnum>0 AND NOT attisdropped LOOP
        EXECUTE format('REVOKE ALL (%I) ON %I.%I FROM %s',col.attname,r.nspname,r.relname,target);
      END LOOP;
    END LOOP;
  END LOOP;
END;
$companion_seal$;

DO $seal$
DECLARE r record; g record; target text;
BEGIN
  FOR r IN SELECT c.oid,c.relowner,c.relacl,c.relname FROM pg_class c WHERE c.relnamespace='crm_external_private'::regnamespace
    AND c.relname IN ('booking_writer_releases','booking_writer_permits','booking_activation_permits') LOOP
    FOR g IN SELECT DISTINCT grantee FROM aclexplode(coalesce(r.relacl,acldefault('r',r.relowner))) WHERE grantee<>r.relowner LOOP
      target:=CASE WHEN g.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(g.grantee)) END;
      EXECUTE format('REVOKE ALL ON crm_external_private.%I FROM %s',r.relname,target);
    END LOOP;
  END LOOP;
  FOR r IN SELECT p.oid,p.proowner,p.proacl FROM pg_proc p WHERE p.pronamespace='crm_external_private'::regnamespace
    AND p.proname IN ('booking_writer_ready','begin_booking_write','end_booking_write','booking_sale_allowed',
      'booking_interest_allowed','booking_activation_allowed','guard_booking_plot_stock','enable_booking_writer') LOOP
    FOR g IN SELECT DISTINCT grantee FROM aclexplode(coalesce(r.proacl,acldefault('f',r.proowner))) WHERE grantee<>r.proowner LOOP
      target:=CASE WHEN g.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(g.grantee)) END;
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %s',r.oid::regprocedure,target);
    END LOOP;
  END LOOP;
END;
$seal$;

-- No enable_booking_writer call here: installation and activation are separate.
DO $after_commands$
DECLARE r record; result text; omitted text[];
BEGIN
  FOR r IN SELECT * FROM central_booking_baseline LOOP
    omitted:=CASE r.relname WHEN 'sales' THEN ARRAY['booking_revision','booking_visit_id']
      WHEN 'sales_customers' THEN ARRAY['lifecycle_revision']
      WHEN 'lead_project_interests' THEN ARRAY['lifecycle_revision'] ELSE ARRAY[]::text[] END;
    EXECUTE format('SELECT md5(coalesce(jsonb_agg(to_jsonb(t)-$1 ORDER BY (to_jsonb(t)-$1)::text)::text,''[]'')) FROM public.%I t',r.relname) INTO result USING omitted;
    IF result IS DISTINCT FROM r.data_hash OR EXISTS(SELECT 1 FROM pg_class c WHERE c.oid=r.oid
      AND (c.relacl IS DISTINCT FROM r.relacl OR c.relowner<>r.relowner OR c.relrowsecurity<>r.relrowsecurity)) THEN
      RAISE EXCEPTION 'CENTRAL_BOOKING_SHARED_BASELINE_CHANGED: %',r.relname;
    END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM public.crm_settings t,LATERAL jsonb_each(to_jsonb(t)) j
    WHERE (j.key LIKE '%\_enabled' ESCAPE '\' OR j.key='booking_cutover_reviewed') AND j.value='true')
    OR EXISTS(SELECT 1 FROM crm_external_private.booking_writer_releases) THEN
    RAISE EXCEPTION 'CENTRAL_BOOKING_UNEXPECTED_ACTIVATION';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_proc p,LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    WHERE p.pronamespace='public'::regnamespace AND p.proname IN ('crm_v2_central_search','crm_v2_central_search_capabilities',
      'crm_v2_booking_command','crm_v2_booking_context','crm_v2_project_sales','crm_v2_record_lead_work','crm_v2_change_lead_lifecycle')
      AND a.grantee<>p.proowner) THEN
    RAISE EXCEPTION 'CENTRAL_BOOKING_UNSEALED_API';
  END IF;
END;
$after_commands$;
COMMIT;
