import { buildProjectMap, type ProjectMapStatus } from './projectMapContracts';
import type { ProjectSaleRow } from './projectSalesContracts';
import type { ExcelReportData } from './excelReportContracts';
import type { ExcelHouseDetails } from './excelHouseDetails';

export interface ExcelSaleRow { sale: ProjectSaleRow; bookedDate: string | null; cancelledDate: string | null; transferredDate: string | null; expectedTransferDate: string | null; leadDate: string | null; houseDetails?: ExcelHouseDetails; tdPrice?: number | null }
export interface ExcelStockRow {
  projectName: string; plotId: string; plotName: string; status: ProjectMapStatus; sale: ProjectSaleRow | null;
  basePrice: number | null; appraisalPrice: number | null; transferredDate: string | null; expectedTransferDate: string | null;
}
export interface ExcelProjectGroup {
  projectName: string; total: number; available: number; booked: number; transferred: number; unknown: number; stocks: ExcelStockRow[];
}
export function bangkokReportDay(timestamp: string): string {
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) throw new Error('Invalid event time');
  return new Date(parsed + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
export const formatReportMoney = (value: number | null): string => value === null ? 'ไม่ทราบ' : new Intl.NumberFormat('th-TH', {
  style: 'currency', currency: 'THB', maximumFractionDigits: 2,
}).format(value);
export function sumReportMoney(values: (number | null)[]): number | null {
  if (values.some(value => value === null)) return null;
  return (values as number[]).reduce((sum, value) => sum + value, 0);
}
function eventDates(sale: ProjectSaleRow): ExcelSaleRow {
  return { sale,
    expectedTransferDate: null, leadDate: null,
    bookedDate: sale.bookedAt ? bangkokReportDay(sale.bookedAt) : sale.importedHistory?.bookedDate ?? null,
    cancelledDate: sale.cancelledAt ? bangkokReportDay(sale.cancelledAt) : sale.importedHistory?.cancelledDate ?? null,
    // The current API has no runtime transfer timestamp. Never use a booking/import timestamp instead.
    transferredDate: ['transferred', 'handover'].includes(sale.stage) ? sale.importedHistory?.transferredDate ?? null : null };
}
export function buildExcelReport(data: ExcelReportData, projectName: string | null, cutoff: string, cumulativeYear: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cutoff) || !Number.isFinite(Date.parse(cutoff))
    || new Date(cutoff).toISOString().slice(0, 10) !== cutoff || !/^\d{4}$/.test(cumulativeYear)) throw new Error('Invalid report date');
  const projects = data.projects.filter(project => projectName === null || project.map.projectName === projectName);
  const leadDates = new Map<string, string>();
  for (const project of data.projects) for (const visit of [...project.evidence.legacyVisits, ...project.evidence.unassignedLegacyVisits]) {
    const prior = leadDates.get(visit.customerId);
    if (visit.leadDate && (!prior || visit.leadDate < prior)) leadDates.set(visit.customerId, visit.leadDate);
  }
  const rows: ExcelSaleRow[] = projects.flatMap(project => project.map.salePages.flatMap(page => page.rows).map(sale => ({ ...eventDates(sale),
    houseDetails: project.catalog.find(row => row.plotId === sale.plotId)?.houseDetails,
    tdPrice: project.evidence.bookingAmounts?.find(row => row.saleId === sale.saleId)?.tdPrice ?? null,
    expectedTransferDate: project.evidence.forecasts.find(row => row.saleId === sale.saleId)?.expectedTransferDate ?? null,
    leadDate: leadDates.get(sale.customerId) ?? null })));
  const visitMap = new Map<string, { key: string; visitDate: string; legacy: boolean }>();
  for (const project of projects) for (const [legacy, entries] of [[true, [...project.evidence.legacyVisits, ...(projectName === null ? project.evidence.unassignedLegacyVisits : [])]], [false, project.evidence.completedVisits]] as const) {
    for (const entry of entries) {
      const key = `${legacy ? 'legacy' : 'live'}:${entry.key}`, existing = visitMap.get(key);
      if (existing && existing.visitDate !== entry.visitDate) throw new Error('Conflicting visit evidence');
      visitMap.set(key, { key, visitDate: entry.visitDate, legacy });
    }
  }
  const visits = [...visitMap.values()];
  const stocks: ExcelStockRow[] = projects.flatMap(project => {
    const map = buildProjectMap(project.map), regions = [...map.regions, ...map.unmappedPlots];
    return project.catalog.filter(catalog => catalog.isInfrastructure !== true).map(catalog => {
      const region = regions.find(region => region.plotId === catalog.plotId);
      if (!region) throw new Error('Missing plot inventory');
      return { projectName: project.map.projectName, plotId: catalog.plotId, plotName: region.name,
        status: catalog.isInfrastructure === null ? 'unknown' as const : region.status,
        sale: region.currentSale, basePrice: catalog.basePrice, appraisalPrice: catalog.appraisalPrice,
        transferredDate: region.currentSale ? eventDates(region.currentSale).transferredDate : null,
        expectedTransferDate: region.currentSale ? rows.find(row => row.sale.saleId === region.currentSale!.saleId)?.expectedTransferDate ?? null : null };
    });
  });
  const groups: ExcelProjectGroup[] = projects.map(project => {
    const members = stocks.filter(stock => stock.projectName === project.map.projectName);
    return { projectName: project.map.projectName, total: members.length, stocks: members,
      available: members.filter(row => row.status === 'available').length,
      booked: members.filter(row => row.status === 'booked').length,
      transferred: members.filter(row => row.status === 'transferred').length,
      unknown: members.filter(row => row.status === 'unknown').length };
  });
  const eligible = {
    booked: rows.filter(row => row.sale.stage !== 'cancelled'),
    cancelled: rows.filter(row => row.sale.stage === 'cancelled'),
    transferred: rows.filter(row => ['transferred', 'handover'].includes(row.sale.stage)),
  };
  const filter = (prefix: string) => ({
    booked: eligible.booked.filter(row => row.bookedDate && row.bookedDate.startsWith(prefix) && row.bookedDate <= cutoff),
    cancelled: eligible.cancelled.filter(row => row.cancelledDate && row.cancelledDate.startsWith(prefix) && row.cancelledDate <= cutoff),
    transferred: eligible.transferred.filter(row => row.transferredDate && row.transferredDate.startsWith(prefix) && row.transferredDate <= cutoff),
    visits: visits.filter(row => row.visitDate.startsWith(prefix) && row.visitDate <= cutoff),
  });
  const charts = Array.from({ length: 12 }, (_, index) => {
    const prefix = `${cumulativeYear}-${String(index + 1).padStart(2, '0')}`;
    if (`${prefix}-01` > cutoff) return { month: `${index + 1}/${cumulativeYear}`, booked: null, cancelled: null,
      transferred: null, visits: null, cumulativeVisits: null, cumulativeBooked: null, cumulativeTransferred: null };
    const month = filter(prefix), upper = `${prefix}-31` < cutoff ? `${prefix}-31` : cutoff;
    return { month: `${index + 1}/${cumulativeYear}`, booked: month.booked.length, cancelled: month.cancelled.length,
      transferred: month.transferred.length, visits: month.visits.length,
      cumulativeVisits: visits.filter(row => row.visitDate.startsWith(cumulativeYear) && row.visitDate <= upper).length,
      cumulativeBooked: eligible.booked.filter(row => row.bookedDate?.startsWith(cumulativeYear) && row.bookedDate <= upper).length,
      cumulativeTransferred: eligible.transferred.filter(row => row.transferredDate?.startsWith(cumulativeYear) && row.transferredDate <= upper).length };
  });
  const awaiting = rows.filter(row => !['cancelled', 'transferred', 'handover'].includes(row.sale.stage));
  // Gross annual sales count booking rounds, including cancelled rounds, independently of net KPI/chart cohorts.
  const annualGrossRows = rows.filter(row => row.bookedDate?.startsWith(cutoff.slice(0, 4)) && row.bookedDate <= cutoff);
  const annualGross = { rows: annualGrossRows,
    salePrice: sumReportMoney(annualGrossRows.map(row => row.sale.salePrice)),
    tdPrice: sumReportMoney(annualGrossRows.map(row => row.tdPrice ?? null)),
    unknownSalePrices: annualGrossRows.filter(row => row.sale.salePrice === null).length,
    unknownTdPrices: annualGrossRows.filter(row => row.tdPrice == null).length,
    // These rounds cannot be assigned to any year; do not hide cancelled rounds with missing dates.
    unknownBookingDates: rows.filter(row => !row.bookedDate).length };
  return { rows, stocks, groups, annualGross, monthly: filter(cutoff.slice(0, 7)), yearly: filter(cutoff.slice(0, 4)), charts,
    forecast: awaiting.filter(row => row.expectedTransferDate?.startsWith(cutoff.slice(0, 7))),
    carriedOver: awaiting.filter(row => row.expectedTransferDate && row.expectedTransferDate < `${cutoff.slice(0, 7)}-01`),
    unknownForecast: awaiting.filter(row => !row.expectedTransferDate).length,
    legacyVisits: visits.filter(row => row.legacy).length, completedVisits: visits.filter(row => !row.legacy).length,
    unassignedLegacyVisits: projectName === null ? new Set(projects.flatMap(project => project.evidence.unassignedLegacyVisits.map(visit => visit.key))).size : 0,
    pendingLegacyRows: new Set(projects.flatMap(project => project.evidence.pendingLegacyKeys)).size,
    unknownLegacyDates: projects.reduce((sum, project) => sum + project.evidence.unknownLegacyDates, 0)
      + (projectName === null ? Math.max(0, ...projects.map(project => project.evidence.unknownUnassignedLegacyDates)) : 0),
    unknownDates: { booked: eligible.booked.filter(row => !row.bookedDate).length,
      cancelled: eligible.cancelled.filter(row => !row.cancelledDate).length,
      transferred: eligible.transferred.filter(row => !row.transferredDate).length },
    unknownStock: stocks.filter(row => row.status === 'unknown').length };
}
