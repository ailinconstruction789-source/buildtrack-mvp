// Genuine operational RPCs over the fresh synthetic cutover. Never a remote URL.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { assertPlainSql } from './safety.mjs';
import { assembleCentralBookingCandidate, centralBookingCandidatePath, centralBookingHeader, centralBookingFooter, centralBookingParts } from './central-booking-candidate.mjs';
import { prepareConstructionSalesCompatibilityRuntime, runConstructionSalesCompatibilityRuntime } from './construction-sales-compatibility-runtime.mjs';

export const externalBookingWriterDraftPath = 'sql/sales/external_booking_writer_draft.sql';
export function externalBookingWriterTestBody(source) {
    assertPlainSql(source);
    const guard = /\bBEGIN;\s*DO \$draft_only\$\s*BEGIN\s*RAISE EXCEPTION 'DESIGN ONLY: external booking writer requires isolated composed verification';\s*END;\s*\$draft_only\$;/g;
    if ([...source.matchAll(guard)].length !== 1 || !/\bROLLBACK;\s*$/.test(source)) throw new Error('EXTERNAL_BOOKING_WRITER_GUARD_CHANGED');
    return source.replace(guard, 'BEGIN;').replace(/\bROLLBACK;\s*$/, 'COMMIT;');
}
const literal = value => `'${String(value).replaceAll("'", "''")}'`;
const json = value => `${literal(JSON.stringify(value))}::jsonb`;
const jeejee = 'a0290000-0000-4000-8000-000000000201';
const piew = 'a0290000-0000-4000-8000-000000000202';
const sessions = { [jeejee]: 'b0290000-0000-4000-8000-000000000201', [piew]: 'b0290000-0000-4000-8000-000000000202' };
const request = (actor, sql) => `BEGIN; SET LOCAL ROLE authenticated;
    SET LOCAL "request.jwt.claims" = ${literal(JSON.stringify({ sub: actor, session_id: sessions[actor], role: 'authenticated' }))}; ${sql} COMMIT;`;

