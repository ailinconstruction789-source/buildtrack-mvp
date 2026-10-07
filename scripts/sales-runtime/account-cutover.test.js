// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { accountCutoverPath } from './account-cutover.mjs';
const source=readFileSync(accountCutoverPath,'utf8').replace(/\r\n/g,'\n');
describe('reviewed account cutover package (offline)',()=>{
    it('preserves reviewed draft core without altering the guarded draft',()=>{
        const draft=readFileSync('sql/security/account_admin_guard_draft.sql','utf8').replace(/\r\n/g,'\n');
        const core=draft.slice(draft.indexOf('-- Fail closed'),draft.indexOf('-- No COMMIT:'));
        expect(source).toContain(core);
        expect(draft).toContain("RAISE EXCEPTION 'DESIGN ONLY:");
        expect(draft.trim()).toMatch(/ROLLBACK;$/);
    });
    it('requires review before any schema mutation',()=>{
        for(const field of ['release','project','client','backup','admin']) expect(source).toContain(`buildtrack.account_cutover_${field}`);
        expect(source.indexOf('ACCOUNT_CUTOVER_REVIEW_REQUIRED')).toBeLessThan(source.indexOf('CREATE SCHEMA'));
        expect(source).toContain("SET LOCAL lock_timeout = '2s';");
        expect(source).toContain("SET LOCAL statement_timeout = '30s';");
    });
    it('uses a bound UUID and one transaction without embedding real generated IDs',()=>{
        expect(source).toContain("u.id=current_setting('buildtrack.account_cutover_admin')::uuid");
        expect(source).not.toMatch(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i);
        expect(source.match(/^BEGIN;$/gm)).toHaveLength(1);
        expect(source.match(/^COMMIT;$/gm)).toHaveLength(1);
        expect(source.trim()).toMatch(/COMMIT;$/);
    });
    it('does not activate Sales, change credentials, or rewrite legacy business rows',()=>{
        const sql=source.replace(/--[^\n]*/g,'');
        expect(sql).not.toMatch(/(?:UPDATE|DELETE FROM|ALTER TABLE)\s+(?:auth\.|public\.(?:projects|plots|sales|leads))/i);
        expect(sql).not.toMatch(/CREATE\s+(?:SCHEMA|TABLE)\s+sales_private|cron\.schedule/i);
        expect(sql).not.toMatch(/DROP\s+.*CASCADE/i);
    });
});
