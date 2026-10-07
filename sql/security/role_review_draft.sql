-- DESIGN / ISOLATED TEST ONLY. No identities, seeds, public RPC or Auth writes.
-- Operator-only review primitive; not an app-admin screen or deployable migration.
BEGIN;
DO $draft_only$
BEGIN
  RAISE EXCEPTION 'DESIGN ONLY: role review needs approved identities and cross-module cutover';
END;
$draft_only$;

DO $preflight$
BEGIN
  IF to_regclass('account_security_private.reviewed_roles') IS NULL
    OR to_regclass('account_security_private.reviewed_admins') IS NULL
    OR to_regprocedure('public.app_current_actor()') IS NULL THEN
    RAISE EXCEPTION 'ROLE_REVIEW_PREREQUISITES_REQUIRED';
  END IF;
  IF to_regclass('account_security_private.role_review_events') IS NOT NULL
    OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='account_security_private' AND p.proname='review_account_role') THEN
    RAISE EXCEPTION 'ROLE_REVIEW_ALREADY_EXISTS';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE oid IN (
      'account_security_private.reviewed_roles'::regclass,'account_security_private.reviewed_admins'::regclass)
      AND pg_get_userbyid(relowner)<>current_user) THEN
    RAISE EXCEPTION 'ROLE_REVIEW_OWNER_REQUIRED';
  END IF;
END;
$preflight$;

ALTER TABLE account_security_private.reviewed_roles
  ADD COLUMN review_revision bigint NOT NULL DEFAULT 0 CHECK (review_revision>=0);
CREATE TABLE account_security_private.role_review_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  auth_user_id uuid NOT NULL,
  legacy_user_id integer NOT NULL,
  previous_state jsonb,
  next_state jsonb NOT NULL,
  review_reference text NOT NULL,
  reviewer_reference text NOT NULL,
  recovery_reference text,
  executed_by name NOT NULL DEFAULT current_user,
  executed_at timestamptz NOT NULL DEFAULT clock_timestamp()
  -- No cascading FK: retain decision history if the account is later removed.
);
ALTER TABLE account_security_private.role_review_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON account_security_private.role_review_events FROM PUBLIC,anon,authenticated;
REVOKE ALL ON SEQUENCE account_security_private.role_review_events_id_seq FROM PUBLIC,anon,authenticated;

CREATE FUNCTION account_security_private.prevent_role_review_change()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$ BEGIN RAISE EXCEPTION 'ROLE_REVIEW_HISTORY_APPEND_ONLY'; END; $$;
REVOKE ALL ON FUNCTION account_security_private.prevent_role_review_change() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER role_review_history_append_only
BEFORE UPDATE OR DELETE OR TRUNCATE ON account_security_private.role_review_events
FOR EACH STATEMENT EXECUTE FUNCTION account_security_private.prevent_role_review_change();

-- Phase 3b may replace this prerequisite check only after installing the CRM
-- projection guards. No feature flag or user-supplied parameter can bypass it.
CREATE FUNCTION account_security_private.assert_crm_review_ready()
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$ BEGIN
  IF to_regclass('sales_private.crm_user_roles') IS NOT NULL THEN
    RAISE EXCEPTION 'ROLE_REVIEW_CRM_ALIGNMENT_REQUIRED';
  END IF;
END; $$;
REVOKE ALL ON FUNCTION account_security_private.assert_crm_review_ready() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION account_security_private.review_account_role(
  p_auth_user_id uuid, p_legacy_user_id integer,
  p_expected_username text, p_expected_auth_email text,
  p_role text, p_enabled boolean, p_can_manage_accounts boolean,
  p_expected_revision bigint, p_review_reference text,
  p_reviewer_reference text, p_recovery_reference text
) RETURNS bigint LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $review$
DECLARE
  v_old account_security_private.reviewed_roles%ROWTYPE;
  v_auth auth.users%ROWTYPE;
  v_username text;
  v_admin_id integer;
  v_old_manage boolean := false;
  v_revision bigint;
  v_before jsonb;
  v_after jsonb;
