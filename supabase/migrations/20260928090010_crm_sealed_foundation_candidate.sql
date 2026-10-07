-- LOCAL CANDIDATE. Not approved for production. Never db push this directory:
-- installed account/directory migrations have different remote timestamps.
-- Empty, sealed CRM foundation ONLY. No role seed, backfill, activation or Cron.
-- Evidence settings are operator attestations, not proof of target or authority.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='30s';
-- PostgreSQL 17+: cap the entire transaction, not only each DDL statement.
SET LOCAL transaction_timeout='30s';
DO $release$
BEGIN
  IF current_setting('buildtrack.crm_foundation_release',true) IS DISTINCT FROM 'sealed_crm_v1_20260928'
    OR current_setting('buildtrack.crm_foundation_project',true) IS DISTINCT FROM 'kbthmdedilswdmmczfay'
    OR length(btrim(coalesce(current_setting('buildtrack.crm_foundation_backup',true),'')))<8
    OR length(btrim(coalesce(current_setting('buildtrack.crm_foundation_auth_compatibility',true),'')))<8
    OR current_setting('buildtrack.crm_foundation_legacy_clients_reviewed',true) IS DISTINCT FROM 'yes'
    OR current_setting('buildtrack.crm_foundation_mode',true) IS DISTINCT FROM 'sealed_no_backfill' THEN
    RAISE EXCEPTION 'CRM_FOUNDATION_REVIEW_REQUIRED';
  END IF;
  IF to_regnamespace('sales_private') IS NOT NULL
    OR to_regclass('account_security_private.reviewed_roles') IS NOT NULL THEN
    RAISE EXCEPTION 'CRM_FOUNDATION_EXISTING_INSTALL_REVIEW_REQUIRED';
  END IF;
END;
$release$;
-- DDL already requires exclusive locks on these two legacy tables. Abort if
-- busy; no retries with relaxed timeouts. Other shared tables stay read-only.
LOCK TABLE public.sales,public.customer_voices IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.projects,public.plots,public.leads IN SHARE MODE;
DO $counts$
DECLARE v_counts jsonb;
BEGIN
  SELECT jsonb_build_object('projects',(SELECT count(*) FROM public.projects),
    'plots',(SELECT count(*) FROM public.plots),'leads',(SELECT count(*) FROM public.leads),
    'sales',(SELECT count(*) FROM public.sales),'voices',(SELECT count(*) FROM public.customer_voices)) INTO v_counts;
  IF NULLIF(current_setting('buildtrack.crm_foundation_counts',true),'')::jsonb IS DISTINCT FROM v_counts THEN
    RAISE EXCEPTION 'CRM_FOUNDATION_COUNT_BASELINE_CHANGED';
  END IF;
END;
$counts$;
CREATE TEMP TABLE crm_foundation_relations ON COMMIT DROP AS
SELECT c.oid,c.relacl,c.relrowsecurity,c.relowner,n.nspname,c.relname,
  ARRAY(SELECT a.attname::text FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum) AS columns,
  NULL::text AS data_hash
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname IN ('public','account_security_private') AND c.relkind IN ('r','S');
CREATE TEMP TABLE crm_foundation_functions ON COMMIT DROP AS
SELECT p.oid,md5(pg_get_functiondef(p.oid)||coalesce(p.proacl::text,'')||p.proowner::text) AS hash
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname IN ('public','account_security_private') AND p.prokind='f';
CREATE TEMP TABLE crm_foundation_triggers ON COMMIT DROP AS
SELECT t.oid,md5(pg_get_triggerdef(t.oid)||t.tgenabled::text) AS hash FROM pg_trigger t
WHERE t.tgrelid IN (SELECT oid FROM crm_foundation_relations) AND NOT t.tgisinternal;
CREATE TEMP TABLE crm_foundation_policies ON COMMIT DROP AS
SELECT p.oid,md5(to_jsonb(p)::text) AS hash FROM pg_policy p
WHERE p.polrelid IN (SELECT oid FROM crm_foundation_relations);
DO $snapshots$
DECLARE r record; v_hash text;
BEGIN
  FOR r IN SELECT * FROM crm_foundation_relations WHERE
    (nspname='public' AND relname IN ('projects','plots','leads','sales','customer_voices'))
    OR (nspname='account_security_private' AND relname='reviewed_admins') LOOP
    EXECUTE format('SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,''[]'')) FROM %I.%I t',r.nspname,r.relname) INTO v_hash;
    UPDATE crm_foundation_relations SET data_hash=v_hash WHERE oid=r.oid;
  END LOOP;
END;
$snapshots$;

-- Reviewed source: sql/security/crm_identity_foundation_draft.sql
-- LF-normalized SHA256: 2789510bf6d2b19bd4c1cf75ebbb66fdb3bd2fbe44252994293513d1fa2fcf48
-- DESIGN / ISOLATED TEST ONLY. Additive identity foundation, NOT a deployment.
-- Alternative to the ALL-DEPARTMENT trusted_actor draft, never install both.
-- Keep the installed account dispatcher, Admin allowlist and legacy presence
-- unchanged. No seeds, customer changes, role approval, or feature activation.
-- Later role_review + CRM projection must be reviewed as a separate atomic unit.
-- This stage intentionally does not make reviewed_roles govern legacy commands.

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

-- Reviewed source: sql/security/role_review_draft.sql
-- LF-normalized SHA256: ae5dc09880057c483ae555fa8dfd68e480bac804863918ec97b00b5041ae4cce
-- DESIGN / ISOLATED TEST ONLY. No identities, seeds, public RPC or Auth writes.
-- Operator-only review primitive; not an app-admin screen or deployable migration.


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

-- Reviewed source: sales_workflow_v2_draft.sql
-- LF-normalized SHA256: 8559adef5a8e39d6e3640d279f78c3b9b48d8218ef09e5fb16b4b2cec0cfebd5
-- BUILDTRACK SALES V2 — DESIGN DRAFT, revised 2026-09-15 after supplied preflight
-- Scope: Phase 1–2 data design. NOT an executable deployment migration.
-- Source of business rules: docs/sales-workflow-phase-1-2.md.
-- This replaces the unapplied 2026-09-04 design; it does not upgrade an installed V2.
-- No legacy data updates, policy replacement, discount approval, or public QR RPC.
-- Direct table writes remain closed; central-intake RPCs below default to disabled.
--
-- Read-only preflight required before producing a deployable migration:
--   * Inspect pg_attribute/pg_constraint for projects.name, plots.id, sales.plot_id,
--     leads.id, sales.id and customer_voices.id. Supplied report dated 2026-09-15
--     12:27:34 +07 confirms plots.id/sales.plot_id TEXT, projects.name TEXT PK,
--     and lead/sale/voice IDs UUID. It found no V2 tables in the inspected names.
--   * Inspect pg_policies, pg_trigger and existing functions for legacy CRM tables.
--   * Check duplicate project names and multiple non-cancelled sales per plot.
--   * Review customers missing names/phones, shared phones, and legacy owner mapping.
--   * Compare booking value vs deposit; never infer deposits or missing event dates.
--   * Inspect legacy required columns, money defaults and cascading Lead deletes.
--   * If any older V2 objects already exist, design an explicit forward migration.
--   * Existing plots/projects have permissive PUBLIC ALL policies plus anon grants.
--     Fix grants/policies with all affected app roles reviewed before any cutover.
--   * Step 3 received: the phone group contains ALL 895 legacy leads; user confirms
--     real historical records with placeholder phones, not one duplicate customer.
--     All 289 deposits are stored as zero and booking dates absent; 9 prices absent.
--     Unproven historical fields stay unknown; preserve raw source before backfill.
--   * User confirms existing Auth TEAW is TAEW (display name), not a new account.
--   * users ALSO has broad anon grants/policies. Security cutover, verified staff
--     mapping, full legacy-ID manifest and staging tests remain deployment gates.
--
-- Whole-file execution deliberately aborts BEFORE persistent DDL and also ends in
-- ROLLBACK. Remove neither safeguard for production without a separate reviewed
-- migration and the user's explicit Supabase authorization.



-- 1. Trusted roles and phone lookup.
-- Bootstrap/link roles using verified auth IDs via an Admin-only server process.
-- Do not authorize from client-controlled form fields or user_metadata.
CREATE SCHEMA sales_private;
REVOKE ALL ON SCHEMA sales_private FROM PUBLIC, anon, authenticated;

CREATE TABLE sales_private.crm_user_roles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
  role text NOT NULL CHECK (role IN ('admin', 'owner', 'sales')),
  display_name text,
  is_active boolean NOT NULL DEFAULT true
);
ALTER TABLE sales_private.crm_user_roles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sales_private.crm_user_roles FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.crm_v2_role()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $role$
  SELECT COALESCE((
    SELECT r.role FROM sales_private.crm_user_roles r
    WHERE r.user_id = auth.uid() AND r.is_active
  ), '');
$role$;
REVOKE ALL ON FUNCTION public.crm_v2_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_v2_role() TO authenticated;

CREATE FUNCTION public.crm_v2_normalize_phone(p_phone text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = pg_catalog
AS $phone$
  SELECT CASE
    WHEN length(digits) IN (12,13) AND digits LIKE '0066%' THEN '0'||substring(digits FROM 5)
    WHEN length(digits) IN (10,11) AND digits LIKE '66%' THEN '0'||substring(digits FROM 3)
    ELSE digits END
  FROM (SELECT regexp_replace(COALESCE(p_phone,''),'[^0-9]','','g') AS digits) n;
$phone$;
REVOKE ALL ON FUNCTION public.crm_v2_normalize_phone(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_v2_normalize_phone(text) TO authenticated;

-- 2. Central customer/Lead. A customer needs ZERO projects at creation.
-- Command API: owner = authenticated Sales creator, never supplied by the client.
-- Admin import/create-on-behalf must explicitly choose a Sales owner.
CREATE TABLE public.sales_customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_name text NOT NULL CHECK (btrim(customer_name) <> ''),
  record_origin text NOT NULL DEFAULT 'live' CHECK (record_origin IN ('live','legacy_import')),
  legacy_source_lead_id uuid UNIQUE REFERENCES public.leads(id) ON DELETE RESTRICT,
  phone text,
  phone_data_status text NOT NULL DEFAULT 'provided' CHECK (phone_data_status IN ('provided','unknown_legacy')),
  phone_normalized text GENERATED ALWAYS AS (
    CASE WHEN phone IS NULL THEN NULL ELSE public.crm_v2_normalize_phone(phone) END
  ) STORED,
  email text,
  line_id text,
  intake_channel text,
  acquisition_source text,
  intake_notes text,
  occupation text,
  monthly_income numeric(15,2) CHECK (monthly_income >= 0),
  personal_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  intake_status text NOT NULL DEFAULT 'new'
    CHECK (intake_status IN ('new','contacted','following_up','nurture','lost','legacy_unclassified')),
  owner_user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_by_user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE RESTRICT,
  owner_assigned_at timestamptz NOT NULL DEFAULT now(),
  lead_created_at timestamptz DEFAULT now(), -- explicit NULL for unknown legacy date
  first_contacted_at timestamptz,
  merged_into_customer_id uuid REFERENCES public.sales_customers(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (merged_into_customer_id IS NULL OR merged_into_customer_id <> id),
  CONSTRAINT crm_customer_origin_check CHECK (
    (record_origin='live' AND legacy_source_lead_id IS NULL AND lead_created_at IS NOT NULL
      AND intake_status<>'legacy_unclassified')
    OR (record_origin='legacy_import' AND legacy_source_lead_id IS NOT NULL)
  ),
  CONSTRAINT crm_customer_phone_evidence_check CHECK (
    (phone_data_status='unknown_legacy' AND record_origin='legacy_import' AND phone IS NULL)
    OR (phone_data_status='provided' AND phone IS NOT NULL
      AND phone ~ '^\+?[0-9 ()-]+$'
      AND length(regexp_replace(phone,'[^0-9]','','g')) BETWEEN 7 AND 15)
  )
);
-- Deliberately NOT UNIQUE: two different people can share a contact phone.
-- Canonical Thai country prefixes support duplicate warnings, never automatic merge.
-- Live create commands require the actual intake timestamp; imports explicitly
-- supply NULL when unknown and exclude those rows from dated cohort calculations.
-- Imports without a verified Sales owner remain in import review, not this table.
-- For the user-confirmed 895-row legacy batch: one initial customer per legacy ID,
-- not per placeholder phone OR name. Unknown phone is NULL/unknown_legacy; preserve
-- raw fields in the private snapshot. No live endpoint accepts these origin fields.
-- Historical unproven lead dates are explicitly NULL, never the default now().
-- Use legacy_unclassified instead of copying the old blanket Follow-up default.
-- No initial-contact SLA, fake Visit or loan attempt is created by historical import.
CREATE INDEX sales_customers_phone_lookup_idx ON public.sales_customers(phone_normalized);

CREATE TABLE public.crm_duplicate_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.sales_customers(id) ON DELETE RESTRICT,
  candidate_customer_id uuid NOT NULL REFERENCES public.sales_customers(id) ON DELETE RESTRICT,
  decision text NOT NULL DEFAULT 'pending'
    CHECK (decision IN ('pending','same_person','distinct_people_shared_phone')),
  reason text,
  reviewed_by_user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (customer_id <> candidate_customer_id),
  CHECK (decision = 'pending' OR
    (reviewed_by_user_id IS NOT NULL AND reviewed_at IS NOT NULL
     AND reason IS NOT NULL AND btrim(reason) <> ''))
);
CREATE UNIQUE INDEX crm_duplicate_pair_idx ON public.crm_duplicate_reviews
  (LEAST(customer_id,candidate_customer_id), GREATEST(customer_id,candidate_customer_id));

-- 3. Prospective project interests, later activated by a Visit or Booking.
-- Supplied preflight confirms PRIMARY KEY projects(name): reuse it, no duplicate index.
CREATE TABLE public.lead_project_interests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.sales_customers(id) ON DELETE RESTRICT,
  project_name text NOT NULL REFERENCES public.projects(name) ON UPDATE CASCADE ON DELETE RESTRICT,
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  owner_assigned_at timestamptz NOT NULL DEFAULT now(),
  workspace_state text NOT NULL DEFAULT 'central_interest'
    CHECK (workspace_state IN ('central_interest','project_active')),
  activated_at timestamptz,
  activation_reason text CHECK (activation_reason IN ('visit','booking','legacy_import')),
  engagement_status text NOT NULL DEFAULT 'new'
    CHECK (engagement_status IN ('new','contacted','considering','follow_up','nurture','lost')),
  interested_plot_id text REFERENCES public.plots(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  channel text,
  source text,
  interest_created_at timestamptz NOT NULL DEFAULT now(),
  notes text,
  created_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_id,project_name),
  UNIQUE (id,customer_id),
  UNIQUE (id,project_name),
  CHECK (
    (workspace_state = 'central_interest' AND activated_at IS NULL AND activation_reason IS NULL)
    OR (workspace_state = 'project_active' AND activation_reason IS NOT NULL
        AND (activated_at IS NOT NULL OR activation_reason = 'legacy_import'))
  )
);
-- No per-project membership table: Sales/Owner/Admin read ALL projects.
-- New interest inherits the central owner; ONLY Admin may change the owner.
-- Target plot must match project and be available at save; selection never books.
-- Company and project cohort use customer.lead_created_at. interest_created_at and
-- activated_at are separate operational dates; transfer must not reset the cohort.
CREATE INDEX lead_interests_owner_idx ON public.lead_project_interests(owner_user_id);
CREATE INDEX lead_interests_workspace_idx ON public.lead_project_interests(project_name,workspace_state);

