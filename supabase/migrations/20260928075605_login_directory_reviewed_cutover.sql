-- LOCAL CANDIDATE ONLY: not approved for production execution.
-- Created with Supabase CLI 2.117.0. No db push: earlier account migration has
-- different local/remote timestamps and must not be replayed.
-- Scope: anonymous users-table column reads only. No role/identity/bootstrap,
-- account function, presence, Sales, notification or customer-data changes.
-- Operator settings are attestations, NOT proof of the connected project or
-- acceptance. Independently verify target, backup and browser acceptance first.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

DO $release_preflight$
BEGIN
  IF current_setting('buildtrack.directory_release',true) IS DISTINCT FROM 'login_directory_v1_20260928'
    OR current_setting('buildtrack.directory_project',true) IS DISTINCT FROM 'kbthmdedilswdmmczfay'
    OR current_setting('buildtrack.directory_client',true) IS DISTINCT FROM 'f404377c4e5cef2088de1f4d1805164967608539'
    OR length(btrim(coalesce(current_setting('buildtrack.directory_acceptance',true),''))) < 8
    OR length(btrim(coalesce(current_setting('buildtrack.directory_backup',true),''))) < 8
    OR current_setting('buildtrack.directory_old_tabs_reviewed',true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'LOGIN_DIRECTORY_CUTOVER_REVIEW_REQUIRED';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid=to_regclass('public.users')
      AND relkind='r' AND relrowsecurity AND pg_get_userbyid(relowner)=current_user)
    OR to_regclass('account_security_private.reviewed_admins') IS NULL
    OR to_regprocedure('account_security_private.execute_account_command(text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'LOGIN_DIRECTORY_ACCOUNT_GUARDS_REQUIRED';
  END IF;
END;
$release_preflight$;

-- Short exclusive lock makes validation and privilege cutover atomic. A busy
-- users table aborts rather than waiting indefinitely or changing lock timeout.
LOCK TABLE public.users IN ACCESS EXCLUSIVE MODE;
DO $preflight$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.users'::regclass
      AND polname='login_name_public_read') OR NOT has_table_privilege('anon','public.users','SELECT') THEN
    RAISE EXCEPTION 'LOGIN_DIRECTORY_ALREADY_CHANGED_REVIEW_REQUIRED';
  END IF;
  IF NOT has_table_privilege('authenticated','public.users','SELECT') THEN
    RAISE EXCEPTION 'LOGIN_DIRECTORY_STAFF_READ_BASELINE_CHANGED';
  END IF;
  IF (SELECT count(*) FROM pg_policy WHERE polrelid='public.users'::regclass AND NOT polpermissive
      AND polroles @> ARRAY[(SELECT oid FROM pg_roles WHERE rolname='anon'),(SELECT oid FROM pg_roles WHERE rolname='authenticated')]::oid[]
      AND ((polname='account_guard_no_client_insert' AND polcmd='a' AND pg_get_expr(polwithcheck,polrelid)='false')
        OR (polname='account_guard_no_client_update' AND polcmd='w' AND pg_get_expr(polqual,polrelid)='false' AND pg_get_expr(polwithcheck,polrelid)='false')
        OR (polname='account_guard_no_client_delete' AND polcmd='d' AND pg_get_expr(polqual,polrelid)='false'))) <> 3
    OR EXISTS (SELECT 1 FROM unnest(ARRAY['anon','authenticated']) r
      WHERE has_table_privilege(r,'public.users','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        OR has_any_column_privilege(r,'public.users','INSERT,UPDATE,REFERENCES')) THEN
    RAISE EXCEPTION 'LOGIN_DIRECTORY_UNSAFE_ACCOUNT_WRITES';
  END IF;
END;
$preflight$;

REVOKE SELECT ON public.users FROM PUBLIC, anon;
DO $columns$
DECLARE v_column record;
BEGIN
  FOR v_column IN SELECT attname FROM pg_attribute
    WHERE attrelid='public.users'::regclass AND attnum>0 AND NOT attisdropped LOOP
    EXECUTE format('REVOKE SELECT (%I) ON public.users FROM PUBLIC, anon',v_column.attname);
  END LOOP;
END;
$columns$;
GRANT SELECT (username) ON public.users TO anon;
-- Preserve the already-authorized staff reader even if its old SELECT was
-- inherited from PUBLIC. This is not a trusted-role authorization rollout.
GRANT SELECT ON public.users TO authenticated;
CREATE POLICY login_name_public_read ON public.users FOR SELECT TO anon USING (true);

DO $verify_acl$
BEGIN
  IF has_table_privilege('anon','public.users','SELECT')
    OR NOT has_column_privilege('anon','public.users','username','SELECT')
    OR NOT has_table_privilege('authenticated','public.users','SELECT')
    OR EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.users'::regclass AND attnum>0 AND NOT attisdropped
      AND attname <> 'username' AND has_column_privilege('anon','public.users',attnum,'SELECT')) THEN
    RAISE EXCEPTION 'LOGIN_DIRECTORY_UNEXPECTED_INHERITED_READ_GRANT';
  END IF;
END;
$verify_acl$;
COMMIT;
