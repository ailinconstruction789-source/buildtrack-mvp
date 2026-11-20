import { describe, it, expect, vi } from 'vitest';
import {
  isQCApprovedAction,
  isQCRejectedAction,
  isMissingColumnOrSchemaError,
  evaluateConstructionTaskStatus,
  getPlotConstructionForemanInfo,
  buildConstructionHandoffPlan,
  executeConstructionForemanHandoff,
} from '../foremanHandoff';

describe('foremanHandoff Helper', () => {
  describe('QC action detection', () => {
    it('detects QC approved actions correctly', () => {
      expect(isQCApprovedAction('อนุมัติงาน 100%')).toBe(true);
      expect(isQCApprovedAction('ผ่านการตรวจสอบ QC')).toBe(true);
      expect(isQCApprovedAction('QC Pass')).toBe(true);
      expect(isQCApprovedAction('approved by inspector')).toBe(true);
      expect(isQCApprovedAction('แจ้งแก้ไขเสา')).toBe(false);
      expect(isQCApprovedAction(null)).toBe(false);
    });

    it('detects QC rejected actions correctly', () => {
      expect(isQCRejectedAction('ไม่อนุมัติงาน')).toBe(true);
      expect(isQCRejectedAction('ไม่ผ่านการตรวจสอบ')).toBe(true);
      expect(isQCRejectedAction('แจ้งแก้ไข')).toBe(true);
      expect(isQCRejectedAction('สั่งแก้งาน')).toBe(true);
      expect(isQCRejectedAction('QC rejected')).toBe(true);
      expect(isQCRejectedAction('อนุมัติ')).toBe(false);
    });
  });

  describe('evaluateConstructionTaskStatus', () => {
    it('marks a 100% task with QC approval as completed', () => {
      const task = { id: 'task-1', task_name: 'งานฐานราก', task_order: 1, require_qc: true };
      const assignment = { task_template_id: 'task-1', current_progress: 100, latest_action: 'ผ่านการตรวจสอบ QC' };
      const updates = [
        { task_template_id: 'task-1', role: 'QC', action: 'อนุมัติงานเรียบร้อย', progress: 100, created_at: '2026-11-19T10:00:00Z' }
      ];

      const res = evaluateConstructionTaskStatus({ task, assignment, updates });
      expect(res.isCompleted).toBe(true);
      expect(res.qcStatus).toBe('passed');
      expect(res.currentProgress).toBe(100);
    });

    it('marks a 100% task that does not require QC as completed', () => {
      const task = { id: 'task-2', task_name: 'งานเก็บกวาด', task_order: 2, require_qc: false };
      const assignment = { task_template_id: 'task-2', current_progress: 100 };

      const res = evaluateConstructionTaskStatus({ task, assignment });
      expect(res.isCompleted).toBe(true);
      expect(res.qcStatus).toBe('na');
    });

    it('does NOT mark a 100% task as completed if QC is still pending', () => {
      const task = { id: 'task-3', task_name: 'งานมุงหลังคา', task_order: 3, require_qc: true };
      const assignment = { task_template_id: 'task-3', current_progress: 100, latest_action: 'ส่งตรวจ QC' };
      const updates = [
        { task_template_id: 'task-3', role: 'Foreman', action: 'ส่งตรวจ QC (100%)', progress: 100, created_at: '2026-11-19T12:00:00Z' }
      ];

      const res = evaluateConstructionTaskStatus({ task, assignment, updates });
      expect(res.isCompleted).toBe(false);
      expect(res.qcStatus).toBe('pending');
    });

    it('does NOT mark a task as completed if QC is rejected', () => {
      const task = { id: 'task-4', task_name: 'งานฉาบปูน', task_order: 4, require_qc: true };
      const assignment = { task_template_id: 'task-4', current_progress: 95, latest_action: 'แจ้งแก้ไข' };
      const updates = [
        { task_template_id: 'task-4', role: 'QC', action: 'สั่งแก้งานผนังไม่เรียบ', progress: 95, created_at: '2026-11-19T14:00:00Z' }
      ];

      const res = evaluateConstructionTaskStatus({ task, assignment, updates });
      expect(res.isCompleted).toBe(false);
      expect(res.qcStatus).toBe('rejected');
    });

    it('recognizes approved QC Inspection from new QC system', () => {
      const task = { id: 'task-5', task_name: 'งานเทคานคอดิน', task_order: 5, require_qc: true };
      const assignment = { task_template_id: 'task-5', current_progress: 100 };
      const qcInspections = [
        { task_template_id: 'task-5', document_status: 'approved', inspection_result: 'passed', created_at: '2026-11-19T15:00:00Z' }
      ];

      const res = evaluateConstructionTaskStatus({ task, assignment, qcInspections });
      expect(res.isCompleted).toBe(true);
      expect(res.qcStatus).toBe('passed');
    });
  });

  describe('getPlotConstructionForemanInfo', () => {
    it('splits tasks into completed and pending groups with accurate counts', () => {
      const plot = {
        id: 'plot-10',
        foreman_name: 'LEAB',
        previous_foreman_name: 'SOMCHAI',
      };
      const tasks = [
        { id: 't1', task_name: 'วางผัง', task_order: 1, require_qc: false },
        { id: 't2', task_name: 'เทฐานราก', task_order: 2, require_qc: true },
        { id: 't3', task_name: 'ตั้งเสา', task_order: 3, require_qc: true },
      ];
      const assignments = [
        { task_template_id: 't1', current_progress: 100 },
        { task_template_id: 't2', current_progress: 100, latest_action: 'อนุมัติผ่าน QC' },
        { task_template_id: 't3', current_progress: 40 },
      ];

      const info = getPlotConstructionForemanInfo({ plot, tasks, assignments });

      expect(info.currentForeman).toBe('LEAB');
      expect(info.previousForeman).toBe('SOMCHAI');
      expect(info.completedCount).toBe(2);
      expect(info.pendingCount).toBe(1);
      expect(info.completedTasks.map(t => t.taskId)).toEqual(['t1', 't2']);
      expect(info.pendingTasks.map(t => t.taskId)).toEqual(['t3']);
    });
  });

  describe('buildConstructionHandoffPlan', () => {
    it('creates takeover plan freezing completed tasks and transferring pending tasks', () => {
      const foremanInfo = {
        plotId: 'plot-10',
        currentForeman: 'LEAB',
        previousForeman: '',
        handoffAt: null,
        handoffReason: null,
        completedTasks: [
          { taskId: 't1', taskName: 'วางผัง', taskOrder: 1, currentProgress: 100, isCompleted: true, qcStatus: 'na' as const, assignedForeman: 'LEAB' },
          { taskId: 't2', taskName: 'เทฐานราก', taskOrder: 2, currentProgress: 100, isCompleted: true, qcStatus: 'passed' as const, assignedForeman: 'LEAB' }
        ],
        pendingTasks: [
          { taskId: 't3', taskName: 'ตั้งเสา', taskOrder: 3, currentProgress: 40, isCompleted: false, qcStatus: 'none' as const, assignedForeman: 'LEAB' },
          { taskId: 't4', taskName: 'คานชั้นสอง', taskOrder: 4, currentProgress: 0, isCompleted: false, qcStatus: 'none' as const, assignedForeman: null }
        ],
        completedCount: 2,
        pendingCount: 2,
      };

      const plan = buildConstructionHandoffPlan({
        mode: 'takeover',
        currentForeman: 'LEAB',
        incomingForeman: 'DEN',
        foremanInfo,
      });

      expect(plan.mode).toBe('takeover');
      expect(plan.freezeCompletedForeman).toBe('LEAB');
      expect(plan.freezeCompletedTaskTemplateIds).toEqual(['t1', 't2']);
      expect(plan.transferTaskTemplateIds).toEqual(['t3', 't4']);
      expect(plan.newPlotForeman).toBe('DEN');
      expect(plan.previousPlotForeman).toBe('LEAB');
    });

    it('creates reassign_all plan transferring all tasks to incoming foreman', () => {
      const foremanInfo = {
        plotId: 'plot-10',
        currentForeman: 'LEAB',
        previousForeman: '',
        handoffAt: null,
        handoffReason: null,
        completedTasks: [
          { taskId: 't1', taskName: 'วางผัง', taskOrder: 1, currentProgress: 100, isCompleted: true, qcStatus: 'na' as const, assignedForeman: 'LEAB' }
        ],
        pendingTasks: [
          { taskId: 't2', taskName: 'ตั้งเสา', taskOrder: 2, currentProgress: 0, isCompleted: false, qcStatus: 'none' as const, assignedForeman: null }
        ],
        completedCount: 1,
        pendingCount: 1,
      };

      const plan = buildConstructionHandoffPlan({
        mode: 'reassign_all',
        currentForeman: 'LEAB',
        incomingForeman: 'DEN',
        foremanInfo,
      });

      expect(plan.mode).toBe('reassign_all');
      expect(plan.freezeCompletedTaskTemplateIds).toEqual([]);
      expect(plan.transferTaskTemplateIds).toEqual(['t1', 't2']);
      expect(plan.newPlotForeman).toBe('DEN');
    });
  });

  describe('executeConstructionForemanHandoff', () => {
    it('executes database updates and records audit log', async () => {
      const mockUpsert = vi.fn().mockResolvedValue({ error: null });
      const mockUpdate = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null })
      });
      const mockInsert = vi.fn().mockResolvedValue({ error: null });

      const mockSupabase = {
        from: vi.fn((table: string) => {
          if (table === 'plot_task_assignments') {
            return { upsert: mockUpsert };
          }
          if (table === 'plots') {
            return { update: mockUpdate };
          }
          if (table === 'plot_foreman_handovers') {
            return { insert: mockInsert };
          }
          return {};
        }),
      };

      const foremanInfo = {
        plotId: 'plot-10',
        currentForeman: 'LEAB',
        previousForeman: '',
        handoffAt: null,
        handoffReason: null,
        completedTasks: [
          { taskId: 't1', taskName: 'วางผัง', taskOrder: 1, currentProgress: 100, isCompleted: true, qcStatus: 'na' as const, assignedForeman: 'LEAB' }
        ],
        pendingTasks: [
          { taskId: 't2', taskName: 'ตั้งเสา', taskOrder: 2, currentProgress: 0, isCompleted: false, qcStatus: 'none' as const, assignedForeman: null }
        ],
        completedCount: 1,
        pendingCount: 1,
      };

      const result = await executeConstructionForemanHandoff(mockSupabase, {
        plotId: 'plot-10',
        incomingForeman: 'DEN',
        currentForeman: 'LEAB',
        mode: 'takeover',
        reason: 'เกลี่ยงานให้เท่ากัน',
        actorName: 'Admin Guy',
        foremanInfo,
      });

      expect(result.success).toBe(true);
      expect(mockUpsert).toHaveBeenCalledTimes(2);
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          foreman_name: 'DEN',
          previous_foreman_name: 'LEAB',
          foreman_handoff_reason: 'เกลี่ยงานให้เท่ากัน',
        })
      );
      expect(mockInsert).toHaveBeenCalledWith([
        expect.objectContaining({
          plot_id: 'plot-10',
          from_foreman: 'LEAB',
          to_foreman: 'DEN',
          reason: 'เกลี่ยงานให้เท่ากัน',
          completed_tasks_count: 1,
          transferred_tasks_count: 1,
        })
      ]);
    });

    it('handles PostgREST schema cache mismatch gracefully by falling back to core foreman_name', async () => {
      const mockUpsert = vi.fn().mockResolvedValue({
        error: { code: 'PGRST204', message: "Could not find the 'foreman_name' column of 'plot_task_assignments' in the schema cache" }
      });
      let updateAttempt = 0;
      const mockUpdate = vi.fn().mockImplementation((payload) => {
        updateAttempt++;
        return {
          eq: vi.fn().mockImplementation(() => {
            if (updateAttempt === 1) {
              // First attempt with extra columns fails with schema cache mismatch
              return Promise.resolve({
                error: { code: 'PGRST204', message: "Could not find the 'previous_foreman_name' column of 'plots' in the schema cache" }
              });
            }
            // Second fallback attempt with only foreman_name succeeds
            return Promise.resolve({ error: null });
          })
        };
      });
      const mockInsert = vi.fn().mockResolvedValue({
        error: { code: 'PGRST205', message: "Could not find the 'plot_foreman_handovers' relation in the schema cache" }
      });

      const mockSupabase = {
        from: vi.fn((table: string) => {
          if (table === 'plot_task_assignments') return { upsert: mockUpsert };
          if (table === 'plots') return { update: mockUpdate };
          if (table === 'plot_foreman_handovers') return { insert: mockInsert };
          return {};
        }),
      };

      const foremanInfo = {
        plotId: 'plot-10',
        currentForeman: 'LEAB',
        previousForeman: '',
        handoffAt: null,
        handoffReason: null,
        completedTasks: [],
        pendingTasks: [
          { taskId: 't1', taskName: 'ตั้งเสา', taskOrder: 1, currentProgress: 0, isCompleted: false, qcStatus: 'none' as const, assignedForeman: null }
        ],
        completedCount: 0,
        pendingCount: 1,
      };

      const result = await executeConstructionForemanHandoff(mockSupabase, {
        plotId: 'plot-10',
        incomingForeman: 'DEN',
        currentForeman: 'LEAB',
        mode: 'takeover',
        reason: 'เกลี่ยงาน',
        actorName: 'Admin',
        foremanInfo,
      });

      expect(result.success).toBe(true);
      expect(mockUpdate).toHaveBeenCalledTimes(2);
      expect(mockUpdate).toHaveBeenLastCalledWith({
        foreman_name: 'DEN',
      });
    });

    it('correctly identifies schema cache error strings and error codes', () => {
      expect(isMissingColumnOrSchemaError({ code: 'PGRST204' })).toBe(true);
      expect(isMissingColumnOrSchemaError({ code: '42703' })).toBe(true);
      expect(isMissingColumnOrSchemaError({ message: "Could not find the 'foreman' column of 'plots' in the schema cache" })).toBe(true);
      expect(isMissingColumnOrSchemaError({ message: "relation 'plot_foreman_handovers' does not exist" })).toBe(true);
      expect(isMissingColumnOrSchemaError({ message: "network timeout" })).toBe(false);
      expect(isMissingColumnOrSchemaError(null)).toBe(false);
    });
  });
});
