// @vitest-environment node
import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {roleReviewDraftPath,roleReviewTestBody} from './role-review.mjs';
const source=readFileSync(roleReviewDraftPath,'utf8');
describe('operator role review draft safety',()=>{
    it('unwraps only the in-memory copy',()=>{
        expect(roleReviewTestBody(source).trim()).toMatch(/COMMIT;$/);
        expect(readFileSync(roleReviewDraftPath,'utf8')).toBe(source);
        expect(source.trim()).toMatch(/ROLLBACK;$/);
    });
    it.each([
        value=>value.replace('ROLLBACK;','COMMIT;'),value=>value.replace('DESIGN ONLY:','RUN NOW:'),
        value=>`${value}\n${value}`,value=>`${value}\n\\connect production`,
    ])('rejects unsafe draft edits',modify=>{expect(()=>roleReviewTestBody(modify(source))).toThrow();});
    it('does not add an exposed RPC, definer escalation or credential changes',()=>{
        const sql=source.replace(/--[^\n]*/g,'');
        expect(sql).not.toMatch(/CREATE (?:OR REPLACE )?FUNCTION public\.|SECURITY DEFINER|UPDATE auth\.|INSERT INTO auth\.|UPDATE public\.users|GRANT EXECUTE|user_metadata/i);
        expect(sql).toContain('ROLE_REVIEW_CRM_ALIGNMENT_REQUIRED');
        expect(sql).toContain('pg_advisory_xact_lock');
        expect(sql).toContain('ROLE_REVIEW_LAST_ADMIN_REQUIRED');
    });
});
