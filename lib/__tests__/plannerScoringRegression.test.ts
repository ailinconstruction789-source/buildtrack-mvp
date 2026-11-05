import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  calculatePlanningScore,
  parsePlotBaseline,
  recordScheduleDelayRevision,
  calculateForemanAggregates,
  calculateForemanPlotScore,
  saveSEForemanMap,
  autoDetectSEForemanMap,
  getEffectiveSEForPlot
} from '../plannerScoring';

describe('Planner Scoring Regression Tests (Findings 3, 4, 6, 9, 10)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.clear();
    }
  });

  describe('Finding 3: Saving same planned end date does not deduct score repeatedly', () => {
    it('deducts score from 100 to 75 on first extension (1 -> 10 Nov), but retains 75 when saving 10 Nov again', async () => {
      const mockSupabase = {
        from: vi.fn(() => ({
          update: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ error: null }),
          })),
          insert: vi.fn().mockResolvedValue({ error: null }),
        }))
      };

      const plot = {
        id: 'p1',
        baseline_planned_start: '2026-11-01',
        baseline_planned_end: '2026-11-05',
        baseline_locked_at: '2026-11-01T00:00:00Z',
        schedule_delay_revisions: 0,
        schedule_planning_score: 100,
      };

      const baseline = parsePlotBaseline(plot);

      // 1st Extension: 2026-11-05 -> 2026-11-10 (+5 days)
      const res1 = await recordScheduleDelayRevision(
        mockSupabase as any,
        plot,
        baseline,
        '2026-11-01',
        '2026-11-10',
        'Planner Somchai',
        'งานโครงสร้างล่าช้า'
      );

      expect(res1.success).toBe(true);
      expect(res1.newScore).toBe(75);
      expect(res1.newRevisions).toBe(1);

      // Simulate plot updated with latest approved end 2026-11-10
      const plotAfterRev1 = {
        ...plot,
        schedule_delay_revisions: 1,
        schedule_planning_score: 75,
        handover_notes: `[planner_baseline:{"end":"2026-11-10","revisions":1,"score":75}]`
      };

      const baselineAfterRev1 = parsePlotBaseline(plotAfterRev1);
      expect(baselineAfterRev1.latestApprovedEnd).toBe('2026-11-10');

      // 2nd Save: Same end date 2026-11-10 (no additional extension)
      const res2 = await recordScheduleDelayRevision(
        mockSupabase as any,
        plotAfterRev1,
        baselineAfterRev1,
        '2026-11-01',
        '2026-11-10',
        'Planner Somchai',
        'บันทึกซ้ำวันเดิม'
      );

      // Must NOT deduct to 50! Must stay 75 with 1 revision!
      expect(res2.success).toBe(true);
      expect(res2.newScore).toBe(75);
      expect(res2.newRevisions).toBe(1);
    });
  });

  describe('Finding 6: New foreman does not inherit penalties from old foreman', () => {
    it('gives new foreman 100 for plot with past delay revisions occurred before foreman_assigned_at', () => {
      const pastRevisions = [
        {
          id: 1,
          plot_id: 'p1',
          created_at: '2026-05-01T10:00:00Z',
          is_exempted: false,
          foreman_name: 'OLD_FOREMAN',
        },
        {
          id: 2,
          plot_id: 'p1',
          created_at: '2026-06-01T10:00:00Z',
          is_exempted: false,
          foreman_name: 'OLD_FOREMAN',
        },
      ];

      // Plot was reassigned to NEW_FOREMAN on 2026-11-01
      const plotAssignedToNewForeman = {
        id: 'p1',
        foreman_name: 'NEW_FOREMAN',
        foreman_assigned_at: '2026-11-01T00:00:00Z',
        baseline_locked_at: '2026-04-01T00:00:00Z',
        baseline_planned_start: '2026-04-01',
        baseline_planned_end: '2026-12-01',
        schedule_delay_revisions: 2,
        schedule_planning_score: 50, // Overall plot score is 50
      };

      // Calculate score for NEW_FOREMAN
      const newForemanScore = calculateForemanPlotScore(plotAssignedToNewForeman, pastRevisions);
      expect(newForemanScore).toBe(100);

      // Aggregates for NEW_FOREMAN must also reflect 100
      const summaries = calculateForemanAggregates([plotAssignedToNewForeman], [{ username: 'NEW_FOREMAN' }], pastRevisions);
      const newFmSummary = summaries.find(s => s.name === 'NEW_FOREMAN');
      expect(newFmSummary?.avgScore).toBe(100);
      expect(newFmSummary?.penalizedPlotsCount).toBe(0);
    });
  });

  describe('Finding 9 & 10: SE Team assignment error handling and removing foreman', () => {
    it('Finding 9: returns success: false and does not cache when database write fails', async () => {
      const mockSupabaseError = {
        from: vi.fn(() => ({
          insert: vi.fn().mockResolvedValue({ error: { message: 'permission denied for table task_updates' } }),
          update: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({ error: { message: 'permission denied for table plots' } }),
          }),
        }))
      };

      const seMap = { 'SE Somchai': ['LEAB'] };
      const res = await saveSEForemanMap(mockSupabaseError as any, seMap, 'Planner');

      expect(res.success).toBe(false);
      expect(res.error).toBeDefined();

      // Local storage must NOT have false cache
      if (typeof window !== 'undefined' && window.localStorage) {
        expect(localStorage.getItem('buildtrack_se_foreman_map')).toBeNull();
      }
    });

    it('Finding 10: clears site_engineer assignment for foremen removed from team', async () => {
      const updatedPlots: any[] = [];
      const mockSupabase = {
        from: vi.fn((table: string) => {
          if (table === 'task_updates') {
            return {
              insert: vi.fn().mockResolvedValue({ error: null })
            };
          }
          if (table === 'plots') {
            return {
              update: vi.fn((payload: any) => ({
                in: vi.fn((col: string, values: string[]) => {
                  updatedPlots.push({ payload, col, values });
                  return Promise.resolve({ error: null });
                })
              }))
            };
          }
          return {};
        })
      };

      // Previous team had Somchai -> [LEAB, KONG]
      const previousMap = { 'SE Somchai': ['LEAB', 'KONG'] };
      // New map: KONG was removed! Somchai -> [LEAB]
      const newMap = { 'SE Somchai': ['LEAB'] };

      const res = await saveSEForemanMap(mockSupabase as any, newMap, 'Planner', previousMap);
      expect(res.success).toBe(true);

      // Verify that plots for removed foreman 'KONG' had site_engineer cleared!
      const clearedUpdate = updatedPlots.find(u => u.payload.site_engineer === null && u.values.includes('KONG'));
      expect(clearedUpdate).toBeDefined();
    });

    it('R4: does NOT write task_updates audit record if plot update fails', async () => {
      const taskUpdateInsertSpy = vi.fn().mockResolvedValue({ error: null });
      const mockSupabase = {
        from: vi.fn((table: string) => {
          if (table === 'plots') {
            return {
              update: vi.fn(() => ({
                in: vi.fn().mockResolvedValue({ error: { message: 'plots update constraint failed' } })
              }))
            };
          }
          if (table === 'task_updates') {
            return {
              insert: taskUpdateInsertSpy
            };
          }
          return {};
        })
      };

      const seMap = { 'SE Somchai': ['LEAB'] };
      const res = await saveSEForemanMap(mockSupabase as any, seMap, 'Planner');

      expect(res.success).toBe(false);
      expect(res.error).toBe('plots update constraint failed');
      // Critical check: task_updates was NEVER written because plot write failed!
      expect(taskUpdateInsertSpy).not.toHaveBeenCalled();
    });

    it('R5: does NOT deduct plot score if plot_schedule_revisions insert fails', async () => {
      const plotUpdateSpy = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null })
      });
      const mockSupabase = {
        from: vi.fn((table: string) => {
          if (table === 'plot_schedule_revisions') {
            return {
              insert: vi.fn(() => ({
                select: vi.fn().mockResolvedValue({ error: { message: 'RLS check violation on plot_schedule_revisions' } })
              }))
            };
          }
          if (table === 'plots') {
            return {
              update: plotUpdateSpy
            };
          }
          return {};
        })
      };

      const plot = {
        id: 'p1',
        baseline_planned_start: '2026-11-01',
        baseline_planned_end: '2026-11-05',
        baseline_locked_at: '2026-11-01T00:00:00Z',
        schedule_delay_revisions: 0,
        schedule_planning_score: 100,
      };
      const baseline = parsePlotBaseline(plot);

      const res = await recordScheduleDelayRevision(
        mockSupabase as any,
        plot,
        baseline,
        '2026-11-01',
        '2026-11-15',
        'Planner Somchai',
        'งานโครงสร้างล่าช้า'
      );

      expect(res.success).toBe(false);
      expect(res.error).toContain('RLS check violation');
      // Score and revisions must remain at 100 and 0
      expect(res.newScore).toBe(100);
      expect(res.newRevisions).toBe(0);
      // Critical check: plots score deduction was NEVER committed!
      expect(plotUpdateSpy).not.toHaveBeenCalled();
    });
  });
});
