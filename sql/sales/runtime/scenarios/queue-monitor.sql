-- SYNTHETIC LOCAL MONITOR TESTS ONLY. Every fixture and assertion rolls back.
-- No worker invocation, real user, external connection or Cron binding.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $isolation$
BEGIN
  IF current_database() !~ '^buildtrack_sales_runtime_'
    OR current_setting('buildtrack.synthetic_runtime',true) IS DISTINCT FROM 'on'
    OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet THEN
    RAISE EXCEPTION 'REFUSED: queue monitor requires isolated synthetic loopback runner';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    RAISE EXCEPTION 'REFUSED: synthetic monitor service role must not exist';
  END IF;
END;
$isolation$;
-- Earlier synthetic burst suites retain their immutable history. Only their
-- mutable workset/control pointers are isolated here, and restored by ROLLBACK.
UPDATE public.crm_sla_tasks SET status='cancelled' WHERE status='open';
UPDATE sales_private.crm_first_contact_cycle_cursor SET after_created_at=NULL,after_task_id=NULL WHERE id;
UPDATE sales_private.crm_first_contact_dispatch_control SET current_request_id=NULL WHERE id;
CREATE ROLE service_role NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO service_role;
CREATE SCHEMA runtime_monitor;
CREATE TABLE runtime_monitor.assertions(label text PRIMARY KEY);
CREATE TABLE runtime_monitor.context(key text PRIMARY KEY,value jsonb NOT NULL);
GRANT USAGE ON SCHEMA runtime_monitor TO authenticated,anon,service_role,buildtrack_sales_sla_worker,buildtrack_sales_sla_dispatcher;
GRANT SELECT,INSERT,UPDATE ON runtime_monitor.assertions,runtime_monitor.context TO authenticated,anon,service_role,buildtrack_sales_sla_worker,buildtrack_sales_sla_dispatcher;
CREATE FUNCTION runtime_monitor.assert_true(condition boolean,label text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $assert$
BEGIN
  IF condition IS DISTINCT FROM true THEN RAISE EXCEPTION 'ASSERTION FAILED: %',label; END IF;
  INSERT INTO runtime_monitor.assertions VALUES(label);
END;
$assert$;
CREATE FUNCTION runtime_monitor.expect_error(statement text,expected_state text,expected_message text,label text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $expect$
DECLARE actual_state text; actual_message text;
BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS actual_state=RETURNED_SQLSTATE,actual_message=MESSAGE_TEXT;
    IF actual_state<>expected_state OR (expected_message IS NOT NULL AND actual_message<>expected_message) THEN
      RAISE EXCEPTION 'ASSERTION FAILED: %; expected [%] %, received [%] %',label,expected_state,expected_message,actual_state,actual_message;
    END IF;
    INSERT INTO runtime_monitor.assertions VALUES(label); RETURN;
  END;
  RAISE EXCEPTION 'ASSERTION FAILED: %; expected error',label;
END;
$expect$;
CREATE FUNCTION runtime_monitor.business_snapshot()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $business$
  SELECT jsonb_build_object(
    'settings',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.crm_settings r),
    'customers',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.sales_customers r),
    'tasks',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.crm_sla_tasks r),
    'notices',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.crm_notifications r),
    'audits',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.crm_audit_events r),
    'cursor',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM sales_private.crm_first_contact_cycle_cursor r),
    'manual',(SELECT jsonb_agg(to_jsonb(r) ORDER BY actor_user_id,request_id) FROM sales_private.crm_first_contact_processing_requests r),
    'cycles',(SELECT jsonb_agg(to_jsonb(r) ORDER BY actor_user_id,request_id) FROM sales_private.crm_first_contact_cycle_requests r),
    'worker',(SELECT jsonb_agg(to_jsonb(r) ORDER BY request_id) FROM sales_private.crm_first_contact_worker_requests r),
    'workerCycles',(SELECT jsonb_agg(to_jsonb(r) ORDER BY request_id) FROM sales_private.crm_first_contact_worker_cycles r),
    'requests',(SELECT jsonb_agg(to_jsonb(r) ORDER BY request_id) FROM sales_private.crm_first_contact_dispatch_requests r),
    'attempts',(SELECT jsonb_agg(to_jsonb(r) ORDER BY attempt_id) FROM sales_private.crm_first_contact_dispatch_attempts r),
    'control',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM sales_private.crm_first_contact_dispatch_control r),
    'admissions',(SELECT jsonb_agg(to_jsonb(r) ORDER BY attempt_id) FROM sales_private.crm_first_contact_dispatch_admissions r));
