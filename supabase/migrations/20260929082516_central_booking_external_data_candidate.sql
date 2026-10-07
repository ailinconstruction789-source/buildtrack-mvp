-- LOCAL INSTALLATION CANDIDATE, not an import, activation, or production approval.
-- Run after the exact sealed CRM foundation, before source staging/materialization.
-- Do NOT db push this directory: account migration timestamps differ remotely.
-- Evidence settings are operator attestations, not proof of backup/target identity.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='30s';
SET LOCAL transaction_timeout='30s';
DO $external_data_review$
BEGIN
  IF current_setting('buildtrack.external_data_release',true) IS DISTINCT FROM 'sealed_external_data_rows_2_966_v1'
    OR current_setting('buildtrack.external_data_project',true) IS DISTINCT FROM 'kbthmdedilswdmmczfay'
    OR current_setting('buildtrack.external_data_mode',true) IS DISTINCT FROM 'schema_only_no_import'
    OR length(btrim(coalesce(current_setting('buildtrack.external_data_backup',true),'')))<8
    OR length(btrim(coalesce(current_setting('buildtrack.external_data_review',true),'')))<8 THEN
    RAISE EXCEPTION 'EXTERNAL_DATA_REVIEW_REQUIRED';
  END IF;
  IF to_regnamespace('crm_external_private') IS NOT NULL
    OR to_regclass('public.sales_customers') IS NULL
    OR to_regclass('account_security_private.reviewed_roles') IS NULL
    OR to_regprocedure('sales_private.reject_sealed_legacy_fields()') IS NULL THEN
    RAISE EXCEPTION 'EXTERNAL_DATA_FRESH_SEALED_FOUNDATION_REQUIRED';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_class WHERE oid IN ('public.sales_customers'::regclass,
      'public.lead_project_interests'::regclass,'public.sales'::regclass)
    AND relowner<>(SELECT oid FROM pg_roles WHERE rolname=current_user)) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='EXTERNAL_DATA_OPERATOR_REQUIRED';
  END IF;
  PERFORM pg_advisory_xact_lock(20260925,3);
  IF EXISTS(SELECT 1 FROM public.sales_customers) OR EXISTS(SELECT 1 FROM public.lead_project_interests)
    OR EXISTS(SELECT 1 FROM public.crm_import_batches)
    OR EXISTS(SELECT 1 FROM public.crm_settings s,LATERAL jsonb_each(to_jsonb(s)) j
      WHERE (j.key LIKE '%\_enabled' ESCAPE '\' OR j.key='booking_cutover_reviewed') AND j.value='true') THEN
    RAISE EXCEPTION 'EXTERNAL_DATA_EMPTY_DISABLED_CRM_REQUIRED';
  END IF;
END;
$external_data_review$;
-- Fail promptly if occupied; never relax these locks/timeouts to force release.
LOCK TABLE public.sales,public.sales_customers,public.lead_project_interests,public.crm_settings IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.projects,public.plots,public.leads,public.customer_voices,
  account_security_private.reviewed_roles,sales_private.crm_user_roles IN SHARE MODE;
CREATE TEMP TABLE external_data_relations ON COMMIT DROP AS
SELECT c.oid,c.relacl,c.relrowsecurity,c.relowner,n.nspname,c.relname,
  ARRAY(SELECT a.attname::text FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum) AS columns,
  NULL::text AS data_hash
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname IN ('public','sales_private','account_security_private') AND c.relkind IN ('r','S');
CREATE TEMP TABLE external_data_functions ON COMMIT DROP AS
SELECT p.oid,md5(pg_get_functiondef(p.oid)||coalesce(p.proacl::text,'')||p.proowner::text) AS hash
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname IN ('public','sales_private','account_security_private') AND p.prokind='f';
CREATE TEMP TABLE external_data_triggers ON COMMIT DROP AS
SELECT t.oid,t.tgrelid,t.tgname,pg_get_triggerdef(t.oid) AS definition,t.tgenabled
FROM pg_trigger t WHERE t.tgrelid IN (SELECT oid FROM external_data_relations) AND NOT t.tgisinternal;
CREATE TEMP TABLE external_data_policies ON COMMIT DROP AS
SELECT p.oid,md5(to_jsonb(p)::text) AS hash FROM pg_policy p
WHERE p.polrelid IN (SELECT oid FROM external_data_relations);
DO $external_data_before$
DECLARE r record; result text;
BEGIN
  FOR r IN SELECT * FROM external_data_relations WHERE
    (nspname='public' AND relname IN ('projects','plots','leads','sales','customer_voices','sales_customers','lead_project_interests','crm_settings'))
    OR (nspname='account_security_private' AND relname='reviewed_roles')
    OR (nspname='sales_private' AND relname='crm_user_roles') LOOP
    EXECUTE format('SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,''[]'')) FROM %I.%I t',r.nspname,r.relname) INTO result;
    UPDATE external_data_relations SET data_hash=result WHERE oid=r.oid;
  END LOOP;
END;
$external_data_before$;

-- Reviewed source: sql/sales/external_snapshot_staging_draft.sql
-- LF-normalized SHA256: c583c4e299f103c123005ec02dab4c9e0c4e61f2dc8c4b7cd9ea07554e8ceb4f
-- DESIGN ONLY. Private historical staging, NOT a CRM importer or deployment migration.
-- No public/Auth/project/plot/legacy objects are altered. No real source data here.


CREATE SCHEMA crm_external_private;

CREATE TABLE crm_external_private.snapshot_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- One pinned full snapshot in v1. A changed file/mapping MUST be reconciled,
  -- not appended under a caller-supplied new batch/feed identifier.
  feed text NOT NULL UNIQUE CHECK (feed = 'customer-sheet'),
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[a-f0-9]{64}$'),
  plan_digest text NOT NULL CHECK (plan_digest ~ '^[a-f0-9]{64}$'),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  captured_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE crm_external_private.customer_candidates (
  batch_id uuid NOT NULL REFERENCES crm_external_private.snapshot_batches(id) ON DELETE RESTRICT,
  payload jsonb NOT NULL,
  entity_key text GENERATED ALWAYS AS (payload->>'sourceEntityKey') STORED NOT NULL,
  customer_name text GENERATED ALWAYS AS (payload->>'name') STORED NOT NULL,
  owner_login text GENERATED ALWAYS AS (payload->>'ownerLogin') STORED,
  PRIMARY KEY (batch_id,entity_key),
  CHECK (entity_key ~ '^[a-f0-9]{64}$' AND btrim(customer_name) <> ''),
  CHECK (payload ?& ARRAY['sourceRows','ownerLogin','reviewHolds']),
  CHECK (jsonb_typeof(payload->'sourceRows') = 'array' AND jsonb_array_length(payload->'sourceRows') > 0),
  CHECK (jsonb_typeof(payload->'reviewHolds') = 'array'),
  CHECK (owner_login IS NOT NULL OR jsonb_array_length(payload->'reviewHolds') > 0),
  CHECK (payload @> '{"phone":null,"phoneStatus":"unknown","leadDate":null,"intakeStatus":"legacy_unclassified"}')
);

CREATE TABLE crm_external_private.interest_candidates (
  batch_id uuid NOT NULL REFERENCES crm_external_private.snapshot_batches(id) ON DELETE RESTRICT,
  payload jsonb NOT NULL,
  entity_key text GENERATED ALWAYS AS (payload->>'sourceEntityKey') STORED NOT NULL,
  customer_key text GENERATED ALWAYS AS (payload->>'customerKey') STORED NOT NULL,
  project_label text GENERATED ALWAYS AS (payload->>'project') STORED NOT NULL,
  owner_login text GENERATED ALWAYS AS (payload->>'ownerLogin') STORED,
  PRIMARY KEY (batch_id,entity_key),
  UNIQUE (batch_id,customer_key,project_label),
  UNIQUE (batch_id,entity_key,customer_key),
  FOREIGN KEY (batch_id,customer_key) REFERENCES crm_external_private.customer_candidates(batch_id,entity_key) ON DELETE RESTRICT,
  CHECK (entity_key ~ '^[a-f0-9]{64}$' AND btrim(project_label) <> ''),
  CHECK (payload ?& ARRAY['sourceRows','ownerLogin','reviewHolds']),
  CHECK (jsonb_typeof(payload->'sourceRows') = 'array' AND jsonb_array_length(payload->'sourceRows') > 0),
  CHECK (jsonb_typeof(payload->'reviewHolds') = 'array'),
  CHECK (owner_login IS NOT NULL OR jsonb_array_length(payload->'reviewHolds') > 0),
  CHECK (payload @> '{"status":null,"classification":"legacy_unclassified"}')
);

CREATE TABLE crm_external_private.source_records (
  batch_id uuid NOT NULL REFERENCES crm_external_private.snapshot_batches(id) ON DELETE RESTRICT,
  payload jsonb NOT NULL,
  source_row integer GENERATED ALWAYS AS ((payload->>'sourceRow')::integer) STORED NOT NULL,
  entity_key text GENERATED ALWAYS AS (payload->>'sourceEntityKey') STORED NOT NULL,
  customer_key text GENERATED ALWAYS AS (payload->>'customerKey') STORED,
  disposition text GENERATED ALWAYS AS (payload->>'disposition') STORED NOT NULL,
  PRIMARY KEY (batch_id,source_row),
  UNIQUE (batch_id,entity_key),
  UNIQUE (batch_id,source_row,customer_key),
  FOREIGN KEY (batch_id,customer_key) REFERENCES crm_external_private.customer_candidates(batch_id,entity_key) ON DELETE RESTRICT,
  CHECK (source_row >= 2 AND entity_key ~ '^[a-f0-9]{64}$'),
  CHECK (disposition IN ('mapped_for_review','admin_review')),
  CHECK (customer_key IS NOT NULL OR disposition = 'admin_review'),
  CHECK (payload ?& ARRAY['customerKey','rawValues','rowDigest','reviewedHistory','sourceIssues']),
  CHECK (jsonb_typeof(payload->'rawValues') = 'array' AND jsonb_array_length(payload->'rawValues') = 17),
  CHECK ((payload->>'rowDigest') ~ '^[a-f0-9]{64}$'),
  CHECK (payload->'reviewedHistory' @> '{"visitCompleted":false,"leadDate":null,"phone":null}'),
  CHECK ((payload->'reviewedHistory') ?& ARRAY['customerName','ownerLogin','booking'])
);
CREATE INDEX source_records_customer_idx ON crm_external_private.source_records(batch_id,customer_key);

CREATE TABLE crm_external_private.booking_history (
  batch_id uuid NOT NULL REFERENCES crm_external_private.snapshot_batches(id) ON DELETE RESTRICT,
  payload jsonb NOT NULL,
  entity_key text GENERATED ALWAYS AS (payload->>'sourceEntityKey') STORED NOT NULL,
  source_row integer GENERATED ALWAYS AS ((payload->>'sourceRow')::integer) STORED NOT NULL,
  customer_key text GENERATED ALWAYS AS (payload->>'customerKey') STORED,
  interest_key text GENERATED ALWAYS AS (payload->>'interestKey') STORED,
  plot_label_id text GENERATED ALWAYS AS (payload->>'plotId') STORED,
  stage text GENERATED ALWAYS AS (payload->>'stage') STORED NOT NULL,
  PRIMARY KEY (batch_id,entity_key),
  UNIQUE (batch_id,source_row),
  FOREIGN KEY (batch_id,source_row) REFERENCES crm_external_private.source_records(batch_id,source_row) ON DELETE RESTRICT,
  FOREIGN KEY (batch_id,source_row,customer_key) REFERENCES crm_external_private.source_records(batch_id,source_row,customer_key) ON DELETE RESTRICT,
  FOREIGN KEY (batch_id,interest_key,customer_key) REFERENCES crm_external_private.interest_candidates(batch_id,entity_key,customer_key) ON DELETE RESTRICT,
  CHECK (entity_key ~ '^[a-f0-9]{64}$' AND stage IN ('booked','transferred','cancelled')),
  CHECK (interest_key IS NULL OR customer_key IS NOT NULL),
  CHECK (payload ?& ARRAY['customerKey','interestKey','plotId','reviewHolds']),
  CHECK (jsonb_typeof(payload->'reviewHolds') = 'array'),
  CHECK (customer_key IS NOT NULL OR payload->'reviewHolds' ? 'CUSTOMER_REQUIRED'),
  CHECK (interest_key IS NOT NULL OR payload->'reviewHolds' ? 'INTEREST_REQUIRED'),
  CHECK (plot_label_id IS NOT NULL OR payload->'reviewHolds' ? 'PLOT_UNKNOWN')
);
CREATE INDEX booking_history_interest_idx ON crm_external_private.booking_history(batch_id,interest_key,customer_key);

CREATE FUNCTION crm_external_private.reject_history_change()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'EXTERNAL_SNAPSHOT_APPEND_ONLY';
END;
$$;

CREATE FUNCTION crm_external_private.stage_snapshot(p_plan jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  batch crm_external_private.snapshot_batches%ROWTYPE;
  inserted_id uuid;
  field text;
BEGIN
  IF jsonb_typeof(p_plan) IS DISTINCT FROM 'object'
    OR (p_plan @> '{"version":"sheet-snapshot-plan-v1","importReady":false,"productionChanged":false,"deletionAuthorized":false}') IS DISTINCT FROM true
    OR (p_plan->>'sourceSha256' ~ '^[a-f0-9]{64}$') IS DISTINCT FROM true
    OR (p_plan->>'planDigest' ~ '^[a-f0-9]{64}$') IS DISTINCT FROM true
    OR (p_plan->>'inputDigest' ~ '^[a-f0-9]{64}$') IS DISTINCT FROM true
    OR (p_plan->>'identityDecisionDigest' ~ '^[a-f0-9]{64}$') IS DISTINCT FROM true
    OR (p_plan->>'catalogDigest' ~ '^[a-f0-9]{64}$') IS DISTINCT FROM true
    OR nullif(btrim(p_plan->>'pendingDecisionRef'),'') IS NULL
    OR octet_length(p_plan::text) > 16777216 THEN
    RAISE EXCEPTION 'EXTERNAL_SNAPSHOT_CONTRACT_INVALID';
  END IF;
  FOREACH field IN ARRAY ARRAY['customers','interests','bookings','sourceRecords','holds','globalPending','skippedSourceRows'] LOOP
    IF jsonb_typeof(p_plan->field) IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'EXTERNAL_SNAPSHOT_CONTRACT_INVALID';
    END IF;
  END LOOP;
  IF jsonb_array_length(p_plan->'sourceRecords') NOT BETWEEN 1 AND 5000
    OR jsonb_array_length(p_plan->'customers') NOT BETWEEN 1 AND 5000
    OR jsonb_array_length(p_plan->'interests') > 35000
    OR jsonb_array_length(p_plan->'bookings') > 5000 THEN
    RAISE EXCEPTION 'EXTERNAL_SNAPSHOT_CONTRACT_INVALID';
  END IF;

  -- The unique feed serializes competing requests, including different revisions.
  -- No DO UPDATE: never overwrite evidence on conflict.
  INSERT INTO crm_external_private.snapshot_batches(feed,source_sha256,plan_digest,payload)
    VALUES ('customer-sheet',p_plan->>'sourceSha256',p_plan->>'planDigest',p_plan)
    ON CONFLICT (feed) DO NOTHING RETURNING id INTO inserted_id;
  SELECT * INTO STRICT batch FROM crm_external_private.snapshot_batches
    WHERE feed = 'customer-sheet' FOR UPDATE;
  IF batch.payload IS DISTINCT FROM p_plan THEN
    RAISE EXCEPTION 'EXTERNAL_SNAPSHOT_CHANGED_RECONCILIATION_REQUIRED';
  END IF;
  IF inserted_id IS NOT NULL THEN
    INSERT INTO crm_external_private.customer_candidates(batch_id,payload)
      SELECT batch.id,value FROM jsonb_array_elements(p_plan->'customers');
    INSERT INTO crm_external_private.interest_candidates(batch_id,payload)
      SELECT batch.id,value FROM jsonb_array_elements(p_plan->'interests');
    INSERT INTO crm_external_private.source_records(batch_id,payload)
      SELECT batch.id,value FROM jsonb_array_elements(p_plan->'sourceRecords');
    INSERT INTO crm_external_private.booking_history(batch_id,payload)
      SELECT batch.id,value FROM jsonb_array_elements(p_plan->'bookings');
  END IF;
  IF (SELECT count(*) FROM crm_external_private.customer_candidates WHERE batch_id=batch.id) <> jsonb_array_length(p_plan->'customers')
    OR (SELECT count(*) FROM crm_external_private.interest_candidates WHERE batch_id=batch.id) <> jsonb_array_length(p_plan->'interests')
    OR (SELECT count(*) FROM crm_external_private.source_records WHERE batch_id=batch.id) <> jsonb_array_length(p_plan->'sourceRecords')
    OR (SELECT count(*) FROM crm_external_private.booking_history WHERE batch_id=batch.id) <> jsonb_array_length(p_plan->'bookings') THEN
    RAISE EXCEPTION 'EXTERNAL_SNAPSHOT_COVERAGE_INVALID';
  END IF;
  -- Each customer partition must exactly equal its retained source membership.
  IF EXISTS (
    SELECT 1 FROM crm_external_private.customer_candidates c WHERE c.batch_id=batch.id
    AND (SELECT jsonb_agg(r.value ORDER BY r.value) FROM jsonb_array_elements(c.payload->'sourceRows') r(value))
      IS DISTINCT FROM (SELECT jsonb_agg(s.source_row ORDER BY s.source_row)
        FROM crm_external_private.source_records s WHERE s.batch_id=c.batch_id AND s.customer_key=c.entity_key)
  ) OR EXISTS (
    SELECT 1 FROM crm_external_private.interest_candidates i,
      LATERAL jsonb_array_elements_text(i.payload->'sourceRows') r(row_no)
    WHERE i.batch_id=batch.id AND NOT EXISTS (SELECT 1 FROM crm_external_private.source_records s
      WHERE s.batch_id=i.batch_id AND s.source_row=r.row_no::integer AND s.customer_key=i.customer_key)
  ) OR EXISTS (
    SELECT 1 FROM crm_external_private.booking_history b JOIN crm_external_private.source_records s
      ON s.batch_id=b.batch_id AND s.source_row=b.source_row WHERE b.batch_id=batch.id
      AND b.customer_key IS DISTINCT FROM s.customer_key
  ) THEN
    RAISE EXCEPTION 'EXTERNAL_SNAPSHOT_MEMBERSHIP_INVALID';
  END IF;
  IF EXISTS (
    SELECT 1 FROM crm_external_private.source_records s
    LEFT JOIN crm_external_private.customer_candidates c ON c.batch_id=s.batch_id AND c.entity_key=s.customer_key
    LEFT JOIN crm_external_private.booking_history b ON b.batch_id=s.batch_id AND b.source_row=s.source_row
    WHERE s.batch_id=batch.id AND (
      c.customer_name IS DISTINCT FROM s.payload->'reviewedHistory'->>'customerName'
      OR ((s.payload->'reviewedHistory'->'booking') IS DISTINCT FROM 'null'::jsonb) <> (b.entity_key IS NOT NULL)
      OR (b.entity_key IS NOT NULL AND
        (b.payload - ARRAY['sourceEntityKey','sourceRow','customerKey','interestKey','plotId','reviewHolds'])
        IS DISTINCT FROM s.payload->'reviewedHistory'->'booking')
      OR ((s.payload->'reviewedHistory'->>'customerName' IS NULL OR s.payload->'reviewedHistory'->>'ownerLogin' IS NULL)
        AND s.disposition <> 'admin_review')
    )
  ) OR (SELECT coalesce(jsonb_agg(s.source_row ORDER BY s.source_row),'[]')
      FROM crm_external_private.source_records s WHERE s.batch_id=batch.id AND s.disposition='admin_review')
    IS DISTINCT FROM (SELECT coalesce(jsonb_agg((h->>'row')::integer ORDER BY (h->>'row')::integer),'[]')
      FROM jsonb_array_elements(p_plan->'holds') h WHERE h->>'scope'='source') THEN
    RAISE EXCEPTION 'EXTERNAL_SNAPSHOT_EVIDENCE_INVALID';
  END IF;
  RETURN jsonb_build_object('batchId',batch.id,'replayed',inserted_id IS NULL,
    'sourceRows',jsonb_array_length(p_plan->'sourceRecords'),
    'customerCandidates',jsonb_array_length(p_plan->'customers'),
    'interestCandidates',jsonb_array_length(p_plan->'interests'),
    'bookingHistoryRows',jsonb_array_length(p_plan->'bookings'),
    'liveRowsWritten',0,'importReady',false);
END;
$$;

DO $seal$
DECLARE obj record; grantee_name text;
BEGIN
  FOR obj IN SELECT c.oid,c.relname,c.relowner FROM pg_class c
    WHERE c.relnamespace='crm_external_private'::regnamespace AND c.relkind='r' LOOP
    EXECUTE format('ALTER TABLE crm_external_private.%I ENABLE ROW LEVEL SECURITY',obj.relname);
    EXECUTE format('CREATE TRIGGER immutable_history BEFORE UPDATE OR DELETE OR TRUNCATE ON crm_external_private.%I FOR EACH STATEMENT EXECUTE FUNCTION crm_external_private.reject_history_change()',obj.relname);
    -- Remove arbitrary inherited default grantees too, not only Supabase roles.
    FOR grantee_name IN SELECT DISTINCT CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(a.grantee)) END
      FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
      WHERE c.oid=obj.oid AND a.grantee<>obj.relowner LOOP
      EXECUTE format('REVOKE ALL ON TABLE crm_external_private.%I FROM %s',obj.relname,grantee_name);
    END LOOP;
  END LOOP;
  FOR obj IN SELECT p.oid,p.proowner FROM pg_proc p WHERE p.pronamespace='crm_external_private'::regnamespace LOOP
    FOR grantee_name IN SELECT DISTINCT CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(a.grantee)) END
      FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      WHERE p.oid=obj.oid AND a.grantee<>obj.proowner LOOP
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %s',obj.oid::regprocedure,grantee_name);
    END LOOP;
  END LOOP;
  FOR grantee_name IN SELECT DISTINCT CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(a.grantee)) END
    FROM pg_namespace n CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a
    WHERE n.nspname='crm_external_private' AND a.grantee<>n.nspowner LOOP
    EXECUTE format('REVOKE ALL ON SCHEMA crm_external_private FROM %s',grantee_name);
  END LOOP;
