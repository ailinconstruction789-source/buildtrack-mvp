// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertLocalDatabaseTarget, assertPlainSql, cleanProcessEnvironment, draftPaths, localConnectionArgs, syntheticDraftBody, verifyClusterIdentity } from './safety.mjs';

describe('isolated runtime safety boundaries (no database execution)', () => {
    const db = 'buildtrack_sales_runtime_ab12';
    const user = 'runtime_cd34';
    it('always pins loopback, explicit database/user/port and disables psql rc/password prompts', () => {
        const args = localConnectionArgs(45678, db, user);
        expect(args).toContain('-X'); expect(args).toContain('--no-password'); expect(args).toContain('ON_ERROR_STOP=1');
        expect(args[args.indexOf('-h') + 1]).toBe('127.0.0.1');
        expect(args[args.indexOf('-d') + 1]).toBe(db);
        expect(args[args.indexOf('-U') + 1]).toBe(user);
    });
    it.each([0, 543.2, 1023, 65536, NaN, '5432'])('rejects invalid/high-risk port %s', port => {
        expect(() => localConnectionArgs(port, db, user)).toThrow();
    });
    it.each(['postgres', 'production', 'postgresql://remote/db', 'buildtrack_sales_runtime_abc;DROP TABLE t', 'buildtrack_sales_runtime_'])('rejects arbitrary database %s', database => {
        expect(() => localConnectionArgs(45678, database, user)).toThrow();
    });
    it.each(['postgres', 'service_role', 'runtime_abc OPTIONS=secret', 'runtime_'])('rejects arbitrary role %s', role => {
        expect(() => localConnectionArgs(45678, db, role)).toThrow();
    });
    it.each(['postgresql://remote/db', 'host=remote dbname=postgres', 'service=production', 'production',
        'buildtrack_sales_runtime_aa00', 'postgres ', null, undefined])('rejects libpq target override %s', target => {
        expect(() => assertLocalDatabaseTarget(target, db)).toThrow();
    });
    it('only permits its exact owned DB or postgres for identity/bootstrap checks', () => {
        expect(() => assertLocalDatabaseTarget(db, db)).not.toThrow();
        expect(() => assertLocalDatabaseTarget('postgres', db)).not.toThrow();
        expect(() => assertLocalDatabaseTarget('postgres', 'production')).toThrow();
    });
    it.each(['\\connect remote', '-- comment\n\\connect remote', '/* nested /* text */ comment */ \\i file',
        'SELECT 1; \\! command', 'SELECT 1\\gexec', "SELECT 'safe';\n\\copy t FROM file", "SELECT $$safe$$;\\c remote",
        "SELECT '\\';\\c remote", 'SELECT "name";\\ir script', "SELECT E'\\\'safe';\\c remote"])(
        'rejects actual psql client command outside quoted SQL: %s', source => {
            expect(() => assertPlainSql(source)).toThrow();
        });
    it.each(["SELECT '\\connect is text';", "SELECT E'\\\\connect is text';", 'SELECT $$\\! is text$$;',
        'DO $body$ BEGIN RAISE NOTICE \'\\i is text\'; END $body$;', '-- \\connect comment\nSELECT 1;',
        '/* outer /* \\! */ comment */ SELECT 1;', 'SELECT "\\name";', "SELECT 'quote''\\text';"])(
        'permits literal/comment backslashes without executing them: %s', source => {
            expect(() => assertPlainSql(source)).not.toThrow();
        });
    it.each(["SELECT 'unterminated", 'DO $body$ unfinished', '/* unfinished', 'SELECT \0'])('rejects malformed SQL %s', source => {
        expect(() => assertPlainSql(source)).toThrow();
    });
    it('strips credentials, service files, preloads and connection environment rather than inheriting app config', () => {
        expect(cleanProcessEnvironment({ SystemRoot: 'windows', PATH: 'tools', TEMP: 'temp', PGHOST: 'remote', pgservice: 'prod',
            PGPASSWORD: 'secret', DATABASE_URL: 'prod', SUPABASE_URL: 'prod', NEXT_PUBLIC_SUPABASE_URL: 'prod',
            NODE_OPTIONS: '--require malicious', PSQLRC: 'commands.sql', HOME: 'profile' }))
            .toEqual({ SystemRoot: 'windows', PATH: 'tools', TEMP: 'temp' });
    });
    const expected = { port: 45678, user, database: db, data: resolve('.') };
    const actual = { ...expected, address: '127.0.0.1', marker: 'on', listen: '127.0.0.1' };
    it('verifies actual resolved data directory plus independently returned server identity', () => {
        expect(() => verifyClusterIdentity(actual, expected)).not.toThrow();
    });
    it.each([{ address: 'remote' }, { address: '127.0.0.2' }, { port: 5432 }, { user: 'postgres' },
        { database: 'postgres' }, { marker: null }, { listen: '*' }, { data: resolve('lib') }])('refuses mismatched server %j', change => {
        expect(() => verifyClusterIdentity({ ...actual, ...change }, expected)).toThrow();
    });
    it.each(draftPaths)('only unwraps known draft in memory, preserving file bytes: %s', path => {
        const original = readFileSync(resolve(path), 'utf8');
        const transformed = syntheticDraftBody(path, original);
        expect(transformed).not.toContain("RAISE EXCEPTION 'DESIGN ONLY:");
        expect(transformed.trim()).toMatch(/COMMIT;$/);
        expect(original.trim()).toMatch(/ROLLBACK;$/);
        expect(readFileSync(resolve(path), 'utf8')).toBe(original);
    });
    const guarded = "BEGIN; DO $draft_only$ BEGIN RAISE EXCEPTION 'DESIGN ONLY: example'; END; $draft_only$; SELECT 1; ROLLBACK;";
    it.each([
        guarded.replace('ROLLBACK;', 'COMMIT;'), guarded.replace('DESIGN ONLY:', 'RUN NOW:'),
        `${guarded}\n${guarded}`, `${guarded}\n\\connect prod`, guarded.replace('SELECT 1;', '\\connect prod\nSELECT 1;'),
        guarded.replace('SELECT 1;', 'ALTER SYSTEM SET port=5432;'),
    ])('rejects changed/extra guards, psql reconnect and server config statements', source => {
        expect(() => syntheticDraftBody(draftPaths[0], source)).toThrow();
    });
    it('will not load arbitrary SQL files as drafts', () => {
        expect(() => syntheticDraftBody('migration.sql', guarded)).toThrow();
    });
    it('runner takes no existing host, connection URL, dotenv or service-role input', () => {
        const runner = readFileSync(resolve('scripts/sales-runtime/run.mjs'), 'utf8');
        expect(runner).toContain("options[0] === '--bin'");
        expect(runner).toContain("'listen_addresses=127.0.0.1'");
        expect(runner).toContain("'-A', 'scram-sha-256'");
        expect(runner).toContain('windowsHide: true');
        expect(runner).not.toMatch(/from\s*['"]dotenv|supabase-js|process\.env\.(?:DATABASE_URL|PGHOST|SUPABASE)/i);
        expect(runner).toContain("['-D', data, 'stop', '-m', 'fast'");
        expect(runner).toContain("process.on('SIGINT', onInterrupt)");
        expect(runner).toContain("process.on('SIGTERM', onInterrupt)");
        expect(runner).toContain('await stopOwnedCluster()');
        expect(runner).toContain('assertPlainSql(sql)');
        expect(runner).toContain('await Promise.all([...activeCommands])');
        expect(runner).not.toMatch(/rmSync|rmdir|unlinkSync\(data/);
    });
});
