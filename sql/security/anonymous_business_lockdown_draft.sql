-- REVIEW DRAFT ONLY: close direct anonymous access to audited tables and views.
-- Independent from trusted-role cutover: no identity mapping or auth flag change.
-- No query definitions/policies/business data changes. Authenticated effective
-- table/column privileges are checked before/after; any difference rolls back.
-- Operator must review staging results and wider public RPC/table access first.
BEGIN;
DO $draft_only$
BEGIN
  RAISE EXCEPTION 'DESIGN ONLY: anonymous lockdown requires reviewed execution approval';
END;
$draft_only$;

DO $preflight$
DECLARE v text;
BEGIN
  FOREACH v IN ARRAY ARRAY['public.plot_task_assignments','public.plot_task_schedules','public.plots','public.leads','public.sales','public.status_history','public.vw_active_plot_task_assignments','public.vw_active_task_updates','public.vw_billing_queue','public.vw_inspection_queue','public.vw_plot_overall_status','public.vw_plot_progress','public.vw_plot_status_dashboard','public.vw_project_progress','public.vw_qc_bottlenecks','public.vw_sales_intelligence_metrics','public.vw_scurve_metrics','public.vw_task_material_requests'] LOOP
    IF to_regclass(v) IS NULL THEN RAISE EXCEPTION 'AUDITED_RELATION_MISSING: %',v; END IF;
  END LOOP;
END;
$preflight$;

CREATE TEMP TABLE anon_lockdown_auth_before ON COMMIT DROP AS
SELECT c.oid AS object_id,0::smallint AS column_id,p.privilege,
  has_table_privilege('authenticated',c.oid,p.privilege) AS allowed
FROM pg_class c CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) p(privilege)
WHERE c.oid IN (SELECT unnest(ARRAY['public.plot_task_assignments','public.plot_task_schedules','public.plots','public.leads','public.sales','public.status_history','public.vw_active_plot_task_assignments','public.vw_active_task_updates','public.vw_billing_queue','public.vw_inspection_queue','public.vw_plot_overall_status','public.vw_plot_progress','public.vw_plot_status_dashboard','public.vw_project_progress','public.vw_qc_bottlenecks','public.vw_sales_intelligence_metrics','public.vw_scurve_metrics','public.vw_task_material_requests'])::regclass)
UNION ALL
SELECT c.oid,a.attnum,p.privilege,has_column_privilege('authenticated',c.oid,a.attnum,p.privilege)
FROM pg_class c JOIN pg_attribute a ON a.attrelid=c.oid
CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) p(privilege)
WHERE c.oid IN (SELECT unnest(ARRAY['public.plot_task_assignments','public.plot_task_schedules','public.plots','public.leads','public.sales','public.status_history','public.vw_active_plot_task_assignments','public.vw_active_task_updates','public.vw_billing_queue','public.vw_inspection_queue','public.vw_plot_overall_status','public.vw_plot_progress','public.vw_plot_status_dashboard','public.vw_project_progress','public.vw_qc_bottlenecks','public.vw_sales_intelligence_metrics','public.vw_scurve_metrics','public.vw_task_material_requests'])::regclass) AND a.attnum>0 AND NOT a.attisdropped;

DO $lockdown$
DECLARE v text; c record;
BEGIN
  FOREACH v IN ARRAY ARRAY['public.plot_task_assignments','public.plot_task_schedules','public.plots','public.leads','public.sales','public.status_history','public.vw_active_plot_task_assignments','public.vw_active_task_updates','public.vw_billing_queue','public.vw_inspection_queue','public.vw_plot_overall_status','public.vw_plot_progress','public.vw_plot_status_dashboard','public.vw_project_progress','public.vw_qc_bottlenecks','public.vw_sales_intelligence_metrics','public.vw_scurve_metrics','public.vw_task_material_requests'] LOOP
    EXECUTE format('REVOKE ALL ON TABLE %s FROM PUBLIC,anon',v);
    FOR c IN SELECT attname FROM pg_attribute WHERE attrelid=v::regclass AND attnum>0 AND NOT attisdropped LOOP
      EXECUTE format('REVOKE SELECT (%I), INSERT (%I), UPDATE (%I), REFERENCES (%I) ON TABLE %s FROM PUBLIC,anon',
        c.attname,c.attname,c.attname,c.attname,v);
    END LOOP;
    IF has_table_privilege('anon',v,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
      OR has_any_column_privilege('anon',v,'SELECT,INSERT,UPDATE,REFERENCES') THEN
      RAISE EXCEPTION 'ANONYMOUS_INHERITED_PRIVILEGE_REMAINS: %',v;
    END IF;
  END LOOP;
END;
$lockdown$;

DO $preserve_authenticated$
DECLARE r record; v_after boolean;
BEGIN
  FOR r IN SELECT * FROM pg_temp.anon_lockdown_auth_before LOOP
    IF r.column_id=0 THEN v_after:=has_table_privilege('authenticated',r.object_id,r.privilege);
    ELSE v_after:=has_column_privilege('authenticated',r.object_id,r.column_id,r.privilege); END IF;
    IF v_after IS DISTINCT FROM r.allowed THEN
      RAISE EXCEPTION 'AUTHENTICATED_PRIVILEGE_CHANGED: %',r.object_id::regclass;
    END IF;
  END LOOP;
END;
$preserve_authenticated$;
ROLLBACK;
