-- DESIGN ONLY: install only after the exact 25-32 composition is rehearsed.
-- Separate DB-owner operator authority; designated reviewer is audit provenance,
-- never a claim that this SQL owner authenticated as that human. No Auth writes,
-- fake sessions/JWTs, public role changes or application grants are permitted.
BEGIN;
DO $draft_only$ BEGIN RAISE EXCEPTION 'DESIGN ONLY: customer replacement operator requires exact whole rehearsal'; END; $draft_only$;
CREATE SCHEMA sales_operator_private;
REVOKE ALL ON SCHEMA sales_operator_private FROM PUBLIC,anon,authenticated,service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA sales_operator_private REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
CREATE TABLE sales_operator_private.jobs(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),manifest jsonb NOT NULL,payload_sha256 text NOT NULL UNIQUE,
 recorded_by_db_role name NOT NULL,authorization_reference text NOT NULL,designated_reviewer_id uuid NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sales_operator_private.contexts(
 transaction_id bigint NOT NULL,backend_pid integer NOT NULL,db_role name NOT NULL,
 job_id uuid REFERENCES sales_operator_private.jobs,reviewer_id uuid NOT NULL,
 purpose text NOT NULL CHECK(purpose IN('metadata','preview','apply','restore')),before_run_ids jsonb NOT NULL DEFAULT '[]',
 PRIMARY KEY(transaction_id,backend_pid)
);
CREATE TABLE sales_operator_private.receipts(
 job_id uuid PRIMARY KEY REFERENCES sales_operator_private.jobs,recovery_run_id uuid NOT NULL,
 source_rows integer NOT NULL CHECK(source_rows=958),before_sha256 text NOT NULL,after_sha256 text NOT NULL,
 executed_by_db_role name NOT NULL,session_db_role name NOT NULL,designated_reviewer_id uuid NOT NULL,
 authorization_reference text NOT NULL,reviewer_is_authenticated_actor boolean NOT NULL CHECK(NOT reviewer_is_authenticated_actor),
 recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sales_operator_private.adapters(
 signature text PRIMARY KEY,before_md5 text NOT NULL,after_md5 text NOT NULL,settings text[],security_definer boolean NOT NULL
);
CREATE FUNCTION sales_operator_private.require_owner() RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF current_user IS DISTINCT FROM session_user OR current_user IS DISTINCT FROM
  (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid='sales_operator_private.jobs'::regclass)
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CUSTOMER_OPERATOR_DB_OWNER_REQUIRED'; END IF;
END; $$;
CREATE FUNCTION sales_operator_private.check_reviewer(p_reviewer uuid) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM sales_operator_private.require_owner();
 PERFORM 1 FROM account_security_private.reviewed_roles r
 JOIN account_security_private.reviewed_admins a ON a.auth_user_id=r.auth_user_id AND a.legacy_user_id=r.legacy_user_id
 JOIN sales_private.crm_user_roles c ON c.user_id=r.auth_user_id
 JOIN auth.users u ON u.id=r.auth_user_id JOIN public.users p ON p.id=r.legacy_user_id
 WHERE r.auth_user_id=p_reviewer AND r.role='Admin' AND r.enabled AND r.review_revision>0 AND a.enabled
  AND c.role='admin' AND c.is_active AND c.trusted_review_revision=r.review_revision
  AND u.deleted_at IS NULL AND NOT COALESCE(u.is_anonymous,false)
  AND (u.banned_until IS NULL OR u.banned_until<=statement_timestamp())
  AND NOT EXISTS(SELECT 1 FROM account_security_private.crm_auth_suspensions s WHERE s.auth_user_id=r.auth_user_id AND s.review_revision>=r.review_revision)
 FOR SHARE OF r,a,c,u;
 IF NOT FOUND THEN RAISE EXCEPTION 'CUSTOMER_OPERATOR_DESIGNATED_REVIEWER_UNAVAILABLE'; END IF;
END; $$;
CREATE FUNCTION sales_operator_private.actor() RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE result uuid;
BEGIN
 IF current_user=session_user AND current_user=(SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid='sales_operator_private.jobs'::regclass) THEN
  SELECT reviewer_id INTO result FROM sales_operator_private.contexts
   WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid() AND db_role=current_user;
  IF FOUND THEN RETURN result; END IF;
 END IF;
 RETURN auth.uid();
END; $$;
CREATE FUNCTION sales_operator_private.operator_role() RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF current_user=session_user AND current_user=(SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid='sales_operator_private.jobs'::regclass)
  AND EXISTS(SELECT 1 FROM sales_operator_private.contexts WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid() AND db_role=current_user)
 THEN RETURN 'admin'; END IF;
 RETURN public.crm_v2_role();
END; $$;
CREATE FUNCTION sales_operator_private.digest(v jsonb) RETURNS text LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT encode(sha256(convert_to(v::text,'UTF8')),'hex');
$$;
CREATE FUNCTION sales_operator_private.sealed() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'CUSTOMER_OPERATOR_IMMUTABLE'; END; $$;
CREATE FUNCTION sales_operator_private.insert_owner() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN PERFORM sales_operator_private.require_owner(); RETURN NEW; END; $$;
CREATE FUNCTION sales_operator_private.no_open_context() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM sales_operator_private.contexts WHERE transaction_id=NEW.transaction_id AND backend_pid=NEW.backend_pid)
 THEN RAISE EXCEPTION 'CUSTOMER_OPERATOR_WHOLE_TRANSACTION_NOT_FINISHED'; END IF;
 RETURN NULL;
