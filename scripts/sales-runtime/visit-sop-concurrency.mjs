// Multi-session checks only in the runner-owned disposable loopback cluster.
// No app config, production credentials, external service or live customer data.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const sales = 'ca250000-0000-4000-8000-000000000002';
const admin = 'ca250000-0000-4000-8000-000000000001';
const other = 'ca250000-0000-4000-8000-000000000003';
const project = 'SYNTHETIC SOP CONCURRENCY';
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const json = value => `${quote(JSON.stringify(value))}::jsonb`;
const parse = value => JSON.parse(value.split(/\r?\n/).find(line => line.startsWith('{')) ?? '{}');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const session = (body, app = '', actor = sales) => `BEGIN; ${app ? `SET LOCAL application_name=${quote(app)};` : ''}
 SET LOCAL ROLE authenticated; SET LOCAL "request.jwt.claim.sub"=${quote(actor)}; ${body} COMMIT;`;
const command = (payload, id = randomUUID()) => `SELECT public.crm_v2_record_visit_sop('${id}',${json(payload)});`;
const visits = payload => `SELECT public.crm_v2_visits_command('${randomUUID()}',${json(payload)});`;
const lifecycle = payload => `SELECT public.crm_v2_change_lead_lifecycle('${randomUUID()}',${json(payload)});`;

