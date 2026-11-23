// ==============================================================================
// 📋 BUILDTRACK: QC INSPECTION PLAN & WEIGHTED SCORING SERVICE
// lib/qc/qcInspectionPlanService.ts
// ==============================================================================

import { supabase } from '@/lib/supabase';
import { normalizeDateStr } from '@/lib/foremanDuty';

export interface QCTaskWeight {
  id?: string;
  task_template_id: string;
  weight_score: number; // 1 to 5
  scope_description?: string;
  is_hold_point: boolean;
  created_by?: string;
  updated_at?: string;
}

export type PlanStatus = 'draft' | 'confirmed' | 'deferred';
export type ExecutionStatus = 'pending' | 'passed' | 'failed' | 'cannot_inspect' | 'partial';

export interface QCPlanItem {
  id: string;
  plan_id?: string;
  plot_id: string;
  plot_name: string;
  project_name: string;
  task_template_id: string;
  task_name: string;
  round_number: number;

  // Immutable Snapshot on plan confirmation
  snapshot_weight_score: number | null; // null if unconfigured
  snapshot_scope_description?: string | null;
  snapshot_is_hold_point: boolean;

  // SE Handoff tracking
  se_submitted_at: string;
  se_submitted_by?: string;
  is_late_handoff: boolean;
  due_date: string; // YYYY-MM-DD

  // Assignment & Status
  assigned_inspector_username?: string | null;
  plan_status: PlanStatus;

  // Execution & Scoring
  execution_status: ExecutionStatus;
  actual_inspector_username?: string | null;
  actual_inspected_at?: string | null;
  earned_points: number;
  failure_reason?: string | null;

  // Deferral & Original Plan Tracking
  original_plan_date: string; // YYYY-MM-DD
  deferred_to_date?: string | null;
  deferral_reason?: string | null;

  created_at?: string;
}

export interface QCDailyPlanSummary {
  planDate: string;
  inspectorUsername?: string | null;
  projectName?: string;
  status: 'draft' | 'confirmed' | 'completed';
  totalPlannedTasks: number;
  totalPlannedPoints: number;
  totalCompletedTasks: number;
  totalCompletedPoints: number;
  totalDeferredTasks: number;
  totalDeferredPoints: number;
  overdueTasksCount: number;
  items: QCPlanItem[];
  overdueItems: QCPlanItem[];
  version: number;
}

// In-memory fallback cache for local dev / tests when Supabase tables are pending migration
const memoryTaskWeights = new Map<string, QCTaskWeight>();
const memoryDailyPlans = new Map<string, any>();
const memoryPlanItems = new Map<string, QCPlanItem>();

/**
 * 1. Role Permission Guards
 */
export function canManageQCWeights(role?: string): boolean {
  if (!role) return false;
  const r = role.toLowerCase().trim();
  return r === 'admin' || r === 'project planner' || r === 'owner' || r === 'head qc' || r === 'qc manager';
}

export function canAssignQCPlans(role?: string): boolean {
  if (!role) return false;
  const r = role.toLowerCase().trim();
  return (
    r === 'admin' ||
    r === 'project planner' ||
    r === 'site engineer' ||
    r === 'owner' ||
    r === 'head qc' ||
    r === 'project engineer'
  );
}

export function canExecuteQCInspection(role?: string): boolean {
  if (!role) return false;
  const r = role.toLowerCase().trim();
  return r === 'qc' || r === 'admin' || r === 'owner' || r === 'project engineer' || r === 'head qc';
}

/**
 * 2. Working Day & Cut-off Rules
 * Standard working week: Monday - Saturday (Sunday is off)
 * Default Cut-off Hour: 17:00 (Asia/Bangkok)
 */
export function isSunday(dateInput: string | Date): boolean {
  const d = typeof dateInput === 'string' ? new Date(`${dateInput}T12:00:00Z`) : dateInput;
  return d.getUTCDay() === 0;
}

export function getNextWorkingDay(dateStr: string, daysToAdd: number = 1): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  let added = 0;
  while (added < daysToAdd) {
    d.setUTCDate(d.getUTCDate() + 1);
    // If not Sunday, count as working day
    if (d.getUTCDay() !== 0) {
      added++;
    }
  }
  return d.toISOString().split('T')[0];
}

