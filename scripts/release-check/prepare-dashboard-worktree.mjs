/** Bounded mechanical preparation. No commit, push, network, SQL or activation.
 * Usage: node scripts/release-check/prepare-dashboard-worktree.mjs --report <absolute release-report.json>
 * Requires a clean target; a partial preparation must be reviewed rather than blindly resumed. */
import assert from 'node:assert/strict';
import { readFileSync, existsSync, lstatSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DASHBOARD_BASELINE, DASHBOARD_OVERLAY } from './dashboard-selection.mjs';
import { DETAILS_BASELINE, DETAILS_OVERLAY } from './dashboard-details-selection.mjs';

const root = 'D:/buildtrack/buildtrack-mvp-main';
const destination = 'C:/Users/HUAWEI/.codex/worktrees/account-guard-release/buildtrack-mvp-main';
const patchExe = 'C:/Users/HUAWEI/AppData/Local/OpenAI/Codex/bin/c6fe824d725f02d7/codex.exe';
const normalize = text => text.replaceAll('\r\n', '\n');
const sha256 = value => createHash('sha256').update(value).digest('hex');
const gitAt = (cwd, ...args) => execFileSync('git', ['-c', `safe.directory=${cwd}`, '-C', cwd, ...args], {
  encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, windowsHide: true,
});
const git = (...args) => gitAt(destination, ...args);

function noLinks(base, path) {
  const rel = relative(resolve(base), resolve(path));
  assert.ok(rel && !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..\\') && !rel.startsWith('../'), 'Path outside reviewed directory');
  let cursor = resolve(path);
  while (cursor !== resolve(base)) {
    if (existsSync(cursor)) assert.equal(lstatSync(cursor).isSymbolicLink(), false, 'Linked release path');
    cursor = dirname(cursor);
  }
}
function exactKeys(value, expected, label) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), `${label} missing`);
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), `${label} keys differ`);
}
function buildPatches(target, candidate, oldText, nextText) {
  if (oldText === nextText) return [];
  assert.ok(nextText.endsWith('\n'), 'Selected source needs final newline');
  if (oldText !== null) {
    let diff;
    try { diff = execFileSync('git', ['diff', '--no-index', '--ignore-space-at-eol', '--', target, candidate], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, windowsHide: true }); }
    catch (error) { if (error.status !== 1) throw error; diff = error.stdout; }
    const lines = normalize(diff).split('\n');
    const start = lines.findIndex(line => line.startsWith('@@'));
    assert.ok(start >= 0, 'Missing selected-file diff');
    const hunks = lines.slice(start).filter(line => !line.startsWith('\\ No newline')).join('\n').replace(/\n$/, '').replace(/^@@.*@@.*$/gm, '@@');
    assert.ok(hunks.length < 26000, 'Oversized selected-file patch');
    return [`*** Update File: ${target}\n${hunks}`];
  }
  const lines = nextText.slice(0, -1).split('\n'), patches = [];
  let offset = 0;
  while (offset < lines.length) {
    let end = offset, size = 0;
    while (end < lines.length && size + lines[end].length + 2 < 11000) { size += lines[end].length + 2; end++; }
    assert.ok(end > offset, 'Unusually long selected source line');
    const additions = lines.slice(offset, end).map(line => `+${line}`).join('\n');
    patches.push(offset === 0 ? `*** Add File: ${target}\n${additions}`
      : `*** Update File: ${target}\n@@\n${lines.slice(Math.max(0, offset - 5), offset).map(line => ` ${line}`).join('\n')}\n${additions}\n*** End of File`);
    offset = end;
  }
  return patches;
}

