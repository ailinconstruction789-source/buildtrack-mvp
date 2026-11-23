// ==============================================================================
// 📋 BUILDTRACK: PHASE 3 QC LEAVE & STAND-IN INSPECTOR ASSIGNMENT SERVICE
// lib/qc/qcLeaveAndStandInService.ts
// ==============================================================================

import { supabase } from '@/lib/supabase';
import {
  canExecuteQCInspection,
  canAssignQCPlans,
  updateMemoryPlanItem,
  type QCPlanItem,
} from './qcInspectionPlanService';

export type LeaveType = 'planned' | 'emergency';
export type LeaveTimeScope = 'full_day' | 'partial_day';
export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';
export type HandoverStatus = 'pending_ack' | 'accepted' | 'rejected' | 'cancelled';

export interface QCLeaveRequest {
  id: string;
  applicant_username: string;
  applicant_role: string;
  leave_type: LeaveType;
  time_scope: LeaveTimeScope;
  start_date: string; // YYYY-MM-DD
  end_date: string; // YYYY-MM-DD
  start_time?: string | null; // HH:mm
  end_time?: string | null; // HH:mm
  reason: string;
  status: LeaveStatus;
  approver_username?: string | null;
  approved_at?: string | null;
  rejection_reason?: string | null;
  cancelled_at?: string | null;
  cancelled_by?: string | null;
  created_at: string;
  updated_at: string;
}

export interface QCStandInHandover {
  id: string;
  plan_item_id: string;
  original_inspector_username: string;
  stand_in_inspector_username: string;
  assigned_by: string;
  approved_by?: string | null;
  handover_reason: string;
  handover_effective_at: string;
  completed_scope?: string | null;
  remaining_scope?: string | null;
  original_due_date: string;
  new_due_date?: string | null;
  status: HandoverStatus;
  acknowledged_at?: string | null;
  created_at: string;
}

export interface CandidateValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  currentPlannedPoints: number;
  postHandoverPoints: number;
  isOverloaded: boolean;
}

// In-memory fallback caches
const memoryLeaveRequests = new Map<string, QCLeaveRequest>();
const memoryHandovers = new Map<string, QCStandInHandover>();

/**
 * 1. Role Permission Guards
 */
export function canApproveQCLeave(role?: string): boolean {
  if (!role) return false;
  const r = role.toLowerCase().trim();
  return (
    r === 'admin' ||
    r === 'project planner' ||
    r === 'owner' ||
    r === 'head qc' ||
    r === 'qc manager'
  );
}

export function canRequestQCLeave(role?: string): boolean {
  if (!role) return false;
  return true; // Any authenticated QC / engineer
}

export function canAssignStandIn(role?: string): boolean {
  return canAssignQCPlans(role);
}

/**
 * 2. Submit Leave Request
 */
