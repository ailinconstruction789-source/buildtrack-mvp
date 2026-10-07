-- DESIGN ONLY. NOT A MIGRATION. No production execution authorized.
-- Phase 2a: same source of names, separate column permissions. Deploy the new
-- name-only frontend FIRST; old SELECT * / ORDER BY role login will fail afterward.
BEGIN;
DO $draft_only$
BEGIN
  RAISE EXCEPTION 'DESIGN ONLY: login directory requires frontend cutover and reviewed account guards';
END;
$draft_only$;

DO $preflight$
BEGIN
  IF to_regclass('account_security_private.reviewed_admins') IS NULL
    OR NOT EXISTS (SELECT 1 FROM pg_class WHERE oid='public.users'::regclass AND relrowsecurity)
    OR (SELECT count(*) FROM pg_policy WHERE polrelid='public.users'::regclass AND NOT polpermissive
      AND polname IN ('account_guard_no_client_insert','account_guard_no_client_update','account_guard_no_client_delete')) <> 3 THEN
    RAISE EXCEPTION 'LOGIN_DIRECTORY_ACCOUNT_GUARDS_REQUIRED';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(ARRAY['anon','authenticated']) r
    WHERE has_table_privilege(r,'public.users','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      OR has_any_column_privilege(r,'public.users','INSERT,UPDATE,REFERENCES')) THEN
    RAISE EXCEPTION 'LOGIN_DIRECTORY_UNSAFE_ACCOUNT_WRITES';
  END IF;
END;
$preflight$;

-- Revoke both table and previously granted column reads. Revoking only individual
-- columns would not override table-level SELECT. PUBLIC also reaches anon.
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
-- Preserve existing logged-in staff/assignment readers. This is NOT a trusted
-- authorization source and does NOT close all authenticated-data policies.
GRANT SELECT ON public.users TO authenticated;
CREATE POLICY login_name_public_read ON public.users FOR SELECT TO anon USING (true);

DO $verify_acl$
BEGIN
  IF has_table_privilege('anon','public.users','SELECT')
    OR NOT has_column_privilege('anon','public.users','username','SELECT')
    OR EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.users'::regclass AND attnum>0 AND NOT attisdropped
      AND attname <> 'username' AND has_column_privilege('anon','public.users',attnum,'SELECT')) THEN
    RAISE EXCEPTION 'LOGIN_DIRECTORY_UNEXPECTED_INHERITED_READ_GRANT';
  END IF;
END;
$verify_acl$;
-- No view, public SECURITY DEFINER, duplicate directory table, credentials or rows.
ROLLBACK;
