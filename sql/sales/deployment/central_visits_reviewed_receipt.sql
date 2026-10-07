CREATE TABLE crm_external_private.visit_workflow_operations (
  operation_id uuid PRIMARY KEY,
  operation_kind text NOT NULL CHECK(operation_kind IN ('install','activate','disable')),
  review_reference text NOT NULL CHECK(length(btrim(review_reference))>=8),
  batch_id uuid NOT NULL,
  plan_digest text NOT NULL CHECK(plan_digest ~ '^[0-9a-f]{64}$'),
  release_digest text NOT NULL CHECK(release_digest ~ '^[0-9a-f]{64}$'),
  performed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  session_actor name NOT NULL,current_actor name NOT NULL,
  settings_before jsonb NOT NULL,settings_after jsonb NOT NULL,
  function_acl_before jsonb NOT NULL,function_acl_after jsonb NOT NULL
);
ALTER TABLE crm_external_private.visit_workflow_operations ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER visit_workflow_operations_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
  ON crm_external_private.visit_workflow_operations FOR EACH STATEMENT
  EXECUTE FUNCTION account_security_private.prevent_role_review_change();
-- POST INSTALL CHECKS
DO $reviewed_after$
BEGIN
  IF EXISTS(SELECT 1 FROM central_visits_preserved_functions old JOIN pg_proc p ON p.oid=old.oid
      WHERE old.definition IS DISTINCT FROM pg_get_functiondef(p.oid) OR old.proacl IS DISTINCT FROM p.proacl OR old.proowner<>p.proowner)
    OR EXISTS(SELECT 1 FROM central_visits_preserved_functions old WHERE NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=old.oid))
    OR EXISTS(SELECT 1 FROM central_visits_shared_before old JOIN pg_class c ON c.oid=old.oid
      WHERE old.relacl IS DISTINCT FROM c.relacl OR old.relowner<>c.relowner OR old.relrowsecurity<>c.relrowsecurity) THEN
    RAISE EXCEPTION 'CENTRAL_VISITS_REVIEW_BASELINE_CHANGED';
  END IF;
  IF (SELECT to_jsonb(s)-ARRAY['visits_enabled','visit_sop_enabled','customer_voices_enabled','voice_token_ttl_hours'] FROM public.crm_settings s WHERE id)
    IS DISTINCT FROM (SELECT value FROM central_visits_settings_before)
    OR EXISTS(SELECT 1 FROM public.crm_settings WHERE visits_enabled OR visit_sop_enabled OR customer_voices_enabled)
    OR EXISTS(SELECT 1 FROM crm_external_private.visit_workflow_releases) THEN
    RAISE EXCEPTION 'CENTRAL_VISITS_UNEXPECTED_ACTIVATION';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace,
      LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      WHERE p.pronamespace IN ('public'::regnamespace,'sales_private'::regnamespace,'crm_external_private'::regnamespace)
        AND n.nspname||'.'||p.proname IN (__NEW_FUNCTIONS__)
        AND NOT EXISTS(SELECT 1 FROM central_visits_existing_functions old WHERE old.oid=p.oid) AND a.grantee<>p.proowner)
    OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace,
      LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
      WHERE c.relnamespace IN ('sales_private'::regnamespace,'crm_external_private'::regnamespace) AND c.relkind='r'
        AND n.nspname||'.'||c.relname IN (__NEW_TABLES__)
        AND NOT EXISTS(SELECT 1 FROM central_visits_existing_relations old WHERE old.oid=c.oid) AND a.grantee<>c.relowner) THEN
    RAISE EXCEPTION 'CENTRAL_VISITS_UNSEALED_API';
  END IF;
  IF (SELECT count(*) FROM pg_policy WHERE polrelid='public.customer_voices'::regclass AND NOT polpermissive
    AND polname IN ('voice_v2_private_read','voice_v2_no_insert','voice_v2_no_update','voice_v2_no_delete'))<>4 THEN
    RAISE EXCEPTION 'CENTRAL_VISITS_REVIEW_VOICE_POLICY_REQUIRED';
  END IF;
END;
$reviewed_after$;
INSERT INTO crm_external_private.visit_workflow_operations
  (operation_id,operation_kind,review_reference,batch_id,plan_digest,release_digest,session_actor,current_actor,
   settings_before,settings_after,function_acl_before,function_acl_after)
SELECT (cfg->>'operationId')::uuid,'install',cfg->>'reviewReference',(cfg->>'batchId')::uuid,cfg->>'planDigest',
 '__RELEASE_DIGEST__',session_user,current_user,
 (SELECT value FROM central_visits_settings_before),(SELECT to_jsonb(s) FROM public.crm_settings s WHERE id),
 (SELECT central_visits_preflight->'functionMetadata' FROM central_visits_observed_preflight),
 (SELECT coalesce(jsonb_agg(jsonb_build_object('signature',format('%I.%I(%s)',n.nspname,p.proname,oidvectortypes(p.proargtypes)),
    'owner',pg_get_userbyid(p.proowner),'definitionMd5',md5(pg_get_functiondef(p.oid)),'acl',p.proacl,
    'triggers',(SELECT coalesce(jsonb_agg(jsonb_build_object(
      'relation',format('%I.%I',tn.nspname,tc.relname),'name',t.tgname,'type',t.tgtype,'enabled',t.tgenabled,
      'argumentsHex',encode(t.tgargs,'hex'),'qualifier',t.tgqual::text,'columns',t.tgattr::text)
      ORDER BY tn.nspname,tc.relname,t.tgname),'[]'::jsonb)
      FROM pg_trigger t JOIN pg_class tc ON tc.oid=t.tgrelid JOIN pg_namespace tn ON tn.oid=tc.relnamespace
      WHERE t.tgfoid=p.oid AND NOT t.tgisinternal))
    ORDER BY n.nspname,p.proname,oidvectortypes(p.proargtypes)),'[]'::jsonb)
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE (n.nspname||'.'||p.proname IN (__NEW_FUNCTIONS__)
      AND NOT EXISTS(SELECT 1 FROM central_visits_existing_functions old WHERE old.oid=p.oid))
      OR n.nspname||'.'||p.proname='crm_external_private.reject_unreviewed_activation')
FROM (SELECT current_setting('buildtrack.visit_operation')::jsonb AS cfg) q;
COMMIT;
