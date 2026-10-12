import React, { useCallback, useEffect, useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TaskProgressView from '../TaskProgressView';
import DefectProgressView from '../DefectProgressView';

const database = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: database }));

interface HistoryRow {
  id: string;
  progress: number;
  note: string;
  text_content: string;
  user_name: string;
  role: string;
  created_at: string;
}
interface QueryResult { data: HistoryRow[] | null; error: { message: string } | null }
interface PendingRead {
  resolve: (result: QueryResult) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  filters: Array<[string, unknown]>;
  table: string;
}
const reads: PendingRead[] = [];
const noop = () => {};
const row = (note: string, progress: number): HistoryRow => ({
  id: note, note, text_content: note, progress, user_name: 'Foreman A', role: 'Foreman', created_at: '2026-10-08T00:00:00Z',
});
const ok = (...data: HistoryRow[]): QueryResult => ({ data, error: null });

function Timeline({ kind, selectedId = 'A', plotId = 'P1', accountId = 1, authUserId = 'auth-A', role = 'Foreman', active = true, observeUpdates = noop, send = noop, externalHistory }: {
  kind: 'task' | 'defect'; selectedId?: string; plotId?: string; accountId?: number; authUserId?: string; role?: string;
  active?: boolean; observeUpdates?: (data: HistoryRow[]) => void; send?: () => void;
  externalHistory?: HistoryRow[];
}) {
  const [updates, setUpdatesState] = useState<HistoryRow[]>([]);
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    if (externalHistory) {
      setUpdatesState(externalHistory);
      setProgress(externalHistory.at(-1)?.progress || 0);
    }
  }, [externalHistory]);
  const setUpdates = useCallback((data: HistoryRow[]) => {
    observeUpdates(data);
    setUpdatesState(data);
  }, [observeUpdates]);
  const shared = {
    view: active ? `${kind}-progress` : 'house-detail', setView: noop,
    taskReturnView: 'house-detail', defectReturnView: 'house-detail', isMobileLayout: true,
    selectedTask: { id: selectedId, task_name: `Task ${selectedId}`, task_order: 1 },
    selectedDefect: { id: selectedId, description: `Defect ${selectedId}`, task_order: 1 },
    selectedPlot: { id: plotId }, loggedInUser: { id: accountId, authUserId, username: `User ${accountId}` },
    currentUserRole: role, updates, setUpdates, progressValue: progress, setProgressValue: setProgress,
    isSending: false, setFullImageUrl: noop, handleDeleteUpdate: noop, handleDeleteDefectUpdate: noop,
    setExportModalOpen: noop, isProjectPlanner: false, isAdmin: role === 'Admin', inputText: '', setInputText: noop,
    selectedFiles: [], setSelectedFiles: noop, isTaskCompleted: false, handleOpenExportModal: noop,
    setDefectModal: noop, defects: [], isLockedForForeman: false, isSiteEngineer: role === 'Site Engineer', isPendingSE: role === 'Site Engineer',
    handleReviewAction: send, isQC: role === 'QC', isPendingQC: role === 'QC', isProcurement: false, isOwner: false,
    handleSendPost: send, handleAdminUndoLatest: send, handleAdminResetToZero: send,
  };
  return kind === 'task' ? <TaskProgressView {...shared} /> : <DefectProgressView {...shared} />;
}

beforeEach(() => {
  reads.length = 0;
  database.from.mockReset();
  database.from.mockImplementation((table: string) => {
    let resolve!: PendingRead['resolve'];
    let reject!: PendingRead['reject'];
    const promise = new Promise<QueryResult>((res, rej) => { resolve = res; reject = rej; });
    const read: PendingRead = { resolve, reject, table, filters: [] };
    reads.push(read);
    const builder = {
      select: vi.fn(() => builder),
      eq: vi.fn((column: string, value: unknown) => { read.filters.push([column, value]); return builder; }),
      order: vi.fn(() => builder),
      abortSignal: vi.fn((signal: AbortSignal) => { read.signal = signal; return promise; }),
    };
    return builder;
  });
});
afterEach(cleanup);

