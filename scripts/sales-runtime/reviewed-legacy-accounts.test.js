// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { reviewedLegacyAccountFunctions, reviewedAccountHashes } from './reviewed-legacy-accounts.mjs';
const sources = () => new Map(['sync_auth_users.sql','fix_auth_users.sql'].map(path => [path, readFileSync(path,'utf8')]));
describe('reviewed live account source parity (offline)', () => {
    it('uses exactly the four observed body fingerprints', () => {
        const result = reviewedLegacyAccountFunctions(sources());
        expect(result.hashes).toEqual(reviewedAccountHashes);
        expect(result.sql.match(/CREATE OR REPLACE FUNCTION/g)).toHaveLength(4);
        expect(result.sql).not.toContain('DROP TRIGGER');
        expect(result.sql).not.toContain('EXCEPTION\r\n');
    });
    it('normalizes file line endings back to the observed CRLF bodies', () => {
        const texts = sources();
        for (const [path, source] of texts) texts.set(path, source.replace(/\r\n/g,'\n'));
        expect(() => reviewedLegacyAccountFunctions(texts)).not.toThrow();
    });
    it('fails if a credential operation changes instead of silently testing another version', () => {
        const texts = sources();
        texts.set('sync_auth_users.sql', texts.get('sync_auth_users.sql').replace('WHERE email = v_email;', 'WHERE true;'));
        expect(() => reviewedLegacyAccountFunctions(texts)).toThrow('Unreviewed legacy body');
    });
    it('rejects missing/extra legacy definitions', () => {
        const texts = sources();
        texts.set('fix_auth_users.sql','');
        expect(() => reviewedLegacyAccountFunctions(texts)).toThrow('Unexpected legacy source shape');
    });
});
