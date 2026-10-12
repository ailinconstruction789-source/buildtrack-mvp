-- DESIGN ONLY. Install with the exact reviewed activation-seal adapter after
-- 20-34; installation is inert. Activation follows the completed owner job.
-- The DB owner is the operator; no human Auth identity is impersonated.
BEGIN;
DO $draft_only$ BEGIN RAISE EXCEPTION 'DESIGN ONLY: reviewed post-booking activation requires whole replacement proof'; END; $draft_only$;
CREATE SCHEMA sales_activation_private;
REVOKE ALL ON SCHEMA sales_activation_private FROM PUBLIC,anon,authenticated,service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA sales_activation_private REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
CREATE TABLE sales_activation_private.adapters(signature text PRIMARY KEY,before_md5 text NOT NULL,after_md5 text NOT NULL,settings text[],security_definer boolean NOT NULL);
CREATE TABLE sales_activation_private.releases(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),run_id uuid NOT NULL UNIQUE REFERENCES sales_recovery_private.seals(run_id),
 revision_id uuid NOT NULL REFERENCES customer_source_membership_private.revisions(id),
 before_settings jsonb NOT NULL,after_settings jsonb NOT NULL,review_reference text NOT NULL CHECK(length(btrim(review_reference))>0),
 operator_role name NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE sales_activation_private.restorations(
 release_id uuid PRIMARY KEY REFERENCES sales_activation_private.releases(id),review_reference text NOT NULL CHECK(length(btrim(review_reference))>0),
 operator_role name NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE sales_activation_private.permits(
 transaction_id bigint NOT NULL,backend_pid integer NOT NULL,operator_role name NOT NULL,
 old_settings jsonb NOT NULL,new_settings jsonb NOT NULL,PRIMARY KEY(transaction_id,backend_pid));
CREATE FUNCTION sales_activation_private.require_owner() RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF current_user IS DISTINCT FROM session_user OR current_user IS DISTINCT FROM
  (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid='sales_activation_private.releases'::regclass)
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='POST_BOOKING_ACTIVATION_DB_OWNER_REQUIRED'; END IF;
 PERFORM sales_operator_private.require_owner();
END; $$;
CREATE FUNCTION sales_activation_private.sealed() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'POST_BOOKING_ACTIVATION_LEDGER_IMMUTABLE'; END; $$;
DO $private_tables$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['adapters','releases','restorations','permits'] LOOP
  EXECUTE format('ALTER TABLE sales_activation_private.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON sales_activation_private.%I FROM PUBLIC,anon,authenticated,service_role',t);
  EXECUTE format('CREATE TRIGGER activation_no_truncate BEFORE TRUNCATE ON sales_activation_private.%I FOR EACH STATEMENT EXECUTE FUNCTION sales_activation_private.sealed()',t);
  IF t<>'permits' THEN EXECUTE format('CREATE TRIGGER activation_immutable BEFORE UPDATE OR DELETE ON sales_activation_private.%I FOR EACH STATEMENT EXECUTE FUNCTION sales_activation_private.sealed()',t); END IF;
 END LOOP;
END; $private_tables$;
CREATE FUNCTION sales_activation_private.settings_valid(p_settings jsonb,p_enabled boolean)
RETURNS boolean LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT p_settings @> '{"id":true,"central_intake_enabled":true,"lead_work_enabled":true,"lead_lifecycle_enabled":true,"booking_enabled":true,"booking_cutover_reviewed":true,"visits_enabled":true,"visit_sop_enabled":true,"customer_voices_enabled":true}'::jsonb
  AND p_settings->'post_booking_enabled'=to_jsonb(p_enabled)
  AND NOT EXISTS(SELECT 1 FROM jsonb_each(p_settings) j WHERE
    (j.key LIKE '%\_enabled' ESCAPE '\' OR j.key='booking_cutover_reviewed')
    AND j.key NOT IN('central_intake_enabled','lead_work_enabled','lead_lifecycle_enabled','booking_enabled',
      'booking_cutover_reviewed','visits_enabled','visit_sop_enabled','customer_voices_enabled','post_booking_enabled')
    AND j.value IS DISTINCT FROM 'false'::jsonb);
$$;
CREATE FUNCTION sales_activation_private.settings_allowed(p_old jsonb,p_new jsonb)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF current_user IS DISTINCT FROM session_user OR current_user IS DISTINCT FROM
  (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid='sales_activation_private.releases'::regclass)
 THEN RETURN false; END IF;
 RETURN p_old IS NOT NULL AND p_old-'post_booking_enabled'=p_new-'post_booking_enabled'
  AND ((sales_activation_private.settings_valid(p_old,false) AND sales_activation_private.settings_valid(p_new,true))
    OR (sales_activation_private.settings_valid(p_old,true) AND sales_activation_private.settings_valid(p_new,false)))
  AND EXISTS(SELECT 1 FROM sales_activation_private.permits p WHERE p.transaction_id=txid_current()
    AND p.backend_pid=pg_backend_pid() AND p.operator_role=current_user AND p.old_settings=p_old AND p.new_settings=p_new);
END; $$;
CREATE FUNCTION sales_activation_private.assert_catalog() RETURNS void LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM sales_activation_private.require_owner();
 IF (SELECT count(*) FROM sales_activation_private.adapters)<>1 OR NOT EXISTS(
  SELECT 1 FROM sales_activation_private.adapters a JOIN pg_proc p ON p.oid=to_regprocedure(a.signature)
  WHERE a.signature='crm_external_private.reject_unreviewed_activation()'
    AND a.before_md5='d9679ba1d8fa229c754033144ec0bf42'
    AND a.after_md5=md5(replace(p.prosrc,E'\r\n',E'\n')) AND a.settings IS NOT DISTINCT FROM p.proconfig
    AND a.security_definer=p.prosecdef AND NOT p.prosecdef AND pg_get_userbyid(p.proowner)=current_user)
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.crm_settings'::regclass
    AND tgname='external_bridge_activation_seal' AND NOT tgisinternal AND tgenabled='O' AND tgtype=23
    AND tgfoid='crm_external_private.reject_unreviewed_activation()'::regprocedure AND tgnargs=0 AND tgqual IS NULL)
 THEN RAISE EXCEPTION 'POST_BOOKING_ACTIVATION_CATALOG_DRIFT'; END IF;
 IF EXISTS(SELECT 1 FROM (VALUES
  ('customer_source_membership_private.revisions','membership_immutable',27,'customer_source_membership_private.sealed()'),
  ('customer_source_membership_private.revisions','membership_no_truncate',34,'customer_source_membership_private.sealed()'),
  ('customer_source_membership_private.members','membership_immutable',27,'customer_source_membership_private.sealed()'),
  ('customer_source_membership_private.members','membership_no_truncate',34,'customer_source_membership_private.sealed()'),
  ('customer_source_membership_private.head','membership_no_truncate',34,'customer_source_membership_private.sealed()'),
  ('crm_external_private.snapshot_batches','immutable_history',58,'crm_external_private.reject_history_change()'),
  ('crm_external_private.source_records','immutable_history',58,'crm_external_private.reject_history_change()')
 ) expected(relation_name,trigger_name,trigger_type,function_name)
 LEFT JOIN pg_trigger t ON t.tgrelid=to_regclass(expected.relation_name) AND t.tgname=expected.trigger_name AND NOT t.tgisinternal
 WHERE t.oid IS NULL OR t.tgenabled<>'O' OR t.tgtype<>expected.trigger_type OR t.tgfoid<>to_regprocedure(expected.function_name)
   OR t.tgnargs<>0 OR t.tgqual IS NOT NULL)
  OR EXISTS(SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role']) actor(name)
   WHERE has_schema_privilege(actor.name,'sales_activation_private','USAGE')
    OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='sales_activation_private' AND has_function_privilege(actor.name,p.oid,'EXECUTE')))
 THEN RAISE EXCEPTION 'POST_BOOKING_ACTIVATION_IMMUTABLE_SOURCE_REQUIRED'; END IF;
 PERFORM customer_source_membership_private.assert_catalog();
 PERFORM sales_operator_private.assert_catalog();
