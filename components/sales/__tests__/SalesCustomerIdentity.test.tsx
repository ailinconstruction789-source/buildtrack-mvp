import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('@/lib/sales/fetchWithoutLimit', () => ({ fetchSalesWithoutLimit: mocks.read }));
vi.mock('@/hooks/useSalesStaffOptions', () => ({ useSalesStaffOptions: () => [] }));
vi.mock('@/lib/supabase', () => ({ supabase: {
  from: () => { const response = Promise.resolve({ data: [{ id: 1, username: 'Sales A', role: 'Sales' }], error: null });
    const q = { select: () => q, eq: () => q, order: () => q, in: () => q, then: response.then.bind(response), maybeSingle: async () => ({ data: null, error: null }) }; return q; },
  rpc: async () => ({ data: { rows: [] }, error: null }),
} }));
vi.mock('../DailyVisitsScheduleView', () => ({ default: () => null }));
vi.mock('../SalesMap', () => ({ default: ({ leads }: { leads: { id: string; name: string; phone: string; leadId: string | null }[] }) =>
  <ul aria-label="fixture map records">{leads.map(l => <li key={l.id}>{JSON.stringify(l)}</li>)}</ul> }));
vi.mock('@/lib/sales/sampleHouseHelper', () => ({ isSampleHouse: () => false, isPlotEligibleForSampleHouse: () => false, fetchTodayInspectionStatus: async () => null }));
import Hub from '../MySalesWorkspace';
import Kanban from '../SalesKanban';
const user = { id: 'U1', username: 'Sales A', role: 'Sales' };
const plot = { id: 'P1', plot_name: '1', project_name: 'Fixture project', sale_status: 'transferred', customer_name: 'Shared name', current_tenant_name: 'Shared name', selling_price: 3000000 };
const lead = { id: 'L1', customer_name: 'Shared name', phone: 'lead-phone', project_name: plot.project_name, status: 'Visit', interested_plot_id: plot.id, sales_owner: user.username, created_at: '2026-10-09T01:00:00Z' };
const sale = { id: 'S1', customer_name: 'Shared name', phone: 'sale-phone', agent_name: user.username, lead_id: null, plot_id: plot.id, plots: plot, contract_status: 'Transferred', crm_stage: 'transferred', created_at: '2026-10-09T01:00:00Z' };
beforeEach(() => { vi.clearAllMocks(); mocks.read.mockImplementation(async (table: string) => table === 'sales' ? [sale] : table === 'plots' ? [plot] : table === 'leads' ? [lead] : []); });
afterEach(cleanup);
describe('both entry points keep identities separate until an exact relationship exists', () => {
  it('does not turn a new Lead into a transferred buyer or tenant just because a name or interested plot matches', async () => {
    render(<Hub currentUser={user} projects={[{ name: plot.project_name }]} loadStartupData={async () => ({ leads: [lead], plots: [plot] })} />);
    await screen.findAllByText('Shared name');
    const rows = screen.getAllByText('Shared name').map(cell => cell.closest('tr')).filter(Boolean) as HTMLTableRowElement[];
    const original = rows.find(row => row.textContent?.includes('lead-phone'))!;
    expect(original).toBeTruthy(); expect(within(original).getByRole('button', { name: 'ติดตาม' })).toBeEnabled();
    expect(original.textContent).not.toContain('โอนกรรมสิทธิ์แล้ว'); expect(original.textContent).not.toContain('สัญญาเช่า / เช่าออม');
    expect(rows.some(row => row.textContent?.includes('sale-phone'))).toBe(true);
  });
  it('keeps same-name Lead and CRM sale in Project Map, without copying the new phone into the old deal', async () => {
    render(<Kanban project={{ name: plot.project_name }} user={user} initialTab="map" />);
    const list = await screen.findByRole('list', { name: 'fixture map records' });
    const records = within(list).getAllByRole('listitem').map(item => JSON.parse(item.textContent!));
    expect(records.find(row => row.id === 'L1')).toMatchObject({ leadId: 'L1', phone: 'lead-phone' });
    expect(records.find(row => row.id === 'S1')).toMatchObject({ leadId: null, phone: 'sale-phone' });
  });
  it('shows CRM name/phone from the verified relationship when the sale table has neither field', async () => {
    const crmSale = { id: 'S2', project_interest_id: 'I2', plot_id: plot.id, plots: plot, lead_id: null,
      contract_status: 'Reserved', crm_stage: 'booked', created_at: '2026-10-09T01:00:00Z',
      crm_interest: { id: 'I2', customer_id: 'C2', crm_customer: { id: 'C2', customer_name: 'Canonical CRM customer', phone: 'canonical-phone' } } };
    mocks.read.mockImplementation(async (table: string) => table === 'sales' ? [crmSale] : table === 'plots' ? [plot] : table === 'leads' ? [] : []);
    render(<Kanban project={{ name: plot.project_name }} user={user} initialTab="map" />);
    const list = await screen.findByRole('list', { name: 'fixture map records' });
    const record = JSON.parse(within(list).getByRole('listitem').textContent!);
    expect(record).toMatchObject({ id: 'S2', name: 'Canonical CRM customer', phone: 'canonical-phone', leadId: null });
  });
});
