-- LOCAL INSTALLATION CANDIDATE. Not executed or approved for production yet.
-- Do NOT db push this directory; remote account migration timestamps differ.
-- Prerequisites: sealed foundation, reviewed snapshot/materialization, replaced
-- sales and verified evidence reader. This package neither imports nor activates.
-- Attestations below are operator evidence references, not proof by themselves.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='30s';
SET LOCAL transaction_timeout='30s';
DO $commands_review$
DECLARE batch crm_external_private.snapshot_batches%ROWTYPE; rows_seen integer[];
BEGIN
  PERFORM crm_external_private.cutover_operator_check();
  PERFORM pg_advisory_xact_lock(20260925,3);
  IF current_setting('buildtrack.booking_commands_release',true) IS DISTINCT FROM 'central_booking_rows_2_966_v1'
    OR current_setting('buildtrack.booking_commands_project',true) IS DISTINCT FROM 'kbthmdedilswdmmczfay'
    OR length(btrim(coalesce(current_setting('buildtrack.booking_commands_backup',true),'')))<8
    OR length(btrim(coalesce(current_setting('buildtrack.booking_commands_app_review',true),'')))<8
    OR length(btrim(coalesce(current_setting('buildtrack.booking_commands_review',true),'')))<8 THEN
    RAISE EXCEPTION 'CENTRAL_BOOKING_REVIEW_REQUIRED';
  END IF;
  SELECT * INTO batch FROM crm_external_private.snapshot_batches
    WHERE id=NULLIF(current_setting('buildtrack.booking_commands_batch',true),'')::uuid;
  IF batch.id IS NULL
    OR batch.source_sha256 IS DISTINCT FROM current_setting('buildtrack.booking_commands_source_sha256',true)
    OR batch.plan_digest IS DISTINCT FROM current_setting('buildtrack.booking_commands_plan_digest',true)
    OR NOT EXISTS(SELECT 1 FROM crm_external_private.sales_cutover_receipts
      WHERE batch_id=batch.id AND request->>'planDigest'=batch.plan_digest)
    OR EXISTS(SELECT 1 FROM crm_external_private.sales_rollback_receipts WHERE batch_id=batch.id) THEN
    RAISE EXCEPTION 'CENTRAL_BOOKING_SOURCE_CHANGED';
  END IF;
  SELECT array_agg(n ORDER BY n) INTO rows_seen FROM (
    SELECT (r->>'sourceRow')::integer n FROM jsonb_array_elements(batch.payload->'sourceRecords') r
    UNION ALL SELECT r::integer FROM jsonb_array_elements_text(batch.payload->'skippedSourceRows') r
  ) rows;
  IF rows_seen IS DISTINCT FROM ARRAY(SELECT generate_series(2,966)) THEN
    RAISE EXCEPTION 'CENTRAL_BOOKING_SOURCE_WINDOW_REQUIRED';
  END IF;
  IF to_regclass('crm_external_private.booking_writer_releases') IS NOT NULL
    OR to_regprocedure('crm_external_private.sale_history(jsonb)') IS NULL THEN
    RAISE EXCEPTION 'CENTRAL_BOOKING_INSTALL_STATE_CHANGED';
  END IF;
  PERFORM crm_external_private.revalidate_cutover_identity(batch.id,batch.plan_digest);
  IF EXISTS(SELECT 1 FROM public.crm_settings t,LATERAL jsonb_each(to_jsonb(t)) j
    WHERE (j.key LIKE '%\_enabled' ESCAPE '\' OR j.key='booking_cutover_reviewed') AND j.value='true') THEN
    RAISE EXCEPTION 'CENTRAL_BOOKING_DISABLED_REQUIRED';
  END IF;
END;
$commands_review$;
-- DDL/unique-index creation must not wait behind live construction work.
-- Fail and review timing if these short locks cannot be acquired.
LOCK TABLE public.sales,public.plots,public.crm_settings,public.sales_customers,public.lead_project_interests IN SHARE ROW EXCLUSIVE MODE;
CREATE TEMP TABLE central_booking_baseline ON COMMIT DROP AS
SELECT c.oid,c.relacl,c.relrowsecurity,c.relowner,c.relname,NULL::text AS data_hash
FROM pg_class c WHERE c.relnamespace='public'::regnamespace
  AND c.relname IN ('sales','plots','leads','customer_voices','projects','sales_customers','lead_project_interests');
DO $before_commands$
DECLARE r record; result text;
BEGIN
  FOR r IN SELECT * FROM central_booking_baseline LOOP
    EXECUTE format('SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,''[]'')) FROM public.%I t',r.relname) INTO result;
    UPDATE central_booking_baseline SET data_hash=result WHERE oid=r.oid;
  END LOOP;
END;
$before_commands$;
