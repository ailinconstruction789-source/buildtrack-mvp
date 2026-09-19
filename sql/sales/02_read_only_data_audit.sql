-- SALES V2 / STEP 2: READ-ONLY AGGREGATE COUNTS. No personal row data is returned.
-- Run ONLY after step 1 confirms public.projects/plots/leads/sales/customer_voices.
-- Counts are review signals, NOT instructions to delete, merge or correct records.
-- JSON extraction tolerates optional legacy columns and TEXT/UUID identifiers.
-- This can scan the five tables; use a quiet period for a large database.
WITH leads_snapshot AS (
  SELECT to_jsonb(l) AS payload FROM public.leads l
), sales_snapshot AS (
  SELECT to_jsonb(s) AS payload FROM public.sales s
), plots_snapshot AS (
  SELECT to_jsonb(p) AS payload FROM public.plots p
), projects_snapshot AS (
  SELECT to_jsonb(p) AS payload FROM public.projects p
), voices_snapshot AS (
  SELECT to_jsonb(v) AS payload FROM public.customer_voices v
), phone_digits AS (
  SELECT regexp_replace(COALESCE(payload->>'phone',''),'[^0-9]','','g') AS digits FROM leads_snapshot
), normalized_phones AS (
  SELECT CASE
    WHEN length(digits) IN (12,13) AND digits LIKE '0066%' THEN '0'||substring(digits FROM 5)
    WHEN length(digits) IN (10,11) AND digits LIKE '66%' THEN '0'||substring(digits FROM 3)
    ELSE digits
  END AS phone_key FROM phone_digits
), active_sales AS (
  -- Unknown status is conservatively considered occupied; never silently released.
  SELECT payload FROM sales_snapshot
  WHERE lower(btrim(COALESCE(NULLIF(payload->>'crm_stage',''),payload->>'contract_status','unknown'))) <> 'cancelled'
), counts AS (
  SELECT
    (SELECT count(*) FROM leads_snapshot) AS legacy_leads,
    (SELECT count(*) FROM sales_snapshot) AS legacy_sales,
    (SELECT count(*) FROM plots_snapshot) AS plots,
    (SELECT count(*) FROM voices_snapshot) AS legacy_voices,
    (SELECT count(*) FROM leads_snapshot WHERE NULLIF(btrim(payload->>'customer_name'),'') IS NULL
       OR regexp_replace(COALESCE(payload->>'phone',''),'[^0-9]','','g')='') AS leads_missing_name_or_phone,
    (SELECT count(*) FROM leads_snapshot WHERE NULLIF(payload->>'lead_date','') IS NULL) AS leads_missing_original_lead_date,
    (SELECT count(*) FROM leads_snapshot WHERE NULLIF(btrim(payload->>'agent_name'),'') IS NULL) AS leads_missing_legacy_agent_name,
    (SELECT count(*) FROM (SELECT phone_key FROM normalized_phones WHERE phone_key<>'' GROUP BY phone_key HAVING count(*)>1) d) AS shared_or_duplicate_phone_groups,
    (SELECT count(*) FROM (SELECT payload->>'name' FROM projects_snapshot GROUP BY payload->>'name' HAVING count(*)>1) d) AS duplicate_project_name_groups,
    (SELECT count(*) FROM (SELECT payload->>'plot_id' FROM active_sales WHERE NULLIF(payload->>'plot_id','') IS NOT NULL
       GROUP BY payload->>'plot_id' HAVING count(*)>1) d) AS plots_with_multiple_active_sales,
    (SELECT count(*) FROM (SELECT payload->>'lead_id' FROM sales_snapshot WHERE NULLIF(payload->>'lead_id','') IS NOT NULL
       GROUP BY payload->>'lead_id' HAVING count(*)>1) d) AS leads_with_multiple_sale_rows,
    (SELECT count(*) FROM active_sales WHERE NULLIF(btrim(payload->>'cancellation_reason'),'') IS NOT NULL) AS active_sales_with_cancellation_reason,
    (SELECT count(*) FROM active_sales WHERE lower(COALESCE(payload->>'bank_status',''))='rejected') AS active_sales_with_rejected_loan,
    (SELECT count(*) FROM active_sales WHERE NULLIF(payload->>'plot_id','') IS NULL) AS active_sales_without_plot,
    (SELECT count(*) FROM sales_snapshot s WHERE NULLIF(s.payload->>'plot_id','') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM plots_snapshot p WHERE p.payload->>'id'=s.payload->>'plot_id')) AS sales_referencing_missing_plot,
    (SELECT count(*) FROM plots_snapshot p WHERE p.payload->>'has_customer'='false'
       AND EXISTS (SELECT 1 FROM active_sales s WHERE s.payload->>'plot_id'=p.payload->>'id')) AS vacant_flag_with_active_sale,
    (SELECT count(*) FROM plots_snapshot p WHERE p.payload->>'has_customer'='true'
       AND NOT EXISTS (SELECT 1 FROM active_sales s WHERE s.payload->>'plot_id'=p.payload->>'id')) AS occupied_flag_without_active_sale,
    (SELECT count(*) FROM sales_snapshot WHERE lower(COALESCE(payload->>'contract_status',''))='transferred'
       AND NULLIF(payload->>'transferred_at','') IS NULL) AS transferred_sales_missing_date,
    (SELECT count(*) FROM (SELECT payload->>'lead_id' FROM voices_snapshot WHERE NULLIF(payload->>'lead_id','') IS NOT NULL
       GROUP BY payload->>'lead_id' HAVING count(*)>1) d) AS leads_with_multiple_voice_rows,
    (SELECT count(*) FROM voices_snapshot WHERE NULLIF(payload->>'visit_id','') IS NOT NULL) AS voices_already_linked_to_v2_visit
)
SELECT jsonb_pretty(jsonb_build_object(
  'report_version','sales-v2-data-audit-2026-09-15',
  'generated_at',CURRENT_TIMESTAMP,
  'counts',(SELECT to_jsonb(c) FROM counts c),
  'notice','Counts only. Shared phone does not prove duplicate person. Unknown money and event dates require source review; do not infer from zero/defaults.'
)) AS data_audit_report;
