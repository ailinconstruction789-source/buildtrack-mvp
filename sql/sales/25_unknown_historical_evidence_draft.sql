-- DESIGN ONLY. Separate archive for reviewed historical gaps; never a business importer.
-- Depends on canonical Customers/Interests +04 staff roles. Does not alter the 24 ledger.
-- Unknown project visits and cancelled history without a known Sale stay evidence only.
BEGIN;
DO $draft_only$
BEGIN
  RAISE EXCEPTION 'DESIGN ONLY: unknown historical evidence requires isolated verification and separate deployment review';
END;
$draft_only$;

CREATE SCHEMA sales_unknown_history_private;
REVOKE ALL ON SCHEMA sales_unknown_history_private FROM PUBLIC,anon,authenticated;
CREATE TABLE sales_unknown_history_private.batches (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_system text NOT NULL, dataset_key text NOT NULL,
 snapshot_sha256 text NOT NULL CHECK(snapshot_sha256 ~ '^[a-f0-9]{64}$'), mapping_review_ref text NOT NULL,
 payload jsonb NOT NULL, reviewer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(source_system,dataset_key)
);
CREATE TABLE sales_unknown_history_private.records (
 batch_id uuid NOT NULL REFERENCES sales_unknown_history_private.batches(id) ON DELETE RESTRICT,
 source_system text NOT NULL, source_key text NOT NULL CHECK(source_key ~ '^[a-f0-9]{64}$'),
 row_number integer NOT NULL CHECK(row_number BETWEEN 2 AND 50000), row_sha256 text NOT NULL CHECK(row_sha256 ~ '^[a-f0-9]{64}$'),
 customer_key text NOT NULL, customer_id uuid NOT NULL REFERENCES public.sales_customers(id) ON DELETE RESTRICT,
 interest_id uuid, sale_id uuid CHECK(sale_id IS NULL), reason text NOT NULL, source_stage text NOT NULL, payload jsonb NOT NULL,
 PRIMARY KEY(batch_id,source_key), UNIQUE(source_system,source_key), UNIQUE(batch_id,row_number),
 FOREIGN KEY(interest_id,customer_id) REFERENCES public.lead_project_interests(id,customer_id) ON DELETE RESTRICT,
 CHECK((reason='unknown_project' AND source_stage='visited' AND interest_id IS NULL)
   OR (reason='unknown_booking' AND source_stage='cancelled'))
);
CREATE INDEX unknown_history_customer_idx ON sales_unknown_history_private.records(customer_id,batch_id,source_key);
CREATE INDEX unknown_history_source_customer_idx ON sales_unknown_history_private.records(source_system,customer_key);
CREATE TABLE sales_unknown_history_private.events (
 batch_id uuid NOT NULL, source_key text NOT NULL, event_key text NOT NULL, sequence integer NOT NULL CHECK(sequence BETWEEN 1 AND 1000),
 kind text NOT NULL CHECK(kind IN ('visited','booked','cancelled')), occurred_date date,
 precision text NOT NULL CHECK(precision IN ('day','unknown')), evidence_ref text NOT NULL,
 PRIMARY KEY(batch_id,source_key,event_key), UNIQUE(batch_id,source_key,sequence),
 FOREIGN KEY(batch_id,source_key) REFERENCES sales_unknown_history_private.records(batch_id,source_key) ON DELETE RESTRICT,
 CHECK((precision='unknown' AND occurred_date IS NULL) OR (precision='day' AND occurred_date IS NOT NULL)),
 CHECK(occurred_date IS NULL OR (isfinite(occurred_date) AND occurred_date>=DATE '0001-01-01' AND occurred_date<DATE '10000-01-01'))
);
ALTER TABLE sales_unknown_history_private.batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_unknown_history_private.records ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_unknown_history_private.events ENABLE ROW LEVEL SECURITY;
CREATE TABLE sales_unknown_history_private.insert_permits (
 transaction_id bigint NOT NULL, backend_pid integer NOT NULL, actor_id uuid NOT NULL,
 relation_name text NOT NULL, expected_row jsonb NOT NULL, PRIMARY KEY(transaction_id,backend_pid)
);
ALTER TABLE sales_unknown_history_private.insert_permits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA sales_unknown_history_private FROM PUBLIC,anon,authenticated;

