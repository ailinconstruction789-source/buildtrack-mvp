// Local fixture semantics after late SQL16 compilation. No live database access.
import assert from 'node:assert/strict';
import { burstCounts, burstGuard, burstSession, burstTickSql, initializeBurstFixture, parseBurst, seedBurstWorkload, waitBurstWindow } from './burst-fixture.mjs';

export async function runBurstScenarios({ query }) {
    let assertions = 0;
    const check = (condition, label) => { assert.ok(condition, label); assertions++; };
    const identical = (actual, expected, label) => { assert.deepEqual(actual, expected, label); assertions++; };
    const value = async expression => parseBurst(await query(burstSession(`SELECT json_build_object('value',${expression});`))).value;
    const prepare = () => value('sales_private.crm_first_contact_dispatch_prepare()');
    const execute = token => value(`sales_private.crm_first_contact_dispatch_execute('${token.requestId}','${token.attemptId}')`);
    const status = () => value('sales_private.crm_first_contact_dispatch_status()');
    const denied = async (sql, marker) => {
        let error; try { await query(sql); } catch (caught) { error = caught; }
        check(error?.message.includes(marker), `Expected ${marker}, received ${error?.message ?? 'success'}`);
    };
    await query(burstGuard);
    check(parseBurst(await query('SELECT json_build_object(\'off\',NOT sla_burst_enabled) FROM public.crm_settings WHERE id;')).off,
        'New policy remains default off');
    check(parseBurst(await query(`SELECT json_build_object('old',bool_and(policy_version='completion_spacing_v1'))
      FROM sales_private.crm_first_contact_dispatch_requests;`)).old, 'All retained requests keep original policy');
    await initializeBurstFixture({ query });
    await seedBurstWorkload({ query, count: 55, caseNo: 1 });
    const legacy = await prepare();
    const legacyResult = await execute(legacy);
    identical(legacyResult.policy, { maxItemsPerCycle: 10, maxAttempts: 5, reservationSeconds: 60, minimumSpacingSeconds: 60 },
        'Feature off preserves legacy status contract');
    check(await prepare() === null, 'Feature off preserves completion-based spacing');
    await query('UPDATE public.crm_settings SET sla_burst_enabled=true WHERE id;');
    check(await prepare() === null, 'Enabling burst cannot shorten an existing legacy completion hold');
    check(await value(`sales_private.crm_first_contact_dispatch_burst_continue('${legacy.requestId}')`) === false,
        'Legacy history cannot continue a burst');
    await seedBurstWorkload({ query, count: 55, caseNo: 2 });
    const before = await burstCounts({ query });
    await query(burstTickSql);
    const first = await burstCounts({ query });
    check(first.cycles === before.cycles + 5 && first.children === before.children + 50, 'Top-level call commits five bounded cycles');
    check(first.admissions === before.admissions + 5 && first.attempts === before.attempts + 5, 'Every reservation has a durable admission');
    check((await status()).policy.version === 'bounded_burst_v2', 'New status snapshots the faster policy');
    check(await prepare() === null, 'Direct old prepare entry cannot evade the shared rolling cap');
    await query(burstTickSql);
    identical(await burstCounts({ query }), first, 'Second immediate burst has no extra work or cursor changes');
    await waitBurstWindow();
    await query(burstTickSql);
    const tail = await burstCounts({ query });
    check(tail.cycles === first.cycles + 1 && tail.children === first.children + 5,
        'Tail stops at sweep boundary without repeated sweeps');
    check(await value(`sales_private.crm_first_contact_dispatch_burst_continue('${(await status()).requestId}')`) === false,
        'Final partial cycle cannot continue');

    await seedBurstWorkload({ query, count: 12, caseNo: 3 });
    await waitBurstWindow();
    const reservation = await prepare();
    const reserved = await burstCounts({ query });
    await query('UPDATE public.crm_settings SET sla_burst_enabled=false WHERE id;');
    await denied(burstSession(`SELECT sales_private.crm_first_contact_dispatch_execute('${reservation.requestId}','${reservation.attemptId}');`), 'CRM_SLA_DISPATCH_SETUP_REQUIRED');
    await denied(burstSession('SELECT sales_private.crm_first_contact_dispatch_prepare();'), 'CRM_SLA_DISPATCH_SETUP_REQUIRED');
    check((await status()).status === 'reserved', 'Turning off v2 preserves readable pending evidence');
    identical(await burstCounts({ query }), reserved, 'Disabled execution and fallback attempts leave all data untouched');
    await query('UPDATE public.crm_settings SET sla_burst_enabled=true WHERE id;');
    const completed = await execute(reservation);
    check(completed.status === 'completed', 'Re-enable safely uses the same request and attempt');
    const once = await burstCounts({ query });
    identical(await execute(reservation), completed, 'Exact completed retry returns immutable history');
    identical(await burstCounts({ query }), once, 'Completed retry never spends another admission');

    for (const role of ['anon', 'authenticated', 'buildtrack_sales_sla_worker']) {
        for (const statement of ['SELECT sales_private.crm_first_contact_dispatch_burst_prepare()',
            `SELECT sales_private.crm_first_contact_dispatch_burst_continue('${reservation.requestId}')`,
            'CALL sales_private.crm_first_contact_worker_burst_tick()']) {
            await denied(`SET ROLE ${role}; ${statement};`, 'permission denied');
        }
    }
    for (const statement of ['SELECT sales_private.crm_first_contact_dispatch_prepare_legacy()',
        `SELECT sales_private.crm_first_contact_dispatch_execute_legacy('${reservation.requestId}','${reservation.attemptId}')`,
        'SELECT * FROM sales_private.crm_first_contact_dispatch_admissions']) {
        await denied(burstSession(`${statement};`), 'permission denied');
    }
    await denied(`UPDATE sales_private.crm_first_contact_dispatch_requests SET policy_version='completion_spacing_v1'
      WHERE request_id='${reservation.requestId}';`, 'CRM_SLA_DISPATCH_INVALID_INPUT');
    await denied('UPDATE sales_private.crm_first_contact_dispatch_admissions SET admitted_at=admitted_at;', 'CRM_SLA_PROCESS_INVALID_INPUT');
    await denied('DELETE FROM sales_private.crm_first_contact_dispatch_admissions;', 'CRM_SLA_PROCESS_INVALID_INPUT');

    await seedBurstWorkload({ query, count: 3, caseNo: 4 });
    await waitBurstWindow();
    const emptyBefore = await burstCounts({ query });
    await denied(`BEGIN; SET LOCAL ROLE buildtrack_sales_sla_dispatcher; CALL sales_private.crm_first_contact_worker_burst_tick(); COMMIT;`, 'invalid transaction termination');
    identical(await burstCounts({ query }), emptyBefore, 'Explicit transaction CALL rolls back uncommitted reservation and admission');
    await denied(burstSession(`DO $same$ DECLARE r jsonb; BEGIN r:=sales_private.crm_first_contact_dispatch_burst_prepare();
      PERFORM sales_private.crm_first_contact_dispatch_execute((r->>'requestId')::uuid,(r->>'attemptId')::uuid); END $same$;`), 'CRM_SLA_DISPATCH_NOT_COMMITTED');
    identical(await burstCounts({ query }), emptyBefore, 'Same-transaction execution cannot consume any reservation or admission');
    await query(burstTickSql);
    const small = await burstCounts({ query });
    check(small.cycles === emptyBefore.cycles + 1 && small.children === emptyBefore.children + 3,
        'Small workset finishes after one cycle');
    await seedBurstWorkload({ query, count: 0, caseNo: 5 });
    const noWork = await burstCounts({ query });
    await query(burstTickSql);
    const noWorkAfter = await burstCounts({ query });
    check(noWorkAfter.cycles === noWork.cycles + 1 && noWorkAfter.children === noWork.children,
        'Empty queue produces at most one empty cycle, not five');
    await seedBurstWorkload({ query, count: 55, caseNo: 6 });
    await waitBurstWindow();
    await query(`${burstGuard} CREATE FUNCTION runtime_burst_native.slow_cycle() RETURNS trigger LANGUAGE plpgsql
      SET search_path=pg_catalog AS $slow$ BEGIN
        IF EXISTS(SELECT 1 FROM runtime_burst_native.targets WHERE case_no=6 AND ordinal%10=1 AND task_id=NEW.id)
          THEN PERFORM pg_sleep(3); END IF; RETURN NEW; END $slow$;
      CREATE TRIGGER runtime_burst_slow BEFORE UPDATE OF evaluation_snapshot ON public.crm_sla_tasks
        FOR EACH ROW EXECUTE FUNCTION runtime_burst_native.slow_cycle();`);
    const slowBefore = await burstCounts({ query });
    const slowStarted = Date.now();
    try { await query(burstTickSql); }
    finally { await query('DROP TRIGGER runtime_burst_slow ON public.crm_sla_tasks;'); }
    const slowAfter = await burstCounts({ query });
    check(Date.now() - slowStarted >= 8000 && slowAfter.cycles - slowBefore.cycles >= 1 && slowAfter.cycles - slowBefore.cycles < 5,
        'Real slow work stops starting further cycles after soft budget, without interrupting committed work');
    return { assertions, productionReady: false, realCronTested: false };
}
