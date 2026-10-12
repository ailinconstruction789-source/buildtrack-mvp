-- Reviewed installation only: User approved958 whole replacement; LF line convention same as native psql proof
-- Native proof: D:\buildtrack\buildtrack-mvp-main\node_modules\.cache\buildtrack-sales-runtime\runs\run-4nE1AF; no business import or feature activation here.
BEGIN; SET LOCAL lock_timeout='2s'; SET LOCAL timezone='UTC';
-- SALES V2 BOOKING/LEAD-COHORT REPORT -- DESIGN ONLY, 2026-09-23.
-- NEVER RUN ON SUPABASE. Depends on guarded base + 04/05/18/19 drafts.
-- Read-only aggregate, not event-month KPI, staff attribution or score calculation.
-- No individual customer data, migration/backfill, flag changes or deployment.

-- Design sentinel cleared only in this reviewed installation artifact.

CREATE FUNCTION public.crm_v2_sales_reports_capabilities()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC'
AS $capabilities$
  SELECT jsonb_build_object('contract_version','sales_reports_v1','enabled',
    COALESCE((public.crm_v2_project_sales_capabilities()->>'enabled')::boolean,false));
$capabilities$;
REVOKE ALL ON FUNCTION public.crm_v2_sales_reports_capabilities() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_v2_sales_reports_capabilities() TO authenticated;

CREATE FUNCTION public.crm_v2_sales_report(p_project_name text DEFAULT NULL,
  p_from_date text DEFAULT NULL,p_to_date text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC'
AS $snapshot$
DECLARE
  actor_id uuid:=auth.uid(); actor_role text:=public.crm_v2_role();
  from_value date; to_value date; result jsonb;
BEGIN
  IF actor_id IS NULL OR COALESCE(actor_role,'') NOT IN ('sales','admin','owner') THEN
    RAISE EXCEPTION 'CRM_SALES_REPORTS_FORBIDDEN';
  END IF;
  IF (public.crm_v2_sales_reports_capabilities()->>'enabled')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'CRM_SALES_REPORTS_SETUP_REQUIRED';
  END IF;
  IF (p_from_date IS NULL)<>(p_to_date IS NULL)
    OR (p_project_name IS NOT NULL AND (length(p_project_name) NOT BETWEEN 1 AND 200
      OR p_project_name ~ U&'[\0001-\001F\007F-\009F\2028\2029]')) THEN
    RAISE EXCEPTION 'CRM_SALES_REPORTS_INVALID_INPUT';
  END IF;
  IF p_from_date IS NOT NULL THEN
    IF p_from_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR left(p_from_date,4)='0000'
      OR p_to_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR left(p_to_date,4)='0000' THEN
      RAISE EXCEPTION 'CRM_SALES_REPORTS_INVALID_INPUT';
    END IF;
    BEGIN from_value:=p_from_date::date; to_value:=p_to_date::date;
    EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN
      RAISE EXCEPTION 'CRM_SALES_REPORTS_INVALID_INPUT';
    END;
    IF from_value>to_value THEN RAISE EXCEPTION 'CRM_SALES_REPORTS_INVALID_INPUT'; END IF;
  END IF;
  IF (SELECT count(*) FROM public.projects)>1000 THEN RAISE EXCEPTION 'CRM_SALES_REPORTS_SETUP_REQUIRED'; END IF;
  IF p_project_name IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.projects WHERE name=p_project_name) THEN
    RAISE EXCEPTION 'CRM_SALES_REPORTS_NOT_FOUND';
  END IF;
  -- All mapping/evidence checks run BEFORE any cohort filter. Unknown unlinked
  -- legacy project assignment cannot be hidden by selecting another project.
  -- Unbooked legacy Leads matter to the denominator too. The dependency contract
  -- only guarantees leads.id/phone, so a missing reviewed identity link cannot be
  -- classified into one project: conservatively block ALL report scopes. Neither
  -- a matching phone nor sales_customers.legacy_source_lead_id replaces the
  -- reviewed crm_legacy_lead_links mapping (many legacy IDs may share one identity).
  IF EXISTS(SELECT 1 FROM public.leads legacy
    LEFT JOIN public.crm_legacy_lead_links link ON link.legacy_lead_id=legacy.id
    LEFT JOIN public.sales_customers c ON c.id=link.customer_id
    LEFT JOIN public.lead_project_interests i ON i.id=link.project_interest_id
    WHERE link.legacy_lead_id IS NULL OR c.id IS NULL OR c.merged_into_customer_id IS NOT NULL
      OR (link.project_interest_id IS NOT NULL AND (i.id IS NULL OR i.customer_id IS DISTINCT FROM link.customer_id))) THEN
    RAISE EXCEPTION 'CRM_SALES_REPORTS_SETUP_REQUIRED';
  END IF;
  -- A merge must relink interested-only work as well as bookings before reports
  -- can exclude its old identity. Do not silently lose an orphan interest merely
  -- because no sale exists yet or its original Lead date lies outside the cohort.
  IF EXISTS(SELECT 1 FROM public.lead_project_interests i
    LEFT JOIN public.sales_customers c ON c.id=i.customer_id
    WHERE (p_project_name IS NULL OR i.project_name=p_project_name)
      AND (c.id IS NULL OR c.merged_into_customer_id IS NOT NULL)) THEN
    RAISE EXCEPTION 'CRM_SALES_REPORTS_SETUP_REQUIRED';
  END IF;
  IF EXISTS(SELECT 1 FROM public.sales s LEFT JOIN public.plots p ON p.id=s.plot_id
    LEFT JOIN public.projects pr ON pr.name=p.project_name
    WHERE s.project_interest_id IS NULL AND (p_project_name IS NULL OR p.project_name=p_project_name OR p.id IS NULL OR pr.name IS NULL)) THEN
    RAISE EXCEPTION 'CRM_SALES_REPORTS_SETUP_REQUIRED';
  END IF;
  IF EXISTS(SELECT 1 FROM public.sales s
    LEFT JOIN public.lead_project_interests i ON i.id=s.project_interest_id
    LEFT JOIN public.sales_customers c ON c.id=i.customer_id
    LEFT JOIN sales_private.crm_user_roles owner_role ON owner_role.user_id=i.owner_user_id
    LEFT JOIN public.plots p ON p.id=s.plot_id
    LEFT JOIN public.sales previous ON previous.id=s.previous_sale_id
    WHERE s.project_interest_id IS NOT NULL
      AND (p_project_name IS NULL OR i.id IS NULL OR i.project_name=p_project_name OR p.project_name=p_project_name)
      AND (i.id IS NULL OR c.id IS NULL OR c.merged_into_customer_id IS NOT NULL
        OR owner_role.user_id IS NULL OR owner_role.role<>'sales'
        OR s.crm_stage IS NULL OR s.crm_stage NOT IN ('booked','contracted','downpayment','document_prep','loan_submitted',
          'loan_rejected','loan_approved','transfer_pending','transferred','handover','cancelled')
        OR ((s.booking_round IS NULL OR to_jsonb(s)->>'external_booking_id' IS NOT NULL OR to_jsonb(s)->>'external_source_stage' IS NOT NULL)
          AND sales_private.crm_booking_imported_history(to_jsonb(s)) IS NULL)
        OR (s.plot_id IS NOT NULL AND (p.id IS NULL OR p.project_name IS DISTINCT FROM i.project_name))
        OR (s.plot_id IS NULL AND s.crm_stage<>'cancelled')
        OR (s.previous_sale_id IS NOT NULL AND (previous.id IS NULL
          OR previous.project_interest_id IS DISTINCT FROM s.project_interest_id
          OR previous.crm_stage IS DISTINCT FROM 'cancelled' OR previous.booking_round>=s.booking_round))
        OR (s.booked_at IS NOT NULL AND (NOT isfinite(s.booked_at)
          OR s.booked_at<TIMESTAMPTZ '0001-01-01 00:00:00+00' OR s.booked_at>=TIMESTAMPTZ '10000-01-01 00:00:00+00'))
        OR (s.cancelled_at IS NOT NULL AND (NOT isfinite(s.cancelled_at)
          OR s.cancelled_at<TIMESTAMPTZ '0001-01-01 00:00:00+00' OR s.cancelled_at>=TIMESTAMPTZ '10000-01-01 00:00:00+00'))
        OR (s.sale_price IS NOT NULL AND (s.sale_price<0 OR s.sale_price::text IN ('NaN','Infinity','-Infinity'))))) THEN
    RAISE EXCEPTION 'CRM_SALES_REPORTS_SETUP_REQUIRED';
  END IF;
  IF EXISTS(SELECT 1 FROM public.sales_customers c WHERE c.merged_into_customer_id IS NULL
    AND (p_project_name IS NULL OR EXISTS(SELECT 1 FROM public.lead_project_interests i WHERE i.customer_id=c.id AND i.project_name=p_project_name))
    AND c.lead_created_at IS NOT NULL AND (NOT isfinite(c.lead_created_at)
      OR (c.lead_created_at AT TIME ZONE 'Asia/Bangkok')::date<DATE '0001-01-01'
      OR (c.lead_created_at AT TIME ZONE 'Asia/Bangkok')::date>DATE '9999-12-31')) THEN
    RAISE EXCEPTION 'CRM_SALES_REPORTS_SETUP_REQUIRED';
  END IF;
  -- Distinct customer identity first; joining interests directly into this count
  -- would overcount customers who are interested in several registered projects.
  WITH scope_customers AS (
    SELECT c.id,c.lead_created_at FROM public.sales_customers c WHERE c.merged_into_customer_id IS NULL
      AND (p_project_name IS NULL OR EXISTS(SELECT 1 FROM public.lead_project_interests i WHERE i.customer_id=c.id AND i.project_name=p_project_name))
  ), cohort_customers AS (
    SELECT * FROM scope_customers WHERE from_value IS NULL
      OR (lead_created_at AT TIME ZONE 'Asia/Bangkok')::date BETWEEN from_value AND to_value
  ), cohort_interests AS (
    SELECT i.id FROM public.lead_project_interests i JOIN cohort_customers c ON c.id=i.customer_id
      WHERE p_project_name IS NULL OR i.project_name=p_project_name
  ), cohort_sales AS (
    SELECT s.crm_stage,s.sale_price,s.booked_at,s.cancelled_at FROM public.sales s
      JOIN cohort_interests i ON i.id=s.project_interest_id
  )
  SELECT jsonb_build_object('actor',jsonb_build_object('userId',actor_id,'role',actor_role),
    'projectName',p_project_name,'fromDate',p_from_date,'toDate',p_to_date,
    'projects',COALESCE((SELECT jsonb_agg(jsonb_build_object('name',name) ORDER BY name) FROM public.projects),'[]'::jsonb),
    'totals',jsonb_build_object(
      'customers',(SELECT count(*) FROM cohort_customers),'interests',(SELECT count(*) FROM cohort_interests),
      'bookingRounds',(SELECT count(*) FROM cohort_sales),'cancelledRounds',(SELECT count(*) FROM cohort_sales WHERE crm_stage='cancelled'),
      'netBookedHomes',(SELECT count(*) FROM cohort_sales WHERE crm_stage<>'cancelled'),
      'inProgress',(SELECT count(*) FROM cohort_sales WHERE crm_stage NOT IN ('cancelled','transferred','handover')),
      'transferred',(SELECT count(*) FROM cohort_sales WHERE crm_stage IN ('transferred','handover')),
      'knownNetSaleValue',(SELECT round(COALESCE(sum(sale_price) FILTER(WHERE crm_stage<>'cancelled'),0),2)::text FROM cohort_sales),
      'unknownNetSaleValueCount',(SELECT count(*) FROM cohort_sales WHERE crm_stage<>'cancelled' AND sale_price IS NULL),
      'unknownBookedAtRounds',(SELECT count(*) FROM cohort_sales WHERE booked_at IS NULL),
      'unknownCancelledAtRounds',(SELECT count(*) FROM cohort_sales WHERE crm_stage='cancelled' AND cancelled_at IS NULL)),
    'stageCounts',(SELECT jsonb_object_agg(stage,(SELECT count(*) FROM cohort_sales s WHERE s.crm_stage=stage)) FROM
      unnest(ARRAY['booked','contracted','downpayment','document_prep','loan_submitted','loan_rejected','loan_approved',
        'transfer_pending','transferred','handover','cancelled']) stage),
    'coverage',jsonb_build_object('unknownLeadDateCustomers',(SELECT count(*) FROM scope_customers WHERE lead_created_at IS NULL),
      'excludedUnknownLeadDateCustomers',CASE WHEN from_value IS NULL THEN 0 ELSE (SELECT count(*) FROM scope_customers WHERE lead_created_at IS NULL) END))
    INTO result;
  RETURN result;
END;
$snapshot$;
REVOKE ALL ON FUNCTION public.crm_v2_sales_report(text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_v2_sales_report(text,text,text) TO authenticated;


-- SALES V2 POST-BOOKING COMMANDS -- DESIGN ONLY, 2026-09-23.
-- NEVER RUN ON SUPABASE. Depends on guarded base + 04/05/18.
-- Actual transfer uses an explicitly entered civil DATE, never a fabricated time.
-- Explicit day-only handover after actual transfer; no money/stock mutation,
-- verified-upload claim, backfill, KPI credit, fake Visit or legacy bank status.

-- Design sentinel cleared only in this reviewed installation artifact.

ALTER TABLE public.crm_settings ADD COLUMN post_booking_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.sales ADD COLUMN crm_transfer_date date NULL
  CHECK(crm_transfer_date IS NULL OR (isfinite(crm_transfer_date) AND crm_transfer_date>=DATE '0001-01-01' AND crm_transfer_date<DATE '10000-01-01'));
ALTER TABLE public.sales ADD COLUMN crm_handover_date date NULL
  CHECK(crm_handover_date IS NULL OR (isfinite(crm_handover_date) AND crm_handover_date>=DATE '0001-01-01' AND crm_handover_date<DATE '10000-01-01'));
CREATE TABLE sales_private.post_booking_write_permits (
  transaction_id bigint PRIMARY KEY,backend_pid integer NOT NULL
);
-- Exact row images bind the imported-sale adapter to the one locked deal.
CREATE TABLE sales_private.post_booking_external_write_permits (
  transaction_id bigint PRIMARY KEY, backend_pid integer NOT NULL, actor_user_id uuid NOT NULL,
  old_sale jsonb NOT NULL, new_sale jsonb NOT NULL
);
ALTER TABLE sales_private.post_booking_external_write_permits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sales_private.post_booking_external_write_permits FROM PUBLIC,anon,authenticated;
CREATE FUNCTION sales_private.crm_post_booking_external_sale_allowed(p_old jsonb,p_new jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $external_allowed$
DECLARE permit sales_private.post_booking_external_write_permits%ROWTYPE;
BEGIN
  SELECT * INTO permit FROM sales_private.post_booking_external_write_permits
    WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid();
  RETURN permit.transaction_id IS NOT NULL AND auth.uid() IS NOT NULL AND permit.actor_user_id=auth.uid()
    AND public.crm_v2_role() IN ('sales','admin') AND permit.old_sale=p_old
    AND permit.new_sale-'updated_at'=p_new-'updated_at';
END;
$external_allowed$;
REVOKE ALL ON FUNCTION sales_private.crm_post_booking_external_sale_allowed(jsonb,jsonb) FROM PUBLIC,anon,authenticated;
CREATE TABLE sales_private.post_booking_command_requests (
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL,request_payload jsonb NOT NULL,response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(actor_user_id,request_id)
);
CREATE TABLE sales_private.post_booking_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.sales_customers(id) ON DELETE RESTRICT,
  project_interest_id uuid NOT NULL,sale_id uuid NOT NULL,
  command text NOT NULL CHECK(command IN ('advance','submit_loan','loan_result','confirm_transfer','confirm_handover')),
  from_stage text NOT NULL,to_stage text NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 1000),
  evidence_note text NULL CHECK(length(btrim(evidence_note)) BETWEEN 1 AND 1000),
  occurred_at timestamptz NULL CHECK(isfinite(occurred_at)),
  transfer_date date NULL CHECK(isfinite(transfer_date) AND transfer_date>=DATE '0001-01-01' AND transfer_date<DATE '10000-01-01'),
  handover_date date NULL CHECK(isfinite(handover_date) AND handover_date>=DATE '0001-01-01' AND handover_date<DATE '10000-01-01'),
  recorded_at timestamptz NOT NULL CHECK(isfinite(recorded_at)),
  loan_attempt_id uuid REFERENCES public.loan_attempts(id) ON DELETE RESTRICT,
  FOREIGN KEY(project_interest_id,customer_id) REFERENCES public.lead_project_interests(id,customer_id) ON DELETE RESTRICT,
  FOREIGN KEY(sale_id,project_interest_id) REFERENCES public.sales(id,project_interest_id) ON DELETE RESTRICT,
  CHECK(occurred_at<=recorded_at),CHECK(from_stage<>to_stage),
  CHECK((command='confirm_transfer' AND transfer_date IS NOT NULL AND occurred_at IS NULL AND evidence_note IS NULL
      AND handover_date IS NULL AND loan_attempt_id IS NULL AND from_stage='transfer_pending' AND to_stage='transferred')
    OR (command='confirm_handover' AND handover_date IS NOT NULL AND transfer_date IS NULL AND occurred_at IS NULL AND evidence_note IS NULL
      AND loan_attempt_id IS NULL AND from_stage='transferred' AND to_stage='handover')
    OR (command NOT IN ('confirm_transfer','confirm_handover') AND transfer_date IS NULL AND handover_date IS NULL AND occurred_at IS NOT NULL AND evidence_note IS NOT NULL))
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
      OR NEW.crm_transfer_date IS DISTINCT FROM OLD.crm_transfer_date) THEN
    IF OLD.crm_stage<>'transferred' OR NEW.crm_stage<>'handover' OR NEW.contract_status IS DISTINCT FROM OLD.contract_status
      OR NEW.crm_transfer_date IS DISTINCT FROM OLD.crm_transfer_date OR OLD.crm_handover_date IS NOT NULL OR NEW.crm_handover_date IS NULL
      OR NOT EXISTS(SELECT 1 FROM sales_private.post_booking_write_permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid()) THEN
      RAISE EXCEPTION 'CRM_POST_BOOKING_CONFLICT'; END IF;
  END IF;
  IF (TG_OP='INSERT' AND NEW.crm_handover_date IS NOT NULL)
    OR (TG_OP='UPDATE' AND (NEW.crm_handover_date IS DISTINCT FROM OLD.crm_handover_date
      OR (NEW.project_interest_id IS NOT NULL AND NEW.crm_stage='handover' AND OLD.crm_stage IS DISTINCT FROM NEW.crm_stage))) THEN
    IF NOT EXISTS(SELECT 1 FROM sales_private.post_booking_write_permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid()) THEN
      RAISE EXCEPTION 'CRM_POST_BOOKING_FORBIDDEN'; END IF;
    IF TG_OP<>'UPDATE' OR OLD.crm_stage IS DISTINCT FROM 'transferred' OR NEW.crm_stage IS DISTINCT FROM 'handover'
      OR OLD.crm_handover_date IS NOT NULL OR NEW.crm_handover_date IS NULL OR NEW.crm_transfer_date IS DISTINCT FROM OLD.crm_transfer_date
      OR to_jsonb(OLD)-ARRAY['crm_stage','booking_revision','crm_handover_date','updated_at']
        IS DISTINCT FROM to_jsonb(NEW)-ARRAY['crm_stage','booking_revision','crm_handover_date','updated_at'] THEN
      RAISE EXCEPTION 'CRM_POST_BOOKING_CONFLICT'; END IF;
  END IF;
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
  SELECT jsonb_build_object('contract_version','post_booking_v3','enabled',
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
  imported_history jsonb; attempts_json jsonb; events_json jsonb; latest_json jsonb; attempts_more boolean; events_more boolean;
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
  imported_history:=sales_private.crm_booking_imported_history(to_jsonb(sale_row));
  IF sale_row.crm_stage IS NULL OR (sale_row.booking_round IS NULL AND imported_history IS NULL)
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
    'evidenceNote',evidence_note,'loanAttemptId',loan_attempt_id,'transferDate',transfer_date,'handoverDate',handover_date) ORDER BY recorded_at DESC,id DESC)
    FILTER(WHERE rn<=50),'[]'::jsonb),count(*)>50 INTO events_json,events_more FROM numbered;
  RETURN jsonb_build_object('actor',jsonb_build_object('userId',actor_id,'role',actor_role),
    'sale',jsonb_build_object('id',sale_row.id,'customerId',customer_row.id,'customerName',customer_row.customer_name,
      'interestId',interest_row.id,'projectName',interest_row.project_name,'plotId',sale_row.plot_id,'stage',sale_row.crm_stage,
      'paymentMethod',sale_row.payment_method,'bookedAt',sale_row.booked_at,'contractedAt',sale_row.contracted_at,'transferDate',sale_row.crm_transfer_date,'handoverDate',sale_row.crm_handover_date,'importedHistory',imported_history,
      'revision',sale_row.booking_revision,'interestRevision',interest_row.lifecycle_revision,'ownerUserId',interest_row.owner_user_id,
      'canEdit',(actor_role='admin' OR (actor_role='sales' AND actor_id=interest_row.owner_user_id))
        AND (sale_row.payment_method IS NOT NULL OR sale_row.crm_stage='transferred') AND sale_row.crm_stage NOT IN ('cancelled','handover')
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
  transfer_value date; handover_value date; imported_history jsonb; latest_loan_time timestamptz; plot_row public.plots%ROWTYPE;
  actor_active boolean:=false; owner_active boolean:=false; role_row sales_private.crm_user_roles%ROWTYPE;
  customer_row public.sales_customers%ROWTYPE; interest_row public.lead_project_interests%ROWTYPE; sale_row public.sales%ROWTYPE;
  latest_attempt public.loan_attempts%ROWTYPE; loan_row public.loan_attempts%ROWTYPE;
  request_row sales_private.post_booking_command_requests%ROWTYPE;
  amount_satang bigint; next_attempt integer; event_id_value uuid; response_value jsonb; old_sale jsonb; old_loan jsonb; next_revision uuid;
BEGIN
  IF actor_id IS NULL OR COALESCE(actor_role,'') NOT IN ('sales','admin') THEN RAISE EXCEPTION 'CRM_POST_BOOKING_FORBIDDEN'; END IF;
  SELECT central_intake_enabled AND lead_work_enabled AND lead_lifecycle_enabled AND booking_enabled AND booking_cutover_reviewed AND post_booking_enabled
    INTO enabled FROM public.crm_settings WHERE id FOR SHARE;
  IF enabled IS DISTINCT FROM true THEN RAISE EXCEPTION 'CRM_POST_BOOKING_SETUP_REQUIRED'; END IF;
  IF p_request_id IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR octet_length(p_payload::text)>16384
    OR jsonb_typeof(p_payload->'command') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'CRM_POST_BOOKING_INVALID_INPUT'; END IF;
  command_name:=p_payload->>'command';
  allowed_keys:=ARRAY['command','customerId','saleId','expectedSaleRevision','expectedInterestRevision','reason']||
    CASE WHEN command_name='confirm_transfer' THEN ARRAY['transferDate'] WHEN command_name='confirm_handover' THEN ARRAY['handoverDate'] ELSE ARRAY['evidenceNote','occurredAt']||
    CASE command_name WHEN 'advance' THEN ARRAY['nextStage'] WHEN 'submit_loan' THEN ARRAY['bankName']
      WHEN 'loan_result' THEN ARRAY['loanAttemptId','result','approvedAmountSatang'] ELSE NULL END END;
  IF command_name NOT IN ('advance','submit_loan','loan_result','confirm_transfer','confirm_handover') OR NOT(p_payload ?& allowed_keys)
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE NOT(k=ANY(allowed_keys)))
    OR jsonb_typeof(p_payload->'reason') IS DISTINCT FROM 'string'
    OR (command_name='confirm_transfer' AND jsonb_typeof(p_payload->'transferDate') IS DISTINCT FROM 'string')
    OR (command_name='confirm_handover' AND jsonb_typeof(p_payload->'handoverDate') IS DISTINCT FROM 'string')
    OR (command_name NOT IN ('confirm_transfer','confirm_handover') AND (jsonb_typeof(p_payload->'evidenceNote') IS DISTINCT FROM 'string'
      OR jsonb_typeof(p_payload->'occurredAt') IS DISTINCT FROM 'string')) THEN RAISE EXCEPTION 'CRM_POST_BOOKING_INVALID_INPUT'; END IF;
  BEGIN
    customer_id_value:=sales_private.crm_booking_uuid(p_payload->'customerId'); sale_id_value:=sales_private.crm_booking_uuid(p_payload->'saleId');
    expected_sale:=sales_private.crm_booking_uuid(p_payload->'expectedSaleRevision'); expected_interest:=sales_private.crm_booking_uuid(p_payload->'expectedInterestRevision');
    reason_value:=sales_private.crm_work_text(p_payload->>'reason',1000);
    IF command_name NOT IN ('confirm_transfer','confirm_handover') THEN
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
  ELSIF command_name='confirm_handover' THEN
    IF (p_payload->>'handoverDate') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RAISE EXCEPTION 'CRM_POST_BOOKING_INVALID_INPUT'; END IF;
    BEGIN handover_value:=(p_payload->>'handoverDate')::date;
    EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RAISE EXCEPTION 'CRM_POST_BOOKING_INVALID_INPUT'; END;
    IF NOT isfinite(handover_value) OR handover_value<DATE '0001-01-01' OR handover_value>=DATE '10000-01-01' THEN
      RAISE EXCEPTION 'CRM_POST_BOOKING_INVALID_INPUT'; END IF;
    next_stage:='handover';
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
  IF sale_row.crm_stage IN ('cancelled','handover') OR (sale_row.crm_stage='transferred' AND command_name<>'confirm_handover') OR (sale_row.crm_stage='transfer_pending' AND command_name<>'confirm_transfer') THEN
    RAISE EXCEPTION 'CRM_POST_BOOKING_CONFLICT'; END IF;
  imported_history:=sales_private.crm_booking_imported_history(to_jsonb(sale_row));
  IF (sale_row.payment_method IS NULL AND command_name<>'confirm_handover') OR sale_row.crm_stage IS NULL OR (sale_row.booking_round IS NULL AND imported_history IS NULL)
    OR NOT EXISTS(SELECT 1 FROM public.plots WHERE id=sale_row.plot_id AND project_name=interest_row.project_name)
    OR EXISTS(SELECT 1 FROM public.sales WHERE lead_id=customer_row.legacy_source_lead_id AND project_interest_id IS NULL) THEN
    RAISE EXCEPTION 'CRM_POST_BOOKING_SETUP_REQUIRED'; END IF;
  server_now:=clock_timestamp();
  IF occurred_value>server_now THEN RAISE EXCEPTION 'CRM_POST_BOOKING_INVALID_INPUT'; END IF;
  SELECT * INTO latest_attempt FROM public.loan_attempts WHERE sale_id=sale_row.id AND kind='purchase'
    ORDER BY attempt_number DESC,id LIMIT 1 FOR UPDATE;
  SELECT max(occurred_at) INTO latest_event_time FROM sales_private.post_booking_events WHERE sale_id=sale_row.id;
  IF (sale_row.booked_at IS NOT NULL AND NOT isfinite(sale_row.booked_at)) OR (sale_row.contracted_at IS NOT NULL AND NOT isfinite(sale_row.contracted_at))
    OR (sale_row.transferred_at IS NOT NULL AND NOT isfinite(sale_row.transferred_at))
    OR (latest_attempt.submitted_at IS NOT NULL AND NOT isfinite(latest_attempt.submitted_at))
    OR (latest_attempt.result_at IS NOT NULL AND NOT isfinite(latest_attempt.result_at)) THEN RAISE EXCEPTION 'CRM_POST_BOOKING_SETUP_REQUIRED'; END IF;
  IF occurred_value<sale_row.booked_at OR occurred_value<sale_row.contracted_at OR occurred_value<latest_event_time
    OR occurred_value<latest_attempt.submitted_at OR occurred_value<latest_attempt.result_at THEN RAISE EXCEPTION 'CRM_POST_BOOKING_INVALID_INPUT'; END IF;
  IF occurred_value IS NOT NULL AND (occurred_value AT TIME ZONE 'Asia/Bangkok')::date<(imported_history->>'bookedDate')::date THEN
    RAISE EXCEPTION 'CRM_POST_BOOKING_INVALID_INPUT'; END IF;
  old_sale:=to_jsonb(sale_row); old_loan:=NULL;
  IF command_name='confirm_handover' THEN
    IF sale_row.crm_stage<>'transferred' OR sale_row.crm_handover_date IS NOT NULL THEN RAISE EXCEPTION 'CRM_POST_BOOKING_CONFLICT'; END IF;
    SELECT * INTO plot_row FROM public.plots WHERE id=sale_row.plot_id FOR UPDATE;
    IF NOT FOUND OR plot_row.project_name IS DISTINCT FROM interest_row.project_name OR plot_row.has_customer IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'CRM_POST_BOOKING_SETUP_REQUIRED'; END IF;
    SELECT max(GREATEST(submitted_at,result_at)) INTO latest_loan_time FROM public.loan_attempts WHERE sale_id=sale_row.id AND kind='purchase';
    IF handover_value>(server_now AT TIME ZONE 'Asia/Bangkok')::date OR handover_value<sale_row.crm_transfer_date
      OR handover_value<(imported_history->>'bookedDate')::date OR handover_value<(imported_history->>'transferredDate')::date
      OR handover_value<(sale_row.transferred_at AT TIME ZONE 'Asia/Bangkok')::date
      OR handover_value<(sale_row.booked_at AT TIME ZONE 'Asia/Bangkok')::date OR handover_value<(sale_row.contracted_at AT TIME ZONE 'Asia/Bangkok')::date
      OR handover_value<(latest_event_time AT TIME ZONE 'Asia/Bangkok')::date OR handover_value<(latest_loan_time AT TIME ZONE 'Asia/Bangkok')::date THEN
      RAISE EXCEPTION 'CRM_POST_BOOKING_INVALID_INPUT'; END IF;
  ELSIF command_name='confirm_transfer' THEN
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
    IF transfer_value<(imported_history->>'bookedDate')::date OR transfer_value>(server_now AT TIME ZONE 'Asia/Bangkok')::date
      OR transfer_value<(sale_row.booked_at AT TIME ZONE 'Asia/Bangkok')::date
      OR transfer_value<(sale_row.contracted_at AT TIME ZONE 'Asia/Bangkok')::date
      OR transfer_value<(latest_event_time AT TIME ZONE 'Asia/Bangkok')::date
      OR transfer_value<(latest_loan_time AT TIME ZONE 'Asia/Bangkok')::date THEN RAISE EXCEPTION 'CRM_POST_BOOKING_INVALID_INPUT'; END IF;
  ELSIF command_name='advance' THEN
    IF NOT ((sale_row.crm_stage='booked' AND next_stage='contracted')
      OR (sale_row.crm_stage='contracted' AND next_stage IN ('downpayment','document_prep'))
      OR (sale_row.crm_stage='downpayment' AND next_stage='document_prep')
      OR (sale_row.payment_method='mortgage' AND sale_row.crm_stage='loan_rejected' AND next_stage='document_prep')
      OR (next_stage='transfer_pending' AND ((sale_row.payment_method='cash' AND sale_row.crm_stage IN ('contracted','downpayment','document_prep'))
        OR (sale_row.payment_method='mortgage' AND sale_row.crm_stage='loan_approved')))) THEN RAISE EXCEPTION 'CRM_POST_BOOKING_CONFLICT'; END IF;
    IF next_stage='contracted' AND sale_row.contracted_at IS NOT NULL THEN RAISE EXCEPTION 'CRM_POST_BOOKING_SETUP_REQUIRED'; END IF;
    IF sale_row.crm_stage='loan_rejected' AND (latest_attempt.id IS NULL OR latest_attempt.result_status<>'rejected'
      OR latest_attempt.result_at IS NULL OR latest_attempt.submitted_at IS NULL OR latest_attempt.result_at<latest_attempt.submitted_at
      OR latest_attempt.approved_amount IS NOT NULL) THEN RAISE EXCEPTION 'CRM_POST_BOOKING_SETUP_REQUIRED'; END IF;
    IF sale_row.payment_method='cash' AND latest_attempt.id IS NOT NULL THEN RAISE EXCEPTION 'CRM_POST_BOOKING_SETUP_REQUIRED'; END IF;
    IF next_stage='transfer_pending' AND sale_row.payment_method='mortgage' AND (latest_attempt.id IS NULL
      OR latest_attempt.project_interest_id<>interest_row.id OR latest_attempt.result_status<>'approved'
      OR latest_attempt.submitted_at IS NULL OR latest_attempt.result_at IS NULL OR latest_attempt.result_at<latest_attempt.submitted_at
      OR latest_attempt.approved_amount IS NULL OR latest_attempt.approved_amount<=0
      OR latest_attempt.approved_amount::text IN ('NaN','Infinity','-Infinity')
      OR EXISTS(SELECT 1 FROM public.loan_attempts WHERE sale_id=sale_row.id AND kind='purchase' AND result_status IN ('submitted','pending'))) THEN
      RAISE EXCEPTION 'CRM_POST_BOOKING_SETUP_REQUIRED'; END IF;
  ELSIF command_name='submit_loan' THEN
    IF sale_row.payment_method<>'mortgage' OR sale_row.crm_stage<>'document_prep' THEN RAISE EXCEPTION 'CRM_POST_BOOKING_CONFLICT'; END IF;
    IF EXISTS(SELECT 1 FROM public.loan_attempts WHERE sale_id=sale_row.id AND kind='purchase' AND result_status IN ('submitted','pending')) THEN
      RAISE EXCEPTION 'CRM_POST_BOOKING_CONFLICT'; END IF;
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
  IF command_name IN ('advance','confirm_transfer','confirm_handover') THEN INSERT INTO sales_private.post_booking_write_permits VALUES(txid_current(),pg_backend_pid()); END IF;
  INSERT INTO sales_private.booking_write_permits VALUES(txid_current(),pg_backend_pid());
  next_revision:=gen_random_uuid();
  INSERT INTO sales_private.post_booking_external_write_permits VALUES(txid_current(),pg_backend_pid(),actor_id,old_sale,
    old_sale||jsonb_build_object('crm_stage',next_stage,'booking_revision',next_revision,
      'contracted_at',CASE WHEN next_stage='contracted' THEN occurred_value ELSE sale_row.contracted_at END,
      'crm_transfer_date',CASE WHEN command_name='confirm_transfer' THEN transfer_value ELSE sale_row.crm_transfer_date END,
      'crm_handover_date',CASE WHEN command_name='confirm_handover' THEN handover_value ELSE sale_row.crm_handover_date END,
      'contract_status',CASE WHEN command_name='confirm_transfer' THEN 'Transferred' ELSE sale_row.contract_status END));
  UPDATE public.sales SET crm_stage=next_stage,booking_revision=next_revision,
    contracted_at=CASE WHEN next_stage='contracted' THEN occurred_value ELSE contracted_at END,
    crm_transfer_date=CASE WHEN command_name='confirm_transfer' THEN transfer_value ELSE crm_transfer_date END,
    crm_handover_date=CASE WHEN command_name='confirm_handover' THEN handover_value ELSE crm_handover_date END,
    contract_status=CASE WHEN command_name='confirm_transfer' THEN 'Transferred' ELSE contract_status END
    WHERE id=sale_row.id RETURNING * INTO sale_row;
  DELETE FROM sales_private.booking_write_permits WHERE transaction_id=txid_current();
  DELETE FROM sales_private.post_booking_external_write_permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid();
  INSERT INTO sales_private.post_booking_events(customer_id,project_interest_id,sale_id,command,from_stage,to_stage,actor_user_id,reason,evidence_note,occurred_at,recorded_at,loan_attempt_id,transfer_date,handover_date)
    VALUES(customer_id_value,interest_row.id,sale_row.id,command_name,old_sale->>'crm_stage',next_stage,actor_id,reason_value,evidence_value,occurred_value,server_now,loan_id_value,transfer_value,handover_value)
    RETURNING id INTO event_id_value;
  DELETE FROM sales_private.post_booking_write_permits WHERE transaction_id=txid_current();
  INSERT INTO public.crm_audit_events(customer_id,entity_type,entity_id,event_type,reason_text,actor_user_id,actor_kind,
    actor_name_snapshot,old_values,new_values,occurred_at,recorded_at)
    VALUES(customer_id_value,'sale',sale_row.id,'post_booking_'||command_name,reason_value,actor_id,'staff',actor_name,
      jsonb_build_object('sale',old_sale,'loanAttempt',old_loan),jsonb_build_object('sale',to_jsonb(sale_row),'loanAttempt',
        CASE WHEN loan_row.id IS NULL THEN NULL ELSE to_jsonb(loan_row) END,'eventId',event_id_value,'evidenceNote',evidence_value,'transferDate',transfer_value,'handoverDate',handover_value),occurred_value,server_now);
  response_value:=jsonb_build_object('requestId',p_request_id,'command',command_name,'customerId',customer_id_value,'interestId',interest_row.id,
    'saleId',sale_row.id,'saleRevision',sale_row.booking_revision,'stage',next_stage,'eventId',event_id_value,'loanAttemptId',loan_id_value,'transferDate',transfer_value,'handoverDate',handover_value,'replayed',false);
  INSERT INTO sales_private.post_booking_command_requests(actor_user_id,request_id,request_payload,response,created_at)
    VALUES(actor_id,p_request_id,p_payload,response_value,server_now);
  RETURN response_value;
END;
$command$;
REVOKE ALL ON FUNCTION public.crm_v2_post_booking_command(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_v2_post_booking_command(uuid,jsonb) TO authenticated;

-- Optional exact-row adapter for an already sealed imported-sales installation.
-- Preserve the original cutover/rollback checks and its existing EXECUTE grants.
-- Refuse unknown definitions/owners; never rewrite the historical cutover draft.
DO $external_adapter$
DECLARE definition text; original_source text; function_settings text[]; owner_name name; secured boolean;
  expected_source text:=$expected_cutover$
DECLARE permit crm_external_private.sales_cutover_permits%ROWTYPE;
  source crm_external_private.prepared_booking_sales%ROWTYPE; baseline jsonb; allowed boolean:=false;
BEGIN
  SELECT * INTO permit FROM crm_external_private.sales_cutover_permits
    WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid();
  IF TG_OP='TRUNCATE' THEN RAISE EXCEPTION 'EXTERNAL_CUTOVER_TRUNCATE_FORBIDDEN'; END IF;
  IF permit.transaction_id IS NULL THEN
    IF to_regprocedure('crm_external_private.booking_sale_allowed(text,jsonb,jsonb)') IS NOT NULL THEN
      EXECUTE 'SELECT crm_external_private.booking_sale_allowed($1,$2,$3)' INTO allowed
        USING TG_OP,CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END,
          CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END;
      IF allowed IS TRUE THEN RETURN NEW; END IF;
    END IF;
    IF EXISTS(SELECT 1 FROM crm_external_private.sales_cutover_receipts c
      WHERE NOT EXISTS(SELECT 1 FROM crm_external_private.sales_rollback_receipts r WHERE r.batch_id=c.batch_id)) THEN
      RAISE EXCEPTION 'EXTERNAL_CUTOVER_SALES_SEALED';
    END IF;
    IF TG_OP<>'DELETE' AND (NEW.external_booking_id IS NOT NULL OR NEW.external_source_stage IS NOT NULL OR
      (TG_NARGS>0 AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(TG_ARGV[0]::jsonb) k
        WHERE to_jsonb(NEW)->k IS DISTINCT FROM 'null'::jsonb))) THEN
      RAISE EXCEPTION 'CRM_FOUNDATION_COLUMNS_SEALED';
    END IF;
    RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'EXTERNAL_CUTOVER_UPDATE_FORBIDDEN'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF permit.operation='rollback' THEN
    SELECT row_value INTO baseline FROM crm_external_private.sales_cutover_receipts r,
      LATERAL jsonb_array_elements(r.before_sales) row_value
      WHERE r.batch_id=permit.batch_id AND row_value->>'id'=NEW.id::text;
    IF baseline IS NULL OR baseline IS DISTINCT FROM to_jsonb(NEW) THEN
      RAISE EXCEPTION 'EXTERNAL_CUTOVER_RESTORE_EVIDENCE_REQUIRED';
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO source FROM crm_external_private.prepared_booking_sales
    WHERE id=NEW.external_booking_id AND batch_id=permit.batch_id;
  IF source.id IS NULL OR (source.payload->>'eligible_for_release_review')::boolean IS DISTINCT FROM true
    OR NEW.id IS DISTINCT FROM source.id OR NEW.external_source_stage IS DISTINCT FROM source.stage OR NEW.lead_id IS NOT NULL
    OR NEW.project_interest_id IS DISTINCT FROM (source.payload->>'interest_id')::uuid
    OR NEW.plot_id IS DISTINCT FROM source.plot_id OR NEW.crm_stage IS DISTINCT FROM source.stage
    OR NEW.sale_price IS DISTINCT FROM (source.payload->>'sale_price')::numeric
    OR NEW.booking_amount IS DISTINCT FROM (source.payload->>'deposit_amount')::numeric
    OR NEW.closing_sales_user_id IS DISTINCT FROM (source.payload->>'closing_sales_user_id')::uuid
    OR NEW.payment_method IS DISTINCT FROM (source.payload->>'payment_method')
    OR NEW.cancellation_reason IS DISTINCT FROM (source.payload->>'cancellation_reason')
    OR NEW.contract_status IS DISTINCT FROM (CASE source.stage WHEN 'booked' THEN 'Reserved' WHEN 'transferred' THEN 'Transferred' ELSE 'Cancelled' END)
    OR NEW.booking_route IS DISTINCT FROM 'legacy_import'
    OR NEW.booking_route_reason IS DISTINCT FROM 'External snapshot: '||source.booking_key
    OR NEW.booking_round IS NOT NULL OR NEW.previous_sale_id IS NOT NULL
    OR NEW.booked_at IS NOT NULL OR NEW.cancelled_at IS NOT NULL
    OR NEW.contracted_at IS NOT NULL OR NEW.crm_handover_at IS NOT NULL
    OR NEW.list_price IS NOT NULL OR NEW.discount_amount IS NOT NULL
    OR NEW.bank_status IS NOT NULL OR NEW.bank_name IS NOT NULL OR NEW.land_office_price IS NOT NULL
    OR NEW.transferred_at IS NOT NULL OR NEW.expected_transfer_date IS NOT NULL
    OR NEW.legacy_cancellation_batch_id IS NOT NULL OR NEW.cancellation_category IS NOT NULL THEN
    RAISE EXCEPTION 'EXTERNAL_CUTOVER_SALE_EVIDENCE_REQUIRED';
  END IF;
  RETURN NEW;
END;
$expected_cutover$;
  marker text:='  IF permit.transaction_id IS NULL THEN';
  hook text:=$hook$
    IF TG_OP='UPDATE' AND to_regprocedure('sales_private.crm_post_booking_external_sale_allowed(jsonb,jsonb)') IS NOT NULL THEN
      EXECUTE 'SELECT sales_private.crm_post_booking_external_sale_allowed($1,$2)' INTO allowed USING to_jsonb(OLD),to_jsonb(NEW);
      IF allowed IS TRUE THEN RETURN NEW; END IF;
    END IF;$hook$;
BEGIN
  IF to_regprocedure('crm_external_private.guard_cutover_sale()') IS NULL THEN RETURN; END IF;
  SELECT pg_get_functiondef(p.oid),p.prosrc,p.proconfig,pg_get_userbyid(p.proowner),p.prosecdef INTO definition,original_source,function_settings,owner_name,secured
    FROM pg_proc p WHERE p.oid='crm_external_private.guard_cutover_sale()'::regprocedure;
  definition:=replace(definition,E'\r\n',E'\n');
  IF owner_name IS DISTINCT FROM current_user OR NOT secured
    OR replace(original_source,E'\r\n',E'\n') IS DISTINCT FROM expected_source
    OR function_settings IS DISTINCT FROM ARRAY['search_path=""']
    OR (length(definition)-length(replace(definition,marker,'')))/length(marker)<>1
    OR position('crm_external_private.booking_sale_allowed' IN definition)=0
    OR position('EXTERNAL_CUTOVER_SALES_SEALED' IN definition)=0
    OR position('EXTERNAL_CUTOVER_RESTORE_EVIDENCE_REQUIRED' IN definition)=0
    OR position('crm_post_booking_external_sale_allowed' IN definition)>0 THEN
    RAISE EXCEPTION 'CRM_POST_BOOKING_EXTERNAL_ADAPTER_REVIEW_REQUIRED'; END IF;
  EXECUTE replace(definition,marker,marker||hook);
END;
$external_adapter$;

-- Required before enablement: independently reviewed real schema/RLS/legacy
-- writers, imported loan evidence and staging workflow; separate user approval.

-- CUSTOMER/DEAL OPERATIONAL CORRECTIONS -- DESIGN ONLY. Never execute on Supabase.
-- Source snapshots, identity, booked money, dates, ownership and business stages stay sealed.
-- Depends on reviewed base +04/05/18/19/20/21. No activation or external installer.

-- Design sentinel cleared only in this reviewed installation artifact.

CREATE TABLE sales_private.customer_profile_corrections (
  customer_id uuid PRIMARY KEY REFERENCES public.sales_customers(id) ON DELETE RESTRICT,
  name text NOT NULL, phone text, occupation text,
  revision uuid NOT NULL, actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  reason text NOT NULL, recorded_at timestamptz NOT NULL
);
CREATE INDEX crm_profile_current_phone_idx ON sales_private.customer_profile_corrections(public.crm_v2_normalize_phone(phone));
CREATE TABLE sales_private.deal_details_corrections (
  sale_id uuid PRIMARY KEY REFERENCES public.sales(id) ON DELETE RESTRICT,
  sale_price numeric(15,2), bank_name text,
  revision uuid NOT NULL, actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  reason text NOT NULL, recorded_at timestamptz NOT NULL,
  CHECK(sale_price IS NULL OR (sale_price>0 AND sale_price<=999999999.99 AND sale_price::text NOT IN ('NaN','Infinity','-Infinity')))
);
CREATE TABLE sales_private.customer_deal_details_requests (
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT, request_id uuid NOT NULL,
  request_payload jsonb NOT NULL, response jsonb NOT NULL, recorded_at timestamptz NOT NULL,
  PRIMARY KEY(actor_user_id,request_id)
);
CREATE TABLE sales_private.customer_deal_details_permits (
  transaction_id bigint NOT NULL, backend_pid integer NOT NULL, actor_user_id uuid NOT NULL,
  entity_type text NOT NULL CHECK(entity_type IN ('customer','deal')), entity_id uuid NOT NULL,
  old_row jsonb, new_row jsonb NOT NULL,
  PRIMARY KEY(transaction_id,backend_pid,entity_type,entity_id)
);
ALTER TABLE sales_private.customer_profile_corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_private.deal_details_corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_private.customer_deal_details_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_private.customer_deal_details_permits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sales_private.customer_profile_corrections,sales_private.deal_details_corrections,
  sales_private.customer_deal_details_requests,sales_private.customer_deal_details_permits FROM PUBLIC,anon,authenticated;

CREATE FUNCTION sales_private.crm_customer_deal_details_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $guard$
DECLARE entity text:=CASE WHEN TG_TABLE_NAME='customer_profile_corrections' THEN 'customer' ELSE 'deal' END;
  identity_id uuid; old_json jsonb; new_json jsonb;
BEGIN
  IF TG_OP NOT IN ('INSERT','UPDATE') THEN RAISE EXCEPTION 'CRM_CUSTOMER_DEAL_DETAILS_FORBIDDEN'; END IF;
  identity_id:=CASE WHEN entity='customer' THEN (to_jsonb(NEW)->>'customer_id')::uuid ELSE (to_jsonb(NEW)->>'sale_id')::uuid END;
  old_json:=CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE NULL END; new_json:=to_jsonb(NEW);
  IF NOT EXISTS(SELECT 1 FROM sales_private.customer_deal_details_permits p WHERE p.transaction_id=txid_current()
    AND p.backend_pid=pg_backend_pid() AND p.actor_user_id=auth.uid() AND p.entity_type=entity AND p.entity_id=identity_id
    AND p.old_row IS NOT DISTINCT FROM old_json AND p.new_row=new_json)
    OR public.crm_v2_role() NOT IN ('sales','admin') THEN RAISE EXCEPTION 'CRM_CUSTOMER_DEAL_DETAILS_FORBIDDEN'; END IF;
  RETURN NEW;
END;
$guard$;
REVOKE ALL ON FUNCTION sales_private.crm_customer_deal_details_guard() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER crm_profile_correction_guard BEFORE INSERT OR UPDATE OR DELETE ON sales_private.customer_profile_corrections
  FOR EACH ROW EXECUTE FUNCTION sales_private.crm_customer_deal_details_guard();
CREATE TRIGGER crm_deal_correction_guard BEFORE INSERT OR UPDATE OR DELETE ON sales_private.deal_details_corrections
  FOR EACH ROW EXECUTE FUNCTION sales_private.crm_customer_deal_details_guard();
CREATE FUNCTION sales_private.crm_customer_deal_details_no_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $immutable$
BEGIN RAISE EXCEPTION 'CRM_CUSTOMER_DEAL_DETAILS_FORBIDDEN'; END;
$immutable$;
REVOKE ALL ON FUNCTION sales_private.crm_customer_deal_details_no_change() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER crm_details_receipt_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON sales_private.customer_deal_details_requests
  FOR EACH STATEMENT EXECUTE FUNCTION sales_private.crm_customer_deal_details_no_change();
CREATE TRIGGER crm_profile_no_truncate BEFORE TRUNCATE ON sales_private.customer_profile_corrections
  FOR EACH STATEMENT EXECUTE FUNCTION sales_private.crm_customer_deal_details_no_change();
CREATE TRIGGER crm_deal_no_truncate BEFORE TRUNCATE ON sales_private.deal_details_corrections
  FOR EACH STATEMENT EXECUTE FUNCTION sales_private.crm_customer_deal_details_no_change();

-- INVOKER, private and not callable by browsers. Whole-record existence distinguishes explicit NULL from no correction.
-- Match the client line parser for permitted edge whitespace; source rows/audits stay raw.
CREATE FUNCTION sales_private.crm_customer_deal_details_trim(p_value text)
RETURNS text LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog AS $trim$
 SELECT btrim(p_value,U&' \00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF');
$trim$;
REVOKE ALL ON FUNCTION sales_private.crm_customer_deal_details_trim(text) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION sales_private.crm_effective_customer_name(p_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $name$
 SELECT CASE WHEN o.customer_id IS NULL THEN sales_private.crm_customer_deal_details_trim(c.customer_name) ELSE o.name END
 FROM public.sales_customers c LEFT JOIN sales_private.customer_profile_corrections o ON o.customer_id=c.id WHERE c.id=p_id;
$name$;
CREATE FUNCTION sales_private.crm_effective_customer_phone(p_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $phone$
 SELECT CASE WHEN o.customer_id IS NULL THEN NULLIF(sales_private.crm_customer_deal_details_trim(c.phone),'') ELSE o.phone END
 FROM public.sales_customers c LEFT JOIN sales_private.customer_profile_corrections o ON o.customer_id=c.id WHERE c.id=p_id;
$phone$;
CREATE FUNCTION sales_private.crm_effective_sale_price(p_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $price$
 SELECT CASE WHEN o.sale_id IS NULL THEN s.sale_price ELSE o.sale_price END
 FROM public.sales s LEFT JOIN sales_private.deal_details_corrections o ON o.sale_id=s.id WHERE s.id=p_id;
$price$;
REVOKE ALL ON FUNCTION sales_private.crm_effective_customer_name(uuid),sales_private.crm_effective_customer_phone(uuid),
  sales_private.crm_effective_sale_price(uuid) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.crm_v2_customer_deal_details_capabilities()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $capabilities$
 SELECT jsonb_build_object('contract_version','customer_deal_details_v1','enabled',
  public.crm_v2_post_booking_capabilities()->>'contract_version'='post_booking_v3'
  AND COALESCE((public.crm_v2_post_booking_capabilities()->>'enabled')::boolean,false));
$capabilities$;
REVOKE ALL ON FUNCTION public.crm_v2_customer_deal_details_capabilities() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_v2_customer_deal_details_capabilities() TO authenticated;

CREATE FUNCTION public.crm_v2_customer_deal_details_context(p_sale_id uuid,p_project_name text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $context$
DECLARE actor_id uuid:=auth.uid(); actor_role text:=public.crm_v2_role();
  c public.sales_customers%ROWTYPE; i public.lead_project_interests%ROWTYPE; s public.sales%ROWTYPE;
  pc sales_private.customer_profile_corrections%ROWTYPE; dc sales_private.deal_details_corrections%ROWTYPE;
BEGIN
 IF actor_id IS NULL OR COALESCE(actor_role,'') NOT IN ('sales','admin','owner') THEN RAISE EXCEPTION 'CRM_CUSTOMER_DEAL_DETAILS_FORBIDDEN'; END IF;
 IF (public.crm_v2_customer_deal_details_capabilities()->>'enabled')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'CRM_CUSTOMER_DEAL_DETAILS_SETUP_REQUIRED'; END IF;
 IF p_sale_id IS NULL OR p_project_name IS NULL OR length(p_project_name) NOT BETWEEN 1 AND 200
   OR p_project_name<>btrim(p_project_name) OR p_project_name ~ U&'[\0001-\001F\007F-\009F\2028\2029]' THEN RAISE EXCEPTION 'CRM_CUSTOMER_DEAL_DETAILS_INVALID_INPUT'; END IF;
 SELECT * INTO s FROM public.sales WHERE id=p_sale_id;
 SELECT * INTO i FROM public.lead_project_interests WHERE id=s.project_interest_id AND project_name=p_project_name;
 SELECT * INTO c FROM public.sales_customers WHERE id=i.customer_id;
 IF s.id IS NULL OR i.id IS NULL OR c.id IS NULL THEN RAISE EXCEPTION 'CRM_CUSTOMER_DEAL_DETAILS_NOT_FOUND'; END IF;
 IF c.merged_into_customer_id IS NOT NULL OR s.crm_stage IS NULL OR
  (s.plot_id IS NULL AND s.crm_stage<>'cancelled') OR
  (s.plot_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.plots WHERE id=s.plot_id AND project_name=i.project_name)) OR
  (s.booking_round IS NULL AND sales_private.crm_booking_imported_history(to_jsonb(s)) IS NULL)
  OR EXISTS(SELECT 1 FROM public.sales WHERE lead_id=c.legacy_source_lead_id AND project_interest_id IS NULL) THEN RAISE EXCEPTION 'CRM_CUSTOMER_DEAL_DETAILS_SETUP_REQUIRED'; END IF;
 SELECT * INTO pc FROM sales_private.customer_profile_corrections WHERE customer_id=c.id;
 SELECT * INTO dc FROM sales_private.deal_details_corrections WHERE sale_id=s.id;
 RETURN jsonb_build_object('actor',jsonb_build_object('userId',actor_id,'role',actor_role),
  'customer',jsonb_build_object('id',c.id,'name',CASE WHEN pc.customer_id IS NULL THEN sales_private.crm_customer_deal_details_trim(c.customer_name) ELSE pc.name END,
   'phone',CASE WHEN pc.customer_id IS NULL THEN NULLIF(sales_private.crm_customer_deal_details_trim(c.phone),'') ELSE pc.phone END,'occupation',CASE WHEN pc.customer_id IS NULL THEN NULLIF(sales_private.crm_customer_deal_details_trim(c.occupation),'') ELSE pc.occupation END,
   'ownerUserId',c.owner_user_id,'revision',c.lifecycle_revision,'detailsRevision',pc.revision,
   'canEdit',actor_role='admin' OR (actor_role='sales' AND actor_id=c.owner_user_id),'sourceName',sales_private.crm_customer_deal_details_trim(c.customer_name),'sourcePhone',NULLIF(sales_private.crm_customer_deal_details_trim(c.phone),'')),
  'deal',jsonb_build_object('id',s.id,'customerId',c.id,'interestId',i.id,'projectName',i.project_name,'plotId',s.plot_id,'stage',s.crm_stage,
   'ownerUserId',i.owner_user_id,'revision',s.booking_revision,'interestRevision',i.lifecycle_revision,'detailsRevision',dc.revision,
   'salePrice',CASE WHEN dc.sale_id IS NULL THEN s.sale_price ELSE dc.sale_price END,'sourceSalePrice',s.sale_price,
   'bankName',CASE WHEN dc.sale_id IS NULL THEN NULLIF(sales_private.crm_customer_deal_details_trim(s.bank_name),'') ELSE dc.bank_name END,'sourceBankName',NULLIF(sales_private.crm_customer_deal_details_trim(s.bank_name),''),'paymentMethod',s.payment_method,
   'canEdit',actor_role='admin' OR (actor_role='sales' AND actor_id=i.owner_user_id AND s.crm_stage NOT IN ('cancelled','transferred','handover'))));
END;
$context$;
REVOKE ALL ON FUNCTION public.crm_v2_customer_deal_details_context(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_v2_customer_deal_details_context(uuid,text) TO authenticated;

CREATE FUNCTION public.crm_v2_customer_deal_details_command(p_request_id uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $command$
DECLARE actor_id uuid:=auth.uid(); actor_role text:=public.crm_v2_role(); actor_name text; actor_active boolean:=false;
 customer_id_value uuid; sale_id_value uuid; expected_customer uuid; expected_interest uuid; expected_sale uuid;
 expected_profile uuid; expected_deal uuid; project_value text; reason_value text; profile jsonb; details jsonb;
 normalized_phone_value text; name_value text; phone_value text; occupation_value text; bank_value text; price_value numeric; server_now timestamptz;
 allowed_keys text[]:=ARRAY['command','customerId','saleId','projectName','expectedCustomerRevision','expectedInterestRevision','expectedSaleRevision',
  'expectedCustomerDetailsRevision','expectedDealDetailsRevision','reason','profile','dealDetails'];
 c public.sales_customers%ROWTYPE; i public.lead_project_interests%ROWTYPE; s public.sales%ROWTYPE;
 pc sales_private.customer_profile_corrections%ROWTYPE; dc sales_private.deal_details_corrections%ROWTYPE;
 new_pc sales_private.customer_profile_corrections%ROWTYPE; new_dc sales_private.deal_details_corrections%ROWTYPE;
 role_row sales_private.crm_user_roles%ROWTYPE; prior sales_private.customer_deal_details_requests%ROWTYPE; result jsonb;
BEGIN
 IF actor_id IS NULL OR COALESCE(actor_role,'') NOT IN ('sales','admin') THEN RAISE EXCEPTION 'CRM_CUSTOMER_DEAL_DETAILS_FORBIDDEN'; END IF;
 PERFORM 1 FROM public.crm_settings WHERE id AND central_intake_enabled AND lead_work_enabled AND lead_lifecycle_enabled
  AND booking_enabled AND booking_cutover_reviewed AND post_booking_enabled FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CRM_CUSTOMER_DEAL_DETAILS_SETUP_REQUIRED'; END IF;
 IF p_request_id IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR octet_length(p_payload::text)>16384
  OR NOT(p_payload ?& allowed_keys) OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE NOT(k=ANY(allowed_keys)))
  OR jsonb_typeof(p_payload->'command') IS DISTINCT FROM 'string' OR p_payload->>'command'<>'update_details' THEN RAISE EXCEPTION 'CRM_CUSTOMER_DEAL_DETAILS_INVALID_INPUT'; END IF;
 BEGIN
  customer_id_value:=sales_private.crm_booking_uuid(p_payload->'customerId'); sale_id_value:=sales_private.crm_booking_uuid(p_payload->'saleId');
  expected_customer:=sales_private.crm_booking_uuid(p_payload->'expectedCustomerRevision'); expected_interest:=sales_private.crm_booking_uuid(p_payload->'expectedInterestRevision');
  expected_sale:=sales_private.crm_booking_uuid(p_payload->'expectedSaleRevision'); expected_profile:=sales_private.crm_booking_uuid(p_payload->'expectedCustomerDetailsRevision',true);
  expected_deal:=sales_private.crm_booking_uuid(p_payload->'expectedDealDetailsRevision',true);
  project_value:=sales_private.crm_work_text(p_payload->>'projectName',200); reason_value:=sales_private.crm_work_text(p_payload->>'reason',1000);
 EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'CRM_CUSTOMER_DEAL_DETAILS_INVALID_INPUT'; END;
 IF jsonb_typeof(p_payload->'reason')<>'string' OR jsonb_typeof(p_payload->'projectName')<>'string'
  OR reason_value<>p_payload->>'reason' OR project_value<>p_payload->>'projectName' THEN RAISE EXCEPTION 'CRM_CUSTOMER_DEAL_DETAILS_INVALID_INPUT'; END IF;
 profile:=p_payload->'profile'; details:=p_payload->'dealDetails';
 IF profile='null'::jsonb AND details='null'::jsonb THEN RAISE EXCEPTION 'CRM_CUSTOMER_DEAL_DETAILS_INVALID_INPUT'; END IF;
 IF profile<>'null'::jsonb THEN
  IF jsonb_typeof(profile)<>'object' OR NOT(profile ?& ARRAY['name','phone','occupation'])
   OR EXISTS(SELECT 1 FROM jsonb_object_keys(profile) k WHERE k NOT IN ('name','phone','occupation'))
   OR jsonb_typeof(profile->'name')<>'string' OR jsonb_typeof(profile->'phone') NOT IN ('null','string')
   OR jsonb_typeof(profile->'occupation') NOT IN ('null','string') THEN RAISE EXCEPTION 'CRM_CUSTOMER_DEAL_DETAILS_INVALID_INPUT'; END IF;
  BEGIN name_value:=sales_private.crm_work_text(profile->>'name',200);
   IF profile->'occupation'<>'null'::jsonb THEN occupation_value:=sales_private.crm_work_text(profile->>'occupation',200); END IF;
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'CRM_CUSTOMER_DEAL_DETAILS_INVALID_INPUT'; END;
  phone_value:=profile->>'phone';
  IF name_value<>profile->>'name' OR occupation_value IS DISTINCT FROM profile->>'occupation' OR
   (phone_value IS NOT NULL AND (phone_value<>btrim(phone_value) OR length(phone_value)>32 OR phone_value!~'^\+?[0-9 ()-]+$'
    OR length(regexp_replace(phone_value,'[^0-9]','','g')) NOT BETWEEN 7 AND 15)) THEN RAISE EXCEPTION 'CRM_CUSTOMER_DEAL_DETAILS_INVALID_INPUT'; END IF;
 END IF;
 IF details<>'null'::jsonb THEN
  IF jsonb_typeof(details)<>'object' OR NOT(details ?& ARRAY['salePriceSatang','bankName'])
   OR EXISTS(SELECT 1 FROM jsonb_object_keys(details) k WHERE k NOT IN ('salePriceSatang','bankName'))
   OR jsonb_typeof(details->'salePriceSatang') NOT IN ('null','number') OR jsonb_typeof(details->'bankName') NOT IN ('null','string') THEN RAISE EXCEPTION 'CRM_CUSTOMER_DEAL_DETAILS_INVALID_INPUT'; END IF;
  IF details->'salePriceSatang'<>'null'::jsonb THEN
   IF details->>'salePriceSatang'!~'^[1-9][0-9]{0,10}$' OR (details->>'salePriceSatang')::numeric>99999999999 THEN RAISE EXCEPTION 'CRM_CUSTOMER_DEAL_DETAILS_INVALID_INPUT'; END IF;
   price_value:=(details->>'salePriceSatang')::numeric/100;
  END IF;
  IF details->'bankName'<>'null'::jsonb THEN
   BEGIN bank_value:=sales_private.crm_work_text(details->>'bankName',200); EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'CRM_CUSTOMER_DEAL_DETAILS_INVALID_INPUT'; END;
   IF bank_value<>details->>'bankName' THEN RAISE EXCEPTION 'CRM_CUSTOMER_DEAL_DETAILS_INVALID_INPUT'; END IF;
  END IF;
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('crm-booking-command',0));
 SELECT * INTO c FROM public.sales_customers WHERE id=customer_id_value FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CRM_CUSTOMER_DEAL_DETAILS_NOT_FOUND'; END IF;
 SELECT li.* INTO i FROM public.lead_project_interests li JOIN public.sales ss ON ss.project_interest_id=li.id
  WHERE ss.id=sale_id_value AND li.customer_id=c.id AND li.project_name=project_value FOR UPDATE OF li;
 IF NOT FOUND THEN RAISE EXCEPTION 'CRM_CUSTOMER_DEAL_DETAILS_NOT_FOUND'; END IF;
 FOR role_row IN SELECT * FROM sales_private.crm_user_roles WHERE user_id IN(actor_id,c.owner_user_id,i.owner_user_id) ORDER BY user_id FOR SHARE LOOP
  IF role_row.user_id=actor_id AND role_row.is_active THEN actor_role:=role_row.role; actor_name:=role_row.display_name; actor_active:=true; END IF;
 END LOOP;
 IF NOT actor_active OR actor_role NOT IN ('sales','admin') OR
  (actor_role='sales' AND ((profile<>'null'::jsonb AND actor_id<>c.owner_user_id) OR (details<>'null'::jsonb AND actor_id<>i.owner_user_id))) THEN RAISE EXCEPTION 'CRM_CUSTOMER_DEAL_DETAILS_FORBIDDEN'; END IF;
 SELECT * INTO s FROM public.sales WHERE id=sale_id_value AND project_interest_id=i.id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CRM_CUSTOMER_DEAL_DETAILS_NOT_FOUND'; END IF;
 SELECT * INTO prior FROM sales_private.customer_deal_details_requests WHERE actor_user_id=actor_id AND request_id=p_request_id;
 IF FOUND THEN
  IF prior.request_payload IS DISTINCT FROM p_payload THEN RAISE EXCEPTION 'CRM_CUSTOMER_DEAL_DETAILS_IDEMPOTENCY_CONFLICT'; END IF;
  RETURN prior.response||jsonb_build_object('replayed',true);
 END IF;
 SELECT * INTO pc FROM sales_private.customer_profile_corrections WHERE customer_id=c.id FOR UPDATE;
 SELECT * INTO dc FROM sales_private.deal_details_corrections WHERE sale_id=s.id FOR UPDATE;
 IF c.merged_into_customer_id IS NOT NULL THEN RAISE EXCEPTION 'CRM_CUSTOMER_DEAL_DETAILS_CONFLICT'; END IF;
 IF c.lifecycle_revision IS DISTINCT FROM expected_customer OR i.lifecycle_revision IS DISTINCT FROM expected_interest
  OR s.booking_revision IS DISTINCT FROM expected_sale OR pc.revision IS DISTINCT FROM expected_profile OR dc.revision IS DISTINCT FROM expected_deal THEN RAISE EXCEPTION 'CRM_CUSTOMER_DEAL_DETAILS_STALE_STATE'; END IF;
 IF s.crm_stage IS NULL OR (s.booking_round IS NULL AND sales_private.crm_booking_imported_history(to_jsonb(s)) IS NULL)
  OR (s.plot_id IS NULL AND s.crm_stage<>'cancelled') OR (s.plot_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.plots WHERE id=s.plot_id AND project_name=i.project_name))
  OR EXISTS(SELECT 1 FROM public.sales WHERE lead_id=c.legacy_source_lead_id AND project_interest_id IS NULL) THEN RAISE EXCEPTION 'CRM_CUSTOMER_DEAL_DETAILS_SETUP_REQUIRED'; END IF;
 IF details<>'null'::jsonb AND actor_role='sales' AND s.crm_stage IN ('cancelled','transferred','handover') THEN RAISE EXCEPTION 'CRM_CUSTOMER_DEAL_DETAILS_CONFLICT'; END IF;
 -- Share the intake phone-review lock for both current and replacement phone, sorted to avoid lock inversion.
 IF profile<>'null'::jsonb THEN
  FOR normalized_phone_value IN SELECT DISTINCT v FROM unnest(ARRAY[
   public.crm_v2_normalize_phone(sales_private.crm_effective_customer_phone(c.id)),public.crm_v2_normalize_phone(phone_value)]) v
   WHERE v IS NOT NULL ORDER BY v LOOP
   PERFORM pg_advisory_xact_lock(hashtextextended('central-phone:'||normalized_phone_value,0));
  END LOOP;
 END IF;
 -- No-op is rejected; corrections are not a substitute for business events or source editing.
 IF profile<>'null'::jsonb AND name_value IS NOT DISTINCT FROM sales_private.crm_effective_customer_name(c.id)
   AND phone_value IS NOT DISTINCT FROM sales_private.crm_effective_customer_phone(c.id)
   AND occupation_value IS NOT DISTINCT FROM (CASE WHEN pc.customer_id IS NULL THEN NULLIF(sales_private.crm_customer_deal_details_trim(c.occupation),'') ELSE pc.occupation END) THEN RAISE EXCEPTION 'CRM_CUSTOMER_DEAL_DETAILS_CONFLICT'; END IF;
 IF details<>'null'::jsonb AND price_value IS NOT DISTINCT FROM sales_private.crm_effective_sale_price(s.id)
   AND bank_value IS NOT DISTINCT FROM (CASE WHEN dc.sale_id IS NULL THEN NULLIF(sales_private.crm_customer_deal_details_trim(s.bank_name),'') ELSE dc.bank_name END) THEN RAISE EXCEPTION 'CRM_CUSTOMER_DEAL_DETAILS_CONFLICT'; END IF;
 server_now:=clock_timestamp();
 IF profile<>'null'::jsonb THEN
  new_pc.customer_id:=c.id; new_pc.name:=name_value; new_pc.phone:=phone_value; new_pc.occupation:=occupation_value;
  new_pc.revision:=gen_random_uuid(); new_pc.actor_user_id:=actor_id; new_pc.reason:=reason_value; new_pc.recorded_at:=server_now;
  INSERT INTO sales_private.customer_deal_details_permits VALUES(txid_current(),pg_backend_pid(),actor_id,'customer',c.id,
   CASE WHEN pc.customer_id IS NULL THEN NULL ELSE to_jsonb(pc) END,to_jsonb(new_pc));
  -- Explicit INSERT/UPDATE avoids INSERT triggers on an UPSERT proposed row when an old overlay exists.
  IF pc.customer_id IS NULL THEN INSERT INTO sales_private.customer_profile_corrections SELECT new_pc.*;
  ELSE UPDATE sales_private.customer_profile_corrections SET name=new_pc.name,phone=new_pc.phone,occupation=new_pc.occupation,
   revision=new_pc.revision,actor_user_id=actor_id,reason=reason_value,recorded_at=server_now WHERE customer_id=c.id; END IF;
 ELSE new_pc:=pc; END IF;
 IF details<>'null'::jsonb THEN
  new_dc.sale_id:=s.id; new_dc.sale_price:=price_value; new_dc.bank_name:=bank_value; new_dc.revision:=gen_random_uuid();
  new_dc.actor_user_id:=actor_id; new_dc.reason:=reason_value; new_dc.recorded_at:=server_now;
  INSERT INTO sales_private.customer_deal_details_permits VALUES(txid_current(),pg_backend_pid(),actor_id,'deal',s.id,
   CASE WHEN dc.sale_id IS NULL THEN NULL ELSE to_jsonb(dc) END,to_jsonb(new_dc));
  IF dc.sale_id IS NULL THEN INSERT INTO sales_private.deal_details_corrections SELECT new_dc.*;
  ELSE UPDATE sales_private.deal_details_corrections SET sale_price=new_dc.sale_price,bank_name=new_dc.bank_name,
   revision=new_dc.revision,actor_user_id=actor_id,reason=reason_value,recorded_at=server_now WHERE sale_id=s.id; END IF;
 ELSE new_dc:=dc; END IF;
 DELETE FROM sales_private.customer_deal_details_permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid();
 INSERT INTO public.crm_audit_events(customer_id,entity_type,entity_id,event_type,reason_text,actor_user_id,actor_kind,actor_name_snapshot,old_values,new_values,occurred_at,recorded_at)
  VALUES(c.id,'sale',s.id,'customer_deal_details_corrected',reason_value,actor_id,'staff',actor_name,
   jsonb_build_object('profile',CASE WHEN pc.customer_id IS NULL THEN NULL ELSE to_jsonb(pc) END,'dealDetails',CASE WHEN dc.sale_id IS NULL THEN NULL ELSE to_jsonb(dc) END),
   jsonb_build_object('profile',CASE WHEN new_pc.customer_id IS NULL THEN NULL ELSE to_jsonb(new_pc) END,'dealDetails',CASE WHEN new_dc.sale_id IS NULL THEN NULL ELSE to_jsonb(new_dc) END,
    'sourceCustomer',jsonb_build_object('id',c.id,'name',c.customer_name,'phone',c.phone,'occupation',c.occupation),
    'sourceDeal',jsonb_build_object('id',s.id,'salePrice',s.sale_price,'bankName',s.bank_name),'baseCustomerRevision',c.lifecycle_revision,
    'baseInterestRevision',i.lifecycle_revision,'baseSaleRevision',s.booking_revision),NULL,server_now);
 result:=jsonb_build_object('requestId',p_request_id,'command','update_details','customerId',c.id,'interestId',i.id,'saleId',s.id,
  'customerRevision',c.lifecycle_revision,'interestRevision',i.lifecycle_revision,'saleRevision',s.booking_revision,
  'customerDetailsRevision',new_pc.revision,'dealDetailsRevision',new_dc.revision,'replayed',false);
 INSERT INTO sales_private.customer_deal_details_requests VALUES(actor_id,p_request_id,p_payload,result,server_now);
 RETURN result;
END;
$command$;
REVOKE ALL ON FUNCTION public.crm_v2_customer_deal_details_command(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_v2_customer_deal_details_command(uuid,jsonb) TO authenticated;

-- Exact original-source reader adapters follow. Unknown/modified definitions fail closed.
DO $reader_adapters$
DECLARE plan record; fn oid; definition text; source text; owner_name text; secured boolean; settings text[];
 edit jsonb; before_count integer;
BEGIN
 FOR plan IN SELECT * FROM (VALUES
('public.crm_v2_central_snapshot(integer,integer)','e0c108118064840fe38f9b8fdad041de','[{"old": "c.customer_name", "new": "sales_private.crm_effective_customer_name(c.id)", "count": 1}, {"old": "c.phone", "new": "sales_private.crm_effective_customer_phone(c.id)", "count": 1}]'::jsonb,false,'search_path=pg_catalog'),
('public.crm_v2_lead_work_snapshot(uuid,uuid)','fa7b937a5e848d2913ea2f896dc3d3ce','[{"old": "customer_row.customer_name", "new": "sales_private.crm_effective_customer_name(customer_row.id)", "count": 1}, {"old": "customer_row.phone", "new": "sales_private.crm_effective_customer_phone(customer_row.id)", "count": 1}]'::jsonb,false,'search_path=pg_catalog'),
('public.crm_v2_booking_search(text,integer)','f8b5f2a3fa6548784ad49a9ba6f9b1c2','[{"old": "SELECT id,customer_name,phone FROM public.sales_customers", "new": "SELECT id,sales_private.crm_effective_customer_name(id) AS customer_name,sales_private.crm_effective_customer_phone(id) AS phone FROM public.sales_customers", "count": 1}, {"old": "strpos(lower(customer_name),lower(search_value))", "new": "strpos(lower(sales_private.crm_effective_customer_name(id)),lower(search_value))", "count": 1}, {"old": "strpos(COALESCE(phone,''''),search_value)", "new": "strpos(COALESCE(sales_private.crm_effective_customer_phone(id),''''),search_value)", "count": 1}, {"old": "ORDER BY customer_name,id LIMIT 26", "new": "ORDER BY sales_private.crm_effective_customer_name(id),id LIMIT 26", "count": 1}]'::jsonb,false,'search_path=pg_catalog'),
('public.crm_v2_booking_context(uuid,integer)','b4c1bf541ff7a416391bd283c42251cf','[{"old": "customer_row.customer_name", "new": "sales_private.crm_effective_customer_name(customer_row.id)", "count": 1}, {"old": "customer_row.phone", "new": "sales_private.crm_effective_customer_phone(customer_row.id)", "count": 1}, {"old": "s.sale_price", "new": "sales_private.crm_effective_sale_price(s.id)", "count": 1}]'::jsonb,false,'search_path=pg_catalog'),
('public.crm_v2_project_sales(text,text,text,integer)','cd58b7285a384b24a550d07eeb8fdce3','[{"old": "c.customer_name,c.phone,p.plot_name", "new": "sales_private.crm_effective_customer_name(c.id) AS customer_name,sales_private.crm_effective_customer_phone(c.id) AS phone,p.plot_name", "count": 1}, {"old": "lower(c.customer_name)", "new": "lower(sales_private.crm_effective_customer_name(c.id))", "count": 1}, {"old": "COALESCE(c.phone,'''')", "new": "COALESCE(sales_private.crm_effective_customer_phone(c.id),'''')", "count": 1}, {"old": "s.sale_price", "new": "sales_private.crm_effective_sale_price(s.id)", "count": 1}]'::jsonb,false,'search_path=pg_catalog'),
('public.crm_v2_sales_report(text,text,text)','72692c600b8cc18ce01ea343d00c186f','[{"old": "SELECT s.crm_stage,s.sale_price,s.booked_at,s.cancelled_at", "new": "SELECT s.crm_stage,sales_private.crm_effective_sale_price(s.id) AS sale_price,s.booked_at,s.cancelled_at", "count": 1}]'::jsonb,false,'search_path=pg_catalog'),
('public.crm_v2_post_booking_context(uuid,integer,integer)','ec55978650c18d5b9773af0827fd5ea6','[{"old": "customer_row.customer_name", "new": "sales_private.crm_effective_customer_name(customer_row.id)", "count": 1}]'::jsonb,false,'search_path=pg_catalog'),
('public.crm_v2_central_search(jsonb,integer)','4e93256595ee337f4614f4157e0df4be','[{"old": "c.customer_name", "new": "sales_private.crm_effective_customer_name(c.id)", "count": 2}, {"old": "c.phone", "new": "sales_private.crm_effective_customer_phone(c.id)", "count": 2}]'::jsonb,true,'search_path=pg_catalog')
,
('public.crm_v2_create_customer(uuid,jsonb)','bf550c33eeacc4fb4b8d2f5f36e57b7c','[{"old": "EXISTS (SELECT 1 FROM public.sales_customers WHERE phone_normalized=normalized_phone)", "new": "(EXISTS (SELECT 1 FROM sales_private.customer_profile_corrections o WHERE public.crm_v2_normalize_phone(o.phone)=normalized_phone)\n    OR EXISTS (SELECT 1 FROM public.sales_customers c WHERE c.phone_normalized=normalized_phone\n      AND NOT EXISTS (SELECT 1 FROM sales_private.customer_profile_corrections o WHERE o.customer_id=c.id)))", "count": 1}]'::jsonb,false,'search_path=pg_catalog')
 ) v(signature,source_digest,edits,optional,search_setting) LOOP
  fn:=to_regprocedure(plan.signature);
  IF fn IS NULL AND plan.optional THEN CONTINUE; END IF;
  IF fn IS NULL THEN RAISE EXCEPTION 'CRM_CUSTOMER_DEAL_DETAILS_READER_REVIEW_REQUIRED'; END IF;
  SELECT pg_get_functiondef(p.oid),replace(p.prosrc,E'\r\n',E'\n'),pg_get_userbyid(p.proowner),p.prosecdef,p.proconfig
   INTO definition,source,owner_name,secured,settings FROM pg_proc p WHERE p.oid=fn;
  IF owner_name IS DISTINCT FROM current_user OR NOT secured OR md5(source) IS DISTINCT FROM plan.source_digest
   OR NOT(plan.search_setting=ANY(settings)) OR cardinality(settings) NOT BETWEEN 1 AND 2
   OR EXISTS(SELECT 1 FROM unnest(settings) v WHERE v NOT IN ('search_path=pg_catalog','TimeZone=UTC','timezone=UTC')) THEN
   RAISE EXCEPTION 'CRM_CUSTOMER_DEAL_DETAILS_READER_REVIEW_REQUIRED'; END IF;
  definition:=replace(definition,E'\r\n',E'\n');
  FOR edit IN SELECT * FROM jsonb_array_elements(plan.edits) LOOP
   before_count:=(length(definition)-length(replace(definition,edit->>'old','')))/length(edit->>'old');
   IF before_count IS DISTINCT FROM (edit->>'count')::integer THEN RAISE EXCEPTION 'CRM_CUSTOMER_DEAL_DETAILS_READER_REVIEW_REQUIRED'; END IF;
   definition:=replace(definition,edit->>'old',edit->>'new');
  END LOOP;
  EXECUTE definition;
 END LOOP;
END;
$reader_adapters$;
-- All corrections are private; existing source guards and native lifecycle revisions remain unchanged.

-- DESIGN ONLY. Separate archive for reviewed historical gaps; never a business importer.
-- Depends on canonical Customers/Interests +04 staff roles. Does not alter the 24 ledger.
-- Unknown project visits and cancelled history without a known Sale stay evidence only.

-- Design sentinel cleared only in this reviewed installation artifact.

CREATE SCHEMA sales_unknown_history_private;
REVOKE ALL ON SCHEMA sales_unknown_history_private FROM PUBLIC,anon,authenticated;
CREATE TABLE sales_unknown_history_private.batches (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_system text NOT NULL, dataset_key text NOT NULL,
 snapshot_sha256 text NOT NULL CHECK(snapshot_sha256 ~ '^[a-f0-9]{64}$'), mapping_review_ref text NOT NULL,
 payload jsonb NOT NULL, reviewer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(source_system,dataset_key)
);
CREATE TABLE sales_unknown_history_private.records (
 batch_id uuid NOT NULL REFERENCES sales_unknown_history_private.batches(id) ON DELETE RESTRICT,
 source_system text NOT NULL, source_key text NOT NULL CHECK(source_key ~ '^[a-f0-9]{64}$'),
 row_number integer NOT NULL CHECK(row_number BETWEEN 2 AND 50000), row_sha256 text NOT NULL CHECK(row_sha256 ~ '^[a-f0-9]{64}$'),
 customer_key text NOT NULL, customer_id uuid NOT NULL REFERENCES public.sales_customers(id) ON DELETE RESTRICT,
 interest_id uuid, sale_id uuid CHECK(sale_id IS NULL), reason text NOT NULL, source_stage text NOT NULL, payload jsonb NOT NULL,
 PRIMARY KEY(batch_id,source_key), UNIQUE(source_system,source_key), UNIQUE(batch_id,row_number),
 FOREIGN KEY(interest_id,customer_id) REFERENCES public.lead_project_interests(id,customer_id) ON DELETE RESTRICT,
 CHECK((reason='unknown_project' AND source_stage='visited' AND interest_id IS NULL)
   OR (reason='unknown_booking' AND source_stage='cancelled'))
);
CREATE INDEX unknown_history_customer_idx ON sales_unknown_history_private.records(customer_id,batch_id,source_key);
CREATE INDEX unknown_history_source_customer_idx ON sales_unknown_history_private.records(source_system,customer_key);
CREATE TABLE sales_unknown_history_private.events (
 batch_id uuid NOT NULL, source_key text NOT NULL, event_key text NOT NULL, sequence integer NOT NULL CHECK(sequence BETWEEN 1 AND 1000),
 kind text NOT NULL CHECK(kind IN ('visited','booked','cancelled')), occurred_date date,
 precision text NOT NULL CHECK(precision IN ('day','unknown')), evidence_ref text NOT NULL,
 PRIMARY KEY(batch_id,source_key,event_key), UNIQUE(batch_id,source_key,sequence),
 FOREIGN KEY(batch_id,source_key) REFERENCES sales_unknown_history_private.records(batch_id,source_key) ON DELETE RESTRICT,
 CHECK((precision='unknown' AND occurred_date IS NULL) OR (precision='day' AND occurred_date IS NOT NULL)),
 CHECK(occurred_date IS NULL OR (isfinite(occurred_date) AND occurred_date>=DATE '0001-01-01' AND occurred_date<DATE '10000-01-01'))
);
ALTER TABLE sales_unknown_history_private.batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_unknown_history_private.records ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_unknown_history_private.events ENABLE ROW LEVEL SECURITY;
CREATE TABLE sales_unknown_history_private.insert_permits (
 transaction_id bigint NOT NULL, backend_pid integer NOT NULL, actor_id uuid NOT NULL,
 relation_name text NOT NULL, expected_row jsonb NOT NULL, PRIMARY KEY(transaction_id,backend_pid)
);
ALTER TABLE sales_unknown_history_private.insert_permits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA sales_unknown_history_private FROM PUBLIC,anon,authenticated;

-- Broad grants must not turn this private archive into an unguarded insertion path.
CREATE FUNCTION sales_unknown_history_private.guard_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF current_user IS DISTINCT FROM (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid=TG_RELID)
  OR auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM sales_unknown_history_private.insert_permits
   WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid() AND actor_id=auth.uid()
    AND relation_name=TG_TABLE_NAME AND expected_row=to_jsonb(NEW))
 THEN RAISE EXCEPTION 'UNKNOWN_HISTORY_INSERT_FORBIDDEN'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER unknown_history_batch_insert BEFORE INSERT ON sales_unknown_history_private.batches
 FOR EACH ROW EXECUTE FUNCTION sales_unknown_history_private.guard_insert();
CREATE TRIGGER unknown_history_record_insert BEFORE INSERT ON sales_unknown_history_private.records
 FOR EACH ROW EXECUTE FUNCTION sales_unknown_history_private.guard_insert();
CREATE TRIGGER unknown_history_event_insert BEFORE INSERT ON sales_unknown_history_private.events
 FOR EACH ROW EXECUTE FUNCTION sales_unknown_history_private.guard_insert();
CREATE FUNCTION sales_unknown_history_private.guard_permit()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF current_user IS DISTINCT FROM (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid=TG_RELID)
  OR TG_OP NOT IN ('INSERT','DELETE') THEN RAISE EXCEPTION 'UNKNOWN_HISTORY_INSERT_FORBIDDEN'; END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END; $$;
CREATE TRIGGER unknown_history_permit_guard BEFORE INSERT OR UPDATE OR DELETE ON sales_unknown_history_private.insert_permits
 FOR EACH ROW EXECUTE FUNCTION sales_unknown_history_private.guard_permit();
CREATE FUNCTION sales_unknown_history_private.insert_exact(p_relation text,p_row jsonb)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF p_relation NOT IN ('batches','records','events') OR auth.uid() IS NULL
  OR current_user IS DISTINCT FROM (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid='sales_unknown_history_private.insert_permits'::regclass)
 THEN RAISE EXCEPTION 'UNKNOWN_HISTORY_INSERT_FORBIDDEN'; END IF;
 PERFORM 1 FROM sales_private.crm_user_roles WHERE user_id=auth.uid() AND role='admin' AND is_active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'UNKNOWN_HISTORY_FORBIDDEN'; END IF;
 INSERT INTO sales_unknown_history_private.insert_permits VALUES(txid_current(),pg_backend_pid(),auth.uid(),p_relation,p_row);
 EXECUTE format('INSERT INTO sales_unknown_history_private.%I SELECT (jsonb_populate_record(NULL::sales_unknown_history_private.%I,$1)).*',p_relation,p_relation) USING p_row;
 DELETE FROM sales_unknown_history_private.insert_permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid();
END; $$;

CREATE FUNCTION sales_unknown_history_private.reject_change()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'UNKNOWN_HISTORY_APPEND_ONLY'; END; $$;
CREATE TRIGGER unknown_history_batch_sealed BEFORE UPDATE OR DELETE OR TRUNCATE ON sales_unknown_history_private.batches
 FOR EACH STATEMENT EXECUTE FUNCTION sales_unknown_history_private.reject_change();
CREATE TRIGGER unknown_history_record_sealed BEFORE UPDATE OR DELETE OR TRUNCATE ON sales_unknown_history_private.records
 FOR EACH STATEMENT EXECUTE FUNCTION sales_unknown_history_private.reject_change();
CREATE TRIGGER unknown_history_event_sealed BEFORE UPDATE OR DELETE OR TRUNCATE ON sales_unknown_history_private.events
 FOR EACH STATEMENT EXECUTE FUNCTION sales_unknown_history_private.reject_change();
CREATE TRIGGER unknown_history_permit_no_truncate BEFORE TRUNCATE ON sales_unknown_history_private.insert_permits
 FOR EACH STATEMENT EXECUTE FUNCTION sales_unknown_history_private.reject_change();

CREATE FUNCTION sales_unknown_history_private.require_object(p_value jsonb,p_keys text[])
RETURNS void LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF jsonb_typeof(p_value) IS DISTINCT FROM 'object' OR
  (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_value) k)
   IS DISTINCT FROM (SELECT array_agg(k ORDER BY k) FROM unnest(p_keys) k)
 THEN RAISE EXCEPTION 'UNKNOWN_HISTORY_INVALID'; END IF;
END; $$;
CREATE FUNCTION sales_unknown_history_private.require_text(p_value jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE v text:=p_value#>>'{}';
BEGIN
 IF jsonb_typeof(p_value) IS DISTINCT FROM 'string' OR length(v) NOT BETWEEN 1 AND 200
  OR btrim(v,U&' \00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')<>v
  OR v ~ U&'[\0001-\001F\007F-\009F]' THEN RAISE EXCEPTION 'UNKNOWN_HISTORY_INVALID'; END IF;
 RETURN v;
END; $$;
CREATE FUNCTION sales_unknown_history_private.require_uuid(p_value jsonb)
RETURNS uuid LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF jsonb_typeof(p_value) IS DISTINCT FROM 'string' OR (p_value#>>'{}' ~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$') IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'UNKNOWN_HISTORY_INVALID'; END IF;
 RETURN (p_value#>>'{}')::uuid;
END; $$;

-- Private INVOKER only. A future operator grant needs separate review; no browser RPC.
CREATE FUNCTION sales_unknown_history_private.persist_evidence(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $persist$
DECLARE actor uuid:=auth.uid(); batch sales_unknown_history_private.batches%ROWTYPE;
 src_system text; dataset text; review_ref text; row_value jsonb; ev jsonb; customer_value uuid; interest_value uuid;
 key_value text; customer_key_value text; reason_value text; stage_value text; date_value date; last_date date;
 seq_value integer; rank_value integer; last_rank integer; booked_count integer; cancelled_count integer; events_count integer:=0;
BEGIN
 IF actor IS NULL OR current_user IS DISTINCT FROM (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid='sales_unknown_history_private.batches'::regclass)
 THEN RAISE EXCEPTION 'UNKNOWN_HISTORY_FORBIDDEN'; END IF;
 PERFORM 1 FROM sales_private.crm_user_roles WHERE user_id=actor AND role='admin' AND is_active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'UNKNOWN_HISTORY_FORBIDDEN'; END IF;
 PERFORM sales_unknown_history_private.require_object(p_payload,ARRAY['version','sourceSystem','datasetKey','snapshotSha256','mappingReviewRef','records','businessWritesAllowed','leadRequired']);
 IF p_payload->>'version' IS DISTINCT FROM 'unknown-historical-evidence-v1'
  OR p_payload->'businessWritesAllowed' IS DISTINCT FROM 'false'::jsonb OR p_payload->'leadRequired' IS DISTINCT FROM 'false'::jsonb
  OR jsonb_typeof(p_payload->'snapshotSha256') IS DISTINCT FROM 'string' OR (p_payload->>'snapshotSha256' ~ '^[a-f0-9]{64}$') IS DISTINCT FROM true
  OR jsonb_typeof(p_payload->'records') IS DISTINCT FROM 'array' OR octet_length(p_payload::text)>8388608
 THEN RAISE EXCEPTION 'UNKNOWN_HISTORY_INVALID'; END IF;
 IF jsonb_array_length(p_payload->'records') NOT BETWEEN 1 AND 5000 THEN RAISE EXCEPTION 'UNKNOWN_HISTORY_INVALID'; END IF;
 src_system:=sales_unknown_history_private.require_text(p_payload->'sourceSystem');
 dataset:=sales_unknown_history_private.require_text(p_payload->'datasetKey'); review_ref:=sales_unknown_history_private.require_text(p_payload->'mappingReviewRef');
 -- Same lock family as the 24 archive; this function only writes its separate archive.
 PERFORM pg_advisory_xact_lock(hashtextextended('historical-evidence-source:'||src_system,0));
 SELECT * INTO batch FROM sales_unknown_history_private.batches WHERE source_system=src_system AND dataset_key=dataset FOR UPDATE;
 IF FOUND THEN
  IF batch.payload IS DISTINCT FROM p_payload THEN RAISE EXCEPTION 'UNKNOWN_HISTORY_RECONCILIATION_REQUIRED'; END IF;
  RETURN jsonb_build_object('batchId',batch.id,'replayed',true,'records',jsonb_array_length(p_payload->'records'),
   'events',(SELECT count(*) FROM sales_unknown_history_private.events WHERE batch_id=batch.id),'businessChanged',false);
 END IF;
 batch.id:=gen_random_uuid(); batch.source_system:=src_system; batch.dataset_key:=dataset; batch.snapshot_sha256:=p_payload->>'snapshotSha256';
 batch.mapping_review_ref:=review_ref; batch.payload:=p_payload; batch.reviewer_id:=actor; batch.recorded_at:=clock_timestamp();
 PERFORM sales_unknown_history_private.insert_exact('batches',to_jsonb(batch));
 PERFORM 1 FROM public.sales_customers WHERE id IN(SELECT sales_unknown_history_private.require_uuid(r->'customerId') FROM jsonb_array_elements(p_payload->'records') r) ORDER BY id FOR SHARE;
 PERFORM 1 FROM public.lead_project_interests WHERE id IN(SELECT sales_unknown_history_private.require_uuid(r->'interestId') FROM jsonb_array_elements(p_payload->'records') r WHERE r->'interestId'<>'null'::jsonb) ORDER BY id FOR SHARE;
 FOR row_value IN SELECT value FROM jsonb_array_elements(p_payload->'records') LOOP
  PERFORM sales_unknown_history_private.require_object(row_value,ARRAY['sourceKey','rowNumber','rowSha256','customerKey','customerId','interestId','saleId','reason','sourceStage','events']);
  IF jsonb_typeof(row_value->'sourceKey') IS DISTINCT FROM 'string' OR (row_value->>'sourceKey' ~ '^[a-f0-9]{64}$') IS DISTINCT FROM true
   OR jsonb_typeof(row_value->'rowSha256') IS DISTINCT FROM 'string' OR (row_value->>'rowSha256' ~ '^[a-f0-9]{64}$') IS DISTINCT FROM true
   OR jsonb_typeof(row_value->'rowNumber') IS DISTINCT FROM 'number' OR (row_value->>'rowNumber' ~ '^[0-9]+$') IS DISTINCT FROM true
   OR row_value->'saleId' IS DISTINCT FROM 'null'::jsonb OR jsonb_typeof(row_value->'events') IS DISTINCT FROM 'array'
  THEN RAISE EXCEPTION 'UNKNOWN_HISTORY_INVALID'; END IF;
  key_value:=row_value->>'sourceKey'; customer_key_value:=sales_unknown_history_private.require_text(row_value->'customerKey');
  customer_value:=sales_unknown_history_private.require_uuid(row_value->'customerId');
  interest_value:=CASE WHEN row_value->'interestId'='null'::jsonb THEN NULL ELSE sales_unknown_history_private.require_uuid(row_value->'interestId') END;
  reason_value:=sales_unknown_history_private.require_text(row_value->'reason'); stage_value:=sales_unknown_history_private.require_text(row_value->'sourceStage');
  IF NOT ((reason_value='unknown_project' AND stage_value='visited' AND interest_value IS NULL)
   OR (reason_value='unknown_booking' AND stage_value='cancelled')) THEN RAISE EXCEPTION 'UNKNOWN_HISTORY_INVALID'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.sales_customers WHERE id=customer_value AND merged_into_customer_id IS NULL)
   OR (interest_value IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.lead_project_interests WHERE id=interest_value AND customer_id=customer_value))
   OR EXISTS(SELECT 1 FROM sales_unknown_history_private.records WHERE source_system=src_system AND
    ((customer_key=customer_key_value AND customer_id<>customer_value) OR (customer_id=customer_value AND customer_key<>customer_key_value)))
  THEN RAISE EXCEPTION 'UNKNOWN_HISTORY_MAPPING_CONFLICT'; END IF;
  IF jsonb_array_length(row_value->'events') NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'UNKNOWN_HISTORY_INVALID'; END IF;
  PERFORM sales_unknown_history_private.insert_exact('records',jsonb_build_object('batch_id',batch.id,'source_system',src_system,'source_key',key_value,
   'row_number',(row_value->>'rowNumber')::integer,'row_sha256',row_value->>'rowSha256','customer_key',customer_key_value,'customer_id',customer_value,
   'interest_id',interest_value,'sale_id',NULL,'reason',reason_value,'source_stage',stage_value,'payload',row_value));
  seq_value:=0; last_rank:=-1; last_date:=NULL; booked_count:=0; cancelled_count:=0;
  FOR ev IN SELECT value FROM jsonb_array_elements(row_value->'events') LOOP
   events_count:=events_count+1; IF events_count>20000 THEN RAISE EXCEPTION 'UNKNOWN_HISTORY_INVALID'; END IF;
   PERFORM sales_unknown_history_private.require_object(ev,ARRAY['eventKey','kind','sequence','date','precision','evidenceRef']);
   PERFORM sales_unknown_history_private.require_text(ev->'eventKey'); PERFORM sales_unknown_history_private.require_text(ev->'evidenceRef');
   PERFORM sales_unknown_history_private.require_text(ev->'kind');
   IF jsonb_typeof(ev->'sequence') IS DISTINCT FROM 'number' OR (ev->>'sequence' ~ '^[0-9]+$') IS DISTINCT FROM true
    OR (ev->>'sequence')::integer<>seq_value+1 THEN RAISE EXCEPTION 'UNKNOWN_HISTORY_INVALID'; END IF;
   seq_value:=seq_value+1; date_value:=NULL;
   IF ev->'date'<>'null'::jsonb THEN
    IF jsonb_typeof(ev->'date') IS DISTINCT FROM 'string' OR (ev->>'date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') IS DISTINCT FROM true
     OR NOT pg_input_is_valid(ev->>'date','date') THEN RAISE EXCEPTION 'UNKNOWN_HISTORY_INVALID'; END IF;
    date_value:=(ev->>'date')::date;
    IF to_char(date_value,'YYYY-MM-DD')<>ev->>'date' THEN RAISE EXCEPTION 'UNKNOWN_HISTORY_INVALID'; END IF;
   END IF;
   IF ev->>'precision' IS DISTINCT FROM (CASE WHEN date_value IS NULL THEN 'unknown' ELSE 'day' END)
    OR ev->>'kind' NOT IN ('visited','booked','cancelled') THEN RAISE EXCEPTION 'UNKNOWN_HISTORY_INVALID'; END IF;
   rank_value:=CASE ev->>'kind' WHEN 'visited' THEN 0 WHEN 'booked' THEN 1 ELSE 2 END;
   IF rank_value<last_rank OR date_value<last_date OR (reason_value='unknown_project' AND rank_value<>0)
   THEN RAISE EXCEPTION 'UNKNOWN_HISTORY_ORDER_CONFLICT'; END IF;
   IF ev->>'kind'='booked' THEN booked_count:=booked_count+1; END IF;
   IF ev->>'kind'='cancelled' THEN cancelled_count:=cancelled_count+1; END IF;
   IF booked_count>1 OR cancelled_count>1 OR (ev->>'kind'='cancelled' AND booked_count<>1)
   THEN RAISE EXCEPTION 'UNKNOWN_HISTORY_ORDER_CONFLICT'; END IF;
   last_rank:=rank_value; IF date_value IS NOT NULL THEN last_date:=date_value; END IF;
   PERFORM sales_unknown_history_private.insert_exact('events',jsonb_build_object('batch_id',batch.id,'source_key',key_value,'event_key',ev->>'eventKey',
    'sequence',seq_value,'kind',ev->>'kind','occurred_date',date_value,'precision',ev->>'precision','evidence_ref',ev->>'evidenceRef'));
  END LOOP;
  IF reason_value='unknown_booking' AND (booked_count<>1 OR cancelled_count<>1 OR last_rank<>2)
  THEN RAISE EXCEPTION 'UNKNOWN_HISTORY_ORDER_CONFLICT'; END IF;
 END LOOP;
 RETURN jsonb_build_object('batchId',batch.id,'replayed',false,'records',jsonb_array_length(p_payload->'records'),'events',events_count,'businessChanged',false);
END;
$persist$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA sales_unknown_history_private FROM PUBLIC,anon,authenticated;

-- DESIGN ONLY. Existing imported Sale corrections, never a booking/status importer.
-- Completed imported transfers accept forecast-only P evidence, with no price,
-- bank, actual-date, lifecycle or stock edit. Operational money stays sealed.
-- Requires reviewed base +04/05/18/19/20/21/22 and external provenance.
-- Source rows, operational dates, bank, ownership, occupancy and stages stay sealed.
-- The restricted import operator must supply freshly captured exact before-images.

-- Design sentinel cleared only in this reviewed installation artifact.

CREATE SCHEMA sales_import_private;
REVOKE ALL ON SCHEMA sales_import_private FROM PUBLIC,anon,authenticated;
CREATE TABLE sales_import_private.detail_batches (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), dataset_key text NOT NULL UNIQUE,
 source_sha256 text NOT NULL CHECK(source_sha256 ~ '^[a-f0-9]{64}$'), review_sha256 text NOT NULL CHECK(review_sha256 ~ '^[a-f0-9]{64}$'),
 payload jsonb NOT NULL, reviewer_id uuid NOT NULL REFERENCES auth.users(id), recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE sales_import_private.detail_events (
 batch_id uuid NOT NULL REFERENCES sales_import_private.detail_batches(id), source_row integer NOT NULL CHECK(source_row BETWEEN 2 AND 50000),
 source_key text NOT NULL CHECK(source_key ~ '^[a-f0-9]{64}$'), row_sha256 text NOT NULL CHECK(row_sha256 ~ '^[a-f0-9]{64}$'),
 sale_id uuid NOT NULL REFERENCES public.sales(id), before_details jsonb, after_details jsonb,
 before_forecast jsonb, after_forecast jsonb,
 PRIMARY KEY(batch_id,source_row), UNIQUE(batch_id,sale_id), UNIQUE(batch_id,source_key)
);
CREATE TABLE sales_import_private.forecast_corrections (
 sale_id uuid PRIMARY KEY REFERENCES public.sales(id), expected_transfer_date date NOT NULL CHECK(expected_transfer_date BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),
 revision uuid NOT NULL, batch_id uuid NOT NULL REFERENCES sales_import_private.detail_batches(id), reviewer_id uuid NOT NULL REFERENCES auth.users(id), recorded_at timestamptz NOT NULL
);
CREATE TABLE sales_import_private.forecast_permits (
 transaction_id bigint NOT NULL, backend_pid integer NOT NULL, actor_id uuid NOT NULL, sale_id uuid NOT NULL,
 old_row jsonb, new_row jsonb NOT NULL, PRIMARY KEY(transaction_id,backend_pid,sale_id)
);
ALTER TABLE sales_import_private.detail_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_import_private.detail_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_import_private.forecast_corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_import_private.forecast_permits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA sales_import_private FROM PUBLIC,anon,authenticated;

CREATE FUNCTION sales_import_private.immutable()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'IMPORT_DETAILS_SEALED'; END; $$;
CREATE TRIGGER import_batch_sealed BEFORE UPDATE OR DELETE OR TRUNCATE ON sales_import_private.detail_batches FOR EACH STATEMENT EXECUTE FUNCTION sales_import_private.immutable();
CREATE TRIGGER import_events_sealed BEFORE UPDATE OR DELETE OR TRUNCATE ON sales_import_private.detail_events FOR EACH STATEMENT EXECUTE FUNCTION sales_import_private.immutable();
CREATE TRIGGER import_forecast_no_truncate BEFORE TRUNCATE ON sales_import_private.forecast_corrections FOR EACH STATEMENT EXECUTE FUNCTION sales_import_private.immutable();
CREATE FUNCTION sales_import_private.owner_insert_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF current_user IS DISTINCT FROM (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid=TG_RELID)
  OR auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM sales_private.crm_user_roles WHERE user_id=auth.uid() AND role='admin' AND is_active)
 THEN RAISE EXCEPTION 'IMPORT_DETAILS_FORBIDDEN'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER import_batch_insert_guard BEFORE INSERT ON sales_import_private.detail_batches FOR EACH ROW EXECUTE FUNCTION sales_import_private.owner_insert_guard();
CREATE TRIGGER import_event_insert_guard BEFORE INSERT ON sales_import_private.detail_events FOR EACH ROW EXECUTE FUNCTION sales_import_private.owner_insert_guard();
CREATE FUNCTION sales_import_private.permit_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP NOT IN ('INSERT','DELETE') OR current_user IS DISTINCT FROM (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid=TG_RELID)
 THEN RAISE EXCEPTION 'IMPORT_DETAILS_FORBIDDEN'; END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END; $$;
CREATE TRIGGER import_permit_guard BEFORE INSERT OR UPDATE OR DELETE ON sales_import_private.forecast_permits FOR EACH ROW EXECUTE FUNCTION sales_import_private.permit_guard();
CREATE TRIGGER import_permit_no_truncate BEFORE TRUNCATE ON sales_import_private.forecast_permits FOR EACH STATEMENT EXECUTE FUNCTION sales_import_private.immutable();
CREATE FUNCTION sales_import_private.forecast_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP NOT IN ('INSERT','UPDATE') OR NOT EXISTS(SELECT 1 FROM sales_import_private.forecast_permits p
   WHERE p.transaction_id=txid_current() AND p.backend_pid=pg_backend_pid() AND p.actor_id=auth.uid()
    AND p.sale_id=NEW.sale_id AND p.new_row=to_jsonb(NEW)
    AND p.old_row IS NOT DISTINCT FROM CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE NULL END)
  THEN RAISE EXCEPTION 'IMPORT_DETAILS_FORBIDDEN'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER import_forecast_guard BEFORE INSERT OR UPDATE OR DELETE ON sales_import_private.forecast_corrections FOR EACH ROW EXECUTE FUNCTION sales_import_private.forecast_guard();

-- Source forecast remains a DATE, never an actual transfer timestamp. No overlay means preserve source.
CREATE FUNCTION sales_import_private.expected_transfer_date(p_sale_id uuid,p_source_day text)
RETURNS text LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT COALESCE((SELECT to_char(expected_transfer_date,'YYYY-MM-DD') FROM sales_import_private.forecast_corrections WHERE sale_id=p_sale_id),p_source_day);
$$;
CREATE FUNCTION sales_import_private.exact_object(v jsonb,keys text[])
RETURNS void LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF jsonb_typeof(v) IS DISTINCT FROM 'object' OR
  (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(v) k) IS DISTINCT FROM (SELECT array_agg(k ORDER BY k) FROM unnest(keys) k)
 THEN RAISE EXCEPTION 'IMPORT_DETAILS_INVALID'; END IF;
END; $$;

-- PRIVATE INVOKER ONLY. No browser/RPC grants, no feature activation, no implicit NULL clear.
CREATE FUNCTION sales_import_private.apply_reviewed_details(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog SET timezone='UTC' AS $apply$
DECLARE actor uuid:=auth.uid(); b sales_import_private.detail_batches%ROWTYPE; inserted_id uuid;
 r jsonb; binding jsonb; patch jsonb; before_image jsonb; c public.sales_customers%ROWTYPE;
 i public.lead_project_interests%ROWTYPE; s public.sales%ROWTYPE;
 dc sales_private.deal_details_corrections%ROWTYPE; ndc sales_private.deal_details_corrections%ROWTYPE;
 fc sales_import_private.forecast_corrections%ROWTYPE; nfc sales_import_private.forecast_corrections%ROWTYPE;
 price numeric; forecast date; changed integer:=0; recorded timestamptz; canonical_before jsonb;
BEGIN
 IF actor IS NULL OR current_user IS DISTINCT FROM (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid='sales_import_private.detail_batches'::regclass)
 THEN RAISE EXCEPTION 'IMPORT_DETAILS_FORBIDDEN'; END IF;
 -- Same lock order as operational writers; Admin revocation waits or denies before any commit.
 PERFORM pg_advisory_xact_lock(hashtextextended('crm-booking-command',0));
 PERFORM 1 FROM sales_private.crm_user_roles WHERE user_id=actor AND role='admin' AND is_active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'IMPORT_DETAILS_FORBIDDEN'; END IF;
 PERFORM sales_import_private.exact_object(p_payload,ARRAY['version','datasetKey','sourceSha256','reviewSha256','records','businessStageWritesAllowed','leadReplayAllowed']);
 IF p_payload->>'version' IS DISTINCT FROM 'reviewed-import-details-v1'
  OR p_payload->'businessStageWritesAllowed' IS DISTINCT FROM 'false'::jsonb OR p_payload->'leadReplayAllowed' IS DISTINCT FROM 'false'::jsonb
  OR jsonb_typeof(p_payload->'datasetKey') IS DISTINCT FROM 'string' OR length(p_payload->>'datasetKey') NOT BETWEEN 1 AND 200
  OR p_payload->>'datasetKey'<>btrim(p_payload->>'datasetKey') OR p_payload->>'datasetKey' ~ '[[:cntrl:]]'
  OR jsonb_typeof(p_payload->'sourceSha256') IS DISTINCT FROM 'string' OR (p_payload->>'sourceSha256' ~ '^[a-f0-9]{64}$') IS DISTINCT FROM true
  OR jsonb_typeof(p_payload->'reviewSha256') IS DISTINCT FROM 'string' OR (p_payload->>'reviewSha256' ~ '^[a-f0-9]{64}$') IS DISTINCT FROM true
  OR jsonb_typeof(p_payload->'records') IS DISTINCT FROM 'array' OR octet_length(p_payload::text)>8388608
 THEN RAISE EXCEPTION 'IMPORT_DETAILS_INVALID'; END IF;
 IF jsonb_array_length(p_payload->'records') NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'IMPORT_DETAILS_INVALID'; END IF;
 INSERT INTO sales_import_private.detail_batches(dataset_key,source_sha256,review_sha256,payload,reviewer_id)
 VALUES(p_payload->>'datasetKey',p_payload->>'sourceSha256',p_payload->>'reviewSha256',p_payload,actor)
 ON CONFLICT(dataset_key) DO NOTHING RETURNING id INTO inserted_id;
 SELECT * INTO STRICT b FROM sales_import_private.detail_batches WHERE dataset_key=p_payload->>'datasetKey' FOR UPDATE;
 IF b.payload IS DISTINCT FROM p_payload THEN RAISE EXCEPTION 'IMPORT_DETAILS_REPLAY_CONFLICT'; END IF;
 IF inserted_id IS NULL THEN RETURN jsonb_build_object('batchId',b.id,'records',jsonb_array_length(p_payload->'records'),'replayed',true,'sourceChanged',false); END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(p_payload->'records') ORDER BY value->'binding'->>'saleId' LOOP
  PERFORM sales_import_private.exact_object(r,ARRAY['sourceRow','sourceKey','rowSha256','binding','before','patch']);
  binding:=r->'binding'; patch:=r->'patch'; before_image:=r->'before';
  PERFORM sales_import_private.exact_object(binding,ARRAY['customerId','interestId','saleId','customerOwnerId','interestOwnerId','customerRevision','interestRevision']);
  PERFORM sales_import_private.exact_object(before_image,ARRAY['sale','details','forecast']);
  PERFORM sales_import_private.exact_object(patch,ARRAY['salePriceSatang','expectedTransferDate','sourceStage']);
  IF jsonb_typeof(r->'sourceRow') IS DISTINCT FROM 'number' OR (r->>'sourceRow' ~ '^[0-9]+$') IS DISTINCT FROM true
   OR jsonb_typeof(r->'sourceKey') IS DISTINCT FROM 'string' OR (r->>'sourceKey' ~ '^[a-f0-9]{64}$') IS DISTINCT FROM true
   OR jsonb_typeof(r->'rowSha256') IS DISTINCT FROM 'string' OR (r->>'rowSha256' ~ '^[a-f0-9]{64}$') IS DISTINCT FROM true
   OR jsonb_typeof(patch->'salePriceSatang') NOT IN ('null','number') OR jsonb_typeof(patch->'expectedTransferDate') NOT IN ('null','string')
   OR jsonb_typeof(patch->'sourceStage') IS DISTINCT FROM 'string'
   OR EXISTS(SELECT 1 FROM jsonb_each(binding) x WHERE jsonb_typeof(x.value)<>'string' OR (x.value#>>'{}' ~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$') IS DISTINCT FROM true)
  THEN RAISE EXCEPTION 'IMPORT_DETAILS_INVALID'; END IF;
  SELECT * INTO c FROM public.sales_customers WHERE id=(binding->>'customerId')::uuid FOR UPDATE;
  SELECT * INTO i FROM public.lead_project_interests WHERE id=(binding->>'interestId')::uuid FOR UPDATE;
  SELECT * INTO s FROM public.sales WHERE id=(binding->>'saleId')::uuid FOR UPDATE;
  SELECT * INTO dc FROM sales_private.deal_details_corrections WHERE sale_id=s.id FOR UPDATE;
  SELECT * INTO fc FROM sales_import_private.forecast_corrections WHERE sale_id=s.id FOR UPDATE;
  IF c.id IS NULL OR i.id IS NULL OR s.id IS NULL OR c.merged_into_customer_id IS NOT NULL OR i.customer_id IS DISTINCT FROM c.id OR s.project_interest_id IS DISTINCT FROM i.id
   OR c.owner_user_id IS DISTINCT FROM (binding->>'customerOwnerId')::uuid OR i.owner_user_id IS DISTINCT FROM (binding->>'interestOwnerId')::uuid
   OR c.lifecycle_revision IS DISTINCT FROM (binding->>'customerRevision')::uuid OR i.lifecycle_revision IS DISTINCT FROM (binding->>'interestRevision')::uuid
   OR to_jsonb(s) IS DISTINCT FROM before_image->'sale'
   OR coalesce(CASE WHEN dc.sale_id IS NULL THEN NULL ELSE to_jsonb(dc) END,'null'::jsonb) IS DISTINCT FROM before_image->'details' OR coalesce(CASE WHEN fc.sale_id IS NULL THEN NULL ELSE to_jsonb(fc) END,'null'::jsonb) IS DISTINCT FROM before_image->'forecast'
  THEN RAISE EXCEPTION 'IMPORT_DETAILS_STALE_BINDING'; END IF;
  -- This adapter intentionally refuses status correction, live/new booking and occupied-plot mutation.
  IF s.external_booking_id IS NULL OR c.record_origin<>'legacy_import' OR s.crm_stage IS DISTINCT FROM patch->>'sourceStage'
   OR NOT (s.crm_stage IN ('booked','contracted','downpayment','document_prep','loan_submitted','loan_rejected','loan_approved','transfer_pending')
     OR (s.crm_stage='transferred' AND patch->'salePriceSatang'='null'::jsonb AND jsonb_typeof(patch->'expectedTransferDate')='string'))
   OR s.plot_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.plots WHERE id=s.plot_id AND project_name=i.project_name)
  THEN RAISE EXCEPTION 'IMPORT_DETAILS_SEPARATE_LIFECYCLE_REVIEW_REQUIRED'; END IF;
  IF sales_private.crm_booking_imported_history(to_jsonb(s)) IS NULL THEN RAISE EXCEPTION 'IMPORT_DETAILS_SEPARATE_LIFECYCLE_REVIEW_REQUIRED'; END IF;
  -- Lock trusted owners, and reject closed/deactivated mappings. Never assign source closing staff to the Customer.
  PERFORM 1 FROM sales_private.crm_user_roles WHERE user_id IN(c.owner_user_id,i.owner_user_id) ORDER BY user_id FOR SHARE;
  IF EXISTS(SELECT 1 FROM unnest(ARRAY[c.owner_user_id,i.owner_user_id]) u WHERE NOT EXISTS(SELECT 1 FROM sales_private.crm_user_roles WHERE user_id=u AND role='sales' AND is_active))
   THEN RAISE EXCEPTION 'IMPORT_DETAILS_OWNER_CHANGED'; END IF;
  canonical_before:=to_jsonb(s); recorded:=clock_timestamp(); ndc:=dc; nfc:=fc;
  IF patch->'salePriceSatang'<>'null'::jsonb THEN
   IF (patch->>'salePriceSatang' ~ '^[1-9][0-9]{0,10}$') IS DISTINCT FROM true OR (patch->>'salePriceSatang')::numeric>99999999999 THEN RAISE EXCEPTION 'IMPORT_DETAILS_INVALID'; END IF;
   price:=(patch->>'salePriceSatang')::numeric/100;
   IF price IS DISTINCT FROM sales_private.crm_effective_sale_price(s.id) THEN
    ndc.sale_id:=s.id; ndc.sale_price:=price;
    -- Import unknown bank preserves the existing effective value, including an explicit operational NULL.
    ndc.bank_name:=CASE WHEN dc.sale_id IS NULL THEN NULLIF(sales_private.crm_customer_deal_details_trim(s.bank_name),'') ELSE dc.bank_name END;
    ndc.revision:=gen_random_uuid(); ndc.actor_user_id:=actor; ndc.reason:='Reviewed source details: '||b.dataset_key; ndc.recorded_at:=recorded;
    INSERT INTO sales_private.customer_deal_details_permits VALUES(txid_current(),pg_backend_pid(),actor,'deal',s.id,CASE WHEN dc.sale_id IS NULL THEN NULL ELSE to_jsonb(dc) END,to_jsonb(ndc));
    IF dc.sale_id IS NULL THEN INSERT INTO sales_private.deal_details_corrections SELECT ndc.*;
    ELSE UPDATE sales_private.deal_details_corrections SET sale_price=ndc.sale_price,bank_name=ndc.bank_name,revision=ndc.revision,actor_user_id=actor,reason=ndc.reason,recorded_at=recorded WHERE sale_id=s.id; END IF;
    DELETE FROM sales_private.customer_deal_details_permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid() AND entity_type='deal' AND entity_id=s.id;
   END IF;
  END IF;
  IF patch->'expectedTransferDate'<>'null'::jsonb THEN
   IF (patch->>'expectedTransferDate' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') IS DISTINCT FROM true OR NOT pg_input_is_valid(patch->>'expectedTransferDate','date') THEN RAISE EXCEPTION 'IMPORT_DETAILS_INVALID'; END IF;
   forecast:=(patch->>'expectedTransferDate')::date;
   nfc.sale_id:=s.id; nfc.expected_transfer_date:=forecast; nfc.revision:=gen_random_uuid(); nfc.batch_id:=b.id; nfc.reviewer_id:=actor; nfc.recorded_at:=recorded;
   INSERT INTO sales_import_private.forecast_permits VALUES(txid_current(),pg_backend_pid(),actor,s.id,CASE WHEN fc.sale_id IS NULL THEN NULL ELSE to_jsonb(fc) END,to_jsonb(nfc));
   IF fc.sale_id IS NULL THEN INSERT INTO sales_import_private.forecast_corrections SELECT nfc.*;
   ELSE UPDATE sales_import_private.forecast_corrections SET expected_transfer_date=forecast,revision=nfc.revision,batch_id=b.id,reviewer_id=actor,recorded_at=recorded WHERE sale_id=s.id; END IF;
   DELETE FROM sales_import_private.forecast_permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid() AND sale_id=s.id;
  END IF;
  INSERT INTO sales_import_private.detail_events VALUES(b.id,(r->>'sourceRow')::integer,r->>'sourceKey',r->>'rowSha256',s.id,
   CASE WHEN dc.sale_id IS NULL THEN NULL ELSE to_jsonb(dc) END,CASE WHEN ndc.sale_id IS NULL THEN NULL ELSE to_jsonb(ndc) END,
   CASE WHEN fc.sale_id IS NULL THEN NULL ELSE to_jsonb(fc) END,CASE WHEN nfc.sale_id IS NULL THEN NULL ELSE to_jsonb(nfc) END);
  IF canonical_before IS DISTINCT FROM (SELECT to_jsonb(ss) FROM public.sales ss WHERE id=s.id) THEN RAISE EXCEPTION 'IMPORT_DETAILS_SOURCE_CHANGED'; END IF;
  changed:=changed+1;
 END LOOP;
 RETURN jsonb_build_object('batchId',b.id,'records',changed,'replayed',false,'sourceChanged',false);
END;
$apply$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA sales_import_private FROM PUBLIC,anon,authenticated;

-- Optional Excel reader adapter is added only against the exact reviewed source body.
-- The new getter is private and called through the existing role-checked projection.
DO $forecast_reader$
DECLARE fn oid:=to_regprocedure('crm_excel_private.evidence(text)'); body text; definition text; settings text[];
 owner_name text; secured boolean;
 old_text text:='s.payload->''reviewedHistory''->>''expectedTransferDate'' AS source_day';
 new_text text:='sales_import_private.expected_transfer_date(sale.id,s.payload->''reviewedHistory''->>''expectedTransferDate'') AS source_day';
BEGIN
 IF fn IS NULL THEN RETURN; END IF;
 SELECT replace(p.prosrc,E'\r\n',E'\n'),pg_get_functiondef(p.oid),pg_get_userbyid(p.proowner),p.prosecdef,p.proconfig INTO body,definition,owner_name,secured,settings FROM pg_proc p WHERE oid=fn;
 IF md5(body)<>'738a8d0787d234d2fd06dce3966bdc11' OR owner_name<>current_user OR NOT secured
  OR settings IS DISTINCT FROM ARRAY['search_path=pg_catalog','TimeZone=UTC','DateStyle=ISO, YMD']
  OR (length(body)-length(replace(body,old_text,'')))/length(old_text)<>1
 THEN RAISE EXCEPTION 'IMPORT_DETAILS_READER_REVIEW_REQUIRED'; END IF;
 EXECUTE replace(definition,old_text,new_text);
END;
$forecast_reader$;

-- DESIGN ONLY. Exact reviewed source corrections, not an operational cancellation command.
-- No feature activation, fabricated event timestamps, snapshot rewrites or public grants.
-- Requires canonical base/04/05/18/19/20/21/22/26 and reviewed external seal.

-- Design sentinel cleared only in this reviewed installation artifact.

CREATE SCHEMA sales_revision_private;
REVOKE ALL ON SCHEMA sales_revision_private FROM PUBLIC,anon,authenticated;
CREATE TABLE sales_revision_private.batches (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), dataset_key text UNIQUE NOT NULL,
 payload jsonb NOT NULL, reviewer_id uuid NOT NULL REFERENCES auth.users(id), recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE sales_revision_private.events (
 id uuid PRIMARY KEY, batch_id uuid NOT NULL REFERENCES sales_revision_private.batches(id),
 source_row integer NOT NULL CHECK(source_row BETWEEN 2 AND 50000),
 source_key text NOT NULL CHECK(source_key ~ '^[a-f0-9]{64}$'), row_sha256 text NOT NULL CHECK(row_sha256 ~ '^[a-f0-9]{64}$'),
 operation text NOT NULL CHECK(operation IN ('cancel','create_booking')),
 sale_id uuid NOT NULL REFERENCES public.sales(id) DEFERRABLE INITIALLY DEFERRED,
 customer_id uuid NOT NULL REFERENCES public.sales_customers(id), interest_id uuid NOT NULL,
 plot_id text NOT NULL REFERENCES public.plots(id), before_sale jsonb, after_sale jsonb NOT NULL, source_history jsonb NOT NULL,
 booked_day date, cancelled_day date, expected_transfer_day date,
 UNIQUE(batch_id,source_row), UNIQUE(batch_id,sale_id), UNIQUE(source_key,operation),
 FOREIGN KEY(interest_id,customer_id) REFERENCES public.lead_project_interests(id,customer_id),
 CHECK(booked_day IS NULL OR booked_day BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),
 CHECK(cancelled_day IS NULL OR cancelled_day BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),
 CHECK(expected_transfer_day IS NULL OR expected_transfer_day BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),
 CHECK(cancelled_day IS NULL OR booked_day IS NULL OR cancelled_day>=booked_day)
);
CREATE TABLE sales_revision_private.permits (
 transaction_id bigint NOT NULL, backend_pid integer NOT NULL, actor_id uuid NOT NULL,
 event_id uuid NOT NULL REFERENCES sales_revision_private.events(id), operation text NOT NULL,
 old_row jsonb, new_row jsonb NOT NULL, PRIMARY KEY(transaction_id,backend_pid,event_id)
);
-- One complete OLD/NEW plot and inventory permit, scoped to this exact event.
-- It remains live through the existing Sale->Plot sync trigger only.
CREATE TABLE sales_revision_private.plot_permits (
 transaction_id bigint NOT NULL, backend_pid integer NOT NULL, actor_id uuid NOT NULL,
 event_id uuid NOT NULL REFERENCES sales_revision_private.events(id),
 old_plot jsonb NOT NULL, new_plot jsonb NOT NULL, after_inventory jsonb NOT NULL,
 PRIMARY KEY(transaction_id,backend_pid,event_id)
);
ALTER TABLE sales_revision_private.batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_revision_private.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_revision_private.permits ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_revision_private.plot_permits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA sales_revision_private FROM PUBLIC,anon,authenticated;
CREATE FUNCTION sales_revision_private.sealed() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'HISTORICAL_REVISION_SEALED'; END; $$;
CREATE TRIGGER historical_batches_sealed BEFORE UPDATE OR DELETE OR TRUNCATE ON sales_revision_private.batches FOR EACH STATEMENT EXECUTE FUNCTION sales_revision_private.sealed();
CREATE TRIGGER historical_events_sealed BEFORE UPDATE OR DELETE OR TRUNCATE ON sales_revision_private.events FOR EACH STATEMENT EXECUTE FUNCTION sales_revision_private.sealed();
CREATE FUNCTION sales_revision_private.operator_insert() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF current_user IS DISTINCT FROM (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid=TG_RELID)
  OR auth.uid() IS NULL OR public.crm_v2_role() IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'HISTORICAL_REVISION_FORBIDDEN'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER historical_batch_insert BEFORE INSERT ON sales_revision_private.batches FOR EACH ROW EXECUTE FUNCTION sales_revision_private.operator_insert();
CREATE TRIGGER historical_event_insert BEFORE INSERT ON sales_revision_private.events FOR EACH ROW EXECUTE FUNCTION sales_revision_private.operator_insert();
ALTER TABLE public.sales ADD COLUMN historical_import_id uuid UNIQUE REFERENCES sales_revision_private.events(id),
 ADD COLUMN historical_revision_id uuid UNIQUE REFERENCES sales_revision_private.events(id);

-- Keep every old CHECK arm. Reject unknown constraint bodies before extending only the provenance arm.
DO $constraints$
DECLARE d text; marker text;
BEGIN
 ALTER TABLE public.sales ADD CONSTRAINT historical_expected_fields CHECK (
  project_interest_id IS NULL OR (crm_stage IS NOT NULL AND booking_route IS NOT NULL AND (booking_round IS NOT NULL OR external_booking_id IS NOT NULL))) NOT VALID;
 marker:=replace((SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public.sales'::regclass AND conname='historical_expected_fields'),' NOT VALID','');
 SELECT pg_get_constraintdef(oid) INTO d FROM pg_constraint WHERE conrelid='public.sales'::regclass AND conname='sales_v2_fields_check';
 IF d IS DISTINCT FROM marker THEN RAISE EXCEPTION 'HISTORICAL_REVISION_CONSTRAINT_REVIEW_REQUIRED'; END IF;
 ALTER TABLE public.sales DROP CONSTRAINT historical_expected_fields;
 ALTER TABLE public.sales DROP CONSTRAINT sales_v2_fields_check;
 ALTER TABLE public.sales ADD CONSTRAINT sales_v2_fields_check CHECK(project_interest_id IS NULL OR (crm_stage IS NOT NULL AND booking_route IS NOT NULL AND (booking_round IS NOT NULL OR external_booking_id IS NOT NULL OR historical_import_id IS NOT NULL)));
 ALTER TABLE public.sales ADD CONSTRAINT historical_expected_cancel CHECK (
 crm_stage IS DISTINCT FROM 'cancelled' OR (coalesce(booking_route='legacy_import',false) AND (legacy_cancellation_batch_id IS NOT NULL OR (external_booking_id IS NOT NULL AND coalesce(external_source_stage='cancelled',false)))) OR (cancelled_at IS NOT NULL AND cancellation_category IS NOT NULL AND cancellation_reason IS NOT NULL AND btrim(cancellation_reason)<>'')) NOT VALID;
 marker:=replace((SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public.sales'::regclass AND conname='historical_expected_cancel'),' NOT VALID','');
 SELECT pg_get_constraintdef(oid) INTO d FROM pg_constraint WHERE conrelid='public.sales'::regclass AND conname='sales_v2_cancellation_check';
 IF d IS DISTINCT FROM marker THEN RAISE EXCEPTION 'HISTORICAL_REVISION_CONSTRAINT_REVIEW_REQUIRED'; END IF;
 ALTER TABLE public.sales DROP CONSTRAINT historical_expected_cancel;
 ALTER TABLE public.sales DROP CONSTRAINT sales_v2_cancellation_check;
 EXECUTE 'ALTER TABLE public.sales ADD CONSTRAINT sales_v2_cancellation_check '||replace(d,'CHECK (','CHECK ((historical_revision_id IS NOT NULL) OR ');
END;
$constraints$;

CREATE FUNCTION sales_revision_private.allowed(p_op text,p_old jsonb,p_new jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 RETURN p_op IN ('INSERT','UPDATE') AND public.crm_v2_role()='admin' AND EXISTS(
  SELECT 1 FROM sales_revision_private.permits p JOIN sales_revision_private.events e ON e.id=p.event_id
  WHERE p.transaction_id=txid_current() AND p.backend_pid=pg_backend_pid() AND p.actor_id=auth.uid()
   AND p.old_row IS NOT DISTINCT FROM p_old AND p.new_row=p_new AND e.after_sale=p_new
   AND e.before_sale IS NOT DISTINCT FROM p_old AND e.sale_id=(p_new->>'id')::uuid
   AND p.operation=CASE WHEN p_op='INSERT' THEN 'create_booking' ELSE 'cancel' END
   AND e.operation=p.operation);
END; $$;

CREATE FUNCTION sales_revision_private.plot_allowed(p_old jsonb,p_new jsonb)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT public.crm_v2_role()='admin' AND EXISTS(
  SELECT 1 FROM sales_revision_private.plot_permits p JOIN sales_revision_private.events e ON e.id=p.event_id
  WHERE p.transaction_id=txid_current() AND p.backend_pid=pg_backend_pid() AND p.actor_id=auth.uid()
   AND p.old_plot=p_old AND p.new_plot=p_new AND e.plot_id=p_new->>'id'
   AND p.new_plot=p.old_plot||jsonb_build_object('has_customer',e.operation='create_booking')
   AND EXISTS(SELECT 1 FROM public.sales s WHERE s.id=e.sale_id AND to_jsonb(s)=e.after_sale)
   AND p.after_inventory=(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM public.sales s WHERE s.plot_id=e.plot_id)
 );
$$;

CREATE FUNCTION sales_revision_private.assert_stock_catalog()
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE proc oid:=to_regprocedure('crm_external_private.guard_booking_plot_stock()'); sync_proc oid:=to_regprocedure('public.sync_plot_customer_status()');
 updated_proc oid:=to_regprocedure('public.update_sales_updated_at_column()');
BEGIN
 IF proc IS NULL OR sync_proc IS NULL OR updated_proc IS NULL
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=proc AND pg_get_userbyid(proowner)=current_user AND prosecdef
    AND proconfig=ARRAY['search_path=""'] AND md5(replace(prosrc,E'\r\n',E'\n')) IN('eb32ae486d63956e802027ec8ce6fd28','a498131001bda620bc0becbd867acf20'))
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.plots'::regclass AND tgfoid=proc AND NOT tgisinternal AND tgenabled IN('O','A') AND tgtype=23)
  -- Captured live and local migration bodies differ only in comments/spacing;
  -- all360 tokens (including literal contents) were compared before pinning.
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=sync_proc AND md5(replace(prosrc,E'\r\n',E'\n')) IN('d5d2314011924a3de7d7ef5cd33d1900','d14049d669231cf3b2435b42c869e011'))
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.sales'::regclass AND tgfoid=sync_proc AND tgname='trigger_sync_plot_customer_status'
    AND NOT tgisinternal AND tgenabled IN('O','A') AND tgtype=29)
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=updated_proc AND pg_get_userbyid(proowner)=current_user AND NOT prosecdef AND proconfig IS NULL
    AND md5(replace(prosrc,E'\r\n',E'\n'))='06bcf30ac3d0a7f279a54cbf228a7bec')
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.sales'::regclass AND tgfoid=updated_proc AND tgname='update_sales_table_updated_at'
    AND NOT tgisinternal AND tgenabled IN('O','A') AND tgtype=19)
 THEN RAISE EXCEPTION 'HISTORICAL_REVISION_STOCK_REVIEW_REQUIRED'; END IF;
END; $$;

CREATE FUNCTION sales_revision_private.apply(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog SET timezone='UTC' AS $apply$
DECLARE actor uuid:=auth.uid(); b sales_revision_private.batches%ROWTYPE; inserted uuid;
 r jsonb; bind jsonb; old jsonb; patch jsonb; c public.sales_customers%ROWTYPE; i public.lead_project_interests%ROWTYPE;
 s public.sales%ROWTYPE; ns public.sales%ROWTYPE; p public.plots%ROWTYPE; e sales_revision_private.events%ROWTYPE;
 dc sales_private.deal_details_corrections%ROWTYPE; ndc sales_private.deal_details_corrections%ROWTYPE;
 inventory jsonb; price numeric; day text; history jsonb; entry jsonb; op text; total integer:=0;
BEGIN
 IF actor IS NULL OR current_user IS DISTINCT FROM (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid='sales_revision_private.batches'::regclass) THEN RAISE EXCEPTION 'HISTORICAL_REVISION_FORBIDDEN'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('crm-booking-command',0));
 PERFORM 1 FROM sales_private.crm_user_roles WHERE user_id=actor AND role='admin' AND is_active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'HISTORICAL_REVISION_FORBIDDEN'; END IF;
 PERFORM sales_revision_private.assert_stock_catalog();
 PERFORM sales_import_private.exact_object(p_payload,ARRAY['version','datasetKey','sourceSha256','reviewSha256','records','leadReplayAllowed']);
 IF p_payload->>'version' IS DISTINCT FROM 'reviewed-historical-sale-revision-v1'
  OR p_payload->'leadReplayAllowed' IS DISTINCT FROM 'false'::jsonb
  OR jsonb_typeof(p_payload->'datasetKey') IS DISTINCT FROM 'string' OR length(p_payload->>'datasetKey') NOT BETWEEN 1 AND 200
  OR p_payload->>'datasetKey'<>btrim(p_payload->>'datasetKey') OR p_payload->>'datasetKey' ~ '[[:cntrl:]]'
  OR jsonb_typeof(p_payload->'sourceSha256') IS DISTINCT FROM 'string' OR jsonb_typeof(p_payload->'reviewSha256') IS DISTINCT FROM 'string'
  OR (p_payload->>'sourceSha256' ~ '^[a-f0-9]{64}$') IS DISTINCT FROM true OR (p_payload->>'reviewSha256' ~ '^[a-f0-9]{64}$') IS DISTINCT FROM true
  OR jsonb_typeof(p_payload->'records') IS DISTINCT FROM 'array' OR octet_length(p_payload::text)>8388608
 THEN RAISE EXCEPTION 'HISTORICAL_REVISION_INVALID'; END IF;
 IF jsonb_array_length(p_payload->'records') NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'HISTORICAL_REVISION_INVALID'; END IF;
 -- Full-table inventory lock also protects against unlinked legacy writers which do not take the advisory lock.
 LOCK TABLE public.plots,public.sales IN SHARE ROW EXCLUSIVE MODE;
 INSERT INTO sales_revision_private.batches(dataset_key,payload,reviewer_id) VALUES(p_payload->>'datasetKey',p_payload,actor)
 ON CONFLICT(dataset_key) DO NOTHING RETURNING id INTO inserted;
 SELECT * INTO STRICT b FROM sales_revision_private.batches WHERE dataset_key=p_payload->>'datasetKey' FOR UPDATE;
 IF b.payload IS DISTINCT FROM p_payload THEN RAISE EXCEPTION 'HISTORICAL_REVISION_REPLAY_CONFLICT'; END IF;
 IF inserted IS NULL THEN
  PERFORM 1 FROM sales_private.crm_user_roles WHERE user_id IN(SELECT current_customer.owner_user_id FROM sales_revision_private.events source_event JOIN public.sales_customers current_customer ON current_customer.id=source_event.customer_id WHERE source_event.batch_id=b.id UNION SELECT current_interest.owner_user_id FROM sales_revision_private.events source_event JOIN public.lead_project_interests current_interest ON current_interest.id=source_event.interest_id WHERE source_event.batch_id=b.id UNION SELECT (source_event.after_sale->>'closing_sales_user_id')::uuid FROM sales_revision_private.events source_event WHERE source_event.batch_id=b.id) ORDER BY user_id FOR SHARE;
  IF EXISTS(SELECT 1 FROM sales_revision_private.events source_event JOIN public.sales_customers current_customer ON current_customer.id=source_event.customer_id JOIN public.lead_project_interests current_interest ON current_interest.id=source_event.interest_id WHERE source_event.batch_id=b.id AND (current_customer.merged_into_customer_id IS NOT NULL OR current_interest.customer_id IS DISTINCT FROM current_customer.id OR NOT EXISTS(SELECT 1 FROM sales_private.crm_user_roles WHERE user_id=current_customer.owner_user_id AND role='sales' AND is_active) OR NOT EXISTS(SELECT 1 FROM sales_private.crm_user_roles WHERE user_id=current_interest.owner_user_id AND role='sales' AND is_active) OR NOT EXISTS(SELECT 1 FROM sales_private.crm_user_roles WHERE user_id=(source_event.after_sale->>'closing_sales_user_id')::uuid AND role='sales' AND is_active))) THEN RAISE EXCEPTION 'HISTORICAL_REVISION_OWNER_CHANGED'; END IF;
  RETURN jsonb_build_object('batchId',b.id,'records',jsonb_array_length(p_payload->'records'),'replayed',true,'bindings',(SELECT jsonb_agg(jsonb_build_object('sourceRow',source_row,'saleId',sale_id) ORDER BY source_row) FROM sales_revision_private.events WHERE batch_id=b.id));
 END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(p_payload->'records') ORDER BY value->'binding'->>'plotId',value->'binding'->>'saleId' LOOP
  PERFORM sales_import_private.exact_object(r,ARRAY['sourceRow','sourceKey','rowSha256','operation','binding','before','patch','history']);
  bind:=r->'binding'; old:=r->'before'; patch:=r->'patch'; op:=r->>'operation';
  PERFORM sales_import_private.exact_object(bind,ARRAY['saleId','customerId','interestId','plotId']);
  PERFORM sales_import_private.exact_object(old,ARRAY['customer','interest','sale','plot','inventory','details','forecast']);
  PERFORM sales_import_private.exact_object(patch,ARRAY['bookedDate','cancelledDate','expectedTransferDate','salePriceSatang','closingSalesId']);
  IF jsonb_typeof(r->'history') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'HISTORICAL_REVISION_INVALID'; END IF;
  IF jsonb_array_length(r->'history') NOT BETWEEN 1 AND 3 THEN RAISE EXCEPTION 'HISTORICAL_REVISION_INVALID'; END IF;
  FOR entry IN SELECT value FROM jsonb_array_elements(r->'history') LOOP
   PERFORM sales_import_private.exact_object(entry,ARRAY['kind','date','precision']);
   IF entry->>'kind' NOT IN ('visited','booked','cancelled') OR entry->>'kind' IS NULL
    OR (((entry->>'precision'='unknown' AND entry->'date'='null'::jsonb) OR
     (entry->>'precision'='day' AND jsonb_typeof(entry->'date')='string' AND entry->>'date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND pg_input_is_valid(entry->>'date','date'))) IS DISTINCT FROM true)
   THEN RAISE EXCEPTION 'HISTORICAL_REVISION_INVALID'; END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(r->'history') x GROUP BY x->>'kind' HAVING count(*)>1)
   OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r->'history') x WHERE x->>'kind'='booked' AND x->'date'=patch->'bookedDate')
   OR (op='cancel' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r->'history') x WHERE x->>'kind'='cancelled' AND x->'date'=patch->'cancelledDate'))
   OR (op='create_booking' AND EXISTS(SELECT 1 FROM jsonb_array_elements(r->'history') x WHERE x->>'kind'='cancelled'))
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(r->'history') x WHERE x->>'kind'='visited' AND (x->>'date')::date>(patch->>'bookedDate')::date)
  THEN RAISE EXCEPTION 'HISTORICAL_REVISION_INVALID'; END IF;
  IF jsonb_typeof(r->'sourceRow')<>'number' OR (r->>'sourceRow' ~ '^[0-9]+$') IS DISTINCT FROM true
   OR jsonb_typeof(r->'sourceKey') IS DISTINCT FROM 'string' OR jsonb_typeof(r->'rowSha256') IS DISTINCT FROM 'string'
   OR (r->>'sourceKey' ~ '^[a-f0-9]{64}$') IS DISTINCT FROM true OR (r->>'rowSha256' ~ '^[a-f0-9]{64}$') IS DISTINCT FROM true
   OR op NOT IN ('cancel','create_booking') OR op IS NULL
   OR jsonb_typeof(bind->'plotId') IS DISTINCT FROM 'string' OR length(bind->>'plotId') NOT BETWEEN 1 AND 200
  THEN RAISE EXCEPTION 'HISTORICAL_REVISION_INVALID'; END IF;
  PERFORM sales_private.crm_booking_uuid(bind->'saleId',op='create_booking'); PERFORM sales_private.crm_booking_uuid(bind->'customerId'); PERFORM sales_private.crm_booking_uuid(bind->'interestId');
  IF op='create_booking' AND bind->'saleId' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'HISTORICAL_REVISION_INVALID'; END IF;
  PERFORM sales_private.crm_booking_uuid(patch->'closingSalesId');
  FOR day IN SELECT value#>>'{}' FROM jsonb_each(patch) WHERE key IN ('bookedDate','cancelledDate','expectedTransferDate') LOOP
   IF day IS NOT NULL AND (day !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR NOT pg_input_is_valid(day,'date') OR day::date NOT BETWEEN DATE '0001-01-01' AND DATE '9999-12-31') THEN RAISE EXCEPTION 'HISTORICAL_REVISION_INVALID'; END IF;
  END LOOP;
  IF jsonb_typeof(patch->'salePriceSatang') NOT IN ('number','null') OR (patch->'salePriceSatang'<>'null'::jsonb AND ((patch->>'salePriceSatang' ~ '^[1-9][0-9]{0,10}$') IS DISTINCT FROM true OR (patch->>'salePriceSatang')::numeric>99999999999)) THEN RAISE EXCEPTION 'HISTORICAL_REVISION_INVALID'; END IF;
  SELECT * INTO c FROM public.sales_customers WHERE id=(bind->>'customerId')::uuid FOR UPDATE;
  SELECT * INTO i FROM public.lead_project_interests WHERE id=(bind->>'interestId')::uuid FOR UPDATE;
  SELECT * INTO s FROM public.sales WHERE id=(bind->>'saleId')::uuid FOR UPDATE;
  SELECT * INTO p FROM public.plots WHERE id=bind->>'plotId' FOR UPDATE;
  SELECT * INTO dc FROM sales_private.deal_details_corrections WHERE sale_id=(bind->>'saleId')::uuid FOR UPDATE;
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id),'[]'::jsonb) INTO inventory FROM public.sales x WHERE x.plot_id=p.id;
  IF c.id IS NULL OR i.id IS NULL OR p.id IS NULL OR c.merged_into_customer_id IS NOT NULL OR c.record_origin<>'legacy_import'
   OR i.customer_id IS DISTINCT FROM c.id OR p.project_name IS DISTINCT FROM i.project_name
   OR NOT EXISTS(SELECT 1 FROM public.projects WHERE name=i.project_name AND is_closed IS DISTINCT FROM true)
   OR to_jsonb(c) IS DISTINCT FROM old->'customer' OR to_jsonb(i) IS DISTINCT FROM old->'interest' OR to_jsonb(p) IS DISTINCT FROM old->'plot'
   OR (CASE WHEN s.id IS NULL THEN 'null'::jsonb ELSE to_jsonb(s) END) IS DISTINCT FROM old->'sale' OR inventory IS DISTINCT FROM old->'inventory'
   OR (CASE WHEN dc.sale_id IS NULL THEN 'null'::jsonb ELSE to_jsonb(dc) END) IS DISTINCT FROM old->'details'
   OR coalesce((SELECT to_jsonb(f) FROM sales_import_private.forecast_corrections f WHERE sale_id=(bind->>'saleId')::uuid),'null') IS DISTINCT FROM old->'forecast'
  THEN RAISE EXCEPTION 'HISTORICAL_REVISION_STALE'; END IF;
  PERFORM 1 FROM sales_private.crm_user_roles WHERE user_id IN(c.owner_user_id,i.owner_user_id,(patch->>'closingSalesId')::uuid) ORDER BY user_id FOR SHARE;
  IF EXISTS(SELECT 1 FROM unnest(ARRAY[c.owner_user_id,i.owner_user_id,(patch->>'closingSalesId')::uuid]) u WHERE NOT EXISTS(SELECT 1 FROM sales_private.crm_user_roles WHERE user_id=u AND role='sales' AND is_active)) THEN RAISE EXCEPTION 'HISTORICAL_REVISION_OWNER_CHANGED'; END IF;
  e.id:=gen_random_uuid(); e.batch_id:=b.id; e.source_row:=(r->>'sourceRow')::integer; e.source_key:=r->>'sourceKey';e.row_sha256:=r->>'rowSha256';e.operation:=op;
  e.sale_id:=CASE WHEN op='create_booking' THEN gen_random_uuid() ELSE (bind->>'saleId')::uuid END;e.customer_id:=c.id;e.interest_id:=i.id;e.plot_id:=p.id;
  e.booked_day:=(patch->>'bookedDate')::date;e.cancelled_day:=(patch->>'cancelledDate')::date;e.expected_transfer_day:=(patch->>'expectedTransferDate')::date;
  e.before_sale:=CASE WHEN s.id IS NULL THEN NULL ELSE to_jsonb(s) END;
  e.source_history:=r->'history';
  IF op='cancel' THEN
   IF patch->'expectedTransferDate' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'HISTORICAL_REVISION_FORECAST_REVIEW_REQUIRED'; END IF;
   IF s.id IS NULL OR s.project_interest_id IS DISTINCT FROM i.id OR s.plot_id IS DISTINCT FROM p.id OR s.crm_stage IS DISTINCT FROM 'booked'
    OR s.booked_at IS NOT NULL OR s.contracted_at IS NOT NULL OR s.cancelled_at IS NOT NULL
    OR s.transferred_at IS NOT NULL OR s.crm_handover_at IS NOT NULL OR s.crm_transfer_date IS NOT NULL OR s.crm_handover_date IS NOT NULL
    OR s.historical_revision_id IS NOT NULL OR s.closing_sales_user_id IS DISTINCT FROM (patch->>'closingSalesId')::uuid
    OR EXISTS(SELECT 1 FROM public.loan_attempts WHERE sale_id=s.id)
    OR EXISTS(SELECT 1 FROM sales_private.post_booking_events WHERE sale_id=s.id)
   THEN RAISE EXCEPTION 'HISTORICAL_REVISION_OPERATIONAL_HISTORY'; END IF;
   history:=sales_private.crm_booking_imported_history(to_jsonb(s));
   IF history IS NULL OR history->'sourceRow' IS DISTINCT FROM r->'sourceRow' OR history->>'bookedDate' IS DISTINCT FROM patch->>'bookedDate' OR e.cancelled_day IS NULL THEN RAISE EXCEPTION 'HISTORICAL_REVISION_PROVENANCE'; END IF;
   ns:=s; ns.crm_stage:='cancelled'; ns.contract_status:='Cancelled';ns.historical_revision_id:=e.id;ns.booking_revision:=gen_random_uuid();
   -- This is the actual write timestamp, not an invented historical event day.
   -- Set it in the UPDATE itself so earlier sealed BEFORE triggers observe the
   -- same complete NEW row that the unchanged later updater will produce.
   ns.updated_at:=transaction_timestamp();
  ELSE
   IF s.id IS NOT NULL OR old->'sale'<>'null'::jsonb OR dc.sale_id IS NOT NULL OR old->'forecast'<>'null'::jsonb
    OR e.cancelled_day IS NOT NULL OR patch->'salePriceSatang'='null'::jsonb
    OR EXISTS(SELECT 1 FROM public.sales x WHERE x.plot_id=p.id AND coalesce(x.crm_stage,lower(x.contract_status),'unknown')<>'cancelled')
    OR coalesce(p.has_customer,false) OR lower(btrim(coalesce(p.sale_status,''))) NOT IN ('','active','normal','ready_for_sale','available','vacant')
   THEN RAISE EXCEPTION 'HISTORICAL_REVISION_OCCUPIED'; END IF;
   ns:=NULL;ns.id:=e.sale_id;ns.project_interest_id:=i.id;ns.plot_id:=p.id;ns.crm_stage:='booked';ns.contract_status:='Reserved';
   ns.booking_route:='legacy_import';ns.booking_route_reason:='Reviewed historical booking: '||e.source_key;ns.booking_revision:=gen_random_uuid();
   ns.historical_import_id:=e.id;ns.sale_price:=(patch->>'salePriceSatang')::numeric/100;ns.expected_transfer_date:=e.expected_transfer_day;
   ns.closing_sales_user_id:=(patch->>'closingSalesId')::uuid;
  END IF;
  e.after_sale:=to_jsonb(ns);
  INSERT INTO sales_revision_private.events SELECT e.*;
  INSERT INTO sales_revision_private.permits VALUES(txid_current(),pg_backend_pid(),actor,e.id,op,e.before_sale,e.after_sale);
  INSERT INTO sales_revision_private.plot_permits VALUES(txid_current(),pg_backend_pid(),actor,e.id,
   to_jsonb(p),to_jsonb(p)||jsonb_build_object('has_customer',op='create_booking'),
   (SELECT jsonb_agg(value ORDER BY value->>'id') FROM (
    SELECT value FROM jsonb_array_elements(inventory) WHERE value->>'id'<>e.sale_id::text
    UNION ALL SELECT e.after_sale) expected));
  INSERT INTO sales_private.booking_write_permits VALUES(txid_current(),pg_backend_pid());
  IF op='cancel' THEN UPDATE public.sales SET crm_stage=ns.crm_stage,contract_status=ns.contract_status,historical_revision_id=ns.historical_revision_id,booking_revision=ns.booking_revision,updated_at=ns.updated_at WHERE id=ns.id;
  ELSE INSERT INTO public.sales SELECT ns.*; END IF;
  DELETE FROM sales_private.booking_write_permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid();
  DELETE FROM sales_revision_private.permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid();
  IF patch->'salePriceSatang'<>'null'::jsonb AND op='cancel' THEN
   price:=(patch->>'salePriceSatang')::numeric/100;
   ndc:=dc;ndc.sale_id:=s.id;ndc.sale_price:=price;ndc.bank_name:=CASE WHEN dc.sale_id IS NULL THEN NULLIF(sales_private.crm_customer_deal_details_trim(s.bank_name),'') ELSE dc.bank_name END;
   ndc.revision:=gen_random_uuid();ndc.actor_user_id:=actor;ndc.reason:='Reviewed historical cancellation: '||b.dataset_key;ndc.recorded_at:=clock_timestamp();
   INSERT INTO sales_private.customer_deal_details_permits VALUES(txid_current(),pg_backend_pid(),actor,'deal',s.id,CASE WHEN dc.sale_id IS NULL THEN NULL ELSE to_jsonb(dc) END,to_jsonb(ndc));
   IF dc.sale_id IS NULL THEN INSERT INTO sales_private.deal_details_corrections SELECT ndc.*;
   ELSE UPDATE sales_private.deal_details_corrections SET sale_price=ndc.sale_price,bank_name=ndc.bank_name,revision=ndc.revision,actor_user_id=ndc.actor_user_id,reason=ndc.reason,recorded_at=ndc.recorded_at WHERE sale_id=ndc.sale_id; END IF;
   DELETE FROM sales_private.customer_deal_details_permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid();
  END IF;
  -- Cancellation may release only its own occupied record; conflicting/transferred ownership never becomes stock.
  IF op='cancel' AND EXISTS(SELECT 1 FROM public.sales x WHERE x.plot_id=p.id AND x.id<>s.id AND coalesce(x.crm_stage,lower(x.contract_status),'unknown')<>'cancelled') THEN RAISE EXCEPTION 'HISTORICAL_REVISION_OCCUPIED'; END IF;
  -- The unchanged legacy sync must produce the exact complete predicted plot.
  -- Preserve construction sale_status and every other field rather than replacing
  -- ready_for_sale/active with reserved/available during a historical import.
  IF (SELECT to_jsonb(x) FROM public.sales x WHERE id=e.sale_id) IS DISTINCT FROM e.after_sale
   OR (SELECT to_jsonb(x) FROM public.plots x WHERE id=p.id) IS DISTINCT FROM
   (to_jsonb(p)||jsonb_build_object('has_customer',op='create_booking'))
   THEN RAISE EXCEPTION 'HISTORICAL_REVISION_STOCK_SYNC_REQUIRED'; END IF;
  DELETE FROM sales_revision_private.plot_permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid() AND event_id=e.id;
  total:=total+1;
 END LOOP;
 RETURN jsonb_build_object('batchId',b.id,'records',total,'replayed',false,'bindings',(SELECT jsonb_agg(jsonb_build_object('sourceRow',source_row,'saleId',sale_id) ORDER BY source_row) FROM sales_revision_private.events WHERE batch_id=b.id));
END;
$apply$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA sales_revision_private FROM PUBLIC,anon,authenticated;

-- Exact guard/helper/forecast source adapters are appended below, preserving existing checks and grants.
CREATE FUNCTION sales_revision_private.history(p_sale jsonb,p_original jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE s public.sales%ROWTYPE; e sales_revision_private.events%ROWTYPE; revision sales_revision_private.events%ROWTYPE; evidence jsonb:=p_original;
BEGIN
 SELECT * INTO s FROM public.sales WHERE id=(p_sale->>'id')::uuid;
 IF s.id IS NULL OR NOT p_sale @> to_jsonb(s) THEN RAISE EXCEPTION 'HISTORICAL_REVISION_PROVENANCE'; END IF;
 IF s.historical_import_id IS NOT NULL THEN
  SELECT * INTO e FROM sales_revision_private.events WHERE id=s.historical_import_id AND operation='create_booking';
  IF e.id IS NULL OR e.sale_id IS DISTINCT FROM s.id OR e.interest_id IS DISTINCT FROM s.project_interest_id OR e.plot_id IS DISTINCT FROM s.plot_id
   OR NOT EXISTS(SELECT 1 FROM public.lead_project_interests i WHERE i.id=e.interest_id AND i.customer_id=e.customer_id)
   OR EXISTS(SELECT 1 FROM unnest(ARRAY['id','lead_id','project_interest_id','plot_id','booking_round','previous_sale_id','booking_route','booking_route_reason','booked_at','list_price','discount_amount','external_booking_id','external_source_stage','historical_import_id','sale_price','closing_sales_user_id']) k WHERE e.after_sale->k IS DISTINCT FROM p_sale->k)
  THEN RAISE EXCEPTION 'HISTORICAL_REVISION_PROVENANCE'; END IF;
  evidence:=jsonb_build_object('source','customer_sheet','batchId',e.batch_id,'sourceRow',e.source_row,'sourceStage','booked','bookedDate',e.booked_day,'cancelledDate',NULL,'transferredDate',NULL);
 END IF;
 IF s.historical_revision_id IS NOT NULL THEN
  SELECT * INTO revision FROM sales_revision_private.events WHERE id=s.historical_revision_id AND operation='cancel';
  IF revision.id IS NULL OR revision.sale_id IS DISTINCT FROM s.id OR revision.interest_id IS DISTINCT FROM s.project_interest_id
   OR revision.plot_id IS DISTINCT FROM s.plot_id OR s.crm_stage IS DISTINCT FROM 'cancelled' OR s.cancelled_at IS NOT NULL
   OR evidence IS NULL OR evidence->>'bookedDate' IS DISTINCT FROM to_char(revision.booked_day,'YYYY-MM-DD')
  THEN RAISE EXCEPTION 'HISTORICAL_REVISION_PROVENANCE'; END IF;
  evidence:=evidence||jsonb_build_object('batchId',revision.batch_id,'sourceRow',revision.source_row,'sourceStage','cancelled','cancelledDate',revision.cancelled_day);
 END IF;
 RETURN evidence;
END; $$;
CREATE FUNCTION sales_revision_private.marker_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF (TG_OP='INSERT' AND (NEW.historical_import_id IS NOT NULL OR NEW.historical_revision_id IS NOT NULL))
  OR (TG_OP='UPDATE' AND (NEW.historical_import_id IS DISTINCT FROM OLD.historical_import_id OR NEW.historical_revision_id IS DISTINCT FROM OLD.historical_revision_id)) THEN
  IF NOT sales_revision_private.allowed(TG_OP,CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END,to_jsonb(NEW)) THEN RAISE EXCEPTION 'HISTORICAL_REVISION_SEALED'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER historical_marker_guard BEFORE INSERT OR UPDATE ON public.sales FOR EACH ROW EXECUTE FUNCTION sales_revision_private.marker_guard();
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA sales_revision_private FROM PUBLIC,anon,authenticated;

DO $guard_adapter$
DECLARE definition text; body text; settings text[]; secured boolean; owner_name text;
 marker text:='  IF permit.transaction_id IS NULL THEN';
 hook text:=$hook$
    IF sales_revision_private.allowed(TG_OP,CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END,CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END) THEN RETURN NEW; END IF;$hook$;
BEGIN
 SELECT pg_get_functiondef(oid),replace(prosrc,E'\r\n',E'\n'),proconfig,prosecdef,pg_get_userbyid(proowner) INTO definition,body,settings,secured,owner_name FROM pg_proc WHERE oid='crm_external_private.guard_cutover_sale()'::regprocedure;
 IF md5(body) IS DISTINCT FROM 'e0959fce0d5b49f4d571eb9224ea6395' OR owner_name IS DISTINCT FROM current_user OR NOT secured OR settings IS DISTINCT FROM ARRAY['search_path=""'] THEN RAISE EXCEPTION 'HISTORICAL_REVISION_GUARD_REVIEW_REQUIRED'; END IF;
 EXECUTE replace(definition,marker,marker||hook);
END;
$guard_adapter$;
DO $history_adapter$
DECLARE definition text; body text; secured boolean; owner_name text; settings text[];
BEGIN
 SELECT pg_get_functiondef(oid),replace(prosrc,E'\r\n',E'\n'),proconfig,prosecdef,pg_get_userbyid(proowner) INTO definition,body,settings,secured,owner_name FROM pg_proc WHERE oid='sales_private.crm_booking_imported_history(jsonb)'::regprocedure;
 IF md5(body) IS DISTINCT FROM '2a28cec4d7dfd7b24c1d6c4c80ceb558' OR owner_name IS DISTINCT FROM current_user OR secured OR settings IS DISTINCT FROM ARRAY['search_path=pg_catalog'] THEN RAISE EXCEPTION 'HISTORICAL_REVISION_READER_REVIEW_REQUIRED'; END IF;
 definition:=replace(definition,'BEGIN',E'BEGIN\n  IF p_sale->>''historical_import_id'' IS NOT NULL THEN RETURN sales_revision_private.history(p_sale); END IF;');
 definition:=replace(definition,'RETURN evidence;','RETURN sales_revision_private.history(p_sale,evidence);');
 EXECUTE definition;
END;
$history_adapter$;
DO $forecast_adapter$
DECLARE definition text; body text; secured boolean; owner_name text; settings text[];
 old_text text:='p_source_day);';
 new_text text:=$replace$COALESCE((SELECT to_char(e.expected_transfer_day,'YYYY-MM-DD') FROM sales_revision_private.events e JOIN public.sales s ON s.historical_import_id=e.id WHERE s.id=p_sale_id),p_source_day));$replace$;
BEGIN
 SELECT pg_get_functiondef(oid),replace(prosrc,E'\r\n',E'\n'),proconfig,prosecdef,pg_get_userbyid(proowner) INTO definition,body,settings,secured,owner_name FROM pg_proc WHERE oid='sales_import_private.expected_transfer_date(uuid,text)'::regprocedure;
 IF md5(body) IS DISTINCT FROM 'ca02af027fb6498e136a92d5be83958d' OR owner_name IS DISTINCT FROM current_user OR secured OR settings IS DISTINCT FROM ARRAY['search_path=pg_catalog'] THEN RAISE EXCEPTION 'HISTORICAL_REVISION_FORECAST_REVIEW_REQUIRED'; END IF;
 EXECUTE replace(definition,old_text,new_text);
END;
$forecast_adapter$;
-- Preserve the full actual stock guard. Unknown bodies, owners, trigger states
-- or absent/changed legacy sync block this installation before any import.
DO $historical_plot_adapter$
DECLARE definition text; body text; secured boolean; owner_name text; settings text[];
 marker text:='BEGIN';
 hook text:=$historical_plot_hook$
 IF TG_OP='UPDATE' AND sales_revision_private.plot_allowed(to_jsonb(OLD),to_jsonb(NEW)) THEN RETURN NEW; END IF;$historical_plot_hook$;
BEGIN
 IF to_regprocedure('crm_external_private.guard_booking_plot_stock()') IS NULL
  OR to_regprocedure('public.sync_plot_customer_status()') IS NULL THEN RAISE EXCEPTION 'HISTORICAL_REVISION_STOCK_REVIEW_REQUIRED'; END IF;
 SELECT pg_get_functiondef(oid),replace(prosrc,E'\r\n',E'\n'),proconfig,prosecdef,pg_get_userbyid(proowner)
 INTO definition,body,settings,secured,owner_name FROM pg_proc WHERE oid='crm_external_private.guard_booking_plot_stock()'::regprocedure;
 IF md5(body) IS DISTINCT FROM 'd73ef26b98c0aedaab0dd5966fdad003'
  OR owner_name IS DISTINCT FROM current_user OR secured IS DISTINCT FROM true OR settings IS DISTINCT FROM ARRAY['search_path=""']
  OR (length(body)-length(replace(body,marker,'')))/length(marker)<>1
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.plots'::regclass AND tgfoid='crm_external_private.guard_booking_plot_stock()'::regprocedure
    AND NOT tgisinternal AND tgenabled IN('O','A') AND tgtype=23)
  OR (SELECT md5(replace(prosrc,E'\r\n',E'\n')) FROM pg_proc WHERE oid='public.sync_plot_customer_status()'::regprocedure) NOT IN('d5d2314011924a3de7d7ef5cd33d1900','d14049d669231cf3b2435b42c869e011')
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.sales'::regclass AND tgfoid='public.sync_plot_customer_status()'::regprocedure
    AND tgname='trigger_sync_plot_customer_status' AND NOT tgisinternal AND tgenabled IN('O','A') AND tgtype=29)
 THEN RAISE EXCEPTION 'HISTORICAL_REVISION_STOCK_REVIEW_REQUIRED'; END IF;
 EXECUTE replace(definition,marker,marker||hook);
END;
$historical_plot_adapter$;
-- The updater is installed unchanged before the writer. A missing/disabled or
-- changed updater is not silently modeled as an optional fixture behavior.
DO $historical_updated_catalog$
BEGIN
 IF to_regprocedure('public.update_sales_updated_at_column()') IS NULL
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.update_sales_updated_at_column()') AND pg_get_userbyid(proowner)=current_user
   AND NOT prosecdef AND proconfig IS NULL AND md5(replace(prosrc,E'\r\n',E'\n'))='06bcf30ac3d0a7f279a54cbf228a7bec')
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.sales'::regclass AND tgfoid=to_regprocedure('public.update_sales_updated_at_column()')
   AND tgname='update_sales_table_updated_at' AND NOT tgisinternal AND tgenabled IN('O','A') AND tgtype=19)
 THEN RAISE EXCEPTION 'HISTORICAL_REVISION_STOCK_REVIEW_REQUIRED'; END IF;
END;
$historical_updated_catalog$;

-- LOCAL DESIGN ONLY. Append six reviewed source identities to nonempty CRM.
-- Independent immutable provenance: original snapshot candidates and seals stay intact.
-- No fabricated Lead, Visit, stock, operational datetime, or name-based identity merge.
-- New UUIDs are allocated only inside the atomic apply. created_at/recorded_at are
-- import metadata; lead_created_at/interest_created_at/activation times stay NULL.
-- Supplemental rows are sealed except the unchanged, exact existing booking
-- Interest permit. Customer details continue through the existing 22 overlay.
-- This draft grants no public RPC or new lifecycle permission.

-- Design sentinel cleared only in this reviewed installation artifact.

CREATE SCHEMA sales_source_creation_private;
REVOKE ALL ON SCHEMA sales_source_creation_private FROM PUBLIC,anon,authenticated;
CREATE TABLE sales_source_creation_private.batches (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), dataset_key text NOT NULL UNIQUE,
 source_sha256 text NOT NULL CHECK(source_sha256 ~ '^[a-f0-9]{64}$'), review_sha256 text NOT NULL CHECK(review_sha256 ~ '^[a-f0-9]{64}$'),
 payload jsonb NOT NULL, reviewer_id uuid NOT NULL REFERENCES auth.users(id), recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE sales_source_creation_private.records (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), batch_id uuid NOT NULL REFERENCES sales_source_creation_private.batches(id),
 source_row integer NOT NULL CHECK(source_row IN(438,439,440,444,894,680)),
 source_key text NOT NULL UNIQUE CHECK(source_key ~ '^[a-f0-9]{64}$'), row_sha256 text NOT NULL CHECK(row_sha256 ~ '^[a-f0-9]{64}$'),
 customer_candidate_key text NOT NULL UNIQUE CHECK(customer_candidate_key ~ '^[a-f0-9]{64}$'),
 interest_candidate_key text NOT NULL UNIQUE CHECK(interest_candidate_key ~ '^[a-f0-9]{64}$'),
 customer_id uuid NOT NULL UNIQUE, interest_id uuid NOT NULL UNIQUE, payload jsonb NOT NULL,
 UNIQUE(batch_id,source_row),
 FOREIGN KEY(customer_id) REFERENCES public.sales_customers(id) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(interest_id,customer_id) REFERENCES public.lead_project_interests(id,customer_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE sales_source_creation_private.events (
 record_id uuid NOT NULL REFERENCES sales_source_creation_private.records(id), event_key text NOT NULL,
 kind text NOT NULL CHECK(kind='visited'), event_day date, precision text NOT NULL CHECK(precision IN('day','unknown')),
 evidence_ref text NOT NULL CHECK(length(btrim(evidence_ref)) BETWEEN 1 AND 500),
 PRIMARY KEY(record_id,event_key), CHECK((precision='day' AND event_day IS NOT NULL) OR (precision='unknown' AND event_day IS NULL))
);
CREATE TABLE sales_source_creation_private.permits (
 transaction_id bigint NOT NULL, backend_pid integer NOT NULL, actor_id uuid NOT NULL, entity_type text NOT NULL CHECK(entity_type IN('customer','interest')),
 entity_id uuid NOT NULL, new_row jsonb NOT NULL, PRIMARY KEY(transaction_id,backend_pid,entity_type,entity_id)
);
ALTER TABLE public.sales_customers ADD COLUMN supplemental_creation_id uuid UNIQUE REFERENCES sales_source_creation_private.records(id);
ALTER TABLE public.lead_project_interests ADD COLUMN supplemental_creation_id uuid UNIQUE REFERENCES sales_source_creation_private.records(id);

-- Retain each original CHECK expression byte-for-byte inside the NULL provenance
-- branch. In particular, live/old legacy and external-snapshot branches are NOT
-- widened. Never remove the original phone evidence or workspace constraints.
DO $preserve_branches$
DECLARE item record; expression text; original text;
BEGIN
 FOR item IN SELECT * FROM (VALUES
  ('sales_customers','crm_customer_origin_check',
   'record_origin=''legacy_import'' AND legacy_source_lead_id IS NULL AND external_snapshot_batch_id IS NULL AND external_customer_key IS NULL AND lead_created_at IS NULL AND first_contacted_at IS NULL AND intake_status=''legacy_unclassified'' AND phone IS NULL AND phone_data_status=''unknown_legacy'''),
  ('lead_project_interests','crm_interest_created_evidence_check',
   'external_snapshot_batch_id IS NULL AND external_interest_key IS NULL AND interest_created_at IS NULL'),
  ('lead_project_interests','lead_project_interests_engagement_status_check',
   'external_snapshot_batch_id IS NULL AND external_interest_key IS NULL AND engagement_status=''legacy_unclassified''')
 ) x(table_name,constraint_name,new_branch) LOOP
  SELECT pg_get_constraintdef(oid) INTO original FROM pg_constraint
   WHERE conrelid=('public.'||item.table_name)::regclass AND conname=item.constraint_name AND contype='c';
  IF original IS NULL OR left(original,7)<>'CHECK (' OR right(original,1)<>')'
   THEN RAISE EXCEPTION 'SOURCE_CREATION_ORIGINAL_CONSTRAINT_REQUIRED'; END IF;
  expression:=substr(original,8,length(original)-8);
  EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I',item.table_name,item.constraint_name);
  EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK ((supplemental_creation_id IS NULL AND (%s)) OR (supplemental_creation_id IS NOT NULL AND (%s)))',item.table_name,item.constraint_name,expression,item.new_branch);
 END LOOP;
END;
$preserve_branches$;

CREATE FUNCTION sales_source_creation_private.immutable()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'SOURCE_CREATION_SEALED'; END; $$;
CREATE FUNCTION sales_source_creation_private.owner_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF current_user IS DISTINCT FROM (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid=TG_RELID)
  OR auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM sales_private.crm_user_roles WHERE user_id=auth.uid() AND role='admin' AND is_active)
 THEN RAISE EXCEPTION 'SOURCE_CREATION_FORBIDDEN'; END IF;
 RETURN NEW;
END; $$;
CREATE FUNCTION sales_source_creation_private.canonical_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE kind text:=CASE WHEN TG_TABLE_NAME='sales_customers' THEN 'customer' ELSE 'interest' END; r sales_source_creation_private.records%ROWTYPE; allowed boolean:=false;
BEGIN
 IF TG_OP IN('UPDATE','DELETE') AND OLD.supplemental_creation_id IS NOT NULL THEN
  IF TG_OP='UPDATE' AND kind='interest' AND to_regprocedure('crm_external_private.booking_interest_allowed(jsonb,jsonb)') IS NOT NULL THEN
   EXECUTE 'SELECT crm_external_private.booking_interest_allowed($1,$2)' INTO allowed USING to_jsonb(OLD),to_jsonb(NEW);
   IF allowed IS TRUE THEN RETURN NEW; END IF;
  END IF;
  RAISE EXCEPTION 'SOURCE_CREATION_SEALED';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF NEW.supplemental_creation_id IS NULL THEN RETURN NEW; END IF;
 IF TG_OP<>'INSERT' OR NOT EXISTS(SELECT 1 FROM sales_source_creation_private.permits p
   WHERE p.transaction_id=txid_current() AND p.backend_pid=pg_backend_pid() AND p.actor_id=auth.uid()
    AND p.entity_type=kind AND p.entity_id=NEW.id AND p.new_row=to_jsonb(NEW))
 THEN RAISE EXCEPTION 'SOURCE_CREATION_EXACT_PERMIT_REQUIRED'; END IF;
 SELECT * INTO STRICT r FROM sales_source_creation_private.records WHERE id=NEW.supplemental_creation_id;
 IF kind='customer' THEN
  IF r.customer_id IS DISTINCT FROM NEW.id OR NEW.customer_name IS DISTINCT FROM r.payload->>'customerName'
   THEN RAISE EXCEPTION 'SOURCE_CREATION_LINEAGE_REQUIRED'; END IF;
 ELSE
  IF r.interest_id IS DISTINCT FROM NEW.id OR NEW.customer_id IS DISTINCT FROM r.customer_id OR NEW.project_name IS DISTINCT FROM r.payload->>'projectName'
   THEN RAISE EXCEPTION 'SOURCE_CREATION_LINEAGE_REQUIRED'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER supplemental_customer_seal BEFORE INSERT OR UPDATE OR DELETE ON public.sales_customers FOR EACH ROW EXECUTE FUNCTION sales_source_creation_private.canonical_guard();
CREATE TRIGGER supplemental_interest_seal BEFORE INSERT OR UPDATE OR DELETE ON public.lead_project_interests FOR EACH ROW EXECUTE FUNCTION sales_source_creation_private.canonical_guard();
DO $protect_tables$
DECLARE tab text;
BEGIN
 FOREACH tab IN ARRAY ARRAY['batches','records','events','permits'] LOOP
  EXECUTE format('ALTER TABLE sales_source_creation_private.%I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('CREATE TRIGGER source_creation_no_truncate BEFORE TRUNCATE ON sales_source_creation_private.%I FOR EACH STATEMENT EXECUTE FUNCTION sales_source_creation_private.immutable()',tab);
  IF tab<>'permits' THEN
   EXECUTE format('CREATE TRIGGER source_creation_immutable BEFORE UPDATE OR DELETE ON sales_source_creation_private.%I FOR EACH ROW EXECUTE FUNCTION sales_source_creation_private.immutable()',tab);
   EXECUTE format('CREATE TRIGGER source_creation_owner BEFORE INSERT ON sales_source_creation_private.%I FOR EACH ROW EXECUTE FUNCTION sales_source_creation_private.owner_guard()',tab);
  END IF;
 END LOOP;
END;
$protect_tables$;

CREATE FUNCTION sales_source_creation_private.exact_object(value jsonb,keys text[])
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN IF jsonb_typeof(value) IS DISTINCT FROM 'object' OR NOT(value ?& keys)
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(value) k WHERE NOT(k=ANY(keys))) THEN RAISE EXCEPTION 'SOURCE_CREATION_INVALID'; END IF; END; $$;
CREATE FUNCTION sales_source_creation_private.apply_reviewed(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=auth.uid(); batch sales_source_creation_private.batches%ROWTYPE; inserted_id uuid;
 r jsonb; e jsonb; owner_id uuid; provenance uuid; customer public.sales_customers%ROWTYPE; interest public.lead_project_interests%ROWTYPE;
 recorded timestamptz; event_day date; bindings jsonb:='[]';
BEGIN
 IF actor IS NULL OR current_user IS DISTINCT FROM (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid='sales_source_creation_private.batches'::regclass)
 THEN RAISE EXCEPTION 'SOURCE_CREATION_FORBIDDEN'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('crm-booking-command',0));
 PERFORM 1 FROM sales_private.crm_user_roles WHERE user_id=actor AND role='admin' AND is_active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'SOURCE_CREATION_FORBIDDEN'; END IF;
 PERFORM 1 FROM public.crm_settings WHERE id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'SOURCE_CREATION_DISABLED_FLAGS_REQUIRED'; END IF;
 IF EXISTS(SELECT 1 FROM public.crm_settings s,LATERAL jsonb_each(to_jsonb(s)) j WHERE
  (j.key LIKE '%\_enabled' ESCAPE '\' OR j.key='booking_cutover_reviewed') AND j.value='true')
 THEN RAISE EXCEPTION 'SOURCE_CREATION_DISABLED_FLAGS_REQUIRED'; END IF;
 PERFORM sales_source_creation_private.exact_object(p_payload,ARRAY['version','datasetKey','sourceSha256','reviewSha256','leadReplayAllowed','businessStageWritesAllowed','records']);
 IF p_payload->>'version' IS DISTINCT FROM 'source-bound-customer-creation-v1'
  OR p_payload->'leadReplayAllowed' IS DISTINCT FROM 'false'::jsonb OR p_payload->'businessStageWritesAllowed' IS DISTINCT FROM 'false'::jsonb
  OR jsonb_typeof(p_payload->'datasetKey') IS DISTINCT FROM 'string' OR length(btrim(p_payload->>'datasetKey')) NOT BETWEEN 1 AND 200
  OR p_payload->>'datasetKey'<>btrim(p_payload->>'datasetKey') OR p_payload->>'datasetKey' ~ '[[:cntrl:]]'
  OR jsonb_typeof(p_payload->'sourceSha256') IS DISTINCT FROM 'string' OR (p_payload->>'sourceSha256' ~ '^[a-f0-9]{64}$') IS DISTINCT FROM true
  OR jsonb_typeof(p_payload->'reviewSha256') IS DISTINCT FROM 'string' OR (p_payload->>'reviewSha256' ~ '^[a-f0-9]{64}$') IS DISTINCT FROM true
  OR jsonb_typeof(p_payload->'records') IS DISTINCT FROM 'array' OR octet_length(p_payload::text)>8388608
 THEN RAISE EXCEPTION 'SOURCE_CREATION_INVALID'; END IF;
 IF jsonb_array_length(p_payload->'records')<>6 THEN RAISE EXCEPTION 'SOURCE_CREATION_SIX_CONFIRMED_ROWS_REQUIRED'; END IF;
 INSERT INTO sales_source_creation_private.batches(dataset_key,source_sha256,review_sha256,payload,reviewer_id)
 VALUES(p_payload->>'datasetKey',p_payload->>'sourceSha256',p_payload->>'reviewSha256',p_payload,actor)
 ON CONFLICT(dataset_key) DO NOTHING RETURNING id INTO inserted_id;
 SELECT * INTO STRICT batch FROM sales_source_creation_private.batches WHERE dataset_key=p_payload->>'datasetKey' FOR UPDATE;
 IF batch.payload IS DISTINCT FROM p_payload THEN RAISE EXCEPTION 'SOURCE_CREATION_REPLAY_CONFLICT'; END IF;
 -- Replay rechecks active confirmed owner roles before returning stored UUIDs.
 FOR r IN SELECT value FROM jsonb_array_elements(p_payload->'records') ORDER BY value->>'ownerUserId' LOOP
  IF jsonb_typeof(r->'ownerUserId') IS DISTINCT FROM 'string' OR (r->>'ownerUserId' ~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$') IS DISTINCT FROM true THEN RAISE EXCEPTION 'SOURCE_CREATION_INVALID'; END IF;
  owner_id:=(r->>'ownerUserId')::uuid;
  PERFORM 1 FROM sales_private.crm_user_roles WHERE user_id=owner_id AND role='sales' AND is_active
   AND (r->>'sourceRow'='680' OR (user_id='9c1d670a-1d2a-4996-959c-33c243fd34d8' AND display_name='TEAW')) FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SOURCE_CREATION_OWNER_CHANGED'; END IF;
 END LOOP;
 IF inserted_id IS NULL THEN
  SELECT jsonb_agg(jsonb_build_object('sourceRow',source_row,'customerId',customer_id,'interestId',interest_id) ORDER BY source_row) INTO bindings FROM sales_source_creation_private.records WHERE batch_id=batch.id;
  RETURN jsonb_build_object('batchId',batch.id,'records',6,'bindings',bindings,'replayed',true);
 END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(p_payload->'records') ORDER BY (value->>'sourceRow')::integer LOOP
  PERFORM sales_source_creation_private.exact_object(r,ARRAY['sourceRow','sourceKey','rowSha256','customerCandidateKey','interestCandidateKey','customerName','unknownName','ownerUserId','projectName','events']);
  IF jsonb_typeof(r->'sourceRow') IS DISTINCT FROM 'number' OR (r->>'sourceRow' ~ '^[0-9]+$') IS DISTINCT FROM true OR (r->>'sourceRow')::integer NOT IN(438,439,440,444,894,680)
   OR jsonb_typeof(r->'sourceKey') IS DISTINCT FROM 'string' OR (r->>'sourceKey' ~ '^[a-f0-9]{64}$') IS DISTINCT FROM true
   OR jsonb_typeof(r->'rowSha256') IS DISTINCT FROM 'string' OR (r->>'rowSha256' ~ '^[a-f0-9]{64}$') IS DISTINCT FROM true
   OR jsonb_typeof(r->'customerName') IS DISTINCT FROM 'string' OR length(btrim(r->>'customerName')) NOT BETWEEN 1 AND 300 OR r->>'customerName' ~ '[[:cntrl:]]'
   OR r->'unknownName' IS DISTINCT FROM to_jsonb((r->>'sourceRow')::integer=680)
   OR ((r->>'sourceRow')::integer=680 AND r->>'customerName' IS DISTINCT FROM 'ไม่ทราบ')
   OR jsonb_typeof(r->'customerCandidateKey') IS DISTINCT FROM 'string' OR (r->>'customerCandidateKey' ~ '^[a-f0-9]{64}$') IS DISTINCT FROM true
   OR jsonb_typeof(r->'interestCandidateKey') IS DISTINCT FROM 'string' OR (r->>'interestCandidateKey' ~ '^[a-f0-9]{64}$') IS DISTINCT FROM true
   OR jsonb_typeof(r->'projectName') IS DISTINCT FROM 'string' OR length(btrim(r->>'projectName')) NOT BETWEEN 1 AND 200
   OR jsonb_typeof(r->'events') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'SOURCE_CREATION_INVALID'; END IF;
  IF jsonb_array_length(r->'events') NOT BETWEEN 1 AND 30 THEN RAISE EXCEPTION 'SOURCE_CREATION_INVALID'; END IF;
  PERFORM 1 FROM public.projects WHERE name=r->>'projectName' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SOURCE_CREATION_PROJECT_CHANGED'; END IF;
  owner_id:=(r->>'ownerUserId')::uuid; provenance:=gen_random_uuid(); recorded:=clock_timestamp();
  customer:=jsonb_populate_record(NULL::public.sales_customers,jsonb_build_object('id',gen_random_uuid(),'customer_name',r->>'customerName','record_origin','legacy_import',
   'phone_data_status','unknown_legacy','personal_data','{}'::jsonb,'intake_status','legacy_unclassified','owner_user_id',owner_id,'created_by_user_id',actor,
   'owner_assigned_at',recorded,'created_at',recorded,'updated_at',recorded,'lifecycle_revision',gen_random_uuid(),'supplemental_creation_id',provenance));
  interest:=jsonb_populate_record(NULL::public.lead_project_interests,jsonb_build_object('id',gen_random_uuid(),'customer_id',customer.id,'project_name',r->>'projectName',
   'owner_user_id',owner_id,'created_by_user_id',actor,'owner_assigned_at',recorded,'workspace_state','central_interest','engagement_status','legacy_unclassified',
   'created_at',recorded,'updated_at',recorded,'lifecycle_revision',gen_random_uuid(),'supplemental_creation_id',provenance));
  INSERT INTO sales_source_creation_private.records(id,batch_id,source_row,source_key,row_sha256,customer_candidate_key,interest_candidate_key,customer_id,interest_id,payload)
   VALUES(provenance,batch.id,(r->>'sourceRow')::integer,r->>'sourceKey',r->>'rowSha256',r->>'customerCandidateKey',r->>'interestCandidateKey',customer.id,interest.id,r);
  INSERT INTO sales_source_creation_private.permits VALUES(txid_current(),pg_backend_pid(),actor,'customer',customer.id,to_jsonb(customer)),(txid_current(),pg_backend_pid(),actor,'interest',interest.id,to_jsonb(interest));
  INSERT INTO public.sales_customers(id,customer_name,record_origin,phone_data_status,personal_data,intake_status,owner_user_id,created_by_user_id,owner_assigned_at,lead_created_at,created_at,updated_at,lifecycle_revision,supplemental_creation_id)
   VALUES(customer.id,customer.customer_name,customer.record_origin,customer.phone_data_status,customer.personal_data,customer.intake_status,customer.owner_user_id,customer.created_by_user_id,customer.owner_assigned_at,NULL,customer.created_at,customer.updated_at,customer.lifecycle_revision,provenance);
  INSERT INTO public.lead_project_interests(id,customer_id,project_name,owner_user_id,created_by_user_id,owner_assigned_at,workspace_state,engagement_status,interest_created_at,created_at,updated_at,lifecycle_revision,supplemental_creation_id)
   VALUES(interest.id,customer.id,interest.project_name,owner_id,actor,interest.owner_assigned_at,interest.workspace_state,interest.engagement_status,NULL,interest.created_at,interest.updated_at,interest.lifecycle_revision,provenance);
  DELETE FROM sales_source_creation_private.permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid();
  FOR e IN SELECT value FROM jsonb_array_elements(r->'events') LOOP
   PERFORM sales_source_creation_private.exact_object(e,ARRAY['eventKey','kind','date','precision','evidenceRef']);
   IF jsonb_typeof(e->'eventKey') IS DISTINCT FROM 'string' OR length(btrim(e->>'eventKey')) NOT BETWEEN 1 AND 200 OR e->>'kind' IS DISTINCT FROM 'visited'
    OR jsonb_typeof(e->'evidenceRef') IS DISTINCT FROM 'string' OR length(btrim(e->>'evidenceRef')) NOT BETWEEN 1 AND 500
    OR jsonb_typeof(e->'precision') IS DISTINCT FROM 'string'
    OR NOT((e->>'precision'='unknown' AND e->'date'='null'::jsonb) OR (e->>'precision'='day' AND jsonb_typeof(e->'date')='string' AND e->>'date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'))
    THEN RAISE EXCEPTION 'SOURCE_CREATION_INVALID'; END IF;
   event_day:=(e->>'date')::date;
   IF event_day IS NOT NULL AND (event_day<DATE '0001-01-01' OR event_day>DATE '9999-12-31' OR to_char(event_day,'YYYY-MM-DD')<>e->>'date') THEN RAISE EXCEPTION 'SOURCE_CREATION_INVALID'; END IF;
   INSERT INTO sales_source_creation_private.events VALUES(provenance,e->>'eventKey','visited',event_day,e->>'precision',e->>'evidenceRef');
  END LOOP;
  bindings:=bindings||jsonb_build_array(jsonb_build_object('sourceRow',(r->>'sourceRow')::integer,'customerId',customer.id,'interestId',interest.id));
 END LOOP;
 RETURN jsonb_build_object('batchId',batch.id,'records',6,'bindings',bindings,'replayed',false);
END; $$;
REVOKE ALL ON ALL TABLES IN SCHEMA sales_source_creation_private FROM PUBLIC,anon,authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA sales_source_creation_private FROM PUBLIC,anon,authenticated;

-- LOCAL DESIGN ONLY. Read-only projection; no imports, backfills or flag writes.
-- Requires the actual canonical 18/19/25/26/27/28 and Excel reader bodies.
-- Private definer boundary projects reviewed provenance without exposing raw cells.

-- Design sentinel cleared only in this reviewed installation artifact.
CREATE SCHEMA sales_history_read_private;
REVOKE ALL ON SCHEMA sales_history_read_private FROM PUBLIC,anon;
GRANT USAGE ON SCHEMA sales_history_read_private TO authenticated;

CREATE FUNCTION sales_history_read_private.records(p_customer_id uuid DEFAULT NULL,p_interest_id uuid DEFAULT NULL,p_sale_id uuid DEFAULT NULL,p_project_name text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog SET timezone='UTC' SET datestyle='ISO, YMD' AS $records$
DECLARE actor uuid:=auth.uid(); role_name text:=public.crm_v2_role(); result jsonb; loop_entry record; h jsonb;
BEGIN
 IF actor IS NULL OR coalesce(role_name,'') NOT IN('sales','admin','owner') THEN RAISE EXCEPTION 'CRM_CUSTOMER_HISTORY_FORBIDDEN'; END IF;
 IF (public.crm_v2_project_sales_capabilities()->>'enabled')::boolean IS DISTINCT FROM true
  OR NOT crm_external_private.booking_writer_ready() THEN RAISE EXCEPTION 'CRM_CUSTOMER_HISTORY_SETUP_REQUIRED'; END IF;
 IF EXISTS(SELECT 1 FROM crm_external_private.booking_writer_releases w LEFT JOIN crm_external_private.snapshot_batches b ON b.id=w.batch_id
  WHERE b.id IS NULL OR b.feed IS DISTINCT FROM 'customer-sheet' OR b.plan_digest IS DISTINCT FROM w.plan_digest)
  THEN RAISE EXCEPTION 'CRM_CUSTOMER_HISTORY_INTEGRITY_REQUIRED'; END IF;
 IF p_customer_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.sales_customers WHERE id=p_customer_id AND merged_into_customer_id IS NULL)
  THEN RAISE EXCEPTION 'CRM_CUSTOMER_HISTORY_NOT_FOUND'; END IF;
 IF p_interest_id IS NOT NULL AND (p_customer_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.lead_project_interests WHERE id=p_interest_id AND customer_id=p_customer_id))
  THEN RAISE EXCEPTION 'CRM_CUSTOMER_HISTORY_SCOPE_INVALID'; END IF;
 IF p_sale_id IS NOT NULL AND (p_customer_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.sales s JOIN public.lead_project_interests i ON i.id=s.project_interest_id
  WHERE s.id=p_sale_id AND i.customer_id=p_customer_id AND (p_interest_id IS NULL OR i.id=p_interest_id))) THEN RAISE EXCEPTION 'CRM_CUSTOMER_HISTORY_SCOPE_INVALID'; END IF;
 IF p_project_name IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.projects WHERE name=p_project_name) THEN RAISE EXCEPTION 'CRM_CUSTOMER_HISTORY_NOT_FOUND'; END IF;

 -- Reuse the complete project reader's stock, identity, prior-round and source
 -- integrity checks before collecting or filtering historical evidence.
 FOR loop_entry IN SELECT DISTINCT i.project_name FROM public.lead_project_interests i
  WHERE (p_customer_id IS NULL OR i.customer_id=p_customer_id) AND (p_project_name IS NULL OR i.project_name=p_project_name)
 LOOP PERFORM public.crm_v2_project_sales(loop_entry.project_name,'all','',0); END LOOP;
 IF EXISTS(SELECT 1 FROM public.sales s JOIN public.lead_project_interests i ON i.id=s.project_interest_id JOIN public.sales_customers c ON c.id=i.customer_id
  LEFT JOIN crm_external_private.prepared_booking_sales p ON p.id=s.external_booking_id
  LEFT JOIN crm_external_private.source_records sr ON sr.batch_id=p.batch_id AND sr.source_row=(p.payload->>'source_row')::integer
  WHERE s.external_booking_id IS NOT NULL AND (p_customer_id IS NULL OR c.id=p_customer_id) AND (p_project_name IS NULL OR i.project_name=p_project_name)
   AND (p.id IS NULL OR sr.source_row IS NULL OR sr.customer_key IS DISTINCT FROM c.external_customer_key OR p.batch_id IS DISTINCT FROM c.external_snapshot_batch_id
    OR p.payload->>'customer_id' IS DISTINCT FROM c.id::text OR p.payload->>'interest_id' IS DISTINCT FROM i.id::text))
  THEN RAISE EXCEPTION 'CRM_CUSTOMER_HISTORY_INTEGRITY_REQUIRED'; END IF;
 IF EXISTS(SELECT 1 FROM crm_external_private.prepared_booking_sales p JOIN public.sales s ON s.external_booking_id=p.id
  JOIN public.lead_project_interests i ON i.id=s.project_interest_id WHERE (p_customer_id IS NULL OR i.customer_id=p_customer_id)
  GROUP BY p.batch_id,(p.payload->>'source_row')::integer,i.id HAVING count(*)>1)
  THEN RAISE EXCEPTION 'CRM_CUSTOMER_HISTORY_INTEGRITY_REQUIRED'; END IF;
 IF EXISTS(SELECT 1 FROM sales_source_creation_private.records r
  LEFT JOIN public.sales_customers c ON c.id=r.customer_id LEFT JOIN public.lead_project_interests i ON i.id=r.interest_id
  WHERE (p_customer_id IS NULL OR r.customer_id=p_customer_id) AND (c.id IS NULL OR i.id IS NULL OR c.merged_into_customer_id IS NOT NULL
   OR c.supplemental_creation_id IS DISTINCT FROM r.id OR i.supplemental_creation_id IS DISTINCT FROM r.id OR i.customer_id IS DISTINCT FROM c.id
   OR i.project_name IS DISTINCT FROM r.payload->>'projectName')) THEN RAISE EXCEPTION 'CRM_CUSTOMER_HISTORY_INTEGRITY_REQUIRED'; END IF;
 IF EXISTS(SELECT 1 FROM sales_unknown_history_private.records r LEFT JOIN public.sales_customers c ON c.id=r.customer_id
  LEFT JOIN public.lead_project_interests i ON i.id=r.interest_id WHERE (p_customer_id IS NULL OR r.customer_id=p_customer_id)
  AND (c.id IS NULL OR c.merged_into_customer_id IS NOT NULL OR (r.interest_id IS NOT NULL AND (i.id IS NULL OR i.customer_id IS DISTINCT FROM c.id))))
  THEN RAISE EXCEPTION 'CRM_CUSTOMER_HISTORY_INTEGRITY_REQUIRED'; END IF;
 FOR loop_entry IN SELECT e.*,to_jsonb(s) AS current_sale FROM sales_revision_private.events e LEFT JOIN public.sales s ON s.id=e.sale_id
  WHERE (p_customer_id IS NULL OR e.customer_id=p_customer_id)
 LOOP
  IF loop_entry.current_sale IS NULL OR (loop_entry.operation='cancel' AND loop_entry.current_sale->>'historical_revision_id' IS DISTINCT FROM loop_entry.id::text)
   OR (loop_entry.operation='create_booking' AND loop_entry.current_sale->>'historical_import_id' IS DISTINCT FROM loop_entry.id::text)
   THEN RAISE EXCEPTION 'CRM_CUSTOMER_HISTORY_INTEGRITY_REQUIRED'; END IF;
  h:=sales_private.crm_booking_imported_history(loop_entry.current_sale);
  IF h IS NULL OR h->>'sourceRow' IS DISTINCT FROM loop_entry.source_row::text THEN RAISE EXCEPTION 'CRM_CUSTOMER_HISTORY_INTEGRITY_REQUIRED'; END IF;
 END LOOP;

 -- A source row is selected only through explicit candidate membership. Two
 -- visits with the same customer/day keep separate source keys. Ambiguous
 -- multi-interest membership is represented as unknown in customer scope.
 WITH original_members AS (
  SELECT s.batch_id,s.source_row,c.id customer_id,i.id interest_id,i.project_name,
   s.payload->'reviewedHistory'->>'visitHistoryDate' visit_day,
   (SELECT sale.id FROM public.sales sale JOIN crm_external_private.prepared_booking_sales p ON p.id=sale.external_booking_id
    WHERE sale.project_interest_id=i.id AND p.batch_id=s.batch_id AND (p.payload->>'source_row')::integer=s.source_row ORDER BY sale.id LIMIT 1) sale_id
  FROM crm_external_private.source_records s JOIN crm_external_private.booking_writer_releases w ON w.batch_id=s.batch_id
  JOIN crm_external_private.snapshot_batches b ON b.id=w.batch_id AND b.plan_digest=w.plan_digest AND b.feed='customer-sheet'
  JOIN public.sales_customers c ON c.external_snapshot_batch_id=s.batch_id AND c.external_customer_key=s.customer_key AND c.merged_into_customer_id IS NULL
  JOIN crm_external_private.interest_candidates ic ON ic.batch_id=s.batch_id AND ic.customer_key=s.customer_key AND ic.payload->'sourceRows' @> jsonb_build_array(s.source_row)
  JOIN public.lead_project_interests i ON i.external_snapshot_batch_id=ic.batch_id AND i.external_interest_key=ic.entity_key AND i.customer_id=c.id AND i.project_name=ic.project_label
  WHERE s.disposition='mapped_for_review' AND s.source_row BETWEEN 2 AND 966
   AND NOT EXISTS(SELECT 1 FROM crm_external_private.sales_rollback_receipts x WHERE x.batch_id=s.batch_id)
   AND (p_customer_id IS NULL OR c.id=p_customer_id) AND (p_interest_id IS NULL OR i.id=p_interest_id)
   AND (p_project_name IS NULL OR i.project_name=p_project_name)
   AND (p_sale_id IS NULL OR EXISTS(SELECT 1 FROM public.sales selected_sale JOIN crm_external_private.prepared_booking_sales selected_source ON selected_source.id=selected_sale.external_booking_id
    WHERE selected_sale.id=p_sale_id AND selected_sale.project_interest_id=i.id AND selected_source.batch_id=s.batch_id AND (selected_source.payload->>'source_row')::integer=s.source_row))
 ), original_unassigned AS (
  SELECT s.batch_id::text||':'||s.source_row::text key,c.id customer_id,s.source_row,NULL::uuid interest_id,NULL::text project_name,'[]'::jsonb project_names,NULL::uuid sale_id,
   jsonb_build_array(jsonb_build_object('kind','visited','date',s.payload->'reviewedHistory'->>'visitHistoryDate','precision',CASE WHEN s.payload->'reviewedHistory'->>'visitHistoryDate' IS NULL THEN 'unknown' ELSE 'day' END)) events,0 priority
  FROM crm_external_private.source_records s JOIN crm_external_private.booking_writer_releases w ON w.batch_id=s.batch_id
  JOIN crm_external_private.snapshot_batches b ON b.id=w.batch_id AND b.plan_digest=w.plan_digest AND b.feed='customer-sheet'
  JOIN public.sales_customers c ON c.external_snapshot_batch_id=s.batch_id AND c.external_customer_key=s.customer_key AND c.merged_into_customer_id IS NULL
  WHERE s.disposition='mapped_for_review' AND s.source_row BETWEEN 2 AND 966 AND s.payload->'reviewedHistory'->'projectLabels'='[]'
   AND NOT EXISTS(SELECT 1 FROM crm_external_private.interest_candidates ic WHERE ic.batch_id=s.batch_id AND ic.customer_key=s.customer_key AND ic.payload->'sourceRows' @> jsonb_build_array(s.source_row))
   AND NOT EXISTS(SELECT 1 FROM crm_external_private.sales_rollback_receipts x WHERE x.batch_id=s.batch_id)
   AND (p_customer_id IS NULL OR c.id=p_customer_id) AND p_interest_id IS NULL AND p_sale_id IS NULL
 ), originals AS (
  SELECT batch_id::text||':'||source_row::text key,customer_id,source_row,
   CASE WHEN count(DISTINCT interest_id)=1 THEN min(interest_id::text)::uuid END interest_id,
   CASE WHEN count(DISTINCT project_name)=1 THEN min(project_name) END project_name,
   to_jsonb(array_agg(DISTINCT project_name ORDER BY project_name)) project_names,
   CASE WHEN count(DISTINCT interest_id)=1 AND count(DISTINCT sale_id)=1 THEN min(sale_id::text)::uuid END sale_id,
   jsonb_build_array(jsonb_build_object('kind','visited','date',min(visit_day),'precision',CASE WHEN min(visit_day) IS NULL THEN 'unknown' ELSE 'day' END)) events,0 priority
  FROM original_members GROUP BY batch_id,source_row,customer_id
 ), creation AS (
  SELECT 'source:'||r.source_key key,r.customer_id,r.source_row,r.interest_id,i.project_name,jsonb_build_array(i.project_name) project_names,NULL::uuid sale_id,
   (SELECT coalesce(jsonb_agg(jsonb_build_object('kind',e.kind,'date',to_char(e.event_day,'YYYY-MM-DD'),'precision',e.precision) ORDER BY e.event_key),'[]')
     FROM sales_source_creation_private.events e WHERE e.record_id=r.id) events,1 priority
  FROM sales_source_creation_private.records r JOIN public.lead_project_interests i ON i.id=r.interest_id
  WHERE (p_customer_id IS NULL OR r.customer_id=p_customer_id) AND (p_interest_id IS NULL OR r.interest_id=p_interest_id)
   AND (p_project_name IS NULL OR i.project_name=p_project_name)
 ), unknown_rows AS (
  SELECT coalesce((SELECT min(s.batch_id::text)||':'||r.row_number::text FROM crm_external_private.source_records s
    JOIN public.sales_customers c ON c.id=r.customer_id AND c.external_snapshot_batch_id=s.batch_id AND c.external_customer_key=s.customer_key WHERE s.source_row=r.row_number),'unknown:'||r.source_key) key,
   r.customer_id,r.row_number source_row,r.interest_id,i.project_name,CASE WHEN i.project_name IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(i.project_name) END project_names,NULL::uuid sale_id,
   (SELECT coalesce(jsonb_agg(jsonb_build_object('kind',e.kind,'date',to_char(e.occurred_date,'YYYY-MM-DD'),'precision',e.precision) ORDER BY e.sequence),'[]')
    FROM sales_unknown_history_private.events e WHERE e.batch_id=r.batch_id AND e.source_key=r.source_key) events,2 priority
  FROM sales_unknown_history_private.records r LEFT JOIN public.lead_project_interests i ON i.id=r.interest_id
  WHERE (p_customer_id IS NULL OR r.customer_id=p_customer_id) AND (p_interest_id IS NULL OR r.interest_id=p_interest_id)
   AND (p_project_name IS NULL OR i.project_name=p_project_name OR r.reason='unknown_project')
 ), revised AS (
  SELECT coalesce((SELECT min(s.batch_id::text)||':'||e.source_row::text FROM crm_external_private.source_records s
    JOIN public.sales_customers c ON c.id=e.customer_id AND c.external_snapshot_batch_id=s.batch_id AND c.external_customer_key=s.customer_key WHERE s.source_row=e.source_row),'revision:'||e.source_key) key,
   e.customer_id,e.source_row,e.interest_id,i.project_name,jsonb_build_array(i.project_name) project_names,e.sale_id,e.source_history events,3 priority
  FROM sales_revision_private.events e JOIN public.lead_project_interests i ON i.id=e.interest_id
  WHERE (p_customer_id IS NULL OR e.customer_id=p_customer_id) AND (p_interest_id IS NULL OR e.interest_id=p_interest_id)
   AND (p_project_name IS NULL OR i.project_name=p_project_name)
 ), all_rows AS (SELECT * FROM originals UNION ALL SELECT * FROM original_unassigned UNION ALL SELECT * FROM creation UNION ALL SELECT * FROM unknown_rows UNION ALL SELECT * FROM revised),
 chosen AS (SELECT DISTINCT ON(key) * FROM all_rows ORDER BY key,priority DESC),
 scoped AS (SELECT * FROM chosen WHERE p_sale_id IS NULL OR sale_id=p_sale_id)
 SELECT coalesce(jsonb_agg(jsonb_build_object('key',key,'customerId',customer_id,'projectName',project_name,'projectNames',project_names,'interestId',interest_id,'saleId',sale_id,'sourceRow',source_row,'events',events) ORDER BY key),'[]') INTO result FROM scoped;
 IF jsonb_array_length(result)>10000 THEN RAISE EXCEPTION 'CRM_CUSTOMER_HISTORY_LIMIT'; END IF;
 -- Original booking days come through the unchanged provenance verifier, not
 -- through guessed timestamps. Revision records already contain their full
 -- approved visit/booking/cancellation timeline.
 FOR loop_entry IN SELECT value item FROM jsonb_array_elements(result) WHERE value->'saleId'<>'null'::jsonb LOOP
  IF NOT EXISTS(SELECT 1 FROM sales_revision_private.events WHERE sale_id=(loop_entry.item->>'saleId')::uuid) THEN
   SELECT sales_private.crm_booking_imported_history(to_jsonb(s)) INTO h FROM public.sales s WHERE id=(loop_entry.item->>'saleId')::uuid;
   IF h IS NULL THEN RAISE EXCEPTION 'CRM_CUSTOMER_HISTORY_INTEGRITY_REQUIRED'; END IF;
   h:=jsonb_build_array(jsonb_build_object('kind','booked','date',h->'bookedDate','precision',CASE WHEN h->>'bookedDate' IS NULL THEN 'unknown' ELSE 'day' END))
    ||CASE WHEN h->>'sourceStage'='cancelled' THEN jsonb_build_array(jsonb_build_object('kind','cancelled','date',h->'cancelledDate','precision',CASE WHEN h->>'cancelledDate' IS NULL THEN 'unknown' ELSE 'day' END)) ELSE '[]'::jsonb END
    ||CASE WHEN h->>'sourceStage'='transferred' THEN jsonb_build_array(jsonb_build_object('kind','transferred','date',h->'transferredDate','precision',CASE WHEN h->>'transferredDate' IS NULL THEN 'unknown' ELSE 'day' END)) ELSE '[]'::jsonb END;
   SELECT jsonb_agg(CASE WHEN value->>'key'=loop_entry.item->>'key' THEN value||jsonb_build_object('events',value->'events'||h) ELSE value END ORDER BY ordinality) INTO result FROM jsonb_array_elements(result) WITH ORDINALITY;
  END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(result) rr CROSS JOIN LATERAL jsonb_array_elements(rr->'events') ev
  WHERE ev->>'kind' NOT IN('visited','booked','contracted','loan_submitted','transferred','handover','cancelled') OR ev->>'kind' IS NULL
   OR ((ev->>'precision'='unknown' AND ev->'date'='null') OR (ev->>'precision'='day' AND jsonb_typeof(ev->'date')='string'
    AND ev->>'date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND pg_input_is_valid(ev->>'date','date'))) IS DISTINCT FROM true)
  THEN RAISE EXCEPTION 'CRM_CUSTOMER_HISTORY_DATE_INVALID'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(result) rr CROSS JOIN LATERAL jsonb_array_elements(rr->'events') ev
  GROUP BY rr->>'key',ev->>'kind' HAVING count(*)>1) THEN RAISE EXCEPTION 'CRM_CUSTOMER_HISTORY_INTEGRITY_REQUIRED'; END IF;
 RETURN result;
END;
$records$;
REVOKE ALL ON FUNCTION sales_history_read_private.records(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION sales_history_read_private.customer_history(p_customer_id uuid,p_interest_id uuid,p_sale_id uuid,p_page integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE rows jsonb; result jsonb;
BEGIN
 IF p_customer_id IS NULL OR p_page IS NULL OR p_page NOT BETWEEN 0 AND 100000 THEN RAISE EXCEPTION 'CRM_CUSTOMER_HISTORY_INVALID_INPUT'; END IF;
 rows:=sales_history_read_private.records(p_customer_id,p_interest_id,p_sale_id,NULL);
 SELECT coalesce(jsonb_agg(value ORDER BY ordinality),'[]') INTO result FROM jsonb_array_elements(rows) WITH ORDINALITY WHERE ordinality>p_page*50 AND ordinality<=(p_page+1)*50;
 RETURN jsonb_build_object('contractVersion','historical_customer_evidence_v1','actor',jsonb_build_object('userId',auth.uid(),'role',public.crm_v2_role()),
  'customerId',p_customer_id,'interestId',p_interest_id,'saleId',p_sale_id,'page',p_page,'hasMore',jsonb_array_length(rows)>(p_page+1)*50,'readOnly',true,
  'records',result);
END; $$;
REVOKE ALL ON FUNCTION sales_history_read_private.customer_history(uuid,uuid,uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION sales_history_read_private.customer_history(uuid,uuid,uuid,integer) TO authenticated;
CREATE FUNCTION public.crm_v2_customer_history(p_customer_id uuid,p_interest_id uuid DEFAULT NULL,p_sale_id uuid DEFAULT NULL,p_page integer DEFAULT 0)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT sales_history_read_private.customer_history(p_customer_id,p_interest_id,p_sale_id,p_page);
$$;
REVOKE ALL ON FUNCTION public.crm_v2_customer_history(uuid,uuid,uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_v2_customer_history(uuid,uuid,uuid,integer) TO authenticated;

-- Keep and call the FULL original 26-adapted reader before any merge. This is
-- deliberately an exact-body adapter: unknown definitions fail installation.
DO $excel_preserve$
DECLARE d text; b text; settings text[]; secured boolean; owner_name text;
BEGIN
 SELECT pg_get_functiondef(oid),replace(prosrc,E'\r\n',E'\n'),proconfig,prosecdef,pg_get_userbyid(proowner)
 INTO d,b,settings,secured,owner_name FROM pg_proc WHERE oid='crm_excel_private.evidence(text)'::regprocedure;
 IF md5(replace(b,'sales_import_private.expected_transfer_date(sale.id,s.payload->''reviewedHistory''->>''expectedTransferDate'') AS source_day','s.payload->''reviewedHistory''->>''expectedTransferDate'' AS source_day'))<>'738a8d0787d234d2fd06dce3966bdc11'
  OR owner_name<>current_user OR NOT secured OR settings IS DISTINCT FROM ARRAY['search_path=pg_catalog','TimeZone=UTC','DateStyle=ISO, YMD']
  OR strpos(b,'sales_import_private.expected_transfer_date(sale.id,')=0 THEN RAISE EXCEPTION 'CRM_CUSTOMER_HISTORY_EXCEL_REVIEW_REQUIRED'; END IF;
 EXECUTE replace(d,'crm_excel_private.evidence(','sales_history_read_private.original_excel(');
END;
$excel_preserve$;
REVOKE ALL ON FUNCTION sales_history_read_private.original_excel(text) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION crm_excel_private.evidence(p_project_name text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' SET datestyle='ISO, YMD' AS $$
DECLARE original jsonb; rows jsonb; visits jsonb; unassigned jsonb; forecasts jsonb; pending jsonb; unknown_count integer; unknown_unassigned integer;
BEGIN
 original:=sales_history_read_private.original_excel(p_project_name);
 rows:=sales_history_read_private.records(NULL,NULL,NULL,p_project_name);
 -- Original known-project/unassigned rows are replaced only by the exact
 -- approved source-lineage key. Unknown dates remain counters, never fake days.
 WITH selected AS (SELECT value r FROM jsonb_array_elements(rows)),
 source_visits AS (SELECT r,e FROM selected CROSS JOIN LATERAL jsonb_array_elements(r->'events') e WHERE e->>'kind'='visited'),
 merged AS (
  SELECT value v FROM jsonb_array_elements(original->'legacyVisits') WHERE NOT EXISTS(SELECT 1 FROM selected WHERE r->>'key'=value->>'key')
  UNION ALL SELECT jsonb_build_object('key',r->>'key','customerId',r->'customerId','visitDate',e->'date','leadDate',e->'date') FROM source_visits WHERE r->>'projectName'=p_project_name AND e->>'precision'='day'
 ) SELECT coalesce(jsonb_agg(v ORDER BY v->>'key'),'[]') INTO visits FROM merged;
 WITH selected AS (SELECT value r FROM jsonb_array_elements(rows)),
 source_visits AS (SELECT r,e FROM selected CROSS JOIN LATERAL jsonb_array_elements(r->'events') e WHERE e->>'kind'='visited'),
 merged AS (
  SELECT value v FROM jsonb_array_elements(original->'unassignedLegacyVisits') WHERE NOT EXISTS(SELECT 1 FROM selected WHERE r->>'key'=value->>'key')
  UNION ALL SELECT jsonb_build_object('key',r->>'key','customerId',r->'customerId','visitDate',e->'date','leadDate',e->'date') FROM source_visits WHERE r->'projectName'='null' AND e->>'precision'='day'
 ) SELECT coalesce(jsonb_agg(v ORDER BY v->>'key'),'[]') INTO unassigned FROM merged;
 SELECT count(*) INTO unknown_count FROM jsonb_array_elements(rows) r CROSS JOIN LATERAL jsonb_array_elements(r->'events') e WHERE r->>'projectName'=p_project_name AND e->>'kind'='visited' AND e->>'precision'='unknown';
 SELECT count(*) INTO unknown_unassigned FROM jsonb_array_elements(rows) r CROSS JOIN LATERAL jsonb_array_elements(r->'events') e WHERE r->'projectName'='null' AND e->>'kind'='visited' AND e->>'precision'='unknown';
 SELECT coalesce(jsonb_agg(k ORDER BY k),'[]') INTO pending FROM jsonb_array_elements(original->'pendingLegacyKeys') k
 WHERE NOT EXISTS(SELECT 1 FROM sales_source_creation_private.records r JOIN crm_external_private.source_records s ON s.source_row=r.source_row
  JOIN crm_external_private.snapshot_batches b ON b.id=s.batch_id AND b.feed='customer-sheet' WHERE s.entity_key=r.source_key AND k#>>'{}'=s.batch_id::text||':'||s.source_row::text);
 SELECT coalesce(jsonb_agg(jsonb_build_object('saleId',f->'saleId','expectedTransferDate',sales_import_private.expected_transfer_date((f->>'saleId')::uuid,f->>'expectedTransferDate')) ORDER BY f->>'saleId'),'[]') INTO forecasts FROM jsonb_array_elements(original->'forecasts') f;
 RETURN original||jsonb_build_object('legacyVisits',visits,'unassignedLegacyVisits',unassigned,'forecasts',forecasts,'pendingLegacyKeys',pending,
  'pendingLegacyRows',jsonb_array_length(pending),'unknownLegacyDates',unknown_count,'unknownUnassignedLegacyDates',unknown_unassigned);
END; $$;
-- CREATE OR REPLACE retains the existing Excel function's owner and grants.

-- LOCAL DESIGN ONLY. Administrative retirement is not customer cancellation.
-- Six reviewed source rows only; preserve Customer, Interest and immutable source.
-- Requires reviewed 18/21/22/25-29 and the actual plot writer/sync guards.
-- No public RPC, remote installer, flag changes or production execution.

-- Design sentinel cleared only in this reviewed installation artifact.
SET LOCAL lock_timeout='2s';
CREATE SCHEMA rental_source_retirement_private;
REVOKE ALL ON SCHEMA rental_source_retirement_private FROM PUBLIC,anon,authenticated;
CREATE TABLE rental_source_retirement_private.reviews(
 dataset_key text PRIMARY KEY,manifest jsonb NOT NULL,actor_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE rental_source_retirement_private.batches(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),dataset_key text UNIQUE NOT NULL REFERENCES rental_source_retirement_private.reviews,
 payload jsonb NOT NULL,review_reference text NOT NULL CHECK(length(btrim(review_reference))>0),actor_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
-- sale_id intentionally has NO FK to the row being retired. Other identities stay.
CREATE TABLE rental_source_retirement_private.archives(
 sale_id uuid PRIMARY KEY,batch_id uuid NOT NULL REFERENCES rental_source_retirement_private.batches,
 customer_id uuid NOT NULL REFERENCES public.sales_customers ON DELETE RESTRICT,
 interest_id uuid NOT NULL REFERENCES public.lead_project_interests ON DELETE RESTRICT,
 plot_id text NOT NULL REFERENCES public.plots ON DELETE RESTRICT,
 old_batch_id uuid NOT NULL,source_row integer NOT NULL,before_image jsonb NOT NULL,after_plot jsonb NOT NULL,
 UNIQUE(old_batch_id,source_row)
);
CREATE TABLE rental_source_retirement_private.restores(
 batch_id uuid PRIMARY KEY REFERENCES rental_source_retirement_private.batches,actor_id uuid NOT NULL,
 review_reference text NOT NULL CHECK(length(btrim(review_reference))>0),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE rental_source_retirement_private.permits(
 transaction_id bigint NOT NULL,backend_pid integer NOT NULL,actor_id uuid NOT NULL,sale_id uuid NOT NULL,
 operation text NOT NULL CHECK(operation IN('retire','restore')),sale jsonb NOT NULL,old_plot jsonb NOT NULL,new_plot jsonb NOT NULL,
 PRIMARY KEY(transaction_id,backend_pid,sale_id)
);
CREATE FUNCTION rental_source_retirement_private.immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN RAISE EXCEPTION 'RENTAL_RETIREMENT_IMMUTABLE'; END; $$;
DO $$ DECLARE t text; BEGIN
 FOR t IN SELECT unnest(ARRAY['reviews','batches','archives','restores','permits']) LOOP
  EXECUTE format('ALTER TABLE rental_source_retirement_private.%I ENABLE ROW LEVEL SECURITY',t);
  IF t<>'permits' THEN EXECUTE format('CREATE TRIGGER retirement_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON rental_source_retirement_private.%I FOR EACH STATEMENT EXECUTE FUNCTION rental_source_retirement_private.immutable()',t); END IF;
 END LOOP;
END; $$;
CREATE FUNCTION rental_source_retirement_private.operator()
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF auth.uid() IS NULL OR current_user IS DISTINCT FROM pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='rental_source_retirement_private.reviews'::regclass))
 THEN RAISE EXCEPTION 'RENTAL_RETIREMENT_FORBIDDEN'; END IF;
 PERFORM 1 FROM sales_private.crm_user_roles WHERE user_id=auth.uid() AND role='admin' AND is_active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'RENTAL_RETIREMENT_FORBIDDEN'; END IF;
END; $$;
CREATE FUNCTION rental_source_retirement_private.keys(v jsonb,k text[])
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_typeof(v)='object' AND (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(v) key)=(SELECT array_agg(x ORDER BY x) FROM unnest(k) x);
$$;
-- Private operator records the independently verified offline manifest. This is
-- neither a public permission endpoint nor a replacement for source-file review.
CREATE FUNCTION rental_source_retirement_private.register_review(m jsonb)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE r jsonb;
BEGIN
 PERFORM rental_source_retirement_private.operator();
 IF m->>'version' IS DISTINCT FROM 'rental-source-retirement-inputs-v1'
  OR m->'businessWritesAllowed' IS DISTINCT FROM 'false'::jsonb OR m->'freshCaptureIncluded' IS DISTINCT FROM 'false'::jsonb
  OR m->>'sourceSha256' IS DISTINCT FROM '7193857ef04d6a092171749a25867b1ca8d1bbe8f7b83b04fa7473b3a3a69ffd'
  OR m->>'reviewSha256' IS DISTINCT FROM 'de4beaee70afa8de9e8866e328eabf8bdd25257eae7aa78eb89649712f381802'
  OR m->>'adapterPlanDigest' IS DISTINCT FROM '379da2e538829a3cb0379108b98851757c142eb010b1624543413116eef8a506'
  OR m->'approvedSourceRows' IS DISTINCT FROM '[859,951,954,958,959,960]'::jsonb
  OR jsonb_array_length(m->'records') IS DISTINCT FROM 6 OR m->>'datasetKey' IS DISTINCT FROM 'rental-source-retirement-'||(m->>'adapterPlanDigest')
  OR (SELECT jsonb_agg((v->>'sourceRow')::integer ORDER BY (v->>'sourceRow')::integer) FROM jsonb_array_elements(m->'records') v) IS DISTINCT FROM m->'approvedSourceRows'
 THEN RAISE EXCEPTION 'RENTAL_RETIREMENT_REVIEW_INVALID'; END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(m->'records') LOOP
  IF r->>'operation' IS DISTINCT FROM 'administrative_retirement' OR r->'sourceProgram' IS DISTINCT FROM 'null'::jsonb
   OR r->'executable' IS DISTINCT FROM 'false'::jsonb OR r->'cancellationDate' IS DISTINCT FROM 'null'::jsonb
   OR (r->>'sourceKey' ~ '^[a-f0-9]{64}$') IS DISTINCT FROM true OR (r->>'rowSha256' ~ '^[a-f0-9]{64}$') IS DISTINCT FROM true
   OR r->'sourceRentalEvidence'->>'column' IS DISTINCT FROM 'I' OR r->'sourceRentalEvidence'->>'classification' IS DISTINCT FROM 'rent_to_own'
   OR (r->'sourceRentalEvidence'->>'purchaseWithTenant')::boolean IS DISTINCT FROM ((r->>'sourceRow')::integer=958)
   OR r->'sourceRentalEvidence'->>'valueHash' IS DISTINCT FROM (CASE WHEN (r->>'sourceRow')::integer=958 THEN '3af33ceda424c6ae21edf3fa5536e61da429427614e65387323cd13de2f1d7de' ELSE 'e9df130d72a176aaefa42465bdd89d31e12b22a75c27f144ab280c0ac0be2364' END)
   OR jsonb_typeof(r->'history') IS DISTINCT FROM 'array' OR jsonb_array_length(r->'history') IS DISTINCT FROM 2
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(r->'history') e WHERE e->>'kind' NOT IN('visited','booked') OR e->>'kind' IS NULL
    OR ((e->>'precision'='unknown' AND e->'date'='null') OR (e->>'precision'='day' AND e->>'date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND pg_input_is_valid(e->>'date','date'))) IS DISTINCT FROM true)
  THEN RAISE EXCEPTION 'RENTAL_RETIREMENT_REVIEW_INVALID'; END IF;
 END LOOP;
 INSERT INTO rental_source_retirement_private.reviews(dataset_key,manifest,actor_id) VALUES(m->>'datasetKey',m,auth.uid());
END; $$;
CREATE FUNCTION rental_source_retirement_private.excluded(b uuid,n integer)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM rental_source_retirement_private.archives a WHERE a.old_batch_id=b AND a.source_row=n
  AND NOT EXISTS(SELECT 1 FROM rental_source_retirement_private.restores r WHERE r.batch_id=a.batch_id));
$$;
-- Scan ALL FK actions (including CASCADE/SET NULL), composite keys and common
-- unconstrained references. Lock children to prevent newly inserted dependents.
-- Installation review must additionally inventory JSON/opaque operational links.
CREATE FUNCTION rental_source_retirement_private.dependencies(s jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog SET lock_timeout='2s' AS $$
DECLARE c record; child_entry record; predicate text; rows jsonb; constraints jsonb:='[]'; unconstrained jsonb:='[]'; cols jsonb; parents jsonb;
BEGIN
 FOR c IN SELECT con.*,format('%I.%I',n.nspname,t.relname) AS tbl FROM pg_constraint con JOIN pg_class t ON t.oid=con.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
  WHERE con.contype='f' AND con.confrelid='public.sales'::regclass AND n.nspname<>'rental_source_retirement_private' ORDER BY tbl,con.conname LOOP
  EXECUTE format('LOCK TABLE %s IN SHARE ROW EXCLUSIVE MODE',c.tbl);
  SELECT string_agg(format('to_jsonb(x)->>%L IS NOT NULL AND to_jsonb(x)->%L=$1->%L',child.attname,child.attname,parent.attname),' AND ' ORDER BY k.ord),
   jsonb_agg(child.attname ORDER BY k.ord),jsonb_agg(parent.attname ORDER BY k.ord) INTO predicate,cols,parents
   FROM unnest(c.conkey,c.confkey) WITH ORDINALITY k(childnum,parentnum,ord)
   JOIN pg_attribute child ON child.attrelid=c.conrelid AND child.attnum=k.childnum
   JOIN pg_attribute parent ON parent.attrelid=c.confrelid AND parent.attnum=k.parentnum;
  IF predicate IS NULL THEN RAISE EXCEPTION 'RENTAL_RETIREMENT_CATALOG_REQUIRED'; END IF;
  EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text),''[]'') FROM %s x WHERE %s',c.tbl,predicate) INTO rows USING s;
  constraints:=constraints||jsonb_build_array(jsonb_build_object('table',c.tbl,'constraint',c.conname,'definition',pg_get_constraintdef(c.oid),'columns',cols,'parentColumns',parents,'rows',rows));
 END LOOP;
 FOR child_entry IN SELECT format('%I.%I',n.nspname,t.relname) tbl,a.attname FROM pg_attribute a JOIN pg_class t ON t.oid=a.attrelid JOIN pg_namespace n ON n.oid=t.relnamespace
  WHERE t.relkind IN('r','p') AND a.attnum>0 AND NOT a.attisdropped AND a.attname IN('sale_id','legacy_sale_id','entity_id')
   AND n.nspname NOT LIKE 'pg_%' AND n.nspname NOT IN('information_schema','rental_source_retirement_private') ORDER BY tbl,a.attname LOOP
  EXECUTE format('LOCK TABLE %s IN SHARE ROW EXCLUSIVE MODE',child_entry.tbl);
  EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text),''[]'') FROM %s x WHERE to_jsonb(x)->>%L=$1',child_entry.tbl,child_entry.attname) INTO rows USING s->>'id';
  unconstrained:=unconstrained||jsonb_build_array(jsonb_build_object('table',child_entry.tbl,'column',child_entry.attname,'rows',rows));
 END LOOP;
 RETURN jsonb_build_object('constraints',constraints,'unconstrained',unconstrained);
END; $$;
CREATE FUNCTION rental_source_retirement_private.source(s jsonb,c jsonb,n integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE p jsonb;h jsonb;sr jsonb;w jsonb;receipt text;
BEGIN
 SELECT to_jsonb(x) INTO p FROM crm_external_private.prepared_booking_sales x WHERE id=(s->>'id')::uuid AND batch_id=(c->>'external_snapshot_batch_id')::uuid;
 SELECT to_jsonb(x) INTO h FROM crm_external_private.booking_history x WHERE batch_id=(p->>'batch_id')::uuid AND entity_key=p->>'booking_key' AND source_row=n;
 SELECT to_jsonb(x) INTO sr FROM crm_external_private.source_records x WHERE batch_id=(p->>'batch_id')::uuid AND source_row=n;
 SELECT to_jsonb(x) INTO w FROM crm_external_private.booking_writer_releases x WHERE batch_id=(p->>'batch_id')::uuid;
 SELECT md5(to_jsonb(x)::text) INTO receipt FROM crm_external_private.sales_cutover_receipts x WHERE batch_id=(p->>'batch_id')::uuid;
 IF p IS NULL OR h IS NULL OR sr IS NULL OR w IS NULL OR receipt IS NULL OR (p->'payload'->>'source_row')::integer IS DISTINCT FROM n
  OR (s->>'booking_revision' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') IS DISTINCT FROM true
  OR sr->>'customer_key' IS DISTINCT FROM c->>'external_customer_key' OR p->>'stage' IS DISTINCT FROM 'booked'
  OR p->'payload'->>'customer_id' IS DISTINCT FROM c->>'id' OR p->'payload'->>'interest_id' IS DISTINCT FROM s->>'project_interest_id'
  OR p->>'plot_id' IS DISTINCT FROM s->>'plot_id'
  OR NOT EXISTS(SELECT 1 FROM crm_external_private.snapshot_batches sb WHERE sb.id=(p->>'batch_id')::uuid AND sb.feed='customer-sheet' AND sb.plan_digest=w->>'plan_digest')
  -- Original cutover receipts predate the additive booking_revision column.
  -- A receipt that already contains that field remains exact, including NULL.
  -- Only a genuinely absent field is projected from the captured current UUID;
  -- apply separately binds that UUID to reviewed referenceRevisions.sale before
  -- any write. Every other typed Sale field must still match the original archive.
  OR NOT EXISTS(SELECT 1 FROM crm_external_private.sales_cutover_receipts x CROSS JOIN LATERAL jsonb_array_elements(x.after_sales) member
   WHERE x.batch_id=(p->>'batch_id')::uuid AND member->>'id'=s->>'id'
    AND to_jsonb(jsonb_populate_record(NULL::public.sales,CASE WHEN member ? 'booking_revision' THEN member
     ELSE member||jsonb_build_object('booking_revision',s->'booking_revision') END))=s)
  OR EXISTS(SELECT 1 FROM crm_external_private.sales_rollback_receipts WHERE batch_id=(p->>'batch_id')::uuid)
 THEN RAISE EXCEPTION 'RENTAL_RETIREMENT_SOURCE_REQUIRED'; END IF;
 RETURN jsonb_build_object('preparedBooking',p,'bookingHistory',h,'sourceRecord',sr,'cutoverReceiptDigest',receipt,'writerRelease',w);
END; $$;
CREATE FUNCTION rental_source_retirement_private.capture(b jsonb,n integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog SET lock_timeout='2s' AS $$
DECLARE c jsonb;i jsonb;s jsonb;p jsonb;inventory jsonb;
BEGIN
 PERFORM rental_source_retirement_private.operator();
 LOCK TABLE public.sales IN SHARE ROW EXCLUSIVE MODE;
 SELECT to_jsonb(x) INTO c FROM public.sales_customers x WHERE id=(b->>'customerId')::uuid FOR UPDATE;
 SELECT to_jsonb(x) INTO i FROM public.lead_project_interests x WHERE id=(b->>'interestId')::uuid FOR UPDATE;
 SELECT to_jsonb(x) INTO p FROM public.plots x WHERE id=b->>'plotId' FOR UPDATE;
 SELECT to_jsonb(x) INTO s FROM public.sales x WHERE id=(b->>'saleId')::uuid FOR UPDATE;
 SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') INTO inventory FROM public.sales x WHERE plot_id=b->>'plotId';
 IF c IS NULL OR i IS NULL OR s IS NULL OR p IS NULL THEN RAISE EXCEPTION 'RENTAL_RETIREMENT_NOT_FOUND'; END IF;
 RETURN jsonb_build_object('customer',c,'interest',i,'sale',s,'plot',p,'inventory',inventory,
  'dependencies',rental_source_retirement_private.dependencies(s),'source',rental_source_retirement_private.source(s,c,n));
END; $$;
CREATE FUNCTION rental_source_retirement_private.sale_allowed(op text,old_row jsonb,new_row jsonb)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM rental_source_retirement_private.permits p WHERE p.transaction_id=txid_current() AND p.backend_pid=pg_backend_pid()
  AND p.actor_id=auth.uid() AND ((op='DELETE' AND p.operation='retire' AND p.sale=old_row AND new_row IS NULL)
   OR (op='INSERT' AND p.operation='restore' AND p.sale=new_row AND old_row IS NULL)));
$$;
CREATE FUNCTION rental_source_retirement_private.plot_allowed(old_row jsonb,new_row jsonb)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM rental_source_retirement_private.permits p WHERE p.transaction_id=txid_current() AND p.backend_pid=pg_backend_pid()
  AND p.actor_id=auth.uid() AND p.old_plot=old_row AND p.new_plot=new_row);
$$;
CREATE FUNCTION rental_source_retirement_private.apply(p_payload jsonb,p_review text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog SET lock_timeout='2s' SET timezone='UTC' SET datestyle='ISO, YMD' AS $$
DECLARE m jsonb;r jsonb;approved jsonb;b jsonb;plot_after jsonb;existing rental_source_retirement_private.batches%ROWTYPE;batch uuid;inv jsonb;archive_entry record;
BEGIN
 PERFORM rental_source_retirement_private.operator();
 LOCK TABLE public.sales IN SHARE ROW EXCLUSIVE MODE;
 SELECT manifest INTO m FROM rental_source_retirement_private.reviews WHERE dataset_key=p_payload->>'datasetKey' FOR SHARE;
 IF m IS NULL OR p_payload->>'version' IS DISTINCT FROM 'reviewed-rental-source-retirement-v1'
  OR NOT rental_source_retirement_private.keys(p_payload,ARRAY['version','datasetKey','sourceSha256','reviewSha256','adapterPlanDigest','records'])
  OR p_payload->'sourceSha256' IS DISTINCT FROM m->'sourceSha256' OR p_payload->'reviewSha256' IS DISTINCT FROM m->'reviewSha256'
  OR p_payload->'adapterPlanDigest' IS DISTINCT FROM m->'adapterPlanDigest' OR coalesce(length(btrim(p_review)),0)=0
  OR jsonb_array_length(p_payload->'records') IS DISTINCT FROM 6
  OR (SELECT jsonb_agg((v->>'sourceRow')::integer ORDER BY (v->>'sourceRow')::integer) FROM jsonb_array_elements(p_payload->'records') v) IS DISTINCT FROM m->'approvedSourceRows'
 THEN RAISE EXCEPTION 'RENTAL_RETIREMENT_INVALID_INPUT'; END IF;
 SELECT * INTO existing FROM rental_source_retirement_private.batches WHERE dataset_key=p_payload->>'datasetKey';
 IF existing.id IS NOT NULL THEN
  IF existing.payload IS DISTINCT FROM p_payload OR existing.review_reference IS DISTINCT FROM p_review THEN RAISE EXCEPTION 'RENTAL_RETIREMENT_REPLAY_CONFLICT'; END IF;
  IF EXISTS(SELECT 1 FROM rental_source_retirement_private.restores WHERE batch_id=existing.id) THEN RAISE EXCEPTION 'RENTAL_RETIREMENT_ALREADY_RESTORED'; END IF;
  IF EXISTS(SELECT 1 FROM rental_source_retirement_private.archives a JOIN public.sales s ON s.id=a.sale_id WHERE a.batch_id=existing.id) THEN RAISE EXCEPTION 'RENTAL_RETIREMENT_REPLAY_STALE'; END IF;
  IF (SELECT count(*) FROM rental_source_retirement_private.archives WHERE batch_id=existing.id)<>6 THEN RAISE EXCEPTION 'RENTAL_RETIREMENT_REPLAY_STALE'; END IF;
  FOR archive_entry IN SELECT * FROM rental_source_retirement_private.archives WHERE batch_id=existing.id LOOP
   b:=archive_entry.before_image;
   IF (SELECT to_jsonb(c) FROM public.sales_customers c WHERE id=archive_entry.customer_id) IS DISTINCT FROM b->'customer'
    OR (SELECT to_jsonb(i) FROM public.lead_project_interests i WHERE id=archive_entry.interest_id) IS DISTINCT FROM b->'interest'
    OR (SELECT to_jsonb(p) FROM public.plots p WHERE id=archive_entry.plot_id) IS DISTINCT FROM archive_entry.after_plot
    OR (SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY id),'[]') FROM public.sales s WHERE plot_id=archive_entry.plot_id) IS DISTINCT FROM (SELECT coalesce(jsonb_agg(s ORDER BY s->>'id'),'[]') FROM jsonb_array_elements(b->'inventory') s WHERE s->>'id'<>archive_entry.sale_id::text)
    OR rental_source_retirement_private.source(b->'sale',b->'customer',archive_entry.source_row) IS DISTINCT FROM b->'source'
    OR rental_source_retirement_private.dependencies(b->'sale') IS DISTINCT FROM b->'dependencies'
   THEN RAISE EXCEPTION 'RENTAL_RETIREMENT_REPLAY_STALE'; END IF;
  END LOOP;
  RETURN jsonb_build_object('batchId',existing.id,'retired',6,'replayed',true);
 END IF;
 -- Validate every target before the first write. Locks last through the transaction.
 FOR r IN SELECT value FROM jsonb_array_elements(p_payload->'records') ORDER BY (value->>'sourceRow')::integer LOOP
  SELECT value INTO approved FROM jsonb_array_elements(m->'records') WHERE value->'sourceRow'=r->'sourceRow';
  IF NOT rental_source_retirement_private.keys(r,ARRAY['sourceRow','sourceKey','rowSha256','operation','sourceRentalEvidence','binding','history','before'])
   OR r-ARRAY['before'] IS DISTINCT FROM jsonb_build_object('sourceRow',approved->'sourceRow','sourceKey',approved->'sourceKey','rowSha256',approved->'rowSha256','operation',approved->'operation','sourceRentalEvidence',approved->'sourceRentalEvidence','binding',approved->'binding','history',approved->'history')
  THEN RAISE EXCEPTION 'RENTAL_RETIREMENT_BINDING_CHANGED'; END IF;
  b:=rental_source_retirement_private.capture(r->'binding',(r->>'sourceRow')::integer);
  PERFORM sales_private.crm_booking_imported_history(b->'sale');
  IF b IS DISTINCT FROM r->'before' THEN RAISE EXCEPTION 'RENTAL_RETIREMENT_STALE'; END IF;
  IF b->'customer'->>'merged_into_customer_id' IS NOT NULL OR b->'interest'->>'customer_id' IS DISTINCT FROM b->'customer'->>'id'
   OR b->'interest'->>'project_name' IS DISTINCT FROM b->'plot'->>'project_name' OR b->'sale'->>'project_interest_id' IS DISTINCT FROM b->'interest'->>'id'
   OR b->'sale'->>'plot_id' IS DISTINCT FROM b->'plot'->>'id' OR b->'sale'->>'external_booking_id' IS DISTINCT FROM b->'sale'->>'id'
   OR b->'sale'->>'crm_stage' IS DISTINCT FROM 'booked' OR b->'sale'->>'contract_status' IS DISTINCT FROM 'Reserved'
   OR b->'sale'->>'external_source_stage' IS DISTINCT FROM 'booked' OR b->'sale'->>'booking_route' IS DISTINCT FROM 'legacy_import'
   OR b->'sale'->>'lead_id' IS NOT NULL OR b->'sale'->>'historical_import_id' IS NOT NULL OR b->'sale'->>'historical_revision_id' IS NOT NULL
   OR EXISTS(SELECT 1 FROM unnest(ARRAY['booked_at','contracted_at','cancelled_at','transferred_at','crm_handover_at','crm_transfer_date','crm_handover_date']) k WHERE b->'sale'->>k IS NOT NULL)
   OR b->'customer'->>'external_snapshot_batch_id' IS DISTINCT FROM approved->>'sourceBatchId'
   OR b->'customer'->>'external_customer_key' IS DISTINCT FROM approved->>'customerSourceKey'
   OR b->'interest'->>'external_interest_key' IS DISTINCT FROM approved->>'interestSourceKey'
   OR b->'customer'->'lifecycle_revision' IS DISTINCT FROM approved->'referenceRevisions'->'customer'
   OR b->'interest'->'lifecycle_revision' IS DISTINCT FROM approved->'referenceRevisions'->'interest'
   OR b->'sale'->'booking_revision' IS DISTINCT FROM approved->'referenceRevisions'->'sale'
  THEN RAISE EXCEPTION 'RENTAL_RETIREMENT_TRANSACTION_ADVANCED'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(b->'dependencies'->'constraints') d WHERE d->'rows'<>'[]')
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(b->'dependencies'->'unconstrained') d WHERE d->'rows'<>'[]')
  THEN RAISE EXCEPTION 'RENTAL_RETIREMENT_DEPENDENCIES'; END IF;
  -- Narrow policy: this is the only live deal; cancelled rounds are preserved.
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(b->'inventory') s WHERE s->>'id'<>b->'sale'->>'id'
   AND (s->>'crm_stage' IS DISTINCT FROM 'cancelled' OR s->>'contract_status' IS DISTINCT FROM 'Cancelled'))
   OR b->'plot'->'has_customer' IS DISTINCT FROM 'true'::jsonb OR lower(coalesce(b->'plot'->>'sale_status',''))='transferred'
  THEN RAISE EXCEPTION 'RENTAL_RETIREMENT_STOCK_REVIEW_REQUIRED'; END IF;
 END LOOP;
 INSERT INTO rental_source_retirement_private.batches(dataset_key,payload,review_reference,actor_id) VALUES(p_payload->>'datasetKey',p_payload,p_review,auth.uid()) RETURNING id INTO batch;
 FOR r IN SELECT value FROM jsonb_array_elements(p_payload->'records') ORDER BY (value->>'sourceRow')::integer LOOP
  b:=r->'before';plot_after:=b->'plot'||jsonb_build_object('has_customer',false);
  INSERT INTO rental_source_retirement_private.archives VALUES((r->'binding'->>'saleId')::uuid,batch,(r->'binding'->>'customerId')::uuid,(r->'binding'->>'interestId')::uuid,r->'binding'->>'plotId',(b->'customer'->>'external_snapshot_batch_id')::uuid,(r->>'sourceRow')::integer,b,plot_after);
  INSERT INTO rental_source_retirement_private.permits VALUES(txid_current(),pg_backend_pid(),auth.uid(),(r->'binding'->>'saleId')::uuid,'retire',b->'sale',b->'plot',plot_after);
  DELETE FROM public.sales WHERE id=(r->'binding'->>'saleId')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'RENTAL_RETIREMENT_STALE'; END IF;
  -- Actual sync trigger must have produced the complete predicted plot image.
  IF (SELECT to_jsonb(p) FROM public.plots p WHERE id=r->'binding'->>'plotId') IS DISTINCT FROM plot_after
   OR (SELECT to_jsonb(c) FROM public.sales_customers c WHERE id=(r->'binding'->>'customerId')::uuid) IS DISTINCT FROM b->'customer'
   OR (SELECT to_jsonb(i) FROM public.lead_project_interests i WHERE id=(r->'binding'->>'interestId')::uuid) IS DISTINCT FROM b->'interest'
  THEN RAISE EXCEPTION 'RENTAL_RETIREMENT_AFTER_IMAGE_REQUIRED'; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY id),'[]') INTO inv FROM public.sales s WHERE plot_id=r->'binding'->>'plotId';
  IF inv IS DISTINCT FROM (SELECT coalesce(jsonb_agg(s ORDER BY s->>'id'),'[]') FROM jsonb_array_elements(b->'inventory') s WHERE s->>'id'<>r->'binding'->>'saleId') THEN RAISE EXCEPTION 'RENTAL_RETIREMENT_AFTER_IMAGE_REQUIRED'; END IF;
 END LOOP;
 DELETE FROM rental_source_retirement_private.permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid();
 RETURN jsonb_build_object('batchId',batch,'retired',6,'replayed',false);
END; $$;
CREATE FUNCTION rental_source_retirement_private.restore(p_batch uuid,p_review text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog SET lock_timeout='2s' SET timezone='UTC' SET datestyle='ISO, YMD' AS $$
DECLARE archive_entry record;current_inventory jsonb;restored_inventory jsonb;b jsonb;
BEGIN
 PERFORM rental_source_retirement_private.operator();
 LOCK TABLE public.sales IN SHARE ROW EXCLUSIVE MODE;
 IF coalesce(length(btrim(p_review)),0)=0 OR NOT EXISTS(SELECT 1 FROM rental_source_retirement_private.batches WHERE id=p_batch) THEN RAISE EXCEPTION 'RENTAL_RETIREMENT_RESTORE_INVALID'; END IF;
 IF EXISTS(SELECT 1 FROM rental_source_retirement_private.restores WHERE batch_id=p_batch) THEN RAISE EXCEPTION 'RENTAL_RETIREMENT_ALREADY_RESTORED'; END IF;
 IF (SELECT count(*) FROM rental_source_retirement_private.archives WHERE batch_id=p_batch)<>6
  OR EXISTS(SELECT 1 FROM rental_source_retirement_private.archives a JOIN rental_source_retirement_private.batches bt ON bt.id=a.batch_id WHERE a.batch_id=p_batch AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(bt.payload->'records') r WHERE r->'before'=a.before_image AND (r->'binding'->>'saleId')::uuid=a.sale_id AND (r->>'sourceRow')::integer=a.source_row))
 THEN RAISE EXCEPTION 'RENTAL_RETIREMENT_RESTORE_INVALID'; END IF;
 FOR archive_entry IN SELECT * FROM rental_source_retirement_private.archives WHERE batch_id=p_batch ORDER BY source_row LOOP
  b:=archive_entry.before_image;
  PERFORM 1 FROM public.sales_customers WHERE id=archive_entry.customer_id FOR UPDATE;
  PERFORM 1 FROM public.lead_project_interests WHERE id=archive_entry.interest_id FOR UPDATE;
  PERFORM 1 FROM public.plots WHERE id=archive_entry.plot_id FOR UPDATE;
  SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY id),'[]') INTO current_inventory FROM public.sales s WHERE plot_id=archive_entry.plot_id;
  IF EXISTS(SELECT 1 FROM public.sales WHERE id=archive_entry.sale_id)
   OR (SELECT to_jsonb(c) FROM public.sales_customers c WHERE id=archive_entry.customer_id) IS DISTINCT FROM b->'customer'
   OR (SELECT to_jsonb(i) FROM public.lead_project_interests i WHERE id=archive_entry.interest_id) IS DISTINCT FROM b->'interest'
   OR (SELECT to_jsonb(p) FROM public.plots p WHERE id=archive_entry.plot_id) IS DISTINCT FROM archive_entry.after_plot
   OR current_inventory IS DISTINCT FROM (SELECT coalesce(jsonb_agg(s ORDER BY s->>'id'),'[]') FROM jsonb_array_elements(b->'inventory') s WHERE s->>'id'<>archive_entry.sale_id::text)
   OR rental_source_retirement_private.source(b->'sale',b->'customer',archive_entry.source_row) IS DISTINCT FROM b->'source'
   OR rental_source_retirement_private.dependencies(b->'sale') IS DISTINCT FROM b->'dependencies'
   OR NOT rental_source_retirement_private.keys(b->'sale',(SELECT array_agg(attname::text) FROM pg_attribute WHERE attrelid='public.sales'::regclass AND attnum>0 AND NOT attisdropped))
   OR EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.sales'::regclass AND attnum>0 AND NOT attisdropped AND (attgenerated<>'' OR attidentity<>''))
  THEN RAISE EXCEPTION 'RENTAL_RETIREMENT_RESTORE_STALE'; END IF;
 END LOOP;
 FOR archive_entry IN SELECT * FROM rental_source_retirement_private.archives WHERE batch_id=p_batch ORDER BY source_row LOOP
  b:=archive_entry.before_image;
  INSERT INTO rental_source_retirement_private.permits VALUES(txid_current(),pg_backend_pid(),auth.uid(),archive_entry.sale_id,'restore',b->'sale',archive_entry.after_plot,b->'plot');
  INSERT INTO public.sales SELECT (jsonb_populate_record(NULL::public.sales,b->'sale')).*;
  SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY id),'[]') INTO restored_inventory FROM public.sales s WHERE plot_id=archive_entry.plot_id;
  IF (SELECT to_jsonb(p) FROM public.plots p WHERE id=archive_entry.plot_id) IS DISTINCT FROM b->'plot' OR restored_inventory IS DISTINCT FROM b->'inventory'
   OR (SELECT to_jsonb(c) FROM public.sales_customers c WHERE id=archive_entry.customer_id) IS DISTINCT FROM b->'customer'
   OR (SELECT to_jsonb(i) FROM public.lead_project_interests i WHERE id=archive_entry.interest_id) IS DISTINCT FROM b->'interest'
  THEN RAISE EXCEPTION 'RENTAL_RETIREMENT_RESTORE_AFTER_IMAGE_REQUIRED'; END IF;
  PERFORM sales_private.crm_booking_imported_history(b->'sale');
 END LOOP;
 INSERT INTO rental_source_retirement_private.restores(batch_id,actor_id,review_reference) VALUES(p_batch,auth.uid(),p_review);
 DELETE FROM rental_source_retirement_private.permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid();
 RETURN jsonb_build_object('batchId',p_batch,'restored',6);
END; $$;
-- Actual legacy sync remains unchanged; both reviewed bodies have identical SQL tokens.
DO $sync_review$
BEGIN
 IF (SELECT md5(replace(prosrc,E'\r\n',E'\n')) FROM pg_proc WHERE oid='public.sync_plot_customer_status()'::regprocedure) NOT IN ('d5d2314011924a3de7d7ef5cd33d1900','d14049d669231cf3b2435b42c869e011')
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.sales'::regclass AND tgfoid='public.sync_plot_customer_status()'::regprocedure AND tgname='trigger_sync_plot_customer_status' AND NOT tgisinternal AND tgenabled IN('O','A') AND tgtype=29)
 THEN RAISE EXCEPTION 'RENTAL_RETIREMENT_SYNC_REVIEW_REQUIRED'; END IF;
END;
$sync_review$;
DO $retirement_adapter_0$
DECLARE definition text; src text; settings text[]; secured boolean; owner_name text; marker text:='BEGIN';
BEGIN
 SELECT pg_get_functiondef(oid),replace(prosrc,E'\r\n',E'\n'),proconfig,prosecdef,pg_get_userbyid(proowner) INTO definition,src,settings,secured,owner_name FROM pg_proc WHERE oid='sales_private.crm_booking_protect_sale()'::regprocedure;
 IF md5(src) IS DISTINCT FROM '348ccb6c9931af01572a0922ef343fe5' OR owner_name IS DISTINCT FROM current_user OR secured IS DISTINCT FROM true
  OR settings IS DISTINCT FROM ARRAY['search_path=pg_catalog'] OR (length(src)-length(replace(src,marker,'')))/length(marker)<>1
 THEN RAISE EXCEPTION 'RENTAL_RETIREMENT_ADAPTER_REVIEW_REQUIRED'; END IF;
 EXECUTE replace(replace(definition,E'\r\n',E'\n'),marker,'BEGIN
 IF rental_source_retirement_private.sale_allowed(TG_OP,CASE WHEN TG_OP=''INSERT'' THEN NULL ELSE to_jsonb(OLD) END,CASE WHEN TG_OP=''DELETE'' THEN NULL ELSE to_jsonb(NEW) END) THEN RETURN CASE WHEN TG_OP=''DELETE'' THEN OLD ELSE NEW END; END IF;');
END;
$retirement_adapter_0$;
DO $retirement_adapter_1$
DECLARE definition text; src text; settings text[]; secured boolean; owner_name text; marker text:='BEGIN';
BEGIN
 SELECT pg_get_functiondef(oid),replace(prosrc,E'\r\n',E'\n'),proconfig,prosecdef,pg_get_userbyid(proowner) INTO definition,src,settings,secured,owner_name FROM pg_proc WHERE oid='crm_external_private.guard_cutover_sale()'::regprocedure;
 IF md5(src) IS DISTINCT FROM 'ae99dba517e82ad9f2f9c886e4060310' OR owner_name IS DISTINCT FROM current_user OR secured IS DISTINCT FROM true
  OR settings IS DISTINCT FROM ARRAY['search_path=""'] OR (length(src)-length(replace(src,marker,'')))/length(marker)<>1
 THEN RAISE EXCEPTION 'RENTAL_RETIREMENT_ADAPTER_REVIEW_REQUIRED'; END IF;
 EXECUTE replace(replace(definition,E'\r\n',E'\n'),marker,'BEGIN
 IF rental_source_retirement_private.sale_allowed(TG_OP,CASE WHEN TG_OP=''INSERT'' THEN NULL ELSE to_jsonb(OLD) END,CASE WHEN TG_OP=''DELETE'' THEN NULL ELSE to_jsonb(NEW) END) THEN RETURN CASE WHEN TG_OP=''DELETE'' THEN OLD ELSE NEW END; END IF;');
END;
$retirement_adapter_1$;
DO $retirement_adapter_2$
DECLARE definition text; src text; settings text[]; secured boolean; owner_name text; marker text:='BEGIN';
BEGIN
 SELECT pg_get_functiondef(oid),replace(prosrc,E'\r\n',E'\n'),proconfig,prosecdef,pg_get_userbyid(proowner) INTO definition,src,settings,secured,owner_name FROM pg_proc WHERE oid='crm_external_private.guard_booking_plot_stock()'::regprocedure;
 IF md5(src) IS DISTINCT FROM 'eb32ae486d63956e802027ec8ce6fd28' OR owner_name IS DISTINCT FROM current_user OR secured IS DISTINCT FROM true
  OR settings IS DISTINCT FROM ARRAY['search_path=""'] OR (length(src)-length(replace(src,marker,'')))/length(marker)<>1
 THEN RAISE EXCEPTION 'RENTAL_RETIREMENT_ADAPTER_REVIEW_REQUIRED'; END IF;
 EXECUTE replace(replace(definition,E'\r\n',E'\n'),marker,'BEGIN
 IF TG_OP=''UPDATE'' AND rental_source_retirement_private.plot_allowed(to_jsonb(OLD),to_jsonb(NEW)) THEN RETURN NEW; END IF;');
END;
$retirement_adapter_2$;
DO $retirement_adapter_3$
DECLARE definition text; src text; settings text[]; secured boolean; owner_name text; marker text:='s.disposition=''mapped_for_review''';
BEGIN
 SELECT pg_get_functiondef(oid),replace(prosrc,E'\r\n',E'\n'),proconfig,prosecdef,pg_get_userbyid(proowner) INTO definition,src,settings,secured,owner_name FROM pg_proc WHERE oid='sales_history_read_private.records(uuid,uuid,uuid,text)'::regprocedure;
 IF md5(src) IS DISTINCT FROM '49c43866b4575969191b3dd10fc39d95' OR owner_name IS DISTINCT FROM current_user OR secured IS DISTINCT FROM true
  OR settings IS DISTINCT FROM ARRAY['search_path=pg_catalog','TimeZone=UTC','DateStyle=ISO, YMD'] OR (length(src)-length(replace(src,marker,'')))/length(marker)<>2
 THEN RAISE EXCEPTION 'RENTAL_RETIREMENT_ADAPTER_REVIEW_REQUIRED'; END IF;
 EXECUTE replace(replace(definition,E'\r\n',E'\n'),marker,'s.disposition=''mapped_for_review'' AND NOT rental_source_retirement_private.excluded(s.batch_id,s.source_row)');
END;
$retirement_adapter_3$;
DO $retirement_adapter_4$
DECLARE definition text; src text; settings text[]; secured boolean; owner_name text; marker text:='s.disposition=''mapped_for_review''';
BEGIN
 SELECT pg_get_functiondef(oid),replace(prosrc,E'\r\n',E'\n'),proconfig,prosecdef,pg_get_userbyid(proowner) INTO definition,src,settings,secured,owner_name FROM pg_proc WHERE oid='sales_history_read_private.original_excel(text)'::regprocedure;
 IF md5(src) IS DISTINCT FROM '2badafb867957060da5e4d150222f505' OR owner_name IS DISTINCT FROM current_user OR secured IS DISTINCT FROM true
  OR settings IS DISTINCT FROM ARRAY['search_path=pg_catalog','TimeZone=UTC','DateStyle=ISO, YMD'] OR (length(src)-length(replace(src,marker,'')))/length(marker)<>3
 THEN RAISE EXCEPTION 'RENTAL_RETIREMENT_ADAPTER_REVIEW_REQUIRED'; END IF;
 EXECUTE replace(replace(definition,E'\r\n',E'\n'),marker,'s.disposition=''mapped_for_review'' AND NOT rental_source_retirement_private.excluded(s.batch_id,s.source_row)');
END;
$retirement_adapter_4$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA rental_source_retirement_private FROM PUBLIC,anon,authenticated;

-- DESIGN ONLY. Compose after 25-30 and before the final reviewed activation.
-- Does not remove parent IDs or change the original archive. Installation alone
-- is inert. An owned rehearsal must install exact-source adapters and activate
-- the complete resolved 958-row cohort before this becomes authoritative.

-- Design sentinel cleared only in this reviewed installation artifact.
SET LOCAL lock_timeout='2s';
CREATE SCHEMA customer_source_membership_private;
REVOKE ALL ON SCHEMA customer_source_membership_private FROM PUBLIC,anon,authenticated;
CREATE TABLE customer_source_membership_private.revisions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),dataset_key text UNIQUE NOT NULL,
 payload jsonb NOT NULL,input_digest text NOT NULL CHECK(input_digest ~ '^[0-9a-f]{64}$'),
 actor_id uuid NOT NULL,review_reference text NOT NULL CHECK(length(btrim(review_reference))>0),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE customer_source_membership_private.members(
 revision_id uuid NOT NULL REFERENCES customer_source_membership_private.revisions ON DELETE RESTRICT,
 source_row integer NOT NULL,source_key text NOT NULL,row_sha256 text NOT NULL,
 customer_id uuid NOT NULL REFERENCES public.sales_customers ON DELETE RESTRICT,
 interest_id uuid REFERENCES public.lead_project_interests ON DELETE RESTRICT,
 sale_id uuid REFERENCES public.sales ON DELETE RESTRICT,
 project_name text,source_stage text NOT NULL,history jsonb NOT NULL,lineage_key text NOT NULL,
 PRIMARY KEY(revision_id,source_row),UNIQUE(revision_id,source_key)
);
CREATE INDEX membership_customer ON customer_source_membership_private.members(revision_id,customer_id);
CREATE INDEX membership_interest ON customer_source_membership_private.members(revision_id,interest_id);
CREATE INDEX membership_sale ON customer_source_membership_private.members(revision_id,sale_id);
-- Scope is captured by original provenance, not by a global allowlist. IDs born
-- through later legitimate intake and bookings remain visible automatically.
CREATE TABLE customer_source_membership_private.scope_customers(id uuid PRIMARY KEY REFERENCES public.sales_customers ON DELETE RESTRICT);
CREATE TABLE customer_source_membership_private.scope_interests(id uuid PRIMARY KEY REFERENCES public.lead_project_interests ON DELETE RESTRICT);
CREATE TABLE customer_source_membership_private.scope_sales(id uuid PRIMARY KEY);
CREATE TABLE customer_source_membership_private.scope_batches(id uuid PRIMARY KEY);
-- Independent legacy Lead archive scope. It is an identity-only frozen set;
-- customer lifecycle status and historical Lead links are never manufactured.
CREATE TABLE customer_source_membership_private.scope_leads(id uuid PRIMARY KEY REFERENCES public.leads ON DELETE RESTRICT,exempt_mapping boolean NOT NULL);
CREATE TABLE customer_source_membership_private.head(id boolean PRIMARY KEY CHECK(id),revision_id uuid NOT NULL REFERENCES customer_source_membership_private.revisions ON DELETE RESTRICT);
CREATE TABLE customer_source_membership_private.adapters(signature text PRIMARY KEY,before_md5 text NOT NULL,after_md5 text NOT NULL,settings text[] NOT NULL);
DO $rls$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['revisions','members','scope_customers','scope_interests','scope_sales','scope_batches','scope_leads','head','adapters'] LOOP
  EXECUTE format('ALTER TABLE customer_source_membership_private.%I ENABLE ROW LEVEL SECURITY',t);
 END LOOP;
END; $rls$;

CREATE FUNCTION customer_source_membership_private.customer_member(p_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT NOT EXISTS(SELECT 1 FROM customer_source_membership_private.head)
  OR NOT EXISTS(SELECT 1 FROM customer_source_membership_private.scope_customers WHERE id=p_id)
  OR EXISTS(SELECT 1 FROM customer_source_membership_private.members m JOIN customer_source_membership_private.head h ON h.revision_id=m.revision_id WHERE m.customer_id=p_id);
$$;
CREATE FUNCTION customer_source_membership_private.interest_member(p_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT NOT EXISTS(SELECT 1 FROM customer_source_membership_private.head)
  OR (NOT EXISTS(SELECT 1 FROM public.lead_project_interests WHERE id=p_id) AND NOT EXISTS(SELECT 1 FROM customer_source_membership_private.scope_interests WHERE id=p_id))
  OR (EXISTS(SELECT 1 FROM public.lead_project_interests i WHERE i.id=p_id AND customer_source_membership_private.customer_member(i.customer_id))
   AND (NOT EXISTS(SELECT 1 FROM customer_source_membership_private.scope_interests WHERE id=p_id)
    OR EXISTS(SELECT 1 FROM customer_source_membership_private.members m JOIN customer_source_membership_private.head h ON h.revision_id=m.revision_id WHERE m.interest_id=p_id)));
$$;
CREATE FUNCTION customer_source_membership_private.sale_member(p_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT NOT EXISTS(SELECT 1 FROM customer_source_membership_private.head)
  OR (NOT EXISTS(SELECT 1 FROM public.sales WHERE id=p_id) AND NOT EXISTS(SELECT 1 FROM customer_source_membership_private.scope_sales WHERE id=p_id))
  OR (EXISTS(SELECT 1 FROM public.sales s WHERE s.id=p_id AND (s.project_interest_id IS NULL OR customer_source_membership_private.interest_member(s.project_interest_id)))
   AND (NOT EXISTS(SELECT 1 FROM customer_source_membership_private.scope_sales WHERE id=p_id)
    OR EXISTS(SELECT 1 FROM customer_source_membership_private.members m JOIN customer_source_membership_private.head h ON h.revision_id=m.revision_id WHERE m.sale_id=p_id)));
$$;
CREATE FUNCTION customer_source_membership_private.source_member(p_batch uuid,p_row integer)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT NOT EXISTS(SELECT 1 FROM customer_source_membership_private.head)
  OR NOT EXISTS(SELECT 1 FROM customer_source_membership_private.scope_batches WHERE id=p_batch)
  OR EXISTS(SELECT 1 FROM customer_source_membership_private.members m JOIN customer_source_membership_private.head h ON h.revision_id=m.revision_id WHERE m.source_row=p_row);
$$;
CREATE FUNCTION customer_source_membership_private.report_requires_legacy_mapping(p_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
 -- With no authoritative replacement, preserve SQL20's original all-Lead
 -- completeness rule. Future Leads are also never exempted by this archive.
 SELECT NOT EXISTS(SELECT 1 FROM customer_source_membership_private.head)
  OR NOT EXISTS(SELECT 1 FROM customer_source_membership_private.scope_leads WHERE id=p_id AND exempt_mapping)
  OR EXISTS(SELECT 1 FROM public.crm_legacy_lead_links link WHERE link.legacy_lead_id=p_id
   AND customer_source_membership_private.customer_member(link.customer_id)
   AND (link.project_interest_id IS NULL OR customer_source_membership_private.interest_member(link.project_interest_id)));
$$;
-- Private views are evaluated inside the existing reviewed SECURITY DEFINER
-- readers. They retain complete row types and filter BEFORE LIMIT/count/search.
CREATE VIEW customer_source_membership_private.customers AS SELECT c.* FROM public.sales_customers c WHERE customer_source_membership_private.customer_member(c.id);
CREATE VIEW customer_source_membership_private.interests AS SELECT i.* FROM public.lead_project_interests i WHERE customer_source_membership_private.interest_member(i.id);
CREATE VIEW customer_source_membership_private.sales AS SELECT s.* FROM public.sales s WHERE customer_source_membership_private.sale_member(s.id);
-- Direct Data API SELECT must obey the same source authority as reviewed RPCs.
-- These boolean-only definers avoid recursive public RLS reads in the parent
-- predicates. Existing permissive role policies remain the authorization gate;
-- restrictive policies can only remove inactive archived rows from that gate.
CREATE FUNCTION customer_source_membership_private.rls_customer_member(p_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog SET row_security=off AS $$
 SELECT customer_source_membership_private.customer_member(p_id);
$$;
CREATE FUNCTION customer_source_membership_private.rls_interest_member(p_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog SET row_security=off AS $$
 SELECT customer_source_membership_private.interest_member(p_id);
$$;
CREATE FUNCTION customer_source_membership_private.rls_sale_member(p_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog SET row_security=off AS $$
 SELECT customer_source_membership_private.sale_member(p_id);
$$;
CREATE POLICY customer_source_membership_read ON public.sales_customers AS RESTRICTIVE FOR SELECT TO authenticated
 USING(customer_source_membership_private.rls_customer_member(id));
CREATE POLICY interest_source_membership_read ON public.lead_project_interests AS RESTRICTIVE FOR SELECT TO authenticated
 USING(customer_source_membership_private.rls_interest_member(id));
CREATE POLICY sale_source_membership_read ON public.sales AS RESTRICTIVE FOR SELECT TO authenticated
 USING(customer_source_membership_private.rls_sale_member(id));

CREATE FUNCTION customer_source_membership_private.assert_payload(p_payload jsonb)
RETURNS void LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE k text; value text;
BEGIN
 -- Preserve the original authorization errors and input validators. This adds
 -- only source retirement checks for already authorized canonical commands.
 IF auth.uid() IS NULL OR coalesce(public.crm_v2_role(),'') NOT IN('sales','admin','owner') OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN RETURN; END IF;
 FOREACH k IN ARRAY ARRAY['customerId','interestId','projectInterestId','saleId','previousSaleId'] LOOP
  value:=p_payload->>k;
  IF value IS NULL OR value !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN CONTINUE; END IF;
  IF (k='customerId' AND NOT customer_source_membership_private.customer_member(value::uuid))
   OR (k IN('interestId','projectInterestId') AND NOT customer_source_membership_private.interest_member(value::uuid))
   OR (k IN('saleId','previousSaleId') AND NOT customer_source_membership_private.sale_member(value::uuid))
   THEN RAISE EXCEPTION 'CRM_SOURCE_RETIRED'; END IF;
 END LOOP;
END; $$;
CREATE FUNCTION customer_source_membership_private.guard_parent()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE old_row jsonb; new_row jsonb; customer_id uuid; interest_id uuid;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM customer_source_membership_private.head) THEN RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END IF;
 old_row:=CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END;
 new_row:=CASE WHEN TG_OP='DELETE' THEN old_row ELSE to_jsonb(NEW) END;
 IF TG_TABLE_NAME='sales_customers' THEN
  IF (old_row IS NOT NULL AND NOT customer_source_membership_private.customer_member((old_row->>'id')::uuid)) OR NOT customer_source_membership_private.customer_member((new_row->>'id')::uuid) THEN RAISE EXCEPTION 'CRM_SOURCE_RETIRED'; END IF;
 ELSIF TG_TABLE_NAME='lead_project_interests' THEN
  customer_id:=(new_row->>'customer_id')::uuid;
  IF NOT customer_source_membership_private.customer_member(customer_id) OR (old_row IS NOT NULL AND NOT customer_source_membership_private.interest_member((old_row->>'id')::uuid))
   OR (EXISTS(SELECT 1 FROM customer_source_membership_private.scope_interests WHERE id=(new_row->>'id')::uuid) AND NOT EXISTS(SELECT 1 FROM customer_source_membership_private.members m JOIN customer_source_membership_private.head h ON h.revision_id=m.revision_id WHERE m.interest_id=(new_row->>'id')::uuid)) THEN RAISE EXCEPTION 'CRM_SOURCE_RETIRED'; END IF;
 ELSIF TG_TABLE_NAME='sales' THEN
  interest_id:=(new_row->>'project_interest_id')::uuid;
  IF (interest_id IS NOT NULL AND NOT customer_source_membership_private.interest_member(interest_id)) OR (old_row IS NOT NULL AND NOT customer_source_membership_private.sale_member((old_row->>'id')::uuid))
   OR (EXISTS(SELECT 1 FROM customer_source_membership_private.scope_sales WHERE id=(new_row->>'id')::uuid) AND NOT EXISTS(SELECT 1 FROM customer_source_membership_private.members m JOIN customer_source_membership_private.head h ON h.revision_id=m.revision_id WHERE m.sale_id=(new_row->>'id')::uuid)) THEN RAISE EXCEPTION 'CRM_SOURCE_RETIRED'; END IF;
 END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END; $$;
CREATE TRIGGER customer_source_membership_guard BEFORE INSERT OR UPDATE OR DELETE ON public.sales_customers FOR EACH ROW EXECUTE FUNCTION customer_source_membership_private.guard_parent();
CREATE TRIGGER interest_source_membership_guard BEFORE INSERT OR UPDATE OR DELETE ON public.lead_project_interests FOR EACH ROW EXECUTE FUNCTION customer_source_membership_private.guard_parent();
CREATE TRIGGER sale_source_membership_guard BEFORE INSERT OR UPDATE OR DELETE ON public.sales FOR EACH ROW EXECUTE FUNCTION customer_source_membership_private.guard_parent();

CREATE FUNCTION customer_source_membership_private.history(p_original jsonb,p_customer uuid,p_interest uuid,p_sale uuid,p_project text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE result jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM customer_source_membership_private.head) THEN RETURN p_original; END IF;
 IF (p_customer IS NOT NULL AND NOT customer_source_membership_private.customer_member(p_customer))
  OR (p_interest IS NOT NULL AND NOT customer_source_membership_private.interest_member(p_interest))
  OR (p_sale IS NOT NULL AND NOT customer_source_membership_private.sale_member(p_sale)) THEN RAISE EXCEPTION 'CRM_CUSTOMER_HISTORY_NOT_FOUND'; END IF;
 WITH retained AS (
  SELECT value row FROM jsonb_array_elements(p_original)
  WHERE NOT EXISTS(SELECT 1 FROM customer_source_membership_private.scope_batches b WHERE value->>'key' LIKE b.id::text||':%')
   AND NOT EXISTS(SELECT 1 FROM customer_source_membership_private.members m JOIN customer_source_membership_private.head h ON h.revision_id=m.revision_id
    WHERE value->>'key' IN('source:'||m.source_key,'unknown:'||m.source_key,'revision:'||m.source_key))
   AND customer_source_membership_private.customer_member((value->>'customerId')::uuid)
   AND (value->>'interestId' IS NULL OR customer_source_membership_private.interest_member((value->>'interestId')::uuid))
 ), reviewed AS (
  SELECT jsonb_build_object('key',m.lineage_key,'customerId',m.customer_id,'projectName',m.project_name,
    'projectNames',CASE WHEN m.project_name IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(m.project_name) END,
    'interestId',m.interest_id,'saleId',m.sale_id,'sourceRow',m.source_row,
    'events',(SELECT coalesce(jsonb_agg(jsonb_build_object('kind',e->>'kind','date',e->'date','precision',e->>'precision') ORDER BY ordinality),'[]') FROM jsonb_array_elements(m.history) WITH ORDINALITY AS items(e,ordinality))) row
  FROM customer_source_membership_private.members m JOIN customer_source_membership_private.head h ON h.revision_id=m.revision_id
  WHERE (p_customer IS NULL OR m.customer_id=p_customer) AND (p_interest IS NULL OR m.interest_id=p_interest)
   AND (p_sale IS NULL OR m.sale_id=p_sale) AND (p_project IS NULL OR m.project_name=p_project)
 ), combined AS (SELECT row FROM retained UNION ALL SELECT row FROM reviewed)
 SELECT coalesce(jsonb_agg(row ORDER BY row->>'key'),'[]') INTO result FROM combined;
 RETURN result;
END; $$;

CREATE FUNCTION customer_source_membership_private.assert_catalog()
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM (VALUES
   ('sales_customers','customer_source_membership_read','rls_customer_member','customer_member'),
   ('lead_project_interests','interest_source_membership_read','rls_interest_member','interest_member'),
   ('sales','sale_source_membership_read','rls_sale_member','sale_member')) expected(table_name,policy_name,helper_name,parent_name)
  LEFT JOIN pg_class c ON c.oid=to_regclass('public.'||expected.table_name)
  LEFT JOIN pg_policy policy ON policy.polrelid=c.oid AND policy.polname=expected.policy_name
  LEFT JOIN pg_proc helper ON helper.oid=to_regprocedure('customer_source_membership_private.'||expected.helper_name||'(uuid)')
  WHERE NOT coalesce(c.relrowsecurity,false) OR policy.oid IS NULL OR policy.polpermissive OR policy.polcmd<>'r'
   OR policy.polroles IS DISTINCT FROM ARRAY[(SELECT oid FROM pg_roles WHERE rolname='authenticated')]::oid[]
   OR pg_get_expr(policy.polqual,c.oid) IS DISTINCT FROM 'customer_source_membership_private.'||expected.helper_name||'(id)'
   OR helper.oid IS NULL OR NOT helper.prosecdef OR pg_get_userbyid(helper.proowner)<>current_user
   OR helper.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog','row_security=off']::text[]
   OR replace(helper.prosrc,E'\r\n',E'\n') IS DISTINCT FROM chr(10)||' SELECT customer_source_membership_private.'||expected.parent_name||'(p_id);'||chr(10)
   OR NOT has_function_privilege('authenticated',helper.oid,'EXECUTE') OR has_function_privilege('anon',helper.oid,'EXECUTE'))
  OR NOT has_schema_privilege('authenticated','customer_source_membership_private','USAGE')
 THEN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_SELECT_POLICY_DRIFT'; END IF;
 IF EXISTS(SELECT 1 FROM customer_source_membership_private.adapters a LEFT JOIN pg_proc p ON p.oid=to_regprocedure(a.signature)
  WHERE p.oid IS NULL OR md5(replace(p.prosrc,E'\r\n',E'\n')) IS DISTINCT FROM a.after_md5 OR NOT p.prosecdef OR pg_get_userbyid(p.proowner)<>current_user OR p.proconfig IS DISTINCT FROM a.settings)
 THEN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_ADAPTER_DRIFT'; END IF;
 IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname LIKE 'crm_v2_%' AND p.prosecdef
   AND (p.prosrc ~ 'public\.(sales_customers|lead_project_interests|sales)\M' OR pg_get_function_arguments(p.oid) LIKE '%p_payload jsonb%')
   AND NOT EXISTS(SELECT 1 FROM customer_source_membership_private.adapters a WHERE a.signature=quote_ident(n.nspname)||'.'||quote_ident(p.proname)||'('||replace(oidvectortypes(p.proargtypes),', ',',')||')'))
 THEN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_ADAPTER_COVERAGE_REQUIRED'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(ARRAY['public.crm_v2_central_snapshot(integer,integer)','public.crm_v2_central_search(jsonb,integer)','public.crm_v2_lead_work_snapshot(uuid,uuid)','public.crm_v2_booking_search(text,integer)','public.crm_v2_booking_context(uuid,integer)','public.crm_v2_project_sales(text,text,text,integer)','public.crm_v2_sales_report(text,text,text)','sales_history_read_private.records(uuid,uuid,uuid,text)','sales_history_read_private.original_excel(text)']) required(signature)
   WHERE NOT EXISTS(SELECT 1 FROM customer_source_membership_private.adapters a WHERE a.signature=required.signature))
 THEN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_HISTORY_COVERAGE_REQUIRED'; END IF;
END; $$;

CREATE FUNCTION customer_source_membership_private.activate(p_payload jsonb,p_input_digest text,p_review text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE v_record jsonb; revision uuid; batch uuid; known record; customer uuid; interest uuid; sale uuid;
BEGIN
 IF auth.uid() IS NULL OR public.crm_v2_role() IS DISTINCT FROM 'admin' OR session_user<>current_user THEN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_OPERATOR_REQUIRED'; END IF;
 IF p_payload->>'version' IS DISTINCT FROM 'reviewed-full-canonical-cohort-v1'
  OR p_payload->>'sourceSha256' IS DISTINCT FROM '7193857ef04d6a092171749a25867b1ca8d1bbe8f7b83b04fa7473b3a3a69ffd'
  OR p_payload->>'reviewSha256' IS DISTINCT FROM 'de4beaee70afa8de9e8866e328eabf8bdd25257eae7aa78eb89649712f381802'
  OR p_payload->>'adapterPlanDigest' IS DISTINCT FROM '379da2e538829a3cb0379108b98851757c142eb010b1624543413116eef8a506'
  OR p_payload->'originalSourceBatchIds' IS DISTINCT FROM '["5d3f05d2-2a5d-44ed-a0e3-9385b8ace3a5"]'::jsonb
  OR p_payload->'exclusions'->'rentalSourceRows' IS DISTINCT FROM '[859,951,954,958,959,960,961,969]'::jsonb
  OR p_payload->'exclusions'->'heldIdentitySourceRows' IS DISTINCT FROM '[967,968,970,971,972,973,974,975,976,977,978,979,980]'::jsonb
  OR jsonb_typeof(p_payload->'records') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'records')<>958
  OR p_input_digest !~ '^[0-9a-f]{64}$' OR coalesce(length(btrim(p_review)),0)=0 THEN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_REVIEW_REQUIRED'; END IF;
 LOCK TABLE public.sales_customers,public.lead_project_interests,public.sales,public.leads,public.crm_legacy_lead_links IN SHARE ROW EXCLUSIVE MODE;
 LOCK TABLE customer_source_membership_private.head IN EXCLUSIVE MODE;
 PERFORM customer_source_membership_private.assert_catalog();
 SELECT * INTO known FROM customer_source_membership_private.revisions WHERE dataset_key=p_payload->>'datasetKey';
 IF FOUND THEN
  IF known.payload IS DISTINCT FROM p_payload OR known.input_digest IS DISTINCT FROM p_input_digest OR NOT EXISTS(SELECT 1 FROM customer_source_membership_private.head WHERE revision_id=known.id) THEN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_REPLAY_CONFLICT'; END IF;
  RETURN jsonb_build_object('revisionId',known.id,'sourceRows',958,'replayed',true);
 END IF;
 IF EXISTS(SELECT 1 FROM customer_source_membership_private.head) THEN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_ALREADY_ACTIVE'; END IF;
 -- Exact reviewed original Lead identity set only. These rows are an
 -- independent old-system archive; they do not represent the new workbook's
 -- Customer identities and must not acquire invented links or lifecycle dates.
 -- Replays above deliberately do not require the old global count: legitimate
 -- future Lead intake remains possible after activation.
 IF (SELECT count(*) FROM public.leads)<>973
  OR (SELECT md5(string_agg(id::text,E'\n' ORDER BY id)) FROM public.leads) IS DISTINCT FROM '96bca8c3499c91241b9f4258175f4f2d'
 THEN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_LEGACY_SCOPE_REVIEW_REQUIRED'; END IF;
 IF (SELECT count(DISTINCT r->>'sourceRow') FROM jsonb_array_elements(p_payload->'records') r)<>958
  OR (SELECT count(DISTINCT r->>'sourceKey') FROM jsonb_array_elements(p_payload->'records') r)<>958
  OR (SELECT count(DISTINCT r->>'customerId') FROM jsonb_array_elements(p_payload->'records') r)<>957
  OR (SELECT count(DISTINCT r->>'interestId') FROM jsonb_array_elements(p_payload->'records') r)<>948
  OR (SELECT count(DISTINCT r->>'saleId') FROM jsonb_array_elements(p_payload->'records') r)<>298 THEN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_COUNTS_REQUIRED'; END IF;
 batch:=(p_payload->'originalSourceBatchIds'->>0)::uuid;
 INSERT INTO customer_source_membership_private.scope_batches VALUES(batch);
 INSERT INTO customer_source_membership_private.scope_customers SELECT id FROM public.sales_customers WHERE external_snapshot_batch_id=batch;
 INSERT INTO customer_source_membership_private.scope_interests SELECT id FROM public.lead_project_interests WHERE external_snapshot_batch_id=batch;
 INSERT INTO customer_source_membership_private.scope_sales SELECT s.id FROM public.sales s JOIN crm_external_private.prepared_booking_sales p ON p.id=s.external_booking_id WHERE p.batch_id=batch;
 -- Deleted rental Sale IDs remain scoped so a later blind re-insert cannot
 -- resurrect them. No FK is placed on these deliberately absent rows.
 INSERT INTO customer_source_membership_private.scope_sales SELECT sale_id FROM rental_source_retirement_private.archives WHERE old_batch_id=batch ON CONFLICT DO NOTHING;
 INSERT INTO customer_source_membership_private.revisions(dataset_key,payload,input_digest,actor_id,review_reference) VALUES(p_payload->>'datasetKey',p_payload,p_input_digest,auth.uid(),p_review) RETURNING id INTO revision;
 FOR v_record IN SELECT value FROM jsonb_array_elements(p_payload->'records') LOOP
  customer:=(v_record->>'customerId')::uuid;interest:=(v_record->>'interestId')::uuid;sale:=(v_record->>'saleId')::uuid;
  IF customer IS NULL OR (v_record->>'sourceRow')::integer NOT BETWEEN 2 AND 980
   OR (v_record->>'sourceRow')::integer IN(859,951,954,958,959,960,961,969,967,968,970,971,972,973,974,975,976,977,978,979,980)
   OR v_record->>'sourceKey' !~ '^[0-9a-f]{64}$' OR v_record->>'rowSha256' !~ '^[0-9a-f]{64}$'
   OR NOT EXISTS(SELECT 1 FROM public.sales_customers c WHERE c.id=customer AND c.merged_into_customer_id IS NULL)
   -- Existing parent relationships alone cannot establish which source row
   -- belongs to which customer. Prevent a permutation of valid UUIDs from
   -- moving reviewed dates to a different customer while preserving counts.
   OR NOT EXISTS(SELECT 1 FROM public.sales_customers c WHERE c.id=customer AND (
    (c.supplemental_creation_id IS NULL AND c.external_snapshot_batch_id=batch AND EXISTS(
     SELECT 1 FROM crm_external_private.source_records original WHERE original.batch_id=batch
      AND original.source_row=(v_record->>'sourceRow')::integer AND original.customer_key=c.external_customer_key))
    OR EXISTS(SELECT 1 FROM sales_source_creation_private.records created WHERE created.id=c.supplemental_creation_id
     AND created.customer_id=c.id AND created.source_row=(v_record->>'sourceRow')::integer
     AND created.source_key=v_record->>'sourceKey' AND created.row_sha256=v_record->>'rowSha256')))
   OR (interest IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.lead_project_interests i WHERE i.id=interest AND i.customer_id=customer AND i.project_name IS NOT DISTINCT FROM v_record->>'projectName'))
   OR (interest IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.lead_project_interests i WHERE i.id=interest AND (
    (i.supplemental_creation_id IS NULL AND i.external_snapshot_batch_id=batch AND EXISTS(
     SELECT 1 FROM crm_external_private.interest_candidates original WHERE original.batch_id=batch
      AND original.entity_key=i.external_interest_key AND original.payload->'sourceRows' @> jsonb_build_array((v_record->>'sourceRow')::integer)))
    OR EXISTS(SELECT 1 FROM sales_source_creation_private.records created WHERE created.id=i.supplemental_creation_id
     AND created.interest_id=i.id AND created.customer_id=customer AND created.source_row=(v_record->>'sourceRow')::integer
     AND created.source_key=v_record->>'sourceKey' AND created.row_sha256=v_record->>'rowSha256'))))
   OR (interest IS NULL AND v_record->>'projectName' IS NOT NULL)
   OR (sale IS NOT NULL AND (interest IS NULL OR NOT EXISTS(SELECT 1 FROM public.sales s WHERE s.id=sale AND s.project_interest_id=interest AND s.plot_id IS NOT DISTINCT FROM v_record->>'plotId' AND s.crm_stage IS NOT DISTINCT FROM v_record->>'sourceStage')))
   OR (sale IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.sales s WHERE s.id=sale AND (
    EXISTS(SELECT 1 FROM crm_external_private.prepared_booking_sales original WHERE original.id=s.external_booking_id
     AND original.batch_id=batch AND (original.payload->>'source_row')::integer=(v_record->>'sourceRow')::integer)
    OR EXISTS(SELECT 1 FROM sales_revision_private.events created WHERE created.id=s.historical_import_id
     AND created.sale_id=s.id AND created.customer_id=customer AND created.interest_id=interest
     AND created.source_row=(v_record->>'sourceRow')::integer AND created.source_key=v_record->>'sourceKey' AND created.row_sha256=v_record->>'rowSha256'))))
   OR jsonb_typeof(v_record->'history') IS DISTINCT FROM 'array'
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(v_record->'history') e WHERE e->>'kind' NOT IN('visited','booked','contracted','loan_submitted','transferred','handover','cancelled') OR e->>'kind' IS NULL
    OR ((e->>'precision'='unknown' AND e->'date'='null') OR (e->>'precision'='day' AND e->>'date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND pg_input_is_valid(e->>'date','date'))) IS DISTINCT FROM true)
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(v_record->'history') e GROUP BY e->>'kind' HAVING count(*)>1)
   THEN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_BINDING_REQUIRED'; END IF;
  INSERT INTO customer_source_membership_private.members VALUES(revision,(v_record->>'sourceRow')::integer,v_record->>'sourceKey',v_record->>'rowSha256',customer,interest,sale,v_record->>'projectName',v_record->>'sourceStage',v_record->'history',batch::text||':'||(v_record->>'sourceRow'));
 END LOOP;
 -- Freeze which original Leads were independently archived at activation.
 -- An original Lead already linked to active canonical parents must retain its
 -- mapping integrity requirement even if that link is subsequently removed.
 INSERT INTO customer_source_membership_private.scope_leads(id,exempt_mapping)
 SELECT legacy.id,NOT EXISTS(SELECT 1 FROM public.crm_legacy_lead_links link
  WHERE link.legacy_lead_id=legacy.id
   AND (NOT EXISTS(SELECT 1 FROM customer_source_membership_private.scope_customers old_customer WHERE old_customer.id=link.customer_id)
    OR EXISTS(SELECT 1 FROM customer_source_membership_private.members m WHERE m.revision_id=revision AND m.customer_id=link.customer_id))
   AND (link.project_interest_id IS NULL
    OR NOT EXISTS(SELECT 1 FROM customer_source_membership_private.scope_interests old_interest WHERE old_interest.id=link.project_interest_id)
    OR EXISTS(SELECT 1 FROM customer_source_membership_private.members m WHERE m.revision_id=revision AND m.interest_id=link.project_interest_id)))
 FROM public.leads legacy;
 INSERT INTO customer_source_membership_private.head VALUES(true,revision);
 RETURN jsonb_build_object('revisionId',revision,'sourceRows',958,'customers',957,'interests',948,'sales',298,'replayed',false);
END; $$;

-- Durable ledgers are append-only. Only head has a separate explicit reviewed
-- recovery path; full business recovery belongs to the whole replacement.
CREATE FUNCTION customer_source_membership_private.sealed()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$ BEGIN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_IMMUTABLE'; END; $$;
DO $seal$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['revisions','members','scope_customers','scope_interests','scope_sales','scope_batches','scope_leads','adapters'] LOOP
  EXECUTE format('CREATE TRIGGER membership_immutable BEFORE UPDATE OR DELETE ON customer_source_membership_private.%I FOR EACH ROW EXECUTE FUNCTION customer_source_membership_private.sealed()',t);
  EXECUTE format('CREATE TRIGGER membership_no_truncate BEFORE TRUNCATE ON customer_source_membership_private.%I FOR EACH STATEMENT EXECUTE FUNCTION customer_source_membership_private.sealed()',t);
 END LOOP;
END; $seal$;
CREATE TABLE customer_source_membership_private.recoveries(revision_id uuid PRIMARY KEY REFERENCES customer_source_membership_private.revisions,actor_id uuid NOT NULL,review_reference text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE customer_source_membership_private.recoveries ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER membership_immutable BEFORE UPDATE OR DELETE ON customer_source_membership_private.recoveries FOR EACH ROW EXECUTE FUNCTION customer_source_membership_private.sealed();
CREATE TRIGGER membership_no_truncate BEFORE TRUNCATE ON customer_source_membership_private.recoveries FOR EACH STATEMENT EXECUTE FUNCTION customer_source_membership_private.sealed();
CREATE TRIGGER membership_no_truncate BEFORE TRUNCATE ON customer_source_membership_private.head FOR EACH STATEMENT EXECUTE FUNCTION customer_source_membership_private.sealed();
CREATE FUNCTION customer_source_membership_private.deactivate(p_revision uuid,p_review text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF auth.uid() IS NULL OR public.crm_v2_role() IS DISTINCT FROM 'admin' OR session_user<>current_user OR coalesce(length(btrim(p_review)),0)=0 THEN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_OPERATOR_REQUIRED'; END IF;
 LOCK TABLE public.sales_customers,public.lead_project_interests,public.sales IN SHARE ROW EXCLUSIVE MODE;
 LOCK TABLE customer_source_membership_private.head IN EXCLUSIVE MODE;
 IF NOT EXISTS(SELECT 1 FROM customer_source_membership_private.head WHERE revision_id=p_revision) THEN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_RECOVERY_STALE'; END IF;
 INSERT INTO customer_source_membership_private.recoveries(revision_id,actor_id,review_reference) VALUES(p_revision,auth.uid(),p_review);
 DELETE FROM customer_source_membership_private.head WHERE revision_id=p_revision;
END; $$;
REVOKE ALL ON ALL TABLES IN SCHEMA customer_source_membership_private FROM PUBLIC,anon,authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA customer_source_membership_private FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA customer_source_membership_private TO authenticated;
GRANT EXECUTE ON FUNCTION customer_source_membership_private.rls_customer_member(uuid),customer_source_membership_private.rls_interest_member(uuid),customer_source_membership_private.rls_sale_member(uuid) TO authenticated;

DO $membership_adapter_0$
DECLARE d text; b text; owner_name text; secured boolean; settings text[];
BEGIN
 SELECT pg_get_functiondef(oid),replace(prosrc,E'\r\n',E'\n'),pg_get_userbyid(proowner),prosecdef,proconfig INTO d,b,owner_name,secured,settings FROM pg_proc WHERE oid='crm_excel_private.booking_amounts(text)'::regprocedure;
 d:=replace(d,E'\r\n',E'\n');
 IF md5(b) IS DISTINCT FROM 'f8511ed5d8c345a22a7d62a2fe08e9ed' OR owner_name IS DISTINCT FROM current_user OR owner_name IS DISTINCT FROM 'postgres' OR secured IS DISTINCT FROM true OR settings IS DISTINCT FROM ARRAY['search_path=pg_catalog','TimeZone=UTC','DateStyle=ISO, YMD']::text[] THEN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_ADAPTER_REVIEW_REQUIRED'; END IF;
 IF (length(d)-length(replace(d,b,'')))/NULLIF(length(b),0)<>1 THEN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_DEFINITION_AMBIGUOUS'; END IF;
 EXECUTE replace(d,b,'
DECLARE
  actor_id uuid:=auth.uid(); actor_role text:=public.crm_v2_role();
  item record; cell_text text; td_price numeric; n integer:=0;
  result_rows jsonb[]:=ARRAY[]::jsonb[];
BEGIN
  IF actor_id IS NULL OR COALESCE(actor_role,'''') NOT IN (''sales'',''admin'',''owner'') THEN
    RAISE EXCEPTION ''CRM_EXCEL_BOOKING_AMOUNTS_FORBIDDEN'';
  END IF;
  IF (public.crm_v2_project_sales_capabilities()->>''enabled'')::boolean IS DISTINCT FROM true
    OR NOT crm_external_private.booking_writer_ready() THEN
    RAISE EXCEPTION ''CRM_EXCEL_BOOKING_AMOUNTS_SETUP_REQUIRED'';
  END IF;
  IF p_project_name IS NULL OR length(btrim(p_project_name)) NOT BETWEEN 1 AND 200
    OR length(p_project_name)>200 OR p_project_name ~ U&''[\0001-\001F\007F-\009F\2028\2029]'' THEN
    RAISE EXCEPTION ''CRM_EXCEL_BOOKING_AMOUNTS_INVALID_INPUT'';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.projects WHERE name=p_project_name) THEN
    RAISE EXCEPTION ''CRM_EXCEL_BOOKING_AMOUNTS_NOT_FOUND'';
  END IF;

  -- Keep cancelled/transferred/handover and each repeated booking. The caller
  -- selects the booking-year cohort; this function never substitutes stock.
  FOR item IN
    SELECT bounded.*,count(*) OVER() AS bounded_count FROM (
    SELECT sale.id,sale.external_booking_id,p.id AS prepared_id,
      p.payload->>''interest_id'' AS prepared_interest,
      p.payload->>''customer_id'' AS prepared_customer,p.payload->>''project_name'' AS prepared_project,
      i.id AS interest_id,c.id AS customer_id,s.source_row,
      s.payload->''rawValues''->13 AS source_cell,s.payload->''sourceIssues'' AS source_issues,
      w.batch_id AS released_batch
    FROM customer_source_membership_private.sales sale
    JOIN customer_source_membership_private.interests i ON i.id=sale.project_interest_id
    JOIN customer_source_membership_private.customers c ON c.id=i.customer_id AND c.merged_into_customer_id IS NULL
    LEFT JOIN crm_external_private.prepared_booking_sales p ON p.id=sale.external_booking_id
    LEFT JOIN crm_external_private.source_records s ON s.batch_id=p.batch_id
      AND s.source_row=CASE WHEN p.payload->>''source_row'' ~ ''^[0-9]{1,3}$''
        THEN (p.payload->>''source_row'')::integer ELSE NULL END
      AND s.customer_key=c.external_customer_key AND c.external_snapshot_batch_id=p.batch_id
      AND s.disposition=''mapped_for_review'' AND s.source_row BETWEEN 2 AND 966
    LEFT JOIN crm_external_private.booking_writer_releases w ON w.batch_id=p.batch_id
      AND EXISTS(SELECT 1 FROM crm_external_private.snapshot_batches b
        WHERE b.id=w.batch_id AND b.plan_digest=w.plan_digest AND b.feed=''customer-sheet'')
      AND NOT EXISTS(SELECT 1 FROM crm_external_private.sales_rollback_receipts r WHERE r.batch_id=w.batch_id)
    WHERE i.project_name=p_project_name
    ORDER BY sale.id LIMIT 10001) bounded
  LOOP
    n:=n+1;
    IF n>10000 OR item.bounded_count>10000 THEN RAISE EXCEPTION ''CRM_EXCEL_BOOKING_AMOUNTS_LIMIT''; END IF;
    IF item.external_booking_id IS NOT NULL AND (item.prepared_id IS NULL
      OR item.released_batch IS NULL OR item.source_row IS NULL
      OR item.prepared_interest IS DISTINCT FROM item.interest_id::text
      OR item.prepared_customer IS DISTINCT FROM item.customer_id::text
      OR item.prepared_project IS DISTINCT FROM p_project_name) THEN
      RAISE EXCEPTION ''CRM_EXCEL_BOOKING_AMOUNTS_INTEGRITY_REQUIRED'';
    END IF;
    td_price:=NULL;
    -- Private snapshots retain a row-level formula-review issue, not formula
    -- coordinates. If any primary input was a formula, do not trust N''s cache.
    -- Explicit numeric zero is evidence; missing/blank/defaults are never zero.
    IF jsonb_typeof(item.source_cell) IN (''number'',''string'')
      AND jsonb_typeof(item.source_issues)=''array''
      AND NOT item.source_issues @> ''["PRIMARY_INPUT_FORMULA_REVIEW"]''::jsonb THEN
      cell_text:=btrim(item.source_cell#>>''{}'');
      IF cell_text ~ ''^[0-9]{1,13}(\.[0-9]{1,2})?$'' THEN
        td_price:=cell_text::numeric;
      END IF;
    END IF;
    result_rows:=array_append(result_rows,jsonb_build_object(''saleId'',item.id,''tdPrice'',td_price));
  END LOOP;
  RETURN jsonb_build_object(''contractVersion'',''excel_booking_amounts_v1'',''projectName'',p_project_name,
    ''actor'',jsonb_build_object(''userId'',actor_id,''role'',actor_role),''rows'',to_jsonb(result_rows));
END;
');
 INSERT INTO customer_source_membership_private.adapters(signature,before_md5,after_md5,settings) VALUES('crm_excel_private.booking_amounts(text)','f8511ed5d8c345a22a7d62a2fe08e9ed','4f6cc43f4e1632c7639f7d0b9109b962',ARRAY['search_path=pg_catalog','TimeZone=UTC','DateStyle=ISO, YMD']::text[]);
END; $membership_adapter_0$;
DO $membership_adapter_1$
DECLARE d text; b text; owner_name text; secured boolean; settings text[];
BEGIN
 SELECT pg_get_functiondef(oid),replace(prosrc,E'\r\n',E'\n'),pg_get_userbyid(proowner),prosecdef,proconfig INTO d,b,owner_name,secured,settings FROM pg_proc WHERE oid='public.crm_v2_booking_command(uuid,jsonb)'::regprocedure;
 d:=replace(d,E'\r\n',E'\n');
 IF md5(b) IS DISTINCT FROM '5b6aef2557f233ae0681b8fe246d7cf2' OR owner_name IS DISTINCT FROM current_user OR owner_name IS DISTINCT FROM 'postgres' OR secured IS DISTINCT FROM true OR settings IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] THEN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_ADAPTER_REVIEW_REQUIRED'; END IF;
 IF (length(d)-length(replace(d,b,'')))/NULLIF(length(b),0)<>1 THEN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_DEFINITION_AMBIGUOUS'; END IF;
 EXECUTE replace(d,b,'
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
 PERFORM customer_source_membership_private.assert_payload(p_payload);
  IF actor_id IS NULL OR COALESCE(actor_role,'''') NOT IN (''sales'',''admin'') THEN RAISE EXCEPTION ''CRM_BOOKING_FORBIDDEN''; END IF;
  SELECT central_intake_enabled AND lead_work_enabled AND lead_lifecycle_enabled AND booking_enabled AND booking_cutover_reviewed
    INTO enabled FROM public.crm_settings WHERE id FOR SHARE;
  IF enabled IS DISTINCT FROM true THEN RAISE EXCEPTION ''CRM_BOOKING_SETUP_REQUIRED''; END IF;
  IF p_request_id IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM ''object'' OR octet_length(p_payload::text)>16384
    OR jsonb_typeof(p_payload->''command'') IS DISTINCT FROM ''string'' THEN RAISE EXCEPTION ''CRM_BOOKING_INVALID_INPUT''; END IF;
  command_name:=p_payload->>''command'';
  IF command_name=''resume_follow_up'' AND sales_private.crm_booking_external_ready() THEN
    RAISE EXCEPTION ''CRM_BOOKING_FORBIDDEN'';
  END IF;
  allowed_keys:=CASE command_name
    WHEN ''book'' THEN ARRAY[''command'',''reason'',''customerId'',''newCustomer'',''projectName'',''expectedInterestRevision'',''plotId'',''paymentMethod'',''bookingRoute'',''visitId'',''listPriceSatang'',''discountSatang'',''depositSatang'',''previousSaleId'']
    WHEN ''cancel'' THEN ARRAY[''command'',''reason'',''customerId'',''saleId'',''expectedSaleRevision'',''cancellationCategory'']
    WHEN ''resume_follow_up'' THEN ARRAY[''command'',''reason'',''customerId'',''saleId'',''expectedSaleRevision'',''expectedInterestRevision'',''expectedActionId'',''nextAction'']
    ELSE NULL END;
  IF allowed_keys IS NULL OR NOT (p_payload ?& allowed_keys)
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE NOT(k=ANY(allowed_keys)))
    OR jsonb_typeof(p_payload->''reason'') IS DISTINCT FROM ''string'' THEN RAISE EXCEPTION ''CRM_BOOKING_INVALID_INPUT''; END IF;
  BEGIN reason_value:=sales_private.crm_work_text(p_payload->>''reason'',1000);
  EXCEPTION WHEN raise_exception THEN RAISE EXCEPTION ''CRM_BOOKING_INVALID_INPUT''; END;
  customer_id_value:=sales_private.crm_booking_uuid(p_payload->''customerId'',command_name=''book'');
  IF command_name=''book'' THEN
    expected_interest:=sales_private.crm_booking_uuid(p_payload->''expectedInterestRevision'',true);
    previous_id:=sales_private.crm_booking_uuid(p_payload->''previousSaleId'',true);
    visit_id_value:=sales_private.crm_booking_uuid(p_payload->''visitId'',true);
    IF jsonb_typeof(p_payload->''projectName'') IS DISTINCT FROM ''string''
      OR jsonb_typeof(p_payload->''plotId'') IS DISTINCT FROM ''string''
      OR jsonb_typeof(p_payload->''paymentMethod'') IS DISTINCT FROM ''string'' OR p_payload->>''paymentMethod'' NOT IN (''cash'',''mortgage'')
      OR jsonb_typeof(p_payload->''bookingRoute'') IS DISTINCT FROM ''string'' OR p_payload->>''bookingRoute'' NOT IN (''visited'',''without_visit'')
      OR ((p_payload->>''bookingRoute''=''visited'') IS DISTINCT FROM (visit_id_value IS NOT NULL)) THEN RAISE EXCEPTION ''CRM_BOOKING_INVALID_INPUT''; END IF;
    BEGIN project_value:=sales_private.crm_work_text(p_payload->>''projectName'',200); plot_value:=sales_private.crm_work_text(p_payload->>''plotId'',200);
    EXCEPTION WHEN raise_exception THEN RAISE EXCEPTION ''CRM_BOOKING_INVALID_INPUT''; END;
    FOREACH key_name IN ARRAY ARRAY[''listPriceSatang'',''discountSatang'',''depositSatang''] LOOP
      IF jsonb_typeof(p_payload->key_name) IS DISTINCT FROM ''number'' OR (p_payload->>key_name) !~ ''^[0-9]{1,11}$'' THEN
        RAISE EXCEPTION ''CRM_BOOKING_INVALID_INPUT'';
      END IF;
    END LOOP;
    list_satang:=(p_payload->>''listPriceSatang'')::bigint; discount_satang:=(p_payload->>''discountSatang'')::bigint; deposit_satang:=(p_payload->>''depositSatang'')::bigint;
    IF list_satang<=discount_satang OR deposit_satang>list_satang-discount_satang THEN RAISE EXCEPTION ''CRM_BOOKING_INVALID_INPUT''; END IF;
    new_customer:=p_payload->''newCustomer'';
    IF customer_id_value IS NOT NULL THEN
      IF new_customer<>''null''::jsonb THEN RAISE EXCEPTION ''CRM_BOOKING_INVALID_INPUT''; END IF;
    ELSE
      IF jsonb_typeof(new_customer) IS DISTINCT FROM ''object'' THEN RAISE EXCEPTION ''CRM_BOOKING_INVALID_INPUT''; END IF;
      IF NOT(new_customer ?& ARRAY[''name'',''phone'',''channel'',''notes'',''assignedSalesUserId''])
        OR EXISTS(SELECT 1 FROM jsonb_object_keys(new_customer) k WHERE k NOT IN (''name'',''phone'',''channel'',''notes'',''assignedSalesUserId'')) THEN RAISE EXCEPTION ''CRM_BOOKING_INVALID_INPUT''; END IF;
      FOREACH key_name IN ARRAY ARRAY[''name'',''phone'',''channel'',''notes''] LOOP
        IF jsonb_typeof(new_customer->key_name) IS DISTINCT FROM ''string'' THEN RAISE EXCEPTION ''CRM_BOOKING_INVALID_INPUT''; END IF;
      END LOOP;
      owner_id:=sales_private.crm_booking_uuid(new_customer->''assignedSalesUserId'',actor_role=''sales'');
      IF actor_role=''sales'' AND owner_id IS NOT NULL THEN RAISE EXCEPTION ''CRM_BOOKING_FORBIDDEN''; END IF;
      IF expected_interest IS NOT NULL OR previous_id IS NOT NULL OR visit_id_value IS NOT NULL THEN RAISE EXCEPTION ''CRM_BOOKING_INVALID_INPUT''; END IF;
      create_payload:=(new_customer-''assignedSalesUserId'')||jsonb_build_object(''interests'',''[]''::jsonb);
      IF actor_role=''admin'' THEN create_payload:=create_payload||jsonb_build_object(''assignedSalesUserId'',owner_id); END IF;
    END IF;
  ELSE
    sale_id_value:=sales_private.crm_booking_uuid(p_payload->''saleId'');
    expected_sale:=sales_private.crm_booking_uuid(p_payload->''expectedSaleRevision'');
    IF command_name=''cancel'' THEN
      IF jsonb_typeof(p_payload->''cancellationCategory'') IS DISTINCT FROM ''string''
        OR p_payload->>''cancellationCategory'' NOT IN (''booking_cancelled'',''downpayment_abandoned'',''final_loan_rejection'',''other'') THEN RAISE EXCEPTION ''CRM_BOOKING_INVALID_INPUT''; END IF;
    ELSE
      expected_interest:=sales_private.crm_booking_uuid(p_payload->''expectedInterestRevision'');
      expected_action:=sales_private.crm_booking_uuid(p_payload->''expectedActionId'',true);
      IF jsonb_typeof(p_payload->''nextAction'') IS DISTINCT FROM ''object'' THEN RAISE EXCEPTION ''CRM_BOOKING_INVALID_INPUT''; END IF;
      IF NOT((p_payload->''nextAction'') ?& ARRAY[''action'',''dueAt''])
        OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload->''nextAction'') k WHERE k NOT IN (''action'',''dueAt''))
        OR jsonb_typeof(p_payload#>''{nextAction,action}'') IS DISTINCT FROM ''string''
        OR jsonb_typeof(p_payload#>''{nextAction,dueAt}'') IS DISTINCT FROM ''string'' THEN RAISE EXCEPTION ''CRM_BOOKING_INVALID_INPUT''; END IF;
    END IF;
  END IF;
  -- Serialize booking commands globally, then take the same customer/interest
  -- order used by lifecycle/work commands. No client holds a database lock.
  PERFORM pg_advisory_xact_lock(hashtextextended(''crm-booking-command'',0));
  SELECT * INTO request_row FROM sales_private.booking_command_requests WHERE actor_user_id=actor_id AND request_id=p_request_id;
  IF FOUND THEN customer_id_value:=(request_row.response->>''customerId'')::uuid; END IF;
  IF customer_id_value IS NULL THEN
    BEGIN created:=public.crm_v2_create_customer(gen_random_uuid(),create_payload);
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM=''CRM_DUPLICATE_REVIEW_REQUIRED'' THEN RAISE EXCEPTION ''CRM_BOOKING_DUPLICATE_REVIEW_REQUIRED''; END IF;
      IF SQLERRM IN (''CRM_FORBIDDEN'',''CRM_SALES_OWNER_REQUIRED'') THEN RAISE EXCEPTION ''CRM_BOOKING_FORBIDDEN''; END IF;
      RAISE EXCEPTION ''CRM_BOOKING_INVALID_INPUT'';
    END;
    customer_id_value:=(created->>''customerId'')::uuid;
  END IF;
  SELECT * INTO customer_row FROM customer_source_membership_private.customers WHERE id=customer_id_value FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION ''CRM_BOOKING_NOT_FOUND''; END IF;
  IF customer_row.merged_into_customer_id IS NOT NULL THEN RAISE EXCEPTION ''CRM_BOOKING_CONFLICT''; END IF;
  IF EXISTS(SELECT 1 FROM customer_source_membership_private.sales WHERE lead_id=customer_row.legacy_source_lead_id AND project_interest_id IS NULL) THEN RAISE EXCEPTION ''CRM_BOOKING_SETUP_REQUIRED''; END IF;
  IF request_row.request_id IS NOT NULL THEN
    SELECT * INTO interest_row FROM customer_source_membership_private.interests WHERE id=(request_row.response->>''interestId'')::uuid AND customer_id=customer_id_value FOR UPDATE;
  ELSIF command_name=''book'' THEN
    SELECT * INTO interest_row FROM customer_source_membership_private.interests WHERE customer_id=customer_id_value AND project_name=project_value FOR UPDATE;
  ELSE
    SELECT i.* INTO interest_row FROM customer_source_membership_private.interests i JOIN customer_source_membership_private.sales s ON s.project_interest_id=i.id
      WHERE s.id=sale_id_value AND i.customer_id=customer_id_value FOR UPDATE OF i;
    IF NOT FOUND THEN RAISE EXCEPTION ''CRM_BOOKING_NOT_FOUND''; END IF;
  END IF;
  owner_id:=COALESCE(interest_row.owner_user_id,customer_row.owner_user_id);
  FOR role_row IN SELECT * FROM sales_private.crm_user_roles WHERE user_id IN(actor_id,owner_id) ORDER BY user_id FOR SHARE LOOP
    IF role_row.user_id=actor_id AND role_row.is_active THEN actor_role:=role_row.role; actor_name:=role_row.display_name; actor_active:=true; END IF;
    IF role_row.user_id=owner_id THEN owner_active:=role_row.is_active AND role_row.role=''sales''; END IF;
  END LOOP;
  IF NOT actor_active OR NOT owner_active OR actor_role NOT IN (''sales'',''admin'') OR (actor_role=''sales'' AND actor_id<>owner_id) THEN RAISE EXCEPTION ''CRM_BOOKING_FORBIDDEN''; END IF;
  IF request_row.request_id IS NOT NULL THEN
    IF request_row.request_payload IS DISTINCT FROM p_payload THEN RAISE EXCEPTION ''CRM_BOOKING_IDEMPOTENCY_CONFLICT''; END IF;
    RETURN request_row.response||jsonb_build_object(''replayed'',true);
  END IF;
  IF command_name=''book'' AND (customer_row.intake_status=''lost'' OR interest_row.engagement_status=''lost'') THEN RAISE EXCEPTION ''CRM_BOOKING_CONFLICT''; END IF;
  server_now:=clock_timestamp();
  old_interest:=CASE WHEN interest_row.id IS NULL THEN NULL ELSE to_jsonb(interest_row) END;
  IF command_name=''book'' THEN
    PERFORM 1 FROM public.projects WHERE name=project_value AND is_closed IS NOT TRUE FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION ''CRM_BOOKING_NOT_FOUND''; END IF;
    IF interest_row.lifecycle_revision IS DISTINCT FROM expected_interest THEN RAISE EXCEPTION ''CRM_BOOKING_STALE_STATE''; END IF;
    IF interest_row.id IS NULL THEN
      INSERT INTO public.lead_project_interests(customer_id,project_name,owner_user_id,created_by_user_id,interest_created_at,owner_assigned_at)
        VALUES(customer_id_value,project_value,owner_id,actor_id,server_now,server_now) RETURNING * INTO interest_row;
      INSERT INTO public.crm_audit_events(customer_id,entity_type,entity_id,event_type,reason_text,actor_user_id,actor_kind,actor_name_snapshot,new_values,occurred_at,recorded_at)
        VALUES(customer_id_value,''interest'',interest_row.id,''created_for_booking'',reason_value,actor_id,''staff'',actor_name,
          jsonb_build_object(''projectName'',project_value,''ownerUserId'',owner_id),server_now,server_now);
    END IF;
    IF previous_id IS NOT NULL THEN
      SELECT * INTO previous_row FROM customer_source_membership_private.sales WHERE id=previous_id AND project_interest_id=interest_row.id FOR UPDATE;
      IF NOT FOUND OR previous_row.crm_stage<>''cancelled'' THEN RAISE EXCEPTION ''CRM_BOOKING_CONFLICT''; END IF;
    END IF;
    IF visit_id_value IS NOT NULL THEN
      PERFORM 1 FROM public.lead_visits WHERE id=visit_id_value AND project_interest_id=interest_row.id AND status=''completed''
        AND completion_evidence_state=''submitted'' AND completed_at<=server_now FOR SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION ''CRM_BOOKING_CONFLICT''; END IF;
    END IF;
    PERFORM 1 FROM public.plots WHERE id=plot_value AND project_name=project_value AND has_customer IS FALSE
      AND lower(btrim(COALESCE(sale_status,''''))) IN ('''',''active'',''normal'',''ready_for_sale'',''available'',''vacant'') FOR UPDATE;
    -- Match the existing active-plot UNIQUE index exactly. Malformed legacy
    -- status text is unknown/occupied, not a cancellation inferred by trimming.
    IF NOT FOUND OR EXISTS(SELECT 1 FROM customer_source_membership_private.sales WHERE plot_id=plot_value AND COALESCE(crm_stage,lower(contract_status),''unknown'')<>''cancelled'') THEN
      RAISE EXCEPTION ''CRM_BOOKING_PLOT_UNAVAILABLE'';
    END IF;
    SELECT COALESCE(max(booking_round),0)+1 INTO next_round FROM customer_source_membership_private.sales WHERE project_interest_id=interest_row.id;
    -- Recorded sequence only; this does not infer unknown historical rounds.
    sale_id_value:=gen_random_uuid();
    IF to_regprocedure(''crm_external_private.begin_booking_write(uuid,uuid,uuid,uuid,text)'') IS NOT NULL THEN
      EXECUTE ''SELECT crm_external_private.begin_booking_write($1,$2,$3,$4,$5)''
        USING actor_id,customer_id_value,interest_row.id,sale_id_value,command_name;
    END IF;
    INSERT INTO sales_private.booking_write_permits VALUES(txid_current(),pg_backend_pid());
    INSERT INTO public.sales(id,lead_id,project_interest_id,plot_id,booking_round,previous_sale_id,crm_stage,contract_status,payment_method,
      booking_route,booking_route_reason,booking_visit_id,list_price,discount_amount,sale_price,booking_amount,booked_at,closing_sales_user_id)
      VALUES(sale_id_value,NULL,interest_row.id,plot_value,next_round,previous_id,''booked'',''Reserved'',p_payload->>''paymentMethod'',p_payload->>''bookingRoute'',
        reason_value,visit_id_value,list_satang/100.0,discount_satang/100.0,(list_satang-discount_satang)/100.0,deposit_satang/100.0,server_now,owner_id)
      RETURNING * INTO sale_row;
    DELETE FROM sales_private.booking_write_permits WHERE transaction_id=txid_current();
    UPDATE public.plots SET has_customer=true WHERE id=plot_value;
    -- This flag records the first booking association, not a separate Lead page.
    -- Visits/follow-up continue in the central workspace; cohort dates stay put.
    UPDATE public.lead_project_interests SET lifecycle_revision=gen_random_uuid(),updated_at=server_now,
      workspace_state=''project_active'',
      activated_at=CASE WHEN workspace_state=''central_interest'' THEN server_now ELSE activated_at END,
      activation_reason=CASE WHEN workspace_state=''central_interest'' THEN ''booking'' ELSE activation_reason END
      WHERE id=interest_row.id RETURNING * INTO interest_row;
    old_values:=NULL;
  ELSE
    SELECT * INTO sale_row FROM customer_source_membership_private.sales WHERE id=sale_id_value AND project_interest_id=interest_row.id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION ''CRM_BOOKING_NOT_FOUND''; END IF;
    IF sale_row.booking_revision IS DISTINCT FROM expected_sale THEN RAISE EXCEPTION ''CRM_BOOKING_STALE_STATE''; END IF;
    old_values:=to_jsonb(sale_row);
    IF command_name=''cancel'' THEN
      IF sale_row.crm_stage NOT IN (''booked'',''contracted'',''downpayment'',''document_prep'',''loan_submitted'',''loan_rejected'',''loan_approved'',''transfer_pending'') THEN
        RAISE EXCEPTION ''CRM_BOOKING_CONFLICT'';
      END IF;
      PERFORM 1 FROM public.plots WHERE id=sale_row.plot_id FOR UPDATE;
      IF to_regprocedure(''crm_external_private.begin_booking_write(uuid,uuid,uuid,uuid,text)'') IS NOT NULL THEN
        EXECUTE ''SELECT crm_external_private.begin_booking_write($1,$2,$3,$4,$5)''
          USING actor_id,customer_id_value,interest_row.id,sale_row.id,command_name;
      END IF;
      INSERT INTO sales_private.booking_write_permits VALUES(txid_current(),pg_backend_pid());
      UPDATE public.sales SET crm_stage=''cancelled'',contract_status=''Cancelled'',cancelled_at=server_now,
        cancellation_category=p_payload->>''cancellationCategory'',cancellation_reason=reason_value,booking_revision=gen_random_uuid()
        WHERE id=sale_row.id RETURNING * INTO sale_row;
      DELETE FROM sales_private.booking_write_permits WHERE transaction_id=txid_current();
      UPDATE public.plots SET has_customer=false WHERE id=sale_row.plot_id
        AND NOT EXISTS(SELECT 1 FROM customer_source_membership_private.sales WHERE plot_id=sale_row.plot_id AND COALESCE(crm_stage,lower(contract_status),''unknown'')<>''cancelled'');
      UPDATE public.lead_project_interests SET lifecycle_revision=gen_random_uuid(),updated_at=server_now WHERE id=interest_row.id RETURNING * INTO interest_row;
      -- No implicit next action, status reset or reopening of this cancelled sale.
    ELSE
      IF sale_row.crm_stage<>''cancelled'' THEN RAISE EXCEPTION ''CRM_BOOKING_CONFLICT''; END IF;
      IF interest_row.lifecycle_revision IS DISTINCT FROM expected_interest THEN RAISE EXCEPTION ''CRM_BOOKING_STALE_STATE''; END IF;
      UPDATE public.lead_project_interests SET engagement_status=''follow_up'',lifecycle_revision=gen_random_uuid(),updated_at=server_now
        WHERE id=interest_row.id RETURNING * INTO interest_row;
      BEGIN
        work_result:=public.crm_v2_record_lead_work(gen_random_uuid(),jsonb_build_object(''command'',''set_next_action'',
          ''customerId'',customer_id_value,''interestId'',interest_row.id,''expectedActionId'',expected_action,
          ''nextAction'',p_payload->''nextAction'',''reason'',reason_value));
      EXCEPTION WHEN raise_exception THEN
        IF SQLERRM=''CRM_WORK_STALE_ACTION'' THEN RAISE EXCEPTION ''CRM_BOOKING_STALE_STATE''; END IF;
        IF SQLERRM IN (''CRM_WORK_FORBIDDEN'',''CRM_WORK_INACTIVE_OWNER'') THEN RAISE EXCEPTION ''CRM_BOOKING_FORBIDDEN''; END IF;
        IF SQLERRM=''CRM_WORK_SCOPE_CLOSED'' THEN RAISE EXCEPTION ''CRM_BOOKING_CONFLICT''; END IF;
        RAISE EXCEPTION ''CRM_BOOKING_INVALID_INPUT'';
      END;
      next_action:=(work_result->>''nextActionId'')::uuid;
      -- Do not UPDATE the cancelled sale, even its revision/timestamps.
    END IF;
  END IF;
  IF command_name IN (''book'',''cancel'') AND to_regprocedure(''crm_external_private.end_booking_write()'') IS NOT NULL THEN
    EXECUTE ''SELECT crm_external_private.end_booking_write()'';
  END IF;
  INSERT INTO public.crm_audit_events(customer_id,entity_type,entity_id,event_type,reason_text,actor_user_id,actor_kind,
    actor_name_snapshot,old_values,new_values,occurred_at,recorded_at)
    VALUES(customer_id_value,''sale'',sale_row.id,command_name,reason_value,actor_id,''staff'',actor_name,
      jsonb_build_object(''sale'',old_values,''interest'',old_interest),
      jsonb_build_object(''sale'',to_jsonb(sale_row),''interest'',to_jsonb(interest_row),''interestRevision'',interest_row.lifecycle_revision,''nextActionId'',next_action),server_now,server_now);
  response_value:=jsonb_build_object(''command'',command_name,''customerId'',customer_id_value,''interestId'',interest_row.id,
    ''saleId'',sale_row.id,''saleRevision'',sale_row.booking_revision,''interestRevision'',interest_row.lifecycle_revision,''nextActionId'',next_action,''replayed'',false);
  INSERT INTO sales_private.booking_command_requests(actor_user_id,request_id,request_payload,response,created_at)
    VALUES(actor_id,p_request_id,p_payload,response_value,server_now);
  RETURN response_value;
END;
');
 INSERT INTO customer_source_membership_private.adapters(signature,before_md5,after_md5,settings) VALUES('public.crm_v2_booking_command(uuid,jsonb)','5b6aef2557f233ae0681b8fe246d7cf2','6e184041b1666815d7251761f310628b',ARRAY['search_path=pg_catalog']::text[]);
END; $membership_adapter_1$;
DO $membership_adapter_2$
DECLARE d text; b text; owner_name text; secured boolean; settings text[];
BEGIN
 SELECT pg_get_functiondef(oid),replace(prosrc,E'\r\n',E'\n'),pg_get_userbyid(proowner),prosecdef,proconfig INTO d,b,owner_name,secured,settings FROM pg_proc WHERE oid='public.crm_v2_booking_context(uuid,integer)'::regprocedure;
 d:=replace(d,E'\r\n',E'\n');
 IF md5(b) IS DISTINCT FROM 'c225db81892c2eeab372b1aa8e7e95de' OR owner_name IS DISTINCT FROM current_user OR owner_name IS DISTINCT FROM 'postgres' OR secured IS DISTINCT FROM true OR settings IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] THEN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_ADAPTER_REVIEW_REQUIRED'; END IF;
 IF (length(d)-length(replace(d,b,'')))/NULLIF(length(b),0)<>1 THEN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_DEFINITION_AMBIGUOUS'; END IF;
 EXECUTE replace(d,b,'
DECLARE
  actor_id uuid:=auth.uid(); actor_role text:=public.crm_v2_role();
  customer_row public.sales_customers%ROWTYPE;
  customer_json jsonb:=''null''::jsonb; interests_json jsonb:=''[]''::jsonb; sales_json jsonb:=''[]''::jsonb;
  more boolean:=false;
BEGIN
  IF actor_id IS NULL OR COALESCE(actor_role,'''') NOT IN (''sales'',''admin'',''owner'') THEN RAISE EXCEPTION ''CRM_BOOKING_FORBIDDEN''; END IF;
  IF NOT (public.crm_v2_booking_capabilities()->>''enabled'')::boolean THEN RAISE EXCEPTION ''CRM_BOOKING_SETUP_REQUIRED''; END IF;
  IF p_page IS NULL OR p_page NOT BETWEEN 0 AND 100000 THEN RAISE EXCEPTION ''CRM_BOOKING_INVALID_INPUT''; END IF;
  IF p_customer_id IS NOT NULL THEN
    SELECT * INTO customer_row FROM customer_source_membership_private.customers WHERE id=p_customer_id AND merged_into_customer_id IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION ''CRM_BOOKING_NOT_FOUND''; END IF;
    IF EXISTS(SELECT 1 FROM customer_source_membership_private.sales WHERE lead_id=customer_row.legacy_source_lead_id AND project_interest_id IS NULL) THEN
      RAISE EXCEPTION ''CRM_BOOKING_SETUP_REQUIRED'';
    END IF;
    -- Validate every related row before pagination, including imported rows
    -- whose round number was never recorded. Never manufacture round one.
    IF EXISTS(SELECT 1 FROM customer_source_membership_private.sales s JOIN customer_source_membership_private.interests i ON i.id=s.project_interest_id
      WHERE i.customer_id=p_customer_id AND (s.booking_round IS NULL
        OR to_jsonb(s)->>''external_booking_id'' IS NOT NULL OR to_jsonb(s)->>''external_source_stage'' IS NOT NULL)
        AND sales_private.crm_booking_imported_history(to_jsonb(s)) IS NULL) THEN
      RAISE EXCEPTION ''CRM_BOOKING_SETUP_REQUIRED'';
    END IF;
    customer_json:=jsonb_build_object(''id'',customer_row.id,''name'',sales_private.crm_effective_customer_name(customer_row.id),''phone'',sales_private.crm_effective_customer_phone(customer_row.id),
      ''ownerUserId'',customer_row.owner_user_id,''revision'',customer_row.lifecycle_revision);
    SELECT COALESCE(jsonb_agg(jsonb_build_object(''id'',i.id,''projectName'',i.project_name,''ownerUserId'',i.owner_user_id,
      ''revision'',i.lifecycle_revision,''status'',i.engagement_status,
      ''currentActionId'',(SELECT a.id FROM public.crm_next_actions a WHERE a.project_interest_id=i.id AND a.status=''open''),
      ''canEdit'',(actor_role=''admin'' OR (actor_role=''sales'' AND actor_id=i.owner_user_id))
        AND i.engagement_status<>''lost'' AND EXISTS(SELECT 1 FROM sales_private.crm_user_roles r WHERE r.user_id=i.owner_user_id AND r.role=''sales'' AND r.is_active),
      ''visits'',COALESCE((SELECT jsonb_agg(jsonb_build_object(''id'',v.id,''checkedInAt'',v.checked_in_at) ORDER BY v.checked_in_at DESC,v.id)
        FROM (SELECT id,checked_in_at FROM public.lead_visits WHERE project_interest_id=i.id AND status=''completed''
          AND completed_at<=statement_timestamp() AND completion_evidence_state=''submitted''
          ORDER BY checked_in_at DESC,id LIMIT 50) v),''[]''::jsonb)) ORDER BY i.project_name,i.id),''[]''::jsonb)
      INTO interests_json FROM customer_source_membership_private.interests i WHERE i.customer_id=p_customer_id;
    WITH rows AS (
      SELECT s.*,i.project_name,i.owner_user_id,i.engagement_status FROM customer_source_membership_private.sales s
        JOIN customer_source_membership_private.interests i ON i.id=s.project_interest_id WHERE i.customer_id=p_customer_id
        ORDER BY s.booked_at DESC NULLS LAST,s.id LIMIT 51 OFFSET p_page*50
    ), numbered AS(SELECT *,row_number() OVER(ORDER BY booked_at DESC NULLS LAST,id) rn FROM rows)
    SELECT COALESCE(jsonb_agg(jsonb_build_object(''id'',s.id,''interestId'',s.project_interest_id,''projectName'',s.project_name,
      ''plotId'',s.plot_id,''stage'',s.crm_stage,''revision'',s.booking_revision,''bookingRound'',s.booking_round,
      ''importedHistory'',sales_private.crm_booking_imported_history(to_jsonb(s)),
      ''previousSaleId'',s.previous_sale_id,''bookedAt'',s.booked_at,''cancelledAt'',s.cancelled_at,
      ''cancellationReason'',s.cancellation_reason,''cancellationCategory'',s.cancellation_category,
      ''listPrice'',s.list_price,''discountAmount'',s.discount_amount,''salePrice'',sales_private.crm_effective_sale_price(s.id),''depositAmount'',s.booking_amount,''paymentMethod'',s.payment_method,
      ''canCancel'',(actor_role=''admin'' OR (actor_role=''sales'' AND actor_id=s.owner_user_id))
        AND (sales_private.crm_booking_imported_history(to_jsonb(s)) IS NULL OR sales_private.crm_booking_external_ready())
        AND EXISTS(SELECT 1 FROM sales_private.crm_user_roles r WHERE r.user_id=s.owner_user_id AND r.role=''sales'' AND r.is_active)
        AND s.crm_stage IN (''booked'',''contracted'',''downpayment'',''document_prep'',''loan_submitted'',''loan_rejected'',''loan_approved'',''transfer_pending''),
      ''canResume'',(actor_role=''admin'' OR (actor_role=''sales'' AND actor_id=s.owner_user_id)) AND s.crm_stage=''cancelled''
        AND NOT sales_private.crm_booking_external_ready()
        AND sales_private.crm_booking_imported_history(to_jsonb(s)) IS NULL
        AND EXISTS(SELECT 1 FROM sales_private.crm_user_roles r WHERE r.user_id=s.owner_user_id AND r.role=''sales'' AND r.is_active))
      ORDER BY s.booked_at DESC NULLS LAST,s.id) FILTER(WHERE rn<=50),''[]''::jsonb),count(*)>50 INTO sales_json,more FROM numbered s;
  END IF;
  RETURN jsonb_build_object(''actor'',jsonb_build_object(''userId'',actor_id,''role'',actor_role),''customer'',customer_json,
    ''projects'',COALESCE((SELECT jsonb_agg(jsonb_build_object(''name'',name) ORDER BY name) FROM public.projects WHERE is_closed IS NOT TRUE),''[]''::jsonb),
    ''salesOwners'',COALESCE((SELECT jsonb_agg(jsonb_build_object(''userId'',user_id,''displayName'',COALESCE(NULLIF(btrim(display_name),''''),user_id::text)) ORDER BY display_name,user_id)
      FROM sales_private.crm_user_roles WHERE role=''sales'' AND is_active),''[]''::jsonb),
    ''interests'',interests_json,''sales'',sales_json,''page'',p_page,''hasMore'',more);
END;
');
 INSERT INTO customer_source_membership_private.adapters(signature,before_md5,after_md5,settings) VALUES('public.crm_v2_booking_context(uuid,integer)','c225db81892c2eeab372b1aa8e7e95de','32919c37200b1b01a73369a652bb548d',ARRAY['search_path=pg_catalog']::text[]);
END; $membership_adapter_2$;
DO $membership_adapter_3$
DECLARE d text; b text; owner_name text; secured boolean; settings text[];
BEGIN
 SELECT pg_get_functiondef(oid),replace(prosrc,E'\r\n',E'\n'),pg_get_userbyid(proowner),prosecdef,proconfig INTO d,b,owner_name,secured,settings FROM pg_proc WHERE oid='public.crm_v2_booking_search(text,integer)'::regprocedure;
 d:=replace(d,E'\r\n',E'\n');
 IF md5(b) IS DISTINCT FROM '07a5d02eec0d88f9402d23f6830df766' OR owner_name IS DISTINCT FROM current_user OR owner_name IS DISTINCT FROM 'postgres' OR secured IS DISTINCT FROM true OR settings IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] THEN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_ADAPTER_REVIEW_REQUIRED'; END IF;
 IF (length(d)-length(replace(d,b,'')))/NULLIF(length(b),0)<>1 THEN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_DEFINITION_AMBIGUOUS'; END IF;
 EXECUTE replace(d,b,'
DECLARE result jsonb; more boolean; search_value text;
BEGIN
  IF auth.uid() IS NULL OR COALESCE(public.crm_v2_role(),'''') NOT IN (''sales'',''admin'',''owner'') THEN
    RAISE EXCEPTION ''CRM_BOOKING_FORBIDDEN'';
  END IF;
  IF NOT (public.crm_v2_booking_capabilities()->>''enabled'')::boolean THEN RAISE EXCEPTION ''CRM_BOOKING_SETUP_REQUIRED''; END IF;
  IF p_query IS NULL OR length(btrim(p_query)) NOT BETWEEN 2 AND 200
    OR p_page IS NULL OR p_page NOT BETWEEN 0 AND 100000 THEN RAISE EXCEPTION ''CRM_BOOKING_INVALID_INPUT''; END IF;
  BEGIN search_value:=sales_private.crm_work_text(p_query,200);
  EXCEPTION WHEN raise_exception THEN RAISE EXCEPTION ''CRM_BOOKING_INVALID_INPUT''; END;
  IF length(search_value)<2 THEN RAISE EXCEPTION ''CRM_BOOKING_INVALID_INPUT''; END IF;
  -- strpos implements literal substring matching: %, _ and backslash are not wildcards.
  WITH rows AS (
    SELECT id,sales_private.crm_effective_customer_name(id) AS customer_name,sales_private.crm_effective_customer_phone(id) AS phone FROM customer_source_membership_private.customers
      WHERE merged_into_customer_id IS NULL AND (strpos(lower(sales_private.crm_effective_customer_name(id)),lower(search_value))>0
        OR strpos(COALESCE(sales_private.crm_effective_customer_phone(id),''''),search_value)>0)
      ORDER BY sales_private.crm_effective_customer_name(id),id LIMIT 26 OFFSET p_page*25
  ), numbered AS (SELECT *,row_number() OVER(ORDER BY customer_name,id) rn FROM rows)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(''id'',id,''name'',customer_name,''phone'',phone)
    ORDER BY customer_name,id) FILTER(WHERE rn<=25),''[]''::jsonb),count(*)>25 INTO result,more FROM numbered;
  RETURN jsonb_build_object(''customers'',result,''page'',p_page,''hasMore'',more);
END;
');
 INSERT INTO customer_source_membership_private.adapters(signature,before_md5,after_md5,settings) VALUES('public.crm_v2_booking_search(text,integer)','07a5d02eec0d88f9402d23f6830df766','79067ece9999973dfbbf2ef8624f8a9f',ARRAY['search_path=pg_catalog']::text[]);
END; $membership_adapter_3$;
DO $membership_adapter_4$
DECLARE d text; b text; owner_name text; secured boolean; settings text[];
BEGIN
 SELECT pg_get_functiondef(oid),replace(prosrc,E'\r\n',E'\n'),pg_get_userbyid(proowner),prosecdef,proconfig INTO d,b,owner_name,secured,settings FROM pg_proc WHERE oid='public.crm_v2_central_search(jsonb,integer)'::regprocedure;
 d:=replace(d,E'\r\n',E'\n');
 IF md5(b) IS DISTINCT FROM '0e8cd4fbb285bbbb764c1d099cca73de' OR owner_name IS DISTINCT FROM current_user OR owner_name IS DISTINCT FROM 'postgres' OR secured IS DISTINCT FROM true OR settings IS DISTINCT FROM ARRAY['search_path=pg_catalog','TimeZone=UTC']::text[] THEN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_ADAPTER_REVIEW_REQUIRED'; END IF;
 IF (length(d)-length(replace(d,b,'')))/NULLIF(length(b),0)<>1 THEN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_DEFINITION_AMBIGUOUS'; END IF;
 EXECUTE replace(d,b,'
DECLARE
  actor_id uuid:=auth.uid(); actor_role text:=public.crm_v2_role();
  trim_chars text:=U&'' \00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'';
  search_value text; project_value text; channel_value text; owner_value uuid; status_value text; unassigned boolean;
  filters_json jsonb; customers_json jsonb; channels_json jsonb; more_rows boolean; more_channels boolean;
BEGIN
  IF actor_id IS NULL OR COALESCE(actor_role,'''') NOT IN (''sales'',''admin'',''owner'') THEN
    RAISE EXCEPTION ''CRM_FORBIDDEN'';
  END IF;
  IF (public.crm_v2_central_search_capabilities()->>''enabled'')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION ''CRM_SETUP_REQUIRED'';
  END IF;
  IF p_page IS NULL OR p_page NOT BETWEEN 0 AND 100000 OR p_filters IS NULL OR jsonb_typeof(p_filters)<>''object'' THEN
    RAISE EXCEPTION ''CRM_INVALID_INPUT'';
  END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(p_filters))<>6
    OR NOT p_filters ?& ARRAY[''search'',''project'',''channel'',''owner'',''status'',''unassignedOnly'']
    OR jsonb_typeof(p_filters->''unassignedOnly'') IS DISTINCT FROM ''boolean''
    OR EXISTS(SELECT 1 FROM jsonb_each(p_filters) e WHERE e.key<>''unassignedOnly''
      AND (jsonb_typeof(e.value)<>''string'' OR (e.value#>>''{}'') ~ U&''[\0001-\001F\007F-\009F\2028\2029]'')) THEN
    RAISE EXCEPTION ''CRM_INVALID_INPUT'';
  END IF;
  search_value:=btrim(p_filters->>''search'',trim_chars); project_value:=p_filters->>''project'';
  channel_value:=p_filters->>''channel''; status_value:=p_filters->>''status''; unassigned:=(p_filters->>''unassignedOnly'')::boolean;
  IF length(search_value)>200 OR length(project_value)>200 OR length(channel_value)>80
    OR status_value NOT IN ('''',''new'',''contacted'',''considering'',''follow_up'',''nurture'',''lost'',''legacy_unclassified'')
    OR (unassigned AND project_value<>'''')
    OR ((p_filters->>''owner'')<>'''' AND (p_filters->>''owner'')!~* ''^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'') THEN
    RAISE EXCEPTION ''CRM_INVALID_INPUT'';
  END IF;
  owner_value:=NULLIF(p_filters->>''owner'','''')::uuid;
  filters_json:=jsonb_build_object(''search'',search_value,''project'',project_value,''channel'',channel_value,
    ''owner'',COALESCE(owner_value::text,''''),''status'',status_value,''unassignedOnly'',unassigned);

  -- Every filter is evaluated on the whole registry BEFORE the bounded page.
  -- Literal strpos means %, _ and backslash are text, not wildcard instructions.
  -- EXISTS preserves one row per customer ID, never a name/phone deduplication.
  WITH page_rows AS (
    SELECT c.* FROM customer_source_membership_private.customers c
    WHERE c.merged_into_customer_id IS NULL
      AND (channel_value='''' OR c.intake_channel=channel_value)
      AND (NOT unassigned OR NOT EXISTS(SELECT 1 FROM customer_source_membership_private.interests i WHERE i.customer_id=c.id))
      AND (search_value='''' OR strpos(lower(sales_private.crm_effective_customer_name(c.id)),lower(search_value))>0
        OR strpos(lower(COALESCE(sales_private.crm_effective_customer_phone(c.id),'''')),lower(search_value))>0
        OR strpos(lower(COALESCE(c.intake_notes,'''')),lower(search_value))>0
        OR EXISTS(SELECT 1 FROM customer_source_membership_private.interests i WHERE i.customer_id=c.id
          AND (strpos(lower(i.project_name),lower(search_value))>0
            OR strpos(lower(COALESCE(i.interested_plot_id,'''')),lower(search_value))>0)))
      AND ((project_value='''' AND (owner_value IS NULL OR c.owner_user_id=owner_value)
          AND (status_value='''' OR CASE WHEN c.intake_status=''following_up'' THEN ''follow_up'' ELSE c.intake_status END=status_value))
        OR EXISTS(SELECT 1 FROM customer_source_membership_private.interests i WHERE i.customer_id=c.id
          AND (project_value='''' OR i.project_name=project_value)
          AND (owner_value IS NULL OR i.owner_user_id=owner_value)
          AND (status_value='''' OR i.engagement_status=status_value)))
    ORDER BY c.created_at DESC,c.id LIMIT 51 OFFSET p_page*50
  ), numbered AS (SELECT *,row_number() OVER(ORDER BY created_at DESC,id) rn FROM page_rows)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    ''id'',c.id,''name'',sales_private.crm_effective_customer_name(c.id),''phone'',sales_private.crm_effective_customer_phone(c.id),''channel'',c.intake_channel,''notes'',c.intake_notes,
    ''ownerUserId'',c.owner_user_id,''leadCreatedAt'',c.lead_created_at,''intakeStatus'',c.intake_status,
    ''interests'',COALESCE((SELECT jsonb_agg(jsonb_build_object(''id'',i.id,''projectName'',i.project_name,
      ''ownerUserId'',i.owner_user_id,''workspaceState'',i.workspace_state,''engagementStatus'',i.engagement_status,
      ''plotId'',i.interested_plot_id) ORDER BY i.interest_created_at,i.id)
      FROM customer_source_membership_private.interests i WHERE i.customer_id=c.id),''[]''::jsonb)
  ) ORDER BY c.created_at DESC,c.id) FILTER(WHERE rn<=50),''[]''::jsonb),count(*)>50
  INTO customers_json,more_rows FROM numbered c;
  -- Global suggestions are independent of page/filter. Free-text exact channel
  -- remains supported when the bounded list has more than 200 distinct values.
  WITH distinct_channels AS (
    SELECT DISTINCT intake_channel FROM customer_source_membership_private.customers
    WHERE merged_into_customer_id IS NULL AND intake_channel IS NOT NULL AND intake_channel<>''''
    ORDER BY intake_channel LIMIT 201
  ), numbered AS (SELECT intake_channel,row_number() OVER(ORDER BY intake_channel) rn FROM distinct_channels)
  SELECT COALESCE(jsonb_agg(intake_channel ORDER BY intake_channel) FILTER(WHERE rn<=200),''[]''::jsonb),count(*)>200
  INTO channels_json,more_channels FROM numbered;
  RETURN jsonb_build_object(''actor'',jsonb_build_object(''userId'',actor_id,''role'',actor_role),
    ''projects'',COALESCE((SELECT jsonb_agg(jsonb_build_object(''name'',name) ORDER BY name)
      FROM public.projects WHERE is_closed IS NOT TRUE),''[]''::jsonb),
    ''salesOwners'',COALESCE((SELECT jsonb_agg(jsonb_build_object(''userId'',user_id,
      ''displayName'',COALESCE(NULLIF(btrim(display_name),''''),user_id::text)) ORDER BY display_name,user_id)
      FROM sales_private.crm_user_roles WHERE is_active AND role=''sales''),''[]''::jsonb),
    ''customers'',customers_json,''page'',p_page,''hasMore'',more_rows,
    ''search'',jsonb_build_object(''contractVersion'',''central_search_v1'',''filters'',filters_json,
      ''projects'',COALESCE((SELECT jsonb_agg(name ORDER BY name) FROM public.projects),''[]''::jsonb),
      ''owners'',COALESCE((SELECT jsonb_agg(jsonb_build_object(''userId'',user_id,
        ''displayName'',COALESCE(NULLIF(btrim(display_name),''''),user_id::text)) ORDER BY display_name,user_id)
        FROM sales_private.crm_user_roles WHERE role=''sales''),''[]''::jsonb),
      ''channels'',channels_json,''hasMoreChannels'',more_channels));
END;
');
 INSERT INTO customer_source_membership_private.adapters(signature,before_md5,after_md5,settings) VALUES('public.crm_v2_central_search(jsonb,integer)','0e8cd4fbb285bbbb764c1d099cca73de','d785fc2d9f473da91a4b7722c485d30a',ARRAY['search_path=pg_catalog','TimeZone=UTC']::text[]);
END; $membership_adapter_4$;
DO $membership_adapter_5$
DECLARE d text; b text; owner_name text; secured boolean; settings text[];
BEGIN
 SELECT pg_get_functiondef(oid),replace(prosrc,E'\r\n',E'\n'),pg_get_userbyid(proowner),prosecdef,proconfig INTO d,b,owner_name,secured,settings FROM pg_proc WHERE oid='public.crm_v2_central_snapshot(integer,integer)'::regprocedure;
 d:=replace(d,E'\r\n',E'\n');
 IF md5(b) IS DISTINCT FROM '695ce5a24ca2099844b74f66237af9f9' OR owner_name IS DISTINCT FROM current_user OR owner_name IS DISTINCT FROM 'postgres' OR secured IS DISTINCT FROM true OR settings IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] THEN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_ADAPTER_REVIEW_REQUIRED'; END IF;
 IF (length(d)-length(replace(d,b,'')))/NULLIF(length(b),0)<>1 THEN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_DEFINITION_AMBIGUOUS'; END IF;
 EXECUTE replace(d,b,'
DECLARE
  actor_id uuid := auth.uid();
  actor_role text := public.crm_v2_role();
  customers_json jsonb;
  more_rows boolean;
BEGIN
  IF actor_id IS NULL OR actor_role NOT IN (''sales'',''admin'',''owner'') THEN
    RAISE EXCEPTION ''CRM_FORBIDDEN'';
  END IF;
  IF NOT COALESCE((public.crm_v2_capabilities()->>''enabled'')::boolean,false) THEN
    RAISE EXCEPTION ''CRM_SETUP_REQUIRED'';
  END IF;
  IF p_page IS NULL OR p_page<0 OR p_page>100000 OR p_page_size IS DISTINCT FROM 50 THEN
    RAISE EXCEPTION ''CRM_INVALID_INPUT'';
  END IF;
  WITH page_rows AS (
    SELECT c.* FROM customer_source_membership_private.customers c WHERE c.merged_into_customer_id IS NULL
    ORDER BY c.created_at DESC,c.id LIMIT 51 OFFSET p_page*50
  ), visible_rows AS (
    SELECT * FROM page_rows ORDER BY created_at DESC,id LIMIT 50
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    ''id'',c.id,''name'',sales_private.crm_effective_customer_name(c.id),''phone'',sales_private.crm_effective_customer_phone(c.id),''channel'',c.intake_channel,
    ''notes'',c.intake_notes,''ownerUserId'',c.owner_user_id,''leadCreatedAt'',c.lead_created_at,
    ''intakeStatus'',c.intake_status,''interests'',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      ''id'',i.id,''projectName'',i.project_name,''ownerUserId'',i.owner_user_id,
      ''workspaceState'',i.workspace_state,''engagementStatus'',i.engagement_status,''plotId'',i.interested_plot_id
    ) ORDER BY i.interest_created_at,i.id) FROM customer_source_membership_private.interests i WHERE i.customer_id=c.id),''[]''::jsonb)
  ) ORDER BY c.created_at DESC,c.id),''[]''::jsonb),
    (SELECT count(*)>50 FROM page_rows)
  INTO customers_json,more_rows FROM visible_rows c;
  RETURN jsonb_build_object(
    ''actor'',jsonb_build_object(''userId'',actor_id,''role'',actor_role),
    ''projects'',COALESCE((SELECT jsonb_agg(jsonb_build_object(''name'',name) ORDER BY name)
      FROM public.projects WHERE is_closed IS NOT TRUE),''[]''::jsonb),
    ''salesOwners'',COALESCE((SELECT jsonb_agg(jsonb_build_object(''userId'',user_id,
      ''displayName'',COALESCE(NULLIF(btrim(display_name),''''),user_id::text)) ORDER BY display_name,user_id)
      FROM sales_private.crm_user_roles WHERE is_active AND role=''sales''),''[]''::jsonb),
    ''customers'',customers_json,''page'',p_page,''hasMore'',more_rows);
END;
');
 INSERT INTO customer_source_membership_private.adapters(signature,before_md5,after_md5,settings) VALUES('public.crm_v2_central_snapshot(integer,integer)','695ce5a24ca2099844b74f66237af9f9','245a1de5c9e48fcf5340c54a6b3d3cbf',ARRAY['search_path=pg_catalog']::text[]);
END; $membership_adapter_5$;
DO $membership_adapter_6$
DECLARE d text; b text; owner_name text; secured boolean; settings text[];
BEGIN
 SELECT pg_get_functiondef(oid),replace(prosrc,E'\r\n',E'\n'),pg_get_userbyid(proowner),prosecdef,proconfig INTO d,b,owner_name,secured,settings FROM pg_proc WHERE oid='public.crm_v2_change_lead_lifecycle(uuid,jsonb)'::regprocedure;
 d:=replace(d,E'\r\n',E'\n');
 IF md5(b) IS DISTINCT FROM 'f8b188911e61bd4c69568c525a75b6b4' OR owner_name IS DISTINCT FROM current_user OR owner_name IS DISTINCT FROM 'postgres' OR secured IS DISTINCT FROM true OR settings IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] THEN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_ADAPTER_REVIEW_REQUIRED'; END IF;
 IF (length(d)-length(replace(d,b,'')))/NULLIF(length(b),0)<>1 THEN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_DEFINITION_AMBIGUOUS'; END IF;
 EXECUTE replace(d,b,'
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
  affected_tasks uuid[]:=ARRAY[]::uuid[]; old_tasks jsonb:=''[]''::jsonb;
  response_value jsonb;
  uuid_pattern text:=''^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'';
BEGIN
 PERFORM customer_source_membership_private.assert_payload(p_payload);
  IF actor_id IS NULL OR actor_role IS NULL OR actor_role NOT IN (''sales'',''admin'') THEN
    RAISE EXCEPTION ''CRM_LIFECYCLE_FORBIDDEN'';
  END IF;
  SELECT central_intake_enabled AND lead_work_enabled AND lead_lifecycle_enabled INTO enabled
    FROM public.crm_settings WHERE id FOR SHARE;
  IF enabled IS DISTINCT FROM true THEN RAISE EXCEPTION ''CRM_LIFECYCLE_SETUP_REQUIRED''; END IF;
  IF p_request_id IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM ''object''
    OR octet_length(p_payload::text)>16384 THEN RAISE EXCEPTION ''CRM_LIFECYCLE_INVALID_INPUT''; END IF;
  IF NOT (p_payload ?& ARRAY[''command'',''customerId'',''interestId'',''expectedRevision'',''expectedActionId'',''reason''])
    OR jsonb_typeof(p_payload->''command'') IS DISTINCT FROM ''string''
    OR (p_payload->>''command'') NOT IN (''reassign_owner'',''close_lost'') THEN
    RAISE EXCEPTION ''CRM_LIFECYCLE_INVALID_INPUT'';
  END IF;
  command_name:=p_payload->>''command'';
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN (
      ''command'',''customerId'',''interestId'',''expectedRevision'',''expectedActionId'',''reason'',''newOwnerUserId''))
    OR (command_name=''close_lost'' AND p_payload ? ''newOwnerUserId'')
    OR (command_name=''reassign_owner'' AND NOT (p_payload ? ''newOwnerUserId'')) THEN
    RAISE EXCEPTION ''CRM_LIFECYCLE_INVALID_INPUT'';
  END IF;
  IF jsonb_typeof(p_payload->''customerId'') IS DISTINCT FROM ''string''
    OR length(p_payload->>''customerId'')<>36 OR (p_payload->>''customerId'') !~ uuid_pattern
    OR jsonb_typeof(p_payload->''expectedRevision'') IS DISTINCT FROM ''string''
    OR length(p_payload->>''expectedRevision'')<>36 OR (p_payload->>''expectedRevision'') !~ uuid_pattern
    OR jsonb_typeof(p_payload->''interestId'') NOT IN (''string'',''null'')
    OR (jsonb_typeof(p_payload->''interestId'')=''string''
      AND (length(p_payload->>''interestId'')<>36 OR (p_payload->>''interestId'') !~ uuid_pattern))
    OR jsonb_typeof(p_payload->''expectedActionId'') NOT IN (''string'',''null'')
    OR (jsonb_typeof(p_payload->''expectedActionId'')=''string''
      AND (length(p_payload->>''expectedActionId'')<>36 OR (p_payload->>''expectedActionId'') !~ uuid_pattern))
    OR jsonb_typeof(p_payload->''reason'') IS DISTINCT FROM ''string'' THEN
    RAISE EXCEPTION ''CRM_LIFECYCLE_INVALID_INPUT'';
  END IF;
  IF command_name=''reassign_owner'' THEN
    IF jsonb_typeof(p_payload->''newOwnerUserId'') IS DISTINCT FROM ''string''
      OR length(p_payload->>''newOwnerUserId'')<>36 OR (p_payload->>''newOwnerUserId'') !~ uuid_pattern THEN
      RAISE EXCEPTION ''CRM_LIFECYCLE_INVALID_INPUT'';
    END IF;
    new_owner:=(p_payload->>''newOwnerUserId'')::uuid;
  END IF;
  -- Only translate the text-validator error, before any mutation. Never swallow a
  -- later transaction failure or record a receipt for a partially applied command.
  BEGIN
    reason_value:=sales_private.crm_work_text(p_payload->>''reason'',1000);
  EXCEPTION WHEN raise_exception THEN
    RAISE EXCEPTION ''CRM_LIFECYCLE_INVALID_INPUT'';
  END;
  customer_id_value:=(p_payload->>''customerId'')::uuid;
  interest_id_value:=(p_payload->>''interestId'')::uuid;
  expected_revision:=(p_payload->>''expectedRevision'')::uuid;
  expected_action:=(p_payload->>''expectedActionId'')::uuid;

  -- SAME lock order and receipt namespace as 04: settings -> request -> customer
  -- -> selected interest -> ordered role rows -> action -> ordered SLA tasks.
  -- Every future interest-create/booking/reopen/merge command MUST lock customer
  -- first too. Broad legacy writes must be cut off before enabling this feature.
  PERFORM pg_advisory_xact_lock(hashtextextended(''lead-work:''||actor_id::text||'':''||p_request_id::text,0));
  SELECT * INTO customer_row FROM customer_source_membership_private.customers WHERE id=customer_id_value FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION ''CRM_LIFECYCLE_NOT_FOUND''; END IF;
  scope_owner:=customer_row.owner_user_id;
  scope_revision:=customer_row.lifecycle_revision;
  scope_status:=customer_row.intake_status;
  IF interest_id_value IS NOT NULL THEN
    SELECT * INTO interest_row FROM customer_source_membership_private.interests
      WHERE id=interest_id_value AND customer_id=customer_id_value FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION ''CRM_LIFECYCLE_NOT_FOUND''; END IF;
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
      target_active:=role_row.role=''sales'' AND role_row.is_active;
    END IF;
  END LOOP;
  IF actor_role IS NULL OR actor_role NOT IN (''sales'',''admin'')
    OR (command_name=''reassign_owner'' AND actor_role<>''admin'')
    OR (command_name=''close_lost'' AND actor_role=''sales'' AND actor_id<>scope_owner) THEN
    RAISE EXCEPTION ''CRM_LIFECYCLE_FORBIDDEN'';
  END IF;
  -- Authorization first; replay before state/version checks so a successful close
  -- or transfer can be recovered with exactly the same payload. Admin may rescue
  -- work whose OLD owner is inactive. The NEW owner must be active for new writes.
  SELECT * INTO request_row FROM sales_private.lead_work_command_requests
    WHERE actor_user_id=actor_id AND request_id=p_request_id;
  IF FOUND THEN
    IF request_row.request_payload IS DISTINCT FROM p_payload THEN
      RAISE EXCEPTION ''CRM_LIFECYCLE_IDEMPOTENCY_CONFLICT'';
    END IF;
    RETURN request_row.response || jsonb_build_object(''replayed'',true);
  END IF;
  IF customer_row.merged_into_customer_id IS NOT NULL OR scope_status=''lost'' THEN
    RAISE EXCEPTION ''CRM_LIFECYCLE_SCOPE_CLOSED'';
  END IF;
  IF scope_revision IS DISTINCT FROM expected_revision THEN RAISE EXCEPTION ''CRM_LIFECYCLE_STALE_SCOPE''; END IF;
  SELECT * INTO prior_action FROM public.crm_next_actions
    WHERE customer_id=customer_id_value AND project_interest_id IS NOT DISTINCT FROM interest_id_value
      AND status=''open'' FOR UPDATE;
  IF prior_action.id IS DISTINCT FROM expected_action THEN RAISE EXCEPTION ''CRM_LIFECYCLE_STALE_ACTION''; END IF;
  IF command_name=''reassign_owner'' THEN
    IF new_owner=scope_owner THEN RAISE EXCEPTION ''CRM_LIFECYCLE_UNCHANGED_OWNER''; END IF;
    IF target_active IS DISTINCT FROM true THEN
      RAISE EXCEPTION ''CRM_LIFECYCLE_INACTIVE_TARGET'';
    END IF;
  ELSE
    -- Lost is pre-booking ONLY, including cancelled/finished booking history.
    -- An unmapped legacy sale for this source customer also requires review first.
    IF EXISTS (SELECT 1 FROM customer_source_membership_private.sales s
      JOIN customer_source_membership_private.interests i ON i.id=s.project_interest_id
      WHERE i.customer_id=customer_id_value AND (interest_id_value IS NULL OR i.id=interest_id_value))
      OR EXISTS (SELECT 1 FROM customer_source_membership_private.sales s
        WHERE s.lead_id=customer_row.legacy_source_lead_id AND s.project_interest_id IS NULL) THEN
      RAISE EXCEPTION ''CRM_LIFECYCLE_BOOKING_HISTORY_EXISTS'';
    END IF;
    -- Closing intake is NOT closing all projects. Do not hide an active interest.
    IF interest_id_value IS NULL AND EXISTS (SELECT 1 FROM customer_source_membership_private.interests
      WHERE customer_id=customer_id_value AND engagement_status<>''lost'') THEN
      RAISE EXCEPTION ''CRM_LIFECYCLE_OPEN_INTERESTS'';
    END IF;
  END IF;
  -- Lock all affected open obligations before sampling authoritative time.
  FOR task_row IN SELECT * FROM public.crm_sla_tasks
    WHERE customer_id=customer_id_value AND project_interest_id IS NOT DISTINCT FROM interest_id_value
      AND status=''open'' ORDER BY id FOR UPDATE
  LOOP
    affected_tasks:=array_append(affected_tasks,task_row.id);
    -- No leave/HR details or unrestricted evaluation_snapshot in the public audit.
    old_tasks:=old_tasks || jsonb_build_array(jsonb_build_object(''id'',task_row.id,
      ''ownerUserId'',task_row.owner_user_id,''serviceDueAt'',task_row.service_due_at,
      ''staffDueAt'',task_row.staff_due_at,''accountabilityState'',task_row.accountability_state));
  END LOOP;
  server_now:=clock_timestamp();

  IF prior_action.id IS NOT NULL THEN
    UPDATE public.crm_next_actions SET
      status=CASE WHEN command_name=''reassign_owner'' THEN ''superseded'' ELSE ''cancelled'' END,
      closed_at=server_now,closed_by_user_id=actor_id,close_reason=reason_value WHERE id=prior_action.id;
    IF command_name=''reassign_owner'' THEN
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
      owner_user_id=CASE WHEN command_name=''reassign_owner'' THEN new_owner ELSE owner_user_id END,
      owner_assigned_at=CASE WHEN command_name=''reassign_owner'' THEN server_now ELSE owner_assigned_at END,
      intake_status=CASE WHEN command_name=''close_lost'' THEN ''lost'' ELSE intake_status END,
      lifecycle_revision=next_revision,updated_at=server_now WHERE id=customer_id_value;
  ELSE
    UPDATE public.lead_project_interests SET
      owner_user_id=CASE WHEN command_name=''reassign_owner'' THEN new_owner ELSE owner_user_id END,
      owner_assigned_at=CASE WHEN command_name=''reassign_owner'' THEN server_now ELSE owner_assigned_at END,
      engagement_status=CASE WHEN command_name=''close_lost'' THEN ''lost'' ELSE engagement_status END,
      lifecycle_revision=next_revision,updated_at=server_now
      WHERE id=interest_id_value AND customer_id=customer_id_value;
  END IF;
  IF command_name=''reassign_owner'' THEN
    -- Keep service clock/source/status. New-owner staff fairness requires separate
    -- policy/calendar review: do not inherit the old owner''s deadline or score.
    UPDATE public.crm_sla_tasks SET owner_user_id=new_owner,staff_due_at=NULL,notify_at=NULL,
      accountability_state=''needs_schedule'',
      evaluation_snapshot=evaluation_snapshot || jsonb_build_object(''lifecycleReview'',jsonb_build_object(
        ''state'',''owner_change_pending_review'',''revision'',next_revision,''changedAt'',server_now))
      WHERE id=ANY(affected_tasks);
    INSERT INTO public.crm_sla_exceptions (task_id,exception_type,reason,recorded_by_user_id,created_at)
      SELECT task_id,''owner_change'',reason_value,actor_id,server_now FROM unnest(affected_tasks) AS t(task_id);
  ELSE
    -- Cancellation is not contact success/done. Retain deadlines and any existing
    -- lateness; reporting must include cancelled obligations and their close time.
    UPDATE public.crm_sla_tasks SET status=''cancelled'',cancelled_at=server_now,
      cancelled_by_user_id=actor_id,cancellation_reason=reason_value WHERE id=ANY(affected_tasks);
  END IF;
  UPDATE public.crm_notifications SET withdrawn_at=server_now,withdrawal_reason=reason_value
    WHERE task_id=ANY(affected_tasks) AND withdrawn_at IS NULL;
  INSERT INTO public.crm_audit_events (
    customer_id,entity_type,entity_id,event_type,reason_text,actor_user_id,actor_kind,
    actor_name_snapshot,old_values,new_values,occurred_at,recorded_at
  ) VALUES (
    customer_id_value,CASE WHEN interest_id_value IS NULL THEN ''sales_customer'' ELSE ''lead_project_interest'' END,
    COALESCE(interest_id_value,customer_id_value),command_name,reason_value,actor_id,''staff'',actor_name,
    jsonb_build_object(''revision'',scope_revision,''ownerUserId'',scope_owner,''status'',scope_status,
      ''nextAction'',CASE WHEN prior_action.id IS NULL THEN NULL ELSE to_jsonb(prior_action) END,''openSlaTasks'',old_tasks),
    jsonb_build_object(''revision'',next_revision,''interestId'',interest_id_value,
      ''ownerUserId'',CASE WHEN command_name=''reassign_owner'' THEN new_owner ELSE scope_owner END,
      ''status'',CASE WHEN command_name=''close_lost'' THEN ''lost'' ELSE scope_status END,
      ''nextActionId'',next_action_id,''affectedSlaTaskIds'',to_jsonb(affected_tasks),
      ''priorWasOverdue'',CASE WHEN prior_action.id IS NULL THEN NULL ELSE prior_action.due_at<server_now END),
    server_now,server_now
  );
  response_value:=jsonb_build_object(''revision'',next_revision,''nextActionId'',next_action_id,''replayed'',false);
  INSERT INTO sales_private.lead_work_command_requests (actor_user_id,request_id,request_payload,response,created_at)
    VALUES (actor_id,p_request_id,p_payload,response_value,server_now);
  RETURN response_value;
END;
');
 INSERT INTO customer_source_membership_private.adapters(signature,before_md5,after_md5,settings) VALUES('public.crm_v2_change_lead_lifecycle(uuid,jsonb)','f8b188911e61bd4c69568c525a75b6b4','bfcf11f53038ba1ac2bd12d229fde35d',ARRAY['search_path=pg_catalog']::text[]);
END; $membership_adapter_6$;
DO $membership_adapter_7$
DECLARE d text; b text; owner_name text; secured boolean; settings text[];
BEGIN
 SELECT pg_get_functiondef(oid),replace(prosrc,E'\r\n',E'\n'),pg_get_userbyid(proowner),prosecdef,proconfig INTO d,b,owner_name,secured,settings FROM pg_proc WHERE oid='public.crm_v2_create_customer(uuid,jsonb)'::regprocedure;
 d:=replace(d,E'\r\n',E'\n');
 IF md5(b) IS DISTINCT FROM '85e98690c76b7986937881b755c2e7a1' OR owner_name IS DISTINCT FROM current_user OR owner_name IS DISTINCT FROM 'postgres' OR secured IS DISTINCT FROM true OR settings IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] THEN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_ADAPTER_REVIEW_REQUIRED'; END IF;
 IF (length(d)-length(replace(d,b,'')))/NULLIF(length(b),0)<>1 THEN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_DEFINITION_AMBIGUOUS'; END IF;
 EXECUTE replace(d,b,'
DECLARE
  actor_id uuid := auth.uid();
  actor_role text := public.crm_v2_role();
  owner_id uuid;
  actor_name text;
  saved_request sales_private.central_command_requests%ROWTYPE;
  normalized_phone text;
  new_customer_id uuid;
  new_interest_id uuid;
  interested_project text;
  chosen_plot text;
  interest jsonb;
  result jsonb;
  intake_at timestamptz := now();
  first_contact_hours integer;
BEGIN
 PERFORM customer_source_membership_private.assert_payload(p_payload);
  IF actor_id IS NULL OR actor_role NOT IN (''sales'',''admin'') THEN RAISE EXCEPTION ''CRM_FORBIDDEN''; END IF;
  IF NOT COALESCE((public.crm_v2_capabilities()->>''enabled'')::boolean,false) THEN
    RAISE EXCEPTION ''CRM_SETUP_REQUIRED'';
  END IF;
  IF p_request_id IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM ''object''
    OR octet_length(p_payload::text)>16384 THEN RAISE EXCEPTION ''CRM_INVALID_INPUT''; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN
      (''name'',''phone'',''channel'',''notes'',''interests'',''assignedSalesUserId''))
    OR jsonb_typeof(p_payload->''name'') IS DISTINCT FROM ''string''
    OR jsonb_typeof(p_payload->''phone'') IS DISTINCT FROM ''string''
    OR jsonb_typeof(p_payload->''channel'') IS DISTINCT FROM ''string''
    OR jsonb_typeof(p_payload->''notes'') IS DISTINCT FROM ''string''
    OR jsonb_typeof(p_payload->''interests'') IS DISTINCT FROM ''array'' THEN
    RAISE EXCEPTION ''CRM_INVALID_INPUT'';
  END IF;
  IF length(btrim(p_payload->>''name'')) NOT BETWEEN 1 AND 200
    OR length(p_payload->>''phone'')>32 OR (p_payload->>''phone'') !~ ''^\+?[0-9 ()-]+$''
    OR length(regexp_replace(p_payload->>''phone'',''[^0-9]'','''',''g'')) NOT BETWEEN 7 AND 15
    OR length(btrim(p_payload->>''channel'')) NOT BETWEEN 1 AND 80
    OR length(p_payload->>''notes'')>4000 OR jsonb_array_length(p_payload->''interests'')>20 THEN
    RAISE EXCEPTION ''CRM_INVALID_INPUT'';
  END IF;
  IF actor_role=''sales'' THEN
    IF p_payload ? ''assignedSalesUserId'' THEN RAISE EXCEPTION ''CRM_FORBIDDEN''; END IF;
    owner_id := actor_id;
  ELSE
    IF jsonb_typeof(p_payload->''assignedSalesUserId'') IS DISTINCT FROM ''string''
      OR (p_payload->>''assignedSalesUserId'') !~* ''^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'' THEN
      RAISE EXCEPTION ''CRM_SALES_OWNER_REQUIRED'';
    END IF;
    owner_id := (p_payload->>''assignedSalesUserId'')::uuid;
  END IF;
  PERFORM 1 FROM sales_private.crm_user_roles WHERE user_id=owner_id AND is_active AND role=''sales'' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION ''CRM_SALES_OWNER_REQUIRED''; END IF;

  -- Serialize retries of the same authenticated actor+command, then compare the
  -- complete JSON payload (not a weak hash); no duplicate rows on retry.
  PERFORM pg_advisory_xact_lock(hashtextextended(''central-request:''||actor_id::text||'':''||p_request_id::text,0));
  SELECT * INTO saved_request FROM sales_private.central_command_requests
    WHERE actor_user_id=actor_id AND request_id=p_request_id;
  IF FOUND THEN
    IF saved_request.request_payload IS DISTINCT FROM p_payload THEN RAISE EXCEPTION ''CRM_IDEMPOTENCY_CONFLICT''; END IF;
    RETURN saved_request.response || jsonb_build_object(''replayed'',true);
  END IF;

  normalized_phone := public.crm_v2_normalize_phone(p_payload->>''phone'');
  PERFORM pg_advisory_xact_lock(hashtextextended(''central-phone:''||normalized_phone,0));
  IF (EXISTS (SELECT 1 FROM sales_private.customer_profile_corrections o WHERE public.crm_v2_normalize_phone(o.phone)=normalized_phone)
    OR EXISTS (SELECT 1 FROM customer_source_membership_private.customers c WHERE c.phone_normalized=normalized_phone
      AND NOT EXISTS (SELECT 1 FROM sales_private.customer_profile_corrections o WHERE o.customer_id=c.id)))
    OR EXISTS (SELECT 1 FROM public.leads l WHERE public.crm_v2_normalize_phone(l.phone)=normalized_phone
      AND NOT EXISTS (SELECT 1 FROM public.crm_legacy_lead_links k WHERE k.legacy_lead_id=l.id)) THEN
    -- Never merge by phone or silently create a second owner of legacy data.
    RAISE EXCEPTION ''CRM_DUPLICATE_REVIEW_REQUIRED'';
  END IF;
  -- Mapped legacy rows use canonical customer phones; raw historical placeholders
  -- are retained for audit, not duplicate matching. Unmigrated legacy rows still
  -- block an exact phone match until reviewed. Writer cutover remains mandatory.
  IF (SELECT count(*) FROM jsonb_array_elements(p_payload->''interests'')) <>
    (SELECT count(DISTINCT btrim(value->>''projectName'')) FROM jsonb_array_elements(p_payload->''interests'')) THEN
    RAISE EXCEPTION ''CRM_INVALID_INPUT'';
  END IF;
  FOR interest IN SELECT value FROM jsonb_array_elements(p_payload->''interests'') LOOP
    IF jsonb_typeof(interest) IS DISTINCT FROM ''object'' THEN RAISE EXCEPTION ''CRM_INVALID_INPUT''; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(interest) k WHERE k NOT IN (''projectName'',''plotId''))
      OR jsonb_typeof(interest->''projectName'') IS DISTINCT FROM ''string''
      OR length(btrim(interest->>''projectName'')) NOT BETWEEN 1 AND 200
      OR NOT (interest ? ''plotId'') OR jsonb_typeof(interest->''plotId'') NOT IN (''string'',''null'') THEN
      RAISE EXCEPTION ''CRM_INVALID_INPUT'';
    END IF;
    interested_project := btrim(interest->>''projectName'');
    chosen_plot := interest->>''plotId'';
    IF chosen_plot IS NOT NULL AND (length(chosen_plot) NOT BETWEEN 1 AND 255 OR btrim(chosen_plot)='''') THEN
      RAISE EXCEPTION ''CRM_INVALID_INPUT'';
    END IF;
    PERFORM 1 FROM public.projects WHERE name=interested_project AND is_closed IS NOT TRUE FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION ''CRM_INVALID_INPUT''; END IF;
    IF chosen_plot IS NOT NULL THEN
      PERFORM 1 FROM public.plots p WHERE p.id=chosen_plot AND p.project_name=interested_project
        AND p.has_customer IS FALSE AND lower(btrim(COALESCE(p.sale_status,'''')))
          IN ('''',''active'',''normal'',''ready_for_sale'',''available'',''vacant'') FOR SHARE;
      IF NOT FOUND OR EXISTS (SELECT 1 FROM customer_source_membership_private.sales s WHERE s.plot_id=chosen_plot
        AND lower(btrim(COALESCE(s.crm_stage,s.contract_status,'''')))<>''cancelled'') THEN
        RAISE EXCEPTION ''CRM_PLOT_UNAVAILABLE'';
      END IF;
    END IF;
  END LOOP;

  SELECT COALESCE(NULLIF(btrim(display_name),''''),actor_id::text) INTO actor_name
    FROM sales_private.crm_user_roles WHERE user_id=actor_id;
  INSERT INTO public.sales_customers(customer_name,phone,intake_channel,intake_notes,
    owner_user_id,created_by_user_id,owner_assigned_at,lead_created_at)
  VALUES (btrim(p_payload->>''name''),btrim(p_payload->>''phone''),btrim(p_payload->>''channel''),p_payload->>''notes'',
    owner_id,actor_id,intake_at,intake_at) RETURNING id INTO new_customer_id;
  INSERT INTO public.crm_audit_events(customer_id,entity_type,entity_id,event_type,reason_text,
    actor_user_id,actor_kind,actor_name_snapshot,new_values,occurred_at)
  VALUES (new_customer_id,''customer'',new_customer_id,''created'',''รับ Lead ใหม่'',actor_id,''staff'',actor_name,
    jsonb_build_object(''ownerUserId'',owner_id,''intakeStatus'',''new''),intake_at);
  FOR interest IN SELECT value FROM jsonb_array_elements(p_payload->''interests'') LOOP
    INSERT INTO public.lead_project_interests(customer_id,project_name,owner_user_id,
      interested_plot_id,created_by_user_id,owner_assigned_at,interest_created_at)
    VALUES (new_customer_id,btrim(interest->>''projectName''),owner_id,interest->>''plotId'',actor_id,intake_at,intake_at)
    RETURNING id INTO new_interest_id;
    INSERT INTO public.crm_audit_events(customer_id,entity_type,entity_id,event_type,reason_text,
      actor_user_id,actor_kind,actor_name_snapshot,new_values,occurred_at)
    VALUES (new_customer_id,''interest'',new_interest_id,''created'',''บันทึกโครงการที่ลูกค้าสนใจ'',actor_id,''staff'',actor_name,
      jsonb_build_object(''projectName'',btrim(interest->>''projectName''),''ownerUserId'',owner_id,''workspaceState'',''central_interest''),intake_at);
  END LOOP;
  SELECT COALESCE((SELECT initial_contact_hours FROM public.crm_settings WHERE id),24) INTO first_contact_hours;
  INSERT INTO public.crm_sla_tasks(customer_id,owner_user_id,task_type,obligation_started_at,service_due_at,
    accountability_state,evaluation_snapshot)
  VALUES (new_customer_id,owner_id,''first_contact'',intake_at,intake_at+make_interval(hours=>first_contact_hours),
    ''needs_schedule'',jsonb_build_object(''initialContactHours'',first_contact_hours,''clock'',''elapsed'',''staffDueKnown'',false));
  result := jsonb_build_object(''customerId'',new_customer_id,''replayed'',false);
  INSERT INTO sales_private.central_command_requests(actor_user_id,request_id,request_payload,response)
    VALUES (actor_id,p_request_id,p_payload,result);
  RETURN result;
END;
');
 INSERT INTO customer_source_membership_private.adapters(signature,before_md5,after_md5,settings) VALUES('public.crm_v2_create_customer(uuid,jsonb)','85e98690c76b7986937881b755c2e7a1','e9efe0c882474d04cbc61a71c7a6213f',ARRAY['search_path=pg_catalog']::text[]);
END; $membership_adapter_7$;
DO $membership_adapter_8$
DECLARE d text; b text; owner_name text; secured boolean; settings text[];
BEGIN
 SELECT pg_get_functiondef(oid),replace(prosrc,E'\r\n',E'\n'),pg_get_userbyid(proowner),prosecdef,proconfig INTO d,b,owner_name,secured,settings FROM pg_proc WHERE oid='public.crm_v2_customer_deal_details_command(uuid,jsonb)'::regprocedure;
 d:=replace(d,E'\r\n',E'\n');
 IF md5(b) IS DISTINCT FROM '99baf1fcd46d64fe35055b899adc5b80' OR owner_name IS DISTINCT FROM current_user OR owner_name IS DISTINCT FROM 'postgres' OR secured IS DISTINCT FROM true OR settings IS DISTINCT FROM ARRAY['search_path=pg_catalog','TimeZone=UTC']::text[] THEN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_ADAPTER_REVIEW_REQUIRED'; END IF;
 IF (length(d)-length(replace(d,b,'')))/NULLIF(length(b),0)<>1 THEN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_DEFINITION_AMBIGUOUS'; END IF;
 EXECUTE replace(d,b,'
DECLARE actor_id uuid:=auth.uid(); actor_role text:=public.crm_v2_role(); actor_name text; actor_active boolean:=false;
 customer_id_value uuid; sale_id_value uuid; expected_customer uuid; expected_interest uuid; expected_sale uuid;
 expected_profile uuid; expected_deal uuid; project_value text; reason_value text; profile jsonb; details jsonb;
 normalized_phone_value text; name_value text; phone_value text; occupation_value text; bank_value text; price_value numeric; server_now timestamptz;
 allowed_keys text[]:=ARRAY[''command'',''customerId'',''saleId'',''projectName'',''expectedCustomerRevision'',''expectedInterestRevision'',''expectedSaleRevision'',
  ''expectedCustomerDetailsRevision'',''expectedDealDetailsRevision'',''reason'',''profile'',''dealDetails''];
 c public.sales_customers%ROWTYPE; i public.lead_project_interests%ROWTYPE; s public.sales%ROWTYPE;
 pc sales_private.customer_profile_corrections%ROWTYPE; dc sales_private.deal_details_corrections%ROWTYPE;
 new_pc sales_private.customer_profile_corrections%ROWTYPE; new_dc sales_private.deal_details_corrections%ROWTYPE;
 role_row sales_private.crm_user_roles%ROWTYPE; prior sales_private.customer_deal_details_requests%ROWTYPE; result jsonb;
BEGIN
 PERFORM customer_source_membership_private.assert_payload(p_payload);
 IF actor_id IS NULL OR COALESCE(actor_role,'''') NOT IN (''sales'',''admin'') THEN RAISE EXCEPTION ''CRM_CUSTOMER_DEAL_DETAILS_FORBIDDEN''; END IF;
 PERFORM 1 FROM public.crm_settings WHERE id AND central_intake_enabled AND lead_work_enabled AND lead_lifecycle_enabled
  AND booking_enabled AND booking_cutover_reviewed AND post_booking_enabled FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION ''CRM_CUSTOMER_DEAL_DETAILS_SETUP_REQUIRED''; END IF;
 IF p_request_id IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM ''object'' OR octet_length(p_payload::text)>16384
  OR NOT(p_payload ?& allowed_keys) OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE NOT(k=ANY(allowed_keys)))
  OR jsonb_typeof(p_payload->''command'') IS DISTINCT FROM ''string'' OR p_payload->>''command''<>''update_details'' THEN RAISE EXCEPTION ''CRM_CUSTOMER_DEAL_DETAILS_INVALID_INPUT''; END IF;
 BEGIN
  customer_id_value:=sales_private.crm_booking_uuid(p_payload->''customerId''); sale_id_value:=sales_private.crm_booking_uuid(p_payload->''saleId'');
  expected_customer:=sales_private.crm_booking_uuid(p_payload->''expectedCustomerRevision''); expected_interest:=sales_private.crm_booking_uuid(p_payload->''expectedInterestRevision'');
  expected_sale:=sales_private.crm_booking_uuid(p_payload->''expectedSaleRevision''); expected_profile:=sales_private.crm_booking_uuid(p_payload->''expectedCustomerDetailsRevision'',true);
  expected_deal:=sales_private.crm_booking_uuid(p_payload->''expectedDealDetailsRevision'',true);
  project_value:=sales_private.crm_work_text(p_payload->>''projectName'',200); reason_value:=sales_private.crm_work_text(p_payload->>''reason'',1000);
 EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION ''CRM_CUSTOMER_DEAL_DETAILS_INVALID_INPUT''; END;
 IF jsonb_typeof(p_payload->''reason'')<>''string'' OR jsonb_typeof(p_payload->''projectName'')<>''string''
  OR reason_value<>p_payload->>''reason'' OR project_value<>p_payload->>''projectName'' THEN RAISE EXCEPTION ''CRM_CUSTOMER_DEAL_DETAILS_INVALID_INPUT''; END IF;
 profile:=p_payload->''profile''; details:=p_payload->''dealDetails'';
 IF profile=''null''::jsonb AND details=''null''::jsonb THEN RAISE EXCEPTION ''CRM_CUSTOMER_DEAL_DETAILS_INVALID_INPUT''; END IF;
 IF profile<>''null''::jsonb THEN
  IF jsonb_typeof(profile)<>''object'' OR NOT(profile ?& ARRAY[''name'',''phone'',''occupation''])
   OR EXISTS(SELECT 1 FROM jsonb_object_keys(profile) k WHERE k NOT IN (''name'',''phone'',''occupation''))
   OR jsonb_typeof(profile->''name'')<>''string'' OR jsonb_typeof(profile->''phone'') NOT IN (''null'',''string'')
   OR jsonb_typeof(profile->''occupation'') NOT IN (''null'',''string'') THEN RAISE EXCEPTION ''CRM_CUSTOMER_DEAL_DETAILS_INVALID_INPUT''; END IF;
  BEGIN name_value:=sales_private.crm_work_text(profile->>''name'',200);
   IF profile->''occupation''<>''null''::jsonb THEN occupation_value:=sales_private.crm_work_text(profile->>''occupation'',200); END IF;
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION ''CRM_CUSTOMER_DEAL_DETAILS_INVALID_INPUT''; END;
  phone_value:=profile->>''phone'';
  IF name_value<>profile->>''name'' OR occupation_value IS DISTINCT FROM profile->>''occupation'' OR
   (phone_value IS NOT NULL AND (phone_value<>btrim(phone_value) OR length(phone_value)>32 OR phone_value!~''^\+?[0-9 ()-]+$''
    OR length(regexp_replace(phone_value,''[^0-9]'','''',''g'')) NOT BETWEEN 7 AND 15)) THEN RAISE EXCEPTION ''CRM_CUSTOMER_DEAL_DETAILS_INVALID_INPUT''; END IF;
 END IF;
 IF details<>''null''::jsonb THEN
  IF jsonb_typeof(details)<>''object'' OR NOT(details ?& ARRAY[''salePriceSatang'',''bankName''])
   OR EXISTS(SELECT 1 FROM jsonb_object_keys(details) k WHERE k NOT IN (''salePriceSatang'',''bankName''))
   OR jsonb_typeof(details->''salePriceSatang'') NOT IN (''null'',''number'') OR jsonb_typeof(details->''bankName'') NOT IN (''null'',''string'') THEN RAISE EXCEPTION ''CRM_CUSTOMER_DEAL_DETAILS_INVALID_INPUT''; END IF;
  IF details->''salePriceSatang''<>''null''::jsonb THEN
   IF details->>''salePriceSatang''!~''^[1-9][0-9]{0,10}$'' OR (details->>''salePriceSatang'')::numeric>99999999999 THEN RAISE EXCEPTION ''CRM_CUSTOMER_DEAL_DETAILS_INVALID_INPUT''; END IF;
   price_value:=(details->>''salePriceSatang'')::numeric/100;
  END IF;
  IF details->''bankName''<>''null''::jsonb THEN
   BEGIN bank_value:=sales_private.crm_work_text(details->>''bankName'',200); EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION ''CRM_CUSTOMER_DEAL_DETAILS_INVALID_INPUT''; END;
   IF bank_value<>details->>''bankName'' THEN RAISE EXCEPTION ''CRM_CUSTOMER_DEAL_DETAILS_INVALID_INPUT''; END IF;
  END IF;
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(''crm-booking-command'',0));
 SELECT * INTO c FROM customer_source_membership_private.customers WHERE id=customer_id_value FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION ''CRM_CUSTOMER_DEAL_DETAILS_NOT_FOUND''; END IF;
 SELECT li.* INTO i FROM customer_source_membership_private.interests li JOIN customer_source_membership_private.sales ss ON ss.project_interest_id=li.id
  WHERE ss.id=sale_id_value AND li.customer_id=c.id AND li.project_name=project_value FOR UPDATE OF li;
 IF NOT FOUND THEN RAISE EXCEPTION ''CRM_CUSTOMER_DEAL_DETAILS_NOT_FOUND''; END IF;
 FOR role_row IN SELECT * FROM sales_private.crm_user_roles WHERE user_id IN(actor_id,c.owner_user_id,i.owner_user_id) ORDER BY user_id FOR SHARE LOOP
  IF role_row.user_id=actor_id AND role_row.is_active THEN actor_role:=role_row.role; actor_name:=role_row.display_name; actor_active:=true; END IF;
 END LOOP;
 IF NOT actor_active OR actor_role NOT IN (''sales'',''admin'') OR
  (actor_role=''sales'' AND ((profile<>''null''::jsonb AND actor_id<>c.owner_user_id) OR (details<>''null''::jsonb AND actor_id<>i.owner_user_id))) THEN RAISE EXCEPTION ''CRM_CUSTOMER_DEAL_DETAILS_FORBIDDEN''; END IF;
 SELECT * INTO s FROM customer_source_membership_private.sales WHERE id=sale_id_value AND project_interest_id=i.id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION ''CRM_CUSTOMER_DEAL_DETAILS_NOT_FOUND''; END IF;
 SELECT * INTO prior FROM sales_private.customer_deal_details_requests WHERE actor_user_id=actor_id AND request_id=p_request_id;
 IF FOUND THEN
  IF prior.request_payload IS DISTINCT FROM p_payload THEN RAISE EXCEPTION ''CRM_CUSTOMER_DEAL_DETAILS_IDEMPOTENCY_CONFLICT''; END IF;
  RETURN prior.response||jsonb_build_object(''replayed'',true);
 END IF;
 SELECT * INTO pc FROM sales_private.customer_profile_corrections WHERE customer_id=c.id FOR UPDATE;
 SELECT * INTO dc FROM sales_private.deal_details_corrections WHERE sale_id=s.id FOR UPDATE;
 IF c.merged_into_customer_id IS NOT NULL THEN RAISE EXCEPTION ''CRM_CUSTOMER_DEAL_DETAILS_CONFLICT''; END IF;
 IF c.lifecycle_revision IS DISTINCT FROM expected_customer OR i.lifecycle_revision IS DISTINCT FROM expected_interest
  OR s.booking_revision IS DISTINCT FROM expected_sale OR pc.revision IS DISTINCT FROM expected_profile OR dc.revision IS DISTINCT FROM expected_deal THEN RAISE EXCEPTION ''CRM_CUSTOMER_DEAL_DETAILS_STALE_STATE''; END IF;
 IF s.crm_stage IS NULL OR (s.booking_round IS NULL AND sales_private.crm_booking_imported_history(to_jsonb(s)) IS NULL)
  OR (s.plot_id IS NULL AND s.crm_stage<>''cancelled'') OR (s.plot_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.plots WHERE id=s.plot_id AND project_name=i.project_name))
  OR EXISTS(SELECT 1 FROM customer_source_membership_private.sales WHERE lead_id=c.legacy_source_lead_id AND project_interest_id IS NULL) THEN RAISE EXCEPTION ''CRM_CUSTOMER_DEAL_DETAILS_SETUP_REQUIRED''; END IF;
 IF details<>''null''::jsonb AND actor_role=''sales'' AND s.crm_stage IN (''cancelled'',''transferred'',''handover'') THEN RAISE EXCEPTION ''CRM_CUSTOMER_DEAL_DETAILS_CONFLICT''; END IF;
 -- Share the intake phone-review lock for both current and replacement phone, sorted to avoid lock inversion.
 IF profile<>''null''::jsonb THEN
  FOR normalized_phone_value IN SELECT DISTINCT v FROM unnest(ARRAY[
   public.crm_v2_normalize_phone(sales_private.crm_effective_customer_phone(c.id)),public.crm_v2_normalize_phone(phone_value)]) v
   WHERE v IS NOT NULL ORDER BY v LOOP
   PERFORM pg_advisory_xact_lock(hashtextextended(''central-phone:''||normalized_phone_value,0));
  END LOOP;
 END IF;
 -- No-op is rejected; corrections are not a substitute for business events or source editing.
 IF profile<>''null''::jsonb AND name_value IS NOT DISTINCT FROM sales_private.crm_effective_customer_name(c.id)
   AND phone_value IS NOT DISTINCT FROM sales_private.crm_effective_customer_phone(c.id)
   AND occupation_value IS NOT DISTINCT FROM (CASE WHEN pc.customer_id IS NULL THEN NULLIF(sales_private.crm_customer_deal_details_trim(c.occupation),'''') ELSE pc.occupation END) THEN RAISE EXCEPTION ''CRM_CUSTOMER_DEAL_DETAILS_CONFLICT''; END IF;
 IF details<>''null''::jsonb AND price_value IS NOT DISTINCT FROM sales_private.crm_effective_sale_price(s.id)
   AND bank_value IS NOT DISTINCT FROM (CASE WHEN dc.sale_id IS NULL THEN NULLIF(sales_private.crm_customer_deal_details_trim(s.bank_name),'''') ELSE dc.bank_name END) THEN RAISE EXCEPTION ''CRM_CUSTOMER_DEAL_DETAILS_CONFLICT''; END IF;
 server_now:=clock_timestamp();
 IF profile<>''null''::jsonb THEN
  new_pc.customer_id:=c.id; new_pc.name:=name_value; new_pc.phone:=phone_value; new_pc.occupation:=occupation_value;
  new_pc.revision:=gen_random_uuid(); new_pc.actor_user_id:=actor_id; new_pc.reason:=reason_value; new_pc.recorded_at:=server_now;
  INSERT INTO sales_private.customer_deal_details_permits VALUES(txid_current(),pg_backend_pid(),actor_id,''customer'',c.id,
   CASE WHEN pc.customer_id IS NULL THEN NULL ELSE to_jsonb(pc) END,to_jsonb(new_pc));
  -- Explicit INSERT/UPDATE avoids INSERT triggers on an UPSERT proposed row when an old overlay exists.
  IF pc.customer_id IS NULL THEN INSERT INTO sales_private.customer_profile_corrections SELECT new_pc.*;
  ELSE UPDATE sales_private.customer_profile_corrections SET name=new_pc.name,phone=new_pc.phone,occupation=new_pc.occupation,
   revision=new_pc.revision,actor_user_id=actor_id,reason=reason_value,recorded_at=server_now WHERE customer_id=c.id; END IF;
 ELSE new_pc:=pc; END IF;
 IF details<>''null''::jsonb THEN
  new_dc.sale_id:=s.id; new_dc.sale_price:=price_value; new_dc.bank_name:=bank_value; new_dc.revision:=gen_random_uuid();
  new_dc.actor_user_id:=actor_id; new_dc.reason:=reason_value; new_dc.recorded_at:=server_now;
  INSERT INTO sales_private.customer_deal_details_permits VALUES(txid_current(),pg_backend_pid(),actor_id,''deal'',s.id,
   CASE WHEN dc.sale_id IS NULL THEN NULL ELSE to_jsonb(dc) END,to_jsonb(new_dc));
  IF dc.sale_id IS NULL THEN INSERT INTO sales_private.deal_details_corrections SELECT new_dc.*;
  ELSE UPDATE sales_private.deal_details_corrections SET sale_price=new_dc.sale_price,bank_name=new_dc.bank_name,
   revision=new_dc.revision,actor_user_id=actor_id,reason=reason_value,recorded_at=server_now WHERE sale_id=s.id; END IF;
 ELSE new_dc:=dc; END IF;
 DELETE FROM sales_private.customer_deal_details_permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid();
 INSERT INTO public.crm_audit_events(customer_id,entity_type,entity_id,event_type,reason_text,actor_user_id,actor_kind,actor_name_snapshot,old_values,new_values,occurred_at,recorded_at)
  VALUES(c.id,''sale'',s.id,''customer_deal_details_corrected'',reason_value,actor_id,''staff'',actor_name,
   jsonb_build_object(''profile'',CASE WHEN pc.customer_id IS NULL THEN NULL ELSE to_jsonb(pc) END,''dealDetails'',CASE WHEN dc.sale_id IS NULL THEN NULL ELSE to_jsonb(dc) END),
   jsonb_build_object(''profile'',CASE WHEN new_pc.customer_id IS NULL THEN NULL ELSE to_jsonb(new_pc) END,''dealDetails'',CASE WHEN new_dc.sale_id IS NULL THEN NULL ELSE to_jsonb(new_dc) END,
    ''sourceCustomer'',jsonb_build_object(''id'',c.id,''name'',c.customer_name,''phone'',c.phone,''occupation'',c.occupation),
    ''sourceDeal'',jsonb_build_object(''id'',s.id,''salePrice'',s.sale_price,''bankName'',s.bank_name),''baseCustomerRevision'',c.lifecycle_revision,
    ''baseInterestRevision'',i.lifecycle_revision,''baseSaleRevision'',s.booking_revision),NULL,server_now);
 result:=jsonb_build_object(''requestId'',p_request_id,''command'',''update_details'',''customerId'',c.id,''interestId'',i.id,''saleId'',s.id,
  ''customerRevision'',c.lifecycle_revision,''interestRevision'',i.lifecycle_revision,''saleRevision'',s.booking_revision,
  ''customerDetailsRevision'',new_pc.revision,''dealDetailsRevision'',new_dc.revision,''replayed'',false);
 INSERT INTO sales_private.customer_deal_details_requests VALUES(actor_id,p_request_id,p_payload,result,server_now);
 RETURN result;
END;
');
 INSERT INTO customer_source_membership_private.adapters(signature,before_md5,after_md5,settings) VALUES('public.crm_v2_customer_deal_details_command(uuid,jsonb)','99baf1fcd46d64fe35055b899adc5b80','e8d79f6942c418ca79379d9f5ff0bafc',ARRAY['search_path=pg_catalog','TimeZone=UTC']::text[]);
END; $membership_adapter_8$;
DO $membership_adapter_9$
DECLARE d text; b text; owner_name text; secured boolean; settings text[];
BEGIN
 SELECT pg_get_functiondef(oid),replace(prosrc,E'\r\n',E'\n'),pg_get_userbyid(proowner),prosecdef,proconfig INTO d,b,owner_name,secured,settings FROM pg_proc WHERE oid='public.crm_v2_customer_deal_details_context(uuid,text)'::regprocedure;
 d:=replace(d,E'\r\n',E'\n');
 IF md5(b) IS DISTINCT FROM '839f56c269ce29216e173d745fab6e80' OR owner_name IS DISTINCT FROM current_user OR owner_name IS DISTINCT FROM 'postgres' OR secured IS DISTINCT FROM true OR settings IS DISTINCT FROM ARRAY['search_path=pg_catalog','TimeZone=UTC']::text[] THEN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_ADAPTER_REVIEW_REQUIRED'; END IF;
 IF (length(d)-length(replace(d,b,'')))/NULLIF(length(b),0)<>1 THEN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_DEFINITION_AMBIGUOUS'; END IF;
 EXECUTE replace(d,b,'
DECLARE actor_id uuid:=auth.uid(); actor_role text:=public.crm_v2_role();
  c public.sales_customers%ROWTYPE; i public.lead_project_interests%ROWTYPE; s public.sales%ROWTYPE;
  pc sales_private.customer_profile_corrections%ROWTYPE; dc sales_private.deal_details_corrections%ROWTYPE;
BEGIN
 IF actor_id IS NULL OR COALESCE(actor_role,'''') NOT IN (''sales'',''admin'',''owner'') THEN RAISE EXCEPTION ''CRM_CUSTOMER_DEAL_DETAILS_FORBIDDEN''; END IF;
 IF (public.crm_v2_customer_deal_details_capabilities()->>''enabled'')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION ''CRM_CUSTOMER_DEAL_DETAILS_SETUP_REQUIRED''; END IF;
 IF p_sale_id IS NULL OR p_project_name IS NULL OR length(p_project_name) NOT BETWEEN 1 AND 200
   OR p_project_name<>btrim(p_project_name) OR p_project_name ~ U&''[\0001-\001F\007F-\009F\2028\2029]'' THEN RAISE EXCEPTION ''CRM_CUSTOMER_DEAL_DETAILS_INVALID_INPUT''; END IF;
 SELECT * INTO s FROM customer_source_membership_private.sales WHERE id=p_sale_id;
 SELECT * INTO i FROM customer_source_membership_private.interests WHERE id=s.project_interest_id AND project_name=p_project_name;
 SELECT * INTO c FROM customer_source_membership_private.customers WHERE id=i.customer_id;
 IF s.id IS NULL OR i.id IS NULL OR c.id IS NULL THEN RAISE EXCEPTION ''CRM_CUSTOMER_DEAL_DETAILS_NOT_FOUND''; END IF;
 IF c.merged_into_customer_id IS NOT NULL OR s.crm_stage IS NULL OR
  (s.plot_id IS NULL AND s.crm_stage<>''cancelled'') OR
  (s.plot_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.plots WHERE id=s.plot_id AND project_name=i.project_name)) OR
  (s.booking_round IS NULL AND sales_private.crm_booking_imported_history(to_jsonb(s)) IS NULL)
  OR EXISTS(SELECT 1 FROM customer_source_membership_private.sales WHERE lead_id=c.legacy_source_lead_id AND project_interest_id IS NULL) THEN RAISE EXCEPTION ''CRM_CUSTOMER_DEAL_DETAILS_SETUP_REQUIRED''; END IF;
 SELECT * INTO pc FROM sales_private.customer_profile_corrections WHERE customer_id=c.id;
 SELECT * INTO dc FROM sales_private.deal_details_corrections WHERE sale_id=s.id;
 RETURN jsonb_build_object(''actor'',jsonb_build_object(''userId'',actor_id,''role'',actor_role),
  ''customer'',jsonb_build_object(''id'',c.id,''name'',CASE WHEN pc.customer_id IS NULL THEN sales_private.crm_customer_deal_details_trim(c.customer_name) ELSE pc.name END,
   ''phone'',CASE WHEN pc.customer_id IS NULL THEN NULLIF(sales_private.crm_customer_deal_details_trim(c.phone),'''') ELSE pc.phone END,''occupation'',CASE WHEN pc.customer_id IS NULL THEN NULLIF(sales_private.crm_customer_deal_details_trim(c.occupation),'''') ELSE pc.occupation END,
   ''ownerUserId'',c.owner_user_id,''revision'',c.lifecycle_revision,''detailsRevision'',pc.revision,
   ''canEdit'',actor_role=''admin'' OR (actor_role=''sales'' AND actor_id=c.owner_user_id),''sourceName'',sales_private.crm_customer_deal_details_trim(c.customer_name),''sourcePhone'',NULLIF(sales_private.crm_customer_deal_details_trim(c.phone),'''')),
  ''deal'',jsonb_build_object(''id'',s.id,''customerId'',c.id,''interestId'',i.id,''projectName'',i.project_name,''plotId'',s.plot_id,''stage'',s.crm_stage,
   ''ownerUserId'',i.owner_user_id,''revision'',s.booking_revision,''interestRevision'',i.lifecycle_revision,''detailsRevision'',dc.revision,
   ''salePrice'',CASE WHEN dc.sale_id IS NULL THEN s.sale_price ELSE dc.sale_price END,''sourceSalePrice'',s.sale_price,
   ''bankName'',CASE WHEN dc.sale_id IS NULL THEN NULLIF(sales_private.crm_customer_deal_details_trim(s.bank_name),'''') ELSE dc.bank_name END,''sourceBankName'',NULLIF(sales_private.crm_customer_deal_details_trim(s.bank_name),''''),''paymentMethod'',s.payment_method,
   ''canEdit'',actor_role=''admin'' OR (actor_role=''sales'' AND actor_id=i.owner_user_id AND s.crm_stage NOT IN (''cancelled'',''transferred'',''handover''))));
END;
');
 INSERT INTO customer_source_membership_private.adapters(signature,before_md5,after_md5,settings) VALUES('public.crm_v2_customer_deal_details_context(uuid,text)','839f56c269ce29216e173d745fab6e80','a9012dbbecf6fab6f5880bb36d517975',ARRAY['search_path=pg_catalog','TimeZone=UTC']::text[]);
END; $membership_adapter_9$;
DO $membership_adapter_10$
DECLARE d text; b text; owner_name text; secured boolean; settings text[];
BEGIN
 SELECT pg_get_functiondef(oid),replace(prosrc,E'\r\n',E'\n'),pg_get_userbyid(proowner),prosecdef,proconfig INTO d,b,owner_name,secured,settings FROM pg_proc WHERE oid='public.crm_v2_customer_voice_open(text)'::regprocedure;
 d:=replace(d,E'\r\n',E'\n');
 IF md5(b) IS DISTINCT FROM 'd63906090a34635ba83ab92707a48557' OR owner_name IS DISTINCT FROM current_user OR owner_name IS DISTINCT FROM 'postgres' OR secured IS DISTINCT FROM true OR settings IS DISTINCT FROM ARRAY['search_path=pg_catalog','TimeZone=UTC']::text[] THEN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_ADAPTER_REVIEW_REQUIRED'; END IF;
 IF (length(d)-length(replace(d,b,'')))/NULLIF(length(b),0)<>1 THEN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_DEFINITION_AMBIGUOUS'; END IF;
 EXECUTE replace(d,b,'
DECLARE expiry timestamptz; token_hash_value text;
BEGIN
 IF p_token IS NULL OR p_token !~ ''^[a-f0-9]{64}$'' OR NOT EXISTS(SELECT 1 FROM public.crm_settings WHERE id
 AND central_intake_enabled AND lead_work_enabled AND lead_lifecycle_enabled AND visits_enabled AND customer_voices_enabled) THEN RAISE EXCEPTION ''CRM_VOICE_TOKEN_UNAVAILABLE''; END IF;
 token_hash_value:=encode(sha256(convert_to(p_token,''UTF8'')),''hex'');
 SELECT t.expires_at INTO expiry FROM sales_private.visit_submission_tokens t JOIN public.lead_visits v ON v.id=t.visit_id
 JOIN customer_source_membership_private.interests i ON i.id=v.project_interest_id JOIN customer_source_membership_private.customers c ON c.id=i.customer_id
 JOIN sales_private.crm_user_roles r ON r.user_id=i.owner_user_id AND r.role=''sales'' AND r.is_active
 WHERE t.token_hash=token_hash_value AND t.consumed_at IS NULL AND t.revoked_at IS NULL AND t.expires_at>statement_timestamp()
 AND v.status=''awaiting_voice'' AND isfinite(v.checked_in_at) AND v.checked_in_at<=statement_timestamp()
 AND c.merged_into_customer_id IS NULL AND i.engagement_status<>''lost''
 AND (v.appointment_id IS NULL OR EXISTS(SELECT 1 FROM public.lead_appointments WHERE id=v.appointment_id AND project_interest_id=i.id AND status=''attended''));
 IF NOT FOUND THEN RAISE EXCEPTION ''CRM_VOICE_TOKEN_UNAVAILABLE''; END IF;
 RETURN jsonb_build_object(''formVersion'',''customer_voices_v1'',''expiresAt'',expiry);
END;
');
 INSERT INTO customer_source_membership_private.adapters(signature,before_md5,after_md5,settings) VALUES('public.crm_v2_customer_voice_open(text)','d63906090a34635ba83ab92707a48557','0000e5c4539b84d19bcf74dfead0d10e',ARRAY['search_path=pg_catalog','TimeZone=UTC']::text[]);
END; $membership_adapter_10$;
DO $membership_adapter_11$
DECLARE d text; b text; owner_name text; secured boolean; settings text[];
BEGIN
 SELECT pg_get_functiondef(oid),replace(prosrc,E'\r\n',E'\n'),pg_get_userbyid(proowner),prosecdef,proconfig INTO d,b,owner_name,secured,settings FROM pg_proc WHERE oid='public.crm_v2_customer_voice_submit(text,uuid,text,jsonb)'::regprocedure;
 d:=replace(d,E'\r\n',E'\n');
 IF md5(b) IS DISTINCT FROM 'c38c51e123385da76c19bda3ec3716c9' OR owner_name IS DISTINCT FROM current_user OR owner_name IS DISTINCT FROM 'postgres' OR secured IS DISTINCT FROM true OR settings IS DISTINCT FROM ARRAY['search_path=pg_catalog','TimeZone=UTC']::text[] THEN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_ADAPTER_REVIEW_REQUIRED'; END IF;
 IF (length(d)-length(replace(d,b,'')))/NULLIF(length(b),0)<>1 THEN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_DEFINITION_AMBIGUOUS'; END IF;
 EXECUTE replace(d,b,'
DECLARE enabled boolean; token_hint sales_private.visit_submission_tokens%ROWTYPE; t sales_private.visit_submission_tokens%ROWTYPE;
 c public.sales_customers%ROWTYPE; i public.lead_project_interests%ROWTYPE; v public.lead_visits%ROWTYPE; a public.lead_appointments%ROWTYPE;
 receipt sales_private.voice_submissions%ROWTYPE; answers_value jsonb; voice_id_value uuid; server_now timestamptz; owner_active boolean; token_hash_value text;
BEGIN
 SELECT central_intake_enabled AND lead_work_enabled AND lead_lifecycle_enabled AND visits_enabled AND customer_voices_enabled INTO enabled FROM public.crm_settings WHERE id FOR SHARE;
 IF enabled IS DISTINCT FROM true OR p_token IS NULL OR p_token !~ ''^[a-f0-9]{64}$'' THEN RAISE EXCEPTION ''CRM_VOICE_TOKEN_UNAVAILABLE''; END IF;
 token_hash_value:=encode(sha256(convert_to(p_token,''UTF8'')),''hex'');
 SELECT * INTO token_hint FROM sales_private.visit_submission_tokens WHERE token_hash=token_hash_value;
 IF NOT FOUND THEN RAISE EXCEPTION ''CRM_VOICE_TOKEN_UNAVAILABLE''; END IF;
 SELECT i0.customer_id,i0.id INTO c.id,i.id FROM public.lead_visits v0 JOIN customer_source_membership_private.interests i0 ON i0.id=v0.project_interest_id WHERE v0.id=token_hint.visit_id;
 SELECT * INTO c FROM customer_source_membership_private.customers WHERE id=c.id FOR UPDATE;
 SELECT * INTO i FROM customer_source_membership_private.interests WHERE id=i.id AND customer_id=c.id FOR UPDATE;
 SELECT role=''sales'' AND is_active INTO owner_active FROM sales_private.crm_user_roles WHERE user_id=i.owner_user_id FOR SHARE;
 SELECT appointment_id INTO a.id FROM public.lead_visits WHERE id=token_hint.visit_id;
 IF a.id IS NOT NULL THEN SELECT * INTO a FROM public.lead_appointments WHERE id=a.id FOR UPDATE; END IF;
 SELECT * INTO v FROM public.lead_visits WHERE id=token_hint.visit_id AND project_interest_id=i.id FOR UPDATE;
 SELECT * INTO t FROM sales_private.visit_submission_tokens WHERE id=token_hint.id FOR UPDATE;
 server_now:=clock_timestamp();
 IF c.id IS NULL OR i.id IS NULL OR v.id IS NULL OR t.id IS NULL OR c.merged_into_customer_id IS NOT NULL OR i.engagement_status=''lost''
  OR owner_active IS DISTINCT FROM true OR t.revoked_at IS NOT NULL OR v.status=''cancelled''
  OR NOT isfinite(v.checked_in_at) OR v.checked_in_at>server_now OR (a.id IS NOT NULL AND a.status<>''attended'') THEN RAISE EXCEPTION ''CRM_VOICE_TOKEN_UNAVAILABLE''; END IF;
 -- Retry acknowledgement contains no original answers or identifiers. Successful
 -- consumed-token retries remain retryable after expiry, but never reopen a form.
 IF t.consumed_at IS NULL AND (t.expires_at<=server_now OR v.status<>''awaiting_voice'') THEN RAISE EXCEPTION ''CRM_VOICE_TOKEN_UNAVAILABLE''; END IF;
 IF p_request_id IS NULL OR p_form_version IS DISTINCT FROM ''customer_voices_v1'' THEN RAISE EXCEPTION ''CRM_VOICE_INVALID_INPUT''; END IF;
 answers_value:=sales_private.crm_voice_answers(p_answers);
 SELECT * INTO receipt FROM sales_private.voice_submissions WHERE token_id=t.id;
 IF t.consumed_at IS NOT NULL THEN
  IF receipt.token_id IS NULL OR v.status<>''completed'' OR receipt.voice_id IS DISTINCT FROM v.completed_voice_id THEN RAISE EXCEPTION ''CRM_VOICE_TOKEN_UNAVAILABLE''; END IF;
  IF receipt.request_id IS DISTINCT FROM p_request_id OR receipt.form_version IS DISTINCT FROM p_form_version OR receipt.answers IS DISTINCT FROM answers_value THEN RAISE EXCEPTION ''CRM_VOICE_IDEMPOTENCY_CONFLICT''; END IF;
  RETURN jsonb_build_object(''submitted'',true,''replayed'',true);
 END IF;
 IF receipt.token_id IS NOT NULL OR EXISTS(SELECT 1 FROM public.customer_voices WHERE visit_id=v.id) THEN RAISE EXCEPTION ''CRM_VOICE_TOKEN_UNAVAILABLE''; END IF;
 voice_id_value:=gen_random_uuid();
 INSERT INTO sales_private.voice_write_permits VALUES(txid_current(),pg_backend_pid(),v.id,voice_id_value);
 -- Every optional legacy field is explicitly NULL when omitted, never silently
 -- DEFAULT false. CRM answers preserve the distinction between omitted and false.
 INSERT INTO public.customer_voices(id,lead_id,visit_id,survey_date,customer_name,nickname,age,gender,phone,line_id,project_name,agent_name,
 marital_status,education_level,occupation,monthly_income,family_members,previous_residence,monthly_rent,
 purpose_relocate,purpose_family_expansion,purpose_independence,purpose_rent_to_own,purpose_debt_consolidation,
 reason_price,reason_location,reason_promotion,reason_design,reason_house_type,reason_other,source_facebook,source_tiktok,source_youtube,source_billboard,source_other,
 score_knowledge,score_problem_solving,score_service_mind,score_appearance,score_cleanliness,score_house_design,score_price,score_location,score_average,
 created_at,updated_at,crm_answers,crm_form_version,crm_submission_state,crm_submitted_at,crm_validated_at,crm_submitted_by_customer)
 VALUES(voice_id_value,NULL,v.id,server_now,c.customer_name,answers_value->>''nickname'',answers_value->>''age'',answers_value->>''gender'',NULL,answers_value->>''line_id'',i.project_name,NULL,
 answers_value->>''marital_status'',NULL,answers_value->>''occupation'',answers_value->>''monthly_income'',answers_value->>''family_members'',answers_value->>''previous_residence'',(answers_value->>''monthly_rent'')::numeric,
 (answers_value->>''purpose_relocate'')::boolean,(answers_value->>''purpose_family_expansion'')::boolean,(answers_value->>''purpose_independence'')::boolean,(answers_value->>''purpose_rent_to_own'')::boolean,(answers_value->>''purpose_debt_consolidation'')::boolean,
 (answers_value->>''reason_price'')::boolean,(answers_value->>''reason_location'')::boolean,(answers_value->>''reason_promotion'')::boolean,(answers_value->>''reason_design'')::boolean,(answers_value->>''reason_house_type'')::boolean,answers_value->>''reason_other'',
 (answers_value->>''source_facebook'')::boolean,(answers_value->>''source_tiktok'')::boolean,(answers_value->>''source_youtube'')::boolean,(answers_value->>''source_billboard'')::boolean,answers_value->>''source_other'',
 (answers_value->>''score_knowledge'')::integer,(answers_value->>''score_problem_solving'')::integer,(answers_value->>''score_service_mind'')::integer,(answers_value->>''score_appearance'')::integer,
 (answers_value->>''score_cleanliness'')::integer,(answers_value->>''score_house_design'')::integer,(answers_value->>''score_price'')::integer,(answers_value->>''score_location'')::integer,NULL,
 server_now,server_now,answers_value,p_form_version,''submitted'',server_now,server_now,true);
 UPDATE public.lead_visits SET status=''completed'',completed_at=server_now,completed_voice_id=voice_id_value,completion_evidence_state=''submitted'',revision=gen_random_uuid() WHERE id=v.id;
 UPDATE sales_private.visit_submission_tokens SET consumed_at=server_now WHERE id=t.id;
 INSERT INTO sales_private.voice_submissions VALUES(t.id,p_request_id,p_form_version,answers_value,voice_id_value,server_now);
 INSERT INTO sales_private.voice_events(visit_id,token_id,command,actor_user_id,reason,recorded_at) VALUES(v.id,t.id,''submit'',NULL,''Customer submitted versioned questionnaire'',server_now);
 INSERT INTO public.crm_audit_events(customer_id,entity_type,entity_id,event_type,reason_text,actor_user_id,actor_kind,new_values,occurred_at,recorded_at)
 VALUES(c.id,''lead_visit'',v.id,''customer_voice_submitted'',''Customer submitted versioned questionnaire'',NULL,''customer'',
 jsonb_build_object(''interestId'',i.id,''voiceId'',voice_id_value,''formVersion'',p_form_version),server_now,server_now);
 DELETE FROM sales_private.voice_write_permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid();
 RETURN jsonb_build_object(''submitted'',true,''replayed'',false);
END;
');
 INSERT INTO customer_source_membership_private.adapters(signature,before_md5,after_md5,settings) VALUES('public.crm_v2_customer_voice_submit(text,uuid,text,jsonb)','c38c51e123385da76c19bda3ec3716c9','341c250a9bf9d0ca929dfb19a6c4907d',ARRAY['search_path=pg_catalog','TimeZone=UTC']::text[]);
END; $membership_adapter_11$;
DO $membership_adapter_12$
DECLARE d text; b text; owner_name text; secured boolean; settings text[];
BEGIN
 SELECT pg_get_functiondef(oid),replace(prosrc,E'\r\n',E'\n'),pg_get_userbyid(proowner),prosecdef,proconfig INTO d,b,owner_name,secured,settings FROM pg_proc WHERE oid='public.crm_v2_customer_voices_command(uuid,jsonb)'::regprocedure;
 d:=replace(d,E'\r\n',E'\n');
 IF md5(b) IS DISTINCT FROM '80855476d21cde3ee1f5381bd378d15e' OR owner_name IS DISTINCT FROM current_user OR owner_name IS DISTINCT FROM 'postgres' OR secured IS DISTINCT FROM true OR settings IS DISTINCT FROM ARRAY['search_path=pg_catalog','TimeZone=UTC']::text[] THEN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_ADAPTER_REVIEW_REQUIRED'; END IF;
 IF (length(d)-length(replace(d,b,'')))/NULLIF(length(b),0)<>1 THEN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_DEFINITION_AMBIGUOUS'; END IF;
 EXECUTE replace(d,b,'
DECLARE actor_id uuid:=auth.uid(); actor_role text:=public.crm_v2_role(); actor_name text; owner_active boolean:=false; enabled boolean; ttl integer;
 c public.sales_customers%ROWTYPE; i public.lead_project_interests%ROWTYPE; v public.lead_visits%ROWTYPE; a public.lead_appointments%ROWTYPE;
 role_row sales_private.crm_user_roles%ROWTYPE; t sales_private.visit_submission_tokens%ROWTYPE; receipt sales_private.voice_staff_requests%ROWTYPE;
 customer_id_value uuid; interest_id_value uuid; visit_id_value uuid; expected_interest uuid; expected_visit uuid; expected_token uuid;
 reason_value text; command_name text; hash_value text; response_value jsonb; server_now timestamptz;
BEGIN
 PERFORM customer_source_membership_private.assert_payload(p_payload);
 IF actor_id IS NULL OR COALESCE(actor_role,'''') NOT IN (''sales'',''admin'') THEN RAISE EXCEPTION ''CRM_VOICE_FORBIDDEN''; END IF;
 SELECT central_intake_enabled AND lead_work_enabled AND lead_lifecycle_enabled AND visits_enabled AND customer_voices_enabled,voice_token_ttl_hours INTO enabled,ttl FROM public.crm_settings WHERE id FOR SHARE;
 IF enabled IS DISTINCT FROM true THEN RAISE EXCEPTION ''CRM_VOICE_SETUP_REQUIRED''; END IF;
 IF p_request_id IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM ''object'' OR octet_length(p_payload::text)>16384 THEN RAISE EXCEPTION ''CRM_VOICE_INVALID_INPUT''; END IF;
 IF NOT(p_payload ?& ARRAY[''command'',''customerId'',''interestId'',''visitId'',''expectedInterestRevision'',''expectedVisitRevision'',''expectedTokenId'',''tokenHash'',''reason''])
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN (''command'',''customerId'',''interestId'',''visitId'',''expectedInterestRevision'',''expectedVisitRevision'',''expectedTokenId'',''tokenHash'',''reason''))
 OR jsonb_typeof(p_payload->''command'') IS DISTINCT FROM ''string'' OR p_payload->>''command'' NOT IN (''issue'',''revoke'') OR jsonb_typeof(p_payload->''reason'') IS DISTINCT FROM ''string''
 OR jsonb_typeof(p_payload->''tokenHash'') NOT IN (''string'',''null'') THEN RAISE EXCEPTION ''CRM_VOICE_INVALID_INPUT''; END IF;
 command_name:=p_payload->>''command''; hash_value:=p_payload->>''tokenHash'';
 IF (command_name=''issue'' AND (hash_value IS NULL OR hash_value !~ ''^[a-f0-9]{64}$'')) OR (command_name=''revoke'' AND hash_value IS NOT NULL) THEN RAISE EXCEPTION ''CRM_VOICE_INVALID_INPUT''; END IF;
 BEGIN
  customer_id_value:=sales_private.crm_visits_uuid(p_payload->''customerId''); interest_id_value:=sales_private.crm_visits_uuid(p_payload->''interestId'');
  visit_id_value:=sales_private.crm_visits_uuid(p_payload->''visitId''); expected_interest:=sales_private.crm_visits_uuid(p_payload->''expectedInterestRevision'');
  expected_visit:=sales_private.crm_visits_uuid(p_payload->''expectedVisitRevision''); expected_token:=sales_private.crm_visits_uuid(p_payload->''expectedTokenId'',true);
  reason_value:=sales_private.crm_work_text(p_payload->>''reason'',1000);
 EXCEPTION WHEN raise_exception THEN RAISE EXCEPTION ''CRM_VOICE_INVALID_INPUT''; END;
 IF command_name=''revoke'' AND expected_token IS NULL THEN RAISE EXCEPTION ''CRM_VOICE_INVALID_INPUT''; END IF;
 p_payload:=p_payload||jsonb_build_object(''reason'',reason_value);
 PERFORM pg_advisory_xact_lock(hashtextextended(''customer-voices:''||actor_id::text||'':''||p_request_id::text,0));
 SELECT * INTO c FROM customer_source_membership_private.customers WHERE id=customer_id_value FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION ''CRM_VOICE_NOT_FOUND''; END IF;
 SELECT * INTO i FROM customer_source_membership_private.interests WHERE id=interest_id_value AND customer_id=c.id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION ''CRM_VOICE_NOT_FOUND''; END IF;
 actor_role:=NULL;
 FOR role_row IN SELECT * FROM sales_private.crm_user_roles WHERE user_id IN(actor_id,i.owner_user_id) ORDER BY user_id FOR SHARE LOOP
  IF role_row.user_id=actor_id AND role_row.is_active THEN actor_role:=role_row.role; actor_name:=role_row.display_name; END IF;
  IF role_row.user_id=i.owner_user_id THEN owner_active:=role_row.is_active AND role_row.role=''sales''; END IF;
 END LOOP;
 IF COALESCE(actor_role,'''') NOT IN (''sales'',''admin'') OR (actor_role=''sales'' AND actor_id<>i.owner_user_id) OR NOT owner_active THEN RAISE EXCEPTION ''CRM_VOICE_FORBIDDEN''; END IF;
 SELECT * INTO receipt FROM sales_private.voice_staff_requests WHERE actor_user_id=actor_id AND request_id=p_request_id;
 IF FOUND THEN
  IF receipt.request_payload IS DISTINCT FROM p_payload THEN RAISE EXCEPTION ''CRM_VOICE_IDEMPOTENCY_CONFLICT''; END IF;
  RETURN receipt.response||jsonb_build_object(''replayed'',true);
 END IF;
 IF c.merged_into_customer_id IS NOT NULL OR i.engagement_status=''lost'' THEN RAISE EXCEPTION ''CRM_VOICE_SCOPE_CLOSED''; END IF;
 IF i.lifecycle_revision IS DISTINCT FROM expected_interest THEN RAISE EXCEPTION ''CRM_VOICE_STALE_STATE''; END IF;
 SELECT appointment_id INTO a.id FROM public.lead_visits WHERE id=visit_id_value AND project_interest_id=i.id;
 IF NOT FOUND THEN RAISE EXCEPTION ''CRM_VOICE_NOT_FOUND''; END IF;
 IF a.id IS NOT NULL THEN SELECT * INTO a FROM public.lead_appointments WHERE id=a.id FOR UPDATE; END IF;
 SELECT * INTO v FROM public.lead_visits WHERE id=visit_id_value AND project_interest_id=i.id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION ''CRM_VOICE_NOT_FOUND''; END IF;
 IF v.revision IS DISTINCT FROM expected_visit THEN RAISE EXCEPTION ''CRM_VOICE_STALE_STATE''; END IF;
 IF v.status<>''awaiting_voice'' OR (a.id IS NOT NULL AND a.status<>''attended'') THEN RAISE EXCEPTION ''CRM_VOICE_SCOPE_CLOSED''; END IF;
 SELECT * INTO t FROM sales_private.visit_submission_tokens WHERE visit_id=v.id AND consumed_at IS NULL AND revoked_at IS NULL FOR UPDATE;
 server_now:=clock_timestamp();
 -- Expired tokens are not active in the read contract, but are revoked on rotation.
 IF expected_token IS DISTINCT FROM (CASE WHEN t.expires_at>server_now THEN t.id ELSE NULL END) THEN RAISE EXCEPTION ''CRM_VOICE_STALE_STATE''; END IF;
 IF command_name=''revoke'' AND t.id IS NULL THEN RAISE EXCEPTION ''CRM_VOICE_STALE_STATE''; END IF;
 IF EXISTS(SELECT 1 FROM public.customer_voices WHERE visit_id=v.id) THEN RAISE EXCEPTION ''CRM_VOICE_SCOPE_CLOSED''; END IF;
 INSERT INTO sales_private.voice_write_permits VALUES(txid_current(),pg_backend_pid(),v.id,NULL);
 IF t.id IS NOT NULL THEN UPDATE sales_private.visit_submission_tokens SET revoked_at=server_now WHERE id=t.id; END IF;
 IF command_name=''issue'' THEN
  BEGIN INSERT INTO sales_private.visit_submission_tokens(visit_id,token_hash,expires_at,created_at)
   VALUES(v.id,hash_value,server_now+make_interval(hours=>ttl),server_now) RETURNING * INTO t;
  EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION ''CRM_VOICE_IDEMPOTENCY_CONFLICT''; END;
 END IF;
 INSERT INTO sales_private.voice_events(visit_id,token_id,command,actor_user_id,reason,recorded_at) VALUES(v.id,t.id,command_name,actor_id,reason_value,server_now);
 INSERT INTO public.crm_audit_events(customer_id,entity_type,entity_id,event_type,reason_text,actor_user_id,actor_kind,actor_name_snapshot,new_values,occurred_at,recorded_at)
 VALUES(c.id,''lead_visit'',v.id,''customer_voice_''||command_name,reason_value,actor_id,''staff'',actor_name,jsonb_build_object(''interestId'',i.id,''tokenId'',t.id),server_now,server_now);
 response_value:=jsonb_build_object(''requestId'',p_request_id,''command'',command_name,''visitId'',v.id,''tokenId'',t.id,''expiresAt'',t.expires_at,''replayed'',false);
 INSERT INTO sales_private.voice_staff_requests VALUES(actor_id,p_request_id,p_payload,response_value,server_now);
 DELETE FROM sales_private.voice_write_permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid();
 RETURN response_value;
END;
');
 INSERT INTO customer_source_membership_private.adapters(signature,before_md5,after_md5,settings) VALUES('public.crm_v2_customer_voices_command(uuid,jsonb)','80855476d21cde3ee1f5381bd378d15e','6f75e1027f2e62e1af6044215792dada',ARRAY['search_path=pg_catalog','TimeZone=UTC']::text[]);
END; $membership_adapter_12$;
DO $membership_adapter_13$
DECLARE d text; b text; owner_name text; secured boolean; settings text[];
BEGIN
 SELECT pg_get_functiondef(oid),replace(prosrc,E'\r\n',E'\n'),pg_get_userbyid(proowner),prosecdef,proconfig INTO d,b,owner_name,secured,settings FROM pg_proc WHERE oid='public.crm_v2_customer_voices_context(uuid,uuid,uuid)'::regprocedure;
 d:=replace(d,E'\r\n',E'\n');
 IF md5(b) IS DISTINCT FROM '992f782c69a364e2a41f5b327c0f109f' OR owner_name IS DISTINCT FROM current_user OR owner_name IS DISTINCT FROM 'postgres' OR secured IS DISTINCT FROM true OR settings IS DISTINCT FROM ARRAY['search_path=pg_catalog','TimeZone=UTC']::text[] THEN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_ADAPTER_REVIEW_REQUIRED'; END IF;
 IF (length(d)-length(replace(d,b,'')))/NULLIF(length(b),0)<>1 THEN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_DEFINITION_AMBIGUOUS'; END IF;
 EXECUTE replace(d,b,'
DECLARE actor_id uuid:=auth.uid(); actor_role text:=public.crm_v2_role(); c public.sales_customers%ROWTYPE; i public.lead_project_interests%ROWTYPE;
 v public.lead_visits%ROWTYPE; t sales_private.visit_submission_tokens%ROWTYPE; voice public.customer_voices%ROWTYPE; ttl integer;
BEGIN
 IF actor_id IS NULL OR COALESCE(actor_role,'''') NOT IN (''sales'',''admin'',''owner'') THEN RAISE EXCEPTION ''CRM_VOICE_FORBIDDEN''; END IF;
 IF (public.crm_v2_customer_voices_capabilities()->>''enabled'')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION ''CRM_VOICE_SETUP_REQUIRED''; END IF;
 IF p_customer_id IS NULL OR p_interest_id IS NULL OR p_visit_id IS NULL THEN RAISE EXCEPTION ''CRM_VOICE_INVALID_INPUT''; END IF;
 SELECT * INTO c FROM customer_source_membership_private.customers WHERE id=p_customer_id;
 IF NOT FOUND THEN RAISE EXCEPTION ''CRM_VOICE_NOT_FOUND''; END IF;
 SELECT * INTO i FROM customer_source_membership_private.interests WHERE id=p_interest_id AND customer_id=c.id;
 IF NOT FOUND THEN RAISE EXCEPTION ''CRM_VOICE_NOT_FOUND''; END IF;
 SELECT * INTO v FROM public.lead_visits WHERE id=p_visit_id AND project_interest_id=i.id;
 IF NOT FOUND THEN RAISE EXCEPTION ''CRM_VOICE_NOT_FOUND''; END IF;
 SELECT * INTO voice FROM public.customer_voices WHERE visit_id=v.id;
 IF (v.status=''completed'')<>(voice.id IS NOT NULL) OR (voice.id IS NOT NULL AND (voice.id IS DISTINCT FROM v.completed_voice_id OR voice.crm_submission_state<>''submitted'')) THEN RAISE EXCEPTION ''CRM_VOICE_SETUP_REQUIRED''; END IF;
 SELECT * INTO t FROM sales_private.visit_submission_tokens WHERE visit_id=v.id AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>statement_timestamp();
 SELECT voice_token_ttl_hours INTO ttl FROM public.crm_settings WHERE id;
 RETURN jsonb_build_object(''actor'',jsonb_build_object(''userId'',actor_id,''role'',actor_role),
 ''scope'',jsonb_build_object(''customerId'',c.id,''customerName'',c.customer_name,''interestId'',i.id,''visitId'',v.id,''projectName'',i.project_name,
 ''interestRevision'',i.lifecycle_revision,''ownerUserId'',i.owner_user_id,''canManage'',v.status=''awaiting_voice'' AND c.merged_into_customer_id IS NULL AND i.engagement_status<>''lost''
   AND (actor_role=''admin'' OR (actor_role=''sales'' AND actor_id=i.owner_user_id)) AND EXISTS(SELECT 1 FROM sales_private.crm_user_roles WHERE user_id=i.owner_user_id AND role=''sales'' AND is_active)),
 ''visit'',jsonb_build_object(''revision'',v.revision,''status'',v.status,''checkedInAt'',v.checked_in_at,''completedAt'',v.completed_at),
 ''activeToken'',CASE WHEN t.id IS NOT NULL AND v.status=''awaiting_voice'' AND c.merged_into_customer_id IS NULL AND i.engagement_status<>''lost'' THEN jsonb_build_object(''id'',t.id,''expiresAt'',t.expires_at) ELSE NULL END,
 ''submission'',CASE WHEN voice.id IS NOT NULL THEN jsonb_build_object(''submittedAt'',voice.crm_submitted_at,''answers'',CASE WHEN actor_role IN (''admin'',''owner'') OR actor_id=i.owner_user_id THEN voice.crm_answers ELSE NULL END) ELSE NULL END,''ttlHours'',ttl);
END;
');
 INSERT INTO customer_source_membership_private.adapters(signature,before_md5,after_md5,settings) VALUES('public.crm_v2_customer_voices_context(uuid,uuid,uuid)','992f782c69a364e2a41f5b327c0f109f','c51ea5cb5a39e5d37bc9de2204884069',ARRAY['search_path=pg_catalog','TimeZone=UTC']::text[]);
END; $membership_adapter_13$;
DO $membership_adapter_14$
DECLARE d text; b text; owner_name text; secured boolean; settings text[];
BEGIN
 SELECT pg_get_functiondef(oid),replace(prosrc,E'\r\n',E'\n'),pg_get_userbyid(proowner),prosecdef,proconfig INTO d,b,owner_name,secured,settings FROM pg_proc WHERE oid='public.crm_v2_lead_lifecycle_context(uuid,uuid)'::regprocedure;
 d:=replace(d,E'\r\n',E'\n');
 IF md5(b) IS DISTINCT FROM '7fdc46b6edffbb2051912b498f61a38b' OR owner_name IS DISTINCT FROM current_user OR owner_name IS DISTINCT FROM 'postgres' OR secured IS DISTINCT FROM true OR settings IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] THEN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_ADAPTER_REVIEW_REQUIRED'; END IF;
 IF (length(d)-length(replace(d,b,'')))/NULLIF(length(b),0)<>1 THEN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_DEFINITION_AMBIGUOUS'; END IF;
 EXECUTE replace(d,b,'
DECLARE
  actor_id uuid:=auth.uid(); actor_role text:=public.crm_v2_role();
  work_json jsonb; candidates_json jsonb:=''[]''::jsonb; candidates_more boolean:=false;
  source_lead_id uuid; scope_owner uuid; closed boolean;
  has_bookings boolean; has_open_interests boolean:=false;
  open_tasks bigint; pending_notices bigint;
BEGIN
  IF actor_id IS NULL OR actor_role IS NULL OR actor_role NOT IN (''sales'',''admin'',''owner'') THEN
    RAISE EXCEPTION ''CRM_LIFECYCLE_FORBIDDEN'';
  END IF;
  IF NOT COALESCE((SELECT central_intake_enabled AND lead_work_enabled AND lead_lifecycle_enabled
    FROM public.crm_settings WHERE id),false) THEN RAISE EXCEPTION ''CRM_LIFECYCLE_SETUP_REQUIRED''; END IF;
  IF p_customer_id IS NULL THEN RAISE EXCEPTION ''CRM_LIFECYCLE_INVALID_INPUT''; END IF;
  -- The shared read-v2 projection validates the customer/interest relationship.
  work_json:=public.crm_v2_lead_work_snapshot(p_customer_id,p_interest_id);
  scope_owner:=(work_json#>>''{owner,userId}'')::uuid;
  closed:=(work_json->>''scopeClosed'')::boolean;
  SELECT legacy_source_lead_id INTO source_lead_id FROM customer_source_membership_private.customers WHERE id=p_customer_id;
  has_bookings:=EXISTS (SELECT 1 FROM customer_source_membership_private.sales s
    JOIN customer_source_membership_private.interests i ON i.id=s.project_interest_id
    WHERE i.customer_id=p_customer_id AND (p_interest_id IS NULL OR i.id=p_interest_id))
    OR EXISTS (SELECT 1 FROM customer_source_membership_private.sales s WHERE s.lead_id=source_lead_id AND s.project_interest_id IS NULL);
  IF p_interest_id IS NULL THEN
    has_open_interests:=EXISTS (SELECT 1 FROM customer_source_membership_private.interests
      WHERE customer_id=p_customer_id AND engagement_status<>''lost'');
  END IF;
  IF actor_role=''admin'' THEN
    WITH recent AS (
      SELECT user_id,display_name FROM sales_private.crm_user_roles
        WHERE role=''sales'' AND is_active ORDER BY user_id LIMIT 201
    ), numbered AS (
      SELECT r.*,row_number() OVER (ORDER BY user_id) AS rn FROM recent r
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(''userId'',n.user_id,''displayName'',n.display_name)
      ORDER BY n.user_id) FILTER (WHERE n.rn<=200),''[]''::jsonb),count(*)>200
      INTO candidates_json,candidates_more FROM numbered n;
  END IF;
  SELECT count(*) INTO open_tasks FROM public.crm_sla_tasks t
    WHERE t.customer_id=p_customer_id AND t.project_interest_id IS NOT DISTINCT FROM p_interest_id AND t.status=''open'';
  SELECT count(*) INTO pending_notices FROM public.crm_notifications n
    JOIN public.crm_sla_tasks t ON t.id=n.task_id
    WHERE t.customer_id=p_customer_id AND t.project_interest_id IS NOT DISTINCT FROM p_interest_id
      AND t.status=''open'' AND n.withdrawn_at IS NULL;
  RETURN jsonb_build_object(''work'',work_json,''candidates'',candidates_json,''candidatesTruncated'',candidates_more,
    ''canReassign'',NOT closed AND actor_role=''admin'',
    ''canClose'',NOT closed AND (actor_role=''admin'' OR (actor_role=''sales'' AND actor_id=scope_owner))
      AND NOT has_bookings AND NOT has_open_interests,
    ''blockers'',jsonb_build_object(''hasBookingHistory'',has_bookings,''hasOpenInterests'',has_open_interests),
    ''impact'',jsonb_build_object(''openSlaCount'',open_tasks,''pendingNotificationCount'',pending_notices));
END;
');
 INSERT INTO customer_source_membership_private.adapters(signature,before_md5,after_md5,settings) VALUES('public.crm_v2_lead_lifecycle_context(uuid,uuid)','7fdc46b6edffbb2051912b498f61a38b','46cfde45be3b1dd05720b064b0146a82',ARRAY['search_path=pg_catalog']::text[]);
END; $membership_adapter_14$;
DO $membership_adapter_15$
DECLARE d text; b text; owner_name text; secured boolean; settings text[];
BEGIN
 SELECT pg_get_functiondef(oid),replace(prosrc,E'\r\n',E'\n'),pg_get_userbyid(proowner),prosecdef,proconfig INTO d,b,owner_name,secured,settings FROM pg_proc WHERE oid='public.crm_v2_lead_work_snapshot(uuid,uuid)'::regprocedure;
 d:=replace(d,E'\r\n',E'\n');
 IF md5(b) IS DISTINCT FROM 'e653d1323ebbb3e767a630d7319a930d' OR owner_name IS DISTINCT FROM current_user OR owner_name IS DISTINCT FROM 'postgres' OR secured IS DISTINCT FROM true OR settings IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] THEN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_ADAPTER_REVIEW_REQUIRED'; END IF;
 IF (length(d)-length(replace(d,b,'')))/NULLIF(length(b),0)<>1 THEN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_DEFINITION_AMBIGUOUS'; END IF;
 EXECUTE replace(d,b,'
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
  IF actor_id IS NULL OR actor_role IS NULL OR actor_role NOT IN (''sales'',''admin'',''owner'') THEN
    RAISE EXCEPTION ''CRM_WORK_FORBIDDEN'';
  END IF;
  IF NOT COALESCE((SELECT central_intake_enabled AND lead_work_enabled
    FROM public.crm_settings WHERE id),false) THEN RAISE EXCEPTION ''CRM_WORK_SETUP_REQUIRED''; END IF;
  IF p_customer_id IS NULL THEN RAISE EXCEPTION ''CRM_WORK_INVALID_INPUT''; END IF;
  SELECT * INTO customer_row FROM customer_source_membership_private.customers WHERE id=p_customer_id;
  IF NOT FOUND THEN RAISE EXCEPTION ''CRM_WORK_NOT_FOUND''; END IF;
  scope_owner:=customer_row.owner_user_id;
  scope_revision:=customer_row.lifecycle_revision;
  scope_key_value:=''customer:''||p_customer_id::text;
  closed:=customer_row.merged_into_customer_id IS NOT NULL OR customer_row.intake_status=''lost'';
  IF p_interest_id IS NOT NULL THEN
    SELECT * INTO interest_row FROM customer_source_membership_private.interests
      WHERE id=p_interest_id AND customer_id=p_customer_id;
    IF NOT FOUND THEN RAISE EXCEPTION ''CRM_WORK_NOT_FOUND''; END IF;
    scope_owner:=interest_row.owner_user_id;
    scope_revision:=interest_row.lifecycle_revision;
    scope_key_value:=''interest:''||p_interest_id::text;
    closed:=customer_row.merged_into_customer_id IS NOT NULL OR interest_row.engagement_status=''lost'';
  END IF;
  SELECT display_name,(role=''sales'' AND is_active) INTO owner_name,owner_active
    FROM sales_private.crm_user_roles WHERE user_id=scope_owner;
  owner_active:=COALESCE(owner_active,false);
  SELECT * INTO current_row FROM public.crm_next_actions
    WHERE customer_id=p_customer_id AND scope_key=scope_key_value AND status=''open'';
  current_json:=CASE WHEN current_row.id IS NULL THEN NULL ELSE jsonb_build_object(
    ''id'',current_row.id,''customerId'',current_row.customer_id,''interestId'',current_row.project_interest_id,
    ''ownerUserId'',current_row.owner_user_id,''action'',current_row.action_text,''dueAt'',current_row.due_at,
    ''recordedAt'',current_row.recorded_at,''status'',current_row.status,
    ''closedAt'',current_row.closed_at,''closeReason'',current_row.close_reason) END;

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
    ''id'',a.id,''customerId'',a.customer_id,''interestId'',a.project_interest_id,
    ''ownerUserId'',a.owner_user_id,''action'',a.action_text,''dueAt'',a.due_at,
    ''recordedAt'',a.recorded_at,''status'',a.status,''closedAt'',a.closed_at,''closeReason'',a.close_reason
  ) ORDER BY a.recorded_at DESC,a.id DESC) FILTER (WHERE a.rn<=20),''[]''::jsonb),count(*)>20
    INTO actions_json,more_actions FROM numbered a;

  WITH recent AS (
    SELECT a.* FROM public.lead_activities a
      WHERE a.customer_id=p_customer_id AND a.crm_scope_key=scope_key_value
      ORDER BY a.recorded_at DESC,a.id DESC LIMIT 21
  ), numbered AS (
    SELECT r.*,row_number() OVER (ORDER BY r.recorded_at DESC,r.id DESC) AS rn FROM recent r
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    ''id'',a.id,''customerId'',a.customer_id,''interestId'',a.project_interest_id,
    ''activityType'',a.activity_type,''action'',a.action_text,''channel'',a.contact_channel,''result'',a.result,
    ''occurredAt'',a.occurred_at,''recordedAt'',a.recorded_at,
    ''performedByUserId'',a.performed_by_user_id,''recordedByUserId'',a.recorded_by_user_id,''note'',a.note
  ) ORDER BY a.recorded_at DESC,a.id DESC) FILTER (WHERE a.rn<=20),''[]''::jsonb),count(*)>20
    INTO activities_json,more_activities FROM numbered a;

  RETURN jsonb_build_object(
    ''actor'',jsonb_build_object(''userId'',actor_id,''role'',actor_role),
    ''scope'',jsonb_build_object(''customerId'',p_customer_id,''interestId'',p_interest_id),
    ''customer'',jsonb_build_object(''id'',customer_row.id,''name'',sales_private.crm_effective_customer_name(customer_row.id),
      ''phone'',sales_private.crm_effective_customer_phone(customer_row.id),''leadCreatedAt'',customer_row.lead_created_at),
    ''projectName'',interest_row.project_name,
    ''owner'',jsonb_build_object(''userId'',scope_owner,''displayName'',owner_name,''active'',owner_active),
    ''scopeClosed'',closed,
    ''lifecycleRevision'',scope_revision,
    ''canWrite'',NOT closed AND owner_active AND (actor_role=''admin'' OR (actor_role=''sales'' AND actor_id=scope_owner)),
    ''asOf'',statement_timestamp(),''currentAction'',current_json,''actions'',actions_json,''activities'',activities_json,
    ''history'',jsonb_build_object(''limit'',20,''actionsHasMore'',more_actions,''activitiesHasMore'',more_activities)
  );
END;
');
 INSERT INTO customer_source_membership_private.adapters(signature,before_md5,after_md5,settings) VALUES('public.crm_v2_lead_work_snapshot(uuid,uuid)','e653d1323ebbb3e767a630d7319a930d','bad54f9caef3a6aa65bc46d9aabb96ff',ARRAY['search_path=pg_catalog']::text[]);
END; $membership_adapter_15$;
DO $membership_adapter_16$
DECLARE d text; b text; owner_name text; secured boolean; settings text[];
BEGIN
 SELECT pg_get_functiondef(oid),replace(prosrc,E'\r\n',E'\n'),pg_get_userbyid(proowner),prosecdef,proconfig INTO d,b,owner_name,secured,settings FROM pg_proc WHERE oid='public.crm_v2_post_booking_command(uuid,jsonb)'::regprocedure;
 d:=replace(d,E'\r\n',E'\n');
 IF md5(b) IS DISTINCT FROM 'ab4942a68a5b04d4655896e05d398864' OR owner_name IS DISTINCT FROM current_user OR owner_name IS DISTINCT FROM 'postgres' OR secured IS DISTINCT FROM true OR settings IS DISTINCT FROM ARRAY['search_path=pg_catalog','TimeZone=UTC']::text[] THEN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_ADAPTER_REVIEW_REQUIRED'; END IF;
 IF (length(d)-length(replace(d,b,'')))/NULLIF(length(b),0)<>1 THEN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_DEFINITION_AMBIGUOUS'; END IF;
 EXECUTE replace(d,b,'
DECLARE
  actor_id uuid:=auth.uid(); actor_role text:=public.crm_v2_role(); actor_name text;
  command_name text; allowed_keys text[]; reason_value text; evidence_value text; bank_value text; next_stage text;
  customer_id_value uuid; sale_id_value uuid; expected_sale uuid; expected_interest uuid; loan_id_value uuid;
  occurred_value timestamptz; server_now timestamptz; latest_event_time timestamptz; enabled boolean;
  transfer_value date; handover_value date; imported_history jsonb; latest_loan_time timestamptz; plot_row public.plots%ROWTYPE;
  actor_active boolean:=false; owner_active boolean:=false; role_row sales_private.crm_user_roles%ROWTYPE;
  customer_row public.sales_customers%ROWTYPE; interest_row public.lead_project_interests%ROWTYPE; sale_row public.sales%ROWTYPE;
  latest_attempt public.loan_attempts%ROWTYPE; loan_row public.loan_attempts%ROWTYPE;
  request_row sales_private.post_booking_command_requests%ROWTYPE;
  amount_satang bigint; next_attempt integer; event_id_value uuid; response_value jsonb; old_sale jsonb; old_loan jsonb; next_revision uuid;
BEGIN
 PERFORM customer_source_membership_private.assert_payload(p_payload);
  IF actor_id IS NULL OR COALESCE(actor_role,'''') NOT IN (''sales'',''admin'') THEN RAISE EXCEPTION ''CRM_POST_BOOKING_FORBIDDEN''; END IF;
  SELECT central_intake_enabled AND lead_work_enabled AND lead_lifecycle_enabled AND booking_enabled AND booking_cutover_reviewed AND post_booking_enabled
    INTO enabled FROM public.crm_settings WHERE id FOR SHARE;
  IF enabled IS DISTINCT FROM true THEN RAISE EXCEPTION ''CRM_POST_BOOKING_SETUP_REQUIRED''; END IF;
  IF p_request_id IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM ''object'' OR octet_length(p_payload::text)>16384
    OR jsonb_typeof(p_payload->''command'') IS DISTINCT FROM ''string'' THEN RAISE EXCEPTION ''CRM_POST_BOOKING_INVALID_INPUT''; END IF;
  command_name:=p_payload->>''command'';
  allowed_keys:=ARRAY[''command'',''customerId'',''saleId'',''expectedSaleRevision'',''expectedInterestRevision'',''reason'']||
    CASE WHEN command_name=''confirm_transfer'' THEN ARRAY[''transferDate''] WHEN command_name=''confirm_handover'' THEN ARRAY[''handoverDate''] ELSE ARRAY[''evidenceNote'',''occurredAt'']||
    CASE command_name WHEN ''advance'' THEN ARRAY[''nextStage''] WHEN ''submit_loan'' THEN ARRAY[''bankName'']
      WHEN ''loan_result'' THEN ARRAY[''loanAttemptId'',''result'',''approvedAmountSatang''] ELSE NULL END END;
  IF command_name NOT IN (''advance'',''submit_loan'',''loan_result'',''confirm_transfer'',''confirm_handover'') OR NOT(p_payload ?& allowed_keys)
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE NOT(k=ANY(allowed_keys)))
    OR jsonb_typeof(p_payload->''reason'') IS DISTINCT FROM ''string''
    OR (command_name=''confirm_transfer'' AND jsonb_typeof(p_payload->''transferDate'') IS DISTINCT FROM ''string'')
    OR (command_name=''confirm_handover'' AND jsonb_typeof(p_payload->''handoverDate'') IS DISTINCT FROM ''string'')
    OR (command_name NOT IN (''confirm_transfer'',''confirm_handover'') AND (jsonb_typeof(p_payload->''evidenceNote'') IS DISTINCT FROM ''string''
      OR jsonb_typeof(p_payload->''occurredAt'') IS DISTINCT FROM ''string'')) THEN RAISE EXCEPTION ''CRM_POST_BOOKING_INVALID_INPUT''; END IF;
  BEGIN
    customer_id_value:=sales_private.crm_booking_uuid(p_payload->''customerId''); sale_id_value:=sales_private.crm_booking_uuid(p_payload->''saleId'');
    expected_sale:=sales_private.crm_booking_uuid(p_payload->''expectedSaleRevision''); expected_interest:=sales_private.crm_booking_uuid(p_payload->''expectedInterestRevision'');
    reason_value:=sales_private.crm_work_text(p_payload->>''reason'',1000);
    IF command_name NOT IN (''confirm_transfer'',''confirm_handover'') THEN
      evidence_value:=sales_private.crm_work_text(p_payload->>''evidenceNote'',1000);
      occurred_value:=sales_private.crm_work_timestamp(p_payload->>''occurredAt'');
    END IF;
  EXCEPTION WHEN raise_exception THEN RAISE EXCEPTION ''CRM_POST_BOOKING_INVALID_INPUT''; END;
  IF occurred_value<TIMESTAMPTZ ''0001-01-01 00:00:00+00'' OR occurred_value>=TIMESTAMPTZ ''10000-01-01 00:00:00+00'' THEN
    RAISE EXCEPTION ''CRM_POST_BOOKING_INVALID_INPUT'';
  END IF;
  IF command_name=''confirm_transfer'' THEN
    IF (p_payload->>''transferDate'') !~ ''^[0-9]{4}-[0-9]{2}-[0-9]{2}$'' THEN RAISE EXCEPTION ''CRM_POST_BOOKING_INVALID_INPUT''; END IF;
    BEGIN transfer_value:=(p_payload->>''transferDate'')::date;
    EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RAISE EXCEPTION ''CRM_POST_BOOKING_INVALID_INPUT''; END;
    IF NOT isfinite(transfer_value) OR transfer_value<DATE ''0001-01-01'' OR transfer_value>=DATE ''10000-01-01'' THEN
      RAISE EXCEPTION ''CRM_POST_BOOKING_INVALID_INPUT''; END IF;
    next_stage:=''transferred'';
  ELSIF command_name=''confirm_handover'' THEN
    IF (p_payload->>''handoverDate'') !~ ''^[0-9]{4}-[0-9]{2}-[0-9]{2}$'' THEN RAISE EXCEPTION ''CRM_POST_BOOKING_INVALID_INPUT''; END IF;
    BEGIN handover_value:=(p_payload->>''handoverDate'')::date;
    EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RAISE EXCEPTION ''CRM_POST_BOOKING_INVALID_INPUT''; END;
    IF NOT isfinite(handover_value) OR handover_value<DATE ''0001-01-01'' OR handover_value>=DATE ''10000-01-01'' THEN
      RAISE EXCEPTION ''CRM_POST_BOOKING_INVALID_INPUT''; END IF;
    next_stage:=''handover'';
  ELSIF command_name=''advance'' THEN
    IF jsonb_typeof(p_payload->''nextStage'') IS DISTINCT FROM ''string'' OR p_payload->>''nextStage'' NOT IN (''contracted'',''downpayment'',''document_prep'',''transfer_pending'') THEN
      RAISE EXCEPTION ''CRM_POST_BOOKING_INVALID_INPUT''; END IF;
    next_stage:=p_payload->>''nextStage'';
  ELSIF command_name=''submit_loan'' THEN
    IF jsonb_typeof(p_payload->''bankName'') IS DISTINCT FROM ''string'' THEN RAISE EXCEPTION ''CRM_POST_BOOKING_INVALID_INPUT''; END IF;
    BEGIN bank_value:=sales_private.crm_work_text(p_payload->>''bankName'',200);
    EXCEPTION WHEN raise_exception THEN RAISE EXCEPTION ''CRM_POST_BOOKING_INVALID_INPUT''; END;
    next_stage:=''loan_submitted'';
  ELSE
    BEGIN loan_id_value:=sales_private.crm_booking_uuid(p_payload->''loanAttemptId'');
    EXCEPTION WHEN raise_exception THEN RAISE EXCEPTION ''CRM_POST_BOOKING_INVALID_INPUT''; END;
    IF jsonb_typeof(p_payload->''result'') IS DISTINCT FROM ''string'' OR p_payload->>''result'' NOT IN (''approved'',''rejected'') THEN
      RAISE EXCEPTION ''CRM_POST_BOOKING_INVALID_INPUT''; END IF;
    IF p_payload->>''result''=''approved'' THEN
      IF jsonb_typeof(p_payload->''approvedAmountSatang'') IS DISTINCT FROM ''number'' OR (p_payload->>''approvedAmountSatang'') !~ ''^[0-9]{1,11}$'' THEN
        RAISE EXCEPTION ''CRM_POST_BOOKING_INVALID_INPUT''; END IF;
      amount_satang:=(p_payload->>''approvedAmountSatang'')::bigint;
      IF amount_satang<=0 THEN RAISE EXCEPTION ''CRM_POST_BOOKING_INVALID_INPUT''; END IF;
    ELSIF p_payload->''approvedAmountSatang''<>''null''::jsonb THEN RAISE EXCEPTION ''CRM_POST_BOOKING_INVALID_INPUT''; END IF;
    next_stage:=''loan_''||(p_payload->>''result'');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(''crm-booking-command'',0));
  SELECT * INTO request_row FROM sales_private.post_booking_command_requests WHERE actor_user_id=actor_id AND request_id=p_request_id;
  IF FOUND THEN customer_id_value:=(request_row.response->>''customerId'')::uuid; sale_id_value:=(request_row.response->>''saleId'')::uuid; END IF;
  SELECT * INTO customer_row FROM customer_source_membership_private.customers WHERE id=customer_id_value FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION ''CRM_POST_BOOKING_NOT_FOUND''; END IF;
  IF customer_row.merged_into_customer_id IS NOT NULL THEN RAISE EXCEPTION ''CRM_POST_BOOKING_CONFLICT''; END IF;
  SELECT i.* INTO interest_row FROM customer_source_membership_private.interests i JOIN customer_source_membership_private.sales s ON s.project_interest_id=i.id
    WHERE s.id=sale_id_value AND i.customer_id=customer_id_value FOR UPDATE OF i;
  IF NOT FOUND THEN RAISE EXCEPTION ''CRM_POST_BOOKING_NOT_FOUND''; END IF;
  FOR role_row IN SELECT * FROM sales_private.crm_user_roles WHERE user_id IN(actor_id,interest_row.owner_user_id) ORDER BY user_id FOR SHARE LOOP
    IF role_row.user_id=actor_id AND role_row.is_active THEN actor_role:=role_row.role; actor_name:=role_row.display_name; actor_active:=true; END IF;
    IF role_row.user_id=interest_row.owner_user_id THEN owner_active:=role_row.role=''sales'' AND role_row.is_active; END IF;
  END LOOP;
  IF NOT actor_active OR NOT owner_active OR actor_role NOT IN (''sales'',''admin'') OR (actor_role=''sales'' AND actor_id<>interest_row.owner_user_id) THEN
    RAISE EXCEPTION ''CRM_POST_BOOKING_FORBIDDEN''; END IF;
  SELECT * INTO sale_row FROM customer_source_membership_private.sales WHERE id=sale_id_value AND project_interest_id=interest_row.id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION ''CRM_POST_BOOKING_NOT_FOUND''; END IF;
  IF request_row.request_id IS NOT NULL THEN
    IF request_row.request_payload IS DISTINCT FROM p_payload THEN RAISE EXCEPTION ''CRM_POST_BOOKING_IDEMPOTENCY_CONFLICT''; END IF;
    RETURN request_row.response||jsonb_build_object(''replayed'',true);
  END IF;
  IF sale_row.booking_revision IS DISTINCT FROM expected_sale OR interest_row.lifecycle_revision IS DISTINCT FROM expected_interest THEN
    RAISE EXCEPTION ''CRM_POST_BOOKING_STALE_STATE''; END IF;
  IF sale_row.crm_stage IN (''cancelled'',''handover'') OR (sale_row.crm_stage=''transferred'' AND command_name<>''confirm_handover'') OR (sale_row.crm_stage=''transfer_pending'' AND command_name<>''confirm_transfer'') THEN
    RAISE EXCEPTION ''CRM_POST_BOOKING_CONFLICT''; END IF;
  imported_history:=sales_private.crm_booking_imported_history(to_jsonb(sale_row));
  IF (sale_row.payment_method IS NULL AND command_name<>''confirm_handover'') OR sale_row.crm_stage IS NULL OR (sale_row.booking_round IS NULL AND imported_history IS NULL)
    OR NOT EXISTS(SELECT 1 FROM public.plots WHERE id=sale_row.plot_id AND project_name=interest_row.project_name)
    OR EXISTS(SELECT 1 FROM customer_source_membership_private.sales WHERE lead_id=customer_row.legacy_source_lead_id AND project_interest_id IS NULL) THEN
    RAISE EXCEPTION ''CRM_POST_BOOKING_SETUP_REQUIRED''; END IF;
  server_now:=clock_timestamp();
  IF occurred_value>server_now THEN RAISE EXCEPTION ''CRM_POST_BOOKING_INVALID_INPUT''; END IF;
  SELECT * INTO latest_attempt FROM public.loan_attempts WHERE sale_id=sale_row.id AND kind=''purchase''
    ORDER BY attempt_number DESC,id LIMIT 1 FOR UPDATE;
  SELECT max(occurred_at) INTO latest_event_time FROM sales_private.post_booking_events WHERE sale_id=sale_row.id;
  IF (sale_row.booked_at IS NOT NULL AND NOT isfinite(sale_row.booked_at)) OR (sale_row.contracted_at IS NOT NULL AND NOT isfinite(sale_row.contracted_at))
    OR (sale_row.transferred_at IS NOT NULL AND NOT isfinite(sale_row.transferred_at))
    OR (latest_attempt.submitted_at IS NOT NULL AND NOT isfinite(latest_attempt.submitted_at))
    OR (latest_attempt.result_at IS NOT NULL AND NOT isfinite(latest_attempt.result_at)) THEN RAISE EXCEPTION ''CRM_POST_BOOKING_SETUP_REQUIRED''; END IF;
  IF occurred_value<sale_row.booked_at OR occurred_value<sale_row.contracted_at OR occurred_value<latest_event_time
    OR occurred_value<latest_attempt.submitted_at OR occurred_value<latest_attempt.result_at THEN RAISE EXCEPTION ''CRM_POST_BOOKING_INVALID_INPUT''; END IF;
  IF occurred_value IS NOT NULL AND (occurred_value AT TIME ZONE ''Asia/Bangkok'')::date<(imported_history->>''bookedDate'')::date THEN
    RAISE EXCEPTION ''CRM_POST_BOOKING_INVALID_INPUT''; END IF;
  old_sale:=to_jsonb(sale_row); old_loan:=NULL;
  IF command_name=''confirm_handover'' THEN
    IF sale_row.crm_stage<>''transferred'' OR sale_row.crm_handover_date IS NOT NULL THEN RAISE EXCEPTION ''CRM_POST_BOOKING_CONFLICT''; END IF;
    SELECT * INTO plot_row FROM public.plots WHERE id=sale_row.plot_id FOR UPDATE;
    IF NOT FOUND OR plot_row.project_name IS DISTINCT FROM interest_row.project_name OR plot_row.has_customer IS DISTINCT FROM true THEN
      RAISE EXCEPTION ''CRM_POST_BOOKING_SETUP_REQUIRED''; END IF;
    SELECT max(GREATEST(submitted_at,result_at)) INTO latest_loan_time FROM public.loan_attempts WHERE sale_id=sale_row.id AND kind=''purchase'';
    IF handover_value>(server_now AT TIME ZONE ''Asia/Bangkok'')::date OR handover_value<sale_row.crm_transfer_date
      OR handover_value<(imported_history->>''bookedDate'')::date OR handover_value<(imported_history->>''transferredDate'')::date
      OR handover_value<(sale_row.transferred_at AT TIME ZONE ''Asia/Bangkok'')::date
      OR handover_value<(sale_row.booked_at AT TIME ZONE ''Asia/Bangkok'')::date OR handover_value<(sale_row.contracted_at AT TIME ZONE ''Asia/Bangkok'')::date
      OR handover_value<(latest_event_time AT TIME ZONE ''Asia/Bangkok'')::date OR handover_value<(latest_loan_time AT TIME ZONE ''Asia/Bangkok'')::date THEN
      RAISE EXCEPTION ''CRM_POST_BOOKING_INVALID_INPUT''; END IF;
  ELSIF command_name=''confirm_transfer'' THEN
    IF sale_row.crm_stage<>''transfer_pending'' OR sale_row.crm_transfer_date IS NOT NULL THEN RAISE EXCEPTION ''CRM_POST_BOOKING_CONFLICT''; END IF;
    SELECT * INTO plot_row FROM public.plots WHERE id=sale_row.plot_id FOR UPDATE;
    IF NOT FOUND OR plot_row.project_name IS DISTINCT FROM interest_row.project_name OR plot_row.has_customer IS DISTINCT FROM true THEN
      RAISE EXCEPTION ''CRM_POST_BOOKING_SETUP_REQUIRED''; END IF;
    IF sale_row.payment_method=''cash'' AND latest_attempt.id IS NOT NULL THEN RAISE EXCEPTION ''CRM_POST_BOOKING_SETUP_REQUIRED''; END IF;
    IF sale_row.payment_method=''mortgage'' AND (latest_attempt.id IS NULL
      OR latest_attempt.project_interest_id<>interest_row.id OR latest_attempt.result_status<>''approved''
      OR latest_attempt.submitted_at IS NULL OR latest_attempt.result_at IS NULL OR latest_attempt.result_at<latest_attempt.submitted_at
      OR latest_attempt.approved_amount IS NULL OR latest_attempt.approved_amount<=0
      OR latest_attempt.approved_amount::text IN (''NaN'',''Infinity'',''-Infinity'')
      OR EXISTS(SELECT 1 FROM public.loan_attempts WHERE sale_id=sale_row.id AND kind=''purchase'' AND result_status IN (''submitted'',''pending''))) THEN
      RAISE EXCEPTION ''CRM_POST_BOOKING_SETUP_REQUIRED''; END IF;
    IF EXISTS(SELECT 1 FROM public.loan_attempts WHERE sale_id=sale_row.id AND kind=''purchase''
      AND ((submitted_at IS NOT NULL AND NOT isfinite(submitted_at)) OR (result_at IS NOT NULL AND NOT isfinite(result_at)))) THEN
      RAISE EXCEPTION ''CRM_POST_BOOKING_SETUP_REQUIRED''; END IF;
    SELECT max(GREATEST(submitted_at,result_at)) INTO latest_loan_time FROM public.loan_attempts WHERE sale_id=sale_row.id AND kind=''purchase'';
    IF transfer_value<(imported_history->>''bookedDate'')::date OR transfer_value>(server_now AT TIME ZONE ''Asia/Bangkok'')::date
      OR transfer_value<(sale_row.booked_at AT TIME ZONE ''Asia/Bangkok'')::date
      OR transfer_value<(sale_row.contracted_at AT TIME ZONE ''Asia/Bangkok'')::date
      OR transfer_value<(latest_event_time AT TIME ZONE ''Asia/Bangkok'')::date
      OR transfer_value<(latest_loan_time AT TIME ZONE ''Asia/Bangkok'')::date THEN RAISE EXCEPTION ''CRM_POST_BOOKING_INVALID_INPUT''; END IF;
  ELSIF command_name=''advance'' THEN
    IF NOT ((sale_row.crm_stage=''booked'' AND next_stage=''contracted'')
      OR (sale_row.crm_stage=''contracted'' AND next_stage IN (''downpayment'',''document_prep''))
      OR (sale_row.crm_stage=''downpayment'' AND next_stage=''document_prep'')
      OR (sale_row.payment_method=''mortgage'' AND sale_row.crm_stage=''loan_rejected'' AND next_stage=''document_prep'')
      OR (next_stage=''transfer_pending'' AND ((sale_row.payment_method=''cash'' AND sale_row.crm_stage IN (''contracted'',''downpayment'',''document_prep''))
        OR (sale_row.payment_method=''mortgage'' AND sale_row.crm_stage=''loan_approved'')))) THEN RAISE EXCEPTION ''CRM_POST_BOOKING_CONFLICT''; END IF;
    IF next_stage=''contracted'' AND sale_row.contracted_at IS NOT NULL THEN RAISE EXCEPTION ''CRM_POST_BOOKING_SETUP_REQUIRED''; END IF;
    IF sale_row.crm_stage=''loan_rejected'' AND (latest_attempt.id IS NULL OR latest_attempt.result_status<>''rejected''
      OR latest_attempt.result_at IS NULL OR latest_attempt.submitted_at IS NULL OR latest_attempt.result_at<latest_attempt.submitted_at
      OR latest_attempt.approved_amount IS NOT NULL) THEN RAISE EXCEPTION ''CRM_POST_BOOKING_SETUP_REQUIRED''; END IF;
    IF sale_row.payment_method=''cash'' AND latest_attempt.id IS NOT NULL THEN RAISE EXCEPTION ''CRM_POST_BOOKING_SETUP_REQUIRED''; END IF;
    IF next_stage=''transfer_pending'' AND sale_row.payment_method=''mortgage'' AND (latest_attempt.id IS NULL
      OR latest_attempt.project_interest_id<>interest_row.id OR latest_attempt.result_status<>''approved''
      OR latest_attempt.submitted_at IS NULL OR latest_attempt.result_at IS NULL OR latest_attempt.result_at<latest_attempt.submitted_at
      OR latest_attempt.approved_amount IS NULL OR latest_attempt.approved_amount<=0
      OR latest_attempt.approved_amount::text IN (''NaN'',''Infinity'',''-Infinity'')
      OR EXISTS(SELECT 1 FROM public.loan_attempts WHERE sale_id=sale_row.id AND kind=''purchase'' AND result_status IN (''submitted'',''pending''))) THEN
      RAISE EXCEPTION ''CRM_POST_BOOKING_SETUP_REQUIRED''; END IF;
  ELSIF command_name=''submit_loan'' THEN
    IF sale_row.payment_method<>''mortgage'' OR sale_row.crm_stage<>''document_prep'' THEN RAISE EXCEPTION ''CRM_POST_BOOKING_CONFLICT''; END IF;
    IF EXISTS(SELECT 1 FROM public.loan_attempts WHERE sale_id=sale_row.id AND kind=''purchase'' AND result_status IN (''submitted'',''pending'')) THEN
      RAISE EXCEPTION ''CRM_POST_BOOKING_CONFLICT''; END IF;
    SELECT COALESCE(max(attempt_number),0)+1 INTO next_attempt FROM public.loan_attempts WHERE sale_id=sale_row.id;
    INSERT INTO sales_private.post_booking_write_permits VALUES(txid_current(),pg_backend_pid());
    INSERT INTO public.loan_attempts(project_interest_id,sale_id,attempt_number,kind,bank_name,result_status,submitted_at,recorded_by_user_id,created_at)
      VALUES(interest_row.id,sale_row.id,next_attempt,''purchase'',bank_value,''submitted'',occurred_value,actor_id,server_now) RETURNING * INTO loan_row;
    loan_id_value:=loan_row.id;
  ELSE
    IF sale_row.payment_method<>''mortgage'' OR sale_row.crm_stage<>''loan_submitted'' OR latest_attempt.id IS DISTINCT FROM loan_id_value
      OR latest_attempt.project_interest_id<>interest_row.id OR latest_attempt.result_status NOT IN (''submitted'',''pending'') THEN
      RAISE EXCEPTION ''CRM_POST_BOOKING_CONFLICT''; END IF;
    IF latest_attempt.submitted_at IS NULL OR latest_attempt.result_at IS NOT NULL OR latest_attempt.approved_amount IS NOT NULL
      OR EXISTS(SELECT 1 FROM public.loan_attempts WHERE sale_id=sale_row.id AND kind=''purchase'' AND id<>loan_id_value AND result_status IN (''submitted'',''pending'')) THEN
      RAISE EXCEPTION ''CRM_POST_BOOKING_SETUP_REQUIRED''; END IF;
    old_loan:=to_jsonb(latest_attempt);
    INSERT INTO sales_private.post_booking_write_permits VALUES(txid_current(),pg_backend_pid());
    UPDATE public.loan_attempts SET result_status=p_payload->>''result'',result_at=occurred_value,result_reason=reason_value,
      approved_amount=CASE WHEN p_payload->>''result''=''approved'' THEN amount_satang/100.0 ELSE NULL END WHERE id=loan_id_value RETURNING * INTO loan_row;
  END IF;
  IF command_name IN (''advance'',''confirm_transfer'',''confirm_handover'') THEN INSERT INTO sales_private.post_booking_write_permits VALUES(txid_current(),pg_backend_pid()); END IF;
  INSERT INTO sales_private.booking_write_permits VALUES(txid_current(),pg_backend_pid());
  next_revision:=gen_random_uuid();
  INSERT INTO sales_private.post_booking_external_write_permits VALUES(txid_current(),pg_backend_pid(),actor_id,old_sale,
    old_sale||jsonb_build_object(''crm_stage'',next_stage,''booking_revision'',next_revision,
      ''contracted_at'',CASE WHEN next_stage=''contracted'' THEN occurred_value ELSE sale_row.contracted_at END,
      ''crm_transfer_date'',CASE WHEN command_name=''confirm_transfer'' THEN transfer_value ELSE sale_row.crm_transfer_date END,
      ''crm_handover_date'',CASE WHEN command_name=''confirm_handover'' THEN handover_value ELSE sale_row.crm_handover_date END,
      ''contract_status'',CASE WHEN command_name=''confirm_transfer'' THEN ''Transferred'' ELSE sale_row.contract_status END));
  UPDATE public.sales SET crm_stage=next_stage,booking_revision=next_revision,
    contracted_at=CASE WHEN next_stage=''contracted'' THEN occurred_value ELSE contracted_at END,
    crm_transfer_date=CASE WHEN command_name=''confirm_transfer'' THEN transfer_value ELSE crm_transfer_date END,
    crm_handover_date=CASE WHEN command_name=''confirm_handover'' THEN handover_value ELSE crm_handover_date END,
    contract_status=CASE WHEN command_name=''confirm_transfer'' THEN ''Transferred'' ELSE contract_status END
    WHERE id=sale_row.id RETURNING * INTO sale_row;
  DELETE FROM sales_private.booking_write_permits WHERE transaction_id=txid_current();
  DELETE FROM sales_private.post_booking_external_write_permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid();
  INSERT INTO sales_private.post_booking_events(customer_id,project_interest_id,sale_id,command,from_stage,to_stage,actor_user_id,reason,evidence_note,occurred_at,recorded_at,loan_attempt_id,transfer_date,handover_date)
    VALUES(customer_id_value,interest_row.id,sale_row.id,command_name,old_sale->>''crm_stage'',next_stage,actor_id,reason_value,evidence_value,occurred_value,server_now,loan_id_value,transfer_value,handover_value)
    RETURNING id INTO event_id_value;
  DELETE FROM sales_private.post_booking_write_permits WHERE transaction_id=txid_current();
  INSERT INTO public.crm_audit_events(customer_id,entity_type,entity_id,event_type,reason_text,actor_user_id,actor_kind,
    actor_name_snapshot,old_values,new_values,occurred_at,recorded_at)
    VALUES(customer_id_value,''sale'',sale_row.id,''post_booking_''||command_name,reason_value,actor_id,''staff'',actor_name,
      jsonb_build_object(''sale'',old_sale,''loanAttempt'',old_loan),jsonb_build_object(''sale'',to_jsonb(sale_row),''loanAttempt'',
        CASE WHEN loan_row.id IS NULL THEN NULL ELSE to_jsonb(loan_row) END,''eventId'',event_id_value,''evidenceNote'',evidence_value,''transferDate'',transfer_value,''handoverDate'',handover_value),occurred_value,server_now);
  response_value:=jsonb_build_object(''requestId'',p_request_id,''command'',command_name,''customerId'',customer_id_value,''interestId'',interest_row.id,
    ''saleId'',sale_row.id,''saleRevision'',sale_row.booking_revision,''stage'',next_stage,''eventId'',event_id_value,''loanAttemptId'',loan_id_value,''transferDate'',transfer_value,''handoverDate'',handover_value,''replayed'',false);
  INSERT INTO sales_private.post_booking_command_requests(actor_user_id,request_id,request_payload,response,created_at)
    VALUES(actor_id,p_request_id,p_payload,response_value,server_now);
  RETURN response_value;
END;
');
 INSERT INTO customer_source_membership_private.adapters(signature,before_md5,after_md5,settings) VALUES('public.crm_v2_post_booking_command(uuid,jsonb)','ab4942a68a5b04d4655896e05d398864','063d33f9427d52513f434eb17dc67856',ARRAY['search_path=pg_catalog','TimeZone=UTC']::text[]);
END; $membership_adapter_16$;
DO $membership_adapter_17$
DECLARE d text; b text; owner_name text; secured boolean; settings text[];
BEGIN
 SELECT pg_get_functiondef(oid),replace(prosrc,E'\r\n',E'\n'),pg_get_userbyid(proowner),prosecdef,proconfig INTO d,b,owner_name,secured,settings FROM pg_proc WHERE oid='public.crm_v2_post_booking_context(uuid,integer,integer)'::regprocedure;
 d:=replace(d,E'\r\n',E'\n');
 IF md5(b) IS DISTINCT FROM 'c108874d7d2dd01dd08e75d800021b10' OR owner_name IS DISTINCT FROM current_user OR owner_name IS DISTINCT FROM 'postgres' OR secured IS DISTINCT FROM true OR settings IS DISTINCT FROM ARRAY['search_path=pg_catalog','TimeZone=UTC']::text[] THEN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_ADAPTER_REVIEW_REQUIRED'; END IF;
 IF (length(d)-length(replace(d,b,'')))/NULLIF(length(b),0)<>1 THEN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_DEFINITION_AMBIGUOUS'; END IF;
 EXECUTE replace(d,b,'
DECLARE
  actor_id uuid:=auth.uid(); actor_role text:=public.crm_v2_role(); sale_row public.sales%ROWTYPE;
  interest_row public.lead_project_interests%ROWTYPE; customer_row public.sales_customers%ROWTYPE;
  imported_history jsonb; attempts_json jsonb; events_json jsonb; latest_json jsonb; attempts_more boolean; events_more boolean;
BEGIN
  IF actor_id IS NULL OR COALESCE(actor_role,'''') NOT IN (''sales'',''admin'',''owner'') THEN RAISE EXCEPTION ''CRM_POST_BOOKING_FORBIDDEN''; END IF;
  IF (public.crm_v2_post_booking_capabilities()->>''enabled'')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION ''CRM_POST_BOOKING_SETUP_REQUIRED''; END IF;
  IF p_sale_id IS NULL OR p_attempt_page IS NULL OR p_attempt_page NOT BETWEEN 0 AND 100000
    OR p_event_page IS NULL OR p_event_page NOT BETWEEN 0 AND 100000 THEN RAISE EXCEPTION ''CRM_POST_BOOKING_INVALID_INPUT''; END IF;
  SELECT * INTO sale_row FROM customer_source_membership_private.sales WHERE id=p_sale_id;
  IF NOT FOUND THEN RAISE EXCEPTION ''CRM_POST_BOOKING_NOT_FOUND''; END IF;
  SELECT * INTO interest_row FROM customer_source_membership_private.interests WHERE id=sale_row.project_interest_id;
  IF NOT FOUND THEN RAISE EXCEPTION ''CRM_POST_BOOKING_SETUP_REQUIRED''; END IF;
  SELECT * INTO customer_row FROM customer_source_membership_private.customers WHERE id=interest_row.customer_id;
  IF NOT FOUND OR customer_row.merged_into_customer_id IS NOT NULL OR NOT EXISTS(SELECT 1 FROM sales_private.crm_user_roles
    WHERE user_id=interest_row.owner_user_id AND role=''sales'') THEN RAISE EXCEPTION ''CRM_POST_BOOKING_SETUP_REQUIRED''; END IF;
  imported_history:=sales_private.crm_booking_imported_history(to_jsonb(sale_row));
  IF sale_row.crm_stage IS NULL OR (sale_row.booking_round IS NULL AND imported_history IS NULL)
    OR (sale_row.plot_id IS NULL AND sale_row.crm_stage<>''cancelled'')
    OR (sale_row.plot_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.plots WHERE id=sale_row.plot_id AND project_name=interest_row.project_name))
    OR EXISTS(SELECT 1 FROM public.loan_attempts a WHERE a.sale_id=p_sale_id AND a.kind=''purchase'' AND a.project_interest_id<>interest_row.id) THEN
    RAISE EXCEPTION ''CRM_POST_BOOKING_SETUP_REQUIRED'';
  END IF;
  WITH rows AS (SELECT a FROM public.loan_attempts a WHERE a.sale_id=p_sale_id AND a.kind=''purchase''
    ORDER BY a.attempt_number DESC,a.id LIMIT 51 OFFSET p_attempt_page*50), numbered AS (
    SELECT a,row_number() OVER(ORDER BY (a).attempt_number DESC,(a).id) rn FROM rows)
  SELECT COALESCE(jsonb_agg(sales_private.crm_post_booking_attempt_json(a) ORDER BY (a).attempt_number DESC,(a).id)
    FILTER(WHERE rn<=50),''[]''::jsonb),count(*)>50 INTO attempts_json,attempts_more FROM numbered;
  SELECT sales_private.crm_post_booking_attempt_json(a) INTO latest_json FROM public.loan_attempts a
    WHERE a.sale_id=p_sale_id AND a.kind=''purchase'' ORDER BY a.attempt_number DESC,a.id LIMIT 1;
  WITH rows AS (SELECT * FROM sales_private.post_booking_events WHERE sale_id=p_sale_id
    ORDER BY recorded_at DESC,id DESC LIMIT 51 OFFSET p_event_page*50), numbered AS (
    SELECT *,row_number() OVER(ORDER BY recorded_at DESC,id DESC) rn FROM rows)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(''id'',id,''command'',command,''fromStage'',from_stage,''toStage'',to_stage,
    ''occurredAt'',occurred_at,''recordedAt'',recorded_at,''actorUserId'',actor_user_id,''reason'',reason,
    ''evidenceNote'',evidence_note,''loanAttemptId'',loan_attempt_id,''transferDate'',transfer_date,''handoverDate'',handover_date) ORDER BY recorded_at DESC,id DESC)
    FILTER(WHERE rn<=50),''[]''::jsonb),count(*)>50 INTO events_json,events_more FROM numbered;
  RETURN jsonb_build_object(''actor'',jsonb_build_object(''userId'',actor_id,''role'',actor_role),
    ''sale'',jsonb_build_object(''id'',sale_row.id,''customerId'',customer_row.id,''customerName'',sales_private.crm_effective_customer_name(customer_row.id),
      ''interestId'',interest_row.id,''projectName'',interest_row.project_name,''plotId'',sale_row.plot_id,''stage'',sale_row.crm_stage,
      ''paymentMethod'',sale_row.payment_method,''bookedAt'',sale_row.booked_at,''contractedAt'',sale_row.contracted_at,''transferDate'',sale_row.crm_transfer_date,''handoverDate'',sale_row.crm_handover_date,''importedHistory'',imported_history,
      ''revision'',sale_row.booking_revision,''interestRevision'',interest_row.lifecycle_revision,''ownerUserId'',interest_row.owner_user_id,
      ''canEdit'',(actor_role=''admin'' OR (actor_role=''sales'' AND actor_id=interest_row.owner_user_id))
        AND (sale_row.payment_method IS NOT NULL OR sale_row.crm_stage=''transferred'') AND sale_row.crm_stage NOT IN (''cancelled'',''handover'')
        AND (sale_row.payment_method=''mortgage'' OR sale_row.crm_stage NOT IN (''loan_submitted'',''loan_rejected'',''loan_approved''))
        AND EXISTS(SELECT 1 FROM sales_private.crm_user_roles WHERE user_id=interest_row.owner_user_id AND role=''sales'' AND is_active)),
    ''latestAttempt'',latest_json,''attempts'',attempts_json,''attemptPage'',p_attempt_page,''attemptsHasMore'',attempts_more,
    ''events'',events_json,''eventPage'',p_event_page,''eventsHasMore'',events_more);
END;
');
 INSERT INTO customer_source_membership_private.adapters(signature,before_md5,after_md5,settings) VALUES('public.crm_v2_post_booking_context(uuid,integer,integer)','c108874d7d2dd01dd08e75d800021b10','d73a8e7034a1b78bef56c8c9901dcf50',ARRAY['search_path=pg_catalog','TimeZone=UTC']::text[]);
END; $membership_adapter_17$;
DO $membership_adapter_18$
DECLARE d text; b text; owner_name text; secured boolean; settings text[];
BEGIN
 SELECT pg_get_functiondef(oid),replace(prosrc,E'\r\n',E'\n'),pg_get_userbyid(proowner),prosecdef,proconfig INTO d,b,owner_name,secured,settings FROM pg_proc WHERE oid='public.crm_v2_project_sales(text,text,text,integer)'::regprocedure;
 d:=replace(d,E'\r\n',E'\n');
 IF md5(b) IS DISTINCT FROM '67c0bbc3bcab8b87917d9106e952ae2c' OR owner_name IS DISTINCT FROM current_user OR owner_name IS DISTINCT FROM 'postgres' OR secured IS DISTINCT FROM true OR settings IS DISTINCT FROM ARRAY['search_path=pg_catalog','TimeZone=UTC']::text[] THEN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_ADAPTER_REVIEW_REQUIRED'; END IF;
 IF (length(d)-length(replace(d,b,'')))/NULLIF(length(b),0)<>1 THEN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_DEFINITION_AMBIGUOUS'; END IF;
 EXECUTE replace(d,b,'
DECLARE
  actor_id uuid:=auth.uid(); actor_role text:=public.crm_v2_role();
  trim_chars text:=U&'' \00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'';
  search_value text; rows_json jsonb:=''[]''::jsonb; more boolean:=false;
BEGIN
  IF actor_id IS NULL OR COALESCE(actor_role,'''') NOT IN (''sales'',''admin'',''owner'') THEN
    RAISE EXCEPTION ''CRM_PROJECT_SALES_FORBIDDEN'';
  END IF;
  IF (public.crm_v2_project_sales_capabilities()->>''enabled'')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION ''CRM_PROJECT_SALES_SETUP_REQUIRED'';
  END IF;
  IF p_tab IS NULL OR p_tab NOT IN (''booked'',''transferred'',''cancelled'',''all'')
    OR p_page IS NULL OR p_page NOT BETWEEN 0 AND 100000
    OR p_query IS NULL OR p_query ~ U&''[\0001-\001F\007F-\009F\2028\2029]''
    OR length(btrim(p_query,trim_chars))>200 OR length(btrim(p_query,trim_chars))=1
    OR (p_project_name IS NOT NULL AND (length(p_project_name) NOT BETWEEN 1 AND 200
      OR p_project_name ~ U&''[\0001-\001F\007F-\009F\2028\2029]'')) THEN
    RAISE EXCEPTION ''CRM_PROJECT_SALES_INVALID_INPUT'';
  END IF;
  search_value:=btrim(p_query,trim_chars);
  IF p_project_name IS NULL AND (p_page<>0 OR search_value<>'''') THEN
    RAISE EXCEPTION ''CRM_PROJECT_SALES_INVALID_INPUT'';
  END IF;
  IF p_project_name IS NOT NULL THEN
    IF NOT EXISTS(SELECT 1 FROM public.projects WHERE name=p_project_name) THEN
      RAISE EXCEPTION ''CRM_PROJECT_SALES_NOT_FOUND'';
    END IF;
    -- An unlinked sale can be assigned to a project only through its actual plot.
    -- Unknown/missing plots or unregistered plot projects are a global review gap.
    IF EXISTS(SELECT 1 FROM customer_source_membership_private.sales s LEFT JOIN public.plots p ON p.id=s.plot_id
      LEFT JOIN public.projects pr ON pr.name=p.project_name
      WHERE s.project_interest_id IS NULL AND (p.project_name=p_project_name OR p.id IS NULL OR pr.name IS NULL)) THEN
      RAISE EXCEPTION ''CRM_PROJECT_SALES_SETUP_REQUIRED'';
    END IF;
    -- Check integrity BEFORE tab/search/pagination so a filter cannot conceal a
    -- broken mapping. A plot mismatch blocks either affected project''s view.
    IF EXISTS(SELECT 1 FROM customer_source_membership_private.sales s
      LEFT JOIN customer_source_membership_private.interests i ON i.id=s.project_interest_id
      LEFT JOIN customer_source_membership_private.customers c ON c.id=i.customer_id
      LEFT JOIN sales_private.crm_user_roles owner_role ON owner_role.user_id=i.owner_user_id
      LEFT JOIN public.plots p ON p.id=s.plot_id
      LEFT JOIN customer_source_membership_private.sales previous ON previous.id=s.previous_sale_id
      WHERE s.project_interest_id IS NOT NULL
        AND (i.id IS NULL OR i.project_name=p_project_name OR p.project_name=p_project_name)
        AND (i.id IS NULL OR c.id IS NULL OR c.merged_into_customer_id IS NOT NULL
          OR owner_role.user_id IS NULL OR owner_role.role<>''sales''
          OR s.crm_stage IS NULL OR ((s.booking_round IS NULL
            OR to_jsonb(s)->>''external_booking_id'' IS NOT NULL OR to_jsonb(s)->>''external_source_stage'' IS NOT NULL)
            AND sales_private.crm_booking_imported_history(to_jsonb(s)) IS NULL)
          OR (s.plot_id IS NOT NULL AND (p.id IS NULL OR p.project_name IS DISTINCT FROM i.project_name))
          OR (s.plot_id IS NULL AND s.crm_stage<>''cancelled'')
          OR (s.previous_sale_id IS NOT NULL AND (previous.id IS NULL
            OR previous.project_interest_id IS DISTINCT FROM s.project_interest_id
            OR previous.crm_stage IS DISTINCT FROM ''cancelled'' OR previous.booking_round>=s.booking_round))
          OR (s.booked_at IS NOT NULL AND (NOT isfinite(s.booked_at)
            OR s.booked_at<TIMESTAMPTZ ''0001-01-01 00:00:00+00'' OR s.booked_at>=TIMESTAMPTZ ''10000-01-01 00:00:00+00''))
          OR (s.cancelled_at IS NOT NULL AND (NOT isfinite(s.cancelled_at)
            OR s.cancelled_at<TIMESTAMPTZ ''0001-01-01 00:00:00+00'' OR s.cancelled_at>=TIMESTAMPTZ ''10000-01-01 00:00:00+00'')))) THEN
      RAISE EXCEPTION ''CRM_PROJECT_SALES_SETUP_REQUIRED'';
    END IF;
    WITH page_rows AS (
      SELECT s.*,i.customer_id,i.project_name,i.owner_user_id,sales_private.crm_effective_customer_name(c.id) AS customer_name,sales_private.crm_effective_customer_phone(c.id) AS phone,p.plot_name,
        COALESCE(NULLIF(btrim(owner_role.display_name),''''),owner_role.user_id::text) AS owner_name
      FROM customer_source_membership_private.sales s
      JOIN customer_source_membership_private.interests i ON i.id=s.project_interest_id
      JOIN customer_source_membership_private.customers c ON c.id=i.customer_id
      JOIN sales_private.crm_user_roles owner_role ON owner_role.user_id=i.owner_user_id
      LEFT JOIN public.plots p ON p.id=s.plot_id
      WHERE i.project_name=p_project_name
        AND (p_tab=''all'' OR (p_tab=''booked'' AND s.crm_stage IN
          (''booked'',''contracted'',''downpayment'',''document_prep'',''loan_submitted'',''loan_rejected'',''loan_approved'',''transfer_pending''))
          OR (p_tab=''transferred'' AND s.crm_stage IN (''transferred'',''handover''))
          OR (p_tab=''cancelled'' AND s.crm_stage=''cancelled''))
        AND (search_value='''' OR strpos(lower(sales_private.crm_effective_customer_name(c.id)),lower(search_value))>0
          OR strpos(lower(COALESCE(sales_private.crm_effective_customer_phone(c.id),'''')),lower(search_value))>0
          OR strpos(lower(COALESCE(s.plot_id,'''')),lower(search_value))>0
          OR strpos(lower(COALESCE(p.plot_name,'''')),lower(search_value))>0)
      ORDER BY s.booked_at DESC NULLS LAST,s.id LIMIT 51 OFFSET p_page*50
    ), numbered AS (SELECT *,row_number() OVER(ORDER BY booked_at DESC NULLS LAST,id) rn FROM page_rows)
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      ''saleId'',s.id,''customerId'',s.customer_id,''customerName'',s.customer_name,''phone'',s.phone,
      ''interestId'',s.project_interest_id,''projectName'',s.project_name,''ownerUserId'',s.owner_user_id,''ownerName'',s.owner_name,
      ''plotId'',s.plot_id,''plotName'',s.plot_name,''stage'',s.crm_stage,''bookingRound'',s.booking_round,
      ''importedHistory'',sales_private.crm_booking_imported_history(to_jsonb(s)),
      ''previousSaleId'',s.previous_sale_id,''bookedAt'',s.booked_at,''cancelledAt'',s.cancelled_at,
      ''cancellationReason'',s.cancellation_reason,''listPrice'',s.list_price,''discountAmount'',s.discount_amount,
      ''salePrice'',sales_private.crm_effective_sale_price(s.id),''depositAmount'',s.booking_amount,''paymentMethod'',s.payment_method)
      ORDER BY s.booked_at DESC NULLS LAST,s.id) FILTER(WHERE rn<=50),''[]''::jsonb),count(*)>50
      INTO rows_json,more FROM numbered s;
  END IF;
  RETURN jsonb_build_object(''actor'',jsonb_build_object(''userId'',actor_id,''role'',actor_role),
    ''projectName'',p_project_name,''projects'',COALESCE((SELECT jsonb_agg(jsonb_build_object(''name'',name) ORDER BY name)
      FROM public.projects),''[]''::jsonb),''tab'',p_tab,''query'',search_value,''page'',p_page,''hasMore'',more,''rows'',rows_json);
END;
');
 INSERT INTO customer_source_membership_private.adapters(signature,before_md5,after_md5,settings) VALUES('public.crm_v2_project_sales(text,text,text,integer)','67c0bbc3bcab8b87917d9106e952ae2c','d6471efc6076886fd864dad975c9610b',ARRAY['search_path=pg_catalog','TimeZone=UTC']::text[]);
END; $membership_adapter_18$;
DO $membership_adapter_19$
DECLARE d text; b text; owner_name text; secured boolean; settings text[];
BEGIN
 SELECT pg_get_functiondef(oid),replace(prosrc,E'\r\n',E'\n'),pg_get_userbyid(proowner),prosecdef,proconfig INTO d,b,owner_name,secured,settings FROM pg_proc WHERE oid='public.crm_v2_record_lead_work(uuid,jsonb)'::regprocedure;
 d:=replace(d,E'\r\n',E'\n');
 IF md5(b) IS DISTINCT FROM '9216ae5889c83b4b3c8161136178cd63' OR owner_name IS DISTINCT FROM current_user OR owner_name IS DISTINCT FROM 'postgres' OR secured IS DISTINCT FROM true OR settings IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] THEN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_ADAPTER_REVIEW_REQUIRED'; END IF;
 IF (length(d)-length(replace(d,b,'')))/NULLIF(length(b),0)<>1 THEN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_DEFINITION_AMBIGUOUS'; END IF;
 EXECUTE replace(d,b,'
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
  uuid_pattern text:=''^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'';
BEGIN
 PERFORM customer_source_membership_private.assert_payload(p_payload);
  IF actor_id IS NULL OR public.crm_v2_role() NOT IN (''sales'',''admin'') THEN
    RAISE EXCEPTION ''CRM_WORK_FORBIDDEN'';
  END IF;
  -- DB kill switch protects direct RPC calls as well as the disabled app route.
  SELECT central_intake_enabled AND lead_work_enabled INTO enabled
    FROM public.crm_settings WHERE id FOR SHARE;
  IF enabled IS DISTINCT FROM true THEN RAISE EXCEPTION ''CRM_WORK_SETUP_REQUIRED''; END IF;
  IF p_request_id IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM ''object''
    OR octet_length(p_payload::text)>16384 THEN RAISE EXCEPTION ''CRM_WORK_INVALID_INPUT''; END IF;
  IF NOT (p_payload ?& ARRAY[''command'',''customerId'',''interestId'',''expectedActionId'',''nextAction'',''reason''])
    OR jsonb_typeof(p_payload->''command'') IS DISTINCT FROM ''string''
    OR (p_payload->>''command'') NOT IN (''set_next_action'',''record_attempt'') THEN
    RAISE EXCEPTION ''CRM_WORK_INVALID_INPUT'';
  END IF;
  command_name:=p_payload->>''command'';
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN (
      ''command'',''customerId'',''interestId'',''expectedActionId'',''nextAction'',''reason'',''attempt''))
    OR (command_name=''set_next_action'' AND p_payload ? ''attempt'')
    OR (command_name=''record_attempt'' AND NOT (p_payload ? ''attempt'')) THEN
    RAISE EXCEPTION ''CRM_WORK_INVALID_INPUT'';
  END IF;
  IF jsonb_typeof(p_payload->''customerId'') IS DISTINCT FROM ''string''
    OR length(p_payload->>''customerId'')<>36 OR (p_payload->>''customerId'') !~ uuid_pattern
    OR jsonb_typeof(p_payload->''interestId'') NOT IN (''string'',''null'')
    OR (jsonb_typeof(p_payload->''interestId'')=''string''
      AND (length(p_payload->>''interestId'')<>36 OR (p_payload->>''interestId'') !~ uuid_pattern))
    OR jsonb_typeof(p_payload->''expectedActionId'') NOT IN (''string'',''null'')
    OR (jsonb_typeof(p_payload->''expectedActionId'')=''string''
      AND (length(p_payload->>''expectedActionId'')<>36 OR (p_payload->>''expectedActionId'') !~ uuid_pattern))
    OR jsonb_typeof(p_payload->''reason'') IS DISTINCT FROM ''string''
    OR jsonb_typeof(p_payload->''nextAction'') IS DISTINCT FROM ''object'' THEN
    RAISE EXCEPTION ''CRM_WORK_INVALID_INPUT'';
  END IF;
  IF NOT ((p_payload->''nextAction'') ?& ARRAY[''action'',''dueAt''])
    OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_payload->''nextAction'') k WHERE k NOT IN (''action'',''dueAt''))
    OR jsonb_typeof(p_payload#>''{nextAction,action}'') IS DISTINCT FROM ''string''
    OR jsonb_typeof(p_payload#>''{nextAction,dueAt}'') IS DISTINCT FROM ''string'' THEN
    RAISE EXCEPTION ''CRM_WORK_INVALID_INPUT'';
  END IF;
  reason_value:=sales_private.crm_work_text(p_payload->>''reason'',1000);
  action_value:=sales_private.crm_work_text(p_payload#>>''{nextAction,action}'',500);
  due_value:=sales_private.crm_work_timestamp(p_payload#>>''{nextAction,dueAt}'');
  IF command_name=''record_attempt'' THEN
    IF jsonb_typeof(p_payload->''attempt'') IS DISTINCT FROM ''object'' THEN
      RAISE EXCEPTION ''CRM_WORK_INVALID_INPUT'';
    END IF;
    IF NOT ((p_payload->''attempt'') ?& ARRAY[''action'',''channel'',''result'',''occurredAt''])
      OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_payload->''attempt'') k
        WHERE k NOT IN (''action'',''channel'',''result'',''occurredAt''))
      OR jsonb_typeof(p_payload#>''{attempt,action}'') IS DISTINCT FROM ''string''
      OR jsonb_typeof(p_payload#>''{attempt,channel}'') IS DISTINCT FROM ''string''
      OR jsonb_typeof(p_payload#>''{attempt,result}'') IS DISTINCT FROM ''string''
      OR jsonb_typeof(p_payload#>''{attempt,occurredAt}'') IS DISTINCT FROM ''string''
      OR (p_payload#>>''{attempt,channel}'') NOT IN (''phone'',''chat'',''email'',''in_person'',''other'')
      OR (p_payload#>>''{attempt,result}'') NOT IN (''contact_success'',''no_answer'',''customer_requested_later'',''other'') THEN
      RAISE EXCEPTION ''CRM_WORK_INVALID_INPUT'';
    END IF;
    attempt_action:=sales_private.crm_work_text(p_payload#>>''{attempt,action}'',500);
    occurred_value:=sales_private.crm_work_timestamp(p_payload#>>''{attempt,occurredAt}'');
  END IF;
  customer_id_value:=(p_payload->>''customerId'')::uuid;
  interest_id_value:=(p_payload->>''interestId'')::uuid;
  expected_id:=(p_payload->>''expectedActionId'')::uuid;

  -- Serialization order: settings -> request -> customer -> interest -> role rows.
  -- Future assignment/closure commands must follow compatible scope/role locking.
  PERFORM pg_advisory_xact_lock(hashtextextended(''lead-work:''||actor_id::text||'':''||p_request_id::text,0));
  SELECT * INTO customer_row FROM customer_source_membership_private.customers WHERE id=customer_id_value FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION ''CRM_WORK_NOT_FOUND''; END IF;
  scope_owner:=customer_row.owner_user_id;
  IF interest_id_value IS NOT NULL THEN
    SELECT * INTO interest_row FROM customer_source_membership_private.interests
      WHERE id=interest_id_value AND customer_id=customer_id_value FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION ''CRM_WORK_NOT_FOUND''; END IF;
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
      scope_owner_active:=role_row.role=''sales'' AND role_row.is_active;
    END IF;
  END LOOP;
  IF actor_role IS NULL OR actor_role NOT IN (''sales'',''admin'')
    OR (actor_role=''sales'' AND actor_id<>scope_owner) THEN
    RAISE EXCEPTION ''CRM_WORK_FORBIDDEN'';
  END IF;
  IF scope_owner_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION ''CRM_WORK_INACTIVE_OWNER'';
  END IF;

  -- Re-check ownership BEFORE replay. A former owner must not replay a saved receipt.
  SELECT * INTO request_row FROM sales_private.lead_work_command_requests
    WHERE actor_user_id=actor_id AND request_id=p_request_id;
  IF FOUND THEN
    IF request_row.request_payload IS DISTINCT FROM p_payload THEN
      RAISE EXCEPTION ''CRM_WORK_IDEMPOTENCY_CONFLICT'';
    END IF;
    RETURN request_row.response || jsonb_build_object(''replayed'',true);
  END IF;
  IF customer_row.merged_into_customer_id IS NOT NULL
    OR (interest_id_value IS NULL AND customer_row.intake_status=''lost'')
    OR (interest_id_value IS NOT NULL AND interest_row.engagement_status=''lost'') THEN
    RAISE EXCEPTION ''CRM_WORK_SCOPE_CLOSED'';
  END IF;
  SELECT * INTO prior_action FROM public.crm_next_actions
    WHERE customer_id=customer_id_value AND project_interest_id IS NOT DISTINCT FROM interest_id_value
      AND status=''open'' FOR UPDATE;
  IF prior_action.id IS DISTINCT FROM expected_id THEN RAISE EXCEPTION ''CRM_WORK_STALE_ACTION''; END IF;

  -- Trusted clock sampled AFTER lock waits, not a browser date or transaction start.
  -- Cached retries above remain valid after the original deadline has passed.
  server_now:=clock_timestamp();
  IF due_value<=server_now OR (command_name=''record_attempt'' AND occurred_value>server_now) THEN
    RAISE EXCEPTION ''CRM_WORK_TIME_INVALID'';
  END IF;
  -- An older event must not replace a plan created after that event. A future
  -- history-only command can append such evidence without touching the open plan.
  IF command_name=''record_attempt'' AND prior_action.id IS NOT NULL
    AND occurred_value<prior_action.recorded_at THEN
    RAISE EXCEPTION ''CRM_WORK_TIME_INVALID'';
  END IF;
  IF command_name=''record_attempt'' THEN
    new_activity_id:=gen_random_uuid();
    INSERT INTO public.lead_activities (
      id,customer_id,project_interest_id,activity_type,result,occurred_at,recorded_at,
      recorded_by_user_id,performed_by_user_id,contact_channel,action_text,
      related_next_action_id,next_follow_up_at,note
    ) VALUES (
      new_activity_id,customer_id_value,interest_id_value,''follow_up'',p_payload#>>''{attempt,result}'',
      occurred_value,server_now,actor_id,actor_id,p_payload#>>''{attempt,channel}'',attempt_action,
      prior_action.id,due_value,reason_value
    );
  END IF;
  -- Superseded is NOT done. Neither success nor no_answer erases the previous due date.
  IF prior_action.id IS NOT NULL THEN
    UPDATE public.crm_next_actions SET status=''superseded'',closed_at=server_now,
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
    customer_id_value,''crm_next_action'',new_action_id,command_name,reason_value,actor_id,''staff'',
    actor_name,CASE WHEN prior_action.id IS NULL THEN NULL ELSE to_jsonb(prior_action) END,
    jsonb_build_object(''nextActionId'',new_action_id,''activityId'',new_activity_id,
      ''interestId'',interest_id_value,''ownerUserId'',scope_owner,''action'',action_value,''dueAt'',due_value,
      ''priorWasOverdue'',CASE WHEN prior_action.id IS NULL THEN NULL ELSE prior_action.due_at<server_now END),
    server_now,server_now
  );
  response_value:=jsonb_build_object(''nextActionId'',new_action_id,''activityId'',new_activity_id,''replayed'',false);
  INSERT INTO sales_private.lead_work_command_requests (actor_user_id,request_id,request_payload,response,created_at)
    VALUES (actor_id,p_request_id,p_payload,response_value,server_now);
  RETURN response_value;
END;
');
 INSERT INTO customer_source_membership_private.adapters(signature,before_md5,after_md5,settings) VALUES('public.crm_v2_record_lead_work(uuid,jsonb)','9216ae5889c83b4b3c8161136178cd63','5a038e46e27d1325d20975f42b379976',ARRAY['search_path=pg_catalog']::text[]);
END; $membership_adapter_19$;
DO $membership_adapter_20$
DECLARE d text; b text; owner_name text; secured boolean; settings text[];
BEGIN
 SELECT pg_get_functiondef(oid),replace(prosrc,E'\r\n',E'\n'),pg_get_userbyid(proowner),prosecdef,proconfig INTO d,b,owner_name,secured,settings FROM pg_proc WHERE oid='public.crm_v2_record_visit_sop(uuid,jsonb)'::regprocedure;
 d:=replace(d,E'\r\n',E'\n');
 IF md5(b) IS DISTINCT FROM 'cba1b164c1b89bd754a44a692cb8d50a' OR owner_name IS DISTINCT FROM current_user OR owner_name IS DISTINCT FROM 'postgres' OR secured IS DISTINCT FROM true OR settings IS DISTINCT FROM ARRAY['search_path=pg_catalog','TimeZone=UTC']::text[] THEN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_ADAPTER_REVIEW_REQUIRED'; END IF;
 IF (length(d)-length(replace(d,b,'')))/NULLIF(length(b),0)<>1 THEN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_DEFINITION_AMBIGUOUS'; END IF;
 EXECUTE replace(d,b,'
DECLARE
 actor_id uuid:=auth.uid(); actor_role text:=public.crm_v2_role(); actor_name text; owner_active boolean:=false; enabled boolean;
 command_name text; allowed_keys text[]; reason_value text; stage_value text; plot_value text;
 customer_id_value uuid; interest_id_value uuid; appointment_input uuid; visit_input uuid; appointment_value uuid; visit_value uuid;
 expected_interest uuid; run_id_value uuid; expected_run uuid;
 occurred_value timestamptz; departed_value timestamptz; server_now timestamptz; latest_time timestamptz;
 c public.sales_customers%ROWTYPE; i public.lead_project_interests%ROWTYPE; a public.lead_appointments%ROWTYPE; v public.lead_visits%ROWTYPE;
 r public.house_visit_checklist_runs%ROWTYPE; next_row public.crm_next_actions%ROWTYPE; role_row sales_private.crm_user_roles%ROWTYPE;
 receipt sales_private.visit_sop_command_requests%ROWTYPE; answer jsonb; normalized_answers jsonb:=''[]''::jsonb; answer_reason text;
 feedback_value text; objections_value text; recap_value jsonb; event_id_value uuid; response_value jsonb; matches integer;
 old_run jsonb; old_items jsonb; new_items jsonb; details_value jsonb;
 trim_chars text:=U&'' \00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'';
BEGIN
 PERFORM customer_source_membership_private.assert_payload(p_payload);
 IF actor_id IS NULL OR actor_role IS DISTINCT FROM ''sales'' THEN RAISE EXCEPTION ''CRM_SOP_FORBIDDEN''; END IF;
 SELECT central_intake_enabled AND lead_work_enabled AND lead_lifecycle_enabled AND visits_enabled AND visit_sop_enabled INTO enabled FROM public.crm_settings WHERE id FOR SHARE;
 IF enabled IS DISTINCT FROM true THEN RAISE EXCEPTION ''CRM_SOP_SETUP_REQUIRED''; END IF;
 IF p_request_id IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM ''object'' OR octet_length(p_payload::text)>65536
   OR jsonb_typeof(p_payload->''command'') IS DISTINCT FROM ''string'' THEN RAISE EXCEPTION ''CRM_SOP_INVALID_INPUT''; END IF;
 command_name:=p_payload->>''command'';
 allowed_keys:=ARRAY[''command'',''customerId'',''interestId'',''appointmentId'',''visitId'',''expectedInterestRevision'',''occurredAt'',''reason'']||CASE command_name
   WHEN ''start'' THEN ARRAY[''plotId''] WHEN ''save_stage'' THEN ARRAY[''runId'',''expectedRunRevision'',''stage'',''answers'',''recap'']
   WHEN ''complete_stage'' THEN ARRAY[''runId'',''expectedRunRevision'',''stage'',''answers'',''recap''] WHEN ''start_tour'' THEN ARRAY[''runId'',''expectedRunRevision''] ELSE NULL END;
 IF allowed_keys IS NULL OR NOT(p_payload ?& allowed_keys) OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE NOT(k=ANY(allowed_keys)))
   OR jsonb_typeof(p_payload->''occurredAt'') IS DISTINCT FROM ''string'' OR jsonb_typeof(p_payload->''reason'') IS DISTINCT FROM ''string'' THEN RAISE EXCEPTION ''CRM_SOP_INVALID_INPUT''; END IF;
 BEGIN
   customer_id_value:=sales_private.crm_visits_uuid(p_payload->''customerId''); interest_id_value:=sales_private.crm_visits_uuid(p_payload->''interestId'');
   appointment_input:=sales_private.crm_visits_uuid(p_payload->''appointmentId'',true); visit_input:=sales_private.crm_visits_uuid(p_payload->''visitId'',true);
   expected_interest:=sales_private.crm_visits_uuid(p_payload->''expectedInterestRevision'');
   IF (appointment_input IS NULL)=(visit_input IS NULL) THEN RAISE EXCEPTION ''CRM_SOP_INVALID_INPUT''; END IF;
   occurred_value:=sales_private.crm_work_timestamp(p_payload->>''occurredAt''); reason_value:=sales_private.crm_work_text(p_payload->>''reason'',1000);
   IF command_name=''start'' THEN
     IF jsonb_typeof(p_payload->''plotId'') IS DISTINCT FROM ''string'' THEN RAISE EXCEPTION ''CRM_SOP_INVALID_INPUT''; END IF;
     PERFORM sales_private.crm_work_text(p_payload->>''plotId'',255); plot_value:=p_payload->>''plotId'';
     IF length(plot_value)>255 THEN RAISE EXCEPTION ''CRM_SOP_INVALID_INPUT''; END IF;
   ELSE run_id_value:=sales_private.crm_visits_uuid(p_payload->''runId''); expected_run:=sales_private.crm_visits_uuid(p_payload->''expectedRunRevision''); END IF;
   IF command_name IN (''save_stage'',''complete_stage'') THEN
     IF jsonb_typeof(p_payload->''stage'') IS DISTINCT FROM ''string'' OR p_payload->>''stage'' NOT IN (''stage_a'',''stage_c'')
       OR jsonb_typeof(p_payload->''answers'') IS DISTINCT FROM ''array'' THEN RAISE EXCEPTION ''CRM_SOP_INVALID_INPUT''; END IF;
     stage_value:=p_payload->>''stage'';
     IF jsonb_array_length(p_payload->''answers'')<>(CASE stage_value WHEN ''stage_a'' THEN 16 ELSE 13 END) THEN RAISE EXCEPTION ''CRM_SOP_INVALID_INPUT''; END IF;
     FOR answer IN SELECT value FROM jsonb_array_elements(p_payload->''answers'') LOOP
       IF jsonb_typeof(answer) IS DISTINCT FROM ''object'' THEN RAISE EXCEPTION ''CRM_SOP_INVALID_INPUT''; END IF;
       IF NOT(answer ?& ARRAY[''key'',''result'',''reason'']) OR EXISTS(SELECT 1 FROM jsonb_object_keys(answer) k WHERE k NOT IN (''key'',''result'',''reason''))
         OR jsonb_typeof(answer->''key'') IS DISTINCT FROM ''string'' OR jsonb_typeof(answer->''result'') IS DISTINCT FROM ''string''
         OR answer->>''result'' NOT IN (''pending'',''done'',''not_applicable'',''skipped'') OR jsonb_typeof(answer->''reason'') NOT IN (''string'',''null'')
         OR NOT EXISTS(SELECT 1 FROM sales_private.crm_sop_template() WHERE stage=stage_value AND item_key=answer->>''key'') THEN RAISE EXCEPTION ''CRM_SOP_INVALID_INPUT''; END IF;
       answer_reason:=NULL;
       IF answer->>''reason'' IS NOT NULL THEN answer_reason:=sales_private.crm_work_text(answer->>''reason'',1000); END IF;
       IF answer->>''result'' IN (''not_applicable'',''skipped'') AND answer_reason IS NULL THEN RAISE EXCEPTION ''CRM_SOP_INVALID_INPUT''; END IF;
       normalized_answers:=normalized_answers||jsonb_build_array(jsonb_build_object(''key'',answer->>''key'',''result'',answer->>''result'',''reason'',answer_reason));
     END LOOP;
     IF (SELECT count(DISTINCT value->>''key'') FROM jsonb_array_elements(normalized_answers))<>jsonb_array_length(normalized_answers) THEN RAISE EXCEPTION ''CRM_SOP_INVALID_INPUT''; END IF;
     IF stage_value=''stage_a'' THEN
       IF p_payload->''recap''<>''null''::jsonb THEN RAISE EXCEPTION ''CRM_SOP_INVALID_INPUT''; END IF;
     ELSE
       recap_value:=p_payload->''recap'';
       IF jsonb_typeof(recap_value) IS DISTINCT FROM ''object'' THEN RAISE EXCEPTION ''CRM_SOP_INVALID_INPUT''; END IF;
       IF NOT(recap_value ?& ARRAY[''feedback'',''objections'',''departedAt'']) OR EXISTS(SELECT 1 FROM jsonb_object_keys(recap_value) k WHERE k NOT IN (''feedback'',''objections'',''departedAt''))
         OR jsonb_typeof(recap_value->''feedback'') IS DISTINCT FROM ''string'' OR jsonb_typeof(recap_value->''objections'') IS DISTINCT FROM ''string''
         OR jsonb_typeof(recap_value->''departedAt'') NOT IN (''string'',''null'') THEN RAISE EXCEPTION ''CRM_SOP_INVALID_INPUT''; END IF;
       IF (recap_value->>''feedback'') ~ U&''[\0001-\001F\007F-\009F\2028\2029]''
         OR (recap_value->>''objections'') ~ U&''[\0001-\001F\007F-\009F\2028\2029]'' THEN RAISE EXCEPTION ''CRM_SOP_INVALID_INPUT''; END IF;
       feedback_value:=btrim(recap_value->>''feedback'',trim_chars); objections_value:=btrim(recap_value->>''objections'',trim_chars);
       IF length(feedback_value)>2000 OR length(objections_value)>2000 THEN RAISE EXCEPTION ''CRM_SOP_INVALID_INPUT''; END IF;
       IF recap_value->>''departedAt'' IS NOT NULL THEN departed_value:=sales_private.crm_work_timestamp(recap_value->>''departedAt''); END IF;
     END IF;
   END IF;
 EXCEPTION WHEN raise_exception THEN RAISE EXCEPTION ''CRM_SOP_INVALID_INPUT''; END;
 IF occurred_value<TIMESTAMPTZ ''0001-01-01 00:00:00+00'' OR occurred_value>=TIMESTAMPTZ ''10000-01-01 00:00:00+00''
   OR departed_value<TIMESTAMPTZ ''0001-01-01 00:00:00+00'' OR departed_value>=TIMESTAMPTZ ''10000-01-01 00:00:00+00'' THEN RAISE EXCEPTION ''CRM_SOP_INVALID_INPUT''; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(''visit-sop:''||actor_id::text||'':''||p_request_id::text,0));
 SELECT * INTO c FROM customer_source_membership_private.customers WHERE id=customer_id_value FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION ''CRM_SOP_NOT_FOUND''; END IF;
 SELECT * INTO i FROM customer_source_membership_private.interests WHERE id=interest_id_value AND customer_id=c.id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION ''CRM_SOP_NOT_FOUND''; END IF;
 actor_role:=NULL;
 FOR role_row IN SELECT * FROM sales_private.crm_user_roles WHERE user_id IN(actor_id,i.owner_user_id) ORDER BY user_id FOR SHARE LOOP
   IF role_row.user_id=actor_id AND role_row.is_active THEN actor_role:=role_row.role; actor_name:=role_row.display_name; END IF;
   IF role_row.user_id=i.owner_user_id THEN owner_active:=role_row.is_active AND role_row.role=''sales''; END IF;
 END LOOP;
 IF actor_role IS DISTINCT FROM ''sales'' OR actor_id<>i.owner_user_id OR NOT owner_active THEN RAISE EXCEPTION ''CRM_SOP_FORBIDDEN''; END IF;
 SELECT * INTO receipt FROM sales_private.visit_sop_command_requests WHERE actor_user_id=actor_id AND request_id=p_request_id;
 IF FOUND THEN
   IF receipt.request_payload IS DISTINCT FROM p_payload THEN RAISE EXCEPTION ''CRM_SOP_IDEMPOTENCY_CONFLICT''; END IF;
   RETURN receipt.response||jsonb_build_object(''replayed'',true);
 END IF;
 IF c.merged_into_customer_id IS NOT NULL OR i.engagement_status=''lost'' THEN RAISE EXCEPTION ''CRM_SOP_SCOPE_CLOSED''; END IF;
 IF i.lifecycle_revision IS DISTINCT FROM expected_interest THEN RAISE EXCEPTION ''CRM_SOP_STALE_STATE''; END IF;
 appointment_value:=appointment_input; visit_value:=visit_input;
 IF visit_input IS NOT NULL THEN
   SELECT appointment_id INTO appointment_value FROM public.lead_visits WHERE id=visit_input AND project_interest_id=i.id;
   IF NOT FOUND THEN RAISE EXCEPTION ''CRM_SOP_NOT_FOUND''; END IF;
 END IF;
 IF appointment_value IS NOT NULL THEN
   SELECT * INTO a FROM public.lead_appointments WHERE id=appointment_value AND project_interest_id=i.id FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION ''CRM_SOP_NOT_FOUND''; END IF;
   IF visit_value IS NULL THEN SELECT id INTO visit_value FROM public.lead_visits WHERE appointment_id=a.id AND project_interest_id=i.id; END IF;
 END IF;
 IF visit_value IS NOT NULL THEN
   SELECT * INTO v FROM public.lead_visits WHERE id=visit_value AND project_interest_id=i.id FOR UPDATE;
   IF NOT FOUND OR v.appointment_id IS DISTINCT FROM a.id THEN RAISE EXCEPTION ''CRM_SOP_NOT_FOUND''; END IF;
 END IF;
 IF (a.id IS NOT NULL AND a.status NOT IN (''scheduled'',''rescheduled'',''attended'')) OR (a.status=''attended'' AND v.id IS NULL)
   OR (v.id IS NOT NULL AND v.status NOT IN (''awaiting_voice'',''completed'')) THEN RAISE EXCEPTION ''CRM_SOP_SCOPE_CLOSED''; END IF;
 SELECT count(*) INTO matches FROM public.house_visit_checklist_runs WHERE project_interest_id=i.id
   AND ((a.id IS NOT NULL AND appointment_id=a.id) OR (v.id IS NOT NULL AND visit_id=v.id));
 IF matches>1 THEN RAISE EXCEPTION ''CRM_SOP_SETUP_REQUIRED''; END IF;
 SELECT * INTO r FROM public.house_visit_checklist_runs WHERE project_interest_id=i.id
   AND ((a.id IS NOT NULL AND appointment_id=a.id) OR (v.id IS NOT NULL AND visit_id=v.id)) FOR UPDATE;
 IF command_name=''start'' THEN
   IF r.id IS NOT NULL THEN RAISE EXCEPTION ''CRM_SOP_ALREADY_STARTED''; END IF;
   PERFORM 1 FROM public.plots WHERE id=plot_value AND project_name=i.project_name FOR SHARE;
   IF NOT FOUND THEN RAISE EXCEPTION ''CRM_SOP_NOT_FOUND''; END IF;
 ELSE
   IF r.id IS NULL OR r.id<>run_id_value THEN RAISE EXCEPTION ''CRM_SOP_NOT_FOUND''; END IF;
   IF r.revision IS DISTINCT FROM expected_run THEN RAISE EXCEPTION ''CRM_SOP_STALE_STATE''; END IF;
   IF r.current_stage=''completed'' THEN RAISE EXCEPTION ''CRM_SOP_SCOPE_CLOSED''; END IF;
   IF r.template_version<>''house_visit_v1'' OR (SELECT count(*) FROM public.house_visit_checklist_items WHERE run_id=r.id)<>29
     OR EXISTS(SELECT 1 FROM sales_private.crm_sop_template() t WHERE NOT EXISTS(SELECT 1 FROM public.house_visit_checklist_items x WHERE x.run_id=r.id AND x.stage=t.stage AND x.item_key=t.item_key AND x.item_label_snapshot=t.label)) THEN RAISE EXCEPTION ''CRM_SOP_SETUP_REQUIRED''; END IF;
   IF command_name IN (''save_stage'',''complete_stage'') AND r.current_stage<>stage_value THEN RAISE EXCEPTION ''CRM_SOP_INCOMPLETE_STAGE''; END IF;
   IF command_name=''start_tour'' AND r.current_stage<>''stage_b'' THEN RAISE EXCEPTION ''CRM_SOP_INCOMPLETE_STAGE''; END IF;
 END IF;
 SELECT max(occurred_at) INTO latest_time FROM sales_private.visit_sop_events WHERE run_id=r.id;
 server_now:=clock_timestamp();
 IF (c.lead_created_at IS NOT NULL AND NOT isfinite(c.lead_created_at)) OR (v.id IS NOT NULL AND NOT isfinite(v.checked_in_at)) THEN RAISE EXCEPTION ''CRM_SOP_SETUP_REQUIRED''; END IF;
 IF occurred_value>server_now OR occurred_value<c.lead_created_at OR occurred_value<latest_time OR departed_value>occurred_value
   OR departed_value<v.checked_in_at OR departed_value<r.stage_b_started_at
   OR (stage_value=''stage_c'' AND r.departed_at IS NOT NULL AND (departed_value IS NULL OR departed_value<r.departed_at)) THEN RAISE EXCEPTION ''CRM_SOP_INVALID_INPUT''; END IF;
 IF command_name=''start_tour'' AND (v.id IS NULL OR v.checked_in_at>occurred_value) THEN RAISE EXCEPTION ''CRM_SOP_VISIT_REQUIRED''; END IF;
 IF command_name=''complete_stage'' THEN
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(normalized_answers) x WHERE x->>''result''=''pending'') THEN RAISE EXCEPTION ''CRM_SOP_INCOMPLETE_STAGE''; END IF;
   IF stage_value=''stage_c'' THEN
     IF v.id IS NULL THEN RAISE EXCEPTION ''CRM_SOP_VISIT_REQUIRED''; END IF;
     IF departed_value IS NULL OR btrim(feedback_value)='''' OR btrim(objections_value)='''' THEN RAISE EXCEPTION ''CRM_SOP_INCOMPLETE_STAGE''; END IF;
     SELECT * INTO next_row FROM public.crm_next_actions WHERE customer_id=c.id AND project_interest_id=i.id AND status=''open'' FOR SHARE;
     IF NOT FOUND OR NOT isfinite(next_row.due_at) OR next_row.due_at<=clock_timestamp()
       OR next_row.owner_user_id IS DISTINCT FROM i.owner_user_id OR next_row.scope_key IS DISTINCT FROM ''interest:''||i.id::text
       OR length(btrim(next_row.action_text)) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION ''CRM_SOP_NEXT_ACTION_REQUIRED''; END IF;
   END IF;
 END IF;
 -- Recording time is sampled after every scope/run/action lock wait. Actual
 -- occurredAt remains separate and is never an automatic KPI timeliness proof.
 server_now:=clock_timestamp();
 old_run:=CASE WHEN r.id IS NULL THEN NULL ELSE to_jsonb(r) END;
 SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.stage,x.item_key),''[]''::jsonb) INTO old_items FROM public.house_visit_checklist_items x WHERE x.run_id=r.id;
 INSERT INTO sales_private.visit_sop_write_permits VALUES(txid_current(),pg_backend_pid());
 IF command_name=''start'' THEN
   INSERT INTO public.house_visit_checklist_runs(project_name,plot_id,project_interest_id,appointment_id,visit_id,responsible_sales_user_id,
     template_version,current_stage,recap,created_at,updated_at)
     VALUES(i.project_name,plot_value,i.id,a.id,v.id,i.owner_user_id,''house_visit_v1'',''stage_a'',''{"feedback":"","objections":""}''::jsonb,server_now,server_now) RETURNING * INTO r;
   INSERT INTO public.house_visit_checklist_items(run_id,stage,item_key,item_label_snapshot)
     SELECT r.id,stage,item_key,label FROM sales_private.crm_sop_template();
 ELSE
   IF command_name IN (''save_stage'',''complete_stage'') THEN
     FOR answer IN SELECT value FROM jsonb_array_elements(normalized_answers) LOOP
       UPDATE public.house_visit_checklist_items SET result=answer->>''result'',reason=answer->>''reason'',
         answered_by_user_id=CASE WHEN answer->>''result''=''pending'' THEN NULL ELSE actor_id END,
         answered_at=CASE WHEN answer->>''result''=''pending'' THEN NULL ELSE occurred_value END
         WHERE run_id=r.id AND stage=stage_value AND item_key=answer->>''key''
           AND (result IS DISTINCT FROM answer->>''result'' OR reason IS DISTINCT FROM answer->>''reason'');
     END LOOP;
   END IF;
   UPDATE public.house_visit_checklist_runs SET revision=gen_random_uuid(),updated_at=server_now,
     responsible_sales_user_id=i.owner_user_id,visit_id=COALESCE(visit_id,v.id),
     current_stage=CASE WHEN command_name=''start_tour'' THEN ''stage_c'' WHEN command_name=''complete_stage'' AND stage_value=''stage_a'' THEN ''stage_b''
       WHEN command_name=''complete_stage'' AND stage_value=''stage_c'' THEN ''completed'' ELSE current_stage END,
     stage_a_completed_at=CASE WHEN command_name=''complete_stage'' AND stage_value=''stage_a'' THEN occurred_value ELSE stage_a_completed_at END,
     stage_b_started_at=CASE WHEN command_name=''start_tour'' THEN occurred_value ELSE stage_b_started_at END,
     stage_c_completed_at=CASE WHEN command_name=''complete_stage'' AND stage_value=''stage_c'' THEN occurred_value ELSE stage_c_completed_at END,
     departed_at=CASE WHEN stage_value=''stage_c'' THEN departed_value ELSE departed_at END,
     recap=CASE WHEN stage_value=''stage_c'' THEN jsonb_build_object(''feedback'',feedback_value,''objections'',objections_value) ELSE recap END,
     next_action_id=CASE WHEN command_name=''complete_stage'' AND stage_value=''stage_c'' THEN next_row.id ELSE next_action_id END,
     next_action=CASE WHEN command_name=''complete_stage'' AND stage_value=''stage_c'' THEN next_row.action_text ELSE next_action END,
     next_follow_up_at=CASE WHEN command_name=''complete_stage'' AND stage_value=''stage_c'' THEN next_row.due_at ELSE next_follow_up_at END
     WHERE id=r.id RETURNING * INTO r;
 END IF;
 SELECT jsonb_agg(to_jsonb(x) ORDER BY x.stage,x.item_key) INTO new_items FROM public.house_visit_checklist_items x WHERE x.run_id=r.id;
 details_value:=jsonb_build_object(''beforeRun'',old_run,''afterRun'',to_jsonb(r),''beforeItems'',old_items,''afterItems'',new_items,
   ''previousResponsibleSalesUserId'',old_run->''responsible_sales_user_id'',''responsibleSalesUserId'',r.responsible_sales_user_id,''nextActionId'',next_row.id);
 INSERT INTO sales_private.visit_sop_events(run_id,command,stage,actor_user_id,reason,occurred_at,recorded_at,details)
   VALUES(r.id,command_name,r.current_stage,actor_id,reason_value,occurred_value,server_now,details_value) RETURNING id INTO event_id_value;
 INSERT INTO public.crm_audit_events(customer_id,entity_type,entity_id,event_type,reason_text,actor_user_id,actor_kind,actor_name_snapshot,old_values,new_values,occurred_at,recorded_at)
   VALUES(c.id,''house_visit_checklist_run'',r.id,''visit_sop_''||command_name,reason_value,actor_id,''staff'',actor_name,
     jsonb_build_object(''responsibleSalesUserId'',old_run->''responsible_sales_user_id'',''stage'',old_run->''current_stage''),
     jsonb_build_object(''eventId'',event_id_value,''interestId'',i.id,''appointmentId'',a.id,''visitId'',v.id,''stage'',r.current_stage,
       ''responsibleSalesUserId'',r.responsible_sales_user_id,''nextActionId'',next_row.id),occurred_value,server_now);
 response_value:=jsonb_build_object(''requestId'',p_request_id,''command'',command_name,''customerId'',c.id,''interestId'',i.id,''runId'',r.id,''runRevision'',r.revision,
   ''stage'',r.current_stage,''appointmentId'',r.appointment_id,''visitId'',r.visit_id,''eventId'',event_id_value,''replayed'',false);
 INSERT INTO sales_private.visit_sop_command_requests(actor_user_id,request_id,request_payload,response,created_at) VALUES(actor_id,p_request_id,p_payload,response_value,server_now);
 DELETE FROM sales_private.visit_sop_write_permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid();
 RETURN response_value;
END;
');
 INSERT INTO customer_source_membership_private.adapters(signature,before_md5,after_md5,settings) VALUES('public.crm_v2_record_visit_sop(uuid,jsonb)','cba1b164c1b89bd754a44a692cb8d50a','37b5472a6ccda6e44101f357228bc2ff',ARRAY['search_path=pg_catalog','TimeZone=UTC']::text[]);
END; $membership_adapter_20$;
DO $membership_adapter_21$
DECLARE d text; b text; owner_name text; secured boolean; settings text[];
BEGIN
 SELECT pg_get_functiondef(oid),replace(prosrc,E'\r\n',E'\n'),pg_get_userbyid(proowner),prosecdef,proconfig INTO d,b,owner_name,secured,settings FROM pg_proc WHERE oid='public.crm_v2_sales_report(text,text,text)'::regprocedure;
 d:=replace(d,E'\r\n',E'\n');
 IF md5(b) IS DISTINCT FROM '0cf579a748838ee9e1e2747473e3eb14' OR owner_name IS DISTINCT FROM current_user OR owner_name IS DISTINCT FROM 'postgres' OR secured IS DISTINCT FROM true OR settings IS DISTINCT FROM ARRAY['search_path=pg_catalog','TimeZone=UTC']::text[] THEN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_ADAPTER_REVIEW_REQUIRED'; END IF;
 IF (length(d)-length(replace(d,b,'')))/NULLIF(length(b),0)<>1 THEN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_DEFINITION_AMBIGUOUS'; END IF;
 EXECUTE replace(d,b,'
DECLARE
  actor_id uuid:=auth.uid(); actor_role text:=public.crm_v2_role();
  from_value date; to_value date; result jsonb;
BEGIN
  IF actor_id IS NULL OR COALESCE(actor_role,'''') NOT IN (''sales'',''admin'',''owner'') THEN
    RAISE EXCEPTION ''CRM_SALES_REPORTS_FORBIDDEN'';
  END IF;
  IF (public.crm_v2_sales_reports_capabilities()->>''enabled'')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION ''CRM_SALES_REPORTS_SETUP_REQUIRED'';
  END IF;
  IF (p_from_date IS NULL)<>(p_to_date IS NULL)
    OR (p_project_name IS NOT NULL AND (length(p_project_name) NOT BETWEEN 1 AND 200
      OR p_project_name ~ U&''[\0001-\001F\007F-\009F\2028\2029]'')) THEN
    RAISE EXCEPTION ''CRM_SALES_REPORTS_INVALID_INPUT'';
  END IF;
  IF p_from_date IS NOT NULL THEN
    IF p_from_date !~ ''^[0-9]{4}-[0-9]{2}-[0-9]{2}$'' OR left(p_from_date,4)=''0000''
      OR p_to_date !~ ''^[0-9]{4}-[0-9]{2}-[0-9]{2}$'' OR left(p_to_date,4)=''0000'' THEN
      RAISE EXCEPTION ''CRM_SALES_REPORTS_INVALID_INPUT'';
    END IF;
    BEGIN from_value:=p_from_date::date; to_value:=p_to_date::date;
    EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN
      RAISE EXCEPTION ''CRM_SALES_REPORTS_INVALID_INPUT'';
    END;
    IF from_value>to_value THEN RAISE EXCEPTION ''CRM_SALES_REPORTS_INVALID_INPUT''; END IF;
  END IF;
  IF (SELECT count(*) FROM public.projects)>1000 THEN RAISE EXCEPTION ''CRM_SALES_REPORTS_SETUP_REQUIRED''; END IF;
  IF p_project_name IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.projects WHERE name=p_project_name) THEN
    RAISE EXCEPTION ''CRM_SALES_REPORTS_NOT_FOUND'';
  END IF;
  -- All mapping/evidence checks run BEFORE any cohort filter. Unknown unlinked
  -- legacy project assignment cannot be hidden by selecting another project.
  -- Unbooked legacy Leads matter to the denominator too. The dependency contract
  -- only guarantees leads.id/phone, so a missing reviewed identity link cannot be
  -- classified into one project: conservatively block ALL report scopes. Neither
  -- a matching phone nor sales_customers.legacy_source_lead_id replaces the
  -- reviewed crm_legacy_lead_links mapping (many legacy IDs may share one identity).
  IF EXISTS(SELECT 1 FROM public.leads legacy
    LEFT JOIN public.crm_legacy_lead_links link ON link.legacy_lead_id=legacy.id
    LEFT JOIN customer_source_membership_private.customers c ON c.id=link.customer_id
    LEFT JOIN customer_source_membership_private.interests i ON i.id=link.project_interest_id
    WHERE customer_source_membership_private.report_requires_legacy_mapping(legacy.id) AND (link.legacy_lead_id IS NULL OR c.id IS NULL OR c.merged_into_customer_id IS NOT NULL
      OR (link.project_interest_id IS NOT NULL AND (i.id IS NULL OR i.customer_id IS DISTINCT FROM link.customer_id)))) THEN
    RAISE EXCEPTION ''CRM_SALES_REPORTS_SETUP_REQUIRED'';
  END IF;
  -- A merge must relink interested-only work as well as bookings before reports
  -- can exclude its old identity. Do not silently lose an orphan interest merely
  -- because no sale exists yet or its original Lead date lies outside the cohort.
  IF EXISTS(SELECT 1 FROM customer_source_membership_private.interests i
    LEFT JOIN customer_source_membership_private.customers c ON c.id=i.customer_id
    WHERE (p_project_name IS NULL OR i.project_name=p_project_name)
      AND (c.id IS NULL OR c.merged_into_customer_id IS NOT NULL)) THEN
    RAISE EXCEPTION ''CRM_SALES_REPORTS_SETUP_REQUIRED'';
  END IF;
  IF EXISTS(SELECT 1 FROM customer_source_membership_private.sales s LEFT JOIN public.plots p ON p.id=s.plot_id
    LEFT JOIN public.projects pr ON pr.name=p.project_name
    WHERE s.project_interest_id IS NULL AND (p_project_name IS NULL OR p.project_name=p_project_name OR p.id IS NULL OR pr.name IS NULL)) THEN
    RAISE EXCEPTION ''CRM_SALES_REPORTS_SETUP_REQUIRED'';
  END IF;
  IF EXISTS(SELECT 1 FROM customer_source_membership_private.sales s
    LEFT JOIN customer_source_membership_private.interests i ON i.id=s.project_interest_id
    LEFT JOIN customer_source_membership_private.customers c ON c.id=i.customer_id
    LEFT JOIN sales_private.crm_user_roles owner_role ON owner_role.user_id=i.owner_user_id
    LEFT JOIN public.plots p ON p.id=s.plot_id
    LEFT JOIN customer_source_membership_private.sales previous ON previous.id=s.previous_sale_id
    WHERE s.project_interest_id IS NOT NULL
      AND (p_project_name IS NULL OR i.id IS NULL OR i.project_name=p_project_name OR p.project_name=p_project_name)
      AND (i.id IS NULL OR c.id IS NULL OR c.merged_into_customer_id IS NOT NULL
        OR owner_role.user_id IS NULL OR owner_role.role<>''sales''
        OR s.crm_stage IS NULL OR s.crm_stage NOT IN (''booked'',''contracted'',''downpayment'',''document_prep'',''loan_submitted'',
          ''loan_rejected'',''loan_approved'',''transfer_pending'',''transferred'',''handover'',''cancelled'')
        OR ((s.booking_round IS NULL OR to_jsonb(s)->>''external_booking_id'' IS NOT NULL OR to_jsonb(s)->>''external_source_stage'' IS NOT NULL)
          AND sales_private.crm_booking_imported_history(to_jsonb(s)) IS NULL)
        OR (s.plot_id IS NOT NULL AND (p.id IS NULL OR p.project_name IS DISTINCT FROM i.project_name))
        OR (s.plot_id IS NULL AND s.crm_stage<>''cancelled'')
        OR (s.previous_sale_id IS NOT NULL AND (previous.id IS NULL
          OR previous.project_interest_id IS DISTINCT FROM s.project_interest_id
          OR previous.crm_stage IS DISTINCT FROM ''cancelled'' OR previous.booking_round>=s.booking_round))
        OR (s.booked_at IS NOT NULL AND (NOT isfinite(s.booked_at)
          OR s.booked_at<TIMESTAMPTZ ''0001-01-01 00:00:00+00'' OR s.booked_at>=TIMESTAMPTZ ''10000-01-01 00:00:00+00''))
        OR (s.cancelled_at IS NOT NULL AND (NOT isfinite(s.cancelled_at)
          OR s.cancelled_at<TIMESTAMPTZ ''0001-01-01 00:00:00+00'' OR s.cancelled_at>=TIMESTAMPTZ ''10000-01-01 00:00:00+00''))
        OR (s.sale_price IS NOT NULL AND (s.sale_price<0 OR s.sale_price::text IN (''NaN'',''Infinity'',''-Infinity''))))) THEN
    RAISE EXCEPTION ''CRM_SALES_REPORTS_SETUP_REQUIRED'';
  END IF;
  IF EXISTS(SELECT 1 FROM customer_source_membership_private.customers c WHERE c.merged_into_customer_id IS NULL
    AND (p_project_name IS NULL OR EXISTS(SELECT 1 FROM customer_source_membership_private.interests i WHERE i.customer_id=c.id AND i.project_name=p_project_name))
    AND c.lead_created_at IS NOT NULL AND (NOT isfinite(c.lead_created_at)
      OR (c.lead_created_at AT TIME ZONE ''Asia/Bangkok'')::date<DATE ''0001-01-01''
      OR (c.lead_created_at AT TIME ZONE ''Asia/Bangkok'')::date>DATE ''9999-12-31'')) THEN
    RAISE EXCEPTION ''CRM_SALES_REPORTS_SETUP_REQUIRED'';
  END IF;
  -- Distinct customer identity first; joining interests directly into this count
  -- would overcount customers who are interested in several registered projects.
  WITH scope_customers AS (
    SELECT c.id,c.lead_created_at FROM customer_source_membership_private.customers c WHERE c.merged_into_customer_id IS NULL
      AND (p_project_name IS NULL OR EXISTS(SELECT 1 FROM customer_source_membership_private.interests i WHERE i.customer_id=c.id AND i.project_name=p_project_name))
  ), cohort_customers AS (
    SELECT * FROM scope_customers WHERE from_value IS NULL
      OR (lead_created_at AT TIME ZONE ''Asia/Bangkok'')::date BETWEEN from_value AND to_value
  ), cohort_interests AS (
    SELECT i.id FROM customer_source_membership_private.interests i JOIN cohort_customers c ON c.id=i.customer_id
      WHERE p_project_name IS NULL OR i.project_name=p_project_name
  ), cohort_sales AS (
    SELECT s.crm_stage,sales_private.crm_effective_sale_price(s.id) AS sale_price,s.booked_at,s.cancelled_at FROM customer_source_membership_private.sales s
      JOIN cohort_interests i ON i.id=s.project_interest_id
  )
  SELECT jsonb_build_object(''actor'',jsonb_build_object(''userId'',actor_id,''role'',actor_role),
    ''projectName'',p_project_name,''fromDate'',p_from_date,''toDate'',p_to_date,
    ''projects'',COALESCE((SELECT jsonb_agg(jsonb_build_object(''name'',name) ORDER BY name) FROM public.projects),''[]''::jsonb),
    ''totals'',jsonb_build_object(
      ''customers'',(SELECT count(*) FROM cohort_customers),''interests'',(SELECT count(*) FROM cohort_interests),
      ''bookingRounds'',(SELECT count(*) FROM cohort_sales),''cancelledRounds'',(SELECT count(*) FROM cohort_sales WHERE crm_stage=''cancelled''),
      ''netBookedHomes'',(SELECT count(*) FROM cohort_sales WHERE crm_stage<>''cancelled''),
      ''inProgress'',(SELECT count(*) FROM cohort_sales WHERE crm_stage NOT IN (''cancelled'',''transferred'',''handover'')),
      ''transferred'',(SELECT count(*) FROM cohort_sales WHERE crm_stage IN (''transferred'',''handover'')),
      ''knownNetSaleValue'',(SELECT round(COALESCE(sum(sale_price) FILTER(WHERE crm_stage<>''cancelled''),0),2)::text FROM cohort_sales),
      ''unknownNetSaleValueCount'',(SELECT count(*) FROM cohort_sales WHERE crm_stage<>''cancelled'' AND sale_price IS NULL),
      ''unknownBookedAtRounds'',(SELECT count(*) FROM cohort_sales WHERE booked_at IS NULL),
      ''unknownCancelledAtRounds'',(SELECT count(*) FROM cohort_sales WHERE crm_stage=''cancelled'' AND cancelled_at IS NULL)),
    ''stageCounts'',(SELECT jsonb_object_agg(stage,(SELECT count(*) FROM cohort_sales s WHERE s.crm_stage=stage)) FROM
      unnest(ARRAY[''booked'',''contracted'',''downpayment'',''document_prep'',''loan_submitted'',''loan_rejected'',''loan_approved'',
        ''transfer_pending'',''transferred'',''handover'',''cancelled'']) stage),
    ''coverage'',jsonb_build_object(''unknownLeadDateCustomers'',(SELECT count(*) FROM scope_customers WHERE lead_created_at IS NULL),
      ''excludedUnknownLeadDateCustomers'',CASE WHEN from_value IS NULL THEN 0 ELSE (SELECT count(*) FROM scope_customers WHERE lead_created_at IS NULL) END))
    INTO result;
  RETURN result;
END;
');
 INSERT INTO customer_source_membership_private.adapters(signature,before_md5,after_md5,settings) VALUES('public.crm_v2_sales_report(text,text,text)','0cf579a748838ee9e1e2747473e3eb14','fd66a501d2ae3c110944f83236297620',ARRAY['search_path=pg_catalog','TimeZone=UTC']::text[]);
END; $membership_adapter_21$;
DO $membership_adapter_22$
DECLARE d text; b text; owner_name text; secured boolean; settings text[];
BEGIN
 SELECT pg_get_functiondef(oid),replace(prosrc,E'\r\n',E'\n'),pg_get_userbyid(proowner),prosecdef,proconfig INTO d,b,owner_name,secured,settings FROM pg_proc WHERE oid='public.crm_v2_visit_follow_up_command(uuid,jsonb)'::regprocedure;
 d:=replace(d,E'\r\n',E'\n');
 IF md5(b) IS DISTINCT FROM '1603a020429bd3a071e27747b2708e60' OR owner_name IS DISTINCT FROM current_user OR owner_name IS DISTINCT FROM 'postgres' OR secured IS DISTINCT FROM true OR settings IS DISTINCT FROM ARRAY['search_path=pg_catalog','TimeZone=UTC']::text[] THEN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_ADAPTER_REVIEW_REQUIRED'; END IF;
 IF (length(d)-length(replace(d,b,'')))/NULLIF(length(b),0)<>1 THEN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_DEFINITION_AMBIGUOUS'; END IF;
 EXECUTE replace(d,b,'
DECLARE actor_id uuid:=auth.uid(); customer_id_value uuid; interest_id_value uuid;
  owner_id uuid; actor_role text; enabled boolean;
BEGIN
 PERFORM customer_source_membership_private.assert_payload(p_payload);
  IF actor_id IS NULL OR public.crm_v2_role() IS DISTINCT FROM ''sales'' THEN RAISE EXCEPTION ''CRM_WORK_FORBIDDEN''; END IF;
  SELECT central_intake_enabled AND lead_work_enabled AND lead_lifecycle_enabled
    AND visits_enabled AND visit_sop_enabled INTO enabled FROM public.crm_settings WHERE id FOR SHARE;
  IF enabled IS DISTINCT FROM true THEN RAISE EXCEPTION ''CRM_WORK_SETUP_REQUIRED''; END IF;
  IF p_request_id IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM ''object''
    OR octet_length(p_payload::text)>16384 OR p_payload->>''command'' IS DISTINCT FROM ''set_next_action''
    OR jsonb_typeof(p_payload->''customerId'') IS DISTINCT FROM ''string''
    OR jsonb_typeof(p_payload->''interestId'') IS DISTINCT FROM ''string''
    OR (p_payload->>''customerId'') !~ ''^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$''
    OR (p_payload->>''interestId'') !~ ''^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'' THEN
    RAISE EXCEPTION ''CRM_WORK_INVALID_INPUT'';
  END IF;
  customer_id_value:=(p_payload->>''customerId'')::uuid; interest_id_value:=(p_payload->>''interestId'')::uuid;
  -- Same request/scope/role lock order as the delegated writer. Rechecking owner
  -- before delegation also prevents replay by a former owner or an Admin.
  PERFORM pg_advisory_xact_lock(hashtextextended(''lead-work:''||actor_id::text||'':''||p_request_id::text,0));
  PERFORM 1 FROM customer_source_membership_private.customers WHERE id=customer_id_value FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION ''CRM_WORK_NOT_FOUND''; END IF;
  SELECT owner_user_id INTO owner_id FROM customer_source_membership_private.interests
    WHERE id=interest_id_value AND customer_id=customer_id_value FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION ''CRM_WORK_NOT_FOUND''; END IF;
  IF owner_id IS DISTINCT FROM actor_id THEN RAISE EXCEPTION ''CRM_WORK_FORBIDDEN''; END IF;
  SELECT role INTO actor_role FROM sales_private.crm_user_roles WHERE user_id=actor_id AND is_active FOR SHARE;
  IF actor_role IS DISTINCT FROM ''sales'' THEN RAISE EXCEPTION ''CRM_WORK_FORBIDDEN''; END IF;
  RETURN public.crm_v2_record_lead_work(p_request_id,p_payload);
END;
');
 INSERT INTO customer_source_membership_private.adapters(signature,before_md5,after_md5,settings) VALUES('public.crm_v2_visit_follow_up_command(uuid,jsonb)','1603a020429bd3a071e27747b2708e60','a2051f2539b73825f7c517cdbe1e8593',ARRAY['search_path=pg_catalog','TimeZone=UTC']::text[]);
END; $membership_adapter_22$;
DO $membership_adapter_23$
DECLARE d text; b text; owner_name text; secured boolean; settings text[];
BEGIN
 SELECT pg_get_functiondef(oid),replace(prosrc,E'\r\n',E'\n'),pg_get_userbyid(proowner),prosecdef,proconfig INTO d,b,owner_name,secured,settings FROM pg_proc WHERE oid='public.crm_v2_visit_sop_context(uuid,uuid,uuid,uuid,integer)'::regprocedure;
 d:=replace(d,E'\r\n',E'\n');
 IF md5(b) IS DISTINCT FROM '887578fb586f1fd945368ef9511db229' OR owner_name IS DISTINCT FROM current_user OR owner_name IS DISTINCT FROM 'postgres' OR secured IS DISTINCT FROM true OR settings IS DISTINCT FROM ARRAY['search_path=pg_catalog','TimeZone=UTC']::text[] THEN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_ADAPTER_REVIEW_REQUIRED'; END IF;
 IF (length(d)-length(replace(d,b,'')))/NULLIF(length(b),0)<>1 THEN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_DEFINITION_AMBIGUOUS'; END IF;
 EXECUTE replace(d,b,'
DECLARE
 actor_id uuid:=auth.uid(); actor_role text:=public.crm_v2_role();
 c public.sales_customers%ROWTYPE; i public.lead_project_interests%ROWTYPE; a public.lead_appointments%ROWTYPE; v public.lead_visits%ROWTYPE;
 r public.house_visit_checklist_runs%ROWTYPE; next_row public.crm_next_actions%ROWTYPE;
 plots_json jsonb; plots_more boolean; items_json jsonb; events_json jsonb; events_more boolean; run_json jsonb; matches integer; anchor_live boolean;
BEGIN
 IF actor_id IS NULL OR COALESCE(actor_role,'''') NOT IN (''sales'',''admin'',''owner'') THEN RAISE EXCEPTION ''CRM_SOP_FORBIDDEN''; END IF;
 IF (public.crm_v2_visit_sop_capabilities()->>''enabled'')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION ''CRM_SOP_SETUP_REQUIRED''; END IF;
 IF p_customer_id IS NULL OR p_interest_id IS NULL OR (p_appointment_id IS NULL)=(p_visit_id IS NULL)
   OR p_event_page IS NULL OR p_event_page NOT BETWEEN 0 AND 100000 THEN RAISE EXCEPTION ''CRM_SOP_INVALID_INPUT''; END IF;
 SELECT * INTO c FROM customer_source_membership_private.customers WHERE id=p_customer_id;
 IF NOT FOUND THEN RAISE EXCEPTION ''CRM_SOP_NOT_FOUND''; END IF;
 SELECT * INTO i FROM customer_source_membership_private.interests WHERE id=p_interest_id AND customer_id=c.id;
 IF NOT FOUND THEN RAISE EXCEPTION ''CRM_SOP_NOT_FOUND''; END IF;
 IF p_visit_id IS NOT NULL THEN
   SELECT * INTO v FROM public.lead_visits WHERE id=p_visit_id AND project_interest_id=i.id;
   IF NOT FOUND THEN RAISE EXCEPTION ''CRM_SOP_NOT_FOUND''; END IF;
   IF v.appointment_id IS NOT NULL THEN SELECT * INTO a FROM public.lead_appointments WHERE id=v.appointment_id AND project_interest_id=i.id; END IF;
 ELSE
   SELECT * INTO a FROM public.lead_appointments WHERE id=p_appointment_id AND project_interest_id=i.id;
   IF NOT FOUND THEN RAISE EXCEPTION ''CRM_SOP_NOT_FOUND''; END IF;
   SELECT * INTO v FROM public.lead_visits WHERE appointment_id=a.id AND project_interest_id=i.id;
 END IF;
 SELECT count(*) INTO matches FROM public.house_visit_checklist_runs WHERE project_interest_id=i.id
   AND ((a.id IS NOT NULL AND appointment_id=a.id) OR (v.id IS NOT NULL AND visit_id=v.id));
 IF matches>1 THEN RAISE EXCEPTION ''CRM_SOP_SETUP_REQUIRED''; END IF;
 SELECT * INTO r FROM public.house_visit_checklist_runs WHERE project_interest_id=i.id
   AND ((a.id IS NOT NULL AND appointment_id=a.id) OR (v.id IS NOT NULL AND visit_id=v.id));
 IF r.id IS NOT NULL THEN
   IF r.template_version<>''house_visit_v1'' OR (SELECT count(*) FROM public.house_visit_checklist_items WHERE run_id=r.id)<>29
     OR EXISTS(SELECT 1 FROM sales_private.crm_sop_template() t WHERE NOT EXISTS(SELECT 1 FROM public.house_visit_checklist_items x WHERE x.run_id=r.id AND x.stage=t.stage AND x.item_key=t.item_key AND x.item_label_snapshot=t.label)) THEN RAISE EXCEPTION ''CRM_SOP_SETUP_REQUIRED''; END IF;
   SELECT jsonb_agg(jsonb_build_object(''stage'',x.stage,''key'',x.item_key,''label'',x.item_label_snapshot,''result'',x.result,''reason'',x.reason,
     ''answeredByUserId'',x.answered_by_user_id,''answeredAt'',x.answered_at) ORDER BY t.ordinal) INTO items_json
     FROM public.house_visit_checklist_items x JOIN sales_private.crm_sop_template() t ON t.stage=x.stage AND t.item_key=x.item_key WHERE x.run_id=r.id;
   run_json:=jsonb_build_object(''id'',r.id,''revision'',r.revision,''plotId'',r.plot_id,''responsibleSalesUserId'',r.responsible_sales_user_id,
     ''templateVersion'',r.template_version,''currentStage'',r.current_stage,''stageACompletedAt'',r.stage_a_completed_at,''stageBStartedAt'',r.stage_b_started_at,
     ''stageCCompletedAt'',r.stage_c_completed_at,''departedAt'',r.departed_at,''recap'',jsonb_build_object(''feedback'',COALESCE(r.recap->>''feedback'',''''),''objections'',COALESCE(r.recap->>''objections'','''')),
     ''nextAction'',r.next_action,''nextFollowUpAt'',r.next_follow_up_at,''items'',items_json,''createdAt'',r.created_at,''updatedAt'',r.updated_at);
 END IF;
 WITH rows AS(SELECT id FROM public.plots WHERE project_name=i.project_name ORDER BY id LIMIT 201),
 numbered AS(SELECT *,row_number() OVER(ORDER BY id) rn FROM rows)
 SELECT COALESCE(jsonb_agg(jsonb_build_object(''id'',id,''name'',id) ORDER BY id) FILTER(WHERE rn<=200),''[]''::jsonb),count(*)>200 INTO plots_json,plots_more FROM numbered;
 WITH rows AS(SELECT * FROM sales_private.visit_sop_events WHERE run_id=r.id ORDER BY recorded_at DESC,id DESC LIMIT 51 OFFSET p_event_page*50),
 numbered AS(SELECT *,row_number() OVER(ORDER BY recorded_at DESC,id DESC) rn FROM rows)
 SELECT COALESCE(jsonb_agg(jsonb_build_object(''id'',id,''command'',command,''stage'',stage,''occurredAt'',occurred_at,''recordedAt'',recorded_at,
   ''actorUserId'',actor_user_id,''reason'',reason) ORDER BY recorded_at DESC,id DESC) FILTER(WHERE rn<=50),''[]''::jsonb),count(*)>50 INTO events_json,events_more FROM numbered;
 SELECT * INTO next_row FROM public.crm_next_actions WHERE project_interest_id=i.id AND customer_id=c.id AND status=''open'';
 anchor_live:=(a.id IS NULL OR a.status IN (''scheduled'',''rescheduled'') OR (a.status=''attended'' AND v.id IS NOT NULL))
   AND (v.id IS NULL OR v.status IN (''awaiting_voice'',''completed''));
 RETURN jsonb_build_object(''actor'',jsonb_build_object(''userId'',actor_id,''role'',actor_role),
   ''scope'',jsonb_build_object(''customerId'',c.id,''customerName'',c.customer_name,''interestId'',i.id,''appointmentId'',p_appointment_id,''visitId'',p_visit_id,
     ''projectName'',i.project_name,''ownerUserId'',i.owner_user_id,''interestRevision'',i.lifecycle_revision,''engagementStatus'',i.engagement_status,
     ''canWrite'',actor_role=''sales'' AND actor_id=i.owner_user_id AND c.merged_into_customer_id IS NULL AND i.engagement_status<>''lost''
       AND anchor_live AND COALESCE(r.current_stage<>''completed'',true)
       AND EXISTS(SELECT 1 FROM sales_private.crm_user_roles WHERE user_id=i.owner_user_id AND role=''sales'' AND is_active)),
   ''anchor'',jsonb_build_object(''appointmentStatus'',a.status,''visitId'',v.id,''visitStatus'',v.status,''checkedInAt'',v.checked_in_at),
   ''plots'',plots_json,''plotsHasMore'',plots_more,''run'',run_json,
   ''nextAction'',CASE WHEN next_row.id IS NULL THEN NULL ELSE jsonb_build_object(''id'',next_row.id,''action'',next_row.action_text,''dueAt'',next_row.due_at) END,
   ''events'',events_json,''eventPage'',p_event_page,''eventsHasMore'',events_more);
END;
');
 INSERT INTO customer_source_membership_private.adapters(signature,before_md5,after_md5,settings) VALUES('public.crm_v2_visit_sop_context(uuid,uuid,uuid,uuid,integer)','887578fb586f1fd945368ef9511db229','0f6484f14d36025bf3333cfb6b0f3b4e',ARRAY['search_path=pg_catalog','TimeZone=UTC']::text[]);
END; $membership_adapter_23$;
DO $membership_adapter_24$
DECLARE d text; b text; owner_name text; secured boolean; settings text[];
BEGIN
 SELECT pg_get_functiondef(oid),replace(prosrc,E'\r\n',E'\n'),pg_get_userbyid(proowner),prosecdef,proconfig INTO d,b,owner_name,secured,settings FROM pg_proc WHERE oid='public.crm_v2_visits_command(uuid,jsonb)'::regprocedure;
 d:=replace(d,E'\r\n',E'\n');
 IF md5(b) IS DISTINCT FROM 'c4bc31c0053e32c89ad44af58adc090a' OR owner_name IS DISTINCT FROM current_user OR owner_name IS DISTINCT FROM 'postgres' OR secured IS DISTINCT FROM true OR settings IS DISTINCT FROM ARRAY['search_path=pg_catalog','TimeZone=UTC']::text[] THEN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_ADAPTER_REVIEW_REQUIRED'; END IF;
 IF (length(d)-length(replace(d,b,'')))/NULLIF(length(b),0)<>1 THEN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_DEFINITION_AMBIGUOUS'; END IF;
 EXECUTE replace(d,b,'
DECLARE
  actor_id uuid:=auth.uid(); actor_role text:=public.crm_v2_role(); actor_name text; owner_active boolean:=false;
  command_name text; allowed_keys text[]; reason_value text; enabled boolean;
  customer_id_value uuid; interest_id_value uuid; expected_interest uuid; appointment_id_value uuid; expected_appointment uuid;
  visit_id_value uuid; expected_visit uuid; event_id_value uuid; response_value jsonb; details_value jsonb;
  starts_value timestamptz; ends_value timestamptz; occurred_value timestamptz; latest_event_time timestamptz; server_now timestamptz;
  c public.sales_customers%ROWTYPE; i public.lead_project_interests%ROWTYPE; a public.lead_appointments%ROWTYPE; v public.lead_visits%ROWTYPE;
  role_row sales_private.crm_user_roles%ROWTYPE; receipt sales_private.visits_command_requests%ROWTYPE;
BEGIN
 PERFORM customer_source_membership_private.assert_payload(p_payload);
  IF actor_id IS NULL OR COALESCE(actor_role,'''') NOT IN (''sales'',''admin'') THEN RAISE EXCEPTION ''CRM_VISITS_FORBIDDEN''; END IF;
  SELECT central_intake_enabled AND lead_work_enabled AND lead_lifecycle_enabled AND visits_enabled INTO enabled FROM public.crm_settings WHERE id FOR SHARE;
  IF enabled IS DISTINCT FROM true THEN RAISE EXCEPTION ''CRM_VISITS_SETUP_REQUIRED''; END IF;
  IF p_request_id IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM ''object'' OR octet_length(p_payload::text)>16384
    OR jsonb_typeof(p_payload->''command'') IS DISTINCT FROM ''string'' THEN RAISE EXCEPTION ''CRM_VISITS_INVALID_INPUT''; END IF;
  command_name:=p_payload->>''command'';
  allowed_keys:=ARRAY[''command'',''customerId'',''interestId'',''expectedInterestRevision'',''reason'',''occurredAt'']||CASE command_name
    WHEN ''schedule'' THEN ARRAY[''startsAt'',''endsAt''] WHEN ''reschedule'' THEN ARRAY[''appointmentId'',''expectedAppointmentRevision'',''startsAt'',''endsAt'']
    WHEN ''cancel_appointment'' THEN ARRAY[''appointmentId'',''expectedAppointmentRevision''] WHEN ''no_show'' THEN ARRAY[''appointmentId'',''expectedAppointmentRevision'']
    WHEN ''check_in'' THEN ARRAY[''appointmentId'',''expectedAppointmentRevision''] WHEN ''cancel_visit'' THEN ARRAY[''visitId'',''expectedVisitRevision''] ELSE NULL END;
  IF command_name NOT IN (''schedule'',''reschedule'',''cancel_appointment'',''no_show'',''check_in'',''cancel_visit'')
    OR allowed_keys IS NULL OR NOT(p_payload ?& allowed_keys) OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE NOT(k=ANY(allowed_keys)))
    OR jsonb_typeof(p_payload->''reason'') IS DISTINCT FROM ''string'' OR jsonb_typeof(p_payload->''occurredAt'') IS DISTINCT FROM ''string'' THEN
    RAISE EXCEPTION ''CRM_VISITS_INVALID_INPUT''; END IF;
  BEGIN
    customer_id_value:=sales_private.crm_visits_uuid(p_payload->''customerId''); interest_id_value:=sales_private.crm_visits_uuid(p_payload->''interestId'');
    expected_interest:=sales_private.crm_visits_uuid(p_payload->''expectedInterestRevision''); reason_value:=sales_private.crm_work_text(p_payload->>''reason'',1000);
    occurred_value:=sales_private.crm_work_timestamp(p_payload->>''occurredAt'');
    IF command_name IN (''schedule'',''reschedule'') THEN
      IF jsonb_typeof(p_payload->''startsAt'') IS DISTINCT FROM ''string'' OR jsonb_typeof(p_payload->''endsAt'') NOT IN (''string'',''null'') THEN
        RAISE EXCEPTION ''CRM_VISITS_INVALID_INPUT''; END IF;
      starts_value:=sales_private.crm_work_timestamp(p_payload->>''startsAt'');
      IF p_payload->''endsAt''<>''null''::jsonb THEN ends_value:=sales_private.crm_work_timestamp(p_payload->>''endsAt''); END IF;
    END IF;
    IF command_name IN (''reschedule'',''cancel_appointment'',''no_show'',''check_in'') THEN
      appointment_id_value:=sales_private.crm_visits_uuid(p_payload->''appointmentId'',command_name=''check_in'');
      expected_appointment:=sales_private.crm_visits_uuid(p_payload->''expectedAppointmentRevision'',command_name=''check_in'');
      IF (appointment_id_value IS NULL)<>(expected_appointment IS NULL) THEN RAISE EXCEPTION ''CRM_VISITS_INVALID_INPUT''; END IF;
    ELSIF command_name=''cancel_visit'' THEN
      visit_id_value:=sales_private.crm_visits_uuid(p_payload->''visitId''); expected_visit:=sales_private.crm_visits_uuid(p_payload->''expectedVisitRevision'');
    END IF;
  EXCEPTION WHEN raise_exception THEN RAISE EXCEPTION ''CRM_VISITS_INVALID_INPUT''; END;
  IF occurred_value<TIMESTAMPTZ ''0001-01-01 00:00:00+00'' OR occurred_value>=TIMESTAMPTZ ''10000-01-01 00:00:00+00''
    OR starts_value<TIMESTAMPTZ ''0001-01-01 00:00:00+00'' OR starts_value>=TIMESTAMPTZ ''10000-01-01 00:00:00+00''
    OR ends_value<TIMESTAMPTZ ''0001-01-01 00:00:00+00'' OR ends_value>=TIMESTAMPTZ ''10000-01-01 00:00:00+00''
    OR ends_value<=starts_value THEN RAISE EXCEPTION ''CRM_VISITS_INVALID_INPUT''; END IF;

  -- Same customer -> interest -> ordered roles ordering as 04/05/18. Private
  -- request lock prevents same actor/request racing across two customer scopes.
  PERFORM pg_advisory_xact_lock(hashtextextended(''visits:''||actor_id::text||'':''||p_request_id::text,0));
  SELECT * INTO c FROM customer_source_membership_private.customers WHERE id=customer_id_value FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION ''CRM_VISITS_NOT_FOUND''; END IF;
  SELECT * INTO i FROM customer_source_membership_private.interests WHERE id=interest_id_value AND customer_id=customer_id_value FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION ''CRM_VISITS_NOT_FOUND''; END IF;
  actor_role:=NULL;
  FOR role_row IN SELECT * FROM sales_private.crm_user_roles WHERE user_id IN(actor_id,i.owner_user_id) ORDER BY user_id FOR SHARE LOOP
    IF role_row.user_id=actor_id AND role_row.is_active THEN actor_role:=role_row.role; actor_name:=role_row.display_name; END IF;
    IF role_row.user_id=i.owner_user_id THEN owner_active:=role_row.is_active AND role_row.role=''sales''; END IF;
  END LOOP;
  IF COALESCE(actor_role,'''') NOT IN (''sales'',''admin'') OR (actor_role=''sales'' AND actor_id<>i.owner_user_id) OR NOT owner_active THEN
    RAISE EXCEPTION ''CRM_VISITS_FORBIDDEN''; END IF;
  SELECT * INTO receipt FROM sales_private.visits_command_requests WHERE actor_user_id=actor_id AND request_id=p_request_id;
  IF FOUND THEN
    IF receipt.request_payload IS DISTINCT FROM p_payload THEN RAISE EXCEPTION ''CRM_VISITS_IDEMPOTENCY_CONFLICT''; END IF;
    RETURN receipt.response||jsonb_build_object(''replayed'',true);
  END IF;
  IF c.merged_into_customer_id IS NOT NULL OR i.engagement_status=''lost'' THEN RAISE EXCEPTION ''CRM_VISITS_SCOPE_CLOSED''; END IF;
  IF i.lifecycle_revision IS DISTINCT FROM expected_interest THEN RAISE EXCEPTION ''CRM_VISITS_STALE_STATE''; END IF;
  IF command_name=''cancel_visit'' THEN
    SELECT appointment_id INTO appointment_id_value FROM public.lead_visits WHERE id=visit_id_value AND project_interest_id=i.id;
    IF NOT FOUND THEN RAISE EXCEPTION ''CRM_VISITS_NOT_FOUND''; END IF;
  END IF;
  IF appointment_id_value IS NOT NULL THEN
    SELECT * INTO a FROM public.lead_appointments WHERE id=appointment_id_value AND project_interest_id=i.id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION ''CRM_VISITS_NOT_FOUND''; END IF;
    IF command_name<>''cancel_visit'' AND a.revision IS DISTINCT FROM expected_appointment THEN RAISE EXCEPTION ''CRM_VISITS_STALE_STATE''; END IF;
    IF command_name<>''cancel_visit'' AND a.status NOT IN (''scheduled'',''rescheduled'') THEN RAISE EXCEPTION ''CRM_VISITS_CONFLICT''; END IF;
  END IF;
  IF visit_id_value IS NOT NULL THEN
    SELECT * INTO v FROM public.lead_visits WHERE id=visit_id_value AND project_interest_id=i.id FOR UPDATE;
    IF NOT FOUND OR v.appointment_id IS DISTINCT FROM appointment_id_value THEN RAISE EXCEPTION ''CRM_VISITS_NOT_FOUND''; END IF;
    IF v.revision IS DISTINCT FROM expected_visit THEN RAISE EXCEPTION ''CRM_VISITS_STALE_STATE''; END IF;
    IF v.status<>''awaiting_voice'' THEN RAISE EXCEPTION ''CRM_VISITS_CONFLICT''; END IF;
  END IF;
  SELECT max(occurred_at) INTO latest_event_time FROM sales_private.visits_events WHERE project_interest_id=i.id;
  server_now:=clock_timestamp();
  IF (c.lead_created_at IS NOT NULL AND NOT isfinite(c.lead_created_at))
    OR (a.id IS NOT NULL AND (NOT isfinite(a.created_at) OR NOT isfinite(a.starts_at)))
    OR (v.id IS NOT NULL AND NOT isfinite(v.checked_in_at)) THEN RAISE EXCEPTION ''CRM_VISITS_SETUP_REQUIRED''; END IF;
  IF occurred_value>server_now OR occurred_value<c.lead_created_at OR occurred_value<latest_event_time
    OR occurred_value<a.created_at OR occurred_value<v.checked_in_at OR occurred_value<v.created_at
    OR (command_name=''no_show'' AND occurred_value<a.starts_at)
    OR (command_name IN (''schedule'',''reschedule'') AND starts_value<server_now) THEN RAISE EXCEPTION ''CRM_VISITS_INVALID_INPUT''; END IF;
  IF command_name=''check_in'' AND appointment_id_value IS NOT NULL AND EXISTS(SELECT 1 FROM public.lead_visits WHERE appointment_id=appointment_id_value) THEN
    RAISE EXCEPTION ''CRM_VISITS_CONFLICT''; END IF;

  INSERT INTO sales_private.visits_write_permits VALUES(txid_current(),pg_backend_pid());
  IF command_name=''schedule'' THEN
    INSERT INTO public.lead_appointments(project_interest_id,starts_at,ends_at,assigned_sales_user_id,created_at,updated_at)
      VALUES(i.id,starts_value,ends_value,i.owner_user_id,server_now,server_now) RETURNING * INTO a;
    details_value:=jsonb_build_object(''startsAt'',a.starts_at,''endsAt'',a.ends_at,''status'',a.status);
  ELSIF command_name=''reschedule'' THEN
    details_value:=jsonb_build_object(''previousStartsAt'',a.starts_at,''previousEndsAt'',a.ends_at,''previousStatus'',a.status,
      ''startsAt'',starts_value,''endsAt'',ends_value,''status'',''rescheduled'');
    UPDATE public.lead_appointments SET starts_at=starts_value,ends_at=ends_value,status=''rescheduled'',assigned_sales_user_id=i.owner_user_id,
      revision=gen_random_uuid(),updated_at=server_now WHERE id=a.id RETURNING * INTO a;
  ELSIF command_name IN (''cancel_appointment'',''no_show'') THEN
    details_value:=jsonb_build_object(''previousStatus'',a.status,''status'',CASE command_name WHEN ''no_show'' THEN ''no_show'' ELSE ''cancelled'' END);
    UPDATE public.lead_appointments SET status=details_value->>''status'',revision=gen_random_uuid(),updated_at=server_now WHERE id=a.id RETURNING * INTO a;
  ELSIF command_name=''check_in'' THEN
    INSERT INTO public.lead_visits(project_interest_id,appointment_id,checked_in_at,checked_in_by_user_id,created_at)
      VALUES(i.id,a.id,occurred_value,actor_id,server_now) RETURNING * INTO v;
    details_value:=jsonb_build_object(''previousStatus'',NULL,''status'',''awaiting_voice'');
    IF a.id IS NOT NULL THEN
      UPDATE public.lead_appointments SET status=''attended'',revision=gen_random_uuid(),updated_at=server_now WHERE id=a.id RETURNING * INTO a;
    END IF;
  ELSIF command_name=''cancel_visit'' THEN
    details_value:=jsonb_build_object(''previousStatus'',v.status,''status'',''cancelled'');
    UPDATE public.lead_visits SET status=''cancelled'',revision=gen_random_uuid() WHERE id=v.id RETURNING * INTO v;
    -- Attended appointment remains attended. A replacement is a new appointment/
    -- walk-in Visit; this historical row cannot manufacture a second attendance.
  END IF;
  INSERT INTO sales_private.visits_events(customer_id,project_interest_id,command,appointment_id,visit_id,actor_user_id,reason,occurred_at,recorded_at,details)
    VALUES(c.id,i.id,command_name,a.id,v.id,actor_id,reason_value,occurred_value,server_now,details_value) RETURNING id INTO event_id_value;
  INSERT INTO public.crm_audit_events(customer_id,entity_type,entity_id,event_type,reason_text,actor_user_id,actor_kind,actor_name_snapshot,new_values,occurred_at,recorded_at)
    VALUES(c.id,CASE WHEN v.id IS NULL THEN ''lead_appointment'' ELSE ''lead_visit'' END,COALESCE(v.id,a.id),''visits_''||command_name,
      reason_value,actor_id,''staff'',actor_name,jsonb_build_object(''interestId'',i.id,''appointmentId'',a.id,''visitId'',v.id,''eventId'',event_id_value,''details'',details_value),occurred_value,server_now);
  response_value:=jsonb_build_object(''requestId'',p_request_id,''command'',command_name,''customerId'',c.id,''interestId'',i.id,
    ''appointmentId'',a.id,''appointmentRevision'',a.revision,''visitId'',v.id,''visitRevision'',v.revision,''eventId'',event_id_value,''replayed'',false);
  INSERT INTO sales_private.visits_command_requests(actor_user_id,request_id,request_payload,response,created_at) VALUES(actor_id,p_request_id,p_payload,response_value,server_now);
  DELETE FROM sales_private.visits_write_permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid();
  RETURN response_value;
END;
');
 INSERT INTO customer_source_membership_private.adapters(signature,before_md5,after_md5,settings) VALUES('public.crm_v2_visits_command(uuid,jsonb)','c4bc31c0053e32c89ad44af58adc090a','3c8516e8ad924e0a588d6db729f3a9c9',ARRAY['search_path=pg_catalog','TimeZone=UTC']::text[]);
END; $membership_adapter_24$;
DO $membership_adapter_25$
DECLARE d text; b text; owner_name text; secured boolean; settings text[];
BEGIN
 SELECT pg_get_functiondef(oid),replace(prosrc,E'\r\n',E'\n'),pg_get_userbyid(proowner),prosecdef,proconfig INTO d,b,owner_name,secured,settings FROM pg_proc WHERE oid='public.crm_v2_visits_context(uuid,uuid,integer,integer,integer)'::regprocedure;
 d:=replace(d,E'\r\n',E'\n');
 IF md5(b) IS DISTINCT FROM '5738680eeda1f34b743316fd5167851b' OR owner_name IS DISTINCT FROM current_user OR owner_name IS DISTINCT FROM 'postgres' OR secured IS DISTINCT FROM true OR settings IS DISTINCT FROM ARRAY['search_path=pg_catalog','TimeZone=UTC']::text[] THEN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_ADAPTER_REVIEW_REQUIRED'; END IF;
 IF (length(d)-length(replace(d,b,'')))/NULLIF(length(b),0)<>1 THEN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_DEFINITION_AMBIGUOUS'; END IF;
 EXECUTE replace(d,b,'
DECLARE
  actor_id uuid:=auth.uid(); actor_role text:=public.crm_v2_role();
  c public.sales_customers%ROWTYPE; i public.lead_project_interests%ROWTYPE;
  appointments_json jsonb; visits_json jsonb; events_json jsonb;
  appointments_more boolean; visits_more boolean; events_more boolean;
BEGIN
  IF actor_id IS NULL OR COALESCE(actor_role,'''') NOT IN (''sales'',''admin'',''owner'') THEN RAISE EXCEPTION ''CRM_VISITS_FORBIDDEN''; END IF;
  IF (public.crm_v2_visits_capabilities()->>''enabled'')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION ''CRM_VISITS_SETUP_REQUIRED''; END IF;
  IF p_customer_id IS NULL OR p_interest_id IS NULL OR p_appointment_page IS NULL OR p_appointment_page NOT BETWEEN 0 AND 100000
    OR p_visit_page IS NULL OR p_visit_page NOT BETWEEN 0 AND 100000 OR p_event_page IS NULL OR p_event_page NOT BETWEEN 0 AND 100000 THEN
    RAISE EXCEPTION ''CRM_VISITS_INVALID_INPUT''; END IF;
  SELECT * INTO c FROM customer_source_membership_private.customers WHERE id=p_customer_id;
  IF NOT FOUND THEN RAISE EXCEPTION ''CRM_VISITS_NOT_FOUND''; END IF;
  SELECT * INTO i FROM customer_source_membership_private.interests WHERE id=p_interest_id AND customer_id=p_customer_id;
  IF NOT FOUND THEN RAISE EXCEPTION ''CRM_VISITS_NOT_FOUND''; END IF;
  WITH rows AS(SELECT * FROM public.lead_appointments WHERE project_interest_id=i.id ORDER BY starts_at DESC,id DESC LIMIT 51 OFFSET p_appointment_page*50),
  numbered AS(SELECT *,row_number() OVER(ORDER BY starts_at DESC,id DESC) rn FROM rows)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(''id'',id,''revision'',revision,''startsAt'',starts_at,''endsAt'',ends_at,''status'',status,
    ''assignedSalesUserId'',assigned_sales_user_id,''createdAt'',created_at) ORDER BY starts_at DESC,id DESC) FILTER(WHERE rn<=50),''[]''::jsonb),count(*)>50
    INTO appointments_json,appointments_more FROM numbered;
  WITH rows AS(SELECT * FROM public.lead_visits WHERE project_interest_id=i.id ORDER BY checked_in_at DESC,id DESC LIMIT 51 OFFSET p_visit_page*50),
  numbered AS(SELECT *,row_number() OVER(ORDER BY checked_in_at DESC,id DESC) rn FROM rows)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(''id'',id,''revision'',revision,''appointmentId'',appointment_id,''status'',status,''checkedInAt'',checked_in_at,
    ''checkedInByUserId'',checked_in_by_user_id,''completedAt'',completed_at,''completedVoiceId'',completed_voice_id) ORDER BY checked_in_at DESC,id DESC)
    FILTER(WHERE rn<=50),''[]''::jsonb),count(*)>50 INTO visits_json,visits_more FROM numbered;
  WITH rows AS(SELECT * FROM sales_private.visits_events WHERE project_interest_id=i.id ORDER BY recorded_at DESC,id DESC LIMIT 51 OFFSET p_event_page*50),
  numbered AS(SELECT *,row_number() OVER(ORDER BY recorded_at DESC,id DESC) rn FROM rows)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(''id'',id,''command'',command,''appointmentId'',appointment_id,''visitId'',visit_id,
    ''occurredAt'',occurred_at,''recordedAt'',recorded_at,''actorUserId'',actor_user_id,''reason'',reason,''details'',details) ORDER BY recorded_at DESC,id DESC)
    FILTER(WHERE rn<=50),''[]''::jsonb),count(*)>50 INTO events_json,events_more FROM numbered;
  RETURN jsonb_build_object(''actor'',jsonb_build_object(''userId'',actor_id,''role'',actor_role),
    ''scope'',jsonb_build_object(''customerId'',c.id,''customerName'',c.customer_name,''interestId'',i.id,''projectName'',i.project_name,
      ''ownerUserId'',i.owner_user_id,''interestRevision'',i.lifecycle_revision,''engagementStatus'',i.engagement_status,
      ''canEdit'',(actor_role=''admin'' OR (actor_role=''sales'' AND actor_id=i.owner_user_id)) AND c.merged_into_customer_id IS NULL
        AND i.engagement_status<>''lost'' AND EXISTS(SELECT 1 FROM sales_private.crm_user_roles WHERE user_id=i.owner_user_id AND role=''sales'' AND is_active)),
    ''appointments'',appointments_json,''appointmentPage'',p_appointment_page,''appointmentsHasMore'',appointments_more,
    ''visits'',visits_json,''visitPage'',p_visit_page,''visitsHasMore'',visits_more,''events'',events_json,''eventPage'',p_event_page,''eventsHasMore'',events_more);
END;
');
 INSERT INTO customer_source_membership_private.adapters(signature,before_md5,after_md5,settings) VALUES('public.crm_v2_visits_context(uuid,uuid,integer,integer,integer)','5738680eeda1f34b743316fd5167851b','565e00a233f032b1400910a26bfda5ff',ARRAY['search_path=pg_catalog','TimeZone=UTC']::text[]);
END; $membership_adapter_25$;
DO $membership_adapter_26$
DECLARE d text; b text; owner_name text; secured boolean; settings text[];
BEGIN
 SELECT pg_get_functiondef(oid),replace(prosrc,E'\r\n',E'\n'),pg_get_userbyid(proowner),prosecdef,proconfig INTO d,b,owner_name,secured,settings FROM pg_proc WHERE oid='public.crm_v2_voice_row_readable(uuid)'::regprocedure;
 d:=replace(d,E'\r\n',E'\n');
 IF md5(b) IS DISTINCT FROM 'f140803ac7c8cb240e354b0d5f264459' OR owner_name IS DISTINCT FROM current_user OR owner_name IS DISTINCT FROM 'postgres' OR secured IS DISTINCT FROM true OR settings IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] THEN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_ADAPTER_REVIEW_REQUIRED'; END IF;
 IF (length(d)-length(replace(d,b,'')))/NULLIF(length(b),0)<>1 THEN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_DEFINITION_AMBIGUOUS'; END IF;
 EXECUTE replace(d,b,'
 SELECT (SELECT COALESCE(public.crm_v2_role() IN (''admin'',''owner'') OR (public.crm_v2_role()=''sales'' AND EXISTS(
  SELECT 1 FROM public.lead_visits v JOIN customer_source_membership_private.interests i ON i.id=v.project_interest_id WHERE v.id=p_visit_id AND i.owner_user_id=auth.uid())),false)) AND NOT EXISTS(
  SELECT 1 FROM public.lead_visits retired_visit JOIN public.lead_project_interests retired_interest ON retired_interest.id=retired_visit.project_interest_id
  WHERE retired_visit.id=p_visit_id AND NOT customer_source_membership_private.interest_member(retired_interest.id));
');
 INSERT INTO customer_source_membership_private.adapters(signature,before_md5,after_md5,settings) VALUES('public.crm_v2_voice_row_readable(uuid)','f140803ac7c8cb240e354b0d5f264459','aa6b602ac4f24761cbb0d6d1e45a39eb',ARRAY['search_path=pg_catalog']::text[]);
END; $membership_adapter_26$;
DO $membership_adapter_27$
DECLARE d text; b text; owner_name text; secured boolean; settings text[];
BEGIN
 SELECT pg_get_functiondef(oid),replace(prosrc,E'\r\n',E'\n'),pg_get_userbyid(proowner),prosecdef,proconfig INTO d,b,owner_name,secured,settings FROM pg_proc WHERE oid='sales_history_read_private.original_excel(text)'::regprocedure;
 d:=replace(d,E'\r\n',E'\n');
 IF md5(b) IS DISTINCT FROM 'a591f551ef63f630e4ceb632f68048d7' OR owner_name IS DISTINCT FROM current_user OR owner_name IS DISTINCT FROM 'postgres' OR secured IS DISTINCT FROM true OR settings IS DISTINCT FROM ARRAY['search_path=pg_catalog','TimeZone=UTC','DateStyle=ISO, YMD']::text[] THEN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_ADAPTER_REVIEW_REQUIRED'; END IF;
 IF (length(d)-length(replace(d,b,'')))/NULLIF(length(b),0)<>1 THEN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_DEFINITION_AMBIGUOUS'; END IF;
 EXECUTE replace(d,b,'
DECLARE
  actor_id uuid:=auth.uid(); actor_role text:=public.crm_v2_role();
  item record; day_value text; n integer:=0;
  legacy_rows jsonb[]:=ARRAY[]::jsonb[]; forecast_rows jsonb[]:=ARRAY[]::jsonb[];
  completed_rows jsonb[]:=ARRAY[]::jsonb[]; pending_keys jsonb:=''[]'';
  unassigned_rows jsonb[]:=ARRAY[]::jsonb[]; unknown_unassigned_count integer:=0;
  pending_count integer:=0; unknown_count integer:=0;
BEGIN
  IF actor_id IS NULL OR COALESCE(actor_role,'''') NOT IN (''sales'',''admin'',''owner'') THEN
    RAISE EXCEPTION ''CRM_EXCEL_EVIDENCE_FORBIDDEN'';
  END IF;
  IF (public.crm_v2_project_sales_capabilities()->>''enabled'')::boolean IS DISTINCT FROM true
    OR NOT crm_external_private.booking_writer_ready() THEN
    RAISE EXCEPTION ''CRM_EXCEL_EVIDENCE_SETUP_REQUIRED'';
  END IF;
  IF p_project_name IS NULL OR length(btrim(p_project_name)) NOT BETWEEN 1 AND 200
    OR length(p_project_name)>200 OR p_project_name ~ U&''[\0001-\001F\007F-\009F\2028\2029]'' THEN
    RAISE EXCEPTION ''CRM_EXCEL_EVIDENCE_INVALID_INPUT'';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.projects WHERE name=p_project_name) THEN
    RAISE EXCEPTION ''CRM_EXCEL_EVIDENCE_NOT_FOUND'';
  END IF;

  -- Exact interest/source membership, not every row belonging to that customer.
  -- DISTINCT collapses repeated membership only; batch:row remains the stable
  -- key for cross-project deduplication by the combined report consumer.
  FOR item IN
    SELECT bounded.*,count(*) OVER() AS bounded_count FROM (
    SELECT DISTINCT s.batch_id,s.source_row,c.id AS customer_id,
      s.payload->''reviewedHistory''->>''visitHistoryDate'' AS source_day
    FROM customer_source_membership_private.interests i
    JOIN crm_external_private.interest_candidates ic
      ON ic.batch_id=i.external_snapshot_batch_id AND ic.entity_key=i.external_interest_key
      AND ic.project_label=i.project_name
    JOIN crm_external_private.booking_writer_releases w ON w.batch_id=ic.batch_id
    JOIN crm_external_private.snapshot_batches b ON b.id=w.batch_id AND b.plan_digest=w.plan_digest
      AND b.feed=''customer-sheet''
    JOIN customer_source_membership_private.customers c ON c.id=i.customer_id
      AND c.external_snapshot_batch_id=ic.batch_id AND c.external_customer_key=ic.customer_key
      AND c.merged_into_customer_id IS NULL
    JOIN crm_external_private.source_records s ON s.batch_id=ic.batch_id AND s.customer_key=ic.customer_key
      AND ic.payload->''sourceRows'' @> jsonb_build_array(s.source_row)
    WHERE i.project_name=p_project_name AND s.disposition=''mapped_for_review'' AND customer_source_membership_private.source_member(s.batch_id,s.source_row) AND NOT rental_source_retirement_private.excluded(s.batch_id,s.source_row)
      AND s.source_row BETWEEN 2 AND 966
      AND NOT EXISTS(SELECT 1 FROM crm_external_private.sales_rollback_receipts r WHERE r.batch_id=b.id)
    ORDER BY s.batch_id,s.source_row,c.id
    LIMIT 10001) bounded
  LOOP
    n:=n+1;
    IF n>10000 OR item.bounded_count>10000 THEN RAISE EXCEPTION ''CRM_EXCEL_EVIDENCE_LIMIT''; END IF;
    day_value:=item.source_day;
    IF day_value IS NULL THEN unknown_count:=unknown_count+1; CONTINUE; END IF;
    IF day_value !~ ''^[0-9]{4}-[0-9]{2}-[0-9]{2}$''
      OR NOT pg_input_is_valid(day_value,''date'') THEN
      RAISE EXCEPTION ''CRM_EXCEL_EVIDENCE_DATE_INVALID'';
    END IF;
    legacy_rows:=array_append(legacy_rows,jsonb_build_object(
      ''key'',item.batch_id::text||'':''||item.source_row::text,''customerId'',item.customer_id,
      ''visitDate'',day_value,''leadDate'',day_value));
  END LOOP;

  -- Historical visits with an explicitly empty project list must survive in
  -- the all-project total, without assigning a fabricated project. This array
  -- is repeated for each project RPC and must be globally deduplicated by key;
  -- consumers must exclude it from project-specific subtotals.
  n:=0;
  FOR item IN
    SELECT bounded.*,count(*) OVER() AS bounded_count FROM (
    SELECT DISTINCT s.batch_id,s.source_row,c.id AS customer_id,
      s.payload->''reviewedHistory''->>''visitHistoryDate'' AS source_day
    FROM crm_external_private.source_records s
    JOIN crm_external_private.booking_writer_releases w ON w.batch_id=s.batch_id
    JOIN crm_external_private.snapshot_batches b ON b.id=w.batch_id AND b.plan_digest=w.plan_digest
      AND b.feed=''customer-sheet''
    JOIN customer_source_membership_private.customers c ON c.external_snapshot_batch_id=s.batch_id
      AND c.external_customer_key=s.customer_key AND c.merged_into_customer_id IS NULL
    WHERE s.disposition=''mapped_for_review'' AND customer_source_membership_private.source_member(s.batch_id,s.source_row) AND NOT rental_source_retirement_private.excluded(s.batch_id,s.source_row) AND s.source_row BETWEEN 2 AND 966
      AND s.payload->''reviewedHistory''->''projectLabels''=''[]''::jsonb
      AND NOT EXISTS(SELECT 1 FROM crm_external_private.interest_candidates ic
        WHERE ic.batch_id=s.batch_id AND ic.customer_key=s.customer_key
          AND ic.payload->''sourceRows'' @> jsonb_build_array(s.source_row))
      AND NOT EXISTS(SELECT 1 FROM crm_external_private.sales_rollback_receipts r WHERE r.batch_id=b.id)
    ORDER BY s.batch_id,s.source_row,c.id LIMIT 10001) bounded
  LOOP
    n:=n+1;
    IF n>10000 OR item.bounded_count>10000 THEN RAISE EXCEPTION ''CRM_EXCEL_EVIDENCE_LIMIT''; END IF;
    day_value:=item.source_day;
    IF day_value IS NULL THEN unknown_unassigned_count:=unknown_unassigned_count+1; CONTINUE; END IF;
    IF day_value !~ ''^[0-9]{4}-[0-9]{2}-[0-9]{2}$''
      OR NOT pg_input_is_valid(day_value,''date'') THEN
      RAISE EXCEPTION ''CRM_EXCEL_EVIDENCE_DATE_INVALID'';
    END IF;
    unassigned_rows:=array_append(unassigned_rows,jsonb_build_object(
      ''key'',item.batch_id::text||'':''||item.source_row::text,''customerId'',item.customer_id,
      ''visitDate'',day_value,''leadDate'',day_value));
  END LOOP;

  -- Held source rows may intentionally have no public Lead. Count only their
  -- attributable project membership, never expose the source identity/payload.
  SELECT count(*),COALESCE(jsonb_agg(batch_id::text||'':''||source_row::text ORDER BY batch_id,source_row),''[]'')
    INTO pending_count,pending_keys FROM (
    SELECT DISTINCT s.batch_id,s.source_row
    FROM crm_external_private.source_records s
    JOIN crm_external_private.interest_candidates ic ON ic.batch_id=s.batch_id
      AND ic.customer_key=s.customer_key AND ic.payload->''sourceRows'' @> jsonb_build_array(s.source_row)
    JOIN crm_external_private.booking_writer_releases w ON w.batch_id=s.batch_id
    JOIN crm_external_private.snapshot_batches b ON b.id=w.batch_id AND b.plan_digest=w.plan_digest
      AND b.feed=''customer-sheet''
    WHERE ic.project_label=p_project_name AND s.disposition=''admin_review''
      AND s.source_row BETWEEN 2 AND 966
      AND NOT EXISTS(SELECT 1 FROM crm_external_private.sales_rollback_receipts r WHERE r.batch_id=b.id)
    UNION
    -- An unnamed held row has no customer/interest candidate by design. Only
    -- the user-confirmed seven aliases in reviewedHistory may attribute it.
    -- Source reference: sheet-project-review-20260929.mjs / user confirmation.
    SELECT DISTINCT s.batch_id,s.source_row
    FROM crm_external_private.source_records s
    JOIN crm_external_private.booking_writer_releases w ON w.batch_id=s.batch_id
    JOIN crm_external_private.snapshot_batches b ON b.id=w.batch_id AND b.plan_digest=w.plan_digest
      AND b.feed=''customer-sheet''
    JOIN (VALUES (''AL2'',''ไอลิน 2''),(''AL3'',''ไอลิน 3''),(''AL4'',''ไอลิน 4''),(''AL6'',''ไอลิน6''),
      (''K4'',''กานต์รวี4''),(''K2พิเศษ'',''กานต์รวี2''),(''YR'',''โยริว'')) aliases(source_label,project_name)
      ON s.payload->''reviewedHistory''->''projectLabels'' @> jsonb_build_array(aliases.source_label)
    WHERE aliases.project_name=p_project_name AND s.disposition=''admin_review'' AND s.customer_key IS NULL
      AND s.source_row BETWEEN 2 AND 966
      AND NOT EXISTS(SELECT 1 FROM crm_external_private.sales_rollback_receipts r WHERE r.batch_id=b.id)
    LIMIT 10001
  ) pending;
  IF pending_count>10000 THEN RAISE EXCEPTION ''CRM_EXCEL_EVIDENCE_LIMIT''; END IF;

  n:=0;
  FOR item IN
    SELECT bounded.*,count(*) OVER() AS bounded_count FROM (
    SELECT sale.id,sale.external_booking_id,p.id AS prepared_id,
      p.batch_id,p.payload->>''interest_id'' AS prepared_interest,
      p.payload->>''customer_id'' AS prepared_customer,p.payload->>''project_name'' AS prepared_project,
      i.id AS interest_id,c.id AS customer_id,s.source_row,
      sales_import_private.expected_transfer_date(sale.id,s.payload->''reviewedHistory''->>''expectedTransferDate'') AS source_day,
      w.batch_id AS released_batch
    FROM customer_source_membership_private.sales sale
    JOIN customer_source_membership_private.interests i ON i.id=sale.project_interest_id
    JOIN customer_source_membership_private.customers c ON c.id=i.customer_id AND c.merged_into_customer_id IS NULL
    LEFT JOIN crm_external_private.prepared_booking_sales p ON p.id=sale.external_booking_id
    LEFT JOIN crm_external_private.source_records s ON s.batch_id=p.batch_id
      AND s.source_row=(p.payload->>''source_row'')::integer
      AND s.customer_key=c.external_customer_key AND c.external_snapshot_batch_id=p.batch_id
      AND s.disposition=''mapped_for_review'' AND customer_source_membership_private.source_member(s.batch_id,s.source_row) AND NOT rental_source_retirement_private.excluded(s.batch_id,s.source_row) AND s.source_row BETWEEN 2 AND 966
    LEFT JOIN crm_external_private.booking_writer_releases w ON w.batch_id=p.batch_id
      AND EXISTS(SELECT 1 FROM crm_external_private.snapshot_batches b
        WHERE b.id=w.batch_id AND b.plan_digest=w.plan_digest AND b.feed=''customer-sheet'')
      AND NOT EXISTS(SELECT 1 FROM crm_external_private.sales_rollback_receipts r WHERE r.batch_id=w.batch_id)
    WHERE i.project_name=p_project_name
      AND sale.crm_stage IN (''booked'',''contracted'',''downpayment'',''document_prep'',
        ''loan_submitted'',''loan_rejected'',''loan_approved'',''transfer_pending'')
    ORDER BY sale.id LIMIT 10001) bounded
  LOOP
    n:=n+1;
    IF n>10000 OR item.bounded_count>10000 THEN RAISE EXCEPTION ''CRM_EXCEL_EVIDENCE_LIMIT''; END IF;
    IF item.external_booking_id IS NOT NULL AND (item.prepared_id IS NULL
      OR item.released_batch IS NULL OR item.source_row IS NULL
      OR item.prepared_interest IS DISTINCT FROM item.interest_id::text
      OR item.prepared_customer IS DISTINCT FROM item.customer_id::text
      OR item.prepared_project IS DISTINCT FROM p_project_name) THEN
      RAISE EXCEPTION ''CRM_EXCEL_EVIDENCE_INTEGRITY_REQUIRED'';
    END IF;
    day_value:=item.source_day;
    IF day_value IS NOT NULL AND (day_value !~ ''^[0-9]{4}-[0-9]{2}-[0-9]{2}$''
      OR NOT pg_input_is_valid(day_value,''date'')) THEN
      RAISE EXCEPTION ''CRM_EXCEL_EVIDENCE_DATE_INVALID'';
    END IF;
    forecast_rows:=array_append(forecast_rows,jsonb_build_object(
      ''saleId'',item.id,''expectedTransferDate'',day_value));
  END LOOP;

  n:=0;
  FOR item IN
    SELECT bounded.*,count(*) OVER() AS bounded_count FROM (
    SELECT v.id,c.id AS customer_id,v.checked_in_at
    FROM public.lead_visits v
    JOIN customer_source_membership_private.interests i ON i.id=v.project_interest_id
    JOIN customer_source_membership_private.customers c ON c.id=i.customer_id AND c.merged_into_customer_id IS NULL
    JOIN public.customer_voices voice ON voice.id=v.completed_voice_id AND voice.visit_id=v.id
      AND voice.crm_submission_state=''submitted'' AND voice.crm_form_version=''customer_voices_v1''
      AND voice.crm_submitted_by_customer AND voice.crm_submitted_at=v.completed_at
      AND voice.crm_validated_at=v.completed_at
    WHERE i.project_name=p_project_name AND v.status=''completed''
      AND v.completed_voice_id IS NOT NULL AND v.completed_at IS NOT NULL
    ORDER BY v.id LIMIT 10001) bounded
  LOOP
    n:=n+1;
    IF n>10000 OR item.bounded_count>10000 THEN RAISE EXCEPTION ''CRM_EXCEL_EVIDENCE_LIMIT''; END IF;
    IF item.checked_in_at IS NULL OR NOT isfinite(item.checked_in_at)
      OR (item.checked_in_at AT TIME ZONE ''Asia/Bangkok'')::date NOT BETWEEN DATE ''0001-01-01'' AND DATE ''9999-12-31'' THEN
      RAISE EXCEPTION ''CRM_EXCEL_EVIDENCE_DATE_INVALID'';
    END IF;
    completed_rows:=array_append(completed_rows,jsonb_build_object(
      ''key'',''visit:''||item.id::text,''customerId'',item.customer_id,
      ''visitDate'',to_char(item.checked_in_at AT TIME ZONE ''Asia/Bangkok'',''YYYY-MM-DD'')));
  END LOOP;
  RETURN jsonb_build_object(''contractVersion'',''excel_evidence_v1'',''projectName'',p_project_name,
    ''actor'',jsonb_build_object(''userId'',actor_id,''role'',actor_role),
    ''legacyVisits'',to_jsonb(legacy_rows),''forecasts'',to_jsonb(forecast_rows),''completedVisits'',to_jsonb(completed_rows),
    ''pendingLegacyRows'',pending_count,''pendingLegacyKeys'',pending_keys,''unknownLegacyDates'',unknown_count,
    ''unassignedLegacyVisits'',to_jsonb(unassigned_rows),''unknownUnassignedLegacyDates'',unknown_unassigned_count);
END;
');
 INSERT INTO customer_source_membership_private.adapters(signature,before_md5,after_md5,settings) VALUES('sales_history_read_private.original_excel(text)','a591f551ef63f630e4ceb632f68048d7','4feccaf151abedabc6bb9dacd996a5ad',ARRAY['search_path=pg_catalog','TimeZone=UTC','DateStyle=ISO, YMD']::text[]);
END; $membership_adapter_27$;
DO $membership_adapter_28$
DECLARE d text; b text; owner_name text; secured boolean; settings text[];
BEGIN
 SELECT pg_get_functiondef(oid),replace(prosrc,E'\r\n',E'\n'),pg_get_userbyid(proowner),prosecdef,proconfig INTO d,b,owner_name,secured,settings FROM pg_proc WHERE oid='sales_history_read_private.records(uuid,uuid,uuid,text)'::regprocedure;
 d:=replace(d,E'\r\n',E'\n');
 IF md5(b) IS DISTINCT FROM 'eddfee4f232707dbf4facb0a1ee9d108' OR owner_name IS DISTINCT FROM current_user OR owner_name IS DISTINCT FROM 'postgres' OR secured IS DISTINCT FROM true OR settings IS DISTINCT FROM ARRAY['search_path=pg_catalog','TimeZone=UTC','DateStyle=ISO, YMD']::text[] THEN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_ADAPTER_REVIEW_REQUIRED'; END IF;
 IF (length(d)-length(replace(d,b,'')))/NULLIF(length(b),0)<>1 THEN RAISE EXCEPTION 'CUSTOMER_MEMBERSHIP_DEFINITION_AMBIGUOUS'; END IF;
 EXECUTE replace(d,b,'
DECLARE actor uuid:=auth.uid(); role_name text:=public.crm_v2_role(); result jsonb; loop_entry record; h jsonb;
BEGIN
 IF actor IS NULL OR coalesce(role_name,'''') NOT IN(''sales'',''admin'',''owner'') THEN RAISE EXCEPTION ''CRM_CUSTOMER_HISTORY_FORBIDDEN''; END IF;
 IF (public.crm_v2_project_sales_capabilities()->>''enabled'')::boolean IS DISTINCT FROM true
  OR NOT crm_external_private.booking_writer_ready() THEN RAISE EXCEPTION ''CRM_CUSTOMER_HISTORY_SETUP_REQUIRED''; END IF;
 IF EXISTS(SELECT 1 FROM crm_external_private.booking_writer_releases w LEFT JOIN crm_external_private.snapshot_batches b ON b.id=w.batch_id
  WHERE b.id IS NULL OR b.feed IS DISTINCT FROM ''customer-sheet'' OR b.plan_digest IS DISTINCT FROM w.plan_digest)
  THEN RAISE EXCEPTION ''CRM_CUSTOMER_HISTORY_INTEGRITY_REQUIRED''; END IF;
 IF p_customer_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM customer_source_membership_private.customers WHERE id=p_customer_id AND merged_into_customer_id IS NULL)
  THEN RAISE EXCEPTION ''CRM_CUSTOMER_HISTORY_NOT_FOUND''; END IF;
 IF p_interest_id IS NOT NULL AND (p_customer_id IS NULL OR NOT EXISTS(SELECT 1 FROM customer_source_membership_private.interests WHERE id=p_interest_id AND customer_id=p_customer_id))
  THEN RAISE EXCEPTION ''CRM_CUSTOMER_HISTORY_SCOPE_INVALID''; END IF;
 IF p_sale_id IS NOT NULL AND (p_customer_id IS NULL OR NOT EXISTS(SELECT 1 FROM customer_source_membership_private.sales s JOIN customer_source_membership_private.interests i ON i.id=s.project_interest_id
  WHERE s.id=p_sale_id AND i.customer_id=p_customer_id AND (p_interest_id IS NULL OR i.id=p_interest_id))) THEN RAISE EXCEPTION ''CRM_CUSTOMER_HISTORY_SCOPE_INVALID''; END IF;
 IF p_project_name IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.projects WHERE name=p_project_name) THEN RAISE EXCEPTION ''CRM_CUSTOMER_HISTORY_NOT_FOUND''; END IF;

 -- Reuse the complete project reader''s stock, identity, prior-round and source
 -- integrity checks before collecting or filtering historical evidence.
 FOR loop_entry IN SELECT DISTINCT i.project_name FROM customer_source_membership_private.interests i
  WHERE (p_customer_id IS NULL OR i.customer_id=p_customer_id) AND (p_project_name IS NULL OR i.project_name=p_project_name)
 LOOP PERFORM public.crm_v2_project_sales(loop_entry.project_name,''all'','''',0); END LOOP;
 IF EXISTS(SELECT 1 FROM customer_source_membership_private.sales s JOIN customer_source_membership_private.interests i ON i.id=s.project_interest_id JOIN customer_source_membership_private.customers c ON c.id=i.customer_id
  LEFT JOIN crm_external_private.prepared_booking_sales p ON p.id=s.external_booking_id
  LEFT JOIN crm_external_private.source_records sr ON sr.batch_id=p.batch_id AND sr.source_row=(p.payload->>''source_row'')::integer
  WHERE s.external_booking_id IS NOT NULL AND (p_customer_id IS NULL OR c.id=p_customer_id) AND (p_project_name IS NULL OR i.project_name=p_project_name)
   AND (p.id IS NULL OR sr.source_row IS NULL OR sr.customer_key IS DISTINCT FROM c.external_customer_key OR p.batch_id IS DISTINCT FROM c.external_snapshot_batch_id
    OR p.payload->>''customer_id'' IS DISTINCT FROM c.id::text OR p.payload->>''interest_id'' IS DISTINCT FROM i.id::text))
  THEN RAISE EXCEPTION ''CRM_CUSTOMER_HISTORY_INTEGRITY_REQUIRED''; END IF;
 IF EXISTS(SELECT 1 FROM crm_external_private.prepared_booking_sales p JOIN customer_source_membership_private.sales s ON s.external_booking_id=p.id
  JOIN customer_source_membership_private.interests i ON i.id=s.project_interest_id WHERE (p_customer_id IS NULL OR i.customer_id=p_customer_id)
  GROUP BY p.batch_id,(p.payload->>''source_row'')::integer,i.id HAVING count(*)>1)
  THEN RAISE EXCEPTION ''CRM_CUSTOMER_HISTORY_INTEGRITY_REQUIRED''; END IF;
 IF EXISTS(SELECT 1 FROM sales_source_creation_private.records r
  LEFT JOIN customer_source_membership_private.customers c ON c.id=r.customer_id LEFT JOIN customer_source_membership_private.interests i ON i.id=r.interest_id
  WHERE (p_customer_id IS NULL OR r.customer_id=p_customer_id) AND (c.id IS NULL OR i.id IS NULL OR c.merged_into_customer_id IS NOT NULL
   OR c.supplemental_creation_id IS DISTINCT FROM r.id OR i.supplemental_creation_id IS DISTINCT FROM r.id OR i.customer_id IS DISTINCT FROM c.id
   OR i.project_name IS DISTINCT FROM r.payload->>''projectName'')) THEN RAISE EXCEPTION ''CRM_CUSTOMER_HISTORY_INTEGRITY_REQUIRED''; END IF;
 IF EXISTS(SELECT 1 FROM sales_unknown_history_private.records r LEFT JOIN customer_source_membership_private.customers c ON c.id=r.customer_id
  LEFT JOIN customer_source_membership_private.interests i ON i.id=r.interest_id WHERE (p_customer_id IS NULL OR r.customer_id=p_customer_id)
  AND (c.id IS NULL OR c.merged_into_customer_id IS NOT NULL OR (r.interest_id IS NOT NULL AND (i.id IS NULL OR i.customer_id IS DISTINCT FROM c.id))))
  THEN RAISE EXCEPTION ''CRM_CUSTOMER_HISTORY_INTEGRITY_REQUIRED''; END IF;
 FOR loop_entry IN SELECT e.*,to_jsonb(s) AS current_sale FROM sales_revision_private.events e LEFT JOIN customer_source_membership_private.sales s ON s.id=e.sale_id
  WHERE (p_customer_id IS NULL OR e.customer_id=p_customer_id)
 LOOP
  IF loop_entry.current_sale IS NULL OR (loop_entry.operation=''cancel'' AND loop_entry.current_sale->>''historical_revision_id'' IS DISTINCT FROM loop_entry.id::text)
   OR (loop_entry.operation=''create_booking'' AND loop_entry.current_sale->>''historical_import_id'' IS DISTINCT FROM loop_entry.id::text)
   THEN RAISE EXCEPTION ''CRM_CUSTOMER_HISTORY_INTEGRITY_REQUIRED''; END IF;
  h:=sales_private.crm_booking_imported_history(loop_entry.current_sale);
  IF h IS NULL OR h->>''sourceRow'' IS DISTINCT FROM loop_entry.source_row::text THEN RAISE EXCEPTION ''CRM_CUSTOMER_HISTORY_INTEGRITY_REQUIRED''; END IF;
 END LOOP;

 -- A source row is selected only through explicit candidate membership. Two
 -- visits with the same customer/day keep separate source keys. Ambiguous
 -- multi-interest membership is represented as unknown in customer scope.
 WITH original_members AS (
  SELECT s.batch_id,s.source_row,c.id customer_id,i.id interest_id,i.project_name,
   s.payload->''reviewedHistory''->>''visitHistoryDate'' visit_day,
   (SELECT sale.id FROM customer_source_membership_private.sales sale JOIN crm_external_private.prepared_booking_sales p ON p.id=sale.external_booking_id
    WHERE sale.project_interest_id=i.id AND p.batch_id=s.batch_id AND (p.payload->>''source_row'')::integer=s.source_row ORDER BY sale.id LIMIT 1) sale_id
  FROM crm_external_private.source_records s JOIN crm_external_private.booking_writer_releases w ON w.batch_id=s.batch_id
  JOIN crm_external_private.snapshot_batches b ON b.id=w.batch_id AND b.plan_digest=w.plan_digest AND b.feed=''customer-sheet''
  JOIN customer_source_membership_private.customers c ON c.external_snapshot_batch_id=s.batch_id AND c.external_customer_key=s.customer_key AND c.merged_into_customer_id IS NULL
  JOIN crm_external_private.interest_candidates ic ON ic.batch_id=s.batch_id AND ic.customer_key=s.customer_key AND ic.payload->''sourceRows'' @> jsonb_build_array(s.source_row)
  JOIN customer_source_membership_private.interests i ON i.external_snapshot_batch_id=ic.batch_id AND i.external_interest_key=ic.entity_key AND i.customer_id=c.id AND i.project_name=ic.project_label
  WHERE s.disposition=''mapped_for_review'' AND customer_source_membership_private.source_member(s.batch_id,s.source_row) AND NOT rental_source_retirement_private.excluded(s.batch_id,s.source_row) AND s.source_row BETWEEN 2 AND 966
   AND NOT EXISTS(SELECT 1 FROM crm_external_private.sales_rollback_receipts x WHERE x.batch_id=s.batch_id)
   AND (p_customer_id IS NULL OR c.id=p_customer_id) AND (p_interest_id IS NULL OR i.id=p_interest_id)
   AND (p_project_name IS NULL OR i.project_name=p_project_name)
   AND (p_sale_id IS NULL OR EXISTS(SELECT 1 FROM customer_source_membership_private.sales selected_sale JOIN crm_external_private.prepared_booking_sales selected_source ON selected_source.id=selected_sale.external_booking_id
    WHERE selected_sale.id=p_sale_id AND selected_sale.project_interest_id=i.id AND selected_source.batch_id=s.batch_id AND (selected_source.payload->>''source_row'')::integer=s.source_row))
 ), original_unassigned AS (
  SELECT s.batch_id::text||'':''||s.source_row::text key,c.id customer_id,s.source_row,NULL::uuid interest_id,NULL::text project_name,''[]''::jsonb project_names,NULL::uuid sale_id,
   jsonb_build_array(jsonb_build_object(''kind'',''visited'',''date'',s.payload->''reviewedHistory''->>''visitHistoryDate'',''precision'',CASE WHEN s.payload->''reviewedHistory''->>''visitHistoryDate'' IS NULL THEN ''unknown'' ELSE ''day'' END)) events,0 priority
  FROM crm_external_private.source_records s JOIN crm_external_private.booking_writer_releases w ON w.batch_id=s.batch_id
  JOIN crm_external_private.snapshot_batches b ON b.id=w.batch_id AND b.plan_digest=w.plan_digest AND b.feed=''customer-sheet''
  JOIN customer_source_membership_private.customers c ON c.external_snapshot_batch_id=s.batch_id AND c.external_customer_key=s.customer_key AND c.merged_into_customer_id IS NULL
  WHERE s.disposition=''mapped_for_review'' AND customer_source_membership_private.source_member(s.batch_id,s.source_row) AND NOT rental_source_retirement_private.excluded(s.batch_id,s.source_row) AND s.source_row BETWEEN 2 AND 966 AND s.payload->''reviewedHistory''->''projectLabels''=''[]''
   AND NOT EXISTS(SELECT 1 FROM crm_external_private.interest_candidates ic WHERE ic.batch_id=s.batch_id AND ic.customer_key=s.customer_key AND ic.payload->''sourceRows'' @> jsonb_build_array(s.source_row))
   AND NOT EXISTS(SELECT 1 FROM crm_external_private.sales_rollback_receipts x WHERE x.batch_id=s.batch_id)
   AND (p_customer_id IS NULL OR c.id=p_customer_id) AND p_interest_id IS NULL AND p_sale_id IS NULL
 ), originals AS (
  SELECT batch_id::text||'':''||source_row::text key,customer_id,source_row,
   CASE WHEN count(DISTINCT interest_id)=1 THEN min(interest_id::text)::uuid END interest_id,
   CASE WHEN count(DISTINCT project_name)=1 THEN min(project_name) END project_name,
   to_jsonb(array_agg(DISTINCT project_name ORDER BY project_name)) project_names,
   CASE WHEN count(DISTINCT interest_id)=1 AND count(DISTINCT sale_id)=1 THEN min(sale_id::text)::uuid END sale_id,
   jsonb_build_array(jsonb_build_object(''kind'',''visited'',''date'',min(visit_day),''precision'',CASE WHEN min(visit_day) IS NULL THEN ''unknown'' ELSE ''day'' END)) events,0 priority
  FROM original_members GROUP BY batch_id,source_row,customer_id
 ), creation AS (
  SELECT ''source:''||r.source_key key,r.customer_id,r.source_row,r.interest_id,i.project_name,jsonb_build_array(i.project_name) project_names,NULL::uuid sale_id,
   (SELECT coalesce(jsonb_agg(jsonb_build_object(''kind'',e.kind,''date'',to_char(e.event_day,''YYYY-MM-DD''),''precision'',e.precision) ORDER BY e.event_key),''[]'')
     FROM sales_source_creation_private.events e WHERE e.record_id=r.id) events,1 priority
  FROM sales_source_creation_private.records r JOIN customer_source_membership_private.interests i ON i.id=r.interest_id
  WHERE (p_customer_id IS NULL OR r.customer_id=p_customer_id) AND (p_interest_id IS NULL OR r.interest_id=p_interest_id)
   AND (p_project_name IS NULL OR i.project_name=p_project_name)
 ), unknown_rows AS (
  SELECT coalesce((SELECT min(s.batch_id::text)||'':''||r.row_number::text FROM crm_external_private.source_records s
    JOIN customer_source_membership_private.customers c ON c.id=r.customer_id AND c.external_snapshot_batch_id=s.batch_id AND c.external_customer_key=s.customer_key WHERE s.source_row=r.row_number),''unknown:''||r.source_key) key,
   r.customer_id,r.row_number source_row,r.interest_id,i.project_name,CASE WHEN i.project_name IS NULL THEN ''[]''::jsonb ELSE jsonb_build_array(i.project_name) END project_names,NULL::uuid sale_id,
   (SELECT coalesce(jsonb_agg(jsonb_build_object(''kind'',e.kind,''date'',to_char(e.occurred_date,''YYYY-MM-DD''),''precision'',e.precision) ORDER BY e.sequence),''[]'')
    FROM sales_unknown_history_private.events e WHERE e.batch_id=r.batch_id AND e.source_key=r.source_key) events,2 priority
  FROM sales_unknown_history_private.records r LEFT JOIN customer_source_membership_private.interests i ON i.id=r.interest_id
  WHERE (p_customer_id IS NULL OR r.customer_id=p_customer_id) AND (p_interest_id IS NULL OR r.interest_id=p_interest_id)
   AND (p_project_name IS NULL OR i.project_name=p_project_name OR r.reason=''unknown_project'')
 ), revised AS (
  SELECT coalesce((SELECT min(s.batch_id::text)||'':''||e.source_row::text FROM crm_external_private.source_records s
    JOIN customer_source_membership_private.customers c ON c.id=e.customer_id AND c.external_snapshot_batch_id=s.batch_id AND c.external_customer_key=s.customer_key WHERE s.source_row=e.source_row),''revision:''||e.source_key) key,
   e.customer_id,e.source_row,e.interest_id,i.project_name,jsonb_build_array(i.project_name) project_names,e.sale_id,e.source_history events,3 priority
  FROM sales_revision_private.events e JOIN customer_source_membership_private.interests i ON i.id=e.interest_id
  WHERE (p_customer_id IS NULL OR e.customer_id=p_customer_id) AND (p_interest_id IS NULL OR e.interest_id=p_interest_id)
   AND (p_project_name IS NULL OR i.project_name=p_project_name)
 ), all_rows AS (SELECT * FROM originals UNION ALL SELECT * FROM original_unassigned UNION ALL SELECT * FROM creation UNION ALL SELECT * FROM unknown_rows UNION ALL SELECT * FROM revised),
 chosen AS (SELECT DISTINCT ON(key) * FROM all_rows ORDER BY key,priority DESC),
 scoped AS (SELECT * FROM chosen WHERE p_sale_id IS NULL OR sale_id=p_sale_id)
 SELECT coalesce(jsonb_agg(jsonb_build_object(''key'',key,''customerId'',customer_id,''projectName'',project_name,''projectNames'',project_names,''interestId'',interest_id,''saleId'',sale_id,''sourceRow'',source_row,''events'',events) ORDER BY key),''[]'') INTO result FROM scoped;
 IF jsonb_array_length(result)>10000 THEN RAISE EXCEPTION ''CRM_CUSTOMER_HISTORY_LIMIT''; END IF;
 -- Original booking days come through the unchanged provenance verifier, not
 -- through guessed timestamps. Revision records already contain their full
 -- approved visit/booking/cancellation timeline.
 FOR loop_entry IN SELECT value item FROM jsonb_array_elements(result) WHERE value->''saleId''<>''null''::jsonb LOOP
  IF NOT EXISTS(SELECT 1 FROM sales_revision_private.events WHERE sale_id=(loop_entry.item->>''saleId'')::uuid) THEN
   SELECT sales_private.crm_booking_imported_history(to_jsonb(s)) INTO h FROM customer_source_membership_private.sales s WHERE id=(loop_entry.item->>''saleId'')::uuid;
   IF h IS NULL THEN RAISE EXCEPTION ''CRM_CUSTOMER_HISTORY_INTEGRITY_REQUIRED''; END IF;
   h:=jsonb_build_array(jsonb_build_object(''kind'',''booked'',''date'',h->''bookedDate'',''precision'',CASE WHEN h->>''bookedDate'' IS NULL THEN ''unknown'' ELSE ''day'' END))
    ||CASE WHEN h->>''sourceStage''=''cancelled'' THEN jsonb_build_array(jsonb_build_object(''kind'',''cancelled'',''date'',h->''cancelledDate'',''precision'',CASE WHEN h->>''cancelledDate'' IS NULL THEN ''unknown'' ELSE ''day'' END)) ELSE ''[]''::jsonb END
    ||CASE WHEN h->>''sourceStage''=''transferred'' THEN jsonb_build_array(jsonb_build_object(''kind'',''transferred'',''date'',h->''transferredDate'',''precision'',CASE WHEN h->>''transferredDate'' IS NULL THEN ''unknown'' ELSE ''day'' END)) ELSE ''[]''::jsonb END;
   SELECT jsonb_agg(CASE WHEN value->>''key''=loop_entry.item->>''key'' THEN value||jsonb_build_object(''events'',value->''events''||h) ELSE value END ORDER BY ordinality) INTO result FROM jsonb_array_elements(result) WITH ORDINALITY;
  END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(result) rr CROSS JOIN LATERAL jsonb_array_elements(rr->''events'') ev
  WHERE ev->>''kind'' NOT IN(''visited'',''booked'',''contracted'',''loan_submitted'',''transferred'',''handover'',''cancelled'') OR ev->>''kind'' IS NULL
   OR ((ev->>''precision''=''unknown'' AND ev->''date''=''null'') OR (ev->>''precision''=''day'' AND jsonb_typeof(ev->''date'')=''string''
    AND ev->>''date'' ~ ''^[0-9]{4}-[0-9]{2}-[0-9]{2}$'' AND pg_input_is_valid(ev->>''date'',''date''))) IS DISTINCT FROM true)
  THEN RAISE EXCEPTION ''CRM_CUSTOMER_HISTORY_DATE_INVALID''; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(result) rr CROSS JOIN LATERAL jsonb_array_elements(rr->''events'') ev
  GROUP BY rr->>''key'',ev->>''kind'' HAVING count(*)>1) THEN RAISE EXCEPTION ''CRM_CUSTOMER_HISTORY_INTEGRITY_REQUIRED''; END IF;
 RETURN customer_source_membership_private.history(result,p_customer_id,p_interest_id,p_sale_id,p_project_name);
END;
');
 INSERT INTO customer_source_membership_private.adapters(signature,before_md5,after_md5,settings) VALUES('sales_history_read_private.records(uuid,uuid,uuid,text)','eddfee4f232707dbf4facb0a1ee9d108','5e54517419672b3cf2260be8c1a81716',ARRAY['search_path=pg_catalog','TimeZone=UTC','DateStyle=ISO, YMD']::text[]);
END; $membership_adapter_28$;
-- DESIGN ONLY. Requires the exact 25-31 composition and reviewed adapter block.
-- Install before begin_run and before any business replacement writes.
-- Restores logical business state; six created Customer/Interest audit parents
-- and immutable import/recovery ledgers deliberately remain physical records.

-- Design sentinel cleared only in this reviewed installation artifact.
SET LOCAL lock_timeout='2s';
CREATE SCHEMA sales_recovery_private;
REVOKE ALL ON SCHEMA sales_recovery_private FROM PUBLIC,anon,authenticated;
CREATE TABLE sales_recovery_private.runs(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),dataset_key text UNIQUE NOT NULL,
 source_sha256 text NOT NULL,review_reference text NOT NULL,actor_id uuid NOT NULL,
 before_state jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sales_recovery_private.seals(
 run_id uuid PRIMARY KEY REFERENCES sales_recovery_private.runs,after_state jsonb NOT NULL,
 actor_id uuid NOT NULL,review_reference text NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sales_recovery_private.recoveries(
 run_id uuid PRIMARY KEY REFERENCES sales_recovery_private.seals,business_state jsonb NOT NULL,
 actor_id uuid NOT NULL,review_reference text NOT NULL,
 physical_parents_retained boolean NOT NULL CHECK(physical_parents_retained),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sales_recovery_private.permits(
 transaction_id bigint NOT NULL,backend_pid integer NOT NULL,actor_id uuid NOT NULL,
 run_id uuid NOT NULL REFERENCES sales_recovery_private.seals,relation_name text NOT NULL,
 entity_id text NOT NULL,old_row jsonb,new_row jsonb,
 PRIMARY KEY(transaction_id,backend_pid,relation_name,entity_id)
);
-- Historical and membership ledgers reference a durable identity even when the
-- newly created live Sale is removed by a reviewed compensation transaction.
CREATE TABLE sales_recovery_private.sale_identities(id uuid PRIMARY KEY);
CREATE TABLE sales_recovery_private.adapters(signature text PRIMARY KEY,before_md5 text NOT NULL,after_md5 text NOT NULL);
CREATE FUNCTION sales_recovery_private.operator()
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF current_user IS DISTINCT FROM session_user
  OR current_user IS DISTINCT FROM (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid='sales_recovery_private.runs'::regclass)
  OR auth.uid() IS NULL OR public.crm_v2_role() IS DISTINCT FROM 'admin'
 THEN RAISE EXCEPTION 'CUSTOMER_RECOVERY_OPERATOR_REQUIRED'; END IF;
 PERFORM 1 FROM sales_private.crm_user_roles WHERE user_id=auth.uid() AND role='admin' AND is_active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CUSTOMER_RECOVERY_OPERATOR_REQUIRED'; END IF;
END; $$;
CREATE FUNCTION sales_recovery_private.sealed()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'CUSTOMER_RECOVERY_IMMUTABLE'; END; $$;
CREATE FUNCTION sales_recovery_private.insert_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN PERFORM sales_recovery_private.operator(); RETURN NEW; END; $$;
DO $protect$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['runs','seals','recoveries','sale_identities','adapters','permits'] LOOP
  EXECUTE format('ALTER TABLE sales_recovery_private.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE TRIGGER recovery_insert_guard BEFORE INSERT ON sales_recovery_private.%I FOR EACH ROW EXECUTE FUNCTION sales_recovery_private.insert_guard()',t);
  EXECUTE format('CREATE TRIGGER recovery_no_truncate BEFORE TRUNCATE ON sales_recovery_private.%I FOR EACH STATEMENT EXECUTE FUNCTION sales_recovery_private.sealed()',t);
  IF t<>'permits' THEN EXECUTE format('CREATE TRIGGER recovery_immutable BEFORE UPDATE OR DELETE ON sales_recovery_private.%I FOR EACH STATEMENT EXECUTE FUNCTION sales_recovery_private.sealed()',t); END IF;
 END LOOP;
END; $protect$;

CREATE FUNCTION sales_recovery_private.permit_delete_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM sales_recovery_private.operator();
 IF TG_OP<>'DELETE' OR OLD.transaction_id<>txid_current() OR OLD.backend_pid<>pg_backend_pid() OR OLD.actor_id<>auth.uid()
 THEN RAISE EXCEPTION 'CUSTOMER_RECOVERY_PERMIT_FORBIDDEN'; END IF; RETURN OLD;
END; $$;
CREATE TRIGGER recovery_permit_change BEFORE UPDATE OR DELETE ON sales_recovery_private.permits FOR EACH ROW EXECUTE FUNCTION sales_recovery_private.permit_delete_guard();
CREATE FUNCTION sales_recovery_private.exact_permit_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE b jsonb;a jsonb;expected_old jsonb;expected_new jsonb;key_name text;
BEGIN
 PERFORM sales_recovery_private.operator();
 IF NEW.transaction_id<>txid_current() OR NEW.backend_pid<>pg_backend_pid() OR NEW.actor_id<>auth.uid()
  OR NEW.relation_name NOT IN('sales','plots','deal_details_corrections','forecast_corrections')
 THEN RAISE EXCEPTION 'CUSTOMER_RECOVERY_EXACT_PERMIT_REQUIRED'; END IF;
 SELECT CASE NEW.relation_name WHEN 'sales' THEN r.before_state->'public'->'sales' WHEN 'plots' THEN r.before_state->'public'->'plots'
  WHEN 'deal_details_corrections' THEN r.before_state->'details' ELSE r.before_state->'forecast' END,
  CASE NEW.relation_name WHEN 'sales' THEN s.after_state->'public'->'sales' WHEN 'plots' THEN s.after_state->'public'->'plots'
  WHEN 'deal_details_corrections' THEN s.after_state->'details' ELSE s.after_state->'forecast' END INTO b,a
  FROM sales_recovery_private.runs r JOIN sales_recovery_private.seals s ON s.run_id=r.id WHERE r.id=NEW.run_id;
 key_name:=CASE WHEN NEW.relation_name IN('sales','plots') THEN 'id' ELSE 'sale_id' END;
 SELECT value INTO expected_old FROM jsonb_array_elements(a) WHERE value->>key_name=NEW.entity_id;
 SELECT value INTO expected_new FROM jsonb_array_elements(b) WHERE value->>key_name=NEW.entity_id;
 IF b IS NULL OR a IS NULL OR expected_old IS DISTINCT FROM NEW.old_row OR expected_new IS DISTINCT FROM NEW.new_row
  OR expected_old IS NOT DISTINCT FROM expected_new OR EXISTS(SELECT 1 FROM sales_recovery_private.recoveries WHERE run_id=NEW.run_id)
 THEN RAISE EXCEPTION 'CUSTOMER_RECOVERY_EXACT_PERMIT_REQUIRED'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER recovery_exact_permit BEFORE INSERT ON sales_recovery_private.permits FOR EACH ROW EXECUTE FUNCTION sales_recovery_private.exact_permit_guard();

-- The journal reads business relations only. User/PIN/Auth/session tables are
-- excluded, and an unexpected credential-like column blocks capture outright.
CREATE FUNCTION sales_recovery_private.snapshot()
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE t text; result jsonb:='{}'; rows jsonb; pub jsonb:='{}'; source_hashes jsonb:='{}'; source_hash text;
BEGIN
 PERFORM sales_recovery_private.operator();
 FOR t IN SELECT unnest(ARRAY['ai_risk_reports','ai_sales_reports','contractors','crm_audit_events','crm_duplicate_reviews',
  'crm_import_batches','crm_import_rows','crm_legacy_lead_links','crm_next_actions','crm_notifications','crm_settings',
  'crm_sla_exceptions','crm_sla_tasks','crm_work_periods','customer_voices','defect_updates','defects','foremen','house_types',
  'house_visit_checklist_items','house_visit_checklist_runs','house_visit_checklists','lead_activities','lead_appointments',
  'lead_project_interests','lead_visits','leads','loan_attempts','notifications','plot_promotions','plot_task_assignments',
  'plot_task_schedules','plots','projects','rental_contracts','rental_payments','sale_plot_changes','sales','sales_customers',
  'sales_reason_catalog','status_history','task_material_receipts','task_material_requests','task_templates','task_updates']) ORDER BY 1 LOOP
  IF to_regclass('public.'||t) IS NULL THEN CONTINUE; END IF;
  IF EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=('public.'||t)::regclass AND attnum>0 AND NOT attisdropped
   AND attname ~* '(password|credential|(^|_)pin($|_)|(^|_)token($|_)|secret)'
   AND NOT (t='crm_settings' AND attname='voice_token_ttl_hours'))
   THEN RAISE EXCEPTION 'CUSTOMER_RECOVERY_SENSITIVE_RELATION_REVIEW_REQUIRED'; END IF;
  EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text),''[]'') FROM public.%I x',t) INTO rows;
  pub:=pub||jsonb_build_object(t,rows);
 END LOOP;
 FOR t IN SELECT unnest(ARRAY['snapshot_batches','source_records','prepared_booking_sales','customer_candidates','interest_candidates',
  'booking_history','bridge_receipts','sales_cutover_receipts','booking_writer_releases']) ORDER BY 1 LOOP
  IF to_regclass('crm_external_private.'||t) IS NULL THEN RAISE EXCEPTION 'CUSTOMER_RECOVERY_SOURCE_CATALOG_REQUIRED'; END IF;
  EXECUTE format('SELECT md5(coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text),''[]'')::text) FROM crm_external_private.%I x',t) INTO source_hash;
  source_hashes:=source_hashes||jsonb_build_object(t,source_hash);
 END LOOP;
 SELECT jsonb_build_object('public',pub,'sourceHashes',source_hashes,
  'roles',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY user_id),'[]') FROM sales_private.crm_user_roles r),
  'details',(SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY sale_id),'[]') FROM sales_private.deal_details_corrections d),
  'profiles',(SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY customer_id),'[]') FROM sales_private.customer_profile_corrections d),
  'forecast',(SELECT coalesce(jsonb_agg(to_jsonb(f) ORDER BY sale_id),'[]') FROM sales_import_private.forecast_corrections f),
  'head',(SELECT coalesce(jsonb_agg(to_jsonb(h) ORDER BY id),'[]') FROM customer_source_membership_private.head h),
  'creationIds',(SELECT coalesce(jsonb_agg(id::text ORDER BY id),'[]') FROM sales_source_creation_private.records),
  'unknownIds',(SELECT coalesce(jsonb_agg(id::text ORDER BY id),'[]') FROM sales_unknown_history_private.batches),
  'revisionIds',(SELECT coalesce(jsonb_agg(id::text ORDER BY id),'[]') FROM sales_revision_private.events),
  'detailIds',(SELECT coalesce(jsonb_agg(id::text ORDER BY id),'[]') FROM sales_import_private.detail_batches),
  'rentalIds',(SELECT coalesce(jsonb_agg(id::text ORDER BY id),'[]') FROM rental_source_retirement_private.batches)) INTO result;
 RETURN result;
END; $$;

CREATE FUNCTION sales_recovery_private.excluded_evidence(p_kind text,p_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM sales_recovery_private.recoveries recovery JOIN sales_recovery_private.runs r ON r.id=recovery.run_id
  JOIN sales_recovery_private.seals s ON s.run_id=r.id
  WHERE p_kind IN('creation','unknown','revision','detail','rental')
   AND s.after_state->(p_kind||'Ids') @> jsonb_build_array(p_id::text)
   AND NOT r.before_state->(p_kind||'Ids') @> jsonb_build_array(p_id::text));
$$;
CREATE FUNCTION sales_recovery_private.retired_parent(p_kind text,p_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM sales_source_creation_private.records r
  WHERE sales_recovery_private.excluded_evidence('creation',r.id)
   AND CASE p_kind WHEN 'customer' THEN r.customer_id=p_id WHEN 'interest' THEN r.interest_id=p_id ELSE false END);
$$;
CREATE VIEW sales_recovery_private.active_revision_events WITH(security_invoker=true) AS SELECT e.* FROM sales_revision_private.events e WHERE NOT sales_recovery_private.excluded_evidence('revision',e.id);
CREATE VIEW sales_recovery_private.active_creation_records WITH(security_invoker=true) AS SELECT e.* FROM sales_source_creation_private.records e WHERE NOT sales_recovery_private.excluded_evidence('creation',e.id);
CREATE VIEW sales_recovery_private.active_unknown_records WITH(security_invoker=true) AS SELECT e.* FROM sales_unknown_history_private.records e WHERE NOT sales_recovery_private.excluded_evidence('unknown',e.batch_id);

CREATE FUNCTION sales_recovery_private.row_allowed(p_relation text,p_operation text,p_old jsonb,p_new jsonb)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT public.crm_v2_role()='admin' AND EXISTS(SELECT 1 FROM sales_recovery_private.permits p
  WHERE p.transaction_id=txid_current() AND p.backend_pid=pg_backend_pid() AND p.actor_id=auth.uid()
   AND p.relation_name=p_relation AND p.entity_id=coalesce(p_old->>'id',p_new->>'id',p_old->>'sale_id',p_new->>'sale_id')
   AND p_operation=CASE WHEN p.old_row IS NULL THEN 'INSERT' WHEN p.new_row IS NULL THEN 'DELETE' ELSE 'UPDATE' END
   AND p.old_row IS NOT DISTINCT FROM p_old AND p.new_row IS NOT DISTINCT FROM p_new);
$$;
CREATE FUNCTION sales_recovery_private.stock_allowed(p_old jsonb,p_new jsonb)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT public.crm_v2_role()='admin' AND EXISTS(SELECT 1 FROM sales_recovery_private.permits p
  WHERE p.transaction_id=txid_current() AND p.backend_pid=pg_backend_pid() AND p.actor_id=auth.uid()
   AND p.relation_name='plots' AND p.entity_id=p_old->>'id' AND p.new_row-'has_customer'=p_old-'has_customer'
   AND p.old_row-'has_customer'=p_old-'has_customer' AND p_old->'has_customer' IN(p.old_row->'has_customer',p.new_row->'has_customer','false','true','null')
   AND p_new IN(p.new_row,p.new_row||jsonb_build_object('has_customer',coalesce((p.new_row->>'has_customer')::boolean,false)))
   AND (SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM public.sales s WHERE s.plot_id=p.entity_id)
    =(SELECT coalesce(jsonb_agg(value ORDER BY value->>'id'),'[]') FROM sales_recovery_private.runs r
      CROSS JOIN LATERAL jsonb_array_elements(r.before_state->'public'->'sales') WHERE r.id=p.run_id AND value->>'plot_id'=p.entity_id));
$$;

CREATE FUNCTION sales_recovery_private.assert_adapters()
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF (SELECT count(*) FROM sales_recovery_private.adapters)<9 OR EXISTS(SELECT 1 FROM sales_recovery_private.adapters a
  WHERE to_regprocedure(a.signature) IS NULL OR a.after_md5 IS DISTINCT FROM
   (SELECT md5(replace(prosrc,E'\r\n',E'\n')) FROM pg_proc WHERE oid=to_regprocedure(a.signature)))
 THEN RAISE EXCEPTION 'CUSTOMER_RECOVERY_ADAPTERS_REQUIRED'; END IF;
END; $$;
CREATE FUNCTION sales_recovery_private.adapter_matches(p_signature text,p_original_md5 text,p_current_md5 text)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT p_original_md5=p_current_md5 OR EXISTS(SELECT 1 FROM sales_recovery_private.adapters a
  WHERE a.signature=p_signature AND a.before_md5=p_original_md5 AND a.after_md5=p_current_md5);
$$;

CREATE FUNCTION sales_recovery_private.begin_run(p_review text)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE result uuid; captured jsonb;known sales_recovery_private.runs%ROWTYPE;
BEGIN
 PERFORM sales_recovery_private.operator(); PERFORM sales_recovery_private.assert_adapters();
 PERFORM pg_advisory_xact_lock(hashtextextended('crm-booking-command',0));
 IF coalesce(length(btrim(p_review)),0)=0 OR EXISTS(SELECT 1 FROM customer_source_membership_private.head)
 THEN RAISE EXCEPTION 'CUSTOMER_RECOVERY_BEGIN_REVIEW_REQUIRED'; END IF;
 captured:=sales_recovery_private.snapshot();
 SELECT * INTO known FROM sales_recovery_private.runs WHERE dataset_key='full-replacement-379da2e538829a3cb0379108b98851757c142eb010b1624543413116eef8a506';
 IF FOUND THEN
  IF known.before_state IS DISTINCT FROM captured OR EXISTS(SELECT 1 FROM sales_recovery_private.seals WHERE run_id=known.id)
   THEN RAISE EXCEPTION 'CUSTOMER_RECOVERY_BEGIN_REPLAY_CONFLICT'; END IF;
  RETURN known.id;
 END IF;
 INSERT INTO sales_recovery_private.runs(dataset_key,source_sha256,review_reference,actor_id,before_state)
 VALUES('full-replacement-379da2e538829a3cb0379108b98851757c142eb010b1624543413116eef8a506',
  '7193857ef04d6a092171749a25867b1ca8d1bbe8f7b83b04fa7473b3a3a69ffd',p_review,auth.uid(),captured) RETURNING id INTO result;
 RETURN result;
END; $$;

CREATE FUNCTION sales_recovery_private.validate_delta(p_before jsonb,p_after jsonb)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE t text; b jsonb; a jsonb; item jsonb; sale_before jsonb; sale_after jsonb; ids integer[];flag_keys text[];
BEGIN
 IF p_before->'sourceHashes' IS DISTINCT FROM p_after->'sourceHashes' OR p_before->'roles' IS DISTINCT FROM p_after->'roles'
  OR p_before->'profiles' IS DISTINCT FROM p_after->'profiles' OR p_before->'head'<>'[]' OR jsonb_array_length(p_after->'head')<>1
 THEN RAISE EXCEPTION 'CUSTOMER_RECOVERY_UNREVIEWED_DELTA'; END IF;
 FOR t IN SELECT jsonb_object_keys(p_before->'public') LOOP
  IF t NOT IN('sales_customers','lead_project_interests','sales','plots','crm_settings')
   AND p_before->'public'->t IS DISTINCT FROM p_after->'public'->t THEN RAISE EXCEPTION 'CUSTOMER_RECOVERY_PRESERVED_RELATION_CHANGED'; END IF;
 END LOOP;
 FOREACH t IN ARRAY ARRAY['sales_customers','lead_project_interests'] LOOP
  b:=p_before->'public'->t;a:=p_after->'public'->t;
  IF jsonb_array_length(a)<>jsonb_array_length(b)+6 OR EXISTS(SELECT 1 FROM jsonb_array_elements(b) x
    WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(a) y WHERE x=y))
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(a) x WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(b) y WHERE x->>'id'=y->>'id')
    AND NOT EXISTS(SELECT 1 FROM sales_source_creation_private.records r WHERE r.id=(x->>'supplemental_creation_id')::uuid
     AND CASE t WHEN 'sales_customers' THEN r.customer_id ELSE r.interest_id END=(x->>'id')::uuid
     AND p_after->'creationIds' @> jsonb_build_array(r.id::text) AND NOT p_before->'creationIds' @> jsonb_build_array(r.id::text)))
  THEN RAISE EXCEPTION 'CUSTOMER_RECOVERY_CREATION_DELTA_REQUIRED'; END IF;
 END LOOP;
 SELECT array_agg(e.source_row ORDER BY e.source_row) INTO ids FROM sales_revision_private.events e
  WHERE p_after->'revisionIds' @> jsonb_build_array(e.id::text) AND NOT p_before->'revisionIds' @> jsonb_build_array(e.id::text);
 IF ids::text IS DISTINCT FROM '{926,944,964}' THEN RAISE EXCEPTION 'CUSTOMER_RECOVERY_REVISION_DELTA_REQUIRED'; END IF;
 b:=p_before->'public'->'sales';a:=p_after->'public'->'sales';
 IF jsonb_array_length(a)<>jsonb_array_length(b)-5 THEN RAISE EXCEPTION 'CUSTOMER_RECOVERY_SALE_COUNTS_REQUIRED'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(b) UNION ALL SELECT value FROM jsonb_array_elements(a) LOOP
  SELECT value INTO sale_before FROM jsonb_array_elements(b) WHERE value->>'id'=item->>'id';
  SELECT value INTO sale_after FROM jsonb_array_elements(a) WHERE value->>'id'=item->>'id';
  IF sale_before IS NOT DISTINCT FROM sale_after THEN CONTINUE; END IF;
  IF sale_after IS NULL THEN
   IF NOT EXISTS(SELECT 1 FROM rental_source_retirement_private.archives r WHERE r.sale_id=(item->>'id')::uuid
    AND r.before_image->'sale'=sale_before AND p_after->'rentalIds' @> jsonb_build_array(r.batch_id::text)
    AND NOT p_before->'rentalIds' @> jsonb_build_array(r.batch_id::text)) THEN RAISE EXCEPTION 'CUSTOMER_RECOVERY_SALE_DELTA_REQUIRED'; END IF;
  ELSIF NOT EXISTS(SELECT 1 FROM sales_revision_private.events e WHERE e.sale_id=(item->>'id')::uuid
    AND e.before_sale IS NOT DISTINCT FROM sale_before AND e.after_sale=sale_after
    AND p_after->'revisionIds' @> jsonb_build_array(e.id::text) AND NOT p_before->'revisionIds' @> jsonb_build_array(e.id::text))
   THEN RAISE EXCEPTION 'CUSTOMER_RECOVERY_SALE_DELTA_REQUIRED'; END IF;
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(p_after->'public'->'plots') LOOP
  SELECT value INTO b FROM jsonb_array_elements(p_before->'public'->'plots') WHERE value->>'id'=item->>'id';
  IF b IS NULL OR b-'has_customer'<>item-'has_customer' THEN RAISE EXCEPTION 'CUSTOMER_RECOVERY_CONSTRUCTION_DELTA_REQUIRED'; END IF;
 END LOOP;
 IF jsonb_array_length(p_before->'public'->'plots')<>jsonb_array_length(p_after->'public'->'plots')
  OR jsonb_array_length(p_before->'public'->'crm_settings')<>jsonb_array_length(p_after->'public'->'crm_settings')
 THEN RAISE EXCEPTION 'CUSTOMER_RECOVERY_CATALOG_ROW_DELTA_REQUIRED'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_after->'public'->'crm_settings') LOOP
  SELECT value INTO b FROM jsonb_array_elements(p_before->'public'->'crm_settings') WHERE value->>'id'=item->>'id';
  SELECT coalesce(array_agg(key),'{}') INTO flag_keys FROM jsonb_each(item) WHERE (key LIKE '%\_enabled' ESCAPE '\' OR key='booking_cutover_reviewed') AND jsonb_typeof(value)='boolean';
  IF b IS NULL OR b-flag_keys IS DISTINCT FROM item-flag_keys THEN RAISE EXCEPTION 'CUSTOMER_RECOVERY_FLAGS_ONLY_DELTA_REQUIRED'; END IF;
 END LOOP;
 FOREACH t IN ARRAY ARRAY['details','forecast'] LOOP
  FOR item IN SELECT value FROM jsonb_array_elements(p_before->t) UNION ALL SELECT value FROM jsonb_array_elements(p_after->t) LOOP
   SELECT value INTO b FROM jsonb_array_elements(p_before->t) WHERE value->>'sale_id'=item->>'sale_id';
   SELECT value INTO a FROM jsonb_array_elements(p_after->t) WHERE value->>'sale_id'=item->>'sale_id';
   IF b IS NOT DISTINCT FROM a THEN CONTINUE; END IF;
   IF NOT EXISTS(SELECT 1 FROM sales_import_private.detail_events e WHERE e.sale_id=(item->>'sale_id')::uuid
    AND p_after->'detailIds' @> jsonb_build_array(e.batch_id::text) AND NOT p_before->'detailIds' @> jsonb_build_array(e.batch_id::text)
    AND CASE t WHEN 'details' THEN e.before_details ELSE e.before_forecast END IS NOT DISTINCT FROM b
    AND CASE t WHEN 'details' THEN e.after_details ELSE e.after_forecast END IS NOT DISTINCT FROM a)
    AND NOT (t='details' AND EXISTS(SELECT 1 FROM sales_revision_private.events e WHERE e.sale_id=(item->>'sale_id')::uuid
      AND e.operation='cancel' AND p_after->'revisionIds' @> jsonb_build_array(e.id::text) AND NOT p_before->'revisionIds' @> jsonb_build_array(e.id::text)))
    THEN RAISE EXCEPTION 'CUSTOMER_RECOVERY_CORRECTION_DELTA_REQUIRED'; END IF;
  END LOOP;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM customer_source_membership_private.revisions r WHERE r.id=(p_after->'head'->0->>'revision_id')::uuid
  AND r.payload->>'sourceSha256'='7193857ef04d6a092171749a25867b1ca8d1bbe8f7b83b04fa7473b3a3a69ffd'
  AND jsonb_array_length(r.payload->'records')=958) THEN RAISE EXCEPTION 'CUSTOMER_RECOVERY_MEMBERSHIP_REQUIRED'; END IF;
END; $$;

CREATE FUNCTION sales_recovery_private.seal_run(p_run uuid,p_review text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE r sales_recovery_private.runs%ROWTYPE; captured jsonb;known sales_recovery_private.seals%ROWTYPE;
BEGIN
 PERFORM sales_recovery_private.operator(); PERFORM sales_recovery_private.assert_adapters();
 PERFORM pg_advisory_xact_lock(hashtextextended('crm-booking-command',0));
 SELECT * INTO STRICT r FROM sales_recovery_private.runs WHERE id=p_run FOR SHARE;
 IF coalesce(length(btrim(p_review)),0)=0 THEN RAISE EXCEPTION 'CUSTOMER_RECOVERY_REVIEW_REQUIRED'; END IF;
 captured:=sales_recovery_private.snapshot();PERFORM sales_recovery_private.validate_delta(r.before_state,captured);
 SELECT * INTO known FROM sales_recovery_private.seals WHERE run_id=p_run;
 IF FOUND THEN
  IF known.after_state IS DISTINCT FROM captured THEN RAISE EXCEPTION 'CUSTOMER_RECOVERY_SEAL_REPLAY_CONFLICT'; END IF;
  RETURN jsonb_build_object('runId',p_run,'sealed',true,'replayed',true,'physicalParentRestore',false);
 END IF;
 INSERT INTO sales_recovery_private.seals VALUES(p_run,captured,auth.uid(),p_review,now());
 RETURN jsonb_build_object('runId',p_run,'sealed',true,'physicalParentRestore',false);
END; $$;

-- Dynamic record restoration uses actual catalog columns; generated/identity
-- columns are rejected rather than guessed or silently overwritten.
CREATE FUNCTION sales_recovery_private.write_row(p_relation text,p_key text,p_id text,p_row jsonb)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE target text; columns text; select_columns text;changed integer;
BEGIN
 PERFORM sales_recovery_private.operator();
 target:=CASE p_relation WHEN 'sales' THEN 'public.sales' WHEN 'deal_details_corrections' THEN 'sales_private.deal_details_corrections'
  WHEN 'forecast_corrections' THEN 'sales_import_private.forecast_corrections' WHEN 'plots' THEN 'public.plots' WHEN 'crm_settings' THEN 'public.crm_settings' END;
 IF target IS NULL OR p_key IS DISTINCT FROM (CASE WHEN p_relation IN('deal_details_corrections','forecast_corrections') THEN 'sale_id' ELSE 'id' END)
  OR EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=target::regclass AND attnum>0 AND NOT attisdropped AND (attgenerated<>'' OR attidentity<>''))
  THEN RAISE EXCEPTION 'CUSTOMER_RECOVERY_RECORD_CATALOG_REQUIRED'; END IF;
 IF p_row IS NULL THEN EXECUTE format('DELETE FROM %s x WHERE to_jsonb(x)->>%L=$1',target,p_key) USING p_id; RETURN; END IF;
 IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_row) k) IS DISTINCT FROM
  (SELECT array_agg(attname::text ORDER BY attname) FROM pg_attribute WHERE attrelid=target::regclass AND attnum>0 AND NOT attisdropped)
 THEN RAISE EXCEPTION 'CUSTOMER_RECOVERY_FULL_ROW_REQUIRED'; END IF;
 SELECT string_agg(format('%I',attname),',' ORDER BY attnum),string_agg(format('src.%I',attname),',' ORDER BY attnum) INTO columns,select_columns
  FROM pg_attribute WHERE attrelid=target::regclass AND attnum>0 AND NOT attisdropped;
 EXECUTE format('UPDATE %s x SET (%s)=(SELECT %s FROM jsonb_populate_record(NULL::%s,$1) src) WHERE to_jsonb(x)->>%L=$2',target,columns,select_columns,target,p_key) USING p_row,p_id;
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed=0 THEN EXECUTE format('INSERT INTO %s SELECT (jsonb_populate_record(NULL::%s,$1)).*',target,target) USING p_row; END IF;
END; $$;

CREATE FUNCTION sales_recovery_private.restore_run(p_run uuid,p_review text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog SET lock_timeout='2s' AS $$
DECLARE r sales_recovery_private.runs%ROWTYPE;s sales_recovery_private.seals%ROWTYPE;captured jsonb;current_state jsonb;
 t text;target_relation text;key_name text;item jsonb;before_row jsonb;after_row jsonb;v_entity_id text;old_pub jsonb;now_pub jsonb;batch uuid;
BEGIN
 PERFORM sales_recovery_private.operator();PERFORM sales_recovery_private.assert_adapters();
 PERFORM pg_advisory_xact_lock(hashtextextended('crm-booking-command',0));
 SELECT * INTO STRICT r FROM sales_recovery_private.runs WHERE id=p_run FOR SHARE;
 SELECT * INTO STRICT s FROM sales_recovery_private.seals WHERE run_id=p_run FOR SHARE;
 IF coalesce(length(btrim(p_review)),0)=0 THEN RAISE EXCEPTION 'CUSTOMER_RECOVERY_REVIEW_REQUIRED'; END IF;
 IF EXISTS(SELECT 1 FROM sales_recovery_private.recoveries WHERE run_id=p_run) THEN
  RETURN jsonb_build_object('runId',p_run,'restored',true,'replayed',true,'physicalParentsRetained',true);
 END IF;
 -- Lock every captured business table against concurrent inserts as well as
 -- updates. Role changes and immutable source changes are compared below.
 FOR t IN SELECT jsonb_object_keys(r.before_state->'public') ORDER BY 1 LOOP EXECUTE format('LOCK TABLE public.%I IN SHARE ROW EXCLUSIVE MODE',t); END LOOP;
 LOCK TABLE sales_private.deal_details_corrections,sales_private.customer_profile_corrections,sales_import_private.forecast_corrections,
  customer_source_membership_private.head IN SHARE ROW EXCLUSIVE MODE;
 captured:=sales_recovery_private.snapshot();
 IF captured IS DISTINCT FROM s.after_state THEN RAISE EXCEPTION 'CUSTOMER_RECOVERY_AFTER_STATE_DRIFT'; END IF;
 PERFORM sales_recovery_private.validate_delta(r.before_state,s.after_state);
 PERFORM customer_source_membership_private.deactivate((s.after_state->'head'->0->>'revision_id')::uuid,p_review);
 -- Arm exact plot permits before inverse Sale mutations run the unchanged sync.
 FOR item IN SELECT value FROM jsonb_array_elements(s.after_state->'public'->'plots') LOOP
  SELECT value INTO before_row FROM jsonb_array_elements(r.before_state->'public'->'plots') WHERE value->>'id'=item->>'id';
  IF before_row IS DISTINCT FROM item THEN INSERT INTO sales_recovery_private.permits VALUES(txid_current(),pg_backend_pid(),auth.uid(),p_run,'plots',item->>'id',item,before_row); END IF;
 END LOOP;
 FOREACH t IN ARRAY ARRAY['details','forecast','sales'] LOOP
  target_relation:=CASE t WHEN 'details' THEN 'deal_details_corrections' WHEN 'forecast' THEN 'forecast_corrections' ELSE 'sales' END;
  key_name:=CASE t WHEN 'sales' THEN 'id' ELSE 'sale_id' END;
  old_pub:=CASE t WHEN 'sales' THEN r.before_state->'public'->'sales' ELSE r.before_state->t END;
  now_pub:=CASE t WHEN 'sales' THEN s.after_state->'public'->'sales' ELSE s.after_state->t END;
  FOR v_entity_id IN SELECT value->>key_name FROM jsonb_array_elements(old_pub) UNION SELECT value->>key_name FROM jsonb_array_elements(now_pub) ORDER BY 1 LOOP
   SELECT value INTO before_row FROM jsonb_array_elements(old_pub) WHERE value->>key_name=v_entity_id;
   SELECT value INTO after_row FROM jsonb_array_elements(now_pub) WHERE value->>key_name=v_entity_id;
   IF before_row IS NOT DISTINCT FROM after_row THEN CONTINUE; END IF;
   INSERT INTO sales_recovery_private.permits VALUES(txid_current(),pg_backend_pid(),auth.uid(),p_run,target_relation,v_entity_id,after_row,before_row);
   PERFORM sales_recovery_private.write_row(target_relation,key_name,v_entity_id,before_row);
   DELETE FROM sales_recovery_private.permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid() AND relation_name=target_relation AND entity_id=v_entity_id;
  END LOOP;
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(r.before_state->'public'->'plots') LOOP
  IF EXISTS(SELECT 1 FROM sales_recovery_private.permits p WHERE p.transaction_id=txid_current() AND p.backend_pid=pg_backend_pid() AND p.relation_name='plots' AND p.entity_id=item->>'id')
   THEN PERFORM sales_recovery_private.write_row('plots','id',item->>'id',item); END IF;
 END LOOP;
 DELETE FROM sales_recovery_private.permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid();
 FOR item IN SELECT value FROM jsonb_array_elements(r.before_state->'public'->'crm_settings') LOOP
  SELECT to_jsonb(flags) INTO after_row FROM public.crm_settings flags WHERE flags.id=(item->>'id')::boolean;
  IF after_row IS DISTINCT FROM item THEN PERFORM sales_recovery_private.write_row('crm_settings','id',item->>'id',item); END IF;
 END LOOP;
 FOR batch IN SELECT (value#>>'{}')::uuid FROM jsonb_array_elements(s.after_state->'rentalIds') WHERE NOT r.before_state->'rentalIds' @> jsonb_build_array(value) LOOP
  INSERT INTO rental_source_retirement_private.restores(batch_id,actor_id,review_reference) VALUES(batch,auth.uid(),p_review);
 END LOOP;
 -- Verify the complete business pre-image while retaining only the six sealed
 -- audit parents absent from the captured before-image. A late receipt failure
 -- rolls the whole compensation back, including membership and all row writes.
 current_state:=sales_recovery_private.snapshot();
 FOREACH t IN ARRAY ARRAY['sales_customers','lead_project_interests'] LOOP
  SELECT coalesce(jsonb_agg(current_parent.row ORDER BY current_parent.row::text),'[]') INTO now_pub FROM jsonb_array_elements(current_state->'public'->t) AS current_parent(row)
   WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(r.before_state->'public'->t) AS old_parent(row) WHERE old_parent.row->>'id'=current_parent.row->>'id');
  current_state:=jsonb_set(current_state,ARRAY['public',t],now_pub);
 END LOOP;
 IF current_state->'public' IS DISTINCT FROM r.before_state->'public' OR current_state->'roles' IS DISTINCT FROM r.before_state->'roles'
  OR current_state->'sourceHashes' IS DISTINCT FROM r.before_state->'sourceHashes' OR current_state->'details' IS DISTINCT FROM r.before_state->'details'
  OR current_state->'forecast' IS DISTINCT FROM r.before_state->'forecast' OR current_state->'profiles' IS DISTINCT FROM r.before_state->'profiles'
  OR current_state->'head' IS DISTINCT FROM r.before_state->'head' THEN
   RAISE EXCEPTION 'CUSTOMER_RECOVERY_BEFORE_BUSINESS_PARITY_REQUIRED: %', jsonb_build_object(
    'sections',(SELECT jsonb_agg(k) FROM unnest(ARRAY['public','roles','sourceHashes','details','forecast','profiles','head']) k WHERE current_state->k IS DISTINCT FROM r.before_state->k),
    'publicRelations',(SELECT jsonb_agg(k) FROM jsonb_object_keys(r.before_state->'public') k WHERE current_state->'public'->k IS DISTINCT FROM r.before_state->'public'->k));
  END IF;
 INSERT INTO sales_recovery_private.recoveries VALUES(p_run,current_state,auth.uid(),p_review,true,now());
 RETURN jsonb_build_object('runId',p_run,'restored',true,'replayed',false,'physicalParentsRetained',true,'immutableEvidenceRetained',true);
END; $$;

-- Event and membership insertion maintain immutable Sale identities. Exact FK
-- migration and exact original-body adapters are generated separately and must
-- be reviewed/installed in the same installation transaction before begin_run.
CREATE FUNCTION sales_recovery_private.anchor_sale()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN PERFORM sales_recovery_private.operator(); IF NEW.sale_id IS NOT NULL THEN INSERT INTO sales_recovery_private.sale_identities VALUES(NEW.sale_id) ON CONFLICT DO NOTHING; END IF; RETURN NEW; END; $$;
CREATE TRIGGER recovery_event_sale_identity BEFORE INSERT ON sales_revision_private.events FOR EACH ROW EXECUTE FUNCTION sales_recovery_private.anchor_sale();
CREATE TRIGGER recovery_membership_sale_identity BEFORE INSERT ON customer_source_membership_private.members FOR EACH ROW EXECUTE FUNCTION sales_recovery_private.anchor_sale();
REVOKE ALL ON ALL TABLES IN SCHEMA sales_recovery_private FROM PUBLIC,anon,authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA sales_recovery_private FROM PUBLIC,anon,authenticated;

-- DESIGN ONLY: install only after the exact 25-32 composition is rehearsed.
-- Separate DB-owner operator authority; designated reviewer is audit provenance,
-- never a claim that this SQL owner authenticated as that human. No Auth writes,
-- fake sessions/JWTs, public role changes or application grants are permitted.

-- Design sentinel cleared only in this reviewed installation artifact.
CREATE SCHEMA sales_operator_private;
REVOKE ALL ON SCHEMA sales_operator_private FROM PUBLIC,anon,authenticated,service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA sales_operator_private REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
CREATE TABLE sales_operator_private.jobs(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),manifest jsonb NOT NULL,payload_sha256 text NOT NULL UNIQUE,
 recorded_by_db_role name NOT NULL,authorization_reference text NOT NULL,designated_reviewer_id uuid NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sales_operator_private.contexts(
 transaction_id bigint NOT NULL,backend_pid integer NOT NULL,db_role name NOT NULL,
 job_id uuid REFERENCES sales_operator_private.jobs,reviewer_id uuid NOT NULL,
 purpose text NOT NULL CHECK(purpose IN('metadata','preview','apply','restore')),before_run_ids jsonb NOT NULL DEFAULT '[]',
 PRIMARY KEY(transaction_id,backend_pid)
);
CREATE TABLE sales_operator_private.receipts(
 job_id uuid PRIMARY KEY REFERENCES sales_operator_private.jobs,recovery_run_id uuid NOT NULL,
 source_rows integer NOT NULL CHECK(source_rows=958),before_sha256 text NOT NULL,after_sha256 text NOT NULL,
 executed_by_db_role name NOT NULL,session_db_role name NOT NULL,designated_reviewer_id uuid NOT NULL,
 authorization_reference text NOT NULL,reviewer_is_authenticated_actor boolean NOT NULL CHECK(NOT reviewer_is_authenticated_actor),
 recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sales_operator_private.adapters(
 signature text PRIMARY KEY,before_md5 text NOT NULL,after_md5 text NOT NULL,settings text[],security_definer boolean NOT NULL
);
CREATE FUNCTION sales_operator_private.require_owner() RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF current_user IS DISTINCT FROM session_user OR current_user IS DISTINCT FROM
  (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid='sales_operator_private.jobs'::regclass)
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CUSTOMER_OPERATOR_DB_OWNER_REQUIRED'; END IF;
END; $$;
CREATE FUNCTION sales_operator_private.check_reviewer(p_reviewer uuid) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM sales_operator_private.require_owner();
 PERFORM 1 FROM account_security_private.reviewed_roles r
 JOIN account_security_private.reviewed_admins a ON a.auth_user_id=r.auth_user_id AND a.legacy_user_id=r.legacy_user_id
 JOIN sales_private.crm_user_roles c ON c.user_id=r.auth_user_id
 JOIN auth.users u ON u.id=r.auth_user_id JOIN public.users p ON p.id=r.legacy_user_id
 WHERE r.auth_user_id=p_reviewer AND r.role='Admin' AND r.enabled AND r.review_revision>0 AND a.enabled
  AND c.role='admin' AND c.is_active AND c.trusted_review_revision=r.review_revision
  AND u.deleted_at IS NULL AND NOT COALESCE(u.is_anonymous,false)
  AND (u.banned_until IS NULL OR u.banned_until<=statement_timestamp())
  AND NOT EXISTS(SELECT 1 FROM account_security_private.crm_auth_suspensions s WHERE s.auth_user_id=r.auth_user_id AND s.review_revision>=r.review_revision)
 FOR SHARE OF r,a,c,u;
 IF NOT FOUND THEN RAISE EXCEPTION 'CUSTOMER_OPERATOR_DESIGNATED_REVIEWER_UNAVAILABLE'; END IF;
END; $$;
CREATE FUNCTION sales_operator_private.actor() RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE result uuid;
BEGIN
 IF current_user=session_user AND current_user=(SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid='sales_operator_private.jobs'::regclass) THEN
  SELECT reviewer_id INTO result FROM sales_operator_private.contexts
   WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid() AND db_role=current_user;
  IF FOUND THEN RETURN result; END IF;
 END IF;
 RETURN auth.uid();
END; $$;
CREATE FUNCTION sales_operator_private.operator_role() RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF current_user=session_user AND current_user=(SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid='sales_operator_private.jobs'::regclass)
  AND EXISTS(SELECT 1 FROM sales_operator_private.contexts WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid() AND db_role=current_user)
 THEN RETURN 'admin'; END IF;
 RETURN public.crm_v2_role();
END; $$;
CREATE FUNCTION sales_operator_private.digest(v jsonb) RETURNS text LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT encode(sha256(convert_to(v::text,'UTF8')),'hex');
$$;
CREATE FUNCTION sales_operator_private.sealed() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'CUSTOMER_OPERATOR_IMMUTABLE'; END; $$;
CREATE FUNCTION sales_operator_private.insert_owner() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN PERFORM sales_operator_private.require_owner(); RETURN NEW; END; $$;
CREATE FUNCTION sales_operator_private.no_open_context() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM sales_operator_private.contexts WHERE transaction_id=NEW.transaction_id AND backend_pid=NEW.backend_pid)
 THEN RAISE EXCEPTION 'CUSTOMER_OPERATOR_WHOLE_TRANSACTION_NOT_FINISHED'; END IF;
 RETURN NULL;
END; $$;
-- Only exact reviewed DDL/adapter/identity-anchor preparation uses this context.
-- The full private import entrypoints reject metadata purpose. No Auth identity
-- or human-session impersonation is installed by this owner-only preparation.
CREATE FUNCTION sales_operator_private.begin_metadata(p_reviewer uuid) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM sales_operator_private.check_reviewer(p_reviewer);
 INSERT INTO sales_operator_private.contexts(transaction_id,backend_pid,db_role,reviewer_id,purpose)
 VALUES(txid_current(),pg_backend_pid(),current_user,p_reviewer,'metadata');
END; $$;
CREATE FUNCTION sales_operator_private.finish_metadata() RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM sales_operator_private.require_owner();
 DELETE FROM sales_operator_private.contexts WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid() AND db_role=current_user AND purpose='metadata';
 IF NOT FOUND THEN RAISE EXCEPTION 'CUSTOMER_OPERATOR_METADATA_CONTEXT_REQUIRED'; END IF;
END; $$;
CREATE CONSTRAINT TRIGGER operator_context_must_finish AFTER INSERT ON sales_operator_private.contexts DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION sales_operator_private.no_open_context();
DO $guards$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['jobs','contexts','receipts','adapters'] LOOP
  EXECUTE format('ALTER TABLE sales_operator_private.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON TABLE sales_operator_private.%I FROM PUBLIC,anon,authenticated,service_role',t);
  EXECUTE format('CREATE TRIGGER operator_insert_owner BEFORE INSERT ON sales_operator_private.%I FOR EACH ROW EXECUTE FUNCTION sales_operator_private.insert_owner()',t);
  EXECUTE format('CREATE TRIGGER operator_no_truncate BEFORE TRUNCATE ON sales_operator_private.%I FOR EACH STATEMENT EXECUTE FUNCTION sales_operator_private.sealed()',t);
  IF t<>'contexts' THEN EXECUTE format('CREATE TRIGGER operator_immutable BEFORE UPDATE OR DELETE ON sales_operator_private.%I FOR EACH STATEMENT EXECUTE FUNCTION sales_operator_private.sealed()',t); END IF;
 END LOOP;
END; $guards$;
CREATE FUNCTION sales_operator_private.assert_catalog() RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM sales_operator_private.require_owner();
 IF NOT EXISTS(SELECT 1 FROM sales_operator_private.adapters) OR EXISTS(
  SELECT 1 FROM sales_operator_private.adapters a LEFT JOIN pg_proc p ON p.oid=to_regprocedure(a.signature)
  WHERE p.oid IS NULL OR md5(replace(p.prosrc,E'\r\n',E'\n')) IS DISTINCT FROM a.after_md5
   OR pg_get_userbyid(p.proowner)<>current_user OR p.prosecdef IS DISTINCT FROM a.security_definer OR p.proconfig IS DISTINCT FROM a.settings)
 THEN RAISE EXCEPTION 'CUSTOMER_OPERATOR_EXACT_ADAPTER_DRIFT'; END IF;
END; $$;
CREATE FUNCTION sales_operator_private.adapter_matches(p_signature text,p_before_md5 text,p_current_md5 text)
 RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT p_before_md5=p_current_md5 OR EXISTS(SELECT 1 FROM sales_operator_private.adapters a
  WHERE a.signature=p_signature AND a.before_md5=p_before_md5 AND a.after_md5=p_current_md5);
$$;
-- Resolve only runtime-generated IDs tied to an already approved creation row.
-- Known identities remain exact; original 27/28/31 source/row/UUID guards remain.
CREATE FUNCTION sales_operator_private.normalized_payload(p_scope text,p_value jsonb,p_expected jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE rows jsonb; expected_by_row jsonb;
BEGIN
 IF p_scope NOT IN('lifecycle','membership') THEN RETURN p_value; END IF;
 SELECT coalesce(jsonb_object_agg(e.value->>'sourceRow',e.value),'{}') INTO expected_by_row FROM jsonb_array_elements(p_expected->'records') AS e(value);
 IF (SELECT count(*) FROM jsonb_each(expected_by_row))<>jsonb_array_length(p_expected->'records')
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_value->'records') AS a(value) WHERE NOT expected_by_row ? (a.value->>'sourceRow'))
 THEN RAISE EXCEPTION 'CUSTOMER_OPERATOR_PAYLOAD_SOURCE_DRIFT'; END IF;
 SELECT coalesce(jsonb_agg(CASE WHEN p_scope='lifecycle' THEN a.value-'before' ELSE
   a.value-ARRAY['customerCandidateKey','interestCandidateKey','newBookingCandidateKey']
    -CASE WHEN expected_by_row->(a.value->>'sourceRow')->>'customerCandidateKey' IS NOT NULL THEN ARRAY['customerId'] ELSE ARRAY[]::text[] END
    -CASE WHEN expected_by_row->(a.value->>'sourceRow')->>'interestCandidateKey' IS NOT NULL THEN ARRAY['interestId'] ELSE ARRAY[]::text[] END
    -CASE WHEN expected_by_row->(a.value->>'sourceRow')->>'newBookingCandidateKey' IS NOT NULL THEN ARRAY['saleId'] ELSE ARRAY[]::text[] END
  END ORDER BY a.ordinal),'[]') INTO rows FROM jsonb_array_elements(p_value->'records') WITH ORDINALITY AS a(value,ordinal);
 RETURN jsonb_set(p_value,'{records}',rows);
END; $$;
CREATE FUNCTION sales_operator_private.authorize_payload(p_scope text,p_value jsonb) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE context sales_operator_private.contexts%ROWTYPE; expected jsonb;
BEGIN
 -- A normal authenticated path keeps its exact original authorization branch.
 IF current_user<>session_user THEN RETURN; END IF;
 SELECT * INTO context FROM sales_operator_private.contexts WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid() AND db_role=current_user;
 IF NOT FOUND THEN RETURN; END IF;
 PERFORM sales_operator_private.require_owner();
 IF context.purpose<>'apply' OR p_scope NOT IN('creation','unknown','details','lifecycle','rentalManifest','rental','membership') THEN RAISE EXCEPTION 'CUSTOMER_OPERATOR_SCOPE_FORBIDDEN'; END IF;
 SELECT manifest->'payloads'->p_scope INTO expected FROM sales_operator_private.jobs WHERE id=context.job_id;
 IF expected IS NULL OR sales_operator_private.normalized_payload(p_scope,p_value,expected) IS DISTINCT FROM sales_operator_private.normalized_payload(p_scope,expected,expected)
 THEN RAISE EXCEPTION 'CUSTOMER_OPERATOR_EXACT_PAYLOAD_REQUIRED'; END IF;
END; $$;
CREATE FUNCTION sales_operator_private.authorize_journal(p_operation text,p_run uuid,p_review text) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE c sales_operator_private.contexts%ROWTYPE;j sales_operator_private.jobs%ROWTYPE;
BEGIN
 IF current_user<>session_user THEN RETURN; END IF;
 SELECT * INTO c FROM sales_operator_private.contexts WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid() AND db_role=current_user;
 IF NOT FOUND THEN RETURN; END IF;
 PERFORM sales_operator_private.require_owner(); SELECT * INTO STRICT j FROM sales_operator_private.jobs WHERE id=c.job_id;
 IF p_review IS DISTINCT FROM j.manifest->>'reviewReference'
  OR (p_operation IN('begin','seal') AND c.purpose<>'apply')
  OR (p_operation='restore' AND (c.purpose<>'restore' OR p_run IS DISTINCT FROM (j.manifest->>'recoveryRunId')::uuid))
  OR p_operation NOT IN('begin','seal','restore')
 THEN RAISE EXCEPTION 'CUSTOMER_OPERATOR_JOURNAL_SCOPE_REQUIRED'; END IF;
END; $$;
CREATE FUNCTION sales_operator_private.register_job(p_manifest jsonb,p_expected_payload_hash text) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE result uuid;actual_hash text;
BEGIN
 PERFORM sales_operator_private.require_owner();
 IF p_manifest->>'version' IS DISTINCT FROM 'approved-whole-replacement-operator-v1'
  OR p_manifest->>'datasetKey' IS DISTINCT FROM 'full-replacement-379da2e538829a3cb0379108b98851757c142eb010b1624543413116eef8a506'
  OR p_manifest->>'sourceSha256' IS DISTINCT FROM '7193857ef04d6a092171749a25867b1ca8d1bbe8f7b83b04fa7473b3a3a69ffd'
  OR p_manifest->>'reviewSha256' IS DISTINCT FROM 'de4beaee70afa8de9e8866e328eabf8bdd25257eae7aa78eb89649712f381802'
  OR p_manifest->>'inputDigest' IS DISTINCT FROM 'c24b45f03a5a8cf2854f893136b8c6e54656839e0db1a867fd27a177ba73f581'
  OR p_manifest->>'adapterPlanDigest' IS DISTINCT FROM '379da2e538829a3cb0379108b98851757c142eb010b1624543413116eef8a506'
  OR p_manifest->>'sourceBatchId' IS DISTINCT FROM '5d3f05d2-2a5d-44ed-a0e3-9385b8ace3a5'
  OR p_manifest->>'originalArchiveSha256' IS DISTINCT FROM '9ad3ddc7644e673de9d180d064f1939ff3fe267b1c6989c3124620c2320f8b23'
  OR p_manifest->'approvedSourceCount' IS DISTINCT FROM '958'::jsonb OR coalesce(p_manifest->>'mode','') NOT IN('apply','restore')
  OR coalesce(p_manifest->>'beforeStateHash','') !~ '^[0-9a-f]{64}$'
  OR coalesce(p_manifest->>'authorizationReference','')='' OR length(p_manifest->>'authorizationReference')>1000
  OR coalesce(p_manifest->>'reviewReference','')='' OR length(p_manifest->>'reviewReference')>1000
  OR coalesce(p_manifest->>'preparedPayloadDigest','') !~ '^[0-9a-f]{64}$'
 THEN RAISE EXCEPTION 'CUSTOMER_OPERATOR_PINNED_JOB_REQUIRED'; END IF;
 PERFORM sales_operator_private.check_reviewer((p_manifest->>'designatedReviewerId')::uuid);
 IF p_manifest->>'mode'='restore' AND coalesce(p_manifest->>'recoveryRunId','') !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'CUSTOMER_OPERATOR_RECOVERY_RUN_REQUIRED'; END IF;
 IF p_manifest->>'mode'='apply' AND (jsonb_typeof(p_manifest->'payloads'->'membership'->'records') IS DISTINCT FROM 'array'
  OR jsonb_array_length(p_manifest->'payloads'->'membership'->'records')<>958) THEN RAISE EXCEPTION 'CUSTOMER_OPERATOR_WHOLE_SOURCE_REQUIRED'; END IF;
 actual_hash:=sales_operator_private.digest(p_manifest);
 IF actual_hash IS DISTINCT FROM p_expected_payload_hash THEN RAISE EXCEPTION 'CUSTOMER_OPERATOR_JOB_PAYLOAD_DRIFT'; END IF;
 INSERT INTO sales_operator_private.jobs(manifest,payload_sha256,recorded_by_db_role,authorization_reference,designated_reviewer_id)
 VALUES(p_manifest,actual_hash,current_user,p_manifest->>'authorizationReference',(p_manifest->>'designatedReviewerId')::uuid) RETURNING id INTO result;
 RETURN result;
END; $$;
-- Read-only hash preparation with temporary owner context; never exposes raw
-- snapshot rows. Private import entrypoints reject this preview purpose.
CREATE FUNCTION sales_operator_private.preview_state(p_reviewer uuid) RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE result text;
BEGIN
 PERFORM sales_operator_private.check_reviewer(p_reviewer); PERFORM sales_operator_private.assert_catalog();
 INSERT INTO sales_operator_private.contexts(transaction_id,backend_pid,db_role,reviewer_id,purpose) VALUES(txid_current(),pg_backend_pid(),current_user,p_reviewer,'preview');
 result:=sales_operator_private.digest(sales_recovery_private.snapshot());
 DELETE FROM sales_operator_private.contexts WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid();
 RETURN result;
END; $$;
CREATE FUNCTION sales_operator_private.begin_job(p_job uuid,p_expected_hash text) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE j sales_operator_private.jobs%ROWTYPE;before_hash text;
BEGIN
 PERFORM sales_operator_private.require_owner();
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'CUSTOMER_OPERATOR_READ_COMMITTED_REQUIRED'; END IF;
 SELECT * INTO STRICT j FROM sales_operator_private.jobs WHERE id=p_job FOR UPDATE;
 IF j.recorded_by_db_role<>current_user OR j.payload_sha256 IS DISTINCT FROM p_expected_hash OR sales_operator_private.digest(j.manifest) IS DISTINCT FROM p_expected_hash
  OR EXISTS(SELECT 1 FROM sales_operator_private.receipts WHERE job_id=p_job) THEN RAISE EXCEPTION 'CUSTOMER_OPERATOR_JOB_REPLAY_OR_DRIFT'; END IF;
 PERFORM sales_operator_private.check_reviewer(j.designated_reviewer_id); PERFORM sales_operator_private.assert_catalog();
 PERFORM pg_advisory_xact_lock(hashtextextended('crm-booking-command',0));
 LOCK TABLE public.sales_customers,public.lead_project_interests,public.sales,public.plots,public.crm_settings IN SHARE ROW EXCLUSIVE MODE;
 LOCK TABLE crm_external_private.snapshot_batches,crm_external_private.source_records IN SHARE MODE;
 -- The immutable original archive predates the approved workbook revision.
 -- Its own hash remains pinned independently; never rewrite the old archive.
 IF NOT EXISTS(SELECT 1 FROM crm_external_private.snapshot_batches b WHERE b.id=(j.manifest->>'sourceBatchId')::uuid AND b.source_sha256=j.manifest->>'originalArchiveSha256')
  OR (SELECT count(*) FROM crm_external_private.source_records WHERE batch_id=(j.manifest->>'sourceBatchId')::uuid)<>965
 THEN RAISE EXCEPTION 'CUSTOMER_OPERATOR_SOURCE_CAPTURE_DRIFT'; END IF;
 INSERT INTO sales_operator_private.contexts(transaction_id,backend_pid,db_role,job_id,reviewer_id,purpose,before_run_ids)
 SELECT txid_current(),pg_backend_pid(),current_user,j.id,j.designated_reviewer_id,j.manifest->>'mode',coalesce(jsonb_agg(id::text),'[]') FROM sales_recovery_private.runs;
 before_hash:=sales_operator_private.digest(sales_recovery_private.snapshot());
 IF before_hash IS DISTINCT FROM j.manifest->>'beforeStateHash' THEN RAISE EXCEPTION 'CUSTOMER_OPERATOR_BEFORE_STATE_DRIFT'; END IF;
END; $$;
CREATE FUNCTION sales_operator_private.finish_job(p_job uuid,p_run uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE j sales_operator_private.jobs%ROWTYPE;c sales_operator_private.contexts%ROWTYPE;after_hash text;
BEGIN
 PERFORM sales_operator_private.require_owner(); PERFORM sales_operator_private.assert_catalog();
 SELECT * INTO STRICT c FROM sales_operator_private.contexts WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid() AND db_role=current_user AND job_id=p_job;
 SELECT * INTO STRICT j FROM sales_operator_private.jobs WHERE id=p_job;
 IF c.purpose='apply' THEN
  IF c.before_run_ids @> jsonb_build_array(p_run::text) OR NOT EXISTS(
   SELECT 1 FROM sales_recovery_private.runs r JOIN sales_recovery_private.seals s ON s.run_id=r.id
    WHERE r.id=p_run AND r.actor_id=c.reviewer_id AND s.actor_id=c.reviewer_id
     AND r.source_sha256=j.manifest->>'sourceSha256' AND sales_operator_private.digest(r.before_state)=j.manifest->>'beforeStateHash'
     AND s.after_state=sales_recovery_private.snapshot())
   OR (SELECT count(*) FROM customer_source_membership_private.members m JOIN customer_source_membership_private.head h ON h.revision_id=m.revision_id)<>958
  THEN RAISE EXCEPTION 'CUSTOMER_OPERATOR_WHOLE_SEAL_REQUIRED'; END IF;
 ELSE
  IF c.purpose<>'restore' OR p_run IS DISTINCT FROM (j.manifest->>'recoveryRunId')::uuid
   OR NOT EXISTS(SELECT 1 FROM sales_recovery_private.recoveries WHERE run_id=p_run AND actor_id=c.reviewer_id AND created_at=transaction_timestamp())
   OR EXISTS(SELECT 1 FROM customer_source_membership_private.head)
  THEN RAISE EXCEPTION 'CUSTOMER_OPERATOR_WHOLE_RECOVERY_REQUIRED'; END IF;
 END IF;
 after_hash:=sales_operator_private.digest(sales_recovery_private.snapshot());
 INSERT INTO sales_operator_private.receipts VALUES(j.id,p_run,958,j.manifest->>'beforeStateHash',after_hash,current_user,session_user,c.reviewer_id,j.authorization_reference,false,now());
 DELETE FROM sales_operator_private.contexts WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid();
 RETURN jsonb_build_object('jobId',j.id,'sourceRows',958,'executionAuthority','database_owner','executedByDbRole',current_user,'designatedReviewerId',c.reviewer_id,'reviewerAuthenticated',false,'afterSha256',after_hash);
END; $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA sales_operator_private FROM PUBLIC,anon,authenticated,service_role;

-- Exact private DB-owner adapters; actual Auth is unchanged outside a registered owner job.
DO $operator_adapter_0$
DECLARE definition text;body text;
BEGIN
 PERFORM sales_operator_private.require_owner();
 SELECT replace(pg_get_functiondef(oid),E'\r\n',E'\n'),replace(prosrc,E'\r\n',E'\n') INTO definition,body FROM pg_proc WHERE oid='sales_recovery_private.operator()'::regprocedure;
 IF body IS DISTINCT FROM '
BEGIN
 IF current_user IS DISTINCT FROM session_user
  OR current_user IS DISTINCT FROM (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid=''sales_recovery_private.runs''::regclass)
  OR auth.uid() IS NULL OR public.crm_v2_role() IS DISTINCT FROM ''admin''
 THEN RAISE EXCEPTION ''CUSTOMER_RECOVERY_OPERATOR_REQUIRED''; END IF;
 PERFORM 1 FROM sales_private.crm_user_roles WHERE user_id=auth.uid() AND role=''admin'' AND is_active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION ''CUSTOMER_RECOVERY_OPERATOR_REQUIRED''; END IF;
END; ' OR md5(body) IS DISTINCT FROM '5aa17590b2e332318a02803649729e22'
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='sales_recovery_private.operator()'::regprocedure AND pg_get_userbyid(proowner)=current_user AND prosecdef=false AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[])
  OR (length(definition)-length(replace(definition,body,'')))/length(body)<>1
 THEN RAISE EXCEPTION 'CUSTOMER_OPERATOR_EXACT_ADAPTER_REVIEW_REQUIRED'; END IF;
 EXECUTE replace(definition,body,'
BEGIN
 IF current_user IS DISTINCT FROM session_user
  OR current_user IS DISTINCT FROM (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid=''sales_recovery_private.runs''::regclass)
  OR sales_operator_private.actor() IS NULL OR sales_operator_private.operator_role() IS DISTINCT FROM ''admin''
 THEN RAISE EXCEPTION ''CUSTOMER_RECOVERY_OPERATOR_REQUIRED''; END IF;
 PERFORM 1 FROM sales_private.crm_user_roles WHERE user_id=sales_operator_private.actor() AND role=''admin'' AND is_active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION ''CUSTOMER_RECOVERY_OPERATOR_REQUIRED''; END IF;
END; ');
 INSERT INTO sales_operator_private.adapters VALUES('sales_recovery_private.operator()','5aa17590b2e332318a02803649729e22','9227b1b17b5cba4746468156407becee',ARRAY['search_path=pg_catalog']::text[],false);
END;
$operator_adapter_0$;

SELECT sales_operator_private.begin_metadata('d6362433-0779-4947-ad69-ee9b88155660'::uuid);
-- Reviewed exact-original recovery adapters. No original authorization branch is removed.
DO $recovery_adapter_0$
DECLARE definition text;body text;
BEGIN
 SELECT replace(pg_get_functiondef(oid),E'\r\n',E'\n'),replace(prosrc,E'\r\n',E'\n') INTO definition,body FROM pg_proc WHERE oid='sales_private.crm_booking_protect_sale()'::regprocedure;
 IF body IS DISTINCT FROM '
DECLARE linked boolean;
BEGIN
 IF rental_source_retirement_private.sale_allowed(TG_OP,CASE WHEN TG_OP=''INSERT'' THEN NULL ELSE to_jsonb(OLD) END,CASE WHEN TG_OP=''DELETE'' THEN NULL ELSE to_jsonb(NEW) END) THEN RETURN CASE WHEN TG_OP=''DELETE'' THEN OLD ELSE NEW END; END IF;
  linked:=CASE WHEN TG_OP=''INSERT'' THEN NEW.project_interest_id IS NOT NULL
    WHEN TG_OP=''DELETE'' THEN OLD.project_interest_id IS NOT NULL
    ELSE OLD.project_interest_id IS NOT NULL OR NEW.project_interest_id IS NOT NULL END;
  IF NOT linked THEN RETURN CASE WHEN TG_OP=''DELETE'' THEN OLD ELSE NEW END; END IF;
  IF NOT EXISTS(SELECT 1 FROM sales_private.booking_write_permits
    WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid()) THEN
    RAISE EXCEPTION ''CRM_BOOKING_FORBIDDEN'';
  END IF;
  IF TG_OP=''DELETE'' OR (TG_OP=''UPDATE'' AND OLD.crm_stage=''cancelled'' AND to_jsonb(OLD) IS DISTINCT FROM to_jsonb(NEW)) THEN
    RAISE EXCEPTION ''CRM_BOOKING_CONFLICT'';
  END IF;
  IF TG_OP=''UPDATE'' AND (NEW.id IS DISTINCT FROM OLD.id
    OR NEW.project_interest_id IS DISTINCT FROM OLD.project_interest_id
    OR NEW.booking_round IS DISTINCT FROM OLD.booking_round
    OR NEW.previous_sale_id IS DISTINCT FROM OLD.previous_sale_id) THEN
    RAISE EXCEPTION ''CRM_BOOKING_CONFLICT'';
  END IF;
  RETURN NEW;
END;
' OR md5(body) IS DISTINCT FROM '2b0ad64b14dc2ef448b8273b4f51defe'
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='sales_private.crm_booking_protect_sale()'::regprocedure AND pg_get_userbyid(proowner)=current_user
   AND prosecdef=true AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[])
  OR (length(definition)-length(replace(definition,body,'')))/length(body)<>1
 THEN RAISE EXCEPTION 'CUSTOMER_RECOVERY_EXACT_ADAPTER_REVIEW_REQUIRED'; END IF;
 EXECUTE replace(definition,body,'
DECLARE linked boolean;
BEGIN
 IF sales_recovery_private.row_allowed(TG_TABLE_NAME,TG_OP,CASE WHEN TG_OP=''INSERT'' THEN NULL ELSE to_jsonb(OLD) END,CASE WHEN TG_OP=''DELETE'' THEN NULL ELSE to_jsonb(NEW) END) THEN RETURN CASE WHEN TG_OP=''DELETE'' THEN OLD ELSE NEW END; END IF;
 IF rental_source_retirement_private.sale_allowed(TG_OP,CASE WHEN TG_OP=''INSERT'' THEN NULL ELSE to_jsonb(OLD) END,CASE WHEN TG_OP=''DELETE'' THEN NULL ELSE to_jsonb(NEW) END) THEN RETURN CASE WHEN TG_OP=''DELETE'' THEN OLD ELSE NEW END; END IF;
  linked:=CASE WHEN TG_OP=''INSERT'' THEN NEW.project_interest_id IS NOT NULL
    WHEN TG_OP=''DELETE'' THEN OLD.project_interest_id IS NOT NULL
    ELSE OLD.project_interest_id IS NOT NULL OR NEW.project_interest_id IS NOT NULL END;
  IF NOT linked THEN RETURN CASE WHEN TG_OP=''DELETE'' THEN OLD ELSE NEW END; END IF;
  IF NOT EXISTS(SELECT 1 FROM sales_private.booking_write_permits
    WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid()) THEN
    RAISE EXCEPTION ''CRM_BOOKING_FORBIDDEN'';
  END IF;
  IF TG_OP=''DELETE'' OR (TG_OP=''UPDATE'' AND OLD.crm_stage=''cancelled'' AND to_jsonb(OLD) IS DISTINCT FROM to_jsonb(NEW)) THEN
    RAISE EXCEPTION ''CRM_BOOKING_CONFLICT'';
  END IF;
  IF TG_OP=''UPDATE'' AND (NEW.id IS DISTINCT FROM OLD.id
    OR NEW.project_interest_id IS DISTINCT FROM OLD.project_interest_id
    OR NEW.booking_round IS DISTINCT FROM OLD.booking_round
    OR NEW.previous_sale_id IS DISTINCT FROM OLD.previous_sale_id) THEN
    RAISE EXCEPTION ''CRM_BOOKING_CONFLICT'';
  END IF;
  RETURN NEW;
END;
');
 INSERT INTO sales_recovery_private.adapters VALUES('sales_private.crm_booking_protect_sale()','2b0ad64b14dc2ef448b8273b4f51defe','6a6d8b743d26574dff157e4618496590');
END;
$recovery_adapter_0$;
DO $recovery_adapter_1$
DECLARE definition text;body text;
BEGIN
 SELECT replace(pg_get_functiondef(oid),E'\r\n',E'\n'),replace(prosrc,E'\r\n',E'\n') INTO definition,body FROM pg_proc WHERE oid='crm_external_private.guard_cutover_sale()'::regprocedure;
 IF body IS DISTINCT FROM '
DECLARE permit crm_external_private.sales_cutover_permits%ROWTYPE;
  source crm_external_private.prepared_booking_sales%ROWTYPE; baseline jsonb; allowed boolean:=false;
BEGIN
 IF rental_source_retirement_private.sale_allowed(TG_OP,CASE WHEN TG_OP=''INSERT'' THEN NULL ELSE to_jsonb(OLD) END,CASE WHEN TG_OP=''DELETE'' THEN NULL ELSE to_jsonb(NEW) END) THEN RETURN CASE WHEN TG_OP=''DELETE'' THEN OLD ELSE NEW END; END IF;
  SELECT * INTO permit FROM crm_external_private.sales_cutover_permits
    WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid();
  IF TG_OP=''TRUNCATE'' THEN RAISE EXCEPTION ''EXTERNAL_CUTOVER_TRUNCATE_FORBIDDEN''; END IF;
  IF permit.transaction_id IS NULL THEN
    IF sales_revision_private.allowed(TG_OP,CASE WHEN TG_OP=''INSERT'' THEN NULL ELSE to_jsonb(OLD) END,CASE WHEN TG_OP=''DELETE'' THEN NULL ELSE to_jsonb(NEW) END) THEN RETURN NEW; END IF;
    IF TG_OP=''UPDATE'' AND to_regprocedure(''sales_private.crm_post_booking_external_sale_allowed(jsonb,jsonb)'') IS NOT NULL THEN
      EXECUTE ''SELECT sales_private.crm_post_booking_external_sale_allowed($1,$2)'' INTO allowed USING to_jsonb(OLD),to_jsonb(NEW);
      IF allowed IS TRUE THEN RETURN NEW; END IF;
    END IF;
    IF to_regprocedure(''crm_external_private.booking_sale_allowed(text,jsonb,jsonb)'') IS NOT NULL THEN
      EXECUTE ''SELECT crm_external_private.booking_sale_allowed($1,$2,$3)'' INTO allowed
        USING TG_OP,CASE WHEN TG_OP=''INSERT'' THEN NULL ELSE to_jsonb(OLD) END,
          CASE WHEN TG_OP=''DELETE'' THEN NULL ELSE to_jsonb(NEW) END;
      IF allowed IS TRUE THEN RETURN NEW; END IF;
    END IF;
    IF EXISTS(SELECT 1 FROM crm_external_private.sales_cutover_receipts c
      WHERE NOT EXISTS(SELECT 1 FROM crm_external_private.sales_rollback_receipts r WHERE r.batch_id=c.batch_id)) THEN
      RAISE EXCEPTION ''EXTERNAL_CUTOVER_SALES_SEALED'';
    END IF;
    IF TG_OP<>''DELETE'' AND (NEW.external_booking_id IS NOT NULL OR NEW.external_source_stage IS NOT NULL OR
      (TG_NARGS>0 AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(TG_ARGV[0]::jsonb) k
        WHERE to_jsonb(NEW)->k IS DISTINCT FROM ''null''::jsonb))) THEN
      RAISE EXCEPTION ''CRM_FOUNDATION_COLUMNS_SEALED'';
    END IF;
    RETURN CASE WHEN TG_OP=''DELETE'' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP=''UPDATE'' THEN RAISE EXCEPTION ''EXTERNAL_CUTOVER_UPDATE_FORBIDDEN''; END IF;
  IF TG_OP=''DELETE'' THEN RETURN OLD; END IF;
  IF permit.operation=''rollback'' THEN
    SELECT row_value INTO baseline FROM crm_external_private.sales_cutover_receipts r,
      LATERAL jsonb_array_elements(r.before_sales) row_value
      WHERE r.batch_id=permit.batch_id AND row_value->>''id''=NEW.id::text;
    IF baseline IS NULL OR baseline IS DISTINCT FROM to_jsonb(NEW) THEN
      RAISE EXCEPTION ''EXTERNAL_CUTOVER_RESTORE_EVIDENCE_REQUIRED'';
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO source FROM crm_external_private.prepared_booking_sales
    WHERE id=NEW.external_booking_id AND batch_id=permit.batch_id;
  IF source.id IS NULL OR (source.payload->>''eligible_for_release_review'')::boolean IS DISTINCT FROM true
    OR NEW.id IS DISTINCT FROM source.id OR NEW.external_source_stage IS DISTINCT FROM source.stage OR NEW.lead_id IS NOT NULL
    OR NEW.project_interest_id IS DISTINCT FROM (source.payload->>''interest_id'')::uuid
    OR NEW.plot_id IS DISTINCT FROM source.plot_id OR NEW.crm_stage IS DISTINCT FROM source.stage
    OR NEW.sale_price IS DISTINCT FROM (source.payload->>''sale_price'')::numeric
    OR NEW.booking_amount IS DISTINCT FROM (source.payload->>''deposit_amount'')::numeric
    OR NEW.closing_sales_user_id IS DISTINCT FROM (source.payload->>''closing_sales_user_id'')::uuid
    OR NEW.payment_method IS DISTINCT FROM (source.payload->>''payment_method'')
    OR NEW.cancellation_reason IS DISTINCT FROM (source.payload->>''cancellation_reason'')
    OR NEW.contract_status IS DISTINCT FROM (CASE source.stage WHEN ''booked'' THEN ''Reserved'' WHEN ''transferred'' THEN ''Transferred'' ELSE ''Cancelled'' END)
    OR NEW.booking_route IS DISTINCT FROM ''legacy_import''
    OR NEW.booking_route_reason IS DISTINCT FROM ''External snapshot: ''||source.booking_key
    OR NEW.booking_round IS NOT NULL OR NEW.previous_sale_id IS NOT NULL
    OR NEW.booked_at IS NOT NULL OR NEW.cancelled_at IS NOT NULL
    OR NEW.contracted_at IS NOT NULL OR NEW.crm_handover_at IS NOT NULL
    OR NEW.list_price IS NOT NULL OR NEW.discount_amount IS NOT NULL
    OR NEW.bank_status IS NOT NULL OR NEW.bank_name IS NOT NULL OR NEW.land_office_price IS NOT NULL
    OR NEW.transferred_at IS NOT NULL OR NEW.expected_transfer_date IS NOT NULL
    OR NEW.legacy_cancellation_batch_id IS NOT NULL OR NEW.cancellation_category IS NOT NULL THEN
    RAISE EXCEPTION ''EXTERNAL_CUTOVER_SALE_EVIDENCE_REQUIRED'';
  END IF;
  RETURN NEW;
END;
' OR md5(body) IS DISTINCT FROM '7c6f7905a491ecfc2ca368284eec83d4'
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='crm_external_private.guard_cutover_sale()'::regprocedure AND pg_get_userbyid(proowner)=current_user
   AND prosecdef=true AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=""']::text[])
  OR (length(definition)-length(replace(definition,body,'')))/length(body)<>1
 THEN RAISE EXCEPTION 'CUSTOMER_RECOVERY_EXACT_ADAPTER_REVIEW_REQUIRED'; END IF;
 EXECUTE replace(definition,body,'
DECLARE permit crm_external_private.sales_cutover_permits%ROWTYPE;
  source crm_external_private.prepared_booking_sales%ROWTYPE; baseline jsonb; allowed boolean:=false;
BEGIN
 IF sales_recovery_private.row_allowed(TG_TABLE_NAME,TG_OP,CASE WHEN TG_OP=''INSERT'' THEN NULL ELSE to_jsonb(OLD) END,CASE WHEN TG_OP=''DELETE'' THEN NULL ELSE to_jsonb(NEW) END) THEN RETURN CASE WHEN TG_OP=''DELETE'' THEN OLD ELSE NEW END; END IF;
 IF rental_source_retirement_private.sale_allowed(TG_OP,CASE WHEN TG_OP=''INSERT'' THEN NULL ELSE to_jsonb(OLD) END,CASE WHEN TG_OP=''DELETE'' THEN NULL ELSE to_jsonb(NEW) END) THEN RETURN CASE WHEN TG_OP=''DELETE'' THEN OLD ELSE NEW END; END IF;
  SELECT * INTO permit FROM crm_external_private.sales_cutover_permits
    WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid();
  IF TG_OP=''TRUNCATE'' THEN RAISE EXCEPTION ''EXTERNAL_CUTOVER_TRUNCATE_FORBIDDEN''; END IF;
  IF permit.transaction_id IS NULL THEN
    IF sales_revision_private.allowed(TG_OP,CASE WHEN TG_OP=''INSERT'' THEN NULL ELSE to_jsonb(OLD) END,CASE WHEN TG_OP=''DELETE'' THEN NULL ELSE to_jsonb(NEW) END) THEN RETURN NEW; END IF;
    IF TG_OP=''UPDATE'' AND to_regprocedure(''sales_private.crm_post_booking_external_sale_allowed(jsonb,jsonb)'') IS NOT NULL THEN
      EXECUTE ''SELECT sales_private.crm_post_booking_external_sale_allowed($1,$2)'' INTO allowed USING to_jsonb(OLD),to_jsonb(NEW);
      IF allowed IS TRUE THEN RETURN NEW; END IF;
    END IF;
    IF to_regprocedure(''crm_external_private.booking_sale_allowed(text,jsonb,jsonb)'') IS NOT NULL THEN
      EXECUTE ''SELECT crm_external_private.booking_sale_allowed($1,$2,$3)'' INTO allowed
        USING TG_OP,CASE WHEN TG_OP=''INSERT'' THEN NULL ELSE to_jsonb(OLD) END,
          CASE WHEN TG_OP=''DELETE'' THEN NULL ELSE to_jsonb(NEW) END;
      IF allowed IS TRUE THEN RETURN NEW; END IF;
    END IF;
    IF EXISTS(SELECT 1 FROM crm_external_private.sales_cutover_receipts c
      WHERE NOT EXISTS(SELECT 1 FROM crm_external_private.sales_rollback_receipts r WHERE r.batch_id=c.batch_id)) THEN
      RAISE EXCEPTION ''EXTERNAL_CUTOVER_SALES_SEALED'';
    END IF;
    IF TG_OP<>''DELETE'' AND (NEW.external_booking_id IS NOT NULL OR NEW.external_source_stage IS NOT NULL OR
      (TG_NARGS>0 AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(TG_ARGV[0]::jsonb) k
        WHERE to_jsonb(NEW)->k IS DISTINCT FROM ''null''::jsonb))) THEN
      RAISE EXCEPTION ''CRM_FOUNDATION_COLUMNS_SEALED'';
    END IF;
    RETURN CASE WHEN TG_OP=''DELETE'' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP=''UPDATE'' THEN RAISE EXCEPTION ''EXTERNAL_CUTOVER_UPDATE_FORBIDDEN''; END IF;
  IF TG_OP=''DELETE'' THEN RETURN OLD; END IF;
  IF permit.operation=''rollback'' THEN
    SELECT row_value INTO baseline FROM crm_external_private.sales_cutover_receipts r,
      LATERAL jsonb_array_elements(r.before_sales) row_value
      WHERE r.batch_id=permit.batch_id AND row_value->>''id''=NEW.id::text;
    IF baseline IS NULL OR baseline IS DISTINCT FROM to_jsonb(NEW) THEN
      RAISE EXCEPTION ''EXTERNAL_CUTOVER_RESTORE_EVIDENCE_REQUIRED'';
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO source FROM crm_external_private.prepared_booking_sales
    WHERE id=NEW.external_booking_id AND batch_id=permit.batch_id;
  IF source.id IS NULL OR (source.payload->>''eligible_for_release_review'')::boolean IS DISTINCT FROM true
    OR NEW.id IS DISTINCT FROM source.id OR NEW.external_source_stage IS DISTINCT FROM source.stage OR NEW.lead_id IS NOT NULL
    OR NEW.project_interest_id IS DISTINCT FROM (source.payload->>''interest_id'')::uuid
    OR NEW.plot_id IS DISTINCT FROM source.plot_id OR NEW.crm_stage IS DISTINCT FROM source.stage
    OR NEW.sale_price IS DISTINCT FROM (source.payload->>''sale_price'')::numeric
    OR NEW.booking_amount IS DISTINCT FROM (source.payload->>''deposit_amount'')::numeric
    OR NEW.closing_sales_user_id IS DISTINCT FROM (source.payload->>''closing_sales_user_id'')::uuid
    OR NEW.payment_method IS DISTINCT FROM (source.payload->>''payment_method'')
    OR NEW.cancellation_reason IS DISTINCT FROM (source.payload->>''cancellation_reason'')
    OR NEW.contract_status IS DISTINCT FROM (CASE source.stage WHEN ''booked'' THEN ''Reserved'' WHEN ''transferred'' THEN ''Transferred'' ELSE ''Cancelled'' END)
    OR NEW.booking_route IS DISTINCT FROM ''legacy_import''
    OR NEW.booking_route_reason IS DISTINCT FROM ''External snapshot: ''||source.booking_key
    OR NEW.booking_round IS NOT NULL OR NEW.previous_sale_id IS NOT NULL
    OR NEW.booked_at IS NOT NULL OR NEW.cancelled_at IS NOT NULL
    OR NEW.contracted_at IS NOT NULL OR NEW.crm_handover_at IS NOT NULL
    OR NEW.list_price IS NOT NULL OR NEW.discount_amount IS NOT NULL
    OR NEW.bank_status IS NOT NULL OR NEW.bank_name IS NOT NULL OR NEW.land_office_price IS NOT NULL
    OR NEW.transferred_at IS NOT NULL OR NEW.expected_transfer_date IS NOT NULL
    OR NEW.legacy_cancellation_batch_id IS NOT NULL OR NEW.cancellation_category IS NOT NULL THEN
    RAISE EXCEPTION ''EXTERNAL_CUTOVER_SALE_EVIDENCE_REQUIRED'';
  END IF;
  RETURN NEW;
END;
');
 INSERT INTO sales_recovery_private.adapters VALUES('crm_external_private.guard_cutover_sale()','7c6f7905a491ecfc2ca368284eec83d4','815a34d40ed2ee50b265a658371794a4');
END;
$recovery_adapter_1$;
DO $recovery_adapter_2$
DECLARE definition text;body text;
BEGIN
 SELECT replace(pg_get_functiondef(oid),E'\r\n',E'\n'),replace(prosrc,E'\r\n',E'\n') INTO definition,body FROM pg_proc WHERE oid='sales_revision_private.marker_guard()'::regprocedure;
 IF body IS DISTINCT FROM '
BEGIN
 IF (TG_OP=''INSERT'' AND (NEW.historical_import_id IS NOT NULL OR NEW.historical_revision_id IS NOT NULL))
  OR (TG_OP=''UPDATE'' AND (NEW.historical_import_id IS DISTINCT FROM OLD.historical_import_id OR NEW.historical_revision_id IS DISTINCT FROM OLD.historical_revision_id)) THEN
  IF NOT sales_revision_private.allowed(TG_OP,CASE WHEN TG_OP=''INSERT'' THEN NULL ELSE to_jsonb(OLD) END,to_jsonb(NEW)) THEN RAISE EXCEPTION ''HISTORICAL_REVISION_SEALED''; END IF;
 END IF;
 RETURN NEW;
END; ' OR md5(body) IS DISTINCT FROM '8268b2e9798da41f10bfde9b17ec650a'
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='sales_revision_private.marker_guard()'::regprocedure AND pg_get_userbyid(proowner)=current_user
   AND prosecdef=true AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[])
  OR (length(definition)-length(replace(definition,body,'')))/length(body)<>1
 THEN RAISE EXCEPTION 'CUSTOMER_RECOVERY_EXACT_ADAPTER_REVIEW_REQUIRED'; END IF;
 EXECUTE replace(definition,body,'
BEGIN
 IF sales_recovery_private.row_allowed(TG_TABLE_NAME,TG_OP,CASE WHEN TG_OP=''INSERT'' THEN NULL ELSE to_jsonb(OLD) END,CASE WHEN TG_OP=''DELETE'' THEN NULL ELSE to_jsonb(NEW) END) THEN RETURN CASE WHEN TG_OP=''DELETE'' THEN OLD ELSE NEW END; END IF;
 IF (TG_OP=''INSERT'' AND (NEW.historical_import_id IS NOT NULL OR NEW.historical_revision_id IS NOT NULL))
  OR (TG_OP=''UPDATE'' AND (NEW.historical_import_id IS DISTINCT FROM OLD.historical_import_id OR NEW.historical_revision_id IS DISTINCT FROM OLD.historical_revision_id)) THEN
  IF NOT sales_revision_private.allowed(TG_OP,CASE WHEN TG_OP=''INSERT'' THEN NULL ELSE to_jsonb(OLD) END,to_jsonb(NEW)) THEN RAISE EXCEPTION ''HISTORICAL_REVISION_SEALED''; END IF;
 END IF;
 RETURN NEW;
END; ');
 INSERT INTO sales_recovery_private.adapters VALUES('sales_revision_private.marker_guard()','8268b2e9798da41f10bfde9b17ec650a','15cbc3b1da928fd8cbcf1a0c05eee20a');
END;
$recovery_adapter_2$;
DO $recovery_adapter_3$
DECLARE definition text;body text;
BEGIN
 SELECT replace(pg_get_functiondef(oid),E'\r\n',E'\n'),replace(prosrc,E'\r\n',E'\n') INTO definition,body FROM pg_proc WHERE oid='sales_private.crm_customer_deal_details_guard()'::regprocedure;
 IF body IS DISTINCT FROM '
DECLARE entity text:=CASE WHEN TG_TABLE_NAME=''customer_profile_corrections'' THEN ''customer'' ELSE ''deal'' END;
  identity_id uuid; old_json jsonb; new_json jsonb;
BEGIN
  IF TG_OP NOT IN (''INSERT'',''UPDATE'') THEN RAISE EXCEPTION ''CRM_CUSTOMER_DEAL_DETAILS_FORBIDDEN''; END IF;
  identity_id:=CASE WHEN entity=''customer'' THEN (to_jsonb(NEW)->>''customer_id'')::uuid ELSE (to_jsonb(NEW)->>''sale_id'')::uuid END;
  old_json:=CASE WHEN TG_OP=''UPDATE'' THEN to_jsonb(OLD) ELSE NULL END; new_json:=to_jsonb(NEW);
  IF NOT EXISTS(SELECT 1 FROM sales_private.customer_deal_details_permits p WHERE p.transaction_id=txid_current()
    AND p.backend_pid=pg_backend_pid() AND p.actor_user_id=auth.uid() AND p.entity_type=entity AND p.entity_id=identity_id
    AND p.old_row IS NOT DISTINCT FROM old_json AND p.new_row=new_json)
    OR public.crm_v2_role() NOT IN (''sales'',''admin'') THEN RAISE EXCEPTION ''CRM_CUSTOMER_DEAL_DETAILS_FORBIDDEN''; END IF;
  RETURN NEW;
END;
' OR md5(body) IS DISTINCT FROM '964de9dc66f58c707d71b3123f3624a4'
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='sales_private.crm_customer_deal_details_guard()'::regprocedure AND pg_get_userbyid(proowner)=current_user
   AND prosecdef=true AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[])
  OR (length(definition)-length(replace(definition,body,'')))/length(body)<>1
 THEN RAISE EXCEPTION 'CUSTOMER_RECOVERY_EXACT_ADAPTER_REVIEW_REQUIRED'; END IF;
 EXECUTE replace(definition,body,'
DECLARE entity text:=CASE WHEN TG_TABLE_NAME=''customer_profile_corrections'' THEN ''customer'' ELSE ''deal'' END;
  identity_id uuid; old_json jsonb; new_json jsonb;
BEGIN
 IF sales_recovery_private.row_allowed(TG_TABLE_NAME,TG_OP,CASE WHEN TG_OP=''INSERT'' THEN NULL ELSE to_jsonb(OLD) END,CASE WHEN TG_OP=''DELETE'' THEN NULL ELSE to_jsonb(NEW) END) THEN RETURN CASE WHEN TG_OP=''DELETE'' THEN OLD ELSE NEW END; END IF;
  IF TG_OP NOT IN (''INSERT'',''UPDATE'') THEN RAISE EXCEPTION ''CRM_CUSTOMER_DEAL_DETAILS_FORBIDDEN''; END IF;
  identity_id:=CASE WHEN entity=''customer'' THEN (to_jsonb(NEW)->>''customer_id'')::uuid ELSE (to_jsonb(NEW)->>''sale_id'')::uuid END;
  old_json:=CASE WHEN TG_OP=''UPDATE'' THEN to_jsonb(OLD) ELSE NULL END; new_json:=to_jsonb(NEW);
  IF NOT EXISTS(SELECT 1 FROM sales_private.customer_deal_details_permits p WHERE p.transaction_id=txid_current()
    AND p.backend_pid=pg_backend_pid() AND p.actor_user_id=auth.uid() AND p.entity_type=entity AND p.entity_id=identity_id
    AND p.old_row IS NOT DISTINCT FROM old_json AND p.new_row=new_json)
    OR public.crm_v2_role() NOT IN (''sales'',''admin'') THEN RAISE EXCEPTION ''CRM_CUSTOMER_DEAL_DETAILS_FORBIDDEN''; END IF;
  RETURN NEW;
END;
');
 INSERT INTO sales_recovery_private.adapters VALUES('sales_private.crm_customer_deal_details_guard()','964de9dc66f58c707d71b3123f3624a4','04d311d280f18a48eba52757ecce6554');
END;
$recovery_adapter_3$;
DO $recovery_adapter_4$
DECLARE definition text;body text;
BEGIN
 SELECT replace(pg_get_functiondef(oid),E'\r\n',E'\n'),replace(prosrc,E'\r\n',E'\n') INTO definition,body FROM pg_proc WHERE oid='sales_import_private.forecast_guard()'::regprocedure;
 IF body IS DISTINCT FROM '
BEGIN
 IF TG_OP NOT IN (''INSERT'',''UPDATE'') OR NOT EXISTS(SELECT 1 FROM sales_import_private.forecast_permits p
   WHERE p.transaction_id=txid_current() AND p.backend_pid=pg_backend_pid() AND p.actor_id=auth.uid()
    AND p.sale_id=NEW.sale_id AND p.new_row=to_jsonb(NEW)
    AND p.old_row IS NOT DISTINCT FROM CASE WHEN TG_OP=''UPDATE'' THEN to_jsonb(OLD) ELSE NULL END)
  THEN RAISE EXCEPTION ''IMPORT_DETAILS_FORBIDDEN''; END IF;
 RETURN NEW;
END; ' OR md5(body) IS DISTINCT FROM '47d9ba412a535a6e0a20f7230ffa00a9'
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='sales_import_private.forecast_guard()'::regprocedure AND pg_get_userbyid(proowner)=current_user
   AND prosecdef=false AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[])
  OR (length(definition)-length(replace(definition,body,'')))/length(body)<>1
 THEN RAISE EXCEPTION 'CUSTOMER_RECOVERY_EXACT_ADAPTER_REVIEW_REQUIRED'; END IF;
 EXECUTE replace(definition,body,'
BEGIN
 IF sales_recovery_private.row_allowed(TG_TABLE_NAME,TG_OP,CASE WHEN TG_OP=''INSERT'' THEN NULL ELSE to_jsonb(OLD) END,CASE WHEN TG_OP=''DELETE'' THEN NULL ELSE to_jsonb(NEW) END) THEN RETURN CASE WHEN TG_OP=''DELETE'' THEN OLD ELSE NEW END; END IF;
 IF TG_OP NOT IN (''INSERT'',''UPDATE'') OR NOT EXISTS(SELECT 1 FROM sales_import_private.forecast_permits p
   WHERE p.transaction_id=txid_current() AND p.backend_pid=pg_backend_pid() AND p.actor_id=auth.uid()
    AND p.sale_id=NEW.sale_id AND p.new_row=to_jsonb(NEW)
    AND p.old_row IS NOT DISTINCT FROM CASE WHEN TG_OP=''UPDATE'' THEN to_jsonb(OLD) ELSE NULL END)
  THEN RAISE EXCEPTION ''IMPORT_DETAILS_FORBIDDEN''; END IF;
 RETURN NEW;
END; ');
 INSERT INTO sales_recovery_private.adapters VALUES('sales_import_private.forecast_guard()','47d9ba412a535a6e0a20f7230ffa00a9','29bec86709f32959d481eb78bcdefdfe');
END;
$recovery_adapter_4$;
DO $recovery_adapter_5$
DECLARE definition text;body text;
BEGIN
 SELECT replace(pg_get_functiondef(oid),E'\r\n',E'\n'),replace(prosrc,E'\r\n',E'\n') INTO definition,body FROM pg_proc WHERE oid='crm_external_private.guard_booking_plot_stock()'::regprocedure;
 IF body IS DISTINCT FROM '
DECLARE permit crm_external_private.booking_writer_permits%ROWTYPE; expected_occupied boolean;
BEGIN
 IF TG_OP=''UPDATE'' AND rental_source_retirement_private.plot_allowed(to_jsonb(OLD),to_jsonb(NEW)) THEN RETURN NEW; END IF;
 IF TG_OP=''UPDATE'' AND sales_revision_private.plot_allowed(to_jsonb(OLD),to_jsonb(NEW)) THEN RETURN NEW; END IF;
  IF TG_OP=''INSERT'' THEN
    IF EXISTS(SELECT 1 FROM crm_external_private.booking_writer_releases)
      AND (NEW.has_customer IS DISTINCT FROM false OR lower(btrim(NEW.sale_status))=''transferred'') THEN
      RAISE EXCEPTION ''EXTERNAL_WRITER_STOCK_COMMAND_REQUIRED'';
    END IF;
    RETURN NEW;
  END IF;
  IF EXISTS(SELECT 1 FROM crm_external_private.booking_writer_releases)
    AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.project_name IS DISTINCT FROM OLD.project_name)
    AND EXISTS(SELECT 1 FROM public.sales WHERE plot_id=OLD.id) THEN
    RAISE EXCEPTION ''EXTERNAL_WRITER_STOCK_COMMAND_REQUIRED'';
  END IF;
  -- Existing construction pause/resume is NOT a transfer or occupancy change.
  -- Delegate its authorization to the unchanged plot policies, not CRM roles:
  -- other departments are not required to enroll in the Sales role registry.
  IF NEW.id IS NOT DISTINCT FROM OLD.id AND NEW.project_name IS NOT DISTINCT FROM OLD.project_name
    AND NEW.has_customer IS NOT DISTINCT FROM OLD.has_customer
    AND COALESCE(OLD.sale_status,'''') IN ('''',''active'',''ready_for_sale'')
    AND NEW.sale_status IN (''active'',''ready_for_sale'') THEN RETURN NEW; END IF;
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
    RAISE EXCEPTION ''EXTERNAL_WRITER_STOCK_COMMAND_REQUIRED'';
  END IF;
  SELECT EXISTS(SELECT 1 FROM public.sales WHERE plot_id=NEW.id
    AND COALESCE(crm_stage,lower(contract_status),''unknown'')<>''cancelled'') INTO expected_occupied;
  IF NEW.has_customer IS DISTINCT FROM expected_occupied THEN RAISE EXCEPTION ''EXTERNAL_WRITER_STOCK_EVIDENCE_REQUIRED''; END IF;
  RETURN NEW;
END;
' OR md5(body) IS DISTINCT FROM 'a498131001bda620bc0becbd867acf20'
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='crm_external_private.guard_booking_plot_stock()'::regprocedure AND pg_get_userbyid(proowner)=current_user
   AND prosecdef=true AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=""']::text[])
  OR (length(definition)-length(replace(definition,body,'')))/length(body)<>1
 THEN RAISE EXCEPTION 'CUSTOMER_RECOVERY_EXACT_ADAPTER_REVIEW_REQUIRED'; END IF;
 EXECUTE replace(definition,body,'
DECLARE permit crm_external_private.booking_writer_permits%ROWTYPE; expected_occupied boolean;
BEGIN
 IF TG_OP=''UPDATE'' AND sales_recovery_private.stock_allowed(to_jsonb(OLD),to_jsonb(NEW)) THEN RETURN CASE WHEN TG_OP=''DELETE'' THEN OLD ELSE NEW END; END IF;
 IF TG_OP=''UPDATE'' AND rental_source_retirement_private.plot_allowed(to_jsonb(OLD),to_jsonb(NEW)) THEN RETURN NEW; END IF;
 IF TG_OP=''UPDATE'' AND sales_revision_private.plot_allowed(to_jsonb(OLD),to_jsonb(NEW)) THEN RETURN NEW; END IF;
  IF TG_OP=''INSERT'' THEN
    IF EXISTS(SELECT 1 FROM crm_external_private.booking_writer_releases)
      AND (NEW.has_customer IS DISTINCT FROM false OR lower(btrim(NEW.sale_status))=''transferred'') THEN
      RAISE EXCEPTION ''EXTERNAL_WRITER_STOCK_COMMAND_REQUIRED'';
    END IF;
    RETURN NEW;
  END IF;
  IF EXISTS(SELECT 1 FROM crm_external_private.booking_writer_releases)
    AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.project_name IS DISTINCT FROM OLD.project_name)
    AND EXISTS(SELECT 1 FROM public.sales WHERE plot_id=OLD.id) THEN
    RAISE EXCEPTION ''EXTERNAL_WRITER_STOCK_COMMAND_REQUIRED'';
  END IF;
  -- Existing construction pause/resume is NOT a transfer or occupancy change.
  -- Delegate its authorization to the unchanged plot policies, not CRM roles:
  -- other departments are not required to enroll in the Sales role registry.
  IF NEW.id IS NOT DISTINCT FROM OLD.id AND NEW.project_name IS NOT DISTINCT FROM OLD.project_name
    AND NEW.has_customer IS NOT DISTINCT FROM OLD.has_customer
    AND COALESCE(OLD.sale_status,'''') IN ('''',''active'',''ready_for_sale'')
    AND NEW.sale_status IN (''active'',''ready_for_sale'') THEN RETURN NEW; END IF;
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
    RAISE EXCEPTION ''EXTERNAL_WRITER_STOCK_COMMAND_REQUIRED'';
  END IF;
  SELECT EXISTS(SELECT 1 FROM public.sales WHERE plot_id=NEW.id
    AND COALESCE(crm_stage,lower(contract_status),''unknown'')<>''cancelled'') INTO expected_occupied;
  IF NEW.has_customer IS DISTINCT FROM expected_occupied THEN RAISE EXCEPTION ''EXTERNAL_WRITER_STOCK_EVIDENCE_REQUIRED''; END IF;
  RETURN NEW;
END;
');
 INSERT INTO sales_recovery_private.adapters VALUES('crm_external_private.guard_booking_plot_stock()','a498131001bda620bc0becbd867acf20','a30be2b2b059e4e242ddfe526460266f');
END;
$recovery_adapter_5$;
DO $recovery_adapter_6$
DECLARE definition text;body text;
BEGIN
 SELECT replace(pg_get_functiondef(oid),E'\r\n',E'\n'),replace(prosrc,E'\r\n',E'\n') INTO definition,body FROM pg_proc WHERE oid='public.update_sales_updated_at_column()'::regprocedure;
 IF body IS DISTINCT FROM '
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
' OR md5(body) IS DISTINCT FROM '06bcf30ac3d0a7f279a54cbf228a7bec'
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.update_sales_updated_at_column()'::regprocedure AND pg_get_userbyid(proowner)=current_user
   AND prosecdef=false AND proconfig IS NOT DISTINCT FROM NULL::text[])
  OR (length(definition)-length(replace(definition,body,'')))/length(body)<>1
 THEN RAISE EXCEPTION 'CUSTOMER_RECOVERY_EXACT_ADAPTER_REVIEW_REQUIRED'; END IF;
 EXECUTE replace(definition,body,'
BEGIN
 IF TG_TABLE_NAME=''sales'' AND TG_OP=''UPDATE'' AND sales_recovery_private.row_allowed(TG_TABLE_NAME,TG_OP,CASE WHEN TG_OP=''INSERT'' THEN NULL ELSE to_jsonb(OLD) END,CASE WHEN TG_OP=''DELETE'' THEN NULL ELSE to_jsonb(NEW) END) THEN RETURN CASE WHEN TG_OP=''DELETE'' THEN OLD ELSE NEW END; END IF;
    NEW.updated_at = NOW();
    RETURN NEW;
END;
');
 INSERT INTO sales_recovery_private.adapters VALUES('public.update_sales_updated_at_column()','06bcf30ac3d0a7f279a54cbf228a7bec','6a67c4b8a27ff0d53f8dd61a7c3b36c3');
END;
$recovery_adapter_6$;
DO $recovery_adapter_7$
DECLARE definition text;body text;
BEGIN
 SELECT replace(pg_get_functiondef(oid),E'\r\n',E'\n'),replace(prosrc,E'\r\n',E'\n') INTO definition,body FROM pg_proc WHERE oid='customer_source_membership_private.customer_member(uuid)'::regprocedure;
 IF body IS DISTINCT FROM '
 SELECT NOT EXISTS(SELECT 1 FROM customer_source_membership_private.head)
  OR NOT EXISTS(SELECT 1 FROM customer_source_membership_private.scope_customers WHERE id=p_id)
  OR EXISTS(SELECT 1 FROM customer_source_membership_private.members m JOIN customer_source_membership_private.head h ON h.revision_id=m.revision_id WHERE m.customer_id=p_id);
' OR md5(body) IS DISTINCT FROM 'daa11bf2ff5265d0e884e903263ff946'
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='customer_source_membership_private.customer_member(uuid)'::regprocedure AND pg_get_userbyid(proowner)=current_user
   AND prosecdef=false AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[])
  OR (length(definition)-length(replace(definition,body,'')))/length(body)<>1
 THEN RAISE EXCEPTION 'CUSTOMER_RECOVERY_EXACT_ADAPTER_REVIEW_REQUIRED'; END IF;
 EXECUTE replace(definition,body,'
 SELECT NOT sales_recovery_private.retired_parent(''customer'',p_id) AND (SELECT NOT EXISTS(SELECT 1 FROM customer_source_membership_private.head)
  OR NOT EXISTS(SELECT 1 FROM customer_source_membership_private.scope_customers WHERE id=p_id)
  OR EXISTS(SELECT 1 FROM customer_source_membership_private.members m JOIN customer_source_membership_private.head h ON h.revision_id=m.revision_id WHERE m.customer_id=p_id));
');
 INSERT INTO sales_recovery_private.adapters VALUES('customer_source_membership_private.customer_member(uuid)','daa11bf2ff5265d0e884e903263ff946','5b56952cdc1be967c61696573be97fa7');
END;
$recovery_adapter_7$;
DO $recovery_adapter_8$
DECLARE definition text;body text;
BEGIN
 SELECT replace(pg_get_functiondef(oid),E'\r\n',E'\n'),replace(prosrc,E'\r\n',E'\n') INTO definition,body FROM pg_proc WHERE oid='customer_source_membership_private.interest_member(uuid)'::regprocedure;
 IF body IS DISTINCT FROM '
 SELECT NOT EXISTS(SELECT 1 FROM customer_source_membership_private.head)
  OR (NOT EXISTS(SELECT 1 FROM public.lead_project_interests WHERE id=p_id) AND NOT EXISTS(SELECT 1 FROM customer_source_membership_private.scope_interests WHERE id=p_id))
  OR (EXISTS(SELECT 1 FROM public.lead_project_interests i WHERE i.id=p_id AND customer_source_membership_private.customer_member(i.customer_id))
   AND (NOT EXISTS(SELECT 1 FROM customer_source_membership_private.scope_interests WHERE id=p_id)
    OR EXISTS(SELECT 1 FROM customer_source_membership_private.members m JOIN customer_source_membership_private.head h ON h.revision_id=m.revision_id WHERE m.interest_id=p_id)));
' OR md5(body) IS DISTINCT FROM '8c9ea7ca44ea945f029f353638118159'
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='customer_source_membership_private.interest_member(uuid)'::regprocedure AND pg_get_userbyid(proowner)=current_user
   AND prosecdef=false AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[])
  OR (length(definition)-length(replace(definition,body,'')))/length(body)<>1
 THEN RAISE EXCEPTION 'CUSTOMER_RECOVERY_EXACT_ADAPTER_REVIEW_REQUIRED'; END IF;
 EXECUTE replace(definition,body,'
 SELECT NOT sales_recovery_private.retired_parent(''interest'',p_id) AND (SELECT NOT EXISTS(SELECT 1 FROM customer_source_membership_private.head)
  OR (NOT EXISTS(SELECT 1 FROM public.lead_project_interests WHERE id=p_id) AND NOT EXISTS(SELECT 1 FROM customer_source_membership_private.scope_interests WHERE id=p_id))
  OR (EXISTS(SELECT 1 FROM public.lead_project_interests i WHERE i.id=p_id AND customer_source_membership_private.customer_member(i.customer_id))
   AND (NOT EXISTS(SELECT 1 FROM customer_source_membership_private.scope_interests WHERE id=p_id)
    OR EXISTS(SELECT 1 FROM customer_source_membership_private.members m JOIN customer_source_membership_private.head h ON h.revision_id=m.revision_id WHERE m.interest_id=p_id))));
');
 INSERT INTO sales_recovery_private.adapters VALUES('customer_source_membership_private.interest_member(uuid)','8c9ea7ca44ea945f029f353638118159','d62e178c1cc86046a3e023e3eda66316');
END;
$recovery_adapter_8$;
DO $recovery_adapter_9$
DECLARE definition text;body text;
BEGIN
 SELECT replace(pg_get_functiondef(oid),E'\r\n',E'\n'),replace(prosrc,E'\r\n',E'\n') INTO definition,body FROM pg_proc WHERE oid='sales_revision_private.assert_stock_catalog()'::regprocedure;
 IF body IS DISTINCT FROM '
DECLARE proc oid:=to_regprocedure(''crm_external_private.guard_booking_plot_stock()''); sync_proc oid:=to_regprocedure(''public.sync_plot_customer_status()'');
 updated_proc oid:=to_regprocedure(''public.update_sales_updated_at_column()'');
BEGIN
 IF proc IS NULL OR sync_proc IS NULL OR updated_proc IS NULL
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=proc AND pg_get_userbyid(proowner)=current_user AND prosecdef
    AND proconfig=ARRAY[''search_path=""''] AND md5(replace(prosrc,E''\r\n'',E''\n'')) IN(''eb32ae486d63956e802027ec8ce6fd28'',''a498131001bda620bc0becbd867acf20''))
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=''public.plots''::regclass AND tgfoid=proc AND NOT tgisinternal AND tgenabled IN(''O'',''A'') AND tgtype=23)
  -- Captured live and local migration bodies differ only in comments/spacing;
  -- all360 tokens (including literal contents) were compared before pinning.
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=sync_proc AND md5(replace(prosrc,E''\r\n'',E''\n'')) IN(''d5d2314011924a3de7d7ef5cd33d1900'',''d14049d669231cf3b2435b42c869e011''))
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=''public.sales''::regclass AND tgfoid=sync_proc AND tgname=''trigger_sync_plot_customer_status''
    AND NOT tgisinternal AND tgenabled IN(''O'',''A'') AND tgtype=29)
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=updated_proc AND pg_get_userbyid(proowner)=current_user AND NOT prosecdef AND proconfig IS NULL
    AND md5(replace(prosrc,E''\r\n'',E''\n''))=''06bcf30ac3d0a7f279a54cbf228a7bec'')
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=''public.sales''::regclass AND tgfoid=updated_proc AND tgname=''update_sales_table_updated_at''
    AND NOT tgisinternal AND tgenabled IN(''O'',''A'') AND tgtype=19)
 THEN RAISE EXCEPTION ''HISTORICAL_REVISION_STOCK_REVIEW_REQUIRED''; END IF;
END; ' OR md5(body) IS DISTINCT FROM '9cf9c2497eb1af3fe172cb7d08cd0041'
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='sales_revision_private.assert_stock_catalog()'::regprocedure AND pg_get_userbyid(proowner)=current_user
   AND prosecdef=false AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[])
  OR (length(definition)-length(replace(definition,body,'')))/length(body)<>1
 THEN RAISE EXCEPTION 'CUSTOMER_RECOVERY_EXACT_ADAPTER_REVIEW_REQUIRED'; END IF;
 EXECUTE replace(definition,body,'
DECLARE proc oid:=to_regprocedure(''crm_external_private.guard_booking_plot_stock()''); sync_proc oid:=to_regprocedure(''public.sync_plot_customer_status()'');
 updated_proc oid:=to_regprocedure(''public.update_sales_updated_at_column()'');
BEGIN
 IF proc IS NULL OR sync_proc IS NULL OR updated_proc IS NULL
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=proc AND pg_get_userbyid(proowner)=current_user AND prosecdef
    AND proconfig=ARRAY[''search_path=""''] AND md5(replace(prosrc,E''\r\n'',E''\n'')) IN(''eb32ae486d63956e802027ec8ce6fd28'',''a498131001bda620bc0becbd867acf20'',''a30be2b2b059e4e242ddfe526460266f''))
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=''public.plots''::regclass AND tgfoid=proc AND NOT tgisinternal AND tgenabled IN(''O'',''A'') AND tgtype=23)
  -- Captured live and local migration bodies differ only in comments/spacing;
  -- all360 tokens (including literal contents) were compared before pinning.
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=sync_proc AND md5(replace(prosrc,E''\r\n'',E''\n'')) IN(''d5d2314011924a3de7d7ef5cd33d1900'',''d14049d669231cf3b2435b42c869e011''))
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=''public.sales''::regclass AND tgfoid=sync_proc AND tgname=''trigger_sync_plot_customer_status''
    AND NOT tgisinternal AND tgenabled IN(''O'',''A'') AND tgtype=29)
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=updated_proc AND pg_get_userbyid(proowner)=current_user AND NOT prosecdef AND proconfig IS NULL
    AND sales_recovery_private.adapter_matches(''public.update_sales_updated_at_column()'',''06bcf30ac3d0a7f279a54cbf228a7bec'',md5(replace(prosrc,E''\r\n'',E''\n''))))
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=''public.sales''::regclass AND tgfoid=updated_proc AND tgname=''update_sales_table_updated_at''
    AND NOT tgisinternal AND tgenabled IN(''O'',''A'') AND tgtype=19)
 THEN RAISE EXCEPTION ''HISTORICAL_REVISION_STOCK_REVIEW_REQUIRED''; END IF;
END; ');
 INSERT INTO sales_recovery_private.adapters VALUES('sales_revision_private.assert_stock_catalog()','9cf9c2497eb1af3fe172cb7d08cd0041','8bde31b87a2e7d98e081327f35983bb1');
END;
$recovery_adapter_9$;
DO $recovery_adapter_10$
DECLARE definition text;body text;
BEGIN
 SELECT replace(pg_get_functiondef(oid),E'\r\n',E'\n'),replace(prosrc,E'\r\n',E'\n') INTO definition,body FROM pg_proc WHERE oid='customer_source_membership_private.assert_catalog()'::regprocedure;
 IF body IS DISTINCT FROM '
BEGIN
 IF EXISTS(SELECT 1 FROM (VALUES
   (''sales_customers'',''customer_source_membership_read'',''rls_customer_member'',''customer_member''),
   (''lead_project_interests'',''interest_source_membership_read'',''rls_interest_member'',''interest_member''),
   (''sales'',''sale_source_membership_read'',''rls_sale_member'',''sale_member'')) expected(table_name,policy_name,helper_name,parent_name)
  LEFT JOIN pg_class c ON c.oid=to_regclass(''public.''||expected.table_name)
  LEFT JOIN pg_policy policy ON policy.polrelid=c.oid AND policy.polname=expected.policy_name
  LEFT JOIN pg_proc helper ON helper.oid=to_regprocedure(''customer_source_membership_private.''||expected.helper_name||''(uuid)'')
  WHERE NOT coalesce(c.relrowsecurity,false) OR policy.oid IS NULL OR policy.polpermissive OR policy.polcmd<>''r''
   OR policy.polroles IS DISTINCT FROM ARRAY[(SELECT oid FROM pg_roles WHERE rolname=''authenticated'')]::oid[]
   OR pg_get_expr(policy.polqual,c.oid) IS DISTINCT FROM ''customer_source_membership_private.''||expected.helper_name||''(id)''
   OR helper.oid IS NULL OR NOT helper.prosecdef OR pg_get_userbyid(helper.proowner)<>current_user
   OR helper.proconfig IS DISTINCT FROM ARRAY[''search_path=pg_catalog'',''row_security=off'']::text[]
   OR replace(helper.prosrc,E''\r\n'',E''\n'') IS DISTINCT FROM chr(10)||'' SELECT customer_source_membership_private.''||expected.parent_name||''(p_id);''||chr(10)
   OR NOT has_function_privilege(''authenticated'',helper.oid,''EXECUTE'') OR has_function_privilege(''anon'',helper.oid,''EXECUTE''))
  OR NOT has_schema_privilege(''authenticated'',''customer_source_membership_private'',''USAGE'')
 THEN RAISE EXCEPTION ''CUSTOMER_MEMBERSHIP_SELECT_POLICY_DRIFT''; END IF;
 IF EXISTS(SELECT 1 FROM customer_source_membership_private.adapters a LEFT JOIN pg_proc p ON p.oid=to_regprocedure(a.signature)
  WHERE p.oid IS NULL OR md5(replace(p.prosrc,E''\r\n'',E''\n'')) IS DISTINCT FROM a.after_md5 OR NOT p.prosecdef OR pg_get_userbyid(p.proowner)<>current_user OR p.proconfig IS DISTINCT FROM a.settings)
 THEN RAISE EXCEPTION ''CUSTOMER_MEMBERSHIP_ADAPTER_DRIFT''; END IF;
 IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname=''public'' AND p.proname LIKE ''crm_v2_%'' AND p.prosecdef
   AND (p.prosrc ~ ''public\.(sales_customers|lead_project_interests|sales)\M'' OR pg_get_function_arguments(p.oid) LIKE ''%p_payload jsonb%'')
   AND NOT EXISTS(SELECT 1 FROM customer_source_membership_private.adapters a WHERE a.signature=quote_ident(n.nspname)||''.''||quote_ident(p.proname)||''(''||replace(oidvectortypes(p.proargtypes),'', '','','')||'')''))
 THEN RAISE EXCEPTION ''CUSTOMER_MEMBERSHIP_ADAPTER_COVERAGE_REQUIRED''; END IF;
 IF EXISTS(SELECT 1 FROM unnest(ARRAY[''public.crm_v2_central_snapshot(integer,integer)'',''public.crm_v2_central_search(jsonb,integer)'',''public.crm_v2_lead_work_snapshot(uuid,uuid)'',''public.crm_v2_booking_search(text,integer)'',''public.crm_v2_booking_context(uuid,integer)'',''public.crm_v2_project_sales(text,text,text,integer)'',''public.crm_v2_sales_report(text,text,text)'',''sales_history_read_private.records(uuid,uuid,uuid,text)'',''sales_history_read_private.original_excel(text)'']) required(signature)
   WHERE NOT EXISTS(SELECT 1 FROM customer_source_membership_private.adapters a WHERE a.signature=required.signature))
 THEN RAISE EXCEPTION ''CUSTOMER_MEMBERSHIP_HISTORY_COVERAGE_REQUIRED''; END IF;
END; ' OR md5(body) IS DISTINCT FROM 'f920526408fd64266d4a84b23f1f8445'
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='customer_source_membership_private.assert_catalog()'::regprocedure AND pg_get_userbyid(proowner)=current_user
   AND prosecdef=false AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[])
  OR (length(definition)-length(replace(definition,body,'')))/length(body)<>1
 THEN RAISE EXCEPTION 'CUSTOMER_RECOVERY_EXACT_ADAPTER_REVIEW_REQUIRED'; END IF;
 EXECUTE replace(definition,body,'
BEGIN
 IF EXISTS(SELECT 1 FROM (VALUES
   (''sales_customers'',''customer_source_membership_read'',''rls_customer_member'',''customer_member''),
   (''lead_project_interests'',''interest_source_membership_read'',''rls_interest_member'',''interest_member''),
   (''sales'',''sale_source_membership_read'',''rls_sale_member'',''sale_member'')) expected(table_name,policy_name,helper_name,parent_name)
  LEFT JOIN pg_class c ON c.oid=to_regclass(''public.''||expected.table_name)
  LEFT JOIN pg_policy policy ON policy.polrelid=c.oid AND policy.polname=expected.policy_name
  LEFT JOIN pg_proc helper ON helper.oid=to_regprocedure(''customer_source_membership_private.''||expected.helper_name||''(uuid)'')
  WHERE NOT coalesce(c.relrowsecurity,false) OR policy.oid IS NULL OR policy.polpermissive OR policy.polcmd<>''r''
   OR policy.polroles IS DISTINCT FROM ARRAY[(SELECT oid FROM pg_roles WHERE rolname=''authenticated'')]::oid[]
   OR pg_get_expr(policy.polqual,c.oid) IS DISTINCT FROM ''customer_source_membership_private.''||expected.helper_name||''(id)''
   OR helper.oid IS NULL OR NOT helper.prosecdef OR pg_get_userbyid(helper.proowner)<>current_user
   OR helper.proconfig IS DISTINCT FROM ARRAY[''search_path=pg_catalog'',''row_security=off'']::text[]
   OR replace(helper.prosrc,E''\r\n'',E''\n'') IS DISTINCT FROM chr(10)||'' SELECT customer_source_membership_private.''||expected.parent_name||''(p_id);''||chr(10)
   OR NOT has_function_privilege(''authenticated'',helper.oid,''EXECUTE'') OR has_function_privilege(''anon'',helper.oid,''EXECUTE''))
  OR NOT has_schema_privilege(''authenticated'',''customer_source_membership_private'',''USAGE'')
 THEN RAISE EXCEPTION ''CUSTOMER_MEMBERSHIP_SELECT_POLICY_DRIFT''; END IF;
 IF EXISTS(SELECT 1 FROM customer_source_membership_private.adapters a LEFT JOIN pg_proc p ON p.oid=to_regprocedure(a.signature)
  WHERE p.oid IS NULL OR NOT sales_recovery_private.adapter_matches(a.signature,a.after_md5,md5(replace(p.prosrc,E''\r\n'',E''\n''))) OR NOT p.prosecdef OR pg_get_userbyid(p.proowner)<>current_user OR p.proconfig IS DISTINCT FROM a.settings)
 THEN RAISE EXCEPTION ''CUSTOMER_MEMBERSHIP_ADAPTER_DRIFT''; END IF;
 IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname=''public'' AND p.proname LIKE ''crm_v2_%'' AND p.prosecdef
   AND (p.prosrc ~ ''public\.(sales_customers|lead_project_interests|sales)\M'' OR pg_get_function_arguments(p.oid) LIKE ''%p_payload jsonb%'')
   AND NOT EXISTS(SELECT 1 FROM customer_source_membership_private.adapters a WHERE a.signature=quote_ident(n.nspname)||''.''||quote_ident(p.proname)||''(''||replace(oidvectortypes(p.proargtypes),'', '','','')||'')''))
 THEN RAISE EXCEPTION ''CUSTOMER_MEMBERSHIP_ADAPTER_COVERAGE_REQUIRED''; END IF;
 IF EXISTS(SELECT 1 FROM unnest(ARRAY[''public.crm_v2_central_snapshot(integer,integer)'',''public.crm_v2_central_search(jsonb,integer)'',''public.crm_v2_lead_work_snapshot(uuid,uuid)'',''public.crm_v2_booking_search(text,integer)'',''public.crm_v2_booking_context(uuid,integer)'',''public.crm_v2_project_sales(text,text,text,integer)'',''public.crm_v2_sales_report(text,text,text)'',''sales_history_read_private.records(uuid,uuid,uuid,text)'',''sales_history_read_private.original_excel(text)'']) required(signature)
   WHERE NOT EXISTS(SELECT 1 FROM customer_source_membership_private.adapters a WHERE a.signature=required.signature))
 THEN RAISE EXCEPTION ''CUSTOMER_MEMBERSHIP_HISTORY_COVERAGE_REQUIRED''; END IF;
END; ');
 INSERT INTO sales_recovery_private.adapters VALUES('customer_source_membership_private.assert_catalog()','f920526408fd64266d4a84b23f1f8445','781773b618191f0fc8cad998c9bd1fbd');
END;
$recovery_adapter_10$;
DO $recovery_adapter_11$
DECLARE definition text;body text;
BEGIN
 SELECT replace(pg_get_functiondef(oid),E'\r\n',E'\n'),replace(prosrc,E'\r\n',E'\n') INTO definition,body FROM pg_proc WHERE oid='sales_history_read_private.records(uuid,uuid,uuid,text)'::regprocedure;
 IF body IS DISTINCT FROM '
DECLARE actor uuid:=auth.uid(); role_name text:=public.crm_v2_role(); result jsonb; loop_entry record; h jsonb;
BEGIN
 IF actor IS NULL OR coalesce(role_name,'''') NOT IN(''sales'',''admin'',''owner'') THEN RAISE EXCEPTION ''CRM_CUSTOMER_HISTORY_FORBIDDEN''; END IF;
 IF (public.crm_v2_project_sales_capabilities()->>''enabled'')::boolean IS DISTINCT FROM true
  OR NOT crm_external_private.booking_writer_ready() THEN RAISE EXCEPTION ''CRM_CUSTOMER_HISTORY_SETUP_REQUIRED''; END IF;
 IF EXISTS(SELECT 1 FROM crm_external_private.booking_writer_releases w LEFT JOIN crm_external_private.snapshot_batches b ON b.id=w.batch_id
  WHERE b.id IS NULL OR b.feed IS DISTINCT FROM ''customer-sheet'' OR b.plan_digest IS DISTINCT FROM w.plan_digest)
  THEN RAISE EXCEPTION ''CRM_CUSTOMER_HISTORY_INTEGRITY_REQUIRED''; END IF;
 IF p_customer_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM customer_source_membership_private.customers WHERE id=p_customer_id AND merged_into_customer_id IS NULL)
  THEN RAISE EXCEPTION ''CRM_CUSTOMER_HISTORY_NOT_FOUND''; END IF;
 IF p_interest_id IS NOT NULL AND (p_customer_id IS NULL OR NOT EXISTS(SELECT 1 FROM customer_source_membership_private.interests WHERE id=p_interest_id AND customer_id=p_customer_id))
  THEN RAISE EXCEPTION ''CRM_CUSTOMER_HISTORY_SCOPE_INVALID''; END IF;
 IF p_sale_id IS NOT NULL AND (p_customer_id IS NULL OR NOT EXISTS(SELECT 1 FROM customer_source_membership_private.sales s JOIN customer_source_membership_private.interests i ON i.id=s.project_interest_id
  WHERE s.id=p_sale_id AND i.customer_id=p_customer_id AND (p_interest_id IS NULL OR i.id=p_interest_id))) THEN RAISE EXCEPTION ''CRM_CUSTOMER_HISTORY_SCOPE_INVALID''; END IF;
 IF p_project_name IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.projects WHERE name=p_project_name) THEN RAISE EXCEPTION ''CRM_CUSTOMER_HISTORY_NOT_FOUND''; END IF;

 -- Reuse the complete project reader''s stock, identity, prior-round and source
 -- integrity checks before collecting or filtering historical evidence.
 FOR loop_entry IN SELECT DISTINCT i.project_name FROM customer_source_membership_private.interests i
  WHERE (p_customer_id IS NULL OR i.customer_id=p_customer_id) AND (p_project_name IS NULL OR i.project_name=p_project_name)
 LOOP PERFORM public.crm_v2_project_sales(loop_entry.project_name,''all'','''',0); END LOOP;
 IF EXISTS(SELECT 1 FROM customer_source_membership_private.sales s JOIN customer_source_membership_private.interests i ON i.id=s.project_interest_id JOIN customer_source_membership_private.customers c ON c.id=i.customer_id
  LEFT JOIN crm_external_private.prepared_booking_sales p ON p.id=s.external_booking_id
  LEFT JOIN crm_external_private.source_records sr ON sr.batch_id=p.batch_id AND sr.source_row=(p.payload->>''source_row'')::integer
  WHERE s.external_booking_id IS NOT NULL AND (p_customer_id IS NULL OR c.id=p_customer_id) AND (p_project_name IS NULL OR i.project_name=p_project_name)
   AND (p.id IS NULL OR sr.source_row IS NULL OR sr.customer_key IS DISTINCT FROM c.external_customer_key OR p.batch_id IS DISTINCT FROM c.external_snapshot_batch_id
    OR p.payload->>''customer_id'' IS DISTINCT FROM c.id::text OR p.payload->>''interest_id'' IS DISTINCT FROM i.id::text))
  THEN RAISE EXCEPTION ''CRM_CUSTOMER_HISTORY_INTEGRITY_REQUIRED''; END IF;
 IF EXISTS(SELECT 1 FROM crm_external_private.prepared_booking_sales p JOIN customer_source_membership_private.sales s ON s.external_booking_id=p.id
  JOIN customer_source_membership_private.interests i ON i.id=s.project_interest_id WHERE (p_customer_id IS NULL OR i.customer_id=p_customer_id)
  GROUP BY p.batch_id,(p.payload->>''source_row'')::integer,i.id HAVING count(*)>1)
  THEN RAISE EXCEPTION ''CRM_CUSTOMER_HISTORY_INTEGRITY_REQUIRED''; END IF;
 IF EXISTS(SELECT 1 FROM sales_source_creation_private.records r
  LEFT JOIN customer_source_membership_private.customers c ON c.id=r.customer_id LEFT JOIN customer_source_membership_private.interests i ON i.id=r.interest_id
  WHERE (p_customer_id IS NULL OR r.customer_id=p_customer_id) AND (c.id IS NULL OR i.id IS NULL OR c.merged_into_customer_id IS NOT NULL
   OR c.supplemental_creation_id IS DISTINCT FROM r.id OR i.supplemental_creation_id IS DISTINCT FROM r.id OR i.customer_id IS DISTINCT FROM c.id
   OR i.project_name IS DISTINCT FROM r.payload->>''projectName'')) THEN RAISE EXCEPTION ''CRM_CUSTOMER_HISTORY_INTEGRITY_REQUIRED''; END IF;
 IF EXISTS(SELECT 1 FROM sales_unknown_history_private.records r LEFT JOIN customer_source_membership_private.customers c ON c.id=r.customer_id
  LEFT JOIN customer_source_membership_private.interests i ON i.id=r.interest_id WHERE (p_customer_id IS NULL OR r.customer_id=p_customer_id)
  AND (c.id IS NULL OR c.merged_into_customer_id IS NOT NULL OR (r.interest_id IS NOT NULL AND (i.id IS NULL OR i.customer_id IS DISTINCT FROM c.id))))
  THEN RAISE EXCEPTION ''CRM_CUSTOMER_HISTORY_INTEGRITY_REQUIRED''; END IF;
 FOR loop_entry IN SELECT e.*,to_jsonb(s) AS current_sale FROM sales_revision_private.events e LEFT JOIN customer_source_membership_private.sales s ON s.id=e.sale_id
  WHERE (p_customer_id IS NULL OR e.customer_id=p_customer_id)
 LOOP
  IF loop_entry.current_sale IS NULL OR (loop_entry.operation=''cancel'' AND loop_entry.current_sale->>''historical_revision_id'' IS DISTINCT FROM loop_entry.id::text)
   OR (loop_entry.operation=''create_booking'' AND loop_entry.current_sale->>''historical_import_id'' IS DISTINCT FROM loop_entry.id::text)
   THEN RAISE EXCEPTION ''CRM_CUSTOMER_HISTORY_INTEGRITY_REQUIRED''; END IF;
  h:=sales_private.crm_booking_imported_history(loop_entry.current_sale);
  IF h IS NULL OR h->>''sourceRow'' IS DISTINCT FROM loop_entry.source_row::text THEN RAISE EXCEPTION ''CRM_CUSTOMER_HISTORY_INTEGRITY_REQUIRED''; END IF;
 END LOOP;

 -- A source row is selected only through explicit candidate membership. Two
 -- visits with the same customer/day keep separate source keys. Ambiguous
 -- multi-interest membership is represented as unknown in customer scope.
 WITH original_members AS (
  SELECT s.batch_id,s.source_row,c.id customer_id,i.id interest_id,i.project_name,
   s.payload->''reviewedHistory''->>''visitHistoryDate'' visit_day,
   (SELECT sale.id FROM customer_source_membership_private.sales sale JOIN crm_external_private.prepared_booking_sales p ON p.id=sale.external_booking_id
    WHERE sale.project_interest_id=i.id AND p.batch_id=s.batch_id AND (p.payload->>''source_row'')::integer=s.source_row ORDER BY sale.id LIMIT 1) sale_id
  FROM crm_external_private.source_records s JOIN crm_external_private.booking_writer_releases w ON w.batch_id=s.batch_id
  JOIN crm_external_private.snapshot_batches b ON b.id=w.batch_id AND b.plan_digest=w.plan_digest AND b.feed=''customer-sheet''
  JOIN customer_source_membership_private.customers c ON c.external_snapshot_batch_id=s.batch_id AND c.external_customer_key=s.customer_key AND c.merged_into_customer_id IS NULL
  JOIN crm_external_private.interest_candidates ic ON ic.batch_id=s.batch_id AND ic.customer_key=s.customer_key AND ic.payload->''sourceRows'' @> jsonb_build_array(s.source_row)
  JOIN customer_source_membership_private.interests i ON i.external_snapshot_batch_id=ic.batch_id AND i.external_interest_key=ic.entity_key AND i.customer_id=c.id AND i.project_name=ic.project_label
  WHERE s.disposition=''mapped_for_review'' AND customer_source_membership_private.source_member(s.batch_id,s.source_row) AND NOT rental_source_retirement_private.excluded(s.batch_id,s.source_row) AND s.source_row BETWEEN 2 AND 966
   AND NOT EXISTS(SELECT 1 FROM crm_external_private.sales_rollback_receipts x WHERE x.batch_id=s.batch_id)
   AND (p_customer_id IS NULL OR c.id=p_customer_id) AND (p_interest_id IS NULL OR i.id=p_interest_id)
   AND (p_project_name IS NULL OR i.project_name=p_project_name)
   AND (p_sale_id IS NULL OR EXISTS(SELECT 1 FROM customer_source_membership_private.sales selected_sale JOIN crm_external_private.prepared_booking_sales selected_source ON selected_source.id=selected_sale.external_booking_id
    WHERE selected_sale.id=p_sale_id AND selected_sale.project_interest_id=i.id AND selected_source.batch_id=s.batch_id AND (selected_source.payload->>''source_row'')::integer=s.source_row))
 ), original_unassigned AS (
  SELECT s.batch_id::text||'':''||s.source_row::text key,c.id customer_id,s.source_row,NULL::uuid interest_id,NULL::text project_name,''[]''::jsonb project_names,NULL::uuid sale_id,
   jsonb_build_array(jsonb_build_object(''kind'',''visited'',''date'',s.payload->''reviewedHistory''->>''visitHistoryDate'',''precision'',CASE WHEN s.payload->''reviewedHistory''->>''visitHistoryDate'' IS NULL THEN ''unknown'' ELSE ''day'' END)) events,0 priority
  FROM crm_external_private.source_records s JOIN crm_external_private.booking_writer_releases w ON w.batch_id=s.batch_id
  JOIN crm_external_private.snapshot_batches b ON b.id=w.batch_id AND b.plan_digest=w.plan_digest AND b.feed=''customer-sheet''
  JOIN customer_source_membership_private.customers c ON c.external_snapshot_batch_id=s.batch_id AND c.external_customer_key=s.customer_key AND c.merged_into_customer_id IS NULL
  WHERE s.disposition=''mapped_for_review'' AND customer_source_membership_private.source_member(s.batch_id,s.source_row) AND NOT rental_source_retirement_private.excluded(s.batch_id,s.source_row) AND s.source_row BETWEEN 2 AND 966 AND s.payload->''reviewedHistory''->''projectLabels''=''[]''
   AND NOT EXISTS(SELECT 1 FROM crm_external_private.interest_candidates ic WHERE ic.batch_id=s.batch_id AND ic.customer_key=s.customer_key AND ic.payload->''sourceRows'' @> jsonb_build_array(s.source_row))
   AND NOT EXISTS(SELECT 1 FROM crm_external_private.sales_rollback_receipts x WHERE x.batch_id=s.batch_id)
   AND (p_customer_id IS NULL OR c.id=p_customer_id) AND p_interest_id IS NULL AND p_sale_id IS NULL
 ), originals AS (
  SELECT batch_id::text||'':''||source_row::text key,customer_id,source_row,
   CASE WHEN count(DISTINCT interest_id)=1 THEN min(interest_id::text)::uuid END interest_id,
   CASE WHEN count(DISTINCT project_name)=1 THEN min(project_name) END project_name,
   to_jsonb(array_agg(DISTINCT project_name ORDER BY project_name)) project_names,
   CASE WHEN count(DISTINCT interest_id)=1 AND count(DISTINCT sale_id)=1 THEN min(sale_id::text)::uuid END sale_id,
   jsonb_build_array(jsonb_build_object(''kind'',''visited'',''date'',min(visit_day),''precision'',CASE WHEN min(visit_day) IS NULL THEN ''unknown'' ELSE ''day'' END)) events,0 priority
  FROM original_members GROUP BY batch_id,source_row,customer_id
 ), creation AS (
  SELECT ''source:''||r.source_key key,r.customer_id,r.source_row,r.interest_id,i.project_name,jsonb_build_array(i.project_name) project_names,NULL::uuid sale_id,
   (SELECT coalesce(jsonb_agg(jsonb_build_object(''kind'',e.kind,''date'',to_char(e.event_day,''YYYY-MM-DD''),''precision'',e.precision) ORDER BY e.event_key),''[]'')
     FROM sales_source_creation_private.events e WHERE e.record_id=r.id) events,1 priority
  FROM sales_source_creation_private.records r JOIN customer_source_membership_private.interests i ON i.id=r.interest_id
  WHERE (p_customer_id IS NULL OR r.customer_id=p_customer_id) AND (p_interest_id IS NULL OR r.interest_id=p_interest_id)
   AND (p_project_name IS NULL OR i.project_name=p_project_name)
 ), unknown_rows AS (
  SELECT coalesce((SELECT min(s.batch_id::text)||'':''||r.row_number::text FROM crm_external_private.source_records s
    JOIN customer_source_membership_private.customers c ON c.id=r.customer_id AND c.external_snapshot_batch_id=s.batch_id AND c.external_customer_key=s.customer_key WHERE s.source_row=r.row_number),''unknown:''||r.source_key) key,
   r.customer_id,r.row_number source_row,r.interest_id,i.project_name,CASE WHEN i.project_name IS NULL THEN ''[]''::jsonb ELSE jsonb_build_array(i.project_name) END project_names,NULL::uuid sale_id,
   (SELECT coalesce(jsonb_agg(jsonb_build_object(''kind'',e.kind,''date'',to_char(e.occurred_date,''YYYY-MM-DD''),''precision'',e.precision) ORDER BY e.sequence),''[]'')
    FROM sales_unknown_history_private.events e WHERE e.batch_id=r.batch_id AND e.source_key=r.source_key) events,2 priority
  FROM sales_unknown_history_private.records r LEFT JOIN customer_source_membership_private.interests i ON i.id=r.interest_id
  WHERE (p_customer_id IS NULL OR r.customer_id=p_customer_id) AND (p_interest_id IS NULL OR r.interest_id=p_interest_id)
   AND (p_project_name IS NULL OR i.project_name=p_project_name OR r.reason=''unknown_project'')
 ), revised AS (
  SELECT coalesce((SELECT min(s.batch_id::text)||'':''||e.source_row::text FROM crm_external_private.source_records s
    JOIN customer_source_membership_private.customers c ON c.id=e.customer_id AND c.external_snapshot_batch_id=s.batch_id AND c.external_customer_key=s.customer_key WHERE s.source_row=e.source_row),''revision:''||e.source_key) key,
   e.customer_id,e.source_row,e.interest_id,i.project_name,jsonb_build_array(i.project_name) project_names,e.sale_id,e.source_history events,3 priority
  FROM sales_revision_private.events e JOIN customer_source_membership_private.interests i ON i.id=e.interest_id
  WHERE (p_customer_id IS NULL OR e.customer_id=p_customer_id) AND (p_interest_id IS NULL OR e.interest_id=p_interest_id)
   AND (p_project_name IS NULL OR i.project_name=p_project_name)
 ), all_rows AS (SELECT * FROM originals UNION ALL SELECT * FROM original_unassigned UNION ALL SELECT * FROM creation UNION ALL SELECT * FROM unknown_rows UNION ALL SELECT * FROM revised),
 chosen AS (SELECT DISTINCT ON(key) * FROM all_rows ORDER BY key,priority DESC),
 scoped AS (SELECT * FROM chosen WHERE p_sale_id IS NULL OR sale_id=p_sale_id)
 SELECT coalesce(jsonb_agg(jsonb_build_object(''key'',key,''customerId'',customer_id,''projectName'',project_name,''projectNames'',project_names,''interestId'',interest_id,''saleId'',sale_id,''sourceRow'',source_row,''events'',events) ORDER BY key),''[]'') INTO result FROM scoped;
 IF jsonb_array_length(result)>10000 THEN RAISE EXCEPTION ''CRM_CUSTOMER_HISTORY_LIMIT''; END IF;
 -- Original booking days come through the unchanged provenance verifier, not
 -- through guessed timestamps. Revision records already contain their full
 -- approved visit/booking/cancellation timeline.
 FOR loop_entry IN SELECT value item FROM jsonb_array_elements(result) WHERE value->''saleId''<>''null''::jsonb LOOP
  IF NOT EXISTS(SELECT 1 FROM sales_revision_private.events WHERE sale_id=(loop_entry.item->>''saleId'')::uuid) THEN
   SELECT sales_private.crm_booking_imported_history(to_jsonb(s)) INTO h FROM customer_source_membership_private.sales s WHERE id=(loop_entry.item->>''saleId'')::uuid;
   IF h IS NULL THEN RAISE EXCEPTION ''CRM_CUSTOMER_HISTORY_INTEGRITY_REQUIRED''; END IF;
   h:=jsonb_build_array(jsonb_build_object(''kind'',''booked'',''date'',h->''bookedDate'',''precision'',CASE WHEN h->>''bookedDate'' IS NULL THEN ''unknown'' ELSE ''day'' END))
    ||CASE WHEN h->>''sourceStage''=''cancelled'' THEN jsonb_build_array(jsonb_build_object(''kind'',''cancelled'',''date'',h->''cancelledDate'',''precision'',CASE WHEN h->>''cancelledDate'' IS NULL THEN ''unknown'' ELSE ''day'' END)) ELSE ''[]''::jsonb END
    ||CASE WHEN h->>''sourceStage''=''transferred'' THEN jsonb_build_array(jsonb_build_object(''kind'',''transferred'',''date'',h->''transferredDate'',''precision'',CASE WHEN h->>''transferredDate'' IS NULL THEN ''unknown'' ELSE ''day'' END)) ELSE ''[]''::jsonb END;
   SELECT jsonb_agg(CASE WHEN value->>''key''=loop_entry.item->>''key'' THEN value||jsonb_build_object(''events'',value->''events''||h) ELSE value END ORDER BY ordinality) INTO result FROM jsonb_array_elements(result) WITH ORDINALITY;
  END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(result) rr CROSS JOIN LATERAL jsonb_array_elements(rr->''events'') ev
  WHERE ev->>''kind'' NOT IN(''visited'',''booked'',''contracted'',''loan_submitted'',''transferred'',''handover'',''cancelled'') OR ev->>''kind'' IS NULL
   OR ((ev->>''precision''=''unknown'' AND ev->''date''=''null'') OR (ev->>''precision''=''day'' AND jsonb_typeof(ev->''date'')=''string''
    AND ev->>''date'' ~ ''^[0-9]{4}-[0-9]{2}-[0-9]{2}$'' AND pg_input_is_valid(ev->>''date'',''date''))) IS DISTINCT FROM true)
  THEN RAISE EXCEPTION ''CRM_CUSTOMER_HISTORY_DATE_INVALID''; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(result) rr CROSS JOIN LATERAL jsonb_array_elements(rr->''events'') ev
  GROUP BY rr->>''key'',ev->>''kind'' HAVING count(*)>1) THEN RAISE EXCEPTION ''CRM_CUSTOMER_HISTORY_INTEGRITY_REQUIRED''; END IF;
 RETURN customer_source_membership_private.history(result,p_customer_id,p_interest_id,p_sale_id,p_project_name);
END;
' OR md5(body) IS DISTINCT FROM '5e54517419672b3cf2260be8c1a81716'
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='sales_history_read_private.records(uuid,uuid,uuid,text)'::regprocedure AND pg_get_userbyid(proowner)=current_user
   AND prosecdef=true AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog','TimeZone=UTC','DateStyle=ISO, YMD']::text[])
  OR (length(definition)-length(replace(definition,body,'')))/length(body)<>1
 THEN RAISE EXCEPTION 'CUSTOMER_RECOVERY_EXACT_ADAPTER_REVIEW_REQUIRED'; END IF;
 EXECUTE replace(definition,body,'
DECLARE actor uuid:=auth.uid(); role_name text:=public.crm_v2_role(); result jsonb; loop_entry record; h jsonb;
BEGIN
 IF actor IS NULL OR coalesce(role_name,'''') NOT IN(''sales'',''admin'',''owner'') THEN RAISE EXCEPTION ''CRM_CUSTOMER_HISTORY_FORBIDDEN''; END IF;
 IF (public.crm_v2_project_sales_capabilities()->>''enabled'')::boolean IS DISTINCT FROM true
  OR NOT crm_external_private.booking_writer_ready() THEN RAISE EXCEPTION ''CRM_CUSTOMER_HISTORY_SETUP_REQUIRED''; END IF;
 IF EXISTS(SELECT 1 FROM crm_external_private.booking_writer_releases w LEFT JOIN crm_external_private.snapshot_batches b ON b.id=w.batch_id
  WHERE b.id IS NULL OR b.feed IS DISTINCT FROM ''customer-sheet'' OR b.plan_digest IS DISTINCT FROM w.plan_digest)
  THEN RAISE EXCEPTION ''CRM_CUSTOMER_HISTORY_INTEGRITY_REQUIRED''; END IF;
 IF p_customer_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM customer_source_membership_private.customers WHERE id=p_customer_id AND merged_into_customer_id IS NULL)
  THEN RAISE EXCEPTION ''CRM_CUSTOMER_HISTORY_NOT_FOUND''; END IF;
 IF p_interest_id IS NOT NULL AND (p_customer_id IS NULL OR NOT EXISTS(SELECT 1 FROM customer_source_membership_private.interests WHERE id=p_interest_id AND customer_id=p_customer_id))
  THEN RAISE EXCEPTION ''CRM_CUSTOMER_HISTORY_SCOPE_INVALID''; END IF;
 IF p_sale_id IS NOT NULL AND (p_customer_id IS NULL OR NOT EXISTS(SELECT 1 FROM customer_source_membership_private.sales s JOIN customer_source_membership_private.interests i ON i.id=s.project_interest_id
  WHERE s.id=p_sale_id AND i.customer_id=p_customer_id AND (p_interest_id IS NULL OR i.id=p_interest_id))) THEN RAISE EXCEPTION ''CRM_CUSTOMER_HISTORY_SCOPE_INVALID''; END IF;
 IF p_project_name IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.projects WHERE name=p_project_name) THEN RAISE EXCEPTION ''CRM_CUSTOMER_HISTORY_NOT_FOUND''; END IF;

 -- Reuse the complete project reader''s stock, identity, prior-round and source
 -- integrity checks before collecting or filtering historical evidence.
 FOR loop_entry IN SELECT DISTINCT i.project_name FROM customer_source_membership_private.interests i
  WHERE (p_customer_id IS NULL OR i.customer_id=p_customer_id) AND (p_project_name IS NULL OR i.project_name=p_project_name)
 LOOP PERFORM public.crm_v2_project_sales(loop_entry.project_name,''all'','''',0); END LOOP;
 IF EXISTS(SELECT 1 FROM customer_source_membership_private.sales s JOIN customer_source_membership_private.interests i ON i.id=s.project_interest_id JOIN customer_source_membership_private.customers c ON c.id=i.customer_id
  LEFT JOIN crm_external_private.prepared_booking_sales p ON p.id=s.external_booking_id
  LEFT JOIN crm_external_private.source_records sr ON sr.batch_id=p.batch_id AND sr.source_row=(p.payload->>''source_row'')::integer
  WHERE s.external_booking_id IS NOT NULL AND (p_customer_id IS NULL OR c.id=p_customer_id) AND (p_project_name IS NULL OR i.project_name=p_project_name)
   AND (p.id IS NULL OR sr.source_row IS NULL OR sr.customer_key IS DISTINCT FROM c.external_customer_key OR p.batch_id IS DISTINCT FROM c.external_snapshot_batch_id
    OR p.payload->>''customer_id'' IS DISTINCT FROM c.id::text OR p.payload->>''interest_id'' IS DISTINCT FROM i.id::text))
  THEN RAISE EXCEPTION ''CRM_CUSTOMER_HISTORY_INTEGRITY_REQUIRED''; END IF;
 IF EXISTS(SELECT 1 FROM crm_external_private.prepared_booking_sales p JOIN customer_source_membership_private.sales s ON s.external_booking_id=p.id
  JOIN customer_source_membership_private.interests i ON i.id=s.project_interest_id WHERE (p_customer_id IS NULL OR i.customer_id=p_customer_id)
  GROUP BY p.batch_id,(p.payload->>''source_row'')::integer,i.id HAVING count(*)>1)
  THEN RAISE EXCEPTION ''CRM_CUSTOMER_HISTORY_INTEGRITY_REQUIRED''; END IF;
 IF EXISTS(SELECT 1 FROM sales_recovery_private.active_creation_records r
  LEFT JOIN customer_source_membership_private.customers c ON c.id=r.customer_id LEFT JOIN customer_source_membership_private.interests i ON i.id=r.interest_id
  WHERE (p_customer_id IS NULL OR r.customer_id=p_customer_id) AND (c.id IS NULL OR i.id IS NULL OR c.merged_into_customer_id IS NOT NULL
   OR c.supplemental_creation_id IS DISTINCT FROM r.id OR i.supplemental_creation_id IS DISTINCT FROM r.id OR i.customer_id IS DISTINCT FROM c.id
   OR i.project_name IS DISTINCT FROM r.payload->>''projectName'')) THEN RAISE EXCEPTION ''CRM_CUSTOMER_HISTORY_INTEGRITY_REQUIRED''; END IF;
 IF EXISTS(SELECT 1 FROM sales_recovery_private.active_unknown_records r LEFT JOIN customer_source_membership_private.customers c ON c.id=r.customer_id
  LEFT JOIN customer_source_membership_private.interests i ON i.id=r.interest_id WHERE (p_customer_id IS NULL OR r.customer_id=p_customer_id)
  AND (c.id IS NULL OR c.merged_into_customer_id IS NOT NULL OR (r.interest_id IS NOT NULL AND (i.id IS NULL OR i.customer_id IS DISTINCT FROM c.id))))
  THEN RAISE EXCEPTION ''CRM_CUSTOMER_HISTORY_INTEGRITY_REQUIRED''; END IF;
 FOR loop_entry IN SELECT e.*,to_jsonb(s) AS current_sale FROM sales_recovery_private.active_revision_events e LEFT JOIN customer_source_membership_private.sales s ON s.id=e.sale_id
  WHERE (p_customer_id IS NULL OR e.customer_id=p_customer_id)
 LOOP
  IF loop_entry.current_sale IS NULL OR (loop_entry.operation=''cancel'' AND loop_entry.current_sale->>''historical_revision_id'' IS DISTINCT FROM loop_entry.id::text)
   OR (loop_entry.operation=''create_booking'' AND loop_entry.current_sale->>''historical_import_id'' IS DISTINCT FROM loop_entry.id::text)
   THEN RAISE EXCEPTION ''CRM_CUSTOMER_HISTORY_INTEGRITY_REQUIRED''; END IF;
  h:=sales_private.crm_booking_imported_history(loop_entry.current_sale);
  IF h IS NULL OR h->>''sourceRow'' IS DISTINCT FROM loop_entry.source_row::text THEN RAISE EXCEPTION ''CRM_CUSTOMER_HISTORY_INTEGRITY_REQUIRED''; END IF;
 END LOOP;

 -- A source row is selected only through explicit candidate membership. Two
 -- visits with the same customer/day keep separate source keys. Ambiguous
 -- multi-interest membership is represented as unknown in customer scope.
 WITH original_members AS (
  SELECT s.batch_id,s.source_row,c.id customer_id,i.id interest_id,i.project_name,
   s.payload->''reviewedHistory''->>''visitHistoryDate'' visit_day,
   (SELECT sale.id FROM customer_source_membership_private.sales sale JOIN crm_external_private.prepared_booking_sales p ON p.id=sale.external_booking_id
    WHERE sale.project_interest_id=i.id AND p.batch_id=s.batch_id AND (p.payload->>''source_row'')::integer=s.source_row ORDER BY sale.id LIMIT 1) sale_id
  FROM crm_external_private.source_records s JOIN crm_external_private.booking_writer_releases w ON w.batch_id=s.batch_id
  JOIN crm_external_private.snapshot_batches b ON b.id=w.batch_id AND b.plan_digest=w.plan_digest AND b.feed=''customer-sheet''
  JOIN customer_source_membership_private.customers c ON c.external_snapshot_batch_id=s.batch_id AND c.external_customer_key=s.customer_key AND c.merged_into_customer_id IS NULL
  JOIN crm_external_private.interest_candidates ic ON ic.batch_id=s.batch_id AND ic.customer_key=s.customer_key AND ic.payload->''sourceRows'' @> jsonb_build_array(s.source_row)
  JOIN customer_source_membership_private.interests i ON i.external_snapshot_batch_id=ic.batch_id AND i.external_interest_key=ic.entity_key AND i.customer_id=c.id AND i.project_name=ic.project_label
  WHERE s.disposition=''mapped_for_review'' AND customer_source_membership_private.source_member(s.batch_id,s.source_row) AND NOT rental_source_retirement_private.excluded(s.batch_id,s.source_row) AND s.source_row BETWEEN 2 AND 966
   AND NOT EXISTS(SELECT 1 FROM crm_external_private.sales_rollback_receipts x WHERE x.batch_id=s.batch_id)
   AND (p_customer_id IS NULL OR c.id=p_customer_id) AND (p_interest_id IS NULL OR i.id=p_interest_id)
   AND (p_project_name IS NULL OR i.project_name=p_project_name)
   AND (p_sale_id IS NULL OR EXISTS(SELECT 1 FROM customer_source_membership_private.sales selected_sale JOIN crm_external_private.prepared_booking_sales selected_source ON selected_source.id=selected_sale.external_booking_id
    WHERE selected_sale.id=p_sale_id AND selected_sale.project_interest_id=i.id AND selected_source.batch_id=s.batch_id AND (selected_source.payload->>''source_row'')::integer=s.source_row))
 ), original_unassigned AS (
  SELECT s.batch_id::text||'':''||s.source_row::text key,c.id customer_id,s.source_row,NULL::uuid interest_id,NULL::text project_name,''[]''::jsonb project_names,NULL::uuid sale_id,
   jsonb_build_array(jsonb_build_object(''kind'',''visited'',''date'',s.payload->''reviewedHistory''->>''visitHistoryDate'',''precision'',CASE WHEN s.payload->''reviewedHistory''->>''visitHistoryDate'' IS NULL THEN ''unknown'' ELSE ''day'' END)) events,0 priority
  FROM crm_external_private.source_records s JOIN crm_external_private.booking_writer_releases w ON w.batch_id=s.batch_id
  JOIN crm_external_private.snapshot_batches b ON b.id=w.batch_id AND b.plan_digest=w.plan_digest AND b.feed=''customer-sheet''
  JOIN customer_source_membership_private.customers c ON c.external_snapshot_batch_id=s.batch_id AND c.external_customer_key=s.customer_key AND c.merged_into_customer_id IS NULL
  WHERE s.disposition=''mapped_for_review'' AND customer_source_membership_private.source_member(s.batch_id,s.source_row) AND NOT rental_source_retirement_private.excluded(s.batch_id,s.source_row) AND s.source_row BETWEEN 2 AND 966 AND s.payload->''reviewedHistory''->''projectLabels''=''[]''
   AND NOT EXISTS(SELECT 1 FROM crm_external_private.interest_candidates ic WHERE ic.batch_id=s.batch_id AND ic.customer_key=s.customer_key AND ic.payload->''sourceRows'' @> jsonb_build_array(s.source_row))
   AND NOT EXISTS(SELECT 1 FROM crm_external_private.sales_rollback_receipts x WHERE x.batch_id=s.batch_id)
   AND (p_customer_id IS NULL OR c.id=p_customer_id) AND p_interest_id IS NULL AND p_sale_id IS NULL
 ), originals AS (
  SELECT batch_id::text||'':''||source_row::text key,customer_id,source_row,
   CASE WHEN count(DISTINCT interest_id)=1 THEN min(interest_id::text)::uuid END interest_id,
   CASE WHEN count(DISTINCT project_name)=1 THEN min(project_name) END project_name,
   to_jsonb(array_agg(DISTINCT project_name ORDER BY project_name)) project_names,
   CASE WHEN count(DISTINCT interest_id)=1 AND count(DISTINCT sale_id)=1 THEN min(sale_id::text)::uuid END sale_id,
   jsonb_build_array(jsonb_build_object(''kind'',''visited'',''date'',min(visit_day),''precision'',CASE WHEN min(visit_day) IS NULL THEN ''unknown'' ELSE ''day'' END)) events,0 priority
  FROM original_members GROUP BY batch_id,source_row,customer_id
 ), creation AS (
  SELECT ''source:''||r.source_key key,r.customer_id,r.source_row,r.interest_id,i.project_name,jsonb_build_array(i.project_name) project_names,NULL::uuid sale_id,
   (SELECT coalesce(jsonb_agg(jsonb_build_object(''kind'',e.kind,''date'',to_char(e.event_day,''YYYY-MM-DD''),''precision'',e.precision) ORDER BY e.event_key),''[]'')
     FROM sales_source_creation_private.events e WHERE e.record_id=r.id) events,1 priority
  FROM sales_recovery_private.active_creation_records r JOIN customer_source_membership_private.interests i ON i.id=r.interest_id
  WHERE (p_customer_id IS NULL OR r.customer_id=p_customer_id) AND (p_interest_id IS NULL OR r.interest_id=p_interest_id)
   AND (p_project_name IS NULL OR i.project_name=p_project_name)
 ), unknown_rows AS (
  SELECT coalesce((SELECT min(s.batch_id::text)||'':''||r.row_number::text FROM crm_external_private.source_records s
    JOIN customer_source_membership_private.customers c ON c.id=r.customer_id AND c.external_snapshot_batch_id=s.batch_id AND c.external_customer_key=s.customer_key WHERE s.source_row=r.row_number),''unknown:''||r.source_key) key,
   r.customer_id,r.row_number source_row,r.interest_id,i.project_name,CASE WHEN i.project_name IS NULL THEN ''[]''::jsonb ELSE jsonb_build_array(i.project_name) END project_names,NULL::uuid sale_id,
   (SELECT coalesce(jsonb_agg(jsonb_build_object(''kind'',e.kind,''date'',to_char(e.occurred_date,''YYYY-MM-DD''),''precision'',e.precision) ORDER BY e.sequence),''[]'')
    FROM sales_unknown_history_private.events e WHERE e.batch_id=r.batch_id AND e.source_key=r.source_key) events,2 priority
  FROM sales_recovery_private.active_unknown_records r LEFT JOIN customer_source_membership_private.interests i ON i.id=r.interest_id
  WHERE (p_customer_id IS NULL OR r.customer_id=p_customer_id) AND (p_interest_id IS NULL OR r.interest_id=p_interest_id)
   AND (p_project_name IS NULL OR i.project_name=p_project_name OR r.reason=''unknown_project'')
 ), revised AS (
  SELECT coalesce((SELECT min(s.batch_id::text)||'':''||e.source_row::text FROM crm_external_private.source_records s
    JOIN customer_source_membership_private.customers c ON c.id=e.customer_id AND c.external_snapshot_batch_id=s.batch_id AND c.external_customer_key=s.customer_key WHERE s.source_row=e.source_row),''revision:''||e.source_key) key,
   e.customer_id,e.source_row,e.interest_id,i.project_name,jsonb_build_array(i.project_name) project_names,e.sale_id,e.source_history events,3 priority
  FROM sales_recovery_private.active_revision_events e JOIN customer_source_membership_private.interests i ON i.id=e.interest_id
  WHERE (p_customer_id IS NULL OR e.customer_id=p_customer_id) AND (p_interest_id IS NULL OR e.interest_id=p_interest_id)
   AND (p_project_name IS NULL OR i.project_name=p_project_name)
 ), all_rows AS (SELECT * FROM originals UNION ALL SELECT * FROM original_unassigned UNION ALL SELECT * FROM creation UNION ALL SELECT * FROM unknown_rows UNION ALL SELECT * FROM revised),
 chosen AS (SELECT DISTINCT ON(key) * FROM all_rows ORDER BY key,priority DESC),
 scoped AS (SELECT * FROM chosen WHERE p_sale_id IS NULL OR sale_id=p_sale_id)
 SELECT coalesce(jsonb_agg(jsonb_build_object(''key'',key,''customerId'',customer_id,''projectName'',project_name,''projectNames'',project_names,''interestId'',interest_id,''saleId'',sale_id,''sourceRow'',source_row,''events'',events) ORDER BY key),''[]'') INTO result FROM scoped;
 IF jsonb_array_length(result)>10000 THEN RAISE EXCEPTION ''CRM_CUSTOMER_HISTORY_LIMIT''; END IF;
 -- Original booking days come through the unchanged provenance verifier, not
 -- through guessed timestamps. Revision records already contain their full
 -- approved visit/booking/cancellation timeline.
 FOR loop_entry IN SELECT value item FROM jsonb_array_elements(result) WHERE value->''saleId''<>''null''::jsonb LOOP
  IF NOT EXISTS(SELECT 1 FROM sales_recovery_private.active_revision_events WHERE sale_id=(loop_entry.item->>''saleId'')::uuid) THEN
   SELECT sales_private.crm_booking_imported_history(to_jsonb(s)) INTO h FROM customer_source_membership_private.sales s WHERE id=(loop_entry.item->>''saleId'')::uuid;
   IF h IS NULL THEN RAISE EXCEPTION ''CRM_CUSTOMER_HISTORY_INTEGRITY_REQUIRED''; END IF;
   h:=jsonb_build_array(jsonb_build_object(''kind'',''booked'',''date'',h->''bookedDate'',''precision'',CASE WHEN h->>''bookedDate'' IS NULL THEN ''unknown'' ELSE ''day'' END))
    ||CASE WHEN h->>''sourceStage''=''cancelled'' THEN jsonb_build_array(jsonb_build_object(''kind'',''cancelled'',''date'',h->''cancelledDate'',''precision'',CASE WHEN h->>''cancelledDate'' IS NULL THEN ''unknown'' ELSE ''day'' END)) ELSE ''[]''::jsonb END
    ||CASE WHEN h->>''sourceStage''=''transferred'' THEN jsonb_build_array(jsonb_build_object(''kind'',''transferred'',''date'',h->''transferredDate'',''precision'',CASE WHEN h->>''transferredDate'' IS NULL THEN ''unknown'' ELSE ''day'' END)) ELSE ''[]''::jsonb END;
   SELECT jsonb_agg(CASE WHEN value->>''key''=loop_entry.item->>''key'' THEN value||jsonb_build_object(''events'',value->''events''||h) ELSE value END ORDER BY ordinality) INTO result FROM jsonb_array_elements(result) WITH ORDINALITY;
  END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(result) rr CROSS JOIN LATERAL jsonb_array_elements(rr->''events'') ev
  WHERE ev->>''kind'' NOT IN(''visited'',''booked'',''contracted'',''loan_submitted'',''transferred'',''handover'',''cancelled'') OR ev->>''kind'' IS NULL
   OR ((ev->>''precision''=''unknown'' AND ev->''date''=''null'') OR (ev->>''precision''=''day'' AND jsonb_typeof(ev->''date'')=''string''
    AND ev->>''date'' ~ ''^[0-9]{4}-[0-9]{2}-[0-9]{2}$'' AND pg_input_is_valid(ev->>''date'',''date''))) IS DISTINCT FROM true)
  THEN RAISE EXCEPTION ''CRM_CUSTOMER_HISTORY_DATE_INVALID''; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(result) rr CROSS JOIN LATERAL jsonb_array_elements(rr->''events'') ev
  GROUP BY rr->>''key'',ev->>''kind'' HAVING count(*)>1) THEN RAISE EXCEPTION ''CRM_CUSTOMER_HISTORY_INTEGRITY_REQUIRED''; END IF;
 RETURN customer_source_membership_private.history(result,p_customer_id,p_interest_id,p_sale_id,p_project_name);
END;
');
 INSERT INTO sales_recovery_private.adapters VALUES('sales_history_read_private.records(uuid,uuid,uuid,text)','5e54517419672b3cf2260be8c1a81716','0a8a53a2083e6961dfd1155bc3076454');
END;
$recovery_adapter_11$;
DO $recovery_adapter_12$
DECLARE definition text;body text;
BEGIN
 SELECT replace(pg_get_functiondef(oid),E'\r\n',E'\n'),replace(prosrc,E'\r\n',E'\n') INTO definition,body FROM pg_proc WHERE oid='sales_revision_private.history(jsonb,jsonb)'::regprocedure;
 IF body IS DISTINCT FROM '
DECLARE s public.sales%ROWTYPE; e sales_revision_private.events%ROWTYPE; revision sales_revision_private.events%ROWTYPE; evidence jsonb:=p_original;
BEGIN
 SELECT * INTO s FROM public.sales WHERE id=(p_sale->>''id'')::uuid;
 IF s.id IS NULL OR NOT p_sale @> to_jsonb(s) THEN RAISE EXCEPTION ''HISTORICAL_REVISION_PROVENANCE''; END IF;
 IF s.historical_import_id IS NOT NULL THEN
  SELECT * INTO e FROM sales_revision_private.events WHERE id=s.historical_import_id AND operation=''create_booking'';
  IF e.id IS NULL OR e.sale_id IS DISTINCT FROM s.id OR e.interest_id IS DISTINCT FROM s.project_interest_id OR e.plot_id IS DISTINCT FROM s.plot_id
   OR NOT EXISTS(SELECT 1 FROM public.lead_project_interests i WHERE i.id=e.interest_id AND i.customer_id=e.customer_id)
   OR EXISTS(SELECT 1 FROM unnest(ARRAY[''id'',''lead_id'',''project_interest_id'',''plot_id'',''booking_round'',''previous_sale_id'',''booking_route'',''booking_route_reason'',''booked_at'',''list_price'',''discount_amount'',''external_booking_id'',''external_source_stage'',''historical_import_id'',''sale_price'',''closing_sales_user_id'']) k WHERE e.after_sale->k IS DISTINCT FROM p_sale->k)
  THEN RAISE EXCEPTION ''HISTORICAL_REVISION_PROVENANCE''; END IF;
  evidence:=jsonb_build_object(''source'',''customer_sheet'',''batchId'',e.batch_id,''sourceRow'',e.source_row,''sourceStage'',''booked'',''bookedDate'',e.booked_day,''cancelledDate'',NULL,''transferredDate'',NULL);
 END IF;
 IF s.historical_revision_id IS NOT NULL THEN
  SELECT * INTO revision FROM sales_revision_private.events WHERE id=s.historical_revision_id AND operation=''cancel'';
  IF revision.id IS NULL OR revision.sale_id IS DISTINCT FROM s.id OR revision.interest_id IS DISTINCT FROM s.project_interest_id
   OR revision.plot_id IS DISTINCT FROM s.plot_id OR s.crm_stage IS DISTINCT FROM ''cancelled'' OR s.cancelled_at IS NOT NULL
   OR evidence IS NULL OR evidence->>''bookedDate'' IS DISTINCT FROM to_char(revision.booked_day,''YYYY-MM-DD'')
  THEN RAISE EXCEPTION ''HISTORICAL_REVISION_PROVENANCE''; END IF;
  evidence:=evidence||jsonb_build_object(''batchId'',revision.batch_id,''sourceRow'',revision.source_row,''sourceStage'',''cancelled'',''cancelledDate'',revision.cancelled_day);
 END IF;
 RETURN evidence;
END; ' OR md5(body) IS DISTINCT FROM 'd90be929a7741640f95a645fc5d93ac8'
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='sales_revision_private.history(jsonb,jsonb)'::regprocedure AND pg_get_userbyid(proowner)=current_user
   AND prosecdef=false AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[])
  OR (length(definition)-length(replace(definition,body,'')))/length(body)<>1
 THEN RAISE EXCEPTION 'CUSTOMER_RECOVERY_EXACT_ADAPTER_REVIEW_REQUIRED'; END IF;
 EXECUTE replace(definition,body,'
DECLARE s public.sales%ROWTYPE; e sales_recovery_private.active_revision_events%ROWTYPE; revision sales_recovery_private.active_revision_events%ROWTYPE; evidence jsonb:=p_original;
BEGIN
 SELECT * INTO s FROM public.sales WHERE id=(p_sale->>''id'')::uuid;
 IF s.id IS NULL OR NOT p_sale @> to_jsonb(s) THEN RAISE EXCEPTION ''HISTORICAL_REVISION_PROVENANCE''; END IF;
 IF s.historical_import_id IS NOT NULL THEN
  SELECT * INTO e FROM sales_recovery_private.active_revision_events WHERE id=s.historical_import_id AND operation=''create_booking'';
  IF e.id IS NULL OR e.sale_id IS DISTINCT FROM s.id OR e.interest_id IS DISTINCT FROM s.project_interest_id OR e.plot_id IS DISTINCT FROM s.plot_id
   OR NOT EXISTS(SELECT 1 FROM public.lead_project_interests i WHERE i.id=e.interest_id AND i.customer_id=e.customer_id)
   OR EXISTS(SELECT 1 FROM unnest(ARRAY[''id'',''lead_id'',''project_interest_id'',''plot_id'',''booking_round'',''previous_sale_id'',''booking_route'',''booking_route_reason'',''booked_at'',''list_price'',''discount_amount'',''external_booking_id'',''external_source_stage'',''historical_import_id'',''sale_price'',''closing_sales_user_id'']) k WHERE e.after_sale->k IS DISTINCT FROM p_sale->k)
  THEN RAISE EXCEPTION ''HISTORICAL_REVISION_PROVENANCE''; END IF;
  evidence:=jsonb_build_object(''source'',''customer_sheet'',''batchId'',e.batch_id,''sourceRow'',e.source_row,''sourceStage'',''booked'',''bookedDate'',e.booked_day,''cancelledDate'',NULL,''transferredDate'',NULL);
 END IF;
 IF s.historical_revision_id IS NOT NULL THEN
  SELECT * INTO revision FROM sales_recovery_private.active_revision_events WHERE id=s.historical_revision_id AND operation=''cancel'';
  IF revision.id IS NULL OR revision.sale_id IS DISTINCT FROM s.id OR revision.interest_id IS DISTINCT FROM s.project_interest_id
   OR revision.plot_id IS DISTINCT FROM s.plot_id OR s.crm_stage IS DISTINCT FROM ''cancelled'' OR s.cancelled_at IS NOT NULL
   OR evidence IS NULL OR evidence->>''bookedDate'' IS DISTINCT FROM to_char(revision.booked_day,''YYYY-MM-DD'')
  THEN RAISE EXCEPTION ''HISTORICAL_REVISION_PROVENANCE''; END IF;
  evidence:=evidence||jsonb_build_object(''batchId'',revision.batch_id,''sourceRow'',revision.source_row,''sourceStage'',''cancelled'',''cancelledDate'',revision.cancelled_day);
 END IF;
 RETURN evidence;
END; ');
 INSERT INTO sales_recovery_private.adapters VALUES('sales_revision_private.history(jsonb,jsonb)','d90be929a7741640f95a645fc5d93ac8','36d31ea60d2390d44ba574dd5ca5bf34');
END;
$recovery_adapter_12$;
-- Replace only the reviewed immutable-ledger Sale FK targets. Keep all other FKs and every guard.
DO $recovery_sale_identity_fks$
DECLARE target record;fk record;column_number smallint;found_count integer;
BEGIN
 PERFORM sales_recovery_private.operator();
 INSERT INTO sales_recovery_private.sale_identities SELECT sale_id FROM sales_revision_private.events UNION SELECT sale_id FROM customer_source_membership_private.members WHERE sale_id IS NOT NULL ON CONFLICT DO NOTHING;
 FOR target IN SELECT * FROM (VALUES('sales_revision_private.events','historical_sale_identity_fk',true),('customer_source_membership_private.members','membership_sale_identity_fk',false)) x(relation_name,new_name,deferred) LOOP
  SELECT attnum INTO STRICT column_number FROM pg_attribute WHERE attrelid=target.relation_name::regclass AND attname='sale_id' AND NOT attisdropped;
  SELECT count(*) INTO found_count FROM pg_constraint WHERE conrelid=target.relation_name::regclass AND contype='f' AND conkey=ARRAY[column_number]
   AND confrelid='public.sales'::regclass AND confkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid='public.sales'::regclass AND attname='id')];
  IF found_count<>1 THEN RAISE EXCEPTION 'CUSTOMER_RECOVERY_SALE_FK_REVIEW_REQUIRED'; END IF;
  SELECT * INTO STRICT fk FROM pg_constraint WHERE conrelid=target.relation_name::regclass AND contype='f' AND conkey=ARRAY[column_number] AND confrelid='public.sales'::regclass;
  IF fk.confdeltype NOT IN('a','r') OR fk.confupdtype<>'a' OR fk.condeferrable IS DISTINCT FROM target.deferred OR fk.condeferred IS DISTINCT FROM target.deferred
   THEN RAISE EXCEPTION 'CUSTOMER_RECOVERY_SALE_FK_REVIEW_REQUIRED'; END IF;
  EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I',target.relation_name,fk.conname);
  EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY(sale_id) REFERENCES sales_recovery_private.sale_identities(id) ON DELETE RESTRICT',target.relation_name,target.new_name);
 END LOOP;
END;
$recovery_sale_identity_fks$;

SELECT sales_operator_private.finish_metadata();
-- Exact private DB-owner adapters; actual Auth is unchanged outside a registered owner job.
DO $operator_adapter_0$
DECLARE definition text;body text;
BEGIN
 PERFORM sales_operator_private.require_owner();
 SELECT replace(pg_get_functiondef(oid),E'\r\n',E'\n'),replace(prosrc,E'\r\n',E'\n') INTO definition,body FROM pg_proc WHERE oid='customer_source_membership_private.activate(jsonb,text,text)'::regprocedure;
 IF body IS DISTINCT FROM '
DECLARE v_record jsonb; revision uuid; batch uuid; known record; customer uuid; interest uuid; sale uuid;
BEGIN
 IF auth.uid() IS NULL OR public.crm_v2_role() IS DISTINCT FROM ''admin'' OR session_user<>current_user THEN RAISE EXCEPTION ''CUSTOMER_MEMBERSHIP_OPERATOR_REQUIRED''; END IF;
 IF p_payload->>''version'' IS DISTINCT FROM ''reviewed-full-canonical-cohort-v1''
  OR p_payload->>''sourceSha256'' IS DISTINCT FROM ''7193857ef04d6a092171749a25867b1ca8d1bbe8f7b83b04fa7473b3a3a69ffd''
  OR p_payload->>''reviewSha256'' IS DISTINCT FROM ''de4beaee70afa8de9e8866e328eabf8bdd25257eae7aa78eb89649712f381802''
  OR p_payload->>''adapterPlanDigest'' IS DISTINCT FROM ''379da2e538829a3cb0379108b98851757c142eb010b1624543413116eef8a506''
  OR p_payload->''originalSourceBatchIds'' IS DISTINCT FROM ''["5d3f05d2-2a5d-44ed-a0e3-9385b8ace3a5"]''::jsonb
  OR p_payload->''exclusions''->''rentalSourceRows'' IS DISTINCT FROM ''[859,951,954,958,959,960,961,969]''::jsonb
  OR p_payload->''exclusions''->''heldIdentitySourceRows'' IS DISTINCT FROM ''[967,968,970,971,972,973,974,975,976,977,978,979,980]''::jsonb
  OR jsonb_typeof(p_payload->''records'') IS DISTINCT FROM ''array'' OR jsonb_array_length(p_payload->''records'')<>958
  OR p_input_digest !~ ''^[0-9a-f]{64}$'' OR coalesce(length(btrim(p_review)),0)=0 THEN RAISE EXCEPTION ''CUSTOMER_MEMBERSHIP_REVIEW_REQUIRED''; END IF;
 LOCK TABLE public.sales_customers,public.lead_project_interests,public.sales,public.leads,public.crm_legacy_lead_links IN SHARE ROW EXCLUSIVE MODE;
 LOCK TABLE customer_source_membership_private.head IN EXCLUSIVE MODE;
 PERFORM customer_source_membership_private.assert_catalog();
 SELECT * INTO known FROM customer_source_membership_private.revisions WHERE dataset_key=p_payload->>''datasetKey'';
 IF FOUND THEN
  IF known.payload IS DISTINCT FROM p_payload OR known.input_digest IS DISTINCT FROM p_input_digest OR NOT EXISTS(SELECT 1 FROM customer_source_membership_private.head WHERE revision_id=known.id) THEN RAISE EXCEPTION ''CUSTOMER_MEMBERSHIP_REPLAY_CONFLICT''; END IF;
  RETURN jsonb_build_object(''revisionId'',known.id,''sourceRows'',958,''replayed'',true);
 END IF;
 IF EXISTS(SELECT 1 FROM customer_source_membership_private.head) THEN RAISE EXCEPTION ''CUSTOMER_MEMBERSHIP_ALREADY_ACTIVE''; END IF;
 -- Exact reviewed original Lead identity set only. These rows are an
 -- independent old-system archive; they do not represent the new workbook''s
 -- Customer identities and must not acquire invented links or lifecycle dates.
 -- Replays above deliberately do not require the old global count: legitimate
 -- future Lead intake remains possible after activation.
 IF (SELECT count(*) FROM public.leads)<>973
  OR (SELECT md5(string_agg(id::text,E''\n'' ORDER BY id)) FROM public.leads) IS DISTINCT FROM ''96bca8c3499c91241b9f4258175f4f2d''
 THEN RAISE EXCEPTION ''CUSTOMER_MEMBERSHIP_LEGACY_SCOPE_REVIEW_REQUIRED''; END IF;
 IF (SELECT count(DISTINCT r->>''sourceRow'') FROM jsonb_array_elements(p_payload->''records'') r)<>958
  OR (SELECT count(DISTINCT r->>''sourceKey'') FROM jsonb_array_elements(p_payload->''records'') r)<>958
  OR (SELECT count(DISTINCT r->>''customerId'') FROM jsonb_array_elements(p_payload->''records'') r)<>957
  OR (SELECT count(DISTINCT r->>''interestId'') FROM jsonb_array_elements(p_payload->''records'') r)<>948
  OR (SELECT count(DISTINCT r->>''saleId'') FROM jsonb_array_elements(p_payload->''records'') r)<>298 THEN RAISE EXCEPTION ''CUSTOMER_MEMBERSHIP_COUNTS_REQUIRED''; END IF;
 batch:=(p_payload->''originalSourceBatchIds''->>0)::uuid;
 INSERT INTO customer_source_membership_private.scope_batches VALUES(batch);
 INSERT INTO customer_source_membership_private.scope_customers SELECT id FROM public.sales_customers WHERE external_snapshot_batch_id=batch;
 INSERT INTO customer_source_membership_private.scope_interests SELECT id FROM public.lead_project_interests WHERE external_snapshot_batch_id=batch;
 INSERT INTO customer_source_membership_private.scope_sales SELECT s.id FROM public.sales s JOIN crm_external_private.prepared_booking_sales p ON p.id=s.external_booking_id WHERE p.batch_id=batch;
 -- Deleted rental Sale IDs remain scoped so a later blind re-insert cannot
 -- resurrect them. No FK is placed on these deliberately absent rows.
 INSERT INTO customer_source_membership_private.scope_sales SELECT sale_id FROM rental_source_retirement_private.archives WHERE old_batch_id=batch ON CONFLICT DO NOTHING;
 INSERT INTO customer_source_membership_private.revisions(dataset_key,payload,input_digest,actor_id,review_reference) VALUES(p_payload->>''datasetKey'',p_payload,p_input_digest,auth.uid(),p_review) RETURNING id INTO revision;
 FOR v_record IN SELECT value FROM jsonb_array_elements(p_payload->''records'') LOOP
  customer:=(v_record->>''customerId'')::uuid;interest:=(v_record->>''interestId'')::uuid;sale:=(v_record->>''saleId'')::uuid;
  IF customer IS NULL OR (v_record->>''sourceRow'')::integer NOT BETWEEN 2 AND 980
   OR (v_record->>''sourceRow'')::integer IN(859,951,954,958,959,960,961,969,967,968,970,971,972,973,974,975,976,977,978,979,980)
   OR v_record->>''sourceKey'' !~ ''^[0-9a-f]{64}$'' OR v_record->>''rowSha256'' !~ ''^[0-9a-f]{64}$''
   OR NOT EXISTS(SELECT 1 FROM public.sales_customers c WHERE c.id=customer AND c.merged_into_customer_id IS NULL)
   -- Existing parent relationships alone cannot establish which source row
   -- belongs to which customer. Prevent a permutation of valid UUIDs from
   -- moving reviewed dates to a different customer while preserving counts.
   OR NOT EXISTS(SELECT 1 FROM public.sales_customers c WHERE c.id=customer AND (
    (c.supplemental_creation_id IS NULL AND c.external_snapshot_batch_id=batch AND EXISTS(
     SELECT 1 FROM crm_external_private.source_records original WHERE original.batch_id=batch
      AND original.source_row=(v_record->>''sourceRow'')::integer AND original.customer_key=c.external_customer_key))
    OR EXISTS(SELECT 1 FROM sales_source_creation_private.records created WHERE created.id=c.supplemental_creation_id
     AND created.customer_id=c.id AND created.source_row=(v_record->>''sourceRow'')::integer
     AND created.source_key=v_record->>''sourceKey'' AND created.row_sha256=v_record->>''rowSha256'')))
   OR (interest IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.lead_project_interests i WHERE i.id=interest AND i.customer_id=customer AND i.project_name IS NOT DISTINCT FROM v_record->>''projectName''))
   OR (interest IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.lead_project_interests i WHERE i.id=interest AND (
    (i.supplemental_creation_id IS NULL AND i.external_snapshot_batch_id=batch AND EXISTS(
     SELECT 1 FROM crm_external_private.interest_candidates original WHERE original.batch_id=batch
      AND original.entity_key=i.external_interest_key AND original.payload->''sourceRows'' @> jsonb_build_array((v_record->>''sourceRow'')::integer)))
    OR EXISTS(SELECT 1 FROM sales_source_creation_private.records created WHERE created.id=i.supplemental_creation_id
     AND created.interest_id=i.id AND created.customer_id=customer AND created.source_row=(v_record->>''sourceRow'')::integer
     AND created.source_key=v_record->>''sourceKey'' AND created.row_sha256=v_record->>''rowSha256''))))
   OR (interest IS NULL AND v_record->>''projectName'' IS NOT NULL)
   OR (sale IS NOT NULL AND (interest IS NULL OR NOT EXISTS(SELECT 1 FROM public.sales s WHERE s.id=sale AND s.project_interest_id=interest AND s.plot_id IS NOT DISTINCT FROM v_record->>''plotId'' AND s.crm_stage IS NOT DISTINCT FROM v_record->>''sourceStage'')))
   OR (sale IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.sales s WHERE s.id=sale AND (
    EXISTS(SELECT 1 FROM crm_external_private.prepared_booking_sales original WHERE original.id=s.external_booking_id
     AND original.batch_id=batch AND (original.payload->>''source_row'')::integer=(v_record->>''sourceRow'')::integer)
    OR EXISTS(SELECT 1 FROM sales_revision_private.events created WHERE created.id=s.historical_import_id
     AND created.sale_id=s.id AND created.customer_id=customer AND created.interest_id=interest
     AND created.source_row=(v_record->>''sourceRow'')::integer AND created.source_key=v_record->>''sourceKey'' AND created.row_sha256=v_record->>''rowSha256''))))
   OR jsonb_typeof(v_record->''history'') IS DISTINCT FROM ''array''
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(v_record->''history'') e WHERE e->>''kind'' NOT IN(''visited'',''booked'',''contracted'',''loan_submitted'',''transferred'',''handover'',''cancelled'') OR e->>''kind'' IS NULL
    OR ((e->>''precision''=''unknown'' AND e->''date''=''null'') OR (e->>''precision''=''day'' AND e->>''date'' ~ ''^[0-9]{4}-[0-9]{2}-[0-9]{2}$'' AND pg_input_is_valid(e->>''date'',''date''))) IS DISTINCT FROM true)
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(v_record->''history'') e GROUP BY e->>''kind'' HAVING count(*)>1)
   THEN RAISE EXCEPTION ''CUSTOMER_MEMBERSHIP_BINDING_REQUIRED''; END IF;
  INSERT INTO customer_source_membership_private.members VALUES(revision,(v_record->>''sourceRow'')::integer,v_record->>''sourceKey'',v_record->>''rowSha256'',customer,interest,sale,v_record->>''projectName'',v_record->>''sourceStage'',v_record->''history'',batch::text||'':''||(v_record->>''sourceRow''));
 END LOOP;
 -- Freeze which original Leads were independently archived at activation.
 -- An original Lead already linked to active canonical parents must retain its
 -- mapping integrity requirement even if that link is subsequently removed.
 INSERT INTO customer_source_membership_private.scope_leads(id,exempt_mapping)
 SELECT legacy.id,NOT EXISTS(SELECT 1 FROM public.crm_legacy_lead_links link
  WHERE link.legacy_lead_id=legacy.id
   AND (NOT EXISTS(SELECT 1 FROM customer_source_membership_private.scope_customers old_customer WHERE old_customer.id=link.customer_id)
    OR EXISTS(SELECT 1 FROM customer_source_membership_private.members m WHERE m.revision_id=revision AND m.customer_id=link.customer_id))
   AND (link.project_interest_id IS NULL
    OR NOT EXISTS(SELECT 1 FROM customer_source_membership_private.scope_interests old_interest WHERE old_interest.id=link.project_interest_id)
    OR EXISTS(SELECT 1 FROM customer_source_membership_private.members m WHERE m.revision_id=revision AND m.interest_id=link.project_interest_id)))
 FROM public.leads legacy;
 INSERT INTO customer_source_membership_private.head VALUES(true,revision);
 RETURN jsonb_build_object(''revisionId'',revision,''sourceRows'',958,''customers'',957,''interests'',948,''sales'',298,''replayed'',false);
END; ' OR md5(body) IS DISTINCT FROM '051aa1a0b823287279d7cc81dc4fcd06'
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='customer_source_membership_private.activate(jsonb,text,text)'::regprocedure AND pg_get_userbyid(proowner)=current_user AND prosecdef=false AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[])
  OR (length(definition)-length(replace(definition,body,'')))/length(body)<>1
 THEN RAISE EXCEPTION 'CUSTOMER_OPERATOR_EXACT_ADAPTER_REVIEW_REQUIRED'; END IF;
 EXECUTE replace(definition,body,'
DECLARE v_record jsonb; revision uuid; batch uuid; known record; customer uuid; interest uuid; sale uuid;
BEGIN
 PERFORM sales_operator_private.authorize_payload(''membership'',p_payload);
 IF sales_operator_private.actor() IS NULL OR sales_operator_private.operator_role() IS DISTINCT FROM ''admin'' OR session_user<>current_user THEN RAISE EXCEPTION ''CUSTOMER_MEMBERSHIP_OPERATOR_REQUIRED''; END IF;
 IF p_payload->>''version'' IS DISTINCT FROM ''reviewed-full-canonical-cohort-v1''
  OR p_payload->>''sourceSha256'' IS DISTINCT FROM ''7193857ef04d6a092171749a25867b1ca8d1bbe8f7b83b04fa7473b3a3a69ffd''
  OR p_payload->>''reviewSha256'' IS DISTINCT FROM ''de4beaee70afa8de9e8866e328eabf8bdd25257eae7aa78eb89649712f381802''
  OR p_payload->>''adapterPlanDigest'' IS DISTINCT FROM ''379da2e538829a3cb0379108b98851757c142eb010b1624543413116eef8a506''
  OR p_payload->''originalSourceBatchIds'' IS DISTINCT FROM ''["5d3f05d2-2a5d-44ed-a0e3-9385b8ace3a5"]''::jsonb
  OR p_payload->''exclusions''->''rentalSourceRows'' IS DISTINCT FROM ''[859,951,954,958,959,960,961,969]''::jsonb
  OR p_payload->''exclusions''->''heldIdentitySourceRows'' IS DISTINCT FROM ''[967,968,970,971,972,973,974,975,976,977,978,979,980]''::jsonb
  OR jsonb_typeof(p_payload->''records'') IS DISTINCT FROM ''array'' OR jsonb_array_length(p_payload->''records'')<>958
  OR p_input_digest !~ ''^[0-9a-f]{64}$'' OR coalesce(length(btrim(p_review)),0)=0 THEN RAISE EXCEPTION ''CUSTOMER_MEMBERSHIP_REVIEW_REQUIRED''; END IF;
 LOCK TABLE public.sales_customers,public.lead_project_interests,public.sales,public.leads,public.crm_legacy_lead_links IN SHARE ROW EXCLUSIVE MODE;
 LOCK TABLE customer_source_membership_private.head IN EXCLUSIVE MODE;
 PERFORM customer_source_membership_private.assert_catalog();
 SELECT * INTO known FROM customer_source_membership_private.revisions WHERE dataset_key=p_payload->>''datasetKey'';
 IF FOUND THEN
  IF known.payload IS DISTINCT FROM p_payload OR known.input_digest IS DISTINCT FROM p_input_digest OR NOT EXISTS(SELECT 1 FROM customer_source_membership_private.head WHERE revision_id=known.id) THEN RAISE EXCEPTION ''CUSTOMER_MEMBERSHIP_REPLAY_CONFLICT''; END IF;
  RETURN jsonb_build_object(''revisionId'',known.id,''sourceRows'',958,''replayed'',true);
 END IF;
 IF EXISTS(SELECT 1 FROM customer_source_membership_private.head) THEN RAISE EXCEPTION ''CUSTOMER_MEMBERSHIP_ALREADY_ACTIVE''; END IF;
 -- Exact reviewed original Lead identity set only. These rows are an
 -- independent old-system archive; they do not represent the new workbook''s
 -- Customer identities and must not acquire invented links or lifecycle dates.
 -- Replays above deliberately do not require the old global count: legitimate
 -- future Lead intake remains possible after activation.
 IF (SELECT count(*) FROM public.leads)<>973
  OR (SELECT md5(string_agg(id::text,E''\n'' ORDER BY id)) FROM public.leads) IS DISTINCT FROM ''96bca8c3499c91241b9f4258175f4f2d''
 THEN RAISE EXCEPTION ''CUSTOMER_MEMBERSHIP_LEGACY_SCOPE_REVIEW_REQUIRED''; END IF;
 IF (SELECT count(DISTINCT r->>''sourceRow'') FROM jsonb_array_elements(p_payload->''records'') r)<>958
  OR (SELECT count(DISTINCT r->>''sourceKey'') FROM jsonb_array_elements(p_payload->''records'') r)<>958
  OR (SELECT count(DISTINCT r->>''customerId'') FROM jsonb_array_elements(p_payload->''records'') r)<>957
  OR (SELECT count(DISTINCT r->>''interestId'') FROM jsonb_array_elements(p_payload->''records'') r)<>948
  OR (SELECT count(DISTINCT r->>''saleId'') FROM jsonb_array_elements(p_payload->''records'') r)<>298 THEN RAISE EXCEPTION ''CUSTOMER_MEMBERSHIP_COUNTS_REQUIRED''; END IF;
 batch:=(p_payload->''originalSourceBatchIds''->>0)::uuid;
 INSERT INTO customer_source_membership_private.scope_batches VALUES(batch);
 INSERT INTO customer_source_membership_private.scope_customers SELECT id FROM public.sales_customers WHERE external_snapshot_batch_id=batch;
 INSERT INTO customer_source_membership_private.scope_interests SELECT id FROM public.lead_project_interests WHERE external_snapshot_batch_id=batch;
 INSERT INTO customer_source_membership_private.scope_sales SELECT s.id FROM public.sales s JOIN crm_external_private.prepared_booking_sales p ON p.id=s.external_booking_id WHERE p.batch_id=batch;
 -- Deleted rental Sale IDs remain scoped so a later blind re-insert cannot
 -- resurrect them. No FK is placed on these deliberately absent rows.
 INSERT INTO customer_source_membership_private.scope_sales SELECT sale_id FROM rental_source_retirement_private.archives WHERE old_batch_id=batch ON CONFLICT DO NOTHING;
 INSERT INTO customer_source_membership_private.revisions(dataset_key,payload,input_digest,actor_id,review_reference) VALUES(p_payload->>''datasetKey'',p_payload,p_input_digest,sales_operator_private.actor(),p_review) RETURNING id INTO revision;
 FOR v_record IN SELECT value FROM jsonb_array_elements(p_payload->''records'') LOOP
  customer:=(v_record->>''customerId'')::uuid;interest:=(v_record->>''interestId'')::uuid;sale:=(v_record->>''saleId'')::uuid;
  IF customer IS NULL OR (v_record->>''sourceRow'')::integer NOT BETWEEN 2 AND 980
   OR (v_record->>''sourceRow'')::integer IN(859,951,954,958,959,960,961,969,967,968,970,971,972,973,974,975,976,977,978,979,980)
   OR v_record->>''sourceKey'' !~ ''^[0-9a-f]{64}$'' OR v_record->>''rowSha256'' !~ ''^[0-9a-f]{64}$''
   OR NOT EXISTS(SELECT 1 FROM public.sales_customers c WHERE c.id=customer AND c.merged_into_customer_id IS NULL)
   -- Existing parent relationships alone cannot establish which source row
   -- belongs to which customer. Prevent a permutation of valid UUIDs from
   -- moving reviewed dates to a different customer while preserving counts.
   OR NOT EXISTS(SELECT 1 FROM public.sales_customers c WHERE c.id=customer AND (
    (c.supplemental_creation_id IS NULL AND c.external_snapshot_batch_id=batch AND EXISTS(
     SELECT 1 FROM crm_external_private.source_records original WHERE original.batch_id=batch
      AND original.source_row=(v_record->>''sourceRow'')::integer AND original.customer_key=c.external_customer_key))
    OR EXISTS(SELECT 1 FROM sales_source_creation_private.records created WHERE created.id=c.supplemental_creation_id
     AND created.customer_id=c.id AND created.source_row=(v_record->>''sourceRow'')::integer
     AND created.source_key=v_record->>''sourceKey'' AND created.row_sha256=v_record->>''rowSha256'')))
   OR (interest IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.lead_project_interests i WHERE i.id=interest AND i.customer_id=customer AND i.project_name IS NOT DISTINCT FROM v_record->>''projectName''))
   OR (interest IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.lead_project_interests i WHERE i.id=interest AND (
    (i.supplemental_creation_id IS NULL AND i.external_snapshot_batch_id=batch AND EXISTS(
     SELECT 1 FROM crm_external_private.interest_candidates original WHERE original.batch_id=batch
      AND original.entity_key=i.external_interest_key AND original.payload->''sourceRows'' @> jsonb_build_array((v_record->>''sourceRow'')::integer)))
    OR EXISTS(SELECT 1 FROM sales_source_creation_private.records created WHERE created.id=i.supplemental_creation_id
     AND created.interest_id=i.id AND created.customer_id=customer AND created.source_row=(v_record->>''sourceRow'')::integer
     AND created.source_key=v_record->>''sourceKey'' AND created.row_sha256=v_record->>''rowSha256''))))
   OR (interest IS NULL AND v_record->>''projectName'' IS NOT NULL)
   OR (sale IS NOT NULL AND (interest IS NULL OR NOT EXISTS(SELECT 1 FROM public.sales s WHERE s.id=sale AND s.project_interest_id=interest AND s.plot_id IS NOT DISTINCT FROM v_record->>''plotId'' AND s.crm_stage IS NOT DISTINCT FROM v_record->>''sourceStage'')))
   OR (sale IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.sales s WHERE s.id=sale AND (
    EXISTS(SELECT 1 FROM crm_external_private.prepared_booking_sales original WHERE original.id=s.external_booking_id
     AND original.batch_id=batch AND (original.payload->>''source_row'')::integer=(v_record->>''sourceRow'')::integer)
    OR EXISTS(SELECT 1 FROM sales_revision_private.events created WHERE created.id=s.historical_import_id
     AND created.sale_id=s.id AND created.customer_id=customer AND created.interest_id=interest
     AND created.source_row=(v_record->>''sourceRow'')::integer AND created.source_key=v_record->>''sourceKey'' AND created.row_sha256=v_record->>''rowSha256''))))
   OR jsonb_typeof(v_record->''history'') IS DISTINCT FROM ''array''
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(v_record->''history'') e WHERE e->>''kind'' NOT IN(''visited'',''booked'',''contracted'',''loan_submitted'',''transferred'',''handover'',''cancelled'') OR e->>''kind'' IS NULL
    OR ((e->>''precision''=''unknown'' AND e->''date''=''null'') OR (e->>''precision''=''day'' AND e->>''date'' ~ ''^[0-9]{4}-[0-9]{2}-[0-9]{2}$'' AND pg_input_is_valid(e->>''date'',''date''))) IS DISTINCT FROM true)
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(v_record->''history'') e GROUP BY e->>''kind'' HAVING count(*)>1)
   THEN RAISE EXCEPTION ''CUSTOMER_MEMBERSHIP_BINDING_REQUIRED''; END IF;
  INSERT INTO customer_source_membership_private.members VALUES(revision,(v_record->>''sourceRow'')::integer,v_record->>''sourceKey'',v_record->>''rowSha256'',customer,interest,sale,v_record->>''projectName'',v_record->>''sourceStage'',v_record->''history'',batch::text||'':''||(v_record->>''sourceRow''));
 END LOOP;
 -- Freeze which original Leads were independently archived at activation.
 -- An original Lead already linked to active canonical parents must retain its
 -- mapping integrity requirement even if that link is subsequently removed.
 INSERT INTO customer_source_membership_private.scope_leads(id,exempt_mapping)
 SELECT legacy.id,NOT EXISTS(SELECT 1 FROM public.crm_legacy_lead_links link
  WHERE link.legacy_lead_id=legacy.id
   AND (NOT EXISTS(SELECT 1 FROM customer_source_membership_private.scope_customers old_customer WHERE old_customer.id=link.customer_id)
    OR EXISTS(SELECT 1 FROM customer_source_membership_private.members m WHERE m.revision_id=revision AND m.customer_id=link.customer_id))
   AND (link.project_interest_id IS NULL
    OR NOT EXISTS(SELECT 1 FROM customer_source_membership_private.scope_interests old_interest WHERE old_interest.id=link.project_interest_id)
    OR EXISTS(SELECT 1 FROM customer_source_membership_private.members m WHERE m.revision_id=revision AND m.interest_id=link.project_interest_id)))
 FROM public.leads legacy;
 INSERT INTO customer_source_membership_private.head VALUES(true,revision);
 RETURN jsonb_build_object(''revisionId'',revision,''sourceRows'',958,''customers'',957,''interests'',948,''sales'',298,''replayed'',false);
END; ');
 INSERT INTO sales_operator_private.adapters VALUES('customer_source_membership_private.activate(jsonb,text,text)','051aa1a0b823287279d7cc81dc4fcd06','22de00d75cc34807293be62ba8f7f144',ARRAY['search_path=pg_catalog']::text[],false);
END;
$operator_adapter_0$;
DO $operator_adapter_1$
DECLARE definition text;body text;
BEGIN
 PERFORM sales_operator_private.require_owner();
 SELECT replace(pg_get_functiondef(oid),E'\r\n',E'\n'),replace(prosrc,E'\r\n',E'\n') INTO definition,body FROM pg_proc WHERE oid='customer_source_membership_private.assert_payload(jsonb)'::regprocedure;
 IF body IS DISTINCT FROM '
DECLARE k text; value text;
BEGIN
 -- Preserve the original authorization errors and input validators. This adds
 -- only source retirement checks for already authorized canonical commands.
 IF auth.uid() IS NULL OR coalesce(public.crm_v2_role(),'''') NOT IN(''sales'',''admin'',''owner'') OR jsonb_typeof(p_payload) IS DISTINCT FROM ''object'' THEN RETURN; END IF;
 FOREACH k IN ARRAY ARRAY[''customerId'',''interestId'',''projectInterestId'',''saleId'',''previousSaleId''] LOOP
  value:=p_payload->>k;
  IF value IS NULL OR value !~* ''^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'' THEN CONTINUE; END IF;
  IF (k=''customerId'' AND NOT customer_source_membership_private.customer_member(value::uuid))
   OR (k IN(''interestId'',''projectInterestId'') AND NOT customer_source_membership_private.interest_member(value::uuid))
   OR (k IN(''saleId'',''previousSaleId'') AND NOT customer_source_membership_private.sale_member(value::uuid))
   THEN RAISE EXCEPTION ''CRM_SOURCE_RETIRED''; END IF;
 END LOOP;
END; ' OR md5(body) IS DISTINCT FROM '118ef083ff89e0bfe47dd3ed96fa4820'
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='customer_source_membership_private.assert_payload(jsonb)'::regprocedure AND pg_get_userbyid(proowner)=current_user AND prosecdef=false AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[])
  OR (length(definition)-length(replace(definition,body,'')))/length(body)<>1
 THEN RAISE EXCEPTION 'CUSTOMER_OPERATOR_EXACT_ADAPTER_REVIEW_REQUIRED'; END IF;
 EXECUTE replace(definition,body,'
DECLARE k text; value text;
BEGIN
 -- Preserve the original authorization errors and input validators. This adds
 -- only source retirement checks for already authorized canonical commands.
 IF sales_operator_private.actor() IS NULL OR coalesce(sales_operator_private.operator_role(),'''') NOT IN(''sales'',''admin'',''owner'') OR jsonb_typeof(p_payload) IS DISTINCT FROM ''object'' THEN RETURN; END IF;
 FOREACH k IN ARRAY ARRAY[''customerId'',''interestId'',''projectInterestId'',''saleId'',''previousSaleId''] LOOP
  value:=p_payload->>k;
  IF value IS NULL OR value !~* ''^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'' THEN CONTINUE; END IF;
  IF (k=''customerId'' AND NOT customer_source_membership_private.customer_member(value::uuid))
   OR (k IN(''interestId'',''projectInterestId'') AND NOT customer_source_membership_private.interest_member(value::uuid))
   OR (k IN(''saleId'',''previousSaleId'') AND NOT customer_source_membership_private.sale_member(value::uuid))
   THEN RAISE EXCEPTION ''CRM_SOURCE_RETIRED''; END IF;
 END LOOP;
END; ');
 INSERT INTO sales_operator_private.adapters VALUES('customer_source_membership_private.assert_payload(jsonb)','118ef083ff89e0bfe47dd3ed96fa4820','4195d537837db907d2cafa246d27c3c8',ARRAY['search_path=pg_catalog']::text[],false);
END;
$operator_adapter_1$;
DO $operator_adapter_2$
DECLARE definition text;body text;
BEGIN
 PERFORM sales_operator_private.require_owner();
 SELECT replace(pg_get_functiondef(oid),E'\r\n',E'\n'),replace(prosrc,E'\r\n',E'\n') INTO definition,body FROM pg_proc WHERE oid='customer_source_membership_private.deactivate(uuid,text)'::regprocedure;
 IF body IS DISTINCT FROM '
BEGIN
 IF auth.uid() IS NULL OR public.crm_v2_role() IS DISTINCT FROM ''admin'' OR session_user<>current_user OR coalesce(length(btrim(p_review)),0)=0 THEN RAISE EXCEPTION ''CUSTOMER_MEMBERSHIP_OPERATOR_REQUIRED''; END IF;
 LOCK TABLE public.sales_customers,public.lead_project_interests,public.sales IN SHARE ROW EXCLUSIVE MODE;
 LOCK TABLE customer_source_membership_private.head IN EXCLUSIVE MODE;
 IF NOT EXISTS(SELECT 1 FROM customer_source_membership_private.head WHERE revision_id=p_revision) THEN RAISE EXCEPTION ''CUSTOMER_MEMBERSHIP_RECOVERY_STALE''; END IF;
 INSERT INTO customer_source_membership_private.recoveries(revision_id,actor_id,review_reference) VALUES(p_revision,auth.uid(),p_review);
 DELETE FROM customer_source_membership_private.head WHERE revision_id=p_revision;
END; ' OR md5(body) IS DISTINCT FROM '5be5ab8f4195e8fcbe7379ffa163b8d7'
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='customer_source_membership_private.deactivate(uuid,text)'::regprocedure AND pg_get_userbyid(proowner)=current_user AND prosecdef=false AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[])
  OR (length(definition)-length(replace(definition,body,'')))/length(body)<>1
 THEN RAISE EXCEPTION 'CUSTOMER_OPERATOR_EXACT_ADAPTER_REVIEW_REQUIRED'; END IF;
 EXECUTE replace(definition,body,'
BEGIN
 IF sales_operator_private.actor() IS NULL OR sales_operator_private.operator_role() IS DISTINCT FROM ''admin'' OR session_user<>current_user OR coalesce(length(btrim(p_review)),0)=0 THEN RAISE EXCEPTION ''CUSTOMER_MEMBERSHIP_OPERATOR_REQUIRED''; END IF;
 LOCK TABLE public.sales_customers,public.lead_project_interests,public.sales IN SHARE ROW EXCLUSIVE MODE;
 LOCK TABLE customer_source_membership_private.head IN EXCLUSIVE MODE;
 IF NOT EXISTS(SELECT 1 FROM customer_source_membership_private.head WHERE revision_id=p_revision) THEN RAISE EXCEPTION ''CUSTOMER_MEMBERSHIP_RECOVERY_STALE''; END IF;
 INSERT INTO customer_source_membership_private.recoveries(revision_id,actor_id,review_reference) VALUES(p_revision,sales_operator_private.actor(),p_review);
 DELETE FROM customer_source_membership_private.head WHERE revision_id=p_revision;
END; ');
 INSERT INTO sales_operator_private.adapters VALUES('customer_source_membership_private.deactivate(uuid,text)','5be5ab8f4195e8fcbe7379ffa163b8d7','873d4781948563d9de6e59f6b496a0e2',ARRAY['search_path=pg_catalog']::text[],false);
END;
$operator_adapter_2$;
DO $operator_adapter_3$
DECLARE definition text;body text;
BEGIN
 PERFORM sales_operator_private.require_owner();
 SELECT replace(pg_get_functiondef(oid),E'\r\n',E'\n'),replace(prosrc,E'\r\n',E'\n') INTO definition,body FROM pg_proc WHERE oid='rental_source_retirement_private.apply(jsonb,text)'::regprocedure;
 IF body IS DISTINCT FROM '
DECLARE m jsonb;r jsonb;approved jsonb;b jsonb;plot_after jsonb;existing rental_source_retirement_private.batches%ROWTYPE;batch uuid;inv jsonb;archive_entry record;
BEGIN
 PERFORM rental_source_retirement_private.operator();
 LOCK TABLE public.sales IN SHARE ROW EXCLUSIVE MODE;
 SELECT manifest INTO m FROM rental_source_retirement_private.reviews WHERE dataset_key=p_payload->>''datasetKey'' FOR SHARE;
 IF m IS NULL OR p_payload->>''version'' IS DISTINCT FROM ''reviewed-rental-source-retirement-v1''
  OR NOT rental_source_retirement_private.keys(p_payload,ARRAY[''version'',''datasetKey'',''sourceSha256'',''reviewSha256'',''adapterPlanDigest'',''records''])
  OR p_payload->''sourceSha256'' IS DISTINCT FROM m->''sourceSha256'' OR p_payload->''reviewSha256'' IS DISTINCT FROM m->''reviewSha256''
  OR p_payload->''adapterPlanDigest'' IS DISTINCT FROM m->''adapterPlanDigest'' OR coalesce(length(btrim(p_review)),0)=0
  OR jsonb_array_length(p_payload->''records'') IS DISTINCT FROM 6
  OR (SELECT jsonb_agg((v->>''sourceRow'')::integer ORDER BY (v->>''sourceRow'')::integer) FROM jsonb_array_elements(p_payload->''records'') v) IS DISTINCT FROM m->''approvedSourceRows''
 THEN RAISE EXCEPTION ''RENTAL_RETIREMENT_INVALID_INPUT''; END IF;
 SELECT * INTO existing FROM rental_source_retirement_private.batches WHERE dataset_key=p_payload->>''datasetKey'';
 IF existing.id IS NOT NULL THEN
  IF existing.payload IS DISTINCT FROM p_payload OR existing.review_reference IS DISTINCT FROM p_review THEN RAISE EXCEPTION ''RENTAL_RETIREMENT_REPLAY_CONFLICT''; END IF;
  IF EXISTS(SELECT 1 FROM rental_source_retirement_private.restores WHERE batch_id=existing.id) THEN RAISE EXCEPTION ''RENTAL_RETIREMENT_ALREADY_RESTORED''; END IF;
  IF EXISTS(SELECT 1 FROM rental_source_retirement_private.archives a JOIN public.sales s ON s.id=a.sale_id WHERE a.batch_id=existing.id) THEN RAISE EXCEPTION ''RENTAL_RETIREMENT_REPLAY_STALE''; END IF;
  IF (SELECT count(*) FROM rental_source_retirement_private.archives WHERE batch_id=existing.id)<>6 THEN RAISE EXCEPTION ''RENTAL_RETIREMENT_REPLAY_STALE''; END IF;
  FOR archive_entry IN SELECT * FROM rental_source_retirement_private.archives WHERE batch_id=existing.id LOOP
   b:=archive_entry.before_image;
   IF (SELECT to_jsonb(c) FROM public.sales_customers c WHERE id=archive_entry.customer_id) IS DISTINCT FROM b->''customer''
    OR (SELECT to_jsonb(i) FROM public.lead_project_interests i WHERE id=archive_entry.interest_id) IS DISTINCT FROM b->''interest''
    OR (SELECT to_jsonb(p) FROM public.plots p WHERE id=archive_entry.plot_id) IS DISTINCT FROM archive_entry.after_plot
    OR (SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY id),''[]'') FROM public.sales s WHERE plot_id=archive_entry.plot_id) IS DISTINCT FROM (SELECT coalesce(jsonb_agg(s ORDER BY s->>''id''),''[]'') FROM jsonb_array_elements(b->''inventory'') s WHERE s->>''id''<>archive_entry.sale_id::text)
    OR rental_source_retirement_private.source(b->''sale'',b->''customer'',archive_entry.source_row) IS DISTINCT FROM b->''source''
    OR rental_source_retirement_private.dependencies(b->''sale'') IS DISTINCT FROM b->''dependencies''
   THEN RAISE EXCEPTION ''RENTAL_RETIREMENT_REPLAY_STALE''; END IF;
  END LOOP;
  RETURN jsonb_build_object(''batchId'',existing.id,''retired'',6,''replayed'',true);
 END IF;
 -- Validate every target before the first write. Locks last through the transaction.
 FOR r IN SELECT value FROM jsonb_array_elements(p_payload->''records'') ORDER BY (value->>''sourceRow'')::integer LOOP
  SELECT value INTO approved FROM jsonb_array_elements(m->''records'') WHERE value->''sourceRow''=r->''sourceRow'';
  IF NOT rental_source_retirement_private.keys(r,ARRAY[''sourceRow'',''sourceKey'',''rowSha256'',''operation'',''sourceRentalEvidence'',''binding'',''history'',''before''])
   OR r-ARRAY[''before''] IS DISTINCT FROM jsonb_build_object(''sourceRow'',approved->''sourceRow'',''sourceKey'',approved->''sourceKey'',''rowSha256'',approved->''rowSha256'',''operation'',approved->''operation'',''sourceRentalEvidence'',approved->''sourceRentalEvidence'',''binding'',approved->''binding'',''history'',approved->''history'')
  THEN RAISE EXCEPTION ''RENTAL_RETIREMENT_BINDING_CHANGED''; END IF;
  b:=rental_source_retirement_private.capture(r->''binding'',(r->>''sourceRow'')::integer);
  PERFORM sales_private.crm_booking_imported_history(b->''sale'');
  IF b IS DISTINCT FROM r->''before'' THEN RAISE EXCEPTION ''RENTAL_RETIREMENT_STALE''; END IF;
  IF b->''customer''->>''merged_into_customer_id'' IS NOT NULL OR b->''interest''->>''customer_id'' IS DISTINCT FROM b->''customer''->>''id''
   OR b->''interest''->>''project_name'' IS DISTINCT FROM b->''plot''->>''project_name'' OR b->''sale''->>''project_interest_id'' IS DISTINCT FROM b->''interest''->>''id''
   OR b->''sale''->>''plot_id'' IS DISTINCT FROM b->''plot''->>''id'' OR b->''sale''->>''external_booking_id'' IS DISTINCT FROM b->''sale''->>''id''
   OR b->''sale''->>''crm_stage'' IS DISTINCT FROM ''booked'' OR b->''sale''->>''contract_status'' IS DISTINCT FROM ''Reserved''
   OR b->''sale''->>''external_source_stage'' IS DISTINCT FROM ''booked'' OR b->''sale''->>''booking_route'' IS DISTINCT FROM ''legacy_import''
   OR b->''sale''->>''lead_id'' IS NOT NULL OR b->''sale''->>''historical_import_id'' IS NOT NULL OR b->''sale''->>''historical_revision_id'' IS NOT NULL
   OR EXISTS(SELECT 1 FROM unnest(ARRAY[''booked_at'',''contracted_at'',''cancelled_at'',''transferred_at'',''crm_handover_at'',''crm_transfer_date'',''crm_handover_date'']) k WHERE b->''sale''->>k IS NOT NULL)
   OR b->''customer''->>''external_snapshot_batch_id'' IS DISTINCT FROM approved->>''sourceBatchId''
   OR b->''customer''->>''external_customer_key'' IS DISTINCT FROM approved->>''customerSourceKey''
   OR b->''interest''->>''external_interest_key'' IS DISTINCT FROM approved->>''interestSourceKey''
   OR b->''customer''->''lifecycle_revision'' IS DISTINCT FROM approved->''referenceRevisions''->''customer''
   OR b->''interest''->''lifecycle_revision'' IS DISTINCT FROM approved->''referenceRevisions''->''interest''
   OR b->''sale''->''booking_revision'' IS DISTINCT FROM approved->''referenceRevisions''->''sale''
  THEN RAISE EXCEPTION ''RENTAL_RETIREMENT_TRANSACTION_ADVANCED''; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(b->''dependencies''->''constraints'') d WHERE d->''rows''<>''[]'')
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(b->''dependencies''->''unconstrained'') d WHERE d->''rows''<>''[]'')
  THEN RAISE EXCEPTION ''RENTAL_RETIREMENT_DEPENDENCIES''; END IF;
  -- Narrow policy: this is the only live deal; cancelled rounds are preserved.
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(b->''inventory'') s WHERE s->>''id''<>b->''sale''->>''id''
   AND (s->>''crm_stage'' IS DISTINCT FROM ''cancelled'' OR s->>''contract_status'' IS DISTINCT FROM ''Cancelled''))
   OR b->''plot''->''has_customer'' IS DISTINCT FROM ''true''::jsonb OR lower(coalesce(b->''plot''->>''sale_status'',''''))=''transferred''
  THEN RAISE EXCEPTION ''RENTAL_RETIREMENT_STOCK_REVIEW_REQUIRED''; END IF;
 END LOOP;
 INSERT INTO rental_source_retirement_private.batches(dataset_key,payload,review_reference,actor_id) VALUES(p_payload->>''datasetKey'',p_payload,p_review,auth.uid()) RETURNING id INTO batch;
 FOR r IN SELECT value FROM jsonb_array_elements(p_payload->''records'') ORDER BY (value->>''sourceRow'')::integer LOOP
  b:=r->''before'';plot_after:=b->''plot''||jsonb_build_object(''has_customer'',false);
  INSERT INTO rental_source_retirement_private.archives VALUES((r->''binding''->>''saleId'')::uuid,batch,(r->''binding''->>''customerId'')::uuid,(r->''binding''->>''interestId'')::uuid,r->''binding''->>''plotId'',(b->''customer''->>''external_snapshot_batch_id'')::uuid,(r->>''sourceRow'')::integer,b,plot_after);
  INSERT INTO rental_source_retirement_private.permits VALUES(txid_current(),pg_backend_pid(),auth.uid(),(r->''binding''->>''saleId'')::uuid,''retire'',b->''sale'',b->''plot'',plot_after);
  DELETE FROM public.sales WHERE id=(r->''binding''->>''saleId'')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION ''RENTAL_RETIREMENT_STALE''; END IF;
  -- Actual sync trigger must have produced the complete predicted plot image.
  IF (SELECT to_jsonb(p) FROM public.plots p WHERE id=r->''binding''->>''plotId'') IS DISTINCT FROM plot_after
   OR (SELECT to_jsonb(c) FROM public.sales_customers c WHERE id=(r->''binding''->>''customerId'')::uuid) IS DISTINCT FROM b->''customer''
   OR (SELECT to_jsonb(i) FROM public.lead_project_interests i WHERE id=(r->''binding''->>''interestId'')::uuid) IS DISTINCT FROM b->''interest''
  THEN RAISE EXCEPTION ''RENTAL_RETIREMENT_AFTER_IMAGE_REQUIRED''; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY id),''[]'') INTO inv FROM public.sales s WHERE plot_id=r->''binding''->>''plotId'';
  IF inv IS DISTINCT FROM (SELECT coalesce(jsonb_agg(s ORDER BY s->>''id''),''[]'') FROM jsonb_array_elements(b->''inventory'') s WHERE s->>''id''<>r->''binding''->>''saleId'') THEN RAISE EXCEPTION ''RENTAL_RETIREMENT_AFTER_IMAGE_REQUIRED''; END IF;
 END LOOP;
 DELETE FROM rental_source_retirement_private.permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid();
 RETURN jsonb_build_object(''batchId'',batch,''retired'',6,''replayed'',false);
END; ' OR md5(body) IS DISTINCT FROM '08655141c01fbc3a8a1c0043615b5d89'
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='rental_source_retirement_private.apply(jsonb,text)'::regprocedure AND pg_get_userbyid(proowner)=current_user AND prosecdef=false AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog','lock_timeout=2s','TimeZone=UTC','DateStyle=ISO, YMD']::text[])
  OR (length(definition)-length(replace(definition,body,'')))/length(body)<>1
 THEN RAISE EXCEPTION 'CUSTOMER_OPERATOR_EXACT_ADAPTER_REVIEW_REQUIRED'; END IF;
 EXECUTE replace(definition,body,'
DECLARE m jsonb;r jsonb;approved jsonb;b jsonb;plot_after jsonb;existing rental_source_retirement_private.batches%ROWTYPE;batch uuid;inv jsonb;archive_entry record;
BEGIN
 PERFORM sales_operator_private.authorize_payload(''rental'',p_payload);
 PERFORM rental_source_retirement_private.operator();
 LOCK TABLE public.sales IN SHARE ROW EXCLUSIVE MODE;
 SELECT manifest INTO m FROM rental_source_retirement_private.reviews WHERE dataset_key=p_payload->>''datasetKey'' FOR SHARE;
 IF m IS NULL OR p_payload->>''version'' IS DISTINCT FROM ''reviewed-rental-source-retirement-v1''
  OR NOT rental_source_retirement_private.keys(p_payload,ARRAY[''version'',''datasetKey'',''sourceSha256'',''reviewSha256'',''adapterPlanDigest'',''records''])
  OR p_payload->''sourceSha256'' IS DISTINCT FROM m->''sourceSha256'' OR p_payload->''reviewSha256'' IS DISTINCT FROM m->''reviewSha256''
  OR p_payload->''adapterPlanDigest'' IS DISTINCT FROM m->''adapterPlanDigest'' OR coalesce(length(btrim(p_review)),0)=0
  OR jsonb_array_length(p_payload->''records'') IS DISTINCT FROM 6
  OR (SELECT jsonb_agg((v->>''sourceRow'')::integer ORDER BY (v->>''sourceRow'')::integer) FROM jsonb_array_elements(p_payload->''records'') v) IS DISTINCT FROM m->''approvedSourceRows''
 THEN RAISE EXCEPTION ''RENTAL_RETIREMENT_INVALID_INPUT''; END IF;
 SELECT * INTO existing FROM rental_source_retirement_private.batches WHERE dataset_key=p_payload->>''datasetKey'';
 IF existing.id IS NOT NULL THEN
  IF existing.payload IS DISTINCT FROM p_payload OR existing.review_reference IS DISTINCT FROM p_review THEN RAISE EXCEPTION ''RENTAL_RETIREMENT_REPLAY_CONFLICT''; END IF;
  IF EXISTS(SELECT 1 FROM rental_source_retirement_private.restores WHERE batch_id=existing.id) THEN RAISE EXCEPTION ''RENTAL_RETIREMENT_ALREADY_RESTORED''; END IF;
  IF EXISTS(SELECT 1 FROM rental_source_retirement_private.archives a JOIN public.sales s ON s.id=a.sale_id WHERE a.batch_id=existing.id) THEN RAISE EXCEPTION ''RENTAL_RETIREMENT_REPLAY_STALE''; END IF;
  IF (SELECT count(*) FROM rental_source_retirement_private.archives WHERE batch_id=existing.id)<>6 THEN RAISE EXCEPTION ''RENTAL_RETIREMENT_REPLAY_STALE''; END IF;
  FOR archive_entry IN SELECT * FROM rental_source_retirement_private.archives WHERE batch_id=existing.id LOOP
   b:=archive_entry.before_image;
   IF (SELECT to_jsonb(c) FROM public.sales_customers c WHERE id=archive_entry.customer_id) IS DISTINCT FROM b->''customer''
    OR (SELECT to_jsonb(i) FROM public.lead_project_interests i WHERE id=archive_entry.interest_id) IS DISTINCT FROM b->''interest''
    OR (SELECT to_jsonb(p) FROM public.plots p WHERE id=archive_entry.plot_id) IS DISTINCT FROM archive_entry.after_plot
    OR (SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY id),''[]'') FROM public.sales s WHERE plot_id=archive_entry.plot_id) IS DISTINCT FROM (SELECT coalesce(jsonb_agg(s ORDER BY s->>''id''),''[]'') FROM jsonb_array_elements(b->''inventory'') s WHERE s->>''id''<>archive_entry.sale_id::text)
    OR rental_source_retirement_private.source(b->''sale'',b->''customer'',archive_entry.source_row) IS DISTINCT FROM b->''source''
    OR rental_source_retirement_private.dependencies(b->''sale'') IS DISTINCT FROM b->''dependencies''
   THEN RAISE EXCEPTION ''RENTAL_RETIREMENT_REPLAY_STALE''; END IF;
  END LOOP;
  RETURN jsonb_build_object(''batchId'',existing.id,''retired'',6,''replayed'',true);
 END IF;
 -- Validate every target before the first write. Locks last through the transaction.
 FOR r IN SELECT value FROM jsonb_array_elements(p_payload->''records'') ORDER BY (value->>''sourceRow'')::integer LOOP
  SELECT value INTO approved FROM jsonb_array_elements(m->''records'') WHERE value->''sourceRow''=r->''sourceRow'';
  IF NOT rental_source_retirement_private.keys(r,ARRAY[''sourceRow'',''sourceKey'',''rowSha256'',''operation'',''sourceRentalEvidence'',''binding'',''history'',''before''])
   OR r-ARRAY[''before''] IS DISTINCT FROM jsonb_build_object(''sourceRow'',approved->''sourceRow'',''sourceKey'',approved->''sourceKey'',''rowSha256'',approved->''rowSha256'',''operation'',approved->''operation'',''sourceRentalEvidence'',approved->''sourceRentalEvidence'',''binding'',approved->''binding'',''history'',approved->''history'')
  THEN RAISE EXCEPTION ''RENTAL_RETIREMENT_BINDING_CHANGED''; END IF;
  b:=rental_source_retirement_private.capture(r->''binding'',(r->>''sourceRow'')::integer);
  PERFORM sales_private.crm_booking_imported_history(b->''sale'');
  IF b IS DISTINCT FROM r->''before'' THEN RAISE EXCEPTION ''RENTAL_RETIREMENT_STALE''; END IF;
  IF b->''customer''->>''merged_into_customer_id'' IS NOT NULL OR b->''interest''->>''customer_id'' IS DISTINCT FROM b->''customer''->>''id''
   OR b->''interest''->>''project_name'' IS DISTINCT FROM b->''plot''->>''project_name'' OR b->''sale''->>''project_interest_id'' IS DISTINCT FROM b->''interest''->>''id''
   OR b->''sale''->>''plot_id'' IS DISTINCT FROM b->''plot''->>''id'' OR b->''sale''->>''external_booking_id'' IS DISTINCT FROM b->''sale''->>''id''
   OR b->''sale''->>''crm_stage'' IS DISTINCT FROM ''booked'' OR b->''sale''->>''contract_status'' IS DISTINCT FROM ''Reserved''
   OR b->''sale''->>''external_source_stage'' IS DISTINCT FROM ''booked'' OR b->''sale''->>''booking_route'' IS DISTINCT FROM ''legacy_import''
   OR b->''sale''->>''lead_id'' IS NOT NULL OR b->''sale''->>''historical_import_id'' IS NOT NULL OR b->''sale''->>''historical_revision_id'' IS NOT NULL
   OR EXISTS(SELECT 1 FROM unnest(ARRAY[''booked_at'',''contracted_at'',''cancelled_at'',''transferred_at'',''crm_handover_at'',''crm_transfer_date'',''crm_handover_date'']) k WHERE b->''sale''->>k IS NOT NULL)
   OR b->''customer''->>''external_snapshot_batch_id'' IS DISTINCT FROM approved->>''sourceBatchId''
   OR b->''customer''->>''external_customer_key'' IS DISTINCT FROM approved->>''customerSourceKey''
   OR b->''interest''->>''external_interest_key'' IS DISTINCT FROM approved->>''interestSourceKey''
   OR b->''customer''->''lifecycle_revision'' IS DISTINCT FROM approved->''referenceRevisions''->''customer''
   OR b->''interest''->''lifecycle_revision'' IS DISTINCT FROM approved->''referenceRevisions''->''interest''
   OR b->''sale''->''booking_revision'' IS DISTINCT FROM approved->''referenceRevisions''->''sale''
  THEN RAISE EXCEPTION ''RENTAL_RETIREMENT_TRANSACTION_ADVANCED''; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(b->''dependencies''->''constraints'') d WHERE d->''rows''<>''[]'')
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(b->''dependencies''->''unconstrained'') d WHERE d->''rows''<>''[]'')
  THEN RAISE EXCEPTION ''RENTAL_RETIREMENT_DEPENDENCIES''; END IF;
  -- Narrow policy: this is the only live deal; cancelled rounds are preserved.
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(b->''inventory'') s WHERE s->>''id''<>b->''sale''->>''id''
   AND (s->>''crm_stage'' IS DISTINCT FROM ''cancelled'' OR s->>''contract_status'' IS DISTINCT FROM ''Cancelled''))
   OR b->''plot''->''has_customer'' IS DISTINCT FROM ''true''::jsonb OR lower(coalesce(b->''plot''->>''sale_status'',''''))=''transferred''
  THEN RAISE EXCEPTION ''RENTAL_RETIREMENT_STOCK_REVIEW_REQUIRED''; END IF;
 END LOOP;
 INSERT INTO rental_source_retirement_private.batches(dataset_key,payload,review_reference,actor_id) VALUES(p_payload->>''datasetKey'',p_payload,p_review,sales_operator_private.actor()) RETURNING id INTO batch;
 FOR r IN SELECT value FROM jsonb_array_elements(p_payload->''records'') ORDER BY (value->>''sourceRow'')::integer LOOP
  b:=r->''before'';plot_after:=b->''plot''||jsonb_build_object(''has_customer'',false);
  INSERT INTO rental_source_retirement_private.archives VALUES((r->''binding''->>''saleId'')::uuid,batch,(r->''binding''->>''customerId'')::uuid,(r->''binding''->>''interestId'')::uuid,r->''binding''->>''plotId'',(b->''customer''->>''external_snapshot_batch_id'')::uuid,(r->>''sourceRow'')::integer,b,plot_after);
  INSERT INTO rental_source_retirement_private.permits VALUES(txid_current(),pg_backend_pid(),sales_operator_private.actor(),(r->''binding''->>''saleId'')::uuid,''retire'',b->''sale'',b->''plot'',plot_after);
  DELETE FROM public.sales WHERE id=(r->''binding''->>''saleId'')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION ''RENTAL_RETIREMENT_STALE''; END IF;
  -- Actual sync trigger must have produced the complete predicted plot image.
  IF (SELECT to_jsonb(p) FROM public.plots p WHERE id=r->''binding''->>''plotId'') IS DISTINCT FROM plot_after
   OR (SELECT to_jsonb(c) FROM public.sales_customers c WHERE id=(r->''binding''->>''customerId'')::uuid) IS DISTINCT FROM b->''customer''
   OR (SELECT to_jsonb(i) FROM public.lead_project_interests i WHERE id=(r->''binding''->>''interestId'')::uuid) IS DISTINCT FROM b->''interest''
  THEN RAISE EXCEPTION ''RENTAL_RETIREMENT_AFTER_IMAGE_REQUIRED''; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY id),''[]'') INTO inv FROM public.sales s WHERE plot_id=r->''binding''->>''plotId'';
  IF inv IS DISTINCT FROM (SELECT coalesce(jsonb_agg(s ORDER BY s->>''id''),''[]'') FROM jsonb_array_elements(b->''inventory'') s WHERE s->>''id''<>r->''binding''->>''saleId'') THEN RAISE EXCEPTION ''RENTAL_RETIREMENT_AFTER_IMAGE_REQUIRED''; END IF;
 END LOOP;
 DELETE FROM rental_source_retirement_private.permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid();
 RETURN jsonb_build_object(''batchId'',batch,''retired'',6,''replayed'',false);
END; ');
 INSERT INTO sales_operator_private.adapters VALUES('rental_source_retirement_private.apply(jsonb,text)','08655141c01fbc3a8a1c0043615b5d89','b6e55770c495d26832c63b239800e426',ARRAY['search_path=pg_catalog','lock_timeout=2s','TimeZone=UTC','DateStyle=ISO, YMD']::text[],false);
END;
$operator_adapter_3$;
DO $operator_adapter_4$
DECLARE definition text;body text;
BEGIN
 PERFORM sales_operator_private.require_owner();
 SELECT replace(pg_get_functiondef(oid),E'\r\n',E'\n'),replace(prosrc,E'\r\n',E'\n') INTO definition,body FROM pg_proc WHERE oid='rental_source_retirement_private.operator()'::regprocedure;
 IF body IS DISTINCT FROM '
BEGIN
 IF auth.uid() IS NULL OR current_user IS DISTINCT FROM pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid=''rental_source_retirement_private.reviews''::regclass))
 THEN RAISE EXCEPTION ''RENTAL_RETIREMENT_FORBIDDEN''; END IF;
 PERFORM 1 FROM sales_private.crm_user_roles WHERE user_id=auth.uid() AND role=''admin'' AND is_active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION ''RENTAL_RETIREMENT_FORBIDDEN''; END IF;
END; ' OR md5(body) IS DISTINCT FROM '5b3c9ab10c826d9fd4fb3d52212c37c8'
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='rental_source_retirement_private.operator()'::regprocedure AND pg_get_userbyid(proowner)=current_user AND prosecdef=false AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[])
  OR (length(definition)-length(replace(definition,body,'')))/length(body)<>1
 THEN RAISE EXCEPTION 'CUSTOMER_OPERATOR_EXACT_ADAPTER_REVIEW_REQUIRED'; END IF;
 EXECUTE replace(definition,body,'
BEGIN
 IF sales_operator_private.actor() IS NULL OR current_user IS DISTINCT FROM pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid=''rental_source_retirement_private.reviews''::regclass))
 THEN RAISE EXCEPTION ''RENTAL_RETIREMENT_FORBIDDEN''; END IF;
 PERFORM 1 FROM sales_private.crm_user_roles WHERE user_id=sales_operator_private.actor() AND role=''admin'' AND is_active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION ''RENTAL_RETIREMENT_FORBIDDEN''; END IF;
END; ');
 INSERT INTO sales_operator_private.adapters VALUES('rental_source_retirement_private.operator()','5b3c9ab10c826d9fd4fb3d52212c37c8','be7bb9a8a9c08cba3e35b05f96dfd505',ARRAY['search_path=pg_catalog']::text[],false);
END;
$operator_adapter_4$;
DO $operator_adapter_5$
DECLARE definition text;body text;
BEGIN
 PERFORM sales_operator_private.require_owner();
 SELECT replace(pg_get_functiondef(oid),E'\r\n',E'\n'),replace(prosrc,E'\r\n',E'\n') INTO definition,body FROM pg_proc WHERE oid='rental_source_retirement_private.plot_allowed(jsonb,jsonb)'::regprocedure;
 IF body IS DISTINCT FROM '
 SELECT EXISTS(SELECT 1 FROM rental_source_retirement_private.permits p WHERE p.transaction_id=txid_current() AND p.backend_pid=pg_backend_pid()
  AND p.actor_id=auth.uid() AND p.old_plot=old_row AND p.new_plot=new_row);
' OR md5(body) IS DISTINCT FROM '84b94b87a671c18fcb9a51b145ba3543'
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='rental_source_retirement_private.plot_allowed(jsonb,jsonb)'::regprocedure AND pg_get_userbyid(proowner)=current_user AND prosecdef=false AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[])
  OR (length(definition)-length(replace(definition,body,'')))/length(body)<>1
 THEN RAISE EXCEPTION 'CUSTOMER_OPERATOR_EXACT_ADAPTER_REVIEW_REQUIRED'; END IF;
 EXECUTE replace(definition,body,'
 SELECT EXISTS(SELECT 1 FROM rental_source_retirement_private.permits p WHERE p.transaction_id=txid_current() AND p.backend_pid=pg_backend_pid()
  AND p.actor_id=sales_operator_private.actor() AND p.old_plot=old_row AND p.new_plot=new_row);
');
 INSERT INTO sales_operator_private.adapters VALUES('rental_source_retirement_private.plot_allowed(jsonb,jsonb)','84b94b87a671c18fcb9a51b145ba3543','ca94b980c579dc00d045c4b45e448f04',ARRAY['search_path=pg_catalog']::text[],false);
END;
$operator_adapter_5$;
DO $operator_adapter_6$
DECLARE definition text;body text;
BEGIN
 PERFORM sales_operator_private.require_owner();
 SELECT replace(pg_get_functiondef(oid),E'\r\n',E'\n'),replace(prosrc,E'\r\n',E'\n') INTO definition,body FROM pg_proc WHERE oid='rental_source_retirement_private.register_review(jsonb)'::regprocedure;
 IF body IS DISTINCT FROM '
DECLARE r jsonb;
BEGIN
 PERFORM rental_source_retirement_private.operator();
 IF m->>''version'' IS DISTINCT FROM ''rental-source-retirement-inputs-v1''
  OR m->''businessWritesAllowed'' IS DISTINCT FROM ''false''::jsonb OR m->''freshCaptureIncluded'' IS DISTINCT FROM ''false''::jsonb
  OR m->>''sourceSha256'' IS DISTINCT FROM ''7193857ef04d6a092171749a25867b1ca8d1bbe8f7b83b04fa7473b3a3a69ffd''
  OR m->>''reviewSha256'' IS DISTINCT FROM ''de4beaee70afa8de9e8866e328eabf8bdd25257eae7aa78eb89649712f381802''
  OR m->>''adapterPlanDigest'' IS DISTINCT FROM ''379da2e538829a3cb0379108b98851757c142eb010b1624543413116eef8a506''
  OR m->''approvedSourceRows'' IS DISTINCT FROM ''[859,951,954,958,959,960]''::jsonb
  OR jsonb_array_length(m->''records'') IS DISTINCT FROM 6 OR m->>''datasetKey'' IS DISTINCT FROM ''rental-source-retirement-''||(m->>''adapterPlanDigest'')
  OR (SELECT jsonb_agg((v->>''sourceRow'')::integer ORDER BY (v->>''sourceRow'')::integer) FROM jsonb_array_elements(m->''records'') v) IS DISTINCT FROM m->''approvedSourceRows''
 THEN RAISE EXCEPTION ''RENTAL_RETIREMENT_REVIEW_INVALID''; END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(m->''records'') LOOP
  IF r->>''operation'' IS DISTINCT FROM ''administrative_retirement'' OR r->''sourceProgram'' IS DISTINCT FROM ''null''::jsonb
   OR r->''executable'' IS DISTINCT FROM ''false''::jsonb OR r->''cancellationDate'' IS DISTINCT FROM ''null''::jsonb
   OR (r->>''sourceKey'' ~ ''^[a-f0-9]{64}$'') IS DISTINCT FROM true OR (r->>''rowSha256'' ~ ''^[a-f0-9]{64}$'') IS DISTINCT FROM true
   OR r->''sourceRentalEvidence''->>''column'' IS DISTINCT FROM ''I'' OR r->''sourceRentalEvidence''->>''classification'' IS DISTINCT FROM ''rent_to_own''
   OR (r->''sourceRentalEvidence''->>''purchaseWithTenant'')::boolean IS DISTINCT FROM ((r->>''sourceRow'')::integer=958)
   OR r->''sourceRentalEvidence''->>''valueHash'' IS DISTINCT FROM (CASE WHEN (r->>''sourceRow'')::integer=958 THEN ''3af33ceda424c6ae21edf3fa5536e61da429427614e65387323cd13de2f1d7de'' ELSE ''e9df130d72a176aaefa42465bdd89d31e12b22a75c27f144ab280c0ac0be2364'' END)
   OR jsonb_typeof(r->''history'') IS DISTINCT FROM ''array'' OR jsonb_array_length(r->''history'') IS DISTINCT FROM 2
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(r->''history'') e WHERE e->>''kind'' NOT IN(''visited'',''booked'') OR e->>''kind'' IS NULL
    OR ((e->>''precision''=''unknown'' AND e->''date''=''null'') OR (e->>''precision''=''day'' AND e->>''date'' ~ ''^[0-9]{4}-[0-9]{2}-[0-9]{2}$'' AND pg_input_is_valid(e->>''date'',''date''))) IS DISTINCT FROM true)
  THEN RAISE EXCEPTION ''RENTAL_RETIREMENT_REVIEW_INVALID''; END IF;
 END LOOP;
 INSERT INTO rental_source_retirement_private.reviews(dataset_key,manifest,actor_id) VALUES(m->>''datasetKey'',m,auth.uid());
END; ' OR md5(body) IS DISTINCT FROM 'e89aadc81c23bf3bde83598d177629b2'
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='rental_source_retirement_private.register_review(jsonb)'::regprocedure AND pg_get_userbyid(proowner)=current_user AND prosecdef=false AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[])
  OR (length(definition)-length(replace(definition,body,'')))/length(body)<>1
 THEN RAISE EXCEPTION 'CUSTOMER_OPERATOR_EXACT_ADAPTER_REVIEW_REQUIRED'; END IF;
 EXECUTE replace(definition,body,'
DECLARE r jsonb;
BEGIN
 PERFORM sales_operator_private.authorize_payload(''rentalManifest'',m);
 PERFORM rental_source_retirement_private.operator();
 IF m->>''version'' IS DISTINCT FROM ''rental-source-retirement-inputs-v1''
  OR m->''businessWritesAllowed'' IS DISTINCT FROM ''false''::jsonb OR m->''freshCaptureIncluded'' IS DISTINCT FROM ''false''::jsonb
  OR m->>''sourceSha256'' IS DISTINCT FROM ''7193857ef04d6a092171749a25867b1ca8d1bbe8f7b83b04fa7473b3a3a69ffd''
  OR m->>''reviewSha256'' IS DISTINCT FROM ''de4beaee70afa8de9e8866e328eabf8bdd25257eae7aa78eb89649712f381802''
  OR m->>''adapterPlanDigest'' IS DISTINCT FROM ''379da2e538829a3cb0379108b98851757c142eb010b1624543413116eef8a506''
  OR m->''approvedSourceRows'' IS DISTINCT FROM ''[859,951,954,958,959,960]''::jsonb
  OR jsonb_array_length(m->''records'') IS DISTINCT FROM 6 OR m->>''datasetKey'' IS DISTINCT FROM ''rental-source-retirement-''||(m->>''adapterPlanDigest'')
  OR (SELECT jsonb_agg((v->>''sourceRow'')::integer ORDER BY (v->>''sourceRow'')::integer) FROM jsonb_array_elements(m->''records'') v) IS DISTINCT FROM m->''approvedSourceRows''
 THEN RAISE EXCEPTION ''RENTAL_RETIREMENT_REVIEW_INVALID''; END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(m->''records'') LOOP
  IF r->>''operation'' IS DISTINCT FROM ''administrative_retirement'' OR r->''sourceProgram'' IS DISTINCT FROM ''null''::jsonb
   OR r->''executable'' IS DISTINCT FROM ''false''::jsonb OR r->''cancellationDate'' IS DISTINCT FROM ''null''::jsonb
   OR (r->>''sourceKey'' ~ ''^[a-f0-9]{64}$'') IS DISTINCT FROM true OR (r->>''rowSha256'' ~ ''^[a-f0-9]{64}$'') IS DISTINCT FROM true
   OR r->''sourceRentalEvidence''->>''column'' IS DISTINCT FROM ''I'' OR r->''sourceRentalEvidence''->>''classification'' IS DISTINCT FROM ''rent_to_own''
   OR (r->''sourceRentalEvidence''->>''purchaseWithTenant'')::boolean IS DISTINCT FROM ((r->>''sourceRow'')::integer=958)
   OR r->''sourceRentalEvidence''->>''valueHash'' IS DISTINCT FROM (CASE WHEN (r->>''sourceRow'')::integer=958 THEN ''3af33ceda424c6ae21edf3fa5536e61da429427614e65387323cd13de2f1d7de'' ELSE ''e9df130d72a176aaefa42465bdd89d31e12b22a75c27f144ab280c0ac0be2364'' END)
   OR jsonb_typeof(r->''history'') IS DISTINCT FROM ''array'' OR jsonb_array_length(r->''history'') IS DISTINCT FROM 2
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(r->''history'') e WHERE e->>''kind'' NOT IN(''visited'',''booked'') OR e->>''kind'' IS NULL
    OR ((e->>''precision''=''unknown'' AND e->''date''=''null'') OR (e->>''precision''=''day'' AND e->>''date'' ~ ''^[0-9]{4}-[0-9]{2}-[0-9]{2}$'' AND pg_input_is_valid(e->>''date'',''date''))) IS DISTINCT FROM true)
  THEN RAISE EXCEPTION ''RENTAL_RETIREMENT_REVIEW_INVALID''; END IF;
 END LOOP;
 INSERT INTO rental_source_retirement_private.reviews(dataset_key,manifest,actor_id) VALUES(m->>''datasetKey'',m,sales_operator_private.actor());
END; ');
 INSERT INTO sales_operator_private.adapters VALUES('rental_source_retirement_private.register_review(jsonb)','e89aadc81c23bf3bde83598d177629b2','d344157c4f515788954658c96359fec0',ARRAY['search_path=pg_catalog']::text[],false);
END;
$operator_adapter_6$;
DO $operator_adapter_7$
DECLARE definition text;body text;
BEGIN
 PERFORM sales_operator_private.require_owner();
 SELECT replace(pg_get_functiondef(oid),E'\r\n',E'\n'),replace(prosrc,E'\r\n',E'\n') INTO definition,body FROM pg_proc WHERE oid='rental_source_retirement_private.restore(uuid,text)'::regprocedure;
 IF body IS DISTINCT FROM '
DECLARE archive_entry record;current_inventory jsonb;restored_inventory jsonb;b jsonb;
BEGIN
 PERFORM rental_source_retirement_private.operator();
 LOCK TABLE public.sales IN SHARE ROW EXCLUSIVE MODE;
 IF coalesce(length(btrim(p_review)),0)=0 OR NOT EXISTS(SELECT 1 FROM rental_source_retirement_private.batches WHERE id=p_batch) THEN RAISE EXCEPTION ''RENTAL_RETIREMENT_RESTORE_INVALID''; END IF;
 IF EXISTS(SELECT 1 FROM rental_source_retirement_private.restores WHERE batch_id=p_batch) THEN RAISE EXCEPTION ''RENTAL_RETIREMENT_ALREADY_RESTORED''; END IF;
 IF (SELECT count(*) FROM rental_source_retirement_private.archives WHERE batch_id=p_batch)<>6
  OR EXISTS(SELECT 1 FROM rental_source_retirement_private.archives a JOIN rental_source_retirement_private.batches bt ON bt.id=a.batch_id WHERE a.batch_id=p_batch AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(bt.payload->''records'') r WHERE r->''before''=a.before_image AND (r->''binding''->>''saleId'')::uuid=a.sale_id AND (r->>''sourceRow'')::integer=a.source_row))
 THEN RAISE EXCEPTION ''RENTAL_RETIREMENT_RESTORE_INVALID''; END IF;
 FOR archive_entry IN SELECT * FROM rental_source_retirement_private.archives WHERE batch_id=p_batch ORDER BY source_row LOOP
  b:=archive_entry.before_image;
  PERFORM 1 FROM public.sales_customers WHERE id=archive_entry.customer_id FOR UPDATE;
  PERFORM 1 FROM public.lead_project_interests WHERE id=archive_entry.interest_id FOR UPDATE;
  PERFORM 1 FROM public.plots WHERE id=archive_entry.plot_id FOR UPDATE;
  SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY id),''[]'') INTO current_inventory FROM public.sales s WHERE plot_id=archive_entry.plot_id;
  IF EXISTS(SELECT 1 FROM public.sales WHERE id=archive_entry.sale_id)
   OR (SELECT to_jsonb(c) FROM public.sales_customers c WHERE id=archive_entry.customer_id) IS DISTINCT FROM b->''customer''
   OR (SELECT to_jsonb(i) FROM public.lead_project_interests i WHERE id=archive_entry.interest_id) IS DISTINCT FROM b->''interest''
   OR (SELECT to_jsonb(p) FROM public.plots p WHERE id=archive_entry.plot_id) IS DISTINCT FROM archive_entry.after_plot
   OR current_inventory IS DISTINCT FROM (SELECT coalesce(jsonb_agg(s ORDER BY s->>''id''),''[]'') FROM jsonb_array_elements(b->''inventory'') s WHERE s->>''id''<>archive_entry.sale_id::text)
   OR rental_source_retirement_private.source(b->''sale'',b->''customer'',archive_entry.source_row) IS DISTINCT FROM b->''source''
   OR rental_source_retirement_private.dependencies(b->''sale'') IS DISTINCT FROM b->''dependencies''
   OR NOT rental_source_retirement_private.keys(b->''sale'',(SELECT array_agg(attname::text) FROM pg_attribute WHERE attrelid=''public.sales''::regclass AND attnum>0 AND NOT attisdropped))
   OR EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=''public.sales''::regclass AND attnum>0 AND NOT attisdropped AND (attgenerated<>'''' OR attidentity<>''''))
  THEN RAISE EXCEPTION ''RENTAL_RETIREMENT_RESTORE_STALE''; END IF;
 END LOOP;
 FOR archive_entry IN SELECT * FROM rental_source_retirement_private.archives WHERE batch_id=p_batch ORDER BY source_row LOOP
  b:=archive_entry.before_image;
  INSERT INTO rental_source_retirement_private.permits VALUES(txid_current(),pg_backend_pid(),auth.uid(),archive_entry.sale_id,''restore'',b->''sale'',archive_entry.after_plot,b->''plot'');
  INSERT INTO public.sales SELECT (jsonb_populate_record(NULL::public.sales,b->''sale'')).*;
  SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY id),''[]'') INTO restored_inventory FROM public.sales s WHERE plot_id=archive_entry.plot_id;
  IF (SELECT to_jsonb(p) FROM public.plots p WHERE id=archive_entry.plot_id) IS DISTINCT FROM b->''plot'' OR restored_inventory IS DISTINCT FROM b->''inventory''
   OR (SELECT to_jsonb(c) FROM public.sales_customers c WHERE id=archive_entry.customer_id) IS DISTINCT FROM b->''customer''
   OR (SELECT to_jsonb(i) FROM public.lead_project_interests i WHERE id=archive_entry.interest_id) IS DISTINCT FROM b->''interest''
  THEN RAISE EXCEPTION ''RENTAL_RETIREMENT_RESTORE_AFTER_IMAGE_REQUIRED''; END IF;
  PERFORM sales_private.crm_booking_imported_history(b->''sale'');
 END LOOP;
 INSERT INTO rental_source_retirement_private.restores(batch_id,actor_id,review_reference) VALUES(p_batch,auth.uid(),p_review);
 DELETE FROM rental_source_retirement_private.permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid();
 RETURN jsonb_build_object(''batchId'',p_batch,''restored'',6);
END; ' OR md5(body) IS DISTINCT FROM 'e09e337a73df17c7e3cb7b7896cb912a'
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='rental_source_retirement_private.restore(uuid,text)'::regprocedure AND pg_get_userbyid(proowner)=current_user AND prosecdef=false AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog','lock_timeout=2s','TimeZone=UTC','DateStyle=ISO, YMD']::text[])
  OR (length(definition)-length(replace(definition,body,'')))/length(body)<>1
 THEN RAISE EXCEPTION 'CUSTOMER_OPERATOR_EXACT_ADAPTER_REVIEW_REQUIRED'; END IF;
 EXECUTE replace(definition,body,'
DECLARE archive_entry record;current_inventory jsonb;restored_inventory jsonb;b jsonb;
BEGIN
 PERFORM rental_source_retirement_private.operator();
 LOCK TABLE public.sales IN SHARE ROW EXCLUSIVE MODE;
 IF coalesce(length(btrim(p_review)),0)=0 OR NOT EXISTS(SELECT 1 FROM rental_source_retirement_private.batches WHERE id=p_batch) THEN RAISE EXCEPTION ''RENTAL_RETIREMENT_RESTORE_INVALID''; END IF;
 IF EXISTS(SELECT 1 FROM rental_source_retirement_private.restores WHERE batch_id=p_batch) THEN RAISE EXCEPTION ''RENTAL_RETIREMENT_ALREADY_RESTORED''; END IF;
 IF (SELECT count(*) FROM rental_source_retirement_private.archives WHERE batch_id=p_batch)<>6
  OR EXISTS(SELECT 1 FROM rental_source_retirement_private.archives a JOIN rental_source_retirement_private.batches bt ON bt.id=a.batch_id WHERE a.batch_id=p_batch AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(bt.payload->''records'') r WHERE r->''before''=a.before_image AND (r->''binding''->>''saleId'')::uuid=a.sale_id AND (r->>''sourceRow'')::integer=a.source_row))
 THEN RAISE EXCEPTION ''RENTAL_RETIREMENT_RESTORE_INVALID''; END IF;
 FOR archive_entry IN SELECT * FROM rental_source_retirement_private.archives WHERE batch_id=p_batch ORDER BY source_row LOOP
  b:=archive_entry.before_image;
  PERFORM 1 FROM public.sales_customers WHERE id=archive_entry.customer_id FOR UPDATE;
  PERFORM 1 FROM public.lead_project_interests WHERE id=archive_entry.interest_id FOR UPDATE;
  PERFORM 1 FROM public.plots WHERE id=archive_entry.plot_id FOR UPDATE;
  SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY id),''[]'') INTO current_inventory FROM public.sales s WHERE plot_id=archive_entry.plot_id;
  IF EXISTS(SELECT 1 FROM public.sales WHERE id=archive_entry.sale_id)
   OR (SELECT to_jsonb(c) FROM public.sales_customers c WHERE id=archive_entry.customer_id) IS DISTINCT FROM b->''customer''
   OR (SELECT to_jsonb(i) FROM public.lead_project_interests i WHERE id=archive_entry.interest_id) IS DISTINCT FROM b->''interest''
   OR (SELECT to_jsonb(p) FROM public.plots p WHERE id=archive_entry.plot_id) IS DISTINCT FROM archive_entry.after_plot
   OR current_inventory IS DISTINCT FROM (SELECT coalesce(jsonb_agg(s ORDER BY s->>''id''),''[]'') FROM jsonb_array_elements(b->''inventory'') s WHERE s->>''id''<>archive_entry.sale_id::text)
   OR rental_source_retirement_private.source(b->''sale'',b->''customer'',archive_entry.source_row) IS DISTINCT FROM b->''source''
   OR rental_source_retirement_private.dependencies(b->''sale'') IS DISTINCT FROM b->''dependencies''
   OR NOT rental_source_retirement_private.keys(b->''sale'',(SELECT array_agg(attname::text) FROM pg_attribute WHERE attrelid=''public.sales''::regclass AND attnum>0 AND NOT attisdropped))
   OR EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=''public.sales''::regclass AND attnum>0 AND NOT attisdropped AND (attgenerated<>'''' OR attidentity<>''''))
  THEN RAISE EXCEPTION ''RENTAL_RETIREMENT_RESTORE_STALE''; END IF;
 END LOOP;
 FOR archive_entry IN SELECT * FROM rental_source_retirement_private.archives WHERE batch_id=p_batch ORDER BY source_row LOOP
  b:=archive_entry.before_image;
  INSERT INTO rental_source_retirement_private.permits VALUES(txid_current(),pg_backend_pid(),sales_operator_private.actor(),archive_entry.sale_id,''restore'',b->''sale'',archive_entry.after_plot,b->''plot'');
  INSERT INTO public.sales SELECT (jsonb_populate_record(NULL::public.sales,b->''sale'')).*;
  SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY id),''[]'') INTO restored_inventory FROM public.sales s WHERE plot_id=archive_entry.plot_id;
  IF (SELECT to_jsonb(p) FROM public.plots p WHERE id=archive_entry.plot_id) IS DISTINCT FROM b->''plot'' OR restored_inventory IS DISTINCT FROM b->''inventory''
   OR (SELECT to_jsonb(c) FROM public.sales_customers c WHERE id=archive_entry.customer_id) IS DISTINCT FROM b->''customer''
   OR (SELECT to_jsonb(i) FROM public.lead_project_interests i WHERE id=archive_entry.interest_id) IS DISTINCT FROM b->''interest''
  THEN RAISE EXCEPTION ''RENTAL_RETIREMENT_RESTORE_AFTER_IMAGE_REQUIRED''; END IF;
  PERFORM sales_private.crm_booking_imported_history(b->''sale'');
 END LOOP;
 INSERT INTO rental_source_retirement_private.restores(batch_id,actor_id,review_reference) VALUES(p_batch,sales_operator_private.actor(),p_review);
 DELETE FROM rental_source_retirement_private.permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid();
 RETURN jsonb_build_object(''batchId'',p_batch,''restored'',6);
END; ');
 INSERT INTO sales_operator_private.adapters VALUES('rental_source_retirement_private.restore(uuid,text)','e09e337a73df17c7e3cb7b7896cb912a','94644e3336372b7ca68eff4d8541990c',ARRAY['search_path=pg_catalog','lock_timeout=2s','TimeZone=UTC','DateStyle=ISO, YMD']::text[],false);
END;
$operator_adapter_7$;
DO $operator_adapter_8$
DECLARE definition text;body text;
BEGIN
 PERFORM sales_operator_private.require_owner();
 SELECT replace(pg_get_functiondef(oid),E'\r\n',E'\n'),replace(prosrc,E'\r\n',E'\n') INTO definition,body FROM pg_proc WHERE oid='rental_source_retirement_private.sale_allowed(text,jsonb,jsonb)'::regprocedure;
 IF body IS DISTINCT FROM '
 SELECT EXISTS(SELECT 1 FROM rental_source_retirement_private.permits p WHERE p.transaction_id=txid_current() AND p.backend_pid=pg_backend_pid()
  AND p.actor_id=auth.uid() AND ((op=''DELETE'' AND p.operation=''retire'' AND p.sale=old_row AND new_row IS NULL)
   OR (op=''INSERT'' AND p.operation=''restore'' AND p.sale=new_row AND old_row IS NULL)));
' OR md5(body) IS DISTINCT FROM '06b48337fa1bbb28ca23ff854b91f9c4'
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='rental_source_retirement_private.sale_allowed(text,jsonb,jsonb)'::regprocedure AND pg_get_userbyid(proowner)=current_user AND prosecdef=false AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[])
  OR (length(definition)-length(replace(definition,body,'')))/length(body)<>1
 THEN RAISE EXCEPTION 'CUSTOMER_OPERATOR_EXACT_ADAPTER_REVIEW_REQUIRED'; END IF;
 EXECUTE replace(definition,body,'
 SELECT EXISTS(SELECT 1 FROM rental_source_retirement_private.permits p WHERE p.transaction_id=txid_current() AND p.backend_pid=pg_backend_pid()
  AND p.actor_id=sales_operator_private.actor() AND ((op=''DELETE'' AND p.operation=''retire'' AND p.sale=old_row AND new_row IS NULL)
   OR (op=''INSERT'' AND p.operation=''restore'' AND p.sale=new_row AND old_row IS NULL)));
');
 INSERT INTO sales_operator_private.adapters VALUES('rental_source_retirement_private.sale_allowed(text,jsonb,jsonb)','06b48337fa1bbb28ca23ff854b91f9c4','fbe44967475011da257589736fe878fd',ARRAY['search_path=pg_catalog']::text[],false);
END;
$operator_adapter_8$;
DO $operator_adapter_9$
DECLARE definition text;body text;
BEGIN
 PERFORM sales_operator_private.require_owner();
 SELECT replace(pg_get_functiondef(oid),E'\r\n',E'\n'),replace(prosrc,E'\r\n',E'\n') INTO definition,body FROM pg_proc WHERE oid='sales_import_private.apply_reviewed_details(jsonb)'::regprocedure;
 IF body IS DISTINCT FROM '
DECLARE actor uuid:=auth.uid(); b sales_import_private.detail_batches%ROWTYPE; inserted_id uuid;
 r jsonb; binding jsonb; patch jsonb; before_image jsonb; c public.sales_customers%ROWTYPE;
 i public.lead_project_interests%ROWTYPE; s public.sales%ROWTYPE;
 dc sales_private.deal_details_corrections%ROWTYPE; ndc sales_private.deal_details_corrections%ROWTYPE;
 fc sales_import_private.forecast_corrections%ROWTYPE; nfc sales_import_private.forecast_corrections%ROWTYPE;
 price numeric; forecast date; changed integer:=0; recorded timestamptz; canonical_before jsonb;
BEGIN
 IF actor IS NULL OR current_user IS DISTINCT FROM (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid=''sales_import_private.detail_batches''::regclass)
 THEN RAISE EXCEPTION ''IMPORT_DETAILS_FORBIDDEN''; END IF;
 -- Same lock order as operational writers; Admin revocation waits or denies before any commit.
 PERFORM pg_advisory_xact_lock(hashtextextended(''crm-booking-command'',0));
 PERFORM 1 FROM sales_private.crm_user_roles WHERE user_id=actor AND role=''admin'' AND is_active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION ''IMPORT_DETAILS_FORBIDDEN''; END IF;
 PERFORM sales_import_private.exact_object(p_payload,ARRAY[''version'',''datasetKey'',''sourceSha256'',''reviewSha256'',''records'',''businessStageWritesAllowed'',''leadReplayAllowed'']);
 IF p_payload->>''version'' IS DISTINCT FROM ''reviewed-import-details-v1''
  OR p_payload->''businessStageWritesAllowed'' IS DISTINCT FROM ''false''::jsonb OR p_payload->''leadReplayAllowed'' IS DISTINCT FROM ''false''::jsonb
  OR jsonb_typeof(p_payload->''datasetKey'') IS DISTINCT FROM ''string'' OR length(p_payload->>''datasetKey'') NOT BETWEEN 1 AND 200
  OR p_payload->>''datasetKey''<>btrim(p_payload->>''datasetKey'') OR p_payload->>''datasetKey'' ~ ''[[:cntrl:]]''
  OR jsonb_typeof(p_payload->''sourceSha256'') IS DISTINCT FROM ''string'' OR (p_payload->>''sourceSha256'' ~ ''^[a-f0-9]{64}$'') IS DISTINCT FROM true
  OR jsonb_typeof(p_payload->''reviewSha256'') IS DISTINCT FROM ''string'' OR (p_payload->>''reviewSha256'' ~ ''^[a-f0-9]{64}$'') IS DISTINCT FROM true
  OR jsonb_typeof(p_payload->''records'') IS DISTINCT FROM ''array'' OR octet_length(p_payload::text)>8388608
 THEN RAISE EXCEPTION ''IMPORT_DETAILS_INVALID''; END IF;
 IF jsonb_array_length(p_payload->''records'') NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION ''IMPORT_DETAILS_INVALID''; END IF;
 INSERT INTO sales_import_private.detail_batches(dataset_key,source_sha256,review_sha256,payload,reviewer_id)
 VALUES(p_payload->>''datasetKey'',p_payload->>''sourceSha256'',p_payload->>''reviewSha256'',p_payload,actor)
 ON CONFLICT(dataset_key) DO NOTHING RETURNING id INTO inserted_id;
 SELECT * INTO STRICT b FROM sales_import_private.detail_batches WHERE dataset_key=p_payload->>''datasetKey'' FOR UPDATE;
 IF b.payload IS DISTINCT FROM p_payload THEN RAISE EXCEPTION ''IMPORT_DETAILS_REPLAY_CONFLICT''; END IF;
 IF inserted_id IS NULL THEN RETURN jsonb_build_object(''batchId'',b.id,''records'',jsonb_array_length(p_payload->''records''),''replayed'',true,''sourceChanged'',false); END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(p_payload->''records'') ORDER BY value->''binding''->>''saleId'' LOOP
  PERFORM sales_import_private.exact_object(r,ARRAY[''sourceRow'',''sourceKey'',''rowSha256'',''binding'',''before'',''patch'']);
  binding:=r->''binding''; patch:=r->''patch''; before_image:=r->''before'';
  PERFORM sales_import_private.exact_object(binding,ARRAY[''customerId'',''interestId'',''saleId'',''customerOwnerId'',''interestOwnerId'',''customerRevision'',''interestRevision'']);
  PERFORM sales_import_private.exact_object(before_image,ARRAY[''sale'',''details'',''forecast'']);
  PERFORM sales_import_private.exact_object(patch,ARRAY[''salePriceSatang'',''expectedTransferDate'',''sourceStage'']);
  IF jsonb_typeof(r->''sourceRow'') IS DISTINCT FROM ''number'' OR (r->>''sourceRow'' ~ ''^[0-9]+$'') IS DISTINCT FROM true
   OR jsonb_typeof(r->''sourceKey'') IS DISTINCT FROM ''string'' OR (r->>''sourceKey'' ~ ''^[a-f0-9]{64}$'') IS DISTINCT FROM true
   OR jsonb_typeof(r->''rowSha256'') IS DISTINCT FROM ''string'' OR (r->>''rowSha256'' ~ ''^[a-f0-9]{64}$'') IS DISTINCT FROM true
   OR jsonb_typeof(patch->''salePriceSatang'') NOT IN (''null'',''number'') OR jsonb_typeof(patch->''expectedTransferDate'') NOT IN (''null'',''string'')
   OR jsonb_typeof(patch->''sourceStage'') IS DISTINCT FROM ''string''
   OR EXISTS(SELECT 1 FROM jsonb_each(binding) x WHERE jsonb_typeof(x.value)<>''string'' OR (x.value#>>''{}'' ~ ''^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'') IS DISTINCT FROM true)
  THEN RAISE EXCEPTION ''IMPORT_DETAILS_INVALID''; END IF;
  SELECT * INTO c FROM public.sales_customers WHERE id=(binding->>''customerId'')::uuid FOR UPDATE;
  SELECT * INTO i FROM public.lead_project_interests WHERE id=(binding->>''interestId'')::uuid FOR UPDATE;
  SELECT * INTO s FROM public.sales WHERE id=(binding->>''saleId'')::uuid FOR UPDATE;
  SELECT * INTO dc FROM sales_private.deal_details_corrections WHERE sale_id=s.id FOR UPDATE;
  SELECT * INTO fc FROM sales_import_private.forecast_corrections WHERE sale_id=s.id FOR UPDATE;
  IF c.id IS NULL OR i.id IS NULL OR s.id IS NULL OR c.merged_into_customer_id IS NOT NULL OR i.customer_id IS DISTINCT FROM c.id OR s.project_interest_id IS DISTINCT FROM i.id
   OR c.owner_user_id IS DISTINCT FROM (binding->>''customerOwnerId'')::uuid OR i.owner_user_id IS DISTINCT FROM (binding->>''interestOwnerId'')::uuid
   OR c.lifecycle_revision IS DISTINCT FROM (binding->>''customerRevision'')::uuid OR i.lifecycle_revision IS DISTINCT FROM (binding->>''interestRevision'')::uuid
   OR to_jsonb(s) IS DISTINCT FROM before_image->''sale''
   OR coalesce(CASE WHEN dc.sale_id IS NULL THEN NULL ELSE to_jsonb(dc) END,''null''::jsonb) IS DISTINCT FROM before_image->''details'' OR coalesce(CASE WHEN fc.sale_id IS NULL THEN NULL ELSE to_jsonb(fc) END,''null''::jsonb) IS DISTINCT FROM before_image->''forecast''
  THEN RAISE EXCEPTION ''IMPORT_DETAILS_STALE_BINDING''; END IF;
  -- This adapter intentionally refuses status correction, live/new booking and occupied-plot mutation.
  IF s.external_booking_id IS NULL OR c.record_origin<>''legacy_import'' OR s.crm_stage IS DISTINCT FROM patch->>''sourceStage''
   OR NOT (s.crm_stage IN (''booked'',''contracted'',''downpayment'',''document_prep'',''loan_submitted'',''loan_rejected'',''loan_approved'',''transfer_pending'')
     OR (s.crm_stage=''transferred'' AND patch->''salePriceSatang''=''null''::jsonb AND jsonb_typeof(patch->''expectedTransferDate'')=''string''))
   OR s.plot_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.plots WHERE id=s.plot_id AND project_name=i.project_name)
  THEN RAISE EXCEPTION ''IMPORT_DETAILS_SEPARATE_LIFECYCLE_REVIEW_REQUIRED''; END IF;
  IF sales_private.crm_booking_imported_history(to_jsonb(s)) IS NULL THEN RAISE EXCEPTION ''IMPORT_DETAILS_SEPARATE_LIFECYCLE_REVIEW_REQUIRED''; END IF;
  -- Lock trusted owners, and reject closed/deactivated mappings. Never assign source closing staff to the Customer.
  PERFORM 1 FROM sales_private.crm_user_roles WHERE user_id IN(c.owner_user_id,i.owner_user_id) ORDER BY user_id FOR SHARE;
  IF EXISTS(SELECT 1 FROM unnest(ARRAY[c.owner_user_id,i.owner_user_id]) u WHERE NOT EXISTS(SELECT 1 FROM sales_private.crm_user_roles WHERE user_id=u AND role=''sales'' AND is_active))
   THEN RAISE EXCEPTION ''IMPORT_DETAILS_OWNER_CHANGED''; END IF;
  canonical_before:=to_jsonb(s); recorded:=clock_timestamp(); ndc:=dc; nfc:=fc;
  IF patch->''salePriceSatang''<>''null''::jsonb THEN
   IF (patch->>''salePriceSatang'' ~ ''^[1-9][0-9]{0,10}$'') IS DISTINCT FROM true OR (patch->>''salePriceSatang'')::numeric>99999999999 THEN RAISE EXCEPTION ''IMPORT_DETAILS_INVALID''; END IF;
   price:=(patch->>''salePriceSatang'')::numeric/100;
   IF price IS DISTINCT FROM sales_private.crm_effective_sale_price(s.id) THEN
    ndc.sale_id:=s.id; ndc.sale_price:=price;
    -- Import unknown bank preserves the existing effective value, including an explicit operational NULL.
    ndc.bank_name:=CASE WHEN dc.sale_id IS NULL THEN NULLIF(sales_private.crm_customer_deal_details_trim(s.bank_name),'''') ELSE dc.bank_name END;
    ndc.revision:=gen_random_uuid(); ndc.actor_user_id:=actor; ndc.reason:=''Reviewed source details: ''||b.dataset_key; ndc.recorded_at:=recorded;
    INSERT INTO sales_private.customer_deal_details_permits VALUES(txid_current(),pg_backend_pid(),actor,''deal'',s.id,CASE WHEN dc.sale_id IS NULL THEN NULL ELSE to_jsonb(dc) END,to_jsonb(ndc));
    IF dc.sale_id IS NULL THEN INSERT INTO sales_private.deal_details_corrections SELECT ndc.*;
    ELSE UPDATE sales_private.deal_details_corrections SET sale_price=ndc.sale_price,bank_name=ndc.bank_name,revision=ndc.revision,actor_user_id=actor,reason=ndc.reason,recorded_at=recorded WHERE sale_id=s.id; END IF;
    DELETE FROM sales_private.customer_deal_details_permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid() AND entity_type=''deal'' AND entity_id=s.id;
   END IF;
  END IF;
  IF patch->''expectedTransferDate''<>''null''::jsonb THEN
   IF (patch->>''expectedTransferDate'' ~ ''^[0-9]{4}-[0-9]{2}-[0-9]{2}$'') IS DISTINCT FROM true OR NOT pg_input_is_valid(patch->>''expectedTransferDate'',''date'') THEN RAISE EXCEPTION ''IMPORT_DETAILS_INVALID''; END IF;
   forecast:=(patch->>''expectedTransferDate'')::date;
   nfc.sale_id:=s.id; nfc.expected_transfer_date:=forecast; nfc.revision:=gen_random_uuid(); nfc.batch_id:=b.id; nfc.reviewer_id:=actor; nfc.recorded_at:=recorded;
   INSERT INTO sales_import_private.forecast_permits VALUES(txid_current(),pg_backend_pid(),actor,s.id,CASE WHEN fc.sale_id IS NULL THEN NULL ELSE to_jsonb(fc) END,to_jsonb(nfc));
   IF fc.sale_id IS NULL THEN INSERT INTO sales_import_private.forecast_corrections SELECT nfc.*;
   ELSE UPDATE sales_import_private.forecast_corrections SET expected_transfer_date=forecast,revision=nfc.revision,batch_id=b.id,reviewer_id=actor,recorded_at=recorded WHERE sale_id=s.id; END IF;
   DELETE FROM sales_import_private.forecast_permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid() AND sale_id=s.id;
  END IF;
  INSERT INTO sales_import_private.detail_events VALUES(b.id,(r->>''sourceRow'')::integer,r->>''sourceKey'',r->>''rowSha256'',s.id,
   CASE WHEN dc.sale_id IS NULL THEN NULL ELSE to_jsonb(dc) END,CASE WHEN ndc.sale_id IS NULL THEN NULL ELSE to_jsonb(ndc) END,
   CASE WHEN fc.sale_id IS NULL THEN NULL ELSE to_jsonb(fc) END,CASE WHEN nfc.sale_id IS NULL THEN NULL ELSE to_jsonb(nfc) END);
  IF canonical_before IS DISTINCT FROM (SELECT to_jsonb(ss) FROM public.sales ss WHERE id=s.id) THEN RAISE EXCEPTION ''IMPORT_DETAILS_SOURCE_CHANGED''; END IF;
  changed:=changed+1;
 END LOOP;
 RETURN jsonb_build_object(''batchId'',b.id,''records'',changed,''replayed'',false,''sourceChanged'',false);
END;
' OR md5(body) IS DISTINCT FROM '212e9602f15876f194816ffdaac7ef6a'
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='sales_import_private.apply_reviewed_details(jsonb)'::regprocedure AND pg_get_userbyid(proowner)=current_user AND prosecdef=false AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog','TimeZone=UTC']::text[])
  OR (length(definition)-length(replace(definition,body,'')))/length(body)<>1
 THEN RAISE EXCEPTION 'CUSTOMER_OPERATOR_EXACT_ADAPTER_REVIEW_REQUIRED'; END IF;
 EXECUTE replace(definition,body,'
DECLARE actor uuid:=sales_operator_private.actor(); b sales_import_private.detail_batches%ROWTYPE; inserted_id uuid;
 r jsonb; binding jsonb; patch jsonb; before_image jsonb; c public.sales_customers%ROWTYPE;
 i public.lead_project_interests%ROWTYPE; s public.sales%ROWTYPE;
 dc sales_private.deal_details_corrections%ROWTYPE; ndc sales_private.deal_details_corrections%ROWTYPE;
 fc sales_import_private.forecast_corrections%ROWTYPE; nfc sales_import_private.forecast_corrections%ROWTYPE;
 price numeric; forecast date; changed integer:=0; recorded timestamptz; canonical_before jsonb;
BEGIN
 PERFORM sales_operator_private.authorize_payload(''details'',p_payload);
 IF actor IS NULL OR current_user IS DISTINCT FROM (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid=''sales_import_private.detail_batches''::regclass)
 THEN RAISE EXCEPTION ''IMPORT_DETAILS_FORBIDDEN''; END IF;
 -- Same lock order as operational writers; Admin revocation waits or denies before any commit.
 PERFORM pg_advisory_xact_lock(hashtextextended(''crm-booking-command'',0));
 PERFORM 1 FROM sales_private.crm_user_roles WHERE user_id=actor AND role=''admin'' AND is_active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION ''IMPORT_DETAILS_FORBIDDEN''; END IF;
 PERFORM sales_import_private.exact_object(p_payload,ARRAY[''version'',''datasetKey'',''sourceSha256'',''reviewSha256'',''records'',''businessStageWritesAllowed'',''leadReplayAllowed'']);
 IF p_payload->>''version'' IS DISTINCT FROM ''reviewed-import-details-v1''
  OR p_payload->''businessStageWritesAllowed'' IS DISTINCT FROM ''false''::jsonb OR p_payload->''leadReplayAllowed'' IS DISTINCT FROM ''false''::jsonb
  OR jsonb_typeof(p_payload->''datasetKey'') IS DISTINCT FROM ''string'' OR length(p_payload->>''datasetKey'') NOT BETWEEN 1 AND 200
  OR p_payload->>''datasetKey''<>btrim(p_payload->>''datasetKey'') OR p_payload->>''datasetKey'' ~ ''[[:cntrl:]]''
  OR jsonb_typeof(p_payload->''sourceSha256'') IS DISTINCT FROM ''string'' OR (p_payload->>''sourceSha256'' ~ ''^[a-f0-9]{64}$'') IS DISTINCT FROM true
  OR jsonb_typeof(p_payload->''reviewSha256'') IS DISTINCT FROM ''string'' OR (p_payload->>''reviewSha256'' ~ ''^[a-f0-9]{64}$'') IS DISTINCT FROM true
  OR jsonb_typeof(p_payload->''records'') IS DISTINCT FROM ''array'' OR octet_length(p_payload::text)>8388608
 THEN RAISE EXCEPTION ''IMPORT_DETAILS_INVALID''; END IF;
 IF jsonb_array_length(p_payload->''records'') NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION ''IMPORT_DETAILS_INVALID''; END IF;
 INSERT INTO sales_import_private.detail_batches(dataset_key,source_sha256,review_sha256,payload,reviewer_id)
 VALUES(p_payload->>''datasetKey'',p_payload->>''sourceSha256'',p_payload->>''reviewSha256'',p_payload,actor)
 ON CONFLICT(dataset_key) DO NOTHING RETURNING id INTO inserted_id;
 SELECT * INTO STRICT b FROM sales_import_private.detail_batches WHERE dataset_key=p_payload->>''datasetKey'' FOR UPDATE;
 IF b.payload IS DISTINCT FROM p_payload THEN RAISE EXCEPTION ''IMPORT_DETAILS_REPLAY_CONFLICT''; END IF;
 IF inserted_id IS NULL THEN RETURN jsonb_build_object(''batchId'',b.id,''records'',jsonb_array_length(p_payload->''records''),''replayed'',true,''sourceChanged'',false); END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(p_payload->''records'') ORDER BY value->''binding''->>''saleId'' LOOP
  PERFORM sales_import_private.exact_object(r,ARRAY[''sourceRow'',''sourceKey'',''rowSha256'',''binding'',''before'',''patch'']);
  binding:=r->''binding''; patch:=r->''patch''; before_image:=r->''before'';
  PERFORM sales_import_private.exact_object(binding,ARRAY[''customerId'',''interestId'',''saleId'',''customerOwnerId'',''interestOwnerId'',''customerRevision'',''interestRevision'']);
  PERFORM sales_import_private.exact_object(before_image,ARRAY[''sale'',''details'',''forecast'']);
  PERFORM sales_import_private.exact_object(patch,ARRAY[''salePriceSatang'',''expectedTransferDate'',''sourceStage'']);
  IF jsonb_typeof(r->''sourceRow'') IS DISTINCT FROM ''number'' OR (r->>''sourceRow'' ~ ''^[0-9]+$'') IS DISTINCT FROM true
   OR jsonb_typeof(r->''sourceKey'') IS DISTINCT FROM ''string'' OR (r->>''sourceKey'' ~ ''^[a-f0-9]{64}$'') IS DISTINCT FROM true
   OR jsonb_typeof(r->''rowSha256'') IS DISTINCT FROM ''string'' OR (r->>''rowSha256'' ~ ''^[a-f0-9]{64}$'') IS DISTINCT FROM true
   OR jsonb_typeof(patch->''salePriceSatang'') NOT IN (''null'',''number'') OR jsonb_typeof(patch->''expectedTransferDate'') NOT IN (''null'',''string'')
   OR jsonb_typeof(patch->''sourceStage'') IS DISTINCT FROM ''string''
   OR EXISTS(SELECT 1 FROM jsonb_each(binding) x WHERE jsonb_typeof(x.value)<>''string'' OR (x.value#>>''{}'' ~ ''^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'') IS DISTINCT FROM true)
  THEN RAISE EXCEPTION ''IMPORT_DETAILS_INVALID''; END IF;
  SELECT * INTO c FROM public.sales_customers WHERE id=(binding->>''customerId'')::uuid FOR UPDATE;
  SELECT * INTO i FROM public.lead_project_interests WHERE id=(binding->>''interestId'')::uuid FOR UPDATE;
  SELECT * INTO s FROM public.sales WHERE id=(binding->>''saleId'')::uuid FOR UPDATE;
  SELECT * INTO dc FROM sales_private.deal_details_corrections WHERE sale_id=s.id FOR UPDATE;
  SELECT * INTO fc FROM sales_import_private.forecast_corrections WHERE sale_id=s.id FOR UPDATE;
  IF c.id IS NULL OR i.id IS NULL OR s.id IS NULL OR c.merged_into_customer_id IS NOT NULL OR i.customer_id IS DISTINCT FROM c.id OR s.project_interest_id IS DISTINCT FROM i.id
   OR c.owner_user_id IS DISTINCT FROM (binding->>''customerOwnerId'')::uuid OR i.owner_user_id IS DISTINCT FROM (binding->>''interestOwnerId'')::uuid
   OR c.lifecycle_revision IS DISTINCT FROM (binding->>''customerRevision'')::uuid OR i.lifecycle_revision IS DISTINCT FROM (binding->>''interestRevision'')::uuid
   OR to_jsonb(s) IS DISTINCT FROM before_image->''sale''
   OR coalesce(CASE WHEN dc.sale_id IS NULL THEN NULL ELSE to_jsonb(dc) END,''null''::jsonb) IS DISTINCT FROM before_image->''details'' OR coalesce(CASE WHEN fc.sale_id IS NULL THEN NULL ELSE to_jsonb(fc) END,''null''::jsonb) IS DISTINCT FROM before_image->''forecast''
  THEN RAISE EXCEPTION ''IMPORT_DETAILS_STALE_BINDING''; END IF;
  -- This adapter intentionally refuses status correction, live/new booking and occupied-plot mutation.
  IF s.external_booking_id IS NULL OR c.record_origin<>''legacy_import'' OR s.crm_stage IS DISTINCT FROM patch->>''sourceStage''
   OR NOT (s.crm_stage IN (''booked'',''contracted'',''downpayment'',''document_prep'',''loan_submitted'',''loan_rejected'',''loan_approved'',''transfer_pending'')
     OR (s.crm_stage=''transferred'' AND patch->''salePriceSatang''=''null''::jsonb AND jsonb_typeof(patch->''expectedTransferDate'')=''string''))
   OR s.plot_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.plots WHERE id=s.plot_id AND project_name=i.project_name)
  THEN RAISE EXCEPTION ''IMPORT_DETAILS_SEPARATE_LIFECYCLE_REVIEW_REQUIRED''; END IF;
  IF sales_private.crm_booking_imported_history(to_jsonb(s)) IS NULL THEN RAISE EXCEPTION ''IMPORT_DETAILS_SEPARATE_LIFECYCLE_REVIEW_REQUIRED''; END IF;
  -- Lock trusted owners, and reject closed/deactivated mappings. Never assign source closing staff to the Customer.
  PERFORM 1 FROM sales_private.crm_user_roles WHERE user_id IN(c.owner_user_id,i.owner_user_id) ORDER BY user_id FOR SHARE;
  IF EXISTS(SELECT 1 FROM unnest(ARRAY[c.owner_user_id,i.owner_user_id]) u WHERE NOT EXISTS(SELECT 1 FROM sales_private.crm_user_roles WHERE user_id=u AND role=''sales'' AND is_active))
   THEN RAISE EXCEPTION ''IMPORT_DETAILS_OWNER_CHANGED''; END IF;
  canonical_before:=to_jsonb(s); recorded:=clock_timestamp(); ndc:=dc; nfc:=fc;
  IF patch->''salePriceSatang''<>''null''::jsonb THEN
   IF (patch->>''salePriceSatang'' ~ ''^[1-9][0-9]{0,10}$'') IS DISTINCT FROM true OR (patch->>''salePriceSatang'')::numeric>99999999999 THEN RAISE EXCEPTION ''IMPORT_DETAILS_INVALID''; END IF;
   price:=(patch->>''salePriceSatang'')::numeric/100;
   IF price IS DISTINCT FROM sales_private.crm_effective_sale_price(s.id) THEN
    ndc.sale_id:=s.id; ndc.sale_price:=price;
    -- Import unknown bank preserves the existing effective value, including an explicit operational NULL.
    ndc.bank_name:=CASE WHEN dc.sale_id IS NULL THEN NULLIF(sales_private.crm_customer_deal_details_trim(s.bank_name),'''') ELSE dc.bank_name END;
    ndc.revision:=gen_random_uuid(); ndc.actor_user_id:=actor; ndc.reason:=''Reviewed source details: ''||b.dataset_key; ndc.recorded_at:=recorded;
    INSERT INTO sales_private.customer_deal_details_permits VALUES(txid_current(),pg_backend_pid(),actor,''deal'',s.id,CASE WHEN dc.sale_id IS NULL THEN NULL ELSE to_jsonb(dc) END,to_jsonb(ndc));
    IF dc.sale_id IS NULL THEN INSERT INTO sales_private.deal_details_corrections SELECT ndc.*;
    ELSE UPDATE sales_private.deal_details_corrections SET sale_price=ndc.sale_price,bank_name=ndc.bank_name,revision=ndc.revision,actor_user_id=actor,reason=ndc.reason,recorded_at=recorded WHERE sale_id=s.id; END IF;
    DELETE FROM sales_private.customer_deal_details_permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid() AND entity_type=''deal'' AND entity_id=s.id;
   END IF;
  END IF;
  IF patch->''expectedTransferDate''<>''null''::jsonb THEN
   IF (patch->>''expectedTransferDate'' ~ ''^[0-9]{4}-[0-9]{2}-[0-9]{2}$'') IS DISTINCT FROM true OR NOT pg_input_is_valid(patch->>''expectedTransferDate'',''date'') THEN RAISE EXCEPTION ''IMPORT_DETAILS_INVALID''; END IF;
   forecast:=(patch->>''expectedTransferDate'')::date;
   nfc.sale_id:=s.id; nfc.expected_transfer_date:=forecast; nfc.revision:=gen_random_uuid(); nfc.batch_id:=b.id; nfc.reviewer_id:=actor; nfc.recorded_at:=recorded;
   INSERT INTO sales_import_private.forecast_permits VALUES(txid_current(),pg_backend_pid(),actor,s.id,CASE WHEN fc.sale_id IS NULL THEN NULL ELSE to_jsonb(fc) END,to_jsonb(nfc));
   IF fc.sale_id IS NULL THEN INSERT INTO sales_import_private.forecast_corrections SELECT nfc.*;
   ELSE UPDATE sales_import_private.forecast_corrections SET expected_transfer_date=forecast,revision=nfc.revision,batch_id=b.id,reviewer_id=actor,recorded_at=recorded WHERE sale_id=s.id; END IF;
   DELETE FROM sales_import_private.forecast_permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid() AND sale_id=s.id;
  END IF;
  INSERT INTO sales_import_private.detail_events VALUES(b.id,(r->>''sourceRow'')::integer,r->>''sourceKey'',r->>''rowSha256'',s.id,
   CASE WHEN dc.sale_id IS NULL THEN NULL ELSE to_jsonb(dc) END,CASE WHEN ndc.sale_id IS NULL THEN NULL ELSE to_jsonb(ndc) END,
   CASE WHEN fc.sale_id IS NULL THEN NULL ELSE to_jsonb(fc) END,CASE WHEN nfc.sale_id IS NULL THEN NULL ELSE to_jsonb(nfc) END);
  IF canonical_before IS DISTINCT FROM (SELECT to_jsonb(ss) FROM public.sales ss WHERE id=s.id) THEN RAISE EXCEPTION ''IMPORT_DETAILS_SOURCE_CHANGED''; END IF;
  changed:=changed+1;
 END LOOP;
 RETURN jsonb_build_object(''batchId'',b.id,''records'',changed,''replayed'',false,''sourceChanged'',false);
END;
');
 INSERT INTO sales_operator_private.adapters VALUES('sales_import_private.apply_reviewed_details(jsonb)','212e9602f15876f194816ffdaac7ef6a','5372b9167b174e45eee8149dff65b717',ARRAY['search_path=pg_catalog','TimeZone=UTC']::text[],false);
END;
$operator_adapter_9$;
DO $operator_adapter_10$
DECLARE definition text;body text;
BEGIN
 PERFORM sales_operator_private.require_owner();
 SELECT replace(pg_get_functiondef(oid),E'\r\n',E'\n'),replace(prosrc,E'\r\n',E'\n') INTO definition,body FROM pg_proc WHERE oid='sales_import_private.forecast_guard()'::regprocedure;
 IF body IS DISTINCT FROM '
BEGIN
 IF sales_recovery_private.row_allowed(TG_TABLE_NAME,TG_OP,CASE WHEN TG_OP=''INSERT'' THEN NULL ELSE to_jsonb(OLD) END,CASE WHEN TG_OP=''DELETE'' THEN NULL ELSE to_jsonb(NEW) END) THEN RETURN CASE WHEN TG_OP=''DELETE'' THEN OLD ELSE NEW END; END IF;
 IF TG_OP NOT IN (''INSERT'',''UPDATE'') OR NOT EXISTS(SELECT 1 FROM sales_import_private.forecast_permits p
   WHERE p.transaction_id=txid_current() AND p.backend_pid=pg_backend_pid() AND p.actor_id=auth.uid()
    AND p.sale_id=NEW.sale_id AND p.new_row=to_jsonb(NEW)
    AND p.old_row IS NOT DISTINCT FROM CASE WHEN TG_OP=''UPDATE'' THEN to_jsonb(OLD) ELSE NULL END)
  THEN RAISE EXCEPTION ''IMPORT_DETAILS_FORBIDDEN''; END IF;
 RETURN NEW;
END; ' OR md5(body) IS DISTINCT FROM '29bec86709f32959d481eb78bcdefdfe'
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='sales_import_private.forecast_guard()'::regprocedure AND pg_get_userbyid(proowner)=current_user AND prosecdef=false AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[])
  OR (length(definition)-length(replace(definition,body,'')))/length(body)<>1
 THEN RAISE EXCEPTION 'CUSTOMER_OPERATOR_EXACT_ADAPTER_REVIEW_REQUIRED'; END IF;
 EXECUTE replace(definition,body,'
BEGIN
 IF sales_recovery_private.row_allowed(TG_TABLE_NAME,TG_OP,CASE WHEN TG_OP=''INSERT'' THEN NULL ELSE to_jsonb(OLD) END,CASE WHEN TG_OP=''DELETE'' THEN NULL ELSE to_jsonb(NEW) END) THEN RETURN CASE WHEN TG_OP=''DELETE'' THEN OLD ELSE NEW END; END IF;
 IF TG_OP NOT IN (''INSERT'',''UPDATE'') OR NOT EXISTS(SELECT 1 FROM sales_import_private.forecast_permits p
   WHERE p.transaction_id=txid_current() AND p.backend_pid=pg_backend_pid() AND p.actor_id=sales_operator_private.actor()
    AND p.sale_id=NEW.sale_id AND p.new_row=to_jsonb(NEW)
    AND p.old_row IS NOT DISTINCT FROM CASE WHEN TG_OP=''UPDATE'' THEN to_jsonb(OLD) ELSE NULL END)
  THEN RAISE EXCEPTION ''IMPORT_DETAILS_FORBIDDEN''; END IF;
 RETURN NEW;
END; ');
 INSERT INTO sales_operator_private.adapters VALUES('sales_import_private.forecast_guard()','29bec86709f32959d481eb78bcdefdfe','de51ff1caacd1bf37c51077c9bd565c3',ARRAY['search_path=pg_catalog']::text[],false);
END;
$operator_adapter_10$;
DO $operator_adapter_11$
DECLARE definition text;body text;
BEGIN
 PERFORM sales_operator_private.require_owner();
 SELECT replace(pg_get_functiondef(oid),E'\r\n',E'\n'),replace(prosrc,E'\r\n',E'\n') INTO definition,body FROM pg_proc WHERE oid='sales_import_private.owner_insert_guard()'::regprocedure;
 IF body IS DISTINCT FROM '
BEGIN
 IF current_user IS DISTINCT FROM (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid=TG_RELID)
  OR auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM sales_private.crm_user_roles WHERE user_id=auth.uid() AND role=''admin'' AND is_active)
 THEN RAISE EXCEPTION ''IMPORT_DETAILS_FORBIDDEN''; END IF;
 RETURN NEW;
END; ' OR md5(body) IS DISTINCT FROM '7ba8563f0172413a675a8492ce6b6893'
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='sales_import_private.owner_insert_guard()'::regprocedure AND pg_get_userbyid(proowner)=current_user AND prosecdef=false AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[])
  OR (length(definition)-length(replace(definition,body,'')))/length(body)<>1
 THEN RAISE EXCEPTION 'CUSTOMER_OPERATOR_EXACT_ADAPTER_REVIEW_REQUIRED'; END IF;
 EXECUTE replace(definition,body,'
BEGIN
 IF current_user IS DISTINCT FROM (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid=TG_RELID)
  OR sales_operator_private.actor() IS NULL OR NOT EXISTS(SELECT 1 FROM sales_private.crm_user_roles WHERE user_id=sales_operator_private.actor() AND role=''admin'' AND is_active)
 THEN RAISE EXCEPTION ''IMPORT_DETAILS_FORBIDDEN''; END IF;
 RETURN NEW;
END; ');
 INSERT INTO sales_operator_private.adapters VALUES('sales_import_private.owner_insert_guard()','7ba8563f0172413a675a8492ce6b6893','69889e75702cbad32229c4bdf062d4c6',ARRAY['search_path=pg_catalog']::text[],false);
END;
$operator_adapter_11$;
DO $operator_adapter_12$
DECLARE definition text;body text;
BEGIN
 PERFORM sales_operator_private.require_owner();
 SELECT replace(pg_get_functiondef(oid),E'\r\n',E'\n'),replace(prosrc,E'\r\n',E'\n') INTO definition,body FROM pg_proc WHERE oid='sales_private.crm_customer_deal_details_guard()'::regprocedure;
 IF body IS DISTINCT FROM '
DECLARE entity text:=CASE WHEN TG_TABLE_NAME=''customer_profile_corrections'' THEN ''customer'' ELSE ''deal'' END;
  identity_id uuid; old_json jsonb; new_json jsonb;
BEGIN
 IF sales_recovery_private.row_allowed(TG_TABLE_NAME,TG_OP,CASE WHEN TG_OP=''INSERT'' THEN NULL ELSE to_jsonb(OLD) END,CASE WHEN TG_OP=''DELETE'' THEN NULL ELSE to_jsonb(NEW) END) THEN RETURN CASE WHEN TG_OP=''DELETE'' THEN OLD ELSE NEW END; END IF;
  IF TG_OP NOT IN (''INSERT'',''UPDATE'') THEN RAISE EXCEPTION ''CRM_CUSTOMER_DEAL_DETAILS_FORBIDDEN''; END IF;
  identity_id:=CASE WHEN entity=''customer'' THEN (to_jsonb(NEW)->>''customer_id'')::uuid ELSE (to_jsonb(NEW)->>''sale_id'')::uuid END;
  old_json:=CASE WHEN TG_OP=''UPDATE'' THEN to_jsonb(OLD) ELSE NULL END; new_json:=to_jsonb(NEW);
  IF NOT EXISTS(SELECT 1 FROM sales_private.customer_deal_details_permits p WHERE p.transaction_id=txid_current()
    AND p.backend_pid=pg_backend_pid() AND p.actor_user_id=auth.uid() AND p.entity_type=entity AND p.entity_id=identity_id
    AND p.old_row IS NOT DISTINCT FROM old_json AND p.new_row=new_json)
    OR public.crm_v2_role() NOT IN (''sales'',''admin'') THEN RAISE EXCEPTION ''CRM_CUSTOMER_DEAL_DETAILS_FORBIDDEN''; END IF;
  RETURN NEW;
END;
' OR md5(body) IS DISTINCT FROM '04d311d280f18a48eba52757ecce6554'
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='sales_private.crm_customer_deal_details_guard()'::regprocedure AND pg_get_userbyid(proowner)=current_user AND prosecdef=true AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[])
  OR (length(definition)-length(replace(definition,body,'')))/length(body)<>1
 THEN RAISE EXCEPTION 'CUSTOMER_OPERATOR_EXACT_ADAPTER_REVIEW_REQUIRED'; END IF;
 EXECUTE replace(definition,body,'
DECLARE entity text:=CASE WHEN TG_TABLE_NAME=''customer_profile_corrections'' THEN ''customer'' ELSE ''deal'' END;
  identity_id uuid; old_json jsonb; new_json jsonb;
BEGIN
 IF sales_recovery_private.row_allowed(TG_TABLE_NAME,TG_OP,CASE WHEN TG_OP=''INSERT'' THEN NULL ELSE to_jsonb(OLD) END,CASE WHEN TG_OP=''DELETE'' THEN NULL ELSE to_jsonb(NEW) END) THEN RETURN CASE WHEN TG_OP=''DELETE'' THEN OLD ELSE NEW END; END IF;
  IF TG_OP NOT IN (''INSERT'',''UPDATE'') THEN RAISE EXCEPTION ''CRM_CUSTOMER_DEAL_DETAILS_FORBIDDEN''; END IF;
  identity_id:=CASE WHEN entity=''customer'' THEN (to_jsonb(NEW)->>''customer_id'')::uuid ELSE (to_jsonb(NEW)->>''sale_id'')::uuid END;
  old_json:=CASE WHEN TG_OP=''UPDATE'' THEN to_jsonb(OLD) ELSE NULL END; new_json:=to_jsonb(NEW);
  IF NOT EXISTS(SELECT 1 FROM sales_private.customer_deal_details_permits p WHERE p.transaction_id=txid_current()
    AND p.backend_pid=pg_backend_pid() AND p.actor_user_id=sales_operator_private.actor() AND p.entity_type=entity AND p.entity_id=identity_id
    AND p.old_row IS NOT DISTINCT FROM old_json AND p.new_row=new_json)
    OR sales_operator_private.operator_role() NOT IN (''sales'',''admin'') THEN RAISE EXCEPTION ''CRM_CUSTOMER_DEAL_DETAILS_FORBIDDEN''; END IF;
  RETURN NEW;
END;
');
 INSERT INTO sales_operator_private.adapters VALUES('sales_private.crm_customer_deal_details_guard()','04d311d280f18a48eba52757ecce6554','209b1b3782ec486922db363f8a1371f4',ARRAY['search_path=pg_catalog']::text[],true);
END;
$operator_adapter_12$;
DO $operator_adapter_13$
DECLARE definition text;body text;
BEGIN
 PERFORM sales_operator_private.require_owner();
 SELECT replace(pg_get_functiondef(oid),E'\r\n',E'\n'),replace(prosrc,E'\r\n',E'\n') INTO definition,body FROM pg_proc WHERE oid='sales_recovery_private.adapter_matches(text,text,text)'::regprocedure;
 IF body IS DISTINCT FROM '
 SELECT p_original_md5=p_current_md5 OR EXISTS(SELECT 1 FROM sales_recovery_private.adapters a
  WHERE a.signature=p_signature AND a.before_md5=p_original_md5 AND a.after_md5=p_current_md5);
' OR md5(body) IS DISTINCT FROM '4a3c5df53c3d5161e2762d7fbd8db3e8'
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='sales_recovery_private.adapter_matches(text,text,text)'::regprocedure AND pg_get_userbyid(proowner)=current_user AND prosecdef=false AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[])
  OR (length(definition)-length(replace(definition,body,'')))/length(body)<>1
 THEN RAISE EXCEPTION 'CUSTOMER_OPERATOR_EXACT_ADAPTER_REVIEW_REQUIRED'; END IF;
 EXECUTE replace(definition,body,'
 SELECT p_original_md5=p_current_md5 OR EXISTS(SELECT 1 FROM sales_recovery_private.adapters a
  WHERE a.signature=p_signature AND a.before_md5=p_original_md5 AND sales_operator_private.adapter_matches(p_signature,a.after_md5,p_current_md5));
');
 INSERT INTO sales_operator_private.adapters VALUES('sales_recovery_private.adapter_matches(text,text,text)','4a3c5df53c3d5161e2762d7fbd8db3e8','9178bf2759f50d46031fd8fc4bbfaf17',ARRAY['search_path=pg_catalog']::text[],false);
END;
$operator_adapter_13$;
DO $operator_adapter_14$
DECLARE definition text;body text;
BEGIN
 PERFORM sales_operator_private.require_owner();
 SELECT replace(pg_get_functiondef(oid),E'\r\n',E'\n'),replace(prosrc,E'\r\n',E'\n') INTO definition,body FROM pg_proc WHERE oid='sales_recovery_private.assert_adapters()'::regprocedure;
 IF body IS DISTINCT FROM '
BEGIN
 IF (SELECT count(*) FROM sales_recovery_private.adapters)<9 OR EXISTS(SELECT 1 FROM sales_recovery_private.adapters a
  WHERE to_regprocedure(a.signature) IS NULL OR a.after_md5 IS DISTINCT FROM
   (SELECT md5(replace(prosrc,E''\r\n'',E''\n'')) FROM pg_proc WHERE oid=to_regprocedure(a.signature)))
 THEN RAISE EXCEPTION ''CUSTOMER_RECOVERY_ADAPTERS_REQUIRED''; END IF;
END; ' OR md5(body) IS DISTINCT FROM '76f4d8e03ed8b7775f5c3988cf6fd064'
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='sales_recovery_private.assert_adapters()'::regprocedure AND pg_get_userbyid(proowner)=current_user AND prosecdef=false AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[])
  OR (length(definition)-length(replace(definition,body,'')))/length(body)<>1
 THEN RAISE EXCEPTION 'CUSTOMER_OPERATOR_EXACT_ADAPTER_REVIEW_REQUIRED'; END IF;
 EXECUTE replace(definition,body,'
BEGIN
 IF (SELECT count(*) FROM sales_recovery_private.adapters)<9 OR EXISTS(SELECT 1 FROM sales_recovery_private.adapters a
  WHERE to_regprocedure(a.signature) IS NULL OR NOT sales_operator_private.adapter_matches(a.signature,a.after_md5,
   (SELECT md5(replace(prosrc,E''\r\n'',E''\n'')) FROM pg_proc WHERE oid=to_regprocedure(a.signature))))
 THEN RAISE EXCEPTION ''CUSTOMER_RECOVERY_ADAPTERS_REQUIRED''; END IF;
END; ');
 INSERT INTO sales_operator_private.adapters VALUES('sales_recovery_private.assert_adapters()','76f4d8e03ed8b7775f5c3988cf6fd064','bef1d81be0501e848ccbae753d21f22f',ARRAY['search_path=pg_catalog']::text[],false);
END;
$operator_adapter_14$;
DO $operator_adapter_15$
DECLARE definition text;body text;
BEGIN
 PERFORM sales_operator_private.require_owner();
 SELECT replace(pg_get_functiondef(oid),E'\r\n',E'\n'),replace(prosrc,E'\r\n',E'\n') INTO definition,body FROM pg_proc WHERE oid='sales_recovery_private.begin_run(text)'::regprocedure;
 IF body IS DISTINCT FROM '
DECLARE result uuid; captured jsonb;known sales_recovery_private.runs%ROWTYPE;
BEGIN
 PERFORM sales_recovery_private.operator(); PERFORM sales_recovery_private.assert_adapters();
 PERFORM pg_advisory_xact_lock(hashtextextended(''crm-booking-command'',0));
 IF coalesce(length(btrim(p_review)),0)=0 OR EXISTS(SELECT 1 FROM customer_source_membership_private.head)
 THEN RAISE EXCEPTION ''CUSTOMER_RECOVERY_BEGIN_REVIEW_REQUIRED''; END IF;
 captured:=sales_recovery_private.snapshot();
 SELECT * INTO known FROM sales_recovery_private.runs WHERE dataset_key=''full-replacement-379da2e538829a3cb0379108b98851757c142eb010b1624543413116eef8a506'';
 IF FOUND THEN
  IF known.before_state IS DISTINCT FROM captured OR EXISTS(SELECT 1 FROM sales_recovery_private.seals WHERE run_id=known.id)
   THEN RAISE EXCEPTION ''CUSTOMER_RECOVERY_BEGIN_REPLAY_CONFLICT''; END IF;
  RETURN known.id;
 END IF;
 INSERT INTO sales_recovery_private.runs(dataset_key,source_sha256,review_reference,actor_id,before_state)
 VALUES(''full-replacement-379da2e538829a3cb0379108b98851757c142eb010b1624543413116eef8a506'',
  ''7193857ef04d6a092171749a25867b1ca8d1bbe8f7b83b04fa7473b3a3a69ffd'',p_review,auth.uid(),captured) RETURNING id INTO result;
 RETURN result;
END; ' OR md5(body) IS DISTINCT FROM '12969d0e93da72bd31c723c011287356'
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='sales_recovery_private.begin_run(text)'::regprocedure AND pg_get_userbyid(proowner)=current_user AND prosecdef=false AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[])
  OR (length(definition)-length(replace(definition,body,'')))/length(body)<>1
 THEN RAISE EXCEPTION 'CUSTOMER_OPERATOR_EXACT_ADAPTER_REVIEW_REQUIRED'; END IF;
 EXECUTE replace(definition,body,'
DECLARE result uuid; captured jsonb;known sales_recovery_private.runs%ROWTYPE;
BEGIN
 PERFORM sales_operator_private.authorize_journal(''begin'',NULL,p_review);
 PERFORM sales_recovery_private.operator(); PERFORM sales_recovery_private.assert_adapters();
 PERFORM pg_advisory_xact_lock(hashtextextended(''crm-booking-command'',0));
 IF coalesce(length(btrim(p_review)),0)=0 OR EXISTS(SELECT 1 FROM customer_source_membership_private.head)
 THEN RAISE EXCEPTION ''CUSTOMER_RECOVERY_BEGIN_REVIEW_REQUIRED''; END IF;
 captured:=sales_recovery_private.snapshot();
 SELECT * INTO known FROM sales_recovery_private.runs WHERE dataset_key=''full-replacement-379da2e538829a3cb0379108b98851757c142eb010b1624543413116eef8a506'';
 IF FOUND THEN
  IF known.before_state IS DISTINCT FROM captured OR EXISTS(SELECT 1 FROM sales_recovery_private.seals WHERE run_id=known.id)
   THEN RAISE EXCEPTION ''CUSTOMER_RECOVERY_BEGIN_REPLAY_CONFLICT''; END IF;
  RETURN known.id;
 END IF;
 INSERT INTO sales_recovery_private.runs(dataset_key,source_sha256,review_reference,actor_id,before_state)
 VALUES(''full-replacement-379da2e538829a3cb0379108b98851757c142eb010b1624543413116eef8a506'',
  ''7193857ef04d6a092171749a25867b1ca8d1bbe8f7b83b04fa7473b3a3a69ffd'',p_review,sales_operator_private.actor(),captured) RETURNING id INTO result;
 RETURN result;
END; ');
 INSERT INTO sales_operator_private.adapters VALUES('sales_recovery_private.begin_run(text)','12969d0e93da72bd31c723c011287356','f9901bcd59df6826bae9732e68a86aef',ARRAY['search_path=pg_catalog']::text[],false);
END;
$operator_adapter_15$;
DO $operator_adapter_16$
DECLARE definition text;body text;
BEGIN
 PERFORM sales_operator_private.require_owner();
 SELECT replace(pg_get_functiondef(oid),E'\r\n',E'\n'),replace(prosrc,E'\r\n',E'\n') INTO definition,body FROM pg_proc WHERE oid='sales_recovery_private.exact_permit_guard()'::regprocedure;
 IF body IS DISTINCT FROM '
DECLARE b jsonb;a jsonb;expected_old jsonb;expected_new jsonb;key_name text;
BEGIN
 PERFORM sales_recovery_private.operator();
 IF NEW.transaction_id<>txid_current() OR NEW.backend_pid<>pg_backend_pid() OR NEW.actor_id<>auth.uid()
  OR NEW.relation_name NOT IN(''sales'',''plots'',''deal_details_corrections'',''forecast_corrections'')
 THEN RAISE EXCEPTION ''CUSTOMER_RECOVERY_EXACT_PERMIT_REQUIRED''; END IF;
 SELECT CASE NEW.relation_name WHEN ''sales'' THEN r.before_state->''public''->''sales'' WHEN ''plots'' THEN r.before_state->''public''->''plots''
  WHEN ''deal_details_corrections'' THEN r.before_state->''details'' ELSE r.before_state->''forecast'' END,
  CASE NEW.relation_name WHEN ''sales'' THEN s.after_state->''public''->''sales'' WHEN ''plots'' THEN s.after_state->''public''->''plots''
  WHEN ''deal_details_corrections'' THEN s.after_state->''details'' ELSE s.after_state->''forecast'' END INTO b,a
  FROM sales_recovery_private.runs r JOIN sales_recovery_private.seals s ON s.run_id=r.id WHERE r.id=NEW.run_id;
 key_name:=CASE WHEN NEW.relation_name IN(''sales'',''plots'') THEN ''id'' ELSE ''sale_id'' END;
 SELECT value INTO expected_old FROM jsonb_array_elements(a) WHERE value->>key_name=NEW.entity_id;
 SELECT value INTO expected_new FROM jsonb_array_elements(b) WHERE value->>key_name=NEW.entity_id;
 IF b IS NULL OR a IS NULL OR expected_old IS DISTINCT FROM NEW.old_row OR expected_new IS DISTINCT FROM NEW.new_row
  OR expected_old IS NOT DISTINCT FROM expected_new OR EXISTS(SELECT 1 FROM sales_recovery_private.recoveries WHERE run_id=NEW.run_id)
 THEN RAISE EXCEPTION ''CUSTOMER_RECOVERY_EXACT_PERMIT_REQUIRED''; END IF;
 RETURN NEW;
END; ' OR md5(body) IS DISTINCT FROM 'f27fc89a8ecd05f7bb115999b3da8a67'
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='sales_recovery_private.exact_permit_guard()'::regprocedure AND pg_get_userbyid(proowner)=current_user AND prosecdef=false AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[])
  OR (length(definition)-length(replace(definition,body,'')))/length(body)<>1
 THEN RAISE EXCEPTION 'CUSTOMER_OPERATOR_EXACT_ADAPTER_REVIEW_REQUIRED'; END IF;
 EXECUTE replace(definition,body,'
DECLARE b jsonb;a jsonb;expected_old jsonb;expected_new jsonb;key_name text;
BEGIN
 PERFORM sales_recovery_private.operator();
 IF NEW.transaction_id<>txid_current() OR NEW.backend_pid<>pg_backend_pid() OR NEW.actor_id<>sales_operator_private.actor()
  OR NEW.relation_name NOT IN(''sales'',''plots'',''deal_details_corrections'',''forecast_corrections'')
 THEN RAISE EXCEPTION ''CUSTOMER_RECOVERY_EXACT_PERMIT_REQUIRED''; END IF;
 SELECT CASE NEW.relation_name WHEN ''sales'' THEN r.before_state->''public''->''sales'' WHEN ''plots'' THEN r.before_state->''public''->''plots''
  WHEN ''deal_details_corrections'' THEN r.before_state->''details'' ELSE r.before_state->''forecast'' END,
  CASE NEW.relation_name WHEN ''sales'' THEN s.after_state->''public''->''sales'' WHEN ''plots'' THEN s.after_state->''public''->''plots''
  WHEN ''deal_details_corrections'' THEN s.after_state->''details'' ELSE s.after_state->''forecast'' END INTO b,a
  FROM sales_recovery_private.runs r JOIN sales_recovery_private.seals s ON s.run_id=r.id WHERE r.id=NEW.run_id;
 key_name:=CASE WHEN NEW.relation_name IN(''sales'',''plots'') THEN ''id'' ELSE ''sale_id'' END;
 SELECT value INTO expected_old FROM jsonb_array_elements(a) WHERE value->>key_name=NEW.entity_id;
 SELECT value INTO expected_new FROM jsonb_array_elements(b) WHERE value->>key_name=NEW.entity_id;
 IF b IS NULL OR a IS NULL OR expected_old IS DISTINCT FROM NEW.old_row OR expected_new IS DISTINCT FROM NEW.new_row
  OR expected_old IS NOT DISTINCT FROM expected_new OR EXISTS(SELECT 1 FROM sales_recovery_private.recoveries WHERE run_id=NEW.run_id)
 THEN RAISE EXCEPTION ''CUSTOMER_RECOVERY_EXACT_PERMIT_REQUIRED''; END IF;
 RETURN NEW;
END; ');
 INSERT INTO sales_operator_private.adapters VALUES('sales_recovery_private.exact_permit_guard()','f27fc89a8ecd05f7bb115999b3da8a67','bedbd1a5c98d92a7d7e4c1120f249e16',ARRAY['search_path=pg_catalog']::text[],false);
END;
$operator_adapter_16$;
DO $operator_adapter_17$
DECLARE definition text;body text;
BEGIN
 PERFORM sales_operator_private.require_owner();
 SELECT replace(pg_get_functiondef(oid),E'\r\n',E'\n'),replace(prosrc,E'\r\n',E'\n') INTO definition,body FROM pg_proc WHERE oid='sales_recovery_private.permit_delete_guard()'::regprocedure;
 IF body IS DISTINCT FROM '
BEGIN
 PERFORM sales_recovery_private.operator();
 IF TG_OP<>''DELETE'' OR OLD.transaction_id<>txid_current() OR OLD.backend_pid<>pg_backend_pid() OR OLD.actor_id<>auth.uid()
 THEN RAISE EXCEPTION ''CUSTOMER_RECOVERY_PERMIT_FORBIDDEN''; END IF; RETURN OLD;
END; ' OR md5(body) IS DISTINCT FROM '9e5da6c7d74aa68c7e54e39c80f587ac'
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='sales_recovery_private.permit_delete_guard()'::regprocedure AND pg_get_userbyid(proowner)=current_user AND prosecdef=false AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[])
  OR (length(definition)-length(replace(definition,body,'')))/length(body)<>1
 THEN RAISE EXCEPTION 'CUSTOMER_OPERATOR_EXACT_ADAPTER_REVIEW_REQUIRED'; END IF;
 EXECUTE replace(definition,body,'
BEGIN
 PERFORM sales_recovery_private.operator();
 IF TG_OP<>''DELETE'' OR OLD.transaction_id<>txid_current() OR OLD.backend_pid<>pg_backend_pid() OR OLD.actor_id<>sales_operator_private.actor()
 THEN RAISE EXCEPTION ''CUSTOMER_RECOVERY_PERMIT_FORBIDDEN''; END IF; RETURN OLD;
END; ');
 INSERT INTO sales_operator_private.adapters VALUES('sales_recovery_private.permit_delete_guard()','9e5da6c7d74aa68c7e54e39c80f587ac','3289b9b9685653e08f3499052e228beb',ARRAY['search_path=pg_catalog']::text[],false);
END;
$operator_adapter_17$;
DO $operator_adapter_18$
DECLARE definition text;body text;
BEGIN
 PERFORM sales_operator_private.require_owner();
 SELECT replace(pg_get_functiondef(oid),E'\r\n',E'\n'),replace(prosrc,E'\r\n',E'\n') INTO definition,body FROM pg_proc WHERE oid='sales_recovery_private.restore_run(uuid,text)'::regprocedure;
 IF body IS DISTINCT FROM '
DECLARE r sales_recovery_private.runs%ROWTYPE;s sales_recovery_private.seals%ROWTYPE;captured jsonb;current_state jsonb;
 t text;target_relation text;key_name text;item jsonb;before_row jsonb;after_row jsonb;v_entity_id text;old_pub jsonb;now_pub jsonb;batch uuid;
BEGIN
 PERFORM sales_recovery_private.operator();PERFORM sales_recovery_private.assert_adapters();
 PERFORM pg_advisory_xact_lock(hashtextextended(''crm-booking-command'',0));
 SELECT * INTO STRICT r FROM sales_recovery_private.runs WHERE id=p_run FOR SHARE;
 SELECT * INTO STRICT s FROM sales_recovery_private.seals WHERE run_id=p_run FOR SHARE;
 IF coalesce(length(btrim(p_review)),0)=0 THEN RAISE EXCEPTION ''CUSTOMER_RECOVERY_REVIEW_REQUIRED''; END IF;
 IF EXISTS(SELECT 1 FROM sales_recovery_private.recoveries WHERE run_id=p_run) THEN
  RETURN jsonb_build_object(''runId'',p_run,''restored'',true,''replayed'',true,''physicalParentsRetained'',true);
 END IF;
 -- Lock every captured business table against concurrent inserts as well as
 -- updates. Role changes and immutable source changes are compared below.
 FOR t IN SELECT jsonb_object_keys(r.before_state->''public'') ORDER BY 1 LOOP EXECUTE format(''LOCK TABLE public.%I IN SHARE ROW EXCLUSIVE MODE'',t); END LOOP;
 LOCK TABLE sales_private.deal_details_corrections,sales_private.customer_profile_corrections,sales_import_private.forecast_corrections,
  customer_source_membership_private.head IN SHARE ROW EXCLUSIVE MODE;
 captured:=sales_recovery_private.snapshot();
 IF captured IS DISTINCT FROM s.after_state THEN RAISE EXCEPTION ''CUSTOMER_RECOVERY_AFTER_STATE_DRIFT''; END IF;
 PERFORM sales_recovery_private.validate_delta(r.before_state,s.after_state);
 PERFORM customer_source_membership_private.deactivate((s.after_state->''head''->0->>''revision_id'')::uuid,p_review);
 -- Arm exact plot permits before inverse Sale mutations run the unchanged sync.
 FOR item IN SELECT value FROM jsonb_array_elements(s.after_state->''public''->''plots'') LOOP
  SELECT value INTO before_row FROM jsonb_array_elements(r.before_state->''public''->''plots'') WHERE value->>''id''=item->>''id'';
  IF before_row IS DISTINCT FROM item THEN INSERT INTO sales_recovery_private.permits VALUES(txid_current(),pg_backend_pid(),auth.uid(),p_run,''plots'',item->>''id'',item,before_row); END IF;
 END LOOP;
 FOREACH t IN ARRAY ARRAY[''details'',''forecast'',''sales''] LOOP
  target_relation:=CASE t WHEN ''details'' THEN ''deal_details_corrections'' WHEN ''forecast'' THEN ''forecast_corrections'' ELSE ''sales'' END;
  key_name:=CASE t WHEN ''sales'' THEN ''id'' ELSE ''sale_id'' END;
  old_pub:=CASE t WHEN ''sales'' THEN r.before_state->''public''->''sales'' ELSE r.before_state->t END;
  now_pub:=CASE t WHEN ''sales'' THEN s.after_state->''public''->''sales'' ELSE s.after_state->t END;
  FOR v_entity_id IN SELECT value->>key_name FROM jsonb_array_elements(old_pub) UNION SELECT value->>key_name FROM jsonb_array_elements(now_pub) ORDER BY 1 LOOP
   SELECT value INTO before_row FROM jsonb_array_elements(old_pub) WHERE value->>key_name=v_entity_id;
   SELECT value INTO after_row FROM jsonb_array_elements(now_pub) WHERE value->>key_name=v_entity_id;
   IF before_row IS NOT DISTINCT FROM after_row THEN CONTINUE; END IF;
   INSERT INTO sales_recovery_private.permits VALUES(txid_current(),pg_backend_pid(),auth.uid(),p_run,target_relation,v_entity_id,after_row,before_row);
   PERFORM sales_recovery_private.write_row(target_relation,key_name,v_entity_id,before_row);
   DELETE FROM sales_recovery_private.permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid() AND relation_name=target_relation AND entity_id=v_entity_id;
  END LOOP;
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(r.before_state->''public''->''plots'') LOOP
  IF EXISTS(SELECT 1 FROM sales_recovery_private.permits p WHERE p.transaction_id=txid_current() AND p.backend_pid=pg_backend_pid() AND p.relation_name=''plots'' AND p.entity_id=item->>''id'')
   THEN PERFORM sales_recovery_private.write_row(''plots'',''id'',item->>''id'',item); END IF;
 END LOOP;
 DELETE FROM sales_recovery_private.permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid();
 FOR item IN SELECT value FROM jsonb_array_elements(r.before_state->''public''->''crm_settings'') LOOP
  SELECT to_jsonb(flags) INTO after_row FROM public.crm_settings flags WHERE flags.id=(item->>''id'')::boolean;
  IF after_row IS DISTINCT FROM item THEN PERFORM sales_recovery_private.write_row(''crm_settings'',''id'',item->>''id'',item); END IF;
 END LOOP;
 FOR batch IN SELECT (value#>>''{}'')::uuid FROM jsonb_array_elements(s.after_state->''rentalIds'') WHERE NOT r.before_state->''rentalIds'' @> jsonb_build_array(value) LOOP
  INSERT INTO rental_source_retirement_private.restores(batch_id,actor_id,review_reference) VALUES(batch,auth.uid(),p_review);
 END LOOP;
 -- Verify the complete business pre-image while retaining only the six sealed
 -- audit parents absent from the captured before-image. A late receipt failure
 -- rolls the whole compensation back, including membership and all row writes.
 current_state:=sales_recovery_private.snapshot();
 FOREACH t IN ARRAY ARRAY[''sales_customers'',''lead_project_interests''] LOOP
  SELECT coalesce(jsonb_agg(current_parent.row ORDER BY current_parent.row::text),''[]'') INTO now_pub FROM jsonb_array_elements(current_state->''public''->t) AS current_parent(row)
   WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(r.before_state->''public''->t) AS old_parent(row) WHERE old_parent.row->>''id''=current_parent.row->>''id'');
  current_state:=jsonb_set(current_state,ARRAY[''public'',t],now_pub);
 END LOOP;
 IF current_state->''public'' IS DISTINCT FROM r.before_state->''public'' OR current_state->''roles'' IS DISTINCT FROM r.before_state->''roles''
  OR current_state->''sourceHashes'' IS DISTINCT FROM r.before_state->''sourceHashes'' OR current_state->''details'' IS DISTINCT FROM r.before_state->''details''
  OR current_state->''forecast'' IS DISTINCT FROM r.before_state->''forecast'' OR current_state->''profiles'' IS DISTINCT FROM r.before_state->''profiles''
  OR current_state->''head'' IS DISTINCT FROM r.before_state->''head'' THEN
   RAISE EXCEPTION ''CUSTOMER_RECOVERY_BEFORE_BUSINESS_PARITY_REQUIRED: %'', jsonb_build_object(
    ''sections'',(SELECT jsonb_agg(k) FROM unnest(ARRAY[''public'',''roles'',''sourceHashes'',''details'',''forecast'',''profiles'',''head'']) k WHERE current_state->k IS DISTINCT FROM r.before_state->k),
    ''publicRelations'',(SELECT jsonb_agg(k) FROM jsonb_object_keys(r.before_state->''public'') k WHERE current_state->''public''->k IS DISTINCT FROM r.before_state->''public''->k));
  END IF;
 INSERT INTO sales_recovery_private.recoveries VALUES(p_run,current_state,auth.uid(),p_review,true,now());
 RETURN jsonb_build_object(''runId'',p_run,''restored'',true,''replayed'',false,''physicalParentsRetained'',true,''immutableEvidenceRetained'',true);
END; ' OR md5(body) IS DISTINCT FROM '81b9be40db889f37294e16a01256630a'
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='sales_recovery_private.restore_run(uuid,text)'::regprocedure AND pg_get_userbyid(proowner)=current_user AND prosecdef=false AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog','lock_timeout=2s']::text[])
  OR (length(definition)-length(replace(definition,body,'')))/length(body)<>1
 THEN RAISE EXCEPTION 'CUSTOMER_OPERATOR_EXACT_ADAPTER_REVIEW_REQUIRED'; END IF;
 EXECUTE replace(definition,body,'
DECLARE r sales_recovery_private.runs%ROWTYPE;s sales_recovery_private.seals%ROWTYPE;captured jsonb;current_state jsonb;
 t text;target_relation text;key_name text;item jsonb;before_row jsonb;after_row jsonb;v_entity_id text;old_pub jsonb;now_pub jsonb;batch uuid;
BEGIN
 PERFORM sales_operator_private.authorize_journal(''restore'',p_run,p_review);
 PERFORM sales_recovery_private.operator();PERFORM sales_recovery_private.assert_adapters();
 PERFORM pg_advisory_xact_lock(hashtextextended(''crm-booking-command'',0));
 SELECT * INTO STRICT r FROM sales_recovery_private.runs WHERE id=p_run FOR SHARE;
 SELECT * INTO STRICT s FROM sales_recovery_private.seals WHERE run_id=p_run FOR SHARE;
 IF coalesce(length(btrim(p_review)),0)=0 THEN RAISE EXCEPTION ''CUSTOMER_RECOVERY_REVIEW_REQUIRED''; END IF;
 IF EXISTS(SELECT 1 FROM sales_recovery_private.recoveries WHERE run_id=p_run) THEN
  RETURN jsonb_build_object(''runId'',p_run,''restored'',true,''replayed'',true,''physicalParentsRetained'',true);
 END IF;
 -- Lock every captured business table against concurrent inserts as well as
 -- updates. Role changes and immutable source changes are compared below.
 FOR t IN SELECT jsonb_object_keys(r.before_state->''public'') ORDER BY 1 LOOP EXECUTE format(''LOCK TABLE public.%I IN SHARE ROW EXCLUSIVE MODE'',t); END LOOP;
 LOCK TABLE sales_private.deal_details_corrections,sales_private.customer_profile_corrections,sales_import_private.forecast_corrections,
  customer_source_membership_private.head IN SHARE ROW EXCLUSIVE MODE;
 captured:=sales_recovery_private.snapshot();
 IF captured IS DISTINCT FROM s.after_state THEN RAISE EXCEPTION ''CUSTOMER_RECOVERY_AFTER_STATE_DRIFT''; END IF;
 PERFORM sales_recovery_private.validate_delta(r.before_state,s.after_state);
 PERFORM customer_source_membership_private.deactivate((s.after_state->''head''->0->>''revision_id'')::uuid,p_review);
 -- Arm exact plot permits before inverse Sale mutations run the unchanged sync.
 FOR item IN SELECT value FROM jsonb_array_elements(s.after_state->''public''->''plots'') LOOP
  SELECT value INTO before_row FROM jsonb_array_elements(r.before_state->''public''->''plots'') WHERE value->>''id''=item->>''id'';
  IF before_row IS DISTINCT FROM item THEN INSERT INTO sales_recovery_private.permits VALUES(txid_current(),pg_backend_pid(),sales_operator_private.actor(),p_run,''plots'',item->>''id'',item,before_row); END IF;
 END LOOP;
 FOREACH t IN ARRAY ARRAY[''details'',''forecast'',''sales''] LOOP
  target_relation:=CASE t WHEN ''details'' THEN ''deal_details_corrections'' WHEN ''forecast'' THEN ''forecast_corrections'' ELSE ''sales'' END;
  key_name:=CASE t WHEN ''sales'' THEN ''id'' ELSE ''sale_id'' END;
  old_pub:=CASE t WHEN ''sales'' THEN r.before_state->''public''->''sales'' ELSE r.before_state->t END;
  now_pub:=CASE t WHEN ''sales'' THEN s.after_state->''public''->''sales'' ELSE s.after_state->t END;
  FOR v_entity_id IN SELECT value->>key_name FROM jsonb_array_elements(old_pub) UNION SELECT value->>key_name FROM jsonb_array_elements(now_pub) ORDER BY 1 LOOP
   SELECT value INTO before_row FROM jsonb_array_elements(old_pub) WHERE value->>key_name=v_entity_id;
   SELECT value INTO after_row FROM jsonb_array_elements(now_pub) WHERE value->>key_name=v_entity_id;
   IF before_row IS NOT DISTINCT FROM after_row THEN CONTINUE; END IF;
   INSERT INTO sales_recovery_private.permits VALUES(txid_current(),pg_backend_pid(),sales_operator_private.actor(),p_run,target_relation,v_entity_id,after_row,before_row);
   PERFORM sales_recovery_private.write_row(target_relation,key_name,v_entity_id,before_row);
   DELETE FROM sales_recovery_private.permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid() AND relation_name=target_relation AND entity_id=v_entity_id;
  END LOOP;
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(r.before_state->''public''->''plots'') LOOP
  IF EXISTS(SELECT 1 FROM sales_recovery_private.permits p WHERE p.transaction_id=txid_current() AND p.backend_pid=pg_backend_pid() AND p.relation_name=''plots'' AND p.entity_id=item->>''id'')
   THEN PERFORM sales_recovery_private.write_row(''plots'',''id'',item->>''id'',item); END IF;
 END LOOP;
 DELETE FROM sales_recovery_private.permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid();
 FOR item IN SELECT value FROM jsonb_array_elements(r.before_state->''public''->''crm_settings'') LOOP
  SELECT to_jsonb(flags) INTO after_row FROM public.crm_settings flags WHERE flags.id=(item->>''id'')::boolean;
  IF after_row IS DISTINCT FROM item THEN PERFORM sales_recovery_private.write_row(''crm_settings'',''id'',item->>''id'',item); END IF;
 END LOOP;
 FOR batch IN SELECT (value#>>''{}'')::uuid FROM jsonb_array_elements(s.after_state->''rentalIds'') WHERE NOT r.before_state->''rentalIds'' @> jsonb_build_array(value) LOOP
  INSERT INTO rental_source_retirement_private.restores(batch_id,actor_id,review_reference) VALUES(batch,sales_operator_private.actor(),p_review);
 END LOOP;
 -- Verify the complete business pre-image while retaining only the six sealed
 -- audit parents absent from the captured before-image. A late receipt failure
 -- rolls the whole compensation back, including membership and all row writes.
 current_state:=sales_recovery_private.snapshot();
 FOREACH t IN ARRAY ARRAY[''sales_customers'',''lead_project_interests''] LOOP
  SELECT coalesce(jsonb_agg(current_parent.row ORDER BY current_parent.row::text),''[]'') INTO now_pub FROM jsonb_array_elements(current_state->''public''->t) AS current_parent(row)
   WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(r.before_state->''public''->t) AS old_parent(row) WHERE old_parent.row->>''id''=current_parent.row->>''id'');
  current_state:=jsonb_set(current_state,ARRAY[''public'',t],now_pub);
 END LOOP;
 IF current_state->''public'' IS DISTINCT FROM r.before_state->''public'' OR current_state->''roles'' IS DISTINCT FROM r.before_state->''roles''
  OR current_state->''sourceHashes'' IS DISTINCT FROM r.before_state->''sourceHashes'' OR current_state->''details'' IS DISTINCT FROM r.before_state->''details''
  OR current_state->''forecast'' IS DISTINCT FROM r.before_state->''forecast'' OR current_state->''profiles'' IS DISTINCT FROM r.before_state->''profiles''
  OR current_state->''head'' IS DISTINCT FROM r.before_state->''head'' THEN
   RAISE EXCEPTION ''CUSTOMER_RECOVERY_BEFORE_BUSINESS_PARITY_REQUIRED: %'', jsonb_build_object(
    ''sections'',(SELECT jsonb_agg(k) FROM unnest(ARRAY[''public'',''roles'',''sourceHashes'',''details'',''forecast'',''profiles'',''head'']) k WHERE current_state->k IS DISTINCT FROM r.before_state->k),
    ''publicRelations'',(SELECT jsonb_agg(k) FROM jsonb_object_keys(r.before_state->''public'') k WHERE current_state->''public''->k IS DISTINCT FROM r.before_state->''public''->k));
  END IF;
 INSERT INTO sales_recovery_private.recoveries VALUES(p_run,current_state,sales_operator_private.actor(),p_review,true,now());
 RETURN jsonb_build_object(''runId'',p_run,''restored'',true,''replayed'',false,''physicalParentsRetained'',true,''immutableEvidenceRetained'',true);
END; ');
 INSERT INTO sales_operator_private.adapters VALUES('sales_recovery_private.restore_run(uuid,text)','81b9be40db889f37294e16a01256630a','96931dc6ac9f6e0c30d3f39d31bd8e14',ARRAY['search_path=pg_catalog','lock_timeout=2s']::text[],false);
END;
$operator_adapter_18$;
DO $operator_adapter_19$
DECLARE definition text;body text;
BEGIN
 PERFORM sales_operator_private.require_owner();
 SELECT replace(pg_get_functiondef(oid),E'\r\n',E'\n'),replace(prosrc,E'\r\n',E'\n') INTO definition,body FROM pg_proc WHERE oid='sales_recovery_private.row_allowed(text,text,jsonb,jsonb)'::regprocedure;
 IF body IS DISTINCT FROM '
 SELECT public.crm_v2_role()=''admin'' AND EXISTS(SELECT 1 FROM sales_recovery_private.permits p
  WHERE p.transaction_id=txid_current() AND p.backend_pid=pg_backend_pid() AND p.actor_id=auth.uid()
   AND p.relation_name=p_relation AND p.entity_id=coalesce(p_old->>''id'',p_new->>''id'',p_old->>''sale_id'',p_new->>''sale_id'')
   AND p_operation=CASE WHEN p.old_row IS NULL THEN ''INSERT'' WHEN p.new_row IS NULL THEN ''DELETE'' ELSE ''UPDATE'' END
   AND p.old_row IS NOT DISTINCT FROM p_old AND p.new_row IS NOT DISTINCT FROM p_new);
' OR md5(body) IS DISTINCT FROM '9c43ef54bdc07b658d9ed8e07ba9fea0'
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='sales_recovery_private.row_allowed(text,text,jsonb,jsonb)'::regprocedure AND pg_get_userbyid(proowner)=current_user AND prosecdef=false AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[])
  OR (length(definition)-length(replace(definition,body,'')))/length(body)<>1
 THEN RAISE EXCEPTION 'CUSTOMER_OPERATOR_EXACT_ADAPTER_REVIEW_REQUIRED'; END IF;
 EXECUTE replace(definition,body,'
 SELECT sales_operator_private.operator_role()=''admin'' AND EXISTS(SELECT 1 FROM sales_recovery_private.permits p
  WHERE p.transaction_id=txid_current() AND p.backend_pid=pg_backend_pid() AND p.actor_id=sales_operator_private.actor()
   AND p.relation_name=p_relation AND p.entity_id=coalesce(p_old->>''id'',p_new->>''id'',p_old->>''sale_id'',p_new->>''sale_id'')
   AND p_operation=CASE WHEN p.old_row IS NULL THEN ''INSERT'' WHEN p.new_row IS NULL THEN ''DELETE'' ELSE ''UPDATE'' END
   AND p.old_row IS NOT DISTINCT FROM p_old AND p.new_row IS NOT DISTINCT FROM p_new);
');
 INSERT INTO sales_operator_private.adapters VALUES('sales_recovery_private.row_allowed(text,text,jsonb,jsonb)','9c43ef54bdc07b658d9ed8e07ba9fea0','0a3f802985e2b6ea798537d633a9d8d9',ARRAY['search_path=pg_catalog']::text[],false);
END;
$operator_adapter_19$;
DO $operator_adapter_20$
DECLARE definition text;body text;
BEGIN
 PERFORM sales_operator_private.require_owner();
 SELECT replace(pg_get_functiondef(oid),E'\r\n',E'\n'),replace(prosrc,E'\r\n',E'\n') INTO definition,body FROM pg_proc WHERE oid='sales_recovery_private.seal_run(uuid,text)'::regprocedure;
 IF body IS DISTINCT FROM '
DECLARE r sales_recovery_private.runs%ROWTYPE; captured jsonb;known sales_recovery_private.seals%ROWTYPE;
BEGIN
 PERFORM sales_recovery_private.operator(); PERFORM sales_recovery_private.assert_adapters();
 PERFORM pg_advisory_xact_lock(hashtextextended(''crm-booking-command'',0));
 SELECT * INTO STRICT r FROM sales_recovery_private.runs WHERE id=p_run FOR SHARE;
 IF coalesce(length(btrim(p_review)),0)=0 THEN RAISE EXCEPTION ''CUSTOMER_RECOVERY_REVIEW_REQUIRED''; END IF;
 captured:=sales_recovery_private.snapshot();PERFORM sales_recovery_private.validate_delta(r.before_state,captured);
 SELECT * INTO known FROM sales_recovery_private.seals WHERE run_id=p_run;
 IF FOUND THEN
  IF known.after_state IS DISTINCT FROM captured THEN RAISE EXCEPTION ''CUSTOMER_RECOVERY_SEAL_REPLAY_CONFLICT''; END IF;
  RETURN jsonb_build_object(''runId'',p_run,''sealed'',true,''replayed'',true,''physicalParentRestore'',false);
 END IF;
 INSERT INTO sales_recovery_private.seals VALUES(p_run,captured,auth.uid(),p_review,now());
 RETURN jsonb_build_object(''runId'',p_run,''sealed'',true,''physicalParentRestore'',false);
END; ' OR md5(body) IS DISTINCT FROM '7dd02ebeaa180ac4e0edf78ba98c1e7e'
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='sales_recovery_private.seal_run(uuid,text)'::regprocedure AND pg_get_userbyid(proowner)=current_user AND prosecdef=false AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[])
  OR (length(definition)-length(replace(definition,body,'')))/length(body)<>1
 THEN RAISE EXCEPTION 'CUSTOMER_OPERATOR_EXACT_ADAPTER_REVIEW_REQUIRED'; END IF;
 EXECUTE replace(definition,body,'
DECLARE r sales_recovery_private.runs%ROWTYPE; captured jsonb;known sales_recovery_private.seals%ROWTYPE;
BEGIN
 PERFORM sales_operator_private.authorize_journal(''seal'',p_run,p_review);
 PERFORM sales_recovery_private.operator(); PERFORM sales_recovery_private.assert_adapters();
 PERFORM pg_advisory_xact_lock(hashtextextended(''crm-booking-command'',0));
 SELECT * INTO STRICT r FROM sales_recovery_private.runs WHERE id=p_run FOR SHARE;
 IF coalesce(length(btrim(p_review)),0)=0 THEN RAISE EXCEPTION ''CUSTOMER_RECOVERY_REVIEW_REQUIRED''; END IF;
 captured:=sales_recovery_private.snapshot();PERFORM sales_recovery_private.validate_delta(r.before_state,captured);
 SELECT * INTO known FROM sales_recovery_private.seals WHERE run_id=p_run;
 IF FOUND THEN
  IF known.after_state IS DISTINCT FROM captured THEN RAISE EXCEPTION ''CUSTOMER_RECOVERY_SEAL_REPLAY_CONFLICT''; END IF;
  RETURN jsonb_build_object(''runId'',p_run,''sealed'',true,''replayed'',true,''physicalParentRestore'',false);
 END IF;
 INSERT INTO sales_recovery_private.seals VALUES(p_run,captured,sales_operator_private.actor(),p_review,now());
 RETURN jsonb_build_object(''runId'',p_run,''sealed'',true,''physicalParentRestore'',false);
END; ');
 INSERT INTO sales_operator_private.adapters VALUES('sales_recovery_private.seal_run(uuid,text)','7dd02ebeaa180ac4e0edf78ba98c1e7e','01b10906a35fda950e2ae9b9e21160cc',ARRAY['search_path=pg_catalog']::text[],false);
END;
$operator_adapter_20$;
DO $operator_adapter_21$
DECLARE definition text;body text;
BEGIN
 PERFORM sales_operator_private.require_owner();
 SELECT replace(pg_get_functiondef(oid),E'\r\n',E'\n'),replace(prosrc,E'\r\n',E'\n') INTO definition,body FROM pg_proc WHERE oid='sales_recovery_private.stock_allowed(jsonb,jsonb)'::regprocedure;
 IF body IS DISTINCT FROM '
 SELECT public.crm_v2_role()=''admin'' AND EXISTS(SELECT 1 FROM sales_recovery_private.permits p
  WHERE p.transaction_id=txid_current() AND p.backend_pid=pg_backend_pid() AND p.actor_id=auth.uid()
   AND p.relation_name=''plots'' AND p.entity_id=p_old->>''id'' AND p.new_row-''has_customer''=p_old-''has_customer''
   AND p.old_row-''has_customer''=p_old-''has_customer'' AND p_old->''has_customer'' IN(p.old_row->''has_customer'',p.new_row->''has_customer'',''false'',''true'',''null'')
   AND p_new IN(p.new_row,p.new_row||jsonb_build_object(''has_customer'',coalesce((p.new_row->>''has_customer'')::boolean,false)))
   AND (SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),''[]'') FROM public.sales s WHERE s.plot_id=p.entity_id)
    =(SELECT coalesce(jsonb_agg(value ORDER BY value->>''id''),''[]'') FROM sales_recovery_private.runs r
      CROSS JOIN LATERAL jsonb_array_elements(r.before_state->''public''->''sales'') WHERE r.id=p.run_id AND value->>''plot_id''=p.entity_id));
' OR md5(body) IS DISTINCT FROM 'e3d71ea604074b17314124533bc1f65c'
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='sales_recovery_private.stock_allowed(jsonb,jsonb)'::regprocedure AND pg_get_userbyid(proowner)=current_user AND prosecdef=false AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[])
  OR (length(definition)-length(replace(definition,body,'')))/length(body)<>1
 THEN RAISE EXCEPTION 'CUSTOMER_OPERATOR_EXACT_ADAPTER_REVIEW_REQUIRED'; END IF;
 EXECUTE replace(definition,body,'
 SELECT sales_operator_private.operator_role()=''admin'' AND EXISTS(SELECT 1 FROM sales_recovery_private.permits p
  WHERE p.transaction_id=txid_current() AND p.backend_pid=pg_backend_pid() AND p.actor_id=sales_operator_private.actor()
   AND p.relation_name=''plots'' AND p.entity_id=p_old->>''id'' AND p.new_row-''has_customer''=p_old-''has_customer''
   AND p.old_row-''has_customer''=p_old-''has_customer'' AND p_old->''has_customer'' IN(p.old_row->''has_customer'',p.new_row->''has_customer'',''false'',''true'',''null'')
   AND p_new IN(p.new_row,p.new_row||jsonb_build_object(''has_customer'',coalesce((p.new_row->>''has_customer'')::boolean,false)))
   AND (SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),''[]'') FROM public.sales s WHERE s.plot_id=p.entity_id)
    =(SELECT coalesce(jsonb_agg(value ORDER BY value->>''id''),''[]'') FROM sales_recovery_private.runs r
      CROSS JOIN LATERAL jsonb_array_elements(r.before_state->''public''->''sales'') WHERE r.id=p.run_id AND value->>''plot_id''=p.entity_id));
');
 INSERT INTO sales_operator_private.adapters VALUES('sales_recovery_private.stock_allowed(jsonb,jsonb)','e3d71ea604074b17314124533bc1f65c','52aa5777284d6943004e88594bee2c85',ARRAY['search_path=pg_catalog']::text[],false);
END;
$operator_adapter_21$;
DO $operator_adapter_22$
DECLARE definition text;body text;
BEGIN
 PERFORM sales_operator_private.require_owner();
 SELECT replace(pg_get_functiondef(oid),E'\r\n',E'\n'),replace(prosrc,E'\r\n',E'\n') INTO definition,body FROM pg_proc WHERE oid='sales_revision_private.allowed(text,jsonb,jsonb)'::regprocedure;
 IF body IS DISTINCT FROM '
BEGIN
 RETURN p_op IN (''INSERT'',''UPDATE'') AND public.crm_v2_role()=''admin'' AND EXISTS(
  SELECT 1 FROM sales_revision_private.permits p JOIN sales_revision_private.events e ON e.id=p.event_id
  WHERE p.transaction_id=txid_current() AND p.backend_pid=pg_backend_pid() AND p.actor_id=auth.uid()
   AND p.old_row IS NOT DISTINCT FROM p_old AND p.new_row=p_new AND e.after_sale=p_new
   AND e.before_sale IS NOT DISTINCT FROM p_old AND e.sale_id=(p_new->>''id'')::uuid
   AND p.operation=CASE WHEN p_op=''INSERT'' THEN ''create_booking'' ELSE ''cancel'' END
   AND e.operation=p.operation);
END; ' OR md5(body) IS DISTINCT FROM '0a5645600e6e0abbe0620462fd84a792'
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='sales_revision_private.allowed(text,jsonb,jsonb)'::regprocedure AND pg_get_userbyid(proowner)=current_user AND prosecdef=false AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[])
  OR (length(definition)-length(replace(definition,body,'')))/length(body)<>1
 THEN RAISE EXCEPTION 'CUSTOMER_OPERATOR_EXACT_ADAPTER_REVIEW_REQUIRED'; END IF;
 EXECUTE replace(definition,body,'
BEGIN
 RETURN p_op IN (''INSERT'',''UPDATE'') AND sales_operator_private.operator_role()=''admin'' AND EXISTS(
  SELECT 1 FROM sales_revision_private.permits p JOIN sales_revision_private.events e ON e.id=p.event_id
  WHERE p.transaction_id=txid_current() AND p.backend_pid=pg_backend_pid() AND p.actor_id=sales_operator_private.actor()
   AND p.old_row IS NOT DISTINCT FROM p_old AND p.new_row=p_new AND e.after_sale=p_new
   AND e.before_sale IS NOT DISTINCT FROM p_old AND e.sale_id=(p_new->>''id'')::uuid
   AND p.operation=CASE WHEN p_op=''INSERT'' THEN ''create_booking'' ELSE ''cancel'' END
   AND e.operation=p.operation);
END; ');
 INSERT INTO sales_operator_private.adapters VALUES('sales_revision_private.allowed(text,jsonb,jsonb)','0a5645600e6e0abbe0620462fd84a792','d53004cda274b47e49ad03ed4e82678b',ARRAY['search_path=pg_catalog']::text[],false);
END;
$operator_adapter_22$;
DO $operator_adapter_23$
DECLARE definition text;body text;
BEGIN
 PERFORM sales_operator_private.require_owner();
 SELECT replace(pg_get_functiondef(oid),E'\r\n',E'\n'),replace(prosrc,E'\r\n',E'\n') INTO definition,body FROM pg_proc WHERE oid='sales_revision_private.apply(jsonb)'::regprocedure;
 IF body IS DISTINCT FROM '
DECLARE actor uuid:=auth.uid(); b sales_revision_private.batches%ROWTYPE; inserted uuid;
 r jsonb; bind jsonb; old jsonb; patch jsonb; c public.sales_customers%ROWTYPE; i public.lead_project_interests%ROWTYPE;
 s public.sales%ROWTYPE; ns public.sales%ROWTYPE; p public.plots%ROWTYPE; e sales_revision_private.events%ROWTYPE;
 dc sales_private.deal_details_corrections%ROWTYPE; ndc sales_private.deal_details_corrections%ROWTYPE;
 inventory jsonb; price numeric; day text; history jsonb; entry jsonb; op text; total integer:=0;
BEGIN
 IF actor IS NULL OR current_user IS DISTINCT FROM (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid=''sales_revision_private.batches''::regclass) THEN RAISE EXCEPTION ''HISTORICAL_REVISION_FORBIDDEN''; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(''crm-booking-command'',0));
 PERFORM 1 FROM sales_private.crm_user_roles WHERE user_id=actor AND role=''admin'' AND is_active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION ''HISTORICAL_REVISION_FORBIDDEN''; END IF;
 PERFORM sales_revision_private.assert_stock_catalog();
 PERFORM sales_import_private.exact_object(p_payload,ARRAY[''version'',''datasetKey'',''sourceSha256'',''reviewSha256'',''records'',''leadReplayAllowed'']);
 IF p_payload->>''version'' IS DISTINCT FROM ''reviewed-historical-sale-revision-v1''
  OR p_payload->''leadReplayAllowed'' IS DISTINCT FROM ''false''::jsonb
  OR jsonb_typeof(p_payload->''datasetKey'') IS DISTINCT FROM ''string'' OR length(p_payload->>''datasetKey'') NOT BETWEEN 1 AND 200
  OR p_payload->>''datasetKey''<>btrim(p_payload->>''datasetKey'') OR p_payload->>''datasetKey'' ~ ''[[:cntrl:]]''
  OR jsonb_typeof(p_payload->''sourceSha256'') IS DISTINCT FROM ''string'' OR jsonb_typeof(p_payload->''reviewSha256'') IS DISTINCT FROM ''string''
  OR (p_payload->>''sourceSha256'' ~ ''^[a-f0-9]{64}$'') IS DISTINCT FROM true OR (p_payload->>''reviewSha256'' ~ ''^[a-f0-9]{64}$'') IS DISTINCT FROM true
  OR jsonb_typeof(p_payload->''records'') IS DISTINCT FROM ''array'' OR octet_length(p_payload::text)>8388608
 THEN RAISE EXCEPTION ''HISTORICAL_REVISION_INVALID''; END IF;
 IF jsonb_array_length(p_payload->''records'') NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION ''HISTORICAL_REVISION_INVALID''; END IF;
 -- Full-table inventory lock also protects against unlinked legacy writers which do not take the advisory lock.
 LOCK TABLE public.plots,public.sales IN SHARE ROW EXCLUSIVE MODE;
 INSERT INTO sales_revision_private.batches(dataset_key,payload,reviewer_id) VALUES(p_payload->>''datasetKey'',p_payload,actor)
 ON CONFLICT(dataset_key) DO NOTHING RETURNING id INTO inserted;
 SELECT * INTO STRICT b FROM sales_revision_private.batches WHERE dataset_key=p_payload->>''datasetKey'' FOR UPDATE;
 IF b.payload IS DISTINCT FROM p_payload THEN RAISE EXCEPTION ''HISTORICAL_REVISION_REPLAY_CONFLICT''; END IF;
 IF inserted IS NULL THEN
  PERFORM 1 FROM sales_private.crm_user_roles WHERE user_id IN(SELECT current_customer.owner_user_id FROM sales_revision_private.events source_event JOIN public.sales_customers current_customer ON current_customer.id=source_event.customer_id WHERE source_event.batch_id=b.id UNION SELECT current_interest.owner_user_id FROM sales_revision_private.events source_event JOIN public.lead_project_interests current_interest ON current_interest.id=source_event.interest_id WHERE source_event.batch_id=b.id UNION SELECT (source_event.after_sale->>''closing_sales_user_id'')::uuid FROM sales_revision_private.events source_event WHERE source_event.batch_id=b.id) ORDER BY user_id FOR SHARE;
  IF EXISTS(SELECT 1 FROM sales_revision_private.events source_event JOIN public.sales_customers current_customer ON current_customer.id=source_event.customer_id JOIN public.lead_project_interests current_interest ON current_interest.id=source_event.interest_id WHERE source_event.batch_id=b.id AND (current_customer.merged_into_customer_id IS NOT NULL OR current_interest.customer_id IS DISTINCT FROM current_customer.id OR NOT EXISTS(SELECT 1 FROM sales_private.crm_user_roles WHERE user_id=current_customer.owner_user_id AND role=''sales'' AND is_active) OR NOT EXISTS(SELECT 1 FROM sales_private.crm_user_roles WHERE user_id=current_interest.owner_user_id AND role=''sales'' AND is_active) OR NOT EXISTS(SELECT 1 FROM sales_private.crm_user_roles WHERE user_id=(source_event.after_sale->>''closing_sales_user_id'')::uuid AND role=''sales'' AND is_active))) THEN RAISE EXCEPTION ''HISTORICAL_REVISION_OWNER_CHANGED''; END IF;
  RETURN jsonb_build_object(''batchId'',b.id,''records'',jsonb_array_length(p_payload->''records''),''replayed'',true,''bindings'',(SELECT jsonb_agg(jsonb_build_object(''sourceRow'',source_row,''saleId'',sale_id) ORDER BY source_row) FROM sales_revision_private.events WHERE batch_id=b.id));
 END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(p_payload->''records'') ORDER BY value->''binding''->>''plotId'',value->''binding''->>''saleId'' LOOP
  PERFORM sales_import_private.exact_object(r,ARRAY[''sourceRow'',''sourceKey'',''rowSha256'',''operation'',''binding'',''before'',''patch'',''history'']);
  bind:=r->''binding''; old:=r->''before''; patch:=r->''patch''; op:=r->>''operation'';
  PERFORM sales_import_private.exact_object(bind,ARRAY[''saleId'',''customerId'',''interestId'',''plotId'']);
  PERFORM sales_import_private.exact_object(old,ARRAY[''customer'',''interest'',''sale'',''plot'',''inventory'',''details'',''forecast'']);
  PERFORM sales_import_private.exact_object(patch,ARRAY[''bookedDate'',''cancelledDate'',''expectedTransferDate'',''salePriceSatang'',''closingSalesId'']);
  IF jsonb_typeof(r->''history'') IS DISTINCT FROM ''array'' THEN RAISE EXCEPTION ''HISTORICAL_REVISION_INVALID''; END IF;
  IF jsonb_array_length(r->''history'') NOT BETWEEN 1 AND 3 THEN RAISE EXCEPTION ''HISTORICAL_REVISION_INVALID''; END IF;
  FOR entry IN SELECT value FROM jsonb_array_elements(r->''history'') LOOP
   PERFORM sales_import_private.exact_object(entry,ARRAY[''kind'',''date'',''precision'']);
   IF entry->>''kind'' NOT IN (''visited'',''booked'',''cancelled'') OR entry->>''kind'' IS NULL
    OR (((entry->>''precision''=''unknown'' AND entry->''date''=''null''::jsonb) OR
     (entry->>''precision''=''day'' AND jsonb_typeof(entry->''date'')=''string'' AND entry->>''date'' ~ ''^[0-9]{4}-[0-9]{2}-[0-9]{2}$'' AND pg_input_is_valid(entry->>''date'',''date''))) IS DISTINCT FROM true)
   THEN RAISE EXCEPTION ''HISTORICAL_REVISION_INVALID''; END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(r->''history'') x GROUP BY x->>''kind'' HAVING count(*)>1)
   OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r->''history'') x WHERE x->>''kind''=''booked'' AND x->''date''=patch->''bookedDate'')
   OR (op=''cancel'' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r->''history'') x WHERE x->>''kind''=''cancelled'' AND x->''date''=patch->''cancelledDate''))
   OR (op=''create_booking'' AND EXISTS(SELECT 1 FROM jsonb_array_elements(r->''history'') x WHERE x->>''kind''=''cancelled''))
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(r->''history'') x WHERE x->>''kind''=''visited'' AND (x->>''date'')::date>(patch->>''bookedDate'')::date)
  THEN RAISE EXCEPTION ''HISTORICAL_REVISION_INVALID''; END IF;
  IF jsonb_typeof(r->''sourceRow'')<>''number'' OR (r->>''sourceRow'' ~ ''^[0-9]+$'') IS DISTINCT FROM true
   OR jsonb_typeof(r->''sourceKey'') IS DISTINCT FROM ''string'' OR jsonb_typeof(r->''rowSha256'') IS DISTINCT FROM ''string''
   OR (r->>''sourceKey'' ~ ''^[a-f0-9]{64}$'') IS DISTINCT FROM true OR (r->>''rowSha256'' ~ ''^[a-f0-9]{64}$'') IS DISTINCT FROM true
   OR op NOT IN (''cancel'',''create_booking'') OR op IS NULL
   OR jsonb_typeof(bind->''plotId'') IS DISTINCT FROM ''string'' OR length(bind->>''plotId'') NOT BETWEEN 1 AND 200
  THEN RAISE EXCEPTION ''HISTORICAL_REVISION_INVALID''; END IF;
  PERFORM sales_private.crm_booking_uuid(bind->''saleId'',op=''create_booking''); PERFORM sales_private.crm_booking_uuid(bind->''customerId''); PERFORM sales_private.crm_booking_uuid(bind->''interestId'');
  IF op=''create_booking'' AND bind->''saleId'' IS DISTINCT FROM ''null''::jsonb THEN RAISE EXCEPTION ''HISTORICAL_REVISION_INVALID''; END IF;
  PERFORM sales_private.crm_booking_uuid(patch->''closingSalesId'');
  FOR day IN SELECT value#>>''{}'' FROM jsonb_each(patch) WHERE key IN (''bookedDate'',''cancelledDate'',''expectedTransferDate'') LOOP
   IF day IS NOT NULL AND (day !~ ''^[0-9]{4}-[0-9]{2}-[0-9]{2}$'' OR NOT pg_input_is_valid(day,''date'') OR day::date NOT BETWEEN DATE ''0001-01-01'' AND DATE ''9999-12-31'') THEN RAISE EXCEPTION ''HISTORICAL_REVISION_INVALID''; END IF;
  END LOOP;
  IF jsonb_typeof(patch->''salePriceSatang'') NOT IN (''number'',''null'') OR (patch->''salePriceSatang''<>''null''::jsonb AND ((patch->>''salePriceSatang'' ~ ''^[1-9][0-9]{0,10}$'') IS DISTINCT FROM true OR (patch->>''salePriceSatang'')::numeric>99999999999)) THEN RAISE EXCEPTION ''HISTORICAL_REVISION_INVALID''; END IF;
  SELECT * INTO c FROM public.sales_customers WHERE id=(bind->>''customerId'')::uuid FOR UPDATE;
  SELECT * INTO i FROM public.lead_project_interests WHERE id=(bind->>''interestId'')::uuid FOR UPDATE;
  SELECT * INTO s FROM public.sales WHERE id=(bind->>''saleId'')::uuid FOR UPDATE;
  SELECT * INTO p FROM public.plots WHERE id=bind->>''plotId'' FOR UPDATE;
  SELECT * INTO dc FROM sales_private.deal_details_corrections WHERE sale_id=(bind->>''saleId'')::uuid FOR UPDATE;
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id),''[]''::jsonb) INTO inventory FROM public.sales x WHERE x.plot_id=p.id;
  IF c.id IS NULL OR i.id IS NULL OR p.id IS NULL OR c.merged_into_customer_id IS NOT NULL OR c.record_origin<>''legacy_import''
   OR i.customer_id IS DISTINCT FROM c.id OR p.project_name IS DISTINCT FROM i.project_name
   OR NOT EXISTS(SELECT 1 FROM public.projects WHERE name=i.project_name AND is_closed IS DISTINCT FROM true)
   OR to_jsonb(c) IS DISTINCT FROM old->''customer'' OR to_jsonb(i) IS DISTINCT FROM old->''interest'' OR to_jsonb(p) IS DISTINCT FROM old->''plot''
   OR (CASE WHEN s.id IS NULL THEN ''null''::jsonb ELSE to_jsonb(s) END) IS DISTINCT FROM old->''sale'' OR inventory IS DISTINCT FROM old->''inventory''
   OR (CASE WHEN dc.sale_id IS NULL THEN ''null''::jsonb ELSE to_jsonb(dc) END) IS DISTINCT FROM old->''details''
   OR coalesce((SELECT to_jsonb(f) FROM sales_import_private.forecast_corrections f WHERE sale_id=(bind->>''saleId'')::uuid),''null'') IS DISTINCT FROM old->''forecast''
  THEN RAISE EXCEPTION ''HISTORICAL_REVISION_STALE''; END IF;
  PERFORM 1 FROM sales_private.crm_user_roles WHERE user_id IN(c.owner_user_id,i.owner_user_id,(patch->>''closingSalesId'')::uuid) ORDER BY user_id FOR SHARE;
  IF EXISTS(SELECT 1 FROM unnest(ARRAY[c.owner_user_id,i.owner_user_id,(patch->>''closingSalesId'')::uuid]) u WHERE NOT EXISTS(SELECT 1 FROM sales_private.crm_user_roles WHERE user_id=u AND role=''sales'' AND is_active)) THEN RAISE EXCEPTION ''HISTORICAL_REVISION_OWNER_CHANGED''; END IF;
  e.id:=gen_random_uuid(); e.batch_id:=b.id; e.source_row:=(r->>''sourceRow'')::integer; e.source_key:=r->>''sourceKey'';e.row_sha256:=r->>''rowSha256'';e.operation:=op;
  e.sale_id:=CASE WHEN op=''create_booking'' THEN gen_random_uuid() ELSE (bind->>''saleId'')::uuid END;e.customer_id:=c.id;e.interest_id:=i.id;e.plot_id:=p.id;
  e.booked_day:=(patch->>''bookedDate'')::date;e.cancelled_day:=(patch->>''cancelledDate'')::date;e.expected_transfer_day:=(patch->>''expectedTransferDate'')::date;
  e.before_sale:=CASE WHEN s.id IS NULL THEN NULL ELSE to_jsonb(s) END;
  e.source_history:=r->''history'';
  IF op=''cancel'' THEN
   IF patch->''expectedTransferDate'' IS DISTINCT FROM ''null''::jsonb THEN RAISE EXCEPTION ''HISTORICAL_REVISION_FORECAST_REVIEW_REQUIRED''; END IF;
   IF s.id IS NULL OR s.project_interest_id IS DISTINCT FROM i.id OR s.plot_id IS DISTINCT FROM p.id OR s.crm_stage IS DISTINCT FROM ''booked''
    OR s.booked_at IS NOT NULL OR s.contracted_at IS NOT NULL OR s.cancelled_at IS NOT NULL
    OR s.transferred_at IS NOT NULL OR s.crm_handover_at IS NOT NULL OR s.crm_transfer_date IS NOT NULL OR s.crm_handover_date IS NOT NULL
    OR s.historical_revision_id IS NOT NULL OR s.closing_sales_user_id IS DISTINCT FROM (patch->>''closingSalesId'')::uuid
    OR EXISTS(SELECT 1 FROM public.loan_attempts WHERE sale_id=s.id)
    OR EXISTS(SELECT 1 FROM sales_private.post_booking_events WHERE sale_id=s.id)
   THEN RAISE EXCEPTION ''HISTORICAL_REVISION_OPERATIONAL_HISTORY''; END IF;
   history:=sales_private.crm_booking_imported_history(to_jsonb(s));
   IF history IS NULL OR history->''sourceRow'' IS DISTINCT FROM r->''sourceRow'' OR history->>''bookedDate'' IS DISTINCT FROM patch->>''bookedDate'' OR e.cancelled_day IS NULL THEN RAISE EXCEPTION ''HISTORICAL_REVISION_PROVENANCE''; END IF;
   ns:=s; ns.crm_stage:=''cancelled''; ns.contract_status:=''Cancelled'';ns.historical_revision_id:=e.id;ns.booking_revision:=gen_random_uuid();
   -- This is the actual write timestamp, not an invented historical event day.
   -- Set it in the UPDATE itself so earlier sealed BEFORE triggers observe the
   -- same complete NEW row that the unchanged later updater will produce.
   ns.updated_at:=transaction_timestamp();
  ELSE
   IF s.id IS NOT NULL OR old->''sale''<>''null''::jsonb OR dc.sale_id IS NOT NULL OR old->''forecast''<>''null''::jsonb
    OR e.cancelled_day IS NOT NULL OR patch->''salePriceSatang''=''null''::jsonb
    OR EXISTS(SELECT 1 FROM public.sales x WHERE x.plot_id=p.id AND coalesce(x.crm_stage,lower(x.contract_status),''unknown'')<>''cancelled'')
    OR coalesce(p.has_customer,false) OR lower(btrim(coalesce(p.sale_status,''''))) NOT IN ('''',''active'',''normal'',''ready_for_sale'',''available'',''vacant'')
   THEN RAISE EXCEPTION ''HISTORICAL_REVISION_OCCUPIED''; END IF;
   ns:=NULL;ns.id:=e.sale_id;ns.project_interest_id:=i.id;ns.plot_id:=p.id;ns.crm_stage:=''booked'';ns.contract_status:=''Reserved'';
   ns.booking_route:=''legacy_import'';ns.booking_route_reason:=''Reviewed historical booking: ''||e.source_key;ns.booking_revision:=gen_random_uuid();
   ns.historical_import_id:=e.id;ns.sale_price:=(patch->>''salePriceSatang'')::numeric/100;ns.expected_transfer_date:=e.expected_transfer_day;
   ns.closing_sales_user_id:=(patch->>''closingSalesId'')::uuid;
  END IF;
  e.after_sale:=to_jsonb(ns);
  INSERT INTO sales_revision_private.events SELECT e.*;
  INSERT INTO sales_revision_private.permits VALUES(txid_current(),pg_backend_pid(),actor,e.id,op,e.before_sale,e.after_sale);
  INSERT INTO sales_revision_private.plot_permits VALUES(txid_current(),pg_backend_pid(),actor,e.id,
   to_jsonb(p),to_jsonb(p)||jsonb_build_object(''has_customer'',op=''create_booking''),
   (SELECT jsonb_agg(value ORDER BY value->>''id'') FROM (
    SELECT value FROM jsonb_array_elements(inventory) WHERE value->>''id''<>e.sale_id::text
    UNION ALL SELECT e.after_sale) expected));
  INSERT INTO sales_private.booking_write_permits VALUES(txid_current(),pg_backend_pid());
  IF op=''cancel'' THEN UPDATE public.sales SET crm_stage=ns.crm_stage,contract_status=ns.contract_status,historical_revision_id=ns.historical_revision_id,booking_revision=ns.booking_revision,updated_at=ns.updated_at WHERE id=ns.id;
  ELSE INSERT INTO public.sales SELECT ns.*; END IF;
  DELETE FROM sales_private.booking_write_permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid();
  DELETE FROM sales_revision_private.permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid();
  IF patch->''salePriceSatang''<>''null''::jsonb AND op=''cancel'' THEN
   price:=(patch->>''salePriceSatang'')::numeric/100;
   ndc:=dc;ndc.sale_id:=s.id;ndc.sale_price:=price;ndc.bank_name:=CASE WHEN dc.sale_id IS NULL THEN NULLIF(sales_private.crm_customer_deal_details_trim(s.bank_name),'''') ELSE dc.bank_name END;
   ndc.revision:=gen_random_uuid();ndc.actor_user_id:=actor;ndc.reason:=''Reviewed historical cancellation: ''||b.dataset_key;ndc.recorded_at:=clock_timestamp();
   INSERT INTO sales_private.customer_deal_details_permits VALUES(txid_current(),pg_backend_pid(),actor,''deal'',s.id,CASE WHEN dc.sale_id IS NULL THEN NULL ELSE to_jsonb(dc) END,to_jsonb(ndc));
   IF dc.sale_id IS NULL THEN INSERT INTO sales_private.deal_details_corrections SELECT ndc.*;
   ELSE UPDATE sales_private.deal_details_corrections SET sale_price=ndc.sale_price,bank_name=ndc.bank_name,revision=ndc.revision,actor_user_id=ndc.actor_user_id,reason=ndc.reason,recorded_at=ndc.recorded_at WHERE sale_id=ndc.sale_id; END IF;
   DELETE FROM sales_private.customer_deal_details_permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid();
  END IF;
  -- Cancellation may release only its own occupied record; conflicting/transferred ownership never becomes stock.
  IF op=''cancel'' AND EXISTS(SELECT 1 FROM public.sales x WHERE x.plot_id=p.id AND x.id<>s.id AND coalesce(x.crm_stage,lower(x.contract_status),''unknown'')<>''cancelled'') THEN RAISE EXCEPTION ''HISTORICAL_REVISION_OCCUPIED''; END IF;
  -- The unchanged legacy sync must produce the exact complete predicted plot.
  -- Preserve construction sale_status and every other field rather than replacing
  -- ready_for_sale/active with reserved/available during a historical import.
  IF (SELECT to_jsonb(x) FROM public.sales x WHERE id=e.sale_id) IS DISTINCT FROM e.after_sale
   OR (SELECT to_jsonb(x) FROM public.plots x WHERE id=p.id) IS DISTINCT FROM
   (to_jsonb(p)||jsonb_build_object(''has_customer'',op=''create_booking''))
   THEN RAISE EXCEPTION ''HISTORICAL_REVISION_STOCK_SYNC_REQUIRED''; END IF;
  DELETE FROM sales_revision_private.plot_permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid() AND event_id=e.id;
  total:=total+1;
 END LOOP;
 RETURN jsonb_build_object(''batchId'',b.id,''records'',total,''replayed'',false,''bindings'',(SELECT jsonb_agg(jsonb_build_object(''sourceRow'',source_row,''saleId'',sale_id) ORDER BY source_row) FROM sales_revision_private.events WHERE batch_id=b.id));
END;
' OR md5(body) IS DISTINCT FROM '4c49834fb7e8a0961ead37e31c450e9a'
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='sales_revision_private.apply(jsonb)'::regprocedure AND pg_get_userbyid(proowner)=current_user AND prosecdef=false AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog','TimeZone=UTC']::text[])
  OR (length(definition)-length(replace(definition,body,'')))/length(body)<>1
 THEN RAISE EXCEPTION 'CUSTOMER_OPERATOR_EXACT_ADAPTER_REVIEW_REQUIRED'; END IF;
 EXECUTE replace(definition,body,'
DECLARE actor uuid:=sales_operator_private.actor(); b sales_revision_private.batches%ROWTYPE; inserted uuid;
 r jsonb; bind jsonb; old jsonb; patch jsonb; c public.sales_customers%ROWTYPE; i public.lead_project_interests%ROWTYPE;
 s public.sales%ROWTYPE; ns public.sales%ROWTYPE; p public.plots%ROWTYPE; e sales_revision_private.events%ROWTYPE;
 dc sales_private.deal_details_corrections%ROWTYPE; ndc sales_private.deal_details_corrections%ROWTYPE;
 inventory jsonb; price numeric; day text; history jsonb; entry jsonb; op text; total integer:=0;
BEGIN
 PERFORM sales_operator_private.authorize_payload(''lifecycle'',p_payload);
 IF actor IS NULL OR current_user IS DISTINCT FROM (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid=''sales_revision_private.batches''::regclass) THEN RAISE EXCEPTION ''HISTORICAL_REVISION_FORBIDDEN''; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(''crm-booking-command'',0));
 PERFORM 1 FROM sales_private.crm_user_roles WHERE user_id=actor AND role=''admin'' AND is_active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION ''HISTORICAL_REVISION_FORBIDDEN''; END IF;
 PERFORM sales_revision_private.assert_stock_catalog();
 PERFORM sales_import_private.exact_object(p_payload,ARRAY[''version'',''datasetKey'',''sourceSha256'',''reviewSha256'',''records'',''leadReplayAllowed'']);
 IF p_payload->>''version'' IS DISTINCT FROM ''reviewed-historical-sale-revision-v1''
  OR p_payload->''leadReplayAllowed'' IS DISTINCT FROM ''false''::jsonb
  OR jsonb_typeof(p_payload->''datasetKey'') IS DISTINCT FROM ''string'' OR length(p_payload->>''datasetKey'') NOT BETWEEN 1 AND 200
  OR p_payload->>''datasetKey''<>btrim(p_payload->>''datasetKey'') OR p_payload->>''datasetKey'' ~ ''[[:cntrl:]]''
  OR jsonb_typeof(p_payload->''sourceSha256'') IS DISTINCT FROM ''string'' OR jsonb_typeof(p_payload->''reviewSha256'') IS DISTINCT FROM ''string''
  OR (p_payload->>''sourceSha256'' ~ ''^[a-f0-9]{64}$'') IS DISTINCT FROM true OR (p_payload->>''reviewSha256'' ~ ''^[a-f0-9]{64}$'') IS DISTINCT FROM true
  OR jsonb_typeof(p_payload->''records'') IS DISTINCT FROM ''array'' OR octet_length(p_payload::text)>8388608
 THEN RAISE EXCEPTION ''HISTORICAL_REVISION_INVALID''; END IF;
 IF jsonb_array_length(p_payload->''records'') NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION ''HISTORICAL_REVISION_INVALID''; END IF;
 -- Full-table inventory lock also protects against unlinked legacy writers which do not take the advisory lock.
 LOCK TABLE public.plots,public.sales IN SHARE ROW EXCLUSIVE MODE;
 INSERT INTO sales_revision_private.batches(dataset_key,payload,reviewer_id) VALUES(p_payload->>''datasetKey'',p_payload,actor)
 ON CONFLICT(dataset_key) DO NOTHING RETURNING id INTO inserted;
 SELECT * INTO STRICT b FROM sales_revision_private.batches WHERE dataset_key=p_payload->>''datasetKey'' FOR UPDATE;
 IF b.payload IS DISTINCT FROM p_payload THEN RAISE EXCEPTION ''HISTORICAL_REVISION_REPLAY_CONFLICT''; END IF;
 IF inserted IS NULL THEN
  PERFORM 1 FROM sales_private.crm_user_roles WHERE user_id IN(SELECT current_customer.owner_user_id FROM sales_revision_private.events source_event JOIN public.sales_customers current_customer ON current_customer.id=source_event.customer_id WHERE source_event.batch_id=b.id UNION SELECT current_interest.owner_user_id FROM sales_revision_private.events source_event JOIN public.lead_project_interests current_interest ON current_interest.id=source_event.interest_id WHERE source_event.batch_id=b.id UNION SELECT (source_event.after_sale->>''closing_sales_user_id'')::uuid FROM sales_revision_private.events source_event WHERE source_event.batch_id=b.id) ORDER BY user_id FOR SHARE;
  IF EXISTS(SELECT 1 FROM sales_revision_private.events source_event JOIN public.sales_customers current_customer ON current_customer.id=source_event.customer_id JOIN public.lead_project_interests current_interest ON current_interest.id=source_event.interest_id WHERE source_event.batch_id=b.id AND (current_customer.merged_into_customer_id IS NOT NULL OR current_interest.customer_id IS DISTINCT FROM current_customer.id OR NOT EXISTS(SELECT 1 FROM sales_private.crm_user_roles WHERE user_id=current_customer.owner_user_id AND role=''sales'' AND is_active) OR NOT EXISTS(SELECT 1 FROM sales_private.crm_user_roles WHERE user_id=current_interest.owner_user_id AND role=''sales'' AND is_active) OR NOT EXISTS(SELECT 1 FROM sales_private.crm_user_roles WHERE user_id=(source_event.after_sale->>''closing_sales_user_id'')::uuid AND role=''sales'' AND is_active))) THEN RAISE EXCEPTION ''HISTORICAL_REVISION_OWNER_CHANGED''; END IF;
  RETURN jsonb_build_object(''batchId'',b.id,''records'',jsonb_array_length(p_payload->''records''),''replayed'',true,''bindings'',(SELECT jsonb_agg(jsonb_build_object(''sourceRow'',source_row,''saleId'',sale_id) ORDER BY source_row) FROM sales_revision_private.events WHERE batch_id=b.id));
 END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(p_payload->''records'') ORDER BY value->''binding''->>''plotId'',value->''binding''->>''saleId'' LOOP
  PERFORM sales_import_private.exact_object(r,ARRAY[''sourceRow'',''sourceKey'',''rowSha256'',''operation'',''binding'',''before'',''patch'',''history'']);
  bind:=r->''binding''; old:=r->''before''; patch:=r->''patch''; op:=r->>''operation'';
  PERFORM sales_import_private.exact_object(bind,ARRAY[''saleId'',''customerId'',''interestId'',''plotId'']);
  PERFORM sales_import_private.exact_object(old,ARRAY[''customer'',''interest'',''sale'',''plot'',''inventory'',''details'',''forecast'']);
  PERFORM sales_import_private.exact_object(patch,ARRAY[''bookedDate'',''cancelledDate'',''expectedTransferDate'',''salePriceSatang'',''closingSalesId'']);
  IF jsonb_typeof(r->''history'') IS DISTINCT FROM ''array'' THEN RAISE EXCEPTION ''HISTORICAL_REVISION_INVALID''; END IF;
  IF jsonb_array_length(r->''history'') NOT BETWEEN 1 AND 3 THEN RAISE EXCEPTION ''HISTORICAL_REVISION_INVALID''; END IF;
  FOR entry IN SELECT value FROM jsonb_array_elements(r->''history'') LOOP
   PERFORM sales_import_private.exact_object(entry,ARRAY[''kind'',''date'',''precision'']);
   IF entry->>''kind'' NOT IN (''visited'',''booked'',''cancelled'') OR entry->>''kind'' IS NULL
    OR (((entry->>''precision''=''unknown'' AND entry->''date''=''null''::jsonb) OR
     (entry->>''precision''=''day'' AND jsonb_typeof(entry->''date'')=''string'' AND entry->>''date'' ~ ''^[0-9]{4}-[0-9]{2}-[0-9]{2}$'' AND pg_input_is_valid(entry->>''date'',''date''))) IS DISTINCT FROM true)
   THEN RAISE EXCEPTION ''HISTORICAL_REVISION_INVALID''; END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(r->''history'') x GROUP BY x->>''kind'' HAVING count(*)>1)
   OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r->''history'') x WHERE x->>''kind''=''booked'' AND x->''date''=patch->''bookedDate'')
   OR (op=''cancel'' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r->''history'') x WHERE x->>''kind''=''cancelled'' AND x->''date''=patch->''cancelledDate''))
   OR (op=''create_booking'' AND EXISTS(SELECT 1 FROM jsonb_array_elements(r->''history'') x WHERE x->>''kind''=''cancelled''))
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(r->''history'') x WHERE x->>''kind''=''visited'' AND (x->>''date'')::date>(patch->>''bookedDate'')::date)
  THEN RAISE EXCEPTION ''HISTORICAL_REVISION_INVALID''; END IF;
  IF jsonb_typeof(r->''sourceRow'')<>''number'' OR (r->>''sourceRow'' ~ ''^[0-9]+$'') IS DISTINCT FROM true
   OR jsonb_typeof(r->''sourceKey'') IS DISTINCT FROM ''string'' OR jsonb_typeof(r->''rowSha256'') IS DISTINCT FROM ''string''
   OR (r->>''sourceKey'' ~ ''^[a-f0-9]{64}$'') IS DISTINCT FROM true OR (r->>''rowSha256'' ~ ''^[a-f0-9]{64}$'') IS DISTINCT FROM true
   OR op NOT IN (''cancel'',''create_booking'') OR op IS NULL
   OR jsonb_typeof(bind->''plotId'') IS DISTINCT FROM ''string'' OR length(bind->>''plotId'') NOT BETWEEN 1 AND 200
  THEN RAISE EXCEPTION ''HISTORICAL_REVISION_INVALID''; END IF;
  PERFORM sales_private.crm_booking_uuid(bind->''saleId'',op=''create_booking''); PERFORM sales_private.crm_booking_uuid(bind->''customerId''); PERFORM sales_private.crm_booking_uuid(bind->''interestId'');
  IF op=''create_booking'' AND bind->''saleId'' IS DISTINCT FROM ''null''::jsonb THEN RAISE EXCEPTION ''HISTORICAL_REVISION_INVALID''; END IF;
  PERFORM sales_private.crm_booking_uuid(patch->''closingSalesId'');
  FOR day IN SELECT value#>>''{}'' FROM jsonb_each(patch) WHERE key IN (''bookedDate'',''cancelledDate'',''expectedTransferDate'') LOOP
   IF day IS NOT NULL AND (day !~ ''^[0-9]{4}-[0-9]{2}-[0-9]{2}$'' OR NOT pg_input_is_valid(day,''date'') OR day::date NOT BETWEEN DATE ''0001-01-01'' AND DATE ''9999-12-31'') THEN RAISE EXCEPTION ''HISTORICAL_REVISION_INVALID''; END IF;
  END LOOP;
  IF jsonb_typeof(patch->''salePriceSatang'') NOT IN (''number'',''null'') OR (patch->''salePriceSatang''<>''null''::jsonb AND ((patch->>''salePriceSatang'' ~ ''^[1-9][0-9]{0,10}$'') IS DISTINCT FROM true OR (patch->>''salePriceSatang'')::numeric>99999999999)) THEN RAISE EXCEPTION ''HISTORICAL_REVISION_INVALID''; END IF;
  SELECT * INTO c FROM public.sales_customers WHERE id=(bind->>''customerId'')::uuid FOR UPDATE;
  SELECT * INTO i FROM public.lead_project_interests WHERE id=(bind->>''interestId'')::uuid FOR UPDATE;
  SELECT * INTO s FROM public.sales WHERE id=(bind->>''saleId'')::uuid FOR UPDATE;
  SELECT * INTO p FROM public.plots WHERE id=bind->>''plotId'' FOR UPDATE;
  SELECT * INTO dc FROM sales_private.deal_details_corrections WHERE sale_id=(bind->>''saleId'')::uuid FOR UPDATE;
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id),''[]''::jsonb) INTO inventory FROM public.sales x WHERE x.plot_id=p.id;
  IF c.id IS NULL OR i.id IS NULL OR p.id IS NULL OR c.merged_into_customer_id IS NOT NULL OR c.record_origin<>''legacy_import''
   OR i.customer_id IS DISTINCT FROM c.id OR p.project_name IS DISTINCT FROM i.project_name
   OR NOT EXISTS(SELECT 1 FROM public.projects WHERE name=i.project_name AND is_closed IS DISTINCT FROM true)
   OR to_jsonb(c) IS DISTINCT FROM old->''customer'' OR to_jsonb(i) IS DISTINCT FROM old->''interest'' OR to_jsonb(p) IS DISTINCT FROM old->''plot''
   OR (CASE WHEN s.id IS NULL THEN ''null''::jsonb ELSE to_jsonb(s) END) IS DISTINCT FROM old->''sale'' OR inventory IS DISTINCT FROM old->''inventory''
   OR (CASE WHEN dc.sale_id IS NULL THEN ''null''::jsonb ELSE to_jsonb(dc) END) IS DISTINCT FROM old->''details''
   OR coalesce((SELECT to_jsonb(f) FROM sales_import_private.forecast_corrections f WHERE sale_id=(bind->>''saleId'')::uuid),''null'') IS DISTINCT FROM old->''forecast''
  THEN RAISE EXCEPTION ''HISTORICAL_REVISION_STALE''; END IF;
  PERFORM 1 FROM sales_private.crm_user_roles WHERE user_id IN(c.owner_user_id,i.owner_user_id,(patch->>''closingSalesId'')::uuid) ORDER BY user_id FOR SHARE;
  IF EXISTS(SELECT 1 FROM unnest(ARRAY[c.owner_user_id,i.owner_user_id,(patch->>''closingSalesId'')::uuid]) u WHERE NOT EXISTS(SELECT 1 FROM sales_private.crm_user_roles WHERE user_id=u AND role=''sales'' AND is_active)) THEN RAISE EXCEPTION ''HISTORICAL_REVISION_OWNER_CHANGED''; END IF;
  e.id:=gen_random_uuid(); e.batch_id:=b.id; e.source_row:=(r->>''sourceRow'')::integer; e.source_key:=r->>''sourceKey'';e.row_sha256:=r->>''rowSha256'';e.operation:=op;
  e.sale_id:=CASE WHEN op=''create_booking'' THEN gen_random_uuid() ELSE (bind->>''saleId'')::uuid END;e.customer_id:=c.id;e.interest_id:=i.id;e.plot_id:=p.id;
  e.booked_day:=(patch->>''bookedDate'')::date;e.cancelled_day:=(patch->>''cancelledDate'')::date;e.expected_transfer_day:=(patch->>''expectedTransferDate'')::date;
  e.before_sale:=CASE WHEN s.id IS NULL THEN NULL ELSE to_jsonb(s) END;
  e.source_history:=r->''history'';
  IF op=''cancel'' THEN
   IF patch->''expectedTransferDate'' IS DISTINCT FROM ''null''::jsonb THEN RAISE EXCEPTION ''HISTORICAL_REVISION_FORECAST_REVIEW_REQUIRED''; END IF;
   IF s.id IS NULL OR s.project_interest_id IS DISTINCT FROM i.id OR s.plot_id IS DISTINCT FROM p.id OR s.crm_stage IS DISTINCT FROM ''booked''
    OR s.booked_at IS NOT NULL OR s.contracted_at IS NOT NULL OR s.cancelled_at IS NOT NULL
    OR s.transferred_at IS NOT NULL OR s.crm_handover_at IS NOT NULL OR s.crm_transfer_date IS NOT NULL OR s.crm_handover_date IS NOT NULL
    OR s.historical_revision_id IS NOT NULL OR s.closing_sales_user_id IS DISTINCT FROM (patch->>''closingSalesId'')::uuid
    OR EXISTS(SELECT 1 FROM public.loan_attempts WHERE sale_id=s.id)
    OR EXISTS(SELECT 1 FROM sales_private.post_booking_events WHERE sale_id=s.id)
   THEN RAISE EXCEPTION ''HISTORICAL_REVISION_OPERATIONAL_HISTORY''; END IF;
   history:=sales_private.crm_booking_imported_history(to_jsonb(s));
   IF history IS NULL OR history->''sourceRow'' IS DISTINCT FROM r->''sourceRow'' OR history->>''bookedDate'' IS DISTINCT FROM patch->>''bookedDate'' OR e.cancelled_day IS NULL THEN RAISE EXCEPTION ''HISTORICAL_REVISION_PROVENANCE''; END IF;
   ns:=s; ns.crm_stage:=''cancelled''; ns.contract_status:=''Cancelled'';ns.historical_revision_id:=e.id;ns.booking_revision:=gen_random_uuid();
   -- This is the actual write timestamp, not an invented historical event day.
   -- Set it in the UPDATE itself so earlier sealed BEFORE triggers observe the
   -- same complete NEW row that the unchanged later updater will produce.
   ns.updated_at:=transaction_timestamp();
  ELSE
   IF s.id IS NOT NULL OR old->''sale''<>''null''::jsonb OR dc.sale_id IS NOT NULL OR old->''forecast''<>''null''::jsonb
    OR e.cancelled_day IS NOT NULL OR patch->''salePriceSatang''=''null''::jsonb
    OR EXISTS(SELECT 1 FROM public.sales x WHERE x.plot_id=p.id AND coalesce(x.crm_stage,lower(x.contract_status),''unknown'')<>''cancelled'')
    OR coalesce(p.has_customer,false) OR lower(btrim(coalesce(p.sale_status,''''))) NOT IN ('''',''active'',''normal'',''ready_for_sale'',''available'',''vacant'')
   THEN RAISE EXCEPTION ''HISTORICAL_REVISION_OCCUPIED''; END IF;
   ns:=NULL;ns.id:=e.sale_id;ns.project_interest_id:=i.id;ns.plot_id:=p.id;ns.crm_stage:=''booked'';ns.contract_status:=''Reserved'';
   ns.booking_route:=''legacy_import'';ns.booking_route_reason:=''Reviewed historical booking: ''||e.source_key;ns.booking_revision:=gen_random_uuid();
   ns.historical_import_id:=e.id;ns.sale_price:=(patch->>''salePriceSatang'')::numeric/100;ns.expected_transfer_date:=e.expected_transfer_day;
   ns.closing_sales_user_id:=(patch->>''closingSalesId'')::uuid;
  END IF;
  e.after_sale:=to_jsonb(ns);
  INSERT INTO sales_revision_private.events SELECT e.*;
  INSERT INTO sales_revision_private.permits VALUES(txid_current(),pg_backend_pid(),actor,e.id,op,e.before_sale,e.after_sale);
  INSERT INTO sales_revision_private.plot_permits VALUES(txid_current(),pg_backend_pid(),actor,e.id,
   to_jsonb(p),to_jsonb(p)||jsonb_build_object(''has_customer'',op=''create_booking''),
   (SELECT jsonb_agg(value ORDER BY value->>''id'') FROM (
    SELECT value FROM jsonb_array_elements(inventory) WHERE value->>''id''<>e.sale_id::text
    UNION ALL SELECT e.after_sale) expected));
  INSERT INTO sales_private.booking_write_permits VALUES(txid_current(),pg_backend_pid());
  IF op=''cancel'' THEN UPDATE public.sales SET crm_stage=ns.crm_stage,contract_status=ns.contract_status,historical_revision_id=ns.historical_revision_id,booking_revision=ns.booking_revision,updated_at=ns.updated_at WHERE id=ns.id;
  ELSE INSERT INTO public.sales SELECT ns.*; END IF;
  DELETE FROM sales_private.booking_write_permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid();
  DELETE FROM sales_revision_private.permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid();
  IF patch->''salePriceSatang''<>''null''::jsonb AND op=''cancel'' THEN
   price:=(patch->>''salePriceSatang'')::numeric/100;
   ndc:=dc;ndc.sale_id:=s.id;ndc.sale_price:=price;ndc.bank_name:=CASE WHEN dc.sale_id IS NULL THEN NULLIF(sales_private.crm_customer_deal_details_trim(s.bank_name),'''') ELSE dc.bank_name END;
   ndc.revision:=gen_random_uuid();ndc.actor_user_id:=actor;ndc.reason:=''Reviewed historical cancellation: ''||b.dataset_key;ndc.recorded_at:=clock_timestamp();
   INSERT INTO sales_private.customer_deal_details_permits VALUES(txid_current(),pg_backend_pid(),actor,''deal'',s.id,CASE WHEN dc.sale_id IS NULL THEN NULL ELSE to_jsonb(dc) END,to_jsonb(ndc));
   IF dc.sale_id IS NULL THEN INSERT INTO sales_private.deal_details_corrections SELECT ndc.*;
   ELSE UPDATE sales_private.deal_details_corrections SET sale_price=ndc.sale_price,bank_name=ndc.bank_name,revision=ndc.revision,actor_user_id=ndc.actor_user_id,reason=ndc.reason,recorded_at=ndc.recorded_at WHERE sale_id=ndc.sale_id; END IF;
   DELETE FROM sales_private.customer_deal_details_permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid();
  END IF;
  -- Cancellation may release only its own occupied record; conflicting/transferred ownership never becomes stock.
  IF op=''cancel'' AND EXISTS(SELECT 1 FROM public.sales x WHERE x.plot_id=p.id AND x.id<>s.id AND coalesce(x.crm_stage,lower(x.contract_status),''unknown'')<>''cancelled'') THEN RAISE EXCEPTION ''HISTORICAL_REVISION_OCCUPIED''; END IF;
  -- The unchanged legacy sync must produce the exact complete predicted plot.
  -- Preserve construction sale_status and every other field rather than replacing
  -- ready_for_sale/active with reserved/available during a historical import.
  IF (SELECT to_jsonb(x) FROM public.sales x WHERE id=e.sale_id) IS DISTINCT FROM e.after_sale
   OR (SELECT to_jsonb(x) FROM public.plots x WHERE id=p.id) IS DISTINCT FROM
   (to_jsonb(p)||jsonb_build_object(''has_customer'',op=''create_booking''))
   THEN RAISE EXCEPTION ''HISTORICAL_REVISION_STOCK_SYNC_REQUIRED''; END IF;
  DELETE FROM sales_revision_private.plot_permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid() AND event_id=e.id;
  total:=total+1;
 END LOOP;
 RETURN jsonb_build_object(''batchId'',b.id,''records'',total,''replayed'',false,''bindings'',(SELECT jsonb_agg(jsonb_build_object(''sourceRow'',source_row,''saleId'',sale_id) ORDER BY source_row) FROM sales_revision_private.events WHERE batch_id=b.id));
END;
');
 INSERT INTO sales_operator_private.adapters VALUES('sales_revision_private.apply(jsonb)','4c49834fb7e8a0961ead37e31c450e9a','6f5ec1507ed29a7db569e785b6b23ecb',ARRAY['search_path=pg_catalog','TimeZone=UTC']::text[],false);
END;
$operator_adapter_23$;
DO $operator_adapter_24$
DECLARE definition text;body text;
BEGIN
 PERFORM sales_operator_private.require_owner();
 SELECT replace(pg_get_functiondef(oid),E'\r\n',E'\n'),replace(prosrc,E'\r\n',E'\n') INTO definition,body FROM pg_proc WHERE oid='sales_revision_private.operator_insert()'::regprocedure;
 IF body IS DISTINCT FROM '
BEGIN
 IF current_user IS DISTINCT FROM (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid=TG_RELID)
  OR auth.uid() IS NULL OR public.crm_v2_role() IS DISTINCT FROM ''admin'' THEN RAISE EXCEPTION ''HISTORICAL_REVISION_FORBIDDEN''; END IF;
 RETURN NEW;
END; ' OR md5(body) IS DISTINCT FROM '5c51ce5e449f7344c30e94e3f807d5bb'
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='sales_revision_private.operator_insert()'::regprocedure AND pg_get_userbyid(proowner)=current_user AND prosecdef=false AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[])
  OR (length(definition)-length(replace(definition,body,'')))/length(body)<>1
 THEN RAISE EXCEPTION 'CUSTOMER_OPERATOR_EXACT_ADAPTER_REVIEW_REQUIRED'; END IF;
 EXECUTE replace(definition,body,'
BEGIN
 IF current_user IS DISTINCT FROM (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid=TG_RELID)
  OR sales_operator_private.actor() IS NULL OR sales_operator_private.operator_role() IS DISTINCT FROM ''admin'' THEN RAISE EXCEPTION ''HISTORICAL_REVISION_FORBIDDEN''; END IF;
 RETURN NEW;
END; ');
 INSERT INTO sales_operator_private.adapters VALUES('sales_revision_private.operator_insert()','5c51ce5e449f7344c30e94e3f807d5bb','b2d2ab202c49188bbf3e5df62c343920',ARRAY['search_path=pg_catalog']::text[],false);
END;
$operator_adapter_24$;
DO $operator_adapter_25$
DECLARE definition text;body text;
BEGIN
 PERFORM sales_operator_private.require_owner();
 SELECT replace(pg_get_functiondef(oid),E'\r\n',E'\n'),replace(prosrc,E'\r\n',E'\n') INTO definition,body FROM pg_proc WHERE oid='sales_revision_private.plot_allowed(jsonb,jsonb)'::regprocedure;
 IF body IS DISTINCT FROM '
 SELECT public.crm_v2_role()=''admin'' AND EXISTS(
  SELECT 1 FROM sales_revision_private.plot_permits p JOIN sales_revision_private.events e ON e.id=p.event_id
  WHERE p.transaction_id=txid_current() AND p.backend_pid=pg_backend_pid() AND p.actor_id=auth.uid()
   AND p.old_plot=p_old AND p.new_plot=p_new AND e.plot_id=p_new->>''id''
   AND p.new_plot=p.old_plot||jsonb_build_object(''has_customer'',e.operation=''create_booking'')
   AND EXISTS(SELECT 1 FROM public.sales s WHERE s.id=e.sale_id AND to_jsonb(s)=e.after_sale)
   AND p.after_inventory=(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),''[]'') FROM public.sales s WHERE s.plot_id=e.plot_id)
 );
' OR md5(body) IS DISTINCT FROM 'd12af6e1fc40cb7b9ec6762320e81bbb'
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='sales_revision_private.plot_allowed(jsonb,jsonb)'::regprocedure AND pg_get_userbyid(proowner)=current_user AND prosecdef=false AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[])
  OR (length(definition)-length(replace(definition,body,'')))/length(body)<>1
 THEN RAISE EXCEPTION 'CUSTOMER_OPERATOR_EXACT_ADAPTER_REVIEW_REQUIRED'; END IF;
 EXECUTE replace(definition,body,'
 SELECT sales_operator_private.operator_role()=''admin'' AND EXISTS(
  SELECT 1 FROM sales_revision_private.plot_permits p JOIN sales_revision_private.events e ON e.id=p.event_id
  WHERE p.transaction_id=txid_current() AND p.backend_pid=pg_backend_pid() AND p.actor_id=sales_operator_private.actor()
   AND p.old_plot=p_old AND p.new_plot=p_new AND e.plot_id=p_new->>''id''
   AND p.new_plot=p.old_plot||jsonb_build_object(''has_customer'',e.operation=''create_booking'')
   AND EXISTS(SELECT 1 FROM public.sales s WHERE s.id=e.sale_id AND to_jsonb(s)=e.after_sale)
   AND p.after_inventory=(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),''[]'') FROM public.sales s WHERE s.plot_id=e.plot_id)
 );
');
 INSERT INTO sales_operator_private.adapters VALUES('sales_revision_private.plot_allowed(jsonb,jsonb)','d12af6e1fc40cb7b9ec6762320e81bbb','35d42b105252acdb3c721ed3c6ba4290',ARRAY['search_path=pg_catalog']::text[],false);
END;
$operator_adapter_25$;
DO $operator_adapter_26$
DECLARE definition text;body text;
BEGIN
 PERFORM sales_operator_private.require_owner();
 SELECT replace(pg_get_functiondef(oid),E'\r\n',E'\n'),replace(prosrc,E'\r\n',E'\n') INTO definition,body FROM pg_proc WHERE oid='sales_source_creation_private.apply_reviewed(jsonb)'::regprocedure;
 IF body IS DISTINCT FROM '
DECLARE actor uuid:=auth.uid(); batch sales_source_creation_private.batches%ROWTYPE; inserted_id uuid;
 r jsonb; e jsonb; owner_id uuid; provenance uuid; customer public.sales_customers%ROWTYPE; interest public.lead_project_interests%ROWTYPE;
 recorded timestamptz; event_day date; bindings jsonb:=''[]'';
BEGIN
 IF actor IS NULL OR current_user IS DISTINCT FROM (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid=''sales_source_creation_private.batches''::regclass)
 THEN RAISE EXCEPTION ''SOURCE_CREATION_FORBIDDEN''; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(''crm-booking-command'',0));
 PERFORM 1 FROM sales_private.crm_user_roles WHERE user_id=actor AND role=''admin'' AND is_active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION ''SOURCE_CREATION_FORBIDDEN''; END IF;
 PERFORM 1 FROM public.crm_settings WHERE id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION ''SOURCE_CREATION_DISABLED_FLAGS_REQUIRED''; END IF;
 IF EXISTS(SELECT 1 FROM public.crm_settings s,LATERAL jsonb_each(to_jsonb(s)) j WHERE
  (j.key LIKE ''%\_enabled'' ESCAPE ''\'' OR j.key=''booking_cutover_reviewed'') AND j.value=''true'')
 THEN RAISE EXCEPTION ''SOURCE_CREATION_DISABLED_FLAGS_REQUIRED''; END IF;
 PERFORM sales_source_creation_private.exact_object(p_payload,ARRAY[''version'',''datasetKey'',''sourceSha256'',''reviewSha256'',''leadReplayAllowed'',''businessStageWritesAllowed'',''records'']);
 IF p_payload->>''version'' IS DISTINCT FROM ''source-bound-customer-creation-v1''
  OR p_payload->''leadReplayAllowed'' IS DISTINCT FROM ''false''::jsonb OR p_payload->''businessStageWritesAllowed'' IS DISTINCT FROM ''false''::jsonb
  OR jsonb_typeof(p_payload->''datasetKey'') IS DISTINCT FROM ''string'' OR length(btrim(p_payload->>''datasetKey'')) NOT BETWEEN 1 AND 200
  OR p_payload->>''datasetKey''<>btrim(p_payload->>''datasetKey'') OR p_payload->>''datasetKey'' ~ ''[[:cntrl:]]''
  OR jsonb_typeof(p_payload->''sourceSha256'') IS DISTINCT FROM ''string'' OR (p_payload->>''sourceSha256'' ~ ''^[a-f0-9]{64}$'') IS DISTINCT FROM true
  OR jsonb_typeof(p_payload->''reviewSha256'') IS DISTINCT FROM ''string'' OR (p_payload->>''reviewSha256'' ~ ''^[a-f0-9]{64}$'') IS DISTINCT FROM true
  OR jsonb_typeof(p_payload->''records'') IS DISTINCT FROM ''array'' OR octet_length(p_payload::text)>8388608
 THEN RAISE EXCEPTION ''SOURCE_CREATION_INVALID''; END IF;
 IF jsonb_array_length(p_payload->''records'')<>6 THEN RAISE EXCEPTION ''SOURCE_CREATION_SIX_CONFIRMED_ROWS_REQUIRED''; END IF;
 INSERT INTO sales_source_creation_private.batches(dataset_key,source_sha256,review_sha256,payload,reviewer_id)
 VALUES(p_payload->>''datasetKey'',p_payload->>''sourceSha256'',p_payload->>''reviewSha256'',p_payload,actor)
 ON CONFLICT(dataset_key) DO NOTHING RETURNING id INTO inserted_id;
 SELECT * INTO STRICT batch FROM sales_source_creation_private.batches WHERE dataset_key=p_payload->>''datasetKey'' FOR UPDATE;
 IF batch.payload IS DISTINCT FROM p_payload THEN RAISE EXCEPTION ''SOURCE_CREATION_REPLAY_CONFLICT''; END IF;
 -- Replay rechecks active confirmed owner roles before returning stored UUIDs.
 FOR r IN SELECT value FROM jsonb_array_elements(p_payload->''records'') ORDER BY value->>''ownerUserId'' LOOP
  IF jsonb_typeof(r->''ownerUserId'') IS DISTINCT FROM ''string'' OR (r->>''ownerUserId'' ~ ''^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'') IS DISTINCT FROM true THEN RAISE EXCEPTION ''SOURCE_CREATION_INVALID''; END IF;
  owner_id:=(r->>''ownerUserId'')::uuid;
  PERFORM 1 FROM sales_private.crm_user_roles WHERE user_id=owner_id AND role=''sales'' AND is_active
   AND (r->>''sourceRow''=''680'' OR (user_id=''9c1d670a-1d2a-4996-959c-33c243fd34d8'' AND display_name=''TEAW'')) FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION ''SOURCE_CREATION_OWNER_CHANGED''; END IF;
 END LOOP;
 IF inserted_id IS NULL THEN
  SELECT jsonb_agg(jsonb_build_object(''sourceRow'',source_row,''customerId'',customer_id,''interestId'',interest_id) ORDER BY source_row) INTO bindings FROM sales_source_creation_private.records WHERE batch_id=batch.id;
  RETURN jsonb_build_object(''batchId'',batch.id,''records'',6,''bindings'',bindings,''replayed'',true);
 END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(p_payload->''records'') ORDER BY (value->>''sourceRow'')::integer LOOP
  PERFORM sales_source_creation_private.exact_object(r,ARRAY[''sourceRow'',''sourceKey'',''rowSha256'',''customerCandidateKey'',''interestCandidateKey'',''customerName'',''unknownName'',''ownerUserId'',''projectName'',''events'']);
  IF jsonb_typeof(r->''sourceRow'') IS DISTINCT FROM ''number'' OR (r->>''sourceRow'' ~ ''^[0-9]+$'') IS DISTINCT FROM true OR (r->>''sourceRow'')::integer NOT IN(438,439,440,444,894,680)
   OR jsonb_typeof(r->''sourceKey'') IS DISTINCT FROM ''string'' OR (r->>''sourceKey'' ~ ''^[a-f0-9]{64}$'') IS DISTINCT FROM true
   OR jsonb_typeof(r->''rowSha256'') IS DISTINCT FROM ''string'' OR (r->>''rowSha256'' ~ ''^[a-f0-9]{64}$'') IS DISTINCT FROM true
   OR jsonb_typeof(r->''customerName'') IS DISTINCT FROM ''string'' OR length(btrim(r->>''customerName'')) NOT BETWEEN 1 AND 300 OR r->>''customerName'' ~ ''[[:cntrl:]]''
   OR r->''unknownName'' IS DISTINCT FROM to_jsonb((r->>''sourceRow'')::integer=680)
   OR ((r->>''sourceRow'')::integer=680 AND r->>''customerName'' IS DISTINCT FROM ''ไม่ทราบ'')
   OR jsonb_typeof(r->''customerCandidateKey'') IS DISTINCT FROM ''string'' OR (r->>''customerCandidateKey'' ~ ''^[a-f0-9]{64}$'') IS DISTINCT FROM true
   OR jsonb_typeof(r->''interestCandidateKey'') IS DISTINCT FROM ''string'' OR (r->>''interestCandidateKey'' ~ ''^[a-f0-9]{64}$'') IS DISTINCT FROM true
   OR jsonb_typeof(r->''projectName'') IS DISTINCT FROM ''string'' OR length(btrim(r->>''projectName'')) NOT BETWEEN 1 AND 200
   OR jsonb_typeof(r->''events'') IS DISTINCT FROM ''array'' THEN RAISE EXCEPTION ''SOURCE_CREATION_INVALID''; END IF;
  IF jsonb_array_length(r->''events'') NOT BETWEEN 1 AND 30 THEN RAISE EXCEPTION ''SOURCE_CREATION_INVALID''; END IF;
  PERFORM 1 FROM public.projects WHERE name=r->>''projectName'' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION ''SOURCE_CREATION_PROJECT_CHANGED''; END IF;
  owner_id:=(r->>''ownerUserId'')::uuid; provenance:=gen_random_uuid(); recorded:=clock_timestamp();
  customer:=jsonb_populate_record(NULL::public.sales_customers,jsonb_build_object(''id'',gen_random_uuid(),''customer_name'',r->>''customerName'',''record_origin'',''legacy_import'',
   ''phone_data_status'',''unknown_legacy'',''personal_data'',''{}''::jsonb,''intake_status'',''legacy_unclassified'',''owner_user_id'',owner_id,''created_by_user_id'',actor,
   ''owner_assigned_at'',recorded,''created_at'',recorded,''updated_at'',recorded,''lifecycle_revision'',gen_random_uuid(),''supplemental_creation_id'',provenance));
  interest:=jsonb_populate_record(NULL::public.lead_project_interests,jsonb_build_object(''id'',gen_random_uuid(),''customer_id'',customer.id,''project_name'',r->>''projectName'',
   ''owner_user_id'',owner_id,''created_by_user_id'',actor,''owner_assigned_at'',recorded,''workspace_state'',''central_interest'',''engagement_status'',''legacy_unclassified'',
   ''created_at'',recorded,''updated_at'',recorded,''lifecycle_revision'',gen_random_uuid(),''supplemental_creation_id'',provenance));
  INSERT INTO sales_source_creation_private.records(id,batch_id,source_row,source_key,row_sha256,customer_candidate_key,interest_candidate_key,customer_id,interest_id,payload)
   VALUES(provenance,batch.id,(r->>''sourceRow'')::integer,r->>''sourceKey'',r->>''rowSha256'',r->>''customerCandidateKey'',r->>''interestCandidateKey'',customer.id,interest.id,r);
  INSERT INTO sales_source_creation_private.permits VALUES(txid_current(),pg_backend_pid(),actor,''customer'',customer.id,to_jsonb(customer)),(txid_current(),pg_backend_pid(),actor,''interest'',interest.id,to_jsonb(interest));
  INSERT INTO public.sales_customers(id,customer_name,record_origin,phone_data_status,personal_data,intake_status,owner_user_id,created_by_user_id,owner_assigned_at,lead_created_at,created_at,updated_at,lifecycle_revision,supplemental_creation_id)
   VALUES(customer.id,customer.customer_name,customer.record_origin,customer.phone_data_status,customer.personal_data,customer.intake_status,customer.owner_user_id,customer.created_by_user_id,customer.owner_assigned_at,NULL,customer.created_at,customer.updated_at,customer.lifecycle_revision,provenance);
  INSERT INTO public.lead_project_interests(id,customer_id,project_name,owner_user_id,created_by_user_id,owner_assigned_at,workspace_state,engagement_status,interest_created_at,created_at,updated_at,lifecycle_revision,supplemental_creation_id)
   VALUES(interest.id,customer.id,interest.project_name,owner_id,actor,interest.owner_assigned_at,interest.workspace_state,interest.engagement_status,NULL,interest.created_at,interest.updated_at,interest.lifecycle_revision,provenance);
  DELETE FROM sales_source_creation_private.permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid();
  FOR e IN SELECT value FROM jsonb_array_elements(r->''events'') LOOP
   PERFORM sales_source_creation_private.exact_object(e,ARRAY[''eventKey'',''kind'',''date'',''precision'',''evidenceRef'']);
   IF jsonb_typeof(e->''eventKey'') IS DISTINCT FROM ''string'' OR length(btrim(e->>''eventKey'')) NOT BETWEEN 1 AND 200 OR e->>''kind'' IS DISTINCT FROM ''visited''
    OR jsonb_typeof(e->''evidenceRef'') IS DISTINCT FROM ''string'' OR length(btrim(e->>''evidenceRef'')) NOT BETWEEN 1 AND 500
    OR jsonb_typeof(e->''precision'') IS DISTINCT FROM ''string''
    OR NOT((e->>''precision''=''unknown'' AND e->''date''=''null''::jsonb) OR (e->>''precision''=''day'' AND jsonb_typeof(e->''date'')=''string'' AND e->>''date'' ~ ''^[0-9]{4}-[0-9]{2}-[0-9]{2}$''))
    THEN RAISE EXCEPTION ''SOURCE_CREATION_INVALID''; END IF;
   event_day:=(e->>''date'')::date;
   IF event_day IS NOT NULL AND (event_day<DATE ''0001-01-01'' OR event_day>DATE ''9999-12-31'' OR to_char(event_day,''YYYY-MM-DD'')<>e->>''date'') THEN RAISE EXCEPTION ''SOURCE_CREATION_INVALID''; END IF;
   INSERT INTO sales_source_creation_private.events VALUES(provenance,e->>''eventKey'',''visited'',event_day,e->>''precision'',e->>''evidenceRef'');
  END LOOP;
  bindings:=bindings||jsonb_build_array(jsonb_build_object(''sourceRow'',(r->>''sourceRow'')::integer,''customerId'',customer.id,''interestId'',interest.id));
 END LOOP;
 RETURN jsonb_build_object(''batchId'',batch.id,''records'',6,''bindings'',bindings,''replayed'',false);
END; ' OR md5(body) IS DISTINCT FROM 'd85a85509cee7ec4dbd8553315a37ec1'
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='sales_source_creation_private.apply_reviewed(jsonb)'::regprocedure AND pg_get_userbyid(proowner)=current_user AND prosecdef=false AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[])
  OR (length(definition)-length(replace(definition,body,'')))/length(body)<>1
 THEN RAISE EXCEPTION 'CUSTOMER_OPERATOR_EXACT_ADAPTER_REVIEW_REQUIRED'; END IF;
 EXECUTE replace(definition,body,'
DECLARE actor uuid:=sales_operator_private.actor(); batch sales_source_creation_private.batches%ROWTYPE; inserted_id uuid;
 r jsonb; e jsonb; owner_id uuid; provenance uuid; customer public.sales_customers%ROWTYPE; interest public.lead_project_interests%ROWTYPE;
 recorded timestamptz; event_day date; bindings jsonb:=''[]'';
BEGIN
 PERFORM sales_operator_private.authorize_payload(''creation'',p_payload);
 IF actor IS NULL OR current_user IS DISTINCT FROM (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid=''sales_source_creation_private.batches''::regclass)
 THEN RAISE EXCEPTION ''SOURCE_CREATION_FORBIDDEN''; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(''crm-booking-command'',0));
 PERFORM 1 FROM sales_private.crm_user_roles WHERE user_id=actor AND role=''admin'' AND is_active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION ''SOURCE_CREATION_FORBIDDEN''; END IF;
 PERFORM 1 FROM public.crm_settings WHERE id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION ''SOURCE_CREATION_DISABLED_FLAGS_REQUIRED''; END IF;
 IF EXISTS(SELECT 1 FROM public.crm_settings s,LATERAL jsonb_each(to_jsonb(s)) j WHERE
  (j.key LIKE ''%\_enabled'' ESCAPE ''\'' OR j.key=''booking_cutover_reviewed'') AND j.value=''true'')
 THEN RAISE EXCEPTION ''SOURCE_CREATION_DISABLED_FLAGS_REQUIRED''; END IF;
 PERFORM sales_source_creation_private.exact_object(p_payload,ARRAY[''version'',''datasetKey'',''sourceSha256'',''reviewSha256'',''leadReplayAllowed'',''businessStageWritesAllowed'',''records'']);
 IF p_payload->>''version'' IS DISTINCT FROM ''source-bound-customer-creation-v1''
  OR p_payload->''leadReplayAllowed'' IS DISTINCT FROM ''false''::jsonb OR p_payload->''businessStageWritesAllowed'' IS DISTINCT FROM ''false''::jsonb
  OR jsonb_typeof(p_payload->''datasetKey'') IS DISTINCT FROM ''string'' OR length(btrim(p_payload->>''datasetKey'')) NOT BETWEEN 1 AND 200
  OR p_payload->>''datasetKey''<>btrim(p_payload->>''datasetKey'') OR p_payload->>''datasetKey'' ~ ''[[:cntrl:]]''
  OR jsonb_typeof(p_payload->''sourceSha256'') IS DISTINCT FROM ''string'' OR (p_payload->>''sourceSha256'' ~ ''^[a-f0-9]{64}$'') IS DISTINCT FROM true
  OR jsonb_typeof(p_payload->''reviewSha256'') IS DISTINCT FROM ''string'' OR (p_payload->>''reviewSha256'' ~ ''^[a-f0-9]{64}$'') IS DISTINCT FROM true
  OR jsonb_typeof(p_payload->''records'') IS DISTINCT FROM ''array'' OR octet_length(p_payload::text)>8388608
 THEN RAISE EXCEPTION ''SOURCE_CREATION_INVALID''; END IF;
 IF jsonb_array_length(p_payload->''records'')<>6 THEN RAISE EXCEPTION ''SOURCE_CREATION_SIX_CONFIRMED_ROWS_REQUIRED''; END IF;
 INSERT INTO sales_source_creation_private.batches(dataset_key,source_sha256,review_sha256,payload,reviewer_id)
 VALUES(p_payload->>''datasetKey'',p_payload->>''sourceSha256'',p_payload->>''reviewSha256'',p_payload,actor)
 ON CONFLICT(dataset_key) DO NOTHING RETURNING id INTO inserted_id;
 SELECT * INTO STRICT batch FROM sales_source_creation_private.batches WHERE dataset_key=p_payload->>''datasetKey'' FOR UPDATE;
 IF batch.payload IS DISTINCT FROM p_payload THEN RAISE EXCEPTION ''SOURCE_CREATION_REPLAY_CONFLICT''; END IF;
 -- Replay rechecks active confirmed owner roles before returning stored UUIDs.
 FOR r IN SELECT value FROM jsonb_array_elements(p_payload->''records'') ORDER BY value->>''ownerUserId'' LOOP
  IF jsonb_typeof(r->''ownerUserId'') IS DISTINCT FROM ''string'' OR (r->>''ownerUserId'' ~ ''^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'') IS DISTINCT FROM true THEN RAISE EXCEPTION ''SOURCE_CREATION_INVALID''; END IF;
  owner_id:=(r->>''ownerUserId'')::uuid;
  PERFORM 1 FROM sales_private.crm_user_roles WHERE user_id=owner_id AND role=''sales'' AND is_active
   AND (r->>''sourceRow''=''680'' OR (user_id=''9c1d670a-1d2a-4996-959c-33c243fd34d8'' AND display_name=''TEAW'')) FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION ''SOURCE_CREATION_OWNER_CHANGED''; END IF;
 END LOOP;
 IF inserted_id IS NULL THEN
  SELECT jsonb_agg(jsonb_build_object(''sourceRow'',source_row,''customerId'',customer_id,''interestId'',interest_id) ORDER BY source_row) INTO bindings FROM sales_source_creation_private.records WHERE batch_id=batch.id;
  RETURN jsonb_build_object(''batchId'',batch.id,''records'',6,''bindings'',bindings,''replayed'',true);
 END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(p_payload->''records'') ORDER BY (value->>''sourceRow'')::integer LOOP
  PERFORM sales_source_creation_private.exact_object(r,ARRAY[''sourceRow'',''sourceKey'',''rowSha256'',''customerCandidateKey'',''interestCandidateKey'',''customerName'',''unknownName'',''ownerUserId'',''projectName'',''events'']);
  IF jsonb_typeof(r->''sourceRow'') IS DISTINCT FROM ''number'' OR (r->>''sourceRow'' ~ ''^[0-9]+$'') IS DISTINCT FROM true OR (r->>''sourceRow'')::integer NOT IN(438,439,440,444,894,680)
   OR jsonb_typeof(r->''sourceKey'') IS DISTINCT FROM ''string'' OR (r->>''sourceKey'' ~ ''^[a-f0-9]{64}$'') IS DISTINCT FROM true
   OR jsonb_typeof(r->''rowSha256'') IS DISTINCT FROM ''string'' OR (r->>''rowSha256'' ~ ''^[a-f0-9]{64}$'') IS DISTINCT FROM true
   OR jsonb_typeof(r->''customerName'') IS DISTINCT FROM ''string'' OR length(btrim(r->>''customerName'')) NOT BETWEEN 1 AND 300 OR r->>''customerName'' ~ ''[[:cntrl:]]''
   OR r->''unknownName'' IS DISTINCT FROM to_jsonb((r->>''sourceRow'')::integer=680)
   OR ((r->>''sourceRow'')::integer=680 AND r->>''customerName'' IS DISTINCT FROM ''ไม่ทราบ'')
   OR jsonb_typeof(r->''customerCandidateKey'') IS DISTINCT FROM ''string'' OR (r->>''customerCandidateKey'' ~ ''^[a-f0-9]{64}$'') IS DISTINCT FROM true
   OR jsonb_typeof(r->''interestCandidateKey'') IS DISTINCT FROM ''string'' OR (r->>''interestCandidateKey'' ~ ''^[a-f0-9]{64}$'') IS DISTINCT FROM true
   OR jsonb_typeof(r->''projectName'') IS DISTINCT FROM ''string'' OR length(btrim(r->>''projectName'')) NOT BETWEEN 1 AND 200
   OR jsonb_typeof(r->''events'') IS DISTINCT FROM ''array'' THEN RAISE EXCEPTION ''SOURCE_CREATION_INVALID''; END IF;
  IF jsonb_array_length(r->''events'') NOT BETWEEN 1 AND 30 THEN RAISE EXCEPTION ''SOURCE_CREATION_INVALID''; END IF;
  PERFORM 1 FROM public.projects WHERE name=r->>''projectName'' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION ''SOURCE_CREATION_PROJECT_CHANGED''; END IF;
  owner_id:=(r->>''ownerUserId'')::uuid; provenance:=gen_random_uuid(); recorded:=clock_timestamp();
  customer:=jsonb_populate_record(NULL::public.sales_customers,jsonb_build_object(''id'',gen_random_uuid(),''customer_name'',r->>''customerName'',''record_origin'',''legacy_import'',
   ''phone_data_status'',''unknown_legacy'',''personal_data'',''{}''::jsonb,''intake_status'',''legacy_unclassified'',''owner_user_id'',owner_id,''created_by_user_id'',actor,
   ''owner_assigned_at'',recorded,''created_at'',recorded,''updated_at'',recorded,''lifecycle_revision'',gen_random_uuid(),''supplemental_creation_id'',provenance));
  interest:=jsonb_populate_record(NULL::public.lead_project_interests,jsonb_build_object(''id'',gen_random_uuid(),''customer_id'',customer.id,''project_name'',r->>''projectName'',
   ''owner_user_id'',owner_id,''created_by_user_id'',actor,''owner_assigned_at'',recorded,''workspace_state'',''central_interest'',''engagement_status'',''legacy_unclassified'',
   ''created_at'',recorded,''updated_at'',recorded,''lifecycle_revision'',gen_random_uuid(),''supplemental_creation_id'',provenance));
  INSERT INTO sales_source_creation_private.records(id,batch_id,source_row,source_key,row_sha256,customer_candidate_key,interest_candidate_key,customer_id,interest_id,payload)
   VALUES(provenance,batch.id,(r->>''sourceRow'')::integer,r->>''sourceKey'',r->>''rowSha256'',r->>''customerCandidateKey'',r->>''interestCandidateKey'',customer.id,interest.id,r);
  INSERT INTO sales_source_creation_private.permits VALUES(txid_current(),pg_backend_pid(),actor,''customer'',customer.id,to_jsonb(customer)),(txid_current(),pg_backend_pid(),actor,''interest'',interest.id,to_jsonb(interest));
  INSERT INTO public.sales_customers(id,customer_name,record_origin,phone_data_status,personal_data,intake_status,owner_user_id,created_by_user_id,owner_assigned_at,lead_created_at,created_at,updated_at,lifecycle_revision,supplemental_creation_id)
   VALUES(customer.id,customer.customer_name,customer.record_origin,customer.phone_data_status,customer.personal_data,customer.intake_status,customer.owner_user_id,customer.created_by_user_id,customer.owner_assigned_at,NULL,customer.created_at,customer.updated_at,customer.lifecycle_revision,provenance);
  INSERT INTO public.lead_project_interests(id,customer_id,project_name,owner_user_id,created_by_user_id,owner_assigned_at,workspace_state,engagement_status,interest_created_at,created_at,updated_at,lifecycle_revision,supplemental_creation_id)
   VALUES(interest.id,customer.id,interest.project_name,owner_id,actor,interest.owner_assigned_at,interest.workspace_state,interest.engagement_status,NULL,interest.created_at,interest.updated_at,interest.lifecycle_revision,provenance);
  DELETE FROM sales_source_creation_private.permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid();
  FOR e IN SELECT value FROM jsonb_array_elements(r->''events'') LOOP
   PERFORM sales_source_creation_private.exact_object(e,ARRAY[''eventKey'',''kind'',''date'',''precision'',''evidenceRef'']);
   IF jsonb_typeof(e->''eventKey'') IS DISTINCT FROM ''string'' OR length(btrim(e->>''eventKey'')) NOT BETWEEN 1 AND 200 OR e->>''kind'' IS DISTINCT FROM ''visited''
    OR jsonb_typeof(e->''evidenceRef'') IS DISTINCT FROM ''string'' OR length(btrim(e->>''evidenceRef'')) NOT BETWEEN 1 AND 500
    OR jsonb_typeof(e->''precision'') IS DISTINCT FROM ''string''
    OR NOT((e->>''precision''=''unknown'' AND e->''date''=''null''::jsonb) OR (e->>''precision''=''day'' AND jsonb_typeof(e->''date'')=''string'' AND e->>''date'' ~ ''^[0-9]{4}-[0-9]{2}-[0-9]{2}$''))
    THEN RAISE EXCEPTION ''SOURCE_CREATION_INVALID''; END IF;
   event_day:=(e->>''date'')::date;
   IF event_day IS NOT NULL AND (event_day<DATE ''0001-01-01'' OR event_day>DATE ''9999-12-31'' OR to_char(event_day,''YYYY-MM-DD'')<>e->>''date'') THEN RAISE EXCEPTION ''SOURCE_CREATION_INVALID''; END IF;
   INSERT INTO sales_source_creation_private.events VALUES(provenance,e->>''eventKey'',''visited'',event_day,e->>''precision'',e->>''evidenceRef'');
  END LOOP;
  bindings:=bindings||jsonb_build_array(jsonb_build_object(''sourceRow'',(r->>''sourceRow'')::integer,''customerId'',customer.id,''interestId'',interest.id));
 END LOOP;
 RETURN jsonb_build_object(''batchId'',batch.id,''records'',6,''bindings'',bindings,''replayed'',false);
END; ');
 INSERT INTO sales_operator_private.adapters VALUES('sales_source_creation_private.apply_reviewed(jsonb)','d85a85509cee7ec4dbd8553315a37ec1','16520007f4db5af37c8b991e2663d785',ARRAY['search_path=pg_catalog']::text[],false);
END;
$operator_adapter_26$;
DO $operator_adapter_27$
DECLARE definition text;body text;
BEGIN
 PERFORM sales_operator_private.require_owner();
 SELECT replace(pg_get_functiondef(oid),E'\r\n',E'\n'),replace(prosrc,E'\r\n',E'\n') INTO definition,body FROM pg_proc WHERE oid='sales_source_creation_private.canonical_guard()'::regprocedure;
 IF body IS DISTINCT FROM '
DECLARE kind text:=CASE WHEN TG_TABLE_NAME=''sales_customers'' THEN ''customer'' ELSE ''interest'' END; r sales_source_creation_private.records%ROWTYPE; allowed boolean:=false;
BEGIN
 IF TG_OP IN(''UPDATE'',''DELETE'') AND OLD.supplemental_creation_id IS NOT NULL THEN
  IF TG_OP=''UPDATE'' AND kind=''interest'' AND to_regprocedure(''crm_external_private.booking_interest_allowed(jsonb,jsonb)'') IS NOT NULL THEN
   EXECUTE ''SELECT crm_external_private.booking_interest_allowed($1,$2)'' INTO allowed USING to_jsonb(OLD),to_jsonb(NEW);
   IF allowed IS TRUE THEN RETURN NEW; END IF;
  END IF;
  RAISE EXCEPTION ''SOURCE_CREATION_SEALED'';
 END IF;
 IF TG_OP=''DELETE'' THEN RETURN OLD; END IF;
 IF NEW.supplemental_creation_id IS NULL THEN RETURN NEW; END IF;
 IF TG_OP<>''INSERT'' OR NOT EXISTS(SELECT 1 FROM sales_source_creation_private.permits p
   WHERE p.transaction_id=txid_current() AND p.backend_pid=pg_backend_pid() AND p.actor_id=auth.uid()
    AND p.entity_type=kind AND p.entity_id=NEW.id AND p.new_row=to_jsonb(NEW))
 THEN RAISE EXCEPTION ''SOURCE_CREATION_EXACT_PERMIT_REQUIRED''; END IF;
 SELECT * INTO STRICT r FROM sales_source_creation_private.records WHERE id=NEW.supplemental_creation_id;
 IF kind=''customer'' THEN
  IF r.customer_id IS DISTINCT FROM NEW.id OR NEW.customer_name IS DISTINCT FROM r.payload->>''customerName''
   THEN RAISE EXCEPTION ''SOURCE_CREATION_LINEAGE_REQUIRED''; END IF;
 ELSE
  IF r.interest_id IS DISTINCT FROM NEW.id OR NEW.customer_id IS DISTINCT FROM r.customer_id OR NEW.project_name IS DISTINCT FROM r.payload->>''projectName''
   THEN RAISE EXCEPTION ''SOURCE_CREATION_LINEAGE_REQUIRED''; END IF;
 END IF;
 RETURN NEW;
END; ' OR md5(body) IS DISTINCT FROM '8e40eb354a8e03dbeb61c3c398f0069b'
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='sales_source_creation_private.canonical_guard()'::regprocedure AND pg_get_userbyid(proowner)=current_user AND prosecdef=false AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[])
  OR (length(definition)-length(replace(definition,body,'')))/length(body)<>1
 THEN RAISE EXCEPTION 'CUSTOMER_OPERATOR_EXACT_ADAPTER_REVIEW_REQUIRED'; END IF;
 EXECUTE replace(definition,body,'
DECLARE kind text:=CASE WHEN TG_TABLE_NAME=''sales_customers'' THEN ''customer'' ELSE ''interest'' END; r sales_source_creation_private.records%ROWTYPE; allowed boolean:=false;
BEGIN
 IF TG_OP IN(''UPDATE'',''DELETE'') AND OLD.supplemental_creation_id IS NOT NULL THEN
  IF TG_OP=''UPDATE'' AND kind=''interest'' AND to_regprocedure(''crm_external_private.booking_interest_allowed(jsonb,jsonb)'') IS NOT NULL THEN
   EXECUTE ''SELECT crm_external_private.booking_interest_allowed($1,$2)'' INTO allowed USING to_jsonb(OLD),to_jsonb(NEW);
   IF allowed IS TRUE THEN RETURN NEW; END IF;
  END IF;
  RAISE EXCEPTION ''SOURCE_CREATION_SEALED'';
 END IF;
 IF TG_OP=''DELETE'' THEN RETURN OLD; END IF;
 IF NEW.supplemental_creation_id IS NULL THEN RETURN NEW; END IF;
 IF TG_OP<>''INSERT'' OR NOT EXISTS(SELECT 1 FROM sales_source_creation_private.permits p
   WHERE p.transaction_id=txid_current() AND p.backend_pid=pg_backend_pid() AND p.actor_id=sales_operator_private.actor()
    AND p.entity_type=kind AND p.entity_id=NEW.id AND p.new_row=to_jsonb(NEW))
 THEN RAISE EXCEPTION ''SOURCE_CREATION_EXACT_PERMIT_REQUIRED''; END IF;
 SELECT * INTO STRICT r FROM sales_source_creation_private.records WHERE id=NEW.supplemental_creation_id;
 IF kind=''customer'' THEN
  IF r.customer_id IS DISTINCT FROM NEW.id OR NEW.customer_name IS DISTINCT FROM r.payload->>''customerName''
   THEN RAISE EXCEPTION ''SOURCE_CREATION_LINEAGE_REQUIRED''; END IF;
 ELSE
  IF r.interest_id IS DISTINCT FROM NEW.id OR NEW.customer_id IS DISTINCT FROM r.customer_id OR NEW.project_name IS DISTINCT FROM r.payload->>''projectName''
   THEN RAISE EXCEPTION ''SOURCE_CREATION_LINEAGE_REQUIRED''; END IF;
 END IF;
 RETURN NEW;
END; ');
 INSERT INTO sales_operator_private.adapters VALUES('sales_source_creation_private.canonical_guard()','8e40eb354a8e03dbeb61c3c398f0069b','175dec4165b3278a09f987007264c28f',ARRAY['search_path=pg_catalog']::text[],false);
END;
$operator_adapter_27$;
DO $operator_adapter_28$
DECLARE definition text;body text;
BEGIN
 PERFORM sales_operator_private.require_owner();
 SELECT replace(pg_get_functiondef(oid),E'\r\n',E'\n'),replace(prosrc,E'\r\n',E'\n') INTO definition,body FROM pg_proc WHERE oid='sales_source_creation_private.owner_guard()'::regprocedure;
 IF body IS DISTINCT FROM '
BEGIN
 IF current_user IS DISTINCT FROM (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid=TG_RELID)
  OR auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM sales_private.crm_user_roles WHERE user_id=auth.uid() AND role=''admin'' AND is_active)
 THEN RAISE EXCEPTION ''SOURCE_CREATION_FORBIDDEN''; END IF;
 RETURN NEW;
END; ' OR md5(body) IS DISTINCT FROM '2f5fdec79ad6f81e02506924cf125b9e'
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='sales_source_creation_private.owner_guard()'::regprocedure AND pg_get_userbyid(proowner)=current_user AND prosecdef=false AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[])
  OR (length(definition)-length(replace(definition,body,'')))/length(body)<>1
 THEN RAISE EXCEPTION 'CUSTOMER_OPERATOR_EXACT_ADAPTER_REVIEW_REQUIRED'; END IF;
 EXECUTE replace(definition,body,'
BEGIN
 IF current_user IS DISTINCT FROM (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid=TG_RELID)
  OR sales_operator_private.actor() IS NULL OR NOT EXISTS(SELECT 1 FROM sales_private.crm_user_roles WHERE user_id=sales_operator_private.actor() AND role=''admin'' AND is_active)
 THEN RAISE EXCEPTION ''SOURCE_CREATION_FORBIDDEN''; END IF;
 RETURN NEW;
END; ');
 INSERT INTO sales_operator_private.adapters VALUES('sales_source_creation_private.owner_guard()','2f5fdec79ad6f81e02506924cf125b9e','dc1d06fdf77c52fb61fcc10775922e19',ARRAY['search_path=pg_catalog']::text[],false);
END;
$operator_adapter_28$;
DO $operator_adapter_29$
DECLARE definition text;body text;
BEGIN
 PERFORM sales_operator_private.require_owner();
 SELECT replace(pg_get_functiondef(oid),E'\r\n',E'\n'),replace(prosrc,E'\r\n',E'\n') INTO definition,body FROM pg_proc WHERE oid='sales_unknown_history_private.guard_insert()'::regprocedure;
 IF body IS DISTINCT FROM '
BEGIN
 IF current_user IS DISTINCT FROM (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid=TG_RELID)
  OR auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM sales_unknown_history_private.insert_permits
   WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid() AND actor_id=auth.uid()
    AND relation_name=TG_TABLE_NAME AND expected_row=to_jsonb(NEW))
 THEN RAISE EXCEPTION ''UNKNOWN_HISTORY_INSERT_FORBIDDEN''; END IF;
 RETURN NEW;
END; ' OR md5(body) IS DISTINCT FROM '06243884d2bac54ae040fea0d1cdfdfc'
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='sales_unknown_history_private.guard_insert()'::regprocedure AND pg_get_userbyid(proowner)=current_user AND prosecdef=false AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[])
  OR (length(definition)-length(replace(definition,body,'')))/length(body)<>1
 THEN RAISE EXCEPTION 'CUSTOMER_OPERATOR_EXACT_ADAPTER_REVIEW_REQUIRED'; END IF;
 EXECUTE replace(definition,body,'
BEGIN
 IF current_user IS DISTINCT FROM (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid=TG_RELID)
  OR sales_operator_private.actor() IS NULL OR NOT EXISTS(SELECT 1 FROM sales_unknown_history_private.insert_permits
   WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid() AND actor_id=sales_operator_private.actor()
    AND relation_name=TG_TABLE_NAME AND expected_row=to_jsonb(NEW))
 THEN RAISE EXCEPTION ''UNKNOWN_HISTORY_INSERT_FORBIDDEN''; END IF;
 RETURN NEW;
END; ');
 INSERT INTO sales_operator_private.adapters VALUES('sales_unknown_history_private.guard_insert()','06243884d2bac54ae040fea0d1cdfdfc','a9dbf357560d6b08807792dd184f5da9',ARRAY['search_path=pg_catalog']::text[],false);
END;
$operator_adapter_29$;
DO $operator_adapter_30$
DECLARE definition text;body text;
BEGIN
 PERFORM sales_operator_private.require_owner();
 SELECT replace(pg_get_functiondef(oid),E'\r\n',E'\n'),replace(prosrc,E'\r\n',E'\n') INTO definition,body FROM pg_proc WHERE oid='sales_unknown_history_private.insert_exact(text,jsonb)'::regprocedure;
 IF body IS DISTINCT FROM '
BEGIN
 IF p_relation NOT IN (''batches'',''records'',''events'') OR auth.uid() IS NULL
  OR current_user IS DISTINCT FROM (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid=''sales_unknown_history_private.insert_permits''::regclass)
 THEN RAISE EXCEPTION ''UNKNOWN_HISTORY_INSERT_FORBIDDEN''; END IF;
 PERFORM 1 FROM sales_private.crm_user_roles WHERE user_id=auth.uid() AND role=''admin'' AND is_active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION ''UNKNOWN_HISTORY_FORBIDDEN''; END IF;
 INSERT INTO sales_unknown_history_private.insert_permits VALUES(txid_current(),pg_backend_pid(),auth.uid(),p_relation,p_row);
 EXECUTE format(''INSERT INTO sales_unknown_history_private.%I SELECT (jsonb_populate_record(NULL::sales_unknown_history_private.%I,$1)).*'',p_relation,p_relation) USING p_row;
 DELETE FROM sales_unknown_history_private.insert_permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid();
END; ' OR md5(body) IS DISTINCT FROM '7424d52cac84f461225ea669ee37c181'
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='sales_unknown_history_private.insert_exact(text,jsonb)'::regprocedure AND pg_get_userbyid(proowner)=current_user AND prosecdef=false AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[])
  OR (length(definition)-length(replace(definition,body,'')))/length(body)<>1
 THEN RAISE EXCEPTION 'CUSTOMER_OPERATOR_EXACT_ADAPTER_REVIEW_REQUIRED'; END IF;
 EXECUTE replace(definition,body,'
BEGIN
 IF p_relation NOT IN (''batches'',''records'',''events'') OR sales_operator_private.actor() IS NULL
  OR current_user IS DISTINCT FROM (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid=''sales_unknown_history_private.insert_permits''::regclass)
 THEN RAISE EXCEPTION ''UNKNOWN_HISTORY_INSERT_FORBIDDEN''; END IF;
 PERFORM 1 FROM sales_private.crm_user_roles WHERE user_id=sales_operator_private.actor() AND role=''admin'' AND is_active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION ''UNKNOWN_HISTORY_FORBIDDEN''; END IF;
 INSERT INTO sales_unknown_history_private.insert_permits VALUES(txid_current(),pg_backend_pid(),sales_operator_private.actor(),p_relation,p_row);
 EXECUTE format(''INSERT INTO sales_unknown_history_private.%I SELECT (jsonb_populate_record(NULL::sales_unknown_history_private.%I,$1)).*'',p_relation,p_relation) USING p_row;
 DELETE FROM sales_unknown_history_private.insert_permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid();
END; ');
 INSERT INTO sales_operator_private.adapters VALUES('sales_unknown_history_private.insert_exact(text,jsonb)','7424d52cac84f461225ea669ee37c181','74415dd22ee1ee3bacbf49c9727e6133',ARRAY['search_path=pg_catalog']::text[],false);
END;
$operator_adapter_30$;
DO $operator_adapter_31$
DECLARE definition text;body text;
BEGIN
 PERFORM sales_operator_private.require_owner();
 SELECT replace(pg_get_functiondef(oid),E'\r\n',E'\n'),replace(prosrc,E'\r\n',E'\n') INTO definition,body FROM pg_proc WHERE oid='sales_unknown_history_private.persist_evidence(jsonb)'::regprocedure;
 IF body IS DISTINCT FROM '
DECLARE actor uuid:=auth.uid(); batch sales_unknown_history_private.batches%ROWTYPE;
 src_system text; dataset text; review_ref text; row_value jsonb; ev jsonb; customer_value uuid; interest_value uuid;
 key_value text; customer_key_value text; reason_value text; stage_value text; date_value date; last_date date;
 seq_value integer; rank_value integer; last_rank integer; booked_count integer; cancelled_count integer; events_count integer:=0;
BEGIN
 IF actor IS NULL OR current_user IS DISTINCT FROM (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid=''sales_unknown_history_private.batches''::regclass)
 THEN RAISE EXCEPTION ''UNKNOWN_HISTORY_FORBIDDEN''; END IF;
 PERFORM 1 FROM sales_private.crm_user_roles WHERE user_id=actor AND role=''admin'' AND is_active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION ''UNKNOWN_HISTORY_FORBIDDEN''; END IF;
 PERFORM sales_unknown_history_private.require_object(p_payload,ARRAY[''version'',''sourceSystem'',''datasetKey'',''snapshotSha256'',''mappingReviewRef'',''records'',''businessWritesAllowed'',''leadRequired'']);
 IF p_payload->>''version'' IS DISTINCT FROM ''unknown-historical-evidence-v1''
  OR p_payload->''businessWritesAllowed'' IS DISTINCT FROM ''false''::jsonb OR p_payload->''leadRequired'' IS DISTINCT FROM ''false''::jsonb
  OR jsonb_typeof(p_payload->''snapshotSha256'') IS DISTINCT FROM ''string'' OR (p_payload->>''snapshotSha256'' ~ ''^[a-f0-9]{64}$'') IS DISTINCT FROM true
  OR jsonb_typeof(p_payload->''records'') IS DISTINCT FROM ''array'' OR octet_length(p_payload::text)>8388608
 THEN RAISE EXCEPTION ''UNKNOWN_HISTORY_INVALID''; END IF;
 IF jsonb_array_length(p_payload->''records'') NOT BETWEEN 1 AND 5000 THEN RAISE EXCEPTION ''UNKNOWN_HISTORY_INVALID''; END IF;
 src_system:=sales_unknown_history_private.require_text(p_payload->''sourceSystem'');
 dataset:=sales_unknown_history_private.require_text(p_payload->''datasetKey''); review_ref:=sales_unknown_history_private.require_text(p_payload->''mappingReviewRef'');
 -- Same lock family as the 24 archive; this function only writes its separate archive.
 PERFORM pg_advisory_xact_lock(hashtextextended(''historical-evidence-source:''||src_system,0));
 SELECT * INTO batch FROM sales_unknown_history_private.batches WHERE source_system=src_system AND dataset_key=dataset FOR UPDATE;
 IF FOUND THEN
  IF batch.payload IS DISTINCT FROM p_payload THEN RAISE EXCEPTION ''UNKNOWN_HISTORY_RECONCILIATION_REQUIRED''; END IF;
  RETURN jsonb_build_object(''batchId'',batch.id,''replayed'',true,''records'',jsonb_array_length(p_payload->''records''),
   ''events'',(SELECT count(*) FROM sales_unknown_history_private.events WHERE batch_id=batch.id),''businessChanged'',false);
 END IF;
 batch.id:=gen_random_uuid(); batch.source_system:=src_system; batch.dataset_key:=dataset; batch.snapshot_sha256:=p_payload->>''snapshotSha256'';
 batch.mapping_review_ref:=review_ref; batch.payload:=p_payload; batch.reviewer_id:=actor; batch.recorded_at:=clock_timestamp();
 PERFORM sales_unknown_history_private.insert_exact(''batches'',to_jsonb(batch));
 PERFORM 1 FROM public.sales_customers WHERE id IN(SELECT sales_unknown_history_private.require_uuid(r->''customerId'') FROM jsonb_array_elements(p_payload->''records'') r) ORDER BY id FOR SHARE;
 PERFORM 1 FROM public.lead_project_interests WHERE id IN(SELECT sales_unknown_history_private.require_uuid(r->''interestId'') FROM jsonb_array_elements(p_payload->''records'') r WHERE r->''interestId''<>''null''::jsonb) ORDER BY id FOR SHARE;
 FOR row_value IN SELECT value FROM jsonb_array_elements(p_payload->''records'') LOOP
  PERFORM sales_unknown_history_private.require_object(row_value,ARRAY[''sourceKey'',''rowNumber'',''rowSha256'',''customerKey'',''customerId'',''interestId'',''saleId'',''reason'',''sourceStage'',''events'']);
  IF jsonb_typeof(row_value->''sourceKey'') IS DISTINCT FROM ''string'' OR (row_value->>''sourceKey'' ~ ''^[a-f0-9]{64}$'') IS DISTINCT FROM true
   OR jsonb_typeof(row_value->''rowSha256'') IS DISTINCT FROM ''string'' OR (row_value->>''rowSha256'' ~ ''^[a-f0-9]{64}$'') IS DISTINCT FROM true
   OR jsonb_typeof(row_value->''rowNumber'') IS DISTINCT FROM ''number'' OR (row_value->>''rowNumber'' ~ ''^[0-9]+$'') IS DISTINCT FROM true
   OR row_value->''saleId'' IS DISTINCT FROM ''null''::jsonb OR jsonb_typeof(row_value->''events'') IS DISTINCT FROM ''array''
  THEN RAISE EXCEPTION ''UNKNOWN_HISTORY_INVALID''; END IF;
  key_value:=row_value->>''sourceKey''; customer_key_value:=sales_unknown_history_private.require_text(row_value->''customerKey'');
  customer_value:=sales_unknown_history_private.require_uuid(row_value->''customerId'');
  interest_value:=CASE WHEN row_value->''interestId''=''null''::jsonb THEN NULL ELSE sales_unknown_history_private.require_uuid(row_value->''interestId'') END;
  reason_value:=sales_unknown_history_private.require_text(row_value->''reason''); stage_value:=sales_unknown_history_private.require_text(row_value->''sourceStage'');
  IF NOT ((reason_value=''unknown_project'' AND stage_value=''visited'' AND interest_value IS NULL)
   OR (reason_value=''unknown_booking'' AND stage_value=''cancelled'')) THEN RAISE EXCEPTION ''UNKNOWN_HISTORY_INVALID''; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.sales_customers WHERE id=customer_value AND merged_into_customer_id IS NULL)
   OR (interest_value IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.lead_project_interests WHERE id=interest_value AND customer_id=customer_value))
   OR EXISTS(SELECT 1 FROM sales_unknown_history_private.records WHERE source_system=src_system AND
    ((customer_key=customer_key_value AND customer_id<>customer_value) OR (customer_id=customer_value AND customer_key<>customer_key_value)))
  THEN RAISE EXCEPTION ''UNKNOWN_HISTORY_MAPPING_CONFLICT''; END IF;
  IF jsonb_array_length(row_value->''events'') NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION ''UNKNOWN_HISTORY_INVALID''; END IF;
  PERFORM sales_unknown_history_private.insert_exact(''records'',jsonb_build_object(''batch_id'',batch.id,''source_system'',src_system,''source_key'',key_value,
   ''row_number'',(row_value->>''rowNumber'')::integer,''row_sha256'',row_value->>''rowSha256'',''customer_key'',customer_key_value,''customer_id'',customer_value,
   ''interest_id'',interest_value,''sale_id'',NULL,''reason'',reason_value,''source_stage'',stage_value,''payload'',row_value));
  seq_value:=0; last_rank:=-1; last_date:=NULL; booked_count:=0; cancelled_count:=0;
  FOR ev IN SELECT value FROM jsonb_array_elements(row_value->''events'') LOOP
   events_count:=events_count+1; IF events_count>20000 THEN RAISE EXCEPTION ''UNKNOWN_HISTORY_INVALID''; END IF;
   PERFORM sales_unknown_history_private.require_object(ev,ARRAY[''eventKey'',''kind'',''sequence'',''date'',''precision'',''evidenceRef'']);
   PERFORM sales_unknown_history_private.require_text(ev->''eventKey''); PERFORM sales_unknown_history_private.require_text(ev->''evidenceRef'');
   PERFORM sales_unknown_history_private.require_text(ev->''kind'');
   IF jsonb_typeof(ev->''sequence'') IS DISTINCT FROM ''number'' OR (ev->>''sequence'' ~ ''^[0-9]+$'') IS DISTINCT FROM true
    OR (ev->>''sequence'')::integer<>seq_value+1 THEN RAISE EXCEPTION ''UNKNOWN_HISTORY_INVALID''; END IF;
   seq_value:=seq_value+1; date_value:=NULL;
   IF ev->''date''<>''null''::jsonb THEN
    IF jsonb_typeof(ev->''date'') IS DISTINCT FROM ''string'' OR (ev->>''date'' ~ ''^[0-9]{4}-[0-9]{2}-[0-9]{2}$'') IS DISTINCT FROM true
     OR NOT pg_input_is_valid(ev->>''date'',''date'') THEN RAISE EXCEPTION ''UNKNOWN_HISTORY_INVALID''; END IF;
    date_value:=(ev->>''date'')::date;
    IF to_char(date_value,''YYYY-MM-DD'')<>ev->>''date'' THEN RAISE EXCEPTION ''UNKNOWN_HISTORY_INVALID''; END IF;
   END IF;
   IF ev->>''precision'' IS DISTINCT FROM (CASE WHEN date_value IS NULL THEN ''unknown'' ELSE ''day'' END)
    OR ev->>''kind'' NOT IN (''visited'',''booked'',''cancelled'') THEN RAISE EXCEPTION ''UNKNOWN_HISTORY_INVALID''; END IF;
   rank_value:=CASE ev->>''kind'' WHEN ''visited'' THEN 0 WHEN ''booked'' THEN 1 ELSE 2 END;
   IF rank_value<last_rank OR date_value<last_date OR (reason_value=''unknown_project'' AND rank_value<>0)
   THEN RAISE EXCEPTION ''UNKNOWN_HISTORY_ORDER_CONFLICT''; END IF;
   IF ev->>''kind''=''booked'' THEN booked_count:=booked_count+1; END IF;
   IF ev->>''kind''=''cancelled'' THEN cancelled_count:=cancelled_count+1; END IF;
   IF booked_count>1 OR cancelled_count>1 OR (ev->>''kind''=''cancelled'' AND booked_count<>1)
   THEN RAISE EXCEPTION ''UNKNOWN_HISTORY_ORDER_CONFLICT''; END IF;
   last_rank:=rank_value; IF date_value IS NOT NULL THEN last_date:=date_value; END IF;
   PERFORM sales_unknown_history_private.insert_exact(''events'',jsonb_build_object(''batch_id'',batch.id,''source_key'',key_value,''event_key'',ev->>''eventKey'',
    ''sequence'',seq_value,''kind'',ev->>''kind'',''occurred_date'',date_value,''precision'',ev->>''precision'',''evidence_ref'',ev->>''evidenceRef''));
  END LOOP;
  IF reason_value=''unknown_booking'' AND (booked_count<>1 OR cancelled_count<>1 OR last_rank<>2)
  THEN RAISE EXCEPTION ''UNKNOWN_HISTORY_ORDER_CONFLICT''; END IF;
 END LOOP;
 RETURN jsonb_build_object(''batchId'',batch.id,''replayed'',false,''records'',jsonb_array_length(p_payload->''records''),''events'',events_count,''businessChanged'',false);
END;
' OR md5(body) IS DISTINCT FROM 'e883a87180854a4d5208bc975c92976c'
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='sales_unknown_history_private.persist_evidence(jsonb)'::regprocedure AND pg_get_userbyid(proowner)=current_user AND prosecdef=false AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[])
  OR (length(definition)-length(replace(definition,body,'')))/length(body)<>1
 THEN RAISE EXCEPTION 'CUSTOMER_OPERATOR_EXACT_ADAPTER_REVIEW_REQUIRED'; END IF;
 EXECUTE replace(definition,body,'
DECLARE actor uuid:=sales_operator_private.actor(); batch sales_unknown_history_private.batches%ROWTYPE;
 src_system text; dataset text; review_ref text; row_value jsonb; ev jsonb; customer_value uuid; interest_value uuid;
 key_value text; customer_key_value text; reason_value text; stage_value text; date_value date; last_date date;
 seq_value integer; rank_value integer; last_rank integer; booked_count integer; cancelled_count integer; events_count integer:=0;
BEGIN
 PERFORM sales_operator_private.authorize_payload(''unknown'',p_payload);
 IF actor IS NULL OR current_user IS DISTINCT FROM (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid=''sales_unknown_history_private.batches''::regclass)
 THEN RAISE EXCEPTION ''UNKNOWN_HISTORY_FORBIDDEN''; END IF;
 PERFORM 1 FROM sales_private.crm_user_roles WHERE user_id=actor AND role=''admin'' AND is_active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION ''UNKNOWN_HISTORY_FORBIDDEN''; END IF;
 PERFORM sales_unknown_history_private.require_object(p_payload,ARRAY[''version'',''sourceSystem'',''datasetKey'',''snapshotSha256'',''mappingReviewRef'',''records'',''businessWritesAllowed'',''leadRequired'']);
 IF p_payload->>''version'' IS DISTINCT FROM ''unknown-historical-evidence-v1''
  OR p_payload->''businessWritesAllowed'' IS DISTINCT FROM ''false''::jsonb OR p_payload->''leadRequired'' IS DISTINCT FROM ''false''::jsonb
  OR jsonb_typeof(p_payload->''snapshotSha256'') IS DISTINCT FROM ''string'' OR (p_payload->>''snapshotSha256'' ~ ''^[a-f0-9]{64}$'') IS DISTINCT FROM true
  OR jsonb_typeof(p_payload->''records'') IS DISTINCT FROM ''array'' OR octet_length(p_payload::text)>8388608
 THEN RAISE EXCEPTION ''UNKNOWN_HISTORY_INVALID''; END IF;
 IF jsonb_array_length(p_payload->''records'') NOT BETWEEN 1 AND 5000 THEN RAISE EXCEPTION ''UNKNOWN_HISTORY_INVALID''; END IF;
 src_system:=sales_unknown_history_private.require_text(p_payload->''sourceSystem'');
 dataset:=sales_unknown_history_private.require_text(p_payload->''datasetKey''); review_ref:=sales_unknown_history_private.require_text(p_payload->''mappingReviewRef'');
 -- Same lock family as the 24 archive; this function only writes its separate archive.
 PERFORM pg_advisory_xact_lock(hashtextextended(''historical-evidence-source:''||src_system,0));
 SELECT * INTO batch FROM sales_unknown_history_private.batches WHERE source_system=src_system AND dataset_key=dataset FOR UPDATE;
 IF FOUND THEN
  IF batch.payload IS DISTINCT FROM p_payload THEN RAISE EXCEPTION ''UNKNOWN_HISTORY_RECONCILIATION_REQUIRED''; END IF;
  RETURN jsonb_build_object(''batchId'',batch.id,''replayed'',true,''records'',jsonb_array_length(p_payload->''records''),
   ''events'',(SELECT count(*) FROM sales_unknown_history_private.events WHERE batch_id=batch.id),''businessChanged'',false);
 END IF;
 batch.id:=gen_random_uuid(); batch.source_system:=src_system; batch.dataset_key:=dataset; batch.snapshot_sha256:=p_payload->>''snapshotSha256'';
 batch.mapping_review_ref:=review_ref; batch.payload:=p_payload; batch.reviewer_id:=actor; batch.recorded_at:=clock_timestamp();
 PERFORM sales_unknown_history_private.insert_exact(''batches'',to_jsonb(batch));
 PERFORM 1 FROM public.sales_customers WHERE id IN(SELECT sales_unknown_history_private.require_uuid(r->''customerId'') FROM jsonb_array_elements(p_payload->''records'') r) ORDER BY id FOR SHARE;
 PERFORM 1 FROM public.lead_project_interests WHERE id IN(SELECT sales_unknown_history_private.require_uuid(r->''interestId'') FROM jsonb_array_elements(p_payload->''records'') r WHERE r->''interestId''<>''null''::jsonb) ORDER BY id FOR SHARE;
 FOR row_value IN SELECT value FROM jsonb_array_elements(p_payload->''records'') LOOP
  PERFORM sales_unknown_history_private.require_object(row_value,ARRAY[''sourceKey'',''rowNumber'',''rowSha256'',''customerKey'',''customerId'',''interestId'',''saleId'',''reason'',''sourceStage'',''events'']);
  IF jsonb_typeof(row_value->''sourceKey'') IS DISTINCT FROM ''string'' OR (row_value->>''sourceKey'' ~ ''^[a-f0-9]{64}$'') IS DISTINCT FROM true
   OR jsonb_typeof(row_value->''rowSha256'') IS DISTINCT FROM ''string'' OR (row_value->>''rowSha256'' ~ ''^[a-f0-9]{64}$'') IS DISTINCT FROM true
   OR jsonb_typeof(row_value->''rowNumber'') IS DISTINCT FROM ''number'' OR (row_value->>''rowNumber'' ~ ''^[0-9]+$'') IS DISTINCT FROM true
   OR row_value->''saleId'' IS DISTINCT FROM ''null''::jsonb OR jsonb_typeof(row_value->''events'') IS DISTINCT FROM ''array''
  THEN RAISE EXCEPTION ''UNKNOWN_HISTORY_INVALID''; END IF;
  key_value:=row_value->>''sourceKey''; customer_key_value:=sales_unknown_history_private.require_text(row_value->''customerKey'');
  customer_value:=sales_unknown_history_private.require_uuid(row_value->''customerId'');
  interest_value:=CASE WHEN row_value->''interestId''=''null''::jsonb THEN NULL ELSE sales_unknown_history_private.require_uuid(row_value->''interestId'') END;
  reason_value:=sales_unknown_history_private.require_text(row_value->''reason''); stage_value:=sales_unknown_history_private.require_text(row_value->''sourceStage'');
  IF NOT ((reason_value=''unknown_project'' AND stage_value=''visited'' AND interest_value IS NULL)
   OR (reason_value=''unknown_booking'' AND stage_value=''cancelled'')) THEN RAISE EXCEPTION ''UNKNOWN_HISTORY_INVALID''; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.sales_customers WHERE id=customer_value AND merged_into_customer_id IS NULL)
   OR (interest_value IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.lead_project_interests WHERE id=interest_value AND customer_id=customer_value))
   OR EXISTS(SELECT 1 FROM sales_unknown_history_private.records WHERE source_system=src_system AND
    ((customer_key=customer_key_value AND customer_id<>customer_value) OR (customer_id=customer_value AND customer_key<>customer_key_value)))
  THEN RAISE EXCEPTION ''UNKNOWN_HISTORY_MAPPING_CONFLICT''; END IF;
  IF jsonb_array_length(row_value->''events'') NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION ''UNKNOWN_HISTORY_INVALID''; END IF;
  PERFORM sales_unknown_history_private.insert_exact(''records'',jsonb_build_object(''batch_id'',batch.id,''source_system'',src_system,''source_key'',key_value,
   ''row_number'',(row_value->>''rowNumber'')::integer,''row_sha256'',row_value->>''rowSha256'',''customer_key'',customer_key_value,''customer_id'',customer_value,
   ''interest_id'',interest_value,''sale_id'',NULL,''reason'',reason_value,''source_stage'',stage_value,''payload'',row_value));
  seq_value:=0; last_rank:=-1; last_date:=NULL; booked_count:=0; cancelled_count:=0;
  FOR ev IN SELECT value FROM jsonb_array_elements(row_value->''events'') LOOP
   events_count:=events_count+1; IF events_count>20000 THEN RAISE EXCEPTION ''UNKNOWN_HISTORY_INVALID''; END IF;
   PERFORM sales_unknown_history_private.require_object(ev,ARRAY[''eventKey'',''kind'',''sequence'',''date'',''precision'',''evidenceRef'']);
   PERFORM sales_unknown_history_private.require_text(ev->''eventKey''); PERFORM sales_unknown_history_private.require_text(ev->''evidenceRef'');
   PERFORM sales_unknown_history_private.require_text(ev->''kind'');
   IF jsonb_typeof(ev->''sequence'') IS DISTINCT FROM ''number'' OR (ev->>''sequence'' ~ ''^[0-9]+$'') IS DISTINCT FROM true
    OR (ev->>''sequence'')::integer<>seq_value+1 THEN RAISE EXCEPTION ''UNKNOWN_HISTORY_INVALID''; END IF;
   seq_value:=seq_value+1; date_value:=NULL;
   IF ev->''date''<>''null''::jsonb THEN
    IF jsonb_typeof(ev->''date'') IS DISTINCT FROM ''string'' OR (ev->>''date'' ~ ''^[0-9]{4}-[0-9]{2}-[0-9]{2}$'') IS DISTINCT FROM true
     OR NOT pg_input_is_valid(ev->>''date'',''date'') THEN RAISE EXCEPTION ''UNKNOWN_HISTORY_INVALID''; END IF;
    date_value:=(ev->>''date'')::date;
    IF to_char(date_value,''YYYY-MM-DD'')<>ev->>''date'' THEN RAISE EXCEPTION ''UNKNOWN_HISTORY_INVALID''; END IF;
   END IF;
   IF ev->>''precision'' IS DISTINCT FROM (CASE WHEN date_value IS NULL THEN ''unknown'' ELSE ''day'' END)
    OR ev->>''kind'' NOT IN (''visited'',''booked'',''cancelled'') THEN RAISE EXCEPTION ''UNKNOWN_HISTORY_INVALID''; END IF;
   rank_value:=CASE ev->>''kind'' WHEN ''visited'' THEN 0 WHEN ''booked'' THEN 1 ELSE 2 END;
   IF rank_value<last_rank OR date_value<last_date OR (reason_value=''unknown_project'' AND rank_value<>0)
   THEN RAISE EXCEPTION ''UNKNOWN_HISTORY_ORDER_CONFLICT''; END IF;
   IF ev->>''kind''=''booked'' THEN booked_count:=booked_count+1; END IF;
   IF ev->>''kind''=''cancelled'' THEN cancelled_count:=cancelled_count+1; END IF;
   IF booked_count>1 OR cancelled_count>1 OR (ev->>''kind''=''cancelled'' AND booked_count<>1)
   THEN RAISE EXCEPTION ''UNKNOWN_HISTORY_ORDER_CONFLICT''; END IF;
   last_rank:=rank_value; IF date_value IS NOT NULL THEN last_date:=date_value; END IF;
   PERFORM sales_unknown_history_private.insert_exact(''events'',jsonb_build_object(''batch_id'',batch.id,''source_key'',key_value,''event_key'',ev->>''eventKey'',
    ''sequence'',seq_value,''kind'',ev->>''kind'',''occurred_date'',date_value,''precision'',ev->>''precision'',''evidence_ref'',ev->>''evidenceRef''));
  END LOOP;
  IF reason_value=''unknown_booking'' AND (booked_count<>1 OR cancelled_count<>1 OR last_rank<>2)
  THEN RAISE EXCEPTION ''UNKNOWN_HISTORY_ORDER_CONFLICT''; END IF;
 END LOOP;
 RETURN jsonb_build_object(''batchId'',batch.id,''replayed'',false,''records'',jsonb_array_length(p_payload->''records''),''events'',events_count,''businessChanged'',false);
END;
');
 INSERT INTO sales_operator_private.adapters VALUES('sales_unknown_history_private.persist_evidence(jsonb)','e883a87180854a4d5208bc975c92976c','107a32da9b3f6ce6a5bdc0b0cda2856e',ARRAY['search_path=pg_catalog']::text[],false);
END;
$operator_adapter_31$;

-- DESIGN ONLY. Compose after 25-33 and the complete source membership install.
-- Read wrappers leave the original immutable reader/adapter bodies untouched.
-- No business writes, flags, Auth changes, identity inference or data import.

-- Design sentinel cleared only in this reviewed installation artifact.
CREATE SCHEMA sales_workspace_read_private;
REVOKE ALL ON SCHEMA sales_workspace_read_private FROM PUBLIC,anon,authenticated,service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA sales_workspace_read_private REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

CREATE FUNCTION sales_workspace_read_private.membership_metadata(p_include_legacy_scope boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE revision uuid; result jsonb;
BEGIN
 SELECT revision_id INTO revision FROM customer_source_membership_private.head;
 IF revision IS NOT NULL AND (SELECT count(*) FROM customer_source_membership_private.members WHERE revision_id=revision)<>958
 THEN RAISE EXCEPTION 'CRM_PROJECT_SALES_SETUP_REQUIRED'; END IF;
 SELECT jsonb_build_object('active',revision IS NOT NULL,'revisionId',revision,
  'legacyScopeIncluded',revision IS NOT NULL AND p_include_legacy_scope,
  'originalLegacyLeadIds',CASE WHEN revision IS NULL OR NOT p_include_legacy_scope THEN '[]'::jsonb ELSE
   (SELECT coalesce(jsonb_agg(id ORDER BY id),'[]') FROM customer_source_membership_private.scope_leads) END) INTO result;
 RETURN result;
END; $$;

CREATE FUNCTION sales_workspace_read_private.history_metadata(p_customer uuid,p_interest uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog SET timezone='UTC' AS $$
 WITH reviewed AS (
  SELECT m.history FROM customer_source_membership_private.members m
  JOIN customer_source_membership_private.head h ON h.revision_id=m.revision_id
  WHERE m.customer_id=p_customer AND (p_interest IS NULL OR m.interest_id=p_interest)
 ), source_visit AS (
  SELECT min(e->>'date') AS day FROM reviewed r CROSS JOIN LATERAL jsonb_array_elements(r.history) e
  WHERE e->>'kind'='visited' AND e->>'precision'='day' AND e->>'date' IS NOT NULL
 ), native_visit AS (
  SELECT min(to_char(v.checked_in_at AT TIME ZONE 'Asia/Bangkok','YYYY-MM-DD')) AS day
  FROM public.lead_visits v JOIN customer_source_membership_private.interests i ON i.id=v.project_interest_id
  WHERE i.customer_id=p_customer AND (p_interest IS NULL OR i.id=p_interest) AND v.status<>'cancelled'
 )
 SELECT jsonb_build_object('sourceKind',CASE WHEN EXISTS(SELECT 1 FROM reviewed) THEN 'reviewed_import' ELSE 'native' END,
  'visitHistoryDate',CASE WHEN EXISTS(SELECT 1 FROM reviewed) THEN (SELECT day FROM source_visit) ELSE (SELECT day FROM native_visit) END);
$$;

CREATE FUNCTION public.crm_v2_workspace_capabilities()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF auth.uid() IS NULL OR coalesce(public.crm_v2_role(),'') NOT IN('sales','admin','owner') THEN RAISE EXCEPTION 'CRM_PROJECT_SALES_FORBIDDEN'; END IF;
 RETURN jsonb_build_object('contract_version','source_membership_workspace_v1','enabled',
  coalesce((public.crm_v2_capabilities()->>'enabled')::boolean,false)
  AND coalesce((public.crm_v2_central_search_capabilities()->>'enabled')::boolean,false)
  AND coalesce((public.crm_v2_project_sales_capabilities()->>'enabled')::boolean,false),
  'sourceMembership',sales_workspace_read_private.membership_metadata());
END; $$;

CREATE FUNCTION public.crm_v2_workspace_project_sales(p_project_name text DEFAULT NULL,p_tab text DEFAULT 'booked',p_query text DEFAULT '',p_page integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE snapshot jsonb; rows_json jsonb; metadata jsonb;
BEGIN
 -- The original reader supplies identical authorization, scope validation,
 -- imported-round integrity, membership predicates, ordering and pagination.
 snapshot:=public.crm_v2_project_sales(p_project_name,p_tab,p_query,p_page);
 metadata:=sales_workspace_read_private.membership_metadata(false);
 IF (metadata->>'active')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'CRM_PROJECT_SALES_SETUP_REQUIRED'; END IF;
 SELECT coalesce(jsonb_agg(item || jsonb_build_object(
   'bankName',CASE WHEN dc.sale_id IS NULL THEN NULLIF(sales_private.crm_customer_deal_details_trim(s.bank_name),'') ELSE dc.bank_name END,
   'expectedTransferDate',sales_import_private.expected_transfer_date(s.id,s.expected_transfer_date::text),
   'leadId',s.lead_id) || sales_workspace_read_private.history_metadata(i.customer_id,i.id) ORDER BY ordinal),'[]')
 INTO rows_json FROM jsonb_array_elements(snapshot->'rows') WITH ORDINALITY AS items(item,ordinal)
 JOIN customer_source_membership_private.sales s ON s.id=(item->>'saleId')::uuid
 JOIN customer_source_membership_private.interests i ON i.id=s.project_interest_id
 LEFT JOIN sales_private.deal_details_corrections dc ON dc.sale_id=s.id;
 IF jsonb_array_length(rows_json)<>jsonb_array_length(snapshot->'rows') THEN RAISE EXCEPTION 'CRM_PROJECT_SALES_SETUP_REQUIRED'; END IF;
 RETURN snapshot || jsonb_build_object('rows',rows_json,'sourceMembership',metadata);
END; $$;

CREATE FUNCTION public.crm_v2_workspace_central_search(p_filters jsonb,p_page integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE snapshot jsonb; rows_json jsonb; metadata jsonb;
BEGIN
 snapshot:=public.crm_v2_central_search(p_filters,p_page);
 metadata:=sales_workspace_read_private.membership_metadata(p_page=0);
 IF (metadata->>'active')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'CRM_SETUP_REQUIRED'; END IF;
 SELECT coalesce(jsonb_agg(item || sales_workspace_read_private.history_metadata((item->>'id')::uuid,NULL) || jsonb_build_object(
  'interests',(SELECT coalesce(jsonb_agg(interest || sales_workspace_read_private.history_metadata((item->>'id')::uuid,(interest->>'id')::uuid) ORDER BY n),'[]')
   FROM jsonb_array_elements(item->'interests') WITH ORDINALITY AS nested(interest,n))) ORDER BY ordinal),'[]')
 INTO rows_json FROM jsonb_array_elements(snapshot->'customers') WITH ORDINALITY AS items(item,ordinal);
 RETURN snapshot || jsonb_build_object('customers',rows_json,'sourceMembership',metadata);
END; $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA sales_workspace_read_private FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.crm_v2_workspace_capabilities(),public.crm_v2_workspace_project_sales(text,text,text,integer),public.crm_v2_workspace_central_search(jsonb,integer) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.crm_v2_workspace_capabilities(),public.crm_v2_workspace_project_sales(text,text,text,integer),public.crm_v2_workspace_central_search(jsonb,integer) TO authenticated;

-- DESIGN ONLY. Install with the exact reviewed activation-seal adapter after
-- 20-34; installation is inert. Activation follows the completed owner job.
-- The DB owner is the operator; no human Auth identity is impersonated.

-- Design sentinel cleared only in this reviewed installation artifact.
CREATE SCHEMA sales_activation_private;
REVOKE ALL ON SCHEMA sales_activation_private FROM PUBLIC,anon,authenticated,service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA sales_activation_private REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
CREATE TABLE sales_activation_private.adapters(signature text PRIMARY KEY,before_md5 text NOT NULL,after_md5 text NOT NULL,settings text[],security_definer boolean NOT NULL);
CREATE TABLE sales_activation_private.releases(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),run_id uuid NOT NULL UNIQUE REFERENCES sales_recovery_private.seals(run_id),
 revision_id uuid NOT NULL REFERENCES customer_source_membership_private.revisions(id),
 before_settings jsonb NOT NULL,after_settings jsonb NOT NULL,review_reference text NOT NULL CHECK(length(btrim(review_reference))>0),
 operator_role name NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE sales_activation_private.restorations(
 release_id uuid PRIMARY KEY REFERENCES sales_activation_private.releases(id),review_reference text NOT NULL CHECK(length(btrim(review_reference))>0),
 operator_role name NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE sales_activation_private.permits(
 transaction_id bigint NOT NULL,backend_pid integer NOT NULL,operator_role name NOT NULL,
 old_settings jsonb NOT NULL,new_settings jsonb NOT NULL,PRIMARY KEY(transaction_id,backend_pid));
CREATE FUNCTION sales_activation_private.require_owner() RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF current_user IS DISTINCT FROM session_user OR current_user IS DISTINCT FROM
  (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid='sales_activation_private.releases'::regclass)
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='POST_BOOKING_ACTIVATION_DB_OWNER_REQUIRED'; END IF;
 PERFORM sales_operator_private.require_owner();
END; $$;
CREATE FUNCTION sales_activation_private.sealed() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'POST_BOOKING_ACTIVATION_LEDGER_IMMUTABLE'; END; $$;
DO $private_tables$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['adapters','releases','restorations','permits'] LOOP
  EXECUTE format('ALTER TABLE sales_activation_private.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON sales_activation_private.%I FROM PUBLIC,anon,authenticated,service_role',t);
  EXECUTE format('CREATE TRIGGER activation_no_truncate BEFORE TRUNCATE ON sales_activation_private.%I FOR EACH STATEMENT EXECUTE FUNCTION sales_activation_private.sealed()',t);
  IF t<>'permits' THEN EXECUTE format('CREATE TRIGGER activation_immutable BEFORE UPDATE OR DELETE ON sales_activation_private.%I FOR EACH STATEMENT EXECUTE FUNCTION sales_activation_private.sealed()',t); END IF;
 END LOOP;
END; $private_tables$;
CREATE FUNCTION sales_activation_private.settings_valid(p_settings jsonb,p_enabled boolean)
RETURNS boolean LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT p_settings @> '{"id":true,"central_intake_enabled":true,"lead_work_enabled":true,"lead_lifecycle_enabled":true,"booking_enabled":true,"booking_cutover_reviewed":true,"visits_enabled":true,"visit_sop_enabled":true,"customer_voices_enabled":true}'::jsonb
  AND p_settings->'post_booking_enabled'=to_jsonb(p_enabled)
  AND NOT EXISTS(SELECT 1 FROM jsonb_each(p_settings) j WHERE
    (j.key LIKE '%\_enabled' ESCAPE '\' OR j.key='booking_cutover_reviewed')
    AND j.key NOT IN('central_intake_enabled','lead_work_enabled','lead_lifecycle_enabled','booking_enabled',
      'booking_cutover_reviewed','visits_enabled','visit_sop_enabled','customer_voices_enabled','post_booking_enabled')
    AND j.value IS DISTINCT FROM 'false'::jsonb);
$$;
CREATE FUNCTION sales_activation_private.settings_allowed(p_old jsonb,p_new jsonb)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF current_user IS DISTINCT FROM session_user OR current_user IS DISTINCT FROM
  (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid='sales_activation_private.releases'::regclass)
 THEN RETURN false; END IF;
 RETURN p_old IS NOT NULL AND p_old-'post_booking_enabled'=p_new-'post_booking_enabled'
  AND ((sales_activation_private.settings_valid(p_old,false) AND sales_activation_private.settings_valid(p_new,true))
    OR (sales_activation_private.settings_valid(p_old,true) AND sales_activation_private.settings_valid(p_new,false)))
  AND EXISTS(SELECT 1 FROM sales_activation_private.permits p WHERE p.transaction_id=txid_current()
    AND p.backend_pid=pg_backend_pid() AND p.operator_role=current_user AND p.old_settings=p_old AND p.new_settings=p_new);
END; $$;
CREATE FUNCTION sales_activation_private.assert_catalog() RETURNS void LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM sales_activation_private.require_owner();
 IF (SELECT count(*) FROM sales_activation_private.adapters)<>1 OR NOT EXISTS(
  SELECT 1 FROM sales_activation_private.adapters a JOIN pg_proc p ON p.oid=to_regprocedure(a.signature)
  WHERE a.signature='crm_external_private.reject_unreviewed_activation()'
    AND a.before_md5='d9679ba1d8fa229c754033144ec0bf42'
    AND a.after_md5=md5(replace(p.prosrc,E'\r\n',E'\n')) AND a.settings IS NOT DISTINCT FROM p.proconfig
    AND a.security_definer=p.prosecdef AND NOT p.prosecdef AND pg_get_userbyid(p.proowner)=current_user)
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.crm_settings'::regclass
    AND tgname='external_bridge_activation_seal' AND NOT tgisinternal AND tgenabled='O' AND tgtype=23
    AND tgfoid='crm_external_private.reject_unreviewed_activation()'::regprocedure AND tgnargs=0 AND tgqual IS NULL)
 THEN RAISE EXCEPTION 'POST_BOOKING_ACTIVATION_CATALOG_DRIFT'; END IF;
 IF EXISTS(SELECT 1 FROM (VALUES
  ('customer_source_membership_private.revisions','membership_immutable',27,'customer_source_membership_private.sealed()'),
  ('customer_source_membership_private.revisions','membership_no_truncate',34,'customer_source_membership_private.sealed()'),
  ('customer_source_membership_private.members','membership_immutable',27,'customer_source_membership_private.sealed()'),
  ('customer_source_membership_private.members','membership_no_truncate',34,'customer_source_membership_private.sealed()'),
  ('customer_source_membership_private.head','membership_no_truncate',34,'customer_source_membership_private.sealed()'),
  ('crm_external_private.snapshot_batches','immutable_history',58,'crm_external_private.reject_history_change()'),
  ('crm_external_private.source_records','immutable_history',58,'crm_external_private.reject_history_change()')
 ) expected(relation_name,trigger_name,trigger_type,function_name)
 LEFT JOIN pg_trigger t ON t.tgrelid=to_regclass(expected.relation_name) AND t.tgname=expected.trigger_name AND NOT t.tgisinternal
 WHERE t.oid IS NULL OR t.tgenabled<>'O' OR t.tgtype<>expected.trigger_type OR t.tgfoid<>to_regprocedure(expected.function_name)
   OR t.tgnargs<>0 OR t.tgqual IS NOT NULL)
  OR EXISTS(SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role']) actor(name)
   WHERE has_schema_privilege(actor.name,'sales_activation_private','USAGE')
    OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='sales_activation_private' AND has_function_privilege(actor.name,p.oid,'EXECUTE')))
 THEN RAISE EXCEPTION 'POST_BOOKING_ACTIVATION_IMMUTABLE_SOURCE_REQUIRED'; END IF;
 PERFORM customer_source_membership_private.assert_catalog();
 PERFORM sales_operator_private.assert_catalog();
END; $$;
CREATE FUNCTION sales_activation_private.require_release_source(p_run uuid) RETURNS uuid LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE revision uuid;
BEGIN
 PERFORM sales_activation_private.assert_catalog();
 SELECT r.id INTO revision FROM customer_source_membership_private.head h
  JOIN customer_source_membership_private.revisions r ON r.id=h.revision_id
  WHERE h.id AND r.dataset_key='full-cohort-379da2e538829a3cb0379108b98851757c142eb010b1624543413116eef8a506'
   AND r.payload->>'sourceSha256'='7193857ef04d6a092171749a25867b1ca8d1bbe8f7b83b04fa7473b3a3a69ffd'
   AND r.payload->>'reviewSha256'='de4beaee70afa8de9e8866e328eabf8bdd25257eae7aa78eb89649712f381802'
   AND r.payload->>'adapterPlanDigest'='379da2e538829a3cb0379108b98851757c142eb010b1624543413116eef8a506'
   AND r.payload->'originalSourceBatchIds'='["5d3f05d2-2a5d-44ed-a0e3-9385b8ace3a5"]'::jsonb
   AND jsonb_array_length(r.payload->'records')=958;
 IF revision IS NULL OR (SELECT count(*) FROM customer_source_membership_private.members WHERE revision_id=revision)<>958
  OR (SELECT count(DISTINCT customer_id) FROM customer_source_membership_private.members WHERE revision_id=revision)<>957
  OR (SELECT count(DISTINCT interest_id) FROM customer_source_membership_private.members WHERE revision_id=revision)<>948
  OR (SELECT count(DISTINCT sale_id) FROM customer_source_membership_private.members WHERE revision_id=revision)<>298
  OR NOT EXISTS(SELECT 1 FROM crm_external_private.snapshot_batches WHERE id='5d3f05d2-2a5d-44ed-a0e3-9385b8ace3a5' AND source_sha256='9ad3ddc7644e673de9d180d064f1939ff3fe267b1c6989c3124620c2320f8b23')
  OR (SELECT count(*) FROM crm_external_private.source_records WHERE batch_id='5d3f05d2-2a5d-44ed-a0e3-9385b8ace3a5')<>965
  OR NOT EXISTS(SELECT 1 FROM sales_recovery_private.runs r JOIN sales_recovery_private.seals s ON s.run_id=r.id
   JOIN sales_operator_private.receipts receipt ON receipt.recovery_run_id=r.id
   JOIN sales_operator_private.jobs job ON job.id=receipt.job_id
   WHERE r.id=p_run AND r.dataset_key='full-replacement-379da2e538829a3cb0379108b98851757c142eb010b1624543413116eef8a506'
    AND r.source_sha256='7193857ef04d6a092171749a25867b1ca8d1bbe8f7b83b04fa7473b3a3a69ffd'
    AND job.manifest->>'mode'='apply' AND receipt.source_rows=958 AND NOT receipt.reviewer_is_authenticated_actor
    AND receipt.executed_by_db_role=current_user AND receipt.session_db_role=session_user
    AND s.after_state->'head' @> jsonb_build_array(jsonb_build_object('revision_id',revision))
    AND NOT EXISTS(SELECT 1 FROM sales_recovery_private.recoveries WHERE run_id=p_run))
 THEN RAISE EXCEPTION 'POST_BOOKING_ACTIVATION_WHOLE_SOURCE_REQUIRED'; END IF;
 RETURN revision;
END; $$;
CREATE FUNCTION sales_activation_private.activate(p_run uuid,p_review text) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE revision uuid;before_row jsonb;after_row jsonb;release uuid;
BEGIN
 PERFORM sales_activation_private.require_owner();
 IF coalesce(length(btrim(p_review)),0)=0 OR length(p_review)>1000 THEN RAISE EXCEPTION 'POST_BOOKING_ACTIVATION_REVIEW_REQUIRED'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('crm-booking-command',0));
 PERFORM 1 FROM customer_source_membership_private.head FOR SHARE;
 revision:=sales_activation_private.require_release_source(p_run);
 SELECT to_jsonb(s) INTO STRICT before_row FROM public.crm_settings s WHERE s.id FOR UPDATE;
 IF NOT sales_activation_private.settings_valid(before_row,false)
  OR EXISTS(SELECT 1 FROM sales_activation_private.releases WHERE run_id=p_run)
  OR NOT EXISTS(SELECT 1 FROM sales_recovery_private.seals WHERE run_id=p_run AND after_state->'public'->'crm_settings'=jsonb_build_array(before_row))
 THEN RAISE EXCEPTION 'POST_BOOKING_ACTIVATION_SETTINGS_DRIFT'; END IF;
 after_row:=before_row||'{"post_booking_enabled":true}'::jsonb;
 INSERT INTO sales_activation_private.permits VALUES(txid_current(),pg_backend_pid(),current_user,before_row,after_row);
 UPDATE public.crm_settings SET post_booking_enabled=true WHERE id;
 DELETE FROM sales_activation_private.permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid();
 IF (SELECT to_jsonb(s) FROM public.crm_settings s WHERE s.id) IS DISTINCT FROM after_row THEN RAISE EXCEPTION 'POST_BOOKING_ACTIVATION_SETTINGS_DRIFT'; END IF;
 INSERT INTO sales_activation_private.releases(run_id,revision_id,before_settings,after_settings,review_reference,operator_role)
  VALUES(p_run,revision,before_row,after_row,p_review,current_user) RETURNING id INTO release;
 RETURN jsonb_build_object('releaseId',release,'postBookingEnabled',true,'humanAuthenticatedActor',false);
END; $$;
CREATE FUNCTION sales_activation_private.restore(p_release uuid,p_review text) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE release sales_activation_private.releases%ROWTYPE;before_row jsonb;
BEGIN
 PERFORM sales_activation_private.require_owner();
 IF coalesce(length(btrim(p_review)),0)=0 OR length(p_review)>1000 THEN RAISE EXCEPTION 'POST_BOOKING_ACTIVATION_REVIEW_REQUIRED'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('crm-booking-command',0));
 SELECT * INTO STRICT release FROM sales_activation_private.releases WHERE id=p_release FOR SHARE;
 PERFORM 1 FROM customer_source_membership_private.head FOR SHARE;
 IF sales_activation_private.require_release_source(release.run_id) IS DISTINCT FROM release.revision_id
  OR EXISTS(SELECT 1 FROM sales_activation_private.restorations WHERE release_id=p_release) THEN RAISE EXCEPTION 'POST_BOOKING_ACTIVATION_RESTORE_CONFLICT'; END IF;
 SELECT to_jsonb(s) INTO STRICT before_row FROM public.crm_settings s WHERE s.id FOR UPDATE;
 IF before_row IS DISTINCT FROM release.after_settings THEN RAISE EXCEPTION 'POST_BOOKING_ACTIVATION_SETTINGS_DRIFT'; END IF;
 INSERT INTO sales_activation_private.permits VALUES(txid_current(),pg_backend_pid(),current_user,release.after_settings,release.before_settings);
 UPDATE public.crm_settings SET post_booking_enabled=false WHERE id;
 DELETE FROM sales_activation_private.permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid();
 IF (SELECT to_jsonb(s) FROM public.crm_settings s WHERE s.id) IS DISTINCT FROM release.before_settings THEN RAISE EXCEPTION 'POST_BOOKING_ACTIVATION_SETTINGS_DRIFT'; END IF;
 INSERT INTO sales_activation_private.restorations VALUES(p_release,p_review,current_user,now());
 RETURN jsonb_build_object('releaseId',p_release,'postBookingEnabled',false,'exactOriginalSettingsRestored',true);
END; $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA sales_activation_private FROM PUBLIC,anon,authenticated,service_role;

DO $post_booking_reviewed_adapter$
DECLARE definition text;body text;
BEGIN
 PERFORM sales_activation_private.require_owner();
 SELECT replace(pg_get_functiondef(oid),E'\r\n',E'\n'),replace(prosrc,E'\r\n',E'\n') INTO definition,body FROM pg_proc WHERE oid='crm_external_private.reject_unreviewed_activation()'::regprocedure;
 IF body IS DISTINCT FROM '
DECLARE allowed boolean:=false;
BEGIN
  IF EXISTS(SELECT 1 FROM jsonb_each(to_jsonb(NEW)) j
    WHERE (j.key LIKE ''%\_enabled'' ESCAPE ''\'' OR j.key=''booking_cutover_reviewed'') AND j.value=''true'') THEN
    allowed:=crm_external_private.booking_activation_allowed(to_jsonb(NEW));
    IF allowed IS DISTINCT FROM true AND TG_OP=''UPDATE'' THEN
      allowed:=crm_external_private.visit_workflow_activation_allowed(to_jsonb(OLD),to_jsonb(NEW));
    END IF;
    IF allowed IS DISTINCT FROM true THEN RAISE EXCEPTION ''EXTERNAL_CRM_ACTIVATION_REVIEW_REQUIRED''; END IF;
  END IF;
  RETURN NEW;
END;
' OR md5(body) IS DISTINCT FROM 'd9679ba1d8fa229c754033144ec0bf42'
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='crm_external_private.reject_unreviewed_activation()'::regprocedure AND pg_get_userbyid(proowner)=current_user AND NOT prosecdef AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=""'])
  OR (length(definition)-length(replace(definition,body,'')))/length(body)<>1
 THEN RAISE EXCEPTION 'POST_BOOKING_ACTIVATION_EXACT_ADAPTER_REVIEW_REQUIRED'; END IF;
 EXECUTE replace(definition,body,'
DECLARE allowed boolean:=false;
BEGIN
  IF EXISTS(SELECT 1 FROM jsonb_each(to_jsonb(NEW)) j
    WHERE (j.key LIKE ''%\_enabled'' ESCAPE ''\'' OR j.key=''booking_cutover_reviewed'') AND j.value=''true'') THEN
    allowed:=crm_external_private.booking_activation_allowed(to_jsonb(NEW));
    IF allowed IS DISTINCT FROM true AND TG_OP=''UPDATE'' THEN
      allowed:=crm_external_private.visit_workflow_activation_allowed(to_jsonb(OLD),to_jsonb(NEW));
    END IF;
    IF allowed IS DISTINCT FROM true AND TG_OP=''UPDATE'' THEN
      allowed:=sales_activation_private.settings_allowed(to_jsonb(OLD),to_jsonb(NEW));
    END IF;
    IF allowed IS DISTINCT FROM true THEN RAISE EXCEPTION ''EXTERNAL_CRM_ACTIVATION_REVIEW_REQUIRED''; END IF;
  END IF;
  RETURN NEW;
END;
');
 INSERT INTO sales_activation_private.adapters VALUES('crm_external_private.reject_unreviewed_activation()','d9679ba1d8fa229c754033144ec0bf42','6a792536781db79ac1e9ad7e48932797',ARRAY['search_path=""'],false);
 PERFORM sales_activation_private.assert_catalog();
END;
$post_booking_reviewed_adapter$;
COMMIT;