END; $$;
CREATE FUNCTION sales_activation_private.require_release_source(p_run uuid) RETURNS uuid LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE revision uuid;
BEGIN
 PERFORM sales_activation_private.assert_catalog();
 SELECT r.id INTO revision FROM customer_source_membership_private.head h
  JOIN customer_source_membership_private.revisions r ON r.id=h.revision_id
  WHERE h.id AND r.dataset_key='full-cohort-379da2e538829a3cb0379108b98851757c142eb010b1624543413116eef8a506'
   AND r.payload->>'sourceSha256'='7193857ef04d6a092171749a25867b1ca8d1bbe8f7b83b04fa7473b3a3a69ffd'
   AND r.payload->>'reviewSha256'='de4beaee70afa8de9e8866e328eabf8bdd25257eae7aa78eb89649712f381802'
   AND r.payload->>'adapterPlanDigest'='379da2e538829a3cb0379108b98851757c142eb010b1624543413116eef8a506'
   AND r.payload->'originalSourceBatchIds'='["5d3f05d2-2a5d-44ed-a0e3-9385b8ace3a5"]'::jsonb
   AND jsonb_array_length(r.payload->'records')=958;
 IF revision IS NULL OR (SELECT count(*) FROM customer_source_membership_private.members WHERE revision_id=revision)<>958
  OR (SELECT count(DISTINCT customer_id) FROM customer_source_membership_private.members WHERE revision_id=revision)<>957
  OR (SELECT count(DISTINCT interest_id) FROM customer_source_membership_private.members WHERE revision_id=revision)<>948
  OR (SELECT count(DISTINCT sale_id) FROM customer_source_membership_private.members WHERE revision_id=revision)<>298
  OR NOT EXISTS(SELECT 1 FROM crm_external_private.snapshot_batches WHERE id='5d3f05d2-2a5d-44ed-a0e3-9385b8ace3a5' AND source_sha256='9ad3ddc7644e673de9d180d064f1939ff3fe267b1c6989c3124620c2320f8b23')
  OR (SELECT count(*) FROM crm_external_private.source_records WHERE batch_id='5d3f05d2-2a5d-44ed-a0e3-9385b8ace3a5')<>965
  OR NOT EXISTS(SELECT 1 FROM sales_recovery_private.runs r JOIN sales_recovery_private.seals s ON s.run_id=r.id
   JOIN sales_operator_private.receipts receipt ON receipt.recovery_run_id=r.id
   JOIN sales_operator_private.jobs job ON job.id=receipt.job_id
   WHERE r.id=p_run AND r.dataset_key='full-replacement-379da2e538829a3cb0379108b98851757c142eb010b1624543413116eef8a506'
    AND r.source_sha256='7193857ef04d6a092171749a25867b1ca8d1bbe8f7b83b04fa7473b3a3a69ffd'
    AND job.manifest->>'mode'='apply' AND receipt.source_rows=958 AND NOT receipt.reviewer_is_authenticated_actor
    AND receipt.executed_by_db_role=current_user AND receipt.session_db_role=session_user
    AND s.after_state->'head' @> jsonb_build_array(jsonb_build_object('revision_id',revision))
    AND NOT EXISTS(SELECT 1 FROM sales_recovery_private.recoveries WHERE run_id=p_run))
 THEN RAISE EXCEPTION 'POST_BOOKING_ACTIVATION_WHOLE_SOURCE_REQUIRED'; END IF;
 RETURN revision;
