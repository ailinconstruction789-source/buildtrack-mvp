-- REVIEWED CUTOVER CANDIDATE: account administration only, NOT Sales activation.
-- Created using Supabase CLI. Do not db push until the matching Admin UI is live.
-- Operator must supply the release, target, reviewed Admin UUID, backup evidence
-- and client-readiness settings after the documented cutover review.
-- This file intentionally rejects unattended/default execution. Never remove gates.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

DO $release_preflight$
DECLARE
  v_expected uuid;
  v_count integer;
  v_row record;
BEGIN
  IF current_setting('buildtrack.account_cutover_release',true)
      IS DISTINCT FROM 'account_guard_v1_20260925'
    OR current_setting('buildtrack.account_cutover_project',true)
      IS DISTINCT FROM 'kbthmdedilswdmmczfay'
    OR current_setting('buildtrack.account_cutover_client',true)
      IS DISTINCT FROM 'buildtrack.account-commands.v1'
    OR length(coalesce(current_setting('buildtrack.account_cutover_backup',true),'')) < 8 THEN
    RAISE EXCEPTION 'ACCOUNT_CUTOVER_REVIEW_REQUIRED';
  END IF;
  BEGIN
    v_expected := nullif(current_setting('buildtrack.account_cutover_admin',true),'')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'ACCOUNT_CUTOVER_ADMIN_REQUIRED';
  END;
  IF v_expected IS NULL THEN RAISE EXCEPTION 'ACCOUNT_CUTOVER_ADMIN_REQUIRED'; END IF;
  IF to_regnamespace('account_security_private') IS NOT NULL THEN
    RAISE EXCEPTION 'ACCOUNT_GUARD_SCHEMA_ALREADY_EXISTS';
  END IF;

  -- CRLF/LF is normalized ONLY for byte-format drift. No SQL tokens are ignored.
  FOR v_row IN SELECT * FROM (VALUES
    ('public.admin_create_user(text,text)','cc39f36b5c998b36b2f936e974347486'),
    ('public.admin_delete_user(text)','de7b0d781c2f06715d4b76ceefbae479'),
    ('public.admin_change_username(text,text)','0b4cc3a38ef75fa6408f181a3c0a28ab'),
    ('public.admin_change_user_password(text,text)','38148f09869b10929a20486635ccfdab')
  ) AS expected(signature,body_hash) LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure(v_row.signature)
      AND md5(replace(p.prosrc,chr(13)||chr(10),chr(10)))=v_row.body_hash) THEN
      RAISE EXCEPTION 'ACCOUNT_CUTOVER_BODY_CHANGED: %',v_row.signature;
    END IF;
  END LOOP;

  -- The UUID is supplied from the independently reviewed binding, not metadata,
  -- a legacy Admin role label, or whichever account happens to use this name.
  SELECT count(*) INTO v_count FROM public.users p JOIN auth.users u
    ON u.email=lower(replace(p.username,' ',''))||'@buildtrack.local'
    WHERE p.username='Admin';
  IF v_count<>1 THEN RAISE EXCEPTION 'ACCOUNT_CUTOVER_ADMIN_BINDING_CHANGED'; END IF;
  PERFORM 1 FROM public.users p JOIN auth.users u
    ON u.email=lower(replace(p.username,' ',''))||'@buildtrack.local'
    WHERE p.username='Admin' AND u.id=v_expected
      AND u.deleted_at IS NULL AND NOT coalesce(u.is_anonymous,false)
      AND (u.banned_until IS NULL OR u.banned_until<=statement_timestamp())
    FOR SHARE OF p,u;
  IF NOT FOUND THEN RAISE EXCEPTION 'ACCOUNT_CUTOVER_ADMIN_BINDING_CHANGED'; END IF;

  IF EXISTS(SELECT 1 FROM pg_trigger WHERE NOT tgisinternal
    AND tgrelid IN ('public.users'::regclass,'public.foremen'::regclass,'auth.users'::regclass))
    OR EXISTS(SELECT 1 FROM pg_constraint WHERE contype='f'
      AND (conrelid='public.foremen'::regclass OR confrelid='public.foremen'::regclass)) THEN
    RAISE EXCEPTION 'ACCOUNT_CUTOVER_DEPENDENCIES_CHANGED';
  END IF;
