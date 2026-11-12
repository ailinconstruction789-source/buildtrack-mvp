import { describe, it, expect } from 'vitest';
import {
  ROADBLOCK_REASONS,
  getRoadblockReason,
  normalizeDateStr,
  getPlotForemanName,
  isForemanWeeklyHoliday,
  isTaskExcludedFromPlan,
  getForemanScheduledTasksForDate,
  computeForemanDailySummary,
  getForemanReworkItems,
  getMonthlyForemanInspectionCompliance,
  getForemanDailyActivities,
  freezePastDailySnapshotsForMonth,
  SNAPSHOT_DAY_LOCK_PLOT_ID,
  SNAPSHOT_DAY_LOCK_TASK_PREFIX,
  recordForemanTaskRoadblockReason,
  stripInternalRefMarkers,
  parseRoadblockDisplay,
  formatTaskUpdateDisplayText,
  formatRoadblockActionLabel,
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

  describe('Roadblock display formatting & internal ref marker stripping', () => {
    it('strips [ref:...] markers without altering non-marker text', () => {
      expect(
        stripInternalRefMarkers('เหตุผล: อื่นๆ (ระบุในหมายเหตุ) (ช่างเข้าวันจันทร์ที่ 16/11/2569) [ref:sub_1794377594294_ozg2f]')
      ).toBe('เหตุผล: อื่นๆ (ระบุในหมายเหตุ) (ช่างเข้าวันจันทร์ที่ 16/11/2569)');

      expect(stripInternalRefMarkers('เทปูนเสร็จ 80%')).toBe('เทปูนเสร็จ 80%');
      expect(stripInternalRefMarkers(null)).toBe('');
    });

    it('parses roadblock reason with parentheses and preserves note while stripping [ref:...]', () => {
      const parsed = parseRoadblockDisplay(
        'เหตุผล: อื่นๆ (ระบุในหมายเหตุ) (ช่างเข้าวันจันทร์ที่ 16/11/2569) [ref:sub_1794377594294_ozg2f]',
        'แจ้งติดปัญหา: อื่นๆ (ระบุในหมายเหตุ)'
      );

      expect(parsed).not.toBeNull();
      expect(parsed?.icon).toBe('📝');
      expect(parsed?.reasonLabel).toBe('อื่นๆ (ระบุในหมายเหตุ)');
      expect(parsed?.note).toBe('ช่างเข้าวันจันทร์ที่ 16/11/2569');
      expect(parsed?.formattedText).toBe('📝 เหตุผล: อื่นๆ (ระบุในหมายเหตุ) (ช่างเข้าวันจันทร์ที่ 16/11/2569)');
    });

    it('resolves exact reason icon even when note contains keywords from another reason, and preserves nested parens', () => {
      const otherWithRainNote = parseRoadblockDisplay(
        'เหตุผล: อื่นๆ (ระบุในหมายเหตุ) (ฝนตกหนักเข้าไซต์ไม่ได้) [ref:sub_1]',
        'แจ้งติดปัญหา: อื่นๆ (ระบุในหมายเหตุ)'
      );
      expect(otherWithRainNote?.icon).toBe('📝');
      expect(otherWithRainNote?.note).toBe('ฝนตกหนักเข้าไซต์ไม่ได้');

      const materialWithNestedParens = parseRoadblockDisplay(
        'เหตุผล: ติดปัญหาวัสดุ (ของขาด / จัดส่งล่าช้า) (รอปูน (CPAC) บ่าย 2) [ref:sub_2]',
        'แจ้งติดปัญหา: ติดปัญหาวัสดุ (ของขาด / จัดส่งล่าช้า)'
      );
      expect(materialWithNestedParens?.icon).toBe('🧱');
      expect(materialWithNestedParens?.reasonLabel).toBe('ติดปัญหาวัสดุ (ของขาด / จัดส่งล่าช้า)');
      expect(materialWithNestedParens?.note).toBe('รอปูน (CPAC) บ่าย 2');
    });

    it('handles roadblocks without notes and returns null for non-roadblock progress updates', () => {
      const noNote = parseRoadblockDisplay(
        'เหตุผล: ยังไม่สามารถเริ่มงานได้ [ref:sub_3]',
        'แจ้งติดปัญหา: ยังไม่สามารถเริ่มงานได้'
      );
      expect(noNote?.icon).toBe('⏳');
      expect(noNote?.note).toBe('');
      expect(noNote?.formattedText).toBe('⏳ เหตุผล: ยังไม่สามารถเริ่มงานได้');

      expect(parseRoadblockDisplay('วันนี้ฝนตกเล็กน้อย ทำได้ 40%', 'อัปเดตความคืบหน้า')).toBeNull();
      expect(formatTaskUpdateDisplayText('วันนี้ฝนตกเล็กน้อย ทำได้ 40%', 'อัปเดตความคืบหน้า')).toBe(
        'วันนี้ฝนตกเล็กน้อย ทำได้ 40%'
      );
    });

    it('formats roadblock action label with icon without duplicating existing icon', () => {
      expect(
        formatRoadblockActionLabel('แจ้งติดปัญหา: ติดปัญหาช่าง (ขาดช่าง / ช่างไม่เข้างาน)')
      ).toBe('👷 แจ้งติดปัญหา: ติดปัญหาช่าง (ขาดช่าง / ช่างไม่เข้างาน)');

      expect(formatRoadblockActionLabel('🌧️ ติดสภาพอากาศ / ฝนตก', 'ฝนตกช่วงบ่าย')).toBe(
        '🌧️ ติดสภาพอากาศ / ฝนตก'
      );
    });

    it('extracts accurate status_note in getForemanScheduledTasksForDate when reason contains parentheses', () => {
      const tasks = getForemanScheduledTasksForDate({
        plots: [{ id: 'plot-72', name: 'แปลง 72', project_name: 'ไอลิน6', foreman: 'VIEW' }],
        taskTemplates: [{ id: 'task-ceiling', task_name: 'งานฝ้าห้องน้ำ' }],
        schedules: { 'plot-72-task-ceiling': { planned_start: '2026-11-10', planned_end: '2026-11-12' } },
        allUpdatesRecord: [
          {
            id: 'up-72',
            plot_id: 'plot-72',
            task_template_id: 'task-ceiling',
            action: 'แจ้งติดปัญหา: อื่นๆ (ระบุในหมายเหตุ)',
            text_content: 'เหตุผล: อื่นๆ (ระบุในหมายเหตุ) (ช่างเข้าวันจันทร์ที่ 16/11/2569) [ref:sub_1794377594294_ozg2f]',
            created_at: '2026-11-11T06:14:00.000Z',
            progress: 0,
          },
        ],
        targetDate: '2026-11-11',
        foremanName: 'VIEW',
      });

      expect(tasks).toHaveLength(1);
      expect(tasks[0].status_reason).toBe('other');
      expect(tasks[0].status_note).toBe('ช่างเข้าวันจันทร์ที่ 16/11/2569');
    });
  });

  describe('Handover Inspection integration across daily duty, roadblock, calendar & daily activity', () => {
    it('attributes scheduled handover defects independently from construction foreman and filters by target date window', () => {
      const plots = [
        { id: 'p-72', name: 'แปลง 72', project_name: 'ไอลิน 6', foreman_name: 'LEAB', handover_foreman_name: 'VIEW' },
      ];
      const defects = [
        // Active in-window handover defect handled by VIEW
        {
          id: 'def-in-window',
          plot_id: 'p-72',
          description: 'แก้: งานสีผนังภายใน',
          defect_stage: 'handover',
          planned_start: '2026-11-10',
          planned_end: '2026-11-12',
          progress: 50,
          status: 'in_progress',
          foreman_name: 'VIEW',
        },
        // Completed BEFORE targetDate (2026-11-09) -> is_completed_early on Nov 11
        {
          id: 'def-early',
          plot_id: 'p-72',
          description: 'แก้: งานประตูหน้าต่าง',
          defect_stage: 'handover',
          planned_start: '2026-11-08',
          planned_end: '2026-11-12',
          progress: 100,
          status: 'resolved',
          actual_end: '2026-11-09T10:00:00.000Z',
          foreman_name: 'VIEW',
        },
        // Overdue handover defect (planned_end 2026-11-10 < 2026-11-11) -> excluded from daily plan
        {
          id: 'def-overdue',
          plot_id: 'p-72',
          description: 'แก้: งานสุขภัณฑ์ห้องน้ำ',
          defect_stage: 'handover',
          planned_start: '2026-11-08',
          planned_end: '2026-11-10',
          progress: 20,
          status: 'in_progress',
          foreman_name: 'VIEW',
        },
        // Unscheduled handover defect (missing dates) -> excluded from daily plan
        {
          id: 'def-unscheduled',
          plot_id: 'p-72',
          description: 'แก้: ยังไม่ลงแผน',
          defect_stage: 'handover',
          progress: 0,
          status: 'pending',
          foreman_name: 'VIEW',
        },
      ];
      const defectUpdates = [
        {
          id: 'du-1',
          defect_id: 'def-in-window',
          progress: 50,
          note: 'ทาสีรองพื้นเสร็จแล้ว',
          created_by: 'VIEW',
          created_at: '2026-11-11T04:00:00.000Z',
        },
      ];

      // 1. Construction foreman LEAB should NOT receive VIEW's handover defects
      const leabTasks = getForemanScheduledTasksForDate({
        plots,
        taskTemplates: [],
        schedules: {},
        defects,
        defectUpdates,
        foremanName: 'LEAB',
        targetDate: '2026-11-11',
        todayDateStr: '2026-11-11',
      });
      expect(leabTasks).toHaveLength(0);

      // 2. Handover foreman VIEW receives scheduled active + early-completed handover tasks, excluding overdue/unscheduled
      const viewTasks = getForemanScheduledTasksForDate({
        plots,
        taskTemplates: [],
        schedules: {},
        defects,
        defectUpdates,
        foremanName: 'VIEW',
        targetDate: '2026-11-11',
        todayDateStr: '2026-11-11',
      });
      expect(viewTasks).toHaveLength(2);

      const inWindowTask = viewTasks.find(t => t.defect_id === 'def-in-window');
      expect(inWindowTask?.is_handover).toBe(true);
      expect(inWindowTask?.task_template_id).toBe('handover:def-in-window');
      expect(inWindowTask?.is_updated_today).toBe(true);
      expect(inWindowTask?.is_completed_early).toBe(false);

      const earlyTask = viewTasks.find(t => t.defect_id === 'def-early');
      expect(earlyTask?.is_handover).toBe(true);
      expect(earlyTask?.is_completed_early).toBe(true);

      // Completed early does not inflate pending numerator or penalize compliance rate
      const summary = computeForemanDailySummary(viewTasks);
      expect(summary.totalTasks).toBe(1);
      expect(summary.updatedTasks).toBe(1);
      expect(summary.completedEarlyTasks).toBe(1);
      expect(summary.complianceRate).toBe(100);
    });

    it('preserves historical snapshot attribution across takeovers while reflecting live takeover immediately on today', () => {
      const plots = [
        { id: 'p-1', name: 'แปลง 01', project_name: 'ไอลิน 6', foreman_name: 'LEAB', handover_foreman_name: 'SOMCHAI' },
      ];
      const defects = [
        {
          id: 'def-1',
          plot_id: 'p-1',
          description: 'แก้: งานฝ้าเพดาน',
          defect_stage: 'handover',
          planned_start: '2026-11-10',
          planned_end: '2026-11-12',
          progress: 30,
          status: 'in_progress',
          foreman_name: 'SOMCHAI', // Taken over on Nov 11
        },
      ];
      const snapshots = [
        {
          snapshot_date: '2026-11-10',
          foreman_name: 'VIEW',
          plot_id: 'p-1',
          task_template_id: 'handover:def-1',
          planned_start: '2026-11-10',
          planned_end: '2026-11-12',
          is_updated_today: true,
        },
        {
          // Earlier auto-save today before takeover happened
          snapshot_date: '2026-11-11',
          foreman_name: 'VIEW',
          plot_id: 'p-1',
          task_template_id: 'handover:def-1',
          planned_start: '2026-11-10',
          planned_end: '2026-11-12',
          is_updated_today: false,
        },
      ];

      // Yesterday (Nov 10) remains attributed to VIEW
      const nov10View = getForemanScheduledTasksForDate({
        plots,
        taskTemplates: [],
        schedules: {},
        defects,
        existingSnapshots: snapshots,
        foremanName: 'VIEW',
        targetDate: '2026-11-10',
        todayDateStr: '2026-11-11',
      });
      expect(nov10View).toHaveLength(1);
      expect(nov10View[0].foreman_name).toBe('VIEW');

      // Today (Nov 11) switches immediately to SOMCHAI
      const nov11Somchai = getForemanScheduledTasksForDate({
        plots,
        taskTemplates: [],
        schedules: {},
        defects,
        existingSnapshots: snapshots,
        foremanName: 'SOMCHAI',
        targetDate: '2026-11-11',
        todayDateStr: '2026-11-11',
      });
      expect(nov11Somchai).toHaveLength(1);
      expect(nov11Somchai[0].foreman_name).toBe('SOMCHAI');
    });

    it('writes handover roadblock idempotently to defect_updates and counts toward monthly compliance & daily activities', async () => {
      const insertedDefectUpdates: any[] = [];
      const updatedDefectUpdates: any[] = [];
      const snapshotUpserts: any[] = [];

      const mockSupabase = {
        from: (table: string) => {
          if (table === 'foreman_daily_duty_snapshots') {
            return {
              upsert: async (rows: any[]) => {
                snapshotUpserts.push(...rows);
                return { error: null };
              },
            };
          }
          if (table === 'defect_updates') {
            return {
              select: () => ({
                eq: () => ({
                  ilike: async (_col: string, pattern: string) => {
                    const marker = pattern.replace(/%/g, '');
                    const matched = insertedDefectUpdates.filter(r => r.note?.includes(marker));
                    return { data: matched, error: null };
                  },
                }),
              }),
              insert: async (rows: any[]) => {
                rows.forEach((r, idx) => insertedDefectUpdates.push({ id: `du-mock-${idx + 1}`, ...r }));
                return { error: null };
              },
              update: (payload: any) => ({
                eq: async (_col: string, id: string) => {
                  updatedDefectUpdates.push({ id, ...payload });
                  return { error: null };
                },
              }),
            };
          }
          throw new Error(`Unexpected table call: ${table}`);
        },
      };

      const handoverTask = {
        id: 'plot-1-handover:def-9',
        plot_id: 'plot-1',
        plot_name: 'แปลง 01',
        project_name: 'ไอลิน 6',
        foreman_name: 'VIEW',
        task_template_id: 'handover:def-9',
        task_name: 'แก้: ติดตั้งบัวเชิงผนัง',
        planned_start: '2026-11-11',
        planned_end: '2026-11-12',
        current_progress: 0,
        is_updated_today: false,
        is_handover: true,
        defect_id: 'def-9',
      };

      // First submit -> inserts defect_updates with [ref:sub_ho_1]
      const res1 = await recordForemanTaskRoadblockReason(
        handoverTask,
        '2026-11-11',
        'material_issue',
        'รอบัวเข้าไซต์พรุ่งนี้',
        'VIEW',
        mockSupabase,
        { clientSubmissionId: 'sub_ho_1' }
      );
      expect(res1.success).toBe(true);
      expect(snapshotUpserts[0].task_template_id).toBe('handover:def-9');
      expect(insertedDefectUpdates).toHaveLength(1);
      expect(insertedDefectUpdates[0].defect_id).toBe('def-9');
      expect(insertedDefectUpdates[0].note).toContain('เหตุผล: ติดปัญหาวัสดุ');
      expect(insertedDefectUpdates[0].note).toContain('[ref:sub_ho_1]');

      // Retry with same submission ID -> updates existing row instead of duplicating
      const res2 = await recordForemanTaskRoadblockReason(
        handoverTask,
        '2026-11-11',
        'other',
        'เลื่อนส่งวัสดุเป็นศุกร์',
        'VIEW',
        mockSupabase,
        { clientSubmissionId: 'sub_ho_1' }
      );
      expect(res2.success).toBe(true);
      expect(insertedDefectUpdates).toHaveLength(1);
      expect(updatedDefectUpdates).toHaveLength(1);

      // Verify monthly calendar & daily activity log pick up the handover task and roadblock update
      const plots = [{ id: 'plot-1', name: 'แปลง 01', project_name: 'ไอลิน 6', foreman_name: 'LEAB', handover_foreman_name: 'VIEW' }];
      const defects = [{
        id: 'def-9',
        plot_id: 'plot-1',
        description: 'แก้: ติดตั้งบัวเชิงผนัง',
        defect_stage: 'handover',
        planned_start: '2026-11-11',
        planned_end: '2026-11-12',
        progress: 0,
        status: 'pending',
        foreman_name: 'VIEW',
      }];
      const defectUpdates = [
        {
          id: 'du-mock-1',
          defect_id: 'def-9',
          progress: 0,
          note: 'เหตุผล: ติดปัญหาวัสดุ (ของขาด / จัดส่งล่าช้า) (รอบัวเข้าไซต์พรุ่งนี้) [ref:sub_ho_1]',
          created_by: 'VIEW',
          created_at: '2026-11-11T05:00:00.000Z',
        },
        {
          id: 'du-mock-progress',
          defect_id: 'def-9',
          progress: 60,
          note: 'ช่างเข้าติดบัวแล้ว',
          created_by: 'VIEW',
          created_at: '2026-11-12T04:00:00.000Z',
        },
      ];

      const monthly = getMonthlyForemanInspectionCompliance({
        year: 2026,
        month: 11,
        plots,
        taskTemplates: [],
        schedules: {},
        defects,
        defectUpdates,
        foremanName: 'VIEW',
        todayDateStr: '2026-11-12',
      });
      expect(monthly.totalMonthTasks).toBe(2); // Nov 11 & Nov 12
      expect(monthly.totalMonthRoadblocks).toBe(1); // Nov 11
      expect(monthly.totalMonthUpdated).toBe(1); // Nov 12
      const nov11 = monthly.days.find(d => d.date === '2026-11-11');
      expect(nov11?.complianceRate).toBe(100);
      expect(nov11?.tasks?.[0].is_handover).toBe(true);

      const activities = getForemanDailyActivities({
        plots,
        taskTemplates: [],
        schedules: {},
        defects,
        defectUpdates,
        foremanName: 'VIEW',
        targetDate: '2026-11-12',
        todayDateStr: '2026-11-12',
      });
      expect(activities.inPlanCount).toBe(1);
      expect(activities.items[0].is_handover).toBe(true);
      expect(activities.items[0].defectObj?.id).toBe('def-9');

      // Rework items follow handover foreman attribution instead of construction foreman
      const reworkView = getForemanReworkItems({ plots, defects, foremanName: 'VIEW' });
      const reworkLeab = getForemanReworkItems({ plots, defects, foremanName: 'LEAB' });
      expect(reworkView).toHaveLength(1);
      expect(reworkView[0].foreman_name).toBe('VIEW');
      expect(reworkLeab).toHaveLength(0);
    });
  });

  describe('Placeholder snapshot backfill, live today foreman, and case-insensitive monthly grouping', () => {
    it('falls back placeholder past snapshots to newly assigned DEN while preserving concrete past foreman snapshots', () => {
      const plots = [
        { id: 'p-ailin3', name: 'แปลง 03', project_name: 'ไอลิน 3', foreman_name: 'DEN' },
        { id: 'p-ailin6', name: 'แปลง 72', project_name: 'ไอลิน6', foreman_name: 'LEAB', foreman_assigned_at: '2026-11-12T00:00:00Z' },
      ];
      const taskTemplates = [{ id: 't-1', task_name: 'งานหลังคา' }];
      const schedules = {
        'p-ailin3-t-1': { planned_start: '2026-11-10', planned_end: '2026-11-12' },
        'p-ailin6-t-1': { planned_start: '2026-11-10', planned_end: '2026-11-12' },
      };
      const existingSnapshots = [
        {
          snapshot_date: '2026-11-10',
          plot_id: 'p-ailin3',
          task_template_id: 't-1',
          foreman_name: 'ยังไม่ระบุโฟร์แมน',
          planned_start: '2026-11-10',
          planned_end: '2026-11-12',
          current_progress: 0,
        },
        {
          snapshot_date: '2026-11-10',
          plot_id: 'p-ailin6',
          task_template_id: 't-1',
          foreman_name: 'VIEW',
          planned_start: '2026-11-10',
          planned_end: '2026-11-12',
          current_progress: 20,
        },
      ];
      const foremenList = [
        { username: 'DEN', name: 'Den' },
        { username: 'VIEW', name: 'View' },
        { username: 'LEAB', name: 'Leab' },
      ];

      // Past date (Nov 10 < today Nov 12): placeholder 'ยังไม่ระบุโฟร์แมน' yields to live 'DEN', concrete 'VIEW' stays 'VIEW'
      const nov10Den = getForemanScheduledTasksForDate({
        plots,
        taskTemplates,
        schedules,
        existingSnapshots,
        foremenList,
        foremanName: 'DEN',
        targetDate: '2026-11-10',
        todayDateStr: '2026-11-12',
      });
      expect(nov10Den).toHaveLength(1);
      expect(nov10Den[0].plot_id).toBe('p-ailin3');
      expect(nov10Den[0].foreman_name).toBe('DEN');

      const nov10View = getForemanScheduledTasksForDate({
        plots,
        taskTemplates,
        schedules,
        existingSnapshots,
        foremenList,
        foremanName: 'VIEW',
        targetDate: '2026-11-10',
        todayDateStr: '2026-11-12',
      });
      expect(nov10View).toHaveLength(1);
      expect(nov10View[0].plot_id).toBe('p-ailin6');
      expect(nov10View[0].foreman_name).toBe('VIEW');

      const nov10Unassigned = getForemanScheduledTasksForDate({
        plots,
        taskTemplates,
        schedules,
        existingSnapshots,
        foremenList,
        foremanName: 'ยังไม่ระบุ',
        targetDate: '2026-11-10',
        todayDateStr: '2026-11-12',
      });
      expect(nov10Unassigned).toHaveLength(0);
    });

    it('reflects live plot/handover foreman immediately on today even if an older morning snapshot exists', () => {
      const plots = [
        { id: 'p-4', name: 'แปลง 04', project_name: 'ไอลิน 4', foreman_name: 'Auen', handover_foreman_name: 'DEN' },
        { id: 'p-3', name: 'แปลง 03', project_name: 'ไอลิน 3', foreman_name: 'DEN' },
      ];
      const taskTemplates = [{ id: 't-1', task_name: 'งานพื้น' }];
      const schedules = {
        'p-3-t-1': { planned_start: '2026-11-12', planned_end: '2026-11-12' },
      };
      const defects = [
        {
          id: 'def-h4',
          plot_id: 'p-4',
          description: 'แก้สีผนัง',
          defect_stage: 'handover',
          planned_start: '2026-11-12',
          planned_end: '2026-11-12',
          progress: 0,
          status: 'pending',
          foreman_name: 'DEN',
        },
      ];
      const existingSnapshots = [
        {
          snapshot_date: '2026-11-12',
          plot_id: 'p-3',
          task_template_id: 't-1',
          foreman_name: 'ยังไม่ระบุโฟร์แมน',
          planned_start: '2026-11-12',
          planned_end: '2026-11-12',
          current_progress: 0,
        },
        {
          snapshot_date: '2026-11-12',
          plot_id: 'p-4',
          task_template_id: 'handover:def-h4',
          foreman_name: 'Auen',
          planned_start: '2026-11-12',
          planned_end: '2026-11-12',
          current_progress: 0,
        },
      ];

      const todayDenTasks = getForemanScheduledTasksForDate({
        plots,
        taskTemplates,
        schedules,
        defects,
        existingSnapshots,
        foremenList: [{ username: 'DEN', name: 'Den' }],
        foremanName: 'DEN',
        targetDate: '2026-11-12',
        todayDateStr: '2026-11-12',
      });
      expect(todayDenTasks).toHaveLength(2);
      expect(todayDenTasks.every(t => t.foreman_name === 'DEN')).toBe(true);

      const todayAuenTasks = getForemanScheduledTasksForDate({
        plots,
        taskTemplates,
        schedules,
        defects,
        existingSnapshots,
        foremenList: [{ username: 'DEN', name: 'Den' }],
        foremanName: 'Auen',
        targetDate: '2026-11-12',
        todayDateStr: '2026-11-12',
      });
      expect(todayAuenTasks).toHaveLength(0);
    });

    it('merges DEN and Den variants into a single canonical DEN card in getMonthlyForemanInspectionCompliance', () => {
      const plots = [
        { id: 'p-3', name: 'แปลง 03', project_name: 'ไอลิน 3', foreman_name: 'Den' },
        { id: 'p-4', name: 'แปลง 04', project_name: 'ไอลิน 4', foreman_name: 'Auen', handover_foreman_name: 'DEN' },
      ];
      const taskTemplates = [{ id: 't-1', task_name: 'งานฝ้า' }];
      const schedules = {
        'p-3-t-1': { planned_start: '2026-11-11', planned_end: '2026-11-11' },
      };
      const defects = [
        {
          id: 'def-h4',
          plot_id: 'p-4',
          description: 'ตรวจรับสีภายนอก',
          defect_stage: 'handover',
          planned_start: '2026-11-11',
          planned_end: '2026-11-11',
          progress: 50,
          status: 'in_progress',
          foreman_name: 'den',
        },
      ];
      const existingSnapshots = [
        {
          snapshot_date: '2026-11-11',
          plot_id: 'p-3',
          task_template_id: 't-1',
          foreman_name: 'ยังไม่ระบุโฟร์แมน',
          planned_start: '2026-11-11',
          planned_end: '2026-11-11',
          current_progress: 0,
        },
      ];
      const foremenList = [{ username: 'DEN', name: 'Den' }, { username: 'Auen', name: 'Auen' }];

      const monthly = getMonthlyForemanInspectionCompliance({
        year: 2026,
        month: 11,
        plots,
        taskTemplates,
        schedules,
        defects,
        existingSnapshots,
        foremenList,
        foremanName: 'all',
        todayDateStr: '2026-11-12',
      });

      expect(monthly.foremanWorkloadStats).toHaveLength(1);
      expect(monthly.foremanWorkloadStats[0].foremanName).toBe('DEN');
      expect(monthly.foremanWorkloadStats[0].totalTasks).toBe(2);
      expect(monthly.foremanWorkloadStats[0].plotsCount).toBe(2);
    });
  });

  describe('Excluded and non-counted tasks (is_progress_counted=false / is_excluded=true / excluded_house_types)', () => {
    const basePlots = [
      {
        id: 'p-1',
        name: 'แปลง 01',
        project_name: 'ไอลิน 6',
        foreman_name: 'VIEW',
        house_types: { type_name: 'Type A' },
      },
    ];
    const baseTasks = [
      { id: 't-counted', task_name: 'งานโครงสร้าง', is_progress_counted: true },
      { id: 't-uncounted', task_name: 'งานเฟอร์นิเจอร์', is_progress_counted: false },
      { id: 't-na', task_name: 'งานรั้ว', is_progress_counted: true },
      { id: 't-type-excl', task_name: 'งานห้องใต้หลังคา', excluded_house_types: ['Type A'] },
    ];
    const baseAssignments = [
      { plot_id: 'p-1', task_template_id: 't-counted', current_progress: 100, is_excluded: false },
      { plot_id: 'p-1', task_template_id: 't-uncounted', current_progress: 0, is_excluded: false },
      { plot_id: 'p-1', task_template_id: 't-na', current_progress: 0, is_excluded: true },
      { plot_id: 'p-1', task_template_id: 't-type-excl', current_progress: 0, is_excluded: false },
    ];

    it('isTaskExcludedFromPlan detects is_progress_counted=false, assign.is_excluded, and excluded_house_types', () => {
      expect(isTaskExcludedFromPlan(baseTasks[0], baseAssignments[0], basePlots[0])).toBe(false);
      expect(isTaskExcludedFromPlan({ id: 't-undef', task_name: 'งานทั่วไป' }, undefined, basePlots[0])).toBe(false);
      expect(isTaskExcludedFromPlan(baseTasks[1], baseAssignments[1], basePlots[0])).toBe(true);
      expect(isTaskExcludedFromPlan(baseTasks[2], baseAssignments[2], basePlots[0])).toBe(true);
      expect(isTaskExcludedFromPlan(baseTasks[3], baseAssignments[3], basePlots[0])).toBe(true);
    });

    it('excludes non-counted/N-A/house-type-excluded tasks from daily schedule & compliance even if snapshots exist', () => {
      const schedules = {
        'p-1-t-counted': { planned_start: '2026-11-12', planned_end: '2026-11-12' },
        'p-1-t-uncounted': { planned_start: '2026-11-12', planned_end: '2026-11-12' },
        'p-1-t-na': { planned_start: '2026-11-12', planned_end: '2026-11-12' },
        'p-1-t-type-excl': { planned_start: '2026-11-12', planned_end: '2026-11-12' },
      };
      const existingSnapshots = [
        {
          snapshot_date: '2026-11-12',
          plot_id: 'p-1',
          task_template_id: 't-uncounted',
          foreman_name: 'VIEW',
          planned_start: '2026-11-12',
          planned_end: '2026-11-12',
          current_progress: 0,
        },
        {
          snapshot_date: '2026-11-12',
          plot_id: 'p-1',
          task_template_id: 't-na',
          foreman_name: 'VIEW',
          planned_start: '2026-11-12',
          planned_end: '2026-11-12',
          current_progress: 0,
        },
      ];
      const updates = [
        {
          id: 'u-1',
          plot_id: 'p-1',
          task_template_id: 't-counted',
          created_at: '2026-11-12T03:00:00.000Z',
          progress: 100,
          user_name: 'VIEW',
        },
      ];

      const daily = getForemanScheduledTasksForDate({
        plots: basePlots,
        taskTemplates: baseTasks,
        schedules,
        assignments: baseAssignments,
        allUpdatesRecord: updates,
        existingSnapshots,
        foremanName: 'VIEW',
        targetDate: '2026-11-12',
        todayDateStr: '2026-11-12',
      });

      expect(daily.map(t => t.task_template_id)).toEqual(['t-counted']);
      const summary = computeForemanDailySummary(daily);
      expect(summary.totalTasks).toBe(1);
      expect(summary.updatedTasks).toBe(1);
      expect(summary.complianceRate).toBe(100);
    });

    it('excludes non-counted/N-A tasks across full month in getMonthlyForemanInspectionCompliance while keeping counted future tasks', () => {
      const schedules = {
        'p-1-t-counted': { planned_start: '2026-11-12', planned_end: '2026-11-13' }, // 2 days (today + future)
        'p-1-t-uncounted': { planned_start: '2026-11-10', planned_end: '2026-11-14' }, // 5 days (excluded)
        'p-1-t-na': { planned_start: '2026-11-10', planned_end: '2026-11-14' }, // 5 days (excluded)
        'p-1-t-type-excl': { planned_start: '2026-11-10', planned_end: '2026-11-14' }, // 5 days (excluded)
      };
      const monthlyAssignments = [
        { plot_id: 'p-1', task_template_id: 't-counted', current_progress: 50, is_excluded: false },
        { plot_id: 'p-1', task_template_id: 't-uncounted', current_progress: 0, is_excluded: false },
        { plot_id: 'p-1', task_template_id: 't-na', current_progress: 0, is_excluded: true },
        { plot_id: 'p-1', task_template_id: 't-type-excl', current_progress: 0, is_excluded: false },
      ];
      const existingSnapshots = [
        {
          snapshot_date: '2026-11-11',
          plot_id: 'p-1',
          task_template_id: 't-uncounted',
          foreman_name: 'VIEW',
          planned_start: '2026-11-10',
          planned_end: '2026-11-14',
          current_progress: 0,
        },
      ];
      const updates = [
        {
          id: 'u-1',
          plot_id: 'p-1',
          task_template_id: 't-counted',
          created_at: '2026-11-12T03:00:00.000Z',
          progress: 50,
          user_name: 'VIEW',
        },
      ];

      const monthly = getMonthlyForemanInspectionCompliance({
        year: 2026,
        month: 11,
        plots: basePlots,
        taskTemplates: baseTasks,
        schedules,
        assignments: monthlyAssignments,
        allUpdatesRecord: updates,
        existingSnapshots,
        foremanName: 'all',
        todayDateStr: '2026-11-12',
      });

      expect(monthly.totalMonthTasks).toBe(2);
      expect(monthly.totalMonthUpdated).toBe(1);
      expect(monthly.totalMonthPending).toBe(1);
      expect(monthly.foremanWorkloadStats).toHaveLength(1);
      expect(monthly.foremanWorkloadStats[0].totalTasks).toBe(2);
      expect(monthly.foremanWorkloadStats[0].pendingTasks).toBe(1);
      expect(monthly.days.find(d => d.date === '2026-11-11')?.totalScheduled ?? 0).toBe(0);
      expect(monthly.days.find(d => d.date === '2026-11-12')?.totalScheduled).toBe(1);
      expect(monthly.days.find(d => d.date === '2026-11-13')?.totalScheduled).toBe(1);
    });

    it('reclassifies real progress updates on excluded/non-counted tasks as out_of_plan in getForemanDailyActivities and skips stale roadblock snapshots', () => {
      const schedules = {
        'p-1-t-counted': { planned_start: '2026-11-12', planned_end: '2026-11-12' },
        'p-1-t-uncounted': { planned_start: '2026-11-12', planned_end: '2026-11-12' },
        'p-1-t-na': { planned_start: '2026-11-12', planned_end: '2026-11-12' },
      };
      const updates = [
        {
          id: 'u-counted',
          plot_id: 'p-1',
          task_template_id: 't-counted',
          created_at: '2026-11-12T02:00:00.000Z',
          progress: 100,
          user_name: 'VIEW',
        },
        {
          id: 'u-uncounted',
          plot_id: 'p-1',
          task_template_id: 't-uncounted',
          created_at: '2026-11-12T03:00:00.000Z',
          progress: 50,
          user_name: 'VIEW',
        },
        {
          id: 'u-na',
          plot_id: 'p-1',
          task_template_id: 't-na',
          created_at: '2026-11-12T04:00:00.000Z',
          progress: 100,
          user_name: 'VIEW',
        },
      ];
      const existingSnapshots = [
        {
          id: 'snap-rb-excl',
          snapshot_date: '2026-11-12',
          plot_id: 'p-1',
          task_template_id: 't-uncounted',
          foreman_name: 'VIEW',
          status_reason: 'RAIN',
          status_note: 'stale roadblock',
        },
      ];

      const activities = getForemanDailyActivities({
        plots: basePlots,
        taskTemplates: baseTasks,
        schedules,
        assignments: baseAssignments,
        allUpdatesRecord: updates,
        existingSnapshots,
        foremanName: 'VIEW',
        targetDate: '2026-11-12',
        todayDateStr: '2026-11-12',
      });

      expect(activities.inPlanCount).toBe(1);
      expect(activities.outOfPlanCount).toBe(2);
      expect(activities.roadblockCount).toBe(0);
      expect(
        activities.items
          .filter(i => i.task_template_id === 't-uncounted' || i.task_template_id === 't-na')
          .every(i => i.category === 'out_of_plan' && i.categoryLabel === 'งานไม่นับรวมในแผน / นอกแผน')
      ).toBe(true);
    });
  });

  describe('Strict Past-Day Snapshot Lock & Future Dynamic Plan Behavior', () => {
    it('freezes past dates (< today) without overwriting existing snapshots, blocks retroactive schedule/handover backdates on past dates, and keeps today + gray future days dynamic', async () => {
      const plots = [
        { id: 'p-1', name: 'แปลง 01', project_name: 'ไอลิน 6', foreman_name: 'VIEW' },
      ];
      const taskTemplates = [
        { id: 't-1', task_name: 'งานโครงสร้าง', is_progress_counted: true },
        { id: 't-2', task_name: 'งานหลังคา', is_progress_counted: true },
      ];
      const initialSchedules = {
        'p-1-t-1': { planned_start: '2026-11-11', planned_end: '2026-11-14' },
      };
      const assignments = [
        { plot_id: 'p-1', task_template_id: 't-1', current_progress: 50 },
        { plot_id: 'p-1', task_template_id: 't-2', current_progress: 0 },
      ];
      const updates = [
        {
          id: 'u-nov11',
          plot_id: 'p-1',
          task_template_id: 't-1',
          created_at: '2026-11-11T04:00:00.000Z',
          progress: 50,
          user_name: 'VIEW',
        },
      ];
      const existingSnapshots = [
        {
          snapshot_date: '2026-11-11',
          plot_id: 'p-1',
          project_name: 'ไอลิน 6',
          task_template_id: 't-1',
          foreman_name: 'VIEW',
          planned_start: '2026-11-11',
          planned_end: '2026-11-14',
          current_progress: 50,
          is_updated_today: true,
        },
      ];

      const upsertedBatches: any[] = [];
      const mockSupabase = {
        from: (table: string) => {
          if (table === 'foreman_daily_duty_snapshots') {
            return {
              upsert: async (rows: any[], opts: any) => {
                upsertedBatches.push({ rows, opts });
                return { error: null };
              },
            };
          }
          throw new Error(`Unexpected table: ${table}`);
        },
      };

      const freezeRes = await freezePastDailySnapshotsForMonth({
        year: 2026,
        month: 11,
        plots,
        taskTemplates,
        schedules: initialSchedules,
        assignments,
        allUpdatesRecord: updates,
        existingSnapshots,
        todayDateStr: '2026-11-12',
        customSupabase: mockSupabase,
      });

      expect(freezeRes.success).toBe(true);
      // Only past dates (Nov 1..11) can be frozen, NEVER today (Nov 12) or future (Nov 13+)
      expect(freezeRes.frozenDates.every(d => d < '2026-11-12')).toBe(true);
      expect(freezeRes.frozenDates).toContain('2026-11-11');
      expect(freezeRes.frozenDates).not.toContain('2026-11-12');
      expect(freezeRes.frozenDates).not.toContain('2026-11-13');
      // Existing snapshot p-1/t-1 on Nov 11 must NOT be duplicated/overwritten
      expect(
        freezeRes.addedRows.some(
          r => r.snapshot_date === '2026-11-11' && r.plot_id === 'p-1' && r.task_template_id === 't-1'
        )
      ).toBe(false);
      // Freeze marker written for Nov 11
      expect(
        freezeRes.addedRows.some(
          r =>
            r.snapshot_date === '2026-11-11' &&
            r.plot_id === SNAPSHOT_DAY_LOCK_PLOT_ID &&
            r.task_template_id === SNAPSHOT_DAY_LOCK_TASK_PREFIX
        )
      ).toBe(true);
      expect(upsertedBatches[0]?.opts).toEqual({
        onConflict: 'snapshot_date,plot_id,task_template_id',
        ignoreDuplicates: true,
      });

      // Now on Nov 12, Project Planner backdates a new schedule (t-2) & handover defect onto Nov 11..15
      const updatedSchedules = {
        ...initialSchedules,
        'p-1-t-2': { planned_start: '2026-11-11', planned_end: '2026-11-15' },
      };
      const newHandoverDefects = [
        {
          id: 'def-new',
          plot_id: 'p-1',
          description: 'ตรวจรับงานใหม่',
          defect_stage: 'handover',
          planned_start: '2026-11-11',
          planned_end: '2026-11-14',
          progress: 0,
          status: 'pending',
          foreman_name: 'VIEW',
        },
      ];

      const mergedSnapshots = [...existingSnapshots, ...freezeRes.addedRows];
      const monthly = getMonthlyForemanInspectionCompliance({
        year: 2026,
        month: 11,
        plots,
        taskTemplates,
        schedules: updatedSchedules,
        assignments,
        allUpdatesRecord: updates,
        defects: newHandoverDefects,
        existingSnapshots: mergedSnapshots,
        foremanName: 'all',
        todayDateStr: '2026-11-12',
      });

      const nov11 = monthly.days.find(d => d.date === '2026-11-11');
      const nov12 = monthly.days.find(d => d.date === '2026-11-12');
      const nov13 = monthly.days.find(d => d.date === '2026-11-13');
      const nov14 = monthly.days.find(d => d.date === '2026-11-14');
      const nov15 = monthly.days.find(d => d.date === '2026-11-15');

      // Past frozen day (Nov 11) stays 1/1 (100%) — immune to newly backdated t-2 & handover defect!
      expect(nov11?.isFrozen).toBe(true);
      expect(nov11?.totalScheduled).toBe(1);
      expect(nov11?.updated).toBe(1);
      expect(nov11?.complianceRate).toBe(100);

      // Today (Nov 12) and future gray workdays (Nov 13, 14) dynamically reflect the updated plan!
      expect(nov12?.isFrozen).toBe(false);
      expect(nov12?.totalScheduled).toBe(3);
      expect(nov13?.isFrozen).toBe(false);
      expect(nov13?.isFuture).toBe(true);
      expect(nov13?.totalScheduled).toBe(3);
      expect(nov14?.isFuture).toBe(true);
      expect(nov14?.totalScheduled).toBe(3);

      // Sunday (Nov 15) is a weekly foreman holiday: excluded from scheduled KPI & monthly totals
      expect(nov15?.isHoliday).toBe(true);
      expect(nov15?.status).toBe('holiday');
      expect(nov15?.totalScheduled).toBe(0);

      // Daily activities skips synthetic __DAY_LOCK__ marker rows cleanly
      const activities = getForemanDailyActivities({
        plots,
        taskTemplates,
        schedules: updatedSchedules,
        assignments,
        allUpdatesRecord: updates,
        existingSnapshots: mergedSnapshots,
        foremanName: 'all',
        targetDate: '2026-11-11',
        todayDateStr: '2026-11-12',
      });
      expect(activities.items.every(it => it.plot_id !== SNAPSHOT_DAY_LOCK_PLOT_ID)).toBe(true);
    });

    it('prevents future QC rejections (> targetDate) from un-completing an already completed_early task on a past date', () => {
      const plots = [{ id: 'p-1', name: 'แปลง 01', project_name: 'ไอลิน 6', foreman_name: 'VIEW' }];
      const taskTemplates = [{ id: 't-1', task_name: 'งานพื้น', is_progress_counted: true }];
      const schedules = { 'p-1-t-1': { planned_start: '2026-11-09', planned_end: '2026-11-13' } };
      const assignments = [{ plot_id: 'p-1', task_template_id: 't-1', current_progress: 50, actual_end_date: '2026-11-10' }];
      const existingSnapshots = [
        {
          snapshot_date: '2026-11-11',
          plot_id: 'p-1',
          project_name: 'ไอลิน 6',
          task_template_id: 't-1',
          foreman_name: 'VIEW',
          planned_start: '2026-11-09',
          planned_end: '2026-11-13',
          current_progress: 100,
          is_updated_today: false,
        },
      ];
      const updates = [
        {
          id: 'u-done',
          plot_id: 'p-1',
          task_template_id: 't-1',
          created_at: '2026-11-10T04:00:00.000Z',
          progress: 100,
          action: 'ส่งงาน 100%',
        },
        {
          id: 'u-future-reject',
          plot_id: 'p-1',
          task_template_id: 't-1',
          created_at: '2026-11-12T05:00:00.000Z',
          progress: 50,
          action: 'แจ้งแก้ไขงาน',
        },
      ];

      const nov11Tasks = getForemanScheduledTasksForDate({
        plots,
        taskTemplates,
        schedules,
        assignments,
        allUpdatesRecord: updates,
        existingSnapshots,
        foremanName: 'VIEW',
        targetDate: '2026-11-11',
        todayDateStr: '2026-11-12',
      });

      expect(nov11Tasks).toHaveLength(1);
      expect(nov11Tasks[0].is_completed_early).toBe(true);
    });
  });

  describe('Weekly Sunday holiday exclusion & Option B optional updates', () => {
    it('identifies only Sundays as weekly foreman holidays via isForemanWeeklyHoliday', () => {
      // November 2026 Sundays: 1, 8, 15, 22, 29
      expect(isForemanWeeklyHoliday('2026-11-01')).toBe(true);
      expect(isForemanWeeklyHoliday('2026-11-08')).toBe(true);
      expect(isForemanWeeklyHoliday('2026-11-15')).toBe(true);
      expect(isForemanWeeklyHoliday('2026-11-22')).toBe(true);
      expect(isForemanWeeklyHoliday('2026-11-29')).toBe(true);

      // Mon-Sat are regular working days
      expect(isForemanWeeklyHoliday('2026-11-02')).toBe(false);
      expect(isForemanWeeklyHoliday('2026-11-07')).toBe(false);
      expect(isForemanWeeklyHoliday('2026-11-12')).toBe(false);
      expect(isForemanWeeklyHoliday('2026-11-14')).toBe(false);
    });

    it('excludes past and future Sundays from monthly compliance, missedDays, and foreman workload totals (even with Sunday snapshots)', () => {
      const plots = [{ id: 'p-1', name: 'แปลง 01', project_name: 'ไอลิน 6', foreman_name: 'VIEW' }];
      const taskTemplates = [{ id: 't-1', task_name: 'งานโครงสร้าง', is_progress_counted: true }];
      // Mon-Sun schedule spanning Nov 7 (Sat), Nov 8 (Sun), Nov 9 (Mon), Nov 15 (Sun)
      const schedules = {
        'p-1-t-1': { planned_start: '2026-11-07', planned_end: '2026-11-16' },
      };
      // Stale snapshot that previously recorded Sunday Nov 8 as pending 0%
      const existingSnapshots = [
        {
          snapshot_date: '2026-11-08',
          plot_id: 'p-1',
          project_name: 'ไอลิน 6',
          task_template_id: 't-1',
          foreman_name: 'VIEW',
          planned_start: '2026-11-07',
          planned_end: '2026-11-16',
          current_progress: 0,
          is_updated_today: false,
        },
      ];
      // Foreman inspected 100% on Sat Nov 7 and Mon Nov 9
      const updates = [
        {
          id: 'u-sat',
          plot_id: 'p-1',
          task_template_id: 't-1',
          created_at: '2026-11-07T03:00:00.000Z',
          progress: 40,
          user_name: 'VIEW',
        },
        {
          id: 'u-mon',
          plot_id: 'p-1',
          task_template_id: 't-1',
          created_at: '2026-11-09T03:00:00.000Z',
          progress: 60,
          user_name: 'VIEW',
        },
      ];

      const monthly = getMonthlyForemanInspectionCompliance({
        year: 2026,
        month: 11,
        plots,
        taskTemplates,
        schedules,
        allUpdatesRecord: updates,
        existingSnapshots,
        foremanName: 'all',
        todayDateStr: '2026-11-09',
      });

      const nov8 = monthly.days.find(d => d.date === '2026-11-08');
      const nov15 = monthly.days.find(d => d.date === '2026-11-15');
      expect(nov8?.status).toBe('holiday');
      expect(nov8?.isHoliday).toBe(true);
      expect(nov8?.totalScheduled).toBe(0);
      expect(nov8?.pending).toBe(0);

      expect(nov15?.status).toBe('holiday');
      expect(nov15?.isHoliday).toBe(true);
      expect(nov15?.totalScheduled).toBe(0);

      // Only Sat Nov 7 and Mon Nov 9 are active past/today workdays (both 100%, 0 missed!)
      expect(monthly.totalWorkDays).toBe(2);
      expect(monthly.completeDays).toBe(2);
      expect(monthly.missedDays).toBe(0);
      expect(monthly.avgComplianceRate).toBe(100);

      // Scheduled occurrences: Nov 7, 9, 10, 11, 12, 13, 14, 16 (8 workdays, Sundays Nov 8 & 15 excluded)
      expect(monthly.totalMonthTasks).toBe(8);
      expect(monthly.foremanWorkloadStats[0].totalTasks).toBe(8);
    });

    it('skips past Sundays during freezePastDailySnapshotsForMonth', async () => {
      const plots = [{ id: 'p-1', name: 'แปลง 01', project_name: 'ไอลิน 6', foreman_name: 'VIEW' }];
      const taskTemplates = [{ id: 't-1', task_name: 'งานเสา', is_progress_counted: true }];
      const schedules = { 'p-1-t-1': { planned_start: '2026-11-07', planned_end: '2026-11-10' } };

      const insertedChunks: any[] = [];
      const mockSupabase = {
        from: () => ({
          upsert: async (chunk: any[]) => {
            insertedChunks.push(...chunk);
            return { error: null };
          },
        }),
      };

      const res = await freezePastDailySnapshotsForMonth({
        year: 2026,
        month: 11,
        plots,
        taskTemplates,
        schedules,
        todayDateStr: '2026-11-10',
        customSupabase: mockSupabase,
      });

      expect(res.success).toBe(true);
      expect(res.frozenDates).not.toContain('2026-11-08');
      expect(res.frozenDates).toContain('2026-11-07');
      expect(res.frozenDates).toContain('2026-11-09');
      expect(insertedChunks.some(r => r.snapshot_date === '2026-11-08')).toBe(false);
    });

    it('keeps scheduled tasks visible on Sunday for Option B optional updates and logs Sunday updates in daily activities', () => {
      const plots = [{ id: 'p-1', name: 'แปลง 01', project_name: 'ไอลิน 6', foreman_name: 'VIEW' }];
      const taskTemplates = [{ id: 't-1', task_name: 'งานก่ออิฐ', is_progress_counted: true }];
      const schedules = { 'p-1-t-1': { planned_start: '2026-11-06', planned_end: '2026-11-10' } };
      const updates = [
        {
          id: 'u-sun',
          plot_id: 'p-1',
          task_template_id: 't-1',
          created_at: '2026-11-08T03:00:00.000Z',
          progress: 50,
          action: 'อัปเดตงานวันอาทิตย์',
          user_name: 'VIEW',
        },
      ];

      const sundayTasks = getForemanScheduledTasksForDate({
        plots,
        taskTemplates,
        schedules,
        allUpdatesRecord: updates,
        foremanName: 'VIEW',
        targetDate: '2026-11-08',
        todayDateStr: '2026-11-08',
      });
      expect(sundayTasks).toHaveLength(1);
      expect(sundayTasks[0].is_updated_today).toBe(true);

      const activities = getForemanDailyActivities({
        plots,
        taskTemplates,
        schedules,
        allUpdatesRecord: updates,
        foremanName: 'VIEW',
        targetDate: '2026-11-08',
        todayDateStr: '2026-11-08',
      });
      expect(activities.totalActivities).toBe(1);
      expect(activities.items[0].category).toBe('out_of_plan');
      expect(activities.items[0].categoryLabel).toContain('วันหยุด');
    });
  });
});
