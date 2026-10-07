-- SALES V2 POST-BOOKING COMMANDS -- DESIGN ONLY, 2026-09-23.
-- NEVER RUN ON SUPABASE. Depends on guarded base + 04/05/18.
-- Actual transfer uses an explicitly entered civil DATE, never a fabricated time.
-- No handover, money/stock mutation,
-- verified-upload claim, backfill, KPI credit, fake Visit or legacy bank status.
BEGIN;
DO $draft_only$
BEGIN
  RAISE EXCEPTION 'DESIGN ONLY: post booking is not authorized for database execution';
END;
$draft_only$;

ALTER TABLE public.crm_settings ADD COLUMN post_booking_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.sales ADD COLUMN crm_transfer_date date NULL
  CHECK(crm_transfer_date IS NULL OR (isfinite(crm_transfer_date) AND crm_transfer_date>=DATE '0001-01-01' AND crm_transfer_date<DATE '10000-01-01'));
CREATE TABLE sales_private.post_booking_write_permits (
  transaction_id bigint PRIMARY KEY,backend_pid integer NOT NULL
);
CREATE TABLE sales_private.post_booking_command_requests (
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL,request_payload jsonb NOT NULL,response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(actor_user_id,request_id)
);
CREATE TABLE sales_private.post_booking_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.sales_customers(id) ON DELETE RESTRICT,
  project_interest_id uuid NOT NULL,sale_id uuid NOT NULL,
  command text NOT NULL CHECK(command IN ('advance','submit_loan','loan_result','confirm_transfer')),
  from_stage text NOT NULL,to_stage text NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 1000),
  evidence_note text NULL CHECK(length(btrim(evidence_note)) BETWEEN 1 AND 1000),
  occurred_at timestamptz NULL CHECK(isfinite(occurred_at)),
  transfer_date date NULL CHECK(isfinite(transfer_date) AND transfer_date>=DATE '0001-01-01' AND transfer_date<DATE '10000-01-01'),
  recorded_at timestamptz NOT NULL CHECK(isfinite(recorded_at)),
  loan_attempt_id uuid REFERENCES public.loan_attempts(id) ON DELETE RESTRICT,
  FOREIGN KEY(project_interest_id,customer_id) REFERENCES public.lead_project_interests(id,customer_id) ON DELETE RESTRICT,
  FOREIGN KEY(sale_id,project_interest_id) REFERENCES public.sales(id,project_interest_id) ON DELETE RESTRICT,
  CHECK(occurred_at<=recorded_at),CHECK(from_stage<>to_stage),
  CHECK((command='confirm_transfer' AND transfer_date IS NOT NULL AND occurred_at IS NULL AND evidence_note IS NULL
      AND loan_attempt_id IS NULL AND from_stage='transfer_pending' AND to_stage='transferred')
    OR (command<>'confirm_transfer' AND transfer_date IS NULL AND occurred_at IS NOT NULL AND evidence_note IS NOT NULL))
);
CREATE INDEX post_booking_events_sale_history_idx ON sales_private.post_booking_events(sale_id,recorded_at DESC,id DESC);
ALTER TABLE sales_private.post_booking_write_permits ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_private.post_booking_command_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_private.post_booking_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sales_private.post_booking_write_permits,sales_private.post_booking_command_requests,sales_private.post_booking_events
  FROM PUBLIC,anon,authenticated;

-- The 18 booking permit alone must not grant transfer/reversal authority.
-- Historical imported transfers may remain date-unknown; never infer a DATE from
-- transferred_at, or fill that legacy timestamp with a made-up midnight.
CREATE FUNCTION sales_private.crm_post_booking_protect_transfer()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $protect_transfer$
BEGIN
  IF TG_OP='UPDATE' AND OLD.project_interest_id IS NOT NULL AND OLD.crm_stage IN ('transferred','handover')
    AND (NEW.crm_stage IS DISTINCT FROM OLD.crm_stage OR NEW.contract_status IS DISTINCT FROM OLD.contract_status
      OR NEW.crm_transfer_date IS DISTINCT FROM OLD.crm_transfer_date) THEN RAISE EXCEPTION 'CRM_POST_BOOKING_CONFLICT'; END IF;
  IF (TG_OP='INSERT' AND NEW.crm_transfer_date IS NOT NULL)
    OR (TG_OP='UPDATE' AND (NEW.crm_transfer_date IS DISTINCT FROM OLD.crm_transfer_date
      OR (NEW.project_interest_id IS NOT NULL AND NEW.crm_stage='transferred' AND OLD.crm_stage IS DISTINCT FROM NEW.crm_stage))) THEN
    IF NOT EXISTS(SELECT 1 FROM sales_private.post_booking_write_permits
      WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid()) THEN RAISE EXCEPTION 'CRM_POST_BOOKING_FORBIDDEN'; END IF;
    IF TG_OP<>'UPDATE' OR OLD.crm_stage IS DISTINCT FROM 'transfer_pending' OR OLD.crm_transfer_date IS NOT NULL
      OR NEW.crm_stage IS DISTINCT FROM 'transferred' OR NEW.contract_status IS DISTINCT FROM 'Transferred' OR NEW.crm_transfer_date IS NULL THEN
      RAISE EXCEPTION 'CRM_POST_BOOKING_CONFLICT'; END IF;
  END IF;
  RETURN NEW;
