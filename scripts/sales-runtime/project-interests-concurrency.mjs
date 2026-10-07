// Independent sessions in the runner-owned synthetic loopback cluster only.
// No app environment, remote DB, real customer data or deployment.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const sales = 'ca240000-0000-4000-8000-000000000002';
const admin = 'ca240000-0000-4000-8000-000000000001';
const otherSales = 'ca240000-0000-4000-8000-000000000003';
const project = 'SYNTHETIC INTEREST CONCURRENCY';
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const json = value => `${quote(JSON.stringify(value))}::jsonb`;
const parse = value => JSON.parse(value.split(/\r?\n/).find(line => line.startsWith('{')) ?? '{}');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const session = (body, app = '', actor = sales) => `BEGIN; ${app ? `SET LOCAL application_name=${quote(app)};` : ''}
 SET LOCAL ROLE authenticated; SET LOCAL "request.jwt.claim.sub"=${quote(actor)}; ${body} COMMIT;`;
const command = (payload, id = randomUUID()) => `SELECT public.crm_v2_add_project_interest('${id}',${json(payload)});`;
const lifecycle = payload => `SELECT public.crm_v2_change_lead_lifecycle('${randomUUID()}',${json(payload)});`;

export async function runProjectInterestsConcurrency({ query }) {
  let assertions = 0, customerNumber = 0;
  const groups = [];
  const check = (condition, label) => { assert.ok(condition, label); assertions++; };
  await query(`DO $guard$ BEGIN
    IF current_database() !~ '^buildtrack_sales_runtime_' OR current_setting('buildtrack.synthetic_runtime',true) IS DISTINCT FROM 'on'
      OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet THEN RAISE EXCEPTION 'SYNTHETIC ONLY'; END IF;
    END $guard$;
    INSERT INTO auth.users(id) VALUES('${sales}'),('${admin}'),('${otherSales}');
    INSERT INTO sales_private.crm_user_roles(user_id,role,display_name,is_active) VALUES
      ('${sales}','sales','SYNTHETIC INTEREST RACE SALES',true),('${admin}','admin','SYNTHETIC INTEREST RACE ADMIN',true),
      ('${otherSales}','sales','SYNTHETIC INTEREST RACE OTHER',true);
    INSERT INTO public.projects(name,is_closed) VALUES(${quote(project)},false);
    INSERT INTO public.plots(id,project_name,has_customer,sale_status) VALUES('SYNTHETIC-INTEREST-RACE-PLOT',${quote(project)},false,'available');
    INSERT INTO public.crm_settings(id,central_intake_enabled,lead_work_enabled,lead_lifecycle_enabled,project_interests_enabled,booking_enabled,booking_cutover_reviewed)
      VALUES(true,true,true,true,true,true,true) ON CONFLICT(id) DO UPDATE SET central_intake_enabled=true,lead_work_enabled=true,
      lead_lifecycle_enabled=true,project_interests_enabled=true,booking_enabled=true,booking_cutover_reviewed=true;`);
  async function fresh() {
    const n = ++customerNumber;
    const customer = parse(await query(session(`SELECT public.crm_v2_create_customer('${randomUUID()}',${json({
      name: `SYNTHETIC INTEREST RACE ${n}`, phone: `089241${String(n).padStart(4, '0')}`, channel: 'phone', notes: 'SYNTHETIC ONLY', interests: [],
    })});`)));
    return parse(await query(`SELECT jsonb_build_object('customerId',id,'expectedCustomerRevision',lifecycle_revision,
      'projectName',${quote(project)},'plotId',NULL,'reason','SYNTHETIC interest concurrency') FROM public.sales_customers WHERE id='${customer.customerId}';`));
  }
  const settled = promise => promise.then(value => ({ value }), error => ({ error }));
  async function waitState(app, condition) {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      if (await query(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${quote(app)} AND ${condition});`) === 't') return;
      await delay(40);
    }
    throw new Error(`Project-interest independent backend not observed: ${app}/${condition}`);
  }
  async function overlap(label, heldBody, waitingBody, holderActor = sales) {
    const token = randomUUID().slice(0, 8), heldApp = `interest_hold_${token}`, waitingApp = `interest_wait_${token}`;
    const holder = settled(query(session(`${heldBody} SELECT pg_sleep(4);`, heldApp, holderActor)));
    let waiter;
    try {
      await waitState(heldApp, "wait_event='PgSleep'");
      waiter = settled(query(session(waitingBody, waitingApp)));
      await waitState(waitingApp, "wait_event_type='Lock'");
    } catch (error) { await holder; if (waiter) await waiter; throw error; }
    const [held, waiting] = await Promise.all([holder, waiter]);
    if (held.error) throw held.error;
    check(true, `${label}: independent waiting backend observed`); groups.push(label);
    return { held: parse(held.value), waiting: waiting.error ? waiting : { value: parse(waiting.value) } };
  }
  const one = await fresh(), requestId = randomUUID();
  const retry = await overlap('identical add interest retry has one receipt', command(one, requestId), command(one, requestId));
  check(retry.waiting.value?.replayed && retry.held.interestId === retry.waiting.value.interestId && retry.held.eventId === retry.waiting.value.eventId,
    'concurrent retry returns one interest and audit event');
  check(await query(`SELECT count(*) FROM public.lead_project_interests WHERE customer_id='${one.customerId}';`) === '1', 'retry creates exactly one relation');

  const two = await fresh();
  const duplicate = await overlap('distinct add commands compete for same customer project', command(two), command(two));
  check(duplicate.waiting.error?.message.includes('CRM_INTERESTS_PROJECT_EXISTS'), 'second add sees committed project relation');
  check(await query(`SELECT count(*) FROM public.crm_audit_events WHERE customer_id='${two.customerId}' AND event_type='project_interest_added';`) === '1',
    'duplicate add cannot append a second event');

  const three = await fresh();
  const reassign = await overlap('central owner reassignment wins before waiting add', lifecycle({ command: 'reassign_owner', customerId: three.customerId,
    interestId: null, expectedRevision: three.expectedCustomerRevision, expectedActionId: null, newOwnerUserId: otherSales, reason: 'SYNTHETIC central reassignment' }), command(three), admin);
  check(reassign.waiting.error?.message.includes('CRM_INTERESTS_FORBIDDEN'), 'former central owner cannot add after transfer commits');
  check(await query(`SELECT count(*) FROM public.lead_project_interests WHERE customer_id='${three.customerId}';`) === '0', 'ownership race creates no project relation');

  const four = await fresh();
  const lost = await overlap('central lost closure wins before waiting add', lifecycle({ command: 'close_lost', customerId: four.customerId,
    interestId: null, expectedRevision: four.expectedCustomerRevision, expectedActionId: null, reason: 'SYNTHETIC central closure' }), command(four));
  check(lost.waiting.error?.message.includes('CRM_INTERESTS_SCOPE_CLOSED'), 'waiting add rechecks central lost state');
  check(await query(`SELECT count(*) FROM public.lead_project_interests WHERE customer_id='${four.customerId}';`) === '0', 'closed Lead gains no interest');

  const five = await fresh(), six = await fresh();
  const booking = { command: 'book', reason: 'SYNTHETIC plot booked during interest choice', customerId: five.customerId, newCustomer: null,
    projectName: project, expectedInterestRevision: null, plotId: 'SYNTHETIC-INTEREST-RACE-PLOT', paymentMethod: 'cash', bookingRoute: 'without_visit',
    visitId: null, listPriceSatang: 100000000, discountSatang: 0, depositSatang: 10000, previousSaleId: null };
  const stock = await overlap('booking commits before waiting interested-plot save',
    `SELECT public.crm_v2_booking_command('${randomUUID()}',${json(booking)});`, command({ ...six, plotId: 'SYNTHETIC-INTEREST-RACE-PLOT' }));
  check(stock.waiting.error?.message.includes('CRM_INTERESTS_PLOT_UNAVAILABLE'), 'interested-plot command rechecks newly occupied stock after wait');
  check(await query(`SELECT count(*) FROM public.lead_project_interests WHERE customer_id='${six.customerId}';`) === '0', 'failed plot selection creates no interest');
  check(await query('SELECT count(*) FROM sales_private.project_interest_write_permits;') === '0', 'no receipt permits remain');
  return { groups, assertions, syntheticOnly: true, productionCertified: false };
}
