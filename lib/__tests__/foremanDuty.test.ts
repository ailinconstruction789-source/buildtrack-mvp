import { describe, it, expect } from 'vitest';
import {
  ROADBLOCK_REASONS,
  getRoadblockReason,
  normalizeDateStr,
  getPlotForemanName,
  getForemanScheduledTasksForDate,
  computeForemanDailySummary,
  getForemanReworkItems,
} from '../foremanDuty';

describe('foremanDuty helper library', () => {
  describe('normalizeDateStr', () => {
    it('normalizes YYYY-MM-DD directly', () => {
      expect(normalizeDateStr('2026-11-04')).toBe('2026-11-04');
    });

    it('normalizes ISO string with timestamp', () => {
      expect(normalizeDateStr('2026-11-04T08:30:00.000Z')).toBe('2026-11-04');
    });

    it('normalizes Date instance', () => {
      const d = new Date(2026, 10, 4); // Nov 4, 2026
      expect(normalizeDateStr(d)).toBe('2026-11-04');
    });

    it('returns null on invalid date', () => {
      expect(normalizeDateStr(null)).toBeNull();
      expect(normalizeDateStr('')).toBeNull();
      expect(normalizeDateStr('invalid-date')).toBeNull();
    });
  });

  describe('ROADBLOCK_REASONS', () => {
    it('contains all 6 required reasons', () => {
      const ids = ROADBLOCK_REASONS.map(r => r.id);
      expect(ids).toContain('prior_task_delayed');
      expect(ids).toContain('cannot_start');
      expect(ids).toContain('material_issue');
      expect(ids).toContain('worker_issue');
      expect(ids).toContain('weather_issue');
      expect(ids).toContain('other');
    });

    it('resolves metadata with getRoadblockReason', () => {
      const reason = getRoadblockReason('material_issue');
      expect(reason?.label).toContain('วัสดุ');
      expect(reason?.icon).toBe('🧱');

      const custom = getRoadblockReason('custom_reason');
      expect(custom?.label).toBe('custom_reason');
    });
  });

  describe('getForemanScheduledTasksForDate', () => {
    const mockPlots = [
      { id: 'plot-1', name: 'แปลง A-01', house_type_id: 'ht-1', foreman_name: 'LEAB', project_name: 'ไอลิน 6' },
      { id: 'plot-2', name: 'แปลง A-02', house_type_id: 'ht-1', foreman: 'VIEW', project_name: 'ไอลิน 6' },
      { id: 'plot-3', name: 'แปลง A-03', house_type_id: 'ht-1', foreman_name: 'LEAB', project_name: 'ไอลิน 6' },
    ];

    const mockTaskTemplates = [
      { id: 'task-1', task_name: 'งานฐานราก', task_order: 1, house_type_id: 'ht-1' },
      { id: 'task-2', task_name: 'งานโครงสร้างเสา-คาน', task_order: 2, house_type_id: 'ht-1' },
      { id: 'task-3', task_name: 'งานมุงหลังคา', task_order: 3, house_type_id: 'ht-1' },
    ];

    const targetDate = '2026-11-04';

    const mockSchedules: Record<string, any> = {
      // Plot 1 (LEAB):
      // Task 1 is overdue (ended yesterday 2026-11-03)
      'plot-1-task-1': { planned_start: '2026-10-25', planned_end: '2026-11-03' },
      // Task 2 is active today (2026-11-02 to 2026-11-06)
      'plot-1-task-2': { planned_start: '2026-11-02', planned_end: '2026-11-06' },
      // Task 3 is in future (starts 2026-11-10)
      'plot-1-task-3': { planned_start: '2026-11-10', planned_end: '2026-11-20' },

      // Plot 2 (VIEW):
      // Task 2 is active today
      'plot-2-task-2': { planned_start: '2026-11-01', planned_end: '2026-11-05' },

      // Plot 3 (LEAB):
      // Task 2 is active today
      'plot-3-task-2': { planned_start: '2026-11-03', planned_end: '2026-11-07' },
    };

    const mockAssignments = [
      { plot_id: 'plot-1', task_template_id: 'task-2', current_progress: 30, contractor_name: 'ช่างสมชาย' },
      { plot_id: 'plot-3', task_template_id: 'task-2', current_progress: 0, contractor_name: 'ช่างวิชัย' },
    ];

    const mockUpdates = [
      // Update made today on Plot 1 Task 2
      {
        id: 101,
        plot_id: 'plot-1',
        task_template_id: 'task-2',
        role: 'Foreman',
        action: 'เทคานชั้น 2 เรียบร้อย 50%',
        created_at: '2026-11-04T10:15:00Z',
      },
    ];

    it('filters tasks exclusively for the specified foreman', () => {
      const leabTasks = getForemanScheduledTasksForDate({
        plots: mockPlots,
        taskTemplates: mockTaskTemplates,
        schedules: mockSchedules,
        assignments: mockAssignments,
        allUpdatesRecord: mockUpdates,
        foremanName: 'LEAB',
        targetDate,
      });

      // Plot 1 (task-2) and Plot 3 (task-2) -> 2 tasks
      expect(leabTasks.length).toBe(2);
      expect(leabTasks.every(t => t.foreman_name === 'LEAB')).toBe(true);
    });

    it('enforces Rule 1: EXCLUDES overdue tasks where targetDate > planned_end', () => {
      const tasks = getForemanScheduledTasksForDate({
        plots: mockPlots,
        taskTemplates: mockTaskTemplates,
        schedules: mockSchedules,
        assignments: mockAssignments,
        allUpdatesRecord: mockUpdates,
        foremanName: 'LEAB',
        targetDate,
      });

      // task-1 ended 2026-11-03, targetDate is 2026-11-04 -> MUST NOT be included
      const hasTask1 = tasks.some(t => t.task_template_id === 'task-1');
      expect(hasTask1).toBe(false);
    });

    it('excludes future tasks where targetDate < planned_start', () => {
      const tasks = getForemanScheduledTasksForDate({
        plots: mockPlots,
        taskTemplates: mockTaskTemplates,
        schedules: mockSchedules,
        assignments: mockAssignments,
        allUpdatesRecord: mockUpdates,
        foremanName: 'LEAB',
        targetDate,
      });

      // task-3 starts 2026-11-10 -> MUST NOT be included
      const hasTask3 = tasks.some(t => t.task_template_id === 'task-3');
      expect(hasTask3).toBe(false);
    });

    it('marks is_updated_today = true when update exists on targetDate', () => {
      const tasks = getForemanScheduledTasksForDate({
        plots: mockPlots,
        taskTemplates: mockTaskTemplates,
        schedules: mockSchedules,
        assignments: mockAssignments,
        allUpdatesRecord: mockUpdates,
        foremanName: 'LEAB',
        targetDate,
      });

      const plot1Task2 = tasks.find(t => t.plot_id === 'plot-1' && t.task_template_id === 'task-2');
      expect(plot1Task2?.is_updated_today).toBe(true);
      expect(plot1Task2?.last_action).toContain('เทคานชั้น 2');

      const plot3Task2 = tasks.find(t => t.plot_id === 'plot-3' && t.task_template_id === 'task-2');
      expect(plot3Task2?.is_updated_today).toBe(false);
    });

    it('returns all foreman tasks when foremanName is "all"', () => {
      const allTasks = getForemanScheduledTasksForDate({
        plots: mockPlots,
        taskTemplates: mockTaskTemplates,
        schedules: mockSchedules,
        assignments: mockAssignments,
        allUpdatesRecord: mockUpdates,
        foremanName: 'all',
        targetDate,
      });

      // Plot 1 task 2 (LEAB), Plot 2 task 2 (VIEW), Plot 3 task 2 (LEAB) = 3 tasks
      expect(allTasks.length).toBe(3);
    });
  });

  describe('computeForemanDailySummary', () => {
    it('calculates compliance rate with both updates and roadblock reports', () => {
      const tasks = [
        {
          id: 'p1-t1',
          plot_id: 'p1',
          plot_name: 'A-01',
          project_name: 'ไอลิน 6',
          foreman_name: 'LEAB',
          task_template_id: 't1',
          task_name: 'งานเสา',
          planned_start: '2026-11-04',
          planned_end: '2026-11-06',
          current_progress: 20,
          is_updated_today: true,
        },
        {
          id: 'p1-t2',
          plot_id: 'p1',
          plot_name: 'A-01',
          project_name: 'ไอลิน 6',
          foreman_name: 'LEAB',
          task_template_id: 't2',
          task_name: 'งานคาน',
          planned_start: '2026-11-04',
          planned_end: '2026-11-06',
          current_progress: 0,
          is_updated_today: false,
          status_reason: 'prior_task_delayed',
          status_note: 'รอเสาบ่มตัว',
        },
        {
          id: 'p2-t1',
          plot_id: 'p2',
          plot_name: 'A-02',
          project_name: 'ไอลิน 6',
          foreman_name: 'LEAB',
          task_template_id: 't1',
          task_name: 'งานหลังคา',
          planned_start: '2026-11-04',
          planned_end: '2026-11-06',
          current_progress: 0,
          is_updated_today: false,
        },
      ];

      const summary = computeForemanDailySummary(tasks);

      expect(summary.totalTasks).toBe(3);
      expect(summary.updatedTasks).toBe(1);
      expect(summary.roadblockTasks).toBe(1);
      expect(summary.pendingTasks).toBe(1);
      expect(summary.plotsCount).toBe(2);
      // Compliance = (1 updated + 1 roadblock) / 3 * 100 = 67%
      expect(summary.complianceRate).toBe(67);
    });

    it('returns 100% compliance when no tasks are scheduled', () => {
      const summary = computeForemanDailySummary([]);
      expect(summary.totalTasks).toBe(0);
      expect(summary.complianceRate).toBe(100);
    });
  });

  describe('getForemanReworkItems', () => {
    const mockPlots = [
      { id: 'p1', name: 'A-01', foreman_name: 'LEAB', project_name: 'ไอลิน 6' },
      { id: 'p2', name: 'A-02', foreman_name: 'VIEW', project_name: 'ไอลิน 6' },
    ];

    const mockDefects = [
      { id: 1, plot_id: 'p1', task_id: 't1', description: 'เสาเอียง', status: 'open', severity: 'high' },
      { id: 2, plot_id: 'p1', task_id: 't2', description: 'สีลอก', status: 'resolved', severity: 'low' }, // resolved -> should be excluded
      { id: 3, plot_id: 'p2', task_id: 't1', description: 'กระเบื้องแตก', status: 'open', severity: 'medium' },
    ];

    const mockUpdates = [
      {
        id: 99,
        plot_id: 'p1',
        task_template_id: 't3',
        action: 'QC ตรวจไม่ผ่าน สั่งแจ้งแก้ไข',
        text: 'รอยต่อคานไม่เรียบเนียน',
        created_at: '2026-11-04T12:00:00Z',
      },
    ];

    const mockTemplates = [
      { id: 't1', task_name: 'งานเสา' },
      { id: 't2', task_name: 'งานทาสี' },
      { id: 't3', task_name: 'งานคาน' },
    ];

    it('collects active defects and rejected tasks for a specific foreman', () => {
      const leabItems = getForemanReworkItems({
        plots: mockPlots,
        defects: mockDefects,
        allUpdatesRecord: mockUpdates,
        taskTemplates: mockTemplates,
        foremanName: 'LEAB',
      });

      // Defect 1 (open) + Task Rework 99 = 2 items
      expect(leabItems.length).toBe(2);
      expect(leabItems.some(i => i.type === 'defect' && i.description === 'เสาเอียง')).toBe(true);
      expect(leabItems.some(i => i.type === 'task_rework' && i.title.includes('งานคาน'))).toBe(true);
      // Defect 2 is resolved -> not included
      expect(leabItems.some(i => i.description === 'สีลอก')).toBe(false);
    });

    it('collects all items when foremanName is "all"', () => {
      const allItems = getForemanReworkItems({
        plots: mockPlots,
        defects: mockDefects,
        allUpdatesRecord: mockUpdates,
        taskTemplates: mockTemplates,
        foremanName: 'all',
      });

      // Defect 1 (p1), Defect 3 (p2), Task Rework 99 (p1) = 3 items
      expect(allItems.length).toBe(3);
    });
  });
});
