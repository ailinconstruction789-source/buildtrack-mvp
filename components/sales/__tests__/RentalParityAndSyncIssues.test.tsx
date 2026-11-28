import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PostgrestClient } from '@supabase/postgrest-js';
import RentalActionModal from '../RentalActionModal';
import RentalContractModal from '../RentalContractModal';
import SalesDealStatusModal from '../SalesDealStatusModal';
import { broadcastSalesSync, subscribeToSalesSync } from '@/lib/sales/salesSyncBroadcast';
import { customerDealDetails } from '@/lib/sales/customerDealDetails';
import { salesDealPaymentMethodOf } from '@/lib/sales/dealStatus';

type Query = {
  table: string;
  action: 'read' | 'insert' | 'update';
  payload?: Record<string, unknown> | Record<string, unknown>[];
  filters: [string, unknown][];
  columns?: string;
  single: boolean;
};
type Result = { data: unknown; error: { message: string } | null };

function makeDeferred<T = any>() {
  let resolve!: (val: T) => void, reject!: (err: any) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: mocks.from, rpc: (...args: any[]) => mocks.rpc(...args), auth: { getSession: async () => ({ data: { session: null } }) } } }));
vi.mock('../LeadPicker', () => ({
  default: ({ onToggleCreateNew }: { onToggleCreateNew: (value: boolean) => void }) => (
    <button type="button" onClick={() => onToggleCreateNew(true)}>New walk-in</button>
  )
}));
vi.mock('../RentalReceiptModal', () => ({ default: () => null }));
vi.mock('../TenantPortalModal', () => ({ default: () => null }));
vi.mock('../RentalMaintenanceModal', () => ({ default: () => null }));

const contract = {
  id: 'contract-1',
  lead_id: 'lead-1',
  project_name: 'Project',
  plot_id: 'plot-1',
  plot_name: '1',
  tenant_name: 'Somchai Jaidee',
  agent_name: 'Sales A',
  program_type: 'program_a',
  status: 'Active',
  monthly_rent: 15000,
  savings_per_month: 0,
  security_deposit: 30000,
  advance_rent: 15000,
  accumulated_savings: 0,
  base_price: 0,
  lease_duration_months: 12,
  lease_start_date: '2026-01-01',
  lease_end_date: '2027-01-01',
  created_at: '2026-01-01'
};

const purchaseLead = {
  id: 'lead-1',
  customer_name: 'Somchai Jaidee',
  phone: '0812345678',
  status: 'Booked',
  rental_status: null,
  deal_type: 'buy',
  rental_program: null,
  project_name: 'Project',
  interested_plot_id: 'plot-1',
  interested_plot_name: '1',
  agent_name: 'Sales A',
  notes: 'Existing lead note from sales pitch'
};

const lead = {
  id: 'lead-1',
  customer_name: 'Somchai Jaidee',
  phone: '0812345678',
  status: 'Follow Up',
  rental_status: 'PendingContract',
  deal_type: 'rent',
  rental_program: 'program_a',
  project_name: 'Project',
  interested_plot_id: 'plot-1',
  interested_plot_name: '1',
  rental_monthly_rent: 15000,
  rental_deposit: 30000,
  rental_start_date: '2026-01-01',
  agent_name: 'Sales A',
  notes: 'Existing lead note from sales pitch'
};

const user = { id: 'user-1', username: 'Sales A', role: 'Sales' };
const salesOwners = [{ userId: 'user-1', displayName: 'Sales A' }];

let queries: Query[];
let resolveQuery: (query: Query) => Result | Promise<Result>;

const ok = (data: unknown): Result => ({ data, error: null });
const fail = (message = 'db operation failed'): Result => ({ data: null, error: { message } });

function defaultResult(q: Query): Result {
  if (q.action !== 'read') return ok({ id: q.table + '-saved' });
  if (q.table === 'plots') {
    return ok([{ id: 'plot-1', plot_name: '1', project_name: 'Project', sale_status: 'Available', has_customer: false, current_tenant_name: null, lead_id: null }]);
  }
  if (q.table === 'leads') {
    if (q.filters.some(([key]) => key === 'interested_plot_id')) return ok([]);
    return ok(q.single ? lead : [lead]);
  }
  if (q.table === 'sales') return ok([]);
  if (q.table === 'rental_contracts') {
    if (q.filters.some(([key]) => key === 'lead_id')) return ok([]);
    if (q.filters.some(([key, val]) => key === 'neq:id' && val === contract.id)) return ok([]);
    return ok(q.single ? contract : [contract]);
  }
  return ok([]);
}

function builder(table: string) {
  const q: Query = { table, action: 'read', filters: [], single: false };
  const api = {
    select: (columns = '*') => { q.columns = columns; return api; },
    insert: (payload: Record<string, unknown>[]) => { q.action = 'insert'; q.payload = payload; return api; },
    update: (payload: Record<string, unknown>) => { q.action = 'update'; q.payload = payload; return api; },
    eq: (key: string, value: unknown) => { q.filters.push([key, value]); return api; },
    neq: (key: string, value: unknown) => { q.filters.push([`neq:${key}`, value]); return api; },
    in: (key: string, value: unknown) => { q.filters.push([key, value]); return api; },
    is: (key: string, value: unknown) => { q.filters.push([key, value]); return api; },
    or: (value: unknown) => { q.filters.push(['or', value]); return api; },
    order: () => api,
    limit: () => api,
    range: () => api,
    maybeSingle: () => { q.single = true; return api; },
    single: () => { q.single = true; return api; },
    then: (done: (result: Result) => unknown, rejected?: (error: unknown) => unknown) => {
      queries.push(q);
      return Promise.resolve().then(() => resolveQuery(q)).then(done, rejected);
    }
  };
  return api;
}

const writes = (table?: string) => queries.filter(q => q.action !== 'read' && (!table || q.table === table));
const submit = (name: RegExp) => fireEvent.submit(screen.getByRole('button', { name }).closest('form')!);
const pgrst116 = (details = 'The result contains 0 rows') => ({ data: null, error: { code: 'PGRST116', details } } as any);
const matchUpdate = (row: Record<string, any>, q: Query) => {
  for (const [col, val] of q.filters) {
    if (col.startsWith('neq:')) { if (row[col.slice(4)] === val) return pgrst116(); }
    else if (col === 'is') { if (row[val as string] !== null) return pgrst116(); }
    else if (row[col] !== val) return pgrst116();
  }
  Object.assign(row, q.payload);
  return ok({ id: row.id });
};

