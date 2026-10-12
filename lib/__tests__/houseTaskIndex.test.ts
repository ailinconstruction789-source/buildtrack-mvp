import { describe, expect, it } from 'vitest';
import { buildHouseTaskIndex } from '../houseTaskIndex';

describe('house task indexing parity', () => {
  it('keeps first assignment and strict plot/task ID matching', () => {
    const rows = [
      { plot_id: 'P1', task_template_id: 1, cost: 10 },
      { plot_id: 'P1', task_template_id: 1, cost: 99 },
      { plot_id: 'P1', task_template_id: '1', cost: 20 },
      { plot_id: 1, task_template_id: 1, cost: 30 }
    ];
    const { assignmentByTask } = buildHouseTaskIndex('P1', rows, []);
    expect(assignmentByTask.get(1)).toBe(rows[0]);
    expect(assignmentByTask.get('1')).toBe(rows[2]);
    expect(assignmentByTask.size).toBe(2);
  });

  it('matches existing history order and does not mutate the source array', () => {
    const rows = [
      { id: 1, plot_id: 'P1', task_template_id: 1, created_at: '2026-10-08', progress: 100 },
      { id: 2, plot_id: 'P2', task_template_id: 1, created_at: '2026-10-05', progress: 10 },
      { id: 3, plot_id: 'P1', task_template_id: 1, created_at: '2026-10-07', progress: 100 },
      { id: 4, plot_id: 'P1', task_template_id: '1', created_at: '2026-10-06', progress: 20 }
    ];
    const expected = rows.filter(row => row.plot_id === 'P1' && row.task_template_id === 1)
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    const before = rows.map(row => row.id);
    const { updatesByTask } = buildHouseTaskIndex('P1', [], rows);
    expect(updatesByTask.get(1)).toEqual(expected);
    expect(updatesByTask.get('1')).toEqual([rows[3]]);
    expect(rows.map(row => row.id)).toEqual(before);
  });

  it('preserves equal-date input order used for completion streaks', () => {
    const rows = [
      { id: 1, plot_id: 'P1', task_template_id: 1, created_at: '2026-10-08', progress: 50 },
      { id: 2, plot_id: 'P1', task_template_id: 1, created_at: '2026-10-08', progress: 100 }
    ];
    expect(buildHouseTaskIndex('P1', [], rows).updatesByTask.get(1)).toEqual(rows);
    expect(buildHouseTaskIndex('P2', [], rows).updatesByTask.size).toBe(0);
  });
});
