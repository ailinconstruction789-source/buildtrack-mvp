import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import React, { useState } from 'react';
import ForemanInspectionCalendar from '../ForemanInspectionCalendar';
import * as foremanDuty from '@/lib/foremanDuty';

describe('Finding 1 & 15: ForemanInspectionCalendar Loop & Project Filtering', () => {
  const mockPlots = [
    { id: 'p1', name: 'แปลง 01', foreman_name: 'LEAB', project_name: 'ไอลิน 6' },
    { id: 'p2', name: 'แปลง 02', foreman_name: 'LEAB', project_name: 'ไอลิน 7' },
  ];
  const mockTaskTemplates = [
    { id: 't1', task_name: 'งานโครงสร้าง', task_order: 1 },
  ];
  const mockSchedules = {
    'p1-t1': { planned_start: '2026-11-01', planned_end: '2026-11-10' },
    'p2-t1': { planned_start: '2026-11-01', planned_end: '2026-11-10' },
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('Finding 1: does NOT loop fetch when snapshots prop is omitted', async () => {
    let callCount = 0;
    vi.spyOn(foremanDuty, 'loadForemanMonthlySnapshots').mockImplementation(() => {
      callCount++;
      return Promise.resolve([]);
    });

    render(
      <ForemanInspectionCalendar
        plots={mockPlots}
        taskTemplates={mockTaskTemplates}
        schedules={mockSchedules}
      />
    );

    // Wait for initial render and fetch
    await waitFor(() => {
      expect(callCount).toBe(1);
    });

    // Wait for idle period: count must stay 1, NOT loop infinitely to 9+
    await new Promise(r => setTimeout(r, 200));
    expect(callCount).toBe(1);
  });

  it('Finding 1: parent rerender without prop changes does not increase fetch count endlessly', async () => {
    let callCount = 0;
    vi.spyOn(foremanDuty, 'loadForemanMonthlySnapshots').mockImplementation(() => {
      callCount++;
      return Promise.resolve([]);
    });

    function ParentWrapper() {
      const [tick, setTick] = useState(0);
      return (
        <div>
          <button data-testid="rerender-btn" onClick={() => setTick(t => t + 1)}>
            Rerender
          </button>
          <ForemanInspectionCalendar
            plots={mockPlots}
            taskTemplates={mockTaskTemplates}
            schedules={mockSchedules}
          />
        </div>
      );
    }

    render(<ParentWrapper />);

    await waitFor(() => {
      expect(callCount).toBe(1);
    });

    // Trigger parent rerender 3 times
    const btn = screen.getByTestId('rerender-btn');
    act(() => {
      btn.click();
      btn.click();
      btn.click();
    });

    await new Promise(r => setTimeout(r, 100));
    // Must remain 1 fetch!
    expect(callCount).toBe(1);
  });

  it('Finding 1: rapid month switching discards stale out-of-order response', async () => {
    let resolveMonth11: (v: any[]) => void;
    let resolveMonth12: (v: any[]) => void;

    vi.spyOn(foremanDuty, 'loadForemanMonthlySnapshots').mockImplementation((year, month) => {
      if (month === 11) {
        return new Promise(resolve => {
          resolveMonth11 = resolve;
        });
      }
      return new Promise(resolve => {
        resolveMonth12 = resolve;
      });
    });

    render(
      <ForemanInspectionCalendar
        plots={mockPlots}
        taskTemplates={mockTaskTemplates}
        schedules={mockSchedules}
      />
    );

    // Initial month is 11 (Nov 2026)
    // Switch to Next month (12)
    const nextBtn = screen.getByTitle(/เดือนถัดไป/i);
    act(() => {
      nextBtn.click();
    });

    // Suppose Month 12 resolves FIRST
    await act(async () => {
      resolveMonth12([
        { id: 'snap-12', snapshot_date: '2026-12-05', task_name: 'Dec Task' }
      ]);
    });

    // Suppose Month 11 resolves LATER (out-of-order)
    await act(async () => {
      resolveMonth11([
        { id: 'snap-11', snapshot_date: '2026-11-05', task_name: 'Nov Task' }
      ]);
    });

    // The calendar must show Dec 2026 and NOT be overwritten by Nov 2026 response
    expect(screen.getAllByText(/ธันวาคม 2569/i).length).toBeGreaterThanOrEqual(1);
  });

  it('Finding 15: filters plots and snapshots by projectName', async () => {
    const monthlySpy = vi.spyOn(foremanDuty, 'loadForemanMonthlySnapshots').mockResolvedValue([]);

    render(
      <ForemanInspectionCalendar
        plots={mockPlots}
        taskTemplates={mockTaskTemplates}
        schedules={mockSchedules}
        projectName="ไอลิน 6"
      />
    );

    await waitFor(() => {
      expect(monthlySpy).toHaveBeenCalledWith(
        expect.any(Number),
        expect.any(Number),
        expect.any(String),
        'ไอลิน 6',
        undefined,
        expect.objectContaining({ plotIds: expect.any(Array) })
      );
    });
  });
});
