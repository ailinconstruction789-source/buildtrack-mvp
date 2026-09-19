-- SYNTHETIC LOCAL WORKER SCENARIOS ONLY. NEVER run on Supabase/existing DB.
-- Requires the isolated loopback runner, bootstrap and locally compiled drafts
-- through 13. Every synthetic fixture and actual worker effect rolls back.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $isolation$
BEGIN
  IF current_database() !~ '^buildtrack_sales_runtime_'
    OR current_setting('buildtrack.synthetic_runtime',true) IS DISTINCT FROM 'on'
    OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet THEN
    RAISE EXCEPTION 'REFUSED: worker scenarios require the isolated synthetic loopback runner';
  END IF;
END;
$isolation$;

CREATE SCHEMA runtime_worker;
GRANT USAGE ON SCHEMA runtime_worker TO authenticated,anon,buildtrack_sales_sla_worker;
CREATE TABLE runtime_worker.assertions(label text PRIMARY KEY);
CREATE TABLE runtime_worker.context(key text PRIMARY KEY,value jsonb NOT NULL);
GRANT SELECT,INSERT,UPDATE ON runtime_worker.assertions,runtime_worker.context TO authenticated,anon,buildtrack_sales_sla_worker;
CREATE FUNCTION runtime_worker.assert_true(condition boolean,label text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $assert$
BEGIN
  IF condition IS DISTINCT FROM true THEN RAISE EXCEPTION 'ASSERTION FAILED: %',label; END IF;
  INSERT INTO runtime_worker.assertions VALUES(label);
END;
$assert$;
CREATE FUNCTION runtime_worker.expect_error(statement text,expected_state text,expected_message text,label text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $expect$
DECLARE actual_state text; actual_message text;
BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS actual_state=RETURNED_SQLSTATE,actual_message=MESSAGE_TEXT;
    IF actual_state<>expected_state OR (expected_message IS NOT NULL AND actual_message<>expected_message) THEN
      RAISE EXCEPTION 'ASSERTION FAILED: %; expected [%] %, received [%] %',label,expected_state,expected_message,actual_state,actual_message;
    END IF;
    INSERT INTO runtime_worker.assertions VALUES(label); RETURN;
  END;
  RAISE EXCEPTION 'ASSERTION FAILED: %; expected an error but statement succeeded',label;
END;
$expect$;
CREATE FUNCTION runtime_worker.iso(value timestamptz)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $iso$
  SELECT to_char(value AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
$iso$;
CREATE FUNCTION runtime_worker.business_snapshot()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $snapshot$
  SELECT jsonb_build_object(
    'customers',(SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY id),'[]'::jsonb) FROM public.sales_customers c),
    'tasks',(SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb) FROM public.crm_sla_tasks t),
    'notices',(SELECT COALESCE(jsonb_agg(to_jsonb(n) ORDER BY id),'[]'::jsonb) FROM public.crm_notifications n),
    'audits',(SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY id),'[]'::jsonb) FROM public.crm_audit_events a),
    'manualChildren',(SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY actor_user_id,request_id),'[]'::jsonb)
      FROM sales_private.crm_first_contact_processing_requests r),
    'manualCycles',(SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY actor_user_id,request_id),'[]'::jsonb)
      FROM sales_private.crm_first_contact_cycle_requests r),
    'workerChildren',(SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY request_id),'[]'::jsonb)
      FROM sales_private.crm_first_contact_worker_requests r),
    'workerCycles',(SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY request_id),'[]'::jsonb)
      FROM sales_private.crm_first_contact_worker_cycles r),
    'cursor',(SELECT to_jsonb(c) FROM sales_private.crm_first_contact_cycle_cursor c WHERE id));
$snapshot$;
REVOKE ALL ON FUNCTION runtime_worker.business_snapshot() FROM PUBLIC,anon,authenticated,buildtrack_sales_sla_worker;

