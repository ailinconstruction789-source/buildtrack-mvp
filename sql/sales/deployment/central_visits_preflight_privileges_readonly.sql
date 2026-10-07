-- Read-only extension of the Visit preflight: catalogs only, no customer rows.
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout='15s';
WITH target AS (
 SELECT p.*, n.nspname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE p.oid=ANY(ARRAY['crm_external_private.booking_activation_allowed(jsonb)'::regprocedure,'crm_external_private.booking_interest_allowed(jsonb,jsonb)'::regprocedure,'crm_external_private.booking_writer_ready()'::regprocedure,'crm_external_private.cutover_operator_check()'::regprocedure,'crm_external_private.guard_booking_plot_stock()'::regprocedure,'crm_external_private.guard_materialized_history()'::regprocedure,'crm_external_private.reject_unreviewed_activation()'::regprocedure,'crm_v2_booking_capabilities()'::regprocedure,'crm_v2_booking_command(uuid,jsonb)'::regprocedure,'crm_v2_booking_context(uuid,integer)'::regprocedure,'crm_v2_change_lead_lifecycle(uuid,jsonb)'::regprocedure,'crm_v2_lead_work_snapshot(uuid,uuid)'::regprocedure,'crm_v2_project_sales_capabilities()'::regprocedure,'crm_v2_project_sales(text,text,text,integer)'::regprocedure,'crm_v2_record_lead_work(uuid,jsonb)'::regprocedure,'crm_v2_role()'::regprocedure,'sales_private.reject_sealed_legacy_fields()'::regprocedure])
), callers AS (
 SELECT oid,rolname,rolsuper,rolbypassrls,rolinherit FROM pg_roles
 WHERE rolname IN ('anon','authenticated','service_role','authenticator')
)
SELECT jsonb_build_object(
 'functions',(SELECT jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'source',p.prosrc,
 'language',(SELECT lanname FROM pg_language WHERE oid=p.prolang)) ORDER BY p.oid::regprocedure::text) FROM target p),
 'effectiveExecute',(SELECT jsonb_agg(jsonb_build_object('role',r.rolname,'signature',p.oid::regprocedure::text,
 'execute',has_function_privilege(r.oid,p.oid,'EXECUTE'),'schemaUsage',has_schema_privilege(r.oid,p.pronamespace,'USAGE'))
 ORDER BY r.rolname,p.oid::regprocedure::text) FROM callers r CROSS JOIN target p),
 'roles',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.rolname) FROM callers r),
 'memberships',(SELECT coalesce(jsonb_agg(jsonb_build_object('member',pg_get_userbyid(m.member),'grantedRole',pg_get_userbyid(m.roleid),
 'inherit',m.inherit_option,'set',m.set_option)),'[]'::jsonb) FROM pg_auth_members m
 WHERE m.member IN (SELECT oid FROM callers) OR m.roleid IN (SELECT oid FROM callers)),
 'voicePrivileges',(SELECT jsonb_agg(jsonb_build_object('role',r.rolname,
 'select',has_table_privilege(r.oid,'public.customer_voices','SELECT'),
 'insert',has_table_privilege(r.oid,'public.customer_voices','INSERT'),
 'update',has_table_privilege(r.oid,'public.customer_voices','UPDATE'),
 'delete',has_table_privilege(r.oid,'public.customer_voices','DELETE'))) FROM callers r),
 'voicePolicyRoles',(SELECT jsonb_agg(jsonb_build_object('policy',p.polname,'role',
 CASE WHEN x.roleid=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.roleid) END))
 FROM pg_policy p CROSS JOIN LATERAL unnest(p.polroles) x(roleid)
 WHERE p.polrelid='public.customer_voices'::regclass)
) AS supplemental_metadata;
ROLLBACK;

