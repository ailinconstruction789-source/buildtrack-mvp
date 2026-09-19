-- SYNTHETIC LOCAL CYCLE SCENARIOS ONLY. NEVER run on Supabase/existing DB.
-- Requires isolated runner/bootstrap + locally compiled base04--11. All fake
-- fixtures, helper objects and actual RPC effects are enclosed in ROLLBACK.
-- Missing creation audits are intentional: old held items must not starve item11.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $isolation$
BEGIN
  IF current_database() !~ '^buildtrack_sales_runtime_'
    OR current_setting('buildtrack.synthetic_runtime',true) IS DISTINCT FROM 'on'
    OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet THEN
    RAISE EXCEPTION 'REFUSED: cycle scenarios require the isolated synthetic loopback runner';
  END IF;
END;
$isolation$;

CREATE SCHEMA runtime_cycle;
GRANT USAGE ON SCHEMA runtime_cycle TO authenticated,anon;
CREATE TABLE runtime_cycle.assertions(label text PRIMARY KEY);
CREATE TABLE runtime_cycle.context(key text PRIMARY KEY,value jsonb NOT NULL);
GRANT SELECT,INSERT,UPDATE ON runtime_cycle.assertions,runtime_cycle.context TO authenticated,anon;
CREATE FUNCTION runtime_cycle.assert_true(condition boolean,label text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $assert$
BEGIN
  IF condition IS DISTINCT FROM true THEN RAISE EXCEPTION 'ASSERTION FAILED: %',label; END IF;
  INSERT INTO runtime_cycle.assertions VALUES(label);
END;
$assert$;
CREATE FUNCTION runtime_cycle.expect_error(statement text,expected_state text,expected_message text,label text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $expect$
DECLARE actual_state text; actual_message text;
BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS actual_state=RETURNED_SQLSTATE,actual_message=MESSAGE_TEXT;
    IF actual_state<>expected_state OR (expected_message IS NOT NULL AND actual_message<>expected_message) THEN
      RAISE EXCEPTION 'ASSERTION FAILED: %; expected [%] %, received [%] %',label,expected_state,expected_message,actual_state,actual_message;
    END IF;
    INSERT INTO runtime_cycle.assertions VALUES(label); RETURN;
  END;
  RAISE EXCEPTION 'ASSERTION FAILED: %; expected an error but statement succeeded',label;
END;
$expect$;
-- Installer-only exact snapshot; ordinary roles cannot read the private ledgers.
CREATE FUNCTION runtime_cycle.business_snapshot()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $snapshot$
  SELECT jsonb_build_object(
    'customers',(SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY id),'[]'::jsonb) FROM public.sales_customers c),
    'tasks',(SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb) FROM public.crm_sla_tasks t),
    'notices',(SELECT COALESCE(jsonb_agg(to_jsonb(n) ORDER BY id),'[]'::jsonb) FROM public.crm_notifications n),
    'audits',(SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY id),'[]'::jsonb) FROM public.crm_audit_events a),
    'children',(SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY actor_user_id,request_id),'[]'::jsonb)
      FROM sales_private.crm_first_contact_processing_requests r),
    'cycles',(SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY actor_user_id,request_id),'[]'::jsonb)
      FROM sales_private.crm_first_contact_cycle_requests r),
    'cursor',(SELECT to_jsonb(c) FROM sales_private.crm_first_contact_cycle_cursor c WHERE id));
$snapshot$;
REVOKE ALL ON FUNCTION runtime_cycle.business_snapshot() FROM PUBLIC,anon,authenticated;

INSERT INTO auth.users(id) VALUES
 ('fc130000-0000-4000-8000-000000000001'), -- Admin A
 ('fc130000-0000-4000-8000-000000000002'), -- Sales
 ('fc130000-0000-4000-8000-000000000003'), -- Admin B
 ('fc130000-0000-4000-8000-000000000004'), -- Owner
 ('fc130000-0000-4000-8000-000000000005'), -- inactive Admin
 ('fc130000-0000-4000-8000-000000000006'); -- unmapped identity
