-- CUSTOMER/DEAL OPERATIONAL CORRECTIONS -- DESIGN ONLY. Never execute on Supabase.
-- Source snapshots, identity, booked money, dates, ownership and business stages stay sealed.
-- Depends on reviewed base +04/05/18/19/20/21. No activation or external installer.
BEGIN;
DO $draft_only$
BEGIN
  RAISE EXCEPTION 'DESIGN ONLY: customer deal details require isolated verification and reviewed activation';
END;
$draft_only$;

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
ROLLBACK;
