-- SALES V2 BOOKING/LEAD-COHORT REPORT -- DESIGN ONLY, 2026-09-23.
-- NEVER RUN ON SUPABASE. Depends on guarded base + 04/05/18/19 drafts.
-- Read-only aggregate, not event-month KPI, staff attribution or score calculation.
-- No individual customer data, migration/backfill, flag changes or deployment.
BEGIN;
DO $draft_only$
BEGIN
  RAISE EXCEPTION 'DESIGN ONLY: sales reports reader is not authorized for database execution';
END;
$draft_only$;

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
          'loan_rejected','loan_approved','transfer_pending','transferred','handover','cancelled') OR s.booking_round IS NULL
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

ROLLBACK;
