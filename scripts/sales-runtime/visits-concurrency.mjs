// Independent backend sessions in the runner-owned disposable loopback cluster.
// No application environment, remote credentials, live customer data or deployment.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const sales = 'ca230000-0000-4000-8000-000000000002';
const admin = 'ca230000-0000-4000-8000-000000000001';
const otherSales = 'ca230000-0000-4000-8000-000000000003';
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const json = value => `${quote(JSON.stringify(value))}::jsonb`;
const parse = value => JSON.parse(value.split(/\r?\n/).find(line => line.startsWith('{')) ?? '{}');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const session = (body, app = '', actor = sales) => `BEGIN; ${app ? `SET LOCAL application_name=${quote(app)};` : ''}
 SET LOCAL ROLE authenticated; SET LOCAL "request.jwt.claim.sub"=${quote(actor)}; ${body} COMMIT;`;
const command = (payload, id = randomUUID()) => `SELECT public.crm_v2_visits_command('${id}',${json(payload)});`;
const lifecycle = payload => `SELECT public.crm_v2_change_lead_lifecycle('${randomUUID()}',${json(payload)});`;

export async function runVisitsConcurrency({ query }) {
  let assertions = 0, customerNumber = 0;
  const groups = [];
  const check = (condition, label) => { assert.ok(condition, label); assertions++; };
  await query(`DO $guard$ BEGIN
    IF current_database() !~ '^buildtrack_sales_runtime_' OR current_setting('buildtrack.synthetic_runtime',true) IS DISTINCT FROM 'on'
      OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet THEN RAISE EXCEPTION 'SYNTHETIC ONLY'; END IF;
    END $guard$;
    INSERT INTO auth.users(id) VALUES('${sales}'),('${admin}'),('${otherSales}');
    INSERT INTO sales_private.crm_user_roles(user_id,role,display_name,is_active) VALUES
      ('${sales}','sales','SYNTHETIC VISITS RACE SALES',true),('${admin}','admin','SYNTHETIC VISITS RACE ADMIN',true),
      ('${otherSales}','sales','SYNTHETIC VISITS RACE OTHER',true);
    INSERT INTO public.projects(name,is_closed) VALUES('SYNTHETIC VISITS CONCURRENCY',false);
    INSERT INTO public.crm_settings(id,central_intake_enabled,lead_work_enabled,lead_lifecycle_enabled,visits_enabled)
      VALUES(true,true,true,true,true) ON CONFLICT(id) DO UPDATE SET central_intake_enabled=true,lead_work_enabled=true,lead_lifecycle_enabled=true,visits_enabled=true;`);
  async function fresh() {
    const n = ++customerNumber;
    const intake = parse(await query(session(`SELECT public.crm_v2_create_customer('${randomUUID()}',${json({
      name: `SYNTHETIC VISIT RACE ${n}`, phone: `089231${String(n).padStart(4, '0')}`, channel: 'phone', notes: 'SYNTHETIC ONLY',
      interests: [{ projectName: 'SYNTHETIC VISITS CONCURRENCY', plotId: null }],
    })});`)));
    return parse(await query(`SELECT jsonb_build_object('customerId',customer_id,'interestId',id,'expectedInterestRevision',lifecycle_revision)
      FROM public.lead_project_interests WHERE customer_id='${intake.customerId}';`));
  }
  async function payload(scope, extra = { command: 'schedule' }) {
    const clocks = parse(await query(`SELECT jsonb_build_object('occurredAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'startsAt',to_char((clock_timestamp()+interval '1 day') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));`));
    return { ...scope, reason: 'SYNTHETIC visit concurrency reason', occurredAt: clocks.occurredAt,
      ...(extra.command === 'schedule' || extra.command === 'reschedule' ? { startsAt: clocks.startsAt, endsAt: null } : {}), ...extra };
  }
  async function scheduled(scope) { return parse(await query(session(command(await payload(scope))))); }
  const settled = promise => promise.then(value => ({ value }), error => ({ error }));
  async function waitState(app, condition) {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      if (await query(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${quote(app)} AND ${condition});`) === 't') return;
      await delay(40);
    }
    throw new Error(`Visit independent backend not observed: ${app}/${condition}`);
  }
  async function overlap(label, heldBody, waitingBody, holderActor = sales) {
    const token = randomUUID().slice(0, 8), heldApp = `visit_hold_${token}`, waitingApp = `visit_wait_${token}`;
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
  const one = await fresh(), oneAppt = await scheduled(one);
  const checkInput = await payload(one, { command: 'check_in', appointmentId: oneAppt.appointmentId, expectedAppointmentRevision: oneAppt.appointmentRevision });
  const requestId = randomUUID();
  const same = await overlap('identical check-in retry creates one Visit', command(checkInput, requestId), command(checkInput, requestId));
  check(same.waiting.value?.replayed && same.held.visitId === same.waiting.value.visitId && same.held.eventId === same.waiting.value.eventId,
    'same check-in request recovers committed single result');
  check(await query(`SELECT count(*) FROM public.lead_visits WHERE appointment_id='${oneAppt.appointmentId}';`) === '1', 'unique real attendance after retry');

  const two = await fresh(), twoAppt = await scheduled(two);
  const apptRef = { appointmentId: twoAppt.appointmentId, expectedAppointmentRevision: twoAppt.appointmentRevision };
  const reschedule = await payload(two, { command: 'reschedule', ...apptRef });
  const staleCheck = await payload(two, { command: 'check_in', ...apptRef });
  const rescheduled = await overlap('reschedule wins before stale check-in', command(reschedule), command(staleCheck));
  check(rescheduled.waiting.error?.message.includes('CRM_VISITS_STALE_STATE'), 'waiting check-in sees new appointment revision');
  check(await query(`SELECT count(*) FROM public.lead_visits WHERE project_interest_id='${two.interestId}';`) === '0', 'reschedule race cannot fabricate attendance');

  const three = await fresh(), threeAppt = await scheduled(three);
  const threeRef = { appointmentId: threeAppt.appointmentId, expectedAppointmentRevision: threeAppt.appointmentRevision };
  const checked = await overlap('check-in wins before stale appointment cancellation', command(await payload(three, { command: 'check_in', ...threeRef })),
    command(await payload(three, { command: 'cancel_appointment', ...threeRef })));
  check(checked.waiting.error?.message.includes('CRM_VISITS_STALE_STATE'), 'cancellation cannot erase committed attendance');
  check(await query(`SELECT status FROM public.lead_appointments WHERE id='${threeAppt.appointmentId}';`) === 'attended', 'attended appointment remains historical fact');

  const four = await fresh(), beforeReassign = await payload(four);
  const ownerChange = { command: 'reassign_owner', customerId: four.customerId, interestId: four.interestId,
    expectedRevision: four.expectedInterestRevision, expectedActionId: null, newOwnerUserId: otherSales, reason: 'SYNTHETIC transfer owner race' };
  const reassign = await overlap('lifecycle owner reassignment wins before stale appointment command', lifecycle(ownerChange), command(beforeReassign), admin);
  check(reassign.waiting.error?.message.includes('CRM_VISITS_FORBIDDEN'), 'former owner loses write authority under customer lock');
  check(await query(`SELECT count(*) FROM public.lead_appointments WHERE project_interest_id='${four.interestId}';`) === '0', 'former owner created no appointment');

  const five = await fresh(), walkInput = await payload(five, { command: 'check_in', appointmentId: null, expectedAppointmentRevision: null });
  const lost = await overlap('lost closure wins before a waiting walk-in', lifecycle({ command: 'close_lost', customerId: five.customerId,
    interestId: five.interestId, expectedRevision: five.expectedInterestRevision, expectedActionId: null, reason: 'SYNTHETIC lost race' }), command(walkInput));
  check(lost.waiting.error?.message.includes('CRM_VISITS_SCOPE_CLOSED'), 'waiting walk-in checks closure after lock');
  check(await query(`SELECT count(*) FROM public.lead_visits WHERE project_interest_id='${five.interestId}';`) === '0', 'closed scope receives no Visit');

  const six = await fresh();
  const walk = parse(await query(session(command(await payload(six, { command: 'check_in', appointmentId: null, expectedAppointmentRevision: null })))));
  const cancelInput = await payload(six, { command: 'cancel_visit', visitId: walk.visitId, expectedVisitRevision: walk.visitRevision });
  const cancelled = await overlap('distinct cancel Visit requests compare revision', command(cancelInput), command(cancelInput));
  check(cancelled.waiting.error?.message.includes('CRM_VISITS_STALE_STATE'), 'duplicate cancellation cannot append second history event');
  check(await query(`SELECT count(*) FROM sales_private.visits_events WHERE visit_id='${walk.visitId}' AND command='cancel_visit';`) === '1', 'one cancellation event');
  check(await query('SELECT count(*) FROM sales_private.visits_write_permits;') === '0', 'no reusable visit write permits remain');
  return { groups, assertions, syntheticOnly: true, productionCertified: false };
}
