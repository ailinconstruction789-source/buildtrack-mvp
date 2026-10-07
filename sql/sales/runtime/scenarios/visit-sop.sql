-- SYNTHETIC LOCAL SOP TESTS ONLY. Entire scenario rolls back.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $isolation$
BEGIN
 IF current_database() !~ '^buildtrack_sales_runtime_' OR current_setting('buildtrack.synthetic_runtime',true) IS DISTINCT FROM 'on'
   OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet THEN RAISE EXCEPTION 'REFUSED: isolated synthetic SOP only'; END IF;
END;
$isolation$;
CREATE SCHEMA runtime_sop;
CREATE TABLE runtime_sop.assertions(label text PRIMARY KEY);
CREATE TABLE runtime_sop.context(key text PRIMARY KEY,value jsonb NOT NULL);
GRANT USAGE ON SCHEMA runtime_sop TO authenticated,anon;
GRANT SELECT,INSERT,UPDATE ON runtime_sop.context,runtime_sop.assertions TO authenticated,anon;
CREATE FUNCTION runtime_sop.assert_true(condition boolean,label text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $assert$
BEGIN
 IF condition IS DISTINCT FROM true THEN RAISE EXCEPTION 'ASSERTION FAILED: %',label; END IF;
 INSERT INTO runtime_sop.assertions VALUES(label);
END;
$assert$;
CREATE FUNCTION runtime_sop.expect_error(statement text,expected_message text,label text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $expect$
DECLARE actual_message text;
BEGIN
 BEGIN EXECUTE statement;
 EXCEPTION WHEN OTHERS THEN
   GET STACKED DIAGNOSTICS actual_message=MESSAGE_TEXT;
   IF expected_message IS NOT NULL AND actual_message<>expected_message THEN RAISE EXCEPTION 'ASSERTION FAILED: %; expected %, received %',label,expected_message,actual_message; END IF;
   INSERT INTO runtime_sop.assertions VALUES(label); RETURN;
 END;
 RAISE EXCEPTION 'ASSERTION FAILED: %; expected error',label;
END;
$expect$;
CREATE FUNCTION runtime_sop.answers(stage_value text,result_value text DEFAULT 'done')
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $answers$
 SELECT jsonb_agg(jsonb_build_object('key',item_key,'result',result_value,'reason',NULL) ORDER BY ordinal) FROM sales_private.crm_sop_template() WHERE stage=stage_value;
$answers$;
CREATE FUNCTION runtime_sop.snapshot(n integer DEFAULT 1,via_visit boolean DEFAULT false,event_page integer DEFAULT 0)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $snapshot$
 SELECT public.crm_v2_visit_sop_context(i.customer_id,i.id,CASE WHEN via_visit THEN NULL ELSE (a.value->>'appointmentId')::uuid END,
   CASE WHEN via_visit THEN (SELECT id FROM public.lead_visits WHERE appointment_id=(a.value->>'appointmentId')::uuid) ELSE NULL END,event_page)
 FROM public.lead_project_interests i JOIN runtime_sop.context a ON a.key='appointment-'||n
 WHERE i.id=('bc252000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
$snapshot$;
CREATE FUNCTION runtime_sop.payload(n integer,command_value text DEFAULT 'start',stage_value text DEFAULT 'stage_a',extra jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $payload$
 WITH clocks AS MATERIALIZED(SELECT to_char(clock_timestamp(),'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS event_time)
 SELECT jsonb_build_object('command',command_value,'customerId',i.customer_id,'interestId',i.id,'appointmentId',a.value->'appointmentId','visitId',NULL,
   'expectedInterestRevision',i.lifecycle_revision,'occurredAt',clocks.event_time,'reason','SYNTHETIC SOP reason')
   ||CASE WHEN command_value='start' THEN jsonb_build_object('plotId',' SYNTHETIC SOP HOUSE ')
     ELSE jsonb_build_object('runId',runtime_sop.snapshot(n)#>'{run,id}','expectedRunRevision',runtime_sop.snapshot(n)#>'{run,revision}') END
   ||CASE WHEN command_value IN ('save_stage','complete_stage') THEN jsonb_build_object('stage',stage_value,'answers',runtime_sop.answers(stage_value),
     'recap',CASE WHEN stage_value='stage_a' THEN NULL ELSE jsonb_build_object('feedback','SYNTHETIC customer feedback','objections','SYNTHETIC no objections',
       'departedAt',clocks.event_time) END) ELSE '{}'::jsonb END||extra
 FROM public.lead_project_interests i JOIN runtime_sop.context a ON a.key='appointment-'||n CROSS JOIN clocks
 WHERE i.id=('bc252000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
$payload$;
CREATE FUNCTION runtime_sop.visit_payload(n integer,command_value text DEFAULT 'check_in',extra jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $visit_payload$
 SELECT jsonb_build_object('command',command_value,'customerId',i.customer_id,'interestId',i.id,'expectedInterestRevision',i.lifecycle_revision,
   'reason','SYNTHETIC visit evidence','occurredAt',to_char(clock_timestamp(),'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
   ||CASE WHEN command_value='cancel_visit' THEN jsonb_build_object('visitId',v.id,'expectedVisitRevision',v.revision)
     ELSE jsonb_build_object('appointmentId',a.id,'expectedAppointmentRevision',a.revision) END||extra
 FROM public.lead_project_interests i JOIN runtime_sop.context x ON x.key='appointment-'||n
 JOIN public.lead_appointments a ON a.id=(x.value->>'appointmentId')::uuid LEFT JOIN public.lead_visits v ON v.appointment_id=a.id
 WHERE i.id=('bc252000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
$visit_payload$;
CREATE FUNCTION runtime_sop.business_snapshot()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $business$
 SELECT jsonb_build_object(
 'customers',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.sales_customers r),
 'interests',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.lead_project_interests r),
 'sales',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.sales r),
 'plots',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.plots r),
 'actions',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.crm_next_actions r),
 'sla',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.crm_sla_tasks r),
 'appointments',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.lead_appointments r),
 'visits',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.lead_visits r),
 'voices',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.customer_voices r),
 'settings',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.crm_settings r),
 'runs',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.house_visit_checklist_runs r),
 'items',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.house_visit_checklist_items r),
 'events',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM sales_private.visit_sop_events r),
 'audits',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.crm_audit_events r),
 'receipts',(SELECT jsonb_agg(to_jsonb(r) ORDER BY actor_user_id,request_id) FROM sales_private.visit_sop_command_requests r),
 'permits',(SELECT jsonb_agg(to_jsonb(r) ORDER BY transaction_id) FROM sales_private.visit_sop_write_permits r));
