/** PostgreSQL date values are calendar dates, not UTC instants. */
export function constructionScheduleDateMs(value: unknown): number {
  if (typeof value !== 'string' || !value) return Number.NaN;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return new Date(value).getTime();
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(year, month, day);
  date.setFullYear(year);
  return date.getFullYear() === year && date.getMonth() === month && date.getDate() === day
    ? date.getTime() : Number.NaN;
}

function calendarDayOrdinal(time: number): number {
  const date = new Date(time);
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000;
}

export function constructionScheduleGanttRange(start: unknown, end: unknown, timelineStart: number, timelineEnd: number) {
  const startMs = constructionScheduleDateMs(start);
  const endMs = constructionScheduleDateMs(end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return null;
  const firstDay = calendarDayOrdinal(timelineStart);
  const lastDay = calendarDayOrdinal(timelineEnd);
  const startDay = calendarDayOrdinal(startMs);
  const endDay = calendarDayOrdinal(endMs);
  if (endDay < firstDay || startDay > lastDay) return null;
  const startIdx = Math.max(0, startDay - firstDay);
  const endIdx = Math.min(lastDay - firstDay, endDay - firstDay);
  return { startIdx, endIdx, width: (endIdx - startIdx + 1) * 40, left: startIdx * 40 };
}

/** Match Array.find's first-row semantics, including distinct string/number IDs. */
export function constructionScheduleFirstIndex<T>(rows: readonly T[], key: (row: T) => unknown): Map<unknown, T> {
  const result = new Map<unknown, T>();
  for (const row of rows) {
    const id = key(row);
    if (!result.has(id)) result.set(id, row);
  }
  return result;
}

export function constructionScheduleAssignmentIndex<T extends { plot_id?: unknown; task_template_id?: unknown }>(rows: readonly T[]) {
  const result = new Map<unknown, Map<unknown, T>>();
  for (const row of rows) {
    let tasks = result.get(row.plot_id);
    if (!tasks) { tasks = new Map<unknown, T>(); result.set(row.plot_id, tasks); }
    if (!tasks.has(row.task_template_id)) tasks.set(row.task_template_id, row);
  }
  return result;
}

export function constructionScheduleHouseTypeIndex<T extends { house_type_id?: unknown }>(rows: readonly T[]) {
  const result = new Map<unknown, T[]>();
  for (const row of rows) {
    const group = result.get(row.house_type_id);
    if (group) group.push(row); else result.set(row.house_type_id, [row]);
  }
  return result;
}

class MinHeap<T> {
  private values: T[] = [];
  constructor(private compare: (a: T, b: T) => number) {}
  peek() { return this.values[0]; }
  push(value: T) {
    const items = this.values;
    items.push(value);
    let index = items.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.compare(items[parent], value) <= 0) break;
      items[index] = items[parent]; index = parent;
    }
    items[index] = value;
  }
  pop(): T | undefined {
    const items = this.values;
    if (!items.length) return undefined;
    const first = items[0];
    const last = items.pop()!;
    if (!items.length) return first;
    let index = 0;
    while (index * 2 + 1 < items.length) {
      const left = index * 2 + 1;
      const right = left + 1;
      const child = right < items.length && this.compare(items[right], items[left]) < 0 ? right : left;
      if (this.compare(last, items[child]) <= 0) break;
      items[index] = items[child]; index = child;
    }
    items[index] = last;
    return first;
  }
}

/** Interval partitioning: overlapping bars always have distinct lanes, in O(n log n). */
export function constructionScheduleGanttLanes<T extends { startIdx: number; endIdx: number }>(tasks: readonly T[]) {
  const sorted = tasks.map((task, index) => ({ task, index })).sort((a, b) => a.task.startIdx - b.task.startIdx || a.index - b.index);
  const active = new MinHeap<{ endIdx: number; lane: number }>((a, b) => a.endIdx - b.endIdx || a.lane - b.lane);
  const available = new MinHeap<number>((a, b) => a - b);
  const lanes = new Array<number>(tasks.length);
  let laneCount = 0;
  for (const { task, index } of sorted) {
    while (active.peek() && active.peek().endIdx < task.startIdx) available.push(active.pop()!.lane);
    const lane = available.pop() ?? laneCount++;
    lanes[index] = lane;
    active.push({ endIdx: task.endIdx, lane });
  }
  return { lanes, laneCount };
}

export function constructionScheduleDayGroups<T extends { plot_id: string; contractorName: string; pStart: number; pEnd: number }>(list: readonly T[], time: number) {
  const tasksForDay: T[] = [];
  const plotGroups: Record<string, T[]> = Object.create(null);
  for (const task of list) {
    if (!(task.pStart <= time && time <= task.pEnd)) continue;
    tasksForDay.push(task);
    (plotGroups[task.plot_id] ||= []).push(task);
  }
  const groupedTasksWithDetails = Object.entries(plotGroups).map(([plotId, tasks]) => {
    const isClashing = new Set(tasks.map(task => task.contractorName)).size > 1;
    const uniqueContractorNames = Array.from(new Set(tasks.map(task => task.contractorName.split(' ')[0]))).join(' / ');
    return { plotId, tasks, isClashing, uniqueContractorNames };
  });
  const clashes = groupedTasksWithDetails.filter(group => group.isClashing).map(({ plotId, tasks }) => ({ plotId, tasks }));
  return { tasksForDay, groupedTasksWithDetails, clashes };
}
