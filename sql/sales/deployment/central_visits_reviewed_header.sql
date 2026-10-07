-- REVIEWED PREPARATION, NOT AUTHORIZATION TO INSTALL OR ACTIVATE.
-- Fails without explicit operator inputs and a fresh exact metadata manifest.
-- No production activation command is supplied in this package.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='30s';
SET LOCAL transaction_timeout='30s';
DO $reviewed_operator$
DECLARE cfg jsonb:=nullif(current_setting('buildtrack.visit_operation',true),'')::jsonb;
BEGIN
  PERFORM crm_external_private.cutover_operator_check();
  IF cfg IS NULL OR jsonb_typeof(cfg)<>'object'
    OR cfg->>'operationKind' IS DISTINCT FROM 'install'
    OR cfg->>'expectedDatabase' IS DISTINCT FROM current_database()
    OR cfg->>'expectedSessionActor' IS DISTINCT FROM session_user::text
    OR cfg->>'releaseDigest' IS DISTINCT FROM '__RELEASE_DIGEST__'
    OR length(btrim(coalesce(cfg->>'reviewReference','')))<8
    OR coalesce(cfg->>'operationId','') !~ '^[0-9a-f-]{36}$'
    OR coalesce(cfg->>'batchId','') !~ '^[0-9a-f-]{36}$'
    OR coalesce(cfg->>'planDigest','') !~ '^[0-9a-f]{64}$'
    OR jsonb_typeof(cfg->'expectedPreflight') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'CENTRAL_VISITS_REVIEW_INPUT_REQUIRED';
  END IF;
  PERFORM (cfg->>'operationId')::uuid;
  IF NOT pg_try_advisory_xact_lock(20260929,23) THEN RAISE EXCEPTION 'CENTRAL_VISITS_REVIEW_BUSY'; END IF;
  IF NOT crm_external_private.booking_writer_ready() OR NOT EXISTS(
    SELECT 1 FROM crm_external_private.snapshot_batches b JOIN crm_external_private.booking_writer_releases w ON w.batch_id=b.id
      AND w.plan_digest=b.plan_digest WHERE b.id=(cfg->>'batchId')::uuid AND b.plan_digest=cfg->>'planDigest'
      AND NOT EXISTS(SELECT 1 FROM crm_external_private.sales_rollback_receipts r WHERE r.batch_id=b.id)) THEN
    RAISE EXCEPTION 'CENTRAL_VISITS_REVIEW_BATCH_CHANGED';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname||'.'||p.proname IN (__NEW_FUNCTIONS__))
    OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname||'.'||c.relname IN (__NEW_TABLES__)) THEN
    RAISE EXCEPTION 'CENTRAL_VISITS_REVIEW_OBJECT_COLLISION';
  END IF;
END;
$reviewed_operator$;
-- These seven existing tables receive DDL. No broad lock or customer
-- row scan on construction plots, sales, imported identities or other departments.
LOCK TABLE public.crm_settings,public.customer_voices,public.lead_appointments,
  public.lead_visits,public.house_visit_checklist_runs,public.house_visit_checklist_items,
  sales_private.visit_submission_tokens IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE central_visits_observed_preflight ON COMMIT DROP AS
__PREFLIGHT_SELECT__
DO $reviewed_manifest$
DECLARE cfg jsonb:=current_setting('buildtrack.visit_operation')::jsonb;
BEGIN
  IF (SELECT central_visits_preflight FROM central_visits_observed_preflight) IS DISTINCT FROM cfg->'expectedPreflight' THEN
    RAISE EXCEPTION 'CENTRAL_VISITS_REVIEW_METADATA_CHANGED';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_proc p,LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    WHERE p.pronamespace='public'::regnamespace AND p.proname IN
      ('crm_v2_lead_work_capabilities','crm_v2_lead_work_snapshot','crm_v2_record_lead_work',
       'crm_v2_lead_lifecycle_capabilities','crm_v2_lead_lifecycle_context','crm_v2_change_lead_lifecycle')
      AND a.grantee<>p.proowner) THEN RAISE EXCEPTION 'CENTRAL_VISITS_GENERAL_WORK_MUST_REMAIN_SEALED'; END IF;
END;
$reviewed_manifest$;
CREATE TEMP TABLE central_visits_existing_functions ON COMMIT DROP AS SELECT oid FROM pg_proc;
CREATE TEMP TABLE central_visits_existing_relations ON COMMIT DROP AS SELECT oid FROM pg_class;
CREATE TEMP TABLE central_visits_settings_before ON COMMIT DROP AS SELECT to_jsonb(s) AS value FROM public.crm_settings s;
CREATE TEMP TABLE central_visits_preserved_functions ON COMMIT DROP AS
SELECT p.oid,pg_get_functiondef(p.oid) AS definition,p.proacl,p.proowner FROM pg_proc p
WHERE p.oid IN (SELECT to_regprocedure(x->>'signature') FROM central_visits_observed_preflight,
 jsonb_array_elements(central_visits_preflight->'functionMetadata') x)
 AND p.oid<>'crm_external_private.reject_unreviewed_activation()'::regprocedure;
CREATE TEMP TABLE central_visits_shared_before ON COMMIT DROP AS
SELECT c.oid,c.relname,c.relacl,c.relowner,c.relrowsecurity FROM pg_class c
WHERE c.oid IN (SELECT to_regclass(x->>'name') FROM central_visits_observed_preflight,
 jsonb_array_elements(central_visits_preflight->'relations') x);
