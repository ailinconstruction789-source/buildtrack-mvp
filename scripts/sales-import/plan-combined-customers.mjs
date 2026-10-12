// Offline, redacted plan. This is neither a production importer nor write authorization.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { extractWorkbook, prepareWorkbookDraft, workspacePath } from './review-workbook.mjs';
import { prepareTransferForecastPlan } from './plan-transfer-forecasts.mjs';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const digest = value => hash(JSON.stringify(value));
const check = (ok, code) => { if (!ok) throw new Error(code); };
const uuid = value => typeof value === 'string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function holdOccupiedPlots(rows, sales) {
  const finalSales = new Map(sales.map(sale => [sale.id, sale]));
  const claimed = new Set();
  for (const row of rows.filter(row => row.disposition !== 'held' && row.sourceStage !== 'visited')) {
    const key = row.saleId ?? row.newBookingCandidateKey;
    check(key && !claimed.has(key), 'DUPLICATE_BOOKING_TARGET'); claimed.add(key);
    finalSales.set(key, { id: key, plotId: row.plotId, stage: row.sourceStage });
  }
  const occupied = new Map();
  for (const sale of finalSales.values()) if (sale.stage !== 'cancelled') {
    const ids = occupied.get(sale.plotId) ?? []; ids.push(sale.id); occupied.set(sale.plotId, ids);
  }
  for (const row of rows) if (row.disposition !== 'held' && !['visited','cancelled'].includes(row.sourceStage)
    && (occupied.get(row.plotId)?.length ?? 0) > 1) {
    row.holds.push('ACTIVE_PLOT_CONFLICT_IN_CAPTURED_OR_PROPOSED_SALES'); row.disposition = 'held';
  }
  return rows;
}

