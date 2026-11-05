import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  normalizeDateStr,
  getForemanScheduledTasksForDate,
  getForemanReworkItems,
  saveForemanDailySnapshot,
  loadForemanDailySnapshot,
  loadForemanMonthlySnapshots,
  recordForemanTaskRoadblockReason,
  getMonthlyForemanInspectionCompliance,
} from '../foremanDuty';

describe('Foreman Duty Regression Tests (Findings 7, 8, 11, 12, 13, 14)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.clear();
    }
  });

  describe('Finding 14: UTC timestamp vs Thai (+07:00) business day', () => {
    it('converts UTC evening timestamp (18:00Z = 01:00 next day in Thailand) to the correct Thai date', () => {
      // 2026-11-03T18:00:00Z is 2026-11-04 01:00:00 GMT+7 (Thailand)
      const thaiDate = normalizeDateStr('2026-11-03T18:00:00Z');
      expect(thaiDate).toBe('2026-11-04');
    });

    it('converts UTC morning timestamp (01:00Z = 08:00 same day in Thailand)', () => {
      const thaiDate = normalizeDateStr('2026-11-04T01:00:00Z');
      expect(thaiDate).toBe('2026-11-04');
    });

    it('preserves date-only strings without shifting', () => {
      expect(normalizeDateStr('2026-11-04')).toBe('2026-11-04');
      expect(normalizeDateStr('2026-05-01')).toBe('2026-05-01');
    });
  });

  describe('Finding 7: Rework item grouping with hyphenated plot ID and UUID task template', () => {
    it('correctly maps task template and plot when plot ID has hyphens and task ID is UUID', () => {
      const plotWithHyphen = {
        id: 'IL6-A-01',
        name: 'แปลง IL6-A-01',
        project_name: 'ไอลิน 6',
        foreman_name: 'LEAB',
      };
      const taskWithUuid = {
        id: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
        task_name: 'งานเดินท่อร้อยสายไฟ',
        task_order: 5,
      };
      const updates = [
        {
          id: 999,
          plot_id: 'IL6-A-01',
          task_template_id: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
          action: 'QC สั่งแจ้งแก้ไขงวดงาน',
          text_content: 'ตรวจพบท่อสายไฟแตกร้าว',
          created_at: '2026-11-04T10:00:00Z',
          progress: 50,
          user_name: 'QC Somchai',
        },
      ];

      const reworkItems = getForemanReworkItems({
        plots: [plotWithHyphen],
        taskTemplates: [taskWithUuid],
        allUpdatesRecord: updates,
        foremanName: 'LEAB',
      });

      expect(reworkItems).toHaveLength(1);
      const item = reworkItems[0];
      expect(item.plot_id).toBe('IL6-A-01');
      expect(item.task_template_id).toBe('9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d');
      expect(item.task_name).toBe('งานเดินท่อร้อยสายไฟ');
      expect(item.title).toContain('งานเดินท่อร้อยสายไฟ');
    });
  });

  describe('Finding 13: Local snapshot cache key & contract roundtrip', () => {
    it('allows monthly reader to find snapshots written by daily writer', async () => {
      const sampleTasks = [
        {
          id: 'plot-1-task-1',
          plot_id: 'plot-1',
          plot_name: 'แปลง 01',
          project_name: 'ไอลิน 6',
          foreman_name: 'LEAB',
          task_template_id: 'task-1',
          task_name: 'งานฐานราก',
          planned_start: '2026-11-04',
          planned_end: '2026-11-08',
          current_progress: 40,
          is_updated_today: true,
          status_reason: 'material_issue',
          status_note: 'รอเหล็กเสริม',
        },
      ];

      // Mock offline supabase client that throws immediately to test localStorage fallback
      const mockOfflineSupabase = {
        from: vi.fn(() => ({
          upsert: vi.fn().mockRejectedValue(new Error('Network offline')),
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockRejectedValue(new Error('Network offline')),
            gte: vi.fn().mockReturnValue({
              lte: vi.fn().mockReturnValue({
                ilike: vi.fn().mockRejectedValue(new Error('Network offline')),
              })
            })
          })
        }))
      };

      // Save via daily snapshot
      await saveForemanDailySnapshot(sampleTasks as any, '2026-11-04', 'LEAB', 'Tester', mockOfflineSupabase as any);

      // Daily reader should find it from localStorage cache
      const dailyData = await loadForemanDailySnapshot('2026-11-04', 'LEAB', mockOfflineSupabase as any);
      expect(dailyData.data).toHaveLength(1);
      expect(dailyData.data[0].task_name).toBe('งานฐานราก');

      // Monthly reader should ALSO find it in the same month (year 2026, month 11) from localStorage cache
      const monthlyData = await loadForemanMonthlySnapshots(2026, 11, 'LEAB', undefined, mockOfflineSupabase as any);
      expect(monthlyData.length).toBeGreaterThanOrEqual(1);
      const found = monthlyData.find(m => m.task_template_id === 'task-1');
      expect(found).toBeDefined();
      expect(found?.status_reason).toBe('material_issue');
      expect(found?.status_note).toBe('รอเหล็กเสริม');
    });
  });

  describe('Finding 12: Today progress source of truth vs historical snapshot', () => {
    it('shows latest assignment progress (80%) for today even if snapshot had 20%', () => {
      const plots = [
        { id: 'p1', name: 'แปลง 1', foreman_name: 'LEAB', project_name: 'ไอลิน' }
      ];
      const taskTemplates = [
        { id: 't1', task_name: 'งานเสา', task_order: 1 }
      ];
      const schedules = {
        'p1-t1': { planned_start: '2026-11-01', planned_end: '2026-11-10' }
      };
      // Live assignment updated to 80%
      const assignments = [
        { plot_id: 'p1', task_template_id: 't1', current_progress: 80 }
      ];
      // Early morning snapshot recorded 20%
      const existingSnapshots = [
        {
          snapshot_date: '2026-11-05',
          plot_id: 'p1',
          task_template_id: 't1',
          current_progress: 20
        }
      ];

      // Target date is today ('2026-11-05')
      const tasks = getForemanScheduledTasksForDate({
        plots,
        taskTemplates,
        schedules,
        assignments,
        foremanName: 'LEAB',
        targetDate: '2026-11-05',
        existingSnapshots
      });

      expect(tasks).toHaveLength(1);
      // For today, live progress (80) must be reflected, not stale morning snapshot (20)
      expect(tasks[0].current_progress).toBe(80);
    });

    it('preserves frozen snapshot progress (20%) for a past date even if today assignment is 80%', () => {
      const plots = [
        { id: 'p1', name: 'แปลง 1', foreman_name: 'LEAB', project_name: 'ไอลิน' }
      ];
      const taskTemplates = [
        { id: 't1', task_name: 'งานเสา', task_order: 1 }
      ];
      const schedules = {
        'p1-t1': { planned_start: '2026-11-01', planned_end: '2026-11-10' }
      };
      // Today assignment is 80%
      const assignments = [
        { plot_id: 'p1', task_template_id: 't1', current_progress: 80 }
      ];
      // Past snapshot on 2026-11-02 was frozen at 20%
      const existingSnapshots = [
        {
          snapshot_date: '2026-11-02',
          plot_id: 'p1',
          task_template_id: 't1',
          current_progress: 20
        }
      ];

      // Viewing past date ('2026-11-02')
      const tasks = getForemanScheduledTasksForDate({
        plots,
        taskTemplates,
        schedules,
        assignments,
        foremanName: 'LEAB',
        targetDate: '2026-11-02',
        existingSnapshots
      });

      expect(tasks).toHaveLength(1);
      // For past date, frozen snapshot progress (20) must be preserved
      expect(tasks[0].current_progress).toBe(20);
    });
  });

  describe('Finding 11: Historical attribution preservation when foreman re-assigned', () => {
    it('attributes past tasks to the historical foreman from snapshot even if plot belongs to a new foreman today', () => {
      // Plot is currently assigned to Foreman B ('SOMCHAI')
      const plots = [
        { id: 'p1', name: 'แปลง 1', foreman_name: 'SOMCHAI', project_name: 'ไอลิน' }
      ];
      const taskTemplates = [
        { id: 't1', task_name: 'งานโครงสร้าง', task_order: 1 }
      ];
      const schedules = {
        'p1-t1': { planned_start: '2026-11-01', planned_end: '2026-11-10' }
      };
      // Yesterday's snapshot was recorded under Foreman A ('LEAB')
      const existingSnapshots = [
        {
          snapshot_date: '2026-11-04',
          foreman_name: 'LEAB',
          plot_id: 'p1',
          project_name: 'ไอลิน',
          task_template_id: 't1',
          task_name: 'งานโครงสร้าง',
          current_progress: 40,
        }
      ];

      // When querying historical date '2026-11-04' for foreman 'LEAB':
      const tasksForLeab = getForemanScheduledTasksForDate({
        plots,
        taskTemplates,
        schedules,
        foremanName: 'LEAB',
        targetDate: '2026-11-04',
        existingSnapshots
      });

      // LEAB should still see his past task!
      expect(tasksForLeab).toHaveLength(1);
      expect(tasksForLeab[0].foreman_name).toBe('LEAB');

      // And SOMCHAI querying that past date should NOT see LEAB's historical task
      const tasksForSomchai = getForemanScheduledTasksForDate({
        plots,
        taskTemplates,
        schedules,
        foremanName: 'SOMCHAI',
        targetDate: '2026-11-04',
        existingSnapshots
      });
      expect(tasksForSomchai).toHaveLength(0);
    });
  });

  describe('Finding 8: Roadblock submission column name and error handling', () => {
    it('uses text_content column and fails gracefully when Supabase returns an error', async () => {
      const mockTask = {
        id: 'p1-t1',
        plot_id: 'p1',
        project_name: 'ไอลิน',
        task_template_id: 't1',
        task_name: 'งานเทปูน',
        foreman_name: 'LEAB',
        current_progress: 10,
      };

      // Mock Supabase error on task_updates
      const mockSupabase = {
        from: vi.fn((table: string) => {
          if (table === 'foreman_daily_duty_snapshots') {
            return {
              upsert: vi.fn().mockResolvedValue({ error: null })
            };
          }
          if (table === 'task_updates') {
            return {
              insert: vi.fn().mockImplementation((payloads: any[]) => {
                const row = payloads[0];
                // Ensure text_content is populated, not 'text'
                if (!('text_content' in row) || ('text' in row)) {
                  return Promise.resolve({ error: { message: 'Column "text" does not exist' } });
                }
                return Promise.resolve({ error: null });
              })
            };
          }
          return {};
        })
      };

      // We will pass or test the function with properly verified payload
      const result = await recordForemanTaskRoadblockReason(
        mockTask as any,
        '2026-11-05',
        'material_issue',
        'ปูนไม่พอ',
        'LEAB',
        mockSupabase as any
      );

      expect(result.success).toBe(true);
    });

    it('R6: returns success: false and error message when remote roadblock save fails', async () => {
      const mockTask = {
        id: 'p1-t1',
        plot_id: 'p1',
        project_name: 'ไอลิน',
        task_template_id: 't1',
        task_name: 'งานเทปูน',
        foreman_name: 'LEAB',
        current_progress: 10,
      };

      const mockSupabaseError = {
        from: vi.fn((table: string) => {
          if (table === 'foreman_daily_duty_snapshots') {
            return {
              upsert: vi.fn().mockResolvedValue({ error: { message: 'DB connection refused' } })
            };
          }
          if (table === 'task_updates') {
            return {
              insert: vi.fn().mockResolvedValue({ error: { message: 'Insert denied' } })
            };
          }
          return {};
        })
      };

      const result = await recordForemanTaskRoadblockReason(
        mockTask as any,
        '2026-11-05',
        'material_issue',
        'ปูนไม่พอ',
        'LEAB',
        mockSupabaseError as any
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('R1: loadForemanDailySnapshot returns status error when query fails and cache is empty', async () => {
      const mockSupabaseError = {
        from: vi.fn(() => ({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: null, error: { message: '500 Internal DB Error' } })
          })
        }))
      };

      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.clear();
      }

      const res = await loadForemanDailySnapshot('2026-11-05', 'LEAB', mockSupabaseError as any);
      expect(res.status).toBe('error');
      expect(res.storage).toBe('none');
      expect(res.data).toHaveLength(0);
      expect(res.error).toBeDefined();
    });

    it('R1: saveForemanDailySnapshot returns storage local_cache and isRemoteSynced false on DB failure', async () => {
      const mockSupabaseError = {
        from: vi.fn(() => ({
          upsert: vi.fn().mockResolvedValue({ data: null, error: { message: 'Upsert RLS blocked' } })
        }))
      };

      const tasks = [
        {
          id: 'p1-t1',
          plot_id: 'p1',
          plot_name: 'แปลง 01',
          project_name: 'ไอลิน',
          task_template_id: 't1',
          task_name: 'งานโครงสร้าง',
          foreman_name: 'LEAB',
          planned_start: '2026-11-01',
          planned_end: '2026-11-10',
          current_progress: 50,
          is_updated_today: true,
        }
      ];

      const saveRes = await saveForemanDailySnapshot(tasks as any, '2026-11-05', 'LEAB', 'Tester', mockSupabaseError as any);
      expect(saveRes.success).toBe(false);
      expect(saveRes.storage).toBe('local_cache');
      expect(saveRes.isRemoteSynced).toBe(false);
      expect(saveRes.error).toBe('Upsert RLS blocked');
    });

    it('R8: getMonthlyForemanInspectionCompliance scopes calculation strictly by projectName', () => {
      const plots = [
        { id: 'p1', name: 'แปลง 01', project_name: 'ไอลิน 6', foreman_name: 'LEAB' },
        { id: 'p2', name: 'แปลง 02', project_name: 'ไอลิน 7', foreman_name: 'LEAB' }
      ];
      const taskTemplates = [{ id: 't1', task_name: 'งานเสา' }];
      const schedules = {
        'p1-t1': { planned_start: '2026-11-01', planned_end: '2026-11-10' },
        'p2-t1': { planned_start: '2026-11-01', planned_end: '2026-11-10' }
      };

      // Query monthly compliance scoped to 'ไอลิน 6'
      const summaryIlin6 = getMonthlyForemanInspectionCompliance({
        year: 2026,
        month: 11,
        plots,
        taskTemplates,
        schedules,
        foremanName: 'all',
        projectName: 'ไอลิน 6',
        todayDateStr: '2026-11-05'
      });

      // Day 1 tasks should only have 1 task (p1), NOT 2 tasks (p1 + p2)
      const day1 = summaryIlin6.days.find(d => d.date === '2026-11-01');
      expect(day1?.totalScheduled).toBe(1);
      expect(day1?.plotsCount).toBe(1);
    });
  });
});
