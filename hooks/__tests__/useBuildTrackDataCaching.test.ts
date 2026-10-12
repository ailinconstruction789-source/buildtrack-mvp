import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBuildTrackData } from '../useBuildTrackData';

type Row = Record<string, unknown>;
type Response = { data: Row[]; error: { message: string } | null; count?: number | null };
const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  handlers: new Map<string, (payload: { new: Record<string, unknown> }) => void | Promise<void>>(),
}));
vi.mock('@/lib/supabase', () => {
  const channel = {
    on: vi.fn((_event: string, filter: { table: string }, handler: (payload: { new: Row }) => void) => {
      mocks.handlers.set(filter.table, handler);
      return channel;
    }),
    subscribe: vi.fn(),
  };
  return { supabase: { from: mocks.from, channel: vi.fn(() => channel), removeChannel: vi.fn() } };
});

const user = { username: 'Admin A', role: 'Admin' };
const referenceTables = ['projects', 'house_types', 'task_templates', 'contractors'];
let tables: Record<string, Row[]>;
let errors: Record<string, { message: string }>;
let pending: Map<string, Promise<Response>[]>;

function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>(accept => { resolve = accept; });
  return { promise, resolve };
}

function fromCount(table: string) {
  return mocks.from.mock.calls.filter(([name]) => name === table).length;
}

