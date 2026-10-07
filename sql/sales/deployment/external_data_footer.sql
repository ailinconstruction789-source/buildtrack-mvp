-- No stage_snapshot/materialize_crm/prepare_booking_release/replace_sales call.
-- Those remain separate operator-reviewed transactions bound to actual source.
DO $external_data_after$
DECLARE r record; result text; added text[]; row_count bigint;
BEGIN
  IF EXISTS(SELECT 1 FROM external_data_functions b LEFT JOIN pg_proc p ON p.oid=b.oid
      WHERE p.oid IS NULL OR md5(pg_get_functiondef(p.oid)||coalesce(p.proacl::text,'')||p.proowner::text) IS DISTINCT FROM b.hash)
    OR EXISTS(SELECT 1 FROM external_data_relations b LEFT JOIN pg_class c ON c.oid=b.oid
      WHERE c.oid IS NULL OR (c.relacl,c.relrowsecurity,c.relowner) IS DISTINCT FROM (b.relacl,b.relrowsecurity,b.relowner))
    OR EXISTS(SELECT 1 FROM external_data_policies b LEFT JOIN pg_policy p ON p.oid=b.oid
      WHERE p.oid IS NULL OR md5(to_jsonb(p)::text) IS DISTINCT FROM b.hash) THEN
    RAISE EXCEPTION 'EXTERNAL_DATA_SHARED_OBJECT_CHANGED';
  END IF;
  -- The sole allowed trigger replacement retains events, arguments and state.
  IF EXISTS(SELECT 1 FROM external_data_triggers b LEFT JOIN pg_trigger t ON t.tgrelid=b.tgrelid AND t.tgname=b.tgname
    WHERE t.oid IS NULL OR t.tgenabled IS DISTINCT FROM b.tgenabled
      OR pg_get_triggerdef(t.oid) IS DISTINCT FROM CASE
        WHEN b.tgrelid='public.sales'::regclass AND b.tgname='crm_foundation_legacy_fields_sealed'
        THEN replace(b.definition,'sales_private.reject_sealed_legacy_fields','crm_external_private.guard_cutover_sale')
        ELSE b.definition END) THEN
    RAISE EXCEPTION 'EXTERNAL_DATA_SHARED_TRIGGER_CHANGED';
  END IF;
  FOR r IN SELECT * FROM external_data_relations WHERE data_hash IS NOT NULL LOOP
    SELECT coalesce(array_agg(attname::text),'{}'::text[]) INTO added FROM pg_attribute
      WHERE attrelid=r.oid AND attnum>0 AND NOT attisdropped AND NOT attname=ANY(r.columns);
    EXECUTE format('SELECT md5(coalesce(jsonb_agg(to_jsonb(t)-$1 ORDER BY (to_jsonb(t)-$1)::text)::text,''[]'')) FROM %I.%I t',r.nspname,r.relname) INTO result USING added;
    IF result IS DISTINCT FROM r.data_hash THEN RAISE EXCEPTION 'EXTERNAL_DATA_SHARED_DATA_CHANGED'; END IF;
  END LOOP;
  FOR r IN SELECT relname FROM pg_class WHERE relnamespace='crm_external_private'::regnamespace AND relkind='r' LOOP
    EXECUTE format('SELECT count(*) FROM crm_external_private.%I',r.relname) INTO row_count;
    IF row_count<>0 THEN RAISE EXCEPTION 'EXTERNAL_DATA_IMPORT_FORBIDDEN'; END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM pg_class c,LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
    WHERE c.relnamespace='crm_external_private'::regnamespace AND c.relkind IN ('r','v') AND a.grantee<>c.relowner)
    OR EXISTS(SELECT 1 FROM pg_class c WHERE c.relnamespace='crm_external_private'::regnamespace AND c.relkind='r' AND NOT c.relrowsecurity)
    OR EXISTS(SELECT 1 FROM pg_proc p,LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      WHERE p.pronamespace='crm_external_private'::regnamespace AND a.grantee<>p.proowner)
    OR EXISTS(SELECT 1 FROM pg_namespace n,LATERAL aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a
      WHERE n.nspname='crm_external_private' AND a.grantee<>n.nspowner) THEN
    RAISE EXCEPTION 'EXTERNAL_DATA_UNSEALED_OBJECT';
  END IF;
  IF EXISTS(SELECT 1 FROM public.crm_settings s,LATERAL jsonb_each(to_jsonb(s)) j
    WHERE (j.key LIKE '%\_enabled' ESCAPE '\' OR j.key='booking_cutover_reviewed') AND j.value='true')
    OR to_regprocedure('crm_external_private.enable_booking_writer(uuid,text,text)') IS NOT NULL
    OR EXISTS(SELECT 1 FROM public.sales WHERE external_booking_id IS NOT NULL OR external_source_stage IS NOT NULL) THEN
    RAISE EXCEPTION 'EXTERNAL_DATA_UNEXPECTED_ACTIVATION';
  END IF;
END;
$external_data_after$;
COMMIT;