END; $$;
CREATE FUNCTION sales_activation_private.activate(p_run uuid,p_review text) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE revision uuid;before_row jsonb;after_row jsonb;release uuid;
BEGIN
 PERFORM sales_activation_private.require_owner();
 IF coalesce(length(btrim(p_review)),0)=0 OR length(p_review)>1000 THEN RAISE EXCEPTION 'POST_BOOKING_ACTIVATION_REVIEW_REQUIRED'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('crm-booking-command',0));
 PERFORM 1 FROM customer_source_membership_private.head FOR SHARE;
 revision:=sales_activation_private.require_release_source(p_run);
 SELECT to_jsonb(s) INTO STRICT before_row FROM public.crm_settings s WHERE s.id FOR UPDATE;
 IF NOT sales_activation_private.settings_valid(before_row,false)
  OR EXISTS(SELECT 1 FROM sales_activation_private.releases WHERE run_id=p_run)
  OR NOT EXISTS(SELECT 1 FROM sales_recovery_private.seals WHERE run_id=p_run AND after_state->'public'->'crm_settings'=jsonb_build_array(before_row))
 THEN RAISE EXCEPTION 'POST_BOOKING_ACTIVATION_SETTINGS_DRIFT'; END IF;
 after_row:=before_row||'{"post_booking_enabled":true}'::jsonb;
 INSERT INTO sales_activation_private.permits VALUES(txid_current(),pg_backend_pid(),current_user,before_row,after_row);
 UPDATE public.crm_settings SET post_booking_enabled=true WHERE id;
 DELETE FROM sales_activation_private.permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid();
 IF (SELECT to_jsonb(s) FROM public.crm_settings s WHERE s.id) IS DISTINCT FROM after_row THEN RAISE EXCEPTION 'POST_BOOKING_ACTIVATION_SETTINGS_DRIFT'; END IF;
 INSERT INTO sales_activation_private.releases(run_id,revision_id,before_settings,after_settings,review_reference,operator_role)
  VALUES(p_run,revision,before_row,after_row,p_review,current_user) RETURNING id INTO release;
 RETURN jsonb_build_object('releaseId',release,'postBookingEnabled',true,'humanAuthenticatedActor',false);
