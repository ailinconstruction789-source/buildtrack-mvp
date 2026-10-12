import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fieldFingerprint, reconcileWorkbook } from './reconcile-workbook.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const digest = value => hash(JSON.stringify(value));
const reseal = value => { delete value.confirmationDigest; value.confirmationDigest = digest(value); };
function fixture() {
  const sha = 'a'.repeat(64), ownerId = '11111111-1111-4111-8111-111111111111';
  const catalog = { projectRef: 'kbthmdedilswdmmczfay', projects: [{ name: 'Project' }],
    plots: [{ id: 'p8', projectName: 'Project', plotName: '8' }] };
  const entries = [3, 193, 112, 790].map((row, i) => ({ sourceRow: row, sourceKey: digest(['source', row]),
    rawValues: ['2024-01-01', '2024-01-02', i < 2 ? 'Person A' : 'Person B', 'work', 'AL3', i < 2 ? '08' : null,
      'calculated', i === 1 ? 'cancelled' : 'transferred', 'note', i === 1 ? '2024-02-01' : null,
      i === 1 ? null : '2024-02-01', 'Employee', 100, 10, 'formula', null, null],
    proposal: { customerName: i < 2 ? 'Person A' : 'Person B', sourceOwnerLabel: 'Employee', projectLabels: ['AL3'],
      targetPlotLabel: i < 2 ? '08' : null, booking: i < 2 ? { stage: i === 1 ? 'cancelled' : 'transferred' } : null }, issues: [] }));
  // The two distinct People B rows differ in actual visit evidence.
  entries[3].rawValues[0] = '2024-01-03';
  const planBody = { version: 'customer-workbook-review-plan-v1', sourceSha256: sha,
    rows: entries.map(e => ({ sourceRow: e.sourceRow })),
    identityGroups: [{ group: 'N001', rows: [3, 193] }, { group: 'N002', rows: [112, 790] }] };
  const plan = { ...planBody, planDigest: digest(planBody) };
  const parts = [[3, 193], [112], [790]];
  const c = { version: 'customer-workbook-human-confirmation-v1', sourceSha256: sha, planDigest: plan.planDigest,
    catalogDigest: digest(catalog), businessWritesAllowed: false, canonicalImportReady: false, lostChangesAllowed: false, leadReplayAllowed: false,
    sourceIdentityPartitions: parts.map(rows => ({ sourceRows: rows, sourceCandidateKey: digest([sha, 'customer', rows]), canonicalCustomerId: null })),
    identityGroups: [{ group: 'N001', rows: [3, 193], decision: 'same_person', customerPartitions: [[3, 193]] },
      { group: 'N002', rows: [112, 790], decision: 'distinct_people', customerPartitions: [[112], [790]] }],
    ownerMappings: [{ sourceLabel: 'Employee', proposedLogin: 'SALES', candidateUserIds: [ownerId], confirmedForNewSource: true }],
    projectMappings: [{ sourceLabel: 'AL3', proposedProjectName: 'Project', confirmed: true }] };
  reseal(c);
  const reference = { version: 'customer-reconciliation-reference-v1', projectRef: catalog.projectRef, readOnly: true,
    roles: [{ userId: ownerId, role: 'sales', displayName: 'SALES', isActive: true }], rows: entries.map((e, i) => {
      const customerId = i < 2 ? 'customer-a' : `customer-${i}`;
      return { batchId: 'old-batch', sourceRow: e.sourceRow + 10, fieldHashes: e.rawValues.map(fieldFingerprint),
        customerId, customerMergedIntoId: null, customerNameHash: hash(e.proposal.customerName),
        interests: [{ id: `interest-${customerId}`, projectName: 'Project' }],
        booking: i < 2 ? { stage: e.proposal.booking.stage, key: `booking-${i}`, plotId: 'p8',
          linkedCustomerId: customerId, linkedInterestId: `interest-${customerId}`, liveSaleId: null } : null };
    }) };
  return { draft: { sha256: sha, entries }, plan, confirmation: c, reference, catalog };
}