END;
$seal$;

-- Reviewed source: sql/sales/external_crm_bridge_draft.sql
-- LF-normalized SHA256: 4c249c1196aa1091cfd19474ee33d4d7a7fe00b91ef24a9351f402f1445cd0f8
-- LOCAL DESIGN ONLY: materialize reviewed historical identities, NOT stock cutover.
-- Uses real CRM tables after the sealed foundation, without changing sales/plots.

SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='30s';

DO $preflight$
BEGIN
  IF to_regclass('crm_external_private.snapshot_batches') IS NULL
    OR to_regclass('public.sales_customers') IS NULL
    OR to_regclass('account_security_private.reviewed_roles') IS NULL
    OR to_regprocedure('sales_private.reject_sealed_legacy_fields()') IS NULL THEN
    RAISE EXCEPTION 'EXTERNAL_BRIDGE_SEALED_FOUNDATION_REQUIRED';
  END IF;
  IF EXISTS(SELECT 1 FROM public.crm_settings s,LATERAL jsonb_each(to_jsonb(s)) j
    WHERE (j.key LIKE '%\_enabled' ESCAPE '\' OR j.key='booking_cutover_reviewed') AND j.value='true') THEN
    RAISE EXCEPTION 'EXTERNAL_BRIDGE_DISABLED_CRM_REQUIRED';
  END IF;
  IF EXISTS(SELECT 1 FROM public.sales_customers) OR EXISTS(SELECT 1 FROM public.lead_project_interests) THEN
    RAISE EXCEPTION 'EXTERNAL_BRIDGE_EMPTY_CRM_REVIEW_REQUIRED';
  END IF;
END;
$preflight$;

ALTER TABLE public.sales_customers
  ADD COLUMN external_snapshot_batch_id uuid,
  ADD COLUMN external_customer_key text,
  ADD CONSTRAINT crm_customer_external_fk FOREIGN KEY(external_snapshot_batch_id,external_customer_key)
    REFERENCES crm_external_private.customer_candidates(batch_id,entity_key) MATCH FULL ON DELETE RESTRICT,
  ADD CONSTRAINT crm_customer_external_unique UNIQUE(external_snapshot_batch_id,external_customer_key),
  DROP CONSTRAINT crm_customer_origin_check;
-- Keep the existing live and legacy DB branches. External history is NOT a
-- fabricated legacy Lead. Exactly one complete provenance branch is mandatory.
ALTER TABLE public.sales_customers ADD CONSTRAINT crm_customer_origin_check CHECK (
  (record_origin='live' AND legacy_source_lead_id IS NULL AND external_snapshot_batch_id IS NULL
    AND external_customer_key IS NULL AND lead_created_at IS NOT NULL AND intake_status<>'legacy_unclassified')
  OR (record_origin='legacy_import' AND (
    (legacy_source_lead_id IS NOT NULL AND external_snapshot_batch_id IS NULL AND external_customer_key IS NULL)
    OR (legacy_source_lead_id IS NULL AND external_snapshot_batch_id IS NOT NULL AND external_customer_key IS NOT NULL)
  ))
);
-- Existing phone evidence constraint stays unchanged: live requires a real phone.
ALTER TABLE public.lead_project_interests
  ALTER COLUMN interest_created_at DROP NOT NULL,
  ADD COLUMN external_snapshot_batch_id uuid,
  ADD COLUMN external_interest_key text,
  ADD CONSTRAINT crm_interest_external_fk FOREIGN KEY(external_snapshot_batch_id,external_interest_key)
    REFERENCES crm_external_private.interest_candidates(batch_id,entity_key) MATCH FULL ON DELETE RESTRICT,
  ADD CONSTRAINT crm_interest_external_unique UNIQUE(external_snapshot_batch_id,external_interest_key),
  DROP CONSTRAINT lead_project_interests_engagement_status_check;
ALTER TABLE public.lead_project_interests ADD CONSTRAINT crm_interest_created_evidence_check CHECK (
  interest_created_at IS NOT NULL OR (external_snapshot_batch_id IS NOT NULL AND external_interest_key IS NOT NULL)
);
ALTER TABLE public.lead_project_interests ADD CONSTRAINT lead_project_interests_engagement_status_check CHECK (
  engagement_status IN ('new','contacted','considering','follow_up','nurture','lost')
  OR (engagement_status='legacy_unclassified' AND external_snapshot_batch_id IS NOT NULL AND external_interest_key IS NOT NULL)
);

CREATE TABLE crm_external_private.bridge_receipts (
  batch_id uuid PRIMARY KEY REFERENCES crm_external_private.snapshot_batches(id) ON DELETE RESTRICT,
  request jsonb NOT NULL,
  response jsonb NOT NULL,
  executed_by name NOT NULL DEFAULT current_user,
  executed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE crm_external_private.booking_crm_links (
  batch_id uuid NOT NULL,
  booking_key text NOT NULL,
  customer_id uuid REFERENCES public.sales_customers(id) ON DELETE RESTRICT,
  interest_id uuid,
  plot_id text REFERENCES public.plots(id) ON DELETE RESTRICT,
  PRIMARY KEY(batch_id,booking_key),
  FOREIGN KEY(batch_id,booking_key) REFERENCES crm_external_private.booking_history(batch_id,entity_key) ON DELETE RESTRICT,
  FOREIGN KEY(interest_id,customer_id) REFERENCES public.lead_project_interests(id,customer_id) ON DELETE RESTRICT,
  CHECK (interest_id IS NULL OR customer_id IS NOT NULL)
);
CREATE INDEX booking_crm_customer_idx ON crm_external_private.booking_crm_links(customer_id);
CREATE INDEX booking_crm_interest_idx ON crm_external_private.booking_crm_links(interest_id,customer_id);
CREATE INDEX booking_crm_plot_idx ON crm_external_private.booking_crm_links(plot_id);

CREATE FUNCTION crm_external_private.guard_materialized_history()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE c crm_external_private.customer_candidates%ROWTYPE; i crm_external_private.interest_candidates%ROWTYPE; allowed boolean:=false;
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') AND OLD.external_snapshot_batch_id IS NOT NULL THEN
    IF TG_TABLE_NAME='lead_project_interests' AND TG_OP='UPDATE'
      AND to_regprocedure('crm_external_private.booking_interest_allowed(jsonb,jsonb)') IS NOT NULL THEN
      EXECUTE 'SELECT crm_external_private.booking_interest_allowed($1,$2)' INTO allowed USING to_jsonb(OLD),to_jsonb(NEW);
      IF allowed IS TRUE THEN RETURN NEW; END IF;
    END IF;
    RAISE EXCEPTION 'EXTERNAL_CRM_HISTORY_SEALED';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF NEW.external_snapshot_batch_id IS NULL THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME='sales_customers' THEN
    SELECT * INTO c FROM crm_external_private.customer_candidates
      WHERE batch_id=NEW.external_snapshot_batch_id AND entity_key=NEW.external_customer_key;
    IF c.entity_key IS NULL OR c.payload->'reviewHolds'<>'[]' OR c.owner_login IS NULL
      OR NEW.customer_name IS DISTINCT FROM c.customer_name OR NEW.phone IS NOT NULL
      OR NEW.lead_created_at IS NOT NULL OR NEW.first_contacted_at IS NOT NULL
      OR NEW.intake_status<>'legacy_unclassified'
      OR NOT EXISTS(SELECT 1 FROM account_security_private.reviewed_roles r JOIN public.users u ON u.id=r.legacy_user_id
        WHERE r.auth_user_id=NEW.owner_user_id AND u.username=c.owner_login AND r.enabled AND r.role='Sales') THEN
      RAISE EXCEPTION 'EXTERNAL_CRM_CUSTOMER_EVIDENCE_REQUIRED';
    END IF;
  ELSE
    SELECT * INTO i FROM crm_external_private.interest_candidates
      WHERE batch_id=NEW.external_snapshot_batch_id AND entity_key=NEW.external_interest_key;
    IF i.entity_key IS NULL OR i.payload->'reviewHolds'<>'[]' OR i.owner_login IS NULL
      OR NEW.project_name IS DISTINCT FROM i.project_label OR NEW.engagement_status<>'legacy_unclassified'
      OR NEW.workspace_state<>'central_interest' OR NEW.activated_at IS NOT NULL OR NEW.activation_reason IS NOT NULL
      OR NEW.interested_plot_id IS NOT NULL OR NEW.interest_created_at IS NOT NULL
      OR NOT EXISTS(SELECT 1 FROM public.sales_customers p WHERE p.id=NEW.customer_id
        AND p.external_snapshot_batch_id=i.batch_id AND p.external_customer_key=i.customer_key)
      OR NOT EXISTS(SELECT 1 FROM account_security_private.reviewed_roles r JOIN public.users u ON u.id=r.legacy_user_id
        WHERE r.auth_user_id=NEW.owner_user_id AND u.username=i.owner_login AND r.enabled AND r.role='Sales') THEN
      RAISE EXCEPTION 'EXTERNAL_CRM_INTEREST_EVIDENCE_REQUIRED';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER external_customer_seal BEFORE INSERT OR UPDATE OR DELETE ON public.sales_customers
  FOR EACH ROW EXECUTE FUNCTION crm_external_private.guard_materialized_history();
CREATE TRIGGER external_interest_seal BEFORE INSERT OR UPDATE OR DELETE ON public.lead_project_interests
  FOR EACH ROW EXECUTE FUNCTION crm_external_private.guard_materialized_history();

-- Unknown history is NOT an implicit write lock in existing lifecycle/booking
-- commands. Keep ALL CRM capabilities closed until a separate inventory release.
CREATE FUNCTION crm_external_private.reject_unreviewed_activation()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE allowed boolean:=false;
BEGIN
  IF EXISTS(SELECT 1 FROM jsonb_each(to_jsonb(NEW)) j
    WHERE (j.key LIKE '%\_enabled' ESCAPE '\' OR j.key='booking_cutover_reviewed') AND j.value='true') THEN
    IF to_regprocedure('crm_external_private.booking_activation_allowed(jsonb)') IS NOT NULL THEN
      EXECUTE 'SELECT crm_external_private.booking_activation_allowed($1)' INTO allowed USING to_jsonb(NEW);
    END IF;
    IF allowed IS DISTINCT FROM true THEN RAISE EXCEPTION 'EXTERNAL_CRM_ACTIVATION_REVIEW_REQUIRED'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER external_bridge_activation_seal BEFORE INSERT OR UPDATE ON public.crm_settings
  FOR EACH ROW EXECUTE FUNCTION crm_external_private.reject_unreviewed_activation();

CREATE FUNCTION crm_external_private.materialize_crm(
  p_batch uuid,p_plan_digest text,p_admin uuid,p_bindings jsonb,p_review_ref text
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE b crm_external_private.snapshot_batches%ROWTYPE; item jsonb; normalized jsonb;
  request_value jsonb; prior crm_external_private.bridge_receipts%ROWTYPE; response_value jsonb;
  expected_logins jsonb; actual_logins jsonb;
BEGIN
  IF current_user IS DISTINCT FROM (SELECT pg_get_userbyid(relowner) FROM pg_class
    WHERE oid='crm_external_private.snapshot_batches'::regclass) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='EXTERNAL_BRIDGE_OPERATOR_REQUIRED';
  END IF;
  IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'EXTERNAL_BRIDGE_READ_COMMITTED_REQUIRED'; END IF;
  IF p_batch IS NULL OR p_admin IS NULL OR p_plan_digest IS NULL OR jsonb_typeof(p_bindings) IS DISTINCT FROM 'array'
    OR nullif(btrim(p_review_ref),'') IS NULL THEN RAISE EXCEPTION 'EXTERNAL_BRIDGE_INPUT_INVALID'; END IF;
  -- Same review lock as role changes; never create/enable a role from file labels.
  PERFORM pg_advisory_xact_lock(20260925,3);
  SELECT * INTO b FROM crm_external_private.snapshot_batches WHERE id=p_batch FOR UPDATE;
  IF b.id IS NULL OR b.plan_digest IS DISTINCT FROM p_plan_digest THEN RAISE EXCEPTION 'EXTERNAL_BRIDGE_PLAN_CHANGED'; END IF;
  PERFORM 1 FROM account_security_private.reviewed_roles r
    JOIN account_security_private.reviewed_admins a ON a.auth_user_id=r.auth_user_id AND a.legacy_user_id=r.legacy_user_id
    JOIN auth.users u ON u.id=r.auth_user_id
    WHERE r.auth_user_id=p_admin AND r.enabled AND r.role='Admin' AND r.review_revision>0 AND a.enabled
      AND u.deleted_at IS NULL AND NOT coalesce(u.is_anonymous,false) AND (u.banned_until IS NULL OR u.banned_until<=statement_timestamp())
    FOR SHARE OF r,a,u;
  IF NOT FOUND THEN RAISE EXCEPTION 'EXTERNAL_BRIDGE_REVIEWED_ADMIN_REQUIRED'; END IF;
  SELECT coalesce(jsonb_agg(login ORDER BY login),'[]') INTO expected_logins FROM (
    SELECT owner_login AS login FROM crm_external_private.customer_candidates WHERE batch_id=p_batch AND payload->'reviewHolds'='[]'
    UNION SELECT i.owner_login FROM crm_external_private.interest_candidates i
      JOIN crm_external_private.customer_candidates c ON c.batch_id=i.batch_id AND c.entity_key=i.customer_key
      WHERE i.batch_id=p_batch AND i.payload->'reviewHolds'='[]' AND c.payload->'reviewHolds'='[]'
  ) required;
  SELECT coalesce(jsonb_agg(v->>'login' ORDER BY v->>'login'),'[]'),coalesce(jsonb_agg(v ORDER BY v->>'login'),'[]')
    INTO actual_logins,normalized FROM jsonb_array_elements(p_bindings) v;
  IF actual_logins IS DISTINCT FROM expected_logins
    OR (SELECT count(DISTINCT v->>'authUserId') FROM jsonb_array_elements(p_bindings) v)<>jsonb_array_length(p_bindings) THEN
    RAISE EXCEPTION 'EXTERNAL_BRIDGE_BINDINGS_REQUIRED';
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(normalized) LOOP
    PERFORM 1 FROM account_security_private.reviewed_roles r
      JOIN auth.users u ON u.id=r.auth_user_id JOIN public.users p ON p.id=r.legacy_user_id
      JOIN sales_private.crm_user_roles c ON c.user_id=r.auth_user_id
      WHERE r.auth_user_id=(item->>'authUserId')::uuid AND p.username=item->>'login'
        AND r.review_revision=(item->>'revision')::bigint AND r.review_revision>0 AND r.role='Sales' AND r.enabled
        AND c.is_active AND c.role='sales' AND c.trusted_review_revision=r.review_revision
        AND u.deleted_at IS NULL AND NOT coalesce(u.is_anonymous,false) AND (u.banned_until IS NULL OR u.banned_until<=statement_timestamp())
      FOR SHARE OF r,u,p,c;
    IF NOT FOUND THEN RAISE EXCEPTION 'EXTERNAL_BRIDGE_BINDING_STALE'; END IF;
  END LOOP;
  -- Existence-only FKs do not protect mutable project membership on plots.
  -- Hold catalog rows through commit, including history still waiting for review.
  PERFORM p.name FROM public.projects p WHERE p.name IN (
    SELECT project_label FROM crm_external_private.interest_candidates WHERE batch_id=p_batch
  ) ORDER BY p.name FOR SHARE;
  PERFORM p.id FROM public.plots p WHERE p.id IN (
    SELECT plot_label_id FROM crm_external_private.booking_history WHERE batch_id=p_batch AND plot_label_id IS NOT NULL
  ) ORDER BY p.id FOR SHARE;
  IF EXISTS(SELECT 1 FROM crm_external_private.interest_candidates i LEFT JOIN public.projects p ON p.name=i.project_label
    WHERE i.batch_id=p_batch AND p.name IS NULL)
    OR EXISTS(SELECT 1 FROM crm_external_private.booking_history h
      LEFT JOIN crm_external_private.interest_candidates i ON i.batch_id=h.batch_id AND i.entity_key=h.interest_key
      LEFT JOIN public.plots p ON p.id=h.plot_label_id WHERE h.batch_id=p_batch AND h.plot_label_id IS NOT NULL
      AND (p.id IS NULL OR p.project_name IS DISTINCT FROM i.project_label)) THEN
    RAISE EXCEPTION 'EXTERNAL_BRIDGE_CATALOG_CHANGED';
  END IF;
  request_value:=jsonb_build_object('planDigest',p_plan_digest,'admin',p_admin,'bindings',normalized,'reviewRef',p_review_ref);
  SELECT * INTO prior FROM crm_external_private.bridge_receipts WHERE batch_id=p_batch;
  IF prior.batch_id IS NOT NULL THEN
    IF prior.request IS DISTINCT FROM request_value THEN RAISE EXCEPTION 'EXTERNAL_BRIDGE_REPLAY_CHANGED'; END IF;
    IF (SELECT count(*) FROM public.sales_customers WHERE external_snapshot_batch_id=p_batch)<>(prior.response->>'customers')::integer
      OR (SELECT count(*) FROM public.lead_project_interests WHERE external_snapshot_batch_id=p_batch)<>(prior.response->>'interests')::integer
      OR (SELECT count(*) FROM crm_external_private.booking_crm_links WHERE batch_id=p_batch)<>(prior.response->>'bookingHistoryLinks')::integer
      OR EXISTS(SELECT 1 FROM crm_external_private.booking_crm_links l
        JOIN crm_external_private.booking_history h ON h.batch_id=l.batch_id AND h.entity_key=l.booking_key
        LEFT JOIN public.sales_customers c ON c.external_snapshot_batch_id=h.batch_id AND c.external_customer_key=h.customer_key
        LEFT JOIN public.lead_project_interests i ON i.external_snapshot_batch_id=h.batch_id AND i.external_interest_key=h.interest_key
        WHERE l.batch_id=p_batch AND (l.customer_id IS DISTINCT FROM c.id OR l.interest_id IS DISTINCT FROM i.id OR l.plot_id IS DISTINCT FROM h.plot_label_id)) THEN
      RAISE EXCEPTION 'EXTERNAL_BRIDGE_REPLAY_INTEGRITY_REQUIRED';
    END IF;
    RETURN prior.response||jsonb_build_object('replayed',true);
  END IF;
  LOCK TABLE public.crm_settings IN SHARE MODE;
  IF EXISTS(SELECT 1 FROM public.crm_settings s,LATERAL jsonb_each(to_jsonb(s)) j
    WHERE (j.key LIKE '%\_enabled' ESCAPE '\' OR j.key='booking_cutover_reviewed') AND j.value='true') THEN
    RAISE EXCEPTION 'EXTERNAL_BRIDGE_DISABLED_CRM_REQUIRED';
  END IF;
  IF EXISTS(SELECT 1 FROM public.sales_customers) OR EXISTS(SELECT 1 FROM public.lead_project_interests) THEN
    RAISE EXCEPTION 'EXTERNAL_BRIDGE_EXISTING_CRM_REVIEW_REQUIRED';
  END IF;
  INSERT INTO public.sales_customers(customer_name,record_origin,phone,phone_data_status,intake_status,owner_user_id,
    created_by_user_id,lead_created_at,external_snapshot_batch_id,external_customer_key)
    SELECT c.customer_name,'legacy_import',NULL,'unknown_legacy','legacy_unclassified',(v->>'authUserId')::uuid,
      p_admin,NULL,c.batch_id,c.entity_key FROM crm_external_private.customer_candidates c
      JOIN jsonb_array_elements(normalized) v ON v->>'login'=c.owner_login
      WHERE c.batch_id=p_batch AND c.payload->'reviewHolds'='[]';
  INSERT INTO public.lead_project_interests(customer_id,project_name,owner_user_id,created_by_user_id,
    engagement_status,interest_created_at,external_snapshot_batch_id,external_interest_key)
    SELECT c.id,i.project_label,(v->>'authUserId')::uuid,p_admin,'legacy_unclassified',NULL,i.batch_id,i.entity_key
      FROM crm_external_private.interest_candidates i JOIN public.sales_customers c
      ON c.external_snapshot_batch_id=i.batch_id AND c.external_customer_key=i.customer_key
      JOIN jsonb_array_elements(normalized) v ON v->>'login'=i.owner_login
      WHERE i.batch_id=p_batch AND i.payload->'reviewHolds'='[]';
  INSERT INTO crm_external_private.booking_crm_links(batch_id,booking_key,customer_id,interest_id,plot_id)
    SELECT h.batch_id,h.entity_key,c.id,i.id,h.plot_label_id FROM crm_external_private.booking_history h
      LEFT JOIN public.sales_customers c ON c.external_snapshot_batch_id=h.batch_id AND c.external_customer_key=h.customer_key
      LEFT JOIN public.lead_project_interests i ON i.external_snapshot_batch_id=h.batch_id AND i.external_interest_key=h.interest_key
      WHERE h.batch_id=p_batch;
  response_value:=jsonb_build_object('batchId',p_batch,'replayed',false,
    'customers',(SELECT count(*) FROM public.sales_customers WHERE external_snapshot_batch_id=p_batch),
    'interests',(SELECT count(*) FROM public.lead_project_interests WHERE external_snapshot_batch_id=p_batch),
    'bookingHistoryLinks',(SELECT count(*) FROM crm_external_private.booking_crm_links WHERE batch_id=p_batch),
    'salesWritten',0,'plotsChanged',0,'activationReady',false);
  INSERT INTO crm_external_private.bridge_receipts(batch_id,request,response) VALUES(p_batch,request_value,response_value);
  RETURN response_value;
END;
$$;

DO $seal$
DECLARE obj record; grantee_name text;
BEGIN
  FOR obj IN SELECT oid,relname,relowner FROM pg_class WHERE relnamespace='crm_external_private'::regnamespace
    AND relname IN ('bridge_receipts','booking_crm_links') AND relkind='r' LOOP
    EXECUTE format('ALTER TABLE crm_external_private.%I ENABLE ROW LEVEL SECURITY',obj.relname);
    EXECUTE format('CREATE TRIGGER immutable_history BEFORE UPDATE OR DELETE OR TRUNCATE ON crm_external_private.%I FOR EACH STATEMENT EXECUTE FUNCTION crm_external_private.reject_history_change()',obj.relname);
    FOR grantee_name IN SELECT DISTINCT CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(a.grantee)) END
      FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
      WHERE c.oid=obj.oid AND a.grantee<>obj.relowner LOOP
      EXECUTE format('REVOKE ALL ON TABLE crm_external_private.%I FROM %s',obj.relname,grantee_name);
    END LOOP;
  END LOOP;
  FOR obj IN SELECT oid,proowner FROM pg_proc WHERE pronamespace='crm_external_private'::regnamespace LOOP
    FOR grantee_name IN SELECT DISTINCT CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(a.grantee)) END
      FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      WHERE p.oid=obj.oid AND a.grantee<>obj.proowner LOOP
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %s',obj.oid::regprocedure,grantee_name);
    END LOOP;
  END LOOP;
END;
$seal$;

-- Reviewed source: sql/sales/external_booking_bridge_draft.sql
-- LF-normalized SHA256: 4c860bf40d89d57afbe594f1609a002d7bac389663dd7564396bc85c9d7248e0
-- LOCAL DESIGN ONLY: sealed replacement candidates, NOT an inventory cutover.
-- Never writes public.sales/plots or retires/deletes legacy rows.

SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='30s';

-- Dates retain source day precision. No import timestamp substitutes unknown dates.
CREATE VIEW crm_external_private.booking_sales_projection WITH (security_invoker=true) AS
SELECT h.batch_id,h.entity_key AS booking_key,h.source_row,l.customer_id,l.interest_id,l.plot_id,
  i.project_name,i.owner_user_id AS closing_sales_user_id,h.stage,
  (h.payload->>'bookedDate')::date AS booked_date,
  (h.payload->>'cancelledDate')::date AS cancelled_date,
  (h.payload->>'transferredDate')::date AS transferred_date,
  (h.payload->>'salePrice')::numeric AS sale_price,
  (h.payload->>'depositAmount')::numeric AS deposit_amount,
  h.payload->>'paymentMethod' AS payment_method,h.payload->>'cancellationReason' AS cancellation_reason,
  h.payload->'reviewHolds' AS review_holds,
  (h.payload->'reviewHolds'='[]' AND l.customer_id IS NOT NULL
    AND l.interest_id IS NOT NULL AND l.plot_id IS NOT NULL) AS eligible_for_release_review
FROM crm_external_private.booking_history h
JOIN crm_external_private.booking_crm_links l ON l.batch_id=h.batch_id AND l.booking_key=h.entity_key
LEFT JOIN public.lead_project_interests i ON i.id=l.interest_id;

CREATE TABLE crm_external_private.prepared_booking_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL,
  booking_key text NOT NULL,
  payload jsonb NOT NULL,
  plot_id text GENERATED ALWAYS AS (payload->>'plot_id') STORED,
  stage text GENERATED ALWAYS AS (payload->>'stage') STORED NOT NULL,
  UNIQUE(batch_id,booking_key),
  FOREIGN KEY(batch_id,booking_key) REFERENCES crm_external_private.booking_crm_links(batch_id,booking_key) ON DELETE RESTRICT,
  CHECK(stage IN ('booked','transferred','cancelled')),
  CHECK(stage='cancelled' OR plot_id IS NOT NULL)
);
-- Every non-cancelled source row counts, even a held customer. Never hide an
-- active collision by excluding held candidates or transferred history.
CREATE UNIQUE INDEX prepared_booking_active_plot_idx
  ON crm_external_private.prepared_booking_sales(batch_id,plot_id) WHERE stage<>'cancelled';

CREATE TABLE crm_external_private.booking_release_receipts (
  batch_id uuid PRIMARY KEY REFERENCES crm_external_private.bridge_receipts(batch_id) ON DELETE RESTRICT,
  request jsonb NOT NULL,
  legacy_snapshot jsonb NOT NULL,
  response jsonb NOT NULL,
  captured_by name NOT NULL DEFAULT current_user,
  captured_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION crm_external_private.guard_prepared_booking()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE expected jsonb;
BEGIN
  SELECT to_jsonb(p) INTO expected FROM crm_external_private.booking_sales_projection p
    WHERE p.batch_id=NEW.batch_id AND p.booking_key=NEW.booking_key;
  IF expected IS NULL OR NEW.payload IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'EXTERNAL_BOOKING_EVIDENCE_REQUIRED';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER prepared_booking_evidence BEFORE INSERT ON crm_external_private.prepared_booking_sales
  FOR EACH ROW EXECUTE FUNCTION crm_external_private.guard_prepared_booking();

CREATE FUNCTION crm_external_private.prepare_booking_release(p_batch uuid,p_plan_digest text,p_review_ref text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' SET lock_timeout='2s' AS $$
DECLARE identity_receipt crm_external_private.bridge_receipts%ROWTYPE;
  prior crm_external_private.booking_release_receipts%ROWTYPE;
  baseline jsonb; request_value jsonb; response_value jsonb;
BEGIN
  IF current_user IS DISTINCT FROM (SELECT pg_get_userbyid(relowner) FROM pg_class
    WHERE oid='crm_external_private.snapshot_batches'::regclass) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='EXTERNAL_BOOKING_OPERATOR_REQUIRED';
  END IF;
  IF p_batch IS NULL OR p_plan_digest IS NULL OR nullif(btrim(p_review_ref),'') IS NULL THEN
    RAISE EXCEPTION 'EXTERNAL_BOOKING_INPUT_INVALID';
  END IF;
  -- Match the identity bridge lock order. Revalidate pinned staging evidence:
  -- a later operator append must not disappear through the projection's join.
  PERFORM pg_advisory_xact_lock(20260925,3);
  PERFORM crm_external_private.stage_snapshot(payload)
    FROM crm_external_private.snapshot_batches WHERE id=p_batch;
  SELECT * INTO identity_receipt FROM crm_external_private.bridge_receipts WHERE batch_id=p_batch;
  IF identity_receipt.batch_id IS NULL THEN RAISE EXCEPTION 'EXTERNAL_BOOKING_IDENTITY_BRIDGE_REQUIRED'; END IF;
  -- Reuse the exact identity receipt, rechecking canonical roles/Auth/revisions,
  -- catalog locks, READ COMMITTED isolation, plan and immutable link membership.
  PERFORM crm_external_private.materialize_crm(p_batch,p_plan_digest,
    (identity_receipt.request->>'admin')::uuid,identity_receipt.request->'bindings',identity_receipt.request->>'reviewRef');
  IF EXISTS(SELECT 1 FROM crm_external_private.booking_history h
    LEFT JOIN crm_external_private.booking_crm_links l ON l.batch_id=h.batch_id AND l.booking_key=h.entity_key
    WHERE h.batch_id=p_batch AND l.booking_key IS NULL)
    OR (SELECT count(*) FROM crm_external_private.booking_sales_projection WHERE batch_id=p_batch)
      <>(SELECT count(*) FROM crm_external_private.booking_history WHERE batch_id=p_batch) THEN
    RAISE EXCEPTION 'EXTERNAL_BOOKING_COVERAGE_REQUIRED';
  END IF;
  LOCK TABLE public.crm_settings,public.leads,public.sales,public.plots,public.projects,public.customer_voices IN SHARE MODE;
  IF EXISTS(SELECT 1 FROM public.crm_settings s,LATERAL jsonb_each(to_jsonb(s)) j
    WHERE (j.key LIKE '%\_enabled' ESCAPE '\' OR j.key='booking_cutover_reviewed') AND j.value='true') THEN
    RAISE EXCEPTION 'EXTERNAL_BOOKING_DISABLED_CRM_REQUIRED';
  END IF;
  SELECT jsonb_build_object(
    'leads',coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM public.leads l),'[]'),
    'sales',coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.sales s),'[]'),
    'plots',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.plots p),'[]'),
    'projects',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY name) FROM public.projects p),'[]'),
    'voices',coalesce((SELECT jsonb_agg(to_jsonb(v) ORDER BY id) FROM public.customer_voices v),'[]')) INTO baseline;
  request_value:=jsonb_build_object('planDigest',p_plan_digest,'identityRequest',identity_receipt.request,'reviewRef',p_review_ref);
  SELECT * INTO prior FROM crm_external_private.booking_release_receipts WHERE batch_id=p_batch;
  IF prior.batch_id IS NOT NULL THEN
    IF prior.request IS DISTINCT FROM request_value THEN RAISE EXCEPTION 'EXTERNAL_BOOKING_REPLAY_CHANGED'; END IF;
    IF prior.legacy_snapshot IS DISTINCT FROM baseline THEN RAISE EXCEPTION 'EXTERNAL_BOOKING_LEGACY_CHANGED'; END IF;
    IF (SELECT count(*) FROM crm_external_private.prepared_booking_sales WHERE batch_id=p_batch)
        <>(prior.response->>'bookingHistories')::integer
      OR EXISTS(SELECT 1 FROM crm_external_private.prepared_booking_sales s
        LEFT JOIN crm_external_private.booking_sales_projection p ON p.batch_id=s.batch_id AND p.booking_key=s.booking_key
        WHERE s.batch_id=p_batch AND (p.booking_key IS NULL OR s.payload IS DISTINCT FROM to_jsonb(p))) THEN
      RAISE EXCEPTION 'EXTERNAL_BOOKING_REPLAY_INTEGRITY_REQUIRED';
    END IF;
    RETURN prior.response||jsonb_build_object('replayed',true);
  END IF;
  IF EXISTS(SELECT 1 FROM crm_external_private.prepared_booking_sales WHERE batch_id=p_batch) THEN
    RAISE EXCEPTION 'EXTERNAL_BOOKING_PARTIAL_PREPARATION';
  END IF;
  IF EXISTS(SELECT 1 FROM crm_external_private.booking_sales_projection
    WHERE batch_id=p_batch AND stage<>'cancelled' GROUP BY plot_id HAVING plot_id IS NULL OR count(*)>1) THEN
    RAISE EXCEPTION 'EXTERNAL_BOOKING_ACTIVE_PLOT_COLLISION';
  END IF;
  INSERT INTO crm_external_private.prepared_booking_sales(batch_id,booking_key,payload)
    SELECT p.batch_id,p.booking_key,to_jsonb(p) FROM crm_external_private.booking_sales_projection p WHERE p.batch_id=p_batch;
  response_value:=jsonb_build_object('batchId',p_batch,'replayed',false,
    'bookingHistories',(SELECT count(*) FROM crm_external_private.prepared_booking_sales WHERE batch_id=p_batch),
    'eligibleForReleaseReview',(SELECT count(*) FROM crm_external_private.booking_sales_projection WHERE batch_id=p_batch AND eligible_for_release_review),
    'heldHistories',(SELECT count(*) FROM crm_external_private.booking_sales_projection WHERE batch_id=p_batch AND NOT eligible_for_release_review),
    'activeSourcePlots',(SELECT count(*) FROM crm_external_private.prepared_booking_sales WHERE batch_id=p_batch AND stage<>'cancelled'),
    'legacySalesPreserved',jsonb_array_length(baseline->'sales'),'salesWritten',0,'plotsChanged',0,'activationReady',false);
  INSERT INTO crm_external_private.booking_release_receipts(batch_id,request,legacy_snapshot,response)
    VALUES(p_batch,request_value,baseline,response_value);
  RETURN response_value;
