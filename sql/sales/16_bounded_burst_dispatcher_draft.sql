-- SALES V2 BOUNDED BURST DISPATCHER -- DESIGN ONLY, 2026-09-23.
-- NEVER RUN ON SUPABASE. Depends on UNAPPLIED base and companions 04--15.
-- Optional local draft policy, OFF by default. This is not a Cron installer,
-- frequency approval, hard runtime deadline or five-minute delivery guarantee.
-- Preserve14 execution/recovery unchanged; only admissions and bounded batching
-- change. No worker-cap increase, new login, membership, extension or job.
BEGIN;
DO $draft_only$
BEGIN
  RAISE EXCEPTION 'DESIGN ONLY: bounded burst dispatcher is not authorized for database execution';
END;
$draft_only$;

ALTER TABLE public.crm_settings ADD COLUMN sla_burst_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE sales_private.crm_first_contact_dispatch_requests
  ADD COLUMN policy_version text NOT NULL DEFAULT 'completion_spacing_v1'
  CHECK (policy_version IN ('completion_spacing_v1','bounded_burst_v2'));

-- An old request never acquires new semantics when a feature flag changes.
-- Keep14's existing terminal/identity guard; this additional guard protects the
-- policy snapshot even for still-active requests.
CREATE FUNCTION sales_private.crm_first_contact_dispatch_policy_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog
AS $policy_guard$
BEGIN
  IF NEW.policy_version IS DISTINCT FROM OLD.policy_version THEN
    RAISE EXCEPTION 'CRM_SLA_DISPATCH_INVALID_INPUT';
  END IF;
  RETURN NEW;
END;
$policy_guard$;
REVOKE ALL ON FUNCTION sales_private.crm_first_contact_dispatch_policy_guard() FROM PUBLIC, anon, authenticated,
  buildtrack_sales_sla_worker, buildtrack_sales_sla_dispatcher;
CREATE TRIGGER crm_first_contact_dispatch_policy_guard
  BEFORE UPDATE ON sales_private.crm_first_contact_dispatch_requests
  FOR EACH ROW EXECUTE FUNCTION sales_private.crm_first_contact_dispatch_policy_guard();

CREATE TABLE sales_private.crm_first_contact_dispatch_admissions (
  attempt_id uuid PRIMARY KEY REFERENCES sales_private.crm_first_contact_dispatch_attempts(attempt_id) ON DELETE RESTRICT,
  admitted_at timestamptz NOT NULL CHECK (isfinite(admitted_at)
    AND admitted_at>=TIMESTAMPTZ '0001-01-01 00:00:00+00'
    AND admitted_at<=TIMESTAMPTZ '9999-12-31 23:59:59.999999+00')
);
CREATE INDEX crm_first_contact_dispatch_admissions_recent_idx
  ON sales_private.crm_first_contact_dispatch_admissions(admitted_at DESC,attempt_id);
ALTER TABLE sales_private.crm_first_contact_dispatch_admissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sales_private.crm_first_contact_dispatch_admissions FROM PUBLIC, anon, authenticated,
  buildtrack_sales_sla_worker, buildtrack_sales_sla_dispatcher;
CREATE TRIGGER crm_first_contact_dispatch_admission_immutable
  BEFORE UPDATE OR DELETE ON sales_private.crm_first_contact_dispatch_admissions
  FOR EACH ROW EXECUTE FUNCTION sales_private.crm_first_contact_history_immutable();

-- Rename, do not copy,14's execution implementation. These retained helpers
-- become owner-only; otherwise callers could bypass the new policy wrapper.
ALTER FUNCTION sales_private.crm_first_contact_dispatch_prepare() RENAME TO crm_first_contact_dispatch_prepare_legacy;
ALTER FUNCTION sales_private.crm_first_contact_dispatch_execute(uuid,uuid) RENAME TO crm_first_contact_dispatch_execute_legacy;
REVOKE ALL ON FUNCTION sales_private.crm_first_contact_dispatch_prepare_legacy() FROM PUBLIC, anon, authenticated,
  buildtrack_sales_sla_worker, buildtrack_sales_sla_dispatcher;
