// Offline forecast candidates only. No database client, execution SQL or write authorization.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { extractWorkbook, workspacePath } from './review-workbook.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const digest = value => hash(JSON.stringify(value));
const check = (ok, code) => { if (!ok) throw new Error(code); };
const uuid = value => typeof value === 'string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
const day = value => value === null || typeof value === 'string' && /^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
function sealed(value, key) {
  const body = { ...value }; delete body[key];
  check(value && value[key] === digest(body), 'PINNED_INPUT_DIGEST_REQUIRED');
}
function uniqueRows(rows) {
  check(Array.isArray(rows) && rows.length && new Set(rows.map(row => row.sourceRow)).size === rows.length, 'SOURCE_COVERAGE_REQUIRED');
  return new Map(rows.map(row => [row.sourceRow, row]));
}

export function prepareTransferForecastPlan({ extraction, plan, reconciliation, confirmation, plotConfirmation, revisionConfirmation, reference, catalog }) {
  for (const [input, key] of [[plan, 'planDigest'], [reconciliation, 'reconciliationDigest'],
    [confirmation, 'confirmationDigest'], [plotConfirmation, 'confirmationDigest'], [revisionConfirmation, 'confirmationDigest']]) sealed(input, key);
  check(plan.version === 'customer-workbook-review-plan-v1' && reconciliation.version === 'customer-workbook-reconciliation-v1'
    && plan.importReady === false && reconciliation.importReady === false
    && [plan, reconciliation, confirmation, plotConfirmation, revisionConfirmation].every(input =>
      input.sourceSha256 === extraction.sha256 && input.businessWritesAllowed === false && input.lostChangesAllowed === false)
    && reconciliation.productionChanged === false && reconciliation.planDigest === plan.planDigest
    && confirmation.planDigest === plan.planDigest && revisionConfirmation.planDigest === plan.planDigest
    && reconciliation.confirmationDigest === confirmation.confirmationDigest
    && reconciliation.plotConfirmationDigest === plotConfirmation.confirmationDigest
    && reconciliation.sourceRevisionConfirmationDigest === revisionConfirmation.confirmationDigest
    && reconciliation.referenceDigest === digest(reference) && reconciliation.catalogDigest === digest(catalog)
    && confirmation.catalogDigest === digest(catalog) && reference.readOnly === true
    && reference.projectRef === catalog.projectRef && catalog.projectRef === 'kbthmdedilswdmmczfay'
    && revisionConfirmation.columnSemantics?.physicalColumn === 'P'
    && revisionConfirmation.columnSemantics?.field === 'expectedTransferDate'
    && revisionConfirmation.columnSemantics?.actualTransferDateFieldUnchanged === true, 'PINNED_APPROVAL_REQUIRED');
  // The current workbook is the reviewed compact layout. P is physical index 15.
  check(plan.layout?.version === 'expected-transfer-in-P' && plan.layout.expectedTransferSourceColumn === 'P'
    && extraction.headers?.[15] === 'วันที่คาดว่าจะโอน' && extraction.headers?.[16] === null
    && extraction.rows.every(row => row.values?.length === 17 && row.values[16] === null
      && !row.formulaColumns.includes(15) && !row.formulaColumns.includes(16)), 'PHYSICAL_COLUMN_P_REQUIRED');
  const plannedRows = new Set(plan.rows.map(row => row.sourceRow));
  const sourceRows = uniqueRows(extraction.rows.filter(row => plannedRows.has(row.rowNumber))
    .map(row => ({ ...row, sourceRow: row.rowNumber })));
  const bound = uniqueRows(reconciliation.rows), source = uniqueRows(plan.rows);
  check(bound.size === source.size && sourceRows.size === source.size && [...source.keys()].every(row => bound.has(row)), 'SOURCE_COVERAGE_REQUIRED');
  const revisions = uniqueRows(revisionConfirmation.mappings);
  const plots = new Map(plotConfirmation.mappings.map(mapping => [mapping.sourceRow, mapping]));
  const referenceRows = new Map(reference.rows.map(row => [`${row.batchId}:${row.sourceRow}`, row]));
  const claims = new Set();
  const rows = plan.rows.map(row => {
    const raw = sourceRows.get(row.sourceRow), binding = bound.get(row.sourceRow);
    check(digest({ rowNumber: raw.rowNumber, hidden: raw.hidden, values: raw.values, formulaColumns: raw.formulaColumns }) === row.rowSha256
      && day(row.expectedTransferDate) && binding.sourceKey === row.sourceKey, 'SOURCE_ROW_CHANGED');
    // Excel extraction renders dates as ISO days; blank forecasts remain unknown, never a clear instruction.
    const physicalForecast = raw.values[15] == null || typeof raw.values[15] === 'string'
      && ['', '-'].includes(raw.values[15].trim()) ? null : raw.values[15];
    check(physicalForecast === row.expectedTransferDate, 'COLUMN_P_VALUE_CHANGED');
    const receipt = revisions.get(row.sourceRow);
    if (binding.matchKind === 'user_confirmed_source_revision') {
      check(receipt?.samePriorCustomerConfirmed === true && receipt.latestSourceValuesConfirmed === true
        && receipt.sourceRowSha256 === row.rowSha256 && receipt.proposedCustomerId === binding.proposedCustomerId
        && receipt.proposedInterestId === binding.proposedInterestId && receipt.expectedTransferDate === row.expectedTransferDate
        && receipt.sourceStage === row.sourceStage && receipt.canonicalWritesAllowed === false, 'REVISION_CONFIRMATION_REQUIRED');
    }
    if (binding.leadingZeroPlotProposal) {
      const reviewed = plots.get(row.sourceRow);
      check(reviewed?.approved === true && reviewed.candidatePlotId === binding.resolvedPlotId, 'PLOT_CONFIRMATION_REQUIRED');
    }
    const prior = binding.priorBooking;
    const historical = binding.priorBatchId && referenceRows.get(`${binding.priorBatchId}:${binding.priorSourceRow}`);
    const validBinding = uuid(binding.proposedCustomerId) && uuid(binding.proposedInterestId) && uuid(prior?.liveSaleId)
      && historical?.customerId === binding.proposedCustomerId && historical.customerMergedIntoId === null
      && historical.interests.some(interest => interest.id === binding.proposedInterestId
        && binding.confirmedProjects.length === 1 && interest.projectName === binding.confirmedProjects[0])
      && historical.booking?.liveSaleId === prior.liveSaleId
      && prior.linkedCustomerId === binding.proposedCustomerId && prior.linkedInterestId === binding.proposedInterestId
      && prior.preparedSaleId === prior.liveSaleId && prior.plotId === binding.resolvedPlotId
      && prior.livePlotId === prior.plotId && prior.liveStage === prior.stage
      && catalog.plots.some(plot => plot.id === prior.plotId && plot.projectName === binding.confirmedProjects[0]);
    const holds = [...binding.holds];
    if (row.expectedTransferDate !== null && !validBinding) holds.push('EXACT_EXISTING_BOOKING_BINDING_REQUIRED');
    if (row.expectedTransferDate !== null && row.sourceStage !== prior?.stage) holds.push('SOURCE_STAGE_CHANGE_REQUIRES_CANONICAL_PLAN');
    if (binding.retainedSourceIssues.includes('PAYMENT_METHOD_REVIEW')) holds.push('RENTAL_TYPE_AND_HISTORY_REQUIRED');
    let disposition = 'unknown_forecast_no_write';
    if (row.expectedTransferDate !== null) {
      if (holds.length) disposition = 'held_forecast';
      else if (row.sourceStage === 'booked') disposition = 'existing_booking_forecast_candidate';
      else if (['transferred', 'cancelled'].includes(row.sourceStage)) disposition = 'historical_forecast_only';
      else { disposition = 'held_forecast'; holds.push('BOOKING_REQUIRED'); }
    }
    if (disposition === 'existing_booking_forecast_candidate') {
      check(!claims.has(prior.liveSaleId), 'DUPLICATE_SALE_FORECAST'); claims.add(prior.liveSaleId);
    }
    return { sourceRow: row.sourceRow, sourceKey: row.sourceKey, rowSha256: row.rowSha256,
      physicalColumn: 'P', expectedTransferDate: row.expectedTransferDate, sourceStage: row.sourceStage,
      proposedCustomerId: binding.proposedCustomerId, proposedInterestId: binding.proposedInterestId,
      proposedSaleId: validBinding ? prior.liveSaleId : null, disposition, holds: [...new Set(holds)],
      sourceActualEvents: row.sourceEvents, targetField: 'sales.expected_transfer_date',
      actualTransferDateWillChange: false, plotForecastWillChange: false, canonicalWritesAllowed: false };
  });
  const result = { version: 'customer-transfer-forecast-plan-v1', sourceSha256: plan.sourceSha256,
    planDigest: plan.planDigest, reconciliationDigest: reconciliation.reconciliationDigest,
    confirmationDigest: confirmation.confirmationDigest, plotConfirmationDigest: plotConfirmation.confirmationDigest,
    revisionConfirmationDigest: revisionConfirmation.confirmationDigest, referenceCapturedAt: reference.capturedAt,
    counts: { sourceRows: rows.length, knownForecasts: rows.filter(row => row.expectedTransferDate !== null).length,
      existingBookingCandidates: rows.filter(row => row.disposition === 'existing_booking_forecast_candidate').length,
      historicalForecastsOnly: rows.filter(row => row.disposition === 'historical_forecast_only').length,
      heldForecasts: rows.filter(row => row.disposition === 'held_forecast').length,
      unknownForecastsNoWrite: rows.filter(row => row.disposition === 'unknown_forecast_no_write').length }, rows,
    requiresFreshBookingAndRoleRecheck: true, unknownForecastIsClearInstruction: false,
    importReady: false, businessWritesAllowed: false, lostChangesAllowed: false, productionChanged: false,
    rawCustomerNamesOrPhonesIncluded: false };
  result.forecastPlanDigest = digest(result);
  return result;
}

