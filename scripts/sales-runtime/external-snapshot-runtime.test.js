// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { externalSnapshotDraftPath, externalSnapshotTestBody, runExternalSnapshotRuntime } from './external-snapshot-runtime.mjs';
import { syntheticExternalSnapshot } from './external-snapshot-fixture.mjs';
import { assertSameSheetSnapshotPlan, summarizeSheetSnapshotPlan } from './sheet-snapshot-plan.mjs';

const source = readFileSync(externalSnapshotDraftPath, 'utf8');
describe('external snapshot staging safety boundaries', () => {
    it('keeps the repository draft inert; unwraps only its exact local-test guard', () => {
        const body = externalSnapshotTestBody(source);
        expect(source.trim()).toMatch(/ROLLBACK;$/); expect(body.trim()).toMatch(/COMMIT;$/);
        expect(body).not.toContain("RAISE EXCEPTION 'DESIGN ONLY:");
        expect(readFileSync(externalSnapshotDraftPath, 'utf8')).toBe(source);
    });
    it.each([
        s => s.replace('ROLLBACK;', 'COMMIT;'), s => s.replace('DESIGN ONLY:', 'RUN NOW:'),
        s => s + '\n\\connect remote', s => s.replace('BEGIN;', ''),
    ])('refuses an altered wrapper or connection command %#', mutate => {
        expect(() => externalSnapshotTestBody(mutate(source))).toThrow();
    });
    it('refuses database work before the disposable-cluster check', async () => {
        const calls = [];
        await expect(runExternalSnapshotRuntime({ query: async sql => { calls.push(sql); return 'f'; }, root: '.', report: {} })).rejects.toThrow();
        expect(calls).toHaveLength(1); expect(calls[0]).toContain('buildtrack.synthetic_runtime');
    });
    it('does not touch public/Auth/legacy tables, flags, account grants, or production migration history', () => {
        expect(source).not.toMatch(/(?:CREATE|ALTER|DROP)\s+(?:TABLE|FUNCTION|SCHEMA)\s+(?:public|auth|sales_private|account_security_private)[.\s]/i);
        expect(source.replace(/--[^\n]*/g, '')).not.toMatch(/SECURITY DEFINER|cron\.schedule|UPDATE public\.|INSERT INTO public\.|DO UPDATE|legacy_source_lead_id/);
        expect(source).toContain('SECURITY INVOKER SET search_path');
        expect(source).toContain("feed = 'customer-sheet'");
        expect(source).toContain('batch.payload IS DISTINCT FROM p_plan');
        expect(source).toContain('ON CONFLICT (feed) DO NOTHING');
    });
    it('fixture passes the real assembler and retains unknowns and approved partitions', () => {
        const p = syntheticExternalSnapshot(); assertSameSheetSnapshotPlan(p, p.planDigest);
        expect(summarizeSheetSnapshotPlan(p).counts).toMatchObject({ preservedSourceRows: 5,
            customerCandidates: 3, interestCandidates: 4, bookingHistoryRows: 3, sourceRowsAwaitingAdmin: 2 });
        expect(p.customers[0]).toMatchObject({ sourceRows: [2, 3], ownerLogin: 'JEEJEE', phone: null, leadDate: null });
        expect(p.sourceRecords[3]).toMatchObject({ customerKey: null, disposition: 'admin_review' });
        expect(JSON.stringify(summarizeSheetSnapshotPlan(p))).not.toContain('SYNTHETIC SAME');
    });
    it('keeps the runtime opt-in and uses only synthetic data', () => {
        const runner = readFileSync('scripts/sales-runtime/run.mjs', 'utf8');
        const suite = readFileSync('scripts/sales-runtime/external-snapshot-runtime.mjs', 'utf8');
        expect(runner).toContain("options.at(-1) === '--external-snapshot-only'");
        expect(suite).not.toMatch(/process\.env|createClient\(|\.xlsx|DATABASE_URL/);
        expect(suite).toContain('syntheticExternalSnapshot()');
    });
});