END;
$protect_transfer$;
REVOKE ALL ON FUNCTION sales_private.crm_post_booking_protect_transfer() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER crm_post_booking_protect_transfer BEFORE INSERT OR UPDATE ON public.sales
  FOR EACH ROW EXECUTE FUNCTION sales_private.crm_post_booking_protect_transfer();

CREATE FUNCTION sales_private.crm_post_booking_protect_loan()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $protect_loan$
DECLARE protected boolean;
BEGIN
  protected:=CASE WHEN TG_OP='INSERT' THEN NEW.kind='purchase' WHEN TG_OP='DELETE' THEN OLD.kind='purchase'
    ELSE OLD.kind='purchase' OR NEW.kind='purchase' END;
  IF NOT protected THEN RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END IF;
  IF NOT EXISTS(SELECT 1 FROM sales_private.post_booking_write_permits
    WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid()) THEN RAISE EXCEPTION 'CRM_POST_BOOKING_FORBIDDEN'; END IF;
  IF TG_OP='DELETE' OR (TG_OP='UPDATE' AND OLD.result_status IN ('approved','rejected','withdrawn') AND to_jsonb(OLD) IS DISTINCT FROM to_jsonb(NEW)) THEN
    RAISE EXCEPTION 'CRM_POST_BOOKING_CONFLICT';
  END IF;
  IF TG_OP='UPDATE' AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.sale_id IS DISTINCT FROM OLD.sale_id
    OR NEW.project_interest_id IS DISTINCT FROM OLD.project_interest_id OR NEW.attempt_number IS DISTINCT FROM OLD.attempt_number
    OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW.bank_name IS DISTINCT FROM OLD.bank_name
    OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at OR NEW.recorded_by_user_id IS DISTINCT FROM OLD.recorded_by_user_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at) THEN RAISE EXCEPTION 'CRM_POST_BOOKING_CONFLICT'; END IF;
  RETURN NEW;
END;
$protect_loan$;
REVOKE ALL ON FUNCTION sales_private.crm_post_booking_protect_loan() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER crm_post_booking_protect_loan BEFORE INSERT OR UPDATE OR DELETE ON public.loan_attempts
  FOR EACH ROW EXECUTE FUNCTION sales_private.crm_post_booking_protect_loan();

CREATE FUNCTION sales_private.crm_post_booking_protect_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $protect_event$
BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'CRM_POST_BOOKING_CONFLICT'; END IF;
  IF NOT EXISTS(SELECT 1 FROM sales_private.post_booking_write_permits
    WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid()) THEN RAISE EXCEPTION 'CRM_POST_BOOKING_FORBIDDEN'; END IF;
  RETURN NEW;
END;
$protect_event$;
REVOKE ALL ON FUNCTION sales_private.crm_post_booking_protect_event() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER crm_post_booking_protect_event BEFORE INSERT OR UPDATE OR DELETE ON sales_private.post_booking_events
  FOR EACH ROW EXECUTE FUNCTION sales_private.crm_post_booking_protect_event();

CREATE FUNCTION public.crm_v2_post_booking_capabilities()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC'
AS $capabilities$
  SELECT jsonb_build_object('contract_version','post_booking_v2','enabled',
    COALESCE((public.crm_v2_booking_capabilities()->>'enabled')::boolean,false)
      AND COALESCE((SELECT post_booking_enabled FROM public.crm_settings WHERE id),false));
$capabilities$;
REVOKE ALL ON FUNCTION public.crm_v2_post_booking_capabilities() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_v2_post_booking_capabilities() TO authenticated;

CREATE FUNCTION sales_private.crm_post_booking_attempt_json(a public.loan_attempts)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog SET timezone='UTC'
AS $attempt_json$
  SELECT jsonb_build_object('id',a.id,'saleId',a.sale_id,'interestId',a.project_interest_id,'attemptNumber',a.attempt_number,
    'bankName',a.bank_name,'status',a.result_status,'submittedAt',a.submitted_at,'resultAt',a.result_at,
    'resultReason',a.result_reason,'approvedAmount',a.approved_amount,'recordedByUserId',a.recorded_by_user_id);
