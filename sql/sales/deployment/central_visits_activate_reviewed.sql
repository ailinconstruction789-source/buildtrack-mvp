-- REVIEWED OPERATOR DRAFT; preparation is NOT authorization to execute live.
-- Explicit backup/client/log references are operator attestations, not proof
-- obtained by this SQL. Verify them independently before supplying the input.
-- First activation only. A disabled deployment requires a separate resume review.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';
SET LOCAL transaction_timeout='30s';
SET LOCAL search_path=pg_catalog;
DO $reviewed_visit_activate$
DECLARE
  review jsonb; operation uuid; batch uuid; digest text;
  installed jsonb; baseline jsonb; before_settings jsonb; after_settings jsonb;
  before_access jsonb; after_access jsonb; signature text; fn oid; entry jsonb;
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
  PERFORM crm_external_private.cutover_operator_check();
  review:=nullif(current_setting('buildtrack.visit_operation',true),'')::jsonb;
  IF review IS NULL OR jsonb_typeof(review)<>'object'
    OR review->>'operationKind' IS DISTINCT FROM 'activate'
    OR review->>'expectedDatabase' IS DISTINCT FROM current_database()
    OR review->>'expectedSessionActor' IS DISTINCT FROM session_user::text
    OR NOT review ?& ARRAY['operationId','operationKind','reviewReference','batchId',
      'planDigest','releaseDigest','expectedSettingsDigest','expectedDatabase','expectedSessionActor',
      'backupReference','clientReleaseReference','tokenLogReviewReference']
    OR review-ARRAY['operationId','operationKind','reviewReference','batchId',
      'planDigest','releaseDigest','expectedSettingsDigest','expectedDatabase','expectedSessionActor',
      'backupReference','clientReleaseReference','tokenLogReviewReference']<>'{}'::jsonb
    OR EXISTS(SELECT 1 FROM jsonb_each(review) p WHERE jsonb_typeof(p.value)<>'string')
    OR EXISTS(SELECT 1 FROM unnest(ARRAY['reviewReference','backupReference','clientReleaseReference','tokenLogReviewReference']) k
      WHERE length(btrim(review->>k)) NOT BETWEEN 8 AND 500)
    OR review->>'planDigest' !~ '^[a-f0-9]{64}$'
    OR review->>'releaseDigest' !~ '^[a-f0-9]{64}$'
    OR review->>'expectedSettingsDigest' !~ '^[a-f0-9]{32}$' THEN
    RAISE EXCEPTION 'CENTRAL_VISITS_ACTIVATE_EXPLICIT_REVIEW_REQUIRED';
  END IF;
  operation:=(review->>'operationId')::uuid; batch:=(review->>'batchId')::uuid; digest:=review->>'planDigest';
  IF operation IS NULL OR batch IS NULL THEN RAISE EXCEPTION 'CENTRAL_VISITS_ACTIVATE_EXPLICIT_REVIEW_REQUIRED'; END IF;
  PERFORM pg_advisory_xact_lock(20260929,23);
  SELECT to_jsonb(s) INTO STRICT before_settings FROM public.crm_settings s WHERE id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM crm_external_private.visit_workflow_operations WHERE operation_id=operation) THEN
    RAISE EXCEPTION 'CENTRAL_VISITS_ACTIVATE_OPERATION_ALREADY_RECORDED';
  END IF;
  IF md5(before_settings::text) IS DISTINCT FROM review->>'expectedSettingsDigest' THEN
    RAISE EXCEPTION 'CENTRAL_VISITS_ACTIVATE_SETTINGS_DRIFT';
  END IF;
  IF EXISTS(SELECT 1 FROM crm_external_private.visit_workflow_releases)
    OR EXISTS(SELECT 1 FROM crm_external_private.visit_workflow_operations WHERE operation_kind IN ('activate','disable'))
    OR before_settings->'visits_enabled' IS DISTINCT FROM 'false'::jsonb
    OR before_settings->'visit_sop_enabled' IS DISTINCT FROM 'false'::jsonb
    OR before_settings->'customer_voices_enabled' IS DISTINCT FROM 'false'::jsonb THEN
    RAISE EXCEPTION 'CENTRAL_VISITS_ACTIVATE_FIRST_ACTIVATION_ONLY';
  END IF;
  IF NOT crm_external_private.booking_writer_ready() OR NOT EXISTS(
    SELECT 1 FROM crm_external_private.booking_writer_releases w
    JOIN crm_external_private.snapshot_batches b ON b.id=w.batch_id AND b.plan_digest=w.plan_digest
    WHERE w.batch_id=batch AND w.plan_digest=digest
      AND NOT EXISTS(SELECT 1 FROM crm_external_private.sales_rollback_receipts r WHERE r.batch_id=w.batch_id)
  ) OR (SELECT count(*) FROM crm_external_private.visit_workflow_operations WHERE operation_kind='install')<>1 THEN
    RAISE EXCEPTION 'CENTRAL_VISITS_ACTIVATE_REVIEW_MISMATCH';
  END IF;
  SELECT function_acl_after,function_acl_before INTO installed,baseline FROM crm_external_private.visit_workflow_operations
    WHERE operation_kind='install' AND batch_id=batch AND plan_digest=digest AND release_digest=review->>'releaseDigest';
  IF NOT FOUND OR jsonb_typeof(installed) IS DISTINCT FROM 'array' OR jsonb_array_length(installed)<20 THEN
    RAISE EXCEPTION 'CENTRAL_VISITS_ACTIVATE_REVIEW_MISMATCH';
  END IF;
  IF jsonb_typeof(baseline) IS DISTINCT FROM 'array' OR jsonb_array_length(baseline)<17 THEN
    RAISE EXCEPTION 'CENTRAL_VISITS_ACTIVATE_BASELINE_DRIFT';
  END IF;
  FOR entry IN SELECT value FROM jsonb_array_elements(baseline) LOOP
    signature:=entry->>'signature';
    IF position('.' IN split_part(signature,'(',1))=0 THEN signature:='public.'||signature; END IF;
    fn:=to_regprocedure(signature);
    IF fn IS NULL OR NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=fn
      AND pg_get_userbyid(p.proowner)=entry->>'owner'
      AND coalesce(to_jsonb(p.proacl),'null'::jsonb) IS NOT DISTINCT FROM entry->'acl'
      AND (signature='crm_external_private.reject_unreviewed_activation()'
        OR md5(pg_get_functiondef(p.oid))=entry->>'definitionMd5')) THEN
      RAISE EXCEPTION 'CENTRAL_VISITS_ACTIVATE_BASELINE_DRIFT';
    END IF;
  END LOOP;
  -- Check all installed helpers, not just public endpoints. Missing definitions,
  -- modified bodies/owners/ACLs and inherited effective callers fail closed.
  FOR entry IN SELECT value FROM jsonb_array_elements(installed) LOOP
    fn:=to_regprocedure(entry->>'signature');
    IF fn IS NULL OR NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=fn
      AND md5(pg_get_functiondef(p.oid))=entry->>'definitionMd5'
      AND pg_get_userbyid(p.proowner)=entry->>'owner'
      AND coalesce(to_jsonb(p.proacl),'null'::jsonb) IS NOT DISTINCT FROM entry->'acl') THEN
      RAISE EXCEPTION 'CENTRAL_VISITS_ACTIVATE_FUNCTION_DRIFT';
    END IF;
    IF (SELECT coalesce(jsonb_agg(jsonb_build_object(
      'relation',format('%I.%I',n.nspname,c.relname),'name',t.tgname,'type',t.tgtype,
      'enabled',t.tgenabled,'argumentsHex',encode(t.tgargs,'hex'),'qualifier',t.tgqual::text,'columns',t.tgattr::text)
      ORDER BY n.nspname,c.relname,t.tgname),'[]'::jsonb)
      FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE t.tgfoid=fn AND NOT t.tgisinternal) IS DISTINCT FROM entry->'triggers' THEN
      RAISE EXCEPTION 'CENTRAL_VISITS_ACTIVATE_VOICE_GUARDS_DRIFT';
    END IF;
    IF EXISTS(SELECT 1 FROM pg_proc p,LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      WHERE p.oid=fn AND a.grantee<>p.proowner)
      OR EXISTS(SELECT 1 FROM pg_proc p,pg_roles r WHERE p.oid=fn AND NOT r.rolsuper AND r.oid<>p.proowner
        AND r.rolname<>session_user AND r.rolname<>current_user AND has_function_privilege(r.oid,fn,'EXECUTE')) THEN
      RAISE EXCEPTION 'CENTRAL_VISITS_ACTIVATE_API_NOT_SEALED';
    END IF;
  END LOOP;
  FOREACH signature IN ARRAY signatures LOOP
    IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(installed) e
      WHERE to_regprocedure(e->>'signature')=to_regprocedure(signature)) THEN
      RAISE EXCEPTION 'CENTRAL_VISITS_ACTIVATE_API_MANIFEST_INCOMPLETE';
    END IF;
  END LOOP;
  IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.customer_voices'::regclass AND relrowsecurity)
    OR (SELECT count(*) FROM pg_policy p JOIN (VALUES
      ('voice_v2_private_read','r','(visit_id IS NULL)',NULL),
      ('voice_v2_no_insert','a',NULL,'(visit_id IS NULL)'),
      ('voice_v2_no_update','w','(visit_id IS NULL)','(visit_id IS NULL)'),
      ('voice_v2_no_delete','d','(visit_id IS NULL)',NULL)
    ) expected(name,cmd,qual,chk) ON p.polname=expected.name
      WHERE p.polrelid='public.customer_voices'::regclass AND NOT p.polpermissive
        AND p.polcmd::text=expected.cmd AND pg_get_expr(p.polqual,p.polrelid) IS NOT DISTINCT FROM expected.qual
        AND pg_get_expr(p.polwithcheck,p.polrelid) IS NOT DISTINCT FROM expected.chk
        AND cardinality(p.polroles)=2 AND p.polroles @> ARRAY['anon'::regrole::oid,'authenticated'::regrole::oid])<>4
    OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.customer_voices'::regclass
      AND tgname='crm_foundation_legacy_fields_sealed' AND NOT tgisinternal AND tgenabled='O'
      AND tgfoid='crm_external_private.guard_visit_voice_fields()'::regprocedure AND tgnargs=1
      AND tgtype=23 AND tgqual IS NULL AND tgattr=''::int2vector)
    OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.customer_voices'::regclass
      AND tgname='voice_v2_row_guard' AND NOT tgisinternal AND tgenabled='O'
      AND tgfoid='sales_private.crm_voice_protect_row()'::regprocedure AND tgnargs=0
      AND tgtype=31 AND tgqual IS NULL AND tgattr=''::int2vector)
    OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.crm_settings'::regclass
      AND tgname='external_bridge_activation_seal' AND NOT tgisinternal AND tgenabled='O'
      AND tgfoid='crm_external_private.reject_unreviewed_activation()'::regprocedure AND tgnargs=0
      AND tgtype=23 AND tgqual IS NULL AND tgattr=''::int2vector) THEN
    RAISE EXCEPTION 'CENTRAL_VISITS_ACTIVATE_VOICE_GUARDS_DRIFT';
  END IF;
  SELECT jsonb_build_object('functions',installed,'voicePolicy','(visit_id IS NULL)') INTO before_access;
  INSERT INTO crm_external_private.visit_workflow_activation_permits VALUES(txid_current(),pg_backend_pid(),batch);
  UPDATE public.crm_settings SET visits_enabled=true,visit_sop_enabled=true,customer_voices_enabled=true WHERE id;
  DELETE FROM crm_external_private.visit_workflow_activation_permits
    WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid();
  INSERT INTO crm_external_private.visit_workflow_releases(batch_id,plan_digest,review_reference)
    VALUES(batch,digest,review->>'reviewReference');
  FOREACH signature IN ARRAY signatures LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',to_regprocedure(signature));
  END LOOP;
  GRANT EXECUTE ON FUNCTION public.crm_v2_voice_row_readable(uuid),public.crm_v2_customer_voice_open(text),
    public.crm_v2_customer_voice_submit(text,uuid,text,jsonb) TO anon;
  ALTER POLICY voice_v2_private_read ON public.customer_voices
    USING(visit_id IS NULL OR public.crm_v2_voice_row_readable(visit_id));
  SELECT to_jsonb(s) INTO STRICT after_settings FROM public.crm_settings s WHERE id;
  IF after_settings-ARRAY['visits_enabled','visit_sop_enabled','customer_voices_enabled']
      IS DISTINCT FROM before_settings-ARRAY['visits_enabled','visit_sop_enabled','customer_voices_enabled']
    OR NOT after_settings @> '{"visits_enabled":true,"visit_sop_enabled":true,"customer_voices_enabled":true}'::jsonb
    OR EXISTS(SELECT 1 FROM crm_external_private.visit_workflow_activation_permits
      WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid())
    OR NOT crm_external_private.booking_writer_ready() THEN
    RAISE EXCEPTION 'CENTRAL_VISITS_ACTIVATE_CHANGED_BOOKING_BASELINE';
  END IF;
  SELECT jsonb_build_object(
    'functions',(SELECT jsonb_agg(jsonb_build_object('signature',s,'owner',p.proowner,
      'definitionMd5',md5(pg_get_functiondef(p.oid)),'acl',p.proacl) ORDER BY s)
      FROM unnest(signatures) s JOIN pg_proc p ON p.oid=to_regprocedure(s)),
    'voicePolicy',(SELECT pg_get_expr(polqual,polrelid) FROM pg_policy
      WHERE polrelid='public.customer_voices'::regclass AND polname='voice_v2_private_read'),
    'reviewEvidence',jsonb_build_object('backupReference',review->>'backupReference',
      'clientReleaseReference',review->>'clientReleaseReference','tokenLogReviewReference',review->>'tokenLogReviewReference',
      'evidenceType','operator_attestations_not_automatically_verified')
  ) INTO after_access;
  INSERT INTO crm_external_private.visit_workflow_operations(
    operation_id,operation_kind,review_reference,batch_id,plan_digest,release_digest,
    session_actor,current_actor,settings_before,settings_after,function_acl_before,function_acl_after
  ) VALUES(operation,'activate',review->>'reviewReference',batch,digest,review->>'releaseDigest',
    session_user,current_user,before_settings,after_settings,before_access,after_access);
END;
$reviewed_visit_activate$;
COMMIT;
