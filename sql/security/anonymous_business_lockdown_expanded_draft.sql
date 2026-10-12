-- DESIGN ONLY: expanded anonymous ACL closure, not a trusted-role cutover.
-- 11 base tables + 12 exact views; two exact bulk completion RPC signatures.
-- Preserves effective authenticated/service_role privileges, policies, function
-- bodies and public token flows. Reviewed construction identity binding and
-- caller-supplied audit identity fixes remain separate, default-off work.
BEGIN;
DO $draft_only$
BEGIN
  RAISE EXCEPTION 'DESIGN ONLY: expanded anonymous lockdown requires reviewed execution approval';
END;
$draft_only$;

CREATE TEMP TABLE anon_expanded_scope(name text PRIMARY KEY,kind text,owner_name text,rls boolean,columns_json jsonb,view_hash text,view_options jsonb) ON COMMIT DROP;
INSERT INTO anon_expanded_scope VALUES
('public.defects','r','postgres',true,'[["id","uuid"],["plot_id","text"],["task_id","text"],["description","text"],["status","text"],["reported_by","text"],["image_url","text"],["created_at","timestamp with time zone"],["resolved_at","timestamp with time zone"],["defect_stage","text"],["handover_cycle","integer"],["inspection_round","integer"],["task_template_id","uuid"],["planned_start","date"],["planned_end","date"],["contractor_id","bigint"],["progress","integer"],["actual_start","timestamp with time zone"],["actual_end","timestamp with time zone"]]'::jsonb,NULL,'null'::jsonb),
('public.leads','r','postgres',true,'[["id","uuid"],["project_name","character varying"],["customer_name","character varying"],["phone","character varying"],["occupation","character varying"],["interest","character varying"],["source","character varying"],["status","character varying"],["agent_name","character varying"],["created_at","timestamp with time zone"],["updated_at","timestamp with time zone"],["channel","character varying"],["lead_date","timestamp with time zone"],["contacted_date","timestamp with time zone"],["appointment_date","timestamp with time zone"],["actual_visit_date","timestamp with time zone"],["follow_up_count","integer"],["last_follow_up_date","timestamp with time zone"],["interested_plot_id","character varying"],["interested_plot_name","character varying"],["booking_date","timestamp with time zone"],["booking_amount","numeric(15,2)"],["loan_submission_date","timestamp with time zone"],["loan_approved_date","timestamp with time zone"],["transferred_date","timestamp with time zone"],["lost_reason","character varying"],["lost_reason_detail","text"],["crm_status","character varying"],["auto_status","character varying"],["notes","text"],["created_by_agent","character varying"],["closing_agent","character varying"],["deal_type","character varying"],["rental_program","character varying"],["rental_monthly_rent","numeric(15,2)"],["rental_deposit","numeric(15,2)"],["rental_savings_per_month","numeric(15,2)"],["rental_accumulated_savings","numeric(15,2)"],["rental_base_price","numeric(15,2)"],["rental_start_date","date"],["rental_end_date","date"],["rental_status","character varying"],["active_rental_contract_id","uuid"]]'::jsonb,NULL,'null'::jsonb),
('public.plot_task_assignments','r','postgres',true,'[["id","bigint"],["plot_id","text"],["contractor_name","text"],["contractor_phone","text"],["created_at","timestamp without time zone"],["task_template_id","uuid"],["current_progress","integer"],["actual_start_date","timestamp with time zone"],["actual_end_date","timestamp with time zone"],["latest_action","text"],["latest_role","text"],["latest_update_created_at","timestamp with time zone"],["is_excluded","boolean"],["billing_status","character varying(50)"],["billed_at","timestamp with time zone"],["billed_by","character varying(255)"],["billing_ref","character varying(255)"]]'::jsonb,NULL,'null'::jsonb),
('public.plot_task_schedules','r','postgres',true,'[["id","bigint"],["created_at","timestamp with time zone"],["plot_id","text"],["task_template_id","uuid"],["planned_start","date"],["planned_end","date"]]'::jsonb,NULL,'null'::jsonb),
('public.plots','r','postgres',true,'[["id","text"],["house_type_id","uuid"],["foreman_name","text"],["project_name","text"],["created_at","timestamp with time zone"],["has_customer","boolean"],["is_completed","boolean"],["overview_image_url","text"],["sale_status","character varying"],["paused_for_sale_at","timestamp with time zone"],["selling_price","numeric"],["handover_cycle","integer"],["inspection_round","integer"],["plot_name","text"],["land_size","numeric"],["house_model","text"],["land_appraisal_price","numeric"],["highlight_color","text"],["highlight_note","text"],["permit_status","character varying"],["registration_status","character varying"],["water_meter_status","character varying"],["electric_meter_status","character varying"],["permit_date","date"],["registration_date","date"],["water_meter_date","date"],["electric_meter_date","date"],["handover_status","text"],["handover_completed_at","timestamp with time zone"],["handover_completed_by","text"],["inspection_round1_date","timestamp with time zone"],["inspection_round1_status","text"],["inspection_round2_date","timestamp with time zone"],["inspection_round2_status","text"],["handover_notes","text"],["is_sample_house","boolean"],["current_tenant_name","character varying"],["current_tenant_phone","character varying"],["rental_program","character varying"],["monthly_rent","numeric(15,2)"],["security_deposit","numeric(15,2)"],["accumulated_downpayment","numeric(15,2)"],["lease_start_date","date"],["lease_end_date","date"],["water_meter_image_url","text"],["water_meter_installed_date","timestamp with time zone"],["water_meter_meter_no","text"],["electric_meter_image_url","text"],["electric_meter_installed_date","timestamp with time zone"],["electric_meter_meter_no","text"]]'::jsonb,NULL,'null'::jsonb),
('public.projects','r','postgres',true,'[["name","text"],["created_at","timestamp with time zone"],["layout_data","jsonb"],["is_closed","boolean"]]'::jsonb,NULL,'null'::jsonb),
('public.sales','r','postgres',true,'[["id","uuid"],["lead_id","uuid"],["plot_id","text"],["sale_price","numeric(15,2)"],["booking_amount","numeric(15,2)"],["land_office_price","numeric(15,2)"],["bank_name","character varying"],["contract_status","character varying"],["bank_status","character varying"],["cancellation_reason","character varying"],["transferred_at","timestamp with time zone"],["created_at","timestamp with time zone"],["updated_at","timestamp with time zone"],["expected_transfer_date","date"],["project_interest_id","uuid"],["booking_round","integer"],["previous_sale_id","uuid"],["crm_stage","text"],["payment_method","text"],["booking_route","text"],["booking_route_reason","text"],["list_price","numeric(15,2)"],["discount_amount","numeric(15,2)"],["booked_at","timestamp with time zone"],["contracted_at","timestamp with time zone"],["crm_handover_at","timestamp with time zone"],["cancelled_at","timestamp with time zone"],["legacy_cancellation_batch_id","uuid"],["cancellation_category","text"],["closing_sales_user_id","uuid"],["external_booking_id","uuid"],["external_source_stage","text"],["booking_revision","uuid"],["booking_visit_id","uuid"]]'::jsonb,NULL,'null'::jsonb),
('public.status_history','r','postgres',true,'[["id","uuid"],["entity_type","character varying"],["entity_id","uuid"],["old_status","character varying"],["new_status","character varying"],["changed_by","character varying"],["created_at","timestamp with time zone"]]'::jsonb,NULL,'null'::jsonb),
('public.task_material_requests','r','postgres',true,'[["id","uuid"],["plot_id","text"],["task_template_id","uuid"],["status","text"],["notes","text"],["requested_by","text"],["requested_at","timestamp with time zone"],["expected_date","timestamp with time zone"],["updated_by","text"],["updated_at","timestamp with time zone"],["image_url","text"],["pr_number","text"],["delivery_mode","text"],["material_type","text"],["extra_reason","text"]]'::jsonb,NULL,'null'::jsonb),
('public.task_templates','r','postgres',true,'[["id","uuid"],["house_type_id","uuid"],["task_name","text"],["task_order","integer"],["created_at","timestamp with time zone"],["weight","double precision"],["cost","numeric"],["is_progress_counted","boolean"]]'::jsonb,NULL,'null'::jsonb),
('public.task_updates','r','postgres',true,'[["id","uuid"],["plot_id","text"],["task_template_id","uuid"],["user_name","text"],["role","text"],["action","text"],["text_content","text"],["progress","integer"],["image_url","text"],["created_at","timestamp with time zone"],["is_defect","boolean"],["defect_status","text"],["weather_info","text"],["is_completed","boolean"],["is_silent","boolean"],["is_worker_present","boolean"]]'::jsonb,NULL,'null'::jsonb),
('public.vw_active_plot_task_assignments','v','postgres',false,'null'::jsonb,'773ddadcef08f53e9added5a10d16283','null'::jsonb),
('public.vw_active_task_updates','v','postgres',false,'null'::jsonb,'5cba12300eeb26417131d05ebdbec7ce','null'::jsonb),
('public.vw_billing_queue','v','postgres',false,'null'::jsonb,'7bcc1cf31f817b67130b31e5d0c821fd','null'::jsonb),
('public.vw_inspection_queue','v','postgres',false,'null'::jsonb,'134752603a4b48b043eeceed4ac2a9b7','null'::jsonb),
('public.vw_plot_overall_status','v','postgres',false,'null'::jsonb,'c962ac0ce4aedf35980a48083b7ace73','null'::jsonb),
('public.vw_plot_progress','v','postgres',false,'null'::jsonb,'367dc8d01642db23471135c14990bf75','null'::jsonb),
('public.vw_plot_status_dashboard','v','postgres',false,'null'::jsonb,'47b6003ad179104a39321ec352ee88da','null'::jsonb),
('public.vw_project_progress','v','postgres',false,'null'::jsonb,'55ce34db49745da9e59963b377c0ae47','null'::jsonb),
('public.vw_qc_bottlenecks','v','postgres',false,'null'::jsonb,'d5007ab8c671d42fa462da25a05ea217','null'::jsonb),
('public.vw_sales_intelligence_metrics','v','postgres',false,'null'::jsonb,'fe2f03d09357794989513d260be6ad65','null'::jsonb),
('public.vw_scurve_metrics','v','postgres',false,'null'::jsonb,'5c1e1f614a0b889d0d8eebd71ef2801b','null'::jsonb),
('public.vw_task_material_requests','v','postgres',false,'null'::jsonb,'60ca28e97d8054545b31aa61f86ba75b','null'::jsonb);
CREATE TEMP TABLE anon_expanded_rpc(signature text PRIMARY KEY,owner_name text,definition_hash text) ON COMMIT DROP;
INSERT INTO anon_expanded_rpc VALUES
('public.bulk_mark_plot_completed(character varying,character varying,character varying)','postgres','391bce4efc14ebcdf2bb4f9f01012ccc'),
('public.bulk_mark_project_completed(character varying,character varying,character varying)','postgres','ac598fd63853ad0f46cab4165229576e');