END;
$$;

DO $seal$
DECLARE obj record; grantee_name text;
BEGIN
  FOR obj IN SELECT oid,relname,relowner,relkind FROM pg_class WHERE relnamespace='crm_external_private'::regnamespace
    AND relname IN ('prepared_booking_sales','booking_release_receipts','booking_sales_projection') LOOP
    IF obj.relkind='r' THEN
      EXECUTE format('ALTER TABLE crm_external_private.%I ENABLE ROW LEVEL SECURITY',obj.relname);
      EXECUTE format('CREATE TRIGGER immutable_history BEFORE UPDATE OR DELETE OR TRUNCATE ON crm_external_private.%I FOR EACH STATEMENT EXECUTE FUNCTION crm_external_private.reject_history_change()',obj.relname);
    END IF;
    FOR grantee_name IN SELECT DISTINCT CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(a.grantee)) END
      FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
      WHERE c.oid=obj.oid AND a.grantee<>obj.relowner LOOP
      EXECUTE format('REVOKE ALL ON TABLE crm_external_private.%I FROM %s',obj.relname,grantee_name);
    END LOOP;
  END LOOP;
  FOR obj IN SELECT oid,proowner FROM pg_proc WHERE pronamespace='crm_external_private'::regnamespace
    AND proname IN ('guard_prepared_booking','prepare_booking_release') LOOP
    FOR grantee_name IN SELECT DISTINCT CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(a.grantee)) END
      FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      WHERE p.oid=obj.oid AND a.grantee<>obj.proowner LOOP
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %s',obj.oid::regprocedure,grantee_name);
    END LOOP;
  END LOOP;
