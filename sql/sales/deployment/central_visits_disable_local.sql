-- LOCAL SYNTHETIC REHEARSAL ONLY: disable access, never undo collected data.
-- Not a production migration or a restore script. Re-enabling needs new review.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='30s';
DO $disable_guard$
DECLARE batch uuid; digest text;
BEGIN
  IF current_database() !~ '^buildtrack_sales_runtime_[a-f0-9]+$'
    OR session_user !~ '^runtime_[a-f0-9]+$'
    OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet
    OR current_setting('buildtrack.synthetic_runtime',true) IS DISTINCT FROM 'on'
    OR current_setting('buildtrack.central_visits_disable',true) IS DISTINCT FROM 'local_synthetic_v1' THEN
    RAISE EXCEPTION 'CENTRAL_VISITS_DISABLE_LOCAL_ONLY';
  END IF;
  PERFORM crm_external_private.cutover_operator_check();
  PERFORM pg_advisory_xact_lock(20260929,23);
  PERFORM 1 FROM public.crm_settings WHERE id FOR UPDATE;
  IF NOT FOUND OR NOT crm_external_private.booking_writer_ready()
    OR (SELECT count(*) FROM crm_external_private.visit_workflow_releases)<>1 THEN
    RAISE EXCEPTION 'CENTRAL_VISITS_DISABLE_STATE_CHANGED';
  END IF;
  SELECT v.batch_id,v.plan_digest INTO batch,digest
    FROM crm_external_private.visit_workflow_releases v
    JOIN crm_external_private.booking_writer_releases w USING(batch_id,plan_digest)
    JOIN crm_external_private.snapshot_batches b ON b.id=v.batch_id AND b.plan_digest=v.plan_digest
    WHERE NOT EXISTS(SELECT 1 FROM crm_external_private.sales_rollback_receipts r WHERE r.batch_id=v.batch_id);
  IF batch IS NULL OR digest IS NULL THEN RAISE EXCEPTION 'CENTRAL_VISITS_DISABLE_REVIEW_MISMATCH'; END IF;
  -- Existing operator-only booking permit admits returning to the booking-only
  -- setting set. It does not grant an application caller any new capability.
  INSERT INTO crm_external_private.booking_activation_permits VALUES(txid_current(),pg_backend_pid(),batch);
END;
$disable_guard$;
CREATE TEMP TABLE visit_disable_settings_before ON COMMIT DROP AS
  SELECT to_jsonb(s) AS value FROM public.crm_settings s WHERE id;
UPDATE public.crm_settings SET visits_enabled=false,visit_sop_enabled=false,customer_voices_enabled=false WHERE id;
DELETE FROM crm_external_private.booking_activation_permits
  WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid();
-- Remove the policy dependency before sealing its helper. Legacy Voice reads
-- stay usable. Existing V2 answers remain stored but unavailable through here.
ALTER POLICY voice_v2_private_read ON public.customer_voices USING(visit_id IS NULL);
DO $seal_visit_apis$
DECLARE signature text; fn oid; owner_id oid; g record; target text;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'public.crm_v2_visits_capabilities()',
    'public.crm_v2_visits_context(uuid,uuid,integer,integer,integer)',
    'public.crm_v2_visits_command(uuid,jsonb)',
    'public.crm_v2_visit_sop_capabilities()',
    'public.crm_v2_visit_sop_context(uuid,uuid,uuid,uuid,integer)',
    'public.crm_v2_record_visit_sop(uuid,jsonb)',
    'public.crm_v2_customer_voices_capabilities()',
    'public.crm_v2_customer_voices_context(uuid,uuid,uuid)',
    'public.crm_v2_customer_voices_command(uuid,jsonb)',
    'public.crm_v2_visit_follow_up_capabilities()',
    'public.crm_v2_visit_follow_up_context(uuid,uuid)',
    'public.crm_v2_visit_follow_up_command(uuid,jsonb)',
    'public.crm_v2_voice_row_readable(uuid)',
    'public.crm_v2_customer_voice_open(text)',
    'public.crm_v2_customer_voice_submit(text,uuid,text,jsonb)'
  ] LOOP
    fn:=to_regprocedure(signature);
    IF fn IS NULL THEN RAISE EXCEPTION 'CENTRAL_VISITS_DISABLE_API_MISSING: %',signature; END IF;
    SELECT proowner INTO owner_id FROM pg_proc WHERE oid=fn;
    FOR g IN SELECT DISTINCT grantee FROM pg_proc p,
      LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      WHERE p.oid=fn AND a.grantee<>owner_id LOOP
      target:=CASE WHEN g.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(g.grantee)) END;
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %s',fn::regprocedure,target);
    END LOOP;
  END LOOP;
END;
$seal_visit_apis$;
DO $disable_after$
BEGIN
  IF (SELECT to_jsonb(s)-ARRAY['visits_enabled','visit_sop_enabled','customer_voices_enabled'] FROM public.crm_settings s WHERE id)
      IS DISTINCT FROM (SELECT value-ARRAY['visits_enabled','visit_sop_enabled','customer_voices_enabled'] FROM visit_disable_settings_before)
    OR EXISTS(SELECT 1 FROM public.crm_settings WHERE visits_enabled OR visit_sop_enabled OR customer_voices_enabled)
    OR EXISTS(SELECT 1 FROM crm_external_private.booking_activation_permits
      WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid())
    OR NOT crm_external_private.booking_writer_ready() THEN
    RAISE EXCEPTION 'CENTRAL_VISITS_DISABLE_CHANGED_BOOKING_BASELINE';
  END IF;
END;
$disable_after$;
COMMIT;
