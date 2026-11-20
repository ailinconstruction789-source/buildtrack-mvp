/**
 * Construction Foreman Handoff & Task-Level Ownership Helper
 *
 * Implements intelligent foreman handovers for house construction:
 * - Tasks that are 100% completed and passed QC remain permanently credited
 *   to the original foreman (preserving historical attribution, KPI, and audit trail).
 * - Tasks that are incomplete, in progress, or not yet started transfer immediately
 *   to the incoming foreman.
 * - The plot records both the active foreman and the previous foreman so users
 *   can see who previously was responsible and who is responsible now.
 * - An audit row is saved in `plot_foreman_handovers`.
 */

import {
  isUnassignedForemanName,
  canonicalizeForemanName,
} from './handoverForeman';

export interface ConstructionTaskEvaluation {
  taskId: string;
  taskName: string;
  taskOrder: number;
  currentProgress: number;
  isCompleted: boolean;
  qcStatus: 'passed' | 'pending' | 'rejected' | 'none' | 'na';
  assignedForeman: string | null;
}

export interface PlotConstructionForemanInfo {
  plotId: string;
  currentForeman: string;
  previousForeman: string;
  handoffAt: string | null;
  handoffReason: string | null;
  completedTasks: ConstructionTaskEvaluation[];
  pendingTasks: ConstructionTaskEvaluation[];
  completedCount: number;
  pendingCount: number;
}

export interface ConstructionHandoffPlan {
  mode: 'takeover' | 'reassign_all';
  currentForeman: string;
  incomingForeman: string;
  freezeCompletedForeman: string;
  freezeCompletedTaskTemplateIds: string[];
  transferTaskTemplateIds: string[];
  newPlotForeman: string;
  previousPlotForeman: string;
}

/**
 * Checks whether an action string or update indicates QC approval / pass.
 */
export function isQCApprovedAction(action?: string | null): boolean {
  if (!action) return false;
  const s = String(action).toLowerCase().trim();
  return (
    s.includes('อนุมัติ') ||
    s.includes('ผ่าน') ||
    s.includes('qc pass') ||
    s.includes('qc_pass') ||
    s.includes('approved')
  );
}

/**
 * Checks whether an action string or update indicates QC rejection / rework.
 */
export function isQCRejectedAction(action?: string | null): boolean {
  if (!action) return false;
  const s = String(action).toLowerCase().trim();
  return (
    s.includes('ไม่อนุมัติ') ||
    s.includes('ไม่ผ่าน') ||
    s.includes('แจ้งแก้ไข') ||
    s.includes('สั่งแก้') ||
    s.includes('rejected')
  );
}

/**
 * Evaluates whether a construction task is completed and passed QC
 * (or does not require QC).
 */