END; $$;
-- Only exact reviewed DDL/adapter/identity-anchor preparation uses this context.
-- The full private import entrypoints reject metadata purpose. No Auth identity
-- or human-session impersonation is installed by this owner-only preparation.
CREATE FUNCTION sales_operator_private.begin_metadata(p_reviewer uuid) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM sales_operator_private.check_reviewer(p_reviewer);
 INSERT INTO sales_operator_private.contexts(transaction_id,backend_pid,db_role,reviewer_id,purpose)
 VALUES(txid_current(),pg_backend_pid(),current_user,p_reviewer,'metadata');
END; $$;
CREATE FUNCTION sales_operator_private.finish_metadata() RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM sales_operator_private.require_owner();
 DELETE FROM sales_operator_private.contexts WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid() AND db_role=current_user AND purpose='metadata';
 IF NOT FOUND THEN RAISE EXCEPTION 'CUSTOMER_OPERATOR_METADATA_CONTEXT_REQUIRED'; END IF;
END; $$;
CREATE CONSTRAINT TRIGGER operator_context_must_finish AFTER INSERT ON sales_operator_private.contexts DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION sales_operator_private.no_open_context();
DO $guards$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['jobs','contexts','receipts','adapters'] LOOP
  EXECUTE format('ALTER TABLE sales_operator_private.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON TABLE sales_operator_private.%I FROM PUBLIC,anon,authenticated,service_role',t);
  EXECUTE format('CREATE TRIGGER operator_insert_owner BEFORE INSERT ON sales_operator_private.%I FOR EACH ROW EXECUTE FUNCTION sales_operator_private.insert_owner()',t);
  EXECUTE format('CREATE TRIGGER operator_no_truncate BEFORE TRUNCATE ON sales_operator_private.%I FOR EACH STATEMENT EXECUTE FUNCTION sales_operator_private.sealed()',t);
  IF t<>'contexts' THEN EXECUTE format('CREATE TRIGGER operator_immutable BEFORE UPDATE OR DELETE ON sales_operator_private.%I FOR EACH STATEMENT EXECUTE FUNCTION sales_operator_private.sealed()',t); END IF;
 END LOOP;
