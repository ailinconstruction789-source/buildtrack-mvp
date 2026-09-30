import { bookingRecord, bookingUuid } from './bookingContracts';
import { parseProjectMapSnapshot, type ProjectMapSnapshot } from './projectMapContracts';
import { parseExcelHouseDetails, type ExcelHouseDetails } from './excelHouseDetails';

export interface ExcelPlotCatalog {
  plotId: string; basePrice: number | null; appraisalPrice: number | null;
  isInfrastructure: boolean | null;
  houseDetails?: ExcelHouseDetails;
}
export interface ExcelVisitEvidence { key: string; customerId: string; visitDate: string; leadDate?: string }
export interface ExcelReportEvidence {
  contractVersion: 'excel_evidence_v1'; projectName: string; actor: ProjectMapSnapshot['actor'];
  legacyVisits: ExcelVisitEvidence[]; completedVisits: ExcelVisitEvidence[];
  unassignedLegacyVisits: ExcelVisitEvidence[]; unknownUnassignedLegacyDates: number;
  forecasts: { saleId: string; expectedTransferDate: string | null }[]; pendingLegacyRows: number; pendingLegacyKeys: string[]; unknownLegacyDates: number;
  bookingAmounts?: { saleId: string; tdPrice: number | null }[];
}
export interface ExcelReportProject { map: ProjectMapSnapshot; catalog: ExcelPlotCatalog[]; evidence: ExcelReportEvidence }
export interface ExcelReportData { projects: ExcelReportProject[]; loadedAt: string }
const bad = (): never => { throw new Error('ข้อมูลสรุปไม่ครบหรือไม่ตรงกัน กรุณาโหลดใหม่'); };
function money(value: unknown): number | null {
  return value === null ? null : typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : bad();
}
function day(value: unknown): string {
  if (typeof value !== 'string' || !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value))
    || new Date(value).toISOString().slice(0, 10) !== value) return bad();
  return value;
}
function bookingAmounts(value: unknown, map: ProjectMapSnapshot): { saleId: string; tdPrice: number | null }[] {
  const sales = new Set(map.salePages.flatMap(page => page.rows).map(sale => sale.saleId));
  if (!Array.isArray(value) || value.length !== sales.size || value.length > 10000) return bad();
  const seen = new Set<string>();
  return value.map(value => {
    const row = bookingRecord(value), saleId = bookingUuid(row.saleId);
    if (!sales.has(saleId) || seen.has(saleId)) return bad();
    seen.add(saleId);
    return { saleId, tdPrice: money(row.tdPrice) };
  });
}
/** Separate, project/actor-bound projection: raw sheet cells never leave the database. */
export function parseExcelBookingAmounts(value: unknown, map: ProjectMapSnapshot) {
  const raw = bookingRecord(value), actor = bookingRecord(raw.actor);
  if (raw.contractVersion !== 'excel_booking_amounts_v1' || raw.projectName !== map.projectName
    || actor.userId !== map.actor.userId || actor.role !== map.actor.role) return bad();
  return bookingAmounts(raw.rows, map);
}
export function parseExcelEvidence(value: unknown, map: ProjectMapSnapshot): ExcelReportEvidence {
  const raw = bookingRecord(value), actor = bookingRecord(raw.actor);
  if (raw.contractVersion !== 'excel_evidence_v1' || raw.projectName !== map.projectName
    || actor.userId !== map.actor.userId || actor.role !== map.actor.role
    || !Number.isSafeInteger(raw.pendingLegacyRows) || (raw.pendingLegacyRows as number) < 0
    || !Number.isSafeInteger(raw.unknownLegacyDates) || (raw.unknownLegacyDates as number) < 0
    || !Number.isSafeInteger(raw.unknownUnassignedLegacyDates) || (raw.unknownUnassignedLegacyDates as number) < 0) return bad();
  if (!Array.isArray(raw.pendingLegacyKeys) || raw.pendingLegacyKeys.length !== raw.pendingLegacyRows
    || raw.pendingLegacyKeys.length > 10000 || new Set(raw.pendingLegacyKeys).size !== raw.pendingLegacyKeys.length
    || raw.pendingLegacyKeys.some(key => typeof key !== 'string' || !key || key.length > 150)) return bad();
  const visits = (value: unknown, legacy: boolean): ExcelVisitEvidence[] => {
    if (!Array.isArray(value) || value.length > 10000) return bad();
    const seen = new Set<string>();
    return value.map(value => {
      const row = bookingRecord(value);
      if (typeof row.key !== 'string' || !row.key || row.key.length > 150 || seen.has(row.key)) return bad();
      seen.add(row.key); const visitDate = day(row.visitDate);
      if (legacy && day(row.leadDate) !== visitDate) return bad();
      return { key: row.key, customerId: bookingUuid(row.customerId), visitDate, ...(legacy ? { leadDate: visitDate } : {}) };
    });
  };
  if (!Array.isArray(raw.forecasts) || raw.forecasts.length > 10000) return bad();
  const sales = new Map(map.salePages.flatMap(page => page.rows).map(sale => [sale.saleId, sale])), seen = new Set<string>();
  const forecasts = raw.forecasts.map(value => {
    const row = bookingRecord(value), saleId = bookingUuid(row.saleId), sale = sales.get(saleId);
    if (seen.has(saleId) || !sale || ['cancelled', 'transferred', 'handover'].includes(sale.stage)) return bad();
    seen.add(saleId); return { saleId, expectedTransferDate: row.expectedTransferDate === null ? null : day(row.expectedTransferDate) };
  });
  return { contractVersion: 'excel_evidence_v1', projectName: map.projectName, actor: map.actor,
    legacyVisits: visits(raw.legacyVisits, true), completedVisits: visits(raw.completedVisits, false), forecasts,
    unassignedLegacyVisits: visits(raw.unassignedLegacyVisits, true), unknownUnassignedLegacyDates: raw.unknownUnassignedLegacyDates as number,
    ...(raw.bookingAmounts === undefined ? {} : { bookingAmounts: bookingAmounts(raw.bookingAmounts, map) }),
    pendingLegacyRows: raw.pendingLegacyRows as number, pendingLegacyKeys: raw.pendingLegacyKeys as string[], unknownLegacyDates: raw.unknownLegacyDates as number };
}
export function parseExcelReportProject(value: unknown, projectName: string): ExcelReportProject {
  const raw = bookingRecord(value), map = parseProjectMapSnapshot(raw.map, projectName);
  if (!Array.isArray(raw.catalog) || raw.catalog.length !== map.plots.length) return bad();
  const ids = new Set(map.plots.map(plot => plot.id)), seen = new Set<string>();
  const catalog = raw.catalog.map(value => {
    const row = bookingRecord(value);
    if (typeof row.plotId !== 'string' || !ids.has(row.plotId) || seen.has(row.plotId)
      || (row.isInfrastructure !== null && typeof row.isInfrastructure !== 'boolean')) return bad();
    seen.add(row.plotId);
    return { plotId: row.plotId, basePrice: money(row.basePrice), appraisalPrice: money(row.appraisalPrice),
      isInfrastructure: row.isInfrastructure as boolean | null,
      ...(row.houseDetails === undefined ? {} : { houseDetails: parseExcelHouseDetails(row.houseDetails) }) };
  });
  return { map, catalog, evidence: parseExcelEvidence(raw.evidence, map) };
}
