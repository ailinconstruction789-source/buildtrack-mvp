// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { crmIdentityFoundationPath, crmIdentityFoundationTestBody, runCrmIdentityFoundation } from './crm-identity-foundation.mjs';

const source = readFileSync(crmIdentityFoundationPath,'utf8');
const sql = source.replace(/--[^\n]*/g,'');
describe('staged CRM identity boundaries (offline)', () => {
    it('keeps raw draft blocked and permits only a fragment for rollback tests', () => {
        expect(source).toContain("RAISE EXCEPTION 'DESIGN ONLY:");
        expect(source.trim()).toMatch(/ROLLBACK;$/);
        expect(crmIdentityFoundationTestBody(source)).not.toMatch(/DESIGN ONLY:|\bCOMMIT;|\bROLLBACK;/);
        expect(readFileSync(crmIdentityFoundationPath,'utf8')).toBe(source);
    });
    it.each([
        s=>s.replace('ROLLBACK;','COMMIT;'),
        s=>s.replace('DESIGN ONLY:','APPROVED:'),
        s=>s+s,
        s=>s.replace('CREATE TABLE','\\connect production\nCREATE TABLE'),
        s=>s.replace('CREATE TABLE','ALTER SYSTEM SET port=5432; CREATE TABLE'),
    ])('rejects altered wrappers / unsafe client commands', change => {
        expect(()=>crmIdentityFoundationTestBody(change(source))).toThrow();
    });
    it('adds only the canonical registry and two caller-identity functions', () => {
        expect([...sql.matchAll(/CREATE TABLE\s+(\S+)/g)].map(m=>m[1])).toEqual(['account_security_private.reviewed_roles']);
        expect([...sql.matchAll(/CREATE FUNCTION\s+(\S+)/g)].map(m=>m[1])).toEqual([
            'account_security_private.current_actor()', 'public.app_current_actor()',
        ]);
        expect(sql).not.toMatch(/CREATE OR REPLACE|\bINSERT\s+INTO|\bUPDATE\s+(?:public|auth)\.|\bDELETE\s+FROM|\bDROP\s|\bTRUNCATE\s+(?:public|auth)\./i);
        expect(sql).not.toMatch(/ALTER TABLE\s+(?:public|auth)\.|ON\s+public\.users\s+TO|user_metadata|app_metadata/i);
    });
    it('bounds lock waits, checks live session and rejects inherited permissions', () => {
        for(const required of ["lock_timeout = '2s'","statement_timeout = '30s'",
            'JOIN auth.sessions','FOR SHARE OF r,u,s','SET search_path = \'\'',
            'CRM_IDENTITY_UNEXPECTED_INHERITED_PRIVILEGE', 'ENABLE ROW LEVEL SECURITY',
            'CRM_IDENTITY_DIRECTORY_CUTOVER_REQUIRED','CRM_IDENTITY_EXISTING_STAGE_REVIEW_REQUIRED']) {
            expect(sql).toContain(required);
        }
    });
    it('preserves the existing caller contract and lookup body', () => {
        const old = readFileSync('sql/security/trusted_actor_draft.sql','utf8');
        const actor = text => text.match(/AS \$actor\$([\s\S]*?)\$actor\$;/)[1]
            .replace(/--[^\n]*/g,'').replace(/\s+/g,' ').trim();
        expect(actor(source)).toBe(actor(old));
    });
    it('refuses an unverified database before executing a fixture or draft', async () => {
        const calls=[];
        await expect(runCrmIdentityFoundation({source,query:async q=>{calls.push(q);return 'f';}})).rejects.toThrow('Owned local database required');
        expect(calls).toHaveLength(1);
        expect(calls[0]).toContain('inet_server_addr()');
        expect(calls[0]).not.toMatch(/CREATE|INSERT/);
    });
    it('runs after directory and before full-cutover tests with source hashing', () => {
        const suite=readFileSync('scripts/sales-runtime/account-security.mjs','utf8');
        expect(suite.indexOf('await runLoginDirectory')).toBeLessThan(suite.indexOf('await runCrmIdentityFoundation'));
        expect(suite.indexOf('await runCrmIdentityFoundation')).toBeLessThan(suite.indexOf('await runTrustedActor'));
        expect(suite).toContain("sources.push(crmIdentityFoundationPath, 'scripts/sales-runtime/crm-identity-foundation.mjs')");
    });
});