export function evaluateConstructionTaskStatus(options: {
  task: any;
  assignment?: any;
  updates?: any[];
  qcInspections?: any[];
}): ConstructionTaskEvaluation {
  const { task, assignment, updates = [], qcInspections = [] } = options;

  const taskId = String(task?.id || assignment?.task_template_id || '');
  const taskName = String(task?.task_name || assignment?.task_name || 'งานก่อสร้าง');
  const taskOrder = Number(task?.task_order || 0);
  const currentProgress = Number(assignment?.current_progress ?? 0);
  const requireQC = task?.require_qc !== false;

  // Filter updates for this specific task
  const taskUpdates = updates.filter(
    u => String(u?.task_template_id || '') === taskId
  );

  // Filter QC inspections for this specific task
  const taskInspections = qcInspections.filter(
    i => String(i?.task_template_id || '') === taskId
  );

  // Check latest QC inspection if available
  const latestInspection = taskInspections.sort(
    (a, b) => new Date(b?.created_at || 0).getTime() - new Date(a?.created_at || 0).getTime()
  )[0];

  // Check latest QC update
  const qcUpdates = taskUpdates.filter(
    u => u?.role === 'QC' || String(u?.user_name || '').toUpperCase() === 'QC' || isQCApprovedAction(u?.action) || isQCRejectedAction(u?.action)
  );
  const latestQCUpdate = qcUpdates.sort(
    (a, b) => new Date(b?.created_at || 0).getTime() - new Date(a?.created_at || 0).getTime()
  )[0];

  let qcStatus: 'passed' | 'pending' | 'rejected' | 'none' | 'na' = !requireQC ? 'na' : 'none';

  if (!requireQC) {
    qcStatus = 'na';
  } else if (latestInspection) {
    if (latestInspection.document_status === 'approved' || latestInspection.inspection_result === 'passed') {
      qcStatus = 'passed';
    } else if (latestInspection.document_status === 'rejected' || latestInspection.inspection_result === 'failed') {
      qcStatus = 'rejected';
    } else {
      qcStatus = 'pending';
    }
  } else if (latestQCUpdate) {
    if (isQCApprovedAction(latestQCUpdate.action)) {
      qcStatus = 'passed';
    } else if (isQCRejectedAction(latestQCUpdate.action)) {
      qcStatus = 'rejected';
    } else {
      qcStatus = currentProgress === 100 ? 'pending' : 'none';
    }
  } else if (isQCApprovedAction(assignment?.latest_action)) {
    qcStatus = 'passed';
  } else if (isQCRejectedAction(assignment?.latest_action)) {
    qcStatus = 'rejected';
  } else if (currentProgress === 100) {
    // If progress is 100% and requires QC, but no explicit QC approval recorded yet
    qcStatus = 'pending';
  }

  // A task is completed if:
  // 1. Progress is 100%
  // 2. Either it does NOT require QC (qcStatus === 'na'), OR it has passed QC (qcStatus === 'passed').
  //    (Or if marked completed without requirement)
  const isCompleted = currentProgress >= 100 && (qcStatus === 'passed' || qcStatus === 'na');

  const assignedForeman = assignment?.foreman_name ? String(assignment.foreman_name).trim() : null;

  return {
    taskId,
    taskName,
    taskOrder,
    currentProgress,
    isCompleted,
    qcStatus,
    assignedForeman,
  };
}

/**
 * Analyzes all construction tasks of a plot to determine current foreman,
 * previous foreman, completed tasks, and pending tasks.
 */
export function getPlotConstructionForemanInfo(options: {
  plot: any;
  tasks?: any[];
  assignments?: any[];
  updates?: any[];
  qcInspections?: any[];
  foremenList?: any[];
}): PlotConstructionForemanInfo {
  const {
    plot,
    tasks = [],
    assignments = [],
    updates = [],
    qcInspections = [],
    foremenList = [],
  } = options;

  const plotId = String(plot?.id || '');
  const rawCurrentForeman = String(plot?.foreman_name || plot?.foreman || '').trim();
  const currentForeman = isUnassignedForemanName(rawCurrentForeman)
    ? ''
    : canonicalizeForemanName(rawCurrentForeman, foremenList);

  const rawPreviousForeman = String(plot?.previous_foreman_name || '').trim();
  const previousForeman = isUnassignedForemanName(rawPreviousForeman)
    ? ''
    : canonicalizeForemanName(rawPreviousForeman, foremenList);

  const handoffAt = plot?.foreman_handoff_at ? String(plot.foreman_handoff_at) : null;
  const handoffReason = plot?.foreman_handoff_reason ? String(plot.foreman_handoff_reason) : null;

  // Build map of assignments by task_template_id
  const assignmentMap = new Map<string, any>();
  assignments.forEach(a => {
    if (a?.task_template_id) {
      assignmentMap.set(String(a.task_template_id), a);
    }
  });

  const completedTasks: ConstructionTaskEvaluation[] = [];
  const pendingTasks: ConstructionTaskEvaluation[] = [];

  tasks.forEach(task => {
    const taskId = String(task?.id || '');
    const assign = assignmentMap.get(taskId);
    const evalResult = evaluateConstructionTaskStatus({
      task,
      assignment: assign,
      updates,
      qcInspections,
    });

    if (evalResult.isCompleted) {
      completedTasks.push(evalResult);
    } else {
      pendingTasks.push(evalResult);
    }
  });

  // Sort by task order
  completedTasks.sort((a, b) => a.taskOrder - b.taskOrder);
  pendingTasks.sort((a, b) => a.taskOrder - b.taskOrder);

  return {
    plotId,
    currentForeman,
    previousForeman,
    handoffAt,
    handoffReason,
    completedTasks,
    pendingTasks,
    completedCount: completedTasks.length,
    pendingCount: pendingTasks.length,
  };
}

