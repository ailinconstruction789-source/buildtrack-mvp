-- ISOLATED DESIGN ONLY. No operational grants, activation or deployment.
BEGIN;
DO $draft_only$
BEGIN
  RAISE EXCEPTION 'DESIGN ONLY: external sales cutover requires isolated verification and operational integration';
END;
$draft_only$;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='30s';

ALTER TABLE public.sales ADD COLUMN external_booking_id uuid UNIQUE
  REFERENCES crm_external_private.prepared_booking_sales(id) ON DELETE RESTRICT;
ALTER TABLE crm_external_private.prepared_booking_sales ADD CONSTRAINT prepared_booking_source_stage_key UNIQUE(id,stage);
ALTER TABLE public.sales ADD COLUMN external_source_stage text,
  ADD CONSTRAINT sales_external_source_stage_fk FOREIGN KEY(external_booking_id,external_source_stage)
    REFERENCES crm_external_private.prepared_booking_sales(id,stage) MATCH FULL ON DELETE RESTRICT;
ALTER TABLE public.sales DROP CONSTRAINT sales_v2_fields_check;
ALTER TABLE public.sales ADD CONSTRAINT sales_v2_fields_check CHECK (
  project_interest_id IS NULL OR (crm_stage IS NOT NULL AND booking_route IS NOT NULL
    AND (booking_round IS NOT NULL OR external_booking_id IS NOT NULL)));
ALTER TABLE public.sales DROP CONSTRAINT sales_v2_cancellation_check;
ALTER TABLE public.sales ADD CONSTRAINT sales_v2_cancellation_check CHECK (
  crm_stage IS DISTINCT FROM 'cancelled'
  OR (coalesce(booking_route='legacy_import',false) AND (legacy_cancellation_batch_id IS NOT NULL
    OR (external_booking_id IS NOT NULL AND coalesce(external_source_stage='cancelled',false))))
  OR (cancelled_at IS NOT NULL AND cancellation_category IS NOT NULL
    AND cancellation_reason IS NOT NULL AND btrim(cancellation_reason)<>''));

CREATE TABLE crm_external_private.sales_cutover_receipts (
  batch_id uuid PRIMARY KEY REFERENCES crm_external_private.booking_release_receipts(batch_id),
  request jsonb NOT NULL, before_sales jsonb NOT NULL, after_sales jsonb NOT NULL,
  before_plot_flags jsonb NOT NULL, after_plot_flags jsonb NOT NULL,
  dependency_image jsonb NOT NULL, response jsonb NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE crm_external_private.sales_rollback_receipts (
  batch_id uuid PRIMARY KEY REFERENCES crm_external_private.sales_cutover_receipts(batch_id),
  request jsonb NOT NULL, response jsonb NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE crm_external_private.sales_cutover_permits (
  transaction_id bigint PRIMARY KEY, backend_pid integer NOT NULL,
  batch_id uuid NOT NULL, operation text NOT NULL CHECK(operation IN ('replace','rollback'))
);

CREATE FUNCTION crm_external_private.cutover_operator_check()
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF current_user IS DISTINCT FROM (SELECT pg_get_userbyid(relowner) FROM pg_class
    WHERE oid='crm_external_private.snapshot_batches'::regclass) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='EXTERNAL_CUTOVER_OPERATOR_REQUIRED';
  END IF;
END;
$$;

-- A private capability, never a caller-controlled setting. Existing trigger
-- arguments preserve the original sales seal before the replacement happens.
-- Only this non-RPC trigger uses DEFINER to inspect the private permit without
-- exposing it to legacy writers. Direct EXECUTE is revoked below; replacement
-- and rollback remain INVOKER and require the schema's database operator.
CREATE FUNCTION crm_external_private.guard_cutover_sale()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
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
$$;
DO $replace_seal$
DECLARE definition text;
BEGIN
  SELECT pg_get_triggerdef(oid) INTO definition FROM pg_trigger
    WHERE tgrelid='public.sales'::regclass AND tgname='crm_foundation_legacy_fields_sealed' AND NOT tgisinternal;
  IF definition IS NULL OR position('sales_private.reject_sealed_legacy_fields' IN definition)=0 THEN
    RAISE EXCEPTION 'EXTERNAL_CUTOVER_FOUNDATION_SEAL_REQUIRED';
  END IF;
  DROP TRIGGER crm_foundation_legacy_fields_sealed ON public.sales;
  EXECUTE replace(definition,'sales_private.reject_sealed_legacy_fields','crm_external_private.guard_cutover_sale');
END;
$replace_seal$;
CREATE TRIGGER external_cutover_delete_seal BEFORE DELETE ON public.sales
  FOR EACH ROW EXECUTE FUNCTION crm_external_private.guard_cutover_sale();
CREATE TRIGGER external_cutover_truncate_seal BEFORE TRUNCATE ON public.sales
  FOR EACH STATEMENT EXECUTE FUNCTION crm_external_private.guard_cutover_sale();

CREATE FUNCTION crm_external_private.cutover_sales_image()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]'::jsonb) FROM public.sales s;
$$;
CREATE FUNCTION crm_external_private.cutover_plot_flags(p_ids jsonb)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'has_customer',p.has_customer,'sale_status',p.sale_status) ORDER BY p.id),'[]'::jsonb)
    FROM public.plots p WHERE p.id IN (SELECT v->>'id' FROM jsonb_array_elements(p_ids) v);
