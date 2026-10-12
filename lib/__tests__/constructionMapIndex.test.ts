import { describe, expect, it } from 'vitest';
import { buildMapAssignmentIndex, buildMapHistoryIndex, buildMapTaskIndex, indexFirstBy } from '../constructionMapIndex';

describe('construction map lookups', () => {
  it('selects newest timestamps from descending and lazy-appended histories', () => {
    const newest = { id: 3, plot_id: 'A', task_template_id: 'new', created_at: '2026-10-08T12:00:00Z' };
    const oldest = { id: 1, plot_id: 'A', task_template_id: 'old', created_at: '2026-10-01T12:00:00Z' };
    const middle = { id: 2, plot_id: 'A', task_template_id: 'mid', created_at: '2026-10-04T12:00:00Z' };
    for (const rows of [[newest, oldest, middle], [oldest, middle, newest], [middle, newest, oldest]]) {
      expect(buildMapHistoryIndex(rows, new Set()).latestByPlot.get('A')).toBe(newest);
    }
  });

  it('breaks equal timestamp ties by database ID independently of concatenation order', () => {
    const a = { id: '9', plot_id: 'A', task_template_id: 1, created_at: '2026-10-08T12:00:00Z' };
    const b = { ...a, id: '10' };
    expect(buildMapHistoryIndex([a, b], new Set()).latestByPlot.get('A')).toBe(b);
    expect(buildMapHistoryIndex([b, a], new Set()).latestByPlot.get('A')).toBe(b);
  });

  it('prefers valid timestamps over invalid/missing dates without mutating inputs', () => {
    const invalid = { id: 20, plot_id: 'A', task_template_id: 1, created_at: 'invalid' };
    const valid = { ...invalid, id: 1, created_at: '2026-10-08T12:00:00Z' };
    const rows = Object.freeze([invalid, valid]);
    expect(buildMapHistoryIndex(rows, new Set()).latestByPlot.get('A')).toBe(valid);
    expect(rows).toEqual([invalid, valid]);
  });

  it('keeps strict numeric/string plot IDs separate for histories', () => {
    const numeric = { id: 1, plot_id: 7, task_template_id: 1 };
    const text = { id: 2, plot_id: '7', task_template_id: 1 };
    const index = buildMapHistoryIndex([numeric, text], new Set());
    expect(index.latestByPlot.get(7)).toBe(numeric);
    expect(index.latestByPlot.get('7')).toBe(text);
  });

  it('preserves reverse-find assignment results including duplicates and mixed IDs', () => {
    const rows = [
      { plot_id: 'A', task_template_id: 3, current_progress: 10 },
      { plot_id: 'A', task_template_id: '3', current_progress: 20 },
      { plot_id: 7, task_template_id: 3, current_progress: 30 },
      { plot_id: '7', task_template_id: 3, current_progress: 40 },
      { plot_id: 'A', task_template_id: 3, current_progress: 70 },
    ];
    const index = buildMapAssignmentIndex(rows, new Set());
    for (const plotId of ['A', '7', 7, 'absent']) {
      for (const taskId of ['3', 3, 99]) {
        expect(index.lastByPlotAndTask.get(plotId)?.get(taskId)).toBe(
          rows.slice().reverse().find(row => row.plot_id === plotId && row.task_template_id === taskId),
        );
      }
    }
  });

  it('preserves grass first-assignment fallback with normalized IDs', () => {
    const rows = [
      { plot_id: 7, task_template_id: 3, current_progress: 100 },
      { plot_id: '7', task_template_id: '3', current_progress: 25 },
    ];
    const index = buildMapAssignmentIndex(rows, new Set(['3']));
    expect(index.firstGrassByPlot.get('7')).toBe(rows[0]);
    expect(index.lastByPlotAndTask.get('7')?.get('3')).toBe(rows[1]);
  });

  it('uses newest grass history over completed assignment, with stable first-row time ties', () => {
    const completed = { id: 9, plot_id: 'A', task_template_id: 3, progress: 100, created_at: '2026-10-01T00:00:00Z' };
    const latest = { ...completed, id: 10, task_template_id: '3', progress: 30, created_at: '2026-10-08T00:00:00Z' };
    const equalTime = { ...latest, id: 20, progress: 100 };
    const index = buildMapHistoryIndex([completed, latest, equalTime], new Set(['3']));
    expect(index.latestGrassByPlot.get('A')).toBe(latest);
    expect(index.latestByPlot.get('A')).toBe(equalTime);
  });

  it('preserves first template matches for strict and normalized house types', () => {
    const rows = [
      { id: 1, house_type_id: 7, task_name: 'งานปูหญ้า' },
      { id: '1', house_type_id: '7', task_name: 'งานปูหญ้า' },
      { id: 3, house_type_id: 7, task_name: 'งานปูหญ้า' },
    ];
    const index = buildMapTaskIndex(rows);
    expect(index.byId.get(1)).toBe(rows[0]);
    expect(index.byId.get('1')).toBe(rows[1]);
    expect(index.byHouseAndName.get('7')?.get('งานปูหญ้า')).toBe(rows[1]);
    expect(index.byNormalizedHouseAndName.get('7')?.get('งานปูหญ้า')).toBe(rows[0]);
    expect(index.grassTaskIds).toEqual(new Set(['1', '3']));
  });

  it('preserves first-match plot and house lookup behavior', () => {
    const rows = [{ id: 7, name: 'numeric' }, { id: '7', name: 'text' }, { id: 7, name: 'duplicate' }];
    const strict = indexFirstBy(rows, row => row.id);
    const normalized = indexFirstBy(rows, row => String(row.id));
    for (const id of [7, '7', 'missing']) {
      expect(strict.get(id)).toBe(rows.find(row => row.id === id));
      expect(normalized.get(String(id))).toBe(rows.find(row => String(row.id) === String(id)));
    }
  });
});
