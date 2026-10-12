import React, { StrictMode, type PropsWithChildren } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SalesDashboardExcelStyle from '../SalesDashboardExcelStyle';

const mocks = vi.hoisted(() => ({
  from: vi.fn(), rpc: vi.fn(),
  auth: { getSession: vi.fn(), onAuthStateChange: vi.fn() },
}));
vi.mock('@/lib/supabase', () => ({ supabase: mocks }));
vi.mock('../WaitingForTransferDetails', () => ({ default: () => null }));
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: PropsWithChildren) => <div>{children}</div>,
  ComposedChart: ({ children }: PropsWithChildren) => <div>{children}</div>,
  CartesianGrid: () => null, XAxis: () => null, YAxis: () => null,
  Tooltip: () => null, Legend: () => null, Area: () => null,
  Line: () => null, Bar: () => null, LabelList: () => null,
}));

const projects = [{ name: 'Project A', is_closed: false }, { name: 'Project B', is_closed: false }];
const plots = projects.map((project, index) => ({
  id: `P${index}`, plot_name: `Plot ${index}`, project_name: project.name, selling_price: 3000000,
}));
const sales = plots.map(plot => ({
  saleId: `S${plot.id}`, plotId: plot.id, plotName: plot.plot_name, projectName: plot.project_name,
  customerName: `Customer ${plot.id}`, stage: 'transferred', salePrice: 3000000,
  bookedAt: '2026-01-01', transferredAt: '2026-02-01',
}));
const tables: Record<string, unknown[]> = { plots, projects, house_types: [], leads: [] };
type TableResponse = { data: unknown[]; error: null };

function query(response: Promise<TableResponse>) {
  return {
    select: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(),
    range: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
    then: response.then.bind(response),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(accept => { resolve = accept; });
  return { promise, resolve };
}

function expectOneLoad() {
  expect(mocks.from).toHaveBeenCalledTimes(4);
  expect(mocks.rpc).toHaveBeenCalledTimes(6);
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.from.mockImplementation((table: string) => query(Promise.resolve({ data: tables[table] || [], error: null })));
  mocks.rpc.mockImplementation((name: string, params: { p_project_name: string }) => Promise.resolve({
    data: name === 'crm_v2_project_sales'
      ? { rows: sales.filter(sale => sale.projectName === params.p_project_name), hasMore: false }
      : name === 'crm_v2_excel_booking_amounts' ? { rows: [] }
      : { legacyVisits: [], completedVisits: [], unassignedLegacyVisits: [] },
    error: null,
  }));
});
afterEach(cleanup);