$$;

-- Detect changes that could make a later DELETE cascade or execute different
-- side effects. Table locks in the caller keep this fingerprint stable during DML.
CREATE FUNCTION crm_external_private.cutover_dependency_image()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT jsonb_build_object(
    'columns',(SELECT jsonb_agg(jsonb_build_object('relation',a.attrelid,'name',a.attname,
      'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,'generated',a.attgenerated,
      'default',pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attrelid,a.attnum)
      FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE a.attrelid IN ('public.sales'::regclass,'public.plots'::regclass) AND a.attnum>0 AND NOT a.attisdropped),
    'constraints',(SELECT jsonb_agg(jsonb_build_object('relation',conrelid,'name',conname,'definition',pg_get_constraintdef(oid)) ORDER BY conrelid,conname)
      FROM pg_constraint WHERE conrelid IN ('public.sales'::regclass,'public.plots'::regclass) OR confrelid='public.sales'::regclass),
    'triggers',(SELECT jsonb_agg(jsonb_build_object('definition',pg_get_triggerdef(t.oid),'enabled',t.tgenabled,
      'function',pg_get_functiondef(p.oid),'owner',p.proowner,'acl',p.proacl) ORDER BY t.tgrelid,t.tgname)
      FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
      WHERE t.tgrelid IN ('public.sales'::regclass,'public.plots'::regclass) AND NOT t.tgisinternal),
    'rules',(SELECT jsonb_agg(pg_get_ruledef(oid) ORDER BY ev_class,rulename) FROM pg_rewrite
      WHERE ev_class IN ('public.sales'::regclass,'public.plots'::regclass)),
    'indexes',(SELECT jsonb_agg(pg_get_indexdef(indexrelid) ORDER BY indexrelid)
      FROM pg_index WHERE indrelid='public.sales'::regclass));
$$;

CREATE FUNCTION crm_external_private.revalidate_cutover_identity(p_batch uuid,p_digest text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE receipt crm_external_private.bridge_receipts%ROWTYPE;
BEGIN
  SELECT * INTO receipt FROM crm_external_private.bridge_receipts WHERE batch_id=p_batch;
  IF receipt.batch_id IS NULL THEN RAISE EXCEPTION 'EXTERNAL_CUTOVER_PREPARATION_REQUIRED'; END IF;
  PERFORM crm_external_private.stage_snapshot(payload) FROM crm_external_private.snapshot_batches WHERE id=p_batch;
  PERFORM crm_external_private.materialize_crm(p_batch,p_digest,
    (receipt.request->>'admin')::uuid,receipt.request->'bindings',receipt.request->>'reviewRef');
END;
$$;

CREATE FUNCTION crm_external_private.replace_sales(p_batch uuid,p_plan_digest text,p_review_ref text,p_plot_status_overrides jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' SET lock_timeout='2s' AS $$
DECLARE prep crm_external_private.booking_release_receipts%ROWTYPE;
  identity_receipt crm_external_private.bridge_receipts%ROWTYPE;
  prior crm_external_private.sales_cutover_receipts%ROWTYPE;
  request_value jsonb; before_sales jsonb; before_plots jsonb; before_flags jsonb;
  after_sales jsonb; after_flags jsonb; normalized_sales jsonb; response_value jsonb;
  baseline jsonb; source_count bigint; held_count bigint; affected_ids jsonb; dependency_before jsonb;
BEGIN
  PERFORM crm_external_private.cutover_operator_check();
  IF p_batch IS NULL OR nullif(btrim(p_plan_digest),'') IS NULL OR nullif(btrim(p_review_ref),'') IS NULL
    OR length(p_review_ref)>1000 OR jsonb_typeof(p_plot_status_overrides) IS DISTINCT FROM 'object'
    OR octet_length(p_plot_status_overrides::text)>65536 THEN RAISE EXCEPTION 'EXTERNAL_CUTOVER_INPUT_INVALID'; END IF;
  PERFORM pg_advisory_xact_lock(20260925,3);
  LOCK TABLE public.crm_settings,public.leads,public.sales,public.plots,public.projects,public.customer_voices IN SHARE ROW EXCLUSIVE MODE;
  IF EXISTS(SELECT 1 FROM public.crm_settings s,LATERAL jsonb_each(to_jsonb(s)) j
    WHERE (j.key LIKE '%\_enabled' ESCAPE '\' OR j.key='booking_cutover_reviewed') AND j.value='true') THEN
    RAISE EXCEPTION 'EXTERNAL_CUTOVER_DISABLED_CRM_REQUIRED';
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_each(p_plot_status_overrides) e
    WHERE jsonb_typeof(e.value)<>'string' OR length(e.value#>>'{}') NOT BETWEEN 1 AND 100
      OR (e.value#>>'{}') ~ U&'[\0001-\001F\007F-\009F]'
      OR NOT EXISTS(SELECT 1 FROM public.plots p WHERE p.id=e.key)) THEN
    RAISE EXCEPTION 'EXTERNAL_CUTOVER_PLOT_REVIEW_INVALID';
  END IF;
  -- The review reference covers this exact override map; it is not proof of
  -- user authorization or production-readiness by itself.
  request_value:=jsonb_build_object('planDigest',p_plan_digest,'reviewRef',p_review_ref,'plotStatusOverrides',p_plot_status_overrides);
  SELECT * INTO prior FROM crm_external_private.sales_cutover_receipts WHERE batch_id=p_batch;
  PERFORM crm_external_private.revalidate_cutover_identity(p_batch,p_plan_digest);
  IF prior.batch_id IS NOT NULL THEN
    IF prior.request IS DISTINCT FROM request_value THEN RAISE EXCEPTION 'EXTERNAL_CUTOVER_REPLAY_CHANGED'; END IF;
    IF EXISTS(SELECT 1 FROM crm_external_private.sales_rollback_receipts WHERE batch_id=p_batch) THEN RAISE EXCEPTION 'EXTERNAL_CUTOVER_ALREADY_ROLLED_BACK'; END IF;
    IF prior.dependency_image IS DISTINCT FROM crm_external_private.cutover_dependency_image() THEN
      RAISE EXCEPTION 'EXTERNAL_CUTOVER_DEPENDENCIES_CHANGED';
    END IF;
    IF prior.after_sales IS DISTINCT FROM crm_external_private.cutover_sales_image()
      OR prior.after_plot_flags IS DISTINCT FROM crm_external_private.cutover_plot_flags(prior.after_plot_flags) THEN
      RAISE EXCEPTION 'EXTERNAL_CUTOVER_AFTER_IMAGE_CHANGED';
    END IF;
    RETURN prior.response||jsonb_build_object('replayed',true);
  END IF;
  IF EXISTS(SELECT 1 FROM crm_external_private.sales_cutover_receipts) THEN RAISE EXCEPTION 'EXTERNAL_CUTOVER_SINGLE_RELEASE_REQUIRED'; END IF;
  -- Replacement is only supported before operational sale/self-history FKs exist.
  IF EXISTS(SELECT 1 FROM pg_constraint WHERE contype='f' AND confrelid='public.sales'::regclass
    AND NOT (conrelid='public.sales'::regclass AND conname='sales_previous_sale_id_fkey')
    AND conrelid NOT IN ('public.sale_plot_changes'::regclass,'public.loan_attempts'::regclass,
      'public.lead_activities'::regclass,'public.crm_import_rows'::regclass,'sales_private.crm_legacy_source_snapshots'::regclass))
    OR EXISTS(SELECT 1 FROM public.sale_plot_changes)
    OR EXISTS(SELECT 1 FROM public.loan_attempts WHERE sale_id IS NOT NULL)
    OR EXISTS(SELECT 1 FROM public.lead_activities WHERE sale_id IS NOT NULL)
    OR EXISTS(SELECT 1 FROM public.crm_import_rows WHERE sale_id IS NOT NULL)
    OR EXISTS(SELECT 1 FROM sales_private.crm_legacy_source_snapshots WHERE legacy_sale_id IS NOT NULL)
    OR EXISTS(SELECT 1 FROM public.sales WHERE previous_sale_id IS NOT NULL OR project_interest_id IS NOT NULL)
    OR to_regprocedure('sales_private.crm_booking_protect_sale()') IS NOT NULL
    OR to_regclass('sales_private.post_booking_events') IS NOT NULL THEN
    RAISE EXCEPTION 'EXTERNAL_CUTOVER_OPERATIONAL_DEPENDENCY_PRESENT';
  END IF;
  SELECT * INTO prep FROM crm_external_private.booking_release_receipts WHERE batch_id=p_batch;
  SELECT * INTO identity_receipt FROM crm_external_private.bridge_receipts WHERE batch_id=p_batch;
  IF prep.batch_id IS NULL OR identity_receipt.batch_id IS NULL
    OR prep.request->>'planDigest' IS DISTINCT FROM p_plan_digest
    OR prep.request->'identityRequest' IS DISTINCT FROM identity_receipt.request THEN
    RAISE EXCEPTION 'EXTERNAL_CUTOVER_PREPARATION_REQUIRED';
  END IF;
  -- Exact preparation replay, normalizing nullable columns added since capture.
  SELECT coalesce(jsonb_agg(to_jsonb(jsonb_populate_record(NULL::public.sales,v)) ORDER BY v->>'id'),'[]')
    INTO normalized_sales FROM jsonb_array_elements(prep.legacy_snapshot->'sales') v;
  before_sales:=crm_external_private.cutover_sales_image();
  SELECT jsonb_build_object('leads',coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM public.leads l),'[]'),
    'plots',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.plots p),'[]'),
    'projects',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY name) FROM public.projects p),'[]'),
    'voices',coalesce((SELECT jsonb_agg(to_jsonb(v) ORDER BY id) FROM public.customer_voices v),'[]')) INTO baseline;
  IF normalized_sales IS DISTINCT FROM before_sales OR baseline IS DISTINCT FROM prep.legacy_snapshot-'sales' THEN
    RAISE EXCEPTION 'EXTERNAL_CUTOVER_BASELINE_CHANGED';
  END IF;
  IF (SELECT count(*) FROM crm_external_private.booking_history WHERE batch_id=p_batch)
      <>(prep.response->>'bookingHistories')::integer
    OR (SELECT count(*) FROM crm_external_private.prepared_booking_sales WHERE batch_id=p_batch)
      <>(prep.response->>'bookingHistories')::integer
    OR (SELECT count(*) FROM crm_external_private.booking_sales_projection WHERE batch_id=p_batch)
      <>(prep.response->>'bookingHistories')::integer
    OR EXISTS(SELECT 1 FROM crm_external_private.prepared_booking_sales s
      LEFT JOIN crm_external_private.booking_sales_projection p ON p.batch_id=s.batch_id AND p.booking_key=s.booking_key
      WHERE s.batch_id=p_batch AND (p.booking_key IS NULL OR s.payload IS DISTINCT FROM to_jsonb(p))) THEN
    RAISE EXCEPTION 'EXTERNAL_CUTOVER_SOURCE_CHANGED';
  END IF;
  IF EXISTS(SELECT 1 FROM crm_external_private.booking_sales_projection
    WHERE batch_id=p_batch AND stage<>'cancelled' AND NOT eligible_for_release_review) THEN
    RAISE EXCEPTION 'EXTERNAL_CUTOVER_ACTIVE_HOLD';
  END IF;
  SELECT count(*) FILTER(WHERE eligible_for_release_review),count(*) FILTER(WHERE NOT eligible_for_release_review)
    INTO source_count,held_count FROM crm_external_private.booking_sales_projection WHERE batch_id=p_batch;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',id) ORDER BY id),'[]') INTO affected_ids FROM (
    SELECT plot_id AS id FROM public.sales WHERE plot_id IS NOT NULL
    UNION SELECT plot_id FROM crm_external_private.prepared_booking_sales WHERE batch_id=p_batch AND plot_id IS NOT NULL) ids;
  IF EXISTS(SELECT 1 FROM jsonb_each(p_plot_status_overrides) e
      WHERE e.key NOT IN (SELECT v->>'id' FROM jsonb_array_elements(affected_ids) v)
        OR e.value#>>'{}' NOT IN ('active','transferred')
        OR ((e.value#>>'{}'='transferred') IS DISTINCT FROM EXISTS(
          SELECT 1 FROM crm_external_private.prepared_booking_sales s WHERE s.batch_id=p_batch AND s.plot_id=e.key AND s.stage='transferred')))
    OR EXISTS(SELECT 1 FROM public.plots p WHERE p.id IN (SELECT v->>'id' FROM jsonb_array_elements(affected_ids) v)
      AND p.sale_status='transferred' AND NOT EXISTS(SELECT 1 FROM crm_external_private.prepared_booking_sales s
        WHERE s.batch_id=p_batch AND s.plot_id=p.id AND s.stage='transferred')
      AND p_plot_status_overrides->>p.id IS DISTINCT FROM 'active') THEN
    RAISE EXCEPTION 'EXTERNAL_CUTOVER_PLOT_STATUS_RECONCILIATION_REQUIRED';
  END IF;
  before_plots:=baseline->'plots'; before_flags:=crm_external_private.cutover_plot_flags(affected_ids);
  dependency_before:=crm_external_private.cutover_dependency_image();
  INSERT INTO crm_external_private.sales_cutover_permits VALUES(txid_current(),pg_backend_pid(),p_batch,'replace');
  DELETE FROM public.sales;
  INSERT INTO public.sales(id,external_booking_id,external_source_stage,lead_id,project_interest_id,plot_id,booking_round,previous_sale_id,
    crm_stage,contract_status,payment_method,booking_route,booking_route_reason,list_price,discount_amount,
    sale_price,booking_amount,booked_at,contracted_at,crm_handover_at,cancelled_at,legacy_cancellation_batch_id,
    cancellation_category,cancellation_reason,closing_sales_user_id,bank_status,bank_name,land_office_price,transferred_at,expected_transfer_date)
  SELECT s.id,s.id,s.stage,NULL,(s.payload->>'interest_id')::uuid,s.plot_id,NULL,NULL,s.stage,
    CASE s.stage WHEN 'booked' THEN 'Reserved' WHEN 'transferred' THEN 'Transferred' ELSE 'Cancelled' END,
    s.payload->>'payment_method','legacy_import','External snapshot: '||s.booking_key,NULL,NULL,
    (s.payload->>'sale_price')::numeric,(s.payload->>'deposit_amount')::numeric,NULL,NULL,NULL,NULL,NULL,NULL,
    s.payload->>'cancellation_reason',(s.payload->>'closing_sales_user_id')::uuid,NULL,NULL,NULL,NULL,NULL
  FROM crm_external_private.prepared_booking_sales s WHERE s.batch_id=p_batch
    AND (s.payload->>'eligible_for_release_review')::boolean;
  UPDATE public.plots p SET has_customer=EXISTS(SELECT 1 FROM public.sales s WHERE s.plot_id=p.id AND s.crm_stage<>'cancelled')
    WHERE p.id IN(SELECT v->>'id' FROM jsonb_array_elements(affected_ids) v);
  UPDATE public.plots p SET sale_status=e.value#>>'{}' FROM jsonb_each(p_plot_status_overrides) e WHERE p.id=e.key;
  DELETE FROM crm_external_private.sales_cutover_permits WHERE transaction_id=txid_current();
  IF (SELECT count(*) FROM public.sales)<>source_count
    OR dependency_before IS DISTINCT FROM crm_external_private.cutover_dependency_image()
    OR EXISTS(SELECT 1 FROM public.plots p WHERE p.id IN (SELECT v->>'id' FROM jsonb_array_elements(affected_ids) v)
      AND p.has_customer IS DISTINCT FROM EXISTS(SELECT 1 FROM public.sales s WHERE s.plot_id=p.id AND s.crm_stage<>'cancelled'))
    OR EXISTS(SELECT 1 FROM public.plots p WHERE p.id IN (SELECT v->>'id' FROM jsonb_array_elements(affected_ids) v)
      AND coalesce(p.sale_status='transferred',false) IS DISTINCT FROM EXISTS(
        SELECT 1 FROM public.sales s WHERE s.plot_id=p.id AND s.crm_stage='transferred'))
    OR EXISTS(SELECT 1 FROM public.sales WHERE crm_stage<>'cancelled' GROUP BY plot_id HAVING plot_id IS NULL OR count(*)>1)
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(before_plots) old
      FULL JOIN public.plots p ON p.id=old->>'id'
      WHERE old IS NULL OR p.id IS NULL OR old-ARRAY['has_customer','sale_status'] IS DISTINCT FROM to_jsonb(p)-ARRAY['has_customer','sale_status']) THEN
    RAISE EXCEPTION 'EXTERNAL_CUTOVER_POSTCONDITION_FAILED';
  END IF;
  after_sales:=crm_external_private.cutover_sales_image(); after_flags:=crm_external_private.cutover_plot_flags(affected_ids);
  response_value:=jsonb_build_object('replayed',false,'salesWritten',source_count,'legacySalesArchived',jsonb_array_length(before_sales),
    'heldHistories',held_count,'activationReady',false);
  INSERT INTO crm_external_private.sales_cutover_receipts(batch_id,request,before_sales,after_sales,before_plot_flags,after_plot_flags,dependency_image,response)
    VALUES(p_batch,request_value,before_sales,after_sales,before_flags,after_flags,dependency_before,response_value);
  RETURN response_value;