INSERT INTO sales_private.crm_user_roles(user_id,role,display_name,is_active) VALUES
 ('fc130000-0000-4000-8000-000000000001','admin','SYNTHETIC Cycle Admin A',true),
 ('fc130000-0000-4000-8000-000000000002','sales','SYNTHETIC Cycle Sales',true),
 ('fc130000-0000-4000-8000-000000000003','admin','SYNTHETIC Cycle Admin B',true),
 ('fc130000-0000-4000-8000-000000000004','owner','SYNTHETIC Cycle Owner',true),
 ('fc130000-0000-4000-8000-000000000005','admin','SYNTHETIC inactive Cycle Admin',false);
INSERT INTO public.crm_settings(id,central_intake_enabled,lead_work_enabled,lead_lifecycle_enabled,
 work_schedule_enabled,notifications_enabled,sla_preview_enabled,sla_processing_enabled,sla_cycle_enabled)
VALUES(true,true,true,true,true,true,true,true,true)
ON CONFLICT(id) DO UPDATE SET central_intake_enabled=true,lead_work_enabled=true,lead_lifecycle_enabled=true,
 work_schedule_enabled=true,notifications_enabled=true,sla_preview_enabled=true,sla_processing_enabled=true,sla_cycle_enabled=true;

-- Synthetic missing-proof Leads. Identical created_at values exercise UUID tie
-- breaking, and no calendar/source evidence is fabricated to make them ready.
INSERT INTO public.sales_customers(id,customer_name,phone,owner_user_id,created_by_user_id,
 owner_assigned_at,lead_created_at,created_at,updated_at)
SELECT ('fc130000-0000-4000-8000-'||lpad((100+i)::text,12,'0'))::uuid,'SYNTHETIC held Lead '||i,
 '00000103'||lpad(i::text,2,'0'),'fc130000-0000-4000-8000-000000000002','fc130000-0000-4000-8000-000000000002',
 transaction_timestamp()-interval '25 hours',transaction_timestamp()-interval '25 hours',
 transaction_timestamp()-interval '25 hours',transaction_timestamp()-interval '25 hours'
FROM generate_series(1,11) i;
INSERT INTO public.crm_sla_tasks(id,customer_id,owner_user_id,task_type,obligation_started_at,service_due_at,created_at,evaluation_snapshot)
SELECT ('fc130000-0000-4000-8000-'||lpad((200+i)::text,12,'0'))::uuid,
 ('fc130000-0000-4000-8000-'||lpad((100+i)::text,12,'0'))::uuid,'fc130000-0000-4000-8000-000000000002',
 'first_contact',transaction_timestamp()-interval '25 hours',transaction_timestamp()-interval '1 hour',transaction_timestamp()-interval '25 hours',
 '{"initialContactHours":24,"clock":"elapsed","staffDueKnown":false}'::jsonb FROM generate_series(1,11) i;
INSERT INTO public.crm_sla_tasks(id,customer_id,owner_user_id,task_type,status,obligation_started_at,service_due_at,created_at)
VALUES
 ('fc130000-0000-4000-8000-000000000219','fc130000-0000-4000-8000-000000000101','fc130000-0000-4000-8000-000000000002',
 'follow_up','open',transaction_timestamp()-interval '30 hours',transaction_timestamp(),transaction_timestamp()-interval '30 hours'),
 ('fc130000-0000-4000-8000-000000000220','fc130000-0000-4000-8000-000000000101','fc130000-0000-4000-8000-000000000002',
 'first_contact','cancelled',transaction_timestamp()-interval '30 hours',transaction_timestamp(),transaction_timestamp()-interval '30 hours');

-- Forced third-child failure verifies actual09 effects from children1--2 roll
-- back, including immutable receipts/audits. Trigger exists only in this fixture.
CREATE FUNCTION runtime_cycle.fail_third_child()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $failure$
BEGIN
  IF (SELECT count(*) FROM sales_private.crm_first_contact_processing_requests
      WHERE actor_user_id='fc130000-0000-4000-8000-000000000001')<>2 THEN
    RAISE EXCEPTION 'SYNTHETIC_FAILURE_FIXTURE_NOT_REACHED_AFTER_TWO_CHILDREN';
  END IF;
  RAISE EXCEPTION 'SYNTHETIC_CYCLE_THIRD_CHILD_FAILURE';
