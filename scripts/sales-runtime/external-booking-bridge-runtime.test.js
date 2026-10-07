// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { externalBookingBridgeDraftPath, externalBookingBridgeTestBody, runExternalBookingBridgeRuntime } from './external-booking-bridge-runtime.mjs';
const source = readFileSync(externalBookingBridgeDraftPath, 'utf8');
describe('sealed historical booking preparation', () => {
    it('keeps source inert and unwraps only for an isolated test', () => {
        expect(source.trim()).toMatch(/ROLLBACK;$/);
        expect(externalBookingBridgeTestBody(source).trim()).toMatch(/COMMIT;$/);
        expect(readFileSync(externalBookingBridgeDraftPath, 'utf8')).toBe(source);
    });
    it.each([s => s.replace('ROLLBACK;', 'COMMIT;'), s => s.replace("RAISE EXCEPTION 'DESIGN ONLY:", "RAISE EXCEPTION 'APPROVED:"),
        s => s + '\n\\connect production'])('rejects modified guard or connection instructions %#', mutate => {
        expect(() => externalBookingBridgeTestBody(mutate(source))).toThrow();
    });
    it('checks owned loopback database before any other action', async () => {
        const calls = [];
        await expect(runExternalBookingBridgeRuntime({ query: async s => { calls.push(s); return 'f'; }, root: '.', report: {} })).rejects.toThrow();
        expect(calls).toHaveLength(1);
        expect(calls[0]).toContain('buildtrack.synthetic_runtime');
    });
    it('never rewrites shared public data, disables a seal, or grants client access', () => {
        const sql = source.replace(/--[^\n]*/g, '');
        expect(sql).not.toMatch(/(?:INSERT INTO|UPDATE|DELETE FROM|ALTER TABLE|TRUNCATE)\s+(?:public\.|auth\.|account_security_private\.|sales_private\.)/i);
        expect(sql).not.toMatch(/SECURITY DEFINER|DISABLE TRIGGER|DROP TRIGGER|GRANT /i);
        expect(sql).toContain('security_invoker=true');
        expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
        expect(sql).toContain("'activationReady',false");
    });
    it('validates source coverage and identity bindings again before preparing', () => {
        expect(source).toContain('crm_external_private.stage_snapshot(payload)');
        expect(source).toContain('crm_external_private.materialize_crm(p_batch,p_plan_digest');
        expect(source).toContain('EXTERNAL_BOOKING_COVERAGE_REQUIRED');
        expect(source).toContain('prior.legacy_snapshot IS DISTINCT FROM baseline');
    });
    it('does not use null dates or source row order as an inferred booking chronology', () => {
        expect(source).not.toMatch(/booking_round|previous_sale_id|coalesce\([^)]*bookedDate/i);
        expect(source).toContain("(h.payload->>'bookedDate')::date");
        expect(source).toContain("WHERE stage<>'cancelled'");
    });
});