describe.each(['task', 'defect'] as const)('%s timeline loading', kind => {
  it('invalidates history when trusted auth identity changes despite identical display fields', async () => {
    const { rerender } = render(<Timeline kind={kind} authUserId="auth-A" />);
    rerender(<Timeline kind={kind} authUserId="auth-B" />);
    expect(reads[0].signal?.aborted).toBe(true);
    await act(async () => { reads[1].resolve(ok(row('Current auth history', 35))); });
    await act(async () => { reads[0].resolve(ok(row('Old auth history', 90))); });
    expect(screen.queryByText('Old auth history')).not.toBeInTheDocument();
    expect(screen.getByRole('slider')).toHaveValue('35');
  });

  it('ignores a late response after changing the selected work item', async () => {
    const observe = vi.fn();
    const { rerender } = render(<Timeline kind={kind} observeUpdates={observe} />);
    expect(screen.getByRole('slider')).toBeDisabled();
    expect(reads[0].table).toBe(`${kind}_updates`);
    expect(reads[0].filters).toContainEqual([kind === 'task' ? 'task_template_id' : 'defect_id', 'A']);
    rerender(<Timeline kind={kind} selectedId="B" observeUpdates={observe} />);
    expect(reads[0].signal?.aborted).toBe(true);
    await act(async () => { reads[1].resolve(ok(row('B history', 65))); });
    expect(screen.getByText('B history')).toBeInTheDocument();
    expect(screen.getByRole('slider')).toHaveValue('65');
    observe.mockClear();
    await act(async () => { reads[0].resolve(ok(row('A late history', 95))); });
    expect(screen.queryByText('A late history')).not.toBeInTheDocument();
    expect(screen.getByRole('slider')).toHaveValue('65');
    expect(observe).not.toHaveBeenCalled();
  });

  it('does not expose a previous account history or permit submission before the new account read', async () => {
    const send = vi.fn();
    const { rerender } = render(<Timeline kind={kind} send={send} />);
    await act(async () => { reads[0].resolve(ok(row('Account one history', 40))); });
    expect(screen.getByRole('slider')).toBeEnabled();
    rerender(<Timeline kind={kind} accountId={2} send={send} />);
    expect(screen.queryByText('Account one history')).not.toBeInTheDocument();
    expect(screen.getByRole('slider')).toBeDisabled();
    fireEvent.keyDown(screen.getByPlaceholderText('อธิบายงาน...'), { key: 'Enter' });
    expect(send).not.toHaveBeenCalled();
    await act(async () => { reads[1].resolve(ok(row('Account two history', 20))); });
    expect(screen.getByText('Account two history')).toBeInTheDocument();
    expect(screen.getByRole('slider')).toHaveValue('20');
  });

  it('cancels an in-flight read on unmount and leaves parent state untouched', async () => {
    const observe = vi.fn();
    const { unmount } = render(<Timeline kind={kind} observeUpdates={observe} />);
    observe.mockClear();
    unmount();
    expect(reads[0].signal?.aborted).toBe(true);
    await act(async () => { reads[0].resolve(ok(row('Unmounted response', 90))); });
    expect(observe).not.toHaveBeenCalled();
  });

  it('ignores a late read started by a previous account', async () => {
    const observe = vi.fn();
    const { rerender } = render(<Timeline kind={kind} observeUpdates={observe} />);
    rerender(<Timeline kind={kind} accountId={2} observeUpdates={observe} />);
    expect(reads[0].signal?.aborted).toBe(true);
    await act(async () => { reads[1].resolve(ok(row('New account data', 35))); });
    observe.mockClear();
    await act(async () => { reads[0].resolve(ok(row('Previous account private history', 85))); });
    expect(screen.queryByText('Previous account private history')).not.toBeInTheDocument();
    expect(screen.getByRole('slider')).toHaveValue('35');
    expect(observe).not.toHaveBeenCalled();
  });

  it('cancels and ignores reads when leaving the timeline view', async () => {
    const observe = vi.fn();
    const { rerender } = render(<Timeline kind={kind} observeUpdates={observe} />);
    observe.mockClear();
    rerender(<Timeline kind={kind} active={false} observeUpdates={observe} />);
    expect(reads[0].signal?.aborted).toBe(true);
    await act(async () => { reads[0].resolve(ok(row('Inactive timeline response', 95))); });
    expect(observe).not.toHaveBeenCalled();
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
  });

  it('does not trust shared history replaced by another view when re-entering the same selection', async () => {
    const { rerender } = render(<Timeline kind={kind} />);
    await act(async () => { reads[0].resolve(ok(row('Previous successful timeline', 30))); });
    const foreign = [row('Other view shared history', 90)];
    rerender(<Timeline kind={kind} active={false} externalHistory={foreign} />);
    rerender(<Timeline kind={kind} externalHistory={foreign} />);
    expect(screen.queryByText('Other view shared history')).not.toBeInTheDocument();
    expect(screen.queryByText('Previous successful timeline')).not.toBeInTheDocument();
    expect(screen.getByRole('slider')).toBeDisabled();
    await act(async () => { reads[1].resolve(ok(row('Fresh current timeline', 35))); });
    expect(screen.getByText('Fresh current timeline')).toBeInTheDocument();
    expect(screen.getByRole('slider')).toHaveValue('35');
  });

  it.each(['Site Engineer', 'QC'])('blocks %s approval actions until successful history loading', async role => {
    const review = vi.fn();
    render(<Timeline kind={kind} role={role} send={review} />);
    const approvalName = role === 'QC' ? 'QC ผ่าน (Complete)' : 'ตรวจสอบผ่าน';
    const button = screen.getByRole('button', { name: approvalName });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(review).not.toHaveBeenCalled();
    await act(async () => { reads[0].resolve(ok(row('Verified review history', 100))); });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(review).toHaveBeenCalledWith(true);
  });

  it('rejects partial data returned with an error and supports retrying an empty successful history', async () => {
    const send = vi.fn();
    const { container } = render(<Timeline kind={kind} send={send} />);
    await act(async () => { reads[0].resolve({ data: [row('Partial history', 90)], error: { message: 'network error' } }); });
    expect(screen.queryByText('Partial history')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('โหลดประวัติไม่สำเร็จ');
    expect(screen.getByRole('slider')).toBeDisabled();
    const sendButton = container.querySelector('footer fieldset button')!;
    fireEvent.click(sendButton);
    expect(send).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'ลองใหม่' }));
    expect(reads).toHaveLength(2);
    await act(async () => { reads[1].resolve(ok()); });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('slider')).toBeEnabled();
    expect(screen.getByRole('slider')).toHaveValue('0');
    fireEvent.keyDown(screen.getByPlaceholderText('อธิบายงาน...'), { key: 'Enter' });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('retains successful same-selection history and progress when a refresh fails', async () => {
    const originalObserver = vi.fn();
    const { rerender } = render(<Timeline kind={kind} observeUpdates={originalObserver} />);
    await act(async () => { reads[0].resolve(ok(row('Saved history', 45))); });
    const refreshObserver = vi.fn();
    rerender(<Timeline kind={kind} observeUpdates={refreshObserver} />);
    expect(screen.getByText('Saved history')).toBeInTheDocument();
    await act(async () => { reads[1].resolve({ data: null, error: { message: 'temporary failure' } }); });
    expect(screen.getByText('Saved history')).toBeInTheDocument();
    expect(screen.getByRole('slider')).toHaveValue('45');
    expect(screen.getByRole('slider')).toBeDisabled();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(refreshObserver).not.toHaveBeenCalled();
  });

  it('handles rejected reads without unhandled promises and keeps admin mutation actions unavailable', async () => {
    render(<Timeline kind={kind} role="Admin" />);
    await act(async () => { reads[0].reject(new Error('network disconnected')); });
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.queryByText('Undo ล่าสุด')).not.toBeInTheDocument();
    expect(screen.queryByText('Reset 0%')).not.toBeInTheDocument();
    expect(screen.getByRole('slider')).toBeDisabled();
  });

  it('restarts the read when a plot changes or an account role changes', async () => {
    const { rerender } = render(<Timeline kind={kind} />);
    rerender(<Timeline kind={kind} plotId="P2" />);
    expect(reads[0].signal?.aborted).toBe(true);
    rerender(<Timeline kind={kind} plotId="P2" role="Admin" />);
    expect(reads[1].signal?.aborted).toBe(true);
    expect(reads).toHaveLength(3);
    await act(async () => { reads[2].resolve(ok(row('Current plot and role', 30))); });
    expect(screen.getByText('Current plot and role')).toBeInTheDocument();
    await act(async () => { reads[1].resolve(ok(row('Previous role response', 80))); });
    expect(screen.queryByText('Previous role response')).not.toBeInTheDocument();
  });
});
