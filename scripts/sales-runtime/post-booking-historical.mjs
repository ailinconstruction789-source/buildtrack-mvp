// Actual history/guard function bodies over synthetic prerequisites in the owned cluster.
// This is not a full external-import deployment rehearsal or a production certificate.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { assertPlainSql } from './safety.mjs';

const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const json = value => `${quote(JSON.stringify(value))}::jsonb`;
const actor = 'cb310000-0000-4000-8000-000000000001';
const other = 'cb310000-0000-4000-8000-000000000002';
const owner = 'cb310000-0000-4000-8000-000000000003';
const batch = 'cb310000-0000-4000-8000-000000000004';
const request = (sql, user = actor, readOnly = false) => `BEGIN${readOnly ? ' READ ONLY' : ''}; SET LOCAL ROLE authenticated;
 SET LOCAL "request.jwt.claim.sub"=${quote(user)}; ${sql} COMMIT;`;

export async function runPostBookingHistorical({ query, root, report, parseSnapshot, parseInput, parseResult, preparePendingImports = false, prepareRentalRetirements = false }) {
  assert.equal(await query("SELECT current_database() ~ '^buildtrack_sales_runtime_[a-f0-9]+$' AND current_setting('buildtrack.synthetic_runtime',true)='on' AND inet_server_addr()='127.0.0.1'::inet;"), 't');
  const cases = [];
  const check = (condition, label) => { assert.ok(condition, label); cases.push(label); };
  const deny = async (label, sql, pattern) => { await assert.rejects(query(sql), pattern); cases.push(label); };
  const read = path => {
    const source = readFileSync(join(root, path), 'utf8'); assertPlainSql(source);
    report.sources[path] = createHash('sha256').update(source).digest('hex'); return source;
  };
  const bridge = read('sql/sales/external_crm_bridge_draft.sql');
  const cutover = read('sql/sales/external_sales_cutover_draft.sql');
  const evidence = read('sql/sales/external_sale_evidence_draft.sql');
  const postBooking = read('sql/sales/21_post_booking_draft.sql');
  const adapterStart = postBooking.indexOf('DO $external_adapter$');
  assert.ok(adapterStart > 0);
  const adapter = postBooking.slice(adapterStart, postBooking.indexOf('$external_adapter$;', adapterStart) + '$external_adapter$;'.length);
  const customerDdl = bridge.slice(bridge.indexOf('ALTER TABLE public.sales_customers'), bridge.indexOf('-- Existing phone evidence'));
  const interestDdl = bridge.slice(bridge.indexOf('ALTER TABLE public.lead_project_interests'), bridge.indexOf('CREATE TABLE crm_external_private.bridge_receipts'));
  const saleDdl = cutover.slice(cutover.indexOf('ALTER TABLE public.sales ADD COLUMN external_booking_id'), cutover.indexOf('CREATE TABLE crm_external_private.sales_cutover_receipts'));
  const definition = (source, name) => {
    const start = source.indexOf(`CREATE FUNCTION ${name}(`), end = source.indexOf('$$;', start);
    assert.ok(start >= 0 && end > start, 'exact reviewed function body must exist'); return source.slice(start, end + 3);
  };
  // Typed minimal private prerequisites, not a copy of live business data or policies.
  await query(`BEGIN;
    CREATE SCHEMA crm_external_private;
    REVOKE ALL ON SCHEMA crm_external_private FROM PUBLIC,anon,authenticated;
    CREATE TABLE crm_external_private.customer_candidates(batch_id uuid,entity_key text,PRIMARY KEY(batch_id,entity_key));
    CREATE TABLE crm_external_private.interest_candidates(batch_id uuid,entity_key text,PRIMARY KEY(batch_id,entity_key));
    CREATE TABLE crm_external_private.prepared_booking_sales(id uuid PRIMARY KEY,batch_id uuid,booking_key text,stage text,plot_id text,payload jsonb);
    CREATE TABLE crm_external_private.booking_history(batch_id uuid,entity_key text,stage text,source_row integer,payload jsonb);
    CREATE TABLE crm_external_private.booking_crm_links(batch_id uuid,booking_key text,customer_id uuid,interest_id uuid,plot_id text);
    CREATE TABLE crm_external_private.sales_cutover_receipts(batch_id uuid PRIMARY KEY,before_sales jsonb,after_sales jsonb);
    CREATE TABLE crm_external_private.sales_rollback_receipts(batch_id uuid);
    CREATE TABLE crm_external_private.sales_cutover_permits(transaction_id bigint PRIMARY KEY,backend_pid integer,batch_id uuid,operation text);
    ${customerDdl} ${interestDdl} ${saleDdl}
    ${preparePendingImports ? 'ALTER TABLE public.sales ADD COLUMN expected_transfer_date date;' : ''}
    ALTER TABLE public.plots ADD COLUMN plot_name text;
    INSERT INTO auth.users(id) VALUES('${actor}'),('${other}'),('${owner}');
    INSERT INTO sales_private.crm_user_roles(user_id,role,display_name,is_active) VALUES
      ('${actor}','sales','SYNTHETIC HISTORICAL SALES',true),('${other}','sales','SYNTHETIC OTHER SALES',true),('${owner}','owner','SYNTHETIC OWNER',true);
    INSERT INTO public.projects(name,is_closed) VALUES('SYNTHETIC HISTORICAL DEALS',false);
    COMMIT;`);
  const deals = [];
  const pendingDeals = [];
  const rentalDeals = [];
  for (let n = 1; n <= (prepareRentalRetirements ? 13 : preparePendingImports ? 5 : 3); n++) {
    const reused=n===6||n===12;
    const customerId = reused ? deals[2].customerId : randomUUID(), interestId = reused ? deals[2].interestId : randomUUID(), saleId = randomUUID(), plotId = n===12?rentalDeals[0].plotId:`SYNTHETIC-HISTORY-${n}`;
    const stage = n===13?'transferred':n===12?'cancelled':n === 1 || n >= 4 ? 'booked' : 'transferred';
    const sourceRow = n===13?940:n===12?950:n >= 6 ? [859,951,954,958,959,960][n-6] : n === 4 ? 926 : n === 5 ? 944 : n + 1;
    const history = { bookedDate: n === 3 ? null : '2024-02-01', transferredDate: n === 2 || n===13 ? '2024-02-29' : null, cancelledDate: n===12?'2024-03-01':null };
    const payload = { eligible_for_release_review: true, review_holds: [], interest_id: interestId, customer_id: customerId,
      project_name: 'SYNTHETIC HISTORICAL DEALS', source_row: sourceRow, booked_date: history.bookedDate, transferred_date: history.transferredDate, cancelled_date: history.cancelledDate };
    await query(`BEGIN;
      ${reused?'':`INSERT INTO crm_external_private.customer_candidates VALUES('${batch}','CUSTOMER-${n}');
      INSERT INTO public.sales_customers(id,customer_name,record_origin,phone,phone_data_status,intake_status,owner_user_id,created_by_user_id,lead_created_at,external_snapshot_batch_id,external_customer_key)
        VALUES('${customerId}','SYNTHETIC IMPORTED ${n}','legacy_import',NULL,'unknown_legacy','legacy_unclassified','${actor}','${actor}',NULL,'${batch}','CUSTOMER-${n}');`}
      ${reused?'':`INSERT INTO crm_external_private.interest_candidates VALUES('${batch}','INTEREST-${n}');
      INSERT INTO public.lead_project_interests(id,customer_id,project_name,owner_user_id,created_by_user_id,interest_created_at,engagement_status,external_snapshot_batch_id,external_interest_key)
        VALUES('${interestId}','${customerId}','SYNTHETIC HISTORICAL DEALS','${actor}','${actor}',NULL,'legacy_unclassified','${batch}','INTEREST-${n}');`}
      ${n===12?'':`INSERT INTO public.plots(id,project_name,has_customer,sale_status) VALUES('${plotId}','SYNTHETIC HISTORICAL DEALS',true,'reserved');`}
      INSERT INTO crm_external_private.prepared_booking_sales VALUES('${saleId}','${batch}','DEAL-${n}','${stage}','${plotId}',${json(payload)});
      INSERT INTO crm_external_private.booking_history VALUES('${batch}','DEAL-${n}','${stage}',${sourceRow},${json(history)});
      INSERT INTO crm_external_private.booking_crm_links VALUES('${batch}','DEAL-${n}','${customerId}','${interestId}','${plotId}');
      INSERT INTO sales_private.booking_write_permits VALUES(txid_current(),pg_backend_pid());
      INSERT INTO public.sales(id,project_interest_id,plot_id,crm_stage,contract_status,payment_method,booking_route,booking_route_reason,external_booking_id,external_source_stage,sale_price,closing_sales_user_id)
        VALUES('${saleId}','${interestId}','${plotId}','${stage}','${stage === 'booked' ? 'Reserved' : stage==='cancelled'?'Cancelled':'Transferred'}',${n === 1 ? "'cash'" : 'NULL'},'legacy_import','SYNTHETIC sealed source','${saleId}','${stage}',1000000,'${actor}');
      DELETE FROM sales_private.booking_write_permits WHERE transaction_id=txid_current();
      COMMIT;`);
    const deal = { saleId, customerId, interestId, plotId };
    if (n <= 3) deals.push(deal); else if (n<=5) pendingDeals.push(deal); else if(n<=11) rentalDeals.push({...deal,sourceRow}); else if(n===12) report.syntheticRentalCancelledPrior=deal;
    else report.syntheticCompletedForecastDeal=deal;
  }
  if (preparePendingImports) report.syntheticHistoricalPendingDeals = pendingDeals;
  if (prepareRentalRetirements) report.syntheticRentalDeals = rentalDeals;
  await query(`BEGIN;
    INSERT INTO crm_external_private.sales_cutover_receipts SELECT '${batch}','[]'::jsonb,jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.sales s WHERE external_booking_id IS NOT NULL;
    ${definition(evidence, 'crm_external_private.sale_history')}
    REVOKE ALL ON FUNCTION crm_external_private.sale_history(jsonb) FROM PUBLIC,anon,authenticated;
    ${definition(cutover, 'crm_external_private.guard_cutover_sale')}
    REVOKE ALL ON FUNCTION crm_external_private.guard_cutover_sale() FROM PUBLIC,anon,authenticated;
    CREATE FUNCTION sales_private.synthetic_handover_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.reason_text='SYNTHETIC HANDOVER ROLLBACK' THEN RAISE EXCEPTION 'SYNTHETIC_HANDOVER_AUDIT_FAILURE'; END IF; RETURN NEW; END; $$;
    REVOKE ALL ON FUNCTION sales_private.synthetic_handover_audit_failure() FROM PUBLIC,anon,authenticated;
    CREATE TRIGGER synthetic_handover_failure BEFORE INSERT ON public.crm_audit_events FOR EACH ROW EXECUTE FUNCTION sales_private.synthetic_handover_audit_failure();
    CREATE TRIGGER synthetic_actual_external_seal BEFORE INSERT OR UPDATE OR DELETE ON public.sales FOR EACH ROW EXECUTE FUNCTION crm_external_private.guard_cutover_sale();
    COMMIT;`);
  const originalGuard = await query("SELECT pg_get_functiondef('crm_external_private.guard_cutover_sale()'::regprocedure);");
  const changedGuard = originalGuard.replace('DECLARE permit', '-- SYNTHETIC unreviewed definition change\nDECLARE permit');
  await deny('adapter refuses an unreviewed guard body atomically', `BEGIN; ${changedGuard}; ${adapter} ROLLBACK;`, /CRM_POST_BOOKING_EXTERNAL_ADAPTER_REVIEW_REQUIRED/);
  check(originalGuard === await query("SELECT pg_get_functiondef('crm_external_private.guard_cutover_sale()'::regprocedure);"), 'failed adapter review restores the original guard');
  await query(`BEGIN; ${adapter} COMMIT;`);
  await deny('adapter refuses accidental duplicate installation', `BEGIN; ${adapter} ROLLBACK;`, /CRM_POST_BOOKING_EXTERNAL_ADAPTER_REVIEW_REQUIRED/);
  const snapshot = async (deal, user = actor) => {
    const data = JSON.parse(await query(request(`SELECT public.crm_v2_post_booking_context('${deal.saleId}');`, user, true)));
    return parseSnapshot(data, { saleId: deal.saleId, attemptPage: 0, eventPage: 0 });
  };
  const input = async (deal, command, extra, user = actor) => {
    const s = await snapshot(deal, user);
    return parseInput({ requestId: randomUUID(), command, saleId: deal.saleId, customerId: deal.customerId,
      expectedSaleRevision: s.sale.revision, expectedInterestRevision: s.sale.interestRevision, reason: 'SYNTHETIC ACTUAL STAFF EVENT', ...extra });
  };
  const command = value => {
    const { requestId, ...payload } = value;
    return `SELECT public.crm_v2_post_booking_command('${requestId}',${json(payload)});`;
  };
  const save = async value => parseResult(JSON.parse(await query(request(command(value)))), value);
  const before = await query(`SELECT jsonb_build_object('customers',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.sales_customers c WHERE external_snapshot_batch_id='${batch}'),
    'interests',(SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM public.lead_project_interests i WHERE project_name='SYNTHETIC HISTORICAL DEALS'),
    'sources',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM crm_external_private.prepared_booking_sales p),'receipts',(SELECT jsonb_agg(to_jsonb(r)) FROM crm_external_private.sales_cutover_receipts r));`);
  const booked = await snapshot(deals[0]);
  check(booked.sale.canEdit && booked.sale.bookedAt === null && booked.sale.importedHistory.bookedDate === '2024-02-01', 'sealed booked source with unknown round/date-time remains actionable');
  await deny('unknown round without immutable external evidence is rejected', `BEGIN; INSERT INTO sales_private.booking_write_permits VALUES(txid_current(),pg_backend_pid());
    UPDATE public.sales SET external_source_stage='transferred' WHERE id='${deals[0].saleId}'; ROLLBACK;`, /EXTERNAL_CUTOVER_SALES_SEALED/);
  const oldEvent = await input(deals[0], 'advance', { nextStage: 'contracted', occurredAt: '2024-01-31T23:59:59+07:00', evidenceNote: 'SYNTHETIC' });
  await deny('new contract cannot predate known source booking day', request(command(oldEvent)), /CRM_POST_BOOKING_INVALID_INPUT/);
  const contracted = await input(deals[0], 'advance', { nextStage: 'contracted', occurredAt: new Date().toISOString(), evidenceNote: 'SYNTHETIC CONTRACT EVIDENCE' });
  const contractReceipt = await save(contracted);
  check(contractReceipt.stage === 'contracted' && !contractReceipt.replayed, 'actual cutover guard admits exact atomic contracted update');
  const contractedSnapshot = await snapshot(deals[0]);
  check(contractedSnapshot.sale.bookedAt === null && contractedSnapshot.sale.importedHistory.bookedDate === '2024-02-01', 'new contract preserves unknown booking timestamp and source civil day');
  const day = await query("SELECT ((clock_timestamp() AT TIME ZONE 'Asia/Bangkok')::date)::text;");
  for (const deal of deals.slice(1)) {
    const current = await snapshot(deal);
    check(current.sale.paymentMethod === null && current.sale.transferDate === null && current.sale.canEdit, 'historical transferred deal needs neither invented payment method nor operational transfer date');
    const value = await input(deal, 'confirm_handover', { handoverDate: day });
    await deny('Owner cannot record imported handover', request(command(value), owner), /CRM_POST_BOOKING_FORBIDDEN/);
    await deny('another Sales cannot record imported handover', request(command(value), other), /CRM_POST_BOOKING_FORBIDDEN/);
    await deny('future handover day rejected', request(command({ ...value, handoverDate: '9999-12-31' })), /CRM_POST_BOOKING_INVALID_INPUT/);
    if (deal === deals[1]) await deny('handover cannot predate sealed transfer day', request(command({ ...value, handoverDate: '2024-02-28' })), /CRM_POST_BOOKING_INVALID_INPUT/);
    const atomicSnapshot = `SELECT jsonb_build_object('sale',(SELECT to_jsonb(s) FROM public.sales s WHERE id='${deal.saleId}'),
      'events',(SELECT jsonb_agg(to_jsonb(e)) FROM sales_private.post_booking_events e WHERE sale_id='${deal.saleId}'),
      'audits',(SELECT count(*) FROM public.crm_audit_events),'receipts',(SELECT count(*) FROM sales_private.post_booking_command_requests),
      'permits',(SELECT count(*) FROM sales_private.post_booking_external_write_permits)+(SELECT count(*) FROM sales_private.post_booking_write_permits)+(SELECT count(*) FROM sales_private.booking_write_permits));`;
    const atomicBefore = await query(atomicSnapshot);
    await deny('late audit failure rolls back imported handover atomically', request(command({ ...value, reason: 'SYNTHETIC HANDOVER ROLLBACK' })), /SYNTHETIC_HANDOVER_AUDIT_FAILURE/);
    check(atomicBefore === await query(atomicSnapshot), 'failed handover leaves sale event audit receipt and all permits unchanged');
    const receipt = await save(value), replay = await save(value);
    check(receipt.stage === 'handover' && receipt.handoverDate === day && receipt.transferDate === null && replay.replayed && replay.eventId === receipt.eventId, 'handover and replay preserve one day-only event');
    const complete = await snapshot(deal);
    check(complete.sale.handoverDate === day && complete.sale.transferDate === null && !complete.sale.canEdit
      && complete.events[0].occurredAt === null && complete.events[0].handoverDate === day, 'handover snapshot has no fabricated transfer/occurrence timestamps');
    await deny('a fresh request cannot record handover twice', request(command({ ...value, requestId: randomUUID(), expectedSaleRevision: complete.sale.revision })), /CRM_POST_BOOKING_CONFLICT/);
    await deny('ordinary booking permit cannot overwrite handover day', `BEGIN; INSERT INTO sales_private.booking_write_permits VALUES(txid_current(),pg_backend_pid());
      UPDATE public.sales SET crm_handover_date=crm_handover_date+1 WHERE id='${deal.saleId}'; ROLLBACK;`, /CRM_POST_BOOKING_FORBIDDEN/);
  }
  await deny('browser cannot mint exact imported write permit', request('INSERT INTO sales_private.post_booking_external_write_permits VALUES(txid_current(),pg_backend_pid(),auth.uid(),\'{}\',\'{}\');'), /permission denied/);
  await query('BEGIN; GRANT SELECT,UPDATE ON public.sales TO authenticated; CREATE POLICY synthetic_historical_broad_select ON public.sales FOR SELECT TO authenticated USING(true); CREATE POLICY synthetic_historical_broad_update ON public.sales FOR UPDATE TO authenticated USING(true) WITH CHECK(true); COMMIT;');
  await deny('broad legacy grant cannot change sealed price', request(`UPDATE public.sales SET sale_price=1 WHERE id='${deals[0].saleId}';`), /CRM_BOOKING_FORBIDDEN|EXTERNAL_CUTOVER_SALES_SEALED/);
  check(await query(request("SELECT public.crm_v2_sales_report('SYNTHETIC HISTORICAL DEALS')#>>'{totals,transferred}';", actor, true)) === (prepareRentalRetirements?'3':'2'), 'read-only report includes unknown-round historical transferred and handed-over deals');
  const after = await query(`SELECT jsonb_build_object('customers',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.sales_customers c WHERE external_snapshot_batch_id='${batch}'),
    'interests',(SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM public.lead_project_interests i WHERE project_name='SYNTHETIC HISTORICAL DEALS'),
    'sources',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM crm_external_private.prepared_booking_sales p),'receipts',(SELECT jsonb_agg(to_jsonb(r)) FROM crm_external_private.sales_cutover_receipts r));`);
  check(before === after, 'all historical customer/cohort/interest/source snapshots remain byte-for-byte unchanged');
  check(await query('SELECT NOT EXISTS(SELECT 1 FROM sales_private.post_booking_external_write_permits) AND NOT EXISTS(SELECT 1 FROM sales_private.booking_write_permits) AND NOT EXISTS(SELECT 1 FROM sales_private.post_booking_write_permits);') === 't', 'successful and failed commands leave no reusable permits');
  return { cases, assertions: cases.length, syntheticOnly: true, actualFunctionBodies: true, fullExternalDeploymentTested: false, realDatabaseTested: false };
}
