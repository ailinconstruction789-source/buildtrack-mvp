/**
 * Handover Foreman Ownership & Handoff Helper
 *
 * Manages handover foreman attribution per plot and per defect row:
 * - Handover work is often handed off to a different foreman than construction (`plots.foreman_name`).
 * - When a foreman adds handover items on a house that has no handover foreman yet,
 *   that foreman becomes the handover owner immediately.
 * - When another handover foreman already owns work on the house, the incoming foreman
 *   chooses whether they are helping (keep original foreman) or taking over (completed
 *   items remain attributed to the original foreman; incomplete + new items move to incoming).
 * - Non-foreman roles (Admin, QC, Site Engineer, Project Planner) keep the current handover
 *   foreman or fall back to `plots.foreman_name` without attributing ownership to themselves.
 */

export interface HandoverPlotForemanInfo {
  currentForeman: string;
  hasHandoverHistory: boolean;
  activeDefectsCount: number;
  completedDefectsCount: number;
  activeDefectIds: string[];
  completedDefectIdsWithoutForeman: string[];
}

export type HandoverAddDecision =
  | {
      needsPrompt: false;
      foremanForNewDefects: string;
      shouldSetPlotHandoverForeman: boolean;
      plotHandoverForemanName: string | null;
      existingInfo: HandoverPlotForemanInfo;
    }
  | {
      needsPrompt: true;
      existingForeman: string;
      incomingForeman: string;
      existingInfo: HandoverPlotForemanInfo;
    };

/**
 * Checks whether a handover defect item is already completed (100% or closed/resolved).
 */
export function isHandoverDefectCompleted(defect: any): boolean {
  if (!defect) return false;
  if (Number(defect.progress || 0) >= 100) return true;
  const status = String(defect.status || '').toLowerCase().trim();
  return status === 'resolved' || status === 'closed' || status === 'completed' || status === 'approved';
}

/**
 * Checks whether a role represents a site Foreman.
 */
export function isForemanRole(role?: string | null): boolean {
  const normalized = String(role || '').toLowerCase().trim();
  return normalized === 'foreman' || normalized === 'โฟร์แมน';
}

/**
 * Placeholder strings treated as an unassigned foreman across plots & snapshots.
 */
export const UNASSIGNED_FOREMAN_PLACEHOLDERS = [
  '',
  'ยังไม่ระบุโฟร์แมน',
  'ยังไม่ระบุ',
  '-',
  'unassigned',
] as const;

/**
 * Returns true if the supplied foreman name is empty or an unassigned placeholder string.
 */
export function isUnassignedForemanName(name?: string | null): boolean {
  const normalized = String(name || '').trim().toLowerCase();
  return (UNASSIGNED_FOREMAN_PLACEHOLDERS as readonly string[]).includes(normalized);
}

/**
 * Updates historical snapshot rows for a plot when filling in a real foreman over unassigned placeholders.
 * Never overwrites snapshots attributed to another concrete foreman.
 */
export async function backfillUnassignedSnapshotsForPlot(
  supabaseClient: any,
  plotId: string | number,
  foremanName?: string | null
): Promise<void> {
  const cleanFm = String(foremanName || '').trim();
  if (!supabaseClient || !plotId || !cleanFm || isUnassignedForemanName(cleanFm)) return;
  try {
    const res = await supabaseClient
      .from('foreman_daily_duty_snapshots')
      .update({ foreman_name: cleanFm })
      .eq('plot_id', String(plotId))
      .in('foreman_name', [...UNASSIGNED_FOREMAN_PLACEHOLDERS]);
    if (res?.error) {
      console.warn('Notice backfilling unassigned snapshots:', res.error.message);
    }
  } catch (err) {
    console.warn('Notice backfilling unassigned snapshots:', err);
  }
}

/**
 * Resolves a foreman name to its canonical casing from a known foremen/users list
 * (e.g., matching 'Den' -> 'DEN' when 'DEN' is the system username).
 */
