-- SALES V2 DURABLE FIRST-CONTACT DISPATCHER -- DESIGN ONLY, 2026-09-18.
-- NEVER RUN ON SUPABASE. Depends on UNAPPLIED base and companions 04--13.
-- No extension/job/login/membership/connection binding/feature enablement here.
-- The 60-second lease/spacing, five reservations and one cycle per tick are
-- LOCAL DRAFT TEST POLICY, not approved production frequency or throughput.
-- The top-level procedure commits intent BEFORE invoking the13 system worker.
BEGIN;
DO $draft_only$
BEGIN
  RAISE EXCEPTION 'DESIGN ONLY: dispatcher is not authorized for database execution';
END;
$draft_only$;

DO $dispatcher_identity$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='buildtrack_sales_sla_dispatcher') THEN
    RAISE EXCEPTION 'CRM_SLA_DISPATCH_ROLE_COLLISION';
  END IF;
  CREATE ROLE buildtrack_sales_sla_dispatcher NOLOGIN NOINHERIT NOSUPERUSER
    NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
END;
$dispatcher_identity$;

ALTER TABLE public.crm_settings ADD COLUMN sla_dispatcher_enabled boolean NOT NULL DEFAULT false;

CREATE TABLE sales_private.crm_first_contact_dispatch_requests (
  request_id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL CHECK (isfinite(created_at)),
  status text NOT NULL CHECK (status IN ('reserved','retry_wait','review','completed')),
  attempt_count integer NOT NULL CHECK (attempt_count BETWEEN 1 AND 5),
  current_attempt_id uuid NOT NULL,
  next_attempt_at timestamptz NOT NULL CHECK (isfinite(next_attempt_at)),
  completed_at timestamptz CHECK (completed_at IS NULL OR (isfinite(completed_at) AND completed_at>=created_at)),
  last_error_code text CHECK (last_error_code IN ('TRANSIENT_RETRY','RETRY_LIMIT','PROCESSING_REVIEW')),
  CHECK ((status='completed')=(completed_at IS NOT NULL)),
  CHECK (next_attempt_at>=created_at)
);
CREATE TABLE sales_private.crm_first_contact_dispatch_attempts (
  attempt_id uuid PRIMARY KEY,
  request_id uuid NOT NULL REFERENCES sales_private.crm_first_contact_dispatch_requests(request_id) ON DELETE RESTRICT,
  attempt_no integer NOT NULL CHECK (attempt_no BETWEEN 1 AND 5),
  prepared_at timestamptz NOT NULL CHECK (isfinite(prepared_at)),
  prepared_xid xid8 NOT NULL,
  UNIQUE(request_id,attempt_no)
);
-- The deferred pointer allows request and first immutable attempt to be inserted
-- together, but neither can commit with a missing partner. Execute also binds the
-- exact request/attempt number; callers have no direct writes to either table.
ALTER TABLE sales_private.crm_first_contact_dispatch_requests
  ADD CONSTRAINT crm_first_contact_dispatch_current_attempt_fk
  FOREIGN KEY (current_attempt_id) REFERENCES sales_private.crm_first_contact_dispatch_attempts(attempt_id)
  DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE sales_private.crm_first_contact_dispatch_control (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  current_request_id uuid REFERENCES sales_private.crm_first_contact_dispatch_requests(request_id) ON DELETE RESTRICT
);
INSERT INTO sales_private.crm_first_contact_dispatch_control(id) VALUES(true);
ALTER TABLE sales_private.crm_first_contact_dispatch_control ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_private.crm_first_contact_dispatch_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_private.crm_first_contact_dispatch_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sales_private.crm_first_contact_dispatch_control, sales_private.crm_first_contact_dispatch_requests,
  sales_private.crm_first_contact_dispatch_attempts FROM PUBLIC, anon, authenticated,
  buildtrack_sales_sla_worker, buildtrack_sales_sla_dispatcher;

CREATE FUNCTION sales_private.crm_first_contact_dispatch_history_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog
AS $history_guard$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'CRM_SLA_DISPATCH_INVALID_INPUT'; END IF;
  IF OLD.status IN ('completed','review') OR NEW.request_id IS DISTINCT FROM OLD.request_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'CRM_SLA_DISPATCH_INVALID_INPUT';
  END IF;
  RETURN NEW;
END;
$history_guard$;
REVOKE ALL ON FUNCTION sales_private.crm_first_contact_dispatch_history_guard() FROM PUBLIC, anon, authenticated,
  buildtrack_sales_sla_worker, buildtrack_sales_sla_dispatcher;
