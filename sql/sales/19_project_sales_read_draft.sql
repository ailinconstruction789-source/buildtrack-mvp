-- SALES V2 PROJECT BOOKING READER -- DESIGN ONLY, 2026-09-23.
-- NEVER RUN ON SUPABASE. Depends on the guarded base + 04/05/18 drafts.
-- Read-only projection of actual sale rounds, not a per-project Lead workspace.
-- No backfill, legacy writer retirement, flag changes, stock changes or deploy.
-- The reviewed legacy schema must expose plots.plot_name as nullable text.
BEGIN;
DO $draft_only$
BEGIN
  RAISE EXCEPTION 'DESIGN ONLY: project sales reader is not authorized for database execution';
END;
$draft_only$;

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

ROLLBACK;
