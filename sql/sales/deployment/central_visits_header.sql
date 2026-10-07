-- LOCAL SYNTHETIC INSTALLATION CANDIDATE ONLY. No production execution path.
-- Additive to the installed foundation/external-import/booking chain. Does not
-- reinstall SQL04/05, import identities, activate features or edit legacy data.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='30s';
SET LOCAL transaction_timeout='30s';
DO $visits_install_review$
BEGIN
  IF current_database() !~ '^buildtrack_sales_runtime_[a-f0-9]+$'
    OR session_user !~ '^runtime_[a-f0-9]+$'
    OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet
    OR current_setting('buildtrack.synthetic_runtime',true) IS DISTINCT FROM 'on'
    OR current_setting('buildtrack.central_visits_release',true) IS DISTINCT FROM 'local_synthetic_v1' THEN
    RAISE EXCEPTION 'CENTRAL_VISITS_LOCAL_SYNTHETIC_ONLY';
  END IF;
  PERFORM crm_external_private.cutover_operator_check();
  PERFORM pg_advisory_xact_lock(20260929,23);
  IF NOT crm_external_private.booking_writer_ready()
    OR to_regprocedure('public.crm_v2_record_lead_work(uuid,jsonb)') IS NULL
    OR to_regprocedure('public.crm_v2_lead_work_snapshot(uuid,uuid)') IS NULL
    OR to_regprocedure('public.crm_v2_visits_command(uuid,jsonb)') IS NOT NULL
    OR to_regclass('crm_external_private.visit_workflow_releases') IS NOT NULL THEN
    RAISE EXCEPTION 'CENTRAL_VISITS_INSTALLED_BOOKING_CHAIN_REQUIRED';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.customer_voices'::regclass
    AND tgname='crm_foundation_legacy_fields_sealed' AND tgenabled IN ('O','A')
    AND tgfoid='sales_private.reject_sealed_legacy_fields()'::regprocedure)
    OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.crm_settings'::regclass
      AND tgname='external_bridge_activation_seal' AND tgenabled IN ('O','A')
      AND tgfoid='crm_external_private.reject_unreviewed_activation()'::regprocedure) THEN
    RAISE EXCEPTION 'CENTRAL_VISITS_EXPECTED_SEALS_REQUIRED';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_proc p,LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    WHERE p.pronamespace='public'::regnamespace AND p.proname IN
      ('crm_v2_lead_work_capabilities','crm_v2_lead_work_snapshot','crm_v2_record_lead_work',
       'crm_v2_lead_lifecycle_capabilities','crm_v2_lead_lifecycle_context','crm_v2_change_lead_lifecycle')
      AND a.grantee<>p.proowner) THEN RAISE EXCEPTION 'CENTRAL_VISITS_GENERAL_WORK_MUST_REMAIN_SEALED'; END IF;
END;
$visits_install_review$;
LOCK TABLE public.crm_settings,public.customer_voices,public.lead_appointments,
  public.lead_visits,public.house_visit_checklist_runs IN SHARE ROW EXCLUSIVE MODE;
CREATE TEMP TABLE central_visits_existing_functions ON COMMIT DROP AS SELECT oid FROM pg_proc;
CREATE TEMP TABLE central_visits_existing_relations ON COMMIT DROP AS SELECT oid FROM pg_class;
CREATE TEMP TABLE central_visits_settings_before ON COMMIT DROP AS SELECT to_jsonb(s) AS value FROM public.crm_settings s;
CREATE TEMP TABLE central_visits_preserved_functions ON COMMIT DROP AS
SELECT oid,pg_get_functiondef(oid) AS definition FROM pg_proc WHERE oid IN
  ('crm_external_private.guard_materialized_history()'::regprocedure,
   'crm_external_private.booking_interest_allowed(jsonb,jsonb)'::regprocedure,
   'crm_external_private.booking_activation_allowed(jsonb)'::regprocedure,
   'public.crm_v2_record_lead_work(uuid,jsonb)'::regprocedure,
   'public.crm_v2_change_lead_lifecycle(uuid,jsonb)'::regprocedure);
CREATE TEMP TABLE central_visits_shared_before ON COMMIT DROP AS
SELECT c.oid,c.relname,c.relacl,c.relowner,c.relrowsecurity,NULL::text AS data_hash
FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relname IN
  ('sales','plots','leads','customer_voices','projects','sales_customers','lead_project_interests');
DO $visits_before$
DECLARE r record; result text;
BEGIN
  FOR r IN SELECT * FROM central_visits_shared_before LOOP
    EXECUTE format('SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,''[]'')) FROM public.%I t',r.relname) INTO result;
    UPDATE central_visits_shared_before SET data_hash=result WHERE oid=r.oid;
  END LOOP;
END;
$visits_before$;