END;
$$;

CREATE FUNCTION crm_external_private.rollback_sales(p_batch uuid,p_review_ref text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' SET lock_timeout='2s' AS $$
DECLARE receipt crm_external_private.sales_cutover_receipts%ROWTYPE;
  prior crm_external_private.sales_rollback_receipts%ROWTYPE; request_value jsonb; response_value jsonb;
  before_plots jsonb;
BEGIN
  PERFORM crm_external_private.cutover_operator_check();
  IF p_batch IS NULL OR nullif(btrim(p_review_ref),'') IS NULL OR length(p_review_ref)>1000 THEN RAISE EXCEPTION 'EXTERNAL_CUTOVER_INPUT_INVALID'; END IF;
  PERFORM pg_advisory_xact_lock(20260925,3);
  LOCK TABLE public.crm_settings,public.sales,public.plots IN SHARE ROW EXCLUSIVE MODE;
  IF EXISTS(SELECT 1 FROM public.crm_settings s,LATERAL jsonb_each(to_jsonb(s)) j
    WHERE (j.key LIKE '%\_enabled' ESCAPE '\' OR j.key='booking_cutover_reviewed') AND j.value='true') THEN
    RAISE EXCEPTION 'EXTERNAL_CUTOVER_DISABLED_CRM_REQUIRED';
  END IF;
  SELECT * INTO receipt FROM crm_external_private.sales_cutover_receipts WHERE batch_id=p_batch;
  IF receipt.batch_id IS NULL THEN RAISE EXCEPTION 'EXTERNAL_CUTOVER_RECEIPT_REQUIRED'; END IF;
  PERFORM crm_external_private.revalidate_cutover_identity(p_batch,receipt.request->>'planDigest');
  IF receipt.dependency_image IS DISTINCT FROM crm_external_private.cutover_dependency_image() THEN
    RAISE EXCEPTION 'EXTERNAL_CUTOVER_DEPENDENCIES_CHANGED';
  END IF;
  request_value:=jsonb_build_object('reviewRef',p_review_ref);
  SELECT * INTO prior FROM crm_external_private.sales_rollback_receipts WHERE batch_id=p_batch;
  IF prior.batch_id IS NOT NULL THEN
    IF prior.request IS DISTINCT FROM request_value THEN RAISE EXCEPTION 'EXTERNAL_CUTOVER_REPLAY_CHANGED'; END IF;
    IF receipt.before_sales IS DISTINCT FROM crm_external_private.cutover_sales_image()
      OR receipt.before_plot_flags IS DISTINCT FROM crm_external_private.cutover_plot_flags(receipt.before_plot_flags) THEN
      RAISE EXCEPTION 'EXTERNAL_CUTOVER_RESTORE_IMAGE_CHANGED';
    END IF;
    RETURN prior.response||jsonb_build_object('replayed',true);
  END IF;
  IF receipt.after_sales IS DISTINCT FROM crm_external_private.cutover_sales_image()
    OR receipt.after_plot_flags IS DISTINCT FROM crm_external_private.cutover_plot_flags(receipt.after_plot_flags) THEN
    RAISE EXCEPTION 'EXTERNAL_CUTOVER_AFTER_IMAGE_CHANGED';
  END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY id),'[]') INTO before_plots FROM public.plots p;
  INSERT INTO crm_external_private.sales_cutover_permits VALUES(txid_current(),pg_backend_pid(),p_batch,'rollback');
  DELETE FROM public.sales;
  INSERT INTO public.sales SELECT r.* FROM jsonb_populate_recordset(NULL::public.sales,receipt.before_sales) r;
  UPDATE public.plots p SET has_customer=(v->>'has_customer')::boolean,sale_status=v->>'sale_status'
    FROM jsonb_array_elements(receipt.before_plot_flags) v WHERE p.id=v->>'id';
  DELETE FROM crm_external_private.sales_cutover_permits WHERE transaction_id=txid_current();
  IF receipt.before_sales IS DISTINCT FROM crm_external_private.cutover_sales_image()
    OR receipt.dependency_image IS DISTINCT FROM crm_external_private.cutover_dependency_image()
    OR receipt.before_plot_flags IS DISTINCT FROM crm_external_private.cutover_plot_flags(receipt.before_plot_flags)
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(before_plots) old FULL JOIN public.plots p ON p.id=old->>'id'
      WHERE old IS NULL OR p.id IS NULL OR old-ARRAY['has_customer','sale_status'] IS DISTINCT FROM to_jsonb(p)-ARRAY['has_customer','sale_status']) THEN
    RAISE EXCEPTION 'EXTERNAL_CUTOVER_RESTORE_POSTCONDITION_FAILED';
  END IF;
  response_value:=jsonb_build_object('restoredSales',jsonb_array_length(receipt.before_sales),'replayed',false,'activationReady',false);
  INSERT INTO crm_external_private.sales_rollback_receipts(batch_id,request,response) VALUES(p_batch,request_value,response_value);
  RETURN response_value;