END;
$failure$;
CREATE TRIGGER runtime_cycle_fail BEFORE INSERT ON public.crm_audit_events FOR EACH ROW
 WHEN (NEW.entity_type='crm_sla_task' AND NEW.event_type='first_contact_processed'
   AND NEW.entity_id='fc130000-0000-4000-8000-000000000203'::uuid)
 EXECUTE FUNCTION runtime_cycle.fail_third_child();
INSERT INTO runtime_cycle.context VALUES('before_failure',runtime_cycle.business_snapshot());
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','fc130000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','',true);
SELECT runtime_cycle.assert_true(public.crm_v2_sla_cycle_capabilities()=jsonb_build_object(
 'contract_version','first_contact_cycle_v1','enabled',true,'processing_enabled',true),'Admin cycle capability reports separate read and write readiness');
SELECT runtime_cycle.expect_error($q$SELECT public.crm_v2_process_first_contact_cycle('{"requestId":"fc130000-0000-4000-8000-000000001001"}'::jsonb)$q$,
 'P0001','SYNTHETIC_CYCLE_THIRD_CHILD_FAILURE','child failure is propagated rather than skipped');
SELECT runtime_cycle.assert_true(public.crm_v2_first_contact_cycle_receipt('{"requestId":"fc130000-0000-4000-8000-000000001001"}'::jsonb)->'found'='false'::jsonb,
 'rolled-back cycle has no receipt');
RESET ROLE;
SELECT runtime_cycle.assert_true(runtime_cycle.business_snapshot()=(SELECT value FROM runtime_cycle.context WHERE key='before_failure'),
 'child failure rolls back every customer task notice audit child receipt cycle receipt and cursor');
DROP TRIGGER runtime_cycle_fail ON public.crm_audit_events;

-- Retrying the exact failed request is a new atomic attempt, not a partial replay.
SET LOCAL ROLE authenticated;
INSERT INTO runtime_cycle.context VALUES('first',public.crm_v2_process_first_contact_cycle('{"requestId":"fc130000-0000-4000-8000-000000001001"}'::jsonb));
SELECT runtime_cycle.assert_true((SELECT value->'processedCount'='10'::jsonb AND value->'maxItems'='10'::jsonb
 AND value->'sweepFinished'='false'::jsonb AND value->'replayed'='false'::jsonb AND jsonb_array_length(value->'receipts')=10
 FROM runtime_cycle.context WHERE key='first'),'first successful cycle processes exactly ten with an eleventh lookahead');
SELECT runtime_cycle.assert_true((SELECT bool_and(child->>'outcome'='held' AND child->>'reason'='MISSING_CREATION_EVIDENCE')
 FROM runtime_cycle.context CROSS JOIN LATERAL jsonb_array_elements(value->'receipts') children(child) WHERE key='first'),
 'held tasks retain conservative09 outcome rather than being silently omitted');
SELECT runtime_cycle.assert_true((SELECT array_agg(child->>'taskId' ORDER BY ordinal)=ARRAY(
 SELECT 'fc130000-0000-4000-8000-'||lpad((200+i)::text,12,'0') FROM generate_series(1,10) i)
 FROM runtime_cycle.context CROSS JOIN LATERAL jsonb_array_elements(value->'receipts') WITH ORDINALITY children(child,ordinal) WHERE key='first'),
 'database selects deterministic created-at UUID order and excludes non-open or follow-up rows');
SELECT runtime_cycle.assert_true((SELECT count(DISTINCT child->>'requestId')=10 AND count(DISTINCT child->>'taskId')=10
 AND bool_and(child#>>'{actor,userId}'='fc130000-0000-4000-8000-000000000001' AND child#>>'{actor,role}'='admin'
   AND child->'replayed'='false'::jsonb AND (child->>'processedAt')::timestamptz>=(value->>'startedAt')::timestamptz
   AND (child->>'processedAt')::timestamptz<=(value->>'finishedAt')::timestamptz)
 FROM runtime_cycle.context CROSS JOIN LATERAL jsonb_array_elements(value->'receipts') children(child) WHERE key='first'),
 'children have unique server-generated requests tasks correct actor and original cycle time bounds');