$attempt_json$;
REVOKE ALL ON FUNCTION sales_private.crm_post_booking_attempt_json(public.loan_attempts) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.crm_v2_post_booking_context(p_sale_id uuid,p_attempt_page integer DEFAULT 0,p_event_page integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC'
AS $context$
DECLARE
  actor_id uuid:=auth.uid(); actor_role text:=public.crm_v2_role(); sale_row public.sales%ROWTYPE;
  interest_row public.lead_project_interests%ROWTYPE; customer_row public.sales_customers%ROWTYPE;
  attempts_json jsonb; events_json jsonb; latest_json jsonb; attempts_more boolean; events_more boolean;
BEGIN
  IF actor_id IS NULL OR COALESCE(actor_role,'') NOT IN ('sales','admin','owner') THEN RAISE EXCEPTION 'CRM_POST_BOOKING_FORBIDDEN'; END IF;
  IF (public.crm_v2_post_booking_capabilities()->>'enabled')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'CRM_POST_BOOKING_SETUP_REQUIRED'; END IF;
  IF p_sale_id IS NULL OR p_attempt_page IS NULL OR p_attempt_page NOT BETWEEN 0 AND 100000
    OR p_event_page IS NULL OR p_event_page NOT BETWEEN 0 AND 100000 THEN RAISE EXCEPTION 'CRM_POST_BOOKING_INVALID_INPUT'; END IF;
  SELECT * INTO sale_row FROM public.sales WHERE id=p_sale_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'CRM_POST_BOOKING_NOT_FOUND'; END IF;
  SELECT * INTO interest_row FROM public.lead_project_interests WHERE id=sale_row.project_interest_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'CRM_POST_BOOKING_SETUP_REQUIRED'; END IF;
  SELECT * INTO customer_row FROM public.sales_customers WHERE id=interest_row.customer_id;
  IF NOT FOUND OR customer_row.merged_into_customer_id IS NOT NULL OR NOT EXISTS(SELECT 1 FROM sales_private.crm_user_roles
    WHERE user_id=interest_row.owner_user_id AND role='sales') THEN RAISE EXCEPTION 'CRM_POST_BOOKING_SETUP_REQUIRED'; END IF;
  IF sale_row.crm_stage IS NULL OR sale_row.booking_round IS NULL
    OR (sale_row.plot_id IS NULL AND sale_row.crm_stage<>'cancelled')
    OR (sale_row.plot_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.plots WHERE id=sale_row.plot_id AND project_name=interest_row.project_name))
    OR EXISTS(SELECT 1 FROM public.loan_attempts a WHERE a.sale_id=p_sale_id AND a.kind='purchase' AND a.project_interest_id<>interest_row.id) THEN
    RAISE EXCEPTION 'CRM_POST_BOOKING_SETUP_REQUIRED';
  END IF;
  WITH rows AS (SELECT a FROM public.loan_attempts a WHERE a.sale_id=p_sale_id AND a.kind='purchase'
    ORDER BY a.attempt_number DESC,a.id LIMIT 51 OFFSET p_attempt_page*50), numbered AS (
    SELECT a,row_number() OVER(ORDER BY (a).attempt_number DESC,(a).id) rn FROM rows)
  SELECT COALESCE(jsonb_agg(sales_private.crm_post_booking_attempt_json(a) ORDER BY (a).attempt_number DESC,(a).id)
    FILTER(WHERE rn<=50),'[]'::jsonb),count(*)>50 INTO attempts_json,attempts_more FROM numbered;
  SELECT sales_private.crm_post_booking_attempt_json(a) INTO latest_json FROM public.loan_attempts a
    WHERE a.sale_id=p_sale_id AND a.kind='purchase' ORDER BY a.attempt_number DESC,a.id LIMIT 1;
  WITH rows AS (SELECT * FROM sales_private.post_booking_events WHERE sale_id=p_sale_id
    ORDER BY recorded_at DESC,id DESC LIMIT 51 OFFSET p_event_page*50), numbered AS (
    SELECT *,row_number() OVER(ORDER BY recorded_at DESC,id DESC) rn FROM rows)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'command',command,'fromStage',from_stage,'toStage',to_stage,
    'occurredAt',occurred_at,'recordedAt',recorded_at,'actorUserId',actor_user_id,'reason',reason,
    'evidenceNote',evidence_note,'loanAttemptId',loan_attempt_id,'transferDate',transfer_date) ORDER BY recorded_at DESC,id DESC)
    FILTER(WHERE rn<=50),'[]'::jsonb),count(*)>50 INTO events_json,events_more FROM numbered;
  RETURN jsonb_build_object('actor',jsonb_build_object('userId',actor_id,'role',actor_role),
    'sale',jsonb_build_object('id',sale_row.id,'customerId',customer_row.id,'customerName',customer_row.customer_name,
      'interestId',interest_row.id,'projectName',interest_row.project_name,'plotId',sale_row.plot_id,'stage',sale_row.crm_stage,
      'paymentMethod',sale_row.payment_method,'bookedAt',sale_row.booked_at,'contractedAt',sale_row.contracted_at,'transferDate',sale_row.crm_transfer_date,
      'revision',sale_row.booking_revision,'interestRevision',interest_row.lifecycle_revision,'ownerUserId',interest_row.owner_user_id,
      'canEdit',(actor_role='admin' OR (actor_role='sales' AND actor_id=interest_row.owner_user_id))
        AND sale_row.payment_method IS NOT NULL AND sale_row.crm_stage NOT IN ('cancelled','transferred','handover')
        AND (sale_row.payment_method='mortgage' OR sale_row.crm_stage NOT IN ('loan_submitted','loan_rejected','loan_approved'))
        AND EXISTS(SELECT 1 FROM sales_private.crm_user_roles WHERE user_id=interest_row.owner_user_id AND role='sales' AND is_active)),
    'latestAttempt',latest_json,'attempts',attempts_json,'attemptPage',p_attempt_page,'attemptsHasMore',attempts_more,
    'events',events_json,'eventPage',p_event_page,'eventsHasMore',events_more);
