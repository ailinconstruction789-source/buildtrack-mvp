-- SALES V2 FIRST-CONTACT PROCESSOR -- DESIGN ONLY, 2026-09-17.
-- NEVER RUN ON SUPABASE. Depends on UNAPPLIED base and 04--08 drafts.
-- NOT a deployment migration. Static tests do not validate PostgreSQL, RLS,
-- clock parity or concurrency. Separate isolated runtime tests are mandatory.
-- Manual Admin command plus the private shared apply core for guarded13.
-- No scheduler, UI, import, follow-up or KPI. Core extraction:2026-09-18.
BEGIN;
DO $draft_only$
BEGIN
  RAISE EXCEPTION 'DESIGN ONLY: first-contact processing is not authorized for database execution';
END;
$draft_only$;

ALTER TABLE public.crm_settings
  ADD COLUMN sla_processing_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN sla_due_soon_minutes integer NOT NULL DEFAULT 30 CHECK (sla_due_soon_minutes BETWEEN 0 AND 1440);

CREATE TABLE sales_private.crm_first_contact_processing_requests (
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL,
  task_id uuid NOT NULL REFERENCES public.crm_sla_tasks(id) ON DELETE RESTRICT,
  request_payload jsonb NOT NULL CHECK (jsonb_typeof(request_payload)='object'),
  response jsonb NOT NULL CHECK (jsonb_typeof(response)='object'),
  created_at timestamptz NOT NULL CHECK (isfinite(created_at)),
  PRIMARY KEY (actor_user_id,request_id)
);
ALTER TABLE sales_private.crm_first_contact_processing_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sales_private.crm_first_contact_processing_requests FROM PUBLIC, anon, authenticated;

CREATE FUNCTION sales_private.crm_first_contact_history_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog
AS $immutable$
BEGIN
  RAISE EXCEPTION 'CRM_SLA_PROCESS_INVALID_INPUT';
END;
$immutable$;
REVOKE ALL ON FUNCTION sales_private.crm_first_contact_history_immutable() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER crm_first_contact_receipt_immutable BEFORE UPDATE OR DELETE ON sales_private.crm_first_contact_processing_requests
  FOR EACH ROW EXECUTE FUNCTION sales_private.crm_first_contact_history_immutable();
CREATE TRIGGER crm_first_contact_audit_immutable BEFORE UPDATE OR DELETE ON public.crm_audit_events
  FOR EACH ROW WHEN (OLD.entity_type='crm_sla_task' AND OLD.event_type='first_contact_processed')
  EXECUTE FUNCTION sales_private.crm_first_contact_history_immutable();

-- Pure typed clock: input comes only from locked trusted rows, never browser JSON.
-- Partition at every source boundary; retain slices covered by work and by NO
-- leave/break interval. This is subtraction of their union, not double subtraction.
-- PostgreSQL timestamps/intervals retain microseconds; no float/date truncation.
CREATE FUNCTION sales_private.crm_first_contact_clock(
  p_anchor timestamptz,p_service timestamptz,p_owner uuid,
  p_from timestamptz,p_through timestamptz,p_complete boolean,
  p_ids uuid[],p_owners uuid[],p_types text[],p_starts timestamptz[],p_ends timestamptz[],
  p_now timestamptz,p_due_soon integer
)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog SET timezone = 'UTC'
AS $clock$
DECLARE
  size integer:=COALESCE(cardinality(p_ids),0); idx integer;
  segment_starts timestamptz[]; segment_ends timestamptz[];
  staff_due timestamptz; notify_at_value timestamptz; count_from timestamptz; first_work timestamptz;
  remaining interval:=interval '7200 seconds'; duration_value interval;
  rule_value text; kind_value text; threshold_at timestamptz; eligible_from timestamptz; available_value timestamptz;
  minimum_at constant timestamptz:=TIMESTAMPTZ '0001-01-01 00:00:00+00';
  maximum_at constant timestamptz:=TIMESTAMPTZ '9999-12-31 23:59:59.999999+00';
