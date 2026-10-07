// Independent backends in the runner-owned disposable loopback database only.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
const sales = 'ca260000-0000-4000-8000-000000000002';
const admin = 'ca260000-0000-4000-8000-000000000001';
const project = 'SYNTHETIC VOICE CONCURRENCY';
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const json = value => `${quote(JSON.stringify(value))}::jsonb`;
const parse = value => JSON.parse(value.split(/\r?\n/).find(line => line.startsWith('{')) ?? '{}');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const hash = () => (randomUUID() + randomUUID()).replaceAll('-', '');
const tokenHash = token => createHash('sha256').update(token, 'utf8').digest('hex');
const session = (body, app = '', actor = sales) => `BEGIN; ${app ? `SET LOCAL application_name=${quote(app)};` : ''}
 SET LOCAL ROLE ${actor === null ? 'anon' : 'authenticated'}; SET LOCAL "request.jwt.claim.sub"=${quote(actor ?? '')}; ${body} COMMIT;`;
const command = (payload, id = randomUUID()) => `SELECT public.crm_v2_customer_voices_command('${id}',${json(payload)});`;
const answers = { score_knowledge: 1, score_problem_solving: 2, score_service_mind: 3, score_appearance: 4,
 score_cleanliness: 5, score_house_design: 4, score_price: 3, score_location: 2 };
const submit = (token, request = randomUUID()) => `SELECT public.crm_v2_customer_voice_submit('${token}','${request}','customer_voices_v1',${json(answers)});`;