/**
 * Builds the handoff plan for transferring construction tasks.
 */
export function buildConstructionHandoffPlan(options: {
  mode: 'takeover' | 'reassign_all';
  currentForeman: string;
  incomingForeman: string;
  foremanInfo: PlotConstructionForemanInfo;
}): ConstructionHandoffPlan {
  const { mode, currentForeman, incomingForeman, foremanInfo } = options;

  const cleanIncoming = incomingForeman.trim();
  const cleanCurrent = currentForeman.trim();

  if (mode === 'reassign_all') {
    // Reassign all tasks (e.g. correcting a mistake during initial creation)
    const allTaskIds = [
      ...foremanInfo.completedTasks.map(t => t.taskId),
      ...foremanInfo.pendingTasks.map(t => t.taskId),
    ];
    return {
      mode: 'reassign_all',
      currentForeman: cleanCurrent,
      incomingForeman: cleanIncoming,
      freezeCompletedForeman: cleanIncoming,
      freezeCompletedTaskTemplateIds: [],
      transferTaskTemplateIds: allTaskIds,
      newPlotForeman: cleanIncoming,
      previousPlotForeman: cleanCurrent,
    };
  }

  // Default 'takeover' mode:
  // Completed & QC-passed tasks remain frozen with the existing foreman.
  // Incomplete / pending tasks transfer to the incoming foreman.
  return {
    mode: 'takeover',
    currentForeman: cleanCurrent,
    incomingForeman: cleanIncoming,
    freezeCompletedForeman: cleanCurrent,
    freezeCompletedTaskTemplateIds: foremanInfo.completedTasks.map(t => t.taskId),
    transferTaskTemplateIds: foremanInfo.pendingTasks.map(t => t.taskId),
    newPlotForeman: cleanIncoming,
    previousPlotForeman: cleanCurrent,
  };
}

/**
 * Helper to identify missing column or schema cache mismatch errors from PostgREST / Supabase.
 */
export function isMissingColumnOrSchemaError(err: any): boolean {
  if (!err) return false;
  const code = String(err.code || '');
  const msg = String(err.message || '').toLowerCase();
  return (
    code === '42703' ||
    code === '42P01' ||
    code === 'PGRST204' ||
    code === 'PGRST205' ||
    msg.includes('schema cache') ||
    msg.includes('could not find the') ||
    msg.includes('column') ||
    msg.includes('does not exist')
  );
}

/**
 * Executes the database updates for a construction foreman handoff:
 * 1. Updates plot_task_assignments for frozen completed tasks.
 * 2. Updates plot_task_assignments for transferred incomplete tasks.
 * 3. Updates plots with new foreman_name, previous_foreman_name, handoff timestamp & reason.
 * 4. Inserts an audit row into plot_foreman_handovers.
 */
