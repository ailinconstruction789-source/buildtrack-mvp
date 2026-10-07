// Isolated synthetic PostgreSQL and loopback HTTP only. Run after burst-scenarios.
// No Supabase, real scheduler, deployment, login binding or customer data.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

const dispatcher = 'buildtrack_sales_sla_dispatcher';
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const uuid = value => `${quote(value)}::uuid`;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const settle = promise => promise.then(value => ({ value }), error => ({ error }));
const parse = output => {
    const line = output.split(/\r?\n/).find(value => value.startsWith('{'));
    assert.ok(line, 'Synthetic burst query must return explicit JSON');
    return JSON.parse(line);
};
const guard = `DO $guard$ BEGIN
  IF current_database() !~ '^buildtrack_sales_runtime_' OR current_setting('buildtrack.synthetic_runtime',true) IS DISTINCT FROM 'on'
    OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet THEN RAISE EXCEPTION 'SYNTHETIC BURST ONLY'; END IF;
END $guard$;`;
const session = (sql, app = '') => `BEGIN; SET LOCAL ROLE ${dispatcher};
  SET LOCAL "request.jwt.claim.sub"=''; SET LOCAL "request.jwt.claims"='';
  ${app ? `SET LOCAL application_name=${quote(app)};` : ''} ${sql} COMMIT;`;
const topLevel = name => `SET ROLE ${dispatcher}; SET "request.jwt.claim.sub"=''; SET "request.jwt.claims"='';
  CALL sales_private.${name}(); RESET ROLE;`;
const expression = value => `SELECT jsonb_build_object('value',${value});`;
const burstPrepare = 'sales_private.crm_first_contact_dispatch_burst_prepare()';
const compatiblePrepare = 'sales_private.crm_first_contact_dispatch_prepare()';
const execution = token => `sales_private.crm_first_contact_dispatch_execute(${uuid(token.requestId)},${uuid(token.attemptId)})`;
const statusExpression = 'sales_private.crm_first_contact_dispatch_status()';

