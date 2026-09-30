import { describe, expect, it } from 'vitest';
import { buildExcelReport, sumReportMoney, bangkokReportDay } from '../excelReportMetrics';
import { parseExcelReportProject, type ExcelReportData } from '../excelReportContracts';
import { projectMapSnapshot } from './projectMapFixtures';
import { pid, projectSale } from './projectSalesFixtures';

export function excelData(): ExcelReportData {
  const map = projectMapSnapshot();
  return { loadedAt: '2026-09-30T00:00:00Z', projects: [{ map, evidence: {
    contractVersion: 'excel_evidence_v1', projectName: map.projectName, actor: map.actor,
    legacyVisits: [], completedVisits: [], forecasts: [], pendingLegacyRows: 0, pendingLegacyKeys: [], unknownLegacyDates: 0,
    unassignedLegacyVisits: [], unknownUnassignedLegacyDates: 0,
  }, catalog: [
    { plotId: 'P-1', basePrice: 2000000, appraisalPrice: null, isInfrastructure: false },
    { plotId: 'P-2', basePrice: 2100000, appraisalPrice: 1000000, isInfrastructure: false },
  ] }] };
}
const report = (data = excelData()) => buildExcelReport(data, null, '2026-09-15', '2026');
describe('Excel report evidence and complete inventory', () => {
  it('does not turn missing money or dates into zero/defaults', () => {
    expect(sumReportMoney([100, null])).toBeNull(); expect(sumReportMoney([0, 100])).toBe(100);
    expect(report().unknownDates.booked).toBe(1); expect(report().monthly.booked).toHaveLength(0);
    expect(report().stocks[0].appraisalPrice).toBeNull();
  });
  it('uses Bangkok event days and excludes later days in the selected month', () => {
    const data = excelData();
    data.projects[0].map.salePages[0].rows = [projectSale({ bookedAt: '2026-09-15T18:00:00Z' })];
    expect(bangkokReportDay('2026-09-15T18:00:00Z')).toBe('2026-09-16');
    expect(report(data).monthly.booked).toHaveLength(0);
  });
  it('counts each round, removes cancellations from net bookings, preserves cancellation history', () => {
    const data = excelData();
    data.projects[0].map.salePages[0].rows = [projectSale({ bookedAt: '2026-09-01T01:00:00Z' }),
      projectSale({ saleId: pid(20), stage: 'cancelled', bookedAt: '2026-09-02T01:00:00Z', cancelledAt: '2026-09-03T01:00:00Z' })];
    const value = report(data); expect(value.rows).toHaveLength(2); expect(value.monthly.booked).toHaveLength(1);
    expect(value.monthly.cancelled).toHaveLength(1); expect(value.stocks[0].sale?.saleId).toBe(pid(1));
  });
  it('sums annual gross booking rounds including cancellations without changing net cohorts or charts', () => {
    const data = excelData(), project = data.projects[0];
    project.map.salePages[0].rows = [
      projectSale({ bookedAt: '2026-09-01T01:00:00Z', salePrice: 1990000 }),
      projectSale({ saleId: pid(20), stage: 'cancelled', bookedAt: '2026-09-02T01:00:00Z', cancelledAt: '2026-09-03T01:00:00Z', salePrice: 1800000 }),
    ];
    project.evidence.bookingAmounts = [{ saleId: pid(1), tdPrice: 900000 }, { saleId: pid(20), tdPrice: 800000 }];
    const value = report(data);
    expect(value.annualGross).toMatchObject({ salePrice: 3790000, tdPrice: 1700000, unknownSalePrices: 0, unknownTdPrices: 0, unknownBookingDates: 0 });
    expect(value.annualGross.rows).toHaveLength(2);
    expect(value.yearly.booked).toHaveLength(1); expect(value.yearly.cancelled).toHaveLength(1);
    expect(value.charts[8]).toMatchObject({ booked: 1, cumulativeBooked: 1 });
  });
  it('uses booking year and Bangkok cutoff, not cancellation or transfer year, for annual gross totals', () => {
    const data = excelData(), project = data.projects[0];
    project.map.salePages[0].rows = [
      projectSale({ stage: 'cancelled', bookedAt: '2025-12-31T16:59:59Z', cancelledAt: '2026-09-02T01:00:00Z', salePrice: 100 }),
      projectSale({ saleId: pid(20), stage: 'cancelled', bookedAt: '2025-12-31T17:00:00Z', cancelledAt: '2027-01-02T01:00:00Z', salePrice: 200 }),
      projectSale({ saleId: pid(21), bookedAt: '2026-09-15T17:00:00Z', salePrice: 300 }),
      projectSale({ saleId: pid(22), bookedAt: null, stage: 'transferred', salePrice: 400,
        importedHistory: { source: 'customer_sheet', batchId: pid(30), sourceRow: 2, sourceStage: 'transferred', bookedDate: '2026-09-15', cancelledDate: null, transferredDate: '2026-09-15' } }),
    ];
    project.evidence.bookingAmounts = project.map.salePages[0].rows.map(sale => ({ saleId: sale.saleId, tdPrice: 10 }));
    const value = buildExcelReport(data, null, '2026-09-15', '2025');
    expect(value.annualGross.rows.map(row => row.sale.saleId)).toEqual([pid(20), pid(22)]);
    expect(value.annualGross.salePrice).toBe(600); expect(value.annualGross.tdPrice).toBe(20);
  });
  it('keeps missing annual monetary evidence unknown without substituting catalog prices or zero', () => {
    const data = excelData(), project = data.projects[0];
    project.map.salePages[0].rows = [projectSale({ bookedAt: '2026-09-01T01:00:00Z', salePrice: null }),
      projectSale({ saleId: pid(20), stage: 'cancelled', bookedAt: '2026-09-02T01:00:00Z', salePrice: 0 })];
    project.evidence.bookingAmounts = [{ saleId: pid(20), tdPrice: 0 }];
    expect(report(data).annualGross).toMatchObject({ salePrice: null, tdPrice: null, unknownSalePrices: 1, unknownTdPrices: 1 });
    project.map.salePages[0].rows.shift();
    expect(report(data).annualGross).toMatchObject({ salePrice: 0, tdPrice: 0, unknownSalePrices: 0, unknownTdPrices: 0 });
    delete project.evidence.bookingAmounts;
    expect(report(data).annualGross.tdPrice).toBeNull();
  });
  it('discloses missing booking dates for cancelled rounds and respects project filters', () => {
    const data = excelData(), first = data.projects[0];
    first.map.salePages[0].rows = [projectSale({ bookedAt: null, stage: 'cancelled' })];
    const other = structuredClone(first); other.map.projectName = 'B';
    other.map.salePages[0].rows = [projectSale({ saleId: pid(20), projectName: 'B', bookedAt: '2026-09-01T01:00:00Z', salePrice: 100 })];
    other.evidence.bookingAmounts = [{ saleId: pid(20), tdPrice: 10 }]; data.projects.push(other);
    expect(report(data).annualGross).toMatchObject({ salePrice: 100, tdPrice: 10, unknownBookingDates: 1 });
    expect(report(data).unknownDates.booked).toBe(0);
    expect(buildExcelReport(data, 'B', '2026-09-15', '2026').annualGross).toMatchObject({ salePrice: 100, tdPrice: 10, unknownBookingDates: 0 });
    expect(buildExcelReport(data, first.map.projectName, '2026-09-15', '2026').annualGross.rows).toHaveLength(0);
  });
  it('uses source civil transfer date without substituting booking date', () => {
    const data = excelData(); const sale = projectSale({ stage: 'transferred', bookedAt: null, bookingRound: null,
      importedHistory: { source: 'customer_sheet', batchId: pid(30), sourceRow: 2, sourceStage: 'transferred', bookedDate: '2026-08-01', cancelledDate: null, transferredDate: '2026-09-10' } });
    data.projects[0].map.salePages[0].rows = [sale]; data.projects[0].map.plots[0].saleStatus = 'transferred';
    expect(report(data).monthly.transferred).toHaveLength(1);
    sale.importedHistory!.transferredDate = null;
    expect(report(data).unknownDates.transferred).toBe(1); expect(report(data).monthly.transferred).toHaveLength(0);
  });
  it('keeps sold-out projects and conflicts unknown, excludes confirmed infrastructure', () => {
    const data = excelData(); data.projects[0].catalog[1].isInfrastructure = true;
    expect(report(data).groups).toHaveLength(1); expect(report(data).stocks).toHaveLength(1);
    data.projects[0].map.salePages[0].rows.push(projectSale({ saleId: pid(33) }));
    expect(report(data).unknownStock).toBe(1); expect(report(data).stocks[0].sale).toBeNull();
  });
  it('keeps unknown house types unknown instead of vacant', () => {
    const data = excelData(); data.projects[0].catalog[1].isInfrastructure = null;
    expect(report(data).stocks[1].status).toBe('unknown');
  });
  it('validates catalog coverage and numbers', () => {
    const project = excelData().projects[0];
    expect(parseExcelReportProject(project, 'โครงการ A')).toEqual(project);
    expect(() => parseExcelReportProject({ ...project, catalog: [] }, 'โครงการ A')).toThrow();
    project.catalog[0].basePrice = -1;
    expect(() => parseExcelReportProject(project, 'โครงการ A')).toThrow();
  });
  it('uses A as legacy visit and Lead day, Q only as forecast, and preserves held rows separately', () => {
    const data = excelData(), project = data.projects[0], sale = project.map.salePages[0].rows[0];
    project.evidence.legacyVisits = [{ key: 'batch:2', customerId: sale.customerId, visitDate: '2026-09-02', leadDate: '2026-09-02' }];
    project.evidence.completedVisits = [{ key: 'visit:1', customerId: sale.customerId, visitDate: '2026-09-10' }];
    project.evidence.forecasts = [{ saleId: sale.saleId, expectedTransferDate: '2026-09-30' }];
    project.evidence.pendingLegacyRows = 6;
    project.evidence.pendingLegacyKeys = ['batch:3', 'batch:4', 'batch:5', 'batch:6', 'batch:7', 'batch:8'];
    const value = report(data);
    expect(value.monthly.visits).toHaveLength(2); expect(value.legacyVisits).toBe(1); expect(value.completedVisits).toBe(1);
    expect(value.rows[0].leadDate).toBe('2026-09-02'); expect(value.forecast).toHaveLength(1);
    expect(value.monthly.transferred).toHaveLength(0); expect(value.pendingLegacyRows).toBe(6);
    expect(value.charts[9].visits).toBeNull(); expect(value.charts[9].cumulativeVisits).toBeNull();
    expect(value.charts[8].cumulativeVisits).toBe(2);
  });
  it('does not double count a legacy source row shared across projects', () => {
    const data = excelData(), first = data.projects[0];
    first.evidence.legacyVisits = [{ key: 'batch:2', customerId: pid(2), visitDate: '2026-09-02', leadDate: '2026-09-02' }];
    const other = structuredClone(first); other.map.projectName = 'B'; data.projects.push(other);
    expect(report(data).monthly.visits).toHaveLength(1);
    other.evidence.legacyVisits[0].visitDate = '2026-09-03'; expect(() => report(data)).toThrow('Conflicting');
  });
  it('rejects mismatched legacy days, forecast sale IDs, and identity', () => {
    const project = excelData().projects[0];
    project.evidence.legacyVisits = [{ key: 'batch:2', customerId: pid(2), visitDate: '2026-09-02', leadDate: '2026-09-03' }];
    expect(() => parseExcelReportProject(project, project.map.projectName)).toThrow();
    project.evidence.legacyVisits = []; project.evidence.forecasts = [{ saleId: pid(99), expectedTransferDate: null }];
    expect(() => parseExcelReportProject(project, project.map.projectName)).toThrow();
    project.evidence.forecasts = []; project.evidence.actor = { ...project.map.actor, userId: pid(99) };
    expect(() => parseExcelReportProject(project, project.map.projectName)).toThrow();
  });
  it('includes old visits without a project only in the all-project total, once', () => {
    const data = excelData();
    data.projects[0].evidence.unassignedLegacyVisits = [{ key: 'batch:9', customerId: pid(9), visitDate: '2026-09-01', leadDate: '2026-09-01' }];
    data.projects.push(structuredClone(data.projects[0])); data.projects[1].map.projectName = 'B';
    expect(report(data).monthly.visits).toHaveLength(1); expect(report(data).unassignedLegacyVisits).toBe(1);
    expect(buildExcelReport(data, 'B', '2026-09-15', '2026').monthly.visits).toHaveLength(0);
  });
});
