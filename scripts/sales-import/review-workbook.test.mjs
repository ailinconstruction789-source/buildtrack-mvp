import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditWorkbookFile, reviewExtractedWorkbook } from './review-workbook.mjs';
import { customerSheetHeaders } from '../sales-runtime/sheet-import-review.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const digest = value => createHash('sha256').update(value).digest('hex');
const row = (rowNumber, changes = {}) => ({ rowNumber, hidden: false, formulaColumns: [6, 14],
  values: ['2026-09-01', null, 'PRIVATE CUSTOMER', 'PRIVATE JOB', 'PRIVATE PROJECT', '1',
    'PRIVATE DERIVED', 'เยียมชม', 'PRIVATE BANK', null, null, 'PRIVATE OWNER', null, null, 40, null, null], ...changes });
const fixture = (rows = [row(2)]) => ({ version: 'customer-sheet-extract-v1', sheet: 'ข้อมูลลูกค้า',
  sha256: 'a'.repeat(64), snapshotDate: '2026-10-10', phonePolicy: 'unknown_confirmed',
  headers: [...customerSheetHeaders], maxRow: rows.length + 1, rows });
function files(t) {
  const directory = mkdtempSync(join(root, 'reports', '.workbook-audit-test-'));
  // Opaque bytes exercise orchestration only; injected extractor supplies a synthetic source.
  const source = join(directory, 'source.xlsx'), output = join(directory, 'audit.json');
  writeFileSync(source, 'synthetic source bytes');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const sha256 = digest(readFileSync(source));
  const options = { python: 'unused-unit-test-python', source, output, sha256, inspectionDate: '2026-10-10' };
  const extract = () => ({ ...fixture(), sha256 });
  return { source, output, options, extract };
}

test('redacts personal data and resets source/date/owner/phone approvals', () => {
  const input = fixture(), copy = structuredClone(input), report = reviewExtractedWorkbook(input, '2026-10-10');
  assert.deepEqual(input, copy);
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE/);
  assert.deepEqual(report.sourcePolicy, { phoneFieldInReviewedLayout: false, phonePolicyApproved: false,
    sourceRowsWithoutPhoneField: 1, oldApprovalsApplied: 0, dateCorrectionsApplied: 0,
    ownersMapped: 0, unknownDatesPreserved: true });
  assert.equal(report.sourceAsOfDate, null);
  assert.equal(report.sourceApprovedForImport, false);
  assert.equal(report.importReady, false);
  assert.equal(report.writesAllowed, false);
  assert.equal(report.lostChangesAllowed, false);
});

test('covers hidden and later rows beyond the old 966-row review boundary without merging', () => {
  const rows = Array.from({ length: 975 }, (_, i) => row(i + 2, { hidden: i === 974 }));
  const report = reviewExtractedWorkbook(fixture(rows), '2026-10-10');
  assert.equal(report.counts.sourceRecords, 975);
  assert.equal(report.counts.hiddenRecords, 1);
  assert.equal(report.coverage.lastRow, 976);
  assert.equal(report.identityReview.repeatedNameRows[0].at(-1), 976);
  assert.equal(report.identityReview.automaticMerges, 0);
});

test('supports the exact new layout with expected transfer in P and keeps Q unambiguous', () => {
  const source = fixture();
  source.headers = [...customerSheetHeaders.slice(0, 15), customerSheetHeaders[16], null];
  source.rows[0].values[15] = '2027-01-01';
  const original = structuredClone(source), report = reviewExtractedWorkbook(source, '2026-10-10');
  assert.deepEqual(source, original);
  assert.deepEqual(report.layout, { version: 'expected-transfer-in-P',
    expectedTransferSourceColumn: 'P', expectedTransferMonthSourceColumn: null, workbookEdited: false });
  assert.equal(report.issues.EXPECTED_TRANSFER_DATE_REVIEW, undefined);
  assert.equal(report.history.expectedTransfer.known, 1);
  source.rows[0].values[16] = 'unexpected unlabelled data';
  assert.throws(() => reviewExtractedWorkbook(source, '2026-10-10'), /UNLABELED_COLUMN_CONTENT/);
  source.rows[0].values[16] = null; source.rows[0].formulaColumns.push(16);
  assert.throws(() => reviewExtractedWorkbook(source, '2026-10-10'), /UNLABELED_COLUMN_CONTENT/);
});

test('does not lose formula/invalid-date reviews when P maps to the expected transfer field', () => {
  const source = fixture();
  source.headers = [...customerSheetHeaders.slice(0, 15), customerSheetHeaders[16], null];
  source.rows[0].values[15] = 'unknown date'; source.rows[0].formulaColumns.push(15);
  const report = reviewExtractedWorkbook(source, '2026-10-10');
  assert.equal(report.issues.EXPECTED_TRANSFER_DATE_REVIEW.count, 1);
  assert.equal(report.issues.PRIMARY_INPUT_FORMULA_REVIEW.count, 1);
});

