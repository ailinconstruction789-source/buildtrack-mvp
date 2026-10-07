-- DESIGN / ISOLATED TEST ONLY. Requires reviewed account/CRM alignment (3b).
-- Proposed Auth UPDATE trigger needs an isolated Supabase Auth compatibility
-- test and approved write freeze before any migration. NEVER run as-is.
-- Only suspends CRM permissions. Never edits Auth, canonical roles, customer
-- ownership, event dates, sessions or business history. No automatic restoration.
BEGIN;
DO $draft_only$
BEGIN
  RAISE EXCEPTION 'DESIGN ONLY: CRM Auth revocation requires isolated Auth verification and approved cutover';
END;
$draft_only$;

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
ROLLBACK;
