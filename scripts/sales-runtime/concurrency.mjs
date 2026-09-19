// Multi-session native PostgreSQL checks. query is supplied ONLY by the verified
// disposable runner. Fake staff/Lead rows never leave that cluster.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const admin = 'ca110000-0000-4000-8000-000000000001';
const sales = 'ca110000-0000-4000-8000-000000000002';
const nextSales = 'ca110000-0000-4000-8000-000000000003';
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const json = value => `${quote(JSON.stringify(value))}::jsonb`;
const asActor = (id, sql, app = '') => `BEGIN; ${app ? `SET LOCAL application_name=${quote(app)};` : ''}
    SET LOCAL ROLE authenticated; SET LOCAL "request.jwt.claim.sub"=${quote(id)}; ${sql} COMMIT;`;
const result = output => JSON.parse(output.split(/\r?\n/).find(line => line.startsWith('{')) ?? '{}');
const delay = ms => new Promise(accept => setTimeout(accept, ms));

export async function runConcurrency({ query }) {
    const labels = [];
    let assertions = 0;
    const check = (condition, message) => { assert.ok(condition, message); assertions++; };
    const errorIs = (value, code) => check(value.error?.message.includes(code), `Expected ${code}, got ${value.error?.message ?? JSON.stringify(value)}`);
    await query(`DO $guard$ BEGIN
      IF current_database() !~ '^buildtrack_sales_runtime_' OR current_setting('buildtrack.synthetic_runtime',true) IS DISTINCT FROM 'on'
        OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet THEN RAISE EXCEPTION 'SYNTHETIC ONLY'; END IF;
      END $guard$;
      INSERT INTO auth.users(id) VALUES ('${admin}'),('${sales}'),('${nextSales}');
      INSERT INTO sales_private.crm_user_roles(user_id,role,display_name) VALUES
        ('${admin}','admin','Synthetic Admin'),('${sales}','sales','Synthetic Sales'),('${nextSales}','sales','Synthetic Other Sales');
      INSERT INTO public.crm_settings(id,central_intake_enabled,lead_work_enabled,lead_lifecycle_enabled,work_schedule_enabled,
        notifications_enabled,sla_preview_enabled,sla_processing_enabled) VALUES(true,true,true,true,true,true,true,true);`);
    const now = Date.now();
    const from = new Date(now - 3 * 86400_000).toISOString();
    const through = new Date(now + 3 * 86400_000).toISOString();
    const schedule = (expectedVersion, owner = sales) => ({ salesUserId: owner, expectedVersion, coverage: { startsAt: from, endsAt: through },
        periods: [{ type: 'work', startsAt: from, endsAt: through }], confirmedComplete: true, reason: 'Synthetic concurrency fixture' });
    const publish = (expectedVersion, owner = sales) => `SELECT public.crm_v2_publish_work_schedule('${randomUUID()}',${json(schedule(expectedVersion, owner))});`;
    let calendar = result(await query(asActor(admin, publish(null))));
    let leadNumber = 0;
    async function newLead(owner = sales) {
        const created = result(await query(asActor(owner, `SELECT public.crm_v2_create_customer('${randomUUID()}',${json({
            name: 'Synthetic concurrency Lead', phone: `080000${String(++leadNumber).padStart(4, '0')}`,
            channel: 'runtime_test', notes: 'FAKE DATA ONLY', interests: [],
        })});`)));
        // Historical timestamps below are explicitly fabricated fixture evidence,
        // NOT production edits, a backfill command or an approved import mechanism.
        return result(await query(`BEGIN;
          UPDATE public.sales_customers SET lead_created_at=now()-interval '25 hours',owner_assigned_at=now()-interval '25 hours',
            created_at=now()-interval '25 hours' WHERE id='${created.customerId}';
          UPDATE public.crm_sla_tasks SET obligation_started_at=now()-interval '25 hours',service_due_at=now()-interval '1 hour',
            created_at=now()-interval '25 hours' WHERE customer_id='${created.customerId}';
          UPDATE public.crm_audit_events SET occurred_at=now()-interval '25 hours',recorded_at=now()-interval '25 hours'
            WHERE customer_id='${created.customerId}' AND event_type='created';
          SELECT json_build_object('customer',c.id,'task',t.id,'revision',c.lifecycle_revision) FROM public.sales_customers c
            JOIN public.crm_sla_tasks t ON t.customer_id=c.id WHERE c.id='${created.customerId}'; COMMIT;`));
    }
    const processSql = (lead, requestId) => `SELECT public.crm_v2_process_first_contact(${json({ requestId, taskId: lead.task })});`;
    const process = async (lead, requestId = randomUUID()) => result(await query(asActor(admin, processSql(lead, requestId))));
    const counts = async lead => result(await query(`SELECT json_build_object(
      'notices',(SELECT count(*) FROM public.crm_notifications WHERE task_id='${lead.task}'),
      'active',(SELECT count(*) FROM public.crm_notifications WHERE task_id='${lead.task}' AND withdrawn_at IS NULL),
      'receipts',(SELECT count(*) FROM sales_private.crm_first_contact_processing_requests WHERE task_id='${lead.task}'),
      'audits',(SELECT count(*) FROM public.crm_audit_events WHERE entity_id='${lead.task}' AND event_type='first_contact_processed'));`));

    // The holder keeps a real transaction open AFTER the command. A distinct
    // backend must be observed waiting for a database lock, not merely launched
    // in Promise.all and assumed to have overlapped. All waits are bounded.
    async function waitState(app, condition) {
        const started = Date.now();
        while (Date.now() - started < 4000) {
            if ((await query(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${quote(app)} AND ${condition});`)) === 't') return;
            await delay(40);
        }
        throw new Error(`Concurrent backend was not observed: ${app} / ${condition}`);
    }
    async function overlap(label, holderBody, contenderBody, holderActor = admin, contenderActor = admin) {
        const tag = randomUUID().slice(0, 8);
        const holdApp = `runtime_hold_${tag}`, waitApp = `runtime_wait_${tag}`;
        const wrap = (actor, body, app) => actor ? asActor(actor, body, app)
            : `BEGIN; SET LOCAL application_name=${quote(app)}; ${body} COMMIT;`;
        const settled = promise => promise.then(value => ({ value }), error => ({ error }));
        const holder = settled(query(wrap(holderActor, `${holderBody} SELECT pg_sleep(5);`, holdApp)));
        let waiter;
        try {
            await waitState(holdApp, "wait_event='PgSleep'");
            waiter = settled(query(wrap(contenderActor, contenderBody, waitApp)));
            await waitState(waitApp, "wait_event_type='Lock'");
        } catch (error) {
            await holder; if (waiter) await waiter;
            throw error;
        }
        const [held, waiting] = await Promise.all([holder, waiter]);
        if (held.error) throw held.error;
        labels.push(label); assertions++;
        return { held: result(held.value), waiting: waiting.error ? waiting : { value: result(waiting.value) } };
    }

    const lead = await newLead();
    const sameId = randomUUID();
    const same = await overlap('same Admin/request blocked until receipt commit', processSql(lead, sameId), processSql(lead, sameId));
    check(same.held.outcome === 'notified' && same.held.replayed === false, 'First call emits one overdue notice');
    check(same.waiting.value?.replayed === true && same.waiting.value.notificationId === same.held.notificationId, 'Contending duplicate replays exact receipt');
    check(JSON.stringify(await counts(lead)) === JSON.stringify({ notices: 1, active: 1, receipts: 1, audits: 1 }), 'Single effect for same request');

    const parallel = await Promise.all(Array.from({ length: 8 }, () => process(lead)));
    check(parallel.every(receipt => receipt.outcome === 'already_notified' && receipt.notificationId === same.held.notificationId), 'Eight new commands do not duplicate notification');
    check((await counts(lead)).notices === 1 && (await counts(lead)).receipts === 9, 'One notice and nine distinct receipts');
    labels.push('eight distinct concurrent requests share delivery dedupe');

    // Deliberately discard a committed response; this models recovery semantics,
    // not an HTTP/network fault injection or a PostgREST integration test.
    const discardedId = randomUUID();
    await process(lead, discardedId);
    check((await process(lead, discardedId)).replayed === true, 'Retry after discarded committed response recovers receipt');
    check((await counts(lead)).receipts === 10, 'Discarded response retry creates no second receipt');
    labels.push('discarded committed response retry');

    const read = await overlap('Sales read acknowledgement versus processing',
        `SELECT public.crm_v2_mark_notification_read('${same.held.notificationId}');`, processSql(lead, randomUUID()), sales);
    check(read.waiting.value?.outcome === 'already_notified', 'Processing retains acknowledged notification');
    check((await query(`SELECT read_at IS NOT NULL FROM public.crm_notifications WHERE id='${same.held.notificationId}';`)) === 't', 'Read receipt is preserved');

    const replacement = await overlap('calendar replacement with unchanged deadline versus processing',
        publish(calendar.version), processSql(lead, randomUUID()));
    calendar = replacement.held;
    check(replacement.waiting.value?.outcome === 'notified' && replacement.waiting.value.notificationId !== same.held.notificationId, 'New calendar version creates correctly bound replacement');
    check((await counts(lead)).notices === 2 && (await counts(lead)).active === 1, 'Old-version notice withdrawn');
    check((await query(`SELECT n.calendar_version_id=h.current_version_id FROM public.crm_notifications n
      JOIN sales_private.crm_work_calendars h ON h.sales_user_id=n.recipient_user_id WHERE n.id='${replacement.waiting.value.notificationId}';`)) === 't', 'Notice uses committed current calendar');

    const firstRosterLead = await newLead(nextSales);
    const firstRoster = await overlap('initial calendar publication versus processing of missing head',
        publish(null, nextSales), processSql(firstRosterLead, randomUUID()));
    check(firstRoster.waiting.value?.outcome === 'notified', 'Missing-head processing waits for first calendar publication');
    check((await query(`SELECT n.calendar_version_id=h.current_version_id FROM public.crm_notifications n
      JOIN sales_private.crm_work_calendars h ON h.sales_user_id=n.recipient_user_id
      WHERE n.id='${firstRoster.waiting.value.notificationId}';`)) === 't', 'First-published version is bound to delivery');

    const beforeRevoke = await counts(lead);
    const revoked = await overlap('Admin revocation versus processing rechecks locked authority',
        `UPDATE sales_private.crm_user_roles SET is_active=false WHERE user_id='${admin}';`, processSql(lead, randomUUID()), null);
    errorIs(revoked.waiting, 'CRM_SLA_PROCESS_FORBIDDEN');
    check(JSON.stringify(await counts(lead)) === JSON.stringify(beforeRevoke), 'Revoked command has zero effects');
    await query(`UPDATE sales_private.crm_user_roles SET is_active=true WHERE user_id='${admin}';`);

    const lifecycle = (item, command, newOwnerUserId) => `SELECT public.crm_v2_change_lead_lifecycle('${randomUUID()}',${json({
        command, customerId: item.customer, interestId: null, expectedRevision: item.revision, expectedActionId: null,
        reason: 'Synthetic concurrency check', ...(newOwnerUserId ? { newOwnerUserId } : {}),
    })});`;
    const closing = await newLead();
    await process(closing);
    const closed = await overlap('Lost closure versus processing sees closed task', lifecycle(closing, 'close_lost'), processSql(closing, randomUUID()));
    check(closed.waiting.value?.outcome === 'closed', 'No delivery after Lead closure');
    check((await counts(closing)).active === 0, 'Closure withdraws active notice');

    const moving = await newLead();
    await process(moving);
    const moved = await overlap('owner reassignment versus in-flight old-owner processing', lifecycle(moving, 'reassign_owner', nextSales), processSql(moving, randomUUID()));
    errorIs(moved.waiting, 'CRM_SLA_PROCESS_NOT_AVAILABLE');
    check((await counts(moving)).active === 0, 'Reassignment leaves no old-owner active delivery');
    const reviewed = await process(moving);
    check(reviewed.outcome === 'held' && reviewed.reason === 'OWNER_REVIEW', 'New processing waits for unapproved reassignment SLA rule');
    check((await query(`SELECT count(*) FROM public.crm_notifications WHERE task_id='${moving.task}' AND recipient_user_id='${nextSales}';`)) === '0', 'No invented new-owner clock/notice');
    return { groups: labels.length, assertions, labels, connectionLoss: 'Discarded-response semantics only; no HTTP fault injection' };
}
