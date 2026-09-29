import { bookingRecord, bookingUuid } from './bookingContracts';
import { parseProjectSalesPageQuery, parseProjectSalesSnapshot, type ProjectSaleRow, type ProjectSalesSnapshot } from './projectSalesContracts';

export type ProjectMapStatus = 'available' | 'booked' | 'transferred' | 'unknown';
export type ProjectMapCellType = 'plot' | 'road' | 'park' | 'fence-h' | 'fence-v' | 'infra-h' | 'infra-v';
export interface ProjectMapCell { x: number; y: number; type: ProjectMapCellType; plotId?: string }
export interface ProjectMapLayout { cols: number; rows: number; cells: ProjectMapCell[] }
export interface ProjectMapPlot { id: string; name: string; hasCustomer: boolean | null; isCompleted: boolean | null; saleStatus: string | null }
export interface ProjectMapSnapshot {
  projectName: string; actor: ProjectSalesSnapshot['actor']; layout: ProjectMapLayout;
  plots: ProjectMapPlot[]; salePages: ProjectSalesSnapshot[];
}
export interface ProjectMapRegion {
  key: string; plotId: string | null; name: string; x: number; y: number; width: number; height: number;
  status: ProjectMapStatus; isCompleted: boolean | null; currentSale: ProjectSaleRow | null; history: ProjectSaleRow[];
}
export const PROJECT_MAP_MAX_PAGES = 100;
export const PROJECT_MAP_MAX_PLOTS = 2000;
const bad = (): never => { throw new Error('ข้อมูลผังโครงการไม่ครบหรือไม่ตรงกัน กรุณาโหลดใหม่'); };
const line = (value: unknown): string => typeof value === 'string' && value.trim() && value.length <= 300 ? value : bad();
const bool = (value: unknown): boolean | null => value === null || typeof value === 'boolean' ? value : bad();
const integer = (value: unknown, max: number, min = 0): number => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : bad();
const cellTypes: readonly string[] = ['plot', 'road', 'park', 'fence-h', 'fence-v', 'infra-h', 'infra-v'];

export function parseProjectMapName(value: unknown): string {
  if (typeof value !== 'string') return bad();
  return parseProjectSalesPageQuery({ projectName: value }).projectName ?? bad();
}
export function parseProjectMapLayout(value: unknown): ProjectMapLayout {
  const raw = bookingRecord(value), cols = integer(raw.cols, 200, 1), rows = integer(raw.rows, 200, 1);
  if (!Array.isArray(raw.cells) || raw.cells.length > Math.min(40000, cols * rows * cellTypes.length)) return bad();
  const seen = new Set<string>();
  const cells = raw.cells.map(value => {
    const c = bookingRecord(value), x = integer(c.x, cols - 1), y = integer(c.y, rows - 1);
    // Original maps layer fences/infrastructure over a plot or road. Only conflicting
    // base terrain or repeated cells within the same layer are invalid.
    const layer = ['plot', 'road', 'park'].includes(String(c.type)) ? 'base' : String(c.type);
    const key = `${x}:${y}:${layer}`;
    if (!cellTypes.includes(String(c.type)) || seen.has(key)) return bad();
    seen.add(key);
    return { x, y, type: c.type as ProjectMapCellType, ...(c.type === 'plot' ? { plotId: line(c.plotId) } : {}) };
  });
  return { cols, rows, cells };
}
/** Read only the original geometry, never regenerate or save a replacement layout. */
export function parseStoredProjectMapLayout(value: unknown): ProjectMapLayout {
  if (value === null) return { cols: 40, rows: 24, cells: [] };
  if (!Array.isArray(value) || value.length > 40001) return bad();
  const records = value.map(bookingRecord), configs = records.filter(c => c.type === 'config');
  if (configs.length > 1) return bad();
  return parseProjectMapLayout({ cols: configs[0]?.cols ?? 40, rows: configs[0]?.rows ?? 24, cells: records.filter(c => c.type !== 'config') });
}
export function parseProjectMapPlots(value: unknown): ProjectMapPlot[] {
  if (!Array.isArray(value) || value.length > PROJECT_MAP_MAX_PLOTS) return bad();
  const plots = value.map(value => {
    const p = bookingRecord(value);
    return { id: line(p.id), name: line(p.name), hasCustomer: bool(p.hasCustomer), isCompleted: bool(p.isCompleted),
      saleStatus: p.saleStatus === null ? null : line(p.saleStatus) };
  });
  if (new Set(plots.map(p => p.id)).size !== plots.length) return bad();
  return plots;
}
/** Both server and client validate every page; a partial history cannot paint vacant plots. */
export function parseProjectMapSnapshot(value: unknown, projectName: string): ProjectMapSnapshot {
  const raw = bookingRecord(value), actor = bookingRecord(raw.actor);
  if (raw.projectName !== projectName || !Array.isArray(raw.salePages) || !raw.salePages.length || raw.salePages.length > PROJECT_MAP_MAX_PAGES) return bad();
  const userId = bookingUuid(actor.userId), seen = new Set<string>();
  const salePages = raw.salePages.map((value, page) => {
    const parsed = parseProjectSalesSnapshot(value, { projectName, tab: 'all', query: '', page });
    if (parsed.actor.userId !== userId || parsed.actor.role !== actor.role || parsed.hasMore !== (page < (raw.salePages as unknown[]).length - 1)) return bad();
    for (const row of parsed.rows) { if (seen.has(row.saleId)) return bad(); seen.add(row.saleId); }
    return parsed;
  });
  return { projectName, actor: salePages[0].actor, layout: parseProjectMapLayout(raw.layout), plots: parseProjectMapPlots(raw.plots), salePages };
}