-- 4. Appointments and Visits are separate, repeatable events.
CREATE TABLE public.lead_appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_interest_id uuid NOT NULL REFERENCES public.lead_project_interests(id) ON DELETE RESTRICT,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  status text NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled','rescheduled','attended','no_show','cancelled')),
  assigned_sales_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id,project_interest_id),
  CHECK (ends_at IS NULL OR ends_at > starts_at)
);
CREATE TABLE public.lead_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_interest_id uuid NOT NULL REFERENCES public.lead_project_interests(id) ON DELETE RESTRICT,
  appointment_id uuid,
  status text NOT NULL DEFAULT 'awaiting_voice'
    CHECK (status IN ('awaiting_voice','completed','cancelled')),
  checked_in_at timestamptz NOT NULL DEFAULT now(),
  checked_in_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  completed_at timestamptz,
  completed_voice_id uuid,
  completion_evidence_state text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id,project_interest_id),
  UNIQUE (appointment_id),
  FOREIGN KEY (appointment_id,project_interest_id)
    REFERENCES public.lead_appointments(id,project_interest_id) ON DELETE RESTRICT,
  CHECK (
    (status = 'completed' AND completed_at IS NOT NULL AND completed_voice_id IS NOT NULL
     AND completion_evidence_state IS NOT NULL AND completion_evidence_state = 'submitted')
    OR (status <> 'completed' AND completed_at IS NULL AND completed_voice_id IS NULL
        AND completion_evidence_state IS NULL)
  ),
  CHECK (completed_at IS NULL OR completed_at >= checked_in_at)
);

-- Legacy survey rows keep visit_id NULL; they do not fabricate completed Visits.
-- Required answers are validated by a versioned command before marking submitted.
ALTER TABLE public.customer_voices
  ADD COLUMN visit_id uuid REFERENCES public.lead_visits(id) ON DELETE RESTRICT,
  ADD COLUMN crm_answers jsonb,
  ADD COLUMN crm_form_version text,
  ADD COLUMN crm_submission_state text CHECK (crm_submission_state IN ('draft','submitted')),
  ADD COLUMN crm_submitted_at timestamptz,
  ADD COLUMN crm_validated_at timestamptz,
  ADD COLUMN crm_submitted_by_customer boolean;
ALTER TABLE public.customer_voices ADD CONSTRAINT customer_voices_v2_submission_check CHECK (
  visit_id IS NULL OR
  (crm_submission_state IS NOT NULL AND crm_form_version IS NOT NULL AND btrim(crm_form_version) <> ''
   AND crm_answers IS NOT NULL AND jsonb_typeof(crm_answers) = 'object'
   AND (crm_submission_state = 'draft' OR
     (crm_submitted_at IS NOT NULL AND crm_validated_at IS NOT NULL
      AND crm_submitted_by_customer IS NOT NULL AND crm_submitted_by_customer = true)))
);
CREATE UNIQUE INDEX customer_voices_one_per_visit_idx ON public.customer_voices(visit_id)
  WHERE visit_id IS NOT NULL;
ALTER TABLE public.customer_voices ADD CONSTRAINT customer_voices_submission_identity_key
  UNIQUE (id,visit_id,crm_submission_state);
-- A completed Visit must reference a submitted response FOR THAT SAME Visit.
ALTER TABLE public.lead_visits ADD CONSTRAINT lead_visits_submission_evidence_fk
  FOREIGN KEY (completed_voice_id,id,completion_evidence_state)
  REFERENCES public.customer_voices(id,visit_id,crm_submission_state) ON DELETE RESTRICT;

-- Store only token HASHES here, not a plaintext QR secret in a readable Visit row.
CREATE TABLE sales_private.visit_submission_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id uuid NOT NULL REFERENCES public.lead_visits(id) ON DELETE RESTRICT,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);
ALTER TABLE sales_private.visit_submission_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sales_private.visit_submission_tokens FROM PUBLIC, anon, authenticated;
-- No public submission function is shipped in this design. Future command must
-- validate form_version, required answers, type/range/size, token expiry and reuse,
-- and commit response + Visit completion + token consumption atomically.

-- 5. SOP completion is INDEPENDENT of Visit completion.
-- Keep the user's legacy house_visit_checklists and its policies untouched.
CREATE TABLE public.house_visit_checklist_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_name text NOT NULL REFERENCES public.projects(name) ON UPDATE CASCADE ON DELETE RESTRICT,
  plot_id text NOT NULL REFERENCES public.plots(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  project_interest_id uuid,
  appointment_id uuid,
  visit_id uuid,
  responsible_sales_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  template_version text NOT NULL,
  current_stage text NOT NULL DEFAULT 'stage_a'
    CHECK (current_stage IN ('stage_a','stage_b','stage_c','completed')),
  stage_a_completed_at timestamptz,
  stage_b_started_at timestamptz,
  stage_c_completed_at timestamptz,
  recap jsonb NOT NULL DEFAULT '{}'::jsonb,
  next_action text,
  next_follow_up_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_interest_id,project_name)
    REFERENCES public.lead_project_interests(id,project_name) ON UPDATE CASCADE ON DELETE RESTRICT,
  FOREIGN KEY (appointment_id,project_interest_id)
    REFERENCES public.lead_appointments(id,project_interest_id) ON DELETE RESTRICT,
  FOREIGN KEY (visit_id,project_interest_id)
    REFERENCES public.lead_visits(id,project_interest_id) ON DELETE RESTRICT,
  CHECK ((appointment_id IS NULL AND visit_id IS NULL) OR project_interest_id IS NOT NULL),
  CHECK (current_stage <> 'completed' OR
    (stage_a_completed_at IS NOT NULL AND stage_b_started_at IS NOT NULL AND stage_c_completed_at IS NOT NULL))
);
CREATE UNIQUE INDEX checklist_run_per_visit_idx ON public.house_visit_checklist_runs(visit_id)
  WHERE visit_id IS NOT NULL;
CREATE TABLE public.house_visit_checklist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.house_visit_checklist_runs(id) ON DELETE RESTRICT,
  stage text NOT NULL CHECK (stage IN ('stage_a','stage_b','stage_c')),
  item_key text NOT NULL,
  item_label_snapshot text NOT NULL,
  result text NOT NULL DEFAULT 'pending' CHECK (result IN ('pending','done','not_applicable','skipped')),
  reason text,
  answered_by_user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  answered_at timestamptz,
  UNIQUE (run_id,stage,item_key),
  CHECK (result NOT IN ('not_applicable','skipped') OR (reason IS NOT NULL AND btrim(reason) <> '')),
  CHECK (result = 'pending' OR (answered_by_user_id IS NOT NULL AND answered_at IS NOT NULL))
);
-- Stage completion command checks the full versioned item list, not just the rows
-- present, and saves each stage before opening the customer questionnaire.
-- Standalone house preparation may initially have no customer and later link to a
-- matching appointment/Visit. Only Sales performs SOP; Admin corrections are audited.
-- The command verifies the prepared plot belongs to this project; preparing a
-- house does not reserve it. Interested plot and actual visited plot may differ.

-- 6. Existing sales becomes MANY bookings per interest, one per plot/booking round.
-- Nullable columns preserve the shape of legacy rows until explicit backfill.
ALTER TABLE public.sales
  ADD COLUMN project_interest_id uuid REFERENCES public.lead_project_interests(id) ON DELETE RESTRICT,
  ADD COLUMN booking_round integer CHECK (booking_round > 0),
  ADD COLUMN previous_sale_id uuid REFERENCES public.sales(id) ON DELETE RESTRICT,
  ADD COLUMN crm_stage text CHECK (crm_stage IN (
    'booked','contracted','downpayment','document_prep','loan_submitted','loan_rejected',
    'loan_approved','transfer_pending','transferred','handover','cancelled'
  )),
  ADD COLUMN payment_method text CHECK (payment_method IN ('cash','mortgage')),
  ADD COLUMN booking_route text CHECK (booking_route IN ('visited','without_visit','legacy_import')),
  ADD COLUMN booking_route_reason text,
  ADD COLUMN list_price numeric(15,2) CHECK (list_price >= 0),
  ADD COLUMN discount_amount numeric(15,2) CHECK (discount_amount >= 0),
  ADD COLUMN booked_at timestamptz,
  ADD COLUMN contracted_at timestamptz,
  ADD COLUMN crm_handover_at timestamptz,
  ADD COLUMN cancelled_at timestamptz,
  ADD COLUMN legacy_cancellation_batch_id uuid, -- FK to proven pre-cutover cancellation below
  ADD COLUMN cancellation_category text CHECK (cancellation_category IN (
    'booking_cancelled','downpayment_abandoned','final_loan_rejection','other'
  )),
  ADD COLUMN closing_sales_user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT;
ALTER TABLE public.sales ADD CONSTRAINT sales_v2_fields_check CHECK (
  project_interest_id IS NULL OR
  (booking_round IS NOT NULL AND crm_stage IS NOT NULL AND booking_route IS NOT NULL)
);
ALTER TABLE public.sales ADD CONSTRAINT sales_v2_remote_booking_check CHECK (
  booking_route IS DISTINCT FROM 'without_visit'
  OR (booking_route_reason IS NOT NULL AND btrim(booking_route_reason) <> '')
);
ALTER TABLE public.sales ADD CONSTRAINT sales_v2_cancellation_check CHECK (
  crm_stage IS DISTINCT FROM 'cancelled'
  OR (COALESCE(booking_route = 'legacy_import', false) AND legacy_cancellation_batch_id IS NOT NULL)
  OR (cancelled_at IS NOT NULL AND cancellation_category IS NOT NULL
      AND cancellation_reason IS NOT NULL AND btrim(cancellation_reason) <> '')
);
ALTER TABLE public.sales ADD CONSTRAINT sales_v2_legacy_provenance_check CHECK (
  booking_route IS DISTINCT FROM 'legacy_import'
  OR (booking_route_reason IS NOT NULL AND btrim(booking_route_reason) <> '')
);
ALTER TABLE public.sales ADD CONSTRAINT sales_v2_legacy_cancellation_origin_check CHECK (
  legacy_cancellation_batch_id IS NULL
  OR (COALESCE(booking_route = 'legacy_import', false) AND COALESCE(crm_stage = 'cancelled', false))
);
-- Imported ACTIVE sales do not get a cancellation exception. The FK below only
-- permits the same sale ID whose immutable source snapshot was already Cancelled.
-- A later cancellation of an imported active sale still needs date/category/reason.
ALTER TABLE public.sales ADD CONSTRAINT sales_v2_not_own_predecessor_check
  CHECK (previous_sale_id IS NULL OR previous_sale_id <> id);
