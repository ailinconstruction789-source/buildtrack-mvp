-- REVIEWED OPERATOR DRAFT; preparation is NOT authorization to execute live.
-- Requires an exact per-operation review in buildtrack.visit_operation (JSON),
-- supplied separately by the reviewed runner in the same connection. No defaults.
-- Disable access only: do not restore, import, delete or modify customer records.
-- The sealed installer must already have installed immutable operation receipts.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';
SET LOCAL transaction_timeout='30s';
SET LOCAL search_path=pg_catalog;
DO $reviewed_visit_disable$
DECLARE
  review jsonb;
  batch uuid;
  digest text;
  operation uuid;
  before_settings jsonb;
  after_settings jsonb;
  before_access jsonb;
  after_access jsonb;
  signature text;
  fn oid;
  owner_id oid;
  grantee record;
  target text;
  signatures text[]:=ARRAY[
    'public.crm_v2_visits_capabilities()',
    'public.crm_v2_visits_context(uuid,uuid,integer,integer,integer)',
    'public.crm_v2_visits_command(uuid,jsonb)',
    'public.crm_v2_visit_sop_capabilities()',
    'public.crm_v2_visit_sop_context(uuid,uuid,uuid,uuid,integer)',
    'public.crm_v2_record_visit_sop(uuid,jsonb)',
    'public.crm_v2_customer_voices_capabilities()',
    'public.crm_v2_customer_voices_context(uuid,uuid,uuid)',
    'public.crm_v2_customer_voices_command(uuid,jsonb)',
    'public.crm_v2_visit_follow_up_capabilities()',
    'public.crm_v2_visit_follow_up_context(uuid,uuid)',
    'public.crm_v2_visit_follow_up_command(uuid,jsonb)',
    'public.crm_v2_voice_row_readable(uuid)',
    'public.crm_v2_customer_voice_open(text)',
    'public.crm_v2_customer_voice_submit(text,uuid,text,jsonb)'
  ];
