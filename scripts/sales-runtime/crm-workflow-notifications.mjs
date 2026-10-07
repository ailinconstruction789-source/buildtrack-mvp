// Synthetic time-travel fixture only. No scheduler, network, environment or login.
import { randomUUID } from 'node:crypto';

export async function runWorkflowNotifications({ query, check, deny, truth, call, review, request, rpc, uid }) {
    const customerId = 'd0250000-0000-4000-8000-000000000001';
    const taskId = 'd0250000-0000-4000-8000-000000000002';
    // Source times are synthetic by design, not a customer data backfill. Use a
    // historical fake customer/task/proof so no clocks or immutable rows are altered.
    await query(`BEGIN;
      INSERT INTO public.sales_customers(id,customer_name,phone,owner_user_id,created_by_user_id,
        owner_assigned_at,lead_created_at,created_at,updated_at)
      VALUES('${customerId}','SYNTHETIC notification integration','0889711111','${uid(2)}','${uid(2)}',
        now()-interval '23 hours 45 minutes',now()-interval '23 hours 45 minutes',now()-interval '23 hours 45 minutes',now()-interval '23 hours 45 minutes');
      INSERT INTO public.crm_sla_tasks(id,customer_id,owner_user_id,task_type,obligation_started_at,service_due_at,created_at,evaluation_snapshot)
      SELECT '${taskId}',id,owner_user_id,'first_contact',lead_created_at,lead_created_at+interval '24 hours',created_at,
        '{"initialContactHours":24,"clock":"elapsed","staffDueKnown":false}' FROM public.sales_customers WHERE id='${customerId}';
      INSERT INTO public.crm_audit_events(customer_id,entity_type,entity_id,event_type,reason_text,
        actor_user_id,actor_kind,actor_name_snapshot,new_values,occurred_at,recorded_at)
      SELECT id,'customer',id,'created','SYNTHETIC historical fixture only',created_by_user_id,'staff','SYNTHETIC Sales',
        jsonb_build_object('ownerUserId',owner_user_id,'intakeStatus','new'),lead_created_at,lead_created_at
      FROM public.sales_customers WHERE id='${customerId}'; COMMIT;`);
    const coverage = { startsAt: new Date(Date.now() - 172800000).toISOString(), endsAt: new Date(Date.now() + 172800000).toISOString() };
    const scheduleSql = rpc('crm_v2_publish_work_schedule', { salesUserId: uid(2), expectedVersion: null,
        coverage, periods: [{ type: 'work', ...coverage }], confirmedComplete: true, reason: 'SYNTHETIC continuous test coverage, not a real roster' });
    await deny('Sales cannot publish own roster despite forged metadata', request(2, scheduleSql), /CRM_SCHEDULE_FORBIDDEN/);
    await call(1, scheduleSql);
    const workerSql = () => `SELECT sales_private.crm_first_contact_worker_cycle('${randomUUID()}')`;
    for (const role of ['anon', 'authenticated', 'service_role']) {
        await deny(`${role} cannot invoke private notification worker`, `BEGIN; SET LOCAL ROLE ${role}; ${workerSql()}; COMMIT;`, /permission denied/);
    }
    const worker = async () => JSON.parse(await query(`BEGIN; SET LOCAL ROLE buildtrack_sales_sla_worker; ${workerSql()}; COMMIT;`));
    const noticeSql = 'SELECT public.crm_v2_notifications_snapshot()';
    await worker();
    const inbox = await call(2, noticeSql, true);
    const notice = inbox.notifications.find(row => row.taskId === taskId);
    truth('private worker emits due-soon notice to reviewed Sales', notice?.type === 'due_soon');
    truth('notification preserves 24-hour service deadline', Date.parse(notice.serviceDueAt) - Date.parse(await query(`SELECT lead_created_at FROM public.sales_customers WHERE id='${customerId}';`)) === 86400000);
    for (const n of [1, 3, 4]) {
        truth(`role ${n} cannot read another Sales inbox`, (await call(n, noticeSql, true)).notifications.every(row => row.taskId !== taskId));
    }
    const acknowledgeSql = `SELECT public.crm_v2_mark_notification_read('${notice.id}')`;
    await deny('other Sales cannot acknowledge notice', request(4, acknowledgeSql), /CRM_NOTIFICATION_NOT_AVAILABLE/);
    await call(2, acknowledgeSql);
    truth('own notice acknowledgement persists', typeof (await call(2, noticeSql, true)).notifications.find(row => row.id === notice.id)?.readAt === 'string');
    await worker();
    await check('worker retry cycle does not duplicate delivery', `SELECT count(*)=1 FROM public.crm_notifications WHERE task_id='${taskId}' AND withdrawn_at IS NULL;`);
    const serviceDue = await query(`SELECT service_due_at FROM public.crm_sla_tasks WHERE id='${taskId}';`);
    await review(2, 'Sales', false);
    await deny('revoked Sales cannot read inbox through read-only request', request(2, noticeSql, true), /CRM_NOTIFICATION_FORBIDDEN/);
    await deny('revoked Sales cannot acknowledge earlier notice', request(2, acknowledgeSql), /CRM_NOTIFICATION_FORBIDDEN/);
    await worker();
    await check('worker holds disabled owner without deleting task', `SELECT status='open' AND accountability_state='needs_owner'
      AND evaluation_snapshot#>>'{processingReview,reason}'='OWNER_NOT_READY' FROM public.crm_sla_tasks WHERE id='${taskId}';`);
    await check('worker withdraws disabled-owner delivery', `SELECT withdrawn_at IS NOT NULL FROM public.crm_notifications WHERE id='${notice.id}';`);
    await check('role removal never resets customer service deadline', `SELECT service_due_at::text FROM public.crm_sla_tasks WHERE id='${taskId}';`, serviceDue);
    await review(2);
    await check('no cron installed and dispatch switches stay off', `SELECT to_regnamespace('cron') IS NULL
      AND NOT sla_dispatcher_enabled AND NOT sla_burst_enabled FROM public.crm_settings;`);
}
