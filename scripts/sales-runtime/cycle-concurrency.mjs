// Verified disposable PostgreSQL ONLY; run after concurrency.mjs's synthetic
// fixture. No app configuration, real JWT, Supabase or scheduler is involved.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

const admin = 'ca110000-0000-4000-8000-000000000001';
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const json = value => `${quote(JSON.stringify(value))}::jsonb`;
const asAdmin = (body, app = '') => `BEGIN; ${app ? `SET LOCAL application_name=${quote(app)};` : ''}
    SET LOCAL ROLE authenticated; SET LOCAL "request.jwt.claim.sub"='${admin}'; ${body} COMMIT;`;
const result = output => JSON.parse(output.split(/\r?\n/).find(line => line.startsWith('{')) ?? '{}');
const cycleSql = requestId => `SELECT public.crm_v2_process_first_contact_cycle(${json({ requestId })});`;
const lookupSql = requestId => `SELECT public.crm_v2_first_contact_cycle_receipt(${json({ requestId })});`;
const delay = ms => new Promise(accept => setTimeout(accept, ms));

export async function runCycleConcurrency({ query }) {
    const labels = [];
    let assertions = 0;
    const check = (condition, message) => { assert.ok(condition, message); assertions++; };
    const settled = promise => promise.then(value => ({ value }), error => ({ error }));
    const process = async requestId => result(await query(asAdmin(cycleSql(requestId))));
    const lookup = async requestId => result(await query(asAdmin(lookupSql(requestId))));
    await query(`DO $guard$ BEGIN
      IF current_database() !~ '^buildtrack_sales_runtime_' OR current_setting('buildtrack.synthetic_runtime',true) IS DISTINCT FROM 'on'
        OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet THEN RAISE EXCEPTION 'SYNTHETIC ONLY'; END IF;
      IF NOT EXISTS(SELECT 1 FROM sales_private.crm_user_roles WHERE user_id='${admin}' AND role='admin' AND is_active)
        OR EXISTS(SELECT 1 FROM sales_private.crm_first_contact_cycle_requests) THEN RAISE EXCEPTION 'EXPECTED FRESH CYCLE FIXTURE'; END IF;
      END $guard$;
      UPDATE public.crm_settings SET sla_cycle_enabled=true WHERE id;`);
    const candidateRows = result(await query(`SELECT json_build_object('rows',json_agg(row_to_json(t) ORDER BY t.created_at,t.id))
      FROM (SELECT id,customer_id,owner_user_id,created_at FROM public.crm_sla_tasks WHERE status='open'
        AND task_type='first_contact' AND project_interest_id IS NULL AND source_activity_id IS NULL) t;`)).rows;
    check(Array.isArray(candidateRows) && candidateRows.length >= 2 && candidateRows.length <= 10, 'Known bounded synthetic candidate set');
    const snapshot = async () => result(await query(`SELECT json_build_object(
      'customers',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.sales_customers c),
      'tasks',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.crm_sla_tasks t),
      'notices',(SELECT jsonb_agg(to_jsonb(n) ORDER BY id) FROM public.crm_notifications n),
      'audits',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.crm_audit_events a),
      'children',(SELECT jsonb_agg(to_jsonb(r) ORDER BY actor_user_id,request_id) FROM sales_private.crm_first_contact_processing_requests r),
      'cycles',(SELECT jsonb_agg(to_jsonb(r) ORDER BY actor_user_id,request_id) FROM sales_private.crm_first_contact_cycle_requests r),
      'cursor',(SELECT to_jsonb(c) FROM sales_private.crm_first_contact_cycle_cursor c WHERE id));`));
    const identical = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    async function waitSleeping(app) {
        const start = Date.now();
        while (Date.now() - start < 4000) {
            if ((await query(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${quote(app)} AND wait_event='PgSleep');`)) === 't') return;
            await delay(30);
        }
        throw new Error('Synthetic holder did not reach its post-lock sleep');
    }
    async function overlap(holderBody, contenderBody, holderIsAdmin = true) {
        const app = `runtime_cycle_${randomUUID().slice(0, 8)}`;
        const body = `${holderBody} SELECT pg_sleep(4);`;
        const holder = settled(query(holderIsAdmin ? asAdmin(body, app) : `BEGIN; SET LOCAL application_name=${quote(app)}; ${body} COMMIT;`));
        let contender;
        try { await waitSleeping(app); contender = await settled(query(asAdmin(contenderBody))); }
        finally { const held = await holder; if (held.error) throw held.error; }
        return { held: result((await holder).value), contender };
    }

    // Distinct cycles do not wait and then accidentally run a second batch.
    const firstId = randomUUID(), busyId = randomUUID();
    const busy = await overlap(cycleSql(firstId), cycleSql(busyId));
    check(busy.contender.error?.message.includes('CRM_SLA_CYCLE_BUSY'), 'Second cycle is refused while global lane is held');
    check(busy.held.processedCount === candidateRows.length && busy.held.sweepFinished === true, 'First cycle processes only bounded selected set');
    check((await lookup(busyId)).found === false, 'Busy attempt creates no parent receipt');
    const afterBusy = await snapshot();
    check(afterBusy.cycles.length === 1, 'Only holder cycle committed');
    check(new Set(busy.held.receipts.map(r => r.taskId)).size === candidateRows.length, 'Each selected task appears once');
    labels.push('distinct cycles share a nonblocking global lane');

    // Same ID can time out on its request lock. After commit retry the SAME ID;
    // a lock error never permits caller to replace an uncertain cycle identity.
    const sameId = randomUUID();
    const same = await overlap(cycleSql(sameId), cycleSql(sameId));
    check(same.contender.error?.message.includes('lock timeout'), 'Same-ID contender has a bounded lock wait');
    const beforeReplay = await snapshot(), replay = await process(sameId);
    check(replay.replayed === true && identical({ ...replay, replayed: false }, same.held), 'Same cycle ID replays complete original child receipts');
    check(identical(beforeReplay, await snapshot()), 'Replay changes no business data or cursor');
    labels.push('same cycle identity survives a concurrent lock timeout');

    // A manual09 command really holds its normal customer/calendar/role/task
    // locks. The cycle must abort atomically instead of committing sibling work.
    const item = candidateRows[1], manualRequest = randomUUID(), blockedId = randomUUID();
    const beforeManual = await snapshot();
    const manual = await overlap(`SELECT public.crm_v2_process_first_contact(${json({ requestId: manualRequest, taskId: item.id })});`, cycleSql(blockedId));
    check(manual.contender.error?.message.includes('lock timeout'), 'Cycle cannot pass a manual command holding a selected customer');
    check((await lookup(blockedId)).found === false, 'Contended cycle leaves no receipt');
    const afterManual = await snapshot();
    check(afterManual.cycles.length === beforeManual.cycles.length, 'No parent ledger effect from aborted cycle');
    check(afterManual.children.length === beforeManual.children.length + 1, 'Only the manual child committed, no cycle siblings');
    check(identical(afterManual.cursor, beforeManual.cursor), 'Aborted cycle cannot skip cursor ahead');
    const retried = await process(blockedId);
    check(retried.replayed === false && retried.processedCount === candidateRows.length, 'Same cycle ID may run after manual lock releases');
    labels.push('manual single-task processor versus all-customer prelocks');

    // Revoke after preliminary MVCC role read. Retained trusted role lock/recheck
    // must refuse; no data can leak through cached replay after revocation either.
    const revokeId = randomUUID(), beforeRevoke = await snapshot();
    const revoked = await overlap(`UPDATE sales_private.crm_user_roles SET is_active=false WHERE user_id='${admin}';`, cycleSql(revokeId), false);
    check(revoked.contender.error?.message.includes('lock timeout'), 'Concurrent Admin revocation prevents cycle authority lock');
    check(identical(beforeRevoke, await snapshot()), 'Revocation-contended cycle commits zero business effects');
    const refused = await settled(query(asAdmin(cycleSql(firstId))));
    check(refused.error?.message.includes('CRM_SLA_CYCLE_FORBIDDEN'), 'Revoked Admin cannot replay cached cycle');
    await query(`UPDATE sales_private.crm_user_roles SET is_active=true WHERE user_id='${admin}';`);
    check((await lookup(revokeId)).found === false, 'Revocation attempt did not leave a hidden receipt');
    labels.push('concurrent role revocation and replay authority');

    // Actual loopback TCP response loss after the REAL SQL transaction commits.
    // Transport is a tiny synthetic fixture, NOT Next handlers/Auth/PostgREST.
    const faultId = randomUUID(), secret = randomBytes(24).toString('hex');
    let committedReceipt, postCalls = 0;
    const active = new Set();
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
                postCalls++;
                committedReceipt = await process(faultId);
                if (postCalls === 1) { request.socket.destroy(); return; }
                response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(committedReceipt));
            } else if (request.method === 'GET' && request.url === '/receipt') {
                response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(await lookup(faultId)));
            } else response.writeHead(404).end();
        })().catch(() => { response.destroy(); });
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
        check(!!lost.error && committedReceipt?.replayed === false && postCalls === 1, 'TCP connection lost only after committed cycle; no automatic POST retry');
        const afterCommit = await snapshot();
        const recovered = await fetch(`${url}/receipt`, { headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(15000) }).then(r => r.json());
        check(recovered.found === true && identical(recovered.receipt, committedReceipt), 'Read-only GET recovers exact committed cycle');
        check(identical(afterCommit, await snapshot()) && postCalls === 1, 'Recovery GET changes no data and does not retry processing');
        const retriedHttp = await post().then(r => r.json());
        check(retriedHttp.replayed === true && identical(retriedHttp.receipts, committedReceipt.receipts), 'Explicit same-ID HTTP retry reuses child receipts');
        check(identical(afterCommit, await snapshot()), 'HTTP replay leaves cursor/notices/audits/ledgers identical');
    } finally {
        const closed = new Promise(accept => server.close(accept));
        server.closeAllConnections();
        await Promise.all([...active]);
        await closed;
    }
    labels.push('loopback TCP loss after SQL commit with read-only recovery');
    return { groups: labels.length, assertions, labels,
        connectionLoss: 'Real loopback HTTP socket loss after real SQL commit, using synthetic transport/auth; NOT Next/Supabase/PostgREST E2E' };
}
