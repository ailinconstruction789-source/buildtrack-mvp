import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  canManageQCWeights,
  canAssignQCPlans,
  canExecuteQCInspection,
  isSunday,
  getNextWorkingDay,
  calculateTargetInspectionDate,
  getQCTaskWeights,
  saveQCTaskWeight,
  generateDraftPlanItems,
  confirmQCPlan,
  recordPlanItemExecution,
  deferPlanItem,
  getMyQCInspectionPlan,
  getMonthlyQCPlanItems,
  resetQCPlanMemoryCache,
  type QCTaskWeight,
} from '@/lib/qc/qcInspectionPlanService';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: { message: 'Table pending migration' } }),
      }),
      upsert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: { message: 'Table pending migration' } }),
        }),
      }),
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: null, error: null }),
      }),
    })),
  },
}));

describe('QC Inspection Plan Service (Phase 1)', () => {
  beforeEach(() => {
    resetQCPlanMemoryCache();
  });

  describe('1. Role Authorization Guards', () => {
    it('canManageQCWeights only allows Admin, Project Planner, Owner, Head QC, QC Manager', () => {
      expect(canManageQCWeights('admin')).toBe(true);
      expect(canManageQCWeights('Admin')).toBe(true);
      expect(canManageQCWeights('Project Planner')).toBe(true);
      expect(canManageQCWeights('Owner')).toBe(true);
      expect(canManageQCWeights('Head QC')).toBe(true);
      expect(canManageQCWeights('QC Manager')).toBe(true);

      // Disallowed roles
      expect(canManageQCWeights('Foreman')).toBe(false);
      expect(canManageQCWeights('QC')).toBe(false);
      expect(canManageQCWeights('Site Engineer')).toBe(false);
      expect(canManageQCWeights(undefined)).toBe(false);
    });

    it('canAssignQCPlans allows Admin, Planner, Site Engineer, Project Engineer, Head QC', () => {
      expect(canAssignQCPlans('Admin')).toBe(true);
      expect(canAssignQCPlans('Project Planner')).toBe(true);
      expect(canAssignQCPlans('Site Engineer')).toBe(true);
      expect(canAssignQCPlans('Project Engineer')).toBe(true);

      // Disallowed
      expect(canAssignQCPlans('Foreman')).toBe(false);
      expect(canAssignQCPlans('QC')).toBe(false);
    });

    it('canExecuteQCInspection allows QC, Admin, Owner, Project Engineer, Head QC', () => {
      expect(canExecuteQCInspection('QC')).toBe(true);
      expect(canExecuteQCInspection('Admin')).toBe(true);
      expect(canExecuteQCInspection('Owner')).toBe(true);

      // Disallowed
      expect(canExecuteQCInspection('Foreman')).toBe(false);
      expect(canExecuteQCInspection('Site Engineer')).toBe(false);
    });
  });

  describe('2. Working Day & Cut-off Scheduling', () => {
    it('detects Sunday correctly', () => {
      // 2026-11-22 is Sunday
      expect(isSunday('2026-11-22')).toBe(true);
      // 2026-11-21 is Saturday
      expect(isSunday('2026-11-21')).toBe(false);
      // 2026-11-23 is Monday
      expect(isSunday('2026-11-23')).toBe(false);
    });

    it('getNextWorkingDay skips Sunday', () => {
      // Saturday 2026-11-21 + 1 working day -> Monday 2026-11-23
      expect(getNextWorkingDay('2026-11-21', 1)).toBe('2026-11-23');
      // Friday 2026-11-20 + 1 working day -> Saturday 2026-11-21
      expect(getNextWorkingDay('2026-11-20', 1)).toBe('2026-11-21');
      // Friday 2026-11-20 + 2 working days -> Monday 2026-11-23
      expect(getNextWorkingDay('2026-11-20', 2)).toBe('2026-11-23');
    });

    it('calculates target inspection date before 17:00 cut-off (next working day)', () => {
      // 2026-11-20 09:00:00 UTC = 16:00 Bangkok (before 17:00)
      const res = calculateTargetInspectionDate('2026-11-20T09:00:00Z', { todayDateStr: '2026-11-20' });
      expect(res.isLateHandoff).toBe(false);
      expect(res.scheduledDate).toBe('2026-11-21'); // Saturday
    });

    it('calculates target inspection date after 17:00 cut-off (2 working days, skips Sunday)', () => {
      // 2026-11-20 11:30:00 UTC = 18:30 Bangkok (after 17:00)
      const res = calculateTargetInspectionDate('2026-11-20T11:30:00Z', { todayDateStr: '2026-11-20' });
      expect(res.isLateHandoff).toBe(true);
      // Friday + 2 working days (Sat, Mon) -> 2026-11-23
      expect(res.scheduledDate).toBe('2026-11-23');
    });
  });

  describe('3. QC Task Weight Management', () => {
    it('validates weight score between 1 and 5 integer', async () => {
      const invalidLow = await saveQCTaskWeight({
        taskTemplateId: 'tpl_1',
        weightScore: 0,
        actorUsername: 'admin_user',
        actorRole: 'Admin',
      });
      expect(invalidLow.success).toBe(false);
      expect(invalidLow.error).toContain('1 ถึง 5 แต้ม');

      const invalidHigh = await saveQCTaskWeight({
        taskTemplateId: 'tpl_1',
        weightScore: 6,
        actorUsername: 'admin_user',
        actorRole: 'Admin',
      });
      expect(invalidHigh.success).toBe(false);

      const invalidFloat = await saveQCTaskWeight({
        taskTemplateId: 'tpl_1',
        weightScore: 2.5,
        actorUsername: 'admin_user',
        actorRole: 'Admin',
      });
      expect(invalidFloat.success).toBe(false);
    });

    it('rejects unauthorized role from saving weights', async () => {
      const res = await saveQCTaskWeight({
        taskTemplateId: 'tpl_1',
        weightScore: 3,
        actorUsername: 'foreman_bob',
        actorRole: 'Foreman',
      });
      expect(res.success).toBe(false);
      expect(res.error).toContain('ไม่มีสิทธิ์');
    });

    it('saves task weight with scope description and independent hold point flag', async () => {
      const res = await saveQCTaskWeight({
        taskTemplateId: 'tpl_concr',
        weightScore: 4,
        scopeDescription: 'ตรวจสอบแนวเทคอนกรีตฐานราก 6 จุด',
        isHoldPoint: true,
        actorUsername: 'admin_user',
        actorRole: 'Admin',
      });

      expect(res.success).toBe(true);
      expect(res.weight?.weight_score).toBe(4);
      expect(res.weight?.scope_description).toBe('ตรวจสอบแนวเทคอนกรีตฐานราก 6 จุด');
      expect(res.weight?.is_hold_point).toBe(true);

      const weights = await getQCTaskWeights();
      expect(weights.get('tpl_concr')?.weight_score).toBe(4);
      expect(weights.get('tpl_concr')?.is_hold_point).toBe(true);
    });
  });

  describe('4. Draft Generation & Duplicate Prevention', () => {
    it('excludes Admin Demo Project items completely', () => {
      const queue = [
        {
          id: 'q1',
          plot_id: 'P01',
          plot_name: 'แปลง 01',
          project_name: 'Admin Demo Project',
          task_template_id: 't1',
          task_name: 'งานเดโม',
          statusFor: 'QC',
          created_at: '2026-11-20T08:00:00Z',
        },
        {
          id: 'q2',
          plot_id: 'P02',
          plot_name: 'แปลง 02',
          project_name: 'The Valley Ville',
          task_template_id: 't2',
          task_name: 'เทคอนกรีตคานคอดิน',
          statusFor: 'QC',
          created_at: '2026-11-20T08:00:00Z',
        },
      ];

      const weights = new Map<string, QCTaskWeight>([
        ['t2', { task_template_id: 't2', weight_score: 4, is_hold_point: true }],
      ]);

      const drafts = generateDraftPlanItems({
        inspectionQueue: queue,
        weightsMap: weights,
        planDate: '2026-11-21',
      });

      expect(drafts.length).toBe(1);
      expect(drafts[0].plot_id).toBe('P02');
      expect(drafts[0].project_name).toBe('The Valley Ville');
    });

    it('sets unconfigured task weights to null ("ไม่พร้อมคำนวณ")', () => {
      const queue = [
        {
          id: 'q1',
          plot_id: 'P01',
          plot_name: 'แปลง 01',
          project_name: 'โครงการจริง',
          task_template_id: 'unknown_tpl',
          task_name: 'งานแปลกใหม่',
          statusFor: 'QC',
          created_at: '2026-11-20T08:00:00Z',
        },
      ];

      const drafts = generateDraftPlanItems({
        inspectionQueue: queue,
        weightsMap: new Map(), // empty weights
        planDate: '2026-11-21',
      });

      expect(drafts.length).toBe(1);
      expect(drafts[0].snapshot_weight_score).toBeNull();
    });

    it('prevents duplicate active assignment for same plot_id, task_template_id, and round_number', () => {
      const queue = [
        {
          id: 'q1',
          plot_id: 'P10',
          plot_name: 'แปลง 10',
          project_name: 'Grand Ville',
          task_template_id: 'tpl_paint',
          task_name: 'ทาสีรองพื้น',
          round_number: 1,
          statusFor: 'QC',
          created_at: '2026-11-20T08:00:00Z',
        },
      ];

      const weights = new Map<string, QCTaskWeight>([
        ['tpl_paint', { task_template_id: 'tpl_paint', weight_score: 2, is_hold_point: false }],
      ]);

      // Existing already confirmed item
      const existingItems: any[] = [
        {
          id: 'existing_1',
          plot_id: 'P10',
          task_template_id: 'tpl_paint',
          round_number: 1,
          plan_status: 'confirmed',
        },
      ];

      const drafts = generateDraftPlanItems({
        inspectionQueue: queue,
        weightsMap: weights,
        planDate: '2026-11-21',
        existingItems,
      });

      expect(drafts.length).toBe(0); // Blocked duplicate
    });

    it('prioritizes Hold Point items first in queue ordering', () => {
      const queue = [
        {
          id: 'q1',
          plot_id: 'P01',
          project_name: 'Project A',
          task_template_id: 't_minor',
          task_name: 'งานเก็บกวาด',
          statusFor: 'QC',
          created_at: '2026-11-20T07:00:00Z',
        },
        {
          id: 'q2',
          plot_id: 'P02',
          project_name: 'Project A',
          task_template_id: 't_hold',
          task_name: 'งานเทเสาโครงสร้าง',
          statusFor: 'QC',
          created_at: '2026-11-20T09:00:00Z',
        },
      ];

      const weights = new Map<string, QCTaskWeight>([
        ['t_minor', { task_template_id: 't_minor', weight_score: 1, is_hold_point: false }],
        ['t_hold', { task_template_id: 't_hold', weight_score: 4, is_hold_point: true }],
      ]);

      const drafts = generateDraftPlanItems({
        inspectionQueue: queue,
        weightsMap: weights,
        planDate: '2026-11-21',
      });

      expect(drafts[0].task_name).toBe('งานเทเสาโครงสร้าง');
      expect(drafts[0].snapshot_is_hold_point).toBe(true);
      expect(drafts[1].task_name).toBe('งานเก็บกวาด');
    });
  });

  describe('5. Plan Confirmation & Immutable Weight Snapshots', () => {
    it('confirms plan, snapshots weights, and locks plan items', async () => {
      const draftItems: any[] = [
        {
          id: 'item_1',
          plot_id: 'P01',
          plot_name: 'แปลง 01',
          project_name: 'The Valley',
          task_template_id: 't_struc',
          task_name: 'วางเหล็กคาน',
          round_number: 1,
          snapshot_weight_score: 4,
          snapshot_scope_description: 'ตรวจทาบเหล็ก 8 จุด',
          snapshot_is_hold_point: true,
          se_submitted_at: '2026-11-20T10:00:00Z',
          is_late_handoff: false,
          due_date: '2026-11-21',
          plan_status: 'draft',
          execution_status: 'pending',
          earned_points: 0,
        },
        {
          id: 'item_2',
          plot_id: 'P02',
          plot_name: 'แปลง 02',
          project_name: 'The Valley',
          task_template_id: 't_paint',
          task_name: 'ทาสีภายใน',
          round_number: 1,
          snapshot_weight_score: 2,
          snapshot_scope_description: 'ตรวจเรียบเนียนชั้น 1',
          snapshot_is_hold_point: false,
          se_submitted_at: '2026-11-20T10:00:00Z',
          is_late_handoff: false,
          due_date: '2026-11-21',
          plan_status: 'draft',
          execution_status: 'pending',
          earned_points: 0,
        },
      ];

      const res = await confirmQCPlan({
        planDate: '2026-11-21',
        projectName: 'The Valley',
        inspectorUsername: 'qc_somchai',
        items: draftItems,
        actorUsername: 'planner_jane',
        actorRole: 'Project Planner',
      });

      expect(res.success).toBe(true);
      expect(res.plan?.totalPlannedTasks).toBe(2);
      expect(res.plan?.totalPlannedPoints).toBe(6); // 4 + 2
      expect(res.plan?.status).toBe('confirmed');

      // Crucial test: modifying the template weight later DOES NOT affect confirmed snapshot!
      await saveQCTaskWeight({
        taskTemplateId: 't_struc',
        weightScore: 5, // changed from 4 to 5 in master template
        actorUsername: 'admin_user',
        actorRole: 'Admin',
      });

      // The confirmed item's snapshot must remain 4
      const myPlan = await getMyQCInspectionPlan({
        targetDate: '2026-11-21',
        inspectorUsername: 'qc_somchai',
      });

      const confirmedItem1 = myPlan.items.find(i => i.task_template_id === 't_struc');
      expect(confirmedItem1?.snapshot_weight_score).toBe(4); // Not mutated!
      expect(myPlan.totalPlannedPoints).toBe(6);
    });
  });

  describe('6. Execution Outcomes & Scoring Rules', () => {
    beforeEach(async () => {
      // Setup confirmed plan with 3 tasks
      const items: any[] = [
        {
          id: 'item_pass',
          plot_id: 'P01',
          plot_name: 'แปลง 01',
          project_name: 'The Valley',
          task_template_id: 't1',
          task_name: 'งานเสา',
          round_number: 1,
          snapshot_weight_score: 4,
          snapshot_is_hold_point: true,
          se_submitted_at: '2026-11-20T10:00:00Z',
          due_date: '2026-11-21',
          original_plan_date: '2026-11-21',
          assigned_inspector_username: 'qc_somchai',
          plan_status: 'confirmed',
          execution_status: 'pending',
          earned_points: 0,
        },
        {
          id: 'item_fail',
          plot_id: 'P02',
          plot_name: 'แปลง 02',
          project_name: 'The Valley',
          task_template_id: 't2',
          task_name: 'งานผนัง',
          round_number: 1,
          snapshot_weight_score: 2,
          snapshot_is_hold_point: false,
          se_submitted_at: '2026-11-20T10:00:00Z',
          due_date: '2026-11-21',
          original_plan_date: '2026-11-21',
          assigned_inspector_username: 'qc_somchai',
          plan_status: 'confirmed',
          execution_status: 'pending',
          earned_points: 0,
        },
        {
          id: 'item_blocked',
          plot_id: 'P03',
          plot_name: 'แปลง 03',
          project_name: 'The Valley',
          task_template_id: 't3',
          task_name: 'งานประตู',
          round_number: 1,
          snapshot_weight_score: 2,
          snapshot_is_hold_point: false,
          se_submitted_at: '2026-11-20T10:00:00Z',
          due_date: '2026-11-21',
          original_plan_date: '2026-11-21',
          assigned_inspector_username: 'qc_somchai',
          plan_status: 'confirmed',
          execution_status: 'pending',
          earned_points: 0,
        },
      ];

      await confirmQCPlan({
        planDate: '2026-11-21',
        projectName: 'The Valley',
        inspectorUsername: 'qc_somchai',
        items,
        actorUsername: 'planner_jane',
        actorRole: 'Project Planner',
      });
    });

    it('gives full credit for passed inspection', async () => {
      const res = await recordPlanItemExecution({
        planItemId: 'item_pass',
        executionStatus: 'passed',
        actualInspectorUsername: 'qc_somchai',
        actualInspectorRole: 'QC',
      });

      expect(res.success).toBe(true);
      expect(res.item?.execution_status).toBe('passed');
      expect(res.item?.earned_points).toBe(4);
      expect(res.item?.actual_inspector_username).toBe('qc_somchai');
    });

    it('gives full credit for failed/reject inspection because QC did the inspection', async () => {
      const res = await recordPlanItemExecution({
        planItemId: 'item_fail',
        executionStatus: 'failed',
        actualInspectorUsername: 'qc_somchai',
        actualInspectorRole: 'QC',
        failureReason: 'ปูนฉาบมีรอยแตกลายงาเกินเกณฑ์',
      });

      expect(res.success).toBe(true);
      expect(res.item?.execution_status).toBe('failed');
      expect(res.item?.earned_points).toBe(2); // Full credit for doing the work
      expect(res.item?.failure_reason).toBe('ปูนฉาบมีรอยแตกลายงาเกินเกณฑ์');
    });

    it('gives 0 credit for cannot_inspect (e.g. blocked site)', async () => {
      const res = await recordPlanItemExecution({
        planItemId: 'item_blocked',
        executionStatus: 'cannot_inspect',
        actualInspectorUsername: 'qc_somchai',
        actualInspectorRole: 'QC',
        failureReason: 'หน้างานล็อกกุญแจ ไม่สามารถเข้าตรวจได้',
      });

      expect(res.success).toBe(true);
      expect(res.item?.execution_status).toBe('cannot_inspect');
      expect(res.item?.earned_points).toBe(0);
    });

    it('prevents double-scoring replay', async () => {
      // First pass
      await recordPlanItemExecution({
        planItemId: 'item_pass',
        executionStatus: 'passed',
        actualInspectorUsername: 'qc_somchai',
        actualInspectorRole: 'QC',
      });

      // Attempt second execution
      const replay = await recordPlanItemExecution({
        planItemId: 'item_pass',
        executionStatus: 'passed',
        actualInspectorUsername: 'qc_somchai',
        actualInspectorRole: 'QC',
      });

      expect(replay.success).toBe(true);
      expect(replay.item?.earned_points).toBe(4); // Remains 4, not 8
    });
  });

  describe('7. Deferral & 12 / 8 / 4 Historical Tracking', () => {
    it('preserves deferred item on original plan date with reason and spawns new target date item', async () => {
      const items: any[] = [
        {
          id: 'item_done_1',
          plot_id: 'P01',
          project_name: 'Project A',
          task_template_id: 't1',
          task_name: 'งานเสร็จ 1',
          round_number: 1,
          snapshot_weight_score: 4,
          snapshot_is_hold_point: false,
          se_submitted_at: '2026-11-20T10:00:00Z',
          due_date: '2026-11-21',
          original_plan_date: '2026-11-21',
          assigned_inspector_username: 'qc_somchai',
          plan_status: 'confirmed',
          execution_status: 'pending',
          earned_points: 0,
        },
        {
          id: 'item_done_2',
          plot_id: 'P02',
          project_name: 'Project A',
          task_template_id: 't2',
          task_name: 'งานเสร็จ 2',
          round_number: 1,
          snapshot_weight_score: 4,
          snapshot_is_hold_point: false,
          se_submitted_at: '2026-11-20T10:00:00Z',
          due_date: '2026-11-21',
          original_plan_date: '2026-11-21',
          assigned_inspector_username: 'qc_somchai',
          plan_status: 'confirmed',
          execution_status: 'pending',
          earned_points: 0,
        },
        {
          id: 'item_defer',
          plot_id: 'P03',
          project_name: 'Project A',
          task_template_id: 't3',
          task_name: 'งานเลื่อนตรวจ',
          round_number: 1,
          snapshot_weight_score: 4,
          snapshot_is_hold_point: false,
          se_submitted_at: '2026-11-20T10:00:00Z',
          due_date: '2026-11-21',
          original_plan_date: '2026-11-21',
          assigned_inspector_username: 'qc_somchai',
          plan_status: 'confirmed',
          execution_status: 'pending',
          earned_points: 0,
        },
      ];

      // Total planned: 4 + 4 + 4 = 12 points
      await confirmQCPlan({
        planDate: '2026-11-21',
        projectName: 'Project A',
        inspectorUsername: 'qc_somchai',
        items,
        actorUsername: 'planner_jane',
        actorRole: 'Project Planner',
      });

      // Complete 2 items (8 points)
      await recordPlanItemExecution({
        planItemId: 'item_done_1',
        executionStatus: 'passed',
        actualInspectorUsername: 'qc_somchai',
        actualInspectorRole: 'QC',
      });
      await recordPlanItemExecution({
        planItemId: 'item_done_2',
        executionStatus: 'passed',
        actualInspectorUsername: 'qc_somchai',
        actualInspectorRole: 'QC',
      });

      // Defer the 3rd item (4 points) to Monday 2026-11-23
      const deferRes = await deferPlanItem({
        planItemId: 'item_defer',
        deferToDate: '2026-11-23',
        deferralReason: 'ฝนตกหนักน้ำท่วมบริเวณรอบแปลง ไม่สามารถเข้าถึงตัวบ้านได้',
        actorUsername: 'planner_jane',
        actorRole: 'Project Planner',
      });

      expect(deferRes.success).toBe(true);
      expect(deferRes.deferredItem?.plan_status).toBe('deferred');
      expect(deferRes.deferredItem?.deferred_to_date).toBe('2026-11-23');

      // Now query plan for original date 2026-11-21:
      // Must reflect 12 / 8 / 4 ratio (Planned 12, Completed 8, Deferred 4)
      const originalDayPlan = await getMyQCInspectionPlan({
        targetDate: '2026-11-21',
        inspectorUsername: 'qc_somchai',
      });

      expect(originalDayPlan.totalPlannedPoints).toBe(12); // Planned 12 retains deferred item weight
      expect(originalDayPlan.totalCompletedPoints).toBe(8); // Completed 8 points
      expect(originalDayPlan.totalDeferredPoints).toBe(4); // Deferred 4 points
      expect(originalDayPlan.totalCompletedTasks).toBe(2);
      expect(originalDayPlan.totalDeferredTasks).toBe(1);

      // And query target deferred date 2026-11-23:
      const mondayPlan = await getMyQCInspectionPlan({
        targetDate: '2026-11-23',
        inspectorUsername: 'qc_somchai',
      });

      expect(mondayPlan.items.some(i => i.id === 'item_defer_deferred_2026-11-23')).toBe(true);
    });
  });

  describe('8. Monthly QC Plan Items Query & Live Queue Harmonization', () => {
    it('harmonizes live inspection queue and historical updates into monthly calendar items', async () => {
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth() + 1;
      const todayStr = now.toISOString().split('T')[0];

      const inspectionQueue = [
        {
          id: 'live_q_1',
          plot_id: '101',
          house_number: '12/34',
          project_name: 'The Valley',
          task_template_id: 'tmpl_1',
          task_name: 'งานโครงสร้างเสาชั้น 1',
          foreman: 'qc_john',
          user_name: 'se_somchai',
          created_at: `${todayStr}T08:30:00Z`,
        },
      ];

      const allUpdatesRecord = [
        {
          id: 'hist_update_1',
          plot_id: '102',
          project_name: 'The Valley',
          task_template_id: 'tmpl_2',
          task_name: 'งานเทคานคอดิน',
          user_name: 'qc_john',
          status: 'QC_PASSED',
          created_at: `${year}-${String(month).padStart(2, '0')}-05T14:00:00Z`,
        },
      ];

      const weightsMap = new Map<string, QCTaskWeight>([
        ['tmpl_1', { task_template_id: 'tmpl_1', weight_score: 5, is_hold_point: true }],
        ['tmpl_2', { task_template_id: 'tmpl_2', weight_score: 4, is_hold_point: true }],
      ]);

      const items = await getMonthlyQCPlanItems({
        year,
        month,
        inspectionQueue,
        allUpdatesRecord,
        weightsMap,
      });

      // Live queue item should appear on today's date
      const liveItem = items.find(i => i.id === 'live_q_1');
      expect(liveItem).toBeDefined();
      expect(liveItem?.due_date).toBe(todayStr);
      expect(liveItem?.snapshot_weight_score).toBe(5);
      expect(liveItem?.snapshot_is_hold_point).toBe(true);

      // Historical completed inspection should appear on past date
      const histItem = items.find(i => i.id.startsWith('hist_hist_update_1'));
      expect(histItem).toBeDefined();
      expect(histItem?.due_date).toBe(`${year}-${String(month).padStart(2, '0')}-05`);
      expect(histItem?.execution_status).toBe('passed');
      expect(histItem?.earned_points).toBe(4);
    });
  });
});
