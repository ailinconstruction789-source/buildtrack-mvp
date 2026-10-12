import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), update: vi.fn(), eq: vi.fn(),
  refresh: vi.fn(), core: vi.fn(), getSession: vi.fn(), onAuth: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: mocks.rpc, from: mocks.from,
  auth: { getSession: mocks.getSession, onAuthStateChange: mocks.onAuth } } }));
vi.mock('@/hooks/useBuildTrackData', () => ({ useBuildTrackData: mocks.core }));
vi.mock('@/components/Sidebar', () => ({ default: () => null }));
vi.mock('next/dynamic', () => ({ default: (loader: () => unknown) => {
  if (loader.toString().includes('DashboardOverview')) return function Dashboard(props: {
    projects: { name: string }[]; setSelectedProject: (project: { name: string }) => void;
    setView: (view: string) => void;
  }) { return <button onClick={() => {
    props.setSelectedProject(props.projects[0]); props.setView('project-detail');
  }}>Open synthetic project</button>; };
  if (loader.toString().includes('MapVisualizer')) return function Map(props: {
    handleLegacyProjectComplete: () => void; isSubmitting: boolean;
  }) { return <button disabled={props.isSubmitting} onClick={props.handleLegacyProjectComplete}>
    Complete synthetic project
  </button>; };
  return () => null;
} }));