ALTER TABLE public.sales ADD CONSTRAINT sales_v2_identity_key UNIQUE (id,project_interest_id);
CREATE UNIQUE INDEX sales_interest_booking_round_idx ON public.sales(project_interest_id,booking_round)
  WHERE project_interest_id IS NOT NULL;
-- There is deliberately NO UNIQUE(project_interest_id): allow multiple plots and
-- a NEW sale after cancellation. Preserve prior sale and each loan attempt.
-- Requires legacy duplicate/unknown-status audit and compatible triggers BEFORE cutover.
-- DEFERRED: sales_active_plot_booking_idx belongs to the frozen legacy-write cutover.
-- This index retains ownership after transfer/handover; such plots are not stock.
-- Booking/cancel/switch commands must lock plots, recheck project/availability,
-- synchronize legacy contract_status and has_customer, and append audit atomically.
-- Existing sale_price = agreed house price; booking_amount = deposit.
-- Unknown historical amounts stay unknown. Validate list_price - discount_amount
-- against agreed sale_price for NEW bookings only. No approval entity/status.
-- A separately reviewed backfill must snapshot raw sales first, then set proven
-- placeholder deposits to NULL for its EXACT manifest IDs (not every zero ever).
-- Existing positive prices stay recorded legacy values; absent 9 prices stay NULL.
-- Do not fill unknown booking/cancellation dates, categories or customer reasons.
-- legacy_import requires migration provenance, distinct from a customer reason;
-- actual new cancellation commands still require date, category and reason.

CREATE TABLE public.sale_plot_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES public.sales(id) ON DELETE RESTRICT,
  -- Historical plot identifiers are snapshots, not mutable foreign keys. A rename
  -- must not rewrite the old/new identifier recorded in this immutable event.
  old_plot_id text NOT NULL,
  new_plot_id text NOT NULL,
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  changed_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CHECK (old_plot_id <> new_plot_id)
);

CREATE TABLE public.loan_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_interest_id uuid NOT NULL REFERENCES public.lead_project_interests(id) ON DELETE RESTRICT,
  sale_id uuid,
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  kind text NOT NULL CHECK (kind IN ('preapproval','purchase')),
  bank_name text NOT NULL CHECK (btrim(bank_name) <> ''),
  result_status text NOT NULL DEFAULT 'submitted'
    CHECK (result_status IN ('submitted','pending','rejected','approved','withdrawn')),
  submitted_at timestamptz,
  result_at timestamptz,
  result_reason text,
  approved_amount numeric(15,2) CHECK (approved_amount >= 0),
  recorded_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (sale_id,project_interest_id) REFERENCES public.sales(id,project_interest_id) ON DELETE RESTRICT,
  CHECK (kind <> 'purchase' OR sale_id IS NOT NULL),
  CHECK (result_status <> 'rejected' OR (result_reason IS NOT NULL AND btrim(result_reason) <> ''))
);
CREATE UNIQUE INDEX loan_sale_attempt_idx ON public.loan_attempts(sale_id,attempt_number) WHERE sale_id IS NOT NULL;
CREATE UNIQUE INDEX loan_preapproval_attempt_idx ON public.loan_attempts(project_interest_id,attempt_number) WHERE sale_id IS NULL;
-- Cash purchases bypass loan commands; rejected attempts stay immutable after result.
-- A fresh attempt is a fresh row, not a reset from rejected back to submitted.

-- 7. Activities and immutable event history.
CREATE TABLE public.lead_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.sales_customers(id) ON DELETE RESTRICT,
  project_interest_id uuid,
  sale_id uuid,
  activity_type text NOT NULL CHECK (activity_type IN ('call','chat','follow_up','note')),
  result text CHECK (result IN ('contact_success','no_answer','customer_requested_later','other')),
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  recorded_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  next_follow_up_at timestamptz,
  note text,
  FOREIGN KEY (project_interest_id,customer_id)
    REFERENCES public.lead_project_interests(id,customer_id) ON DELETE RESTRICT,
  FOREIGN KEY (sale_id,project_interest_id) REFERENCES public.sales(id,project_interest_id) ON DELETE RESTRICT,
  CHECK (sale_id IS NULL OR project_interest_id IS NOT NULL)
);
CREATE INDEX lead_activities_customer_time_idx ON public.lead_activities(customer_id,occurred_at DESC);
CREATE TABLE public.crm_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES public.sales_customers(id) ON DELETE RESTRICT,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  event_type text NOT NULL,
  reason_code text,
  reason_text text NOT NULL CHECK (btrim(reason_text) <> ''),
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  actor_kind text NOT NULL CHECK (actor_kind IN ('staff','customer','system','legacy_import')),
  actor_name_snapshot text,
  old_values jsonb,
  new_values jsonb,
  occurred_at timestamptz, -- unknown imported dates remain NULL
  recorded_at timestamptz NOT NULL DEFAULT now(),
  correction_of_event_id uuid REFERENCES public.crm_audit_events(id) ON DELETE RESTRICT
);
-- Future commands derive actor from session/token, append events for every status,
-- owner/plot/stage change, and retain creator/closing-agent snapshots.
-- No blanket UPDATE/DELETE policy for history and no cascade-delete of customers.

-- 8. Fair SLA: actual customer wait AND staff working-time accountability.
CREATE TABLE public.crm_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  central_intake_enabled boolean NOT NULL DEFAULT false,
  initial_contact_hours integer NOT NULL DEFAULT 24 CHECK (initial_contact_hours > 0),
  follow_up_max_gap_hours integer NOT NULL DEFAULT 48 CHECK (follow_up_max_gap_hours > 0),
  next_shift_response_minutes integer NOT NULL DEFAULT 120 CHECK (next_shift_response_minutes > 0),
  timezone_name text NOT NULL DEFAULT 'Asia/Bangkok',
  notification_channel text NOT NULL DEFAULT 'in_app' CHECK (notification_channel = 'in_app'),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.crm_work_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  period_type text NOT NULL CHECK (period_type IN ('work','leave','break')),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  reason text,
  created_by_admin_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX crm_work_periods_sales_time_idx ON public.crm_work_periods(sales_user_id,starts_at,ends_at);
CREATE TABLE public.crm_sla_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.sales_customers(id) ON DELETE RESTRICT,
  project_interest_id uuid,
  source_activity_id uuid REFERENCES public.lead_activities(id) ON DELETE RESTRICT,
  owner_user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  task_type text NOT NULL CHECK (task_type IN ('first_contact','follow_up')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','cancelled')),
  obligation_started_at timestamptz NOT NULL,
  service_due_at timestamptz NOT NULL,
  staff_due_at timestamptz,
  notify_at timestamptz,
  accountability_state text NOT NULL DEFAULT 'needs_schedule'
    CHECK (accountability_state IN ('needs_schedule','needs_owner','ready','exception')),
  evaluation_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  completed_by_activity_id uuid REFERENCES public.lead_activities(id) ON DELETE RESTRICT,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_interest_id,customer_id)
    REFERENCES public.lead_project_interests(id,customer_id) ON DELETE RESTRICT,
  CHECK (service_due_at >= obligation_started_at),
  CHECK (accountability_state <> 'ready' OR (owner_user_id IS NOT NULL AND staff_due_at IS NOT NULL)),
  CHECK (status <> 'done' OR (completed_at IS NOT NULL AND completed_by_activity_id IS NOT NULL))
);
CREATE UNIQUE INDEX crm_first_contact_open_idx ON public.crm_sla_tasks(customer_id)
  WHERE task_type = 'first_contact' AND status = 'open';
CREATE INDEX crm_sla_due_idx ON public.crm_sla_tasks(service_due_at) WHERE status = 'open';
CREATE TABLE public.crm_sla_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.crm_sla_tasks(id) ON DELETE RESTRICT,
  exception_type text NOT NULL CHECK (exception_type IN (
    'customer_requested_later','outside_shift','approved_leave','owner_change','missing_schedule','legacy_data'
  )),
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  requested_follow_up_at timestamptz,
  evidence_note text,
  recorded_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Never reset lead_created_at or service_due_at on assignment/project activation.
-- Compute staff_due_at from actual assigned work windows minus leave/breaks.
-- No schedule = no automatic poor-performance score. Outside-hours target is two
-- working hours from next shift; a customer's later appointment is explicit exception.
-- A no-answer attempt is NOT first_contacted_at/contact_success.
-- Backdated activities must not replace the latest follow-up deadline.

CREATE TABLE public.crm_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  task_id uuid REFERENCES public.crm_sla_tasks(id) ON DELETE RESTRICT,
  visit_id uuid REFERENCES public.lead_visits(id) ON DELETE RESTRICT,
  checklist_run_id uuid REFERENCES public.house_visit_checklist_runs(id) ON DELETE RESTRICT,
  notification_type text NOT NULL CHECK (notification_type IN (
    'due_soon','overdue','voice_pending','checklist_pending','owner_missing'
  )),
  dedupe_key text NOT NULL,
  message text NOT NULL,
  available_at timestamptz NOT NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (recipient_user_id,dedupe_key)
);
-- Future scheduled backend task emits these; this SQL schedules NO automation.

-- 9. Admin master data and legacy mapping. No automatic matching by name/phone.
CREATE TABLE public.sales_reason_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL,
  code text NOT NULL,
  label_th text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  UNIQUE (category,code)
);
CREATE TABLE public.crm_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_name text NOT NULL,
  file_hash text NOT NULL,
  mapping_version text NOT NULL,
  status text NOT NULL DEFAULT 'preview' CHECK (status IN ('preview','validated','applied','failed')),
  created_by_admin_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (file_hash,mapping_version)
);
CREATE TABLE sales_private.crm_legacy_source_snapshots (
  import_batch_id uuid NOT NULL REFERENCES public.crm_import_batches(id) ON DELETE RESTRICT,
  legacy_lead_id uuid REFERENCES public.leads(id) ON DELETE RESTRICT,
  legacy_sale_id uuid REFERENCES public.sales(id) ON DELETE RESTRICT,
  source_payload jsonb NOT NULL CHECK (jsonb_typeof(source_payload)='object'),
  legacy_cancelled_sale_id uuid GENERATED ALWAYS AS (
    CASE WHEN legacy_sale_id IS NOT NULL
      AND source_payload->>'id'=legacy_sale_id::text
      AND source_payload->>'contract_status'='Cancelled'
    THEN legacy_sale_id ELSE NULL END
  ) STORED,
  captured_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((legacy_lead_id IS NOT NULL AND legacy_sale_id IS NULL)
    OR (legacy_lead_id IS NULL AND legacy_sale_id IS NOT NULL)),
  UNIQUE (import_batch_id,legacy_lead_id),
  UNIQUE (import_batch_id,legacy_sale_id),
  UNIQUE (import_batch_id,legacy_cancelled_sale_id)
);
ALTER TABLE sales_private.crm_legacy_source_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sales_private.crm_legacy_source_snapshots FROM PUBLIC, anon, authenticated;
ALTER TABLE public.sales ADD CONSTRAINT sales_v2_legacy_cancellation_source_fk
  FOREIGN KEY (legacy_cancellation_batch_id,id)
  REFERENCES sales_private.crm_legacy_source_snapshots(import_batch_id,legacy_cancelled_sale_id)
  ON DELETE RESTRICT;
-- Immutable through future Admin import commands: compare full payload on replay,
-- never overwrite a prior snapshot. No generic source-payload browser read API.
-- source_payload is the full original row, including id and exact contract_status.
-- Only capture the frozen pre-cutover manifest; later runtime writes cannot create
-- new legacy cancellation evidence or replace the original source snapshot.
-- A new mapping version uses a new batch; links below keep legacy-ID idempotency.
CREATE TABLE public.crm_legacy_lead_links (
  legacy_lead_id uuid PRIMARY KEY REFERENCES public.leads(id) ON DELETE RESTRICT,
  customer_id uuid NOT NULL REFERENCES public.sales_customers(id) ON DELETE RESTRICT,
  project_interest_id uuid,
  import_batch_id uuid REFERENCES public.crm_import_batches(id) ON DELETE RESTRICT,
  resolution_note text NOT NULL,
  FOREIGN KEY (project_interest_id,customer_id)
    REFERENCES public.lead_project_interests(id,customer_id) ON DELETE RESTRICT
);
CREATE TABLE public.crm_import_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.crm_import_batches(id) ON DELETE RESTRICT,
  sheet_name text NOT NULL,
  source_row integer NOT NULL CHECK (source_row > 0),
  customer_id uuid REFERENCES public.sales_customers(id) ON DELETE RESTRICT,
  project_interest_id uuid REFERENCES public.lead_project_interests(id) ON DELETE RESTRICT,
  sale_id uuid REFERENCES public.sales(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('pending','review','applied','failed','skipped')),
  diagnostics jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (batch_id,sheet_name,source_row)
);
-- Many legacy Lead rows may map to the same customer/interest; retain every link.
-- Missing names/unverified owners remain in review. User-confirmed historical
-- missing phones may become NULL only with legacy provenance, never a placeholder.
-- "Transfer pending" is not transferred; "Lost / ไม่จอง" is not booked.
-- Match status codes exactly and price/deposit columns explicitly.
-- Missing dates, salaries and deposits remain unknown; show a preview before applying.

