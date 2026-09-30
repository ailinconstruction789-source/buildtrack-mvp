/** Server-side explicit reads using the caller's existing JWT/RLS. No privileged fallback or writes. */
import type { SupabaseClient } from '@supabase/supabase-js';
import { EXCEL_FOREMAN_TASKS, houseInspectionStatus, houseProgress, houseRecord, parseExcelHouseDetails, safeHouseImage, type ExcelHouseDetails } from './excelHouseDetails';

const PAGE = 500, CHUNK = 100, MAX_ROWS = 100000;
const fail = (): never => { throw new Error('EXCEL_HOUSE_READ_UNAVAILABLE'); };
const text = (value: unknown): string => typeof value === 'string' && value.trim().length > 0 && value.length <= 300 ? value : fail();
const optionalText = (value: unknown): string | null => value === null || typeof value === 'string' && !value.trim() ? null : text(value);
const chunks = (values: string[]): string[][] => Array.from({ length: Math.ceil(values.length / CHUNK) }, (_, i) => values.slice(i * CHUNK, (i + 1) * CHUNK));
function date(value: unknown): string | null {
  if (value === null || typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const day = value.slice(0, 10);
  if (!Number.isFinite(Date.parse(day)) || new Date(day).toISOString().slice(0, 10) !== day) return null;
  const ms = Date.parse(value); if (!Number.isFinite(ms)) return null;
  return new Date(ms + 7 * 3600000).toISOString().slice(0, 10);
}
async function readRows(client: SupabaseClient, table: string, select: string, column: string, ids: string[], projectName?: string, signal?: AbortSignal): Promise<Record<string, unknown>[]> {
  const output: Record<string, unknown>[] = [];
  for (const subset of chunks(ids)) {
    let expected: number | undefined;
    for (let start = 0; start < MAX_ROWS; start += PAGE) {
      let query = client.from(table).select(select, { count: 'exact' }).in(column, subset).order('id', { ascending: true }).range(start, start + PAGE - 1);
      if (projectName !== undefined) query = query.eq('project_name', projectName);
      if (signal) query = query.abortSignal(signal);
      const { data, error, count } = await query;
      if (error || !Array.isArray(data) || count === null || !Number.isInteger(count) || count < 0 || count > MAX_ROWS || (expected !== undefined && count !== expected)) return fail();
      expected = count;
      if (data.length !== Math.min(PAGE, Math.max(0, count - start))) fail();
      output.push(...data.map(houseRecord));
      if (output.length > MAX_ROWS) fail();
      if (start + data.length === count) break;
    }
  }
  return output;
}
export async function readExcelHouseDetails(client: SupabaseClient, projectName: string, plotIds: string[], signal?: AbortSignal): Promise<Map<string, ExcelHouseDetails>> {
  text(projectName);
  if (plotIds.length > 2000 || new Set(plotIds).size !== plotIds.length) fail();
  plotIds.forEach(text);
  if (plotIds.length === 0) return new Map();
  const requested = new Set(plotIds);
  const plots = await readRows(client, 'plots', 'id,project_name,house_type_id,overview_image_url,house_model,house_types(type_name),inspection_round1_date,inspection_round1_status,inspection_round2_date,inspection_round2_status', 'id', plotIds, projectName, signal);
  if (plots.length !== requested.size || new Set(plots.map(p => p.id)).size !== requested.size || plots.some(p => p.project_name !== projectName || !requested.has(text(p.id)))) fail();
  const typeIds = [...new Set(plots.map(p => optionalText(p.house_type_id)).filter((id): id is string => id !== null))];
  const [templates, assignments] = await Promise.all([
    readRows(client, 'task_templates', 'id,house_type_id,task_name,cost,is_progress_counted', 'house_type_id', typeIds, undefined, signal),
    readRows(client, 'plot_task_assignments', 'id,plot_id,task_template_id,current_progress,is_excluded', 'plot_id', plotIds, undefined, signal),
  ]);
  const templateIds = new Set<string>();
  for (const t of templates) {
    const id = text(t.id); text(t.task_name);
    if (templateIds.has(id) || !typeIds.includes(text(t.house_type_id)) || !(t.is_progress_counted === null || typeof t.is_progress_counted === 'boolean') || !(t.cost === null || typeof t.cost === 'number' && Number.isFinite(t.cost) && t.cost >= 0)) fail();
    templateIds.add(id);
  }
  const assignmentMap = new Map<string, Record<string, unknown>>();
  for (const a of assignments) {
    const key = `${text(a.plot_id)}\u0000${text(a.task_template_id)}`;
    if (!requested.has(a.plot_id as string) || assignmentMap.has(key) || !(a.is_excluded === null || typeof a.is_excluded === 'boolean')) fail();
    houseProgress(a.current_progress); assignmentMap.set(key, a);
  }
  return new Map(plots.map(p => {
    const all = templates.filter(t => t.house_type_id === p.house_type_id).map(t => ({ t, a: assignmentMap.get(`${p.id}\u0000${t.id}`) }));
    const counted = all.filter(({ t, a }) => t.is_progress_counted === true && a?.is_excluded !== true);
    let overallProgress: number | null = null;
    if (all.every(({ t }) => t.is_progress_counted !== null) && counted.length > 0 && counted.every(({ t, a }) => a && a.is_excluded === false && a.current_progress !== null && t.cost !== null)) {
      const cost = counted.reduce((sum, { t }) => sum + (t.cost as number), 0);
      const raw = cost > 0 ? counted.reduce((sum, { t, a }) => sum + (a!.current_progress as number) * (t.cost as number), 0) / cost
        : counted.reduce((sum, { a }) => sum + (a!.current_progress as number), 0) / counted.length;
      if (Number.isFinite(raw) && raw >= 0 && raw <= 100) overallProgress = Math.round(raw);
    }
    const relation = Array.isArray(p.house_types) ? p.house_types.length === 1 ? p.house_types[0] : null : p.house_types;
    const houseType = relation === null ? optionalText(p.house_model) : optionalText(houseRecord(relation).type_name) ?? optionalText(p.house_model);
    const details = parseExcelHouseDetails({ imageUrl: safeHouseImage(p.overview_image_url), houseType, overallProgress,
      tasks: EXCEL_FOREMAN_TASKS.map(name => {
        const matches = all.filter(({ t }) => t.task_name === name);
        const a = matches.length === 1 ? matches[0].a : undefined;
        return { name, progress: !a || a.is_excluded === true ? null : houseProgress(a.current_progress), excluded: a?.is_excluded ?? null };
      }),
      inspections: [1, 2].map(round => ({ date: date(p[`inspection_round${round}_date`]), status: houseInspectionStatus(p[`inspection_round${round}_status`]) })),
    });
    return [p.id as string, details];
  }));
}
