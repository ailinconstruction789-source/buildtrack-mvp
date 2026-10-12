-- Aggregate review only. No schema/data/auth changes and no customer names/phones.
SELECT table_name,column_name,data_type
FROM information_schema.columns
WHERE table_schema='public' AND table_name IN ('sales','leads')
  AND column_name IN ('booked_at','contracted_at','loan_submission_date','transferred_at',
    'crm_transfer_date','crm_handover_at','cancelled_at','actual_visit_date')
ORDER BY table_name,column_name;

SELECT count(*) AS sales_total,
  count(*) FILTER(WHERE lead_id IS NULL) AS sales_without_lead,
  count(*) FILTER(WHERE booked_at IS NOT NULL) AS recorded_booking_instants,
  count(*) FILTER(WHERE contracted_at IS NOT NULL) AS recorded_contract_instants,
  count(*) FILTER(WHERE transferred_at IS NOT NULL) AS recorded_transfer_instants,
  count(*) FILTER(WHERE crm_handover_at IS NOT NULL) AS recorded_handover_instants,
  count(*) FILTER(WHERE cancelled_at IS NOT NULL) AS recorded_cancel_instants
FROM public.sales;

-- Staged source and materialized sales are different populations; do not assert 304=303.
SELECT count(*) AS source_booking_records,
  count(*) FILTER(WHERE payload->>'bookedDate' IS NOT NULL) AS known_source_booking_days,
  count(*) FILTER(WHERE payload->>'transferredDate' IS NOT NULL) AS known_source_transfer_days,
  count(*) FILTER(WHERE payload->>'cancelledDate' IS NOT NULL) AS known_source_cancel_days
FROM crm_external_private.booking_history;
