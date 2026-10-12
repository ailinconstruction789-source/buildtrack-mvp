-- Read-only readiness review. No customer names, contact details or write statements.
-- Run through an authorized database review connection, not a public application endpoint.
WITH source_keys AS (
  SELECT payload->>'originalSourceKey' AS original_key, customer_key, batch_id
  FROM crm_external_private.source_records
), settings AS (
  SELECT to_jsonb(s) AS value FROM public.crm_settings s WHERE id
)
SELECT jsonb_build_object(
  'legacy_leads', (SELECT count(*) FROM public.leads),
  'crm_customers', (SELECT count(*) FROM public.sales_customers),
  'crm_sales', (SELECT count(*) FROM public.sales),
  'reviewed_legacy_links', (SELECT count(*) FROM public.crm_legacy_lead_links),
  'captured_legacy_source_snapshots', (SELECT count(*) FROM sales_private.crm_legacy_source_snapshots),
  'sales_with_exact_reviewed_interest_link', (
    SELECT count(DISTINCT s.id) FROM public.sales s
    JOIN public.lead_project_interests i ON i.id=s.project_interest_id
    JOIN public.crm_legacy_lead_links m ON m.project_interest_id=i.id AND m.customer_id=i.customer_id
    JOIN public.leads l ON l.id=m.legacy_lead_id
  ),
  'original_source_key_uuid_count', (
    SELECT count(*) FROM source_keys
    WHERE original_key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  'original_source_key_exact_lead_id_matches', (
    SELECT count(*) FROM source_keys k JOIN public.leads l ON l.id::text=lower(k.original_key)
  ),
  'customer_id_exact_lead_id_matches', (
    SELECT count(*) FROM public.sales_customers c JOIN public.leads l ON l.id=c.id
  ),
  'native_sales_lead_links', (SELECT count(*) FROM public.sales WHERE lead_id IS NOT NULL),
  'post_booking_context_installed', to_regprocedure('public.crm_v2_post_booking_context(uuid,integer,integer)') IS NOT NULL,
  'post_booking_command_installed', to_regprocedure('public.crm_v2_post_booking_command(uuid,jsonb)') IS NOT NULL,
  'post_booking_capabilities_installed', to_regprocedure('public.crm_v2_post_booking_capabilities()') IS NOT NULL,
  'booking_command_installed', to_regprocedure('public.crm_v2_booking_command(uuid,jsonb)') IS NOT NULL,
  'booking_enabled', (SELECT value->'booking_enabled' FROM settings),
  'booking_cutover_reviewed', (SELECT value->'booking_cutover_reviewed' FROM settings),
  'post_booking_enabled', (SELECT value->'post_booking_enabled' FROM settings)
) AS readiness;
