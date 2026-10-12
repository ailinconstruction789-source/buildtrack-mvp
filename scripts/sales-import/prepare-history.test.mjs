import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, symlinkSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { parseArguments, resolvePreparationPaths, prepareHistoryFile, repositoryRoot } from './prepare-history.mjs';

const base = join(repositoryRoot, 'node_modules/.cache/buildtrack-history-prepare/tests');
mkdirSync(base, { recursive: true });
const owned = mkdtempSync(join(base, 'test-'));
const fixturePath = join(repositoryRoot, 'sql/sales/runtime/fixtures/historical-timeline-input.example.json');
const fixtureBytes = readFileSync(fixturePath);
const input = join(owned, 'synthetic-input.json');
writeFileSync(input, fixtureBytes, { flag: 'wx' });
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
let originalReport;

test('requires explicit local paths and rejects unknown, missing and duplicate CLI flags', () => {
  assert.deepEqual(parseArguments(['--input', 'fixture.json', '--output', 'review.json']), { input: 'fixture.json', output: 'review.json' });
  for (const args of [[], ['--input', 'a.json'], ['--input', 'a.json', '--output'], ['--input', 'a.json', '--output', 'b.json', '--database', 'remote'],
    ['--input', 'a.json', '--output', 'b.json', '--input', 'c.json']]) assert.throws(() => parseArguments(args));
});
test('never overwrites the input or any existing report', () => {
  assert.throws(() => resolvePreparationPaths({ input, output: input }), /INPUT_OUTPUT_MUST_DIFFER/);
  const output = join(owned, 'protected-output.json'); writeFileSync(output, 'protected', { flag: 'wx' });
  assert.throws(() => prepareHistoryFile({ input, output }), /OUTPUT_ALREADY_EXISTS/);
  assert.equal(readFileSync(output, 'utf8'), 'protected'); assert.equal(digest(readFileSync(input)), digest(fixtureBytes));
});
test('rejects outside paths, protected repository metadata, non-JSON and implicit output directories', () => {
  const output = join(owned, 'safe.json');
  assert.throws(() => resolvePreparationPaths({ input: '../outside.json', output }), /PATH_OUTSIDE_REPOSITORY/);
  assert.throws(() => resolvePreparationPaths({ input, output: '../outside.json' }), /PATH_OUTSIDE_REPOSITORY/);
  assert.throws(() => resolvePreparationPaths({ input, output: '.git/test.json' }), /PATH_FORBIDDEN/);
  assert.throws(() => resolvePreparationPaths({ input, output: join(owned, 'output.txt') }), /JSON_PATH_REQUIRED/);
  assert.throws(() => resolvePreparationPaths({ input, output: join(owned, 'not-created', 'output.json') }), /OUTPUT_PARENT_REQUIRED/);
});
test('rejects a junction/symlink parent that resolves outside the repository without touching its target', t => {
  const escape = join(owned, 'external-parent-link');
  try { symlinkSync(dirname(repositoryRoot), escape, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) { t.skip('Filesystem cannot create the test link'); return; } throw error; }
  assert.throws(() => resolvePreparationPaths({ input, output: join(escape, 'not-written.json') }), /PATH_LINK_OUTSIDE_REPOSITORY/);
});
test('invalid JSON and oversized files fail before producing output', () => {
  const invalid = join(owned, 'invalid.json'), output = join(owned, 'invalid-result.json');
  writeFileSync(invalid, '{invalid', { flag: 'wx' });
  assert.throws(() => prepareHistoryFile({ input: invalid, output }), /INPUT_JSON_INVALID/); assert.equal(existsSync(output), false);
  const large = join(owned, 'oversized.json'); writeFileSync(large, Buffer.alloc(8 * 1024 * 1024 + 1, 32), { flag: 'wx' });
  assert.throws(() => prepareHistoryFile({ input: large, output }), /INPUT_TOO_LARGE/); assert.equal(existsSync(output), false);
});
test('compiles only the pure module and prepares the synthetic known/unknown purchase, rental and visit fixture', () => {
  const output = join(owned, 'prepared.json');
  const summary = prepareHistoryFile({ input, output }); originalReport = output;
  assert.equal(summary.inputBytesSha256, digest(fixtureBytes));
  assert.deepEqual(summary.counts, { sourceRecords: 3, rowsHeldForReview: 0, mappedRows: 3, protectedFromLost: 2,
    events: 7, knownDayEvents: 4, unknownDateEvents: 3 });
  assert.equal(summary.writesAllowed, false); assert.equal(summary.importReady, false); assert.equal(summary.productionChanged, false);
  const report = JSON.parse(readFileSync(output, 'utf8'));
  assert.equal(report.preparedPlan.leadRequired, false); assert.equal(report.preparedPlan.replayEarlierSteps, false);
  assert.equal(report.evidenceLedgerCandidate.version, 'historical-evidence-ledger-v1');
  assert.equal(report.evidenceLedgerCandidate.businessWritesAllowed, false);
  assert.equal(report.evidenceLedgerCandidate.records.length, 3);
  assert.equal(report.evidenceLedgerHold, null);
  assert.match(report.sourceVerification, /declarations requiring independent review/);
  assert.notEqual(report.inputBytesSha256, report.declaredSourceSnapshotSha256);
  assert.equal(report.preparedPlan.rows[0].source.events[1].date, null);
  assert.equal(report.preparedPlan.rows[0].source.events[2].date, '2024-02-29');
  assert.equal(digest(readFileSync(input)), digest(fixtureBytes));
});

