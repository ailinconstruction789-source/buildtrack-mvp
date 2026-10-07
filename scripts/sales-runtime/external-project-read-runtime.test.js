// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { externalProjectReadDraftPath, externalProjectReadTestBody, runExternalProjectReadRuntime } from './external-project-read-runtime.mjs';
const source = readFileSync(externalProjectReadDraftPath, 'utf8');
describe('private prepared reader boundaries', () => {
    it('unwraps only the explicit local guard', () => {
        expect(source.trim()).toMatch(/ROLLBACK;$/);
        expect(externalProjectReadTestBody(source).trim()).toMatch(/COMMIT;$/);
    });
    it.each([s => s.replace('ROLLBACK;', 'COMMIT;'), s => s.replace("RAISE EXCEPTION 'DESIGN ONLY:", "RAISE EXCEPTION 'APPROVED:"),
        s => s + '\n\\connect production'])('rejects changed boundaries %#', mutate => {
        expect(() => externalProjectReadTestBody(mutate(source))).toThrow();
    });
    it('refuses non-owned databases before any fixture action', async () => {
        const calls = [];
        await expect(runExternalProjectReadRuntime({ query: async sql => { calls.push(sql); return 'f'; }, root: '.', report: {} })).rejects.toThrow();
        expect(calls).toHaveLength(1);
    });
    it('does not read legacy sales or expose a public RPC', () => {
        const sql = source.replace(/--[^\n]*/g, '');
        expect(sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b|SECURITY DEFINER|GRANT |public\.sales\b|CREATE FUNCTION public\./i);
        expect(sql).toContain('STABLE SECURITY INVOKER');
        expect(sql).toContain('EXTERNAL_PROJECT_READ_OPERATOR_REQUIRED');
        expect(sql).toContain('EXTERNAL_PROJECT_READ_REVIEWED_ADMIN_REQUIRED');
    });
    it('checks coverage before filters and limits page size', () => {
        expect(source.indexOf('EXTERNAL_PROJECT_READ_INTEGRITY_REQUIRED')).toBeLessThan(source.indexOf('WITH page_rows'));
        expect(source).toContain('LIMIT 51 OFFSET p_page*50');
        expect(source).toContain('pendingUnlinkedHistories');
    });
});
