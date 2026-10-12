import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { loadFullReplacementInputs, prepareFullReplacementInputs } from './prepare-full-replacement-inputs.mjs';
import { loadRemainingSourceInputs } from './prepare-remaining-canonical-inputs.mjs';
import { prepareCustomerReplacementPreflight } from './prepare-customer-replacement-preflight.mjs';
const digest = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const remaining = loadRemainingSourceInputs();
const original = Object.fromEntries(Object.entries({ base: 'customer-combined-plan', plan: 'canonical-customer-adapter-plan',
  snapshot: 'customer-replacement-live-reference', preflight: 'customer-replacement-preflight' })
  .map(([key, value]) => [key, JSON.parse(readFileSync(`reports/${value}-2026-10-10.json`))]));
const actual = loadFullReplacementInputs();
const fixture = () => ({ ...structuredClone(original), remaining: structuredClone(remaining) });
const reseal = f => {
  const { combinedPlanDigest, ...b } = f.base; f.base.combinedPlanDigest = digest(b);
  f.plan.basePlanDigest = f.base.combinedPlanDigest;
  const { adapterPlanDigest, ...p } = f.plan; f.plan.adapterPlanDigest = digest(p);
  f.remaining.redacted.adapterPlanDigest = f.plan.adapterPlanDigest;
  const { inputDigest, ...r } = f.remaining.redacted; f.remaining.redacted.inputDigest = digest(r);
  f.preflight = prepareCustomerReplacementPreflight({ plan: f.plan, snapshot: f.snapshot });
};
const row = n => actual.manifest.records.find(r => r.sourceRow === n);