DO $preflight$
DECLARE r record; c record; p record; actual_columns jsonb;
BEGIN
  IF to_regrole('anon') IS NULL OR to_regrole('authenticated') IS NULL OR to_regrole('service_role') IS NULL THEN RAISE EXCEPTION 'AUDITED_ROLES_MISSING'; END IF;
  FOR r IN SELECT * FROM pg_temp.anon_expanded_scope LOOP
    SELECT * INTO c FROM pg_class WHERE oid=to_regclass(r.name);
    IF NOT FOUND THEN RAISE EXCEPTION 'AUDITED_RELATION_MISSING: %',r.name; END IF;
    IF c.relkind::text IS DISTINCT FROM r.kind OR pg_get_userbyid(c.relowner)::text IS DISTINCT FROM r.owner_name
      OR c.relrowsecurity IS DISTINCT FROM r.rls THEN RAISE EXCEPTION 'AUDITED_RELATION_DRIFT: %',r.name; END IF;
    IF r.kind='v' THEN
      IF md5(pg_get_viewdef(c.oid,true)) IS DISTINCT FROM r.view_hash OR coalesce(to_jsonb(c.reloptions),'null'::jsonb) IS DISTINCT FROM r.view_options
        THEN RAISE EXCEPTION 'AUDITED_VIEW_DRIFT: %',r.name; END IF;
    ELSE
      SELECT jsonb_agg(jsonb_build_array(attname,format_type(atttypid,atttypmod)) ORDER BY attnum) INTO actual_columns FROM pg_attribute WHERE attrelid=c.oid AND attnum>0 AND NOT attisdropped;
      IF actual_columns IS DISTINCT FROM r.columns_json THEN RAISE EXCEPTION 'AUDITED_COLUMNS_DRIFT: %',r.name; END IF;
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM pg_temp.anon_expanded_rpc LOOP
    SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure(r.signature);
    IF NOT FOUND THEN RAISE EXCEPTION 'AUDITED_RPC_MISSING: %',r.signature; END IF;
    IF p.prokind<>'f' OR p.prosecdef OR pg_get_userbyid(p.proowner)::text IS DISTINCT FROM r.owner_name OR md5(pg_get_functiondef(p.oid)) IS DISTINCT FROM r.definition_hash
      THEN RAISE EXCEPTION 'AUDITED_RPC_DRIFT: %',r.signature; END IF;
    IF (SELECT count(*) FROM pg_proc sibling WHERE sibling.pronamespace=p.pronamespace AND sibling.proname=p.proname)<>1
      THEN RAISE EXCEPTION 'AUDITED_RPC_OVERLOAD_DRIFT: %',r.signature; END IF;
  END LOOP;