RESET ROLE;
SELECT runtime_cycle.assert_true((SELECT after_task_id='fc130000-0000-4000-8000-000000000210'::uuid
 AND after_created_at=transaction_timestamp()-interval '25 hours' FROM sales_private.crm_first_contact_cycle_cursor WHERE id),
 'cursor advances to the tenth selected task even when all ten are held');
INSERT INTO runtime_cycle.context VALUES('before_replay',runtime_cycle.business_snapshot());
SET LOCAL ROLE authenticated;
SELECT runtime_cycle.assert_true(public.crm_v2_process_first_contact_cycle('{"requestId":"FC130000-0000-4000-8000-000000001001"}'::jsonb)=
 (SELECT value||'{"replayed":true}'::jsonb FROM runtime_cycle.context WHERE key='first'),
 'exact replay changes only parent replayed and preserves children and original cycle timestamps');
SELECT runtime_cycle.assert_true(public.crm_v2_first_contact_cycle_receipt('{"requestId":"fc130000-0000-4000-8000-000000001001"}'::jsonb)->'receipt'=
 (SELECT value FROM runtime_cycle.context WHERE key='first'),'read lookup returns original receipt with replayed false');
RESET ROLE;
SELECT runtime_cycle.assert_true(runtime_cycle.business_snapshot()=(SELECT value FROM runtime_cycle.context WHERE key='before_replay'),
 'replay and lookup create no child effects receipts or cursor movement');

-- A different Admin continues the GLOBAL cursor, not their own private sweep.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','fc130000-0000-4000-8000-000000000003',true);
SELECT runtime_cycle.assert_true(public.crm_v2_first_contact_cycle_receipt('{"requestId":"fc130000-0000-4000-8000-000000001001"}'::jsonb)->'found'='false'::jsonb,
 'another Admin cannot discover a private cycle receipt');
INSERT INTO runtime_cycle.context VALUES('second',public.crm_v2_process_first_contact_cycle('{"requestId":"fc130000-0000-4000-8000-000000001002"}'::jsonb));
SELECT runtime_cycle.assert_true((SELECT value->'processedCount'='1'::jsonb AND value->'sweepFinished'='true'::jsonb
 AND value#>>'{receipts,0,taskId}'='fc130000-0000-4000-8000-000000000211' AND value#>>'{receipts,0,actor,userId}'='fc130000-0000-4000-8000-000000000003'
 FROM runtime_cycle.context WHERE key='second'),'eleventh held task is reached by next Admin and completes the shared sweep');
RESET ROLE;
SELECT runtime_cycle.assert_true((SELECT after_created_at IS NULL AND after_task_id IS NULL FROM sales_private.crm_first_contact_cycle_cursor WHERE id),
 'end of sweep resets both cursor keys for a future call');
SELECT runtime_cycle.assert_true((SELECT count(*)=11 FROM sales_private.crm_first_contact_processing_requests),
 'eleven tasks produced exactly eleven child receipts across the two committed cycles');

-- Future receipt fields are fabricated only for this projection-boundary test.
INSERT INTO sales_private.crm_first_contact_cycle_requests(actor_user_id,request_id,response,created_at)
SELECT 'fc130000-0000-4000-8000-000000000001','fc130000-0000-4000-8000-000000001003',
 value||jsonb_build_object('requestId','fc130000-0000-4000-8000-000000001003','privateSentinel','FAKE PRIVATE',
 'actor',(value->'actor')||'{"privateSentinel":"FAKE ACTOR"}'::jsonb,'receipts',(
   SELECT jsonb_agg(child||jsonb_build_object('privateSentinel','FAKE CHILD','actor',(child->'actor')||'{"privateSentinel":"FAKE CHILD ACTOR"}'::jsonb) ORDER BY ordinal)
   FROM jsonb_array_elements(value->'receipts') WITH ORDINALITY children(child,ordinal))),clock_timestamp()