BEGIN
  -- User-set configuration is a review input, NEVER database authorization.
  PERFORM crm_external_private.cutover_operator_check();
  review:=nullif(current_setting('buildtrack.visit_operation',true),'')::jsonb;
  IF review IS NULL OR jsonb_typeof(review)<>'object'
    OR review->>'operationKind' IS DISTINCT FROM 'disable'
    OR review->>'expectedDatabase' IS DISTINCT FROM current_database()
    OR review->>'expectedSessionActor' IS DISTINCT FROM session_user::text
    OR NOT review ?& ARRAY['operationId','operationKind','reviewReference','batchId',
      'planDigest','releaseDigest','expectedSettingsDigest','expectedDatabase','expectedSessionActor']
    OR review-ARRAY['operationId','operationKind','reviewReference','batchId',
      'planDigest','releaseDigest','expectedSettingsDigest','expectedDatabase','expectedSessionActor']<>'{}'::jsonb
    OR EXISTS(SELECT 1 FROM jsonb_each(review) p WHERE jsonb_typeof(p.value)<>'string')
    OR length(btrim(review->>'reviewReference')) NOT BETWEEN 8 AND 500
    OR review->>'planDigest' !~ '^[a-f0-9]{64}$'
    OR review->>'releaseDigest' !~ '^[a-f0-9]{64}$'
    OR review->>'expectedSettingsDigest' !~ '^[a-f0-9]{32}$' THEN
    RAISE EXCEPTION 'CENTRAL_VISITS_DISABLE_EXPLICIT_REVIEW_REQUIRED';
  END IF;
  operation:=(review->>'operationId')::uuid;
  batch:=(review->>'batchId')::uuid;
  digest:=review->>'planDigest';
  IF operation IS NULL OR batch IS NULL THEN
    RAISE EXCEPTION 'CENTRAL_VISITS_DISABLE_EXPLICIT_REVIEW_REQUIRED';
  END IF;
  PERFORM pg_advisory_xact_lock(20260929,23);
  -- Every scoped writer holds FOR SHARE on this row before writing. The lock
  -- drains those transactions; lock_timeout aborts instead of blocking work.
  SELECT to_jsonb(s) INTO STRICT before_settings FROM public.crm_settings s WHERE id FOR UPDATE;
  IF md5(before_settings::text) IS DISTINCT FROM review->>'expectedSettingsDigest' THEN
    RAISE EXCEPTION 'CENTRAL_VISITS_DISABLE_SETTINGS_DRIFT';
  END IF;
  IF NOT crm_external_private.booking_writer_ready()
    OR (SELECT count(*) FROM crm_external_private.visit_workflow_releases)<>1
    OR NOT EXISTS(
      SELECT 1 FROM crm_external_private.visit_workflow_releases v
      JOIN crm_external_private.booking_writer_releases w USING(batch_id,plan_digest)
      JOIN crm_external_private.snapshot_batches b ON b.id=v.batch_id AND b.plan_digest=v.plan_digest
      WHERE v.batch_id=batch AND v.plan_digest=digest
        AND NOT EXISTS(SELECT 1 FROM crm_external_private.sales_rollback_receipts r WHERE r.batch_id=v.batch_id)
    ) OR NOT EXISTS(
      SELECT 1 FROM crm_external_private.visit_workflow_operations o
      WHERE o.operation_kind='install' AND o.batch_id=batch AND o.plan_digest=digest
        AND o.release_digest=review->>'releaseDigest'
    ) THEN
    RAISE EXCEPTION 'CENTRAL_VISITS_DISABLE_REVIEW_MISMATCH';
  END IF;
  IF EXISTS(SELECT 1 FROM crm_external_private.visit_workflow_operations WHERE operation_id=operation) THEN
    RAISE EXCEPTION 'CENTRAL_VISITS_DISABLE_OPERATION_ALREADY_RECORDED';
  END IF;
  FOREACH signature IN ARRAY signatures LOOP
    IF to_regprocedure(signature) IS NULL THEN
      RAISE EXCEPTION 'CENTRAL_VISITS_DISABLE_API_MISSING: %',signature;
    END IF;
  END LOOP;
  IF NOT EXISTS(SELECT 1 FROM pg_policy WHERE polrelid='public.customer_voices'::regclass
    AND polname='voice_v2_private_read' AND NOT polpermissive AND polcmd='r') THEN
    RAISE EXCEPTION 'CENTRAL_VISITS_DISABLE_VOICE_POLICY_REQUIRED';
  END IF;
  SELECT jsonb_build_object(
    'functions',(SELECT jsonb_agg(jsonb_build_object('signature',s,'owner',p.proowner,
      'definitionMd5',md5(pg_get_functiondef(p.oid)),'acl',p.proacl) ORDER BY s)
      FROM unnest(signatures) s JOIN pg_proc p ON p.oid=to_regprocedure(s)),
    'voicePolicy',(SELECT pg_get_expr(polqual,polrelid) FROM pg_policy
      WHERE polrelid='public.customer_voices'::regclass AND polname='voice_v2_private_read')
  ) INTO before_access;

  INSERT INTO crm_external_private.booking_activation_permits VALUES(txid_current(),pg_backend_pid(),batch);
  UPDATE public.crm_settings SET visits_enabled=false,visit_sop_enabled=false,customer_voices_enabled=false WHERE id;
  DELETE FROM crm_external_private.booking_activation_permits
    WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid();
  -- Remove the policy dependency before revoking its helper, retaining legacy
  -- SELECT and the other restrictive V2 write policies and immutable row seal.
  ALTER POLICY voice_v2_private_read ON public.customer_voices USING(visit_id IS NULL);
  FOREACH signature IN ARRAY signatures LOOP
    fn:=to_regprocedure(signature);
    SELECT proowner INTO owner_id FROM pg_proc WHERE oid=fn;
    FOR grantee IN SELECT DISTINCT a.grantee FROM pg_proc p,
      LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      WHERE p.oid=fn AND a.grantee<>owner_id LOOP
      target:=CASE WHEN grantee.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(grantee.grantee)) END;
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %s',fn::regprocedure,target);
    END LOOP;
    -- ACL text alone misses inherited privileges, including owner membership.
    -- Database superusers/operators are not application roles; no grant can
    -- revoke superuser powers. Any unexpected other effective caller aborts.
    IF EXISTS(SELECT 1 FROM pg_roles r WHERE NOT r.rolsuper AND r.oid<>owner_id
      AND r.rolname<>session_user AND r.rolname<>current_user
      AND has_function_privilege(r.oid,fn,'EXECUTE')) THEN
      RAISE EXCEPTION 'CENTRAL_VISITS_DISABLE_EFFECTIVE_CALLER_REMAINS';
    END IF;
  END LOOP;
  SELECT to_jsonb(s) INTO STRICT after_settings FROM public.crm_settings s WHERE id;
  IF after_settings-ARRAY['visits_enabled','visit_sop_enabled','customer_voices_enabled']
      IS DISTINCT FROM before_settings-ARRAY['visits_enabled','visit_sop_enabled','customer_voices_enabled']
    OR (after_settings->>'visits_enabled')::boolean IS DISTINCT FROM false
    OR (after_settings->>'visit_sop_enabled')::boolean IS DISTINCT FROM false
    OR (after_settings->>'customer_voices_enabled')::boolean IS DISTINCT FROM false
    OR EXISTS(SELECT 1 FROM crm_external_private.booking_activation_permits
      WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid())
    OR NOT crm_external_private.booking_writer_ready() THEN
    RAISE EXCEPTION 'CENTRAL_VISITS_DISABLE_CHANGED_BOOKING_BASELINE';
  END IF;
  SELECT jsonb_build_object(
    'functions',(SELECT jsonb_agg(jsonb_build_object('signature',s,'owner',p.proowner,
      'definitionMd5',md5(pg_get_functiondef(p.oid)),'acl',p.proacl) ORDER BY s)
      FROM unnest(signatures) s JOIN pg_proc p ON p.oid=to_regprocedure(s)),
    'voicePolicy',(SELECT pg_get_expr(polqual,polrelid) FROM pg_policy
      WHERE polrelid='public.customer_voices'::regclass AND polname='voice_v2_private_read')
  ) INTO after_access;
  INSERT INTO crm_external_private.visit_workflow_operations(
    operation_id,operation_kind,review_reference,batch_id,plan_digest,release_digest,
    session_actor,current_actor,settings_before,settings_after,function_acl_before,function_acl_after
  ) VALUES(operation,'disable',review->>'reviewReference',batch,digest,review->>'releaseDigest',
    session_user,current_user,before_settings,after_settings,before_access,after_access);
END;
$reviewed_visit_disable$;
COMMIT;
