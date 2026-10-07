// Native synthetic tests only, supplied with the owned-loopback runner adapter.
// No production adapter or real customer payload is accepted by this suite.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { assertPlainSql } from './safety.mjs';
import { syntheticExternalSnapshot } from './external-snapshot-fixture.mjs';
import { assertSameSheetSnapshotPlan } from './sheet-snapshot-plan.mjs';

export const externalSnapshotDraftPath = 'sql/sales/external_snapshot_staging_draft.sql';
export function externalSnapshotTestBody(source) {
    assertPlainSql(source);
    const guard = /\bBEGIN;\s*DO \$draft_only\$\s*BEGIN\s*RAISE EXCEPTION 'DESIGN ONLY: external snapshot staging requires isolated tests and separate deployment review';\s*END;\s*\$draft_only\$;/g;
    if ([...source.matchAll(guard)].length !== 1 || !/\bROLLBACK;\s*$/.test(source)) throw new Error('EXTERNAL_DRAFT_GUARD_CHANGED');
    return source.replace(guard, 'BEGIN;').replace(/\bROLLBACK;\s*$/, 'COMMIT;');
}
const sqlJson = value => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
export async function runExternalSnapshotRuntime({ query, root, report }) {
    assert.equal(await query("SELECT current_database() ~ '^buildtrack_sales_runtime_[a-f0-9]+$' AND current_user ~ '^runtime_[a-f0-9]+$' AND current_setting('buildtrack.synthetic_runtime',true)='on' AND inet_server_addr()='127.0.0.1'::inet;"), 't');
    const source = readFileSync(join(root, externalSnapshotDraftPath), 'utf8');
    const hash = value => createHash('sha256').update(value).digest('hex');
    report.sources[externalSnapshotDraftPath] = hash(source);
    const cases = [];
    const check = async (label, sql) => { assert.equal(await query(sql), 't', label); cases.push(label); };
    const deny = async (label, sql, pattern) => { await assert.rejects(query(sql), pattern); cases.push(label); };
    await query(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
      CREATE ROLE service_role NOLOGIN BYPASSRLS; CREATE ROLE synthetic_delegate NOLOGIN;
      CREATE TABLE public.synthetic_other_department(id integer PRIMARY KEY, note text);
      INSERT INTO public.synthetic_other_department VALUES(1,'UNCHANGED');
      GRANT SELECT,UPDATE ON public.synthetic_other_department TO authenticated;
      ALTER DEFAULT PRIVILEGES GRANT ALL ON TABLES TO service_role,synthetic_delegate;
      ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO service_role,synthetic_delegate;`);
    await deny('draft cannot install as-is', source, /DESIGN ONLY: external snapshot/);
    await check('failed draft left no schema', "SELECT to_regnamespace('crm_external_private') IS NULL;");
    await query(externalSnapshotTestBody(source));
    await check('all five private tables have RLS', "SELECT count(*)=5 AND bool_and(relrowsecurity) FROM pg_class WHERE relnamespace='crm_external_private'::regnamespace AND relkind='r';");
    for (const role of ['anon', 'authenticated', 'service_role', 'synthetic_delegate']) {
        await deny(`private data denied to ${role}`, `BEGIN; SET LOCAL ROLE ${role}; SELECT * FROM crm_external_private.snapshot_batches; ROLLBACK;`, /permission denied/);
        await deny(`private writer denied to ${role}`, `BEGIN; SET LOCAL ROLE ${role}; SELECT crm_external_private.stage_snapshot('{}'); ROLLBACK;`, /permission denied/);
        await check(`table and function ACLs sealed for ${role}`, `SELECT NOT EXISTS(SELECT 1 FROM pg_class c WHERE c.relnamespace='crm_external_private'::regnamespace AND c.relkind='r' AND has_table_privilege('${role}',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')) AND NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.pronamespace='crm_external_private'::regnamespace AND has_function_privilege('${role}',p.oid,'EXECUTE'));`);
    }
    const plan = syntheticExternalSnapshot();
    assertSameSheetSnapshotPlan(plan, plan.planDigest);
    const stage = p => `SELECT crm_external_private.stage_snapshot(${sqlJson(p)});`;
    const empty = () => check('no partial staging after rejected payload', 'SELECT NOT EXISTS(SELECT 1 FROM crm_external_private.snapshot_batches);');
    for (const [label, mutate, pattern] of [
        ['missing envelope key', p => { delete p.importReady; }, /CONTRACT_INVALID/],
        ['activation claim', p => { p.importReady = true; }, /CONTRACT_INVALID/],
        ['wrong contract', p => { p.version = 'other'; }, /CONTRACT_INVALID/],
        ['duplicate source row', p => { p.sourceRecords.push(p.sourceRecords[0]); }, /duplicate key/],
        ['missing customer partition source', p => { p.customers[0].sourceRows = [2]; }, /MEMBERSHIP_INVALID/],
        ['interest references absent customer', p => { p.interests[0].customerKey = 'f'.repeat(64); }, /foreign key/],
        ['booking links wrong source customer', p => { p.bookings[0].customerKey = p.customers[1].sourceEntityKey; }, /foreign key/],
        ['ownerless candidate not held', p => { p.customers[1].reviewHolds = []; }, /check constraint/],
        ['invented historical phone', p => { p.customers[0].phone = '0800000000'; }, /check constraint/],
        ['invented interest status', p => { p.interests[0].status = 'new'; }, /check constraint/],
        ['missing plot not held', p => { p.bookings[2].reviewHolds = []; }, /check constraint/],
        ['nameless row made available', p => { p.sourceRecords[3].disposition = 'mapped_for_review'; }, /check constraint/],
        ['booking history silently omitted', p => { p.bookings.pop(); }, /EVIDENCE_INVALID/],
        ['historical money changed from source', p => { p.bookings[0].salePrice = 99; }, /EVIDENCE_INVALID/],
        ['ownerless source not held', p => { p.sourceRecords[2].disposition = 'mapped_for_review'; }, /EVIDENCE_INVALID/],
        ['Admin hold list incomplete', p => { p.holds = []; }, /EVIDENCE_INVALID/],
    ]) {
        const altered = structuredClone(plan); mutate(altered);
        await deny(label, stage(altered), pattern); await empty();
    }
    await query(`BEGIN; ${stage(plan)} ROLLBACK;`);
    await empty(); cases.push('explicit transaction rollback removes the entire new staging batch');
    // Exercise a committed insert and racing exact retries on separate connections.
    const receipts = await Promise.all([query(stage(plan)), query(stage(plan)), query(stage(plan))]);
    const parsed = receipts.map(JSON.parse), batch = parsed[0].batchId;
    assert.equal(new Set(parsed.map(r => r.batchId)).size, 1);
    assert.equal(parsed.filter(r => !r.replayed).length, 1); cases.push('concurrent same snapshot has exactly one insert');
    const replay = JSON.parse(await query(stage(plan)));
    assert.equal(replay.batchId, batch); assert.equal(replay.replayed, true); cases.push('exact retry returns original batch');
    await check('exact row counts after retries', `SELECT (SELECT count(*)=1 FROM crm_external_private.snapshot_batches)
      AND (SELECT count(*)=3 FROM crm_external_private.customer_candidates)
      AND (SELECT count(*)=4 FROM crm_external_private.interest_candidates)
      AND (SELECT count(*)=5 FROM crm_external_private.source_records)
      AND (SELECT count(*)=3 FROM crm_external_private.booking_history);`);
    await check('merged person retains both project owners', `SELECT
      (SELECT count(*)=1 FROM crm_external_private.customer_candidates WHERE customer_name='SYNTHETIC SAME' AND owner_login='JEEJEE')
      AND (SELECT count(*)=1 FROM crm_external_private.interest_candidates WHERE owner_login='PIEW')
      AND (SELECT count(*)=1 FROM crm_external_private.booking_history WHERE plot_label_id IS NULL AND stage='cancelled');`);
    await check('RLS hides all evidence even with an accidental SELECT grant', `BEGIN;
      GRANT USAGE ON SCHEMA crm_external_private TO authenticated;
      GRANT SELECT ON crm_external_private.snapshot_batches TO authenticated;
      SET LOCAL ROLE authenticated; SELECT count(*)=0 FROM crm_external_private.snapshot_batches; ROLLBACK;`);
    await deny('invoker writer does not bypass missing table privileges', `BEGIN;
      GRANT USAGE ON SCHEMA crm_external_private TO authenticated;
      GRANT EXECUTE ON FUNCTION crm_external_private.stage_snapshot(jsonb) TO authenticated;
      SET LOCAL ROLE authenticated; ${stage(plan)} ROLLBACK;`, /permission denied/);
    for (const [label, mutate] of [
        ['changed file', p => { p.sourceSha256 = 'b'.repeat(64); }],
        ['changed mapping', p => { p.planDigest = 'c'.repeat(64); }],
        ['changed raw evidence with same digest', p => { p.sourceRecords[0].rawValues[3] = 'ALTERED'; }],
    ]) { const altered = structuredClone(plan); mutate(altered); await deny(label, stage(altered), /CHANGED_RECONCILIATION_REQUIRED/); }
    for (const table of ['snapshot_batches', 'customer_candidates', 'interest_candidates', 'source_records', 'booking_history']) {
        await deny(`${table} rejects update`, `UPDATE crm_external_private.${table} SET payload=payload;`, /APPEND_ONLY/);
        await deny(`${table} rejects delete`, `DELETE FROM crm_external_private.${table};`, /APPEND_ONLY/);
    }
    await deny('truncate cannot erase evidence', 'BEGIN; TRUNCATE crm_external_private.snapshot_batches CASCADE; ROLLBACK;', /APPEND_ONLY/);
    await check('other department data and access unchanged', `BEGIN; SET LOCAL ROLE authenticated;
      UPDATE public.synthetic_other_department SET note=note;
      SELECT count(*)=1 AND bool_and(note='UNCHANGED') FROM public.synthetic_other_department; ROLLBACK;`);
    await check('no live CRM tables created', "SELECT to_regclass('public.sales_customers') IS NULL AND to_regclass('public.sales') IS NULL AND to_regnamespace('auth') IS NULL;");
    assert.equal(hash(readFileSync(join(root, externalSnapshotDraftPath), 'utf8')), report.sources[externalSnapshotDraftPath]);
    return { assertions: cases.length, cases, productionChanged: false, syntheticOnly: true,
        liveRowsWritten: 0, databaseStagingReplayTested: true, crmImportReplayTested: false };
}
