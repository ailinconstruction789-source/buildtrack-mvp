-- LOCAL DESIGN ONLY. Administrative retirement is not customer cancellation.
-- Six reviewed source rows only; preserve Customer, Interest and immutable source.
-- Requires reviewed 18/21/22/25-29 and the actual plot writer/sync guards.
-- No public RPC, remote installer, flag changes or production execution.
BEGIN;
DO $draft_only$
BEGIN
 RAISE EXCEPTION 'DESIGN ONLY: rental-source retirement requires isolated rehearsal and separate installation review';
END;
$draft_only$;
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
ROLLBACK;