test('all979current approved rows produce exactly958cohort rows without production permission', () => {
  assert.equal(actual.manifest.records.length, 958);
  assert.equal(actual.manifest.counts.sourceRowsVerified, 979);
  assert.equal(actual.manifest.phase3Completion, false); assert.equal(actual.manifest.productionChanged, false);
  assert.equal(actual.manifest.businessWritesAllowed, false); assert.equal(actual.manifest.freshCaptureIncluded, false);
});
test('whole cohort has957customers 948interests and298independent Sales records after excluded rentals', () => {
  assert.equal(actual.manifest.counts.projectedCustomerIdentities, 957);
  assert.equal(actual.manifest.counts.projectedInterestRecords, 948);
  assert.equal(actual.manifest.projectedSales.length, 298);
  assert.equal(actual.manifest.counts.activeProjectedPlots, 213);
});
test('N001isoneCustomer with separate transferred and cancelled Sales histories', () => {
  assert.equal(row(3).binding.customerId, row(193).binding.customerId);
  assert.notEqual(row(3).binding.interestId, row(193).binding.interestId);
  assert.notEqual(row(3).binding.saleId, row(193).binding.saleId);
  assert.equal(row(3).sourceStage, 'transferred'); assert.equal(row(193).sourceStage, 'cancelled');
  assert.equal(row(3).binding.plotId, 'กานต์รวี4-9'); assert.equal(row(193).binding.plotId, 'ไอลิน 3-53');
});
test('eight manual rental rows and thirteen unconfirmed identities never entercohort', () => {
  const excluded = [...actual.manifest.excluded.rentalSourceRows, ...actual.manifest.excluded.heldIdentitySourceRows];
  assert.equal(excluded.length, 21); assert(excluded.every(n => row(n) === undefined));
  assert.equal(actual.manifest.policy.rentalImport, false);
});
test('tenunknownproject Customers remain without projects or Interests', () => {
  const unknown = actual.manifest.records.filter(r => r.unknownProjectDisplay);
  assert.equal(unknown.length, 10); assert(unknown.every(r => r.projectName === null && r.binding.interestId === null
    && r.binding.saleId === null && r.binding.plotId === null));
});
test('unknownbooking171preserves three known historicaldays without manufacturing a Sale', () => {
  assert.equal(row(171).sourceStage, 'cancelled'); assert.equal(row(171).binding.saleId, null);
  assert.equal(row(171).binding.plotId, null); assert.equal(row(171).projectName, 'โยริว');
  assert.deepEqual(row(171).history.map(h => [h.kind, h.date]), [['visited', '2023-03-14'], ['booked', '2023-03-14'], ['cancelled', '2024-07-25']]);
});
test('sixcreationnames remain onlyinmemory with separate sourcecandidatekeys', () => {
  assert.deepEqual(actual.creationPayload.records.map(r => r.sourceRow), [438, 439, 440, 444, 680, 894]);
  assert.equal(actual.creationPayload.records.find(r => r.sourceRow === 680).customerName, 'ไม่ทราบ');
  assert.equal(row(680).unknownNameDisplay, 'ไม่ทราบ');
  assert.equal(new Set(actual.creationPayload.records.map(r => r.customerCandidateKey)).size, 6);
  assert(actual.manifest.records.every(r => !('customerName' in r) && !('phone' in r)));
});
test('cancellations926944and new964retain exact source daypriceP andunknownpayment', () => {
  assert.equal(row(926).sourceStage, 'cancelled'); assert.equal(row(944).sourceStage, 'cancelled');
  assert.equal(row(926).history.find(h => h.kind === 'cancelled').date, '2026-10-07');
  assert.equal(row(944).history.find(h => h.kind === 'cancelled').date, '2026-10-07');
  assert.equal(row(964).binding.saleId, null); assert.equal(row(964).financial.salePriceSatang, 264300000);
  assert.equal(row(964).financial.expectedTransferDate, '2026-10-30');
  assert.equal(actual.manifest.projectedSales.find(s => s.sourceRow === 964).paymentMethod, null);
});
test('fiveapproved priceupdates retain satang unit and explicit Pforecasts', () => {
  assert.deepEqual([706, 881, 937, 939, 952].map(n => row(n).financial.salePriceSatang), [522800000, 279300000, 318200000, 418400000, 208000000]);
  assert.equal(row(881).financial.expectedTransferDate, '2026-10-29');
  assert.equal(row(706).financial.expectedTransferSourceColumn, 'P');
});
test('all42known Pdays preserved;additional36requires actual perSaleforecastimport', () => {
  assert.equal(actual.manifest.counts.knownSourceForecasts, 42);
  assert.equal(actual.manifest.counts.existingForecastUpdates, 41);
  assert.equal(actual.manifest.additionalForecastImport.sourceRows.length, 36);
  assert.deepEqual(actual.manifest.additionalForecastImport.stageCounts, { booked: 3, transferred: 33, cancelled: 0 });
  assert.equal(actual.manifest.additionalForecastImport.expectedTransferIsActualTransfer, false);
});
test('sourcechronology63and175isflaggedand retained without invented correction', () => {
  assert.deepEqual(actual.manifest.chronologyReviewRows, [63, 175]);
  for (const n of [63, 175]) assert.deepEqual(row(n).history.map(({kind, date, precision}) => ({kind, date, precision})),
    original.base.rows.find(r => r.sourceRow === n).sourceHistory);
});
test('bankowner and sourceprovenance are preserved independently of perrow sourceowner', () => {
  const r = row(3), prior = original.snapshot.customers.find(c => c.id === r.binding.customerId);
  assert.equal(r.preservedCustomerOwnerId, prior.ownerId); assert.equal(r.sourceProvenance.customerBatchId, prior.sourceBatchId);
  assert(actual.manifest.records.every(r => r.financial.structuredBank === null && r.financial.bankPolicy === 'preserve_existing_no_inference_from_note'));
  assert(actual.manifest.records.every(r => r.actualTimestamps === null));
});
test('unknownfinancialvalues staynull withpreserve policy rather than zero', () => {
  const unknown = actual.manifest.records.filter(r => r.financial.salePriceSatang === null);
  assert.equal(unknown.length, 668); assert(unknown.every(r => r.financial.pricePolicy === 'unknown_preserve_existing'));
});
for (const n of [706, 926]) test('unknown source price preserves existing money for revision row ' + n, () => {
  const f = fixture(), b = f.base.rows.find(r => r.sourceRow === n), p = f.plan.rows.find(r => r.sourceRow === n);
  const before = f.snapshot.sales.find(s => s.id === p.saleId).price;
  b.salePrice = null; b.pricePolicy = 'unknown_preserve_existing';
  if (p.patch) p.patch.salePriceSatang = null;
  reseal(f);
  const result = prepareFullReplacementInputs(f).manifest;
  assert.equal(result.records.find(r => r.sourceRow === n).financial.salePriceSatang, null);
  assert.equal(result.projectedSales.find(r => r.sourceRow === n).priceSatang, Math.round(before * 100));
});
test('pureprepare isdeterministic and doesnotmutate inputgraphs', () => {
  const f = fixture(), before = JSON.stringify(f), x = prepareFullReplacementInputs(f), y = prepareFullReplacementInputs(f);
  assert.deepEqual(x, y); assert.equal(JSON.stringify(f), before);
  x.creationPayload.records[0].customerName = 'changed';
  assert.notEqual(f.remaining.creation.records[0].customerName, 'changed');
});