export function canonicalizeForemanName(name?: string | null, foremenList?: any[]): string {
  const trimmed = String(name || '').trim();
  if (!trimmed || isUnassignedForemanName(trimmed)) return '';
  if (!Array.isArray(foremenList) || foremenList.length === 0) return trimmed;
  const lower = trimmed.toLowerCase();
  for (const u of foremenList) {
    const candidate = String(u?.username || u?.name || '').trim();
    if (candidate && candidate.toLowerCase() === lower) {
      return candidate;
    }
  }
  return trimmed;
}

/**
 * Resolves fallback foreman for a plot: prefers `handover_foreman_name`, then construction `foreman_name`/`foreman`.
 */
export function resolvePlotFallbackForeman(plot: any): string {
  if (!plot) return '';
  const handoverFm = String(plot.handover_foreman_name || '').trim();
  if (handoverFm && !isUnassignedForemanName(handoverFm)) return handoverFm;
  const constructionFm = String(plot.foreman_name || plot.foreman || '').trim();
  if (constructionFm && !isUnassignedForemanName(constructionFm)) return constructionFm;
  return '';
}

/**
 * Resolves the responsible foreman for a defect item.
 * Per-defect `defect.foreman_name` takes precedence over plot-level fallback.
 */
export function resolveHandoverDefectForeman(defect: any, plot?: any): string {
  const defectFm = String(defect?.foreman_name || '').trim();
  if (defectFm && !isUnassignedForemanName(defectFm)) return defectFm;
  return resolvePlotFallbackForeman(plot);
}

/**
 * Summarizes current handover foreman ownership & active/completed defects for a plot + cycle.
 */
export function getPlotActiveHandoverForemanInfo(options: {
  plot: any;
  defects?: any[];
  cycle?: number;
}): HandoverPlotForemanInfo {
  const { plot, defects = [], cycle } = options;
  if (!plot) {
    return {
      currentForeman: '',
      hasHandoverHistory: false,
      activeDefectsCount: 0,
      completedDefectsCount: 0,
      activeDefectIds: [],
      completedDefectIdsWithoutForeman: [],
    };
  }

  const targetCycle = cycle !== undefined ? Number(cycle) : Number(plot.handover_cycle || 1);
  const plotIdStr = String(plot.id);

  const cycleDefects = (Array.isArray(defects) ? defects : []).filter(d => {
    if (!d || String(d.plot_id) !== plotIdStr) return false;
    if (d.defect_stage !== 'handover') return false;
    const dCycle = Number(d.handover_cycle || 1);
    return dCycle === targetCycle;
  });

  const incompleteDefects: any[] = [];
  const completedDefects: any[] = [];

  cycleDefects.forEach(d => {
    if (isHandoverDefectCompleted(d)) {
      completedDefects.push(d);
    } else {
      incompleteDefects.push(d);
    }
  });

  const rawPlotHandoverFm = String(plot.handover_foreman_name || '').trim();
  const plotHandoverFm = isUnassignedForemanName(rawPlotHandoverFm) ? '' : rawPlotHandoverFm;
  const rawPlotConstructionFm = String(plot.foreman_name || plot.foreman || '').trim();
  const plotConstructionFm = isUnassignedForemanName(rawPlotConstructionFm) ? '' : rawPlotConstructionFm;
  const hasHandoverHistory = cycleDefects.length > 0 || Boolean(plotHandoverFm);

  const byCreatedDesc = (a: any, b: any) =>
    new Date(b?.created_at || 0).getTime() - new Date(a?.created_at || 0).getTime();

  let currentForeman = plotHandoverFm;

  if (!currentForeman) {
    const newestIncompleteWithFm = [...incompleteDefects]
      .sort(byCreatedDesc)
      .find(d => !isUnassignedForemanName(d?.foreman_name));
    if (newestIncompleteWithFm) {
      currentForeman = String(newestIncompleteWithFm.foreman_name).trim();
    }
  }

  if (!currentForeman) {
    const newestCompletedWithFm = [...completedDefects]
      .sort(byCreatedDesc)
      .find(d => !isUnassignedForemanName(d?.foreman_name));
    if (newestCompletedWithFm) {
      currentForeman = String(newestCompletedWithFm.foreman_name).trim();
    }
  }

  if (!currentForeman && cycleDefects.length > 0) {
    currentForeman = plotConstructionFm;
  }

  return {
    currentForeman,
    hasHandoverHistory,
    activeDefectsCount: incompleteDefects.length,
    completedDefectsCount: completedDefects.length,
    activeDefectIds: incompleteDefects.map(d => String(d.id)),
    completedDefectIdsWithoutForeman: completedDefects
      .filter(d => isUnassignedForemanName(d?.foreman_name))
      .map(d => String(d.id)),
  };
}

