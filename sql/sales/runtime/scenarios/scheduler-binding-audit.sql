-- SYNTHETIC LOCAL CATALOG AUDIT TESTS ONLY. No Cron, login or real connection.
-- Every unsafe catalog alteration is rolled back inside a probe subtransaction;
-- the whole scenario also rolls back. Not a production privilege-repair script.
BEGIN;
DO $isolation$
BEGIN
  IF current_database() !~ '^buildtrack_sales_runtime_'
    OR current_setting('buildtrack.synthetic_runtime',true) IS DISTINCT FROM 'on'
    OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet THEN
    RAISE EXCEPTION 'REFUSED: binding audit requires isolated synthetic loopback runner';
  END IF;
END;
$isolation$;
CREATE SCHEMA runtime_binding;
CREATE TABLE runtime_binding.assertions(label text PRIMARY KEY);
CREATE TABLE runtime_binding.context(key text PRIMARY KEY,value jsonb NOT NULL);
CREATE FUNCTION runtime_binding.assert_true(condition boolean,label text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $assert$
BEGIN
  IF condition IS DISTINCT FROM true THEN RAISE EXCEPTION 'ASSERTION FAILED: %',label; END IF;
  INSERT INTO runtime_binding.assertions VALUES(label);
END;
$assert$;
CREATE FUNCTION runtime_binding.expect_denied(statement text,label text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $expect$
BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN insufficient_privilege THEN INSERT INTO runtime_binding.assertions VALUES(label); RETURN;
  END;
  RAISE EXCEPTION 'ASSERTION FAILED: %; expected permission denied',label;
END;
$expect$;
CREATE FUNCTION runtime_binding.item(report jsonb,section text,key text)
RETURNS jsonb LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog AS $item$
  SELECT value FROM jsonb_array_elements(report->section) item(value) WHERE value->>'key'=key;
$item$;
CREATE FUNCTION runtime_binding.probe(statement text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $probe$
DECLARE report jsonb;
BEGIN
  BEGIN
    EXECUTE statement;
    report:=sales_private.crm_first_contact_binding_audit();
    RAISE SQLSTATE 'ZB001';
  EXCEPTION WHEN SQLSTATE 'ZB001' THEN NULL;
  END;
  RETURN report;
END;
$probe$;
REVOKE ALL ON FUNCTION runtime_binding.probe(text) FROM PUBLIC;
CREATE FUNCTION runtime_binding.business_snapshot()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $business$
  SELECT jsonb_build_object(
    'settings',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.crm_settings r),
    'customers',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.sales_customers r),
    'tasks',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.crm_sla_tasks r),
    'notices',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.crm_notifications r),
    'audit',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.crm_audit_events r),
    'cursor',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM sales_private.crm_first_contact_cycle_cursor r),
    'adminReceipts',(SELECT jsonb_agg(to_jsonb(r) ORDER BY actor_user_id,request_id) FROM sales_private.crm_first_contact_processing_requests r),
    'adminCycles',(SELECT jsonb_agg(to_jsonb(r) ORDER BY actor_user_id,request_id) FROM sales_private.crm_first_contact_cycle_requests r),
    'workerReceipts',(SELECT jsonb_agg(to_jsonb(r) ORDER BY request_id) FROM sales_private.crm_first_contact_worker_requests r),
    'workerCycles',(SELECT jsonb_agg(to_jsonb(r) ORDER BY request_id) FROM sales_private.crm_first_contact_worker_cycles r),
    'dispatchRequests',(SELECT jsonb_agg(to_jsonb(r) ORDER BY request_id) FROM sales_private.crm_first_contact_dispatch_requests r),
    'dispatchAttempts',(SELECT jsonb_agg(to_jsonb(r) ORDER BY attempt_id) FROM sales_private.crm_first_contact_dispatch_attempts r),
    'dispatchControl',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM sales_private.crm_first_contact_dispatch_control r));