$business$;
REVOKE ALL ON FUNCTION runtime_monitor.business_snapshot() FROM PUBLIC;
INSERT INTO auth.users(id) VALUES
 ('bc170000-0000-4000-8000-000000000001'),('bc170000-0000-4000-8000-000000000002'),
 ('bc170000-0000-4000-8000-000000000003'),('bc170000-0000-4000-8000-000000000004');
INSERT INTO sales_private.crm_user_roles(user_id,role,display_name,is_active) VALUES
 ('bc170000-0000-4000-8000-000000000001','admin','SYNTHETIC monitor Admin',true),
 ('bc170000-0000-4000-8000-000000000002','sales','SYNTHETIC monitor Sales',true),
 ('bc170000-0000-4000-8000-000000000003','owner','SYNTHETIC monitor Owner',true),
 ('bc170000-0000-4000-8000-000000000004','admin','SYNTHETIC inactive Admin',false);
INSERT INTO public.crm_settings(id,central_intake_enabled,lead_work_enabled,lead_lifecycle_enabled,work_schedule_enabled,
 notifications_enabled,sla_preview_enabled,sla_processing_enabled,sla_cycle_enabled,sla_worker_enabled,sla_dispatcher_enabled,sla_burst_enabled)
VALUES(true,true,true,true,true,true,true,false,false,false,false,false)
ON CONFLICT(id) DO UPDATE SET central_intake_enabled=true,lead_work_enabled=true,lead_lifecycle_enabled=true,
 work_schedule_enabled=true,notifications_enabled=true,sla_preview_enabled=true,sla_processing_enabled=false,
 sla_cycle_enabled=false,sla_worker_enabled=false,sla_dispatcher_enabled=false,sla_burst_enabled=false;
SELECT runtime_monitor.assert_true((SELECT NOT sla_queue_monitor_enabled FROM public.crm_settings WHERE id),'monitor defaults off');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','bc170000-0000-4000-8000-000000000001',true);
SELECT runtime_monitor.assert_true(public.crm_v2_queue_monitor_capabilities()='{"contract_version":"first_contact_queue_monitor_v1","enabled":false}'::jsonb,'Admin capability remains disabled by new gate');
SELECT runtime_monitor.expect_error('SELECT public.crm_v2_queue_monitor_snapshot()','P0001','CRM_QUEUE_MONITOR_SETUP_REQUIRED','default off denies monitor snapshot');
RESET ROLE;
UPDATE public.crm_settings SET sla_queue_monitor_enabled=true WHERE id;
SET LOCAL ROLE authenticated;
SELECT runtime_monitor.assert_true(public.crm_v2_queue_monitor_capabilities()->'enabled'='true'::jsonb,'read capability enabled while all writers remain off');
INSERT INTO runtime_monitor.context VALUES('empty',public.crm_v2_queue_monitor_snapshot());
SELECT runtime_monitor.assert_true((SELECT value#>'{candidates,sampleCount}'='0'::jsonb AND value#>'{candidates,exact}'='true'::jsonb
 AND value->'currentRequest'='null'::jsonb AND value->'deliveryLatencySeconds'='null'::jsonb AND value->'sweepAgeSeconds'='null'::jsonb
 AND value->'readOnly'='true'::jsonb AND value->'targetSeconds'='300'::jsonb
 AND value->'actor'='{"userId":"bc170000-0000-4000-8000-000000000001","role":"admin"}'::jsonb
 AND value->'gates'='{"processing":false,"cycle":false,"worker":false,"dispatcher":false,"burst":false}'::jsonb
 FROM runtime_monitor.context WHERE key='empty'),'empty read is explicit bounded evidence not latency proof');
