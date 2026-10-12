// Called only by the owned disposable loopback runner. Never opens a connection or reads application env.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { syntheticDraftBody } from './safety.mjs';
export const unknownHistoricalEvidenceDraftPath = 'sql/sales/25_unknown_historical_evidence_draft.sql';
const hash = text => createHash('sha256').update(text).digest('hex');
const q = value => `'${String(value).replaceAll("'", "''")}'`;
const j = value => `${q(JSON.stringify(value))}::jsonb`;
const session = (sql, actor, role = false, app = '') => `BEGIN; ${role ? 'SET LOCAL ROLE authenticated;' : ''}
 SET LOCAL "request.jwt.claim.sub"=${q(actor ?? '')}; ${app ? `SET LOCAL application_name=${q(app)};` : ''} ${sql} COMMIT;`;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function runUnknownHistoricalEvidence({ query, root, report, prepare = value => value }) {
  assert.equal(await query("SELECT current_database() ~ '^buildtrack_sales_runtime_[a-f0-9]+$' AND current_setting('buildtrack.synthetic_runtime',true)='on' AND inet_server_addr()='127.0.0.1'::inet;"), 't');
  const cases = [], check = (ok, label) => { assert.ok(ok, label); cases.push(label); };
  const deny = async (label, sql, pattern = /UNKNOWN_HISTORY_|permission denied|duplicate key|invalid input|out of range/) => {
    await assert.rejects(query(sql), pattern); cases.push(label);
  };
  report.sources ??= {};
  for (const file of [unknownHistoricalEvidenceDraftPath, 'lib/sales/unknownHistoricalEvidence.ts', 'scripts/sales-runtime/unknown-historical-evidence.mjs']) {
    const source = readFileSync(join(root, file), 'utf8'); report.sources[file] = hash(source);
    if (file === unknownHistoricalEvidenceDraftPath) await query(syntheticDraftBody(file, source));
  }
  const admin = randomUUID(), sales = randomUUID();
  await query(`INSERT INTO auth.users(id) VALUES(${q(admin)}),(${q(sales)});
    INSERT INTO sales_private.crm_user_roles(user_id,role,is_active) VALUES(${q(admin)},'admin',true),(${q(sales)},'sales',true);`);
  const customers = JSON.parse(await query(`SELECT jsonb_agg(to_jsonb(selected)) FROM (
    SELECT c.id,(SELECT i.id FROM public.lead_project_interests i WHERE i.customer_id=c.id ORDER BY i.id LIMIT 1) AS interest_id
    FROM public.sales_customers c WHERE c.merged_into_customer_id IS NULL ORDER BY c.id LIMIT 2) selected;`));
  assert.ok(admin && sales && customers?.length === 2, 'canonical fixtures require active Admin/Sales and two unmerged Customers');
  const business = () => query(`SELECT jsonb_build_object(
    'customers',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.sales_customers c),
    'interests',(SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM public.lead_project_interests i),
    'sales',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.sales s),
    'plots',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.plots p),
    'leads',(SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM public.leads l),
    'visits',(SELECT jsonb_agg(to_jsonb(v) ORDER BY id) FROM public.lead_visits v),
    'audit',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.crm_audit_events a));`);
  const before = await business();
  const visits = [237,238,239,249,250,256,257,263,274,275].map((rowNumber, index) => ({
    sourceKey: hash(`SYNTHETIC unknown source ${rowNumber}`), rowNumber, rowSha256: hash(`SYNTHETIC row ${rowNumber}`),
    customerKey: 'SYNTHETIC source customer visits', customerId: customers[0].id, interestId: null, saleId: null,
    reason: 'unknown_project', sourceStage: 'visited', events: [{eventKey:'visit-1',kind:'visited',sequence:1,
      date:index===0?null:'2023-09-18',precision:index===0?'unknown':'day',evidenceRef:'SYNTHETIC source visit evidence'}],
  }));
  const cancelled = { sourceKey: hash('SYNTHETIC unknown sale 171'), rowNumber: 171, rowSha256: hash('SYNTHETIC row 171'),
    customerKey: 'SYNTHETIC source customer cancelled', customerId: customers[1].id, interestId: customers[1].interest_id, saleId: null,
    reason: 'unknown_booking', sourceStage: 'cancelled', events: [
      {eventKey:'visit-1',kind:'visited',sequence:1,date:'2023-03-14',precision:'day',evidenceRef:'SYNTHETIC visit day'},
      {eventKey:'book-1',kind:'booked',sequence:2,date:null,precision:'unknown',evidenceRef:'SYNTHETIC unknown booking day'},
      {eventKey:'cancel-1',kind:'cancelled',sequence:3,date:'2024-07-25',precision:'day',evidenceRef:'SYNTHETIC cancelled source day'},
    ] };
  const payload = {version:'unknown-historical-evidence-v1',sourceSystem:'SYNTHETIC UNKNOWN HISTORY',datasetKey:'resolution-gaps',
    snapshotSha256:hash('SYNTHETIC snapshot'),mappingReviewRef:'SYNTHETIC independently reviewed existing UUIDs',records:[cancelled,...visits],
    businessWritesAllowed:false,leadRequired:false};
  const persist = value => `SELECT sales_unknown_history_private.persist_evidence(${j(value)});`;
  await deny('anonymous invocation is refused', session(persist(payload), null));
  await deny('active Sales cannot archive historical gaps', session(persist(payload), sales));
  await deny('authenticated browser has no archive RPC permission', session(persist(payload), admin, true), /permission denied/);
  const mutations = [
    ['invented Sale', p => { p.records[0].saleId = randomUUID(); }],
    ['invented unknown project Interest', p => { p.records[1].interestId = randomUUID(); }],
    ['unknown source hash', p => { p.records[1].sourceKey = 'fake'; }],
    ['wrong cancelled source stage', p => { p.records[0].sourceStage = 'visited'; }],
    ['missing cancelled evidence', p => { p.records[0].events.pop(); }],
    ['null day with known precision', p => { p.records[0].events[1].precision = 'day'; }],
    ['backwards source history', p => { p.records[0].events[2].date = '2023-01-01'; }],
    ['calendar-invalid source day', p => { p.records[1].events[0].date = '2023-02-29'; p.records[1].events[0].precision = 'day'; }],
    ['late nonexistent Customer binding', p => { p.records.at(-1).customerId = randomUUID(); }],
    ['source customer remapping within a batch', p => { p.records.at(-1).customerId = customers[1].id; }],
    ['extra caller business field', p => { p.records[0].plotId = 'invented'; }],
  ];
  for (const [label, mutate] of mutations) {
    const changed = structuredClone(payload); mutate(changed);
    await deny(label, session(persist(changed), admin));
    check(await query('SELECT count(*) FROM sales_unknown_history_private.batches;') === '0', `${label} leaves no partial batch`);
  }
  const candidate = prepare(payload), saved = JSON.parse(await query(session(persist(candidate), admin)));
  check(saved.records === 11 && saved.events === 13 && !saved.replayed && !saved.businessChanged, 'ten unknown project visits and cancelled unknown Sale history persist without business writes');
  const values = JSON.parse(await query(`SELECT jsonb_build_object(
    'unknownInterests',(SELECT count(*) FROM sales_unknown_history_private.records WHERE reason='unknown_project' AND interest_id IS NULL),
    'unknownSales',(SELECT count(*) FROM sales_unknown_history_private.records WHERE sale_id IS NULL),
    'unknownDays',(SELECT count(*) FROM sales_unknown_history_private.events WHERE occurred_date IS NULL AND precision='unknown'));`));
  check(values.unknownInterests === 10 && values.unknownSales === 11 && values.unknownDays === 2, 'unknown bindings and source-day precision remain explicitly null');
  const replay = JSON.parse(await query(session(persist(candidate), admin)));
  check(replay.replayed && replay.batchId === saved.batchId, 'exact retry returns the sealed batch');
  const changed = structuredClone(candidate); changed.records[0].events[0].evidenceRef = 'SYNTHETIC changed evidence';
  await deny('changed source cannot replace pinned evidence', session(persist(changed), admin), /UNKNOWN_HISTORY_RECONCILIATION_REQUIRED/);
  const renamed = structuredClone(candidate); renamed.datasetKey = 'renamed-dataset';
  await deny('dataset rename cannot duplicate sealed source keys', session(persist(renamed), admin), /duplicate key/);
  for (const table of ['batches','records','events']) for (const command of [
    `UPDATE sales_unknown_history_private.${table} SET ${table==='batches'?'mapping_review_ref=mapping_review_ref':table==='records'?'source_key=source_key':'event_key=event_key'}`,
    `DELETE FROM sales_unknown_history_private.${table}`, `TRUNCATE sales_unknown_history_private.${table} CASCADE`,
  ]) await deny(`sealed ${table} rejects ${command.split(' ')[0]}`, command+';', /UNKNOWN_HISTORY_APPEND_ONLY/);
  await deny('browser cannot read private source payload', session('SELECT * FROM sales_unknown_history_private.records;', admin, true), /permission denied/);
  check(await query("SELECT count(*) FROM pg_class WHERE relnamespace='sales_unknown_history_private'::regnamespace AND relkind='r' AND relrowsecurity;") === '4', 'RLS covers every archive relation and exact insert permits');
  check(await query("SELECT count(*) FROM pg_proc WHERE pronamespace='sales_unknown_history_private'::regnamespace AND prosecdef;") === '0', 'all archive functions are private SECURITY INVOKER');
  const concurrent = structuredClone(candidate); concurrent.datasetKey = 'concurrent'; concurrent.sourceSystem = 'SYNTHETIC UNKNOWN CONCURRENT';
  const receipts = await Promise.all([query(session(persist(concurrent), admin)), query(session(persist(concurrent), admin))]);
  check(receipts.map(JSON.parse).filter(row => row.replayed).length === 1, 'concurrent identical archives commit exactly once');
  // Revoke only this module's synthetic Admin. Even an exact retry must wait and recheck rights.
  const app = 'SYNTHETIC-unknown-history-'+randomUUID();
  const blocker = query(`BEGIN; UPDATE sales_private.crm_user_roles SET is_active=false WHERE user_id=${q(admin)}; SELECT pg_sleep(1.5); COMMIT;`);
  for (let n=0;n<40;n++) { if (await query("SELECT count(*) FROM pg_stat_activity WHERE query LIKE '%pg_sleep(1.5)%' AND pid<>pg_backend_pid() AND wait_event='PgSleep';") !== '0') break; await delay(25); }
  const waiting = query(session(persist(candidate), admin, false, app)).then(value => ({ value }), error => ({ error })); let observed = false;
  for (let n=0;n<40;n++) { if (await query(`SELECT count(*) FROM pg_stat_activity WHERE application_name=${q(app)} AND wait_event_type='Lock';`) === '1') { observed=true; break; } await delay(25); }
  await blocker; const blocked = await waiting; check(observed, 'archive retry waits on the trusted Admin rights row');
  check(blocked.error && /UNKNOWN_HISTORY_FORBIDDEN/.test(blocked.error.message), 'Admin revoked during the lock wait cannot replay or commit');
  await query(`UPDATE sales_private.crm_user_roles SET is_active=true WHERE user_id=${q(admin)};`);
  await query(`GRANT USAGE ON SCHEMA sales_unknown_history_private TO authenticated;
    GRANT ALL ON ALL TABLES IN SCHEMA sales_unknown_history_private TO authenticated;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA sales_unknown_history_private TO authenticated;`);
  await deny('broad browser grants cannot invoke the private owner/Admin importer', session(persist(candidate), admin, true), /UNKNOWN_HISTORY_FORBIDDEN/);
  await deny('broad grants cannot append forged archive batches', session(`INSERT INTO sales_unknown_history_private.batches
    (source_system,dataset_key,snapshot_sha256,mapping_review_ref,payload,reviewer_id)
    VALUES('SYNTHETIC FORGED','forged',${q(hash('forged'))},'SYNTHETIC FORGED','{}',${q(admin)});`, admin, true), /UNKNOWN_HISTORY_|row-level security/);
  await deny('broad grants cannot forge exact insert capabilities', session(`INSERT INTO sales_unknown_history_private.insert_permits
    VALUES(txid_current(),pg_backend_pid(),${q(admin)},'batches','{}');`, admin, true), /UNKNOWN_HISTORY_|row-level security/);
  for (const table of ['batches','records','events']) await deny(`broad grants cannot truncate ${table}`, session(`TRUNCATE sales_unknown_history_private.${table} CASCADE;`, admin, true), /UNKNOWN_HISTORY_APPEND_ONLY|permission denied/);
  await query(`REVOKE ALL ON SCHEMA sales_unknown_history_private FROM PUBLIC,anon,authenticated;
    REVOKE ALL ON ALL TABLES IN SCHEMA sales_unknown_history_private FROM PUBLIC,anon,authenticated;
    REVOKE ALL ON ALL FUNCTIONS IN SCHEMA sales_unknown_history_private FROM PUBLIC,anon,authenticated;`);
  check(await query('SELECT count(*) FROM sales_unknown_history_private.insert_permits;') === '0', 'no insertion capability survives archive commit');
  check(await business() === before, 'all archive commits and failures leave canonical Customers/Interests/Sales/plots/Leads/visits/audit unchanged');
  return { assertions: cases.length, cases, syntheticOnly: true, durableUnknownEvidenceOnly: true, businessChanged: false,
    archivedRows: 11, unknownProjectVisits: 10, unknownBookingHistories: 1, concurrencyGroups: 2 };
}
