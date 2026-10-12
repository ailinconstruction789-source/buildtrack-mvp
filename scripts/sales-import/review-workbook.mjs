// Read-only intake audit. No customer bindings, historical approvals or import commands.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { customerSheetHeaders, prepareSheetImportReview, summarizeSheetImportReview } from '../sales-runtime/sheet-import-review.mjs';

const root = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '../..'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = code => { throw new Error(code); };
const day = value => typeof value === 'string' && /^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
function inside(base, target) {
  const rel = relative(base, target);
  return rel !== '' && !isAbsolute(rel) && rel !== '..' && !rel.startsWith('../') && !rel.startsWith('..\\');
}
export function workspacePath(value) {
  if (typeof value !== 'string' || !value) fail('PATH_REQUIRED');
  const path = resolve(root, value);
  if (!inside(root, path) || relative(root, path).split(/[\\/]/).some(segment =>
    segment.includes(':') || ['.git', '.codex', '.agents', '.aws'].includes(segment.toLowerCase()))) fail('WORKSPACE_PATH_REQUIRED');
  const existing = existsSync(path) ? path : dirname(path);
  const actual = realpathSync(existing);
  if (actual !== root && !inside(root, actual)) fail('WORKSPACE_LINK_INVALID');
  return path;
}

/** Inspection date is only the cutoff for checking future actual dates.
 * It does not certify the source's as-of date or carry any old review forward.
 * Return only counts/codes and source row numbers, never source values or drafts.
 */
export function reviewExtractedWorkbook(extraction, inspectionDate) {
  const { draft, compact } = prepareWorkbookDraft(extraction, inspectionDate);
  const summary = summarizeSheetImportReview(draft);
  const history = { visit: { known: 0, absent: 0, invalid: 0 },
    booking: { known: 0, absent: 0, invalid: 0 },
    transfer: { known: 0, absent: 0, invalid: 0 },
    cancellation: { known: 0, absent: 0, invalid: 0 }, expectedTransfer: { known: 0, absent: 0, invalid: 0 } };
  return summarizeWorkbook(draft, summary, history, compact, extraction, inspectionDate);
}

// Sensitive draft stays in memory. Callers must redact names/phones before saving.
export function prepareWorkbookDraft(extraction, inspectionDate) {
  if (!day(inspectionDate) || extraction?.snapshotDate !== inspectionDate) fail('INSPECTION_DATE_INVALID');
  const compactHeaders = [...customerSheetHeaders.slice(0, 15), customerSheetHeaders[16], null];
  const compact = JSON.stringify(extraction.headers) === JSON.stringify(compactHeaders);
  // Exact supported schema only. Do not guess columns from content or silently discard Q.
  if (compact && (!Array.isArray(extraction.rows) || extraction.rows.some(row =>
    !Array.isArray(row?.values) || row.values.length !== 17 || row.values[16] !== null
    || !Array.isArray(row.formulaColumns) || row.formulaColumns.includes(16)))) fail('UNLABELED_COLUMN_CONTENT');
  const normalized = compact ? { ...extraction, headers: [...customerSheetHeaders],
    rows: extraction.rows.map(row => ({ ...row,
      values: [...row.values.slice(0, 15), null, row.values[15]],
      formulaColumns: row.formulaColumns.map(column => column === 15 ? 16 : column) })) } : extraction;
  const draft = prepareSheetImportReview(normalized); // Deliberately no date/owner decisions.
  return { draft, compact };
}

function summarizeWorkbook(draft, summary, history, compact, extraction, inspectionDate) {
  const fields = [ ['visit', 0, 'VISIT_DATE_REVIEW', entry => entry.proposal.visitHistoryDate],
    ['booking', 1, 'BOOKING_DATE_REVIEW', entry => entry.proposal.booking?.bookedDate],
    ['transfer', 10, 'TRANSFER_DATE_REVIEW', entry => entry.proposal.booking?.transferredDate],
    ['cancellation', 9, 'CANCELLATION_DATE_REVIEW', entry => entry.proposal.booking?.cancelledDate],
    ['expectedTransfer', 16, 'EXPECTED_TRANSFER_DATE_REVIEW', entry => entry.proposal.expectedTransferDate] ];
  for (const entry of draft.entries) for (const [key, column, issue, read] of fields) {
    // Count all source dates, including dates inconsistent with the declared stage.
    const value = entry.rawValues[column];
    const missing = value === null || String(value).trim() === '' || String(value).trim() === '-';
    const bucket = missing ? 'absent' : entry.issues.includes(issue) ? 'invalid'
      : read(entry) != null || day(value) ? 'known' : 'invalid';
    history[key][bucket]++;
  }
  const issues = Object.fromEntries(Object.entries(summary.issueRows).map(([code, rows]) =>
    [code, { count: rows.length, rows }]));
  // Unknown phone is an absent column, not renewed approval of the old phone policy.
  const { phoneUnknown, approvedDateCorrections, ...counts } = summary.counts;
  return {
    version: 'customer-workbook-intake-audit-v1', sourceSha256: extraction.sha256,
    inspectionDate, sourceAsOfDate: null, sourceApprovedForImport: false,
    coverage: { sheet: extraction.sheet, range: `A1:Q${extraction.maxRow}`,
      inspectedDataRows: extraction.rows.length, lastRow: extraction.maxRow, includesHiddenRows: true },
    layout: { version: compact ? 'expected-transfer-in-P' : 'expected-transfer-in-Q',
      expectedTransferSourceColumn: compact ? 'P' : 'Q',
      expectedTransferMonthSourceColumn: compact ? null : 'P', workbookEdited: false },
    counts, stages: summary.stages, history, issues,
    identityReview: { repeatedNameRows: draft.repeatedNameRows, automaticMerges: 0, bindingsCreated: 0 },
    sourcePolicy: { phoneFieldInReviewedLayout: false, phonePolicyApproved: false,
      sourceRowsWithoutPhoneField: phoneUnknown, oldApprovalsApplied: 0, dateCorrectionsApplied: approvedDateCorrections,
      ownersMapped: 0, unknownDatesPreserved: true },
    pending: [...summary.globalPending, 'SOURCE_APPROVAL', 'SOURCE_AS_OF_DATE', 'PHONE_POLICY_REVIEW'],
    importReady: false, writesAllowed: false, lostChangesAllowed: false,
    productionChanged: false, rawPersonalDataIncluded: false,
  };
}