END; $guards$;
CREATE FUNCTION sales_operator_private.assert_catalog() RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM sales_operator_private.require_owner();
 IF NOT EXISTS(SELECT 1 FROM sales_operator_private.adapters) OR EXISTS(
  SELECT 1 FROM sales_operator_private.adapters a LEFT JOIN pg_proc p ON p.oid=to_regprocedure(a.signature)
  WHERE p.oid IS NULL OR md5(replace(p.prosrc,E'\r\n',E'\n')) IS DISTINCT FROM a.after_md5
   OR pg_get_userbyid(p.proowner)<>current_user OR p.prosecdef IS DISTINCT FROM a.security_definer OR p.proconfig IS DISTINCT FROM a.settings)
 THEN RAISE EXCEPTION 'CUSTOMER_OPERATOR_EXACT_ADAPTER_DRIFT'; END IF;
END; $$;
CREATE FUNCTION sales_operator_private.adapter_matches(p_signature text,p_before_md5 text,p_current_md5 text)
 RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT p_before_md5=p_current_md5 OR EXISTS(SELECT 1 FROM sales_operator_private.adapters a
  WHERE a.signature=p_signature AND a.before_md5=p_before_md5 AND a.after_md5=p_current_md5);
$$;
-- Resolve only runtime-generated IDs tied to an already approved creation row.
-- Known identities remain exact; original 27/28/31 source/row/UUID guards remain.
CREATE FUNCTION sales_operator_private.normalized_payload(p_scope text,p_value jsonb,p_expected jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE rows jsonb; expected_by_row jsonb;
BEGIN
 IF p_scope NOT IN('lifecycle','membership') THEN RETURN p_value; END IF;
 SELECT coalesce(jsonb_object_agg(e.value->>'sourceRow',e.value),'{}') INTO expected_by_row FROM jsonb_array_elements(p_expected->'records') AS e(value);
 IF (SELECT count(*) FROM jsonb_each(expected_by_row))<>jsonb_array_length(p_expected->'records')
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_value->'records') AS a(value) WHERE NOT expected_by_row ? (a.value->>'sourceRow'))
 THEN RAISE EXCEPTION 'CUSTOMER_OPERATOR_PAYLOAD_SOURCE_DRIFT'; END IF;
 SELECT coalesce(jsonb_agg(CASE WHEN p_scope='lifecycle' THEN a.value-'before' ELSE
   a.value-ARRAY['customerCandidateKey','interestCandidateKey','newBookingCandidateKey']
    -CASE WHEN expected_by_row->(a.value->>'sourceRow')->>'customerCandidateKey' IS NOT NULL THEN ARRAY['customerId'] ELSE ARRAY[]::text[] END
    -CASE WHEN expected_by_row->(a.value->>'sourceRow')->>'interestCandidateKey' IS NOT NULL THEN ARRAY['interestId'] ELSE ARRAY[]::text[] END
    -CASE WHEN expected_by_row->(a.value->>'sourceRow')->>'newBookingCandidateKey' IS NOT NULL THEN ARRAY['saleId'] ELSE ARRAY[]::text[] END
  END ORDER BY a.ordinal),'[]') INTO rows FROM jsonb_array_elements(p_value->'records') WITH ORDINALITY AS a(value,ordinal);
 RETURN jsonb_set(p_value,'{records}',rows);
END; $$;
CREATE FUNCTION sales_operator_private.authorize_payload(p_scope text,p_value jsonb) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE context sales_operator_private.contexts%ROWTYPE; expected jsonb;
BEGIN
 -- A normal authenticated path keeps its exact original authorization branch.
 IF current_user<>session_user THEN RETURN; END IF;
 SELECT * INTO context FROM sales_operator_private.contexts WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid() AND db_role=current_user;
 IF NOT FOUND THEN RETURN; END IF;
 PERFORM sales_operator_private.require_owner();
 IF context.purpose<>'apply' OR p_scope NOT IN('creation','unknown','details','lifecycle','rentalManifest','rental','membership') THEN RAISE EXCEPTION 'CUSTOMER_OPERATOR_SCOPE_FORBIDDEN'; END IF;
 SELECT manifest->'payloads'->p_scope INTO expected FROM sales_operator_private.jobs WHERE id=context.job_id;
 IF expected IS NULL OR sales_operator_private.normalized_payload(p_scope,p_value,expected) IS DISTINCT FROM sales_operator_private.normalized_payload(p_scope,expected,expected)
 THEN RAISE EXCEPTION 'CUSTOMER_OPERATOR_EXACT_PAYLOAD_REQUIRED'; END IF;
