-- DESIGN ONLY. Composed AFTER external replacement and companions 04/05/18/19/22.
-- No remote installer. Activation is an explicit private operator transition.
BEGIN;
DO $draft_only$
BEGIN
  RAISE EXCEPTION 'DESIGN ONLY: external booking writer requires isolated composed verification';
END;
$draft_only$;
SET LOCAL lock_timeout='2s';

CREATE TABLE crm_external_private.booking_writer_releases (
  batch_id uuid PRIMARY KEY REFERENCES crm_external_private.sales_cutover_receipts(batch_id),
  plan_digest text NOT NULL,review_reference text NOT NULL CHECK(length(btrim(review_reference))>0),
  activated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE crm_external_private.booking_writer_permits (
  transaction_id bigint PRIMARY KEY,backend_pid integer NOT NULL,
  actor_id uuid NOT NULL,customer_id uuid NOT NULL,interest_id uuid NOT NULL,sale_id uuid NOT NULL,
  command text NOT NULL CHECK(command IN ('book','cancel'))
);
CREATE TABLE crm_external_private.booking_activation_permits (
  transaction_id bigint PRIMARY KEY,backend_pid integer NOT NULL,batch_id uuid NOT NULL
);
ALTER TABLE crm_external_private.booking_writer_releases ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_external_private.booking_writer_permits ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_external_private.booking_activation_permits ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER booking_writer_release_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
  ON crm_external_private.booking_writer_releases FOR EACH STATEMENT
  EXECUTE FUNCTION account_security_private.prevent_role_review_change();

CREATE UNIQUE INDEX sales_active_plot_booking_idx ON public.sales(plot_id)
  WHERE plot_id IS NOT NULL
    AND COALESCE(crm_stage, lower(contract_status), 'unknown') <> 'cancelled';

CREATE FUNCTION crm_external_private.booking_writer_ready()
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT EXISTS(SELECT 1 FROM crm_external_private.booking_writer_releases w
    WHERE NOT EXISTS(SELECT 1 FROM crm_external_private.sales_rollback_receipts r WHERE r.batch_id=w.batch_id))
    AND COALESCE((SELECT central_intake_enabled AND lead_work_enabled AND lead_lifecycle_enabled
      AND booking_enabled AND booking_cutover_reviewed FROM public.crm_settings WHERE id),false);
$$;

CREATE FUNCTION crm_external_private.begin_booking_write(p_actor uuid,p_customer uuid,p_interest uuid,p_sale uuid,p_command text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE owner_id uuid; actor_role text;
BEGIN
  IF NOT crm_external_private.booking_writer_ready() THEN RAISE EXCEPTION 'CRM_BOOKING_SETUP_REQUIRED'; END IF;
  actor_role:=public.crm_v2_role();
  SELECT owner_user_id INTO owner_id FROM public.lead_project_interests WHERE id=p_interest AND customer_id=p_customer;
  IF p_actor IS DISTINCT FROM auth.uid() OR actor_role NOT IN ('admin','sales') OR owner_id IS NULL
    OR (actor_role='sales' AND p_actor IS DISTINCT FROM owner_id)
    OR p_sale IS NULL OR p_command NOT IN ('book','cancel')
    OR NOT EXISTS(SELECT 1 FROM sales_private.crm_user_roles WHERE user_id=owner_id AND role='sales' AND is_active) THEN
    RAISE EXCEPTION 'CRM_BOOKING_FORBIDDEN';
  END IF;
  INSERT INTO crm_external_private.booking_writer_permits VALUES(txid_current(),pg_backend_pid(),p_actor,p_customer,p_interest,p_sale,p_command);
END;
$$;
CREATE FUNCTION crm_external_private.end_booking_write()
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
  DELETE FROM crm_external_private.booking_writer_permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid();
$$;

CREATE FUNCTION crm_external_private.booking_sale_allowed(p_operation text,p_old jsonb,p_new jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE permit crm_external_private.booking_writer_permits%ROWTYPE;
  mutable text[]:=ARRAY['crm_stage','contract_status','cancelled_at','cancellation_category','cancellation_reason','booking_revision','updated_at'];
BEGIN
  SELECT * INTO permit FROM crm_external_private.booking_writer_permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid();
  IF permit.actor_id IS DISTINCT FROM auth.uid() OR permit.transaction_id IS NULL
    OR NOT crm_external_private.booking_writer_ready() OR p_operation NOT IN ('INSERT','UPDATE')
    OR p_new->>'id' IS DISTINCT FROM permit.sale_id::text
    OR p_new->>'project_interest_id' IS DISTINCT FROM permit.interest_id::text THEN RETURN false; END IF;
  IF p_operation='INSERT' THEN
    RETURN permit.command='book' AND p_old IS NULL AND p_new->>'crm_stage'='booked'
      AND p_new->>'contract_status'='Reserved' AND p_new->>'external_booking_id' IS NULL
      AND p_new->>'external_source_stage' IS NULL AND p_new->>'lead_id' IS NULL
      AND p_new->>'booking_route' IN ('visited','without_visit')
      AND (p_new->>'booking_round')::integer>0 AND p_new->>'booked_at' IS NOT NULL;
  END IF;
  RETURN permit.command='cancel' AND p_old->>'crm_stage' IN
    ('booked','contracted','downpayment','document_prep','loan_submitted','loan_rejected','loan_approved','transfer_pending')
    AND p_new->>'crm_stage'='cancelled' AND p_new->>'contract_status'='Cancelled'
    AND p_new->>'cancelled_at' IS NOT NULL AND p_new->>'cancellation_category' IS NOT NULL
    AND length(btrim(p_new->>'cancellation_reason'))>0
    AND p_old-mutable=p_new-mutable;
END;
$$;

CREATE FUNCTION crm_external_private.booking_interest_allowed(p_old jsonb,p_new jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE permit crm_external_private.booking_writer_permits%ROWTYPE;
  mutable text[]:=ARRAY['lifecycle_revision','updated_at','workspace_state','activated_at','activation_reason'];
BEGIN
  SELECT * INTO permit FROM crm_external_private.booking_writer_permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid();
  IF permit.actor_id IS DISTINCT FROM auth.uid() OR permit.transaction_id IS NULL
    OR NOT crm_external_private.booking_writer_ready()
    OR p_new->>'id' IS DISTINCT FROM permit.interest_id::text
    OR p_new->>'customer_id' IS DISTINCT FROM permit.customer_id::text THEN RETURN false; END IF;
  IF permit.command='cancel' THEN
    RETURN p_old-ARRAY['lifecycle_revision','updated_at']=p_new-ARRAY['lifecycle_revision','updated_at'];
  END IF;
  RETURN p_old-mutable=p_new-mutable AND p_new->>'workspace_state'='project_active'
    AND ((p_old->>'workspace_state'='central_interest' AND p_new->>'activation_reason'='booking' AND p_new->>'activated_at' IS NOT NULL)
      OR (p_old->>'workspace_state'='project_active' AND p_new->'activated_at'=p_old->'activated_at'
        AND p_new->'activation_reason'=p_old->'activation_reason'));
END;
$$;

CREATE FUNCTION crm_external_private.booking_activation_allowed(p_settings jsonb)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT EXISTS(SELECT 1 FROM crm_external_private.booking_activation_permits p
      WHERE p.transaction_id=txid_current() AND p.backend_pid=pg_backend_pid())
    AND NOT EXISTS(SELECT 1 FROM jsonb_each(p_settings) j
      WHERE (j.key LIKE '%\_enabled' ESCAPE '\' OR j.key='booking_cutover_reviewed')
        AND j.value='true' AND j.key NOT IN
          ('central_intake_enabled','lead_work_enabled','lead_lifecycle_enabled','booking_enabled','booking_cutover_reviewed'));
$$;

-- Protect only sales stock fields. Construction-only UPDATEs return unchanged
-- before inspecting private state; no construction grants or values are edited.
CREATE FUNCTION crm_external_private.guard_booking_plot_stock()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE permit crm_external_private.booking_writer_permits%ROWTYPE; expected_occupied boolean;
BEGIN
  IF TG_OP='INSERT' THEN
    IF EXISTS(SELECT 1 FROM crm_external_private.booking_writer_releases)
      AND (NEW.has_customer IS DISTINCT FROM false OR lower(btrim(NEW.sale_status))='transferred') THEN
      RAISE EXCEPTION 'EXTERNAL_WRITER_STOCK_COMMAND_REQUIRED';
    END IF;
    RETURN NEW;
  END IF;
  IF EXISTS(SELECT 1 FROM crm_external_private.booking_writer_releases)
    AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.project_name IS DISTINCT FROM OLD.project_name)
    AND EXISTS(SELECT 1 FROM public.sales WHERE plot_id=OLD.id) THEN
    RAISE EXCEPTION 'EXTERNAL_WRITER_STOCK_COMMAND_REQUIRED';
  END IF;
  -- Existing construction pause/resume is NOT a transfer or occupancy change.
  -- Delegate its authorization to the unchanged plot policies, not CRM roles:
  -- other departments are not required to enroll in the Sales role registry.
  IF NEW.id IS NOT DISTINCT FROM OLD.id AND NEW.project_name IS NOT DISTINCT FROM OLD.project_name
    AND NEW.has_customer IS NOT DISTINCT FROM OLD.has_customer
    AND COALESCE(OLD.sale_status,'') IN ('','active','ready_for_sale')
    AND NEW.sale_status IN ('active','ready_for_sale') THEN RETURN NEW; END IF;
  IF NEW.has_customer IS NOT DISTINCT FROM OLD.has_customer
    AND NEW.sale_status IS NOT DISTINCT FROM OLD.sale_status THEN RETURN NEW; END IF;
  IF NOT EXISTS(SELECT 1 FROM crm_external_private.booking_writer_releases) THEN RETURN NEW; END IF;
  SELECT * INTO permit FROM crm_external_private.booking_writer_permits
    WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid();
  IF permit.transaction_id IS NULL OR permit.actor_id IS DISTINCT FROM auth.uid()
    OR NOT EXISTS(SELECT 1 FROM public.sales s WHERE s.id=permit.sale_id
      AND s.project_interest_id=permit.interest_id AND s.plot_id=NEW.id)
    OR NEW.id IS DISTINCT FROM OLD.id OR NEW.project_name IS DISTINCT FROM OLD.project_name
    OR NEW.sale_status IS DISTINCT FROM OLD.sale_status THEN
    RAISE EXCEPTION 'EXTERNAL_WRITER_STOCK_COMMAND_REQUIRED';
  END IF;
  SELECT EXISTS(SELECT 1 FROM public.sales WHERE plot_id=NEW.id
    AND COALESCE(crm_stage,lower(contract_status),'unknown')<>'cancelled') INTO expected_occupied;
  IF NEW.has_customer IS DISTINCT FROM expected_occupied THEN RAISE EXCEPTION 'EXTERNAL_WRITER_STOCK_EVIDENCE_REQUIRED'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER external_booking_plot_stock BEFORE INSERT OR UPDATE ON public.plots
  FOR EACH ROW EXECUTE FUNCTION crm_external_private.guard_booking_plot_stock();

CREATE FUNCTION crm_external_private.enable_booking_writer(p_batch uuid,p_plan_digest text,p_review_ref text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE receipt crm_external_private.sales_cutover_receipts%ROWTYPE; s public.sales%ROWTYPE;
  old_row jsonb; g record; column_record record; target text;
BEGIN
  PERFORM crm_external_private.cutover_operator_check();
  PERFORM pg_advisory_xact_lock(20260925,3);
  LOCK TABLE public.sales,public.plots,public.crm_settings IN SHARE ROW EXCLUSIVE MODE;
  IF p_review_ref IS NULL OR length(btrim(p_review_ref))=0 THEN RAISE EXCEPTION 'EXTERNAL_WRITER_REVIEW_REQUIRED'; END IF;
  SELECT * INTO receipt FROM crm_external_private.sales_cutover_receipts WHERE batch_id=p_batch;
  IF receipt.batch_id IS NULL OR receipt.request->>'planDigest' IS DISTINCT FROM p_plan_digest
    OR EXISTS(SELECT 1 FROM crm_external_private.sales_rollback_receipts WHERE batch_id=p_batch)
    OR EXISTS(SELECT 1 FROM crm_external_private.booking_writer_releases)
    OR to_regprocedure('public.crm_v2_booking_command(uuid,jsonb)') IS NULL
    OR to_regprocedure('public.crm_v2_project_sales(text,text,text,integer)') IS NULL
    OR to_regprocedure('public.crm_v2_central_search(jsonb,integer)') IS NULL
    OR to_regprocedure('public.crm_v2_central_search_capabilities()') IS NULL
    OR to_regprocedure('account_security_private.current_crm_role()') IS NULL THEN
    RAISE EXCEPTION 'EXTERNAL_WRITER_PREREQUISITES_REQUIRED';
  END IF;
  PERFORM crm_external_private.revalidate_cutover_identity(p_batch,p_plan_digest);
  IF EXISTS(SELECT 1 FROM public.crm_settings t,LATERAL jsonb_each(to_jsonb(t)) j
    WHERE (j.key LIKE '%\_enabled' ESCAPE '\' OR j.key='booking_cutover_reviewed') AND j.value='true') THEN
    RAISE EXCEPTION 'EXTERNAL_WRITER_DISABLED_CRM_REQUIRED';
  END IF;
  IF (SELECT count(*) FROM public.sales)<>jsonb_array_length(receipt.after_sales) THEN
    RAISE EXCEPTION 'EXTERNAL_WRITER_SALE_BASELINE_CHANGED';
  END IF;
  IF crm_external_private.cutover_plot_flags(receipt.after_plot_flags) IS DISTINCT FROM receipt.after_plot_flags THEN
    RAISE EXCEPTION 'EXTERNAL_WRITER_PLOT_BASELINE_CHANGED';
  END IF;
  FOR s IN SELECT * FROM public.sales LOOP
    SELECT e INTO old_row FROM jsonb_array_elements(receipt.after_sales) e WHERE e->>'id'=s.id::text;
    IF old_row IS NULL OR to_jsonb(s)-ARRAY['booking_revision','booking_visit_id'] IS DISTINCT FROM old_row THEN
      RAISE EXCEPTION 'EXTERNAL_WRITER_SALE_BASELINE_CHANGED';
    END IF;
    PERFORM crm_external_private.sale_history(to_jsonb(s));
  END LOOP;
  -- Retire table and column DML grants for every non-owner legacy client.
  -- SELECT and every other department's tables/permissions stay unchanged.
  FOR g IN SELECT DISTINCT a.grantee FROM pg_class c,
      LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
      WHERE c.oid='public.sales'::regclass AND a.grantee<>c.relowner
      UNION SELECT DISTINCT a.grantee FROM pg_attribute col JOIN pg_class c ON c.oid=col.attrelid,
      LATERAL aclexplode(col.attacl) a WHERE c.oid='public.sales'::regclass AND a.grantee<>c.relowner LOOP
    target:=CASE WHEN g.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(g.grantee)) END;
    EXECUTE format('REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON public.sales FROM %s',target);
    FOR column_record IN SELECT attname FROM pg_attribute WHERE attrelid='public.sales'::regclass AND attnum>0 AND NOT attisdropped LOOP
      EXECUTE format('REVOKE INSERT (%I),UPDATE (%I),REFERENCES (%I) ON public.sales FROM %s',column_record.attname,column_record.attname,column_record.attname,target);
    END LOOP;
  END LOOP;
  INSERT INTO crm_external_private.booking_activation_permits VALUES(txid_current(),pg_backend_pid(),p_batch);
  INSERT INTO public.crm_settings(id,central_intake_enabled,lead_work_enabled,lead_lifecycle_enabled,booking_enabled,booking_cutover_reviewed)
    VALUES(true,true,true,true,true,true) ON CONFLICT(id) DO UPDATE SET central_intake_enabled=true,
      lead_work_enabled=true,lead_lifecycle_enabled=true,booking_enabled=true,booking_cutover_reviewed=true;
  DELETE FROM crm_external_private.booking_activation_permits WHERE transaction_id=txid_current();
  INSERT INTO crm_external_private.booking_writer_releases(batch_id,plan_digest,review_reference) VALUES(p_batch,p_plan_digest,p_review_ref);
  GRANT EXECUTE ON FUNCTION public.crm_v2_role(),account_security_private.current_crm_role(),public.crm_v2_capabilities(),
    public.crm_v2_central_snapshot(integer,integer),public.crm_v2_create_customer(uuid,jsonb),
    public.crm_v2_central_search_capabilities(),public.crm_v2_central_search(jsonb,integer),
    public.crm_v2_booking_capabilities(),public.crm_v2_booking_search(text,integer),
    public.crm_v2_booking_context(uuid,integer),public.crm_v2_booking_command(uuid,jsonb),
    public.crm_v2_project_sales_capabilities(),public.crm_v2_project_sales(text,text,text,integer) TO authenticated;
  RETURN jsonb_build_object('batchId',p_batch,'bookingEnabled',true,'notificationsEnabled',false);
END;
$$;

-- Inherited Supabase/custom default grants are additive: revoke every grantee.
-- Companion 04/05/18/19/22 grants are deliberately closed again in this release.
-- Their flags are dependencies of booking, not permission to expose extra work.
DO $companion_seal$
DECLARE r record; g record; col record; target text;
BEGIN
  FOR r IN SELECT p.oid,p.proowner,p.proacl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE (n.nspname='sales_private' AND p.proname IN ('crm_work_timestamp','crm_work_text',
      'crm_booking_protect_sale','crm_booking_uuid','crm_booking_imported_history','crm_booking_external_ready'))
      OR (n.nspname='public' AND p.proname IN ('crm_v2_lead_work_capabilities','crm_v2_lead_work_snapshot',
        'crm_v2_record_lead_work','crm_v2_lead_lifecycle_capabilities','crm_v2_lead_lifecycle_context',
        'crm_v2_change_lead_lifecycle','crm_v2_booking_capabilities','crm_v2_booking_search',
        'crm_v2_booking_context','crm_v2_booking_command','crm_v2_project_sales_capabilities','crm_v2_project_sales',
        'crm_v2_central_search_capabilities','crm_v2_central_search')) LOOP
    FOR g IN SELECT DISTINCT grantee FROM aclexplode(coalesce(r.proacl,acldefault('f',r.proowner))) WHERE grantee<>r.proowner LOOP
      target:=CASE WHEN g.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(g.grantee)) END;
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %s',r.oid::regprocedure,target);
    END LOOP;
  END LOOP;
  FOR r IN SELECT c.oid,c.relowner,c.relacl,n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE (n.nspname='public' AND c.relname='crm_next_actions')
      OR (n.nspname='sales_private' AND c.relname IN ('lead_work_command_requests','booking_command_requests','booking_write_permits')) LOOP
    FOR g IN SELECT DISTINCT grantee FROM aclexplode(coalesce(r.relacl,acldefault('r',r.relowner))) WHERE grantee<>r.relowner
      UNION SELECT DISTINCT a.grantee FROM pg_attribute c,LATERAL aclexplode(c.attacl) a
        WHERE c.attrelid=r.oid AND a.grantee<>r.relowner LOOP
      target:=CASE WHEN g.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(g.grantee)) END;
      EXECUTE format('REVOKE ALL ON %I.%I FROM %s',r.nspname,r.relname,target);
      FOR col IN SELECT attname FROM pg_attribute WHERE attrelid=r.oid AND attnum>0 AND NOT attisdropped LOOP
        EXECUTE format('REVOKE ALL (%I) ON %I.%I FROM %s',col.attname,r.nspname,r.relname,target);
      END LOOP;
    END LOOP;
  END LOOP;
END;
$companion_seal$;

DO $seal$
DECLARE r record; g record; target text;
BEGIN
  FOR r IN SELECT c.oid,c.relowner,c.relacl,c.relname FROM pg_class c WHERE c.relnamespace='crm_external_private'::regnamespace
    AND c.relname IN ('booking_writer_releases','booking_writer_permits','booking_activation_permits') LOOP
    FOR g IN SELECT DISTINCT grantee FROM aclexplode(coalesce(r.relacl,acldefault('r',r.relowner))) WHERE grantee<>r.relowner LOOP
      target:=CASE WHEN g.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(g.grantee)) END;
      EXECUTE format('REVOKE ALL ON crm_external_private.%I FROM %s',r.relname,target);
    END LOOP;
  END LOOP;
  FOR r IN SELECT p.oid,p.proowner,p.proacl FROM pg_proc p WHERE p.pronamespace='crm_external_private'::regnamespace
    AND p.proname IN ('booking_writer_ready','begin_booking_write','end_booking_write','booking_sale_allowed',
      'booking_interest_allowed','booking_activation_allowed','guard_booking_plot_stock','enable_booking_writer') LOOP
    FOR g IN SELECT DISTINCT grantee FROM aclexplode(coalesce(r.proacl,acldefault('f',r.proowner))) WHERE grantee<>r.proowner LOOP
      target:=CASE WHEN g.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(g.grantee)) END;
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %s',r.oid::regprocedure,target);
    END LOOP;
  END LOOP;
END;
$seal$;
ROLLBACK;
