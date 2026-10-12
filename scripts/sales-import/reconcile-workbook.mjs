// Offline reference reconciliation only. No database client or business writes.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { extractWorkbook, prepareWorkbookDraft, workspacePath } from './review-workbook.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const digest = value => hash(JSON.stringify(value));
const check = (value, code) => { if (!value) throw new Error(code); };
const clean = value => String(value ?? '').normalize('NFC').replace(/\s+/gu, ' ').trim();
// G/O are calculated. P was a forecast-month presentation field; Q is forecast,
// never an actual visit/booking/transfer/cancellation date or identity evidence.
export const historicalEvidenceColumns = Object.freeze([0, 1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12, 13]);
const lookupColumns = [0, 2, 4]; // Review candidates ONLY, never UUID bindings.
export function fieldFingerprint(value) {
  check(value === null || ['string', 'number', 'boolean'].includes(typeof value), 'SCALAR_REQUIRED');
  const type = value === null ? 'null' : typeof value === 'number' ? 'number' : typeof value;
  const text = value === null ? '' : String(value);
  return hash(`${type}:${Array.from(text).length}:${text}`);
}
const signature = (hashes, columns) => columns.map(i => hashes[i]).join(':');
const indexBy = (rows, columns) => {
  const index = new Map();
  for (const row of rows) {
    const key = signature(row.fieldHashes, columns), matches = index.get(key) ?? [];
    matches.push(row); index.set(key, matches);
  }
  return index;
};