export function calculateTargetInspectionDate(
  seSubmittedAt: string,
  options?: { cutOffHour?: number; todayDateStr?: string }
): { scheduledDate: string; isLateHandoff: boolean } {
  const cutOffHour = options?.cutOffHour ?? 17;
  const subDate = new Date(seSubmittedAt);
  const nowBkk = options?.todayDateStr || normalizeDateStr(seSubmittedAt) || new Date().toISOString().split('T')[0];

  // Convert submission hour to Asia/Bangkok (+07:00)
  const utcHours = subDate.getUTCHours();
  const bkkHour = (utcHours + 7) % 24;
  const bkkMinutes = subDate.getUTCMinutes();

  const isLateHandoff = bkkHour > cutOffHour || (bkkHour === cutOffHour && bkkMinutes > 0);

  // Normal: next working day (+1 working day)
  // Late handoff: +2 working days
  const daysAhead = isLateHandoff ? 2 : 1;
  const scheduledDate = getNextWorkingDay(nowBkk, daysAhead);

  return { scheduledDate, isLateHandoff };
}

/**
 * 3. QC Task Weight Management
 */
export async function getQCTaskWeights(client: any = supabase): Promise<Map<string, QCTaskWeight>> {
  try {
    const { data, error } = await client.from('qc_task_weights').select('*');
    if (!error && Array.isArray(data)) {
      const map = new Map<string, QCTaskWeight>();
      data.forEach((row: any) => {
        map.set(String(row.task_template_id), {
          id: row.id,
          task_template_id: String(row.task_template_id),
          weight_score: Number(row.weight_score),
          scope_description: row.scope_description || '',
          is_hold_point: Boolean(row.is_hold_point),
          created_by: row.created_by,
          updated_at: row.updated_at,
        });
      });
      return map;
    }
  } catch {
    // fallback to memory
  }
  return new Map(memoryTaskWeights);
}

export async function saveQCTaskWeight(
  params: {
    taskTemplateId: string;
    weightScore: number;
    scopeDescription?: string;
    isHoldPoint?: boolean;
    actorUsername: string;
    actorRole: string;
  },
  client: any = supabase
): Promise<{ success: boolean; error?: string; weight?: QCTaskWeight }> {
  const { taskTemplateId, weightScore, scopeDescription, isHoldPoint = false, actorUsername, actorRole } = params;

  if (!canManageQCWeights(actorRole)) {
    return { success: false, error: 'ไม่มีสิทธิ์ตั้งค่าน้ำหนักงานตรวจ (เฉพาะ Admin หรือ Project Planner)' };
  }

  if (weightScore < 1 || weightScore > 5 || !Number.isInteger(weightScore)) {
    return { success: false, error: 'คะแนนน้ำหนักงานต้องเป็นจำนวนเต็มระหว่าง 1 ถึง 5 แต้ม' };
  }

  const payload = {
    task_template_id: taskTemplateId,
    weight_score: weightScore,
    scope_description: scopeDescription || '',
    is_hold_point: Boolean(isHoldPoint),
    updated_by: actorUsername,
    updated_at: new Date().toISOString(),
  };

  try {
    const { data, error } = await client
      .from('qc_task_weights')
      .upsert([payload], { onConflict: 'task_template_id' })
      .select('*')
      .maybeSingle();

    if (!error && data) {
      const result: QCTaskWeight = {
        id: data.id,
        task_template_id: String(data.task_template_id),
        weight_score: Number(data.weight_score),
        scope_description: data.scope_description,
        is_hold_point: Boolean(data.is_hold_point),
        updated_at: data.updated_at,
      };
      memoryTaskWeights.set(taskTemplateId, result);
      return { success: true, weight: result };
    }
    if (error) {
      // Memory fallback
      memoryTaskWeights.set(taskTemplateId, { ...payload });
      return { success: true, weight: memoryTaskWeights.get(taskTemplateId) };
    }
  } catch (err: any) {
    memoryTaskWeights.set(taskTemplateId, { ...payload });
    return { success: true, weight: memoryTaskWeights.get(taskTemplateId) };
  }

  return { success: false, error: 'ไม่สามารถบันทึกน้ำหนักแม่แบบงานได้' };
}

/**
 * 3.1 Batch Save QC Task Weights by Multiple Template IDs (e.g. grouped by task name)
 */
