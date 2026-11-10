import { describe, it, expect } from 'vitest';
import {
  ROADBLOCK_REASONS,
  getRoadblockReason,
  normalizeDateStr,
  getPlotForemanName,
  getForemanScheduledTasksForDate,
  computeForemanDailySummary,
  getForemanReworkItems,
  getMonthlyForemanInspectionCompliance,
  getForemanDailyActivities,
  recordForemanTaskRoadblockReason,
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

    it('flags is_completed_early = true when a task reached 100% before targetDate', () => {
      const customAssignments = [
        ...mockAssignments,
        // Plot 3 task 2 reached 100% on 2026-11-02 (before targetDate 2026-11-04)
        { plot_id: 'plot-3', task_template_id: 'task-2', current_progress: 100, actual_end_date: '2026-11-02' },
      ];

      const tasks = getForemanScheduledTasksForDate({
        plots: mockPlots,
        taskTemplates: mockTaskTemplates,
        schedules: mockSchedules,
        assignments: customAssignments,
        allUpdatesRecord: mockUpdates,
        foremanName: 'LEAB',
        targetDate,
      });

      const plot3Task2 = tasks.find(t => t.plot_id === 'plot-3' && t.task_template_id === 'task-2');
      expect(plot3Task2?.is_completed_early).toBe(true);

      const summary = computeForemanDailySummary(tasks);
      // Plot 1 task 2 is the only active task
      expect(summary.totalTasks).toBe(1);
      expect(summary.completedEarlyTasks).toBe(1);
      expect(summary.updatedTasks).toBe(1);
      expect(summary.complianceRate).toBe(100);
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

    it('excludes completed early tasks from totalTasks and pendingTasks without penalizing compliance', () => {
      const tasks: any[] = [
        // 1 active task updated today
        {
          id: 'p1-t1',
          plot_id: 'p1',
          foreman_name: 'LEAB',
          task_name: 'งานฐานราก',
          current_progress: 100,
          is_updated_today: true,
          is_completed_early: false,
        },
        // 2 tasks already completed 100% prior to today
        {
          id: 'p1-t2',
          plot_id: 'p1',
          foreman_name: 'LEAB',
          task_name: 'งานมุงหลังคา',
          current_progress: 100,
          is_updated_today: false,
          is_completed_early: true,
        },
        {
          id: 'p1-t3',
          plot_id: 'p1',
          foreman_name: 'LEAB',
          task_name: 'งานฉาบปูน',
          current_progress: 100,
          is_updated_today: false,
          is_completed_early: true,
        },
      ];

      const summary = computeForemanDailySummary(tasks);

      // Only 1 active task
      expect(summary.totalTasks).toBe(1);
      expect(summary.updatedTasks).toBe(1);
      expect(summary.pendingTasks).toBe(0);
      expect(summary.completedEarlyTasks).toBe(2);
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

  describe('getMonthlyForemanInspectionCompliance', () => {
    const mockPlots = [
      { id: 'p1', name: 'A-01', foreman_name: 'LEAB', project_name: 'ไอลิน 6' },
    ];
    const mockTemplates = [
      { id: 't1', task_name: 'งานเสา' },
    ];
    const mockSchedules = {
      'p1-t1': { planned_start: '2026-11-01', planned_end: '2026-11-05' },
    };
    const mockUpdates = [
      { plot_id: 'p1', task_template_id: 't1', created_at: '2026-11-02T10:00:00Z', action: 'เทเสา 50%' },
    ];

    it('generates 30 days for November 2026 and computes compliance per day', () => {
      const monthly = getMonthlyForemanInspectionCompliance({
        year: 2026,
        month: 11,
        plots: mockPlots,
        taskTemplates: mockTemplates,
        schedules: mockSchedules,
        allUpdatesRecord: mockUpdates,
        foremanName: 'LEAB',
        todayDateStr: '2026-11-04',
      });

      expect(monthly.days.length).toBe(30);
      expect(monthly.monthLabel).toContain('พฤศจิกายน');

      // Nov 2: Has schedule & update -> 100% complete
      const nov2 = monthly.days.find(d => d.date === '2026-11-02');
      expect(nov2?.totalScheduled).toBe(1);
      expect(nov2?.updated).toBe(1);
      expect(nov2?.status).toBe('complete');

      // Nov 3: Has schedule, no update -> missed
      const nov3 = monthly.days.find(d => d.date === '2026-11-03');
      expect(nov3?.totalScheduled).toBe(1);
      expect(nov3?.updated).toBe(0);
      expect(nov3?.status).toBe('missed');

      // Nov 10: Out of schedule range -> empty
      const nov10 = monthly.days.find(d => d.date === '2026-11-10');
      expect(nov10?.totalScheduled).toBe(0);
      expect(nov10?.status).toBe('empty');

      // Nov 15: In future -> future
      const nov15 = monthly.days.find(d => d.date === '2026-11-15');
      expect(nov15?.isFuture).toBe(true);
    });
  });

  describe('getForemanDailyActivities', () => {
    const mockPlots = [
      { id: 'p1', name: 'A-01', foreman_name: 'LEAB', project_name: 'ไอลิน 6' },
      { id: 'p2', name: 'A-02', foreman_name: 'LEAB', project_name: 'ไอลิน 6' },
      { id: 'p3', name: 'B-01', foreman_name: 'SOMCHAI', project_name: 'ไอลิน 6' },
    ];
    const mockTemplates = [
      { id: 't1', task_name: 'งานเสา' },
      { id: 't2', task_name: 'งานคาน' },
      { id: 't3', task_name: 'งานปูกระเบื้อง' },
    ];
    // p1-t1 is planned for Nov 4
    // p2-t2 is planned for Nov 10 (not Nov 4)
    const mockSchedules = {
      'p1-t1': { planned_start: '2026-11-04', planned_end: '2026-11-05' },
      'p2-t2': { planned_start: '2026-11-10', planned_end: '2026-11-12' },
    };

    const mockUpdates = [
      // In-plan update for LEAB on Nov 4
      {
        id: 'u1',
        plot_id: 'p1',
        task_template_id: 't1',
        created_at: '2026-11-04T09:30:00Z',
        action: 'เทคอนกรีตเสา',
        user_name: 'LEAB',
        progress: 50,
        image_url: 'https://example.com/photo1.jpg, https://example.com/photo2.jpg',
      },
      // Out-of-plan / advance update for LEAB on Nov 4 (p2-t2 is planned for Nov 10)
      {
        id: 'u2',
        plot_id: 'p2',
        task_template_id: 't2',
        created_at: '2026-11-04T14:15:00Z',
        action: 'ประกอบแบบคานล่วงหน้า',
        user_name: 'LEAB',
        progress: 30,
      },
      // Update from another foreman (SOMCHAI) on Nov 4
      {
        id: 'u3',
        plot_id: 'p3',
        task_template_id: 't3',
        created_at: '2026-11-04T11:00:00Z',
        action: 'ปูกระเบื้องห้องน้ำ',
        user_name: 'SOMCHAI',
        progress: 100,
      },
      // Update on a different date (Nov 3)
      {
        id: 'u4',
        plot_id: 'p1',
        task_template_id: 't1',
        created_at: '2026-11-03T10:00:00Z',
        action: 'ผูกเหล็กเสา',
        user_name: 'LEAB',
        progress: 20,
      },
    ];

    const mockDefects = [
      {
        id: 'd1',
        plot_id: 'p1',
        task_id: 't1',
        created_at: '2026-11-04T15:00:00Z',
        description: 'รอยแตกร้าวที่เสา A1',
        reporter: 'LEAB',
        status: 'open',
      },
    ];

    const mockSnapshots = [
      {
        id: 's1',
        plot_id: 'p1',
        task_template_id: 't1',
        snapshot_date: '2026-11-04',
        status_reason: 'weather_issue',
        status_note: 'ฝนตกหนักช่วงบ่าย',
        foreman_name: 'LEAB',
        updated_at: '2026-11-04T16:00:00Z',
      },
    ];

    it('collects and categorizes all activities for a specific foreman on targetDate', () => {
      const summary = getForemanDailyActivities({
        targetDate: '2026-11-04',
        foremanName: 'LEAB',
        plots: mockPlots,
        taskTemplates: mockTemplates,
        schedules: mockSchedules,
        allUpdatesRecord: mockUpdates,
        defects: mockDefects,
        existingSnapshots: mockSnapshots,
      });

      expect(summary.totalActivities).toBe(4); // u1 (in_plan) + u2 (out_of_plan) + d1 (defect) + s1 (roadblock)
      expect(summary.inPlanCount).toBe(1);
      expect(summary.outOfPlanCount).toBe(1);
      expect(summary.defectCount).toBe(1);
      expect(summary.roadblockCount).toBe(1);
      expect(summary.plotsVisitedCount).toBe(2); // p1, p2

      // Check in-plan item details
      const inPlanItem = summary.items.find(i => i.id === 'update-u1');
      expect(inPlanItem).toBeDefined();
      expect(inPlanItem?.category).toBe('in_plan');
      expect(inPlanItem?.image_urls.length).toBe(2);
      expect(inPlanItem?.plot_name).toBe('A-01');

      // Check out-of-plan item details
      const outPlanItem = summary.items.find(i => i.id === 'update-u2');
      expect(outPlanItem).toBeDefined();
      expect(outPlanItem?.category).toBe('out_of_plan');
      expect(outPlanItem?.categoryLabel).toBe('เริ่มงานก่อนแผน');

      // Check defect item
      const defectItem = summary.items.find(i => i.id === 'defect-d1');
      expect(defectItem).toBeDefined();
      expect(defectItem?.category).toBe('defect');

      // Check roadblock item
      const roadblockItem = summary.items.find(i => i.id === 'roadblock-s1');
      expect(roadblockItem).toBeDefined();
      expect(roadblockItem?.category).toBe('roadblock');
      expect(roadblockItem?.action).toContain('ฝนตก');
    });

    it('aggregates activities for all foremen when foremanName is all', () => {
      const summary = getForemanDailyActivities({
        targetDate: '2026-11-04',
        foremanName: 'all',
        plots: mockPlots,
        taskTemplates: mockTemplates,
        schedules: mockSchedules,
        allUpdatesRecord: mockUpdates,
        defects: mockDefects,
        existingSnapshots: mockSnapshots,
      });

      // Total includes SOMCHAI's u3 as well
      expect(summary.totalActivities).toBe(5);
      expect(summary.plotsVisitedCount).toBe(3); // p1, p2, p3
    });
  });

  describe('recordForemanTaskRoadblockReason resilience', () => {
    it('succeeds when task_updates succeeds even if snapshot table has permission denied error', async () => {
      const mockTask: any = {
        id: 'p1-t1',
        plot_id: 'p1',
        plot_name: 'แปลง 01',
        project_name: 'ไอลิน 6',
        foreman_name: 'LEAB',
        task_template_id: 't1',
        task_name: 'งานเสา',
        planned_start: '2026-11-04',
        planned_end: '2026-11-05',
        current_progress: 0,
      };

      const mockClient = {
        from: (table: string) => {
          if (table === 'foreman_daily_duty_snapshots') {
            return {
              upsert: () => Promise.resolve({
                error: { message: 'permission denied for function app_current_actor', code: '42501' }
              })
            };
          }
          if (table === 'task_updates') {
            return {
              select: () => ({
                eq: () => ({
                  ilike: () => Promise.resolve({ data: [], error: null })
                })
              }),
              insert: () => Promise.resolve({ error: null })
            };
          }
          return {};
        }
      };

      const res = await recordForemanTaskRoadblockReason(
        mockTask,
        '2026-11-04',
        'material_issue',
        'รอปูนเข้า',
        'LEAB',
        mockClient as any,
        { clientSubmissionId: 'sub-test-resilience' }
      );

      expect(res.success).toBe(true);
    });

    it('correctly categorizes roadblock as roadblockTasks (not updatedTasks) in summary and scheduled tasks', () => {
      const mockPlot = { id: 'plot-56', name: 'แปลง 56', project_name: 'ไอลิน6', foreman: 'LEAB' };
      const mockTask = { id: 'task-kitchen', task_name: 'งานเคาเตอร์ห้องครัวด้านใน' };
      const mockSchedules = {
        'plot-56-task-kitchen': { planned_start: '2026-11-05', planned_end: '2026-11-08' }
      };
      const mockUpdates = [
        {
          id: 'up-1',
          plot_id: 'plot-56',
          task_template_id: 'task-kitchen',
          action: 'แจ้งติดปัญหา: งานก่อนหน้ายังไม่เสร็จ / เลื่อน',
          text_content: 'เหตุผล: งานก่อนหน้ายังไม่เสร็จ / เลื่อน (ช่างยังไม่เข้า)',
          created_at: '2026-11-06T09:00:00.000Z',
          date: '2026-11-06T09:00:00.000Z',
          progress: 0,
        }
      ];

      const tasks = getForemanScheduledTasksForDate({
        plots: [mockPlot],
        taskTemplates: [mockTask],
        schedules: mockSchedules,
        allUpdatesRecord: mockUpdates,
        targetDate: '2026-11-06',
        foremanName: 'LEAB',
      });

      expect(tasks).toHaveLength(1);
      expect(tasks[0].status_reason).toBe('prior_task_delayed');
      expect(tasks[0].is_updated_today).toBe(false);

      const summary = computeForemanDailySummary(tasks);
      expect(summary.roadblockTasks).toBe(1);
      expect(summary.updatedTasks).toBe(0);
      expect(summary.pendingTasks).toBe(0);
      expect(summary.complianceRate).toBe(100);
    });

    it('getMonthlyForemanInspectionCompliance aggregates monthly workload stats and attaches day tasks', () => {
      const mockPlot1 = {
        id: 'plot-1',
        name: 'แปลง 01',
        project_name: 'ไอลิน 6',
        foreman_name: 'LEAB',
      };
      const mockPlot2 = {
        id: 'plot-2',
        name: 'แปลง 02',
        project_name: 'ไอลิน 7',
        foreman_name: 'VIEW',
      };
      const mockTask1 = { id: 't1', task_name: 'งานฐานราก' };
      const mockTask2 = { id: 't2', task_name: 'งานเทเสา' };

      const mockSchedules = {
        'plot-1-t1': { planned_start: '2026-11-02', planned_end: '2026-11-04' },
        'plot-2-t2': { planned_start: '2026-11-02', planned_end: '2026-11-03' },
      };

      const mockUpdates = [
        {
          id: 'up-1',
          plot_id: 'plot-1',
          task_template_id: 't1',
          action: 'เทคอนกรีตฐานรากเรียบร้อย',
          created_at: '2026-11-02T10:00:00.000Z',
          progress: 50,
          user_name: 'LEAB',
        },
        {
          id: 'up-2',
          plot_id: 'plot-2',
          task_template_id: 't2',
          action: 'แจ้งติดปัญหา: งานก่อนหน้ายังไม่เสร็จ / เลื่อน',
          created_at: '2026-11-02T11:00:00.000Z',
          progress: 0,
          user_name: 'VIEW',
        },
      ];

      const monthly = getMonthlyForemanInspectionCompliance({
        year: 2026,
        month: 11,
        plots: [mockPlot1, mockPlot2],
        taskTemplates: [mockTask1, mockTask2],
        schedules: mockSchedules,
        allUpdatesRecord: mockUpdates,
        existingSnapshots: [],
      });

      // Total month scheduled task occurrences across active days:
      // plot-1-t1 is scheduled on Nov 2, 3, 4 (3 days)
      // plot-2-t2 is scheduled on Nov 2, 3 (2 days)
      // Total = 5
      expect(monthly.totalMonthTasks).toBe(5);
      expect(monthly.foremanWorkloadStats).toHaveLength(2);

      const leabStat = monthly.foremanWorkloadStats.find(s => s.foremanName === 'LEAB');
      expect(leabStat).toBeDefined();
      expect(leabStat?.totalTasks).toBe(3);
      expect(leabStat?.plotsCount).toBe(1);
      expect(leabStat?.projectNames).toContain('ไอลิน 6');
      expect(leabStat?.sharePercentage).toBe(60); // 3 / 5 = 60%
      expect(leabStat?.updatedTasks).toBe(1); // Nov 2 updated

      const viewStat = monthly.foremanWorkloadStats.find(s => s.foremanName === 'VIEW');
      expect(viewStat).toBeDefined();
      expect(viewStat?.totalTasks).toBe(2);
      expect(viewStat?.plotsCount).toBe(1);
      expect(viewStat?.projectNames).toContain('ไอลิน 7');
      expect(viewStat?.sharePercentage).toBe(40); // 2 / 5 = 40%
      expect(viewStat?.roadblockTasks).toBe(1); // Nov 2 roadblock

      // Check day tasks drilldown for Nov 2
      const day2 = monthly.days.find(d => d.date === '2026-11-02');
      expect(day2).toBeDefined();
      expect(day2?.tasks).toBeDefined();
      expect(day2?.tasks).toHaveLength(2);
      expect(day2?.tasks?.map(t => t.project_name)).toEqual(expect.arrayContaining(['ไอลิน 6', 'ไอลิน 7']));
      expect(day2?.tasks?.map(t => t.foreman_name)).toEqual(expect.arrayContaining(['LEAB', 'VIEW']));
    });
  });
});
