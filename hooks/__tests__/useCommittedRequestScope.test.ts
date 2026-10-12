import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useCommittedRequestScope } from '../useCommittedRequestScope';

afterEach(cleanup);

describe('committed construction request scopes', () => {
  it('accepts multiple completions while the same selection remains committed', () => {
    const { result, rerender } = renderHook(({ key }) => useCommittedRequestScope(key), { initialProps: { key: 'task-A' } });
    const first = result.current();
    const second = result.current();
    rerender({ key: 'task-A' });
    expect(first()).toBe(true);
    expect(second()).toBe(true);
  });

  it.each(['task-B', 'plot-B', 'defect-B', 'account-B', 'dashboard'])('rejects the old completion after switching to %s', key => {
    const { result, rerender } = renderHook(({ key }) => useCommittedRequestScope(key), { initialProps: { key: 'task-A' } });
    const old = result.current();
    rerender({ key });
    expect(old()).toBe(false);
    expect(result.current()()).toBe(true);
  });

  it('rejects a completion even after leaving and returning to the same task', () => {
    const { result, rerender } = renderHook(({ key }) => useCommittedRequestScope(key), { initialProps: { key: 'task-A' } });
    const old = result.current();
    rerender({ key: 'task-B' });
    rerender({ key: 'task-A' });
    expect(old()).toBe(false);
    expect(result.current()()).toBe(true);
  });

  it('rejects pending completions after unmount', () => {
    const { result, unmount } = renderHook(() => useCommittedRequestScope('task-A'));
    const old = result.current();
    unmount();
    expect(old()).toBe(false);
  });
});
