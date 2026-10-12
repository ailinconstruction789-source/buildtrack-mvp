// Offline preparation only. No Supabase client, environment configuration, network or database commands.
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, statSync, realpathSync, readFileSync, mkdirSync, mkdtempSync, writeFileSync, openSync, closeSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve, relative, isAbsolute, join, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const repositoryRoot = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '../..'));
const maxBytes = 8 * 1024 * 1024;
const fail = code => { throw new Error(code); };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const normalized = path => process.platform === 'win32' ? path.toLowerCase() : path;
function inside(root, target) {
  const rel = relative(root, target);
  return rel !== '' && !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`);
}
function contained(path) {
  const target = resolve(repositoryRoot, path);
  if (!inside(repositoryRoot, target)) fail('PATH_OUTSIDE_REPOSITORY');
  const segments = relative(repositoryRoot, target).split(/[\\/]/);
  if (segments.some(part => part.includes(':') || ['.git', '.agents', '.codex'].includes(part.toLowerCase()))) fail('PATH_FORBIDDEN');
  let existing = target;
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) fail('PATH_PARENT_MISSING');
    existing = parent;
  }
  const actual = realpathSync(existing);
  if (normalized(actual) !== normalized(repositoryRoot) && !inside(repositoryRoot, actual)) fail('PATH_LINK_OUTSIDE_REPOSITORY');
  return target;
}
export function parseArguments(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    if (!['--input', '--output', '--prior'].includes(flag) || Object.hasOwn(parsed, flag.slice(2))
      || typeof args[index + 1] !== 'string' || !args[index + 1] || args[index + 1].startsWith('--')) fail('ARGUMENTS_INVALID');
    parsed[flag.slice(2)] = args[index + 1];
  }
  if (!parsed.input || !parsed.output) fail('EXPLICIT_INPUT_AND_OUTPUT_REQUIRED');
  return parsed;
}
export function resolvePreparationPaths(options) {
  if (!options || typeof options.input !== 'string' || typeof options.output !== 'string'
    || Object.keys(options).some(key => !['input', 'output', 'prior'].includes(key))) fail('ARGUMENTS_INVALID');
  const input = contained(options.input), output = contained(options.output), prior = options.prior === undefined ? null : contained(options.prior);
  if ([input, output, ...(prior ? [prior] : [])].some(path => extname(path).toLowerCase() !== '.json')) fail('JSON_PATH_REQUIRED');
  if (!existsSync(input) || !statSync(input).isFile()) fail('INPUT_FILE_REQUIRED');
  if (normalized(input) === normalized(output)
    || (existsSync(output) && normalized(realpathSync(input)) === normalized(realpathSync(output)))) fail('INPUT_OUTPUT_MUST_DIFFER');
  if (prior && normalized(prior) === normalized(output)) fail('PRIOR_OUTPUT_MUST_DIFFER');
  if (prior && (!existsSync(prior) || !statSync(prior).isFile())) fail('PRIOR_FILE_REQUIRED');
  if (!existsSync(dirname(output)) || !statSync(dirname(output)).isDirectory()) fail('OUTPUT_PARENT_REQUIRED');
  if (existsSync(output)) fail('OUTPUT_ALREADY_EXISTS');
  return { input, output, prior };
}
function readJson(path) {
  if (statSync(path).size > maxBytes) fail('INPUT_TOO_LARGE');
  const bytes = readFileSync(path);
  if (bytes.length > maxBytes) fail('INPUT_TOO_LARGE');
  try { return { bytes, value: JSON.parse(bytes.toString('utf8')) }; }
  catch { return fail('INPUT_JSON_INVALID'); }
}
function compileModule() {
  const compiler = contained('node_modules/typescript/bin/tsc');
  if (!existsSync(compiler) || !statSync(compiler).isFile()) fail('INSTALLED_TYPESCRIPT_REQUIRED');
  const cache = contained('node_modules/.cache/buildtrack-history-prepare/runs');
  mkdirSync(cache, { recursive: true });
  if (!inside(repositoryRoot, realpathSync(cache))) fail('CACHE_OUTSIDE_REPOSITORY');
  const directory = realpathSync(mkdtempSync(join(cache, 'prepare-')));
  writeFileSync(join(directory, 'compile-owner.json'), `${JSON.stringify({ owner: 'buildtrack-history-prepare', id: randomUUID() })}\n`, { flag: 'wx', mode: 0o600 });
  const output = join(directory, 'compiled');
  const result = spawnSync(process.execPath, [compiler, '--target', 'ES2022', '--module', 'commonjs', '--moduleResolution', 'node',
    '--lib', 'ES2022,DOM', '--strict', '--skipLibCheck', '--outDir', output, 'lib/sales/historicalTimelineImport.ts', 'lib/sales/historicalTimelineLedger.ts'],
  { cwd: repositoryRoot, shell: false, env: {}, timeout: 60000, maxBuffer: 2 * 1024 * 1024, windowsHide: true });
  if (result.error || result.status !== 0) fail('OFFLINE_MODULE_COMPILE_FAILED');
  const entry = realpathSync(join(output, 'historicalTimelineImport.js'));
  if (!inside(directory, entry)) fail('COMPILED_MODULE_OUTSIDE_OWNED_CACHE');
  const required = createRequire(import.meta.url)(entry);
  if (typeof required.prepareHistoricalTimelineImport !== 'function') fail('OFFLINE_MODULE_EXPORT_MISSING');
  const ledgerEntry = realpathSync(join(output, 'historicalTimelineLedger.js'));
  if (!inside(directory, ledgerEntry)) fail('COMPILED_MODULE_OUTSIDE_OWNED_CACHE');
  const ledger = createRequire(import.meta.url)(ledgerEntry);
  if (typeof ledger.prepareHistoricalLedgerInput !== 'function') fail('OFFLINE_MODULE_EXPORT_MISSING');
  return { prepare: required.prepareHistoricalTimelineImport, ledger: ledger.prepareHistoricalLedgerInput };
}
export function prepareHistoryFile(options) {
  const paths = resolvePreparationPaths(options);
  const input = readJson(paths.input), prior = paths.prior ? readJson(paths.prior).value : null;
  if (paths.prior && (!prior || typeof prior !== 'object' || Array.isArray(prior)
    || prior.version !== 'historical-timeline-preparation-report-v1' || prior.writesAllowed !== false
    || !prior.preparedPlan || typeof prior.inputBytesSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(prior.inputBytesSha256))) fail('PRIOR_REPORT_INVALID');
  const { prepare, ledger } = compileModule();
  const plan = prepare(input.value, prior?.preparedPlan);
  const holds = {};
  for (const row of plan.rows) for (const code of row.holds) holds[code] = (holds[code] ?? 0) + 1;
  let evidenceLedgerCandidate = null, evidenceLedgerHold = null;
  try { evidenceLedgerCandidate = ledger(input.value); }
  catch (error) {
    const code = error instanceof Error ? error.message : '';
    if (!['HISTORICAL_LEDGER_REVIEW_REQUIRED', 'HISTORICAL_LEDGER_TOO_LARGE'].includes(code)) throw error;
    evidenceLedgerHold = code;
  }
  const report = {
    version: 'historical-timeline-preparation-report-v1', inputBytesSha256: hash(input.bytes), inputByteCount: input.bytes.length,
    declaredSourceSnapshotSha256: plan.manifest.snapshotSha256,
    sourceVerification: 'Input bytes measured; upstream snapshot digest, identity mappings and evidence references are declarations requiring independent review.',
    counts: { sourceRecords: plan.rows.length, rowsHeldForReview: plan.rows.filter(row => row.holds.length).length,
      mappedRows: plan.rows.filter(row => row.binding !== null).length, protectedFromLost: plan.rows.filter(row => row.protectedFromLost).length,
      events: plan.rows.reduce((total, row) => total + row.source.events.length, 0),
      knownDayEvents: plan.rows.reduce((total, row) => total + row.source.events.filter(event => event.precision === 'day').length, 0),
      unknownDateEvents: plan.rows.reduce((total, row) => total + row.source.events.filter(event => event.precision === 'unknown').length, 0) },
    holdCounts: holds, preparedPlan: plan, evidenceLedgerCandidate, evidenceLedgerHold,
    writesAllowed: false, importReady: false, productionChanged: false,
    limits: ['Offline preparation only. Optional evidence ledger payload is not database write authorization or CRM entity import.',
      'Source Customer/Interest/Sale/Rental IDs and evidence are not verified against database records.',
      'No Lead IDs are fabricated, no statuses replayed and no Lost updates executed.',
      'Report contains source references and mapped IDs; handle locally as customer data.',
      'Existing output is never overwritten. Files and owned compilation cache are never deleted.'],
  };
  // Exclusive create protects the input and any pre-existing report, including a concurrent creator.
  let descriptor;
  try { descriptor = openSync(paths.output, 'wx', 0o600); }
  catch { return fail('OUTPUT_EXCLUSIVE_CREATE_FAILED'); }
  try { writeFileSync(descriptor, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8' }); }
  catch { return fail('OUTPUT_WRITE_FAILED_PARTIAL_FILE_RETAINED'); }
  finally { closeSync(descriptor); }
  return { version: report.version, inputBytesSha256: report.inputBytesSha256, inputByteCount: report.inputByteCount,
    counts: report.counts, holdCounts: report.holdCounts, writesAllowed: false, importReady: false, productionChanged: false };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { console.log(JSON.stringify(prepareHistoryFile(parseArguments(process.argv.slice(2))), null, 2)); }
  catch (error) { console.error(error instanceof Error ? error.message : 'HISTORICAL_PREPARATION_FAILED'); process.exitCode = 1; }
}
