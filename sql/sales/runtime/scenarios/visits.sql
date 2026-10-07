-- SYNTHETIC LOCAL VISITS TESTS ONLY. Entire scenario rolls back.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $isolation$
BEGIN
  IF current_database() !~ '^buildtrack_sales_runtime_' OR current_setting('buildtrack.synthetic_runtime',true) IS DISTINCT FROM 'on'
    OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet THEN RAISE EXCEPTION 'REFUSED: isolated synthetic visits only'; END IF;
END;
$isolation$;
CREATE SCHEMA runtime_visits;
CREATE TABLE runtime_visits.assertions(label text PRIMARY KEY);
CREATE TABLE runtime_visits.context(key text PRIMARY KEY,value jsonb NOT NULL);
GRANT USAGE ON SCHEMA runtime_visits TO authenticated,anon;
GRANT SELECT,INSERT,UPDATE ON runtime_visits.assertions,runtime_visits.context TO authenticated,anon;
CREATE FUNCTION runtime_visits.assert_true(condition boolean,label text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $assert$
BEGIN
  IF condition IS DISTINCT FROM true THEN RAISE EXCEPTION 'ASSERTION FAILED: %',label; END IF;
  INSERT INTO runtime_visits.assertions VALUES(label);
END;
$assert$;
CREATE FUNCTION runtime_visits.expect_error(statement text,expected_message text,label text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $expect$
DECLARE actual_message text;
BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS actual_message=MESSAGE_TEXT;
    IF expected_message IS NOT NULL AND actual_message<>expected_message THEN
      RAISE EXCEPTION 'ASSERTION FAILED: %; expected %, received %',label,expected_message,actual_message; END IF;
    INSERT INTO runtime_visits.assertions VALUES(label); RETURN;
  END;
  RAISE EXCEPTION 'ASSERTION FAILED: %; expected error',label;
END;
$expect$;
CREATE FUNCTION runtime_visits.payload(n integer,command_value text DEFAULT 'schedule',extra jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $payload$
  SELECT jsonb_build_object('command',command_value,'customerId',i.customer_id,'interestId',i.id,'expectedInterestRevision',i.lifecycle_revision,
    'reason','SYNTHETIC visit reason','occurredAt',to_char(clock_timestamp(),'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
    ||CASE WHEN command_value='schedule' THEN jsonb_build_object('startsAt',to_char(clock_timestamp()+interval '1 day','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'endsAt',NULL) ELSE '{}'::jsonb END||extra
  FROM public.lead_project_interests i WHERE i.id=('bc232000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
$payload$;
CREATE FUNCTION runtime_visits.snapshot(n integer DEFAULT 1,ap integer DEFAULT 0,vp integer DEFAULT 0,ep integer DEFAULT 0)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $snapshot$
  SELECT public.crm_v2_visits_context(('bc231000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
    ('bc232000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,ap,vp,ep);
$snapshot$;
CREATE FUNCTION runtime_visits.business_snapshot()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $business$
  SELECT jsonb_build_object(
    'customers',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.sales_customers r),
    'interests',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.lead_project_interests r),
    'sales',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.sales r),
    'plots',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.plots r),
    'voices',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.customer_voices r),
    'actions',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.crm_next_actions r),
    'sla',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.crm_sla_tasks r),
    'appointments',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.lead_appointments r),
    'visits',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.lead_visits r),
    'settings',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.crm_settings r),
    'audits',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.crm_audit_events r),
    'events',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM sales_private.visits_events r),
    'receipts',(SELECT jsonb_agg(to_jsonb(r) ORDER BY actor_user_id,request_id) FROM sales_private.visits_command_requests r),
    'permits',(SELECT jsonb_agg(to_jsonb(r) ORDER BY transaction_id) FROM sales_private.visits_write_permits r));
