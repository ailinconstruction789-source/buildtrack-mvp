// Runs only after the exact foundation and synthetic identity bridge suites.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { assertPlainSql } from './safety.mjs';

export const externalBookingBridgeDraftPath = 'sql/sales/external_booking_bridge_draft.sql';
export function externalBookingBridgeTestBody(source) {
    assertPlainSql(source);
    const guard = /\bBEGIN;\s*DO \$draft_only\$\s*BEGIN\s*RAISE EXCEPTION 'DESIGN ONLY: external booking bridge requires isolated verification and separate cutover review';\s*END;\s*\$draft_only\$;/g;
    if ([...source.matchAll(guard)].length !== 1 || !/\bROLLBACK;\s*$/.test(source)) throw new Error('EXTERNAL_BOOKING_GUARD_CHANGED');
    return source.replace(guard, 'BEGIN;').replace(/\bROLLBACK;\s*$/, 'COMMIT;');
}

export async function runExternalBookingBridgeRuntime({ query, root, report, includeHeldBooking = false, firstBookingStage = 'transferred', dataSchemaInstalled = false }) {
    assert.equal(await query("SELECT current_database() ~ '^buildtrack_sales_runtime_[a-f0-9]+$' AND current_user ~ '^runtime_[a-f0-9]+$' AND current_setting('buildtrack.synthetic_runtime',true)='on' AND inet_server_addr()='127.0.0.1'::inet;"), 't');
    const source = readFileSync(join(root, externalBookingBridgeDraftPath), 'utf8');
    const hash = s => createHash('sha256').update(s).digest('hex');
    report.sources[externalBookingBridgeDraftPath] = hash(source);
    const cases = [];
    const check = async (label, sql) => { assert.equal(await query(sql), 't', label); cases.push(label); };
    const deny = async (label, sql, pattern) => { await assert.rejects(query(sql), pattern); cases.push(label); };
    // Construction columns already exist in the reviewed full-shape legacy fixture.
    await query(`UPDATE public.plots SET is_completed=true,handover_notes='SYNTHETIC construction evidence',paused_for_sale_at='2026-08-01Z' WHERE id='K-9';
      UPDATE public.sales SET plot_id='K-9' WHERE id='e0280000-0000-4000-8000-000000000001';
      INSERT INTO public.sales(id,contract_status,plot_id) VALUES('e0290000-0000-4000-8000-000000000077','Cancelled',NULL);`);
    const shared = `SELECT jsonb_build_object(
      'sales',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.sales s),
      'plots',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.plots p),
      'leads',(SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM public.leads l),
      'voices',(SELECT jsonb_agg(to_jsonb(v) ORDER BY id) FROM public.customer_voices v),
      'settings',(SELECT jsonb_agg(to_jsonb(s)) FROM public.crm_settings s));`;
    const before = await query(shared);
    await deny('draft cannot be installed without explicit test unwrap', source, /DESIGN ONLY: external booking bridge/);
    if (!dataSchemaInstalled) await query(externalBookingBridgeTestBody(source));
    const call = (ref = 'SYNTHETIC replacement review') => `SELECT crm_external_private.prepare_booking_release(id,plan_digest,'${ref}') FROM crm_external_private.snapshot_batches;`;
    for (const role of ['anon', 'authenticated', 'service_role', 'synthetic_guard_delegate']) {
        await deny(`no client execution for ${role}`, `BEGIN; SET LOCAL ROLE ${role}; ${call()} ROLLBACK;`, /permission denied/);
        await check(`default privileges sealed for ${role}`, `SELECT
          NOT EXISTS(SELECT 1 FROM pg_class c WHERE c.relnamespace='crm_external_private'::regnamespace
            AND c.relname IN ('booking_sales_projection','prepared_booking_sales','booking_release_receipts')
            AND has_table_privilege('${role}',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'))
          AND NOT has_function_privilege('${role}','crm_external_private.prepare_booking_release(uuid,text,text)','EXECUTE');`);
    }
    await deny('different plan refused', "SELECT crm_external_private.prepare_booking_release(id,repeat('f',64),'SYNTHETIC') FROM crm_external_private.snapshot_batches;", /PLAN_CHANGED/);
    await deny('empty review refused', call(''), /INPUT_INVALID/);
    await deny('unreviewed batch refused', "SELECT crm_external_private.prepare_booking_release('00000000-0000-4000-8000-000000000001',repeat('a',64),'SYNTHETIC');", /IDENTITY_BRIDGE_REQUIRED/);
    await deny('current account bans still checked', `BEGIN; UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id='a0290000-0000-4000-8000-000000000201'; ${call()} ROLLBACK;`, /BINDING_STALE/);
    await deny('unlinked operator append cannot disappear from preparation', `BEGIN;
      INSERT INTO crm_external_private.booking_history(batch_id,payload)
      SELECT s.batch_id,jsonb_build_object('sourceEntityKey',repeat('f',64),'sourceRow',5,
        'customerKey',NULL,'interestKey',NULL,'plotId',NULL,'stage','cancelled',
        'reviewHolds',jsonb_build_array('CUSTOMER_REQUIRED','INTEREST_REQUIRED','PLOT_UNKNOWN'))
      FROM crm_external_private.source_records s WHERE s.source_row=5;
      ${call()} ROLLBACK;`, /COVERAGE_INVALID/);
    await query(`BEGIN; ${call()} ROLLBACK;`);
    await check('explicit rollback leaves no prepared bookings or receipt', `SELECT NOT EXISTS(SELECT 1 FROM crm_external_private.prepared_booking_sales)
      AND NOT EXISTS(SELECT 1 FROM crm_external_private.booking_release_receipts);`);
    const results = (await Promise.all([query(call()), query(call()), query(call())])).map(JSON.parse);
    assert.equal(results.filter(r => !r.replayed).length, 1); cases.push('three concurrent calls prepare one set');
    assert.ok(results.every(r => r.bookingHistories === (includeHeldBooking ? 4 : 3) && r.eligibleForReleaseReview === 2 && r.heldHistories === (includeHeldBooking ? 2 : 1)
        && r.activeSourcePlots === 1 && r.legacySalesPreserved === 2 && r.salesWritten === 0 && r.plotsChanged === 0 && !r.activationReady));
    cases.push('all histories preserved with cancelled unknown plot held');
    const ids = await query('SELECT jsonb_agg(id ORDER BY id) FROM crm_external_private.prepared_booking_sales;');
    assert.equal(JSON.parse(await query(call())).replayed, true);
    assert.equal(await query('SELECT jsonb_agg(id ORDER BY id) FROM crm_external_private.prepared_booking_sales;'), ids);
    cases.push('exact replay preserves prepared IDs');
    await deny('changed review refused on replay', call('SYNTHETIC revised review'), /REPLAY_CHANGED/);
    await deny('changed old sale requires reconciliation', `BEGIN; UPDATE public.sales SET booking_amount=123 WHERE plot_id='K-9'; ${call()} ROLLBACK;`, /LEGACY_CHANGED/);
    await deny('new legacy sale requires reconciliation', `BEGIN; INSERT INTO public.sales(id,contract_status) VALUES('e0290000-0000-4000-8000-000000000078','Cancelled'); ${call()} ROLLBACK;`, /LEGACY_CHANGED/);
    await deny('changed construction notes require reconciliation', `BEGIN; UPDATE public.plots SET handover_notes='SYNTHETIC new work' WHERE id='K-9'; ${call()} ROLLBACK;`, /LEGACY_CHANGED/);
    const held = query(`BEGIN; ${call()} SELECT pg_advisory_xact_lock(20260929,30); SELECT pg_sleep(2); ROLLBACK;`);
    try {
        let ready = false;
        for (let n = 0; n < 20; n++) {
            if (await query("SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND classid=20260929 AND objid=30 AND granted);") === 't') { ready = true; break; }
            await new Promise(resolve => setTimeout(resolve, 20));
        }
        assert.ok(ready, 'snapshot lock barrier not reached');
        await deny('legacy write cannot race snapshot capture', "BEGIN; SET LOCAL lock_timeout='100ms'; UPDATE public.sales SET booking_amount=99 WHERE plot_id='K-9'; ROLLBACK;", /lock timeout/);
    } finally { await held; }
    await check('legacy evidence is retained verbatim', `SELECT
      legacy_snapshot->'sales'=(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.sales s)
      AND legacy_snapshot->'plots'=(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.plots p)
      FROM crm_external_private.booking_release_receipts;`);
    await check('day precision and unknown money stay unchanged', `SELECT count(*)=${includeHeldBooking ? 4 : 3} AND bool_and(
      payload->'deposit_amount'='null' AND payload->'sale_price'='null' AND payload->'payment_method'='null'
      AND payload->'cancellation_reason'='null') FROM crm_external_private.prepared_booking_sales;`);
    await check('project-specific closing owner retained', `SELECT count(*)=1 FROM crm_external_private.prepared_booking_sales
      WHERE payload->>'project_name'='PROJECT A' AND payload->>'closing_sales_user_id'='a0290000-0000-4000-8000-000000000202'
      AND payload->>'cancelled_date'='2026-09-02' AND stage='cancelled';`);
    await check('first booking uses source days, not created timestamp', `SELECT count(*)=1 FROM crm_external_private.prepared_booking_sales
      WHERE payload->>'booked_date'='2026-08-01' AND ${firstBookingStage === 'booked' ? "payload->>'transferred_date' IS NULL AND stage='booked'" : "payload->>'transferred_date'='2026-09-01' AND stage='transferred'"};`);
    await deny('cannot fake prepared customer or money', `INSERT INTO crm_external_private.prepared_booking_sales(batch_id,booking_key,payload)
      SELECT batch_id,booking_key,jsonb_set(to_jsonb(p),'{sale_price}','0') FROM crm_external_private.booking_sales_projection p LIMIT 1;`, /EVIDENCE_REQUIRED/);
    await deny('cannot edit prepared history', "UPDATE crm_external_private.prepared_booking_sales SET payload='{}';", /APPEND_ONLY/);
    await deny('cannot delete prepared history', 'DELETE FROM crm_external_private.prepared_booking_sales;', /APPEND_ONLY/);
    await deny('cannot truncate legacy evidence even with cascade', 'TRUNCATE crm_external_private.booking_release_receipts CASCADE;', /APPEND_ONLY/);
    await check('partial unique index protects all active candidate stages', `SELECT EXISTS(SELECT 1 FROM pg_indexes
      WHERE schemaname='crm_external_private' AND indexname='prepared_booking_active_plot_idx' AND indexdef LIKE '%UNIQUE%'
        AND indexdef LIKE '%cancelled%');`);
    await deny('preparation cannot enable CRM', 'INSERT INTO public.crm_settings(id,central_intake_enabled) VALUES(true,true);', /ACTIVATION_REVIEW_REQUIRED/);
    assert.equal(await query(shared), before); cases.push('legacy sales and entire plots including construction fields unchanged');
    assert.equal(hash(readFileSync(join(root, externalBookingBridgeDraftPath), 'utf8')), hash(source));
    return { assertions: cases.length, cases, syntheticOnly: true, productionChanged: false,
        bookingPreparationTested: true, publicSalesCutoverTested: false, activationReady: false };
}
