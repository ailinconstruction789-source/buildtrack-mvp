-- LOCAL DESIGN ONLY: sealed replacement candidates, NOT an inventory cutover.
-- Never writes public.sales/plots or retires/deletes legacy rows.
BEGIN;
DO $draft_only$
BEGIN
  RAISE EXCEPTION 'DESIGN ONLY: external booking bridge requires isolated verification and separate cutover review';
END;
$draft_only$;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='30s';

-- Dates retain source day precision. No import timestamp substitutes unknown dates.
CREATE VIEW crm_external_private.booking_sales_projection WITH (security_invoker=true) AS
SELECT h.batch_id,h.entity_key AS booking_key,h.source_row,l.customer_id,l.interest_id,l.plot_id,
  i.project_name,i.owner_user_id AS closing_sales_user_id,h.stage,
  (h.payload->>'bookedDate')::date AS booked_date,
  (h.payload->>'cancelledDate')::date AS cancelled_date,
  (h.payload->>'transferredDate')::date AS transferred_date,
  (h.payload->>'salePrice')::numeric AS sale_price,
  (h.payload->>'depositAmount')::numeric AS deposit_amount,
  h.payload->>'paymentMethod' AS payment_method,h.payload->>'cancellationReason' AS cancellation_reason,
  h.payload->'reviewHolds' AS review_holds,
  (h.payload->'reviewHolds'='[]' AND l.customer_id IS NOT NULL
    AND l.interest_id IS NOT NULL AND l.plot_id IS NOT NULL) AS eligible_for_release_review
FROM crm_external_private.booking_history h
JOIN crm_external_private.booking_crm_links l ON l.batch_id=h.batch_id AND l.booking_key=h.entity_key
LEFT JOIN public.lead_project_interests i ON i.id=l.interest_id;

CREATE TABLE crm_external_private.prepared_booking_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL,
  booking_key text NOT NULL,
  payload jsonb NOT NULL,
  plot_id text GENERATED ALWAYS AS (payload->>'plot_id') STORED,
  stage text GENERATED ALWAYS AS (payload->>'stage') STORED NOT NULL,
  UNIQUE(batch_id,booking_key),
  FOREIGN KEY(batch_id,booking_key) REFERENCES crm_external_private.booking_crm_links(batch_id,booking_key) ON DELETE RESTRICT,
  CHECK(stage IN ('booked','transferred','cancelled')),
  CHECK(stage='cancelled' OR plot_id IS NOT NULL)
);
-- Every non-cancelled source row counts, even a held customer. Never hide an
-- active collision by excluding held candidates or transferred history.
CREATE UNIQUE INDEX prepared_booking_active_plot_idx
  ON crm_external_private.prepared_booking_sales(batch_id,plot_id) WHERE stage<>'cancelled';

