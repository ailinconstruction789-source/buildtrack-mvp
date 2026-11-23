import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  canApproveQCLeave,
  submitQCLeaveRequest,
  reviewQCLeaveRequest,
  cancelQCLeaveRequest,
  checkInspectorLeaveOverlap,
  validateStandInCandidate,
  reassignTaskToStandIn,
  resetQCLeaveMemoryCache,
  type QCLeaveRequest,
} from '@/lib/qc/qcLeaveAndStandInService';
import type { QCPlanItem } from '@/lib/qc/qcInspectionPlanService';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: [], error: null }),
      }),
      insert: vi.fn().mockResolvedValue({ data: null, error: null }),
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: null, error: null }),
      }),
    })),
  },
}));

describe('QC Leave & Stand-in Inspector Service (Phase 3)', () => {
  beforeEach(() => {
    resetQCLeaveMemoryCache();
  });

  describe('1. Role Authorization & Leave Submission', () => {
    it('only allows Admin, Planner, Owner, Head QC to approve leave', () => {
      expect(canApproveQCLeave('Admin')).toBe(true);
      expect(canApproveQCLeave('Project Planner')).toBe(true);
      expect(canApproveQCLeave('Head QC')).toBe(true);
      expect(canApproveQCLeave('Owner')).toBe(true);

      // Disallowed
      expect(canApproveQCLeave('QC')).toBe(false);
      expect(canApproveQCLeave('Site Engineer')).toBe(false);
      expect(canApproveQCLeave('Foreman')).toBe(false);
    });

    it('submits planned full-day leave request successfully', async () => {
      const res = await submitQCLeaveRequest({
        applicantUsername: 'qc_somchai',
        applicantRole: 'QC',
        leaveType: 'planned',
        timeScope: 'full_day',
        startDate: '2026-11-25',
        endDate: '2026-11-26',
        reason: 'ลากิจส่วนตัวไปทำธุระต่างจังหวัด',
      });

      expect(res.success).toBe(true);
      expect(res.request?.status).toBe('pending');
      expect(res.request?.applicant_username).toBe('qc_somchai');
    });

    it('validates partial day start/end time', async () => {
      const invalid = await submitQCLeaveRequest({
        applicantUsername: 'qc_somchai',
        leaveType: 'emergency',
        timeScope: 'partial_day',
        startDate: '2026-11-25',
        endDate: '2026-11-25',
        startTime: '14:00',
        endTime: '10:00', // invalid order
        reason: 'พบแพทย์ช่วงเช้า',
      });

      expect(invalid.success).toBe(false);
      expect(invalid.error).toContain('เวลาเริ่มต้นต้องน้อยกว่าเวลาสิ้นสุด');
    });
  });

  describe('2. Self-Approval Prevention (ผู้ใช้ห้ามอนุมัติลาของตนเอง)', () => {
    it('strictly forbids a user from approving their own leave request', async () => {
      const submitRes = await submitQCLeaveRequest({
        applicantUsername: 'qc_somchai',
        applicantRole: 'QC',
        leaveType: 'planned',
        timeScope: 'full_day',
        startDate: '2026-11-25',
        endDate: '2026-11-25',
        reason: 'ลากิจ',
      });

      const requestId = submitRes.request!.id;

      // Attempt self-approval by same username
      const selfApproval = await reviewQCLeaveRequest({
        requestId,
        decision: 'approved',
        actorUsername: 'qc_somchai', // SAME USER
        actorRole: 'Admin', // Even with Admin role!
      });

      expect(selfApproval.success).toBe(false);
      expect(selfApproval.error).toContain('ไม่อนุญาตให้อนุมัติคำขอลาของตนเอง');
    });

    it('allows a different authorized manager to approve leave', async () => {
      const submitRes = await submitQCLeaveRequest({
        applicantUsername: 'qc_somchai',
        applicantRole: 'QC',
        leaveType: 'planned',
        timeScope: 'full_day',
        startDate: '2026-11-25',
        endDate: '2026-11-25',
        reason: 'ลากิจ',
      });

      const requestId = submitRes.request!.id;

      // Approved by Head QC (different user)
      const approval = await reviewQCLeaveRequest({
        requestId,
        decision: 'approved',
        actorUsername: 'head_qc_narong',
        actorRole: 'Head QC',
      });

      expect(approval.success).toBe(true);
      expect(approval.request?.status).toBe('approved');
      expect(approval.request?.approver_username).toBe('head_qc_narong');
    });
  });

  describe('3. Impact on Capacity & Active Assignments', () => {
    it('calculates full-day capacity as 0% and partial day capacity as 50%', () => {
      const leaves: QCLeaveRequest[] = [
        {
          id: 'l1',
          applicant_username: 'qc_full',
          applicant_role: 'QC',
          leave_type: 'planned',
          time_scope: 'full_day',
          start_date: '2026-11-25',
          end_date: '2026-11-25',
          status: 'approved',
          reason: 'พักผ่อน',
          created_at: '',
          updated_at: '',
        },
        {
          id: 'l2',
          applicant_username: 'qc_half',
          applicant_role: 'QC',
          leave_type: 'emergency',
          time_scope: 'partial_day',
          start_date: '2026-11-25',
          end_date: '2026-11-25',
          start_time: '08:00',
          end_time: '12:00',
          status: 'approved',
          reason: 'ธุระด่วน',
          created_at: '',
          updated_at: '',
        },
      ];

      const fullCheck = checkInspectorLeaveOverlap('qc_full', '2026-11-25', leaves);
      expect(fullCheck.isOnLeave).toBe(true);
      expect(fullCheck.capacityFactor).toBe(0.0);

      const halfCheck = checkInspectorLeaveOverlap('qc_half', '2026-11-25', leaves);
      expect(halfCheck.isOnLeave).toBe(true);
      expect(halfCheck.capacityFactor).toBe(0.5);

      const regularCheck = checkInspectorLeaveOverlap('qc_regular', '2026-11-25', leaves);
      expect(regularCheck.isOnLeave).toBe(false);
      expect(regularCheck.capacityFactor).toBe(1.0);
    });

    it('flags impacted active assignments as stand-in required when leave is approved', async () => {
      const submitRes = await submitQCLeaveRequest({
        applicantUsername: 'qc_somchai',
        leaveType: 'planned',
        timeScope: 'full_day',
        startDate: '2026-11-25',
        endDate: '2026-11-26',
        reason: 'ลากิจ',
      });

      const existingItems: any[] = [
        {
          id: 'item_1',
          due_date: '2026-11-25',
          assigned_inspector_username: 'qc_somchai',
          plan_status: 'confirmed',
          execution_status: 'pending',
        },
        {
          id: 'item_2',
          due_date: '2026-11-27', // Outside leave dates
          assigned_inspector_username: 'qc_somchai',
          plan_status: 'confirmed',
          execution_status: 'pending',
        },
      ];

      const reviewRes = await reviewQCLeaveRequest({
        requestId: submitRes.request!.id,
        decision: 'approved',
        actorUsername: 'head_qc_narong',
        actorRole: 'Head QC',
        existingPlanItems: existingItems,
      });

      expect(reviewRes.success).toBe(true);
      expect(reviewRes.impactedTasksCount).toBe(1);
      expect(existingItems[0].stand_in_required).toBe(true);
      expect(existingItems[1].stand_in_required).toBeUndefined();
    });

    it('cancelling leave does NOT automatically revert existing handovers', async () => {
      const submitRes = await submitQCLeaveRequest({
        applicantUsername: 'qc_somchai',
        leaveType: 'planned',
        timeScope: 'full_day',
        startDate: '2026-11-25',
        endDate: '2026-11-25',
        reason: 'ลากิจ',
      });

      await reviewQCLeaveRequest({
        requestId: submitRes.request!.id,
        decision: 'approved',
        actorUsername: 'head_qc_narong',
        actorRole: 'Head QC',
      });

      const cancelRes = await cancelQCLeaveRequest({
        requestId: submitRes.request!.id,
        actorUsername: 'qc_somchai',
        actorRole: 'QC',
      });

      expect(cancelRes.success).toBe(true);
      expect(cancelRes.request?.status).toBe('cancelled');
    });
  });

  describe('4. Stand-in Candidate Validation & Conflict Prevention', () => {
    const mockTask: QCPlanItem = {
      id: 'task_concrete_01',
      plot_id: 'P01',
      plot_name: 'แปลง 01',
      project_name: 'The Valley',
      task_template_id: 't_conc',
      task_name: 'เทคอนกรีตเสา',
      round_number: 1,
      snapshot_weight_score: 4,
      snapshot_is_hold_point: true,
      se_submitted_at: '2026-11-20T10:00:00Z',
      se_submitted_by: 'se_wichai', // Submitted by Site Engineer Wichai!
      is_late_handoff: false,
      due_date: '2026-11-25',
      assigned_inspector_username: 'qc_somchai',
      plan_status: 'confirmed',
      execution_status: 'pending',
      earned_points: 0,
      original_plan_date: '2026-11-25',
    };

    it('blocks self-inspection: candidate who is the submitting SE cannot inspect own task', () => {
      const validation = validateStandInCandidate({
        candidateUsername: 'se_wichai', // SAME AS se_submitted_by!
        candidateRole: 'QC', // Even if candidate also has QC role
        planItem: mockTask,
      });

      expect(validation.isValid).toBe(false);
      expect(validation.errors[0]).toContain('ขัดแย้งกับหลักการตรวจสอบ (Conflict of Interest)');
      expect(validation.errors[0]).toContain('เป็น Site Engineer ผู้ส่งตรวจงานนี้เอง');
    });

    it('rejects candidate who has approved leave on task due date', () => {
      const leaves: any[] = [
        {
          applicant_username: 'qc_standin_busy',
          status: 'approved',
          time_scope: 'full_day',
          start_date: '2026-11-25',
          end_date: '2026-11-25',
          reason: 'ไปต่างจังหวัด',
        },
      ];

      const validation = validateStandInCandidate({
        candidateUsername: 'qc_standin_busy',
        candidateRole: 'QC',
        planItem: mockTask,
        leaves,
      });

      expect(validation.isValid).toBe(false);
      expect(validation.errors[0]).toContain('มีประวัติลาเต็มวัน');
    });

    it('rejects candidate without inspection execution permissions (e.g. Foreman)', () => {
      const validation = validateStandInCandidate({
        candidateUsername: 'foreman_tom',
        candidateRole: 'Foreman', // No QC role
        planItem: mockTask,
      });

      expect(validation.isValid).toBe(false);
      expect(validation.errors[0]).toContain('ไม่มีบทบาทหรือสิทธิ์ในการตรวจงาน QC');
    });

    it('warns when stand-in candidate is overloaded with points', () => {
      const existingItems: any[] = [
        {
          id: 'existing_item_1',
          assigned_inspector_username: 'qc_pranee',
          due_date: '2026-11-25',
          plan_status: 'confirmed',
          execution_status: 'pending',
          snapshot_weight_score: 10, // already 10 points
        },
      ];

      const validation = validateStandInCandidate({
        candidateUsername: 'qc_pranee',
        candidateRole: 'QC',
        planItem: mockTask, // +4 points -> 14 points total
        existingItems,
        dailyPointCapacityThreshold: 12,
      });

      expect(validation.isValid).toBe(true);
      expect(validation.isOverloaded).toBe(true);
      expect(validation.warnings[0]).toContain('ภาระงานของผู้ตรวจแทน (qc_pranee) จะเพิ่มเป็น 14 แต้ม');
    });
  });

  describe('5. Handover Reassignment & Audit Trail', () => {
    it('executes handover, updates assigned inspector, and preserves original inspector and due date', async () => {
      const task: QCPlanItem = {
        id: 'task_handover_1',
        plot_id: 'P02',
        plot_name: 'แปลง 02',
        project_name: 'The Valley',
        task_template_id: 't_beam',
        task_name: 'ผูกเหล็กคาน',
        round_number: 1,
        snapshot_weight_score: 3,
        snapshot_is_hold_point: false,
        se_submitted_at: '2026-11-20T10:00:00Z',
        se_submitted_by: 'se_damrong',
        is_late_handoff: false,
        due_date: '2026-11-25',
        assigned_inspector_username: 'qc_somchai',
        plan_status: 'confirmed',
        execution_status: 'pending',
        earned_points: 0,
        original_plan_date: '2026-11-25',
      };

      const res = await reassignTaskToStandIn({
        planItem: task,
        standInUsername: 'qc_pranee',
        standInRole: 'QC',
        actorUsername: 'planner_jane',
        actorRole: 'Project Planner',
        handoverReason: 'QC สมชาย ลากิจไปงานครอบครัว มอบหมายให้คุณปราณีตรวจแทน',
        completedScope: 'ตรวจเหล็กคานแกนล่างแล้ว 50%',
        remainingScope: 'ตรวจเหล็กปลอกและระยะหุ้มคอนกรีต 50%',
      });

      expect(res.success).toBe(true);
      expect(res.handover?.stand_in_inspector_username).toBe('qc_pranee');
      expect(res.handover?.original_inspector_username).toBe('qc_somchai');
      expect(res.handover?.handover_reason).toContain('QC สมชาย ลากิจ');

      // Updated plan item check
      expect(res.updatedItem?.assigned_inspector_username).toBe('qc_pranee');
      expect((res.updatedItem as any).original_inspector_username).toBe('qc_somchai');
      expect((res.updatedItem as any).is_stand_in).toBe(true);
      expect((res.updatedItem as any).stand_in_required).toBe(false);
    });
  });
});