REVOKE ALL ON FUNCTION sales_private.crm_first_contact_dispatch_execute_legacy(uuid,uuid) FROM PUBLIC, anon, authenticated,
  buildtrack_sales_sla_worker, buildtrack_sales_sla_dispatcher;

CREATE OR REPLACE FUNCTION sales_private.crm_first_contact_dispatch_projection(
  p_request sales_private.crm_first_contact_dispatch_requests,p_current uuid)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = pg_catalog SET timezone = 'UTC'
AS $burst_projection$
  SELECT jsonb_build_object('requestId',p_request.request_id,'createdAt',p_request.created_at,'status',p_request.status,
    'attemptCount',p_request.attempt_count,'attemptId',p_request.current_attempt_id,
    'nextAttemptAt',p_request.next_attempt_at,'completedAt',p_request.completed_at,
    'lastErrorCode',p_request.last_error_code,'current',COALESCE(p_request.request_id=p_current,false),
    'policy',CASE p_request.policy_version
      WHEN 'completion_spacing_v1' THEN
        jsonb_build_object('maxItemsPerCycle',10,'maxAttempts',5,'reservationSeconds',60,'minimumSpacingSeconds',60)
      WHEN 'bounded_burst_v2' THEN
        jsonb_build_object('version','bounded_burst_v2','maxItemsPerCycle',10,'maxAttempts',5,'reservationSeconds',60,
          'minimumSpacingSeconds',0,'maxAdmissionsPerWindow',5,'windowSeconds',10,'maxCyclesPerCall',5,'softBudgetMilliseconds',8000)
      ELSE NULL END);
$burst_projection$;
REVOKE ALL ON FUNCTION sales_private.crm_first_contact_dispatch_projection(sales_private.crm_first_contact_dispatch_requests,uuid)
  FROM PUBLIC, anon, authenticated, buildtrack_sales_sla_worker, buildtrack_sales_sla_dispatcher;

-- ONE reservation transaction. All callers share the same settings -> dispatch
-- lane -> control/request lock order as14. The latest FIVE immutable admissions
-- suffice for a rolling cap, without scanning/counting unbounded history.
-- Window is (server_now - 10 seconds, server_now]; equality at the old boundary
-- expires an admission. Future history is rejected, never erased to reset pace.
CREATE FUNCTION sales_private.crm_first_contact_dispatch_burst_prepare()
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog SET timezone = 'UTC'
SET lock_timeout = '500ms'
AS $burst_prepare$
DECLARE
  settings_row public.crm_settings%ROWTYPE; current_id uuid;
  request_row sales_private.crm_first_contact_dispatch_requests%ROWTYPE;
  request_id_value uuid; attempt_id_value uuid; attempt_number integer;
  now_value timestamptz; create_request boolean:=false; recover_legacy boolean:=false;
  recent_count integer; oldest_recent timestamptz; newest_recent timestamptz; reservation_value jsonb;
  minimum_at constant timestamptz:=TIMESTAMPTZ '0001-01-01 00:00:00+00';
  maximum_at constant timestamptz:=TIMESTAMPTZ '9999-12-31 23:59:59.999999+00';
