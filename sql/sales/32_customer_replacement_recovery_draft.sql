-- DESIGN ONLY. Requires the exact 25-31 composition and reviewed adapter block.
-- Install before begin_run and before any business replacement writes.
-- Restores logical business state; six created Customer/Interest audit parents
-- and immutable import/recovery ledgers deliberately remain physical records.
BEGIN;
DO $draft_only$ BEGIN RAISE EXCEPTION 'DESIGN ONLY: customer recovery requires whole post-commit rehearsal'; END; $draft_only$;
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
ROLLBACK;