$business$;
REVOKE ALL ON FUNCTION runtime_sop.business_snapshot() FROM PUBLIC;
INSERT INTO auth.users(id) SELECT ('bc250000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid FROM generate_series(1,5) n;
INSERT INTO sales_private.crm_user_roles(user_id,role,display_name,is_active) VALUES
 ('bc250000-0000-4000-8000-000000000001','admin','SYNTHETIC SOP ADMIN',true),
 ('bc250000-0000-4000-8000-000000000002','sales','SYNTHETIC SOP SALES',true),
 ('bc250000-0000-4000-8000-000000000003','owner','SYNTHETIC SOP OWNER',true),
 ('bc250000-0000-4000-8000-000000000004','sales','SYNTHETIC SOP OTHER',true),
 ('bc250000-0000-4000-8000-000000000005','sales','SYNTHETIC SOP INACTIVE',false);
INSERT INTO public.projects(name,is_closed) VALUES('SYNTHETIC SOP A',false),('SYNTHETIC SOP B',false);
INSERT INTO public.plots(id,project_name,has_customer,sale_status) VALUES
 (' SYNTHETIC SOP HOUSE ','SYNTHETIC SOP A',true,'occupied'),('SYNTHETIC SOP WRONG HOUSE','SYNTHETIC SOP B',false,'available');
INSERT INTO public.sales_customers(id,customer_name,phone,intake_channel,owner_user_id,created_by_user_id,lead_created_at)
 SELECT ('bc251000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'SYNTHETIC SOP CUSTOMER '||n,'08925000'||lpad(n::text,2,'0'),'phone',
 'bc250000-0000-4000-8000-000000000002','bc250000-0000-4000-8000-000000000002',clock_timestamp()-interval '3 days' FROM generate_series(1,8) n;
INSERT INTO public.lead_project_interests(id,customer_id,project_name,owner_user_id,created_by_user_id)
 SELECT ('bc252000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('bc251000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 'SYNTHETIC SOP A','bc250000-0000-4000-8000-000000000002','bc250000-0000-4000-8000-000000000002' FROM generate_series(1,8) n;
INSERT INTO public.crm_settings(id,central_intake_enabled,lead_work_enabled,lead_lifecycle_enabled,visits_enabled,visit_sop_enabled)
 VALUES(true,true,true,true,true,false) ON CONFLICT(id) DO UPDATE SET central_intake_enabled=true,lead_work_enabled=true,lead_lifecycle_enabled=true,visits_enabled=true,visit_sop_enabled=false;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','bc250000-0000-4000-8000-000000000002',true);
DO $appointments$
DECLARE n integer; response jsonb;
BEGIN
 FOR n IN 1..8 LOOP
   SELECT public.crm_v2_visits_command(gen_random_uuid(),jsonb_build_object('command','schedule','customerId',customer_id,'interestId',id,
     'expectedInterestRevision',lifecycle_revision,'reason','SYNTHETIC appointment','occurredAt',to_char(clock_timestamp(),'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
     'startsAt',to_char(clock_timestamp()+interval '1 hour','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'endsAt',NULL)) INTO response
     FROM public.lead_project_interests WHERE id=('bc252000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
   INSERT INTO runtime_sop.context VALUES('appointment-'||n,response);
 END LOOP;
END;
$appointments$;
SELECT runtime_sop.assert_true(public.crm_v2_visit_sop_capabilities()='{"contract_version":"visit_sop_v1","enabled":false}'::jsonb,'SOP defaults disabled');
SELECT runtime_sop.expect_error('SELECT runtime_sop.snapshot()','CRM_SOP_SETUP_REQUIRED','disabled context fails closed');
SELECT runtime_sop.expect_error('SELECT public.crm_v2_record_visit_sop(gen_random_uuid(),runtime_sop.payload(1))','CRM_SOP_SETUP_REQUIRED','disabled command fails closed');
RESET ROLE;
UPDATE public.crm_settings SET visit_sop_enabled=true WHERE id;
INSERT INTO runtime_sop.context VALUES('before-start',runtime_sop.business_snapshot());
SET LOCAL ROLE authenticated;
SELECT runtime_sop.assert_true(runtime_sop.snapshot()->'run'='null'::jsonb AND runtime_sop.snapshot()#>>'{scope,canWrite}'='true','new anchor is writable without inventing run');
INSERT INTO runtime_sop.context VALUES('start-input',runtime_sop.payload(1));
INSERT INTO runtime_sop.context VALUES('start-result',public.crm_v2_record_visit_sop('bc253000-0000-4000-8000-000000000001',(SELECT value FROM runtime_sop.context WHERE key='start-input')));
SELECT runtime_sop.assert_true(jsonb_array_length(runtime_sop.snapshot()#>'{run,items}')=29 AND runtime_sop.snapshot()#>>'{run,plotId}'=' SYNTHETIC SOP HOUSE '
 AND runtime_sop.snapshot()#>>'{run,currentStage}'='stage_a','start seeds full fixed template and exact actual-house key even occupied');
SELECT runtime_sop.assert_true(public.crm_v2_record_visit_sop('bc253000-0000-4000-8000-000000000001',(SELECT value FROM runtime_sop.context WHERE key='start-input'))=
 (SELECT value||'{"replayed":true}'::jsonb FROM runtime_sop.context WHERE key='start-result'),'start retry returns same run and event');
SELECT runtime_sop.expect_error('SELECT public.crm_v2_record_visit_sop(gen_random_uuid(),runtime_sop.payload(1))','CRM_SOP_ALREADY_STARTED','new key cannot duplicate appointment run');
SELECT runtime_sop.expect_error('SELECT public.crm_v2_record_visit_sop(''bc253000-0000-4000-8000-000000000001'',(SELECT value||''{"reason":"changed"}''::jsonb FROM runtime_sop.context WHERE key=''start-input''))','CRM_SOP_IDEMPOTENCY_CONFLICT','changed same-key payload rejected');
SELECT runtime_sop.expect_error('SELECT public.crm_v2_record_visit_sop(gen_random_uuid(),runtime_sop.payload(2)||''{"ownerUserId":null}''::jsonb)','CRM_SOP_INVALID_INPUT','caller cannot supply SOP performer');
SELECT runtime_sop.expect_error('SELECT public.crm_v2_record_visit_sop(gen_random_uuid(),runtime_sop.payload(2)||''{"plotId":"SYNTHETIC SOP WRONG HOUSE"}''::jsonb)','CRM_SOP_NOT_FOUND','tour house must belong to project');
SELECT runtime_sop.expect_error('SELECT public.crm_v2_record_visit_sop(gen_random_uuid(),runtime_sop.payload(2)||''{"occurredAt":"9999-01-01T00:00:00Z"}''::jsonb)','CRM_SOP_INVALID_INPUT','future actual work timestamp rejected');
SELECT runtime_sop.expect_error('SELECT public.crm_v2_record_visit_sop(gen_random_uuid(),runtime_sop.payload(2)||''{"occurredAt":"2000-01-01T00:00:00Z"}''::jsonb)','CRM_SOP_INVALID_INPUT','work before Lead cohort rejected');
SELECT runtime_sop.expect_error('SELECT public.crm_v2_record_visit_sop(gen_random_uuid(),runtime_sop.payload(1,''complete_stage'',''stage_c''))','CRM_SOP_INCOMPLETE_STAGE','cannot jump straight to closing stage');
INSERT INTO runtime_sop.context VALUES('draft-input',runtime_sop.payload(1,'save_stage','stage_a',jsonb_build_object('answers',jsonb_set(runtime_sop.answers('stage_a','pending'),'{0,result}','"done"'))));
SELECT public.crm_v2_record_visit_sop(gen_random_uuid(),(SELECT value FROM runtime_sop.context WHERE key='draft-input'));
SELECT runtime_sop.assert_true(runtime_sop.snapshot()#>>'{run,items,0,result}'='done' AND runtime_sop.snapshot()#>>'{run,items,1,result}'='pending','draft save persists partial answers');
SELECT runtime_sop.expect_error('SELECT public.crm_v2_record_visit_sop(gen_random_uuid(),runtime_sop.payload(1,''complete_stage'',''stage_a'',jsonb_build_object(''answers'',runtime_sop.answers(''stage_a'',''pending''))))','CRM_SOP_INCOMPLETE_STAGE','completion requires all sixteen actual answers');
SELECT runtime_sop.expect_error('SELECT public.crm_v2_record_visit_sop(gen_random_uuid(),runtime_sop.payload(1,''save_stage'',''stage_a'',jsonb_build_object(''answers'',runtime_sop.answers(''stage_a'')-0)))','CRM_SOP_INVALID_INPUT','missing template answer rejected');
SELECT runtime_sop.expect_error('SELECT public.crm_v2_record_visit_sop(gen_random_uuid(),runtime_sop.payload(1,''save_stage'',''stage_a'',jsonb_build_object(''answers'',jsonb_set(runtime_sop.answers(''stage_a''),''{1,key}'',''"check_sample_house"''))))','CRM_SOP_INVALID_INPUT','duplicate answer key rejected');
SELECT runtime_sop.expect_error('SELECT public.crm_v2_record_visit_sop(gen_random_uuid(),runtime_sop.payload(1,''save_stage'',''stage_a'',jsonb_build_object(''answers'',jsonb_set(runtime_sop.answers(''stage_a''),''{0,result}'',''"skipped"''))))','CRM_SOP_INVALID_INPUT','skip cannot omit its reason');
SELECT runtime_sop.expect_error('SELECT public.crm_v2_record_visit_sop(gen_random_uuid(),(SELECT value FROM runtime_sop.context WHERE key=''draft-input''))','CRM_SOP_STALE_STATE','old tab revision cannot overwrite current draft');
SELECT public.crm_v2_record_visit_sop(gen_random_uuid(),runtime_sop.payload(1,'complete_stage','stage_a',jsonb_build_object('answers',jsonb_set(jsonb_set(runtime_sop.answers('stage_a'),'{1,result}','"not_applicable"'),'{1,reason}','"SYNTHETIC daylight"'))));
SELECT runtime_sop.assert_true(runtime_sop.snapshot()#>>'{run,currentStage}'='stage_b' AND runtime_sop.snapshot()#>'{run,stageACompletedAt}'<>'null'::jsonb,'completed A advances to reception and retains NA reason');
SELECT runtime_sop.expect_error('SELECT public.crm_v2_record_visit_sop(gen_random_uuid(),runtime_sop.payload(1,''save_stage'',''stage_a''))','CRM_SOP_INCOMPLETE_STAGE','completed A answers cannot be rewritten');
SELECT runtime_sop.expect_error('SELECT public.crm_v2_record_visit_sop(gen_random_uuid(),runtime_sop.payload(1,''start_tour''))','CRM_SOP_VISIT_REQUIRED','starting tour requires actual check-in');
RESET ROLE;
SELECT runtime_sop.assert_true((runtime_sop.business_snapshot()-ARRAY['runs','items','events','audits','receipts'])=(SELECT value-ARRAY['runs','items','events','audits','receipts'] FROM runtime_sop.context WHERE key='before-start'),'preparation changes no customer interest stock booking Visit task or SLA');
SET LOCAL ROLE authenticated;
INSERT INTO runtime_sop.context VALUES('visit-1',public.crm_v2_visits_command(gen_random_uuid(),runtime_sop.visit_payload(1)));
SELECT runtime_sop.assert_true(runtime_sop.snapshot(1,true)#>>'{run,id}'=runtime_sop.snapshot(1)#>>'{run,id}','appointment and actual Visit resolve the same preparation run');
SELECT runtime_sop.expect_error('SELECT public.crm_v2_record_visit_sop(gen_random_uuid(),runtime_sop.payload(1)||jsonb_build_object(''appointmentId'',NULL,''visitId'',(SELECT value->''visitId'' FROM runtime_sop.context WHERE key=''visit-1'')))','CRM_SOP_ALREADY_STARTED','Visit anchor cannot duplicate appointment preparation');
SELECT public.crm_v2_record_visit_sop(gen_random_uuid(),runtime_sop.payload(1,'start_tour'));
SELECT runtime_sop.assert_true(runtime_sop.snapshot()#>>'{run,currentStage}'='stage_c' AND runtime_sop.snapshot()#>>'{anchor,visitStatus}'='awaiting_voice','tour starts on actual check-in without claiming Voice completion');
SELECT runtime_sop.expect_error('SELECT public.crm_v2_record_visit_sop(gen_random_uuid(),runtime_sop.payload(1,''complete_stage'',''stage_c''))','CRM_SOP_NEXT_ACTION_REQUIRED','closing SOP needs existing interest-specific next action');
SELECT public.crm_v2_record_lead_work(gen_random_uuid(),jsonb_build_object('command','set_next_action','customerId','bc251000-0000-4000-8000-000000000001','interestId',NULL,
 'expectedActionId',NULL,'nextAction',jsonb_build_object('action','SYNTHETIC central only','dueAt',to_char(clock_timestamp()+interval '1 day','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')),'reason','SYNTHETIC central plan'));
SELECT runtime_sop.expect_error('SELECT public.crm_v2_record_visit_sop(gen_random_uuid(),runtime_sop.payload(1,''complete_stage'',''stage_c''))','CRM_SOP_NEXT_ACTION_REQUIRED','central plan cannot stand in for project-interest plan');
SELECT runtime_sop.expect_error('SELECT public.crm_v2_record_visit_sop(gen_random_uuid(),runtime_sop.payload(1,''complete_stage'',''stage_c'',jsonb_build_object(''recap'',jsonb_build_object(''feedback'','''',''objections'',''none'',''departedAt'',to_char(clock_timestamp(),''YYYY-MM-DD"T"HH24:MI:SS.US"Z"'')))))','CRM_SOP_INCOMPLETE_STAGE','closing requires nonblank customer recap');
SELECT runtime_sop.expect_error('SELECT public.crm_v2_record_visit_sop(gen_random_uuid(),runtime_sop.payload(1,''save_stage'',''stage_c'',jsonb_build_object(''recap'',jsonb_build_object(''feedback'','''',''objections'','''',''departedAt'',''2000-01-01T00:00:00Z''))))','CRM_SOP_INVALID_INPUT','departure cannot precede check-in or tour');
INSERT INTO runtime_sop.context VALUES('action-1',public.crm_v2_record_lead_work(gen_random_uuid(),jsonb_build_object('command','set_next_action','customerId','bc251000-0000-4000-8000-000000000001',
 'interestId','bc252000-0000-4000-8000-000000000001','expectedActionId',NULL,'nextAction',jsonb_build_object('action','SYNTHETIC project follow-up','dueAt',to_char(clock_timestamp()+interval '1 day','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')),'reason','SYNTHETIC project plan')));
RESET ROLE;
INSERT INTO runtime_sop.context SELECT 'action-before-checks',to_jsonb(a) FROM public.crm_next_actions a WHERE id=(SELECT (value->>'nextActionId')::uuid FROM runtime_sop.context WHERE key='action-1');
UPDATE public.crm_next_actions SET owner_user_id='bc250000-0000-4000-8000-000000000004' WHERE id=(SELECT (value->>'nextActionId')::uuid FROM runtime_sop.context WHERE key='action-1');
SET LOCAL ROLE authenticated;
SELECT runtime_sop.expect_error('SELECT public.crm_v2_record_visit_sop(gen_random_uuid(),runtime_sop.payload(1,''complete_stage'',''stage_c''))','CRM_SOP_NEXT_ACTION_REQUIRED','stale other-owner action cannot certify SOP followup');
RESET ROLE;
UPDATE public.crm_next_actions SET owner_user_id='bc250000-0000-4000-8000-000000000002',plan_started_at=clock_timestamp()-interval '2 hours',due_at=clock_timestamp()-interval '1 hour'
 WHERE id=(SELECT (value->>'nextActionId')::uuid FROM runtime_sop.context WHERE key='action-1');
SET LOCAL ROLE authenticated;
SELECT runtime_sop.expect_error('SELECT public.crm_v2_record_visit_sop(gen_random_uuid(),runtime_sop.payload(1,''complete_stage'',''stage_c''))','CRM_SOP_NEXT_ACTION_REQUIRED','overdue action cannot stand in for future followup');
RESET ROLE;
UPDATE public.crm_next_actions SET plan_started_at=(SELECT (value->>'plan_started_at')::timestamptz FROM runtime_sop.context WHERE key='action-before-checks'),
 due_at=(SELECT (value->>'due_at')::timestamptz FROM runtime_sop.context WHERE key='action-before-checks')
 WHERE id=(SELECT (value->>'nextActionId')::uuid FROM runtime_sop.context WHERE key='action-1');
INSERT INTO runtime_sop.context VALUES('before-complete',runtime_sop.business_snapshot());
SET LOCAL ROLE authenticated;
INSERT INTO runtime_sop.context VALUES('input',runtime_sop.payload(1,'complete_stage','stage_c'));
INSERT INTO runtime_sop.context VALUES('result',public.crm_v2_record_visit_sop('bc253000-0000-4000-8000-000000000002',(SELECT value FROM runtime_sop.context WHERE key='input')));
INSERT INTO runtime_sop.context VALUES('snapshot',runtime_sop.snapshot());
SELECT runtime_sop.assert_true(runtime_sop.snapshot()#>>'{run,currentStage}'='completed' AND runtime_sop.snapshot()#>>'{run,nextAction}'='SYNTHETIC project follow-up'
 AND runtime_sop.snapshot()#>>'{scope,canWrite}'='false' AND runtime_sop.snapshot()#>>'{anchor,visitStatus}'='awaiting_voice','SOP completes independently and snapshots existing future action');
SELECT runtime_sop.assert_true(public.crm_v2_record_visit_sop('bc253000-0000-4000-8000-000000000002',(SELECT value FROM runtime_sop.context WHERE key='input'))=(SELECT value||'{"replayed":true}'::jsonb FROM runtime_sop.context WHERE key='result'),'completed SOP receipt still recovers exact successful result');
SELECT runtime_sop.expect_error('SELECT public.crm_v2_record_visit_sop(gen_random_uuid(),runtime_sop.payload(1,''save_stage'',''stage_c''))','CRM_SOP_SCOPE_CLOSED','completed SOP cannot reopen or overwrite evidence');
RESET ROLE;
SELECT runtime_sop.assert_true((runtime_sop.business_snapshot()-ARRAY['runs','items','events','audits','receipts'])=(SELECT value-ARRAY['runs','items','events','audits','receipts'] FROM runtime_sop.context WHERE key='before-complete'),'completion does not duplicate task or change Visit Voice SLA customer or stock');
SELECT runtime_sop.assert_true((SELECT next_action_id=(SELECT (value->>'nextActionId')::uuid FROM runtime_sop.context WHERE key='action-1') FROM public.house_visit_checklist_runs WHERE id=(SELECT (value->>'runId')::uuid FROM runtime_sop.context WHERE key='result')),'snapshot retains exact existing action identity');
SELECT runtime_sop.expect_error('UPDATE public.house_visit_checklist_runs SET revision=gen_random_uuid() WHERE id=(SELECT (value->>''runId'')::uuid FROM runtime_sop.context WHERE key=''result'')','CRM_SOP_FORBIDDEN','direct privileged writer still requires private permit');
SELECT runtime_sop.expect_error('UPDATE sales_private.visit_sop_events SET reason=''overwrite''','CRM_SOP_SCOPE_CLOSED','private SOP events immutable');
SELECT runtime_sop.expect_error('DELETE FROM sales_private.visit_sop_command_requests','CRM_SOP_SCOPE_CLOSED','private SOP receipts immutable');
CREATE FUNCTION runtime_sop.fail_receipt() RETURNS trigger LANGUAGE plpgsql AS $fail$
BEGIN RAISE EXCEPTION 'SYNTHETIC_INJECTED_FAILURE'; END;
$fail$;
CREATE TRIGGER zz_runtime_sop_fail BEFORE INSERT ON sales_private.visit_sop_command_requests FOR EACH ROW EXECUTE FUNCTION runtime_sop.fail_receipt();
INSERT INTO runtime_sop.context VALUES('before-failure',runtime_sop.business_snapshot());
SET LOCAL ROLE authenticated;
SELECT runtime_sop.expect_error('SELECT public.crm_v2_record_visit_sop(gen_random_uuid(),runtime_sop.payload(2))','SYNTHETIC_INJECTED_FAILURE','receipt failure aborts entire SOP command');
RESET ROLE;
SELECT runtime_sop.assert_true(runtime_sop.business_snapshot()=(SELECT value FROM runtime_sop.context WHERE key='before-failure'),'failed start leaves no run items audit events receipts or permits');
DROP TRIGGER zz_runtime_sop_fail ON sales_private.visit_sop_command_requests;
SET LOCAL ROLE authenticated;
INSERT INTO runtime_sop.context VALUES('owner-input',runtime_sop.payload(2));
SELECT public.crm_v2_record_visit_sop('bc253000-0000-4000-8000-000000000003',(SELECT value FROM runtime_sop.context WHERE key='owner-input'));
SELECT public.crm_v2_record_visit_sop(gen_random_uuid(),runtime_sop.payload(2,'save_stage','stage_a',jsonb_build_object('answers',jsonb_set(runtime_sop.answers('stage_a','pending'),'{0,result}','"done"'))));
SELECT set_config('request.jwt.claim.sub','bc250000-0000-4000-8000-000000000001',true);
SELECT runtime_sop.assert_true(runtime_sop.snapshot(2)#>>'{scope,canWrite}'='false','Admin sees SOP read-only');
SELECT runtime_sop.expect_error('SELECT public.crm_v2_record_visit_sop(gen_random_uuid(),runtime_sop.payload(2,''save_stage''))','CRM_SOP_FORBIDDEN','Admin cannot perform Sales SOP by impersonation');
SELECT public.crm_v2_change_lead_lifecycle(gen_random_uuid(),jsonb_build_object('command','reassign_owner','customerId','bc251000-0000-4000-8000-000000000002',
 'interestId','bc252000-0000-4000-8000-000000000002','expectedRevision',runtime_sop.snapshot(2)#>'{scope,interestRevision}','expectedActionId',NULL,
 'newOwnerUserId','bc250000-0000-4000-8000-000000000004','reason','SYNTHETIC SOP owner change'));
SELECT set_config('request.jwt.claim.sub','bc250000-0000-4000-8000-000000000002',true);
SELECT runtime_sop.expect_error('SELECT public.crm_v2_record_visit_sop(''bc253000-0000-4000-8000-000000000003'',(SELECT value FROM runtime_sop.context WHERE key=''owner-input''))','CRM_SOP_FORBIDDEN','former Sales cannot replay old SOP receipt');
SELECT set_config('request.jwt.claim.sub','bc250000-0000-4000-8000-000000000004',true);
SELECT public.crm_v2_record_visit_sop(gen_random_uuid(),runtime_sop.payload(2,'save_stage'));
SELECT runtime_sop.assert_true(runtime_sop.snapshot(2)#>>'{run,responsibleSalesUserId}'='bc250000-0000-4000-8000-000000000004'
 AND runtime_sop.snapshot(2)#>>'{run,items,0,answeredByUserId}'='bc250000-0000-4000-8000-000000000002'
 AND runtime_sop.snapshot(2)#>>'{run,items,1,answeredByUserId}'='bc250000-0000-4000-8000-000000000004','new owner takes responsibility without stealing unchanged old answers');
RESET ROLE;
SELECT runtime_sop.assert_true(EXISTS(SELECT 1 FROM sales_private.visit_sop_events WHERE details->>'previousResponsibleSalesUserId'='bc250000-0000-4000-8000-000000000002'
 AND details->>'responsibleSalesUserId'='bc250000-0000-4000-8000-000000000004'),'owner transition appended to audit evidence');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','bc250000-0000-4000-8000-000000000003',true);
SELECT runtime_sop.assert_true(runtime_sop.snapshot(2)#>>'{scope,canWrite}'='false','Owner reads SOP without write rights');
SELECT runtime_sop.expect_error('SELECT public.crm_v2_record_visit_sop(gen_random_uuid(),runtime_sop.payload(3))','CRM_SOP_FORBIDDEN','Owner cannot perform SOP');
SELECT set_config('request.jwt.claim.sub','bc250000-0000-4000-8000-000000000002',true);
SELECT public.crm_v2_visits_command(gen_random_uuid(),runtime_sop.visit_payload(3,'cancel_appointment'));
SELECT runtime_sop.expect_error('SELECT public.crm_v2_record_visit_sop(gen_random_uuid(),runtime_sop.payload(3))','CRM_SOP_SCOPE_CLOSED','cancelled appointment cannot receive SOP');
SELECT public.crm_v2_visits_command(gen_random_uuid(),runtime_sop.visit_payload(5));
SELECT public.crm_v2_visits_command(gen_random_uuid(),runtime_sop.visit_payload(5,'cancel_visit'));
SELECT runtime_sop.expect_error('SELECT public.crm_v2_record_visit_sop(gen_random_uuid(),runtime_sop.payload(5))','CRM_SOP_SCOPE_CLOSED','cancelled actual Visit cannot receive SOP');
SELECT public.crm_v2_change_lead_lifecycle(gen_random_uuid(),jsonb_build_object('command','close_lost','customerId','bc251000-0000-4000-8000-000000000004',
 'interestId','bc252000-0000-4000-8000-000000000004','expectedRevision',runtime_sop.snapshot(4)#>'{scope,interestRevision}','expectedActionId',NULL,'reason','SYNTHETIC lost'));
SELECT runtime_sop.expect_error('SELECT public.crm_v2_record_visit_sop(gen_random_uuid(),runtime_sop.payload(4))','CRM_SOP_SCOPE_CLOSED','lost interest cannot receive SOP');
SELECT public.crm_v2_record_visit_sop(gen_random_uuid(),runtime_sop.payload(6));
DO $pages$
DECLARE n integer;
BEGIN FOR n IN 1..50 LOOP
 PERFORM public.crm_v2_record_visit_sop(gen_random_uuid(),runtime_sop.payload(6,'save_stage','stage_a',jsonb_build_object('answers',runtime_sop.answers('stage_a','pending'))));
END LOOP; END;
$pages$;
SELECT runtime_sop.assert_true(jsonb_array_length(runtime_sop.snapshot(6)->'events')=50 AND runtime_sop.snapshot(6)->>'eventsHasMore'='true'
 AND jsonb_array_length(runtime_sop.snapshot(6,false,1)->'events')=1,'SOP event history has deterministic fifty-row pages');
RESET ROLE;
INSERT INTO public.plots(id,project_name,has_customer,sale_status) SELECT 'SYNTHETIC SOP PAGE '||lpad(n::text,3,'0'),'SYNTHETIC SOP A',true,'occupied' FROM generate_series(1,201) n;
SET LOCAL ROLE authenticated;
SELECT runtime_sop.assert_true(jsonb_array_length(runtime_sop.snapshot(6)->'plots')=200 AND runtime_sop.snapshot(6)->>'plotsHasMore'='true','actual-house chooser bounds all plots without pretending occupied houses are vacant');
RESET ROLE;
UPDATE public.crm_settings SET visit_sop_enabled=false WHERE id;
SET LOCAL ROLE authenticated;
SELECT runtime_sop.expect_error('SELECT public.crm_v2_record_visit_sop(''bc253000-0000-4000-8000-000000000001'',(SELECT value FROM runtime_sop.context WHERE key=''start-input''))','CRM_SOP_SETUP_REQUIRED','kill switch checked before cached receipt');
RESET ROLE;
UPDATE public.crm_settings SET visit_sop_enabled=true WHERE id;
SELECT runtime_sop.assert_true(NOT EXISTS(SELECT 1 FROM sales_private.visit_sop_write_permits),'no SOP permit left behind');
INSERT INTO runtime_sop.context VALUES('before-read',runtime_sop.business_snapshot());
SET LOCAL ROLE authenticated;
SELECT runtime_sop.snapshot();
RESET ROLE;
SELECT runtime_sop.assert_true(runtime_sop.business_snapshot()=(SELECT value FROM runtime_sop.context WHERE key='before-read'),'SOP context performs no business mutation');
SET TRANSACTION READ ONLY;
SET LOCAL ROLE authenticated;
DO $readonly$
BEGIN IF current_setting('transaction_read_only')<>'on' OR runtime_sop.snapshot()#>>'{run,currentStage}'<>'completed' THEN RAISE EXCEPTION 'READ_ONLY_SOP_FAILED'; END IF; END;
$readonly$;
SELECT 'SOP_SNAPSHOT:'||value::text FROM runtime_sop.context WHERE key='snapshot';
SELECT 'SOP_RESULT:'||value::text FROM runtime_sop.context WHERE key='result';
SELECT 'SOP_INPUT:'||(value||'{"requestId":"bc253000-0000-4000-8000-000000000002"}'::jsonb)::text FROM runtime_sop.context WHERE key='input';
SELECT 'SOP_RUNTIME:'||jsonb_build_object('suite','visit-sop','assertions',(SELECT count(*)+1 FROM runtime_sop.assertions),'readOnlyTransaction',true,
 'syntheticOnly',true,'realDatabaseTested',false,'productionCertified',false)::text;
ROLLBACK;
