// Read-only verification: public app key, no login, writes, fixtures or saved rows.
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import ts from 'typescript';

const envText = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
function env(name) {
  const value = process.env[name] || envText.match(new RegExp(`^${name}=(.*)$`, 'm'))?.[1];
  if (!value) throw new Error(`Missing ${name}`);
  return value.trim().replace(/^['"]|['"]$/g, '');
}
const client = createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('NEXT_PUBLIC_SUPABASE_ANON_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(15000) }) },
});
const source = readFileSync(new URL('../lib/fetchPaginatedRows.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const helper = {};
new Function('exports', compiled)(helper);

function reader(table, columns, stats, verifyTotal = false) {
  return async (from, to, requestCount) => {
    stats.requests++;
    stats.active++;
    stats.maximumActive = Math.max(stats.maximumActive, stats.active);
    try {
      let query = client.from(table).select('*', requestCount || (verifyTotal && from === 0)
        ? { count: 'exact' } : undefined);
      for (const column of columns) query = query.order(column, { ascending: true });
      const { data, count, error } = await query.range(from, to);
      if (error) throw new Error(`Read failed for ${table} (code ${error.code})`);
      if (from === 0 && count !== null) stats.total = count;
      return { data, count };
    } finally {
      stats.active--;
    }
  };
}

async function measureAssignments(concurrency, round) {
  const stats = { requests: 0, active: 0, maximumActive: 0, total: null };
  const start = performance.now();
  const rows = await helper.fetchPaginatedRows(reader('plot_task_assignments', ['id'], stats), { concurrency });
  const elapsedMs = +(performance.now() - start).toFixed(1);
  const serialized = JSON.stringify(rows);
  const digest = createHash('sha256').update(serialized).digest('hex');
  console.log(JSON.stringify({ dataset: 'assignments', mode: concurrency === 1 ? 'sequential' : 'bounded-parallel',
    round, rows: rows.length, requests: stats.requests, maximumActive: stats.maximumActive, elapsedMs,
    jsonBytes: Buffer.byteLength(serialized), complete: stats.total === null ? null : stats.total === rows.length }));
  return { digest, rows: rows.length };
}

async function verifyQc() {
  const stats = { requests: 0, active: 0, maximumActive: 0, total: null };
  const columns = ['date', 'role', 'action', 'day_of_week', 'day_of_month', 'hour_of_day'];
  const rows = await helper.fetchPaginatedRows(reader('vw_qc_se_performance', columns, stats, true));
  const complete = rows.length === stats.total;
  const uniqueGroups = new Set(rows.map(row => JSON.stringify(columns.map(column => row[column])))).size;
  console.log(JSON.stringify({ dataset: 'QC', rows: rows.length, total: stats.total,
    requests: stats.requests, complete, uniqueGroups, actionCount: rows.reduce((sum, row) => sum + Number(row.action_count), 0) }));
  if (!complete || uniqueGroups !== rows.length) throw new Error('QC completeness verification failed');
}

await verifyQc();
if (process.argv.includes('--compare')) {
  // Reverse the second round to reduce the effect of warming connections/caches.
  for (const [round, modes] of [[1, [1, 3]], [2, [3, 1]]]) {
    const results = [];
    for (const concurrency of modes) results.push(await measureAssignments(concurrency, round));
    const identical = results[0].digest === results[1].digest;
    console.log(JSON.stringify({ round, identicalAssignmentData: identical }));
    if (!identical) throw new Error('Live rows changed between reads; repeat comparison when stable');
  }
}
