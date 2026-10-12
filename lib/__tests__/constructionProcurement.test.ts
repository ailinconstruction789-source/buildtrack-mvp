import { describe, expect, it } from 'vitest';
import { buildProcurementIndex } from '../constructionProcurement';

describe('procurement first-match indices', () => {
  it('preserves strict identifiers, first duplicates and input order', () => {
    const plots = [{ id: 1, house_type_id: 1 }, { id: '1', house_type_id: '1' }, { id: 1, house_type_id: 2 }];
    const tasks = [{ id: 1, house_type_id: 1, task_name: 'งาน' }, { id: 2, house_type_id: 1, task_name: 'งาน' }, { id: '1', house_type_id: '1', task_name: 'งาน' }];
    const assignments = [{ plot_id: 1, task_template_id: 1, contractor_name: '' }, { plot_id: '1', task_template_id: '1', contractor_name: 'assigned' }, { plot_id: 1, task_template_id: 1, contractor_name: 'later' }];
    const before = JSON.stringify({ plots, tasks, assignments });
    const index = buildProcurementIndex(plots, tasks, assignments);
    for (const plot of plots) {
      expect(index.plotsById.get(plot.id)).toBe(plots.find(row => row.id === plot.id));
      const task = tasks.find(row => row.task_name === 'งาน' && row.house_type_id === plot.house_type_id);
      expect(index.tasksByNameAndHouse.get('งาน')?.get(plot.house_type_id)).toBe(task);
      if (task) expect(index.assignmentsByPlotAndTask.get(plot.id)?.get(task.id)).toBe(assignments.find(row => row.plot_id === plot.id && row.task_template_id === task.id));
    }
    expect(JSON.stringify({ plots, tasks, assignments })).toBe(before);
  });
});
