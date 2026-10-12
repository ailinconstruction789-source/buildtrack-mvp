import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OwnerAnalyticsDashboard from '../OwnerAnalyticsDashboard';

const mocks = vi.hoisted(() => ({ read: vi.fn(), insert: vi.fn(), signals: [] as AbortSignal[] }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn(() => ({
  select: () => ({ order: () => ({ limit: () => ({ abortSignal: (signal: AbortSignal) => {
    mocks.signals.push(signal); return mocks.read();
  } }) }) }),
  insert: (rows: unknown) => { mocks.insert(rows); return { abortSignal: () => Promise.resolve({ error: null }) }; },
})) } }));
vi.mock('../Analytics/WeeklyHeatmap', () => ({ default: () => null }));
vi.mock('../Analytics/BillingCycleHeatmap', () => ({ default: () => null }));
vi.mock('recharts', () => {
  const Shell = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  const Empty = () => null;
  return { ResponsiveContainer: Shell, LineChart: Shell, BarChart: Shell, ComposedChart: Shell,
    Line: Empty, Bar: Empty, XAxis: Empty, YAxis: Empty, CartesianGrid: Empty, Tooltip: Empty, Legend: Empty };
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const insight = (title: string) => [{ title, type: 'evm', severity: 'info', message: 'Synthetic analysis', recommendation: 'Test only' }];
const cached = (title: string) => ({ data: [{ report_data: insight(title), created_at: new Date().toISOString() }], error: null });
const props = {
  projects: [{ name: 'A' }, { name: 'B' }],
  plots: [{ id: 'A1', plot_name: 'A1', project_name: 'A', progress: 60, house_type_id: 1, foreman: 'F' },
    { id: 'B1', plot_name: 'B1', project_name: 'B', progress: 30, house_type_id: 1, foreman: 'F' }],
  taskTemplates: [{ id: 'T', house_type_id: 1, task_name: 'Synthetic Task', cost: 100 }],
  schedules: {
    'A1-T': { plot_id: 'A1', task_template_id: 'T', planned_start: '2026-09-01', planned_end: '2026-11-01' },
    'B1-T': { plot_id: 'B1', task_template_id: 'T', planned_start: '2026-09-01', planned_end: '2026-11-01' },
  },
  latestUpdatesMap: {
    'A1-T': { plot_id: 'A1', task_template_id: 'T', progress: 60, created_at: '2026-10-01' },
    'B1-T': { plot_id: 'B1', task_template_id: 'T', progress: 30, created_at: '2026-10-01' },
  },
  allUpdatesRecord: [
    { plot_id: 'A1', task_template_id: 'T', progress: 60, action: 'แจ้งแก้ไข', created_at: '2026-10-01' },
    { plot_id: 'B1', task_template_id: 'T', progress: 30, action: 'แจ้งแก้ไข', created_at: '2026-10-01' },
  ],
  foremenList: [{ username: 'F' }], defects: [], contractors: [], assignments: [], weatherInfo: null, qcSePerformance: [],
};
beforeEach(() => {
  mocks.read.mockReset(); mocks.insert.mockReset(); mocks.signals.length = 0;
  vi.stubGlobal('fetch', vi.fn());
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('construction AI request lifecycle (mocked API/DB only)', () => {
  it('uses the normal recent cache without generating or writing another report', async () => {
    mocks.read.mockResolvedValue(cached('Cached current'));
    render(<OwnerAnalyticsDashboard {...props} />);
    expect(await screen.findByText('Cached current')).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled(); expect(mocks.insert).not.toHaveBeenCalled();
  });
  it('does not start costly analysis after a stale cache read resolves on a closed page', async () => {
    const read = deferred<any>(); mocks.read.mockReturnValue(read.promise);
    const { unmount } = render(<OwnerAnalyticsDashboard {...props} />);
    expect(mocks.read).toHaveBeenCalledTimes(1);
    unmount(); expect(mocks.signals[0].aborted).toBe(true);
    await act(async () => read.resolve({ data: [], error: null }));
    expect(fetch).not.toHaveBeenCalled(); expect(mocks.insert).not.toHaveBeenCalled();
  });
  it('aborts the previous project and ignores its late cache while the new project stays displayed', async () => {
    const oldRead = deferred<any>(); mocks.read.mockReturnValueOnce(oldRead.promise).mockResolvedValue(cached('Project B current'));
    render(<OwnerAnalyticsDashboard {...props} />);
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'B' } });
    expect(await screen.findByText('Project B current')).toBeInTheDocument();
    expect(mocks.signals[0].aborted).toBe(true);
    await act(async () => oldRead.resolve(cached('Old project report')));
    expect(screen.queryByText('Old project report')).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled(); expect(mocks.insert).not.toHaveBeenCalled();
  });
  it('aborts an in-flight generated report and never caches it after unmount', async () => {
    mocks.read.mockResolvedValue({ data: [], error: null });
    const response = deferred<any>(); vi.mocked(fetch).mockReturnValue(response.promise);
    const { unmount } = render(<OwnerAnalyticsDashboard {...props} />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const signal = vi.mocked(fetch).mock.calls[0][1]?.signal as AbortSignal;
    unmount(); expect(signal.aborted).toBe(true);
    await act(async () => response.resolve({ ok: true, json: async () => insight('Stale generated') }));
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it('a manual refresh supersedes the pending cache and caches one valid response', async () => {
    const read = deferred<any>(); mocks.read.mockReturnValue(read.promise);
    const response = deferred<any>(); vi.mocked(fetch).mockReturnValue(response.promise);
    render(<OwnerAnalyticsDashboard {...props} />);
    fireEvent.click(screen.getByText('วิเคราะห์เดี๋ยวนี้'));
    expect(mocks.signals[0].aborted).toBe(true);
    await act(async () => read.resolve(cached('Old cache')));
    expect(screen.queryByText('Old cache')).not.toBeInTheDocument();
    await act(async () => response.resolve({ ok: true, json: async () => insight('Manual fresh') }));
    expect(screen.getByText('Manual fresh')).toBeInTheDocument();
    expect(mocks.insert).toHaveBeenCalledTimes(1);
  });
  it.each([null, {}, [null]])('preserves a successful report on malformed generated data %j', async malformed => {
    mocks.read.mockResolvedValue(cached('Keep successful report'));
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => malformed } as Response);
    render(<OwnerAnalyticsDashboard {...props} />);
    await screen.findByText('Keep successful report');
    fireEvent.click(screen.getByText('วิเคราะห์เดี๋ยวนี้'));
    await screen.findByText(/ข้อมูลรายงาน AI ไม่ถูกต้อง/);
    expect(screen.getByText('Keep successful report')).toBeInTheDocument();
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it('reports cache read errors without invoking AI or overwriting with empty success', async () => {
    mocks.read.mockResolvedValue({ data: null, error: { message: 'Synthetic read failure' } });
    render(<OwnerAnalyticsDashboard {...props} />);
    expect(await screen.findByText(/Synthetic read failure/)).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled(); expect(mocks.insert).not.toHaveBeenCalled();
  });
  it('preserves foreman and contractor metrics including silent work, strict progress and duplicate assignments', async () => {
    mocks.read.mockResolvedValue(cached('Metric parity'));
    vi.mocked(fetch).mockReturnValue(new Promise(() => {}));
    const templates = [{ id: 'T', house_type_id: 1, task_name: 'Normal', cost: 100 },
      { id: 'S', house_type_id: 1, task_name: 'Silent', cost: 100 },
      { id: 'N', house_type_id: 1, task_name: 'Numeric string progress', cost: 100 }];
    const assignments = [{ plot_id: 'A1', task_template_id: 'T', contractor_name: 'C' },
      { plot_id: 'A1', task_template_id: 'T', contractor_name: 'C' }];
    const histories = Object.freeze([
      { plot_id: 'A1', task_template_id: 'T', progress: 100, action: 'ไม่อนุมัติ', created_at: '2026-10-03T12:00:00Z' },
      { plot_id: 'A1', task_template_id: 'T', progress: 20, action: 'แจ้งแก้ไข', created_at: '2026-10-01T00:00:00Z' },
      { plot_id: 'A1', task_template_id: 'S', progress: 100, action: 'Report', is_silent: true, created_at: '2026-10-01' },
      { plot_id: 'A1', task_template_id: 'N', progress: '100', action: 'Report', created_at: '2026-10-01' },
    ]);
    const metricProps = { ...props, taskTemplates: templates, allUpdatesRecord: histories, assignments,
      contractors: [{ name: 'C' }], defects: [{ plot_id: 'A1', task_id: 'T' }],
      schedules: { 'A1-T': { plot_id: 'A1', task_template_id: 'T', planned_start: '2026-10-01', planned_end: '2026-10-02' } },
      latestUpdatesMap: {
        'A1-T': { plot_id: 'A1', task_template_id: 'T', progress: 100, created_at: '2026-10-03T12:00:00Z' },
        'A1-S': { plot_id: 'A1', task_template_id: 'S', progress: 100, created_at: '2026-10-01' },
        'A1-N': { plot_id: 'A1', task_template_id: 'N', progress: '100', created_at: '2026-10-01' },
      } };
    const snapshot = JSON.stringify(metricProps);
    render(<OwnerAnalyticsDashboard {...metricProps} />);
    await screen.findByText('Metric parity');
    const table = screen.getByText('Foreman Leadership Matrix').closest('.bg-white')!.querySelector('table')!;
    const row = within(table).getAllByRole('row')[1];
    expect(row.textContent).toContain('1 งาน');
    expect(row.textContent).toContain('0%');
    expect(within(row).getByText('1')).toBeInTheDocument(); // Only แจ้งแก้ไข counts in foreman reworks.
    fireEvent.click(screen.getByText('วิเคราะห์เดี๋ยวนี้'));
    const payload = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
    expect(payload.contractorPerformance[0]).toMatchObject({ name: 'C', taskCount: 2, completedTasksCount: 2,
      onTimeRate: 0, bayesianScore: 48, totalReworks: 2, defectCount: 1, delayProbability: 70 });
    expect(JSON.stringify(metricProps)).toBe(snapshot);
  });
});
