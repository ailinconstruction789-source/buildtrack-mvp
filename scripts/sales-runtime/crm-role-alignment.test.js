// @vitest-environment node
import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {crmRoleAlignmentPath,crmRoleAlignmentTestBody} from './crm-role-alignment.mjs';
const source=readFileSync(crmRoleAlignmentPath,'utf8');
describe('CRM role alignment draft safety',()=>{
    it('only unwraps in memory',()=>{
        expect(crmRoleAlignmentTestBody(source).trim()).toMatch(/COMMIT;$/);
        expect(readFileSync(crmRoleAlignmentPath,'utf8')).toBe(source);
        expect(source.trim()).toMatch(/ROLLBACK;$/);
    });
    it.each([s=>s.replace('ROLLBACK;','COMMIT;'),s=>s.replace('DESIGN ONLY:','RUN NOW:'),s=>`${s}\n${s}`,s=>`${s}\n\\connect production`])
        ('rejects altered guards or remote commands',change=>expect(()=>crmRoleAlignmentTestBody(change(source))).toThrow());
    it('quarantines rather than trusting old role labels',()=>{
        const sql=source.replace(/--[^\n]*/g,'');
        expect(sql).toContain('UPDATE sales_private.crm_user_roles SET is_active=false;');
        expect(sql).not.toMatch(/INSERT INTO account_security_private\.reviewed_roles|UPDATE public\.|UPDATE auth\.|user_metadata|DROP TABLE/);
        expect(sql).toContain('account_security_private.current_actor()');
        expect(sql).toContain('c.trusted_review_revision=r.review_revision');
    });
});