SELECT set_config('request.jwt.claim.sub','bc170000-0000-4000-8000-000000000002',true);
SELECT set_config('request.jwt.claims','{"role":"admin","user_metadata":{"role":"admin"}}',true);
SELECT runtime_monitor.assert_true(public.crm_v2_queue_monitor_capabilities()->'enabled'='false'::jsonb,'Sales cannot enable capability with spoofed claims');
SELECT runtime_monitor.expect_error('SELECT public.crm_v2_queue_monitor_snapshot()','P0001','CRM_QUEUE_MONITOR_FORBIDDEN','Sales cannot spoof Admin');
SELECT set_config('request.jwt.claim.sub','bc170000-0000-4000-8000-000000000003',true);
SELECT runtime_monitor.expect_error('SELECT public.crm_v2_queue_monitor_snapshot()','P0001','CRM_QUEUE_MONITOR_FORBIDDEN','Owner denied Admin monitor');
SELECT set_config('request.jwt.claim.sub','bc170000-0000-4000-8000-000000000004',true);
SELECT runtime_monitor.expect_error('SELECT public.crm_v2_queue_monitor_snapshot()','P0001','CRM_QUEUE_MONITOR_FORBIDDEN','inactive Admin denied monitor');
SELECT set_config('request.jwt.claim.sub','',true);
SELECT set_config('request.jwt.claims','',true);
SELECT runtime_monitor.expect_error('SELECT public.crm_v2_queue_monitor_snapshot()','P0001','CRM_QUEUE_MONITOR_FORBIDDEN','missing identity denied monitor');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.sub','bc170000-0000-4000-8000-000000000001',true);
SELECT runtime_monitor.expect_error('SELECT public.crm_v2_queue_monitor_snapshot()','42501',NULL,'anon with Admin sub lacks snapshot grant');
SELECT runtime_monitor.expect_error('SELECT public.crm_v2_queue_monitor_capabilities()','42501',NULL,'anon lacks capability grant');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT runtime_monitor.expect_error('SELECT public.crm_v2_queue_monitor_snapshot()','42501',NULL,'synthetic service role cannot spoof Admin with JWT sub');
RESET ROLE;
SET LOCAL ROLE buildtrack_sales_sla_worker;
SELECT runtime_monitor.expect_error('SELECT public.crm_v2_queue_monitor_snapshot()','42501',NULL,'worker lacks monitor grant');
RESET ROLE;
SET LOCAL ROLE buildtrack_sales_sla_dispatcher;
SELECT runtime_monitor.expect_error('SELECT public.crm_v2_queue_monitor_snapshot()','42501',NULL,'dispatcher lacks monitor grant');
RESET ROLE;

-- Each read gate is independently required. Fixture toggles are not application commands.
DO $gates$
DECLARE gate text;
BEGIN
  FOREACH gate IN ARRAY ARRAY['central_intake_enabled','lead_work_enabled','lead_lifecycle_enabled','work_schedule_enabled',
    'notifications_enabled','sla_preview_enabled','sla_queue_monitor_enabled'] LOOP
    EXECUTE format('UPDATE public.crm_settings SET %I=false WHERE id',gate);
    PERFORM runtime_monitor.expect_error('SELECT public.crm_v2_queue_monitor_snapshot()','P0001','CRM_QUEUE_MONITOR_SETUP_REQUIRED','gate required: '||gate);
    EXECUTE format('UPDATE public.crm_settings SET %I=true WHERE id',gate);
  END LOOP;
END;
$gates$;

INSERT INTO public.sales_customers(id,customer_name,phone,owner_user_id,created_by_user_id,owner_assigned_at,lead_created_at,created_at,updated_at)
SELECT ('bc170000-0000-4000-8000-'||lpad((10000+i)::text,12,'0'))::uuid,'SYNTHETIC SECRET customer '||i,
 '00017'||lpad(i::text,5,'0'),'bc170000-0000-4000-8000-000000000002','bc170000-0000-4000-8000-000000000002',
 transaction_timestamp()-interval '1 hour',transaction_timestamp()-interval '1 hour',transaction_timestamp()-interval '1 hour',transaction_timestamp()-interval '1 hour'