export async function runBurstConcurrency({ query }) {
    const labels = [];
    let assertions = 0;
    const check = (condition, message) => { assert.ok(condition, message); assertions++; };
    const equal = (actual, expected, message) => { assert.deepEqual(actual, expected, message); assertions++; };
    const group = label => { labels.push(label); process.stdout.write(`Burst concurrency: ${label}\n`); };
    const value = async sql => parse(await query(session(expression(sql)))).value;
    const prepare = () => value(burstPrepare);
    const execute = token => value(execution(token));
    const status = () => value(statusExpression);
    const resetLane = () => query(`${guard}
      UPDATE sales_private.crm_first_contact_dispatch_control SET current_request_id=NULL WHERE id;
      UPDATE sales_private.crm_first_contact_cycle_cursor SET after_created_at=NULL,after_task_id=NULL WHERE id;`);
    // This is the same mutable deadline fixture adjustment used by14 tests.
    // Admissions, attempt timestamps, request identity and history stay intact.
    const expireLease = token => query(`${guard} UPDATE sales_private.crm_first_contact_dispatch_requests
      SET next_attempt_at=clock_timestamp() WHERE request_id=${uuid(token.requestId)} AND status IN ('reserved','retry_wait');`);
    const snapshot = async () => parse(await query(`SELECT jsonb_build_object(
      'business',jsonb_build_object(
        'settings',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.crm_settings r),
        'customers',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.sales_customers r),
        'tasks',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.crm_sla_tasks r),
        'notices',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.crm_notifications r),
        'audit',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.crm_audit_events r),
        'workerChildren',(SELECT jsonb_agg(to_jsonb(r) ORDER BY request_id) FROM sales_private.crm_first_contact_worker_requests r),
        'workerCycles',(SELECT jsonb_agg(to_jsonb(r) ORDER BY request_id) FROM sales_private.crm_first_contact_worker_cycles r),
        'cursor',(SELECT to_jsonb(r) FROM sales_private.crm_first_contact_cycle_cursor r WHERE id)),
      'requests',(SELECT jsonb_agg(to_jsonb(r) ORDER BY request_id) FROM sales_private.crm_first_contact_dispatch_requests r),
      'attempts',(SELECT jsonb_agg(to_jsonb(r) ORDER BY attempt_id) FROM sales_private.crm_first_contact_dispatch_attempts r),
      'admissions',(SELECT jsonb_agg(to_jsonb(r) ORDER BY admitted_at,attempt_id) FROM sales_private.crm_first_contact_dispatch_admissions r),
      'control',(SELECT to_jsonb(r) FROM sales_private.crm_first_contact_dispatch_control r WHERE id));`));
    const length = rows => rows?.length ?? 0;
    const rateEvidence = async () => parse(await query(`SELECT jsonb_build_object(
      'admissions',count(*),'uniqueAttempts',count(DISTINCT attempt_id),
      'maximumRollingAdmissions',COALESCE(max((SELECT count(*) FROM sales_private.crm_first_contact_dispatch_admissions b
        WHERE b.admitted_at>a.admitted_at-interval '10 seconds' AND b.admitted_at<=a.admitted_at)),0),
      'orphanAdmissions',count(*) FILTER (WHERE NOT EXISTS (
        SELECT 1 FROM sales_private.crm_first_contact_dispatch_attempts x WHERE x.attempt_id=a.attempt_id)))
      FROM sales_private.crm_first_contact_dispatch_admissions a;`));
    async function checkRate(label) {
        const evidence = await rateEvidence();
        check(evidence.maximumRollingAdmissions <= 5, `${label}: no rolling10-second window admits more than five attempts`);
        check(evidence.uniqueAttempts === evidence.admissions && evidence.orphanAdmissions === 0,
            `${label}: every admission uniquely belongs to a durable attempt`);
        return evidence;
    }
    // Real time only: never age or delete immutable admission records to make a
    // cap test pass. A test-only10.1-second pause also clears earlier suite work.
    const freshWindow = () => delay(10100);

    const owner = 'bc210000-0000-4000-8000-000000000001';
    const firstCustomer = 'bc210000-0000-4000-8000-000000001001';
    await query(`${guard}
      UPDATE public.crm_settings SET central_intake_enabled=true,lead_work_enabled=true,lead_lifecycle_enabled=true,
        work_schedule_enabled=true,notifications_enabled=true,sla_preview_enabled=true,sla_processing_enabled=true,
        sla_cycle_enabled=true,sla_worker_enabled=true,sla_dispatcher_enabled=true,sla_burst_enabled=true WHERE id;
      UPDATE public.crm_sla_tasks SET status='cancelled' WHERE status='open';
      INSERT INTO auth.users(id) VALUES('${owner}');
      INSERT INTO sales_private.crm_user_roles(user_id,role,display_name,is_active)
        VALUES('${owner}','sales','SYNTHETIC Burst Concurrency Sales',true);
      INSERT INTO public.sales_customers(id,customer_name,phone,owner_user_id,created_by_user_id,
        owner_assigned_at,lead_created_at,created_at,updated_at)
      SELECT ('bc210000-0000-4000-8000-'||lpad((1000+i)::text,12,'0'))::uuid,
        'SYNTHETIC Burst Concurrency Lead '||i,'0000021'||lpad(i::text,4,'0'),'${owner}','${owner}',
        transaction_timestamp()-interval '25 hours',transaction_timestamp()-interval '25 hours',
        transaction_timestamp()-interval '25 hours',transaction_timestamp()-interval '25 hours'
      FROM generate_series(1,200) i;
      INSERT INTO public.crm_sla_tasks(id,customer_id,owner_user_id,task_type,obligation_started_at,service_due_at,created_at,evaluation_snapshot)
      SELECT ('bc210000-0000-4000-8000-'||lpad((2000+i)::text,12,'0'))::uuid,
        ('bc210000-0000-4000-8000-'||lpad((1000+i)::text,12,'0'))::uuid,'${owner}','first_contact',
        transaction_timestamp()-interval '25 hours',transaction_timestamp()-interval '1 hour',
        transaction_timestamp()-interval '25 hours','{"initialContactHours":24,"clock":"elapsed","staffDueKnown":false}'::jsonb
      FROM generate_series(1,200) i;`);

    await freshWindow();
    await resetLane();
    const beforeMixed = await snapshot();
    let directClaim;
    const mixed = await Promise.all([
        settle(query(topLevel('crm_first_contact_worker_burst_tick'))),
        settle(query(topLevel('crm_first_contact_worker_burst_tick'))),
        settle(query(topLevel('crm_first_contact_worker_tick'))),
        settle((async () => {
            directClaim = await value(compatiblePrepare);
            return directClaim ? execute(directClaim) : null;
        })()),
    ]);
    for (const result of mixed) check(!result.error, `Mixed concurrent entry succeeds or yields busy: ${result.error?.message ?? 'ok'}`);
    // A compatible caller can reserve between another caller's commits and then
    // yield on the lane lock. Finish only that same current reservation, without
    // generating a replacement request or secretly discarding its history.
    const currentMixed = await status();
    if (currentMixed?.status === 'reserved') {
        check((await execute({ requestId: currentMixed.requestId, attemptId: currentMixed.attemptId }))?.status === 'completed',
            'Outstanding mixed-call reservation finishes under its original identity');
    }
    await query(topLevel('crm_first_contact_worker_burst_tick'));
    const afterMixed = await snapshot();
    check(length(afterMixed.admissions) > length(beforeMixed.admissions), 'Concurrent entry paths admit actual work');
    check(length(afterMixed.business.workerCycles) > length(beforeMixed.business.workerCycles), 'Concurrent entry paths complete actual worker cycles');
    const newAdmissions = (afterMixed.admissions ?? []).filter(row => !(beforeMixed.admissions ?? []).some(old => old.attempt_id === row.attempt_id));
    check(newAdmissions.length >= 2, 'Mixed concurrency exercises multiple globally coordinated cycle admissions');
    check((afterMixed.business.workerCycles ?? []).every(row => row.response.processedCount <= 10), 'Every actual worker cycle remains capped at ten tasks');
    await checkRate('Mixed burst old-tick and direct-wrapper entry points');
    group('concurrent burst old tick and direct prepare share the same rolling admission cap');

    await freshWindow();
    await resetLane();
    const beforeCancel = await snapshot();
    const app = `runtime_burst_hold_${randomUUID().slice(0, 8)}`;
    const holder = settle(query(`BEGIN; SET LOCAL application_name=${quote(app)};
      SELECT id FROM public.sales_customers WHERE id='${firstCustomer}' FOR UPDATE; SELECT pg_sleep(4); COMMIT;`));
    let cancellation;
    try {
        const started = Date.now();
        let sleeping = false;
        while (Date.now() - started < 4000) {
            sleeping = await query(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${quote(app)} AND wait_event='PgSleep');`) === 't';
            if (sleeping) break;
            await delay(30);
        }
        check(sleeping, 'Customer holder reaches its observed post-lock sleep');
        cancellation = await settle(query(`SET statement_timeout='300ms'; ${topLevel('crm_first_contact_worker_burst_tick')}`));
    } finally {
        const result = await holder;
        if (result.error) throw result.error;
    }
    check(cancellation.error?.message.includes('canceling statement due to statement timeout'),
        'Real top-level burst CALL is cancelled during second-phase customer lock wait');
    const afterCancel = await snapshot(), reserved = await status();
    equal(afterCancel.business, beforeCancel.business, 'Burst cancellation rolls back every worker business effect');
    check(length(afterCancel.requests) === length(beforeCancel.requests) + 1
        && length(afterCancel.attempts) === length(beforeCancel.attempts) + 1
        && length(afterCancel.admissions) === length(beforeCancel.admissions) + 1,
    'First commit durably retains exactly one request attempt and admission after cancellation');
    check(reserved?.status === 'reserved' && reserved.attemptCount === 1, 'Cancellation does not fabricate failure or discard its reservation');
    const oldToken = { requestId: reserved.requestId, attemptId: reserved.attemptId };
    equal(await prepare(), null, 'Current lease blocks a new burst reservation after cancellation');
    await expireLease(oldToken);
    const retry = await prepare();
    check(retry?.requestId === oldToken.requestId && retry.attemptId !== oldToken.attemptId && retry.attemptNumber === 2,
        'Retry consumes a new admission and attempt while retaining the same cycle UUID');
    const stale = await settle(execute(oldToken));
    check(stale.error?.message.includes('CRM_SLA_DISPATCH_STALE_ATTEMPT'), 'Cancelled original token is fenced after retry reservation');
    const completedRetry = await execute(retry);
    check(completedRetry?.status === 'completed', 'New fenced attempt safely completes the original request');
    const afterRetry = await snapshot();
    check(length(afterRetry.requests) === length(afterCancel.requests)
        && length(afterRetry.attempts) === length(afterCancel.attempts) + 1
        && length(afterRetry.admissions) === length(afterCancel.admissions) + 1,
    'Retries consume rate capacity without creating replacement request identities');
    await checkRate('Cancellation and retry');
    group('burst statement cancellation preserves committed admission and same-cycle fenced retry');

    await freshWindow();
    await resetLane();
    const beforeLoss = await snapshot();
    const secret = randomBytes(24).toString('hex'), active = new Set(), serverErrors = [];
    let persistedClaim, persistedCompletion, prepares = 0, executions = 0, statusReads = 0;
    const server = createServer((request, response) => {
        const work = (async () => {
            if (request.socket.remoteAddress !== '127.0.0.1' || request.headers.authorization !== `Bearer ${secret}`) {
                response.writeHead(403).end(); return;
            }
            if (request.method === 'GET' && request.url === '/status') {
                statusReads++;
                response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
                    .end(JSON.stringify(await status()));
                return;
            }
            let body = '';
            for await (const bytes of request) {
                body += bytes.toString('utf8');
                if (body.length > 256) { response.writeHead(413).end(); return; }
            }
            if (request.method === 'POST' && request.url === '/prepare' && body === '{}') {
                prepares++; persistedClaim = await prepare(); request.socket.destroy(); return;
            }
            if (request.method === 'POST' && request.url === '/execute' && persistedClaim
                && body === JSON.stringify({ requestId: persistedClaim.requestId, attemptId: persistedClaim.attemptId })) {
                executions++; persistedCompletion = await execute(persistedClaim); request.socket.destroy(); return;
            }
            response.writeHead(400).end();
        })().catch(error => { serverErrors.push(error); response.destroy(); });
        active.add(work); void work.finally(() => active.delete(work));
    });
    try {
        await new Promise((accept, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', accept); });
        const address = server.address();
        check(address && typeof address === 'object' && address.address === '127.0.0.1', 'Synthetic transport binds only loopback');
        const url = `http://127.0.0.1:${address.port}`;
        const post = (path, data) => fetch(`${url}/${path}`, { method: 'POST', headers: { Authorization: `Bearer ${secret}`,
            'Content-Type': 'application/json' }, body: JSON.stringify(data), signal: AbortSignal.timeout(15000) });
        const get = async () => {
            const response = await fetch(`${url}/status`, { headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(15000) });
            assert.equal(response.status, 200, 'Synthetic recovery transport must return successful status');
            return response.json();
        };
        const lostPrepare = await settle(post('prepare', {}));
        check(lostPrepare.error && prepares === 1 && persistedClaim?.requestId && serverErrors.length === 0,
            'Intent response socket is lost only after durable prepare and admission commit');
        const afterPrepareLoss = await snapshot(), recoveredIntent = await get();
        check(recoveredIntent.requestId === persistedClaim.requestId && recoveredIntent.attemptId === persistedClaim.attemptId
            && recoveredIntent.status === 'reserved', 'Read-only status recovers durable burst identity without client-held token');
        equal(afterPrepareLoss.business, beforeLoss.business, 'Lost prepare response never performs customer work');
        check(length(afterPrepareLoss.admissions) === length(beforeLoss.admissions) + 1,
            'Lost prepare response leaves one durable admission, not a replacement cycle');
        equal(await snapshot(), afterPrepareLoss, 'Intent recovery does not alter any stored state');
        const lostExecute = await settle(post('execute', { requestId: recoveredIntent.requestId, attemptId: recoveredIntent.attemptId }));
        check(lostExecute.error && executions === 1 && persistedCompletion?.status === 'completed' && serverErrors.length === 0,
            'Execution response socket is lost only after committed business work and completion');
        const afterExecuteLoss = await snapshot();
        check(length(afterExecuteLoss.admissions) === length(afterPrepareLoss.admissions), 'Execution creates no additional admission');
        // Repeat the exact regression boundary with field-level diagnostics, not
        // JSON serialization-order equality and not an automatic processing retry.
        for (let read = 1; read <= 20; read++) {
            equal(await get(), persistedCompletion, `Read-only recovery${read} matches committed completion field by field`);
        }
        equal(await snapshot(), afterExecuteLoss, 'Twenty independent status reads preserve all customer and dispatcher state');
        equal(await execute(persistedClaim), persistedCompletion, 'Explicit same-token execution returns historical completion');
        equal(await snapshot(), afterExecuteLoss, 'Explicit completed retry changes neither admissions nor any business ledger');
        check(prepares === 1 && executions === 1 && statusReads === 21 && serverErrors.length === 0,
            'Transport performs one prepare one execute and21 read-only recoveries without hidden retries');
    } finally {
        const closed = new Promise(accept => server.close(accept));
        server.closeAllConnections(); await Promise.all([...active]); await closed;
    }
    await checkRate('Lost-response recovery');
    group('lost burst responses recover via twenty stable reads and historical explicit retry');
    return { groups: labels.length, assertions, labels, recoveryReads: 20,
        admissionWindowSeconds: 10, admissionLimit: 5, realCronTested: false,
        connectionLoss: 'Real loopback socket loss after real synthetic SQL commit; not deployed Supabase or application HTTP E2E' };
}
