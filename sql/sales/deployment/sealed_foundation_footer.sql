-- Prevent broad existing INSERT/UPDATE grants from populating new V2 columns.
-- Legacy fields and legacy RLS remain unchanged. This seal must be explicitly
-- replaced in a later reviewed backfill/activation migration, never by a flag.
CREATE FUNCTION sales_private.reject_sealed_legacy_fields()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $$ BEGIN
  IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(TG_ARGV[0]::jsonb) c
      WHERE to_jsonb(NEW)->c IS DISTINCT FROM 'null'::jsonb) THEN
    RAISE EXCEPTION 'CRM_FOUNDATION_COLUMNS_SEALED';
  END IF;
  RETURN NEW;
END; $$;
DO $legacy_seals$
DECLARE r record; v_columns jsonb;
BEGIN
  FOR r IN SELECT * FROM crm_foundation_relations WHERE nspname='public' AND relname IN ('sales','customer_voices') LOOP
    SELECT jsonb_agg(attname::text ORDER BY attnum) INTO v_columns FROM pg_attribute
    WHERE attrelid=r.oid AND attnum>0 AND NOT attisdropped AND NOT attname=ANY(r.columns);
    IF v_columns IS NULL THEN RAISE EXCEPTION 'CRM_FOUNDATION_EXPECTED_COLUMNS_MISSING'; END IF;
    EXECUTE format('CREATE TRIGGER crm_foundation_legacy_fields_sealed BEFORE INSERT OR UPDATE ON %I.%I FOR EACH ROW EXECUTE FUNCTION sales_private.reject_sealed_legacy_fields(%L)',r.nspname,r.relname,v_columns::text);
  END LOOP;
END;
$legacy_seals$;
CREATE TRIGGER crm_legacy_snapshot_append_only BEFORE UPDATE OR DELETE OR TRUNCATE
ON sales_private.crm_legacy_source_snapshots FOR EACH STATEMENT
EXECUTE FUNCTION account_security_private.prevent_role_review_change();

-- Close ALL new objects, including Supabase/custom inherited default grantees.
-- Existing-object grants/default privileges are never rewritten. Later release
-- explicitly grants reviewed facades only after manifest/backfill/write cutover.
DO $seal$
DECLARE r record; g record; v_target text;
BEGIN
  FOR r IN SELECT p.oid,p.oid::regprocedure AS signature,p.proowner,p.proacl
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname IN ('public','sales_private','account_security_private') AND p.prokind='f'
      AND NOT EXISTS(SELECT 1 FROM crm_foundation_functions b WHERE b.oid=p.oid) LOOP
    FOR g IN SELECT DISTINCT grantee FROM aclexplode(coalesce(r.proacl,acldefault('f',r.proowner))) WHERE grantee<>r.proowner LOOP
      v_target:=CASE WHEN g.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(g.grantee)) END;
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %s',r.signature,v_target);
    END LOOP;
  END LOOP;
  FOR r IN SELECT c.oid,c.relowner,c.relacl,c.relkind,n.nspname,c.relname
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('public','sales_private','account_security_private') AND c.relkind IN ('r','S')
      AND NOT EXISTS(SELECT 1 FROM crm_foundation_relations b WHERE b.oid=c.oid) LOOP
    FOR g IN SELECT DISTINCT grantee FROM aclexplode(coalesce(r.relacl,acldefault(CASE WHEN r.relkind='S' THEN 'S'::"char" ELSE 'r'::"char" END,r.relowner))) WHERE grantee<>r.relowner LOOP
      v_target:=CASE WHEN g.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(g.grantee)) END;
      EXECUTE format('REVOKE ALL ON %s %I.%I FROM %s',CASE WHEN r.relkind='S' THEN 'SEQUENCE' ELSE 'TABLE' END,r.nspname,r.relname,v_target);
    END LOOP;
  END LOOP;
END;
$seal$;
DO $verify$
DECLARE r record; v_hash text; v_added text[]; v_role text;
BEGIN
  IF EXISTS(SELECT 1 FROM account_security_private.reviewed_roles)
    OR EXISTS(SELECT 1 FROM sales_private.crm_user_roles)
    OR EXISTS(SELECT 1 FROM public.crm_settings)
    OR EXISTS(SELECT 1 FROM public.sales_customers)
    OR EXISTS(SELECT 1 FROM public.crm_import_batches)
    OR to_regclass('public.sales_active_plot_booking_idx') IS NOT NULL THEN
    RAISE EXCEPTION 'CRM_FOUNDATION_MUST_REMAIN_EMPTY_SEALED';
  END IF;
  IF EXISTS(SELECT 1 FROM crm_foundation_functions b LEFT JOIN pg_proc p ON p.oid=b.oid
      WHERE p.oid IS NULL OR md5(pg_get_functiondef(p.oid)||coalesce(p.proacl::text,'')||p.proowner::text) IS DISTINCT FROM b.hash)
    OR EXISTS(SELECT 1 FROM crm_foundation_relations b LEFT JOIN pg_class c ON c.oid=b.oid
      WHERE c.oid IS NULL OR (c.relacl,c.relrowsecurity,c.relowner) IS DISTINCT FROM (b.relacl,b.relrowsecurity,b.relowner))
    OR EXISTS(SELECT 1 FROM crm_foundation_triggers b LEFT JOIN pg_trigger t ON t.oid=b.oid
      WHERE t.oid IS NULL OR md5(pg_get_triggerdef(t.oid)||t.tgenabled::text) IS DISTINCT FROM b.hash)
    OR EXISTS(SELECT 1 FROM crm_foundation_policies b LEFT JOIN pg_policy p ON p.oid=b.oid
      WHERE p.oid IS NULL OR md5(to_jsonb(p)::text) IS DISTINCT FROM b.hash) THEN
    RAISE EXCEPTION 'CRM_FOUNDATION_SHARED_OBJECT_CHANGED';
  END IF;
  FOR r IN SELECT * FROM crm_foundation_relations WHERE data_hash IS NOT NULL LOOP
    SELECT coalesce(array_agg(attname::text),'{}'::text[]) INTO v_added FROM pg_attribute
      WHERE attrelid=r.oid AND attnum>0 AND NOT attisdropped AND NOT attname=ANY(r.columns);
    EXECUTE format('SELECT md5(coalesce(jsonb_agg(to_jsonb(t)-$1 ORDER BY (to_jsonb(t)-$1)::text)::text,''[]'')) FROM %I.%I t',r.nspname,r.relname) INTO v_hash USING v_added;
    IF v_hash IS DISTINCT FROM r.data_hash THEN RAISE EXCEPTION 'CRM_FOUNDATION_LEGACY_DATA_CHANGED'; END IF;
  END LOOP;
  FOR v_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role') LOOP
    IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname IN ('public','sales_private','account_security_private') AND p.prokind='f'
        AND NOT EXISTS(SELECT 1 FROM crm_foundation_functions b WHERE b.oid=p.oid)
        AND has_function_privilege(v_role,p.oid,'EXECUTE'))
      OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname IN ('public','sales_private','account_security_private') AND c.relkind='r'
          AND NOT EXISTS(SELECT 1 FROM crm_foundation_relations b WHERE b.oid=c.oid)
          AND (NOT c.relrowsecurity OR has_table_privilege(v_role,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
            OR has_any_column_privilege(v_role,c.oid,'SELECT,INSERT,UPDATE,REFERENCES'))) THEN
      RAISE EXCEPTION 'CRM_FOUNDATION_UNEXPECTED_CLIENT_ACCESS';
    END IF;
  END LOOP;
END;
$verify$;
COMMIT;
