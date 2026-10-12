// Offline review only. No connection, UUID allocation, SQL execution or business writes.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadRemainingSourceInputs } from './prepare-remaining-canonical-inputs.mjs';
import { workspacePath } from './review-workbook.mjs';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const check = (condition, code) => { if (!condition) throw new Error(code); };
const excluded = new Set(['skip_rental', 'hold_identity']);
const index = (rows, label) => {
  check(Array.isArray(rows) && rows.every(r => typeof r.id === 'string')
    && new Set(rows.map(r => r.id)).size === rows.length, `INVALID_${label}_CAPTURE`);
  return new Map(rows.map(r => [r.id, r]));
};

export function prepareCustomerReplacementPreflight({ plan, snapshot }) {
  const { adapterPlanDigest, ...body } = plan;
  check(digest(body) === adapterPlanDigest && plan.businessWritesAllowed === false
    && plan.canonicalImportReady === false, 'SEALED_ADAPTER_PLAN_REQUIRED');
  check(new Set(plan.rows.map(r => r.sourceRow)).size === plan.rows.length, 'UNIQUE_SOURCE_ROWS_REQUIRED');
  check(snapshot.projectId === 'kbthmdedilswdmmczfay' && Number.isFinite(Date.parse(snapshot.capturedAt)), 'DATED_TARGET_CAPTURE_REQUIRED');
  const customers = index(snapshot.customers, 'CUSTOMERS');
  const interests = index(snapshot.interests, 'INTERESTS');
  const sales = index(snapshot.sales, 'SALES');
  const plots = index(snapshot.plots, 'PLOTS');
  const roles = index(snapshot.roles, 'ROLES');
  for (const [name, rows] of Object.entries({ customers, interests, sales, plots })) {
    check(snapshot.counts[name] === rows.size, 'COMPLETE_CAPTURE_REQUIRED');
  }
  const eligible = plan.rows.filter(r => !excluded.has(r.route));
  const rentals = plan.rows.filter(r => r.route === 'skip_rental');
  const held = plan.rows.filter(r => r.route === 'hold_identity');
  const issues = [];
  const rowChecks = eligible.map(r => {
    const codes = [], c = customers.get(r.customerId), i = interests.get(r.interestId);
    const s = sales.get(r.saleId), p = plots.get(r.plotId), owner = roles.get(r.ownerUserId);
    if (r.customerId && !c) codes.push('CUSTOMER_MISSING');
    if (c?.mergedIntoId) codes.push('CUSTOMER_MERGED');
    if (r.interestId && (!i || i.customerId !== r.customerId)) codes.push('INTEREST_CUSTOMER_CHANGED');
    if (i && r.projectName !== null && i.projectName !== r.projectName) codes.push('INTEREST_PROJECT_CHANGED');
    if (r.saleId && (!s || s.interestId !== r.interestId || s.plotId !== r.plotId)) codes.push('SALE_BINDING_CHANGED');
    if (r.plotId && (!p || p.projectName !== r.projectName)) codes.push('PLOT_BINDING_CHANGED');
    if (!owner || owner.role !== 'sales' || !owner.active) codes.push('ACTIVE_SALES_OWNER_REQUIRED');
    if (r.route === 'source_bound_creation_review' && (r.customerId || r.interestId
      || !r.customerCandidateKey || !r.interestCandidateKey)) codes.push('SOURCE_ONLY_CREATION_REQUIRED');
    if (r.route === 'historical_lifecycle_review' && s?.stage !== 'booked') codes.push('CANCELLATION_BASELINE_ADVANCED');
    if (r.route === 'historical_booking_review' && (p?.occupied
      || snapshot.sales.some(a => a.plotId === r.plotId && a.stage !== 'cancelled'))) codes.push('NEW_BOOKING_STOCK_OCCUPIED');
    if (['source_bound_creation_review', 'historical_booking_review', 'historical_lifecycle_review'].includes(r.route)
      && !snapshot.projects.some(p => p.name === r.projectName && p.is_closed === false)) codes.push('OPEN_PROJECT_REQUIRED');
    if (codes.length) issues.push({ sourceRow: r.sourceRow, codes });
    return { sourceRow: r.sourceRow, route: r.route, customerId: r.customerId,
      interestId: r.interestId, saleId: r.saleId, plotId: r.plotId, ownerUserId: r.ownerUserId,
      sourceStage: r.sourceStage, projectName: r.projectName, checksPassed: codes.length === 0 };
  });
  const retirementReview = rentals.filter(r => r.saleId && sales.has(r.saleId)).map(r => {
    const sale = sales.get(r.saleId), interest = interests.get(sale.interestId);
    const valid = sale.interestId === r.interestId && sale.plotId === r.plotId && interest?.customerId === r.customerId;
    if (!valid) issues.push({ sourceRow: r.sourceRow, codes: ['RENTAL_SALE_BINDING_CHANGED'] });
    return { sourceRow: r.sourceRow, saleId: sale.id, customerId: r.customerId, interestId: sale.interestId,
      plotId: sale.plotId, liveStage: sale.stage, bindingVerified: valid,
      otherSalesOnPlot: snapshot.sales.filter(a => a.plotId === sale.plotId && a.id !== sale.id)
        .map(a => ({ id: a.id, stage: a.stage, interestId: a.interestId })),
      executable: false, requires: 'reviewed_source_bound_retirement_and_plot_reconciliation' };
  });
  const customerIds = new Set(eligible.filter(r => r.customerId).map(r => r.customerId));
  const interestIds = new Set(eligible.filter(r => r.interestId).map(r => r.interestId));
  const saleIds = new Set(eligible.filter(r => r.saleId).map(r => r.saleId));
  const creationKeys = new Set(eligible.filter(r => r.customerCandidateKey).map(r => r.customerCandidateKey));
  const activeFlags = snapshot.settings.flatMap(s => Object.entries(s)
    .filter(([key, value]) => (key.endsWith('_enabled') || key === 'booking_cutover_reviewed') && value === true)
    .map(([key]) => key));
  const requiredSchemas = ['sales_import_private', 'sales_unknown_history_private', 'sales_source_creation_private',
    'sales_revision_private', 'sales_history_read_private'];
  const missingSchemas = requiredSchemas.filter(n => !snapshot.privateSchemas.includes(n));
  const blockers = [];
  if (issues.length) blockers.push('FRESH_BINDING_ISSUES');
  if (missingSchemas.length) blockers.push('HISTORICAL_ADAPTERS_NOT_INSTALLED');
  if (retirementReview.length) blockers.push('SOURCE_RENTALS_STILL_IN_CANONICAL_SALES');
  if (snapshot.deleteGuards.some(g => g.enabled !== 'D')) blockers.push('RAW_DELETE_PROTECTED');
  if (activeFlags.length) blockers.push('REVIEWED_MAINTENANCE_WINDOW_REQUIRED');
  if (snapshot.counts.rentalContracts !== 0 || snapshot.counts.rentalPayments !== 0) blockers.push('RENTAL_DATA_REAPPEARED');
  // Even clean captures are review evidence, never permission to execute a reset.
  blockers.push('FULL_REPLACEMENT_REHEARSAL_AND_FRESH_BACKUP_REQUIRED');
  const result = {
    version: 'customer-replacement-preflight-v1', status: 'replacement_manifest_and_readonly_preflight_complete',
    capturedAt: snapshot.capturedAt, projectId: snapshot.projectId, sourceSha256: plan.sourceSha256,
    adapterPlanDigest, snapshotDigest: digest(snapshot),
    counts: { sourceRows: plan.rows.length, eligibleSourceRows: eligible.length, skippedRentalRows: rentals.length,
      heldIdentityRows: held.length, retainedExistingCustomerIds: customerIds.size,
      sourceBoundNewCustomerCandidates: creationKeys.size, proposedUniqueCustomerIdentities: customerIds.size + creationKeys.size,
      retainedExistingInterestIds: interestIds.size, retainedExistingSaleIds: saleIds.size,
      rentalRowsWithExistingCanonicalSales: retirementReview.length, bindingIssues: issues.length },
    liveCounts: snapshot.counts, rowChecks, issues, retirementReview,
    skippedRentalSourceRows: rentals.map(r => r.sourceRow), heldIdentitySourceRows: held.map(r => r.sourceRow),
    unmatchedExistingEntitiesForReview: {
      customers: snapshot.customers.filter(c => !customerIds.has(c.id)).map(c => c.id),
      interests: snapshot.interests.filter(i => !interestIds.has(i.id)).map(i => i.id),
      sales: snapshot.sales.filter(s => !saleIds.has(s.id)).map(s => s.id),
      deletionAllowed: false },
    installation: { missingSchemas, activeFlags, deleteGuardCount: snapshot.deleteGuards.length,
      dependentForeignKeyCount: snapshot.foreignKeys.length },
    blockers,
    policy: { reuseExactApprovedCustomerIds: true, identityMergeByName: false,
      unknownHistoryPreserved: true, expectedTransferColumn: 'P', inventUnknownPaymentMethod: false,
      excludeRentalImport: true, rentalEntryByUser: true, excludeHeldIdentities: true,
      leadReplay: false, legacyFollowUpLostSeparateFromHistoricalImport: true,
      plotConstructionAndStaffPreserved: true, oldSourceArchiveImmutable: true },
    execution: { ready: false, executable: false, productionChanged: false, businessWritesAllowed: false,
      schemaWritesAllowed: false, rawDeleteAllowed: false },
  };
  return { ...result, preflightDigest: digest(result) };
}

