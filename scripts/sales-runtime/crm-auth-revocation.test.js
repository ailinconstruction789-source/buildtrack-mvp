// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { crmAuthRevocationPath, crmAuthRevocationTestBody, runCrmAuthRevocation } from './crm-auth-revocation.mjs';
const source = readFileSync(crmAuthRevocationPath, 'utf8');

describe('CRM Auth revocation draft safety', () => {
    it('transforms only an in-memory copy of the guarded draft', () => {
        expect(crmAuthRevocationTestBody(source)).toMatch(/COMMIT;\s*$/);
        expect(source).toMatch(/ROLLBACK;\s*$/);
        expect(readFileSync(crmAuthRevocationPath, 'utf8')).toBe(source);
    });
    it.each([
        text => text.replace('ROLLBACK;', 'COMMIT;'),
        text => text.replace('DESIGN ONLY:', 'RUN NOW:'),
        text => `${text}\n${text}`,
        text => `${text}\n\\connect production`,
        text => text.replace('ROLLBACK;', 'ALTER SYSTEM SET port=5432; ROLLBACK;'),
    ])('rejects altered wrappers and unsafe statements', change => {
        expect(() => crmAuthRevocationTestBody(change(source))).toThrow();
    });
    it('cannot write Auth, canonical review, business data or automatically re-enable CRM', () => {
        const sql = source.replace(/--[^\n]*/g, '');
        expect(sql).not.toMatch(/(?:UPDATE|INSERT INTO|DELETE FROM)\s+(?:auth\.|public\.|account_security_private\.reviewed_)/i);
        expect(sql).not.toMatch(/SET is_active\s*=\s*true|DROP TABLE|user_metadata|CREATE POLICY/i);
        expect(sql).toContain('SET is_active=false');
        expect(sql).toContain('s.review_revision>=r.review_revision');
    });
    it('uses a private trigger with pinned path and no Auth session trigger', () => {
        expect(source).toContain('SECURITY DEFINER SET search_path=');
        expect(source).toContain('AFTER UPDATE ON auth.users');
        expect(source).not.toContain('ON auth.sessions');
        expect(source).toContain('ENABLE ROW LEVEL SECURITY');
        expect(source).toContain('CRM_AUTH_SUSPENSION_APPEND_ONLY');
        expect(source).toContain("'service_role','supabase_auth_admin'");
    });
    it('refuses a non-owned database before fixture writes', async () => {
        const query = vi.fn().mockResolvedValue('f');
        await expect(runCrmAuthRevocation({ query, source })).rejects.toThrow();
        expect(query).toHaveBeenCalledTimes(1);
    });
    it('test harness opens no connection or environment configuration', () => {
        const script = readFileSync('scripts/sales-runtime/crm-auth-revocation.mjs', 'utf8');
        expect(script).not.toMatch(/process\.env|dotenv|createClient|child_process|fetch\(|DATABASE_URL/);
        expect(script).toContain('SET LOCAL ROLE synthetic_auth_operator');
        expect(script).toContain('account_security_private.review_account_role');
    });
});
