-- Additive local adapter. Imported history remains immutable; a new next action,
-- appointment, Visit, checklist or Voice is current work, not historical evidence.
CREATE TABLE crm_external_private.visit_workflow_activation_permits (
  transaction_id bigint PRIMARY KEY,backend_pid integer NOT NULL,batch_id uuid NOT NULL
);
CREATE TABLE crm_external_private.visit_workflow_releases (
  batch_id uuid PRIMARY KEY REFERENCES crm_external_private.snapshot_batches(id),
  plan_digest text NOT NULL,review_reference text NOT NULL,activated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE crm_external_private.visit_workflow_activation_permits ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_external_private.visit_workflow_releases ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER visit_workflow_release_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
  ON crm_external_private.visit_workflow_releases FOR EACH STATEMENT
  EXECUTE FUNCTION account_security_private.prevent_role_review_change();

CREATE FUNCTION crm_external_private.visit_workflow_activation_allowed(p_old jsonb,p_new jsonb)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT p_old IS NOT NULL AND crm_external_private.booking_writer_ready()
    AND EXISTS(SELECT 1 FROM crm_external_private.visit_workflow_activation_permits p
      JOIN crm_external_private.booking_writer_releases w ON w.batch_id=p.batch_id
      WHERE p.transaction_id=txid_current() AND p.backend_pid=pg_backend_pid())
    AND p_old-ARRAY['visits_enabled','visit_sop_enabled','customer_voices_enabled']
      =p_new-ARRAY['visits_enabled','visit_sop_enabled','customer_voices_enabled']
    AND p_new @> '{"visits_enabled":true,"visit_sop_enabled":true,"customer_voices_enabled":true}'::jsonb
    AND NOT EXISTS(SELECT 1 FROM jsonb_each(p_new) j
      WHERE (j.key LIKE '%\_enabled' ESCAPE '\' OR j.key='booking_cutover_reviewed') AND j.value='true'
        AND j.key NOT IN ('central_intake_enabled','lead_work_enabled','lead_lifecycle_enabled',
          'booking_enabled','booking_cutover_reviewed','visits_enabled','visit_sop_enabled','customer_voices_enabled'));
$$;

-- Preserve the booking activation gate; admit only the separate private Visit
-- permit and exactly the three new switches. No GUC is a write capability.
CREATE OR REPLACE FUNCTION crm_external_private.reject_unreviewed_activation()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE allowed boolean:=false;
BEGIN
  IF EXISTS(SELECT 1 FROM jsonb_each(to_jsonb(NEW)) j
    WHERE (j.key LIKE '%\_enabled' ESCAPE '\' OR j.key='booking_cutover_reviewed') AND j.value='true') THEN
    allowed:=crm_external_private.booking_activation_allowed(to_jsonb(NEW));
    IF allowed IS DISTINCT FROM true AND TG_OP='UPDATE' THEN
      allowed:=crm_external_private.visit_workflow_activation_allowed(to_jsonb(OLD),to_jsonb(NEW));
    END IF;
    IF allowed IS DISTINCT FROM true THEN RAISE EXCEPTION 'EXTERNAL_CRM_ACTIVATION_REVIEW_REQUIRED'; END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Preserve the original new-column NULL seal for legacy Voice writes. The only
-- exception is SQL26's atomic submitted Voice insert with its private permit.
CREATE FUNCTION crm_external_private.guard_visit_voice_fields()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF TG_OP='INSERT' AND NEW.visit_id IS NOT NULL AND EXISTS(
    SELECT 1 FROM sales_private.voice_write_permits p WHERE p.transaction_id=txid_current()
      AND p.backend_pid=pg_backend_pid() AND p.visit_id=NEW.visit_id AND p.voice_id=NEW.id)
    AND EXISTS(SELECT 1 FROM public.crm_settings WHERE id AND central_intake_enabled
      AND lead_work_enabled AND lead_lifecycle_enabled AND visits_enabled AND customer_voices_enabled)
    AND NEW.crm_submission_state='submitted' AND NEW.crm_form_version='customer_voices_v1'
    AND NEW.crm_submitted_by_customer IS TRUE THEN RETURN NEW; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(TG_ARGV[0]::jsonb) c
    WHERE to_jsonb(NEW)->c IS DISTINCT FROM 'null'::jsonb) THEN
    RAISE EXCEPTION 'CRM_FOUNDATION_COLUMNS_SEALED';
  END IF;
  RETURN NEW;
END;
$$;
DO $voice_seal_adapter$
DECLARE definition text;
BEGIN
  SELECT pg_get_triggerdef(oid) INTO definition FROM pg_trigger WHERE tgrelid='public.customer_voices'::regclass
    AND tgname='crm_foundation_legacy_fields_sealed' AND NOT tgisinternal
    AND tgfoid='sales_private.reject_sealed_legacy_fields()'::regprocedure;
  IF definition IS NULL THEN RAISE EXCEPTION 'CENTRAL_VISITS_EXPECTED_VOICE_SEAL_REQUIRED'; END IF;
  DROP TRIGGER crm_foundation_legacy_fields_sealed ON public.customer_voices;
  EXECUTE replace(definition,'sales_private.reject_sealed_legacy_fields','crm_external_private.guard_visit_voice_fields');
END;
$voice_seal_adapter$;

-- While sealed, do not make legacy SELECT depend on EXECUTE of a new helper.
-- The helper and its original restrictive predicate are enabled atomically.
ALTER POLICY voice_v2_private_read ON public.customer_voices USING(visit_id IS NULL);

CREATE FUNCTION public.crm_v2_visit_follow_up_capabilities()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT jsonb_build_object('contract_version','visit_follow_up_v1','read_contract_version','lead_work_read_v2',
    'enabled',COALESCE(auth.uid() IS NOT NULL AND public.crm_v2_role() IN ('sales','admin','owner')
      AND (SELECT central_intake_enabled AND lead_work_enabled AND lead_lifecycle_enabled
        AND visits_enabled AND visit_sop_enabled FROM public.crm_settings WHERE id),false));
$$;

CREATE FUNCTION public.crm_v2_visit_follow_up_context(p_customer_id uuid,p_interest_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE snapshot jsonb; actor_role text:=public.crm_v2_role();
BEGIN
  IF auth.uid() IS NULL OR COALESCE(actor_role,'') NOT IN ('sales','admin','owner') THEN RAISE EXCEPTION 'CRM_WORK_FORBIDDEN'; END IF;
  IF (public.crm_v2_visit_follow_up_capabilities()->>'enabled')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'CRM_WORK_SETUP_REQUIRED'; END IF;
  IF p_customer_id IS NULL OR p_interest_id IS NULL THEN RAISE EXCEPTION 'CRM_WORK_INVALID_INPUT'; END IF;
  snapshot:=public.crm_v2_lead_work_snapshot(p_customer_id,p_interest_id);
  RETURN jsonb_set(snapshot,'{canWrite}',to_jsonb(actor_role='sales' AND (snapshot->>'canWrite')::boolean));
END;
$$;

CREATE FUNCTION public.crm_v2_visit_follow_up_command(p_request_id uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE actor_id uuid:=auth.uid(); customer_id_value uuid; interest_id_value uuid;
  owner_id uuid; actor_role text; enabled boolean;
BEGIN
  IF actor_id IS NULL OR public.crm_v2_role() IS DISTINCT FROM 'sales' THEN RAISE EXCEPTION 'CRM_WORK_FORBIDDEN'; END IF;
  SELECT central_intake_enabled AND lead_work_enabled AND lead_lifecycle_enabled
    AND visits_enabled AND visit_sop_enabled INTO enabled FROM public.crm_settings WHERE id FOR SHARE;
  IF enabled IS DISTINCT FROM true THEN RAISE EXCEPTION 'CRM_WORK_SETUP_REQUIRED'; END IF;
  IF p_request_id IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object'
    OR octet_length(p_payload::text)>16384 OR p_payload->>'command' IS DISTINCT FROM 'set_next_action'
    OR jsonb_typeof(p_payload->'customerId') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_payload->'interestId') IS DISTINCT FROM 'string'
    OR (p_payload->>'customerId') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    OR (p_payload->>'interestId') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
    RAISE EXCEPTION 'CRM_WORK_INVALID_INPUT';
  END IF;
  customer_id_value:=(p_payload->>'customerId')::uuid; interest_id_value:=(p_payload->>'interestId')::uuid;
  -- Same request/scope/role lock order as the delegated writer. Rechecking owner
  -- before delegation also prevents replay by a former owner or an Admin.
  PERFORM pg_advisory_xact_lock(hashtextextended('lead-work:'||actor_id::text||':'||p_request_id::text,0));
  PERFORM 1 FROM public.sales_customers WHERE id=customer_id_value FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CRM_WORK_NOT_FOUND'; END IF;
  SELECT owner_user_id INTO owner_id FROM public.lead_project_interests
    WHERE id=interest_id_value AND customer_id=customer_id_value FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CRM_WORK_NOT_FOUND'; END IF;
  IF owner_id IS DISTINCT FROM actor_id THEN RAISE EXCEPTION 'CRM_WORK_FORBIDDEN'; END IF;
  SELECT role INTO actor_role FROM sales_private.crm_user_roles WHERE user_id=actor_id AND is_active FOR SHARE;
  IF actor_role IS DISTINCT FROM 'sales' THEN RAISE EXCEPTION 'CRM_WORK_FORBIDDEN'; END IF;
  RETURN public.crm_v2_record_lead_work(p_request_id,p_payload);
END;
$$;

-- Private, INVOKER, LOCAL-ONLY rehearsal activation. The installer never calls it.
-- A future production release requires its own reviewed operator procedure.
CREATE FUNCTION crm_external_private.enable_visit_workflow(p_batch uuid,p_plan_digest text,p_review_ref text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF current_database() !~ '^buildtrack_sales_runtime_[a-f0-9]+$'
    OR session_user !~ '^runtime_[a-f0-9]+$'
    OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet
    OR current_setting('buildtrack.synthetic_runtime',true) IS DISTINCT FROM 'on'
    OR current_setting('buildtrack.central_visits_release',true) IS DISTINCT FROM 'local_synthetic_v1' THEN
    RAISE EXCEPTION 'CENTRAL_VISITS_LOCAL_SYNTHETIC_ONLY';
  END IF;
  PERFORM crm_external_private.cutover_operator_check();
  IF length(btrim(COALESCE(p_review_ref,'')))<8 OR p_batch IS NULL OR p_plan_digest IS NULL
    OR NOT EXISTS(SELECT 1 FROM crm_external_private.booking_writer_releases w
      JOIN crm_external_private.snapshot_batches b ON b.id=w.batch_id
      WHERE w.batch_id=p_batch AND w.plan_digest=p_plan_digest AND b.plan_digest=p_plan_digest)
    OR EXISTS(SELECT 1 FROM crm_external_private.sales_rollback_receipts WHERE batch_id=p_batch)
    OR NOT crm_external_private.booking_writer_ready() THEN RAISE EXCEPTION 'CENTRAL_VISITS_REVIEW_REQUIRED'; END IF;
  PERFORM 1 FROM public.crm_settings WHERE id FOR UPDATE;
  IF NOT FOUND OR EXISTS(SELECT 1 FROM crm_external_private.visit_workflow_releases) THEN
    RAISE EXCEPTION 'CENTRAL_VISITS_INSTALL_STATE_CHANGED'; END IF;
  INSERT INTO crm_external_private.visit_workflow_activation_permits VALUES(txid_current(),pg_backend_pid(),p_batch);
  UPDATE public.crm_settings SET visits_enabled=true,visit_sop_enabled=true,customer_voices_enabled=true WHERE id;
  DELETE FROM crm_external_private.visit_workflow_activation_permits WHERE transaction_id=txid_current();
  INSERT INTO crm_external_private.visit_workflow_releases(batch_id,plan_digest,review_reference) VALUES(p_batch,p_plan_digest,p_review_ref);
  GRANT EXECUTE ON FUNCTION public.crm_v2_visits_capabilities(),public.crm_v2_visits_context(uuid,uuid,integer,integer,integer),
    public.crm_v2_visits_command(uuid,jsonb),public.crm_v2_visit_sop_capabilities(),
    public.crm_v2_visit_sop_context(uuid,uuid,uuid,uuid,integer),public.crm_v2_record_visit_sop(uuid,jsonb),
    public.crm_v2_customer_voices_capabilities(),public.crm_v2_customer_voices_context(uuid,uuid,uuid),
    public.crm_v2_customer_voices_command(uuid,jsonb),public.crm_v2_visit_follow_up_capabilities(),
    public.crm_v2_visit_follow_up_context(uuid,uuid),public.crm_v2_visit_follow_up_command(uuid,jsonb) TO authenticated;
  GRANT EXECUTE ON FUNCTION public.crm_v2_voice_row_readable(uuid),public.crm_v2_customer_voice_open(text),
    public.crm_v2_customer_voice_submit(text,uuid,text,jsonb) TO anon,authenticated;
  ALTER POLICY voice_v2_private_read ON public.customer_voices
    USING(visit_id IS NULL OR public.crm_v2_voice_row_readable(visit_id));
  RETURN jsonb_build_object('visitsEnabled',true,'visitSopEnabled',true,'customerVoicesEnabled',true,
    'generalLeadWorkEnabled',false,'lifecycleCommandsEnabled',false,'notificationsEnabled',false,'localSyntheticOnly',true);
END;
$$;
