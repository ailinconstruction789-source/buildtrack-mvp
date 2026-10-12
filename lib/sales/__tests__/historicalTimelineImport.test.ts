import { describe, expect, it } from 'vitest';
import { prepareHistoricalTimelineImport, historicalTimelineLostEligibility,
  type HistoricalTimelineImportInput, type HistoricalTimelineRecord, type HistoricalTimelineEventKind } from '../historicalTimelineImport';
import { bid } from './bookingFixtures';

const digest = 'a'.repeat(64);
function occurrence(kind: HistoricalTimelineEventKind, sequence = 1, date: string | null = null) {
  return { eventKey: `event-${sequence}`, kind, sequence, date, precision: date === null ? 'unknown' as const : 'day' as const, evidenceRef: `source-event-${sequence}` };
}
function source(patch: Partial<HistoricalTimelineRecord> = {}): HistoricalTimelineRecord {
  return { recordKey: 'row-1', rowNumber: 2, rowSha256: digest, customerKey: 'source-customer-1', dealKey: 'source-deal-1',
    kind: 'purchase', stage: 'transferred', rentalType: null, events: [], ...patch };
}
function input(rows = [source()]): HistoricalTimelineImportInput {
  return { manifest: { version: 'historical-timeline-manifest-v1', sourceSystem: 'legacy-office', datasetKey: 'customer-register',
    snapshotSha256: 'b'.repeat(64), mappingReviewRef: 'review-1', records: rows.map(row => ({ recordKey: row.recordKey, rowNumber: row.rowNumber, rowSha256: row.rowSha256 })) },
    records: rows, bindings: rows.map((row, index) => ({ recordKey: row.recordKey, rowSha256: row.rowSha256,
      customerKey: row.customerKey, dealKey: row.dealKey, customerId: bid(1), interestId: bid(2),
      saleId: row.kind === 'purchase' || row.stage === 'rental_buyout' ? bid(10 + index) : null,
      rentalId: row.kind === 'rental' ? bid(20 + index) : null, evidenceRef: `mapping-${index}` })) };
}
const eligibility = { historyReviewComplete: true, nativeLeadId: bid(99), currentStage: 'Visit' };

