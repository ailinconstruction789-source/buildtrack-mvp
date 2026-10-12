-- REVIEW DRAFT ONLY: six legacy tables, 12 dependent views + trusted self presence.
-- NOT a deployable migration. No identity bootstrap, business backfill or activation.
-- Before rollout: review all 18 legacy bindings (9 missing at audit), remaining
-- modules/views/SECURITY DEFINER RPCs, rollback plan and both-role UI workflows.
-- Supabase API/JWT signatures and existing triggers require separate staging QA.
BEGIN;
DO $draft_only$
BEGIN
  RAISE EXCEPTION 'DESIGN ONLY: legacy authorization requires complete identity and module review';
END;
$draft_only$;

DO $preflight$
DECLARE v_hash text; v_views text[];
BEGIN
  IF to_regclass('account_security_private.reviewed_roles') IS NULL
    OR to_regclass('account_security_private.reviewed_admins') IS NULL
    OR to_regprocedure('account_security_private.current_actor()') IS NULL
    OR to_regprocedure('public.app_current_actor()') IS NULL THEN
    RAISE EXCEPTION 'REVIEWED_ACTOR_REQUIRED';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid='account_security_private.current_actor()'::regprocedure
    AND prosecdef AND proconfig @> ARRAY['search_path=""']
    AND proowner IN (SELECT oid FROM pg_roles WHERE rolsuper OR rolbypassrls)
    AND md5(prosrc)='a5596aa5d22a0a1d4124c708c22c0d36')
    OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid='public.app_current_actor()'::regprocedure
    AND NOT prosecdef AND proconfig @> ARRAY['search_path=""']
    AND md5(prosrc)='48c81bc5b496996c1a21a6bad59e6897') THEN
    RAISE EXCEPTION 'REVIEWED_ACTOR_SOURCE_CHANGED';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(ARRAY['anon','authenticated']) AS x(role_name)
    WHERE has_schema_privilege(role_name,'account_security_private','CREATE')
      OR has_table_privilege(role_name,'account_security_private.reviewed_roles','INSERT,UPDATE,DELETE,TRUNCATE')
      OR has_any_column_privilege(role_name,'account_security_private.reviewed_roles','INSERT,UPDATE')
      OR has_table_privilege(role_name,'account_security_private.reviewed_admins','INSERT,UPDATE,DELETE,TRUNCATE')
      OR has_any_column_privilege(role_name,'account_security_private.reviewed_admins','INSERT,UPDATE')) THEN
    RAISE EXCEPTION 'REVIEWED_REGISTRY_MUST_BE_OPERATOR_ONLY';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(ARRAY['anon','authenticated']) AS x(role_name)
    WHERE has_table_privilege(role_name,'public.users','INSERT,UPDATE,DELETE,TRUNCATE')
      OR has_any_column_privilege(role_name,'public.users','INSERT,UPDATE')) THEN
    RAISE EXCEPTION 'LEGACY_IDENTITY_MUST_BE_IMMUTABLE';
  END IF;
  IF EXISTS (SELECT 1 FROM public.users p
    LEFT JOIN account_security_private.reviewed_roles r ON r.legacy_user_id=p.id AND r.enabled
    LEFT JOIN auth.users u ON u.id=r.auth_user_id
    WHERE r.auth_user_id IS NULL OR r.role IS DISTINCT FROM p.role
      OR u.id IS NULL OR u.deleted_at IS NOT NULL OR COALESCE(u.is_anonymous,false)
      OR (u.banned_until IS NOT NULL AND u.banned_until>statement_timestamp())) THEN
    RAISE EXCEPTION 'ALL_LEGACY_IDENTITIES_REQUIRE_OPERATOR_REVIEW';
  END IF;
  IF EXISTS (SELECT 1 FROM account_security_private.reviewed_roles
    WHERE enabled AND role NOT IN ('Admin','Owner','Sales','Foreman','Site Engineer','QC','Project Planner','Procurement','Store')) THEN
    RAISE EXCEPTION 'UNSUPPORTED_REVIEWED_ROLE';
  END IF;
  SELECT md5(string_agg(tablename||'|'||policyname||'|'||permissive||'|'||roles::text||'|'||cmd||'|'||
    coalesce(qual,'')||'|'||coalesce(with_check,''),E'\n' ORDER BY tablename,policyname))
    INTO v_hash FROM pg_policies WHERE schemaname='public'
    AND tablename IN ('plot_task_assignments','plot_task_schedules','plots','leads','sales','status_history');
  IF v_hash IS DISTINCT FROM '064c322a1ca96593ee2e9c7719e9d65e' THEN
    RAISE EXCEPTION 'AUDITED_POLICY_SNAPSHOT_CHANGED';
  END IF;
  SELECT md5(string_agg(c.relname||'|'||a.attname||'|'||format_type(a.atttypid,a.atttypmod),
    E'\n' ORDER BY c.relname,a.attnum)) INTO v_hash
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid
    WHERE n.nspname='public' AND c.relname IN ('plot_task_assignments','plot_task_schedules','plots','leads','sales','status_history')
      AND a.attnum>0 AND NOT a.attisdropped;
  IF v_hash IS DISTINCT FROM '662fac8eee5588f8a45f7c366cb1ef15' THEN
    RAISE EXCEPTION 'AUDITED_COLUMN_SNAPSHOT_CHANGED';
  END IF;
  WITH RECURSIVE deps(oid) AS (
    SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname IN ('plot_task_assignments','plot_task_schedules','plots','leads','sales','status_history')
    UNION SELECT rw.ev_class FROM deps b JOIN pg_depend d ON d.refobjid=b.oid AND d.classid='pg_rewrite'::regclass
    JOIN pg_rewrite rw ON rw.oid=d.objid JOIN pg_class v ON v.oid=rw.ev_class
    WHERE v.relkind IN ('v','m') AND rw.ev_class<>b.oid
  ) SELECT array_agg(n.nspname||'.'||c.relname ORDER BY n.nspname,c.relname)
    INTO v_views FROM deps JOIN pg_class c ON c.oid=deps.oid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE c.relkind IN ('v','m');
  IF v_views IS DISTINCT FROM ARRAY['public.vw_active_plot_task_assignments','public.vw_active_task_updates','public.vw_billing_queue','public.vw_inspection_queue','public.vw_plot_overall_status','public.vw_plot_progress','public.vw_plot_status_dashboard','public.vw_project_progress','public.vw_qc_bottlenecks','public.vw_sales_intelligence_metrics','public.vw_scurve_metrics','public.vw_task_material_requests']
    OR EXISTS (SELECT 1 FROM pg_class WHERE oid IN (SELECT unnest(v_views)::regclass)
      AND (relkind<>'v' OR reloptions IS NOT NULL)) THEN
    RAISE EXCEPTION 'AUDITED_VIEW_DEPENDENCIES_CHANGED';
  END IF;
  IF to_regprocedure('public.app_touch_current_user()') IS NOT NULL
    OR to_regprocedure('account_security_private.business_role()') IS NOT NULL
    OR to_regprocedure('account_security_private.guard_plot_fields()') IS NOT NULL THEN
    RAISE EXCEPTION 'AUTHORIZATION_DRAFT_ALREADY_PRESENT';
  END IF;
