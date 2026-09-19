// Synthetic disposable loopback PostgreSQL only. Invoked by the verified runner
// after worker-concurrency.mjs. No Supabase, scheduler, credentials or real data.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const dispatcher = 'buildtrack_sales_sla_dispatcher';
const admin = 'ca110000-0000-4000-8000-000000000001';
const sales = 'ca110000-0000-4000-8000-000000000002';
const customers = ['da160000-0000-4000-8000-000000000101', 'da160000-0000-4000-8000-000000000102'];
const tasks = ['da160000-0000-4000-8000-000000000201', 'da160000-0000-4000-8000-000000000202'];
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const uuid = value => value === null ? 'NULL::uuid' : `${quote(value)}::uuid`;
const parse = output => {
    const line = output.split(/\r?\n/).find(value => value.startsWith('{'));
    assert.ok(line, 'Synthetic dispatcher query did not return its JSON result');
    return JSON.parse(line);
};
const guard = `DO $guard$ BEGIN
  IF current_database() !~ '^buildtrack_sales_runtime_' OR current_setting('buildtrack.synthetic_runtime',true) IS DISTINCT FROM 'on'
    OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet THEN RAISE EXCEPTION 'SYNTHETIC ONLY'; END IF;
END $guard$;`;
const session = (body, role = dispatcher) => `BEGIN; SET LOCAL ROLE ${role};
  SET LOCAL "request.jwt.claim.sub"=${quote(role === 'authenticated' ? admin : '')};
  SET LOCAL "request.jwt.claims"=''; ${body} COMMIT;`;
const expression = value => `SELECT json_build_object('value',${value});`;
const prepareExpression = 'sales_private.crm_first_contact_dispatch_prepare()';
const executeExpression = token => `sales_private.crm_first_contact_dispatch_execute(${uuid(token.requestId)},${uuid(token.attemptId)})`;
const statusExpression = id => `sales_private.crm_first_contact_dispatch_status(${uuid(id)})`;

