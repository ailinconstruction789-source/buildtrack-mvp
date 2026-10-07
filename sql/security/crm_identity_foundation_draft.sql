-- DESIGN / ISOLATED TEST ONLY. Additive identity foundation, NOT a deployment.
-- Alternative to the ALL-DEPARTMENT trusted_actor draft, never install both.
-- Keep the installed account dispatcher, Admin allowlist and legacy presence
-- unchanged. No seeds, customer changes, role approval, or feature activation.
-- Later role_review + CRM projection must be reviewed as a separate atomic unit.
-- This stage intentionally does not make reviewed_roles govern legacy commands.
BEGIN;
DO $draft_only$
BEGIN
  RAISE EXCEPTION 'DESIGN ONLY: staged CRM identity requires separate deployment review';
END;
$draft_only$;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

DO $preflight$
BEGIN
  IF to_regclass('account_security_private.reviewed_admins') IS NULL
    OR to_regprocedure('account_security_private.execute_account_command(text,text,text)') IS NULL
    OR to_regprocedure('public.update_user_last_seen(text)') IS NULL THEN
    RAISE EXCEPTION 'CRM_IDENTITY_INSTALLED_ACCOUNT_GUARD_REQUIRED';
  END IF;
  IF to_regclass('account_security_private.reviewed_roles') IS NOT NULL
    OR to_regprocedure('account_security_private.current_actor()') IS NOT NULL
    OR to_regprocedure('public.app_current_actor()') IS NOT NULL
    OR to_regnamespace('sales_private') IS NOT NULL THEN
    RAISE EXCEPTION 'CRM_IDENTITY_EXISTING_STAGE_REVIEW_REQUIRED';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE oid IN (
      'account_security_private.reviewed_admins'::regclass,'public.users'::regclass)
      AND pg_get_userbyid(relowner)<>current_user) THEN
    RAISE EXCEPTION 'CRM_IDENTITY_OWNER_REQUIRED';
  END IF;
  IF has_table_privilege('anon','public.users','SELECT')
    OR NOT has_column_privilege('anon','public.users','username','SELECT')
    OR EXISTS (SELECT 1 FROM unnest(ARRAY['anon','authenticated']) r
      WHERE has_table_privilege(r,'public.users','INSERT,UPDATE,DELETE,TRUNCATE')
        OR has_any_column_privilege(r,'public.users','INSERT,UPDATE')) THEN
    RAISE EXCEPTION 'CRM_IDENTITY_DIRECTORY_CUTOVER_REQUIRED';
  END IF;
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
REVOKE ALL ON account_security_private.reviewed_roles FROM PUBLIC,anon,authenticated,service_role;

-- Same caller contract as the existing role-review/projection design. No trust
-- in JWT role metadata or the old directory role label; require a live session.
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
  -- Do not lock users: existing presence updates must not require lock upgrades.
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
REVOKE ALL ON FUNCTION account_security_private.current_actor() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION account_security_private.current_actor() TO authenticated;
CREATE FUNCTION public.app_current_actor() RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = ''
AS $$ SELECT account_security_private.current_actor(); $$;
REVOKE ALL ON FUNCTION public.app_current_actor() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.app_current_actor() TO authenticated;

DO $postflight$
BEGIN
  IF EXISTS (SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role']) r
      WHERE has_table_privilege(r,'account_security_private.reviewed_roles','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        OR has_any_column_privilege(r,'account_security_private.reviewed_roles','SELECT,INSERT,UPDATE,REFERENCES'))
    OR EXISTS (SELECT 1 FROM unnest(ARRAY['anon','service_role']) r
      WHERE has_function_privilege(r,'public.app_current_actor()','EXECUTE')
        OR has_function_privilege(r,'account_security_private.current_actor()','EXECUTE')) THEN
    RAISE EXCEPTION 'CRM_IDENTITY_UNEXPECTED_INHERITED_PRIVILEGE';
  END IF;
END;
$postflight$;
ROLLBACK;