FROM runtime_cycle.context WHERE key='first';
INSERT INTO runtime_cycle.context VALUES('before_reads',runtime_cycle.business_snapshot());
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','fc130000-0000-4000-8000-000000000001',true);
INSERT INTO runtime_cycle.context VALUES('projection',public.crm_v2_first_contact_cycle_receipt('{"requestId":"fc130000-0000-4000-8000-000000001003"}'::jsonb));
SELECT runtime_cycle.assert_true((SELECT value->'receipt'=(SELECT value||jsonb_build_object('requestId','fc130000-0000-4000-8000-000000001003')
 FROM runtime_cycle.context WHERE key='first') FROM runtime_cycle.context WHERE key='projection'),
 'lookup strips private surplus at parent child and both nested actor levels');
SELECT runtime_cycle.assert_true(public.crm_v2_process_first_contact_cycle('{"requestId":"fc130000-0000-4000-8000-000000001003"}'::jsonb)=
 (SELECT (value->'receipt')||'{"replayed":true}'::jsonb FROM runtime_cycle.context WHERE key='projection'),
 'cached POST replay also strips private fields');
SELECT runtime_cycle.assert_true(public.crm_v2_first_contact_cycle_receipt('{"requestId":"fc130000-0000-4000-8000-000000001002"}'::jsonb)->'found'='false'::jsonb,
 'Admin A cannot read Admin B cycle receipt');
SELECT runtime_cycle.assert_true(public.crm_v2_first_contact_cycle_receipt('{"requestId":"fc130000-0000-4000-8000-000000009999"}'::jsonb)->'receipt'='null'::jsonb,
 'absent request returns null receipt without a noncommit guarantee');
SELECT runtime_cycle.expect_error('SELECT * FROM sales_private.crm_first_contact_cycle_requests','42501',NULL,'direct cycle ledger read denied');
SELECT runtime_cycle.expect_error('SELECT * FROM sales_private.crm_first_contact_cycle_cursor','42501',NULL,'direct shared cursor read denied');
SELECT runtime_cycle.expect_error('UPDATE sales_private.crm_first_contact_cycle_cursor SET after_task_id=NULL','42501',NULL,'direct shared cursor write denied');
SELECT runtime_cycle.expect_error('SELECT sales_private.crm_first_contact_cycle_projection(''{}''::jsonb)','42501',NULL,'private projection helper execution denied');
RESET ROLE;

-- All eight switches block commands, but seventh/eighth OFF preserve read access.
DO $gates$
DECLARE gate text; is_base boolean;
BEGIN
  FOREACH gate IN ARRAY ARRAY['central_intake_enabled','lead_work_enabled','lead_lifecycle_enabled','work_schedule_enabled',
    'notifications_enabled','sla_preview_enabled','sla_processing_enabled','sla_cycle_enabled'] LOOP
    is_base:=gate NOT IN ('sla_processing_enabled','sla_cycle_enabled');
    EXECUTE format('UPDATE public.crm_settings SET %I=false WHERE id',gate);
    SET LOCAL ROLE authenticated;
    PERFORM runtime_cycle.assert_true(public.crm_v2_sla_cycle_capabilities()->'enabled'=to_jsonb(NOT is_base)
      AND public.crm_v2_sla_cycle_capabilities()->'processing_enabled'='false'::jsonb,'capability honors gate '||gate);
    PERFORM runtime_cycle.expect_error($q$SELECT public.crm_v2_process_first_contact_cycle('{"requestId":"fc130000-0000-4000-8000-000000001001"}'::jsonb)$q$,
      'P0001','CRM_SLA_CYCLE_SETUP_REQUIRED','command and replay require gate '||gate);
    IF is_base THEN
      PERFORM runtime_cycle.expect_error($q$SELECT public.crm_v2_first_contact_cycle_receipt('{"requestId":"fc130000-0000-4000-8000-000000001001"}'::jsonb)$q$,
        'P0001','CRM_SLA_CYCLE_SETUP_REQUIRED','lookup requires base gate '||gate);
    ELSE
      PERFORM runtime_cycle.assert_true(public.crm_v2_first_contact_cycle_receipt('{"requestId":"fc130000-0000-4000-8000-000000001001"}'::jsonb)->'receipt'=
        (SELECT value FROM runtime_cycle.context WHERE key='first'),'lookup remains available with '||gate||' off');
    END IF;
    RESET ROLE;
    EXECUTE format('UPDATE public.crm_settings SET %I=true WHERE id',gate);
  END LOOP;