END;
$preflight$;

-- Only reviewed, live authenticated actors receive business authority.
GRANT USAGE ON SCHEMA account_security_private TO authenticated;
REVOKE ALL ON FUNCTION account_security_private.current_actor(),public.app_current_actor() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION account_security_private.current_actor(),public.app_current_actor() TO authenticated;
CREATE FUNCTION account_security_private.business_role()
RETURNS text LANGUAGE sql SECURITY INVOKER SET search_path = ''
AS $$ SELECT account_security_private.current_actor()->>'role'; $$;
REVOKE ALL ON FUNCTION account_security_private.business_role() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION account_security_private.business_role() TO authenticated;

-- Drop the exact audited set. Permissive old ALL policies would bypass new ones.
DO $replace$
DECLARE t text; p record; c record; seq text; readers text;
BEGIN
  readers := '(SELECT account_security_private.business_role()) = ANY (ARRAY[''Admin'',''Owner'',''Sales'',''Foreman'',''Site Engineer'',''QC'',''Project Planner'',''Procurement'',''Store''])';
  FOREACH t IN ARRAY ARRAY['plot_task_assignments','plot_task_schedules','plots','leads','sales','status_history'] LOOP
    FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=t LOOP
      EXECUTE format('DROP POLICY %I ON public.%I',p.policyname,t);
    END LOOP;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC,anon,authenticated',t);
    -- Table revokes do not remove independent column ACLs.
    FOR c IN SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=t LOOP
      EXECUTE format('REVOKE SELECT (%I), INSERT (%I), UPDATE (%I), REFERENCES (%I) ON TABLE public.%I FROM PUBLIC,anon,authenticated',
        c.column_name,c.column_name,c.column_name,c.column_name,t);
      seq := pg_get_serial_sequence(format('public.%I',t),c.column_name);
      IF seq IS NOT NULL THEN
        EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC,anon,authenticated',seq);
        IF t<>'plots' THEN EXECUTE format('GRANT USAGE ON SEQUENCE %s TO authenticated',seq); END IF;
      END IF;
    END LOOP;
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated',t);
    EXECUTE format('CREATE POLICY reviewed_read ON public.%I FOR SELECT TO authenticated USING (%s)',t,readers);
  END LOOP;
