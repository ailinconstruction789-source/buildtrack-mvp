import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useConstructionBillingData, type ConstructionBillingActor, type ConstructionBillingRow } from '../useConstructionBillingData';

const database = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: database }));

interface Result { data: ConstructionBillingRow[] | null; error: { message: string } | null }
interface Query {
  table: string; select: unknown[]; orders: Array<[string, { ascending: boolean }]>;
  range: [number, number]; signal?: AbortSignal;
}
interface Pending extends Query { resolve: (result: Result) => void; reject: (error: Error) => void }
const pending: Pending[] = [];
const queries: Query[] = [];
let automaticRows: ConstructionBillingRow[] | null = null;
const actor: ConstructionBillingActor = { id: 1, userId: 'legacy-A', authUserId: 'auth-A', username: 'Synthetic Admin', role: 'Admin' };
const rows = (from: number, count: number): ConstructionBillingRow[] => Array.from({ length: count }, (_, index) => ({
  assignment_id: from + index, latest_update_created_at: '2026-10-08T12:00:00Z', marker: 'Synthetic billing row',
}));
const ok = (data: ConstructionBillingRow[]): Result => ({ data, error: null });

beforeEach(() => {
  pending.length = 0; queries.length = 0; automaticRows = null; database.from.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  database.from.mockImplementation((table: string) => {
    const query: Query = { table, select: [], orders: [], range: [0, 0] };
    const builder = {
      select: vi.fn((...args: unknown[]) => { query.select = args; return builder; }),
      order: vi.fn((column: string, options: { ascending: boolean }) => { query.orders.push([column, options]); return builder; }),
      range: vi.fn((from: number, to: number) => { query.range = [from, to]; return builder; }),
      abortSignal: vi.fn((signal: AbortSignal) => {
        query.signal = signal; queries.push(query);
        if (automaticRows) {
          const sorted = [...automaticRows].sort((a, b) => {
            for (const [column, { ascending }] of query.orders) {
              const left = a[column]; const right = b[column];
              const compared = column === 'assignment_id' ? Number(left) - Number(right) : String(left).localeCompare(String(right));
              if (compared) return ascending ? compared : -compared;
            }
            return 0;
          });
          return Promise.resolve(ok(sorted.slice(query.range[0], query.range[1] + 1)));
        }
        let resolve!: Pending['resolve']; let reject!: Pending['reject'];
        const promise = new Promise<Result>((accept, fail) => { resolve = accept; reject = fail; });
        pending.push({ ...query, resolve, reject });
        return promise;
      }),
    };
    return builder;
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('construction billing complete ordered reads', () => {
  it('loads all tied-timestamp pages using unique assignment IDs without a count request', async () => {
    automaticRows = rows(1, 3381).reverse();
    const { result } = renderHook(() => useConstructionBillingData(actor, true));
    await waitFor(() => expect(result.current.billingData).toHaveLength(3381));
    expect(result.current.billingData.map(row => row.assignment_id)).toEqual(rows(1, 3381).map(row => row.assignment_id));
    expect(new Set(result.current.billingData.map(row => row.assignment_id)).size).toBe(3381);
    expect(queries.map(query => query.range)).toEqual([[0, 999], [1000, 1999], [2000, 2999], [3000, 3999]]);
    for (const query of queries) {
      expect(query.table).toBe('vw_billing_queue');
      expect(query.select).toEqual(['*']);
      expect(query.orders).toEqual([
        ['latest_update_created_at', { ascending: false }], ['assignment_id', { ascending: true }],
      ]);
    }
    expect(result.current.loadingBilling).toBe(false);
  });

  it('checks beyond a full final page and only publishes a complete result', async () => {
    const { result } = renderHook(() => useConstructionBillingData(actor, true));
    expect(result.current.loadingBilling).toBe(true);
    await act(async () => { pending[0].resolve(ok(rows(1, 1000))); });
    await waitFor(() => expect(pending).toHaveLength(2));
    expect(result.current.billingData).toEqual([]);
    expect(pending[1].range).toEqual([1000, 1999]);
    await act(async () => { pending[1].resolve(ok([])); });
    expect(result.current.billingData).toHaveLength(1000);
    expect(result.current.loadingBilling).toBe(false);
  });

  it('preserves the previous same-actor snapshot when a later page returns partial data plus an error', async () => {
    const { result } = renderHook(() => useConstructionBillingData(actor, true));
    const saved = rows(1, 5);
    await act(async () => { pending[0].resolve(ok(saved)); });
    let refresh!: Promise<void>;
    act(() => { refresh = result.current.fetchBillingData(); });
    await act(async () => { pending[1].resolve(ok(rows(100, 1000))); });
    await waitFor(() => expect(pending).toHaveLength(3));
    await act(async () => { pending[2].resolve({ data: rows(1100, 5), error: { message: 'Synthetic page error' } }); await refresh; });
    expect(result.current.billingData).toEqual(saved);
    expect(result.current.loadingBilling).toBe(false);
  });

  it.each(['rejected', 'null data'])('preserves successful rows after a %s refresh failure', async mode => {
    const { result } = renderHook(() => useConstructionBillingData(actor, true));
    const saved = rows(1, 2);
    await act(async () => { pending[0].resolve(ok(saved)); });
    let refresh!: Promise<void>;
    act(() => { refresh = result.current.fetchBillingData(); });
    await act(async () => {
      if (mode === 'rejected') pending[1].reject(new Error('Synthetic disconnected network'));
      else pending[1].resolve({ data: null, error: null });
      await refresh;
    });
    expect(result.current.billingData).toEqual(saved);
    expect(result.current.loadingBilling).toBe(false);
  });
});

describe('construction billing request scopes', () => {
  it.each([null, undefined])('does not query without an actor (%s), including manual refresh', async user => {
    const { result } = renderHook(() => useConstructionBillingData(user, true));
    await act(async () => { await result.current.fetchBillingData(); result.current.setBillingData(rows(1, 1)); });
    expect(database.from).not.toHaveBeenCalled();
    expect(result.current.billingData).toEqual([]);
    expect(result.current.loadingBilling).toBe(false);
  });

  it('does not query while inactive and starts one read on entry', async () => {
    const { result, rerender } = renderHook(({ active }) => useConstructionBillingData(actor, active), { initialProps: { active: false } });
    await act(async () => { await result.current.fetchBillingData(); });
    expect(database.from).not.toHaveBeenCalled();
    rerender({ active: true });
    expect(pending).toHaveLength(1);
    await act(async () => { pending[0].resolve(ok(rows(1, 1))); });
    expect(result.current.billingData).toHaveLength(1);
  });

  it.each(['id', 'userId', 'authUserId', 'username', 'name', 'role'] as const)('clears account rows and rejects the previous request when actor %s changes', async field => {
    const { result, rerender } = renderHook(({ user }) => useConstructionBillingData(user, true), { initialProps: { user: actor } });
    await act(async () => { pending[0].resolve(ok(rows(1, 1))); });
    const staleRefresh = result.current.fetchBillingData;
    const staleSetter = result.current.setBillingData;
    act(() => { void result.current.fetchBillingData(); });
    const next = { ...actor, [field]: field === 'id' ? 2 : `changed-${field}` };
    rerender({ user: next });
    expect(pending[1].signal?.aborted).toBe(true);
    expect(result.current.billingData).toEqual([]);
    expect(pending).toHaveLength(3);
    await act(async () => { staleSetter(rows(99, 1)); await staleRefresh(); });
    expect(pending).toHaveLength(3);
    expect(result.current.billingData).toEqual([]);
    await act(async () => { pending[2].resolve(ok(rows(20, 2))); });
    await act(async () => { pending[1].resolve(ok(rows(100, 10))); });
    expect(result.current.billingData).toEqual(rows(20, 2));
    expect(result.current.loadingBilling).toBe(false);
  });

  it('keeps snapshot on leave/re-entry while discarding late responses and old callbacks', async () => {
    const { result, rerender } = renderHook(({ active }) => useConstructionBillingData(actor, active), { initialProps: { active: true } });
    const saved = rows(1, 2);
    await act(async () => { pending[0].resolve(ok(saved)); });
    const oldRefresh = result.current.fetchBillingData;
    const oldSetter = result.current.setBillingData;
    act(() => { void result.current.fetchBillingData(); });
    rerender({ active: false });
    expect(pending[1].signal?.aborted).toBe(true);
    expect(result.current.billingData).toEqual(saved);
    expect(result.current.loadingBilling).toBe(false);
    await act(async () => { pending[1].resolve(ok(rows(50, 2))); });
    rerender({ active: true });
    expect(result.current.billingData).toEqual(saved);
    expect(pending).toHaveLength(3);
    await act(async () => { oldSetter(rows(88, 1)); await oldRefresh(); });
    expect(pending).toHaveLength(3);
    expect(result.current.billingData).toEqual(saved);
    await act(async () => { pending[2].resolve(ok(rows(10, 3))); });
    expect(result.current.billingData).toEqual(rows(10, 3));
  });

  it('lets only the newest forced refresh settle data and loading state', async () => {
    const { result } = renderHook(() => useConstructionBillingData(actor, true));
    let older!: Promise<void>; let newer!: Promise<void>;
    act(() => { older = result.current.fetchBillingData(); newer = result.current.fetchBillingData(); });
    expect(pending).toHaveLength(3);
    expect(pending[0].signal?.aborted).toBe(true);
    expect(pending[1].signal?.aborted).toBe(true);
    await act(async () => { pending[1].resolve(ok(rows(10, 1))); await older; });
    expect(result.current.loadingBilling).toBe(true);
    expect(result.current.billingData).toEqual([]);
    await act(async () => { pending[2].resolve(ok(rows(20, 1))); await newer; });
    await act(async () => { pending[0].resolve(ok(rows(1, 1))); });
    expect(result.current.billingData).toEqual(rows(20, 1));
    expect(result.current.loadingBilling).toBe(false);
  });

  it('aborts on unmount and makes retained refresh/setter callbacks inert', async () => {
    const { result, unmount } = renderHook(() => useConstructionBillingData(actor, true));
    const refresh = result.current.fetchBillingData; const set = result.current.setBillingData;
    unmount();
    expect(pending[0].signal?.aborted).toBe(true);
    await act(async () => { pending[0].resolve(ok(rows(1, 1))); set(rows(10, 1)); await refresh(); });
    expect(pending).toHaveLength(1);
    expect(console.error).not.toHaveBeenCalled();
  });

  it('supports current-actor array/functional setters and invalidates them after sign-out', async () => {
    const initialProps: { user: ConstructionBillingActor | null } = { user: actor };
    const { result, rerender } = renderHook(({ user }) => useConstructionBillingData(user, true), { initialProps });
    await act(async () => { pending[0].resolve(ok(rows(1, 1))); });
    act(() => { result.current.setBillingData(previous => [...previous, ...rows(2, 1)]); });
    expect(result.current.billingData).toEqual(rows(1, 2));
    const oldSetter = result.current.setBillingData;
    rerender({ user: null });
    const update = vi.fn((previous: ConstructionBillingRow[]) => [...previous, ...rows(3, 1)]);
    act(() => { oldSetter(update); });
    expect(update).not.toHaveBeenCalled();
    expect(result.current.billingData).toEqual([]);
  });

  it('does not revive retained callbacks when returning to the same account after a switch', async () => {
    const { result, rerender } = renderHook(({ user }) => useConstructionBillingData(user, true), { initialProps: { user: actor } });
    const originalRefresh = result.current.fetchBillingData;
    const originalSetter = result.current.setBillingData;
    rerender({ user: { ...actor, id: 2 } });
    rerender({ user: actor });
    expect(pending).toHaveLength(3);
    await act(async () => {
      await originalRefresh();
      originalSetter(rows(99, 1));
    });
    expect(pending).toHaveLength(3);
    expect(result.current.billingData).toEqual([]);
    await act(async () => { pending[2].resolve(ok(rows(30, 1))); });
    await act(async () => { pending[0].resolve(ok(rows(1, 1))); pending[1].resolve(ok(rows(20, 1))); });
    expect(result.current.billingData).toEqual(rows(30, 1));
  });
});
