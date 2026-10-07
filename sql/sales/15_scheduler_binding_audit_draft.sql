-- SALES V2 SCHEDULER BINDING AUDIT -- DESIGN ONLY, 2026-09-23.
-- NEVER RUN ON SUPABASE. Operator-only catalog inspection of the known13/14
-- boundary. This is NOT a Cron installer, privilege repair or deployment approval.
-- No customer rows, function bodies, commands, passwords or raw errors returned.
BEGIN;
DO $draft_only$
BEGIN
  RAISE EXCEPTION 'DESIGN ONLY: scheduler binding audit is not authorized for database execution';
END;
$draft_only$;

CREATE FUNCTION sales_private.crm_first_contact_binding_audit()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog SET timezone = 'UTC'
AS $binding_audit$
DECLARE
  private_schema oid:=to_regnamespace('sales_private'); public_schema oid:=to_regnamespace('public');
  worker_id oid; dispatcher_id oid; principal_id oid; object_id oid; routine_owner oid;
  expected record; role_row record; routine_row record; principal_name text; role_key text;
  roles_value jsonb:='[]'::jsonb; routines_value jsonb:='[]'::jsonb; tables_value jsonb:='[]'::jsonb;
  principals_value jsonb:='[]'::jsonb; routine_ids oid[]:='{}'::oid[]; owner_ids oid[]:='{}'::oid[];
  table_ids oid[]:='{}'::oid[]; missing_routines integer:=0; missing_tables integer:=0; missing_roles integer:=0;
  metadata_mismatches integer:=0; missing_expected_grants integer:=0; unexpected_privileges integer:=0;
  known_principals integer:=0; direct_count integer; effective_count integer; table_count integer;
  member_count integer; parent_count integer; matching_count integer; named_count integer;
  metadata_matches boolean; direct_allowed boolean; effective_allowed boolean; schema_usage boolean; schema_create boolean;
  worker_leak boolean; dispatcher_leak boolean; member_worker boolean; member_dispatcher boolean;
  default_acl_hazards integer; default_acl_rows integer; role_mismatches integer:=0; grant_option_count integer;