END;
$replace$;

-- Include nested views (vw_project_progress depends on another audited view).
-- Keep the view queries intact while making table RLS run as the caller.
DO $views$
DECLARE v text; c record;
BEGIN
  FOREACH v IN ARRAY ARRAY['public.vw_active_plot_task_assignments','public.vw_active_task_updates','public.vw_billing_queue','public.vw_inspection_queue','public.vw_plot_overall_status','public.vw_plot_progress','public.vw_plot_status_dashboard','public.vw_project_progress','public.vw_qc_bottlenecks','public.vw_sales_intelligence_metrics','public.vw_scurve_metrics','public.vw_task_material_requests'] LOOP
    EXECUTE format('ALTER VIEW %s SET (security_invoker=true)',v);
    EXECUTE format('REVOKE ALL ON %s FROM PUBLIC,anon,authenticated',v);
    FOR c IN SELECT attname FROM pg_attribute WHERE attrelid=v::regclass AND attnum>0 AND NOT attisdropped LOOP
      EXECUTE format('REVOKE SELECT (%I), INSERT (%I), UPDATE (%I), REFERENCES (%I) ON %s FROM PUBLIC,anon,authenticated',
        c.attname,c.attname,c.attname,c.attname,v);
    END LOOP;
    GRANT USAGE ON SCHEMA public TO authenticated;
    EXECUTE format('GRANT SELECT ON %s TO authenticated',v);
  END LOOP;
END;
$views$;

-- Shared team visibility is intentional. Only writer roles vary by module.
DO $writes$
DECLARE t text; writers text;
BEGIN
  FOREACH t IN ARRAY ARRAY['plot_task_assignments','plot_task_schedules','leads','sales'] LOOP
    writers := CASE t
      WHEN 'plot_task_assignments' THEN '(SELECT account_security_private.business_role()) = ANY (ARRAY[''Admin'',''Owner'',''Project Planner'',''Site Engineer'',''Foreman'',''QC'',''Procurement''])'
      WHEN 'plot_task_schedules' THEN '(SELECT account_security_private.business_role()) = ANY (ARRAY[''Admin'',''Owner'',''Project Planner'',''Site Engineer'',''Foreman'',''QC''])'
      ELSE '(SELECT account_security_private.business_role()) = ANY (ARRAY[''Admin'',''Owner'',''Sales''])' END;
    EXECUTE format('GRANT INSERT,UPDATE,DELETE ON TABLE public.%I TO authenticated',t);
    EXECUTE format('CREATE POLICY reviewed_insert ON public.%I FOR INSERT TO authenticated WITH CHECK (%s)',t,writers);
    EXECUTE format('CREATE POLICY reviewed_update ON public.%I FOR UPDATE TO authenticated USING (%s) WITH CHECK (%s)',t,writers,writers);
    EXECUTE format('CREATE POLICY reviewed_delete ON public.%I FOR DELETE TO authenticated USING (%s)',t,writers);
  END LOOP;
END;
$writes$;

GRANT INSERT ON public.status_history TO authenticated;
CREATE POLICY reviewed_insert ON public.status_history FOR INSERT TO authenticated
WITH CHECK ((SELECT account_security_private.business_role()) IN ('Admin','Owner','Sales'));

