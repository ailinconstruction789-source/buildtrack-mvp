-- SYNTHETIC LOCAL RECEIPT-REVIEW SCENARIOS ONLY. NEVER run on Supabase/existing DB.
-- Requires the isolated runner/bootstrap and locally compiled base + 04--10.
-- All identities, Lead/contact data and historical timestamps are FAKE. All
-- fixture/RPC effects and helper objects roll back at the end of this file.
-- Ordinary authenticated/anon roles exercise authority; privileged setup is not
-- an application/import workflow and does not establish production compatibility.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $isolation$
BEGIN
  IF current_database() !~ '^buildtrack_sales_runtime_'
    OR current_setting('buildtrack.synthetic_runtime',true) IS DISTINCT FROM 'on'
    OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet THEN
    RAISE EXCEPTION 'REFUSED: receipt-review scenarios require the isolated synthetic loopback runner';
  END IF;
END;
$isolation$;

CREATE SCHEMA runtime_receipt_review;
GRANT USAGE ON SCHEMA runtime_receipt_review TO authenticated,anon;
CREATE TABLE runtime_receipt_review.assertions(label text PRIMARY KEY);
CREATE TABLE runtime_receipt_review.context(key text PRIMARY KEY,value jsonb NOT NULL);
GRANT SELECT,INSERT,UPDATE ON runtime_receipt_review.assertions,runtime_receipt_review.context TO authenticated,anon;
CREATE FUNCTION runtime_receipt_review.assert_true(condition boolean,label text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $assert$
BEGIN
  IF condition IS DISTINCT FROM true THEN RAISE EXCEPTION 'ASSERTION FAILED: %',label; END IF;
  INSERT INTO runtime_receipt_review.assertions VALUES(label);
END;
$assert$;
CREATE FUNCTION runtime_receipt_review.expect_error(statement text,expected_state text,expected_message text,label text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $expect$
DECLARE actual_state text; actual_message text;
BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS actual_state=RETURNED_SQLSTATE,actual_message=MESSAGE_TEXT;
    IF actual_state<>expected_state OR (expected_message IS NOT NULL AND actual_message<>expected_message) THEN
      RAISE EXCEPTION 'ASSERTION FAILED: %; expected [%] %, received [%] %',label,expected_state,expected_message,actual_state,actual_message;
    END IF;
    INSERT INTO runtime_receipt_review.assertions VALUES(label); RETURN;
  END;
  RAISE EXCEPTION 'ASSERTION FAILED: %; expected an error but statement succeeded',label;
END;
$expect$;
CREATE FUNCTION runtime_receipt_review.iso(value timestamptz)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $iso$
  SELECT to_char(value AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
$iso$;
-- Installer-only exact business-state snapshot. Assertion/context bookkeeping,
-- intentionally toggled flags and role setup are excluded; no app role is granted
-- access to the private source tables through this SECURITY INVOKER test helper.
CREATE FUNCTION runtime_receipt_review.business_snapshot()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $snapshot$
  SELECT jsonb_build_object(
    'customers',(SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY id),'[]'::jsonb) FROM public.sales_customers c),
    'tasks',(SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb) FROM public.crm_sla_tasks t),
    'notices',(SELECT COALESCE(jsonb_agg(to_jsonb(n) ORDER BY id),'[]'::jsonb) FROM public.crm_notifications n),
    'audits',(SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY id),'[]'::jsonb) FROM public.crm_audit_events a),
    'receipts',(SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY actor_user_id,request_id),'[]'::jsonb)
      FROM sales_private.crm_first_contact_processing_requests r));
$snapshot$;
REVOKE ALL ON FUNCTION runtime_receipt_review.business_snapshot() FROM PUBLIC,anon,authenticated;

INSERT INTO auth.users(id) VALUES
 ('fc120000-0000-4000-8000-000000000001'), -- Admin A
 ('fc120000-0000-4000-8000-000000000002'), -- Sales
 ('fc120000-0000-4000-8000-000000000003'), -- Admin B
 ('fc120000-0000-4000-8000-000000000004'), -- Owner
 ('fc120000-0000-4000-8000-000000000005'), -- inactive Admin
 ('fc120000-0000-4000-8000-000000000006'); -- unmapped Auth identity
