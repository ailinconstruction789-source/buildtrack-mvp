// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { runCapacityBenchmark } from './capacity-benchmark.mjs';

describe('opt-in synthetic capacity harness boundaries (no DB execution)', () => {
    const source = readFileSync(new URL('./capacity-benchmark.mjs', import.meta.url), 'utf8');
    const runner = readFileSync(new URL('./run.mjs', import.meta.url), 'utf8');
    it('starts with an owned local fixture guard and stops if the query boundary refuses', async () => {
        const query = vi.fn().mockRejectedValue(new Error('fixture refused'));
        await expect(runCapacityBenchmark({ query })).rejects.toThrow('fixture refused');
        expect(query).toHaveBeenCalledTimes(1);
        const sql = query.mock.calls[0][0];
        expect(sql.startsWith('DO $guard$')).toBe(true);
        expect(sql).toContain("current_database() !~ '^buildtrack_sales_runtime_'");
        expect(sql).toContain("current_setting('buildtrack.synthetic_runtime',true)");
        expect(sql).toContain("inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet");
        expect(sql.indexOf('END $guard$;')).toBeLessThan(sql.indexOf('CREATE SCHEMA'));
    });
    it('is opt-in after existing correctness/concurrency suites and before source integrity verification', () => {
        expect(runner).toContain("options.at(-1) === '--capacity'");
        expect(runner).toContain('(capacity || burstCapacity || focusedOnly) && checkInterrupt');
        expect(runner).toContain("if (capacity) {\n        const { runCapacityBenchmark }");
        expect(runner.indexOf('await runDispatcherConcurrency')).toBeLessThan(runner.indexOf('await runCapacityBenchmark'));
        expect(runner.indexOf('await runCapacityBenchmark')).toBeLessThan(runner.indexOf('Draft changed during test run'));
    });
    it('measures actual bounded worker receipts, ordering, outcomes and duplicate prevention', () => {
        expect(source).toContain('WITH r AS MATERIALIZED');
        expect(source).toContain('SET LOCAL ROLE buildtrack_sales_sla_worker');
        expect(source).toContain('assert.deepEqual(seen, targets.map');
        expect(source).toContain('assert.equal(child.reason, expectedReason)');
        expect(source).toContain('assert.equal(child.outcome, expectedOutcome)');
        expect(source).toContain('Second sweep must not duplicate notifications');
        expect(source).toContain('Immediate second tick must not create work or move the cursor');
    });
    it('never claims production capacity and does not tune policy, disable guards or load app configuration', () => {
        expect(source).toContain('productionCapacityCertified: false');
        expect(source).toContain('realCronTested: false');
        expect(source).toContain('activationReady: false');
        expect(source).not.toMatch(/process\.env|dotenv|supabase-js|DISABLE TRIGGER|ALTER (?:FUNCTION|PROCEDURE)|cron\.schedule/i);
        expect(source).not.toContain('SET next_attempt_at');
    });
});
