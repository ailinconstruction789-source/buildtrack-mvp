-- LOCAL DESIGN ONLY. Append six reviewed source identities to nonempty CRM.
-- Independent immutable provenance: original snapshot candidates and seals stay intact.
-- No fabricated Lead, Visit, stock, operational datetime, or name-based identity merge.
-- New UUIDs are allocated only inside the atomic apply. created_at/recorded_at are
-- import metadata; lead_created_at/interest_created_at/activation times stay NULL.
-- Supplemental rows are sealed except the unchanged, exact existing booking
-- Interest permit. Customer details continue through the existing 22 overlay.
-- This draft grants no public RPC or new lifecycle permission.
BEGIN;
DO $draft_only$
BEGIN
  RAISE EXCEPTION 'DESIGN ONLY: source bound creation requires isolated verification and separate installation review';
END;
$draft_only$;

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
ROLLBACK;
