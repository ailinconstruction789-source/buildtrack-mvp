import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  generateDraftPlanItems,
  confirmQCPlan,
  recordPlanItemExecution,
  deferPlanItem,
  getMyQCInspectionPlan,
  resetQCPlanMemoryCache,
  type QCPlanItem,
  type QCTaskWeight,
} from '@/lib/qc/qcInspectionPlanService';
import {
  submitQCLeaveRequest,
  reviewQCLeaveRequest,
  validateStandInCandidate,
  reassignTaskToStandIn,
  resetQCLeaveMemoryCache,
  type QCLeaveRequest,
} from '@/lib/qc/qcLeaveAndStandInService';
import {
  buildQCMonthlyAuditCalendar,
  getQCMetricFormulaDetails,
} from '@/lib/qc/qcAuditAnalyticsService';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: [], error: null }),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      }),
      insert: vi.fn().mockResolvedValue({ data: null, error: null }),
      upsert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }),
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: null, error: null }),
      }),
    })),
  },
}));

describe('QC End-to-End Workflow Verification (Phase 4)', () => {
  beforeEach(() => {
    resetQCPlanMemoryCache();
    resetQCLeaveMemoryCache();
  });

  it('Scenario 1: SE submits -> Planner confirms plan -> QC inspects and passes -> Full credit awarded', async () => {
    const queue = [
      {
        id: 'q1',
        plot_id: 'Plot-01',
        plot_name: 'แปลง 01',
        project_name: 'The Valley Ville',
        task_template_id: 'tpl_paint',
        task_name: 'งานทาสีรองพื้น',
        round_number: 1,
        statusFor: 'QC',
        created_at: '2026-11-20T08:00:00Z', // Before 17:00
        user_name: 'se_wichai',
      },
    ];

    const weightsMap = new Map<string, QCTaskWeight>([
      ['tpl_paint', { task_template_id: 'tpl_paint', weight_score: 2, is_hold_point: false }],
    ]);

    // 1. Generate Draft
    const drafts = generateDraftPlanItems({
      inspectionQueue: queue,
      weightsMap,
      planDate: '2026-11-21',
    });
    expect(drafts.length).toBe(1);
    expect(drafts[0].snapshot_weight_score).toBe(2);

    // 2. Confirm Plan
    const confirmRes = await confirmQCPlan({
      planDate: '2026-11-21',
      projectName: 'The Valley Ville',
      inspectorUsername: 'qc_somchai',
      items: drafts,
      actorUsername: 'planner_jane',
      actorRole: 'Project Planner',
    });
    expect(confirmRes.success).toBe(true);
    expect(confirmRes.plan?.totalPlannedPoints).toBe(2);

    // 3. QC inspects and passes
    const execRes = await recordPlanItemExecution({
      planItemId: drafts[0].id,
      executionStatus: 'passed',
      actualInspectorUsername: 'qc_somchai',
      actualInspectorRole: 'QC',
    });
    expect(execRes.success).toBe(true);
    expect(execRes.item?.earned_points).toBe(2);
    expect(execRes.item?.actual_inspector_username).toBe('qc_somchai');

    // 4. Verify Plan rollup
    const myPlan = await getMyQCInspectionPlan({
      targetDate: '2026-11-21',
      inspectorUsername: 'qc_somchai',
    });
    expect(myPlan.totalPlannedPoints).toBe(2);
    expect(myPlan.totalCompletedPoints).toBe(2);
    expect(myPlan.totalCompletedTasks).toBe(1);
  });

  it('Scenario 2: SE submits -> QC fails (rejects) -> QC receives full effort credit -> Re-inspection cycle', async () => {
    const queue = [
      {
        id: 'q_fail',
        plot_id: 'Plot-02',
        plot_name: 'แปลง 02',
        project_name: 'The Valley Ville',
        task_template_id: 'tpl_plaster',
        task_name: 'งานฉาบปูนภายใน',
        round_number: 1,
        statusFor: 'QC',
        created_at: '2026-11-20T08:00:00Z',
        user_name: 'se_wichai',
      },
    ];

    const weightsMap = new Map<string, QCTaskWeight>([
      ['tpl_plaster', { task_template_id: 'tpl_plaster', weight_score: 3, is_hold_point: false }],
    ]);

    const drafts = generateDraftPlanItems({
      inspectionQueue: queue,
      weightsMap,
      planDate: '2026-11-21',
    });

    await confirmQCPlan({
      planDate: '2026-11-21',
      projectName: 'The Valley Ville',
      inspectorUsername: 'qc_somchai',
      items: drafts,
      actorUsername: 'planner_jane',
      actorRole: 'Project Planner',
    });

    // QC inspects thoroughly and rejects due to uneven plaster
    const failRes = await recordPlanItemExecution({
      planItemId: drafts[0].id,
      executionStatus: 'failed',
      actualInspectorUsername: 'qc_somchai',
      actualInspectorRole: 'QC',
      failureReason: 'ผิวผนังเป็นคลื่นเกินเกณฑ์มาตรฐาน 3 มม.',
    });

    expect(failRes.success).toBe(true);
    // Fair KPI rule: QC gets full credit for executing the inspection
    expect(failRes.item?.earned_points).toBe(3);
    expect(failRes.item?.execution_status).toBe('failed');
    expect(failRes.item?.failure_reason).toContain('ผิวผนังเป็นคลื่น');
  });

  it('Scenario 3: Site unready / blocked -> Cannot Inspect -> 0 points awarded with reason', async () => {
    const queue = [
      {
        id: 'q_blocked',
        plot_id: 'Plot-03',
        plot_name: 'แปลง 03',
        project_name: 'The Valley Ville',
        task_template_id: 'tpl_door',
        task_name: 'งานติดตั้งบานประตู',
        round_number: 1,
        statusFor: 'QC',
        created_at: '2026-11-20T08:00:00Z',
        user_name: 'se_wichai',
      },
    ];

    const weightsMap = new Map<string, QCTaskWeight>([
      ['tpl_door', { task_template_id: 'tpl_door', weight_score: 2, is_hold_point: false }],
    ]);

    const drafts = generateDraftPlanItems({
      inspectionQueue: queue,
      weightsMap,
      planDate: '2026-11-21',
    });

    await confirmQCPlan({
      planDate: '2026-11-21',
      projectName: 'The Valley Ville',
      inspectorUsername: 'qc_somchai',
      items: drafts,
      actorUsername: 'planner_jane',
      actorRole: 'Project Planner',
    });

    // Inspector arrives but site is locked
    const blockedRes = await recordPlanItemExecution({
      planItemId: drafts[0].id,
      executionStatus: 'cannot_inspect',
      actualInspectorUsername: 'qc_somchai',
      actualInspectorRole: 'QC',
      failureReason: 'ผู้รับเหมาล็อกกุญแจห้อง ไม่สามารถเข้าตรวจได้',
    });

    expect(blockedRes.success).toBe(true);
    expect(blockedRes.item?.earned_points).toBe(0);
    expect(blockedRes.item?.execution_status).toBe('cannot_inspect');
  });

  it('Scenario 4: Urgent task injected -> Original task deferred -> 12 / 8 / 4 tracking maintained', async () => {
    const items: any[] = [
      {
        id: 'item_normal_1',
        plot_id: 'P01',
        project_name: 'Project Alpha',
        task_template_id: 't1',
        task_name: 'งานตรวจ 1',
        round_number: 1,
        snapshot_weight_score: 4,
        due_date: '2026-11-21',
        original_plan_date: '2026-11-21',
        assigned_inspector_username: 'qc_somchai',
        plan_status: 'confirmed',
        execution_status: 'pending',
        earned_points: 0,
      },
      {
        id: 'item_normal_2',
        plot_id: 'P02',
        project_name: 'Project Alpha',
        task_template_id: 't2',
        task_name: 'งานตรวจ 2',
        round_number: 1,
        snapshot_weight_score: 4,
        due_date: '2026-11-21',
        original_plan_date: '2026-11-21',
        assigned_inspector_username: 'qc_somchai',
        plan_status: 'confirmed',
        execution_status: 'pending',
        earned_points: 0,
      },
      {
        id: 'item_to_defer',
        plot_id: 'P03',
        project_name: 'Project Alpha',
        task_template_id: 't3',
        task_name: 'งานที่ต้องเลื่อนตรวจ',
        round_number: 1,
        snapshot_weight_score: 4,
        due_date: '2026-11-21',
        original_plan_date: '2026-11-21',
        assigned_inspector_username: 'qc_somchai',
        plan_status: 'confirmed',
        execution_status: 'pending',
        earned_points: 0,
      },
    ];

    // Total planned: 12 points
    await confirmQCPlan({
      planDate: '2026-11-21',
      projectName: 'Project Alpha',
      inspectorUsername: 'qc_somchai',
      items,
      actorUsername: 'planner_jane',
      actorRole: 'Project Planner',
    });

    // Inspect first 2 items (8 points)
    await recordPlanItemExecution({
      planItemId: 'item_normal_1',
      executionStatus: 'passed',
      actualInspectorUsername: 'qc_somchai',
      actualInspectorRole: 'QC',
    });
    await recordPlanItemExecution({
      planItemId: 'item_normal_2',
      executionStatus: 'passed',
      actualInspectorUsername: 'qc_somchai',
      actualInspectorRole: 'QC',
    });

    // Defer 3rd item (4 points) to Monday 2026-11-23
    await deferPlanItem({
      planItemId: 'item_to_defer',
      deferToDate: '2026-11-23',
      deferralReason: 'เลื่อนเพื่อหลีกทางให้งานเทคอนกรีตฐานรากเร่งด่วน',
      actorUsername: 'planner_jane',
      actorRole: 'Project Planner',
    });

    // Check Original Day: 12 Planned / 8 Completed / 4 Deferred
    const originalPlan = await getMyQCInspectionPlan({
      targetDate: '2026-11-21',
      inspectorUsername: 'qc_somchai',
    });

    expect(originalPlan.totalPlannedPoints).toBe(12);
    expect(originalPlan.totalCompletedPoints).toBe(8);
    expect(originalPlan.totalDeferredPoints).toBe(4);
  });

  it('Scenario 5: QC on Leave -> Stand-in assigned -> Inspected -> Stand-in receives credit', async () => {
    // 1. QC Somchai requests full-day leave
    const leaveRes = await submitQCLeaveRequest({
      applicantUsername: 'qc_somchai',
      applicantRole: 'QC',
      leaveType: 'planned',
      timeScope: 'full_day',
      startDate: '2026-11-25',
      endDate: '2026-11-25',
      reason: 'ลาพักร้อนประจำปี',
    });

    // 2. Head QC approves leave
    await reviewQCLeaveRequest({
      requestId: leaveRes.request!.id,
      decision: 'approved',
      actorUsername: 'head_qc_narong',
      actorRole: 'Head QC',
    });

    // 3. Task scheduled for Somchai on leave date
    const task: QCPlanItem = {
      id: 'task_leave_standin',
      plot_id: 'P05',
      plot_name: 'แปลง 05',
      project_name: 'The Valley',
      task_template_id: 't_mep',
      task_name: 'งานท่อร้อยสายไฟ',
      round_number: 1,
      snapshot_weight_score: 3,
      snapshot_is_hold_point: false,
      se_submitted_at: '2026-11-24T08:00:00Z',
      se_submitted_by: 'se_somsak',
      is_late_handoff: false,
      due_date: '2026-11-25',
      assigned_inspector_username: 'qc_somchai',
      plan_status: 'confirmed',
      execution_status: 'pending',
      earned_points: 0,
      original_plan_date: '2026-11-25',
    };

    // 4. Planner assigns Stand-in QC Pranee
    const handoverRes = await reassignTaskToStandIn({
      planItem: task,
      standInUsername: 'qc_pranee',
      standInRole: 'QC',
      actorUsername: 'planner_jane',
      actorRole: 'Project Planner',
      handoverReason: 'QC สมชาย ลาพักร้อน มอบหมายให้คุณปราณีตรวจแทน',
    });

    expect(handoverRes.success).toBe(true);
    expect(handoverRes.updatedItem?.assigned_inspector_username).toBe('qc_pranee');

    // 5. Stand-in inspects and passes
    const execRes = await recordPlanItemExecution({
      planItemId: task.id,
      executionStatus: 'passed',
      actualInspectorUsername: 'qc_pranee',
      actualInspectorRole: 'QC',
    });

    expect(execRes.success).toBe(true);
    expect(execRes.item?.actual_inspector_username).toBe('qc_pranee');
    expect(execRes.item?.earned_points).toBe(3);
  });

  it('Scenario 6: Conflict of Interest Prevention: Submitting SE cannot inspect own task as stand-in', () => {
    const task: QCPlanItem = {
      id: 'task_conflict',
      plot_id: 'P09',
      plot_name: 'แปลง 09',
      project_name: 'The Valley',
      task_template_id: 't_roof',
      task_name: 'งานโครงหลังคา',
      round_number: 1,
      snapshot_weight_score: 4,
      snapshot_is_hold_point: true,
      se_submitted_at: '2026-11-24T08:00:00Z',
      se_submitted_by: 'se_wichai', // Wichai submitted this task!
      is_late_handoff: false,
      due_date: '2026-11-25',
      assigned_inspector_username: 'qc_somchai',
      plan_status: 'confirmed',
      execution_status: 'pending',
      earned_points: 0,
      original_plan_date: '2026-11-25',
    };

    // Attempt to assign Wichai as stand-in QC
    const validation = validateStandInCandidate({
      candidateUsername: 'se_wichai',
      candidateRole: 'QC',
      planItem: task,
    });

    expect(validation.isValid).toBe(false);
    expect(validation.errors[0]).toContain('ขัดแย้งกับหลักการตรวจสอบ (Conflict of Interest)');
    expect(validation.errors[0]).toContain('เป็น Site Engineer ผู้ส่งตรวจงานนี้เอง');
  });

  it('Scenario 7: Monthly Audit Calendar Rollup & Transparent Formulas', () => {
    const planItems: QCPlanItem[] = [
      {
        id: 'it_1',
        plot_id: 'P01',
        plot_name: 'แปลง 01',
        project_name: 'The Valley',
        task_template_id: 't1',
        task_name: 'งานเสา',
        round_number: 1,
        snapshot_weight_score: 5,
        snapshot_is_hold_point: true,
        se_submitted_at: '2026-11-09T08:00:00Z',
        is_late_handoff: false,
        due_date: '2026-11-10',
        assigned_inspector_username: 'qc_somchai',
        plan_status: 'confirmed',
        execution_status: 'passed',
        earned_points: 5,
        original_plan_date: '2026-11-10',
      },
      {
        id: 'it_2',
        plot_id: 'P02',
        plot_name: 'แปลง 02',
        project_name: 'The Valley',
        task_template_id: 't2',
        task_name: 'งานผนัง',
        round_number: 1,
        snapshot_weight_score: 3,
        snapshot_is_hold_point: false,
        se_submitted_at: '2026-11-09T18:00:00Z', // Late handoff
        is_late_handoff: true,
        due_date: '2026-11-10',
        assigned_inspector_username: 'qc_somchai',
        plan_status: 'deferred',
        execution_status: 'pending',
        earned_points: 0,
        original_plan_date: '2026-11-10',
      },
    ];

    const monthly = buildQCMonthlyAuditCalendar({
      year: 2026,
      month: 11,
      planItems,
    });

    expect(monthly.totalBaselinePlannedPoints).toBe(8); // 5 + 3
    expect(monthly.totalCompletedPoints).toBe(5);
    expect(monthly.totalDeferredPoints).toBe(3);
    expect(monthly.clearanceRatePct).toBe(63); // (5 / 8) * 100
    expect(monthly.holdPointTotal).toBe(1);
    expect(monthly.holdPointOnTimePct).toBe(100);
    expect(monthly.lateHandoffTotal).toBe(1);

    // Verify formula metadata
    const formula = getQCMetricFormulaDetails('clearance_rate');
    expect(formula.formulaDescription).toContain('แต้มที่ตรวจเสร็จจริง ÷ แต้มแผนงานตั้งต้น');
    expect(formula.fairnessNote).toContain('งานตรวจไม่ผ่าน (Failed) ได้คะแนนเต็มเท่ากับงานผ่าน');
  });

  it('Scenario 8: Admin Demo Project is strictly excluded from KPI', () => {
    const planItems: QCPlanItem[] = [
      {
        id: 'demo_1',
        plot_id: 'DEMO-01',
        plot_name: 'แปลงเดโม',
        project_name: 'Admin Demo Project', // DEMO!
        task_template_id: 't_demo',
        task_name: 'งานเดโม',
        round_number: 1,
        snapshot_weight_score: 5,
        snapshot_is_hold_point: true,
        se_submitted_at: '2026-11-10T08:00:00Z',
        is_late_handoff: false,
        due_date: '2026-11-10',
        assigned_inspector_username: 'qc_somchai',
        plan_status: 'confirmed',
        execution_status: 'passed',
        earned_points: 5,
        original_plan_date: '2026-11-10',
      },
      {
        id: 'real_1',
        plot_id: 'P01',
        plot_name: 'แปลง 01',
        project_name: 'Real Project',
        task_template_id: 't1',
        task_name: 'งานจริง',
        round_number: 1,
        snapshot_weight_score: 4,
        snapshot_is_hold_point: false,
        se_submitted_at: '2026-11-10T08:00:00Z',
        is_late_handoff: false,
        due_date: '2026-11-10',
        assigned_inspector_username: 'qc_somchai',
        plan_status: 'confirmed',
        execution_status: 'passed',
        earned_points: 4,
        original_plan_date: '2026-11-10',
      },
    ];

    const monthly = buildQCMonthlyAuditCalendar({
      year: 2026,
      month: 11,
      planItems,
    });

    // Only the real project (4 points) should be counted!
    expect(monthly.totalBaselinePlannedPoints).toBe(4);
    expect(monthly.totalCompletedPoints).toBe(4);
  });
});