async function main() {
  const input = process.argv.slice(2), details = input[0] === '--details';
  const args = details ? input.slice(1) : input;
  const baseline = details ? DETAILS_BASELINE : DASHBOARD_BASELINE;
  const overlay = details ? DETAILS_OVERLAY : DASHBOARD_OVERLAY;
  assert.ok(args.length === 2 && args[0] === '--report' && isAbsolute(args[1]), 'Expected --report with an absolute release-report.json path');
  noLinks(join(root, '.next/release-check'), args[1]);
  const reportPath = realpathSync(args[1]), candidateRoot = dirname(reportPath);
  noLinks(join(root, '.next/release-check'), reportPath);
  assert.equal(basename(reportPath), 'release-report.json');
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  assert.equal(report.status, 'passed');
  assert.equal(report.profile, `selected-${details ? 'details' : 'dashboard'}-offline-webpack-low-memory`);
  assert.equal(report.releaseScope, 'central_visits');
  assert.equal(report.baselineCommit, baseline);
  assert.equal(report.sourceFilesUnchanged, true);
  assert.equal(report.realCredentialsLoaded, false);
  assert.equal(report.productionChanged, false);
  assert.equal(report.deployed, false);
  assert.equal(realpathSync(report.directory), candidateRoot);
  assert.equal(realpathSync(report.sourceRoot), realpathSync(root));
  assert.deepEqual(report.overlayFiles, overlay);
  assert.equal(overlay.length, details ? 14 : 5);
  exactKeys(report.sources, overlay, 'Source hashes');
  exactKeys(report.overlayHashes, overlay, 'Overlay hashes');
  for (const label of ['selected-tests', 'typegen', 'typecheck', 'build']) {
    assert.equal(report.steps.filter(step => step.label === label && step.code === 0).length, 1, `Successful ${label} required`);
  }
  assert.ok(report.steps.every(step => step.code === 0), 'A recorded check failed');
  assert.ok(Number.isFinite(Date.parse(report.finishedAt)), 'Completed report required');
  assert.equal(git('rev-parse', 'HEAD').trim(), baseline);
  assert.equal(git('status', '--porcelain=v1', '--untracked-files=all').trim(), '', 'Release worktree must be completely clean');
  assert.equal(realpathSync(git('rev-parse', '--path-format=absolute', '--git-common-dir').trim()),
    realpathSync(gitAt(root, 'rev-parse', '--path-format=absolute', '--git-common-dir').trim()), 'Different repository');
  assert.ok(existsSync(patchExe), 'Reviewed apply_patch executable missing');
  const prepared = overlay.map(file => {
    const candidate = join(candidateRoot, file), source = join(root, file), target = join(destination, file).replaceAll('\\', '/');
    noLinks(candidateRoot, candidate); noLinks(destination, target);
    const bytes = readFileSync(candidate);
    assert.equal(sha256(bytes), report.overlayHashes[file], `Candidate drift: ${file}`);
    assert.equal(report.snapshotHashes[file], report.overlayHashes[file], `Snapshot hash differs: ${file}`);
    noLinks(root, source);
    const digest = sha256(readFileSync(source));
    assert.equal(digest, report.sources[file], `Main source drift: ${file}`);
    assert.equal(digest, report.overlayHashes[file], `Source/overlay differs: ${file}`);
    const oldText = existsSync(target) ? normalize(readFileSync(target, 'utf8')) : null;
    const nextText = normalize(bytes.toString('utf8'));
    return { file, target, oldText, nextText, hash: sha256(bytes), patches: buildPatches(target, candidate, oldText, nextText) };
  });
  // Nothing above this line writes. Every patch is prepared before the first write.
  assert.equal(git('status', '--porcelain=v1', '--untracked-files=all').trim(), '', 'Worktree changed during preparation');
  for (const entry of prepared) {
    const current = existsSync(entry.target) ? normalize(readFileSync(entry.target, 'utf8')) : null;
    assert.equal(current, entry.oldText, `Concurrent target edit: ${entry.file}`);
    for (const patch of entry.patches) execFileSync(patchExe, ['--codex-run-as-apply-patch', `*** Begin Patch\n${patch}\n*** End Patch`], {
      encoding: 'utf8', maxBuffer: 1024 * 1024, windowsHide: true,
    });
    assert.equal(normalize(readFileSync(entry.target, 'utf8')), entry.nextText, `Prepared content differs: ${entry.file}`);
    console.log(`Verified ${entry.file} ${entry.hash}`);
  }
  assert.equal(git('diff', '--cached', '--name-only').trim(), '', 'Unexpected staged changes');
  const changed = [...git('diff', '--name-only', 'HEAD').split('\n'), ...git('ls-files', '--others', '--exclude-standard').split('\n')].filter(Boolean).sort();
  assert.deepEqual(changed, [...overlay], 'Prepared paths differ from exact overlay');
  git('diff', '--check');
  console.log(`Prepared ${overlay.length} Dashboard manifest files from ${reportPath}; no commit, push, SQL or deployment performed.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
