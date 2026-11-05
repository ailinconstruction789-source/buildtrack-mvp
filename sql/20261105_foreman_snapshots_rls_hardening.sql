-- ==============================================================================
-- Migration: Foreman Daily Duty Snapshots RLS Security Hardening
-- File: sql/20261105_foreman_snapshots_rls_hardening.sql
-- Description:
--   Remediates Finding 5, R3, Finding C & P1:
--   1. Revokes all permissions (SELECT/INSERT/UPDATE/DELETE) from 'anon' role.
--   2. Enforces Row Level Security (RLS) with hardened role-based policies.
--   3. Authenticated staff with verified roles (Foreman, Site Engineer, Admin, Owner, Project Planner)
--      are granted INSERT and UPDATE using public.app_snapshot_caller_role() (which securely reads
--      the existing public.app_current_actor() or server-signed app_metadata).
--   4. DOES NOT change or drop the repository's existing app_current_actor() JSONB contract.
--   5. Client-supplied metadata  and generic 'authenticated' role are STRICTLY FORBIDDEN.
--   6. DELETE is restricted strictly to Admin, Owner, Project Planner, or service_role.
--   7. Read (SELECT) is permitted to authenticated staff and service_role.
--
-- Deployment Instructions:
--   - Execute in Supabase SQL Editor.
--   - DO NOT DROP TABLE or purge historical data.
--   - Existing snapshot rows and unique constraints remain 100% intact.
-- ==============================================================================

-- 1. Ensure table and RLS are active
ALTER TABLE IF EXISTS foreman_daily_duty_snapshots ENABLE ROW LEVEL SECURITY;

-- 2. Drop overly-permissive legacy policies from earlier migrations
DROP POLICY IF EXISTS "Allow select foreman daily snapshots" ON foreman_daily_duty_snapshots;
DROP POLICY IF EXISTS "Allow insert foreman daily snapshots" ON foreman_daily_duty_snapshots;
DROP POLICY IF EXISTS "Allow update foreman daily snapshots" ON foreman_daily_duty_snapshots;
DROP POLICY IF EXISTS "Allow delete foreman daily snapshots" ON foreman_daily_duty_snapshots;
DROP POLICY IF EXISTS "Allow select foreman daily snapshots hardened" ON foreman_daily_duty_snapshots;
DROP POLICY IF EXISTS "Allow insert foreman daily snapshots authenticated" ON foreman_daily_duty_snapshots;
DROP POLICY IF EXISTS "Allow update foreman daily snapshots authenticated" ON foreman_daily_duty_snapshots;
DROP POLICY IF EXISTS "Allow delete foreman daily snapshots admin only" ON foreman_daily_duty_snapshots;

-- 3. Revoke all privileges from anon role (Finding C: revoke anon reads and writes)
REVOKE ALL ON TABLE foreman_daily_duty_snapshots FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLE foreman_daily_duty_snapshots FROM anon;

-- 4. Grant appropriate table-level permissions to authenticated and service_role
GRANT SELECT ON TABLE foreman_daily_duty_snapshots TO authenticated, service_role;
GRANT INSERT, UPDATE ON TABLE foreman_daily_duty_snapshots TO authenticated, service_role;
GRANT DELETE ON TABLE foreman_daily_duty_snapshots TO authenticated, service_role;

-- 5. Helper function: public.app_snapshot_caller_role()
-- Dedicated helper with isolated namespace that checks trusted actor or app_metadata without redefining app_current_actor()
CREATE OR REPLACE FUNCTION public.app_snapshot_caller_role()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role text;
  v_actor jsonb;
BEGIN
  -- 1. If trusted actor contract is installed, it is the sole authoritative source of truth
  IF to_regprocedure('public.app_current_actor()') IS NOT NULL THEN
    BEGIN
      v_actor := public.app_current_actor();
      IF v_actor IS NOT NULL THEN
        v_role := v_actor ->> 'role';
        IF v_role IS NOT NULL AND v_role <> '' THEN
          RETURN lower(v_role);
        END IF;
      END IF;
      -- Actor returned null or no role: Denied (fail closed)
      RETURN 'anon';
    EXCEPTION WHEN OTHERS THEN
      -- Trusted actor rejected the caller (e.g. APP_ACTOR_REQUIRED 42501 for revoked/disabled/session invalid).
      -- FAIL CLOSED: strictly forbid fallback to JWT claims when trusted actor is installed!
      RETURN 'anon';
    END;
  END IF;

  -- 2. ONLY if trusted actor is NOT installed (bootstrap/pre-migration deployment mode):
  BEGIN
    v_role := auth.jwt() -> 'app_metadata' ->> 'role';
    IF v_role IS NOT NULL AND v_role <> '' THEN
      RETURN lower(v_role);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RETURN 'anon';
  END;

  RETURN 'anon';
END;
$$;

REVOKE ALL ON FUNCTION public.app_snapshot_caller_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_snapshot_caller_role() TO authenticated, service_role;

-- 6. RLS Policy: SELECT (Read-only for authenticated users and service_role)
CREATE POLICY "Allow select foreman daily snapshots hardened" 
  ON foreman_daily_duty_snapshots 
  FOR SELECT 
  TO authenticated, service_role
  USING (true);

-- 7. RLS Policy: INSERT (Restricted to authenticated staff roles with exact match via app_snapshot_caller_role)
CREATE POLICY "Allow insert foreman daily snapshots authenticated" 
  ON foreman_daily_duty_snapshots 
  FOR INSERT 
  TO authenticated 
  WITH CHECK (
    (auth.jwt() ->> 'role' = 'service_role')
    OR (
      public.app_snapshot_caller_role() IN ('foreman', 'site engineer', 'admin', 'owner', 'project planner')
    )
  );

-- 8. RLS Policy: UPDATE (Restricted to authenticated staff roles with exact match)
CREATE POLICY "Allow update foreman daily snapshots authenticated" 
  ON foreman_daily_duty_snapshots 
  FOR UPDATE 
  TO authenticated 
  USING (
    (auth.jwt() ->> 'role' = 'service_role')
    OR (
      public.app_snapshot_caller_role() IN ('foreman', 'site engineer', 'admin', 'owner', 'project planner')
    )
  )
  WITH CHECK (
    (auth.jwt() ->> 'role' = 'service_role')
    OR (
      public.app_snapshot_caller_role() IN ('foreman', 'site engineer', 'admin', 'owner', 'project planner')
    )
  );

-- 9. RLS Policy: DELETE (Restricted strictly to Admin, Owner, Project Planner, or service_role)
CREATE POLICY "Allow delete foreman daily snapshots admin only" 
  ON foreman_daily_duty_snapshots 
  FOR DELETE 
  TO authenticated 
  USING (
    (auth.jwt() ->> 'role' = 'service_role')
    OR (
      public.app_snapshot_caller_role() IN ('admin', 'owner', 'project planner')
    )
  );

COMMENT ON TABLE foreman_daily_duty_snapshots IS 'Hardened daily duty snapshot table with RLS restricting mutations strictly to authenticated staff via app_snapshot_caller_role.';
