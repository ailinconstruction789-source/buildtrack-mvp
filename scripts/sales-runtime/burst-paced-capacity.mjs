// Opt-in REAL paced top-level SQL16 calls, but only in the disposable local DB.
// This is a finite test, not a scheduler installation or production SLA promise.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { burstCounts, burstSession, burstTickSql, parseBurst, seedBurstWorkload, waitBurstWindow } from './burst-fixture.mjs';
import { estimateBurstCapacity } from './burst-capacity.mjs';
import { summarizeCycleSamples } from './dispatcher-capacity.mjs';

// This fixture's continuous calendar makes its due-soon threshold exactly the
// independently seeded instant. task.notify_at is the contact/work anchor, NOT
// the30-minute threshold. Never start the stopwatch at processing/creation time.
export function measureSeededDueSoonDelay(notice, confirmedAt) {
    assert.equal(notice.type, 'due_soon');
    assert.equal(notice.eligibilityMatchesSeed, true, 'Stored eligibility must match the independently seeded threshold exactly');
    const threshold = Date.parse(notice.expectedEligibleAt), available = Date.parse(notice.availableAt);
    const created = Date.parse(notice.createdAt), observed = Date.parse(confirmedAt);
    assert.ok([threshold, available, created, observed].every(Number.isFinite), 'Latency evidence must contain valid instants');
    assert.equal(available, threshold);
    assert.ok(created >= threshold && observed >= created, 'Committed observation must not precede eligibility or creation');
    return observed - threshold;
}