-- Broad grants must not turn this private archive into an unguarded insertion path.
CREATE FUNCTION sales_unknown_history_private.guard_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF current_user IS DISTINCT FROM (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid=TG_RELID)
  OR auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM sales_unknown_history_private.insert_permits
   WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid() AND actor_id=auth.uid()
    AND relation_name=TG_TABLE_NAME AND expected_row=to_jsonb(NEW))
 THEN RAISE EXCEPTION 'UNKNOWN_HISTORY_INSERT_FORBIDDEN'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER unknown_history_batch_insert BEFORE INSERT ON sales_unknown_history_private.batches
 FOR EACH ROW EXECUTE FUNCTION sales_unknown_history_private.guard_insert();
CREATE TRIGGER unknown_history_record_insert BEFORE INSERT ON sales_unknown_history_private.records
 FOR EACH ROW EXECUTE FUNCTION sales_unknown_history_private.guard_insert();
CREATE TRIGGER unknown_history_event_insert BEFORE INSERT ON sales_unknown_history_private.events
 FOR EACH ROW EXECUTE FUNCTION sales_unknown_history_private.guard_insert();
CREATE FUNCTION sales_unknown_history_private.guard_permit()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF current_user IS DISTINCT FROM (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid=TG_RELID)
  OR TG_OP NOT IN ('INSERT','DELETE') THEN RAISE EXCEPTION 'UNKNOWN_HISTORY_INSERT_FORBIDDEN'; END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END; $$;
CREATE TRIGGER unknown_history_permit_guard BEFORE INSERT OR UPDATE OR DELETE ON sales_unknown_history_private.insert_permits
 FOR EACH ROW EXECUTE FUNCTION sales_unknown_history_private.guard_permit();
CREATE FUNCTION sales_unknown_history_private.insert_exact(p_relation text,p_row jsonb)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF p_relation NOT IN ('batches','records','events') OR auth.uid() IS NULL
  OR current_user IS DISTINCT FROM (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid='sales_unknown_history_private.insert_permits'::regclass)
 THEN RAISE EXCEPTION 'UNKNOWN_HISTORY_INSERT_FORBIDDEN'; END IF;
 PERFORM 1 FROM sales_private.crm_user_roles WHERE user_id=auth.uid() AND role='admin' AND is_active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'UNKNOWN_HISTORY_FORBIDDEN'; END IF;
 INSERT INTO sales_unknown_history_private.insert_permits VALUES(txid_current(),pg_backend_pid(),auth.uid(),p_relation,p_row);
 EXECUTE format('INSERT INTO sales_unknown_history_private.%I SELECT (jsonb_populate_record(NULL::sales_unknown_history_private.%I,$1)).*',p_relation,p_relation) USING p_row;
 DELETE FROM sales_unknown_history_private.insert_permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid();
END; $$;

CREATE FUNCTION sales_unknown_history_private.reject_change()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'UNKNOWN_HISTORY_APPEND_ONLY'; END; $$;
CREATE TRIGGER unknown_history_batch_sealed BEFORE UPDATE OR DELETE OR TRUNCATE ON sales_unknown_history_private.batches
 FOR EACH STATEMENT EXECUTE FUNCTION sales_unknown_history_private.reject_change();
CREATE TRIGGER unknown_history_record_sealed BEFORE UPDATE OR DELETE OR TRUNCATE ON sales_unknown_history_private.records
 FOR EACH STATEMENT EXECUTE FUNCTION sales_unknown_history_private.reject_change();
CREATE TRIGGER unknown_history_event_sealed BEFORE UPDATE OR DELETE OR TRUNCATE ON sales_unknown_history_private.events
 FOR EACH STATEMENT EXECUTE FUNCTION sales_unknown_history_private.reject_change();
CREATE TRIGGER unknown_history_permit_no_truncate BEFORE TRUNCATE ON sales_unknown_history_private.insert_permits
 FOR EACH STATEMENT EXECUTE FUNCTION sales_unknown_history_private.reject_change();