test('retains unknown days and flags uncertain dates without the old correction', () => {
  const r = row(2); r.values[0] = '2569-07-25'; r.values[7] = 'โอนเเล้ว'; r.values[12] = 0;
  const report = reviewExtractedWorkbook(fixture([r]), '2026-10-10');
  assert.deepEqual(report.history.visit, { known: 0, absent: 0, invalid: 1 });
  assert.deepEqual(report.history.transfer, { known: 0, absent: 1, invalid: 0 });
  assert.equal(report.issues.TRANSFER_DATE_UNKNOWN.count, 1);
  assert.equal(report.issues.BOOKING_DATE_UNKNOWN.count, 1);
  assert.equal(report.issues.SALE_PRICE_UNKNOWN, undefined); // Genuine zero remains known.
});

test('counts valid dates with a conflicting declared stage while holding the conflict', () => {
  const r = row(2); r.values[1] = '2026-09-02';
  const report = reviewExtractedWorkbook(fixture([r]), '2026-10-10');
  assert.equal(report.history.booking.known, 1);
  assert.equal(report.issues.STATUS_EVENT_CONFLICT.count, 1);
  assert.equal(report.stages.without_booking_proposal, 1);
});

test('rejects missing row coverage, changed headers, invalid cutoff and future actual days', () => {
  const incomplete = fixture([row(2), row(4)]);
  assert.throws(() => reviewExtractedWorkbook(incomplete, '2026-10-10'), /SHEET_ROW/);
  const headers = fixture(); headers.headers[0] = 'unreviewed schema';
  assert.throws(() => reviewExtractedWorkbook(headers, '2026-10-10'), /SHEET_SOURCE/);
  assert.throws(() => reviewExtractedWorkbook(fixture(), '2026-02-30'), /INSPECTION_DATE/);
  assert.throws(() => reviewExtractedWorkbook(fixture(), '2026-10-11'), /INSPECTION_DATE/);
  const r = row(2); r.values[0] = '2027-01-01';
  assert.equal(reviewExtractedWorkbook(fixture([r]), '2026-10-10').history.visit.invalid, 1);
});

test('writes only the redacted audit and keeps source bytes unchanged', t => {
  const f = files(t), bytes = readFileSync(f.source);
  const report = auditWorkbookFile(f.options, f.extract);
  assert.equal(report.sourceUnchanged, true);
  assert.deepEqual(readFileSync(f.source), bytes);
  assert.doesNotMatch(readFileSync(f.output, 'utf8'), /PRIVATE/);
  assert.deepEqual(JSON.parse(readFileSync(f.output, 'utf8')), report);
});

test('rejects wrong source hash before extraction and rejects a mismatched extracted hash', t => {
  const f = files(t);
  assert.throws(() => auditWorkbookFile({ ...f.options, sha256: 'b'.repeat(64) }, () => {
    assert.fail('must not extract stale source');
  }), /SOURCE_HASH_CHANGED/);
  assert.throws(() => auditWorkbookFile(f.options, () => fixture()), /EXTRACTED_SOURCE_HASH_CHANGED/);
  assert.equal(existsSync(f.output), false);
});

test('does not save a report if source changes during extraction', t => {
  const f = files(t);
  assert.throws(() => auditWorkbookFile(f.options, () => {
    writeFileSync(f.source, 'edited during review'); return f.extract();
  }), /SOURCE_CHANGED_DURING_REVIEW/);
  assert.equal(existsSync(f.output), false);
});

test('never overwrites existing reports and refuses outputs outside reports', t => {
  const f = files(t); writeFileSync(f.output, 'previous report');
  assert.throws(() => auditWorkbookFile(f.options, f.extract), /OUTPUT_ALREADY_EXISTS/);
  assert.equal(readFileSync(f.output, 'utf8'), 'previous report');
  assert.throws(() => auditWorkbookFile({ ...f.options, output: join(root, 'wrong.json') }, f.extract), /REPORT_OUTPUT_REQUIRED/);
  assert.throws(() => auditWorkbookFile({ ...f.options, output: '../outside.json' }, f.extract), /WORKSPACE_PATH_REQUIRED/);
});

test('refuses old approval options and CLI errors never disclose supplied content', t => {
  const f = files(t);
  assert.throws(() => auditWorkbookFile({ ...f.options, approvedOwners: true }, f.extract), /AUDIT_ARGUMENTS_REQUIRED/);
  const result = spawnSync(process.execPath, [join(root, 'scripts/sales-import/review-workbook.mjs'),
    '--approved-owners-20260929', '--source', 'PRIVATE CUSTOMER'], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.doesNotMatch(result.stderr, /PRIVATE|stack|Error:/);
  assert.match(result.stderr, /^WORKBOOK_AUDIT_FAILED:/);
});
