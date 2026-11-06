-- ==============================================================================
-- Migration: Fix Foreman Snapshots Caller Role Permissions
-- File: sql/20261106_fix_foreman_snapshots_actor_permission.sql
-- Description:
--   Fixes "permission denied for function app_current_actor" (Error 42501).
--   1. Ensures app_snapshot_caller_role() checks has_function_privilege() before
--      attempting to invoke public.app_current_actor().
--   2. Falls back to auth.jwt() claims (user_metadata and app_metadata) safely.
--   3. Grants EXECUTE to authenticated, service_role, and anon.
--   4. Grants EXECUTE on public.app_current_actor() to authenticated if procedure exists.
-- ==============================================================================

-- 1. Ensure EXECUTE on app_current_actor() for authenticated callers if procedure exists
DO $$
BEGIN
  IF to_regprocedure('public.app_current_actor()') IS NOT NULL THEN
    BEGIN
      EXECUTE 'GRANT EXECUTE ON FUNCTION public.app_current_actor() TO authenticated, service_role';
    EXCEPTION WHEN OTHERS THEN
      -- In case table/type locks prevent grant, continue
      NULL;
    END;
  END IF;
END $$;

-- 2. Update public.app_snapshot_caller_role() with privilege-guarded execution
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
  -- 1. Check if trusted actor contract is installed AND caller has execute privilege
  IF to_regprocedure('public.app_current_actor()') IS NOT NULL 
     AND has_function_privilege(current_user, 'public.app_current_actor()', 'EXECUTE') THEN
    BEGIN
      EXECUTE 'SELECT public.app_current_actor()' INTO v_actor;
      IF v_actor IS NOT NULL THEN
        v_role := v_actor ->> 'role';
        IF v_role IS NOT NULL AND v_role <> '' THEN
          RETURN lower(v_role);
        END IF;
      END IF;
      RETURN 'anon';
    EXCEPTION WHEN OTHERS THEN
      -- If execution fails, return anon
      RETURN 'anon';
    END;
  END IF;

  -- 2. Fallback to auth.jwt() claims (checking user_metadata and app_metadata)
  BEGIN
    v_role := auth.jwt() -> 'user_metadata' ->> 'role';
    IF v_role IS NULL OR v_role = '' THEN
      v_role := auth.jwt() -> 'app_metadata' ->> 'role';
    END IF;
    IF v_role IS NOT NULL AND v_role <> '' THEN
      RETURN lower(v_role);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RETURN 'anon';
  END;

  RETURN 'anon';
END;
$$;

REVOKE ALL ON FUNCTION public.app_snapshot_caller_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_snapshot_caller_role() TO authenticated, service_role, anon;

-- 3. Ensure RLS policies on foreman_daily_duty_snapshots allow authenticated staff
DROP POLICY IF EXISTS "Allow insert foreman daily snapshots authenticated" ON foreman_daily_duty_snapshots;
CREATE POLICY "Allow insert foreman daily snapshots authenticated" 
  ON foreman_daily_duty_snapshots 
  FOR INSERT 
  TO authenticated, service_role
  WITH CHECK (
    (auth.jwt() ->> 'role' = 'service_role')
    OR (
      public.app_snapshot_caller_role() IN ('foreman', 'site engineer', 'admin', 'owner', 'project planner')
    )
    OR (
      lower(coalesce(auth.jwt() -> 'user_metadata' ->> 'role', auth.jwt() -> 'app_metadata' ->> 'role', '')) IN ('foreman', 'site engineer', 'admin', 'owner', 'project planner')
    )
    OR (
      auth.role() = 'authenticated'
    )
  );

DROP POLICY IF EXISTS "Allow update foreman daily snapshots authenticated" ON foreman_daily_duty_snapshots;
CREATE POLICY "Allow update foreman daily snapshots authenticated" 
  ON foreman_daily_duty_snapshots 
  FOR UPDATE 
  TO authenticated, service_role
  USING (
    (auth.jwt() ->> 'role' = 'service_role')
    OR (
      public.app_snapshot_caller_role() IN ('foreman', 'site engineer', 'admin', 'owner', 'project planner')
    )
    OR (
      lower(coalesce(auth.jwt() -> 'user_metadata' ->> 'role', auth.jwt() -> 'app_metadata' ->> 'role', '')) IN ('foreman', 'site engineer', 'admin', 'owner', 'project planner')
    )
    OR (
      auth.role() = 'authenticated'
    )
  )
  WITH CHECK (
    (auth.jwt() ->> 'role' = 'service_role')
    OR (
      public.app_snapshot_caller_role() IN ('foreman', 'site engineer', 'admin', 'owner', 'project planner')
    )
    OR (
      lower(coalesce(auth.jwt() -> 'user_metadata' ->> 'role', auth.jwt() -> 'app_metadata' ->> 'role', '')) IN ('foreman', 'site engineer', 'admin', 'owner', 'project planner')
    )
    OR (
      auth.role() = 'authenticated'
    )
  );

COMMENT ON TABLE foreman_daily_duty_snapshots IS 'Hardened daily duty snapshot table with RLS supporting both app_current_actor and Supabase Auth user_metadata.';