export async function saveQCTaskWeightsBatch(
  params: {
    taskTemplateIds: string[];
    weightScore: number;
    scopeDescription?: string;
    isHoldPoint?: boolean;
    actorUsername: string;
    actorRole: string;
  },
  client: any = supabase
): Promise<{ success: boolean; error?: string; count?: number }> {
  const { taskTemplateIds, weightScore, scopeDescription, isHoldPoint = false, actorUsername, actorRole } = params;

  if (!canManageQCWeights(actorRole)) {
    return { success: false, error: 'ไม่มีสิทธิ์ตั้งค่าน้ำหนักงานตรวจ (เฉพาะ Admin หรือ Project Planner)' };
  }

  if (weightScore < 1 || weightScore > 5 || !Number.isInteger(weightScore)) {
    return { success: false, error: 'คะแนนน้ำหนักงานต้องเป็นจำนวนเต็มระหว่าง 1 ถึง 5 แต้ม' };
  }

  if (!taskTemplateIds || taskTemplateIds.length === 0) {
    return { success: true, count: 0 };
  }

  const now = new Date().toISOString();
  const payloads = taskTemplateIds.map(tid => ({
    task_template_id: tid,
    weight_score: weightScore,
    scope_description: scopeDescription || '',
    is_hold_point: Boolean(isHoldPoint),
    updated_by: actorUsername,
    updated_at: now,
  }));

  try {
    const { error } = await client
      .from('qc_task_weights')
      .upsert(payloads, { onConflict: 'task_template_id' });

    payloads.forEach(p => {
      memoryTaskWeights.set(p.task_template_id, {
        id: p.task_template_id,
        task_template_id: p.task_template_id,
        weight_score: p.weight_score,
        scope_description: p.scope_description,
        is_hold_point: p.is_hold_point,
        updated_at: p.updated_at,
      });
    });

    if (error) {
      // Memory fallback is already populated
      return { success: true, count: payloads.length };
    }
    return { success: true, count: payloads.length };
  } catch (err: any) {
    payloads.forEach(p => {
      memoryTaskWeights.set(p.task_template_id, {
        id: p.task_template_id,
        task_template_id: p.task_template_id,
        weight_score: p.weight_score,
        scope_description: p.scope_description,
        is_hold_point: p.is_hold_point,
        updated_at: p.updated_at,
      });
    });
    return { success: true, count: payloads.length };
  }
}

/**
 * 3.2 Save Multiple Grouped QC Task Weights in a Single Batch Operation
 */
export async function saveQCTaskWeightsMultiGroup(
  items: Array<{
    taskTemplateIds: string[];
    weightScore: number;
    scopeDescription?: string;
    isHoldPoint?: boolean;
  }>,
  actorUsername: string,
  actorRole: string,
  client: any = supabase
): Promise<{ success: boolean; error?: string; count?: number }> {
  if (!canManageQCWeights(actorRole)) {
    return { success: false, error: 'ไม่มีสิทธิ์ตั้งค่าน้ำหนักงานตรวจ (เฉพาะ Admin หรือ Project Planner)' };
  }

  const now = new Date().toISOString();
  const allPayloads: any[] = [];

  for (const it of items) {
    if (it.weightScore < 1 || it.weightScore > 5 || !Number.isInteger(it.weightScore)) {
      continue;
    }
    it.taskTemplateIds.forEach(tid => {
      allPayloads.push({
        task_template_id: tid,
        weight_score: it.weightScore,
        scope_description: it.scopeDescription || '',
        is_hold_point: Boolean(it.isHoldPoint),
        updated_by: actorUsername,
        updated_at: now,
      });
    });
  }

  if (allPayloads.length === 0) {
    return { success: true, count: 0 };
  }

  try {
    const { error } = await client
      .from('qc_task_weights')
      .upsert(allPayloads, { onConflict: 'task_template_id' });

    allPayloads.forEach(p => {
      memoryTaskWeights.set(p.task_template_id, {
        id: p.task_template_id,
        task_template_id: p.task_template_id,
        weight_score: p.weight_score,
        scope_description: p.scope_description,
        is_hold_point: p.is_hold_point,
        updated_at: p.updated_at,
      });
    });

    return { success: true, count: allPayloads.length };
  } catch {
    allPayloads.forEach(p => {
      memoryTaskWeights.set(p.task_template_id, {
        id: p.task_template_id,
        task_template_id: p.task_template_id,
        weight_score: p.weight_score,
        scope_description: p.scope_description,
        is_hold_point: p.is_hold_point,
        updated_at: p.updated_at,
      });
    });
    return { success: true, count: allPayloads.length };
  }
}

/**
 * 4. Generate Draft Daily Plan Items from Existing Inspection Queue
 */