FROM generate_series(1,902) i;
INSERT INTO public.crm_sla_tasks(id,customer_id,owner_user_id,task_type,obligation_started_at,service_due_at,created_at,evaluation_snapshot)
SELECT ('bc170000-0000-4000-8000-'||lpad((20000+i)::text,12,'0'))::uuid,
 ('bc170000-0000-4000-8000-'||lpad((10000+i)::text,12,'0'))::uuid,'bc170000-0000-4000-8000-000000000002',
 'first_contact',transaction_timestamp()-interval '1 hour',transaction_timestamp()+interval '23 hours',transaction_timestamp()-interval '1 hour',
 CASE i%4 WHEN 0 THEN '{"processingReview":{"state":"held","reason":"SECRET"}}'::jsonb
 WHEN 1 THEN '{"processingReview":{"state":"ready"}}'::jsonb WHEN 2 THEN '{}'::jsonb
 ELSE '{"processingReview":{"state":["held"],"reason":"SECRET"}}'::jsonb END
FROM generate_series(1,900) i;
SELECT runtime_monitor.assert_true(public.crm_v2_queue_monitor_snapshot()->'candidates'=
 '{"sampleCount":900,"exact":true,"scanLimit":901,"storedHeldCount":225,"withoutStoredReviewCount":450}'::jsonb,'900 candidates exact with stored-only held and malformed review counts');
INSERT INTO public.crm_sla_tasks(id,customer_id,owner_user_id,task_type,obligation_started_at,service_due_at,created_at,evaluation_snapshot)
SELECT ('bc170000-0000-4000-8000-'||lpad((20000+i)::text,12,'0'))::uuid,
 ('bc170000-0000-4000-8000-'||lpad((10000+i)::text,12,'0'))::uuid,'bc170000-0000-4000-8000-000000000002',
 'first_contact',transaction_timestamp()-interval '1 hour',transaction_timestamp()+interval '23 hours',transaction_timestamp()-interval '1 hour',
 CASE WHEN i=901 THEN '{"processingReview":{"state":"ready"}}'::jsonb ELSE '{}'::jsonb END FROM generate_series(901,902) i;
SELECT runtime_monitor.assert_true(public.crm_v2_queue_monitor_snapshot()->'candidates'=
 '{"sampleCount":901,"exact":false,"scanLimit":901,"storedHeldCount":225,"withoutStoredReviewCount":450}'::jsonb,'901 prefix is explicit lower-bound not total902');