END;
$preflight$;

CREATE TEMP TABLE anon_expanded_priv_before ON COMMIT DROP AS
SELECT role_name,c.oid object_id,0::smallint column_id,p.privilege,has_table_privilege(role_name,c.oid,p.privilege) allowed
FROM pg_temp.anon_expanded_scope s JOIN pg_class c ON c.oid=to_regclass(s.name)
CROSS JOIN unnest(ARRAY['authenticated','service_role']) role_name
CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) base(privilege)
CROSS JOIN LATERAL unnest(ARRAY[base.privilege,base.privilege||' WITH GRANT OPTION']) p(privilege)
UNION ALL
SELECT role_name,c.oid,a.attnum,p.privilege,has_column_privilege(role_name,c.oid,a.attnum,p.privilege)
FROM pg_temp.anon_expanded_scope s JOIN pg_class c ON c.oid=to_regclass(s.name) JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
CROSS JOIN unnest(ARRAY['authenticated','service_role']) role_name
CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) base(privilege)
CROSS JOIN LATERAL unnest(ARRAY[base.privilege,base.privilege||' WITH GRANT OPTION']) p(privilege);
CREATE TEMP TABLE anon_expanded_rpc_before ON COMMIT DROP AS
SELECT role_name,to_regprocedure(signature)::oid object_id,has_function_privilege(role_name,to_regprocedure(signature),'EXECUTE') allowed,
has_function_privilege(role_name,to_regprocedure(signature),'EXECUTE WITH GRANT OPTION') grant_allowed
FROM pg_temp.anon_expanded_rpc CROSS JOIN unnest(ARRAY['authenticated','service_role']) role_name;
CREATE TEMP TABLE anon_expanded_functions_before ON COMMIT DROP AS
SELECT p.oid,md5(pg_get_functiondef(p.oid)) definition_hash,p.proacl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE p.prokind='f' AND n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema';
CREATE TEMP TABLE anon_expanded_policies_before ON COMMIT DROP AS
SELECT p.* FROM pg_policies p JOIN pg_temp.anon_expanded_scope s ON s.name=p.schemaname||'.'||p.tablename;