export function planTransferForecastFile(options) {
  const inputs = Object.fromEntries(['plan', 'reconciliation', 'confirmation', 'plotConfirmation', 'revisionConfirmation', 'reference', 'catalog']
    .map(key => { const path = workspacePath(options[key]); return [key, { path, bytes: readFileSync(path) }]; }));
  const sourcePath = workspacePath(options.source), output = workspacePath(options.output);
  const rel = relative(realpathSync(workspacePath('reports')), realpathSync(dirname(output)));
  check(!rel.startsWith('..') && !resolve(output).endsWith('.xlsx') && output.endsWith('.json') && !existsSync(output), 'UNUSED_REPORT_PATH_REQUIRED');
  const sourceHash = hash(readFileSync(sourcePath));
  const parsed = Object.fromEntries(Object.entries(inputs).map(([key, value]) => [key, JSON.parse(value.bytes)]));
  check(sourceHash === parsed.plan.sourceSha256, 'SOURCE_HASH_CHANGED');
  const extraction = extractWorkbook({ python: options.python, source: sourcePath, sourceSha256: sourceHash, inspectionDate: parsed.plan.inspectionDate });
  const plan = prepareTransferForecastPlan({ extraction, ...parsed });
  check(hash(readFileSync(sourcePath)) === sourceHash && Object.values(inputs).every(input => readFileSync(input.path).equals(input.bytes)), 'INPUT_CHANGED_DURING_REVIEW');
  writeFileSync(output, `${JSON.stringify(plan, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  return plan;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    check(process.argv.length === 3, 'OPTIONS_FILE_REQUIRED');
    const plan = planTransferForecastFile(JSON.parse(readFileSync(workspacePath(process.argv[2]), 'utf8')));
    process.stdout.write(`${JSON.stringify({ status: 'offline_forecast_plan_created', counts: plan.counts, forecastPlanDigest: plan.forecastPlanDigest, productionChanged: false })}\n`);
  } catch (error) {
    process.stderr.write(`FORECAST_PLAN_FAILED: ${/^[A-Z_]+$/.test(error.message) ? error.message : 'CHECK_PINNED_INPUTS'}\n`);
    process.exitCode = 1;
  }
}