export async function executeConstructionForemanHandoff(
  supabaseClient: any,
  options: {
    plotId: string;
    incomingForeman: string;
    currentForeman: string;
    mode?: 'takeover' | 'reassign_all';
    reason?: string;
    actorName?: string;
    foremanInfo: PlotConstructionForemanInfo;
  }
): Promise<{ success: boolean; error?: string; plan?: ConstructionHandoffPlan }> {
  const {
    plotId,
    incomingForeman,
    currentForeman,
    mode = 'takeover',
    reason = '',
    actorName = 'System',
    foremanInfo,
  } = options;

  if (!supabaseClient) {
    return { success: false, error: 'Supabase client is not available.' };
  }

  const cleanIncoming = String(incomingForeman || '').trim();
  if (!cleanIncoming || isUnassignedForemanName(cleanIncoming)) {
    return { success: false, error: 'กรุณาระบุชื่อโฟร์แมนคนใหม่' };
  }

  const plan = buildConstructionHandoffPlan({
    mode,
    currentForeman,
    incomingForeman: cleanIncoming,
    foremanInfo,
  });

  try {
    const nowIso = new Date().toISOString();

    // 1. Freeze completed tasks with the original foreman (if in takeover mode)
    if (plan.mode === 'takeover' && plan.freezeCompletedTaskTemplateIds.length > 0 && plan.freezeCompletedForeman) {
      for (const tId of plan.freezeCompletedTaskTemplateIds) {
        try {
          const { error: freezeErr } = await supabaseClient
            .from('plot_task_assignments')
            .upsert(
              {
                plot_id: String(plotId),
                task_template_id: tId,
                foreman_name: plan.freezeCompletedForeman,
              },
              { onConflict: 'plot_id,task_template_id' }
            );
          if (freezeErr && !isMissingColumnOrSchemaError(freezeErr)) {
            console.warn('Notice updating frozen task assignment:', freezeErr.message);
          }
        } catch (e) {
          // Graceful fallback if task-level column not yet created
        }
      }
    }

    // 2. Transfer incomplete / pending tasks to the new incoming foreman
    if (plan.transferTaskTemplateIds.length > 0) {
      for (const tId of plan.transferTaskTemplateIds) {
        try {
          const { error: transferErr } = await supabaseClient
            .from('plot_task_assignments')
            .upsert(
              {
                plot_id: String(plotId),
                task_template_id: tId,
                foreman_name: plan.newPlotForeman,
              },
              { onConflict: 'plot_id,task_template_id' }
            );
          if (transferErr && !isMissingColumnOrSchemaError(transferErr)) {
            console.warn('Notice updating transferred task assignment:', transferErr.message);
          }
        } catch (e) {
          // Graceful fallback if task-level column not yet created
        }
      }
    }

    // 3. Update the plot with the new foreman and record previous foreman
    // NOTE: Only use valid database columns on `plots` (use `foreman_name`, NOT `foreman`)
    const plotPayload: any = {
      foreman_name: plan.newPlotForeman,
      previous_foreman_name: plan.previousPlotForeman || null,
      foreman_handoff_at: nowIso,
      foreman_handoff_reason: reason.trim() || null,
      foreman_assigned_at: nowIso,
    };

    let { error: plotErr } = await supabaseClient
      .from('plots')
      .update(plotPayload)
      .eq('id', String(plotId));

    // Graceful fallback if extra tracking columns are not yet in PostgREST schema cache
    if (plotErr && isMissingColumnOrSchemaError(plotErr)) {
      const fallbackRes = await supabaseClient
        .from('plots')
        .update({
          foreman_name: plan.newPlotForeman,
        })
        .eq('id', String(plotId));
      plotErr = fallbackRes.error;
    }

    if (plotErr) throw plotErr;

    // 4. Record audit entry in plot_foreman_handovers
    try {
      const { error: auditErr } = await supabaseClient.from('plot_foreman_handovers').insert([
        {
          plot_id: String(plotId),
          from_foreman: plan.previousPlotForeman || null,
          to_foreman: plan.newPlotForeman,
          handoff_mode: plan.mode,
          reason: reason.trim() || null,
          completed_tasks_count: plan.freezeCompletedTaskTemplateIds.length,
          transferred_tasks_count: plan.transferTaskTemplateIds.length,
          transferred_task_ids: plan.transferTaskTemplateIds,
          frozen_task_ids: plan.freezeCompletedTaskTemplateIds,
          created_by: actorName,
          created_at: nowIso,
        },
      ]);
      if (auditErr && !isMissingColumnOrSchemaError(auditErr)) {
        console.warn('Notice inserting plot_foreman_handovers audit record:', auditErr.message);
      }
    } catch (auditErr) {
      console.warn('Notice inserting plot_foreman_handovers audit record:', auditErr);
    }

    return { success: true, plan };
  } catch (err: any) {
    console.error('Error executing construction foreman handoff:', err);
    return {
      success: false,
      error: err.message || 'เกิดข้อผิดพลาดในการเปลี่ยนโฟร์แมนผู้รับผิดชอบ',
    };
  }
}