describe('Sales Dashboard activation and retained state', () => {
  it('makes no table or RPC requests until the dashboard is opened', async () => {
    const { rerender } = render(<SalesDashboardExcelStyle isActive={false} />);
    rerender(<SalesDashboardExcelStyle isActive={false} project={{ name: 'Project B' }} />);
    await act(async () => { await Promise.resolve(); });
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();

    rerender(<SalesDashboardExcelStyle isActive project={{ name: 'Project B' }} />);
    await screen.findByText(/Monthly Sale Report/);
    expectOneLoad();
    expect(screen.getByRole('combobox', { name: 'เลือกโครงการ' })).toHaveValue('Project B');
  });

  it('retains date, project filter and search while refreshing metrics on reopening', async () => {
    const { container, rerender } = render(<SalesDashboardExcelStyle isActive project={{ name: 'Project A' }} />);
    await screen.findByText(/Monthly Sale Report/);
    const date = container.querySelector('input[type="date"]')!;
    fireEvent.change(date, { target: { value: '2026-02-28' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'เลือกโครงการ' }), { target: { value: 'Project B' } });
    fireEvent.change(screen.getByPlaceholderText('ค้นหาชื่อลูกค้า, แปลง, โครงการ...'), { target: { value: 'Customer P1' } });
    expectOneLoad();
    const before = container.innerHTML;

    rerender(<SalesDashboardExcelStyle isActive={false} project={{ name: 'Project A' }} />);
    rerender(<SalesDashboardExcelStyle isActive project={{ name: 'Project A' }} />);
    await screen.findByText(/Monthly Sale Report/);
    expect(container.innerHTML).toBe(before);
    expect(mocks.from).toHaveBeenCalledTimes(8);
    expect(mocks.rpc).toHaveBeenCalledTimes(12);
  });

  it('shares a pending load while hidden and refreshes the completed result on reopening', async () => {
    const pending = deferred<TableResponse>();
    mocks.from.mockImplementation((table: string) => query(table === 'plots'
      ? pending.promise : Promise.resolve({ data: tables[table] || [], error: null })));
    const { rerender } = render(<SalesDashboardExcelStyle isActive />);
    rerender(<SalesDashboardExcelStyle isActive={false} />);
    rerender(<SalesDashboardExcelStyle isActive />);
    rerender(<SalesDashboardExcelStyle isActive={false} />);
    expect(mocks.from).toHaveBeenCalledTimes(4);
    await act(async () => { pending.resolve({ data: plots, error: null }); });
    await screen.findByText(/Monthly Sale Report/);
    rerender(<SalesDashboardExcelStyle isActive />);
    await screen.findByText(/Monthly Sale Report/);
    expect(mocks.from).toHaveBeenCalledTimes(8);
    expect(mocks.rpc).toHaveBeenCalledTimes(12);
  });

  it('defers a real project change while hidden and refreshes once on the next opening', async () => {
    const { rerender } = render(<SalesDashboardExcelStyle isActive project={{ name: 'Project A' }} />);
    await screen.findByText(/Monthly Sale Report/);
    rerender(<SalesDashboardExcelStyle isActive={false} project={{ name: 'Project B' }} />);
    expectOneLoad();
    rerender(<SalesDashboardExcelStyle isActive project={{ name: 'Project B' }} />);
    await screen.findByText(/Monthly Sale Report/);
    expect(mocks.from).toHaveBeenCalledTimes(8);
    expect(mocks.rpc).toHaveBeenCalledTimes(12);
    expect(screen.getByRole('combobox', { name: 'เลือกโครงการ' })).toHaveValue('Project B');
  });

  it('ignores a previous project response that finishes after the newer project load', async () => {
    const pending = deferred<TableResponse>();
    let plotRequests = 0;
    mocks.from.mockImplementation((table: string) => query(table === 'plots' && ++plotRequests === 1
      ? pending.promise : Promise.resolve({ data: tables[table] || [], error: null })));
    const { rerender } = render(<SalesDashboardExcelStyle isActive project={{ name: 'Project A' }} />);
    rerender(<SalesDashboardExcelStyle isActive project={{ name: 'Project B' }} />);
    await screen.findByText(/Monthly Sale Report/);
    expect(mocks.rpc).toHaveBeenCalledTimes(6);
    await act(async () => { pending.resolve({ data: [], error: null }); });
    expect(screen.getByText(/Monthly Sale Report/)).toBeInTheDocument();
    expect(mocks.rpc).toHaveBeenCalledTimes(6);
    expect(screen.getByRole('combobox', { name: 'เลือกโครงการ' })).toHaveValue('Project B');
  });

  it('does not start follow-up RPCs after the dashboard is unmounted', async () => {
    const pending = deferred<TableResponse>();
    mocks.from.mockImplementation((table: string) => query(table === 'plots'
      ? pending.promise : Promise.resolve({ data: tables[table] || [], error: null })));
    const { unmount } = render(<SalesDashboardExcelStyle isActive />);
    unmount();
    await act(async () => { pending.resolve({ data: plots, error: null }); });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('refreshes changed sales on a data revision without resetting date or search', async () => {
    const { container, rerender } = render(<SalesDashboardExcelStyle isActive dataRevision={0} />);
    await screen.findByText(/Monthly Sale Report/);
    fireEvent.change(container.querySelector('input[type="date"]')!, { target: { value: '2026-02-28' } });
    fireEvent.change(screen.getByPlaceholderText('ค้นหาชื่อลูกค้า, แปลง, โครงการ...'), { target: { value: 'Customer P0' } });
    mocks.rpc.mockImplementation((name: string, params: { p_project_name: string }) => Promise.resolve({
      data: name === 'crm_v2_project_sales'
        ? { rows: sales.filter(sale => sale.projectName === params.p_project_name).map(sale => ({ ...sale, salePrice: 4321000 })), hasMore: false }
        : name === 'crm_v2_excel_booking_amounts' ? { rows: [] }
        : { legacyVisits: [], completedVisits: [], unassignedLegacyVisits: [] },
      error: null,
    }));
    rerender(<SalesDashboardExcelStyle isActive dataRevision={1} />);
    await screen.findByText(/Monthly Sale Report/);
    expect(mocks.from).toHaveBeenCalledTimes(8);
    expect(mocks.rpc).toHaveBeenCalledTimes(12);
    expect(container.querySelector('input[type="date"]')).toHaveValue('2026-02-28');
    expect(screen.getByPlaceholderText('ค้นหาชื่อลูกค้า, แปลง, โครงการ...')).toHaveValue('Customer P0');
    expect(screen.getAllByText(/4,321,000/).length).toBeGreaterThan(0);
  });

  it('ignores an old pending response after a newer data revision finishes', async () => {
    const pending = deferred<TableResponse>();
    let plotRequests = 0;
    mocks.from.mockImplementation((table: string) => query(table === 'plots' && ++plotRequests === 1
      ? pending.promise : Promise.resolve({ data: tables[table] || [], error: null })));
    const { rerender } = render(<SalesDashboardExcelStyle isActive dataRevision={0} />);
    rerender(<SalesDashboardExcelStyle isActive dataRevision={1} />);
    await screen.findByText(/Monthly Sale Report/);
    await act(async () => { pending.resolve({ data: [], error: null }); });
    expect(screen.getByText(/Monthly Sale Report/)).toBeInTheDocument();
    expect(mocks.rpc).toHaveBeenCalledTimes(6);
  });

  it('does not duplicate requests under React Strict Mode', async () => {
    render(<StrictMode><SalesDashboardExcelStyle isActive /></StrictMode>);
    await screen.findByText(/Monthly Sale Report/);
    expectOneLoad();
  });

  it('can retry a failed initial load on the next opening', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.from.mockImplementationOnce(() => { throw new Error('temporary failure'); });
    try {
      const { rerender } = render(<SalesDashboardExcelStyle isActive />);
      expect(await screen.findByRole('alert')).toHaveTextContent('โหลดรายงานไม่สำเร็จ');
      rerender(<SalesDashboardExcelStyle isActive={false} />);
      rerender(<SalesDashboardExcelStyle isActive />);
      await screen.findByText(/Monthly Sale Report/);
      await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(6));
    } finally {
      log.mockRestore();
    }
  });

  it('retries a failed load using the visible retry button', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.from.mockImplementationOnce(() => { throw new Error('temporary failure'); });
    try {
      render(<SalesDashboardExcelStyle isActive />);
      expect(await screen.findByRole('alert')).toHaveTextContent('โหลดรายงานไม่สำเร็จ');
      fireEvent.click(screen.getByRole('button', { name: 'ลองใหม่' }));
      await screen.findByText(/Monthly Sale Report/);
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    } finally { log.mockRestore(); }
  });

  it('keeps the dashboard cache and filters through the actual app navigation skeleton', async () => {
    const noop = vi.fn();
    const appData = {
      ...Object.fromEntries([
        'projects', 'houseTypes', 'taskTemplates', 'plots', 'contractors', 'allUsers',
        'assignments', 'defects', 'defectUpdates', 'notifications', 'allUpdatesRecord',
        'materialRequests', 'materialReceipts', 'inspectionQueueView', 'plotStatuses',
        'plotOverallStatuses', 'qcSePerformance',
      ].map(key => [key, []])),
      loading: false, schedules: {}, latestUpdatesMap: {}, taskDates: {},
      fetchAllData: noop, fetchPlotDetails: noop, fetchOwnerAnalyticsData: noop,
    };
    mocks.auth.getSession.mockResolvedValue({
      data: { session: { user: { user_metadata: { username: 'Test admin', role: 'Admin' } } } }, error: null,
    });
    mocks.auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: noop } } });
    vi.doMock('@/hooks/useBuildTrackData', () => ({ useBuildTrackData: () => appData }));
    vi.doMock('next/dynamic', () => ({
      default: (loader: () => unknown) => loader.toString().includes('SalesDashboardExcelStyle')
        ? SalesDashboardExcelStyle : () => null,
    }));
    vi.doMock('@/components/Sidebar', () => ({
      default: ({ setView }: { setView: (view: string) => void }) => <>
        <button onClick={() => setView('sales-dashboard-excel')}>Open sales test</button>
        <button onClick={() => setView('dashboard')}>Open overview test</button>
      </>,
    }));
    try {
      const { default: ConstructionApp } = await import('../../../app/page');
      const { container } = render(<>
        <style>{'.hidden { display: none; }'}</style>
        <ConstructionApp />
      </>);
      const openSales = await screen.findByRole('button', { name: 'Open sales test' });
      expect(mocks.from).not.toHaveBeenCalled();
      fireEvent.click(openSales);
      await screen.findByText(/Monthly Sale Report/);
      const date = container.querySelector('input[type="date"]')!;
      fireEvent.change(date, { target: { value: '2026-02-28' } });
      const search = screen.getByPlaceholderText('ค้นหาชื่อลูกค้า, แปลง, โครงการ...');
      fireEvent.change(search, { target: { value: 'Customer P0' } });
      expect(mocks.from).toHaveBeenCalledTimes(4);

      fireEvent.click(screen.getByRole('button', { name: 'Open overview test' }));
      expect(search).toBeInTheDocument();
      expect(search).not.toBeVisible();
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 120)); });
      fireEvent.click(screen.getByRole('button', { name: 'Open sales test' }));
      const reopenedSearch = await screen.findByPlaceholderText('ค้นหาชื่อลูกค้า, แปลง, โครงการ...');
      await waitFor(() => expect(reopenedSearch).toBeVisible());
      expect(reopenedSearch).toHaveValue('Customer P0');
      expect(container.querySelector('input[type="date"]')).toHaveValue('2026-02-28');
      expect(mocks.from).toHaveBeenCalledTimes(8);
      expect(mocks.rpc.mock.calls.filter(([name]) => name.startsWith('crm_v2_'))).toHaveLength(12);
    } finally {
      cleanup();
      vi.doUnmock('@/hooks/useBuildTrackData');
      vi.doUnmock('next/dynamic');
      vi.doUnmock('@/components/Sidebar');
      localStorage.removeItem('buildtrack_last_active');
      sessionStorage.removeItem('buildtrack_initial_landed');
    }
  });
});
