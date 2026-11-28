import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RentalActionModal from '../RentalActionModal';
import type { Lead } from '@/types/sales';

/**
 * RentalActionModal Recovery, RequestId Idempotency & Guard-Safe UI Tests
 *
 * Requirement Coverage Mapping (after Phases 2-3 atomic PostgreSQL RPC migration):
 * - UI layer (this file):
 *   1. Cryptographic UUID (`randomUUID` + `getRandomValues` RFC-4122 fallback) for `p_request_id`
 *   2. Fail-closed behavior when Web Crypto is missing/throwing (0 mutations, preserves modal, permits retry)
 *   3. Exact `p_request_id` reuse across retries of the same convert_to_buy / move_out attempt after lost response / network error
 *   4. Fresh `p_request_id` generated when payload changes before retry (prevents idempotency conflict)
 *   5. Fail-closed error translation for stale/cancelled/conflicting/forbidden server responses (0 direct table fallback writes)
 *   6. Double-submit lock while request is in-flight
 *   7. Zero direct `plots` stock-column writes for `renew`, `move_out`, and `convert_to_buy` (`guard_booking_plot_stock` safe)
 * - Service layer (`lib/sales/__tests__/rentalTxClient.test.ts`):
 *   payload trimming, role guards, `createTxRequestId`, full `translateSalesTxError` mapping
 * - Database layer (`scripts/sales-runtime/phase2-rental-ownership-integration.mjs` on real PG17):
 *   Scenarios 4, 5, 7, 8, 14 verify server-side atomic rollback, `sales_private.rental_tx_requests` idempotency replay & payload mismatch,
 *   zero duplicate sales, zero vacant gap on convert_to_buy, and live `guard_booking_plot_stock` / `guard_cutover_sale` permits.
 */

type Row = Record<string, unknown> & { id: string };
type Result = { data: Row | Row[] | null; error: { message: string } | null; count?: number | null };
type Query = {
  table: string;
  action: 'read' | 'update' | 'insert';
  filters: { kind: 'eq' | 'neq' | 'in'; key: string; value: unknown }[];
  payload?: Record<string, unknown> | Record<string, unknown>[];
  columns?: string;
  single: boolean;
};

const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: mocks.from,
    rpc: (...args: any[]) => mocks.rpc(...args),
  },
}));

let database: Record<string, Row[]>;
let mutations: Query[];
let beforeWrite: ((query: Query) => Result | void) | undefined;

function matches(row: Row, query: Query) {
  return query.filters.every(({ kind, key, value }) => {
    if (kind === 'neq') return row[key] !== value;
    if (kind === 'in') return Array.isArray(value) && value.includes(row[key]);
    return (row[key] ?? null) === (value ?? null);
  });
}

function builder(table: string) {
  const query: Query = { table, action: 'read', filters: [], single: false };
  const api = {
    select(columns: string) { query.columns = columns; return api; },
    eq(key: string, value: unknown) { query.filters.push({ kind: 'eq', key, value }); return api; },
    is(key: string, value: unknown) { return api.eq(key, value); },
    neq(key: string, value: unknown) { query.filters.push({ kind: 'neq', key, value }); return api; },
    in(key: string, value: unknown[]) { query.filters.push({ kind: 'in', key, value }); return api; },
    order() { return api; },
    limit() { return api; },
    single() { query.single = true; return api; },
    maybeSingle() { query.single = true; return api; },
    update(payload: Record<string, unknown>) { query.action = 'update'; query.payload = payload; return api; },
    insert(payload: Record<string, unknown>[]) { query.action = 'insert'; query.payload = payload; return api; },
    then(resolve: (result: Result) => unknown, reject?: (error: unknown) => unknown) {
      return Promise.resolve().then((): Result => {
        if (query.action === 'read') {
          const rows = (database[table] || []).filter(row => matches(row, query)).map(row => {
            const snapshot = structuredClone(row);
            if (!query.columns || query.columns === '*') return snapshot;
            return Object.fromEntries(query.columns.split(',').map(key => key.trim())
              .filter(key => key in snapshot).map(key => [key, snapshot[key]])) as Row;
          });
          return { data: query.single ? rows[0] ?? null : rows, error: null };
        }
        const overridden = beforeWrite?.(query);
        mutations.push(structuredClone(query));
        if (overridden) return overridden;
        let rows: Row[];
        if (query.action === 'insert') {
          rows = (query.payload as Record<string, unknown>[]).map(payload => ({
            id: `generated-${mutations.length}`,
            ...payload,
          }));
          database[table].push(...rows);
        } else {
          rows = (database[table] || []).filter(row => matches(row, query));
          rows.forEach(row => Object.assign(row, query.payload));
        }
        return {
          data: query.single ? (rows[0] ? { id: rows[0].id } : null) : rows.map(row => ({ id: row.id })),
          error: null,
          count: rows.length,
        };
      }).then(resolve, reject);
    },
  };
  return api;
}