END;
$release_preflight$;

-- Fail closed on unexpected signatures, overloads, owners or writable lookup
-- schemas. Do not silently replace another security implementation on rerun.
DO $preflight$
DECLARE
  v_name text;
  v_function regprocedure;
  v_expected text[] := ARRAY[
    'public.admin_create_user(text,text)',
    'public.admin_delete_user(text)',
    'public.admin_change_username(text,text)',
    'public.admin_change_user_password(text,text)'
  ];
BEGIN
  IF to_regnamespace('account_security_private') IS NOT NULL THEN
    RAISE EXCEPTION 'ACCOUNT_GUARD_SCHEMA_ALREADY_EXISTS';
  END IF;
  IF to_regclass('public.users') IS NULL OR to_regclass('auth.users') IS NULL
    OR to_regclass('auth.sessions') IS NULL OR to_regclass('public.foremen') IS NULL THEN
    RAISE EXCEPTION 'ACCOUNT_GUARD_PREREQUISITES_MISSING';
  END IF;
  FOREACH v_name IN ARRAY v_expected LOOP
    v_function := to_regprocedure(v_name);
    IF v_function IS NULL OR NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
      WHERE p.oid = v_function AND p.prorettype = 'void'::regtype
        AND NOT p.proretset AND p.prokind = 'f' AND p.pronargdefaults = 0
        AND p.proowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)
        AND l.lanname = 'plpgsql'
    ) THEN
      RAISE EXCEPTION 'ACCOUNT_GUARD_UNREVIEWED_FUNCTION: %', v_name;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN (
      'admin_create_user','admin_delete_user','admin_change_username','admin_change_user_password'
    )) <> 4 THEN
    RAISE EXCEPTION 'ACCOUNT_GUARD_UNREVIEWED_OVERLOAD';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_namespace n CROSS JOIN pg_roles r
    WHERE n.nspname IN ('public','extensions') AND r.rolname IN ('anon','authenticated')
      AND has_schema_privilege(r.oid,n.oid,'CREATE')
  ) THEN
    RAISE EXCEPTION 'ACCOUNT_GUARD_WRITABLE_LOOKUP_SCHEMA';
  END IF;
END;
$preflight$;

CREATE SCHEMA account_security_private;
REVOKE ALL ON SCHEMA account_security_private FROM PUBLIC, anon, authenticated;
-- Needed only by the invoker facades below. Do NOT add this schema to Data API.
GRANT USAGE ON SCHEMA account_security_private TO authenticated;

