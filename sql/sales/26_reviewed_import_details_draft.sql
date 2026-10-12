-- DESIGN ONLY. Existing imported Sale corrections, never a booking/status importer.
-- Completed imported transfers accept forecast-only P evidence, with no price,
-- bank, actual-date, lifecycle or stock edit. Operational money stays sealed.
-- Requires reviewed base +04/05/18/19/20/21/22 and external provenance.
-- Source rows, operational dates, bank, ownership, occupancy and stages stay sealed.
-- The restricted import operator must supply freshly captured exact before-images.
BEGIN;
DO $draft_only$
BEGIN
  RAISE EXCEPTION 'DESIGN ONLY: reviewed import details require isolated verification and separate installation review';
END;
$draft_only$;

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
ROLLBACK;
