-- Reviewed 2026-09-30: read-only column N projection for every booking round.
-- User decision 2026-09-30: annual gross includes cancelled bookings; N is
-- reviewed source column "ราคาทด 13", NOT plot appraisal or sale price.
-- No imports, backfills, customer writes, schema/table grants or role changes.
-- Requires the already-installed crm_excel_private evidence schema.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

CREATE FUNCTION crm_excel_private.booking_amounts(p_project_name text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog SET timezone='UTC' SET datestyle='ISO, YMD'
AS $amounts$
DECLARE
  actor_id uuid:=auth.uid(); actor_role text:=public.crm_v2_role();
  item record; cell_text text; td_price numeric; n integer:=0;
  result_rows jsonb[]:=ARRAY[]::jsonb[];
BEGIN
  IF actor_id IS NULL OR COALESCE(actor_role,'') NOT IN ('sales','admin','owner') THEN
    RAISE EXCEPTION 'CRM_EXCEL_BOOKING_AMOUNTS_FORBIDDEN';
  END IF;
  IF (public.crm_v2_project_sales_capabilities()->>'enabled')::boolean IS DISTINCT FROM true
    OR NOT crm_external_private.booking_writer_ready() THEN
    RAISE EXCEPTION 'CRM_EXCEL_BOOKING_AMOUNTS_SETUP_REQUIRED';
  END IF;
  IF p_project_name IS NULL OR length(btrim(p_project_name)) NOT BETWEEN 1 AND 200
    OR length(p_project_name)>200 OR p_project_name ~ U&'[\0001-\001F\007F-\009F\2028\2029]' THEN
    RAISE EXCEPTION 'CRM_EXCEL_BOOKING_AMOUNTS_INVALID_INPUT';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.projects WHERE name=p_project_name) THEN
    RAISE EXCEPTION 'CRM_EXCEL_BOOKING_AMOUNTS_NOT_FOUND';
  END IF;

  -- Keep cancelled/transferred/handover and each repeated booking. The caller
  -- selects the booking-year cohort; this function never substitutes stock.
  FOR item IN
    SELECT bounded.*,count(*) OVER() AS bounded_count FROM (
    SELECT sale.id,sale.external_booking_id,p.id AS prepared_id,
      p.payload->>'interest_id' AS prepared_interest,
      p.payload->>'customer_id' AS prepared_customer,p.payload->>'project_name' AS prepared_project,
      i.id AS interest_id,c.id AS customer_id,s.source_row,
      s.payload->'rawValues'->13 AS source_cell,s.payload->'sourceIssues' AS source_issues,
      w.batch_id AS released_batch
    FROM public.sales sale
    JOIN public.lead_project_interests i ON i.id=sale.project_interest_id
    JOIN public.sales_customers c ON c.id=i.customer_id AND c.merged_into_customer_id IS NULL
    LEFT JOIN crm_external_private.prepared_booking_sales p ON p.id=sale.external_booking_id
    LEFT JOIN crm_external_private.source_records s ON s.batch_id=p.batch_id
      AND s.source_row=CASE WHEN p.payload->>'source_row' ~ '^[0-9]{1,3}$'
        THEN (p.payload->>'source_row')::integer ELSE NULL END
      AND s.customer_key=c.external_customer_key AND c.external_snapshot_batch_id=p.batch_id
      AND s.disposition='mapped_for_review' AND s.source_row BETWEEN 2 AND 966
    LEFT JOIN crm_external_private.booking_writer_releases w ON w.batch_id=p.batch_id
      AND EXISTS(SELECT 1 FROM crm_external_private.snapshot_batches b
        WHERE b.id=w.batch_id AND b.plan_digest=w.plan_digest AND b.feed='customer-sheet')
      AND NOT EXISTS(SELECT 1 FROM crm_external_private.sales_rollback_receipts r WHERE r.batch_id=w.batch_id)
    WHERE i.project_name=p_project_name
    ORDER BY sale.id LIMIT 10001) bounded
  LOOP
    n:=n+1;
    IF n>10000 OR item.bounded_count>10000 THEN RAISE EXCEPTION 'CRM_EXCEL_BOOKING_AMOUNTS_LIMIT'; END IF;
    IF item.external_booking_id IS NOT NULL AND (item.prepared_id IS NULL
      OR item.released_batch IS NULL OR item.source_row IS NULL
      OR item.prepared_interest IS DISTINCT FROM item.interest_id::text
      OR item.prepared_customer IS DISTINCT FROM item.customer_id::text
      OR item.prepared_project IS DISTINCT FROM p_project_name) THEN
      RAISE EXCEPTION 'CRM_EXCEL_BOOKING_AMOUNTS_INTEGRITY_REQUIRED';
    END IF;
    td_price:=NULL;
    -- Private snapshots retain a row-level formula-review issue, not formula
    -- coordinates. If any primary input was a formula, do not trust N's cache.
    -- Explicit numeric zero is evidence; missing/blank/defaults are never zero.
    IF jsonb_typeof(item.source_cell) IN ('number','string')
      AND jsonb_typeof(item.source_issues)='array'
      AND NOT item.source_issues @> '["PRIMARY_INPUT_FORMULA_REVIEW"]'::jsonb THEN
      cell_text:=btrim(item.source_cell#>>'{}');
      IF cell_text ~ '^[0-9]{1,13}(\.[0-9]{1,2})?$' THEN
        td_price:=cell_text::numeric;
      END IF;
    END IF;
    result_rows:=array_append(result_rows,jsonb_build_object('saleId',item.id,'tdPrice',td_price));
  END LOOP;
  RETURN jsonb_build_object('contractVersion','excel_booking_amounts_v1','projectName',p_project_name,
    'actor',jsonb_build_object('userId',actor_id,'role',actor_role),'rows',to_jsonb(result_rows));
END;
$amounts$;
REVOKE ALL ON FUNCTION crm_excel_private.booking_amounts(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION crm_excel_private.booking_amounts(text) TO authenticated;

-- No privilege elevation in the exposed schema. Both entry points retain the
-- private function's trusted-actor and released-provenance guards.
CREATE FUNCTION public.crm_v2_excel_booking_amounts(p_project_name text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog
AS $rpc$
  SELECT crm_excel_private.booking_amounts(p_project_name);
$rpc$;
REVOKE ALL ON FUNCTION public.crm_v2_excel_booking_amounts(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_v2_excel_booking_amounts(text) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
