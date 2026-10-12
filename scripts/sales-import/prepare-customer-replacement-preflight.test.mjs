import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prepareCustomerReplacementPreflight } from './prepare-customer-replacement-preflight.mjs';

// Captured, redacted metadata is a local fixture. Tests never access a database.
const originalPlan = JSON.parse(readFileSync('reports/canonical-customer-adapter-plan-2026-10-10.json'));
const originalSnapshot = JSON.parse(readFileSync('reports/customer-replacement-live-reference-2026-10-10.json'));
const fixture = () => ({ plan: structuredClone(originalPlan), snapshot: structuredClone(originalSnapshot) });
const result = input => prepareCustomerReplacementPreflight(input);

test('full source coverage separates rows from customer identities without name merging', () => {
  const r = result(fixture());
  assert.equal(r.counts.sourceRows, 979);
  assert.equal(r.counts.eligibleSourceRows, 958);
  assert.equal(r.counts.proposedUniqueCustomerIdentities, 957);
  assert.equal(r.counts.retainedExistingCustomerIds, 951);
  assert.equal(r.counts.sourceBoundNewCustomerCandidates, 6);
  assert.equal(r.counts.bindingIssues, 0);
  assert.equal(r.rowChecks.find(x => x.sourceRow === 3).customerId, r.rowChecks.find(x => x.sourceRow === 193).customerId);
  assert.equal(r.policy.identityMergeByName, false);
});

test('source rentals and unresolved identities are excluded from replacement payload coverage', () => {
  const r = result(fixture());
  assert.deepEqual(r.skippedRentalSourceRows, [859, 951, 954, 958, 959, 960, 961, 969]);
  assert.deepEqual(r.heldIdentitySourceRows, [967, 968, 970, 971, 972, 973, 974, 975, 976, 977, 978, 979, 980]);
  assert(r.rowChecks.every(x => !r.skippedRentalSourceRows.includes(x.sourceRow) && !r.heldIdentitySourceRows.includes(x.sourceRow)));
});

test('empty rental tables do not imply that rental source bookings have disappeared', () => {
  const r = result(fixture());
  assert.equal(r.liveCounts.rentalContracts, 0);
  assert.equal(r.liveCounts.rentalPayments, 0);
  assert.equal(r.retirementReview.length, 6);
  assert(r.retirementReview.every(x => x.bindingVerified && x.executable === false));
  assert(r.blockers.includes('SOURCE_RENTALS_STILL_IN_CANONICAL_SALES'));
  assert(r.retirementReview.some(x => x.otherSalesOnPlot.some(s => s.stage === 'cancelled')));
});

test('transferred historical rows in closed projects stay eligible for history', () => {
  const r = result(fixture());
  assert.equal(r.rowChecks.find(x => x.sourceRow === 2).checksPassed, true);
  assert.equal(r.rowChecks.find(x => x.sourceRow === 3).checksPassed, true);
});

test('clean exact bindings never authorize a raw reset or schema change', () => {
  const r = result(fixture());
  assert.equal(r.execution.ready, false);
  assert.equal(r.execution.rawDeleteAllowed, false);
  assert.equal(r.execution.businessWritesAllowed, false);
  assert(r.blockers.includes('RAW_DELETE_PROTECTED'));
  assert(r.blockers.includes('FULL_REPLACEMENT_REHEARSAL_AND_FRESH_BACKUP_REQUIRED'));
  assert.equal(r.unmatchedExistingEntitiesForReview.deletionAllowed, false);
});

test('source approval tampering is rejected instead of producing a plan', () => {
  const f = fixture(); f.plan.rows[0].customerId = f.plan.rows[1].customerId;
  assert.throws(() => result(f), /SEALED_ADAPTER_PLAN_REQUIRED/);
});

for (const [label, mutate, code] of [
  ['merged customer', (f, row) => { f.snapshot.customers.find(c => c.id === row.customerId).mergedIntoId = f.plan.rows[1].customerId; }, 'CUSTOMER_MERGED'],
  ['wrong interest customer', (f, row) => { f.snapshot.interests.find(i => i.id === row.interestId).customerId = f.plan.rows[1].customerId; }, 'INTEREST_CUSTOMER_CHANGED'],
  ['wrong sale plot', (f, row) => { f.snapshot.sales.find(s => s.id === row.saleId).plotId = 'different-plot'; }, 'SALE_BINDING_CHANGED'],
  ['wrong plot project', (f, row) => { f.snapshot.plots.find(p => p.id === row.plotId).projectName = 'different-project'; }, 'PLOT_BINDING_CHANGED'],
  ['inactive owner', (f, row) => { f.snapshot.roles.find(r => r.id === row.ownerUserId).active = false; }, 'ACTIVE_SALES_OWNER_REQUIRED'],
]) test(label + ' becomes an explicit blocker', () => {
  const f = fixture(); mutate(f, f.plan.rows[0]);
  const r = result(f);
  assert(r.issues.find(x => x.sourceRow === 2)?.codes.includes(code));
  assert(r.blockers.includes('FRESH_BINDING_ISSUES'));
});

test('cancellation cannot overwrite a booking that has since advanced to contracted', () => {
  const f = fixture(), row = f.plan.rows.find(r => r.sourceRow === 926);
  f.snapshot.sales.find(s => s.id === row.saleId).stage = 'contracted';
  assert(result(f).issues.find(x => x.sourceRow === 926)?.codes.includes('CANCELLATION_BASELINE_ADVANCED'));
});

test('stock is checked from both plot flag and complete sale inventory', () => {
  const f = fixture(), row = f.plan.rows.find(r => r.sourceRow === 964);
  f.snapshot.sales.push({ id: 'newer-sale', plotId: row.plotId, stage: 'booked' });
  f.snapshot.counts.sales++;
  assert(result(f).issues.find(x => x.sourceRow === 964)?.codes.includes('NEW_BOOKING_STOCK_OCCUPIED'));
});

test('new historical creations cannot be applied to newly closed projects', () => {
  const f = fixture(); f.snapshot.projects.find(p => p.name === 'โยริว').is_closed = true;
  assert(result(f).issues.find(x => x.sourceRow === 438)?.codes.includes('OPEN_PROJECT_REQUIRED'));
});

test('incomplete capture and duplicate entity identifiers are rejected', () => {
  const f = fixture(); f.snapshot.sales.pop();
  assert.throws(() => result(f), /COMPLETE_CAPTURE_REQUIRED/);
  const g = fixture(); g.snapshot.customers[0] = structuredClone(g.snapshot.customers[1]);
  assert.throws(() => result(g), /INVALID_CUSTOMERS_CAPTURE/);
});

test('reappearing rental records block replacement after the previous reset', () => {
  const f = fixture(); f.snapshot.counts.rentalContracts = 1;
  assert(result(f).blockers.includes('RENTAL_DATA_REAPPEARED'));
});

test('rental retirement does not assume a plot is vacant when another sale remains', () => {
  const f = fixture(), row = f.plan.rows.find(r => r.sourceRow === 859);
  f.snapshot.sales.push({ id: 'another-buying-customer', plotId: row.plotId, stage: 'booked', interestId: 'another-interest' });
  f.snapshot.counts.sales++;
  const r = result(f).retirementReview.find(x => x.sourceRow === 859);
  assert(r.otherSalesOnPlot.some(s => s.id === 'another-buying-customer' && s.stage === 'booked'));
  assert.equal(r.executable, false);
});
