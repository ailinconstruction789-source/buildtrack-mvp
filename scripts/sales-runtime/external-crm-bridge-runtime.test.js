// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { externalCrmBridgeDraftPath, externalCrmBridgeTestBody, runExternalCrmBridgeRuntime } from './external-crm-bridge-runtime.mjs';
const source = readFileSync(externalCrmBridgeDraftPath, 'utf8');
describe('sealed external CRM bridge boundaries', () => {
    it('unwraps only the exact local-test guard without changing source', () => {
        expect(externalCrmBridgeTestBody(source).trim()).toMatch(/COMMIT;$/);
        expect(source.trim()).toMatch(/ROLLBACK;$/);
        expect(readFileSync(externalCrmBridgeDraftPath, 'utf8')).toBe(source);
    });
    it.each([s => s.replace('ROLLBACK;', 'COMMIT;'), s => s.replace("RAISE EXCEPTION 'DESIGN ONLY:", "RAISE EXCEPTION 'APPROVED:"),
        s => s + '\n\\connect production'])('rejects modified guard or reconnect %#', mutate => {
        expect(() => externalCrmBridgeTestBody(mutate(source))).toThrow();
    });
    it('refuses work unless adapter confirms owned loopback database', async () => {
        const calls = [];
        await expect(runExternalCrmBridgeRuntime({ query: async s => { calls.push(s); return 'f'; }, root: '.', report: {} })).rejects.toThrow();
        expect(calls).toHaveLength(1); expect(calls[0]).toContain('buildtrack.synthetic_runtime');
    });
    it('keeps inventory, legacy rows, roles, and original foundation candidate untouched', () => {
        const code = source.replace(/--[^\n]*/g, '');
        expect(code).not.toMatch(/(?:INSERT INTO|UPDATE|DELETE FROM|ALTER TABLE)\s+(?:public\.(?:sales\b|plots\b|leads\b|customer_voices\b)|auth\.|account_security_private\.|sales_private\.)/i);
        expect(code).not.toMatch(/SECURITY DEFINER|DISABLE TRIGGER|DROP TRIGGER|GRANT /);
        expect(code).toContain('EXTERNAL_CRM_ACTIVATION_REVIEW_REQUIRED');
        expect(code).toContain("record_origin='legacy_import'");
        expect(code).toContain('MATCH FULL');
        expect(code).toContain('prior.request IS DISTINCT FROM request_value');
    });
    it('preserves input status allowlists rather than making unknown a Sales command', () => {
        const workflow = readFileSync('lib/sales/workflow.ts', 'utf8');
        expect(workflow.match(/export const INTEREST_STATUSES = \[[^\]]*\]/)?.[0]).not.toContain('legacy_unclassified');
    });
});
