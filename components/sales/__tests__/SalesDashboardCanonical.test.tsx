import React, { type PropsWithChildren } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SalesDashboardExcelStyle from '../SalesDashboardExcelStyle';
import SalesWorkspaceModeProvider from '../SalesWorkspaceModeProvider';
const mock = vi.hoisted(() => ({ report: vi.fn(), identity: vi.fn(), from: vi.fn(), raw: vi.fn(), rpc: vi.fn(), chart: vi.fn() }));
vi.mock('@/lib/sales/excelReportClient', () => ({ excelReportApi: { read: mock.report, watchIdentity: mock.identity } }));
vi.mock('@/lib/sales/fetchWithoutLimit', () => ({ fetchSalesWithoutLimit: mock.raw }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: mock.from, rpc: mock.rpc } }));
vi.mock('../WaitingForTransferDetails', () => ({ default: () => null }));
vi.mock('recharts', () => ({ ResponsiveContainer: ({ children }: PropsWithChildren) => <div>{children}</div>,
  ComposedChart: ({ children, data }: PropsWithChildren<{ data: unknown }>) => { mock.chart(data); return <div>{children}</div>; },
  CartesianGrid: () => null, XAxis: () => null, YAxis: () => null, Tooltip: () => null, Legend: () => null,
  Area: () => null, Line: () => null, Bar: () => null, LabelList: () => null }));
const plot = { id: 'plot-1', plot_name: '1', project_name: 'Project', selling_price: 9000000, sale_status: 'available' };
const sale = { saleId: 'sale-1', plotId: plot.id, projectName: 'Project', customerName: 'Historical customer',
  stage: 'booked', salePrice: 123, bookedAt: null, importedHistory: { bookedDate: '2026-10-01', cancelledDate: null, transferredDate: null } };
const report = (sales = [sale]) => ({ projects: [{ map: { salePages: [{ rows: sales }] }, evidence: { projectName: 'Project',
  forecasts: [], legacyVisits: [], completedVisits: [], unassignedLegacyVisits: [], bookingAmounts: [] } }] });
beforeEach(() => {
  vi.clearAllMocks(); mock.identity.mockReturnValue(() => {}); mock.report.mockResolvedValue(report()); mock.raw.mockResolvedValue([plot]);
  mock.from.mockImplementation((table: string) => { const result = Promise.resolve({ data: table === 'projects' ? [{ name: 'Project' }] : [], error: null });
    const query = { select: () => query, order: () => query, then: result.then.bind(result) }; return query; });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function open() { return render(<SalesWorkspaceModeProvider mode="central"><SalesDashboardExcelStyle /></SalesWorkspaceModeProvider>); }
describe('rich canonical Sales report', () => {
  it('uses complete trusted report pages and aggregates rows beyond the former 250-row cutoff', async () => {
    const rows = Array.from({ length: 300 }, (_, index) => ({ ...sale, saleId: `sale-${index}` }));
    mock.report.mockResolvedValue({ projects: [{ ...report().projects[0], map: { salePages: Array.from({ length: 6 }, (_, page) => ({ rows: rows.slice(page * 50, page * 50 + 50) })) } }] });
    const view = open(); await screen.findByText(/Monthly Sale Report/);
    fireEvent.change(view.container.querySelector('input[type="date"]')!, { target: { value: '2026-10-31' } });
    expect(mock.chart.mock.calls.some(([data]) => data.some((row: Record<string, unknown>) => Object.values(row).includes(300)))).toBe(true);
    expect(mock.raw.mock.calls.map(call => call[0])).toEqual(['plots']); expect(mock.rpc).not.toHaveBeenCalled();
    expect(mock.from.mock.calls.map(call => call[0])).toEqual(['house_types', 'projects']);
  });
  it('keeps unknown historical dates and price explicit without plotting a guessed visit', async () => {
    mock.report.mockResolvedValue(report([{ ...sale, stage: 'transferred', salePrice: null, importedHistory: { bookedDate: null, transferredDate: null, cancelledDate: null } }] as never));
    open(); await screen.findByText(/Monthly Sale Report/);
    expect(screen.getByRole('note')).toHaveTextContent('วันจอง 1, วันโอน 1');
    expect(screen.getByRole('note')).toHaveTextContent('ราคา 1');
    expect(mock.chart.mock.calls.every(([data]) => data.every((row: Record<string, unknown>) => !Object.entries(row).some(([key, value]) => key.startsWith('y') && value !== 0 && value !== null)))).toBe(true);
  });
  it('shows a read failure without querying raw Sales or Leads as fallback', async () => {
    mock.report.mockRejectedValue(new Error('incomplete report'));
    open(); expect(await screen.findByRole('alert')).toHaveTextContent('โหลดรายงานไม่สำเร็จ');
    expect(mock.raw.mock.calls.map(call => call[0])).toEqual(['plots']); expect(mock.rpc).not.toHaveBeenCalled();
  });
  it('hides the previous account report immediately while the new identity reloads', async () => {
    open(); await screen.findByText(/Monthly Sale Report/);
    let finish!: (data: unknown) => void;
    mock.report.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await act(async () => { mock.identity.mock.lastCall?.[0](); });
    expect(screen.queryByText(/Monthly Sale Report/)).not.toBeInTheDocument();
    await waitFor(() => expect(mock.report).toHaveBeenCalledTimes(2));
    await act(async () => { finish(report([])); });
    await screen.findByText(/Monthly Sale Report/);
  });
});
