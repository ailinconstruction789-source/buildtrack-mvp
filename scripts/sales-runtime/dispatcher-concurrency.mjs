// Synthetic loopback PostgreSQL/HTTP only. No app config, live DB, Cron or login.
// Called after dispatcher-scenarios; immutable fixture history is retained.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const parse = output => {
    const line = output.split(/\r?\n/).find(line => line.startsWith('{'));
    assert.ok(line, 'Query must return explicit JSON rather than silently missing output');
    return JSON.parse(line);
};
const prepareSql = 'SELECT jsonb_build_object(\'value\',sales_private.crm_first_contact_dispatch_prepare());';
const executeSql = claim => `SELECT jsonb_build_object('value',sales_private.crm_first_contact_dispatch_execute(${quote(claim.requestId)}::uuid,${quote(claim.attemptId)}::uuid));`;
const statusSql = 'SELECT jsonb_build_object(\'value\',sales_private.crm_first_contact_dispatch_status());';
const session = (body, app = '') => `BEGIN; SET LOCAL ROLE buildtrack_sales_sla_dispatcher;
    SET LOCAL "request.jwt.claim.sub"=''; ${app ? `SET LOCAL application_name=${quote(app)};` : ''} ${body} COMMIT;`;
const settle = promise => promise.then(value => ({ value }), error => ({ error }));
const delay = ms => new Promise(accept => setTimeout(accept, ms));