END;
$gates$;

SET LOCAL ROLE authenticated;
DO $invalid$
DECLARE bad jsonb; index_value integer:=0;
BEGIN
  FOREACH bad IN ARRAY ARRAY['null'::jsonb,'[]'::jsonb,'{}'::jsonb,'{"requestId":null}'::jsonb,'{"requestId":123}'::jsonb,
    '{"requestId":"bad"}'::jsonb,'{"requestId":"fc130000-0000-4000-8000-000000001001","limit":1}'::jsonb,
    '{"requestId":"fc130000-0000-4000-8000-000000001001","taskIds":[]}'::jsonb,
    jsonb_build_object('requestId',repeat('x',1100))] LOOP
    index_value:=index_value+1;
    PERFORM runtime_cycle.expect_error(format('SELECT public.crm_v2_process_first_contact_cycle(%L::jsonb)',bad::text),
      'P0001','CRM_SLA_CYCLE_INVALID_INPUT','invalid command input '||index_value);
    PERFORM runtime_cycle.expect_error(format('SELECT public.crm_v2_first_contact_cycle_receipt(%L::jsonb)',bad::text),
      'P0001','CRM_SLA_CYCLE_INVALID_INPUT','invalid lookup input '||index_value);
  END LOOP;
END;
$invalid$;
SELECT runtime_cycle.expect_error('SELECT public.crm_v2_process_first_contact_cycle(NULL)','P0001','CRM_SLA_CYCLE_INVALID_INPUT','SQL NULL command rejected');
SELECT runtime_cycle.expect_error('SELECT public.crm_v2_first_contact_cycle_receipt(NULL)','P0001','CRM_SLA_CYCLE_INVALID_INPUT','SQL NULL lookup rejected');
SELECT set_config('request.jwt.claims','{"role":"admin","user_metadata":{"role":"admin"}}',true);
DO $non_admins$
DECLARE who uuid;
BEGIN
  FOREACH who IN ARRAY ARRAY['fc130000-0000-4000-8000-000000000002'::uuid,'fc130000-0000-4000-8000-000000000004'::uuid,
    'fc130000-0000-4000-8000-000000000005'::uuid,'fc130000-0000-4000-8000-000000000006'::uuid] LOOP
    PERFORM set_config('request.jwt.claim.sub',who::text,true);
    PERFORM runtime_cycle.assert_true(public.crm_v2_sla_cycle_capabilities()->'enabled'='false'::jsonb
      AND public.crm_v2_sla_cycle_capabilities()->'processing_enabled'='false'::jsonb,'non-Admin capability disabled '||who);
    PERFORM runtime_cycle.expect_error('SELECT public.crm_v2_process_first_contact_cycle(''{}''::jsonb)',
      'P0001','CRM_SLA_CYCLE_FORBIDDEN','non-Admin command denied '||who);
    PERFORM runtime_cycle.expect_error('SELECT public.crm_v2_first_contact_cycle_receipt(''{}''::jsonb)',
      'P0001','CRM_SLA_CYCLE_FORBIDDEN','non-Admin lookup denied '||who);
  END LOOP;
END;
$non_admins$;
SELECT set_config('request.jwt.claim.sub','',true);
SELECT set_config('request.jwt.claims','',true);
SELECT runtime_cycle.expect_error('SELECT public.crm_v2_process_first_contact_cycle(''{}''::jsonb)',
 'P0001','CRM_SLA_CYCLE_FORBIDDEN','missing identity rejected before input');
RESET ROLE;
UPDATE sales_private.crm_user_roles SET is_active=false WHERE user_id='fc130000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','fc130000-0000-4000-8000-000000000001',true);
SELECT runtime_cycle.expect_error($q$SELECT public.crm_v2_process_first_contact_cycle('{"requestId":"fc130000-0000-4000-8000-000000001001"}'::jsonb)$q$,
 'P0001','CRM_SLA_CYCLE_FORBIDDEN','revoked Admin cannot replay committed cycle');
SELECT runtime_cycle.expect_error($q$SELECT public.crm_v2_first_contact_cycle_receipt('{"requestId":"fc130000-0000-4000-8000-000000001001"}'::jsonb)$q$,
 'P0001','CRM_SLA_CYCLE_FORBIDDEN','revoked Admin cannot read old cycle');
