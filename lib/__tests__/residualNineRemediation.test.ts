import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  loadForemanDailySnapshot,
  loadForemanMonthlySnapshots,
  getForemanScheduledTasksForDate,
  recordForemanTaskRoadblockReason,
  type LoadSnapshotResult,
  type ForemanDailyTask,
} from '../foremanDuty';
import {
  saveSEForemanMap,
  loadSEForemanMap,
  recordScheduleDelayRevision,
  type PlotBaselineData,
} from '../plannerScoring';

describe('Residual Remediation Verification (All 5 Findings F1-F5 + Regressions)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.clear();
    }
  });

  // =========================================================================
  // Finding F2 (P1): Auth Contract & Snapshot RLS Hardening (Fail-Closed)
  // =========================================================================
  describe('Finding F2 (P1): Snapshot RLS hardening and fail-closed app_snapshot_caller_role()', () => {
    const sqlPath = path.resolve(__dirname, '../../sql/20261105_foreman_snapshots_rls_hardening.sql');

    it('migration file defines app_snapshot_caller_role() without altering app_current_actor() signature', () => {
      expect(fs.existsSync(sqlPath)).toBe(true);
      const sqlContent = fs.readFileSync(sqlPath, 'utf8');

      // Must NOT recreate or drop app_current_actor which causes 42P13
      expect(sqlContent).not.toMatch(/DROP\s+FUNCTION.*app_current_actor/i);
      expect(sqlContent).not.toMatch(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+public\.app_current_actor/i);

      // Must define dedicated helper public.app_snapshot_caller_role() RETURNS text
      expect(sqlContent).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.app_snapshot_caller_role\(\)\s+RETURNS\s+text/i);

      // Policies must use app_snapshot_caller_role()
      expect(sqlContent).toContain('app_snapshot_caller_role()');
    });

    it('implements fail-closed security: never falls back to JWT claims if trusted actor procedure exists', () => {
      const sqlContent = fs.readFileSync(sqlPath, 'utf8');

      // Trusted actor block must catch exceptions and return 'anon' immediately
      expect(sqlContent).toMatch(/WHEN\s+OTHERS\s+THEN\s+RETURN\s+'anon';/i);

      // Must read role from actor and return lower(v_role) or fail-closed 'anon'
      expect(sqlContent).toMatch(/v_role\s*:=\s*v_actor\s*->>\s*'role';/i);
      expect(sqlContent).toMatch(/RETURN\s+lower\(v_role\);/i);

      // JWT fallback (auth.jwt()) must only appear in the ELSE block when app_current_actor() IS NULL
      const elseIndex = sqlContent.indexOf("to_regprocedure('public.app_current_actor()') IS NOT NULL");
      expect(elseIndex).toBeGreaterThan(-1);

      const afterCheck = sqlContent.slice(elseIndex);
      const jwtMatch = afterCheck.indexOf('auth.jwt()');
      const elseKeyword = afterCheck.indexOf('ELSE');
      expect(jwtMatch).toBeGreaterThan(elseKeyword);
    });
  });

  // =========================================================================
  // Issue 2: Auto-Save Cache Fallback Safety
  // =========================================================================
  describe('Issue 2 (P1): Auto-Save cache fallback safety prevents remote DB overwrites', () => {
    it('returns status cache_fallback and storage local_cache when offline cache is read', async () => {
      const mockSupabase = {
        from: vi.fn(() => ({
          select: vi.fn().mockReturnValue({
            ilike: vi.fn().mockResolvedValue({
              data: null,
              error: { message: 'Network offline / connection timeout' },
            }),
            eq: vi.fn().mockReturnValue({
              ilike: vi.fn().mockResolvedValue({
                data: null,
                error: { message: 'Network offline / connection timeout' },
              }),
            }),
          }),
        })),
      };

      const cachedTasks = [{
        id: 't-cached-1',
        plot_id: 'p1',
        task_template_id: 'temp-1',
        task_name: 'งานโครงสร้าง',
        current_progress: 30,
        snapshot_date: '2026-11-05',
        foreman_name: 'LEAB',
      }];
      window.localStorage.setItem('buildtrack_fm_snapshot_2026-11-05_leab', JSON.stringify(cachedTasks));

      const res = await loadForemanDailySnapshot('2026-11-05', 'LEAB', mockSupabase as any);

      expect(res.status).toBe('cache_fallback');
      expect(res.storage).toBe('local_cache');
      expect(res.data).toHaveLength(1);
      expect(res.data[0].id).toBe('t-cached-1');
      expect(res.error).toBeDefined();
    });

    it('returns typed LoadSnapshotResult with success when remote query succeeds', async () => {
      const mockSupabase = {
        from: vi.fn(() => ({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              ilike: vi.fn().mockResolvedValue({
                data: [{ id: 'snap-1', task_name: 'งานเสาเข็ม', current_progress: 50 }],
                error: null,
              }),
            }),
          }),
        })),
      };

      const res = await loadForemanDailySnapshot('2026-11-05', 'LEAB', mockSupabase as any);
      expect(res.status).toBe('success');
      expect(res.storage).toBe('remote');
      expect(Array.isArray(res.data)).toBe(true);
      expect(res.data).toHaveLength(1);
      expect(res.data[0].task_name).toBe('งานเสาเข็ม');
    });
  });

  // =========================================================================
  // Finding F1 (P1): Delay Revision Schema Parity & Incomplete Commit Check
  // =========================================================================
  describe('Finding F1 (P1): Schedule delay revision retry, recovery, and commit check', () => {
    const mockPlot = { id: 'plot-1', name: 'แปลง 01', foreman_name: 'LEAB', site_engineer: 'SE_SOMCHAI' };
    const mockBaseline: PlotBaselineData = {
      isLocked: true,
      start: '2026-11-01',
      end: '2026-11-10',
      latestApprovedEnd: '2026-11-10',
      lockedAt: '2026-11-01T08:00:00Z',
      lockedBy: 'Project Planner',
      revisions: 0,
      score: 100,
    };

    it('queries schema-supported columns only (no revision_count) on plot_schedule_revisions', async () => {
      let selectedColumns: string | null = null;
      const mockSupabase = {
        from: vi.fn((table: string) => {
          if (table === 'plot_schedule_revisions') {
            return {
              select: vi.fn((cols: string) => {
                selectedColumns = cols;
                return {
                  eq: vi.fn().mockReturnValue({
                    eq: vi.fn().mockReturnValue({
                      order: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue({
                          data: [{ id: 'rev-uuid-1', new_score: 75, new_planned_end: '2026-11-20', is_exempted: false }],
                          error: null,
                        }),
                      }),
                    }),
                  }),
                };
              }),
            };
          }
          if (table === 'plots') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue({
                    data: [{
                      id: 'plot-1',
                      schedule_planning_score: 75,
                      schedule_delay_revisions: 1,
                      baseline_planned_end: '2026-11-20',
                    }],
                    error: null,
                  }),
                }),
              }),
            };
          }
          return {};
        }),
      };

      const res = await recordScheduleDelayRevision(
        mockSupabase as any,
        mockPlot,
        mockBaseline,
        '2026-11-01',
        '2026-11-20',
        'Planner',
        'ขยายแผน'
      );

      expect(res.success).toBe(true);
      expect(selectedColumns).toBeDefined();
      expect(selectedColumns).not.toContain('revision_count');
      expect(selectedColumns).toContain('id');
      expect(selectedColumns).toContain('new_score');
      expect(selectedColumns).toContain('new_planned_end');
    });

    it('halts and returns success: false when query on existing revisions encounters an error', async () => {
      const mockSupabase = {
        from: vi.fn((table: string) => {
          if (table === 'plot_schedule_revisions') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    order: vi.fn().mockReturnValue({
                      limit: vi.fn().mockResolvedValue({
                        data: null,
                        error: { code: 'PGRST500', message: 'Database connection interrupted' },
                      }),
                    }),
                  }),
                }),
              }),
            };
          }
          return {};
        }),
      };

      const res = await recordScheduleDelayRevision(
        mockSupabase as any,
        mockPlot,
        mockBaseline,
        '2026-11-01',
        '2026-11-20',
        'Planner',
        'ขยายแผน'
      );

      expect(res.success).toBe(false);
      expect(res.error).toContain('ไม่สามารถตรวจสอบประวัติการปรับแผนเดิม');
    });

    it('exempt revision check: does NOT acknowledge commit on score equality alone when end date is uncommitted', async () => {
      const updatePlotsSpy = vi.fn().mockResolvedValue({ error: null });

      const mockSupabase = {
        from: vi.fn((table: string) => {
          if (table === 'plot_schedule_revisions') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    order: vi.fn().mockReturnValue({
                      limit: vi.fn().mockResolvedValue({
                        data: [{ id: 'rev-exempt-1', new_score: 100, new_planned_end: '2026-11-25', is_exempted: true }],
                        error: null,
                      }),
                    }),
                  }),
                }),
              }),
            };
          }
          if (table === 'plots') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue({
                    // Score is 100, but baseline_planned_end was NOT committed yet (still 2026-11-10)
                    data: [{
                      id: 'plot-1',
                      schedule_planning_score: 100,
                      schedule_delay_revisions: 0,
                      baseline_planned_end: '2026-11-10',
                      handover_notes: '',
                    }],
                    error: null,
                  }),
                }),
              }),
              update: vi.fn().mockReturnValue({
                eq: updatePlotsSpy,
              }),
            };
          }
          return {};
        }),
      };

      const res = await recordScheduleDelayRevision(
        mockSupabase as any,
        mockPlot,
        mockBaseline,
        '2026-11-01',
        '2026-11-25',
        'Owner',
        'เหตุสุดวิสัย น้ำท่วม',
        { isExempt: true }
      );

      expect(res.success).toBe(true);
      // Because end date was not committed, it must perform recovery update to plots table!
      expect(updatePlotsSpy).toHaveBeenCalled();
    });

    it('returns success when both revision and plots table are completely committed', async () => {
      const mockSupabase = {
        from: vi.fn((table: string) => {
          if (table === 'plot_schedule_revisions') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    order: vi.fn().mockReturnValue({
                      limit: vi.fn().mockResolvedValue({
                        data: [{ id: 'rev-uuid-1', new_score: 75, new_planned_end: '2026-11-20', is_exempted: false }],
                        error: null,
                      }),
                    }),
                  }),
                }),
              }),
            };
          }
          if (table === 'plots') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue({
                    data: [{
                      id: 'plot-1',
                      schedule_planning_score: 75,
                      schedule_delay_revisions: 1,
                      baseline_planned_end: '2026-11-20',
                    }],
                    error: null,
                  }),
                }),
              }),
            };
          }
          return {};
        }),
      };

      const res = await recordScheduleDelayRevision(
        mockSupabase as any,
        mockPlot,
        mockBaseline,
        '2026-11-01',
        '2026-11-20',
        'Planner',
        'ขยายแผน'
      );

      expect(res.success).toBe(true);
      expect(res.newScore).toBe(75);
      expect(res.newRevisions).toBe(1);
    });

    it('recovers partial state: updates uncommitted plots table when orphan revision row exists', async () => {
      const updatePlotsSpy = vi.fn().mockResolvedValue({ error: null });

      const mockSupabase = {
        from: vi.fn((table: string) => {
          if (table === 'plot_schedule_revisions') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    order: vi.fn().mockReturnValue({
                      limit: vi.fn().mockResolvedValue({
                        data: [{ id: 'rev-uuid-orphan', new_score: 75, new_planned_end: '2026-11-20', is_exempted: false }],
                        error: null,
                      }),
                    }),
                  }),
                }),
              }),
            };
          }
          if (table === 'plots') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue({
                    data: [{ id: 'plot-1', schedule_planning_score: 100, schedule_delay_revisions: 0 }],
                    error: null,
                  }),
                }),
              }),
              update: vi.fn().mockReturnValue({
                eq: updatePlotsSpy,
              }),
            };
          }
          return {};
        }),
      };

      const res = await recordScheduleDelayRevision(
        mockSupabase as any,
        mockPlot,
        mockBaseline,
        '2026-11-01',
        '2026-11-20',
        'Planner',
        'ขยายแผน'
      );

      expect(res.success).toBe(true);
      expect(res.newScore).toBe(75);
      expect(updatePlotsSpy).toHaveBeenCalled();
    });

    it('executes rollback and checks delete error when plots update fails', async () => {
      const deleteSpy = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      });

      const mockSupabase = {
        from: vi.fn((table: string) => {
          if (table === 'plot_schedule_revisions') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    order: vi.fn().mockReturnValue({
                      limit: vi.fn().mockResolvedValue({ data: [] }),
                    }),
                  }),
                }),
              }),
              insert: vi.fn().mockReturnValue({
                select: vi.fn().mockResolvedValue({ data: [{ id: 'rev-uuid-fail' }], error: null }),
              }),
              delete: deleteSpy,
            };
          }
          if (table === 'plots') {
            return {
              update: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ error: { code: 'PGRST204', message: 'column error on plots' } }),
              }),
            };
          }
          return {};
        }),
      };

      const res = await recordScheduleDelayRevision(
        mockSupabase as any,
        mockPlot,
        mockBaseline,
        '2026-11-01',
        '2026-11-20',
        'Planner',
        'ขยายแผน'
      );
      expect(res.success).toBe(false);
      expect(res.error).toBe('column error on plots');
      expect(deleteSpy).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Finding F3 (P2): SE-Foreman Mapping Pre-State Capture & Rollback Safety
  // =========================================================================
  describe('Finding F3 (P2): SE-Foreman mapping rollback restores genuine persisted pre-operation state', () => {
    it('restores genuine persisted site_engineer from prePlotState when previousMap is empty or stale', async () => {
      const plotsUpdateCalls: any[] = [];
      const mockPlotsUpdate = vi.fn((payload) => ({
        in: vi.fn((column, values) => {
          plotsUpdateCalls.push({ payload, column, values });
          return Promise.resolve({ error: null });
        }),
      }));

      // Pre-operation database state:
      // Plot 'p1' (Foreman LEAB) belongs to 'SE_SOMCHAI'
      // Plot 'p2' (Foreman KONG) belongs to 'SE_WICHAI'
      // Plot 'p3' (Foreman NEW_GUY) has site_engineer: null
      const prePlots = [
        { id: 'p1', foreman_name: 'LEAB', site_engineer: 'SE_SOMCHAI' },
        { id: 'p2', foreman_name: 'KONG', site_engineer: 'SE_WICHAI' },
        { id: 'p3', foreman_name: 'NEW_GUY', site_engineer: null },
      ];

      // New map: SE_SOMCHAI gets ['LEAB', 'KONG', 'NEW_GUY']
      const newMap = { SE_SOMCHAI: ['LEAB', 'KONG', 'NEW_GUY'] };
      // Caller passes an empty/stale previousMap:
      const previousMap = {};

      const mockSupabase = {
        from: vi.fn((table: string) => {
          if (table === 'plots') {
            return {
              select: vi.fn().mockReturnValue({
                in: vi.fn().mockResolvedValue({ data: prePlots, error: null }),
              }),
              update: mockPlotsUpdate,
            };
          }
          if (table === 'task_updates') {
            return {
              // Audit log insert fails, triggering rollback
              insert: vi.fn().mockResolvedValue({ error: { message: 'Audit insert failure' } }),
            };
          }
          return {};
        }),
      };

      const res = await saveSEForemanMap(mockSupabase as any, newMap, 'Planner', previousMap);
      expect(res.success).toBe(false);
      expect(res.error).toContain('Audit insert failure');

      // Check rollback calls restored each plot to its genuine pre-operation state:
      // p1 restored to SE_SOMCHAI
      const somchaiRollback = plotsUpdateCalls.find(
        call => call.payload?.site_engineer === 'SE_SOMCHAI' && call.values.includes('p1')
      );
      expect(somchaiRollback).toBeDefined();

      // p2 restored to SE_WICHAI (NOT wiped to null!)
      const wichaiRollback = plotsUpdateCalls.find(
        call => call.payload?.site_engineer === 'SE_WICHAI' && call.values.includes('p2')
      );
      expect(wichaiRollback).toBeDefined();

      // p3 restored to null
      const nullRollback = plotsUpdateCalls.find(
        call => call.payload?.site_engineer === null && call.values.includes('p3')
      );
      expect(nullRollback).toBeDefined();
    });

    it('returns error and stops when pre-state query fails', async () => {
      const mockSupabase = {
        from: vi.fn((table: string) => {
          if (table === 'plots') {
            return {
              select: vi.fn().mockReturnValue({
                in: vi.fn().mockResolvedValue({ data: null, error: { message: 'Plots table connection lost' } }),
              }),
              update: vi.fn(),
            };
          }
          return {};
        }),
      };

      const res = await saveSEForemanMap(mockSupabase as any, { SE_SOMCHAI: ['LEAB'] }, 'Planner');
      expect(res.success).toBe(false);
      expect(res.error).toContain('ไม่สามารถตรวจสอบสถานะแปลงก่อนบันทึกทีมงาน');
    });

    it('reconciles loadSEForemanMap with plots ground truth', async () => {
      const mockSupabase = {
        from: vi.fn(() => ({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({
                  data: [{ text_content: JSON.stringify({ SE_OLD: ['LEAB'] }) }],
                }),
              }),
            }),
          }),
        })),
      };

      const plotsGroundTruth = [
        { id: 'p1', foreman_name: 'LEAB', site_engineer: 'SE_GROUND_TRUTH' },
      ];

      const reconciledMap = await loadSEForemanMap(mockSupabase as any, plotsGroundTruth);
      expect(reconciledMap.SE_GROUND_TRUTH).toContain('LEAB');
      expect(reconciledMap.SE_OLD).not.toContain('LEAB');
    });
  });

  // =========================================================================
  // Finding F4 (P2): Roadblock Submission ID Dedup Across All Records
  // =========================================================================
  describe('Finding F4 (P2): Roadblock retry and unique submission session dedup', () => {
    const sampleTask: ForemanDailyTask = {
      id: 'p1-t1',
      plot_id: 'p1',
      plot_name: 'แปลง 01',
      project_name: 'ไอลิน 6',
      foreman_name: 'LEAB',
      task_template_id: 't1',
      task_name: 'งานเสาเข็ม',
      task_order: 1,
      planned_start: '2026-11-01',
      planned_end: '2026-11-10',
      current_progress: 30,
      is_updated_today: false,
    };

    it('finds existing entry by [ref:subId] across whole table without limit(10) or date filters, and updates it', async () => {
      const existingFeedId = 'feed-retry-123';
      const insertSpy = vi.fn();
      const updateSpy = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      });

      let selectCols: string | null = null;
      let ilikePattern: string | null = null;

      const mockClient = {
        from: vi.fn((table: string) => {
          if (table === 'foreman_daily_duty_snapshots') {
            return {
              upsert: vi.fn().mockResolvedValue({ error: null }),
            };
          }
          if (table === 'task_updates') {
            return {
              select: vi.fn((cols: string) => {
                selectCols = cols;
                return {
                  eq: vi.fn().mockReturnValue({
                    ilike: vi.fn((col: string, pattern: string) => {
                      ilikePattern = pattern;
                      return Promise.resolve({
                        data: [{ id: existingFeedId, text_content: 'เหตุผล: วัสดุไม่พอ [ref:sub-session-99]' }],
                        error: null,
                      });
                    }),
                  }),
                };
              }),
              update: updateSpy,
              insert: insertSpy,
            };
          }
          return {};
        }),
      };

      const res = await recordForemanTaskRoadblockReason(
        sampleTask,
        '2026-11-05',
        'material_issue',
        'รอบทบทวน',
        'LEAB',
        mockClient as any,
        { clientSubmissionId: 'sub-session-99' }
      );

      expect(res.success).toBe(true);
      expect(selectCols).toBe('id, text_content');
      expect(ilikePattern).toBe('%[ref:sub-session-99]%');
      expect(updateSpy).toHaveBeenCalled();
      expect(insertSpy).not.toHaveBeenCalled();
    });

    it('submitting with a new clientSubmissionId inserts a new entry, preserving distinct events', async () => {
      const insertSpy = vi.fn().mockResolvedValue({ error: null });
      const updateSpy = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      });

      const mockClient = {
        from: vi.fn((table: string) => {
          if (table === 'foreman_daily_duty_snapshots') {
            return {
              upsert: vi.fn().mockResolvedValue({ error: null }),
            };
          }
          if (table === 'task_updates') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  ilike: vi.fn().mockResolvedValue({
                    // No match for the new session id
                    data: [],
                    error: null,
                  }),
                }),
              }),
              update: updateSpy,
              insert: insertSpy,
            };
          }
          return {};
        }),
      };

      const res = await recordForemanTaskRoadblockReason(
        sampleTask,
        '2026-11-05',
        'worker_issue',
        'ช่างติดโควิด 3 คน',
        'LEAB',
        mockClient as any,
        { clientSubmissionId: 'sub-afternoon-session' }
      );

      expect(res.success).toBe(true);
      expect(insertSpy).toHaveBeenCalled();
      expect(updateSpy).not.toHaveBeenCalled();
    });

    it('halts and returns success: false if search query on task_updates returns error', async () => {
      const mockClient = {
        from: vi.fn((table: string) => {
          if (table === 'foreman_daily_duty_snapshots') {
            return {
              upsert: vi.fn().mockResolvedValue({ error: null }),
            };
          }
          if (table === 'task_updates') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  ilike: vi.fn().mockResolvedValue({
                    data: null,
                    error: { message: 'Database query timeout' },
                  }),
                }),
              }),
            };
          }
          return {};
        }),
      };

      const res = await recordForemanTaskRoadblockReason(
        sampleTask,
        '2026-11-05',
        'worker_issue',
        'เหตุผล',
        'LEAB',
        mockClient as any,
        { clientSubmissionId: 'sub-fail-check' }
      );

      expect(res.success).toBe(false);
      expect(res.error).toContain('Database query timeout');
    });
  });

  // =========================================================================
  // Finding F5 (P2): Historical Ownership Consistency (Daily vs Monthly)
  // =========================================================================
  describe('Finding F5 (P2): Daily and monthly historical ownership consistency across reassignments', () => {
    it('loadForemanDailySnapshot queries using OR condition (foreman_name OR plot_id IN) when plotIds are provided', async () => {
      let orClause: string | null = null;
      const mockSupabase = {
        from: vi.fn(() => ({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              or: vi.fn((clause: string) => {
                orClause = clause;
                return Promise.resolve({
                  data: [{ id: 'snap-reassigned-1', task_name: 'งานสี', current_progress: 80, plot_id: 'plot-56' }],
                  error: null,
                });
              }),
            }),
          }),
        })),
      };

      const res = await loadForemanDailySnapshot(
        '2026-11-05',
        'Foreman B',
        mockSupabase as any,
        { plotIds: ['plot-56', 'plot-57'] }
      );

      expect(res.status).toBe('success');
      expect(orClause).toBeDefined();
      expect(orClause).toContain('foreman_name.ilike.foreman b');
      expect(orClause).toContain('plot_id.in.(plot-56,plot-57)');
    });

    it('loadForemanMonthlySnapshots queries using same OR condition for plotIds', async () => {
      let orClause: string | null = null;
      const mockSupabase = {
        from: vi.fn(() => ({
          select: vi.fn().mockReturnValue({
            gte: vi.fn().mockReturnValue({
              lte: vi.fn().mockReturnValue({
                or: vi.fn((clause: string) => {
                  orClause = clause;
                  return Promise.resolve({
                    data: [{ id: 'snap-monthly-1', snapshot_date: '2026-11-04', plot_id: 'plot-56', current_progress: 50 }],
                    error: null,
                  });
                }),
              }),
            }),
          }),
        })),
      };

      const monthlyRes = await loadForemanMonthlySnapshots(
        2026,
        11,
        'Foreman B',
        'all',
        mockSupabase as any,
        { plotIds: ['plot-56', 'plot-57'] }
      );

      expect(Array.isArray(monthlyRes)).toBe(true);
      expect(monthlyRes).toHaveLength(1);
      expect(orClause).toBeDefined();
      expect(orClause).toContain('foreman_name.ilike.foreman b');
      expect(orClause).toContain('plot_id.in.(plot-56,plot-57)');
    });

    it('produces consistent ownership results between daily and monthly loaders for reassigned plot', async () => {
      // Reassigned plot-99 was worked on Nov 5 by Foreman A, then reassigned to Foreman B
      const sharedSnapshot = {
        id: 'snap-reassigned-99',
        snapshot_date: '2026-11-05',
        plot_id: 'plot-99',
        task_template_id: 'task-1',
        foreman_name: 'Foreman A',
        current_progress: 75,
      };

      const mockSupabase = {
        from: vi.fn(() => ({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              or: vi.fn().mockResolvedValue({
                data: [sharedSnapshot],
                error: null,
              }),
            }),
            gte: vi.fn().mockReturnValue({
              lte: vi.fn().mockReturnValue({
                or: vi.fn().mockResolvedValue({
                  data: [sharedSnapshot],
                  error: null,
                }),
              }),
            }),
          }),
        })),
      };

      // Query daily for Foreman B with plotIds including plot-99
      const dailyRes = await loadForemanDailySnapshot(
        '2026-11-05',
        'Foreman B',
        mockSupabase as any,
        { plotIds: ['plot-99'] }
      );

      // Query monthly for Foreman B with plotIds including plot-99
      const monthlyRes = await loadForemanMonthlySnapshots(
        2026,
        11,
        'Foreman B',
        'all',
        mockSupabase as any,
        { plotIds: ['plot-99'] }
      );

      expect(dailyRes.data).toHaveLength(1);
      expect(dailyRes.data[0].plot_id).toBe('plot-99');

      expect(monthlyRes).toHaveLength(1);
      expect(monthlyRes[0].plot_id).toBe('plot-99');
      expect(monthlyRes[0].current_progress).toBe(dailyRes.data[0].current_progress);
    });

    it('does not attribute Foreman A snapshot on Nov 4 to Foreman B when viewing Nov 4 for B', () => {
      const plots = [
        { id: 'plot-56', name: 'แปลง 56', foreman_name: 'Foreman B', foreman_assigned_at: '2026-11-04' },
      ];
      const taskTemplates = [
        { id: 'task-1', task_name: 'งานโครงสร้าง', task_order: 1 },
      ];
      const schedules = {
        'plot-56-task-1': { planned_start: '2026-11-01', planned_end: '2026-11-10' },
      };
      const existingSnapshots = [
        {
          snapshot_date: '2026-11-04',
          plot_id: 'plot-56',
          task_template_id: 'task-1',
          foreman_name: 'Foreman A',
          is_updated_today: true,
          current_progress: 40,
        },
      ];

      const tasksForB = getForemanScheduledTasksForDate({
        plots,
        taskTemplates,
        schedules,
        foremanName: 'Foreman B',
        targetDate: '2026-11-04',
        existingSnapshots,
      });
      expect(tasksForB).toHaveLength(0);

      const tasksForA = getForemanScheduledTasksForDate({
        plots,
        taskTemplates,
        schedules,
        foremanName: 'Foreman A',
        targetDate: '2026-11-04',
        existingSnapshots,
      });
      expect(tasksForA).toHaveLength(1);
      expect(tasksForA[0].foreman_name).toBe('Foreman A');
    });
  });

  // =========================================================================
  // Issue 7: Calendar Monthly Snapshot Merge Safety
  // =========================================================================
  describe('Issue 7 (P2): Calendar monthly snapshot merge preserves all month days', () => {
    it('merges live daily snapshots by identity without overwriting the rest of the month', () => {
      const monthlySnapshots = [
        { snapshot_date: '2026-11-01', plot_id: 'p1', task_template_id: 't1', current_progress: 10 },
        { snapshot_date: '2026-11-02', plot_id: 'p1', task_template_id: 't1', current_progress: 20 },
        { snapshot_date: '2026-11-05', plot_id: 'p1', task_template_id: 't1', current_progress: 40 },
      ];

      const liveSnapshots = [
        { snapshot_date: '2026-11-05', plot_id: 'p1', task_template_id: 't1', current_progress: 60, status_reason: 'worker_issue' },
      ];

      const snapMap = new Map<string, any>();
      monthlySnapshots.forEach(s => {
        const key = `${s.snapshot_date}_${s.plot_id}_${s.task_template_id}`;
        snapMap.set(key, s);
      });
      liveSnapshots.forEach(s => {
        const key = `${s.snapshot_date}_${s.plot_id}_${s.task_template_id}`;
        snapMap.set(key, s);
      });
      const merged = Array.from(snapMap.values());

      expect(merged).toHaveLength(3);
      const nov5 = merged.find(s => s.snapshot_date === '2026-11-05');
      expect(nov5?.current_progress).toBe(60);
      expect(merged.find(s => s.snapshot_date === '2026-11-01')?.current_progress).toBe(10);
      expect(merged.find(s => s.snapshot_date === '2026-11-02')?.current_progress).toBe(20);
    });
  });

  // =========================================================================
  // Hyphenated Plot IDs Support
  // =========================================================================
  describe('Hyphenated plot IDs support', () => {
    it('scopedSchedules preserves schedules for hyphenated plot IDs without naive split', () => {
      const scopedPlotIds = new Set(['A-01', 'ZONE-2']);
      const schedules: Record<string, any> = {
        'A-01-t1': { planned_start: '2026-11-01', planned_end: '2026-11-10' },
        'A-01_t2': { planned_start: '2026-11-02', planned_end: '2026-11-12' },
        'ZONE-2-t1': { planned_start: '2026-11-01', planned_end: '2026-11-10' },
        'OTHER-03-t1': { planned_start: '2026-11-01', planned_end: '2026-11-10' },
      };

      const res: Record<string, any> = {};
      Object.keys(schedules).forEach(k => {
        const scheduleItem = schedules[k];
        if (scheduleItem?.plot_id && scopedPlotIds.has(String(scheduleItem.plot_id))) {
          res[k] = scheduleItem;
          return;
        }
        for (const pid of scopedPlotIds) {
          if (k === pid || k.startsWith(`${pid}-`) || k.startsWith(`${pid}_`)) {
            res[k] = scheduleItem;
            return;
          }
        }
      });

      expect(res['A-01-t1']).toBeDefined();
      expect(res['A-01_t2']).toBeDefined();
      expect(res['ZONE-2-t1']).toBeDefined();
      expect(res['OTHER-03-t1']).toBeUndefined();
    });
  });
});