CREATE TABLE account_security_private.reviewed_admins (
  auth_user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
  legacy_user_id integer NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE RESTRICT,
  enabled boolean NOT NULL DEFAULT false,
  review_reference text NOT NULL CHECK (length(btrim(review_reference)) >= 8),
  reviewed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE account_security_private.reviewed_admins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON account_security_private.reviewed_admins FROM PUBLIC, anon, authenticated;
-- Intentionally NO bootstrap INSERT, public management RPC or client-write policy.
-- A trusted operator must independently verify UUID + legacy id and recovery access.
-- An empty list denies EVERY account command, including SQL-editor/service calls.

-- Relocate, do not copy/reimplement the existing business logic. Retain original
-- object identity/dependencies but remove direct client access and elevated rights.
-- Review other functions that call these OIDs/names before any live cutover.
ALTER FUNCTION public.admin_create_user(text,text) SET SCHEMA account_security_private;
ALTER FUNCTION public.admin_delete_user(text) SET SCHEMA account_security_private;
ALTER FUNCTION public.admin_change_username(text,text) SET SCHEMA account_security_private;
ALTER FUNCTION public.admin_change_user_password(text,text) SET SCHEMA account_security_private;

ALTER FUNCTION account_security_private.admin_create_user(text,text) SECURITY INVOKER;
ALTER FUNCTION account_security_private.admin_delete_user(text) SECURITY INVOKER;
ALTER FUNCTION account_security_private.admin_change_username(text,text) SECURITY INVOKER;
ALTER FUNCTION account_security_private.admin_change_user_password(text,text) SECURITY INVOKER;
-- Legacy crypt/gen_salt are unqualified. Only reviewed, non-client-writable schemas
-- are searched. pg_temp is explicitly LAST, never the implicit first position.
ALTER FUNCTION account_security_private.admin_create_user(text,text) SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION account_security_private.admin_delete_user(text) SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION account_security_private.admin_change_username(text,text) SET search_path = pg_catalog, public, extensions, pg_temp;
ALTER FUNCTION account_security_private.admin_change_user_password(text,text) SET search_path = pg_catalog, public, extensions, pg_temp;
REVOKE ALL ON FUNCTION account_security_private.admin_create_user(text,text),
  account_security_private.admin_delete_user(text),
  account_security_private.admin_change_username(text,text),
  account_security_private.admin_change_user_password(text,text) FROM PUBLIC, anon, authenticated;

-- Called ONLY under the reviewed dispatcher. Keep the original Auth implementation,
-- but put Foreman membership in the SAME transaction. Do not delete construction
-- history or silently adopt an existing/orphaned name as a new account.
CREATE FUNCTION account_security_private.mutate_account_with_foreman(
  p_action text, p_username text, p_role text
) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $mutation$
DECLARE v_role text;
BEGIN
  IF p_username IS NULL OR btrim(p_username) = '' OR p_username <> btrim(p_username) THEN
    RAISE EXCEPTION 'ACCOUNT_USERNAME_INVALID';
  END IF;
  IF p_action = 'create' THEN
    IF EXISTS (SELECT 1 FROM public.users WHERE username = p_username)
      OR EXISTS (SELECT 1 FROM auth.users WHERE email = lower(replace(p_username,' ','')) || '@buildtrack.local')
      OR EXISTS (SELECT 1 FROM public.foremen WHERE name = p_username) THEN
      RAISE EXCEPTION 'ACCOUNT_NAME_CONFLICT';
    END IF;
    PERFORM account_security_private.admin_create_user(p_username,p_role);
    IF p_role = 'Foreman' THEN
      INSERT INTO public.foremen(name) VALUES (p_username);
    END IF;
  ELSIF p_action = 'delete' THEN
    SELECT role INTO STRICT v_role FROM public.users WHERE username = p_username FOR UPDATE;
    -- Use the stored role, not a browser-supplied role. Any FK/trigger error rolls
    -- back the subsequent legacy command too; never use cascading cleanup here.
    IF v_role = 'Foreman' THEN
      DELETE FROM public.foremen WHERE name = p_username;
    END IF;
    PERFORM account_security_private.admin_delete_user(p_username);
  ELSE
    RAISE EXCEPTION 'ACCOUNT_COMMAND_INVALID';
  END IF;
END;
$mutation$;
REVOKE ALL ON FUNCTION account_security_private.mutate_account_with_foreman(text,text,text) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION account_security_private.execute_account_command(
  p_action text, p_username text, p_value text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $command$
DECLARE
  v_actor uuid := auth.uid();
  v_session uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ACCOUNT_ADMIN_REQUIRED';
  END IF;
  BEGIN
    v_session := NULLIF(auth.jwt()->>'session_id','')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ACCOUNT_ADMIN_REQUIRED';
  END;
  -- Re-read trusted membership and session for every sensitive call, not a role
  -- label in a stale token, editable metadata, selected username or browser state.
  -- Lock membership through the command so a concurrent revoke cannot race it.
  PERFORM 1
  FROM account_security_private.reviewed_admins a
  JOIN auth.users u ON u.id = a.auth_user_id
  JOIN auth.sessions s ON s.user_id = u.id AND s.id = v_session
  WHERE a.auth_user_id = v_actor AND a.enabled
    AND u.deleted_at IS NULL AND NOT COALESCE(u.is_anonymous,false)
    AND (u.banned_until IS NULL OR u.banned_until <= statement_timestamp())
    AND (s.not_after IS NULL OR s.not_after > statement_timestamp())
  FOR SHARE OF a, u, s;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ACCOUNT_ADMIN_REQUIRED';
  END IF;

  CASE p_action
    WHEN 'create' THEN
      PERFORM account_security_private.mutate_account_with_foreman('create',p_username,p_value);
    WHEN 'delete' THEN
      PERFORM account_security_private.mutate_account_with_foreman('delete',p_username,NULL);
    WHEN 'rename' THEN
      PERFORM account_security_private.admin_change_username(p_username,p_value);
    WHEN 'password' THEN
      PERFORM account_security_private.admin_change_user_password(p_username,p_value);
    ELSE
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ACCOUNT_COMMAND_INVALID';
  END CASE;
END;
$command$;
REVOKE ALL ON FUNCTION account_security_private.execute_account_command(text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION account_security_private.execute_account_command(text,text,text) TO authenticated;

-- Keep the exact existing frontend signatures. Public endpoints are INVOKER;
-- the only elevated dispatcher lives in the unexposed schema and always guards.
CREATE FUNCTION public.admin_create_user(p_username text,p_role text)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path = ''
AS $$ SELECT account_security_private.execute_account_command('create',p_username,p_role); $$;
CREATE FUNCTION public.admin_delete_user(p_username text)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path = ''
AS $$ SELECT account_security_private.execute_account_command('delete',p_username,NULL); $$;
CREATE FUNCTION public.admin_change_username(p_old_username text,p_new_username text)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path = ''
AS $$ SELECT account_security_private.execute_account_command('rename',p_old_username,p_new_username); $$;
CREATE FUNCTION public.admin_change_user_password(p_username text,p_new_pin text)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path = ''
AS $$ SELECT account_security_private.execute_account_command('password',p_username,p_new_pin); $$;
REVOKE ALL ON FUNCTION public.admin_create_user(text,text), public.admin_delete_user(text),
  public.admin_change_username(text,text), public.admin_change_user_password(text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_create_user(text,text), public.admin_delete_user(text),
  public.admin_change_username(text,text), public.admin_change_user_password(text,text) TO authenticated;

-- Compatibility only, NOT authorization. The dispatcher still checks every call.
CREATE FUNCTION public.app_account_command_capabilities()
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = ''
AS $$ SELECT jsonb_build_object('contract','buildtrack.account-commands.v1','atomicForeman',true); $$;

-- Default grants may include service_role or a custom group inherited by clients.
-- Remove every non-owner ACL on ONLY the objects created/relocated in this draft;
-- do not change global defaults or unrelated application tables/functions.
DO $scoped_acl$
DECLARE v_object record; v_grant record;
BEGIN
  FOR v_object IN
    SELECT p.oid,p.proowner,p.proacl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='account_security_private'
      OR (n.nspname='public' AND p.proname IN ('admin_create_user','admin_delete_user',
        'admin_change_username','admin_change_user_password','app_account_command_capabilities'))
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',v_object.oid::regprocedure);
    FOR v_grant IN SELECT DISTINCT r.rolname FROM aclexplode(v_object.proacl) a
      JOIN pg_roles r ON r.oid=a.grantee WHERE a.grantee<>v_object.proowner LOOP
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',v_object.oid::regprocedure,v_grant.rolname);
    END LOOP;
  END LOOP;
  FOR v_grant IN SELECT DISTINCT r.rolname FROM pg_class c
    CROSS JOIN LATERAL aclexplode(c.relacl) a JOIN pg_roles r ON r.oid=a.grantee
    WHERE c.oid='account_security_private.reviewed_admins'::regclass AND a.grantee<>c.relowner LOOP
    EXECUTE format('REVOKE ALL ON account_security_private.reviewed_admins FROM %I',v_grant.rolname);
  END LOOP;
END;
$scoped_acl$;
GRANT EXECUTE ON FUNCTION account_security_private.execute_account_command(text,text,text),
  public.admin_create_user(text,text), public.admin_delete_user(text),
  public.admin_change_username(text,text), public.admin_change_user_password(text,text),
  public.app_account_command_capabilities() TO authenticated;

-- Closing RPC alone leaves the direct-table bypass. Preserve SELECT in phase 1,
-- revoke table AND column write privileges; restrictive RLS survives permissive
-- legacy policies and an accidental later client INSERT/UPDATE/DELETE grant.
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.users FROM PUBLIC, anon, authenticated;
DO $columns$
DECLARE v_column record;
BEGIN
  FOR v_column IN SELECT attname FROM pg_attribute
    WHERE attrelid = 'public.users'::regclass AND attnum > 0 AND NOT attisdropped LOOP
    EXECUTE format('REVOKE INSERT (%I), UPDATE (%I), REFERENCES (%I) ON public.users FROM PUBLIC, anon, authenticated',
      v_column.attname,v_column.attname,v_column.attname);
  END LOOP;
END;
$columns$;
CREATE POLICY account_guard_no_client_insert ON public.users AS RESTRICTIVE FOR INSERT TO anon, authenticated WITH CHECK (false);
CREATE POLICY account_guard_no_client_update ON public.users AS RESTRICTIVE FOR UPDATE TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY account_guard_no_client_delete ON public.users AS RESTRICTIVE FOR DELETE TO anon, authenticated USING (false);

-- Catch inherited/unexpected grants rather than trusting direct REVOKE alone.
DO $verify_acl$
DECLARE v_role text; v_name text;
BEGIN
  FOR v_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role') LOOP
    FOREACH v_name IN ARRAY ARRAY[
      'account_security_private.admin_create_user(text,text)',
      'account_security_private.admin_delete_user(text)',
      'account_security_private.admin_change_username(text,text)',
      'account_security_private.admin_change_user_password(text,text)',
      'account_security_private.mutate_account_with_foreman(text,text,text)'
    ] LOOP
      IF has_function_privilege(v_role,v_name,'EXECUTE') THEN
        RAISE EXCEPTION 'ACCOUNT_GUARD_LEGACY_EXECUTE_STILL_GRANTED';
      END IF;
    END LOOP;
    IF (v_role IN ('anon','authenticated') AND (
      has_table_privilege(v_role,'public.users','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      OR has_any_column_privilege(v_role,'public.users','INSERT,UPDATE,REFERENCES')))
      OR has_table_privilege(v_role,'account_security_private.reviewed_admins','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
      RAISE EXCEPTION 'ACCOUNT_GUARD_UNEXPECTED_INHERITED_TABLE_GRANT';
    END IF;
  END LOOP;
END;
$verify_acl$;


-- Install the ONE approved account manager in the same transaction as the guard.
-- No Auth password/session, business record, Sales role or other staff role changes.
DO $reviewed_admin$
DECLARE v_count integer;
BEGIN
  INSERT INTO account_security_private.reviewed_admins(
    auth_user_id,legacy_user_id,enabled,review_reference
  )
  SELECT u.id,p.id,true,'User-approved Admin; account_guard_v1_20260925; operator binding verified'
  FROM public.users p JOIN auth.users u
    ON u.email=lower(replace(p.username,' ',''))||'@buildtrack.local'
  WHERE p.username='Admin' AND u.id=current_setting('buildtrack.account_cutover_admin')::uuid
    AND u.deleted_at IS NULL AND NOT coalesce(u.is_anonymous,false)
    AND (u.banned_until IS NULL OR u.banned_until<=statement_timestamp());
  GET DIAGNOSTICS v_count=ROW_COUNT;
  IF v_count<>1 THEN RAISE EXCEPTION 'ACCOUNT_CUTOVER_ADMIN_BINDING_CHANGED'; END IF;
  IF (SELECT count(*) FROM account_security_private.reviewed_admins WHERE enabled)<>1 THEN
    RAISE EXCEPTION 'ACCOUNT_CUTOVER_ADMIN_VERIFY_FAILED';
  END IF;
END;
$reviewed_admin$;
NOTIFY pgrst, 'reload schema';
COMMIT;
