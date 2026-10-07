-- LOCAL INSTALLATION CANDIDATE, not an import, activation, or production approval.
-- Run after the exact sealed CRM foundation, before source staging/materialization.
-- Do NOT db push this directory: account migration timestamps differ remotely.
-- Evidence settings are operator attestations, not proof of backup/target identity.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='30s';
SET LOCAL transaction_timeout='30s';
DO $external_data_review$
BEGIN
  IF current_setting('buildtrack.external_data_release',true) IS DISTINCT FROM 'sealed_external_data_rows_2_966_v1'
    OR current_setting('buildtrack.external_data_project',true) IS DISTINCT FROM 'kbthmdedilswdmmczfay'
    OR current_setting('buildtrack.external_data_mode',true) IS DISTINCT FROM 'schema_only_no_import'
    OR length(btrim(coalesce(current_setting('buildtrack.external_data_backup',true),'')))<8
    OR length(btrim(coalesce(current_setting('buildtrack.external_data_review',true),'')))<8 THEN
    RAISE EXCEPTION 'EXTERNAL_DATA_REVIEW_REQUIRED';
  END IF;
  IF to_regnamespace('crm_external_private') IS NOT NULL
    OR to_regclass('public.sales_customers') IS NULL
    OR to_regclass('account_security_private.reviewed_roles') IS NULL
    OR to_regprocedure('sales_private.reject_sealed_legacy_fields()') IS NULL THEN
    RAISE EXCEPTION 'EXTERNAL_DATA_FRESH_SEALED_FOUNDATION_REQUIRED';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_class WHERE oid IN ('public.sales_customers'::regclass,
      'public.lead_project_interests'::regclass,'public.sales'::regclass)
    AND relowner<>(SELECT oid FROM pg_roles WHERE rolname=current_user)) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='EXTERNAL_DATA_OPERATOR_REQUIRED';
  END IF;
  PERFORM pg_advisory_xact_lock(20260925,3);
  IF EXISTS(SELECT 1 FROM public.sales_customers) OR EXISTS(SELECT 1 FROM public.lead_project_interests)
    OR EXISTS(SELECT 1 FROM public.crm_import_batches)
    OR EXISTS(SELECT 1 FROM public.crm_settings s,LATERAL jsonb_each(to_jsonb(s)) j
      WHERE (j.key LIKE '%\_enabled' ESCAPE '\' OR j.key='booking_cutover_reviewed') AND j.value='true') THEN
    RAISE EXCEPTION 'EXTERNAL_DATA_EMPTY_DISABLED_CRM_REQUIRED';
  END IF;
END;
$external_data_review$;
-- Fail promptly if occupied; never relax these locks/timeouts to force release.
LOCK TABLE public.sales,public.sales_customers,public.lead_project_interests,public.crm_settings IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.projects,public.plots,public.leads,public.customer_voices,
  account_security_private.reviewed_roles,sales_private.crm_user_roles IN SHARE MODE;
CREATE TEMP TABLE external_data_relations ON COMMIT DROP AS
SELECT c.oid,c.relacl,c.relrowsecurity,c.relowner,n.nspname,c.relname,
  ARRAY(SELECT a.attname::text FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum) AS columns,
  NULL::text AS data_hash
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname IN ('public','sales_private','account_security_private') AND c.relkind IN ('r','S');
CREATE TEMP TABLE external_data_functions ON COMMIT DROP AS
SELECT p.oid,md5(pg_get_functiondef(p.oid)||coalesce(p.proacl::text,'')||p.proowner::text) AS hash
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname IN ('public','sales_private','account_security_private') AND p.prokind='f';
CREATE TEMP TABLE external_data_triggers ON COMMIT DROP AS
SELECT t.oid,t.tgrelid,t.tgname,pg_get_triggerdef(t.oid) AS definition,t.tgenabled
FROM pg_trigger t WHERE t.tgrelid IN (SELECT oid FROM external_data_relations) AND NOT t.tgisinternal;
CREATE TEMP TABLE external_data_policies ON COMMIT DROP AS
SELECT p.oid,md5(to_jsonb(p)::text) AS hash FROM pg_policy p
WHERE p.polrelid IN (SELECT oid FROM external_data_relations);
DO $external_data_before$
DECLARE r record; result text;
BEGIN
  FOR r IN SELECT * FROM external_data_relations WHERE
    (nspname='public' AND relname IN ('projects','plots','leads','sales','customer_voices','sales_customers','lead_project_interests','crm_settings'))
    OR (nspname='account_security_private' AND relname='reviewed_roles')
    OR (nspname='sales_private' AND relname='crm_user_roles') LOOP
    EXECUTE format('SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,''[]'')) FROM %I.%I t',r.nspname,r.relname) INTO result;
    UPDATE external_data_relations SET data_hash=result WHERE oid=r.oid;
  END LOOP;
END;
$external_data_before$;