$business$;
REVOKE ALL ON FUNCTION runtime_visits.business_snapshot() FROM PUBLIC;
INSERT INTO auth.users(id) SELECT ('bc230000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid FROM generate_series(1,5) n;
INSERT INTO sales_private.crm_user_roles(user_id,role,display_name,is_active) VALUES
 ('bc230000-0000-4000-8000-000000000001','admin','SYNTHETIC VISITS ADMIN',true),
 ('bc230000-0000-4000-8000-000000000002','sales','SYNTHETIC VISITS SALES',true),
 ('bc230000-0000-4000-8000-000000000003','owner','SYNTHETIC VISITS OWNER',true),
 ('bc230000-0000-4000-8000-000000000004','sales','SYNTHETIC VISITS OTHER SALES',true),
 ('bc230000-0000-4000-8000-000000000005','sales','SYNTHETIC VISITS INACTIVE',false);
INSERT INTO public.projects(name,is_closed) VALUES('SYNTHETIC VISITS A',false),('SYNTHETIC VISITS B',false);
INSERT INTO public.plots(id,project_name,has_customer,sale_status) VALUES('SYNTHETIC-VISITS-PLOT','SYNTHETIC VISITS A',false,'available');
INSERT INTO public.crm_settings(id,central_intake_enabled,lead_work_enabled,lead_lifecycle_enabled,visits_enabled)
 VALUES(true,true,true,true,false) ON CONFLICT(id) DO UPDATE SET central_intake_enabled=true,lead_work_enabled=true,lead_lifecycle_enabled=true,visits_enabled=false;
INSERT INTO public.sales_customers(id,customer_name,phone,intake_channel,owner_user_id,created_by_user_id,lead_created_at)
 SELECT ('bc231000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'SYNTHETIC VISIT CUSTOMER '||n,'08923000'||lpad(n::text,2,'0'),'phone',
 'bc230000-0000-4000-8000-000000000002','bc230000-0000-4000-8000-000000000002',clock_timestamp()-interval '3 days' FROM generate_series(1,8) n;
INSERT INTO public.lead_project_interests(id,customer_id,project_name,owner_user_id,created_by_user_id)
 SELECT ('bc232000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('bc231000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 CASE WHEN n=8 THEN 'SYNTHETIC VISITS B' ELSE 'SYNTHETIC VISITS A' END,'bc230000-0000-4000-8000-000000000002',
 'bc230000-0000-4000-8000-000000000002' FROM generate_series(1,8) n;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','bc230000-0000-4000-8000-000000000002',true);
SELECT runtime_visits.assert_true(public.crm_v2_visits_capabilities()='{"contract_version":"visits_v1","enabled":false}'::jsonb,'default gate off');
SELECT runtime_visits.expect_error('SELECT runtime_visits.snapshot()','CRM_VISITS_SETUP_REQUIRED','disabled read fails closed');
SELECT runtime_visits.expect_error('SELECT public.crm_v2_visits_command(gen_random_uuid(),''{}'')','CRM_VISITS_SETUP_REQUIRED','disabled command fails before validation');
RESET ROLE;
UPDATE public.crm_settings SET visits_enabled=true WHERE id;
INSERT INTO runtime_visits.context VALUES('unchanged',runtime_visits.business_snapshot());
SET LOCAL ROLE authenticated;
SELECT runtime_visits.assert_true(public.crm_v2_visits_capabilities()='{"contract_version":"visits_v1","enabled":true}'::jsonb,'exact enabled capability');
INSERT INTO runtime_visits.context VALUES('input',runtime_visits.payload(1));
INSERT INTO runtime_visits.context VALUES('result',public.crm_v2_visits_command('bc233000-0000-4000-8000-000000000001',(SELECT value FROM runtime_visits.context WHERE key='input')));
INSERT INTO runtime_visits.context VALUES('snapshot',runtime_visits.snapshot());
SELECT runtime_visits.assert_true((SELECT value#>>'{appointments,0,status}'='scheduled' AND value#>>'{appointments,0,assignedSalesUserId}'='bc230000-0000-4000-8000-000000000002'
 AND value#>>'{scope,canEdit}'='true' AND jsonb_array_length(value->'visits')=0 AND jsonb_array_length(value->'events')=1 FROM runtime_visits.context WHERE key='snapshot'),'schedule creates one owned appointment not fake Visit');
SELECT runtime_visits.assert_true(public.crm_v2_visits_command('bc233000-0000-4000-8000-000000000001',(SELECT value FROM runtime_visits.context WHERE key='input'))=(SELECT value||'{"replayed":true}'::jsonb FROM runtime_visits.context WHERE key='result'),'identical schedule replay same row revisions event');
SELECT runtime_visits.expect_error('SELECT public.crm_v2_visits_command(''bc233000-0000-4000-8000-000000000001'',(SELECT value FROM runtime_visits.context WHERE key=''input'')||''{"reason":"changed"}'')','CRM_VISITS_IDEMPOTENCY_CONFLICT','request reuse cannot change payload');
DO $invalid$
DECLARE extra jsonb;
BEGIN
  FOR extra IN SELECT value FROM jsonb_array_elements('[{"command":"complete"},{"reason":" "},{"occurredAt":"2024-02-30T00:00:00Z"},{"occurredAt":"infinity"},{"occurredAt":"2026-01-01"},{"occurredAt":"0000-01-01T00:00:00Z"},{"customerId":null},{"interestId":null},{"expectedInterestRevision":null},{"completedVoiceId":"bc233000-0000-4000-8000-000000000099"},{"assignedSalesUserId":"bc230000-0000-4000-8000-000000000004"}]'::jsonb) LOOP
    PERFORM runtime_visits.expect_error(format('SELECT public.crm_v2_visits_command(gen_random_uuid(),%L::jsonb)',runtime_visits.payload(1)||extra),'CRM_VISITS_INVALID_INPUT','invalid shape '||extra::text);
  END LOOP;
END;
$invalid$;
SELECT runtime_visits.expect_error('SELECT public.crm_v2_visits_command(gen_random_uuid(),runtime_visits.payload(1)||jsonb_build_object(''occurredAt'',to_char(clock_timestamp()+interval ''1 day'',''YYYY-MM-DD"T"HH24:MI:SS.US"Z"'')))','CRM_VISITS_INVALID_INPUT','future event refused');
SELECT runtime_visits.expect_error('SELECT public.crm_v2_visits_command(gen_random_uuid(),runtime_visits.payload(1)||''{"occurredAt":"2000-01-01T00:00:00Z"}'')','CRM_VISITS_INVALID_INPUT','event before Lead refused');
SELECT runtime_visits.expect_error('SELECT public.crm_v2_visits_command(gen_random_uuid(),runtime_visits.payload(1)||jsonb_build_object(''startsAt'',to_char(clock_timestamp()-interval ''1 minute'',''YYYY-MM-DD"T"HH24:MI:SS.US"Z"'')))','CRM_VISITS_INVALID_INPUT','new schedule cannot be in past');
SELECT runtime_visits.expect_error('SELECT public.crm_v2_visits_command(gen_random_uuid(),runtime_visits.payload(1)||''{"endsAt":"2000-01-01T00:00:00Z"}'')','CRM_VISITS_INVALID_INPUT','end must follow start');
SELECT runtime_visits.expect_error('SELECT public.crm_v2_visits_command(gen_random_uuid(),runtime_visits.payload(1)||jsonb_build_object(''expectedInterestRevision'',gen_random_uuid()))','CRM_VISITS_STALE_STATE','stale interest revision refused');
SELECT runtime_visits.expect_error('SELECT public.crm_v2_visits_command(gen_random_uuid(),runtime_visits.payload(1,''check_in'',jsonb_build_object(''appointmentId'',NULL,''expectedAppointmentRevision'',gen_random_uuid())))','CRM_VISITS_INVALID_INPUT','walk-in must have two null appointment references');
INSERT INTO runtime_visits.context VALUES('rescheduled',public.crm_v2_visits_command(gen_random_uuid(),runtime_visits.payload(1,'reschedule',
 (SELECT jsonb_build_object('appointmentId',value->'appointmentId','expectedAppointmentRevision',value->'appointmentRevision','startsAt',to_char(clock_timestamp()+interval '2 days','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'endsAt',NULL) FROM runtime_visits.context WHERE key='result'))));
SELECT runtime_visits.assert_true(runtime_visits.snapshot()#>>'{appointments,0,status}'='rescheduled','reschedule keeps same active appointment');
SELECT runtime_visits.expect_error('SELECT public.crm_v2_visits_command(gen_random_uuid(),runtime_visits.payload(1,''cancel_appointment'',(SELECT jsonb_build_object(''appointmentId'',value->''appointmentId'',''expectedAppointmentRevision'',value->''appointmentRevision'') FROM runtime_visits.context WHERE key=''result'')))','CRM_VISITS_STALE_STATE','old appointment revision cannot cancel rescheduled appointment');
SELECT runtime_visits.expect_error('SELECT public.crm_v2_visits_command(gen_random_uuid(),runtime_visits.payload(2,''check_in'',(SELECT jsonb_build_object(''appointmentId'',value->''appointmentId'',''expectedAppointmentRevision'',value->''appointmentRevision'') FROM runtime_visits.context WHERE key=''rescheduled'')))','CRM_VISITS_NOT_FOUND','cross customer appointment refused');
SELECT runtime_visits.expect_error('SELECT public.crm_v2_visits_command(gen_random_uuid(),runtime_visits.payload(1,''no_show'',(SELECT jsonb_build_object(''appointmentId'',value->''appointmentId'',''expectedAppointmentRevision'',value->''appointmentRevision'') FROM runtime_visits.context WHERE key=''rescheduled'')))','CRM_VISITS_INVALID_INPUT','no show cannot predate appointment start');
INSERT INTO runtime_visits.context VALUES('check-input',runtime_visits.payload(1,'check_in',(SELECT jsonb_build_object('appointmentId',value->'appointmentId','expectedAppointmentRevision',value->'appointmentRevision') FROM runtime_visits.context WHERE key='rescheduled')));
INSERT INTO runtime_visits.context VALUES('checked',public.crm_v2_visits_command('bc233000-0000-4000-8000-000000000002',(SELECT value FROM runtime_visits.context WHERE key='check-input')));
SELECT runtime_visits.assert_true(runtime_visits.snapshot()#>>'{appointments,0,status}'='attended' AND runtime_visits.snapshot()#>>'{visits,0,status}'='awaiting_voice'
 AND runtime_visits.snapshot()#>'{visits,0,completedVoiceId}'='null'::jsonb,'check-in attended but never completed before Customer Voices');
SELECT runtime_visits.assert_true(public.crm_v2_visits_command('bc233000-0000-4000-8000-000000000002',(SELECT value FROM runtime_visits.context WHERE key='check-input'))->>'replayed'='true','check-in replay no second Visit');
SELECT runtime_visits.expect_error('SELECT public.crm_v2_visits_command(gen_random_uuid(),runtime_visits.payload(1,''check_in'',(SELECT jsonb_build_object(''appointmentId'',value->''appointmentId'',''expectedAppointmentRevision'',value->''appointmentRevision'') FROM runtime_visits.context WHERE key=''checked'')))','CRM_VISITS_CONFLICT','attended appointment cannot check in twice');
SELECT runtime_visits.expect_error('SELECT public.crm_v2_visits_command(gen_random_uuid(),runtime_visits.payload(1,''cancel_visit'',(SELECT jsonb_build_object(''visitId'',value->''visitId'',''expectedVisitRevision'',gen_random_uuid()) FROM runtime_visits.context WHERE key=''checked'')))','CRM_VISITS_STALE_STATE','stale visit revision refused');
INSERT INTO runtime_visits.context VALUES('cancelled-visit',public.crm_v2_visits_command(gen_random_uuid(),runtime_visits.payload(1,'cancel_visit',
 (SELECT jsonb_build_object('visitId',value->'visitId','expectedVisitRevision',value->'visitRevision') FROM runtime_visits.context WHERE key='checked'))));
SELECT runtime_visits.assert_true(runtime_visits.snapshot()#>>'{appointments,0,status}'='attended' AND runtime_visits.snapshot()#>>'{visits,0,status}'='cancelled','cancel awaiting voice retains attended appointment history');
SELECT runtime_visits.expect_error('SELECT public.crm_v2_visits_command(gen_random_uuid(),runtime_visits.payload(1,''cancel_visit'',(SELECT jsonb_build_object(''visitId'',value->''visitId'',''expectedVisitRevision'',value->''visitRevision'') FROM runtime_visits.context WHERE key=''cancelled-visit'')))','CRM_VISITS_CONFLICT','cancelled Visit terminal');
INSERT INTO runtime_visits.context VALUES('walk1',public.crm_v2_visits_command(gen_random_uuid(),runtime_visits.payload(1,'check_in','{"appointmentId":null,"expectedAppointmentRevision":null}')));
INSERT INTO runtime_visits.context VALUES('walk2',public.crm_v2_visits_command(gen_random_uuid(),runtime_visits.payload(1,'check_in','{"appointmentId":null,"expectedAppointmentRevision":null}')));
SELECT runtime_visits.assert_true((SELECT value->'visitId' FROM runtime_visits.context WHERE key='walk1')<>(SELECT value->'visitId' FROM runtime_visits.context WHERE key='walk2')
 AND jsonb_array_length(runtime_visits.snapshot()->'visits')=3,'repeat real walk-ins are separate Visits not one customer completion flag');
INSERT INTO runtime_visits.context VALUES('cancel-appt',public.crm_v2_visits_command(gen_random_uuid(),runtime_visits.payload(2)));
SELECT public.crm_v2_visits_command(gen_random_uuid(),runtime_visits.payload(2,'cancel_appointment',(SELECT jsonb_build_object('appointmentId',value->'appointmentId','expectedAppointmentRevision',value->'appointmentRevision') FROM runtime_visits.context WHERE key='cancel-appt')));
SELECT runtime_visits.assert_true(runtime_visits.snapshot(2)#>>'{appointments,0,status}'='cancelled' AND jsonb_array_length(runtime_visits.snapshot(2)->'visits')=0,'cancelled appointment does not fabricate visit');
SELECT set_config('request.jwt.claim.sub','bc230000-0000-4000-8000-000000000003',true);
SELECT runtime_visits.assert_true(runtime_visits.snapshot()#>>'{scope,canEdit}'='false','Owner reads history without edit rights');
SELECT runtime_visits.expect_error('SELECT public.crm_v2_visits_command(gen_random_uuid(),runtime_visits.payload(1))','CRM_VISITS_FORBIDDEN','Owner cannot schedule');
SELECT set_config('request.jwt.claim.sub','bc230000-0000-4000-8000-000000000004',true);
SELECT runtime_visits.assert_true(runtime_visits.snapshot(8)#>>'{scope,canEdit}'='false','other Sales reads other project');
SELECT runtime_visits.expect_error('SELECT public.crm_v2_visits_command(gen_random_uuid(),runtime_visits.payload(8))','CRM_VISITS_FORBIDDEN','other Sales cannot write');
SELECT set_config('request.jwt.claim.sub','bc230000-0000-4000-8000-000000000005',true);
SELECT runtime_visits.expect_error('SELECT runtime_visits.snapshot()','CRM_VISITS_FORBIDDEN','inactive Sales cannot read');
SELECT set_config('request.jwt.claim.sub','bc230000-0000-4000-8000-000000000001',true);
SELECT runtime_visits.assert_true(public.crm_v2_visits_command(gen_random_uuid(),runtime_visits.payload(8,'check_in','{"appointmentId":null,"expectedAppointmentRevision":null}'))->>'visitId' IS NOT NULL,'Admin can check in responsible Sales scope');
SELECT runtime_visits.assert_true(runtime_visits.snapshot(8)#>>'{visits,0,checkedInByUserId}'='bc230000-0000-4000-8000-000000000001','check-in keeps actual Admin actor not assigned Sales');
SELECT set_config('request.jwt.claim.sub','bc230000-0000-4000-8000-000000000002',true);
RESET ROLE;
SELECT runtime_visits.assert_true((SELECT value->'customers'=runtime_visits.business_snapshot()->'customers' AND value->'interests'=runtime_visits.business_snapshot()->'interests'
 AND value->'sales'=runtime_visits.business_snapshot()->'sales' AND value->'plots'=runtime_visits.business_snapshot()->'plots' AND value->'voices'=runtime_visits.business_snapshot()->'voices'
 AND value->'actions'=runtime_visits.business_snapshot()->'actions' AND value->'sla'=runtime_visits.business_snapshot()->'sla' FROM runtime_visits.context WHERE key='unchanged'),
 'appointments and Visits preserve Lead cohort owner workspace stock sales survey actions and SLA');
SELECT runtime_visits.expect_error('UPDATE public.lead_visits SET status=''cancelled'' WHERE id=(SELECT (value->>''visitId'')::uuid FROM runtime_visits.context WHERE key=''walk1'')','CRM_VISITS_FORBIDDEN','direct privileged Visit mutation needs permit');
SELECT runtime_visits.expect_error('DELETE FROM public.lead_appointments WHERE id=(SELECT (value->>''appointmentId'')::uuid FROM runtime_visits.context WHERE key=''result'')','CRM_VISITS_FORBIDDEN','direct appointment deletion denied');
SELECT runtime_visits.expect_error('UPDATE sales_private.visits_events SET reason=''forged''','CRM_VISITS_CONFLICT','event history immutable');
SELECT runtime_visits.expect_error('DELETE FROM sales_private.visits_command_requests','CRM_VISITS_CONFLICT','receipts immutable');
INSERT INTO sales_private.visits_write_permits VALUES(txid_current(),pg_backend_pid());
SELECT runtime_visits.expect_error('UPDATE public.lead_visits SET status=''completed'',revision=gen_random_uuid() WHERE id=(SELECT (value->>''visitId'')::uuid FROM runtime_visits.context WHERE key=''walk1'')','CRM_VISITS_CONFLICT','appointment permit cannot complete Visit');
INSERT INTO public.lead_appointments(id,project_interest_id,starts_at,assigned_sales_user_id,created_at,updated_at)
 VALUES('bc234000-0000-4000-8000-000000000001','bc232000-0000-4000-8000-000000000004',clock_timestamp()-interval '1 hour',
 'bc230000-0000-4000-8000-000000000002',clock_timestamp()-interval '2 hours',clock_timestamp()-interval '2 hours');
DELETE FROM sales_private.visits_write_permits WHERE transaction_id=txid_current();
SET LOCAL ROLE authenticated;
SELECT public.crm_v2_visits_command(gen_random_uuid(),runtime_visits.payload(4,'no_show',(SELECT jsonb_build_object('appointmentId',id,'expectedAppointmentRevision',revision) FROM public.lead_appointments WHERE id='bc234000-0000-4000-8000-000000000001')));
SELECT runtime_visits.assert_true(runtime_visits.snapshot(4)#>>'{appointments,0,status}'='no_show' AND jsonb_array_length(runtime_visits.snapshot(4)->'visits')=0,'no show after start is not attendance');
DO $pagination$
DECLARE n integer;
BEGIN
  FOR n IN 1..51 LOOP
    PERFORM public.crm_v2_visits_command(gen_random_uuid(),runtime_visits.payload(3));
    PERFORM public.crm_v2_visits_command(gen_random_uuid(),runtime_visits.payload(3,'check_in','{"appointmentId":null,"expectedAppointmentRevision":null}'));
  END LOOP;
END;
$pagination$;
SELECT runtime_visits.assert_true(jsonb_array_length(runtime_visits.snapshot(3)->'appointments')=50 AND runtime_visits.snapshot(3)->>'appointmentsHasMore'='true'
 AND jsonb_array_length(runtime_visits.snapshot(3,1)->'appointments')=1 AND runtime_visits.snapshot(3,1)->>'appointmentsHasMore'='false','appointments page fifty plus one');
SELECT runtime_visits.assert_true(jsonb_array_length(runtime_visits.snapshot(3)->'visits')=50 AND runtime_visits.snapshot(3)->>'visitsHasMore'='true'
 AND jsonb_array_length(runtime_visits.snapshot(3,0,1)->'visits')=1 AND runtime_visits.snapshot(3,0,1)->>'visitsHasMore'='false','Visits page fifty plus one');
SELECT runtime_visits.assert_true(jsonb_array_length(runtime_visits.snapshot(3,0,0,2)->'events')=2 AND runtime_visits.snapshot(3,0,0,2)->>'eventsHasMore'='false','independent append-only event page');
SELECT runtime_visits.expect_error('SELECT runtime_visits.snapshot(1,-1)','CRM_VISITS_INVALID_INPUT','negative page refused');
SELECT runtime_visits.expect_error('SELECT runtime_visits.snapshot(1,100001)','CRM_VISITS_INVALID_INPUT','unbounded page refused');
RESET ROLE;
CREATE FUNCTION runtime_visits.fail_receipt() RETURNS trigger LANGUAGE plpgsql AS $failure$
BEGIN RAISE EXCEPTION 'SYNTHETIC_INJECTED_FAILURE'; END;
$failure$;
CREATE TRIGGER synthetic_visits_fail BEFORE INSERT ON sales_private.visits_command_requests FOR EACH ROW EXECUTE FUNCTION runtime_visits.fail_receipt();
INSERT INTO runtime_visits.context VALUES('before-failure',runtime_visits.business_snapshot());
SET LOCAL ROLE authenticated;
SELECT runtime_visits.expect_error('SELECT public.crm_v2_visits_command(gen_random_uuid(),runtime_visits.payload(6))','SYNTHETIC_INJECTED_FAILURE','receipt failure propagates no partial acknowledgement');
RESET ROLE;
SELECT runtime_visits.assert_true(runtime_visits.business_snapshot()=(SELECT value FROM runtime_visits.context WHERE key='before-failure'),'failed transaction rolls back appointment events audit receipt and permit');
DROP TRIGGER synthetic_visits_fail ON sales_private.visits_command_requests;
SET LOCAL ROLE authenticated;
INSERT INTO runtime_visits.context VALUES('lost-input',runtime_visits.payload(7));
INSERT INTO runtime_visits.context VALUES('lost-result',public.crm_v2_visits_command('bc233000-0000-4000-8000-000000000003',(SELECT value FROM runtime_visits.context WHERE key='lost-input')));
SELECT public.crm_v2_change_lead_lifecycle(gen_random_uuid(),jsonb_build_object('command','close_lost','customerId','bc231000-0000-4000-8000-000000000007',
 'interestId','bc232000-0000-4000-8000-000000000007','expectedRevision',(runtime_visits.snapshot(7)#>'{scope,interestRevision}'),'expectedActionId',NULL,'reason','SYNTHETIC lost'));
SELECT runtime_visits.assert_true(runtime_visits.snapshot(7)#>>'{scope,canEdit}'='false','lost scope readonly');
SELECT runtime_visits.assert_true(public.crm_v2_visits_command('bc233000-0000-4000-8000-000000000003',(SELECT value FROM runtime_visits.context WHERE key='lost-input'))->>'replayed'='true','authorized replay can recover before lost closure');
SELECT runtime_visits.expect_error('SELECT public.crm_v2_visits_command(gen_random_uuid(),runtime_visits.payload(7))','CRM_VISITS_SCOPE_CLOSED','lost cannot receive new visits');
INSERT INTO runtime_visits.context VALUES('owner-input',runtime_visits.payload(5));
SELECT public.crm_v2_visits_command('bc233000-0000-4000-8000-000000000004',(SELECT value FROM runtime_visits.context WHERE key='owner-input'));
SELECT set_config('request.jwt.claim.sub','bc230000-0000-4000-8000-000000000001',true);
SELECT public.crm_v2_change_lead_lifecycle(gen_random_uuid(),jsonb_build_object('command','reassign_owner','customerId','bc231000-0000-4000-8000-000000000005',
 'interestId','bc232000-0000-4000-8000-000000000005','expectedRevision',(runtime_visits.snapshot(5)#>'{scope,interestRevision}'),'expectedActionId',NULL,
 'newOwnerUserId','bc230000-0000-4000-8000-000000000004','reason','SYNTHETIC owner transfer'));
SELECT set_config('request.jwt.claim.sub','bc230000-0000-4000-8000-000000000002',true);
SELECT runtime_visits.expect_error('SELECT public.crm_v2_visits_command(''bc233000-0000-4000-8000-000000000004'',(SELECT value FROM runtime_visits.context WHERE key=''owner-input''))','CRM_VISITS_FORBIDDEN','former owner cannot replay private receipt');
RESET ROLE;
UPDATE public.crm_settings SET visits_enabled=false WHERE id;
SET LOCAL ROLE authenticated;
SELECT runtime_visits.expect_error('SELECT public.crm_v2_visits_command(''bc233000-0000-4000-8000-000000000001'',(SELECT value FROM runtime_visits.context WHERE key=''input''))','CRM_VISITS_SETUP_REQUIRED','kill switch applies before receipt replay');
RESET ROLE;
UPDATE public.crm_settings SET visits_enabled=true WHERE id;
SELECT runtime_visits.assert_true(NOT EXISTS(SELECT 1 FROM sales_private.visits_write_permits),'private permit cleaned up');
INSERT INTO runtime_visits.context VALUES('before-read',runtime_visits.business_snapshot());
SET LOCAL ROLE authenticated;
SELECT runtime_visits.snapshot();
RESET ROLE;
SELECT runtime_visits.assert_true(runtime_visits.business_snapshot()=(SELECT value FROM runtime_visits.context WHERE key='before-read'),'context read changes no data');
SET TRANSACTION READ ONLY;
SET LOCAL ROLE authenticated;
DO $read_only$
BEGIN
  IF current_setting('transaction_read_only')<>'on' OR runtime_visits.snapshot()#>>'{scope,customerId}'<>'bc231000-0000-4000-8000-000000000001' THEN
    RAISE EXCEPTION 'READ_ONLY_VISITS_FAILED'; END IF;
END;
$read_only$;
SELECT 'VISITS_SNAPSHOT:'||value::text FROM runtime_visits.context WHERE key='snapshot';
SELECT 'VISITS_RESULT:'||value::text FROM runtime_visits.context WHERE key='result';
SELECT 'VISITS_INPUT:'||(value||'{"requestId":"bc233000-0000-4000-8000-000000000001"}'::jsonb)::text FROM runtime_visits.context WHERE key='input';
SELECT 'VISITS_RUNTIME:'||jsonb_build_object('suite','visits','assertions',(SELECT count(*)+1 FROM runtime_visits.assertions),
 'readOnlyTransaction',true,'syntheticOnly',true,'realDatabaseTested',false,'productionCertified',false)::text;
ROLLBACK;
