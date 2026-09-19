-- SALES V2 LEAD WORK -- DESIGN ONLY, 2026-09-16.
-- Companion to the UNAPPLIED sales_workflow_v2_draft.sql, not a deployment migration.
-- Reuses lead_activities and crm_audit_events; no second contact/audit ledger.
-- Never run this file on Supabase. A separately reviewed migration and isolated
-- PostgreSQL/RLS/concurrency tests are required before any installation or enablement.
-- No legacy/backfill, stage/owner changes, SLA completion, Qualified credit or KPI score.
BEGIN;
DO $draft_only$
BEGIN
  RAISE EXCEPTION 'DESIGN ONLY: lead-work foundation is not authorized for database execution';
END;
$draft_only$;

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
ROLLBACK;
