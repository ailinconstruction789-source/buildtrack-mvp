import { describe, expect, it } from 'vitest';
import { parseHistoricalCustomerEvidenceQuery, parseHistoricalCustomerEvidenceScope, parseHistoricalCustomerEvidenceSnapshot } from '../historicalCustomerEvidenceContracts';
import { evidenceSnapshot, historyScope } from './historicalCustomerEvidenceFixtures';
import { bid } from './bookingFixtures';
describe('historical evidence is scoped immutable day evidence', () => {
  it('keeps different visits by one person, unknown project and missing dates', () => {
    const data = evidenceSnapshot(); data.records.push({ ...data.records[0], key: `${bid(10)}:944`, sourceRow: 944,
      events: [{ kind: 'visited', date: null, precision: 'unknown' }] });
    const result = parseHistoricalCustomerEvidenceSnapshot(data, historyScope);
    expect(result.records).toHaveLength(2); expect(result.records[1].events[0].date).toBeNull(); expect(result.records[0].projectName).toBeNull();
  });
  it('retains known multiple projects without arbitrarily choosing an Interest or Sale', () => {
    const data=evidenceSnapshot();data.records[0].projectNames=['โครงการ A','โครงการ B'];
    expect(parseHistoricalCustomerEvidenceSnapshot(data,historyScope).records[0]).toMatchObject({projectNames:['โครงการ A','โครงการ B'],interestId:null,saleId:null});
    data.records[0].interestId=bid(3);expect(()=>parseHistoricalCustomerEvidenceSnapshot(data,historyScope)).toThrow();
  });
  it('rejects duplicate or contradictory project membership', () => {
    const data=evidenceSnapshot();data.records[0].projectNames=['โครงการ A','โครงการ A'];expect(()=>parseHistoricalCustomerEvidenceSnapshot(data,historyScope)).toThrow();
    data.records[0].projectNames=['โครงการ A'];expect(()=>parseHistoricalCustomerEvidenceSnapshot(data,historyScope)).toThrow();
  });
  it.each(['name=x', 'page=00', 'page=200', 'page=-1', 'page=1.5', 'saleId=not-uuid', 'customerId='+bid(99)])('rejects extra, repeated or unbounded query %s', query => {
    const base = 'https://fixture.invalid/?'+new URLSearchParams({ customerId: historyScope.customerId, interestId: '', saleId: '', page: '0' });
    expect(() => parseHistoricalCustomerEvidenceQuery(base+'&'+query)).toThrow();
  });
  it('accepts empty optional IDs only in query and exact nullable structured scope', () => {
    const url = 'https://fixture.invalid/?'+new URLSearchParams({ customerId: historyScope.customerId, interestId: '', saleId: '', page: '199' });
    expect(parseHistoricalCustomerEvidenceQuery(url)).toEqual({ ...historyScope, page: 199 });
    expect(() => parseHistoricalCustomerEvidenceScope({ ...historyScope, saleId: '' })).toThrow();
  });
  it.each(['actor','customer','interest','sale','page','duplicate','precision','date','extra','chronology','write'])('refuses ambiguous or mismatched %s data', change => {
    const data = evidenceSnapshot(); const row = data.records[0];
    if (change === 'actor') data.actor.role = 'contractor' as never;
    if (change === 'customer') row.customerId = bid(99);
    if (change === 'interest') data.interestId = bid(99);
    if (change === 'sale') data.saleId = bid(99);
    if (change === 'page') data.page = 1;
    if (change === 'duplicate') data.records.push({ ...row });
    if (change === 'precision') row.events[0].precision = 'unknown';
    if (change === 'date') row.events[0].date = '2026-02-30';
    if (change === 'extra') Object.assign(row, { rawName: 'private source' });
    if (change === 'chronology') row.events = [{ kind:'booked', date:'2026-10-08', precision:'day' },{kind:'cancelled', date:'2026-10-07', precision:'day'}];
    if (change === 'write') data.readOnly = false as never;
    expect(() => parseHistoricalCustomerEvidenceSnapshot(data, historyScope)).toThrow();
  });
  it('does not silently pick a visit when two rows claim one Sale', () => {
    const scope = { ...historyScope, interestId: bid(3), saleId: bid(5) }, data = evidenceSnapshot(scope);
    data.records.push({ ...data.records[0], key: 'other:944', sourceRow: 944 });
    expect(() => parseHistoricalCustomerEvidenceSnapshot(data, scope)).toThrow();
  });
  it('rejects incomplete pagination and duplicate event kinds', () => {
    const data = evidenceSnapshot(); data.hasMore = true; expect(() => parseHistoricalCustomerEvidenceSnapshot(data, historyScope)).toThrow();
    data.hasMore = false; data.records[0].events.push({ ...data.records[0].events[0] });
    expect(() => parseHistoricalCustomerEvidenceSnapshot(data, historyScope)).toThrow();
  });
});
