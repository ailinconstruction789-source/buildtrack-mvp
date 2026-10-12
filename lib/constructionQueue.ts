type QueueId = string | number | null | undefined;

export interface ConstructionQueueHistory {
  plot_id: QueueId;
  task_template_id: QueueId;
  created_at: string;
  progress?: number | null;
  action?: string | null;
}

export function constructionQueueDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function constructionQueueKey(plotId: QueueId, taskId: QueueId): string {
  return JSON.stringify([String(plotId), String(taskId)]);
}

export function constructionQueueFirstIndex<T, K>(rows: readonly T[], key: (row: T) => K): Map<K, T> {
  const index = new Map<K, T>();
  for (const row of rows) {
    const id = key(row);
    if (!index.has(id)) index.set(id, row);
  }
  return index;
}

export function constructionQueueHistoryIndex<T extends ConstructionQueueHistory>(rows: readonly T[]) {
  const grouped = new Map<string, T[]>();
  const submissions = new Map<string, T[]>();
  for (const row of rows) {
    const key = constructionQueueKey(row.plot_id, row.task_template_id);
    let group = grouped.get(key);
    if (!group) {
      group = [];
      grouped.set(key, group);
    }
    group.push(row);
    if (row.progress === 100 && (row.action === 'ส่งงาน 100%' || !row.action?.includes('QC')) && Number.isFinite(Date.parse(row.created_at))) {
      let submitRows = submissions.get(key);
      if (!submitRows) {
        submitRows = [];
        submissions.set(key, submitRows);
      }
      submitRows.push(row);
    }
  }
  const newestFirst = (a: T, b: T) => Date.parse(b.created_at) - Date.parse(a.created_at);
  for (const group of grouped.values()) group.sort(newestFirst);
  for (const group of submissions.values()) group.sort(newestFirst);

  const previousSubmission = (review: T, includeSameTime = false): T | undefined => {
    const timestamp = Date.parse(review.created_at);
    if (!Number.isFinite(timestamp)) return undefined;
    const group = submissions.get(constructionQueueKey(review.plot_id, review.task_template_id));
    if (!group) return undefined;
    let low = 0;
    let high = group.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      const candidate = Date.parse(group[middle].created_at);
      if (includeSameTime ? candidate <= timestamp : candidate < timestamp) high = middle;
      else low = middle + 1;
    }
    return group[low];
  };
  return { grouped, previousSubmission };
}

export interface ConstructionQueueBillingRow {
  task_template_id: QueueId;
  latest_action?: string | null;
  latest_update_created_at?: string | null;
  billing_status?: string | null;
  task_cost?: string | number | null;
}

export function constructionQueueBillingPartition<T extends ConstructionQueueBillingRow>(
  rows: readonly T[], templates: readonly { id: QueueId; require_qc?: boolean | null }[],
) {
  const byId = constructionQueueFirstIndex(templates, template => template.id);
  const pendingItems: T[] = [];
  const billedItems: T[] = [];
  let totalPendingValue = 0;
  let totalBilledValue = 0;
  const cutoff = Date.parse('2026-07-04T00:00:00Z');
  for (const row of rows) {
    const template = byId.get(row.task_template_id);
    const requireQC = template ? template.require_qc : true;
    const action = row.latest_action || '';
    const approved = action.includes('QC อนุมัติ') || (!requireQC && action.includes('Site Engineer อนุมัติ'));
    if (!approved) continue;
    const updateTime = row.latest_update_created_at === null ? 0 : Date.parse(row.latest_update_created_at || '');
    const billed = row.billing_status === 'billed' || updateTime < cutoff;
    if (billed) {
      billedItems.push(row);
      totalBilledValue += Number(row.task_cost) || 0;
    } else {
      pendingItems.push(row);
      totalPendingValue += Number(row.task_cost) || 0;
    }
  }
  return { pendingItems, billedItems, totalPendingValue, totalBilledValue };
}