export function buildProjectMap(snapshot: ProjectMapSnapshot): { regions: ProjectMapRegion[]; unmappedPlots: ProjectMapRegion[] } {
  const sales = snapshot.salePages.flatMap(page => page.rows);
  const plots = new Map(snapshot.plots.map(plot => [plot.id, plot]));
  const bounds = new Map<string, { minX: number; minY: number; maxX: number; maxY: number }>();
  for (const cell of snapshot.layout.cells) {
    if (cell.type !== 'plot' || !cell.plotId) continue;
    const b = bounds.get(cell.plotId);
    if (!b) bounds.set(cell.plotId, { minX: cell.x, maxX: cell.x, minY: cell.y, maxY: cell.y });
    else { b.minX = Math.min(b.minX, cell.x); b.maxX = Math.max(b.maxX, cell.x); b.minY = Math.min(b.minY, cell.y); b.maxY = Math.max(b.maxY, cell.y); }
  }
  const region = (id: string): ProjectMapRegion => {
    const plot = plots.get(id), b = bounds.get(id);
    // Canonical ID and project only. Nicknames, leading zeroes and fuzzy names are not identity.
    const history = plot ? sales.filter(sale => sale.plotId === id && sale.projectName === snapshot.projectName) : [];
    const active = history.filter(sale => sale.stage !== 'cancelled');
    const currentSale = active.length === 1 ? active[0] : null;
    let status: ProjectMapStatus = 'unknown';
    if (plot && active.length === 0 && plot.hasCustomer === false && ['active', 'ready_for_sale'].includes(plot.saleStatus ?? '')) status = 'available';
    if (plot?.hasCustomer === true && currentSale) {
      const transferred = ['transferred', 'handover'].includes(currentSale.stage);
      if (transferred && plot.saleStatus === 'transferred') status = 'transferred';
      if (!transferred && ['active', 'ready_for_sale'].includes(plot.saleStatus ?? '')) status = 'booked';
    }
    return { key: id, plotId: plot?.id ?? null, name: plot?.name ?? id, x: b?.minX ?? 0, y: b?.minY ?? 0,
      width: b ? b.maxX - b.minX + 1 : 1, height: b ? b.maxY - b.minY + 1 : 1,
      status, isCompleted: plot?.isCompleted ?? null, currentSale, history };
  };
  return { regions: [...bounds.keys()].map(region), unmappedPlots: snapshot.plots.filter(p => !bounds.has(p.id)).map(p => region(p.id)) };
}