export async function submitQCLeaveRequest(
  params: {
    applicantUsername: string;
    applicantRole?: string;
    leaveType: LeaveType;
    timeScope: LeaveTimeScope;
    startDate: string;
    endDate: string;
    startTime?: string;
    endTime?: string;
    reason: string;
  },
  client: any = supabase
): Promise<{ success: boolean; error?: string; request?: QCLeaveRequest }> {
  const {
    applicantUsername,
    applicantRole = 'QC',
    leaveType,
    timeScope,
    startDate,
    endDate,
    startTime,
    endTime,
    reason,
  } = params;

  if (!applicantUsername || !reason.trim()) {
    return { success: false, error: 'กรุณากรอกข้อมูลผู้ขอลาและเหตุผลให้ครบถ้วน' };
  }

  if (startDate > endDate) {
    return { success: false, error: 'วันที่เริ่มต้นต้องไม่มากกว่าวันที่สิ้นสุด' };
  }

  if (timeScope === 'partial_day') {
    if (!startTime || !endTime) {
      return { success: false, error: 'การลาบางช่วงเวลาต้องระบุเวลาเริ่มต้นและสิ้นสุด' };
    }
    if (startTime >= endTime) {
      return { success: false, error: 'เวลาเริ่มต้นต้องน้อยกว่าเวลาสิ้นสุด' };
    }
  }

  const id = `leave_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const now = new Date().toISOString();

  const leaveRecord: QCLeaveRequest = {
    id,
    applicant_username: applicantUsername,
    applicant_role: applicantRole,
    leave_type: leaveType,
    time_scope: timeScope,
    start_date: startDate,
    end_date: endDate,
    start_time: timeScope === 'partial_day' ? startTime : null,
    end_time: timeScope === 'partial_day' ? endTime : null,
    reason: reason.trim(),
    status: 'pending',
    created_at: now,
    updated_at: now,
  };

  memoryLeaveRequests.set(id, leaveRecord);

  try {
    await client.from('qc_leave_requests').insert([leaveRecord]);
  } catch {
    // fallback
  }

  return { success: true, request: leaveRecord };
}

/**
 * 3. Review Leave Request (Approve / Reject)
 * CRITICAL RULE: Self-approval is strictly forbidden (ผู้ใช้ห้ามอนุมัติลาของตนเอง)
 */
export async function reviewQCLeaveRequest(
  params: {
    requestId: string;
    decision: 'approved' | 'rejected';
    actorUsername: string;
    actorRole: string;
    rejectionReason?: string;
    existingPlanItems?: QCPlanItem[];
  },
  client: any = supabase
): Promise<{
  success: boolean;
  error?: string;
  request?: QCLeaveRequest;
  impactedTasksCount?: number;
}> {
  const {
    requestId,
    decision,
    actorUsername,
    actorRole,
    rejectionReason,
    existingPlanItems = [],
  } = params;

  if (!canApproveQCLeave(actorRole)) {
    return { success: false, error: 'คุณไม่มีสิทธิ์อนุมัติหรือปฏิเสธคำขอลา (เฉพาะ Admin, Head QC หรือ ผู้จัดแผน)' };
  }

  const req = memoryLeaveRequests.get(requestId);
  if (!req) {
    return { success: false, error: 'ไม่พบคำขอลาที่ระบุ' };
  }

  if (req.status !== 'pending') {
    return { success: false, error: `คำขอลานี้อยู่ในสถานะ "${req.status}" แล้ว ไม่สามารถอนุมัติซ้ำได้` };
  }

  // Self-approval check
  if (req.applicant_username.toLowerCase() === actorUsername.toLowerCase()) {
    return {
      success: false,
      error: 'ไม่อนุญาตให้อนุมัติคำขอลาของตนเอง (Self-approval is forbidden) กรุณาให้หัวหน้างานหรือผู้มีสิทธิ์ท่านอื่นเป็นผู้อนุมัติ',
    };
  }

  const now = new Date().toISOString();
  const updatedReq: QCLeaveRequest = {
    ...req,
    status: decision,
    approver_username: actorUsername,
    approved_at: decision === 'approved' ? now : null,
    rejection_reason: decision === 'rejected' ? (rejectionReason || 'ไม่อนุมัติ') : null,
    updated_at: now,
  };

  memoryLeaveRequests.set(requestId, updatedReq);

  // If approved, identify active assigned tasks during leave period that require stand-in
  let impactedCount = 0;
  if (decision === 'approved') {
    existingPlanItems.forEach(item => {
      const isAssigned = (item.assigned_inspector_username || '').toLowerCase() === req.applicant_username.toLowerCase();
      const inDateRange = item.due_date >= req.start_date && item.due_date <= req.end_date;
      const isPending = item.plan_status === 'confirmed' && item.execution_status === 'pending';

      if (isAssigned && inDateRange && isPending) {
        // Flag task as needing stand-in
        (item as any).stand_in_required = true;
        impactedCount++;
      }
    });
  }

  try {
    await client
      .from('qc_leave_requests')
      .update({
        status: decision,
        approver_username: actorUsername,
        approved_at: updatedReq.approved_at,
        rejection_reason: updatedReq.rejection_reason,
        updated_at: now,
      })
      .eq('id', requestId);
  } catch {
    // fallback
  }

  return { success: true, request: updatedReq, impactedTasksCount: impactedCount };
}

/**
 * 4. Cancel Leave Request
 * CRITICAL RULE: Cancelling leave does NOT automatically revert existing stand-in assignments.
 * The planner must manually decide how to reallocate tasks.
 */
export async function cancelQCLeaveRequest(
  params: {
    requestId: string;
    actorUsername: string;
    actorRole: string;
  },
  client: any = supabase
): Promise<{ success: boolean; error?: string; request?: QCLeaveRequest }> {
  const { requestId, actorUsername, actorRole } = params;

  const req = memoryLeaveRequests.get(requestId);
  if (!req) {
    return { success: false, error: 'ไม่พบคำขอลาที่ระบุ' };
  }

  const isApplicant = req.applicant_username.toLowerCase() === actorUsername.toLowerCase();
  const isAdminOrPlanner = canApproveQCLeave(actorRole);

  if (!isApplicant && !isAdminOrPlanner) {
    return { success: false, error: 'คุณไม่มีสิทธิ์ยกเลิกคำขอลานี้' };
  }

  const now = new Date().toISOString();
  const updatedReq: QCLeaveRequest = {
    ...req,
    status: 'cancelled',
    cancelled_at: now,
    cancelled_by: actorUsername,
    updated_at: now,
  };

  memoryLeaveRequests.set(requestId, updatedReq);

  try {
    await client
      .from('qc_leave_requests')
      .update({
        status: 'cancelled',
        cancelled_at: now,
        cancelled_by: actorUsername,
        updated_at: now,
      })
      .eq('id', requestId);
  } catch {
    // fallback
  }

  return { success: true, request: updatedReq };
}

/**
 * 5. Check Inspector Active Approved Leave Overlap
 */
export function checkInspectorLeaveOverlap(
  username: string,
  targetDate: string,
  leaves: QCLeaveRequest[] = Array.from(memoryLeaveRequests.values())
): { isOnLeave: boolean; leave?: QCLeaveRequest; capacityFactor: number } {
  if (!username) return { isOnLeave: false, capacityFactor: 1.0 };

  const activeLeaves = leaves.filter(
    l =>
      l.status === 'approved' &&
      l.applicant_username.toLowerCase() === username.toLowerCase() &&
      targetDate >= l.start_date &&
      targetDate <= l.end_date
  );

  if (activeLeaves.length === 0) {
    return { isOnLeave: false, capacityFactor: 1.0 };
  }

  const primaryLeave = activeLeaves[0];
  if (primaryLeave.time_scope === 'full_day') {
    return { isOnLeave: true, leave: primaryLeave, capacityFactor: 0.0 };
  }

  // Partial day leave (e.g. half day) -> 50% capacity factor
  return { isOnLeave: true, leave: primaryLeave, capacityFactor: 0.5 };
}

/**
 * 6. Validate Stand-in Candidate
 * Rules:
 * - Has valid inspection permissions (QC, Admin, Project Engineer, Head QC)
 * - Is not the original inspector
 * - Is not on approved leave on task due date
 * - CRITICAL: Cannot inspect own submission (Self-Inspection Prevention: candidate !== se_submitted_by)
 * - Returns current planned points + post handover points to monitor overloading
 */
export function validateStandInCandidate(params: {
  candidateUsername: string;
  candidateRole: string;
  planItem: QCPlanItem;
  existingItems?: QCPlanItem[];
  leaves?: QCLeaveRequest[];
  dailyPointCapacityThreshold?: number;
}): CandidateValidationResult {
  const {
    candidateUsername,
    candidateRole,
    planItem,
    existingItems = [],
    leaves = Array.from(memoryLeaveRequests.values()),
    dailyPointCapacityThreshold = 12,
  } = params;

  const errors: string[] = [];
  const warnings: string[] = [];

  const cUser = candidateUsername.trim().toLowerCase();
  const origUser = (planItem.assigned_inspector_username || '').trim().toLowerCase();
  const seUser = (planItem.se_submitted_by || '').trim().toLowerCase();

  // 1. Role permission check
  if (!canExecuteQCInspection(candidateRole)) {
    errors.push(`ผู้ใช้ ${candidateUsername} ไม่มีบทบาทหรือสิทธิ์ในการตรวจงาน QC (ตำแหน่ง: ${candidateRole})`);
  }

  // 2. Cannot be the same inspector
  if (cUser === origUser) {
    errors.push(`ไม่สามารถมอบหมายงานตรวจแทนให้ผู้ตรวจเดิม (${planItem.assigned_inspector_username}) ได้`);
  }

  // 3. Self-Inspection Prevention: Cannot inspect task that candidate submitted as Site Engineer
  if (cUser === seUser && seUser !== '') {
    errors.push(
      `ขัดแย้งกับหลักการตรวจสอบ (Conflict of Interest): ผู้ตรวจแทน (${candidateUsername}) เป็น Site Engineer ผู้ส่งตรวจงานนี้เอง ไม่อนุญาตให้ตรวจรับงานที่ตนเองส่ง`
    );
  }

  // 4. Leave overlap check
  const leaveCheck = checkInspectorLeaveOverlap(candidateUsername, planItem.due_date, leaves);
  if (leaveCheck.isOnLeave) {
    if (leaveCheck.capacityFactor === 0) {
      errors.push(`ผู้ตรวจแทน (${candidateUsername}) มีประวัติลาเต็มวันในวันที่ ${planItem.due_date} (เหตุผล: ${leaveCheck.leave?.reason})`);
    } else {
      warnings.push(`ผู้ตรวจแทน (${candidateUsername}) มีการลาบางช่วงเวลาในวันที่ ${planItem.due_date} กรุณาตรวจสอบเวลาตรวจ`);
    }
  }

  // 5. Workload calculation
  let currentPlannedPoints = 0;
  existingItems.forEach(it => {
    const isAssignedToCandidate = (it.assigned_inspector_username || '').toLowerCase() === cUser;
    const isSameDate = it.due_date === planItem.due_date;
    const isActive = it.plan_status === 'confirmed' && it.execution_status === 'pending';
    if (isAssignedToCandidate && isSameDate && isActive) {
      currentPlannedPoints += it.snapshot_weight_score || 0;
    }
  });

  const addedWeight = planItem.snapshot_weight_score || 0;
  const postHandoverPoints = currentPlannedPoints + addedWeight;
  const isOverloaded = postHandoverPoints > dailyPointCapacityThreshold;

  if (isOverloaded) {
    warnings.push(
      `ภาระงานของผู้ตรวจแทน (${candidateUsername}) จะเพิ่มเป็น ${postHandoverPoints} แต้ม (เกินเกณฑ์แนะนำประจำวัน ${dailyPointCapacityThreshold} แต้ม)`
    );
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    currentPlannedPoints,
    postHandoverPoints,
    isOverloaded,
  };
}

/**
 * 7. Reassign Task to Stand-in Inspector
 * Ensures:
 * - Handover audit trail is logged
 * - No duplicate active assignment
 * - Original due date, original inspector and delay flags are preserved
 * - Credit for prior completed work remains with original inspector
 */
export async function reassignTaskToStandIn(
  params: {
    planItem: QCPlanItem;
    standInUsername: string;
    standInRole: string;
    actorUsername: string;
    actorRole: string;
    handoverReason: string;
    completedScope?: string;
    remainingScope?: string;
    newDueDate?: string;
    existingItems?: QCPlanItem[];
    leaves?: QCLeaveRequest[];
  },
  client: any = supabase
): Promise<{
  success: boolean;
  error?: string;
  handover?: QCStandInHandover;
  updatedItem?: QCPlanItem;
}> {
  const {
    planItem,
    standInUsername,
    standInRole,
    actorUsername,
    actorRole,
    handoverReason,
    completedScope,
    remainingScope,
    newDueDate,
    existingItems = [],
    leaves,
  } = params;

  if (!canAssignStandIn(actorRole)) {
    return { success: false, error: 'ไม่มีสิทธิ์มอบหมายผู้ตรวจแทน (เฉพาะ Admin, Project Planner หรือ หัวหน้างาน)' };
  }

  if (!handoverReason.trim()) {
    return { success: false, error: 'กรุณาระบุเหตุผลในการมอบหมายผู้ตรวจแทน' };
  }

  // Validate candidate
  const validation = validateStandInCandidate({
    candidateUsername: standInUsername,
    candidateRole: standInRole,
    planItem,
    existingItems,
    leaves,
  });

  if (!validation.isValid) {
    return { success: false, error: validation.errors.join(' | ') };
  }

  const handoverId = `handover_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const now = new Date().toISOString();
  const origInspector = planItem.assigned_inspector_username || 'Unassigned';

  const handoverRecord: QCStandInHandover = {
    id: handoverId,
    plan_item_id: planItem.id,
    original_inspector_username: origInspector,
    stand_in_inspector_username: standInUsername,
    assigned_by: actorUsername,
    handover_reason: handoverReason.trim(),
    handover_effective_at: now,
    completed_scope: completedScope || null,
    remaining_scope: remainingScope || null,
    original_due_date: planItem.due_date,
    new_due_date: newDueDate || null,
    status: 'accepted',
    created_at: now,
  };

  memoryHandovers.set(handoverId, handoverRecord);

  // Update plan item
  const updatedItem: QCPlanItem = {
    ...planItem,
    assigned_inspector_username: standInUsername,
    due_date: newDueDate || planItem.due_date,
    // Audit extensions
    ...( {
      is_stand_in: true,
      original_inspector_username: origInspector,
      stand_in_handover_id: handoverId,
      stand_in_required: false,
      handover_effective_at: now,
    } as any),
  };

  updateMemoryPlanItem(updatedItem);

  try {
    await client.from('qc_stand_in_handovers').insert([handoverRecord]);
    await client
      .from('qc_daily_plan_items')
      .update({
        assigned_inspector_username: standInUsername,
        due_date: updatedItem.due_date,
        is_stand_in: true,
        original_inspector_username: origInspector,
        stand_in_handover_id: handoverId,
        stand_in_required: false,
        handover_effective_at: now,
      })
      .eq('id', planItem.id);
  } catch {
    // fallback
  }

  return { success: true, handover: handoverRecord, updatedItem };
}

/**
 * 8. Query Leave Requests
 */
export async function getQCLeaveRequests(
  filter?: { applicantUsername?: string; status?: LeaveStatus },
  client: any = supabase
): Promise<QCLeaveRequest[]> {
  try {
    let query = client.from('qc_leave_requests').select('*');
    if (filter?.applicantUsername) {
      query = query.eq('applicant_username', filter.applicantUsername);
    }
    if (filter?.status) {
      query = query.eq('status', filter.status);
    }
    const { data, error } = await query;
    if (!error && Array.isArray(data)) {
      return data;
    }
  } catch {
    // fallback
  }

  let list = Array.from(memoryLeaveRequests.values());
  if (filter?.applicantUsername) {
    list = list.filter(l => l.applicant_username.toLowerCase() === filter.applicantUsername!.toLowerCase());
  }
  if (filter?.status) {
    list = list.filter(l => l.status === filter.status);
  }
  return list;
}

/**
 * 9. Reset memory caches (for unit tests)
 */
export function resetQCLeaveMemoryCache(): void {
  memoryLeaveRequests.clear();
  memoryHandovers.clear();
}
