// Multi-session tests exclusively in the runner-owned disposable loopback cluster.
// No environment files, Supabase credentials, existing database or live data.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const sales = 'ca180000-0000-4000-8000-000000000002';
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const json = value => `${quote(JSON.stringify(value))}::jsonb`;
const parse = value => JSON.parse(value.split(/\r?\n/).find(line => line.startsWith('{')) ?? '{}');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const session = (body, app = '') => `BEGIN; ${app ? `SET LOCAL application_name=${quote(app)};` : ''}
 SET LOCAL ROLE authenticated; SET LOCAL "request.jwt.claim.sub"=${quote(sales)}; ${body} COMMIT;`;
const command = (payload, id = randomUUID()) => `SELECT public.crm_v2_booking_command('${id}',${json(payload)});`;

export async function runBookingConcurrency({ query }) {
  let assertions = 0;
  const groups = [];
  const check = (condition, label) => { assert.ok(condition, label); assertions++; };
  await query(`DO $guard$ BEGIN
    IF current_database() !~ '^buildtrack_sales_runtime_' OR current_setting('buildtrack.synthetic_runtime',true) IS DISTINCT FROM 'on'
      OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet THEN RAISE EXCEPTION 'SYNTHETIC ONLY'; END IF;
    END $guard$;
    INSERT INTO auth.users(id) VALUES('${sales}');
    INSERT INTO sales_private.crm_user_roles(user_id,role,display_name,is_active) VALUES('${sales}','sales','SYNTHETIC Booking Concurrency Sales',true);
    INSERT INTO public.projects(name,is_closed) VALUES('SYNTHETIC BOOKING CONCURRENCY',false);
    INSERT INTO public.plots(id,project_name,has_customer,sale_status)
      SELECT 'SYNTHETIC-BC-'||n,'SYNTHETIC BOOKING CONCURRENCY',false,'available' FROM generate_series(1,4) n;
    INSERT INTO public.crm_settings(id,central_intake_enabled,lead_work_enabled,lead_lifecycle_enabled,booking_enabled,booking_cutover_reviewed)
      VALUES(true,true,true,true,true,true) ON CONFLICT(id) DO UPDATE SET central_intake_enabled=true,lead_work_enabled=true,
      lead_lifecycle_enabled=true,booking_enabled=true,booking_cutover_reviewed=true;`);
  let customerNumber = 0;
  const fresh = plot => ({ command: 'book', reason: 'SYNTHETIC concurrency booking', customerId: null,
    newCustomer: { name: `SYNTHETIC concurrent ${++customerNumber}`, phone: `089181${String(customerNumber).padStart(4, '0')}`,
      channel: 'phone', notes: 'SYNTHETIC ONLY', assignedSalesUserId: null },
    projectName: 'SYNTHETIC BOOKING CONCURRENCY', expectedInterestRevision: null, plotId: `SYNTHETIC-BC-${plot}`,
    paymentMethod: 'cash', bookingRoute: 'without_visit', visitId: null, listPriceSatang: 100000000,
    discountSatang: 0, depositSatang: 10000, previousSaleId: null });
  const settled = promise => promise.then(value => ({ value }), error => ({ error }));
  async function waitState(app, condition) {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      if (await query(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${quote(app)} AND ${condition});`) === 't') return;
      await delay(40);
    }
    throw new Error(`Booking concurrency backend not observed: ${app}/${condition}`);
  }
  async function overlap(label, heldBody, waitingBody) {
    const token = randomUUID().slice(0, 8), heldApp = `booking_hold_${token}`, waitingApp = `booking_wait_${token}`;
    const holder = settled(query(session(`${heldBody} SELECT pg_sleep(4);`, heldApp)));
    let waiter;
    try {
      await waitState(heldApp, "wait_event='PgSleep'");
      waiter = settled(query(session(waitingBody, waitingApp)));
      await waitState(waitingApp, "wait_event_type='Lock'");
    } catch (error) { await holder; if (waiter) await waiter; throw error; }
    const [held, waiting] = await Promise.all([holder, waiter]);
    if (held.error) throw held.error;
    check(true, `${label}: independent waiting backend observed`);
    groups.push(label);
    return { held: parse(held.value), waiting: waiting.error ? waiting : { value: parse(waiting.value) } };
  }

  const first = fresh(1), sameId = randomUUID();
  const replay = await overlap('identical booking retry waits for committed receipt', command(first, sameId), command(first, sameId));
  check(!replay.held.replayed && replay.waiting.value?.replayed && replay.held.saleId === replay.waiting.value.saleId,
    'same request returns one customer and one booking identity');
  const sameCounts = parse(await query(`SELECT json_build_object('customers',(SELECT count(*) FROM public.sales_customers WHERE phone=${quote(first.newCustomer.phone)}),
    'sales',(SELECT count(*) FROM public.sales WHERE plot_id='SYNTHETIC-BC-1'));`));
  check(sameCounts.customers === 1 && sameCounts.sales === 1, 'concurrent retry has exactly one customer and sale');

  const competingOne = fresh(2), competingTwo = fresh(2);
  const stock = await overlap('different customers compete for one plot', command(competingOne), command(competingTwo));
  check(stock.waiting.error?.message.includes('CRM_BOOKING_PLOT_UNAVAILABLE'), 'second plot claimant rejected after lock recheck');
  check(await query(`SELECT EXISTS(SELECT 1 FROM public.sales_customers WHERE phone=${quote(competingTwo.newCustomer.phone)});`) === 'f',
    'failed competing booking rolls back intake customer and its dependent history');

  const cancel = { command: 'cancel', reason: 'SYNTHETIC concurrent cancellation', customerId: stock.held.customerId,
    saleId: stock.held.saleId, expectedSaleRevision: stock.held.saleRevision, cancellationCategory: 'booking_cancelled' };
  const afterCancel = fresh(2);
  const released = await overlap('cancel then another customer books released plot', command(cancel), command(afterCancel));
  check(released.waiting.value?.command === 'book', 'waiting booking rechecks committed released stock');
  const releasedRows = parse(await query(`SELECT json_build_object('active',count(*) FILTER(WHERE crm_stage='booked'),
    'cancelled',count(*) FILTER(WHERE crm_stage='cancelled'),'occupied',(SELECT has_customer FROM public.plots WHERE id='SYNTHETIC-BC-2'))
    FROM public.sales WHERE plot_id='SYNTHETIC-BC-2';`));
  check(releasedRows.active === 1 && releasedRows.cancelled === 1 && releasedRows.occupied, 'cancelled history retained alongside one active claimant');

  const resume = { command: 'resume_follow_up', reason: 'SYNTHETIC explicit followup', customerId: released.held.customerId,
    saleId: released.held.saleId, expectedSaleRevision: released.held.saleRevision, expectedInterestRevision: released.held.interestRevision,
    expectedActionId: null, nextAction: { action: 'SYNTHETIC followup', dueAt: new Date(Date.now() + 86400000).toISOString() } };
  const before = await query(`SELECT to_jsonb(s)::text FROM public.sales s WHERE id='${resume.saleId}';`);
  const plans = await overlap('concurrent resume plans compare interest revision', command(resume), command(resume));
  check(plans.waiting.error?.message.includes('CRM_BOOKING_STALE_STATE'), 'second distinct resume command cannot overwrite the first plan');
  check(await query(`SELECT count(*) FROM public.crm_next_actions WHERE project_interest_id='${released.held.interestId}';`) === '1',
    'only one followup plan inserted');
  check(before === await query(`SELECT to_jsonb(s)::text FROM public.sales s WHERE id='${resume.saleId}';`), 'concurrent resume never modifies cancelled sale');
  check(await query('SELECT count(*) FROM sales_private.booking_write_permits;') === '0', 'no reusable write capabilities remain');
  return { groups, assertions, syntheticOnly: true, productionCertified: false };
}
