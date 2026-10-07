// Isolated native PostgreSQL rehearsal only. No workbook, credentials or remote URL.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { assertPlainSql } from './safety.mjs';
import { runExternalSaleEvidenceRuntime } from './external-sale-evidence-runtime.mjs';

export const externalSalesCutoverDraftPath = 'sql/sales/external_sales_cutover_draft.sql';
export function externalSalesCutoverTestBody(source) {
    assertPlainSql(source);
    const guard = /\bBEGIN;\s*DO \$draft_only\$\s*BEGIN\s*RAISE EXCEPTION 'DESIGN ONLY: external sales cutover requires isolated verification and operational integration';\s*END;\s*\$draft_only\$;/g;
    if ([...source.matchAll(guard)].length !== 1 || !/\bROLLBACK;\s*$/.test(source)) throw new Error('EXTERNAL_SALES_CUTOVER_GUARD_CHANGED');
    return source.replace(guard, 'BEGIN;').replace(/\bROLLBACK;\s*$/, 'COMMIT;');
}

export async function runExternalSalesCutoverRuntime({ query, root, report, afterCutover, firstBookingStage = 'transferred', dataSchemaInstalled = false }) {
    assert.equal(await query("SELECT current_database() ~ '^buildtrack_sales_runtime_[a-f0-9]+$' AND current_user ~ '^runtime_[a-f0-9]+$' AND current_setting('buildtrack.synthetic_runtime',true)='on' AND inet_server_addr()='127.0.0.1'::inet;"), 't');
    const source = readFileSync(join(root, externalSalesCutoverDraftPath), 'utf8');
    const hash = s => createHash('sha256').update(s).digest('hex');
    report.sources[externalSalesCutoverDraftPath] = hash(source);
    const cases = [];
    const check = async (label, sql) => { assert.equal(await query(sql), 't', label); cases.push(label); };
    const deny = async (label, sql, pattern = /EXTERNAL_CUTOVER_/) => { await assert.rejects(query(sql), pattern); cases.push(label); };
    const literal = value => `'${value.replaceAll("'", "''")}'`;
    const replace = (ref = 'SYNTHETIC release review', overrides = '{"A-53":"active"}') =>
        `SELECT crm_external_private.replace_sales(id,plan_digest,${literal(ref)},${literal(overrides)}::jsonb) FROM crm_external_private.snapshot_batches;`;
    const rollback = (ref = 'SYNTHETIC rollback review') =>
        `SELECT crm_external_private.rollback_sales(id,${literal(ref)}) FROM crm_external_private.snapshot_batches;`;
    await deny('draft cannot run directly', source, /DESIGN ONLY: external sales cutover/);
    if (!dataSchemaInstalled) await query(externalSalesCutoverTestBody(source));
    const salesSql = 'SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.sales s;';
    const plotsSql = 'SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.plots p;';
    const otherSql = `SELECT jsonb_build_object('leads',(SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM public.leads l),
      'voices',(SELECT jsonb_agg(to_jsonb(v) ORDER BY id) FROM public.customer_voices v),
      'settings',(SELECT jsonb_agg(to_jsonb(s)) FROM public.crm_settings s));`;
    const oldSales = await query(salesSql);
    const oldPlots = await query(plotsSql);
    const otherBefore = await query(otherSql);
    for (const role of ['anon', 'authenticated', 'service_role', 'synthetic_guard_delegate']) {
        await deny(`replace not callable by ${role}`, `BEGIN; SET LOCAL ROLE ${role}; ${replace()} ROLLBACK;`, /permission denied/);
        await deny(`rollback not callable by ${role}`, `BEGIN; SET LOCAL ROLE ${role}; ${rollback()} ROLLBACK;`, /permission denied/);
    }
    await deny('incorrect plan rejected', "SELECT crm_external_private.replace_sales(id,repeat('f',64),'SYNTHETIC','{}') FROM crm_external_private.snapshot_batches;", /PLAN_CHANGED|EXTERNAL_CUTOVER_/);
    await deny('blank review rejected', replace(''));
    await deny('unknown override plot rejected', replace('SYNTHETIC', '{"missing":"active"}'));
    await deny('invalid override type rejected', replace('SYNTHETIC', '{"K-9":true}'));
    await deny('missing stale transfer correction is rejected', replace('SYNTHETIC', '{}'), /PLOT_STATUS_RECONCILIATION_REQUIRED/);
    if (firstBookingStage === 'transferred') await deny('override cannot contradict actual transferred source', replace('SYNTHETIC', '{"A-53":"active","K-9":"active"}'), /PLOT_STATUS_RECONCILIATION_REQUIRED/);
    await deny('unrelated plot cannot be overridden', replace('SYNTHETIC', '{"A-53":"active","A":"active"}'), /PLOT_STATUS_RECONCILIATION_REQUIRED/);
    await deny('late legacy sales writes block replacement', `BEGIN; UPDATE public.sales SET booking_amount=123 WHERE plot_id='K-9'; ${replace()} ROLLBACK;`);
    await deny('late construction changes require fresh reconciliation', `BEGIN; UPDATE public.plots SET handover_notes='SYNTHETIC newly changed'; ${replace()} ROLLBACK;`);
    await deny('new dependent sale record blocks replacement', `BEGIN;
      CREATE TABLE public.synthetic_sale_dependency(sale_id uuid REFERENCES public.sales(id));
      INSERT INTO public.synthetic_sale_dependency SELECT id FROM public.sales LIMIT 1;
      ${replace()} ROLLBACK;`, /EXTERNAL_CUTOVER_|foreign key/);
    await deny('current owner ban blocks replacement', `BEGIN;
      UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id='a0290000-0000-4000-8000-000000000201';
      ${replace()} ROLLBACK;`, /BINDING_STALE|EXTERNAL_CUTOVER_/);
    await query(`BEGIN; ${replace()} ROLLBACK;`);
    assert.equal(await query(salesSql), oldSales);
    assert.equal(await query(plotsSql), oldPlots);
    cases.push('outer transaction rollback restores all sales and plots exactly');
    await check('outer rollback leaves no cutover receipt', 'SELECT NOT EXISTS(SELECT 1 FROM crm_external_private.sales_cutover_receipts);');
    const concurrent = (await Promise.all([query(replace()), query(replace()), query(replace())])).map(JSON.parse);
    assert.equal(concurrent.filter(r => !r.replayed).length, 1);
    cases.push('three concurrent replacements produce exactly one sale set');
    const result = concurrent.find(r => !r.replayed);
    assert.equal(result.salesWritten, 2);
    assert.equal(result.legacySalesArchived, 2);
    assert.equal(result.heldHistories, 2);
    assert.equal(result.activationReady, false);
    cases.push('replacement archives old set and writes only two linked eligible histories');
    await check('old and replacement IDs not combined', `SELECT count(*)=2 AND bool_and(external_booking_id=id)
      AND bool_and(id NOT IN ('e0280000-0000-4000-8000-000000000001','e0290000-0000-4000-8000-000000000077')) FROM public.sales;`);
    await check('unknown dates rounds and monetary evidence not invented', `SELECT bool_and(booking_round IS NULL AND booked_at IS NULL
      AND cancelled_at IS NULL AND previous_sale_id IS NULL AND lead_id IS NULL AND sale_price IS NULL AND booking_amount IS NULL) FROM public.sales;`);
    await check('active source occupancy and source stage retained', `SELECT (SELECT count(*)=1 FROM public.sales WHERE crm_stage='${firstBookingStage}' AND plot_id='K-9')
      AND (SELECT has_customer AND sale_status='${firstBookingStage === 'transferred' ? 'transferred' : 'active'}' FROM public.plots WHERE id='K-9');`);
    await check('reviewed stale transfer flag corrected without completing construction', "SELECT sale_status='active' AND NOT has_customer FROM public.plots WHERE id='A-53';");
    await check('unknown bank state and event time do not use legacy defaults', 'SELECT bool_and(bank_status IS NULL AND transferred_at IS NULL AND land_office_price IS NULL) FROM public.sales;');
    report.externalSaleEvidence = await runExternalSaleEvidenceRuntime({ query, root, report, dataSchemaInstalled });
    if (afterCutover) {
        await afterCutover();
        return { assertions: cases.length, cases, syntheticOnly: true, productionChanged: false,
            publicSalesReplacementTested: true, selectiveRollbackTested: false, activationReady: false };
    }
    const afterSales = await query(salesSql);
    const afterPlots = await query(plotsSql);
    assert.equal(JSON.parse(await query(replace())).replayed, true);
    assert.equal(await query(salesSql), afterSales);
    cases.push('same request replays without duplicated sales');
    await deny('changed release review not accepted on replay', replace('SYNTHETIC changed'));
    for (const operation of [replace(), rollback()]) {
        await deny('banned reviewer cannot replay or rollback', `BEGIN;
          UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id='a0250000-0000-4000-8000-000000000001';
          ${operation} ROLLBACK;`, /BINDING_STALE|REVIEWED_ADMIN_REQUIRED/);
    }
    await deny('new cascading dependency blocks rollback before deleting child data', `BEGIN;
      CREATE TABLE public.synthetic_late_dependency(sale_id uuid REFERENCES public.sales(id) ON DELETE CASCADE);
      INSERT INTO public.synthetic_late_dependency SELECT id FROM public.sales LIMIT 1;
      ${rollback()} ROLLBACK;`, /DEPENDENCIES_CHANGED/);
    await deny('new DELETE trigger blocks rollback before executing its side effects', `BEGIN;
      CREATE TABLE public.synthetic_side_effect(id integer);
      CREATE FUNCTION public.synthetic_late_delete() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN INSERT INTO public.synthetic_side_effect VALUES(1); RETURN OLD; END; $$;
      CREATE TRIGGER synthetic_late_delete BEFORE DELETE ON public.sales FOR EACH ROW EXECUTE FUNCTION public.synthetic_late_delete();
      ${rollback()} ROLLBACK;`, /DEPENDENCIES_CHANGED/);
    await deny('replaced plot-sync function blocks rollback', `BEGIN;
      CREATE OR REPLACE FUNCTION public.sync_plot_customer_status() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END; $$;
      ${rollback()} ROLLBACK;`, /DEPENDENCIES_CHANGED/);
    await deny('new rewrite rule blocks rollback side effects', `BEGIN;
      CREATE TABLE public.synthetic_rule_effect(id uuid);
      CREATE RULE synthetic_late_rule AS ON DELETE TO public.sales DO ALSO INSERT INTO public.synthetic_rule_effect VALUES(OLD.id);
      ${rollback()} ROLLBACK;`, /DEPENDENCIES_CHANGED/);
    for (const role of ['anon', 'authenticated', 'service_role', 'synthetic_guard_delegate']) {
        await check(`private permits and receipt images inaccessible to ${role}`, `SELECT
          NOT has_table_privilege('${role}','crm_external_private.sales_cutover_permits','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
          AND NOT has_table_privilege('${role}','crm_external_private.sales_cutover_receipts','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
          AND NOT has_function_privilege('${role}','crm_external_private.guard_cutover_sale()','EXECUTE');`);
    }
    await deny('legacy client cannot create competing sales after switch', `BEGIN; SET LOCAL ROLE authenticated;
      INSERT INTO public.sales(id,plot_id,contract_status) VALUES('e0290000-0000-4000-8000-000000000088','K-9','Reserved'); ROLLBACK;`, /EXTERNAL_CUTOVER_|permission denied/);
    await deny('direct owner sale edits blocked outside permit', "UPDATE public.sales SET booking_amount=123;");
    await deny('direct deletion cannot erase imported history', 'DELETE FROM public.sales;');
    await deny('receipt is immutable', 'UPDATE crm_external_private.sales_cutover_receipts SET batch_id=batch_id;', /APPEND_ONLY/);
    await deny('CRM activation still rejected', 'INSERT INTO public.crm_settings(id,central_intake_enabled) VALUES(true,true);', /ACTIVATION_REVIEW_REQUIRED/);
    await deny('rollback refuses intervening inventory flag change', `BEGIN; UPDATE public.plots SET has_customer=false WHERE id='K-9'; ${rollback()} ROLLBACK;`);
    assert.equal(await query(salesSql), afterSales);
    assert.equal(await query(plotsSql), afterPlots);
    cases.push('failed rollback is atomic');
    // This is a later construction update, not a rollback of the whole database.
    await query("UPDATE public.plots SET handover_notes='SYNTHETIC later construction work' WHERE id='K-9';");
    const restored = JSON.parse(await query(rollback()));
    assert.equal(restored.restoredSales, 2);
    assert.equal(restored.activationReady, false);
    assert.equal(await query(salesSql), oldSales);
    cases.push('postcommit rollback restores original IDs and complete old sales rows');
    await check('ordinary legacy sale has no invented import evidence', 'SELECT bool_and(crm_external_private.sale_history(to_jsonb(s)) IS NULL) FROM public.sales s;');
    await check('rollback keeps later construction work', "SELECT handover_notes='SYNTHETIC later construction work' AND is_completed AND paused_for_sale_at='2026-08-01Z'::timestamptz FROM public.plots WHERE id='K-9';");
    const finalPlots = JSON.parse(await query(plotsSql));
    const originalPlots = JSON.parse(oldPlots);
    for (const p of finalPlots) {
        if (p.id === 'K-9') p.handover_notes = originalPlots.find(x => x.id === p.id).handover_notes;
    }
    assert.deepEqual(finalPlots, originalPlots);
    cases.push('rollback changes only sales-owned plot fields');
    assert.equal(JSON.parse(await query(rollback())).replayed, true);
    cases.push('rollback replay preserves original rows');
    await check('legacy client update still works after rollback', `BEGIN; SET LOCAL ROLE authenticated;
      UPDATE public.sales SET contract_status='Cancelled' WHERE plot_id='K-9';
      SELECT NOT has_customer FROM public.plots WHERE id='K-9'; ROLLBACK;`);
    assert.equal(await query(otherSql), otherBefore);
    cases.push('legacy leads voices and settings remain unchanged');
    assert.equal(hash(readFileSync(join(root, externalSalesCutoverDraftPath), 'utf8')), hash(source));
    return { assertions: cases.length, cases, syntheticOnly: true, productionChanged: false,
        publicSalesReplacementTested: true, selectiveRollbackTested: true, activationReady: false };
}
