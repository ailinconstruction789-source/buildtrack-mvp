// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildEnvironment, includeSource, sourceArgument, releaseArguments } from './check.mjs';
import { resolve } from 'node:path';
describe('local release check boundary', () => {
  it('requires explicit bounded profile and rejects unknown options', () => {
    const root = resolve('synthetic');
    expect(releaseArguments(['--central-booking'], root)).toEqual({ releaseScope: 'central_booking', source: root });
    expect(releaseArguments([], root)).toEqual({ releaseScope: null, source: root });
    expect(() => releaseArguments(['--central-booking', '--deploy'], root)).toThrow();
    expect(() => buildEnvironment({}, root, 'unknown')).toThrow();
  });
  it('builds the bounded UI without remote credentials or optional modules', () => {
    const env = buildEnvironment({ SALES_CRM_NOTIFICATIONS_ENABLED: 'true', SUPABASE_SERVICE_ROLE_KEY: 'secret' }, 'D:/synthetic', 'central_booking');
    expect(env.SALES_CRM_RELEASE_SCOPE).toBe('central_booking');
    for (const name of ['V2', 'LEAD_WORK', 'LIFECYCLE', 'BOOKING', 'PROJECT_SALES', 'PROJECT_WORKSPACE']) expect(env[`SALES_CRM_${name}_ENABLED`]).toBe('true');
    expect(env.SALES_CRM_NOTIFICATIONS_ENABLED).toBe('false');
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe('http://127.0.0.1:1');
    expect(env).not.toHaveProperty('SUPABASE_SERVICE_ROLE_KEY');
  });
  it('accepts only default source or an explicit absolute source path', () => {
    const local = resolve('synthetic-worktree');
    expect(sourceArgument([], local)).toBe(local);
    expect(sourceArgument(['--source', local], 'unused')).toBe(local);
    for (const args of [['--source', 'relative'], ['--source', 'https://example.com'], ['--deploy'], ['--source', local, '--push']]) {
      expect(() => sourceArgument(args, local)).toThrow();
    }
  });
  it('includes actual app, tests and legacy TS instead of hiding type errors', () => {
    for (const file of ['app/page.tsx', 'components/__tests__/LoginView.test.tsx', 'recovered.tsx', 'components_VER_MAIN/LoginView.tsx', 'package-lock.json', 'public/file.svg', 'app/favicon.ico']) expect(includeSource(file)).toBe(true);
  });
  it('excludes secrets, generated outputs, SQL and customer spreadsheets', () => {
    for (const file of ['.env.local', '.vercel/project.json', 'node_modules/a.js', '.next/a.ts', 'supabase/.temp/cli-latest', 'customers.xlsx', 'accounts.sql', '']) expect(includeSource(file)).toBe(false);
  });
  it('does not inherit credentials, application flags or injected Node/proxy settings', () => {
    const env = buildEnvironment({ PATH: 'tools', SUPABASE_SERVICE_ROLE_KEY: 'private', DATABASE_URL: 'remote',
      SALES_CRM_V2_ENABLED: 'true', NODE_OPTIONS: '--require injected', HTTP_PROXY: 'remote' }, 'D:/synthetic');
    expect(env.PATH).toBe('tools');
    expect(env).not.toHaveProperty('DATABASE_URL'); expect(env).not.toHaveProperty('SUPABASE_SERVICE_ROLE_KEY');
    expect(env).not.toHaveProperty('HTTP_PROXY'); expect(env).not.toHaveProperty('SALES_CRM_V2_ENABLED');
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe('http://127.0.0.1:1');
    expect(env.NODE_OPTIONS).not.toContain('injected');
    expect(env.NEXT_PUBLIC_ACCOUNT_GUARDED_COMMANDS_ENABLED).toBe('true');
  });
});
