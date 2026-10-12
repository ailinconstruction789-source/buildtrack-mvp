// Read-only live-data verification. Uses the app's public key, stores no rows,
// performs no login/RPC/write, and prints only timing/count/parity metadata.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
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
function compile(relative, require = () => { throw new Error('Unexpected import'); }) {
  const source = readFileSync(new URL(relative, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
  } }).outputText;
  const exports = {};
  new Function('exports', 'require', compiled)(exports, require);
  return exports;
}
const { fetchPaginatedRows } = compile('../lib/fetchPaginatedRows.ts');
const names = compile('../lib/salesNames.ts');
const { buildPlotLeadLookup, orderPlotMatchingLeads } = compile('../lib/plotLeadLookup.ts', () => names);
const leadColumns = 'id, customer_name, phone, project_name, interested_plot_id, interested_plot_name, status, crm_status, booking_date, transferred_date, agent_name, notes';

async function read(table, select, orders, count = false) {
  let requests = 0;
  let total;
  const start = performance.now();
  const rows = await fetchPaginatedRows(async (from, to) => {
    requests++;
    let query = client.from(table).select(select, count && from === 0 ? { count: 'exact' } : undefined);
    for (const [column, ascending] of orders) query = query.order(column, { ascending });
    const response = await query.range(from, to);
    if (response.error) throw new Error(`Read failed for ${table} (${response.error.code})`);
    if (from === 0) total = response.count;
    return response;
  });
  return { rows, meta: { table, rows: rows.length, total: total ?? null, requests,
    jsonBytes: Buffer.byteLength(JSON.stringify(rows)), elapsedMs: Math.round(performance.now() - start) } };
}
function digest(rows) { return createHash('sha256').update(JSON.stringify(rows)).digest('hex'); }
const start = performance.now();
const [leads, plots] = await Promise.all([
  read('leads', '*', [['created_at', false]], true),
  read('plots', '*, house_types(type_name)', [['id', true]], true),
]);
console.log(JSON.stringify({ step: 'shared-sales-base', elapsedMs: Math.round(performance.now() - start),
  datasets: [leads.meta, plots.meta] }));
const [legacyCoreLeads, legacyHubLeads, legacyPlots] = await Promise.all([
  read('leads', leadColumns, [['created_at', false], ['id', true]]),
  read('leads', '*', [['created_at', false]]),
  read('plots', '*, house_types(type_name)', [['id', true]]),
]);
const matchingLeads = orderPlotMatchingLeads(leads.rows);
const coreProjection = matchingLeads.map(row => Object.fromEntries(leadColumns.split(', ').map(key => [key, row[key]])));
const oldLookup = buildPlotLeadLookup(legacyCoreLeads.rows);
const newLookup = buildPlotLeadLookup(matchingLeads);
const matched = plots.rows.filter(plot => oldLookup.findForPlot(plot)?.id === newLookup.findForPlot(plot)?.id).length;
console.log(JSON.stringify({ step: 'live-parity', leadsAvailableToPublicKey: leads.rows.length > 0,
  coreLeadProjectionIdentical: leads.rows.length ? digest(coreProjection) === digest(legacyCoreLeads.rows) : null,
  hubLeadOrderIdentical: leads.rows.length ? leads.rows.every((row, index) => row.id === legacyHubLeads.rows[index]?.id) : null,
  hubLeadContentIdentical: leads.rows.length ? digest([...leads.rows].sort((a, b) => a.id.localeCompare(b.id))) === digest([...legacyHubLeads.rows].sort((a, b) => a.id.localeCompare(b.id))) : null,
  plotContentIdentical: digest(plots.rows) === digest(legacyPlots.rows), matchingPlots: leads.rows.length ? matched : null, totalPlots: plots.rows.length,
  leadsComplete: leads.rows.length ? leads.rows.length === leads.meta.total : null, plotsComplete: plots.rows.length === plots.meta.total }));
if (matched !== plots.rows.length || digest(plots.rows) !== digest(legacyPlots.rows)) throw new Error('Live data changed or parity failed');