-- 10. New-object access only. No changes to legacy leads/sales/voice/checklist RLS.
-- Existing clients remain legacy until separately reviewed cutover.
-- Read global CRM as Sales/Admin/Owner. Write commands will later enforce:
--   * central customer: owning Sales or Admin
--   * interest/sales/activity: owning Sales of interest or Admin
--   * Owner: read-only
--   * ownership/duplicate resolution/master data/import: Admin
--   * actual SOP work: Sales; Admin corrections are distinct audit events
-- Intentionally no INSERT/UPDATE/DELETE policy or authenticated mutation GRANT.
DO $new_table_read_access$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'sales_customers','lead_project_interests','lead_appointments','lead_visits',
    'house_visit_checklist_runs','house_visit_checklist_items','sale_plot_changes',
    'loan_attempts','lead_activities','crm_audit_events','crm_settings',
    'crm_work_periods','crm_sla_tasks','crm_sla_exceptions','sales_reason_catalog'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated',table_name);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated',table_name);
    EXECUTE format(
      'CREATE POLICY crm_v2_read ON public.%I FOR SELECT TO authenticated USING (public.crm_v2_role() IN (''admin'',''owner'',''sales''))',
      table_name
    );
  END LOOP;

  FOREACH table_name IN ARRAY ARRAY[
    'crm_duplicate_reviews','crm_import_batches','crm_legacy_lead_links','crm_import_rows'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated',table_name);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated',table_name);
    EXECUTE format(
      'CREATE POLICY crm_v2_admin_read ON public.%I FOR SELECT TO authenticated USING (public.crm_v2_role() = ''admin'')',
      table_name
    );
  END LOOP;
END;
$new_table_read_access$;
ALTER TABLE public.crm_notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_notifications FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.crm_notifications TO authenticated;
CREATE POLICY crm_v2_own_notifications ON public.crm_notifications FOR SELECT TO authenticated
  USING (recipient_user_id = auth.uid() AND public.crm_v2_role() IN ('admin','owner','sales'));

-- 11. Central intake API contract. This whole file remains guarded DESIGN ONLY.
-- Installing this schema defaults to disabled. The DB setting is the actual RPC
-- write kill switch, including direct authenticated calls to Supabase. The Next
-- server flag gates only the app route, not direct RPC access. Reviewed app cutover
-- needs both enabled; a write freeze/rollback MUST also disable the DB setting.
CREATE TABLE sales_private.central_command_requests (
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL,
  request_payload jsonb NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_user_id,request_id)
);
ALTER TABLE sales_private.central_command_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sales_private.central_command_requests FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.crm_v2_capabilities()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $capabilities$
  SELECT jsonb_build_object('contract_version','central_intake_v1','enabled',
    public.crm_v2_role() IN ('sales','admin','owner') AND
    COALESCE((SELECT central_intake_enabled FROM public.crm_settings WHERE id),false));
$capabilities$;
REVOKE ALL ON FUNCTION public.crm_v2_capabilities() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_v2_capabilities() TO authenticated;

CREATE FUNCTION public.crm_v2_central_snapshot(p_page integer DEFAULT 0,p_page_size integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $snapshot$
DECLARE
  actor_id uuid := auth.uid();
  actor_role text := public.crm_v2_role();
  customers_json jsonb;
  more_rows boolean;
BEGIN
  IF actor_id IS NULL OR actor_role NOT IN ('sales','admin','owner') THEN
    RAISE EXCEPTION 'CRM_FORBIDDEN';
  END IF;
  IF NOT COALESCE((public.crm_v2_capabilities()->>'enabled')::boolean,false) THEN
    RAISE EXCEPTION 'CRM_SETUP_REQUIRED';
  END IF;
  IF p_page IS NULL OR p_page<0 OR p_page>100000 OR p_page_size IS DISTINCT FROM 50 THEN
    RAISE EXCEPTION 'CRM_INVALID_INPUT';
  END IF;
  WITH page_rows AS (
    SELECT c.* FROM public.sales_customers c WHERE c.merged_into_customer_id IS NULL
    ORDER BY c.created_at DESC,c.id LIMIT 51 OFFSET p_page*50
  ), visible_rows AS (
    SELECT * FROM page_rows ORDER BY created_at DESC,id LIMIT 50
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',c.id,'name',c.customer_name,'phone',c.phone,'channel',c.intake_channel,
    'notes',c.intake_notes,'ownerUserId',c.owner_user_id,'leadCreatedAt',c.lead_created_at,
    'intakeStatus',c.intake_status,'interests',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id',i.id,'projectName',i.project_name,'ownerUserId',i.owner_user_id,
      'workspaceState',i.workspace_state,'engagementStatus',i.engagement_status,'plotId',i.interested_plot_id
    ) ORDER BY i.interest_created_at,i.id) FROM public.lead_project_interests i WHERE i.customer_id=c.id),'[]'::jsonb)
  ) ORDER BY c.created_at DESC,c.id),'[]'::jsonb),
    (SELECT count(*)>50 FROM page_rows)
  INTO customers_json,more_rows FROM visible_rows c;
  RETURN jsonb_build_object(
    'actor',jsonb_build_object('userId',actor_id,'role',actor_role),
    'projects',COALESCE((SELECT jsonb_agg(jsonb_build_object('name',name) ORDER BY name)
      FROM public.projects WHERE is_closed IS NOT TRUE),'[]'::jsonb),
    'salesOwners',COALESCE((SELECT jsonb_agg(jsonb_build_object('userId',user_id,
      'displayName',COALESCE(NULLIF(btrim(display_name),''),user_id::text)) ORDER BY display_name,user_id)
      FROM sales_private.crm_user_roles WHERE is_active AND role='sales'),'[]'::jsonb),
    'customers',customers_json,'page',p_page,'hasMore',more_rows);
END;
$snapshot$;
REVOKE ALL ON FUNCTION public.crm_v2_central_snapshot(integer,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_v2_central_snapshot(integer,integer) TO authenticated;

CREATE FUNCTION public.crm_v2_create_customer(p_request_id uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $create_customer$
DECLARE
  actor_id uuid := auth.uid();
  actor_role text := public.crm_v2_role();
  owner_id uuid;
  actor_name text;
  saved_request sales_private.central_command_requests%ROWTYPE;
  normalized_phone text;
  new_customer_id uuid;
  new_interest_id uuid;
  interested_project text;
  chosen_plot text;
  interest jsonb;
  result jsonb;
  intake_at timestamptz := now();
  first_contact_hours integer;
BEGIN
  IF actor_id IS NULL OR actor_role NOT IN ('sales','admin') THEN RAISE EXCEPTION 'CRM_FORBIDDEN'; END IF;
  IF NOT COALESCE((public.crm_v2_capabilities()->>'enabled')::boolean,false) THEN
    RAISE EXCEPTION 'CRM_SETUP_REQUIRED';
  END IF;
  IF p_request_id IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object'
    OR octet_length(p_payload::text)>16384 THEN RAISE EXCEPTION 'CRM_INVALID_INPUT'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN
      ('name','phone','channel','notes','interests','assignedSalesUserId'))
    OR jsonb_typeof(p_payload->'name') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_payload->'phone') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_payload->'channel') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_payload->'notes') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_payload->'interests') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'CRM_INVALID_INPUT';
  END IF;
  IF length(btrim(p_payload->>'name')) NOT BETWEEN 1 AND 200
    OR length(p_payload->>'phone')>32 OR (p_payload->>'phone') !~ '^\+?[0-9 ()-]+$'
    OR length(regexp_replace(p_payload->>'phone','[^0-9]','','g')) NOT BETWEEN 7 AND 15
    OR length(btrim(p_payload->>'channel')) NOT BETWEEN 1 AND 80
    OR length(p_payload->>'notes')>4000 OR jsonb_array_length(p_payload->'interests')>20 THEN
    RAISE EXCEPTION 'CRM_INVALID_INPUT';
  END IF;
  IF actor_role='sales' THEN
    IF p_payload ? 'assignedSalesUserId' THEN RAISE EXCEPTION 'CRM_FORBIDDEN'; END IF;
    owner_id := actor_id;
  ELSE
    IF jsonb_typeof(p_payload->'assignedSalesUserId') IS DISTINCT FROM 'string'
      OR (p_payload->>'assignedSalesUserId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'CRM_SALES_OWNER_REQUIRED';
    END IF;
    owner_id := (p_payload->>'assignedSalesUserId')::uuid;
  END IF;
  PERFORM 1 FROM sales_private.crm_user_roles WHERE user_id=owner_id AND is_active AND role='sales' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CRM_SALES_OWNER_REQUIRED'; END IF;

  -- Serialize retries of the same authenticated actor+command, then compare the
  -- complete JSON payload (not a weak hash); no duplicate rows on retry.
  PERFORM pg_advisory_xact_lock(hashtextextended('central-request:'||actor_id::text||':'||p_request_id::text,0));
  SELECT * INTO saved_request FROM sales_private.central_command_requests
    WHERE actor_user_id=actor_id AND request_id=p_request_id;
  IF FOUND THEN
    IF saved_request.request_payload IS DISTINCT FROM p_payload THEN RAISE EXCEPTION 'CRM_IDEMPOTENCY_CONFLICT'; END IF;
    RETURN saved_request.response || jsonb_build_object('replayed',true);
  END IF;

  normalized_phone := public.crm_v2_normalize_phone(p_payload->>'phone');
  PERFORM pg_advisory_xact_lock(hashtextextended('central-phone:'||normalized_phone,0));
  IF EXISTS (SELECT 1 FROM public.sales_customers WHERE phone_normalized=normalized_phone)
    OR EXISTS (SELECT 1 FROM public.leads l WHERE public.crm_v2_normalize_phone(l.phone)=normalized_phone
      AND NOT EXISTS (SELECT 1 FROM public.crm_legacy_lead_links k WHERE k.legacy_lead_id=l.id)) THEN
    -- Never merge by phone or silently create a second owner of legacy data.
    RAISE EXCEPTION 'CRM_DUPLICATE_REVIEW_REQUIRED';
  END IF;
  -- Mapped legacy rows use canonical customer phones; raw historical placeholders
  -- are retained for audit, not duplicate matching. Unmigrated legacy rows still
  -- block an exact phone match until reviewed. Writer cutover remains mandatory.
  IF (SELECT count(*) FROM jsonb_array_elements(p_payload->'interests')) <>
    (SELECT count(DISTINCT btrim(value->>'projectName')) FROM jsonb_array_elements(p_payload->'interests')) THEN
    RAISE EXCEPTION 'CRM_INVALID_INPUT';
  END IF;
  FOR interest IN SELECT value FROM jsonb_array_elements(p_payload->'interests') LOOP
    IF jsonb_typeof(interest) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'CRM_INVALID_INPUT'; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(interest) k WHERE k NOT IN ('projectName','plotId'))
      OR jsonb_typeof(interest->'projectName') IS DISTINCT FROM 'string'
      OR length(btrim(interest->>'projectName')) NOT BETWEEN 1 AND 200
      OR NOT (interest ? 'plotId') OR jsonb_typeof(interest->'plotId') NOT IN ('string','null') THEN
      RAISE EXCEPTION 'CRM_INVALID_INPUT';
    END IF;
    interested_project := btrim(interest->>'projectName');
    chosen_plot := interest->>'plotId';
    IF chosen_plot IS NOT NULL AND (length(chosen_plot) NOT BETWEEN 1 AND 255 OR btrim(chosen_plot)='') THEN
      RAISE EXCEPTION 'CRM_INVALID_INPUT';
    END IF;
    PERFORM 1 FROM public.projects WHERE name=interested_project AND is_closed IS NOT TRUE FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'CRM_INVALID_INPUT'; END IF;
    IF chosen_plot IS NOT NULL THEN
      PERFORM 1 FROM public.plots p WHERE p.id=chosen_plot AND p.project_name=interested_project
        AND p.has_customer IS FALSE AND lower(btrim(COALESCE(p.sale_status,'')))
          IN ('','active','normal','ready_for_sale','available','vacant') FOR SHARE;
      IF NOT FOUND OR EXISTS (SELECT 1 FROM public.sales s WHERE s.plot_id=chosen_plot
        AND lower(btrim(COALESCE(s.crm_stage,s.contract_status,'')))<>'cancelled') THEN
        RAISE EXCEPTION 'CRM_PLOT_UNAVAILABLE';
      END IF;
    END IF;
  END LOOP;

  SELECT COALESCE(NULLIF(btrim(display_name),''),actor_id::text) INTO actor_name
    FROM sales_private.crm_user_roles WHERE user_id=actor_id;
  INSERT INTO public.sales_customers(customer_name,phone,intake_channel,intake_notes,
    owner_user_id,created_by_user_id,owner_assigned_at,lead_created_at)
  VALUES (btrim(p_payload->>'name'),btrim(p_payload->>'phone'),btrim(p_payload->>'channel'),p_payload->>'notes',
    owner_id,actor_id,intake_at,intake_at) RETURNING id INTO new_customer_id;
  INSERT INTO public.crm_audit_events(customer_id,entity_type,entity_id,event_type,reason_text,
    actor_user_id,actor_kind,actor_name_snapshot,new_values,occurred_at)
  VALUES (new_customer_id,'customer',new_customer_id,'created','รับ Lead ใหม่',actor_id,'staff',actor_name,
    jsonb_build_object('ownerUserId',owner_id,'intakeStatus','new'),intake_at);
  FOR interest IN SELECT value FROM jsonb_array_elements(p_payload->'interests') LOOP
    INSERT INTO public.lead_project_interests(customer_id,project_name,owner_user_id,
      interested_plot_id,created_by_user_id,owner_assigned_at,interest_created_at)
    VALUES (new_customer_id,btrim(interest->>'projectName'),owner_id,interest->>'plotId',actor_id,intake_at,intake_at)
    RETURNING id INTO new_interest_id;
    INSERT INTO public.crm_audit_events(customer_id,entity_type,entity_id,event_type,reason_text,
      actor_user_id,actor_kind,actor_name_snapshot,new_values,occurred_at)
    VALUES (new_customer_id,'interest',new_interest_id,'created','บันทึกโครงการที่ลูกค้าสนใจ',actor_id,'staff',actor_name,
      jsonb_build_object('projectName',btrim(interest->>'projectName'),'ownerUserId',owner_id,'workspaceState','central_interest'),intake_at);
  END LOOP;
  SELECT COALESCE((SELECT initial_contact_hours FROM public.crm_settings WHERE id),24) INTO first_contact_hours;
  INSERT INTO public.crm_sla_tasks(customer_id,owner_user_id,task_type,obligation_started_at,service_due_at,
    accountability_state,evaluation_snapshot)
  VALUES (new_customer_id,owner_id,'first_contact',intake_at,intake_at+make_interval(hours=>first_contact_hours),
    'needs_schedule',jsonb_build_object('initialContactHours',first_contact_hours,'clock','elapsed','staffDueKnown',false));
  result := jsonb_build_object('customerId',new_customer_id,'replayed',false);
  INSERT INTO sales_private.central_command_requests(actor_user_id,request_id,request_payload,response)
    VALUES (actor_id,p_request_id,p_payload,result);
  RETURN result;
