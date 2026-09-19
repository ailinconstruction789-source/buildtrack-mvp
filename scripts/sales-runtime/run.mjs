/** Disposable native PostgreSQL tests. Never accepts a URL/host/existing DB.
 * No dotenv, Supabase client, live data, installer/service, feature flag or migration.
 * Generated cluster/logs remain stopped in ignored node_modules/.cache for diagnosis.
 */
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, unlinkSync, realpathSync } from 'node:fs';
import { createServer } from 'node:net';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { assertLocalDatabaseTarget, assertPlainSql, cleanProcessEnvironment, draftPaths, localConnectionArgs, syntheticDraftBody, verifyClusterIdentity } from './safety.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const options = process.argv.slice(2);
const checkInterrupt = options.at(-1) === '--check-interrupt';
if (checkInterrupt) options.pop();
if (options.length && !(options.length === 2 && options[0] === '--bin')) throw new Error('Usage: node scripts/sales-runtime/run.mjs [--bin PATH] [--check-interrupt]');
const binaries = resolve(options[1] ?? join(root, 'node_modules/.cache/buildtrack-sales-runtime/postgres17/pgsql/bin'));
const executable = name => join(binaries, `${name}${process.platform === 'win32' ? '.exe' : ''}`);
for (const name of ['postgres', 'initdb', 'pg_ctl', 'psql']) {
    if (!existsSync(executable(name))) throw new Error(`Missing ${name}. Supply a reviewed portable PostgreSQL bin directory; no automatic install or remote fallback.`);
}
const cache = join(root, 'node_modules/.cache/buildtrack-sales-runtime/runs');
mkdirSync(cache, { recursive: true });
const directory = realpathSync(mkdtempSync(join(cache, 'run-')));
const data = join(directory, 'data');
const nonce = randomBytes(12).toString('hex');
const database = `buildtrack_sales_runtime_${nonce}`;
const user = `runtime_${nonce}`;
const password = randomBytes(32).toString('hex');
const passwordFile = join(directory, 'init-password');
const environment = cleanProcessEnvironment(process.env);
writeFileSync(passwordFile, password, { mode: 0o600, flag: 'wx' });
const report = { startedAt: new Date().toISOString(), database, directory, version: null, sources: {}, results: {}, status: 'running', stopped: false };
let postgres;
let postgresExited = false;
let postgresLog = '';
let verified = false;
let port;
let interrupted = false;
let stopPromise;
const activeCommands = new Set();