export async function runBurstPacedCapacity({ query }) {
    // Expire prior fixture admissions with actual time, not synthetic rewrites.
    await waitBurstWindow();
    await query('UPDATE public.crm_settings SET sla_burst_enabled=true WHERE id;');
    const seeded = await seedBurstWorkload({ query, count: 895, caseNo: 80, mixed: true });
    const expectedIds = seeded.targets.map(target => target.id);
    const ordinalById = new Map(seeded.targets.map(target => [target.id, target.ordinal]));
    const before = await burstCounts({ query });
    const began = performance.now(), tickMs = 15_000, samples = [], wakeLatenessMs = [];
    let processed = 0, seenCycles = 0, sweepFinished = false, lastReceipts = [];
    const observedNoticeAt = new Map();
    // At most22 real wakes/5.5min: exceeding the requested5min target is a
    // failure, never hidden by silently raising a timeout or changing policy.
    for (let wake = 1; wake <= 22 && !sweepFinished; wake++) {
        const due = began + wake * tickMs;
        const remaining = due - performance.now();
        if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
        wakeLatenessMs.push(Math.max(0, performance.now() - due));
        const started = performance.now();
        await query(burstTickSql);
        samples.push(performance.now() - started);
        const visible = parseBurst(await query(`SELECT json_build_object('confirmedAt',clock_timestamp(),
          'cycles',COALESCE((SELECT jsonb_agg(w.response ORDER BY w.created_at,w.request_id)
            FROM sales_private.crm_first_contact_worker_cycles w
            JOIN sales_private.crm_first_contact_dispatch_requests r ON r.request_id=w.request_id
            WHERE r.policy_version='bounded_burst_v2' AND r.created_at>=(SELECT min(seeded_at)
              FROM runtime_burst_native.targets WHERE case_no=80)),'[]'::jsonb),
          'notices',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',n.id,'type',n.notification_type,
            'availableAt',n.available_at,'expectedEligibleAt',f.seeded_at,'createdAt',n.created_at,
            'eligibilityMatchesSeed',n.available_at=f.seeded_at AND n.staff_due_at_snapshot=f.seeded_at+interval '30 minutes'
              AND t.staff_due_at=n.staff_due_at_snapshot))
            FROM public.crm_notifications n JOIN public.crm_sla_tasks t ON t.id=n.task_id
            JOIN runtime_burst_native.targets f ON f.task_id=t.id
            WHERE f.case_no=80 AND n.withdrawn_at IS NULL),'[]'::jsonb));`));
        const cycles = visible.cycles;
        assert.ok(cycles.length - seenCycles <= 5, 'Each actual wake processes at most five cycles');
        seenCycles = cycles.length;
        lastReceipts = cycles;
        processed = cycles.reduce((sum, cycle) => sum + cycle.processedCount, 0);
        sweepFinished = cycles.at(-1)?.sweepFinished === true;
        for (const notice of visible.notices) {
            if (!observedNoticeAt.has(notice.id)) observedNoticeAt.set(notice.id, {
                type: notice.type, observedDelayMs: notice.type === 'due_soon'
                    ? measureSeededDueSoonDelay(notice, visible.confirmedAt) : null,
            });
        }
        process.stdout.write(`Paced burst: wake ${wake}, ${processed}/895 synthetic tasks; committed notices ${visible.notices.length}.\n`);
        assert.ok(performance.now() - started < tickMs, 'Local test wake must finish before its next fixed-phase tick');
    }
    assert.equal(sweepFinished, true, 'Finite paced test must finish its complete sweep');
    const seen = lastReceipts.flatMap(cycle => {
        assert.equal(cycle.actor.kind, 'system');
        assert.ok(cycle.processedCount >= 1 && cycle.processedCount <= 10);
        return cycle.receipts.map(child => {
            const ordinal = ordinalById.get(child.taskId);
            assert.ok(ordinal);
            assert.equal(child.reason, ['MISSING_CREATION_EVIDENCE', 'NOT_DUE_YET', 'DUE_SOON', 'OVERDUE'][ordinal % 4]);
            assert.equal(child.outcome, ordinal % 4 === 0 ? 'held' : ordinal % 4 === 1 ? 'scheduled' : 'notified');
            return child.taskId;
        });
    });
    assert.deepEqual(seen, expectedIds, 'Paced scan is ordered and complete without skipped or repeated tasks');
    assert.equal(observedNoticeAt.size, 448);
    const dueSoonDelays = [...observedNoticeAt.values()].filter(notice => notice.type === 'due_soon').map(notice => notice.observedDelayMs);
    assert.equal(dueSoonDelays.length, 224);
    const dueSoon = summarizeCycleSamples(dueSoonDelays);
    assert.ok(dueSoon.maxMs <= 300_000, `Synthetic DB-visible due-soon latency exceeds confirmed5min target: ${dueSoon.maxMs}ms`);
    const counts = await burstCounts({ query });
    assert.equal(counts.cycles - before.cycles, 90);
    assert.equal(counts.children - before.children, 895);
    assert.equal(counts.notices - before.notices, 448);
    const admissions = parseBurst(await query(`SELECT json_build_object('safe',NOT EXISTS (
      SELECT 1 FROM sales_private.crm_first_contact_dispatch_admissions a WHERE
        (SELECT count(*) FROM sales_private.crm_first_contact_dispatch_admissions b
          WHERE b.admitted_at>a.admitted_at-interval '10 seconds' AND b.admitted_at<=a.admitted_at)>5));`));
    assert.equal(admissions.safe, true, 'All synthetic admission history obeys rolling5/10s cap');
    // Twenty independent status lookups exercise the previous recovery assertion
    // with field-level diagnostics, and must have no durable effects.
    const readStatus = async () => parseBurst(await query(burstSession('SELECT json_build_object(\'value\',sales_private.crm_first_contact_dispatch_status());'))).value;
    const historical = await readStatus();
    for (let i = 0; i < 20; i++) assert.deepEqual(await readStatus(), historical, `Historical status stability sample${i + 1}`);
    assert.deepEqual(await burstCounts({ query }), counts, 'Recovery status soak never starts work');
    return { kind: 'FINITE_LOCAL_PACED_SQL16_TEST', candidateCount: 895, tickSeconds: 15, wakes: samples.length,
        cycles: 90, processed: 895, notices: 448, dueSoon: { ...dueSoon, targetMs: 300_000, observedWithinTarget: true },
        measurement: 'First separate-query observation after commit, relative to independently seeded due-soon threshold; stored available_at must match exactly. NOT browser rendering latency',
        callSessionMs: summarizeCycleSamples(samples), maxObservedWakeLatenessMs: Math.max(...wakeLatenessMs),
        statusReadsWithoutWrites: 20, rollingAdmissionCapVerified: true,
        modelWithHypotheticalOneSecondCycle: estimateBurstCapacity({ candidateCount: 895, countIsExact: true,
            startsAtSweepHead: true, admissionWindowKnownClear: true, tickSeconds: 15, cycleBudgetMs: 1000 }),
        productionCapacityCertified: false, realCronTested: false, activationReady: false,
        limitations: ['Static mixed workset,8 owners,one continuous calendar period each; no concurrent production workload.',
            'Tick timing supplied by finite local test, not real Supabase Cron.',
            'Commit visibility is measured, not Sales browser polling/rendering.',
            'Observed local maxima are not execution bounds or delivery guarantees.'] };
}
