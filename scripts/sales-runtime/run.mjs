/** Disposable native PostgreSQL tests. Never accepts a URL/host/existing DB.
 * No dotenv, Supabase client, live database, installer/service, feature flag or migration.
 * --workbook-review-only accepts a pinned redacted source plan into review tables,
 * without canonical customer/deal writes. --customer-combined-only rehearses
 * redacted captured relationships in PRIVATE fixture tables, not production guards.
 * Other modes use synthetic fixtures only.
 * --rental-source-retirement-only composes guarded six-row retirement/restore
 * with real SQL function bodies and synthetic business rows, never a live DB.
 * Generated cluster/logs remain stopped in ignored node_modules/.cache for diagnosis.
 */
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, unlinkSync, realpathSync } from 'node:fs';
import { createServer } from 'node:net';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { assertLocalDatabaseTarget, assertPlainSql, cleanProcessEnvironment, draftPaths, postBookingDraftPaths, localConnectionArgs, syntheticDraftBody, verifyClusterIdentity } from './safety.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const options = process.argv.slice(2);
const fullCustomerReplacementOwnerOnly = options.at(-1) === '--full-customer-replacement-owner-only';
const fullCustomerReplacementOnly = fullCustomerReplacementOwnerOnly || options.at(-1) === '--full-customer-replacement-only';
const workbookReviewOnly = options.at(-1) === '--workbook-review-only';
const customerCombinedOnly = options.at(-1) === '--customer-combined-only';
const customerResolutionsOnly = options.at(-1) === '--customer-resolutions-only';
const historicalEvidenceOnly = options.at(-1) === '--historical-evidence-only';
const canonicalImportAdapterOnly = options.at(-1) === '--canonical-import-adapter-only';
const rentalSourceRetirementOnly = options.at(-1) === '--rental-source-retirement-only';
const importedHistoryProjectionOnly = rentalSourceRetirementOnly || options.at(-1) === '--historical-projection-only';
const remainingCanonicalImportOnly = options.at(-1) === '--remaining-canonical-import-only';
const rentalOnly = options.at(-1) === '--rental-only';
const customerDealDetailsOnly = rentalOnly || options.at(-1) === '--customer-deal-details-only';
const postBookingOnly = importedHistoryProjectionOnly || remainingCanonicalImportOnly || canonicalImportAdapterOnly || historicalEvidenceOnly || customerDealDetailsOnly || options.at(-1) === '--post-booking-only';
if (fullCustomerReplacementOnly || postBookingOnly || workbookReviewOnly || customerCombinedOnly || customerResolutionsOnly) options.pop();
let reviewPlanPath;
if (workbookReviewOnly || customerCombinedOnly || customerResolutionsOnly) {
    const index = options.indexOf(customerResolutionsOnly ? '--resolution-plan' : customerCombinedOnly ? '--combined-plan' : '--review-plan');
    if (index < 0 || !options[index + 1] || options[index + 1].startsWith('--')) throw new Error('Explicit review plan required');
    reviewPlanPath = options[index + 1]; options.splice(index, 2);
}
const selectedDrafts = fullCustomerReplacementOnly || workbookReviewOnly || customerCombinedOnly || customerResolutionsOnly ? [] : postBookingOnly ? postBookingDraftPaths : draftPaths;
const checkInterrupt = options.at(-1) === '--check-interrupt';
if (checkInterrupt) options.pop();
if (options.length && !(options.length === 2 && options[0] === '--bin')) throw new Error('Usage: node scripts/sales-runtime/run.mjs [--bin PATH] [--check-interrupt | --post-booking-only | --customer-deal-details-only | --rental-only | --historical-evidence-only | --canonical-import-adapter-only | --remaining-canonical-import-only | --historical-projection-only | --rental-source-retirement-only | --review-plan PATH --workbook-review-only | --combined-plan PATH --customer-combined-only | --resolution-plan PATH --customer-resolutions-only]');
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
const fixturePaths = ['sql/sales/runtime/fixtures/bootstrap.sql', ...(postBookingOnly ? ['sql/sales/runtime/fixtures/post-booking-facade.sql', 'sql/sales/runtime/scenarios/post-booking.sql', 'scripts/sales-runtime/post-booking-historical.mjs', 'scripts/sales-runtime/post-booking-concurrency.mjs'] : [])];
for (const path of fixturePaths) report.sources[path] = createHash('sha256').update(readFileSync(join(root, path))).digest('hex');
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
        // PostgreSQL JSON contains Thai identifiers. Decode as a stream so a
        // multibyte character split between Buffer chunks stays intact.
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', chunk => { stdout += chunk; });
        child.stderr.on('data', chunk => { stderr += chunk; });
        child.stdin.on('error', () => { /* close/error below reports the actual failure */ });
        child.on('error', error => { clearTimeout(timer); finish(); reject(error); });
        child.on('close', code => {
            clearTimeout(timer);
            finish();
            if (code !== 0 || timedOut) {
                if (fullCustomerReplacementOnly) {
                    const diagnosticPath = join(directory, `command-failure-${Date.now()}-${randomBytes(4).toString('hex')}.log`);
                    writeFileSync(diagnosticPath, stderr + '\n' + stdout, {mode: 0o600, flag: 'wx'});
                    // Whole-source SQL errors can echo customer PII in QUERY/DETAIL.
                    // Keep that only in the ignored local diagnostic, not tool output.
                    const summary = stderr.split(/\r?\n/).filter(line => /^ERROR:\s/.test(line)).map(line => line.slice(0, 240)).join('\n');
                    reject(new Error(`${file.split(/[\\/]/).at(-1)} failed (${code}${timedOut ? ', timeout' : ''}): ${summary || 'See private diagnostic'}; diagnostic: ${diagnosticPath}`));
                } else reject(new Error(`${file.split(/[\\/]/).at(-1)} failed (${code}${timedOut ? ', timeout' : ''}):\n${stderr}\n${stdout}`));
            }
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
    if (fullCustomerReplacementOnly) {
        const {runFullReplacementRuntime}=await import('./full-customer-replacement-runtime.mjs');
        report.sources['scripts/sales-runtime/full-customer-replacement-runtime.mjs']=createHash('sha256').update(readFileSync(join(root,'scripts/sales-runtime/full-customer-replacement-runtime.mjs'))).digest('hex');
        await runFullReplacementRuntime({query,root,report,ownerJob:fullCustomerReplacementOwnerOnly,connection:{port,database,user,data},command,executable,directory,environment:{...environment,PGPASSWORD:password}});
    } else {
    await query(readFileSync(join(root, 'sql/sales/runtime/fixtures/bootstrap.sql'), 'utf8'));
    if (postBookingOnly) await query(readFileSync(join(root, 'sql/sales/runtime/fixtures/post-booking-facade.sql'), 'utf8'));
    for (const path of selectedDrafts) {
        const source = readFileSync(join(root, path), 'utf8');
        report.sources[path] = createHash('sha256').update(source).digest('hex');
        await query(syntheticDraftBody(path, source));
        console.log(`Compiled local test body: ${path}`);
    }
    report.results.compiledDrafts = selectedDrafts.length;
    if (customerResolutionsOnly) {
        const { runCustomerResolutionTrial } = await import('./customer-resolution-trial.mjs');
        report.results.customerResolutionTrial = await runCustomerResolutionTrial({ query, root, report, planPath: reviewPlanPath });
        console.log(JSON.stringify(report.results.customerResolutionTrial));
    } else if (customerCombinedOnly) {
        const { runCustomerCombinedTrial } = await import('./customer-combined-trial.mjs');
        report.results.customerCombinedTrial = await runCustomerCombinedTrial({ query, root, report, planPath: reviewPlanPath });
        console.log(JSON.stringify(report.results.customerCombinedTrial));
    } else if (workbookReviewOnly) {
        const { runWorkbookReview } = await import('./workbook-review.mjs');
        report.results.workbookReview = await runWorkbookReview({ query, root, report, planPath: reviewPlanPath });
        console.log(JSON.stringify(report.results.workbookReview));
    } else if (historicalEvidenceOnly) {
        const compiled = join(directory, 'compiled');
        await command(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--target', 'ES2022', '--module', 'commonjs',
            '--lib', 'ES2022,DOM', '--skipLibCheck', '--strict', '--outDir', compiled, 'lib/sales/historicalTimelineLedger.ts']);
        const require = createRequire(import.meta.url);
        const { prepareHistoricalLedgerInput } = require(join(compiled, 'historicalTimelineLedger.js'));
        const { runHistoricalEvidence } = await import('./historical-evidence.mjs');
        report.results.historicalEvidence = await runHistoricalEvidence({ query, root, report, prepare: prepareHistoricalLedgerInput });
        console.log(JSON.stringify(report.results.historicalEvidence));
    } else if (remainingCanonicalImportOnly || importedHistoryProjectionOnly) {
        // Compose only newly affected adapters with actual seals; old assertions
        // in this prerequisite are reported separately, never counted as new.
        await query(`INSERT INTO public.crm_settings(id,central_intake_enabled,lead_work_enabled,lead_lifecycle_enabled,booking_enabled,booking_cutover_reviewed,post_booking_enabled)
            VALUES(true,true,true,true,true,true,true) ON CONFLICT(id) DO UPDATE SET central_intake_enabled=true,lead_work_enabled=true,
            lead_lifecycle_enabled=true,booking_enabled=true,booking_cutover_reviewed=true,post_booking_enabled=true;`);
        const compiled = join(directory, 'compiled');
        await command(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--target', 'ES2022', '--module', 'commonjs',
            '--lib', 'ES2022,DOM', '--skipLibCheck', '--strict', '--outDir', compiled, 'lib/sales/postBookingContracts.ts',
            ...(importedHistoryProjectionOnly ? ['lib/sales/historicalCustomerEvidenceContracts.ts','lib/sales/excelReportContracts.ts'] : [])]);
        const require = createRequire(import.meta.url);
        const { parsePostBookingInput, parsePostBookingResult, parsePostBookingSnapshot } = require(join(compiled, 'postBookingContracts.js'));
        const { runPostBookingHistorical } = await import('./post-booking-historical.mjs');
        report.results.canonicalGuardSetup = await runPostBookingHistorical({query,root,report,preparePendingImports:true,prepareRentalRetirements:rentalSourceRetirementOnly,
            parseSnapshot:parsePostBookingSnapshot,parseInput:parsePostBookingInput,parseResult:parsePostBookingResult});
        if (importedHistoryProjectionOnly) {
            const { prepareImportedHistorySharedInterest } = await import('./imported-history-projection.mjs');
            await prepareImportedHistorySharedInterest({query,report});
        }
        for (const path of ['sql/sales/22_customer_deal_details_draft.sql','sql/sales/excel_report_evidence_draft.sql','sql/sales/26_reviewed_import_details_draft.sql']) {
            const source=readFileSync(join(root,path),'utf8');
            report.sources[path]=createHash('sha256').update(source).digest('hex');
            await query(syntheticDraftBody(path,source));
        }
        const {runHistoricalSaleRevision} = await import('./historical-sale-revision.mjs');
        report.results.historicalSaleRevision = await runHistoricalSaleRevision({query,root,report});
        // Creation is permitted only while every local workflow activation flag
        // is disabled. No production configuration is read or altered here.
        await query(`DO $$ DECLARE col text; BEGIN FOR col IN SELECT attname FROM pg_attribute WHERE attrelid='public.crm_settings'::regclass
            AND attnum>0 AND NOT attisdropped AND (attname LIKE '%_enabled' OR attname='booking_cutover_reviewed') AND atttypid='boolean'::regtype LOOP
            EXECUTE format('UPDATE public.crm_settings SET %I=false WHERE id',col); END LOOP; END $$;`);
        const {runSourceBoundCustomerCreation} = await import('./source-bound-customer-creation.mjs');
        report.results.sourceBoundCustomerCreation = await runSourceBoundCustomerCreation({query,root,report});
        if (importedHistoryProjectionOnly) {
            const { parseHistoricalCustomerEvidenceSnapshot } = require(join(compiled,'historicalCustomerEvidenceContracts.js'));
            const { parseExcelEvidence } = require(join(compiled,'excelReportContracts.js'));
            const { runImportedHistoryProjection } = await import('./imported-history-projection.mjs');
            report.results.importedHistoryProjection = await runImportedHistoryProjection({query,root,report,
                parseHistory:parseHistoricalCustomerEvidenceSnapshot,parseExcel:parseExcelEvidence});
            console.log(JSON.stringify(report.results.importedHistoryProjection));
            if (rentalSourceRetirementOnly) {
                const {runReviewedForecastImport} = await import('./reviewed-forecast-import.mjs');
                report.results.reviewedForecastImport = await runReviewedForecastImport({query,root,report});
                const {runRentalSourceRetirement} = await import('./rental-source-retirement.mjs');
                report.results.rentalSourceRetirement = await runRentalSourceRetirement({query,root,report,parseHistory:parseHistoricalCustomerEvidenceSnapshot,parseExcel:parseExcelEvidence});
                console.log(JSON.stringify(report.results.rentalSourceRetirement));
            }
        } else {
            const {runRemainingImportAtomicity} = await import('./remaining-import-atomicity.mjs');
            report.results.remainingImportAtomicity = await runRemainingImportAtomicity({query,root,report});
            console.log(JSON.stringify({historicalSaleRevision:report.results.historicalSaleRevision,sourceBoundCustomerCreation:report.results.sourceBoundCustomerCreation,remainingImportAtomicity:report.results.remainingImportAtomicity}));
        }
    } else if (canonicalImportAdapterOnly) {
        // Only the prerequisites needed for this composed guard check. Do not rerun unrelated native booking scenarios.
        await query(`INSERT INTO public.crm_settings(id,central_intake_enabled,lead_work_enabled,lead_lifecycle_enabled,booking_enabled,booking_cutover_reviewed,post_booking_enabled)
            VALUES(true,true,true,true,true,true,true) ON CONFLICT(id) DO UPDATE SET central_intake_enabled=true,lead_work_enabled=true,
            lead_lifecycle_enabled=true,booking_enabled=true,booking_cutover_reviewed=true,post_booking_enabled=true;`);
        const compiled = join(directory, 'compiled');
        await command(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--target', 'ES2022', '--module', 'commonjs',
            '--lib', 'ES2022,DOM', '--skipLibCheck', '--strict', '--outDir', compiled, 'lib/sales/postBookingContracts.ts', 'lib/sales/unknownHistoricalEvidence.ts']);
        const require = createRequire(import.meta.url);
        const { parsePostBookingInput, parsePostBookingResult, parsePostBookingSnapshot } = require(join(compiled, 'postBookingContracts.js'));
        const { runPostBookingHistorical } = await import('./post-booking-historical.mjs');
        report.results.canonicalGuardSetup = await runPostBookingHistorical({ query, root, report,
            parseSnapshot: parsePostBookingSnapshot, parseInput: parsePostBookingInput, parseResult: parsePostBookingResult });
        const { runCanonicalImportAdapter } = await import('./canonical-import-adapter.mjs');
        report.results.canonicalImportAdapter = await runCanonicalImportAdapter({ query, root, report });
        const { prepareUnknownHistoricalEvidence } = require(join(compiled, 'unknownHistoricalEvidence.js'));
        const { runUnknownHistoricalEvidence } = await import('./unknown-historical-evidence.mjs');
        report.results.unknownHistoricalEvidence = await runUnknownHistoricalEvidence({ query, root, report, prepare: prepareUnknownHistoricalEvidence });
        const { runImportAdapterAtomicity } = await import('./import-adapter-atomicity.mjs');
        report.results.importAdapterAtomicity = await runImportAdapterAtomicity({ query, root, report });
        console.log(JSON.stringify({ canonicalImportAdapter: report.results.canonicalImportAdapter, unknownHistoricalEvidence: report.results.unknownHistoricalEvidence, importAdapterAtomicity: report.results.importAdapterAtomicity }));
    } else if (postBookingOnly) {
        const output = await query(readFileSync(join(root, 'sql/sales/runtime/scenarios/post-booking.sql'), 'utf8'));
        const line = prefix => {
            const found = output.split(/\r?\n/).find(value => value.startsWith(prefix));
            if (!found) throw new Error('Post-booking scenario receipt missing');
            return JSON.parse(found.slice(prefix.length));
        };
        report.results.postBooking = line('POST_BOOKING_RUNTIME:');
        const compiled = join(directory, 'compiled');
        await command(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--target', 'ES2020', '--module', 'commonjs',
            '--lib', 'ES2022,DOM', '--skipLibCheck', '--strict', '--outDir', compiled, 'lib/sales/postBookingContracts.ts']);
        const require = createRequire(import.meta.url);
        const { parsePostBookingInput, parsePostBookingResult, parsePostBookingSnapshot } = require(join(compiled, 'postBookingContracts.js'));
        const snapshot = line('POST_BOOKING_SNAPSHOT:');
        parsePostBookingSnapshot(snapshot, { saleId: snapshot.sale.id, attemptPage: 0, eventPage: 0 });
        parsePostBookingResult(line('POST_BOOKING_RESULT:'), parsePostBookingInput(line('POST_BOOKING_INPUT:')));
        report.results.postBooking.projectionParity = true;
        const transferSnapshot = line('POST_BOOKING_TRANSFER_SNAPSHOT:');
        parsePostBookingSnapshot(transferSnapshot, { saleId: transferSnapshot.sale.id, attemptPage: 0, eventPage: 0 });
        parsePostBookingResult(line('POST_BOOKING_TRANSFER_RESULT:'), parsePostBookingInput(line('POST_BOOKING_TRANSFER_INPUT:')));
        report.results.postBooking.transferProjectionParity = true;
        const { runPostBookingConcurrency } = await import('./post-booking-concurrency.mjs');
        report.results.postBooking.concurrency = await runPostBookingConcurrency({ query });
        if (rentalOnly) {
            // Native rental verification runs before historical cutover seals the
            // existing booking writer. Never weaken that guard for a fixture.
            const detailsPath = 'sql/sales/22_customer_deal_details_draft.sql';
            const detailsSource = readFileSync(join(root, detailsPath), 'utf8');
            report.sources[detailsPath] = createHash('sha256').update(detailsSource).digest('hex');
            await query(syntheticDraftBody(detailsPath, detailsSource));
            await command(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--target', 'ES2020', '--module', 'commonjs',
                '--lib', 'ES2022,DOM', '--skipLibCheck', '--strict', '--outDir', compiled, 'lib/sales/rentalCommandContracts.ts', 'lib/sales/rentalProjectReadContracts.ts']);
            const rental = require(join(compiled, 'rentalCommandContracts.js'));
            const rentalProject = require(join(compiled, 'rentalProjectReadContracts.js'));
            const { runRentalLifecycle, verifyRentalSealedCutover } = await import('./rental-lifecycle.mjs');
            report.results.rentalLifecycle = await runRentalLifecycle({ query, root, report, parseSnapshot: rental.parseRentalCommandSnapshot,
                parseInput: rental.parseRentalCommandInput, parseResult: rental.parseRentalCommandResult, parseProjectPage: rentalProject.parseRentalProjectPage });
            console.log(JSON.stringify(report.results.rentalLifecycle));
            // Confirm the new setup preflight against the actual historical seal
            // that caused the first composed fixture failure; do not bypass it.
            const { runPostBookingHistorical } = await import('./post-booking-historical.mjs');
            report.results.postBooking.historical = await runPostBookingHistorical({ query, root, report,
                parseSnapshot: parsePostBookingSnapshot, parseInput: parsePostBookingInput, parseResult: parsePostBookingResult });
            report.results.rentalSealedCutover = await verifyRentalSealedCutover({ query, report,
                parseSnapshot: rental.parseRentalCommandSnapshot, parseInput: rental.parseRentalCommandInput });
            console.log(JSON.stringify(report.results.rentalSealedCutover));
        } else {
        if (customerDealDetailsOnly) {
            const { prepareCustomerDealDetailsFixtures } = await import('./customer-deal-details.mjs');
            await prepareCustomerDealDetailsFixtures({ query, root, report });
        }
        const { runPostBookingHistorical } = await import('./post-booking-historical.mjs');
        report.results.postBooking.historical = await runPostBookingHistorical({ query, root, report, parseSnapshot: parsePostBookingSnapshot, parseInput: parsePostBookingInput, parseResult: parsePostBookingResult });
        if (customerDealDetailsOnly) {
            await command(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--target', 'ES2020', '--module', 'commonjs',
                '--lib', 'ES2022,DOM', '--skipLibCheck', '--strict', '--outDir', compiled, 'lib/sales/customerDealEditContracts.ts']);
            const edits = require(join(compiled, 'customerDealEditContracts.js'));
            const { runCustomerDealDetails } = await import('./customer-deal-details.mjs');
            report.results.customerDealDetails = await runCustomerDealDetails({ query, root, report,
                parseSnapshot: edits.parseCustomerDealEditSnapshot, parseInput: edits.parseCustomerDealEditInput, parseResult: edits.parseCustomerDealEditResult });
            console.log(JSON.stringify(report.results.customerDealDetails));
        }
        }
        console.log(JSON.stringify(report.results.postBooking));
    } else {
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
    }
    }
    for (const path of Object.keys(report.sources)) {
        if (createHash('sha256').update(readFileSync(join(root, path))).digest('hex') !== report.sources[path]) throw new Error(`Draft changed during test run: ${path}`);
    }
    report.status = 'passed';
} catch (error) {
    report.status = interrupted ? 'interrupted' : 'failed';
    report.error = error.message;
    report.errorStack = error.stack;
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
