import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SalesKanban from '../SalesKanban';
const mock = vi.hoisted(() => ({ read: vi.fn(), canonical: vi.fn(), schedule: vi.fn(), modal: vi.fn() }));
vi.mock('@/lib/sales/fetchWithoutLimit', () => ({ fetchSalesWithoutLimit: mock.read }));
vi.mock('@/lib/sales/canonicalWorkspaceClient', () => ({ canonicalWorkspaceApi: { read: mock.canonical, watchIdentity: vi.fn() } }));
vi.mock('@/hooks/useSalesStaffOptions', () => ({ useSalesStaffOptions: () => [] }));
vi.mock('../DailyVisitsScheduleView', () => ({ default: (props: unknown) => { mock.schedule(props); return null; } }));
vi.mock('../SalesDealStatusModal', () => ({ default: (props: { lead: unknown }) => { mock.modal(props); return <p>Inline sale detail</p>; } }));
vi.mock('@/lib/sales/sampleHouseHelper', () => ({ isSampleHouse: () => false, isPlotEligibleForSampleHouse: () => false, toggleSampleHouse: vi.fn(), fetchTodayInspectionStatus: async () => null }));
vi.mock('@/lib/supabase', () => ({ supabase: {
  from: () => { const result = Promise.resolve({ data: [], error: null }); const q = { select: () => q, eq: () => q, order: () => q, in: () => q, maybeSingle: async () => ({ data: null, error: null }), then: result.then.bind(result) }; return q; },
  rpc: async () => ({ data: { rows: [] }, error: null }), auth: { getSession: async () => ({ data: { session: null } }) },
} }));
const plot = { id: 'plot-a', project_name: 'Project', plot_name: '1' };
const lead = { id: 'lead-a', customer_name: 'Native Customer', project_name: 'Project', status: 'Visit', phone: '0812345678' };
beforeEach(() => {
  vi.clearAllMocks();
  mock.read.mockImplementation(async (table: string) => table === 'plots' ? [plot] : table === 'leads' ? [lead] : []);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe('restored Project Map native source', () => {
  it('ignores a stale imported-cohort prop and sends native customers to the original appointment workflow', async () => {
    render(<SalesKanban canonicalData project={{ name: 'Project' }} initialTab="daily_visits" />);
    await waitFor(() => expect(mock.schedule.mock.lastCall?.[0].leads).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'lead-a' })])));
    expect(mock.schedule.mock.lastCall?.[0].canonicalData).toBeUndefined();
    expect(mock.canonical).not.toHaveBeenCalled();
    expect(mock.read.mock.calls.map(call => call[0])).toContain('sales');
  });
  it('opens booked native customers inline with the actual linked Lead and Sale', async () => {
    mock.read.mockImplementation(async (table: string) => table === 'plots' ? [plot] : table === 'leads' ? [lead]
      : [{ id: 'sale-a', lead_id: 'lead-a', plot_id: 'plot-a', contract_status: 'Reserved', sale_price: 3200000 }]);
    render(<SalesKanban canonicalData project={{ name: 'Project' }} initialTab="booked" user={{ id: 'user-a', role: 'Sales' }} />);
    fireEvent.click(await screen.findByText('Native Customer'));
    expect(screen.getByText('Inline sale detail')).toBeInTheDocument();
    expect(mock.modal.mock.lastCall?.[0].lead).toMatchObject({ leadId: 'lead-a', saleId: 'sale-a' });
    expect(mock.canonical).not.toHaveBeenCalled();
  });
});
