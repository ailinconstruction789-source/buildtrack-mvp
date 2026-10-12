// Owned-loopback review staging only. Real source dates/hashes are allowed,
// customer names/phones and canonical entity writes are not.
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { workspacePath } from '../sales-import/review-workbook.mjs';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const digest = value => hash(JSON.stringify(value));
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value !== null && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
    : JSON.stringify(value);
const day = value => typeof value === 'string' && /^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
const q = value => `'${String(value).replaceAll("'", "''")}'`;
export function validateReviewPlan(plan) {
  const { planDigest, ...body } = plan ?? {};
  if (plan?.version !== 'customer-workbook-review-plan-v1' || digest(body) !== planDigest
    || Object.keys(plan).some(key => !['version','sourceSha256','catalogDigest','catalogGeneratedAt','inspectionDate','layout','counts',
      'issues','identityGroups','projectProposals','ownerProposals','rows','importReady','businessWritesAllowed','lostChangesAllowed',
      'customerNamesIncluded','phoneValuesIncluded','bindingsVerified','planDigest'].includes(key))
    || !day(plan.inspectionDate)
    || plan.importReady !== false || plan.businessWritesAllowed !== false || plan.lostChangesAllowed !== false
    || plan.customerNamesIncluded !== false || plan.phoneValuesIncluded !== false || plan.bindingsVerified !== false
    || !/^[a-f0-9]{64}$/.test(plan.sourceSha256) || !/^[a-f0-9]{64}$/.test(plan.catalogDigest)
    || !Array.isArray(plan.rows) || !plan.rows.length || plan.rows.length > 49999
    || plan.counts.sourceRecords !== plan.rows.length || plan.counts.heldRows !== plan.rows.length
    || plan.counts.canonicalImportRows !== 0 || plan.counts.confirmedCustomerBindings !== 0
    || plan.rows.some(row => !Number.isSafeInteger(row.sourceRow) || row.sourceRow < 2 || row.sourceRow > 50000
      || !/^[a-f0-9]{64}$/.test(row.rowSha256) || !/^[a-f0-9]{64}$/.test(row.sourceKey)
      || !['visited', 'booked', 'transferred', 'cancelled', 'unclassified'].includes(row.sourceStage)
      || !Array.isArray(row.sourceEvents) || !Array.isArray(row.holds) || !row.holds.length
      || row.sourceEvents.some(event => !event || Object.keys(event).length !== 3
        || Object.keys(event).some(key => !['kind','date','precision'].includes(key))
        || !['visited','booked','transferred','cancelled'].includes(event.kind)
        || (event.date === null ? event.precision !== 'unknown' : !day(event.date) || event.date > plan.inspectionDate || event.precision !== 'day'))
      || row.canonicalWritesAllowed !== false || row.leadRequired !== false
      || ['customerId', 'interestId', 'saleId', 'rentalId', 'ownerUserId'].some(key => row[key] !== null)
      || Object.keys(row).some(key => !['sourceRow', 'sourceKey', 'rowSha256', 'sourceStage', 'sourceEvents', 'expectedTransferDate',
        'salePrice', 'candidatePlotIds', 'customerId', 'interestId', 'saleId', 'rentalId', 'ownerUserId', 'holds', 'canonicalWritesAllowed', 'leadRequired'].includes(key)))
    || new Set(plan.rows.map(row => row.sourceRow)).size !== plan.rows.length
    || new Set(plan.rows.map(row => row.sourceKey)).size !== plan.rows.length
    || plan.counts.sourceEvents !== plan.rows.reduce((sum, row) => sum + row.sourceEvents.length, 0)) throw new Error('REVIEW_PLAN_INVALID');
  return plan;
}