export async function runVisitSopConcurrency({ query }) {
 let assertions = 0, customerNumber = 0;
 const groups = [];
 const check = (condition, label) => { assert.ok(condition, label); assertions++; };
 await query(`DO $guard$ BEGIN
   IF current_database() !~ '^buildtrack_sales_runtime_' OR current_setting('buildtrack.synthetic_runtime',true) IS DISTINCT FROM 'on'
     OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet THEN RAISE EXCEPTION 'SYNTHETIC ONLY'; END IF;
   END $guard$;
   INSERT INTO auth.users(id) VALUES('${sales}'),('${admin}'),('${other}');
   INSERT INTO sales_private.crm_user_roles(user_id,role,display_name,is_active) VALUES
     ('${sales}','sales','SYNTHETIC SOP RACE SALES',true),('${admin}','admin','SYNTHETIC SOP RACE ADMIN',true),('${other}','sales','SYNTHETIC SOP RACE OTHER',true);
   INSERT INTO public.projects(name,is_closed) VALUES(${quote(project)},false);
   INSERT INTO public.plots(id,project_name,has_customer,sale_status) VALUES('SYNTHETIC-SOP-RACE-HOUSE',${quote(project)},true,'occupied');
   INSERT INTO public.crm_settings(id,central_intake_enabled,lead_work_enabled,lead_lifecycle_enabled,visits_enabled,visit_sop_enabled)
     VALUES(true,true,true,true,true,true) ON CONFLICT(id) DO UPDATE SET central_intake_enabled=true,lead_work_enabled=true,lead_lifecycle_enabled=true,visits_enabled=true,visit_sop_enabled=true;`);
 const clock = async () => parse(await query(`SELECT jsonb_build_object('occurredAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
   'startsAt',to_char((clock_timestamp()+interval '1 day') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));`));
 const snapshot = async scope => parse(await query(session(`SELECT public.crm_v2_visit_sop_context('${scope.customerId}','${scope.interestId}','${scope.appointmentId}',NULL,0);`)));
 const stageAnswers = parse(await query(`SELECT jsonb_build_object('rows',jsonb_agg(jsonb_build_object('key',item_key,'result','done','reason',NULL) ORDER BY ordinal))
   FROM sales_private.crm_sop_template() WHERE stage='stage_a';`)).rows;
 async function fresh() {
   const n = ++customerNumber;
   const created = parse(await query(session(`SELECT public.crm_v2_create_customer('${randomUUID()}',${json({ name: `SYNTHETIC SOP RACE ${n}`,
     phone: `089251${String(n).padStart(4, '0')}`, channel: 'phone', notes: 'SYNTHETIC ONLY', interests: [{ projectName: project, plotId: null }] })});`)));
   const scope = parse(await query(`SELECT jsonb_build_object('customerId',customer_id,'interestId',id,'expectedInterestRevision',lifecycle_revision)
     FROM public.lead_project_interests WHERE customer_id='${created.customerId}';`));
   const time = await clock();
   const appointment = parse(await query(session(visits({ ...scope, command: 'schedule', reason: 'SYNTHETIC appointment', occurredAt: time.occurredAt, startsAt: time.startsAt, endsAt: null }))));
   return { ...scope, appointmentId: appointment.appointmentId, appointmentRevision: appointment.appointmentRevision };
 }
 async function payload(scope, cmd = 'start') {
   const time = await clock();
   const { run } = await snapshot(scope);
   return { customerId: scope.customerId, interestId: scope.interestId, appointmentId: scope.appointmentId, visitId: null,
     expectedInterestRevision: scope.expectedInterestRevision, command: cmd, reason: 'SYNTHETIC SOP concurrency', occurredAt: time.occurredAt,
     ...(cmd === 'start' ? { plotId: 'SYNTHETIC-SOP-RACE-HOUSE' } : { runId: run.id, expectedRunRevision: run.revision }),
     ...(['save_stage', 'complete_stage'].includes(cmd) ? { stage: 'stage_a', answers: stageAnswers, recap: null } : {}) };
 }
 const settled = promise => promise.then(value => ({ value }), error => ({ error }));
 async function waitState(app, condition) {
   const deadline = Date.now() + 3000;
   while (Date.now() < deadline) {
     if (await query(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${quote(app)} AND ${condition});`) === 't') return;
     await delay(40);
   }
   throw new Error(`SOP independent backend not observed: ${app}/${condition}`);
 }
 async function overlap(label, heldBody, waitingBody, holderActor = sales) {
   const token = randomUUID().slice(0, 8), heldApp = `sop_hold_${token}`, waitingApp = `sop_wait_${token}`;
   const holder = settled(query(session(`${heldBody} SELECT pg_sleep(4);`, heldApp, holderActor)));
   let waiter;
   try {
     await waitState(heldApp, "wait_event='PgSleep'"); waiter = settled(query(session(waitingBody, waitingApp)));
     await waitState(waitingApp, "wait_event_type='Lock'");
   } catch (error) { await holder; if (waiter) await waiter; throw error; }
   const [held, waiting] = await Promise.all([holder, waiter]); if (held.error) throw held.error;
   check(true, `${label}: independent waiting backend observed`); groups.push(label);
   return { held: parse(held.value), waiting: waiting.error ? waiting : { value: parse(waiting.value) } };
 }
 const one = await fresh(), oneInput = await payload(one), requestId = randomUUID();
 const same = await overlap('identical SOP start retry creates one run', command(oneInput, requestId), command(oneInput, requestId));
 check(same.waiting.value?.replayed && same.held.runId === same.waiting.value.runId && same.held.eventId === same.waiting.value.eventId, 'exact SOP start result replayed');
 check(await query(`SELECT count(*) FROM public.house_visit_checklist_items WHERE run_id='${same.held.runId}';`) === '29', 'retry retains exactly twenty-nine items');
 const two = await fresh(), twoInput = await payload(two);
 const starts = await overlap('distinct SOP start requests share appointment uniqueness', command(twoInput), command(twoInput));
 check(starts.waiting.error?.message.includes('CRM_SOP_ALREADY_STARTED'), 'second start observes committed preparation');
 check(await query(`SELECT count(*) FROM public.house_visit_checklist_runs WHERE appointment_id='${two.appointmentId}';`) === '1', 'appointment has one run');
 const saveInput = await payload(two, 'save_stage');
 const saves = await overlap('concurrent draft tabs compare run revisions', command(saveInput), command(saveInput));
 check(saves.waiting.error?.message.includes('CRM_SOP_STALE_STATE'), 'second draft cannot overwrite newly saved answers');
 check(await query(`SELECT count(*) FROM sales_private.visit_sop_events WHERE run_id='${starts.held.runId}' AND command='save_stage';`) === '1', 'one successful draft event');
 const three = await fresh(); await query(session(command(await payload(three))));
 const staleOwner = await payload(three, 'save_stage');
 const reassigned = await overlap('interest reassignment wins before old Sales SOP save', lifecycle({ command: 'reassign_owner', customerId: three.customerId,
   interestId: three.interestId, expectedRevision: three.expectedInterestRevision, expectedActionId: null, newOwnerUserId: other, reason: 'SYNTHETIC reassignment' }), command(staleOwner), admin);
 check(reassigned.waiting.error?.message.includes('CRM_SOP_FORBIDDEN'), 'former Sales is rejected after lock wait');
 check((await snapshot(three)).run.items.every(item => item.result === 'pending'), 'forbidden old-owner save changes no item evidence');
 const four = await fresh(); await query(session(command(await payload(four)))); await query(session(command(await payload(four, 'complete_stage'))));
 const checked = parse(await query(session(visits({ command: 'check_in', customerId: four.customerId, interestId: four.interestId,
   expectedInterestRevision: four.expectedInterestRevision, appointmentId: four.appointmentId, expectedAppointmentRevision: four.appointmentRevision,
   reason: 'SYNTHETIC attendance', occurredAt: (await clock()).occurredAt }))));
 const tourInput = await payload(four, 'start_tour');
 const cancelled = await overlap('Visit cancellation wins before waiting tour start', visits({ command: 'cancel_visit', customerId: four.customerId,
   interestId: four.interestId, expectedInterestRevision: four.expectedInterestRevision, visitId: checked.visitId, expectedVisitRevision: checked.visitRevision,
   reason: 'SYNTHETIC Visit cancelled', occurredAt: (await clock()).occurredAt }), command(tourInput));
 check(cancelled.waiting.error?.message.includes('CRM_SOP_SCOPE_CLOSED'), 'cancelled Visit cannot start tour after wait');
 check((await snapshot(four)).run.currentStage === 'stage_b', 'cancel race cannot forge tour timestamp');
 const five = await fresh(), beforeLost = await payload(five);
 const lost = await overlap('lost interest closes before waiting SOP start', lifecycle({ command: 'close_lost', customerId: five.customerId,
   interestId: five.interestId, expectedRevision: five.expectedInterestRevision, expectedActionId: null, reason: 'SYNTHETIC lost' }), command(beforeLost));
 check(lost.waiting.error?.message.includes('CRM_SOP_SCOPE_CLOSED'), 'lost scope blocks waiting preparation');
 check((await snapshot(five)).run === null, 'lost race inserts no run');
 check(await query('SELECT count(*) FROM sales_private.visit_sop_write_permits;') === '0', 'no reusable SOP permits left behind');
 return { groups, assertions, syntheticOnly: true, productionCertified: false };
}