CREATE FUNCTION sales_unknown_history_private.require_object(p_value jsonb,p_keys text[])
RETURNS void LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF jsonb_typeof(p_value) IS DISTINCT FROM 'object' OR
  (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_value) k)
   IS DISTINCT FROM (SELECT array_agg(k ORDER BY k) FROM unnest(p_keys) k)
 THEN RAISE EXCEPTION 'UNKNOWN_HISTORY_INVALID'; END IF;
END; $$;
CREATE FUNCTION sales_unknown_history_private.require_text(p_value jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE v text:=p_value#>>'{}';
BEGIN
 IF jsonb_typeof(p_value) IS DISTINCT FROM 'string' OR length(v) NOT BETWEEN 1 AND 200
  OR btrim(v,U&' \00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')<>v
  OR v ~ U&'[\0001-\001F\007F-\009F]' THEN RAISE EXCEPTION 'UNKNOWN_HISTORY_INVALID'; END IF;
 RETURN v;
END; $$;
CREATE FUNCTION sales_unknown_history_private.require_uuid(p_value jsonb)
RETURNS uuid LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF jsonb_typeof(p_value) IS DISTINCT FROM 'string' OR (p_value#>>'{}' ~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$') IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'UNKNOWN_HISTORY_INVALID'; END IF;
 RETURN (p_value#>>'{}')::uuid;
END; $$;

-- Private INVOKER only. A future operator grant needs separate review; no browser RPC.
CREATE FUNCTION sales_unknown_history_private.persist_evidence(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $persist$
DECLARE actor uuid:=auth.uid(); batch sales_unknown_history_private.batches%ROWTYPE;
 src_system text; dataset text; review_ref text; row_value jsonb; ev jsonb; customer_value uuid; interest_value uuid;
 key_value text; customer_key_value text; reason_value text; stage_value text; date_value date; last_date date;
 seq_value integer; rank_value integer; last_rank integer; booked_count integer; cancelled_count integer; events_count integer:=0;
BEGIN
 IF actor IS NULL OR current_user IS DISTINCT FROM (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid='sales_unknown_history_private.batches'::regclass)
 THEN RAISE EXCEPTION 'UNKNOWN_HISTORY_FORBIDDEN'; END IF;
 PERFORM 1 FROM sales_private.crm_user_roles WHERE user_id=actor AND role='admin' AND is_active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'UNKNOWN_HISTORY_FORBIDDEN'; END IF;
 PERFORM sales_unknown_history_private.require_object(p_payload,ARRAY['version','sourceSystem','datasetKey','snapshotSha256','mappingReviewRef','records','businessWritesAllowed','leadRequired']);
 IF p_payload->>'version' IS DISTINCT FROM 'unknown-historical-evidence-v1'
  OR p_payload->'businessWritesAllowed' IS DISTINCT FROM 'false'::jsonb OR p_payload->'leadRequired' IS DISTINCT FROM 'false'::jsonb
  OR jsonb_typeof(p_payload->'snapshotSha256') IS DISTINCT FROM 'string' OR (p_payload->>'snapshotSha256' ~ '^[a-f0-9]{64}$') IS DISTINCT FROM true
  OR jsonb_typeof(p_payload->'records') IS DISTINCT FROM 'array' OR octet_length(p_payload::text)>8388608
 THEN RAISE EXCEPTION 'UNKNOWN_HISTORY_INVALID'; END IF;
 IF jsonb_array_length(p_payload->'records') NOT BETWEEN 1 AND 5000 THEN RAISE EXCEPTION 'UNKNOWN_HISTORY_INVALID'; END IF;
 src_system:=sales_unknown_history_private.require_text(p_payload->'sourceSystem');
 dataset:=sales_unknown_history_private.require_text(p_payload->'datasetKey'); review_ref:=sales_unknown_history_private.require_text(p_payload->'mappingReviewRef');
 -- Same lock family as the 24 archive; this function only writes its separate archive.
 PERFORM pg_advisory_xact_lock(hashtextextended('historical-evidence-source:'||src_system,0));
 SELECT * INTO batch FROM sales_unknown_history_private.batches WHERE source_system=src_system AND dataset_key=dataset FOR UPDATE;
 IF FOUND THEN
  IF batch.payload IS DISTINCT FROM p_payload THEN RAISE EXCEPTION 'UNKNOWN_HISTORY_RECONCILIATION_REQUIRED'; END IF;
  RETURN jsonb_build_object('batchId',batch.id,'replayed',true,'records',jsonb_array_length(p_payload->'records'),
   'events',(SELECT count(*) FROM sales_unknown_history_private.events WHERE batch_id=batch.id),'businessChanged',false);
 END IF;
 batch.id:=gen_random_uuid(); batch.source_system:=src_system; batch.dataset_key:=dataset; batch.snapshot_sha256:=p_payload->>'snapshotSha256';
 batch.mapping_review_ref:=review_ref; batch.payload:=p_payload; batch.reviewer_id:=actor; batch.recorded_at:=clock_timestamp();
 PERFORM sales_unknown_history_private.insert_exact('batches',to_jsonb(batch));
 PERFORM 1 FROM public.sales_customers WHERE id IN(SELECT sales_unknown_history_private.require_uuid(r->'customerId') FROM jsonb_array_elements(p_payload->'records') r) ORDER BY id FOR SHARE;
 PERFORM 1 FROM public.lead_project_interests WHERE id IN(SELECT sales_unknown_history_private.require_uuid(r->'interestId') FROM jsonb_array_elements(p_payload->'records') r WHERE r->'interestId'<>'null'::jsonb) ORDER BY id FOR SHARE;
 FOR row_value IN SELECT value FROM jsonb_array_elements(p_payload->'records') LOOP
  PERFORM sales_unknown_history_private.require_object(row_value,ARRAY['sourceKey','rowNumber','rowSha256','customerKey','customerId','interestId','saleId','reason','sourceStage','events']);
  IF jsonb_typeof(row_value->'sourceKey') IS DISTINCT FROM 'string' OR (row_value->>'sourceKey' ~ '^[a-f0-9]{64}$') IS DISTINCT FROM true
   OR jsonb_typeof(row_value->'rowSha256') IS DISTINCT FROM 'string' OR (row_value->>'rowSha256' ~ '^[a-f0-9]{64}$') IS DISTINCT FROM true
   OR jsonb_typeof(row_value->'rowNumber') IS DISTINCT FROM 'number' OR (row_value->>'rowNumber' ~ '^[0-9]+$') IS DISTINCT FROM true
   OR row_value->'saleId' IS DISTINCT FROM 'null'::jsonb OR jsonb_typeof(row_value->'events') IS DISTINCT FROM 'array'
  THEN RAISE EXCEPTION 'UNKNOWN_HISTORY_INVALID'; END IF;
  key_value:=row_value->>'sourceKey'; customer_key_value:=sales_unknown_history_private.require_text(row_value->'customerKey');
  customer_value:=sales_unknown_history_private.require_uuid(row_value->'customerId');
  interest_value:=CASE WHEN row_value->'interestId'='null'::jsonb THEN NULL ELSE sales_unknown_history_private.require_uuid(row_value->'interestId') END;
  reason_value:=sales_unknown_history_private.require_text(row_value->'reason'); stage_value:=sales_unknown_history_private.require_text(row_value->'sourceStage');
  IF NOT ((reason_value='unknown_project' AND stage_value='visited' AND interest_value IS NULL)
   OR (reason_value='unknown_booking' AND stage_value='cancelled')) THEN RAISE EXCEPTION 'UNKNOWN_HISTORY_INVALID'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.sales_customers WHERE id=customer_value AND merged_into_customer_id IS NULL)
   OR (interest_value IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.lead_project_interests WHERE id=interest_value AND customer_id=customer_value))
   OR EXISTS(SELECT 1 FROM sales_unknown_history_private.records WHERE source_system=src_system AND
    ((customer_key=customer_key_value AND customer_id<>customer_value) OR (customer_id=customer_value AND customer_key<>customer_key_value)))
  THEN RAISE EXCEPTION 'UNKNOWN_HISTORY_MAPPING_CONFLICT'; END IF;
  IF jsonb_array_length(row_value->'events') NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'UNKNOWN_HISTORY_INVALID'; END IF;
  PERFORM sales_unknown_history_private.insert_exact('records',jsonb_build_object('batch_id',batch.id,'source_system',src_system,'source_key',key_value,
   'row_number',(row_value->>'rowNumber')::integer,'row_sha256',row_value->>'rowSha256','customer_key',customer_key_value,'customer_id',customer_value,
   'interest_id',interest_value,'sale_id',NULL,'reason',reason_value,'source_stage',stage_value,'payload',row_value));
  seq_value:=0; last_rank:=-1; last_date:=NULL; booked_count:=0; cancelled_count:=0;
  FOR ev IN SELECT value FROM jsonb_array_elements(row_value->'events') LOOP
   events_count:=events_count+1; IF events_count>20000 THEN RAISE EXCEPTION 'UNKNOWN_HISTORY_INVALID'; END IF;
   PERFORM sales_unknown_history_private.require_object(ev,ARRAY['eventKey','kind','sequence','date','precision','evidenceRef']);
   PERFORM sales_unknown_history_private.require_text(ev->'eventKey'); PERFORM sales_unknown_history_private.require_text(ev->'evidenceRef');
   PERFORM sales_unknown_history_private.require_text(ev->'kind');
   IF jsonb_typeof(ev->'sequence') IS DISTINCT FROM 'number' OR (ev->>'sequence' ~ '^[0-9]+$') IS DISTINCT FROM true
    OR (ev->>'sequence')::integer<>seq_value+1 THEN RAISE EXCEPTION 'UNKNOWN_HISTORY_INVALID'; END IF;
   seq_value:=seq_value+1; date_value:=NULL;
   IF ev->'date'<>'null'::jsonb THEN
    IF jsonb_typeof(ev->'date') IS DISTINCT FROM 'string' OR (ev->>'date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') IS DISTINCT FROM true
     OR NOT pg_input_is_valid(ev->>'date','date') THEN RAISE EXCEPTION 'UNKNOWN_HISTORY_INVALID'; END IF;
    date_value:=(ev->>'date')::date;
    IF to_char(date_value,'YYYY-MM-DD')<>ev->>'date' THEN RAISE EXCEPTION 'UNKNOWN_HISTORY_INVALID'; END IF;
   END IF;
   IF ev->>'precision' IS DISTINCT FROM (CASE WHEN date_value IS NULL THEN 'unknown' ELSE 'day' END)
    OR ev->>'kind' NOT IN ('visited','booked','cancelled') THEN RAISE EXCEPTION 'UNKNOWN_HISTORY_INVALID'; END IF;
   rank_value:=CASE ev->>'kind' WHEN 'visited' THEN 0 WHEN 'booked' THEN 1 ELSE 2 END;
   IF rank_value<last_rank OR date_value<last_date OR (reason_value='unknown_project' AND rank_value<>0)
   THEN RAISE EXCEPTION 'UNKNOWN_HISTORY_ORDER_CONFLICT'; END IF;
   IF ev->>'kind'='booked' THEN booked_count:=booked_count+1; END IF;
   IF ev->>'kind'='cancelled' THEN cancelled_count:=cancelled_count+1; END IF;
   IF booked_count>1 OR cancelled_count>1 OR (ev->>'kind'='cancelled' AND booked_count<>1)
   THEN RAISE EXCEPTION 'UNKNOWN_HISTORY_ORDER_CONFLICT'; END IF;
   last_rank:=rank_value; IF date_value IS NOT NULL THEN last_date:=date_value; END IF;
   PERFORM sales_unknown_history_private.insert_exact('events',jsonb_build_object('batch_id',batch.id,'source_key',key_value,'event_key',ev->>'eventKey',
    'sequence',seq_value,'kind',ev->>'kind','occurred_date',date_value,'precision',ev->>'precision','evidence_ref',ev->>'evidenceRef'));
  END LOOP;
  IF reason_value='unknown_booking' AND (booked_count<>1 OR cancelled_count<>1 OR last_rank<>2)
  THEN RAISE EXCEPTION 'UNKNOWN_HISTORY_ORDER_CONFLICT'; END IF;
 END LOOP;
 RETURN jsonb_build_object('batchId',batch.id,'replayed',false,'records',jsonb_array_length(p_payload->'records'),'events',events_count,'businessChanged',false);
END;
$persist$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA sales_unknown_history_private FROM PUBLIC,anon,authenticated;
ROLLBACK;
