// @vitest-environment node
import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {trustedActorDraftPath,trustedActorTestBody} from './trusted-actor.mjs';
const source=readFileSync(trustedActorDraftPath,'utf8');
describe('trusted actor preparation safety',()=>{
    it('unwraps only in memory and leaves the file guarded',()=>{
        expect(trustedActorTestBody(source).trim()).toMatch(/COMMIT;$/);
        expect(readFileSync(trustedActorDraftPath,'utf8')).toBe(source);
        expect(source.trim()).toMatch(/ROLLBACK;$/);
    });
    it.each([
        value=>value.replace('ROLLBACK;','COMMIT;'),value=>value.replace('DESIGN ONLY:','RUN NOW:'),
        value=>`${value}\n${value}`,value=>value.replace('CREATE TABLE account_security_private.reviewed_roles','\\connect remote\nCREATE TABLE account_security_private.reviewed_roles'),
    ])('rejects modified guards or reconnects',modify=>{expect(()=>trustedActorTestBody(modify(source))).toThrow();});
    it('does not seed reviewed roles from editable legacy data',()=>{
        const sql=source.replace(/--[^\n]*/g,'');
        expect(sql).not.toMatch(/INSERT INTO|user_metadata|raw_user_meta_data|app_metadata/i);
        expect(sql).toContain('auth.uid()');expect(sql).toContain('auth.sessions');
    });
    it('keeps the old auth paths unreachable in trusted mode',()=>{
        const page=readFileSync('app/page.tsx','utf8');
        expect(page).toContain('const loggedInUser = TRUSTED_AUTH_ENABLED ? trustedSession.actor : legacyLoggedInUser;');
        expect(page).toContain('if (TRUSTED_AUTH_ENABLED) return;');
        expect(page).toContain('await trustedSession.login(loginData.username, loginData.pin);');
        expect(page).toContain('if (TRUSTED_AUTH_ENABLED) await trustedSession.logout();');
    });
});
