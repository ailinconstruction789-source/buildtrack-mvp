-- LOCAL CANDIDATE. Not approved for production. Never db push this directory:
-- installed account/directory migrations have different remote timestamps.
-- Empty, sealed CRM foundation ONLY. No role seed, backfill, activation or Cron.
-- Evidence settings are operator attestations, not proof of target or authority.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='30s';
-- PostgreSQL 17+: cap the entire transaction, not only each DDL statement.
SET LOCAL transaction_timeout='30s';
DO $release$
BEGIN
  IF current_setting('buildtrack.crm_foundation_release',true) IS DISTINCT FROM 'sealed_crm_v1_20260928'
    OR current_setting('buildtrack.crm_foundation_project',true) IS DISTINCT FROM 'kbthmdedilswdmmczfay'
    OR length(btrim(coalesce(current_setting('buildtrack.crm_foundation_backup',true),'')))<8
    OR length(btrim(coalesce(current_setting('buildtrack.crm_foundation_auth_compatibility',true),'')))<8
    OR current_setting('buildtrack.crm_foundation_legacy_clients_reviewed',true) IS DISTINCT FROM 'yes'
    OR current_setting('buildtrack.crm_foundation_mode',true) IS DISTINCT FROM 'sealed_no_backfill' THEN
    RAISE EXCEPTION 'CRM_FOUNDATION_REVIEW_REQUIRED';
  END IF;
  IF to_regnamespace('sales_private') IS NOT NULL
    OR to_regclass('account_security_private.reviewed_roles') IS NOT NULL THEN
    RAISE EXCEPTION 'CRM_FOUNDATION_EXISTING_INSTALL_REVIEW_REQUIRED';
  END IF;
END;
$release$;
-- DDL already requires exclusive locks on these two legacy tables. Abort if
-- busy; no retries with relaxed timeouts. Other shared tables stay read-only.
LOCK TABLE public.sales,public.customer_voices IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.projects,public.plots,public.leads IN SHARE MODE;
DO $counts$
DECLARE v_counts jsonb;
BEGIN
  SELECT jsonb_build_object('projects',(SELECT count(*) FROM public.projects),
    'plots',(SELECT count(*) FROM public.plots),'leads',(SELECT count(*) FROM public.leads),
    'sales',(SELECT count(*) FROM public.sales),'voices',(SELECT count(*) FROM public.customer_voices)) INTO v_counts;
  IF NULLIF(current_setting('buildtrack.crm_foundation_counts',true),'')::jsonb IS DISTINCT FROM v_counts THEN
    RAISE EXCEPTION 'CRM_FOUNDATION_COUNT_BASELINE_CHANGED';
  END IF;
END;
$counts$;
CREATE TEMP TABLE crm_foundation_relations ON COMMIT DROP AS
SELECT c.oid,c.relacl,c.relrowsecurity,c.relowner,n.nspname,c.relname,
  ARRAY(SELECT a.attname::text FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum) AS columns,
  NULL::text AS data_hash
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname IN ('public','account_security_private') AND c.relkind IN ('r','S');
CREATE TEMP TABLE crm_foundation_functions ON COMMIT DROP AS
SELECT p.oid,md5(pg_get_functiondef(p.oid)||coalesce(p.proacl::text,'')||p.proowner::text) AS hash
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname IN ('public','account_security_private') AND p.prokind='f';
CREATE TEMP TABLE crm_foundation_triggers ON COMMIT DROP AS
SELECT t.oid,md5(pg_get_triggerdef(t.oid)||t.tgenabled::text) AS hash FROM pg_trigger t
WHERE t.tgrelid IN (SELECT oid FROM crm_foundation_relations) AND NOT t.tgisinternal;
CREATE TEMP TABLE crm_foundation_policies ON COMMIT DROP AS
SELECT p.oid,md5(to_jsonb(p)::text) AS hash FROM pg_policy p
WHERE p.polrelid IN (SELECT oid FROM crm_foundation_relations);
DO $snapshots$
DECLARE r record; v_hash text;
BEGIN
  FOR r IN SELECT * FROM crm_foundation_relations WHERE
    (nspname='public' AND relname IN ('projects','plots','leads','sales','customer_voices'))
    OR (nspname='account_security_private' AND relname='reviewed_admins') LOOP
    EXECUTE format('SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,''[]'')) FROM %I.%I t',r.nspname,r.relname) INTO v_hash;
    UPDATE crm_foundation_relations SET data_hash=v_hash WHERE oid=r.oid;
  END LOOP;
END;
$snapshots$;
