-- SYNTHETIC LOCAL RUNTIME SCENARIOS ONLY. NEVER run on Supabase or an existing DB.
-- Requires the runner's fresh isolated PostgreSQL DB, synthetic bootstrap, and
-- base + 04--09 installed by the isolated harness. Does NOT install any draft.
-- Every fixture/helper/write below rolls back, including successful RPC effects.
-- Runtime RLS/RPC tests use authenticated/anon, not superuser authorization.
-- Superuser-created historical customer/task/audit fixtures are explicitly FAKE
-- source evidence for timing branches, not an approved import/backfill workflow.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $isolation$
BEGIN
  IF current_database() !~ '^buildtrack_sales_runtime_'
    OR current_setting('buildtrack.synthetic_runtime',true) IS DISTINCT FROM 'on'
    OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet THEN
    RAISE EXCEPTION 'REFUSED: first-contact scenarios require the isolated synthetic loopback runner';
  END IF;
END;
$isolation$;

CREATE SCHEMA runtime_first_contact;
GRANT USAGE ON SCHEMA runtime_first_contact TO authenticated,anon;
CREATE TABLE runtime_first_contact.assertions(label text PRIMARY KEY);
CREATE TABLE runtime_first_contact.context(key text PRIMARY KEY,value jsonb NOT NULL);
GRANT SELECT,INSERT,UPDATE ON runtime_first_contact.assertions,runtime_first_contact.context TO authenticated,anon;
CREATE FUNCTION runtime_first_contact.assert_true(condition boolean,label text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $assert$
BEGIN
  IF condition IS DISTINCT FROM true THEN RAISE EXCEPTION 'ASSERTION FAILED: %',label; END IF;
  INSERT INTO runtime_first_contact.assertions VALUES(label);
END;
$assert$;
CREATE FUNCTION runtime_first_contact.expect_error(statement text,expected_state text,expected_message text,label text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $expect$
DECLARE actual_state text; actual_message text;
BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS actual_state=RETURNED_SQLSTATE,actual_message=MESSAGE_TEXT;
    IF actual_state<>expected_state OR (expected_message IS NOT NULL AND actual_message<>expected_message) THEN
      RAISE EXCEPTION 'ASSERTION FAILED: %; expected [%] %, received [%] %',
        label,expected_state,expected_message,actual_state,actual_message;
    END IF;
    INSERT INTO runtime_first_contact.assertions VALUES(label);
    RETURN;
  END;
  RAISE EXCEPTION 'ASSERTION FAILED: %; expected an error but statement succeeded',label;
END;
$expect$;
CREATE FUNCTION runtime_first_contact.iso(value timestamptz)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $iso$
  SELECT to_char(value AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
$iso$;

-- Synthetic identities only. No email/password, real account or external auth.
INSERT INTO auth.users(id) VALUES
 ('fc100000-0000-4000-8000-000000000001'), -- Admin
 ('fc100000-0000-4000-8000-000000000002'), -- Sales A
 ('fc100000-0000-4000-8000-000000000003'), -- Sales B, without a calendar
 ('fc100000-0000-4000-8000-000000000004'), -- Owner
 ('fc100000-0000-4000-8000-000000000005'), -- inactive Admin
 ('fc100000-0000-4000-8000-000000000006'); -- unmapped Auth identity
INSERT INTO sales_private.crm_user_roles(user_id,role,display_name,is_active) VALUES
 ('fc100000-0000-4000-8000-000000000001','admin','SYNTHETIC Admin',true),
 ('fc100000-0000-4000-8000-000000000002','sales','SYNTHETIC Sales A',true),
 ('fc100000-0000-4000-8000-000000000003','sales','SYNTHETIC Sales B',true),
 ('fc100000-0000-4000-8000-000000000004','owner','SYNTHETIC Owner',true),
 ('fc100000-0000-4000-8000-000000000005','admin','SYNTHETIC inactive Admin',false);
INSERT INTO public.crm_settings(id,central_intake_enabled,lead_work_enabled,lead_lifecycle_enabled,
 work_schedule_enabled,notifications_enabled,sla_preview_enabled,sla_processing_enabled)
VALUES(true,true,true,true,true,true,true,true)
ON CONFLICT(id) DO UPDATE SET central_intake_enabled=true,lead_work_enabled=true,lead_lifecycle_enabled=true,
 work_schedule_enabled=true,notifications_enabled=true,sla_preview_enabled=true,sla_processing_enabled=true;
INSERT INTO runtime_first_contact.context VALUES ('base_time',to_jsonb(clock_timestamp()));

-- Historical synthetic fixtures: due in 15 minutes (main), missing original
-- creation proof (held), and a valid source owned by Sales B without a roster.
INSERT INTO public.sales_customers(id,customer_name,phone,owner_user_id,created_by_user_id,
 owner_assigned_at,lead_created_at,created_at,updated_at)
SELECT x.customer_id,x.label,x.phone,x.owner_id,x.owner_id,
 (c.value#>>'{}')::timestamptz-interval '23 hours 45 minutes',
 (c.value#>>'{}')::timestamptz-interval '23 hours 45 minutes',
 (c.value#>>'{}')::timestamptz-interval '23 hours 45 minutes',
 (c.value#>>'{}')::timestamptz-interval '23 hours 45 minutes'
FROM runtime_first_contact.context c CROSS JOIN (VALUES
 ('fc100000-0000-4000-8000-000000000101'::uuid,'SYNTHETIC due-soon lead','0000000101','fc100000-0000-4000-8000-000000000002'::uuid),
 ('fc100000-0000-4000-8000-000000000102'::uuid,'SYNTHETIC missing-proof lead','0000000102','fc100000-0000-4000-8000-000000000002'::uuid),
 ('fc100000-0000-4000-8000-000000000103'::uuid,'SYNTHETIC missing-roster lead','0000000103','fc100000-0000-4000-8000-000000000003'::uuid)
) x(customer_id,label,phone,owner_id) WHERE c.key='base_time';
INSERT INTO public.crm_sla_tasks(id,customer_id,owner_user_id,task_type,obligation_started_at,service_due_at,created_at,evaluation_snapshot)
SELECT ('fc100000-0000-4000-8000-'||lpad((201+row_number() OVER(ORDER BY id)-1)::text,12,'0'))::uuid,
 id,owner_user_id,'first_contact',lead_created_at,lead_created_at+interval '24 hours',created_at,
 jsonb_build_object('initialContactHours',24,'clock','elapsed','staffDueKnown',false)
FROM public.sales_customers WHERE id IN ('fc100000-0000-4000-8000-000000000101','fc100000-0000-4000-8000-000000000102','fc100000-0000-4000-8000-000000000103');
INSERT INTO public.crm_audit_events(customer_id,entity_type,entity_id,event_type,reason_text,
 actor_user_id,actor_kind,actor_name_snapshot,new_values,occurred_at,recorded_at)
SELECT id,'customer',id,'created','SYNTHETIC historical fixture, not a migration',created_by_user_id,'staff','SYNTHETIC Sales',
 jsonb_build_object('ownerUserId',owner_user_id,'intakeStatus','new'),lead_created_at,lead_created_at
FROM public.sales_customers WHERE id IN ('fc100000-0000-4000-8000-000000000101','fc100000-0000-4000-8000-000000000103');

-- Permission tests run under ordinary roles. JWT metadata cannot make Sales an Admin.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','fc100000-0000-4000-8000-000000000002',true);
SELECT set_config('request.jwt.claims','{"sub":"fc100000-0000-4000-8000-000000000002","role":"admin","user_metadata":{"role":"admin"}}',true);
SELECT runtime_first_contact.assert_true(public.crm_v2_role()='sales','trusted role ignores editable JWT role claims');
SELECT runtime_first_contact.assert_true(public.crm_v2_sla_processing_capabilities()->'enabled'='false'::jsonb,'Sales processing capability disabled');
SELECT runtime_first_contact.expect_error($q$SELECT public.crm_v2_process_first_contact('{"requestId":"fc100000-0000-4000-8000-000000001001","taskId":"fc100000-0000-4000-8000-000000000201"}'::jsonb)$q$,
 'P0001','CRM_SLA_PROCESS_FORBIDDEN','Sales cannot invoke processor');
SELECT runtime_first_contact.expect_error('SELECT * FROM sales_private.crm_first_contact_processing_requests','42501',NULL,'private processing receipts not readable');
SELECT runtime_first_contact.expect_error('SELECT * FROM public.crm_notifications','42501',NULL,'direct notification SELECT cannot bypass inbox filter');
SELECT runtime_first_contact.expect_error('UPDATE public.crm_sla_tasks SET status=''cancelled''','42501',NULL,'direct SLA writes denied');
SELECT runtime_first_contact.expect_error('UPDATE public.crm_settings SET sla_processing_enabled=true','42501',NULL,'direct kill-switch writes denied');
SELECT runtime_first_contact.expect_error('UPDATE public.crm_audit_events SET reason_text=''forged''','42501',NULL,'direct audit mutation denied');
DO $denied_roles$
DECLARE who uuid;
BEGIN
  FOREACH who IN ARRAY ARRAY['fc100000-0000-4000-8000-000000000004'::uuid,'fc100000-0000-4000-8000-000000000005'::uuid,'fc100000-0000-4000-8000-000000000006'::uuid]
  LOOP
    PERFORM set_config('request.jwt.claim.sub',who::text,true);
    PERFORM runtime_first_contact.expect_error($q$SELECT public.crm_v2_process_first_contact('{"requestId":"fc100000-0000-4000-8000-000000001001","taskId":"fc100000-0000-4000-8000-000000000201"}'::jsonb)$q$,
      'P0001','CRM_SLA_PROCESS_FORBIDDEN','non-active-Admin rejected: '||who::text);
  END LOOP;
END;
$denied_roles$;
RESET ROLE;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.sub','fc100000-0000-4000-8000-000000000001',true);
SELECT runtime_first_contact.expect_error($q$SELECT public.crm_v2_process_first_contact('{"requestId":"fc100000-0000-4000-8000-000000001001","taskId":"fc100000-0000-4000-8000-000000000201"}'::jsonb)$q$,
 '42501',NULL,'anon cannot call processor even with Admin sub');
RESET ROLE;

-- Each of seven independent DB switches aborts before a receipt can be inserted.
DO $switches$
DECLARE switch_name text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub','fc100000-0000-4000-8000-000000000001',true);
  FOREACH switch_name IN ARRAY ARRAY['central_intake_enabled','lead_work_enabled','lead_lifecycle_enabled','work_schedule_enabled','notifications_enabled','sla_preview_enabled','sla_processing_enabled']
  LOOP
    EXECUTE format('UPDATE public.crm_settings SET %I=false WHERE id',switch_name);
    SET LOCAL ROLE authenticated;
    PERFORM runtime_first_contact.assert_true(public.crm_v2_sla_processing_capabilities()->'enabled'='false'::jsonb,'capability honors '||switch_name);
    PERFORM runtime_first_contact.expect_error($q$SELECT public.crm_v2_process_first_contact('{"requestId":"fc100000-0000-4000-8000-000000001001","taskId":"fc100000-0000-4000-8000-000000000201"}'::jsonb)$q$,
      'P0001','CRM_SLA_PROCESS_SETUP_REQUIRED','processor honors '||switch_name);
    RESET ROLE;
    EXECUTE format('UPDATE public.crm_settings SET %I=true WHERE id',switch_name);
  END LOOP;
END;
$switches$;
SELECT runtime_first_contact.assert_true((SELECT count(*)=0 FROM sales_private.crm_first_contact_processing_requests),'denied requests leave no receipts');

-- Actual central-intake RPC: Sales is assigned as owner, one first-contact task.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','fc100000-0000-4000-8000-000000000002',true);
INSERT INTO runtime_first_contact.context VALUES('central_created',public.crm_v2_create_customer(
 'fc100000-0000-4000-8000-000000002001',
 '{"name":"SYNTHETIC fresh inbound","phone":"0000000201","channel":"runtime-test","notes":"Synthetic only","interests":[]}'::jsonb));
SELECT runtime_first_contact.assert_true((SELECT value->'replayed'='false'::jsonb FROM runtime_first_contact.context WHERE key='central_created'),'central intake RPC creates new Lead');
RESET ROLE;
SELECT runtime_first_contact.assert_true((SELECT count(*)=1 FROM public.crm_sla_tasks WHERE customer_id=(SELECT (value->>'customerId')::uuid FROM runtime_first_contact.context WHERE key='central_created')),'central RPC creates exactly one SLA task');
SELECT runtime_first_contact.assert_true((SELECT owner_user_id='fc100000-0000-4000-8000-000000000002'::uuid
 AND created_by_user_id=owner_user_id AND owner_assigned_at=lead_created_at FROM public.sales_customers
 WHERE id=(SELECT (value->>'customerId')::uuid FROM runtime_first_contact.context WHERE key='central_created')),'central RPC assigns recording Sales and preserves intake clock');

-- Actual Admin publication. A broad continuous SYNTHETIC work period removes
-- dependence on today's hour/weekend; this is not a production roster template.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','fc100000-0000-4000-8000-000000000001',true);
INSERT INTO runtime_first_contact.context
SELECT 'schedule_payload',jsonb_build_object('salesUserId','fc100000-0000-4000-8000-000000000002','expectedVersion',NULL,
 'coverage',jsonb_build_object('startsAt',runtime_first_contact.iso((value#>>'{}')::timestamptz-interval '2 days'),
   'endsAt',runtime_first_contact.iso((value#>>'{}')::timestamptz+interval '2 days')),
 'periods',jsonb_build_array(jsonb_build_object('type','work','startsAt',runtime_first_contact.iso((value#>>'{}')::timestamptz-interval '2 days'),
   'endsAt',runtime_first_contact.iso((value#>>'{}')::timestamptz+interval '2 days'))),'confirmedComplete',true,'reason','SYNTHETIC runtime coverage')
FROM runtime_first_contact.context WHERE key='base_time';
INSERT INTO runtime_first_contact.context
SELECT 'schedule_created',public.crm_v2_publish_work_schedule('fc100000-0000-4000-8000-000000002002',value)
FROM runtime_first_contact.context WHERE key='schedule_payload';
SELECT runtime_first_contact.assert_true((SELECT value->'replayed'='false'::jsonb FROM runtime_first_contact.context WHERE key='schedule_created'),'Admin schedule RPC publishes version');
SELECT runtime_first_contact.assert_true(public.crm_v2_sla_processing_capabilities()->'enabled'='true'::jsonb,'Admin processor capability enabled only in synthetic DB');

-- Invalid/unknown targets produce no receipt. Caller cannot inject calculations.
SELECT runtime_first_contact.expect_error($q$SELECT public.crm_v2_process_first_contact('{"requestId":"fc100000-0000-4000-8000-000000001001","taskId":"fc100000-0000-4000-8000-000000000201","staffDueAt":"2020-01-01T00:00:00Z"}'::jsonb)$q$,
 'P0001','CRM_SLA_PROCESS_INVALID_INPUT','processor rejects supplied deadline');
SELECT runtime_first_contact.expect_error($q$SELECT public.crm_v2_process_first_contact('{"requestId":"fc100000-0000-4000-8000-000000001001","taskId":"fc100000-0000-4000-8000-000000009999"}'::jsonb)$q$,
 'P0001','CRM_SLA_PROCESS_NOT_AVAILABLE','processor rejects missing task');

-- An explicit abort AFTER a successful processor call rolls back its entire
-- transaction/subtransaction: no ready proof, notice, receipt or audit survives.
SELECT runtime_first_contact.expect_error($q$DO $rollback$
BEGIN
  PERFORM public.crm_v2_process_first_contact('{"requestId":"fc100000-0000-4000-8000-000000001090","taskId":"fc100000-0000-4000-8000-000000000201"}'::jsonb);
  RAISE EXCEPTION 'SYNTHETIC forced rollback after processor';
END;
$rollback$$q$,'P0001','SYNTHETIC forced rollback after processor','processor effects are transaction-atomic');
RESET ROLE;
SELECT runtime_first_contact.assert_true((SELECT count(*)=0 FROM sales_private.crm_first_contact_processing_requests),'forced rollback leaves no receipt');
SELECT runtime_first_contact.assert_true((SELECT count(*)=0 FROM public.crm_notifications),'forced rollback leaves no notification');
SELECT runtime_first_contact.assert_true((SELECT count(*)=0 FROM public.crm_audit_events WHERE event_type='first_contact_processed'),'forced rollback leaves no processing audit');
SELECT runtime_first_contact.assert_true((SELECT accountability_state='needs_schedule' AND staff_due_at IS NULL AND NOT evaluation_snapshot ? 'notificationBinding'
 FROM public.crm_sla_tasks WHERE id='fc100000-0000-4000-8000-000000000201'),'forced rollback leaves no ready calculation');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','fc100000-0000-4000-8000-000000000001',true);
INSERT INTO runtime_first_contact.context
SELECT 'central_processed',public.crm_v2_process_first_contact(jsonb_build_object('requestId','fc100000-0000-4000-8000-000000001010','taskId',t.id))
FROM public.crm_sla_tasks t WHERE t.customer_id=(SELECT (value->>'customerId')::uuid FROM runtime_first_contact.context WHERE key='central_created');
SELECT runtime_first_contact.assert_true((SELECT value->>'outcome'='scheduled' AND value->>'reason'='NOT_DUE_YET'
 AND value->'notificationId'='null'::jsonb AND value->'completedAt'='null'::jsonb FROM runtime_first_contact.context WHERE key='central_processed'),'unmodified central-created source is scheduled without premature delivery');
INSERT INTO runtime_first_contact.context VALUES('first_process',public.crm_v2_process_first_contact(
 '{"requestId":"fc100000-0000-4000-8000-000000001001","taskId":"fc100000-0000-4000-8000-000000000201"}'::jsonb));
SELECT runtime_first_contact.assert_true((SELECT value->>'outcome'='notified' AND value->>'reason'='DUE_SOON'
 AND value->>'notificationType'='due_soon' AND value->'replayed'='false'::jsonb AND value->>'notificationId' IS NOT NULL
 FROM runtime_first_contact.context WHERE key='first_process'),'processing persists one due-soon notice');
INSERT INTO runtime_first_contact.context VALUES('first_replay',public.crm_v2_process_first_contact(
 '{"requestId":"fc100000-0000-4000-8000-000000001001","taskId":"fc100000-0000-4000-8000-000000000201"}'::jsonb));
SELECT runtime_first_contact.assert_true((SELECT (r.value-'replayed')=(p.value-'replayed') AND r.value->'replayed'='true'::jsonb
 FROM runtime_first_contact.context r CROSS JOIN runtime_first_contact.context p WHERE r.key='first_replay' AND p.key='first_process'),'same request replays identical historical receipt');
SELECT runtime_first_contact.expect_error($q$SELECT public.crm_v2_process_first_contact('{"requestId":"fc100000-0000-4000-8000-000000001001","taskId":"fc100000-0000-4000-8000-000000000202"}'::jsonb)$q$,
 'P0001','CRM_SLA_PROCESS_IDEMPOTENCY_CONFLICT','same request cannot target another task');
INSERT INTO runtime_first_contact.context VALUES('new_request_same_notice',public.crm_v2_process_first_contact(
 '{"requestId":"fc100000-0000-4000-8000-000000001002","taskId":"fc100000-0000-4000-8000-000000000201"}'::jsonb));
SELECT runtime_first_contact.assert_true((SELECT r.value->>'outcome'='already_notified' AND r.value->>'notificationId'=p.value->>'notificationId'
 FROM runtime_first_contact.context r CROSS JOIN runtime_first_contact.context p WHERE r.key='new_request_same_notice' AND p.key='first_process'),'new request deduplicates current delivery');
RESET ROLE;
SELECT runtime_first_contact.assert_true((SELECT count(*)=1 FROM public.crm_notifications WHERE task_id='fc100000-0000-4000-8000-000000000201'),'replay and new request produce no duplicate notice');
SELECT runtime_first_contact.assert_true((SELECT count(*)=2 FROM public.crm_audit_events WHERE entity_id='fc100000-0000-4000-8000-000000000201' AND event_type='first_contact_processed'),'replay appends no duplicate audit');
SELECT runtime_first_contact.assert_true((SELECT count(*)=2 FROM sales_private.crm_first_contact_processing_requests WHERE task_id='fc100000-0000-4000-8000-000000000201'),'only distinct successful requests get receipts');
SELECT runtime_first_contact.assert_true((SELECT t.status='open' AND t.accountability_state='ready' AND t.service_due_at=c.lead_created_at+interval '24 hours'
 AND t.staff_due_at=t.service_due_at AND c.first_contacted_at IS NULL AND t.evaluation_snapshot#>>'{notificationBinding,state}'='ready'
 FROM public.crm_sla_tasks t JOIN public.sales_customers c ON c.id=t.customer_id WHERE t.id='fc100000-0000-4000-8000-000000000201'),'ready calculation preserves service clock and does not fabricate contact');

-- Receipts and processor audit are immutable even to this privileged fixture connection.
SELECT runtime_first_contact.expect_error($q$UPDATE sales_private.crm_first_contact_processing_requests SET response='{}'::jsonb WHERE request_id='fc100000-0000-4000-8000-000000001001'$q$,
 'P0001','CRM_SLA_PROCESS_INVALID_INPUT','processing receipt UPDATE blocked by immutable trigger');
SELECT runtime_first_contact.expect_error($q$DELETE FROM sales_private.crm_first_contact_processing_requests WHERE request_id='fc100000-0000-4000-8000-000000001001'$q$,
 'P0001','CRM_SLA_PROCESS_INVALID_INPUT','processing receipt DELETE blocked by immutable trigger');
SELECT runtime_first_contact.expect_error($q$UPDATE public.crm_audit_events SET reason_text='forged' WHERE entity_id='fc100000-0000-4000-8000-000000000201' AND event_type='first_contact_processed'$q$,
 'P0001','CRM_SLA_PROCESS_INVALID_INPUT','processing audit UPDATE blocked by immutable trigger');
SELECT runtime_first_contact.expect_error($q$DELETE FROM public.crm_audit_events WHERE entity_id='fc100000-0000-4000-8000-000000000201' AND event_type='first_contact_processed'$q$,
 'P0001','CRM_SLA_PROCESS_INVALID_INPUT','processing audit DELETE blocked by immutable trigger');

-- A retained receipt never bypasses current authorization or kill switches.
UPDATE sales_private.crm_user_roles SET is_active=false WHERE user_id='fc100000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT runtime_first_contact.expect_error($q$SELECT public.crm_v2_process_first_contact('{"requestId":"fc100000-0000-4000-8000-000000001001","taskId":"fc100000-0000-4000-8000-000000000201"}'::jsonb)$q$,
 'P0001','CRM_SLA_PROCESS_FORBIDDEN','inactive Admin cannot replay historical receipt');
RESET ROLE;
UPDATE sales_private.crm_user_roles SET is_active=true WHERE user_id='fc100000-0000-4000-8000-000000000001';
UPDATE public.crm_settings SET sla_processing_enabled=false WHERE id;
SET LOCAL ROLE authenticated;
SELECT runtime_first_contact.expect_error($q$SELECT public.crm_v2_process_first_contact('{"requestId":"fc100000-0000-4000-8000-000000001001","taskId":"fc100000-0000-4000-8000-000000000201"}'::jsonb)$q$,
 'P0001','CRM_SLA_PROCESS_SETUP_REQUIRED','kill switch prevents replay');
RESET ROLE;
UPDATE public.crm_settings SET sla_processing_enabled=true WHERE id;

-- Inbox recipient binding and monotonic read state on the real notification.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','fc100000-0000-4000-8000-000000000002',true);
SELECT runtime_first_contact.assert_true(public.crm_v2_notifications_snapshot(0)->>'unreadCount'='1','recipient sees exactly own eligible notice');
INSERT INTO runtime_first_contact.context SELECT 'read_receipt',public.crm_v2_mark_notification_read((value->>'notificationId')::uuid)
 FROM runtime_first_contact.context WHERE key='first_process';
SELECT runtime_first_contact.assert_true(public.crm_v2_notifications_snapshot(0)->>'unreadCount'='0','mark-read clears own unread count');
SELECT runtime_first_contact.assert_true((SELECT public.crm_v2_mark_notification_read((p.value->>'notificationId')::uuid)=r.value
 FROM runtime_first_contact.context p CROSS JOIN runtime_first_contact.context r WHERE p.key='first_process' AND r.key='read_receipt'),'read acknowledgment is monotonic on retry');
SELECT set_config('request.jwt.claim.sub','fc100000-0000-4000-8000-000000000003',true);
SELECT runtime_first_contact.assert_true(public.crm_v2_notifications_snapshot(0)->'notifications'='[]'::jsonb,'another Sales cannot see first Sales notice');
SELECT runtime_first_contact.expect_error($q$SELECT public.crm_v2_mark_notification_read((SELECT (value->>'notificationId')::uuid FROM runtime_first_contact.context WHERE key='first_process'))$q$,
 'P0001','CRM_NOTIFICATION_NOT_AVAILABLE','another Sales cannot mark first Sales notice read');
SELECT set_config('request.jwt.claim.sub','fc100000-0000-4000-8000-000000000001',true);
SELECT runtime_first_contact.assert_true(public.crm_v2_notifications_snapshot(0)->'notifications'='[]'::jsonb,'Admin inbox cannot impersonate Sales recipient');

-- Held outcomes are stored as receipts/review, never automatic success or blame.
INSERT INTO runtime_first_contact.context VALUES('held_missing_proof',public.crm_v2_process_first_contact(
 '{"requestId":"fc100000-0000-4000-8000-000000001003","taskId":"fc100000-0000-4000-8000-000000000202"}'::jsonb));
INSERT INTO runtime_first_contact.context VALUES('held_missing_calendar',public.crm_v2_process_first_contact(
 '{"requestId":"fc100000-0000-4000-8000-000000001004","taskId":"fc100000-0000-4000-8000-000000000203"}'::jsonb));
SELECT runtime_first_contact.assert_true((SELECT value->>'outcome'='held' AND value->>'reason'='MISSING_CREATION_EVIDENCE'
 AND value->'staffDueAt'='null'::jsonb AND value->'notificationId'='null'::jsonb FROM runtime_first_contact.context WHERE key='held_missing_proof'),'missing original proof holds task');
SELECT runtime_first_contact.assert_true((SELECT value->>'outcome'='held' AND value->>'reason'='MISSING_CALENDAR'
 FROM runtime_first_contact.context WHERE key='held_missing_calendar'),'missing roster holds task without default schedule');
RESET ROLE;
SELECT runtime_first_contact.assert_true((SELECT count(*)=0 FROM public.crm_notifications WHERE task_id IN ('fc100000-0000-4000-8000-000000000202','fc100000-0000-4000-8000-000000000203')),'held tasks have no notifications');
SELECT runtime_first_contact.assert_true((SELECT bool_and(status='open' AND completed_at IS NULL AND staff_due_at IS NULL)
 FROM public.crm_sla_tasks WHERE id IN ('fc100000-0000-4000-8000-000000000202','fc100000-0000-4000-8000-000000000203')),'held tasks remain open without invented completion');

-- Publish a NEW roster version through 06. Old ready notices hide immediately;
-- processing reloads current version, withdraws old notice and preserves read_at.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','fc100000-0000-4000-8000-000000000001',true);
INSERT INTO runtime_first_contact.context
SELECT 'schedule_replacement',public.crm_v2_publish_work_schedule('fc100000-0000-4000-8000-000000002003',
 p.value||jsonb_build_object('expectedVersion',v.value->>'version','reason','SYNTHETIC replacement for stale-version test'))
FROM runtime_first_contact.context p CROSS JOIN runtime_first_contact.context v WHERE p.key='schedule_payload' AND v.key='schedule_created';
SELECT set_config('request.jwt.claim.sub','fc100000-0000-4000-8000-000000000002',true);
SELECT runtime_first_contact.assert_true(public.crm_v2_notifications_snapshot(0)->'notifications'='[]'::jsonb,'new roster immediately hides old-version notice');
SELECT set_config('request.jwt.claim.sub','fc100000-0000-4000-8000-000000000001',true);
INSERT INTO runtime_first_contact.context VALUES('new_calendar_process',public.crm_v2_process_first_contact(
 '{"requestId":"fc100000-0000-4000-8000-000000001005","taskId":"fc100000-0000-4000-8000-000000000201"}'::jsonb));
SELECT runtime_first_contact.assert_true((SELECT n.value->>'outcome'='notified' AND n.value->>'withdrawnCount'='1'
 AND n.value->>'notificationId'<>p.value->>'notificationId' FROM runtime_first_contact.context n CROSS JOIN runtime_first_contact.context p
 WHERE n.key='new_calendar_process' AND p.key='first_process'),'new roster processing creates distinct current notice and withdraws prior');
RESET ROLE;
SELECT runtime_first_contact.assert_true((SELECT n.withdrawn_at IS NOT NULL AND n.read_at=(r.value->>'readAt')::timestamptz
 FROM public.crm_notifications n CROSS JOIN runtime_first_contact.context r WHERE n.id=(SELECT (value->>'notificationId')::uuid FROM runtime_first_contact.context WHERE key='first_process')
 AND r.key='read_receipt'),'withdrawing stale notice preserves historical read timestamp');

-- Actual lead-work command for no-answer does NOT complete first contact.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','fc100000-0000-4000-8000-000000000002',true);
INSERT INTO runtime_first_contact.context VALUES('no_answer',public.crm_v2_record_lead_work('fc100000-0000-4000-8000-000000003001',
 jsonb_build_object('command','record_attempt','customerId','fc100000-0000-4000-8000-000000000101','interestId',NULL,'expectedActionId',NULL,
 'nextAction',jsonb_build_object('action','SYNTHETIC next contact','dueAt',runtime_first_contact.iso(clock_timestamp()+interval '1 hour')),
 'reason','SYNTHETIC no answer','attempt',jsonb_build_object('action','SYNTHETIC attempted call','channel','phone','result','no_answer','occurredAt',runtime_first_contact.iso(clock_timestamp())))));
SELECT set_config('request.jwt.claim.sub','fc100000-0000-4000-8000-000000000001',true);
INSERT INTO runtime_first_contact.context VALUES('no_answer_process',public.crm_v2_process_first_contact(
 '{"requestId":"fc100000-0000-4000-8000-000000001006","taskId":"fc100000-0000-4000-8000-000000000201"}'::jsonb));
SELECT runtime_first_contact.assert_true((SELECT value->>'outcome'='already_notified' AND value->'completedAt'='null'::jsonb
 FROM runtime_first_contact.context WHERE key='no_answer_process'),'no-answer does not become proven contact');

-- Successful contact through 04 creates the precise activity + next-action +
-- audit + private receipt required by 09. +07:00 payload/audit serialization
-- exercises equivalent-instant comparison instead of matching timestamp text.
SELECT set_config('request.jwt.claim.sub','fc100000-0000-4000-8000-000000000002',true);
SET LOCAL TIME ZONE 'Asia/Bangkok';
INSERT INTO runtime_first_contact.context
SELECT 'contact_success',public.crm_v2_record_lead_work('fc100000-0000-4000-8000-000000003002',
 jsonb_build_object('command','record_attempt','customerId','fc100000-0000-4000-8000-000000000101','interestId',NULL,
 'expectedActionId',value->>'nextActionId','nextAction',jsonb_build_object('action','SYNTHETIC follow-up after contact',
 'dueAt',to_char((clock_timestamp()+interval '2 hours') AT TIME ZONE 'Asia/Bangkok','YYYY-MM-DD"T"HH24:MI:SS.US')||'+07:00'),
 'reason','SYNTHETIC proven call','attempt',jsonb_build_object('action','SYNTHETIC successful call','channel','phone','result','contact_success',
 'occurredAt',to_char(clock_timestamp() AT TIME ZONE 'Asia/Bangkok','YYYY-MM-DD"T"HH24:MI:SS.US')||'+07:00')))
FROM runtime_first_contact.context WHERE key='no_answer';
SET LOCAL TIME ZONE 'UTC';
SELECT set_config('request.jwt.claim.sub','fc100000-0000-4000-8000-000000000001',true);
INSERT INTO runtime_first_contact.context VALUES('completed',public.crm_v2_process_first_contact(
 '{"requestId":"fc100000-0000-4000-8000-000000001007","taskId":"fc100000-0000-4000-8000-000000000201"}'::jsonb));
SELECT runtime_first_contact.assert_true((SELECT p.value->>'outcome'='completed' AND p.value->>'reason'='CONTACT_PROVEN'
 AND p.value->>'completedByActivityId'=a.value->>'activityId' AND p.value->'completedAt'<>'null'::jsonb
 AND p.value->'staffDueAt'='null'::jsonb AND p.value->'notificationId'='null'::jsonb AND p.value->>'withdrawnCount'='1'
 FROM runtime_first_contact.context p CROSS JOIN runtime_first_contact.context a WHERE p.key='completed' AND a.key='contact_success'),'proven contact completes task and withdraws current notice');
RESET ROLE;
SELECT runtime_first_contact.assert_true((SELECT t.status='done' AND t.completed_by_activity_id=a.id AND t.completed_at=a.occurred_at
 AND c.first_contacted_at=a.occurred_at AND t.service_due_at=c.lead_created_at+interval '24 hours'
 FROM public.crm_sla_tasks t JOIN public.sales_customers c ON c.id=t.customer_id JOIN public.lead_activities a ON a.id=t.completed_by_activity_id
 WHERE t.id='fc100000-0000-4000-8000-000000000201'),'completion stores exact evidenced milestone and preserves service clock');
SELECT runtime_first_contact.assert_true((SELECT count(*)=0 FROM public.crm_notifications WHERE task_id='fc100000-0000-4000-8000-000000000201' AND withdrawn_at IS NULL),'completion leaves no active reminder');
SELECT runtime_first_contact.assert_true((SELECT count(*)=1 FROM public.crm_next_actions WHERE customer_id='fc100000-0000-4000-8000-000000000101' AND status='open'),'completion does not close or duplicate follow-up plan');

-- Replay stays historical after task completion; a NEW request gets closed.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','fc100000-0000-4000-8000-000000000001',true);
SELECT runtime_first_contact.assert_true((SELECT (public.crm_v2_process_first_contact('{"requestId":"fc100000-0000-4000-8000-000000001001","taskId":"fc100000-0000-4000-8000-000000000201"}'::jsonb)-'replayed')=(value-'replayed')
 FROM runtime_first_contact.context WHERE key='first_process'),'historical receipt remains recoverable after completion');
INSERT INTO runtime_first_contact.context VALUES('closed',public.crm_v2_process_first_contact(
 '{"requestId":"fc100000-0000-4000-8000-000000001008","taskId":"fc100000-0000-4000-8000-000000000201"}'::jsonb));
SELECT runtime_first_contact.assert_true((SELECT value->>'outcome'='closed' AND value->>'reason'='TASK_CLOSED' FROM runtime_first_contact.context WHERE key='closed'),'new request sees task already closed');
SELECT set_config('request.jwt.claim.sub','fc100000-0000-4000-8000-000000000002',true);
SELECT runtime_first_contact.assert_true(public.crm_v2_notifications_snapshot(0)->'notifications'='[]'::jsonb,'completed task no longer appears in Sales inbox');
RESET ROLE;
SELECT runtime_first_contact.assert_true((SELECT count(*)=2 FROM public.crm_notifications WHERE task_id='fc100000-0000-4000-8000-000000000201'),'all repeated processing preserves exactly two versioned historical notices');
SELECT runtime_first_contact.assert_true((SELECT n.read_at=(r.value->>'readAt')::timestamptz FROM public.crm_notifications n CROSS JOIN runtime_first_contact.context r
 WHERE n.id=(SELECT (value->>'notificationId')::uuid FROM runtime_first_contact.context WHERE key='first_process') AND r.key='read_receipt'),'completion and replay never erase prior read receipt');

-- Additional adversarial evidence fixtures. A synthetic legacy customer with an
-- ERRONEOUS pre-existing SLA task must be held, not treated as a valid import.
-- No runtime test authorizes creating such an SLA in the production import path.
INSERT INTO public.leads(id,phone) VALUES('fc100000-0000-4000-8000-000000000901',NULL);
INSERT INTO public.sales_customers(id,customer_name,record_origin,legacy_source_lead_id,phone,phone_data_status,
 intake_status,owner_user_id,created_by_user_id,lead_created_at)
VALUES('fc100000-0000-4000-8000-000000000104','SYNTHETIC legacy unknown evidence','legacy_import',
 'fc100000-0000-4000-8000-000000000901',NULL,'unknown_legacy','legacy_unclassified',
 'fc100000-0000-4000-8000-000000000002','fc100000-0000-4000-8000-000000000001',NULL);
INSERT INTO public.sales_customers(id,customer_name,phone,owner_user_id,created_by_user_id,
 owner_assigned_at,lead_created_at,created_at,updated_at)
SELECT x.customer_id,x.label,x.phone,c.owner_user_id,c.created_by_user_id,
 c.lead_created_at,c.lead_created_at,c.created_at,c.created_at
FROM public.sales_customers c CROSS JOIN (VALUES
 ('fc100000-0000-4000-8000-000000000105'::uuid,'SYNTHETIC corrected no-answer','0000000105'),
 ('fc100000-0000-4000-8000-000000000106'::uuid,'SYNTHETIC corrected success','0000000106'),
 ('fc100000-0000-4000-8000-000000000107'::uuid,'SYNTHETIC owner transfer','0000000107')
) x(customer_id,label,phone) WHERE c.id='fc100000-0000-4000-8000-000000000101';
INSERT INTO public.crm_sla_tasks(id,customer_id,owner_user_id,task_type,obligation_started_at,service_due_at,created_at,evaluation_snapshot)
SELECT x.task_id,x.customer_id,'fc100000-0000-4000-8000-000000000002','first_contact',
 c.lead_created_at,c.lead_created_at+interval '24 hours',c.created_at,jsonb_build_object('initialContactHours',24)
FROM public.sales_customers c CROSS JOIN (VALUES
 ('fc100000-0000-4000-8000-000000000204'::uuid,'fc100000-0000-4000-8000-000000000104'::uuid),
 ('fc100000-0000-4000-8000-000000000205'::uuid,'fc100000-0000-4000-8000-000000000105'::uuid),
 ('fc100000-0000-4000-8000-000000000206'::uuid,'fc100000-0000-4000-8000-000000000106'::uuid),
 ('fc100000-0000-4000-8000-000000000207'::uuid,'fc100000-0000-4000-8000-000000000107'::uuid)
) x(task_id,customer_id) WHERE c.id='fc100000-0000-4000-8000-000000000101';
INSERT INTO public.crm_audit_events(customer_id,entity_type,entity_id,event_type,reason_text,
 actor_user_id,actor_kind,actor_name_snapshot,new_values,occurred_at,recorded_at)
SELECT id,'customer',id,'created','SYNTHETIC source proof for correction/transfer test',created_by_user_id,'staff','SYNTHETIC Sales',
 jsonb_build_object('ownerUserId',owner_user_id,'intakeStatus','new'),lead_created_at,lead_created_at
FROM public.sales_customers WHERE id IN ('fc100000-0000-4000-8000-000000000105','fc100000-0000-4000-8000-000000000106','fc100000-0000-4000-8000-000000000107');

-- Both ORIGINAL attempts are created by the real 04 command, with its original
-- audit and private receipt. Only a correction edge is seeded by the privileged
-- fixture connection below; the original activity/result is never rewritten.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','fc100000-0000-4000-8000-000000000002',true);
INSERT INTO runtime_first_contact.context
SELECT x.context_key,public.crm_v2_record_lead_work(x.request_id,
 jsonb_build_object('command','record_attempt','customerId',x.customer_id,'interestId',NULL,'expectedActionId',NULL,
 'nextAction',jsonb_build_object('action','SYNTHETIC corrected-evidence follow-up','dueAt',runtime_first_contact.iso(clock_timestamp()+interval '2 hours')),
 'reason','SYNTHETIC original attempt','attempt',jsonb_build_object('action','SYNTHETIC original call','channel','phone',
 'result',x.result_value,'occurredAt',runtime_first_contact.iso(clock_timestamp()))))
FROM (VALUES
 ('corrected_no_answer_original','fc100000-0000-4000-8000-000000004001'::uuid,'fc100000-0000-4000-8000-000000000105'::uuid,'no_answer'),
 ('corrected_success_original','fc100000-0000-4000-8000-000000004002'::uuid,'fc100000-0000-4000-8000-000000000106'::uuid,'contact_success')
) x(context_key,request_id,customer_id,result_value);
RESET ROLE;
INSERT INTO public.crm_audit_events(customer_id,entity_type,entity_id,event_type,reason_text,
 actor_user_id,actor_kind,actor_name_snapshot,new_values,occurred_at,recorded_at,correction_of_event_id)
SELECT CASE WHEN c.key='corrected_no_answer_original' THEN NULL ELSE a.customer_id END,
 CASE WHEN c.key='corrected_no_answer_original' THEN 'note' ELSE a.entity_type END,
 CASE WHEN c.key='corrected_no_answer_original' THEN 'fc100000-0000-4000-8000-000000008001'::uuid ELSE a.entity_id END,
 'synthetic_correction','SYNTHETIC disputed evidence; no approved correction resolver',
 'fc100000-0000-4000-8000-000000000001','staff','SYNTHETIC Admin',jsonb_build_object('reviewRequired',true),
 clock_timestamp(),clock_timestamp(),a.id
FROM runtime_first_contact.context c JOIN public.crm_audit_events a ON a.new_values->>'activityId'=c.value->>'activityId'
WHERE c.key IN ('corrected_no_answer_original','corrected_success_original');
SELECT runtime_first_contact.assert_true((SELECT count(*)=2 FROM public.crm_audit_events WHERE event_type='synthetic_correction'),
 'correction fixtures append two edges without rewriting source proof');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','fc100000-0000-4000-8000-000000000001',true);
INSERT INTO runtime_first_contact.context VALUES
 ('legacy_held',public.crm_v2_process_first_contact('{"requestId":"fc100000-0000-4000-8000-000000001011","taskId":"fc100000-0000-4000-8000-000000000204"}'::jsonb)),
 ('corrected_no_answer_held',public.crm_v2_process_first_contact('{"requestId":"fc100000-0000-4000-8000-000000001012","taskId":"fc100000-0000-4000-8000-000000000205"}'::jsonb)),
 ('corrected_success_held',public.crm_v2_process_first_contact('{"requestId":"fc100000-0000-4000-8000-000000001013","taskId":"fc100000-0000-4000-8000-000000000206"}'::jsonb));
SELECT runtime_first_contact.assert_true((SELECT value->>'outcome'='held' AND value->>'reason'='LEGACY_REVIEW'
 AND value->'completedAt'='null'::jsonb AND value->'staffDueAt'='null'::jsonb FROM runtime_first_contact.context WHERE key='legacy_held'),
 'legacy source is held even when an erroneous open SLA already exists');
SELECT runtime_first_contact.assert_true((SELECT value->>'outcome'='held' AND value->>'reason'='CONTACT_REVIEW'
 AND value->'completedAt'='null'::jsonb FROM runtime_first_contact.context WHERE key='corrected_no_answer_held'),
 'correction of no-answer holds contact even when correction carries unrelated metadata');
SELECT runtime_first_contact.assert_true((SELECT value->>'outcome'='held' AND value->>'reason'='CONTACT_REVIEW'
 AND value->'completedAt'='null'::jsonb FROM runtime_first_contact.context WHERE key='corrected_success_held'),
 'corrected contact-success cannot be auto-completed from its original proof');
RESET ROLE;
SELECT runtime_first_contact.assert_true((SELECT bool_and(t.status='open' AND t.completed_at IS NULL AND c.first_contacted_at IS NULL)
 FROM public.crm_sla_tasks t JOIN public.sales_customers c ON c.id=t.customer_id
 WHERE t.id IN ('fc100000-0000-4000-8000-000000000204','fc100000-0000-4000-8000-000000000205','fc100000-0000-4000-8000-000000000206')),
 'legacy and disputed evidence do not fabricate task or customer contact milestones');
SELECT runtime_first_contact.assert_true((SELECT count(*)=0 FROM public.crm_notifications
 WHERE task_id IN ('fc100000-0000-4000-8000-000000000204','fc100000-0000-4000-8000-000000000205','fc100000-0000-4000-8000-000000000206')),
 'legacy and corrected evidence create no delivery');
SELECT runtime_first_contact.assert_true((SELECT bool_and(a.result=CASE WHEN c.key='corrected_no_answer_original' THEN 'no_answer' ELSE 'contact_success' END)
 FROM runtime_first_contact.context c JOIN public.lead_activities a ON a.id=(c.value->>'activityId')::uuid
 WHERE c.key IN ('corrected_no_answer_original','corrected_success_original')),'correction test preserves both original activity results');

-- A REAL 05 owner transfer must invalidate the previous owner's calculation and
-- withdraw that notice. Admin replay remains historical, not a ready new-owner SLA.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','fc100000-0000-4000-8000-000000000001',true);
INSERT INTO runtime_first_contact.context VALUES('before_owner_change',public.crm_v2_process_first_contact(
 '{"requestId":"fc100000-0000-4000-8000-000000001020","taskId":"fc100000-0000-4000-8000-000000000207"}'::jsonb));
SELECT runtime_first_contact.assert_true((SELECT value->>'outcome'='notified' FROM runtime_first_contact.context WHERE key='before_owner_change'),
 'owner-transfer fixture has an actual original-recipient notice');
INSERT INTO runtime_first_contact.context
SELECT 'owner_changed',public.crm_v2_change_lead_lifecycle('fc100000-0000-4000-8000-000000004003',
 jsonb_build_object('command','reassign_owner','customerId',id,'interestId',NULL,'expectedRevision',lifecycle_revision,
 'expectedActionId',NULL,'reason','SYNTHETIC Admin transfer','newOwnerUserId','fc100000-0000-4000-8000-000000000003'))
FROM public.sales_customers WHERE id='fc100000-0000-4000-8000-000000000107';
INSERT INTO runtime_first_contact.context VALUES('after_owner_change',public.crm_v2_process_first_contact(
 '{"requestId":"fc100000-0000-4000-8000-000000001021","taskId":"fc100000-0000-4000-8000-000000000207"}'::jsonb));
SELECT runtime_first_contact.assert_true((SELECT value->>'outcome'='held' AND value->>'reason'='OWNER_REVIEW'
 AND value->'staffDueAt'='null'::jsonb FROM runtime_first_contact.context WHERE key='after_owner_change'),'transferred owner cannot inherit prior ready deadline');
SELECT runtime_first_contact.assert_true((SELECT (public.crm_v2_process_first_contact('{"requestId":"fc100000-0000-4000-8000-000000001020","taskId":"fc100000-0000-4000-8000-000000000207"}'::jsonb)-'replayed')=(value-'replayed')
 FROM runtime_first_contact.context WHERE key='before_owner_change'),'current Admin recovers historical receipt after owner transfer without reprocessing');
SELECT set_config('request.jwt.claim.sub','fc100000-0000-4000-8000-000000000003',true);
SELECT runtime_first_contact.assert_true(public.crm_v2_notifications_snapshot(0)->'notifications'='[]'::jsonb,
 'new owner receives no old-owner notification or read receipt');
RESET ROLE;
SELECT runtime_first_contact.assert_true((SELECT c.owner_user_id='fc100000-0000-4000-8000-000000000003'::uuid
 AND t.owner_user_id=c.owner_user_id AND t.status='open' AND t.staff_due_at IS NULL
 AND t.evaluation_snapshot#>>'{lifecycleReview,state}'='owner_change_pending_review'
 AND t.service_due_at=c.lead_created_at+interval '24 hours'
 FROM public.sales_customers c JOIN public.crm_sla_tasks t ON t.customer_id=c.id WHERE t.id='fc100000-0000-4000-8000-000000000207'),
 'actual transfer preserves service clock and pending owner-review evidence');
SELECT runtime_first_contact.assert_true((SELECT count(*)=1 AND bool_and(recipient_user_id='fc100000-0000-4000-8000-000000000002'::uuid AND withdrawn_at IS NOT NULL)
 FROM public.crm_notifications WHERE task_id='fc100000-0000-4000-8000-000000000207'),'transfer withdraws rather than moves or duplicates prior-recipient notice');

-- Active identity with a revoked Admin role is distinct from the inactive-user
-- check above. Even its existing processing receipt must not be disclosed.
UPDATE sales_private.crm_user_roles SET role='owner' WHERE user_id='fc100000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','fc100000-0000-4000-8000-000000000001',true);
SELECT runtime_first_contact.expect_error($q$SELECT public.crm_v2_process_first_contact('{"requestId":"fc100000-0000-4000-8000-000000001020","taskId":"fc100000-0000-4000-8000-000000000207"}'::jsonb)$q$,
 'P0001','CRM_SLA_PROCESS_FORBIDDEN','active former Admin cannot replay saved processing receipt');
RESET ROLE;
UPDATE sales_private.crm_user_roles SET role='admin' WHERE user_id='fc100000-0000-4000-8000-000000000001';

-- Machine-readable stdout, independent of NOTICE/stderr forwarding. The runner
-- extracts only this prefix and then observes successful ROLLBACK completion.
SELECT 'FIRST_CONTACT_RUNTIME:'||json_build_object('suite','first_contact','assertions',count(*))::text
FROM runtime_first_contact.assertions;
ROLLBACK;
