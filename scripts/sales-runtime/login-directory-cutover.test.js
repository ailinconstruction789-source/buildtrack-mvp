// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loginDirectoryCutoverPath, runLoginDirectoryCutover } from './login-directory-cutover.mjs';
const sql=readFileSync(loginDirectoryCutoverPath,'utf8').replace(/--[^\n]*/g,'');
describe('login directory cutover candidate boundaries',()=>{
    it.each(['release','project','client','acceptance','backup','old_tabs_reviewed'])('requires %s attestation',key=>{
        expect(sql).toContain(`current_setting('buildtrack.directory_${key}',true)`);
    });
    it('only narrows directory reads, no account or customer data writes',()=>{
        expect(sql).not.toMatch(/CREATE\s+(?:OR REPLACE\s+)?(?:FUNCTION|TABLE|SCHEMA)|INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM|ALTER\s+TABLE|DROP\s/i);
        expect(sql).toContain('GRANT SELECT (username) ON public.users TO anon;');
        expect(sql).toContain('LOGIN_DIRECTORY_ALREADY_CHANGED_REVIEW_REQUIRED');
        expect(sql.trim()).toMatch(/COMMIT;$/);
    });
    it('bounds lock wait and checks inherited privileges after narrowing',()=>{
        expect(sql).toContain("SET LOCAL lock_timeout = '2s'");
        expect(sql).toContain("SET LOCAL statement_timeout = '30s'");
        expect(sql).toContain('LOGIN_DIRECTORY_UNEXPECTED_INHERITED_READ_GRANT');
        expect(sql.indexOf('LOCK TABLE')).toBeLessThan(sql.indexOf('REVOKE SELECT'));
    });
    it('refuses a runner without verified local identity before issuing mutations',async()=>{
        const calls=[];
        await expect(runLoginDirectoryCutover({source:sql,query:async text=>{calls.push(text);return 'f';}})).rejects.toThrow();
        expect(calls).toHaveLength(1);
        expect(calls[0]).toMatch(/^SELECT current_database/);
    });
});
