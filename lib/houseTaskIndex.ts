interface HouseAssignmentRow { plot_id: unknown; task_template_id: unknown; }
interface HouseUpdateRow { plot_id: unknown; task_template_id: unknown; created_at?: string | null; }

/** Preserve strict ID and first assignment semantics used by the house table. */
export function buildHouseTaskIndex<A extends HouseAssignmentRow, U extends HouseUpdateRow>(
  plotId: unknown, assignments: readonly A[], updates: readonly U[]
) {
  const assignmentByTask = new Map<unknown, A>();
  const updatesByTask = new Map<unknown, U[]>();
  for (const row of assignments) {
    if (row.plot_id === plotId && !assignmentByTask.has(row.task_template_id)) {
      assignmentByTask.set(row.task_template_id, row);
    }
  }
  for (const row of updates) {
    if (row.plot_id !== plotId) continue;
    const rows = updatesByTask.get(row.task_template_id);
    if (rows) rows.push(row);
    else updatesByTask.set(row.task_template_id, [row]);
  }
  for (const rows of updatesByTask.values()) {
    rows.sort((a, b) => new Date(a.created_at as string).getTime() - new Date(b.created_at as string).getTime());
  }
  return { assignmentByTask, updatesByTask };
}
