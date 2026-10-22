import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RentalActionModal from '../RentalActionModal';
import RentalContractModal from '../RentalContractModal';
import SalesDealStatusModal from '../SalesDealStatusModal';
import { broadcastSalesSync, subscribeToSalesSync } from '@/lib/sales/salesSyncBroadcast';

type Query = {
  table: string;
  action: 'read' | 'insert' | 'update';
  payload?: Record<string, unknown> | Record<string, unknown>[];
  filters: [string, unknown][];
  columns?: string;
  single: boolean;
};
type Result = { data: unknown; error: { message: string } | null };

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
    return ok([{
      id: 'plot-1',
      plot_name: '1',
      project_name: 'Project',
      sale_status: 'Available',
      has_customer: false,
      current_tenant_name: null,
      lead_id: null
    }]);
  }
  if (q.table === 'leads') {
    if (q.filters.some(([key]) => key === 'interested_plot_id')) return ok([]);
    return ok(q.single ? lead : [lead]);
  }
  if (q.table === 'sales') {
    return ok([]);
  }
  if (q.table === 'rental_contracts') {
    if (q.filters.some(([key]) => key === 'lead_id')) return ok([]);
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
          return ok({
            id: 'plot-1',
            sale_status: 'Rented',
            has_customer: true,
            current_tenant_name: 'Somchai Jaidee'
          });
        }
        if (q.table === 'leads' && q.action === 'read' && q.single) {
          return ok({ id: 'lead-1', notes: 'Important VIP note' });
        }
        return defaultResult(q);
      };

      render(
        <RentalActionModal
          isOpen={true}
          contractId="contract-1"
          onClose={vi.fn()}
          lead={{ ...lead, notes: 'Important VIP note' } as any}
          user={user}
        />
      );

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
        if (q.table === 'leads' && q.action === 'read' && q.single) {
          return ok({ id: 'lead-1', notes: 'Existing VIP client notes' });
        }
        return defaultResult(q);
      };

      render(
        <RentalActionModal
          isOpen={true}
          contractId="contract-1"
          onClose={vi.fn()}
          lead={{ ...lead, notes: 'Existing VIP client notes' } as any}
          user={user}
        />
      );

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
          return ok({
            id: 'plot-1',
            sale_status: 'Rented',
            has_customer: true,
            current_tenant_name: 'Somchai Jaidee'
          });
        }
        if (q.table === 'leads' && q.action === 'read') {
          return fail('Network error reading lead notes');
        }
        return defaultResult(q);
      };

      render(
        <RentalActionModal
          isOpen={true}
          contractId="contract-1"
          onClose={vi.fn()}
          lead={{ ...lead, notes: 'Stale prop note' } as any}
          user={user}
        />
      );

      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());
      fireEvent.click(screen.getByRole('button', { name: /3. สิ้นสุดสัญญา/ }));
      submit(/ยืนยันการย้ายออก/);

      await waitFor(() => {
        expect(screen.getByText(/ไม่สามารถอ่านโน้ตล่าสุดของลูกค้าได้/i)).toBeInTheDocument();
      });

      // Zero updates to leads table!
      expect(writes('leads').length).toBe(0);
    });

    it('Finding E: stops and does not overwrite notes when reading fresh notes from database fails on renew', async () => {
      resolveQuery = q => {
        if (q.table === 'leads' && q.action === 'read') {
          return fail('Network error reading lead notes');
        }
        return defaultResult(q);
      };

      render(
        <RentalActionModal
          isOpen={true}
          contractId="contract-1"
          onClose={vi.fn()}
          lead={{ ...lead, notes: 'Stale prop note' } as any}
          user={user}
        />
      );

      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันเปลี่ยนเป็นซื้อแปลงนี้' })).toBeEnabled());
      fireEvent.click(screen.getByRole('button', { name: /2. ต่อสัญญาเช่า/ }));
      submit(/ยืนยันต่อสัญญาเช่า/);

      await waitFor(() => {
        expect(screen.getByText(/ไม่สามารถอ่านโน้ตล่าสุดของลูกค้าได้/i)).toBeInTheDocument();
      });

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
          if (plotReadCount === 1) {
            return ok([{ id: 'plot-1', plot_name: '1', project_name: 'Project', sale_status: 'Available', has_customer: false }]);
          }
          return ok([]);
        }
        return defaultResult(q);
      };

      render(
        <RentalContractModal
          isOpen={true}
          onClose={vi.fn()}
          lead={lead as any}
          plotId="plot-1"
          projectName="Project"
          user={user}
          salesOwners={salesOwners}
          defaultMode="contract"
        />
      );

      await waitFor(() => expect(screen.queryByText(/กำลังโหลดแปลง/i)).not.toBeInTheDocument());
      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันบันทึกสัญญาเช่า' })).toBeEnabled());
      submit(/ยืนยันบันทึกสัญญาเช่า/);

      await waitFor(() => {
        expect(screen.getByText(/ไม่พบแปลงที่ต้องการทำรายการ/i)).toBeInTheDocument();
      });

      expect(writes('rental_contracts').length).toBe(0);
      expect(writes('leads').length).toBe(0);
      expect(writes('plots').length).toBe(0);
    });

    it('stops with 0 mutations when fresh plot has mismatched project_name', async () => {
      let plotReadCount = 0;
      resolveQuery = q => {
        if (q.table === 'plots' && q.action === 'read') {
          plotReadCount++;
          if (plotReadCount === 1) {
            return ok([{ id: 'plot-1', plot_name: '1', project_name: 'Project', sale_status: 'Available', has_customer: false }]);
          }
          return ok([{ id: 'plot-1', plot_name: '1', project_name: 'DifferentProject', sale_status: 'Available', has_customer: false }]);
        }
        return defaultResult(q);
      };

      render(
        <RentalContractModal
          isOpen={true}
          onClose={vi.fn()}
          lead={lead as any}
          plotId="plot-1"
          projectName="Project"
          user={user}
          salesOwners={salesOwners}
          defaultMode="contract"
        />
      );

      await waitFor(() => expect(screen.queryByText(/กำลังโหลดแปลง/i)).not.toBeInTheDocument());
      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันบันทึกสัญญาเช่า' })).toBeEnabled());
      submit(/ยืนยันบันทึกสัญญาเช่า/);

      await waitFor(() => {
        expect(screen.getByText(/ข้อมูลโครงการของแปลงไม่ตรงกับที่เลือก/i)).toBeInTheDocument();
      });

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
          return ok([{
            id: 'plot-1',
            plot_name: '1',
            project_name: 'Project',
            sale_status: 'Available',
            has_customer: false
          }]);
        }
        if (q.table === 'rental_contracts' && q.action === 'read') {
          return ok([existingIncompleteContract]);
        }
        return defaultResult(q);
      };

      render(
        <RentalContractModal
          isOpen={true}
          onClose={vi.fn()}
          lead={lead as any}
          plotId="plot-1"
          projectName="Project"
          user={user}
          salesOwners={salesOwners}
          defaultMode="contract"
        />
      );

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
          return ok([{
            id: 'plot-1',
            plot_name: '1',
            project_name: 'Project',
            sale_status: 'Available',
            has_customer: false
          }]);
        }
        if (q.table === 'rental_contracts' && q.action === 'read') {
          return ok([existingIncompleteContract]);
        }
        return defaultResult(q);
      };

      render(
        <RentalContractModal
          isOpen={true}
          onClose={vi.fn()}
          lead={lead as any}
          plotId="plot-1"
          projectName="Project"
          user={user}
          salesOwners={salesOwners}
          defaultMode="contract"
        />
      );

      await waitFor(() => expect(screen.queryByText(/กำลังโหลดแปลง/i)).not.toBeInTheDocument());
      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันบันทึกสัญญาเช่า' })).toBeEnabled());

      const rentInput = screen.getByLabelText(/ค่าเช่าต่อเดือน/i);
      fireEvent.change(rentInput, { target: { value: '18000' } });

      submit(/ยืนยันบันทึกสัญญาเช่า/);

      await waitFor(() => {
        expect(screen.getByText(/เงื่อนไขสัญญาในฟอร์มขัดแย้งกับสัญญาเช่าเดิมที่บันทึกไว้/i)).toBeInTheDocument();
      });

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
          return ok([{
            id: 'plot-1',
            plot_name: '1',
            project_name: 'Project',
            sale_status: 'Available',
            has_customer: false
          }]);
        }
        if (q.table === 'rental_contracts' && q.action === 'read') {
          return ok([existingIncompleteContract]);
        }
        return defaultResult(q);
      };

      render(
        <RentalContractModal
          isOpen={true}
          onClose={vi.fn()}
          lead={lead as any}
          plotId="plot-1"
          projectName="Project"
          user={user}
          salesOwners={salesOwners}
          defaultMode="contract"
        />
      );

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
          return ok([{
            id: 'plot-1',
            plot_name: '1',
            project_name: 'Project',
            sale_status: 'Available',
            has_customer: false
          }]);
        }
        if (q.table === 'rental_contracts' && q.action === 'read') {
          return ok([existingIncompleteContract]);
        }
        return defaultResult(q);
      };

      render(
        <RentalContractModal
          isOpen={true}
          onClose={vi.fn()}
          lead={leadAlreadyRented as any}
          plotId="plot-1"
          projectName="Project"
          user={user}
          salesOwners={salesOwners}
          defaultMode="contract"
        />
      );

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
          return ok([{
            id: 'plot-1',
            plot_name: '1',
            project_name: 'Project',
            sale_status: 'Rented',
            has_customer: true,
            current_tenant_name: 'Somchai Jaidee'
          }]);
        }
        if (q.table === 'rental_contracts' && q.action === 'read') {
          return ok([existingCompleteContract]);
        }
        return defaultResult(q);
      };

      render(
        <RentalContractModal
          isOpen={true}
          onClose={vi.fn()}
          lead={leadAlreadyFullyRented as any}
          plotId="plot-1"
          projectName="Project"
          user={user}
          salesOwners={salesOwners}
          defaultMode="contract"
        />
      );

      await waitFor(() => expect(screen.queryByText(/กำลังโหลดแปลง/i)).not.toBeInTheDocument());
      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันบันทึกสัญญาเช่า' })).toBeEnabled());
      submit(/ยืนยันบันทึกสัญญาเช่า/);

      await waitFor(() => {
        expect(screen.getByText(/ลูกค้ามีสัญญาเช่าที่ใช้งานอยู่แล้ว กรุณาจัดการสัญญาเดิม/i)).toBeInTheDocument();
      });

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
          return ok([{
            id: 'plot-1',
            plot_name: '1',
            project_name: 'Project',
            sale_status: 'Available',
            has_customer: false
          }]);
        }
        if (q.table === 'rental_contracts' && q.action === 'read') {
          return ok([otherPlotContract]);
        }
        return defaultResult(q);
      };

      render(
        <RentalContractModal
          isOpen={true}
          onClose={vi.fn()}
          lead={lead as any}
          plotId="plot-1"
          projectName="Project"
          user={user}
          salesOwners={salesOwners}
          defaultMode="contract"
        />
      );

      await waitFor(() => expect(screen.queryByText(/กำลังโหลดแปลง/i)).not.toBeInTheDocument());
      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันบันทึกสัญญาเช่า' })).toBeEnabled());
      submit(/ยืนยันบันทึกสัญญาเช่า/);

      await waitFor(() => {
        expect(screen.getByText(/ลูกค้ามีสัญญาเช่าที่ใช้งานอยู่แล้วในแปลงอื่น/i)).toBeInTheDocument();
      });

      expect(writes('rental_contracts').length).toBe(0);
    });
  });

  // Issue D: Sales Cancellation Scoping & Error Handling
  describe('Issue D: Sales Cancellation Scoping & Error Handling', () => {
    it('scopes sales cancellation to both lead_id and plot_id', async () => {
      render(
        <RentalContractModal
          isOpen={true}
          onClose={vi.fn()}
          lead={lead as any}
          plotId="plot-1"
          projectName="Project"
          user={user}
          salesOwners={salesOwners}
          defaultMode="contract"
        />
      );

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
        if (q.table === 'sales' && q.action === 'update') {
          return fail('Sales cancellation constraint violation');
        }
        return defaultResult(q);
      };

      render(
        <RentalContractModal
          isOpen={true}
          onClose={vi.fn()}
          lead={lead as any}
          plotId="plot-1"
          projectName="Project"
          user={user}
          salesOwners={salesOwners}
          defaultMode="contract"
        />
      );

      await waitFor(() => expect(screen.queryByText(/กำลังโหลดแปลง/i)).not.toBeInTheDocument());
      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันบันทึกสัญญาเช่า' })).toBeEnabled());
      submit(/ยืนยันบันทึกสัญญาเช่า/);

      await waitFor(() => {
        expect(screen.getByText(/Sales cancellation constraint violation/i)).toBeInTheDocument();
      });
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
            return ok([{
              id: 'plot-1',
              plot_name: '1',
              project_name: 'Project',
              sale_status: 'Booked',
              has_customer: true,
              customer_name: 'Somchai Jaidee',
              lead_id: 'lead-1'
            }]);
          }
          return ok([{
            id: 'plot-1',
            plot_name: '1',
            project_name: 'Project',
            sale_status: 'Booked',
            has_customer: true,
            customer_name: 'Somchai Jaidee',
            lead_id: 'lead-1'
          }]);
        }
        return defaultResult(q);
      };

      render(
        <RentalContractModal
          isOpen={true}
          onClose={vi.fn()}
          lead={differentLeadWithSameName as any}
          plotId="plot-1"
          projectName="Project"
          user={user}
          salesOwners={salesOwners}
          defaultMode="contract"
        />
      );

      await waitFor(() => expect(screen.queryByText(/กำลังโหลดแปลง/i)).not.toBeInTheDocument());
      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันบันทึกสัญญาเช่า' })).toBeEnabled());
      submit(/ยืนยันบันทึกสัญญาเช่า/);

      await waitFor(() => {
        expect(screen.getByText(/แปลงนี้ถูกจองหรือมีลูกค้าอื่นถือสิทธิ์อยู่แล้ว/i)).toBeInTheDocument();
      });

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
          return ok([{
            id: 'plot-1',
            plot_name: '1',
            project_name: 'Project',
            sale_status: 'Booked',
            has_customer: true,
            customer_name: 'Somchai Jaidee'
          }]);
        }
        if (q.table === 'leads' && q.action === 'read') {
          return ok([{ id: 'lead-1', customer_name: 'Somchai Jaidee' }]);
        }
        return defaultResult(q);
      };

      render(
        <RentalContractModal
          isOpen={true}
          onClose={vi.fn()}
          lead={differentLeadWithSameName as any}
          plotId="plot-1"
          projectName="Project"
          user={user}
          salesOwners={salesOwners}
          defaultMode="contract"
        />
      );

      await waitFor(() => expect(screen.queryByText(/กำลังโหลดแปลง/i)).not.toBeInTheDocument());
      await waitFor(() => expect(screen.getByRole('button', { name: 'ยืนยันบันทึกสัญญาเช่า' })).toBeEnabled());
      submit(/ยืนยันบันทึกสัญญาเช่า/);

      await waitFor(() => {
        expect(screen.getByText(/แปลงนี้ถูกจองหรือมีลูกค้าอื่นถือสิทธิ์อยู่แล้ว/i)).toBeInTheDocument();
      });

      expect(writes('rental_contracts').length).toBe(0);
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
        if (q.action === 'update' || q.action === 'insert') {
          return ok({ id: 'saved-id' });
        }
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

      await waitFor(() => {
        expect(savedCalled).toBe(true);
      });

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
});
