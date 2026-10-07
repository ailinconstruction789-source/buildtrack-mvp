// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { externalSalesCutoverDraftPath, externalSalesCutoverTestBody, runExternalSalesCutoverRuntime } from './external-sales-cutover-runtime.mjs';

describe('isolated replacement and selective rollback harness', () => {
    it('checks loopback identity before reading files or running any change', async () => {
        const calls = [];
        await expect(runExternalSalesCutoverRuntime({ query: async sql => { calls.push(sql); return 'f'; }, root: '.', report: {} })).rejects.toThrow();
        expect(calls).toHaveLength(1);
        expect(calls[0]).toContain('buildtrack.synthetic_runtime');
        expect(calls[0]).toContain("inet_server_addr()='127.0.0.1'");
    });
    it('keeps draft inert and transforms it only in test memory', () => {
        const source = readFileSync(externalSalesCutoverDraftPath, 'utf8');
        expect(source.trim()).toMatch(/ROLLBACK;$/);
        expect(externalSalesCutoverTestBody(source).trim()).toMatch(/COMMIT;$/);
        expect(readFileSync(externalSalesCutoverDraftPath, 'utf8')).toBe(source);
    });
    it.each([s => s.replace('ROLLBACK;', 'COMMIT;'), s => s.replace('DESIGN ONLY:', 'APPROVED:'),
        s => `${s}\n\\connect remote`])('rejects changed guard and connection instructions %#', mutate => {
        expect(() => externalSalesCutoverTestBody(mutate(readFileSync(externalSalesCutoverDraftPath, 'utf8')))).toThrow();
    });
    it('does not disable triggers, change authentication or grant client access', () => {
        const sql = readFileSync(externalSalesCutoverDraftPath, 'utf8').replace(/--[^\n]*/g, '');
        expect(sql).not.toMatch(/DISABLE TRIGGER|session_replication_role|\bGRANT\b/i);
        expect(sql).not.toMatch(/(?:UPDATE|DELETE FROM|INSERT INTO)\s+(?:auth\.|account_security_private\.|public\.(?:leads|customer_voices|crm_settings))/i);
        expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/i);
        // Only the private DML trigger reads permits with elevated privileges;
        // replace/rollback entry points still run as the database operator.
        expect(sql.match(/SECURITY DEFINER/gi)).toHaveLength(1);
        expect(sql).toMatch(/replace_sales[\s\S]+RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER/);
        expect(sql).toMatch(/rollback_sales[\s\S]+RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER/);
    });
    it('runner remains an isolated fixture and never loads app credentials', () => {
        const source = readFileSync('scripts/sales-runtime/external-sales-cutover-runtime.mjs', 'utf8');
        expect(source).not.toMatch(/dotenv|createClient|DATABASE_URL|SUPABASE_URL|fetch\(/);
        expect(readFileSync('scripts/sales-runtime/run.mjs', 'utf8')).toContain("'--external-sales-cutover-only'");
    });
});