export function reconcileWorkbook({ draft, plan, confirmation, reference, catalog }) {
  const confirmationBody = { ...confirmation }; delete confirmationBody.confirmationDigest;
  const planBody = { ...plan }; delete planBody.planDigest;
  check(plan?.version === 'customer-workbook-review-plan-v1' && digest(planBody) === plan.planDigest
    && confirmation?.version === 'customer-workbook-human-confirmation-v1'
    && digest(confirmationBody) === confirmation.confirmationDigest
    && confirmation.sourceSha256 === plan.sourceSha256 && confirmation.planDigest === plan.planDigest
    && confirmation.catalogDigest === digest(catalog) && draft.sha256 === plan.sourceSha256
    && confirmation.businessWritesAllowed === false && confirmation.canonicalImportReady === false
    && confirmation.lostChangesAllowed === false && confirmation.leadReplayAllowed === false, 'PINNED_APPROVAL_REQUIRED');
  check(reference?.version === 'customer-reconciliation-reference-v1' && reference.projectRef === catalog.projectRef
    && reference.readOnly === true && Array.isArray(reference.roles) && Array.isArray(reference.rows)
    && reference.rows.every(r => Array.isArray(r.fieldHashes) && r.fieldHashes.length === 17
      && r.fieldHashes.every(h => /^[a-f0-9]{64}$/.test(h)) && Array.isArray(r.interests))
    && new Set(reference.rows.map(r => `${r.batchId}:${r.sourceRow}`)).size === reference.rows.length,
  'REFERENCE_INVALID');
  const sourceByRow = new Map(draft.entries.map(e => [e.sourceRow, e]));
  const covered = confirmation.sourceIdentityPartitions.flatMap(p => p.sourceRows);
  check(covered.length === draft.entries.length && new Set(covered).size === covered.length
    && covered.every(row => sourceByRow.has(row)) && plan.rows.length === covered.length
    && plan.rows.every(row => sourceByRow.has(row.sourceRow))
    && confirmation.sourceIdentityPartitions.every(p => p.canonicalCustomerId === null
      && p.sourceCandidateKey === digest([plan.sourceSha256, 'customer', p.sourceRows])), 'PARTITION_INVALID');
  const grouped = new Set();
  check(confirmation.identityGroups.length === plan.identityGroups.length, 'IDENTITY_CONFIRMATION_REQUIRED');
  for (let i = 0; i < plan.identityGroups.length; i++) {
    const group = plan.identityGroups[i], decision = confirmation.identityGroups[i];
    check(group.group === decision.group && JSON.stringify(group.rows) === JSON.stringify(decision.rows)
      && ['same_person', 'distinct_people'].includes(decision.decision)
      && JSON.stringify(decision.customerPartitions) === JSON.stringify(decision.decision === 'same_person'
        ? [group.rows] : group.rows.map(row => [row])), 'IDENTITY_CONFIRMATION_REQUIRED');
    for (const part of decision.customerPartitions) {
      check(confirmation.sourceIdentityPartitions.some(p => JSON.stringify(p.sourceRows) === JSON.stringify(part)), 'PARTITION_INVALID');
    }
    group.rows.forEach(row => grouped.add(row));
  }
  check(confirmation.sourceIdentityPartitions.every(p => p.sourceRows.length === 1 || p.sourceRows.every(row => grouped.has(row))), 'PARTITION_INVALID');
  const ownerMap = new Map(confirmation.ownerMappings.map(m => [m.sourceLabel, m]));
  check(ownerMap.size === confirmation.ownerMappings.length, 'OWNER_CONFIRMATION_INVALID');
  const projectMap = new Map(confirmation.projectMappings.map(m => [m.sourceLabel, m.proposedProjectName]));
  check(projectMap.size === confirmation.projectMappings.length && confirmation.projectMappings.every(m => m.confirmed
    && catalog.projects.filter(p => p.name === m.proposedProjectName).length === 1), 'PROJECT_CONFIRMATION_INVALID');
  const exact = indexBy(reference.rows, historicalEvidenceColumns), review = indexBy(reference.rows, lookupColumns);
  const rows = draft.entries.map(entry => {
    const hashes = entry.rawValues.map(fieldFingerprint), matches = exact.get(signature(hashes, historicalEvidenceColumns)) ?? [];
    const prior = matches.length === 1 ? matches[0] : null;
    const owner = ownerMap.get(entry.proposal.sourceOwnerLabel), role = owner?.candidateUserIds?.length === 1
      ? reference.roles.find(r => r.userId === owner.candidateUserIds[0]) : null;
    const validOwner = owner?.confirmedForNewSource === true && role?.role === 'sales' && role.isActive
      && clean(role.displayName).toUpperCase() === owner.proposedLogin.toUpperCase();
    const projects = entry.proposal.projectLabels.map(label => projectMap.get(label) ?? null);
    const target = entry.proposal.targetPlotLabel, project = projects.length === 1 ? projects[0] : null;
    const exactPlots = target && project ? catalog.plots.filter(p => p.projectName === project && p.plotName === target) : [];
    const numericPlots = target && project && /^0+[1-9]\d*$/.test(target)
      ? catalog.plots.filter(p => p.projectName === project && p.plotName === String(Number(target))) : [];
    const existingPlot = prior?.booking?.plotId ? catalog.plots.find(p => p.id === prior.booking.plotId && p.projectName === project) : null;
    const holds = [];
    if (matches.length !== 1) holds.push(matches.length > 1 ? 'SOURCE_EVIDENCE_AMBIGUOUS' : 'SOURCE_REVISION_OR_NEW_RECORD_REVIEW');
    if (!entry.proposal.customerName) holds.push('CUSTOMER_NAME_REQUIRED');
    if (!validOwner) holds.push('SALES_OWNER_REQUIRED_OR_ROLE_CHANGED');
    if (!projects.length || projects.some(p => p === null)) holds.push('PROJECT_MAPPING_REQUIRED');
    if (prior && (!prior.customerId || prior.customerMergedIntoId)) holds.push('EXISTING_CUSTOMER_BINDING_MISSING_OR_MERGED');
    if (prior?.customerId && prior.customerNameHash !== hash(entry.proposal.customerName ?? '')) holds.push('CURRENT_CUSTOMER_NAME_CHANGED');
    if (target && exactPlots.length !== 1) holds.push('PLOT_LABEL_REVIEW');
    if (entry.proposal.booking && !target) holds.push('BOOKING_PLOT_UNKNOWN');
    const candidateCustomerId = prior?.customerId && !prior.customerMergedIntoId
      && prior.customerNameHash === hash(entry.proposal.customerName ?? '') ? prior.customerId : null;
    const interest = candidateCustomerId && project ? prior.interests.filter(i => i.projectName === project) : [];
    if (prior?.booking && (prior.booking.linkedCustomerId !== candidateCustomerId
      || interest.length !== 1 || prior.booking.linkedInterestId !== interest[0]?.id)) holds.push('EXISTING_BOOKING_LINK_MISMATCH');
    if (prior?.booking?.liveSaleId && (prior.booking.livePlotId !== prior.booking.plotId
      || prior.booking.liveStage !== prior.booking.stage)) holds.push('LIVE_SALE_CHANGED_PRESERVE_CURRENT');
    const alternatives = !prior ? (review.get(signature(hashes, lookupColumns)) ?? []).map(r => ({
      priorBatchId: r.batchId, priorSourceRow: r.sourceRow,
      differentColumns: hashes.flatMap((h, i) => h === r.fieldHashes[i] ? [] : [i + 1]),
      bindingAllowed: false,
    })) : [];
    return { sourceRow: entry.sourceRow, sourceKey: entry.sourceKey,
      matchKind: prior ? 'exact_historical_source_evidence' : matches.length > 1 ? 'ambiguous' : 'review_required',
      priorBatchId: prior?.batchId ?? null, priorSourceRow: prior?.sourceRow ?? null,
      proposedCustomerId: candidateCustomerId, proposedInterestId: interest.length === 1 ? interest[0].id : null,
      proposedSalesOwnerUserId: validOwner ? role.userId : null,
      priorCustomerOwnerUserId: prior?.customerOwnerUserId ?? null,
      confirmedProjects: projects, sourcePlotLabel: target,
      exactPlotId: exactPlots.length === 1 ? exactPlots[0].id : null,
      priorLinkedPlotProposal: existingPlot ? { id: existingPlot.id, label: existingPlot.plotName, requiresReview: exactPlots.length !== 1 } : null,
      leadingZeroPlotProposal: numericPlots.length === 1 ? { id: numericPlots[0].id, label: numericPlots[0].plotName, approved: false } : null,
      priorBooking: prior?.booking ?? null,
      differentSourceColumns: prior ? hashes.flatMap((h, i) => h === prior.fieldHashes[i] ? [] : [i + 1]) : [],
      reviewAlternatives: alternatives, retainedSourceIssues: [...entry.issues], holds,
      bindingVerifiedForProduction: false, canonicalWritesAllowed: false };
  });
  const byRow = new Map(rows.map(row => [row.sourceRow, row]));
  const partitions = confirmation.sourceIdentityPartitions.map(part => {
    const records = part.sourceRows.map(row => byRow.get(row));
    const ids = [...new Set(records.map(r => r.proposedCustomerId).filter(Boolean))];
    const holds = [];
    if (ids.length > 1) holds.push('PRIOR_CUSTOMERS_REQUIRE_REVIEWED_MERGE');
    if (records.some(r => r.proposedCustomerId === null)) holds.push('INCOMPLETE_EXISTING_ID_EVIDENCE');
    return { sourceRows: part.sourceRows, sourceCandidateKey: part.sourceCandidateKey, candidateCustomerIds: ids,
      proposedCustomerId: ids.length === 1 && !holds.length ? ids[0] : null, holds, canonicalWritesAllowed: false };
  });
  const claims = new Map();
  for (const part of partitions) for (const id of part.candidateCustomerIds) {
    const parts = claims.get(id) ?? []; parts.push(part); claims.set(id, parts);
  }
  for (const parts of claims.values()) if (parts.length > 1) for (const part of parts) {
    part.proposedCustomerId = null; part.holds.push('CONFIRMED_DISTINCT_PEOPLE_SHARE_PRIOR_CUSTOMER');
    for (const row of part.sourceRows) byRow.get(row).holds.push('CONFIRMED_DISTINCT_PEOPLE_SHARE_PRIOR_CUSTOMER');
  }
  const result = { version: 'customer-workbook-reconciliation-v1', sourceSha256: plan.sourceSha256,
    planDigest: plan.planDigest, confirmationDigest: confirmation.confirmationDigest,
    referenceDigest: digest(reference), catalogDigest: digest(catalog), referenceCapturedAt: reference.capturedAt,
    historicalEvidenceColumns: historicalEvidenceColumns.map(i => i + 1),
    exclusions: { calculatedColumns: [7, 15], forecastColumns: [16, 17],
      forecastsExcludedFromIdentityOnly: true, changedValuesRetainedForReview: true },
    counts: { sourceRows: rows.length, exactHistoricalMatches: rows.filter(r => r.matchKind === 'exact_historical_source_evidence').length,
      rowsWithPriorCustomerProposal: rows.filter(r => r.proposedCustomerId !== null).length,
      sourceRowsRequiringRevisionReview: rows.filter(r => r.matchKind === 'review_required').length,
      ambiguousRows: rows.filter(r => r.matchKind === 'ambiguous').length,
      identityPartitions: partitions.length, partitionsWithConsistentPriorCustomerProposal: partitions.filter(p => p.proposedCustomerId !== null).length,
      partitionsWithSharedPriorCustomerConflict: partitions.filter(p => p.holds.includes('CONFIRMED_DISTINCT_PEOPLE_SHARE_PRIOR_CUSTOMER')).length,
      rowsRequiringPlotLabelReview: rows.filter(r => r.holds.includes('PLOT_LABEL_REVIEW')).length,
      leadingZeroPlotProposals: rows.filter(r => r.leadingZeroPlotProposal !== null).length,
      priorPlotProposalsRequiringReview: rows.filter(r => r.priorLinkedPlotProposal?.requiresReview).length,
      missingBookingPlotRows: rows.filter(r => r.holds.includes('BOOKING_PLOT_UNKNOWN')).length,
      liveSalesChanged: rows.filter(r => r.holds.includes('LIVE_SALE_CHANGED_PRESERVE_CURRENT')).length,
      approvedProductionBindings: 0 },
    rows, partitions, importReady: false, businessWritesAllowed: false, lostChangesAllowed: false,
    workbookEdited: false, productionChanged: false, rawCustomerNamesOrPhonesIncluded: false };
  return { ...result, reconciliationDigest: digest(result) };
}