GRANT INSERT,UPDATE,DELETE ON public.plots TO authenticated;
CREATE POLICY reviewed_insert ON public.plots FOR INSERT TO authenticated
WITH CHECK ((SELECT account_security_private.business_role()) IN ('Admin','Owner','Project Planner'));
CREATE POLICY reviewed_delete ON public.plots FOR DELETE TO authenticated
USING ((SELECT account_security_private.business_role()) IN ('Admin','Owner','Project Planner'));
CREATE POLICY reviewed_update ON public.plots FOR UPDATE TO authenticated
USING ((SELECT account_security_private.business_role()) IN ('Admin','Owner','Sales','Project Planner','Site Engineer','Foreman','QC'))
WITH CHECK ((SELECT account_security_private.business_role()) IN ('Admin','Owner','Sales','Project Planner','Site Engineer','Foreman','QC'));

-- Same PostgREST DB role serves Sales and construction. RLS controls rows;
-- a fail-closed trigger separates fields and automatically denies new Sales fields.
CREATE FUNCTION account_security_private.guard_plot_fields()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $fields$
DECLARE
  v_role text;
  v_sales text[] := ARRAY['has_customer','sale_status','selling_price','highlight_color','highlight_note',
    'is_sample_house','current_tenant_name','current_tenant_phone','rental_program','monthly_rent',
    'security_deposit','accumulated_downpayment','lease_start_date','lease_end_date'];
BEGIN
  -- Operator/service processes are outside client-role policy scope.
  IF current_user<>'authenticated' THEN RETURN NEW; END IF;
  v_role := account_security_private.business_role();
  IF v_role='Sales' AND (to_jsonb(NEW)-v_sales) IS DISTINCT FROM (to_jsonb(OLD)-v_sales) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='SALES_PLOT_FIELDS_ONLY';
  ELSIF v_role NOT IN ('Admin','Owner','Sales') AND (
    NEW.id IS DISTINCT FROM OLD.id OR
    (SELECT jsonb_object_agg(k,to_jsonb(NEW)->k) FROM unnest(v_sales) k) IS DISTINCT FROM
    (SELECT jsonb_object_agg(k,to_jsonb(OLD)->k) FROM unnest(v_sales) k)) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CONSTRUCTION_PLOT_FIELDS_ONLY';
  END IF;
  RETURN NEW;
END;
$fields$;
REVOKE ALL ON FUNCTION account_security_private.guard_plot_fields() FROM PUBLIC,anon,authenticated;
-- Trigger execution does not require caller EXECUTE privileges.
-- AFTER checks the final row after all existing BEFORE triggers; rejection rolls
-- back the entire statement. Staging must verify existing side-effect triggers.
CREATE TRIGGER reviewed_plot_fields AFTER UPDATE ON public.plots
FOR EACH ROW EXECUTE FUNCTION account_security_private.guard_plot_fields();

CREATE FUNCTION account_security_private.touch_current_user(p_expected_username text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $presence$
DECLARE v_actor jsonb := account_security_private.current_actor();
BEGIN
  IF p_expected_username IS NOT NULL AND p_expected_username IS DISTINCT FROM v_actor->>'username' THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='APP_ACTOR_REQUIRED';
  END IF;
  UPDATE public.users SET last_seen_at=statement_timestamp()
  WHERE id=(v_actor->>'legacyUserId')::integer;
END;
$presence$;
REVOKE ALL ON FUNCTION account_security_private.touch_current_user(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION account_security_private.touch_current_user(text) TO authenticated;
CREATE FUNCTION public.app_touch_current_user() RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path = ''
AS $$ SELECT account_security_private.touch_current_user(NULL); $$;
CREATE OR REPLACE FUNCTION public.update_user_last_seen(p_username text) RETURNS void
LANGUAGE sql SECURITY INVOKER SET search_path = ''
AS $$ SELECT account_security_private.touch_current_user(p_username); $$;
REVOKE ALL ON FUNCTION public.app_touch_current_user(),public.update_user_last_seen(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.app_touch_current_user(),public.update_user_last_seen(text) TO authenticated;
ROLLBACK;