END;
$create_customer$;
REVOKE ALL ON FUNCTION public.crm_v2_create_customer(uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_v2_create_customer(uuid,jsonb) TO authenticated;
-- No inserts into legacy leads/sales/plots, no automatic owner merge, no QR/booking
-- cutover here. Legacy writer retirement is required before enabling this contract.

-- Deployment gates, NOT completed by this draft:
--   API/RPC write authorization + immutable history + lifecycle transition rules;
--   customer duplicate merge locking and Admin verification;
--   price/stock locking against actual live key types and existing sales triggers;
--   questionnaire validation and token rate-limits;
--   calendar-aware SLA calculation, snapshots and in-app notification worker;
--   staging backfill rehearsal and legacy read/write policy cutover;
--   legacy money defaults/required fields/cascading deletes and unknown dates;
--   PostgreSQL integration tests of the acceptance scenarios in the design document.
-- This draft makes no changes unless executed (which the guard prevents). Local
-- app code is prepared separately; environment and production data stay unchanged.

-- Reviewed source: sql/security/crm_role_alignment_draft.sql
-- LF-normalized SHA256: e51c02ac57a0489124e9292afceac77de5fa7b0a25251c95b6f787cbc80dfaa3
-- DESIGN / ISOLATED TEST ONLY. No production migration, staff auto-import or flags.
-- Keep CRM's row shape/locks/history. Its permission fields become a projection
-- of reviewed_roles, synchronized in the same transaction, never a second source.


DO $preflight$
DECLARE v_signature regprocedure:=to_regprocedure('public.crm_v2_role()');
BEGIN
  IF to_regclass('sales_private.crm_user_roles') IS NULL
    OR to_regprocedure('account_security_private.assert_crm_review_ready()') IS NULL
    OR to_regprocedure('account_security_private.current_actor()') IS NULL
    OR v_signature IS NULL THEN RAISE EXCEPTION 'CRM_ROLE_ALIGNMENT_PREREQUISITES_REQUIRED'; END IF;
  IF to_regprocedure('account_security_private.sync_crm_reviewed_role()') IS NOT NULL
    OR EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='sales_private.crm_user_roles'::regclass
      AND attname='trusted_review_revision' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'CRM_ROLE_ALIGNMENT_ALREADY_EXISTS';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE oid IN ('sales_private.crm_user_roles'::regclass,
      'account_security_private.reviewed_roles'::regclass)
      AND (relkind<>'r' OR pg_get_userbyid(relowner)<>current_user))
    OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=v_signature AND prorettype='text'::regtype
      AND pg_get_userbyid(proowner)=current_user AND pronargs=0)
    OR (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='crm_v2_role')<>1
    OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='sales_private.crm_user_roles'::regclass AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'CRM_ROLE_ALIGNMENT_UNREVIEWED_OBJECT';
  END IF;
  IF (SELECT array_agg(attname::text ORDER BY attnum) FROM pg_attribute
      WHERE attrelid='sales_private.crm_user_roles'::regclass AND attnum>0 AND NOT attisdropped)
      IS DISTINCT FROM ARRAY['user_id','role','display_name','is_active'] THEN
    RAISE EXCEPTION 'CRM_ROLE_ALIGNMENT_UNREVIEWED_COLUMNS';
  END IF;
END;
$preflight$;

ALTER TABLE sales_private.crm_user_roles ADD COLUMN trusted_review_revision bigint CHECK (trusted_review_revision>0);
-- Quarantine old permissions, retain every name/ID for historical readers. No role
-- copied into the trusted registry. An explicit new reviewed decision re-enables.
UPDATE sales_private.crm_user_roles SET is_active=false;
ALTER TABLE sales_private.crm_user_roles ALTER COLUMN is_active SET DEFAULT false;
REVOKE ALL ON sales_private.crm_user_roles FROM PUBLIC,anon,authenticated;

CREATE FUNCTION account_security_private.guard_crm_role_projection()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $guard$
BEGIN
  IF TG_OP IN ('DELETE','TRUNCATE') THEN RAISE EXCEPTION 'CRM_ROLE_HISTORY_PRESERVED'; END IF;
  IF TG_OP='UPDATE' AND NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'CRM_ROLE_IDENTITY_IMMUTABLE';
  END IF;
  IF NEW.is_active AND NOT EXISTS (
    SELECT 1 FROM account_security_private.reviewed_roles r
    WHERE r.auth_user_id=NEW.user_id AND r.enabled AND r.role IN ('Admin','Owner','Sales')
      AND lower(r.role)=NEW.role AND r.review_revision=NEW.trusted_review_revision
      AND r.review_revision>0
  ) THEN RAISE EXCEPTION 'CRM_ROLE_TRUSTED_REVIEW_REQUIRED'; END IF;
  RETURN NEW;
END;
$guard$;
REVOKE ALL ON FUNCTION account_security_private.guard_crm_role_projection() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER crm_role_projection_guard BEFORE INSERT OR UPDATE OR DELETE ON sales_private.crm_user_roles
FOR EACH ROW EXECUTE FUNCTION account_security_private.guard_crm_role_projection();
CREATE TRIGGER crm_role_projection_no_truncate BEFORE TRUNCATE ON sales_private.crm_user_roles
FOR EACH STATEMENT EXECUTE FUNCTION account_security_private.guard_crm_role_projection();

CREATE FUNCTION account_security_private.sync_crm_reviewed_role()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $sync$
BEGIN
  IF TG_OP='UPDATE' AND (NEW.auth_user_id IS DISTINCT FROM OLD.auth_user_id
    OR NEW.legacy_user_id IS DISTINCT FROM OLD.legacy_user_id) THEN
    RAISE EXCEPTION 'CRM_ROLE_IDENTITY_IMMUTABLE';
  END IF;
  IF TG_OP='DELETE' THEN
    UPDATE sales_private.crm_user_roles SET is_active=false,trusted_review_revision=NULL
      WHERE user_id=OLD.auth_user_id;
    RETURN OLD;
  END IF;
  IF NEW.role IN ('Admin','Owner','Sales') AND NEW.review_revision>0 THEN
    INSERT INTO sales_private.crm_user_roles(user_id,role,display_name,is_active,trusted_review_revision)
    SELECT NEW.auth_user_id,lower(NEW.role),u.username,NEW.enabled,NEW.review_revision
      FROM public.users u WHERE u.id=NEW.legacy_user_id
    ON CONFLICT(user_id) DO UPDATE SET role=EXCLUDED.role,is_active=EXCLUDED.is_active,
      trusted_review_revision=EXCLUDED.trusted_review_revision;
    -- Existing display names (including TAEW/PIEW aliases) are never rewritten.
  ELSE
    UPDATE sales_private.crm_user_roles SET is_active=false,
      trusted_review_revision=CASE WHEN NEW.review_revision>0 THEN NEW.review_revision ELSE NULL END
      WHERE user_id=NEW.auth_user_id;
  END IF;
  RETURN NEW;
END;
$sync$;
REVOKE ALL ON FUNCTION account_security_private.sync_crm_reviewed_role() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER reviewed_role_crm_projection AFTER INSERT OR UPDATE OR DELETE
ON account_security_private.reviewed_roles FOR EACH ROW
EXECUTE FUNCTION account_security_private.sync_crm_reviewed_role();

CREATE FUNCTION account_security_private.current_crm_role()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $role$
DECLARE v_actor jsonb; v_role text; v_uid uuid; v_session uuid;
BEGIN
  -- PostgREST uses READ ONLY for GET/HEAD and even POST to STABLE RPCs.
  -- Those reads must verify the same identity/membership without row locks.
  -- A caller cannot exploit this branch to write: PostgreSQL enforces READ ONLY.
  IF current_setting('transaction_read_only')='on' THEN
    v_uid:=auth.uid();
    IF v_uid IS NULL THEN RETURN ''; END IF;
    BEGIN v_session:=NULLIF(auth.jwt()->>'session_id','')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN RETURN ''; END;
    SELECT c.role INTO v_role FROM sales_private.crm_user_roles c
      JOIN account_security_private.reviewed_roles r ON r.auth_user_id=c.user_id
      JOIN auth.users u ON u.id=r.auth_user_id
      JOIN auth.sessions s ON s.user_id=u.id AND s.id=v_session
      JOIN public.users p ON p.id=r.legacy_user_id
      WHERE c.user_id=v_uid AND c.is_active AND r.enabled
        AND r.role IN ('Admin','Owner','Sales') AND c.role=lower(r.role)
        AND c.trusted_review_revision=r.review_revision AND r.review_revision>0
        AND u.deleted_at IS NULL AND NOT COALESCE(u.is_anonymous,false)
        AND (u.banned_until IS NULL OR u.banned_until<=statement_timestamp())
        AND (s.not_after IS NULL OR s.not_after>statement_timestamp());
    RETURN COALESCE(v_role,'');
  END IF;
  -- Validate Auth/session and lock canonical membership before CRM projection.
  BEGIN v_actor:=account_security_private.current_actor();
  EXCEPTION WHEN insufficient_privilege THEN RETURN ''; END;
  IF v_actor->>'role' NOT IN ('Admin','Owner','Sales') THEN RETURN ''; END IF;
  SELECT c.role INTO v_role FROM sales_private.crm_user_roles c
    JOIN account_security_private.reviewed_roles r ON r.auth_user_id=c.user_id
    WHERE c.user_id=auth.uid() AND c.is_active AND r.enabled
      AND c.role=lower(r.role) AND c.trusted_review_revision=r.review_revision
      AND r.review_revision>0 FOR SHARE OF c;
  RETURN COALESCE(v_role,'');
END;
$role$;
REVOKE ALL ON FUNCTION account_security_private.current_crm_role() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION account_security_private.current_crm_role() TO authenticated;
CREATE OR REPLACE FUNCTION public.crm_v2_role()
RETURNS text LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = ''
AS $$ SELECT account_security_private.current_crm_role(); $$;
REVOKE ALL ON FUNCTION public.crm_v2_role() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_v2_role() TO authenticated;

