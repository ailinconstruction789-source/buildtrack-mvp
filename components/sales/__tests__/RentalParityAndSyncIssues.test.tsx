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

const mocks = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: mocks.from, auth: { getSession: async () => ({ data: { session: null } }) } } }));
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
    vi.clearAllMocks();
    localStorage.clear();
  });

  // Issue A: Notes Retention & Idempotence on Move-Out / Renewal
  describe('Issue A: Notes Retention and Idempotence', () => {
    it('preserves existing lead notes and includes move-out user note without overwriting', async () => {
      resolveQuery = q => {
        if (q.table === 'plots' && q.action === 'read') {
          return ok({ id: 'plot-1', sale_status: 'Rented', has_customer: true, current_tenant_name: 'Somchai Jaidee' });
        }
        if (q.table === 'leads' && q.action === 'read' && q.single) return ok({ id: 'lead-1', notes: 'Important VIP note' });
        return defaultResult(q);
      };

      render(<RentalActionModal isOpen={true} contractId="contract-1" onClose={vi.fn()} lead={{ ...lead, notes: 'Important VIP note' } as any} user={user} />);

      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());

      // Switch to Move Out tab
      fireEvent.click(screen.getByRole('button', { name: /3. สิ้นสุดสัญญา/ }));

      // Enter user move-out notes
      const notesInput = screen.getByPlaceholderText(/ตรวจมิเตอร์น้ำไฟ/i);
      fireEvent.change(notesInput, { target: { value: 'คืนกุญแจครบ 2 ดอก' } });

      // Submit move out
      submit(/ยืนยันการย้ายออก/);

      await waitFor(() => {
        const leadUpdates = writes('leads');
        expect(leadUpdates.length).toBeGreaterThan(0);
        const payload = leadUpdates[0].payload as Record<string, unknown>;
        expect(payload.notes).toContain('Important VIP note');
        expect(payload.notes).toContain('คืนกุญแจครบ 2 ดอก');
        expect(payload.notes).toContain('[สิ้นสุดสัญญาเช่า ย้ายออก');
      });
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

    it('Finding E: stops and does not overwrite notes when reading fresh notes from database fails on move-out', async () => {
      resolveQuery = q => {
        if (q.table === 'plots' && q.action === 'read') {
          return ok({ id: 'plot-1', sale_status: 'Rented', has_customer: true, current_tenant_name: 'Somchai Jaidee' });
        }
        if (q.table === 'leads' && q.action === 'read') return fail('Network error reading lead notes');
        return defaultResult(q);
      };

      render(<RentalActionModal isOpen={true} contractId="contract-1" onClose={vi.fn()} lead={{ ...lead, notes: 'Stale prop note' } as any} user={user} />);

      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());
      fireEvent.click(screen.getByRole('button', { name: /3. สิ้นสุดสัญญา/ }));
      submit(/ยืนยันการย้ายออก/);

      await waitFor(() => expect(screen.getByText(/ไม่สามารถอ่านโน้ตล่าสุดของลูกค้าได้/i)).toBeInTheDocument());

      // Zero updates to leads table!
      expect(writes('leads').length).toBe(0);
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

  // Issue B: Fresh Plot Lookup Safety
  describe('Issue B: Fresh Plot Lookup Safety (0 mutations on lookup failure)', () => {
    it('stops with 0 mutations when fresh plot lookup returns empty array []', async () => {
      let plotReadCount = 0;
      resolveQuery = q => {
        if (q.table === 'plots' && q.action === 'read') {
          plotReadCount++;
          if (plotReadCount === 1) return ok([{ id: 'plot-1', plot_name: '1', project_name: 'Project', sale_status: 'Available', has_customer: false }]);
          return ok([]);
        }
        return defaultResult(q);
      };

      render(<RentalContractModal isOpen={true} onClose={vi.fn()} lead={lead as any} plotId="plot-1" projectName="Project" user={user} salesOwners={salesOwners} defaultMode="contract" />);

      await waitFor(() => expect(screen.queryByText(/กำลังโหลดแปลง/i)).not.toBeInTheDocument());
      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันบันทึกสัญญาเช่า' })).toBeEnabled());
      submit(/ยืนยันบันทึกสัญญาเช่า/);

      await waitFor(() => expect(screen.getByText(/ไม่พบแปลงที่ต้องการทำรายการ/i)).toBeInTheDocument());

      expect(writes('rental_contracts').length).toBe(0);
      expect(writes('leads').length).toBe(0);
      expect(writes('plots').length).toBe(0);
    });

    it('stops with 0 mutations when fresh plot has mismatched project_name', async () => {
      let plotReadCount = 0;
      resolveQuery = q => {
        if (q.table === 'plots' && q.action === 'read') {
          plotReadCount++;
          if (plotReadCount === 1) return ok([{ id: 'plot-1', plot_name: '1', project_name: 'Project', sale_status: 'Available', has_customer: false }]);
          return ok([{ id: 'plot-1', plot_name: '1', project_name: 'DifferentProject', sale_status: 'Available', has_customer: false }]);
        }
        return defaultResult(q);
      };

      render(<RentalContractModal isOpen={true} onClose={vi.fn()} lead={lead as any} plotId="plot-1" projectName="Project" user={user} salesOwners={salesOwners} defaultMode="contract" />);

      await waitFor(() => expect(screen.queryByText(/กำลังโหลดแปลง/i)).not.toBeInTheDocument());
      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันบันทึกสัญญาเช่า' })).toBeEnabled());
      submit(/ยืนยันบันทึกสัญญาเช่า/);

      await waitFor(() => expect(screen.getByText(/ข้อมูลโครงการของแปลงไม่ตรงกับที่เลือก/i)).toBeInTheDocument());

      expect(writes('rental_contracts').length).toBe(0);
      expect(writes('leads').length).toBe(0);
    });
  });

  // Issue C: Incomplete Contract Recovery & Term Parity
  describe('Issue C: Incomplete Contract Recovery & Term Parity', () => {
    it('recovers incomplete active contract on the same plot without inserting a duplicate contract', async () => {
      const existingIncompleteContract = {
        id: 'existing-contract-99',
        lead_id: 'lead-1',
        plot_id: 'plot-1',
        status: 'Active',
        monthly_rent: 15000,
        program_type: 'program_a'
      };

      resolveQuery = q => {
        if (q.table === 'plots' && q.action === 'read') {
          return ok([{ id: 'plot-1', plot_name: '1', project_name: 'Project', sale_status: 'Available', has_customer: false }]);
        }
        if (q.table === 'rental_contracts' && q.action === 'read') return ok([existingIncompleteContract]);
        return defaultResult(q);
      };

      render(<RentalContractModal isOpen={true} onClose={vi.fn()} lead={lead as any} plotId="plot-1" projectName="Project" user={user} salesOwners={salesOwners} defaultMode="contract" />);

      await waitFor(() => expect(screen.queryByText(/กำลังโหลดแปลง/i)).not.toBeInTheDocument());
      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันบันทึกสัญญาเช่า' })).toBeEnabled());
      submit(/ยืนยันบันทึกสัญญาเช่า/);

      await waitFor(() => {
        const contractInserts = writes('rental_contracts').filter(w => w.action === 'insert');
        expect(contractInserts.length).toBe(0);

        const leadUpdates = writes('leads');
        expect(leadUpdates.length).toBeGreaterThan(0);
        expect((leadUpdates[0].payload as any).active_rental_contract_id).toBe('existing-contract-99');
      });
    });

    it('Finding A: rejects recovery when user inputs terms conflicting with recorded contract terms', async () => {
      const existingIncompleteContract = {
        id: 'existing-contract-99',
        lead_id: 'lead-1',
        plot_id: 'plot-1',
        status: 'Active',
        monthly_rent: 15000,
        security_deposit: 30000,
        program_type: 'program_a',
        lease_start_date: '2026-01-01',
        lease_duration_months: 12
      };

      resolveQuery = q => {
        if (q.table === 'plots' && q.action === 'read') {
          return ok([{ id: 'plot-1', plot_name: '1', project_name: 'Project', sale_status: 'Available', has_customer: false }]);
        }
        if (q.table === 'rental_contracts' && q.action === 'read') return ok([existingIncompleteContract]);
        return defaultResult(q);
      };

      render(<RentalContractModal isOpen={true} onClose={vi.fn()} lead={lead as any} plotId="plot-1" projectName="Project" user={user} salesOwners={salesOwners} defaultMode="contract" />);

      await waitFor(() => expect(screen.queryByText(/กำลังโหลดแปลง/i)).not.toBeInTheDocument());
      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันบันทึกสัญญาเช่า' })).toBeEnabled());

      const rentInput = screen.getByLabelText(/ค่าเช่าต่อเดือน/i);
      fireEvent.change(rentInput, { target: { value: '18000' } });

      submit(/ยืนยันบันทึกสัญญาเช่า/);

      await waitFor(() => expect(screen.getByText(/เงื่อนไขสัญญาในฟอร์มขัดแย้งกับสัญญาเช่าเดิมที่บันทึกไว้/i)).toBeInTheDocument());

      expect(writes('rental_contracts').length).toBe(0);
      expect(writes('leads').length).toBe(0);
      expect(writes('plots').length).toBe(0);
    });

    it('Finding A: adopts original recorded contract terms across leads and plots during recovery when terms match', async () => {
      const existingIncompleteContract = {
        id: 'existing-contract-99',
        lead_id: 'lead-1',
        plot_id: 'plot-1',
        status: 'Active',
        monthly_rent: 15000,
        security_deposit: 30000,
        program_type: 'program_a',
        lease_start_date: '2026-01-01',
        lease_duration_months: 12
      };

      resolveQuery = q => {
        if (q.table === 'plots' && q.action === 'read') {
          return ok([{ id: 'plot-1', plot_name: '1', project_name: 'Project', sale_status: 'Available', has_customer: false }]);
        }
        if (q.table === 'rental_contracts' && q.action === 'read') return ok([existingIncompleteContract]);
        return defaultResult(q);
      };

      render(<RentalContractModal isOpen={true} onClose={vi.fn()} lead={lead as any} plotId="plot-1" projectName="Project" user={user} salesOwners={salesOwners} defaultMode="contract" />);

      await waitFor(() => expect(screen.queryByText(/กำลังโหลดแปลง/i)).not.toBeInTheDocument());
      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันบันทึกสัญญาเช่า' })).toBeEnabled());
      submit(/ยืนยันบันทึกสัญญาเช่า/);

      await waitFor(() => {
        const contractInserts = writes('rental_contracts').filter(w => w.action === 'insert');
        expect(contractInserts.length).toBe(0);

        const leadUpdates = writes('leads');
        expect(leadUpdates.length).toBeGreaterThan(0);
        expect((leadUpdates[0].payload as any).active_rental_contract_id).toBe('existing-contract-99');
        expect((leadUpdates[0].payload as any).rental_monthly_rent).toBe(15000);

        const plotUpdates = writes('plots');
        expect(plotUpdates.length).toBeGreaterThan(0);
        expect((plotUpdates[0].payload as any).monthly_rent).toBe(15000);
      });
    });

    it('Finding B: allows recovery of incomplete contract even when lead status is already Rented and rental_status is Active', async () => {
      const existingIncompleteContract = {
        id: 'existing-contract-99',
        lead_id: 'lead-1',
        plot_id: 'plot-1',
        status: 'Active',
        monthly_rent: 15000,
        security_deposit: 30000,
        program_type: 'program_a',
        lease_start_date: '2026-01-01',
        lease_duration_months: 12
      };

      const leadAlreadyRented = {
        ...lead,
        status: 'Rented',
        rental_status: 'Active',
        active_rental_contract_id: 'existing-contract-99'
      };

      resolveQuery = q => {
        if (q.table === 'plots' && q.action === 'read') {
          return ok([{ id: 'plot-1', plot_name: '1', project_name: 'Project', sale_status: 'Available', has_customer: false }]);
        }
        if (q.table === 'rental_contracts' && q.action === 'read') return ok([existingIncompleteContract]);
        return defaultResult(q);
      };

      render(<RentalContractModal isOpen={true} onClose={vi.fn()} lead={leadAlreadyRented as any} plotId="plot-1" projectName="Project" user={user} salesOwners={salesOwners} defaultMode="contract" />);

      await waitFor(() => expect(screen.queryByText(/กำลังโหลดแปลง/i)).not.toBeInTheDocument());
      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันบันทึกสัญญาเช่า' })).toBeEnabled());
      submit(/ยืนยันบันทึกสัญญาเช่า/);

      await waitFor(() => {
        const plotUpdates = writes('plots');
        expect(plotUpdates.length).toBeGreaterThan(0);
        expect((plotUpdates[0].payload as any).sale_status).toBe('Rented');
      });
    });

    it('Finding B: blocks contract creation when lead and plot are ALREADY completely linked to an active contract', async () => {
      const existingCompleteContract = {
        id: 'existing-contract-99',
        lead_id: 'lead-1',
        plot_id: 'plot-1',
        status: 'Active',
        monthly_rent: 15000,
        security_deposit: 30000,
        program_type: 'program_a',
        lease_start_date: '2026-01-01',
        lease_duration_months: 12
      };

      const leadAlreadyFullyRented = {
        ...lead,
        status: 'Rented',
        rental_status: 'Active',
        active_rental_contract_id: 'existing-contract-99'
      };

      resolveQuery = q => {
        if (q.table === 'plots' && q.action === 'read') {
          return ok([{ id: 'plot-1', plot_name: '1', project_name: 'Project', sale_status: 'Rented', has_customer: true, current_tenant_name: 'Somchai Jaidee' }]);
        }
        if (q.table === 'rental_contracts' && q.action === 'read') return ok([existingCompleteContract]);
        return defaultResult(q);
      };

      render(<RentalContractModal isOpen={true} onClose={vi.fn()} lead={leadAlreadyFullyRented as any} plotId="plot-1" projectName="Project" user={user} salesOwners={salesOwners} defaultMode="contract" />);

      await waitFor(() => expect(screen.queryByText(/กำลังโหลดแปลง/i)).not.toBeInTheDocument());
      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันบันทึกสัญญาเช่า' })).toBeEnabled());
      submit(/ยืนยันบันทึกสัญญาเช่า/);

      await waitFor(() => expect(screen.getByText(/ลูกค้ามีสัญญาเช่าที่ใช้งานอยู่แล้ว กรุณาจัดการสัญญาเดิม/i)).toBeInTheDocument());

      expect(writes('rental_contracts').length).toBe(0);
    });

    it('rejects contract creation when customer has an active contract on a DIFFERENT plot', async () => {
      const otherPlotContract = {
        id: 'contract-different-plot',
        lead_id: 'lead-1',
        plot_id: 'plot-different-999',
        status: 'Active'
      };

      resolveQuery = q => {
        if (q.table === 'plots' && q.action === 'read') {
          return ok([{ id: 'plot-1', plot_name: '1', project_name: 'Project', sale_status: 'Available', has_customer: false }]);
        }
        if (q.table === 'rental_contracts' && q.action === 'read') return ok([otherPlotContract]);
        return defaultResult(q);
      };

      render(<RentalContractModal isOpen={true} onClose={vi.fn()} lead={lead as any} plotId="plot-1" projectName="Project" user={user} salesOwners={salesOwners} defaultMode="contract" />);

      await waitFor(() => expect(screen.queryByText(/กำลังโหลดแปลง/i)).not.toBeInTheDocument());
      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันบันทึกสัญญาเช่า' })).toBeEnabled());
      submit(/ยืนยันบันทึกสัญญาเช่า/);

      await waitFor(() => expect(screen.getByText(/ลูกค้ามีสัญญาเช่าที่ใช้งานอยู่แล้วในแปลงอื่น/i)).toBeInTheDocument());

      expect(writes('rental_contracts').length).toBe(0);
    });
  });

  // Issue D: Sales Cancellation Scoping & Error Handling
  describe('Issue D: Sales Cancellation Scoping & Error Handling', () => {
    it('scopes sales cancellation to both lead_id and plot_id', async () => {
      render(<RentalContractModal isOpen={true} onClose={vi.fn()} lead={lead as any} plotId="plot-1" projectName="Project" user={user} salesOwners={salesOwners} defaultMode="contract" />);

      await waitFor(() => expect(screen.queryByText(/กำลังโหลดแปลง/i)).not.toBeInTheDocument());
      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันบันทึกสัญญาเช่า' })).toBeEnabled());
      submit(/ยืนยันบันทึกสัญญาเช่า/);

      await waitFor(() => {
        const salesUpdates = writes('sales');
        expect(salesUpdates.length).toBeGreaterThan(0);
        const q = salesUpdates[0];
        const hasLeadFilter = q.filters.some(([k, v]) => k === 'lead_id' && v === 'lead-1');
        const hasPlotFilter = q.filters.some(([k, v]) => k === 'plot_id' && v === 'plot-1');
        expect(hasLeadFilter).toBe(true);
        expect(hasPlotFilter).toBe(true);
      });
    });

    it('throws when sales cancellation update encounters a database error', async () => {
      resolveQuery = q => {
        if (q.table === 'sales' && q.action === 'update') return fail('Sales cancellation constraint violation');
        return defaultResult(q);
      };

      render(<RentalContractModal isOpen={true} onClose={vi.fn()} lead={lead as any} plotId="plot-1" projectName="Project" user={user} salesOwners={salesOwners} defaultMode="contract" />);

      await waitFor(() => expect(screen.queryByText(/กำลังโหลดแปลง/i)).not.toBeInTheDocument());
      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันบันทึกสัญญาเช่า' })).toBeEnabled());
      submit(/ยืนยันบันทึกสัญญาเช่า/);

      await waitFor(() => expect(screen.getByText(/Sales cancellation constraint violation/i)).toBeInTheDocument());
    });
  });

  // Issue E: Coincidental Customer Name Matching
  describe('Issue E: Customer Name Match Does Not Grant Plot Rights', () => {
    it('does not allow another customer with matching name to claim a plot committed to a different lead_id', async () => {
      const differentLeadWithSameName = {
        id: 'lead-999-other',
        customer_name: 'Somchai Jaidee',
        phone: '0899999999',
        status: 'Follow Up',
        project_name: 'Project',
        interested_plot_id: 'plot-99'
      };

      let plotReadCount = 0;
      resolveQuery = q => {
        if (q.table === 'plots' && q.action === 'read') {
          plotReadCount++;
          if (plotReadCount === 1) {
            return ok([{ id: 'plot-1', plot_name: '1', project_name: 'Project', sale_status: 'Booked', has_customer: true, customer_name: 'Somchai Jaidee', lead_id: 'lead-1' }]);
          }
          return ok([{ id: 'plot-1', plot_name: '1', project_name: 'Project', sale_status: 'Booked', has_customer: true, customer_name: 'Somchai Jaidee', lead_id: 'lead-1' }]);
        }
        return defaultResult(q);
      };

      render(<RentalContractModal isOpen={true} onClose={vi.fn()} lead={differentLeadWithSameName as any} plotId="plot-1" projectName="Project" user={user} salesOwners={salesOwners} defaultMode="contract" />);

      await waitFor(() => expect(screen.queryByText(/กำลังโหลดแปลง/i)).not.toBeInTheDocument());
      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันบันทึกสัญญาเช่า' })).toBeEnabled());
      submit(/ยืนยันบันทึกสัญญาเช่า/);

      await waitFor(() => expect(screen.getByText(/แปลงนี้ถูกจองหรือมีลูกค้าอื่นถือสิทธิ์อยู่แล้ว/i)).toBeInTheDocument());

      expect(writes('rental_contracts').length).toBe(0);
    });

    it('Finding D: does not allow coincidental name match to claim plot when plots table has no lead_id column', async () => {
      const differentLeadWithSameName = {
        id: 'lead-999-other',
        customer_name: 'Somchai Jaidee',
        phone: '0899999999',
        status: 'Follow Up',
        project_name: 'Project',
        interested_plot_id: 'plot-1'
      };

      resolveQuery = q => {
        if (q.table === 'plots' && q.action === 'read') {
          return ok([{ id: 'plot-1', plot_name: '1', project_name: 'Project', sale_status: 'Booked', has_customer: true, customer_name: 'Somchai Jaidee' }]);
        }
        if (q.table === 'leads' && q.action === 'read') return ok([{ id: 'lead-1', customer_name: 'Somchai Jaidee' }]);
        return defaultResult(q);
      };

      render(<RentalContractModal isOpen={true} onClose={vi.fn()} lead={differentLeadWithSameName as any} plotId="plot-1" projectName="Project" user={user} salesOwners={salesOwners} defaultMode="contract" />);

      await waitFor(() => expect(screen.queryByText(/กำลังโหลดแปลง/i)).not.toBeInTheDocument());
      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันบันทึกสัญญาเช่า' })).toBeEnabled());
      submit(/ยืนยันบันทึกสัญญาเช่า/);

      await waitFor(() => expect(screen.getByText(/แปลงนี้ถูกจองหรือมีลูกค้าอื่นถือสิทธิ์อยู่แล้ว/i)).toBeInTheDocument());

      expect(writes('rental_contracts').length).toBe(0);
    });

    it('Finding P1: aborts and performs 0 mutations when salesHold query returns error', async () => {
      const onSaved = vi.fn();
      const onClose = vi.fn();
      resolveQuery = q => {
        if (q.table === 'sales' && q.action === 'read' && q.filters.some(([k]) => k === 'plot_id')) return fail('sales query failed');
        return defaultResult(q);
      };

      render(<RentalContractModal isOpen={true} onClose={onClose} onSaved={onSaved} lead={lead as any} plotId="plot-1" projectName="Project" user={user} salesOwners={salesOwners} defaultMode="contract" />);

      await waitFor(() => expect(screen.queryByText(/กำลังโหลดแปลง/i)).not.toBeInTheDocument());
      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันบันทึกสัญญาเช่า' })).toBeEnabled());
      submit(/ยืนยันบันทึกสัญญาเช่า/);

      await waitFor(() => expect(screen.getByText(/ไม่สามารถตรวจสอบข้อมูลการจอง\/ขายในระบบได้/i)).toBeInTheDocument());

      expect(writes().length).toBe(0);
      expect(onSaved).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    });

    it('Finding P1: aborts and performs 0 mutations when rentalHold query returns error', async () => {
      const onSaved = vi.fn();
      const onClose = vi.fn();
      resolveQuery = q => {
        if (q.table === 'rental_contracts' && q.action === 'read' && q.filters.some(([k]) => k === 'plot_id')) {
          return fail('rental contracts query failed');
        }
        return defaultResult(q);
      };

      render(<RentalContractModal isOpen={true} onClose={onClose} onSaved={onSaved} lead={lead as any} plotId="plot-1" projectName="Project" user={user} salesOwners={salesOwners} defaultMode="contract" />);

      await waitFor(() => expect(screen.queryByText(/กำลังโหลดแปลง/i)).not.toBeInTheDocument());
      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันบันทึกสัญญาเช่า' })).toBeEnabled());
      submit(/ยืนยันบันทึกสัญญาเช่า/);

      await waitFor(() => expect(screen.getByText(/ไม่สามารถตรวจสอบข้อมูลสัญญาเช่าในระบบได้/i)).toBeInTheDocument());

      expect(writes().length).toBe(0);
      expect(onSaved).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    });

    it('Finding P1: aborts and performs 0 mutations when leadHold query returns error', async () => {
      const onSaved = vi.fn();
      const onClose = vi.fn();
      resolveQuery = q => {
        if (q.table === 'leads' && q.action === 'read' && q.filters.some(([k]) => k === 'interested_plot_id')) return fail('lead hold query failed');
        return defaultResult(q);
      };

      render(<RentalContractModal isOpen={true} onClose={onClose} onSaved={onSaved} lead={lead as any} plotId="plot-1" projectName="Project" user={user} salesOwners={salesOwners} defaultMode="contract" />);

      await waitFor(() => expect(screen.queryByText(/กำลังโหลดแปลง/i)).not.toBeInTheDocument());
      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันบันทึกสัญญาเช่า' })).toBeEnabled());
      submit(/ยืนยันบันทึกสัญญาเช่า/);

      await waitFor(() => expect(screen.getByText(/ไม่สามารถตรวจสอบข้อมูลลูกค้าผู้ถือสิทธิ์แปลงได้/i)).toBeInTheDocument());

      expect(writes().length).toBe(0);
      expect(onSaved).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    });

    it('Finding P1: aborts when all three hold queries return error simultaneously', async () => {
      const onSaved = vi.fn();
      const onClose = vi.fn();
      resolveQuery = q => {
        if (q.action === 'read' && (q.filters.some(([k]) => k === 'plot_id' || k === 'interested_plot_id'))) return fail('network partition');
        return defaultResult(q);
      };

      render(<RentalContractModal isOpen={true} onClose={onClose} onSaved={onSaved} lead={lead as any} plotId="plot-1" projectName="Project" user={user} salesOwners={salesOwners} defaultMode="contract" />);

      await waitFor(() => expect(screen.queryByText(/กำลังโหลดแปลง/i)).not.toBeInTheDocument());
      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันบันทึกสัญญาเช่า' })).toBeEnabled());
      submit(/ยืนยันบันทึกสัญญาเช่า/);

      await waitFor(() => expect(screen.getByText(/ไม่สามารถตรวจสอบข้อมูล/i)).toBeInTheDocument());

      expect(writes().length).toBe(0);
      expect(onSaved).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    });

    it('Finding P1: aborts when hold query throws network failure', async () => {
      const onSaved = vi.fn();
      const onClose = vi.fn();
      resolveQuery = q => {
        if (q.table === 'sales' && q.action === 'read' && q.filters.some(([k]) => k === 'plot_id')) {
          throw new Error('Connection refused');
        }
        return defaultResult(q);
      };

      render(<RentalContractModal isOpen={true} onClose={onClose} onSaved={onSaved} lead={lead as any} plotId="plot-1" projectName="Project" user={user} salesOwners={salesOwners} defaultMode="contract" />);

      await waitFor(() => expect(screen.queryByText(/กำลังโหลดแปลง/i)).not.toBeInTheDocument());
      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันบันทึกสัญญาเช่า' })).toBeEnabled());
      submit(/ยืนยันบันทึกสัญญาเช่า/);

      await waitFor(() => expect(screen.getByText(/Connection refused/i)).toBeInTheDocument());

      expect(writes().length).toBe(0);
      expect(onSaved).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    });

    it('Finding P1: aborts when query returns malformed non-array data', async () => {
      const onSaved = vi.fn();
      const onClose = vi.fn();
      resolveQuery = q => {
        if (q.table === 'sales' && q.action === 'read' && q.filters.some(([k]) => k === 'plot_id')) return ok('corrupted string data' as any);
        return defaultResult(q);
      };

      render(<RentalContractModal isOpen={true} onClose={onClose} onSaved={onSaved} lead={lead as any} plotId="plot-1" projectName="Project" user={user} salesOwners={salesOwners} defaultMode="contract" />);

      await waitFor(() => expect(screen.queryByText(/กำลังโหลดแปลง/i)).not.toBeInTheDocument());
      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันบันทึกสัญญาเช่า' })).toBeEnabled());
      submit(/ยืนยันบันทึกสัญญาเช่า/);

      await waitFor(() => expect(screen.getByText(/รูปแบบข้อมูลการจอง\/ขายไม่ถูกต้อง/i)).toBeInTheDocument());

      expect(writes().length).toBe(0);
      expect(onSaved).not.toHaveBeenCalled();
    });

    it('Finding P1: aborts in booking mode when plot authority check returns error', async () => {
      const onSaved = vi.fn();
      const onClose = vi.fn();
      resolveQuery = q => {
        if (q.table === 'sales' && q.action === 'read' && q.filters.some(([k]) => k === 'plot_id')) return fail('DB timeout during booking check');
        return defaultResult(q);
      };

      render(<RentalContractModal isOpen={true} onClose={onClose} onSaved={onSaved} lead={lead as any} plotId="plot-1" projectName="Project" user={user} salesOwners={salesOwners} defaultMode="booking" />);

      await waitFor(() => expect(screen.queryByText(/กำลังโหลดแปลง/i)).not.toBeInTheDocument());
      await waitFor(() => expect(screen.getByRole('button', { name: /ยืนยันบันทึกการจองเช่า/ })).toBeEnabled());
      submit(/ยืนยันบันทึกการจองเช่า/);

      await waitFor(() => expect(screen.getByText(/ไม่สามารถตรวจสอบข้อมูลการจอง\/ขายในระบบได้/i)).toBeInTheDocument());

      expect(writes().length).toBe(0);
      expect(onSaved).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    });

    it('Finding P1: aborts when plot is claimed by another before plot update (concurrency collision)', async () => {
      const onSaved = vi.fn();
      const onClose = vi.fn();
      resolveQuery = q => {
        if (q.table === 'plots' && q.action === 'update') return { data: [], error: null };
        return defaultResult(q);
      };

      render(<RentalContractModal isOpen={true} onClose={onClose} onSaved={onSaved} lead={lead as any} plotId="plot-1" projectName="Project" user={user} salesOwners={salesOwners} defaultMode="booking" />);

      await waitFor(() => expect(screen.queryByText(/กำลังโหลดแปลง/i)).not.toBeInTheDocument());
      await waitFor(() => expect(screen.getByRole('button', { name: /ยืนยันบันทึกการจองเช่า/ })).toBeEnabled());
      submit(/ยืนยันบันทึกการจองเช่า/);

      await waitFor(() => expect(screen.getByText(/แปลงนี้ถูกเปลี่ยนสถานะหรือมีผู้ถือสิทธิ์อื่นแล้วในระหว่างทำรายการ/i)).toBeInTheDocument());

      expect(onSaved).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  // Issue F & G: Cross-tab & In-Window Broadcast and Debounce
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
  describe('Finding 4 — P2: RentalActionModal optimistic notes lock PGRST116 handling and merge/retry', () => {
    it('Finding 4: recovers from PGRST116 optimistic lock error, merges concurrent notes and retries successfully', async () => {
      let contractNotes = 'Initial Note A';
      let leadNotes = 'Initial Lead Note';
      let attempts = 0;
      let readCountInAction = 0;
      let submitStarted = false;

      resolveQuery = q => {
        if (q.table === 'plots' && q.action === 'read') {
          return ok({ id: 'plot-1', sale_status: 'Rented', has_customer: true, current_tenant_name: 'Somchai Jaidee' });
        }
        if (q.table === 'rental_contracts' && q.action === 'read') {
          if (submitStarted) {
            readCountInAction++;
            if (readCountInAction === 1) {
              const returnedNotes = contractNotes;
              contractNotes = 'Initial Note A\nConcurrent Note B by another user';
              return ok(q.single ? { ...contract, notes: returnedNotes } : [{ ...contract, notes: returnedNotes }]);
            }
          }
          return ok(q.single ? { ...contract, notes: contractNotes } : [{ ...contract, notes: contractNotes }]);
        }
        if (q.table === 'leads' && q.action === 'read') return ok(q.single ? { ...lead, notes: leadNotes } : [{ ...lead, notes: leadNotes }]);
        if (q.action === 'update' && q.table === 'rental_contracts') {
          attempts++;
          const payload = q.payload as Record<string, unknown>;
          const notesFilter = q.filters.find(([k]) => k === 'notes');
          if (notesFilter && notesFilter[1] !== contractNotes) {
            return {
              data: null,
              error: { code: 'PGRST116', message: 'multiple (or no) rows returned', details: 'The result contains 0 rows' }
            } as any;
          }
          contractNotes = String(payload.notes || '');
          return ok({ id: 'contract-saved' });
        }
        if (q.action === 'update' && q.table === 'leads') {
          leadNotes = String((q.payload as Record<string, unknown>).notes || '');
          return ok({ id: 'lead-saved' });
        }
        return defaultResult(q);
      };

      const onClose = vi.fn();
      render(<RentalActionModal isOpen={true} contractId="contract-1" onClose={onClose} lead={{ ...lead, notes: leadNotes } as any} user={user} />);

      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());
      fireEvent.click(screen.getByRole('button', { name: /3. สิ้นสุดสัญญา/ }));
      fireEvent.change(screen.getByPlaceholderText(/ตรวจมิเตอร์น้ำไฟ/i), { target: { value: 'User MoveOut Note' } });

      submitStarted = true;
      submit(/ยืนยันการย้ายออก/);

      await waitFor(() => expect(onClose).toHaveBeenCalled());

      expect(contractNotes).toContain('Initial Note A');
      expect(contractNotes).toContain('Concurrent Note B by another user');
      expect(contractNotes).toContain('User MoveOut Note');
      expect(contractNotes).toContain('ย้ายออกเมื่อ');
      expect(attempts).toBe(2);
    });

    it('Finding 4: does not retry on permission error or network error and throws immediately', async () => {
      resolveQuery = q => {
        if (q.table === 'plots' && q.action === 'read') {
          return ok({ id: 'plot-1', sale_status: 'Rented', has_customer: true, current_tenant_name: 'Somchai Jaidee' });
        }
        if (q.table === 'rental_contracts' && q.action === 'read') return ok(q.single ? contract : [contract]);
        if (q.table === 'leads' && q.action === 'read') return ok(q.single ? lead : [lead]);
        if (q.action === 'update' && q.table === 'rental_contracts') {
          return { data: null, error: { code: '42501', message: 'permission denied for table rental_contracts' } } as any;
        }
        return defaultResult(q);
      };

      const onClose = vi.fn();
      render(<RentalActionModal isOpen={true} contractId="contract-1" onClose={onClose} lead={lead as any} user={user} />);

      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());
      fireEvent.click(screen.getByRole('button', { name: /3. สิ้นสุดสัญญา/ }));
      submit(/ยืนยันการย้ายออก/);

      await waitFor(() => expect(screen.getByText(/permission denied/i)).toBeInTheDocument());
      expect(onClose).not.toHaveBeenCalled();
    });

    it('Finding 4: stops immediately without retry if contract status changed to Cancelled during conflict', async () => {
      let readCount = 0;
      resolveQuery = q => {
        if (q.table === 'plots' && q.action === 'read') {
          return ok({ id: 'plot-1', sale_status: 'Rented', has_customer: true, current_tenant_name: 'Somchai Jaidee' });
        }
        if (q.table === 'rental_contracts' && q.action === 'read') {
          readCount++;
          const status = readCount > 1 ? 'Cancelled' : 'Active';
          return ok(q.single ? { ...contract, status } : [{ ...contract, status }]);
        }
        if (q.action === 'update' && q.table === 'rental_contracts') {
          return { data: null, error: { code: 'PGRST116', details: 'The result contains 0 rows' } } as any;
        }
        return defaultResult(q);
      };

      const onClose = vi.fn();
      render(<RentalActionModal isOpen={true} contractId="contract-1" onClose={onClose} lead={lead as any} user={user} />);

      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());
      fireEvent.click(screen.getByRole('button', { name: /3. สิ้นสุดสัญญา/ }));
      submit(/ยืนยันการย้ายออก/);

      await waitFor(() => expect(screen.getByText(/ไม่พบรายการที่แก้ไขได้/i)).toBeInTheDocument());
      expect(onClose).not.toHaveBeenCalled();
    });
  });
  // Finding 1 — P1: SalesDealStatusModal sync and field-level concurrency
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
            leadRow.notes = '• ราคาขาย: 5,000,000 บ.  • ธนาคาร: Bank Secret';
            return ok({ ...leadRow, notes: '• ราคาขาย: 1,000,000 บ.  • ธนาคาร: Bank A' });
          }
          return ok(leadRow);
        }
        if (q.table === 'sales' && q.action === 'read') return ok([]);
        if (q.table === 'leads' && q.action === 'update') {
          const notesFilter = q.filters.find(([k]) => k === 'notes');
          if (notesFilter && notesFilter[1] !== leadRow.notes) {
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
  describe('Finding B — P1: RentalActionModal Lifecycle Safety & Status Guard', () => {
    it('B1: notes-only change on lead & contract merges cleanly and retries successfully', async () => {
      let contractNotes = 'Initial Note A';
      let leadNotes = 'Initial Lead Note';
      let attempts = 0;
      let readCount = 0;

      resolveQuery = q => {
        if (q.table === 'plots' && q.action === 'read') {
          return ok({ id: 'plot-1', sale_status: 'Rented', has_customer: true, current_tenant_name: 'Somchai Jaidee' });
        }
        if (q.table === 'rental_contracts' && q.action === 'read') {
          readCount++;
          if (readCount === 2) {
            const ret = contractNotes;
            contractNotes = 'Initial Note A\nConcurrent Note B';
            return ok(q.single ? { ...contract, notes: ret } : [{ ...contract, notes: ret }]);
          }
          return ok(q.single ? { ...contract, notes: contractNotes } : [{ ...contract, notes: contractNotes }]);
        }
        if (q.table === 'leads' && q.action === 'read') return ok(q.single ? { ...lead, notes: leadNotes } : [{ ...lead, notes: leadNotes }]);
        if (q.action === 'update' && q.table === 'rental_contracts') {
          attempts++;
          const payload = q.payload as Record<string, unknown>;
          const notesFilter = q.filters.find(([k]) => k === 'notes');
          if (notesFilter && notesFilter[1] !== contractNotes) {
            return { data: null, error: { code: 'PGRST116', details: 'The result contains 0 rows' } } as any;
          }
          contractNotes = String(payload.notes || '');
          return ok({ id: 'contract-saved' });
        }
        return defaultResult(q);
      };

      const onClose = vi.fn();
      render(<RentalActionModal isOpen={true} contractId="contract-1" onClose={onClose} lead={{ ...lead, notes: leadNotes } as any} user={user} />);

      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());
      fireEvent.click(screen.getByRole('button', { name: /3. สิ้นสุดสัญญา/ }));
      fireEvent.change(screen.getByPlaceholderText(/ตรวจมิเตอร์น้ำไฟ/i), { target: { value: 'User Note' } });
      submit(/ยืนยันการย้ายออก/);

      await waitFor(() => expect(onClose).toHaveBeenCalled());
      expect(attempts).toBe(2);
      expect(contractNotes).toContain('Initial Note A');
      expect(contractNotes).toContain('Concurrent Note B');
      expect(contractNotes).toContain('User Note');
    });

    it('B2: lead status changed from Rented to Transferred during move-out is rejected and not overwritten to MovedOut', async () => {
      let leadStatus = 'Transferred';
      resolveQuery = q => {
        if (q.table === 'plots' && q.action === 'read') {
          return ok({ id: 'plot-1', sale_status: 'Rented', has_customer: true, current_tenant_name: 'Somchai Jaidee' });
        }
        if (q.table === 'rental_contracts' && q.action === 'read') return ok(q.single ? contract : [contract]);
        if (q.table === 'leads' && q.action === 'read') return ok(q.single ? { ...lead, status: leadStatus } : [{ ...lead, status: leadStatus }]);
        return defaultResult(q);
      };

      const onClose = vi.fn();
      render(<RentalActionModal isOpen={true} contractId="contract-1" onClose={onClose} lead={{ ...lead, status: 'Rented' } as any} user={user} />);

      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());
      fireEvent.click(screen.getByRole('button', { name: /3. สิ้นสุดสัญญา/ }));
      submit(/ยืนยันการย้ายออก/);

      await waitFor(() => expect(screen.getByText(/สถานะของลูกค้าในระบบเปลี่ยนเป็น "Transferred" แล้ว/i)).toBeInTheDocument());
      expect(onClose).not.toHaveBeenCalled();

      const leadUpdates = writes('leads');
      expect(leadUpdates.length).toBe(0);
    });

    it('B3: lead linked to a new active contract does not have active_rental_contract_id wiped by move-out of old contract', async () => {
      let updatedPayload: Record<string, unknown> | null = null;
      let plotUpdateCount = 0;
      let finalPlotState = { id: 'plot-1', sale_status: 'Rented', has_customer: true, current_tenant_name: 'Somchai Jaidee' };

      resolveQuery = q => {
        if (q.table === 'plots' && q.action === 'read') return ok(finalPlotState);
        if (q.table === 'rental_contracts' && q.action === 'read') {
          if (q.filters.some(([k, v]) => k === 'neq:id' && v === 'contract-1')) {
            // Plot has another active contract (the new renewed contract)!
            return ok([{ id: 'contract-999-new', status: 'Active', tenant_name: 'Somchai Jaidee', plot_id: 'plot-1' }]);
          }
          return ok(q.single ? contract : [contract]);
        }
        if (q.table === 'leads' && q.action === 'read') {
          return ok(q.single ? { ...lead, status: 'Rented', rental_status: 'Renewed', crm_status: 'Renewed', active_rental_contract_id: 'contract-999-new' } : [{ ...lead, status: 'Rented', rental_status: 'Renewed', crm_status: 'Renewed', active_rental_contract_id: 'contract-999-new' }]);
        }
        if (q.table === 'leads' && q.action === 'update') {
          updatedPayload = q.payload as Record<string, unknown>;
          return ok({ id: 'lead-saved' });
        }
        if (q.table === 'plots' && q.action === 'update') {
          plotUpdateCount++;
          return ok({ id: 'plot-saved' });
        }
        return defaultResult(q);
      };

      const onClose = vi.fn();
      render(<RentalActionModal isOpen={true} contractId="contract-1" onClose={onClose} lead={{ ...lead, status: 'Rented', rental_status: 'Renewed', crm_status: 'Renewed', active_rental_contract_id: 'contract-1' } as any} user={user} />);

      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());
      fireEvent.click(screen.getByRole('button', { name: /3. สิ้นสุดสัญญา/ }));
      submit(/ยืนยันการย้ายออก/);

      await waitFor(() => expect(onClose).toHaveBeenCalled());

      expect(updatedPayload).not.toBeNull();
      // Verifies that when customer is linked to a new active contract, move-out of old contract ONLY appends historical notes
      // and does NOT touch any lifecycle fields on Lead
      expect(updatedPayload).not.toHaveProperty('active_rental_contract_id');
      expect(updatedPayload).not.toHaveProperty('status');
      expect(updatedPayload).not.toHaveProperty('rental_status');
      expect(updatedPayload).not.toHaveProperty('crm_status');
      expect(updatedPayload).not.toHaveProperty('deal_type');
      expect((updatedPayload as any)?.notes).toBeDefined();
      expect(String((updatedPayload as any)?.notes)).toContain('ย้ายออก');

      // Verifies plot was protected and not wiped to Available because new active contract exists on it
      expect(plotUpdateCount).toBe(0);
      expect(finalPlotState.sale_status).toBe('Rented');
    });

    it('B4: contract status changed to Cancelled during retry aborts immediately without bypassing guard', async () => {
      let readCount = 0;
      resolveQuery = q => {
        if (q.table === 'plots' && q.action === 'read') {
          return ok({ id: 'plot-1', sale_status: 'Rented', has_customer: true, current_tenant_name: 'Somchai Jaidee' });
        }
        if (q.table === 'rental_contracts' && q.action === 'read') {
          readCount++;
          const status = readCount > 1 ? 'Cancelled' : 'Active';
          return ok(q.single ? { ...contract, status } : [{ ...contract, status }]);
        }
        if (q.action === 'update' && q.table === 'rental_contracts') {
          return { data: null, error: { code: 'PGRST116', details: 'The result contains 0 rows' } } as any;
        }
        return defaultResult(q);
      };

      const onClose = vi.fn();
      render(<RentalActionModal isOpen={true} contractId="contract-1" onClose={onClose} lead={lead as any} user={user} />);

      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());
      fireEvent.click(screen.getByRole('button', { name: /3. สิ้นสุดสัญญา/ }));
      submit(/ยืนยันการย้ายออก/);

      await waitFor(() => expect(screen.getByText(/ไม่พบรายการที่แก้ไขได้/i)).toBeInTheDocument());
      expect(onClose).not.toHaveBeenCalled();
    });

    it('B5: lead status changed but notes unchanged is caught by conditional status guard in WHERE clause', async () => {
      let leadRow = {
        id: 'lead-1',
        status: 'Rented',
        rental_status: 'Rented',
        notes: 'Existing lead note from sales pitch',
        active_rental_contract_id: 'contract-1'
      };

      resolveQuery = q => {
        if (q.table === 'plots' && q.action === 'read') {
          return ok({ id: 'plot-1', sale_status: 'Rented', has_customer: true, current_tenant_name: 'Somchai Jaidee' });
        }
        if (q.table === 'rental_contracts' && q.action === 'read') return ok(q.single ? contract : [contract]);
        if (q.table === 'leads' && q.action === 'read') {
          const snapshot = { ...leadRow };
          // Simulate race condition: lead status changed concurrently in DB after read, while notes remain unchanged
          leadRow.status = 'Lost';
          return ok(q.single ? snapshot : [snapshot]);
        }
        if (q.table === 'leads' && q.action === 'update') {
          // State-based query evaluation: matches WHERE filters against current in-memory leadRow
          return matchUpdate(leadRow, q);
        }
        return defaultResult(q);
      };

      const onClose = vi.fn();
      render(<RentalActionModal isOpen={true} contractId="contract-1" onClose={onClose} lead={{ ...lead, status: 'Rented' } as any} user={user} />);

      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());
      fireEvent.click(screen.getByRole('button', { name: /3. สิ้นสุดสัญญา/ }));
      submit(/ยืนยันการย้ายออก/);

      await waitFor(() => expect(screen.getByText(/สถานะของลูกค้าถูกยกเลิกแล้ว ไม่สามารถดำเนินการได้/i)).toBeInTheDocument());
      expect(onClose).not.toHaveBeenCalled();
      // Verifies leadRow in DB was NOT modified by move-out
      expect(leadRow.status).toBe('Lost');
      expect(leadRow.rental_status).toBe('Rented');
    });

    it('B6: permission error 42501 or network error does not trigger retry and throws immediately', async () => {
      resolveQuery = q => {
        if (q.table === 'plots' && q.action === 'read') {
          return ok({ id: 'plot-1', sale_status: 'Rented', has_customer: true, current_tenant_name: 'Somchai Jaidee' });
        }
        if (q.table === 'rental_contracts' && q.action === 'read') return ok(q.single ? contract : [contract]);
        if (q.action === 'update' && q.table === 'rental_contracts') return { data: null, error: { code: '42501', message: 'permission denied' } } as any;
        return defaultResult(q);
      };

      const onClose = vi.fn();
      render(<RentalActionModal isOpen={true} contractId="contract-1" onClose={onClose} lead={lead as any} user={user} />);

      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());
      fireEvent.click(screen.getByRole('button', { name: /3. สิ้นสุดสัญญา/ }));
      submit(/ยืนยันการย้ายออก/);

      await waitFor(() => expect(screen.getByText(/permission denied/i)).toBeInTheDocument());
      expect(onClose).not.toHaveBeenCalled();
    });

    it('B7: conflict repeated up to retry limit stops without calling success callback or closing', async () => {
      let readCount = 0;
      resolveQuery = q => {
        if (q.table === 'plots' && q.action === 'read') {
          return ok({ id: 'plot-1', sale_status: 'Rented', has_customer: true, current_tenant_name: 'Somchai Jaidee' });
        }
        if (q.table === 'rental_contracts' && q.action === 'read') {
          readCount++;
          return ok(q.single ? { ...contract, notes: 'Conflict note ' + readCount } : [{ ...contract, notes: 'Conflict note ' + readCount }]);
        }
        if (q.action === 'update' && q.table === 'rental_contracts') {
          return { data: null, error: { code: 'PGRST116', details: 'The result contains 0 rows' } } as any;
        }
        return defaultResult(q);
      };

      const onClose = vi.fn();
      render(<RentalActionModal isOpen={true} contractId="contract-1" onClose={onClose} lead={lead as any} user={user} />);

      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());
      fireEvent.click(screen.getByRole('button', { name: /3. สิ้นสุดสัญญา/ }));
      submit(/ยืนยันการย้ายออก/);

      await waitFor(() => expect(screen.getByText(/บันทึกไม่สำเร็จ เนื่องจากมีการแก้ไขข้อมูลพร้อมกันเกินจำนวนครั้งที่กำหนด/i)).toBeInTheDocument());
      expect(onClose).not.toHaveBeenCalled();
    });

    it('B8: resuming/retrying partial save does not duplicate logs or overwrite new status', async () => {
      let contractNotes = 'ย้ายออกเมื่อ 2026-05-01 (คืนเงินประกันสุทธิ 30,000 บาท)';
      let leadNotes = '[สิ้นสุดสัญญาเช่า ย้ายออก 2026-05-01]: คืนเงินประกัน 30,000 บ.';

      resolveQuery = q => {
        if (q.table === 'plots' && q.action === 'read') {
          return ok({ id: 'plot-1', sale_status: 'Available', has_customer: false, current_tenant_name: null });
        }
        if (q.table === 'rental_contracts' && q.action === 'read') {
          return ok(q.single ? { ...contract, status: 'MovedOut', notes: contractNotes } : [{ ...contract, status: 'MovedOut', notes: contractNotes }]);
        }
        if (q.table === 'leads' && q.action === 'read') return ok(q.single ? { ...lead, notes: leadNotes } : [{ ...lead, notes: leadNotes }]);
        if (q.action === 'update') {
          if (q.table === 'leads') leadNotes = String((q.payload as Record<string, unknown>).notes || '');
          if (q.table === 'rental_contracts') contractNotes = String((q.payload as Record<string, unknown>).notes || '');
          return ok({ id: q.table + '-saved' });
        }
        return defaultResult(q);
      };

      const onClose = vi.fn();
      render(<RentalActionModal isOpen={true} contractId="contract-1" onClose={onClose} lead={{ ...lead, notes: leadNotes } as any} user={user} />);

      await waitFor(() => expect(screen.getByRole('button', { name: /3. สิ้นสุดสัญญา/ })).toBeInTheDocument());
      fireEvent.click(screen.getByRole('button', { name: /3. สิ้นสุดสัญญา/ }));
      submit(/ยืนยันการย้ายออก/);

      await waitFor(() => expect(onClose).toHaveBeenCalled());

      const leadMatches = (leadNotes.match(/\[สิ้นสุดสัญญาเช่า ย้ายออก 2026-05-01\]/g) || []).length;
      expect(leadMatches).toBe(1);
    });

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
  describe('Finding 1 Verification: Conditional Status & Lease Guards at Write Time', () => {
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

    it('F1.2: move-out conditional status guard in WHERE clause catches concurrent contract status change', async () => {
      let contractRow = { ...contract, status: 'Active', notes: 'Active contract notes' };
      let submitStarted = false;
      resolveQuery = q => {
        if (q.table === 'plots' && q.action === 'read') {
          return ok({ id: 'plot-1', sale_status: 'Rented', has_customer: true, current_tenant_name: 'Somchai Jaidee' });
        }
        if (q.table === 'rental_contracts' && q.action === 'read') {
          const snap = { ...contractRow };
          if (submitStarted) {
            contractRow.status = 'Terminated';
          }
          return ok(q.single ? snap : [snap]);
        }
        if (q.table === 'rental_contracts' && q.action === 'update') return matchUpdate(contractRow, q);
        return defaultResult(q);
      };

      const onClose = vi.fn();
      render(<RentalActionModal isOpen={true} contractId="contract-1" onClose={onClose} lead={{ ...lead, status: 'Rented' } as any} user={user} />);

      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());
      fireEvent.click(screen.getByRole('button', { name: /3. สิ้นสุดสัญญา/ }));
      submitStarted = true;
      submit(/ยืนยันการย้ายออก/);

      await waitFor(() => expect(screen.getByText(/ไม่พบรายการที่แก้ไขได้/i)).toBeInTheDocument());
      expect(onClose).not.toHaveBeenCalled();
      expect(contractRow.status).toBe('Terminated');
    });

    it('F1.3: convert-to-buy write-time guard enforces status integrity and prevents overwriting cancelled contract', async () => {
      let contractRow = { ...contract, status: 'Active', notes: 'Active contract' };
      resolveQuery = q => {
        if (q.table === 'plots' && q.action === 'read') {
          return ok({ id: 'plot-1', sale_status: 'Rented', has_customer: true, current_tenant_name: 'Somchai Jaidee' });
        }
        if (q.table === 'rental_contracts' && q.action === 'update') {
          const statusGuard = q.filters.find(([k]) => k === 'status');
          // If contract was cancelled concurrently, WHERE status = 'Active' fails
          if (statusGuard && statusGuard[1] !== 'Cancelled') {
            return { data: null, error: { code: 'PGRST116', message: 'ไม่พบรายการที่แก้ไขได้ กรุณาโหลดข้อมูลใหม่', details: '0 rows' } } as any;
          }
          return ok({ id: 'contract-saved' });
        }
        return defaultResult(q);
      };

      const onClose = vi.fn();
      render(<RentalActionModal isOpen={true} contractId="contract-1" onClose={onClose} lead={{ ...lead, status: 'Rented' } as any} user={user} />);

      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());
      submit(/ยืนยันเปลี่ยนเป็นซื้อแปลงนี้/);

      await waitFor(() => expect(screen.getByText(/ไม่พบรายการที่แก้ไขได้/i)).toBeInTheDocument());
      expect(onClose).not.toHaveBeenCalled();
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

    it('F1.6: lead update status guard detects concurrent change when allowedStatuses is provided', async () => {
      let leadRow = { ...lead, id: 'lead-1', status: 'Rented', notes: 'Initial note' };
      resolveQuery = q => {
        if (q.table === 'plots' && q.action === 'read') {
          return ok({ id: 'plot-1', sale_status: 'Rented', has_customer: true, current_tenant_name: 'Somchai Jaidee' });
        }
        if (q.table === 'rental_contracts' && q.action === 'read') return ok(q.single ? contract : [contract]);
        if (q.table === 'leads' && q.action === 'read') {
          const snap = { ...leadRow };
          leadRow.status = 'Lost';
          return ok(q.single ? snap : [snap]);
        }
        if (q.table === 'leads' && q.action === 'update') return matchUpdate(leadRow, q);
        return defaultResult(q);
      };

      const onClose = vi.fn();
      render(<RentalActionModal isOpen={true} contractId="contract-1" onClose={onClose} lead={{ ...lead, status: 'Rented' } as any} user={user} />);

      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());
      fireEvent.click(screen.getByRole('button', { name: /3. สิ้นสุดสัญญา/ }));
      submit(/ยืนยันการย้ายออก/);

      await waitFor(() => expect(screen.getByText(/สถานะของลูกค้าถูกยกเลิกแล้ว ไม่สามารถดำเนินการได้/i)).toBeInTheDocument());
      expect(onClose).not.toHaveBeenCalled();
      expect(leadRow.status).toBe('Lost');
    });

    it('F1.7: move-out aborts cleanly if lead was concurrently cancelled in DB', async () => {
      resolveQuery = q => {
        if (q.table === 'plots' && q.action === 'read') {
          return ok({ id: 'plot-1', sale_status: 'Rented', has_customer: true, current_tenant_name: 'Somchai Jaidee' });
        }
        if (q.table === 'rental_contracts' && q.action === 'read') return ok(q.single ? contract : [contract]);
        if (q.table === 'leads' && q.action === 'read') return ok(q.single ? { ...lead, status: 'Cancelled' } : [{ ...lead, status: 'Cancelled' }]);
        return defaultResult(q);
      };

      const onClose = vi.fn();
      render(<RentalActionModal isOpen={true} contractId="contract-1" onClose={onClose} lead={{ ...lead, status: 'Rented' } as any} user={user} />);

      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());
      fireEvent.click(screen.getByRole('button', { name: /3. สิ้นสุดสัญญา/ }));
      submit(/ยืนยันการย้ายออก/);

      await waitFor(() => expect(screen.getByText(/สถานะของลูกค้าถูกยกเลิกแล้ว ไม่สามารถดำเนินการได้/i)).toBeInTheDocument());
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
  describe('Finding 2 Verification: Old Contract Actions Segregation & Plot Protection', () => {
    it('F2.1: move-out of old contract deletes all lifecycle fields and preserves new active contract on lead', async () => {
      let leadUpdatePayload: Record<string, unknown> | null = null;
      resolveQuery = q => {
        if (q.table === 'plots' && q.action === 'read') {
          return ok({ id: 'plot-1', sale_status: 'Rented', has_customer: true, current_tenant_name: 'Somchai Jaidee' });
        }
        if (q.table === 'rental_contracts' && q.action === 'read') {
          if (q.filters.some(([k, v]) => k === 'neq:id' && v === 'contract-1')) {
            return ok([{ id: 'contract-2-active', status: 'Active', plot_id: 'plot-1', tenant_name: 'Somchai Jaidee' }]);
          }
          return ok(q.single ? contract : [contract]);
        }
        if (q.table === 'leads' && q.action === 'read') {
          return ok(q.single ? { ...lead, status: 'Rented', rental_status: 'Renewed', active_rental_contract_id: 'contract-2-active' } : [{ ...lead, status: 'Rented', rental_status: 'Renewed', active_rental_contract_id: 'contract-2-active' }]);
        }
        if (q.table === 'leads' && q.action === 'update') {
          leadUpdatePayload = q.payload as Record<string, unknown>;
          return ok({ id: 'lead-saved' });
        }
        return defaultResult(q);
      };

      const onClose = vi.fn();
      render(<RentalActionModal isOpen={true} contractId="contract-1" onClose={onClose} lead={{ ...lead, status: 'Rented', active_rental_contract_id: 'contract-1' } as any} user={user} />);

      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());
      fireEvent.click(screen.getByRole('button', { name: /3. สิ้นสุดสัญญา/ }));
      submit(/ยืนยันการย้ายออก/);

      await waitFor(() => expect(onClose).toHaveBeenCalled());

      expect(leadUpdatePayload).not.toBeNull();
      // Lifecycle fields stripped
      expect(leadUpdatePayload).not.toHaveProperty('status');
      expect(leadUpdatePayload).not.toHaveProperty('rental_status');
      expect(leadUpdatePayload).not.toHaveProperty('crm_status');
      expect(leadUpdatePayload).not.toHaveProperty('active_rental_contract_id');
      expect(leadUpdatePayload).not.toHaveProperty('deal_type');
      expect((leadUpdatePayload as any)?.notes).toBeDefined();
      expect(String((leadUpdatePayload as any)?.notes)).toContain('ย้ายออก');
    });

    it('F2.2: lead write-time guard includes active_rental_contract_id guard catching concurrent contract reassignment', async () => {
      let leadRow = {
        id: 'lead-1',
        status: 'Rented',
        rental_status: 'Rented',
        notes: 'Initial note',
        active_rental_contract_id: 'contract-1'
      };
      let updateAttempt = 0;

      resolveQuery = q => {
        if (q.table === 'plots' && q.action === 'read') {
          return ok({ id: 'plot-1', sale_status: 'Rented', has_customer: true, current_tenant_name: 'Somchai Jaidee' });
        }
        if (q.table === 'rental_contracts' && q.action === 'read') return ok(q.single ? contract : [contract]);
        if (q.table === 'leads' && q.action === 'read') {
          const snap = { ...leadRow };
          // Simulate concurrent linkage to new contract before first update
          leadRow.active_rental_contract_id = 'contract-new-2';
          return ok(q.single ? snap : [snap]);
        }
        if (q.table === 'leads' && q.action === 'update') {
          updateAttempt++;
          return matchUpdate(leadRow, q);
        }
        return defaultResult(q);
      };

      const onClose = vi.fn();
      render(<RentalActionModal isOpen={true} contractId="contract-1" onClose={onClose} lead={{ ...lead, status: 'Rented', active_rental_contract_id: 'contract-1' } as any} user={user} />);

      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());
      fireEvent.click(screen.getByRole('button', { name: /3. สิ้นสุดสัญญา/ }));
      submit(/ยืนยันการย้ายออก/);

      await waitFor(() => expect(onClose).toHaveBeenCalled());

      // On retry after conflict, active_rental_contract_id !== contract-1 is detected,
      // so active_rental_contract_id is NOT wiped and stays contract-new-2!
      expect(leadRow.active_rental_contract_id).toBe('contract-new-2');
      expect(leadRow.notes).toContain('ย้ายออก');
    });

    it('F2.3: move-out does NOT release plot if plot has another active or renewed contract (even same tenant)', async () => {
      let plotUpdateCalled = false;
      resolveQuery = q => {
        if (q.table === 'plots' && q.action === 'read') {
          return ok({ id: 'plot-1', sale_status: 'Rented', has_customer: true, current_tenant_name: 'Somchai Jaidee' });
        }
        if (q.table === 'rental_contracts' && q.action === 'read') {
          if (q.filters.some(([k, v]) => k === 'neq:id' && v === 'contract-1')) {
            // Another active contract for same tenant
            return ok([{ id: 'contract-renewal-2', status: 'Renewed', plot_id: 'plot-1', tenant_name: 'Somchai Jaidee' }]);
          }
          return ok(q.single ? contract : [contract]);
        }
        if (q.table === 'plots' && q.action === 'update') {
          plotUpdateCalled = true;
          return ok({ id: 'plot-saved' });
        }
        return defaultResult(q);
      };

      const onClose = vi.fn();
      render(<RentalActionModal isOpen={true} contractId="contract-1" onClose={onClose} lead={{ ...lead, status: 'Rented' } as any} user={user} />);

      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());
      fireEvent.click(screen.getByRole('button', { name: /3. สิ้นสุดสัญญา/ }));
      submit(/ยืนยันการย้ายออก/);

      await waitFor(() => expect(onClose).toHaveBeenCalled());

      // Plot was NOT released to Available because another active/renewed contract exists on it
      expect(plotUpdateCalled).toBe(false);
    });

    it('F2.4: move-out does NOT release plot if plot has active contract with different tenant', async () => {
      let plotUpdateCalled = false;
      resolveQuery = q => {
        if (q.table === 'plots' && q.action === 'read') {
          return ok({ id: 'plot-1', sale_status: 'Rented', has_customer: true, current_tenant_name: 'New Tenant Bob' });
        }
        if (q.table === 'rental_contracts' && q.action === 'read') return ok(q.single ? contract : [contract]);
        if (q.table === 'plots' && q.action === 'update') {
          plotUpdateCalled = true;
          return ok({ id: 'plot-saved' });
        }
        return defaultResult(q);
      };

      const onClose = vi.fn();
      render(<RentalActionModal isOpen={true} contractId="contract-1" onClose={onClose} lead={{ ...lead, status: 'Rented' } as any} user={user} />);

      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());
      fireEvent.click(screen.getByRole('button', { name: /3. สิ้นสุดสัญญา/ }));
      submit(/ยืนยันการย้ายออก/);

      await waitFor(() => expect(onClose).toHaveBeenCalled());

      // Plot was NOT released because occupant differs
      expect(plotUpdateCalled).toBe(false);
    });

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

    it('F2.6: move-out does not release plot if plot is occupied by another customer', async () => {
      let plotUpdateCalled = false;
      resolveQuery = q => {
        if (q.table === 'plots' && q.action === 'read') {
          return ok({ id: 'plot-1', sale_status: 'Reserved', has_customer: true, customer_name: 'Buyer Bob', current_tenant_name: null });
        }
        if (q.table === 'rental_contracts' && q.action === 'read') return ok(q.single ? contract : [contract]);
        if (q.table === 'plots' && q.action === 'update') {
          plotUpdateCalled = true;
          return ok({ id: 'plot-saved' });
        }
        return defaultResult(q);
      };

      const onClose = vi.fn();
      render(<RentalActionModal isOpen={true} contractId="contract-1" onClose={onClose} lead={{ ...lead, status: 'Rented' } as any} user={user} />);

      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());
      fireEvent.click(screen.getByRole('button', { name: /3. สิ้นสุดสัญญา/ }));
      submit(/ยืนยันการย้ายออก/);

      await waitFor(() => expect(onClose).toHaveBeenCalled());

      expect(plotUpdateCalled).toBe(false);
    });
  });
  // Finding 3 Verification Suite: Authoritative Effective State & Pre-mutation Validation
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
        if (q.table === 'leads' && q.action === 'read') return ok({ ...lead, status: 'Booked', crm_stage: 'booked' });
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
        if (q.table === 'leads' && q.action === 'read') return ok({ ...lead, status: 'Contracted', crm_stage: 'contract' });
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
        if (q.table === 'leads' && q.action === 'read') return ok({ ...lead, status: 'Contracted', crm_stage: 'document_prep' });
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
        if (q.table === 'leads' && q.action === 'read') return ok({ ...lead, status: 'Contracted', crm_stage: 'document_prep' });
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
        if (q.table === 'leads' && q.action === 'read') return ok({ ...lead, status: 'Contracted', crm_stage: 'contract' });
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
        if (q.table === 'leads' && q.action === 'read') return ok({ ...lead, status: 'Booked', crm_stage: 'booked' });
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
        if (q.table === 'leads' && q.action === 'read') return ok({ ...lead, status: 'Booked', crm_stage: 'booked' });
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
    });

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

    it('A8: Convert to Buy on old contract does not wipe plot occupied by another contract', async () => {
      let plotRow = { id: 'plot-1', sale_status: 'Rented', has_customer: true, current_tenant_name: 'Active Tenant Charles', monthly_rent: 18000 };
      resolveQuery = q => {
        if (q.table === 'plots' && q.action === 'read') return ok(q.single ? plotRow : [plotRow]);
        if (q.table === 'rental_contracts' && q.action === 'read') {
          if (q.filters.some(([k, v]) => k === 'plot_id' && v === 'plot-1' && q.filters.some(([k2, v2]) => k2 === 'neq:id' && v2 === 'contract-old'))) {
            return ok([{ ...contract, id: 'contract-active', lead_id: 'lead-2', status: 'Active', tenant_name: 'Active Tenant Charles' }]);
          }
          return ok(q.single ? { ...contract, id: 'contract-old', lead_id: 'lead-1', tenant_name: 'Old Tenant' } : [{ ...contract, id: 'contract-old', lead_id: 'lead-1', tenant_name: 'Old Tenant' }]);
        }
        if (q.table === 'plots' && q.action === 'update') {
          Object.assign(plotRow, q.payload);
          return ok({ id: plotRow.id });
        }
        return defaultResult(q);
      };

      const onClose = vi.fn();
      render(<RentalActionModal isOpen={true} contractId="contract-old" onClose={onClose} lead={{ ...lead, status: 'Rented' } as any} user={user} />);

      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());
      submit(/ยืนยันเปลี่ยนเป็นซื้อแปลงนี้/);

      await waitFor(() => expect(screen.getByText(/แปลงนี้มีผู้เช่าอื่นถือสิทธิ์อยู่/i)).toBeInTheDocument());

      // Plot was NOT wiped or set to Reserved!
      expect(plotRow.current_tenant_name).toBe('Active Tenant Charles');
      expect(plotRow.sale_status).toBe('Rented');
      expect(writes('plots').length).toBe(0);
    });
  });
  // Finding B Verification: Null and Linkage Guard on Lead Concurrency (B1-B7)
  describe('Finding B Verification: Null and Linkage Guard on Lead Concurrency', () => {
    it('B1: null active_rental_contract_id on lead must not wipe new contract when linked concurrently before write', async () => {
      let leadRow = { ...lead, id: 'lead-1', status: 'Active', notes: 'Initial notes', active_rental_contract_id: null as string | null };
      let contractRow = { ...contract, id: 'contract-1', status: 'Active', notes: 'Contract notes' };
      let submitStarted = false;

      resolveQuery = q => {
        if (q.table === 'plots') return ok({ id: 'plot-1', sale_status: 'Available', has_customer: false, current_tenant_name: null });
        if (q.table === 'rental_contracts') return ok(q.single ? contractRow : [contractRow]);
        if (q.table === 'leads' && q.action === 'read') {
          const snap = { ...leadRow };
          if (submitStarted) leadRow.active_rental_contract_id = 'contract-new-789';
          return ok(q.single ? snap : [snap]);
        }
        if (q.table === 'leads' && q.action === 'update') {
          let matches = true;
          for (const [col, val] of q.filters) {
            if (col === 'active_rental_contract_id') {
              if (leadRow.active_rental_contract_id !== val) matches = false;
            } else if (col === 'notes') {
              if (leadRow.notes !== val) matches = false;
            } else if (col === 'status') {
              if (leadRow.status !== val) matches = false;
            }
          }
          if (!matches) return { data: null, error: { code: 'PGRST116', details: 'The result contains 0 rows' } } as any;
          Object.assign(leadRow, q.payload);
          return ok({ id: leadRow.id });
        }
        return defaultResult(q);
      };

      render(<RentalActionModal isOpen={true} contractId="contract-1" onClose={vi.fn()} lead={{ ...lead, status: 'Active', active_rental_contract_id: null } as any} user={user} />);

      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());
      fireEvent.click(screen.getByRole('button', { name: /3\. สิ้นสุดสัญญา/ }));
      await waitFor(() => expect(screen.getByRole('button', { name: /ยืนยัน.*ย้ายออก/ })).toBeInTheDocument());

      submitStarted = true;
      submit(/ยืนยัน.*ย้ายออก/);

      await waitFor(() => expect(screen.queryByText(/กำลังบันทึกข้อมูล/i)).not.toBeInTheDocument());

      // Concurrent new contract MUST NOT be wiped to null!
      expect(leadRow.active_rental_contract_id).toBe('contract-new-789');
    });

    it('B2: changing linkage from C-old to C-new between read and write preserves C-new', async () => {
      let leadRow = { ...lead, id: 'lead-1', status: 'Rented', notes: 'Initial notes', active_rental_contract_id: 'contract-1' };
      let submitStarted = false;

      resolveQuery = q => {
        if (q.table === 'plots') return ok({ id: 'plot-1', sale_status: 'Available', has_customer: false, current_tenant_name: null });
        if (q.table === 'rental_contracts') return ok(q.single ? contract : [contract]);
        if (q.table === 'leads' && q.action === 'read') {
          const snap = { ...leadRow };
          if (submitStarted) leadRow.active_rental_contract_id = 'contract-brand-new';
          return ok(q.single ? snap : [snap]);
        }
        if (q.table === 'leads' && q.action === 'update') {
          let matches = true;
          for (const [col, val] of q.filters) {
            if (col === 'active_rental_contract_id' && leadRow.active_rental_contract_id !== val) matches = false;
          }
          if (!matches) return { data: null, error: { code: 'PGRST116', details: '0 rows' } } as any;
          Object.assign(leadRow, q.payload);
          return ok({ id: leadRow.id });
        }
        return defaultResult(q);
      };

      render(<RentalActionModal isOpen={true} contractId="contract-1" onClose={vi.fn()} lead={{ ...lead, status: 'Rented', active_rental_contract_id: 'contract-1' } as any} user={user} />);

      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());
      fireEvent.click(screen.getByRole('button', { name: /3\. สิ้นสุดสัญญา/ }));
      await waitFor(() => expect(screen.getByRole('button', { name: /ยืนยัน.*ย้ายออก/ })).toBeInTheDocument());

      submitStarted = true;
      submit(/ยืนยัน.*ย้ายออก/);

      await waitFor(() => expect(screen.queryByText(/กำลังบันทึกข้อมูล/i)).not.toBeInTheDocument());
      expect(leadRow.active_rental_contract_id).toBe('contract-brand-new');
    });

    it('B3: null linkage remaining unchanged completes move out without false conflict', async () => {
      let leadRow = { ...lead, id: 'lead-1', status: 'Active', notes: 'Notes', active_rental_contract_id: null };
      resolveQuery = q => {
        if (q.table === 'plots') return ok({ id: 'plot-1', sale_status: 'Available', has_customer: false, current_tenant_name: null });
        if (q.table === 'rental_contracts') return ok(q.single ? contract : [contract]);
        if (q.table === 'leads' && q.action === 'read') return ok(q.single ? leadRow : [leadRow]);
        if (q.table === 'leads' && q.action === 'update') {
          let matches = true;
          for (const [col, val] of q.filters) {
            if (col === 'active_rental_contract_id' && leadRow.active_rental_contract_id !== val) matches = false;
          }
          if (!matches) return { data: null, error: { code: 'PGRST116', details: '0 rows' } } as any;
          Object.assign(leadRow, q.payload);
          return ok({ id: leadRow.id });
        }
        return defaultResult(q);
      };

      const onClose = vi.fn();
      render(<RentalActionModal isOpen={true} contractId="contract-1" onClose={onClose} lead={{ ...lead, status: 'Active', active_rental_contract_id: null } as any} user={user} />);

      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());
      fireEvent.click(screen.getByRole('button', { name: /3\. สิ้นสุดสัญญา/ }));
      await waitFor(() => expect(screen.getByRole('button', { name: /ยืนยัน.*ย้ายออก/ })).toBeInTheDocument());
      submit(/ยืนยัน.*ย้ายออก/);

      await waitFor(() => expect(onClose).toHaveBeenCalled());
      expect(leadRow.status).toBe('MovedOut');
    });

    it('B4: active_rental_contract_id missing from response is not treated as evidence of having no contract to wipe linkage', async () => {
      let updatedPayload: any = null;
      resolveQuery = q => {
        if (q.table === 'plots') return ok({ id: 'plot-1', sale_status: 'Available', has_customer: false, current_tenant_name: null });
        if (q.table === 'rental_contracts') return ok(q.single ? contract : [contract]);
        if (q.table === 'leads' && q.action === 'read') {
          // Missing active_rental_contract_id key
          return ok({ id: 'lead-1', status: 'Active', notes: 'Notes' });
        }
        if (q.table === 'leads' && q.action === 'update') {
          updatedPayload = q.payload;
          return ok({ id: 'lead-1' });
        }
        return defaultResult(q);
      };

      const onClose = vi.fn();
      render(<RentalActionModal isOpen={true} contractId="contract-1" onClose={onClose} lead={lead as any} user={user} />);

      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());
      fireEvent.click(screen.getByRole('button', { name: /3\. สิ้นสุดสัญญา/ }));
      await waitFor(() => expect(screen.getByRole('button', { name: /ยืนยัน.*ย้ายออก/ })).toBeInTheDocument());
      submit(/ยืนยัน.*ย้ายออก/);

      await waitFor(() => expect(onClose).toHaveBeenCalled());

      // active_rental_contract_id MUST NOT be wiped because missing column is not evidence of having no contract!
      expect(updatedPayload).not.toHaveProperty('active_rental_contract_id');
    });

    it('B5: changing linkage during Notes retry strips lifecycle fields', async () => {
      let leadRow = { ...lead, id: 'lead-1', status: 'Active', notes: 'Note A', active_rental_contract_id: 'contract-1' };
      let attempt = 0;

      resolveQuery = q => {
        if (q.table === 'plots') return ok({ id: 'plot-1', sale_status: 'Available', has_customer: false, current_tenant_name: null });
        if (q.table === 'rental_contracts') return ok(q.single ? contract : [contract]);
        if (q.table === 'leads' && q.action === 'read') {
          attempt++;
          if (attempt === 1) return ok({ ...leadRow });
          // Concurrent reassignment in conflict read
          leadRow.notes = 'Note B';
          leadRow.active_rental_contract_id = 'contract-new-owner';
          return ok(q.single ? { ...leadRow } : [{ ...leadRow }]);
        }
        if (q.table === 'leads' && q.action === 'update') {
          if (attempt === 1) {
            // First update triggers optimistic lock conflict
            return { data: null, error: { code: 'PGRST116', details: '0 rows' } } as any;
          }
          Object.assign(leadRow, q.payload);
          return ok({ id: leadRow.id });
        }
        return defaultResult(q);
      };

      const onClose = vi.fn();
      render(<RentalActionModal isOpen={true} contractId="contract-1" onClose={onClose} lead={leadRow as any} user={user} />);

      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());
      fireEvent.click(screen.getByRole('button', { name: /3\. สิ้นสุดสัญญา/ }));
      await waitFor(() => expect(screen.getByRole('button', { name: /ยืนยัน.*ย้ายออก/ })).toBeInTheDocument());
      submit(/ยืนยัน.*ย้ายออก/);

      await waitFor(() => expect(onClose).toHaveBeenCalled());

      // Lifecycle status was NOT corrupted, linkage remains contract-new-owner
      expect(leadRow.active_rental_contract_id).toBe('contract-new-owner');
      expect(leadRow.notes).toContain('Note B');
      expect(leadRow.notes).toContain('สิ้นสุดสัญญาเช่า ย้ายออก');
    });

    it('B6: simultaneous linkage and notes change merges notes without leaking old lifecycle payload', async () => {
      let leadRow = { ...lead, id: 'lead-1', status: 'Active', rental_status: 'Active', notes: 'Note 1', active_rental_contract_id: null as string | null };
      let attempt = 0;

      resolveQuery = q => {
        if (q.table === 'plots') return ok({ id: 'plot-1', sale_status: 'Available', has_customer: false, current_tenant_name: null });
        if (q.table === 'rental_contracts') return ok(q.single ? contract : [contract]);
        if (q.table === 'leads' && q.action === 'read') {
          attempt++;
          if (attempt === 1) return ok({ ...leadRow });
          leadRow.notes = 'Note 2 by agent';
          leadRow.active_rental_contract_id = 'contract-active-now';
          return ok(q.single ? { ...leadRow } : [{ ...leadRow }]);
        }
        if (q.table === 'leads' && q.action === 'update') {
          if (attempt === 1) return { data: null, error: { code: 'PGRST116', details: '0 rows' } } as any;
          Object.assign(leadRow, q.payload);
          return ok({ id: leadRow.id });
        }
        return defaultResult(q);
      };

      const onClose = vi.fn();
      render(<RentalActionModal isOpen={true} contractId="contract-1" onClose={onClose} lead={leadRow as any} user={user} />);

      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());
      fireEvent.click(screen.getByRole('button', { name: /3\. สิ้นสุดสัญญา/ }));
      await waitFor(() => expect(screen.getByRole('button', { name: /ยืนยัน.*ย้ายออก/ })).toBeInTheDocument());
      submit(/ยืนยัน.*ย้ายออก/);

      await waitFor(() => expect(onClose).toHaveBeenCalled());

      expect(leadRow.active_rental_contract_id).toBe('contract-active-now');
      expect(leadRow.rental_status).toBe('Active');
      expect(leadRow.notes).toContain('Note 2 by agent');
    });

    it('B7: normal operation with matching active contract does not produce false conflict', async () => {
      let leadRow = { ...lead, id: 'lead-1', status: 'Rented', notes: 'Clean notes', active_rental_contract_id: 'contract-1' };
      resolveQuery = q => {
        if (q.table === 'plots') return ok({ id: 'plot-1', sale_status: 'Available', has_customer: false, current_tenant_name: null });
        if (q.table === 'rental_contracts') return ok(q.single ? contract : [contract]);
        if (q.table === 'leads' && q.action === 'read') return ok(q.single ? leadRow : [leadRow]);
        if (q.table === 'leads' && q.action === 'update') {
          let matches = true;
          for (const [col, val] of q.filters) {
            if (col === 'active_rental_contract_id' && leadRow.active_rental_contract_id !== val) matches = false;
          }
          if (!matches) throw new Error('Unmatched filter!');
          Object.assign(leadRow, q.payload);
          return ok({ id: leadRow.id });
        }
        return defaultResult(q);
      };

      const onClose = vi.fn();
      render(<RentalActionModal isOpen={true} contractId="contract-1" onClose={onClose} lead={leadRow as any} user={user} />);

      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());
      fireEvent.click(screen.getByRole('button', { name: /3\. สิ้นสุดสัญญา/ }));
      await waitFor(() => expect(screen.getByRole('button', { name: /ยืนยัน.*ย้ายออก/ })).toBeInTheDocument());
      submit(/ยืนยัน.*ย้ายออก/);

      await waitFor(() => expect(onClose).toHaveBeenCalled());
      expect(leadRow.status).toBe('MovedOut');
      expect(leadRow.active_rental_contract_id).toBeNull();
    });
  });
  // Finding C Verification: Partial Save Recovery without Lost State (C1-C9)
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

  // Latest Audit Regression Suite: Findings A (P1), B (P1), and C (P2)
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

    it('Finding A: convert-to-buy detects concurrent plot change between read and write (zero-row data:null/count:null/error:null) and does not update lead or insert sales', async () => {
      let plotRow = { id: 'plot-1', sale_status: 'Rented', has_customer: true, current_tenant_name: 'Somchai Jaidee', customer_name: 'Somchai Jaidee', lease_end_date: '2027-01-01' };
      let contractRow = { ...contract, id: 'contract-1', status: 'Active', notes: 'Init note', lease_end_date: '2027-01-01' };
      let leadRow = { ...lead, id: 'lead-1', status: 'Rented', rental_status: 'Active', active_rental_contract_id: 'contract-1', notes: 'Lead note' };
      let salesRows: any[] = [];
      let plotReads = 0;

      resolveQuery = q => {
        if (q.table === 'plots' && q.action === 'read') {
          plotReads++;
          const snap = { ...plotRow };
          if (plotReads >= 2) {
            // Concurrent plot status / lease_end_date change right after Step 2 plot read, before Step 2 plot update!
            plotRow.sale_status = 'Transferred';
            plotRow.lease_end_date = '2029-01-01';
          }
          return ok(q.single ? snap : [snap]);
        }
        if (q.table === 'plots' && q.action === 'update') {
          let matches = true;
          for (const [col, val] of q.filters) {
            if ((plotRow as any)[col] !== val) matches = false;
          }
          if (!matches) return { data: null, count: null, error: null } as any;
          Object.assign(plotRow, q.payload);
          return ok({ id: plotRow.id });
        }
        if (q.table === 'rental_contracts' && q.action === 'read') {
          if (q.filters.some(([k, v]) => k === 'neq:id' && v === 'contract-1')) return ok([]);
          return ok(q.single ? { ...contractRow } : [{ ...contractRow }]);
        }
        if (q.table === 'rental_contracts' && q.action === 'update') {
          Object.assign(contractRow, q.payload);
          return ok({ id: contractRow.id });
        }
        if (q.table === 'leads' && q.action === 'read') return ok(q.single ? { ...leadRow } : [{ ...leadRow }]);
        if (q.table === 'leads' && q.action === 'update') {
          Object.assign(leadRow, q.payload);
          return ok({ id: leadRow.id });
        }
        if (q.table === 'sales' && q.action === 'read') return ok(salesRows);
        if (q.table === 'sales' && q.action === 'insert') {
          salesRows.push(...(q.payload as any[]));
          return ok({ id: 'sale-new' });
        }
        return defaultResult(q);
      };

      const onSaved = vi.fn();
      const onClose = vi.fn();
      render(<RentalActionModal isOpen={true} contractId="contract-1" onClose={onClose} onSaved={onSaved} lead={leadRow as any} user={user} />);
      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());

      submit(/ยืนยันเปลี่ยนเป็นซื้อแปลงนี้/);

      await waitFor(() => expect(screen.getByText(/บันทึกบางส่วนแล้ว แต่ยังไม่ครบ.*ไม่สามารถอัปเดตแปลงได้/i)).toBeInTheDocument());
      expect(plotRow.sale_status).toBe('Transferred');
      expect(leadRow.status).toBe('Rented');
      expect(salesRows).toHaveLength(0);
      expect(onSaved).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    });

    it('Finding B (Preflight): old contract C-old with same tenant name cannot convert to buy when C-new is Active and linked on Lead', async () => {
      const cOld = { ...contract, id: 'contract-old', plot_id: 'plot-1', lead_id: 'lead-1', tenant_name: 'Somchai Jaidee', status: 'Active', notes: 'Old contract' };
      const cNew = { ...contract, id: 'contract-new', plot_id: 'plot-1', lead_id: 'lead-1', tenant_name: 'Somchai Jaidee', status: 'Active', notes: 'New contract' };
      const plotRow = { id: 'plot-1', sale_status: 'Rented', has_customer: true, current_tenant_name: 'Somchai Jaidee', customer_name: 'Somchai Jaidee' };
      const leadRow = { ...lead, id: 'lead-1', customer_name: 'Somchai Jaidee', status: 'Rented', rental_status: 'Active', active_rental_contract_id: 'contract-new', notes: 'Lead notes' };
      const salesRows: any[] = [];

      resolveQuery = q => {
        if (q.table === 'rental_contracts' && q.action === 'read') {
          if (q.filters.some(([k, v]) => k === 'neq:id' && v === 'contract-old')) return ok([{ ...cNew }]);
          return ok(q.single ? { ...cOld } : [{ ...cOld }]);
        }
        if (q.table === 'rental_contracts' && q.action === 'update') {
          Object.assign(cOld, q.payload);
          return ok({ id: cOld.id });
        }
        if (q.table === 'plots' && q.action === 'read') return ok(q.single ? { ...plotRow } : [{ ...plotRow }]);
        if (q.table === 'plots' && q.action === 'update') {
          Object.assign(plotRow, q.payload);
          return ok({ id: plotRow.id });
        }
        if (q.table === 'leads' && q.action === 'read') return ok(q.single ? { ...leadRow } : [{ ...leadRow }]);
        if (q.table === 'leads' && q.action === 'update') {
          Object.assign(leadRow, q.payload);
          return ok({ id: leadRow.id });
        }
        if (q.table === 'sales' && q.action === 'read') return ok(salesRows);
        if (q.table === 'sales' && q.action === 'insert') {
          salesRows.push(...(q.payload as any[]));
          return ok({ id: 'sale-new' });
        }
        return defaultResult(q);
      };

      const onSaved = vi.fn();
      const onClose = vi.fn();
      const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});

      render(<RentalActionModal isOpen={true} contractId="contract-old" onClose={onClose} onSaved={onSaved} lead={leadRow as any} user={user} />);
      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());

      submit(/ยืนยันเปลี่ยนเป็นซื้อแปลงนี้/);

      await waitFor(() => expect(screen.getByText(/ไม่ใช่สัญญาเช่าปัจจุบัน|มีสัญญาเช่าอื่น/i)).toBeInTheDocument());

      // ZERO mutations across all tables!
      expect(cOld.status).toBe('Active');
      expect(cNew.status).toBe('Active');
      expect(plotRow.sale_status).toBe('Rented');
      expect(leadRow.status).toBe('Rented');
      expect(leadRow.active_rental_contract_id).toBe('contract-new');
      expect(salesRows).toHaveLength(0);
      expect(writes()).toHaveLength(0);
      expect(onSaved).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
      expect(alertSpy).not.toHaveBeenCalled();
    });

    it('Finding B (Mid-flight authority change): if C-new becomes Active on plot after preflight before plot step, convert-to-buy aborts at plot step and does NOT create sales row', async () => {
      const cOld = { ...contract, id: 'contract-old', plot_id: 'plot-1', lead_id: 'lead-1', tenant_name: 'Somchai Jaidee', status: 'Active', notes: 'Old contract' };
      const cNew = { ...contract, id: 'contract-new', plot_id: 'plot-1', lead_id: 'lead-1', tenant_name: 'Somchai Jaidee', status: 'Active', notes: 'New contract' };
      const plotRow = { id: 'plot-1', sale_status: 'Rented', has_customer: true, current_tenant_name: 'Somchai Jaidee', customer_name: 'Somchai Jaidee' };
      const leadRow = { ...lead, id: 'lead-1', customer_name: 'Somchai Jaidee', status: 'Rented', rental_status: 'Active', active_rental_contract_id: 'contract-old', notes: 'Lead notes' };
      const salesRows: any[] = [];
      let step1ContractUpdated = false;

      resolveQuery = q => {
        if (q.table === 'rental_contracts' && q.action === 'read') {
          if (q.filters.some(([k, v]) => k === 'neq:id' && v === 'contract-old')) {
            // C-new appears ONLY after Step 1 contract update has occurred!
            return ok(step1ContractUpdated ? [{ ...cNew }] : []);
          }
          return ok(q.single ? { ...cOld } : [{ ...cOld }]);
        }
        if (q.table === 'rental_contracts' && q.action === 'update') {
          step1ContractUpdated = true;
          Object.assign(cOld, q.payload);
          leadRow.active_rental_contract_id = 'contract-new';
          return ok({ id: cOld.id });
        }
        if (q.table === 'plots' && q.action === 'read') return ok(q.single ? { ...plotRow } : [{ ...plotRow }]);
        if (q.table === 'plots' && q.action === 'update') {
          Object.assign(plotRow, q.payload);
          return ok({ id: plotRow.id });
        }
        if (q.table === 'leads' && q.action === 'read') return ok(q.single ? { ...leadRow } : [{ ...leadRow }]);
        if (q.table === 'leads' && q.action === 'update') {
          Object.assign(leadRow, q.payload);
          return ok({ id: leadRow.id });
        }
        if (q.table === 'sales' && q.action === 'read') return ok(salesRows);
        if (q.table === 'sales' && q.action === 'insert') {
          salesRows.push(...(q.payload as any[]));
          return ok({ id: 'sale-new' });
        }
        return defaultResult(q);
      };

      const onSaved = vi.fn();
      const onClose = vi.fn();
      render(<RentalActionModal isOpen={true} contractId="contract-old" onClose={onClose} onSaved={onSaved} lead={leadRow as any} user={user} />);
      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());

      submit(/ยืนยันเปลี่ยนเป็นซื้อแปลงนี้/);

      await waitFor(() => expect(screen.getByText(/บันทึกบางส่วนแล้ว แต่ยังไม่ครบ/i)).toBeInTheDocument());
      expect(plotRow.sale_status).toBe('Rented');
      expect(leadRow.status).toBe('Rented');
      expect(leadRow.active_rental_contract_id).toBe('contract-new');
      expect(salesRows).toHaveLength(0);
      expect(writes('sales')).toHaveLength(0);
      expect(onSaved).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    });

    it('Finding C: convert-to-buy reads latest contract notes and uses optimistic lock merge instead of overwriting concurrent Note B with stale c.notes', async () => {
      const contractRow = { ...contract, id: 'contract-1', plot_id: 'plot-1', lead_id: 'lead-1', status: 'Active', notes: 'Note A' };
      const plotRow = { id: 'plot-1', sale_status: 'Rented', has_customer: true, current_tenant_name: 'Somchai Jaidee', customer_name: 'Somchai Jaidee', lease_end_date: '2027-01-01' };
      const leadRow = { ...lead, id: 'lead-1', status: 'Rented', rental_status: 'Active', active_rental_contract_id: 'contract-1', notes: 'Lead Note 1' };
      let contractReadInConvert = 0;

      resolveQuery = q => {
        if (q.table === 'rental_contracts' && q.action === 'read') {
          if (q.filters.some(([k, v]) => k === 'neq:id' && v === 'contract-1')) return ok([]);
          const snap = { ...contractRow };
          if (contractRow.notes.includes('Note B')) {
            contractReadInConvert++;
            if (contractReadInConvert === 1) {
              // Concurrent Note C added right after fresh read, before conditional write!
              contractRow.notes = 'Note A\nNote B\nNote C';
            }
          }
          return ok(q.single ? snap : [snap]);
        }
        if (q.table === 'rental_contracts' && q.action === 'update') {
          return matchUpdate(contractRow, q);
        }
        if (q.table === 'plots' && q.action === 'read') return ok(q.single ? { ...plotRow } : [{ ...plotRow }]);
        if (q.table === 'plots' && q.action === 'update') return matchUpdate(plotRow, q);
        if (q.table === 'leads' && q.action === 'read') return ok(q.single ? { ...leadRow } : [{ ...leadRow }]);
        if (q.table === 'leads' && q.action === 'update') return matchUpdate(leadRow, q);
        if (q.table === 'sales' && q.action === 'read') return ok([]);
        if (q.table === 'sales' && q.action === 'insert') return ok({ id: 'sale-1' });
        return defaultResult(q);
      };

      const onSaved = vi.fn();
      const onClose = vi.fn();
      render(<RentalActionModal isOpen={true} contractId="contract-1" onClose={onClose} onSaved={onSaved} lead={leadRow as any} user={user} />);
      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());

      // Another user adds Note B after modal opened, before user clicks Convert to Buy
      contractRow.notes = 'Note A\nNote B';

      submit(/ยืนยันเปลี่ยนเป็นซื้อแปลงนี้/);

      await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
      expect(onSaved).toHaveBeenCalledOnce();
      expect(contractRow.status).toBe('ConvertedToBuy');
      expect(contractRow.notes).toContain('Note A');
      expect(contractRow.notes).toContain('Note B');
      expect(contractRow.notes).toContain('Note C');
      const logMatches = contractRow.notes.match(/เปลี่ยนจากเช่าเป็นซื้อเมื่อ/g) || [];
      expect(logMatches).toHaveLength(1);
    });

    it('Finding A (Move-out & Retry): move-out handles data:null/count:null/error:null on plot update, and renew retry after plot zero-row does not double-extend contract', async () => {
      let plotRow = { id: 'plot-1', sale_status: 'Rented', has_customer: true, current_tenant_name: 'Somchai Jaidee', customer_name: 'Somchai Jaidee', lease_end_date: '2027-01-01', monthly_rent: 15000 };
      let contractRow = { ...contract, id: 'contract-1', status: 'Active', lease_duration_months: 12, lease_end_date: '2027-01-01', monthly_rent: 15000, notes: 'Init' };
      let leadRow = { ...lead, id: 'lead-1', status: 'Rented', rental_status: 'Active', active_rental_contract_id: 'contract-1', rental_end_date: '2027-01-01', notes: 'Lead init' };
      let failPlotUpdateOnce = true;

      resolveQuery = q => {
        if (q.table === 'plots' && q.action === 'read') return ok(q.single ? { ...plotRow } : [{ ...plotRow }]);
        if (q.table === 'plots' && q.action === 'update') {
          if (failPlotUpdateOnce) {
            failPlotUpdateOnce = false;
            return { data: null, count: null, error: null } as any;
          }
          Object.assign(plotRow, q.payload);
          return ok({ id: plotRow.id });
        }
        if (q.table === 'rental_contracts' && q.action === 'read') {
          if (q.filters.some(([k, v]) => k === 'neq:id' && v === 'contract-1')) return ok([]);
          return ok(q.single ? { ...contractRow } : [{ ...contractRow }]);
        }
        if (q.table === 'rental_contracts' && q.action === 'update') {
          Object.assign(contractRow, q.payload);
          return ok({ id: contractRow.id });
        }
        if (q.table === 'leads' && q.action === 'read') return ok(q.single ? { ...leadRow } : [{ ...leadRow }]);
        if (q.table === 'leads' && q.action === 'update') {
          Object.assign(leadRow, q.payload);
          return ok({ id: leadRow.id });
        }
        return defaultResult(q);
      };

      const onSaved = vi.fn();
      const onClose = vi.fn();
      render(<RentalActionModal isOpen={true} contractId="contract-1" onClose={onClose} onSaved={onSaved} lead={leadRow as any} user={user} />);
      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());

      fireEvent.click(screen.getByRole('button', { name: /2. ต่อสัญญาเช่า/ }));
      submit(/ยืนยันต่อสัญญาเช่า/);

      // Attempt 1 fails on plot update with { data: null, count: null, error: null }
      await waitFor(() => expect(screen.getByText(/บันทึกบางส่วนแล้ว แต่ยังไม่ครบ.*ไม่สามารถอัปเดตแปลงได้/i)).toBeInTheDocument());
      expect(contractRow.lease_duration_months).toBe(24);
      expect(contractRow.lease_end_date).toBe('2028-01-01');
      expect(leadRow.rental_end_date).toBe('2027-01-01');
      expect(onSaved).not.toHaveBeenCalled();

      // Attempt 2 (Retry): resumes from Step 2 (plot) without re-running Step 1 (contract)
      submit(/ยืนยันต่อสัญญาเช่า/);
      await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
      expect(onSaved).toHaveBeenCalledOnce();
      expect(contractRow.lease_duration_months).toBe(24); // NOT 36!
      expect(plotRow.lease_end_date).toBe('2028-01-01');
      expect(leadRow.rental_end_date).toBe('2028-01-01');
      const renewLogs = (contractRow.notes.match(/\[ต่อสัญญาเช่า \+12 เดือน\]/g) || []);
      expect(renewLogs).toHaveLength(1);
    });

    it('Finding B (Authority lost before retry after partial save): if C-new takes over plot/lead after Step 1 succeeded and Step 2 failed, clicking Retry on C-old is blocked and creates no sales', async () => {
      const cOld = { ...contract, id: 'contract-old', plot_id: 'plot-1', lead_id: 'lead-1', tenant_name: 'Somchai Jaidee', status: 'Active', notes: 'Old contract' };
      const cNew = { ...contract, id: 'contract-new', plot_id: 'plot-1', lead_id: 'lead-1', tenant_name: 'Somchai Jaidee', status: 'Active', notes: 'New contract' };
      const plotRow = { id: 'plot-1', sale_status: 'Rented', has_customer: true, current_tenant_name: 'Somchai Jaidee', customer_name: 'Somchai Jaidee', lease_end_date: '2027-01-01' };
      const leadRow = { ...lead, id: 'lead-1', customer_name: 'Somchai Jaidee', status: 'Rented', rental_status: 'Active', active_rental_contract_id: 'contract-old', notes: 'Lead notes' };
      const salesRows: any[] = [];
      let cNewActive = false;
      let failPlotOnce = true;

      resolveQuery = q => {
        if (q.table === 'rental_contracts' && q.action === 'read') {
          if (q.filters.some(([k, v]) => k === 'neq:id' && v === 'contract-old')) {
            return ok(cNewActive ? [{ ...cNew }] : []);
          }
          return ok(q.single ? { ...cOld } : [{ ...cOld }]);
        }
        if (q.table === 'rental_contracts' && q.action === 'update') {
          Object.assign(cOld, q.payload);
          return ok({ id: cOld.id });
        }
        if (q.table === 'plots' && q.action === 'read') return ok(q.single ? { ...plotRow } : [{ ...plotRow }]);
        if (q.table === 'plots' && q.action === 'update') {
          if (failPlotOnce) {
            failPlotOnce = false;
            return { data: null, count: null, error: null } as any;
          }
          Object.assign(plotRow, q.payload);
          return ok({ id: plotRow.id });
        }
        if (q.table === 'leads' && q.action === 'read') return ok(q.single ? { ...leadRow } : [{ ...leadRow }]);
        if (q.table === 'leads' && q.action === 'update') {
          Object.assign(leadRow, q.payload);
          return ok({ id: leadRow.id });
        }
        if (q.table === 'sales' && q.action === 'read') return ok(salesRows);
        if (q.table === 'sales' && q.action === 'insert') {
          salesRows.push(...(q.payload as any[]));
          return ok({ id: 'sale-new' });
        }
        return defaultResult(q);
      };

      const onSaved = vi.fn();
      const onClose = vi.fn();
      render(<RentalActionModal isOpen={true} contractId="contract-old" onClose={onClose} onSaved={onSaved} lead={leadRow as any} user={user} />);
      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());

      // Attempt 1: Step 1 (contract) succeeds, Step 2 (plot) fails with 0 rows
      submit(/ยืนยันเปลี่ยนเป็นซื้อแปลงนี้/);
      await waitFor(() => expect(screen.getByText(/บันทึกบางส่วนแล้ว แต่ยังไม่ครบ/i)).toBeInTheDocument());
      expect(cOld.status).toBe('ConvertedToBuy');
      expect(salesRows).toHaveLength(0);

      // Before user clicks Retry, C-new becomes Active on the plot and linked on Lead
      cNewActive = true;
      leadRow.active_rental_contract_id = 'contract-new';

      // Attempt 2 (Retry): must detect authority was lost to C-new and abort without updating plot/lead or creating sales
      submit(/ยืนยันเปลี่ยนเป็นซื้อแปลงนี้/);
      await waitFor(() => expect(screen.getByText(/ไม่ใช่สัญญาเช่าปัจจุบัน|มีสัญญาเช่าอื่น/i)).toBeInTheDocument());
      expect(plotRow.sale_status).toBe('Rented');
      expect(leadRow.status).toBe('Rented');
      expect(leadRow.active_rental_contract_id).toBe('contract-new');
      expect(salesRows).toHaveLength(0);
      expect(onSaved).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    });

    it('Finding C (Null notes + concurrent status cancellation during convert-to-buy): preserves multiline concurrent notes when initial notes is null, and aborts if contract status concurrently becomes Cancelled', async () => {
      const contractRow = { ...contract, id: 'contract-1', plot_id: 'plot-1', lead_id: 'lead-1', status: 'Active', notes: null as string | null };
      const plotRow = { id: 'plot-1', sale_status: 'Rented', has_customer: true, current_tenant_name: 'Somchai Jaidee', customer_name: 'Somchai Jaidee', lease_end_date: '2027-01-01' };
      const leadRow = { ...lead, id: 'lead-1', status: 'Rented', rental_status: 'Active', active_rental_contract_id: 'contract-1', notes: null as string | null };
      const salesRows: any[] = [];
      let simulateCancelOnWrite = true;

      resolveQuery = q => {
        if (q.table === 'rental_contracts' && q.action === 'read') {
          if (q.filters.some(([k, v]) => k === 'neq:id' && v === 'contract-1')) return ok([]);
          const snap = { ...contractRow };
          if (simulateCancelOnWrite && q.columns?.includes('notes')) {
            // Concurrent cancellation happens right after fresh read in updateRowWithNotes, before write!
            contractRow.status = 'Cancelled';
            contractRow.notes = 'ยกเลิกโดยแอดมิน';
          }
          return ok(q.single ? snap : [snap]);
        }
        if (q.table === 'rental_contracts' && q.action === 'update') {
          return matchUpdate(contractRow, q);
        }
        if (q.table === 'plots' && q.action === 'read') return ok(q.single ? { ...plotRow } : [{ ...plotRow }]);
        if (q.table === 'plots' && q.action === 'update') return matchUpdate(plotRow, q);
        if (q.table === 'leads' && q.action === 'read') return ok(q.single ? { ...leadRow } : [{ ...leadRow }]);
        if (q.table === 'leads' && q.action === 'update') return matchUpdate(leadRow, q);
        if (q.table === 'sales' && q.action === 'read') return ok(salesRows);
        if (q.table === 'sales' && q.action === 'insert') {
          salesRows.push(...(q.payload as any[]));
          return ok({ id: 'sale-1' });
        }
        return defaultResult(q);
      };

      const onSaved = vi.fn();
      const onClose = vi.fn();
      render(<RentalActionModal isOpen={true} contractId="contract-1" onClose={onClose} onSaved={onSaved} lead={leadRow as any} user={user} />);
      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());

      submit(/ยืนยันเปลี่ยนเป็นซื้อแปลงนี้/);

      // Must abort because contract status became Cancelled during Step 1 optimistic lock check!
      await waitFor(() => expect(screen.getByText(/ไม่พบรายการที่แก้ไขได้|สถานะสัญญาเช่ามีการเปลี่ยนแปลง/i)).toBeInTheDocument());
      expect(contractRow.status).toBe('Cancelled');
      expect(plotRow.sale_status).toBe('Rented');
      expect(leadRow.status).toBe('Rented');
      expect(salesRows).toHaveLength(0);
      expect(onSaved).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    });

    it('Finding A (Real PostgrestClient SDK on Move-Out): move-out plot update matching 0 rows (HTTP 200 [] -> data:null, count:null, error:null) stops before lead update and does not call onSaved/onClose', async () => {
      const db = {
        contracts: [{ ...contract, id: 'contract-1', lead_id: 'lead-1', plot_id: 'plot-1', status: 'Active', notes: 'Init' }],
        plots: [{ id: 'plot-1', sale_status: 'Rented', has_customer: true, current_tenant_name: 'Somchai Jaidee', customer_name: 'Somchai Jaidee', lease_end_date: '2027-01-01', monthly_rent: 15000 }],
        leads: [{ ...lead, id: 'lead-1', status: 'Rented', rental_status: 'Active', active_rental_contract_id: 'contract-1', notes: 'Lead init' }],
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
          const rows: any[] = (db as any)[table === 'rental_contracts' ? 'contracts' : table] || [];

          if (method === 'GET') {
            const matched = rows.filter(r => matchesUrlParams(r, url.searchParams)).map(r => ({ ...r }));
            if (table === 'plots' && matched.length === 1) {
              // Concurrent plot reassignment right after plots read, before plots PATCH!
              db.plots[0].current_tenant_name = 'Another Tenant';
            }
            return new Response(JSON.stringify(matched), { status: 200, headers: { 'Content-Type': 'application/json' } });
          }

          if (method === 'PATCH') {
            const patch = JSON.parse(String(init?.body || '{}'));
            const matched = rows.filter(r => matchesUrlParams(r, url.searchParams));
            matched.forEach(r => Object.assign(r, patch));
            const out = matched.map(r => ({ ...r }));
            return new Response(JSON.stringify(out), { status: 200, headers: { 'Content-Type': 'application/json' } });
          }

          return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
      });

      mocks.from.mockImplementation((table: string) => realClient.from(table));
      const onSaved = vi.fn();
      const onClose = vi.fn();
      render(<RentalActionModal isOpen={true} contractId="contract-1" onClose={onClose} onSaved={onSaved} lead={db.leads[0] as any} user={user} />);
      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());

      fireEvent.click(screen.getByRole('button', { name: /3. สิ้นสุดสัญญา/ }));
      submit(/ยืนยันการย้ายออก/);

      await waitFor(() => expect(screen.getByText(/บันทึกบางส่วนแล้ว แต่ยังไม่ครบ.*ไม่สามารถคืนแปลงได้/i)).toBeInTheDocument());
      expect(db.plots[0].current_tenant_name).toBe('Another Tenant');
      expect(db.leads[0].status).toBe('Rented');
      expect(db.leads[0].active_rental_contract_id).toBe('contract-1');
      expect(onSaved).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    });

    it('Finding A/B/C (Convert-to-buy partial save + retry): retrying convert-to-buy after Step 3 transient failure completes remaining steps without duplicating conversion logs or sales rows', async () => {
      const contractRow = { ...contract, id: 'contract-1', plot_id: 'plot-1', lead_id: 'lead-1', status: 'Active', notes: null as string | null };
      const plotRow = { id: 'plot-1', sale_status: 'Rented', has_customer: true, current_tenant_name: 'Somchai Jaidee', customer_name: 'Somchai Jaidee', lease_end_date: '2027-01-01' };
      const leadRow = { ...lead, id: 'lead-1', status: 'Rented', rental_status: 'Active', active_rental_contract_id: 'contract-1', notes: 'Lead initial' };
      const salesRows: any[] = [];
      let failLeadUpdateOnce = true;

      resolveQuery = q => {
        if (q.table === 'rental_contracts' && q.action === 'read') {
          if (q.filters.some(([k, v]) => k === 'neq:id' && v === 'contract-1')) return ok([]);
          return ok(q.single ? { ...contractRow } : [{ ...contractRow }]);
        }
        if (q.table === 'rental_contracts' && q.action === 'update') return matchUpdate(contractRow, q);
        if (q.table === 'plots' && q.action === 'read') return ok(q.single ? { ...plotRow } : [{ ...plotRow }]);
        if (q.table === 'plots' && q.action === 'update') return matchUpdate(plotRow, q);
        if (q.table === 'leads' && q.action === 'read') return ok(q.single ? { ...leadRow } : [{ ...leadRow }]);
        if (q.table === 'leads' && q.action === 'update') {
          if (failLeadUpdateOnce) {
            failLeadUpdateOnce = false;
            return fail('Temporary network failure on lead update');
          }
          return matchUpdate(leadRow, q);
        }
        if (q.table === 'sales' && q.action === 'read') return ok(salesRows);
        if (q.table === 'sales' && q.action === 'insert') {
          const newSale = { id: `sale-${salesRows.length + 1}`, ...(q.payload as any[])[0] };
          salesRows.push(newSale);
          return ok({ id: newSale.id });
        }
        return defaultResult(q);
      };

      // Concurrent multiline note added to contract before submit (when initial notes was null)
      contractRow.notes = 'Line 1 concurrent\nLine 2 concurrent';

      const onSaved = vi.fn();
      const onClose = vi.fn();
      render(<RentalActionModal isOpen={true} contractId="contract-1" onClose={onClose} onSaved={onSaved} lead={leadRow as any} user={user} />);
      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());

      // Attempt 1: Contract (Step 1) and Plot (Step 2) succeed, Lead (Step 3) fails
      submit(/ยืนยันเปลี่ยนเป็นซื้อแปลงนี้/);
      await waitFor(() => expect(screen.getByText(/บันทึกบางส่วนแล้ว แต่ยังไม่ครบ.*Temporary network failure/i)).toBeInTheDocument());
      expect(contractRow.status).toBe('ConvertedToBuy');
      expect(plotRow.sale_status).toBe('Reserved');
      expect(salesRows).toHaveLength(0);
      expect(onSaved).not.toHaveBeenCalled();

      // Attempt 2 (Retry): Resumes from Step 3 (Lead) -> Step 4 (Sales)
      submit(/ยืนยันเปลี่ยนเป็นซื้อแปลงนี้/);
      await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
      expect(onSaved).toHaveBeenCalledOnce();
      expect(leadRow.status).toBe('Booked');
      expect(leadRow.rental_status).toBe('ConvertedToBuy');
      expect(salesRows).toHaveLength(1);
      expect(salesRows[0].contract_status).toBe('Reserved');
      expect(contractRow.notes).toContain('Line 1 concurrent\nLine 2 concurrent');
      expect((contractRow.notes?.match(/เปลี่ยนจากเช่าเป็นซื้อเมื่อ/g) || [])).toHaveLength(1);
      expect((leadRow.notes?.match(/\[เปลี่ยนจากเช่าเป็นซื้อ/g) || [])).toHaveLength(1);
    });
  });

  // Round 2 Audit Regression Suite: Findings A (P1), B (P1), C (P1), and D (P1)
  describe('Round 2 Audit Findings A, B, C, and D Regression Suite', () => {
    it('Finding A (A1, A4, A5, A6): convert-to-buy rejects when plot becomes Transferred after preflight but before plot helper fresh read, and retry stays blocked without downgrading plot or creating sales', async () => {
      const contractRow = { ...contract, id: 'contract-1', plot_id: 'plot-1', lead_id: 'lead-1', status: 'Active', notes: 'Init' };
      const plotRow = { id: 'plot-1', sale_status: 'Rented', has_customer: true, current_tenant_name: 'Somchai Jaidee', customer_name: 'Somchai Jaidee', lease_end_date: '2027-01-01' };
      const leadRow = { ...lead, id: 'lead-1', status: 'Rented', rental_status: 'Active', active_rental_contract_id: 'contract-1', notes: 'Lead init' };
      const salesRows: any[] = [];
      let plotReads = 0;

      resolveQuery = q => {
        if (q.table === 'rental_contracts' && q.action === 'read') {
          if (q.filters.some(([k, v]) => k === 'neq:id' && v === 'contract-1')) return ok([]);
          return ok(q.single ? { ...contractRow } : [{ ...contractRow }]);
        }
        if (q.table === 'rental_contracts' && q.action === 'update') return matchUpdate(contractRow, q);
        if (q.table === 'plots' && q.action === 'read') {
          plotReads++;
          const snap = { ...plotRow };
          if (plotReads === 1) {
            // After preflight read (plotReads === 1), BEFORE plot helper fresh read (plotReads === 2),
            // another user transfers the plot!
            plotRow.sale_status = 'Transferred';
          }
          return ok(q.single ? snap : [snap]);
        }
        if (q.table === 'plots' && q.action === 'update') return matchUpdate(plotRow, q);
        if (q.table === 'leads' && q.action === 'read') return ok(q.single ? { ...leadRow } : [{ ...leadRow }]);
        if (q.table === 'leads' && q.action === 'update') return matchUpdate(leadRow, q);
        if (q.table === 'sales' && q.action === 'read') return ok(salesRows);
        if (q.table === 'sales' && q.action === 'insert') {
          salesRows.push(...(q.payload as any[]));
          return ok({ id: 'sale-1' });
        }
        return defaultResult(q);
      };

      const onSaved = vi.fn();
      const onClose = vi.fn();
      render(<RentalActionModal isOpen={true} contractId="contract-1" onClose={onClose} onSaved={onSaved} lead={leadRow as any} user={user} />);
      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());

      // Attempt 1: plot becomes Transferred before helper fresh read
      submit(/ยืนยันเปลี่ยนเป็นซื้อแปลงนี้/);

      await waitFor(() => expect(screen.getByText(/บันทึกบางส่วนแล้ว แต่ยังไม่ครบ.*(โอนกรรมสิทธิ์|เปลี่ยนแปลง)/i)).toBeInTheDocument());
      expect(plotRow.sale_status).toBe('Transferred');
      expect(leadRow.status).toBe('Rented');
      expect(salesRows).toHaveLength(0);
      expect(onSaved).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();

      // Attempt 2 (Retry - A4): plot is still Transferred, retry must stay blocked
      submit(/ยืนยันเปลี่ยนเป็นซื้อแปลงนี้/);
      await waitFor(() => expect(screen.getByText(/บันทึกบางส่วนแล้ว แต่ยังไม่ครบ.*โอนกรรมสิทธิ์/i)).toBeInTheDocument());
      expect(plotRow.sale_status).toBe('Transferred');
      expect(leadRow.status).toBe('Rented');
      expect(salesRows).toHaveLength(0);
      expect(onSaved).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    });

    it('Finding A (A1b, A3): convert-to-buy does NOT downgrade Contracted plot when plot advanced after preflight before helper read, and normal convert succeeds when plot stays Rented', async () => {
      const contractRow = { ...contract, id: 'contract-1', plot_id: 'plot-1', lead_id: 'lead-1', status: 'Active', notes: 'Init' };
      const plotRow = { id: 'plot-1', sale_status: 'Rented', has_customer: true, current_tenant_name: 'Somchai Jaidee', customer_name: 'Somchai Jaidee', lease_end_date: '2027-01-01' };
      const leadRow = { ...lead, id: 'lead-1', status: 'Rented', rental_status: 'Active', active_rental_contract_id: 'contract-1', notes: 'Lead init' };
      const salesRows: any[] = [];
      let plotReads = 0;

      resolveQuery = q => {
        if (q.table === 'rental_contracts' && q.action === 'read') {
          if (q.filters.some(([k, v]) => k === 'neq:id' && v === 'contract-1')) return ok([]);
          return ok(q.single ? { ...contractRow } : [{ ...contractRow }]);
        }
        if (q.table === 'rental_contracts' && q.action === 'update') return matchUpdate(contractRow, q);
        if (q.table === 'plots' && q.action === 'read') {
          plotReads++;
          const snap = { ...plotRow };
          if (plotReads === 1) {
            // A1b: After preflight read, plot advances to Contracted before plot helper read!
            plotRow.sale_status = 'Contracted';
          }
          return ok(q.single ? snap : [snap]);
        }
        if (q.table === 'plots' && q.action === 'update') return matchUpdate(plotRow, q);
        if (q.table === 'leads' && q.action === 'read') return ok(q.single ? { ...leadRow } : [{ ...leadRow }]);
        if (q.table === 'leads' && q.action === 'update') return matchUpdate(leadRow, q);
        if (q.table === 'sales' && q.action === 'read') return ok(salesRows);
        if (q.table === 'sales' && q.action === 'insert') {
          const created = { id: 'sale-1', ...(q.payload as any[])[0] };
          salesRows.push(created);
          return ok({ id: created.id });
        }
        return defaultResult(q);
      };

      const onSaved = vi.fn();
      const onClose = vi.fn();
      const { unmount } = render(<RentalActionModal isOpen={true} contractId="contract-1" onClose={onClose} onSaved={onSaved} lead={leadRow as any} user={user} />);
      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());

      submit(/ยืนยันเปลี่ยนเป็นซื้อแปลงนี้/);
      // Must NOT downgrade Contracted back to Reserved!
      await waitFor(() => expect(contractRow.status).toBe('ConvertedToBuy'));
      expect(plotRow.sale_status).toBe('Contracted');
      unmount();

      // A3: Normal convert when plot stays Rented
      contractRow.status = 'Active';
      plotRow.sale_status = 'Rented';
      plotRow.current_tenant_name = 'Somchai Jaidee';
      leadRow.status = 'Rented';
      leadRow.rental_status = 'Active';
      salesRows.length = 0;
      plotReads = 99;

      const onSaved2 = vi.fn();
      const onClose2 = vi.fn();
      render(<RentalActionModal isOpen={true} contractId="contract-1" onClose={onClose2} onSaved={onSaved2} lead={leadRow as any} user={user} />);
      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());

      submit(/ยืนยันเปลี่ยนเป็นซื้อแปลงนี้/);
      await waitFor(() => expect(onClose2).toHaveBeenCalledOnce());
      expect(onSaved2).toHaveBeenCalledOnce();
      expect(contractRow.status).toBe('ConvertedToBuy');
      expect(plotRow.sale_status).toBe('Reserved');
      expect(leadRow.status).toBe('Booked');
      expect(salesRows).toHaveLength(1);
    });

    it('Finding B (B1, B5, B6, B7, B8): convert-to-buy does NOT overwrite sales row when concurrent update advances sales to Transferred / 3,000,000 after read before update, nor on retry', async () => {
      const contractRow = { ...contract, id: 'contract-1', plot_id: 'plot-1', lead_id: 'lead-1', status: 'Active', base_price: 2000000, notes: 'Init' };
      const plotRow = { id: 'plot-1', sale_status: 'Rented', has_customer: true, current_tenant_name: 'Somchai Jaidee', customer_name: 'Somchai Jaidee', lease_end_date: '2027-01-01' };
      const leadRow = { ...lead, id: 'lead-1', status: 'Rented', rental_status: 'Active', active_rental_contract_id: 'contract-1', notes: 'Lead init' };
      const saleRow = { id: 'sale-1', lead_id: 'lead-1', plot_id: 'plot-1', contract_status: 'Reserved', crm_stage: 'booked', sale_price: 2000000, booked_at: '2026-01-01T12:00:00Z' };
      const salesRows = [saleRow];
      let salesReads = 0;

      resolveQuery = q => {
        if (q.table === 'rental_contracts' && q.action === 'read') {
          if (q.filters.some(([k, v]) => k === 'neq:id' && v === 'contract-1')) return ok([]);
          return ok(q.single ? { ...contractRow } : [{ ...contractRow }]);
        }
        if (q.table === 'rental_contracts' && q.action === 'update') return matchUpdate(contractRow, q);
        if (q.table === 'plots' && q.action === 'read') return ok(q.single ? { ...plotRow } : [{ ...plotRow }]);
        if (q.table === 'plots' && q.action === 'update') return matchUpdate(plotRow, q);
        if (q.table === 'leads' && q.action === 'read') return ok(q.single ? { ...leadRow } : [{ ...leadRow }]);
        if (q.table === 'leads' && q.action === 'update') return matchUpdate(leadRow, q);
        if (q.table === 'sales' && q.action === 'read') {
          salesReads++;
          const snap = salesRows.filter(s => s.contract_status !== 'Cancelled').map(s => ({ ...s }));
          if (salesReads === 2) {
            // Right after Step 4 read (salesReads === 2), before sales.update,
            // another user changes Sales to Transferred / transferred / 3,000,000!
            saleRow.contract_status = 'Transferred';
            saleRow.crm_stage = 'transferred';
            saleRow.sale_price = 3000000;
          }
          return ok(snap);
        }
        if (q.table === 'sales' && q.action === 'update') {
          let matches = true;
          for (const [col, val] of q.filters) {
            if (col.startsWith('neq:')) { if ((saleRow as any)[col.slice(4)] === val) matches = false; }
            else if (col === 'is') { if ((saleRow as any)[val as string] !== null) matches = false; }
            else if ((saleRow as any)[col] !== val) matches = false;
          }
          // B5: Explicit zero-row response { data: null, count: null, error: null } on Sales update
          if (!matches) return { data: null, count: null, error: null } as any;
          Object.assign(saleRow, q.payload);
          return ok({ id: saleRow.id });
        }
        if (q.table === 'sales' && q.action === 'insert') {
          salesRows.push(...(q.payload as any[]));
          return ok({ id: 'sale-dup' });
        }
        return defaultResult(q);
      };

      const onSaved = vi.fn();
      const onClose = vi.fn();
      render(<RentalActionModal isOpen={true} contractId="contract-1" onClose={onClose} onSaved={onSaved} lead={leadRow as any} user={user} />);
      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());

      // Attempt 1: fails at Step 4 because sale changed to Transferred / 3,000,000
      submit(/ยืนยันเปลี่ยนเป็นซื้อแปลงนี้/);
      await waitFor(() => expect(screen.getByText(/บันทึกบางส่วนแล้ว แต่ยังไม่ครบ.*ไม่สามารถอัปเดตรายการขายได้/i)).toBeInTheDocument());
      expect(saleRow.contract_status).toBe('Transferred');
      expect(saleRow.crm_stage).toBe('transferred');
      expect(saleRow.sale_price).toBe(3000000);
      expect(salesRows).toHaveLength(1);
      expect(onSaved).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();

      // Attempt 2 (Retry - B6/B7): must NOT overwrite Transferred / 3,000,000 or insert duplicate sale
      submit(/ยืนยันเปลี่ยนเป็นซื้อแปลงนี้/);
      await waitFor(() => expect(screen.getByText(/บันทึกบางส่วนแล้ว แต่ยังไม่ครบ.*(โอนกรรมสิทธิ์|ไม่สามารถอัปเดตรายการขายได้)/i)).toBeInTheDocument());
      expect(saleRow.contract_status).toBe('Transferred');
      expect(saleRow.crm_stage).toBe('transferred');
      expect(saleRow.sale_price).toBe(3000000);
      expect(salesRows).toHaveLength(1);
      expect(onSaved).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    });

    it('Finding B (B2, B5, B6, B8): convert-to-buy detects concurrent price-only change on sales row (Reserved/booked kept, sale_price changed 2,000,000 -> 3,000,000) and blocks retry from overwriting new price', async () => {
      const contractRow = { ...contract, id: 'contract-1', plot_id: 'plot-1', lead_id: 'lead-1', status: 'Active', base_price: 2000000, notes: 'Init' };
      const plotRow = { id: 'plot-1', sale_status: 'Rented', has_customer: true, current_tenant_name: 'Somchai Jaidee', customer_name: 'Somchai Jaidee', lease_end_date: '2027-01-01' };
      const leadRow = { ...lead, id: 'lead-1', status: 'Rented', rental_status: 'Active', active_rental_contract_id: 'contract-1', notes: 'Lead init' };
      const saleRow = { id: 'sale-1', lead_id: 'lead-1', plot_id: 'plot-1', contract_status: 'Reserved', crm_stage: 'booked', sale_price: 2000000, booked_at: '2026-01-01T12:00:00Z' };
      const salesRows = [saleRow];
      let salesReads = 0;

      resolveQuery = q => {
        if (q.table === 'rental_contracts' && q.action === 'read') {
          if (q.filters.some(([k, v]) => k === 'neq:id' && v === 'contract-1')) return ok([]);
          return ok(q.single ? { ...contractRow } : [{ ...contractRow }]);
        }
        if (q.table === 'rental_contracts' && q.action === 'update') return matchUpdate(contractRow, q);
        if (q.table === 'plots' && q.action === 'read') return ok(q.single ? { ...plotRow } : [{ ...plotRow }]);
        if (q.table === 'plots' && q.action === 'update') return matchUpdate(plotRow, q);
        if (q.table === 'leads' && q.action === 'read') return ok(q.single ? { ...leadRow } : [{ ...leadRow }]);
        if (q.table === 'leads' && q.action === 'update') return matchUpdate(leadRow, q);
        if (q.table === 'sales' && q.action === 'read') {
          salesReads++;
          const snap = salesRows.filter(s => s.contract_status !== 'Cancelled').map(s => ({ ...s }));
          if (salesReads === 2) {
            // Concurrent price-only update while contract_status=Reserved and crm_stage=booked stay identical
            saleRow.sale_price = 3000000;
          }
          return ok(snap);
        }
        if (q.table === 'sales' && q.action === 'update') {
          let matches = true;
          for (const [col, val] of q.filters) {
            if (col.startsWith('neq:')) { if ((saleRow as any)[col.slice(4)] === val) matches = false; }
            else if (col === 'is') { if ((saleRow as any)[val as string] !== null) matches = false; }
            else if ((saleRow as any)[col] !== val) matches = false;
          }
          // B5: Explicit zero-row response { data: null, count: null, error: null } on Sales update
          if (!matches) return { data: null, count: null, error: null } as any;
          Object.assign(saleRow, q.payload);
          return ok({ id: saleRow.id });
        }
        if (q.table === 'sales' && q.action === 'insert') {
          salesRows.push(...(q.payload as any[]));
          return ok({ id: 'sale-dup' });
        }
        return defaultResult(q);
      };

      const onSaved = vi.fn();
      const onClose = vi.fn();
      render(<RentalActionModal isOpen={true} contractId="contract-1" onClose={onClose} onSaved={onSaved} lead={leadRow as any} user={user} />);
      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());

      // Attempt 1: price changed after Step 4 read before write -> must fail and preserve 3,000,000
      submit(/ยืนยันเปลี่ยนเป็นซื้อแปลงนี้/);
      await waitFor(() => expect(screen.getByText(/บันทึกบางส่วนแล้ว แต่ยังไม่ครบ.*ไม่สามารถอัปเดตรายการขายได้/i)).toBeInTheDocument());
      expect(saleRow.sale_price).toBe(3000000);
      expect(onSaved).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();

      // Attempt 2 (Retry - B6): must NOT re-read 3,000,000 as safe and overwrite it with old conversion price!
      submit(/ยืนยันเปลี่ยนเป็นซื้อแปลงนี้/);
      await waitFor(() => expect(screen.getByText(/บันทึกบางส่วนแล้ว แต่ยังไม่ครบ.*(ราคา|ไม่สามารถอัปเดตรายการขายได้)/i)).toBeInTheDocument());
      expect(saleRow.sale_price).toBe(3000000);
      expect(salesRows).toHaveLength(1);
      expect(onSaved).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    });

    it('Finding B (B3, B4, B7): convert-to-buy detects when existing sales row is concurrently Cancelled between read and write, blocks retry from inserting a duplicate sale, and allows normal update when unchanged', async () => {
      const contractRow = { ...contract, id: 'contract-1', plot_id: 'plot-1', lead_id: 'lead-1', status: 'Active', base_price: 2000000, notes: 'Init' };
      const plotRow = { id: 'plot-1', sale_status: 'Rented', has_customer: true, current_tenant_name: 'Somchai Jaidee', customer_name: 'Somchai Jaidee', lease_end_date: '2027-01-01' };
      const leadRow = { ...lead, id: 'lead-1', status: 'Rented', rental_status: 'Active', active_rental_contract_id: 'contract-1', notes: 'Lead init' };
      const saleRow = { id: 'sale-1', lead_id: 'lead-1', plot_id: 'plot-1', contract_status: 'Reserved', crm_stage: 'booked', sale_price: 2000000, booked_at: '2026-01-01T12:00:00Z' };
      const salesRows = [saleRow];
      let salesReads = 0;

      resolveQuery = q => {
        if (q.table === 'rental_contracts' && q.action === 'read') {
          if (q.filters.some(([k, v]) => k === 'neq:id' && v === 'contract-1')) return ok([]);
          return ok(q.single ? { ...contractRow } : [{ ...contractRow }]);
        }
        if (q.table === 'rental_contracts' && q.action === 'update') return matchUpdate(contractRow, q);
        if (q.table === 'plots' && q.action === 'read') return ok(q.single ? { ...plotRow } : [{ ...plotRow }]);
        if (q.table === 'plots' && q.action === 'update') return matchUpdate(plotRow, q);
        if (q.table === 'leads' && q.action === 'read') return ok(q.single ? { ...leadRow } : [{ ...leadRow }]);
        if (q.table === 'leads' && q.action === 'update') return matchUpdate(leadRow, q);
        if (q.table === 'sales' && q.action === 'read') {
          salesReads++;
          const snap = salesRows.filter(s => s.contract_status !== 'Cancelled').map(s => ({ ...s }));
          if (salesReads === 2) {
            // Concurrent cancellation of the sale right after Step 4 read
            saleRow.contract_status = 'Cancelled';
          }
          return ok(snap);
        }
        if (q.table === 'sales' && q.action === 'update') {
          let matches = true;
          for (const [col, val] of q.filters) {
            if (col.startsWith('neq:')) { if ((saleRow as any)[col.slice(4)] === val) matches = false; }
            else if (col === 'is') { if ((saleRow as any)[val as string] !== null) matches = false; }
            else if ((saleRow as any)[col] !== val) matches = false;
          }
          // B5: Explicit zero-row response { data: null, count: null, error: null } on Sales update
          if (!matches) return { data: null, count: null, error: null } as any;
          Object.assign(saleRow, q.payload);
          return ok({ id: saleRow.id });
        }
        if (q.table === 'sales' && q.action === 'insert') {
          salesRows.push(...(q.payload as any[]));
          return ok({ id: 'sale-dup' });
        }
        return defaultResult(q);
      };

      const onSaved = vi.fn();
      const onClose = vi.fn();
      render(<RentalActionModal isOpen={true} contractId="contract-1" onClose={onClose} onSaved={onSaved} lead={leadRow as any} user={user} />);
      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());

      // Attempt 1: saleRow became Cancelled before update
      submit(/ยืนยันเปลี่ยนเป็นซื้อแปลงนี้/);
      await waitFor(() => expect(screen.getByText(/บันทึกบางส่วนแล้ว แต่ยังไม่ครบ.*ไม่สามารถอัปเดตรายการขายได้/i)).toBeInTheDocument());
      expect(saleRow.contract_status).toBe('Cancelled');
      expect(salesRows).toHaveLength(1);
      expect(onSaved).not.toHaveBeenCalled();

      // Attempt 2 (Retry - B7): must NOT insert a new duplicate sales row to bypass the cancelled sale-1!
      submit(/ยืนยันเปลี่ยนเป็นซื้อแปลงนี้/);
      await waitFor(() => expect(screen.getByText(/บันทึกบางส่วนแล้ว แต่ยังไม่ครบ.*(ยกเลิก|ไม่สามารถอัปเดตรายการขายได้)/i)).toBeInTheDocument());
      expect(saleRow.contract_status).toBe('Cancelled');
      expect(salesRows).toHaveLength(1);
      expect(onSaved).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    });

    it('Finding B (B4): convert-to-buy updates existing booked sales row cleanly when no concurrent change occurs', async () => {
      const contractRow = { ...contract, id: 'contract-1', plot_id: 'plot-1', lead_id: 'lead-1', status: 'Active', base_price: 2200000, notes: 'Init' };
      const plotRow = { id: 'plot-1', sale_status: 'Rented', has_customer: true, current_tenant_name: 'Somchai Jaidee', customer_name: 'Somchai Jaidee', lease_end_date: '2027-01-01' };
      const leadRow = { ...lead, id: 'lead-1', status: 'Rented', rental_status: 'Active', active_rental_contract_id: 'contract-1', notes: 'Lead init' };
      const saleRow = { id: 'sale-1', lead_id: 'lead-1', plot_id: 'plot-1', contract_status: 'Reserved', crm_stage: 'booked', sale_price: 2000000, booked_at: '2026-01-01T12:00:00Z' };
      const salesRows = [saleRow];

      resolveQuery = q => {
        if (q.table === 'rental_contracts' && q.action === 'read') {
          if (q.filters.some(([k, v]) => k === 'neq:id' && v === 'contract-1')) return ok([]);
          return ok(q.single ? { ...contractRow } : [{ ...contractRow }]);
        }
        if (q.table === 'rental_contracts' && q.action === 'update') return matchUpdate(contractRow, q);
        if (q.table === 'plots' && q.action === 'read') return ok(q.single ? { ...plotRow } : [{ ...plotRow }]);
        if (q.table === 'plots' && q.action === 'update') return matchUpdate(plotRow, q);
        if (q.table === 'leads' && q.action === 'read') return ok(q.single ? { ...leadRow } : [{ ...leadRow }]);
        if (q.table === 'leads' && q.action === 'update') return matchUpdate(leadRow, q);
        if (q.table === 'sales' && q.action === 'read') return ok(salesRows.map(s => ({ ...s })));
        if (q.table === 'sales' && q.action === 'update') {
          let matches = true;
          for (const [col, val] of q.filters) {
            if (col.startsWith('neq:')) { if ((saleRow as any)[col.slice(4)] === val) matches = false; }
            else if (col === 'is') { if ((saleRow as any)[val as string] !== null) matches = false; }
            else if ((saleRow as any)[col] !== val) matches = false;
          }
          // B5: Explicit zero-row response { data: null, count: null, error: null } on Sales update
          if (!matches) return { data: null, count: null, error: null } as any;
          Object.assign(saleRow, q.payload);
          return ok({ id: saleRow.id });
        }
        return defaultResult(q);
      };

      const onSaved = vi.fn();
      const onClose = vi.fn();
      render(<RentalActionModal isOpen={true} contractId="contract-1" onClose={onClose} onSaved={onSaved} lead={leadRow as any} user={user} />);
      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());

      submit(/ยืนยันเปลี่ยนเป็นซื้อแปลงนี้/);
      await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
      expect(onSaved).toHaveBeenCalledOnce();
      expect(saleRow.contract_status).toBe('Reserved');
      expect(saleRow.crm_stage).toBe('booked');
      expect(saleRow.sale_price).toBe(2200000);
    });

    it('Finding C (C1, C6): move-out rejects when plot changes from Rented to Transferred after fresh read before write (same tenant name), and retry stays blocked without resetting plot to Available', async () => {
      const contractRow = { ...contract, id: 'contract-1', plot_id: 'plot-1', lead_id: 'lead-1', status: 'Active', notes: 'Init' };
      const plotRow = { id: 'plot-1', sale_status: 'Rented', has_customer: true, current_tenant_name: 'Somchai Jaidee', customer_name: 'Somchai Jaidee', lease_end_date: '2027-01-01' };
      const leadRow = { ...lead, id: 'lead-1', status: 'Rented', rental_status: 'Active', active_rental_contract_id: 'contract-1', notes: 'Lead init' };
      let plotReads = 0;

      resolveQuery = q => {
        if (q.table === 'rental_contracts' && q.action === 'read') {
          if (q.filters.some(([k, v]) => k === 'neq:id' && v === 'contract-1')) return ok([]);
          return ok(q.single ? { ...contractRow } : [{ ...contractRow }]);
        }
        if (q.table === 'rental_contracts' && q.action === 'update') return matchUpdate(contractRow, q);
        if (q.table === 'plots' && q.action === 'read') {
          plotReads++;
          const snap = { ...plotRow };
          if (plotReads === 1) {
            // Concurrent transfer after freshPlot read, before plots.update (same tenant name!)
            plotRow.sale_status = 'Transferred';
          }
          return ok(q.single ? snap : [snap]);
        }
        if (q.table === 'plots' && q.action === 'update') return matchUpdate(plotRow, q);
        if (q.table === 'leads' && q.action === 'read') return ok(q.single ? { ...leadRow } : [{ ...leadRow }]);
        if (q.table === 'leads' && q.action === 'update') return matchUpdate(leadRow, q);
        return defaultResult(q);
      };

      const onSaved = vi.fn();
      const onClose = vi.fn();
      render(<RentalActionModal isOpen={true} contractId="contract-1" onClose={onClose} onSaved={onSaved} lead={leadRow as any} user={user} />);
      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());

      fireEvent.click(screen.getByRole('button', { name: /3. สิ้นสุดสัญญา/ }));
      submit(/ยืนยันการย้ายออก/);

      await waitFor(() => expect(screen.getByText(/บันทึกบางส่วนแล้ว แต่ยังไม่ครบ.*ไม่สามารถคืนแปลงได้/i)).toBeInTheDocument());
      expect(plotRow.sale_status).toBe('Transferred');
      expect(plotRow.has_customer).toBe(true);
      expect(leadRow.status).toBe('Rented');
      expect(onSaved).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();

      // Retry (C6): plot is now Transferred in fresh read -> must still reject and never wipe plot!
      submit(/ยืนยันการย้ายออก/);
      await waitFor(() => expect(screen.getByText(/บันทึกบางส่วนแล้ว แต่ยังไม่ครบ.*ไม่สามารถคืนแปลงได้/i)).toBeInTheDocument());
      expect(plotRow.sale_status).toBe('Transferred');
      expect(plotRow.has_customer).toBe(true);
      expect(leadRow.status).toBe('Rented');
      expect(onSaved).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    });

    it('Finding C (C2): move-out rejects when plot is already Transferred during fresh read (same tenant name)', async () => {
      const contractRow = { ...contract, id: 'contract-1', plot_id: 'plot-1', lead_id: 'lead-1', status: 'Active', notes: 'Init' };
      const plotRow = { id: 'plot-1', sale_status: 'Transferred', has_customer: true, current_tenant_name: 'Somchai Jaidee', customer_name: 'Somchai Jaidee', lease_end_date: '2027-01-01' };
      const leadRow = { ...lead, id: 'lead-1', status: 'Rented', rental_status: 'Active', active_rental_contract_id: 'contract-1', notes: 'Lead init' };
      let plotUpdateCalled = false;

      resolveQuery = q => {
        if (q.table === 'rental_contracts' && q.action === 'read') {
          if (q.filters.some(([k, v]) => k === 'neq:id' && v === 'contract-1')) return ok([]);
          return ok(q.single ? { ...contractRow } : [{ ...contractRow }]);
        }
        if (q.table === 'rental_contracts' && q.action === 'update') return matchUpdate(contractRow, q);
        if (q.table === 'plots' && q.action === 'read') return ok(q.single ? { ...plotRow } : [{ ...plotRow }]);
        if (q.table === 'plots' && q.action === 'update') {
          plotUpdateCalled = true;
          return matchUpdate(plotRow, q);
        }
        if (q.table === 'leads' && q.action === 'read') return ok(q.single ? { ...leadRow } : [{ ...leadRow }]);
        if (q.table === 'leads' && q.action === 'update') return matchUpdate(leadRow, q);
        return defaultResult(q);
      };

      const onSaved = vi.fn();
      const onClose = vi.fn();
      render(<RentalActionModal isOpen={true} contractId="contract-1" onClose={onClose} onSaved={onSaved} lead={leadRow as any} user={user} />);
      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());

      fireEvent.click(screen.getByRole('button', { name: /3. สิ้นสุดสัญญา/ }));
      submit(/ยืนยันการย้ายออก/);

      await waitFor(() => expect(screen.getByText(/บันทึกบางส่วนแล้ว แต่ยังไม่ครบ.*ไม่สามารถคืนแปลงได้/i)).toBeInTheDocument());
      expect(plotUpdateCalled).toBe(false);
      expect(plotRow.sale_status).toBe('Transferred');
      expect(leadRow.status).toBe('Rented');
      expect(onSaved).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    });

    it('Finding C (C3, C4, C5, C7): move-out when another contract (same or different tenant) holds plot does not claim plot was released to Available, while normal move-out releases plot to Available', async () => {
      const contractOld = { ...contract, id: 'contract-old', plot_id: 'plot-1', lead_id: 'lead-1', status: 'Active', notes: 'Old contract' };
      const contractNewSameTenant = { ...contract, id: 'contract-new', plot_id: 'plot-1', lead_id: 'lead-1', tenant_name: 'Somchai Jaidee', status: 'Active', notes: 'New contract' };
      const plotRow = { id: 'plot-1', sale_status: 'Rented', has_customer: true, current_tenant_name: 'Somchai Jaidee', customer_name: 'Somchai Jaidee', lease_end_date: '2028-01-01' };
      const leadRow = { ...lead, id: 'lead-1', status: 'Rented', rental_status: 'Active', active_rental_contract_id: 'contract-new', notes: 'Lead init' };
      let competingContracts = [{ ...contractNewSameTenant }];

      resolveQuery = q => {
        if (q.table === 'rental_contracts' && q.action === 'read') {
          if (q.filters.some(([k, v]) => k === 'neq:id' && v === 'contract-old')) {
            return ok(competingContracts.map(c => ({ ...c })));
          }
          return ok(q.single ? { ...contractOld } : [{ ...contractOld }]);
        }
        if (q.table === 'rental_contracts' && q.action === 'update') return matchUpdate(contractOld, q);
        if (q.table === 'plots' && q.action === 'read') return ok(q.single ? { ...plotRow } : [{ ...plotRow }]);
        if (q.table === 'plots' && q.action === 'update') return matchUpdate(plotRow, q);
        if (q.table === 'leads' && q.action === 'read') return ok(q.single ? { ...leadRow } : [{ ...leadRow }]);
        if (q.table === 'leads' && q.action === 'update') return matchUpdate(leadRow, q);
        return defaultResult(q);
      };

      const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
      const onSaved = vi.fn();
      const onClose = vi.fn();
      const { unmount } = render(<RentalActionModal isOpen={true} contractId="contract-old" onClose={onClose} onSaved={onSaved} lead={leadRow as any} user={user} />);
      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());

      fireEvent.click(screen.getByRole('button', { name: /3. สิ้นสุดสัญญา/ }));
      submit(/ยืนยันการย้ายออก/);

      await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
      expect(onSaved).toHaveBeenCalledOnce();
      expect(contractOld.status).toBe('MovedOut');
      expect(contractNewSameTenant.status).toBe('Active');
      expect(plotRow.sale_status).toBe('Rented');
      expect(leadRow.status).toBe('Rented');
      expect(leadRow.active_rental_contract_id).toBe('contract-new');
      // C7: Alert message must NOT falsely claim plot was released to Available!
      expect(alertSpy).toHaveBeenCalledOnce();
      expect(String(alertSpy.mock.calls[0][0])).not.toMatch(/กลับมาเป็นแปลงว่าง/);
      unmount();

      // C4: Move-out when another contract with a DIFFERENT tenant holds the plot -> plot stays Rented and alert does NOT claim Available
      contractOld.status = 'Active';
      competingContracts = [{ ...contractNewSameTenant, id: 'contract-new-other', tenant_name: 'Other Tenant B' }];
      plotRow.current_tenant_name = 'Other Tenant B';
      alertSpy.mockClear();
      const onSavedOther = vi.fn();
      const onCloseOther = vi.fn();
      const { unmount: unmountOther } = render(<RentalActionModal isOpen={true} contractId="contract-old" onClose={onCloseOther} onSaved={onSavedOther} lead={leadRow as any} user={user} />);
      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());

      fireEvent.click(screen.getByRole('button', { name: /3. สิ้นสุดสัญญา/ }));
      submit(/ยืนยันการย้ายออก/);

      await waitFor(() => expect(onCloseOther).toHaveBeenCalledOnce());
      expect(onSavedOther).toHaveBeenCalledOnce();
      expect(plotRow.sale_status).toBe('Rented');
      expect(plotRow.current_tenant_name).toBe('Other Tenant B');
      expect(alertSpy).toHaveBeenCalledOnce();
      expect(String(alertSpy.mock.calls[0][0])).not.toMatch(/กลับมาเป็นแปลงว่าง/);
      unmountOther();

      // C5: Normal move-out when no other contract holds the plot -> releases plot to Available and alerts Available!
      contractOld.status = 'Active';
      competingContracts = [];
      plotRow.current_tenant_name = 'Somchai Jaidee';
      leadRow.active_rental_contract_id = 'contract-old';
      alertSpy.mockClear();
      const onSaved2 = vi.fn();
      const onClose2 = vi.fn();
      render(<RentalActionModal isOpen={true} contractId="contract-old" onClose={onClose2} onSaved={onSaved2} lead={leadRow as any} user={user} />);
      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());

      fireEvent.click(screen.getByRole('button', { name: /3. สิ้นสุดสัญญา/ }));
      submit(/ยืนยันการย้ายออก/);

      await waitFor(() => expect(onClose2).toHaveBeenCalledOnce());
      expect(onSaved2).toHaveBeenCalledOnce();
      expect(plotRow.sale_status).toBe('Available');
      expect(plotRow.has_customer).toBe(false);
      expect(leadRow.status).toBe('MovedOut');
      expect(alertSpy).toHaveBeenCalledOnce();
      expect(String(alertSpy.mock.calls[0][0])).toMatch(/กลับมาเป็นแปลงว่าง/);
      alertSpy.mockRestore();
    });

    it('Finding D (D1, D2, D6, D7): advanced Lead (Contracted) convert-to-buy rejects when active_rental_contract_id switches from C1 to C2 (Active on Plot P2) after preflight before Lead write, and retry preserves C2', async () => {
      const contract1Row = { ...contract, id: 'contract-1', plot_id: 'plot-1', lead_id: 'lead-1', status: 'Active', notes: 'C1' };
      const contract2Row = { ...contract, id: 'contract-2', plot_id: 'plot-2', lead_id: 'lead-1', status: 'Active', notes: 'C2 on P2' };
      const plot1Row = { id: 'plot-1', sale_status: 'Contracted', has_customer: true, current_tenant_name: 'Somchai Jaidee', customer_name: 'Somchai Jaidee', lease_end_date: '2027-01-01' };
      const plot2Row = { id: 'plot-2', sale_status: 'Rented', has_customer: true, current_tenant_name: 'Somchai Jaidee', customer_name: 'Somchai Jaidee', lease_end_date: '2028-01-01' };
      const leadRow = {
        ...lead,
        id: 'lead-1',
        status: 'Contracted',
        crm_status: 'Contracted — ทำสัญญาแล้ว',
        deal_type: 'rent',
        rental_status: 'Active',
        active_rental_contract_id: 'contract-1',
        notes: 'Initial lead note'
      };
      const salesRows: any[] = [];
      let leadReads = 0;

      resolveQuery = q => {
        if (q.table === 'rental_contracts' && q.action === 'read') {
          if (q.filters.some(([k, v]) => k === 'neq:id' && v === 'contract-1')) {
            if (q.filters.some(([k, v]) => k === 'plot_id' && v === 'plot-1')) return ok([]);
            return ok([{ ...contract2Row }]);
          }
          if (q.filters.some(([k, v]) => k === 'id' && v === 'contract-2')) {
            return ok(q.single ? { ...contract2Row } : [{ ...contract2Row }]);
          }
          return ok(q.single ? { ...contract1Row } : [{ ...contract1Row }]);
        }
        if (q.table === 'rental_contracts' && q.action === 'update') return matchUpdate(contract1Row, q);
        if (q.table === 'plots' && q.action === 'read') {
          if (q.filters.some(([k, v]) => k === 'id' && v === 'plot-2')) return ok(q.single ? { ...plot2Row } : [{ ...plot2Row }]);
          return ok(q.single ? { ...plot1Row } : [{ ...plot1Row }]);
        }
        if (q.table === 'plots' && q.action === 'update') return matchUpdate(plot1Row, q);
        if (q.table === 'leads' && q.action === 'read') {
          leadReads++;
          const snap = { ...leadRow };
          if (leadReads === 1) {
            // After preflight lead read (leadReads === 1), before Step 3 Lead write,
            // lead is linked to new active contract C2 on plot-2!
            leadRow.active_rental_contract_id = 'contract-2';
            leadRow.rental_status = 'Active';
            leadRow.deal_type = 'rent';
          }
          return ok(q.single ? snap : [snap]);
        }
        if (q.table === 'leads' && q.action === 'update') return matchUpdate(leadRow, q);
        if (q.table === 'sales' && q.action === 'read') return ok(salesRows);
        if (q.table === 'sales' && q.action === 'insert') {
          salesRows.push(...(q.payload as any[]));
          return ok({ id: 'sale-1' });
        }
        return defaultResult(q);
      };

      const onSaved = vi.fn();
      const onClose = vi.fn();
      render(<RentalActionModal isOpen={true} contractId="contract-1" onClose={onClose} onSaved={onSaved} lead={leadRow as any} user={user} />);
      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());

      // Attempt 1: fails at Step 3 because Lead is now linked to C2
      submit(/ยืนยันเปลี่ยนเป็นซื้อแปลงนี้/);
      await waitFor(() => expect(screen.getByText(/บันทึกบางส่วนแล้ว แต่ยังไม่ครบ.*ไม่ใช่สัญญาเช่าปัจจุบันที่ผูกกับลูกค้า/i)).toBeInTheDocument());
      expect(leadRow.status).toBe('Contracted');
      expect(leadRow.active_rental_contract_id).toBe('contract-2');
      expect(leadRow.rental_status).toBe('Active');
      expect(contract2Row.status).toBe('Active');
      expect(salesRows).toHaveLength(0);
      expect(onSaved).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();

      // Attempt 2 (Retry - D6): stays blocked and preserves C2
      submit(/ยืนยันเปลี่ยนเป็นซื้อแปลงนี้/);
      await waitFor(() => expect(screen.getByText(/บันทึกบางส่วนแล้ว แต่ยังไม่ครบ.*ไม่ใช่สัญญาเช่าปัจจุบันที่ผูกกับลูกค้า/i)).toBeInTheDocument());
      expect(leadRow.active_rental_contract_id).toBe('contract-2');
      expect(leadRow.rental_status).toBe('Active');
      expect(contract2Row.status).toBe('Active');
      expect(salesRows).toHaveLength(0);
      expect(onSaved).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    });

    it('Finding D (D3, D4, D5): advanced Lead (Contracted) guards read->write race on active_rental_contract_id (same plot C2) and status (Cancelled/Lost), while normal advanced convert succeeds without touching notes', async () => {
      const contract1Row = { ...contract, id: 'contract-1', plot_id: 'plot-1', lead_id: 'lead-1', status: 'Active', notes: 'C1' };
      const contract2Row = { ...contract, id: 'contract-2', plot_id: 'plot-1', lead_id: 'lead-1', status: 'Active', notes: 'C2 same plot' };
      const plotRow = { id: 'plot-1', sale_status: 'Contracted', has_customer: true, current_tenant_name: 'Somchai Jaidee', customer_name: 'Somchai Jaidee', lease_end_date: '2027-01-01' };
      const leadRow = {
        ...lead,
        id: 'lead-1',
        status: 'Contracted',
        crm_status: 'Contracted — ทำสัญญาแล้ว',
        deal_type: 'rent',
        rental_status: 'Active',
        active_rental_contract_id: 'contract-1',
        notes: 'Keep this exact note'
      };
      const salesRows: any[] = [];
      let leadReads = 0;
      let c2Active = false;

      resolveQuery = q => {
        if (q.table === 'rental_contracts' && q.action === 'read') {
          if (q.filters.some(([k, v]) => k === 'neq:id' && v === 'contract-1')) {
            return ok(c2Active ? [{ ...contract2Row }] : []);
          }
          return ok(q.single ? { ...contract1Row } : [{ ...contract1Row }]);
        }
        if (q.table === 'rental_contracts' && q.action === 'update') return matchUpdate(contract1Row, q);
        if (q.table === 'plots' && q.action === 'read') return ok(q.single ? { ...plotRow } : [{ ...plotRow }]);
        if (q.table === 'plots' && q.action === 'update') return matchUpdate(plotRow, q);
        if (q.table === 'leads' && q.action === 'read') {
          leadReads++;
          const snap = { ...leadRow };
          if (leadReads === 2) {
            // Right after Step 3 Lead read (leadReads === 2), BEFORE Step 3 Lead update:
            // C2 becomes active on same plot and Lead switches active_rental_contract_id to C2!
            c2Active = true;
            leadRow.active_rental_contract_id = 'contract-2';
            leadRow.rental_status = 'Active';
          }
          return ok(q.single ? snap : [snap]);
        }
        if (q.table === 'leads' && q.action === 'update') return matchUpdate(leadRow, q);
        if (q.table === 'sales' && q.action === 'read') return ok(salesRows);
        if (q.table === 'sales' && q.action === 'insert') {
          salesRows.push(...(q.payload as any[]));
          return ok({ id: 'sale-1' });
        }
        return defaultResult(q);
      };

      const onSaved = vi.fn();
      const onClose = vi.fn();
      render(<RentalActionModal isOpen={true} contractId="contract-1" onClose={onClose} onSaved={onSaved} lead={leadRow as any} user={user} />);
      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());

      // D3: read->write race on active_rental_contract_id inside Step 3 advanced branch
      submit(/ยืนยันเปลี่ยนเป็นซื้อแปลงนี้/);
      await waitFor(() => expect(screen.getByText(/บันทึกบางส่วนแล้ว แต่ยังไม่ครบ.*ไม่ใช่สัญญาเช่าปัจจุบันที่ผูกกับลูกค้า/i)).toBeInTheDocument());
      expect(leadRow.active_rental_contract_id).toBe('contract-2');
      expect(leadRow.rental_status).toBe('Active');
      expect(leadRow.notes).toBe('Keep this exact note');
      expect(salesRows).toHaveLength(0);
      expect(onSaved).not.toHaveBeenCalled();
    });

    it('Finding D (D4 & D5): advanced Lead aborts if status concurrently changes to Cancelled/Lost, and succeeds cleanly when linkage is unchanged without modifying lead.notes', async () => {
      const contractRow = { ...contract, id: 'contract-1', plot_id: 'plot-1', lead_id: 'lead-1', status: 'Active', notes: 'C1' };
      const plotRow = { id: 'plot-1', sale_status: 'Contracted', has_customer: true, current_tenant_name: 'Somchai Jaidee', customer_name: 'Somchai Jaidee', lease_end_date: '2027-01-01' };
      const leadRow = {
        ...lead,
        id: 'lead-1',
        status: 'Contracted',
        crm_status: 'Contracted — ทำสัญญาแล้ว',
        deal_type: 'rent',
        rental_status: 'Active',
        active_rental_contract_id: 'contract-1',
        notes: 'Untouched advanced note'
      };
      const salesRows: any[] = [];
      let leadReads = 0;

      resolveQuery = q => {
        if (q.table === 'rental_contracts' && q.action === 'read') {
          if (q.filters.some(([k, v]) => k === 'neq:id' && v === 'contract-1')) return ok([]);
          return ok(q.single ? { ...contractRow } : [{ ...contractRow }]);
        }
        if (q.table === 'rental_contracts' && q.action === 'update') return matchUpdate(contractRow, q);
        if (q.table === 'plots' && q.action === 'read') return ok(q.single ? { ...plotRow } : [{ ...plotRow }]);
        if (q.table === 'plots' && q.action === 'update') return matchUpdate(plotRow, q);
        if (q.table === 'leads' && q.action === 'read') {
          leadReads++;
          const snap = { ...leadRow };
          if (leadReads === 1) {
            // D5: After preflight, Lead becomes Cancelled before Step 3
            leadRow.status = 'Cancelled';
          }
          return ok(q.single ? snap : [snap]);
        }
        if (q.table === 'leads' && q.action === 'update') return matchUpdate(leadRow, q);
        if (q.table === 'sales' && q.action === 'read') return ok(salesRows);
        if (q.table === 'sales' && q.action === 'insert') {
          salesRows.push(...(q.payload as any[]));
          return ok({ id: 'sale-1' });
        }
        return defaultResult(q);
      };

      const onSaved = vi.fn();
      const onClose = vi.fn();
      const { unmount } = render(<RentalActionModal isOpen={true} contractId="contract-1" onClose={onClose} onSaved={onSaved} lead={leadRow as any} user={user} />);
      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());

      // D5: fails because lead became Cancelled
      submit(/ยืนยันเปลี่ยนเป็นซื้อแปลงนี้/);
      await waitFor(() => expect(screen.getByText(/บันทึกบางส่วนแล้ว แต่ยังไม่ครบ.*สถานะของลูกค้าถูกยกเลิกแล้ว/i)).toBeInTheDocument());
      expect(leadRow.status).toBe('Cancelled');
      expect(leadRow.rental_status).toBe('Active');
      expect(salesRows).toHaveLength(0);
      expect(onSaved).not.toHaveBeenCalled();
      unmount();

      // D4: Now reset leadRow to Contracted with no concurrent conflict -> succeeds without touching lead.notes or downgrading status
      contractRow.status = 'Active';
      leadRow.status = 'Contracted';
      leadRow.rental_status = 'Active';
      leadReads = 99; // no mutation on read

      const onSaved2 = vi.fn();
      const onClose2 = vi.fn();
      render(<RentalActionModal isOpen={true} contractId="contract-1" onClose={onClose2} onSaved={onSaved2} lead={leadRow as any} user={user} />);
      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());

      submit(/ยืนยันเปลี่ยนเป็นซื้อแปลงนี้/);
      await waitFor(() => expect(onClose2).toHaveBeenCalledOnce());
      expect(onSaved2).toHaveBeenCalledOnce();
      expect(leadRow.status).toBe('Contracted');
      expect(leadRow.deal_type).toBe('buy');
      expect(leadRow.rental_status).toBe('ConvertedToBuy');
      expect(leadRow.notes).toBe('Untouched advanced note');
      expect(salesRows).toHaveLength(1);
    });
  });

  // Round 3 Audit Regression Suite: Findings A (P1), B (P2), and C (P2)
  describe('Round 3 Audit Findings A, B, and C Regression Suite', () => {
    it('Finding A (A1, A3, A8): when initial preflight had no Sales, a Sales row created by another user before Step 4 with different price (3,000,000) is NOT overwritten to 2,000,000 and no duplicate row is inserted', async () => {
      const contractRow = { ...contract, id: 'contract-1', plot_id: 'plot-1', lead_id: 'lead-1', status: 'Active', base_price: 2000000, notes: 'Init' };
      const plotRow = { id: 'plot-1', sale_status: 'Rented', has_customer: true, current_tenant_name: 'Somchai Jaidee', customer_name: 'Somchai Jaidee', lease_end_date: '2027-01-01' };
      const leadRow = { ...lead, id: 'lead-1', status: 'Rented', rental_status: 'Active', active_rental_contract_id: 'contract-1', notes: 'Lead init' };
      const salesRows: any[] = [];
      let salesReads = 0;
      let salesUpdateCalls = 0;
      let salesInsertCalls = 0;

      resolveQuery = q => {
        if (q.table === 'rental_contracts' && q.action === 'read') {
          if (q.filters.some(([k, v]) => k === 'neq:id' && v === 'contract-1')) return ok([]);
          return ok(q.single ? { ...contractRow } : [{ ...contractRow }]);
        }
        if (q.table === 'rental_contracts' && q.action === 'update') return matchUpdate(contractRow, q);
        if (q.table === 'plots' && q.action === 'read') return ok(q.single ? { ...plotRow } : [{ ...plotRow }]);
        if (q.table === 'plots' && q.action === 'update') return matchUpdate(plotRow, q);
        if (q.table === 'leads' && q.action === 'read') return ok(q.single ? { ...leadRow } : [{ ...leadRow }]);
        if (q.table === 'leads' && q.action === 'update') return matchUpdate(leadRow, q);
        if (q.table === 'sales' && q.action === 'read') {
          salesReads++;
          if (salesReads === 2 && salesRows.length === 0) {
            // Another user creates a Sales row for the same Lead/Plot with price 3,000,000 before Step 4 reads!
            salesRows.push({
              id: 'sale-other-user',
              lead_id: 'lead-1',
              plot_id: 'plot-1',
              contract_status: 'Reserved',
              crm_stage: 'booked',
              sale_price: 3000000,
              booked_at: '2026-02-01T12:00:00Z',
              created_at: '2026-02-01T10:00:00Z',
              updated_at: '2026-02-01T10:00:00Z'
            });
          }
          return ok(salesRows.filter(s => s.contract_status !== 'Cancelled').map(s => ({ ...s })));
        }
        if (q.table === 'sales' && q.action === 'update') {
          salesUpdateCalls++;
          return matchUpdate(salesRows[0], q);
        }
        if (q.table === 'sales' && q.action === 'insert') {
          salesInsertCalls++;
          salesRows.push(...(q.payload as any[]));
          return ok({ id: 'sale-dup' });
        }
        return defaultResult(q);
      };

      const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
      const onSaved = vi.fn();
      const onClose = vi.fn();
      render(<RentalActionModal isOpen={true} contractId="contract-1" onClose={onClose} onSaved={onSaved} lead={leadRow as any} user={user} />);
      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());

      submit(/ยืนยันเปลี่ยนเป็นซื้อแปลงนี้/);

      await waitFor(() => expect(screen.getByText(/บันทึกบางส่วนแล้ว แต่ยังไม่ครบ.*(รายการขาย|ไม่สามารถ)/i)).toBeInTheDocument());
      expect(salesRows).toHaveLength(1);
      expect(salesRows[0].id).toBe('sale-other-user');
      expect(salesRows[0].sale_price).toBe(3000000);
      expect(salesRows[0].booked_at).toBe('2026-02-01T12:00:00Z');
      expect(salesUpdateCalls).toBe(0);
      expect(salesInsertCalls).toBe(0);
      expect(onSaved).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
      expect(alertSpy).not.toHaveBeenCalled();
      alertSpy.mockRestore();
    });

    it('Finding A (A2, A4, A5, A6): blocks adopting concurrent Sales row even when price is identical (A4), when created before retry after Step 3 failure (A2), or when status is Contracted (A5); and succeeds normally when no concurrent writer exists (A6)', async () => {
      const contractRow = { ...contract, id: 'contract-1', plot_id: 'plot-1', lead_id: 'lead-1', status: 'Active', base_price: 2000000, notes: 'Init' };
      const plotRow = { id: 'plot-1', sale_status: 'Rented', has_customer: true, current_tenant_name: 'Somchai Jaidee', customer_name: 'Somchai Jaidee', lease_end_date: '2027-01-01' };
      const leadRow = { ...lead, id: 'lead-1', status: 'Rented', rental_status: 'Active', active_rental_contract_id: 'contract-1', notes: 'Lead init' };
      const salesRows: any[] = [];
      let failLeadStepOnce = true;
      let salesUpdateCalls = 0;
      let salesInsertCalls = 0;

      resolveQuery = q => {
        if (q.table === 'rental_contracts' && q.action === 'read') {
          if (q.filters.some(([k, v]) => k === 'neq:id' && v === 'contract-1')) return ok([]);
          return ok(q.single ? { ...contractRow } : [{ ...contractRow }]);
        }
        if (q.table === 'rental_contracts' && q.action === 'update') return matchUpdate(contractRow, q);
        if (q.table === 'plots' && q.action === 'read') return ok(q.single ? { ...plotRow } : [{ ...plotRow }]);
        if (q.table === 'plots' && q.action === 'update') return matchUpdate(plotRow, q);
        if (q.table === 'leads' && q.action === 'read') return ok(q.single ? { ...leadRow } : [{ ...leadRow }]);
        if (q.table === 'leads' && q.action === 'update') {
          if (failLeadStepOnce) {
            failLeadStepOnce = false;
            return { data: null, error: { message: 'Temporary lead network glitch' } } as any;
          }
          return matchUpdate(leadRow, q);
        }
        if (q.table === 'sales' && q.action === 'read') {
          if (q.filters.some(([k, v]) => k === 'contract_status' && v === 'Cancelled')) {
            return ok(salesRows.filter(s => s.contract_status === 'Cancelled').map(s => ({ ...s })));
          }
          return ok(salesRows.filter(s => s.contract_status !== 'Cancelled').map(s => ({ ...s })));
        }
        if (q.table === 'sales' && q.action === 'update') {
          salesUpdateCalls++;
          return matchUpdate(salesRows[0], q);
        }
        if (q.table === 'sales' && q.action === 'insert') {
          salesInsertCalls++;
          const created = { id: 'sale-normal', ...(q.payload as any[])[0] };
          salesRows.push(created);
          return ok({ id: created.id });
        }
        return defaultResult(q);
      };

      const onSaved = vi.fn();
      const onClose = vi.fn();
      const { unmount } = render(<RentalActionModal isOpen={true} contractId="contract-1" onClose={onClose} onSaved={onSaved} lead={leadRow as any} user={user} />);
      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());

      // Attempt 1: fails at Step 3 (Lead) before Step 4 (Sales) is ever reached (A2)
      submit(/ยืนยันเปลี่ยนเป็นซื้อแปลงนี้/);
      await waitFor(() => expect(screen.getByText(/บันทึกบางส่วนแล้ว แต่ยังไม่ครบ.*Temporary lead network glitch/i)).toBeInTheDocument());
      expect(salesRows).toHaveLength(0);

      // Before Retry: Another user creates a Sales row with the EXACT SAME price (2,000,000) and booked_at (A4)
      salesRows.push({
        id: 'sale-other-same-price',
        lead_id: 'lead-1',
        plot_id: 'plot-1',
        contract_status: 'Reserved',
        crm_stage: 'booked',
        sale_price: 2000000,
        booked_at: '2026-03-01T12:00:00Z',
        created_at: '2026-03-01T08:00:00Z',
        updated_at: '2026-03-01T08:00:00Z'
      });

      // Attempt 2 (Retry - A2 & A4): must NOT adopt or overwrite sale-other-same-price just because price matches!
      submit(/ยืนยันเปลี่ยนเป็นซื้อแปลงนี้/);
      await waitFor(() => expect(screen.getByText(/บันทึกบางส่วนแล้ว แต่ยังไม่ครบ.*รายการขาย/i)).toBeInTheDocument());
      expect(salesUpdateCalls).toBe(0);
      expect(salesInsertCalls).toBe(0);
      expect(salesRows).toHaveLength(1);
      expect(salesRows[0].booked_at).toBe('2026-03-01T12:00:00Z');
      expect(onSaved).not.toHaveBeenCalled();

      // A5: If the concurrent row is Contracted, retry still rejects and does not downgrade it
      salesRows[0].contract_status = 'Contracted';
      salesRows[0].crm_stage = 'contracted';
      submit(/ยืนยันเปลี่ยนเป็นซื้อแปลงนี้/);
      await waitFor(() => expect(screen.getByText(/บันทึกบางส่วนแล้ว แต่ยังไม่ครบ.*รายการขาย/i)).toBeInTheDocument());
      expect(salesRows[0].contract_status).toBe('Contracted');
      expect(salesUpdateCalls).toBe(0);
      expect(salesInsertCalls).toBe(0);
      unmount();

      // A6: Control test — no concurrent writer -> creates 1 Sales row normally
      contractRow.status = 'Active';
      plotRow.sale_status = 'Rented';
      plotRow.current_tenant_name = 'Somchai Jaidee';
      leadRow.status = 'Rented';
      leadRow.rental_status = 'Active';
      salesRows.length = 0;

      const onSavedNormal = vi.fn();
      const onCloseNormal = vi.fn();
      render(<RentalActionModal isOpen={true} contractId="contract-1" onClose={onCloseNormal} onSaved={onSavedNormal} lead={leadRow as any} user={user} />);
      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());

      submit(/ยืนยันเปลี่ยนเป็นซื้อแปลงนี้/);
      await waitFor(() => expect(onCloseNormal).toHaveBeenCalledOnce());
      expect(onSavedNormal).toHaveBeenCalledOnce();
      expect(salesInsertCalls).toBe(1);
      expect(salesRows).toHaveLength(1);
      const insertedPayload = writes('sales').find(query => query.action === 'insert')?.payload as Record<string, unknown>[];
      expect(salesRows[0].id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      expect(salesRows[0].id).toBe(insertedPayload[0].id);
    });

    it('Finding B (B1, B2, B8, B10): when Sales update commits in DB but network response is lost (both price-changed B1 and same-price updated_at-changed B2), Retry reconciles without false conflict and without re-running completed Contract/Plot/Lead/Sales writes', async () => {
      const contractRow = { ...contract, id: 'contract-1', plot_id: 'plot-1', lead_id: 'lead-1', status: 'Active', base_price: 2000000, notes: 'Init' };
      const plotRow = { id: 'plot-1', sale_status: 'Rented', has_customer: true, current_tenant_name: 'Somchai Jaidee', customer_name: 'Somchai Jaidee', lease_end_date: '2027-01-01' };
      const leadRow = { ...lead, id: 'lead-1', status: 'Rented', rental_status: 'Active', active_rental_contract_id: 'contract-1', notes: 'Lead init' };
      const saleRow = { id: 'sale-1', lead_id: 'lead-1', plot_id: 'plot-1', contract_status: 'Reserved', crm_stage: 'booked', sale_price: 1800000, booked_at: '2026-01-01T12:00:00Z', updated_at: '2026-01-01T00:00:00Z' };
      const salesRows = [saleRow];

      let contractUpdates = 0;
      let plotUpdates = 0;
      let leadUpdates = 0;
      let salesUpdates = 0;
      let loseSalesUpdateResponseOnce = true;

      resolveQuery = q => {
        if (q.table === 'rental_contracts' && q.action === 'read') {
          if (q.filters.some(([k, v]) => k === 'neq:id' && v === 'contract-1')) return ok([]);
          return ok(q.single ? { ...contractRow } : [{ ...contractRow }]);
        }
        if (q.table === 'rental_contracts' && q.action === 'update') {
          contractUpdates++;
          return matchUpdate(contractRow, q);
        }
        if (q.table === 'plots' && q.action === 'read') return ok(q.single ? { ...plotRow } : [{ ...plotRow }]);
        if (q.table === 'plots' && q.action === 'update') {
          plotUpdates++;
          return matchUpdate(plotRow, q);
        }
        if (q.table === 'leads' && q.action === 'read') return ok(q.single ? { ...leadRow } : [{ ...leadRow }]);
        if (q.table === 'leads' && q.action === 'update') {
          leadUpdates++;
          return matchUpdate(leadRow, q);
        }
        if (q.table === 'sales' && q.action === 'read') {
          if (q.filters.some(([k, v]) => k === 'contract_status' && v === 'Cancelled')) {
            return ok(salesRows.filter(s => s.contract_status === 'Cancelled').map(s => ({ ...s })));
          }
          return ok(salesRows.filter(s => s.contract_status !== 'Cancelled').map(s => ({ ...s })));
        }
        if (q.table === 'sales' && q.action === 'update') {
          salesUpdates++;
          const res = matchUpdate(saleRow, q);
          if (loseSalesUpdateResponseOnce) {
            loseSalesUpdateResponseOnce = false;
            // Commit succeeded in DB (saleRow is already mutated by matchUpdate!), but response is lost!
            return { data: null, error: { message: 'Network drop after DB commit' } } as any;
          }
          return res;
        }
        return defaultResult(q);
      };

      const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
      const onSaved = vi.fn();
      const onClose = vi.fn();
      const { unmount } = render(<RentalActionModal isOpen={true} contractId="contract-1" onClose={onClose} onSaved={onSaved} lead={leadRow as any} user={user} />);
      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());

      // Attempt 1 (B1): DB commits sale_price = 2,000,000 and new updated_at, then network response is lost
      submit(/ยืนยันเปลี่ยนเป็นซื้อแปลงนี้/);
      await waitFor(() => expect(screen.getByText(/บันทึกบางส่วนแล้ว แต่ยังไม่ครบ.*Network drop after DB commit/i)).toBeInTheDocument());
      expect(saleRow.sale_price).toBe(2000000);
      expect(saleRow.updated_at).not.toBe('2026-01-01T00:00:00Z');
      expect(contractUpdates).toBe(1);
      expect(plotUpdates).toBe(1);
      expect(leadUpdates).toBe(1);
      expect(salesUpdates).toBe(1);
      expect(onSaved).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();

      // Attempt 2 (Retry - B1 & B8): must reconcile committed saleRow without false conflict and without re-updating Contract/Plot/Lead/Sales!
      submit(/ยืนยันเปลี่ยนเป็นซื้อแปลงนี้/);
      await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
      expect(onSaved).toHaveBeenCalledOnce();
      expect(contractUpdates).toBe(1);
      expect(plotUpdates).toBe(1);
      expect(leadUpdates).toBe(1);
      expect(salesUpdates).toBe(1);
      expect(saleRow.sale_price).toBe(2000000);
      unmount();

      // B2: Same price (2,000,000 -> 2,000,000), but updated_at changes on DB commit before response is lost
      contractRow.status = 'Active';
      plotRow.sale_status = 'Rented';
      plotRow.current_tenant_name = 'Somchai Jaidee';
      leadRow.status = 'Rented';
      leadRow.rental_status = 'Active';
      saleRow.sale_price = 2000000;
      saleRow.updated_at = '2026-01-01T00:00:00Z';
      loseSalesUpdateResponseOnce = true;
      contractUpdates = 0;
      plotUpdates = 0;
      leadUpdates = 0;
      salesUpdates = 0;

      const onSaved2 = vi.fn();
      const onClose2 = vi.fn();
      render(<RentalActionModal isOpen={true} contractId="contract-1" onClose={onClose2} onSaved={onSaved2} lead={leadRow as any} user={user} />);
      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());

      submit(/ยืนยันเปลี่ยนเป็นซื้อแปลงนี้/);
      await waitFor(() => expect(screen.getByText(/บันทึกบางส่วนแล้ว แต่ยังไม่ครบ.*Network drop after DB commit/i)).toBeInTheDocument());
      expect(salesUpdates).toBe(1);

      submit(/ยืนยันเปลี่ยนเป็นซื้อแปลงนี้/);
      await waitFor(() => expect(onClose2).toHaveBeenCalledOnce());
      expect(onSaved2).toHaveBeenCalledOnce();
      expect(salesUpdates).toBe(1);
      alertSpy.mockRestore();
    });

    it('Finding B (B3, A7, B4, B5, B6, B7): handles lost response on Sales insert without duplicating (B3/A7), retries pre-commit failures (B4), protects external price/status changes after our lost-response commit (B5/B6), and blocks in-flight double submit (B7)', async () => {
      const contractRow = { ...contract, id: 'contract-1', plot_id: 'plot-1', lead_id: 'lead-1', status: 'Active', base_price: 2000000, notes: 'Init' };
      const plotRow = { id: 'plot-1', sale_status: 'Rented', has_customer: true, current_tenant_name: 'Somchai Jaidee', customer_name: 'Somchai Jaidee', lease_end_date: '2027-01-01' };
      const leadRow = { ...lead, id: 'lead-1', status: 'Rented', rental_status: 'Active', active_rental_contract_id: 'contract-1', notes: 'Lead init' };
      const salesRows: any[] = [];

      let insertBehavior: 'fail_before_commit' | 'commit_then_lose_response' | 'normal' = 'fail_before_commit';
      let salesInserts = 0;
      let salesUpdates = 0;

      resolveQuery = q => {
        if (q.table === 'rental_contracts' && q.action === 'read') {
          if (q.filters.some(([k, v]) => k === 'neq:id' && v === 'contract-1')) return ok([]);
          return ok(q.single ? { ...contractRow } : [{ ...contractRow }]);
        }
        if (q.table === 'rental_contracts' && q.action === 'update') return matchUpdate(contractRow, q);
        if (q.table === 'plots' && q.action === 'read') return ok(q.single ? { ...plotRow } : [{ ...plotRow }]);
        if (q.table === 'plots' && q.action === 'update') return matchUpdate(plotRow, q);
        if (q.table === 'leads' && q.action === 'read') return ok(q.single ? { ...leadRow } : [{ ...leadRow }]);
        if (q.table === 'leads' && q.action === 'update') return matchUpdate(leadRow, q);
        if (q.table === 'sales' && q.action === 'read') {
          if (q.filters.some(([k, v]) => k === 'contract_status' && v === 'Cancelled')) {
            return ok(salesRows.filter(s => s.contract_status === 'Cancelled').map(s => ({ ...s })));
          }
          return ok(salesRows.filter(s => s.contract_status !== 'Cancelled').map(s => ({ ...s })));
        }
        if (q.table === 'sales' && q.action === 'update') {
          salesUpdates++;
          return matchUpdate(salesRows[0], q);
        }
        if (q.table === 'sales' && q.action === 'insert') {
          salesInserts++;
          if (insertBehavior === 'fail_before_commit') {
            // B4: Fails BEFORE DB commit (no row added to salesRows)
            return { data: null, error: { message: 'Connection refused before insert commit' } } as any;
          }
          const created = { id: 'sale-inserted-1', ...(q.payload as any[])[0] };
          salesRows.push(created);
          if (insertBehavior === 'commit_then_lose_response') {
            // B3 / A7: Row committed in DB, but response lost!
            return { data: null, error: { message: 'Response lost after insert commit' } } as any;
          }
          return ok({ id: created.id });
        }
        return defaultResult(q);
      };

      const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
      const onSaved = vi.fn();
      const onClose = vi.fn();
      const { unmount } = render(<RentalActionModal isOpen={true} contractId="contract-1" onClose={onClose} onSaved={onSaved} lead={leadRow as any} user={user} />);
      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());

      // B7: Double submit while request is in flight -> only 1 execution
      submit(/ยืนยันเปลี่ยนเป็นซื้อแปลงนี้/);
      fireEvent.submit(screen.getByRole('button', { name: /ยืนยันเปลี่ยนเป็นซื้อแปลงนี้|กำลังเปลี่ยนเป็นซื้อ/ }).closest('form')!);
      await waitFor(() => expect(screen.getByText(/บันทึกบางส่วนแล้ว แต่ยังไม่ครบ.*Connection refused before insert commit/i)).toBeInTheDocument());
      expect(salesInserts).toBe(1);
      expect(salesRows).toHaveLength(0);

      // B4 -> B3: Now retry; this time insert commits in DB but loses response!
      insertBehavior = 'commit_then_lose_response';
      submit(/ยืนยันเปลี่ยนเป็นซื้อแปลงนี้/);
      await waitFor(() => expect(screen.getByText(/บันทึกบางส่วนแล้ว แต่ยังไม่ครบ.*Response lost after insert commit/i)).toBeInTheDocument());
      expect(salesInserts).toBe(2);
      expect(salesRows).toHaveLength(1);

      // B3 & A7: Retry after lost insert response -> reconciles the committed row without inserting a duplicate!
      insertBehavior = 'normal';
      submit(/ยืนยันเปลี่ยนเป็นซื้อแปลงนี้/);
      await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
      expect(onSaved).toHaveBeenCalledOnce();
      expect(salesInserts).toBe(2); // did NOT call insert a 3rd time!
      expect(salesUpdates).toBe(0);
      expect(salesRows).toHaveLength(1);
      unmount();

      // B5 & B6: Our insert commits and loses response, THEN another user modifies price to 3,500,000 (B5) or status to Contracted (B6) before we retry!
      contractRow.status = 'Active';
      plotRow.sale_status = 'Rented';
      plotRow.current_tenant_name = 'Somchai Jaidee';
      leadRow.status = 'Rented';
      leadRow.rental_status = 'Active';
      salesRows.length = 0;
      salesInserts = 0;
      salesUpdates = 0;
      insertBehavior = 'commit_then_lose_response';

      const onSavedPostMod = vi.fn();
      const onClosePostMod = vi.fn();
      render(<RentalActionModal isOpen={true} contractId="contract-1" onClose={onClosePostMod} onSaved={onSavedPostMod} lead={leadRow as any} user={user} />);
      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());

      submit(/ยืนยันเปลี่ยนเป็นซื้อแปลงนี้/);
      await waitFor(() => expect(screen.getByText(/บันทึกบางส่วนแล้ว แต่ยังไม่ครบ.*Response lost after insert commit/i)).toBeInTheDocument());
      expect(salesRows).toHaveLength(1);

      // Another user changes price of the newly created sale to 3,500,000 (B5)
      salesRows[0].sale_price = 3500000;
      salesRows[0].updated_at = '2026-10-25T00:00:00Z';

      submit(/ยืนยันเปลี่ยนเป็นซื้อแปลงนี้/);
      await waitFor(() => expect(screen.getByText(/บันทึกบางส่วนแล้ว แต่ยังไม่ครบ.*ราคาขายมีการเปลี่ยนแปลง/i)).toBeInTheDocument());
      expect(salesRows[0].sale_price).toBe(3500000);
      expect(salesRows).toHaveLength(1);
      expect(salesUpdates).toBe(0);
      expect(onSavedPostMod).not.toHaveBeenCalled();

      // B6: Another user changes status to Contracted
      salesRows[0].contract_status = 'Contracted';
      salesRows[0].crm_stage = 'contracted';
      submit(/ยืนยันเปลี่ยนเป็นซื้อแปลงนี้/);
      await waitFor(() => expect(screen.getByText(/บันทึกบางส่วนแล้ว แต่ยังไม่ครบ.*สถานะรายการขายมีการเปลี่ยนแปลง/i)).toBeInTheDocument());
      expect(salesRows[0].contract_status).toBe('Contracted');
      expect(salesRows).toHaveLength(1);
      expect(onSavedPostMod).not.toHaveBeenCalled();

      // B6b: Another user cancels the row after our insert committed -> Retry must NOT insert a replacement row!
      salesRows[0].contract_status = 'Cancelled';
      submit(/ยืนยันเปลี่ยนเป็นซื้อแปลงนี้/);
      await waitFor(() => expect(screen.getByText(/บันทึกบางส่วนแล้ว แต่ยังไม่ครบ.*รายการขายถูกยกเลิกระหว่างทำรายการ/i)).toBeInTheDocument());
      expect(salesRows[0].contract_status).toBe('Cancelled');
      expect(salesRows).toHaveLength(1);
      expect(salesInserts).toBe(1);
      expect(onSavedPostMod).not.toHaveBeenCalled();
      alertSpy.mockRestore();
    });

    it('Finding C (C1, C2, C3, C4, C5, C6, C7): move-out Retry after Lead failure preserves skipped-plot outcome message (does NOT claim plot was released to Available), avoids re-running plot step, and handles already-Available plots accurately', async () => {
      const contractOld = { ...contract, id: 'contract-old', plot_id: 'plot-1', lead_id: 'lead-1', status: 'Active', notes: 'Old contract' };
      const contractNewC2 = { ...contract, id: 'contract-2', plot_id: 'plot-1', lead_id: 'lead-1', tenant_name: 'Somchai Jaidee', status: 'Active', notes: 'Active C2' };
      const plotRow = { id: 'plot-1', sale_status: 'Rented', has_customer: true, current_tenant_name: 'Somchai Jaidee', customer_name: 'Somchai Jaidee', lease_end_date: '2028-01-01' };
      const leadRow = { ...lead, id: 'lead-1', status: 'Rented', rental_status: 'Active', active_rental_contract_id: 'contract-2', notes: 'Lead init' };
      let competingContracts = [{ ...contractNewC2 }];
      let leadFailuresRemaining = 2;
      let plotStepReads = 0;
      let plotStepUpdates = 0;

      resolveQuery = q => {
        if (q.table === 'rental_contracts' && q.action === 'read') {
          if (q.filters.some(([k, v]) => k === 'neq:id' && v === 'contract-old')) {
            plotStepReads++;
            return ok(competingContracts.map(c => ({ ...c })));
          }
          return ok(q.single ? { ...contractOld } : [{ ...contractOld }]);
        }
        if (q.table === 'rental_contracts' && q.action === 'update') return matchUpdate(contractOld, q);
        if (q.table === 'plots' && q.action === 'read') return ok(q.single ? { ...plotRow } : [{ ...plotRow }]);
        if (q.table === 'plots' && q.action === 'update') {
          plotStepUpdates++;
          return matchUpdate(plotRow, q);
        }
        if (q.table === 'leads' && q.action === 'read') return ok(q.single ? { ...leadRow } : [{ ...leadRow }]);
        if (q.table === 'leads' && q.action === 'update') {
          if (leadFailuresRemaining > 0) {
            leadFailuresRemaining--;
            return { data: null, error: { message: 'Lead temporary timeout' } } as any;
          }
          return matchUpdate(leadRow, q);
        }
        return defaultResult(q);
      };

      const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
      const onSaved = vi.fn();
      const onClose = vi.fn();
      const { unmount } = render(<RentalActionModal isOpen={true} contractId="contract-old" onClose={onClose} onSaved={onSaved} lead={leadRow as any} user={user} />);
      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());

      fireEvent.click(screen.getByRole('button', { name: /3. สิ้นสุดสัญญา/ }));

      // Attempt 1 (C1, C6): Contract step succeeds, Plot step skips release due to C2, Lead step fails #1
      submit(/ยืนยันการย้ายออก/);
      await waitFor(() => expect(screen.getByText(/บันทึกบางส่วนแล้ว แต่ยังไม่ครบ.*Lead temporary timeout/i)).toBeInTheDocument());
      expect(onSaved).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
      expect(alertSpy).not.toHaveBeenCalled();
      expect(plotStepReads).toBe(1);
      expect(plotStepUpdates).toBe(0);

      // Attempt 2 (Retry #1 - C2): Lead step fails #2; Plot step must NOT be re-run (C5)
      submit(/ยืนยันการย้ายออก/);
      await waitFor(() => expect(screen.getByText(/บันทึกบางส่วนแล้ว แต่ยังไม่ครบ.*Lead temporary timeout/i)).toBeInTheDocument());
      expect(plotStepReads).toBe(1);
      expect(plotStepUpdates).toBe(0);
      expect(alertSpy).not.toHaveBeenCalled();

      // Attempt 3 (Retry #2 - C1, C2, C5, C7): Lead step succeeds; alert MUST NOT claim plot was released to Available!
      submit(/ยืนยันการย้ายออก/);
      await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
      expect(onSaved).toHaveBeenCalledOnce();
      expect(plotStepReads).toBe(1); // C5: Plot step was NOT re-run
      expect(plotStepUpdates).toBe(0);
      expect(plotRow.sale_status).toBe('Rented');
      expect(contractNewC2.status).toBe('Active');
      expect(leadRow.active_rental_contract_id).toBe('contract-2');
      expect(alertSpy).toHaveBeenCalledOnce();
      expect(String(alertSpy.mock.calls[0][0])).not.toMatch(/กลับมาเป็นแปลงว่าง/);
      expect(String(alertSpy.mock.calls[0][0])).toMatch(/ยังคงสถานะปัจจุบันเนื่องจากมีสัญญาหรือผู้ถือสิทธิ์อื่นอยู่/);
      unmount();

      // C4: Plot was ALREADY Available (sale_status: 'Available', has_customer: false) before move-out -> alert must NOT claim another holder holds it!
      contractOld.status = 'Active';
      competingContracts = [];
      plotRow.sale_status = 'Available';
      plotRow.has_customer = false;
      plotRow.current_tenant_name = null as any;
      plotRow.customer_name = null as any;
      leadRow.active_rental_contract_id = 'contract-old';
      alertSpy.mockClear();

      const onSavedAvail = vi.fn();
      const onCloseAvail = vi.fn();
      render(<RentalActionModal isOpen={true} contractId="contract-old" onClose={onCloseAvail} onSaved={onSavedAvail} lead={leadRow as any} user={user} />);
      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());

      fireEvent.click(screen.getByRole('button', { name: /3. สิ้นสุดสัญญา/ }));
      submit(/ยืนยันการย้ายออก/);

      await waitFor(() => expect(onCloseAvail).toHaveBeenCalledOnce());
      expect(onSavedAvail).toHaveBeenCalledOnce();
      expect(plotStepUpdates).toBe(0);
      expect(alertSpy).toHaveBeenCalledOnce();
      expect(String(alertSpy.mock.calls[0][0])).not.toMatch(/มีสัญญาหรือผู้ถือสิทธิ์อื่นอยู่/);
      expect(String(alertSpy.mock.calls[0][0])).toMatch(/แปลงว่าง/);
      alertSpy.mockRestore();
    });
  });

});