END; $$;
CREATE FUNCTION sales_activation_private.restore(p_release uuid,p_review text) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE release sales_activation_private.releases%ROWTYPE;before_row jsonb;
BEGIN
 PERFORM sales_activation_private.require_owner();
 IF coalesce(length(btrim(p_review)),0)=0 OR length(p_review)>1000 THEN RAISE EXCEPTION 'POST_BOOKING_ACTIVATION_REVIEW_REQUIRED'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('crm-booking-command',0));
 SELECT * INTO STRICT release FROM sales_activation_private.releases WHERE id=p_release FOR SHARE;
 PERFORM 1 FROM customer_source_membership_private.head FOR SHARE;
 IF sales_activation_private.require_release_source(release.run_id) IS DISTINCT FROM release.revision_id
  OR EXISTS(SELECT 1 FROM sales_activation_private.restorations WHERE release_id=p_release) THEN RAISE EXCEPTION 'POST_BOOKING_ACTIVATION_RESTORE_CONFLICT'; END IF;
 SELECT to_jsonb(s) INTO STRICT before_row FROM public.crm_settings s WHERE s.id FOR UPDATE;
 IF before_row IS DISTINCT FROM release.after_settings THEN RAISE EXCEPTION 'POST_BOOKING_ACTIVATION_SETTINGS_DRIFT'; END IF;
 INSERT INTO sales_activation_private.permits VALUES(txid_current(),pg_backend_pid(),current_user,release.after_settings,release.before_settings);
 UPDATE public.crm_settings SET post_booking_enabled=false WHERE id;
 DELETE FROM sales_activation_private.permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid();
 IF (SELECT to_jsonb(s) FROM public.crm_settings s WHERE s.id) IS DISTINCT FROM release.before_settings THEN RAISE EXCEPTION 'POST_BOOKING_ACTIVATION_SETTINGS_DRIFT'; END IF;
 INSERT INTO sales_activation_private.restorations VALUES(p_release,p_review,current_user,now());
 RETURN jsonb_build_object('releaseId',p_release,'postBookingEnabled',false,'exactOriginalSettingsRestored',true);
END; $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA sales_activation_private FROM PUBLIC,anon,authenticated,service_role;
ROLLBACK;
