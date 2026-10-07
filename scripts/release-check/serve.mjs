/** Serve only a previously checked, credential-free snapshot on random loopback. */
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { buildEnvironment } from './check.mjs';

const root = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '../..'));
const name = process.argv[2];
if (process.argv.length !== 3 || !/^app-[a-zA-Z0-9]{6}$/.test(name ?? '')) throw new Error('Supply only a checked snapshot name');
const directory = realpathSync(join(root, '.next/release-check', name));
if (relative(join(root, '.next/release-check'), directory) !== name) throw new Error('Unexpected snapshot path');
const build = JSON.parse(readFileSync(join(directory, 'release-report.json'), 'utf8'));
if (build.directory !== directory || build.status !== 'passed' || !build.sourceFilesUnchanged
  || build.realCredentialsLoaded !== false || !['all-source-offline-webpack-low-memory', 'selected-visit-offline-webpack-low-memory'].includes(build.profile)
  || !build.steps.some(step => step.label === 'build' && step.code === 0)
  || readdirSync(directory).some(file => file.startsWith('.env'))) throw new Error('Snapshot did not pass safety checks');

const reserve = createServer();
await new Promise((accept, reject) => { reserve.once('error', reject); reserve.listen(0, '127.0.0.1', accept); });
const port = reserve.address().port;
await new Promise(accept => reserve.close(accept));
const env = { ...buildEnvironment(process.env, root, build.releaseScope ?? null), NODE_OPTIONS: '--max-old-space-size=384 --max-semi-space-size=1' };
const child = spawn(process.execPath, [join(root, 'node_modules/next/dist/bin/next'), 'start', directory,
  '--hostname', '127.0.0.1', '--port', String(port)], { cwd: directory, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
const report = { directory, port, pid: child.pid, origin: `http://127.0.0.1:${port}`, startedAt: new Date().toISOString(),
  productionChanged: false, realCredentialsLoaded: false, stopped: false, status: 'starting' };
const record = () => writeFileSync(join(directory, 'serve-report.json'), JSON.stringify(report, null, 2));
record();
for (const stream of [child.stdout, child.stderr]) stream.on('data', data => process.stdout.write(data));
let stopping = false;
function stop() { if (!stopping) { stopping = true; child.kill('SIGTERM'); } }
const timer = setTimeout(stop, 10 * 60_000);
process.once('SIGINT', stop); process.once('SIGTERM', stop);
process.stdin.on('data', value => { if (String(value).trim() === 'stop') stop(); });
process.stdin.resume();
child.once('error', error => { report.status = 'failed'; report.error = error.message; record(); clearTimeout(timer); process.exitCode = 1; process.stdin.pause(); });
child.once('exit', (code, signal) => {
  report.stopped = true; report.status = stopping ? 'stopped' : 'exited';
  report.exitCode = code; report.signal = signal; report.finishedAt = new Date().toISOString(); record();
  clearTimeout(timer); process.stdin.pause(); console.log('Owned snapshot server stopped.');
});
console.log(`Snapshot only: ${report.origin}; send "stop" to end. Auto-stop after 10 minutes.`);
