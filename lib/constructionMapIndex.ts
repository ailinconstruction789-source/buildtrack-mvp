type MapId = string | number | null | undefined;

export interface MapHistoryRow {
  id?: MapId;
  plot_id: MapId;
  task_template_id: MapId;
  created_at?: string | null;
  progress?: string | number | null;
}

export interface MapAssignmentRow {
  plot_id: MapId;
  task_template_id: MapId;
  current_progress?: string | number | null;
}

export interface MapTaskRow {
  id: MapId;
  house_type_id?: MapId;
  task_name: string;
}

/** Keep first-match semantics, including strict number/string ID comparisons. */
export function indexFirstBy<T, K>(rows: readonly T[], key: (row: T) => K): Map<K, T> {
  const index = new Map<K, T>();
  for (const row of rows) {
    const id = key(row);
    if (!index.has(id)) index.set(id, row);
  }
  return index;
}

function timestamp(row: MapHistoryRow): number {
  const value = row.created_at ? Date.parse(row.created_at) : NaN;
  return Number.isFinite(value) ? value : -Infinity;
}

function newerHistory(candidate: MapHistoryRow, current: MapHistoryRow): boolean {
  const candidateTime = timestamp(candidate);
  const currentTime = timestamp(current);
  if (candidateTime !== currentTime) return candidateTime > currentTime;
  // Database IDs break timestamp ties regardless of lazy-load concatenation order.
  // Without distinct IDs, retain the first source row rather than inventing recency.
  if (candidate.id == null || current.id == null) return false;
  const candidateNumber = Number(candidate.id);
  const currentNumber = Number(current.id);
  if (Number.isFinite(candidateNumber) && Number.isFinite(currentNumber)) {
    return candidateNumber > currentNumber;
  }
  return String(candidate.id) > String(current.id);
}

export function buildMapHistoryIndex<T extends MapHistoryRow>(
  rows: readonly T[], grassTaskIds: ReadonlySet<string>,
) {
  const latestByPlot = new Map<MapId, T>();
  const latestGrassByPlot = new Map<MapId, T>();
  for (const row of rows) {
    const current = latestByPlot.get(row.plot_id);
    if (!current || newerHistory(row, current)) latestByPlot.set(row.plot_id, row);
    if (grassTaskIds.has(String(row.task_template_id))) {
      const grass = latestGrassByPlot.get(row.plot_id);
      // Existing grass behavior is stable newest-first sorting (first row wins ties).
      if (!grass || timestamp(row) > timestamp(grass)) latestGrassByPlot.set(row.plot_id, row);
    }
  }
  return { latestByPlot, latestGrassByPlot };
}

export function buildMapAssignmentIndex<T extends MapAssignmentRow>(
  rows: readonly T[], grassTaskIds: ReadonlySet<string>,
) {
  const lastByPlotAndTask = new Map<MapId, Map<MapId, T>>();
  const firstGrassByPlot = new Map<string, T>();
  for (const row of rows) {
    let tasks = lastByPlotAndTask.get(row.plot_id);
    if (!tasks) {
      tasks = new Map();
      lastByPlotAndTask.set(row.plot_id, tasks);
    }
    tasks.set(row.task_template_id, row);
    const plotKey = String(row.plot_id);
    if (grassTaskIds.has(String(row.task_template_id)) && !firstGrassByPlot.has(plotKey)) {
      firstGrassByPlot.set(plotKey, row);
    }
  }
  return { lastByPlotAndTask, firstGrassByPlot };
}

export function buildMapTaskIndex<T extends MapTaskRow>(rows: readonly T[]) {
  const byId = indexFirstBy(rows, row => row.id);
  const byHouseAndName = new Map<MapId, Map<string, T>>();
  const byNormalizedHouseAndName = new Map<string, Map<string, T>>();
  const grassTaskIds = new Set<string>();
  const addTask = <K>(index: Map<K, Map<string, T>>, key: K, row: T) => {
    let names = index.get(key);
    if (!names) {
      names = new Map();
      index.set(key, names);
    }
    if (!names.has(row.task_name)) names.set(row.task_name, row);
  };
  for (const row of rows) {
    addTask(byHouseAndName, row.house_type_id, row);
    addTask(byNormalizedHouseAndName, String(row.house_type_id), row);
    if (row.task_name.includes('งานปูหญ้า')) grassTaskIds.add(String(row.id));
  }
  return { byId, byHouseAndName, byNormalizedHouseAndName, grassTaskIds };
}