test('keeps held review rows but never creates an executable ledger candidate for missing mapping', () => {
  const data = JSON.parse(fixtureBytes.toString('utf8')); data.bindings.pop();
  const source = join(owned, 'held-source.json'), output = join(owned, 'held-output.json');
  writeFileSync(source, JSON.stringify(data), { flag: 'wx' });
  const summary = prepareHistoryFile({ input: source, output });
  const report = JSON.parse(readFileSync(output, 'utf8'));
  assert.equal(summary.counts.rowsHeldForReview, 1);
  assert.equal(report.evidenceLedgerCandidate, null);
  assert.equal(report.evidenceLedgerHold, 'HISTORICAL_LEDGER_REVIEW_REQUIRED');
  assert.equal(report.preparedPlan.rows.length, 3);
  assert.equal(report.writesAllowed, false);
});
test('an explicit prior report binds the exact canonical rerun even if JSON whitespace changes', () => {
  assert.ok(originalReport);
  const whitespace = join(owned, 'reformatted.json'), output = join(owned, 'repeated.json');
  writeFileSync(whitespace, JSON.stringify(JSON.parse(fixtureBytes.toString('utf8'))), { flag: 'wx' });
  const summary = prepareHistoryFile({ input: whitespace, output, prior: originalReport });
  assert.notEqual(summary.inputBytesSha256, digest(fixtureBytes));
  const oldPlan = JSON.parse(readFileSync(originalReport, 'utf8')).preparedPlan;
  assert.deepEqual(JSON.parse(readFileSync(output, 'utf8')).preparedPlan, oldPlan);
});
test('changing the declared snapshot or reviewed mapping fails a prior rerun without creating output', () => {
  assert.ok(originalReport);
  const data = JSON.parse(fixtureBytes.toString('utf8')); data.manifest.snapshotSha256 = 'e'.repeat(64);
  const changed = join(owned, 'changed.json'), output = join(owned, 'changed-output.json');
  writeFileSync(changed, JSON.stringify(data), { flag: 'wx' });
  assert.throws(() => prepareHistoryFile({ input: changed, output, prior: originalReport }), /HISTORICAL_TIMELINE_PLAN_CHANGED/);
  assert.equal(existsSync(output), false); assert.equal(digest(readFileSync(input)), digest(fixtureBytes));
});
test('does not accept a prior reference as permission for writes', () => {
  const prior = join(owned, 'fake-authorization.json'), output = join(owned, 'authorization-output.json');
  writeFileSync(prior, JSON.stringify({ version: 'historical-timeline-preparation-report-v1', writesAllowed: true }), { flag: 'wx' });
  assert.throws(() => prepareHistoryFile({ input, output, prior }), /PRIOR_REPORT_INVALID/); assert.equal(existsSync(output), false);
});
test('an explicitly supplied null prior cannot silently disable rerun comparison', () => {
  const prior = join(owned, 'null-prior.json'), output = join(owned, 'null-prior-output.json');
  writeFileSync(prior, 'null', { flag: 'wx' });
  assert.throws(() => prepareHistoryFile({ input, output, prior }), /PRIOR_REPORT_INVALID/); assert.equal(existsSync(output), false);
});
test('source input is explicitly scoped relative to repository rather than current working directory', () => {
  const relativeInput = relative(repositoryRoot, input), relativeOutput = relative(repositoryRoot, join(owned, 'relative-output.json'));
  const paths = resolvePreparationPaths({ input: relativeInput, output: relativeOutput });
  assert.equal(paths.input, input); assert.equal(paths.output, join(owned, 'relative-output.json'));
});