$business$;
CREATE FUNCTION runtime_binding.catalog_snapshot()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $catalog$
  SELECT jsonb_build_object(
    'roles',(SELECT jsonb_agg(jsonb_build_array(oid,rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,
      rolcanlogin,rolreplication,rolbypassrls) ORDER BY oid) FROM pg_roles),
    'members',(SELECT jsonb_agg(to_jsonb(r) ORDER BY roleid,member,grantor) FROM pg_auth_members r),
    'schemas',(SELECT jsonb_agg(jsonb_build_array(oid,nspname,nspacl) ORDER BY oid) FROM pg_namespace WHERE nspname IN ('sales_private','public')),
    'routines',(SELECT jsonb_agg(jsonb_build_array(p.oid,p.proname,p.prokind,p.proowner,p.prosecdef,p.proconfig,p.proacl) ORDER BY p.oid)
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='sales_private'),
    'tables',(SELECT jsonb_agg(jsonb_build_array(c.oid,c.relname,c.relacl,c.relrowsecurity) ORDER BY c.oid)
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('sales_private','public') AND c.relkind IN ('r','p')),
    'columns',(SELECT jsonb_agg(jsonb_build_array(a.attrelid,a.attnum,a.attacl) ORDER BY a.attrelid,a.attnum)
      FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname IN ('sales_private','public') AND a.attnum>0),
    'defaults',(SELECT jsonb_agg(to_jsonb(r) ORDER BY oid) FROM pg_default_acl r));
$catalog$;
REVOKE ALL ON FUNCTION runtime_binding.business_snapshot(),runtime_binding.catalog_snapshot() FROM PUBLIC;
GRANT USAGE ON SCHEMA runtime_binding TO anon,authenticated,buildtrack_sales_sla_worker,buildtrack_sales_sla_dispatcher;
GRANT INSERT ON runtime_binding.assertions TO anon,authenticated,buildtrack_sales_sla_worker,buildtrack_sales_sla_dispatcher;

INSERT INTO runtime_binding.context VALUES('business',runtime_binding.business_snapshot()),('catalog',runtime_binding.catalog_snapshot()),
  ('baseline',sales_private.crm_first_contact_binding_audit());
SELECT runtime_binding.assert_true((SELECT value->>'contractVersion'='first_contact_binding_audit_v1'
  AND value->'automationReady'='false'::jsonb AND value->'callerBindingValidated'='false'::jsonb
  AND value->'sourceIntegrityValidated'='false'::jsonb AND value->'functionOwnerReviewRequired'='true'::jsonb
  FROM runtime_binding.context WHERE key='baseline'),'catalog never authorizes activation or certifies source and caller');
SELECT runtime_binding.assert_true((SELECT value#>'{scope,allKnownTargetsPresent}'='true'::jsonb
  AND value#>'{scope,expectedRoutines}'='12'::jsonb AND value#>'{scope,expectedTables}'='18'::jsonb
  AND value#>'{findings,roleMismatches}'='0'::jsonb AND value#>'{findings,routineMetadataMismatches}'='0'::jsonb
  AND value#>'{findings,missingExpectedGrants}'='0'::jsonb AND value#>'{findings,observedUnexpectedPrivileges}'='0'::jsonb
  FROM runtime_binding.context WHERE key='baseline'),'deployed synthetic13/14 metadata matches the bounded expected boundary');
SELECT runtime_binding.assert_true((SELECT runtime_binding.item(value,'untrustedPrincipals','service_role')->'known'='false'::jsonb
  AND runtime_binding.item(value,'untrustedPrincipals','service_role')->'effectiveRoutineExecuteCount'='null'::jsonb
  FROM runtime_binding.context WHERE key='baseline'),'missing service role is unknown not zero privileges');
SELECT runtime_binding.assert_true((SELECT runtime_binding.item(value,'roles','dispatcher')->'canLogin'='false'::jsonb
  AND runtime_binding.item(value,'roles','dispatcher')->'connectionBindingEstablished'='false'::jsonb
  FROM runtime_binding.context WHERE key='baseline'),'NOLOGIN capability role is never treated as real Cron connection');