END;
$context$;
REVOKE ALL ON FUNCTION public.crm_v2_post_booking_context(uuid,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_v2_post_booking_context(uuid,integer,integer) TO authenticated;

CREATE FUNCTION public.crm_v2_post_booking_command(p_request_id uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC'
AS $command$
DECLARE
  actor_id uuid:=auth.uid(); actor_role text:=public.crm_v2_role(); actor_name text;
  command_name text; allowed_keys text[]; reason_value text; evidence_value text; bank_value text; next_stage text;
  customer_id_value uuid; sale_id_value uuid; expected_sale uuid; expected_interest uuid; loan_id_value uuid;
  occurred_value timestamptz; server_now timestamptz; latest_event_time timestamptz; enabled boolean;
  transfer_value date; latest_loan_time timestamptz; plot_row public.plots%ROWTYPE;
  actor_active boolean:=false; owner_active boolean:=false; role_row sales_private.crm_user_roles%ROWTYPE;
  customer_row public.sales_customers%ROWTYPE; interest_row public.lead_project_interests%ROWTYPE; sale_row public.sales%ROWTYPE;
  latest_attempt public.loan_attempts%ROWTYPE; loan_row public.loan_attempts%ROWTYPE;
  request_row sales_private.post_booking_command_requests%ROWTYPE;
  amount_satang bigint; next_attempt integer; event_id_value uuid; response_value jsonb; old_sale jsonb; old_loan jsonb;
BEGIN
  IF actor_id IS NULL OR COALESCE(actor_role,'') NOT IN ('sales','admin') THEN RAISE EXCEPTION 'CRM_POST_BOOKING_FORBIDDEN'; END IF;
  SELECT central_intake_enabled AND lead_work_enabled AND lead_lifecycle_enabled AND booking_enabled AND booking_cutover_reviewed AND post_booking_enabled
    INTO enabled FROM public.crm_settings WHERE id FOR SHARE;
  IF enabled IS DISTINCT FROM true THEN RAISE EXCEPTION 'CRM_POST_BOOKING_SETUP_REQUIRED'; END IF;
  IF p_request_id IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR octet_length(p_payload::text)>16384
    OR jsonb_typeof(p_payload->'command') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'CRM_POST_BOOKING_INVALID_INPUT'; END IF;
  command_name:=p_payload->>'command';
  allowed_keys:=ARRAY['command','customerId','saleId','expectedSaleRevision','expectedInterestRevision','reason']||
    CASE WHEN command_name='confirm_transfer' THEN ARRAY['transferDate'] ELSE ARRAY['evidenceNote','occurredAt']||
    CASE command_name WHEN 'advance' THEN ARRAY['nextStage'] WHEN 'submit_loan' THEN ARRAY['bankName']
      WHEN 'loan_result' THEN ARRAY['loanAttemptId','result','approvedAmountSatang'] ELSE NULL END END;
  IF command_name NOT IN ('advance','submit_loan','loan_result','confirm_transfer') OR NOT(p_payload ?& allowed_keys)
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE NOT(k=ANY(allowed_keys)))
    OR jsonb_typeof(p_payload->'reason') IS DISTINCT FROM 'string'
    OR (command_name='confirm_transfer' AND jsonb_typeof(p_payload->'transferDate') IS DISTINCT FROM 'string')
    OR (command_name<>'confirm_transfer' AND (jsonb_typeof(p_payload->'evidenceNote') IS DISTINCT FROM 'string'
      OR jsonb_typeof(p_payload->'occurredAt') IS DISTINCT FROM 'string')) THEN RAISE EXCEPTION 'CRM_POST_BOOKING_INVALID_INPUT'; END IF;
  BEGIN
    customer_id_value:=sales_private.crm_booking_uuid(p_payload->'customerId'); sale_id_value:=sales_private.crm_booking_uuid(p_payload->'saleId');
    expected_sale:=sales_private.crm_booking_uuid(p_payload->'expectedSaleRevision'); expected_interest:=sales_private.crm_booking_uuid(p_payload->'expectedInterestRevision');
    reason_value:=sales_private.crm_work_text(p_payload->>'reason',1000);
    IF command_name<>'confirm_transfer' THEN
      evidence_value:=sales_private.crm_work_text(p_payload->>'evidenceNote',1000);
      occurred_value:=sales_private.crm_work_timestamp(p_payload->>'occurredAt');
    END IF;
  EXCEPTION WHEN raise_exception THEN RAISE EXCEPTION 'CRM_POST_BOOKING_INVALID_INPUT'; END;
  IF occurred_value<TIMESTAMPTZ '0001-01-01 00:00:00+00' OR occurred_value>=TIMESTAMPTZ '10000-01-01 00:00:00+00' THEN
    RAISE EXCEPTION 'CRM_POST_BOOKING_INVALID_INPUT';
  END IF;
  IF command_name='confirm_transfer' THEN
    IF (p_payload->>'transferDate') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RAISE EXCEPTION 'CRM_POST_BOOKING_INVALID_INPUT'; END IF;
    BEGIN transfer_value:=(p_payload->>'transferDate')::date;
    EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RAISE EXCEPTION 'CRM_POST_BOOKING_INVALID_INPUT'; END;
    IF NOT isfinite(transfer_value) OR transfer_value<DATE '0001-01-01' OR transfer_value>=DATE '10000-01-01' THEN
      RAISE EXCEPTION 'CRM_POST_BOOKING_INVALID_INPUT'; END IF;
    next_stage:='transferred';
  ELSIF command_name='advance' THEN
    IF jsonb_typeof(p_payload->'nextStage') IS DISTINCT FROM 'string' OR p_payload->>'nextStage' NOT IN ('contracted','downpayment','document_prep','transfer_pending') THEN
      RAISE EXCEPTION 'CRM_POST_BOOKING_INVALID_INPUT'; END IF;
    next_stage:=p_payload->>'nextStage';
  ELSIF command_name='submit_loan' THEN
    IF jsonb_typeof(p_payload->'bankName') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'CRM_POST_BOOKING_INVALID_INPUT'; END IF;
    BEGIN bank_value:=sales_private.crm_work_text(p_payload->>'bankName',200);
    EXCEPTION WHEN raise_exception THEN RAISE EXCEPTION 'CRM_POST_BOOKING_INVALID_INPUT'; END;
    next_stage:='loan_submitted';
  ELSE
    BEGIN loan_id_value:=sales_private.crm_booking_uuid(p_payload->'loanAttemptId');
    EXCEPTION WHEN raise_exception THEN RAISE EXCEPTION 'CRM_POST_BOOKING_INVALID_INPUT'; END;
    IF jsonb_typeof(p_payload->'result') IS DISTINCT FROM 'string' OR p_payload->>'result' NOT IN ('approved','rejected') THEN
      RAISE EXCEPTION 'CRM_POST_BOOKING_INVALID_INPUT'; END IF;
    IF p_payload->>'result'='approved' THEN
      IF jsonb_typeof(p_payload->'approvedAmountSatang') IS DISTINCT FROM 'number' OR (p_payload->>'approvedAmountSatang') !~ '^[0-9]{1,11}$' THEN
        RAISE EXCEPTION 'CRM_POST_BOOKING_INVALID_INPUT'; END IF;
      amount_satang:=(p_payload->>'approvedAmountSatang')::bigint;
      IF amount_satang<=0 THEN RAISE EXCEPTION 'CRM_POST_BOOKING_INVALID_INPUT'; END IF;
    ELSIF p_payload->'approvedAmountSatang'<>'null'::jsonb THEN RAISE EXCEPTION 'CRM_POST_BOOKING_INVALID_INPUT'; END IF;
    next_stage:='loan_'||(p_payload->>'result');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('crm-booking-command',0));
  SELECT * INTO request_row FROM sales_private.post_booking_command_requests WHERE actor_user_id=actor_id AND request_id=p_request_id;
  IF FOUND THEN customer_id_value:=(request_row.response->>'customerId')::uuid; sale_id_value:=(request_row.response->>'saleId')::uuid; END IF;
  SELECT * INTO customer_row FROM public.sales_customers WHERE id=customer_id_value FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CRM_POST_BOOKING_NOT_FOUND'; END IF;
  IF customer_row.merged_into_customer_id IS NOT NULL THEN RAISE EXCEPTION 'CRM_POST_BOOKING_CONFLICT'; END IF;
  SELECT i.* INTO interest_row FROM public.lead_project_interests i JOIN public.sales s ON s.project_interest_id=i.id
    WHERE s.id=sale_id_value AND i.customer_id=customer_id_value FOR UPDATE OF i;
  IF NOT FOUND THEN RAISE EXCEPTION 'CRM_POST_BOOKING_NOT_FOUND'; END IF;
  FOR role_row IN SELECT * FROM sales_private.crm_user_roles WHERE user_id IN(actor_id,interest_row.owner_user_id) ORDER BY user_id FOR SHARE LOOP
    IF role_row.user_id=actor_id AND role_row.is_active THEN actor_role:=role_row.role; actor_name:=role_row.display_name; actor_active:=true; END IF;
    IF role_row.user_id=interest_row.owner_user_id THEN owner_active:=role_row.role='sales' AND role_row.is_active; END IF;
  END LOOP;
  IF NOT actor_active OR NOT owner_active OR actor_role NOT IN ('sales','admin') OR (actor_role='sales' AND actor_id<>interest_row.owner_user_id) THEN
    RAISE EXCEPTION 'CRM_POST_BOOKING_FORBIDDEN'; END IF;
  SELECT * INTO sale_row FROM public.sales WHERE id=sale_id_value AND project_interest_id=interest_row.id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CRM_POST_BOOKING_NOT_FOUND'; END IF;
  IF request_row.request_id IS NOT NULL THEN
    IF request_row.request_payload IS DISTINCT FROM p_payload THEN RAISE EXCEPTION 'CRM_POST_BOOKING_IDEMPOTENCY_CONFLICT'; END IF;
    RETURN request_row.response||jsonb_build_object('replayed',true);
  END IF;
  IF sale_row.booking_revision IS DISTINCT FROM expected_sale OR interest_row.lifecycle_revision IS DISTINCT FROM expected_interest THEN
    RAISE EXCEPTION 'CRM_POST_BOOKING_STALE_STATE'; END IF;
  IF sale_row.crm_stage IN ('cancelled','transferred','handover') OR (sale_row.crm_stage='transfer_pending' AND command_name<>'confirm_transfer') THEN
    RAISE EXCEPTION 'CRM_POST_BOOKING_CONFLICT'; END IF;
  IF sale_row.payment_method IS NULL OR sale_row.crm_stage IS NULL OR sale_row.booking_round IS NULL
    OR NOT EXISTS(SELECT 1 FROM public.plots WHERE id=sale_row.plot_id AND project_name=interest_row.project_name)
    OR EXISTS(SELECT 1 FROM public.sales WHERE lead_id=customer_row.legacy_source_lead_id AND project_interest_id IS NULL) THEN
    RAISE EXCEPTION 'CRM_POST_BOOKING_SETUP_REQUIRED'; END IF;
  server_now:=clock_timestamp();
  IF occurred_value>server_now THEN RAISE EXCEPTION 'CRM_POST_BOOKING_INVALID_INPUT'; END IF;
  SELECT * INTO latest_attempt FROM public.loan_attempts WHERE sale_id=sale_row.id AND kind='purchase'
    ORDER BY attempt_number DESC,id LIMIT 1 FOR UPDATE;
  SELECT max(occurred_at) INTO latest_event_time FROM sales_private.post_booking_events WHERE sale_id=sale_row.id;
  IF (sale_row.booked_at IS NOT NULL AND NOT isfinite(sale_row.booked_at)) OR (sale_row.contracted_at IS NOT NULL AND NOT isfinite(sale_row.contracted_at))
    OR (latest_attempt.submitted_at IS NOT NULL AND NOT isfinite(latest_attempt.submitted_at))
    OR (latest_attempt.result_at IS NOT NULL AND NOT isfinite(latest_attempt.result_at)) THEN RAISE EXCEPTION 'CRM_POST_BOOKING_SETUP_REQUIRED'; END IF;
  IF occurred_value<sale_row.booked_at OR occurred_value<sale_row.contracted_at OR occurred_value<latest_event_time
    OR occurred_value<latest_attempt.submitted_at OR occurred_value<latest_attempt.result_at THEN RAISE EXCEPTION 'CRM_POST_BOOKING_INVALID_INPUT'; END IF;
  old_sale:=to_jsonb(sale_row); old_loan:=NULL;
  IF command_name='confirm_transfer' THEN
    IF sale_row.crm_stage<>'transfer_pending' OR sale_row.crm_transfer_date IS NOT NULL THEN RAISE EXCEPTION 'CRM_POST_BOOKING_CONFLICT'; END IF;
    SELECT * INTO plot_row FROM public.plots WHERE id=sale_row.plot_id FOR UPDATE;
    IF NOT FOUND OR plot_row.project_name IS DISTINCT FROM interest_row.project_name OR plot_row.has_customer IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'CRM_POST_BOOKING_SETUP_REQUIRED'; END IF;
    IF sale_row.payment_method='cash' AND latest_attempt.id IS NOT NULL THEN RAISE EXCEPTION 'CRM_POST_BOOKING_SETUP_REQUIRED'; END IF;
    IF sale_row.payment_method='mortgage' AND (latest_attempt.id IS NULL
      OR latest_attempt.project_interest_id<>interest_row.id OR latest_attempt.result_status<>'approved'
      OR latest_attempt.submitted_at IS NULL OR latest_attempt.result_at IS NULL OR latest_attempt.result_at<latest_attempt.submitted_at
      OR latest_attempt.approved_amount IS NULL OR latest_attempt.approved_amount<=0
      OR latest_attempt.approved_amount::text IN ('NaN','Infinity','-Infinity')
      OR EXISTS(SELECT 1 FROM public.loan_attempts WHERE sale_id=sale_row.id AND kind='purchase' AND result_status IN ('submitted','pending'))) THEN
      RAISE EXCEPTION 'CRM_POST_BOOKING_SETUP_REQUIRED'; END IF;
    IF EXISTS(SELECT 1 FROM public.loan_attempts WHERE sale_id=sale_row.id AND kind='purchase'
      AND ((submitted_at IS NOT NULL AND NOT isfinite(submitted_at)) OR (result_at IS NOT NULL AND NOT isfinite(result_at)))) THEN
      RAISE EXCEPTION 'CRM_POST_BOOKING_SETUP_REQUIRED'; END IF;
    SELECT max(GREATEST(submitted_at,result_at)) INTO latest_loan_time FROM public.loan_attempts WHERE sale_id=sale_row.id AND kind='purchase';
    IF transfer_value>(server_now AT TIME ZONE 'Asia/Bangkok')::date
      OR transfer_value<(sale_row.booked_at AT TIME ZONE 'Asia/Bangkok')::date
      OR transfer_value<(sale_row.contracted_at AT TIME ZONE 'Asia/Bangkok')::date
      OR transfer_value<(latest_event_time AT TIME ZONE 'Asia/Bangkok')::date
      OR transfer_value<(latest_loan_time AT TIME ZONE 'Asia/Bangkok')::date THEN RAISE EXCEPTION 'CRM_POST_BOOKING_INVALID_INPUT'; END IF;
  ELSIF command_name='advance' THEN
    IF NOT ((sale_row.crm_stage='booked' AND next_stage='contracted')
      OR (sale_row.crm_stage='contracted' AND next_stage IN ('downpayment','document_prep'))
      OR (sale_row.crm_stage='downpayment' AND next_stage='document_prep')
      OR (next_stage='transfer_pending' AND ((sale_row.payment_method='cash' AND sale_row.crm_stage IN ('contracted','downpayment','document_prep'))
        OR (sale_row.payment_method='mortgage' AND sale_row.crm_stage='loan_approved')))) THEN RAISE EXCEPTION 'CRM_POST_BOOKING_CONFLICT'; END IF;
    IF next_stage='contracted' AND sale_row.contracted_at IS NOT NULL THEN RAISE EXCEPTION 'CRM_POST_BOOKING_SETUP_REQUIRED'; END IF;
    IF sale_row.payment_method='cash' AND latest_attempt.id IS NOT NULL THEN RAISE EXCEPTION 'CRM_POST_BOOKING_SETUP_REQUIRED'; END IF;
    IF next_stage='transfer_pending' AND sale_row.payment_method='mortgage' AND (latest_attempt.id IS NULL
      OR latest_attempt.project_interest_id<>interest_row.id OR latest_attempt.result_status<>'approved'
      OR latest_attempt.submitted_at IS NULL OR latest_attempt.result_at IS NULL OR latest_attempt.result_at<latest_attempt.submitted_at
      OR latest_attempt.approved_amount IS NULL OR latest_attempt.approved_amount<=0
      OR latest_attempt.approved_amount::text IN ('NaN','Infinity','-Infinity')
      OR EXISTS(SELECT 1 FROM public.loan_attempts WHERE sale_id=sale_row.id AND kind='purchase' AND result_status IN ('submitted','pending'))) THEN
      RAISE EXCEPTION 'CRM_POST_BOOKING_SETUP_REQUIRED'; END IF;
  ELSIF command_name='submit_loan' THEN
    IF sale_row.payment_method<>'mortgage' OR sale_row.crm_stage NOT IN ('document_prep','loan_rejected') THEN RAISE EXCEPTION 'CRM_POST_BOOKING_CONFLICT'; END IF;
    IF EXISTS(SELECT 1 FROM public.loan_attempts WHERE sale_id=sale_row.id AND kind='purchase' AND result_status IN ('submitted','pending')) THEN
      RAISE EXCEPTION 'CRM_POST_BOOKING_CONFLICT'; END IF;
    IF sale_row.crm_stage='loan_rejected' AND (latest_attempt.id IS NULL OR latest_attempt.result_status<>'rejected'
      OR latest_attempt.result_at IS NULL OR latest_attempt.submitted_at IS NULL OR latest_attempt.result_at<latest_attempt.submitted_at
      OR latest_attempt.approved_amount IS NOT NULL) THEN
      RAISE EXCEPTION 'CRM_POST_BOOKING_SETUP_REQUIRED'; END IF;
    SELECT COALESCE(max(attempt_number),0)+1 INTO next_attempt FROM public.loan_attempts WHERE sale_id=sale_row.id;
    INSERT INTO sales_private.post_booking_write_permits VALUES(txid_current(),pg_backend_pid());
    INSERT INTO public.loan_attempts(project_interest_id,sale_id,attempt_number,kind,bank_name,result_status,submitted_at,recorded_by_user_id,created_at)
      VALUES(interest_row.id,sale_row.id,next_attempt,'purchase',bank_value,'submitted',occurred_value,actor_id,server_now) RETURNING * INTO loan_row;
    loan_id_value:=loan_row.id;
  ELSE
    IF sale_row.payment_method<>'mortgage' OR sale_row.crm_stage<>'loan_submitted' OR latest_attempt.id IS DISTINCT FROM loan_id_value
      OR latest_attempt.project_interest_id<>interest_row.id OR latest_attempt.result_status NOT IN ('submitted','pending') THEN
      RAISE EXCEPTION 'CRM_POST_BOOKING_CONFLICT'; END IF;
    IF latest_attempt.submitted_at IS NULL OR latest_attempt.result_at IS NOT NULL OR latest_attempt.approved_amount IS NOT NULL
      OR EXISTS(SELECT 1 FROM public.loan_attempts WHERE sale_id=sale_row.id AND kind='purchase' AND id<>loan_id_value AND result_status IN ('submitted','pending')) THEN
      RAISE EXCEPTION 'CRM_POST_BOOKING_SETUP_REQUIRED'; END IF;
    old_loan:=to_jsonb(latest_attempt);
    INSERT INTO sales_private.post_booking_write_permits VALUES(txid_current(),pg_backend_pid());
    UPDATE public.loan_attempts SET result_status=p_payload->>'result',result_at=occurred_value,result_reason=reason_value,
      approved_amount=CASE WHEN p_payload->>'result'='approved' THEN amount_satang/100.0 ELSE NULL END WHERE id=loan_id_value RETURNING * INTO loan_row;
  END IF;
  IF command_name IN ('advance','confirm_transfer') THEN INSERT INTO sales_private.post_booking_write_permits VALUES(txid_current(),pg_backend_pid()); END IF;
  INSERT INTO sales_private.booking_write_permits VALUES(txid_current(),pg_backend_pid());
  UPDATE public.sales SET crm_stage=next_stage,booking_revision=gen_random_uuid(),
    contracted_at=CASE WHEN next_stage='contracted' THEN occurred_value ELSE contracted_at END,
    crm_transfer_date=CASE WHEN command_name='confirm_transfer' THEN transfer_value ELSE crm_transfer_date END,
    contract_status=CASE WHEN command_name='confirm_transfer' THEN 'Transferred' ELSE contract_status END
    WHERE id=sale_row.id RETURNING * INTO sale_row;
  DELETE FROM sales_private.booking_write_permits WHERE transaction_id=txid_current();
  INSERT INTO sales_private.post_booking_events(customer_id,project_interest_id,sale_id,command,from_stage,to_stage,actor_user_id,reason,evidence_note,occurred_at,recorded_at,loan_attempt_id,transfer_date)
    VALUES(customer_id_value,interest_row.id,sale_row.id,command_name,old_sale->>'crm_stage',next_stage,actor_id,reason_value,evidence_value,occurred_value,server_now,loan_id_value,transfer_value)
    RETURNING id INTO event_id_value;
  DELETE FROM sales_private.post_booking_write_permits WHERE transaction_id=txid_current();
  INSERT INTO public.crm_audit_events(customer_id,entity_type,entity_id,event_type,reason_text,actor_user_id,actor_kind,
    actor_name_snapshot,old_values,new_values,occurred_at,recorded_at)
    VALUES(customer_id_value,'sale',sale_row.id,'post_booking_'||command_name,reason_value,actor_id,'staff',actor_name,
      jsonb_build_object('sale',old_sale,'loanAttempt',old_loan),jsonb_build_object('sale',to_jsonb(sale_row),'loanAttempt',
        CASE WHEN loan_row.id IS NULL THEN NULL ELSE to_jsonb(loan_row) END,'eventId',event_id_value,'evidenceNote',evidence_value,'transferDate',transfer_value),occurred_value,server_now);
  response_value:=jsonb_build_object('requestId',p_request_id,'command',command_name,'customerId',customer_id_value,'interestId',interest_row.id,
    'saleId',sale_row.id,'saleRevision',sale_row.booking_revision,'stage',next_stage,'eventId',event_id_value,'loanAttemptId',loan_id_value,'transferDate',transfer_value,'replayed',false);
  INSERT INTO sales_private.post_booking_command_requests(actor_user_id,request_id,request_payload,response,created_at)
    VALUES(actor_id,p_request_id,p_payload,response_value,server_now);
  RETURN response_value;
END;
$command$;
REVOKE ALL ON FUNCTION public.crm_v2_post_booking_command(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_v2_post_booking_command(uuid,jsonb) TO authenticated;

-- Required before enablement: independently reviewed real schema/RLS/legacy
-- writers, imported loan evidence and staging workflow; separate user approval.
ROLLBACK;