BEGIN
  SELECT * INTO settings_row FROM public.crm_settings WHERE id FOR SHARE;
  IF NOT FOUND OR (settings_row.central_intake_enabled AND settings_row.lead_work_enabled
    AND settings_row.lead_lifecycle_enabled AND settings_row.work_schedule_enabled AND settings_row.notifications_enabled
    AND settings_row.sla_preview_enabled AND settings_row.sla_processing_enabled AND settings_row.sla_cycle_enabled
    AND settings_row.sla_worker_enabled AND settings_row.sla_dispatcher_enabled AND settings_row.sla_burst_enabled) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'CRM_SLA_DISPATCH_SETUP_REQUIRED';
  END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended('sla-first-contact-dispatch:global',0)) THEN RETURN NULL; END IF;
  SELECT current_request_id INTO current_id FROM sales_private.crm_first_contact_dispatch_control WHERE id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CRM_SLA_DISPATCH_SETUP_REQUIRED'; END IF;
  now_value:=clock_timestamp();
  IF NOT isfinite(now_value) OR now_value<minimum_at OR now_value>maximum_at-interval '60 seconds' THEN
    RAISE EXCEPTION 'CRM_SLA_DISPATCH_SETUP_REQUIRED';
  END IF;
  IF current_id IS NULL THEN create_request:=true;
  ELSE
    SELECT * INTO request_row FROM sales_private.crm_first_contact_dispatch_requests WHERE request_id=current_id FOR UPDATE;
    IF NOT FOUND OR now_value<request_row.created_at OR now_value<request_row.completed_at
      OR request_row.policy_version IS NULL OR request_row.policy_version NOT IN ('completion_spacing_v1','bounded_burst_v2') THEN
      RAISE EXCEPTION 'CRM_SLA_DISPATCH_SETUP_REQUIRED';
    END IF;
    IF request_row.status='review' THEN RETURN NULL;
    ELSIF request_row.status='completed' THEN
      IF request_row.policy_version='completion_spacing_v1'
        AND now_value<request_row.completed_at+interval '60 seconds' THEN RETURN NULL; END IF;
      create_request:=true;
    ELSE
      IF now_value<request_row.next_attempt_at THEN RETURN NULL; END IF;
      IF request_row.attempt_count>=5 THEN
        UPDATE sales_private.crm_first_contact_dispatch_requests SET status='review',last_error_code='RETRY_LIMIT',
          next_attempt_at=now_value WHERE request_id=current_id;
        RETURN NULL;
      END IF;
      recover_legacy:=request_row.policy_version='completion_spacing_v1';
    END IF;
  END IF;
  SELECT count(*),min(admitted_at),max(admitted_at) INTO recent_count,oldest_recent,newest_recent FROM (
    SELECT admitted_at FROM sales_private.crm_first_contact_dispatch_admissions ORDER BY admitted_at DESC,attempt_id LIMIT 5
  ) recent;
  IF newest_recent IS NOT NULL AND now_value<newest_recent THEN RAISE EXCEPTION 'CRM_SLA_DISPATCH_SETUP_REQUIRED'; END IF;
  IF recent_count=5 AND oldest_recent>now_value-interval '10 seconds' THEN RETURN NULL; END IF;

  IF recover_legacy THEN
    -- Continue the exact old request/lease/backoff policy. A recovery reservation
    -- in burst mode still consumes one global admission; a held call does not.
    reservation_value:=sales_private.crm_first_contact_dispatch_prepare_legacy();
    IF reservation_value IS NOT NULL THEN
      INSERT INTO sales_private.crm_first_contact_dispatch_admissions(attempt_id,admitted_at)
        VALUES((reservation_value->>'attemptId')::uuid,now_value);
    END IF;
    RETURN reservation_value;
  END IF;
  attempt_id_value:=gen_random_uuid();
  IF create_request THEN
    request_id_value:=gen_random_uuid(); attempt_number:=1;
    IF EXISTS (SELECT 1 FROM sales_private.crm_first_contact_dispatch_requests WHERE request_id=request_id_value)
      OR EXISTS (SELECT 1 FROM sales_private.crm_first_contact_worker_cycles WHERE request_id=request_id_value) THEN
      RAISE EXCEPTION 'CRM_SLA_DISPATCH_INVALID_INPUT';
    END IF;
    INSERT INTO sales_private.crm_first_contact_dispatch_requests
      (request_id,created_at,status,attempt_count,current_attempt_id,next_attempt_at,policy_version)
      VALUES(request_id_value,now_value,'reserved',attempt_number,attempt_id_value,now_value+interval '60 seconds','bounded_burst_v2');
    UPDATE sales_private.crm_first_contact_dispatch_control SET current_request_id=request_id_value WHERE id;
  ELSE
    request_id_value:=current_id; attempt_number:=request_row.attempt_count+1;
    UPDATE sales_private.crm_first_contact_dispatch_requests SET status='reserved',attempt_count=attempt_number,
      current_attempt_id=attempt_id_value,next_attempt_at=now_value+interval '60 seconds',last_error_code=NULL
      WHERE request_id=request_id_value;
  END IF;
  INSERT INTO sales_private.crm_first_contact_dispatch_attempts(attempt_id,request_id,attempt_no,prepared_at,prepared_xid)
    VALUES(attempt_id_value,request_id_value,attempt_number,now_value,pg_current_xact_id());
  INSERT INTO sales_private.crm_first_contact_dispatch_admissions(attempt_id,admitted_at) VALUES(attempt_id_value,now_value);
  RETURN jsonb_build_object('requestId',request_id_value,'attemptId',attempt_id_value,'attemptNumber',attempt_number);
