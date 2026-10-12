import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DailyVisitsScheduleView from '../DailyVisitsScheduleView';
import SalesWorkspaceModeProvider from '../SalesWorkspaceModeProvider';
const mock = vi.hoisted(() => ({ read: vi.fn(), refresh: vi.fn(), central: vi.fn(), identity: vi.fn() }));
vi.mock('@/lib/sales/fetchWithoutLimit', () => ({ fetchSalesWithoutLimit: mock.read }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn(), rpc: vi.fn(), auth: { getSession: vi.fn() } } }));
vi.mock('@/lib/sales/centralClient', () => ({ centralApi: { read: mock.central, watchIdentity: mock.identity } }));
vi.mock('@/lib/sales/sampleHouseHelper', () => ({ isSampleHouse: () => false,
  fetchTodayInspectionStatus: async () => ({ status: 'pending', badgeLabel: 'pending', badgeColor: '', badgeBg: '' }),
  fetchTodayInspectionMap: async () => ({}) }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
beforeEach(() => { mock.identity.mockReturnValue(() => {}); mock.read.mockResolvedValue([]); });
describe('cutover native appointment scope', () => {
  it('keeps an empty authoritative cohort empty on mount and refresh', async () => {
    render(<DailyVisitsScheduleView canonicalData leads={[]} projects={[{ name: 'Project' }]} onRefresh={mock.refresh} />);
    await act(async () => {});
    fireEvent.click(screen.getByTitle('รีเฟรชข้อมูล'));
    expect(mock.refresh).toHaveBeenCalledOnce(); expect(mock.read).not.toHaveBeenCalled();
  });
  it('never treats imported CRM historical visits as native appointments', async () => {
    const day = `${new Date().getFullYear()}-10-01`;
    render(<DailyVisitsScheduleView canonicalData projects={[{ name: 'Project' }]} leads={[
      { id: 'crm-customer:not-a-lead', sourceKind: 'crm_customer', customer_name: 'Imported history', actual_visit_date: day },
      { id: 'native-id', customer_name: 'Future native visitor', actual_visit_date: day }
    ] as never} />);
    await act(async () => {});
    expect(screen.queryByText('Imported history')).not.toBeInTheDocument();
    expect(screen.getByText('Future native visitor')).toBeInTheDocument(); expect(mock.read).not.toHaveBeenCalled();
  });
  it('filters the direct app schedule by frozen IDs with one trusted metadata read', async () => {
    const day = `${new Date().getFullYear()}-10-01`;
    mock.central.mockResolvedValue({ sourceMembership: { active: true, revisionId: 'revision', originalLegacyLeadIds: ['old-lead'] } });
    mock.read.mockResolvedValue([{ id: 'old-lead', customer_name: 'Archived visitor', actual_visit_date: day },
      { id: 'future-lead', customer_name: 'Native future visitor', actual_visit_date: day }]);
    render(<SalesWorkspaceModeProvider mode="central"><DailyVisitsScheduleView projects={[{ name: 'Project' }]} /></SalesWorkspaceModeProvider>);
    expect(await screen.findByText('Native future visitor')).toBeInTheDocument();
    expect(screen.queryByText('Archived visitor')).not.toBeInTheDocument();
    expect(mock.central).toHaveBeenCalledOnce(); expect(mock.central.mock.lastCall?.[0]).toBe(0);
    expect(mock.read).toHaveBeenCalledWith('leads', expect.any(Object));
  });
  it('does not fall back to the old appointments when membership metadata is missing', async () => {
    mock.central.mockResolvedValue({}); mock.read.mockResolvedValue([{ id: 'old-lead', customer_name: 'Archived visitor', actual_visit_date: `${new Date().getFullYear()}-10-01` }]);
    render(<SalesWorkspaceModeProvider mode="central"><DailyVisitsScheduleView projects={[{ name: 'Project' }]} /></SalesWorkspaceModeProvider>);
    expect(await screen.findByRole('alert')).toHaveTextContent('โหลดรายการนัดหมายไม่สำเร็จ');
    expect(screen.queryByText('Archived visitor')).not.toBeInTheDocument();
  });
  it('clears a direct schedule on identity change and ignores the late previous scope', async () => {
    let finish!: (value: unknown) => void;
    mock.central.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
      .mockResolvedValue({ sourceMembership: { active: true, revisionId: 'new-revision', originalLegacyLeadIds: ['old-lead'] } });
    mock.read.mockResolvedValue([{ id: 'old-lead', customer_name: 'Archived visitor', actual_visit_date: `${new Date().getFullYear()}-10-01` }]);
    render(<SalesWorkspaceModeProvider mode="central"><DailyVisitsScheduleView projects={[{ name: 'Project' }]} /></SalesWorkspaceModeProvider>);
    await act(async () => { mock.identity.mock.lastCall?.[0](); });
    await act(async () => { finish({ sourceMembership: { active: true, revisionId: 'old-revision', originalLegacyLeadIds: [] } }); });
    expect(screen.queryByText('Archived visitor')).not.toBeInTheDocument();
  });
});
