-- SYNTHETIC LOCAL CENTRAL SEARCH TESTS ONLY. Every fixture rolls back.
-- Not a migration. Must never run on an application database.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $isolation$
BEGIN
  IF current_database() !~ '^buildtrack_sales_runtime_' OR current_setting('buildtrack.synthetic_runtime',true) IS DISTINCT FROM 'on'
    OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet THEN
    RAISE EXCEPTION 'REFUSED: central search tests require the isolated synthetic loopback runner';
  END IF;
END;
$isolation$;
CREATE SCHEMA runtime_central_search;
CREATE TABLE runtime_central_search.assertions(label text PRIMARY KEY);
CREATE TABLE runtime_central_search.context(key text PRIMARY KEY,value jsonb NOT NULL);
GRANT USAGE ON SCHEMA runtime_central_search TO authenticated,anon;
GRANT SELECT,INSERT,UPDATE ON runtime_central_search.context,runtime_central_search.assertions TO authenticated,anon;
CREATE FUNCTION runtime_central_search.assert_true(condition boolean,label text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $assert$
BEGIN
  IF condition IS DISTINCT FROM true THEN RAISE EXCEPTION 'ASSERTION FAILED: %',label; END IF;
  INSERT INTO runtime_central_search.assertions VALUES(label);
END;
$assert$;
CREATE FUNCTION runtime_central_search.expect_error(statement text,expected_message text,label text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $expect$
DECLARE actual_message text;
BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS actual_message=MESSAGE_TEXT;
    IF expected_message IS NOT NULL AND actual_message<>expected_message THEN
      RAISE EXCEPTION 'ASSERTION FAILED: %; expected %, received %',label,expected_message,actual_message;
    END IF;
    INSERT INTO runtime_central_search.assertions VALUES(label); RETURN;
  END;
  RAISE EXCEPTION 'ASSERTION FAILED: %; expected error',label;
END;
$expect$;
CREATE FUNCTION runtime_central_search.filters(changes jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $filters$
  SELECT '{"search":"","project":"","channel":"","owner":"","status":"","unassignedOnly":false}'::jsonb||changes;
$filters$;
CREATE FUNCTION runtime_central_search.business_snapshot()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $business$
  SELECT jsonb_build_object('customers',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.sales_customers r),
    'interests',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.lead_project_interests r),
    'sales',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.sales r),
    'plots',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.plots r),
    'settings',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.crm_settings r),
    'tasks',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.crm_sla_tasks r),
    'audits',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.crm_audit_events r),
    'receipts',(SELECT jsonb_agg(to_jsonb(r) ORDER BY actor_user_id,request_id) FROM sales_private.central_command_requests r));
