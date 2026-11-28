-- ==============================================================================
-- READ-ONLY SNAPSHOT EXPORT FOR RENTAL / PLOT RECONCILIATION DRY-RUN
-- ==============================================================================
-- Purpose:
--   Run this single read-only SELECT query in Supabase SQL Editor (or psql)
--   BEFORE applying the Phase 2/3 migrations.
--   Save the single JSON output object as `snapshot.json`, then run locally:
--
--     node scripts/sales-runtime/reconcile-rental-dry-run.mjs --input snapshot.json
--
-- Safety:
--   - 100% READ-ONLY (no INSERT / UPDATE / DELETE / DDL)
--   - Uses to_jsonb(...) extraction so missing optional columns never abort the query
--   - Excludes sensitive customer PII (phone/name are redacted to boolean/non-empty flags
--     except plot/contract/lead IDs needed for reconciliation)
-- ==============================================================================

SELECT jsonb_build_object(
  'exportedAt', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'plots', COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'id',                   p.id,
        'plot_name',            to_jsonb(p) ->> 'plot_name',
        'project_name',         p.project_name,
        'has_customer',         p.has_customer,
        'sale_status',          p.sale_status,
        'current_tenant_name',  CASE WHEN NULLIF(btrim(COALESCE(to_jsonb(p) ->> 'current_tenant_name', '')), '') IS NOT NULL THEN '[PRESENT]' ELSE NULL END,
        'current_tenant_phone', CASE WHEN NULLIF(btrim(COALESCE(to_jsonb(p) ->> 'current_tenant_phone', '')), '') IS NOT NULL THEN '[PRESENT]' ELSE NULL END,
        'rental_program',       to_jsonb(p) ->> 'rental_program',
        'monthly_rent',         to_jsonb(p) -> 'monthly_rent',
        'security_deposit',     to_jsonb(p) -> 'security_deposit',
        'lease_start_date',     to_jsonb(p) ->> 'lease_start_date',
        'lease_end_date',       to_jsonb(p) ->> 'lease_end_date',
        'highlight_note',       CASE
          WHEN btrim(COALESCE(to_jsonb(p) ->> 'highlight_note', '')) LIKE 'จองเช่า:%' THEN 'จองเช่า:[PRESENT]'
          WHEN btrim(COALESCE(to_jsonb(p) ->> 'highlight_note', '')) LIKE 'เช่า:%' THEN 'เช่า:[PRESENT]'
          ELSE NULL
        END
      )
      ORDER BY p.project_name, p.id
    )
    FROM public.plots p
  ), '[]'::jsonb),

  'sales', COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'id',              s.id,
        'lead_id',         to_jsonb(s) ->> 'lead_id',
        'plot_id',         s.plot_id,
        'crm_stage',       to_jsonb(s) ->> 'crm_stage',
        'contract_status', to_jsonb(s) ->> 'contract_status'
      )
      ORDER BY s.id
    )
    FROM public.sales s
  ), '[]'::jsonb),

  'rentalContracts', COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'id',           rc.id,
        'plot_id',      rc.plot_id,
        'project_name', to_jsonb(rc) ->> 'project_name',
        'lead_id',      to_jsonb(rc) ->> 'lead_id',
        'status',       rc.status
      )
      ORDER BY rc.id
    )
    FROM public.rental_contracts rc
  ), '[]'::jsonb),

  'leads', COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'id',                        l.id,
        'project_name',              to_jsonb(l) ->> 'project_name',
        'interested_plot_id',        to_jsonb(l) ->> 'interested_plot_id',
        'interested_plot_name',      to_jsonb(l) ->> 'interested_plot_name',
        'status',                    to_jsonb(l) ->> 'status',
        'crm_status',                to_jsonb(l) ->> 'crm_status',
        'rental_status',             to_jsonb(l) ->> 'rental_status',
        'deal_type',                 to_jsonb(l) ->> 'deal_type',
        'active_rental_contract_id', to_jsonb(l) ->> 'active_rental_contract_id'
      )
      ORDER BY l.id
    )
    FROM public.leads l
    WHERE NULLIF(btrim(COALESCE(to_jsonb(l) ->> 'interested_plot_id', '')), '') IS NOT NULL
       OR NULLIF(btrim(COALESCE(to_jsonb(l) ->> 'interested_plot_name', '')), '') IS NOT NULL
       OR NULLIF(btrim(COALESCE(to_jsonb(l) ->> 'rental_status', '')), '') IS NOT NULL
       OR NULLIF(btrim(COALESCE(to_jsonb(l) ->> 'active_rental_contract_id', '')), '') IS NOT NULL
  ), '[]'::jsonb)
) AS reconciliation_snapshot;