UPDATE public.crm_sla_tasks SET evaluation_snapshot='{"processingReview":{"state":"completed"}}'::jsonb WHERE id='bc170000-0000-4000-8000-000000020002';
UPDATE public.crm_sla_tasks SET evaluation_snapshot='{"processingReview":{"state":"closed"}}'::jsonb WHERE id='bc170000-0000-4000-8000-000000020003';
SELECT runtime_monitor.assert_true(public.crm_v2_queue_monitor_snapshot()#>'{candidates,withoutStoredReviewCount}'='448'::jsonb,'completed and closed are recognized stored assessments');
UPDATE sales_private.crm_first_contact_cycle_cursor SET after_created_at=transaction_timestamp()-interval '1 hour',
 after_task_id='bc170000-0000-4000-8000-000000020010' WHERE id;
SELECT runtime_monitor.assert_true(public.crm_v2_queue_monitor_snapshot()#>>'{cursor,afterTaskId}'='bc170000-0000-4000-8000-000000020010'
 AND public.crm_v2_queue_monitor_snapshot()->'sweepAgeSeconds'='null'::jsonb,'cursor position never invents sweep age');

-- Append distinct synthetic requests/attempts; never disable immutable guards.
CREATE FUNCTION runtime_monitor.seed_dispatch(sequence_number integer,status_value text,policy_value text,receipt_mode text DEFAULT 'valid')
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $seed$
DECLARE request_value uuid:=('bc170000-0000-4000-8000-'||lpad((30000+sequence_number)::text,12,'0'))::uuid;
  attempt_value uuid:=('bc170000-0000-4000-8000-'||lpad((40000+sequence_number)::text,12,'0'))::uuid;
  created_value timestamptz:=transaction_timestamp()-interval '10 minutes'; response_value jsonb;
BEGIN
  INSERT INTO sales_private.crm_first_contact_dispatch_requests(request_id,created_at,status,attempt_count,current_attempt_id,next_attempt_at,completed_at,last_error_code,policy_version)
    VALUES(request_value,created_value,status_value,1,attempt_value,created_value+interval '1 minute',
      CASE WHEN status_value='completed' THEN created_value+interval '10 seconds' ELSE NULL END,
      CASE status_value WHEN 'review' THEN 'PROCESSING_REVIEW' WHEN 'retry_wait' THEN 'TRANSIENT_RETRY' ELSE NULL END,policy_value);
  INSERT INTO sales_private.crm_first_contact_dispatch_attempts(attempt_id,request_id,attempt_no,prepared_at,prepared_xid)
    VALUES(attempt_value,request_value,1,created_value,pg_current_xact_id());
  IF (status_value='completed' AND receipt_mode<>'missing') OR receipt_mode='unexpected' THEN
    response_value:=jsonb_build_object('actor',jsonb_build_object('kind','system','name','first_contact_worker_v1'),
      'requestId',request_value,'startedAt',created_value+interval '1 second','finishedAt',created_value+interval '9 seconds',
      'replayed',false,'maxItems',10,'processedCount',3,'sweepFinished',true,'private','SECRET',
      'receipts',jsonb_build_array(
        jsonb_build_object('actor',jsonb_build_object('kind','system','name','first_contact_worker_v1'),'outcome','held','reason','SECRET'),
        jsonb_build_object('actor',jsonb_build_object('kind','system','name','first_contact_worker_v1'),'outcome','notified','reason','SECRET'),
        jsonb_build_object('actor',jsonb_build_object('kind','system','name','first_contact_worker_v1'),'outcome','already_notified','reason','SECRET')));
    IF receipt_mode='malformed' THEN response_value:=jsonb_set(response_value,'{receipts}','"SECRET"'::jsonb); END IF;
    IF receipt_mode='badactor' THEN response_value:=jsonb_set(response_value,'{actor}','{"role":"admin"}'::jsonb); END IF;
    IF receipt_mode='badtime' THEN response_value:=jsonb_set(response_value,'{startedAt}','"not-a-date"'::jsonb); END IF;
    IF receipt_mode='badcounts' THEN response_value:=jsonb_set(response_value,'{processedCount}','4'::jsonb); END IF;
    INSERT INTO sales_private.crm_first_contact_worker_cycles(request_id,response,created_at)
      VALUES(request_value,response_value,created_value+interval '9 seconds');
  END IF;
  UPDATE sales_private.crm_first_contact_dispatch_control SET current_request_id=request_value WHERE id;
  RETURN request_value;
END;
$seed$;
REVOKE ALL ON FUNCTION runtime_monitor.seed_dispatch(integer,text,text,text) FROM PUBLIC;
SELECT runtime_monitor.seed_dispatch(1,'reserved','completion_spacing_v1');
SELECT runtime_monitor.assert_true(public.crm_v2_queue_monitor_snapshot()#>>'{currentRequest,status}'='reserved'
 AND public.crm_v2_queue_monitor_snapshot()#>'{currentRequest,receipt}'='null'::jsonb,'expired reservation remains uncertain reserved not marked failed');
SELECT runtime_monitor.seed_dispatch(2,'retry_wait','completion_spacing_v1');
SELECT runtime_monitor.assert_true(public.crm_v2_queue_monitor_snapshot()#>>'{currentRequest,lastErrorCode}'='TRANSIENT_RETRY','retry wait retains classified code without scheduling retry');
SELECT runtime_monitor.seed_dispatch(3,'review','bounded_burst_v2');
SELECT runtime_monitor.assert_true(public.crm_v2_queue_monitor_snapshot()#>>'{currentRequest,status}'='review'
 AND public.crm_v2_queue_monitor_snapshot()#>>'{currentRequest,policyVersion}'='bounded_burst_v2','terminal review readable with burst writer gate off');
SELECT runtime_monitor.seed_dispatch(4,'completed','completion_spacing_v1');
SELECT runtime_monitor.assert_true(public.crm_v2_queue_monitor_snapshot()#>'{currentRequest,receipt,heldCount}'='1'::jsonb
 AND public.crm_v2_queue_monitor_snapshot()#>'{currentRequest,receipt,notifiedCount}'='1'::jsonb
 AND public.crm_v2_queue_monitor_snapshot()#>'{currentRequest,receipt,processedCount}'='3'::jsonb,'completed cycle counts held and new notified only excluding already notified');
SELECT runtime_monitor.seed_dispatch(5,'completed','bounded_burst_v2');
INSERT INTO runtime_monitor.context VALUES('complete',public.crm_v2_queue_monitor_snapshot());
SELECT runtime_monitor.assert_true((SELECT value#>>'{currentRequest,policyVersion}'='bounded_burst_v2'
 AND value::text NOT LIKE '%SECRET%' AND value::text NOT LIKE '%receipts%' AND value::text NOT LIKE '%customer_name%'
 AND value::text NOT LIKE '%prepared_xid%' FROM runtime_monitor.context WHERE key='complete'),'burst summary whitelist excludes child receipts raw errors customer data and transaction identifiers');

DO $bad_receipts$
DECLARE mode text; sequence_number integer:=100;
BEGIN
  FOREACH mode IN ARRAY ARRAY['missing','malformed','badactor','badtime','badcounts'] LOOP
    sequence_number:=sequence_number+1;
    PERFORM runtime_monitor.seed_dispatch(sequence_number,'completed','bounded_burst_v2',mode);
    PERFORM runtime_monitor.expect_error('SELECT public.crm_v2_queue_monitor_snapshot()','P0001','CRM_QUEUE_MONITOR_SETUP_REQUIRED','invalid completed receipt fails closed: '||mode);
  END LOOP;
  PERFORM runtime_monitor.seed_dispatch(110,'reserved','bounded_burst_v2','unexpected');
  PERFORM runtime_monitor.expect_error('SELECT public.crm_v2_queue_monitor_snapshot()','P0001','CRM_QUEUE_MONITOR_SETUP_REQUIRED','receipt for uncompleted current request fails closed');
END;
$bad_receipts$;
UPDATE sales_private.crm_first_contact_dispatch_control SET current_request_id='bc170000-0000-4000-8000-000000030005' WHERE id;
SET CONSTRAINTS ALL IMMEDIATE;
INSERT INTO runtime_monitor.context VALUES('before',runtime_monitor.business_snapshot());
SET LOCAL ROLE authenticated;
SELECT runtime_monitor.expect_error('SELECT * FROM sales_private.crm_first_contact_dispatch_requests','42501',NULL,'Admin cannot bypass snapshot via private request table');
SELECT runtime_monitor.expect_error('SELECT sales_private.crm_first_contact_dispatch_prepare()','42501',NULL,'Admin monitor does not grant dispatcher action');
INSERT INTO runtime_monitor.context VALUES('readonly',public.crm_v2_queue_monitor_snapshot());
RESET ROLE;
SELECT runtime_monitor.assert_true(runtime_monitor.business_snapshot()=(SELECT value FROM runtime_monitor.context WHERE key='before'),'monitor and denied operations leave all settings business rows receipts admissions and cursor unchanged');

-- No fixture writes after this point. The read must work in an actual read-only
-- transaction mode; the assertion uses an exception rather than a test INSERT.
SET TRANSACTION READ ONLY;
SET LOCAL ROLE authenticated;
DO $read_only$
DECLARE value jsonb;
BEGIN
  value:=public.crm_v2_queue_monitor_snapshot();
  IF current_setting('transaction_read_only')<>'on' OR value->'readOnly'<>'true'::jsonb
    OR value#>>'{currentRequest,status}'<>'completed' THEN RAISE EXCEPTION 'READ_ONLY_MONITOR_FAILED'; END IF;
END;
$read_only$;
SELECT 'QUEUE_MONITOR_SNAPSHOT:'||public.crm_v2_queue_monitor_snapshot()::text;
SELECT 'QUEUE_MONITOR_RUNTIME:'||jsonb_build_object('suite','queue_monitor','assertions',(SELECT count(*)+1 FROM runtime_monitor.assertions),
 'readOnlyTransaction',true,'liveLatencyMeasured',false,'realDatabaseTested',false)::text;
ROLLBACK;