END;
$burst_prepare$;
REVOKE ALL ON FUNCTION sales_private.crm_first_contact_dispatch_burst_prepare() FROM PUBLIC, anon, authenticated,
  buildtrack_sales_sla_worker, buildtrack_sales_sla_dispatcher;

-- Keep14's public capability name so its old one-cycle tick cannot bypass the
-- shared burst pacer. Turning burst OFF holds an unfinished v2 request; it must
-- not silently reinterpret that request through the legacy prepare helper.
CREATE FUNCTION sales_private.crm_first_contact_dispatch_prepare()
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog SET timezone = 'UTC'
SET lock_timeout = '500ms'
AS $prepare_wrapper$
DECLARE
  settings_row public.crm_settings%ROWTYPE; current_id uuid;
  request_row sales_private.crm_first_contact_dispatch_requests%ROWTYPE;
BEGIN
  SELECT * INTO settings_row FROM public.crm_settings WHERE id FOR SHARE;
  IF NOT FOUND OR (settings_row.central_intake_enabled AND settings_row.lead_work_enabled
    AND settings_row.lead_lifecycle_enabled AND settings_row.work_schedule_enabled AND settings_row.notifications_enabled
    AND settings_row.sla_preview_enabled AND settings_row.sla_processing_enabled AND settings_row.sla_cycle_enabled
    AND settings_row.sla_worker_enabled AND settings_row.sla_dispatcher_enabled) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'CRM_SLA_DISPATCH_SETUP_REQUIRED';
  END IF;
  IF settings_row.sla_burst_enabled THEN RETURN sales_private.crm_first_contact_dispatch_burst_prepare(); END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended('sla-first-contact-dispatch:global',0)) THEN RETURN NULL; END IF;
  SELECT current_request_id INTO current_id FROM sales_private.crm_first_contact_dispatch_control WHERE id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CRM_SLA_DISPATCH_SETUP_REQUIRED'; END IF;
  IF current_id IS NOT NULL THEN
    SELECT * INTO request_row FROM sales_private.crm_first_contact_dispatch_requests WHERE request_id=current_id FOR UPDATE;
    IF NOT FOUND OR request_row.policy_version IS NULL OR request_row.policy_version NOT IN ('completion_spacing_v1','bounded_burst_v2')
      OR (request_row.policy_version='bounded_burst_v2' AND request_row.status<>'completed') THEN
      RAISE EXCEPTION 'CRM_SLA_DISPATCH_SETUP_REQUIRED';
    END IF;
  END IF;
  RETURN sales_private.crm_first_contact_dispatch_prepare_legacy();
END;
$prepare_wrapper$;
REVOKE ALL ON FUNCTION sales_private.crm_first_contact_dispatch_prepare() FROM PUBLIC, anon, authenticated,
  buildtrack_sales_sla_worker, buildtrack_sales_sla_dispatcher;