BEGIN
  IF p_complete IS DISTINCT FROM true THEN
    RETURN jsonb_build_object('ready',false,'reason','INSUFFICIENT_COVERAGE');
  END IF;
  IF p_owner IS NULL THEN
    RETURN jsonb_build_object('ready',false,'reason','INVALID_CALENDAR');
  END IF;
  IF p_from IS NULL OR p_through IS NULL OR NOT isfinite(p_from) OR NOT isfinite(p_through)
    OR p_from<minimum_at OR p_through>maximum_at OR p_from>=p_through
    OR p_through-p_from>interval '31622400 seconds' THEN
    RETURN jsonb_build_object('ready',false,'reason','INVALID_CALENDAR');
  END IF;
  IF p_anchor IS NULL OR p_service IS NULL OR p_now IS NULL
    OR NOT isfinite(p_anchor) OR NOT isfinite(p_service) OR NOT isfinite(p_now)
    OR p_anchor<minimum_at OR p_anchor>maximum_at OR p_service<minimum_at OR p_service>maximum_at
    OR p_now<minimum_at OR p_now>maximum_at OR p_service<p_anchor OR p_anchor>p_now THEN
    RETURN jsonb_build_object('ready',false,'reason','SOURCE_TIME_REVIEW');
  END IF;
  IF p_due_soon IS NULL OR p_due_soon<0 OR p_due_soon>1440 THEN
    RETURN jsonb_build_object('ready',false,'reason','POLICY_REVIEW');
  END IF;
  IF p_ids IS NULL OR p_owners IS NULL OR p_types IS NULL OR p_starts IS NULL OR p_ends IS NULL OR size>400
    OR cardinality(p_owners)<>size OR cardinality(p_types)<>size OR cardinality(p_starts)<>size OR cardinality(p_ends)<>size
    OR COALESCE(array_ndims(p_ids),1)<>1 OR COALESCE(array_ndims(p_owners),1)<>1
    OR COALESCE(array_ndims(p_types),1)<>1 OR COALESCE(array_ndims(p_starts),1)<>1 OR COALESCE(array_ndims(p_ends),1)<>1
    OR (size>0 AND (array_lower(p_ids,1)<>1 OR array_lower(p_owners,1)<>1 OR array_lower(p_types,1)<>1
      OR array_lower(p_starts,1)<>1 OR array_lower(p_ends,1)<>1)) THEN
    RETURN jsonb_build_object('ready',false,'reason','INVALID_CALENDAR');
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_ids,p_owners,p_types,p_starts,p_ends) p(id,owner_id,kind,starts_at,ends_at)
    WHERE p.id IS NULL OR p.owner_id IS DISTINCT FROM p_owner OR p.kind IS NULL OR p.kind NOT IN ('work','leave','break')
      OR p.starts_at IS NULL OR p.ends_at IS NULL OR NOT isfinite(p.starts_at) OR NOT isfinite(p.ends_at)
      OR p.starts_at<minimum_at OR p.ends_at>maximum_at OR p.starts_at>=p.ends_at
      OR (p.kind='work' AND (p.starts_at<p_from OR p.ends_at>p_through)))
    OR (SELECT count(DISTINCT id) FROM unnest(p_ids) ids(id))<>size THEN
    RETURN jsonb_build_object('ready',false,'reason','INVALID_CALENDAR');
  END IF;
  IF EXISTS (SELECT 1 FROM (
    SELECT starts_at,max(ends_at) OVER (ORDER BY starts_at,ends_at ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) prior_end
    FROM unnest(p_types,p_starts,p_ends) p(kind,starts_at,ends_at) WHERE kind='work'
  ) checked WHERE starts_at<prior_end) THEN
    RETURN jsonb_build_object('ready',false,'reason','INVALID_CALENDAR');
  END IF;
  WITH raw AS (
    SELECT * FROM unnest(p_types,p_starts,p_ends) p(kind,starts_at,ends_at)
  ), boundaries AS (
    SELECT greatest(starts_at,p_from) AS boundary FROM raw WHERE starts_at<p_through AND ends_at>p_from
    UNION SELECT least(ends_at,p_through) FROM raw WHERE starts_at<p_through AND ends_at>p_from
  ), pieces AS (
    SELECT boundary AS starts_at,lead(boundary) OVER (ORDER BY boundary) AS ends_at FROM boundaries
  ), actual AS (
    SELECT s.starts_at,s.ends_at FROM pieces s WHERE s.starts_at<s.ends_at
      AND EXISTS (SELECT 1 FROM raw w WHERE w.kind='work' AND w.starts_at<=s.starts_at AND w.ends_at>=s.ends_at)
      AND NOT EXISTS (SELECT 1 FROM raw x WHERE x.kind IN ('leave','break') AND x.starts_at<s.ends_at AND x.ends_at>s.starts_at)
  )
  SELECT COALESCE(array_agg(starts_at ORDER BY starts_at),'{}'::timestamptz[]),
    COALESCE(array_agg(ends_at ORDER BY starts_at),'{}'::timestamptz[]) INTO segment_starts,segment_ends FROM actual;
  IF p_anchor<p_from OR p_anchor>=p_through OR p_now<p_from OR p_now>=p_through THEN
    RETURN jsonb_build_object('ready',false,'reason','INSUFFICIENT_COVERAGE');
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(segment_starts,segment_ends) s(starts_at,ends_at) WHERE starts_at<=p_anchor AND p_anchor<ends_at) THEN
    IF p_service<p_from OR p_service>=p_through THEN
      RETURN jsonb_build_object('ready',false,'reason','INSUFFICIENT_COVERAGE');
    END IF;
    notify_at_value:=p_anchor;
    IF EXISTS (SELECT 1 FROM unnest(segment_starts,segment_ends) s(starts_at,ends_at) WHERE starts_at<=p_service AND p_service<ends_at) THEN
      staff_due:=p_service; rule_value:='service_deadline';
    ELSE count_from:=p_service; rule_value:='off_shift_service_deadline'; END IF;
  ELSE count_from:=p_anchor; rule_value:='out_of_hours'; END IF;
  IF staff_due IS NULL THEN
    FOR idx IN 1..cardinality(segment_starts) LOOP
      IF segment_starts[idx]<count_from THEN CONTINUE; END IF;
      IF first_work IS NULL THEN first_work:=segment_starts[idx]; END IF;
      duration_value:=segment_ends[idx]-segment_starts[idx];
      IF remaining<=duration_value THEN staff_due:=segment_starts[idx]+remaining; EXIT; END IF;
      remaining:=remaining-duration_value;
    END LOOP;
    IF staff_due IS NULL THEN RETURN jsonb_build_object('ready',false,'reason','INSUFFICIENT_COVERAGE'); END IF;
    IF rule_value='out_of_hours' THEN notify_at_value:=first_work; END IF;
  END IF;
  IF notify_at_value IS NULL OR notify_at_value<p_from OR notify_at_value>=p_through
    OR staff_due<p_from OR staff_due>p_through OR notify_at_value>staff_due THEN
    RETURN jsonb_build_object('ready',false,'reason','STAFF_CALCULATION_REVIEW');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM unnest(segment_starts,segment_ends) s(starts_at,ends_at) WHERE starts_at<=p_now AND p_now<ends_at) THEN
    RETURN jsonb_build_object('ready',true,'reason','OUTSIDE_WORKING_HOURS','staffDueAt',staff_due,'notifyAt',notify_at_value,'rule',rule_value);
  END IF;
  kind_value:=CASE WHEN p_now>staff_due THEN 'overdue' ELSE 'due_soon' END;
  -- 1 microsecond after staff due is the first overdue instant. At the exact
  -- deadline a zero-minute warning remains due_soon, never prematurely overdue.
  threshold_at:=CASE WHEN kind_value='overdue' THEN staff_due+interval '0.000001 seconds'
    ELSE staff_due-(interval '60 seconds'*p_due_soon) END;
  eligible_from:=greatest(notify_at_value,threshold_at);
  IF p_now<eligible_from THEN
    RETURN jsonb_build_object('ready',true,'reason','NOT_DUE_YET','staffDueAt',staff_due,'notifyAt',notify_at_value,'rule',rule_value);
  END IF;
  SELECT greatest(starts_at,eligible_from) INTO available_value
    FROM unnest(segment_starts,segment_ends) s(starts_at,ends_at)
    WHERE ends_at>eligible_from AND starts_at<=p_now ORDER BY starts_at LIMIT 1;
  IF available_value IS NULL THEN RETURN jsonb_build_object('ready',false,'reason','REMINDER_REVIEW'); END IF;
  RETURN jsonb_build_object('ready',true,'reason',CASE WHEN kind_value='overdue' THEN 'OVERDUE' ELSE 'DUE_SOON' END,
    'staffDueAt',staff_due,'notifyAt',notify_at_value,'rule',rule_value,'notificationType',kind_value,'availableAt',available_value);
END;
$clock$;
REVOKE ALL ON FUNCTION sales_private.crm_first_contact_clock(timestamptz,timestamptz,uuid,timestamptz,timestamptz,boolean,uuid[],uuid[],text[],timestamptz[],timestamptz[],timestamptz,integer) FROM PUBLIC, anon, authenticated;

