-- SALES V2 CENTRAL BOOKING/HISTORY -- DESIGN ONLY, 2026-09-23.
-- Depends on the guarded base + 04/05 and reviewed legacy sales money columns.
-- NEVER RUN ON SUPABASE. No backfill, live flag changes, discount approval or deploy.
-- A customer stays in the central workspace; sales rows are project/plot bookings.
BEGIN;
DO $draft_only$
BEGIN
  RAISE EXCEPTION 'DESIGN ONLY: booking history is not authorized for database execution';
END;
$draft_only$;

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
ROLLBACK;