export async function runDispatcherScenarios({ query }) {
    const labels = [];
    let assertions = 0;
    const check = (condition, message) => { assert.ok(condition, message); assertions++; };
    const equal = (left, right, message) => { assert.deepEqual(left, right, message); assertions++; };
    const group = label => { labels.push(label); process.stdout.write(`Dispatcher scenarios: ${label}\n`); };
    const value = async (sqlExpression, role = dispatcher) => parse(await query(session(expression(sqlExpression), role))).value;
    const prepare = () => value(prepareExpression);
    const execute = token => value(executeExpression(token));
    const status = (id = null) => value(statusExpression(id));
    const caught = async (statement, role = dispatcher) => value(`runtime_dispatch_scenarios.catch_error(${quote(statement)})`, role);
    const errorIs = async (statement, marker, label, role = dispatcher) => {
        const actual = await caught(statement, role);
        check(actual?.error === true && (marker.length === 5 ? actual.state === marker : actual.message === marker),
            `${label}: expected ${marker}, received ${JSON.stringify(actual)}`);
    };
    const rejectedQuery = async (sql, marker, label) => {
        let failure;
        try { await query(sql); } catch (error) { failure = error; }
        check(failure?.message.includes(marker), `${label}: expected ${marker}, received ${failure?.message ?? 'success'}`);
    };
    const resetLane = () => query(`${guard} UPDATE sales_private.crm_first_contact_dispatch_control SET current_request_id=NULL WHERE id;`);
    // Deliberately installer-only time travel of a mutable retry deadline in the
    // isolated fixture. Never changes immutable identity/attempt timestamps or
    // replaces/disables a production trigger; no real 60-second sleeps needed.
    const expireLease = id => query(`${guard} UPDATE sales_private.crm_first_contact_dispatch_requests
      SET next_attempt_at=created_at WHERE request_id=${uuid(id)};`);
    const business = async () => parse(await query(`SELECT json_build_object(
      'customers',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.sales_customers r),
      'tasks',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.crm_sla_tasks r),
      'notices',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.crm_notifications r),
      'audits',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.crm_audit_events r),
      'manualChildren',(SELECT jsonb_agg(to_jsonb(r) ORDER BY actor_user_id,request_id) FROM sales_private.crm_first_contact_processing_requests r),
      'manualCycles',(SELECT jsonb_agg(to_jsonb(r) ORDER BY actor_user_id,request_id) FROM sales_private.crm_first_contact_cycle_requests r),
      'workerChildren',(SELECT jsonb_agg(to_jsonb(r) ORDER BY request_id) FROM sales_private.crm_first_contact_worker_requests r),
      'workerCycles',(SELECT jsonb_agg(to_jsonb(r) ORDER BY request_id) FROM sales_private.crm_first_contact_worker_cycles r),
      'cursor',(SELECT to_jsonb(r) FROM sales_private.crm_first_contact_cycle_cursor r WHERE id));`));
    const intents = async () => parse(await query(`SELECT json_build_object(
      'control',(SELECT to_jsonb(r) FROM sales_private.crm_first_contact_dispatch_control r WHERE id),
      'requests',(SELECT jsonb_agg(to_jsonb(r) ORDER BY request_id) FROM sales_private.crm_first_contact_dispatch_requests r),
      'attempts',(SELECT jsonb_agg(to_jsonb(r) ORDER BY request_id,attempt_no) FROM sales_private.crm_first_contact_dispatch_attempts r));`));
    const workerReceipt = async id => parse(await query(`SELECT json_build_object('found',EXISTS(
      SELECT 1 FROM sales_private.crm_first_contact_worker_cycles WHERE request_id=${uuid(id)}));`)).found;

    await query(`${guard}
      DO $fresh$ BEGIN
        IF EXISTS(SELECT 1 FROM sales_private.crm_first_contact_dispatch_requests)
          OR EXISTS(SELECT 1 FROM sales_private.crm_first_contact_dispatch_attempts)
          OR NOT EXISTS(SELECT 1 FROM sales_private.crm_user_roles WHERE user_id='${sales}' AND role='sales' AND is_active)
          THEN RAISE EXCEPTION 'EXPECTED FRESH SYNTHETIC DISPATCH FIXTURE'; END IF;
      END $fresh$;
      CREATE SCHEMA runtime_dispatch_scenarios;
      GRANT USAGE ON SCHEMA runtime_dispatch_scenarios TO anon,authenticated,buildtrack_sales_sla_worker,${dispatcher};
      CREATE FUNCTION runtime_dispatch_scenarios.catch_error(statement text)
      RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $caught$
      DECLARE state_value text; message_value text;
      BEGIN
        BEGIN EXECUTE statement;
        EXCEPTION WHEN OTHERS THEN
          GET STACKED DIAGNOSTICS state_value=RETURNED_SQLSTATE,message_value=MESSAGE_TEXT;
          RETURN jsonb_build_object('error',true,'state',state_value,'message',message_value);
        END;
        RETURN jsonb_build_object('error',false);
      END $caught$;
      UPDATE public.crm_sla_tasks SET status='cancelled' WHERE status='open';
      UPDATE sales_private.crm_first_contact_cycle_cursor SET after_created_at=NULL,after_task_id=NULL WHERE id;
      INSERT INTO public.sales_customers(id,customer_name,phone,owner_user_id,created_by_user_id,
        owner_assigned_at,lead_created_at,created_at,updated_at)
      SELECT id,'SYNTHETIC dispatcher held Lead '||ordinal,'0000016'||ordinal,'${sales}','${sales}',
        transaction_timestamp()-interval '25 hours',transaction_timestamp()-interval '25 hours',
        transaction_timestamp()-interval '25 hours',transaction_timestamp()-interval '25 hours'
      FROM (VALUES('${customers[0]}'::uuid,1),('${customers[1]}'::uuid,2)) c(id,ordinal);
      INSERT INTO public.crm_sla_tasks(id,customer_id,owner_user_id,task_type,obligation_started_at,service_due_at,created_at,evaluation_snapshot)
      SELECT id,customer,'${sales}','first_contact',transaction_timestamp()-interval '25 hours',transaction_timestamp()-interval '1 hour',
        transaction_timestamp()-interval '25 hours','{"initialContactHours":24,"clock":"elapsed","staffDueKnown":false}'::jsonb
      FROM (VALUES('${tasks[0]}'::uuid,'${customers[0]}'::uuid),('${tasks[1]}'::uuid,'${customers[1]}'::uuid)) t(id,customer);`);
    check(parse(await query(`SELECT json_build_object('off',NOT sla_dispatcher_enabled) FROM public.crm_settings WHERE id;`)).off,
        'Dispatcher remains default off after worker setup');
    await errorIs(`SELECT ${prepareExpression}`, 'CRM_SLA_DISPATCH_SETUP_REQUIRED', 'Default-off dispatcher blocks reservation');
    equal(await status(), null, 'No status exists before a durable request');
    check(parse(await query(`SELECT json_build_object('safe',NOT rolcanlogin AND NOT rolinherit AND NOT rolsuper AND NOT rolbypassrls
      AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication) FROM pg_roles WHERE rolname='${dispatcher}';`)).safe,
    'Dispatcher role has no login inheritance replication or elevated bypass');
    await query('UPDATE public.crm_settings SET sla_dispatcher_enabled=true WHERE id;');

    for (const role of ['anon', 'authenticated', 'buildtrack_sales_sla_worker']) {
        await errorIs(`SELECT ${prepareExpression}`, '42501', `${role} cannot reserve dispatcher work`, role);
        await errorIs(`SELECT ${statusExpression(null)}`, '42501', `${role} cannot read dispatcher ledger projection`, role);
        await errorIs('CALL sales_private.crm_first_contact_worker_tick()', '42501', `${role} cannot call dispatcher procedure`, role);
    }
    for (const statement of [
        'SELECT * FROM sales_private.crm_first_contact_dispatch_requests',
        'SELECT * FROM sales_private.crm_first_contact_dispatch_attempts',
        'UPDATE sales_private.crm_first_contact_dispatch_control SET current_request_id=NULL',
        'UPDATE public.crm_settings SET sla_dispatcher_enabled=false',
        `SELECT sales_private.crm_first_contact_worker_cycle('${randomUUID()}')`,
        `SELECT sales_private.crm_first_contact_worker_receipt('${randomUUID()}')`,
        `SELECT sales_private.crm_first_contact_apply(NULL::public.crm_settings,NULL::public.sales_customers,NULL::public.crm_sla_tasks,NULL::sales_private.crm_work_calendars,true,NULL,'forged','system',NULL)`,
    ]) await errorIs(statement, '42501', 'Dispatcher cannot bypass narrow public entry points');
    group('default-off role and direct-entry privilege boundaries');

    const beforeUncommitted = await intents(), businessBeforeUncommitted = await business();
    await rejectedQuery(session(`DO $same_transaction$ DECLARE token jsonb; BEGIN
      token:=sales_private.crm_first_contact_dispatch_prepare();
      PERFORM sales_private.crm_first_contact_dispatch_execute((token->>'requestId')::uuid,(token->>'attemptId')::uuid);
      END $same_transaction$;`), 'CRM_SLA_DISPATCH_NOT_COMMITTED', 'Uncommitted prepare cannot execute worker');
    equal(await intents(), beforeUncommitted, 'Same-transaction rejection leaves no durable intent or attempt');
    equal(await business(), businessBeforeUncommitted, 'Same-transaction rejection never reaches business processing');
    const first = await prepare();
    equal(Object.keys(first).sort(), ['attemptId', 'attemptNumber', 'requestId'], 'Prepare returns only immutable request and fenced attempt token');
    check(first.attemptNumber === 1 && first.requestId !== first.attemptId, 'First committed reservation has separate cycle and attempt identities');
    const firstStatus = await status(first.requestId);
    check(firstStatus.status === 'reserved' && firstStatus.attemptCount === 1 && firstStatus.attemptId === first.attemptId,
        'Separate session sees committed reservation before business work');
    check(typeof firstStatus.createdAt === 'string' && Number.isFinite(Date.parse(firstStatus.createdAt))
        && /(?:Z|\+00:00)$/.test(firstStatus.createdAt), 'Status exposes a valid UTC request creation timestamp');
    check(parse(await query(`SELECT json_build_object('matches',created_at=${quote(firstStatus.createdAt)}::timestamptz)
      FROM sales_private.crm_first_contact_dispatch_requests WHERE request_id=${uuid(first.requestId)};`)).matches,
    'Projected creation timestamp matches immutable stored request creation instant');
    check(await workerReceipt(first.requestId) === false, 'Preparation alone creates no worker cycle');
    equal(await prepare(), null, 'Fresh reservation lease prevents a second attempt');
    equal(await business(), businessBeforeUncommitted, 'Durable prepare and lease check do not process tasks');
    group('committed write-ahead reservation and same-transaction rejection');

    const gates = ['central_intake_enabled', 'lead_work_enabled', 'lead_lifecycle_enabled', 'work_schedule_enabled',
        'notifications_enabled', 'sla_preview_enabled', 'sla_processing_enabled', 'sla_cycle_enabled', 'sla_worker_enabled', 'sla_dispatcher_enabled'];
    const beforeGates = await intents(), beforeGateBusiness = await business();
    for (const [index, gate] of gates.entries()) {
        await query(`UPDATE public.crm_settings SET ${gate}=false WHERE id;`);
        try {
            await errorIs(`SELECT ${prepareExpression}`, 'CRM_SLA_DISPATCH_SETUP_REQUIRED', `Prepare requires ${gate}`);
            await errorIs(`SELECT ${executeExpression(first)}`, 'CRM_SLA_DISPATCH_SETUP_REQUIRED', `Execute requires ${gate}`);
            if (index < 6) await errorIs(`SELECT ${statusExpression(first.requestId)}`, 'CRM_SLA_DISPATCH_SETUP_REQUIRED', `Status requires read gate ${gate}`);
            else equal(await status(first.requestId), firstStatus, `Recovery remains available with ${gate} off`);
        } finally { await query(`UPDATE public.crm_settings SET ${gate}=true WHERE id;`); }
    }
    equal(await intents(), beforeGates, 'Gate checks cannot consume reservation budget');
    equal(await business(), beforeGateBusiness, 'Gate checks cannot change worker state');
    await errorIs(`SELECT sales_private.crm_first_contact_dispatch_execute(NULL,${uuid(first.attemptId)})`, 'CRM_SLA_DISPATCH_INVALID_INPUT', 'NULL request refused');
    await errorIs(`SELECT sales_private.crm_first_contact_dispatch_execute(${uuid(first.requestId)},NULL)`, 'CRM_SLA_DISPATCH_INVALID_INPUT', 'NULL attempt refused');
    await errorIs(`SELECT ${executeExpression({ requestId: randomUUID(), attemptId: first.attemptId })}`, 'CRM_SLA_DISPATCH_NOT_AVAILABLE', 'Unknown request refused');
    await errorIs(`SELECT ${executeExpression({ ...first, attemptId: randomUUID() })}`, 'CRM_SLA_DISPATCH_STALE_ATTEMPT', 'Unreserved attempt token refused');
    group('all ten write gates six read gates and input fencing');

    const completed = await execute(first);
    check(completed.status === 'completed' && completed.requestId === first.requestId && completed.attemptCount === 1,
        'Committed fenced execution completes the reserved cycle');
    equal(completed.createdAt, firstStatus.createdAt, 'Completion preserves original immutable creation timestamp');
    check(await workerReceipt(first.requestId), 'Successful dispatch has authoritative worker receipt');
    const afterCompleteBusiness = await business(), afterCompleteIntents = await intents();
    equal(await execute(first), completed, 'Completed request replay preserves status');
    equal(await prepare(), null, 'Completed cycle observes spacing before another cycle');
    equal(await business(), afterCompleteBusiness, 'Completed retry and spacing check do not duplicate worker effects');
    for (const statement of [
        `UPDATE sales_private.crm_first_contact_dispatch_requests SET next_attempt_at=next_attempt_at WHERE request_id=${uuid(first.requestId)}`,
        `DELETE FROM sales_private.crm_first_contact_dispatch_requests WHERE request_id=${uuid(first.requestId)}`,
    ]) {
        const outcome = parse(await query(expression(`runtime_dispatch_scenarios.catch_error(${quote(statement)})`))).value;
        check(outcome?.error === true && outcome.message === 'CRM_SLA_DISPATCH_INVALID_INPUT',
            'Current completed request refuses privileged update or deletion');
    }
    equal(await intents(), afterCompleteIntents, 'Completed retry does not consume another attempt');
    group('successful fenced execution completion spacing and idempotent recovery');

    await resetLane();
    const beforeBadCall = await intents(), beforeBadCallBusiness = await business();
    await rejectedQuery(session('CALL sales_private.crm_first_contact_worker_tick();'), 'invalid transaction termination',
        'Procedure cannot run inside caller explicit transaction');
    equal(await intents(), beforeBadCall, 'Explicit-transaction CALL failure rolls back its reservation');
    equal(await business(), beforeBadCallBusiness, 'Explicit-transaction CALL cannot process business work');
    // psql stdin executes each statement independently: this CALL is genuinely
    // top-level, not inside BEGIN, a function, a DO block or a fake test wrapper.
    await query(`SET ROLE ${dispatcher}; SET "request.jwt.claim.sub"=''; SET "request.jwt.claims"='';
      CALL sales_private.crm_first_contact_worker_tick(); RESET ROLE;`);
    const tickStatus = await status();
    check(tickStatus?.status === 'completed' && tickStatus.attemptCount === 1, 'Actual top-level procedure commits prepare then execute');
    check(await workerReceipt(tickStatus.requestId), 'Top-level CALL creates exactly its durable worker cycle');
    await errorIs(`SELECT ${executeExpression(first)}`, 'CRM_SLA_DISPATCH_NOT_AVAILABLE', 'Old noncurrent request cannot execute');
    check((await status(first.requestId)).current === false, 'Historical completed request remains read-only recoverable');
    group('actual top-level CALL and unsafe explicit-transaction rejection');

    // Two forced audit faults run only inside this synthetic fixture. The child
    // trigger verifies child one really completed before child two raises.
    await query(`CREATE FUNCTION runtime_dispatch_scenarios.fail_second_child() RETURNS trigger
      LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $failure$
      BEGIN
        IF NOT EXISTS(SELECT 1 FROM sales_private.crm_first_contact_worker_requests r
          WHERE r.task_id='${tasks[0]}' AND r.created_at>=transaction_timestamp()) THEN
          RAISE EXCEPTION 'SYNTHETIC_DISPATCH_FIRST_CHILD_NOT_REACHED';
        END IF;
        IF TG_ARGV[0]='transient' THEN
          RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='SYNTHETIC PRIVATE CONTACT DETAIL MUST NOT LEAK';
        END IF;
        RAISE EXCEPTION 'SYNTHETIC PRIVATE CONTACT DETAIL MUST NOT LEAK';
      END $failure$;`);
    const installFault = mode => query(`CREATE TRIGGER runtime_dispatch_scenarios_fault BEFORE INSERT ON public.crm_audit_events
      FOR EACH ROW WHEN (NEW.entity_type='crm_sla_task' AND NEW.event_type='first_contact_processed' AND NEW.entity_id='${tasks[1]}'::uuid)
      EXECUTE FUNCTION runtime_dispatch_scenarios.fail_second_child(${quote(mode)});`);
    const removeFault = () => query('DROP TRIGGER runtime_dispatch_scenarios_fault ON public.crm_audit_events;');

    await resetLane();
    const permanent = await prepare(), beforeFault = await business();
    await installFault('permanent');
    let held;
    try { held = await execute(permanent); } finally { await removeFault(); }
    check(held.status === 'review' && held.requestId === permanent.requestId && held.attemptCount === 1,
        'Permanent child failure commits safe review state for durable intent');
    check(!JSON.stringify(held).includes('SYNTHETIC PRIVATE') && held.lastErrorCode === 'PROCESSING_REVIEW',
        'Review status contains classified code and never raw private SQL error');
    equal(await business(), beforeFault, 'Second-child failure rolls back all worker business ledger and cursor effects');
    check(await workerReceipt(permanent.requestId) === false, 'Failed atomic cycle has no worker receipt');
    equal(await prepare(), null, 'Review is a hard stop rather than automatic retry');
    equal(await status(permanent.requestId), held, 'Review survives across independent sessions');
    const beforeReviewReplay = await intents();
    equal(await execute(permanent), held, 'Latest fenced token returns terminal review without retrying worker');
    equal(await intents(), beforeReviewReplay, 'Terminal review execute changes no intent or attempt history');
    equal(await business(), beforeFault, 'Terminal review execute cannot perform business work');
    group('durable intent plus atomic second-child failure and privacy-safe review');

    await resetLane();
    const transient = await prepare(), beforeTransient = await business();
    await installFault('transient');
    let waiting;
    try { waiting = await execute(transient); } finally { await removeFault(); }
    check(waiting.status === 'retry_wait' && waiting.requestId === transient.requestId && waiting.attemptCount === 1
        && waiting.lastErrorCode === 'TRANSIENT_RETRY',
        'Known transient fault preserves cycle identity with bounded backoff');
    check(typeof waiting.nextAttemptAt === 'string' && Date.parse(waiting.nextAttemptAt) > Date.now()
        && !JSON.stringify(waiting).includes('SYNTHETIC PRIVATE'), 'Backoff is future-dated and error details are redacted');
    equal(await business(), beforeTransient, 'Transient second-child failure also rolls back every worker effect');
    equal(await prepare(), null, 'Backoff prevents immediate new attempt');
    await expireLease(transient.requestId);
    const retry = await prepare();
    check(retry.requestId === transient.requestId && retry.attemptId !== transient.attemptId && retry.attemptNumber === 2,
        'Due retry retains cycle UUID but reserves a new fenced attempt token');
    await errorIs(`SELECT ${executeExpression(transient)}`, 'CRM_SLA_DISPATCH_STALE_ATTEMPT', 'Prior attempt cannot execute after refencing');
    check((await execute(retry)).status === 'completed', 'Second fenced attempt succeeds after transient fixture removal');
    check(await workerReceipt(retry.requestId), 'Retry commits same durable worker identity');
    group('transient backoff same-cycle retry and stale-token fencing');

    await resetLane();
    const crashBudget = await prepare(), beforeBudgetBusiness = await business();
    let latest = crashBudget;
    for (let attemptNumber = 2; attemptNumber <= 5; attemptNumber++) {
        await expireLease(crashBudget.requestId);
        const next = await prepare();
        check(next.requestId === crashBudget.requestId && next.attemptNumber === attemptNumber && next.attemptId !== latest.attemptId,
            `Abandoned reservation ${attemptNumber} durably consumes same-cycle budget`);
        await errorIs(`SELECT ${executeExpression(latest)}`, 'CRM_SLA_DISPATCH_STALE_ATTEMPT', 'Abandoned token cannot execute after lease refencing');
        latest = next;
    }
    await expireLease(crashBudget.requestId);
    equal(await prepare(), null, 'Sixth abandoned reservation is refused');
    const exhausted = await status(crashBudget.requestId);
    check(exhausted.status === 'review' && exhausted.attemptCount === 5 && exhausted.requestId === crashBudget.requestId
        && exhausted.lastErrorCode === 'RETRY_LIMIT',
        'Five reservations including unexecuted crashes reach durable review stop');
    check(parse(await query(`SELECT json_build_object('count',count(*)) FROM sales_private.crm_first_contact_dispatch_attempts
      WHERE request_id=${uuid(crashBudget.requestId)};`)).count === 5, 'Budget preserves exactly five immutable attempt records');
    equal(await prepare(), null, 'Budget review never creates a fresh cycle to escape the limit');
    equal(await business(), beforeBudgetBusiness, 'Unexecuted reservations and budget exhaustion do not touch business state');
    check(await workerReceipt(crashBudget.requestId) === false, 'No worker receipt is fabricated for abandoned reservations');
    group('abandoned reservations consume bounded budget without identity escape');

    // Do not disable immutability triggers, even in this fixture. These SQL
    // mutations must fail under the actual installed draft protections.
    for (const statement of [
        `UPDATE sales_private.crm_first_contact_dispatch_attempts SET attempt_no=attempt_no WHERE request_id=${uuid(crashBudget.requestId)}`,
        `DELETE FROM sales_private.crm_first_contact_dispatch_attempts WHERE request_id=${uuid(crashBudget.requestId)}`,
        `UPDATE sales_private.crm_first_contact_dispatch_requests SET request_id=${uuid(randomUUID())} WHERE request_id=${uuid(crashBudget.requestId)}`,
        `UPDATE sales_private.crm_first_contact_dispatch_requests SET created_at=created_at+interval '1 second' WHERE request_id=${uuid(crashBudget.requestId)}`,
    ]) {
        const outcome = parse(await query(expression(`runtime_dispatch_scenarios.catch_error(${quote(statement)})`))).value;
        check(outcome?.error === true, 'Privileged fixture cannot mutate durable attempt or request identity');
    }
    const exactStatusKeys = ['attemptCount', 'attemptId', 'completedAt', 'createdAt', 'current', 'lastErrorCode', 'nextAttemptAt', 'policy', 'requestId', 'status'];
    equal(Object.keys(await status()).sort(), exactStatusKeys.sort(), 'Status exposes only explicit safe projection fields');
    equal(await status(randomUUID()), null, 'Unknown recovery identity returns null rather than invented state');
    group('immutable reservation identity attempt history and minimal status projection');

    // Leave all immutable history intact. This installer-only synthetic pointer
    // reset lets the next independently guarded suite own a new test lane; it is
    // not an implemented Admin recovery operation or a production instruction.
    await resetLane();
    return { groups: labels.length, assertions, labels, realCronTested: false };
}
