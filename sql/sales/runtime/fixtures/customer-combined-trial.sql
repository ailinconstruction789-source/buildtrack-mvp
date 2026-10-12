-- PRIVATE RELATIONAL REHEARSAL ONLY; NOT A MIGRATION OR PRODUCTION IMPORTER.
-- Captured UUID relationships/stages plus deliberately SYNTHETIC financial state.
-- Does not reproduce production import guards, triggers, auth or bank/payment policy.
BEGIN;
DO $owned$ BEGIN
  IF current_database() !~ '^buildtrack_sales_runtime_[a-f0-9]+$'
    OR current_setting('buildtrack.synthetic_runtime',true) IS DISTINCT FROM 'on'
    OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet THEN
    RAISE EXCEPTION 'OWNED COMBINED TRIAL ONLY'; END IF;
END $owned$;
CREATE SCHEMA customer_combined_trial;
REVOKE ALL ON SCHEMA customer_combined_trial FROM PUBLIC,anon,authenticated;
CREATE TABLE customer_combined_trial.roles(id uuid PRIMARY KEY,role text NOT NULL,active boolean NOT NULL);
CREATE TABLE customer_combined_trial.customers(id uuid PRIMARY KEY,name_hash text NOT NULL,
  owner_id uuid REFERENCES customer_combined_trial.roles(id));
CREATE TABLE customer_combined_trial.interests(id uuid PRIMARY KEY,customer_id uuid NOT NULL REFERENCES customer_combined_trial.customers(id),
  project_name text NOT NULL,owner_id uuid REFERENCES customer_combined_trial.roles(id),
  UNIQUE(customer_id,project_name),UNIQUE(id,customer_id,project_name));
CREATE TABLE customer_combined_trial.plots(id text PRIMARY KEY,project_name text NOT NULL,UNIQUE(id,project_name));
CREATE TABLE customer_combined_trial.sales(id uuid PRIMARY KEY,customer_id uuid NOT NULL,interest_id uuid NOT NULL,
  project_name text NOT NULL,plot_id text NOT NULL,stage text NOT NULL CHECK(stage IN ('booked','transferred','cancelled')),
  price numeric CHECK(price>=0),forecast date,bank text,actual_timestamp timestamptz,
  FOREIGN KEY(interest_id,customer_id,project_name) REFERENCES customer_combined_trial.interests(id,customer_id,project_name),
  FOREIGN KEY(plot_id,project_name) REFERENCES customer_combined_trial.plots(id,project_name));
CREATE UNIQUE INDEX combined_active_plot ON customer_combined_trial.sales(plot_id) WHERE stage<>'cancelled';
CREATE TABLE customer_combined_trial.receipts(source_hash text PRIMARY KEY,plan_digest text UNIQUE NOT NULL,payload jsonb NOT NULL);
CREATE TABLE customer_combined_trial.source_rows(source_hash text REFERENCES customer_combined_trial.receipts(source_hash),
  source_row integer CHECK(source_row BETWEEN 2 AND 50000),sale_id uuid REFERENCES customer_combined_trial.sales(id),payload jsonb NOT NULL,
  PRIMARY KEY(source_hash,source_row));
CREATE TABLE customer_combined_trial.history(source_hash text NOT NULL,source_row integer NOT NULL,
  sequence integer CHECK(sequence>0),kind text CHECK(kind IN ('visited','booked','transferred','cancelled')),
  occurred_day date,precision text NOT NULL,
  FOREIGN KEY(source_hash,source_row) REFERENCES customer_combined_trial.source_rows(source_hash,source_row),
  PRIMARY KEY(source_hash,source_row,sequence),
  CHECK((precision='unknown' AND occurred_day IS NULL) OR (precision='day' AND occurred_day IS NOT NULL)));
DO $rls$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['roles','customers','interests','plots','sales','receipts','source_rows','history'] LOOP
    EXECUTE format('ALTER TABLE customer_combined_trial.%I ENABLE ROW LEVEL SECURITY',t);
  END LOOP;
END $rls$;
REVOKE ALL ON ALL TABLES IN SCHEMA customer_combined_trial FROM PUBLIC,anon,authenticated;