-- Immutable request policy is checked under the same settings row lock used by
--14's executor. Disabling burst BETWEEN the two committed phases prevents v2
-- effects. No new worker call, retry path, exception catcher or actor spoofing.
CREATE FUNCTION sales_private.crm_first_contact_dispatch_execute(p_request_id uuid,p_attempt_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog SET timezone = 'UTC'
SET lock_timeout = '500ms'
AS $execute_wrapper$
DECLARE
  settings_row public.crm_settings%ROWTYPE; policy_value text;
BEGIN
  IF p_request_id IS NULL OR p_attempt_id IS NULL THEN RAISE EXCEPTION 'CRM_SLA_DISPATCH_INVALID_INPUT'; END IF;
  SELECT * INTO settings_row FROM public.crm_settings WHERE id FOR SHARE;
  IF NOT FOUND OR (settings_row.central_intake_enabled AND settings_row.lead_work_enabled
    AND settings_row.lead_lifecycle_enabled AND settings_row.work_schedule_enabled AND settings_row.notifications_enabled
    AND settings_row.sla_preview_enabled AND settings_row.sla_processing_enabled AND settings_row.sla_cycle_enabled
    AND settings_row.sla_worker_enabled AND settings_row.sla_dispatcher_enabled) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'CRM_SLA_DISPATCH_SETUP_REQUIRED';
  END IF;
  SELECT policy_version INTO policy_value FROM sales_private.crm_first_contact_dispatch_requests WHERE request_id=p_request_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'CRM_SLA_DISPATCH_NOT_AVAILABLE'; END IF;
  IF policy_value IS NULL OR policy_value NOT IN ('completion_spacing_v1','bounded_burst_v2')
    OR (policy_value='bounded_burst_v2' AND settings_row.sla_burst_enabled IS DISTINCT FROM true) THEN
    RAISE EXCEPTION 'CRM_SLA_DISPATCH_SETUP_REQUIRED';
  END IF;
  RETURN sales_private.crm_first_contact_dispatch_execute_legacy(p_request_id,p_attempt_id);
END;
$execute_wrapper$;
REVOKE ALL ON FUNCTION sales_private.crm_first_contact_dispatch_execute(uuid,uuid) FROM PUBLIC, anon, authenticated,
  buildtrack_sales_sla_worker, buildtrack_sales_sla_dispatcher;

-- Boolean only. Stop a batch at the sweep boundary, on a partial/empty receipt,
-- a legacy completion, a changed current request, a missing receipt or any gate.
-- The next reservation rechecks gates and locks; this read is not authority to
-- bypass prepare, mutate a cursor or start another worker by itself.
CREATE FUNCTION sales_private.crm_first_contact_dispatch_burst_continue(p_request_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog SET timezone = 'UTC'
AS $burst_continue$
  SELECT p_request_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.crm_settings s
    JOIN sales_private.crm_first_contact_dispatch_control c ON c.id=s.id
    JOIN sales_private.crm_first_contact_dispatch_requests r ON r.request_id=c.current_request_id
    JOIN sales_private.crm_first_contact_worker_cycles w ON w.request_id=r.request_id
    WHERE s.id AND s.central_intake_enabled AND s.lead_work_enabled AND s.lead_lifecycle_enabled
      AND s.work_schedule_enabled AND s.notifications_enabled AND s.sla_preview_enabled AND s.sla_processing_enabled
      AND s.sla_cycle_enabled AND s.sla_worker_enabled AND s.sla_dispatcher_enabled AND s.sla_burst_enabled
      AND r.request_id=p_request_id AND r.policy_version='bounded_burst_v2' AND r.status='completed'
      AND w.response->'actor'=jsonb_build_object('kind','system','name','first_contact_worker_v1')
      AND w.response->>'requestId'=p_request_id::text AND w.response->'maxItems'='10'::jsonb
      AND w.response->'processedCount'='10'::jsonb AND w.response->'sweepFinished'='false'::jsonb
  );
$burst_continue$;
REVOKE ALL ON FUNCTION sales_private.crm_first_contact_dispatch_burst_continue(uuid) FROM PUBLIC, anon, authenticated,
  buildtrack_sales_sla_worker, buildtrack_sales_sla_dispatcher;

-- TOP-LEVEL CALL ONLY. COMMIT is illegal under an enclosing BEGIN/function.
-- This invoker procedure has NO SET/exception block. A soft eight-second budget
-- prevents starting another cycle, but cannot interrupt one already in flight;
-- the future caller still needs independently configured statement/runtime caps.
-- Reservation/admission COMMIT precedes execute; execution COMMIT precedes the
-- next loop. A lost connection therefore keeps exact durable recovery intent.
CREATE PROCEDURE sales_private.crm_first_contact_worker_burst_tick()
LANGUAGE plpgsql SECURITY INVOKER
AS $burst_tick$
DECLARE
  reservation_value pg_catalog.jsonb; execution_value pg_catalog.jsonb; request_id_value pg_catalog.uuid;
  started_at_value pg_catalog.timestamptz; previous_at_value pg_catalog.timestamptz; now_value pg_catalog.timestamptz;
  cycle_number pg_catalog.int4;
BEGIN
  started_at_value:=pg_catalog.clock_timestamp(); previous_at_value:=started_at_value;
  IF NOT pg_catalog.isfinite(started_at_value) THEN RETURN; END IF;
  FOR cycle_number IN 1..5 LOOP
    now_value:=pg_catalog.clock_timestamp();
    IF NOT pg_catalog.isfinite(now_value) OR now_value OPERATOR(pg_catalog.<) previous_at_value
      OR (now_value OPERATOR(pg_catalog.-) started_at_value) OPERATOR(pg_catalog.>=) INTERVAL '8 seconds' THEN EXIT; END IF;
    previous_at_value:=now_value;
    reservation_value:=sales_private.crm_first_contact_dispatch_burst_prepare();
    COMMIT;
    IF reservation_value IS NULL THEN EXIT; END IF;
    request_id_value:=pg_catalog.jsonb_extract_path_text(reservation_value,'requestId')::pg_catalog.uuid;
    execution_value:=sales_private.crm_first_contact_dispatch_execute(
      request_id_value,pg_catalog.jsonb_extract_path_text(reservation_value,'attemptId')::pg_catalog.uuid);
    COMMIT;
    IF pg_catalog.texteq(pg_catalog.jsonb_extract_path_text(execution_value,'status'),'completed') IS DISTINCT FROM true THEN EXIT; END IF;
    IF NOT sales_private.crm_first_contact_dispatch_burst_continue(request_id_value) THEN EXIT; END IF;
  END LOOP;
END;
$burst_tick$;
REVOKE ALL ON PROCEDURE sales_private.crm_first_contact_worker_burst_tick() FROM PUBLIC, anon, authenticated,
  buildtrack_sales_sla_worker, buildtrack_sales_sla_dispatcher;

GRANT EXECUTE ON FUNCTION sales_private.crm_first_contact_dispatch_prepare() TO buildtrack_sales_sla_dispatcher;
GRANT EXECUTE ON FUNCTION sales_private.crm_first_contact_dispatch_execute(uuid,uuid) TO buildtrack_sales_sla_dispatcher;
GRANT EXECUTE ON FUNCTION sales_private.crm_first_contact_dispatch_burst_prepare() TO buildtrack_sales_sla_dispatcher;
GRANT EXECUTE ON FUNCTION sales_private.crm_first_contact_dispatch_burst_continue(uuid) TO buildtrack_sales_sla_dispatcher;
GRANT EXECUTE ON PROCEDURE sales_private.crm_first_contact_worker_burst_tick() TO buildtrack_sales_sla_dispatcher;
--14 status and old one-cycle procedure grants remain unchanged.15 audits only
-- its original known boundary; this new surface requires its own operator review
-- before any future binding. No production readiness or real Cron claim here.
ROLLBACK;
