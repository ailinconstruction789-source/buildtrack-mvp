-- Seal every new object against inherited Supabase/custom default grants. Keep
-- all existing APIs/identity seals untouched; activation is separate and local.
DO $visits_seal$
DECLARE r record; g record; target text;
BEGIN
  FOR r IN SELECT p.oid,p.proowner,p.proacl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname IN ('public','sales_private','crm_external_private')
      AND NOT EXISTS(SELECT 1 FROM central_visits_existing_functions old WHERE old.oid=p.oid) LOOP
    FOR g IN SELECT DISTINCT grantee FROM aclexplode(coalesce(r.proacl,acldefault('f',r.proowner))) WHERE grantee<>r.proowner LOOP
      target:=CASE WHEN g.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(g.grantee)) END;
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %s',r.oid::regprocedure,target);
    END LOOP;
  END LOOP;
  FOR r IN SELECT c.oid,c.relowner,c.relacl,n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('sales_private','crm_external_private') AND c.relkind='r'
      AND NOT EXISTS(SELECT 1 FROM central_visits_existing_relations old WHERE old.oid=c.oid) LOOP
    FOR g IN SELECT DISTINCT grantee FROM aclexplode(coalesce(r.relacl,acldefault('r',r.relowner))) WHERE grantee<>r.relowner LOOP
      target:=CASE WHEN g.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(g.grantee)) END;
      EXECUTE format('REVOKE ALL ON %I.%I FROM %s',r.nspname,r.relname,target);
    END LOOP;
  END LOOP;
END;
$visits_seal$;
DO $visits_after$
DECLARE r record; result text;
BEGIN
  FOR r IN SELECT * FROM central_visits_shared_before LOOP
    EXECUTE format('SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,''[]'')) FROM public.%I t',r.relname) INTO result;
    IF result IS DISTINCT FROM r.data_hash OR EXISTS(SELECT 1 FROM pg_class c WHERE c.oid=r.oid
      AND (c.relacl IS DISTINCT FROM r.relacl OR c.relowner<>r.relowner OR c.relrowsecurity<>r.relrowsecurity)) THEN
      RAISE EXCEPTION 'CENTRAL_VISITS_SHARED_BASELINE_CHANGED: %',r.relname;
    END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM central_visits_preserved_functions WHERE definition IS DISTINCT FROM pg_get_functiondef(oid)) THEN
    RAISE EXCEPTION 'CENTRAL_VISITS_EXISTING_GUARD_CHANGED'; END IF;
  IF (SELECT to_jsonb(s)-ARRAY['visits_enabled','visit_sop_enabled','customer_voices_enabled','voice_token_ttl_hours'] FROM public.crm_settings s WHERE id)
      IS DISTINCT FROM (SELECT value FROM central_visits_settings_before)
    OR EXISTS(SELECT 1 FROM public.crm_settings WHERE visits_enabled OR visit_sop_enabled OR customer_voices_enabled)
    OR EXISTS(SELECT 1 FROM crm_external_private.visit_workflow_releases) THEN
    RAISE EXCEPTION 'CENTRAL_VISITS_UNEXPECTED_ACTIVATION'; END IF;
  IF EXISTS(SELECT 1 FROM pg_proc p,LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    WHERE p.pronamespace IN ('public'::regnamespace,'sales_private'::regnamespace,'crm_external_private'::regnamespace)
      AND NOT EXISTS(SELECT 1 FROM central_visits_existing_functions old WHERE old.oid=p.oid)
      AND a.grantee<>p.proowner) THEN RAISE EXCEPTION 'CENTRAL_VISITS_UNSEALED_API'; END IF;
END;
$visits_after$;
COMMIT;