export function reconcileWorkbookFiles(options) {
  const read = path => JSON.parse(readFileSync(workspacePath(path), 'utf8'));
  const plan = read(options.plan), confirmation = read(options.confirmation), reference = read(options.reference), catalog = read(options.catalog);
  const source = workspacePath(options.source), output = workspacePath(options.output);
  check(!existsSync(output) && /^reports[\\/][^\\/]+\.json$/.test(options.output), 'UNUSED_REPORT_OUTPUT_REQUIRED');
  check(hash(readFileSync(source)) === confirmation.sourceSha256, 'SOURCE_CHANGED');
  const extraction = extractWorkbook({ python: options.python, source, sourceSha256: confirmation.sourceSha256, inspectionDate: plan.inspectionDate });
  const { draft } = prepareWorkbookDraft(extraction, plan.inspectionDate);
  const report = reconcileWorkbook({ draft, plan, confirmation, reference, catalog });
  check(hash(readFileSync(source)) === confirmation.sourceSha256, 'SOURCE_CHANGED_DURING_REVIEW');
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return report;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    check(process.argv.length === 3, 'EXPLICIT_OPTIONS_FILE_REQUIRED');
    const options = JSON.parse(readFileSync(workspacePath(process.argv[2]), 'utf8'));
    check(Object.keys(options).sort().join(',') === 'catalog,confirmation,output,plan,python,reference,source', 'OPTIONS_INVALID');
    const report = reconcileWorkbookFiles(options);
    console.log(JSON.stringify({ counts: report.counts, reconciliationDigest: report.reconciliationDigest, importReady: false }));
  } catch { console.error('WORKBOOK_RECONCILIATION_FAILED: inspect pinned input, approval and reference files.'); process.exitCode = 1; }
}
