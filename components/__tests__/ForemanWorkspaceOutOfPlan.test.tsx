import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import ForemanWorkspaceView from '../ForemanWorkspaceView';
import * as foremanDuty from '@/lib/foremanDuty';

describe('ForemanWorkspaceView Out-of-Plan integration in Schedule tab', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(foremanDuty, 'loadForemanDailySnapshot').mockResolvedValue({
      status: 'empty',
      storage: 'none',
      data: [],
    } as any);
  });

  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const todayStr = `${y}-${m}-${d}`;

  const mockPlots = [
    { id: 'p1', name: 'แปลง 01', foreman_name: 'LEAB', project_name: 'ไอลิน 6' },
    { id: 'p2', name: 'แปลง 02', foreman_name: 'LEAB', project_name: 'ไอลิน 6' },
  ];

  const mockTemplates = [
    { id: 't1', task_name: 'งานเสา', task_order: 1 },
    { id: 't2', task_name: 'งานคาน', task_order: 2 },
  ];

  // Schedule: p1-t1 is planned for today
  // p2-t2 is planned for next week -> out of plan today
  const mockSchedules = {
    'p1-t1': { planned_start: todayStr, planned_end: todayStr },
    'p2-t2': { planned_start: '2026-12-10', planned_end: '2026-12-15' },
  };

  const mockUpdates = [
    // In-plan update today
    {
      id: 'u1',
      plot_id: 'p1',
      task_template_id: 't1',
      created_at: `${todayStr}T10:00:00Z`,
      action: 'เทคอนกรีต 100%',
      progress: 100,
      user_name: 'LEAB',
    },
    // Out-of-plan update today (early advance work on p2-t2)
    {
      id: 'u2',
      plot_id: 'p2',
      task_template_id: 't2',
      created_at: `${todayStr}T14:30:00Z`,
      action: 'เข้าผูกเหล็กคานล่วงหน้า',
      progress: 40,
      user_name: 'LEAB',
    },
  ];

  it('renders out-of-plan KPI card and effort summary on daily scheduled tasks screen', async () => {
    render(
      <ForemanWorkspaceView
        plots={mockPlots}
        projects={[{ name: 'ไอลิน 6' }]}
        taskTemplates={mockTemplates}
        schedules={mockSchedules}
        allUpdatesRecord={mockUpdates}
        loggedInUser={{ username: 'LEAB', name: 'LEAB' }}
        currentUserRole="foreman"
        isForeman={true}
        onNavigateToTaskChat={vi.fn()}
      />
    );

    // Should display KPI card for "นอกแผน / ล่วงหน้า"
    const outPlanLabel = await screen.findAllByText(/นอกแผน \/ ล่วงหน้า/i);
    expect(outPlanLabel.length).toBeGreaterThan(0);

    // Effort summary banner: โฟร์แมนตรวจและอัปเดตงานจริงรวม
    expect(screen.getByText(/สรุปการลงพื้นที่จริงวันนี้/i)).toBeDefined();

    // Check filter pill for out-of-plan
    const outPlanPill = screen.getByRole('button', { name: /นอกแผน \/ ล่วงหน้า \(1\)/i });
    expect(outPlanPill).toBeDefined();

    // Clicking filter pill switches to out-of-plan view showing p2-t2
    fireEvent.click(outPlanPill);

    expect(screen.getByText('งานคาน')).toBeDefined();
    expect(screen.getByText(/เข้าผูกเหล็กคานล่วงหน้า/i)).toBeDefined();
    expect(screen.getByText(/แปลง 02/i)).toBeDefined();
  });

  it('Option B: displays Sunday holiday banner when viewing a Sunday while keeping scheduled tasks accessible', async () => {
    const sundaySchedules = {
      'p1-t1': { planned_start: '2026-11-06', planned_end: '2026-11-10' },
    };

    render(
      <ForemanWorkspaceView
        plots={mockPlots}
        projects={[{ name: 'ไอลิน 6' }]}
        taskTemplates={mockTemplates}
        schedules={sundaySchedules}
        allUpdatesRecord={[]}
        loggedInUser={{ username: 'LEAB', name: 'LEAB' }}
        currentUserRole="foreman"
        isForeman={true}
        onNavigateToTaskChat={vi.fn()}
      />
    );

    // Switch date picker to Sunday 2026-11-08
    const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement;
    expect(dateInput).toBeTruthy();
    fireEvent.change(dateInput, { target: { value: '2026-11-08' } });

    const banner = await screen.findByTestId('sunday-holiday-banner');
    expect(banner.textContent).toContain('วันนี้เป็นวันหยุดประจำสัปดาห์ (ไม่บังคับตรวจ)');

    // Option B: scheduled task list still renders on Sunday so foreman can optionally update it
    expect(await screen.findByText('งานเสา')).toBeDefined();
  });
});