$business$;
REVOKE ALL ON FUNCTION runtime_central_search.business_snapshot() FROM PUBLIC;
INSERT INTO auth.users(id) SELECT ('bc220000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid FROM generate_series(1,6) n;
INSERT INTO sales_private.crm_user_roles(user_id,role,display_name,is_active) VALUES
 ('bc220000-0000-4000-8000-000000000001','admin','SYNTHETIC Search Admin',true),
 ('bc220000-0000-4000-8000-000000000002','sales','SYNTHETIC Search Sales',true),
 ('bc220000-0000-4000-8000-000000000003','owner','SYNTHETIC Search Owner',true),
 ('bc220000-0000-4000-8000-000000000004','sales','SYNTHETIC Other Sales',true),
 ('bc220000-0000-4000-8000-000000000005','sales','SYNTHETIC Inactive Sales',false);
INSERT INTO public.projects(name,is_closed) VALUES('SYNTHETIC SEARCH A',false),('SYNTHETIC SEARCH B',false),('SYNTHETIC SEARCH CLOSED',true);
INSERT INTO public.crm_settings(id,central_intake_enabled) VALUES(true,false)
 ON CONFLICT(id) DO UPDATE SET central_intake_enabled=false;
INSERT INTO public.sales_customers(id,customer_name,phone,intake_channel,intake_notes,owner_user_id,created_by_user_id,created_at)
 SELECT ('bc221000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'SYNTHETIC SEARCH Customer '||n,
 '08922'||lpad(n::text,5,'0'),'SYNTHETIC CHANNEL '||lpad(n::text,3,'0'),'SYNTHETIC Notes',
 'bc220000-0000-4000-8000-000000000002','bc220000-0000-4000-8000-000000000002',
 TIMESTAMPTZ '2026-01-01 00:00:00Z'+make_interval(secs=>n) FROM generate_series(1,260) n;
UPDATE public.sales_customers SET customer_name='SYNTHETIC literal %_\ target',intake_notes='SYNTHETIC old offpage needle',intake_channel='SYNTHETIC CHANNEL 001'
 WHERE id='bc221000-0000-4000-8000-000000000001';
UPDATE public.sales_customers SET customer_name='SYNTHETIC same name',phone='0892299999'
 WHERE id IN ('bc221000-0000-4000-8000-000000000002','bc221000-0000-4000-8000-000000000003');
UPDATE public.sales_customers SET merged_into_customer_id='bc221000-0000-4000-8000-000000000002'
 WHERE id='bc221000-0000-4000-8000-000000000004';
UPDATE public.sales_customers SET intake_status='following_up' WHERE id='bc221000-0000-4000-8000-000000000006';
INSERT INTO public.lead_project_interests(id,customer_id,project_name,owner_user_id,created_by_user_id,engagement_status) VALUES
 ('bc222000-0000-4000-8000-000000000001','bc221000-0000-4000-8000-000000000001','SYNTHETIC SEARCH A','bc220000-0000-4000-8000-000000000002','bc220000-0000-4000-8000-000000000002','considering'),
 ('bc222000-0000-4000-8000-000000000002','bc221000-0000-4000-8000-000000000001','SYNTHETIC SEARCH B','bc220000-0000-4000-8000-000000000004','bc220000-0000-4000-8000-000000000002','follow_up'),
 ('bc222000-0000-4000-8000-000000000003','bc221000-0000-4000-8000-000000000003','SYNTHETIC SEARCH CLOSED','bc220000-0000-4000-8000-000000000005','bc220000-0000-4000-8000-000000000002','lost');
INSERT INTO public.leads(id,phone) VALUES('bc223000-0000-4000-8000-000000000001','000-000-0000');
INSERT INTO public.sales_customers(id,customer_name,record_origin,legacy_source_lead_id,phone,phone_data_status,intake_status,owner_user_id,created_by_user_id,lead_created_at)
 VALUES('bc223000-0000-4000-8000-000000000002','SYNTHETIC old unknown','legacy_import','bc223000-0000-4000-8000-000000000001',NULL,'unknown_legacy','legacy_unclassified',
 'bc220000-0000-4000-8000-000000000002','bc220000-0000-4000-8000-000000000001',NULL);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','bc220000-0000-4000-8000-000000000002',true);
SELECT runtime_central_search.assert_true(public.crm_v2_central_search_capabilities()='{"contract_version":"central_search_v1","enabled":false}'::jsonb,'existing switch defaults closed');
SELECT runtime_central_search.expect_error('SELECT public.crm_v2_central_search(runtime_central_search.filters())','CRM_SETUP_REQUIRED','disabled direct search fails closed');
RESET ROLE;
UPDATE public.crm_settings SET central_intake_enabled=true WHERE id;
INSERT INTO runtime_central_search.context VALUES('before',runtime_central_search.business_snapshot());
SET LOCAL ROLE authenticated;
SELECT runtime_central_search.assert_true(public.crm_v2_capabilities()->>'contract_version'='central_intake_v1','create contract remains v1 unchanged');
INSERT INTO runtime_central_search.context VALUES('first',public.crm_v2_central_search(runtime_central_search.filters()));
INSERT INTO runtime_central_search.context VALUES('second',public.crm_v2_central_search(runtime_central_search.filters(),1));
SELECT runtime_central_search.assert_true((SELECT jsonb_array_length(value->'customers')=50 AND value->>'hasMore'='true' FROM runtime_central_search.context WHERE key='first'),'first page remains bounded with hasMore');
SELECT runtime_central_search.assert_true(NOT EXISTS(SELECT 1 FROM runtime_central_search.context a,runtime_central_search.context b,
 jsonb_array_elements(a.value->'customers') ca,jsonb_array_elements(b.value->'customers') cb
 WHERE a.key='first' AND b.key='second' AND ca->>'id'=cb->>'id'),'successive pages do not overlap on static snapshot');
SELECT runtime_central_search.assert_true((SELECT NOT EXISTS(SELECT 1 FROM jsonb_array_elements(value->'customers') c WHERE c->>'id'='bc221000-0000-4000-8000-000000000001') FROM runtime_central_search.context WHERE key='first'),'target is genuinely outside first unfiltered page');
INSERT INTO runtime_central_search.context VALUES('search',public.crm_v2_central_search(runtime_central_search.filters('{"search":"  offpage needle  "}')));
SELECT runtime_central_search.assert_true((SELECT jsonb_array_length(value->'customers')=1 AND value#>>'{customers,0,id}'='bc221000-0000-4000-8000-000000000001'
 AND value#>>'{search,filters,search}'='offpage needle' FROM runtime_central_search.context WHERE key='search'),'query finds old offpage record before pagination with canonical echo');
SELECT runtime_central_search.assert_true(jsonb_array_length(public.crm_v2_central_search(runtime_central_search.filters('{"search":"%_"}'))->'customers')=1,'percent and underscore remain literal');
SELECT runtime_central_search.assert_true(jsonb_array_length(public.crm_v2_central_search(runtime_central_search.filters(jsonb_build_object('search',chr(92))))->'customers')=1,'backslash remains literal');
SELECT runtime_central_search.assert_true(jsonb_array_length(public.crm_v2_central_search(runtime_central_search.filters('{"search":"0892299999"}'))->'customers')=2,'shared phone and name do not merge different customer IDs');
SELECT runtime_central_search.assert_true(jsonb_array_length(public.crm_v2_central_search(runtime_central_search.filters('{"channel":"SYNTHETIC CHANNEL 001"}'))->'customers')=1,'channel filter is global not page local');
SELECT runtime_central_search.assert_true(jsonb_array_length(public.crm_v2_central_search(runtime_central_search.filters('{"project":"SYNTHETIC SEARCH B","owner":"bc220000-0000-4000-8000-000000000004","status":"follow_up"}'))->'customers')=1,'same-interest project owner status matches one customer');
SELECT runtime_central_search.assert_true(public.crm_v2_central_search(runtime_central_search.filters('{"project":"SYNTHETIC SEARCH A","owner":"bc220000-0000-4000-8000-000000000004"}'))->'customers'='[]'::jsonb,'different-interest owner cannot match selected project');
SELECT runtime_central_search.assert_true(public.crm_v2_central_search(runtime_central_search.filters('{"owner":"bc220000-0000-4000-8000-000000000004","status":"considering"}'))->'customers'='[]'::jsonb,'owner and status cannot match separate interests');
SELECT runtime_central_search.assert_true(jsonb_array_length(public.crm_v2_central_search(runtime_central_search.filters('{"status":"follow_up","unassignedOnly":true}'))->'customers')=1,'central following_up alias normalized with unassigned-only');
SELECT runtime_central_search.assert_true(jsonb_array_length(public.crm_v2_central_search(runtime_central_search.filters('{"project":"SYNTHETIC SEARCH CLOSED"}'))->'customers')=1,'closed project remains searchable without enabling new intake');
SELECT runtime_central_search.assert_true((SELECT value#>'{search,projects}' ? 'SYNTHETIC SEARCH CLOSED'
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(value->'projects') p WHERE p->>'name'='SYNTHETIC SEARCH CLOSED') FROM runtime_central_search.context WHERE key='first'),'search options do not alter create project options');
SELECT runtime_central_search.assert_true((SELECT EXISTS(SELECT 1 FROM jsonb_array_elements(value#>'{search,owners}') o WHERE o->>'userId'='bc220000-0000-4000-8000-000000000005')
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(value->'salesOwners') o WHERE o->>'userId'='bc220000-0000-4000-8000-000000000005') FROM runtime_central_search.context WHERE key='first'),'historical owner discovery does not allow new inactive owner assignment');
SELECT runtime_central_search.assert_true((SELECT jsonb_array_length(value#>'{search,channels}')=200 AND value#>>'{search,hasMoreChannels}'='true'
 AND value#>'{search,channels}' ? 'SYNTHETIC CHANNEL 001' FROM runtime_central_search.context WHERE key='first'),'channel suggestions are bounded globally with explicit overflow');
SELECT runtime_central_search.assert_true(jsonb_array_length(public.crm_v2_central_search(runtime_central_search.filters('{"channel":"SYNTHETIC CHANNEL 260"}'))->'customers')=1,'exact channel beyond suggestion limit remains searchable');
SELECT runtime_central_search.assert_true(public.crm_v2_central_search(runtime_central_search.filters('{"channel":"SYNTHETIC CHANNEL 004"}'))->'customers'='[]'::jsonb,'merged identity excluded without false phone merge');
INSERT INTO runtime_central_search.context VALUES('legacy',public.crm_v2_central_search(runtime_central_search.filters('{"status":"legacy_unclassified"}')));
SELECT runtime_central_search.assert_true((SELECT value#>'{customers,0,phone}'='null'::jsonb AND value#>'{customers,0,leadCreatedAt}'='null'::jsonb FROM runtime_central_search.context WHERE key='legacy'),'unknown old phone and original date remain null');
SELECT runtime_central_search.assert_true(public.crm_v2_central_search(runtime_central_search.filters('{"search":"null"}'))->'customers'='[]'::jsonb,'null phone is not fabricated searchable text');
SELECT runtime_central_search.assert_true(public.crm_v2_central_search(runtime_central_search.filters(),100000)->'customers'='[]'::jsonb,'last allowed page returns honest empty bounded result');
SELECT runtime_central_search.expect_error('SELECT public.crm_v2_central_search(runtime_central_search.filters(),100001)','CRM_INVALID_INPUT','oversized page rejected');
SELECT runtime_central_search.expect_error('SELECT public.crm_v2_central_search(runtime_central_search.filters(),NULL)','CRM_INVALID_INPUT','null page rejected');
SELECT runtime_central_search.expect_error('SELECT public.crm_v2_central_search(NULL)','CRM_INVALID_INPUT','null scope rejected');
SELECT runtime_central_search.expect_error('SELECT public.crm_v2_central_search(''{}'')','CRM_INVALID_INPUT','missing filters rejected');
SELECT runtime_central_search.expect_error('SELECT public.crm_v2_central_search(runtime_central_search.filters(''{"role":"admin"}''))','CRM_INVALID_INPUT','extra authority filter rejected');
SELECT runtime_central_search.expect_error('SELECT public.crm_v2_central_search(runtime_central_search.filters(''{"unassignedOnly":"true"}''))','CRM_INVALID_INPUT','string boolean rejected');
SELECT runtime_central_search.expect_error('SELECT public.crm_v2_central_search(runtime_central_search.filters(''{"project":"A","unassignedOnly":true}''))','CRM_INVALID_INPUT','contradictory project scope rejected');
SELECT runtime_central_search.expect_error('SELECT public.crm_v2_central_search(runtime_central_search.filters(''{"owner":"not-uuid"}''))','CRM_INVALID_INPUT','malformed owner rejected');
SELECT runtime_central_search.expect_error('SELECT public.crm_v2_central_search(runtime_central_search.filters(''{"status":"booked"}''))','CRM_INVALID_INPUT','sale stage is not CRM followup status');
SELECT runtime_central_search.expect_error('SELECT public.crm_v2_central_search(runtime_central_search.filters(jsonb_build_object(''search'',repeat(''x'',201))))','CRM_INVALID_INPUT','overlong query rejected');
SELECT runtime_central_search.expect_error('SELECT public.crm_v2_central_search(runtime_central_search.filters(jsonb_build_object(''search'',chr(10)||''abc'')))','CRM_INVALID_INPUT','control characters rejected before trim');
SELECT runtime_central_search.assert_true(public.crm_v2_central_search(runtime_central_search.filters(jsonb_build_object('search',repeat(chr(128512),200))))#>>'{search,filters,search}'=repeat(chr(128512),200),'Unicode codepoint bound agrees with TypeScript');
SELECT runtime_central_search.assert_true(public.crm_v2_central_search(runtime_central_search.filters(jsonb_build_object('search',chr(160)||'abc'||chr(65279))))#>>'{search,filters,search}'='abc','Unicode trim agrees with TypeScript');
SELECT set_config('request.jwt.claim.sub','bc220000-0000-4000-8000-000000000001',true);
SELECT runtime_central_search.assert_true(public.crm_v2_central_search(runtime_central_search.filters())#>>'{actor,role}'='admin','Admin may read whole registry');
SELECT set_config('request.jwt.claim.sub','bc220000-0000-4000-8000-000000000003',true);
SELECT runtime_central_search.assert_true(public.crm_v2_central_search(runtime_central_search.filters())#>>'{actor,role}'='owner','Owner may read whole registry');
SELECT set_config('request.jwt.claim.sub','bc220000-0000-4000-8000-000000000004',true);
SELECT runtime_central_search.assert_true(jsonb_array_length(public.crm_v2_central_search(runtime_central_search.filters('{"search":"offpage needle"}'))->'customers')=1,'other Sales reads all projects without ownership write permission');
SELECT set_config('request.jwt.claim.sub','bc220000-0000-4000-8000-000000000005',true);
SELECT runtime_central_search.expect_error('SELECT public.crm_v2_central_search(runtime_central_search.filters())','CRM_FORBIDDEN','inactive mapped account denied');
SELECT set_config('request.jwt.claim.sub','bc220000-0000-4000-8000-000000000006',true);
SELECT runtime_central_search.expect_error('SELECT public.crm_v2_central_search(runtime_central_search.filters())','CRM_FORBIDDEN','unmapped account denied');
SELECT set_config('request.jwt.claim.sub','',true);
SELECT runtime_central_search.expect_error('SELECT public.crm_v2_central_search(runtime_central_search.filters())','CRM_FORBIDDEN','missing user denied');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT runtime_central_search.expect_error('SELECT public.crm_v2_central_search(runtime_central_search.filters())',NULL,'anonymous caller has no reader grant');
SELECT runtime_central_search.expect_error('SELECT public.crm_v2_central_search_capabilities()',NULL,'anonymous caller has no capabilities grant');
RESET ROLE;
SELECT runtime_central_search.assert_true(runtime_central_search.business_snapshot()=(SELECT value FROM runtime_central_search.context WHERE key='before'),'search leaves every business snapshot table unchanged');
SET TRANSACTION READ ONLY;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','bc220000-0000-4000-8000-000000000002',true);
DO $read_only$
BEGIN
  IF current_setting('transaction_read_only')<>'on' OR jsonb_array_length(public.crm_v2_central_search(runtime_central_search.filters())->'customers')<>50 THEN
    RAISE EXCEPTION 'READ_ONLY_CENTRAL_SEARCH_FAILED';
  END IF;
END;
$read_only$;
SELECT 'CENTRAL_SEARCH_SNAPSHOT:'||value::text FROM runtime_central_search.context WHERE key='search';
SELECT 'CENTRAL_SEARCH_RUNTIME:'||jsonb_build_object('suite','central_search','assertions',(SELECT count(*)+1 FROM runtime_central_search.assertions),
 'readOnlyTransaction',true,'syntheticOnly',true,'realDatabaseTested',false,'productionCertified',false)::text;
ROLLBACK;
