// Disposable owned loopback PostgreSQL only. No live database, credentials, import or deployment.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { assertPlainSql } from './safety.mjs';
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const json = value => `${quote(JSON.stringify(value))}::jsonb`;
const parse = output => JSON.parse(output.split(/\r?\n/).find(line => line.startsWith('{')) ?? '{}');
const sales = 'dd230000-0000-4000-8000-000000000001';
const other = 'dd230000-0000-4000-8000-000000000002';
const admin = 'dd230000-0000-4000-8000-000000000003';
const owner = 'dd230000-0000-4000-8000-000000000004';
const projectName = 'SYNTHETIC CANONICAL RENTAL';
const session = (sql, actor = sales, readonly = false, app = '') => `BEGIN${readonly ? ' READ ONLY' : ''};
 ${app ? `SET LOCAL application_name=${quote(app)};` : ''} SET LOCAL ROLE authenticated;
 SET LOCAL "request.jwt.claim.sub"=${quote(actor)}; ${sql} COMMIT;`;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function runRentalLifecycle({ query, root, report, parseSnapshot, parseInput, parseResult, parseProjectPage }) {
 assert.equal(await query("SELECT current_database() ~ '^buildtrack_sales_runtime_[a-f0-9]+$' AND current_setting('buildtrack.synthetic_runtime',true)='on' AND inet_server_addr()='127.0.0.1'::inet;"), 't');
 const cases = [], groups = [];
 const check = (condition, label) => { assert.ok(condition, label); cases.push(label); };
 const deny = async (label, sql, pattern) => { await assert.rejects(query(sql), pattern); cases.push(label); };
 const path = 'sql/sales/23_rental_lifecycle_draft.sql';
 const draft = readFileSync(join(root, path), 'utf8'); assertPlainSql(draft);
 report.sources[path] = createHash('sha256').update(draft).digest('hex');
 report.sources['scripts/sales-runtime/rental-lifecycle.mjs'] = createHash('sha256').update(readFileSync(join(root, 'scripts/sales-runtime/rental-lifecycle.mjs'))).digest('hex');
 const wrapper = /\bBEGIN;\s*DO \$draft_only\$\s*BEGIN\s*RAISE EXCEPTION 'DESIGN ONLY: [^'\r\n]+';\s*END;\s*\$draft_only\$;/g;
 assert.equal([...draft.matchAll(wrapper)].length, 1); assert.match(draft, /\bROLLBACK;\s*$/);
 const compiled = draft.replace(wrapper, 'BEGIN;').replace(/\bROLLBACK;\s*$/, 'COMMIT;');
 // Typed legacy occupancy fixture only; no imported people, payment assumptions or production policies.
 assert.equal(await query("SELECT to_regclass('public.rental_contracts') IS NULL;"), 't');
 await query('CREATE TABLE public.rental_contracts(id uuid PRIMARY KEY,plot_id varchar,status varchar);');
 const lifecycleOriginal = await query("SELECT pg_get_functiondef('public.crm_v2_change_lead_lifecycle(uuid,jsonb)'::regprocedure);");
 await query(`BEGIN; ${lifecycleOriginal.replace('DECLARE', '-- SYNTHETIC ALTERED SOURCE\nDECLARE')}; COMMIT;`);
 await deny('unknown original lifecycle body refuses entire rental installation', compiled, /CRM_RENTAL_LIFECYCLE_REVIEW_REQUIRED/);
 check(await query("SELECT to_regclass('sales_private.rental_contracts') IS NULL;" ) === 't', 'failed lifecycle review rolls back all new tables and guards');
 await query(`BEGIN; ${lifecycleOriginal}; COMMIT;`);
 await query(compiled);
 await query(`INSERT INTO auth.users(id) VALUES('${sales}'),('${other}'),('${admin}'),('${owner}');
 INSERT INTO sales_private.crm_user_roles(user_id,role,display_name,is_active) VALUES
 ('${sales}','sales','SYNTHETIC RENTAL SALES',true),('${other}','sales','SYNTHETIC OTHER SALES',true),
 ('${admin}','admin','SYNTHETIC RENTAL ADMIN',true),('${owner}','owner','SYNTHETIC RENTAL OWNER',true);
 INSERT INTO public.projects(name,is_closed) VALUES(${quote(projectName)},false);
 INSERT INTO public.plots(id,project_name,has_customer,sale_status) SELECT 'SYNTHETIC-RENTAL-'||n,${quote(projectName)},false,'available' FROM generate_series(1,70) n;
 INSERT INTO public.rental_contracts(id,plot_id,status) VALUES('${randomUUID()}','SYNTHETIC-RENTAL-69','Active '),('${randomUUID()}','SYNTHETIC-RENTAL-70','MovedOut');
 UPDATE public.crm_settings SET rental_enabled=true WHERE id;`);
 const legacyBefore = await query("SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.rental_contracts r;");
 let counter = 0;
 const state = async (customerId, contractId = null, actor = sales, pages = {}) => {
  const scope = { customerId, projectName, contractId, contractPage: 0, eventPage: 0, paymentPage: 0, plotPage: 0, ...pages };
  const value = parse(await query(session(`SELECT public.crm_v2_rental_context('${customerId}',${quote(projectName)},${contractId ? quote(contractId) : 'NULL'},${scope.contractPage},${scope.eventPage},${scope.paymentPage},${scope.plotPage});`, actor, true)));
  return parseSnapshot(value, scope);
 };
 const fresh = async () => {
  counter++;
  const response = parse(await query(session(`SELECT public.crm_v2_create_customer('${randomUUID()}',${json({ name: `SYNTHETIC Rental Customer ${counter}`, phone: `090230${String(counter).padStart(4, '0')}`, channel: 'phone', notes: 'SYNTHETIC ONLY', interests: [{ projectName, plotId: null }] })});`)));
  return state(response.customerId);
 };
 const input = (snapshot, fields) => parseInput({ requestId: randomUUID(), command: 'start', customerId: snapshot.customer.id,
  interestId: snapshot.interest.id, projectName, expectedCustomerRevision: snapshot.customer.revision, expectedInterestRevision: snapshot.interest.revision,
  contractId: snapshot.selectedContract?.id ?? null, expectedContractRevision: snapshot.selectedContract?.revision ?? null,
  reason: 'SYNTHETIC reviewed rental command', ...fields });
 const start = (s, programType = 'program_a', plotId = `SYNTHETIC-RENTAL-${counter}`) => input(s, { plotId, programType,
  startDate: '2026-01-31', durationMonths: 12, monthlyRentSatang: 1200000, securityDepositSatang: 2400000,
  advanceRentSatang: 1200000, savingsPerMonthSatang: programType === 'program_b' ? 500000 : 0,
  basePriceSatang: programType === 'program_c' ? 200000000 : null });
 const sqlCommand = value => { const { requestId, ...payload } = value; return `SELECT public.crm_v2_rental_command('${requestId}',${json(payload)});`; };
 const command = async (value, actor = sales) => parseResult(parse(await query(session(sqlCommand(value), actor))), value);
 const sourceBefore = await query("SELECT md5(COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.id)::text,'')) FROM public.sales s;");
 const sourceSaleIds = JSON.parse(await query("SELECT COALESCE(jsonb_agg(id),'[]'::jsonb) FROM public.sales;"));
 let a = await fresh(); const aOriginal = await query(`SELECT to_jsonb(c)-ARRAY['lifecycle_revision','updated_at'] FROM public.sales_customers c WHERE id='${a.customer.id}';`);
 const first = start(a); const result = await command(first); a = await state(a.customer.id, result.contractId);
 check(a.selectedContract.status === 'active' && a.selectedContract.endDate === '2027-01-30', 'new A rental has inclusive calendar end and known actual dates');
 check(a.selectedContract.confirmedSavingsSatang === 0 && a.selectedContract.confirmedDepositSatang === 0 && a.payments.length === 0, 'contract quoted amounts never fabricate received payments');
 check(a.plots.find(p => p.id === first.plotId)?.available === false && a.plotsHasMore && a.plots.length === 50, 'active canonical rental occupies plot and available plots use bounded page');
 check((await state(a.customer.id, result.contractId, sales, { plotPage: 1 })).plots.length === 20, 'plot pagination reads second page without first-page truncation');
 check(await query(`SELECT NOT EXISTS(SELECT 1 FROM public.leads WHERE id='${a.customer.id}') AND NOT EXISTS(SELECT 1 FROM public.sales WHERE project_interest_id='${a.interest.id}');`) === 't', 'rent start creates no synthetic native Lead or sale');
 check(await query(`SELECT to_jsonb(c)-ARRAY['lifecycle_revision','updated_at'] FROM public.sales_customers c WHERE id='${a.customer.id}';`) === aOriginal, 'customer source dates/profile/stage remain byte-identical');
 check((await command(first)).replayed, 'same exact start payload returns original committed receipt before revision check');
 await deny('changed payload cannot reuse request ID', session(sqlCommand({ ...first, reason: 'SYNTHETIC changed reason' })), /CRM_RENTAL_IDEMPOTENCY_CONFLICT/);
 await deny('other Sales cannot mutate rental', session(sqlCommand(input(a, { command: 'renew', renewalMonths: 1, monthlyRentSatang: 1000000 })), other), /CRM_RENTAL_FORBIDDEN/);
 check(!(await state(a.customer.id, result.contractId, other)).interest.canEdit, 'other Sales read remains authorized but editor is false');
 check(!(await state(a.customer.id, result.contractId, owner)).interest.canEdit, 'Owner read only context remains authorized');
 await deny('Owner command cannot write', session(sqlCommand(input(a, { command: 'renew', renewalMonths: 1, monthlyRentSatang: 1000000 })), owner), /CRM_RENTAL_FORBIDDEN/);
 await deny('private rental tables deny caller direct writes', session(`UPDATE sales_private.rental_contracts SET status='ended' WHERE id='${result.contractId}';`), /permission denied/);
 for (const table of ['rental_events','rental_payments','rental_requests','rental_permits'])
  await deny(`browser cannot read private ${table}`, session(`SELECT * FROM sales_private.${table};`), /permission denied/);
 await deny('anonymous context execution is revoked', `BEGIN; SET LOCAL ROLE anon; SELECT public.crm_v2_rental_context('${a.customer.id}',${quote(projectName)}); COMMIT;`, /permission denied/);
 await deny('even privileged mutation without exact transaction permit fails', `UPDATE sales_private.rental_contracts SET monthly_rent_satang=1 WHERE id='${result.contractId}';`, /CRM_RENTAL_FORBIDDEN/);
 await deny('active rental plot cannot be released by legacy writer', `UPDATE public.plots SET has_customer=false WHERE id=${quote(first.plotId)};`, /CRM_RENTAL_CONFLICT/);
 await deny('legacy rental cannot overlap active canonical contract', `INSERT INTO public.rental_contracts VALUES('${randomUUID()}',${quote(first.plotId)},'Active');`, /CRM_RENTAL_CONFLICT/);
 const loser = await fresh(); const loserStart = start(loser, 'program_a', first.plotId);
 await deny('second canonical contract cannot claim occupied plot', session(sqlCommand(loserStart)), /CRM_RENTAL_CONFLICT/);
 await deny('malformed legacy nonterminal status remains occupied even with vacant flag', session(sqlCommand(start(loser, 'program_a', 'SYNTHETIC-RENTAL-69'))), /CRM_RENTAL_CONFLICT/);
 const bookingPayload = { command: 'book', reason: 'SYNTHETIC deny active rental', customerId: loser.customer.id, newCustomer: null,
  projectName, expectedInterestRevision: loser.interest.revision, plotId: first.plotId, paymentMethod: 'cash', bookingRoute: 'without_visit', visitId: null,
  listPriceSatang: 100000000, discountSatang: 0, depositSatang: 1000000, previousSaleId: null };
 await deny('existing booking RPC cannot overlap active rental', session(`SELECT public.crm_v2_booking_command('${randomUUID()}',${json(bookingPayload)});`), /CRM_BOOKING_PLOT_UNAVAILABLE/);
 await deny('existing booking RPC cannot bypass occupied legacy lease through false vacant flag', session(`SELECT public.crm_v2_booking_command('${randomUUID()}',${json({ ...bookingPayload, plotId: 'SYNTHETIC-RENTAL-69' })});`), /CRM_RENTAL_CONFLICT/);
 // Explicitly ended legacy contracts do not reserve a plot forever.
 const endedLegacyBooking = parse(await query(session(`SELECT public.crm_v2_booking_command('${randomUUID()}',${json({ ...bookingPayload, plotId: 'SYNTHETIC-RENTAL-70' })});`)));
 check(endedLegacyBooking.saleId != null, 'terminal legacy rental permits an actual new booking');
 const lifecycle = async (s, interestId = s.interest.id) => ({ command: 'close_lost', customerId: s.customer.id, interestId,
  expectedRevision: interestId ? s.interest.revision : s.customer.revision,
  expectedActionId: (await query(`SELECT id FROM public.crm_next_actions WHERE customer_id='${s.customer.id}' AND project_interest_id IS NOT DISTINCT FROM ${interestId ? quote(interestId)+'::uuid' : 'NULL::uuid'} AND status='open';`)) || null,
  reason: 'SYNTHETIC must not lose rental history' });
 const lostSql = value => `SELECT public.crm_v2_change_lead_lifecycle('${randomUUID()}',${json(value)});`;
 const lifecycleContext = parse(await query(session(`SELECT public.crm_v2_lead_lifecycle_context('${a.customer.id}','${a.interest.id}');`, sales, true)));
 check(lifecycleContext.blockers.hasBookingHistory && !lifecycleContext.canClose, 'Lost review context includes active canonical rental history');
 await deny('Lost write cannot erase active rental history', session(lostSql(await lifecycle(a))), /CRM_LIFECYCLE_BOOKING_HISTORY_EXISTS/);
 await deny('savings evidence is invalid for Program A', session(sqlCommand(input(a, { command: 'record_payment', kind: 'savings', amountSatang: 500000, paidDate: '2026-02-01', reference: 'A-SAVINGS', evidenceNote: 'SYNTHETIC wrong program' }))), /CRM_RENTAL_INVALID_INPUT/);
 const payA = input(a, { command: 'record_payment', kind: 'security_deposit', amountSatang: 2400000, paidDate: '2026-02-01', reference: 'A-DEPOSIT-1', evidenceNote: 'SYNTHETIC manually confirmed cash evidence' });
 await command(payA); a = await state(a.customer.id, result.contractId);
 check(a.selectedContract.confirmedDepositSatang === 2400000 && a.payments.length === 1, 'actual immutable security deposit evidence is summed separately');
 await deny('duplicate reference rejects distinct request IDs', session(sqlCommand(input(a, { ...payA, requestId: randomUUID(), expectedInterestRevision: a.interest.revision, expectedContractRevision: a.selectedContract.revision }))), /CRM_RENTAL_CONFLICT/);
 await deny('future payment date rejected', session(sqlCommand(input(a, { command: 'record_payment', kind: 'rent', amountSatang: 1000, paidDate: '2099-01-01', reference: 'FUTURE', evidenceNote: 'SYNTHETIC' }))), /CRM_RENTAL_INVALID_INPUT/);
 await deny('payment before actual lease start rejected', session(sqlCommand(input(a, { command: 'record_payment', kind: 'rent', amountSatang: 1000, paidDate: '2025-01-01', reference: 'BEFORE', evidenceNote: 'SYNTHETIC' }))), /CRM_RENTAL_INVALID_INPUT/);
 const renew = input(a, { command: 'renew', renewalMonths: 1, monthlyRentSatang: 1300000 }); await command(renew); a = await state(a.customer.id, result.contractId);
 check(a.selectedContract.status === 'renewed' && a.selectedContract.endDate === '2027-02-28' && a.selectedContract.startDate === '2026-01-31', 'renew clamps calendar end while preserving original start and deposit evidence');
 await deny('stale renewal cannot overwrite new terms', session(sqlCommand({ ...renew, requestId: randomUUID() })), /CRM_RENTAL_STALE_STATE/);
 const end = input(a, { command: 'end', endDate: '2026-10-01' }); await command(end); a = await state(a.customer.id, result.contractId);
 check(a.selectedContract.status === 'ended' && a.selectedContract.endedDate === '2026-10-01' && a.selectedContract.confirmedDepositSatang === 2400000, 'end records real civil date and retains deposit evidence without refund claim');
 check(await query(`SELECT has_customer IS FALSE FROM public.plots WHERE id=${quote(first.plotId)};`) === 't', 'end releases exact rental plot');
 await deny('Lost write still blocks ended rental history', session(lostSql(await lifecycle(a))), /CRM_LIFECYCLE_BOOKING_HISTORY_EXISTS/);
 check(!parse(await query(session(`SELECT public.crm_v2_lead_lifecycle_context('${a.customer.id}','${a.interest.id}');`, sales, true))).canClose, 'ended rental stays protected from prebooking Lost');
 await deny('ended rental does not accept new payment/renewal', session(sqlCommand(input(a, { command: 'renew', renewalMonths: 1, monthlyRentSatang: 1300000 }))), /CRM_RENTAL_CONFLICT/);
 let b = await fresh(); const bStart = start(b, 'program_b'); const bResult = await command(bStart); b = await state(b.customer.id, bResult.contractId);
 check(b.selectedContract.confirmedSavingsSatang === 0, 'B elapsed months and quoted rate produce no received savings');
 await command(input(b, { command: 'record_payment', kind: 'savings', amountSatang: 500000, paidDate: '2026-02-01', reference: 'B-SAVINGS-1', evidenceNote: 'SYNTHETIC confirmed savings payment' })); b = await state(b.customer.id, bResult.contractId);
 check(b.selectedContract.confirmedSavingsSatang === 500000 && b.selectedContract.confirmedDepositSatang === 0, 'B sums only actual savings evidence and never treats it as deposit');
 const conversion = input(b, { command: 'convert_to_buy', purchaseDate: '2026-10-01', paymentMethod: 'mortgage',
  listPriceSatang: 200000000, discountSatang: 0, depositSatang: 0, bookingRoute: 'without_visit', visitId: null });
 await deny('bad conversion quotation rolls occupancy and rental back', session(sqlCommand({ ...conversion, requestId: randomUUID(), discountSatang: 200000001 })), /CRM_RENTAL_INVALID_INPUT/);
 b = await state(b.customer.id, bResult.contractId); check(b.selectedContract.status === 'active' && await query(`SELECT has_customer FROM public.plots WHERE id=${quote(bStart.plotId)};`) === 't', 'failed book preserves active rental and occupied plot');
 const bought = await command(conversion); b = await state(b.customer.id, bResult.contractId);
 check(b.selectedContract.status === 'converted' && b.selectedContract.convertedSaleId === bought.saleId && bought.saleId !== null, 'conversion creates actual linked canonical booking and rental ends atomically');
 const sale = parse(await query(`SELECT jsonb_build_object('stage',crm_stage,'nativeLeadId',lead_id,'price',sale_price,'deposit',booking_amount,'transferDate',crm_transfer_date,'handoverDate',crm_handover_date) FROM public.sales WHERE id='${bought.saleId}';`));
 check(sale.stage === 'booked' && sale.nativeLeadId === null && sale.price === 2000000 && sale.deposit === 0 && sale.transferDate === null && sale.handoverDate === null, 'B conversion does not subtract inferred credit/double deposit or fabricate transfer/handover');
 check(b.selectedContract.confirmedSavingsSatang === 500000 && (await command(conversion)).replayed, 'conversion entitlement evidence remains immutable and original retry returns same sale');
 let c = await fresh(); const cStart = start(c, 'program_c'); const cResult = await command(cStart); c = await state(c.customer.id, cResult.contractId);
 const cConversion = input(c, { command: 'convert_to_buy', purchaseDate: '2026-10-01', paymentMethod: 'cash', listPriceSatang: 200000000,
  discountSatang: 0, depositSatang: 0, bookingRoute: 'without_visit', visitId: null });
 const cBought = await command(cConversion);
 check(await query(`SELECT sale_price=2000000 AND crm_stage='booked' FROM public.sales WHERE id='${cBought.saleId}';`) === 't', 'C conversion does not auto award transfer-dependent 10/5 percent discount');
 check(await query(`SELECT NOT EXISTS(SELECT 1 FROM sales_private.rental_permits);`) === 't', 'no reusable permit remains after successful lifecycle commands');
 // An immutable final audit failure must revert payment, contract, interest and receipt together.
 let rollback = await fresh(); const rollbackResult = await command(start(rollback, 'program_b')); rollback = await state(rollback.customer.id, rollbackResult.contractId);
 const rollbackInput = input(rollback, { command: 'record_payment', kind: 'savings', amountSatang: 500000, paidDate: '2026-02-01', reference: 'ROLLBACK-PAYMENT', evidenceNote: 'SYNTHETIC' });
 const beforeRollback = await state(rollback.customer.id, rollbackResult.contractId);
 await query(`CREATE FUNCTION sales_private.synthetic_rental_audit_failure() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN IF NEW.entity_type='rental' AND NEW.event_type='record_payment' THEN RAISE EXCEPTION 'SYNTHETIC RENTAL AUDIT FAILURE'; END IF; RETURN NEW; END; $$;
 CREATE TRIGGER synthetic_rental_audit_failure BEFORE INSERT ON public.crm_audit_events FOR EACH ROW EXECUTE FUNCTION sales_private.synthetic_rental_audit_failure();`);
 await deny('late audit failure aborts all lifecycle/evidence/receipt writes', session(sqlCommand(rollbackInput)), /SYNTHETIC RENTAL AUDIT FAILURE/);
 await query('DROP TRIGGER synthetic_rental_audit_failure ON public.crm_audit_events; DROP FUNCTION sales_private.synthetic_rental_audit_failure();');
 check(JSON.stringify(await state(rollback.customer.id, rollbackResult.contractId)) === JSON.stringify(beforeRollback), 'late failure preserves exact rental snapshot and revisions');
 check(await query(`SELECT NOT EXISTS(SELECT 1 FROM sales_private.rental_requests WHERE request_id='${rollbackInput.requestId}') AND NOT EXISTS(SELECT 1 FROM sales_private.rental_permits);`) === 't', 'late failure leaves no successful receipt or permit');
 // True independent-session concurrency: one version wins, exact retries replay.
 let race = await fresh(); const raceStart = start(race, 'program_b'); const same = await Promise.all([command(raceStart), command(raceStart)]);
 check(same.filter(x => x.replayed).length === 1 && same[0].contractId === same[1].contractId, 'same concurrent request produces one contract and one replay'); groups.push('same-request start');
 race = await state(race.customer.id, same[0].contractId);
 const r1 = input(race, { command: 'renew', renewalMonths: 1, monthlyRentSatang: 1400000 });
 const r2 = { ...r1, requestId: randomUUID(), monthlyRentSatang: 1500000 };
 const versions = await Promise.allSettled([command(r1), command(r2)]);
 check(versions.filter(x => x.status === 'fulfilled').length === 1 && versions.some(x => x.status === 'rejected' && /CRM_RENTAL_STALE_STATE/.test(x.reason.message)), 'distinct concurrent revisions cannot overwrite each other'); groups.push('different-request revision');
 await query(`UPDATE sales_private.crm_user_roles SET is_active=false WHERE user_id='${sales}';`);
 await deny('deactivated actor cannot replay old committed command', session(sqlCommand(raceStart)), /CRM_RENTAL_FORBIDDEN/);
 await query(`UPDATE sales_private.crm_user_roles SET is_active=true WHERE user_id='${sales}';`);
 // Aggregate sums, not just each individual entry, must remain safely parseable.
 let overflow = await fresh(); const overflowResult = await command(start(overflow, 'program_b')); overflow = await state(overflow.customer.id, overflowResult.contractId);
 await command(input(overflow, { command: 'record_payment', kind: 'savings', amountSatang: 99999999999, paidDate: '2026-02-01', reference: 'MAXIMUM-SAVINGS', evidenceNote: 'SYNTHETIC numerical boundary only' }));
 overflow = await state(overflow.customer.id, overflowResult.contractId);
 check(overflow.selectedContract.confirmedSavingsSatang === 99999999999, 'maximum immutable evidence sum remains safe exact integer satang');
 await deny('separate valid entry cannot overflow aggregate confirmed savings', session(sqlCommand(input(overflow, { command: 'record_payment', kind: 'savings', amountSatang: 1, paidDate: '2026-02-02', reference: 'OVERFLOW-SAVINGS', evidenceNote: 'SYNTHETIC numerical boundary only' }))), /CRM_RENTAL_CONFLICT/);
 check((await state(overflow.customer.id, overflowResult.contractId)).selectedContract.confirmedSavingsSatang === 99999999999, 'overflow rejection preserves earlier immutable evidence');
 // Wait behind global booking lock, deactivate actor before releasing it.
 race = await state(race.customer.id, same[0].contractId); const queued = input(race, { command: 'renew', renewalMonths: 1, monthlyRentSatang: 1600000 });
 const blocker = query(`BEGIN; SET LOCAL application_name='SYNTHETIC-RENTAL-BLOCK'; SELECT pg_advisory_xact_lock(hashtextextended('crm-booking-command',0)); SELECT pg_sleep(2); UPDATE sales_private.crm_user_roles SET is_active=false WHERE user_id='${sales}'; COMMIT;`);
 let observed = false;
 for (let n = 0; n < 8; n++) {
  if (await query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='SYNTHETIC-RENTAL-BLOCK' AND wait_event='PgSleep');") === 't') { observed = true; break; }
  await delay(25);
 }
 assert.ok(observed, 'owned blocker must actually hold shared command lock');
 const waiting = assert.rejects(query(session(sqlCommand(queued), sales, false, 'SYNTHETIC-RENTAL-WAIT')), /CRM_RENTAL_FORBIDDEN/);
 observed = false;
 for (let n = 0; n < 8; n++) {
  if (await query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='SYNTHETIC-RENTAL-WAIT' AND wait_event_type='Lock');") === 't') { observed = true; break; }
  await delay(25);
 }
 check(observed, 'independent queued command is observed waiting on database lock');
 await blocker; await waiting; cases.push('queued command rechecks actor activation after waiting');
 await query(`UPDATE sales_private.crm_user_roles SET is_active=true WHERE user_id='${sales}';`); groups.push('role deactivated while waiting');
 check(await query(`SELECT NOT EXISTS(SELECT 1 FROM sales_private.rental_permits);`) === 't', 'all concurrent denied/replayed commands leave no permit');
 await query('UPDATE public.crm_settings SET rental_enabled=false WHERE id;');
 check(parse(await query(session('SELECT public.crm_v2_rental_capabilities();', sales, true))).enabled === false, 'rental feature remains fail closed when database flag is disabled');
 await deny('disabled rental flag rejects mutation and replay', session(sqlCommand(raceStart)), /CRM_RENTAL_SETUP_REQUIRED/);
 await query('UPDATE public.crm_settings SET rental_enabled=true WHERE id;');
 // Actual start/end commands, never forged write permits, supply 51 history rows
 // so the project-map reader proves a full first page and a disjoint next page.
 assert.equal(typeof parseProjectPage, 'function', 'project RPC must use the actual TypeScript page parser');
 let history = await fresh();
 const needed = 51 - Number(await query(`SELECT count(*) FROM sales_private.rental_contracts WHERE project_name=${quote(projectName)};`));
 for (let n = 0; n < needed; n++) {
  const started = await command(start({ ...history, selectedContract: null }, 'program_a', 'SYNTHETIC-RENTAL-68'));
  history = await state(history.customer.id, started.contractId);
  await command(input(history, { command: 'end', endDate: '2026-10-01' }));
  history = await state(history.customer.id);
 }
 const projectSql = (project = projectName, page = 0) => `SELECT public.crm_v2_rental_project_context(${project === null ? 'NULL' : quote(project)},${page === null ? 'NULL' : page});`;
 const projectPage = async (page = 0, actor = sales, project = projectName) => parseProjectPage(
  parse(await query(session(projectSql(project, page), actor, true))), { projectName: project, page });
 const immutableState = `SELECT jsonb_build_object('contracts',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM sales_private.rental_contracts r),
  'events',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM sales_private.rental_events e),
  'payments',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM sales_private.rental_payments p),
  'receipts',(SELECT jsonb_agg(to_jsonb(q) ORDER BY actor_user_id,request_id) FROM sales_private.rental_requests q),
  'permits',(SELECT count(*) FROM sales_private.rental_permits));`;
 const beforeProjection = await query(immutableState), p0 = await projectPage(), p1 = await projectPage(1);
 check(p0.rows.length === 50 && p0.hasMore && p1.rows.length === 1 && !p1.hasMore, 'project Map projection reads all51 actual canonical contracts over bounded disjoint pages');
 check(p0.snapshotRevision === p1.snapshotRevision && /^[a-f0-9]{32}$/.test(p0.snapshotRevision), 'all project pages share a lowercase collection fingerprint');
 check(new Set([...p0.rows, ...p1.rows].map(x => x.contractId)).size === 51, 'project pages contain no duplicate or missing contract identities');
 const orderedIds = JSON.parse(await query(`SELECT jsonb_agg(id ORDER BY created_at DESC,id DESC) FROM sales_private.rental_contracts WHERE project_name=${quote(projectName)};`));
 check(JSON.stringify([...p0.rows, ...p1.rows].map(x => x.contractId)) === JSON.stringify(orderedIds), 'project projection matches actual created-time and identity ordering');
 check([...p0.rows, ...p1.rows].some(x => x.status === 'converted' && x.convertedSaleId !== null && x.endedDate !== null)
  && [...p0.rows, ...p1.rows].some(x => x.status === 'ended' && x.endedDate !== null), 'Map history retains actual conversion and ended civil dates without native Lead dependency');
 for (const [actor, role] of [[other, 'sales'], [owner, 'owner'], [admin, 'admin']]) {
  const reader = await projectPage(0, actor);
  check(reader.actor.userId === actor && reader.actor.role === role && reader.snapshotRevision === p0.snapshotRevision
   && JSON.stringify(reader.rows) === JSON.stringify(p0.rows), `trusted ${role} actor ${actor} sees identical authorized team project rows`);
 }
 check((await projectPage(2)).rows.length === 0 && !(await projectPage(2)).hasMore, 'valid page beyond current history returns an empty complete page');
 for (const [label, project, page] of [['negative page', projectName, -1], ['page beyond99', projectName, 100], ['null page', projectName, null],
  ['blank project', '', 0], ['null project', null, 0], ['project control character', `${projectName}\n`, 0]])
  await deny(`project reader rejects ${label}`, session(projectSql(project, page), sales, true), /CRM_RENTAL_INVALID_INPUT/);
 await deny('project reader never guesses a missing project', session(projectSql('SYNTHETIC NONEXISTENT RENTAL', 0), sales, true), /CRM_RENTAL_NOT_FOUND/);
 await query("INSERT INTO public.projects(name,is_closed) VALUES('SYNTHETIC RENTAL EMPTY-PROJECTION',false);");
 const emptyProject = await projectPage(0, sales, 'SYNTHETIC RENTAL EMPTY-PROJECTION');
 check(emptyProject.rows.length === 0 && !emptyProject.hasMore && /^[a-f0-9]{32}$/.test(emptyProject.snapshotRevision), 'different existing project returns only its own empty collection');
 await deny('anonymous project RPC execute is revoked', `BEGIN READ ONLY; SET LOCAL ROLE anon; ${projectSql()} COMMIT;`, /permission denied/);
 check(await query("SELECT NOT has_function_privilege('anon','public.crm_v2_rental_project_context(text,integer)','EXECUTE') AND has_function_privilege('authenticated','public.crm_v2_rental_project_context(text,integer)','EXECUTE');") === 't', 'project projection grants only authenticated execution with inner role authorization');
 await query('UPDATE public.crm_settings SET rental_enabled=false WHERE id;');
 await deny('project projection fails closed while rental capability is disabled', session(projectSql(), sales, true), /CRM_RENTAL_SETUP_REQUIRED/);
 await query('UPDATE public.crm_settings SET rental_enabled=true WHERE id;');
 await query(`UPDATE sales_private.crm_user_roles SET is_active=false WHERE user_id='${other}';`);
 await deny('inactive Sales cannot read project history', session(projectSql(), other, true), /CRM_RENTAL_FORBIDDEN/);
 await query(`UPDATE sales_private.crm_user_roles SET is_active=true WHERE user_id='${other}';`);
 await query(`UPDATE public.projects SET is_closed=true WHERE name=${quote(projectName)};`);
 check((await projectPage()).snapshotRevision === p0.snapshotRevision, 'closed existing project history stays readable without enabling new business writes');
 await query(`UPDATE public.projects SET is_closed=false WHERE name=${quote(projectName)};`);
 check(await query(immutableState) === beforeProjection, 'all project reads and denied reads preserve exact contract payment event receipt evidence and permits');
 // A genuine new renewal changes the collection fingerprint across all pages.
 let changed = await state(rollback.customer.id, rollbackResult.contractId);
 await command(input(changed, { command: 'renew', renewalMonths: 1, monthlyRentSatang: changed.selectedContract.monthlyRentSatang }));
 const changed0 = await projectPage(), changed1 = await projectPage(1);
 check(changed0.snapshotRevision !== p0.snapshotRevision && changed0.snapshotRevision === changed1.snapshotRevision, 'real lifecycle revision changes project fingerprint consistently on every page');
 // Operational profile corrections, not raw source rewrites, affect Map and
 // Lead reader equally and invalidate a previously fetched project collection.
 const rawProfileBefore = await query(`SELECT to_jsonb(c) FROM public.sales_customers c WHERE id='${b.customer.id}';`);
 const detail = parse(await query(session(`SELECT public.crm_v2_customer_deal_details_context('${bought.saleId}',${quote(projectName)});`, sales, true)));
 const profilePayload = { command: 'update_details', customerId: b.customer.id, saleId: bought.saleId, projectName,
  expectedCustomerRevision: detail.customer.revision, expectedInterestRevision: detail.deal.interestRevision, expectedSaleRevision: detail.deal.revision,
  expectedCustomerDetailsRevision: detail.customer.detailsRevision, expectedDealDetailsRevision: detail.deal.detailsRevision,
  reason: 'SYNTHETIC current profile readthrough', profile: { name: 'SYNTHETIC CURRENT RENTAL PROFILE', phone: null, occupation: null }, dealDetails: null };
 await query(session(`SELECT public.crm_v2_customer_deal_details_command('${randomUUID()}',${json(profilePayload)});`));
 const profile0 = await projectPage(), profile1 = await projectPage(1), corrected = [...profile0.rows, ...profile1.rows].find(x => x.contractId === bResult.contractId);
 check(corrected.customerName === profilePayload.profile.name && corrected.customerPhone === null
  && profile0.snapshotRevision !== changed0.snapshotRevision && profile0.snapshotRevision === profile1.snapshotRevision,
  'effective profile correction changes Map name phone and full-project fingerprint across pages');
 check((await state(b.customer.id, bResult.contractId)).customer.name === corrected.customerName
  && await query(`SELECT to_jsonb(c) FROM public.sales_customers c WHERE id='${b.customer.id}';`) === rawProfileBefore,
  'Lead and Map share corrected profile while raw customer source remains byte-identical');
 check(sourceBefore === await query(`SELECT md5(COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.id)::text,'')) FROM public.sales s WHERE id IN(SELECT value::uuid FROM jsonb_array_elements_text(${json(sourceSaleIds)}));`) , 'all preexisting source sales remain byte-identical; only actual new bookings added');
 check(legacyBefore === await query("SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.rental_contracts r;"), 'legacy rental source evidence remains byte-identical');
 return { assertions: cases.length, cases, concurrencyGroups: groups, syntheticOnly: true, noRealDatabase: true,
  projectProjection: { syntheticContracts: 51, pageSize: 50, maxPages: 100, actualTypeScriptParity: true, noReadEvidenceWrites: true },
  sealedProbe: { customerId: rollback.customer.id, contractId: rollbackResult.contractId, projectName, actor: sales },
  financialBoundary: 'Actual evidence only; refund, payment correction and B/C transfer settlement remain separate reviewed steps.' };
}