INSERT INTO sales_private.crm_user_roles(user_id,role,display_name,is_active) VALUES
 ('fc120000-0000-4000-8000-000000000001','admin','SYNTHETIC Receipt Admin A',true),
 ('fc120000-0000-4000-8000-000000000002','sales','SYNTHETIC Receipt Sales',true),
 ('fc120000-0000-4000-8000-000000000003','admin','SYNTHETIC Receipt Admin B',true),
 ('fc120000-0000-4000-8000-000000000004','owner','SYNTHETIC Receipt Owner',true),
 ('fc120000-0000-4000-8000-000000000005','admin','SYNTHETIC inactive Receipt Admin',false);
INSERT INTO public.crm_settings(id,central_intake_enabled,lead_work_enabled,lead_lifecycle_enabled,
 work_schedule_enabled,notifications_enabled,sla_preview_enabled,sla_processing_enabled)
VALUES(true,true,true,true,true,true,true,true)
ON CONFLICT(id) DO UPDATE SET central_intake_enabled=true,lead_work_enabled=true,lead_lifecycle_enabled=true,
 work_schedule_enabled=true,notifications_enabled=true,sla_preview_enabled=true,sla_processing_enabled=true;
INSERT INTO runtime_receipt_review.context VALUES('base_time',to_jsonb(clock_timestamp()));

-- Real intake RPC creates original task/audit rows with synthetic identifiers.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','fc120000-0000-4000-8000-000000000002',true);
SELECT set_config('request.jwt.claims','',true);
INSERT INTO runtime_receipt_review.context VALUES('lead',public.crm_v2_create_customer(
 'fc120000-0000-4000-8000-000000002001',
 '{"name":"SYNTHETIC receipt Lead","phone":"0000010201","channel":"runtime-test","notes":"FAKE ONLY","interests":[]}'::jsonb));
INSERT INTO runtime_receipt_review.context VALUES('other_lead',public.crm_v2_create_customer(
 'fc120000-0000-4000-8000-000000002002',
 '{"name":"SYNTHETIC other receipt Lead","phone":"0000010202","channel":"runtime-test","notes":"FAKE ONLY","interests":[]}'::jsonb));
