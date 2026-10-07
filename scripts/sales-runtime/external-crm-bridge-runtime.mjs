// Synthetic-only integration with the exact sealed foundation, never live Supabase.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { assertPlainSql } from './safety.mjs';
import { syntheticExternalSnapshot } from './external-snapshot-fixture.mjs';
import { externalSnapshotDraftPath, externalSnapshotTestBody } from './external-snapshot-runtime.mjs';
export const externalCrmBridgeDraftPath = 'sql/sales/external_crm_bridge_draft.sql';
export function externalCrmBridgeTestBody(source) {
    assertPlainSql(source);
    const guard = /\bBEGIN;\s*DO \$draft_only\$\s*BEGIN\s*RAISE EXCEPTION 'DESIGN ONLY: external CRM bridge requires isolated verification and separate cutover review';\s*END;\s*\$draft_only\$;/g;
    if ([...source.matchAll(guard)].length !== 1 || !/\bROLLBACK;\s*$/.test(source)) throw new Error('EXTERNAL_BRIDGE_GUARD_CHANGED');
    return source.replace(guard, 'BEGIN;').replace(/\bROLLBACK;\s*$/, 'COMMIT;');
}
const literal = value => `'${String(value).replaceAll("'", "''")}'`;
const json = value => `${literal(JSON.stringify(value))}::jsonb`;
const admin = 'a0250000-0000-4000-8000-000000000001';
const sales = ['a0290000-0000-4000-8000-000000000201', 'a0290000-0000-4000-8000-000000000202'];
export async function runExternalCrmBridgeRuntime({ query, root, report, includeHeldBooking = false, firstBookingStage = 'transferred', sourceLastRow = 6, dataSchemaInstalled = false }) {
    assert.equal(await query("SELECT current_database() ~ '^buildtrack_sales_runtime_[a-f0-9]+$' AND current_user ~ '^runtime_[a-f0-9]+$' AND current_setting('buildtrack.synthetic_runtime',true)='on' AND inet_server_addr()='127.0.0.1'::inet;"), 't');
    const paths = [externalSnapshotDraftPath, externalCrmBridgeDraftPath];
    const texts = new Map(paths.map(p => [p, readFileSync(join(root, p), 'utf8')]));
    const hash = s => createHash('sha256').update(s).digest('hex');
    for (const [p, s] of texts) report.sources[p] = hash(s);
    const cases = [];
    const check = async (label, sql) => { assert.equal(await query(sql), 't', label); cases.push(label); };
    const deny = async (label, sql, pattern) => { await assert.rejects(query(sql), pattern); cases.push(label); };
    if (!dataSchemaInstalled) await query(externalSnapshotTestBody(texts.get(externalSnapshotDraftPath)));
    await query('ALTER DEFAULT PRIVILEGES GRANT ALL ON TABLES TO service_role,synthetic_guard_delegate; ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO service_role,synthetic_guard_delegate;');
    await deny('bridge draft is inert', texts.get(externalCrmBridgeDraftPath), /DESIGN ONLY: external CRM bridge/);
    if (!dataSchemaInstalled) await query(externalCrmBridgeTestBody(texts.get(externalCrmBridgeDraftPath)));
    // Only this disposable fixture provisions fake reviewed identities.
    await query(`INSERT INTO auth.users(id,email) VALUES('${sales[0]}','jeejee@synthetic.invalid'),('${sales[1]}','piew@synthetic.invalid');
      INSERT INTO public.users(id,username,role) VALUES(201,'JEEJEE','Sales'),(202,'PIEW','Sales');
      SELECT account_security_private.review_account_role('${admin}',1,'guard_admin','guard_admin@buildtrack.local','Admin',true,true,0,'SYNTHETIC admin','synthetic runner','SYNTHETIC recovery');
      SELECT account_security_private.review_account_role('${sales[0]}',201,'JEEJEE','jeejee@synthetic.invalid','Sales',true,false,0,'SYNTHETIC sales','synthetic runner',NULL);
      SELECT account_security_private.review_account_role('${sales[1]}',202,'PIEW','piew@synthetic.invalid','Sales',true,false,0,'SYNTHETIC sales','synthetic runner',NULL);
      INSERT INTO public.projects(name,is_closed) VALUES('PROJECT K',true),('PROJECT A',false);
      INSERT INTO public.plots(id,project_name,foreman_name,has_customer,sale_status) VALUES('K-9','PROJECT K','SYNTHETIC foreman',false,'active'),('A-53','PROJECT A','SYNTHETIC foreman',false,'active');`);
    const plan = syntheticExternalSnapshot({ includeHeldBooking, firstBookingStage, sourceLastRow });
    const batch = JSON.parse(await query(`SELECT crm_external_private.stage_snapshot(${json(plan)});`)).batchId;
    const bindings = [{ login: 'JEEJEE', authUserId: sales[0], revision: 1 }, { login: 'PIEW', authUserId: sales[1], revision: 1 }];
    const call = (mapping = bindings, digest = plan.planDigest, reviewer = admin, ref = 'SYNTHETIC frozen review') =>
        `SELECT crm_external_private.materialize_crm('${batch}',${literal(digest)},'${reviewer}',${json(mapping)},${literal(ref)});`;
    const sharedSnapshot = `SELECT jsonb_build_object(
      'sales',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.sales s),
      'plots',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.plots p),
      'leads',(SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM public.leads l),
      'voices',(SELECT jsonb_agg(to_jsonb(v) ORDER BY id) FROM public.customer_voices v),
      'roles',(SELECT jsonb_agg(to_jsonb(r) ORDER BY auth_user_id) FROM account_security_private.reviewed_roles r),
      'projection',(SELECT jsonb_agg(to_jsonb(r) ORDER BY user_id) FROM sales_private.crm_user_roles r),
      'settings',(SELECT jsonb_agg(to_jsonb(s)) FROM public.crm_settings s));`;
    const baseline = await query(sharedSnapshot);
    for (const role of ['anon', 'authenticated', 'service_role', 'synthetic_guard_delegate']) {
        await deny(`private bridge inaccessible to ${role}`, `BEGIN; SET LOCAL ROLE ${role}; ${call()} ROLLBACK;`, /permission denied/);
        await deny(`CRM stays sealed for ${role}`, `BEGIN; SET LOCAL ROLE ${role}; SELECT * FROM public.sales_customers; ROLLBACK;`, /permission denied/);
        await check(`inherited default grants removed for ${role}`, `SELECT NOT EXISTS(SELECT 1 FROM pg_class c WHERE c.relnamespace='crm_external_private'::regnamespace AND c.relkind='r' AND has_table_privilege('${role}',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'))
          AND NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.pronamespace='crm_external_private'::regnamespace AND has_function_privilege('${role}',p.oid,'EXECUTE'));`);
    }
    await deny('wrong source plan rejected', call(bindings, 'f'.repeat(64)), /PLAN_CHANGED/);
    await deny('Sales cannot be designated reviewer', call(bindings, plan.planDigest, sales[0]), /REVIEWED_ADMIN_REQUIRED/);
    await deny('missing Sales binding rejected', call(bindings.slice(0, 1)), /BINDINGS_REQUIRED/);
    await deny('unreviewed revision rejected', call(bindings.map(b => ({ ...b, revision: 2 }))), /BINDING_STALE/);
    await deny('swapped identity rejected', call(bindings.map((b, i) => ({ ...b, authUserId: sales[1 - i] }))), /BINDING_STALE/);
    await deny('disabled canonical role rejected', `BEGIN; UPDATE account_security_private.reviewed_roles SET enabled=false WHERE auth_user_id='${sales[1]}'; ${call()} ROLLBACK;`, /BINDING_STALE/);
    await deny('banned account rejected', `BEGIN; UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id='${sales[0]}'; ${call()} ROLLBACK;`, /BINDING_STALE/);
    await deny('plot moved across project rejected', `BEGIN; UPDATE public.plots SET project_name='PROJECT K' WHERE id='A-53'; ${call()} ROLLBACK;`, /CATALOG_CHANGED/);
    await check('failed calls leave CRM and receipts empty', `SELECT NOT EXISTS(SELECT 1 FROM public.sales_customers)
      AND NOT EXISTS(SELECT 1 FROM public.lead_project_interests) AND NOT EXISTS(SELECT 1 FROM crm_external_private.bridge_receipts);`);
    await query(`BEGIN; ${call()} ROLLBACK;`);
    await check('explicit rollback removes all materialized links', `SELECT NOT EXISTS(SELECT 1 FROM public.sales_customers)
      AND NOT EXISTS(SELECT 1 FROM public.lead_project_interests) AND NOT EXISTS(SELECT 1 FROM crm_external_private.booking_crm_links);`);
    const receipts = (await Promise.all([query(call()), query(call()), query(call())])).map(JSON.parse);
    assert.equal(receipts.filter(r => !r.replayed).length, 1);
    assert.deepEqual(receipts.map(r => r.batchId), [batch, batch, batch]); cases.push('concurrent materialization creates one CRM set');
    assert.deepEqual(receipts[0], { batchId: batch, replayed: receipts[0].replayed, customers: 2, interests: 3, bookingHistoryLinks: includeHeldBooking ? 4 : 3,
        salesWritten: 0, plotsChanged: 0, activationReady: false }); cases.push('held candidates excluded without losing booking history');
    const ids = await query('SELECT jsonb_agg(id ORDER BY id) FROM public.sales_customers;');
    assert.equal(JSON.parse(await query(call([...bindings].reverse()))).replayed, true);
    assert.equal(await query('SELECT jsonb_agg(id ORDER BY id) FROM public.sales_customers;'), ids); cases.push('replay preserves IDs and accepts binding order only');
    await deny('changed review cannot silently replay', call(bindings, plan.planDigest, admin, 'SYNTHETIC revised review'), /REPLAY_CHANGED/);
    await deny('replay rechecks current account state', `BEGIN; UPDATE auth.users SET deleted_at=now() WHERE id='${sales[0]}'; ${call()} ROLLBACK;`, /BINDING_STALE/);
    await deny('replay rechecks project membership', `BEGIN; UPDATE public.plots SET project_name='PROJECT K' WHERE id='A-53'; ${call()} ROLLBACK;`, /CATALOG_CHANGED/);
    const holdingCatalog = query(`BEGIN; ${call()} SELECT pg_advisory_xact_lock(20260929,29); SELECT pg_sleep(2); ROLLBACK;`);
    try {
        let ready = false;
        for (let n = 0; n < 20; n++) {
            if (await query("SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND classid=20260929 AND objid=29 AND granted);") === 't') { ready = true; break; }
            await new Promise(resolve => setTimeout(resolve, 20));
        }
        assert.ok(ready, 'catalog-lock barrier not reached');
        await deny('plot project cannot race membership validation', "BEGIN; SET LOCAL lock_timeout='100ms'; UPDATE public.plots SET project_name='PROJECT K' WHERE id='A-53'; ROLLBACK;", /lock timeout/);
    } finally { await holdingCatalog; }
    await check('historical unknowns remain unknown', `SELECT
      (SELECT count(*)=2 AND bool_and(phone IS NULL AND lead_created_at IS NULL AND first_contacted_at IS NULL AND legacy_source_lead_id IS NULL AND record_origin='legacy_import') FROM public.sales_customers)
      AND (SELECT count(*)=3 AND bool_and(engagement_status='legacy_unclassified' AND interest_created_at IS NULL AND workspace_state='central_interest' AND activated_at IS NULL AND interested_plot_id IS NULL) FROM public.lead_project_interests);`);
    await check('same customer keeps distinct project owners and histories', `SELECT
      (SELECT count(*)=1 FROM public.sales_customers WHERE customer_name='SYNTHETIC SAME' AND owner_user_id='${sales[0]}')
      AND (SELECT count(*)=1 FROM public.lead_project_interests WHERE project_name='PROJECT A' AND owner_user_id='${sales[1]}')
      AND (SELECT count(*)=1 FROM crm_external_private.booking_crm_links WHERE plot_id IS NULL);`);
    await deny('materialized customers cannot be edited before release', "UPDATE public.sales_customers SET intake_status='lost';", /HISTORY_SEALED/);
    await deny('materialized interests cannot activate before release', "UPDATE public.lead_project_interests SET engagement_status='follow_up';", /HISTORY_SEALED/);
    await deny('flag-only activation is refused', 'INSERT INTO public.crm_settings(id,central_intake_enabled) VALUES(true,true);', /ACTIVATION_REVIEW_REQUIRED/);
    await check('disabled configuration remains possible', `BEGIN; INSERT INTO public.crm_settings(id,central_intake_enabled) VALUES(true,false);
      SELECT NOT central_intake_enabled FROM public.crm_settings; ROLLBACK;`);
    await deny('legacy sale columns remain sealed', "UPDATE public.sales SET crm_stage='booked';", /CRM_FOUNDATION_COLUMNS_SEALED/);
    await check('no fabricated visits, activities or SLA tasks', `SELECT NOT EXISTS(SELECT 1 FROM public.lead_visits)
      AND NOT EXISTS(SELECT 1 FROM public.lead_activities) AND NOT EXISTS(SELECT 1 FROM public.crm_sla_tasks);`);
    const live = `INSERT INTO public.sales_customers(customer_name,owner_user_id,created_by_user_id,phone)
      VALUES('SYNTHETIC live','${sales[0]}','${sales[0]}',%PHONE%);`;
    await deny('live intake still requires phone', live.replace('%PHONE%', 'NULL'), /check constraint/);
    await check('valid live origin still works without external provenance', `BEGIN; ${live.replace('%PHONE%', "'0812345678'")}
      SELECT count(*)=1 FROM public.sales_customers WHERE record_origin='live' AND external_snapshot_batch_id IS NULL; ROLLBACK;`);
    await deny('legacy import cannot lack both evidence paths', `INSERT INTO public.sales_customers(customer_name,record_origin,phone_data_status,intake_status,owner_user_id,created_by_user_id,lead_created_at)
      VALUES('SYNTHETIC invalid','legacy_import','unknown_legacy','legacy_unclassified','${sales[0]}','${admin}',NULL);`, /crm_customer_origin_check/);
    await deny('cannot import held candidate directly', `INSERT INTO public.sales_customers(customer_name,record_origin,phone_data_status,intake_status,owner_user_id,created_by_user_id,lead_created_at,external_snapshot_batch_id,external_customer_key)
      VALUES('SYNTHETIC OWNERLESS','legacy_import','unknown_legacy','legacy_unclassified','${sales[0]}','${admin}',NULL,'${batch}','${plan.customers[1].sourceEntityKey}');`, /CUSTOMER_EVIDENCE_REQUIRED/);
    const historical = `INSERT INTO public.sales_customers(customer_name,record_origin,phone_data_status,intake_status,owner_user_id,created_by_user_id,lead_created_at,legacy_source_lead_id,external_snapshot_batch_id,external_customer_key)
      VALUES('SYNTHETIC SAME','legacy_import','unknown_legacy','legacy_unclassified','${sales[0]}','${admin}',NULL,%LEGACY%,%BATCH%,%KEY%);`;
    const provenance = (legacy, b, key) => historical.replace('%LEGACY%', legacy).replace('%BATCH%', b).replace('%KEY%', key);
    const legacyId = "'d0280000-0000-4000-8000-000000000001'";
    await deny('partial external batch evidence rejected', provenance('NULL', literal(batch), 'NULL'), /CUSTOMER_EVIDENCE_REQUIRED|MATCH FULL|crm_customer_origin_check/);
    await deny('partial external key evidence rejected', provenance('NULL', 'NULL', literal(plan.customers[0].sourceEntityKey)), /MATCH FULL|crm_customer_origin_check/);
    await deny('both legacy and external provenance rejected', provenance(legacyId, literal(batch), literal(plan.customers[0].sourceEntityKey)), /crm_customer_origin_check/);
    await check('existing legacy DB provenance still works', `BEGIN; ${provenance(legacyId, 'NULL', 'NULL')}
      SELECT count(*)=1 FROM public.sales_customers WHERE legacy_source_lead_id=${legacyId}; ROLLBACK;`);
    await deny('external interest cannot link to a different customer', `INSERT INTO public.lead_project_interests(customer_id,project_name,owner_user_id,created_by_user_id,engagement_status,interest_created_at,external_snapshot_batch_id,external_interest_key)
      SELECT id,'PROJECT K','${sales[0]}','${admin}','legacy_unclassified',NULL,'${batch}','${plan.interests[0].sourceEntityKey}'
      FROM public.sales_customers WHERE external_customer_key='${plan.customers[2].sourceEntityKey}';`, /INTEREST_EVIDENCE_REQUIRED/);
    assert.equal(await query(sharedSnapshot), baseline); cases.push('sales plots legacy data permissions and flags unchanged');
    for (const [p, s] of texts) assert.equal(hash(readFileSync(join(root, p), 'utf8')), hash(s));
    return { assertions: cases.length, cases, syntheticOnly: true, productionChanged: false,
        crmIdentityBridgeReplayTested: true, salesImportTested: false, activationReady: false };
}