END; $$;
CREATE FUNCTION sales_operator_private.authorize_journal(p_operation text,p_run uuid,p_review text) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE c sales_operator_private.contexts%ROWTYPE;j sales_operator_private.jobs%ROWTYPE;
BEGIN
 IF current_user<>session_user THEN RETURN; END IF;
 SELECT * INTO c FROM sales_operator_private.contexts WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid() AND db_role=current_user;
 IF NOT FOUND THEN RETURN; END IF;
 PERFORM sales_operator_private.require_owner(); SELECT * INTO STRICT j FROM sales_operator_private.jobs WHERE id=c.job_id;
 IF p_review IS DISTINCT FROM j.manifest->>'reviewReference'
  OR (p_operation IN('begin','seal') AND c.purpose<>'apply')
  OR (p_operation='restore' AND (c.purpose<>'restore' OR p_run IS DISTINCT FROM (j.manifest->>'recoveryRunId')::uuid))
  OR p_operation NOT IN('begin','seal','restore')
 THEN RAISE EXCEPTION 'CUSTOMER_OPERATOR_JOURNAL_SCOPE_REQUIRED'; END IF;
END; $$;
CREATE FUNCTION sales_operator_private.register_job(p_manifest jsonb,p_expected_payload_hash text) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE result uuid;actual_hash text;
BEGIN
 PERFORM sales_operator_private.require_owner();
 IF p_manifest->>'version' IS DISTINCT FROM 'approved-whole-replacement-operator-v1'
  OR p_manifest->>'datasetKey' IS DISTINCT FROM 'full-replacement-379da2e538829a3cb0379108b98851757c142eb010b1624543413116eef8a506'
  OR p_manifest->>'sourceSha256' IS DISTINCT FROM '7193857ef04d6a092171749a25867b1ca8d1bbe8f7b83b04fa7473b3a3a69ffd'
  OR p_manifest->>'reviewSha256' IS DISTINCT FROM 'de4beaee70afa8de9e8866e328eabf8bdd25257eae7aa78eb89649712f381802'
  OR p_manifest->>'inputDigest' IS DISTINCT FROM 'c24b45f03a5a8cf2854f893136b8c6e54656839e0db1a867fd27a177ba73f581'
  OR p_manifest->>'adapterPlanDigest' IS DISTINCT FROM '379da2e538829a3cb0379108b98851757c142eb010b1624543413116eef8a506'
  OR p_manifest->>'sourceBatchId' IS DISTINCT FROM '5d3f05d2-2a5d-44ed-a0e3-9385b8ace3a5'
  OR p_manifest->>'originalArchiveSha256' IS DISTINCT FROM '9ad3ddc7644e673de9d180d064f1939ff3fe267b1c6989c3124620c2320f8b23'
  OR p_manifest->'approvedSourceCount' IS DISTINCT FROM '958'::jsonb OR coalesce(p_manifest->>'mode','') NOT IN('apply','restore')
  OR coalesce(p_manifest->>'beforeStateHash','') !~ '^[0-9a-f]{64}$'
  OR coalesce(p_manifest->>'authorizationReference','')='' OR length(p_manifest->>'authorizationReference')>1000
  OR coalesce(p_manifest->>'reviewReference','')='' OR length(p_manifest->>'reviewReference')>1000
  OR coalesce(p_manifest->>'preparedPayloadDigest','') !~ '^[0-9a-f]{64}$'
 THEN RAISE EXCEPTION 'CUSTOMER_OPERATOR_PINNED_JOB_REQUIRED'; END IF;
 PERFORM sales_operator_private.check_reviewer((p_manifest->>'designatedReviewerId')::uuid);
 IF p_manifest->>'mode'='restore' AND coalesce(p_manifest->>'recoveryRunId','') !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'CUSTOMER_OPERATOR_RECOVERY_RUN_REQUIRED'; END IF;
 IF p_manifest->>'mode'='apply' AND (jsonb_typeof(p_manifest->'payloads'->'membership'->'records') IS DISTINCT FROM 'array'
  OR jsonb_array_length(p_manifest->'payloads'->'membership'->'records')<>958) THEN RAISE EXCEPTION 'CUSTOMER_OPERATOR_WHOLE_SOURCE_REQUIRED'; END IF;
 actual_hash:=sales_operator_private.digest(p_manifest);
 IF actual_hash IS DISTINCT FROM p_expected_payload_hash THEN RAISE EXCEPTION 'CUSTOMER_OPERATOR_JOB_PAYLOAD_DRIFT'; END IF;
 INSERT INTO sales_operator_private.jobs(manifest,payload_sha256,recorded_by_db_role,authorization_reference,designated_reviewer_id)
 VALUES(p_manifest,actual_hash,current_user,p_manifest->>'authorizationReference',(p_manifest->>'designatedReviewerId')::uuid) RETURNING id INTO result;
 RETURN result;