describe('offline historical timeline preparation with explicit reviewed IDs', () => {
  it.each(['booked', 'contracted', 'loan_rejected', 'transferred', 'handover', 'cancelled'] as const)(
    'keeps existing %s deals without invented Leads or earlier history', stage => {
      const plan = prepareHistoricalTimelineImport(input([source({ stage })]));
      expect(plan.rows[0].holds).toEqual([]); expect(plan.rows[0].source.events).toEqual([]);
      expect(plan).toMatchObject({ writesAllowed: false, importReady: false, leadRequired: false, replayEarlierSteps: false });
      expect(plan.rows[0].protectedFromLost).toBe(true);
      expect(historicalTimelineLostEligibility(plan, bid(1), eligibility).eligibleForReview).toBe(false);
    });
  it('preserves days and explicit unknown dates as evidence without making an instant', () => {
    const row = source({ events: [occurrence('visited', 1, '2024-01-01'), occurrence('booked', 2),
      occurrence('contracted', 3, '2024-02-29'), occurrence('transferred', 4, '2024-03-01')] });
    const before = JSON.stringify(row), plan = prepareHistoricalTimelineImport(input([row]));
    expect(plan.rows[0].holds).toEqual([]);
    expect(plan.rows[0].source.events[1]).toMatchObject({ date: null, precision: 'unknown' });
    expect(plan.rows[0].source.events[2]).toMatchObject({ date: '2024-02-29', precision: 'day' });
    expect(plan.rows[0].source.events[2]).not.toHaveProperty('occurredAt');
    expect(JSON.stringify(row)).toBe(before);
  });
  it('allows later visits after a recorded booking, without changing the purchase order', () => {
    const plan = prepareHistoricalTimelineImport(input([source({ events: [occurrence('booked', 1, '2025-01-01'),
      occurrence('visited', 2, '2025-03-01'), occurrence('contracted', 3, '2025-02-01')] })]));
    expect(plan.rows[0].holds).toEqual([]);
  });
  it('keeps rejection and multiple resubmission rounds rather than treating the first loan as the latest', () => {
    const plan = prepareHistoricalTimelineImport(input([source({ events: [occurrence('booked', 1), occurrence('contracted', 2),
      occurrence('loan_submitted', 3), occurrence('loan_rejected', 4), occurrence('document_requested', 5),
      occurrence('loan_submitted', 6), occurrence('loan_approved', 7), occurrence('transferred', 8)] })]));
    expect(plan.rows[0].holds).toEqual([]); expect(plan.rows[0].source.events).toHaveLength(8);
  });
  it.each(['A', 'B', 'C'] as const)('preserves rental type %s and repeated renewals', rentalType => {
    const row = source({ kind: 'rental', stage: 'rental_active', rentalType, events: [occurrence('rental_started', 1),
      occurrence('rental_renewed', 2, '2025-02-01'), occurrence('rental_renewed', 3, '2025-03-01')] });
    const plan = prepareHistoricalTimelineImport(input([row]));
    expect(plan.rows[0].holds).toEqual([]); expect(plan.rows[0].binding?.saleId).toBeNull();
    expect(historicalTimelineLostEligibility(plan, bid(1), eligibility)).toMatchObject({ eligibleForReview: false, protectedFromLost: true });
  });
  it.each(['rental_ended', 'rental_buyout', 'cancelled'] as const)('keeps terminal rental %s history protected', stage => {
    const kind = stage === 'cancelled' ? 'cancelled' : stage;
    const plan = prepareHistoricalTimelineImport(input([source({ kind: 'rental', stage, rentalType: 'B', events: [occurrence(kind)] })]));
    expect(plan.rows[0].holds).toEqual([]); expect(plan.rows[0].protectedFromLost).toBe(true);
    expect(plan.rows[0].binding?.saleId !== null).toBe(stage === 'rental_buyout');
  });
  it('requires independent verified rental and purchase references for buyout', () => {
    const data = input([source({ kind: 'rental', stage: 'rental_buyout', rentalType: 'C' })]);
    data.bindings[0].saleId = null;
    expect(prepareHistoricalTimelineImport(data).rows[0].holds).toContain('MAPPING_CONFLICT');
  });
  it.each([
    [occurrence('booked', 1, '2025-03-01'), occurrence('contracted', 2, '2025-01-01')],
    [occurrence('contracted', 1), occurrence('booked', 2)],
    [occurrence('transferred', 1), occurrence('loan_submitted', 2)],
  ].map(events => ({ events })))('holds chronologically or logically conflicting events without deleting them', ({ events }) => {
    const plan = prepareHistoricalTimelineImport(input([source({ events })]));
    expect(plan.rows[0].holds).toContain('TIMELINE_ORDER_CONFLICT'); expect(plan.rows[0].source.events).toHaveLength(2);
  });
  it.each([
    { stage: 'booked' as const, events: [occurrence('contracted')] },
    { stage: 'booked' as const, events: [occurrence('loan_approved')] },
    { stage: 'cancelled' as const, events: [occurrence('transferred')] },
    { stage: 'booked' as const, events: [occurrence('cancelled')] },
    { stage: 'transferred' as const, events: [occurrence('handover')] },
    { stage: 'cancelled' as const, events: [occurrence('cancelled', 1), occurrence('contracted', 2)] },
    { kind: 'rental' as const, stage: 'rental_active' as const, rentalType: 'A' as const, events: [occurrence('contracted')] },
    { kind: 'rental' as const, stage: 'rental_ended' as const, rentalType: 'A' as const, events: [occurrence('rental_buyout')] },
  ])('holds stage/history conflicts %j', change => {
    expect(prepareHistoricalTimelineImport(input([source(change)])).rows[0].holds).toContain('STAGE_HISTORY_CONFLICT');
  });
  it('holds rental renewal ordered before the known start event', () => {
    const row = source({ kind: 'rental', stage: 'rental_active', rentalType: 'A', events: [occurrence('rental_renewed', 1), occurrence('rental_started', 2)] });
    expect(prepareHistoricalTimelineImport(input([row])).rows[0].holds).toContain('TIMELINE_ORDER_CONFLICT');
  });
  it('holds duplicate event keys or sequence numbers while retaining both source entries', () => {
    const row = source({ events: [occurrence('booked'), occurrence('contracted')] });
    expect(prepareHistoricalTimelineImport(input([row])).rows[0].holds).toContain('DUPLICATE_EVENT');
  });
  it('holds duplicate source records even when they are identical', () => {
    const data = input(); data.records.push(structuredClone(data.records[0]));
    const plan = prepareHistoricalTimelineImport(data);
    expect(plan.rows).toHaveLength(2); expect(plan.rows.every(row => row.holds.includes('DUPLICATE_SOURCE_RECORD'))).toBe(true);
  });
  it('holds edited digest/row identities and requires mapping review, rather than trusting a record label', () => {
    const data = input(); data.records[0].rowSha256 = 'c'.repeat(64); data.records[0].rowNumber = 3;
    expect(prepareHistoricalTimelineImport(data).rows[0].holds).toEqual(expect.arrayContaining(['SOURCE_RECORD_CONFLICT', 'MAPPING_CONFLICT']));
  });
  it.each(['customerKey', 'dealKey', 'rowSha256'] as const)('does not reuse a reviewed mapping after %s changes', key => {
    const data = input(); data.bindings[0][key] = key === 'rowSha256' ? 'c'.repeat(64) : 'different-source-key';
    expect(prepareHistoricalTimelineImport(data).rows[0].holds).toContain('MAPPING_CONFLICT');
  });
  it('holds absent or duplicate bindings and never issues a customer/Lead ID', () => {
    const data = input(); data.bindings = [];
    const plan = prepareHistoricalTimelineImport(data);
    expect(plan.rows[0].binding).toBeNull(); expect(plan.rows[0].holds).toContain('MAPPING_REQUIRED');
    data.bindings = [input().bindings[0], input().bindings[0]];
    expect(prepareHistoricalTimelineImport(data).rows[0].holds).toContain('MAPPING_CONFLICT');
  });
  it('holds one source customer mapped to different customers instead of guessing identity', () => {
    const data = input([source(), source({ recordKey: 'row-2', rowNumber: 3, dealKey: 'source-deal-2' })]);
    data.bindings[1].customerId = bid(3);
    expect(prepareHistoricalTimelineImport(data).rows.every(row => row.holds.includes('CUSTOMER_IDENTITY_CONFLICT'))).toBe(true);
  });
  it('holds one source deal mapped to multiple sales', () => {
    const data = input([source(), source({ recordKey: 'row-2', rowNumber: 3 })]);
    expect(prepareHistoricalTimelineImport(data).rows.every(row => row.holds.includes('DEAL_IDENTITY_CONFLICT'))).toBe(true);
  });
  it('holds multiple distinct source deals mapped to one sale', () => {
    const data = input([source(), source({ recordKey: 'row-2', rowNumber: 3, dealKey: 'source-deal-2' })]);
    data.bindings[1].saleId = data.bindings[0].saleId;
    expect(prepareHistoricalTimelineImport(data).rows.every(row => row.holds.includes('DEAL_IDENTITY_CONFLICT'))).toBe(true);
  });
  it('does not merge independently keyed source histories of the same deal, even with identical reviewed entity IDs', () => {
    const data = input([source({ events: [occurrence('transferred', 1, '2025-01-01')] }),
      source({ recordKey: 'row-2', rowNumber: 3, events: [occurrence('transferred', 1, '2025-02-01')] })]);
    data.bindings[1].saleId = data.bindings[0].saleId;
    const plan = prepareHistoricalTimelineImport(data);
    expect(plan.rows.every(row => row.holds.includes('DEAL_HISTORY_REVIEW'))).toBe(true);
    expect(plan.rows.map(row => row.source.events[0].date)).toEqual(['2025-01-01', '2025-02-01']);
  });
  it('protects visit-only rows of the same source customer when the unmapped deal has unknown dates', () => {
    const data = input([source({ kind: 'visit', stage: 'visited', dealKey: null }),
      source({ recordKey: 'row-2', rowNumber: 3, stage: 'cancelled' })]); data.bindings.pop();
    const plan = prepareHistoricalTimelineImport(data);
    expect(plan.rows[0].protectedFromLost).toBe(true);
    expect(historicalTimelineLostEligibility(plan, bid(1), eligibility).eligibleForReview).toBe(false);
  });
  it('protects separately reviewed source customer keys that explicitly map to the same customer', () => {
    const data = input([source({ kind: 'visit', stage: 'visited', dealKey: null }),
      source({ recordKey: 'row-2', rowNumber: 3, customerKey: 'source-customer-2' })]);
    expect(prepareHistoricalTimelineImport(data).rows.every(row => row.protectedFromLost)).toBe(true);
  });
  it('permits only review of prebooking Visit Leads, requiring a complete history inventory and native Lead identity', () => {
    const plan = prepareHistoricalTimelineImport(input([source({ kind: 'visit', stage: 'visited', dealKey: null, events: [occurrence('visited')] })]));
    expect(historicalTimelineLostEligibility(plan, bid(1), eligibility)).toEqual({ eligibleForReview: true, protectedFromLost: false, writesAllowed: false });
    expect(historicalTimelineLostEligibility(plan, bid(1), { ...eligibility, historyReviewComplete: false }).eligibleForReview).toBe(false);
    expect(historicalTimelineLostEligibility(plan, bid(1), { ...eligibility, nativeLeadId: null }).eligibleForReview).toBe(false);
    expect(historicalTimelineLostEligibility(plan, bid(1), { ...eligibility, currentStage: 'Lost' }).eligibleForReview).toBe(false);
    expect(historicalTimelineLostEligibility(plan, bid(3), eligibility).eligibleForReview).toBe(false);
  });
  it('withholds Lost review if another row for the same source customer is still awaiting mapping', () => {
    const data = input([source({ kind: 'visit', stage: 'visited', dealKey: null }),
      source({ recordKey: 'row-2', rowNumber: 3, kind: 'visit', stage: 'visited', dealKey: null })]);
    data.bindings.pop();
    expect(historicalTimelineLostEligibility(prepareHistoricalTimelineImport(data), bid(1), eligibility).eligibleForReview).toBe(false);
  });
  it('returns the exact same prepared plan on a rerun independent of input row/key ordering', () => {
    const data = input([source(), source({ recordKey: 'row-2', rowNumber: 3, dealKey: 'source-deal-2' })]);
    const plan = prepareHistoricalTimelineImport(data); data.records.reverse(); data.bindings.reverse(); data.manifest.records.reverse();
    expect(prepareHistoricalTimelineImport(data, plan)).toEqual(plan);
  });
  it.each(['source', 'manifest', 'mapping', 'event'] as const)('rejects a changed %s on rerun', change => {
    const data = input(), plan = prepareHistoricalTimelineImport(data);
    if (change === 'source') data.records[0].stage = 'handover';
    if (change === 'manifest') data.manifest.mappingReviewRef = 'review-2';
    if (change === 'mapping') data.bindings[0].evidenceRef = 'changed-review';
    if (change === 'event') data.records[0].events.push(occurrence('transferred', 1, '2025-01-01'));
    expect(() => prepareHistoricalTimelineImport(data, plan)).toThrow('HISTORICAL_TIMELINE_PLAN_CHANGED');
  });
  it('detects a mutated prior plan and does not mistake the canonical reference for database idempotency', () => {
    const data = input(), plan = prepareHistoricalTimelineImport(data); plan.rows[0].source.stage = 'handover';
    expect(() => prepareHistoricalTimelineImport(data, plan)).toThrow('HISTORICAL_TIMELINE_PLAN_CHANGED');
    expect(() => historicalTimelineLostEligibility(plan, bid(1), eligibility)).toThrow('HISTORICAL_TIMELINE_PLAN_CHANGED');
  });
  it.each(['2025-02-29', '2025-02-30', '0000-01-01', '2025-01-01T00:00:00Z', '', undefined])('rejects invalid or synthetic business date %j', date => {
    const data = input(); data.records[0].events = [{ ...occurrence('transferred'), date } as never];
    expect(() => prepareHistoricalTimelineImport(data)).toThrow();
  });
  it.each([{ created_at: '2026-01-01T00:00:00Z' }, { nativeLeadId: bid(30) }, { role: 'admin' }, { customer_name: 'same-name' }, { phone: '0812345678' }])(
    'rejects unreviewed authority, identity inference or audit-time fields %j', extra => {
      const data = input(); Object.assign(data.records[0], extra);
      expect(() => prepareHistoricalTimelineImport(data)).toThrow();
    });
  it('rejects fabricated time precision and extra event fields', () => {
    const data = input(); data.records[0].events.push({ ...occurrence('transferred', 1, '2025-01-01'), precision: 'instant' } as never);
    expect(() => prepareHistoricalTimelineImport(data)).toThrow();
    data.records[0].events = [Object.assign(occurrence('transferred'), { occurredAt: null })];
    expect(() => prepareHistoricalTimelineImport(data)).toThrow();
  });
  it('rejects a manifest with missing rows, duplicate identities or a binding outside the source manifest', () => {
    const data = input(); data.records = []; expect(() => prepareHistoricalTimelineImport(data)).toThrow('HISTORICAL_MANIFEST_COVERAGE_INVALID');
    const duplicate = input(); duplicate.manifest.records.push(duplicate.manifest.records[0]);
    expect(() => prepareHistoricalTimelineImport(duplicate)).toThrow('HISTORICAL_MANIFEST_AMBIGUOUS');
    const outside = input(); outside.bindings[0].recordKey = 'outside';
    expect(() => prepareHistoricalTimelineImport(outside)).toThrow('HISTORICAL_MANIFEST_COVERAGE_INVALID');
  });
  it('bounds event parsing/copying before processing an oversized input', () => {
    const events = Array.from({ length: 1000 }, (_, index) => occurrence('visited', index + 1));
    const data = input(Array.from({ length: 101 }, (_, index) => source({ recordKey: `row-${index}`, rowNumber: index + 2,
      kind: 'visit', stage: 'visited', dealKey: null, events })));
    expect(() => prepareHistoricalTimelineImport(data)).toThrow('HISTORICAL_TIMELINE_TOO_LARGE');
    expect(data.records[0].events).toBe(events);
  });
});