// Optional composed guard boundary, after the runner installs its actual sealed
// historical fixture. It must fail closed, not grant a new source-write route.
export async function verifyRentalSealedCutover({ query, report, parseSnapshot, parseInput }) {
 assert.equal(await query("SELECT current_database() ~ '^buildtrack_sales_runtime_[a-f0-9]+$' AND current_setting('buildtrack.synthetic_runtime',true)='on' AND inet_server_addr()='127.0.0.1'::inet;"), 't');
 const fixture = report.results.rentalLifecycle.sealedProbe, scope = { customerId: fixture.customerId, projectName: fixture.projectName,
  contractId: fixture.contractId, contractPage: 0, eventPage: 0, paymentPage: 0, plotPage: 0 };
 assert.equal(await query("SELECT to_regprocedure('crm_external_private.guard_cutover_sale()') IS NOT NULL AND NOT sales_private.crm_booking_external_ready();"), 't');
 const snapshot = parseSnapshot(parse(await query(session(`SELECT public.crm_v2_rental_context('${scope.customerId}',${quote(scope.projectName)},'${scope.contractId}');`, fixture.actor, true))), scope);
 const input = parseInput({ requestId: randomUUID(), command: 'convert_to_buy', customerId: scope.customerId, interestId: snapshot.interest.id,
  projectName: scope.projectName, expectedCustomerRevision: snapshot.customer.revision, expectedInterestRevision: snapshot.interest.revision,
  contractId: scope.contractId, expectedContractRevision: snapshot.selectedContract.revision, reason: 'SYNTHETIC sealed cutover boundary',
  purchaseDate: '2026-10-01', paymentMethod: 'cash', listPriceSatang: 200000000, discountSatang: 0, depositSatang: 0, bookingRoute: 'without_visit', visitId: null });
 const atomicState = `SELECT jsonb_build_object('contract',(SELECT to_jsonb(r) FROM sales_private.rental_contracts r WHERE id='${scope.contractId}'),
  'interest',(SELECT to_jsonb(i) FROM public.lead_project_interests i WHERE id='${snapshot.interest.id}'),
  'plot',(SELECT to_jsonb(p) FROM public.plots p WHERE id=${quote(snapshot.selectedContract.plotId)}),
  'sales',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.sales s),'auditCount',(SELECT count(*) FROM public.crm_audit_events),
  'requestCount',(SELECT count(*) FROM sales_private.rental_requests),'eventCount',(SELECT count(*) FROM sales_private.rental_events),
  'paymentCount',(SELECT count(*) FROM sales_private.rental_payments),'permits',(SELECT count(*) FROM sales_private.rental_permits));`;
 const before = await query(atomicState), { requestId, ...payload } = input;
 await assert.rejects(query(session(`SELECT public.crm_v2_rental_command('${requestId}',${json(payload)});`, fixture.actor)), /CRM_RENTAL_SETUP_REQUIRED/);
 assert.equal(await query(atomicState), before);
 return { assertions: 3, cases: ['actual historical source seal requires separately reviewed external booking writer',
  'conversion refuses sealed cutover before any write', 'refused conversion preserves rental plot interest sale evidence audit receipts and permits'],
  syntheticOnly: true, actualGuardBodies: true, fullExternalWriterDeploymentTested: false };
}