CREATE TABLE crm_external_private.booking_release_receipts (
  batch_id uuid PRIMARY KEY REFERENCES crm_external_private.bridge_receipts(batch_id) ON DELETE RESTRICT,
  request jsonb NOT NULL,
  legacy_snapshot jsonb NOT NULL,
  response jsonb NOT NULL,
  captured_by name NOT NULL DEFAULT current_user,
  captured_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION crm_external_private.guard_prepared_booking()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE expected jsonb;
BEGIN
  SELECT to_jsonb(p) INTO expected FROM crm_external_private.booking_sales_projection p
    WHERE p.batch_id=NEW.batch_id AND p.booking_key=NEW.booking_key;
  IF expected IS NULL OR NEW.payload IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'EXTERNAL_BOOKING_EVIDENCE_REQUIRED';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER prepared_booking_evidence BEFORE INSERT ON crm_external_private.prepared_booking_sales
  FOR EACH ROW EXECUTE FUNCTION crm_external_private.guard_prepared_booking();

CREATE FUNCTION crm_external_private.prepare_booking_release(p_batch uuid,p_plan_digest text,p_review_ref text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' SET lock_timeout='2s' AS $$
DECLARE identity_receipt crm_external_private.bridge_receipts%ROWTYPE;
  prior crm_external_private.booking_release_receipts%ROWTYPE;
  baseline jsonb; request_value jsonb; response_value jsonb;
BEGIN
  IF current_user IS DISTINCT FROM (SELECT pg_get_userbyid(relowner) FROM pg_class
    WHERE oid='crm_external_private.snapshot_batches'::regclass) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='EXTERNAL_BOOKING_OPERATOR_REQUIRED';
  END IF;
  IF p_batch IS NULL OR p_plan_digest IS NULL OR nullif(btrim(p_review_ref),'') IS NULL THEN
    RAISE EXCEPTION 'EXTERNAL_BOOKING_INPUT_INVALID';
  END IF;
  -- Match the identity bridge lock order. Revalidate pinned staging evidence:
  -- a later operator append must not disappear through the projection's join.
  PERFORM pg_advisory_xact_lock(20260925,3);
  PERFORM crm_external_private.stage_snapshot(payload)
    FROM crm_external_private.snapshot_batches WHERE id=p_batch;
  SELECT * INTO identity_receipt FROM crm_external_private.bridge_receipts WHERE batch_id=p_batch;
  IF identity_receipt.batch_id IS NULL THEN RAISE EXCEPTION 'EXTERNAL_BOOKING_IDENTITY_BRIDGE_REQUIRED'; END IF;
  -- Reuse the exact identity receipt, rechecking canonical roles/Auth/revisions,
  -- catalog locks, READ COMMITTED isolation, plan and immutable link membership.
  PERFORM crm_external_private.materialize_crm(p_batch,p_plan_digest,
    (identity_receipt.request->>'admin')::uuid,identity_receipt.request->'bindings',identity_receipt.request->>'reviewRef');
  IF EXISTS(SELECT 1 FROM crm_external_private.booking_history h
    LEFT JOIN crm_external_private.booking_crm_links l ON l.batch_id=h.batch_id AND l.booking_key=h.entity_key
    WHERE h.batch_id=p_batch AND l.booking_key IS NULL)
    OR (SELECT count(*) FROM crm_external_private.booking_sales_projection WHERE batch_id=p_batch)
      <>(SELECT count(*) FROM crm_external_private.booking_history WHERE batch_id=p_batch) THEN
    RAISE EXCEPTION 'EXTERNAL_BOOKING_COVERAGE_REQUIRED';
  END IF;
  LOCK TABLE public.crm_settings,public.leads,public.sales,public.plots,public.projects,public.customer_voices IN SHARE MODE;
  IF EXISTS(SELECT 1 FROM public.crm_settings s,LATERAL jsonb_each(to_jsonb(s)) j
    WHERE (j.key LIKE '%\_enabled' ESCAPE '\' OR j.key='booking_cutover_reviewed') AND j.value='true') THEN
    RAISE EXCEPTION 'EXTERNAL_BOOKING_DISABLED_CRM_REQUIRED';
  END IF;
  SELECT jsonb_build_object(
    'leads',coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM public.leads l),'[]'),
    'sales',coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.sales s),'[]'),
    'plots',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.plots p),'[]'),
    'projects',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY name) FROM public.projects p),'[]'),
    'voices',coalesce((SELECT jsonb_agg(to_jsonb(v) ORDER BY id) FROM public.customer_voices v),'[]')) INTO baseline;
  request_value:=jsonb_build_object('planDigest',p_plan_digest,'identityRequest',identity_receipt.request,'reviewRef',p_review_ref);
  SELECT * INTO prior FROM crm_external_private.booking_release_receipts WHERE batch_id=p_batch;
  IF prior.batch_id IS NOT NULL THEN
    IF prior.request IS DISTINCT FROM request_value THEN RAISE EXCEPTION 'EXTERNAL_BOOKING_REPLAY_CHANGED'; END IF;
    IF prior.legacy_snapshot IS DISTINCT FROM baseline THEN RAISE EXCEPTION 'EXTERNAL_BOOKING_LEGACY_CHANGED'; END IF;
    IF (SELECT count(*) FROM crm_external_private.prepared_booking_sales WHERE batch_id=p_batch)
        <>(prior.response->>'bookingHistories')::integer
      OR EXISTS(SELECT 1 FROM crm_external_private.prepared_booking_sales s
        LEFT JOIN crm_external_private.booking_sales_projection p ON p.batch_id=s.batch_id AND p.booking_key=s.booking_key
        WHERE s.batch_id=p_batch AND (p.booking_key IS NULL OR s.payload IS DISTINCT FROM to_jsonb(p))) THEN
      RAISE EXCEPTION 'EXTERNAL_BOOKING_REPLAY_INTEGRITY_REQUIRED';
    END IF;
    RETURN prior.response||jsonb_build_object('replayed',true);
  END IF;
  IF EXISTS(SELECT 1 FROM crm_external_private.prepared_booking_sales WHERE batch_id=p_batch) THEN
    RAISE EXCEPTION 'EXTERNAL_BOOKING_PARTIAL_PREPARATION';
  END IF;
  IF EXISTS(SELECT 1 FROM crm_external_private.booking_sales_projection
    WHERE batch_id=p_batch AND stage<>'cancelled' GROUP BY plot_id HAVING plot_id IS NULL OR count(*)>1) THEN
    RAISE EXCEPTION 'EXTERNAL_BOOKING_ACTIVE_PLOT_COLLISION';
  END IF;
  INSERT INTO crm_external_private.prepared_booking_sales(batch_id,booking_key,payload)
    SELECT p.batch_id,p.booking_key,to_jsonb(p) FROM crm_external_private.booking_sales_projection p WHERE p.batch_id=p_batch;
  response_value:=jsonb_build_object('batchId',p_batch,'replayed',false,
    'bookingHistories',(SELECT count(*) FROM crm_external_private.prepared_booking_sales WHERE batch_id=p_batch),
    'eligibleForReleaseReview',(SELECT count(*) FROM crm_external_private.booking_sales_projection WHERE batch_id=p_batch AND eligible_for_release_review),
    'heldHistories',(SELECT count(*) FROM crm_external_private.booking_sales_projection WHERE batch_id=p_batch AND NOT eligible_for_release_review),
    'activeSourcePlots',(SELECT count(*) FROM crm_external_private.prepared_booking_sales WHERE batch_id=p_batch AND stage<>'cancelled'),
    'legacySalesPreserved',jsonb_array_length(baseline->'sales'),'salesWritten',0,'plotsChanged',0,'activationReady',false);
  INSERT INTO crm_external_private.booking_release_receipts(batch_id,request,legacy_snapshot,response)
    VALUES(p_batch,request_value,baseline,response_value);
  RETURN response_value;
