-- DESIGN ONLY. Private historical staging, NOT a CRM importer or deployment migration.
-- No public/Auth/project/plot/legacy objects are altered. No real source data here.
BEGIN;
DO $draft_only$
BEGIN
  RAISE EXCEPTION 'DESIGN ONLY: external snapshot staging requires isolated tests and separate deployment review';
END;
$draft_only$;

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

ROLLBACK;
