-- CATALOG INSPECTION ONLY. Not a migration, approval, or complete security audit.
-- No customer/account rows, credentials, function bodies or policy expressions
-- are returned. Object names/hashes/ACLs still belong to an internal report.
-- Run only on an explicitly approved target. This file never installs anything.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '2s';
WITH
expected_relations(name) AS (VALUES
  ('public.users'),('auth.users'),('auth.sessions'),('sales_private.crm_user_roles'),
  ('account_security_private.reviewed_admins'),('account_security_private.reviewed_roles'),
  ('account_security_private.role_review_events'),('account_security_private.crm_auth_suspensions'),
  ('account_security_private.sales_restore_receipts')),
relations AS (
  SELECT e.name,c.oid,c.relkind,c.relowner,c.relrowsecurity,c.relforcerowsecurity
  FROM expected_relations e LEFT JOIN pg_catalog.pg_class c ON c.oid=pg_catalog.to_regclass(e.name)
),
roles AS (SELECT oid,rolname FROM pg_catalog.pg_roles WHERE rolname IN
  ('anon','authenticated','service_role','supabase_auth_admin','buildtrack_sales_sla_worker','buildtrack_sales_sla_dispatcher')),
expected_functions(schema_name,function_name,argument_types) AS (VALUES
  ('public','admin_create_user','text, text'),('public','admin_delete_user','text'),
  ('public','admin_change_username','text, text'),('public','admin_change_user_password','text, text'),
  ('public','update_user_last_seen','text'),('public','app_touch_current_user',''),
  ('public','app_current_actor',''),('public','crm_v2_role',''),
  ('public','app_sales_account_access','integer, text, text'),
  ('public','app_restore_sales_account_access','uuid, uuid, uuid, bigint, text, text, boolean')),
functions AS (
  SELECT p.*,n.nspname,l.lanname FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
  JOIN pg_catalog.pg_language l ON l.oid=p.prolang
  WHERE p.prokind='f' AND (n.nspname='account_security_private'
    OR EXISTS(SELECT 1 FROM expected_functions e WHERE e.schema_name=n.nspname AND e.function_name=p.proname))
),
columns AS (
  SELECT r.name,a.attname,a.attnum,a.atttypid,a.atttypmod,a.attnotnull,a.attrelid,d.adbin,d.adrelid
  FROM relations r JOIN pg_catalog.pg_attribute a ON a.attrelid=r.oid AND a.attnum>0 AND NOT a.attisdropped
  LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
),
expected_base_columns(relation_name,column_name) AS (VALUES
  ('public.users','id'),('public.users','username'),('public.users','role'),('public.users','last_seen_at'),
  ('auth.users','id'),('auth.users','email'),('auth.users','deleted_at'),('auth.users','banned_until'),('auth.users','is_anonymous'),
  ('auth.sessions','id'),('auth.sessions','user_id'),('auth.sessions','not_after')),
