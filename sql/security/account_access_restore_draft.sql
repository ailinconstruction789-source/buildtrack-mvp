-- DESIGN / ISOLATED TEST ONLY. Narrow Admin re-review of existing Sales.
-- Not provisioning, unbanning, changing roles, or enabling disabled memberships.
BEGIN;
DO $draft_only$
BEGIN
  RAISE EXCEPTION 'DESIGN ONLY: Sales access restoration requires isolated Auth verification and approved cutover';
END;
$draft_only$;

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
ROLLBACK;
