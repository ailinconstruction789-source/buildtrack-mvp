import { describe, expect, it } from 'vitest';
import { buildWeeklyProgressIndex, calculateWeeklyProgressAtCutoff, filterSchedulesByPlot, firstBy, groupBy, parseConstructionRiskAlerts } from '../constructionReportsIndex';

// Synthetic regression fixtures. This is the report's former calculation, retained for parity.
function legacyProgress(plotId: unknown, cutoff: number, updates: any[], assignments: any[], templates: any[], fallback: number) {
  const plotAssignments = assignments.filter(a => a.plot_id === plotId && !a.is_excluded);
  const plotUpdates = updates.filter(u => u.plot_id === plotId);
  let cost = 0, weighted = 0, valid = false;
  for (const assignment of plotAssignments) {
    const template = templates.find(t => t.id === assignment.task_template_id);
    if (template?.is_progress_counted === false) continue;
    const weight = Number(template?.cost) || 1;
    cost += weight;
    const taskUpdates = plotUpdates.filter(u => u.task_template_id === assignment.task_template_id);
    const before = taskUpdates.filter(u => new Date(u.created_at).getTime() <= cutoff)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    let progress = Number(assignment.current_progress) || 0;
    if (before.length) { progress = Number(before[0].progress) || 0; valid = true; }
    else if (taskUpdates.some(u => new Date(u.created_at).getTime() > cutoff)) { progress = 0; valid = true; }
    weighted += progress * weight;
  }
  return !valid || cost === 0 ? fallback : weighted / cost;
}

describe('construction report indices (synthetic data)', () => {
  it('keeps the first duplicate and strict identifiers without mutating inputs', () => {
    const rows = Object.freeze([{ id: 1, name: 'first' }, { id: '1', name: 'string' }, { id: 1, name: 'second' }]);
    expect(firstBy(rows, row => row.id).get(1)?.name).toBe('first');
    expect(firstBy(rows, row => row.id).get('1')?.name).toBe('string');
    expect(groupBy(rows, row => row.id).get(1)).toEqual([rows[0], rows[2]]);
  });

  const assignments = [
    { plot_id: 'A', task_template_id: 1, current_progress: 80 },
    { plot_id: 'A', task_template_id: 2, current_progress: 90 },
    { plot_id: 'A', task_template_id: 3, current_progress: 100, is_excluded: true },
    { plot_id: 'A', task_template_id: 4, current_progress: 100 },
    { plot_id: 'A', task_template_id: '1', current_progress: 55 },
    { plot_id: 'A', task_template_id: 5, current_progress: 40 },
    { plot_id: 'B', task_template_id: 1, current_progress: 100 },
    { plot_id: 1, task_template_id: 1, current_progress: 70 },
    { plot_id: '1', task_template_id: 1, current_progress: 10 },
  ];
  const templates = [
    { id: 1, cost: 3 }, { id: 1, cost: 900 }, { id: 2, cost: 1 },
    { id: 3, cost: 800 }, { id: 4, cost: 800, is_progress_counted: false }, { id: '1', cost: 0 },
  ];
  const updates = [
    { plot_id: 'A', task_template_id: 1, created_at: '2026-10-07T12:00:00Z', progress: 80 },
    { plot_id: 'A', task_template_id: 1, created_at: '2026-10-01T12:00:00Z', progress: 30 },
    { plot_id: 'A', task_template_id: 1, created_at: '2026-10-01T12:00:00Z', progress: 99 },
    { plot_id: 'A', task_template_id: 2, created_at: '2026-10-08T12:00:00Z', progress: 90 },
    { plot_id: 'A', task_template_id: '1', created_at: 'invalid', progress: 90 },
    { plot_id: 'A', task_template_id: 4, created_at: '2026-09-01T12:00:00Z', progress: 100 },
    { plot_id: 1, task_template_id: 1, created_at: '2026-10-01T12:00:00Z', progress: 50 },
  ];
  const cutoffs = ['2026-08-01', '2026-10-01T12:00:00Z', '2026-10-05', '2026-10-08T12:00:00Z', '2026-12-01'];
  it.each(cutoffs)('matches legacy weighted progress at %s including ties/exclusions/fallback/strict IDs', date => {
    const cutoff = new Date(date).getTime();
    const snapshot = JSON.stringify({ assignments, templates, updates });
    const index = buildWeeklyProgressIndex(assignments, templates, updates, cutoff);
    for (const plotId of ['A', 'B', 1, '1', 'missing']) {
      expect(calculateWeeklyProgressAtCutoff(plotId, index, 73)).toBe(legacyProgress(plotId, cutoff, updates, assignments, templates, 73));
      expect(index.plotsWithRecentUpdates.has(plotId)).toBe(updates.some(u => u.plot_id === plotId && new Date(u.created_at).getTime() > cutoff));
    }
    expect(JSON.stringify({ assignments, templates, updates })).toBe(snapshot);
  });

  it('scopes schedule rows with explicit plot ids even when both identifiers contain hyphens', () => {
    const rows = { 'A-1-task-uuid': { plot_id: 'A-1', planned_end: '2026-10-12' },
      'A-2-task-uuid': { plot_id: 'A-2', planned_end: '2026-10-12' },
      'misleading-key': { plot_id: 'A-1', planned_end: '2026-10-12' } };
    expect(filterSchedulesByPlot(rows, new Set(['A-1']))).toEqual({ 'A-1-task-uuid': rows['A-1-task-uuid'], 'misleading-key': rows['misleading-key'] });
  });
  it('keeps whole UUID plot keys and resolves overlapping legacy plot prefixes to the longest id', () => {
    const id = '11111111-1111-1111-1111-111111111111';
    const rows = { [`${id}-task-uuid`]: {}, 'A-task': {}, 'A-1-task': {}, 'unrelated-task': {} };
    expect(filterSchedulesByPlot(rows, new Set([id, 'A', 'A-1']))).toEqual({ [`${id}-task-uuid`]: {}, 'A-task': {}, 'A-1-task': {} });
    expect(filterSchedulesByPlot({ 'A-1-task': { plot_id: 'A-1' } }, new Set(['A']))).toEqual({});
    expect(filterSchedulesByPlot({ 'A-1-task': {} }, new Set(['A']), new Set(['A', 'A-1']))).toEqual({});
  });
  it.each([null, {}, [null], [{ title: {} }], [{ title: 'risk', type: 'evm', severity: 'high', message: {}, recommendation: 'act' }]])('rejects malformed AI reports without inventing an empty report: %j', data => {
    expect(() => parseConstructionRiskAlerts(data)).toThrow('ข้อมูลรายงาน AI ไม่ถูกต้อง');
  });
  it('accepts valid insights and genuinely empty successful reports', () => {
    const valid = [{ title: 'risk', type: 'evm', severity: 'high', message: 'delay', recommendation: 'act' }];
    expect(parseConstructionRiskAlerts(valid)).toBe(valid);
    expect(parseConstructionRiskAlerts([])).toEqual([]);
  });
});
