import { bookingRecord, bookingUuid } from './bookingContracts';
import { parseEvidenceTimestamp } from './leadEvidence';
import { SALE_STAGES, type CrmRole, type SaleStage } from './workflow';
import { assertImportedBookingRow, parseImportedBookingHistory, type ImportedBookingHistory } from './importedBookingHistory';

export const PROJECT_SALES_CONTRACT_VERSION = 'project_sales_v1';
export const PROJECT_SALES_TABS = ['booked', 'transferred', 'cancelled', 'all'] as const;
export type ProjectSalesTab = typeof PROJECT_SALES_TABS[number];
export interface ProjectSalesScope { projectName: string | null; tab: ProjectSalesTab; query: string; page: number }
export interface ProjectSaleRow {
  saleId: string; customerId: string; customerName: string; phone: string | null; interestId: string;
  projectName: string; ownerUserId: string; ownerName: string; plotId: string | null; plotName: string | null;
  stage: SaleStage; bookingRound: number | null; previousSaleId: string | null; bookedAt: string | null; cancelledAt: string | null;
  cancellationReason: string | null; listPrice: number | null; discountAmount: number | null; salePrice: number | null;
  depositAmount: number | null; paymentMethod: 'cash' | 'mortgage' | null;
  importedHistory?: ImportedBookingHistory;
  historyEvidence?: { sourceRow: number; bookedDate: string | null; cancelledDate: string | null; transferredDate: string | null; held: boolean };
}
export interface ProjectSalesSnapshot extends ProjectSalesScope {
  actor: { userId: string; role: CrmRole }; projects: { name: string }[]; hasMore: boolean; rows: ProjectSaleRow[];
  prepared?: { batchId: string; snapshotDate: string; pendingUnlinkedHistories: number };
}
export class ProjectSalesInputError extends Error {
  constructor() { super('ข้อมูลโครงการหรือตัวกรองไม่ถูกต้อง กรุณาเลือกใหม่'); this.name = 'ProjectSalesInputError'; }
}
function invalid(): never { throw new ProjectSalesInputError(); }
function line(value: unknown, empty = false): string {
  if (typeof value !== 'string') return invalid();
  const normalized = value.trim();
  if ((!empty && !normalized) || Array.from(normalized).length > 200 || Array.from(value).some(char => {
    const code = char.charCodeAt(0);
    return code <= 31 || (code >= 127 && code <= 159) || code === 0x2028 || code === 0x2029
      || (char.length === 1 && code >= 0xd800 && code <= 0xdfff);
  })) return invalid();
  return normalized;
}
function tab(value: unknown): ProjectSalesTab {
  if (typeof value !== 'string' || !PROJECT_SALES_TABS.includes(value as ProjectSalesTab)) return invalid();
  return value as ProjectSalesTab;
}
export function parseProjectSalesScope(value: ProjectSalesScope): ProjectSalesScope {
  const raw = bookingRecord(value);
  if (Object.keys(raw).length !== 4 || !['projectName', 'tab', 'query', 'page'].every(key => Object.hasOwn(raw, key))) return invalid();
  const projectName = raw.projectName === null ? null : line(raw.projectName), query = line(raw.query, true);
  if ((query && Array.from(query).length < 2) || typeof raw.page !== 'number' || !Number.isInteger(raw.page) || raw.page < 0 || raw.page > 100000
    || (projectName === null && (query !== '' || raw.page !== 0))) return invalid();
  return { projectName, tab: tab(raw.tab), query, page: raw.page };
}
export function parseProjectSalesQuery(url: string): ProjectSalesScope {
  const params = new URL(url).searchParams;
  for (const key of params.keys()) if (!['projectName', 'tab', 'q', 'page'].includes(key) || params.getAll(key).length !== 1) return invalid();
  const page = params.get('page') ?? '0';
  if (!/^(0|[1-9]\d{0,5})$/.test(page)) return invalid();
  return parseProjectSalesScope({ projectName: params.has('projectName') ? line(params.get('projectName')) : null,
    tab: tab(params.get('tab') ?? 'booked'), query: params.get('q') ?? '', page: Number(page) });
}
export function parseProjectSalesPageQuery(query: Record<string, string | string[] | undefined>): Pick<ProjectSalesScope, 'projectName' | 'tab'> {
  if (Object.keys(query).some(key => !['projectName', 'tab'].includes(key)) || Array.isArray(query.projectName) || Array.isArray(query.tab)) return invalid();
  return { projectName: query.projectName === undefined ? null : line(query.projectName), tab: tab(query.tab ?? 'booked') };
}
export function stageInProjectSalesTab(stage: SaleStage, selected: ProjectSalesTab): boolean {
  if (selected === 'all') return true;
  if (selected === 'cancelled') return stage === 'cancelled';
  if (selected === 'transferred') return stage === 'transferred' || stage === 'handover';
  return !['cancelled', 'transferred', 'handover'].includes(stage);
}
const string = (value: unknown): string => typeof value === 'string' ? value : invalid();
const nullableString = (value: unknown) => value === null ? null : string(value);
function nullableTime(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || /\s/u.test(value) || parseEvidenceTimestamp(value) === null) return invalid();
  return value;
}
function money(value: unknown): number | null {
  if (value === null) return null;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : invalid();
}
/** Explicit output projection: never pass arbitrary database columns to the browser. */
export function parseProjectSalesSnapshot(value: unknown, scope: ProjectSalesScope): ProjectSalesSnapshot {
  return parseSnapshot(value, scope, false);
}
/** Operator-only preparation reader. Never used by the operational API/client. */
export function parsePreparedProjectSalesSnapshot(value: unknown, scope: ProjectSalesScope): ProjectSalesSnapshot {
  return parseSnapshot(value, scope, true);
}
function day(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)
    || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) return invalid();
  return value;
}
function parseSnapshot(value: unknown, scope: ProjectSalesScope, allowPrepared: boolean): ProjectSalesSnapshot {
  const raw = bookingRecord(value), actor = bookingRecord(raw.actor);
  let prepared: ProjectSalesSnapshot['prepared'];
  if (allowPrepared) {
    const info = bookingRecord(raw.prepared), snapshotDate = day(info.snapshotDate);
    if (actor.role !== 'admin' || snapshotDate === null || !Number.isSafeInteger(info.pendingUnlinkedHistories)
      || (info.pendingUnlinkedHistories as number) < 0) return invalid();
    prepared = { batchId: bookingUuid(info.batchId), snapshotDate, pendingUnlinkedHistories: info.pendingUnlinkedHistories as number };
  } else if (raw.prepared !== undefined) return invalid();
  if (!['sales', 'admin', 'owner'].includes(string(actor.role)) || !Array.isArray(raw.projects) || raw.projects.length > 1000
    || !Array.isArray(raw.rows) || raw.rows.length > 50 || typeof raw.hasMore !== 'boolean') return invalid();
  if (raw.projectName !== scope.projectName || raw.tab !== scope.tab || raw.query !== scope.query || raw.page !== scope.page) return invalid();
  const projects = raw.projects.map(value => ({ name: line(bookingRecord(value).name) }));
  if (new Set(projects.map(project => project.name)).size !== projects.length
    || (scope.projectName !== null && !projects.some(project => project.name === scope.projectName))) return invalid();
  const rows: ProjectSaleRow[] = raw.rows.map(value => {
    const item = bookingRecord(value), stage = string(item.stage) as SaleStage;
    if (!SALE_STAGES.includes(stage) || !stageInProjectSalesTab(stage, scope.tab) || item.projectName !== scope.projectName
      || (item.plotId === null && stage !== 'cancelled')
      || ![null, 'cash', 'mortgage'].includes(item.paymentMethod as string | null)) return invalid();
    const importedHistory = parseImportedBookingHistory(item.importedHistory);
    if (prepared && importedHistory) return invalid();
    if (!prepared) assertImportedBookingRow(item, importedHistory);
    let historyEvidence: ProjectSaleRow['historyEvidence'];
    if (prepared) {
      const evidence = bookingRecord(item.historyEvidence);
      if (!['booked', 'transferred', 'cancelled'].includes(stage) || item.bookingRound !== null
        || item.previousSaleId !== null || item.bookedAt !== null || item.cancelledAt !== null
        || item.listPrice !== null || item.discountAmount !== null
        || !Number.isSafeInteger(evidence.sourceRow) || (evidence.sourceRow as number) < 2
        || typeof evidence.held !== 'boolean' || (item.plotId === null && !evidence.held)) return invalid();
      historyEvidence = { sourceRow: evidence.sourceRow as number, bookedDate: day(evidence.bookedDate),
        cancelledDate: day(evidence.cancelledDate), transferredDate: day(evidence.transferredDate), held: evidence.held };
    } else if (item.historyEvidence !== undefined) return invalid();
    return { saleId: bookingUuid(item.saleId), customerId: bookingUuid(item.customerId), customerName: string(item.customerName),
      phone: nullableString(item.phone), interestId: bookingUuid(item.interestId), projectName: string(item.projectName),
      ownerUserId: bookingUuid(item.ownerUserId), ownerName: string(item.ownerName), plotId: nullableString(item.plotId), plotName: nullableString(item.plotName),
      stage, bookingRound: item.bookingRound as number | null, previousSaleId: item.previousSaleId === null ? null : bookingUuid(item.previousSaleId),
      bookedAt: nullableTime(item.bookedAt), cancelledAt: nullableTime(item.cancelledAt), cancellationReason: nullableString(item.cancellationReason),
      listPrice: money(item.listPrice), discountAmount: money(item.discountAmount), salePrice: money(item.salePrice), depositAmount: money(item.depositAmount),
      paymentMethod: item.paymentMethod as 'cash' | 'mortgage' | null, ...(historyEvidence ? { historyEvidence } : {}),
      ...(importedHistory ? { importedHistory } : {}) };
  });
  if (new Set(rows.map(row => row.saleId)).size !== rows.length || (raw.hasMore && rows.length !== 50)
    || (scope.projectName === null && (rows.length !== 0 || raw.hasMore))) return invalid();
  return { ...scope, actor: { userId: bookingUuid(actor.userId), role: actor.role as CrmRole }, projects, rows, hasMore: raw.hasMore,
    ...(prepared ? { prepared } : {}) };
}
