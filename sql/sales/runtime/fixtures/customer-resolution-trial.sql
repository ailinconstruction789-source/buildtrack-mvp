-- PRIVATE OWNED-LOOPBACK RELATIONAL REHEARSAL ONLY. NOT A MIGRATION OR REAL WRITER.
-- Unknown project/booking remain source history, never fake catalog entries or sales.
BEGIN;
DO $owned$ BEGIN
  IF current_database() !~ '^buildtrack_sales_runtime_[a-f0-9]+$'
    OR current_setting('buildtrack.synthetic_runtime',true) IS DISTINCT FROM 'on'
    OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet THEN RAISE EXCEPTION 'OWNED RESOLUTION TRIAL ONLY'; END IF;
END $owned$;
CREATE TABLE customer_combined_trial.resolution_receipts(source_hash text PRIMARY KEY,payload jsonb NOT NULL);
CREATE TABLE customer_combined_trial.resolution_rows(source_hash text NOT NULL REFERENCES customer_combined_trial.resolution_receipts(source_hash),
  source_row integer NOT NULL,customer_id uuid NOT NULL REFERENCES customer_combined_trial.customers(id),
  interest_id uuid REFERENCES customer_combined_trial.interests(id),payload jsonb NOT NULL,
  PRIMARY KEY(source_hash,source_row));
CREATE TABLE customer_combined_trial.customer_events(source_hash text NOT NULL,source_row integer NOT NULL,sequence integer NOT NULL CHECK(sequence>0),
  customer_id uuid NOT NULL REFERENCES customer_combined_trial.customers(id),interest_id uuid,project_name text,
  plot_id text REFERENCES customer_combined_trial.plots(id),kind text NOT NULL CHECK(kind IN ('visited','booked','transferred','cancelled')),
  occurred_day date,precision text NOT NULL,
  FOREIGN KEY(source_hash,source_row) REFERENCES customer_combined_trial.resolution_rows(source_hash,source_row),
  FOREIGN KEY(interest_id,customer_id,project_name) REFERENCES customer_combined_trial.interests(id,customer_id,project_name),
  PRIMARY KEY(source_hash,source_row,sequence),
  CHECK((precision='unknown' AND occurred_day IS NULL) OR (precision='day' AND occurred_day IS NOT NULL)),
  CHECK((interest_id IS NULL AND project_name IS NULL) OR (interest_id IS NOT NULL AND project_name IS NOT NULL)));
ALTER TABLE customer_combined_trial.resolution_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_combined_trial.resolution_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_combined_trial.customer_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON customer_combined_trial.resolution_receipts,customer_combined_trial.resolution_rows,customer_combined_trial.customer_events FROM PUBLIC,anon,authenticated;

CREATE FUNCTION customer_combined_trial.apply_resolved_bundle(b jsonb,p jsonb) RETURNS text
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,customer_combined_trial AS $body$
DECLARE row_data jsonb; event_data jsonb; event_sequence integer; cid uuid; iid uuid; existing_payload jsonb;
BEGIN
  IF current_database() !~ '^buildtrack_sales_runtime_[a-f0-9]+$'
    OR current_setting('buildtrack.synthetic_runtime',true) IS DISTINCT FROM 'on'
    OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet OR p->>'trialOnly' IS DISTINCT FROM 'true'
    OR p->>'businessWritesAllowed' IS DISTINCT FROM 'false' OR p->>'canonicalImportReady' IS DISTINCT FROM 'false'
    OR p->>'previousSourceSha256' IS DISTINCT FROM b->>'sourceSha256'
    OR p->>'basePlanDigest' IS DISTINCT FROM b->>'combinedPlanDigest' THEN RAISE EXCEPTION 'TRIAL BUNDLE ONLY'; END IF;
  SELECT payload INTO existing_payload FROM customer_combined_trial.resolution_receipts WHERE source_hash=p->>'sourceSha256';
  IF FOUND THEN
    IF existing_payload IS DISTINCT FROM p THEN RAISE EXCEPTION 'RESOLUTION REPLAY PAYLOAD CHANGED'; END IF;
    RETURN 'already_applied';
  END IF;
  -- Both phases run in this ONE SQL statement/transaction. A late resolution
  -- failure rolls back all base prices/forecasts/cancellations/new booking too.
  PERFORM customer_combined_trial.apply_plan(b);
  INSERT INTO customer_combined_trial.resolution_receipts VALUES(p->>'sourceSha256',p);
  FOR row_data IN SELECT value FROM jsonb_array_elements(p->'rows') ORDER BY (value->>'sourceRow')::integer LOOP
    IF row_data->>'disposition'<>'resolved_history_candidate' THEN CONTINUE; END IF;
    IF NOT EXISTS(SELECT 1 FROM customer_combined_trial.roles WHERE id=(row_data->>'ownerUserId')::uuid AND role='sales' AND active)
      THEN RAISE EXCEPTION 'RESOLVED OWNER ROLE CHANGED'; END IF;
    cid:=(row_data->>'customerId')::uuid;
    iid:=(row_data->>'interestId')::uuid;
    IF row_data->>'customerCandidateKey' IS NOT NULL THEN
      -- PRIVATE fixture UUID; never treated as an approved production UUID.
      cid:=substr(row_data->>'customerCandidateKey',1,32)::uuid;
      INSERT INTO customer_combined_trial.customers VALUES(cid,row_data->>'customerNameHash',(row_data->>'ownerUserId')::uuid);
      iid:=substr(row_data->>'interestCandidateKey',1,32)::uuid;
      INSERT INTO customer_combined_trial.interests VALUES(iid,cid,row_data->>'projectName',(row_data->>'ownerUserId')::uuid);
    END IF;
    IF iid IS NOT NULL AND NOT EXISTS(SELECT 1 FROM customer_combined_trial.interests WHERE id=iid AND customer_id=cid AND project_name=row_data->>'projectName')
      THEN RAISE EXCEPTION 'RESOLVED INTEREST CHANGED'; END IF;
    INSERT INTO customer_combined_trial.resolution_rows VALUES(p->>'sourceSha256',(row_data->>'sourceRow')::integer,cid,iid,row_data);
    event_sequence:=0;
    FOR event_data IN SELECT value FROM jsonb_array_elements(row_data->'sourceHistory') LOOP
      event_sequence:=event_sequence+1;
      INSERT INTO customer_combined_trial.customer_events VALUES(p->>'sourceSha256',(row_data->>'sourceRow')::integer,event_sequence,cid,iid,
        row_data->>'projectName',row_data->>'plotId',event_data->>'kind',(event_data->>'date')::date,event_data->>'precision');
    END LOOP;
  END LOOP;
  RETURN 'applied_private_resolved_bundle';
END $body$;
REVOKE ALL ON FUNCTION customer_combined_trial.apply_resolved_bundle(jsonb,jsonb) FROM PUBLIC,anon,authenticated;
COMMIT;
