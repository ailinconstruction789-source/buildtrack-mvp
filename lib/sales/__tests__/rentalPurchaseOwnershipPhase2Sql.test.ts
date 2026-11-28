// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  'supabase/migrations/20261125_rental_purchase_plot_ownership_transactions.sql',
  'utf8'
);
const code = source.replace(/--[^\r\n]*|\/\*[\s\S]*?\*\//g, '');

describe('Phase 2 SQL migration structural & security contracts', () => {
  it('never disables triggers, never drops tables, and never trusts JWT user_metadata for authorization', () => {
    expect(code).not.toMatch(/DISABLE\s+TRIGGER/i);
    expect(code).not.toMatch(/ENABLE\s+TRIGGER/i);
    expect(code).not.toMatch(/DROP\s+TABLE/i);
    expect(code).not.toMatch(/user_metadata/i);
    expect(code).not.toMatch(/service_role/i);
    expect(code).not.toMatch(/set_config\(/i);
  });

  it('locks down all private tables and helpers with RLS and REVOKE ALL FROM PUBLIC, anon, authenticated', () => {
    expect(code).toContain('ALTER TABLE sales_private.plot_stock_write_permits ENABLE ROW LEVEL SECURITY');
    expect(code).toContain('ALTER TABLE sales_private.sale_tx_write_permits ENABLE ROW LEVEL SECURITY');
    expect(code).toContain('ALTER TABLE sales_private.rental_tx_requests ENABLE ROW LEVEL SECURITY');
    expect(code).toContain('REVOKE ALL ON sales_private.plot_stock_write_permits');
    expect(code).toContain('FROM PUBLIC, anon, authenticated');
  });

  it('enforces shared advisory lock and consistent lock order across all transactional commands', () => {
    const sharedLock = "pg_advisory_xact_lock(hashtextextended('crm-booking-command', 0))";
    const rpcs = [
      'public.sales_tx_book_rental',
      'public.sales_tx_sign_rental_contract',
      'public.sales_tx_cancel_rental_booking',
      'public.sales_tx_move_out_rental',
      'public.sales_tx_convert_rental_to_buy',
      'public.sales_tx_book_purchase',
      'public.ensure_lead_sale_record',
    ];
    for (const rpc of rpcs) {
      const idx = code.indexOf(`CREATE OR REPLACE FUNCTION ${rpc}`);
      expect(idx, `Missing RPC ${rpc}`).toBeGreaterThan(-1);
      const nextIdx = code.indexOf('CREATE OR REPLACE FUNCTION ', idx + 30);
      const fnBody = nextIdx > -1 ? code.slice(idx, nextIdx) : code.slice(idx);
      expect(fnBody, `${rpc} must use shared advisory lock`).toContain(sharedLock);
      expect(fnBody, `${rpc} must call sales_private.require_sales_writer()`).toContain('sales_private.require_sales_writer()');
      expect(fnBody, `${rpc} must use SECURITY DEFINER with search_path = pg_catalog`).toContain('SECURITY DEFINER');
      expect(fnBody).toContain('SET search_path = pg_catalog');
      expect(fnBody, `${rpc} must revoke PUBLIC/anon execute`).toContain(`REVOKE ALL ON FUNCTION ${rpc}`);
      expect(fnBody, `${rpc} must grant authenticated execute`).toContain(`GRANT EXECUTE ON FUNCTION ${rpc}`);
    }
  });

  it('defines shared plot occupancy rules, partial unique indexes, and cross-table exclusivity triggers', () => {
    expect(code).toContain('CREATE UNIQUE INDEX IF NOT EXISTS sales_active_plot_unique_idx');
    expect(code).toContain('CREATE UNIQUE INDEX IF NOT EXISTS rental_contracts_active_or_pending_plot_unique_idx');
    expect(code).toContain('CREATE TRIGGER sales_phase2_guard_plot_stock');
    expect(code).toContain('CREATE TRIGGER sales_phase2_guard_sale_plot_exclusivity');
    expect(code).toContain('CREATE TRIGGER sales_phase2_guard_rental_contract_integrity');
    expect(code).toContain('SALES_PLOT_OCCUPIED_BY_RENTAL');
    expect(code).toContain('SALES_TX_CANNOT_CANCEL_ACTIVE_RENTAL');
    expect(code).toContain('CRM_RENTAL_DEAL_FORBIDDEN_IN_SALE_RPC');
  });

  it('never drops plots.has_customer to false inside sales_tx_convert_rental_to_buy', () => {
    const start = code.indexOf('CREATE OR REPLACE FUNCTION public.sales_tx_convert_rental_to_buy');
    const end = code.indexOf('CREATE OR REPLACE FUNCTION public.sales_tx_book_purchase');
    const convertFn = code.slice(start, end);
    expect(convertFn).toContain('has_customer = true');
    expect(convertFn).not.toMatch(/has_customer\s*=\s*false/i);
  });

  it('corrective migration 20261127 enforces legacy purchase holder, canonical plot scope, ended history, and scoped permits without DISABLE TRIGGER', () => {
    const correctiveRaw = readFileSync(
      'supabase/migrations/20261127_corrective_legacy_purchase_holder_guard.sql',
      'utf8'
    );
    const correctiveCode = correctiveRaw.replace(/--[^\r\n]*|\/\*[\s\S]*?\*\//g, '');
    expect(correctiveCode).not.toMatch(/DISABLE\s+TRIGGER/i);
    expect(correctiveCode).not.toMatch(/ENABLE\s+TRIGGER/i);
    expect(correctiveCode).not.toMatch(/DROP\s+TABLE/i);
    expect(correctiveCode).not.toMatch(/user_metadata/i);
    expect(correctiveCode).not.toMatch(/service_role/i);
    expect(correctiveCode).toContain('sales_private.lead_is_legacy_purchase_holder');
    expect(correctiveCode).toContain('sales_private.plot_has_ambiguous_legacy_reference');
    expect(correctiveCode).toContain('sales_private.plot_has_ended_deal_history');
    expect(correctiveCode).toContain("pg_advisory_xact_lock(hashtextextended('crm-booking-command', 0))");
    expect(correctiveCode).toContain('SALES_TX_AMBIGUOUS_PLOT');
    expect(correctiveCode).toContain('SALES_TX_PLOT_HELD_BY_OTHER');
    expect(correctiveCode).toContain('REVOKE ALL ON FUNCTION public.sales_tx_release_legacy_plot(uuid, jsonb) FROM PUBLIC, anon');
    expect(correctiveCode).toContain('GRANT EXECUTE ON FUNCTION public.sales_tx_release_legacy_plot(uuid, jsonb) TO authenticated');
  });

  it('corrective migration 20261128 orders permits before sales DML, wires sale_tx_permit_allowed into guard_cutover_sale, preserves legacy hooks, and checks unknown hooks', () => {
    const interopRaw = readFileSync(
      'supabase/migrations/20261128_corrective_stock_and_sale_guard_interop.sql',
      'utf8'
    );
    const interopCode = interopRaw.replace(/--[^\r\n]*|\/\*[\s\S]*?\*\//g, '');

    expect(interopCode).not.toMatch(/DISABLE\s+TRIGGER/i);
    expect(interopCode).not.toMatch(/ENABLE\s+TRIGGER/i);
    expect(interopCode).not.toMatch(/DROP\s+TABLE/i);
    expect(interopCode).not.toMatch(/user_metadata/i);
    expect(interopCode).not.toMatch(/service_role/i);

    // Preflight unknown-hook abort
    expect(interopCode).toContain('SALES_GUARD_INTEROP_UNKNOWN_DEPLOYED_HOOK');

    // Preserved legacy hooks across stock and sale guards
    expect(interopCode).toContain('sales_recovery_private.stock_allowed');
    expect(interopCode).toContain('sales_recovery_private.row_allowed');
    expect(interopCode).toContain('rental_source_retirement_private.plot_allowed');
    expect(interopCode).toContain('rental_source_retirement_private.sale_allowed');
    expect(interopCode).toContain('sales_revision_private.plot_allowed');
    expect(interopCode).toContain('sales_revision_private.allowed');
    expect(interopCode).toContain('NATIVE_SIDEBAR_STOCK_EVIDENCE_REQUIRED');

    // Active consumption of sale_tx_permit_allowed inside guard_cutover_sale
    const cutoverStart = interopCode.indexOf('CREATE OR REPLACE FUNCTION crm_external_private.guard_cutover_sale()');
    const cutoverEnd = interopCode.indexOf('$wire_cutover_sale_guard$;', cutoverStart);
    const cutoverFn = interopCode.slice(cutoverStart, cutoverEnd);
    expect(cutoverFn).toContain('sales_private.sale_tx_permit_allowed(TG_OP, v_old_json, v_new_json)');
    expect(cutoverFn.indexOf("IF TG_OP = 'TRUNCATE'")).toBeLessThan(cutoverFn.indexOf('pg_catalog.to_jsonb(OLD)'));

    // Permit issuance BEFORE sales DML in all three purchase/convert RPCs
    for (const rpc of [
      'public.sales_tx_book_purchase',
      'public.sales_tx_convert_rental_to_buy',
      'public.ensure_lead_sale_record',
    ]) {
      const start = interopCode.indexOf(`CREATE OR REPLACE FUNCTION ${rpc}`);
      const next = interopCode.indexOf('CREATE OR REPLACE FUNCTION ', start + 30);
      const body = next > -1 ? interopCode.slice(start, next) : interopCode.slice(start);
      const stockPermitIdx = body.indexOf('INSERT INTO sales_private.plot_stock_write_permits');
      const salePermitIdx = body.indexOf('INSERT INTO sales_private.sale_tx_write_permits');
      const salesInsertIdx = body.indexOf('INSERT INTO public.sales');
      expect(stockPermitIdx, `${rpc} must issue plot_stock_write_permits`).toBeGreaterThan(-1);
      expect(salePermitIdx, `${rpc} must issue sale_tx_write_permits`).toBeGreaterThan(-1);
      expect(salesInsertIdx, `${rpc} must write public.sales`).toBeGreaterThan(-1);
      expect(stockPermitIdx, `${rpc} must issue plot stock permit BEFORE INSERT INTO public.sales`).toBeLessThan(salesInsertIdx);
      expect(salePermitIdx, `${rpc} must issue sale tx permit BEFORE INSERT INTO public.sales`).toBeLessThan(salesInsertIdx);
    }
  });

  it('corrective migration 20261129 enforces non-empty cancel reason server-side and separates actor from reason', () => {
    const cancelReasonRaw = readFileSync(
      'supabase/migrations/20261129_corrective_cancel_rental_reason_required.sql',
      'utf8'
    );
    const cancelReasonCode = cancelReasonRaw.replace(/--[^\r\n]*|\/\*[\s\S]*?\*\//g, '');

    expect(cancelReasonCode).not.toMatch(/DISABLE\s+TRIGGER/i);
    expect(cancelReasonCode).not.toMatch(/ENABLE\s+TRIGGER/i);
    expect(cancelReasonCode).not.toMatch(/DROP\s+TABLE/i);
    expect(cancelReasonCode).not.toMatch(/user_metadata/i);
    expect(cancelReasonCode).not.toMatch(/service_role/i);

    expect(cancelReasonCode).toContain('SALES_TX_CANCEL_REASON_REQUIRED');
    expect(cancelReasonCode).toContain('SALES_TX_CANNOT_CANCEL_ACTIVE_RENTAL');
    expect(cancelReasonCode).toContain('lost_reason = v_reason');
    expect(cancelReasonCode).toContain('lost_reason_detail = v_actor_detail');
    expect(cancelReasonCode).toContain('REVOKE ALL ON FUNCTION public.sales_tx_cancel_rental_booking(uuid, jsonb) FROM PUBLIC, anon');
    expect(cancelReasonCode).toContain('GRANT EXECUTE ON FUNCTION public.sales_tx_cancel_rental_booking(uuid, jsonb) TO authenticated');
  });
});
