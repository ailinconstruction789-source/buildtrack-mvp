// Disposable loopback PostgreSQL only; called after the existing concurrency
// fixtures. No production credentials, app config, pg_cron or real HTTP API.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

const admin = 'ca110000-0000-4000-8000-000000000001';
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const json = value => `${quote(JSON.stringify(value))}::jsonb`;
const result = output => JSON.parse(output.split(/\r?\n/).find(line => line.startsWith('{')) ?? '{}');
const cycle = id => `SELECT sales_private.crm_first_contact_worker_cycle(${quote(id)}::uuid);`;
const lookup = id => `SELECT sales_private.crm_first_contact_worker_receipt(${quote(id)}::uuid);`;
const adminCycle = id => `SELECT public.crm_v2_process_first_contact_cycle(${json({ requestId: id })});`;
const session = (body, role, app = '') => `BEGIN; ${app ? `SET LOCAL application_name=${quote(app)};` : ''}
    SET LOCAL ROLE ${role === 'worker' ? 'buildtrack_sales_sla_worker' : 'authenticated'};
    SET LOCAL "request.jwt.claim.sub"=${quote(role === 'worker' ? '' : admin)};
    ${body} COMMIT;`;
const delay = ms => new Promise(accept => setTimeout(accept, ms));

export async function runWorkerConcurrency({ query }) {
    const labels = [];
    let assertions = 0;
    const check = (condition, message) => { assert.ok(condition, message); assertions++; };
    const settled = promise => promise.then(value => ({ value }), error => ({ error }));
    const identical = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const process = async id => result(await query(session(cycle(id), 'worker')));
    const receipt = async id => result(await query(session(lookup(id), 'worker')));
    await query(`DO $guard$ BEGIN
      IF current_database() !~ '^buildtrack_sales_runtime_' OR current_setting('buildtrack.synthetic_runtime',true) IS DISTINCT FROM 'on'
        OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet THEN RAISE EXCEPTION 'SYNTHETIC ONLY'; END IF;
      IF NOT EXISTS(SELECT 1 FROM sales_private.crm_user_roles WHERE user_id='${admin}' AND role='admin' AND is_active)
        OR EXISTS(SELECT 1 FROM sales_private.crm_first_contact_worker_cycles) THEN RAISE EXCEPTION 'EXPECTED FRESH WORKER FIXTURE'; END IF;
      END $guard$;
      UPDATE public.crm_settings SET sla_worker_enabled=true WHERE id;`);
    const candidates = result(await query(`SELECT json_build_object('rows',json_agg(row_to_json(t) ORDER BY t.created_at,t.id))
      FROM (SELECT id,customer_id,created_at FROM public.crm_sla_tasks WHERE status='open' AND task_type='first_contact'
        AND project_interest_id IS NULL AND source_activity_id IS NULL) t;`)).rows;
    check(Array.isArray(candidates) && candidates.length >= 2 && candidates.length <= 10, 'Known bounded worker concurrency fixture');
    const snapshot = async () => result(await query(`SELECT json_build_object(
      'customers',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.sales_customers r),
      'tasks',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.crm_sla_tasks r),
      'notices',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.crm_notifications r),
      'audit',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.crm_audit_events r),
      'adminChildren',(SELECT jsonb_agg(to_jsonb(r) ORDER BY actor_user_id,request_id) FROM sales_private.crm_first_contact_processing_requests r),
      'adminCycles',(SELECT jsonb_agg(to_jsonb(r) ORDER BY actor_user_id,request_id) FROM sales_private.crm_first_contact_cycle_requests r),
      'systemChildren',(SELECT jsonb_agg(to_jsonb(r) ORDER BY request_id) FROM sales_private.crm_first_contact_worker_requests r),
      'systemCycles',(SELECT jsonb_agg(to_jsonb(r) ORDER BY request_id) FROM sales_private.crm_first_contact_worker_cycles r),
      'cursor',(SELECT to_jsonb(r) FROM sales_private.crm_first_contact_cycle_cursor r WHERE id));`));
    async function waitSleeping(app) {
        const started = Date.now();
        while (Date.now() - started < 4000) {
            if (await query(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${quote(app)} AND wait_event='PgSleep');`) === 't') return;
            await delay(30);
        }
        throw new Error('Worker test holder did not reach its post-lock sleep');
    }
    async function overlap(holderBody, holderRole, contenderBody, contenderRole) {
        const app = `runtime_worker_${randomUUID().slice(0, 8)}`;
        const holder = settled(query(session(`${holderBody} SELECT pg_sleep(4);`, holderRole, app)));
        let contender;
        try { await waitSleeping(app); contender = await settled(query(session(contenderBody, contenderRole))); }
        finally { const held = await holder; if (held.error) throw held.error; }
        return { held: result((await holder).value), contender };
    }

    const blocked = randomUUID();
    const adminHolds = await overlap(adminCycle(randomUUID()), 'admin', cycle(blocked), 'worker');
    check(adminHolds.contender.error?.message.includes('CRM_SLA_WORKER_BUSY'), 'Admin batch blocks worker on shared lane');
    check((await receipt(blocked)).found === false, 'Busy worker writes no parent receipt');
    const afterAdmin = await snapshot();
    check(afterAdmin.systemChildren === null && afterAdmin.systemCycles === null, 'Busy worker writes no system children');
    const workerHolds = await overlap(cycle(blocked), 'worker', adminCycle(randomUUID()), 'admin');
    check(workerHolds.contender.error?.message.includes('CRM_SLA_CYCLE_BUSY'), 'Worker batch blocks Admin on same lane');
    check(workerHolds.held.actor.kind === 'system' && workerHolds.held.processedCount === candidates.length, 'System authority processes bounded trusted targets');
    labels.push('manual and system batches share one global lane');

    const sameId = randomUUID();
    const same = await overlap(cycle(sameId), 'worker', cycle(sameId), 'worker');
    check(same.contender.error?.message.includes('lock timeout'), 'Same system identity waits on own bounded request lock');
    const beforeReplay = await snapshot();
    const replay = await process(sameId);
    check(replay.replayed === true && identical({ ...replay, replayed: false }, same.held), 'System replay preserves exact committed child receipts');
    check(identical(beforeReplay, await snapshot()), 'System replay is read-only for every business row and cursor');
    labels.push('concurrent same-ID worker recovery');

    const beforeManual = await snapshot(), blockedManualId = randomUUID();
    const manual = await overlap(`SELECT public.crm_v2_process_first_contact(${json({ requestId: randomUUID(), taskId: candidates[1].id })});`,
        'admin', cycle(blockedManualId), 'worker');
    check(manual.contender.error?.message.includes('lock timeout'), 'Worker cannot pass manual09 holding a later selected customer');
    const afterManual = await snapshot();
    check(identical(beforeManual.systemChildren, afterManual.systemChildren)
        && identical(beforeManual.systemCycles, afterManual.systemCycles), 'Contended worker writes neither system ledger');
    check(identical(beforeManual.cursor, afterManual.cursor), 'Contended worker does not skip cursor');
    check(afterManual.audit.length === beforeManual.audit.length + 1
        && afterManual.adminChildren.length === beforeManual.adminChildren.length + 1, 'Only the actual manual09 child committed');
    check((await receipt(blockedManualId)).found === false, 'Aborted worker is recoverably absent');
    check((await process(blockedManualId)).replayed === false, 'Same worker ID succeeds after manual lock releases');
    labels.push('manual single-task locks versus system all-customer prelocks');

    // Actual socket loss only AFTER a real SQL commit. This synthetic transport
    // does not expose production credentials or claim real Supabase/cron E2E.
    const faultId = randomUUID(), secret = randomBytes(24).toString('hex');
    const active = new Set();
    let committed, posts = 0;
    const server = createServer((request, response) => {
        const work = (async () => {
            if (request.socket.remoteAddress !== '127.0.0.1' || request.headers.authorization !== `Bearer ${secret}`) {
                response.writeHead(403).end(); return;
            }
            if (request.method === 'POST' && request.url === '/cycle') {
                let body = '';
                for await (const bytes of request) {
                    body += bytes.toString('utf8');
                    if (body.length > 128) { response.writeHead(413).end(); return; }
                }
                if (body !== JSON.stringify({ requestId: faultId })) { response.writeHead(400).end(); return; }
                posts++; committed = await process(faultId);
                if (posts === 1) { request.socket.destroy(); return; }
                response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(committed));
            } else if (request.method === 'GET' && request.url === '/receipt') {
                response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(await receipt(faultId)));
            } else response.writeHead(404).end();
        })().catch(() => response.destroy());
        active.add(work); void work.finally(() => active.delete(work));
    });
    try {
        await new Promise((accept, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', accept); });
        const address = server.address();
        assert.ok(address && typeof address === 'object' && address.address === '127.0.0.1');
        const url = `http://127.0.0.1:${address.port}`;
        const post = () => fetch(`${url}/cycle`, { method: 'POST', headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ requestId: faultId }), signal: AbortSignal.timeout(15000) });
        const lost = await settled(post());
        check(!!lost.error && committed?.replayed === false && posts === 1, 'Socket lost after committed system cycle without auto retry');
        const afterCommit = await snapshot();
        const recovered = await fetch(`${url}/receipt`, { headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(15000) }).then(r => r.json());
        check(recovered.found === true && identical(recovered.receipt, committed), 'Read-only lookup recovers system receipt after lost response');
        check(posts === 1 && identical(afterCommit, await snapshot()), 'Recovery lookup writes nothing');
        const retry = await post().then(r => r.json());
        check(retry.replayed === true && identical(retry.receipts, committed.receipts), 'Explicit same-ID retry preserves system children');
        check(identical(afterCommit, await snapshot()), 'Retry does not duplicate notices audit or system ledgers');
    } finally {
        const closed = new Promise(accept => server.close(accept));
        server.closeAllConnections();
        await Promise.all([...active]); await closed;
    }
    labels.push('loopback response loss after system commit');
    return { groups: labels.length, assertions, labels, realCronTested: false };
}
