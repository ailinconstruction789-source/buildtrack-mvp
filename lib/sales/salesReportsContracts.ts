import { bookingRecord, bookingUuid } from './bookingContracts';
import { parseProjectSalesScope } from './projectSalesContracts';
import { SALE_STAGES, type CrmRole, type SaleStage } from './workflow';

export const SALES_REPORTS_CONTRACT_VERSION = 'sales_reports_v1';
export interface SalesReportScope { projectName: string | null; fromDate: string | null; toDate: string | null }
export interface SalesReportTotals {
  customers: number; interests: number; bookingRounds: number; cancelledRounds: number;
  netBookedHomes: number; inProgress: number; transferred: number;
  knownNetSaleValue: string; unknownNetSaleValueCount: number;
  unknownBookedAtRounds: number; unknownCancelledAtRounds: number;
}
export interface SalesReportSnapshot extends SalesReportScope {
  actor: { userId: string; role: CrmRole }; projects: { name: string }[];
  totals: SalesReportTotals; stageCounts: Record<SaleStage, number>;
  coverage: { unknownLeadDateCustomers: number; excludedUnknownLeadDateCustomers: number };
}
export class SalesReportsInputError extends Error {
  constructor() { super('โครงการหรือช่วงวันที่ Lead ไม่ถูกต้อง'); this.name = 'SalesReportsInputError'; }
}
const invalid = (): never => { throw new SalesReportsInputError(); };
function record(value: unknown): Record<string, unknown> { try { return bookingRecord(value); } catch { return invalid(); } }
function date(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return invalid();
  const [year, month, day] = value.split('-').map(Number);
  const days = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]) return invalid();
  return value;
}
export function parseSalesReportScope(value: unknown): SalesReportScope {
  const raw = record(value);
  if (Object.keys(raw).length !== 3 || !['projectName', 'fromDate', 'toDate'].every(key => Object.hasOwn(raw, key))) return invalid();
  let projectName: string | null;
  try { projectName = parseProjectSalesScope({ projectName: raw.projectName as string | null, tab: 'all', query: '', page: 0 }).projectName; }
  catch { return invalid(); }
  const fromDate = date(raw.fromDate), toDate = date(raw.toDate);
  if ((fromDate === null) !== (toDate === null) || (fromDate !== null && toDate !== null && fromDate > toDate)) return invalid();
  return { projectName, fromDate, toDate };
}
export function parseSalesReportQuery(url: string): SalesReportScope {
  const params = new URL(url).searchParams;
  for (const key of params.keys()) if (!['projectName', 'fromDate', 'toDate'].includes(key) || params.getAll(key).length !== 1) return invalid();
  return parseSalesReportScope({ projectName: params.get('projectName'), fromDate: params.get('fromDate'), toDate: params.get('toDate') });
}
export function parseSalesReportPageQuery(query: Record<string, string | string[] | undefined>): SalesReportScope {
  if (Object.keys(query).some(key => !['projectName', 'fromDate', 'toDate'].includes(key)) || Object.values(query).some(Array.isArray)) return invalid();
  return parseSalesReportScope({ projectName: query.projectName ?? null, fromDate: query.fromDate ?? null, toDate: query.toDate ?? null });
}
const count = (value: unknown): number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : invalid();
function amount(value: unknown): string {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,29})\.\d{2}$/.test(value)) return invalid();
  return value;
}
/** Preserve exact decimal sums instead of rounding large totals through JS Number. */
export function formatReportMoney(value: string): string {
  const [whole, fraction] = amount(value).split('.');
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fraction} บาท`;
}
/** Only explicit aggregate fields reach the browser. No customer, phone or income projection. */
export function parseSalesReportSnapshot(value: unknown, expected: SalesReportScope): SalesReportSnapshot {
  const scope = parseSalesReportScope(expected), raw = record(value), actor = record(raw.actor);
  if (raw.projectName !== scope.projectName || raw.fromDate !== scope.fromDate || raw.toDate !== scope.toDate
    || !['sales', 'admin', 'owner'].includes(actor.role as string) || !Array.isArray(raw.projects) || raw.projects.length > 1000) return invalid();
  const projects = raw.projects.map(project => {
    const name = record(project).name;
    const parsed = parseSalesReportScope({ projectName: name, fromDate: null, toDate: null }).projectName;
    if (parsed === null || parsed !== name) return invalid();
    return { name: parsed };
  });
  if (new Set(projects.map(project => project.name)).size !== projects.length
    || (scope.projectName !== null && !projects.some(project => project.name === scope.projectName))) return invalid();
  const values = record(raw.totals), stages = record(raw.stageCounts), coverage = record(raw.coverage);
  const totals: SalesReportTotals = {
    customers: count(values.customers), interests: count(values.interests), bookingRounds: count(values.bookingRounds),
    cancelledRounds: count(values.cancelledRounds), netBookedHomes: count(values.netBookedHomes),
    inProgress: count(values.inProgress), transferred: count(values.transferred), knownNetSaleValue: amount(values.knownNetSaleValue),
    unknownNetSaleValueCount: count(values.unknownNetSaleValueCount), unknownBookedAtRounds: count(values.unknownBookedAtRounds),
    unknownCancelledAtRounds: count(values.unknownCancelledAtRounds),
  };
  if (Object.keys(stages).length !== SALE_STAGES.length) return invalid();
  const stageCounts = Object.fromEntries(SALE_STAGES.map(stage => [stage, count(stages[stage])])) as Record<SaleStage, number>;
  const unknown = count(coverage.unknownLeadDateCustomers), excluded = count(coverage.excludedUnknownLeadDateCustomers);
  if (totals.bookingRounds !== SALE_STAGES.reduce((sum, stage) => sum + stageCounts[stage], 0)
    || totals.cancelledRounds !== stageCounts.cancelled
    || totals.netBookedHomes !== totals.bookingRounds - totals.cancelledRounds
    || totals.transferred !== stageCounts.transferred + stageCounts.handover
    || totals.inProgress !== totals.netBookedHomes - totals.transferred
    || totals.unknownNetSaleValueCount > totals.netBookedHomes
    || totals.unknownBookedAtRounds > totals.bookingRounds || totals.unknownCancelledAtRounds > totals.cancelledRounds
    || (totals.bookingRounds > 0 && (totals.customers === 0 || totals.interests === 0))
    || (totals.interests > 0 && totals.customers === 0)
    || (scope.projectName !== null && totals.interests !== totals.customers)
    || (totals.netBookedHomes === totals.unknownNetSaleValueCount && totals.knownNetSaleValue !== '0.00')
    || excluded !== (scope.fromDate === null ? 0 : unknown) || (scope.fromDate === null && unknown > totals.customers)) return invalid();
  return { ...scope, actor: { userId: bookingUuid(actor.userId), role: actor.role as CrmRole }, projects, totals, stageCounts,
    coverage: { unknownLeadDateCustomers: unknown, excludedUnknownLeadDateCustomers: excluded } };
}
