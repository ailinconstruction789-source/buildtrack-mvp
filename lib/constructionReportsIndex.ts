/** Preserve Array.find's first match and the original identifier comparison. */
export function firstBy<T, K>(rows: readonly T[], keyOf: (row: T) => K): Map<K, T> {
  const index = new Map<K, T>();
  for (const row of rows) {
    const key = keyOf(row);
    if (!index.has(key)) index.set(key, row);
  }
  return index;
}

export function groupBy<T, K>(rows: readonly T[], keyOf: (row: T) => K): Map<K, T[]> {
  const index = new Map<K, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const bucket = index.get(key);
    if (bucket) bucket.push(row);
    else index.set(key, [row]);
  }
  return index;
}

export interface ConstructionRiskAlert {
  title: string;
  type: string;
  severity: string;
  message: string;
  recommendation: string;
}

export function parseConstructionRiskAlerts(value: unknown): ConstructionRiskAlert[] {
  if (!Array.isArray(value) || !value.every(item => item !== null && typeof item === 'object'
    && ['title', 'type', 'severity', 'message', 'recommendation'].every(field => typeof item[field] === 'string'))) {
    throw new Error('ข้อมูลรายงาน AI ไม่ถูกต้อง กรุณาลองใหม่');
  }
  return value;
}

/** Schedule rows normally include plot_id; legacy map keys start with the full plot id. */
export function filterSchedulesByPlot<T extends { plot_id?: unknown }>(
  schedules: Readonly<Record<string, T>>,
  plotIds: ReadonlySet<unknown>,
  knownPlotIds: ReadonlySet<unknown> = plotIds,
): Record<string, T> {
  const result: Record<string, T> = {};
  for (const [key, row] of Object.entries(schedules)) {
    if (row.plot_id !== undefined && row.plot_id !== null) {
      if (plotIds.has(row.plot_id)) result[key] = row;
      continue;
    }
    // Match the longest id first so A and A-1 cannot share each other's schedules.
    let matchingId: unknown;
    let matchingLength = -1;
    for (const id of knownPlotIds) {
      const prefix = `${String(id)}-`;
      if (key.startsWith(prefix) && prefix.length > matchingLength) {
        matchingId = id;
        matchingLength = prefix.length;
      }
    }
    if (matchingLength >= 0 && typeof matchingId === 'string' && plotIds.has(matchingId)) result[key] = row;
  }
  return result;
}

export interface WeeklyAssignment {
  plot_id: unknown;
  task_template_id: unknown;
  is_excluded?: unknown;
  current_progress?: unknown;
}
export interface WeeklyTemplate {
  id: unknown;
  cost?: unknown;
  is_progress_counted?: unknown;
}
export interface WeeklyUpdate {
  plot_id: unknown;
  task_template_id: unknown;
  created_at: string;
  progress?: unknown;
}

export function buildWeeklyProgressIndex(
  assignments: readonly WeeklyAssignment[],
  templates: readonly WeeklyTemplate[],
  updates: readonly WeeklyUpdate[],
  cutoffTime: number,
) {
  const assignmentsByPlot = groupBy(assignments.filter(row => !row.is_excluded), row => row.plot_id);
  const templatesById = firstBy(templates, row => row.id);
  const historyByPlot = new Map<unknown, Map<unknown, {
    latestBefore?: WeeklyUpdate;
    latestTime: number;
    hasAfter: boolean;
  }>>();
  const plotsWithRecentUpdates = new Set<unknown>();
  for (const row of updates) {
    let tasks = historyByPlot.get(row.plot_id);
    if (!tasks) historyByPlot.set(row.plot_id, tasks = new Map());
    let history = tasks.get(row.task_template_id);
    if (!history) tasks.set(row.task_template_id, history = { latestTime: -Infinity, hasAfter: false });
    const time = new Date(row.created_at).getTime();
    if (time <= cutoffTime && time > history.latestTime) {
      history.latestBefore = row;
      history.latestTime = time;
    } else if (time > cutoffTime) {
      history.hasAfter = true;
      plotsWithRecentUpdates.add(row.plot_id);
    }
  }
  return { assignmentsByPlot, templatesById, historyByPlot, plotsWithRecentUpdates };
}

export function calculateWeeklyProgressAtCutoff(
  plotId: unknown,
  index: ReturnType<typeof buildWeeklyProgressIndex>,
  fallbackCurrent: number,
): number {
  const assignments = index.assignmentsByPlot.get(plotId) || [];
  let totalCost = 0;
  let totalWeightedProgress = 0;
  let hasValidData = false;
  for (const assignment of assignments) {
    const template = index.templatesById.get(assignment.task_template_id);
    if (template?.is_progress_counted === false) continue;
    const cost = Number(template?.cost) || 1;
    totalCost += cost;
    const history = index.historyByPlot.get(plotId)?.get(assignment.task_template_id);
    let progress = Number(assignment.current_progress) || 0;
    if (history?.latestBefore) {
      progress = Number(history.latestBefore.progress) || 0;
      hasValidData = true;
    } else if (history?.hasAfter) {
      progress = 0;
      hasValidData = true;
    }
    totalWeightedProgress += progress * cost;
  }
  return !hasValidData || totalCost === 0 ? fallbackCurrent : totalWeightedProgress / totalCost;
}
