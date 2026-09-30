import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { readExcelHouseDetails } from '../excelHouseDetailsServer';
import { EXCEL_FOREMAN_TASKS } from '../excelHouseDetails';
function fixture() {
  const plots = [{ id: 'A-1', project_name: 'A', house_type_id: 'type-1', overview_image_url: 'https://example.com/1.jpg', house_model: null, house_types: { type_name: 'บ้าน A' },
    inspection_round1_date: '2026-09-29T18:00:00+00:00', inspection_round1_status: 'scheduled', inspection_round2_date: null, inspection_round2_status: 'pending' }];
  const task_templates = [0, 1, 2].map(i => ({ id: `t${i}`, house_type_id: 'type-1', task_name: EXCEL_FOREMAN_TASKS[i], cost: i === 0 ? 100 : 300, is_progress_counted: true }));
  const plot_task_assignments = [0, 1, 2].map(i => ({ id: i, plot_id: 'A-1', task_template_id: `t${i}`, current_progress: i === 0 ? 100 : 0, is_excluded: i === 2 }));
  return { plots, task_templates, plot_task_assignments };
}
function clientFor(rows: Record<string, unknown[]>, override?: (table: string, data: unknown[], start: number) => { count?: number; error?: unknown; data?: unknown[] }) {
  const projections: string[] = [], scopes: unknown[] = [];
  const client = { from: vi.fn((table: string) => {
    let start = 0, end = 499, filterIds: unknown[] = [], filterColumn = '';
    const chain = { select: vi.fn((selection: string, options: unknown) => { projections.push(selection); expect(options).toEqual({ count: 'exact' }); return chain; }),
      in: vi.fn((column: string, values: unknown[]) => { filterColumn = column; filterIds = values; scopes.push([table, column, values]); return chain; }),
      eq: vi.fn(() => chain), order: vi.fn(() => chain), abortSignal: vi.fn(() => chain),
      range: vi.fn((from: number, to: number) => { start = from; end = to; return chain; }),
      then: (resolve: (result: unknown) => unknown) => {
        const filtered = (rows[table] ?? []).filter(item => filterIds.includes((item as Record<string, unknown>)[filterColumn]));
        return Promise.resolve(resolve({ data: filtered.slice(start, end + 1), count: filtered.length, error: null, ...override?.(table, filtered, start) }));
      } };
    return chain;
  }) } as unknown as SupabaseClient;
  return { client, projections, scopes };
}
describe('read-only existing construction connector', () => {
  it('uses original cost-weighted counted progress and excludes tasks; maps Bangkok inspection dates', async () => {
    const mock = clientFor(fixture()); const result = (await readExcelHouseDetails(mock.client, 'A', ['A-1'])).get('A-1')!;
    expect(result.overallProgress).toBe(25);
    expect(result.tasks[2]).toMatchObject({ excluded: true, progress: null });
    expect(result.inspections).toEqual([{ date: '2026-09-30', status: 'scheduled' }, { date: null, status: 'pending' }]);
    expect(result.houseType).toBe('บ้าน A');
    expect(JSON.stringify(result)).not.toContain('cost');
    expect(mock.projections.join()).not.toContain('*');
    expect(mock.scopes).toContainEqual(['plots', 'id', ['A-1']]);
  });
  it('does not fabricate zero when assignments or counted templates are absent', async () => {
    for (const rows of [{ ...fixture(), plot_task_assignments: [] }, { ...fixture(), task_templates: [] }]) {
      const result = (await readExcelHouseDetails(clientFor(rows).client, 'A', ['A-1'])).get('A-1')!;
      expect(result.overallProgress).toBeNull();
    }
  });
  it('paginates beyond the server default and never silently accepts truncation', async () => {
    const rows = fixture();
    rows.task_templates = Array.from({ length: 501 }, (_, i) => ({ ...rows.task_templates[0], id: `t${i}`, is_progress_counted: false }));
    expect((await readExcelHouseDetails(clientFor(rows).client, 'A', ['A-1'])).size).toBe(1);
    const mock = clientFor(rows, (table, data) => table === 'task_templates' ? { data: data.slice(0, 10) } : {});
    await expect(readExcelHouseDetails(mock.client, 'A', ['A-1'])).rejects.toThrow();
  });
  it('rejects scope mismatches, partial plots, duplicate assignments, query errors and changed page counts', async () => {
    const wrongProject = fixture(); wrongProject.plots[0].project_name = 'B';
    const duplicate = fixture(); duplicate.plot_task_assignments.push(duplicate.plot_task_assignments[0]);
    for (const rows of [wrongProject, duplicate, { ...fixture(), plots: [] }]) await expect(readExcelHouseDetails(clientFor(rows).client, 'A', ['A-1'])).rejects.toThrow();
    await expect(readExcelHouseDetails(clientFor(fixture(), () => ({ error: { message: 'denied' } })).client, 'A', ['A-1'])).rejects.toThrow();
    const rows = fixture(); rows.task_templates = Array.from({ length: 501 }, (_, i) => ({ ...rows.task_templates[0], id: `t${i}` }));
    await expect(readExcelHouseDetails(clientFor(rows, (table, _, start) => table === 'task_templates' && start > 0 ? { count: 502 } : {}).client, 'A', ['A-1'])).rejects.toThrow();
  });
  it('does no reads for an empty project', async () => {
    const mock = clientFor({}); expect((await readExcelHouseDetails(mock.client, 'A', [])).size).toBe(0); expect(mock.client.from).not.toHaveBeenCalled();
  });
  it('keeps missing weighting/counting/exclusion metadata unknown', async () => {
    for (const [table, key] of [['task_templates', 'cost'], ['task_templates', 'is_progress_counted'], ['plot_task_assignments', 'is_excluded']] as const) {
      const rows = fixture(); (rows[table][0] as Record<string, unknown>)[key] = null;
      expect((await readExcelHouseDetails(clientFor(rows).client, 'A', ['A-1'])).get('A-1')!.overallProgress).toBeNull();
    }
  });
  it('allows blank optional type labels and rejects calendar rollover from invalid inspection dates', async () => {
    const rows = fixture(); rows.plots[0].house_types.type_name = '';
    rows.plots[0].inspection_round1_date = '2026-02-30T12:00:00Z';
    const result = (await readExcelHouseDetails(clientFor(rows).client, 'A', ['A-1'])).get('A-1')!;
    expect(result.houseType).toBeNull(); expect(result.inspections[0].date).toBeNull();
  });
});
