// Offline, redacted mapping proposals. Never an entity importer or write authorization.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { extractWorkbook, prepareWorkbookDraft, reviewExtractedWorkbook, workspacePath } from './review-workbook.mjs';
import { proposedProjectAliases } from '../sales-runtime/sheet-relationship-review.mjs';

const bytesHash = value => createHash('sha256').update(value).digest('hex');
const digest = value => bytesHash(JSON.stringify(value));
const clean = value => String(value ?? '').normalize('NFC').replace(/\s+/gu, ' ').trim();
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const fail = code => { throw new Error(code); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);

export function prepareWorkbookPlan(extraction, inspectionDate, catalog) {
  if (!object(catalog) || catalog.version !== 'customer-import-catalog-v1' || catalog.projectRef !== 'kbthmdedilswdmmczfay'
    || !Number.isFinite(Date.parse(catalog.generatedAt)) || !Array.isArray(catalog.projects) || !Array.isArray(catalog.plots)
    || !Array.isArray(catalog.canonicalRoles) || !catalog.projects.every(p => typeof p?.name === 'string' && clean(p.name))
    || new Set(catalog.projects.map(p => clean(p.name))).size !== catalog.projects.length
    || !catalog.plots.every(p => typeof p?.id === 'string' && clean(p.id) && typeof p.projectName === 'string'
      && catalog.projects.some(project => project.name === p.projectName) && (p.plotName === null || typeof p.plotName === 'string'))
    || new Set(catalog.plots.map(p => p.id)).size !== catalog.plots.length
    || !catalog.canonicalRoles.every(r => uuid(r?.userId) && typeof r.displayName === 'string'
      && ['sales', 'owner', 'admin'].includes(r.role) && typeof r.isActive === 'boolean')
    || new Set(catalog.canonicalRoles.map(r => r.userId)).size !== catalog.canonicalRoles.length) fail('REFERENCE_CATALOG_INVALID');
  const audit = reviewExtractedWorkbook(extraction, inspectionDate), { draft } = prepareWorkbookDraft(extraction, inspectionDate);
  const aliases = new Map(proposedProjectAliases), sourceRows = new Map(extraction.rows.map(row => [row.rowNumber, row]));
  const sales = catalog.canonicalRoles.filter(r => r.role === 'sales' && r.isActive);
  const projects = [...new Set(draft.entries.flatMap(e => e.proposal.projectLabels))].sort().map(label => {
    const exact = catalog.projects.filter(p => clean(p.name) === clean(label));
    const proposed = exact.length === 1 ? exact[0].name : aliases.get(label) ?? null;
    const matches = catalog.projects.filter(p => p.name === proposed);
    return { sourceLabel: label, proposedProjectName: matches.length === 1 ? proposed : null,
      matchKind: exact.length === 1 ? 'exact_label_candidate' : matches.length === 1 ? 'unapproved_alias_candidate' : 'no_candidate',
      confirmed: false };
  });
  const owners = [...new Set(draft.entries.map(e => e.proposal.sourceOwnerLabel).filter(Boolean))].sort().map(label => {
    const matches = sales.filter(r => clean(r.displayName).toUpperCase() === clean(label).toUpperCase());
    return { sourceLabel: label, candidateUserIds: matches.map(r => r.userId), confirmed: false };
  });
  const rows = draft.entries.map(entry => {
    const p = entry.proposal, sourceStage = p.booking?.stage ?? (entry.issues.includes('STATUS_MAPPING_REQUIRED') ? 'unclassified' : 'visited');
    const holds = [...entry.issues, 'CUSTOMER_IDENTITY_DECISION_REQUIRED', 'OWNER_BINDING_DECISION_REQUIRED',
      'PROJECT_BINDING_DECISION_REQUIRED', 'SOURCE_APPROVAL_REQUIRED'];
    if (p.booking) holds.push('DEAL_BINDING_DECISION_REQUIRED');
    if (entry.issues.includes('PAYMENT_METHOD_REVIEW')) holds.push('RENTAL_TYPE_AND_HISTORY_REQUIRED');
    const projectCandidates = p.projectLabels.map(label => projects.find(project => project.sourceLabel === label));
    const plotCandidates = p.targetPlotLabel && projectCandidates.length === 1 && projectCandidates[0].proposedProjectName
      ? catalog.plots.filter(plot => plot.projectName === projectCandidates[0].proposedProjectName
        && plot.plotName !== null && clean(plot.plotName) === clean(p.targetPlotLabel)).map(plot => plot.id) : [];
    if (p.targetPlotLabel && plotCandidates.length !== 1) holds.push('PLOT_BINDING_REVIEW');
    const events = [];
    const add = (kind, date) => events.push({ kind, date: date ?? null, precision: date == null ? 'unknown' : 'day' });
    // These are source declarations, never synthetic appointments or business actions.
    add('visited', p.visitHistoryDate);
    if (p.booking) add('booked', p.booking.bookedDate);
    if (sourceStage === 'transferred') add('transferred', p.booking.transferredDate);
    if (sourceStage === 'cancelled') add('cancelled', p.booking.cancelledDate);
    return { sourceRow: entry.sourceRow, sourceKey: entry.sourceKey, rowSha256: digest(sourceRows.get(entry.sourceRow)),
      sourceStage, sourceEvents: events, expectedTransferDate: p.expectedTransferDate,
      salePrice: p.booking?.salePrice ?? null, candidatePlotIds: plotCandidates,
      customerId: null, interestId: null, saleId: null, rentalId: null, ownerUserId: null,
      holds: [...new Set(holds)].sort(), canonicalWritesAllowed: false, leadRequired: false };
  });
  const plan = { version: 'customer-workbook-review-plan-v1', sourceSha256: extraction.sha256,
    catalogDigest: digest(catalog), catalogGeneratedAt: catalog.generatedAt, inspectionDate,
    layout: audit.layout, counts: { ...audit.counts, sourceEvents: rows.reduce((n, row) => n + row.sourceEvents.length, 0),
      heldRows: rows.length, confirmedCustomerBindings: 0, canonicalImportRows: 0 },
    issues: audit.issues, identityGroups: draft.repeatedNameRows.map((rows, index) =>
      ({ group: `N${String(index + 1).padStart(3, '0')}`, rows, decision: null, customerId: null })),
    projectProposals: projects, ownerProposals: owners, rows,
    importReady: false, businessWritesAllowed: false, lostChangesAllowed: false,
    customerNamesIncluded: false, phoneValuesIncluded: false, bindingsVerified: false };
  return { ...plan, planDigest: digest(plan) };
}

