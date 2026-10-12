type Id = string | number | null | undefined;
interface PlotRow { id: Id; project_name?: string; house_type_id?: Id; plot_name?: string }
interface TaskRow { id: Id; house_type_id?: Id; task_name: string }
interface AssignmentRow { plot_id: Id; task_template_id: Id; contractor_name?: string | null }

export function buildProcurementIndex<P extends PlotRow, T extends TaskRow, A extends AssignmentRow>(
  plots: readonly P[], tasks: readonly T[], assignments: readonly A[],
) {
  const plotsById = new Map<Id, P>();
  const tasksByNameAndHouse = new Map<string, Map<Id, T>>();
  const assignmentsByPlotAndTask = new Map<Id, Map<Id, A>>();
  for (const plot of plots) if (!plotsById.has(plot.id)) plotsById.set(plot.id, plot);
  for (const task of tasks) {
    let houses = tasksByNameAndHouse.get(task.task_name);
    if (!houses) tasksByNameAndHouse.set(task.task_name, houses = new Map());
    if (!houses.has(task.house_type_id)) houses.set(task.house_type_id, task);
  }
  for (const assignment of assignments) {
    let plotTasks = assignmentsByPlotAndTask.get(assignment.plot_id);
    if (!plotTasks) assignmentsByPlotAndTask.set(assignment.plot_id, plotTasks = new Map());
    if (!plotTasks.has(assignment.task_template_id)) plotTasks.set(assignment.task_template_id, assignment);
  }
  return { plotsById, tasksByNameAndHouse, assignmentsByPlotAndTask };
}
