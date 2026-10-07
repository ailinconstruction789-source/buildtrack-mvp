-- DESIGN / ISOLATED TEST ONLY. Read-only Admin screen, no account command.
BEGIN;
DO $draft_only$
BEGIN
  RAISE EXCEPTION 'DESIGN ONLY: account access reader requires reviewed security cutover';
END;
$draft_only$;

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
ROLLBACK;