export function extractWorkbook({ python, source, sourceSha256, inspectionDate }) {
  const executable = realpathSync(python);
  if (!statSync(executable).isFile()) fail('PYTHON_EXECUTABLE_REQUIRED');
  const result = spawnSync(executable, [fileURLToPath(new URL('../sales-runtime/read-customer-sheet.py', import.meta.url)),
    '--source', source, '--sha256', sourceSha256, '--snapshot-date', inspectionDate],
  { shell: false, windowsHide: true, encoding: 'utf8', timeout: 60000, maxBuffer: 32 * 1024 * 1024 });
  if (result.error || result.status !== 0) fail('WORKBOOK_EXTRACTION_FAILED');
  try { return JSON.parse(result.stdout); } catch { return fail('WORKBOOK_EXTRACTION_FAILED'); }
}

export function auditWorkbookFile(options, extract = extractWorkbook) {
  if (!options || Object.keys(options).some(key => !['python', 'source', 'sha256', 'inspectionDate', 'output'].includes(key))
    || typeof options.python !== 'string' || !options.python || !/^[a-f0-9]{64}$/.test(options.sha256 ?? '')
    || !day(options.inspectionDate)) fail('AUDIT_ARGUMENTS_REQUIRED');
  const source = workspacePath(options.source), output = workspacePath(options.output);
  if (extname(source).toLowerCase() !== '.xlsx' || !statSync(source).isFile()) fail('XLSX_SOURCE_REQUIRED');
  if (extname(output).toLowerCase() !== '.json' || !inside(resolve(root, 'reports'), output)) fail('REPORT_OUTPUT_REQUIRED');
  if (existsSync(output)) fail('OUTPUT_ALREADY_EXISTS');
  const reportRoot = realpathSync(resolve(root, 'reports')), parent = realpathSync(dirname(output));
  if (parent !== reportRoot && !inside(reportRoot, parent)) fail('REPORT_OUTPUT_LINK_INVALID');
  if (statSync(source).size > 50 * 1024 * 1024) fail('SOURCE_TOO_LARGE');
  const before = hash(readFileSync(source));
  if (before !== options.sha256) fail('SOURCE_HASH_CHANGED');
  const extraction = extract({ python: options.python, source, sourceSha256: before, inspectionDate: options.inspectionDate });
  if (extraction?.sha256 !== before) fail('EXTRACTED_SOURCE_HASH_CHANGED');
  const report = reviewExtractedWorkbook(extraction, options.inspectionDate);
  const after = hash(readFileSync(source));
  if (after !== before) fail('SOURCE_CHANGED_DURING_REVIEW');
  report.sourceUnchanged = true;
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  return report;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const { values } = parseArgs({ strict: true, allowPositionals: false, options: {
      python: { type: 'string' }, source: { type: 'string' }, sha256: { type: 'string' },
      'inspection-date': { type: 'string' }, output: { type: 'string' },
    } });
    const report = auditWorkbookFile({ python: values.python, source: values.source, sha256: values.sha256,
      inspectionDate: values['inspection-date'], output: values.output });
    process.stdout.write(`${JSON.stringify({ status: 'reviewed', counts: report.counts,
      issueCounts: Object.fromEntries(Object.entries(report.issues).map(([code, issue]) => [code, issue.count])),
      sourceUnchanged: true, importReady: false, writesAllowed: false })}\n`);
  } catch {
    // Do not print Python output, customer content, paths or arbitrary exception text.
    process.stderr.write('WORKBOOK_AUDIT_FAILED: check arguments, source hash, headers and unused report path.\n');
    process.exitCode = 1;
  }
}