export function saveCustomerReplacementPreflight(output) {
  check(/^reports\/customer-replacement-preflight-[\w-]+\.json$/.test(output), 'UNUSED_REDACTED_OUTPUT_REQUIRED');
  const { redacted } = loadRemainingSourceInputs();
  const plan = JSON.parse(readFileSync(workspacePath('reports/canonical-customer-adapter-plan-2026-10-10.json')));
  check(plan.sourceSha256 === redacted.sourceSha256 && plan.adapterPlanDigest === redacted.adapterPlanDigest,
    'CURRENT_APPROVED_SOURCE_REQUIRED');
  const snapshotPath = workspacePath('reports/customer-replacement-live-reference-2026-10-10.json');
  const bytes = readFileSync(snapshotPath);
  const result = prepareCustomerReplacementPreflight({ plan, snapshot: JSON.parse(bytes) });
  check(readFileSync(snapshotPath).equals(bytes), 'CAPTURE_CHANGED_DURING_REVIEW');
  writeFileSync(workspacePath(output), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  return { output, counts: result.counts, blockers: result.blockers, preflightDigest: result.preflightDigest,
    currentWorkbookVerified: true, productionChanged: false };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  check(args.length === 2 && args[0] === '--output', 'Usage: --output reports/customer-replacement-preflight-DATE.json');
  console.log(JSON.stringify(saveCustomerReplacementPreflight(args[1])));
}