BEGIN
  SELECT oid INTO worker_id FROM pg_roles WHERE rolname='buildtrack_sales_sla_worker';
  SELECT oid INTO dispatcher_id FROM pg_roles WHERE rolname='buildtrack_sales_sla_dispatcher';
  -- Match argument catalog names instead of parsing a regprocedure signature:
  -- missing composite types in a partial installation must not abort this read.
  FOR expected IN SELECT * FROM (VALUES
    ('worker_cycle','crm_first_contact_worker_cycle',ARRAY['pg_catalog.uuid'],'f',true,'worker'),
    ('worker_receipt','crm_first_contact_worker_receipt',ARRAY['pg_catalog.uuid'],'f',true,'worker'),
    ('dispatch_prepare','crm_first_contact_dispatch_prepare',ARRAY[]::text[],'f',true,'dispatcher'),
    ('dispatch_execute','crm_first_contact_dispatch_execute',ARRAY['pg_catalog.uuid','pg_catalog.uuid'],'f',true,'dispatcher'),
    ('dispatch_status','crm_first_contact_dispatch_status',ARRAY['pg_catalog.uuid'],'f',true,'dispatcher'),
    ('worker_tick','crm_first_contact_worker_tick',ARRAY[]::text[],'p',false,'dispatcher'),
    ('shared_core','crm_first_contact_apply',ARRAY['public.crm_settings','public.sales_customers','public.crm_sla_tasks',
      'sales_private.crm_work_calendars','pg_catalog.bool','pg_catalog.uuid','pg_catalog.text','pg_catalog.text','pg_catalog.uuid'],'f',false,NULL),
    ('worker_child_projection','crm_first_contact_worker_child_projection',ARRAY['pg_catalog.jsonb'],'f',false,NULL),
    ('worker_cycle_projection','crm_first_contact_worker_cycle_projection',ARRAY['pg_catalog.jsonb'],'f',false,NULL),
    ('dispatch_projection','crm_first_contact_dispatch_projection',ARRAY['sales_private.crm_first_contact_dispatch_requests','pg_catalog.uuid'],'f',false,NULL),
    ('dispatch_history_guard','crm_first_contact_dispatch_history_guard',ARRAY[]::text[],'f',false,NULL),
    ('history_immutable','crm_first_contact_history_immutable',ARRAY[]::text[],'f',false,NULL)
  ) items(key,name,args,kind,definer,allowed_role) LOOP
    SELECT count(*) INTO named_count FROM pg_proc WHERE pronamespace=private_schema AND proname=expected.name;
    SELECT count(*),min(p.oid::bigint)::oid INTO matching_count,object_id FROM pg_proc p
      WHERE p.pronamespace=private_schema AND p.proname=expected.name AND
        ARRAY(SELECT n.nspname::text||'.'||t.typname::text FROM unnest(p.proargtypes::oid[]) WITH ORDINALITY a(id,position)
          JOIN pg_type t ON t.oid=a.id JOIN pg_namespace n ON n.oid=t.typnamespace ORDER BY a.position)=expected.args;
    IF matching_count<>1 THEN
      missing_routines:=missing_routines+1;
      routines_value:=routines_value||jsonb_build_array(jsonb_build_object('key',expected.key,'known',false,
        'sameNameCount',named_count,'metadataMatches',NULL,'expectedRoleDirectExecute',NULL,'expectedRoleEffectiveExecute',NULL));
      CONTINUE;
    END IF;
    SELECT * INTO routine_row FROM pg_proc WHERE oid=object_id;
    routine_owner:=routine_row.proowner;
    routine_ids:=array_append(routine_ids,object_id); owner_ids:=array_append(owner_ids,routine_owner);
    -- Only entry-point functions/core promise UTC. Older pure projection/trigger
    -- helpers promise their existing search_path; the tick must have NO SET at all.
    metadata_matches:=routine_row.prokind::text=expected.kind AND routine_row.prosecdef=expected.definer
      AND CASE WHEN expected.kind='p' THEN routine_row.proconfig IS NULL
        ELSE COALESCE('search_path=pg_catalog'=ANY(routine_row.proconfig),false)
          AND (expected.allowed_role IS NULL AND expected.key<>'shared_core'
            OR EXISTS (SELECT 1 FROM unnest(routine_row.proconfig) c(value) WHERE lower(c.value)='timezone=utc')) END;
    IF NOT metadata_matches OR named_count<>1 THEN metadata_mismatches:=metadata_mismatches+1; END IF;
    principal_id:=CASE expected.allowed_role WHEN 'worker' THEN worker_id WHEN 'dispatcher' THEN dispatcher_id ELSE NULL END;
    direct_allowed:=NULL; effective_allowed:=NULL;
    IF principal_id IS NOT NULL THEN
      SELECT EXISTS (SELECT 1 FROM aclexplode(COALESCE(routine_row.proacl,acldefault('f',routine_owner))) a
        WHERE a.grantee=principal_id AND a.privilege_type='EXECUTE') INTO direct_allowed;
      effective_allowed:=has_function_privilege(principal_id,object_id,'EXECUTE');
      IF NOT direct_allowed OR NOT effective_allowed THEN missing_expected_grants:=missing_expected_grants+1; END IF;
    ELSIF expected.allowed_role IS NOT NULL THEN missing_expected_grants:=missing_expected_grants+1;
    END IF;
    worker_leak:=CASE WHEN worker_id IS NULL THEN NULL ELSE
      expected.allowed_role IS DISTINCT FROM 'worker' AND has_function_privilege(worker_id,object_id,'EXECUTE') END;
    dispatcher_leak:=CASE WHEN dispatcher_id IS NULL THEN NULL ELSE
      expected.allowed_role IS DISTINCT FROM 'dispatcher' AND has_function_privilege(dispatcher_id,object_id,'EXECUTE') END;
    unexpected_privileges:=unexpected_privileges+CASE WHEN worker_leak THEN 1 ELSE 0 END+CASE WHEN dispatcher_leak THEN 1 ELSE 0 END;
    routines_value:=routines_value||jsonb_build_array(jsonb_build_object('key',expected.key,'known',true,'sameNameCount',named_count,
      'metadataMatches',metadata_matches,'isProcedure',routine_row.prokind='p','securityDefiner',routine_row.prosecdef,
      'expectedRoleDirectExecute',direct_allowed,'expectedRoleEffectiveExecute',effective_allowed,
      'unexpectedWorkerExecute',worker_leak,'unexpectedDispatcherExecute',dispatcher_leak,
      'ownerReviewRequired',true,'ownerSuperuser',(SELECT rolsuper FROM pg_roles WHERE oid=routine_owner),
      'ownerBypassesRls',(SELECT rolbypassrls FROM pg_roles WHERE oid=routine_owner)));
  END LOOP;

  -- Object ACL exposure remains a finding even if schema USAGE currently blocks
  -- name resolution. Never certify a dormant grant as harmless or auto-repair it.
  FOREACH principal_name IN ARRAY ARRAY['public','anon','authenticated','service_role'] LOOP
    principal_id:=NULL;
    IF principal_name<>'public' THEN SELECT oid INTO principal_id FROM pg_roles WHERE rolname=principal_name; END IF;
    IF principal_name<>'public' AND principal_id IS NULL THEN
      principals_value:=principals_value||jsonb_build_array(jsonb_build_object('key',principal_name,'known',false,
        'directRoutineExecuteCount',NULL,'effectiveRoutineExecuteCount',NULL,'schemaUsage',NULL,'schemaCreate',NULL,
        'workerMembership',NULL,'dispatcherMembership',NULL));
      CONTINUE;
    END IF;
    known_principals:=known_principals+1;
    SELECT count(*) INTO direct_count FROM pg_proc p WHERE p.oid=ANY(routine_ids) AND EXISTS (
      SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
      WHERE a.grantee=COALESCE(principal_id,0::oid) AND a.privilege_type='EXECUTE');
    IF principal_name='public' THEN
      effective_count:=direct_count; member_worker:=NULL; member_dispatcher:=NULL;
      SELECT CASE WHEN private_schema IS NULL THEN NULL ELSE EXISTS (
          SELECT 1 FROM pg_namespace n, LATERAL aclexplode(COALESCE(n.nspacl,acldefault('n',n.nspowner))) a
          WHERE n.oid=private_schema AND a.grantee=0 AND a.privilege_type='USAGE') END,
        CASE WHEN private_schema IS NULL THEN NULL ELSE EXISTS (
          SELECT 1 FROM pg_namespace n, LATERAL aclexplode(COALESCE(n.nspacl,acldefault('n',n.nspowner))) a
          WHERE n.oid=private_schema AND a.grantee=0 AND a.privilege_type='CREATE') END INTO schema_usage,schema_create;
    ELSE
      SELECT count(*) INTO effective_count FROM pg_proc p WHERE p.oid=ANY(routine_ids) AND has_function_privilege(principal_id,p.oid,'EXECUTE');
      schema_usage:=CASE WHEN private_schema IS NULL THEN NULL ELSE has_schema_privilege(principal_id,private_schema,'USAGE') END;
      schema_create:=CASE WHEN private_schema IS NULL THEN NULL ELSE has_schema_privilege(principal_id,private_schema,'CREATE') END;
      member_worker:=CASE WHEN worker_id IS NULL THEN NULL ELSE pg_has_role(principal_id,worker_id,'MEMBER') END;
      member_dispatcher:=CASE WHEN dispatcher_id IS NULL THEN NULL ELSE pg_has_role(principal_id,dispatcher_id,'MEMBER') END;
    END IF;
    unexpected_privileges:=unexpected_privileges+effective_count+CASE WHEN schema_create THEN 1 ELSE 0 END;
    principals_value:=principals_value||jsonb_build_array(jsonb_build_object('key',principal_name,'known',true,
      'directRoutineExecuteCount',direct_count,'effectiveRoutineExecuteCount',effective_count,'schemaUsage',schema_usage,
      'schemaCreate',schema_create,'workerMembership',member_worker,'dispatcherMembership',member_dispatcher));
  END LOOP;

  FOR expected IN SELECT * FROM (VALUES
    ('public','crm_settings'),('public','sales_customers'),('public','crm_sla_tasks'),('public','crm_notifications'),
    ('public','crm_audit_events'),('public','lead_activities'),('public','crm_work_periods'),
    ('sales_private','crm_user_roles'),('sales_private','crm_work_calendars'),('sales_private','crm_work_calendar_versions'),
    ('sales_private','crm_first_contact_processing_requests'),('sales_private','crm_first_contact_cycle_requests'),
    ('sales_private','crm_first_contact_cycle_cursor'),('sales_private','crm_first_contact_worker_requests'),
    ('sales_private','crm_first_contact_worker_cycles'),('sales_private','crm_first_contact_dispatch_requests'),
    ('sales_private','crm_first_contact_dispatch_attempts'),('sales_private','crm_first_contact_dispatch_control')
  ) items(schema_name,table_name) LOOP
    SELECT c.oid INTO object_id FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname=expected.schema_name AND c.relname=expected.table_name AND c.relkind IN ('r','p');
    IF object_id IS NULL THEN missing_tables:=missing_tables+1;
    ELSE table_ids:=array_append(table_ids,object_id); END IF;
    worker_leak:=CASE WHEN object_id IS NULL OR worker_id IS NULL THEN NULL ELSE
      has_table_privilege(worker_id,object_id,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      OR has_any_column_privilege(worker_id,object_id,'SELECT,INSERT,UPDATE,REFERENCES') END;
    dispatcher_leak:=CASE WHEN object_id IS NULL OR dispatcher_id IS NULL THEN NULL ELSE
      has_table_privilege(dispatcher_id,object_id,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      OR has_any_column_privilege(dispatcher_id,object_id,'SELECT,INSERT,UPDATE,REFERENCES') END;
    unexpected_privileges:=unexpected_privileges+CASE WHEN worker_leak THEN 1 ELSE 0 END+CASE WHEN dispatcher_leak THEN 1 ELSE 0 END;
    tables_value:=tables_value||jsonb_build_array(jsonb_build_object('key',expected.schema_name||'.'||expected.table_name,
      'known',object_id IS NOT NULL,'workerAnyTableOrColumnPrivilege',worker_leak,'dispatcherAnyTableOrColumnPrivilege',dispatcher_leak));
  END LOOP;

  FOREACH role_key IN ARRAY ARRAY['worker','dispatcher'] LOOP
    principal_id:=CASE role_key WHEN 'worker' THEN worker_id ELSE dispatcher_id END;
    IF principal_id IS NULL THEN
      missing_roles:=missing_roles+1;
      roles_value:=roles_value||jsonb_build_array(jsonb_build_object('key',role_key,'known',false,'attributesMatch',NULL,
        'directMemberCount',NULL,'directParentCount',NULL,'schemaUsage',NULL,'schemaCreate',NULL));
      CONTINUE;
    END IF;
    SELECT * INTO role_row FROM pg_roles WHERE oid=principal_id;
    metadata_matches:=NOT (role_row.rolcanlogin OR role_row.rolinherit OR role_row.rolsuper OR role_row.rolcreatedb
      OR role_row.rolcreaterole OR role_row.rolreplication OR role_row.rolbypassrls);
    SELECT count(*) INTO member_count FROM pg_auth_members WHERE roleid=principal_id;
    SELECT count(*) INTO parent_count FROM pg_auth_members WHERE member=principal_id;
    schema_usage:=CASE WHEN private_schema IS NULL THEN NULL ELSE has_schema_privilege(principal_id,private_schema,'USAGE') END;
    schema_create:=CASE WHEN private_schema IS NULL THEN NULL ELSE has_schema_privilege(principal_id,private_schema,'CREATE') END;
    IF NOT metadata_matches OR member_count>0 OR parent_count>0 THEN role_mismatches:=role_mismatches+1; END IF;
    IF schema_usage IS DISTINCT FROM true THEN missing_expected_grants:=missing_expected_grants+1; END IF;
    IF schema_create THEN unexpected_privileges:=unexpected_privileges+1; END IF;
    SELECT count(*) INTO grant_option_count FROM (
      SELECT a.is_grantable FROM pg_proc p, LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
        WHERE p.oid=ANY(routine_ids) AND a.grantee=principal_id
      UNION ALL
      SELECT a.is_grantable FROM pg_namespace n, LATERAL aclexplode(COALESCE(n.nspacl,acldefault('n',n.nspowner))) a
        WHERE n.oid=private_schema AND a.grantee=principal_id
    ) grants WHERE is_grantable;
    unexpected_privileges:=unexpected_privileges+grant_option_count;
    SELECT count(*) INTO table_count FROM pg_class c WHERE c.oid=ANY(table_ids) AND
      (has_table_privilege(principal_id,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        OR has_any_column_privilege(principal_id,c.oid,'SELECT,INSERT,UPDATE,REFERENCES'));
    roles_value:=roles_value||jsonb_build_array(jsonb_build_object('key',role_key,'known',true,'attributesMatch',metadata_matches,
      'canLogin',role_row.rolcanlogin,'inherits',role_row.rolinherit,'superuser',role_row.rolsuper,'bypassRls',role_row.rolbypassrls,
      'directMemberCount',member_count,'directParentCount',parent_count,'schemaUsage',schema_usage,'schemaCreate',schema_create,
      'knownTableOrColumnPrivilegeCount',table_count,'directRoutineOrSchemaGrantOptionCount',grant_option_count,
      'connectionBindingEstablished',false));
  END LOOP;

  -- Only defaults of observed routine owners, global/private/public schemas.
  -- Positive ACL entries are hazards, not proof of future object reachability.
  -- Default PUBLIC function EXECUTE also exists implicitly when no row is present;
  -- do not treat an empty pg_default_acl result as safe object creation.
  SELECT count(*) INTO default_acl_rows FROM pg_default_acl d WHERE d.defaclrole=ANY(owner_ids)
    AND (d.defaclnamespace=0 OR d.defaclnamespace IN (private_schema,public_schema)) AND d.defaclobjtype IN ('f','r','S','n');
  SELECT count(*) INTO default_acl_hazards FROM pg_default_acl d, LATERAL aclexplode(d.defaclacl) a
    WHERE d.defaclrole=ANY(owner_ids) AND (d.defaclnamespace=0 OR d.defaclnamespace IN (private_schema,public_schema))
      AND d.defaclobjtype IN ('f','r','S','n') AND (a.grantee=0 OR EXISTS (
        SELECT 1 FROM pg_roles r WHERE r.rolname IN ('anon','authenticated','service_role','buildtrack_sales_sla_worker','buildtrack_sales_sla_dispatcher')
          AND (r.oid=a.grantee OR pg_has_role(r.oid,a.grantee,'MEMBER'))))
      AND a.privilege_type IN ('EXECUTE','SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','USAGE','CREATE');

  RETURN jsonb_build_object('contractVersion','first_contact_binding_audit_v1','observedAt',statement_timestamp(),
    'automationReady',false,'callerBindingValidated',false,'sourceIntegrityValidated',false,'functionOwnerReviewRequired',true,
    'blockingReasons',jsonb_build_array('CRON_CALLER_BINDING_NOT_VALIDATED','SOURCE_INTEGRITY_NOT_VALIDATED',
      'FUNCTION_OWNER_REVIEW_REQUIRED','STAGING_TOP_LEVEL_CALL_NOT_VALIDATED','KNOWN_CATALOG_SCOPE_ONLY'),
    'scope',jsonb_build_object('expectedRoles',2,'expectedRoutines',12,'expectedTables',18,'expectedUntrustedPrincipals',4,
      'allKnownTargetsPresent',private_schema IS NOT NULL AND missing_roles=0 AND missing_routines=0 AND missing_tables=0,
      'missingRoles',missing_roles,'missingRoutines',missing_routines,'missingTables',missing_tables,
      'unknownUntrustedPrincipals',4-known_principals,'completeDatabaseSecurityAudit',false),
    'findings',jsonb_build_object('roleMismatches',role_mismatches,'routineMetadataMismatches',metadata_mismatches,
      'missingExpectedGrants',missing_expected_grants,'observedUnexpectedPrivileges',unexpected_privileges),
    'roles',roles_value,'routines',routines_value,'untrustedPrincipals',principals_value,'tables',tables_value,
    'defaultPrivileges',jsonb_build_object('scope','observed_routine_owners_global_and_known_schemas',
      'ownerScopeComplete',missing_routines=0,'catalogRows',CASE WHEN cardinality(owner_ids)>0 THEN default_acl_rows ELSE NULL END,
      'explicitHazardEntries',CASE WHEN cardinality(owner_ids)>0 THEN default_acl_hazards ELSE NULL END,
      'functionCreationRequiresExplicitRevoke',true,'futureObjectsValidated',false),
    'notice','Catalog booleans and counts only. Missing means unknown. NOLOGIN is not a usable Cron connection. ACL metadata does not verify function bodies, RLS policies, trusted owners, wrappers, role-binding setup, latency or activation safety. Findings never change permissions.');
END;
$binding_audit$;
REVOKE ALL ON FUNCTION sales_private.crm_first_contact_binding_audit() FROM PUBLIC, anon, authenticated,
  buildtrack_sales_sla_worker, buildtrack_sales_sla_dispatcher;

ROLLBACK;
