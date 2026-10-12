import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useConstructionScheduleToday } from '../constructionScheduleToday';

let visibilityDescriptor: PropertyDescriptor | undefined;
beforeEach(() => {
  visibilityDescriptor = Object.getOwnPropertyDescriptor(document, 'visibilityState');
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 8, 23, 59, 59));
});
afterEach(() => {
  cleanup(); vi.useRealTimers();
  if (visibilityDescriptor) Object.defineProperty(document, 'visibilityState', visibilityDescriptor);
  else Reflect.deleteProperty(document, 'visibilityState');
});

describe('construction schedule current day', () => {
  it('advances once after local midnight and retains only one next-midnight timer', () => {
    const { result, rerender, unmount } = renderHook(useConstructionScheduleToday);
    expect(result.current.getDate()).toBe(8);
    expect(result.current.getHours()).toBe(0);
    expect(vi.getTimerCount()).toBe(1);
    act(() => { vi.advanceTimersByTime(1100); });
    expect(result.current.getDate()).toBe(9);
    expect(vi.getTimerCount()).toBe(1);
    const current = result.current;
    rerender();
    expect(result.current).toBe(current);
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('refreshes when a suspended page becomes visible and removes the listener on unmount', () => {
    const { result, unmount } = renderHook(useConstructionScheduleToday);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    act(() => {
      vi.setSystemTime(new Date(2026, 9, 10, 12));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(result.current.getDate()).toBe(8);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(result.current.getDate()).toBe(10);
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    document.dispatchEvent(new Event('visibilitychange'));
    expect(vi.getTimerCount()).toBe(0);
  });
});