function useFixture(initialProject = 'Project A') {
  return renderHook(function TestHook({ account, project }: { account: typeof user | null; project: string }) {
    return useBuildTrackData(account, project);
  }, {
    initialProps: { account: user as typeof user | null, project: initialProject },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.handlers.clear();
  errors = {};
  pending = new Map();
  tables = {
    projects: [{ name: 'Project A', layout_data: [] }, { name: 'Project B', layout_data: [] }],
    house_types: [{ id: 1, type_name: 'Type A' }],
    task_templates: [{ id: 1, task_name: 'Task A', task_order: 1 }],
    contractors: [{ id: 1, name: 'Contractor A' }],
    plots: [
      { id: 'P1', project_name: 'Project A', house_types: { type_name: 'Type A' } },
      { id: 'P2', project_name: 'Project B', house_types: { type_name: 'Type A' } },
    ],
    leads: [{ id: 'L1', project_name: 'Project A', interested_plot_id: 'P1', customer_name: 'Customer A', status: 'Booked', booking_date: '2026-10-01' }],
    vw_plot_progress: [{ plot_id: 'P1', overall_progress: 50 }, { plot_id: 'P2', overall_progress: 75 }],
    vw_project_progress: [{ project_name: 'Project A', project_progress: 50 }, { project_name: 'Project B', project_progress: 75 }],
    plot_task_assignments: [
      { id: 1, plot_id: 'P1', task_template_id: 1, current_progress: 10, actual_start_date: '2026-10-01' },
      { id: 2, plot_id: 'P2', task_template_id: 1, current_progress: 25, actual_start_date: '2026-10-02' },
    ],
    plot_task_schedules: [
      { id: 1, plot_id: 'P1', task_template_id: 1, planned_start: '2026-10-01' },
      { id: 2, plot_id: 'P2', task_template_id: 1, planned_start: '2026-10-02' },
    ],
  };
  mocks.from.mockImplementation((table: string) => {
    const rows = tables[table] || [];
    const delayed = pending.get(table)?.shift();
    const error = errors[table] || null;
    let projectFilter: string | undefined;
    let plotFilter: string | undefined;
    let start = 0;
    let end = 999;
    let requestCount = false;
    return {
      select: vi.fn(function (this: unknown, _columns: string, options?: { count?: string }) {
        requestCount = options?.count === 'exact';
        return this;
      }), order: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), update: vi.fn().mockReturnThis(),
      eq: vi.fn(function (this: unknown, column: string, value: string) {
        if (column === 'plots.project_name') projectFilter = value;
        if (column === 'plot_id') plotFilter = value;
        return this;
      }),
      range: vi.fn(function (this: unknown, from: number, to: number) {
        start = from; end = to; return this;
      }),
      then: (resolve: (response: Response) => unknown, reject?: (error: unknown) => unknown) => {
        let filtered = projectFilter
          ? rows.filter(row => tables.plots.some(plot => plot.id === row.plot_id && plot.project_name === projectFilter))
          : rows;
        if (plotFilter !== undefined) filtered = filtered.filter(row => row.plot_id === plotFilter);
        return (delayed || Promise.resolve({ data: filtered.slice(start, end + 1), error, count: requestCount ? filtered.length : null })).then(resolve, reject);
      },
    };
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('BuildTrack reference-data reuse during project navigation', () => {
  it('does not reload staff or core data when the caller recreates the same account object', async () => {
    tables.users = [{ id: 1, username: 'Admin A', role: 'Admin' }];
    const { result, rerender } = renderHook(({ revision }) => {
      void revision;
      return useBuildTrackData({ ...user, id: 1 }, 'Project A');
    }, { initialProps: { revision: 0 } });
    await waitFor(() => expect(result.current.loading).toBe(false));
    const before = mocks.from.mock.calls.length;
    const staff = result.current.allUsers;
    rerender({ revision: 1 });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(mocks.from.mock.calls.length).toBe(before);
    expect(fromCount('users')).toBe(1);
    expect(result.current.allUsers).toBe(staff);
  });

  it.each(['id', 'authUserId'])('invalidates the snapshot when %s changes despite identical display name and role', async identityField => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result, rerender } = renderHook(({ identity }) => useBuildTrackData({ ...user, [identityField]: identity }, 'Project A'),
      { initialProps: { identity: 'account-A' } });
    await waitFor(() => expect(result.current.loading).toBe(false));
    const oldDetails = result.current.fetchPlotDetails;
    errors.projects = { message: 'new actor read unavailable' };
    rerender({ identity: 'account-B' });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.plots).toEqual([]);
    expect(result.current.latestUpdatesMap).toEqual({});
    const before = mocks.from.mock.calls.length;
    await act(async () => { await oldDetails('P1'); });
    expect(mocks.from.mock.calls.length).toBe(before);
  });

  it('does not expose the previous account snapshot if the next account load fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    tables.notifications = [{ id: 8, target_user: 'Admin A' }];
    const { result, rerender } = useFixture();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.plots).not.toHaveLength(0);
    expect(result.current.notifications).not.toHaveLength(0);
    errors.projects = { message: 'new account API unavailable' };
    rerender({ account: { username: 'Admin B', role: 'Admin' }, project: 'Project A' });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.plots).toEqual([]);
    expect(result.current.projects).toEqual([]);
    expect(result.current.notifications).toEqual([]);
    expect(result.current.assignments).toEqual([]);
    expect(result.current.latestUpdatesMap).toEqual({});
    expect(result.current.taskTemplates).toEqual([]);
  });

  it('clears successful account snapshots on logout', async () => {
    const { result, rerender } = useFixture();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.plots).not.toHaveLength(0);
    rerender({ account: null, project: 'Project A' });
    expect(result.current.plots).toEqual([]);
    expect(result.current.assignments).toEqual([]);
    expect(result.current.schedules).toEqual({});
    expect(result.current.allUpdatesRecord).toEqual([]);
  });

  it('does not run saved realtime callbacks after changing accounts', async () => {
    const { result, rerender } = useFixture();
    await waitFor(() => expect(result.current.loading).toBe(false));
    const oldTask = mocks.handlers.get('task_updates')!;
    const oldMaterial = mocks.handlers.get('task_material_requests')!;
    rerender({ account: { username: 'Admin B', role: 'Admin' }, project: 'Project A' });
    await waitFor(() => expect(result.current.loading).toBe(false));
    const before = mocks.from.mock.calls.length;
    await act(async () => {
      await oldTask({ new: { id: 888, plot_id: 'P1', task_template_id: 1, progress: 99 } });
      await oldMaterial({ new: {} });
    });
    expect(mocks.from.mock.calls.length).toBe(before);
    expect(result.current.allUpdatesRecord.some(row => row.id === 888)).toBe(false);
  });

  it('ignores pending realtime queue and material responses from the previous account', async () => {
    const { result, rerender } = useFixture();
    await waitFor(() => expect(result.current.loading).toBe(false));
    const queue = deferred();
    const material = deferred();
    pending.set('vw_inspection_queue', [queue.promise]);
    pending.set('task_material_receipts', [material.promise]);
    let materialRead!: void | Promise<void>;
    act(() => {
      mocks.handlers.get('task_updates')!({ new: { id: 7, plot_id: 'P1', task_template_id: 1, progress: 30 } });
      materialRead = mocks.handlers.get('task_material_requests')!({ new: {} });
    });
    tables.vw_inspection_queue = [{ id: 'B-queue' }];
    tables.vw_task_material_requests = [{ id: 'B-request' }];
    tables.task_material_receipts = [{ id: 'B-receipt' }];
    rerender({ account: { username: 'Admin B', role: 'Admin' }, project: 'Project A' });
    await waitFor(() => expect(result.current.inspectionQueueView[0]?.id).toBe('B-queue'));
    await act(async () => {
      queue.resolve({ data: [{ id: 'A-queue' }], error: null });
      material.resolve({ data: [{ id: 'A-receipt' }], error: null });
      await materialRead;
    });
    expect(result.current.inspectionQueueView[0].id).toBe('B-queue');
    expect(result.current.materialRequests[0].id).toBe('B-request');
    expect(result.current.materialReceipts[0].id).toBe('B-receipt');
  });

  it('keeps the newest realtime queue response when events overlap', async () => {
    const { result } = useFixture();
    await waitFor(() => expect(result.current.loading).toBe(false));
    const oldQueue = deferred();
    pending.set('vw_inspection_queue', [oldQueue.promise]);
    const handler = mocks.handlers.get('task_updates')!;
    act(() => { handler({ new: { id: 7, plot_id: 'P1', task_template_id: 1, progress: 30 } }); });
    tables.vw_inspection_queue = [{ id: 'new-queue' }];
    await act(async () => { handler({ new: { id: 8, plot_id: 'P1', task_template_id: 1, progress: 40 } }); });
    await act(async () => { oldQueue.resolve({ data: [{ id: 'old-queue' }], error: null }); });
    expect(result.current.inspectionQueueView[0].id).toBe('new-queue');
  });

  it('preserves both realtime material snapshots if either read fails', async () => {
    tables.vw_task_material_requests = [{ id: 'original-request' }];
    tables.task_material_receipts = [{ id: 'original-receipt' }];
    const { result } = useFixture();
    await waitFor(() => expect(result.current.loading).toBe(false));
    tables.vw_task_material_requests = [{ id: 'new-request' }];
    errors.task_material_receipts = { message: 'receipt read unavailable' };
    await act(async () => { await mocks.handlers.get('task_material_requests')!({ new: {} }); });
    expect(result.current.materialRequests[0].id).toBe('original-request');
    expect(result.current.materialReceipts[0].id).toBe('original-receipt');
  });

  it('ignores an old analytics load after the account changes, including its saved callback', async () => {
    const { result, rerender } = useFixture();
    await waitFor(() => expect(result.current.loading).toBe(false));
    const saved = result.current.fetchOwnerAnalyticsData;
    const oldAssignments = deferred();
    pending.set('plot_task_assignments', [oldAssignments.promise]);
    let old!: Promise<void>;
    act(() => { old = saved(); });
    tables.plot_task_assignments[0] = { ...tables.plot_task_assignments[0], current_progress: 80 };
    rerender({ account: { username: 'Admin B', role: 'Admin' }, project: 'Project A' });
    await waitFor(() => expect(result.current.latestUpdatesMap['P1-1']?.progress).toBe(80));
    await act(async () => {
      oldAssignments.resolve({ data: [{ id: 1, plot_id: 'P1', task_template_id: 1, current_progress: 20 }], error: null });
      await old;
    });
    expect(result.current.latestUpdatesMap['P1-1'].progress).toBe(80);
    expect(result.current.isAnalyticsLoading).toBe(false);
    const before = mocks.from.mock.calls.length;
    await act(async () => { await saved(true); });
    expect(mocks.from.mock.calls.length).toBe(before);
  });

  it('ignores background archive data from a previous account', async () => {
    const { result, rerender } = useFixture();
    await waitFor(() => expect(result.current.loading).toBe(false));
    const archive = deferred();
    pending.set('task_updates', [Promise.resolve({ data: [], error: null }), archive.promise]);
    await act(async () => { await result.current.fetchOwnerAnalyticsData(); });
    tables.task_updates = [{ id: 77, plot_id: 'P1', task_template_id: 1, progress: 90, created_at: '2026-10-08T10:00:00Z' }];
    rerender({ account: { username: 'Admin B', role: 'Admin' }, project: 'Project A' });
    await waitFor(() => expect(result.current.allUpdatesRecord[0]?.id).toBe(77));
    await act(async () => {
      archive.resolve({ data: [{ id: 3, plot_id: 'P1', task_template_id: 1, progress: 20, created_at: '2026-10-01T10:00:00Z' }], error: null });
    });
    expect(result.current.allUpdatesRecord.map(row => row.id)).toEqual([77]);
    expect(result.current.isArchiveSyncing).toBe(false);
    expect(result.current.archiveSyncSuccess).toBe(false);
  });

  it('does not apply an older analytics request after a forced refresh finishes', async () => {
    const { result } = useFixture();
    await waitFor(() => expect(result.current.loading).toBe(false));
    const oldAssignments = deferred();
    pending.set('plot_task_assignments', [oldAssignments.promise]);
    let old!: Promise<void>;
    act(() => { old = result.current.fetchOwnerAnalyticsData(); });
    tables.plot_task_assignments[0] = { ...tables.plot_task_assignments[0], current_progress: 80 };
    await act(async () => { await result.current.fetchOwnerAnalyticsData(true); });
    await act(async () => {
      oldAssignments.resolve({ data: [{ id: 1, plot_id: 'P1', task_template_id: 1, current_progress: 20 }], error: null });
      await old;
    });
    expect(result.current.latestUpdatesMap['P1-1'].progress).toBe(80);
  });

  it('preserves the analytics snapshot when a required API read fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = useFixture();
    await waitFor(() => expect(result.current.loading).toBe(false));
    const assignments = result.current.assignments;
    const latest = result.current.latestUpdatesMap;
    errors.defects = { message: 'analytics read failure' };
    tables.plot_task_assignments[0] = { ...tables.plot_task_assignments[0], current_progress: 80 };
    await act(async () => { await result.current.fetchOwnerAnalyticsData(); });
    expect(result.current.assignments).toBe(assignments);
    expect(result.current.latestUpdatesMap).toBe(latest);
    expect(result.current.isAnalyticsLoading).toBe(false);
    expect(result.current.isArchiveSyncing).toBe(false);
  });

  it('does not report a failed archive sync as successful or clear recent history', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { result } = useFixture();
    await waitFor(() => expect(result.current.loading).toBe(false));
    const archive = deferred();
    const recent = [{ id: 42, plot_id: 'P1', task_template_id: 1, progress: 70 }];
    pending.set('task_updates', [Promise.resolve({ data: recent, error: null }), archive.promise]);
    await act(async () => { await result.current.fetchOwnerAnalyticsData(); });
    await act(async () => { archive.resolve({ data: [], error: { message: 'archive unavailable' } }); });
    expect(result.current.allUpdatesRecord).toEqual(recent);
    expect(result.current.isArchiveSyncing).toBe(false);
    expect(result.current.archiveSyncSuccess).toBe(false);
  });

  it('loads overview figures and queue without assignment, schedule or QC analytics reads', async () => {
    tables.vw_inspection_queue = [{ plot_id: 'P1', status: 'pending' }];
    tables.vw_plot_status_dashboard = [{ plot_id: 'P1', planned: 60 }];
    const { result, rerender } = renderHook(({ overview }) => useBuildTrackData(user, 'Project A', false, overview),
      { initialProps: { overview: true } });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fromCount('plot_task_assignments')).toBe(0);
    expect(fromCount('plot_task_schedules')).toBe(0);
    expect(fromCount('vw_qc_se_performance')).toBe(0);
    expect(result.current.plots[0].progress).toBe(50);
    expect(result.current.projects[0].progress).toBe(50);
    expect(result.current.inspectionQueueView).toEqual(tables.vw_inspection_queue);
    expect(result.current.plotStatuses).toEqual(tables.vw_plot_status_dashboard);
    rerender({ overview: false });
    await waitFor(() => expect(result.current.schedules['P1-1']).toBeDefined());
    expect(result.current.latestUpdatesMap['P1-1'].progress).toBe(10);
    for (const table of referenceTables) expect(fromCount(table)).toBe(1);
  });

  it('shares pending plot detail reads and briefly reuses successful details', async () => {
    const { result } = useFixture();
    await waitFor(() => expect(result.current.loading).toBe(false));
    const before = mocks.from.mock.calls.length;
    await act(async () => { await Promise.all([result.current.fetchPlotDetails('P1'), result.current.fetchPlotDetails('P1')]); });
    expect(mocks.from.mock.calls.length - before).toBe(4);
    await act(async () => { await result.current.fetchPlotDetails('P1'); });
    expect(mocks.from.mock.calls.length - before).toBe(4);
  });

  it('does not apply an older plot response after a forced fresh read', async () => {
    const { result } = useFixture();
    await waitFor(() => expect(result.current.loading).toBe(false));
    const delayed = deferred();
    pending.set('plot_task_assignments', [delayed.promise]);
    let old!: Promise<void>;
    act(() => { old = result.current.fetchPlotDetails('P1'); });
    tables.plot_task_assignments = [{ id: 1, plot_id: 'P1', task_template_id: 1, current_progress: 80 }];
    await act(async () => { await result.current.fetchPlotDetails('P1', { fresh: true }); });
    await act(async () => { delayed.resolve({ data: [{ id: 1, plot_id: 'P1', task_template_id: 1, current_progress: 20 }], error: null }); await old; });
    expect(result.current.latestUpdatesMap['P1-1'].progress).toBe(80);
  });

  it('preserves the complete plot snapshot when one read fails and retries that read', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    tables.task_updates = [{ id: 9, plot_id: 'P1', task_template_id: 1, progress: 10, action: 'Report' }];
    tables.defects = [{ id: 7, plot_id: 'P1', status: 'pending' }];
    const { result } = useFixture();
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.fetchPlotDetails('P1'); });
    const snapshot = { assignments: result.current.assignments, updates: result.current.allUpdatesRecord, defects: result.current.defects, latest: result.current.latestUpdatesMap };
    errors.defects = { message: 'temporary failure' };
    tables.plot_task_assignments = [{ id: 1, plot_id: 'P1', task_template_id: 1, current_progress: 80, latest_action: 'Report', latest_role: 'Foreman' }];
    await act(async () => { await result.current.fetchPlotDetails('P1', { fresh: true }); });
    expect(result.current.assignments).toBe(snapshot.assignments);
    expect(result.current.allUpdatesRecord).toBe(snapshot.updates);
    expect(result.current.defects).toBe(snapshot.defects);
    expect(result.current.latestUpdatesMap).toBe(snapshot.latest);
    delete errors.defects;
    await act(async () => { await result.current.fetchPlotDetails('P1'); });
    expect(result.current.latestUpdatesMap['P1-1'].progress).toBe(80);
  });

  it('refreshes assignment action, role and timestamp instead of retaining old metadata', async () => {
    tables.plot_task_assignments[0] = { ...tables.plot_task_assignments[0], latest_action: 'ส่งงาน 100%', latest_role: 'Foreman' };
    const { result } = useFixture();
    await waitFor(() => expect(result.current.loading).toBe(false));
    tables.plot_task_assignments[0] = { ...tables.plot_task_assignments[0], current_progress: 100, latest_action: 'QC อนุมัติ', latest_role: 'QC', latest_update_created_at: '2026-10-08T10:00:00Z' };
    await act(async () => { await result.current.fetchPlotDetails('P1'); });
    expect(result.current.latestUpdatesMap['P1-1']).toMatchObject({ progress: 100, action: 'QC อนุมัติ', role: 'QC', created_at: '2026-10-08T10:00:00Z' });
  });

  it('does not apply plot details or run a saved callback from the previous account', async () => {
    const { result, rerender } = useFixture();
    await waitFor(() => expect(result.current.loading).toBe(false));
    const delayed = deferred();
    pending.set('plot_task_assignments', [delayed.promise]);
    const previous = result.current.fetchPlotDetails;
    let old!: Promise<void>;
    act(() => { old = previous('P1'); });
    rerender({ account: { username: 'Admin B', role: 'Admin' }, project: 'Project B' });
    await waitFor(() => expect(result.current.loading).toBe(false));
    const before = result.current.latestUpdatesMap;
    await act(async () => { delayed.resolve({ data: [{ id: 99, plot_id: 'P1', task_template_id: 1, current_progress: 99 }], error: null }); await old; });
    expect(result.current.latestUpdatesMap).toBe(before);
    const calls = mocks.from.mock.calls.length;
    await act(async () => { await previous('P1'); });
    expect(mocks.from).toHaveBeenCalledTimes(calls);
  });

  it('invalidates cached details after a save refresh or a realtime update', async () => {
    const { result } = useFixture();
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.fetchPlotDetails('P1'); await result.current.fetchAllData(); });
    const before = mocks.from.mock.calls.length;
    await act(async () => { await result.current.fetchPlotDetails('P1'); });
    expect(mocks.from.mock.calls.length - before).toBe(4);
    await act(async () => { await mocks.handlers.get('task_updates')!({ new: { id: 8, plot_id: 'P1', task_template_id: 1, progress: 80 } }); });
    const afterRealtime = mocks.from.mock.calls.length;
    await act(async () => { await result.current.fetchPlotDetails('P1'); });
    expect(mocks.from.mock.calls.length - afterRealtime).toBe(4);
  });

  it('retains core data rather than replacing successful rows on an API error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = useFixture();
    await waitFor(() => expect(result.current.loading).toBe(false));
    const before = { plots: result.current.plots, assignments: result.current.assignments };
    errors.task_updates = { message: 'read failed' };
    tables.plots = [];
    await act(async () => { await result.current.fetchAllData(); });
    expect(result.current.plots).toBe(before.plots);
    expect(result.current.assignments).toBe(before.assignments);
  });
  function useSalesFixture() {
    return renderHook(function TestSalesHook({ account, salesOnly }: { account: typeof user | null; salesOnly: boolean }) {
      return useBuildTrackData(account, undefined, salesOnly);
    }, {
      initialProps: { account: { username: 'Sales A', role: 'Sales' } as typeof user | null, salesOnly: true },
    });
  }

  it('opens Sales Hub without construction pages while preserving customer and progress display data', async () => {
    const { result } = useSalesFixture();
    await waitFor(() => expect(result.current.loading).toBe(false));
    for (const table of ['plot_task_assignments', 'plot_task_schedules', 'task_updates', 'task_templates',
      'contractors', 'defects', 'defect_updates', 'vw_qc_se_performance', 'vw_inspection_queue',
      'vw_task_material_requests', 'task_material_receipts', 'vw_plot_status_dashboard', 'vw_plot_overall_status']) {
      expect(fromCount(table), table).toBe(0);
    }
    expect(result.current.plots[0]).toMatchObject({ customer_name: 'Customer A', sale_status: 'sold', booking_date: '2026-10-01', progress: 50, type: 'Type A' });
    expect(result.current.projects[0]).toMatchObject({ name: 'Project A', plotCount: 1, progress: 50 });
    const base = await result.current.loadSalesStartupData();
    expect(base).toEqual({ leads: tables.leads, plots: tables.plots });
    expect(fromCount('leads')).toBe(1);
    expect(fromCount('plots')).toBe(1);
  });

  it('loads complete construction data on leaving Sales Hub and retains it when returning', async () => {
    const { result, rerender } = useSalesFixture();
    await waitFor(() => expect(result.current.loading).toBe(false));
    const staleSalesRefresh = result.current.fetchAllData;
    rerender({ account: { username: 'Sales A', role: 'Sales' }, salesOnly: false });
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.assignments).toEqual(tables.plot_task_assignments);
    expect(result.current.taskTemplates).toEqual(tables.task_templates);
    expect(result.current.schedules['P2-1']).toBeDefined();
    const count = mocks.from.mock.calls.length;
    await act(async () => { await staleSalesRefresh(); });
    expect(mocks.from).toHaveBeenCalledTimes(count);
    rerender({ account: { username: 'Sales A', role: 'Sales' }, salesOnly: true });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.assignments).toEqual(tables.plot_task_assignments);
    expect(result.current.taskTemplates).toEqual(tables.task_templates);
    expect(fromCount('plot_task_assignments')).toBe(1);
  });

  it('shares an in-flight read with Sales Hub, but refreshes current rows after a save', async () => {
    const delayed = deferred();
    pending.set('leads', [delayed.promise]);
    const { result } = useSalesFixture();
    await waitFor(() => expect(fromCount('leads')).toBe(1));
    const shared = result.current.loadSalesStartupData();
    expect(fromCount('leads')).toBe(1);
    await act(async () => { delayed.resolve({ data: tables.leads, error: null }); await shared; });
    await waitFor(() => expect(result.current.loading).toBe(false));
    tables.leads = [{ ...tables.leads[0], customer_name: 'Saved customer', status: 'Transferred' }];
    await act(async () => { await result.current.fetchAllData(); });
    expect(result.current.plots[0].customer_name).toBe('Saved customer');
    expect(fromCount('leads')).toBe(2);
    const previousRevision = result.current.salesDataRevision;
    await act(async () => {
      const refreshed = await result.current.loadSalesStartupData({ fresh: true });
      expect(refreshed.leads).toEqual(tables.leads);
    });
    expect(result.current.salesDataRevision).toBe(previousRevision + 1);
    expect(fromCount('leads')).toBe(3);
  });

  it('does not reuse customer rows from another account or a failed paginated read', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result, rerender } = useSalesFixture();
    await waitFor(() => expect(result.current.loading).toBe(false));
    const previous = result.current.loadSalesStartupData;
    tables.leads = [{ ...tables.leads[0], customer_name: 'Second account customer' }];
    rerender({ account: { username: 'Sales B', role: 'Sales' }, salesOnly: true });
    await waitFor(() => expect(result.current.plots[0].customer_name).toBe('Second account customer'));
    await expect(previous()).rejects.toThrow('account changed');
    pending.set('leads', [
      Promise.resolve({ data: Array.from({ length: 1000 }, (_, id) => ({ id })), error: null }),
      Promise.resolve({ data: Array.from({ length: 1000 }, (_, id) => ({ id })), error: null }),
      Promise.resolve({ data: [], error: { message: 'second page failed' } }),
    ]);
    await expect(result.current.loadSalesStartupData({ fresh: true })).rejects.toMatchObject({ message: 'second page failed' });
    expect((await result.current.loadSalesStartupData()).leads).toEqual(tables.leads);
  });

  it('restarts multi-page Sales Hub leads with a unique order to keep every row past 1,000', async () => {
    tables.leads = Array.from({ length: 1372 }, (_, index) => ({
      id: String(index).padStart(4, '0'), created_at: '2026-01-01T00:00:00+00:00',
    }));
    const { result } = useSalesFixture();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect((await result.current.loadSalesStartupData()).leads).toEqual(tables.leads);
    const leadQueries = mocks.from.mock.results.filter((_, index) => mocks.from.mock.calls[index][0] === 'leads');
    expect(leadQueries).toHaveLength(3);
    expect(leadQueries[0].value.order.mock.calls.map(([column]: [string]) => column)).toEqual(['created_at']);
    for (const { value } of leadQueries.slice(1)) expect(value.order.mock.calls.map(([column]: [string]) => column)).toEqual(['created_at', 'id']);
  });

  it('loads every QC aggregate past the API row limit without ordering by a nonexistent id', async () => {
    tables.vw_qc_se_performance = Array.from({ length: 1372 }, (_, index) => ({
      date: '2026-10-07', role: 'QC', action: 'QC อนุมัติ', hour_of_day: index, action_count: index + 1,
    }));
    const { result } = useFixture();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.qcSePerformance).toEqual(tables.vw_qc_se_performance);
    expect(fromCount('vw_qc_se_performance')).toBe(2);
    const orders = mocks.from.mock.results
      .filter((_, index) => mocks.from.mock.calls[index][0] === 'vw_qc_se_performance')
      .flatMap(({ value }) => value.order.mock.calls.map(([column]: [string]) => column));
    expect(orders).toContain('date');
    expect(orders).toContain('hour_of_day');
    expect(orders).not.toContain('id');
  });

  it('retains project filtering when the assignment count enables concurrent pagination', async () => {
    tables.plot_task_assignments = [
      ...Array.from({ length: 3001 }, (_, id) => ({ id, plot_id: 'P1', task_template_id: id, current_progress: 25 })),
      ...Array.from({ length: 1001 }, (_, id) => ({ id: id + 3001, plot_id: 'P2', task_template_id: id, current_progress: 75 })),
    ];
    const { result } = useFixture();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.assignments).toEqual(tables.plot_task_assignments.filter(row => row.plot_id === 'P1'));
    expect(fromCount('plot_task_assignments')).toBe(4);
  });

  it('keeps the previous complete QC snapshot if a later refresh page fails', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    tables.vw_qc_se_performance = [{ date: '2026-10-07', action_count: 3 }];
    const { result } = useFixture();
    await waitFor(() => expect(result.current.loading).toBe(false));
    tables.leads = [{ ...tables.leads[0], customer_name: 'Fresh core data' }];
    pending.set('vw_qc_se_performance', [
      Promise.resolve({ data: Array.from({ length: 1000 }, (_, id) => ({ action_count: id })), error: null }),
      Promise.resolve({ data: [], error: { message: 'QC second page failed' } }),
    ]);
    await act(async () => { await result.current.fetchAllData(); });
    expect(result.current.qcSePerformance).toEqual(tables.vw_qc_se_performance);
    expect(result.current.plots[0].customer_name).toBe('Fresh core data');
    expect(result.current.loading).toBe(false);
    expect(log).toHaveBeenCalled();
  });

  it('reduces navigation requests from 20 to 16 while retaining display data and loading the selected project plans', async () => {
    const { result, rerender } = useFixture();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mocks.from.mock.calls.filter(([name]) => name !== 'users')).toHaveLength(20);
    const displayed = { plots: result.current.plots, projects: result.current.projects, types: result.current.houseTypes, tasks: result.current.taskTemplates };
    const callsBefore = mocks.from.mock.calls.length;
    rerender({ account: user, project: 'Project B' });
    await waitFor(() => expect(result.current.schedules['P2-1']).toBeDefined());
    expect(mocks.from.mock.calls.length - callsBefore).toBe(16);
    for (const table of referenceTables) expect(fromCount(table)).toBe(1);
    expect(result.current).toMatchObject({ plots: displayed.plots, projects: displayed.projects, houseTypes: displayed.types, taskTemplates: displayed.tasks });
    expect(result.current.latestUpdatesMap['P2-1'].progress).toBe(25);
    expect(result.current.taskDates['P2-1'].start).toBe('2026-10-02');
    expect(result.current.plots[0]).toMatchObject({ customer_name: 'Customer A', sale_status: 'sold', booking_date: '2026-10-01', progress: 50 });
  });

  it('still fetches current customer, progress and queue data on project navigation', async () => {
    const { result, rerender } = useFixture();
    await waitFor(() => expect(result.current.loading).toBe(false));
    tables.leads = [{ ...tables.leads[0], status: 'Transferred', customer_name: 'Updated customer', transferred_date: '2026-10-07' }];
    tables.vw_plot_progress = [{ plot_id: 'P1', overall_progress: 90 }];
    tables.vw_inspection_queue = [{ plot_id: 'P1', status: 'pending' }];
    rerender({ account: user, project: 'Project B' });
    await waitFor(() => expect(result.current.plots[0].customer_name).toBe('Updated customer'));
    expect(result.current.plots[0]).toMatchObject({ sale_status: 'transferred', transferred_date: '2026-10-07', progress: 90 });
    expect(result.current.inspectionQueueView).toEqual(tables.vw_inspection_queue);
  });

  it('bypasses the cache after a save and uses the newly loaded references on the next navigation', async () => {
    const { result, rerender } = useFixture();
    await waitFor(() => expect(result.current.loading).toBe(false));
    tables.house_types = [{ id: 2, type_name: 'Updated type' }];
    await act(async () => { expect(await result.current.togglePlotSaleStatus('P1', 'active', null)).toBe(true); });
    expect(result.current.houseTypes).toEqual(tables.house_types);
    for (const table of referenceTables) expect(fromCount(table)).toBe(2);
    rerender({ account: user, project: 'Project B' });
    await waitFor(() => expect(result.current.schedules['P2-1']).toBeDefined());
    for (const table of referenceTables) expect(fromCount(table)).toBe(2);
    expect(result.current.houseTypes).toEqual(tables.house_types);
  });

  it('expires references after 30 seconds', async () => {
    let now = 1000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const { result, rerender } = useFixture();
    await waitFor(() => expect(result.current.loading).toBe(false));
    now += 30_000;
    tables.task_templates = [{ id: 2, task_name: 'New task', task_order: 2 }];
    rerender({ account: user, project: 'Project B' });
    await waitFor(() => expect(result.current.taskTemplates).toEqual(tables.task_templates));
    for (const table of referenceTables) expect(fromCount(table)).toBe(2);
  });

  it('refreshes the currently selected project when a save started in the previous project finishes later', async () => {
    const { result, rerender } = useFixture();
    await waitFor(() => expect(result.current.loading).toBe(false));
    const refreshAfterSave = result.current.fetchAllData;
    rerender({ account: user, project: 'Project B' });
    await waitFor(() => expect(result.current.schedules['P2-1']).toBeDefined());
    await act(async () => { await refreshAfterSave(); });
    expect(result.current.latestUpdatesMap['P2-1'].progress).toBe(25);
    expect(result.current.taskDates['P2-1'].start).toBe('2026-10-02');
  });

  it('shares pending reference requests during a rapid project change and ignores the older project result', async () => {
    const delayed = deferred();
    pending.set('house_types', [delayed.promise]);
    const { result, rerender } = useFixture();
    await waitFor(() => expect(fromCount('house_types')).toBe(1));
    rerender({ account: user, project: 'Project B' });
    await waitFor(() => expect(fromCount('plot_task_assignments')).toBe(2));
    await act(async () => { delayed.resolve({ data: tables.house_types, error: null }); });
    await waitFor(() => expect(result.current.loading).toBe(false));
    for (const table of referenceTables) expect(fromCount(table)).toBe(1);
    expect(result.current.assignments.map(row => row.plot_id)).toEqual(['P2']);
    expect(result.current.schedules['P1-1']).toBeUndefined();
    expect(result.current.schedules['P2-1']).toBeDefined();
  });

  it('clears references on logout and does not apply the previous account response after another login', async () => {
    const delayed = deferred();
    pending.set('house_types', [delayed.promise]);
    const { result, rerender } = useFixture();
    await waitFor(() => expect(fromCount('house_types')).toBe(1));
    rerender({ account: null, project: 'Project A' });
    tables.house_types = [{ id: 2, type_name: 'Next account type' }];
    rerender({ account: { username: 'Admin B', role: 'Admin' }, project: 'Project B' });
    await waitFor(() => expect(result.current.houseTypes).toEqual(tables.house_types));
    await act(async () => { delayed.resolve({ data: [{ id: 1, type_name: 'Old account type' }], error: null }); });
    expect(result.current.houseTypes).toEqual(tables.house_types);
    for (const table of referenceTables) expect(fromCount(table)).toBe(2);
  });

  it('does not start a late refresh callback belonging to the previous account', async () => {
    const { result, rerender } = useFixture();
    await waitFor(() => expect(result.current.loading).toBe(false));
    const previousAccountRefresh = result.current.fetchAllData;
    rerender({ account: { username: 'Admin B', role: 'Admin' }, project: 'Project B' });
    await waitFor(() => expect(result.current.schedules['P2-1']).toBeDefined());
    const calls = mocks.from.mock.calls.length;
    await act(async () => { await previousAccountRefresh(); });
    expect(mocks.from).toHaveBeenCalledTimes(calls);
  });

  it('does not cache failed or partially loaded reference data', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    errors.task_templates = { message: 'temporary failure' };
    const { result, rerender } = useFixture();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.taskTemplates).toEqual([]);
    delete errors.task_templates;
    rerender({ account: user, project: 'Project B' });
    await waitFor(() => expect(result.current.taskTemplates).toEqual(tables.task_templates));
    for (const table of referenceTables) expect(fromCount(table)).toBe(2);
    expect(log).toHaveBeenCalled();
  });

  it('retries all references when a later pagination page fails instead of caching a partial task list', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    pending.set('task_templates', [
      Promise.resolve({ data: Array.from({ length: 1000 }, (_, id) => ({ id, task_name: `Task ${id}` })), error: null }),
      Promise.resolve({ data: [], error: { message: 'second page failed' } }),
    ]);
    const { result, rerender } = useFixture();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.taskTemplates).toEqual([]);
    expect(fromCount('task_templates')).toBe(2);
    rerender({ account: user, project: 'Project B' });
    await waitFor(() => expect(result.current.taskTemplates).toEqual(tables.task_templates));
    expect(fromCount('task_templates')).toBe(3);
    for (const table of referenceTables.filter(table => table !== 'task_templates')) expect(fromCount(table)).toBe(2);
  });

  it('preserves Realtime progress and queue updates after using cached references', async () => {
    const { result, rerender } = useFixture();
    await waitFor(() => expect(result.current.loading).toBe(false));
    rerender({ account: user, project: 'Project B' });
    await waitFor(() => expect(result.current.schedules['P2-1']).toBeDefined());
    tables.vw_inspection_queue = [{ plot_id: 'P2', status: 'updated' }];
    const update = { id: 100, plot_id: 'P2', task_template_id: 1, progress: 80, created_at: '2026-10-07', action: 'Update', role: 'Foreman' };
    await act(async () => { await mocks.handlers.get('task_updates')!({ new: update }); });
    expect(result.current.latestUpdatesMap['P2-1'].progress).toBe(80);
    expect(result.current.allUpdatesRecord).toContainEqual(update);
    expect(result.current.inspectionQueueView).toEqual(tables.vw_inspection_queue);
    for (const table of referenceTables) expect(fromCount(table)).toBe(1);
  });

  it('cancels a scheduled initial load when logout happens before the timer runs', async () => {
    const { rerender } = useFixture();
    rerender({ account: null, project: 'Project A' });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(mocks.from.mock.calls.filter(([name]) => name !== 'users')).toHaveLength(0);
  });
});
