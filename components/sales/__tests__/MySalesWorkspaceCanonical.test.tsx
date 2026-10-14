import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MySalesWorkspace from '../MySalesWorkspace';
import SalesWorkspaceModeProvider from '../SalesWorkspaceModeProvider';
const mock = vi.hoisted(() => ({ canonical: vi.fn(), read: vi.fn(), from: vi.fn() }));
vi.mock('@/lib/sales/canonicalWorkspaceClient', () => ({ canonicalWorkspaceApi: { read: mock.canonical, watchIdentity: vi.fn() } }));
vi.mock('@/lib/sales/fetchWithoutLimit', () => ({ fetchSalesWithoutLimit: mock.read }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: mock.from } }));
vi.mock('next/dynamic', () => ({ default: () => ({ lead, customer }: { lead?: { leadId?: string; saleId?: string }; customer?: unknown }) => lead ? <div data-testid="inline-deal">{lead.leadId}:{lead.saleId}</div> : customer ? <p>Inline follow-up</p> : null }));
const currentUser = { id: 'user-a', username: 'PIEW', role: 'Sales' };
const project = { name: 'Project' };
const native = { id: 'lead-a', customer_name: 'Native Customer', project_name: 'Project', sales_owner: 'PIEW', status: 'New', created_at: '2026-10-01' };
const plot = { id: 'plot-a', project_name: 'Project', plot_name: '1' };
beforeEach(() => {
  vi.clearAllMocks();
  mock.read.mockImplementation(async (table: string) => table === 'leads' ? [native] : table === 'plots' ? [plot] : []);
  mock.from.mockReturnValue({ select: async () => ({ data: [{ id: 'user-a', username: 'PIEW', role: 'Sales' }], error: null }) });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe('restored Lead workflow after customer cleanup', () => {
  it.each(['central', 'blocked'] as const)('uses shared native startup data despite stale %s provider mode', async mode => {
    const loader = vi.fn().mockResolvedValue({ leads: [native], plots: [plot] });
    render(<SalesWorkspaceModeProvider mode={mode}><MySalesWorkspace currentUser={currentUser} projects={[project]} loadStartupData={loader} /></SalesWorkspaceModeProvider>);
    expect(await screen.findByText('Native Customer')).toBeInTheDocument();
    expect(loader).toHaveBeenCalledWith({ fresh: false });
    expect(mock.read.mock.calls.map(call => call[0])).toEqual(['sales']);
    expect(mock.canonical).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'ติดตาม' }));
    expect(screen.getByText('Inline follow-up')).toBeInTheDocument();
  });
  it('opens booked Lead updates inline with exact Lead and Sale IDs', async () => {
    mock.read.mockImplementation(async (table: string) => table === 'leads' ? [{ ...native, status: 'Booked', booking_date: '2026-10-01' }]
      : table === 'plots' ? [plot] : [{ id: 'sale-a', lead_id: 'lead-a', plot_id: 'plot-a', contract_status: 'Reserved', crm_stage: 'booked', plots: plot, booked_at: '2026-10-01', agent_name: 'PIEW', sale_price: 3200000 }]);
    render(<MySalesWorkspace currentUser={currentUser} projects={[project]} />);
    fireEvent.click(await screen.findByRole('button', { name: /วางจองแล้ว/ }));
    await screen.findByText('Native Customer');
    fireEvent.click(screen.getByRole('button', { name: /อัปเดตสถานะ/ }));
    expect(screen.getByTestId('inline-deal')).toHaveTextContent('lead-a:sale-a');
    expect(mock.canonical).not.toHaveBeenCalled();
  });
  it('finishes a valid empty native load without waiting for imported-cohort pages', async () => {
    mock.read.mockResolvedValue([]);
    render(<MySalesWorkspace currentUser={currentUser} projects={[project]} />);
    await waitFor(() => expect(screen.getByText('ไม่พบข้อมูลลูกค้าตามเงื่อนไขที่เลือก')).toBeInTheDocument());
    expect(mock.canonical).not.toHaveBeenCalled();
  });
});
