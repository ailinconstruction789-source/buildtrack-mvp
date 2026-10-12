import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { prepareTransferForecastPlan } from './plan-transfer-forecasts.mjs';
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const seal = (value, key) => { delete value[key]; value[key] = digest(value); return value; };
function fixture() {
  const sourceSha256 = 'a'.repeat(64), project = 'Project', batchId = id(900);
  const stages = ['booked', 'transferred', 'cancelled', 'booked', 'booked', 'booked', 'booked'];
  const rows = stages.map((stage, index) => ({ rowNumber: index + 2, hidden: false,
    values: [...Array(15).fill(null), index === 4 ? '-' : '2026-10-30', null], formulaColumns: [] }));
  const extraction = { sha256: sourceSha256, headers: [...Array(15).fill(null), 'วันที่คาดว่าจะโอน', null], rows };
  const catalog = { projectRef: 'kbthmdedilswdmmczfay', plots: stages.map((_, i) => ({ id: `p${i}`, projectName: project })) };
  const plan = { version: 'customer-workbook-review-plan-v1', sourceSha256, layout: { version: 'expected-transfer-in-P', expectedTransferSourceColumn: 'P' },
    importReady: false, businessWritesAllowed: false, lostChangesAllowed: false,
    rows: rows.map((row, i) => ({ sourceRow: row.rowNumber, sourceKey: digest(['source', row.rowNumber]), rowSha256: digest(row),
      expectedTransferDate: i === 4 ? null : row.values[15], sourceStage: stages[i], sourceEvents: [{ kind: 'booked', date: null, precision: 'unknown' }] })) };
  seal(plan, 'planDigest');
  const confirmation = { sourceSha256, planDigest: plan.planDigest, catalogDigest: digest(catalog), businessWritesAllowed: false, lostChangesAllowed: false };
  seal(confirmation, 'confirmationDigest');
  const plotConfirmation = { sourceSha256, mappings: [{ sourceRow: 2, candidatePlotId: 'p0', approved: true }], businessWritesAllowed: false, lostChangesAllowed: false };
  seal(plotConfirmation, 'confirmationDigest');
  const reference = { readOnly: true, projectRef: catalog.projectRef, capturedAt: '2026-10-10T00:00:00Z', rows: stages.map((stage, i) => ({
    batchId, sourceRow: i + 2, customerId: id(i + 10), customerMergedIntoId: null,
    interests: [{ id: id(i + 20), projectName: project }], booking: { liveSaleId: id(i + 30) } })) };
  const bindings = plan.rows.map((row, i) => ({ sourceRow: row.sourceRow, sourceKey: row.sourceKey, matchKind: 'exact_historical_source_evidence',
    priorBatchId: batchId, priorSourceRow: row.sourceRow, proposedCustomerId: id(i + 10), proposedInterestId: id(i + 20),
    confirmedProjects: [project], resolvedPlotId: `p${i}`, leadingZeroPlotProposal: i === 0 ? { id: 'p0' } : null,
    retainedSourceIssues: i === 6 ? ['PAYMENT_METHOD_REVIEW'] : [], holds: [],
    priorBooking: { liveSaleId: id(i + 30), preparedSaleId: id(i + 30), linkedCustomerId: id(i + 10), linkedInterestId: id(i + 20),
      plotId: `p${i}`, livePlotId: `p${i}`, stage: stages[i], liveStage: stages[i] } }));
  bindings[3].matchKind = 'user_confirmed_source_revision'; bindings[3].holds = ['CONFIRMED_SOURCE_DEAL_CHANGE_REQUIRES_CANONICAL_PLAN'];
  bindings[5].proposedCustomerId = null; bindings[5].proposedInterestId = null; bindings[5].priorBooking = null;
  const revisionConfirmation = { sourceSha256, planDigest: plan.planDigest, businessWritesAllowed: false, lostChangesAllowed: false,
    columnSemantics: { physicalColumn: 'P', field: 'expectedTransferDate', actualTransferDateFieldUnchanged: true },
    mappings: [{ sourceRow: 5, sourceRowSha256: plan.rows[3].rowSha256, proposedCustomerId: bindings[3].proposedCustomerId,
      proposedInterestId: bindings[3].proposedInterestId, expectedTransferDate: plan.rows[3].expectedTransferDate, sourceStage: 'booked',
      samePriorCustomerConfirmed: true, latestSourceValuesConfirmed: true, canonicalWritesAllowed: false }] };
  seal(revisionConfirmation, 'confirmationDigest');
  const reconciliation = { version: 'customer-workbook-reconciliation-v1', sourceSha256, planDigest: plan.planDigest,
    confirmationDigest: confirmation.confirmationDigest, plotConfirmationDigest: plotConfirmation.confirmationDigest,
    sourceRevisionConfirmationDigest: revisionConfirmation.confirmationDigest, referenceDigest: digest(reference), catalogDigest: digest(catalog),
    importReady: false, businessWritesAllowed: false, lostChangesAllowed: false, productionChanged: false, rows: bindings };
  seal(reconciliation, 'reconciliationDigest');
  return { extraction, plan, reconciliation, confirmation, plotConfirmation, revisionConfirmation, reference, catalog };
}
function resealReconciliation(f) { seal(f.reconciliation, 'reconciliationDigest'); }