RESET ROLE;
-- Explicitly fabricated historical source evidence: not a real backfill/import.
UPDATE public.sales_customers SET lead_created_at=(SELECT (value#>>'{}')::timestamptz-interval '25 hours' FROM runtime_receipt_review.context WHERE key='base_time'),
 owner_assigned_at=(SELECT (value#>>'{}')::timestamptz-interval '25 hours' FROM runtime_receipt_review.context WHERE key='base_time'),
 created_at=(SELECT (value#>>'{}')::timestamptz-interval '25 hours' FROM runtime_receipt_review.context WHERE key='base_time')
 WHERE id=(SELECT (value->>'customerId')::uuid FROM runtime_receipt_review.context WHERE key='lead');
UPDATE public.crm_sla_tasks t SET obligation_started_at=c.lead_created_at,service_due_at=c.lead_created_at+interval '24 hours',created_at=c.lead_created_at
 FROM public.sales_customers c WHERE c.id=t.customer_id
 AND c.id=(SELECT (value->>'customerId')::uuid FROM runtime_receipt_review.context WHERE key='lead');
UPDATE public.crm_audit_events a SET occurred_at=c.lead_created_at,recorded_at=c.lead_created_at
 FROM public.sales_customers c WHERE a.customer_id=c.id AND a.event_type='created'
 AND c.id=(SELECT (value->>'customerId')::uuid FROM runtime_receipt_review.context WHERE key='lead');
INSERT INTO runtime_receipt_review.context
 SELECT 'command_a',jsonb_build_object('requestId','fc120000-0000-4000-8000-000000001001','taskId',id)
 FROM public.crm_sla_tasks WHERE customer_id=(SELECT (value->>'customerId')::uuid FROM runtime_receipt_review.context WHERE key='lead');
INSERT INTO runtime_receipt_review.context
 SELECT 'command_b',value||jsonb_build_object('requestId','fc120000-0000-4000-8000-000000001002') FROM runtime_receipt_review.context WHERE key='command_a';
INSERT INTO runtime_receipt_review.context
 SELECT 'wrong_task',jsonb_build_object('requestId','fc120000-0000-4000-8000-000000001001','taskId',id)
 FROM public.crm_sla_tasks WHERE customer_id=(SELECT (value->>'customerId')::uuid FROM runtime_receipt_review.context WHERE key='other_lead');

-- Actual Admin schedule/processing produces a real synthetic notification/receipt.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','fc120000-0000-4000-8000-000000000001',true);
INSERT INTO runtime_receipt_review.context
 SELECT 'calendar',public.crm_v2_publish_work_schedule('fc120000-0000-4000-8000-000000002003',jsonb_build_object(
 'salesUserId','fc120000-0000-4000-8000-000000000002','expectedVersion',NULL,
 'coverage',jsonb_build_object('startsAt',runtime_receipt_review.iso((value#>>'{}')::timestamptz-interval '2 days'),
   'endsAt',runtime_receipt_review.iso((value#>>'{}')::timestamptz+interval '2 days')),
 'periods',jsonb_build_array(jsonb_build_object('type','work','startsAt',runtime_receipt_review.iso((value#>>'{}')::timestamptz-interval '2 days'),
   'endsAt',runtime_receipt_review.iso((value#>>'{}')::timestamptz+interval '2 days'))),'confirmedComplete',true,'reason','SYNTHETIC receipt test coverage'))
 FROM runtime_receipt_review.context WHERE key='base_time';
INSERT INTO runtime_receipt_review.context SELECT 'original_a',public.crm_v2_process_first_contact(value) FROM runtime_receipt_review.context WHERE key='command_a';
SELECT runtime_receipt_review.assert_true((SELECT value->>'outcome'='notified' AND value->'replayed'='false'::jsonb FROM runtime_receipt_review.context WHERE key='original_a'),'fixture processor creates actual notification and original receipt');
SELECT set_config('request.jwt.claim.sub','fc120000-0000-4000-8000-000000000003',true);
INSERT INTO runtime_receipt_review.context SELECT 'original_b',public.crm_v2_process_first_contact(value) FROM runtime_receipt_review.context WHERE key='command_b';
SELECT runtime_receipt_review.assert_true((SELECT value->>'outcome'='already_notified' FROM runtime_receipt_review.context WHERE key='original_b'),'other Admin has own distinct processing receipt');
RESET ROLE;

-- A deliberately fabricated receipt with surplus synthetic private fields tests
-- the projection boundary; this INSERT is fixture setup, never a production API.
INSERT INTO sales_private.crm_first_contact_processing_requests(actor_user_id,request_id,task_id,request_payload,response,created_at)
 SELECT 'fc120000-0000-4000-8000-000000000001','fc120000-0000-4000-8000-000000001003',(value->>'taskId')::uuid,
 jsonb_build_object('requestId','fc120000-0000-4000-8000-000000001003','taskId',value->'taskId'),
 value||jsonb_build_object('requestId','fc120000-0000-4000-8000-000000001003','privateSentinel','SYNTHETIC SECRET',
   'actor',(value->'actor')||jsonb_build_object('privateSentinel','SYNTHETIC ACTOR SECRET')),clock_timestamp()
 FROM runtime_receipt_review.context WHERE key='original_a';
INSERT INTO runtime_receipt_review.context VALUES('before_reads',runtime_receipt_review.business_snapshot());

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','fc120000-0000-4000-8000-000000000001',true);
SELECT runtime_receipt_review.assert_true(public.crm_v2_sla_receipt_capabilities()=jsonb_build_object(
 'contract_version','first_contact_receipt_review_v1','enabled',true,'processing_enabled',true),'capability exposes separate read and process readiness');
INSERT INTO runtime_receipt_review.context SELECT 'lookup_a',public.crm_v2_first_contact_receipt(value) FROM runtime_receipt_review.context WHERE key='command_a';
SELECT runtime_receipt_review.assert_true((SELECT value->'found'='true'::jsonb AND value->'receipt'=(SELECT value FROM runtime_receipt_review.context WHERE key='original_a')
 FROM runtime_receipt_review.context WHERE key='lookup_a'),'own lookup returns exact historical receipt without replaying');
SELECT runtime_receipt_review.assert_true((SELECT value#>>'{actor,userId}'='fc120000-0000-4000-8000-000000000001'
 AND value#>>'{actor,role}'='admin' AND value#>'{receipt,replayed}'='false'::jsonb FROM runtime_receipt_review.context WHERE key='lookup_a'),'lookup identity is current actor while original replayed remains false');
SELECT runtime_receipt_review.assert_true((SELECT public.crm_v2_first_contact_receipt(jsonb_build_object(
 'requestId',upper(value->>'requestId'),'taskId',upper(value->>'taskId')))=(SELECT value FROM runtime_receipt_review.context WHERE key='lookup_a')
 FROM runtime_receipt_review.context WHERE key='command_a'),'uppercase UUID input canonicalizes without changing historical response');
SELECT runtime_receipt_review.assert_true((SELECT public.crm_v2_first_contact_receipt(value)->'found'='false'::jsonb
 AND public.crm_v2_first_contact_receipt(value)->'receipt'='null'::jsonb FROM runtime_receipt_review.context WHERE key='wrong_task'),'wrong existing task gives opaque not-found');
SELECT runtime_receipt_review.assert_true((SELECT public.crm_v2_first_contact_receipt(value||jsonb_build_object('requestId','fc120000-0000-4000-8000-000000009999'))->'found'='false'::jsonb
 FROM runtime_receipt_review.context WHERE key='command_a'),'absent request gives opaque not-found');
SELECT runtime_receipt_review.assert_true((SELECT public.crm_v2_first_contact_receipt(value)->'found'='false'::jsonb
 AND public.crm_v2_first_contact_receipt(value)->'receipt'='null'::jsonb FROM runtime_receipt_review.context WHERE key='command_b'),'Admin A cannot see Admin B receipt');
INSERT INTO runtime_receipt_review.context SELECT 'surplus_lookup',public.crm_v2_first_contact_receipt(value||jsonb_build_object('requestId','fc120000-0000-4000-8000-000000001003')) FROM runtime_receipt_review.context WHERE key='command_a';
SELECT runtime_receipt_review.assert_true((SELECT value->'found'='true'::jsonb AND NOT (value->'receipt') ? 'privateSentinel'
 AND NOT (value#>'{receipt,actor}') ? 'privateSentinel' AND NOT (value->'receipt') ? 'request_payload'
 FROM runtime_receipt_review.context WHERE key='surplus_lookup'),'receipt projection strips extra top-level and nested actor fields');
SELECT set_config('request.jwt.claim.sub','fc120000-0000-4000-8000-000000000003',true);
SELECT runtime_receipt_review.assert_true((SELECT public.crm_v2_first_contact_receipt(value)->'found'='false'::jsonb
 FROM runtime_receipt_review.context WHERE key='command_a'),'Admin B cannot see Admin A receipt');
SELECT runtime_receipt_review.assert_true((SELECT public.crm_v2_first_contact_receipt(value)->'receipt'=(SELECT value FROM runtime_receipt_review.context WHERE key='original_b')
 FROM runtime_receipt_review.context WHERE key='command_b'),'Admin B can read own exact receipt');
RESET ROLE;

-- Disable only processing: historical lookup remains available, never retries09.
UPDATE public.crm_settings SET sla_processing_enabled=false WHERE id;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','fc120000-0000-4000-8000-000000000001',true);
SELECT runtime_receipt_review.assert_true(public.crm_v2_sla_receipt_capabilities()->'enabled'='true'::jsonb
 AND public.crm_v2_sla_receipt_capabilities()->'processing_enabled'='false'::jsonb,'processing kill switch does not disable receipt recovery');
SELECT runtime_receipt_review.assert_true((SELECT public.crm_v2_first_contact_receipt(value)->'receipt'=(SELECT value FROM runtime_receipt_review.context WHERE key='original_a')
 FROM runtime_receipt_review.context WHERE key='command_a'),'exact receipt readable with processing disabled');
RESET ROLE;
UPDATE public.crm_settings SET sla_processing_enabled=true WHERE id;

-- Every base gate still disables read, irrespective of the processing setting.
DO $base_gates$
DECLARE gate text; command_value jsonb;
BEGIN
  SELECT value INTO command_value FROM runtime_receipt_review.context WHERE key='command_a';
  FOREACH gate IN ARRAY ARRAY['central_intake_enabled','lead_work_enabled','lead_lifecycle_enabled','work_schedule_enabled','notifications_enabled','sla_preview_enabled'] LOOP
    EXECUTE format('UPDATE public.crm_settings SET %I=false WHERE id',gate);
    SET LOCAL ROLE authenticated;
    PERFORM runtime_receipt_review.assert_true(public.crm_v2_sla_receipt_capabilities()->'enabled'='false'::jsonb
      AND public.crm_v2_sla_receipt_capabilities()->'processing_enabled'='false'::jsonb,'read capability honors '||gate);
    PERFORM runtime_receipt_review.expect_error(format('SELECT public.crm_v2_first_contact_receipt(%L::jsonb)',command_value::text),
      'P0001','CRM_SLA_RECEIPT_SETUP_REQUIRED','receipt read honors '||gate);
    RESET ROLE;
    EXECUTE format('UPDATE public.crm_settings SET %I=true WHERE id',gate);
  END LOOP;
END;
$base_gates$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','fc120000-0000-4000-8000-000000000001',true);
DO $invalid_inputs$
DECLARE bad jsonb; index_value integer:=0; command_value jsonb;
BEGIN
  SELECT value INTO command_value FROM runtime_receipt_review.context WHERE key='command_a';
  FOREACH bad IN ARRAY ARRAY['null'::jsonb,'[]'::jsonb,'{}'::jsonb,command_value-'requestId',command_value-'taskId',
    command_value||'{"actorId":"fc120000-0000-4000-8000-000000000003"}'::jsonb,
    command_value||'{"requestId":"bad-id"}'::jsonb,command_value||'{"taskId":123}'::jsonb,
    command_value||jsonb_build_object('extra',repeat('x',1100))] LOOP
    index_value:=index_value+1;
    PERFORM runtime_receipt_review.expect_error(format('SELECT public.crm_v2_first_contact_receipt(%L::jsonb)',bad::text),
      'P0001','CRM_SLA_RECEIPT_INVALID_INPUT','invalid receipt payload '||index_value);
  END LOOP;
END;
$invalid_inputs$;
SELECT runtime_receipt_review.expect_error('SELECT public.crm_v2_first_contact_receipt(NULL)',
 'P0001','CRM_SLA_RECEIPT_INVALID_INPUT','SQL NULL request rejected');
SELECT runtime_receipt_review.expect_error('SELECT * FROM sales_private.crm_first_contact_processing_requests',
 '42501',NULL,'receipt lookup does not grant direct ledger access');

-- Editable metadata cannot confer Admin authority; unknown/inactive/Owner/Sales
-- actors remain forbidden despite valid request IDs or a prior Admin receipt.
SELECT set_config('request.jwt.claims','{"role":"admin","user_metadata":{"role":"admin"}}',true);
DO $non_admins$
DECLARE who uuid; command_value jsonb;
BEGIN
  SELECT value INTO command_value FROM runtime_receipt_review.context WHERE key='command_a';
  FOREACH who IN ARRAY ARRAY['fc120000-0000-4000-8000-000000000002'::uuid,'fc120000-0000-4000-8000-000000000004'::uuid,
    'fc120000-0000-4000-8000-000000000005'::uuid,'fc120000-0000-4000-8000-000000000006'::uuid] LOOP
    PERFORM set_config('request.jwt.claim.sub',who::text,true);
    PERFORM runtime_receipt_review.assert_true(public.crm_v2_sla_receipt_capabilities()->'enabled'='false'::jsonb
      AND public.crm_v2_sla_receipt_capabilities()->'processing_enabled'='false'::jsonb,'non-Admin capability denied '||who);
    PERFORM runtime_receipt_review.expect_error(format('SELECT public.crm_v2_first_contact_receipt(%L::jsonb)',command_value::text),
      'P0001','CRM_SLA_RECEIPT_FORBIDDEN','non-Admin lookup denied '||who);
  END LOOP;
END;
$non_admins$;
SELECT set_config('request.jwt.claim.sub','',true);
SELECT set_config('request.jwt.claims','',true);
SELECT runtime_receipt_review.expect_error('SELECT public.crm_v2_first_contact_receipt(''{}''::jsonb)',
 'P0001','CRM_SLA_RECEIPT_FORBIDDEN','missing identity denied before request parsing');
RESET ROLE;
UPDATE sales_private.crm_user_roles SET is_active=false WHERE user_id='fc120000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','fc120000-0000-4000-8000-000000000001',true);
SELECT runtime_receipt_review.expect_error('SELECT public.crm_v2_first_contact_receipt(''{}''::jsonb)',
 'P0001','CRM_SLA_RECEIPT_FORBIDDEN','revoked original Admin cannot recover old receipt');
RESET ROLE;
UPDATE sales_private.crm_user_roles SET is_active=true WHERE user_id='fc120000-0000-4000-8000-000000000001';
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.sub','fc120000-0000-4000-8000-000000000001',true);
SELECT runtime_receipt_review.expect_error('SELECT public.crm_v2_sla_receipt_capabilities()',
 '42501',NULL,'anon cannot call receipt capabilities even with Admin sub');
SELECT runtime_receipt_review.expect_error('SELECT public.crm_v2_first_contact_receipt(''{}''::jsonb)',
 '42501',NULL,'anon cannot call receipt lookup even with Admin sub');
RESET ROLE;
SELECT runtime_receipt_review.assert_true(runtime_receipt_review.business_snapshot()=(SELECT value FROM runtime_receipt_review.context WHERE key='before_reads'),
 'found absent forbidden invalid and kill-switch reads mutate no customer task notice audit or receipt');

-- Real lifecycle closure changes CURRENT task/notice state; historical receipt
-- lookup must retain the old result without regenerating/acknowledging a notice.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','fc120000-0000-4000-8000-000000000001',true);
INSERT INTO runtime_receipt_review.context
 SELECT 'closed',public.crm_v2_change_lead_lifecycle('fc120000-0000-4000-8000-000000002004',jsonb_build_object(
 'command','close_lost','customerId',id,'interestId',NULL,'expectedRevision',lifecycle_revision,'expectedActionId',NULL,'reason','SYNTHETIC receipt history test'))
 FROM public.sales_customers WHERE id=(SELECT (value->>'customerId')::uuid FROM runtime_receipt_review.context WHERE key='lead');
RESET ROLE;
SELECT runtime_receipt_review.assert_true((SELECT status='cancelled' FROM public.crm_sla_tasks
 WHERE id=(SELECT (value->>'taskId')::uuid FROM runtime_receipt_review.context WHERE key='command_a')),'fixture closure cancels current task');
INSERT INTO runtime_receipt_review.context VALUES('before_historical_read',runtime_receipt_review.business_snapshot());
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','fc120000-0000-4000-8000-000000000001',true);
SELECT runtime_receipt_review.assert_true((SELECT public.crm_v2_first_contact_receipt(value)->'receipt'=(SELECT value FROM runtime_receipt_review.context WHERE key='original_a')
 FROM runtime_receipt_review.context WHERE key='command_a'),'closed task still has exact historical notified receipt');
RESET ROLE;
SELECT runtime_receipt_review.assert_true(runtime_receipt_review.business_snapshot()=(SELECT value FROM runtime_receipt_review.context WHERE key='before_historical_read'),
 'historical lookup does not reopen task revive notice reset read state or insert receipt');
SELECT 'RECEIPT_REVIEW_RUNTIME:'||jsonb_build_object('suite','first_contact_receipt_review','assertions',count(*))::text
 FROM runtime_receipt_review.assertions;
ROLLBACK;