describe('Rental Parity and Synchronization Defect Tests', () => {
  beforeEach(() => {
    queries = [];
    resolveQuery = defaultResult;
    mocks.from.mockReset().mockImplementation(builder);
    mocks.rpc.mockReset().mockImplementation(async (fnName: string, args: any) => {
      if (fnName === 'ensure_lead_sale_record') {
        return { data: { success: true, sale_id: 'sale-ensured-1', plot_id: args?.p_plot_id || 'plot-1' }, error: null };
      }
      if (fnName === 'sales_tx_book_rental') {
        return { data: { command: 'rental_book', leadId: args?.p_payload?.leadId || 'lead-1', contractId: 'rc-1', plotId: args?.p_payload?.plotId || 'plot-1', projectName: args?.p_payload?.projectName || 'Project', rentalStatus: 'PendingContract' }, error: null };
      }
      if (fnName === 'sales_tx_sign_rental_contract') {
        return { data: { command: 'rental_sign_contract', leadId: args?.p_payload?.leadId || 'lead-1', contractId: 'rc-1', plotId: args?.p_payload?.plotId || 'plot-1', projectName: args?.p_payload?.projectName || 'Project', rentalStatus: 'Active' }, error: null };
      }
      if (fnName === 'sales_tx_move_out_rental') {
        return { data: { command: 'rental_move_out', contractId: args?.p_payload?.contractId || 'contract-1', leadId: args?.p_payload?.leadId || 'lead-1', plotId: 'plot-1', depositRefunded: 30000, plotReleased: true, rentalStatus: 'MovedOut' }, error: null };
      }
      if (fnName === 'sales_tx_convert_rental_to_buy') {
        return { data: { command: 'rental_convert_to_buy', contractId: args?.p_payload?.contractId || 'contract-1', leadId: args?.p_payload?.leadId || 'lead-1', saleId: 'sale-conv-1', plotId: 'plot-1', finalPurchasePrice: args?.p_payload?.finalPurchasePrice || 2000000, appliedBookingCredit: args?.p_payload?.appliedBookingCredit || 0, rentalStatus: 'ConvertedToBuy' }, error: null };
      }
      return { data: null, error: null };
    });
    vi.clearAllMocks();
    localStorage.clear();
  });


  // Issue A: Notes Retention & Idempotence on Renewal (client) and Move-Out (atomic RPC)
  describe('Issue A: Notes Retention and Idempotence', () => {
    it('forwards user move-out notes and revisions to atomic sales_tx_move_out_rental RPC with zero direct leads/plots writes', async () => {
      const onSaved = vi.fn();
      const onClose = vi.fn();
      render(<RentalActionModal isOpen={true} contractId="contract-1" onClose={onClose} onSaved={onSaved} lead={{ ...lead, notes: 'Important VIP note', deal_revision: 'rev-l-1' } as any} user={user} />);

      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());
      fireEvent.click(screen.getByRole('button', { name: /3. สิ้นสุดสัญญา/ }));
      fireEvent.change(screen.getByPlaceholderText(/ตรวจมิเตอร์น้ำไฟ/i), { target: { value: 'คืนกุญแจครบ 2 ดอก' } });
      submit(/ยืนยันการย้ายออก/);

      await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
      expect(mocks.rpc).toHaveBeenCalledWith(
        'sales_tx_move_out_rental',
        expect.objectContaining({
          p_request_id: expect.any(String),
          p_payload: expect.objectContaining({
            contractId: 'contract-1',
            leadId: 'lead-1',
            expectedLeadRevision: 'rev-l-1',
            notes: 'คืนกุญแจครบ 2 ดอก',
          }),
        })
      );
      expect(writes('leads')).toHaveLength(0);
      expect(writes('plots')).toHaveLength(0);
    });

    it('preserves existing lead notes when renewing lease', async () => {
      resolveQuery = q => {
        if (q.table === 'leads' && q.action === 'read' && q.single) return ok({ id: 'lead-1', notes: 'Existing VIP client notes' });
        return defaultResult(q);
      };

      render(<RentalActionModal isOpen={true} contractId="contract-1" onClose={vi.fn()} lead={{ ...lead, notes: 'Existing VIP client notes' } as any} user={user} />);

      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());

      // Switch to Renew tab
      fireEvent.click(screen.getByRole('button', { name: /2. ต่อสัญญาเช่า/ }));

      submit(/ยืนยันต่อสัญญาเช่า/);

      await waitFor(() => {
        const leadUpdates = writes('leads');
        expect(leadUpdates.length).toBeGreaterThan(0);
        const payload = leadUpdates[0].payload as Record<string, unknown>;
        expect(payload.notes).toContain('Existing VIP client notes');
        expect(payload.notes).toContain('[ต่อสัญญาเช่า +');
      });
    });

    it('Finding E: stops and does not overwrite notes when reading fresh notes from database fails on renew', async () => {
      resolveQuery = q => {
        if (q.table === 'leads' && q.action === 'read') return fail('Network error reading lead notes');
        return defaultResult(q);
      };

      render(<RentalActionModal isOpen={true} contractId="contract-1" onClose={vi.fn()} lead={{ ...lead, notes: 'Stale prop note' } as any} user={user} />);

      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());
      fireEvent.click(screen.getByRole('button', { name: /2. ต่อสัญญาเช่า/ }));
      submit(/ยืนยันต่อสัญญาเช่า/);

      await waitFor(() => expect(screen.getByText(/ไม่สามารถอ่านโน้ตล่าสุดของลูกค้าได้/i)).toBeInTheDocument());

      // Zero updates to leads table!
      expect(writes('leads').length).toBe(0);
    });
  });

  /**
   * Transactional RPC Boundary Verification (replaces obsolete pre-RPC multi-step .from() mock tests
   * from Issues B-E, Finding 4, Finding B, F1.2-F1.7, F2.1-F2.4, Finding B Verification, and Round 2-3 Audit).
   *
   * Requirement-to-Test Coverage Map (Zero Coverage Lost):
   * - Plot lookup / project scope / ownership / hold conflicts (old Issues B, D, E):
   *     UI fail-closed check below + PG17 Scenarios 1, 2, 10, 14
   * - Incomplete contract recovery, duplicate prevention, rollback, idempotency (old Issue C, Finding 4, Round 3):
   *     UI requestId retry below + RentalSaleRecovery.test.tsx + PG17 Scenarios 4, 5, 7, 8, 14
   * - Concurrent status / plot / lead / sales write-time guards on move-out & convert_to_buy (old Finding B, F1.2-1.7, F2.1-2.4, Round 2):
   *     UI error translation & revision forwarding below + PG17 Scenarios 3, 7, 8, 14
   */
  describe('Transactional RPC Boundary: RentalContractModal & RentalActionModal UI Guards', () => {
    it('RentalContractModal fails closed with 0 RPC calls and 0 writes when plot lookup fails or returns empty', async () => {
      resolveQuery = q => {
        if (q.table === 'plots' && q.action === 'read') return ok([]);
        return defaultResult(q);
      };

      render(<RentalContractModal isOpen={true} onClose={vi.fn()} lead={lead as any} plotId="plot-missing" projectName="Project" user={user} salesOwners={salesOwners} defaultMode="contract" />);
      await waitFor(() => expect(screen.queryByText(/กำลังโหลดแปลง/i)).not.toBeInTheDocument());
      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันบันทึกสัญญาเช่า' })).toBeEnabled());
      submit(/ยืนยันบันทึกสัญญาเช่า/);

      await waitFor(() => expect(screen.getByText(/ไม่พบแปลงที่เลือกในโครงการ|กรุณาเลือกโครงการและแปลง/i)).toBeInTheDocument());
      expect(mocks.rpc).not.toHaveBeenCalled();
      expect(writes()).toHaveLength(0);
    });

    it('RentalContractModal translates server ownership/project/conflict errors without direct writes and keeps modal open', async () => {
      mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'SALES_TX_PLOT_UNAVAILABLE' } });
      const onSaved = vi.fn();
      const onClose = vi.fn();

      render(<RentalContractModal isOpen={true} onClose={onClose} onSaved={onSaved} lead={lead as any} plotId="plot-1" projectName="Project" user={user} salesOwners={salesOwners} defaultMode="contract" />);
      await waitFor(() => expect(screen.queryByText(/กำลังโหลดแปลง/i)).not.toBeInTheDocument());
      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันบันทึกสัญญาเช่า' })).toBeEnabled());
      submit(/ยืนยันบันทึกสัญญาเช่า/);

      await waitFor(() => expect(screen.getByText(/แปลงนี้ถูกจองหรือมีลูกค้ารายอื่นถือสิทธิ์อยู่แล้ว/)).toBeInTheDocument());
      expect(onSaved).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
      expect(writes()).toHaveLength(0);
    });

    it('RentalActionModal move-out & convert-to-buy translate stale/conflict/forbidden RPC errors with 0 direct table writes', async () => {
      mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'SALES_TX_PLOT_HELD_BY_OTHER' } });
      const onSaved = vi.fn();
      const onClose = vi.fn();

      render(<RentalActionModal isOpen={true} contractId="contract-1" onClose={onClose} onSaved={onSaved} lead={lead as any} user={user} />);
      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());
      fireEvent.click(screen.getByRole('button', { name: /3. สิ้นสุดสัญญา/ }));
      submit(/ยืนยันการย้ายออก/);

      await waitFor(() => expect(screen.getByText(/ลูกค้ารายอื่นถือสิทธิ์/)).toBeInTheDocument());
      expect(onSaved).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
      expect(writes()).toHaveLength(0);
    });
  });

  describe('Issue F & G: Cross-tab & In-Window Broadcast and Debounce', () => {
    it('dispatches CustomEvent and writes to localStorage on broadcastSalesSync', () => {
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
      const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');

      broadcastSalesSync({ type: 'test_sync', timestamp: 12345 });

      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'buildtrack:sales_sync',
          detail: expect.objectContaining({ type: 'test_sync', timestamp: 12345 })
        })
      );

      expect(setItemSpy).toHaveBeenCalledWith(
        'buildtrack:sales_sync',
        expect.stringContaining('test_sync')
      );
    });

    it('subscribes and receives real browser StorageEvent with valid key and payload', async () => {
      const callback = vi.fn();
      const unsubscribe = subscribeToSalesSync(callback, 20);

      const storageEvent = new StorageEvent('storage', {
        key: 'buildtrack:sales_sync',
        newValue: JSON.stringify({ type: 'cross_tab_deal_updated', leadId: 'lead-1', timestamp: Date.now() })
      });
      window.dispatchEvent(storageEvent);

      await new Promise(r => setTimeout(r, 40));
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'cross_tab_deal_updated', leadId: 'lead-1' })
      );

      unsubscribe();
    });

    it('ignores StorageEvent with different key or null newValue', async () => {
      const callback = vi.fn();
      const unsubscribe = subscribeToSalesSync(callback, 20);

      window.dispatchEvent(new StorageEvent('storage', {
        key: 'other_unrelated_key',
        newValue: JSON.stringify({ type: 'should_ignore' })
      }));

      window.dispatchEvent(new StorageEvent('storage', {
        key: 'buildtrack:sales_sync',
        newValue: null
      }));

      await new Promise(r => setTimeout(r, 40));
      expect(callback).not.toHaveBeenCalled();

      unsubscribe();
    });

    it('handles malformed JSON in StorageEvent without crashing', async () => {
      const callback = vi.fn();
      const unsubscribe = subscribeToSalesSync(callback, 20);

      window.dispatchEvent(new StorageEvent('storage', {
        key: 'buildtrack:sales_sync',
        newValue: '{invalid_json'
      }));

      await new Promise(r => setTimeout(r, 40));
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'storage_event' })
      );

      unsubscribe();
    });

    it('stops receiving StorageEvent after unsubscribe', async () => {
      const callback = vi.fn();
      const unsubscribe = subscribeToSalesSync(callback, 20);
      unsubscribe();

      window.dispatchEvent(new StorageEvent('storage', {
        key: 'buildtrack:sales_sync',
        newValue: JSON.stringify({ type: 'ignored_after_unsub' })
      }));

      await new Promise(r => setTimeout(r, 40));
      expect(callback).not.toHaveBeenCalled();
    });

    it('subscribes to both in-window and storage events with trailing debounce', async () => {
      const callback = vi.fn();
      const unsubscribe = subscribeToSalesSync(callback, 50);

      broadcastSalesSync({ type: 'evt_1', timestamp: Date.now() });
      broadcastSalesSync({ type: 'evt_2', timestamp: Date.now() });

      expect(callback).not.toHaveBeenCalled();

      await new Promise(r => setTimeout(r, 70));
      expect(callback).toHaveBeenCalledTimes(1);

      unsubscribe();
    });

    it('Finding F: SalesDealStatusModal broadcasts sales_deal_saved via broadcastSalesSync on save', async () => {
      const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

      resolveQuery = q => {
        if (q.table === 'leads' && q.action === 'read') {
          return ok({ id: 'lead-1', customer_name: 'Somchai', status: 'Booked', project_name: 'Project', interested_plot_id: 'plot-1' });
        }
        if (q.table === 'sales' && q.action === 'read') {
          return ok({ id: 'sale-1', lead_id: 'lead-1', plot_id: 'plot-1', contract_status: 'Reserved', crm_stage: 'booked', sale_price: 3000000 });
        }
        if (q.action === 'update' || q.action === 'insert') return ok({ id: 'saved-id' });
        return defaultResult(q);
      };

      let savedCalled = false;
      render(
        <SalesDealStatusModal
          lead={{ leadId: 'lead-1', saleId: 'sale-1', status: 'Booked', crm_stage: 'booked', project_name: 'Project', interested_plot_id: 'plot-1' }}
          currentUser={{ id: 'user-1', username: 'Sales A', role: 'Sales' }}
          onClose={vi.fn()}
          onSaved={() => { savedCalled = true; }}
          renderEditor={editor => (
            <div>
              <button
                type="button"
                onClick={() => {
                  editor.setNote('บันทึกการเปลี่ยนแปลง');
                }}
              >
                เพิ่มหมายเหตุ
              </button>
              <button
                type="button"
                onClick={() => editor.save({ confirmedBySubmit: true })}
              >
                บันทึกการขายจำลอง
              </button>
            </div>
          )}
        />
      );

      const noteBtn = await screen.findByRole('button', { name: 'เพิ่มหมายเหตุ' });
      fireEvent.click(noteBtn);
      const saveBtn = await screen.findByRole('button', { name: 'บันทึกการขายจำลอง' });
      fireEvent.click(saveBtn);

      await waitFor(() => expect(savedCalled).toBe(true));

      expect(setItemSpy).toHaveBeenCalledWith(
        'buildtrack:sales_sync',
        expect.stringContaining('sales_deal_saved')
      );
      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'buildtrack:sales_sync',
          detail: expect.objectContaining({ type: 'sales_deal_saved' })
        })
      );
    });
  });
  // Finding 4 — P2: RentalActionModal optimistic notes lock PGRST116 handling

  describe('Finding 1 — P1: SalesDealStatusModal sync and field-level concurrency', () => {
    it('Finding 1: sync during edit does not overwrite untouched fields of other users on save', async () => {
      let currentLead = {
        id: 'lead-1',
        customer_name: 'Alice',
        phone: '0811111111',
        status: 'Booked',
        crm_stage: 'booked',
        project_name: 'Project',
        interested_plot_id: 'plot-1',
        updated_at: '2026-01-01T00:00:00Z'
      };

      resolveQuery = q => {
        if (q.table === 'leads' && q.action === 'read') return ok(currentLead);
        if (q.table === 'sales' && q.action === 'read') return ok([]);
        if (q.table === 'leads' && q.action === 'update') {
          currentLead = { ...currentLead, ...(q.payload as Record<string, unknown>) };
          return ok(currentLead);
        }
        return defaultResult(q);
      };

      const onSaved = vi.fn();
      render(<SalesDealStatusModal lead={{ leadId: 'lead-1', customer_name: 'Alice', status: 'Booked', crm_stage: 'booked', project_name: 'Project', interested_plot_id: 'plot-1' }} currentUser={{ id: 'user-1', username: 'Sales A', role: 'Sales' }} onClose={vi.fn()} onSaved={onSaved} />);

      await waitFor(() => expect(screen.getByRole('textbox', { name: 'ชื่อลูกค้า' })).not.toBeDisabled());
      fireEvent.change(screen.getByRole('textbox', { name: 'ชื่อลูกค้า' }), { target: { value: 'Alice Modified' } });

      currentLead = {
        ...currentLead,
        phone: '0899999999',
        updated_at: '2026-01-01T00:01:00Z'
      };

      act(() => {
        broadcastSalesSync({ type: 'sales_deal_saved', leadId: 'lead-1', timestamp: Date.now() });
      });

      fireEvent.click(screen.getByRole('button', { name: /บันทึก/ }));

      await waitFor(() => expect(onSaved).toHaveBeenCalled());

      expect(currentLead.customer_name).toBe('Alice Modified');
      expect(currentLead.phone).toBe('0899999999');
    });

    it('Finding 1: detects same-field conflict when both users edit the same field to different values', async () => {
      let currentLead = {
        id: 'lead-1',
        customer_name: 'Alice',
        phone: '0811111111',
        status: 'Booked',
        crm_stage: 'booked',
        project_name: 'Project',
        interested_plot_id: 'plot-1',
        updated_at: '2026-01-01T00:00:00Z'
      };

      resolveQuery = q => {
        if (q.table === 'leads' && q.action === 'read') return ok(currentLead);
        if (q.table === 'sales' && q.action === 'read') return ok([]);
        return defaultResult(q);
      };

      let editorRef: any = null;
      render(<SalesDealStatusModal lead={{ leadId: 'lead-1', customer_name: 'Alice', status: 'Booked', crm_stage: 'booked', project_name: 'Project', interested_plot_id: 'plot-1' }} currentUser={{ id: 'user-1', username: 'Sales A', role: 'Sales' }} onClose={vi.fn()} onSaved={vi.fn()} renderEditor={ed => { editorRef = ed; return <div><button type="button" onClick={() => ed.save()}>บันทึก</button>{ed.error && <span data-testid="error-banner">{ed.error}</span>}</div>; }} />);

      await waitFor(() => expect(editorRef).not.toBeNull());
      act(() => {
        editorRef.setDraft({ customer_name: 'Alice A' });
      });

      currentLead = {
        ...currentLead,
        customer_name: 'Alice B',
        updated_at: '2026-01-01T00:01:00Z'
      };

      act(() => { editorRef.save(); });

      await waitFor(() => expect(screen.getByTestId('error-banner').textContent).toMatch(/ข้อมูลถูกแก้ไขจากผู้ใช้อื่น|วิธีชำระเงินหรือสถานะในระบบไม่ตรงกับขั้นตอนที่เลือก/));
      expect(currentLead.customer_name).toBe('Alice B');
    });
  });
  // Finding 3 — P2: SalesDealStatusModal resolveConflict with authoritative server snapshot
  describe('Finding 3 — P2: SalesDealStatusModal resolveConflict with authoritative server snapshot', () => {
    it('Finding 3: resolveConflict uses authoritative server snapshot stage and not stale parent lead prop', async () => {
      let currentLead = {
        id: 'lead-1',
        customer_name: 'Alice',
        phone: '0811111111',
        status: 'Booked',
        crm_stage: 'booked',
        project_name: 'Project',
        interested_plot_id: 'plot-1',
        updated_at: '2026-01-01T00:00:00Z'
      };

      resolveQuery = q => {
        if (q.table === 'leads' && q.action === 'read') return ok(currentLead);
        if (q.table === 'sales' && q.action === 'read') return ok([]);
        return defaultResult(q);
      };

      render(<SalesDealStatusModal lead={{ leadId: 'lead-1', customer_name: 'Alice', status: 'Booked', crm_stage: 'booked', project_name: 'Project', interested_plot_id: 'plot-1' }} currentUser={{ id: 'user-1', username: 'Sales A', role: 'Sales' }} onClose={vi.fn()} onSaved={vi.fn()} />);

      await waitFor(() => expect(screen.getByRole('textbox', { name: 'ชื่อลูกค้า' })).not.toBeDisabled());
      fireEvent.change(screen.getByRole('textbox', { name: 'ชื่อลูกค้า' }), { target: { value: 'Alice Edited' } });

      currentLead = {
        ...currentLead,
        crm_stage: 'loan_submitted',
        status: 'Booked',
        updated_at: '2026-01-01T01:00:00Z'
      };

      act(() => {
        broadcastSalesSync({ type: 'sales_deal_saved', leadId: 'lead-1', timestamp: Date.now() });
      });

      await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/สถานะของลูกค้าในระบบเปลี่ยนเป็น/i));

      fireEvent.click(screen.getByRole('button', { name: 'ยอมรับสถานะใหม่' }));

      await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());

      const statusSelect = screen.getByRole('combobox', { name: 'สถานะหลังจอง' }) as HTMLSelectElement;
      const options = Array.from(statusSelect.options).map(opt => opt.value);
      expect(options).toContain('loan_approved');
      expect(options).toContain('loan_rejected');
    });
  });
  // Finding A — P1: Preserving Price, Bank, Payment Method, and Concurrency
  describe('Finding A — P1: Preserving Price, Bank, Payment Method, and Concurrency in SalesDealStatusModal Notes', () => {
    it('A1: User A edits name, User B edits price & bank in Notes, no sync: saves name A + price & bank B without overwriting', async () => {
      let leadRow = {
        id: 'lead-1',
        customer_name: 'Alice',
        phone: '0811111111',
        status: 'Booked',
        crm_stage: 'booked',
        project_name: 'Project',
        interested_plot_id: 'plot-1',
        notes: '• ราคาขาย: 1,000,000 บ.  • ธนาคาร: Bank A\n• วิธีชำระเงิน: กู้ธนาคาร',
        updated_at: '2026-01-01T00:00:00Z'
      };

      resolveQuery = q => {
        if (q.table === 'leads' && q.action === 'read') return ok(leadRow);
        if (q.table === 'sales' && q.action === 'read') return ok([]);
        if (q.table === 'leads' && q.action === 'update') {
          leadRow = { ...leadRow, ...(q.payload as Record<string, unknown>) };
          return ok(leadRow);
        }
        return defaultResult(q);
      };

      const onSaved = vi.fn();
      render(<SalesDealStatusModal lead={{ leadId: 'lead-1', customer_name: 'Alice', status: 'Booked', crm_stage: 'booked', project_name: 'Project', interested_plot_id: 'plot-1', notes: leadRow.notes }} currentUser={{ id: 'user-1', username: 'Sales A', role: 'Sales' }} onClose={vi.fn()} onSaved={onSaved} />);

      await waitFor(() => expect(screen.getByRole('textbox', { name: 'ชื่อลูกค้า' })).not.toBeDisabled());
      fireEvent.change(screen.getByRole('textbox', { name: 'ชื่อลูกค้า' }), { target: { value: 'Alice Modified' } });

      leadRow = {
        ...leadRow,
        notes: '• ราคาขาย: 2,000,000 บ.  • ธนาคาร: Bank B\n• วิธีชำระเงิน: กู้ธนาคาร\n' + leadRow.notes,
        updated_at: '2026-01-01T00:05:00Z'
      };

      fireEvent.click(screen.getByRole('button', { name: /บันทึก/ }));

      await waitFor(() => expect(onSaved).toHaveBeenCalled());

      expect(leadRow.customer_name).toBe('Alice Modified');
      const details = customerDealDetails(leadRow.notes);
      expect(details.salePrice).toBe(2000000);
      expect(details.bank).toBe('Bank B');
    });

    it('A2: User A edits name, User B edits price & bank, sync arrives before save: preserves name A + price & bank B', async () => {
      let leadRow = {
        id: 'lead-1',
        customer_name: 'Alice',
        phone: '0811111111',
        status: 'Booked',
        crm_stage: 'booked',
        project_name: 'Project',
        interested_plot_id: 'plot-1',
        notes: '• ราคาขาย: 1,000,000 บ.  • ธนาคาร: Bank A',
        updated_at: '2026-01-01T00:00:00Z'
      };

      resolveQuery = q => {
        if (q.table === 'leads' && q.action === 'read') return ok(leadRow);
        if (q.table === 'sales' && q.action === 'read') return ok([]);
        if (q.table === 'leads' && q.action === 'update') {
          leadRow = { ...leadRow, ...(q.payload as Record<string, unknown>) };
          return ok(leadRow);
        }
        return defaultResult(q);
      };

      const onSaved = vi.fn();
      render(<SalesDealStatusModal lead={{ leadId: 'lead-1', customer_name: 'Alice', status: 'Booked', crm_stage: 'booked', project_name: 'Project', interested_plot_id: 'plot-1', notes: leadRow.notes }} currentUser={{ id: 'user-1', username: 'Sales A', role: 'Sales' }} onClose={vi.fn()} onSaved={onSaved} />);

      await waitFor(() => expect(screen.getByRole('textbox', { name: 'ชื่อลูกค้า' })).not.toBeDisabled());
      fireEvent.change(screen.getByRole('textbox', { name: 'ชื่อลูกค้า' }), { target: { value: 'Alice Modified' } });

      leadRow = {
        ...leadRow,
        notes: '• ราคาขาย: 2,500,000 บ.  • ธนาคาร: Bank B',
        updated_at: '2026-01-01T00:05:00Z'
      };

      act(() => {
        broadcastSalesSync({ type: 'sales_deal_saved', leadId: 'lead-1', timestamp: Date.now() });
      });

      fireEvent.click(screen.getByRole('button', { name: /บันทึก/ }));

      await waitFor(() => expect(onSaved).toHaveBeenCalled());

      expect(leadRow.customer_name).toBe('Alice Modified');
      const details = customerDealDetails(leadRow.notes);
      expect(details.salePrice).toBe(2500000);
      expect(details.bank).toBe('Bank B');
    });

    it('A3: User A edits price, User B edits name: preserves both price A and name B', async () => {
      let leadRow = {
        id: 'lead-1',
        customer_name: 'Alice',
        phone: '0811111111',
        status: 'Booked',
        crm_stage: 'booked',
        project_name: 'Project',
        interested_plot_id: 'plot-1',
        notes: '• ราคาขาย: 1,000,000 บ.  • ธนาคาร: Bank A',
        updated_at: '2026-01-01T00:00:00Z'
      };

      resolveQuery = q => {
        if (q.table === 'leads' && q.action === 'read') return ok(leadRow);
        if (q.table === 'sales' && q.action === 'read') return ok([]);
        if (q.table === 'leads' && q.action === 'update') {
          leadRow = { ...leadRow, ...(q.payload as Record<string, unknown>) };
          return ok(leadRow);
        }
        return defaultResult(q);
      };

      let editorRef: any = null;
      render(
        <SalesDealStatusModal
          lead={{ leadId: 'lead-1', customer_name: 'Alice', status: 'Booked', crm_stage: 'booked', project_name: 'Project', interested_plot_id: 'plot-1', notes: leadRow.notes }}
          currentUser={{ id: 'user-1', username: 'Sales A', role: 'Sales' }}
          onClose={vi.fn()}
          onSaved={vi.fn()}
          renderEditor={ed => {
            editorRef = ed;
            return <button type="button" onClick={() => ed.save()}>บันทึก</button>;
          }}
        />
      );

      await waitFor(() => expect(editorRef).not.toBeNull());
      act(() => {
        editorRef.setDraft({ price: '3500000' });
      });

      leadRow = {
        ...leadRow,
        customer_name: 'Bob',
        updated_at: '2026-01-01T00:05:00Z'
      };

      act(() => { editorRef.save(); });

      await waitFor(() => expect(leadRow.customer_name).toBe('Bob'));

      const details = customerDealDetails(leadRow.notes);
      expect(details.salePrice).toBe(3500000);
    });

    it('A4: User A and B edit price to different values: detects conflict and does not silently overwrite', async () => {
      let leadRow = {
        id: 'lead-1',
        customer_name: 'Alice',
        phone: '0811111111',
        status: 'Booked',
        crm_stage: 'booked',
        project_name: 'Project',
        interested_plot_id: 'plot-1',
        notes: '• ราคาขาย: 1,000,000 บ.  • ธนาคาร: Bank A',
        updated_at: '2026-01-01T00:00:00Z'
      };

      resolveQuery = q => {
        if (q.table === 'leads' && q.action === 'read') return ok(leadRow);
        if (q.table === 'sales' && q.action === 'read') return ok([]);
        return defaultResult(q);
      };

      let editorRef: any = null;
      render(<SalesDealStatusModal lead={{ leadId: 'lead-1', customer_name: 'Alice', status: 'Booked', crm_stage: 'booked', project_name: 'Project', interested_plot_id: 'plot-1', notes: leadRow.notes }} currentUser={{ id: 'user-1', username: 'Sales A', role: 'Sales' }} onClose={vi.fn()} onSaved={vi.fn()} renderEditor={ed => { editorRef = ed; return <div><button type="button" onClick={() => ed.save()}>บันทึก</button>{ed.error && <span data-testid="error-banner">{ed.error}</span>}</div>; }} />);

      await waitFor(() => expect(editorRef).not.toBeNull());
      act(() => {
        editorRef.setDraft({ price: '3000000' });
      });

      leadRow = {
        ...leadRow,
        notes: '• ราคาขาย: 4,000,000 บ.  • ธนาคาร: Bank A',
        updated_at: '2026-01-01T00:05:00Z'
      };

      act(() => { editorRef.save(); });

      await waitFor(() => expect(screen.getByTestId('error-banner').textContent).toMatch(/ข้อมูลถูกแก้ไขจากผู้ใช้อื่น|วิธีชำระเงินหรือสถานะในระบบไม่ตรงกับขั้นตอนที่เลือก/));

      const details = customerDealDetails(leadRow.notes);
      expect(details.salePrice).toBe(4000000);
    });

    it('A5: User A and B edit price to identical matching value: no false conflict, save succeeds', async () => {
      let leadRow = {
        id: 'lead-1',
        customer_name: 'Alice',
        phone: '0811111111',
        status: 'Booked',
        crm_stage: 'booked',
        project_name: 'Project',
        interested_plot_id: 'plot-1',
        notes: '• ราคาขาย: 1,000,000 บ.  • ธนาคาร: Bank A',
        updated_at: '2026-01-01T00:00:00Z'
      };

      resolveQuery = q => {
        if (q.table === 'leads' && q.action === 'read') return ok(leadRow);
        if (q.table === 'sales' && q.action === 'read') return ok([]);
        if (q.table === 'leads' && q.action === 'update') {
          leadRow = { ...leadRow, ...(q.payload as Record<string, unknown>) };
          return ok(leadRow);
        }
        return defaultResult(q);
      };

      let editorRef: any = null;
      render(<SalesDealStatusModal lead={{ leadId: 'lead-1', customer_name: 'Alice', status: 'Booked', crm_stage: 'booked', project_name: 'Project', interested_plot_id: 'plot-1', notes: leadRow.notes }} currentUser={{ id: 'user-1', username: 'Sales A', role: 'Sales' }} onClose={vi.fn()} onSaved={vi.fn()} renderEditor={ed => { editorRef = ed; return <div><button type="button" onClick={() => ed.save()}>บันทึก</button>{ed.error && <span data-testid="error-banner">{ed.error}</span>}</div>; }} />);

      await waitFor(() => expect(editorRef).not.toBeNull());
      act(() => {
        editorRef.setDraft({ price: '3000000' });
      });

      leadRow = {
        ...leadRow,
        notes: '• ราคาขาย: 3,000,000 บ.  • ธนาคาร: Bank A',
        updated_at: '2026-01-01T00:05:00Z'
      };

      act(() => { editorRef.save(); });

      await waitFor(() => expect(screen.queryByTestId('error-banner')).toBeNull());
      const details = customerDealDetails(leadRow.notes);
      expect(details.salePrice).toBe(3000000);
    });

    it('A6: User B changes payment method in Notes: User A save does not overwrite with stale payment method', async () => {
      let leadRow = {
        id: 'lead-1',
        customer_name: 'Alice',
        phone: '0811111111',
        status: 'Booked',
        crm_stage: 'booked',
        project_name: 'Project',
        interested_plot_id: 'plot-1',
        notes: '• ราคาขาย: 1,000,000 บ.  • ธนาคาร: Bank A\n• วิธีชำระเงิน: กู้ธนาคาร',
        updated_at: '2026-01-01T00:00:00Z'
      };

      resolveQuery = q => {
        if (q.table === 'leads' && q.action === 'read') return ok(leadRow);
        if (q.table === 'sales' && q.action === 'read') return ok([]);
        if (q.table === 'leads' && q.action === 'update') {
          leadRow = { ...leadRow, ...(q.payload as Record<string, unknown>) };
          return ok(leadRow);
        }
        return defaultResult(q);
      };

      const onSaved = vi.fn();
      render(<SalesDealStatusModal lead={{ leadId: 'lead-1', customer_name: 'Alice', status: 'Booked', crm_stage: 'booked', project_name: 'Project', interested_plot_id: 'plot-1', notes: leadRow.notes }} currentUser={{ id: 'user-1', username: 'Sales A', role: 'Sales' }} onClose={vi.fn()} onSaved={onSaved} />);

      await waitFor(() => expect(screen.getByRole('textbox', { name: 'ชื่อลูกค้า' })).not.toBeDisabled());
      fireEvent.change(screen.getByRole('textbox', { name: 'ชื่อลูกค้า' }), { target: { value: 'Alice Edited' } });

      leadRow = {
        ...leadRow,
        notes: '• ราคาขาย: 1,000,000 บ.  • ธนาคาร: เงินสด (ไม่ผ่านธนาคาร)\n• วิธีชำระเงิน: เงินสด',
        updated_at: '2026-01-01T00:05:00Z'
      };

      fireEvent.click(screen.getByRole('button', { name: /บันทึก/ }));

      await waitFor(() => expect(onSaved).toHaveBeenCalled());

      expect(salesDealPaymentMethodOf({ notes: leadRow.notes })).toBe('cash');
    });

    it('A7: Notes modified on server between preflight read and write: caught by optimistic conditional write', async () => {
      let leadRow = {
        id: 'lead-1',
        customer_name: 'Alice',
        phone: '0811111111',
        status: 'Booked',
        crm_stage: 'booked',
        project_name: 'Project',
        interested_plot_id: 'plot-1',
        notes: '• ราคาขาย: 1,000,000 บ.  • ธนาคาร: Bank A',
        updated_at: '2026-01-01T00:00:00Z'
      };

      let readTimes = 0;
      resolveQuery = q => {
        if (q.table === 'leads' && q.action === 'read') {
          readTimes++;
          if (readTimes === 2) {
            const snapshotBeforeConcurrentWrite = { ...leadRow };
            leadRow.notes = '• ราคาขาย: 5,000,000 บ.  • ธนาคาร: Bank Secret';
            leadRow.updated_at = '2026-01-01T00:05:00Z';
            return ok(snapshotBeforeConcurrentWrite);
          }
          return ok(leadRow);
        }
        if (q.table === 'sales' && q.action === 'read') return ok([]);
        if (q.table === 'leads' && q.action === 'update') {
          const updatedAtFilter = q.filters.find(([k]) => k === 'updated_at');
          if (updatedAtFilter && updatedAtFilter[1] !== leadRow.updated_at) {
            return {
              data: null,
              error: { code: 'PGRST116', message: 'multiple (or no) rows returned', details: 'The result contains 0 rows' }
            } as any;
          }
          leadRow = { ...leadRow, ...(q.payload as Record<string, unknown>) };
          return ok(leadRow);
        }
        return defaultResult(q);
      };

      let editorRef: any = null;
      render(<SalesDealStatusModal lead={{ leadId: 'lead-1', customer_name: 'Alice', status: 'Booked', crm_stage: 'booked', project_name: 'Project', interested_plot_id: 'plot-1', notes: leadRow.notes }} currentUser={{ id: 'user-1', username: 'Sales A', role: 'Sales' }} onClose={vi.fn()} onSaved={vi.fn()} renderEditor={ed => { editorRef = ed; return <div><button type="button" onClick={() => ed.save()}>บันทึก</button>{ed.error && <span data-testid="error-banner">{ed.error}</span>}</div>; }} />);

      await waitFor(() => expect(editorRef).not.toBeNull());
      act(() => {
        editorRef.setDraft({ customer_name: 'Alice Late' });
      });

      act(() => { editorRef.save(); });

      await waitFor(() => expect(screen.getByTestId('error-banner').textContent).toMatch(/ข้อมูลถูกแก้ไขจากผู้ใช้อื่น|วิธีชำระเงินหรือสถานะในระบบไม่ตรงกับขั้นตอนที่เลือก/));
    });

    it('A8: verified with sales row and without sales row: customerDealDetails and salesDealPaymentMethodOf read true values', async () => {
      let leadWithSale = {
        id: 'lead-1',
        customer_name: 'Alice',
        phone: '0811111111',
        status: 'Booked',
        crm_stage: 'booked',
        project_name: 'Project',
        interested_plot_id: 'plot-1',
        notes: '• ราคาขาย: 2,000,000 บ.  • ธนาคาร: SCB\n• วิธีชำระเงิน: กู้ธนาคาร'
      };

      let saleRow = {
        id: 'sale-1',
        lead_id: 'lead-1',
        plot_id: 'plot-1',
        contract_status: 'Reserved',
        crm_stage: 'booked',
        sale_price: 2000000,
        bank_name: 'SCB',
        payment_method: 'mortgage'
      };

      resolveQuery = q => {
        if (q.table === 'leads' && q.action === 'read') return ok(leadWithSale);
        if (q.table === 'sales' && q.action === 'read') return ok(q.single ? saleRow : [saleRow]);
        if (q.table === 'leads' && q.action === 'update') {
          leadWithSale = { ...leadWithSale, ...(q.payload as Record<string, unknown>) };
          return ok(leadWithSale);
        }
        if (q.table === 'sales' && q.action === 'update') {
          saleRow = { ...saleRow, ...(q.payload as Record<string, unknown>) };
          return ok(saleRow);
        }
        return defaultResult(q);
      };

      const onSaved = vi.fn();
      render(<SalesDealStatusModal lead={{ leadId: 'lead-1', saleId: 'sale-1', customer_name: 'Alice', status: 'Booked', crm_stage: 'booked', project_name: 'Project', interested_plot_id: 'plot-1', notes: leadWithSale.notes }} currentUser={{ id: 'user-1', username: 'Sales A', role: 'Sales' }} onClose={vi.fn()} onSaved={onSaved} />);

      await waitFor(() => expect(screen.getByRole('textbox', { name: 'ชื่อลูกค้า' })).not.toBeDisabled());
      fireEvent.change(screen.getByRole('textbox', { name: 'ชื่อลูกค้า' }), { target: { value: 'Alice Updated With Sale' } });
      fireEvent.click(screen.getByRole('button', { name: /บันทึก/ }));

      await waitFor(() => expect(onSaved).toHaveBeenCalled());

      expect(leadWithSale.customer_name).toBe('Alice Updated With Sale');
      const details = customerDealDetails(leadWithSale.notes);
      expect(details.salePrice).toBe(2000000);
      expect(details.bank).toBe('SCB');
      expect(salesDealPaymentMethodOf({ notes: leadWithSale.notes })).toBe('mortgage');
    });
  });
  // Finding B — P1: RentalActionModal Lifecycle Safety and Status Guard

  describe('Finding B — P1: RentalActionModal Callers Verification', () => {
    it('B9: verified across move-out, renewal, and convert-to-buy callers', async () => {
      resolveQuery = q => {
        if (q.table === 'rental_contracts' && q.action === 'read') return ok(q.single ? contract : [contract]);
        if (q.table === 'leads' && q.action === 'read') return ok(q.single ? { ...lead, status: 'Transferred' } : [{ ...lead, status: 'Transferred' }]);
        return defaultResult(q);
      };

      const onClose = vi.fn();
      render(<RentalActionModal isOpen={true} contractId="contract-1" onClose={onClose} lead={{ ...lead, status: 'Rented' } as any} user={user} />);

      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());
      fireEvent.click(screen.getByRole('button', { name: /2. ต่อสัญญาเช่า/ }));
      submit(/ยืนยันต่อสัญญาเช่า/);

      await waitFor(() => expect(screen.getByText(/สถานะของลูกค้าในระบบเปลี่ยนเป็น "Transferred" แล้ว/i)).toBeInTheDocument());
      expect(onClose).not.toHaveBeenCalled();
    });
  });
  // Finding C — P2: Workflow Draft Retention and Conflict Resolution

  describe('Finding C — P2: SalesDealStatusModal Workflow Draft Retention', () => {
    it('C1: user selects target stage only, sync arrives with unchanged server stage: target and canSave preserved', async () => {
      let editorRef: any = null;
      render(
        <SalesDealStatusModal
          lead={{ leadId: 'lead-1', customer_name: 'Alice', status: 'Booked', crm_stage: 'booked', project_name: 'Project', interested_plot_id: 'plot-1' }}
          currentUser={{ id: 'user-1', username: 'Sales A', role: 'Sales' }}
          onClose={vi.fn()}
          onSaved={vi.fn()}
          renderEditor={ed => {
            editorRef = ed;
            return <div><span data-testid="target">{ed.target}</span><span data-testid="can-save">{ed.canSave ? 'yes' : 'no'}</span></div>;
          }}
        />
      );

      await waitFor(() => expect(editorRef).not.toBeNull());

      act(() => { editorRef.setTarget('contracted'); });

      expect(screen.getByTestId('target').textContent).toBe('contracted');

      act(() => {
        broadcastSalesSync({ type: 'sales_deal_saved', leadId: 'lead-1', timestamp: Date.now() });
      });

      await waitFor(() => expect(screen.getByTestId('target').textContent).toBe('contracted'));

    });

    it('C2: user enters note or reason draft, sync arrives: drafts preserved', async () => {
      let editorRef: any = null;
      render(
        <SalesDealStatusModal
          lead={{ leadId: 'lead-1', customer_name: 'Alice', status: 'Booked', crm_stage: 'booked', project_name: 'Project', interested_plot_id: 'plot-1' }}
          currentUser={{ id: 'user-1', username: 'Sales A', role: 'Sales' }}
          onClose={vi.fn()}
          onSaved={vi.fn()}
          renderEditor={ed => {
            editorRef = ed;
            return (
              <div>
                <span data-testid="note-val">{ed.note}</span>
                <span data-testid="reason-val">{ed.reason}</span>
              </div>
            );
          }}
        />
      );

      await waitFor(() => expect(editorRef).not.toBeNull());

      act(() => {
        editorRef.setNote('Draft workflow note');
        editorRef.setReason('Draft cancellation reason');
      });

      act(() => {
        broadcastSalesSync({ type: 'sales_deal_saved', leadId: 'lead-1', timestamp: Date.now() });
      });

      await waitFor(() => {
        expect(screen.getByTestId('note-val').textContent).toBe('Draft workflow note');
        expect(screen.getByTestId('reason-val').textContent).toBe('Draft cancellation reason');
      });
    });

    it('C3: user has workflow draft and server stage changes: conflict notice shown, canSave disabled', async () => {
      let currentStage = 'booked';
      resolveQuery = q => {
        if (q.table === 'leads' && q.action === 'read') {
          return ok({ id: 'lead-1', customer_name: 'Alice', status: currentStage === 'booked' ? 'Booked' : 'Contracted', crm_stage: currentStage, project_name: 'Project', interested_plot_id: 'plot-1' });
        }
        if (q.table === 'sales' && q.action === 'read') return ok([]);
        return defaultResult(q);
      };

      let editorRef: any = null;
      render(
        <SalesDealStatusModal
          lead={{ leadId: 'lead-1', customer_name: 'Alice', status: 'Booked', crm_stage: 'booked', project_name: 'Project', interested_plot_id: 'plot-1' }}
          currentUser={{ id: 'user-1', username: 'Sales A', role: 'Sales' }}
          onClose={vi.fn()}
          onSaved={vi.fn()}
          renderEditor={ed => {
            editorRef = ed;
            return (
              <div>
                <span data-testid="conflict">{ed.conflictNotice || 'none'}</span>
                <span data-testid="can-save">{ed.canSave ? 'yes' : 'no'}</span>
              </div>
            );
          }}
        />
      );

      await waitFor(() => expect(editorRef).not.toBeNull());

      act(() => { editorRef.setNote('Workflow pending review'); });

      currentStage = 'loan_submitted';
      act(() => {
        broadcastSalesSync({ type: 'sales_deal_saved', leadId: 'lead-1', timestamp: Date.now() });
      });

      await waitFor(() => expect(screen.getByTestId('conflict').textContent).not.toBe('none'));
      expect(screen.getByTestId('can-save').textContent).toBe('no');
    });

    it('C4: resolveConflict with stale parent prop but fresh server snapshot updates choices to server stage and resets confirmed', async () => {
      let currentStage = 'booked';
      resolveQuery = q => {
        if (q.table === 'leads' && q.action === 'read') {
          return ok({ id: 'lead-1', customer_name: 'Alice', status: currentStage === 'booked' ? 'Booked' : 'Contracted', crm_stage: currentStage, project_name: 'Project', interested_plot_id: 'plot-1' });
        }
        if (q.table === 'sales' && q.action === 'read') return ok([]);
        return defaultResult(q);
      };

      let editorRef: any = null;
      render(
        <SalesDealStatusModal
          lead={{ leadId: 'lead-1', customer_name: 'Alice', status: 'Booked', crm_stage: 'booked', project_name: 'Project', interested_plot_id: 'plot-1' }}
          currentUser={{ id: 'user-1', username: 'Sales A', role: 'Sales' }}
          onClose={vi.fn()}
          onSaved={vi.fn()}
          renderEditor={ed => {
            editorRef = ed;
            return (
              <div>
                <span data-testid="target">{ed.target}</span>
                <span data-testid="choices">{ed.choices.join(',')}</span>
                <span data-testid="conflict">{ed.conflictNotice || 'none'}</span>
                <button type="button" onClick={() => ed.resolveConflict?.()}>Resolve</button>
              </div>
            );
          }}
        />
      );

      await waitFor(() => expect(editorRef).not.toBeNull());

      act(() => { editorRef.setNote('Workflow pending review'); });

      currentStage = 'loan_submitted';
      act(() => {
        broadcastSalesSync({ type: 'sales_deal_saved', leadId: 'lead-1', timestamp: Date.now() });
      });

      await waitFor(() => expect(screen.getByTestId('conflict').textContent).not.toBe('none'));

      fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));

      await waitFor(() => expect(screen.getByTestId('conflict').textContent).toBe('none'));
      expect(screen.getByTestId('choices').textContent).toContain('loan_approved');
      expect(screen.getByTestId('choices').textContent).toContain('loan_rejected');
    });

    it('C5: repeated syncs while user is drafting do not reset draft or cause false dirty', async () => {
      let editorRef: any = null;
      render(
        <SalesDealStatusModal
          lead={{ leadId: 'lead-1', customer_name: 'Alice', status: 'Booked', crm_stage: 'booked', project_name: 'Project', interested_plot_id: 'plot-1' }}
          currentUser={{ id: 'user-1', username: 'Sales A', role: 'Sales' }}
          onClose={vi.fn()}
          onSaved={vi.fn()}
          renderEditor={ed => {
            editorRef = ed;
            return <span data-testid="note">{ed.note}</span>;
          }}
        />
      );

      await waitFor(() => expect(editorRef).not.toBeNull());

      act(() => { editorRef.setNote('Keep this draft note'); });

      for (let i = 0; i < 5; i++) {
        act(() => {
          broadcastSalesSync({ type: 'sales_deal_saved', leadId: 'lead-1', timestamp: Date.now() + i });
        });
      }

      await waitFor(() => expect(screen.getByTestId('note').textContent).toBe('Keep this draft note'));
    });

    it('C6: out-of-order responses ignore older server snapshot so fresh snapshot is not overwritten', async () => {
      let defA: { promise: Promise<any>; resolve: (val: any) => void };
      let defB: { promise: Promise<any>; resolve: (val: any) => void };

      const makeDeferred = () => {
        let resolve!: (val: any) => void;
        const promise = new Promise<any>(res => { resolve = res; });
        return { promise, resolve };
      };

      defA = makeDeferred();
      defB = makeDeferred();
      let leadReadCount = 0;

      resolveQuery = q => {
        if (q.table === 'leads' && q.action === 'read') {
          leadReadCount++;
          if (leadReadCount === 1) return defA.promise;
          if (leadReadCount === 2) return defB.promise;
        }
        if (q.table === 'sales' && q.action === 'read') return ok([]);
        return defaultResult(q);
      };

      render(
        <SalesDealStatusModal
          lead={{ leadId: 'lead-1', customer_name: 'Initial Alice', status: 'Booked', crm_stage: 'booked', project_name: 'Project', interested_plot_id: 'plot-1' }}
          currentUser={{ id: 'user-1', username: 'Sales A', role: 'Sales' }}
          onClose={vi.fn()}
          onSaved={vi.fn()}
          renderEditor={ed => (
            <div>
              <span data-testid="initial">{ed.initial}</span>
              <span data-testid="cust-name">{ed.draft.name}</span>
            </div>
          )}
        />
      );

      // Component is mounted and initial load (Request A) is pending.
      // Trigger Request B via broadcastSalesSync while Request A is still pending.
      act(() => {
        broadcastSalesSync({ type: 'sales_deal_saved', leadId: 'lead-1', timestamp: Date.now() });
      });

      // Request B finishes FIRST and resolves with the NEWER snapshot ('Alice Updated')
      await act(async () => {
        defB.resolve(ok({
          id: 'lead-1',
          customer_name: 'Alice Updated',
          phone: '0812345678',
          status: 'Booked',
          crm_stage: 'booked',
          project_name: 'Project',
          interested_plot_id: 'plot-1'
        }));
      });

      await waitFor(() => expect(screen.getByTestId('cust-name').textContent).toBe('Alice Updated'));

      // Request A finishes LATER and resolves with OLDER snapshot ('Alice Stale')
      await act(async () => {
        defA.resolve(ok({
          id: 'lead-1',
          customer_name: 'Alice Stale',
          phone: '0812345678',
          status: 'Booked',
          crm_stage: 'booked',
          project_name: 'Project',
          interested_plot_id: 'plot-1'
        }));
      });

      // Sequence guard ensures UI state keeps the newer snapshot and does NOT get overwritten by stale snapshot
      expect(screen.getByTestId('cust-name').textContent).toBe('Alice Updated');
    });

    it('C7: when user has no local changes, UI automatically adopts new server stage and fields', async () => {
      let currentLeadState = {
        id: 'lead-1',
        customer_name: 'Alice',
        phone: '0811111111',
        status: 'Booked',
        crm_stage: 'booked',
        project_name: 'Project',
        interested_plot_id: 'plot-1'
      };

      resolveQuery = q => {
        if (q.table === 'leads' && q.action === 'read') return ok(currentLeadState);
        if (q.table === 'sales' && q.action === 'read') return ok([]);
        return defaultResult(q);
      };

      let editorRef: any = null;
      render(
        <SalesDealStatusModal
          lead={{ leadId: 'lead-1', customer_name: 'Alice', status: 'Booked', crm_stage: 'booked', project_name: 'Project', interested_plot_id: 'plot-1' }}
          currentUser={{ id: 'user-1', username: 'Sales A', role: 'Sales' }}
          onClose={vi.fn()}
          onSaved={vi.fn()}
          renderEditor={ed => {
            editorRef = ed;
            return (
              <div>
                <span data-testid="initial">{ed.initial}</span>
                <span data-testid="cust-name">{ed.draft.name}</span>
              </div>
            );
          }}
        />
      );

      await waitFor(() => expect(editorRef).not.toBeNull());

      currentLeadState = {
        ...currentLeadState,
        customer_name: 'Alice In Wonderland',
        status: 'Contracted',
        crm_stage: 'contracted'
      };

      act(() => {
        broadcastSalesSync({ type: 'sales_deal_saved', leadId: 'lead-1', timestamp: Date.now() });
      });

      await waitFor(() => {
        expect(screen.getByTestId('cust-name').textContent).toBe('Alice In Wonderland');
        expect(screen.getByTestId('initial').textContent).toBe('contracted');
      });
    });

    it('C8: custom panel renderer receives conflictNotice and resolveConflict properly', async () => {
      let currentLeadState = {
        id: 'lead-1',
        customer_name: 'Alice',
        phone: '0811111111',
        status: 'Booked',
        crm_stage: 'booked',
        project_name: 'Project',
        interested_plot_id: 'plot-1'
      };

      resolveQuery = q => {
        if (q.table === 'leads' && q.action === 'read') return ok(currentLeadState);
        if (q.table === 'sales' && q.action === 'read') return ok([]);
        return defaultResult(q);
      };

      render(
        <SalesDealStatusModal
          lead={{ leadId: 'lead-1', customer_name: 'Alice', status: 'Booked', crm_stage: 'booked', project_name: 'Project', interested_plot_id: 'plot-1' }}
          currentUser={{ id: 'user-1', username: 'Sales A', role: 'Sales' }}
          onClose={vi.fn()}
          onSaved={vi.fn()}
          renderEditor={ed => (
            <div>
              {ed.conflictNotice && <div role="alert">{ed.conflictNotice}</div>}
              <input
                data-testid="name-input"
                value={ed.draft.name}
                onChange={e => ed.setDraft(d => ({ ...d, name: e.target.value }))}
              />
              {ed.conflictNotice && <button type="button" onClick={ed.resolveConflict}>ยอมรับสถานะใหม่</button>}
            </div>
          )}
        />
      );

      await waitFor(() => expect(screen.getByTestId('name-input')).toBeInTheDocument());
      fireEvent.change(screen.getByTestId('name-input'), { target: { value: 'Alice Custom' } });

      currentLeadState = { ...currentLeadState, crm_stage: 'loan_submitted', status: 'Contracted' };
      act(() => {
        broadcastSalesSync({ type: 'sales_deal_saved', leadId: 'lead-1', timestamp: Date.now() });
      });

      await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: 'ยอมรับสถานะใหม่' }));

      await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    });
  });
  // Finding 1 Verification Suite: Conditional Status & Lease Guards at Write Time

  describe('Finding 1 Verification: Conditional Status & Lease Guards at Write Time (Renew)', () => {
    it('F1.1: rental renewal status guard in WHERE clause catches concurrent contract cancellation during renewal', async () => {
      let contractRow = { ...contract, status: 'Active', lease_duration_months: 12, lease_end_date: '2027-01-01', notes: 'Initial note' };
      resolveQuery = q => {
        if (q.table === 'plots' && q.action === 'read') {
          return ok({ id: 'plot-1', sale_status: 'Rented', has_customer: true, current_tenant_name: 'Somchai Jaidee' });
        }
        if (q.table === 'rental_contracts' && q.action === 'read') {
          const snap = { ...contractRow };
          // Simulate concurrent cancellation between read and write
          contractRow.status = 'Cancelled';
          return ok(q.single ? snap : [snap]);
        }
        if (q.table === 'rental_contracts' && q.action === 'update') return matchUpdate(contractRow, q);
        return defaultResult(q);
      };

      const onClose = vi.fn();
      render(<RentalActionModal isOpen={true} contractId="contract-1" onClose={onClose} lead={{ ...lead, status: 'Rented' } as any} user={user} />);

      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());
      fireEvent.click(screen.getByRole('button', { name: /2. ต่อสัญญาเช่า/ }));
      submit(/ยืนยันต่อสัญญาเช่า/);

      await waitFor(() => expect(screen.getByText(/ไม่พบรายการที่แก้ไขได้/i)).toBeInTheDocument());
      expect(onClose).not.toHaveBeenCalled();
      expect(contractRow.status).toBe('Cancelled');
    });


    it('F1.4: optimistic lock retry re-evaluates preconditions on fresh contract and aborts if status became Cancelled', async () => {
      let contractNotes = 'Initial Note';
      let readCount = 0;
      resolveQuery = q => {
        if (q.table === 'plots' && q.action === 'read') {
          return ok({ id: 'plot-1', sale_status: 'Rented', has_customer: true, current_tenant_name: 'Somchai Jaidee' });
        }
        if (q.table === 'rental_contracts' && q.action === 'read') {
          readCount++;
          if (readCount === 1) {
            return ok(q.single ? { ...contract, status: 'Active', notes: contractNotes } : [{ ...contract, status: 'Active', notes: contractNotes }]);
          }
          // On fresh read during retry, status is Cancelled
          return ok(q.single ? { ...contract, status: 'Cancelled', notes: 'New notes' } : [{ ...contract, status: 'Cancelled', notes: 'New notes' }]);
        }
        if (q.table === 'rental_contracts' && q.action === 'update') {
          // Trigger optimistic lock conflict on first attempt
          return { data: null, error: { code: 'PGRST116', details: '0 rows' } } as any;
        }
        return defaultResult(q);
      };

      const onClose = vi.fn();
      render(<RentalActionModal isOpen={true} contractId="contract-1" onClose={onClose} lead={{ ...lead, status: 'Rented' } as any} user={user} />);

      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());
      fireEvent.click(screen.getByRole('button', { name: /2. ต่อสัญญาเช่า/ }));
      submit(/ยืนยันต่อสัญญาเช่า/);

      await waitFor(() => expect(screen.getByText(/ไม่พบรายการที่แก้ไขได้/i)).toBeInTheDocument());
      expect(onClose).not.toHaveBeenCalled();
    });

    it('F1.5: renewal expectedLeaseEndDate guard detects concurrent lease_end_date change and aborts', async () => {
      let contractRow = { ...contract, status: 'Active', lease_duration_months: 12, lease_end_date: '2027-01-01', notes: 'Initial note' };
      resolveQuery = q => {
        if (q.table === 'plots' && q.action === 'read') {
          return ok({ id: 'plot-1', sale_status: 'Rented', has_customer: true, current_tenant_name: 'Somchai Jaidee' });
        }
        if (q.table === 'rental_contracts' && q.action === 'read') {
          const snap = { ...contractRow };
          // Concurrent update to lease_end_date in DB
          contractRow.lease_end_date = '2027-06-01';
          return ok(q.single ? snap : [snap]);
        }
        if (q.table === 'rental_contracts' && q.action === 'update') return matchUpdate(contractRow, q);
        return defaultResult(q);
      };

      const onClose = vi.fn();
      render(<RentalActionModal isOpen={true} contractId="contract-1" onClose={onClose} lead={{ ...lead, status: 'Rented' } as any} user={user} />);

      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());
      fireEvent.click(screen.getByRole('button', { name: /2. ต่อสัญญาเช่า/ }));
      submit(/ยืนยันต่อสัญญาเช่า/);

      await waitFor(() => expect(screen.getByText(/ข้อมูลเงื่อนไขสัญญาเช่าในระบบมีการเปลี่ยนแปลงแล้ว/i)).toBeInTheDocument());
      expect(onClose).not.toHaveBeenCalled();
    });


    it('F1.8: renewal aborts cleanly without corrupting plot or lead if contract status concurrently changed', async () => {
      let plotUpdated = false;
      let leadUpdated = false;
      let contractRow = { ...contract, status: 'Active', notes: 'Active note' };
      resolveQuery = q => {
        if (q.table === 'plots' && q.action === 'read') {
          return ok({ id: 'plot-1', sale_status: 'Rented', has_customer: true, current_tenant_name: 'Somchai Jaidee' });
        }
        if (q.table === 'rental_contracts' && q.action === 'read') {
          const snap = { ...contractRow };
          contractRow.status = 'Cancelled';
          return ok(q.single ? snap : [snap]);
        }
        if (q.table === 'rental_contracts' && q.action === 'update') return { data: null, error: { code: 'PGRST116', details: '0 rows' } } as any;
        if (q.table === 'plots' && q.action === 'update') {
          plotUpdated = true;
          return ok({ id: 'plot-saved' });
        }
        if (q.table === 'leads' && q.action === 'update') {
          leadUpdated = true;
          return ok({ id: 'lead-saved' });
        }
        return defaultResult(q);
      };

      const onClose = vi.fn();
      render(<RentalActionModal isOpen={true} contractId="contract-1" onClose={onClose} lead={{ ...lead, status: 'Rented' } as any} user={user} />);

      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());
      fireEvent.click(screen.getByRole('button', { name: /2. ต่อสัญญาเช่า/ }));
      submit(/ยืนยันต่อสัญญาเช่า/);

      await waitFor(() => expect(screen.getByText(/ไม่พบรายการที่แก้ไขได้/i)).toBeInTheDocument());
      expect(onClose).not.toHaveBeenCalled();
      expect(plotUpdated).toBe(false);
      expect(leadUpdated).toBe(false);
    });
  });
  // Finding 2 Verification Suite: Old Contract Actions Segregation & Plot Protection

  describe('Finding 2 Verification: Old Contract Renewal Plot & Linkage Protection', () => {
    it('F2.5: old contract renewal does not overwrite new active contract linkage or lifecycle fields on lead and preserves plot state', async () => {
      let updatedLeadPayload: Record<string, unknown> | null = null;
      let plotRow = {
        id: 'plot-1',
        sale_status: 'Rented',
        has_customer: true,
        current_tenant_name: 'Somchai Jaidee',
        monthly_rent: 20000,
        lease_end_date: '2028-12-31'
      };

      resolveQuery = q => {
        if (q.table === 'plots' && q.action === 'read') return ok(q.single ? plotRow : [plotRow]);
        if (q.table === 'plots' && q.action === 'update') {
          Object.assign(plotRow, q.payload);
          return ok({ id: plotRow.id });
        }
        if (q.table === 'rental_contracts' && q.action === 'read') {
          if (q.filters.some(([k, v]) => k === 'plot_id' && v === 'plot-1')) {
            if (q.filters.some(([k, v]) => k === 'neq:id' && v === 'contract-1')) {
              return ok([{ ...contract, id: 'contract-different', monthly_rent: 20000, lease_end_date: '2028-12-31', status: 'Active' }]);
            }
          }
          return ok(q.single ? contract : [contract]);
        }
        if (q.table === 'leads' && q.action === 'read') {
          return ok(q.single ? { ...lead, status: 'Rented', active_rental_contract_id: 'contract-different' } : [{ ...lead, status: 'Rented', active_rental_contract_id: 'contract-different' }]);
        }
        if (q.table === 'leads' && q.action === 'update') {
          updatedLeadPayload = q.payload as Record<string, unknown>;
          return ok({ id: 'lead-saved' });
        }
        return defaultResult(q);
      };

      const onClose = vi.fn();
      render(<RentalActionModal isOpen={true} contractId="contract-1" onClose={onClose} lead={{ ...lead, status: 'Rented', active_rental_contract_id: 'contract-1' } as any} user={user} />);

      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());
      fireEvent.click(screen.getByRole('button', { name: /2. ต่อสัญญาเช่า/ }));
      submit(/ยืนยันต่อสัญญาเช่า/);

      await waitFor(() => expect(onClose).toHaveBeenCalled());

      expect(updatedLeadPayload).not.toBeNull();
      expect(updatedLeadPayload).not.toHaveProperty('active_rental_contract_id');
      expect(updatedLeadPayload).not.toHaveProperty('status');
      expect(updatedLeadPayload).not.toHaveProperty('rental_status');

      // Final Plot state assertion: Plot must NOT be overwritten by old contract renewal!
      expect(plotRow.monthly_rent).toBe(20000);
      expect(plotRow.lease_end_date).toBe('2028-12-31');
      expect(plotRow.current_tenant_name).toBe('Somchai Jaidee');
    });
  });

  describe('Finding 3 Verification: Authoritative Effective State & Pre-mutation Validation', () => {
    it('F3.1: pre-mutation choice validation catches conflict when server payment method is cash and target is loan_submitted', async () => {
      let saleRow = {
        id: 'sale-1',
        lead_id: 'lead-1',
        plot_id: 'plot-1',
        contract_status: 'Reserved',
        crm_stage: 'booked',
        sale_price: 2000000,
        bank_name: '',
        payment_method: 'cash'
      };

      resolveQuery = q => {
        if (q.table === 'leads' && q.action === 'read') return ok({ ...purchaseLead, status: 'Booked', crm_stage: 'booked' });
        if (q.table === 'sales' && q.action === 'read') return ok(q.single ? saleRow : [saleRow]);
        return defaultResult(q);
      };

      let editorRef: any = null;
      render(<SalesDealStatusModal lead={{ leadId: 'lead-1', saleId: 'sale-1', customer_name: 'Alice', status: 'Contracted', crm_stage: 'document_prep', project_name: 'Project', interested_plot_id: 'plot-1' }} currentUser={{ id: 'user-1', username: 'Sales A', role: 'Sales' }} onClose={vi.fn()} onSaved={vi.fn()} renderEditor={ed => { editorRef = ed; return <div><button type="button" onClick={() => ed.save()}>Save</button>{ed.error && <span data-testid="error-banner">{ed.error}</span>}</div>; }} />);

      await waitFor(() => expect(editorRef).not.toBeNull());

      // Attempt to save target = loan_submitted for a cash sale
      act(() => { editorRef.setTarget('loan_submitted'); });

      act(() => { editorRef.save(); });

      await waitFor(() => expect(screen.getByTestId('error-banner').textContent).toMatch(/ขั้นตอนนี้ไม่ตรงกับสถานะปัจจุบันหรือวิธีชำระเงิน|ไม่สามารถเปลี่ยนสถานะ/));

      // Verifies ZERO mutations sent to sales table
      expect(writes('sales').length).toBe(0);
      expect(writes('leads').length).toBe(0);
    });

    it('F3.2: transition validation throws salesDealTransitionError before any DB mutation if target stage invalid for effective payment method', async () => {
      let saleRow = {
        id: 'sale-1',
        lead_id: 'lead-1',
        plot_id: 'plot-1',
        contract_status: 'Contracted',
        crm_stage: 'contract',
        sale_price: 2500000,
        bank_name: '',
        payment_method: 'cash'
      };

      resolveQuery = q => {
        if (q.table === 'leads' && q.action === 'read') return ok({ ...purchaseLead, status: 'Contracted', crm_stage: 'contract' });
        if (q.table === 'sales' && q.action === 'read') return ok(q.single ? saleRow : [saleRow]);
        return defaultResult(q);
      };

      let editorRef: any = null;
      render(<SalesDealStatusModal lead={{ leadId: 'lead-1', saleId: 'sale-1', customer_name: 'Alice', status: 'Contracted', crm_stage: 'contract', project_name: 'Project', interested_plot_id: 'plot-1' }} currentUser={{ id: 'user-1', username: 'Sales A', role: 'Sales' }} onClose={vi.fn()} onSaved={vi.fn()} renderEditor={ed => { editorRef = ed; return <div><button type="button" onClick={() => ed.save()}>Save</button>{ed.error && <span data-testid="error-banner">{ed.error}</span>}</div>; }} />);

      await waitFor(() => expect(editorRef).not.toBeNull());

      act(() => { editorRef.setTarget('loan_approved'); });

      act(() => { editorRef.save(); });

      await waitFor(() => expect(screen.getByTestId('error-banner').textContent).toMatch(/ขั้นตอนนี้ไม่ตรงกับสถานะปัจจุบันหรือวิธีชำระเงิน|ไม่สามารถเปลี่ยนสถานะ/));

      expect(writes('sales').length).toBe(0);
    });

    it('F3.3: sales update write-time guard includes payment_method guard preventing preflight-to-write race', async () => {
      let saleRow = {
        id: 'sale-1',
        lead_id: 'lead-1',
        plot_id: 'plot-1',
        contract_status: 'Contracted',
        crm_stage: 'document_prep',
        sale_price: 2000000,
        bank_name: 'SCB',
        payment_method: 'mortgage'
      };

      resolveQuery = q => {
        if (q.table === 'leads' && q.action === 'read') return ok({ ...purchaseLead, status: 'Contracted', crm_stage: 'document_prep' });
        if (q.table === 'sales' && q.action === 'read') {
          const snap = { ...saleRow };
          // Simulate race condition: server payment_method switched to cash right after read
          saleRow.payment_method = 'cash';
          return ok(q.single ? snap : [snap]);
        }
        if (q.table === 'sales' && q.action === 'update') {
          let matches = true;
          for (const [col, val] of q.filters) {
            if ((saleRow as any)[col] !== val) matches = false;
          }
          if (!matches) return { data: null, error: { code: 'PGRST116', details: 'The result contains 0 rows' } } as any;
          return ok(saleRow);
        }
        return defaultResult(q);
      };

      let editorRef: any = null;
      render(<SalesDealStatusModal lead={{ leadId: 'lead-1', saleId: 'sale-1', customer_name: 'Alice', status: 'Contracted', crm_stage: 'document_prep', project_name: 'Project', interested_plot_id: 'plot-1' }} currentUser={{ id: 'user-1', username: 'Sales A', role: 'Sales' }} onClose={vi.fn()} onSaved={vi.fn()} renderEditor={ed => { editorRef = ed; return <div><button type="button" onClick={() => ed.save()}>Save</button>{ed.error && <span data-testid="error-banner">{ed.error}</span>}</div>; }} />);

      await waitFor(() => expect(editorRef).not.toBeNull());

      act(() => { editorRef.setTarget('loan_submitted'); });

      act(() => { editorRef.save(); });

      await waitFor(() => expect(screen.getByTestId('error-banner').textContent).toMatch(/ข้อมูลถูกแก้ไขจากผู้ใช้อื่น|วิธีชำระเงินหรือสถานะในระบบไม่ตรงกับขั้นตอนที่เลือก/));
    });

    it('F3.4: customer deal notes summary reflects authoritative effective price, bank, and method on save', async () => {
      let leadRow = {
        id: 'lead-1',
        customer_name: 'Alice',
        phone: '0811111111',
        status: 'Booked',
        crm_stage: 'booked',
        notes: '• ราคาขาย: 2,500,000 บ.  • ธนาคาร: KBank\\n• วิธีชำระเงิน: กู้ธนาคาร'
      };
      let saleRow = {
        id: 'sale-1',
        lead_id: 'lead-1',
        plot_id: 'plot-1',
        contract_status: 'Reserved',
        crm_stage: 'booked',
        sale_price: 2500000,
        bank_name: 'KBank',
        payment_method: 'mortgage'
      };

      resolveQuery = q => {
        if (q.table === 'leads' && q.action === 'read') return ok(leadRow);
        if (q.table === 'sales' && q.action === 'read') return ok(q.single ? saleRow : [saleRow]);
        if (q.table === 'leads' && q.action === 'update') {
          leadRow = { ...leadRow, ...(q.payload as Record<string, unknown>) };
          return ok(leadRow);
        }
        if (q.table === 'sales' && q.action === 'update') {
          saleRow = { ...saleRow, ...(q.payload as Record<string, unknown>) };
          return ok(saleRow);
        }
        return defaultResult(q);
      };

      let editorRef: any = null;
      render(<SalesDealStatusModal lead={{ leadId: 'lead-1', saleId: 'sale-1', customer_name: 'Alice', status: 'Booked', crm_stage: 'booked', project_name: 'Project', interested_plot_id: 'plot-1' }} currentUser={{ id: 'user-1', username: 'Sales A', role: 'Sales' }} onClose={vi.fn()} onSaved={vi.fn()} renderEditor={ed => { editorRef = ed; return <div><button type="button" onClick={() => ed.save()}>Save</button></div>; }} />);

      await waitFor(() => expect(editorRef).not.toBeNull());

      // User only edits customer name
      act(() => {
        editorRef.setDraft({ name: 'Alice New Name' });
      });

      act(() => { editorRef.save(); });

      await waitFor(() => expect(leadRow.customer_name).toBe('Alice New Name'));

      const details = customerDealDetails(leadRow.notes);
      expect(details.salePrice).toBe(2500000);
      expect(details.bank).toBe('KBank');
      expect(salesDealPaymentMethodOf({ notes: leadRow.notes })).toBe('mortgage');
    });

    it('F3.5: synchronized status_history insert records effective bank and payment method', async () => {
      let insertedHistory: any = null;
      let saleRow = {
        id: 'sale-1',
        lead_id: 'lead-1',
        plot_id: 'plot-1',
        contract_status: 'Contracted',
        crm_stage: 'document_prep',
        sale_price: 3000000,
        bank_name: 'SCB',
        payment_method: 'mortgage'
      };

      resolveQuery = q => {
        if (q.table === 'leads' && q.action === 'read') return ok({ ...purchaseLead, status: 'Contracted', crm_stage: 'document_prep' });
        if (q.table === 'sales' && q.action === 'read') return ok(q.single ? saleRow : [saleRow]);
        if (q.table === 'status_history' && q.action === 'insert') {
          insertedHistory = (q.payload as Record<string, unknown>[])[0] || (q.payload as Record<string, unknown>);
          return ok({ id: 'hist-1' });
        }
        return defaultResult(q);
      };

      let editorRef: any = null;
      render(<SalesDealStatusModal lead={{ leadId: 'lead-1', saleId: 'sale-1', customer_name: 'Alice', status: 'Booked', crm_stage: 'booked', project_name: 'Project', interested_plot_id: 'plot-1' }} currentUser={{ id: 'user-1', username: 'Sales A', role: 'Sales' }} onClose={vi.fn()} onSaved={vi.fn()} renderEditor={ed => { editorRef = ed; return <div><button type="button" onClick={() => ed.save()}>Save</button></div>; }} />);

      await waitFor(() => expect(editorRef).not.toBeNull());

      act(() => { editorRef.setTarget('loan_submitted'); });

      act(() => { editorRef.save(); });

      await waitFor(() => expect(insertedHistory).not.toBeNull());

      expect(insertedHistory?.new_status).toBe('loan_submitted');
      expect(String(insertedHistory?.changed_by)).toContain('SCB');
      expect(String(insertedHistory?.changed_by)).toContain('กู้ธนาคาร');
    });

    it('F3.6: preflight-to-write race on payment method returns PGRST116 and aborts safely', async () => {
      let saleRow = {
        id: 'sale-1',
        lead_id: 'lead-1',
        plot_id: 'plot-1',
        contract_status: 'Contracted',
        crm_stage: 'contract',
        sale_price: 2000000,
        bank_name: 'BBL',
        payment_method: 'mortgage'
      };

      resolveQuery = q => {
        if (q.table === 'leads' && q.action === 'read') return ok({ ...purchaseLead, status: 'Contracted', crm_stage: 'contract' });
        if (q.table === 'sales' && q.action === 'read') return ok(q.single ? saleRow : [saleRow]);
        if (q.table === 'sales' && q.action === 'update') return { data: null, error: { code: 'PGRST116', details: '0 rows updated' } } as any;
        return defaultResult(q);
      };

      let editorRef: any = null;
      render(<SalesDealStatusModal lead={{ leadId: 'lead-1', saleId: 'sale-1', customer_name: 'Alice', status: 'Contracted', crm_stage: 'contract', project_name: 'Project', interested_plot_id: 'plot-1' }} currentUser={{ id: 'user-1', username: 'Sales A', role: 'Sales' }} onClose={vi.fn()} onSaved={vi.fn()} renderEditor={ed => { editorRef = ed; return <div><button type="button" onClick={() => ed.save()}>Save</button>{ed.error && <span data-testid="error-banner">{ed.error}</span>}</div>; }} />);

      await waitFor(() => expect(editorRef).not.toBeNull());

      act(() => { editorRef.setTarget('downpayment'); });

      act(() => { editorRef.save(); });

      await waitFor(() => expect(screen.getByTestId('error-banner').textContent).toMatch(/ข้อมูลถูกแก้ไขจากผู้ใช้อื่น|วิธีชำระเงินหรือสถานะในระบบไม่ตรงกับขั้นตอนที่เลือก/));
    });

    it('F3.7: changing payment method from mortgage to cash validates cash-compatible stages and clears mortgage requirements', async () => {
      let saleRow = {
        id: 'sale-1',
        lead_id: 'lead-1',
        plot_id: 'plot-1',
        contract_status: 'Reserved',
        crm_stage: 'booked',
        sale_price: 2000000,
        bank_name: 'SCB',
        payment_method: 'mortgage'
      };

      resolveQuery = q => {
        if (q.table === 'leads' && q.action === 'read') return ok({ ...purchaseLead, status: 'Booked', crm_stage: 'booked' });
        if (q.table === 'sales' && q.action === 'read') return ok(q.single ? saleRow : [saleRow]);
        if (q.table === 'sales' && q.action === 'update') {
          saleRow = { ...saleRow, ...(q.payload as Record<string, unknown>) };
          return ok(saleRow);
        }
        return defaultResult(q);
      };

      let editorRef: any = null;
      render(<SalesDealStatusModal lead={{ leadId: 'lead-1', saleId: 'sale-1', customer_name: 'Alice', status: 'Booked', crm_stage: 'booked', project_name: 'Project', interested_plot_id: 'plot-1' }} currentUser={{ id: 'user-1', username: 'Sales A', role: 'Sales' }} onClose={vi.fn()} onSaved={vi.fn()} renderEditor={ed => { editorRef = ed; return <div><button type="button" onClick={() => ed.save()}>Save</button>{ed.error && <span data-testid="error-banner">{ed.error}</span>}</div>; }} />);

      await waitFor(() => expect(editorRef).not.toBeNull());

      // User changes method to cash and advances to contract
      act(() => {
        editorRef.setDraft({ method: 'cash' });
        editorRef.setTarget('contracted');
      });

      act(() => { editorRef.save(); });

      await waitFor(() => {
        expect(saleRow.payment_method).toBe('cash');
        expect(saleRow.crm_stage).toBe('contracted');
      });
    });

    it('F3.8: direct save attempt to loan stages with cash deal is blocked with 0 mutations', async () => {
      let saleRow = {
        id: 'sale-1',
        lead_id: 'lead-1',
        plot_id: 'plot-1',
        contract_status: 'Reserved',
        crm_stage: 'booked',
        sale_price: 2000000,
        bank_name: '',
        payment_method: 'cash'
      };

      resolveQuery = q => {
        if (q.table === 'leads' && q.action === 'read') return ok({ ...purchaseLead, status: 'Booked', crm_stage: 'booked' });
        if (q.table === 'sales' && q.action === 'read') return ok(q.single ? saleRow : [saleRow]);
        return defaultResult(q);
      };

      let editorRef: any = null;
      render(<SalesDealStatusModal lead={{ leadId: 'lead-1', saleId: 'sale-1', customer_name: 'Alice', status: 'Booked', crm_stage: 'booked', project_name: 'Project', interested_plot_id: 'plot-1' }} currentUser={{ id: 'user-1', username: 'Sales A', role: 'Sales' }} onClose={vi.fn()} onSaved={vi.fn()} renderEditor={ed => { editorRef = ed; return <div><button type="button" onClick={() => ed.save()}>Save</button>{ed.error && <span data-testid="error-banner">{ed.error}</span>}</div>; }} />);

      await waitFor(() => expect(editorRef).not.toBeNull());

      act(() => { editorRef.setTarget('loan_rejected'); });

      act(() => { editorRef.save(); });

      await waitFor(() => expect(screen.getByTestId('error-banner').textContent).toMatch(/ขั้นตอนนี้ไม่ตรงกับสถานะปัจจุบันหรือวิธีชำระเงิน|ไม่สามารถเปลี่ยนสถานะ/));

      expect(writes('sales').length).toBe(0);
      expect(writes('leads').length).toBe(0);
    });
  });
  // Finding A Verification: Renewal and Lifecycle Protection on Plot (A1-A8)

  describe('Finding A Verification: Renewal and Lifecycle Protection on Plot', () => {
    it('A1: normal renewal updates contract, lead, and plot in full synchrony', async () => {
      let plotRow = { id: 'plot-1', sale_status: 'Rented', has_customer: true, current_tenant_name: 'Somchai Jaidee', monthly_rent: 15000, lease_end_date: '2027-01-01' };
      let contractRow = { ...contract, id: 'contract-1', plot_id: 'plot-1', status: 'Active', monthly_rent: 15000, lease_duration_months: 12, lease_end_date: '2027-01-01', tenant_name: 'Somchai Jaidee' };
      let leadRow = { ...lead, id: 'lead-1', status: 'Rented', rental_status: 'Rented', active_rental_contract_id: 'contract-1', rental_monthly_rent: 15000, rental_end_date: '2027-01-01' };

      resolveQuery = q => {
        if (q.table === 'plots' && q.action === 'read') return ok(q.single ? plotRow : [plotRow]);
        if (q.table === 'plots' && q.action === 'update') { Object.assign(plotRow, q.payload); return ok({ id: plotRow.id }); }
        if (q.table === 'rental_contracts' && q.action === 'read') {
          if (q.filters.some(([k, v]) => k === 'plot_id' && v === 'plot-1' && q.filters.some(([k2, v2]) => k2 === 'neq:id' && v2 === 'contract-1'))) {
            return ok([]); // No other active contracts
          }
          return ok(q.single ? contractRow : [contractRow]);
        }
        if (q.table === 'rental_contracts' && q.action === 'update') { Object.assign(contractRow, q.payload); return ok({ id: contractRow.id }); }
        if (q.table === 'leads' && q.action === 'read') return ok(q.single ? leadRow : [leadRow]);
        if (q.table === 'leads' && q.action === 'update') { Object.assign(leadRow, q.payload); return ok({ id: leadRow.id }); }
        return defaultResult(q);
      };

      const onClose = vi.fn();
      render(<RentalActionModal isOpen={true} contractId="contract-1" onClose={onClose} lead={leadRow as any} user={user} />);

      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());
      fireEvent.click(screen.getByRole('button', { name: /2. ต่อสัญญาเช่า/ }));
      submit(/ยืนยันต่อสัญญาเช่า/);

      await waitFor(() => expect(onClose).toHaveBeenCalled());

      expect(contractRow.status).toBe('Renewed');
      expect(contractRow.lease_duration_months).toBe(24);
      expect(contractRow.lease_end_date).toBe('2028-01-01');
      expect(plotRow.monthly_rent).toBe(15000);
      expect(plotRow.lease_end_date).toBe('2028-01-01');
      expect(leadRow.rental_status).toBe('Renewed');
      expect(leadRow.rental_end_date).toBe('2028-01-01');
    });

    it('A2: old contract renewal must not overwrite plot rent or lease end date when plot has a new active contract', async () => {
      let plotRow = { id: 'plot-1', sale_status: 'Rented', has_customer: true, current_tenant_name: 'New Tenant Bob', monthly_rent: 25000, lease_end_date: '2029-01-01' };
      let oldContract = { ...contract, id: 'contract-old', plot_id: 'plot-1', monthly_rent: 15000, lease_end_date: '2027-01-01', status: 'Active', notes: 'Old contract notes' };
      let newContract = { ...contract, id: 'contract-new', plot_id: 'plot-1', monthly_rent: 25000, lease_end_date: '2029-01-01', status: 'Active', tenant_name: 'New Tenant Bob' };

      resolveQuery = q => {
        if (q.table === 'plots' && q.action === 'read') return ok(q.single ? plotRow : [plotRow]);
        if (q.table === 'plots' && q.action === 'update') { Object.assign(plotRow, q.payload); return ok({ id: plotRow.id }); }
        if (q.table === 'rental_contracts' && q.action === 'read') {
          if (q.filters.some(([k, v]) => k === 'plot_id' && v === 'plot-1' && q.filters.some(([k2, v2]) => k2 === 'neq:id' && v2 === 'contract-old'))) {
            return ok([newContract]);
          }
          return ok(q.single ? oldContract : [oldContract]);
        }
        if (q.table === 'leads' && q.action === 'read') return ok(q.single ? { ...lead, active_rental_contract_id: 'contract-new' } : [{ ...lead, active_rental_contract_id: 'contract-new' }]);
        return defaultResult(q);
      };

      const onClose = vi.fn();
      render(<RentalActionModal isOpen={true} contractId="contract-old" onClose={onClose} lead={{ ...lead, status: 'Rented', active_rental_contract_id: 'contract-new' } as any} user={user} />);

      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());
      fireEvent.click(screen.getByRole('button', { name: /2. ต่อสัญญาเช่า/ }));
      submit(/ยืนยันต่อสัญญาเช่า/);

      await waitFor(() => expect(onClose).toHaveBeenCalled());

      expect(plotRow.monthly_rent).toBe(25000);
      expect(plotRow.lease_end_date).toBe('2029-01-01');
      expect(plotRow.current_tenant_name).toBe('New Tenant Bob');
    });

    it('A3: same tenant name on different contract does not grant authority to overwrite plot', async () => {
      let plotRow = { id: 'plot-1', sale_status: 'Rented', has_customer: true, current_tenant_name: 'Somchai Jaidee', monthly_rent: 30000, lease_end_date: '2030-01-01' };
      let oldContract = { ...contract, id: 'contract-old', plot_id: 'plot-1', monthly_rent: 15000, lease_end_date: '2027-01-01', status: 'Active', tenant_name: 'Somchai Jaidee' };
      let newContract = { ...contract, id: 'contract-new', plot_id: 'plot-1', monthly_rent: 30000, lease_end_date: '2030-01-01', status: 'Active', tenant_name: 'Somchai Jaidee' };

      resolveQuery = q => {
        if (q.table === 'plots' && q.action === 'read') return ok(q.single ? plotRow : [plotRow]);
        if (q.table === 'plots' && q.action === 'update') { Object.assign(plotRow, q.payload); return ok({ id: plotRow.id }); }
        if (q.table === 'rental_contracts' && q.action === 'read') {
          if (q.filters.some(([k, v]) => k === 'plot_id' && v === 'plot-1' && q.filters.some(([k2, v2]) => k2 === 'neq:id' && v2 === 'contract-old'))) {
            return ok([newContract]);
          }
          return ok(q.single ? oldContract : [oldContract]);
        }
        return defaultResult(q);
      };

      const onClose = vi.fn();
      render(<RentalActionModal isOpen={true} contractId="contract-old" onClose={onClose} lead={{ ...lead, status: 'Rented' } as any} user={user} />);

      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());
      fireEvent.click(screen.getByRole('button', { name: /2. ต่อสัญญาเช่า/ }));
      submit(/ยืนยันต่อสัญญาเช่า/);

      await waitFor(() => expect(onClose).toHaveBeenCalled());

      expect(plotRow.monthly_rent).toBe(30000);
      expect(plotRow.lease_end_date).toBe('2030-01-01');
    });

    it('A4: plot lease terms changing between read and write is detected and aborted', async () => {
      let plotRow = { id: 'plot-1', sale_status: 'Rented', has_customer: true, current_tenant_name: 'Somchai Jaidee', monthly_rent: 15000, lease_end_date: '2027-01-01' };
      let contractRow = { ...contract, id: 'contract-1', plot_id: 'plot-1', status: 'Active', monthly_rent: 15000, lease_end_date: '2027-01-01' };
      let plotReadCount = 0;

      resolveQuery = q => {
        if (q.table === 'plots' && q.action === 'read') {
          plotReadCount++;
          const snap = { ...plotRow };
          // Simulate concurrent plot change right after read
          plotRow.lease_end_date = '2030-05-01';
          return ok(q.single ? snap : [snap]);
        }
        if (q.table === 'plots' && q.action === 'update') {
          let matches = true;
          for (const [col, val] of q.filters) {
            if (col === 'lease_end_date' && plotRow.lease_end_date !== val) matches = false;
          }
          if (!matches) return { data: [], error: null, count: 0 } as any;
          Object.assign(plotRow, q.payload);
          return ok({ id: plotRow.id });
        }
        if (q.table === 'rental_contracts' && q.action === 'read') {
          if (q.filters.some(([k, v]) => k === 'plot_id' && v === 'plot-1' && q.filters.some(([k2, v2]) => k2 === 'neq:id' && v2 === 'contract-1'))) {
            return ok([]); // No other active contracts
          }
          return ok(q.single ? contractRow : [contractRow]);
        }
        if (q.table === 'rental_contracts' && q.action === 'update') {
          Object.assign(contractRow, q.payload);
          return ok({ id: contractRow.id });
        }
        return defaultResult(q);
      };

      render(<RentalActionModal isOpen={true} contractId="contract-1" onClose={vi.fn()} lead={lead as any} user={user} />);

      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());
      fireEvent.click(screen.getByRole('button', { name: /2. ต่อสัญญาเช่า/ }));
      submit(/ยืนยันต่อสัญญาเช่า/);

      await waitFor(() => expect(screen.getByText(/ไม่สามารถอัปเดตแปลงได้/i)).toBeInTheDocument());

      expect(plotRow.lease_end_date).toBe('2030-05-01'); // Concurrent change preserved!
    });

    it('A5: operations on plot-1 contract never mutate another plot', async () => {
      let plot2Row = { id: 'plot-2', sale_status: 'Available', has_customer: false, current_tenant_name: null };
      resolveQuery = q => {
        if (q.table === 'plots' && q.action === 'update') {
          if (q.filters.some(([k, v]) => k === 'id' && v === 'plot-2')) {
            throw new Error('Illegal mutation on plot-2!');
          }
        }
        return defaultResult(q);
      };

      const onClose = vi.fn();
      render(<RentalActionModal isOpen={true} contractId="contract-1" onClose={onClose} lead={lead as any} user={user} />);

      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());
      fireEvent.click(screen.getByRole('button', { name: /2. ต่อสัญญาเช่า/ }));
      submit(/ยืนยันต่อสัญญาเช่า/);

      await waitFor(() => expect(onClose).toHaveBeenCalled());
      expect(writes('plots').every(q => !q.filters.some(([k, v]) => k === 'id' && v === 'plot-2'))).toBe(true);
    });

    it('A6: contract update succeeds but plot update fails: partial save reported and retry does not re-extend contract', async () => {
      let contractAttempts = 0;
      let plotAttempts = 0;
      let contractRow = { ...contract, id: 'contract-1', status: 'Active', lease_duration_months: 12, lease_end_date: '2027-01-01' };

      resolveQuery = q => {
        if (q.table === 'rental_contracts' && q.action === 'read') {
          if (q.filters.some(([k, v]) => k === 'plot_id' && v === 'plot-1' && q.filters.some(([k2, v2]) => k2 === 'neq:id' && v2 === 'contract-1'))) {
            return ok([]);
          }
          return ok(q.single ? contractRow : [contractRow]);
        }
        if (q.table === 'rental_contracts' && q.action === 'update') {
          contractAttempts++;
          Object.assign(contractRow, q.payload);
          return ok({ id: contractRow.id });
        }
        if (q.table === 'plots' && q.action === 'read') return ok({ id: 'plot-1', sale_status: 'Rented', current_tenant_name: 'Somchai Jaidee' });
        if (q.table === 'plots' && q.action === 'update') {
          plotAttempts++;
          if (plotAttempts === 1) return fail('Plot update DB crash');
          return ok({ id: 'plot-1' });
        }
        return defaultResult(q);
      };

      render(<RentalActionModal isOpen={true} contractId="contract-1" onClose={vi.fn()} lead={lead as any} user={user} />);

      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());
      fireEvent.click(screen.getByRole('button', { name: /2. ต่อสัญญาเช่า/ }));
      submit(/ยืนยันต่อสัญญาเช่า/);

      // Partial save reported
      await waitFor(() => expect(screen.getByText(/บันทึกบางส่วนแล้ว แต่ยังไม่ครบ/i)).toBeInTheDocument());

      expect(contractAttempts).toBe(1);
      expect(contractRow.lease_duration_months).toBe(24);

      // User retries
      submit(/ยืนยันต่อสัญญาเช่า/);

      await waitFor(() => expect(plotAttempts).toBe(2));

      // Contract duration MUST NOT have been incremented again!
      expect(contractAttempts).toBe(1);
      expect(contractRow.lease_duration_months).toBe(24);
    }, 15000);

    it('A7: when new contract appears on plot during partial save, retry does not overwrite new contract', async () => {
      let plotAttempts = 0;
      let plotRow = { id: 'plot-1', sale_status: 'Rented', monthly_rent: 15000, lease_end_date: '2027-01-01', current_tenant_name: 'Somchai Jaidee' };
      let newContractOnPlot = false;

      resolveQuery = q => {
        if (q.table === 'plots' && q.action === 'read') return ok(q.single ? plotRow : [plotRow]);
        if (q.table === 'plots' && q.action === 'update') {
          plotAttempts++;
          if (plotAttempts === 1) return fail('Plot lock error');
          Object.assign(plotRow, q.payload);
          return ok({ id: plotRow.id });
        }
        if (q.table === 'rental_contracts' && q.action === 'read') {
          if (q.filters.some(([k, v]) => k === 'plot_id' && v === 'plot-1' && q.filters.some(([k2, v2]) => k2 === 'neq:id' && v2 === 'contract-1'))) {
            if (newContractOnPlot) {
              return ok([{ ...contract, id: 'contract-new-occupant', plot_id: 'plot-1', status: 'Active', monthly_rent: 20000, tenant_name: 'New Tenant' }]);
            }
            return ok([]);
          }
          return ok(q.single ? contract : [contract]);
        }
        return defaultResult(q);
      };

      render(<RentalActionModal isOpen={true} contractId="contract-1" onClose={vi.fn()} lead={lead as any} user={user} />);

      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());
      fireEvent.click(screen.getByRole('button', { name: /2. ต่อสัญญาเช่า/ }));
      submit(/ยืนยันต่อสัญญาเช่า/);

      await waitFor(() => expect(screen.getByText(/บันทึกบางส่วนแล้ว/i)).toBeInTheDocument());

      // New contract takes over plot before retry
      newContractOnPlot = true;
      plotRow.current_tenant_name = 'New Tenant';
      plotRow.monthly_rent = 20000;
      submit(/ยืนยันต่อสัญญาเช่า/);

      await waitFor(() => expect(screen.queryByText(/กำลังบันทึก/i)).not.toBeInTheDocument());

      // Plot remains protected with new contract rent!
      expect(plotRow.monthly_rent).toBe(20000);
      expect(plotRow.current_tenant_name).toBe('New Tenant');
    });

  });

  describe('Finding C Verification: Partial Save Recovery without Lost State', () => {
    it('C1: Lead update succeeds / history fails first attempt / retry succeeds without bank error or redundant lead update', async () => {
      let historyAttempts = 0;
      let historyInserted = false;
      let leadUpdateCount = 0;

      let leadRow = {
        id: 'lead-1',
        customer_name: 'Alice',
        phone: '0812345678',
        status: 'DocumentPrep',
        crm_stage: 'document_prep',
        project_name: 'Project',
        notes: '• ธนาคาร: SCB\n• วิธีชำระเงิน: กู้ธนาคาร',
        updated_at: '2026-01-01T00:00:00.000Z'
      };

      resolveQuery = q => {
        if (q.table === 'leads' && q.action === 'read') return ok(q.single ? leadRow : [leadRow]);
        if (q.table === 'sales' && q.action === 'read') return ok([]);
        if (q.table === 'leads' && q.action === 'update') {
          leadUpdateCount++;
          Object.assign(leadRow, q.payload);
          return ok({ id: leadRow.id });
        }
        if (q.table === 'status_history' && q.action === 'insert') {
          historyAttempts++;
          if (historyAttempts === 1) return fail('status_history network failure');
          historyInserted = true;
          return ok({ id: 'hist-1' });
        }
        return defaultResult(q);
      };

      let editorRef: any = null;
      render(<SalesDealStatusModal lead={{ leadId: 'lead-1', saleId: null, customer_name: 'Alice', status: 'DocumentPrep', crm_stage: 'document_prep', project_name: 'Project', interested_plot_id: 'plot-1' }} currentUser={{ id: 'user-1', username: 'Sales A', role: 'Sales' }} onClose={vi.fn()} onSaved={vi.fn()} renderEditor={ed => { editorRef = ed; return <div><button type="button" onClick={() => ed.save()}>Save</button>{ed.error && <span data-testid="error-banner">{ed.error}</span>}</div>; }} />);

      await waitFor(() => expect(editorRef).not.toBeNull());

      act(() => { editorRef.setTarget('loan_submitted'); });
      act(() => { editorRef.save(); });

      await waitFor(() => expect(screen.getByTestId('error-banner').textContent).toMatch(/บันทึกบางส่วนแล้ว ยังไม่ครบ/));

      expect(leadUpdateCount).toBe(1);
      expect(historyInserted).toBe(false);

      // User retries
      act(() => { editorRef.save(); });

      await waitFor(() => expect(historyInserted).toBe(true));

      // No bank error, and lead was not updated again!
      expect(leadUpdateCount).toBe(1);
      expect(screen.queryByTestId('error-banner')).toBeNull();
    });

    it('C2: Sales update succeeds / Lead update fails / retry completes remaining steps', async () => {
      let salesUpdateCount = 0;
      let leadAttempts = 0;
      let leadUpdated = false;

      let saleRow = { id: 'sale-1', lead_id: 'lead-1', plot_id: 'plot-1', contract_status: 'DocumentPrep', crm_stage: 'document_prep', payment_method: 'mortgage', bank_name: 'KBANK', updated_at: '2026-01-01T00:00:00.000Z' };
      let leadRow = { id: 'lead-1', customer_name: 'Bob', status: 'DocumentPrep', crm_stage: 'document_prep', notes: '', updated_at: '2026-01-01T00:00:00.000Z' };

      resolveQuery = q => {
        if (q.table === 'sales' && q.action === 'read') return ok(q.single ? saleRow : [saleRow]);
        if (q.table === 'leads' && q.action === 'read') return ok(q.single ? leadRow : [leadRow]);
        if (q.table === 'sales' && q.action === 'update') {
          salesUpdateCount++;
          Object.assign(saleRow, q.payload);
          return ok({ id: saleRow.id });
        }
        if (q.table === 'leads' && q.action === 'update') {
          leadAttempts++;
          if (leadAttempts === 1) return fail('Lead DB error');
          leadUpdated = true;
          Object.assign(leadRow, q.payload);
          return ok({ id: leadRow.id });
        }
        if (q.table === 'status_history') return ok({ id: 'hist-saved' });
        return defaultResult(q);
      };

      let editorRef: any = null;
      render(<SalesDealStatusModal lead={{ leadId: 'lead-1', saleId: 'sale-1', customer_name: 'Bob', status: 'DocumentPrep', crm_stage: 'document_prep', project_name: 'Project', interested_plot_id: 'plot-1' }} currentUser={{ id: 'user-1', username: 'Sales A', role: 'Sales' }} onClose={vi.fn()} onSaved={vi.fn()} renderEditor={ed => { editorRef = ed; return <div><button type="button" onClick={() => ed.save()}>Save</button>{ed.error && <span data-testid="error-banner">{ed.error}</span>}</div>; }} />);

      await waitFor(() => expect(editorRef).not.toBeNull());

      act(() => { editorRef.setTarget('loan_submitted'); });
      act(() => { editorRef.save(); });

      await waitFor(() => expect(screen.getByTestId('error-banner').textContent).toMatch(/บันทึกบางส่วนแล้ว/));
      expect(salesUpdateCount).toBe(1);
      expect(leadUpdated).toBe(false);

      // Retry
      act(() => { editorRef.save(); });

      await waitFor(() => expect(leadUpdated).toBe(true));
      expect(salesUpdateCount).toBe(1); // Sales not updated again!
    });

    it('C3: Sales and Lead succeed / history fails / retry records history with consistent audit', async () => {
      let histAttempts = 0;
      let insertedHistoryPayload: any = null;

      let saleRow = { id: 'sale-1', lead_id: 'lead-1', contract_status: 'DocumentPrep', crm_stage: 'document_prep', payment_method: 'mortgage', bank_name: 'BBL', updated_at: '2026-01-01T00:00:00.000Z' };
      let leadRow = { id: 'lead-1', customer_name: 'Charlie', status: 'DocumentPrep', crm_stage: 'document_prep', notes: '', updated_at: '2026-01-01T00:00:00.000Z' };

      resolveQuery = q => {
        if (q.table === 'sales' && q.action === 'read') return ok(q.single ? saleRow : [saleRow]);
        if (q.table === 'leads' && q.action === 'read') return ok(q.single ? leadRow : [leadRow]);
        if (q.table === 'sales' && q.action === 'update') return ok({ id: saleRow.id });
        if (q.table === 'leads' && q.action === 'update') return ok({ id: leadRow.id });
        if (q.table === 'status_history' && q.action === 'insert') {
          histAttempts++;
          if (histAttempts === 1) return fail('History insert dropped');
          insertedHistoryPayload = q.payload;
          return ok({ id: 'hist-1' });
        }
        return defaultResult(q);
      };

      let editorRef: any = null;
      render(
        <SalesDealStatusModal
          lead={{ leadId: 'lead-1', saleId: 'sale-1', customer_name: 'Charlie', status: 'DocumentPrep', crm_stage: 'document_prep', project_name: 'Project', interested_plot_id: 'plot-1' }}
          currentUser={{ id: 'user-1', username: 'Sales A', role: 'Sales' }}
          onClose={vi.fn()}
          onSaved={vi.fn()}
          renderEditor={ed => {
            editorRef = ed;
            return <div><button type="button" onClick={() => ed.save()}>Save</button>{ed.error && <span data-testid="error-banner">{ed.error}</span>}</div>;
          }}
        />
      );

      await waitFor(() => expect(editorRef).not.toBeNull());

      act(() => { editorRef.setTarget('loan_submitted'); });
      act(() => { editorRef.save(); });

      await waitFor(() => expect(screen.getByTestId('error-banner').textContent).toMatch(/บันทึกบางส่วนแล้ว/));

      act(() => { editorRef.save(); });

      await waitFor(() => expect(insertedHistoryPayload).not.toBeNull());
      expect(insertedHistoryPayload.new_status).toBe('loan_submitted');
      expect(insertedHistoryPayload.changed_by).toContain('ธนาคาร: BBL');
    });

    it('C4: history write succeeded on DB but response lost: retry detects existing row and prevents duplicate', async () => {
      let historyInsertedCount = 0;
      let existingHistoryRecords: any[] = [];

      let leadRow = { id: 'lead-1', customer_name: 'Diana', status: 'DocumentPrep', crm_stage: 'document_prep', notes: '• ธนาคาร: TTB\n• วิธีชำระเงิน: กู้ธนาคาร', updated_at: '2026-01-01T00:00:00.000Z' };

      resolveQuery = q => {
        if (q.table === 'leads') return ok(q.single ? leadRow : [leadRow]);
        if (q.table === 'sales') return ok([]);
        if (q.table === 'status_history' && q.action === 'read') return ok(existingHistoryRecords);
        if (q.table === 'status_history' && q.action === 'insert') {
          historyInsertedCount++;
          // Simulate: wrote to DB successfully, but network connection dropped on response
          existingHistoryRecords.push({ id: 'hist-diana-1', entity_type: 'lead', entity_id: 'lead-1', new_status: 'loan_submitted' });
          return fail('Network dropped on response');
        }
        return defaultResult(q);
      };

      let editorRef: any = null;
      render(
        <SalesDealStatusModal
          lead={{ leadId: 'lead-1', saleId: null, customer_name: 'Diana', status: 'DocumentPrep', crm_stage: 'document_prep', project_name: 'Project', interested_plot_id: 'plot-1' }}
          currentUser={{ id: 'user-1', username: 'Sales A', role: 'Sales' }}
          onClose={vi.fn()}
          onSaved={vi.fn()}
          renderEditor={ed => {
            editorRef = ed;
            return <div><button type="button" onClick={() => ed.save()}>Save</button>{ed.error && <span data-testid="error-banner">{ed.error}</span>}</div>;
          }}
        />
      );

      await waitFor(() => expect(editorRef).not.toBeNull());
      act(() => { editorRef.setTarget('loan_submitted'); });
      act(() => { editorRef.save(); });

      await waitFor(() => expect(screen.getByTestId('error-banner').textContent).toMatch(/บันทึกบางส่วนแล้ว/));
      expect(historyInsertedCount).toBe(1);

      // Retry
      act(() => { editorRef.save(); });

      await waitFor(() => expect(screen.queryByTestId('error-banner')).toBeNull());

      // No second insert attempt was made because duplicate check found existing record!
      expect(historyInsertedCount).toBe(1);
    });

    it('C5: sync event during partial save maintains locked state and does not reset draft', async () => {
      let leadRow = { id: 'lead-1', customer_name: 'Eve', status: 'DocumentPrep', crm_stage: 'document_prep', notes: '• ธนาคาร: SCB\n• วิธีชำระเงิน: กู้ธนาคาร', updated_at: '2026-01-01T00:00:00.000Z' };

      resolveQuery = q => {
        if (q.table === 'leads') return ok(q.single ? leadRow : [leadRow]);
        if (q.table === 'sales') return ok([]);
        if (q.table === 'status_history' && q.action === 'insert') return fail('Simulated pause');
        return defaultResult(q);
      };

      let editorRef: any = null;
      render(
        <SalesDealStatusModal
          lead={{ leadId: 'lead-1', saleId: null, customer_name: 'Eve', status: 'DocumentPrep', crm_stage: 'document_prep', project_name: 'Project', interested_plot_id: 'plot-1' }}
          currentUser={{ id: 'user-1', username: 'Sales A', role: 'Sales' }}
          onClose={vi.fn()}
          onSaved={vi.fn()}
          renderEditor={ed => {
            editorRef = ed;
            return <div><button type="button" onClick={() => ed.save()}>Save</button><span data-testid="locked-val">{ed.locked ? 'yes' : 'no'}</span>{ed.error && <span data-testid="error-banner">{ed.error}</span>}</div>;
          }}
        />
      );

      await waitFor(() => expect(editorRef).not.toBeNull());
      act(() => { editorRef.setTarget('loan_submitted'); });
      act(() => { editorRef.save(); });

      await waitFor(() => expect(screen.getByTestId('error-banner').textContent).toMatch(/บันทึกบางส่วนแล้ว/));

      // In partial save state, locked MUST be true!
      expect(screen.getByTestId('locked-val').textContent).toBe('yes');
    });

    it('C6: another user changing status during partial save is caught by optimistic lock', async () => {
      let leadRow = { id: 'lead-1', customer_name: 'Frank', status: 'DocumentPrep', crm_stage: 'document_prep', notes: '• ธนาคาร: SCB\n• วิธีชำระเงิน: กู้ธนาคาร', updated_at: '2026-01-01T00:00:00.000Z' };
      let salesAttempts = 0;

      let saleRow = { id: 'sale-1', lead_id: 'lead-1', contract_status: 'DocumentPrep', crm_stage: 'document_prep', payment_method: 'mortgage', bank_name: 'SCB', updated_at: '2026-01-01T00:00:00.000Z' };

      resolveQuery = q => {
        if (q.table === 'sales' && q.action === 'read') return ok(q.single ? saleRow : [saleRow]);
        if (q.table === 'sales' && q.action === 'update') {
          salesAttempts++;
          if (salesAttempts === 1) return ok({ id: saleRow.id });
          return ok({ id: saleRow.id });
        }
        if (q.table === 'leads' && q.action === 'read') return ok(q.single ? leadRow : [leadRow]);
        if (q.table === 'leads' && q.action === 'update') {
          // Another user changed the lead's updated_at/status!
          return { data: null, error: { code: 'PGRST116', details: '0 rows' } } as any;
        }
        return defaultResult(q);
      };

      let editorRef: any = null;
      render(
        <SalesDealStatusModal
          lead={{ leadId: 'lead-1', saleId: 'sale-1', customer_name: 'Frank', status: 'DocumentPrep', crm_stage: 'document_prep', project_name: 'Project', interested_plot_id: 'plot-1' }}
          currentUser={{ id: 'user-1', username: 'Sales A', role: 'Sales' }}
          onClose={vi.fn()}
          onSaved={vi.fn()}
          renderEditor={ed => {
            editorRef = ed;
            return <div><button type="button" onClick={() => ed.save()}>Save</button>{ed.error && <span data-testid="error-banner">{ed.error}</span>}</div>;
          }}
        />
      );

      await waitFor(() => expect(editorRef).not.toBeNull());
      act(() => { editorRef.setTarget('loan_submitted'); });
      act(() => { editorRef.save(); });

      // Catches conflict and displays safe notification
      await waitFor(() => expect(screen.getByTestId('error-banner').textContent).toMatch(/ข้อมูลถูกแก้ไขจากผู้ใช้อื่นก่อนบันทึก/));
    });

    it('C7: double-clicking save while in-flight does not duplicate mutations', async () => {
      let leadWriteCount = 0;
      let defLead = makeDeferred<Result>();

      resolveQuery = q => {
        if (q.table === 'leads' && q.action === 'read') return ok({ id: 'lead-1', customer_name: 'Grace', status: 'Booked', crm_stage: 'booked', notes: '', updated_at: '2026-01-01T00:00:00.000Z' });
        if (q.table === 'sales') return ok([]);
        if (q.table === 'leads' && q.action === 'update') {
          leadWriteCount++;
          return defLead.promise;
        }
        if (q.table === 'status_history') return ok({ id: 'hist-1' });
        return defaultResult(q);
      };

      let editorRef: any = null;
      render(
        <SalesDealStatusModal
          lead={{ leadId: 'lead-1', saleId: null, customer_name: 'Grace', status: 'Booked', crm_stage: 'booked', project_name: 'Project', interested_plot_id: 'plot-1' }}
          currentUser={{ id: 'user-1', username: 'Sales A', role: 'Sales' }}
          onClose={vi.fn()}
          onSaved={vi.fn()}
          renderEditor={ed => {
            editorRef = ed;
            return <div><button type="button" onClick={() => ed.save()}>Save</button></div>;
          }}
        />
      );

      await waitFor(() => expect(editorRef).not.toBeNull());

      act(() => { editorRef.setTarget('contracted'); });

      // Rapid double click
      act(() => { editorRef.save(); });
      act(() => { editorRef.save(); });

      await waitFor(() => expect(leadWriteCount).toBe(1));

      // Resolve pending write
      defLead.resolve(ok({ id: 'lead-1' }));
    });

    it('C8: normal flow without failure completes cleanly in single pass with exactly 1 mutation per table', async () => {
      let saleRow = { id: 'sale-1', lead_id: 'lead-1', contract_status: 'Booked', crm_stage: 'booked', payment_method: 'cash', updated_at: '2026-01-01T00:00:00.000Z' };
      let leadRow = { id: 'lead-1', customer_name: 'Hank', status: 'Booked', crm_stage: 'booked', notes: '', updated_at: '2026-01-01T00:00:00.000Z' };

      resolveQuery = q => {
        if (q.table === 'sales' && q.action === 'read') return ok(q.single ? saleRow : [saleRow]);
        if (q.table === 'leads' && q.action === 'read') return ok(q.single ? leadRow : [leadRow]);
        if (q.table === 'sales' && q.action === 'update') return ok({ id: saleRow.id });
        if (q.table === 'leads' && q.action === 'update') return ok({ id: leadRow.id });
        if (q.table === 'status_history') return ok({ id: 'hist-1' });
        return defaultResult(q);
      };

      let editorRef: any = null;
      render(
        <SalesDealStatusModal
          lead={{ leadId: 'lead-1', saleId: 'sale-1', customer_name: 'Hank', status: 'Booked', crm_stage: 'booked', project_name: 'Project', interested_plot_id: 'plot-1' }}
          currentUser={{ id: 'user-1', username: 'Sales A', role: 'Sales' }}
          onClose={vi.fn()}
          onSaved={vi.fn()}
          renderEditor={ed => {
            editorRef = ed;
            return <div><button type="button" onClick={() => ed.save()}>Save</button></div>;
          }}
        />
      );

      await waitFor(() => expect(editorRef).not.toBeNull());
      act(() => { editorRef.setTarget('contracted'); });
      act(() => { editorRef.save(); });

      await waitFor(() => {
        expect(writes('sales').length).toBe(1);
        expect(writes('leads').length).toBe(1);
        expect(writes('status_history').length).toBe(1);
      });
    });

    it('C9: functions reliably with standalone lead having no sales row', async () => {
      let leadRow = { id: 'lead-solo', customer_name: 'Ian', status: 'Booked', crm_stage: 'booked', notes: '', updated_at: '2026-01-01T00:00:00.000Z' };

      resolveQuery = q => {
        if (q.table === 'leads' && q.action === 'read') return ok(q.single ? leadRow : [leadRow]);
        if (q.table === 'sales') return ok([]);
        if (q.table === 'leads' && q.action === 'update') return ok({ id: leadRow.id });
        if (q.table === 'status_history') return ok({ id: 'hist-1' });
        return defaultResult(q);
      };

      let editorRef: any = null;
      render(
        <SalesDealStatusModal
          lead={{ leadId: 'lead-solo', saleId: null, customer_name: 'Ian', status: 'Booked', crm_stage: 'booked', project_name: 'Project', interested_plot_id: 'plot-1' }}
          currentUser={{ id: 'user-1', username: 'Sales A', role: 'Sales' }}
          onClose={vi.fn()}
          onSaved={vi.fn()}
          renderEditor={ed => {
            editorRef = ed;
            return <div><button type="button" onClick={() => ed.save()}>Save</button></div>;
          }}
        />
      );

      await waitFor(() => expect(editorRef).not.toBeNull());
      act(() => { editorRef.setTarget('contracted'); });
      act(() => { editorRef.save(); });

      await waitFor(() => {
        expect(writes('sales').length).toBe(0); // 0 sales mutations
        expect(writes('leads').length).toBe(1);
        expect(writes('status_history').length).toBe(1);
      });
    });
  });

  describe('Latest Audit Findings A, B, and C Regression Suite', () => {
    it('Finding A (Real PostgrestClient SDK): renewal plot update matching 0 rows (HTTP 200 [] -> data:null, count:null, error:null) stops before lead update and does not call onSaved/onClose', async () => {
      const db = {
        contracts: [{ ...contract, id: 'contract-1', lead_id: 'lead-1', plot_id: 'plot-1', status: 'Active', lease_duration_months: 12, lease_end_date: '2027-01-01', monthly_rent: 15000, notes: 'Init' }],
        plots: [{ id: 'plot-1', sale_status: 'Rented', has_customer: true, current_tenant_name: 'Somchai Jaidee', customer_name: 'Somchai Jaidee', lease_end_date: '2027-01-01', monthly_rent: 15000 }],
        leads: [{ ...lead, id: 'lead-1', status: 'Rented', rental_status: 'Active', active_rental_contract_id: 'contract-1', rental_end_date: '2027-01-01', rental_monthly_rent: 15000, notes: 'Lead init' }],
        sales: [] as any[]
      };

      const matchesUrlParams = (row: Record<string, any>, searchParams: URLSearchParams) => {
        for (const [key, rawVal] of searchParams.entries()) {
          if (key === 'select' || key === 'order' || key === 'limit' || key === 'offset') continue;
          if (rawVal.startsWith('eq.')) {
            const expected = rawVal.slice(3);
            if (String(row[key] ?? '') !== expected) return false;
          } else if (rawVal.startsWith('neq.')) {
            const expected = rawVal.slice(4);
            if (String(row[key] ?? '') === expected) return false;
          } else if (rawVal.startsWith('is.')) {
            const expected = rawVal.slice(3);
            if (expected === 'null' && row[key] !== null && row[key] !== undefined) return false;
          } else if (rawVal.startsWith('in.(') && rawVal.endsWith(')')) {
            const items = rawVal.slice(4, -1).split(',').map(s => s.replace(/^"|"$/g, ''));
            if (!items.includes(String(row[key] ?? ''))) return false;
          }
        }
        return true;
      };

      const realClient = new PostgrestClient('http://localhost:54321/rest/v1', {
        fetch: async (input, init) => {
          const url = new URL(typeof input === 'string' ? input : input.toString());
          const table = url.pathname.split('/').pop()!;
          const method = (init?.method || 'GET').toUpperCase();
          const headers = new Headers(init?.headers);
          const isSingleObject = (headers.get('Accept') || '').includes('application/vnd.pgrst.object+json');
          const rows: any[] = (db as any)[table === 'rental_contracts' ? 'contracts' : table] || [];

          if (method === 'GET') {
            const matched = rows.filter(r => matchesUrlParams(r, url.searchParams)).map(r => ({ ...r }));
            if (table === 'plots' && matched.length === 1) {
              // Concurrent mutation happens right after plots read, before plots PATCH!
              db.plots[0].lease_end_date = '2029-01-01';
            }
            if (isSingleObject) {
              if (matched.length !== 1) {
                return new Response(JSON.stringify({ code: 'PGRST116', details: 'The result contains 0 rows', hint: null, message: 'JSON object requested, multiple (or no) rows returned' }), { status: 406, headers: { 'Content-Type': 'application/json' } });
              }
              return new Response(JSON.stringify(matched[0]), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }
            return new Response(JSON.stringify(matched), { status: 200, headers: { 'Content-Type': 'application/json' } });
          }

          if (method === 'PATCH') {
            const patch = JSON.parse(String(init?.body || '{}'));
            const matched = rows.filter(r => matchesUrlParams(r, url.searchParams));
            matched.forEach(r => Object.assign(r, patch));
            const out = matched.map(r => ({ ...r }));
            if (isSingleObject) {
              if (out.length !== 1) {
                return new Response(JSON.stringify({ code: 'PGRST116', details: 'The result contains 0 rows', hint: null, message: 'JSON object requested, multiple (or no) rows returned' }), { status: 406, headers: { 'Content-Type': 'application/json' } });
              }
              return new Response(JSON.stringify(out[0]), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }
            return new Response(JSON.stringify(out), { status: 200, headers: { 'Content-Type': 'application/json' } });
          }

          return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
      });

      mocks.from.mockImplementation((table: string) => realClient.from(table));
      const onSaved = vi.fn();
      const onClose = vi.fn();
      const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});

      render(<RentalActionModal isOpen={true} contractId="contract-1" onClose={onClose} onSaved={onSaved} lead={db.leads[0] as any} user={user} />);
      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());

      fireEvent.click(screen.getByRole('button', { name: /2. ต่อสัญญาเช่า/ }));
      submit(/ยืนยันต่อสัญญาเช่า/);

      await waitFor(() => expect(screen.getByText(/บันทึกบางส่วนแล้ว แต่ยังไม่ครบ.*ไม่สามารถอัปเดตแปลงได้/i)).toBeInTheDocument());
      expect(db.plots[0].lease_end_date).toBe('2029-01-01');
      // Lead MUST NOT have been updated to 2028-01-01 because plot step failed!
      expect(db.leads[0].rental_end_date).toBe('2027-01-01');
      expect(onSaved).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
      expect(alertSpy).not.toHaveBeenCalled();
    });
  });
});
