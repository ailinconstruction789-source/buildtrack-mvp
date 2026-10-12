import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSalesStaffOptions } from '../useSalesStaffOptions';

const mocks = vi.hoisted(() => ({ from: vi.fn(), select: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: mocks.from } }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.from.mockReturnValue({ select: mocks.select });
  mocks.select.mockResolvedValue({ data: [], error: null });
});

describe('useSalesStaffOptions', () => {
  it('does not fetch staff before opening a form', () => {
    const { result } = renderHook(() => useSalesStaffOptions(false));
    expect(result.current).toEqual([]);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('reuses a provided list, including an explicitly empty list', () => {
    const options = [{ userId: '1', displayName: 'Sales A' }];
    const { result, rerender } = renderHook(({ provided }) => useSalesStaffOptions(true, provided),
      { initialProps: { provided: options } });
    expect(result.current).toBe(options);
    rerender({ provided: [] });
    expect(result.current).toEqual([]);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('loads only exact sale/sales roles when no list is provided', async () => {
    mocks.select.mockResolvedValue({ data: [
      { id: 1, username: 'Sales A', role: 'Sales' },
      { id: 2, username: 'Sales B', role: ' sale ' },
      { id: 3, username: 'Foreman A', role: 'Foreman' },
      { id: 4, username: 'Admin A', role: 'Admin' },
      { id: 5, username: 'Support A', role: 'Sales Support' }
    ], error: null });
    const { result } = renderHook(() => useSalesStaffOptions(true));
    await waitFor(() => expect(result.current).toEqual([
      { userId: '1', displayName: 'Sales A' }, { userId: '2', displayName: 'Sales B' }
    ]));
    expect(mocks.from).toHaveBeenCalledWith('users');
    expect(mocks.select).toHaveBeenCalledWith('id, username, role');
  });

  it('discards a late response after changing accounts', async () => {
    let resolveOld!: (value: unknown) => void;
    mocks.select.mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve; }))
      .mockResolvedValueOnce({ data: [{ id: 2, username: 'Sales B', role: 'Sales' }], error: null });
    const { result, rerender } = renderHook(({ account }) => useSalesStaffOptions(true, undefined, account),
      { initialProps: { account: 'A' } });
    rerender({ account: 'B' });
    await waitFor(() => expect(result.current).toEqual([{ userId: '2', displayName: 'Sales B' }]));
    await act(async () => resolveOld({ data: [{ id: 1, username: 'Sales A', role: 'Sales' }], error: null }));
    expect(result.current).toEqual([{ userId: '2', displayName: 'Sales B' }]);
  });

  it('does not expose partial staff data on a read error', async () => {
    mocks.select.mockResolvedValue({ data: [{ id: 1, username: 'Sales A', role: 'Sales' }], error: { message: 'denied' } });
    const { result } = renderHook(() => useSalesStaffOptions(true));
    await act(async () => {});
    expect(result.current).toEqual([]);
  });
});