function command(file, args, input = '', env = environment, timeout = 45_000, cleanup = false) {
    if (interrupted && !cleanup) return Promise.reject(new Error('Isolated test run interrupted'));
    return new Promise((accept, reject) => {
        const child = spawn(file, args, { cwd: root, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
        let finished;
        const completion = new Promise(acceptDone => { finished = acceptDone; });
        activeCommands.add(completion);
        const finish = () => { activeCommands.delete(completion); finished(); };
        let stdout = '', stderr = '', timedOut = false;
        const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeout);
        child.stdout.on('data', chunk => { stdout += chunk; });
        child.stderr.on('data', chunk => { stderr += chunk; });
        child.stdin.on('error', () => { /* close/error below reports the actual failure */ });
        child.on('error', error => { clearTimeout(timer); finish(); reject(error); });
        child.on('close', code => {
            clearTimeout(timer);
            finish();
            if (code !== 0 || timedOut) reject(new Error(`${file.split(/[\\/]/).at(-1)} failed (${code}${timedOut ? ', timeout' : ''}):\n${stderr}\n${stdout}`));
            else accept(stdout.trim());
        });
        child.stdin.end(input);
    });
}

const pause = ms => new Promise(accept => setTimeout(accept, ms));
async function availablePort() {
    const server = createServer();
    await new Promise((accept, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', accept); });
    const result = server.address().port;
    await new Promise((accept, reject) => server.close(error => error ? reject(error) : accept()));
    return result;
}
function query(sql, target = database) {
    assertLocalDatabaseTarget(target, database);
    assertPlainSql(sql);
    if (!verified && !sql.startsWith('SELECT json_build_object(')) throw new Error('Cluster identity has not been verified');
    // Bootstrap checks the postgres DB first using the same newly-created credentials.
    const args = localConnectionArgs(port, database, user);
    args[args.indexOf('-d') + 1] = target;
    return command(executable('psql'), args, sql, { ...environment, PGPASSWORD: password,
        PGCLIENTENCODING: 'UTF8', PGOPTIONS: '-c buildtrack.synthetic_runtime=on -c standard_conforming_strings=on -c statement_timeout=20000 -c lock_timeout=12000' });
}
async function identity(target) {
    const actual = JSON.parse(await query("SELECT json_build_object('address',host(inet_server_addr()),'port',inet_server_port(),'user',current_user,'database',current_database(),'data',current_setting('data_directory'),'listen',current_setting('listen_addresses'),'marker',current_setting('buildtrack.synthetic_runtime',true));", target));
    verifyClusterIdentity(actual, { port, user, database: target, data });
    verified = true;
}

async function stopOwnedCluster() {
    if (stopPromise) return stopPromise;
    stopPromise = (async () => {
        if (!postgres || postgresExited) { report.stopped = true; return; }
        try {
            await command(executable('pg_ctl'), ['-D', data, 'stop', '-m', 'fast', '-w', '-t', '15'], '', environment, 20_000, true);
            for (let attempt = 0; attempt < 20 && !postgresExited; attempt++) await pause(50);
            if (!postgresExited) throw new Error('Owned PostgreSQL exit was not confirmed');
            report.stopped = true;
        } catch (error) {
            report.stopError = error.message;
            report.stopped = false;
            process.exitCode = 1;
            // Exact owned child only; never kill all postgres processes or by port.
            postgres.kill();
        }
    })();
    return stopPromise;
}

function onInterrupt() {
    interrupted = true;
    process.exitCode = 1;
    // An initdb already in flight may finish, but cannot start a server afterwards.
    // Graceful signals during a running server use the SAME idempotent cleanup.
    if (postgres) void stopOwnedCluster();
}
process.on('SIGINT', onInterrupt);
process.on('SIGTERM', onInterrupt);

try {
    report.version = await command(executable('postgres'), ['--version']);
    console.log(`Initializing isolated ${report.version}; no application configuration is loaded.`);
    await command(executable('initdb'), ['-D', data, '-U', user, '--pwfile', passwordFile, '-A', 'scram-sha-256', '--encoding=UTF8', '--no-locale']);
    unlinkSync(passwordFile);
    if (interrupted) throw new Error('Isolated test run interrupted');
    port = await availablePort();
    if (interrupted) throw new Error('Isolated test run interrupted');
    postgres = spawn(executable('postgres'), ['-D', data, '-p', String(port), '-c', 'listen_addresses=127.0.0.1',
        '-c', 'max_connections=20', '-c', 'timezone=UTC', '-c', 'jit=off'], { cwd: root, env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    postgres.on('error', error => { postgresLog += error.message; postgresExited = true; });
    postgres.on('exit', () => { postgresExited = true; });
    postgres.stdout.on('data', chunk => { postgresLog += chunk; });
    postgres.stderr.on('data', chunk => { postgresLog += chunk; });
    let lastError;
    for (let attempt = 0; attempt < 50; attempt++) {
        if (interrupted) throw new Error('Isolated test run interrupted');
        if (postgresExited) throw new Error(`Owned PostgreSQL process exited: ${postgresLog}`);
        try { await identity('postgres'); break; } catch (error) { lastError = error; await pause(100); }
    }
    if (!verified) throw lastError ?? new Error('Fresh PostgreSQL failed to start');
    if (checkInterrupt) {
        // Explicit local self-test of registered cleanup handlers, not an OS kill.
        process.emit('SIGINT');
        await stopOwnedCluster();
        throw new Error('Isolated test run interrupted');
    }
    await query(`CREATE DATABASE ${database};`, 'postgres');
    await identity(database);
    console.log('Verified fresh data directory, random database/user/port and loopback-only listener.');
    await query(readFileSync(join(root, 'sql/sales/runtime/fixtures/bootstrap.sql'), 'utf8'));
    for (const path of draftPaths) {
        const source = readFileSync(join(root, path), 'utf8');
        report.sources[path] = createHash('sha256').update(source).digest('hex');
        await query(syntheticDraftBody(path, source));
        console.log(`Compiled local test body: ${path}`);
    }
    report.results.compiledDrafts = draftPaths.length;
    const scenarios = join(root, 'sql/sales/runtime/scenarios/first-contact.sql');
    if (!existsSync(scenarios)) throw new Error('Required first-contact scenarios are not prepared');
    const scenarioOutput = await query(readFileSync(scenarios, 'utf8'));
    const summary = scenarioOutput.split(/\r?\n/).find(line => line.startsWith('FIRST_CONTACT_RUNTIME:'));
    if (!summary) throw new Error('First-contact suite did not emit its assertion summary');
    report.results.firstContact = JSON.parse(summary.slice('FIRST_CONTACT_RUNTIME:'.length));
    console.log(summary);
    const receiptOutput = await query(readFileSync(join(root, 'sql/sales/runtime/scenarios/receipt-review.sql'), 'utf8'));
    const receiptSummary = receiptOutput.split(/\r?\n/).find(line => line.startsWith('RECEIPT_REVIEW_RUNTIME:'));
    if (!receiptSummary) throw new Error('Receipt-review suite did not emit its assertion summary');
    report.results.receiptReview = JSON.parse(receiptSummary.slice('RECEIPT_REVIEW_RUNTIME:'.length));
    console.log(receiptSummary);
    const cycleOutput = await query(readFileSync(join(root, 'sql/sales/runtime/scenarios/cycle.sql'), 'utf8'));
    const cycleSummary = cycleOutput.split(/\r?\n/).find(line => line.startsWith('CYCLE_RUNTIME:'));
    if (!cycleSummary) throw new Error('Cycle suite did not emit its assertion summary');
    report.results.cycle = JSON.parse(cycleSummary.slice('CYCLE_RUNTIME:'.length));
    console.log(cycleSummary);
    const cronOutput = await query(readFileSync(join(root, 'sql/sales/runtime/scenarios/cron-preflight.sql'), 'utf8'));
    const cronSummary = cronOutput.split(/\r?\n/).find(line => line.startsWith('CRON_PREFLIGHT_RUNTIME:'));
    if (!cronSummary) throw new Error('Cron-preflight suite did not emit its assertion summary');
    report.results.cronPreflight = JSON.parse(cronSummary.slice('CRON_PREFLIGHT_RUNTIME:'.length));
    console.log(cronSummary);
    const workerOutput = await query(readFileSync(join(root, 'sql/sales/runtime/scenarios/system-worker.sql'), 'utf8'));
    const workerSummary = workerOutput.split(/\r?\n/).find(line => line.startsWith('SYSTEM_WORKER_RUNTIME:'));
    if (!workerSummary) throw new Error('System-worker suite did not emit its assertion summary');
    report.results.systemWorker = JSON.parse(workerSummary.slice('SYSTEM_WORKER_RUNTIME:'.length));
    console.log(workerSummary);
    const compiled = join(directory, 'compiled');
    await command(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--target', 'ES2020', '--module', 'commonjs',
        '--skipLibCheck', '--strict', '--outDir', compiled, 'lib/sales/slaCalendar.ts', 'lib/sales/initialContactStaffClock.ts']);
    const require = createRequire(import.meta.url);
    const helpers = { ...require(join(compiled, 'slaCalendar.js')), ...require(join(compiled, 'initialContactStaffClock.js')),
        ...require(join(compiled, 'leadEvidence.js')) };
    const { runClockParity } = await import('./clock-parity.mjs');
    report.results.clock = await runClockParity({ query, ...helpers });
    console.log(JSON.stringify({ clockCases: report.results.clock.cases, parityCases: report.results.clock.parityCases,
        notificationCases: report.results.clock.notificationCases }));
    const { runConcurrency } = await import('./concurrency.mjs');
    report.results.concurrency = await runConcurrency({ query });
    console.log(JSON.stringify({ concurrencyGroups: report.results.concurrency.groups, assertions: report.results.concurrency.assertions }));
    const { runCycleConcurrency } = await import('./cycle-concurrency.mjs');
    report.results.cycleConcurrency = await runCycleConcurrency({ query });
    console.log(JSON.stringify({ cycleConcurrencyGroups: report.results.cycleConcurrency.groups,
        assertions: report.results.cycleConcurrency.assertions }));
    const { runWorkerConcurrency } = await import('./worker-concurrency.mjs');
    report.results.workerConcurrency = await runWorkerConcurrency({ query });
    console.log(JSON.stringify({ workerConcurrencyGroups: report.results.workerConcurrency.groups,
        assertions: report.results.workerConcurrency.assertions }));
    const { runDispatcherScenarios } = await import('./dispatcher-scenarios.mjs');
    report.results.dispatcher = await runDispatcherScenarios({ query });
    console.log(JSON.stringify({ dispatcherGroups: report.results.dispatcher.groups,
        assertions: report.results.dispatcher.assertions }));
    const { runDispatcherConcurrency } = await import('./dispatcher-concurrency.mjs');
    report.results.dispatcherConcurrency = await runDispatcherConcurrency({ query });
    console.log(JSON.stringify({ dispatcherConcurrencyGroups: report.results.dispatcherConcurrency.groups,
        assertions: report.results.dispatcherConcurrency.assertions }));
    for (const path of draftPaths) {
        if (createHash('sha256').update(readFileSync(join(root, path))).digest('hex') !== report.sources[path]) throw new Error(`Draft changed during test run: ${path}`);
    }
    report.status = 'passed';
} catch (error) {
    report.status = interrupted ? 'interrupted' : 'failed';
    report.error = error.message;
    process.exitCode = 1;
    console.error(error.message);
} finally {
    if (existsSync(passwordFile)) unlinkSync(passwordFile);
    await stopOwnedCluster();
    await Promise.all([...activeCommands]);
    if (!report.stopped || report.stopError) { report.status = 'failed'; process.exitCode = 1; }
    if (checkInterrupt && interrupted && report.stopped && !report.stopError) {
        report.status = 'interrupt-handler-check-passed'; process.exitCode = 0;
    }
    report.finishedAt = new Date().toISOString();
    writeFileSync(join(directory, 'postgres.log'), postgresLog);
    writeFileSync(join(directory, 'report.json'), JSON.stringify(report, null, 2));
    console.log(`Runtime report: ${join(directory, 'report.json')} (cluster stopped: ${report.stopped})`);
    process.removeListener('SIGINT', onInterrupt);
    process.removeListener('SIGTERM', onInterrupt);
}