CREATE FUNCTION customer_combined_trial.apply_plan(p jsonb) RETURNS text
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,customer_combined_trial AS $body$
DECLARE r jsonb; e jsonb; n integer; sid uuid; existing jsonb; current_sale customer_combined_trial.sales%ROWTYPE;
BEGIN
  IF current_database() !~ '^buildtrack_sales_runtime_[a-f0-9]+$'
    OR current_setting('buildtrack.synthetic_runtime',true) IS DISTINCT FROM 'on'
    OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet
    OR p->>'trialOnly' IS DISTINCT FROM 'true' OR p->>'businessWritesAllowed' IS DISTINCT FROM 'false'
    OR p->>'canonicalImportReady' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'TRIAL ONLY'; END IF;
  SELECT payload INTO existing FROM customer_combined_trial.receipts WHERE source_hash=p->>'sourceSha256';
  IF FOUND THEN
    IF existing IS DISTINCT FROM p THEN RAISE EXCEPTION 'REPLAY PAYLOAD CHANGED'; END IF;
    RETURN 'already_applied';
  END IF;
  -- Verify the full candidate set BEFORE freeing any plot; never guess IDs/roles.
  FOR r IN SELECT value FROM jsonb_array_elements(p->'rows') LOOP
    IF r->>'disposition'='held' THEN CONTINUE; END IF;
    IF NOT EXISTS(SELECT 1 FROM customer_combined_trial.roles WHERE id=(r->>'sourceSalesOwnerUserId')::uuid AND role='sales' AND active)
      OR NOT EXISTS(SELECT 1 FROM customer_combined_trial.interests WHERE id=(r->>'interestId')::uuid
        AND customer_id=(r->>'customerId')::uuid AND project_name=r->>'projectName') THEN RAISE EXCEPTION 'CANDIDATE BINDING OR ROLE CHANGED'; END IF;
    IF r->>'saleId' IS NOT NULL THEN
      SELECT * INTO current_sale FROM customer_combined_trial.sales WHERE id=(r->>'saleId')::uuid;
      IF NOT FOUND OR current_sale.customer_id IS DISTINCT FROM (r->>'customerId')::uuid
        OR current_sale.interest_id IS DISTINCT FROM (r->>'interestId')::uuid OR current_sale.plot_id IS DISTINCT FROM r->>'plotId'
        OR current_sale.stage IS DISTINCT FROM r->>'priorStage' THEN RAISE EXCEPTION 'SALE CHANGED'; END IF;
    END IF;
  END LOOP;
  INSERT INTO customer_combined_trial.receipts VALUES(p->>'sourceSha256',p->>'combinedPlanDigest',p);
  -- Cancellations first, atomically. This is a HISTORICAL PROPOSAL, not the normal
  -- cancellation command (which requires operational timestamp/category/reason).
  UPDATE customer_combined_trial.sales s SET stage='cancelled'
    FROM jsonb_array_elements(p->'rows') AS src(value) WHERE src.value->>'disposition'<>'held'
      AND src.value->>'action'='propose_existing_booking_revision' AND src.value->>'sourceStage'='cancelled' AND s.id=(src.value->>'saleId')::uuid;
  FOR r IN SELECT value FROM jsonb_array_elements(p->'rows') ORDER BY (value->>'sourceRow')::integer LOOP
    sid:=NULL;
    IF r->>'disposition'<>'held' THEN
      sid:=(r->>'saleId')::uuid;
      IF r->>'action'='propose_new_booking_for_existing_customer' THEN
        -- Deterministic PRIVATE fixture UUID only; not approved production identity.
        sid:=substr(r->>'newBookingCandidateKey',1,32)::uuid;
        INSERT INTO customer_combined_trial.sales(id,customer_id,interest_id,project_name,plot_id,stage)
          VALUES(sid,(r->>'customerId')::uuid,(r->>'interestId')::uuid,r->>'projectName',r->>'plotId',r->>'sourceStage');
      END IF;
      IF sid IS NOT NULL THEN
        UPDATE customer_combined_trial.sales SET
          stage=CASE WHEN r->>'action'='propose_existing_booking_revision' THEN r->>'sourceStage' ELSE stage END,
          price=coalesce((r->>'salePrice')::numeric,price),forecast=coalesce((r->>'expectedTransferDate')::date,forecast)
          WHERE id=sid;
      END IF;
    END IF;
    INSERT INTO customer_combined_trial.source_rows VALUES(p->>'sourceSha256',(r->>'sourceRow')::integer,sid,r);
    IF r->>'disposition'<>'held' THEN
      n:=0;
      FOR e IN SELECT value FROM jsonb_array_elements(r->'sourceHistory') LOOP
        n:=n+1;
        INSERT INTO customer_combined_trial.history VALUES(p->>'sourceSha256',(r->>'sourceRow')::integer,n,
          e->>'kind',(e->>'date')::date,e->>'precision');
      END LOOP;
    END IF;
  END LOOP;
  RETURN 'applied_private_trial';
END $body$;
REVOKE ALL ON FUNCTION customer_combined_trial.apply_plan(jsonb) FROM PUBLIC,anon,authenticated;
COMMIT;