CREATE OR REPLACE FUNCTION account_security_private.assert_crm_review_ready()
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
    WHERE tgrelid='account_security_private.reviewed_roles'::regclass
      AND tgname='reviewed_role_crm_projection' AND tgenabled IN ('O','A')
      AND tgfoid='account_security_private.sync_crm_reviewed_role()'::regprocedure)
    OR (SELECT count(*) FROM pg_trigger WHERE tgrelid='sales_private.crm_user_roles'::regclass
      AND tgname IN ('crm_role_projection_guard','crm_role_projection_no_truncate')
      AND tgenabled IN ('O','A') AND tgfoid='account_security_private.guard_crm_role_projection()'::regprocedure)<>2
    THEN RAISE EXCEPTION 'ROLE_REVIEW_CRM_ALIGNMENT_REQUIRED'; END IF;
END; $$;
REVOKE ALL ON FUNCTION account_security_private.assert_crm_review_ready() FROM PUBLIC,anon,authenticated;

DO $acl$
DECLARE v_role text; v_column record;
BEGIN
  -- Column grants are additive to table ACLs. Close both, including inherited grants.
  FOR v_column IN SELECT attname FROM pg_attribute WHERE attrelid='sales_private.crm_user_roles'::regclass
    AND attnum>0 AND NOT attisdropped LOOP
    EXECUTE format('REVOKE ALL (%I) ON sales_private.crm_user_roles FROM PUBLIC,anon,authenticated',v_column.attname);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    REVOKE ALL ON sales_private.crm_user_roles FROM service_role;
    REVOKE ALL ON FUNCTION public.crm_v2_role(),account_security_private.current_crm_role(),
      account_security_private.guard_crm_role_projection(),account_security_private.sync_crm_reviewed_role(),
      account_security_private.assert_crm_review_ready() FROM service_role;
    FOR v_column IN SELECT attname FROM pg_attribute WHERE attrelid='sales_private.crm_user_roles'::regclass
      AND attnum>0 AND NOT attisdropped LOOP
      EXECUTE format('REVOKE ALL (%I) ON sales_private.crm_user_roles FROM service_role',v_column.attname);
    END LOOP;
  END IF;
  FOR v_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role') LOOP
    IF has_table_privilege(v_role,'sales_private.crm_user_roles','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
      OR has_any_column_privilege(v_role,'sales_private.crm_user_roles','SELECT,INSERT,UPDATE,REFERENCES') THEN
      RAISE EXCEPTION 'CRM_ROLE_ALIGNMENT_UNEXPECTED_GRANT';
    END IF;
  END LOOP;
END;
$acl$;

-- Reviewed source: sql/security/crm_auth_revocation_draft.sql
-- LF-normalized SHA256: 914ac98217a387cb7484423940f237d28abd76f345d7f98253f4343490133f3f
-- DESIGN / ISOLATED TEST ONLY. Requires reviewed account/CRM alignment (3b).
-- Proposed Auth UPDATE trigger needs an isolated Supabase Auth compatibility
-- test and approved write freeze before any migration. NEVER run as-is.
-- Only suspends CRM permissions. Never edits Auth, canonical roles, customer
-- ownership, event dates, sessions or business history. No automatic restoration.


DO $preflight$
BEGIN
  IF to_regprocedure('account_security_private.sync_crm_reviewed_role()') IS NULL
    OR to_regprocedure('account_security_private.guard_crm_role_projection()') IS NULL
    OR to_regprocedure('account_security_private.assert_crm_review_ready()') IS NULL
    OR to_regclass('auth.users') IS NULL THEN
    RAISE EXCEPTION 'CRM_AUTH_REVOCATION_PREREQUISITES_REQUIRED';
  END IF;
  IF to_regclass('account_security_private.crm_auth_suspensions') IS NOT NULL
    OR EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='account_security_private'::regnamespace
      AND proname IN ('suspend_crm_on_auth_change','guard_crm_auth_suspension_history'))
    OR EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='auth.users'::regclass AND tgname='buildtrack_crm_auth_revocation') THEN
    RAISE EXCEPTION 'CRM_AUTH_REVOCATION_ALREADY_EXISTS';
  END IF;
  IF EXISTS(SELECT 1 FROM (VALUES ('id','uuid'::regtype),('banned_until','timestamptz'::regtype),
      ('deleted_at','timestamptz'::regtype),('is_anonymous','boolean'::regtype)) expected(column_name,column_type)
      WHERE NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='auth.users'::regclass
        AND attname=expected.column_name AND atttypid=expected.column_type AND attnum>0 AND NOT attisdropped))
    OR NOT has_table_privilege(current_user,'auth.users','SELECT')
    OR NOT has_table_privilege(current_user,'auth.users','TRIGGER')
    OR EXISTS(SELECT 1 FROM pg_class WHERE oid IN ('sales_private.crm_user_roles'::regclass,
      'account_security_private.reviewed_roles'::regclass) AND (relkind<>'r' OR pg_get_userbyid(relowner)<>current_user))
    OR EXISTS(SELECT 1 FROM pg_proc WHERE oid IN ('account_security_private.guard_crm_role_projection()'::regprocedure,
      'account_security_private.assert_crm_review_ready()'::regprocedure) AND pg_get_userbyid(proowner)<>current_user) THEN
    RAISE EXCEPTION 'CRM_AUTH_REVOCATION_UNREVIEWED_OBJECT';
  END IF;
  PERFORM account_security_private.assert_crm_review_ready();
END;
$preflight$;

-- One suspension per reviewed revision; repeating a ban cannot erase evidence.
-- No email, phone, names, tokens or Auth metadata, and no cascading history FK.
CREATE TABLE account_security_private.crm_auth_suspensions (
  auth_user_id uuid NOT NULL,
  review_revision bigint NOT NULL CHECK(review_revision>=0),
  reason text NOT NULL CHECK(reason IN ('auth_banned','auth_deleted','auth_anonymous')),
  observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(auth_user_id,review_revision)
);
ALTER TABLE account_security_private.crm_auth_suspensions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON account_security_private.crm_auth_suspensions FROM PUBLIC,anon,authenticated;
CREATE FUNCTION account_security_private.guard_crm_auth_suspension_history()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $$ BEGIN RAISE EXCEPTION 'CRM_AUTH_SUSPENSION_APPEND_ONLY'; END; $$;
REVOKE ALL ON FUNCTION account_security_private.guard_crm_auth_suspension_history() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER crm_auth_suspension_history BEFORE UPDATE OR DELETE OR TRUNCATE
ON account_security_private.crm_auth_suspensions FOR EACH STATEMENT
EXECUTE FUNCTION account_security_private.guard_crm_auth_suspension_history();

CREATE FUNCTION account_security_private.suspend_crm_on_auth_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $suspend$
DECLARE v_reason text;
BEGIN
  IF TG_TABLE_SCHEMA<>'auth' OR TG_TABLE_NAME<>'users' OR TG_OP<>'UPDATE' OR TG_WHEN<>'AFTER' THEN
    RAISE EXCEPTION 'CRM_AUTH_REVOCATION_INVALID_TRIGGER';
  END IF;
  v_reason:=CASE WHEN NEW.deleted_at IS NOT NULL THEN 'auth_deleted'
    WHEN COALESCE(NEW.is_anonymous,false) THEN 'auth_anonymous'
    WHEN NEW.banned_until>statement_timestamp() THEN 'auth_banned' ELSE NULL END;
  IF v_reason IS NOT NULL THEN
    -- Auth already holds its row. Do NOT lock/update canonical membership here:
    -- operator review locks canonical -> Auth -> projection, so the reverse
    -- order would deadlock. The plain read observes the latest committed review;
    -- enabling review itself must lock/check Auth before changing the projection.
    INSERT INTO account_security_private.crm_auth_suspensions(auth_user_id,review_revision,reason)
    SELECT r.auth_user_id,r.review_revision,v_reason FROM account_security_private.reviewed_roles r
      WHERE r.auth_user_id=NEW.id
    ON CONFLICT(auth_user_id,review_revision) DO NOTHING;
    UPDATE sales_private.crm_user_roles SET is_active=false WHERE user_id=NEW.id AND is_active;
  END IF;
  -- Clearing/expiring a ban alone never reactivates CRM, nor alters a review.
  RETURN NEW;
END;
$suspend$;
REVOKE ALL ON FUNCTION account_security_private.suspend_crm_on_auth_change() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER buildtrack_crm_auth_revocation AFTER UPDATE ON auth.users FOR EACH ROW
WHEN (NEW.deleted_at IS NOT NULL OR COALESCE(NEW.is_anonymous,false) OR NEW.banned_until>statement_timestamp())
EXECUTE FUNCTION account_security_private.suspend_crm_on_auth_change();

-- Quarantine pre-existing unavailable identities while writes are frozen. Never
-- infer that an expired ban without recorded history was previously suspended.
INSERT INTO account_security_private.crm_auth_suspensions(auth_user_id,review_revision,reason)
SELECT r.auth_user_id,r.review_revision,CASE WHEN u.deleted_at IS NOT NULL THEN 'auth_deleted'
  WHEN COALESCE(u.is_anonymous,false) THEN 'auth_anonymous' ELSE 'auth_banned' END
FROM account_security_private.reviewed_roles r JOIN auth.users u ON u.id=r.auth_user_id
WHERE u.deleted_at IS NOT NULL OR COALESCE(u.is_anonymous,false) OR u.banned_until>statement_timestamp();
UPDATE sales_private.crm_user_roles c SET is_active=false
WHERE c.is_active AND EXISTS(SELECT 1 FROM auth.users u WHERE u.id=c.user_id
  AND (u.deleted_at IS NOT NULL OR COALESCE(u.is_anonymous,false) OR u.banned_until>statement_timestamp()));

-- Retain the projection's table, row type, aliases, IDs and existing lock order.
-- A fresh reviewed revision (not merely is_active=true) is required to restore.
CREATE OR REPLACE FUNCTION account_security_private.guard_crm_role_projection()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $guard$
BEGIN
  IF TG_OP IN ('DELETE','TRUNCATE') THEN RAISE EXCEPTION 'CRM_ROLE_HISTORY_PRESERVED'; END IF;
  IF TG_OP='UPDATE' AND NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'CRM_ROLE_IDENTITY_IMMUTABLE';
  END IF;
  IF NEW.is_active AND NOT EXISTS(
    SELECT 1 FROM account_security_private.reviewed_roles r JOIN auth.users u ON u.id=r.auth_user_id
    WHERE r.auth_user_id=NEW.user_id AND r.enabled AND r.role IN ('Admin','Owner','Sales')
      AND lower(r.role)=NEW.role AND r.review_revision=NEW.trusted_review_revision AND r.review_revision>0
      AND u.deleted_at IS NULL AND NOT COALESCE(u.is_anonymous,false)
      AND (u.banned_until IS NULL OR u.banned_until<=statement_timestamp())
      AND NOT EXISTS(SELECT 1 FROM account_security_private.crm_auth_suspensions s
        WHERE s.auth_user_id=r.auth_user_id AND s.review_revision>=r.review_revision)
  ) THEN RAISE EXCEPTION 'CRM_ROLE_TRUSTED_REVIEW_REQUIRED'; END IF;
  RETURN NEW;
END;
$guard$;
REVOKE ALL ON FUNCTION account_security_private.guard_crm_role_projection() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION account_security_private.assert_crm_review_ready()
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='account_security_private.reviewed_roles'::regclass
    AND tgname='reviewed_role_crm_projection' AND tgenabled IN ('O','A')
    AND tgfoid='account_security_private.sync_crm_reviewed_role()'::regprocedure)
    OR (SELECT count(*) FROM pg_trigger WHERE tgrelid='sales_private.crm_user_roles'::regclass
      AND tgname IN ('crm_role_projection_guard','crm_role_projection_no_truncate') AND tgenabled IN ('O','A')
      AND tgfoid='account_security_private.guard_crm_role_projection()'::regprocedure)<>2
    OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='auth.users'::regclass
      AND tgname='buildtrack_crm_auth_revocation' AND tgenabled IN ('O','A')
      AND tgfoid='account_security_private.suspend_crm_on_auth_change()'::regprocedure)
    OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='account_security_private.crm_auth_suspensions'::regclass
      AND tgname='crm_auth_suspension_history' AND tgenabled IN ('O','A')
      AND tgfoid='account_security_private.guard_crm_auth_suspension_history()'::regprocedure)
    THEN RAISE EXCEPTION 'ROLE_REVIEW_CRM_AUTH_ALIGNMENT_REQUIRED'; END IF;
END; $$;
REVOKE ALL ON FUNCTION account_security_private.assert_crm_review_ready() FROM PUBLIC,anon,authenticated;