interface RpcResult { data: null; error: null | { message: string } }
function deferred() {
  let resolve!: (result: RpcResult) => void;
  const promise = new Promise<RpcResult>(accept => { resolve = accept; });
  return { promise, resolve };
}
const success: RpcResult = { data: null, error: null };
const project = { name: 'Synthetic legacy project', layout_data: [] };
const user = { username: 'Synthetic Admin', role: 'Admin' };
const noop = () => {};
const plots = [
  ...Array.from({ length: 7 }, (_, index) => ({ id: `P${index + 1}`, project_name: project.name, progress: 0 })),
  { id: 'OTHER', project_name: 'Other synthetic project', progress: 0 },
];
const bulkCalls = () => mocks.rpc.mock.calls.filter(([name]) => name === 'bulk_mark_plot_completed');

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear();
  vi.stubEnv('NEXT_PUBLIC_ACCOUNT_TRUSTED_AUTH_ENABLED', 'false');
  vi.stubEnv('NEXT_PUBLIC_LEGACY_AUTHORIZATION_CUTOVER_ENABLED', 'false');
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Synthetic tests have no network')));
  vi.spyOn(window, 'prompt').mockReturnValue(project.name);
  vi.spyOn(console, 'error').mockImplementation(noop);
  mocks.getSession.mockResolvedValue({ data: { session: { user: { user_metadata: user } } }, error: null });
  mocks.onAuth.mockReturnValue({ data: { subscription: { unsubscribe: noop } } });
  mocks.rpc.mockResolvedValue(success);
  mocks.eq.mockResolvedValue({ error: null });
  mocks.update.mockReturnValue({ eq: mocks.eq });
  mocks.from.mockReturnValue({ update: mocks.update });
  mocks.refresh.mockResolvedValue(undefined);
  mocks.core.mockReturnValue({
    ...Object.fromEntries(['houseTypes', 'taskTemplates', 'contractors', 'allUsers', 'assignments',
      'defects', 'defectUpdates', 'notifications', 'allUpdatesRecord', 'materialRequests', 'materialReceipts',
      'inspectionQueueView', 'plotStatuses', 'plotOverallStatuses', 'qcSePerformance'].map(key => [key, []])),
    projects: [project], plots, loading: false, salesDataRevision: 0,
    schedules: {}, latestUpdatesMap: {}, taskDates: {},
    fetchAllData: mocks.refresh, fetchPlotDetails: noop, fetchOwnerAnalyticsData: noop,
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

async function openProject() {
  const { default: Root } = await import('../../app/page');
  render(<Root />);
  fireEvent.click(await screen.findByText('Open synthetic project'));
  return screen.findByRole('button', { name: 'Complete synthetic project' });
}

describe('legacy project completion error handling', () => {
  it('completes all matching plots in batches of at most five and refreshes only after every RPC succeeds', async () => {
    const requests = Array.from({ length: 7 }, deferred);
    let next = 0, active = 0, maximum = 0;
    mocks.rpc.mockImplementation((name: string) => {
      if (name !== 'bulk_mark_plot_completed') return Promise.resolve(success);
      active++; maximum = Math.max(maximum, active);
      return requests[next++].promise.then(result => { active--; return result; });
    });
    const button = await openProject(); fireEvent.click(button);
    await waitFor(() => expect(bulkCalls()).toHaveLength(5));
    expect(button).toBeDisabled(); expect(mocks.refresh).not.toHaveBeenCalled();
    await act(async () => { requests.slice(0, 4).forEach(request => request.resolve(success)); });
    expect(bulkCalls()).toHaveLength(5); expect(mocks.refresh).not.toHaveBeenCalled();
    await act(async () => { requests[4].resolve(success); });
    await waitFor(() => expect(bulkCalls()).toHaveLength(7));
    expect(mocks.refresh).not.toHaveBeenCalled();
    await act(async () => { requests.slice(5).forEach(request => request.resolve(success)); });
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce());
    expect(maximum).toBe(5); expect(button).toBeEnabled();
    expect(mocks.from).toHaveBeenCalledExactlyOnceWith('plots');
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith({ sale_status: 'ready_for_sale' });
    expect(mocks.eq).toHaveBeenCalledExactlyOnceWith('project_name', project.name);
    expect(bulkCalls().map(([, args]) => args)).toEqual(plots.slice(0, 7).map(plot => ({
      p_plot_id: plot.id, p_username: user.username, p_role: user.role,
    })));
    expect(screen.queryByText('ข้อผิดพลาด')).not.toBeInTheDocument();
  });

  it('checks a returned RPC error, waits for its batch siblings, and reports possible partial completion without starting later plots', async () => {
    const slow = deferred();
    mocks.rpc.mockImplementation((name: string, args?: { p_plot_id: string }) => {
      if (name !== 'bulk_mark_plot_completed') return Promise.resolve(success);
      if (args?.p_plot_id === 'P1') return slow.promise;
      return Promise.resolve(args?.p_plot_id === 'P2' ? { data: null, error: { message: 'Synthetic RPC denied' } } : success);
    });
    const button = await openProject(); fireEvent.click(button);
    await waitFor(() => expect(bulkCalls()).toHaveLength(5));
    expect(button).toBeDisabled(); expect(screen.queryByText('ข้อผิดพลาด')).not.toBeInTheDocument();
    await act(async () => { slow.resolve(success); });
    await screen.findByText(/Synthetic RPC denied/);
    expect(screen.getByText(/บางรายการอาจอัปเดตไปแล้ว/)).toBeInTheDocument();
    expect(bulkCalls()).toHaveLength(5); expect(mocks.refresh).not.toHaveBeenCalled();
    expect(button).toBeEnabled(); expect(mocks.from).toHaveBeenCalledExactlyOnceWith('plots');
  });

  it('reports a rejected transport request and stops the remaining batches', async () => {
    mocks.rpc.mockImplementation((name: string, args?: { p_plot_id: string }) =>
      name === 'bulk_mark_plot_completed' && args?.p_plot_id === 'P3'
        ? Promise.reject(new Error('Synthetic transport failure')) : Promise.resolve(success));
    const button = await openProject(); fireEvent.click(button);
    await screen.findByText(/Synthetic transport failure/);
    expect(bulkCalls()).toHaveLength(5); expect(mocks.refresh).not.toHaveBeenCalled(); expect(button).toBeEnabled();
  });

  it('does not call any completion RPC when marking plots ready for sale fails', async () => {
    mocks.eq.mockResolvedValue({ error: { message: 'Synthetic plot update denied' } });
    const button = await openProject(); fireEvent.click(button);
    await screen.findByText('Synthetic plot update denied');
    expect(bulkCalls()).toHaveLength(0); expect(mocks.refresh).not.toHaveBeenCalled(); expect(button).toBeEnabled();
    expect(screen.queryByText(/บางรายการอาจอัปเดตไปแล้ว/)).not.toBeInTheDocument();
  });
});
