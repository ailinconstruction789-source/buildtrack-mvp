import { describe, expect, it } from 'vitest';
import { formatReportMoney, parseSalesReportPageQuery, parseSalesReportQuery, parseSalesReportScope, parseSalesReportSnapshot } from '../salesReportsContracts';
import { reportScope, reportSnapshot } from './salesReportsFixtures';

describe('aggregate report scope and projection', () => {
  it('null project means all-company including unassigned customers; defaults keep unknown dates', () => {
    expect(parseSalesReportQuery('https://test.invalid/')).toEqual(reportScope());
    expect(parseSalesReportPageQuery({})).toEqual(reportScope());
    expect(parseSalesReportSnapshot(reportSnapshot(), reportScope())).toEqual(reportSnapshot());
  });
  it.each(['0001-01-01', '2024-02-29', '2000-02-29', '2026-09-23', '9999-12-31'])('accepts exact calendar date %s', date => {
    const scope = reportScope({ fromDate: date, toDate: date });
    expect(parseSalesReportScope(scope)).toEqual(scope);
    expect(parseSalesReportSnapshot(reportSnapshot(scope), scope).coverage.excludedUnknownLeadDateCustomers).toBe(5);
  });
  it.each(['0000-01-01', '2026-02-29', '1900-02-29', '2026-04-31', '2026-13-01', '2026-00-01', '2026-01-00', '2026-1-01', '2026-01-01T00:00:00Z', ' 2026-01-01', '', 'infinity'])('rejects non-calendar value %s', date => {
    expect(() => parseSalesReportScope(reportScope({ fromDate: date, toDate: date }))).toThrow();
  });
  it.each([
    { fromDate: '2026-01-01' }, { toDate: '2026-01-01' }, { fromDate: '2026-02-01', toDate: '2026-01-01' },
    { projectName: '' }, { projectName: 'A\nB' }, { projectName: 5 }, { page: 1 },
  ])('rejects malformed/extra inputs %j', patch => {
    expect(() => parseSalesReportScope({ ...reportScope(), ...patch })).toThrow();
  });
  it.each(['?projectName=A&projectName=B', '?role=admin', '?fromDate=&toDate=', '?page=0'])('rejects ambiguous query %s', query => {
    expect(() => parseSalesReportQuery(`https://test.invalid/${query}`)).toThrow();
  });
  it('rejects repeated page params, preserves exact sums and strips unrelated raw data', () => {
    expect(() => parseSalesReportPageQuery({ projectName: ['A'] })).toThrow();
    const raw = { ...reportSnapshot(), income: 'private', customers: [{ phone: 'private' }] };
    expect(parseSalesReportSnapshot(raw, reportScope())).toEqual(reportSnapshot());
    expect(formatReportMoney('999999999999999.91')).toBe('999,999,999,999,999.91 บาท');
    expect(formatReportMoney('0.00')).toBe('0.00 บาท');
  });
  it.each(['1', '1.1', '1e3', '-1.00', 'NaN', '01.00', '1'.repeat(31) + '.00'])('rejects lossy/noncanonical money %s', value => {
    expect(() => parseSalesReportSnapshot({ ...reportSnapshot(), totals: { ...reportSnapshot().totals, knownNetSaleValue: value } }, reportScope())).toThrow();
  });
  it.each([
    { bookingRounds: 69 }, { cancelledRounds: 10 }, { netBookedHomes: 72 }, { inProgress: 60 }, { transferred: 10 },
    { customers: -1 }, { customers: 0 }, { customers: Number.MAX_SAFE_INTEGER + 1 }, { interests: 0 },
    { unknownNetSaleValueCount: 62 }, { unknownBookedAtRounds: 71 }, { unknownCancelledAtRounds: 10 },
  ])('rejects contradictory totals %j', patch => {
    const raw = reportSnapshot(); Object.assign(raw.totals, patch);
    expect(() => parseSalesReportSnapshot(raw, reportScope())).toThrow();
  });
  it('rejects missing stages, wrong role, scope, project list and cohort exclusion', () => {
    const raw = reportSnapshot();
    for (const bad of [
      { ...raw, stageCounts: { ...raw.stageCounts, made_up: 0 } }, { ...raw, stageCounts: {} },
      { ...raw, actor: { ...raw.actor, role: 'contractor' } }, { ...raw, projectName: 'โครงการ A' },
      { ...raw, projects: [...raw.projects, raw.projects[0]] },
      { ...raw, coverage: { unknownLeadDateCustomers: 5, excludedUnknownLeadDateCustomers: 5 } },
    ]) expect(() => parseSalesReportSnapshot(bad, reportScope())).toThrow();
    const scope = reportScope({ projectName: 'โครงการ A' }), selected = reportSnapshot(scope);
    selected.totals.interests++;
    expect(() => parseSalesReportSnapshot(selected, scope)).toThrow();
  });
});
