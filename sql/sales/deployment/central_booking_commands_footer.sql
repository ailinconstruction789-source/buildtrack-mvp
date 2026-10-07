-- No enable_booking_writer call here: installation and activation are separate.
DO $after_commands$
DECLARE r record; result text; omitted text[];
BEGIN
  FOR r IN SELECT * FROM central_booking_baseline LOOP
    omitted:=CASE r.relname WHEN 'sales' THEN ARRAY['booking_revision','booking_visit_id']
      WHEN 'sales_customers' THEN ARRAY['lifecycle_revision']
      WHEN 'lead_project_interests' THEN ARRAY['lifecycle_revision'] ELSE ARRAY[]::text[] END;
    EXECUTE format('SELECT md5(coalesce(jsonb_agg(to_jsonb(t)-$1 ORDER BY (to_jsonb(t)-$1)::text)::text,''[]'')) FROM public.%I t',r.relname) INTO result USING omitted;
    IF result IS DISTINCT FROM r.data_hash OR EXISTS(SELECT 1 FROM pg_class c WHERE c.oid=r.oid
      AND (c.relacl IS DISTINCT FROM r.relacl OR c.relowner<>r.relowner OR c.relrowsecurity<>r.relrowsecurity)) THEN
      RAISE EXCEPTION 'CENTRAL_BOOKING_SHARED_BASELINE_CHANGED: %',r.relname;
    END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM public.crm_settings t,LATERAL jsonb_each(to_jsonb(t)) j
    WHERE (j.key LIKE '%\_enabled' ESCAPE '\' OR j.key='booking_cutover_reviewed') AND j.value='true')
    OR EXISTS(SELECT 1 FROM crm_external_private.booking_writer_releases) THEN
    RAISE EXCEPTION 'CENTRAL_BOOKING_UNEXPECTED_ACTIVATION';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_proc p,LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    WHERE p.pronamespace='public'::regnamespace AND p.proname IN ('crm_v2_central_search','crm_v2_central_search_capabilities',
      'crm_v2_booking_command','crm_v2_booking_context','crm_v2_project_sales','crm_v2_record_lead_work','crm_v2_change_lead_lifecycle')
      AND a.grantee<>p.proowner) THEN
    RAISE EXCEPTION 'CENTRAL_BOOKING_UNSEALED_API';
  END IF;
END;
$after_commands$;
COMMIT;