DO $acl$
DECLARE v_role text;
BEGIN
  FOR v_role IN SELECT rolname FROM pg_roles WHERE rolname IN
    ('anon','authenticated','service_role','supabase_auth_admin','buildtrack_sales_sla_worker','buildtrack_sales_sla_dispatcher') LOOP
    EXECUTE format('REVOKE ALL ON account_security_private.crm_auth_suspensions FROM %I',v_role);
    EXECUTE format('REVOKE ALL ON FUNCTION account_security_private.suspend_crm_on_auth_change(),account_security_private.guard_crm_auth_suspension_history() FROM %I',v_role);
    IF has_table_privilege(v_role,'account_security_private.crm_auth_suspensions','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
      OR has_any_column_privilege(v_role,'account_security_private.crm_auth_suspensions','SELECT,INSERT,UPDATE,REFERENCES')
      OR has_function_privilege(v_role,'account_security_private.suspend_crm_on_auth_change()','EXECUTE') THEN
      RAISE EXCEPTION 'CRM_AUTH_REVOCATION_UNEXPECTED_GRANT';
    END IF;
  END LOOP;
END;
$acl$;

-- Reviewed source: sql/security/account_access_read_draft.sql
-- LF-normalized SHA256: beedd99fb1c0818b2426e403ecbd9f72a37c00075e8265ed3a4737d77bba1847
-- DESIGN / ISOLATED TEST ONLY. Read-only Admin screen, no account command.


DO $preflight$
BEGIN
  IF to_regclass('account_security_private.crm_auth_suspensions') IS NULL
    OR to_regclass('account_security_private.reviewed_admins') IS NULL
    OR to_regprocedure('account_security_private.assert_crm_review_ready()') IS NULL THEN
    RAISE EXCEPTION 'ACCOUNT_ACCESS_PREREQUISITES_REQUIRED';
  END IF;
  PERFORM account_security_private.assert_crm_review_ready();
  IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE (n.nspname='account_security_private' AND p.proname='read_sales_account_access')
      OR (n.nspname='public' AND p.proname='app_sales_account_access')) THEN
    RAISE EXCEPTION 'ACCOUNT_ACCESS_ALREADY_EXISTS';
  END IF;
END;
$preflight$;

