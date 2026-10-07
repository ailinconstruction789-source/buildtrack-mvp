// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loginDirectoryDraftPath, loginDirectoryTestBody } from './login-directory.mjs';
const source = readFileSync(loginDirectoryDraftPath,'utf8');

describe('login directory draft safety', () => {
    it('does not turn the file into an installable migration', () => {
        expect(loginDirectoryTestBody(source).trim()).toMatch(/COMMIT;$/);
        expect(source.trim()).toMatch(/ROLLBACK;$/);
        expect(readFileSync(loginDirectoryDraftPath,'utf8')).toBe(source);
    });
    it.each([
        value => value.replace('ROLLBACK;','COMMIT;'), value => value.replace('DESIGN ONLY:','RUN NOW:'),
        value => `${value}\n${value}`, value => value.replace('REVOKE SELECT ON public.users','\\connect remote\nREVOKE SELECT ON public.users'),
    ])('rejects modified wrappers/remote reconnects', modify => {
        expect(() => loginDirectoryTestBody(modify(source))).toThrow();
    });
    it('uses column grants without new tables, elevated functions or real-data writes', () => {
        const sql = source.replace(/--[^\n]*/g,'');
        expect(sql).toContain('GRANT SELECT (username) ON public.users TO anon;');
        expect(sql).toContain('REVOKE SELECT ON public.users FROM PUBLIC, anon;');
        expect(sql).not.toMatch(/CREATE TABLE|SECURITY DEFINER|INSERT INTO|UPDATE public\.|DELETE FROM/i);
    });
});
