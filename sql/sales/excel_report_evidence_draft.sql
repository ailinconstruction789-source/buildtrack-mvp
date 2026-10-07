-- DESIGN ONLY: read-only Excel evidence projection. No data backfill/import.
-- User decision 2026-09-30: historical sheet A is both visit day and Lead day;
-- reviewed sheet Q is a forecast, never an actual transfer. Cutoff is row 966.
-- SECURITY DEFINER is narrowly required to project private reviewed provenance;
-- no private-table grants, names, phone numbers, raw cells or answer payloads.
BEGIN;
DO $draft_only$
BEGIN
  RAISE EXCEPTION 'DESIGN ONLY: Excel evidence requires isolated verification and deployment review';
END;
$draft_only$;

CREATE SCHEMA crm_excel_private;
REVOKE ALL ON SCHEMA crm_excel_private FROM PUBLIC,anon;
GRANT USAGE ON SCHEMA crm_excel_private TO authenticated;

CREATE FUNCTION crm_excel_private.evidence(p_project_name text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog SET timezone='UTC' SET datestyle='ISO, YMD'
AS $evidence$
DECLARE
  actor_id uuid:=auth.uid(); actor_role text:=public.crm_v2_role();
  item record; day_value text; n integer:=0;
  legacy_rows jsonb[]:=ARRAY[]::jsonb[]; forecast_rows jsonb[]:=ARRAY[]::jsonb[];
  completed_rows jsonb[]:=ARRAY[]::jsonb[]; pending_keys jsonb:='[]';
  unassigned_rows jsonb[]:=ARRAY[]::jsonb[]; unknown_unassigned_count integer:=0;
  pending_count integer:=0; unknown_count integer:=0;
BEGIN
  IF actor_id IS NULL OR COALESCE(actor_role,'') NOT IN ('sales','admin','owner') THEN
    RAISE EXCEPTION 'CRM_EXCEL_EVIDENCE_FORBIDDEN';
  END IF;
  IF (public.crm_v2_project_sales_capabilities()->>'enabled')::boolean IS DISTINCT FROM true
    OR NOT crm_external_private.booking_writer_ready() THEN
    RAISE EXCEPTION 'CRM_EXCEL_EVIDENCE_SETUP_REQUIRED';
  END IF;
  IF p_project_name IS NULL OR length(btrim(p_project_name)) NOT BETWEEN 1 AND 200
    OR length(p_project_name)>200 OR p_project_name ~ U&'[\0001-\001F\007F-\009F\2028\2029]' THEN
    RAISE EXCEPTION 'CRM_EXCEL_EVIDENCE_INVALID_INPUT';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.projects WHERE name=p_project_name) THEN
    RAISE EXCEPTION 'CRM_EXCEL_EVIDENCE_NOT_FOUND';
  END IF;

  -- Exact interest/source membership, not every row belonging to that customer.
  -- DISTINCT collapses repeated membership only; batch:row remains the stable
  -- key for cross-project deduplication by the combined report consumer.
  FOR item IN
    SELECT bounded.*,count(*) OVER() AS bounded_count FROM (
    SELECT DISTINCT s.batch_id,s.source_row,c.id AS customer_id,
      s.payload->'reviewedHistory'->>'visitHistoryDate' AS source_day
    FROM public.lead_project_interests i
    JOIN crm_external_private.interest_candidates ic
      ON ic.batch_id=i.external_snapshot_batch_id AND ic.entity_key=i.external_interest_key
      AND ic.project_label=i.project_name
    JOIN crm_external_private.booking_writer_releases w ON w.batch_id=ic.batch_id
    JOIN crm_external_private.snapshot_batches b ON b.id=w.batch_id AND b.plan_digest=w.plan_digest
      AND b.feed='customer-sheet'
    JOIN public.sales_customers c ON c.id=i.customer_id
      AND c.external_snapshot_batch_id=ic.batch_id AND c.external_customer_key=ic.customer_key
      AND c.merged_into_customer_id IS NULL
    JOIN crm_external_private.source_records s ON s.batch_id=ic.batch_id AND s.customer_key=ic.customer_key
      AND ic.payload->'sourceRows' @> jsonb_build_array(s.source_row)
    WHERE i.project_name=p_project_name AND s.disposition='mapped_for_review'
      AND s.source_row BETWEEN 2 AND 966
      AND NOT EXISTS(SELECT 1 FROM crm_external_private.sales_rollback_receipts r WHERE r.batch_id=b.id)
    ORDER BY s.batch_id,s.source_row,c.id
    LIMIT 10001) bounded
  LOOP
    n:=n+1;
    IF n>10000 OR item.bounded_count>10000 THEN RAISE EXCEPTION 'CRM_EXCEL_EVIDENCE_LIMIT'; END IF;
    day_value:=item.source_day;
    IF day_value IS NULL THEN unknown_count:=unknown_count+1; CONTINUE; END IF;
    IF day_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      OR NOT pg_input_is_valid(day_value,'date') THEN
      RAISE EXCEPTION 'CRM_EXCEL_EVIDENCE_DATE_INVALID';
    END IF;
    legacy_rows:=array_append(legacy_rows,jsonb_build_object(
      'key',item.batch_id::text||':'||item.source_row::text,'customerId',item.customer_id,
      'visitDate',day_value,'leadDate',day_value));
  END LOOP;

  -- Historical visits with an explicitly empty project list must survive in
  -- the all-project total, without assigning a fabricated project. This array
  -- is repeated for each project RPC and must be globally deduplicated by key;
  -- consumers must exclude it from project-specific subtotals.
  n:=0;
  FOR item IN
    SELECT bounded.*,count(*) OVER() AS bounded_count FROM (
    SELECT DISTINCT s.batch_id,s.source_row,c.id AS customer_id,
      s.payload->'reviewedHistory'->>'visitHistoryDate' AS source_day
    FROM crm_external_private.source_records s
    JOIN crm_external_private.booking_writer_releases w ON w.batch_id=s.batch_id
    JOIN crm_external_private.snapshot_batches b ON b.id=w.batch_id AND b.plan_digest=w.plan_digest
      AND b.feed='customer-sheet'
    JOIN public.sales_customers c ON c.external_snapshot_batch_id=s.batch_id
      AND c.external_customer_key=s.customer_key AND c.merged_into_customer_id IS NULL
    WHERE s.disposition='mapped_for_review' AND s.source_row BETWEEN 2 AND 966
      AND s.payload->'reviewedHistory'->'projectLabels'='[]'::jsonb
      AND NOT EXISTS(SELECT 1 FROM crm_external_private.interest_candidates ic
        WHERE ic.batch_id=s.batch_id AND ic.customer_key=s.customer_key
          AND ic.payload->'sourceRows' @> jsonb_build_array(s.source_row))
      AND NOT EXISTS(SELECT 1 FROM crm_external_private.sales_rollback_receipts r WHERE r.batch_id=b.id)
    ORDER BY s.batch_id,s.source_row,c.id LIMIT 10001) bounded
  LOOP
    n:=n+1;
    IF n>10000 OR item.bounded_count>10000 THEN RAISE EXCEPTION 'CRM_EXCEL_EVIDENCE_LIMIT'; END IF;
    day_value:=item.source_day;
    IF day_value IS NULL THEN unknown_unassigned_count:=unknown_unassigned_count+1; CONTINUE; END IF;
    IF day_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      OR NOT pg_input_is_valid(day_value,'date') THEN
      RAISE EXCEPTION 'CRM_EXCEL_EVIDENCE_DATE_INVALID';
    END IF;
    unassigned_rows:=array_append(unassigned_rows,jsonb_build_object(
      'key',item.batch_id::text||':'||item.source_row::text,'customerId',item.customer_id,
      'visitDate',day_value,'leadDate',day_value));
  END LOOP;

  -- Held source rows may intentionally have no public Lead. Count only their
  -- attributable project membership, never expose the source identity/payload.
  SELECT count(*),COALESCE(jsonb_agg(batch_id::text||':'||source_row::text ORDER BY batch_id,source_row),'[]')
    INTO pending_count,pending_keys FROM (
    SELECT DISTINCT s.batch_id,s.source_row
    FROM crm_external_private.source_records s
    JOIN crm_external_private.interest_candidates ic ON ic.batch_id=s.batch_id
      AND ic.customer_key=s.customer_key AND ic.payload->'sourceRows' @> jsonb_build_array(s.source_row)
    JOIN crm_external_private.booking_writer_releases w ON w.batch_id=s.batch_id
    JOIN crm_external_private.snapshot_batches b ON b.id=w.batch_id AND b.plan_digest=w.plan_digest
      AND b.feed='customer-sheet'
    WHERE ic.project_label=p_project_name AND s.disposition='admin_review'
      AND s.source_row BETWEEN 2 AND 966
      AND NOT EXISTS(SELECT 1 FROM crm_external_private.sales_rollback_receipts r WHERE r.batch_id=b.id)
    UNION
    -- An unnamed held row has no customer/interest candidate by design. Only
    -- the user-confirmed seven aliases in reviewedHistory may attribute it.
    -- Source reference: sheet-project-review-20260929.mjs / user confirmation.
    SELECT DISTINCT s.batch_id,s.source_row
    FROM crm_external_private.source_records s
    JOIN crm_external_private.booking_writer_releases w ON w.batch_id=s.batch_id
    JOIN crm_external_private.snapshot_batches b ON b.id=w.batch_id AND b.plan_digest=w.plan_digest
      AND b.feed='customer-sheet'
    JOIN (VALUES ('AL2','ไอลิน 2'),('AL3','ไอลิน 3'),('AL4','ไอลิน 4'),('AL6','ไอลิน6'),
      ('K4','กานต์รวี4'),('K2พิเศษ','กานต์รวี2'),('YR','โยริว')) aliases(source_label,project_name)
      ON s.payload->'reviewedHistory'->'projectLabels' @> jsonb_build_array(aliases.source_label)
    WHERE aliases.project_name=p_project_name AND s.disposition='admin_review' AND s.customer_key IS NULL
      AND s.source_row BETWEEN 2 AND 966
      AND NOT EXISTS(SELECT 1 FROM crm_external_private.sales_rollback_receipts r WHERE r.batch_id=b.id)
    LIMIT 10001
  ) pending;
  IF pending_count>10000 THEN RAISE EXCEPTION 'CRM_EXCEL_EVIDENCE_LIMIT'; END IF;

  n:=0;
  FOR item IN
    SELECT bounded.*,count(*) OVER() AS bounded_count FROM (
    SELECT sale.id,sale.external_booking_id,p.id AS prepared_id,
      p.batch_id,p.payload->>'interest_id' AS prepared_interest,
      p.payload->>'customer_id' AS prepared_customer,p.payload->>'project_name' AS prepared_project,
      i.id AS interest_id,c.id AS customer_id,s.source_row,
      s.payload->'reviewedHistory'->>'expectedTransferDate' AS source_day,
      w.batch_id AS released_batch
    FROM public.sales sale
    JOIN public.lead_project_interests i ON i.id=sale.project_interest_id
    JOIN public.sales_customers c ON c.id=i.customer_id AND c.merged_into_customer_id IS NULL
    LEFT JOIN crm_external_private.prepared_booking_sales p ON p.id=sale.external_booking_id
    LEFT JOIN crm_external_private.source_records s ON s.batch_id=p.batch_id
      AND s.source_row=(p.payload->>'source_row')::integer
      AND s.customer_key=c.external_customer_key AND c.external_snapshot_batch_id=p.batch_id
      AND s.disposition='mapped_for_review' AND s.source_row BETWEEN 2 AND 966
    LEFT JOIN crm_external_private.booking_writer_releases w ON w.batch_id=p.batch_id
      AND EXISTS(SELECT 1 FROM crm_external_private.snapshot_batches b
        WHERE b.id=w.batch_id AND b.plan_digest=w.plan_digest AND b.feed='customer-sheet')
      AND NOT EXISTS(SELECT 1 FROM crm_external_private.sales_rollback_receipts r WHERE r.batch_id=w.batch_id)
    WHERE i.project_name=p_project_name
      AND sale.crm_stage IN ('booked','contracted','downpayment','document_prep',
        'loan_submitted','loan_rejected','loan_approved','transfer_pending')
    ORDER BY sale.id LIMIT 10001) bounded
  LOOP
    n:=n+1;
    IF n>10000 OR item.bounded_count>10000 THEN RAISE EXCEPTION 'CRM_EXCEL_EVIDENCE_LIMIT'; END IF;
    IF item.external_booking_id IS NOT NULL AND (item.prepared_id IS NULL
      OR item.released_batch IS NULL OR item.source_row IS NULL
      OR item.prepared_interest IS DISTINCT FROM item.interest_id::text
      OR item.prepared_customer IS DISTINCT FROM item.customer_id::text
      OR item.prepared_project IS DISTINCT FROM p_project_name) THEN
      RAISE EXCEPTION 'CRM_EXCEL_EVIDENCE_INTEGRITY_REQUIRED';
    END IF;
    day_value:=item.source_day;
    IF day_value IS NOT NULL AND (day_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      OR NOT pg_input_is_valid(day_value,'date')) THEN
      RAISE EXCEPTION 'CRM_EXCEL_EVIDENCE_DATE_INVALID';
    END IF;
    forecast_rows:=array_append(forecast_rows,jsonb_build_object(
      'saleId',item.id,'expectedTransferDate',day_value));
  END LOOP;

  n:=0;
  FOR item IN
    SELECT bounded.*,count(*) OVER() AS bounded_count FROM (
    SELECT v.id,c.id AS customer_id,v.checked_in_at
    FROM public.lead_visits v
    JOIN public.lead_project_interests i ON i.id=v.project_interest_id
    JOIN public.sales_customers c ON c.id=i.customer_id AND c.merged_into_customer_id IS NULL
    JOIN public.customer_voices voice ON voice.id=v.completed_voice_id AND voice.visit_id=v.id
      AND voice.crm_submission_state='submitted' AND voice.crm_form_version='customer_voices_v1'
      AND voice.crm_submitted_by_customer AND voice.crm_submitted_at=v.completed_at
      AND voice.crm_validated_at=v.completed_at
    WHERE i.project_name=p_project_name AND v.status='completed'
      AND v.completed_voice_id IS NOT NULL AND v.completed_at IS NOT NULL
    ORDER BY v.id LIMIT 10001) bounded
  LOOP
    n:=n+1;
    IF n>10000 OR item.bounded_count>10000 THEN RAISE EXCEPTION 'CRM_EXCEL_EVIDENCE_LIMIT'; END IF;
    IF item.checked_in_at IS NULL OR NOT isfinite(item.checked_in_at)
      OR (item.checked_in_at AT TIME ZONE 'Asia/Bangkok')::date NOT BETWEEN DATE '0001-01-01' AND DATE '9999-12-31' THEN
      RAISE EXCEPTION 'CRM_EXCEL_EVIDENCE_DATE_INVALID';
    END IF;
    completed_rows:=array_append(completed_rows,jsonb_build_object(
      'key','visit:'||item.id::text,'customerId',item.customer_id,
      'visitDate',to_char(item.checked_in_at AT TIME ZONE 'Asia/Bangkok','YYYY-MM-DD')));
  END LOOP;
  RETURN jsonb_build_object('contractVersion','excel_evidence_v1','projectName',p_project_name,
    'actor',jsonb_build_object('userId',actor_id,'role',actor_role),
    'legacyVisits',to_jsonb(legacy_rows),'forecasts',to_jsonb(forecast_rows),'completedVisits',to_jsonb(completed_rows),
    'pendingLegacyRows',pending_count,'pendingLegacyKeys',pending_keys,'unknownLegacyDates',unknown_count,
    'unassignedLegacyVisits',to_jsonb(unassigned_rows),'unknownUnassignedLegacyDates',unknown_unassigned_count);
END;
$evidence$;
REVOKE ALL ON FUNCTION crm_excel_private.evidence(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION crm_excel_private.evidence(text) TO authenticated;

-- The exposed RPC has no elevated authority. Only the private projection owns
-- a definer boundary; both entry points retain the same guarded actor checks.
CREATE FUNCTION public.crm_v2_excel_evidence(p_project_name text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog
AS $rpc$
  SELECT crm_excel_private.evidence(p_project_name);
$rpc$;
REVOKE ALL ON FUNCTION public.crm_v2_excel_evidence(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_v2_excel_evidence(text) TO authenticated;
ROLLBACK;