export function generateDraftPlanItems(params: {
  inspectionQueue: any[];
  weightsMap: Map<string, QCTaskWeight>;
  planDate: string; // YYYY-MM-DD
  existingItems?: QCPlanItem[];
  targetProject?: string;
  cutOffHour?: number;
}): QCPlanItem[] {
  const {
    inspectionQueue = [],
    weightsMap = new Map(),
    planDate,
    existingItems = Array.from(memoryPlanItems.values()),
    targetProject,
    cutOffHour = 17,
  } = params;

  // Build active assignment set to prevent duplicate assignments for same (plot_id, task_template_id, round_number)
  const activeAssignmentKeys = new Set<string>();
  existingItems.forEach(item => {
    if (item.plan_status === 'confirmed' || item.plan_status === 'draft') {
      activeAssignmentKeys.add(`${item.plot_id}_${item.task_template_id}_${item.round_number}`);
    }
  });

  const draftItems: QCPlanItem[] = [];

  inspectionQueue.forEach((q: any) => {
    // Exclude demo project
    const projName = String(q.project_name || q.projectName || '').trim();
    if (projName.toLowerCase().includes('demo') || projName === 'Admin Demo Project') {
      return;
    }

    if (targetProject && targetProject !== 'all' && projName.toLowerCase() !== targetProject.toLowerCase()) {
      return;
    }

    // Only tasks waiting for QC
    if (q.statusFor !== 'QC') {
      return;
    }

    const plotId = String(q.plot_id);
    const taskTemplateId = String(q.task_template_id);
    const roundNumber = Number(q.round_number || 1);

    // Guard: Prevent duplicate active assignment
    const key = `${plotId}_${taskTemplateId}_${roundNumber}`;
    if (activeAssignmentKeys.has(key)) {
      return;
    }

    // Lookup weight from template weights table
    const weightMeta = weightsMap.get(taskTemplateId);
    // If not configured, snapshot_weight_score is NULL (ไม่พร้อมคำนวณ)
    const weightScore = weightMeta ? weightMeta.weight_score : null;
    const isHoldPoint = weightMeta ? weightMeta.is_hold_point : false;
    const scopeDesc = weightMeta?.scope_description || null;

    const submittedAt = q.created_at || q.time || new Date().toISOString();
    const { scheduledDate, isLateHandoff } = calculateTargetInspectionDate(submittedAt, { cutOffHour });

    const item: QCPlanItem = {
      id: `plan_item_${plotId}_${taskTemplateId}_${roundNumber}`,
      plot_id: plotId,
      plot_name: q.plot_name || `แปลง ${plotId}`,
      project_name: projName,
      task_template_id: taskTemplateId,
      task_name: q.task_name || 'งานตรวจ',
      round_number: roundNumber,
      snapshot_weight_score: weightScore,
      snapshot_scope_description: scopeDesc,
      snapshot_is_hold_point: isHoldPoint,
      se_submitted_at: submittedAt,
      se_submitted_by: q.user_name || q.user || 'Site Engineer',
      is_late_handoff: isLateHandoff,
      due_date: scheduledDate,
      assigned_inspector_username: null, // initially in central pool
      plan_status: 'draft',
      execution_status: 'pending',
      earned_points: 0,
      original_plan_date: planDate,
      created_at: new Date().toISOString(),
    };

    draftItems.push(item);
  });

  // Sort by Hold Point first, then FIFO by submission time
  draftItems.sort((a, b) => {
    if (a.snapshot_is_hold_point !== b.snapshot_is_hold_point) {
      return a.snapshot_is_hold_point ? -1 : 1;
    }
    const ta = new Date(a.se_submitted_at).getTime() || 0;
    const tb = new Date(b.se_submitted_at).getTime() || 0;
    return ta - tb;
  });

  return draftItems;
}

/**
 * 5. Confirm Daily Inspection Plan (Snapshots weights & freezes assignment)
 */