END;
$seal$;

-- Reviewed source: sql/sales/external_sales_cutover_draft.sql
-- LF-normalized SHA256: 72c5b3b596e6131b4367d4c0cf0bddd62f5f0f009bd913d3188c784508db8122
-- ISOLATED DESIGN ONLY. No operational grants, activation or deployment.

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

-- Reviewed source: sql/sales/external_sale_evidence_draft.sql
-- LF-normalized SHA256: bc755f0efe1c6730e2d665c819ca9e73a0c27518f4aac527669725abbe1c1809
-- DESIGN ONLY: read-only evidence projection after the sealed external cutover.
-- No activation, write permits, public grants or relaxation of sealed history.


CREATE FUNCTION crm_external_private.sale_history(p_sale jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE persisted public.sales%ROWTYPE;
  prepared crm_external_private.prepared_booking_sales%ROWTYPE;
  history crm_external_private.booking_history%ROWTYPE;
  original jsonb; interest public.lead_project_interests%ROWTYPE;
BEGIN
  SELECT * INTO persisted FROM public.sales WHERE id=(p_sale->>'id')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'EXTERNAL_SALE_EVIDENCE_REQUIRED'; END IF;
  IF persisted.external_booking_id IS NULL AND persisted.external_source_stage IS NULL
    AND p_sale->>'external_booking_id' IS NULL AND p_sale->>'external_source_stage' IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO prepared FROM crm_external_private.prepared_booking_sales WHERE id=persisted.external_booking_id;
  SELECT * INTO history FROM crm_external_private.booking_history
    WHERE batch_id=prepared.batch_id AND entity_key=prepared.booking_key;
  SELECT * INTO interest FROM public.lead_project_interests WHERE id=persisted.project_interest_id;
  SELECT entry INTO original FROM crm_external_private.sales_cutover_receipts r,
    LATERAL jsonb_array_elements(r.after_sales) entry
    WHERE r.batch_id=prepared.batch_id AND entry->>'id'=persisted.id::text
      AND NOT EXISTS(SELECT 1 FROM crm_external_private.sales_rollback_receipts b WHERE b.batch_id=r.batch_id);
  IF prepared.id IS NULL OR history.entity_key IS NULL OR original IS NULL OR interest.id IS NULL
    OR (prepared.payload->>'eligible_for_release_review')::boolean IS DISTINCT FROM true
    OR prepared.payload->'review_holds' IS DISTINCT FROM '[]'::jsonb
    OR persisted.id IS DISTINCT FROM prepared.id
    OR persisted.external_source_stage IS DISTINCT FROM prepared.stage OR prepared.stage IS DISTINCT FROM history.stage
    OR persisted.project_interest_id IS DISTINCT FROM (prepared.payload->>'interest_id')::uuid
    OR persisted.plot_id IS DISTINCT FROM prepared.plot_id
    OR interest.customer_id IS DISTINCT FROM (prepared.payload->>'customer_id')::uuid
    OR interest.project_name IS DISTINCT FROM prepared.payload->>'project_name'
    OR persisted.booking_route IS DISTINCT FROM 'legacy_import'
    OR persisted.booking_round IS NOT NULL OR persisted.previous_sale_id IS NOT NULL OR persisted.lead_id IS NOT NULL
    OR persisted.booked_at IS NOT NULL OR persisted.list_price IS NOT NULL OR persisted.discount_amount IS NOT NULL
    OR original->>'crm_stage' IS DISTINCT FROM prepared.stage
    OR (prepared.stage='cancelled' AND (persisted.crm_stage IS DISTINCT FROM 'cancelled' OR persisted.cancelled_at IS NOT NULL))
    OR (prepared.stage='transferred' AND persisted.crm_stage NOT IN ('transferred','handover'))
    OR NOT EXISTS(SELECT 1 FROM crm_external_private.booking_crm_links l WHERE l.batch_id=prepared.batch_id
      AND l.booking_key=prepared.booking_key AND l.customer_id=interest.customer_id
      AND l.interest_id=interest.id AND l.plot_id=persisted.plot_id)
    OR EXISTS(SELECT 1 FROM unnest(ARRAY['id','external_booking_id','external_source_stage','project_interest_id','plot_id',
      'booking_route','booking_round','previous_sale_id','lead_id','booked_at','list_price','discount_amount']) field
      WHERE p_sale->field IS DISTINCT FROM to_jsonb(persisted)->field
        OR original->field IS DISTINCT FROM to_jsonb(persisted)->field)
    OR prepared.payload->'source_row' IS DISTINCT FROM to_jsonb(history.source_row)
    OR prepared.payload->'booked_date' IS DISTINCT FROM history.payload->'bookedDate'
    OR prepared.payload->'cancelled_date' IS DISTINCT FROM history.payload->'cancelledDate'
    OR prepared.payload->'transferred_date' IS DISTINCT FROM history.payload->'transferredDate' THEN
    RAISE EXCEPTION 'EXTERNAL_SALE_EVIDENCE_REQUIRED';
  END IF;
  -- No names, phones, income, full source payload or operator review notes.
  -- Source days remain days; operational timestamps and current stages are separate.
  RETURN jsonb_build_object('source','customer_sheet','batchId',prepared.batch_id,'sourceRow',history.source_row,
    'sourceStage',history.stage,'bookedDate',history.payload->'bookedDate',
    'cancelledDate',history.payload->'cancelledDate','transferredDate',history.payload->'transferredDate');
END;
$$;
DO $seal$
DECLARE grantee_name text;
BEGIN
  FOR grantee_name IN SELECT DISTINCT CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(a.grantee)) END
    FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    WHERE p.oid='crm_external_private.sale_history(jsonb)'::regprocedure AND a.grantee<>p.proowner LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION crm_external_private.sale_history(jsonb) FROM %s',grantee_name);
  END LOOP;