-- Compare validated instants, not JSON text: 04's audit/receipt can retain a
-- legitimate +07:00 offset while this function serializes its output in UTC.
CREATE FUNCTION sales_private.crm_first_contact_time_matches(p_value jsonb,p_expected timestamptz)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog
AS $time_matches$
BEGIN
  IF jsonb_typeof(p_value) IS DISTINCT FROM 'string' OR p_expected IS NULL THEN RETURN false; END IF;
  RETURN sales_private.crm_work_timestamp(p_value#>>'{}')=p_expected;
EXCEPTION WHEN raise_exception OR invalid_text_representation OR datetime_field_overflow THEN
  RETURN false;
END;
$time_matches$;
REVOKE ALL ON FUNCTION sales_private.crm_first_contact_time_matches(jsonb,timestamptz) FROM PUBLIC, anon, authenticated;

-- Read helper ONLY for callers holding the customer's write lock. Current 04/05
-- writers share that lock; every FUTURE correction/import writer must too. Never
-- authorize arbitrary privileged writes or infer immutable evidence from a flag.
CREATE FUNCTION sales_private.crm_first_contact_completion(p_customer uuid,p_owner uuid,p_anchor timestamptz,p_first_contacted timestamptz,p_now timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog SET timezone = 'UTC'
AS $completion$
DECLARE
  activity_row public.lead_activities%ROWTYPE; scanned integer:=0;
  evidence_count bigint; valid_count bigint; first_id uuid; first_at timestamptz;
  original_request sales_private.lead_work_command_requests%ROWTYPE;
  next_action_row public.crm_next_actions%ROWTYPE; request_count bigint; proof_next_id uuid;
BEGIN
  -- No correction resolver is approved yet. Review ALL relevant contact/plan
  -- correction edges before looking only at successes, including an original
  -- no_answer/other attempt and corrections carrying different own metadata.
  IF EXISTS (SELECT 1 FROM public.crm_audit_events correction
    LEFT JOIN public.crm_audit_events original ON original.id=correction.correction_of_event_id
    WHERE correction.correction_of_event_id IS NOT NULL AND (
      (original.customer_id=p_customer AND original.entity_type IN ('crm_next_action','lead_activity','lead_activities','activity'))
      OR (correction.customer_id=p_customer AND correction.entity_type IN ('crm_next_action','lead_activity','lead_activities','activity'))
      OR EXISTS (SELECT 1 FROM public.crm_next_actions n WHERE n.customer_id=p_customer
        AND ((original.entity_type='crm_next_action' AND original.entity_id=n.id)
          OR (correction.entity_type='crm_next_action' AND correction.entity_id=n.id)))
      OR EXISTS (SELECT 1 FROM public.lead_activities a WHERE a.customer_id=p_customer
        AND ((original.entity_type IN ('lead_activity','lead_activities','activity') AND original.entity_id=a.id)
          OR (correction.entity_type IN ('lead_activity','lead_activities','activity') AND correction.entity_id=a.id))))) THEN
    RETURN jsonb_build_object('state','review');
  END IF;
  -- A success changed into a non-success must not disappear from the success
  -- scan. Its original private receipt is independent evidence of a dispute.
  IF EXISTS (SELECT 1 FROM sales_private.lead_work_command_requests r
    LEFT JOIN public.lead_activities a ON a.id::text=r.response->>'activityId'
    WHERE r.request_payload->>'command'='record_attempt' AND r.request_payload#>>'{attempt,result}'='contact_success'
      AND (lower(r.request_payload->>'customerId')=p_customer::text OR a.customer_id=p_customer)
      AND (a.id IS NULL OR a.customer_id IS DISTINCT FROM p_customer OR a.result IS DISTINCT FROM 'contact_success')) THEN
    RETURN jsonb_build_object('state','review');
  END IF;
  FOR activity_row IN SELECT * FROM public.lead_activities WHERE customer_id=p_customer AND result='contact_success'
    ORDER BY occurred_at,recorded_at,id LIMIT 101
  LOOP
    scanned:=scanned+1;
    IF scanned>100 THEN RETURN jsonb_build_object('state','review'); END IF;
    IF activity_row.project_interest_id IS NOT NULL OR activity_row.sale_id IS NOT NULL
      OR activity_row.activity_type<>'follow_up' OR activity_row.performed_by_user_id IS NULL
      OR activity_row.performed_by_user_id IS DISTINCT FROM activity_row.recorded_by_user_id
      OR activity_row.contact_channel IS NULL OR activity_row.contact_channel NOT IN ('phone','chat','email','in_person','other')
      OR activity_row.action_text IS NULL OR length(btrim(activity_row.action_text)) NOT BETWEEN 1 AND 500
      OR NOT isfinite(activity_row.occurred_at) OR NOT isfinite(activity_row.recorded_at)
      OR activity_row.next_follow_up_at IS NULL OR NOT isfinite(activity_row.next_follow_up_at)
      OR activity_row.next_follow_up_at<=activity_row.recorded_at
      OR activity_row.next_follow_up_at>TIMESTAMPTZ '9999-12-31 23:59:59.999999+00'
      OR activity_row.occurred_at<p_anchor OR activity_row.occurred_at>activity_row.recorded_at OR activity_row.recorded_at>p_now THEN
      RETURN jsonb_build_object('state','review');
    END IF;
    SELECT count(*),count(*) FILTER (WHERE a.customer_id=p_customer AND a.entity_type='crm_next_action'
      AND a.event_type='record_attempt' AND a.actor_kind='staff' AND a.correction_of_event_id IS NULL
      AND a.actor_user_id=activity_row.recorded_by_user_id AND a.actor_user_id=activity_row.performed_by_user_id
      AND a.occurred_at=activity_row.recorded_at AND a.recorded_at=activity_row.recorded_at
      AND jsonb_typeof(a.new_values)='object' AND a.new_values->'interestId'='null'::jsonb
      AND a.new_values->>'ownerUserId'=p_owner::text AND a.new_values->>'nextActionId'=a.entity_id::text
      AND EXISTS (SELECT 1 FROM public.crm_next_actions next_action WHERE next_action.id=a.entity_id
        AND next_action.customer_id=p_customer AND next_action.project_interest_id IS NULL
        AND next_action.owner_user_id=p_owner AND next_action.source_activity_id=activity_row.id
        AND next_action.recorded_by_user_id=a.actor_user_id AND next_action.recorded_at=activity_row.recorded_at
        AND next_action.plan_started_at=activity_row.recorded_at
        AND next_action.due_at=activity_row.next_follow_up_at
        AND a.new_values->>'action'=next_action.action_text
        AND sales_private.crm_first_contact_time_matches(a.new_values->'dueAt',next_action.due_at)
        AND next_action.previous_action_id IS NOT DISTINCT FROM activity_row.related_next_action_id)
      AND NOT EXISTS (SELECT 1 FROM public.crm_audit_events correction
        WHERE correction.correction_of_event_id=a.id
          OR (correction.correction_of_event_id IS NOT NULL AND correction.entity_type='crm_next_action' AND correction.entity_id=a.entity_id)))
      INTO evidence_count,valid_count FROM (SELECT * FROM public.crm_audit_events
        WHERE new_values->>'activityId'=activity_row.id::text LIMIT 2) a;
    IF evidence_count<>1 OR valid_count<>1 OR EXISTS (SELECT 1 FROM public.crm_audit_events a
      WHERE a.entity_id=activity_row.id AND a.entity_type IN ('lead_activity','lead_activities','activity')) THEN
      RETURN jsonb_build_object('state','review');
    END IF;
    -- 04's audit does not snapshot the attempt's result/channel/event time. Bind
    -- all three (and both action texts) to its exact original private receipt.
    -- Historical activities/04 receipts remain append-only rollout prerequisites;
    -- no new generic mutation authority is introduced for either old table.
    SELECT a.entity_id INTO proof_next_id FROM public.crm_audit_events a
      WHERE a.new_values->>'activityId'=activity_row.id::text;
    SELECT * INTO next_action_row FROM public.crm_next_actions WHERE id=proof_next_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('state','review'); END IF;
    SELECT count(*) INTO request_count FROM (SELECT 1 FROM sales_private.lead_work_command_requests r
      WHERE r.response->>'activityId'=activity_row.id::text LIMIT 2) matches;
    IF request_count<>1 THEN RETURN jsonb_build_object('state','review'); END IF;
    SELECT * INTO original_request FROM sales_private.lead_work_command_requests r
      WHERE r.response->>'activityId'=activity_row.id::text;
    IF original_request.actor_user_id IS DISTINCT FROM activity_row.recorded_by_user_id
      OR original_request.created_at IS DISTINCT FROM activity_row.recorded_at
      OR jsonb_typeof(original_request.request_payload) IS DISTINCT FROM 'object'
      OR octet_length(original_request.request_payload::text)>16384
      OR original_request.request_payload->>'command' IS DISTINCT FROM 'record_attempt'
      OR lower(original_request.request_payload->>'customerId') IS DISTINCT FROM p_customer::text
      OR original_request.request_payload->'interestId' IS DISTINCT FROM 'null'::jsonb
      OR original_request.response->>'nextActionId' IS DISTINCT FROM proof_next_id::text
      OR original_request.response->'replayed' IS DISTINCT FROM 'false'::jsonb
      OR jsonb_typeof(original_request.request_payload->'attempt') IS DISTINCT FROM 'object'
      OR jsonb_typeof(original_request.request_payload->'nextAction') IS DISTINCT FROM 'object'
      OR original_request.request_payload#>>'{attempt,result}' IS DISTINCT FROM activity_row.result
      OR original_request.request_payload#>>'{attempt,channel}' IS DISTINCT FROM activity_row.contact_channel
      OR (activity_row.related_next_action_id IS NULL AND original_request.request_payload->'expectedActionId' IS DISTINCT FROM 'null'::jsonb)
      OR (activity_row.related_next_action_id IS NOT NULL
        AND lower(original_request.request_payload->>'expectedActionId') IS DISTINCT FROM activity_row.related_next_action_id::text)
      OR jsonb_typeof(original_request.request_payload#>'{attempt,action}') IS DISTINCT FROM 'string'
      OR jsonb_typeof(original_request.request_payload#>'{attempt,occurredAt}') IS DISTINCT FROM 'string'
      OR jsonb_typeof(original_request.request_payload#>'{nextAction,action}') IS DISTINCT FROM 'string'
      OR jsonb_typeof(original_request.request_payload#>'{nextAction,dueAt}') IS DISTINCT FROM 'string' THEN
      RETURN jsonb_build_object('state','review');
    END IF;
    BEGIN
      IF sales_private.crm_work_text(original_request.request_payload#>>'{attempt,action}',500) IS DISTINCT FROM activity_row.action_text
        OR sales_private.crm_work_timestamp(original_request.request_payload#>>'{attempt,occurredAt}') IS DISTINCT FROM activity_row.occurred_at
        OR sales_private.crm_work_text(original_request.request_payload#>>'{nextAction,action}',500) IS DISTINCT FROM next_action_row.action_text
        OR sales_private.crm_work_timestamp(original_request.request_payload#>>'{nextAction,dueAt}') IS DISTINCT FROM next_action_row.due_at THEN
        RETURN jsonb_build_object('state','review');
      END IF;
    EXCEPTION WHEN raise_exception OR invalid_text_representation OR datetime_field_overflow THEN
      -- Read validation only. Never catch a processing mutation/transaction error.
      RETURN jsonb_build_object('state','review');
    END;
    IF first_id IS NULL THEN first_id:=activity_row.id; first_at:=activity_row.occurred_at; END IF;
  END LOOP;
  IF p_first_contacted IS NOT NULL AND (first_at IS NULL OR p_first_contacted IS DISTINCT FROM first_at) THEN
    RETURN jsonb_build_object('state','review');
  END IF;
  IF first_id IS NULL THEN RETURN jsonb_build_object('state','none'); END IF;
  RETURN jsonb_build_object('state','proven','activityId',first_id,'occurredAt',first_at);
END;
$completion$;
REVOKE ALL ON FUNCTION sales_private.crm_first_contact_completion(uuid,uuid,timestamptz,timestamptz,timestamptz) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.crm_v2_sla_processing_capabilities()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $capabilities$
  SELECT jsonb_build_object('contract_version','first_contact_processing_v1','enabled',
    public.crm_v2_role()='admin' AND COALESCE((SELECT central_intake_enabled AND lead_work_enabled
      AND lead_lifecycle_enabled AND work_schedule_enabled AND notifications_enabled AND sla_preview_enabled AND sla_processing_enabled
      FROM public.crm_settings WHERE id),false));
$capabilities$;
REVOKE ALL ON FUNCTION public.crm_v2_sla_processing_capabilities() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_v2_sla_processing_capabilities() TO authenticated;

-- Lock order: settings -> per-Admin request -> customer -> SAME 06 Sales advisory
-- -> calendar head -> ordered Admin/owner role rows -> task -> ordered notices.
-- Future activity/correction/import/delivery writers MUST honor the customer/task
-- locks. Privileged paths bypassing this protocol must be retired before rollout.
-- Shared mutation core. ONLY locked trusted composite snapshots from09/13 enter.
-- Private SECURITY INVOKER: no caller can elevate privilege through this helper.
-- Authority, full parent-lock ordering and durable receipts belong to wrappers.
-- The approved clock/completion/dedupe logic lives here once; time is DB-owned.
CREATE FUNCTION sales_private.crm_first_contact_apply(
  settings_row public.crm_settings,customer_row public.sales_customers,task_row public.crm_sla_tasks,
  head_row sales_private.crm_work_calendars,owner_active boolean,
  actor_id uuid,actor_name text,actor_kind_value text,request_id_value uuid
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog SET timezone = 'UTC'
AS $apply$
DECLARE
  version_row sales_private.crm_work_calendar_versions%ROWTYPE;
  notice_row public.crm_notifications%ROWTYPE;
  server_now timestamptz; original_hours integer; creation_count bigint; valid_creation_count bigint;
  creation_proven boolean; unchanged_owner boolean; completion_json jsonb; clock_json jsonb;
  period_ids uuid[]; period_owners uuid[]; period_types text[]; period_starts timestamptz[]; period_ends timestamptz[];
  outcome_value text:='held'; reason_value text; staff_due timestamptz; notify_value timestamptz; available_value timestamptz;
  complete_id uuid; complete_at timestamptz; notice_id uuid; notice_type text; binding_json jsonb; next_evaluation jsonb;
  next_accountability text; next_status text; due_key text; overdue_key text; selected_key text;
  withdrawn_count bigint:=0; response_value jsonb; policy_version constant text:='first_contact_processing_v1';
  minimum_at constant timestamptz:=TIMESTAMPTZ '0001-01-01 00:00:00+00';
  maximum_at constant timestamptz:=TIMESTAMPTZ '9999-12-31 23:59:59.999999+00';
BEGIN
  IF actor_kind_value IS NULL OR actor_kind_value NOT IN ('staff','system')
    OR (actor_kind_value='staff' AND actor_id IS NULL) OR (actor_kind_value='system' AND actor_id IS NOT NULL)
    OR request_id_value IS NULL OR settings_row.id IS DISTINCT FROM true
    OR customer_row.id IS NULL OR task_row.id IS NULL OR task_row.customer_id IS DISTINCT FROM customer_row.id
    OR task_row.task_type IS DISTINCT FROM 'first_contact' OR task_row.project_interest_id IS NOT NULL
    OR task_row.source_activity_id IS NOT NULL
    OR (head_row.id IS NOT NULL AND head_row.sales_user_id IS DISTINCT FROM task_row.owner_user_id) THEN
    RAISE EXCEPTION 'CRM_SLA_PROCESS_INVALID_INPUT';
  END IF;
  FOR notice_row IN SELECT * FROM public.crm_notifications WHERE task_id=task_row.id ORDER BY id FOR UPDATE LOOP
    NULL;
  END LOOP;
  server_now:=clock_timestamp();
  IF NOT isfinite(server_now) OR server_now<minimum_at OR server_now>maximum_at
    OR NOT isfinite(task_row.service_due_at) OR task_row.service_due_at<minimum_at OR task_row.service_due_at>maximum_at THEN
    RAISE EXCEPTION 'CRM_SLA_PROCESS_SETUP_REQUIRED';
  END IF;

  -- Every nonterminal branch is conservative. Held reviews are not contact
  -- success, task cancellation, score changes or a reset of the service clock.
  IF task_row.status<>'open' THEN outcome_value:='closed'; reason_value:='TASK_CLOSED';
  ELSIF customer_row.merged_into_customer_id IS NOT NULL OR customer_row.intake_status='lost' THEN reason_value:='SCOPE_CLOSED';
  ELSIF customer_row.record_origin<>'live' THEN reason_value:='LEGACY_REVIEW';
  ELSIF task_row.owner_user_id IS NULL OR task_row.owner_user_id IS DISTINCT FROM customer_row.owner_user_id
    OR owner_active IS DISTINCT FROM true THEN reason_value:='OWNER_NOT_READY';
  ELSIF jsonb_typeof(task_row.evaluation_snapshot) IS DISTINCT FROM 'object' OR task_row.evaluation_snapshot ? 'lifecycleReview' THEN
    reason_value:='OWNER_REVIEW';
  END IF;

  IF reason_value IS NULL THEN
    SELECT count(*),count(*) FILTER (WHERE a.customer_id=customer_row.id
      AND a.actor_kind='staff' AND a.actor_user_id=customer_row.created_by_user_id AND a.correction_of_event_id IS NULL
      AND isfinite(a.occurred_at) AND isfinite(a.recorded_at)
      AND a.occurred_at=customer_row.lead_created_at AND a.occurred_at=task_row.obligation_started_at
      AND a.recorded_at>=a.occurred_at AND a.recorded_at<=server_now
      AND jsonb_typeof(a.new_values)='object' AND jsonb_typeof(a.new_values->'ownerUserId')='string'
      AND a.new_values->>'ownerUserId'=customer_row.owner_user_id::text
      AND NOT EXISTS (SELECT 1 FROM public.crm_audit_events correction WHERE correction.correction_of_event_id=a.id))
      INTO creation_count,valid_creation_count FROM (SELECT * FROM public.crm_audit_events
        WHERE entity_type='customer' AND entity_id=customer_row.id AND event_type='created' LIMIT 2) a;
    creation_proven:=creation_count=1 AND valid_creation_count=1;
    unchanged_owner:=COALESCE(creation_proven AND customer_row.owner_assigned_at=customer_row.lead_created_at
      AND NOT EXISTS (SELECT 1 FROM public.crm_audit_events a WHERE a.entity_id=customer_row.id
        AND a.entity_type IN ('sales_customer','customer') AND a.event_type='reassign_owner')
      AND NOT EXISTS (SELECT 1 FROM public.crm_audit_events correction
        LEFT JOIN public.crm_audit_events original ON original.id=correction.correction_of_event_id
        WHERE correction.correction_of_event_id IS NOT NULL
          AND ((correction.entity_id=customer_row.id AND correction.entity_type IN ('customer','sales_customer'))
            OR (original.entity_id=customer_row.id AND original.entity_type IN ('customer','sales_customer')))),false);
    IF NOT creation_proven THEN reason_value:='MISSING_CREATION_EVIDENCE';
    ELSIF NOT unchanged_owner THEN reason_value:='OWNER_REVIEW'; END IF;
  END IF;
  IF reason_value IS NULL THEN
    original_hours:=CASE WHEN jsonb_typeof(task_row.evaluation_snapshot->'initialContactHours')='number' THEN
      CASE WHEN (task_row.evaluation_snapshot->>'initialContactHours') ~ '^[1-9][0-9]{0,9}$' THEN
        CASE WHEN (task_row.evaluation_snapshot->>'initialContactHours')::bigint<=2147483647
          THEN (task_row.evaluation_snapshot->>'initialContactHours')::integer ELSE NULL END ELSE NULL END ELSE NULL END;
    -- Storage permits later configuration; this approved rollout remains exactly
    -- 24 elapsed hours / 120 actual working minutes / 30-minute warning, matching
    -- the current preview. A future policy change needs preview/UI/tests too.
    IF original_hours IS DISTINCT FROM 24 OR settings_row.initial_contact_hours<>24 OR settings_row.next_shift_response_minutes<>120
      OR settings_row.sla_due_soon_minutes<>30 THEN reason_value:='POLICY_REVIEW';
    ELSIF customer_row.lead_created_at IS NULL OR NOT isfinite(customer_row.lead_created_at)
      OR customer_row.lead_created_at<minimum_at OR customer_row.lead_created_at>maximum_at-interval '86400 seconds'
      OR customer_row.lead_created_at>server_now OR NOT isfinite(task_row.obligation_started_at)
      OR task_row.obligation_started_at IS DISTINCT FROM customer_row.lead_created_at
      OR NOT isfinite(task_row.created_at) OR task_row.created_at<customer_row.lead_created_at OR task_row.created_at>server_now THEN
      reason_value:='SOURCE_TIME_REVIEW';
    ELSIF task_row.service_due_at IS DISTINCT FROM customer_row.lead_created_at+interval '86400 seconds' THEN
      reason_value:='SOURCE_TIME_REVIEW';
    ELSIF task_row.completed_at IS NOT NULL OR task_row.completed_by_activity_id IS NOT NULL THEN reason_value:='CONTACT_REVIEW';
    ELSIF task_row.accountability_state='exception' OR task_row.cancelled_at IS NOT NULL OR task_row.cancelled_by_user_id IS NOT NULL
      OR task_row.cancellation_reason IS NOT NULL THEN reason_value:='EXCEPTION_REVIEW';
    ELSIF EXISTS (SELECT 1 FROM public.lead_activities a WHERE a.customer_id=customer_row.id AND a.result='customer_requested_later')
      OR EXISTS (SELECT 1 FROM public.crm_sla_exceptions e WHERE e.task_id=task_row.id AND e.exception_type='customer_requested_later') THEN
      reason_value:='CUSTOMER_POSTPONEMENT';
    ELSIF EXISTS (SELECT 1 FROM public.crm_sla_exceptions e WHERE e.task_id=task_row.id) THEN reason_value:='EXCEPTION_REVIEW'; END IF;
  END IF;
  IF reason_value IS NULL THEN
    completion_json:=sales_private.crm_first_contact_completion(customer_row.id,task_row.owner_user_id,
      task_row.obligation_started_at,customer_row.first_contacted_at,server_now);
    IF completion_json->>'state'='review' THEN reason_value:='CONTACT_REVIEW';
    ELSIF completion_json->>'state'='proven' THEN
      outcome_value:='completed'; reason_value:='CONTACT_PROVEN';
      complete_id:=(completion_json->>'activityId')::uuid; complete_at:=(completion_json->>'occurredAt')::timestamptz;
    ELSIF completion_json->>'state' IS DISTINCT FROM 'none' THEN reason_value:='CONTACT_REVIEW'; END IF;
  END IF;
  -- Proven completion needs no usable calendar. Only calculation/delivery does.
  IF reason_value IS NULL THEN
    IF head_row.id IS NULL THEN reason_value:='MISSING_CALENDAR';
    ELSE
      SELECT * INTO version_row FROM sales_private.crm_work_calendar_versions
        WHERE id=head_row.current_version_id AND calendar_id=head_row.id AND sales_user_id=task_row.owner_user_id;
      IF NOT FOUND OR version_row.published_at IS NULL OR NOT isfinite(version_row.published_at) OR version_row.published_at>server_now THEN
        reason_value:='INVALID_CALENDAR';
      ELSE
        WITH bounded AS (SELECT id,sales_user_id,period_type,starts_at,ends_at FROM public.crm_work_periods
          WHERE calendar_version_id=version_row.id ORDER BY starts_at,id LIMIT 401)
        SELECT COALESCE(array_agg(id ORDER BY starts_at,id),'{}'::uuid[]),
          COALESCE(array_agg(sales_user_id ORDER BY starts_at,id),'{}'::uuid[]),
          COALESCE(array_agg(period_type ORDER BY starts_at,id),'{}'::text[]),
          COALESCE(array_agg(starts_at ORDER BY starts_at,id),'{}'::timestamptz[]),
          COALESCE(array_agg(ends_at ORDER BY starts_at,id),'{}'::timestamptz[])
          INTO period_ids,period_owners,period_types,period_starts,period_ends FROM bounded;
        clock_json:=sales_private.crm_first_contact_clock(customer_row.lead_created_at,task_row.service_due_at,task_row.owner_user_id,
          version_row.coverage_starts_at,version_row.coverage_ends_at,version_row.coverage_complete,
          period_ids,period_owners,period_types,period_starts,period_ends,server_now,settings_row.sla_due_soon_minutes);
        reason_value:=clock_json->>'reason';
        IF clock_json->'ready'='true'::jsonb THEN
          outcome_value:='scheduled'; staff_due:=(clock_json->>'staffDueAt')::timestamptz;
          notify_value:=(clock_json->>'notifyAt')::timestamptz;
          notice_type:=clock_json->>'notificationType'; available_value:=(clock_json->>'availableAt')::timestamptz;
          binding_json:=jsonb_build_object('state','ready','ownerUserId',task_row.owner_user_id,
            'lifecycleRevision',customer_row.lifecycle_revision,'calendarId',head_row.id,'calendarVersion',version_row.id,
            'policyVersion',policy_version,'settingsVersion',settings_row.version,'dueSoonMinutes',settings_row.sla_due_soon_minutes);
          due_key:='first_contact_delivery_v1:'||jsonb_build_array(task_row.id,task_row.owner_user_id,customer_row.lifecycle_revision,
            head_row.id,version_row.id,staff_due,policy_version,settings_row.version,settings_row.sla_due_soon_minutes,'due_soon')::text;
          overdue_key:='first_contact_delivery_v1:'||jsonb_build_array(task_row.id,task_row.owner_user_id,customer_row.lifecycle_revision,
            head_row.id,version_row.id,staff_due,policy_version,settings_row.version,settings_row.sla_due_soon_minutes,'overdue')::text;
          IF notice_type IS NOT NULL THEN selected_key:=CASE WHEN notice_type='overdue' THEN overdue_key ELSE due_key END; END IF;
        END IF;
      END IF;
    END IF;
  END IF;
  IF reason_value IS NULL THEN reason_value:='REMINDER_REVIEW'; END IF;
  next_status:=CASE WHEN outcome_value='completed' THEN 'done' ELSE task_row.status END;
  next_accountability:=CASE WHEN outcome_value='scheduled' THEN 'ready'
    WHEN outcome_value IN ('completed','closed') THEN task_row.accountability_state
    WHEN task_row.accountability_state='exception' THEN 'exception'
    WHEN reason_value='OWNER_NOT_READY' THEN 'needs_owner' ELSE 'needs_schedule' END;
  next_evaluation:=task_row.evaluation_snapshot;
  IF outcome_value<>'closed' AND jsonb_typeof(next_evaluation)='object' THEN
    next_evaluation:=(next_evaluation-'notificationBinding') || jsonb_build_object('processingReview',jsonb_build_object(
      'state',CASE WHEN outcome_value='scheduled' THEN 'ready' ELSE outcome_value END,'reason',reason_value,
      'processedAt',server_now,'requestId',request_id_value,'policyVersion',policy_version));
    IF binding_json IS NOT NULL THEN next_evaluation:=next_evaluation || jsonb_build_object('notificationBinding',binding_json); END IF;
  END IF;
  -- Append calculation history BEFORE replacing prior deadline/readiness fields.
  -- Minimal explicit projection: no raw evaluation, contact notes or HR reasons.
  -- Delivery outcome is retained separately in the immutable private receipt.
  INSERT INTO public.crm_audit_events(customer_id,entity_type,entity_id,event_type,reason_text,
    actor_user_id,actor_kind,actor_name_snapshot,old_values,new_values,occurred_at,recorded_at)
  VALUES(customer_row.id,'crm_sla_task',task_row.id,'first_contact_processed',reason_value,actor_id,actor_kind_value,actor_name,
    jsonb_build_object('status',task_row.status,'accountabilityState',task_row.accountability_state,
      'serviceDueAt',task_row.service_due_at,'staffDueAt',task_row.staff_due_at,'notifyAt',task_row.notify_at,
      'firstContactedAt',customer_row.first_contacted_at,
      'completedByActivityId',task_row.completed_by_activity_id,'completedAt',task_row.completed_at,
      'calendarVersion',task_row.evaluation_snapshot#>>'{notificationBinding,calendarVersion}'),
    jsonb_build_object('requestId',request_id_value,'decision',outcome_value,'reason',reason_value,'status',next_status,
      'accountabilityState',next_accountability,'serviceDueAt',task_row.service_due_at,
      'staffDueAt',CASE WHEN outcome_value IN ('completed','closed') THEN task_row.staff_due_at ELSE staff_due END,
      'notifyAt',CASE WHEN outcome_value IN ('completed','closed') THEN task_row.notify_at ELSE notify_value END,
      'calendarVersion',next_evaluation#>>'{notificationBinding,calendarVersion}',
      'evaluatedCalendarId',head_row.id,'evaluatedCalendarVersion',version_row.id,'policyVersion',policy_version,'settingsVersion',settings_row.version,
      'dueSoonMinutes',settings_row.sla_due_soon_minutes,'rule',clock_json->>'rule',
      'firstContactedAt',CASE WHEN outcome_value='completed' THEN complete_at ELSE customer_row.first_contacted_at END,
      'completedByActivityId',CASE WHEN outcome_value='completed' THEN complete_id ELSE task_row.completed_by_activity_id END,
      'completedAt',CASE WHEN outcome_value='completed' THEN complete_at ELSE task_row.completed_at END),server_now,server_now);
  IF outcome_value='completed' THEN
    -- This is the proven customer-contact milestone, not Sales credit, Qualified
    -- status or a cohort reset. A contradictory existing value was held above.
    UPDATE public.sales_customers SET first_contacted_at=complete_at
      WHERE id=customer_row.id AND first_contacted_at IS NULL;
    UPDATE public.crm_sla_tasks SET status='done',completed_by_activity_id=complete_id,completed_at=complete_at,
      evaluation_snapshot=next_evaluation WHERE id=task_row.id;
  ELSIF outcome_value<>'closed' THEN
    UPDATE public.crm_sla_tasks SET accountability_state=next_accountability,staff_due_at=staff_due,
      notify_at=notify_value,evaluation_snapshot=next_evaluation WHERE id=task_row.id;
  END IF;
  -- Preserve an exact current notice/read receipt, including when processing is
  -- outside working hours. Withdraw stale/new-policy/new-version notices and a
  -- due_soon notice once overdue. Never clear an existing withdrawal or read_at.
  UPDATE public.crm_notifications n SET withdrawn_at=server_now,withdrawal_reason='first_contact_processing:'||reason_value
    WHERE n.task_id=task_row.id AND n.withdrawn_at IS NULL
      AND (outcome_value IN ('held','completed','closed')
        OR n.recipient_user_id IS DISTINCT FROM task_row.owner_user_id
        OR (n.notification_type='due_soon' AND (n.dedupe_key IS DISTINCT FROM due_key OR server_now>staff_due))
        OR (n.notification_type='overdue' AND n.dedupe_key IS DISTINCT FROM overdue_key)
        OR n.notification_type NOT IN ('due_soon','overdue')
        OR NOT EXISTS (SELECT 1 FROM sales_private.crm_visible_sla_notifications(task_row.owner_user_id,server_now) visible WHERE visible.id=n.id));
  GET DIAGNOSTICS withdrawn_count=ROW_COUNT;
  IF withdrawn_count>2147483647 THEN RAISE EXCEPTION 'CRM_SLA_PROCESS_SETUP_REQUIRED'; END IF;
  IF outcome_value='scheduled' AND notice_type IS NOT NULL THEN
    INSERT INTO public.crm_notifications(recipient_user_id,task_id,notification_type,dedupe_key,message,
      available_at,created_at,lifecycle_revision,calendar_id,calendar_version_id,staff_due_at_snapshot,service_due_at_snapshot)
      VALUES(task_row.owner_user_id,task_row.id,notice_type,selected_key,'มีงานติดต่อ Lead ที่ต้องติดตาม',
        available_value,server_now,customer_row.lifecycle_revision,head_row.id,version_row.id,staff_due,task_row.service_due_at)
      ON CONFLICT (recipient_user_id,dedupe_key) DO NOTHING RETURNING id INTO notice_id;
    IF notice_id IS NOT NULL THEN outcome_value:='notified';
    ELSE
      SELECT * INTO notice_row FROM public.crm_notifications
        WHERE recipient_user_id=task_row.owner_user_id AND dedupe_key=selected_key FOR UPDATE;
      IF FOUND AND notice_row.task_id=task_row.id AND notice_row.withdrawn_at IS NULL
        AND EXISTS (SELECT 1 FROM sales_private.crm_visible_sla_notifications(task_row.owner_user_id,server_now) visible WHERE visible.id=notice_row.id) THEN
        outcome_value:='already_notified'; notice_id:=notice_row.id;
      ELSE outcome_value:='suppressed'; reason_value:='WITHDRAWN_NOTIFICATION'; notice_type:=NULL; END IF;
    END IF;
  END IF;
  response_value:=jsonb_build_object('actor',CASE WHEN actor_kind_value='system'
    THEN jsonb_build_object('kind','system','name','first_contact_worker_v1')
    ELSE jsonb_build_object('userId',actor_id,'role','admin') END,
    'requestId',request_id_value,'taskId',task_row.id,'processedAt',server_now,'replayed',false,
    'outcome',outcome_value,'reason',reason_value,'serviceDueAt',task_row.service_due_at,'staffDueAt',staff_due,
    'notificationId',notice_id,'notificationType',notice_type,'completedByActivityId',complete_id,'completedAt',complete_at,
    'withdrawnCount',withdrawn_count);
  RETURN response_value;
END;
$apply$;
REVOKE ALL ON FUNCTION sales_private.crm_first_contact_apply(public.crm_settings,public.sales_customers,public.crm_sla_tasks,sales_private.crm_work_calendars,boolean,uuid,text,text,uuid) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.crm_v2_process_first_contact(p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog SET timezone = 'UTC'
AS $process$
DECLARE
  actor_id uuid:=auth.uid(); actor_role text:=public.crm_v2_role(); actor_name text;
  request_id_value uuid; task_id_value uuid; lock_task_id uuid; canonical_request jsonb;
  uuid_pattern text:='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  settings_row public.crm_settings%ROWTYPE;
  receipt_row sales_private.crm_first_contact_processing_requests%ROWTYPE; receipt_found boolean;
  initial_task public.crm_sla_tasks%ROWTYPE; task_row public.crm_sla_tasks%ROWTYPE;
  customer_row public.sales_customers%ROWTYPE; role_row sales_private.crm_user_roles%ROWTYPE;
  head_row sales_private.crm_work_calendars%ROWTYPE; owner_active boolean:=false;
  server_now timestamptz; response_value jsonb;
BEGIN
  IF actor_id IS NULL OR actor_role IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'CRM_SLA_PROCESS_FORBIDDEN'; END IF;
  SELECT * INTO settings_row FROM public.crm_settings WHERE id FOR SHARE;
  IF NOT FOUND OR (settings_row.central_intake_enabled AND settings_row.lead_work_enabled
    AND settings_row.lead_lifecycle_enabled AND settings_row.work_schedule_enabled AND settings_row.notifications_enabled
    AND settings_row.sla_preview_enabled AND settings_row.sla_processing_enabled) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'CRM_SLA_PROCESS_SETUP_REQUIRED';
  END IF;
  IF jsonb_typeof(p_request) IS DISTINCT FROM 'object' OR octet_length(p_request::text)>1024 THEN
    RAISE EXCEPTION 'CRM_SLA_PROCESS_INVALID_INPUT';
  END IF;
  IF NOT (p_request ?& ARRAY['requestId','taskId'])
    OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_request) k WHERE k NOT IN ('requestId','taskId'))
    OR jsonb_typeof(p_request->'requestId') IS DISTINCT FROM 'string' OR jsonb_typeof(p_request->'taskId') IS DISTINCT FROM 'string'
    OR length(p_request->>'requestId')<>36 OR (p_request->>'requestId') !~ uuid_pattern
    OR length(p_request->>'taskId')<>36 OR (p_request->>'taskId') !~ uuid_pattern THEN
    RAISE EXCEPTION 'CRM_SLA_PROCESS_INVALID_INPUT';
  END IF;
  request_id_value:=(p_request->>'requestId')::uuid; task_id_value:=(p_request->>'taskId')::uuid;
  canonical_request:=jsonb_build_object('requestId',request_id_value,'taskId',task_id_value);
  PERFORM pg_advisory_xact_lock(hashtextextended('sla-processing-request:'||actor_id::text||':'||request_id_value::text,0));
  -- Read a receipt only to resolve its retained task's lock targets. Its contents
  -- are not returned until current Admin authorization has been locked/rechecked.
  SELECT * INTO receipt_row FROM sales_private.crm_first_contact_processing_requests
    WHERE actor_user_id=actor_id AND request_id=request_id_value;
  receipt_found:=FOUND; lock_task_id:=CASE WHEN receipt_found THEN receipt_row.task_id ELSE task_id_value END;
  SELECT * INTO initial_task FROM public.crm_sla_tasks WHERE id=lock_task_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'CRM_SLA_PROCESS_NOT_AVAILABLE'; END IF;
  SELECT * INTO customer_row FROM public.sales_customers WHERE id=initial_task.customer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CRM_SLA_PROCESS_NOT_AVAILABLE'; END IF;
  IF initial_task.owner_user_id IS NOT NULL THEN
    -- Exact namespace from 06; also serializes the ABSENCE of an initial head.
    PERFORM pg_advisory_xact_lock(hashtextextended('work-schedule-sales:'||initial_task.owner_user_id::text,0));
    SELECT * INTO head_row FROM sales_private.crm_work_calendars WHERE sales_user_id=initial_task.owner_user_id FOR SHARE;
  END IF;
  actor_role:=NULL;
  FOR role_row IN SELECT * FROM sales_private.crm_user_roles
    WHERE user_id IN (actor_id,initial_task.owner_user_id) ORDER BY user_id FOR SHARE
  LOOP
    IF role_row.user_id=actor_id AND role_row.is_active THEN actor_role:=role_row.role; actor_name:=role_row.display_name; END IF;
    IF role_row.user_id=initial_task.owner_user_id THEN owner_active:=role_row.role='sales' AND role_row.is_active; END IF;
  END LOOP;
  IF actor_role IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'CRM_SLA_PROCESS_FORBIDDEN'; END IF;
  IF receipt_found THEN
    IF receipt_row.request_payload IS DISTINCT FROM canonical_request THEN RAISE EXCEPTION 'CRM_SLA_PROCESS_IDEMPOTENCY_CONFLICT'; END IF;
    RETURN receipt_row.response || jsonb_build_object('replayed',true);
  END IF;
  SELECT * INTO task_row FROM public.crm_sla_tasks WHERE id=task_id_value FOR UPDATE;
  IF NOT FOUND OR task_row.customer_id IS DISTINCT FROM initial_task.customer_id
    OR task_row.owner_user_id IS DISTINCT FROM initial_task.owner_user_id
    OR task_row.task_type<>'first_contact' OR task_row.project_interest_id IS NOT NULL OR task_row.source_activity_id IS NOT NULL THEN
    RAISE EXCEPTION 'CRM_SLA_PROCESS_NOT_AVAILABLE';
  END IF;
  response_value:=sales_private.crm_first_contact_apply(settings_row,customer_row,task_row,head_row,
    owner_active,actor_id,actor_name,'staff',request_id_value);
  server_now:=(response_value->>'processedAt')::timestamptz;
  INSERT INTO sales_private.crm_first_contact_processing_requests(actor_user_id,request_id,task_id,request_payload,response,created_at)
    VALUES(actor_id,request_id_value,task_row.id,canonical_request,response_value,server_now);
  RETURN response_value;
END;
$process$;
REVOKE ALL ON FUNCTION public.crm_v2_process_first_contact(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_v2_process_first_contact(jsonb) TO authenticated;

ROLLBACK;