export async function runDispatcherConcurrency({ query }) {
    let assertions = 0;
    const labels = [];
    const check = (condition, message) => { assert.ok(condition, message); assertions++; };
    const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const prepare = async () => parse(await query(session(prepareSql))).value;
    const execute = async claim => parse(await query(session(executeSql(claim)))).value;
    const status = async () => parse(await query(session(statusSql))).value;
    const owner = 'fc170000-0000-4000-8000-000000000001';
    const customer = 'fc170000-0000-4000-8000-000000000101';
    await query(`DO $guard$ BEGIN
      IF current_database() !~ '^buildtrack_sales_runtime_' OR current_setting('buildtrack.synthetic_runtime',true) IS DISTINCT FROM 'on'
        OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet THEN RAISE EXCEPTION 'SYNTHETIC ONLY'; END IF;
      END $guard$;
      UPDATE public.crm_settings SET central_intake_enabled=true,lead_work_enabled=true,lead_lifecycle_enabled=true,
        work_schedule_enabled=true,notifications_enabled=true,sla_preview_enabled=true,sla_processing_enabled=true,
        sla_cycle_enabled=true,sla_worker_enabled=true,sla_dispatcher_enabled=true WHERE id;
      UPDATE public.crm_sla_tasks SET status='cancelled' WHERE status='open';
      UPDATE sales_private.crm_first_contact_cycle_cursor SET after_created_at=NULL,after_task_id=NULL WHERE id;
      INSERT INTO auth.users(id) VALUES('${owner}');
      INSERT INTO sales_private.crm_user_roles(user_id,role,display_name,is_active) VALUES('${owner}','sales','SYNTHETIC Dispatcher Sales',true);
      INSERT INTO public.sales_customers(id,customer_name,phone,owner_user_id,created_by_user_id,owner_assigned_at,lead_created_at,created_at,updated_at)
      VALUES('${customer}','SYNTHETIC Dispatcher Lead','0000010701','${owner}','${owner}',now()-interval '25 hours',
        now()-interval '25 hours',now()-interval '25 hours',now()-interval '25 hours');
      INSERT INTO public.crm_sla_tasks(id,customer_id,owner_user_id,task_type,obligation_started_at,service_due_at,created_at,evaluation_snapshot)
      VALUES('fc170000-0000-4000-8000-000000000201','${customer}','${owner}','first_contact',now()-interval '25 hours',
        now()-interval '1 hour',now()-interval '25 hours','{"initialContactHours":24,"clock":"elapsed","staffDueKnown":false}'::jsonb);`);
    // Fixture-only isolation between independent tests. No history is deleted.
    const resetLane = () => query('UPDATE sales_private.crm_first_contact_dispatch_control SET current_request_id=NULL WHERE id;');
    const expire = claim => query(`UPDATE sales_private.crm_first_contact_dispatch_requests SET next_attempt_at=clock_timestamp()
      WHERE request_id=${quote(claim.requestId)}::uuid AND status IN ('reserved','retry_wait');`);
    const snapshot = async () => parse(await query(`SELECT jsonb_build_object(
      'business',jsonb_build_object(
        'customers',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.sales_customers r),
        'tasks',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.crm_sla_tasks r),
        'notices',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.crm_notifications r),
        'audit',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.crm_audit_events r),
        'workerChildren',(SELECT jsonb_agg(to_jsonb(r) ORDER BY request_id) FROM sales_private.crm_first_contact_worker_requests r),
        'workerCycles',(SELECT jsonb_agg(to_jsonb(r) ORDER BY request_id) FROM sales_private.crm_first_contact_worker_cycles r),
        'cursor',(SELECT to_jsonb(r) FROM sales_private.crm_first_contact_cycle_cursor r WHERE id)),
      'requests',(SELECT jsonb_agg(to_jsonb(r) ORDER BY request_id) FROM sales_private.crm_first_contact_dispatch_requests r),
      'attempts',(SELECT jsonb_agg(to_jsonb(r) ORDER BY attempt_id) FROM sales_private.crm_first_contact_dispatch_attempts r),
      'control',(SELECT to_jsonb(r) FROM sales_private.crm_first_contact_dispatch_control r WHERE id));`));
    async function waitSleeping(app) {
        const start = Date.now();
        while (Date.now() - start < 4000) {
            if (await query(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${quote(app)} AND wait_event='PgSleep');`) === 't') return;
            await delay(30);
        }
        throw new Error('Dispatcher holder did not reach its post-lock sleep');
    }
    async function overlap(body, contender, privileged = false) {
        const app = `runtime_dispatch_${randomUUID().slice(0, 8)}`;
        const holder = settle(query(privileged
            ? `BEGIN; SET LOCAL application_name=${quote(app)}; ${body} SELECT pg_sleep(4); COMMIT;`
            : session(`${body} SELECT pg_sleep(4);`, app)));
        let concurrent;
        try { await waitSleeping(app); concurrent = await settle(contender()); }
        finally { const completed = await holder; if (completed.error) throw completed.error; }
        return { held: (await holder).value, concurrent };
    }

    await resetLane();
    const beforePrepare = await snapshot();
    const overlappingPrepare = await overlap(prepareSql, prepare);
    const claim = parse(overlappingPrepare.held).value;
    check(!overlappingPrepare.concurrent.error && overlappingPrepare.concurrent.value === null, 'Concurrent prepare returns busy without another reservation');
    const prepared = await snapshot();
    check(prepared.requests.length === (beforePrepare.requests?.length ?? 0) + 1
        && prepared.attempts.length === (beforePrepare.attempts?.length ?? 0) + 1, 'Only one durable request and reservation were committed');
    check(equal(prepared.business, beforePrepare.business), 'Prepare commit writes no customer work, receipts or cursor');
    check((await status()).requestId === claim.requestId && await prepare() === null, 'Read recovery sees durable intent and duplicate tick respects lease');
    labels.push('concurrent prepare persists exactly one intent before work');

    const overlappingExecute = await overlap(executeSql(claim), () => execute(claim));
    check(!overlappingExecute.concurrent.error && overlappingExecute.concurrent.value === null, 'Concurrent execute is busy while original transaction holds dispatcher lane');
    check(parse(overlappingExecute.held).value.status === 'completed', 'Original execute completes under dispatcher capability');
    const completed = await snapshot();
    check((await execute(claim)).status === 'completed' && await prepare() === null, 'Repeat execute and immediate tick return history or wait, never a new request');
    check(equal(completed, await snapshot()), 'Completion replay, status and duplicate prepare write no rows');
    labels.push('concurrent execute and completed spacing');

    await resetLane();
    const beforeCancel = await snapshot();
    const cancellation = await overlap(`SELECT id FROM public.sales_customers WHERE id='${customer}' FOR UPDATE;`,
        () => query(`SET statement_timeout='300ms'; SET ROLE buildtrack_sales_sla_dispatcher;
          SET "request.jwt.claim.sub"=''; CALL sales_private.crm_first_contact_worker_tick();`), true);
    check(cancellation.concurrent.error?.message.includes('canceling statement due to statement timeout'), 'Actual top-level CALL times out while worker waits on customer lock');
    const afterCancel = await snapshot(), cancellationStatus = await status();
    const cancellationClaim = { requestId: cancellationStatus.requestId, attemptId: cancellationStatus.attemptId };
    check(equal(beforeCancel.business, afterCancel.business), 'Actual procedure cancellation rolls back all business execution');
    check(afterCancel.requests.length === beforeCancel.requests.length + 1
        && afterCancel.attempts.length === beforeCancel.attempts.length + 1
        && cancellationStatus.attemptCount === 1, 'First internal COMMIT survives cancellation of second phase with exactly one durable reservation');
    check(cancellationStatus.status === 'reserved' && await prepare() === null, 'Cancelled attempt stays reserved until lease expires, never falsely reported failed');
    await expire(cancellationClaim);
    const replacement = await prepare();
    check(replacement.requestId === cancellationClaim.requestId && replacement.attemptId !== cancellationClaim.attemptId
        && replacement.attemptNumber === 2, 'Expired cancelled reservation consumes budget and fences a new attempt for SAME request');
    const stale = await settle(execute(cancellationClaim));
    check(stale.error?.message.includes('CRM_SLA_DISPATCH_STALE_ATTEMPT'), 'Cancelled old token cannot execute replacement reservation');
    check((await execute(replacement)).status === 'completed', 'Replacement safely completes the original durable request');
    labels.push('real statement cancellation preserves reservation and retry identity');

    await resetLane();
    const beforeLoss = await snapshot();
    const secret = randomBytes(24).toString('hex'), active = new Set();
    let persistedClaim, persistedCompletion, prepares = 0, executions = 0;
    const server = createServer((request, response) => {
        const work = (async () => {
            if (request.socket.remoteAddress !== '127.0.0.1' || request.headers.authorization !== `Bearer ${secret}`) {
                response.writeHead(403).end(); return;
            }
            if (request.method === 'GET' && request.url === '/status') {
                response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(await status()));
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
        })().catch(() => response.destroy());
        active.add(work); void work.finally(() => active.delete(work));
    });
    try {
        await new Promise((accept, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', accept); });
        const address = server.address();
        assert.ok(address && typeof address === 'object' && address.address === '127.0.0.1');
        const url = `http://127.0.0.1:${address.port}`;
        const post = (path, data) => fetch(`${url}/${path}`, { method: 'POST', headers: { Authorization: `Bearer ${secret}`,
            'Content-Type': 'application/json' }, body: JSON.stringify(data), signal: AbortSignal.timeout(15000) });
        const get = () => fetch(`${url}/status`, { headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(15000) }).then(r => r.json());
        const lostPrepare = await settle(post('prepare', {}));
        check(!!lostPrepare.error && prepares === 1 && persistedClaim?.requestId, 'Socket closes only after durable reservation commit');
        const afterPrepareLoss = await snapshot(), recoveredIntent = await get();
        check(recoveredIntent.requestId === persistedClaim.requestId && recoveredIntent.attemptId === persistedClaim.attemptId
            && recoveredIntent.status === 'reserved', 'Read-only status recovers request and fencing token without client-held ID');
        check(equal(beforeLoss.business, afterPrepareLoss.business) && equal(afterPrepareLoss, await snapshot()), 'Prepare loss and recovery do not process work or alter stored intent');
        const lostExecute = await settle(post('execute', { requestId: recoveredIntent.requestId, attemptId: recoveredIntent.attemptId }));
        check(!!lostExecute.error && executions === 1 && persistedCompletion?.status === 'completed', 'Socket closes only after work and dispatcher completion commit');
        const afterExecuteLoss = await snapshot(), recoveredCompletion = await get();
        check(equal(recoveredCompletion, persistedCompletion) && equal(afterExecuteLoss, await snapshot()), 'Read-only status proves historical completion with no new execution');
        check(await prepare() === null && (await execute(persistedClaim)).status === 'completed', 'Next tick respects spacing and exact-ID retry is historical');
        check(equal(afterExecuteLoss, await snapshot()) && prepares === 1 && executions === 1, 'No automatic network retry or duplicate business effects');
    } finally {
        const closed = new Promise(accept => server.close(accept));
        server.closeAllConnections(); await Promise.all([...active]); await closed;
    }
    labels.push('loopback response loss after each committed dispatcher phase');
    return { groups: labels.length, assertions, labels, realCronTested: false };
}