CREATE TRIGGER crm_first_contact_dispatch_history_guard
  BEFORE UPDATE OR DELETE ON sales_private.crm_first_contact_dispatch_requests
  FOR EACH ROW EXECUTE FUNCTION sales_private.crm_first_contact_dispatch_history_guard();
CREATE TRIGGER crm_first_contact_dispatch_attempt_immutable
  BEFORE UPDATE OR DELETE ON sales_private.crm_first_contact_dispatch_attempts
  FOR EACH ROW EXECUTE FUNCTION sales_private.crm_first_contact_history_immutable();

CREATE FUNCTION sales_private.crm_first_contact_dispatch_projection(
  p_request sales_private.crm_first_contact_dispatch_requests,p_current uuid)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = pg_catalog SET timezone = 'UTC'
AS $dispatch_projection$
  SELECT jsonb_build_object('requestId',p_request.request_id,'createdAt',p_request.created_at,'status',p_request.status,
    'attemptCount',p_request.attempt_count,'attemptId',p_request.current_attempt_id,
    'nextAttemptAt',p_request.next_attempt_at,'completedAt',p_request.completed_at,
    'lastErrorCode',p_request.last_error_code,'current',COALESCE(p_request.request_id=p_current,false),
    'policy',jsonb_build_object('maxItemsPerCycle',10,'maxAttempts',5,'reservationSeconds',60,'minimumSpacingSeconds',60));
$dispatch_projection$;
REVOKE ALL ON FUNCTION sales_private.crm_first_contact_dispatch_projection(sales_private.crm_first_contact_dispatch_requests,uuid)
  FROM PUBLIC, anon, authenticated, buildtrack_sales_sla_worker, buildtrack_sales_sla_dispatcher;

