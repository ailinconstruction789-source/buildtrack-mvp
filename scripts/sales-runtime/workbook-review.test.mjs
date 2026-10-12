import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { validateReviewPlan } from './workbook-review.mjs';
const seal = body => ({ ...body, planDigest: createHash('sha256').update(JSON.stringify(body)).digest('hex') });
const fixture = () => ({ version: 'customer-workbook-review-plan-v1', sourceSha256: 'a'.repeat(64), catalogDigest: 'b'.repeat(64),
  inspectionDate: '2026-10-10', counts: { sourceRecords: 1, heldRows: 1, canonicalImportRows: 0, confirmedCustomerBindings: 0, sourceEvents: 1 },
  rows: [{ sourceRow: 2, sourceKey: 'c'.repeat(64), rowSha256: 'd'.repeat(64), sourceStage: 'visited',
    sourceEvents: [{ kind: 'visited', date: null, precision: 'unknown' }], holds: ['MAPPING_REQUIRED'],
    customerId: null, interestId: null, saleId: null, rentalId: null, ownerUserId: null,
    canonicalWritesAllowed: false, leadRequired: false }],
  importReady: false, businessWritesAllowed: false, lostChangesAllowed: false,
  customerNamesIncluded: false, phoneValuesIncluded: false, bindingsVerified: false });
test('accepts redacted held evidence without inventing target identity', () => {
  const p = seal(fixture()); assert.equal(validateReviewPlan(p), p);
});
for (const [label, mutate] of [
  ['edited plan digest', p => { p.planDigest = 'e'.repeat(64); }],
  ['business activation', p => { p.businessWritesAllowed = true; }],
  ['Lost activation', p => { p.lostChangesAllowed = true; }],
  ['fabricated customer binding', p => { p.rows[0].customerId = '11111111-1111-4111-8111-111111111111'; }],
  ['unheld row', p => { p.rows[0].holds = []; }],
  ['source row omitted', p => { p.counts.sourceRecords = 2; }],
  ['names in row', p => { p.rows[0].customerName = 'PRIVATE CUSTOMER'; }],
  ['names in event', p => { p.rows[0].sourceEvents[0].name = 'PRIVATE CUSTOMER'; }],
  ['unknown marked precise', p => { p.rows[0].sourceEvents[0].precision = 'day'; }],
  ['impossible civil day', p => { p.rows[0].sourceEvents[0] = { kind: 'visited', date: '2026-02-30', precision: 'day' }; }],
  ['future actual day', p => { p.rows[0].sourceEvents[0] = { kind: 'visited', date: '2027-01-01', precision: 'day' }; }],
  ['invented contract event', p => { p.rows[0].sourceEvents[0].kind = 'contracted'; }],
]) test(`rejects ${label} before creating database staging`, () => {
  const p = fixture(); mutate(p);
  const input = label === 'edited plan digest' ? p : seal(p);
  assert.throws(() => validateReviewPlan(input), /REVIEW_PLAN_INVALID/);
});
