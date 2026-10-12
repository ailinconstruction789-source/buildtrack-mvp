-- DESIGN ONLY. Private durable evidence, not a customer/deal importer or live migration.
-- Requires independently reviewed existing UUIDs. No Lead, appointment, status,
-- occupancy, payment or SLA is generated. Source evidence remains a declaration.
BEGIN;
DO $draft_only$
BEGIN
  RAISE EXCEPTION 'DESIGN ONLY: historical evidence ledger requires isolated tests and separate deployment review';
END;
$draft_only$;

CREATE SCHEMA sales_history_private;
REVOKE ALL ON SCHEMA sales_history_private FROM PUBLIC,anon,authenticated;
CREATE TABLE sales_history_private.batches (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_system text NOT NULL, dataset_key text NOT NULL,
 snapshot_sha256 text NOT NULL CHECK(snapshot_sha256 ~ '^[a-f0-9]{64}$'), mapping_review_ref text NOT NULL,
 payload jsonb NOT NULL, recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 reviewer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 UNIQUE(source_system,dataset_key)
);
CREATE TABLE sales_history_private.records (
 batch_id uuid NOT NULL REFERENCES sales_history_private.batches(id) ON DELETE RESTRICT,
 source_system text NOT NULL, record_key text NOT NULL, customer_key text NOT NULL,
 row_number integer NOT NULL CHECK(row_number BETWEEN 2 AND 50000),
 row_sha256 text NOT NULL CHECK(row_sha256 ~ '^[a-f0-9]{64}$'),
 customer_id uuid NOT NULL REFERENCES public.sales_customers(id) ON DELETE RESTRICT,
 interest_id uuid NOT NULL, sale_id uuid REFERENCES public.sales(id) ON DELETE RESTRICT,
 rental_id uuid REFERENCES sales_private.rental_contracts(id) ON DELETE RESTRICT,
 payload jsonb NOT NULL,
 PRIMARY KEY(batch_id,record_key), UNIQUE(source_system,record_key), UNIQUE(batch_id,row_number),
 FOREIGN KEY(interest_id,customer_id) REFERENCES public.lead_project_interests(id,customer_id) ON DELETE RESTRICT
);
CREATE INDEX historical_customer_idx ON sales_history_private.records(customer_id,batch_id,record_key);
CREATE INDEX historical_source_customer_idx ON sales_history_private.records(source_system,customer_key);
CREATE UNIQUE INDEX historical_sale_idx ON sales_history_private.records(sale_id) WHERE sale_id IS NOT NULL;
CREATE UNIQUE INDEX historical_rental_idx ON sales_history_private.records(rental_id) WHERE rental_id IS NOT NULL;
CREATE TABLE sales_history_private.events (
 batch_id uuid NOT NULL, record_key text NOT NULL, event_key text NOT NULL,
 sequence integer NOT NULL CHECK(sequence BETWEEN 1 AND 10000), kind text NOT NULL,
 occurred_date date, precision text NOT NULL CHECK(precision IN ('day','unknown')),
 evidence_ref text NOT NULL,
 PRIMARY KEY(batch_id,record_key,event_key), UNIQUE(batch_id,record_key,sequence),
 FOREIGN KEY(batch_id,record_key) REFERENCES sales_history_private.records(batch_id,record_key) ON DELETE RESTRICT,
 CHECK((precision='unknown' AND occurred_date IS NULL) OR (precision='day' AND occurred_date IS NOT NULL))
);
ALTER TABLE sales_history_private.batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_history_private.records ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_history_private.events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA sales_history_private FROM PUBLIC,anon,authenticated;

CREATE FUNCTION sales_history_private.reject_change()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'HISTORICAL_LEDGER_APPEND_ONLY'; END; $$;
REVOKE ALL ON FUNCTION sales_history_private.reject_change() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER historical_batch_sealed BEFORE UPDATE OR DELETE OR TRUNCATE ON sales_history_private.batches
 FOR EACH STATEMENT EXECUTE FUNCTION sales_history_private.reject_change();
CREATE TRIGGER historical_record_sealed BEFORE UPDATE OR DELETE OR TRUNCATE ON sales_history_private.records
 FOR EACH STATEMENT EXECUTE FUNCTION sales_history_private.reject_change();
