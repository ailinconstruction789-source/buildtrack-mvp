import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Finding 5 & Finding C: Snapshot Table Database Security / RLS Hardening', () => {
  const sqlPath = path.resolve(process.cwd(), 'sql/20261105_foreman_snapshots_rls_hardening.sql');

  it('migration file sql/20261105_foreman_snapshots_rls_hardening.sql exists', () => {
    expect(fs.existsSync(sqlPath)).toBe(true);
  });

  it('revokes ALL privileges including SELECT and mutation from anon role (Finding C)', () => {
    const content = fs.readFileSync(sqlPath, 'utf8');
    expect(content).toMatch(/REVOKE ALL ON TABLE foreman_daily_duty_snapshots FROM anon/i);
    expect(content).toMatch(/REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLE foreman_daily_duty_snapshots FROM anon/i);
  });

  it('ensures RLS is enabled on foreman_daily_duty_snapshots', () => {
    const content = fs.readFileSync(sqlPath, 'utf8');
    expect(content).toMatch(/ENABLE ROW LEVEL SECURITY/i);
  });

  it('drops overly permissive legacy policies with (true) check', () => {
    const content = fs.readFileSync(sqlPath, 'utf8');
    expect(content).toMatch(/DROP POLICY IF EXISTS "Allow insert foreman daily snapshots"/i);
    expect(content).toMatch(/DROP POLICY IF EXISTS "Allow update foreman daily snapshots"/i);
    expect(content).toMatch(/DROP POLICY IF EXISTS "Allow delete foreman daily snapshots"/i);
  });

  it('restricts INSERT and UPDATE to authenticated authorized staff roles', () => {
    const content = fs.readFileSync(sqlPath, 'utf8');
    expect(content).toMatch(/CREATE POLICY "Allow insert foreman daily snapshots authenticated"/i);
    expect(content).toMatch(/TO authenticated/i);
    expect(content).toMatch(/CREATE POLICY "Allow update foreman daily snapshots authenticated"/i);
    expect(content).toMatch(/foreman/i);
    expect(content).toMatch(/site engineer/i);
  });

  it('restricts DELETE to admin/owner/project planner', () => {
    const content = fs.readFileSync(sqlPath, 'utf8');
    expect(content).toMatch(/CREATE POLICY "Allow delete foreman daily snapshots admin only"/i);
    expect(content).toMatch(/admin/i);
  });

  it('Finding C: strictly forbids user_metadata fallback and generic authenticated role', () => {
    const content = fs.readFileSync(sqlPath, 'utf8');
    // user_metadata must NOT be used for security authorization
    expect(content).not.toMatch(/user_metadata/i);
    // Generic 'authenticated' role string must NOT be included in allowed staff roles list
    expect(content).not.toMatch(/'authenticated'\s*\)/i);
    expect(content).not.toMatch(/IN\s*\([^)]*'authenticated'[^)]*\)/i);
    // Verified actor or app_metadata must be present
    expect(content).toMatch(/app_current_actor/i);
  });
});