-- Fixed whitelist, not a receipt body. Historical status requires only the six
-- original read gates so turning off any processing gate does not erase evidence.
-- SQL NULL means no such/current request; it is NOT proof that work cannot commit.
CREATE FUNCTION sales_private.crm_first_contact_dispatch_status(p_request_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog SET timezone = 'UTC'
AS $dispatch_status$
DECLARE
  current_id uuid; selected_id uuid; request_row sales_private.crm_first_contact_dispatch_requests%ROWTYPE;
BEGIN
  IF NOT COALESCE((SELECT central_intake_enabled AND lead_work_enabled AND lead_lifecycle_enabled
    AND work_schedule_enabled AND notifications_enabled AND sla_preview_enabled FROM public.crm_settings WHERE id),false) THEN
    RAISE EXCEPTION 'CRM_SLA_DISPATCH_SETUP_REQUIRED';
  END IF;
  SELECT current_request_id INTO current_id FROM sales_private.crm_first_contact_dispatch_control WHERE id;
  selected_id:=COALESCE(p_request_id,current_id);
  IF selected_id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO request_row FROM sales_private.crm_first_contact_dispatch_requests WHERE request_id=selected_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN sales_private.crm_first_contact_dispatch_projection(request_row,current_id);
END;
$dispatch_status$;
REVOKE ALL ON FUNCTION sales_private.crm_first_contact_dispatch_status(uuid) FROM PUBLIC, anon, authenticated, buildtrack_sales_sla_worker;

-- Transaction ONE: reserve or recover the SAME request. Attempts count durable
-- reservations, including a crash before execute; no caller-supplied clock/ID.
-- Busy/spacing/lease/backoff/review holds return SQL NULL, with no worker call.
CREATE FUNCTION sales_private.crm_first_contact_dispatch_prepare()
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog SET timezone = 'UTC'
SET lock_timeout = '500ms'
AS $dispatch_prepare$
DECLARE
  settings_row public.crm_settings%ROWTYPE; current_id uuid;
  request_row sales_private.crm_first_contact_dispatch_requests%ROWTYPE;
  request_id_value uuid; attempt_id_value uuid; attempt_number integer;
  now_value timestamptz; create_request boolean:=false;
  minimum_at constant timestamptz:=TIMESTAMPTZ '0001-01-01 00:00:00+00';
  maximum_at constant timestamptz:=TIMESTAMPTZ '9999-12-31 23:59:59.999999+00';
BEGIN
  SELECT * INTO settings_row FROM public.crm_settings WHERE id FOR SHARE;
  IF NOT FOUND OR (settings_row.central_intake_enabled AND settings_row.lead_work_enabled
    AND settings_row.lead_lifecycle_enabled AND settings_row.work_schedule_enabled AND settings_row.notifications_enabled
    AND settings_row.sla_preview_enabled AND settings_row.sla_processing_enabled AND settings_row.sla_cycle_enabled
    AND settings_row.sla_worker_enabled AND settings_row.sla_dispatcher_enabled) IS DISTINCT FROM true THEN
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
    IF NOT FOUND OR now_value<request_row.created_at THEN RAISE EXCEPTION 'CRM_SLA_DISPATCH_SETUP_REQUIRED'; END IF;
    IF request_row.status='review' THEN RETURN NULL;
    ELSIF request_row.status='completed' THEN
      IF now_value<request_row.completed_at+interval '60 seconds' THEN RETURN NULL; END IF;
      create_request:=true;
    ELSE
      IF now_value<request_row.next_attempt_at THEN RETURN NULL; END IF;
      IF request_row.attempt_count>=5 THEN
        UPDATE sales_private.crm_first_contact_dispatch_requests SET status='review',last_error_code='RETRY_LIMIT',
          next_attempt_at=now_value WHERE request_id=current_id;
        RETURN NULL;
      END IF;
    END IF;
  END IF;
  attempt_id_value:=gen_random_uuid();
  IF create_request THEN
    request_id_value:=gen_random_uuid(); attempt_number:=1;
    -- A collision must not adopt an unrelated retained worker receipt, even if
    -- that request never belonged to this dispatcher. Never regenerate silently.
    IF EXISTS (SELECT 1 FROM sales_private.crm_first_contact_dispatch_requests WHERE request_id=request_id_value)
      OR EXISTS (SELECT 1 FROM sales_private.crm_first_contact_worker_cycles WHERE request_id=request_id_value) THEN
      RAISE EXCEPTION 'CRM_SLA_DISPATCH_INVALID_INPUT';
    END IF;
    INSERT INTO sales_private.crm_first_contact_dispatch_requests
      (request_id,created_at,status,attempt_count,current_attempt_id,next_attempt_at)
      VALUES(request_id_value,now_value,'reserved',attempt_number,attempt_id_value,now_value+interval '60 seconds');
    UPDATE sales_private.crm_first_contact_dispatch_control SET current_request_id=request_id_value WHERE id;
  ELSE
    request_id_value:=current_id; attempt_number:=request_row.attempt_count+1;
    UPDATE sales_private.crm_first_contact_dispatch_requests SET status='reserved',attempt_count=attempt_number,
      current_attempt_id=attempt_id_value,next_attempt_at=now_value+interval '60 seconds',last_error_code=NULL
      WHERE request_id=request_id_value;
  END IF;
  INSERT INTO sales_private.crm_first_contact_dispatch_attempts(attempt_id,request_id,attempt_no,prepared_at,prepared_xid)
    VALUES(attempt_id_value,request_id_value,attempt_number,now_value,pg_current_xact_id());
  RETURN jsonb_build_object('requestId',request_id_value,'attemptId',attempt_id_value,'attemptNumber',attempt_number);
END;
$dispatch_prepare$;
REVOKE ALL ON FUNCTION sales_private.crm_first_contact_dispatch_prepare() FROM PUBLIC, anon, authenticated, buildtrack_sales_sla_worker;

-- Transaction TWO: fence the committed reservation, then apply13 and complete
-- the dispatcher together. Nested rollback removes ALL worker effects before a
-- safe failure state is written. Original committed intent is never discarded.
CREATE FUNCTION sales_private.crm_first_contact_dispatch_execute(p_request_id uuid,p_attempt_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog SET timezone = 'UTC'
SET lock_timeout = '500ms'
AS $dispatch_execute$
DECLARE
  settings_row public.crm_settings%ROWTYPE; current_id uuid;
  request_row sales_private.crm_first_contact_dispatch_requests%ROWTYPE;
  attempt_row sales_private.crm_first_contact_dispatch_attempts%ROWTYPE;
  receipt_value jsonb; now_value timestamptz; completed_value timestamptz; message_value text;
  transient_failure boolean; backoff_seconds integer;
  minimum_at constant timestamptz:=TIMESTAMPTZ '0001-01-01 00:00:00+00';
  maximum_at constant timestamptz:=TIMESTAMPTZ '9999-12-31 23:59:59.999999+00';
BEGIN
  IF p_request_id IS NULL OR p_attempt_id IS NULL THEN RAISE EXCEPTION 'CRM_SLA_DISPATCH_INVALID_INPUT'; END IF;
  SELECT * INTO settings_row FROM public.crm_settings WHERE id FOR SHARE;
  IF NOT FOUND OR (settings_row.central_intake_enabled AND settings_row.lead_work_enabled
    AND settings_row.lead_lifecycle_enabled AND settings_row.work_schedule_enabled AND settings_row.notifications_enabled
    AND settings_row.sla_preview_enabled AND settings_row.sla_processing_enabled AND settings_row.sla_cycle_enabled
    AND settings_row.sla_worker_enabled AND settings_row.sla_dispatcher_enabled) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'CRM_SLA_DISPATCH_SETUP_REQUIRED';
  END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended('sla-first-contact-dispatch:global',0)) THEN RETURN NULL; END IF;
  SELECT current_request_id INTO current_id FROM sales_private.crm_first_contact_dispatch_control WHERE id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CRM_SLA_DISPATCH_SETUP_REQUIRED'; END IF;
  IF current_id IS DISTINCT FROM p_request_id THEN RAISE EXCEPTION 'CRM_SLA_DISPATCH_NOT_AVAILABLE'; END IF;
  SELECT * INTO request_row FROM sales_private.crm_first_contact_dispatch_requests WHERE request_id=current_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CRM_SLA_DISPATCH_NOT_AVAILABLE'; END IF;
  IF request_row.current_attempt_id IS DISTINCT FROM p_attempt_id THEN RAISE EXCEPTION 'CRM_SLA_DISPATCH_STALE_ATTEMPT'; END IF;
  SELECT * INTO attempt_row FROM sales_private.crm_first_contact_dispatch_attempts WHERE attempt_id=p_attempt_id;
  IF NOT FOUND OR attempt_row.request_id IS DISTINCT FROM current_id OR attempt_row.attempt_no IS DISTINCT FROM request_row.attempt_count THEN
    RAISE EXCEPTION 'CRM_SLA_DISPATCH_STALE_ATTEMPT';
  END IF;
  -- Full transaction IDs fence prepare+execute in one outer transaction, even
  -- when a caller inserts savepoints. A committed reservation is mandatory.
  IF attempt_row.prepared_xid=pg_current_xact_id() THEN RAISE EXCEPTION 'CRM_SLA_DISPATCH_NOT_COMMITTED'; END IF;
  IF request_row.status IN ('completed','review') THEN
    RETURN sales_private.crm_first_contact_dispatch_projection(request_row,current_id);
  END IF;
  now_value:=clock_timestamp();
  IF NOT isfinite(now_value) OR now_value<minimum_at OR now_value<request_row.created_at
    OR now_value<attempt_row.prepared_at OR now_value>maximum_at-interval '480 seconds' THEN
    RAISE EXCEPTION 'CRM_SLA_DISPATCH_SETUP_REQUIRED';
  END IF;
  IF request_row.status<>'reserved' OR now_value>=request_row.next_attempt_at THEN
    RETURN sales_private.crm_first_contact_dispatch_projection(request_row,current_id);
  END IF;
  BEGIN
    --13 replays this SAME request if its immutable receipt already committed.
    -- Dispatcher has no direct worker/core grant: only this private definer path.
    receipt_value:=sales_private.crm_first_contact_worker_cycle(current_id);
    IF jsonb_typeof(receipt_value) IS DISTINCT FROM 'object'
      OR receipt_value->'actor' IS DISTINCT FROM jsonb_build_object('kind','system','name','first_contact_worker_v1')
      OR receipt_value->>'requestId' IS DISTINCT FROM current_id::text THEN
      RAISE EXCEPTION 'CRM_SLA_DISPATCH_PROCESSING_REVIEW';
    END IF;
    completed_value:=clock_timestamp();
    IF NOT isfinite(completed_value) OR completed_value<now_value OR completed_value>maximum_at-interval '60 seconds' THEN
      RAISE EXCEPTION 'CRM_SLA_DISPATCH_PROCESSING_REVIEW';
    END IF;
    UPDATE sales_private.crm_first_contact_dispatch_requests SET status='completed',completed_at=completed_value,
      next_attempt_at=completed_value+interval '60 seconds',last_error_code=NULL WHERE request_id=current_id;
  EXCEPTION
    -- Cancellation/assertion and connection-shutdown classes must propagate.
    -- They do not prove failure or justify a replacement request UUID.
    WHEN query_canceled OR assert_failure OR SQLSTATE '08000' OR SQLSTATE '08003'
      OR SQLSTATE '08006' OR SQLSTATE '57P01' OR SQLSTATE '57P02' OR SQLSTATE '57P03' OR SQLSTATE '57P04' THEN RAISE;
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS message_value=MESSAGE_TEXT;
      transient_failure:=SQLSTATE IN ('55P03','40P01','40001')
        OR (SQLSTATE='P0001' AND message_value='CRM_SLA_WORKER_BUSY');
      -- message_value is used ONLY for the exact known busy marker above. Never
      -- store/return raw message, detail, SQLERRM, data or child receipt bodies.
      now_value:=clock_timestamp();
      IF NOT isfinite(now_value) OR now_value<request_row.created_at OR now_value<attempt_row.prepared_at
        OR now_value<minimum_at OR now_value>maximum_at-interval '480 seconds' THEN
        RAISE EXCEPTION 'CRM_SLA_DISPATCH_SETUP_REQUIRED';
      END IF;
      IF transient_failure AND request_row.attempt_count<5 THEN
        backoff_seconds:=LEAST(480,60*(2^(request_row.attempt_count-1))::integer);
        UPDATE sales_private.crm_first_contact_dispatch_requests SET status='retry_wait',last_error_code='TRANSIENT_RETRY',
          next_attempt_at=now_value+(interval '1 second'*backoff_seconds) WHERE request_id=current_id;
      ELSE
        UPDATE sales_private.crm_first_contact_dispatch_requests SET status='review',
          last_error_code=CASE WHEN transient_failure THEN 'RETRY_LIMIT' ELSE 'PROCESSING_REVIEW' END,
          next_attempt_at=now_value WHERE request_id=current_id;
      END IF;
  END;
  -- Read the write result inside this VOLATILE function. Calling the public
  -- STABLE lookup here could retain the invoking SELECT's earlier snapshot.
  SELECT * INTO request_row FROM sales_private.crm_first_contact_dispatch_requests WHERE request_id=current_id;
  RETURN sales_private.crm_first_contact_dispatch_projection(request_row,current_id);
END;
$dispatch_execute$;
REVOKE ALL ON FUNCTION sales_private.crm_first_contact_dispatch_execute(uuid,uuid) FROM PUBLIC, anon, authenticated, buildtrack_sales_sla_worker;

-- TOP-LEVEL CALL ONLY, without an explicit BEGIN/transaction block or enclosing
-- function. SECURITY INVOKER and NO SET clause are required for COMMIT here.
-- No exception handler, loop, sleep or implicit retry. Statement/runtime limits
-- belong to the future caller.500ms above bounds each lock wait, not total time.
-- Before the first COMMIT: no worker could have run. After it: request+attempt
-- survive any lost connection; lease recovery retains the SAME request UUID.
CREATE PROCEDURE sales_private.crm_first_contact_worker_tick()
LANGUAGE plpgsql SECURITY INVOKER
AS $worker_tick$
DECLARE
  reservation_value pg_catalog.jsonb;
BEGIN
  reservation_value:=sales_private.crm_first_contact_dispatch_prepare();
  COMMIT;
  IF reservation_value IS NOT NULL THEN
    PERFORM sales_private.crm_first_contact_dispatch_execute(
      pg_catalog.jsonb_extract_path_text(reservation_value,'requestId')::pg_catalog.uuid,
      pg_catalog.jsonb_extract_path_text(reservation_value,'attemptId')::pg_catalog.uuid);
  END IF;
  COMMIT;
END;
$worker_tick$;
REVOKE ALL ON PROCEDURE sales_private.crm_first_contact_worker_tick() FROM PUBLIC, anon, authenticated, buildtrack_sales_sla_worker;

GRANT USAGE ON SCHEMA sales_private TO buildtrack_sales_sla_dispatcher;
GRANT EXECUTE ON FUNCTION sales_private.crm_first_contact_dispatch_prepare() TO buildtrack_sales_sla_dispatcher;
GRANT EXECUTE ON FUNCTION sales_private.crm_first_contact_dispatch_execute(uuid,uuid) TO buildtrack_sales_sla_dispatcher;
GRANT EXECUTE ON FUNCTION sales_private.crm_first_contact_dispatch_status(uuid) TO buildtrack_sales_sla_dispatcher;
GRANT EXECUTE ON PROCEDURE sales_private.crm_first_contact_worker_tick() TO buildtrack_sales_sla_dispatcher;
-- No login/membership/worker/core/table grant, connection binding, actual Cron or
-- production frequency claim. Terminal review deliberately requires separately
-- designed operator remediation; never reset/delete history to resume silently.
ROLLBACK;