async function openModal() {
  const onSaved = vi.fn();
  const onClose = vi.fn();
  render(
    <RentalActionModal
      isOpen
      contractId="contract-1"
      lead={database.leads[0] as unknown as Lead}
      user={{ username: 'Sales A', role: 'Sales' }}
      onSaved={onSaved}
      onClose={onClose}
    />
  );
  await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());
  return { onSaved, onClose };
}

async function submitConvert() {
  await act(async () => {
    fireEvent.submit(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' }).closest('form')!);
  });
}

describe('RentalActionModal RPC Recovery, Idempotency & Guard Safety', () => {
  beforeEach(() => {
    mutations = [];
    beforeWrite = undefined;
    database = {
      rental_contracts: [{
        id: 'contract-1', lead_id: 'lead-1', plot_id: 'plot-1', plot_name: '1',
        project_name: 'Project', tenant_name: 'Alice', program_type: 'program_a', status: 'Active',
        monthly_rent: 15000, security_deposit: 30000, advance_rent: 15000, lease_duration_months: 12,
        lease_start_date: '2026-01-01', lease_end_date: '2027-01-01', created_at: '2026-01-01',
        base_price: 2000000, notes: 'Contract note', deal_revision: 'rev-c-1',
      }],
      leads: [{
        id: 'lead-1', customer_name: 'Alice', status: 'Rented', rental_status: 'Active',
        active_rental_contract_id: 'contract-1', notes: 'Lead note', deal_revision: 'rev-l-1',
      }],
      plots: [{
        id: 'plot-1', sale_status: 'Rented', has_customer: true, current_tenant_name: 'Alice',
        customer_name: 'Alice', monthly_rent: 15000, lease_end_date: '2027-01-01',
      }],
      sales: [],
    };
    mocks.from.mockReset().mockImplementation(builder);
    mocks.rpc.mockReset().mockImplementation(async (fnName: string) => {
      if (fnName === 'sales_tx_convert_rental_to_buy') {
        return {
          data: {
            command: 'rental_convert_to_buy',
            contractId: 'contract-1',
            leadId: 'lead-1',
            saleId: 'sale-created-1',
            plotId: 'plot-1',
            finalPurchasePrice: 2000000,
            appliedBookingCredit: 0,
            rentalStatus: 'ConvertedToBuy',
          },
          error: null,
        };
      }
      if (fnName === 'sales_tx_move_out_rental') {
        return {
          data: {
            command: 'rental_move_out',
            contractId: 'contract-1',
            leadId: 'lead-1',
            plotId: 'plot-1',
            depositRefunded: 30000,
            plotReleased: true,
            rentalStatus: 'MovedOut',
          },
          error: null,
        };
      }
      return { data: null, error: null };
    });
    vi.spyOn(window, 'alert').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('uses cryptographic getRandomValues UUID fallback for p_request_id before calling convert_to_buy RPC with zero direct writes', async () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => {
      expect(mutations).toHaveLength(0);
      expect(mocks.rpc).not.toHaveBeenCalled();
      bytes.fill(255);
      return bytes;
    });
    vi.stubGlobal('crypto', { getRandomValues });

    const { onSaved, onClose } = await openModal();
    await submitConvert();

    expect(getRandomValues).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith(
      'sales_tx_convert_rental_to_buy',
      expect.objectContaining({
        p_request_id: 'ffffffff-ffff-4fff-bfff-ffffffffffff',
        p_payload: expect.objectContaining({
          contractId: 'contract-1',
          leadId: 'lead-1',
          expectedContractRevision: 'rev-c-1',
          expectedLeadRevision: 'rev-l-1',
        }),
      })
    );
    expect(mutations).toHaveLength(0);
    expect(onSaved).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it.each(['missing', 'throwing', 'missing-crypto', 'native-throwing'] as const)(
    'does not mutate or call RPC when UUID generation is %s, and permits retry once crypto recovers',
    async failure => {
      const originalCrypto = globalThis.crypto;
      vi.stubGlobal(
        'crypto',
        failure === 'missing-crypto'
          ? undefined
          : failure === 'throwing'
            ? { getRandomValues: () => { throw new Error('Random source unavailable'); } }
            : failure === 'native-throwing'
              ? { randomUUID: () => { throw new Error('Random source unavailable'); } }
              : {}
      );

      const { onSaved, onClose } = await openModal();
      await submitConvert();

      expect(mocks.rpc).not.toHaveBeenCalled();
      expect(mutations).toHaveLength(0);
      expect(onSaved).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByText(/requestId|Random source unavailable|ไม่ถูกต้อง/)).toBeInTheDocument();

      vi.stubGlobal('crypto', originalCrypto);
      await submitConvert();
      expect(mocks.rpc).toHaveBeenCalledTimes(1);
      expect(onSaved).toHaveBeenCalledOnce();
      expect(onClose).toHaveBeenCalledOnce();
    }
  );

  it('reuses the exact p_request_id across retries after a lost response or transient failure, and mints a new ID when payload changes', async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: null, error: { message: 'Response lost after commit (network timeout)' } })
      .mockResolvedValueOnce({
        data: {
          command: 'rental_convert_to_buy',
          contractId: 'contract-1',
          leadId: 'lead-1',
          saleId: 'sale-1',
          plotId: 'plot-1',
          finalPurchasePrice: 2000000,
          appliedBookingCredit: 0,
          rentalStatus: 'ConvertedToBuy',
          replayed: true,
        },
        error: null,
      });

    const { onSaved, onClose } = await openModal();
    await submitConvert();

    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText(/Response lost after commit/)).toBeInTheDocument();

    // Retry with identical form values -> MUST reuse exact same p_request_id!
    await submitConvert();
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(mocks.rpc.mock.calls[0][1].p_request_id).toBe(mocks.rpc.mock.calls[1][1].p_request_id);
    expect(mutations).toHaveLength(0);
    expect(onSaved).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('mints a fresh p_request_id if user changes purchase price before retrying after failure', async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: null, error: { message: 'network timeout' } })
      .mockResolvedValueOnce({
        data: {
          command: 'rental_convert_to_buy',
          contractId: 'contract-1',
          leadId: 'lead-1',
          saleId: 'sale-1',
          plotId: 'plot-1',
          finalPurchasePrice: 2150000,
          appliedBookingCredit: 0,
          rentalStatus: 'ConvertedToBuy',
        },
        error: null,
      });

    const { onSaved } = await openModal();
    await submitConvert();
    expect(onSaved).not.toHaveBeenCalled();

    const priceInput = screen.getByDisplayValue('2000000');
    fireEvent.change(priceInput, { target: { value: '2150000' } });

    await submitConvert();
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(mocks.rpc.mock.calls[0][1].p_request_id).not.toBe(mocks.rpc.mock.calls[1][1].p_request_id);
    expect(mocks.rpc.mock.calls[1][1].p_payload.finalPurchasePrice).toBe(2150000);
    expect(onSaved).toHaveBeenCalledOnce();
  });

  it.each([
    ['SALES_TX_STALE_STATE', /มีการเปลี่ยนแปลงระหว่างเปิดหน้าจอ/],
    ['SALES_TX_CONFLICT', /สถานะข้อมูลลูกค้า สัญญา หรือแปลงขัดแย้งกัน/],
    ['SALES_TX_PLOT_HELD_BY_OTHER', /ลูกค้ารายอื่นถือสิทธิ์/],
    ['SALES_TX_FORBIDDEN', /ไม่มีสิทธิ์/],
  ])('fails closed on server %s without calling onSaved/onClose or falling back to direct writes', async (serverErr, expectedText) => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: serverErr } });
    const { onSaved, onClose } = await openModal();
    await submitConvert();

    expect(screen.getByText(expectedText)).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(mutations).toHaveLength(0);
  });

  it('blocks in-flight double submit on convert_to_buy so only one RPC executes', async () => {
    let resolveRpc!: (v: any) => void;
    mocks.rpc.mockReturnValueOnce(new Promise(res => { resolveRpc = res; }));

    const { onSaved } = await openModal();
    const form = screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' }).closest('form')!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveRpc({
        data: {
          command: 'rental_convert_to_buy',
          contractId: 'contract-1',
          leadId: 'lead-1',
          saleId: 'sale-1',
          plotId: 'plot-1',
          finalPurchasePrice: 2000000,
          appliedBookingCredit: 0,
          rentalStatus: 'ConvertedToBuy',
        },
        error: null,
      });
    });
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  });

  it('passes guard_booking_plot_stock on ready_for_sale plots for renew (no stock cols) and routes move_out & convert_to_buy via RPC with zero direct plot writes', async () => {
    beforeWrite = (query: Query) => {
      if (query.table === 'plots' && query.action === 'update') {
        const patch = query.payload as Record<string, unknown>;
        if ('sale_status' in patch || 'has_customer' in patch) {
          return { data: null, error: { message: 'EXTERNAL_WRITER_STOCK_COMMAND_REQUIRED' } };
        }
      }
      return undefined;
    };

    // 1. Renew on ready_for_sale plot (client renew never touches sale_status/has_customer)
    database.plots[0] = {
      id: 'plot-1', sale_status: 'ready_for_sale', has_customer: false,
      current_tenant_name: 'Alice', rental_program: 'program_a',
      monthly_rent: 15000, lease_start_date: '2026-01-01', lease_end_date: '2027-01-01',
      highlight_note: 'เช่า: Rent (Alice)',
    };
    const renewView = await openModal();
    fireEvent.click(screen.getByRole('button', { name: /ต่อสัญญาเช่า/i }));
    fireEvent.submit(screen.getByRole('button', { name: /ยืนยันต่อสัญญาเช่า/i }).closest('form')!);
    await waitFor(() => expect(renewView.onSaved).toHaveBeenCalledOnce());
    expect(database.plots[0].sale_status).toBe('ready_for_sale');
    expect(database.plots[0].has_customer).toBe(false);
    cleanup();

    // 2. Move out -> routes via atomic sales_tx_move_out_rental RPC with zero direct plot writes
    mutations = [];
    database.rental_contracts[0].status = 'Active';
    const moveOutView = await openModal();
    fireEvent.click(screen.getByRole('button', { name: /สิ้นสุดสัญญา/i }));
    fireEvent.submit(screen.getByRole('button', { name: /ยืนยันการย้ายออก/i }).closest('form')!);
    await waitFor(() => expect(moveOutView.onSaved).toHaveBeenCalledOnce());
    expect(mocks.rpc).toHaveBeenCalledWith('sales_tx_move_out_rental', expect.objectContaining({
      p_payload: expect.objectContaining({ contractId: 'contract-1', leadId: 'lead-1' }),
    }));
    expect(mutations.filter(m => m.table === 'plots')).toHaveLength(0);
    cleanup();

    // 3. Convert to buy -> routes via atomic sales_tx_convert_rental_to_buy RPC with zero direct plot writes
    mutations = [];
    const convertView = await openModal();
    await submitConvert();
    expect(convertView.onSaved).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith('sales_tx_convert_rental_to_buy', expect.objectContaining({
      p_payload: expect.objectContaining({ contractId: 'contract-1', leadId: 'lead-1' }),
    }));
    expect(mutations.filter(m => m.table === 'plots')).toHaveLength(0);
  });
});
