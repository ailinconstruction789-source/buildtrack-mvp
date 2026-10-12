-- DESIGN ONLY. Exact reviewed source corrections, not an operational cancellation command.
-- No feature activation, fabricated event timestamps, snapshot rewrites or public grants.
-- Requires canonical base/04/05/18/19/20/21/22/26 and reviewed external seal.
BEGIN;
DO $draft_only$
BEGIN
 RAISE EXCEPTION 'DESIGN ONLY: historical sale revision requires isolated verification and installation review';
END;
$draft_only$;

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
ROLLBACK;