SET LOCAL ROLE anon;
SELECT runtime_binding.expect_denied('SELECT sales_private.crm_first_contact_binding_audit()','anon denied operator audit');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT runtime_binding.expect_denied('SELECT sales_private.crm_first_contact_binding_audit()','authenticated denied operator audit');
RESET ROLE;
SET LOCAL ROLE buildtrack_sales_sla_worker;
SELECT runtime_binding.expect_denied('SELECT sales_private.crm_first_contact_binding_audit()','worker denied operator audit');
RESET ROLE;
SET LOCAL ROLE buildtrack_sales_sla_dispatcher;
SELECT runtime_binding.expect_denied('SELECT sales_private.crm_first_contact_binding_audit()','dispatcher denied operator audit');
RESET ROLE;

INSERT INTO runtime_binding.context VALUES('public_execute',runtime_binding.probe(
  'GRANT EXECUTE ON FUNCTION sales_private.crm_first_contact_dispatch_prepare() TO PUBLIC'));
SELECT runtime_binding.assert_true((SELECT runtime_binding.item(value,'untrustedPrincipals','public')->'directRoutineExecuteCount'='1'::jsonb
  AND runtime_binding.item(value,'untrustedPrincipals','anon')->'effectiveRoutineExecuteCount'='1'::jsonb
  AND runtime_binding.item(value,'untrustedPrincipals','anon')->'schemaUsage'='false'::jsonb
  FROM runtime_binding.context WHERE key='public_execute'),'dormant PUBLIC execute detected separately from denied schema usage');
INSERT INTO runtime_binding.context VALUES('app_execute',runtime_binding.probe(
  'GRANT EXECUTE ON PROCEDURE sales_private.crm_first_contact_worker_tick() TO authenticated'));
SELECT runtime_binding.assert_true((SELECT runtime_binding.item(value,'untrustedPrincipals','authenticated')->'directRoutineExecuteCount'='1'::jsonb
  FROM runtime_binding.context WHERE key='app_execute'),'direct authenticated tick execute is unsafe even without schema usage');
INSERT INTO runtime_binding.context VALUES('membership',runtime_binding.probe(
  'GRANT buildtrack_sales_sla_dispatcher TO authenticated'));