BEGIN
  -- Only the registry's SQL owner, not an Auth role/metadata label/service client.
  IF current_user IS DISTINCT FROM (SELECT pg_get_userbyid(relowner) FROM pg_class
    WHERE oid='account_security_private.reviewed_roles'::regclass) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='ROLE_REVIEW_OPERATOR_REQUIRED';
  END IF;
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION 'ROLE_REVIEW_READ_COMMITTED_REQUIRED';
  END IF;
  -- Never claim that disabling one registry revokes independent CRM permissions.
  PERFORM account_security_private.assert_crm_review_ready();
  IF p_auth_user_id IS NULL OR p_legacy_user_id IS NULL OR p_legacy_user_id<=0
    OR p_expected_revision IS NULL OR p_expected_revision<0
    OR p_enabled IS NULL OR p_can_manage_accounts IS NULL
    OR p_role IS NULL OR p_role NOT IN ('Admin','Owner','Sales','Foreman','Site Engineer','QC','Project Planner','Procurement','Store')
    OR p_expected_username IS NULL OR btrim(p_expected_username)=''
    OR p_expected_auth_email IS NULL OR btrim(p_expected_auth_email)=''
    OR p_review_reference IS NULL OR length(btrim(p_review_reference)) NOT BETWEEN 8 AND 500
    OR p_reviewer_reference IS NULL OR length(btrim(p_reviewer_reference)) NOT BETWEEN 3 AND 200
    OR (p_can_manage_accounts AND (p_role<>'Admin' OR NOT p_enabled)) THEN
    RAISE EXCEPTION 'ROLE_REVIEW_INVALID_INPUT';
  END IF;
  IF p_can_manage_accounts AND (p_recovery_reference IS NULL
    OR length(btrim(p_recovery_reference)) NOT BETWEEN 8 AND 500) THEN
    RAISE EXCEPTION 'ROLE_REVIEW_RECOVERY_EVIDENCE_REQUIRED';
  END IF;

  -- Serialize all decisions, not just same-account updates, to protect last Admin.
  -- A later statement in READ COMMITTED sees the prior review's committed result.
  PERFORM pg_advisory_xact_lock(20260925,3);
  SELECT * INTO v_old FROM account_security_private.reviewed_roles
    WHERE auth_user_id=p_auth_user_id FOR UPDATE;
  IF COALESCE(v_old.review_revision,0)<>p_expected_revision THEN
    RAISE EXCEPTION 'ROLE_REVIEW_STALE_REVISION';
  END IF;
  IF (v_old.auth_user_id IS NOT NULL AND v_old.legacy_user_id<>p_legacy_user_id)
    OR EXISTS (SELECT 1 FROM account_security_private.reviewed_roles
      WHERE legacy_user_id=p_legacy_user_id AND auth_user_id<>p_auth_user_id) THEN
    RAISE EXCEPTION 'ROLE_REVIEW_BINDING_CONFLICT';
  END IF;
  SELECT legacy_user_id,enabled INTO v_admin_id,v_old_manage
    FROM account_security_private.reviewed_admins WHERE auth_user_id=p_auth_user_id FOR UPDATE;
  IF (v_admin_id IS NOT NULL AND v_admin_id<>p_legacy_user_id)
    OR EXISTS (SELECT 1 FROM account_security_private.reviewed_admins
      WHERE legacy_user_id=p_legacy_user_id AND auth_user_id<>p_auth_user_id) THEN
    RAISE EXCEPTION 'ROLE_REVIEW_BINDING_CONFLICT';
  END IF;
  SELECT * INTO v_auth FROM auth.users WHERE id=p_auth_user_id FOR SHARE;
  SELECT username INTO v_username FROM public.users WHERE id=p_legacy_user_id FOR SHARE;
  IF v_auth.id IS NULL OR v_username IS DISTINCT FROM p_expected_username
    OR v_auth.email IS DISTINCT FROM p_expected_auth_email THEN
    RAISE EXCEPTION 'ROLE_REVIEW_IDENTITY_CHANGED';
  END IF;
  IF p_enabled AND (v_auth.deleted_at IS NOT NULL OR COALESCE(v_auth.is_anonymous,false)
    OR v_auth.banned_until>statement_timestamp()) THEN
    RAISE EXCEPTION 'ROLE_REVIEW_ACCOUNT_UNAVAILABLE';
  END IF;
  -- Explicitly supplied IDs and checked labels are stale-data protection, NOT
  -- proof of same-person identity. The independent human review is mandatory.
  IF v_old.auth_user_id IS NOT NULL THEN
    v_before := jsonb_build_object('role',v_old.role,'enabled',v_old.enabled,
      'canManageAccounts',COALESCE(v_old_manage,false),'revision',v_old.review_revision);
  END IF;
  v_revision := p_expected_revision+1;
  INSERT INTO account_security_private.reviewed_roles
    (auth_user_id,legacy_user_id,role,enabled,review_reference,reviewed_at,review_revision)
  VALUES (p_auth_user_id,p_legacy_user_id,p_role,p_enabled,btrim(p_review_reference),clock_timestamp(),v_revision)
  ON CONFLICT (auth_user_id) DO UPDATE SET role=EXCLUDED.role,enabled=EXCLUDED.enabled,
    review_reference=EXCLUDED.review_reference,reviewed_at=EXCLUDED.reviewed_at,review_revision=EXCLUDED.review_revision;
  IF p_can_manage_accounts THEN
    INSERT INTO account_security_private.reviewed_admins
      (auth_user_id,legacy_user_id,enabled,review_reference,reviewed_at)
    VALUES (p_auth_user_id,p_legacy_user_id,true,btrim(p_review_reference),clock_timestamp())
    ON CONFLICT (auth_user_id) DO UPDATE SET enabled=true,
      review_reference=EXCLUDED.review_reference,reviewed_at=EXCLUDED.reviewed_at;
  ELSE
    UPDATE account_security_private.reviewed_admins SET enabled=false,
      review_reference=btrim(p_review_reference),reviewed_at=clock_timestamp()
      WHERE auth_user_id=p_auth_user_id;
  END IF;
  -- Accounts need not already have a session: this must work before first login
  -- and during recovery. Actual login/recovery access must be tested separately.
  PERFORM 1 FROM account_security_private.reviewed_roles r
    JOIN account_security_private.reviewed_admins a
      ON a.auth_user_id=r.auth_user_id AND a.legacy_user_id=r.legacy_user_id
    JOIN auth.users u ON u.id=r.auth_user_id
    JOIN public.users p ON p.id=r.legacy_user_id
    WHERE r.role='Admin' AND r.enabled AND a.enabled
      AND u.deleted_at IS NULL AND NOT COALESCE(u.is_anonymous,false)
      AND (u.banned_until IS NULL OR u.banned_until<=statement_timestamp())
    FOR SHARE OF r,a,u;
  IF NOT FOUND THEN RAISE EXCEPTION 'ROLE_REVIEW_LAST_ADMIN_REQUIRED'; END IF;
  v_after := jsonb_build_object('role',p_role,'enabled',p_enabled,
    'canManageAccounts',p_can_manage_accounts,'revision',v_revision);
  INSERT INTO account_security_private.role_review_events
    (auth_user_id,legacy_user_id,previous_state,next_state,review_reference,reviewer_reference,recovery_reference)
  VALUES (p_auth_user_id,p_legacy_user_id,v_before,v_after,btrim(p_review_reference),
    btrim(p_reviewer_reference),CASE WHEN p_can_manage_accounts THEN btrim(p_recovery_reference) ELSE NULL END);
  RETURN v_revision;
END;
$review$;
REVOKE ALL ON FUNCTION account_security_private.review_account_role(uuid,integer,text,text,text,boolean,boolean,bigint,text,text,text)
  FROM PUBLIC,anon,authenticated;
-- Supabase may supply default grants to service_role; it is NOT an operator.
DO $acl$
DECLARE v_role text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    REVOKE ALL ON account_security_private.role_review_events FROM service_role;
    REVOKE ALL ON SEQUENCE account_security_private.role_review_events_id_seq FROM service_role;
    REVOKE ALL ON FUNCTION account_security_private.review_account_role(uuid,integer,text,text,text,boolean,boolean,bigint,text,text,text),
      account_security_private.prevent_role_review_change(),account_security_private.assert_crm_review_ready() FROM service_role;
  END IF;
  FOR v_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role') LOOP
    IF has_function_privilege(v_role,'account_security_private.review_account_role(uuid,integer,text,text,text,boolean,boolean,bigint,text,text,text)','EXECUTE')
      OR has_table_privilege(v_role,'account_security_private.role_review_events','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') THEN
      RAISE EXCEPTION 'ROLE_REVIEW_UNEXPECTED_GRANT';
    END IF;
  END LOOP;
END;
$acl$;
ROLLBACK;