test('fingerprints scalar types and Unicode exactly as the PostgreSQL example', () => {
  assert.equal(hash('string:3:กขค|number:4:1234|null:0:'), '9cf29dd3c6b1671c87743f22efb8cf52ae22304f4aa58ef7d84750a08e4c1da6');
  assert.notEqual(fieldFingerprint(null), fieldFingerprint(''));
  assert.notEqual(fieldFingerprint(100), fieldFingerprint('100'));
  assert.throws(() => fieldFingerprint({}), /SCALAR_REQUIRED/);
});
test('matches historical evidence across moved rows and keeps two N001 purchases', () => {
  const r = reconcileWorkbook(fixture());
  assert.equal(r.counts.exactHistoricalMatches, 4);
  assert.equal(r.partitions[0].proposedCustomerId, 'customer-a');
  assert.deepEqual(r.rows.slice(0, 2).map(row => row.priorBooking.stage), ['transferred', 'cancelled']);
  assert.equal(r.rows[0].priorSourceRow, 13);
  assert.equal(r.importReady, false);
  assert.equal(r.businessWritesAllowed, false);
  assert.equal(r.counts.approvedProductionBindings, 0);
});
test('forecast changes remain visible without substituting actual history', () => {
  const f = fixture(); f.draft.entries[0].rawValues[15] = 'old month removed'; f.draft.entries[0].rawValues[16] = '2028-01-01';
  const r = reconcileWorkbook(f);
  assert.equal(r.rows[0].matchKind, 'exact_historical_source_evidence');
  assert.deepEqual(r.rows[0].differentSourceColumns, [16, 17]);
  assert.equal(r.exclusions.changedValuesRetainedForReview, true);
});
test('price or historical-date change cannot acquire a binding from name/visit alone', () => {
  for (const col of [1, 9, 10, 12]) {
    const f = fixture(); f.draft.entries[0].rawValues[col] = 'changed';
    const row = reconcileWorkbook(f).rows[0];
    assert.equal(row.proposedCustomerId, null);
    assert.equal(row.reviewAlternatives.length, 2);
    assert.ok(row.reviewAlternatives.every(candidate => candidate.bindingAllowed === false));
    assert.ok(row.reviewAlternatives.some(candidate => candidate.differentColumns.includes(col + 1)));
  }
});
test('duplicate evidence stays ambiguous', () => {
  const f = fixture(); f.reference.rows.push({ ...structuredClone(f.reference.rows[0]), sourceRow: 999 });
  const r = reconcileWorkbook(f);
  assert.equal(r.rows[0].matchKind, 'ambiguous');
  assert.equal(r.rows[0].proposedCustomerId, null);
});
test('distinct people cannot silently reuse one prior customer', () => {
  const f = fixture(); f.reference.rows[3].customerId = f.reference.rows[2].customerId;
  const r = reconcileWorkbook(f);
  assert.equal(r.counts.partitionsWithSharedPriorCustomerConflict, 2);
  assert.ok(r.partitions.slice(1).every(p => p.proposedCustomerId === null));
});
test('same person with multiple prior IDs requires a reviewed merge', () => {
  const f = fixture(); f.reference.rows[1].customerId = 'other-prior-customer';
  const p = reconcileWorkbook(f).partitions[0];
  assert.equal(p.proposedCustomerId, null);
  assert.ok(p.holds.includes('PRIOR_CUSTOMERS_REQUIRE_REVIEWED_MERGE'));
});
test('leading-zero plot proposal is explicit and never approved', () => {
  const r = reconcileWorkbook(fixture()).rows[0];
  assert.equal(r.exactPlotId, null);
  assert.deepEqual(r.leadingZeroPlotProposal, { id: 'p8', label: '8', approved: false });
  assert.equal(r.priorLinkedPlotProposal.requiresReview, true);
  assert.ok(r.holds.includes('PLOT_LABEL_REVIEW'));
});
test('changed roles, renamed/merged customers, or divergent live bookings remain held', () => {
  const f = fixture(); f.reference.roles[0].isActive = false;
  f.reference.rows[0].customerNameHash = hash('Renamed');
  f.reference.rows[1].customerMergedIntoId = 'new-id';
  f.reference.rows[1].booking.liveSaleId = 'live'; f.reference.rows[1].booking.liveStage = 'transferred';
  const r = reconcileWorkbook(f);
  assert.ok(r.rows[0].holds.includes('SALES_OWNER_REQUIRED_OR_ROLE_CHANGED'));
  assert.ok(r.rows[0].holds.includes('CURRENT_CUSTOMER_NAME_CHANGED'));
  assert.equal(r.rows[0].proposedCustomerId, null);
  assert.equal(r.rows[1].proposedCustomerId, null);
  assert.ok(r.rows[1].holds.includes('LIVE_SALE_CHANGED_PRESERVE_CURRENT'));
});
test('rejects stale approvals and inconsistent partitions', () => {
  const f = fixture(); f.confirmation.sourceSha256 = 'b'.repeat(64); reseal(f.confirmation);
  assert.throws(() => reconcileWorkbook(f), /PINNED_APPROVAL_REQUIRED/);
  const g = fixture(); g.confirmation.sourceIdentityPartitions[1].sourceRows = [112, 790]; reseal(g.confirmation);
  assert.throws(() => reconcileWorkbook(g), /PARTITION_INVALID/);
  const h = fixture(); h.confirmation.identityGroups[1].decision = 'same_person'; reseal(h.confirmation);
  assert.throws(() => reconcileWorkbook(h), /IDENTITY_CONFIRMATION_REQUIRED/);
});