export async function runWorkbookReview({ query, root, report, planPath }) {
  const path = workspacePath(planPath);
  if (statSync(path).size > 8 * 1024 * 1024) throw new Error('REVIEW_PLAN_TOO_LARGE');
  const bytes = readFileSync(path), plan = validateReviewPlan(JSON.parse(bytes.toString('utf8')));
  report.sources[planPath] = hash(bytes);
  report.sources['scripts/sales-runtime/workbook-review.mjs'] = hash(readFileSync(`${root}/scripts/sales-runtime/workbook-review.mjs`));
  const cases = [], check = (value, label) => { if (!value) throw new Error(`WORKBOOK_REVIEW_CHECK_FAILED: ${label}`); cases.push(label); };
  const deny = async (sql, label) => {
    let failed = false;
    try { await query(sql); } catch { failed = true; }
    check(failed, label);
  };
  const business = () => query(`SELECT jsonb_build_object('projects',(SELECT count(*) FROM public.projects),
    'plots',(SELECT count(*) FROM public.plots),'leads',(SELECT count(*) FROM public.leads),'sales',(SELECT count(*) FROM public.sales));`);
  const before = await business();
  await query(`DO $owned$ BEGIN
    IF current_database() !~ '^buildtrack_sales_runtime_[a-f0-9]+$'
      OR current_setting('buildtrack.synthetic_runtime',true) IS DISTINCT FROM 'on'
      OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet THEN RAISE EXCEPTION 'OWNED REVIEW TEST ONLY'; END IF;
    END $owned$;
    CREATE SCHEMA workbook_review_test; REVOKE ALL ON SCHEMA workbook_review_test FROM PUBLIC,anon,authenticated;
    CREATE TABLE workbook_review_test.batches(id text PRIMARY KEY,source_hash text UNIQUE NOT NULL,catalog_hash text NOT NULL,
      payload jsonb NOT NULL,CHECK(payload->>'businessWritesAllowed'='false'),CHECK(payload->>'importReady'='false'));
    CREATE TABLE workbook_review_test.rows(batch text NOT NULL REFERENCES workbook_review_test.batches(id),
      source_row integer NOT NULL CHECK(source_row BETWEEN 2 AND 50000),row_hash text NOT NULL CHECK(row_hash~'^[a-f0-9]{64}$'),
      payload jsonb NOT NULL,PRIMARY KEY(batch,source_row),CHECK(jsonb_array_length(payload->'holds')>0),
      CHECK(payload->>'canonicalWritesAllowed'='false'),CHECK(payload->'customerId'='null'::jsonb),
      CHECK(payload->'interestId'='null'::jsonb),CHECK(payload->'saleId'='null'::jsonb),CHECK(payload->'rentalId'='null'::jsonb));
    CREATE TABLE workbook_review_test.events(batch text NOT NULL,source_row integer NOT NULL,sequence integer NOT NULL CHECK(sequence>0),
      kind text NOT NULL CHECK(kind IN ('visited','booked','transferred','cancelled')),occurred_date date,precision text NOT NULL,
      PRIMARY KEY(batch,source_row,sequence),FOREIGN KEY(batch,source_row) REFERENCES workbook_review_test.rows(batch,source_row),
      CHECK((precision='unknown' AND occurred_date IS NULL) OR (precision='day' AND occurred_date IS NOT NULL)));
    ALTER TABLE workbook_review_test.batches ENABLE ROW LEVEL SECURITY;
    ALTER TABLE workbook_review_test.rows ENABLE ROW LEVEL SECURITY;
    ALTER TABLE workbook_review_test.events ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON ALL TABLES IN SCHEMA workbook_review_test FROM PUBLIC,anon,authenticated;`);
  const persist = p => `BEGIN;
    INSERT INTO workbook_review_test.batches VALUES(${q(p.planDigest)},${q(p.sourceSha256)},${q(p.catalogDigest)},${q(JSON.stringify(p))}::jsonb);
    INSERT INTO workbook_review_test.rows SELECT ${q(p.planDigest)},(r->>'sourceRow')::integer,r->>'rowSha256',r
      FROM jsonb_array_elements(${q(JSON.stringify(p.rows))}::jsonb) r;
    INSERT INTO workbook_review_test.events SELECT ${q(p.planDigest)},(r->>'sourceRow')::integer,n::integer,e->>'kind',
      (e->>'date')::date,e->>'precision' FROM jsonb_array_elements(${q(JSON.stringify(p.rows))}::jsonb) r,
      LATERAL jsonb_array_elements(r->'sourceEvents') WITH ORDINALITY AS event(e,n); COMMIT;`;
  const invalid = structuredClone(plan); invalid.rows.at(-1).sourceEvents.at(-1).precision = 'unexpected';
  await deny(persist(invalid), 'last event failure rejects whole review transaction');
  check(await query('SELECT count(*) FROM workbook_review_test.batches;') === '0', 'failed stage has no batch');
  check(await query('SELECT count(*) FROM workbook_review_test.rows;') === '0', 'failed stage has no partial rows');
  await query(persist(plan));
  const actual = JSON.parse(await query(`SELECT jsonb_build_object('rows',(SELECT count(*) FROM workbook_review_test.rows),
    'events',(SELECT count(*) FROM workbook_review_test.events),
    'unknown',(SELECT count(*) FROM workbook_review_test.events WHERE occurred_date IS NULL),
    'dates',(SELECT coalesce(jsonb_agg(jsonb_build_object('row',source_row,'sequence',sequence,'kind',kind,'date',occurred_date,'precision',precision)
      ORDER BY source_row,sequence),'[]'::jsonb) FROM workbook_review_test.events),
    'payloads',(SELECT jsonb_agg(payload ORDER BY source_row) FROM workbook_review_test.rows));`));
  check(actual.rows === plan.rows.length, 'all source rows staged exactly once');
  check(actual.events === plan.counts.sourceEvents, 'all declared source events staged');
  check(actual.unknown === plan.rows.flatMap(row => row.sourceEvents).filter(e => e.date === null).length, 'unknown days remain null');
  check(canonical(actual.payloads) === canonical([...plan.rows].sort((a,b) => a.sourceRow-b.sourceRow)), 'row payload parity');
  const expectedEvents = [...plan.rows].sort((a,b) => a.sourceRow-b.sourceRow).flatMap(row => row.sourceEvents.map((event,index) =>
    ({ row: row.sourceRow, sequence: index+1, kind: event.kind, date: event.date, precision: event.precision })));
  check(actual.dates.length === expectedEvents.length && actual.dates.every((e,i) => Object.entries(expectedEvents[i]).every(([k,v]) => e[k] === v)),
    'every source date, kind, sequence and precision matches PostgreSQL');
  await deny(persist(plan), 'duplicate plan cannot create second batch or rows');
  check(await query('SELECT count(*) FROM workbook_review_test.rows;') === String(plan.rows.length), 'retry preserves original row count');
  for (const role of ['anon','authenticated']) for (const table of ['batches','rows','events'])
    await deny(`BEGIN; SET LOCAL ROLE ${role}; SELECT * FROM workbook_review_test.${table}; ROLLBACK;`, `${role} cannot access ${table}`);
  check(await query("SELECT bool_and(relrowsecurity) FROM pg_class WHERE relnamespace='workbook_review_test'::regnamespace AND relkind='r';") === 't',
    'all review tables use RLS');
  check(before === await business(), 'business facade remains unchanged; no Lead or booking replay');
  check(readFileSync(path).equals(bytes), 'pinned plan unchanged during local staging');
  return { assertions: cases.length, cases, sourceSha256: plan.sourceSha256, planDigest: plan.planDigest,
    sourceRows: actual.rows, sourceEvents: actual.events, unknownEventDays: actual.unknown,
    realWorkbookDerivedRedactedReview: true, syntheticBusinessFacade: true, canonicalCustomerImports: 0,
    businessWrites: false, liveDatabaseWrites: false, allRowsHeldForMapping: true };
}