END;
$$;

DO $seal$
DECLARE obj record; grantee_name text;
BEGIN
  FOR obj IN SELECT oid,relname,relowner FROM pg_class WHERE relnamespace='crm_external_private'::regnamespace
    AND relname IN ('sales_cutover_receipts','sales_rollback_receipts','sales_cutover_permits') LOOP
    EXECUTE format('ALTER TABLE crm_external_private.%I ENABLE ROW LEVEL SECURITY',obj.relname);
    IF obj.relname<>'sales_cutover_permits' THEN
      EXECUTE format('CREATE TRIGGER immutable_history BEFORE UPDATE OR DELETE OR TRUNCATE ON crm_external_private.%I FOR EACH STATEMENT EXECUTE FUNCTION crm_external_private.reject_history_change()',obj.relname);
    END IF;
    FOR grantee_name IN SELECT DISTINCT CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(a.grantee)) END
      FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
      WHERE c.oid=obj.oid AND a.grantee<>obj.relowner LOOP
      EXECUTE format('REVOKE ALL ON TABLE crm_external_private.%I FROM %s',obj.relname,grantee_name);
    END LOOP;
  END LOOP;
  FOR obj IN SELECT oid,proowner FROM pg_proc WHERE pronamespace='crm_external_private'::regnamespace
    AND proname IN ('cutover_operator_check','guard_cutover_sale','cutover_sales_image','cutover_plot_flags',
      'cutover_dependency_image','revalidate_cutover_identity','replace_sales','rollback_sales') LOOP
    FOR grantee_name IN SELECT DISTINCT CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(a.grantee)) END
      FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      WHERE p.oid=obj.oid AND a.grantee<>obj.proowner LOOP
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %s',obj.oid::regprocedure,grantee_name);
    END LOOP;
  END LOOP;
END;
$seal$;
ROLLBACK;