RESET ROLE;
UPDATE sales_private.crm_user_roles SET is_active=true WHERE user_id='fc130000-0000-4000-8000-000000000001';
SET LOCAL ROLE anon;
SELECT runtime_cycle.expect_error('SELECT public.crm_v2_sla_cycle_capabilities()','42501',NULL,'anon cannot read capability');
SELECT runtime_cycle.expect_error('SELECT public.crm_v2_process_first_contact_cycle(''{}''::jsonb)','42501',NULL,'anon cannot process cycle');
SELECT runtime_cycle.expect_error('SELECT public.crm_v2_first_contact_cycle_receipt(''{}''::jsonb)','42501',NULL,'anon cannot read cycle receipt');
RESET ROLE;
SELECT runtime_cycle.assert_true(runtime_cycle.business_snapshot()=(SELECT value FROM runtime_cycle.context WHERE key='before_reads'),
 'all reads denied commands cached replay gates and invalid requests preserve complete business state');
SELECT runtime_cycle.expect_error('UPDATE sales_private.crm_first_contact_cycle_requests SET response=response',
 'P0001','CRM_SLA_PROCESS_INVALID_INPUT','cycle receipt immutable against privileged UPDATE');
SELECT runtime_cycle.expect_error('DELETE FROM sales_private.crm_first_contact_cycle_requests',
 'P0001','CRM_SLA_PROCESS_INVALID_INPUT','cycle receipt immutable against privileged DELETE');

-- A new explicit cycle starts a fresh sweep; it does not continue after11.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','fc130000-0000-4000-8000-000000000001',true);
INSERT INTO runtime_cycle.context VALUES('third',public.crm_v2_process_first_contact_cycle('{"requestId":"fc130000-0000-4000-8000-000000001004"}'::jsonb));
SELECT runtime_cycle.assert_true((SELECT value->'processedCount'='10'::jsonb
 AND value#>>'{receipts,0,taskId}'='fc130000-0000-4000-8000-000000000201' FROM runtime_cycle.context WHERE key='third'),
 'reset cursor revisits oldest held tasks only on a later explicit cycle');
RESET ROLE;
-- Synthetic close is fixture setup only, to test an empty tail then empty sweep.
UPDATE public.crm_sla_tasks SET status='cancelled' WHERE task_type='first_contact' AND status='open';
SET LOCAL ROLE authenticated;
INSERT INTO runtime_cycle.context VALUES('empty_tail',public.crm_v2_process_first_contact_cycle('{"requestId":"fc130000-0000-4000-8000-000000001005"}'::jsonb));
SELECT runtime_cycle.assert_true((SELECT value->'processedCount'='0'::jsonb AND value->'sweepFinished'='true'::jsonb
 AND value->'receipts'='[]'::jsonb FROM runtime_cycle.context WHERE key='empty_tail'),'zero eligible rows finishes sweep without creating child receipts');
RESET ROLE;
SELECT runtime_cycle.assert_true((SELECT after_task_id IS NULL AND after_created_at IS NULL FROM sales_private.crm_first_contact_cycle_cursor WHERE id),
 'empty tail resets cursor');
INSERT INTO runtime_cycle.context VALUES('before_empty_replay',runtime_cycle.business_snapshot());
SET LOCAL ROLE authenticated;
SELECT runtime_cycle.assert_true(public.crm_v2_process_first_contact_cycle('{"requestId":"fc130000-0000-4000-8000-000000001005"}'::jsonb)=
 (SELECT value||'{"replayed":true}'::jsonb FROM runtime_cycle.context WHERE key='empty_tail'),'empty cycle has exact idempotent replay');
RESET ROLE;
SELECT runtime_cycle.assert_true(runtime_cycle.business_snapshot()=(SELECT value FROM runtime_cycle.context WHERE key='before_empty_replay'),
 'empty replay changes no persistent state');
SELECT 'CYCLE_RUNTIME:'||jsonb_build_object('suite','first_contact_cycle','assertions',count(*))::text FROM runtime_cycle.assertions;
ROLLBACK;