export function planWorkbookFile(options, extract = extractWorkbook) {
  if (!options || Object.keys(options).some(key => !['source', 'python', 'sha256', 'inspectionDate', 'catalog', 'output'].includes(key))
    || typeof options.python !== 'string' || !/^[a-f0-9]{64}$/.test(options.sha256 ?? '')) fail('PLAN_ARGUMENTS_INVALID');
  const source = workspacePath(options.source), output = workspacePath(options.output), catalogPath = workspacePath(options.catalog);
  if (extname(source).toLowerCase() !== '.xlsx' || extname(catalogPath).toLowerCase() !== '.json'
    || extname(output).toLowerCase() !== '.json' || !statSync(source).isFile() || statSync(source).size > 50 * 1024 * 1024
    || statSync(catalogPath).size > 8 * 1024 * 1024) fail('PLAN_PATH_INVALID');
  const reportDirectory = workspacePath('reports');
  if (!realpathSync(dirname(output)).startsWith(`${realpathSync(reportDirectory)}${process.platform === 'win32' ? '\\' : '/'}`)
    && realpathSync(dirname(output)) !== realpathSync(reportDirectory)) fail('REPORT_OUTPUT_REQUIRED');
  if (existsSync(output)) fail('OUTPUT_ALREADY_EXISTS');
  const sourceHash = bytesHash(readFileSync(source)), catalogBytes = readFileSync(catalogPath);
  if (sourceHash !== options.sha256) fail('SOURCE_HASH_CHANGED');
  const extraction = extract({ python: options.python, source, sourceSha256: sourceHash, inspectionDate: options.inspectionDate });
  if (extraction.sha256 !== sourceHash) fail('EXTRACTED_SOURCE_HASH_CHANGED');
  const plan = prepareWorkbookPlan(extraction, options.inspectionDate, JSON.parse(catalogBytes.toString('utf8')));
  if (bytesHash(readFileSync(source)) !== sourceHash || !readFileSync(catalogPath).equals(catalogBytes)) fail('PLAN_INPUT_CHANGED');
  writeFileSync(output, `${JSON.stringify(plan, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  return plan;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const { values } = parseArgs({ strict: true, allowPositionals: false, options: {
      python: { type: 'string' }, source: { type: 'string' }, sha256: { type: 'string' }, catalog: { type: 'string' },
      'inspection-date': { type: 'string' }, output: { type: 'string' },
    } });
    const plan = planWorkbookFile({ python: values.python, source: values.source, sha256: values.sha256,
      catalog: values.catalog, output: values.output, inspectionDate: values['inspection-date'] });
    process.stdout.write(`${JSON.stringify({ status: 'review_plan_created', counts: plan.counts, planDigest: plan.planDigest, importReady: false })}\n`);
  } catch {
    process.stderr.write('WORKBOOK_PLAN_FAILED: check pinned source, catalog, arguments and unused output.\n');
    process.exitCode = 1;
  }
}