CREATE TRIGGER historical_event_sealed BEFORE UPDATE OR DELETE OR TRUNCATE ON sales_history_private.events
 FOR EACH STATEMENT EXECUTE FUNCTION sales_history_private.reject_change();

CREATE FUNCTION sales_history_private.require_object(p_value jsonb,p_keys text[])
RETURNS void LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF jsonb_typeof(p_value) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'HISTORICAL_LEDGER_INVALID'; END IF;
 IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_value) k)
  IS DISTINCT FROM (SELECT array_agg(k ORDER BY k) FROM unnest(p_keys) k)
 THEN RAISE EXCEPTION 'HISTORICAL_LEDGER_INVALID'; END IF;
END; $$;
CREATE FUNCTION sales_history_private.require_text(p_value jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE v text:=p_value#>>'{}';
BEGIN
 IF jsonb_typeof(p_value) IS DISTINCT FROM 'string' OR length(v) NOT BETWEEN 1 AND 200
  OR btrim(v)<>v OR v ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'HISTORICAL_LEDGER_INVALID'; END IF;
 RETURN v;
END; $$;
REVOKE ALL ON FUNCTION sales_history_private.require_object(jsonb,text[]),sales_history_private.require_text(jsonb) FROM PUBLIC,anon,authenticated;

-- SECURITY INVOKER and private EXECUTE only: no browser write path or privilege escalation.
-- Future installation must explicitly review/grant a restricted import operator.
CREATE FUNCTION sales_history_private.persist_evidence(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $persist$
DECLARE actor uuid:=auth.uid(); batch sales_history_private.batches%ROWTYPE; inserted_id uuid;
 src_system text; dataset text; review_ref text; row_value jsonb; src jsonb; link jsonb; ev jsonb;
 customer_value uuid; interest_value uuid; sale_value uuid; rental_value uuid; record_value text; kind_value text;
 date_value date; events_count integer:=0; old_date date; rank_value integer; old_rank integer; seq_value integer;
 terminal boolean; stage_value text; stage_rank integer; record_kind text;
BEGIN
 -- Lock the trusted staff row, so removal of Admin rights cannot race a commit.
 IF actor IS NULL THEN RAISE EXCEPTION 'HISTORICAL_LEDGER_FORBIDDEN'; END IF;
 PERFORM 1 FROM sales_private.crm_user_roles WHERE user_id=actor AND role='admin' AND is_active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'HISTORICAL_LEDGER_FORBIDDEN'; END IF;
 PERFORM sales_history_private.require_object(p_payload,ARRAY['version','sourceSystem','datasetKey','snapshotSha256','mappingReviewRef','records','businessWritesAllowed','leadRequired']);
 IF p_payload->>'version' IS DISTINCT FROM 'historical-evidence-ledger-v1'
  OR p_payload->'businessWritesAllowed' IS DISTINCT FROM 'false'::jsonb OR p_payload->'leadRequired' IS DISTINCT FROM 'false'::jsonb
  OR jsonb_typeof(p_payload->'snapshotSha256') IS DISTINCT FROM 'string' OR (p_payload->>'snapshotSha256' ~ '^[a-f0-9]{64}$') IS DISTINCT FROM true
  OR jsonb_typeof(p_payload->'records') IS DISTINCT FROM 'array' OR octet_length(p_payload::text)>8388608
 THEN RAISE EXCEPTION 'HISTORICAL_LEDGER_INVALID'; END IF;
 IF jsonb_array_length(p_payload->'records') NOT BETWEEN 1 AND 5000 THEN RAISE EXCEPTION 'HISTORICAL_LEDGER_INVALID'; END IF;
 src_system:=sales_history_private.require_text(p_payload->'sourceSystem');
 dataset:=sales_history_private.require_text(p_payload->'datasetKey'); review_ref:=sales_history_private.require_text(p_payload->'mappingReviewRef');
 -- Serialize mappings across datasets too; distinct batch keys cannot race one source identity.
 PERFORM pg_advisory_xact_lock(hashtextextended('historical-evidence-source:'||src_system,0));
 -- One pinned dataset per source key. JSONB comparison retains all evidence while ignoring object-key order.
 -- Insert/unique lock serializes exact retries and rejects changed input. No ON CONFLICT UPDATE.
 INSERT INTO sales_history_private.batches(source_system,dataset_key,snapshot_sha256,mapping_review_ref,payload,reviewer_id)
 VALUES(src_system,dataset,p_payload->>'snapshotSha256',review_ref,p_payload,actor)
 ON CONFLICT(source_system,dataset_key) DO NOTHING RETURNING id INTO inserted_id;
 SELECT * INTO STRICT batch FROM sales_history_private.batches WHERE source_system=src_system AND dataset_key=dataset FOR UPDATE;
 IF batch.payload IS DISTINCT FROM p_payload THEN RAISE EXCEPTION 'HISTORICAL_LEDGER_RECONCILIATION_REQUIRED'; END IF;
 IF inserted_id IS NULL THEN RETURN jsonb_build_object('batchId',batch.id,'replayed',true,'records',jsonb_array_length(p_payload->'records'),
  'events',(SELECT count(*) FROM sales_history_private.events WHERE batch_id=batch.id),'businessChanged',false); END IF;

 -- All target rows locked in deterministic order. Imported evidence never overwrites business entities.
 PERFORM 1 FROM public.sales_customers WHERE id IN(SELECT (r->'binding'->>'customerId')::uuid FROM jsonb_array_elements(p_payload->'records') r) ORDER BY id FOR SHARE;
 PERFORM 1 FROM public.lead_project_interests WHERE id IN(SELECT (r->'binding'->>'interestId')::uuid FROM jsonb_array_elements(p_payload->'records') r) ORDER BY id FOR SHARE;
 PERFORM 1 FROM public.sales WHERE id IN(SELECT (r->'binding'->>'saleId')::uuid FROM jsonb_array_elements(p_payload->'records') r) ORDER BY id FOR SHARE;
 PERFORM 1 FROM sales_private.rental_contracts WHERE id IN(SELECT (r->'binding'->>'rentalId')::uuid FROM jsonb_array_elements(p_payload->'records') r) ORDER BY id FOR SHARE;
 FOR row_value IN SELECT value FROM jsonb_array_elements(p_payload->'records') LOOP
  PERFORM sales_history_private.require_object(row_value,ARRAY['source','binding']); src:=row_value->'source'; link:=row_value->'binding';
  PERFORM sales_history_private.require_object(src,ARRAY['recordKey','rowNumber','rowSha256','customerKey','dealKey','kind','stage','rentalType','events']);
  PERFORM sales_history_private.require_object(link,ARRAY['recordKey','rowSha256','customerKey','dealKey','customerId','interestId','saleId','rentalId','evidenceRef']);
  record_value:=sales_history_private.require_text(src->'recordKey'); PERFORM sales_history_private.require_text(src->'customerKey');
  PERFORM sales_history_private.require_text(link->'evidenceRef');
  IF src->'dealKey'<>'null'::jsonb THEN PERFORM sales_history_private.require_text(src->'dealKey'); END IF;
  IF src->'recordKey' IS DISTINCT FROM link->'recordKey' OR src->'rowSha256' IS DISTINCT FROM link->'rowSha256'
   OR src->'customerKey' IS DISTINCT FROM link->'customerKey' OR src->'dealKey' IS DISTINCT FROM link->'dealKey'
   OR jsonb_typeof(src->'rowSha256') IS DISTINCT FROM 'string' OR (src->>'rowSha256' ~ '^[a-f0-9]{64}$') IS DISTINCT FROM true
   OR jsonb_typeof(src->'rowNumber') IS DISTINCT FROM 'number' OR (src->>'rowNumber' ~ '^[0-9]+$') IS DISTINCT FROM true
   OR jsonb_typeof(src->'events') IS DISTINCT FROM 'array'
  THEN RAISE EXCEPTION 'HISTORICAL_LEDGER_INVALID'; END IF;
  customer_value:=(sales_history_private.require_text(link->'customerId'))::uuid;
  interest_value:=(sales_history_private.require_text(link->'interestId'))::uuid;
  sale_value:=CASE WHEN link->'saleId'='null'::jsonb THEN NULL ELSE (sales_history_private.require_text(link->'saleId'))::uuid END;
  rental_value:=CASE WHEN link->'rentalId'='null'::jsonb THEN NULL ELSE (sales_history_private.require_text(link->'rentalId'))::uuid END;
  IF NOT EXISTS(SELECT 1 FROM public.sales_customers WHERE id=customer_value AND merged_into_customer_id IS NULL)
   OR NOT EXISTS(SELECT 1 FROM public.lead_project_interests WHERE id=interest_value AND customer_id=customer_value)
   OR (sale_value IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.sales WHERE id=sale_value AND project_interest_id=interest_value))
   OR (rental_value IS NOT NULL AND NOT EXISTS(SELECT 1 FROM sales_private.rental_contracts WHERE id=rental_value AND customer_id=customer_value AND interest_id=interest_value))
  THEN RAISE EXCEPTION 'HISTORICAL_LEDGER_MAPPING_CONFLICT'; END IF;
  record_kind:=sales_history_private.require_text(src->'kind'); stage_value:=sales_history_private.require_text(src->'stage');
  IF (record_kind='visit' AND (stage_value<>'visited' OR src->'dealKey'<>'null'::jsonb OR sale_value IS NOT NULL OR rental_value IS NOT NULL OR src->'rentalType'<>'null'::jsonb))
   OR (record_kind='purchase' AND (sale_value IS NULL OR rental_value IS NOT NULL OR src->'dealKey'='null'::jsonb OR src->'rentalType'<>'null'::jsonb
     OR stage_value NOT IN ('booked','contracted','downpayment','document_prep','loan_submitted','loan_rejected','loan_approved','transfer_pending','transferred','handover','cancelled')))
   OR (record_kind='rental' AND (rental_value IS NULL OR src->'dealKey'='null'::jsonb OR (src->>'rentalType' IN ('A','B','C')) IS DISTINCT FROM true
     OR stage_value NOT IN ('rental_active','rental_ended','rental_buyout','cancelled') OR (stage_value='rental_buyout')<>(sale_value IS NOT NULL)))
   OR record_kind NOT IN ('visit','purchase','rental')
  THEN RAISE EXCEPTION 'HISTORICAL_LEDGER_INVALID'; END IF;
  IF record_kind='rental' AND (SELECT program_type FROM sales_private.rental_contracts WHERE id=rental_value)
    IS DISTINCT FROM 'program_'||lower(src->>'rentalType') THEN RAISE EXCEPTION 'HISTORICAL_LEDGER_MAPPING_CONFLICT'; END IF;
  IF stage_value='rental_buyout' AND (SELECT converted_sale_id FROM sales_private.rental_contracts WHERE id=rental_value)
    IS DISTINCT FROM sale_value THEN RAISE EXCEPTION 'HISTORICAL_LEDGER_MAPPING_CONFLICT'; END IF;
  IF EXISTS(SELECT 1 FROM sales_history_private.records WHERE source_system=src_system AND
    ((customer_key=src->>'customerKey' AND customer_id<>customer_value) OR (customer_id=customer_value AND customer_key<>src->>'customerKey')))
  THEN RAISE EXCEPTION 'HISTORICAL_LEDGER_MAPPING_CONFLICT'; END IF;
  IF jsonb_array_length(src->'events')>1000 THEN RAISE EXCEPTION 'HISTORICAL_LEDGER_INVALID'; END IF;
  INSERT INTO sales_history_private.records VALUES(batch.id,src_system,record_value,src->>'customerKey',(src->>'rowNumber')::integer,
   src->>'rowSha256',customer_value,interest_value,sale_value,rental_value,row_value);
  old_date:=NULL; old_rank:=-1; seq_value:=0; terminal:=false;
  stage_rank:=CASE stage_value WHEN 'booked' THEN 0 WHEN 'contracted' THEN 1 WHEN 'downpayment' THEN 1 WHEN 'document_prep' THEN 2
   WHEN 'loan_submitted' THEN 2 WHEN 'loan_rejected' THEN 2 WHEN 'loan_approved' THEN 2 WHEN 'transfer_pending' THEN 3 WHEN 'transferred' THEN 4 WHEN 'handover' THEN 5 ELSE 6 END;
  FOR ev IN SELECT value FROM jsonb_array_elements(src->'events') LOOP
   events_count:=events_count+1; IF events_count>20000 THEN RAISE EXCEPTION 'HISTORICAL_LEDGER_INVALID'; END IF;
   PERFORM sales_history_private.require_object(ev,ARRAY['eventKey','kind','sequence','date','precision','evidenceRef']);
   kind_value:=sales_history_private.require_text(ev->'kind'); PERFORM sales_history_private.require_text(ev->'eventKey');
   PERFORM sales_history_private.require_text(ev->'evidenceRef');
   IF jsonb_typeof(ev->'sequence') IS DISTINCT FROM 'number' OR (ev->>'sequence' ~ '^[0-9]+$') IS DISTINCT FROM true
    OR (ev->>'sequence')::integer<=seq_value THEN RAISE EXCEPTION 'HISTORICAL_LEDGER_INVALID'; END IF;
   seq_value:=(ev->>'sequence')::integer;
   date_value:=NULL;
   IF ev->'date'<>'null'::jsonb THEN
    IF jsonb_typeof(ev->'date') IS DISTINCT FROM 'string' OR (ev->>'date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') IS DISTINCT FROM true
     THEN RAISE EXCEPTION 'HISTORICAL_LEDGER_INVALID'; END IF;
    date_value:=(ev->>'date')::date;
    IF to_char(date_value,'YYYY-MM-DD')<>ev->>'date' THEN RAISE EXCEPTION 'HISTORICAL_LEDGER_INVALID'; END IF;
   END IF;
   IF ev->>'precision' IS DISTINCT FROM (CASE WHEN date_value IS NULL THEN 'unknown' ELSE 'day' END)
    OR kind_value NOT IN ('visited','booked','contracted','document_requested','loan_submitted','loan_rejected','loan_approved','transfer_pending','transferred','handover','cancelled','rental_started','rental_renewed','rental_ended','rental_buyout')
    OR (record_kind='visit' AND kind_value<>'visited') OR (record_kind='purchase' AND kind_value LIKE 'rental_%')
    OR (record_kind='rental' AND kind_value NOT IN ('visited','cancelled','rental_started','rental_renewed','rental_ended','rental_buyout'))
   THEN RAISE EXCEPTION 'HISTORICAL_LEDGER_INVALID'; END IF;
   IF kind_value<>'visited' THEN
    IF terminal OR (date_value<old_date) THEN RAISE EXCEPTION 'HISTORICAL_LEDGER_ORDER_CONFLICT'; END IF;
    IF date_value IS NOT NULL THEN old_date:=date_value; END IF;
    rank_value:=CASE kind_value WHEN 'booked' THEN 0 WHEN 'contracted' THEN 1 WHEN 'document_requested' THEN 2 WHEN 'loan_submitted' THEN 2
      WHEN 'loan_rejected' THEN 2 WHEN 'loan_approved' THEN 2 WHEN 'transfer_pending' THEN 3 WHEN 'transferred' THEN 4 WHEN 'handover' THEN 5 ELSE NULL END;
    IF rank_value IS NOT NULL THEN
     IF rank_value<old_rank OR rank_value>stage_rank THEN RAISE EXCEPTION 'HISTORICAL_LEDGER_ORDER_CONFLICT'; END IF; old_rank:=rank_value;
    END IF;
    IF (kind_value='cancelled' AND stage_value<>'cancelled') OR (stage_value='cancelled' AND kind_value IN ('transferred','handover'))
     OR (kind_value='transferred' AND stage_value NOT IN ('transferred','handover')) OR (kind_value='handover' AND stage_value<>'handover')
     OR (kind_value='rental_ended' AND stage_value<>'rental_ended') OR (kind_value='rental_buyout' AND stage_value<>'rental_buyout')
    THEN RAISE EXCEPTION 'HISTORICAL_LEDGER_ORDER_CONFLICT'; END IF;
    IF kind_value='rental_started' AND EXISTS(SELECT 1 FROM sales_history_private.events WHERE batch_id=batch.id AND record_key=record_value AND kind LIKE 'rental_%')
    THEN RAISE EXCEPTION 'HISTORICAL_LEDGER_ORDER_CONFLICT'; END IF;
    terminal:=kind_value IN ('cancelled','handover','rental_ended','rental_buyout');
   END IF;
   INSERT INTO sales_history_private.events VALUES(batch.id,record_value,ev->>'eventKey',seq_value,kind_value,date_value,ev->>'precision',ev->>'evidenceRef');
  END LOOP;
 END LOOP;
 RETURN jsonb_build_object('batchId',batch.id,'replayed',false,'records',jsonb_array_length(p_payload->'records'),'events',events_count,'businessChanged',false);
END;
$persist$;
REVOKE ALL ON FUNCTION sales_history_private.persist_evidence(jsonb) FROM PUBLIC,anon,authenticated;
ROLLBACK;
