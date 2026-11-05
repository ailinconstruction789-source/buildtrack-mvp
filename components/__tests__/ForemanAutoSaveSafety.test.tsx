import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import React from 'react';
import ForemanWorkspaceView from '../ForemanWorkspaceView';
import * as foremanDuty from '@/lib/foremanDuty';

describe('Finding 2: Foreman Auto-Save Safety & Concurrency', () => {
  const mockPlots = [
    { id: 'p1', name: 'แปลง 01', foreman_name: 'LEAB', project_name: 'ไอลิน 6' },
  ];
  const mockTaskTemplates = [
    { id: 't1', task_name: 'งานเสาเข็ม', task_order: 1 },
  ];
  const mockSchedules = {
    'p1-t1': { planned_start: '2026-11-01', planned_end: '2026-11-10' },
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('does NOT trigger premature auto-save while snapshot read is pending (> 600ms)', async () => {
    vi.useFakeTimers();

    const saveSpy = vi.spyOn(foremanDuty, 'saveForemanDailySnapshot').mockResolvedValue({ success: true, count: 1, storage: 'remote', isRemoteSynced: true });

    // Simulate slow read taking 2000ms
    let resolveRead: (val: any) => void;
    const slowReadPromise = new Promise(resolve => {
      resolveRead = resolve;
    });
    vi.spyOn(foremanDuty, 'loadForemanDailySnapshot').mockReturnValue(slowReadPromise as any);

    render(
      <ForemanWorkspaceView
        plots={mockPlots}
        projects={[{ id: 'proj-1', name: 'ไอลิน 6' }]}
        taskTemplates={mockTaskTemplates}
        schedules={mockSchedules}
        loggedInUser={{ username: 'LEAB', role: 'Foreman' }}
        currentUserRole="Foreman"
        isForeman={true}
        onNavigateToTaskChat={vi.fn()}
      />
    );

    // Fast-forward past 600ms timer while read is still in progress
    await act(async () => {
      vi.advanceTimersByTime(800);
    });

    // saveForemanDailySnapshot must NOT have been called while read was loading!
    expect(saveSpy).not.toHaveBeenCalled();

    // Now complete the read
    await act(async () => {
      resolveRead({ status: 'empty', storage: 'remote', data: [] });
      vi.advanceTimersByTime(50);
    });

    // Now after read completes, timer can proceed
    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    vi.useRealTimers();
  });

  it('does NOT auto-save if reading snapshot failed with an error', async () => {
    vi.useFakeTimers();
    const saveSpy = vi.spyOn(foremanDuty, 'saveForemanDailySnapshot').mockResolvedValue({ success: true, count: 1, storage: 'remote', isRemoteSynced: true });
    vi.spyOn(foremanDuty, 'loadForemanDailySnapshot').mockRejectedValue(new Error('DB Network Down'));

    render(
      <ForemanWorkspaceView
        plots={mockPlots}
        projects={[{ id: 'proj-1', name: 'ไอลิน 6' }]}
        taskTemplates={mockTaskTemplates}
        schedules={mockSchedules}
        loggedInUser={{ username: 'LEAB', role: 'Foreman' }}
        currentUserRole="Foreman"
        isForeman={true}
        onNavigateToTaskChat={vi.fn()}
      />
    );

    // Fast-forward
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    // Must NOT treat read failure as empty history and must NOT trigger auto-save write
    expect(saveSpy).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it('cancels pending timer and does NOT write stale scope when date switches quickly', async () => {
    vi.useFakeTimers();
    const saveSpy = vi.spyOn(foremanDuty, 'saveForemanDailySnapshot').mockResolvedValue({ success: true, count: 1, storage: 'remote', isRemoteSynced: true });
    vi.spyOn(foremanDuty, 'loadForemanDailySnapshot').mockResolvedValue({ status: 'empty', storage: 'remote', data: [] });

    const { rerender } = render(
      <ForemanWorkspaceView
        plots={mockPlots}
        projects={[{ id: 'proj-1', name: 'ไอลิน 6' }]}
        taskTemplates={mockTaskTemplates}
        schedules={mockSchedules}
        loggedInUser={{ username: 'LEAB', role: 'Foreman' }}
        currentUserRole="Foreman"
        isForeman={true}
        onNavigateToTaskChat={vi.fn()}
      />
    );

    // Before timer fires (300ms < 600ms), switch date or unmount
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    // Rerender with different props / unmount
    rerender(<div />);

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    // Stale timer must have been cleared
    expect(saveSpy).not.toHaveBeenCalled();

    vi.useRealTimers();
  });
});
