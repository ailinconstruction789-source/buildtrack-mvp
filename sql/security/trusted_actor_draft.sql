-- DESIGN ONLY. No production SQL, user bootstrap or feature activation.
-- Phase 2b: current-caller identity/role and self-only presence. Existing business
-- table policies still need a separate, all-module RLS cutover before activation.
BEGIN;
DO $draft_only$
BEGIN
  RAISE EXCEPTION 'DESIGN ONLY: trusted actor needs reviewed roles and complete authorization cutover';
END;
$draft_only$;

DO $preflight$
BEGIN
  IF to_regclass('account_security_private.reviewed_admins') IS NULL
    OR to_regprocedure('account_security_private.execute_account_command(text,text,text)') IS NULL
    OR to_regprocedure('account_security_private.mutate_account_with_foreman(text,text,text)') IS NULL
    OR to_regprocedure('public.update_user_last_seen(text)') IS NULL THEN
    RAISE EXCEPTION 'TRUSTED_ACTOR_PREREQUISITES_REQUIRED';
  END IF;
  IF to_regclass('account_security_private.reviewed_roles') IS NOT NULL
    OR to_regprocedure('public.app_current_actor()') IS NOT NULL
    OR to_regprocedure('public.app_touch_current_user()') IS NOT NULL THEN
    RAISE EXCEPTION 'TRUSTED_ACTOR_ALREADY_EXISTS';
  END IF;
  IF has_table_privilege('anon','public.users','SELECT') OR EXISTS (
    SELECT 1 FROM unnest(ARRAY['anon','authenticated']) r
    WHERE has_table_privilege(r,'public.users','INSERT,UPDATE,DELETE,TRUNCATE')
      OR has_any_column_privilege(r,'public.users','INSERT,UPDATE')
  ) THEN RAISE EXCEPTION 'TRUSTED_ACTOR_ACCOUNT_CUTOVER_REQUIRED'; END IF;
END;
$preflight$;

CREATE TABLE account_security_private.reviewed_roles (
  auth_user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  legacy_user_id integer NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('Admin','Owner','Sales','Foreman','Site Engineer','QC','Project Planner','Procurement','Store')),
  enabled boolean NOT NULL DEFAULT false,
  review_reference text NOT NULL CHECK (length(btrim(review_reference)) >= 8),
  reviewed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE account_security_private.reviewed_roles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON account_security_private.reviewed_roles FROM PUBLIC,anon,authenticated;
-- No seed, public write endpoint or automatic import from either metadata field.
-- Creating a legacy account does NOT create an enabled role; provisioning and
-- recovery require separate operator review before this mode can go live.

CREATE FUNCTION account_security_private.current_actor()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $actor$
DECLARE
  v_uid uuid := auth.uid();
  v_session uuid;
  v_actor record;
  v_manage boolean := false;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='APP_ACTOR_REQUIRED'; END IF;
  BEGIN
    v_session := NULLIF(auth.jwt()->>'session_id','')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='APP_ACTOR_REQUIRED';
  END;
  SELECT r.auth_user_id,r.legacy_user_id,r.role,p.username INTO v_actor
  FROM account_security_private.reviewed_roles r
  JOIN auth.users u ON u.id=r.auth_user_id
  JOIN auth.sessions s ON s.user_id=u.id AND s.id=v_session
  JOIN public.users p ON p.id=r.legacy_user_id
  WHERE r.auth_user_id=v_uid AND r.enabled
    AND u.deleted_at IS NULL AND NOT COALESCE(u.is_anonymous,false)
    AND (u.banned_until IS NULL OR u.banned_until<=statement_timestamp())
    AND (s.not_after IS NULL OR s.not_after>statement_timestamp())
  FOR SHARE OF r,u,s;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='APP_ACTOR_REQUIRED'; END IF;
  -- Do not lock public.users FOR SHARE: concurrent self-presence writes would
  -- otherwise risk lock-upgrade deadlocks. Identity/role/session rows stay locked.
  IF v_actor.role='Admin' THEN
    PERFORM 1 FROM account_security_private.reviewed_admins a
    WHERE a.auth_user_id=v_uid AND a.legacy_user_id=v_actor.legacy_user_id AND a.enabled
    FOR SHARE;
    v_manage := FOUND;
  END IF;
  RETURN jsonb_build_object('contract','buildtrack.actor.v1','authUserId',v_uid,
    'legacyUserId',v_actor.legacy_user_id,'username',v_actor.username,'role',v_actor.role,
    'canManageAccounts',v_manage);
END;
$actor$;
REVOKE ALL ON FUNCTION account_security_private.current_actor() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION account_security_private.current_actor() TO authenticated;
CREATE FUNCTION public.app_current_actor() RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = ''
AS $$ SELECT account_security_private.current_actor(); $$;
REVOKE ALL ON FUNCTION public.app_current_actor() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.app_current_actor() TO authenticated;

-- Tighten phase 1 as well: disabling/changing the trusted role must immediately
-- stop account commands even if an old reviewed_admins entry remains enabled.
CREATE OR REPLACE FUNCTION account_security_private.execute_account_command(p_action text,p_username text,p_value text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $command$
DECLARE v_actor jsonb := account_security_private.current_actor();
BEGIN
  IF v_actor->>'role' <> 'Admin' OR (v_actor->>'canManageAccounts')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='ACCOUNT_ADMIN_REQUIRED';
  END IF;
  CASE p_action
    WHEN 'create' THEN PERFORM account_security_private.mutate_account_with_foreman('create',p_username,p_value);
    WHEN 'delete' THEN PERFORM account_security_private.mutate_account_with_foreman('delete',p_username,NULL);
    WHEN 'rename' THEN PERFORM account_security_private.admin_change_username(p_username,p_value);
    WHEN 'password' THEN PERFORM account_security_private.admin_change_user_password(p_username,p_value);
    ELSE RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='ACCOUNT_COMMAND_INVALID';
  END CASE;
END;
$command$;
REVOKE ALL ON FUNCTION account_security_private.execute_account_command(text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION account_security_private.execute_account_command(text,text,text) TO authenticated;

CREATE FUNCTION account_security_private.touch_current_user(p_expected_username text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $presence$
DECLARE v_actor jsonb := account_security_private.current_actor();
BEGIN
  IF p_expected_username IS NOT NULL AND p_expected_username IS DISTINCT FROM v_actor->>'username' THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='APP_ACTOR_REQUIRED';
  END IF;
  UPDATE public.users SET last_seen_at=statement_timestamp()
  WHERE id=(v_actor->>'legacyUserId')::integer;
END;
$presence$;
REVOKE ALL ON FUNCTION account_security_private.touch_current_user(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION account_security_private.touch_current_user(text) TO authenticated;
CREATE FUNCTION public.app_touch_current_user() RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path = ''
AS $$ SELECT account_security_private.touch_current_user(NULL); $$;
-- Preserve old signature, but not the old arbitrary-username authority.
CREATE OR REPLACE FUNCTION public.update_user_last_seen(p_username text)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path = ''
AS $$ SELECT account_security_private.touch_current_user(p_username); $$;
REVOKE ALL ON FUNCTION public.app_touch_current_user(),public.update_user_last_seen(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.app_touch_current_user(),public.update_user_last_seen(text) TO authenticated;
ROLLBACK;
