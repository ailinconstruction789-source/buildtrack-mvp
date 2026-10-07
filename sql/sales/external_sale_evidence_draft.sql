-- DESIGN ONLY: read-only evidence projection after the sealed external cutover.
-- No activation, write permits, public grants or relaxation of sealed history.
BEGIN;
DO $draft_only$
BEGIN
  RAISE EXCEPTION 'DESIGN ONLY: external sale evidence requires isolated verification and operational integration';
END;
$draft_only$;

CREATE FUNCTION crm_external_private.sale_history(p_sale jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE persisted public.sales%ROWTYPE;
  prepared crm_external_private.prepared_booking_sales%ROWTYPE;
  history crm_external_private.booking_history%ROWTYPE;
  original jsonb; interest public.lead_project_interests%ROWTYPE;
BEGIN
  SELECT * INTO persisted FROM public.sales WHERE id=(p_sale->>'id')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'EXTERNAL_SALE_EVIDENCE_REQUIRED'; END IF;
  IF persisted.external_booking_id IS NULL AND persisted.external_source_stage IS NULL
    AND p_sale->>'external_booking_id' IS NULL AND p_sale->>'external_source_stage' IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO prepared FROM crm_external_private.prepared_booking_sales WHERE id=persisted.external_booking_id;
  SELECT * INTO history FROM crm_external_private.booking_history
    WHERE batch_id=prepared.batch_id AND entity_key=prepared.booking_key;
  SELECT * INTO interest FROM public.lead_project_interests WHERE id=persisted.project_interest_id;
  SELECT entry INTO original FROM crm_external_private.sales_cutover_receipts r,
    LATERAL jsonb_array_elements(r.after_sales) entry
    WHERE r.batch_id=prepared.batch_id AND entry->>'id'=persisted.id::text
      AND NOT EXISTS(SELECT 1 FROM crm_external_private.sales_rollback_receipts b WHERE b.batch_id=r.batch_id);
  IF prepared.id IS NULL OR history.entity_key IS NULL OR original IS NULL OR interest.id IS NULL
    OR (prepared.payload->>'eligible_for_release_review')::boolean IS DISTINCT FROM true
    OR prepared.payload->'review_holds' IS DISTINCT FROM '[]'::jsonb
    OR persisted.id IS DISTINCT FROM prepared.id
    OR persisted.external_source_stage IS DISTINCT FROM prepared.stage OR prepared.stage IS DISTINCT FROM history.stage
    OR persisted.project_interest_id IS DISTINCT FROM (prepared.payload->>'interest_id')::uuid
    OR persisted.plot_id IS DISTINCT FROM prepared.plot_id
    OR interest.customer_id IS DISTINCT FROM (prepared.payload->>'customer_id')::uuid
    OR interest.project_name IS DISTINCT FROM prepared.payload->>'project_name'
    OR persisted.booking_route IS DISTINCT FROM 'legacy_import'
    OR persisted.booking_round IS NOT NULL OR persisted.previous_sale_id IS NOT NULL OR persisted.lead_id IS NOT NULL
    OR persisted.booked_at IS NOT NULL OR persisted.list_price IS NOT NULL OR persisted.discount_amount IS NOT NULL
    OR original->>'crm_stage' IS DISTINCT FROM prepared.stage
    OR (prepared.stage='cancelled' AND (persisted.crm_stage IS DISTINCT FROM 'cancelled' OR persisted.cancelled_at IS NOT NULL))
    OR (prepared.stage='transferred' AND persisted.crm_stage NOT IN ('transferred','handover'))
    OR NOT EXISTS(SELECT 1 FROM crm_external_private.booking_crm_links l WHERE l.batch_id=prepared.batch_id
      AND l.booking_key=prepared.booking_key AND l.customer_id=interest.customer_id
      AND l.interest_id=interest.id AND l.plot_id=persisted.plot_id)
    OR EXISTS(SELECT 1 FROM unnest(ARRAY['id','external_booking_id','external_source_stage','project_interest_id','plot_id',
      'booking_route','booking_round','previous_sale_id','lead_id','booked_at','list_price','discount_amount']) field
      WHERE p_sale->field IS DISTINCT FROM to_jsonb(persisted)->field
        OR original->field IS DISTINCT FROM to_jsonb(persisted)->field)
    OR prepared.payload->'source_row' IS DISTINCT FROM to_jsonb(history.source_row)
    OR prepared.payload->'booked_date' IS DISTINCT FROM history.payload->'bookedDate'
    OR prepared.payload->'cancelled_date' IS DISTINCT FROM history.payload->'cancelledDate'
    OR prepared.payload->'transferred_date' IS DISTINCT FROM history.payload->'transferredDate' THEN
    RAISE EXCEPTION 'EXTERNAL_SALE_EVIDENCE_REQUIRED';
  END IF;
  -- No names, phones, income, full source payload or operator review notes.
  -- Source days remain days; operational timestamps and current stages are separate.
  RETURN jsonb_build_object('source','customer_sheet','batchId',prepared.batch_id,'sourceRow',history.source_row,
    'sourceStage',history.stage,'bookedDate',history.payload->'bookedDate',
    'cancelledDate',history.payload->'cancelledDate','transferredDate',history.payload->'transferredDate');
END;
$$;
DO $seal$
DECLARE grantee_name text;
BEGIN
  FOR grantee_name IN SELECT DISTINCT CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(a.grantee)) END
    FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    WHERE p.oid='crm_external_private.sale_history(jsonb)'::regprocedure AND a.grantee<>p.proowner LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION crm_external_private.sale_history(jsonb) FROM %s',grantee_name);
  END LOOP;
END;
$seal$;
ROLLBACK;