export async function runCustomerVoicesConcurrency({ query }) {
 let assertions = 0, customerNumber = 0;
 const groups = [];
 const check = (condition, label) => { assert.ok(condition, label); assertions++; };
 await query(`DO $guard$ BEGIN
 IF current_database() !~ '^buildtrack_sales_runtime_' OR current_setting('buildtrack.synthetic_runtime',true) IS DISTINCT FROM 'on'
 OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet THEN RAISE EXCEPTION 'SYNTHETIC ONLY'; END IF; END $guard$;
 INSERT INTO auth.users(id) VALUES('${sales}'),('${admin}');
 INSERT INTO sales_private.crm_user_roles(user_id,role,display_name,is_active) VALUES
 ('${sales}','sales','SYNTHETIC VOICE RACE SALES',true),('${admin}','admin','SYNTHETIC VOICE RACE ADMIN',true);
 INSERT INTO public.projects(name,is_closed) VALUES(${quote(project)},false);
 INSERT INTO public.crm_settings(id,central_intake_enabled,lead_work_enabled,lead_lifecycle_enabled,visits_enabled,customer_voices_enabled)
 VALUES(true,true,true,true,true,true) ON CONFLICT(id) DO UPDATE SET central_intake_enabled=true,lead_work_enabled=true,lead_lifecycle_enabled=true,visits_enabled=true,customer_voices_enabled=true;
 CREATE FUNCTION public.runtime_voice_race_hold(p_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $hold$
 BEGIN PERFORM 1 FROM public.sales_customers WHERE id=p_id FOR UPDATE; END $hold$;`);
 const clock = async () => parse(await query(`SELECT jsonb_build_object('occurredAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));`)).occurredAt;
 async function fresh(issue = true) {
  const n = ++customerNumber;
  const created = parse(await query(session(`SELECT public.crm_v2_create_customer('${randomUUID()}',${json({ name: `SYNTHETIC VOICE RACE ${n}`,
   phone: `089261${String(n).padStart(4, '0')}`, channel: 'phone', notes: 'SYNTHETIC ONLY', interests: [{ projectName: project, plotId: null }] })});`)));
  const scope = parse(await query(`SELECT jsonb_build_object('customerId',customer_id,'interestId',id,'expectedInterestRevision',lifecycle_revision)
   FROM public.lead_project_interests WHERE customer_id='${created.customerId}';`));
  const checked = parse(await query(session(`SELECT public.crm_v2_visits_command('${randomUUID()}',${json({ ...scope, command: 'check_in', appointmentId: null,
   expectedAppointmentRevision: null, reason: 'SYNTHETIC actual visit', occurredAt: await clock() })});`)));
  const token = hash();
  const input = { ...scope, visitId: checked.visitId, expectedVisitRevision: checked.visitRevision,
   command: 'issue', tokenHash: tokenHash(token), expectedTokenId: null, reason: 'SYNTHETIC QR race' };
  const issued = issue ? parse(await query(session(command(input)))) : null;
  return { scope, input, issued, token };
 }
 const settled = promise => promise.then(value => ({ value }), error => ({ error }));
 async function waitState(app, condition) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
   if (await query(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${quote(app)} AND ${condition});`) === 't') return;
   await delay(40);
  }
  throw new Error(`Voice independent backend not observed: ${app}/${condition}`);
 }
 async function overlap(label, heldBody, waitingBody, holderActor = sales, waiterActor = null) {
  const tag = randomUUID().slice(0, 8), heldApp = `voice_hold_${tag}`, waitingApp = `voice_wait_${tag}`;
  const holder = settled(query(session(`${heldBody} SELECT pg_sleep(4);`, heldApp, holderActor)));
  let waiter;
  try {
   await waitState(heldApp, "wait_event='PgSleep'"); waiter = settled(query(session(waitingBody, waitingApp, waiterActor)));
   await waitState(waitingApp, "wait_event_type='Lock'");
  } catch (error) { await holder; if (waiter) await waiter; throw error; }
  const [held, waiting] = await Promise.all([holder, waiter]); if (held.error) throw held.error;
  check(true, `${label}: independent waiting backend observed`); groups.push(label);
  return { held: parse(held.value), waiting: waiting.error ? waiting : { value: parse(waiting.value) } };
 }
 const one = await fresh(), sameRequest = randomUUID();
 const same = await overlap('identical customer retry completes one Visit once', submit(one.token, sameRequest), submit(one.token, sameRequest), null);
 check(same.held.submitted && same.waiting.value?.replayed, 'exact concurrent customer retry receives generic acknowledgement');
 check(await query(`SELECT count(*) FROM public.customer_voices WHERE visit_id='${one.input.visitId}';`) === '1', 'one response for same-token retry');
 const two = await fresh();
 const distinct = await overlap('different submissions cannot reuse a consumed token', submit(two.token), submit(two.token), null);
 check(distinct.waiting.error?.message.includes('CRM_VOICE_IDEMPOTENCY_CONFLICT'), 'different customer request cannot overwrite first answers');
 check(await query(`SELECT count(*) FROM sales_private.voice_submissions WHERE token_id='${two.issued.tokenId}';`) === '1', 'one immutable submission receipt');
 const three = await fresh();
 const revoke = await overlap('staff revoke wins before waiting customer submission', command({ ...three.input, command: 'revoke', tokenHash: null, expectedTokenId: three.issued.tokenId }), submit(three.token));
 check(revoke.waiting.error?.message.includes('CRM_VOICE_TOKEN_UNAVAILABLE'), 'revoked QR cannot submit after lock wait');
 check(await query(`SELECT status FROM public.lead_visits WHERE id='${three.input.visitId}';`) === 'awaiting_voice', 'revocation does not manufacture Visit completion');
 const four = await fresh();
 const cancel = await overlap('Visit cancellation wins before waiting response', `SELECT public.crm_v2_visits_command('${randomUUID()}',${json({ ...four.scope,
  command: 'cancel_visit', visitId: four.input.visitId, expectedVisitRevision: four.input.expectedVisitRevision, reason: 'SYNTHETIC Visit cancelled', occurredAt: await clock() })});`, submit(four.token));
 check(cancel.waiting.error?.message.includes('CRM_VOICE_TOKEN_UNAVAILABLE'), 'cancelled Visit cannot accept QR response');
 check(await query(`SELECT count(*) FROM public.customer_voices WHERE visit_id='${four.input.visitId}';`) === '0', 'cancel race leaves no survey');
 const five = await fresh(), nextToken = hash();
 const rotate = await overlap('QR rotation invalidates waiting old QR', command({ ...five.input, tokenHash: tokenHash(nextToken), expectedTokenId: five.issued.tokenId }), submit(five.token));
 check(rotate.waiting.error?.message.includes('CRM_VOICE_TOKEN_UNAVAILABLE'), 'rotated old QR is unavailable after wait');
 check(await query(`SELECT count(*) FROM sales_private.visit_submission_tokens WHERE visit_id='${five.input.visitId}' AND consumed_at IS NULL AND revoked_at IS NULL;`) === '1', 'only one current QR after rotation');
 const six = await fresh(false);
 await query(`BEGIN; INSERT INTO sales_private.voice_write_permits VALUES(txid_current(),pg_backend_pid(),'${six.input.visitId}',NULL);
 INSERT INTO sales_private.visit_submission_tokens(visit_id,token_hash,created_at,expires_at) VALUES('${six.input.visitId}','${tokenHash(six.token)}',clock_timestamp(),clock_timestamp()+interval '2 seconds');
 DELETE FROM sales_private.voice_write_permits WHERE transaction_id=txid_current(); COMMIT;`);
 const expired = await overlap('expiry is checked after waiting for customer scope lock', `SELECT public.runtime_voice_race_hold('${six.scope.customerId}');`, submit(six.token));
 check(expired.waiting.error?.message.includes('CRM_VOICE_TOKEN_UNAVAILABLE'), 'token expiring while blocked cannot complete Visit');
 check(await query(`SELECT status FROM public.lead_visits WHERE id='${six.input.visitId}';`) === 'awaiting_voice', 'expiry leaves Visit awaiting actual valid submission');
 check(await query('SELECT count(*) FROM sales_private.voice_write_permits;') === '0', 'no reusable Voice completion permits');
 return { groups, assertions, syntheticOnly: true, productionCertified: false };
}
