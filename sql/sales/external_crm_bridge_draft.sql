-- LOCAL DESIGN ONLY: materialize reviewed historical identities, NOT stock cutover.
-- Uses real CRM tables after the sealed foundation, without changing sales/plots.
BEGIN;
DO $draft_only$
BEGIN
  RAISE EXCEPTION 'DESIGN ONLY: external CRM bridge requires isolated verification and separate cutover review';
END;
$draft_only$;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='30s';

DO $preflight$
BEGIN
  IF to_regclass('crm_external_private.snapshot_batches') IS NULL
    OR to_regclass('public.sales_customers') IS NULL
    OR to_regclass('account_security_private.reviewed_roles') IS NULL
    OR to_regprocedure('sales_private.reject_sealed_legacy_fields()') IS NULL THEN
    RAISE EXCEPTION 'EXTERNAL_BRIDGE_SEALED_FOUNDATION_REQUIRED';
  END IF;
  IF EXISTS(SELECT 1 FROM public.crm_settings s,LATERAL jsonb_each(to_jsonb(s)) j
    WHERE (j.key LIKE '%\_enabled' ESCAPE '\' OR j.key='booking_cutover_reviewed') AND j.value='true') THEN
    RAISE EXCEPTION 'EXTERNAL_BRIDGE_DISABLED_CRM_REQUIRED';
  END IF;
  IF EXISTS(SELECT 1 FROM public.sales_customers) OR EXISTS(SELECT 1 FROM public.lead_project_interests) THEN
    RAISE EXCEPTION 'EXTERNAL_BRIDGE_EMPTY_CRM_REVIEW_REQUIRED';
  END IF;
END;
$preflight$;

ALTER TABLE public.sales_customers
  ADD COLUMN external_snapshot_batch_id uuid,
  ADD COLUMN external_customer_key text,
  ADD CONSTRAINT crm_customer_external_fk FOREIGN KEY(external_snapshot_batch_id,external_customer_key)
    REFERENCES crm_external_private.customer_candidates(batch_id,entity_key) MATCH FULL ON DELETE RESTRICT,
  ADD CONSTRAINT crm_customer_external_unique UNIQUE(external_snapshot_batch_id,external_customer_key),
  DROP CONSTRAINT crm_customer_origin_check;
-- Keep the existing live and legacy DB branches. External history is NOT a
-- fabricated legacy Lead. Exactly one complete provenance branch is mandatory.
ALTER TABLE public.sales_customers ADD CONSTRAINT crm_customer_origin_check CHECK (
  (record_origin='live' AND legacy_source_lead_id IS NULL AND external_snapshot_batch_id IS NULL
    AND external_customer_key IS NULL AND lead_created_at IS NOT NULL AND intake_status<>'legacy_unclassified')
  OR (record_origin='legacy_import' AND (
    (legacy_source_lead_id IS NOT NULL AND external_snapshot_batch_id IS NULL AND external_customer_key IS NULL)
    OR (legacy_source_lead_id IS NULL AND external_snapshot_batch_id IS NOT NULL AND external_customer_key IS NOT NULL)
  ))
);
-- Existing phone evidence constraint stays unchanged: live requires a real phone.
ALTER TABLE public.lead_project_interests
  ALTER COLUMN interest_created_at DROP NOT NULL,
  ADD COLUMN external_snapshot_batch_id uuid,
  ADD COLUMN external_interest_key text,
  ADD CONSTRAINT crm_interest_external_fk FOREIGN KEY(external_snapshot_batch_id,external_interest_key)
    REFERENCES crm_external_private.interest_candidates(batch_id,entity_key) MATCH FULL ON DELETE RESTRICT,
  ADD CONSTRAINT crm_interest_external_unique UNIQUE(external_snapshot_batch_id,external_interest_key),
  DROP CONSTRAINT lead_project_interests_engagement_status_check;
ALTER TABLE public.lead_project_interests ADD CONSTRAINT crm_interest_created_evidence_check CHECK (
  interest_created_at IS NOT NULL OR (external_snapshot_batch_id IS NOT NULL AND external_interest_key IS NOT NULL)
);
ALTER TABLE public.lead_project_interests ADD CONSTRAINT lead_project_interests_engagement_status_check CHECK (
  engagement_status IN ('new','contacted','considering','follow_up','nurture','lost')
  OR (engagement_status='legacy_unclassified' AND external_snapshot_batch_id IS NOT NULL AND external_interest_key IS NOT NULL)
);

CREATE TABLE crm_external_private.bridge_receipts (
  batch_id uuid PRIMARY KEY REFERENCES crm_external_private.snapshot_batches(id) ON DELETE RESTRICT,
  request jsonb NOT NULL,
  response jsonb NOT NULL,
  executed_by name NOT NULL DEFAULT current_user,
  executed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE crm_external_private.booking_crm_links (
  batch_id uuid NOT NULL,
  booking_key text NOT NULL,
  customer_id uuid REFERENCES public.sales_customers(id) ON DELETE RESTRICT,
  interest_id uuid,
  plot_id text REFERENCES public.plots(id) ON DELETE RESTRICT,
  PRIMARY KEY(batch_id,booking_key),
  FOREIGN KEY(batch_id,booking_key) REFERENCES crm_external_private.booking_history(batch_id,entity_key) ON DELETE RESTRICT,
  FOREIGN KEY(interest_id,customer_id) REFERENCES public.lead_project_interests(id,customer_id) ON DELETE RESTRICT,
  CHECK (interest_id IS NULL OR customer_id IS NOT NULL)
);
CREATE INDEX booking_crm_customer_idx ON crm_external_private.booking_crm_links(customer_id);
CREATE INDEX booking_crm_interest_idx ON crm_external_private.booking_crm_links(interest_id,customer_id);
CREATE INDEX booking_crm_plot_idx ON crm_external_private.booking_crm_links(plot_id);

CREATE FUNCTION crm_external_private.guard_materialized_history()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE c crm_external_private.customer_candidates%ROWTYPE; i crm_external_private.interest_candidates%ROWTYPE; allowed boolean:=false;
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') AND OLD.external_snapshot_batch_id IS NOT NULL THEN
    IF TG_TABLE_NAME='lead_project_interests' AND TG_OP='UPDATE'
      AND to_regprocedure('crm_external_private.booking_interest_allowed(jsonb,jsonb)') IS NOT NULL THEN
      EXECUTE 'SELECT crm_external_private.booking_interest_allowed($1,$2)' INTO allowed USING to_jsonb(OLD),to_jsonb(NEW);
      IF allowed IS TRUE THEN RETURN NEW; END IF;
    END IF;
    RAISE EXCEPTION 'EXTERNAL_CRM_HISTORY_SEALED';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF NEW.external_snapshot_batch_id IS NULL THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME='sales_customers' THEN
    SELECT * INTO c FROM crm_external_private.customer_candidates
      WHERE batch_id=NEW.external_snapshot_batch_id AND entity_key=NEW.external_customer_key;
    IF c.entity_key IS NULL OR c.payload->'reviewHolds'<>'[]' OR c.owner_login IS NULL
      OR NEW.customer_name IS DISTINCT FROM c.customer_name OR NEW.phone IS NOT NULL
      OR NEW.lead_created_at IS NOT NULL OR NEW.first_contacted_at IS NOT NULL
      OR NEW.intake_status<>'legacy_unclassified'
      OR NOT EXISTS(SELECT 1 FROM account_security_private.reviewed_roles r JOIN public.users u ON u.id=r.legacy_user_id
        WHERE r.auth_user_id=NEW.owner_user_id AND u.username=c.owner_login AND r.enabled AND r.role='Sales') THEN
      RAISE EXCEPTION 'EXTERNAL_CRM_CUSTOMER_EVIDENCE_REQUIRED';
    END IF;
  ELSE
    SELECT * INTO i FROM crm_external_private.interest_candidates
      WHERE batch_id=NEW.external_snapshot_batch_id AND entity_key=NEW.external_interest_key;
    IF i.entity_key IS NULL OR i.payload->'reviewHolds'<>'[]' OR i.owner_login IS NULL
      OR NEW.project_name IS DISTINCT FROM i.project_label OR NEW.engagement_status<>'legacy_unclassified'
      OR NEW.workspace_state<>'central_interest' OR NEW.activated_at IS NOT NULL OR NEW.activation_reason IS NOT NULL
      OR NEW.interested_plot_id IS NOT NULL OR NEW.interest_created_at IS NOT NULL
      OR NOT EXISTS(SELECT 1 FROM public.sales_customers p WHERE p.id=NEW.customer_id
        AND p.external_snapshot_batch_id=i.batch_id AND p.external_customer_key=i.customer_key)
      OR NOT EXISTS(SELECT 1 FROM account_security_private.reviewed_roles r JOIN public.users u ON u.id=r.legacy_user_id
        WHERE r.auth_user_id=NEW.owner_user_id AND u.username=i.owner_login AND r.enabled AND r.role='Sales') THEN
      RAISE EXCEPTION 'EXTERNAL_CRM_INTEREST_EVIDENCE_REQUIRED';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER external_customer_seal BEFORE INSERT OR UPDATE OR DELETE ON public.sales_customers
  FOR EACH ROW EXECUTE FUNCTION crm_external_private.guard_materialized_history();
CREATE TRIGGER external_interest_seal BEFORE INSERT OR UPDATE OR DELETE ON public.lead_project_interests
  FOR EACH ROW EXECUTE FUNCTION crm_external_private.guard_materialized_history();

-- Unknown history is NOT an implicit write lock in existing lifecycle/booking
-- commands. Keep ALL CRM capabilities closed until a separate inventory release.
CREATE FUNCTION crm_external_private.reject_unreviewed_activation()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE allowed boolean:=false;
BEGIN
  IF EXISTS(SELECT 1 FROM jsonb_each(to_jsonb(NEW)) j
    WHERE (j.key LIKE '%\_enabled' ESCAPE '\' OR j.key='booking_cutover_reviewed') AND j.value='true') THEN
    IF to_regprocedure('crm_external_private.booking_activation_allowed(jsonb)') IS NOT NULL THEN
      EXECUTE 'SELECT crm_external_private.booking_activation_allowed($1)' INTO allowed USING to_jsonb(NEW);
    END IF;
    IF allowed IS DISTINCT FROM true THEN RAISE EXCEPTION 'EXTERNAL_CRM_ACTIVATION_REVIEW_REQUIRED'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER external_bridge_activation_seal BEFORE INSERT OR UPDATE ON public.crm_settings
  FOR EACH ROW EXECUTE FUNCTION crm_external_private.reject_unreviewed_activation();

CREATE FUNCTION crm_external_private.materialize_crm(
  p_batch uuid,p_plan_digest text,p_admin uuid,p_bindings jsonb,p_review_ref text
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE b crm_external_private.snapshot_batches%ROWTYPE; item jsonb; normalized jsonb;
  request_value jsonb; prior crm_external_private.bridge_receipts%ROWTYPE; response_value jsonb;
  expected_logins jsonb; actual_logins jsonb;
BEGIN
  IF current_user IS DISTINCT FROM (SELECT pg_get_userbyid(relowner) FROM pg_class
    WHERE oid='crm_external_private.snapshot_batches'::regclass) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='EXTERNAL_BRIDGE_OPERATOR_REQUIRED';
  END IF;
  IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'EXTERNAL_BRIDGE_READ_COMMITTED_REQUIRED'; END IF;
  IF p_batch IS NULL OR p_admin IS NULL OR p_plan_digest IS NULL OR jsonb_typeof(p_bindings) IS DISTINCT FROM 'array'
    OR nullif(btrim(p_review_ref),'') IS NULL THEN RAISE EXCEPTION 'EXTERNAL_BRIDGE_INPUT_INVALID'; END IF;
  -- Same review lock as role changes; never create/enable a role from file labels.
  PERFORM pg_advisory_xact_lock(20260925,3);
  SELECT * INTO b FROM crm_external_private.snapshot_batches WHERE id=p_batch FOR UPDATE;
  IF b.id IS NULL OR b.plan_digest IS DISTINCT FROM p_plan_digest THEN RAISE EXCEPTION 'EXTERNAL_BRIDGE_PLAN_CHANGED'; END IF;
  PERFORM 1 FROM account_security_private.reviewed_roles r
    JOIN account_security_private.reviewed_admins a ON a.auth_user_id=r.auth_user_id AND a.legacy_user_id=r.legacy_user_id
    JOIN auth.users u ON u.id=r.auth_user_id
    WHERE r.auth_user_id=p_admin AND r.enabled AND r.role='Admin' AND r.review_revision>0 AND a.enabled
      AND u.deleted_at IS NULL AND NOT coalesce(u.is_anonymous,false) AND (u.banned_until IS NULL OR u.banned_until<=statement_timestamp())
    FOR SHARE OF r,a,u;
  IF NOT FOUND THEN RAISE EXCEPTION 'EXTERNAL_BRIDGE_REVIEWED_ADMIN_REQUIRED'; END IF;
  SELECT coalesce(jsonb_agg(login ORDER BY login),'[]') INTO expected_logins FROM (
    SELECT owner_login AS login FROM crm_external_private.customer_candidates WHERE batch_id=p_batch AND payload->'reviewHolds'='[]'
    UNION SELECT i.owner_login FROM crm_external_private.interest_candidates i
      JOIN crm_external_private.customer_candidates c ON c.batch_id=i.batch_id AND c.entity_key=i.customer_key
      WHERE i.batch_id=p_batch AND i.payload->'reviewHolds'='[]' AND c.payload->'reviewHolds'='[]'
  ) required;
  SELECT coalesce(jsonb_agg(v->>'login' ORDER BY v->>'login'),'[]'),coalesce(jsonb_agg(v ORDER BY v->>'login'),'[]')
    INTO actual_logins,normalized FROM jsonb_array_elements(p_bindings) v;
  IF actual_logins IS DISTINCT FROM expected_logins
    OR (SELECT count(DISTINCT v->>'authUserId') FROM jsonb_array_elements(p_bindings) v)<>jsonb_array_length(p_bindings) THEN
    RAISE EXCEPTION 'EXTERNAL_BRIDGE_BINDINGS_REQUIRED';
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(normalized) LOOP
    PERFORM 1 FROM account_security_private.reviewed_roles r
      JOIN auth.users u ON u.id=r.auth_user_id JOIN public.users p ON p.id=r.legacy_user_id
      JOIN sales_private.crm_user_roles c ON c.user_id=r.auth_user_id
      WHERE r.auth_user_id=(item->>'authUserId')::uuid AND p.username=item->>'login'
        AND r.review_revision=(item->>'revision')::bigint AND r.review_revision>0 AND r.role='Sales' AND r.enabled
        AND c.is_active AND c.role='sales' AND c.trusted_review_revision=r.review_revision
        AND u.deleted_at IS NULL AND NOT coalesce(u.is_anonymous,false) AND (u.banned_until IS NULL OR u.banned_until<=statement_timestamp())
      FOR SHARE OF r,u,p,c;
    IF NOT FOUND THEN RAISE EXCEPTION 'EXTERNAL_BRIDGE_BINDING_STALE'; END IF;
  END LOOP;
  -- Existence-only FKs do not protect mutable project membership on plots.
  -- Hold catalog rows through commit, including history still waiting for review.
  PERFORM p.name FROM public.projects p WHERE p.name IN (
    SELECT project_label FROM crm_external_private.interest_candidates WHERE batch_id=p_batch
  ) ORDER BY p.name FOR SHARE;
  PERFORM p.id FROM public.plots p WHERE p.id IN (
    SELECT plot_label_id FROM crm_external_private.booking_history WHERE batch_id=p_batch AND plot_label_id IS NOT NULL
  ) ORDER BY p.id FOR SHARE;
  IF EXISTS(SELECT 1 FROM crm_external_private.interest_candidates i LEFT JOIN public.projects p ON p.name=i.project_label
    WHERE i.batch_id=p_batch AND p.name IS NULL)
    OR EXISTS(SELECT 1 FROM crm_external_private.booking_history h
      LEFT JOIN crm_external_private.interest_candidates i ON i.batch_id=h.batch_id AND i.entity_key=h.interest_key
      LEFT JOIN public.plots p ON p.id=h.plot_label_id WHERE h.batch_id=p_batch AND h.plot_label_id IS NOT NULL
      AND (p.id IS NULL OR p.project_name IS DISTINCT FROM i.project_label)) THEN
    RAISE EXCEPTION 'EXTERNAL_BRIDGE_CATALOG_CHANGED';
  END IF;
  request_value:=jsonb_build_object('planDigest',p_plan_digest,'admin',p_admin,'bindings',normalized,'reviewRef',p_review_ref);
  SELECT * INTO prior FROM crm_external_private.bridge_receipts WHERE batch_id=p_batch;
  IF prior.batch_id IS NOT NULL THEN
    IF prior.request IS DISTINCT FROM request_value THEN RAISE EXCEPTION 'EXTERNAL_BRIDGE_REPLAY_CHANGED'; END IF;
    IF (SELECT count(*) FROM public.sales_customers WHERE external_snapshot_batch_id=p_batch)<>(prior.response->>'customers')::integer
      OR (SELECT count(*) FROM public.lead_project_interests WHERE external_snapshot_batch_id=p_batch)<>(prior.response->>'interests')::integer
      OR (SELECT count(*) FROM crm_external_private.booking_crm_links WHERE batch_id=p_batch)<>(prior.response->>'bookingHistoryLinks')::integer
      OR EXISTS(SELECT 1 FROM crm_external_private.booking_crm_links l
        JOIN crm_external_private.booking_history h ON h.batch_id=l.batch_id AND h.entity_key=l.booking_key
        LEFT JOIN public.sales_customers c ON c.external_snapshot_batch_id=h.batch_id AND c.external_customer_key=h.customer_key
        LEFT JOIN public.lead_project_interests i ON i.external_snapshot_batch_id=h.batch_id AND i.external_interest_key=h.interest_key
        WHERE l.batch_id=p_batch AND (l.customer_id IS DISTINCT FROM c.id OR l.interest_id IS DISTINCT FROM i.id OR l.plot_id IS DISTINCT FROM h.plot_label_id)) THEN
      RAISE EXCEPTION 'EXTERNAL_BRIDGE_REPLAY_INTEGRITY_REQUIRED';
    END IF;
    RETURN prior.response||jsonb_build_object('replayed',true);
  END IF;
  LOCK TABLE public.crm_settings IN SHARE MODE;
  IF EXISTS(SELECT 1 FROM public.crm_settings s,LATERAL jsonb_each(to_jsonb(s)) j
    WHERE (j.key LIKE '%\_enabled' ESCAPE '\' OR j.key='booking_cutover_reviewed') AND j.value='true') THEN
    RAISE EXCEPTION 'EXTERNAL_BRIDGE_DISABLED_CRM_REQUIRED';
  END IF;
  IF EXISTS(SELECT 1 FROM public.sales_customers) OR EXISTS(SELECT 1 FROM public.lead_project_interests) THEN
    RAISE EXCEPTION 'EXTERNAL_BRIDGE_EXISTING_CRM_REVIEW_REQUIRED';
  END IF;
  INSERT INTO public.sales_customers(customer_name,record_origin,phone,phone_data_status,intake_status,owner_user_id,
    created_by_user_id,lead_created_at,external_snapshot_batch_id,external_customer_key)
    SELECT c.customer_name,'legacy_import',NULL,'unknown_legacy','legacy_unclassified',(v->>'authUserId')::uuid,
      p_admin,NULL,c.batch_id,c.entity_key FROM crm_external_private.customer_candidates c
      JOIN jsonb_array_elements(normalized) v ON v->>'login'=c.owner_login
      WHERE c.batch_id=p_batch AND c.payload->'reviewHolds'='[]';
  INSERT INTO public.lead_project_interests(customer_id,project_name,owner_user_id,created_by_user_id,
    engagement_status,interest_created_at,external_snapshot_batch_id,external_interest_key)
    SELECT c.id,i.project_label,(v->>'authUserId')::uuid,p_admin,'legacy_unclassified',NULL,i.batch_id,i.entity_key
      FROM crm_external_private.interest_candidates i JOIN public.sales_customers c
      ON c.external_snapshot_batch_id=i.batch_id AND c.external_customer_key=i.customer_key
      JOIN jsonb_array_elements(normalized) v ON v->>'login'=i.owner_login
      WHERE i.batch_id=p_batch AND i.payload->'reviewHolds'='[]';
  INSERT INTO crm_external_private.booking_crm_links(batch_id,booking_key,customer_id,interest_id,plot_id)
    SELECT h.batch_id,h.entity_key,c.id,i.id,h.plot_label_id FROM crm_external_private.booking_history h
      LEFT JOIN public.sales_customers c ON c.external_snapshot_batch_id=h.batch_id AND c.external_customer_key=h.customer_key
      LEFT JOIN public.lead_project_interests i ON i.external_snapshot_batch_id=h.batch_id AND i.external_interest_key=h.interest_key
      WHERE h.batch_id=p_batch;
  response_value:=jsonb_build_object('batchId',p_batch,'replayed',false,
    'customers',(SELECT count(*) FROM public.sales_customers WHERE external_snapshot_batch_id=p_batch),
    'interests',(SELECT count(*) FROM public.lead_project_interests WHERE external_snapshot_batch_id=p_batch),
    'bookingHistoryLinks',(SELECT count(*) FROM crm_external_private.booking_crm_links WHERE batch_id=p_batch),
    'salesWritten',0,'plotsChanged',0,'activationReady',false);
  INSERT INTO crm_external_private.bridge_receipts(batch_id,request,response) VALUES(p_batch,request_value,response_value);
  RETURN response_value;
END;
$$;

DO $seal$
DECLARE obj record; grantee_name text;
BEGIN
  FOR obj IN SELECT oid,relname,relowner FROM pg_class WHERE relnamespace='crm_external_private'::regnamespace
    AND relname IN ('bridge_receipts','booking_crm_links') AND relkind='r' LOOP
    EXECUTE format('ALTER TABLE crm_external_private.%I ENABLE ROW LEVEL SECURITY',obj.relname);
    EXECUTE format('CREATE TRIGGER immutable_history BEFORE UPDATE OR DELETE OR TRUNCATE ON crm_external_private.%I FOR EACH STATEMENT EXECUTE FUNCTION crm_external_private.reject_history_change()',obj.relname);
    FOR grantee_name IN SELECT DISTINCT CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(a.grantee)) END
      FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
      WHERE c.oid=obj.oid AND a.grantee<>obj.relowner LOOP
      EXECUTE format('REVOKE ALL ON TABLE crm_external_private.%I FROM %s',obj.relname,grantee_name);
    END LOOP;
  END LOOP;
  FOR obj IN SELECT oid,proowner FROM pg_proc WHERE pronamespace='crm_external_private'::regnamespace LOOP
    FOR grantee_name IN SELECT DISTINCT CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(a.grantee)) END
      FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      WHERE p.oid=obj.oid AND a.grantee<>obj.proowner LOOP
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %s',obj.oid::regprocedure,grantee_name);
    END LOOP;
  END LOOP;
END;
$seal$;
ROLLBACK;
