// Independent sessions in the runner-owned disposable loopback cluster only.
// No application credentials, existing database, remote API or deployment.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const sales = 'ca210000-0000-4000-8000-000000000002';
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const json = value => `${quote(JSON.stringify(value))}::jsonb`;
const parse = value => JSON.parse(value.split(/\r?\n/).find(line => line.startsWith('{')) ?? '{}');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const session = (body, app = '') => `BEGIN; ${app ? `SET LOCAL application_name=${quote(app)};` : ''}
 SET LOCAL ROLE authenticated; SET LOCAL "request.jwt.claim.sub"=${quote(sales)}; ${body} COMMIT;`;
const post = (payload, id = randomUUID()) => `SELECT public.crm_v2_post_booking_command('${id}',${json(payload)});`;
const booking = (payload, id = randomUUID()) => `SELECT public.crm_v2_booking_command('${id}',${json(payload)});`;

export async function runPostBookingConcurrency({ query }) {
  let assertions = 0, bookingNumber = 0;
  const groups = [];
  const check = (condition, label) => { assert.ok(condition, label); assertions++; };
  await query(`DO $guard$ BEGIN
    IF current_database() !~ '^buildtrack_sales_runtime_' OR current_setting('buildtrack.synthetic_runtime',true) IS DISTINCT FROM 'on'
      OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet THEN RAISE EXCEPTION 'SYNTHETIC ONLY'; END IF;
    END $guard$;
    INSERT INTO auth.users(id) VALUES('${sales}');
    INSERT INTO sales_private.crm_user_roles(user_id,role,display_name,is_active) VALUES('${sales}','sales','SYNTHETIC Post Booking Concurrency Sales',true);
    INSERT INTO public.projects(name,is_closed) VALUES('SYNTHETIC POST BOOKING CONCURRENCY',false);
    INSERT INTO public.plots(id,project_name,has_customer,sale_status)
      SELECT 'SYNTHETIC-PBC-'||n,'SYNTHETIC POST BOOKING CONCURRENCY',false,'available' FROM generate_series(1,9) n;
    INSERT INTO public.crm_settings(id,central_intake_enabled,lead_work_enabled,lead_lifecycle_enabled,booking_enabled,booking_cutover_reviewed,post_booking_enabled)
      VALUES(true,true,true,true,true,true,true) ON CONFLICT(id) DO UPDATE SET central_intake_enabled=true,lead_work_enabled=true,
      lead_lifecycle_enabled=true,booking_enabled=true,booking_cutover_reviewed=true,post_booking_enabled=true;`);

  async function fresh(paymentMethod = 'mortgage') {
    const n = ++bookingNumber;
    return parse(await query(session(booking({ command: 'book', reason: 'SYNTHETIC race booking', customerId: null,
      newCustomer: { name: `SYNTHETIC post race ${n}`, phone: `089211${String(n).padStart(4, '0')}`,
        channel: 'phone', notes: 'SYNTHETIC ONLY', assignedSalesUserId: null },
      projectName: 'SYNTHETIC POST BOOKING CONCURRENCY', expectedInterestRevision: null, plotId: `SYNTHETIC-PBC-${n}`,
      paymentMethod, bookingRoute: 'without_visit', visitId: null, listPriceSatang: 100000000,
      discountSatang: 0, depositSatang: 10000, previousSaleId: null }))));
  }
  async function payload(b, extra = { command: 'advance', nextStage: 'contracted' }) {
    const context = parse(await query(session(`SELECT jsonb_build_object('sale',public.crm_v2_post_booking_context('${b.saleId}')->'sale',
      'occurredAt',to_char(clock_timestamp(),'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));`)));
    return { ...extra, customerId: b.customerId, saleId: b.saleId, expectedSaleRevision: context.sale.revision,
      expectedInterestRevision: context.sale.interestRevision, reason: 'SYNTHETIC race stage reason',
      evidenceNote: 'SYNTHETIC STAFF DECLARATION', occurredAt: context.occurredAt };
  }
  async function prepareDocs(b) {
    await query(session(post(await payload(b))));
    await query(session(post(await payload(b, { command: 'advance', nextStage: 'document_prep' }))));
  }
  async function transferPayload(b) {
    const input = await payload(b, { command: 'confirm_transfer' });
    delete input.evidenceNote; delete input.occurredAt;
    input.transferDate = await query("SELECT ((clock_timestamp() AT TIME ZONE 'Asia/Bangkok')::date)::text;");
    return input;
  }
  async function prepareCashPending(b) {
    await query(session(post(await payload(b))));
    await query(session(post(await payload(b, { command: 'advance', nextStage: 'transfer_pending' }))));
  }
  const settled = promise => promise.then(value => ({ value }), error => ({ error }));
  async function waitState(app, condition) {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      if (await query(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${quote(app)} AND ${condition});`) === 't') return;
      await delay(40);
    }
    throw new Error(`Post-booking independent backend not observed: ${app}/${condition}`);
  }
  async function overlap(label, heldBody, waitingBody) {
    const token = randomUUID().slice(0, 8), heldApp = `post_hold_${token}`, waitingApp = `post_wait_${token}`;
    const holder = settled(query(session(`${heldBody} SELECT pg_sleep(4);`, heldApp)));
    let waiter;
    try {
      await waitState(heldApp, "wait_event='PgSleep'");
      waiter = settled(query(session(waitingBody, waitingApp)));
      await waitState(waitingApp, "wait_event_type='Lock'");
    } catch (error) { await holder; if (waiter) await waiter; throw error; }
    const [held, waiting] = await Promise.all([holder, waiter]);
    if (held.error) throw held.error;
    check(true, `${label}: separate waiting backend observed`); groups.push(label);
    return { held: parse(held.value), waiting: waiting.error ? waiting : { value: parse(waiting.value) } };
  }
  const one = await fresh(), first = await payload(one), sameRequest = randomUUID();
  const replay = await overlap('identical stage retry waits for one committed receipt', post(first, sameRequest), post(first, sameRequest));
  check(!replay.held.replayed && replay.waiting.value?.replayed && replay.held.eventId === replay.waiting.value.eventId,
    'same request returns exactly the same stage event');
  check(await query(`SELECT count(*) FROM sales_private.post_booking_events WHERE sale_id='${one.saleId}';`) === '1', 'duplicate click appends one event');

  const two = await fresh(), staleInput = await payload(two);
  const stale = await overlap('distinct stage requests compare current revision after lock', post(staleInput), post(staleInput));
  check(stale.waiting.error?.message.includes('CRM_POST_BOOKING_STALE_STATE'), 'different stale request cannot append another transition');
  check(await query(`SELECT count(*) FROM sales_private.post_booking_events WHERE sale_id='${two.saleId}';`) === '1', 'stale writer has no extra event');

  const three = await fresh(), beforeCancel = await payload(three);
  const cancelled = await overlap('booking18 cancellation wins before pending stage write', booking({ command: 'cancel', reason: 'SYNTHETIC cancel race',
    customerId: three.customerId, saleId: three.saleId, expectedSaleRevision: beforeCancel.expectedSaleRevision, cancellationCategory: 'booking_cancelled' }), post(beforeCancel));
  check(cancelled.waiting.error?.message.includes('CRM_POST_BOOKING_STALE_STATE'), 'stage writer rechecks18 cancellation revision under shared lock');
  const cancelState = parse(await query(`SELECT json_build_object('stage',s.crm_stage,'occupied',p.has_customer,
    'events',(SELECT count(*) FROM sales_private.post_booking_events WHERE sale_id=s.id)) FROM public.sales s JOIN public.plots p ON p.id=s.plot_id WHERE s.id='${three.saleId}';`));
  check(cancelState.stage === 'cancelled' && !cancelState.occupied && cancelState.events === 0, 'cancelled history and released stock stay unchanged');

  const four = await fresh(); await prepareDocs(four);
  const submitInput = await payload(four, { command: 'submit_loan', bankName: 'SYNTHETIC RACE BANK' }), submitRequest = randomUUID();
  const submit = await overlap('identical loan submission retry creates one attempt', post(submitInput, submitRequest), post(submitInput, submitRequest));
  check(submit.waiting.value?.replayed && submit.held.loanAttemptId === submit.waiting.value.loanAttemptId, 'loan replay refers to one application');
  check(await query(`SELECT count(*) FROM public.loan_attempts WHERE sale_id='${four.saleId}';`) === '1', 'no duplicated purchase attempt');

  const approve = await payload(four, { command: 'loan_result', loanAttemptId: submit.held.loanAttemptId, result: 'approved', approvedAmountSatang: 90000000 });
  const loan = await overlap('competing terminal loan results keep first committed result', post(approve), post({ ...approve, result: 'rejected', approvedAmountSatang: null }));
  check(loan.waiting.error?.message.includes('CRM_POST_BOOKING_STALE_STATE'), 'second bank outcome cannot overwrite approval');
  const loanState = parse(await query(`SELECT json_build_object('status',result_status,'amount',approved_amount,
    'events',(SELECT count(*) FROM sales_private.post_booking_events WHERE loan_attempt_id=a.id AND command='loan_result'))
    FROM public.loan_attempts a WHERE id='${submit.held.loanAttemptId}';`));
  check(loanState.status === 'approved' && loanState.amount === 900000 && loanState.events === 1, 'approved outcome and amount remain immutable single evidence');

  const five = await fresh(); await prepareDocs(five);
  const pending = parse(await query(session(post(await payload(five, { command: 'submit_loan', bankName: 'SYNTHETIC CANCELLATION BANK' })))));
  const resultInput = await payload(five, { command: 'loan_result', loanAttemptId: pending.loanAttemptId, result: 'approved', approvedAmountSatang: 90000000 });
  const resultRace = await overlap('booking18 cancellation blocks waiting loan result', booking({ command: 'cancel', reason: 'SYNTHETIC cancel before result',
    customerId: five.customerId, saleId: five.saleId, expectedSaleRevision: resultInput.expectedSaleRevision, cancellationCategory: 'booking_cancelled' }), post(resultInput));
  check(resultRace.waiting.error?.message.includes('CRM_POST_BOOKING_STALE_STATE'), 'bank result cannot mutate cancelled sale or loan');
  check(await query(`SELECT result_status FROM public.loan_attempts WHERE id='${pending.loanAttemptId}';`) === 'submitted',
    'cancellation does not fabricate a bank decision or rewrite submitted history');

  const six = await fresh('cash'); await prepareCashPending(six);
  const transferInput = await transferPayload(six), transferRequest = randomUUID();
  const transferRetry = await overlap('identical transfer retry commits one civil date and event', post(transferInput, transferRequest), post(transferInput, transferRequest));
  check(transferRetry.waiting.value?.replayed && transferRetry.held.eventId === transferRetry.waiting.value.eventId
    && transferRetry.held.transferDate === transferInput.transferDate, 'duplicate transfer has same event receipt and entered date');
  const transferState = parse(await query(`SELECT json_build_object('stage',s.crm_stage,'contract',s.contract_status,'occupied',p.has_customer,
    'legacyTime',s.transferred_at,'events',(SELECT count(*) FROM sales_private.post_booking_events WHERE sale_id=s.id AND command='confirm_transfer'))
    FROM public.sales s JOIN public.plots p ON p.id=s.plot_id WHERE s.id='${six.saleId}';`));
  check(transferState.stage === 'transferred' && transferState.contract === 'Transferred' && transferState.occupied
    && transferState.legacyTime === null && transferState.events === 1, 'transfer keeps occupied plot and unknown legacy time with one event');

  const seven = await fresh('cash'); await prepareCashPending(seven);
  const cancelFirstInput = await transferPayload(seven);
  const cancelFirst = await overlap('booking18 cancellation wins before waiting transfer', booking({ command: 'cancel', reason: 'SYNTHETIC cancel before transfer',
    customerId: seven.customerId, saleId: seven.saleId, expectedSaleRevision: cancelFirstInput.expectedSaleRevision, cancellationCategory: 'booking_cancelled' }), post(cancelFirstInput));
  check(cancelFirst.waiting.error?.message.includes('CRM_POST_BOOKING_STALE_STATE'), 'transfer rechecks cancellation revision under common lock');
  check(await query(`SELECT s.crm_stage='cancelled' AND s.crm_transfer_date IS NULL AND NOT p.has_customer
    AND NOT EXISTS(SELECT 1 FROM sales_private.post_booking_events WHERE sale_id=s.id AND command='confirm_transfer')
    FROM public.sales s JOIN public.plots p ON p.id=s.plot_id WHERE s.id='${seven.saleId}';`) === 't', 'cancel-first leaves released stock and no invented transfer');

  const eight = await fresh('cash'); await prepareCashPending(eight);
  const transferFirstInput = await transferPayload(eight);
  const transferFirst = await overlap('transfer wins before waiting booking18 cancellation', post(transferFirstInput), booking({ command: 'cancel', reason: 'SYNTHETIC cancel after transfer',
    customerId: eight.customerId, saleId: eight.saleId, expectedSaleRevision: transferFirstInput.expectedSaleRevision, cancellationCategory: 'booking_cancelled' }));
  check(transferFirst.waiting.error?.message.includes('CRM_BOOKING_STALE_STATE'), 'cancellation checks fresh transfer revision after waiting');
  check(await query(`SELECT s.crm_stage='transferred' AND s.crm_transfer_date IS NOT NULL AND p.has_customer AND s.cancelled_at IS NULL
    FROM public.sales s JOIN public.plots p ON p.id=s.plot_id WHERE s.id='${eight.saleId}';`) === 't', 'transfer-first never releases occupied stock or fabricates cancellation');

  const nine = await fresh('cash'); await prepareCashPending(nine);
  const competingTransfer = await transferPayload(nine);
  const staleTransfer = await overlap('distinct transfer requests compare current revision after lock', post(competingTransfer), post(competingTransfer));
  check(staleTransfer.waiting.error?.message.includes('CRM_POST_BOOKING_STALE_STATE'), 'different transfer request cannot repeat terminal date transition');
  check(await query(`SELECT count(*) FROM sales_private.post_booking_events WHERE sale_id='${nine.saleId}' AND command='confirm_transfer';`) === '1', 'competing transfers append only one transfer event');
  check(await query('SELECT (SELECT count(*) FROM sales_private.booking_write_permits)+(SELECT count(*) FROM sales_private.post_booking_write_permits);') === '0',
    'all race successes and failures leave no reusable permits');
  return { groups, assertions, syntheticOnly: true, productionCertified: false };
}
