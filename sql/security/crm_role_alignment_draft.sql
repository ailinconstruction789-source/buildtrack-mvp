-- DESIGN / ISOLATED TEST ONLY. No production migration, staff auto-import or flags.
-- Keep CRM's row shape/locks/history. Its permission fields become a projection
-- of reviewed_roles, synchronized in the same transaction, never a second source.
BEGIN;
DO $draft_only$
BEGIN
  RAISE EXCEPTION 'DESIGN ONLY: CRM role alignment requires isolated integration and approved cutover';
END;
$draft_only$;

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
ROLLBACK;