test('classifies booking, historical, held and unknown forecasts without actual-date writes', () => {
  const f = fixture(), result = prepareTransferForecastPlan(f);
  assert.deepEqual(result.counts, { sourceRows: 7, knownForecasts: 6, existingBookingCandidates: 1, historicalForecastsOnly: 2, heldForecasts: 3, unknownForecastsNoWrite: 1 });
  assert.equal(result.rows[4].expectedTransferDate, null);
  assert.equal(result.unknownForecastIsClearInstruction, false);
  assert.equal(result.businessWritesAllowed, false);
  assert(result.rows.every(row => !row.actualTransferDateWillChange && !row.plotForecastWillChange && !row.canonicalWritesAllowed));
  assert.deepEqual(result.rows[0].sourceActualEvents, f.plan.rows[0].sourceEvents);
});
test('rejects altered source bytes or row content despite unchanged plan', () => {
  for (const change of [f => { f.extraction.sha256 = 'b'.repeat(64); }, f => { f.extraction.rows[0].values[15] = '2027-01-01'; }]) {
    const f = fixture(); change(f); assert.throws(() => prepareTransferForecastPlan(f));
  }
});
test('rejects stale or changed approval receipts', () => {
  for (const key of ['confirmation', 'plotConfirmation', 'revisionConfirmation']) {
    const f = fixture(); f[key].sourceSha256 = 'b'.repeat(64); seal(f[key], 'confirmationDigest');
    assert.throws(() => prepareTransferForecastPlan(f), /PINNED_APPROVAL_REQUIRED/);
  }
});
test('requires complete source-row coverage', () => {
  const f = fixture(); f.reconciliation.rows.pop(); resealReconciliation(f);
  assert.throws(() => prepareTransferForecastPlan(f), /SOURCE_COVERAGE_REQUIRED/);
});
test('never accepts a forecast from Q or a formula in P', () => {
  for (const change of [f => { f.extraction.headers[16] = 'forecast'; }, f => { f.extraction.rows[0].formulaColumns = [15]; }]) {
    const f = fixture(); change(f); assert.throws(() => prepareTransferForecastPlan(f), /PHYSICAL_COLUMN_P_REQUIRED/);
  }
});
test('holds mismatched Customer, Interest, Sale or plot instead of guessing', () => {
  for (const change of [row => { row.priorBooking.linkedCustomerId = id(999); }, row => { row.priorBooking.linkedInterestId = id(999); },
    row => { row.priorBooking.liveSaleId = id(999); }, row => { row.resolvedPlotId = 'another-plot'; }]) {
    const f = fixture(); f.reconciliation.rows[0].leadingZeroPlotProposal = null; change(f.reconciliation.rows[0]); resealReconciliation(f);
    const result = prepareTransferForecastPlan(f); assert.equal(result.rows[0].disposition, 'held_forecast');
    assert.equal(result.rows[0].proposedSaleId, null);
  }
});
test('keeps a confirmed source revision held for the separate canonical deal plan', () => {
  const r = prepareTransferForecastPlan(fixture()).rows[3];
  assert.equal(r.disposition, 'held_forecast'); assert(r.holds.includes('CONFIRMED_SOURCE_DEAL_CHANGE_REQUIRES_CANONICAL_PLAN'));
});
test('does not reuse a cancelled/transferred sale for a changed source stage', () => {
  const f = fixture(); f.reconciliation.rows[0].priorBooking.stage = 'cancelled'; f.reconciliation.rows[0].priorBooking.liveStage = 'cancelled'; resealReconciliation(f);
  const row = prepareTransferForecastPlan(f).rows[0]; assert.equal(row.disposition, 'held_forecast');
  assert(row.holds.includes('SOURCE_STAGE_CHANGE_REQUIRES_CANONICAL_PLAN'));
});
test('does not bypass an unapproved leading-zero plot receipt', () => {
  const f = fixture(); f.plotConfirmation.mappings[0].approved = false; seal(f.plotConfirmation, 'confirmationDigest');
  f.reconciliation.plotConfirmationDigest = f.plotConfirmation.confirmationDigest; resealReconciliation(f);
  assert.throws(() => prepareTransferForecastPlan(f), /PLOT_CONFIRMATION_REQUIRED/);
});
test('holds a merged customer binding and rental rows without a program decision', () => {
  const f = fixture(); f.reference.rows[0].customerMergedIntoId = id(999);
  f.reconciliation.referenceDigest = digest(f.reference); resealReconciliation(f);
  const result = prepareTransferForecastPlan(f);
  assert.equal(result.rows[0].disposition, 'held_forecast');
  assert(result.rows[6].holds.includes('RENTAL_TYPE_AND_HISTORY_REQUIRED'));
});
