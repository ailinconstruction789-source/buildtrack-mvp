import React from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCommittedRequestScope } from '../../hooks/useCommittedRequestScope';

// Run the actual parent handler initializers, without bootstrapping unrelated dashboards/auth.
// TypeScript AST extraction preserves their implementation rather than copying guarded logic.
const source = readFileSync(path.resolve(process.cwd(), 'app/page.tsx'), 'utf8');
const sourceFile = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const initializers = new Map<string, string>();
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
    initializers.set(node.name.text, node.initializer.getText(sourceFile));
  }
  ts.forEachChild(node, visit);
}
visit(sourceFile);

type ParentHandler = (...args: unknown[]) => Promise<void>;
const compiledFactories = new Map<string, (...values: unknown[]) => unknown>();
function evaluateInitializer<T>(name: string, context: Record<string, unknown>): T {
  const initializer = initializers.get(name);
  if (!initializer) throw new Error(`Missing production initializer: ${name}`);
  let factory = compiledFactories.get(name);
  if (!factory) {
    const compiled = ts.transpileModule(`const actualInitializer = ${initializer};`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
    }).outputText;
    factory = new Function(...Object.keys(context), `${compiled}\nreturn actualInitializer;`) as (...values: unknown[]) => unknown;
    compiledFactories.set(name, factory);
  }
  return factory(...Object.values(context)) as T;
}

interface HistoryRow { id: string; progress: number; text_content: string; note: string }
interface Result { data: HistoryRow[] | null; error: null | { message: string } }
const previousHistory: HistoryRow[] = [{ id: 'existing', progress: 40, text_content: 'Existing snapshot', note: 'Existing snapshot' }];
const refreshedHistory: HistoryRow[] = [{ id: 'refreshed', progress: 65, text_content: 'Refreshed snapshot', note: 'Refreshed snapshot' }];
const initialUndoHistory: HistoryRow[] = [{ id: 'latest', progress: 90, text_content: '', note: '' }, ...previousHistory];
const success: Result = { data: null, error: null };
function deferred() {
  let resolve!: (result: Result) => void;
  const promise = new Promise<Result>(accept => { resolve = accept; });
  return { promise, resolve };
}

const pendingReads: ReturnType<typeof deferred>[] = [];
const writeCalls: Array<{ table: string; method: string; payload?: unknown; filters: Array<[string, unknown]> }> = [];
const database = { from: vi.fn() };
const setters = {
  setUpdates: vi.fn(), setProgressValue: vi.fn(), setInputText: vi.fn(), setSelectedFiles: vi.fn(),
  setIsWorkerPresent: vi.fn(), setIsSending: vi.fn(), setGlobalUploadState: vi.fn(),
};
const showAlert = vi.fn();
const fetchAllData = vi.fn();
let confirmation: (() => Promise<void>) | null = null;
let handlers: Record<string, ParentHandler> = {};

interface Selection {
  activeView: string; taskId: string; defectId: string; plotId: string;
  userId: number; authUserId: string; username: string; role: string;
}
const baseSelection: Selection = {
  activeView: 'task-progress', taskId: 'TASK-A', defectId: 'DEFECT-A', plotId: 'PLOT-A',
  userId: 1, authUserId: 'synthetic-auth-A', username: 'Synthetic Foreman', role: 'Foreman',
};
const handlerCases = [
  { name: 'handleSendPost', args: [], defect: false, progress: null, clearsDraft: true },
  { name: 'handleSendDefectPost', args: [], defect: true, progress: null, clearsDraft: true },
  { name: 'handleDeleteUpdate', args: ['UPDATE-A', 'TASK-A', 'PLOT-A'], defect: false, progress: 65, clearsDraft: false },
  { name: 'handleDeleteDefectUpdate', args: ['UPDATE-A', 'DEFECT-A', 'PLOT-A'], defect: true, progress: 65, clearsDraft: false },
  { name: 'handleReviewAction', args: [true], defect: false, progress: 100, clearsDraft: true },
  { name: 'handleAdminUndoLatest', args: ['TASK-A', 'PLOT-A'], defect: false, progress: 40, clearsDraft: false },
  { name: 'handleAdminResetToZero', args: ['TASK-A', 'PLOT-A'], defect: false, progress: 0, clearsDraft: false },
  { name: 'handleDefectAdminUndoLatest', args: ['DEFECT-A'], defect: true, progress: 40, clearsDraft: false },
  { name: 'handleDefectAdminResetToZero', args: ['DEFECT-A'], defect: true, progress: 0, clearsDraft: false },
];

function ParentHandlerHarness(selection: Selection) {
  const loggedInUser = { id: selection.userId, authUserId: selection.authUserId, username: selection.username, role: selection.role };
  const scopeContext = {
    activeView: selection.activeView, selectedPlot: { id: selection.plotId, foreman: 'Synthetic Foreman' },
    selectedTask: { id: selection.taskId, task_name: 'Synthetic Task' }, selectedDefect: { id: selection.defectId },
    loggedInUser, useCommittedRequestScope,
  };
  // Evaluate the actual key expression from page.tsx, using the production hook.
  const captureTimelineScope = evaluateInitializer<ReturnType<typeof useCommittedRequestScope>>('captureTimelineScope', scopeContext);
  const context = {
    ...scopeContext, captureTimelineScope, ...setters, supabase: database,
    currentUserRole: selection.role, isWorkerPresent: true, inputText: 'Synthetic unsent draft',
    selectedFiles: [], isSending: false, progressValue: 65, updates: previousHistory, weatherInfo: null,
    uploadImagesInQueue: vi.fn().mockResolvedValue([]), showAlert, fetchAllData,
    closeDialog: vi.fn(), showConfirm: (_title: string, _message: string, confirm: () => Promise<void>) => { confirmation = confirm; },
  };
  handlers = Object.fromEntries(handlerCases.map(({ name }) => [name, evaluateInitializer<ParentHandler>(name, context)]));
  return null;
}

