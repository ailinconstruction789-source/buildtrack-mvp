// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { initializeBurstFixture, seedBurstWorkload } from './burst-fixture.mjs';
import { draftPaths, lateDraftPaths } from './safety.mjs';
import { measureSeededDueSoonDelay } from './burst-paced-capacity.mjs';

describe('local burst runtime safety and sequencing', () => {
    const read = name => readFileSync(new URL(name, import.meta.url), 'utf8');
    it('guards the synthetic database before any fixture creation', async () => {
        const query = vi.fn().mockRejectedValue(new Error('refused'));
        await expect(initializeBurstFixture({ query })).rejects.toThrow('refused');
        expect(query).toHaveBeenCalledTimes(1);
        const sql = query.mock.calls[0][0];
        expect(sql.startsWith('DO $guard$')).toBe(true);
        expect(sql).toContain("current_setting('buildtrack.synthetic_runtime',true)");
        expect(sql).toContain("inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet");
        expect(sql.indexOf('END $guard$;')).toBeLessThan(sql.indexOf('CREATE SCHEMA'));
    });
    it.each([-1, 1001, '895', 0.5, NaN, undefined])('rejects invalid synthetic population %s before any query', async count => {
        const query = vi.fn();
        await expect(seedBurstWorkload({ query, count, caseNo: 1 })).rejects.toThrow();
        expect(query).not.toHaveBeenCalled();
    });
    it('compiles policy16 only after original14/15 and optional old capacity checks', () => {
        expect(lateDraftPaths).toEqual(['sql/sales/16_bounded_burst_dispatcher_draft.sql', 'sql/sales/17_queue_monitor_draft.sql', 'sql/sales/18_booking_history_draft.sql', 'sql/sales/19_project_sales_read_draft.sql', 'sql/sales/20_sales_reports_read_draft.sql', 'sql/sales/21_post_booking_draft.sql', 'sql/sales/22_central_search_draft.sql', 'sql/sales/23_visits_draft.sql', 'sql/sales/24_project_interests_draft.sql', 'sql/sales/25_visit_sop_draft.sql', 'sql/sales/26_customer_voices_draft.sql']);
        expect(draftPaths).toContain(lateDraftPaths[0]);
        const source = read('./run.mjs');
        expect(source).toContain('draftPaths.filter(path => !lateDraftPaths.includes(path))');
        expect(source.indexOf('await runDispatcherConcurrency')).toBeLessThan(source.indexOf('for (const path of lateDraftPaths)'));
        expect(source.indexOf('await runCapacityBenchmark')).toBeLessThan(source.indexOf('for (const path of lateDraftPaths)'));
        expect(source.indexOf('await runBurstConcurrency')).toBeLessThan(source.indexOf('await runBurstPacedCapacity'));
        expect(source.indexOf('await runBurstConcurrency')).toBeLessThan(source.indexOf("const monitorOutput ="));
        expect(source).toContain("QUEUE_MONITOR_RUNTIME:");
        expect(source).toContain("options.at(-1) === '--burst-capacity'");
    });
    it('labels a scoped monitor debug run separately and still checks the actual SQL projection', () => {
        const source = read('./run.mjs');
        expect(source).toContain("options.at(-1) === '--queue-monitor-only'");
        expect(source).toContain("queueMonitorOnly ? 'queue-monitor-only' : 'full'");
        expect(source).toContain("bookingOnly ? 'booking-only'");
        expect(source).toContain('const focusedOnly = queueMonitorOnly || bookingOnly');
        expect(source).toContain("QUEUE_MONITOR_SNAPSHOT:");
        expect(source).toContain("'lib/sales/queueMonitorContracts.ts'");
        expect(source).toContain("report.results.queueMonitor.projectionParity = true");
        expect(source.indexOf('await identity(database)')).toBeLessThan(source.indexOf('const monitorOutput'));
        expect(source).toContain('await stopOwnedCluster()');
    });
    it('uses finite real waiting and committed visibility rather than silently accelerating timestamps', () => {
        const source = read('./burst-paced-capacity.mjs');
        expect(source).toContain('wake <= 22');
        expect(source).toContain('tickMs = 15_000');
        expect(source).toContain('await query(burstTickSql)');
        expect(source).toContain('dueSoon.maxMs <= 300_000');
        expect(source).toContain('assert.deepEqual(seen, expectedIds');
        expect(source).toContain('productionCapacityCertified: false');
        expect(source).toContain('realCronTested: false');
        expect(source).not.toMatch(/DISABLE TRIGGER|UPDATE .*admitted_at|process\.env|dotenv|supabase-js|cron\.schedule/i);
    });
});

describe('independent due-soon latency evidence', () => {
    const notice = { type: 'due_soon', eligibilityMatchesSeed: true, expectedEligibleAt: '2026-09-23T00:00:00Z',
        availableAt: '2026-09-23T00:00:00Z', createdAt: '2026-09-23T00:04:00Z',
        notifyAt: '2026-09-22T00:30:00Z' };
    it('measures from the seeded warning threshold, not task anchor or processing time', () => {
        expect(measureSeededDueSoonDelay(notice, '2026-09-23T00:04:30Z')).toBe(270_000);
    });
    it.each([
        { eligibilityMatchesSeed: false }, { type: 'overdue' }, { expectedEligibleAt: 'invalid' },
        { availableAt: '2026-09-23T00:01:00Z' }, { createdAt: '2026-09-22T23:59:59Z' },
        { createdAt: '2026-09-23T00:05:00Z' },
    ])('rejects inconsistent evidence %j', overrides => {
        expect(() => measureSeededDueSoonDelay({ ...notice, ...overrides }, '2026-09-23T00:04:30Z')).toThrow();
    });
    it('rejects an invalid observation time', () => {
        expect(() => measureSeededDueSoonDelay(notice, 'invalid')).toThrow();
    });
});