END;
$seal$;

-- No stage_snapshot/materialize_crm/prepare_booking_release/replace_sales call.
-- Those remain separate operator-reviewed transactions bound to actual source.
DO $external_data_after$
DECLARE r record; result text; added text[]; row_count bigint;
BEGIN
  IF EXISTS(SELECT 1 FROM external_data_functions b LEFT JOIN pg_proc p ON p.oid=b.oid
      WHERE p.oid IS NULL OR md5(pg_get_functiondef(p.oid)||coalesce(p.proacl::text,'')||p.proowner::text) IS DISTINCT FROM b.hash)
    OR EXISTS(SELECT 1 FROM external_data_relations b LEFT JOIN pg_class c ON c.oid=b.oid
      WHERE c.oid IS NULL OR (c.relacl,c.relrowsecurity,c.relowner) IS DISTINCT FROM (b.relacl,b.relrowsecurity,b.relowner))
    OR EXISTS(SELECT 1 FROM external_data_policies b LEFT JOIN pg_policy p ON p.oid=b.oid
      WHERE p.oid IS NULL OR md5(to_jsonb(p)::text) IS DISTINCT FROM b.hash) THEN
    RAISE EXCEPTION 'EXTERNAL_DATA_SHARED_OBJECT_CHANGED';
  END IF;
  -- The sole allowed trigger replacement retains events, arguments and state.
  IF EXISTS(SELECT 1 FROM external_data_triggers b LEFT JOIN pg_trigger t ON t.tgrelid=b.tgrelid AND t.tgname=b.tgname
    WHERE t.oid IS NULL OR t.tgenabled IS DISTINCT FROM b.tgenabled
      OR pg_get_triggerdef(t.oid) IS DISTINCT FROM CASE
        WHEN b.tgrelid='public.sales'::regclass AND b.tgname='crm_foundation_legacy_fields_sealed'
        THEN replace(b.definition,'sales_private.reject_sealed_legacy_fields','crm_external_private.guard_cutover_sale')
        ELSE b.definition END) THEN
    RAISE EXCEPTION 'EXTERNAL_DATA_SHARED_TRIGGER_CHANGED';
  END IF;
  FOR r IN SELECT * FROM external_data_relations WHERE data_hash IS NOT NULL LOOP
    SELECT coalesce(array_agg(attname::text),'{}'::text[]) INTO added FROM pg_attribute
      WHERE attrelid=r.oid AND attnum>0 AND NOT attisdropped AND NOT attname=ANY(r.columns);
    EXECUTE format('SELECT md5(coalesce(jsonb_agg(to_jsonb(t)-$1 ORDER BY (to_jsonb(t)-$1)::text)::text,''[]'')) FROM %I.%I t',r.nspname,r.relname) INTO result USING added;
    IF result IS DISTINCT FROM r.data_hash THEN RAISE EXCEPTION 'EXTERNAL_DATA_SHARED_DATA_CHANGED'; END IF;
  END LOOP;
  FOR r IN SELECT relname FROM pg_class WHERE relnamespace='crm_external_private'::regnamespace AND relkind='r' LOOP
    EXECUTE format('SELECT count(*) FROM crm_external_private.%I',r.relname) INTO row_count;
    IF row_count<>0 THEN RAISE EXCEPTION 'EXTERNAL_DATA_IMPORT_FORBIDDEN'; END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM pg_class c,LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
    WHERE c.relnamespace='crm_external_private'::regnamespace AND c.relkind IN ('r','v') AND a.grantee<>c.relowner)
    OR EXISTS(SELECT 1 FROM pg_class c WHERE c.relnamespace='crm_external_private'::regnamespace AND c.relkind='r' AND NOT c.relrowsecurity)
    OR EXISTS(SELECT 1 FROM pg_proc p,LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      WHERE p.pronamespace='crm_external_private'::regnamespace AND a.grantee<>p.proowner)
    OR EXISTS(SELECT 1 FROM pg_namespace n,LATERAL aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a
      WHERE n.nspname='crm_external_private' AND a.grantee<>n.nspowner) THEN
    RAISE EXCEPTION 'EXTERNAL_DATA_UNSEALED_OBJECT';
  END IF;
  IF EXISTS(SELECT 1 FROM public.crm_settings s,LATERAL jsonb_each(to_jsonb(s)) j
    WHERE (j.key LIKE '%\_enabled' ESCAPE '\' OR j.key='booking_cutover_reviewed') AND j.value='true')
    OR to_regprocedure('crm_external_private.enable_booking_writer(uuid,text,text)') IS NOT NULL
    OR EXISTS(SELECT 1 FROM public.sales WHERE external_booking_id IS NOT NULL OR external_source_stage IS NOT NULL) THEN
    RAISE EXCEPTION 'EXTERNAL_DATA_UNEXPECTED_ACTIVATION';
  END IF;
END;
$external_data_after$;
COMMIT;