/**
 * Evaluates what should happen when a user adds one or more handover tasks to a plot.
 */
export function evaluateHandoverAddAction(options: {
  plot: any;
  defects?: any[];
  cycle?: number;
  actorRole?: string | null;
  actorName?: string | null;
}): HandoverAddDecision {
  const { plot, defects = [], cycle, actorRole, actorName } = options;
  const existingInfo = getPlotActiveHandoverForemanInfo({ plot, defects, cycle });
  const trimmedActorName = String(actorName || '').trim();
  const rawConstructionFm = String(plot?.foreman_name || plot?.foreman || '').trim();
  const plotConstructionFm = isUnassignedForemanName(rawConstructionFm) ? '' : rawConstructionFm;

  // Rule 1.1: Non-foreman roles (Admin, QC, SE, Project Planner, etc.) never take foreman ownership themselves
  if (!isForemanRole(actorRole) || !trimmedActorName) {
    const targetForeman = existingInfo.currentForeman || plotConstructionFm;
    return {
      needsPrompt: false,
      foremanForNewDefects: targetForeman,
      shouldSetPlotHandoverForeman: false,
      plotHandoverForemanName: existingInfo.currentForeman || null,
      existingInfo,
    };
  }

  // Case 1: First handover work on this plot (or no handover foreman recorded yet)
  // Incoming foreman takes handover responsibility immediately
  if (!existingInfo.hasHandoverHistory || !existingInfo.currentForeman) {
    return {
      needsPrompt: false,
      foremanForNewDefects: trimmedActorName,
      shouldSetPlotHandoverForeman: true,
      plotHandoverForemanName: trimmedActorName,
      existingInfo,
    };
  }

  // Case 2: Same foreman as current handover owner
  if (existingInfo.currentForeman.toLowerCase() === trimmedActorName.toLowerCase()) {
    return {
      needsPrompt: false,
      foremanForNewDefects: existingInfo.currentForeman,
      shouldSetPlotHandoverForeman: !String(plot?.handover_foreman_name || '').trim(),
      plotHandoverForemanName: existingInfo.currentForeman,
      existingInfo,
    };
  }

  // Case 3: Different foreman adding tasks on a house already handled by another foreman
  return {
    needsPrompt: true,
    existingForeman: existingInfo.currentForeman,
    incomingForeman: trimmedActorName,
    existingInfo,
  };
}

/**
 * Pure state-transition plan when resolving "ช่วยงาน (help)" vs "มาต่องาน (takeover)".
 */
export function buildHandoverHandoffPlan(options: {
  mode: 'help' | 'takeover';
  existingForeman: string;
  incomingForeman: string;
  existingInfo: HandoverPlotForemanInfo;
}): {
  newDefectsForeman: string;
  freezeCompletedIds: string[];
  freezeCompletedForeman: string;
  transferIncompleteIds: string[];
  nextPlotHandoverForeman: string | null;
} {
  const { mode, existingForeman, incomingForeman, existingInfo } = options;

  if (mode === 'help') {
    return {
      newDefectsForeman: existingForeman,
      freezeCompletedIds: [],
      freezeCompletedForeman: existingForeman,
      transferIncompleteIds: [],
      nextPlotHandoverForeman: existingForeman,
    };
  }

  return {
    newDefectsForeman: incomingForeman,
    freezeCompletedIds: existingInfo.completedDefectIdsWithoutForeman,
    freezeCompletedForeman: existingForeman,
    transferIncompleteIds: existingInfo.activeDefectIds,
    nextPlotHandoverForeman: incomingForeman,
  };
}
