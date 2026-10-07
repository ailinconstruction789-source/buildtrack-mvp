// Fresh owned synthetic PostgreSQL only; shared by local SQL16 scenarios.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export const burstGuard = `DO $guard$ BEGIN
  IF current_database() !~ '^buildtrack_sales_runtime_' OR current_setting('buildtrack.synthetic_runtime',true) IS DISTINCT FROM 'on'
    OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet THEN RAISE EXCEPTION 'SYNTHETIC ONLY'; END IF;
END $guard$;`;
export const parseBurst = output => {
    const line = output.split(/\r?\n/).find(value => value.startsWith('{'));
    assert.ok(line, 'Synthetic burst query requires JSON'); return JSON.parse(line);
};
export const burstSession = body => `BEGIN; SET LOCAL ROLE buildtrack_sales_sla_dispatcher; ${body} COMMIT;`;
export const burstTickSql = 'SET ROLE buildtrack_sales_sla_dispatcher; CALL sales_private.crm_first_contact_worker_burst_tick();';
export const waitBurstWindow = () => new Promise(resolve => setTimeout(resolve, 10_100));
const admin = 'ba180000-0000-4000-8000-000000000001';
const owner = index => `ba180000-0000-4000-8000-${String(10 + index).padStart(12, '0')}`;

export async function initializeBurstFixture({ query }) {
    await query(`${burstGuard}
      CREATE SCHEMA runtime_burst_native;
      CREATE TABLE runtime_burst_native.targets(case_no integer,ordinal integer,customer_id uuid UNIQUE,task_id uuid UNIQUE,
        seeded_at timestamptz NOT NULL,PRIMARY KEY(case_no,ordinal));
      INSERT INTO auth.users(id) VALUES('${admin}'),${Array.from({ length: 8 }, (_, i) => `('${owner(i)}')`).join(',')};
      INSERT INTO sales_private.crm_user_roles(user_id,role,is_active) VALUES('${admin}','admin',true),
        ${Array.from({ length: 8 }, (_, i) => `('${owner(i)}','sales',true)`).join(',')};`);
    for (let i = 0; i < 8; i++) {
        const payload = parseBurst(await query(`SELECT json_build_object('payload',jsonb_build_object(
          'salesUserId','${owner(i)}','expectedVersion',NULL,
          'coverage',jsonb_build_object('startsAt',to_char((now()-interval '2 days') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
            'endsAt',to_char((now()+interval '2 days') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')),
          'periods',jsonb_build_array(jsonb_build_object('type','work',
            'startsAt',to_char((now()-interval '2 days') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
            'endsAt',to_char((now()+interval '2 days') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))),
          'confirmedComplete',true,'reason','SYNTHETIC burst coverage'));`)).payload;
        const literal = JSON.stringify(payload).replaceAll("'", "''");
        await query(`BEGIN; SET LOCAL ROLE authenticated; SET LOCAL "request.jwt.claim.sub"='${admin}';
          SELECT public.crm_v2_publish_work_schedule('${randomUUID()}','${literal}'::jsonb); COMMIT;`);
    }
}

export async function seedBurstWorkload({ query, count, caseNo, mixed = false }) {
    assert.ok(Number.isSafeInteger(count) && count >= 0 && count <= 1000);
    assert.ok(Number.isSafeInteger(caseNo) && caseNo >= 0 && caseNo < 100);
    assert.equal(typeof mixed, 'boolean');
    // Reset only synthetic fixture isolation pointers; never a production API.
    // Immutable ledgers/admission timestamps remain untouched across cases.
    await query(`${burstGuard}
      UPDATE public.crm_sla_tasks SET status='cancelled' WHERE status='open';
      UPDATE sales_private.crm_first_contact_cycle_cursor SET after_created_at=NULL,after_task_id=NULL WHERE id;
      UPDATE sales_private.crm_first_contact_dispatch_control SET current_request_id=NULL WHERE id;
      INSERT INTO runtime_burst_native.targets SELECT ${caseNo},i,gen_random_uuid(),gen_random_uuid(),statement_timestamp()
        FROM generate_series(1,${count}) i;
      INSERT INTO public.sales_customers(id,customer_name,phone,owner_user_id,created_by_user_id,
        owner_assigned_at,lead_created_at,created_at,updated_at)
      SELECT t.customer_id,'SYNTHETIC burst Lead '||t.ordinal,'00018'||lpad(t.ordinal::text,5,'0'),u.id,u.id,
        t.seeded_at-age.value,t.seeded_at-age.value,t.seeded_at-age.value,t.seeded_at-age.value
      FROM runtime_burst_native.targets t
      CROSS JOIN LATERAL (SELECT ('ba180000-0000-4000-8000-'||lpad((10+t.ordinal%8)::text,12,'0'))::uuid id) u
      CROSS JOIN LATERAL (SELECT CASE t.ordinal%4 WHEN 2 THEN interval '23 hours 30 minutes'
        WHEN 3 THEN interval '25 hours' ELSE interval '1 hour' END value) age WHERE t.case_no=${caseNo};
      INSERT INTO public.crm_sla_tasks(id,customer_id,owner_user_id,task_type,obligation_started_at,service_due_at,created_at,evaluation_snapshot)
      SELECT t.task_id,c.id,c.owner_user_id,'first_contact',c.lead_created_at,c.lead_created_at+interval '24 hours',
        t.seeded_at-interval '30 minutes'+t.ordinal*interval '1 microsecond',
        '{"initialContactHours":24,"clock":"elapsed","staffDueKnown":false}'::jsonb
      FROM runtime_burst_native.targets t JOIN public.sales_customers c ON c.id=t.customer_id WHERE t.case_no=${caseNo};
      ${mixed ? `INSERT INTO public.crm_audit_events(customer_id,entity_type,entity_id,event_type,reason_text,
        actor_user_id,actor_kind,actor_name_snapshot,new_values,occurred_at,recorded_at)
        SELECT c.id,'customer',c.id,'created','SYNTHETIC historical evidence',c.created_by_user_id,'staff','SYNTHETIC Sales',
          jsonb_build_object('ownerUserId',c.owner_user_id,'intakeStatus','new'),c.lead_created_at,c.lead_created_at
        FROM runtime_burst_native.targets t JOIN public.sales_customers c ON c.id=t.customer_id
        WHERE t.case_no=${caseNo} AND t.ordinal%4<>0;` : ''}
      ANALYZE public.crm_sla_tasks; ANALYZE public.crm_audit_events;`);
    return parseBurst(await query(`SELECT json_build_object('targets',COALESCE(json_agg(json_build_object('id',task_id,'ordinal',ordinal)
      ORDER BY ordinal),'[]'::json),'seededAt',min(seeded_at)) FROM runtime_burst_native.targets WHERE case_no=${caseNo};`));
}

export async function burstCounts({ query }) {
    return parseBurst(await query(`SELECT json_build_object(
      'requests',(SELECT count(*) FROM sales_private.crm_first_contact_dispatch_requests),
      'attempts',(SELECT count(*) FROM sales_private.crm_first_contact_dispatch_attempts),
      'admissions',(SELECT count(*) FROM sales_private.crm_first_contact_dispatch_admissions),
      'cycles',(SELECT count(*) FROM sales_private.crm_first_contact_worker_cycles),
      'children',(SELECT count(*) FROM sales_private.crm_first_contact_worker_requests),
      'audits',(SELECT count(*) FROM public.crm_audit_events),
      'notices',(SELECT count(*) FROM public.crm_notifications),
      'cursor',(SELECT to_jsonb(r) FROM sales_private.crm_first_contact_cycle_cursor r WHERE id));`));
}