DO $lockdown$
DECLARE r record; a record;
BEGIN
  FOR r IN SELECT name FROM pg_temp.anon_expanded_scope LOOP
    EXECUTE format('REVOKE ALL ON TABLE %s FROM PUBLIC,anon RESTRICT',r.name);
    FOR a IN SELECT attname FROM pg_attribute WHERE attrelid=to_regclass(r.name) AND attnum>0 AND NOT attisdropped LOOP
      EXECUTE format('REVOKE SELECT (%I), INSERT (%I), UPDATE (%I), REFERENCES (%I) ON TABLE %s FROM PUBLIC,anon RESTRICT',a.attname,a.attname,a.attname,a.attname,r.name);
    END LOOP;
    IF has_table_privilege('anon',r.name,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') OR has_any_column_privilege('anon',r.name,'SELECT,INSERT,UPDATE,REFERENCES')
      THEN RAISE EXCEPTION 'ANONYMOUS_INHERITED_PRIVILEGE_REMAINS: %',r.name; END IF;
  END LOOP;
  -- Preserve PUBLIC-derived effective EXECUTE without broadening a denied role.
  FOR r IN SELECT * FROM pg_temp.anon_expanded_rpc_before WHERE allowed LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %I%s',r.object_id::regprocedure,r.role_name,CASE WHEN r.grant_allowed THEN ' WITH GRANT OPTION' ELSE '' END);
  END LOOP;
  FOR r IN SELECT signature FROM pg_temp.anon_expanded_rpc LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC,anon RESTRICT',r.signature);
    IF has_function_privilege('anon',to_regprocedure(r.signature),'EXECUTE') THEN RAISE EXCEPTION 'ANONYMOUS_RPC_EXECUTE_REMAINS: %',r.signature; END IF;
  END LOOP;
END;
$lockdown$;

DO $preserve$
DECLARE r record; after_allowed boolean;
BEGIN
  FOR r IN SELECT * FROM pg_temp.anon_expanded_priv_before LOOP
    IF r.column_id=0 THEN after_allowed:=has_table_privilege(r.role_name,r.object_id,r.privilege);
    ELSE after_allowed:=has_column_privilege(r.role_name,r.object_id,r.column_id,r.privilege); END IF;
    IF after_allowed IS DISTINCT FROM r.allowed THEN RAISE EXCEPTION 'PROTECTED_PRIVILEGE_CHANGED: % %',r.role_name,r.object_id::regclass; END IF;
  END LOOP;
  FOR r IN SELECT * FROM pg_temp.anon_expanded_rpc_before LOOP
    IF has_function_privilege(r.role_name,r.object_id,'EXECUTE') IS DISTINCT FROM r.allowed OR has_function_privilege(r.role_name,r.object_id,'EXECUTE WITH GRANT OPTION') IS DISTINCT FROM r.grant_allowed
      THEN RAISE EXCEPTION 'PROTECTED_RPC_EXECUTE_CHANGED: % %',r.role_name,r.object_id::regprocedure; END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM pg_temp.anon_expanded_functions_before b LEFT JOIN pg_proc p ON p.oid=b.oid WHERE p.oid IS NULL OR md5(pg_get_functiondef(p.oid)) IS DISTINCT FROM b.definition_hash
    OR (NOT EXISTS(SELECT 1 FROM pg_temp.anon_expanded_rpc audited_rpc WHERE to_regprocedure(audited_rpc.signature)=b.oid) AND p.proacl IS DISTINCT FROM b.proacl)) THEN RAISE EXCEPTION 'UNRELATED_FUNCTION_CHANGED'; END IF;
  IF EXISTS((SELECT * FROM pg_temp.anon_expanded_policies_before EXCEPT SELECT p.* FROM pg_policies p JOIN pg_temp.anon_expanded_scope s ON s.name=p.schemaname||'.'||p.tablename)
    UNION ALL (SELECT p.* FROM pg_policies p JOIN pg_temp.anon_expanded_scope s ON s.name=p.schemaname||'.'||p.tablename EXCEPT SELECT * FROM pg_temp.anon_expanded_policies_before)) THEN RAISE EXCEPTION 'BUSINESS_POLICY_CHANGED'; END IF;
END;
$preserve$;
ROLLBACK;