schema_names(name) AS (VALUES ('public'),('extensions'),('account_security_private'),('sales_private')),
policies AS (
  SELECT r.name,p.*,pg_catalog.pg_get_expr(p.polqual,p.polrelid) AS using_expr,
    pg_catalog.pg_get_expr(p.polwithcheck,p.polrelid) AS check_expr
  FROM relations r JOIN pg_catalog.pg_policy p ON p.polrelid=r.oid
)
SELECT pg_catalog.jsonb_build_object(
  'reportVersion','account-security-preflight-v1',
  'generatedAt',pg_catalog.statement_timestamp(),
  'scope','catalog_only_no_business_rows',
  'readOnly',pg_catalog.current_setting('transaction_read_only')='on',
  'deploymentApproval','NOT_GRANTED',
  'notice','Metadata and hints only. Never infer identity, effective RLS safety, installed draft equivalence, API exposure or production readiness from this report.',
  'serverVersionNum',pg_catalog.current_setting('server_version_num')::integer,
  'executionRole',current_user,
  'installationPath',CASE WHEN pg_catalog.to_regnamespace('account_security_private') IS NULL
    THEN 'initial_install_candidate_needs_review' ELSE 'existing_namespace_manual_upgrade_review_required' END,
  'missingBaseRelations',(SELECT COALESCE(pg_catalog.jsonb_agg(name ORDER BY name),'[]'::jsonb) FROM relations
    WHERE name IN ('public.users','auth.users','auth.sessions') AND oid IS NULL),
  'missingBaseColumns',(SELECT COALESCE(pg_catalog.jsonb_agg(relation_name||'.'||column_name ORDER BY relation_name,column_name),'[]'::jsonb)
    FROM expected_base_columns e WHERE NOT EXISTS(SELECT 1 FROM columns c WHERE c.name=e.relation_name AND c.attname=e.column_name)),
  'rolesPresent',(SELECT COALESCE(pg_catalog.jsonb_agg(rolname ORDER BY rolname),'[]'::jsonb) FROM roles),
  'schemas',(SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name',s.name,'exists',n.oid IS NOT NULL,
    'clientCreate',(SELECT COALESCE(pg_catalog.jsonb_agg(r.rolname ORDER BY r.rolname),'[]'::jsonb) FROM roles r
      WHERE r.rolname IN ('anon','authenticated') AND pg_catalog.has_schema_privilege(r.oid,n.oid,'CREATE')))
    ORDER BY s.name) FROM schema_names s LEFT JOIN pg_catalog.pg_namespace n ON n.nspname=s.name),
  'relations',(SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name',r.name,'exists',r.oid IS NOT NULL,
    'kind',r.relkind,'owner',pg_catalog.pg_get_userbyid(r.relowner),'rls',r.relrowsecurity,'forceRls',r.relforcerowsecurity,
    'privileges',(SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('role',a.rolname,
      'tableSelect',pg_catalog.has_table_privilege(a.oid,r.oid,'SELECT'),
      'anyColumnSelect',pg_catalog.has_any_column_privilege(a.oid,r.oid,'SELECT'),
      'tableWrite',pg_catalog.has_table_privilege(a.oid,r.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),
      'columnWrite',pg_catalog.has_any_column_privilege(a.oid,r.oid,'INSERT,UPDATE,REFERENCES')) ORDER BY a.rolname),'[]'::jsonb) FROM roles a))
    ORDER BY r.name) FROM relations r),
  'columns',(SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('relation',name,'name',attname,
    'type',pg_catalog.format_type(atttypid,atttypmod),'notNull',attnotnull,
    'defaultHash',pg_catalog.md5(pg_catalog.pg_get_expr(adbin,adrelid)),
    'anonSelect',CASE WHEN name='public.users' THEN
      (SELECT pg_catalog.has_column_privilege(oid,attrelid,attnum,'SELECT') FROM roles WHERE rolname='anon') ELSE NULL END)
    ORDER BY name,attnum),'[]'::jsonb) FROM columns),
  'expectedFunctions',(SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('schema',e.schema_name,'name',e.function_name,
    'argumentTypes',e.argument_types,'matchingSignatureExists',EXISTS(SELECT 1 FROM functions f WHERE f.nspname=e.schema_name
      AND f.proname=e.function_name AND pg_catalog.oidvectortypes(f.proargtypes)=e.argument_types),
    'overloadCount',(SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname=e.schema_name AND p.proname=e.function_name),
    'otherRoutineKindCount',(SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname=e.schema_name AND p.proname=e.function_name AND p.prokind<>'f'))
    ORDER BY e.schema_name,e.function_name) FROM expected_functions e),
  'functions',(SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('schema',f.nspname,'name',f.proname,
    'argumentTypes',pg_catalog.oidvectortypes(f.proargtypes),'resultType',pg_catalog.pg_get_function_result(f.oid),
    'owner',pg_catalog.pg_get_userbyid(f.proowner),'ownerMatchesExecutionRole',pg_catalog.pg_get_userbyid(f.proowner)=current_user,
    'language',f.lanname,'securityDefiner',f.prosecdef,'volatility',f.provolatile,
    'searchPath',(SELECT v FROM pg_catalog.unnest(f.proconfig) v WHERE v LIKE 'search_path=%' LIMIT 1),
    'definitionHash',pg_catalog.md5(pg_catalog.pg_get_functiondef(f.oid)),
    'metadataAuthorizationHint',f.prosrc ~* '(raw_user_meta_data|user_metadata)',
    'authWriteHint',f.prosrc ~* '(insert[[:space:]]+into|update|delete[[:space:]]+from)[[:space:]]+auth[.]',
    'catalogDependentCount',(SELECT count(*) FROM pg_catalog.pg_depend d WHERE d.refclassid='pg_catalog.pg_proc'::regclass AND d.refobjid=f.oid),
    'execute',(SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('role',r.rolname,
      'allowed',pg_catalog.has_function_privilege(r.oid,f.oid,'EXECUTE')) ORDER BY r.rolname),'[]'::jsonb) FROM roles r))
    ORDER BY f.nspname,f.proname,pg_catalog.oidvectortypes(f.proargtypes)),'[]'::jsonb) FROM functions f),
  'policies',(SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('relation',name,'name',polname,
    'permissive',polpermissive,'command',polcmd,'roles',(SELECT pg_catalog.jsonb_agg(CASE WHEN role_id=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(role_id) END ORDER BY role_id) FROM pg_catalog.unnest(polroles) role_id),
    'usingHash',pg_catalog.md5(using_expr),'checkHash',pg_catalog.md5(check_expr),
    'metadataAuthorizationHint',COALESCE(using_expr||' '||COALESCE(check_expr,''),check_expr,'') ~* '(raw_user_meta_data|user_metadata)',
    'literalTrueUsing',COALESCE(pg_catalog.regexp_replace(using_expr,'[()[:space:]]','','g')='true',false),
    'literalTrueCheck',COALESCE(pg_catalog.regexp_replace(check_expr,'[()[:space:]]','','g')='true',false))
    ORDER BY name,polname),'[]'::jsonb) FROM policies),
  'triggers',(SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('relation',r.name,'name',t.tgname,
    'enabled',t.tgenabled,'functionSchema',n.nspname,'functionName',p.proname,
    'definitionHash',pg_catalog.md5(pg_catalog.pg_get_triggerdef(t.oid))) ORDER BY r.name,t.tgname),'[]'::jsonb)
    FROM relations r JOIN pg_catalog.pg_trigger t ON t.tgrelid=r.oid AND NOT t.tgisinternal
    JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace),
  'constraints',(SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('relation',r.name,'name',c.conname,
    'type',c.contype,'validated',c.convalidated,'definitionHash',pg_catalog.md5(pg_catalog.pg_get_constraintdef(c.oid))) ORDER BY r.name,c.conname),'[]'::jsonb)
    FROM relations r JOIN pg_catalog.pg_constraint c ON c.conrelid=r.oid),
  'defaultPrivileges',(SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('owner',pg_catalog.pg_get_userbyid(d.defaclrole),
    'schema',COALESCE(n.nspname,'ALL_SCHEMAS'),'objectType',d.defaclobjtype,
    'grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END,'privilege',a.privilege_type,
    'grantable',a.is_grantable) ORDER BY d.defaclrole,d.defaclnamespace,d.defaclobjtype,a.grantee,a.privilege_type),'[]'::jsonb)
    FROM pg_catalog.pg_default_acl d LEFT JOIN pg_catalog.pg_namespace n ON n.oid=d.defaclnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) a
    WHERE (d.defaclnamespace=0 OR n.nspname IN ('public','account_security_private','sales_private'))
      AND (a.grantee=0 OR a.grantee IN (SELECT oid FROM roles))),
  'dataApiExposure','UNKNOWN_VERIFY_DASHBOARD_AND_POSTGREST_CONFIGURATION',
  'notChecked',pg_catalog.jsonb_build_array('approved project identity','real Auth and JWT sessions','account identity bindings and recovery',
    'all business tables Storage Realtime and legacy RLS','client deployment and feature flags','data values counts or migration completeness',
    'function body equivalence and non-catalog dependencies','backup restore drill and rollback approval')
) AS account_security_preflight_report;
ROLLBACK;
