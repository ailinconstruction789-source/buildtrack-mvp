// Opt-in, synthetic, disposable PostgreSQL ONLY. The runner owns and verifies
// the fresh cluster; this module accepts no URL, credentials, env or live data.
// Burst worker calls measure service cost, NOT actual Cron throughput.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { estimateDispatcherCapacity, summarizeCycleSamples } from './dispatcher-capacity.mjs';

const guard = `DO $guard$ BEGIN
  IF current_database() !~ '^buildtrack_sales_runtime_' OR current_setting('buildtrack.synthetic_runtime',true) IS DISTINCT FROM 'on'
    OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet THEN RAISE EXCEPTION 'SYNTHETIC ONLY'; END IF;
END $guard$;`;
const admin = 'ca170000-0000-4000-8000-000000000001';
const salesId = i => `ca170000-0000-4000-8000-${String(10 + i).padStart(12, '0')}`;
const parse = output => {
    const line = output.split(/\r?\n/).find(value => value.startsWith('{'));
    assert.ok(line, 'Capacity query must return JSON');
    return JSON.parse(line);
};

export async function runCapacityBenchmark({ query }) {
    await query(`${guard}
      CREATE SCHEMA runtime_capacity;
      CREATE TABLE runtime_capacity.base(instant timestamptz NOT NULL);
      INSERT INTO runtime_capacity.base VALUES(clock_timestamp());
      CREATE TABLE runtime_capacity.targets(case_no integer NOT NULL, ordinal integer NOT NULL,
        customer_id uuid NOT NULL UNIQUE, task_id uuid NOT NULL UNIQUE, PRIMARY KEY(case_no,ordinal));
      INSERT INTO auth.users(id) VALUES('${admin}'),${Array.from({ length: 8 }, (_, i) => `('${salesId(i)}')`).join(',')};
      INSERT INTO sales_private.crm_user_roles(user_id,role,is_active) VALUES('${admin}','admin',true),
        ${Array.from({ length: 8 }, (_, i) => `('${salesId(i)}','sales',true)`).join(',')};`);
    // Real Admin RPC, with one continuous span: NOT maximum-calendar stress.
    for (let i = 0; i < 8; i++) {
        const period = offset => `(SELECT to_char((instant ${offset}) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') FROM runtime_capacity.base)`;
        const from = period("-interval '2 days'"), to = period("+interval '2 days'");
        // Construct as fixture owner, then call as Admin; no fixture grants.
        const payload = parse(await query(`SELECT json_build_object('payload',jsonb_build_object(
          'salesUserId','${salesId(i)}','expectedVersion',NULL,
          'coverage',jsonb_build_object('startsAt',${from},'endsAt',${to}),
          'periods',jsonb_build_array(jsonb_build_object('type','work','startsAt',${from},'endsAt',${to})),
          'confirmedComplete',true,'reason','SYNTHETIC capacity calendar'));`)).payload;
        const literal = JSON.stringify(payload).replaceAll("'", "''");
        await query(`BEGIN; SET LOCAL ROLE authenticated; SET LOCAL "request.jwt.claim.sub"='${admin}';
          SELECT public.crm_v2_publish_work_schedule('${randomUUID()}','${literal}'::jsonb); COMMIT;`);
    }
    const cases = [];
    for (const [caseNo, count] of [100, 895].entries()) {
        await query(`${guard}
          UPDATE public.crm_sla_tasks SET status='cancelled' WHERE status='open';
          UPDATE sales_private.crm_first_contact_cycle_cursor SET after_created_at=NULL,after_task_id=NULL WHERE id;
          INSERT INTO runtime_capacity.targets SELECT ${caseNo},i,gen_random_uuid(),gen_random_uuid() FROM generate_series(1,${count}) i;
          INSERT INTO public.sales_customers(id,customer_name,phone,owner_user_id,created_by_user_id,
            owner_assigned_at,lead_created_at,created_at,updated_at)
          SELECT t.customer_id,'SYNTHETIC capacity Lead '||t.ordinal,'00017'||lpad(t.ordinal::text,5,'0'),u.id,u.id,
            b.instant-age.value,b.instant-age.value,b.instant-age.value,b.instant-age.value
          FROM runtime_capacity.targets t CROSS JOIN runtime_capacity.base b
          CROSS JOIN LATERAL (SELECT ('ca170000-0000-4000-8000-'||lpad((10+t.ordinal%8)::text,12,'0'))::uuid id) u
          CROSS JOIN LATERAL (SELECT CASE t.ordinal%4 WHEN 2 THEN interval '23 hours 40 minutes'
            WHEN 3 THEN interval '25 hours' ELSE interval '1 hour' END value) age WHERE t.case_no=${caseNo};
          INSERT INTO public.crm_sla_tasks(id,customer_id,owner_user_id,task_type,obligation_started_at,service_due_at,created_at,evaluation_snapshot)
          SELECT t.task_id,c.id,c.owner_user_id,'first_contact',c.lead_created_at,c.lead_created_at+interval '24 hours',
            b.instant-interval '30 minutes'+t.ordinal*interval '1 microsecond',
            '{"initialContactHours":24,"clock":"elapsed","staffDueKnown":false}'::jsonb
          FROM runtime_capacity.targets t JOIN public.sales_customers c ON c.id=t.customer_id
          CROSS JOIN runtime_capacity.base b WHERE t.case_no=${caseNo};
          INSERT INTO public.crm_audit_events(customer_id,entity_type,entity_id,event_type,reason_text,
            actor_user_id,actor_kind,actor_name_snapshot,new_values,occurred_at,recorded_at)
          SELECT c.id,'customer',c.id,'created','SYNTHETIC historical evidence',c.created_by_user_id,'staff','SYNTHETIC Sales',
            jsonb_build_object('ownerUserId',c.owner_user_id,'intakeStatus','new'),c.lead_created_at,c.lead_created_at
          FROM runtime_capacity.targets t JOIN public.sales_customers c ON c.id=t.customer_id
          WHERE t.case_no=${caseNo} AND t.ordinal%4<>0;
          ANALYZE public.sales_customers; ANALYZE public.crm_sla_tasks; ANALYZE public.crm_audit_events;`);
        const targets = parse(await query(`SELECT json_build_object('targets',json_agg(json_build_object('id',task_id,'ordinal',ordinal) ORDER BY ordinal))
          FROM runtime_capacity.targets WHERE case_no=${caseNo};`)).targets;
        const ordinals = new Map(targets.map(target => [target.id, target.ordinal]));
        const sweeps = [];
        for (let sweep = 0; sweep < 2; sweep++) {
            const seen = [], activeMs = [], sessionMs = [], outcomes = {};
            for (let cycle = 0; cycle < Math.ceil(count / 10); cycle++) {
                const began = performance.now();
                const result = parse(await query(`BEGIN; SET LOCAL ROLE buildtrack_sales_sla_worker;
                  WITH r AS MATERIALIZED (SELECT sales_private.crm_first_contact_worker_cycle('${randomUUID()}') receipt)
                  SELECT jsonb_build_object('receipt',receipt,'activeMs',extract(epoch FROM (
                    (receipt->>'finishedAt')::timestamptz-(receipt->>'startedAt')::timestamptz))*1000) FROM r; COMMIT;`));
                sessionMs.push(performance.now() - began);
                activeMs.push(result.activeMs);
                const receipt = result.receipt;
                assert.equal(receipt.replayed, false);
                assert.equal(receipt.processedCount, Math.min(10, count - cycle * 10));
                assert.equal(receipt.sweepFinished, cycle === Math.ceil(count / 10) - 1);
                assert.equal(receipt.receipts.length, receipt.processedCount);
                for (const child of receipt.receipts) {
                    const ordinal = ordinals.get(child.taskId);
                    assert.ok(ordinal, 'Only the active synthetic workset may be processed');
                    seen.push(child.taskId);
                    const expectedReason = ['MISSING_CREATION_EVIDENCE', 'NOT_DUE_YET', 'DUE_SOON', 'OVERDUE'][ordinal % 4];
                    const expectedOutcome = ordinal % 4 === 0 ? 'held' : ordinal % 4 === 1 ? 'scheduled'
                        : sweep === 0 ? 'notified' : 'already_notified';
                    assert.equal(child.reason, expectedReason);
                    assert.equal(child.outcome, expectedOutcome);
                    outcomes[child.outcome] = (outcomes[child.outcome] ?? 0) + 1;
                }
            }
            assert.deepEqual(seen, targets.map(target => target.id), 'Keyset sweep must be ordered, complete and without duplicates');
            const notices = parse(await query(`SELECT json_build_object('count',count(*)) FROM public.crm_notifications n
              JOIN runtime_capacity.targets t ON t.task_id=n.task_id WHERE t.case_no=${caseNo};`)).count;
            assert.equal(notices, targets.filter(target => target.ordinal % 4 >= 2).length, 'Second sweep must not duplicate notifications');
            sweeps.push({ sweep: sweep + 1, cycles: activeMs.length, outcomes, notices,
                activeMs: summarizeCycleSamples(activeMs), sessionMs: summarizeCycleSamples(sessionMs) });
            process.stdout.write(`Capacity synthetic: ${count} candidates, sweep ${sweep + 1}, ${activeMs.length} cycles; ordering/branches/dedupe passed.\n`);
        }
        // Observation used as a hypothetical input, NOT a dispatcher time bound.
        const observedWorkerSessionBudgetMs = Math.ceil(Math.max(...sweeps.map(sweep => sweep.sessionMs.maxMs)));
        cases.push({ candidateCount: count, owners: 8, calendarPeriodsPerOwner: 1, sweeps,
            modelBudgetSource: 'Observed worker13 psql session maximum, NOT a bound; excludes dispatcher-specific overhead',
            observedWorkerSessionBudgetMs,
            models: [60, 10].map(tickSeconds => estimateDispatcherCapacity({ candidateCount: count, countIsExact: true,
                startsAtSweepHead: true, tickSeconds, cycleBudgetMs: observedWorkerSessionBudgetMs })) });
    }
    // One real SQL14 top-level CALL, then another inside its completion cooldown.
    // Reset only fixture control, never immutable history or production policy.
    await query(`${guard} UPDATE sales_private.crm_first_contact_dispatch_control SET current_request_id=NULL WHERE id;`);
    const counts = async () => parse(await query(`SELECT json_build_object(
      'requests',(SELECT count(*) FROM sales_private.crm_first_contact_dispatch_requests),
      'attempts',(SELECT count(*) FROM sales_private.crm_first_contact_dispatch_attempts),
      'cycles',(SELECT count(*) FROM sales_private.crm_first_contact_worker_cycles),
      'children',(SELECT count(*) FROM sales_private.crm_first_contact_worker_requests),
      'audits',(SELECT count(*) FROM public.crm_audit_events),
      'notices',(SELECT count(*) FROM public.crm_notifications),
      'cursor',(SELECT to_jsonb(r) FROM sales_private.crm_first_contact_cycle_cursor r WHERE id));`));
    const tick = () => query('SET ROLE buildtrack_sales_sla_dispatcher; CALL sales_private.crm_first_contact_worker_tick();');
    const before = await counts(), started = performance.now();
    await tick();
    const topLevelCallSessionMs = performance.now() - started;
    const completed = await counts();
    assert.equal(completed.requests, before.requests + 1);
    assert.equal(completed.attempts, before.attempts + 1);
    assert.equal(completed.cycles, before.cycles + 1);
    assert.equal(completed.children, before.children + 10);
    assert.equal(completed.audits, before.audits + 10);
    const current = parse(await query(`SELECT json_build_object('status',r.status,'processedCount',c.response->'processedCount')
      FROM sales_private.crm_first_contact_dispatch_control d
      JOIN sales_private.crm_first_contact_dispatch_requests r ON r.request_id=d.current_request_id
      JOIN sales_private.crm_first_contact_worker_cycles c ON c.request_id=r.request_id WHERE d.id;`));
    assert.equal(current.status, 'completed'); assert.equal(current.processedCount, 10);
    await tick();
    assert.deepEqual(await counts(), completed, 'Immediate second tick must not create work or move the cursor');
    return { kind: 'LOCAL_SYNTHETIC_SERVICE_COST_AND_OFFLINE_CADENCE', cases,
        dispatcherProbe: { topLevelCallSessionMs, immediateSecondTickSkipped: true, observedOnly: true },
        productionCapacityCertified: false, realCronTested: false, activationReady: false,
        limitations: ['Serial burst worker13 calls do not exercise Cron pacing.',
            'Active timing excludes initial locking and commit; session timing includes local psql startup.',
            'Earlier cases/history remain in the cluster; cache warmup and history growth affect comparisons.',
            'Eight owners with one continuous work period each; no maximum-calendar or production contention test.',
            'Observed maxima are not execution bounds; model assumes static work, successful cycles and fixed phase.',
            '895 synthetic candidates is a scenario, not the real legacy Lead count converted into tasks.'] };
}
