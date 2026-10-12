// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { prepareUnknownHistoricalEvidence, type UnknownHistoricalEvidenceInput } from '../unknownHistoricalEvidence';

const first = 'aa250000-0000-4000-8000-000000000001';
const second = 'aa250000-0000-4000-8000-000000000002';
const example = (): UnknownHistoricalEvidenceInput => ({ version: 'unknown-historical-evidence-v1', sourceSystem: 'SYNTHETIC ONLY',
  datasetKey: 'unknown-history', snapshotSha256: 'a'.repeat(64), mappingReviewRef: 'SYNTHETIC reviewed binding',
  businessWritesAllowed: false, leadRequired: false, records: [
    { sourceKey: 'b'.repeat(64), rowNumber: 237, rowSha256: 'c'.repeat(64), customerKey: 'source-customer-1', customerId: first,
      interestId: null, saleId: null, reason: 'unknown_project', sourceStage: 'visited',
      events: [{ eventKey: 'visit-1', kind: 'visited', sequence: 1, date: null, precision: 'unknown', evidenceRef: 'SYNTHETIC unknown visit day' }] },
    { sourceKey: 'd'.repeat(64), rowNumber: 171, rowSha256: 'e'.repeat(64), customerKey: 'source-customer-2', customerId: second,
      interestId: first, saleId: null, reason: 'unknown_booking', sourceStage: 'cancelled',
      events: [{ eventKey: 'book-1', kind: 'booked', sequence: 1, date: '2024-02-29', precision: 'day', evidenceRef: 'SYNTHETIC booking day' },
        { eventKey: 'cancel-1', kind: 'cancelled', sequence: 2, date: null, precision: 'unknown', evidenceRef: 'SYNTHETIC unknown cancellation day' }] },
  ] });
describe('separate unknown historical evidence contract', () => {
  it('retains nullable project/Sale bindings and unknown days without business writes', () => {
    const source = example(), before = JSON.stringify(source), saved = prepareUnknownHistoricalEvidence(source);
    expect(saved.records.map(row => row.rowNumber)).toEqual([171, 237]);
    expect(saved.records[1]).toMatchObject({ interestId: null, saleId: null, sourceStage: 'visited' });
    expect(saved.records[0].events[1]).toMatchObject({ date: null, precision: 'unknown' });
    expect(saved.businessWritesAllowed).toBe(false); expect(saved.leadRequired).toBe(false);
    expect(JSON.stringify(source)).toBe(before);
  });
  it('canonicalizes source row order for exact retry', () => {
    const a = example(), b = example(); b.records.reverse(); expect(prepareUnknownHistoricalEvidence(a)).toEqual(prepareUnknownHistoricalEvidence(b));
  });
  it('permits explicitly unknown cancelled Interest as evidence only', () => {
    const source = example(); source.records[1].interestId = null;
    expect(prepareUnknownHistoricalEvidence(source).records[0].interestId).toBeNull();
  });
  const rejects: [string, (input: UnknownHistoricalEvidenceInput) => void][] = [
    ['business writes', input => { (input as unknown as { businessWritesAllowed: boolean }).businessWritesAllowed = true; }],
    ['invented unknown project Interest', input => { input.records[0].interestId = first; }],
    ['synthetic unknown booking Sale', input => { (input.records[1] as unknown as { saleId: string }).saleId = first; }],
    ['wrong source stage', input => { input.records[1].sourceStage = 'visited'; }],
    ['invalid source hash', input => { input.records[0].sourceKey = 'fake'; }],
    ['duplicate source identity', input => { input.records[1].sourceKey = input.records[0].sourceKey; }],
    ['duplicate row number', input => { input.records[1].rowNumber = input.records[0].rowNumber; }],
    ['mapping one source customer to two UUIDs', input => { input.records[1].customerKey = input.records[0].customerKey; }],
    ['mapping one UUID to two source customers', input => { input.records[1].customerId = first; }],
    ['invented date precision', input => { input.records[0].events[0].precision = 'day'; }],
    ['calendar-invalid day', input => { input.records[1].events[0].date = '2023-02-29'; }],
    ['operational timestamp', input => { input.records[1].events[0].date = '2024-02-29T00:00:00Z'; }],
    ['source events without booking', input => { input.records[1].events[0].kind = 'visited'; }],
    ['source events without cancellation', input => { input.records[1].events[1].kind = 'booked'; }],
    ['events moving backwards', input => { input.records[1].events[1].date = '2024-01-01'; input.records[1].events[1].precision = 'day'; }],
    ['duplicate event key', input => { input.records[1].events[1].eventKey = input.records[1].events[0].eventKey; }],
    ['noncontiguous event order', input => { input.records[1].events[1].sequence = 3; }],
    ['caller-supplied extra field', input => { Object.assign(input.records[0], { plotId: 'invented' }); }],
  ];
  for (const [label, mutate] of rejects) it(`rejects ${label}`, () => {
    const input = example(); mutate(input); expect(() => prepareUnknownHistoricalEvidence(input)).toThrow('UNKNOWN_HISTORY_INVALID');
  });
});