export async function confirmQCPlan(
  params: {
    planDate: string;
    projectName: string;
    inspectorUsername: string;
    items: QCPlanItem[];
    actorUsername: string;
    actorRole: string;
  },
  client: any = supabase
): Promise<{ success: boolean; error?: string; plan?: QCDailyPlanSummary }> {
  const { planDate, projectName, inspectorUsername, items, actorUsername, actorRole } = params;

  if (!canAssignQCPlans(actorRole)) {
    return { success: false, error: 'ไม่มีสิทธิ์ยืนยันแผนตรวจ QC (เฉพาะ Admin, Project Planner, หรือ Site Engineer)' };
  }

  if (!items || items.length === 0) {
    return { success: false, error: 'ไม่พบรายการงานตรวจที่จะยืนยันในแผน' };
  }

  // Calculate totals
  let totalPlannedPoints = 0;
  items.forEach(it => {
    if (typeof it.snapshot_weight_score === 'number') {
      totalPlannedPoints += it.snapshot_weight_score;
    }
  });

  const planId = `plan_${planDate}_${inspectorUsername}_${projectName}`;
  const planData = {
    id: planId,
    plan_date: planDate,
    project_name: projectName,
    inspector_username: inspectorUsername,
    status: 'confirmed',
    total_planned_tasks: items.length,
    total_planned_points: totalPlannedPoints,
    total_completed_tasks: 0,
    total_completed_points: 0,
    total_deferred_tasks: 0,
    total_deferred_points: 0,
    confirmed_at: new Date().toISOString(),
    confirmed_by: actorUsername,
    version: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const confirmedItems: QCPlanItem[] = items.map(it => ({
    ...it,
    plan_id: planId,
    assigned_inspector_username: inspectorUsername,
    plan_status: 'confirmed',
    original_plan_date: it.original_plan_date || planDate,
  }));

  // Store in memory cache
  memoryDailyPlans.set(planId, planData);
  confirmedItems.forEach(it => memoryPlanItems.set(it.id, it));

  // Try DB persistence
  try {
    await client.from('qc_daily_inspection_plans').upsert([planData]);
    await client.from('qc_daily_plan_items').upsert(confirmedItems);
  } catch {
    // fallback to memory
  }

  return {
    success: true,
    plan: {
      planDate,
      inspectorUsername,
      projectName,
      status: 'confirmed',
      totalPlannedTasks: items.length,
      totalPlannedPoints,
      totalCompletedTasks: 0,
      totalCompletedPoints: 0,
      totalDeferredTasks: 0,
      totalDeferredPoints: 0,
      overdueTasksCount: 0,
      items: confirmedItems,
      overdueItems: [],
      version: 1,
    },
  };
}

/**
 * 6. Record Inspection Execution Outcome & Calculate Earned Points
 * Rules:
 * - passed: full credit (earned_points = snapshot_weight_score)
 * - failed / reject: full credit (QC inspected thoroughly, earned_points = snapshot_weight_score)
 * - cannot_inspect: 0 points (site blocked / worker absent)
 * - partial: 0 points
 * - Bound strictly to actual_inspector_username
 * - Replays / retries do not duplicate points
 */
export async function recordPlanItemExecution(
  params: {
    planItemId: string;
    executionStatus: ExecutionStatus;
    actualInspectorUsername: string;
    actualInspectorRole: string;
    failureReason?: string;
    roundScopeReduction?: number; // For re-inspections with partial scope
  },
  client: any = supabase
): Promise<{ success: boolean; error?: string; item?: QCPlanItem }> {
  const {
    planItemId,
    executionStatus,
    actualInspectorUsername,
    actualInspectorRole,
    failureReason,
    roundScopeReduction,
  } = params;

  if (!canExecuteQCInspection(actualInspectorRole)) {
    return { success: false, error: 'ไม่มีสิทธิ์บันทึกผลการตรวจงาน QC' };
  }

  const existingItem = memoryPlanItems.get(planItemId);
  if (!existingItem) {
    return { success: false, error: 'ไม่พบรายการงานตรวจในแผน' };
  }

  // Prevent double-scoring if already completed
  if (existingItem.execution_status === 'passed' || existingItem.execution_status === 'failed') {
    return { success: true, item: existingItem };
  }

  let earnedPoints = 0;
  const baseWeight = existingItem.snapshot_weight_score;

  if (typeof baseWeight === 'number') {
    if (executionStatus === 'passed' || executionStatus === 'failed') {
      // Re-inspection round may have scope reduction if specified
      if (roundScopeReduction && roundScopeReduction < baseWeight) {
        earnedPoints = Math.max(1, roundScopeReduction);
      } else {
        earnedPoints = baseWeight;
      }
    } else {
      // cannot_inspect or partial -> 0 points
      earnedPoints = 0;
    }
  }

  const updatedItem: QCPlanItem = {
    ...existingItem,
    execution_status: executionStatus,
    actual_inspector_username: actualInspectorUsername,
    actual_inspected_at: new Date().toISOString(),
    earned_points: earnedPoints,
    failure_reason: failureReason || null,
  };

  memoryPlanItems.set(planItemId, updatedItem);

  // Update plan totals
  if (existingItem.plan_id && memoryDailyPlans.has(existingItem.plan_id)) {
    const plan = memoryDailyPlans.get(existingItem.plan_id);
    if (executionStatus === 'passed' || executionStatus === 'failed') {
      plan.total_completed_tasks = (plan.total_completed_tasks || 0) + 1;
      plan.total_completed_points = (plan.total_completed_points || 0) + earnedPoints;
      memoryDailyPlans.set(existingItem.plan_id, plan);
    }
  }

  // Try DB update
  try {
    await client
      .from('qc_daily_plan_items')
      .update({
        execution_status: executionStatus,
        actual_inspector_username: actualInspectorUsername,
        actual_inspected_at: updatedItem.actual_inspected_at,
        earned_points: earnedPoints,
        failure_reason: updatedItem.failure_reason,
      })
      .eq('id', planItemId);
  } catch {
    // fallback
  }

  return { success: true, item: updatedItem };
}

/**
 * 7. Defer / Reschedule Plan Item (12 / 8 / 4 Tracking)
 * Preserves the original plan record as 'deferred' on original date,
 * and tracks the deferral reason and target new date.
 */
export async function deferPlanItem(
  params: {
    planItemId: string;
    deferToDate: string;
    deferralReason: string;
    actorUsername: string;
    actorRole: string;
  },
  client: any = supabase
): Promise<{ success: boolean; error?: string; deferredItem?: QCPlanItem }> {
  const { planItemId, deferToDate, deferralReason, actorUsername, actorRole } = params;

  if (!canAssignQCPlans(actorRole)) {
    return { success: false, error: 'ไม่มีสิทธิ์เลื่อนงานในแผนตรวจ (เฉพาะ Admin หรือ ผู้จัดแผน)' };
  }

  const existingItem = memoryPlanItems.get(planItemId);
  if (!existingItem) {
    return { success: false, error: 'ไม่พบรายการงานตรวจที่ต้องการเลื่อน' };
  }

  const deferredItem: QCPlanItem = {
    ...existingItem,
    plan_status: 'deferred',
    deferred_to_date: deferToDate,
    deferral_reason: deferralReason,
  };

  memoryPlanItems.set(planItemId, deferredItem);

  // Update plan totals: record deferred task & points
  if (existingItem.plan_id && memoryDailyPlans.has(existingItem.plan_id)) {
    const plan = memoryDailyPlans.get(existingItem.plan_id);
    const weight = existingItem.snapshot_weight_score || 0;
    plan.total_deferred_tasks = (plan.total_deferred_tasks || 0) + 1;
    plan.total_deferred_points = (plan.total_deferred_points || 0) + weight;
    memoryDailyPlans.set(existingItem.plan_id, plan);
  }

  // Create new active item for the deferred date
  const newItemId = `${planItemId}_deferred_${deferToDate}`;
  const newItem: QCPlanItem = {
    ...existingItem,
    id: newItemId,
    plan_id: undefined,
    due_date: deferToDate,
    plan_status: 'draft',
    execution_status: 'pending',
    earned_points: 0,
    original_plan_date: existingItem.original_plan_date || existingItem.due_date,
    created_at: new Date().toISOString(),
  };

  memoryPlanItems.set(newItemId, newItem);

  try {
    await client
      .from('qc_daily_plan_items')
      .update({
        plan_status: 'deferred',
        deferred_to_date: deferToDate,
        deferral_reason: deferralReason,
        deferred_at: new Date().toISOString(),
        deferred_by: actorUsername,
      })
      .eq('id', planItemId);
  } catch {
    // fallback
  }

  return { success: true, deferredItem };
}

/**
 * 8. Query "My QC Inspection Plan" for a specific date and inspector
 */
export async function getMyQCInspectionPlan(
  params: {
    targetDate: string; // YYYY-MM-DD
    inspectorUsername?: string;
  },
  client: any = supabase
): Promise<QCDailyPlanSummary> {
  const { targetDate, inspectorUsername } = params;

  let allItems: QCPlanItem[] = Array.from(memoryPlanItems.values());

  // Try DB read
  try {
    const { data, error } = await client.from('qc_daily_plan_items').select('*');
    if (!error && Array.isArray(data) && data.length > 0) {
      allItems = data.map((row: any) => ({
        id: row.id,
        plan_id: row.plan_id,
        plot_id: String(row.plot_id),
        plot_name: `แปลง ${row.plot_id}`,
        project_name: row.project_name || 'โครงการ',
        task_template_id: String(row.task_template_id),
        task_name: row.task_name,
        round_number: row.round_number || 1,
        snapshot_weight_score: row.snapshot_weight_score ?? null,
        snapshot_scope_description: row.snapshot_scope_description,
        snapshot_is_hold_point: Boolean(row.snapshot_is_hold_point),
        se_submitted_at: row.se_submitted_at,
        se_submitted_by: row.se_submitted_by,
        is_late_handoff: Boolean(row.is_late_handoff),
        due_date: row.due_date,
        assigned_inspector_username: row.assigned_inspector_username,
        plan_status: row.plan_status,
        execution_status: row.execution_status,
        actual_inspector_username: row.actual_inspector_username,
        actual_inspected_at: row.actual_inspected_at,
        earned_points: row.earned_points || 0,
        failure_reason: row.failure_reason,
        original_plan_date: row.original_plan_date,
        deferred_to_date: row.deferred_to_date,
        deferral_reason: row.deferral_reason,
      }));
    }
  } catch {
    // fallback
  }

  // Filter items assigned to this inspector (or unassigned central pool if no inspector specified)
  const isMatchInspector = (itemFm?: string | null) => {
    if (!inspectorUsername || inspectorUsername === 'all') return true;
    return (itemFm || '').toLowerCase() === inspectorUsername.toLowerCase();
  };

  // Day items (scheduled for targetDate)
  const dayItems = allItems.filter(
    item => item.due_date === targetDate && isMatchInspector(item.assigned_inspector_username)
  );

  // Overdue backlog items: scheduled before targetDate and not completed or deferred
  const overdueItems = allItems.filter(
    item =>
      item.due_date < targetDate &&
      item.plan_status === 'confirmed' &&
      item.execution_status === 'pending' &&
      isMatchInspector(item.assigned_inspector_username)
  );

  let totalPlannedPoints = 0;
  let totalCompletedPoints = 0;
  let totalCompletedTasks = 0;
  let totalDeferredTasks = 0;
  let totalDeferredPoints = 0;

  dayItems.forEach(it => {
    const w = it.snapshot_weight_score || 0;
    if (it.plan_status === 'confirmed') {
      totalPlannedPoints += w;
      if (it.execution_status === 'passed' || it.execution_status === 'failed') {
        totalCompletedTasks++;
        totalCompletedPoints += it.earned_points;
      }
    } else if (it.plan_status === 'deferred') {
      totalPlannedPoints += w; // original planned weight retained in 12/8/4 ratio
      totalDeferredTasks++;
      totalDeferredPoints += w;
    }
  });

  return {
    planDate: targetDate,
    inspectorUsername,
    status: 'confirmed',
    totalPlannedTasks: dayItems.length,
    totalPlannedPoints,
    totalCompletedTasks,
    totalCompletedPoints,
    totalDeferredTasks,
    totalDeferredPoints,
    overdueTasksCount: overdueItems.length,
    items: dayItems,
    overdueItems,
    version: 1,
  };
}

/**
 * Upsert or update a single plan item in memory (for tests or cross-service sync)
 */
export function updateMemoryPlanItem(item: QCPlanItem): void {
  memoryPlanItems.set(item.id, item);
}

/**
 * 9. Query all QC Plan items for a specific month (for Audit Calendar)
 * Combines confirmed items from qc_daily_plan_items with live pending queue and historical updates
 */
export async function getMonthlyQCPlanItems(
  params: {
    year: number;
    month: number;
    inspectionQueue?: any[];
    allUpdatesRecord?: any[];
    weightsMap?: Map<string, QCTaskWeight>;
    plots?: any[];
  },
  client: any = supabase
): Promise<QCPlanItem[]> {
  const { year, month, inspectionQueue = [], allUpdatesRecord = [], weightsMap = new Map(), plots = [] } = params;

  const monthPrefix = `${year}-${String(month).padStart(2, '0')}`;
  const plotNameMap = new Map<string, { plot_name: string; project_name: string }>();
  plots.forEach((p: any) => {
    plotNameMap.set(String(p.id), {
      plot_name: p.house_number ? `บ้านเลขที่ ${p.house_number}` : (p.name || `แปลง ${p.id}`),
      project_name: p.project_name || 'โครงการ',
    });
  });

  const resultMap = new Map<string, QCPlanItem>();

  // 1. Load from DB: qc_daily_plan_items
  try {
    const { data, error } = await client
      .from('qc_daily_plan_items')
      .select('*');

    if (!error && Array.isArray(data)) {
      data.forEach((row: any) => {
        const itemDate = row.due_date || row.original_plan_date || '';
        if (itemDate.startsWith(monthPrefix)) {
          resultMap.set(row.id, {
            id: row.id,
            plan_id: row.plan_id,
            plot_id: String(row.plot_id),
            plot_name: row.plot_name || `แปลง ${row.plot_id}`,
            project_name: row.project_name || 'โครงการ',
            task_template_id: String(row.task_template_id),
            task_name: row.task_name,
            round_number: row.round_number || 1,
            snapshot_weight_score: row.snapshot_weight_score ?? null,
            snapshot_scope_description: row.snapshot_scope_description,
            snapshot_is_hold_point: Boolean(row.snapshot_is_hold_point),
            se_submitted_at: row.se_submitted_at,
            se_submitted_by: row.se_submitted_by,
            is_late_handoff: Boolean(row.is_late_handoff),
            due_date: row.due_date,
            assigned_inspector_username: row.assigned_inspector_username,
            plan_status: row.plan_status,
            execution_status: row.execution_status,
            actual_inspector_username: row.actual_inspector_username,
            actual_inspected_at: row.actual_inspected_at,
            earned_points: row.earned_points || 0,
            failure_reason: row.failure_reason,
            original_plan_date: row.original_plan_date,
            deferred_to_date: row.deferred_to_date,
            deferral_reason: row.deferral_reason,
          });
        }
      });
    }
  } catch {
    // fallback
  }

  // Also include memory items matching month
  memoryPlanItems.forEach(item => {
    const d = item.due_date || item.original_plan_date || '';
    if (d.startsWith(monthPrefix) && !resultMap.has(item.id)) {
      resultMap.set(item.id, item);
    }
  });

  // 2. Map Live Pending Queue into today's items if not already stored
  const todayStr = new Date().toISOString().split('T')[0];
  if (todayStr.startsWith(monthPrefix) && Array.isArray(inspectionQueue)) {
    inspectionQueue.forEach((queueItem: any, idx: number) => {
      const qId = String(queueItem.id || `live_q_${idx}`);
      if (resultMap.has(qId)) return;

      const pInfo = plotNameMap.get(String(queueItem.plot_id)) || {
        plot_name: queueItem.house_number ? `บ้านเลขที่ ${queueItem.house_number}` : `แปลง ${queueItem.plot_id}`,
        project_name: queueItem.project_name || 'โครงการ',
      };

      const wConfig = weightsMap.get(String(queueItem.task_template_id));
      const wScore = wConfig?.weight_score ?? 2;
      const isHold = wConfig?.is_hold_point ?? false;

      resultMap.set(qId, {
        id: qId,
        plot_id: String(queueItem.plot_id),
        plot_name: pInfo.plot_name,
        project_name: pInfo.project_name,
        task_template_id: String(queueItem.task_template_id),
        task_name: queueItem.task_name || 'งานตรวจทั่วไป',
        round_number: 1,
        snapshot_weight_score: wScore,
        snapshot_scope_description: wConfig?.scope_description || null,
        snapshot_is_hold_point: isHold,
        se_submitted_at: queueItem.created_at || new Date().toISOString(),
        se_submitted_by: queueItem.user_name || 'SE',
        is_late_handoff: false,
        due_date: todayStr,
        assigned_inspector_username: queueItem.foreman || 'QC Pool',
        plan_status: 'draft',
        execution_status: 'pending',
        earned_points: 0,
        original_plan_date: todayStr,
      });
    });
  }

  // 3. Map Historical Completed Updates in allUpdatesRecord for past dates in this month
  if (Array.isArray(allUpdatesRecord)) {
    allUpdatesRecord.forEach((up: any, idx: number) => {
      const dateStr = (up.created_at || up.date || '').split('T')[0];
      if (!dateStr || !dateStr.startsWith(monthPrefix) || dateStr >= todayStr) return;

      const status = (up.status || '').toUpperCase();
      const isQCInspection = status === 'QC_PASSED' || status === 'QC_REJECTED' || status.includes('QC');
      if (!isQCInspection) return;

      const histId = `hist_${up.id || idx}_${dateStr}`;
      if (resultMap.has(histId)) return;

      const pInfo = plotNameMap.get(String(up.plot_id)) || {
        plot_name: `แปลง ${up.plot_id}`,
        project_name: up.project_name || 'โครงการ',
      };

      const wConfig = weightsMap.get(String(up.task_template_id));
      const wScore = wConfig?.weight_score ?? 2;
      const isHold = wConfig?.is_hold_point ?? false;
      const isPassed = status === 'QC_PASSED';

      resultMap.set(histId, {
        id: histId,
        plot_id: String(up.plot_id),
        plot_name: pInfo.plot_name,
        project_name: pInfo.project_name,
        task_template_id: String(up.task_template_id),
        task_name: up.task_name || 'งานตรวจ QC',
        round_number: 1,
        snapshot_weight_score: wScore,
        snapshot_scope_description: null,
        snapshot_is_hold_point: isHold,
        se_submitted_at: up.created_at || `${dateStr}T09:00:00Z`,
        se_submitted_by: 'SE',
        is_late_handoff: false,
        due_date: dateStr,
        assigned_inspector_username: up.user_name || 'QC',
        plan_status: 'confirmed',
        execution_status: isPassed ? 'passed' : 'failed',
        actual_inspector_username: up.user_name || 'QC',
        actual_inspected_at: up.created_at || `${dateStr}T15:00:00Z`,
        earned_points: wScore,
        original_plan_date: dateStr,
      });
    });
  }

  return Array.from(resultMap.values());
}

/**
 * Reset memory caches for tests
 */
export function resetQCPlanMemoryCache(): void {
  memoryTaskWeights.clear();
  memoryDailyPlans.clear();
  memoryPlanItems.clear();
}
