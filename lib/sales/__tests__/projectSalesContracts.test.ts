import { describe, expect, it } from 'vitest';
import { parseProjectSalesPageQuery, parseProjectSalesQuery, parseProjectSalesScope, parseProjectSalesSnapshot, stageInProjectSalesTab } from '../projectSalesContracts';
import { SALE_STAGES } from '../workflow';
import { pid, projectSale, projectScope, projectSnapshot } from './projectSalesFixtures';

describe('project sales read contract', () => {
  it('accepts chooser without inventing any booking or project', () => {
    const scope = projectScope({ projectName: null });
    expect(parseProjectSalesQuery('https://test.invalid')).toEqual(scope);
    expect(parseProjectSalesSnapshot(projectSnapshot(scope), scope).rows).toEqual([]);
  });
  it('keeps query literals rather than treating percent/underscore as wildcard syntax', () => {
    const scope = projectScope({ query: '%_', page: 1, tab: 'all' });
    expect(parseProjectSalesQuery(`https://test.invalid/?${new URLSearchParams({ projectName: scope.projectName!, q: '%_', page: '1', tab: 'all' })}`)).toEqual(scope);
  });
  it.each(['?admin=true', '?page=1', '?projectName=', '?projectName=A&page=-1', '?projectName=A&page=100001', '?projectName=A&page=01',
    '?projectName=A&projectName=B', '?projectName=A&tab=lost', '?projectName=A&q=x', '?projectName=A&q=%00x', '?projectName=A&q=%F0%9F%98%80'])('rejects bad or ambiguous scope %s', query => {
    expect(() => parseProjectSalesQuery(`https://test.invalid/${query}`)).toThrow();
  });
  it('matches two Unicode codepoints and trims only actual whitespace', () => {
    expect(parseProjectSalesScope(projectScope({ query: ' 😀😀 ' })).query).toBe('😀😀');
    expect(() => parseProjectSalesScope(projectScope({ query: 'x'.repeat(201) }))).toThrow();
    expect(() => parseProjectSalesScope({ ...projectScope(), role: 'admin' } as never)).toThrow();
  });
  it.each([{ projectName: ['A', 'B'] }, { tab: ['all'] }, { customerId: pid(2) }, { projectName: '' }, { tab: 'visit' }])('rejects ambiguous page query %j', query => {
    expect(() => parseProjectSalesPageQuery(query)).toThrow();
  });
  it('preserves separate sale rounds/customer identity and unknown evidence without fallback arithmetic', () => {
    const scope = projectScope({ tab: 'all' }), snapshot = projectSnapshot(scope);
    snapshot.rows.push(projectSale({ saleId: pid(4), bookingRound: 2, previousSaleId: pid(1), plotId: null, plotName: null, stage: 'cancelled' }));
    const parsed = parseProjectSalesSnapshot({ ...snapshot, privateData: 'not returned' }, scope);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[1]).toMatchObject({ customerId: pid(2), plotId: null, bookedAt: null, salePrice: null, previousSaleId: pid(1) });
    expect(parsed).not.toHaveProperty('privateData');
  });
  it.each([{ projectName: 'โครงการ B' }, { stage: 'cancelled' }, { plotId: null }, { bookingRound: 0 }, { salePrice: -1 }, { depositAmount: '0' },
    { paymentMethod: 'unknown' }, { bookedAt: '2026-09-23' }, { saleId: 'bad' }, { ownerUserId: null }])('rejects malformed/incorrectly scoped row %j', row => {
    const snapshot = projectSnapshot(); snapshot.rows[0] = { ...snapshot.rows[0], ...row } as never;
    expect(() => parseProjectSalesSnapshot(snapshot, projectScope())).toThrow();
  });
  it('requires bounded unique rows, registered project, matched scope and hasMore evidence', () => {
    const snapshot = projectSnapshot();
    expect(() => parseProjectSalesSnapshot({ ...snapshot, hasMore: true }, projectScope())).toThrow();
    expect(() => parseProjectSalesSnapshot({ ...snapshot, rows: [snapshot.rows[0], snapshot.rows[0]] }, projectScope())).toThrow();
    expect(() => parseProjectSalesSnapshot({ ...snapshot, projects: [] }, projectScope())).toThrow();
    expect(() => parseProjectSalesSnapshot({ ...snapshot, page: 1 }, projectScope())).toThrow();
    expect(() => parseProjectSalesSnapshot({ ...snapshot, rows: Array.from({ length: 51 }, (_, index) => projectSale({ saleId: pid(100 + index) })) }, projectScope())).toThrow();
  });
  it('separates transferred and cancelled stages without counting them as active bookings', () => {
    for (const stage of SALE_STAGES) {
      expect(stageInProjectSalesTab(stage, 'all')).toBe(true);
      expect(stageInProjectSalesTab(stage, 'cancelled')).toBe(stage === 'cancelled');
      expect(stageInProjectSalesTab(stage, 'transferred')).toBe(['transferred', 'handover'].includes(stage));
      expect(stageInProjectSalesTab(stage, 'booked')).toBe(!['cancelled', 'transferred', 'handover'].includes(stage));
    }
  });
});