beforeEach(() => {
  pendingReads.length = 0; writeCalls.length = 0; confirmation = null; handlers = {};
  Object.values(setters).forEach(mock => mock.mockReset());
  showAlert.mockReset(); fetchAllData.mockReset(); database.from.mockReset();
  database.from.mockImplementation((table: string) => {
    let method = 'select';
    let ascending = true;
    let payload: unknown;
    const filters: Array<[string, unknown]> = [];
    const builder = {
      select: vi.fn(() => { method = 'select'; return builder; }),
      insert: vi.fn((data: unknown) => { method = 'insert'; payload = data; return builder; }),
      update: vi.fn((data: unknown) => { method = 'update'; payload = data; return builder; }),
      delete: vi.fn(() => { method = 'delete'; return builder; }),
      eq: vi.fn((column: string, value: unknown) => { filters.push([column, value]); return builder; }),
      order: vi.fn((_column: string, options: { ascending: boolean }) => { ascending = options.ascending; return builder; }),
      then: (accept: (result: Result) => unknown, reject?: (error: unknown) => unknown) => {
        if (method !== 'select') {
          writeCalls.push({ table, method, payload, filters });
          return Promise.resolve(success).then(accept, reject);
        }
        if (!ascending) return Promise.resolve({ data: initialUndoHistory, error: null }).then(accept, reject);
        const read = deferred(); pendingReads.push(read);
        return read.promise.then(accept, reject);
      },
    };
    return builder;
  });
});
afterEach(cleanup);

async function startHandler(name: string, args: unknown[]) {
  let completion!: Promise<void>;
  act(() => {
    completion = Promise.resolve(handlers[name](...args)).then(async () => {
      if (confirmation) { const confirm = confirmation; confirmation = null; await confirm(); }
    });
  });
  await waitFor(() => expect(pendingReads).toHaveLength(1));
  expect(writeCalls.length).toBeGreaterThan(0);
  return { completion, read: pendingReads[0] };
}
function expectSnapshotUntouched() {
  expect(setters.setUpdates).not.toHaveBeenCalled();
  expect(setters.setProgressValue).not.toHaveBeenCalled();
  expect(setters.setInputText).not.toHaveBeenCalled();
  expect(setters.setSelectedFiles).not.toHaveBeenCalled();
  expect(setters.setIsWorkerPresent).not.toHaveBeenCalled();
}

describe.each(handlerCases)('actual parent $name history refresh', handler => {
  const selection = { ...baseSelection, activeView: handler.defect ? 'defect-progress' : 'task-progress' };

  it('applies refreshed history and existing success behavior when the committed selection stays current', async () => {
    render(<ParentHandlerHarness {...selection} />);
    const { read, completion } = await startHandler(handler.name, handler.args);
    await act(async () => { read.resolve({ data: refreshedHistory, error: null }); await completion; });
    expect(setters.setUpdates).toHaveBeenCalledExactlyOnceWith(refreshedHistory);
    if (handler.progress === null) expect(setters.setProgressValue).not.toHaveBeenCalled();
    else expect(setters.setProgressValue).toHaveBeenCalledExactlyOnceWith(handler.progress);
    if (handler.clearsDraft) {
      expect(setters.setInputText).toHaveBeenCalledExactlyOnceWith('');
      expect(setters.setSelectedFiles).toHaveBeenCalledExactlyOnceWith([]);
    } else {
      expect(setters.setInputText).not.toHaveBeenCalled();
      expect(setters.setSelectedFiles).not.toHaveBeenCalled();
    }
    expect(fetchAllData).toHaveBeenCalled();
  });

  it.each(['work item', 'view', 'plot', 'account', 'auth identity', 'role', 'leave and return', 'unmount'])('does not overwrite the new timeline after changing %s while history is pending', async changed => {
    const { rerender, unmount } = render(<ParentHandlerHarness {...selection} />);
    const { read, completion } = await startHandler(handler.name, handler.args);
    if (changed === 'unmount') unmount();
    else if (changed === 'leave and return') {
      rerender(<ParentHandlerHarness {...selection} activeView="house-detail" />);
      rerender(<ParentHandlerHarness {...selection} />);
    } else {
      const next = { ...selection };
      if (changed === 'work item') {
        if (handler.defect) next.defectId = 'DEFECT-B'; else next.taskId = 'TASK-B';
      }
      if (changed === 'view') next.activeView = 'house-detail';
      if (changed === 'plot') next.plotId = 'PLOT-B';
      if (changed === 'account') { next.userId = 2; next.username = 'Synthetic Other Foreman'; }
      if (changed === 'auth identity') next.authUserId = 'synthetic-auth-B';
      if (changed === 'role') next.role = 'QC';
      rerender(<ParentHandlerHarness {...next} />);
    }
    await act(async () => { read.resolve({ data: refreshedHistory, error: null }); await completion; });
    expectSnapshotUntouched();
  });

  it('preserves snapshot and draft when history refresh returns an error, even with partial data', async () => {
    render(<ParentHandlerHarness {...selection} />);
    const { read, completion } = await startHandler(handler.name, handler.args);
    await act(async () => { read.resolve({ data: refreshedHistory, error: { message: 'Synthetic refresh failure' } }); await completion; });
    expectSnapshotUntouched();
    expect(showAlert).toHaveBeenCalledWith('Error', 'Synthetic refresh failure');
  });
});