CREATE FUNCTION account_security_private.read_sales_account_access(p_page integer, p_query text, p_status text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $reader$
DECLARE v_uid uuid:=auth.uid(); v_session uuid; v_result jsonb;
BEGIN
  -- Independent authorization for direct RPC callers. No user/app metadata roles.
  BEGIN v_session:=NULLIF(auth.jwt()->>'session_id','')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='ACCOUNT_ACCESS_FORBIDDEN';
  END;
  IF v_uid IS NULL OR v_session IS NULL OR NOT EXISTS(
    SELECT 1 FROM account_security_private.reviewed_roles r
    JOIN account_security_private.reviewed_admins a ON a.auth_user_id=r.auth_user_id AND a.legacy_user_id=r.legacy_user_id
    JOIN auth.users u ON u.id=r.auth_user_id
    JOIN auth.sessions s ON s.user_id=u.id AND s.id=v_session
    JOIN public.users p ON p.id=r.legacy_user_id
    WHERE r.auth_user_id=v_uid AND r.role='Admin' AND r.enabled AND a.enabled
      AND u.deleted_at IS NULL AND NOT COALESCE(u.is_anonymous,false)
      AND (u.banned_until IS NULL OR u.banned_until<=statement_timestamp())
      AND (s.not_after IS NULL OR s.not_after>statement_timestamp())
  ) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='ACCOUNT_ACCESS_FORBIDDEN'; END IF;
  IF p_page IS NULL OR p_page NOT BETWEEN 0 AND 10000 OR p_query IS NULL OR length(p_query)>80
    OR p_status IS NULL OR p_status NOT IN ('all','active','awaiting_review','auth_unavailable','disabled','review_required')
    THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='ACCOUNT_ACCESS_INVALID_INPUT'; END IF;

  -- All decisions in this STABLE, lock-free reader use one statement snapshot.
  -- A concurrent revocation may finish after the read began; no returned field
  -- grants authority to mutate an account. Safe inside BEGIN READ ONLY.
  WITH source AS (
    SELECT r.auth_user_id,r.review_revision,r.reviewed_at,r.enabled,p.username,
      c.is_active,c.role AS crm_role,c.trusted_review_revision,
      CASE WHEN u.id IS NULL THEN 'missing' WHEN u.deleted_at IS NOT NULL THEN 'deleted'
        WHEN COALESCE(u.is_anonymous,false) THEN 'anonymous'
        WHEN u.banned_until>statement_timestamp() THEN 'banned' ELSE 'available' END AS auth_status,
      h.review_revision AS suspension_revision,h.reason,h.observed_at
    FROM account_security_private.reviewed_roles r JOIN public.users p ON p.id=r.legacy_user_id
    LEFT JOIN auth.users u ON u.id=r.auth_user_id
    LEFT JOIN sales_private.crm_user_roles c ON c.user_id=r.auth_user_id
    LEFT JOIN LATERAL (SELECT s.review_revision,s.reason,s.observed_at
      FROM account_security_private.crm_auth_suspensions s WHERE s.auth_user_id=r.auth_user_id
      ORDER BY s.review_revision DESC LIMIT 1) h ON true
    WHERE r.role='Sales' AND strpos(lower(p.username),lower(btrim(p_query)))>0
  ), classified AS (
    SELECT *,CASE WHEN auth_status<>'available' THEN 'auth_unavailable'
      WHEN NOT enabled THEN 'disabled'
      WHEN review_revision>0 AND is_active AND crm_role='sales' AND trusted_review_revision=review_revision
        AND (suspension_revision IS NULL OR suspension_revision<review_revision) THEN 'active'
      WHEN NOT COALESCE(is_active,false) AND suspension_revision>=review_revision THEN 'awaiting_review'
      ELSE 'review_required' END AS status
    FROM source
  ), filtered AS (SELECT * FROM classified WHERE p_status='all' OR status=p_status),
  paged AS (SELECT * FROM filtered ORDER BY username,auth_user_id LIMIT 25 OFFSET p_page*25)
  SELECT jsonb_build_object('contract','buildtrack.account-access.v1','actorId',v_uid,
    'generatedAt',statement_timestamp(),'page',p_page,'pageSize',25,'query',btrim(p_query),'status',p_status,
    'total',(SELECT count(*) FROM filtered),
    'accounts',COALESCE((SELECT jsonb_agg(jsonb_build_object('userId',auth_user_id,'username',username,
      'revision',review_revision,'reviewedAt',reviewed_at,'authStatus',auth_status,'status',status,
      'lastSuspension',CASE WHEN suspension_revision IS NULL THEN NULL ELSE jsonb_build_object(
        'revision',suspension_revision,'reason',reason,'at',observed_at) END) ORDER BY username,auth_user_id) FROM paged),'[]'::jsonb))
  INTO v_result;
  RETURN v_result;
END;
$reader$;
REVOKE ALL ON FUNCTION account_security_private.read_sales_account_access(integer,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION account_security_private.read_sales_account_access(integer,text,text) TO authenticated;
CREATE FUNCTION public.app_sales_account_access(p_page integer, p_query text, p_status text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=''
AS $$ SELECT account_security_private.read_sales_account_access(p_page,p_query,p_status); $$;
REVOKE ALL ON FUNCTION public.app_sales_account_access(integer,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.app_sales_account_access(integer,text,text) TO authenticated;

DO $acl$
DECLARE v_role text;
BEGIN
  FOR v_role IN SELECT rolname FROM pg_roles WHERE rolname IN
    ('service_role','supabase_auth_admin','buildtrack_sales_sla_worker','buildtrack_sales_sla_dispatcher') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.app_sales_account_access(integer,text,text),account_security_private.read_sales_account_access(integer,text,text) FROM %I',v_role);
    IF has_function_privilege(v_role,'public.app_sales_account_access(integer,text,text)','EXECUTE')
      OR has_function_privilege(v_role,'account_security_private.read_sales_account_access(integer,text,text)','EXECUTE') THEN
      RAISE EXCEPTION 'ACCOUNT_ACCESS_UNEXPECTED_GRANT';
    END IF;
  END LOOP;
END;
$acl$;

-- Reviewed source: sql/security/account_access_restore_draft.sql
-- LF-normalized SHA256: de85db0b2b4cb0733bcc6542cd6e612cf3c79a7df7aa0216833db8fed455b3dc
-- DESIGN / ISOLATED TEST ONLY. Narrow Admin re-review of existing Sales.
-- Not provisioning, unbanning, changing roles, or enabling disabled memberships.


DO $preflight$
BEGIN
  IF to_regclass('account_security_private.crm_auth_suspensions') IS NULL
    OR to_regprocedure('account_security_private.review_account_role(uuid,integer,text,text,text,boolean,boolean,bigint,text,text,text)') IS NULL
    OR to_regprocedure('public.app_sales_account_access(integer,text,text)') IS NULL THEN
    RAISE EXCEPTION 'ACCOUNT_RESTORE_PREREQUISITES_REQUIRED';
  END IF;
  PERFORM account_security_private.assert_crm_review_ready();
  IF to_regclass('account_security_private.sales_restore_receipts') IS NOT NULL
    OR EXISTS(SELECT 1 FROM pg_proc WHERE proname IN ('restore_sales_account_access','app_restore_sales_account_access')
      AND pronamespace IN ('public'::regnamespace,'account_security_private'::regnamespace)) THEN
    RAISE EXCEPTION 'ACCOUNT_RESTORE_ALREADY_EXISTS';
  END IF;
  IF (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid='account_security_private.reviewed_roles'::regclass)<>current_user
    OR (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid='account_security_private.review_account_role(uuid,integer,text,text,text,boolean,boolean,bigint,text,text,text)'::regprocedure)<>current_user THEN
    RAISE EXCEPTION 'ACCOUNT_RESTORE_OWNER_REQUIRED';
  END IF;
END;
$preflight$;

CREATE TABLE account_security_private.sales_restore_receipts (
  request_id uuid PRIMARY KEY,
  actor_id uuid NOT NULL,
  payload jsonb NOT NULL,
  receipt jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
  -- No cascading FK: retain evidence if a directory entry is later removed.
);
ALTER TABLE account_security_private.sales_restore_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON account_security_private.sales_restore_receipts FROM PUBLIC,anon,authenticated;
CREATE TRIGGER sales_restore_receipts_append_only BEFORE UPDATE OR DELETE OR TRUNCATE
ON account_security_private.sales_restore_receipts FOR EACH STATEMENT
EXECUTE FUNCTION account_security_private.prevent_role_review_change();

CREATE FUNCTION account_security_private.restore_sales_account_access(
  p_request_id uuid, p_actor_id uuid, p_user_id uuid, p_expected_revision bigint,
  p_expected_username text, p_reason text, p_confirmed boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $restore$
DECLARE
  v_actor jsonb;
  v_old account_security_private.reviewed_roles%ROWTYPE;
  v_auth auth.users%ROWTYPE;
  v_crm sales_private.crm_user_roles%ROWTYPE;
  v_saved account_security_private.sales_restore_receipts%ROWTYPE;
  v_payload jsonb; v_receipt jsonb; v_username text; v_revision bigint;
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='ACCOUNT_RESTORE_READ_COMMITTED_REQUIRED';
  END IF;
  IF auth.uid() IS NULL OR p_actor_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='ACCOUNT_RESTORE_FORBIDDEN';
  END IF;
  -- Same order as the operator primitive: global review lock BEFORE any actor
  -- row locks. Concurrent Admin revocation and review cannot invert that order.
  PERFORM pg_advisory_xact_lock(20260925,3);
  v_actor:=account_security_private.current_actor();
  IF v_actor->>'role'<>'Admin' OR (v_actor->>'canManageAccounts')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='ACCOUNT_RESTORE_FORBIDDEN';
  END IF;
  PERFORM account_security_private.assert_crm_review_ready();
  IF p_request_id IS NULL OR p_user_id IS NULL OR p_user_id=p_actor_id
    OR p_expected_revision IS NULL OR p_expected_revision NOT BETWEEN 1 AND 9007199254740990
    OR p_expected_username IS NULL OR length(p_expected_username) NOT BETWEEN 1 AND 500 OR btrim(p_expected_username)=''
    OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 8 AND 500 OR p_reason ~ '[[:cntrl:]]'
    OR p_confirmed IS DISTINCT FROM true THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='ACCOUNT_RESTORE_INVALID_INPUT';
  END IF;
  v_payload:=jsonb_build_object('userId',p_user_id,'expectedRevision',p_expected_revision,
    'expectedUsername',p_expected_username,'reason',btrim(p_reason),'confirmed',true);
  SELECT * INTO v_saved FROM account_security_private.sales_restore_receipts WHERE request_id=p_request_id;
  IF FOUND THEN
    IF v_saved.actor_id<>p_actor_id OR v_saved.payload<>v_payload THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='ACCOUNT_RESTORE_REQUEST_CONFLICT';
    END IF;
    -- Historical acknowledgement ONLY, never proof of current active access.
    -- A later ban/review remains effective; replay makes no change whatsoever.
    RETURN v_saved.receipt;
  END IF;
  SELECT * INTO v_old FROM account_security_private.reviewed_roles WHERE auth_user_id=p_user_id FOR UPDATE;
  IF NOT FOUND OR v_old.role<>'Sales' OR NOT v_old.enabled OR v_old.review_revision<>p_expected_revision THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='ACCOUNT_RESTORE_STATE_CHANGED';
  END IF;
  PERFORM 1 FROM account_security_private.reviewed_admins WHERE auth_user_id=p_user_id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM account_security_private.reviewed_admins WHERE auth_user_id=p_user_id
    AND (enabled OR legacy_user_id<>v_old.legacy_user_id)) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='ACCOUNT_RESTORE_STATE_CHANGED';
  END IF;
  -- Auth before CRM: suspension trigger already holds Auth then updates CRM.
  SELECT * INTO v_auth FROM auth.users WHERE id=p_user_id FOR SHARE;
  SELECT username INTO v_username FROM public.users WHERE id=v_old.legacy_user_id FOR SHARE;
  IF v_auth.id IS NULL OR v_auth.deleted_at IS NOT NULL OR COALESCE(v_auth.is_anonymous,false)
    OR v_auth.banned_until>statement_timestamp() OR NULLIF(btrim(v_auth.email),'') IS NULL
    OR v_username IS DISTINCT FROM p_expected_username THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='ACCOUNT_RESTORE_STATE_CHANGED';
  END IF;
  SELECT * INTO v_crm FROM sales_private.crm_user_roles WHERE user_id=p_user_id FOR UPDATE;
  IF NOT FOUND OR v_crm.role IS DISTINCT FROM 'sales' OR v_crm.is_active IS DISTINCT FROM false OR v_crm.trusted_review_revision IS DISTINCT FROM v_old.review_revision
    OR NOT EXISTS(SELECT 1 FROM account_security_private.crm_auth_suspensions
      WHERE auth_user_id=p_user_id AND review_revision=v_old.review_revision)
    OR EXISTS(SELECT 1 FROM account_security_private.crm_auth_suspensions
      WHERE auth_user_id=p_user_id AND review_revision>v_old.review_revision) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='ACCOUNT_RESTORE_STATE_CHANGED';
  END IF;
  -- Existing immutable identity binding only; email stays inside the database.
  v_revision:=account_security_private.review_account_role(p_user_id,v_old.legacy_user_id,
    p_expected_username,v_auth.email,'Sales',true,false,p_expected_revision,btrim(p_reason),
    'Admin Auth ID: '||p_actor_id::text,NULL);
  v_receipt:=jsonb_build_object('contract','buildtrack.account-restore.v1','requestId',p_request_id,
    'actorId',p_actor_id,'userId',p_user_id,'reviewedRevision',v_revision,'reviewedAt',clock_timestamp());
  INSERT INTO account_security_private.sales_restore_receipts(request_id,actor_id,payload,receipt)
    VALUES(p_request_id,p_actor_id,v_payload,v_receipt);
  RETURN v_receipt;
END;
$restore$;
REVOKE ALL ON FUNCTION account_security_private.restore_sales_account_access(uuid,uuid,uuid,bigint,text,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION account_security_private.restore_sales_account_access(uuid,uuid,uuid,bigint,text,text,boolean) TO authenticated;
CREATE FUNCTION public.app_restore_sales_account_access(
  p_request_id uuid,p_actor_id uuid,p_user_id uuid,p_expected_revision bigint,p_expected_username text,p_reason text,p_confirmed boolean
) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $$ SELECT account_security_private.restore_sales_account_access(p_request_id,p_actor_id,p_user_id,p_expected_revision,p_expected_username,p_reason,p_confirmed); $$;
REVOKE ALL ON FUNCTION public.app_restore_sales_account_access(uuid,uuid,uuid,bigint,text,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.app_restore_sales_account_access(uuid,uuid,uuid,bigint,text,text,boolean) TO authenticated;
DO $acl$
DECLARE v_role text;
BEGIN
  FOR v_role IN SELECT rolname FROM pg_roles WHERE rolname IN
    ('anon','authenticated','service_role','supabase_auth_admin','buildtrack_sales_sla_worker','buildtrack_sales_sla_dispatcher') LOOP
    EXECUTE format('REVOKE ALL ON account_security_private.sales_restore_receipts FROM %I',v_role);
    IF v_role<>'authenticated' THEN
      EXECUTE format('REVOKE ALL ON FUNCTION public.app_restore_sales_account_access(uuid,uuid,uuid,bigint,text,text,boolean),account_security_private.restore_sales_account_access(uuid,uuid,uuid,bigint,text,text,boolean) FROM %I',v_role);
    END IF;
    IF has_table_privilege(v_role,'account_security_private.sales_restore_receipts','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
      OR has_any_column_privilege(v_role,'account_security_private.sales_restore_receipts','SELECT,INSERT,UPDATE,REFERENCES')
      OR (v_role<>'authenticated' AND has_function_privilege(v_role,'public.app_restore_sales_account_access(uuid,uuid,uuid,bigint,text,text,boolean)','EXECUTE')) THEN
      RAISE EXCEPTION 'ACCOUNT_RESTORE_UNEXPECTED_GRANT';
    END IF;
  END LOOP;
END;
$acl$;

-- Prevent broad existing INSERT/UPDATE grants from populating new V2 columns.
-- Legacy fields and legacy RLS remain unchanged. This seal must be explicitly
-- replaced in a later reviewed backfill/activation migration, never by a flag.
CREATE FUNCTION sales_private.reject_sealed_legacy_fields()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $$ BEGIN
  IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(TG_ARGV[0]::jsonb) c
      WHERE to_jsonb(NEW)->c IS DISTINCT FROM 'null'::jsonb) THEN
    RAISE EXCEPTION 'CRM_FOUNDATION_COLUMNS_SEALED';
  END IF;
  RETURN NEW;
END; $$;
DO $legacy_seals$
DECLARE r record; v_columns jsonb;
BEGIN
  FOR r IN SELECT * FROM crm_foundation_relations WHERE nspname='public' AND relname IN ('sales','customer_voices') LOOP
    SELECT jsonb_agg(attname::text ORDER BY attnum) INTO v_columns FROM pg_attribute
    WHERE attrelid=r.oid AND attnum>0 AND NOT attisdropped AND NOT attname=ANY(r.columns);
    IF v_columns IS NULL THEN RAISE EXCEPTION 'CRM_FOUNDATION_EXPECTED_COLUMNS_MISSING'; END IF;
    EXECUTE format('CREATE TRIGGER crm_foundation_legacy_fields_sealed BEFORE INSERT OR UPDATE ON %I.%I FOR EACH ROW EXECUTE FUNCTION sales_private.reject_sealed_legacy_fields(%L)',r.nspname,r.relname,v_columns::text);
  END LOOP;
END;
$legacy_seals$;
CREATE TRIGGER crm_legacy_snapshot_append_only BEFORE UPDATE OR DELETE OR TRUNCATE
ON sales_private.crm_legacy_source_snapshots FOR EACH STATEMENT
EXECUTE FUNCTION account_security_private.prevent_role_review_change();

-- Close ALL new objects, including Supabase/custom inherited default grantees.
-- Existing-object grants/default privileges are never rewritten. Later release
-- explicitly grants reviewed facades only after manifest/backfill/write cutover.
DO $seal$
DECLARE r record; g record; v_target text;
BEGIN
  FOR r IN SELECT p.oid,p.oid::regprocedure AS signature,p.proowner,p.proacl
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname IN ('public','sales_private','account_security_private') AND p.prokind='f'
      AND NOT EXISTS(SELECT 1 FROM crm_foundation_functions b WHERE b.oid=p.oid) LOOP
    FOR g IN SELECT DISTINCT grantee FROM aclexplode(coalesce(r.proacl,acldefault('f',r.proowner))) WHERE grantee<>r.proowner LOOP
      v_target:=CASE WHEN g.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(g.grantee)) END;
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %s',r.signature,v_target);
    END LOOP;
  END LOOP;
  FOR r IN SELECT c.oid,c.relowner,c.relacl,c.relkind,n.nspname,c.relname
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('public','sales_private','account_security_private') AND c.relkind IN ('r','S')
      AND NOT EXISTS(SELECT 1 FROM crm_foundation_relations b WHERE b.oid=c.oid) LOOP
    FOR g IN SELECT DISTINCT grantee FROM aclexplode(coalesce(r.relacl,acldefault(CASE WHEN r.relkind='S' THEN 'S'::"char" ELSE 'r'::"char" END,r.relowner))) WHERE grantee<>r.relowner LOOP
      v_target:=CASE WHEN g.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(g.grantee)) END;
      EXECUTE format('REVOKE ALL ON %s %I.%I FROM %s',CASE WHEN r.relkind='S' THEN 'SEQUENCE' ELSE 'TABLE' END,r.nspname,r.relname,v_target);
    END LOOP;
  END LOOP;
END;
$seal$;
DO $verify$
DECLARE r record; v_hash text; v_added text[]; v_role text;
BEGIN
  IF EXISTS(SELECT 1 FROM account_security_private.reviewed_roles)
    OR EXISTS(SELECT 1 FROM sales_private.crm_user_roles)
    OR EXISTS(SELECT 1 FROM public.crm_settings)
    OR EXISTS(SELECT 1 FROM public.sales_customers)
    OR EXISTS(SELECT 1 FROM public.crm_import_batches)
    OR to_regclass('public.sales_active_plot_booking_idx') IS NOT NULL THEN
    RAISE EXCEPTION 'CRM_FOUNDATION_MUST_REMAIN_EMPTY_SEALED';
  END IF;
  IF EXISTS(SELECT 1 FROM crm_foundation_functions b LEFT JOIN pg_proc p ON p.oid=b.oid
      WHERE p.oid IS NULL OR md5(pg_get_functiondef(p.oid)||coalesce(p.proacl::text,'')||p.proowner::text) IS DISTINCT FROM b.hash)
    OR EXISTS(SELECT 1 FROM crm_foundation_relations b LEFT JOIN pg_class c ON c.oid=b.oid
      WHERE c.oid IS NULL OR (c.relacl,c.relrowsecurity,c.relowner) IS DISTINCT FROM (b.relacl,b.relrowsecurity,b.relowner))
    OR EXISTS(SELECT 1 FROM crm_foundation_triggers b LEFT JOIN pg_trigger t ON t.oid=b.oid
      WHERE t.oid IS NULL OR md5(pg_get_triggerdef(t.oid)||t.tgenabled::text) IS DISTINCT FROM b.hash)
    OR EXISTS(SELECT 1 FROM crm_foundation_policies b LEFT JOIN pg_policy p ON p.oid=b.oid
      WHERE p.oid IS NULL OR md5(to_jsonb(p)::text) IS DISTINCT FROM b.hash) THEN
    RAISE EXCEPTION 'CRM_FOUNDATION_SHARED_OBJECT_CHANGED';
  END IF;
  FOR r IN SELECT * FROM crm_foundation_relations WHERE data_hash IS NOT NULL LOOP
    SELECT coalesce(array_agg(attname::text),'{}'::text[]) INTO v_added FROM pg_attribute
      WHERE attrelid=r.oid AND attnum>0 AND NOT attisdropped AND NOT attname=ANY(r.columns);
    EXECUTE format('SELECT md5(coalesce(jsonb_agg(to_jsonb(t)-$1 ORDER BY (to_jsonb(t)-$1)::text)::text,''[]'')) FROM %I.%I t',r.nspname,r.relname) INTO v_hash USING v_added;
    IF v_hash IS DISTINCT FROM r.data_hash THEN RAISE EXCEPTION 'CRM_FOUNDATION_LEGACY_DATA_CHANGED'; END IF;
  END LOOP;
  FOR v_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role') LOOP
    IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname IN ('public','sales_private','account_security_private') AND p.prokind='f'
        AND NOT EXISTS(SELECT 1 FROM crm_foundation_functions b WHERE b.oid=p.oid)
        AND has_function_privilege(v_role,p.oid,'EXECUTE'))
      OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname IN ('public','sales_private','account_security_private') AND c.relkind='r'
          AND NOT EXISTS(SELECT 1 FROM crm_foundation_relations b WHERE b.oid=c.oid)
          AND (NOT c.relrowsecurity OR has_table_privilege(v_role,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
            OR has_any_column_privilege(v_role,c.oid,'SELECT,INSERT,UPDATE,REFERENCES'))) THEN
      RAISE EXCEPTION 'CRM_FOUNDATION_UNEXPECTED_CLIENT_ACCESS';
    END IF;
  END LOOP;
END;
$verify$;
COMMIT;
