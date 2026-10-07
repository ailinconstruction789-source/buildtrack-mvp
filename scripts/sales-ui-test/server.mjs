/** Starts a copied, credential-free app and synthetic HTTP backend on loopback only. */
import { mkdirSync, mkdtempSync, statfsSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { freemem } from 'node:os';
import { createVoiceFixture, fixtureOrigin, fixtureKey } from './fixture.mjs';
import { copyVoiceSnapshot } from './snapshot.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const memoryProbe = join(root, 'scripts/sales-ui-test/memory.cjs').replaceAll('\\', '/');
// Lean profile: finish the bounded compiler BEFORE starting Chromium. No dev compiler remains.
// This is not the former concurrent 1536 MiB dev-server profile's 2 GiB RAM requirement.
if (freemem() < 512 * 1024 * 1024) throw new Error('Browser check paused: need at least 512 MiB free RAM for the sequential profile');
const sourceSpace = statfsSync(root);
if (sourceSpace.bavail * sourceSpace.bsize < 1024 * 1024 * 1024) throw new Error('Browser check paused: need at least 1 GiB free on the workspace disk');
// Keep source, output and dependencies on one drive. No cross-drive junctions.
const cache = join(root, '.next/voices-browser'); mkdirSync(cache, { recursive: true });
const directory = mkdtempSync(join(cache, 'app-'));
const sources = copyVoiceSnapshot(root, directory);
const reportPath = join(root, 'node_modules/.cache/buildtrack-voices-browser/harness.json');
mkdirSync(dirname(reportPath), { recursive: true });
const report = { syntheticOnly: true, directory, sourceCount: sources.length, mode: 'sequential-production-snapshot', build: 'pending', stopped: false };
const record = () => writeFileSync(reportPath, JSON.stringify(report, null, 2));
record();
// Do not inherit application credentials, proxy settings or NODE_OPTIONS from the caller.
const environment = {};
for (const name of ['SystemRoot', 'WINDIR', 'PATH', 'Path', 'PATHEXT', 'TEMP', 'TMP', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'COMSPEC']) {
  if (process.env[name]) environment[name] = process.env[name];
}
Object.assign(environment, { NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1',
  NODE_OPTIONS: `--max-old-space-size=512 --max-semi-space-size=1 --require="${memoryProbe}"`,
  NEXT_PUBLIC_SUPABASE_URL: fixtureOrigin, NEXT_PUBLIC_SUPABASE_ANON_KEY: fixtureKey,
  NEXT_FONT_GOOGLE_MOCKED_RESPONSES: join(root, 'scripts/sales-ui-test/fonts.cjs'),
  SALES_CRM_V2_ENABLED: 'true', SALES_CRM_LEAD_WORK_ENABLED: 'true', SALES_CRM_LIFECYCLE_ENABLED: 'true',
  SALES_CRM_VISITS_ENABLED: 'true', SALES_CRM_CUSTOMER_VOICES_ENABLED: 'true' });
const fixture = createVoiceFixture();
const launch = args => spawn(process.execPath, [join(root, 'node_modules/next/dist/bin/next'), ...args], { cwd: directory, env: environment, stdio: 'inherit', windowsHide: true });
let child;
let stopping = false;
function stop(code = 0) {
  if (stopping) return; stopping = true;
  fixture.closeAllConnections();
  // Only terminate the process tree created by this harness; no process-name matching.
  const finish = () => { report.stopped = true; record(); process.exit(code); };
  if (child?.pid && child.exitCode === null) {
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      killer.once('exit', exitCode => { if (exitCode !== 0) console.error('Owned test process termination needs verification'); fixture.close(finish); });
      killer.once('error', () => { console.error('Owned test process termination needs verification'); fixture.close(finish); });
    } else { child.kill('SIGTERM'); fixture.close(finish); }
  } else fixture.close(finish);
}
process.once('SIGINT', () => stop()); process.once('SIGTERM', () => stop());
console.log(`Synthetic-only browser harness: compiling ${sources.length} unchanged source files before starting the browser.`);
child = launch(['build', directory, '--webpack']);
const built = await new Promise((ok, fail) => { child.once('error', fail); child.once('exit', ok); });
report.build = built === 0 ? 'passed' : 'failed'; record();
if (built !== 0) stop(1);
else {
  await new Promise((ok, fail) => { fixture.once('error', fail); fixture.listen(3147, '127.0.0.1', ok); });
  environment.NODE_OPTIONS = `--max-old-space-size=256 --max-semi-space-size=1 --require="${memoryProbe}"`;
  child = launch(['start', directory, '--hostname', '127.0.0.1', '--port', '3146']);
  child.once('error', () => stop(1)); child.once('exit', code => stop(code ?? 1));
}
