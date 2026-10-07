// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { accountDraftPath, accountTestBody } from './account-security.mjs';

const source = readFileSync(accountDraftPath,'utf8');
describe('account guard preparation safety (no database)', () => {
    it('preserves the non-deployable draft and unwraps only in memory', () => {
        expect(source).toContain("RAISE EXCEPTION 'DESIGN ONLY:");
        expect(source.trim()).toMatch(/ROLLBACK;$/);
        expect(accountTestBody(source)).not.toContain("RAISE EXCEPTION 'DESIGN ONLY:");
        expect(accountTestBody(source).trim()).toMatch(/COMMIT;$/);
        expect(readFileSync(accountDraftPath,'utf8')).toBe(source);
    });
    it.each([
        text => text.replace('ROLLBACK;','COMMIT;'),
        text => text.replace('DESIGN ONLY:','APPROVED:'),
        text => `${text}\n${text}`,
        text => text.replace('CREATE SCHEMA account_security_private;', '\\connect production\nCREATE SCHEMA account_security_private;'),
        text => text.replace('CREATE SCHEMA account_security_private;', 'ALTER SYSTEM SET port=5432;'),
    ])('refuses changed wrappers or unsafe input', change => {
        expect(() => accountTestBody(change(source))).toThrow();
    });
    it('does not auto-bootstrap real administrators or change login access', () => {
        const sql = source.replace(/--[^\n]*/g,'');
        expect(sql).not.toMatch(/INSERT\s+INTO\s+account_security_private\.reviewed_admins/i);
        expect(sql).not.toMatch(/user_metadata|app_metadata|raw_user_meta_data|raw_app_meta_data/);
        expect(sql).not.toMatch(/REVOKE\s+(?:ALL|SELECT).*ON\s+public\.users/i);
        expect(sql).not.toMatch(/UPDATE\s+auth\.|DELETE\s+FROM\s+auth\./i);
    });
    it('places the isolated suite before, and separate from, Sales migrations', () => {
        const runner = readFileSync('scripts/sales-runtime/run.mjs','utf8');
        expect(runner).toContain("if (accountSecurityOnly) {");
        expect(runner.indexOf('await identity(database)')).toBeLessThan(runner.indexOf('await runAccountSecurity'));
        expect(runner.indexOf('await runAccountSecurity')).toBeLessThan(runner.indexOf("sql/sales/runtime/fixtures/bootstrap.sql"));
        const suite = readFileSync('scripts/sales-runtime/account-security.mjs','utf8');
        expect(suite).not.toMatch(/dotenv|supabase-js|process\.env\./);
        expect(suite).toContain('sourceFilesUnchanged:true');
    });
});