export async function runExternalBookingWriterRuntime({ query, root, report, parseContext, parseProject, parseCentral }) {
    assert.equal(await query("SELECT current_database() ~ '^buildtrack_sales_runtime_[a-f0-9]+$' AND current_user ~ '^runtime_[a-f0-9]+$' AND current_setting('buildtrack.synthetic_runtime',true)='on' AND inet_server_addr()='127.0.0.1'::inet;"), 't');
    const cases = [];
    const check = async (label, sql) => { assert.equal(await query(sql), 't', label); cases.push(label); };
    const deny = async (label, sql, pattern) => { await assert.rejects(query(sql), pattern); cases.push(label); };
    const load = path => {
        const source = readFileSync(join(root, path), 'utf8');
        report.sources[path] = createHash('sha256').update(source).digest('hex');
        return source;
    };
    const originals = await query(`SELECT jsonb_build_object(
      'customers',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.sales_customers c),
      'leads',(SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM public.leads l),
      'voices',(SELECT jsonb_agg(to_jsonb(v) ORDER BY id) FROM public.customer_voices v));`);
    const source = load(externalBookingWriterDraftPath);
    await deny('writer draft cannot execute unreviewed', source, /DESIGN ONLY/);
    const candidate = load(centralBookingCandidatePath).replaceAll('\r\n', '\n');
    assert.equal(candidate, assembleCentralBookingCandidate(new Map(
        [centralBookingHeader, ...centralBookingParts, centralBookingFooter].map(path => [path, load(path)]))));
    await deny('commands candidate refuses missing release evidence', candidate, /CENTRAL_BOOKING_REVIEW_REQUIRED/);
    const batch = JSON.parse(await query('SELECT to_jsonb(b) FROM crm_external_private.snapshot_batches b;'));
    const settings = {
        release: 'central_booking_rows_2_966_v1', project: 'kbthmdedilswdmmczfay',
        backup: 'SYNTHETIC local disposable cluster', app_review: 'SYNTHETIC parser and component tests',
        review: 'SYNTHETIC exact source window', batch: batch.id, source_sha256: batch.source_sha256, plan_digest: batch.plan_digest,
    };
    const reviewed = (overrides = {}) => Object.entries({ ...settings, ...overrides })
        .map(([key, value]) => `SET buildtrack.booking_commands_${key}=${literal(value)};`).join('\n') + '\n' + candidate;
    await deny('candidate binds reviewed source hash', reviewed({ source_sha256: 'f'.repeat(64) }), /CENTRAL_BOOKING_SOURCE_CHANGED/);
    await deny('candidate binds reviewed plan digest', reviewed({ plan_digest: 'f'.repeat(64) }), /CENTRAL_BOOKING_SOURCE_CHANGED/);
    await deny('late installation failure rolls back the entire candidate', reviewed().replace(/COMMIT;\s*$/,
        "DO $synthetic_failure$ BEGIN RAISE EXCEPTION 'SYNTHETIC_LATE_INSTALL_FAILURE'; END; $synthetic_failure$; COMMIT;"), /SYNTHETIC_LATE_INSTALL_FAILURE/);
    await check('failed installation leaves no writer schema or companion grants', `SELECT
      to_regclass('crm_external_private.booking_writer_releases') IS NULL
      AND to_regprocedure('public.crm_v2_central_search(jsonb,integer)') IS NULL
      AND NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.sales'::regclass AND attname='booking_revision' AND NOT attisdropped);`);
    await query(reviewed());
    cases.push('exact saved candidate installs atomically and stays sealed');
    await check('candidate covers every source row through 966 including hidden empty rows', `SELECT
      jsonb_array_length(payload->'sourceRecords')+jsonb_array_length(payload->'skippedSourceRows')=965
      FROM crm_external_private.snapshot_batches;`);
    await check('candidate installation grants no search or booking API yet', `SELECT
      NOT has_function_privilege('authenticated','public.crm_v2_central_search(jsonb,integer)','EXECUTE')
      AND NOT has_function_privilege('authenticated','public.crm_v2_booking_command(uuid,jsonb)','EXECUTE')
      AND NOT EXISTS(SELECT 1 FROM crm_external_private.booking_writer_releases);`);
    await query(`INSERT INTO auth.sessions(id,user_id) VALUES('${sessions[jeejee]}','${jeejee}'),('${sessions[piew]}','${piew}');`);
    const activate = "SELECT crm_external_private.enable_booking_writer(id,plan_digest,'SYNTHETIC booking release') FROM crm_external_private.snapshot_batches;";
    for (const role of ['anon', 'authenticated', 'service_role', 'synthetic_guard_delegate']) {
        await deny(`activation forbidden to ${role}`, `BEGIN; SET LOCAL ROLE ${role}; ${activate} ROLLBACK;`, /permission denied/);
    }
    await deny('manual flags cannot replace reviewed activation', 'INSERT INTO public.crm_settings(id,central_intake_enabled) VALUES(true,true);', /ACTIVATION_REVIEW_REQUIRED/);
    await deny('changed stock blocks activation', `BEGIN; UPDATE public.plots SET has_customer=false WHERE id='K-9'; ${activate} ROLLBACK;`, /EXTERNAL_WRITER_/);
    await prepareConstructionSalesCompatibilityRuntime({ query, root, report });
    await query(activate);
    await check('actual reviewed session resolves Sales', request(piew, "SELECT public.crm_v2_role()='sales';"));
    await check('public booking enabled only after transition', request(piew, "SELECT (public.crm_v2_booking_capabilities()->>'enabled')::boolean;"));
    await deny('unrelated future feature switch stays sealed', 'BEGIN; ALTER TABLE public.crm_settings ADD COLUMN synthetic_notifications_enabled boolean DEFAULT false; UPDATE public.crm_settings SET synthetic_notifications_enabled=true; ROLLBACK;', /ACTIVATION_REVIEW_REQUIRED/);
    for (const role of ['anon', 'authenticated', 'service_role', 'synthetic_guard_delegate']) {
        await check(`unrelated lifecycle APIs remain sealed for ${role}`, `SELECT
          NOT has_function_privilege('${role}','public.crm_v2_record_lead_work(uuid,jsonb)','EXECUTE')
          AND NOT has_table_privilege('${role}','public.crm_next_actions','SELECT,INSERT,UPDATE,DELETE')
          AND NOT has_table_privilege('${role}','crm_external_private.booking_writer_permits','SELECT,INSERT,UPDATE,DELETE');`);
    }
    const imported = JSON.parse(await query(`SELECT jsonb_agg(jsonb_build_object('sale',to_jsonb(s),'interest',to_jsonb(i)) ORDER BY s.id)
      FROM public.sales s JOIN public.lead_project_interests i ON i.id=s.project_interest_id;`));
    const active = imported.find(x => x.sale.crm_stage === 'booked');
    const historical = imported.find(x => x.sale.crm_stage === 'cancelled');
    assert.ok(active && historical, 'test requires genuine booked and cancelled source histories');
    const customerId = active.interest.customer_id;
    const readContext = async actor => parseContext(JSON.parse(await query(request(actor, `SELECT public.crm_v2_booking_context('${customerId}');`))), customerId, 0);
    const beforeContext = await readContext(jeejee);
    assert.equal(beforeContext.sales.find(x => x.id === active.sale.id).canCancel, true);
    assert.equal(beforeContext.sales.find(x => x.id === historical.sale.id).canResume, false);
    cases.push('public booking context parses with imported cancellation permission');
    const customerBefore = await query(`SELECT to_jsonb(c) FROM public.sales_customers c WHERE id='${customerId}';`);
    const historicalBefore = await query(`SELECT to_jsonb(s) FROM public.sales s WHERE id='${historical.sale.id}';`);
    const commandSql = (payload, id = randomUUID()) => `SELECT public.crm_v2_booking_command('${id}',${json(payload)});`;
    const rpc = async (actor, payload, id) => JSON.parse(await query(request(actor, commandSql(payload, id))));
    const cancelPayload = sale => ({ command: 'cancel', reason: 'SYNTHETIC customer cancelled', customerId,
        saleId: sale.id, expectedSaleRevision: sale.booking_revision, cancellationCategory: 'booking_cancelled' });
    const cancel = cancelPayload(active.sale);
    await deny('another project owner cannot cancel', request(piew, commandSql(cancel)), /CRM_BOOKING_FORBIDDEN/);
    await deny('blank cancellation reason rejected', request(jeejee, commandSql({ ...cancel, reason: ' ' })), /CRM_BOOKING_INVALID_INPUT/);
    await deny('stale cancellation rejected', request(jeejee, commandSql({ ...cancel, expectedSaleRevision: randomUUID() })), /CRM_BOOKING_STALE_STATE/);
    await deny('source evidence cannot be supplied by browser', request(jeejee, commandSql({ ...cancel, importedHistory: {} })), /CRM_BOOKING_INVALID_INPUT/);
    const cancelRequest = randomUUID();
    const cancelled = await rpc(jeejee, cancel, cancelRequest);
    assert.equal((await rpc(jeejee, cancel, cancelRequest)).replayed, true);
    cases.push('real imported cancellation and identical retry succeed once');
    await check('imported source stays unknown while new cancellation is timestamped', `SELECT crm_stage='cancelled' AND external_source_stage='booked'
      AND booking_round IS NULL AND booked_at IS NULL AND sale_price IS NULL AND list_price IS NULL AND discount_amount IS NULL
      AND cancelled_at IS NOT NULL AND cancellation_reason='SYNTHETIC customer cancelled' FROM public.sales WHERE id='${active.sale.id}';`);
    await check('cancel releases plot without touching construction', "SELECT NOT has_customer AND is_completed AND paused_for_sale_at='2026-08-01Z'::timestamptz FROM public.plots WHERE id='K-9';");
    await check('project reader includes source day and new cancellation separately', request(jeejee, `SELECT count(*)=1 FROM jsonb_array_elements(public.crm_v2_project_sales('PROJECT K','cancelled')->'rows') r
      WHERE r->>'saleId'='${active.sale.id}' AND r#>>'{importedHistory,sourceStage}'='booked' AND r#>>'{importedHistory,bookedDate}'='2026-08-01' AND r->>'cancelledAt' IS NOT NULL;`));
    await deny('cancelled imported history cannot be cancelled twice', request(jeejee, commandSql({ ...cancel, expectedSaleRevision: cancelled.saleRevision })), /CRM_BOOKING_CONFLICT/);
    const book = { command: 'book', reason: 'SYNTHETIC confirmed new booking', customerId, newCustomer: null,
        projectName: 'PROJECT A', expectedInterestRevision: historical.interest.lifecycle_revision, plotId: 'A-53',
        paymentMethod: 'mortgage', bookingRoute: 'without_visit', visitId: null, listPriceSatang: 250000000,
        discountSatang: 500000, depositSatang: 100000, previousSaleId: historical.sale.id };
    await deny('central owner cannot override other project owner', request(jeejee, commandSql(book)), /CRM_BOOKING_FORBIDDEN/);
    const id = randomUUID();
    const concurrent = await Promise.all([rpc(piew, book, id), rpc(piew, book, id), rpc(piew, book, id)]);
    assert.equal(concurrent.filter(x => !x.replayed).length, 1);
    const booked = concurrent.find(x => !x.replayed);
    cases.push('three same-request bookings append exactly one genuine new sale');
    await deny('same request with changed price cannot replay', request(piew, commandSql({ ...book, discountSatang: 0 }, id)), /CRM_BOOKING_IDEMPOTENCY_CONFLICT/);
    await deny('occupied plot cannot be booked again', request(piew, commandSql({ ...book, expectedInterestRevision: booked.interestRevision })), /CRM_BOOKING_PLOT_UNAVAILABLE/);
    await check('new round links old cancellation and reserves plot', `SELECT s.previous_sale_id='${historical.sale.id}' AND s.external_booking_id IS NULL
      AND s.booking_round=1 AND s.booked_at IS NOT NULL AND s.sale_price=2495000 AND s.booking_amount=1000 AND p.has_customer
      FROM public.sales s JOIN public.plots p ON p.id=s.plot_id WHERE s.id='${booked.saleId}';`);
    assert.equal(await query(`SELECT to_jsonb(s) FROM public.sales s WHERE id='${historical.sale.id}';`), historicalBefore);
    assert.equal(await query(`SELECT to_jsonb(c) FROM public.sales_customers c WHERE id='${customerId}';`), customerBefore);
    cases.push('rebooking preserves entire historical cancelled sale and imported customer');
    await check('all Sales can read project bookings', request(jeejee, `SELECT count(*)=1 FROM jsonb_array_elements(public.crm_v2_project_sales('PROJECT A','booked')->'rows') r WHERE r->>'saleId'='${booked.saleId}';`));
    const projectScope = { projectName: 'PROJECT A', tab: 'all', query: '', page: 0 };
    const project = parseProject(JSON.parse(await query(request(jeejee, "SELECT public.crm_v2_project_sales('PROJECT A','all');"))), projectScope);
    assert.equal(project.rows.length, 2);
    assert.equal((await readContext(piew)).sales.length, 3);
    cases.push('actual composed RPC outputs accepted by operational TypeScript parsers');
    await deny('session revocation blocks replay', `BEGIN; DELETE FROM auth.sessions WHERE id='${sessions[piew]}'; SET LOCAL ROLE authenticated;
      SET LOCAL "request.jwt.claims"=${literal(JSON.stringify({ sub: piew, session_id: sessions[piew], role: 'authenticated' }))}; ${commandSql(book, id)} ROLLBACK;`, /CRM_BOOKING_FORBIDDEN/);
    for (const role of ['anon', 'authenticated', 'service_role', 'synthetic_guard_delegate']) {
        await deny(`direct sale edits forbidden to ${role}`, `BEGIN; SET LOCAL ROLE ${role}; UPDATE public.sales SET sale_price=1; ROLLBACK;`, /permission denied|EXTERNAL_|CRM_BOOKING_FORBIDDEN/);
        await deny(`scoped permit creation forbidden to ${role}`, `BEGIN; SET LOCAL ROLE ${role}; SELECT crm_external_private.begin_booking_write('${piew}','${customerId}','${booked.interestId}','${booked.saleId}','cancel'); ROLLBACK;`, /permission denied/);
    }
    await deny('direct operator sale edits remain sealed', 'UPDATE public.sales SET sale_price=1;', /EXTERNAL_|CRM_BOOKING_FORBIDDEN/);
    await deny('imported customer identity remains sealed', `UPDATE public.sales_customers SET customer_name='SYNTHETIC changed' WHERE id='${customerId}';`, /HISTORY_SEALED/);
    await deny('imported interest owner remains sealed', `UPDATE public.lead_project_interests SET owner_user_id='${jeejee}' WHERE id='${booked.interestId}';`, /HISTORY_SEALED/);
    await deny('manual stock change remains forbidden after activation', "UPDATE public.plots SET has_customer=false WHERE id='A-53';", /EXTERNAL_|CRM_BOOKING_/);
    await query("UPDATE public.plots SET handover_notes='SYNTHETIC construction still editable' WHERE id='A-53';");
    await check('construction-only changes still work', "SELECT handover_notes='SYNTHETIC construction still editable' AND has_customer FROM public.plots WHERE id='A-53';");
    await query(request(piew, "UPDATE public.plots SET sale_status='ready_for_sale',paused_for_sale_at=now() WHERE id='A-53';"));
    await check('construction pause preserves booking stock', "SELECT sale_status='ready_for_sale' AND has_customer AND paused_for_sale_at IS NOT NULL FROM public.plots WHERE id='A-53';");
    await query(request(piew, "UPDATE public.plots SET sale_status='active',paused_for_sale_at=NULL WHERE id='A-53';"));
    await check('construction resume preserves booking stock', "SELECT sale_status='active' AND has_customer AND paused_for_sale_at IS NULL FROM public.plots WHERE id='A-53';");
    await deny('pause cannot smuggle an occupancy change', request(piew, "UPDATE public.plots SET sale_status='ready_for_sale',has_customer=false WHERE id='A-53';"), /EXTERNAL_WRITER_/);
    await deny('manual transfer remains blocked', request(piew, "UPDATE public.plots SET sale_status='transferred' WHERE id='A-53';"), /EXTERNAL_WRITER_/);
    await deny('referenced plot cannot be silently reassigned to a project', request(piew, "UPDATE public.plots SET project_name='PROJECT K' WHERE id='A-53';"), /EXTERNAL_WRITER_/);
    const newCancel = { ...cancel, saleId: booked.saleId, expectedSaleRevision: booked.saleRevision };
    const newCancelled = await rpc(piew, newCancel);
    assert.equal((await readContext(piew)).sales.find(x => x.id === booked.saleId).canResume, false);
    await deny('resume does not expose lifecycle outside narrowed release', request(piew, commandSql({ command: 'resume_follow_up', reason: 'SYNTHETIC resume attempt', customerId,
        saleId: booked.saleId, expectedSaleRevision: newCancelled.saleRevision, expectedInterestRevision: newCancelled.interestRevision,
        expectedActionId: null, nextAction: { action: 'SYNTHETIC next action', dueAt: '2030-01-01T00:00:00Z' } })), /CRM_BOOKING_SETUP_REQUIRED|CRM_BOOKING_FORBIDDEN/);
    await check('new sale cancellation releases only its plot', "SELECT NOT has_customer FROM public.plots WHERE id='A-53';");
    const competing = await Promise.allSettled([rpc(piew, { ...book, expectedInterestRevision: newCancelled.interestRevision, previousSaleId: booked.saleId }),
        rpc(piew, { ...book, expectedInterestRevision: newCancelled.interestRevision, previousSaleId: booked.saleId })]);
    assert.equal(competing.filter(x => x.status === 'fulfilled').length, 1);
    assert.match(competing.find(x => x.status === 'rejected').reason.message, /CRM_BOOKING_STALE_STATE|CRM_BOOKING_PLOT_UNAVAILABLE/);
    cases.push('different simultaneous requests cannot acquire same plot twice');
    await check('no external or generic permits leak after commits', `SELECT NOT EXISTS(SELECT 1 FROM sales_private.booking_write_permits)
      AND NOT EXISTS(SELECT 1 FROM crm_external_private.booking_writer_permits);`);
    const leadPayload = { name: 'SYNTHETIC new central customer', phone: '0892900011', channel: 'phone', notes: 'SYNTHETIC', interests: [] };
    const leadRequest = randomUUID();
    const leadSql = `SELECT public.crm_v2_create_customer('${leadRequest}',${json(leadPayload)});`;
    const created = JSON.parse(await query(request(piew, leadSql)));
    assert.equal(JSON.parse(await query(request(piew, leadSql))).replayed, true);
    await check('central intake creates one unassigned-to-project Lead owned by recorder', `SELECT c.owner_user_id='${piew}' AND c.phone='0892900011'
      AND c.external_snapshot_batch_id IS NULL AND c.lead_created_at IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM public.lead_project_interests WHERE customer_id=c.id)
      FROM public.sales_customers c WHERE id='${created.customerId}';`);
    await check('central public snapshot contains refreshed imported and new Leads', request(piew, "SELECT jsonb_array_length(public.crm_v2_central_snapshot()->'customers')=3;"));
    const filters = { search: '', project: '', channel: '', owner: '', status: '', unassignedOnly: false };
    await check('actual central search capability is enabled', request(piew, "SELECT (public.crm_v2_central_search_capabilities()->>'enabled')::boolean;"));
    const central = parseCentral(JSON.parse(await query(request(piew, `SELECT public.crm_v2_central_search(${json(filters)},0);`))), filters, 0, { userId: piew, role: 'sales' });
    assert.equal(central.customers.length, 3);
    assert.equal(central.customers.find(x => x.id === customerId).phone, null);
    cases.push('actual central search RPC parses imported unknown phone and new Lead together');
    await deny('old cutover rollback refuses new operational work', "SELECT crm_external_private.rollback_sales(id,'SYNTHETIC unsafe rollback') FROM crm_external_private.snapshot_batches;", /EXTERNAL_CUTOVER_/);
    await check('no legacy customer rows or voices created', `SELECT jsonb_build_object('leads',(SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM public.leads l),
      'voices',(SELECT jsonb_agg(to_jsonb(v) ORDER BY id) FROM public.customer_voices v))=${json((({ leads, voices }) => ({ leads, voices }))(JSON.parse(originals)))};`);
    report.results.constructionSalesCompatibility = await runConstructionSalesCompatibilityRuntime({ query, root, report,
        migrationPath: 'supabase/migrations/20260929092748_construction_completion_sales_transfer_only.sql' });
    return { assertions: cases.length, cases, syntheticOnly: true, productionChanged: false, publicBookingCommandsTested: true,
        realSessionAuthorizationTested: true, importedCancellationTested: true, activationReady: false };
}