-- Capture the actual manual09 outcome, then force a subtransaction rollback.
-- PL/pgSQL variables retain the response while ALL business mutations revert.
-- The helper is SECURITY INVOKER and is called as authenticated Admin, never as
-- a privileged proxy. It compares both paths on the same unchanged task.
CREATE FUNCTION runtime_worker.capture_manual(key_value text,request_value uuid,task_value uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $manual$
DECLARE result_value jsonb;
BEGIN
  BEGIN
    result_value:=public.crm_v2_process_first_contact(jsonb_build_object('requestId',request_value,'taskId',task_value));
    RAISE EXCEPTION 'SYNTHETIC_MANUAL_PARITY_ROLLBACK';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM<>'SYNTHETIC_MANUAL_PARITY_ROLLBACK' THEN RAISE; END IF;
  END;
  IF result_value IS NULL THEN RAISE EXCEPTION 'SYNTHETIC_MANUAL_PARITY_NO_RESULT'; END IF;
  INSERT INTO runtime_worker.context VALUES(key_value,result_value);
END;
$manual$;

INSERT INTO auth.users(id) VALUES
 ('fc150000-0000-4000-8000-000000000001'),
 ('fc150000-0000-4000-8000-000000000002');
INSERT INTO sales_private.crm_user_roles(user_id,role,display_name,is_active) VALUES
 ('fc150000-0000-4000-8000-000000000001','admin','SYNTHETIC Worker Admin',true),
 ('fc150000-0000-4000-8000-000000000002','sales','SYNTHETIC Worker Sales',true);
INSERT INTO public.crm_settings(id,central_intake_enabled,lead_work_enabled,lead_lifecycle_enabled,
 work_schedule_enabled,notifications_enabled,sla_preview_enabled,sla_processing_enabled,sla_cycle_enabled)
VALUES(true,true,true,true,true,true,true,true,true)
ON CONFLICT(id) DO UPDATE SET central_intake_enabled=true,lead_work_enabled=true,lead_lifecycle_enabled=true,
 work_schedule_enabled=true,notifications_enabled=true,sla_preview_enabled=true,sla_processing_enabled=true,sla_cycle_enabled=true;
SELECT runtime_worker.assert_true((SELECT sla_worker_enabled=false FROM public.crm_settings WHERE id),
 'worker gate remains default off when all older gates are enabled');
SELECT runtime_worker.assert_true((SELECT NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole AND NOT rolcreatedb
 AND NOT rolinherit AND NOT rolreplication FROM pg_roles WHERE rolname='buildtrack_sales_sla_worker'),
 'worker role has no login inheritance replication or administrative bypass');
SET LOCAL ROLE buildtrack_sales_sla_worker;
SELECT set_config('request.jwt.claim.sub','',true);
SELECT set_config('request.jwt.claims','',true);
SELECT runtime_worker.assert_true(current_setting('request.jwt.claim.sub',true)=''
 AND current_setting('request.jwt.claims',true)='','worker session has no impersonated auth user or JWT');
SELECT runtime_worker.expect_error($q$SELECT sales_private.crm_first_contact_worker_cycle('fc150000-0000-4000-8000-000000001001')$q$,
 'P0001','CRM_SLA_WORKER_SETUP_REQUIRED','default-off worker cannot process');
RESET ROLE;
UPDATE public.crm_settings SET sla_worker_enabled=true WHERE id;

-- Eleven deliberately held Leads exercise the shared cursor without fabricated
-- source proof. Identical creation times test the UUID tie-breaker.
INSERT INTO public.sales_customers(id,customer_name,phone,owner_user_id,created_by_user_id,
 owner_assigned_at,lead_created_at,created_at,updated_at)
SELECT ('fc150000-0000-4000-8000-'||lpad((100+i)::text,12,'0'))::uuid,'SYNTHETIC held worker Lead '||i,
 '00000105'||lpad(i::text,2,'0'),'fc150000-0000-4000-8000-000000000002','fc150000-0000-4000-8000-000000000002',
 transaction_timestamp()-interval '25 hours',transaction_timestamp()-interval '25 hours',
 transaction_timestamp()-interval '25 hours',transaction_timestamp()-interval '25 hours'
FROM generate_series(1,11) i;
INSERT INTO public.crm_sla_tasks(id,customer_id,owner_user_id,task_type,obligation_started_at,service_due_at,created_at,evaluation_snapshot)
SELECT ('fc150000-0000-4000-8000-'||lpad((200+i)::text,12,'0'))::uuid,
 ('fc150000-0000-4000-8000-'||lpad((100+i)::text,12,'0'))::uuid,'fc150000-0000-4000-8000-000000000002',
 'first_contact',transaction_timestamp()-interval '25 hours',transaction_timestamp()-interval '1 hour',transaction_timestamp()-interval '25 hours',
 '{"initialContactHours":24,"clock":"elapsed","staffDueKnown":false}'::jsonb FROM generate_series(1,11) i;

CREATE FUNCTION runtime_worker.fail_second_child()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $failure$
BEGIN
  IF (SELECT count(*) FROM sales_private.crm_first_contact_worker_requests)<>1 THEN
    RAISE EXCEPTION 'SYNTHETIC_FAILURE_FIXTURE_NOT_REACHED_AFTER_ONE_CHILD';
  END IF;
  RAISE EXCEPTION 'SYNTHETIC_WORKER_SECOND_CHILD_FAILURE';
END;
$failure$;
CREATE TRIGGER runtime_worker_fail BEFORE INSERT ON public.crm_audit_events FOR EACH ROW
 WHEN (NEW.entity_type='crm_sla_task' AND NEW.event_type='first_contact_processed'
   AND NEW.entity_id='fc150000-0000-4000-8000-000000000202'::uuid)
 EXECUTE FUNCTION runtime_worker.fail_second_child();
INSERT INTO runtime_worker.context VALUES('before_failure',runtime_worker.business_snapshot());
SET LOCAL ROLE buildtrack_sales_sla_worker;
SELECT runtime_worker.expect_error($q$SELECT sales_private.crm_first_contact_worker_cycle('fc150000-0000-4000-8000-000000001001')$q$,
 'P0001','SYNTHETIC_WORKER_SECOND_CHILD_FAILURE','second child failure propagates rather than being skipped');
SELECT runtime_worker.assert_true(sales_private.crm_first_contact_worker_receipt('fc150000-0000-4000-8000-000000001001')->'found'='false'::jsonb,
 'rolled-back worker cycle has no recoverable receipt');
RESET ROLE;
SELECT runtime_worker.assert_true(runtime_worker.business_snapshot()=(SELECT value FROM runtime_worker.context WHERE key='before_failure'),
 'second-child failure rolls back all tasks notices audits both worker ledgers manual ledgers and shared cursor');
DROP TRIGGER runtime_worker_fail ON public.crm_audit_events;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','fc150000-0000-4000-8000-000000000001',true);
SELECT runtime_worker.capture_manual('manual_held','fc150000-0000-4000-8000-000000003001','fc150000-0000-4000-8000-000000000201');
SELECT runtime_worker.expect_error($q$SELECT public.crm_v2_process_first_contact('{"requestId":"fc150000-0000-4000-8000-000000003001","taskId":"fc150000-0000-4000-8000-000000000201","system":true}'::jsonb)$q$,
 'P0001','CRM_SLA_PROCESS_INVALID_INPUT','manual Admin cannot forge system execution via extra JSON field');
RESET ROLE;
SELECT runtime_worker.assert_true(runtime_worker.business_snapshot()=(SELECT value FROM runtime_worker.context WHERE key='before_failure'),
 'manual parity probe and rejected system forgery leave all business state unchanged');
SET LOCAL ROLE buildtrack_sales_sla_worker;
SELECT set_config('request.jwt.claim.sub','',true);
SELECT set_config('request.jwt.claims','',true);
INSERT INTO runtime_worker.context VALUES('first',sales_private.crm_first_contact_worker_cycle('fc150000-0000-4000-8000-000000001001'));
SELECT runtime_worker.assert_true((SELECT value->'processedCount'='10'::jsonb AND value->'maxItems'='10'::jsonb
 AND value->'sweepFinished'='false'::jsonb AND value->'replayed'='false'::jsonb AND jsonb_array_length(value->'receipts')=10
 FROM runtime_worker.context WHERE key='first'),'worker processes bounded ten with eleventh-row lookahead');
SELECT runtime_worker.assert_true((SELECT value->'actor'='{"kind":"system","name":"first_contact_worker_v1"}'::jsonb
 AND bool_and(child->'actor'=value->'actor' AND child->>'outcome'='held' AND child->>'reason'='MISSING_CREATION_EVIDENCE'
   AND child->'replayed'='false'::jsonb)
 FROM runtime_worker.context CROSS JOIN LATERAL jsonb_array_elements(value->'receipts') children(child)
 WHERE key='first' GROUP BY value),'worker and all children retain exact system actor and conservative held decisions');
SELECT runtime_worker.assert_true((SELECT array_agg(child->>'taskId' ORDER BY ordinal)=ARRAY(
 SELECT 'fc150000-0000-4000-8000-'||lpad((200+i)::text,12,'0') FROM generate_series(1,10) i)
 FROM runtime_worker.context CROSS JOIN LATERAL jsonb_array_elements(value->'receipts') WITH ORDINALITY children(child,ordinal)
 WHERE key='first'),'worker uses deterministic task order');
SELECT runtime_worker.assert_true((SELECT count(DISTINCT child->>'requestId')=10
 AND bool_and((child->>'processedAt')::timestamptz>=(value->>'startedAt')::timestamptz
 AND (child->>'processedAt')::timestamptz<=(value->>'finishedAt')::timestamptz)
 FROM runtime_worker.context CROSS JOIN LATERAL jsonb_array_elements(value->'receipts') children(child) WHERE key='first'),
 'worker child requests are unique and bounded by actual cycle times');
SELECT runtime_worker.assert_true((SELECT ((w.value#>'{receipts,0}')-ARRAY['actor','requestId','processedAt'])=
 (m.value-ARRAY['actor','requestId','processedAt']) FROM runtime_worker.context w CROSS JOIN runtime_worker.context m
 WHERE w.key='first' AND m.key='manual_held'),'held business result matches actual manual processor on same unchanged task');
RESET ROLE;
SELECT runtime_worker.assert_true((SELECT count(*)=10 AND bool_and(actor_user_id IS NULL AND actor_kind='system'
 AND actor_name_snapshot='First-contact system worker') FROM public.crm_audit_events WHERE event_type='first_contact_processed'),
 'worker processing audit provenance is system with null human user');
SELECT runtime_worker.assert_true((SELECT count(*)=10 FROM sales_private.crm_first_contact_worker_requests)
 AND (SELECT count(*)=1 FROM sales_private.crm_first_contact_worker_cycles)
 AND (SELECT count(*)=0 FROM sales_private.crm_first_contact_processing_requests)
 AND (SELECT count(*)=0 FROM sales_private.crm_first_contact_cycle_requests),'worker effects use only separate worker ledgers');
SELECT runtime_worker.assert_true((SELECT after_task_id='fc150000-0000-4000-8000-000000000210'::uuid
 FROM sales_private.crm_first_contact_cycle_cursor WHERE id),'worker advances shared cursor through held tasks');
INSERT INTO runtime_worker.context VALUES('before_replay',runtime_worker.business_snapshot());
SET LOCAL ROLE buildtrack_sales_sla_worker;
-- Arbitrary JWT content must neither impersonate Admin nor change system scope.
SELECT set_config('request.jwt.claim.sub','fc150000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"role":"admin","user_metadata":{"role":"admin"}}',true);
SELECT runtime_worker.assert_true(sales_private.crm_first_contact_worker_cycle('fc150000-0000-4000-8000-000000001001')=
 (SELECT value||'{"replayed":true}'::jsonb FROM runtime_worker.context WHERE key='first'),'same worker request replays exactly despite arbitrary JWT');
SELECT runtime_worker.assert_true(sales_private.crm_first_contact_worker_receipt('fc150000-0000-4000-8000-000000001001')=
 (SELECT jsonb_build_object('actor',value->'actor','requestId',value->'requestId','found',true,'receipt',value)
 FROM runtime_worker.context WHERE key='first'),'worker lookup returns exact original receipt and system envelope');
RESET ROLE;
SELECT runtime_worker.assert_true(runtime_worker.business_snapshot()=(SELECT value FROM runtime_worker.context WHERE key='before_replay'),
 'worker replay and receipt lookup have no persistent side effects');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','fc150000-0000-4000-8000-000000000001',true);
INSERT INTO runtime_worker.context VALUES('manual_tail',public.crm_v2_process_first_contact_cycle('{"requestId":"fc150000-0000-4000-8000-000000001002"}'::jsonb));
SELECT runtime_worker.assert_true((SELECT value->'processedCount'='1'::jsonb AND value->'sweepFinished'='true'::jsonb
 AND value#>>'{receipts,0,taskId}'='fc150000-0000-4000-8000-000000000211'
 AND value#>>'{receipts,0,actor,userId}'='fc150000-0000-4000-8000-000000000001' FROM runtime_worker.context WHERE key='manual_tail'),
 'manual Admin cycle reaches eleventh task using worker shared cursor');
RESET ROLE;
SELECT runtime_worker.assert_true((SELECT after_task_id IS NULL AND after_created_at IS NULL FROM sales_private.crm_first_contact_cycle_cursor WHERE id),
 'manual end-of-sweep resets worker shared cursor');
SELECT runtime_worker.assert_true((SELECT count(*)=10 FROM sales_private.crm_first_contact_worker_requests)
 AND (SELECT count(*)=1 FROM sales_private.crm_first_contact_processing_requests),'manual tail remains human ledger without touching worker receipts');

-- All nine kill switches are tested with the actual NOLOGIN worker role. Read
-- recovery follows six existing read gates, independent of write kill switches.
INSERT INTO runtime_worker.context VALUES('before_denials',runtime_worker.business_snapshot());
DO $gates$
DECLARE gate text; read_gate boolean;
BEGIN
  FOREACH gate IN ARRAY ARRAY['central_intake_enabled','lead_work_enabled','lead_lifecycle_enabled','work_schedule_enabled',
    'notifications_enabled','sla_preview_enabled','sla_processing_enabled','sla_cycle_enabled','sla_worker_enabled'] LOOP
    read_gate:=gate NOT IN ('sla_processing_enabled','sla_cycle_enabled','sla_worker_enabled');
    EXECUTE format('UPDATE public.crm_settings SET %I=false WHERE id',gate);
    SET LOCAL ROLE buildtrack_sales_sla_worker;
    PERFORM runtime_worker.expect_error($q$SELECT sales_private.crm_first_contact_worker_cycle('fc150000-0000-4000-8000-000000001001')$q$,
      'P0001','CRM_SLA_WORKER_SETUP_REQUIRED','worker command and replay honor gate '||gate);
    IF read_gate THEN
      PERFORM runtime_worker.expect_error($q$SELECT sales_private.crm_first_contact_worker_receipt('fc150000-0000-4000-8000-000000001001')$q$,
        'P0001','CRM_SLA_WORKER_SETUP_REQUIRED','worker receipt requires read gate '||gate);
    ELSE
      PERFORM runtime_worker.assert_true(sales_private.crm_first_contact_worker_receipt('fc150000-0000-4000-8000-000000001001')->'receipt'=
        (SELECT value FROM runtime_worker.context WHERE key='first'),'worker receipt recoverable with write gate off '||gate);
    END IF;
    RESET ROLE;
    EXECUTE format('UPDATE public.crm_settings SET %I=true WHERE id',gate);
  END LOOP;
END;
$gates$;
SET LOCAL ROLE buildtrack_sales_sla_worker;
SELECT runtime_worker.expect_error('SELECT sales_private.crm_first_contact_worker_cycle(NULL)','P0001','CRM_SLA_WORKER_INVALID_INPUT','worker NULL command input rejected');
SELECT runtime_worker.expect_error('SELECT sales_private.crm_first_contact_worker_receipt(NULL)','P0001','CRM_SLA_WORKER_INVALID_INPUT','worker NULL lookup input rejected');
SELECT runtime_worker.assert_true(sales_private.crm_first_contact_worker_receipt('fc150000-0000-4000-8000-000000009999')->'found'='false'::jsonb
 AND sales_private.crm_first_contact_worker_receipt('fc150000-0000-4000-8000-000000009999')->'receipt'='null'::jsonb,'missing worker receipt has no invented result');
SELECT runtime_worker.expect_error('SELECT * FROM sales_private.crm_first_contact_worker_requests','42501',NULL,'worker cannot read private child table directly');
SELECT runtime_worker.expect_error('SELECT * FROM sales_private.crm_first_contact_worker_cycles','42501',NULL,'worker cannot read private cycle table directly');
SELECT runtime_worker.expect_error('UPDATE sales_private.crm_first_contact_worker_cycles SET response=response','42501',NULL,'worker cannot write private cycle table directly');
SELECT runtime_worker.expect_error('UPDATE public.crm_settings SET sla_worker_enabled=false','42501',NULL,'worker cannot modify kill switches');
SELECT runtime_worker.expect_error('UPDATE public.crm_sla_tasks SET status=''cancelled''','42501',NULL,'worker cannot modify tasks outside entry point');
SELECT runtime_worker.expect_error('UPDATE public.crm_audit_events SET actor_kind=''staff''','42501',NULL,'worker cannot forge audits outside entry point');
SELECT runtime_worker.expect_error('SELECT sales_private.crm_first_contact_apply(NULL::public.crm_settings,NULL::public.sales_customers,NULL::public.crm_sla_tasks,NULL::sales_private.crm_work_calendars,true,NULL,''forged'',''system'',NULL)',
 '42501',NULL,'worker cannot invoke shared mutation core directly');
SELECT runtime_worker.expect_error('SELECT sales_private.crm_first_contact_worker_child_projection(''{}''::jsonb)',
 '42501',NULL,'worker cannot invoke private child projection helper');
SELECT runtime_worker.expect_error('SELECT sales_private.crm_first_contact_worker_cycle_projection(''{}''::jsonb)',
 '42501',NULL,'worker cannot invoke private cycle projection helper');
RESET ROLE;
DO $ordinary_roles$
DECLARE role_value text;
BEGIN
  FOREACH role_value IN ARRAY ARRAY['anon','authenticated'] LOOP
    EXECUTE format('SET LOCAL ROLE %I',role_value);
    PERFORM set_config('request.jwt.claim.sub','fc150000-0000-4000-8000-000000000001',true);
    PERFORM runtime_worker.expect_error($q$SELECT sales_private.crm_first_contact_worker_cycle('fc150000-0000-4000-8000-000000001001')$q$,
      '42501',NULL,role_value||' including forged or real Admin cannot invoke worker');
    PERFORM runtime_worker.expect_error($q$SELECT sales_private.crm_first_contact_worker_receipt('fc150000-0000-4000-8000-000000001001')$q$,
      '42501',NULL,role_value||' including Admin cannot read system receipt');
    PERFORM runtime_worker.expect_error('SELECT sales_private.crm_first_contact_apply(NULL::public.crm_settings,NULL::public.sales_customers,NULL::public.crm_sla_tasks,NULL::sales_private.crm_work_calendars,true,NULL,''forged'',''system'',NULL)',
      '42501',NULL,role_value||' including Admin cannot call shared mutation core directly');
    RESET ROLE;
  END LOOP;
END;
$ordinary_roles$;
SELECT runtime_worker.assert_true(runtime_worker.business_snapshot()=(SELECT value FROM runtime_worker.context WHERE key='before_denials'),
 'all denied calls gate checks and recovery reads preserve complete business state');
SELECT runtime_worker.expect_error('UPDATE sales_private.crm_first_contact_worker_requests SET response=response',
 'P0001','CRM_SLA_PROCESS_INVALID_INPUT','worker child receipts immutable against privileged UPDATE');
SELECT runtime_worker.expect_error('DELETE FROM sales_private.crm_first_contact_worker_requests',
 'P0001','CRM_SLA_PROCESS_INVALID_INPUT','worker child receipts immutable against privileged DELETE');
SELECT runtime_worker.expect_error('UPDATE sales_private.crm_first_contact_worker_cycles SET response=response',
 'P0001','CRM_SLA_PROCESS_INVALID_INPUT','worker cycle receipts immutable against privileged UPDATE');
SELECT runtime_worker.expect_error('DELETE FROM sales_private.crm_first_contact_worker_cycles',
 'P0001','CRM_SLA_PROCESS_INVALID_INPUT','worker cycle receipts immutable against privileged DELETE');

-- A privileged synthetic fixture introduces future private fields. Recovery and
-- replay must whitelist both actor levels and every child, not leak raw ledger.
INSERT INTO sales_private.crm_first_contact_worker_cycles(request_id,response,created_at)
SELECT 'fc150000-0000-4000-8000-000000001003',
 value||jsonb_build_object('requestId','fc150000-0000-4000-8000-000000001003','privateSentinel','SYNTHETIC PRIVATE',
 'actor',(value->'actor')||'{"privateSentinel":"SYNTHETIC ACTOR"}'::jsonb,'receipts',(
   SELECT jsonb_agg(child||jsonb_build_object('privateSentinel','SYNTHETIC CHILD',
     'actor',(child->'actor')||'{"privateSentinel":"SYNTHETIC CHILD ACTOR"}'::jsonb) ORDER BY ordinal)
   FROM jsonb_array_elements(value->'receipts') WITH ORDINALITY children(child,ordinal))),clock_timestamp()
FROM runtime_worker.context WHERE key='first';
INSERT INTO runtime_worker.context VALUES('before_projection',runtime_worker.business_snapshot());
SET LOCAL ROLE buildtrack_sales_sla_worker;
SELECT runtime_worker.assert_true(sales_private.crm_first_contact_worker_receipt('fc150000-0000-4000-8000-000000001003')->'receipt'=
 (SELECT value||'{"requestId":"fc150000-0000-4000-8000-000000001003"}'::jsonb FROM runtime_worker.context WHERE key='first'),
 'system lookup strips surplus private parent child and nested actor fields');
SELECT runtime_worker.assert_true(sales_private.crm_first_contact_worker_cycle('fc150000-0000-4000-8000-000000001003')=
 (SELECT value||'{"requestId":"fc150000-0000-4000-8000-000000001003","replayed":true}'::jsonb FROM runtime_worker.context WHERE key='first'),
 'system replay also strips surplus fields while preserving historical child results');
RESET ROLE;
SELECT runtime_worker.assert_true(runtime_worker.business_snapshot()=(SELECT value FROM runtime_worker.context WHERE key='before_projection'),
 'projection recovery and replay preserve complete business state');

-- Close only synthetic held fixtures to isolate ready-path parity. Four fresh
-- historical Leads have explicit fake source evidence, one task each. The
-- completion proof itself is produced by the real lead-work RPC below.
UPDATE public.crm_sla_tasks SET status='cancelled' WHERE status='open';
INSERT INTO runtime_worker.context VALUES('base_time',to_jsonb(clock_timestamp()));
INSERT INTO public.sales_customers(id,customer_name,phone,owner_user_id,created_by_user_id,
 owner_assigned_at,lead_created_at,created_at,updated_at)
SELECT ('fc150000-0000-4000-8000-'||lpad((300+x.i)::text,12,'0'))::uuid,'SYNTHETIC ready worker Lead '||x.i,
 '00000305'||lpad(x.i::text,2,'0'),'fc150000-0000-4000-8000-000000000002','fc150000-0000-4000-8000-000000000002',
 (c.value#>>'{}')::timestamptz-x.age,(c.value#>>'{}')::timestamptz-x.age,
 (c.value#>>'{}')::timestamptz-x.age,(c.value#>>'{}')::timestamptz-x.age
FROM runtime_worker.context c CROSS JOIN (VALUES
 (1,interval '23 hours 45 minutes'),(2,interval '1 hour'),(3,interval '25 hours'),(4,interval '23 hours 45 minutes')) x(i,age)
WHERE c.key='base_time';
INSERT INTO public.crm_sla_tasks(id,customer_id,owner_user_id,task_type,obligation_started_at,service_due_at,created_at,evaluation_snapshot)
SELECT ('fc150000-0000-4000-8000-'||lpad((400+i)::text,12,'0'))::uuid,c.id,c.owner_user_id,'first_contact',
 c.lead_created_at,c.lead_created_at+interval '24 hours',c.created_at,'{"initialContactHours":24,"clock":"elapsed","staffDueKnown":false}'::jsonb
FROM generate_series(1,4) i JOIN public.sales_customers c ON c.id=('fc150000-0000-4000-8000-'||lpad((300+i)::text,12,'0'))::uuid;
INSERT INTO public.crm_audit_events(customer_id,entity_type,entity_id,event_type,reason_text,
 actor_user_id,actor_kind,actor_name_snapshot,new_values,occurred_at,recorded_at)
SELECT id,'customer',id,'created','SYNTHETIC historical source evidence only',created_by_user_id,'staff','SYNTHETIC Sales',
 jsonb_build_object('ownerUserId',owner_user_id,'intakeStatus','new'),lead_created_at,lead_created_at
FROM public.sales_customers WHERE id BETWEEN 'fc150000-0000-4000-8000-000000000301' AND 'fc150000-0000-4000-8000-000000000304';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','fc150000-0000-4000-8000-000000000001',true);
INSERT INTO runtime_worker.context
SELECT 'schedule',public.crm_v2_publish_work_schedule('fc150000-0000-4000-8000-000000004001',
 jsonb_build_object('salesUserId','fc150000-0000-4000-8000-000000000002','expectedVersion',NULL,
 'coverage',jsonb_build_object('startsAt',runtime_worker.iso((value#>>'{}')::timestamptz-interval '2 days'),
   'endsAt',runtime_worker.iso((value#>>'{}')::timestamptz+interval '2 days')),
 'periods',jsonb_build_array(jsonb_build_object('type','work','startsAt',runtime_worker.iso((value#>>'{}')::timestamptz-interval '2 days'),
   'endsAt',runtime_worker.iso((value#>>'{}')::timestamptz+interval '2 days'))),'confirmedComplete',true,'reason','SYNTHETIC worker parity coverage'))
FROM runtime_worker.context WHERE key='base_time';
SELECT set_config('request.jwt.claim.sub','fc150000-0000-4000-8000-000000000002',true);
INSERT INTO runtime_worker.context VALUES('contact',public.crm_v2_record_lead_work('fc150000-0000-4000-8000-000000004002',
 jsonb_build_object('command','record_attempt','customerId','fc150000-0000-4000-8000-000000000304','interestId',NULL,'expectedActionId',NULL,
 'nextAction',jsonb_build_object('action','SYNTHETIC follow-up','dueAt',runtime_worker.iso(clock_timestamp()+interval '2 hours')),
 'reason','SYNTHETIC proven contact','attempt',jsonb_build_object('action','SYNTHETIC successful call','channel','phone',
 'result','contact_success','occurredAt',runtime_worker.iso(clock_timestamp())))));
RESET ROLE;
INSERT INTO runtime_worker.context VALUES('before_ready_probes',runtime_worker.business_snapshot());
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','fc150000-0000-4000-8000-000000000001',true);
SELECT runtime_worker.capture_manual('manual_ready_'||i,('fc150000-0000-4000-8000-'||lpad((3100+i)::text,12,'0'))::uuid,
 ('fc150000-0000-4000-8000-'||lpad((400+i)::text,12,'0'))::uuid) FROM generate_series(1,4) i;
RESET ROLE;
SELECT runtime_worker.assert_true(runtime_worker.business_snapshot()=(SELECT value FROM runtime_worker.context WHERE key='before_ready_probes'),
 'all four manual ready probes roll back before worker comparison');
SET LOCAL ROLE buildtrack_sales_sla_worker;
SELECT set_config('request.jwt.claim.sub','fc150000-0000-4000-8000-000000000002',true);
SELECT set_config('request.jwt.claims','{"role":"admin","user_metadata":{"role":"owner"}}',true);
INSERT INTO runtime_worker.context VALUES('ready',sales_private.crm_first_contact_worker_cycle('fc150000-0000-4000-8000-000000001004'));
SELECT runtime_worker.assert_true((SELECT value->'processedCount'='4'::jsonb AND value->'sweepFinished'='true'::jsonb
 FROM runtime_worker.context WHERE key='ready'),'worker processes all four isolated ready branches');
SELECT runtime_worker.assert_true((SELECT value->'actor'='{"kind":"system","name":"first_contact_worker_v1"}'::jsonb
 AND bool_and(child->'actor'=value->'actor') FROM runtime_worker.context
 CROSS JOIN LATERAL jsonb_array_elements(value->'receipts') children(child) WHERE key='ready' GROUP BY value),
 'fresh worker cycle ignores arbitrary JWT and retains only system actor');
DO $parity$
DECLARE i integer; worker_value jsonb; manual_value jsonb; expected_outcome text; expected_reason text;
BEGIN
  FOR i IN 1..4 LOOP
    SELECT child INTO worker_value FROM runtime_worker.context CROSS JOIN LATERAL jsonb_array_elements(value->'receipts') children(child)
      WHERE key='ready' AND child->>'taskId'='fc150000-0000-4000-8000-'||lpad((400+i)::text,12,'0');
    SELECT value INTO manual_value FROM runtime_worker.context WHERE key='manual_ready_'||i;
    expected_outcome:=CASE WHEN i IN (1,3) THEN 'notified' WHEN i=2 THEN 'scheduled' ELSE 'completed' END;
    expected_reason:=CASE i WHEN 1 THEN 'DUE_SOON' WHEN 2 THEN 'NOT_DUE_YET' WHEN 3 THEN 'OVERDUE' ELSE 'CONTACT_PROVEN' END;
    PERFORM runtime_worker.assert_true(worker_value->>'outcome'=expected_outcome AND worker_value->>'reason'=expected_reason,
      'actual worker ready branch '||expected_reason);
    PERFORM runtime_worker.assert_true((worker_value-ARRAY['actor','requestId','processedAt','notificationId'])=
      (manual_value-ARRAY['actor','requestId','processedAt','notificationId']),'same-task manual and worker business parity '||expected_reason);
  END LOOP;
END;
$parity$;
RESET ROLE;
SELECT runtime_worker.assert_true((SELECT count(*)=2 AND count(*) FILTER (WHERE notification_type='due_soon')=1
 AND count(*) FILTER (WHERE notification_type='overdue')=1 AND bool_and(recipient_user_id='fc150000-0000-4000-8000-000000000002'::uuid)
 FROM public.crm_notifications),'worker delivers exactly due-soon and overdue notices to owning Sales');
SELECT runtime_worker.assert_true((SELECT t.status='done' AND t.completed_by_activity_id=a.id AND t.completed_at=a.occurred_at
 AND c.first_contacted_at=a.occurred_at AND t.service_due_at=c.lead_created_at+interval '24 hours'
 FROM public.crm_sla_tasks t JOIN public.sales_customers c ON c.id=t.customer_id JOIN public.lead_activities a ON a.id=t.completed_by_activity_id
 WHERE t.id='fc150000-0000-4000-8000-000000000404'),'worker completion stores exact evidenced activity without changing service clock');
SELECT runtime_worker.assert_true((SELECT count(*)=1 FROM public.crm_next_actions WHERE customer_id='fc150000-0000-4000-8000-000000000304' AND status='open'),
 'worker completion preserves Sales follow-up plan');
SELECT runtime_worker.assert_true((SELECT count(*)=14 AND bool_and(actor_user_id IS NULL AND actor_kind='system')
 FROM public.crm_audit_events WHERE event_type='first_contact_processed' AND actor_kind='system'),
 'held and all ready worker branches retain null-user system audits');

SELECT 'SYSTEM_WORKER_RUNTIME:'||jsonb_build_object('suite','first_contact_system_worker','assertions',count(*))::text FROM runtime_worker.assertions;
ROLLBACK;