END; $$;
-- Read-only hash preparation with temporary owner context; never exposes raw
-- snapshot rows. Private import entrypoints reject this preview purpose.
CREATE FUNCTION sales_operator_private.preview_state(p_reviewer uuid) RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE result text;
BEGIN
 PERFORM sales_operator_private.check_reviewer(p_reviewer); PERFORM sales_operator_private.assert_catalog();
 INSERT INTO sales_operator_private.contexts(transaction_id,backend_pid,db_role,reviewer_id,purpose) VALUES(txid_current(),pg_backend_pid(),current_user,p_reviewer,'preview');
 result:=sales_operator_private.digest(sales_recovery_private.snapshot());
 DELETE FROM sales_operator_private.contexts WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid();
 RETURN result;
END; $$;
CREATE FUNCTION sales_operator_private.begin_job(p_job uuid,p_expected_hash text) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE j sales_operator_private.jobs%ROWTYPE;before_hash text;
BEGIN
 PERFORM sales_operator_private.require_owner();
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'CUSTOMER_OPERATOR_READ_COMMITTED_REQUIRED'; END IF;
 SELECT * INTO STRICT j FROM sales_operator_private.jobs WHERE id=p_job FOR UPDATE;
 IF j.recorded_by_db_role<>current_user OR j.payload_sha256 IS DISTINCT FROM p_expected_hash OR sales_operator_private.digest(j.manifest) IS DISTINCT FROM p_expected_hash
  OR EXISTS(SELECT 1 FROM sales_operator_private.receipts WHERE job_id=p_job) THEN RAISE EXCEPTION 'CUSTOMER_OPERATOR_JOB_REPLAY_OR_DRIFT'; END IF;
 PERFORM sales_operator_private.check_reviewer(j.designated_reviewer_id); PERFORM sales_operator_private.assert_catalog();
 PERFORM pg_advisory_xact_lock(hashtextextended('crm-booking-command',0));
 LOCK TABLE public.sales_customers,public.lead_project_interests,public.sales,public.plots,public.crm_settings IN SHARE ROW EXCLUSIVE MODE;
 LOCK TABLE crm_external_private.snapshot_batches,crm_external_private.source_records IN SHARE MODE;
 -- The immutable original archive predates the approved workbook revision.
 -- Its own hash remains pinned independently; never rewrite the old archive.
 IF NOT EXISTS(SELECT 1 FROM crm_external_private.snapshot_batches b WHERE b.id=(j.manifest->>'sourceBatchId')::uuid AND b.source_sha256=j.manifest->>'originalArchiveSha256')
  OR (SELECT count(*) FROM crm_external_private.source_records WHERE batch_id=(j.manifest->>'sourceBatchId')::uuid)<>965
 THEN RAISE EXCEPTION 'CUSTOMER_OPERATOR_SOURCE_CAPTURE_DRIFT'; END IF;
 INSERT INTO sales_operator_private.contexts(transaction_id,backend_pid,db_role,job_id,reviewer_id,purpose,before_run_ids)
 SELECT txid_current(),pg_backend_pid(),current_user,j.id,j.designated_reviewer_id,j.manifest->>'mode',coalesce(jsonb_agg(id::text),'[]') FROM sales_recovery_private.runs;
 before_hash:=sales_operator_private.digest(sales_recovery_private.snapshot());
 IF before_hash IS DISTINCT FROM j.manifest->>'beforeStateHash' THEN RAISE EXCEPTION 'CUSTOMER_OPERATOR_BEFORE_STATE_DRIFT'; END IF;
