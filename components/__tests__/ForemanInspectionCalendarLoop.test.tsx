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

  it('excludes is_progress_counted=false and assignment is_excluded=true tasks from monthly workload totals', async () => {
    vi.spyOn(foremanDuty, 'loadForemanMonthlySnapshots').mockResolvedValue([]);

    const plots = [{ id: 'p1', name: 'แปลง 01', foreman_name: 'VIEW', project_name: 'ไอลิน 6' }];
    const tasks = [
      { id: 't1', task_name: 'งานโครงสร้าง', task_order: 1, is_progress_counted: true },
      { id: 't2', task_name: 'งานเฟอร์นิเจอร์', task_order: 2, is_progress_counted: false },
      { id: 't3', task_name: 'งานรั้ว', task_order: 3, is_progress_counted: true },
    ];
    const schedules = {
      'p1-t1': { planned_start: '2026-11-12', planned_end: '2026-11-12' },
      'p1-t2': { planned_start: '2026-11-10', planned_end: '2026-11-14' },
      'p1-t3': { planned_start: '2026-11-10', planned_end: '2026-11-14' },
    };
    const assignments = [
      { plot_id: 'p1', task_template_id: 't1', current_progress: 0, is_excluded: false },
      { plot_id: 'p1', task_template_id: 't2', current_progress: 0, is_excluded: false },
      { plot_id: 'p1', task_template_id: 't3', current_progress: 0, is_excluded: true },
    ];

    render(
      <ForemanInspectionCalendar
        plots={plots}
        taskTemplates={tasks}
        schedules={schedules}
        assignments={assignments}
        foremenList={[{ username: 'VIEW', name: 'View' }]}
      />
    );

    await waitFor(() => {
      expect(
        screen.getAllByText((_, el) =>
          (el?.textContent || '').replace(/\s+/g, ' ').includes('ยอดงานตามแผนในเดือนนี้รวมทั้งสิ้น 1 งาน')
        ).length
      ).toBeGreaterThanOrEqual(1);
    });
  });

  it('locks frozen past days against newly backdated schedules while keeping future gray days dynamic', async () => {
    vi.spyOn(foremanDuty, 'loadForemanMonthlySnapshots').mockResolvedValue([
      {
        id: 'snap-nov11-t1',
        snapshot_date: '2026-11-11',
        plot_id: 'p1',
        project_name: 'ไอลิน 6',
        task_template_id: 't1',
        foreman_name: 'VIEW',
        planned_start: '2026-11-11',
        planned_end: '2026-11-14',
        current_progress: 50,
        is_updated_today: true,
      },
      {
        id: 'snap-nov11-lock',
        snapshot_date: '2026-11-11',
        plot_id: foremanDuty.SNAPSHOT_DAY_LOCK_PLOT_ID,
        project_name: '__SYSTEM__',
        task_template_id: foremanDuty.SNAPSHOT_DAY_LOCK_TASK_PREFIX,
        task_name: 'FROZEN_PAST_DAY',
      },
    ]);

    const plots = [{ id: 'p1', name: 'แปลง 01', foreman_name: 'VIEW', project_name: 'ไอลิน 6' }];
    const tasks = [
      { id: 't1', task_name: 'งานโครงสร้าง', task_order: 1, is_progress_counted: true },
      { id: 't2', task_name: 'งานหลังคา', task_order: 2, is_progress_counted: true },
    ];
    // Suppose t2 was backdated onto Nov 11..14 after Nov 11 was frozen
    const schedules = {
      'p1-t1': { planned_start: '2026-11-11', planned_end: '2026-11-14' },
      'p1-t2': { planned_start: '2026-11-11', planned_end: '2026-11-14' },
    };

    render(
      <ForemanInspectionCalendar
        plots={plots}
        taskTemplates={tasks}
        schedules={schedules}
        foremenList={[{ username: 'VIEW', name: 'View' }]}
      />
    );

    await waitFor(() => {
      // Past frozen day Nov 11 remains 1/1 (ครบ 100%)
      expect(screen.getAllByText('1/1 งาน').length).toBeGreaterThanOrEqual(1);
      // Legend confirms past days are locked
      expect(screen.getByText(/วันย้อนหลังล็อกยอดตาม Snapshot แล้ว/i)).toBeTruthy();
      // Future day Nov 13 reflects both t1 + t2 dynamically (0/2 งาน)
      expect(screen.getAllByText('0/2 งาน').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('marks all Sundays as วันหยุด and excludes Sunday pending counts from monthly KPI totals', async () => {
    vi.spyOn(foremanDuty, 'loadForemanMonthlySnapshots').mockResolvedValue([]);

    const plots = [{ id: 'p1', name: 'แปลง 01', foreman_name: 'VIEW', project_name: 'ไอลิน 6' }];
    const tasks = [{ id: 't1', task_name: 'งานโครงสร้าง', task_order: 1, is_progress_counted: true }];
    // Full Nov 2026 month (includes 5 Sundays: Nov 1, 8, 15, 22, 29, and 25 Mon-Sat workdays)
    const schedules = {
      'p1-t1': { planned_start: '2026-11-01', planned_end: '2026-11-30' },
    };

    render(
      <ForemanInspectionCalendar
        plots={plots}
        taskTemplates={tasks}
        schedules={schedules}
        foremenList={[{ username: 'VIEW', name: 'View' }]}
      />
    );

    await waitFor(() => {
      // Calendar shows 5 Sunday cells with "วันหยุด"
      expect(screen.getAllByText('วันหยุด').length).toBeGreaterThanOrEqual(5);
      // Monthly workload total counts 25 Mon-Sat days (30 - 5 Sundays = 25)
      expect(
        screen.getAllByText((_, el) =>
          (el?.textContent || '').replace(/\s+/g, ' ').includes('ยอดงานตามแผนในเดือนนี้รวมทั้งสิ้น 25 งาน')
        ).length
      ).toBeGreaterThanOrEqual(1);
    });
  });
});