export function prepareCombinedCustomerPlan(inputs) {
  const { extraction, plan, reconciliation, reference, catalog, confirmation, revisionConfirmation, forecastPlan } = inputs;
  const forecasts = prepareTransferForecastPlan(inputs);
  check(forecastPlan.forecastPlanDigest === forecasts.forecastPlanDigest && same(forecastPlan, forecasts), 'FORECAST_PLAN_CHANGED');
  const { draft } = prepareWorkbookDraft(extraction, plan.inspectionDate);
  const entries = new Map(draft.entries.map(entry => [entry.sourceRow, entry]));
  const bindings = new Map(reconciliation.rows.map(row => [row.sourceRow, row]));
  const prior = new Map(reference.rows.map(row => [`${row.batchId}:${row.sourceRow}`, row]));
  const revisions = new Map(revisionConfirmation.mappings.map(row => [row.sourceRow, row]));
  const roles = new Map(reference.roles.map(role => [role.userId, role]));
  const partitionByRow = new Map();
  const customerClaims = new Map();
  for (const partition of reconciliation.partitions) {
    for (const row of partition.sourceRows) {
      check(!partitionByRow.has(row), 'DUPLICATE_IDENTITY_PARTITION'); partitionByRow.set(row, partition);
    }
    if (partition.proposedCustomerId) {
      check(!customerClaims.has(partition.proposedCustomerId), 'DISTINCT_PEOPLE_SHARE_CUSTOMER');
      customerClaims.set(partition.proposedCustomerId, partition);
    }
  }
  check(partitionByRow.size === plan.rows.length, 'IDENTITY_COVERAGE_REQUIRED');
  const customers = new Map(), interests = new Map(), sales = new Map();
  for (const row of reference.rows) {
    if (row.customerId && !row.customerMergedIntoId) {
      const customer = { id: row.customerId, nameHash: row.customerNameHash, ownerUserId: row.customerOwnerUserId };
      check(!customers.has(customer.id) || same(customers.get(customer.id), customer), 'INCONSISTENT_EXISTING_CUSTOMER');
      customers.set(customer.id, customer);
      for (const interest of row.interests) {
        const value = { id: interest.id, customerId: row.customerId, projectName: interest.projectName, ownerUserId: interest.ownerUserId };
        check(!interests.has(value.id) || same(interests.get(value.id), value), 'INCONSISTENT_EXISTING_INTEREST');
        interests.set(value.id, value);
      }
    }
    const booking = row.booking;
    if (booking?.liveSaleId) {
      check(uuid(booking.liveSaleId) && booking.livePlotId && interests.has(booking.linkedInterestId)
        && booking.linkedCustomerId === row.customerId, 'REFERENCE_SALE_BINDING_INVALID');
      const value = { id: booking.liveSaleId, customerId: booking.linkedCustomerId, interestId: booking.linkedInterestId,
        plotId: booking.livePlotId, stage: booking.liveStage, projectName: interests.get(booking.linkedInterestId).projectName,
        sourceBookingKey: booking.key };
      check(!sales.has(value.id) || same(sales.get(value.id), value), 'INCONSISTENT_EXISTING_SALE');
      sales.set(value.id, value);
    }
  }
  const rows = plan.rows.map(source => {
    const binding = bindings.get(source.sourceRow), entry = entries.get(source.sourceRow);
    const old = prior.get(`${binding.priorBatchId}:${binding.priorSourceRow}`), partition = partitionByRow.get(source.sourceRow);
    const receipt = revisions.get(source.sourceRow);
    const holds = binding.holds.filter(hold => hold !== 'CONFIRMED_SOURCE_DEAL_CHANGE_REQUIRES_CANONICAL_PLAN');
    const role = roles.get(binding.proposedSalesOwnerUserId);
    if (!role || role.role !== 'sales' || !role.isActive) holds.push('ACTIVE_SALES_OWNER_REQUIRED');
    if (entry.issues.some(issue => issue.endsWith('_DATE_REVIEW') || ['PRIMARY_INPUT_FORMULA_REVIEW','STATUS_MAPPING_REQUIRED','SALE_PRICE_REVIEW'].includes(issue))) {
      holds.push('SOURCE_VALUE_REVIEW_REQUIRED');
    }
    if (entry.issues.includes('PAYMENT_METHOD_REVIEW')) holds.push('RENTAL_TYPE_AND_HISTORY_REQUIRED');
    const customerId = binding.proposedCustomerId, interestId = binding.proposedInterestId;
    const interest = interests.get(interestId);
    if (!uuid(customerId) || partition.proposedCustomerId !== customerId || !old || old.customerId !== customerId
      || old.customerMergedIntoId || hash(entry.proposal.customerName ?? '') !== old.customerNameHash) holds.push('EXACT_CUSTOMER_BINDING_REQUIRED');
    if (!interest || interest.customerId !== customerId || binding.confirmedProjects.length !== 1
      || interest.projectName !== binding.confirmedProjects[0]) holds.push('EXACT_INTEREST_BINDING_REQUIRED');
    let saleId = binding.priorBooking?.liveSaleId ?? null;
    let action = source.sourceStage === 'visited' ? 'retain_customer_and_visit_history' : 'retain_existing_booking_history';
    if (source.sourceStage !== 'visited') {
      const plot = catalog.plots.find(plot => plot.id === binding.resolvedPlotId && plot.projectName === interest?.projectName);
      if (!plot) holds.push('EXACT_BOOKING_PLOT_REQUIRED');
      if (saleId) {
        const sale = sales.get(saleId);
        if (!sale || sale.customerId !== customerId || sale.interestId !== interestId || sale.plotId !== binding.resolvedPlotId
          || sale.stage !== binding.priorBooking.stage) holds.push('LIVE_BOOKING_CHANGED_OR_LINK_MISMATCH');
        if (receipt) action = 'propose_existing_booking_revision';
        else if (source.sourceStage !== sale?.stage) holds.push('UNAPPROVED_STAGE_CHANGE');
      } else if (receipt?.samePriorCustomerConfirmed && source.sourceStage === 'booked' && !binding.priorBooking) {
        action = 'propose_new_booking_for_existing_customer';
      } else holds.push('EXISTING_SALE_BINDING_REQUIRED');
    }
    if (receipt) check(receipt.latestSourceValuesConfirmed === true && receipt.sourceRowSha256 === source.rowSha256
      && receipt.sourceStage === source.sourceStage && receipt.sourceSalePrice === source.salePrice
      && same(receipt.sourceEvents, source.sourceEvents), 'SOURCE_REVISION_RECEIPT_CHANGED');
    return { sourceRow: source.sourceRow, sourceKey: source.sourceKey, rowSha256: source.rowSha256,
      customerPartitionKey: partition.sourceCandidateKey, customerId, interestId, saleId,
      newBookingCandidateKey: action === 'propose_new_booking_for_existing_customer' ? digest([plan.sourceSha256, 'booking', source.sourceRow]) : null,
      sourceStage: source.sourceStage, priorStage: saleId ? sales.get(saleId)?.stage ?? null : null,
      projectName: interest?.projectName ?? null, plotId: binding.resolvedPlotId ?? null,
      sourceSalesOwnerUserId: binding.proposedSalesOwnerUserId,
      sourceHistory: source.sourceEvents, salePrice: source.salePrice,
      pricePolicy: source.salePrice === null ? 'unknown_preserve_existing' : 'propose_source_value',
      expectedTransferDate: source.expectedTransferDate,
      forecastPolicy: source.expectedTransferDate === null ? 'unknown_preserve_existing' : 'per_booking_forecast',
      mortgageNoteHash: hash(JSON.stringify(entry.rawValues[8])),
      structuredBank: null, bankPolicy: 'preserve_existing_no_inference_from_note',
      actualTimestamps: null, actualTimestampPolicy: 'source_day_precision_only_no_synthetic_timestamp',
      customerOwnerPolicy: 'preserve_existing', interestOwnerPolicy: 'preserve_existing',
      action, holds: [...new Set(holds)], sourceIssuesRetained: entry.issues,
      disposition: holds.length ? 'held' : 'relational_rehearsal_candidate',
      leadReplayAllowed: false, canonicalWritesAllowed: false };
  });
  // Resolve occupancy against every captured sale, including held rows and transferred units.
  holdOccupiedPlots(rows, [...sales.values()]);
  const result = { version: 'customer-combined-plan-v1', sourceSha256: plan.sourceSha256, inspectionDate: plan.inspectionDate,
    planDigest: plan.planDigest, reconciliationDigest: reconciliation.reconciliationDigest, forecastPlanDigest: forecastPlan.forecastPlanDigest,
    confirmationDigest: confirmation.confirmationDigest, sourceRevisionConfirmationDigest: revisionConfirmation.confirmationDigest,
    referenceCapturedAt: reference.capturedAt, catalogDigest: digest(catalog),
    identityPartitions: confirmation.sourceIdentityPartitions.map(part => ({ sourceRows: part.sourceRows, candidateKey: part.sourceCandidateKey })),
    baseline: { roles: reference.roles.map(({ userId, role, isActive }) => ({ userId, role, isActive })),
      plots: catalog.plots.map(({ id, projectName }) => ({ id, projectName })), customers: [...customers.values()],
      interests: [...interests.values()], sales: [...sales.values()], financialAndDateStateCaptured: false },
    counts: { sourceRows: rows.length, candidates: rows.filter(row => row.disposition !== 'held').length,
      heldRows: rows.filter(row => row.disposition === 'held').length,
      existingBookingRevisions: rows.filter(row => row.disposition !== 'held' && row.action === 'propose_existing_booking_revision').length,
      newBookingCandidates: rows.filter(row => row.disposition !== 'held' && row.newBookingCandidateKey).length,
      bankUpdates: 0, syntheticLeads: 0 }, rows,
    trialOnly: true, trialModel: 'private relational rehearsal; not production guard or authenticated-writer verification',
    freshCompleteOccupancyAndRoleRecheckRequired: true, canonicalImportReady: false, businessWritesAllowed: false,
    lostChangesAllowed: false, productionChanged: false, customerNamesIncluded: false, phoneValuesIncluded: false };
  result.combinedPlanDigest = digest(result);
  return result;
}
export function planCombinedCustomerFile(options) {
  const keys = ['plan','reconciliation','confirmation','plotConfirmation','revisionConfirmation','reference','catalog','forecastPlan'];
  const inputs = Object.fromEntries(keys.map(key => { const path = workspacePath(options[key]); return [key, { path, bytes: readFileSync(path) }]; }));
  const parsed = Object.fromEntries(Object.entries(inputs).map(([key, input]) => [key, JSON.parse(input.bytes)]));
  const source = workspacePath(options.source), sourceHash = hash(readFileSync(source)), output = workspacePath(options.output);
  check(sourceHash === parsed.plan.sourceSha256, 'SOURCE_HASH_CHANGED');
  const rel = relative(realpathSync(workspacePath('reports')), realpathSync(dirname(output)));
  check(rel !== '..' && !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !rel.includes(':')
    && output.startsWith(`${workspacePath('reports')}${process.platform === 'win32' ? '\\' : '/'}`)
    && output.endsWith('.json') && !existsSync(output), 'UNUSED_REPORT_PATH_REQUIRED');
  const extraction = extractWorkbook({ python: options.python, source, sourceSha256: sourceHash, inspectionDate: parsed.plan.inspectionDate });
  const plan = prepareCombinedCustomerPlan({ extraction, ...parsed });
  check(hash(readFileSync(source)) === sourceHash && Object.values(inputs).every(input => readFileSync(input.path).equals(input.bytes)), 'INPUT_CHANGED_DURING_REVIEW');
  writeFileSync(output, `${JSON.stringify(plan, null, 2)}\n`, { flag: 'wx', mode: 0o600 }); return plan;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    check(process.argv.length === 3, 'OPTIONS_FILE_REQUIRED');
    const result = planCombinedCustomerFile(JSON.parse(readFileSync(workspacePath(process.argv[2]), 'utf8')));
    process.stdout.write(`${JSON.stringify({ status: 'combined_offline_plan_created', counts: result.counts, combinedPlanDigest: result.combinedPlanDigest })}\n`);
  } catch (error) {
    process.stderr.write(`COMBINED_PLAN_FAILED: ${/^[A-Z_]+$/.test(error.message) ? error.message : 'CHECK_PINNED_INPUTS'}\n`); process.exitCode = 1;
  }
}
