/** Local pre-deploy check. No credentials, Git writes, SQL, deployment or server. */
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, statfsSync, writeFileSync } from 'node:fs';
import { freemem } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VISIT_BASELINE, VISIT_OVERLAY, VISIT_TEST_FILES, selectedVisitFiles } from './visit-selection.mjs';
import { EXCEL_BASELINE, EXCEL_OVERLAY, EXCEL_ENTRY_PATH, EXCEL_TEST_FILES, selectedExcelFiles, excelSourceOverride } from './excel-selection.mjs';
import { DASHBOARD_BASELINE, DASHBOARD_OVERLAY, DASHBOARD_TEST_FILES, selectedDashboardFiles } from './dashboard-selection.mjs';
import { DETAILS_BASELINE, DETAILS_OVERLAY, DETAILS_TEST_FILES, selectedDetailsFiles } from './dashboard-details-selection.mjs';

export function includeSource(path) {
  if (path.split(/[\\/]/).some(part => part.startsWith('.') || part === 'node_modules')) return false;
  return /\.(?:tsx?|mts|[cm]?js|jsx|css)$/.test(path)
    || ['package.json', 'package-lock.json', 'tsconfig.json'].includes(path)
    || /^(?:public|app)\/.*\.(?:svg|png|jpe?g|webp|ico|woff2?)$/.test(path);
}
export function buildEnvironment(source, root, releaseScope = null) {
  if (releaseScope !== null && !['central_booking', 'central_visits'].includes(releaseScope)) throw new Error('Unknown local release scope');
  const allowed = new Set(['systemroot', 'windir', 'path', 'pathext', 'temp', 'tmp', 'comspec']);
  return { ...Object.fromEntries(Object.entries(source).filter(([name]) => allowed.has(name.toLowerCase()))),
    NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1',
    NODE_OPTIONS: '--max-old-space-size=1536 --max-semi-space-size=1',
    NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:1', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'synthetic-build-only',
    NEXT_PUBLIC_ACCOUNT_GUARDED_COMMANDS_ENABLED: 'true',
    NEXT_PUBLIC_ACCOUNT_TRUSTED_AUTH_ENABLED: 'false',
    NEXT_FONT_GOOGLE_MOCKED_RESPONSES: join(root, 'scripts/sales-ui-test/fonts.cjs'),
    ...(releaseScope !== null ? {
      SALES_CRM_RELEASE_SCOPE: releaseScope,
      ...Object.fromEntries(['V2', 'LEAD_WORK', 'LIFECYCLE', 'BOOKING', 'PROJECT_SALES', 'PROJECT_WORKSPACE'].map(name => [`SALES_CRM_${name}_ENABLED`, 'true'])),
      ...Object.fromEntries(['SCHEDULE', 'NOTIFICATIONS', 'SLA_PREVIEW', 'QUEUE_MONITOR', 'POST_BOOKING', 'PROJECT_INTERESTS'].map(name => [`SALES_CRM_${name}_ENABLED`, 'false'])),
      ...Object.fromEntries(['VISITS', 'VISIT_SOP', 'CUSTOMER_VOICES', 'VISIT_FOLLOW_UP'].map(name => [`SALES_CRM_${name}_ENABLED`, releaseScope === 'central_visits' ? 'true' : 'false'])),
    } : {}),
  };
}
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
export function sourceArgument(args, toolRoot) {
  if (args.length === 0) return toolRoot;
  if (args.length !== 2 || args[0] !== '--source' || !isAbsolute(args[1])) throw new Error('Expected --source with an absolute local worktree path');
  return args[1];
}
export function releaseArguments(args, toolRoot) {
  if (args[0] === '--dashboard-details') {
    if (args.length !== 1) throw new Error('Dashboard details require immutable baseline and explicit overlay');
    return { releaseScope: 'central_visits', candidate: 'details', source: toolRoot };
  }
  if (args[0] === '--restore-dashboard') {
    if (args.length !== 1) throw new Error('Dashboard candidate uses only the immutable baseline and explicit local overlay');
    return { releaseScope: 'central_visits', candidate: 'dashboard', source: toolRoot };
  }
  if (args[0] === '--central-excel') {
    if (args.length !== 1) throw new Error('Excel candidate uses only the immutable baseline and explicit local overlay');
    return { releaseScope: 'central_visits', candidate: 'excel', source: toolRoot };
  }
  if (args[0] === '--central-visits') {
    if (args.length !== 1) throw new Error('Visit candidate uses only the immutable baseline and explicit local overlay');
    return { releaseScope: 'central_visits', source: toolRoot };
  }
  const bounded = args[0] === '--central-booking';
  return { releaseScope: bounded ? 'central_booking' : null, source: sourceArgument(bounded ? args.slice(1) : args, toolRoot) };
}
async function main() {
  const toolRoot = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '../..'));
  const options = releaseArguments(process.argv.slice(2), toolRoot);
  const root = realpathSync(options.source);
  const git = (cwd, args, encoding) => execFileSync('git', ['-c', `safe.directory=${cwd.replaceAll('\\', '/')}`, ...args], { cwd, encoding, maxBuffer: 32 * 1024 * 1024 });
  const gitPath = (cwd, option) => realpathSync(git(cwd, ['rev-parse', '--path-format=absolute', option], 'utf8').trim());
  if (gitPath(root, '--show-toplevel') !== root || gitPath(root, '--git-common-dir') !== gitPath(toolRoot, '--git-common-dir')) {
    throw new Error('Source must be a worktree of this repository');
  }
  const space = statfsSync(toolRoot);
  if (space.bavail * space.bsize < 2 * 1024 ** 3 || freemem() < 512 * 1024 ** 2) throw new Error('Need 2 GiB disk and 512 MiB free RAM');
  const selected = options.releaseScope === 'central_visits';
  const excel = options.candidate === 'excel';
  const dashboard = options.candidate === 'dashboard';
  const details = options.candidate === 'details';
  const baseline = details ? DETAILS_BASELINE : dashboard ? DASHBOARD_BASELINE : excel ? EXCEL_BASELINE : VISIT_BASELINE;
  const overlay = details ? DETAILS_OVERLAY : dashboard ? DASHBOARD_OVERLAY : excel ? EXCEL_OVERLAY : VISIT_OVERLAY;
  const baselineFiles = selected ? git(root, ['ls-tree', '-rz', '--name-only', baseline], 'utf8').split('\0') : [];
  const files = selected ? (details ? selectedDetailsFiles : dashboard ? selectedDashboardFiles : excel ? selectedExcelFiles : selectedVisitFiles)(baselineFiles, includeSource)
    : [...new Set(git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], 'utf8').split('\0').filter(includeSource))].sort();
  const cache = join(toolRoot, '.next/release-check');
  mkdirSync(cache, { recursive: true });
  const directory = mkdtempSync(join(cache, 'app-'));
  const report = { directory, sourceRoot: root, startedAt: new Date().toISOString(), status: 'running',
    profile: selected ? `selected-${details ? 'details' : dashboard ? 'dashboard' : excel ? 'excel' : 'visit'}-offline-webpack-low-memory` : 'all-source-offline-webpack-low-memory', releaseScope: options.releaseScope, productionChanged: false, deployed: false,
    ...(selected ? { baselineCommit: baseline, overlayFiles: overlay, overlayHashes: {}, snapshotHashes: {} } : {}),
    realCredentialsLoaded: false, sources: {}, steps: [], sourceFilesUnchanged: null,
    limitations: ['Synthetic Supabase URL/key; no Auth/API acceptance', 'Offline font fixture',
      'Low-memory webpack config, not default Vercel Turbopack build', 'Reuses installed dependencies; not npm ci'] };
  const record = () => writeFileSync(join(directory, 'release-report.json'), JSON.stringify(report, null, 2));
  try {
    for (const file of files) {
      if (selected && (!overlay.includes(file) || (excel && file === EXCEL_ENTRY_PATH))) {
        const original = git(root, ['show', `${baseline}:${file}`]);
        const body = excel && file === EXCEL_ENTRY_PATH ? Buffer.from(excelSourceOverride(file, original.toString('utf8'))) : original;
        const target = join(directory, file);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, body);
        report.snapshotHashes[file] = createHash('sha256').update(body).digest('hex');
        if (excel && file === EXCEL_ENTRY_PATH) report.overlayHashes[file] = report.snapshotHashes[file];
        continue;
      }
      const source = resolve(root, file);
      const rel = relative(root, source);
      if (!rel || rel.startsWith('..') || isAbsolute(rel) || !existsSync(source)) throw new Error(`Invalid source: ${file}`);
      let cursor = source;
      while (cursor !== root) { if (lstatSync(cursor).isSymbolicLink()) throw new Error(`Linked source: ${file}`); cursor = dirname(cursor); }
      report.sources[file] = hash(source);
      const target = join(directory, file);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(source, target);
      if (selected) { report.overlayHashes[file] = report.sources[file]; report.snapshotHashes[file] = report.sources[file]; }
    }
    // Reuse the reviewed local low-memory profile; original app config stays unchanged.
    copyFileSync(join(directory, 'next.config.ts'), join(directory, 'next.original.ts'));
    copyFileSync(join(toolRoot, 'scripts/sales-ui-test/next.config.fixture.txt'), join(directory, 'next.config.ts'));
    const env = buildEnvironment(process.env, toolRoot, options.releaseScope);
    console.log(`Checking ${files.length} source/assets in ${directory}; no application .env copied.`);
    record();
    async function run(label, script, args) {
      console.log(`Starting ${label}`);
      const stepEnv = label === 'selected-tests' ? { ...buildEnvironment(process.env, toolRoot), NODE_ENV: 'test' } : env;
      const child = spawn(process.execPath, [script, ...args], { cwd: directory, env: stepEnv, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '';
      for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { output += data; process.stdout.write(data); });
      const code = await new Promise((accept, reject) => { child.once('error', reject); child.once('close', accept); });
      writeFileSync(join(directory, `${label}.log`), output);
      report.steps.push({ label, code }); record();
      if (code !== 0) throw new Error(`${label} failed (${code}); see local log`);
    }
    if (selected) await run('selected-tests', join(toolRoot, 'node_modules/vitest/vitest.mjs'), ['run',
      ...(details ? DETAILS_TEST_FILES : dashboard ? DASHBOARD_TEST_FILES : excel ? EXCEL_TEST_FILES : VISIT_TEST_FILES).filter(file => /\.test\./.test(file)),
      'lib/sales/__tests__/leadWorkServer.test.ts', 'lib/sales/__tests__/leadWorkClient.test.ts',
      'lib/sales/__tests__/bookingServer.test.ts', 'lib/sales/__tests__/projectMapServer.test.ts',
      'components/sales/__tests__/CentralLeadsView.test.tsx',
      'components/sales/__tests__/BookingWorkspace.test.tsx',
      'components/sales/__tests__/ProjectSalesMap.test.tsx',
      ...['notification', 'workSchedule', 'slaPreview', 'slaCycle', 'slaReceipt', 'slaProcessing'].map(name => `lib/sales/__tests__/${name}Server.test.ts`),
      '--maxWorkers=1']);
    await run('typegen', join(toolRoot, 'node_modules/next/dist/bin/next'), ['typegen', directory]);
    await run('typecheck', join(toolRoot, 'node_modules/typescript/bin/tsc'), ['--noEmit', '--incremental', 'false', '--pretty', 'false']);
    await run('build', join(toolRoot, 'node_modules/next/dist/bin/next'), ['build', directory, '--webpack']);
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed'; report.error = error.message; process.exitCode = 1;
    console.error(error.message);
  } finally {
    report.sourceFilesUnchanged = Object.entries(report.sources).every(([file, digest]) => existsSync(join(root, file)) && hash(join(root, file)) === digest);
    if (!report.sourceFilesUnchanged) { report.status = 'failed'; process.exitCode = 1; }
    report.finishedAt = new Date().toISOString(); record();
    console.log(`Release check report: ${join(directory, 'release-report.json')}`);
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