END;
$$;

DO $seal$
DECLARE obj record; grantee_name text;
BEGIN
  FOR obj IN SELECT oid,relname,relowner,relkind FROM pg_class WHERE relnamespace='crm_external_private'::regnamespace
    AND relname IN ('prepared_booking_sales','booking_release_receipts','booking_sales_projection') LOOP
    IF obj.relkind='r' THEN
      EXECUTE format('ALTER TABLE crm_external_private.%I ENABLE ROW LEVEL SECURITY',obj.relname);
      EXECUTE format('CREATE TRIGGER immutable_history BEFORE UPDATE OR DELETE OR TRUNCATE ON crm_external_private.%I FOR EACH STATEMENT EXECUTE FUNCTION crm_external_private.reject_history_change()',obj.relname);
    END IF;
    FOR grantee_name IN SELECT DISTINCT CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(a.grantee)) END
      FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
      WHERE c.oid=obj.oid AND a.grantee<>obj.relowner LOOP
      EXECUTE format('REVOKE ALL ON TABLE crm_external_private.%I FROM %s',obj.relname,grantee_name);
    END LOOP;
  END LOOP;
  FOR obj IN SELECT oid,proowner FROM pg_proc WHERE pronamespace='crm_external_private'::regnamespace
    AND proname IN ('guard_prepared_booking','prepare_booking_release') LOOP
    FOR grantee_name IN SELECT DISTINCT CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(a.grantee)) END
      FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      WHERE p.oid=obj.oid AND a.grantee<>obj.proowner LOOP
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %s',obj.oid::regprocedure,grantee_name);
    END LOOP;
  END LOOP;
END;
$seal$;
ROLLBACK;