SELECT runtime_binding.assert_true((SELECT runtime_binding.item(value,'untrustedPrincipals','authenticated')->'dispatcherMembership'='true'::jsonb
  AND runtime_binding.item(value,'roles','dispatcher')->'directMemberCount'='1'::jsonb
  AND value#>'{findings,roleMismatches}'='1'::jsonb FROM runtime_binding.context WHERE key='membership'),
  'NOINHERIT membership remains a caller-binding risk');
INSERT INTO runtime_binding.context VALUES('inherited',runtime_binding.probe(
  'CREATE ROLE runtime_binding_bridge NOLOGIN INHERIT; GRANT buildtrack_sales_sla_worker TO runtime_binding_bridge; GRANT runtime_binding_bridge TO authenticated WITH INHERIT TRUE'));
SELECT runtime_binding.assert_true((SELECT runtime_binding.item(value,'untrustedPrincipals','authenticated')->'workerMembership'='true'::jsonb
  AND (runtime_binding.item(value,'untrustedPrincipals','authenticated')->>'effectiveRoutineExecuteCount')::integer>=2
  FROM runtime_binding.context WHERE key='inherited'),'indirect inherited worker authority detected by effective privilege checks');
INSERT INTO runtime_binding.context VALUES('service',runtime_binding.probe(
  'CREATE ROLE service_role NOLOGIN NOINHERIT; GRANT USAGE ON SCHEMA sales_private TO service_role; GRANT EXECUTE ON FUNCTION sales_private.crm_first_contact_dispatch_status(uuid) TO service_role'));
SELECT runtime_binding.assert_true((SELECT runtime_binding.item(value,'untrustedPrincipals','service_role')->'known'='true'::jsonb
  AND runtime_binding.item(value,'untrustedPrincipals','service_role')->'directRoutineExecuteCount'='1'::jsonb
  AND runtime_binding.item(value,'untrustedPrincipals','service_role')->'schemaUsage'='true'::jsonb
  FROM runtime_binding.context WHERE key='service'),'synthetic service role grants detected without assuming app backend authority');

INSERT INTO runtime_binding.context VALUES('missing_usage',runtime_binding.probe(
  'REVOKE USAGE ON SCHEMA sales_private FROM buildtrack_sales_sla_dispatcher'));
SELECT runtime_binding.assert_true((SELECT runtime_binding.item(value,'roles','dispatcher')->'schemaUsage'='false'::jsonb
  AND (value#>>'{findings,missingExpectedGrants}')::integer>0 FROM runtime_binding.context WHERE key='missing_usage'),
  'entry grants without schema usage are incomplete');
INSERT INTO runtime_binding.context VALUES('missing_execute',runtime_binding.probe(
  'REVOKE EXECUTE ON FUNCTION sales_private.crm_first_contact_dispatch_prepare() FROM buildtrack_sales_sla_dispatcher'));
SELECT runtime_binding.assert_true((SELECT runtime_binding.item(value,'routines','dispatch_prepare')->'expectedRoleDirectExecute'='false'::jsonb
  AND (value#>>'{findings,missingExpectedGrants}')::integer>0 FROM runtime_binding.context WHERE key='missing_execute'),
  'schema usage without direct entry grant is incomplete');
INSERT INTO runtime_binding.context VALUES('schema_create',runtime_binding.probe('GRANT CREATE ON SCHEMA sales_private TO buildtrack_sales_sla_worker'));
SELECT runtime_binding.assert_true((SELECT runtime_binding.item(value,'roles','worker')->'schemaCreate'='true'::jsonb
  AND (value#>>'{findings,observedUnexpectedPrivileges}')::integer>0 FROM runtime_binding.context WHERE key='schema_create'),
  'worker schema CREATE is an unexpected privilege');
INSERT INTO runtime_binding.context VALUES('role_attributes',runtime_binding.probe('ALTER ROLE buildtrack_sales_sla_dispatcher LOGIN BYPASSRLS'));
SELECT runtime_binding.assert_true((SELECT runtime_binding.item(value,'roles','dispatcher')->'attributesMatch'='false'::jsonb
  AND runtime_binding.item(value,'roles','dispatcher')->'canLogin'='true'::jsonb
  AND runtime_binding.item(value,'roles','dispatcher')->'bypassRls'='true'::jsonb
  FROM runtime_binding.context WHERE key='role_attributes'),'unexpected login and bypass attributes require review not silent adoption');
INSERT INTO runtime_binding.context VALUES('table_access',runtime_binding.probe(
  'GRANT SELECT ON sales_private.crm_first_contact_dispatch_requests TO buildtrack_sales_sla_worker'));
SELECT runtime_binding.assert_true((SELECT runtime_binding.item(value,'tables','sales_private.crm_first_contact_dispatch_requests')->'workerAnyTableOrColumnPrivilege'='true'::jsonb
  FROM runtime_binding.context WHERE key='table_access'),'direct private table access detected');
INSERT INTO runtime_binding.context VALUES('column_access',runtime_binding.probe(
  'GRANT SELECT (customer_name) ON public.sales_customers TO buildtrack_sales_sla_dispatcher'));
SELECT runtime_binding.assert_true((SELECT runtime_binding.item(value,'tables','public.sales_customers')->'dispatcherAnyTableOrColumnPrivilege'='true'::jsonb
  FROM runtime_binding.context WHERE key='column_access'),'column-only customer access detected without reading customer data');
INSERT INTO runtime_binding.context VALUES('core_access',runtime_binding.probe(
  'GRANT EXECUTE ON FUNCTION sales_private.crm_first_contact_apply(public.crm_settings,public.sales_customers,public.crm_sla_tasks,sales_private.crm_work_calendars,boolean,uuid,text,text,uuid) TO buildtrack_sales_sla_dispatcher'));
SELECT runtime_binding.assert_true((SELECT runtime_binding.item(value,'routines','shared_core')->'unexpectedDispatcherExecute'='true'::jsonb
  FROM runtime_binding.context WHERE key='core_access'),'direct shared core execution detected');
INSERT INTO runtime_binding.context VALUES('worker_bypass',runtime_binding.probe(
  'GRANT EXECUTE ON FUNCTION sales_private.crm_first_contact_worker_cycle(uuid) TO buildtrack_sales_sla_dispatcher'));
SELECT runtime_binding.assert_true((SELECT runtime_binding.item(value,'routines','worker_cycle')->'unexpectedDispatcherExecute'='true'::jsonb
  FROM runtime_binding.context WHERE key='worker_bypass'),'dispatcher direct worker bypass detected');

INSERT INTO runtime_binding.context VALUES('path',runtime_binding.probe(
  'ALTER FUNCTION sales_private.crm_first_contact_dispatch_prepare() SET search_path TO public,pg_catalog'));
SELECT runtime_binding.assert_true((SELECT runtime_binding.item(value,'routines','dispatch_prepare')->'metadataMatches'='false'::jsonb
  FROM runtime_binding.context WHERE key='path'),'unpinned entry search path detected');
INSERT INTO runtime_binding.context VALUES('timezone',runtime_binding.probe(
  'ALTER FUNCTION sales_private.crm_first_contact_worker_cycle(uuid) RESET timezone'));
SELECT runtime_binding.assert_true((SELECT runtime_binding.item(value,'routines','worker_cycle')->'metadataMatches'='false'::jsonb
  FROM runtime_binding.context WHERE key='timezone'),'missing entry UTC pin detected');
INSERT INTO runtime_binding.context VALUES('definer',runtime_binding.probe(
  'ALTER FUNCTION sales_private.crm_first_contact_dispatch_execute(uuid,uuid) SECURITY INVOKER'));
SELECT runtime_binding.assert_true((SELECT runtime_binding.item(value,'routines','dispatch_execute')->'metadataMatches'='false'::jsonb
  FROM runtime_binding.context WHERE key='definer'),'wrong entry security mode detected');
INSERT INTO runtime_binding.context VALUES('tick_set',runtime_binding.probe(
  'ALTER PROCEDURE sales_private.crm_first_contact_worker_tick() SET search_path TO pg_catalog'));
SELECT runtime_binding.assert_true((SELECT runtime_binding.item(value,'routines','worker_tick')->'metadataMatches'='false'::jsonb
  FROM runtime_binding.context WHERE key='tick_set'),'tick SET clause detected because it prevents transaction control');
INSERT INTO runtime_binding.context VALUES('tick_definer',runtime_binding.probe(
  'ALTER PROCEDURE sales_private.crm_first_contact_worker_tick() SECURITY DEFINER'));
SELECT runtime_binding.assert_true((SELECT runtime_binding.item(value,'routines','worker_tick')->'metadataMatches'='false'::jsonb
  FROM runtime_binding.context WHERE key='tick_definer'),'tick definer detected because it prevents transaction control');
INSERT INTO runtime_binding.context VALUES('wrong_kind',runtime_binding.probe(
  'DROP PROCEDURE sales_private.crm_first_contact_worker_tick(); CREATE FUNCTION sales_private.crm_first_contact_worker_tick() RETURNS void LANGUAGE sql AS ''SELECT'''));
SELECT runtime_binding.assert_true((SELECT runtime_binding.item(value,'routines','worker_tick')->'metadataMatches'='false'::jsonb
  AND runtime_binding.item(value,'routines','worker_tick')->'isProcedure'='false'::jsonb
  FROM runtime_binding.context WHERE key='wrong_kind'),'function lookalike never qualifies as committing tick procedure');
INSERT INTO runtime_binding.context VALUES('overload',runtime_binding.probe(
  'CREATE FUNCTION sales_private.crm_first_contact_dispatch_prepare(text) RETURNS void LANGUAGE sql AS ''SELECT'''));
SELECT runtime_binding.assert_true((SELECT runtime_binding.item(value,'routines','dispatch_prepare')->'sameNameCount'='2'::jsonb
  AND (value#>>'{findings,routineMetadataMismatches}')::integer>0 FROM runtime_binding.context WHERE key='overload'),
  'unexpected overload is surfaced without reading or invoking its body');
INSERT INTO runtime_binding.context VALUES('missing_routine',runtime_binding.probe(
  'ALTER FUNCTION sales_private.crm_first_contact_dispatch_status(uuid) RENAME TO hidden_dispatch_status'));
SELECT runtime_binding.assert_true((SELECT runtime_binding.item(value,'routines','dispatch_status')->'known'='false'::jsonb
  AND runtime_binding.item(value,'routines','dispatch_status')->'metadataMatches'='null'::jsonb
  AND value#>'{scope,allKnownTargetsPresent}'='false'::jsonb FROM runtime_binding.context WHERE key='missing_routine'),
  'missing routine stays unknown without signature-cast failure');
INSERT INTO runtime_binding.context VALUES('missing_type',runtime_binding.probe(
  'ALTER TABLE sales_private.crm_first_contact_dispatch_requests RENAME TO hidden_dispatch_requests'));
SELECT runtime_binding.assert_true((SELECT runtime_binding.item(value,'routines','dispatch_projection')->'known'='false'::jsonb
  AND runtime_binding.item(value,'tables','sales_private.crm_first_contact_dispatch_requests')->'known'='false'::jsonb
  AND runtime_binding.item(value,'tables','sales_private.crm_first_contact_dispatch_requests')->'workerAnyTableOrColumnPrivilege'='null'::jsonb
  FROM runtime_binding.context WHERE key='missing_type'),'missing composite type and table stay unknown instead of aborting audit');
INSERT INTO runtime_binding.context VALUES('missing_role',runtime_binding.probe(
  'ALTER ROLE buildtrack_sales_sla_worker RENAME TO runtime_binding_hidden_worker'));
SELECT runtime_binding.assert_true((SELECT runtime_binding.item(value,'roles','worker')->'known'='false'::jsonb
  AND runtime_binding.item(value,'roles','worker')->'attributesMatch'='null'::jsonb
  FROM runtime_binding.context WHERE key='missing_role'),'missing capability role stays unknown');
INSERT INTO runtime_binding.context VALUES('default_acl',runtime_binding.probe(
  'ALTER DEFAULT PRIVILEGES IN SCHEMA sales_private GRANT EXECUTE ON FUNCTIONS TO authenticated; ALTER DEFAULT PRIVILEGES IN SCHEMA sales_private GRANT SELECT ON TABLES TO buildtrack_sales_sla_worker'));
SELECT runtime_binding.assert_true((SELECT (value#>>'{defaultPrivileges,explicitHazardEntries}')::integer>=2
  AND value#>'{defaultPrivileges,futureObjectsValidated}'='false'::jsonb FROM runtime_binding.context WHERE key='default_acl'),
  'relevant owner default-ACL exposure counted without certifying future objects');
SELECT runtime_binding.assert_true((SELECT value#>'{defaultPrivileges,functionCreationRequiresExplicitRevoke}'='true'::jsonb
  FROM runtime_binding.context WHERE key='baseline'),'empty explicit default ACL catalog never means future functions are private');

SELECT runtime_binding.assert_true(runtime_binding.business_snapshot()=(SELECT value FROM runtime_binding.context WHERE key='business'),
  'all read-only audits and denied calls preserve settings business ledgers and cursor');
SELECT runtime_binding.assert_true(runtime_binding.catalog_snapshot()=(SELECT value FROM runtime_binding.context WHERE key='catalog'),
  'every unsafe synthetic probe fully restores original roles memberships grants and metadata');
SELECT runtime_binding.assert_true((sales_private.crm_first_contact_binding_audit()-'observedAt')=
  (SELECT value-'observedAt' FROM runtime_binding.context WHERE key='baseline'),'audit unchanged after all rolled back probes');
SELECT runtime_binding.assert_true((SELECT bool_and(value::text NOT LIKE '%customer_name%' AND value::text NOT LIKE '%SECRET%'
  AND value::text NOT LIKE '%GRANT %' AND value::text NOT LIKE '%SELECT %' AND value::text NOT LIKE '%password%')
  FROM runtime_binding.context WHERE key NOT IN ('business','catalog')),'report never returns customer fields raw SQL or secrets');
SELECT 'SCHEDULER_BINDING_AUDIT_RUNTIME:'||jsonb_build_object('suite','scheduler_binding_audit','assertions',count(*),
  'realCronBindingTested',false,'sourceIntegrityValidated',false)::text FROM runtime_binding.assertions;
ROLLBACK;