END; $$;
CREATE FUNCTION sales_operator_private.finish_job(p_job uuid,p_run uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE j sales_operator_private.jobs%ROWTYPE;c sales_operator_private.contexts%ROWTYPE;after_hash text;
BEGIN
 PERFORM sales_operator_private.require_owner(); PERFORM sales_operator_private.assert_catalog();
 SELECT * INTO STRICT c FROM sales_operator_private.contexts WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid() AND db_role=current_user AND job_id=p_job;
 SELECT * INTO STRICT j FROM sales_operator_private.jobs WHERE id=p_job;
 IF c.purpose='apply' THEN
  IF c.before_run_ids @> jsonb_build_array(p_run::text) OR NOT EXISTS(
   SELECT 1 FROM sales_recovery_private.runs r JOIN sales_recovery_private.seals s ON s.run_id=r.id
    WHERE r.id=p_run AND r.actor_id=c.reviewer_id AND s.actor_id=c.reviewer_id
     AND r.source_sha256=j.manifest->>'sourceSha256' AND sales_operator_private.digest(r.before_state)=j.manifest->>'beforeStateHash'
     AND s.after_state=sales_recovery_private.snapshot())
   OR (SELECT count(*) FROM customer_source_membership_private.members m JOIN customer_source_membership_private.head h ON h.revision_id=m.revision_id)<>958
  THEN RAISE EXCEPTION 'CUSTOMER_OPERATOR_WHOLE_SEAL_REQUIRED'; END IF;
 ELSE
  IF c.purpose<>'restore' OR p_run IS DISTINCT FROM (j.manifest->>'recoveryRunId')::uuid
   OR NOT EXISTS(SELECT 1 FROM sales_recovery_private.recoveries WHERE run_id=p_run AND actor_id=c.reviewer_id AND created_at=transaction_timestamp())
   OR EXISTS(SELECT 1 FROM customer_source_membership_private.head)
  THEN RAISE EXCEPTION 'CUSTOMER_OPERATOR_WHOLE_RECOVERY_REQUIRED'; END IF;
 END IF;
 after_hash:=sales_operator_private.digest(sales_recovery_private.snapshot());
 INSERT INTO sales_operator_private.receipts VALUES(j.id,p_run,958,j.manifest->>'beforeStateHash',after_hash,current_user,session_user,c.reviewer_id,j.authorization_reference,false,now());
 DELETE FROM sales_operator_private.contexts WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid();
 RETURN jsonb_build_object('jobId',j.id,'sourceRows',958,'executionAuthority','database_owner','executedByDbRole',current_user,'designatedReviewerId',c.reviewer_id,'reviewerAuthenticated',false,'afterSha256',after_hash);
END; $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA sales_operator_private FROM PUBLIC,anon,authenticated,service_role;
ROLLBACK;
