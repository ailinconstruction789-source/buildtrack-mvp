-- SALES V2 / STEP 1: READ-ONLY CATALOG REPORT. Run manually in Supabase SQL Editor.
-- This file contains only a SELECT with CTEs: no migration, no data writes.
-- Return the report for review BEFORE preparing any deployable migration.
-- Contains schema metadata, not customer rows, phone numbers, PINs or JWTs.
WITH target_names(name) AS (VALUES
  ('projects'),('plots'),('leads'),('sales'),('customer_voices'),('status_history'),
  ('house_visit_checklists'),('sales_customers'),('lead_project_interests'),
  ('crm_duplicate_reviews'),('lead_appointments'),('lead_visits'),
  ('house_visit_checklist_runs'),('house_visit_checklist_items'),('sale_plot_changes'),
  ('loan_attempts'),('lead_activities'),('crm_audit_events'),('crm_settings'),
  ('crm_work_periods'),('crm_sla_tasks'),('crm_sla_exceptions'),('crm_notifications'),
  ('sales_reason_catalog'),('crm_import_batches'),('crm_legacy_lead_links'),('crm_import_rows')
), relations AS (
  SELECT c.oid, n.nspname AS schema_name, c.relname AS table_name,
    c.relkind, c.relrowsecurity, c.relforcerowsecurity
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE (n.nspname = 'public' AND c.relname IN (SELECT name FROM target_names))
     OR (n.nspname = 'sales_private' AND c.relname IN ('crm_user_roles','visit_submission_tokens','central_command_requests','crm_legacy_source_snapshots'))
), columns_report AS (
  SELECT r.schema_name, r.table_name, a.attname AS column_name,
    pg_catalog.format_type(a.atttypid,a.atttypmod) AS column_type,
    a.attnotnull AS not_null, a.attidentity AS identity_kind, a.attgenerated AS generated_kind,
    pg_catalog.pg_get_expr(d.adbin,d.adrelid) AS default_expression
  FROM relations r
  JOIN pg_catalog.pg_attribute a ON a.attrelid=r.oid AND a.attnum>0 AND NOT a.attisdropped
  LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
), constraints_report AS (
  SELECT n.nspname AS schema_name, c.relname AS table_name, co.conname AS constraint_name,
    co.contype AS constraint_type, co.convalidated AS validated,
    pg_catalog.pg_get_constraintdef(co.oid,true) AS definition
  FROM pg_catalog.pg_constraint co
  JOIN pg_catalog.pg_class c ON c.oid=co.conrelid
  JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  WHERE co.conrelid IN (SELECT oid FROM relations) OR co.confrelid IN (SELECT oid FROM relations)
), indexes_report AS (
  SELECT r.schema_name, r.table_name, i.relname AS index_name,
    x.indisvalid AS valid, x.indisunique AS is_unique,
    pg_catalog.pg_get_indexdef(x.indexrelid) AS definition
  FROM relations r
  JOIN pg_catalog.pg_index x ON x.indrelid=r.oid
  JOIN pg_catalog.pg_class i ON i.oid=x.indexrelid
), triggers_report AS (
  SELECT r.schema_name, r.table_name, t.tgname AS trigger_name, t.tgenabled AS enabled,
    pg_catalog.pg_get_triggerdef(t.oid,true) AS definition,
    p.oid::regprocedure::text AS function_signature, p.prosecdef AS security_definer,
    p.proconfig AS function_settings, md5(p.prosrc) AS function_body_hash,
    (p.prosrc ILIKE '%crm_stage%') AS mentions_crm_stage,
    (p.prosrc ILIKE '%contract_status%') AS mentions_contract_status,
    (p.prosrc ILIKE '%has_customer%') AS mentions_has_customer,
    (p.prosrc ILIKE '%user_metadata%') AS mentions_user_metadata
  FROM relations r JOIN pg_catalog.pg_trigger t ON t.tgrelid=r.oid AND NOT t.tgisinternal
  JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid
), policies_report AS (
  SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
  FROM pg_catalog.pg_policies
  WHERE (schemaname='public' AND tablename IN (SELECT name FROM target_names))
     OR schemaname='sales_private'
), functions_report AS (
  SELECT n.nspname AS schema_name, p.proname AS function_name,
    pg_catalog.pg_get_function_identity_arguments(p.oid) AS identity_arguments,
    pg_catalog.pg_get_function_result(p.oid) AS return_type,
    p.prosecdef AS security_definer, p.proconfig AS function_settings,
    p.proacl::text AS access_control, md5(p.prosrc) AS function_body_hash
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='sales_private'
    OR (n.nspname='public' AND (p.proname LIKE 'crm_%' OR p.proname LIKE 'sales_v2_%'
      OR p.proname IN ('sync_plot_customer_status','update_sales_updated_at_column')))
), grants_report AS (
  SELECT table_schema, table_name, grantee, privilege_type
  FROM information_schema.role_table_grants
  WHERE (table_schema='public' AND table_name IN (SELECT name FROM target_names))
     OR table_schema='sales_private'
)
SELECT jsonb_pretty(jsonb_build_object(
  'report_version','sales-v2-preflight-2026-09-15',
  'database_version',current_setting('server_version'),
  'generated_at',CURRENT_TIMESTAMP,
  'missing_legacy_tables',COALESCE((SELECT jsonb_agg(name ORDER BY name) FROM target_names
    WHERE name IN ('projects','plots','leads','sales','customer_voices')
      AND NOT EXISTS (SELECT 1 FROM relations r WHERE r.schema_name='public' AND r.table_name=name)), '[]'::jsonb),
  'existing_relations',COALESCE((SELECT jsonb_agg(to_jsonb(r)-'oid' ORDER BY schema_name,table_name) FROM relations r),'[]'::jsonb),
  'columns',COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY schema_name,table_name,column_name) FROM columns_report c),'[]'::jsonb),
  'constraints_including_inbound',COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY schema_name,table_name,constraint_name) FROM constraints_report c),'[]'::jsonb),
  'indexes',COALESCE((SELECT jsonb_agg(to_jsonb(i) ORDER BY schema_name,table_name,index_name) FROM indexes_report i),'[]'::jsonb),
  'triggers',COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY schema_name,table_name,trigger_name) FROM triggers_report t),'[]'::jsonb),
  'policies',COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY schemaname,tablename,policyname) FROM policies_report p),'[]'::jsonb),
  'functions',COALESCE((SELECT jsonb_agg(to_jsonb(f) ORDER BY schema_name,function_name,identity_arguments) FROM functions_report f),'[]'::jsonb),
  'visible_grants',COALESCE((SELECT jsonb_agg(to_jsonb(g) ORDER BY table_schema,table_name,grantee,privilege_type) FROM grants_report g),'[]'::jsonb)
)) AS preflight_report;