for (const [name, mutate, pattern] of [
  ['tampered adapterplan', f => { f.plan.rows[0].sourceKey = 'changed'; }, /SEALED_COMPLETE/],
  ['tampered remainingmanifest', f => { f.remaining.redacted.reviewSha256 = 'changed'; }, /VERIFIED_REMAINING/],
  ['stale preflight snapshot', f => { f.snapshot.capturedAt = '2026-10-11T00:00:00Z'; }, /DERIVED_PREFLIGHT/],
  ['stale preflight claims zeroissues', f => { f.preflight.rowChecks[0].checksPassed = false; }, /DERIVED_PREFLIGHT/],
  ['inactive confirmedsales owner', f => { f.snapshot.roles.find(r => r.id === f.plan.rows.find(r => r.sourceRow === 438).ownerUserId).active = false; reseal(f); }, /FRESH_BINDING/],
  ['merged existingCustomer', f => { f.snapshot.customers[0].mergedIntoId = f.snapshot.customers[1].id; reseal(f); }, /FRESH_BINDING/],
  ['occupied newbooking plot', f => { f.snapshot.plots.find(p => p.id === '17' && p.projectName === 'ไอลิน6').occupied = true; reseal(f); }, /FRESH_BINDING/],
  ['advanced cancellation beforestage', f => { f.snapshot.sales.find(s => s.id === f.plan.rows.find(r => r.sourceRow === 926).saleId).stage = 'contracted'; reseal(f); }, /FRESH_BINDING/],
  ['changed existingPrice unreviewed', f => { f.snapshot.sales.find(s => s.id === f.plan.rows.find(r => r.sourceRow === 3).saleId).price = 1; reseal(f); }, /UNREVIEWED_PRICE/],
  ['existingCustomer owner no longer sales', f => { f.snapshot.customers.find(c => c.id === f.plan.rows.find(r => r.sourceRow === 3).customerId).ownerId = f.snapshot.roles.find(r => r.role === 'owner').id; reseal(f); }, /PRESERVED_CUSTOMER_OWNER/],
  ['creationname changedinmemory', f => { f.remaining.creation.records[0].customerName = 'different'; }, /CREATION_NAME/],
  ['invalid sourcehistory day', f => { f.plan.rows.find(r => r.sourceRow === 3).history[0].date = '2023-02-30'; reseal(f); }, /HISTORY_PRECISION/],
  ['invented date for unknownprecision', f => { const h = f.plan.rows.find(r => r.history.some(h => h.precision === 'unknown')).history.find(h => h.precision === 'unknown'); h.date = '2026-10-10'; reseal(f); }, /HISTORY_PRECISION/],
  ['routechangedwithout approval', f => { f.plan.rows.find(r => r.sourceRow === 706).route = 'existing_history_evidence'; reseal(f); }, /EXACT_COHORT_ROUTE/],
  ['unknown originalCustomer sourcebatch', f => { f.snapshot.customers.find(c => c.id === f.plan.rows.find(r => r.sourceRow === 3).customerId).sourceBatchId = '00000000-0000-4000-8000-000000000001'; reseal(f); }, /CUSTOMER_PROVENANCE/],
  ['inactive preservedInterest owner', f => { f.snapshot.interests.find(i => i.id === f.plan.rows.find(r => r.sourceRow === 3).interestId).ownerId = f.snapshot.roles.find(r => r.role === 'owner').id; reseal(f); }, /PRESERVED_INTEREST_OWNER/],
  ['invented originalSale provenance', f => { f.snapshot.sales.find(s => s.id === f.plan.rows.find(r => r.sourceRow === 3).saleId).sourceBookingId = '00000000-0000-4000-8000-000000000001'; reseal(f); }, /SOURCE_METADATA/],
]) test(name + ' rejectscohort before anyDBconnection', () => {
  const f = fixture(); mutate(f); assert.throws(() => prepareFullReplacementInputs(f), pattern);
});

test('malformed source financialamount never passes a wholecohort reseal', () => {
  const f = fixture(); f.base.rows.find(r => r.sourceRow === 706).salePrice = 5228000.123;
  reseal(f); assert.throws(() => prepareFullReplacementInputs(f));
});
test('closedproject isallowed for retained historical records', () => {
  const f = fixture(); f.snapshot.projects.find(p => p.name === row(3).projectName).is_closed = true;
  reseal(f); assert.equal(prepareFullReplacementInputs(f).manifest.records.length, 958);
});
test('closedproject prevents newcreation or newbooking', () => {
  const f = fixture(); f.snapshot.projects.find(p => p.name === row(964).projectName).is_closed = true;
  reseal(f); assert.throws(() => prepareFullReplacementInputs(f), /FRESH_BINDING/);
});
