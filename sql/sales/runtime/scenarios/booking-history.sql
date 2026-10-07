-- SYNTHETIC LOCAL BOOKING TESTS ONLY; all rows/permissions/settings roll back.
-- Runner installs the legacy facade's sale_price/booking_amount BEFORE draft18.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $isolation$
BEGIN
  IF current_database() !~ '^buildtrack_sales_runtime_' OR current_setting('buildtrack.synthetic_runtime',true) IS DISTINCT FROM 'on'
    OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet THEN
    RAISE EXCEPTION 'REFUSED: booking tests require the isolated synthetic loopback runner';
  END IF;
END;
$isolation$;
CREATE SCHEMA runtime_booking;
CREATE TABLE runtime_booking.assertions(label text PRIMARY KEY);
CREATE TABLE runtime_booking.context(key text PRIMARY KEY,value jsonb NOT NULL);
GRANT USAGE ON SCHEMA runtime_booking TO authenticated,anon;
GRANT SELECT,INSERT,UPDATE ON runtime_booking.context,runtime_booking.assertions TO authenticated,anon;
CREATE FUNCTION runtime_booking.assert_true(condition boolean,label text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $assert$
BEGIN
  IF condition IS DISTINCT FROM true THEN RAISE EXCEPTION 'ASSERTION FAILED: %',label; END IF;
  INSERT INTO runtime_booking.assertions VALUES(label);
END;
$assert$;
CREATE FUNCTION runtime_booking.expect_error(statement text,expected_message text,label text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $expect$
DECLARE actual_message text;
BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS actual_message=MESSAGE_TEXT;
    IF expected_message IS NOT NULL AND actual_message<>expected_message THEN
      RAISE EXCEPTION 'ASSERTION FAILED: %; expected %, received %',label,expected_message,actual_message;
    END IF;
    INSERT INTO runtime_booking.assertions VALUES(label); RETURN;
  END;
  RAISE EXCEPTION 'ASSERTION FAILED: %; expected error',label;
END;
$expect$;
CREATE FUNCTION runtime_booking.payload(customer_id uuid DEFAULT NULL,plot_id text DEFAULT 'SYNTHETIC-BOOKING-1')
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $payload$
  SELECT jsonb_build_object('command','book','reason','SYNTHETIC customer confirmed booking','customerId',customer_id,
    'newCustomer',CASE WHEN customer_id IS NULL THEN jsonb_build_object('name','SYNTHETIC Booking Customer','phone','0891800001',
      'channel','phone','notes','SYNTHETIC ONLY','assignedSalesUserId',NULL) ELSE NULL END,
    'projectName','SYNTHETIC BOOKING PROJECT','expectedInterestRevision',NULL,'plotId',plot_id,'paymentMethod','mortgage',
    'bookingRoute','without_visit','visitId',NULL,'listPriceSatang',250000000,'discountSatang',500000,'depositSatang',100000,'previousSaleId',NULL);
$payload$;
INSERT INTO auth.users(id) VALUES
 ('bc180000-0000-4000-8000-000000000001'),('bc180000-0000-4000-8000-000000000002'),
 ('bc180000-0000-4000-8000-000000000003'),('bc180000-0000-4000-8000-000000000004');
INSERT INTO sales_private.crm_user_roles(user_id,role,display_name,is_active) VALUES
 ('bc180000-0000-4000-8000-000000000001','admin','SYNTHETIC Booking Admin',true),
 ('bc180000-0000-4000-8000-000000000002','sales','SYNTHETIC Booking Sales',true),
 ('bc180000-0000-4000-8000-000000000003','owner','SYNTHETIC Booking Owner',true),
 ('bc180000-0000-4000-8000-000000000004','sales','SYNTHETIC Other Sales',true);
INSERT INTO public.projects(name,is_closed) VALUES('SYNTHETIC BOOKING PROJECT',false),('SYNTHETIC BOOKING OTHER',false);
INSERT INTO public.plots(id,project_name,has_customer,sale_status)
 SELECT 'SYNTHETIC-BOOKING-'||n,'SYNTHETIC BOOKING PROJECT',false,'available' FROM generate_series(1,8) n;
INSERT INTO public.crm_settings(id,central_intake_enabled,lead_work_enabled,lead_lifecycle_enabled)
 VALUES(true,true,true,true) ON CONFLICT(id) DO UPDATE SET central_intake_enabled=true,lead_work_enabled=true,lead_lifecycle_enabled=true;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','bc180000-0000-4000-8000-000000000002',true);
SELECT runtime_booking.assert_true(public.crm_v2_booking_capabilities()='{"contract_version":"booking_history_v1","enabled":false}'::jsonb,'booking defaults disabled');
SELECT runtime_booking.expect_error('SELECT public.crm_v2_booking_context()','CRM_BOOKING_SETUP_REQUIRED','default off denies context');
SELECT runtime_booking.expect_error('SELECT public.crm_v2_booking_command(gen_random_uuid(),runtime_booking.payload())','CRM_BOOKING_SETUP_REQUIRED','default off denies commands');
RESET ROLE;
UPDATE public.crm_settings SET booking_enabled=true WHERE id;
SET LOCAL ROLE authenticated;
SELECT runtime_booking.expect_error('SELECT public.crm_v2_booking_context()','CRM_BOOKING_SETUP_REQUIRED','cutover gate independently blocks booking');
RESET ROLE;
UPDATE public.crm_settings SET booking_cutover_reviewed=true WHERE id;
SET LOCAL ROLE authenticated;
INSERT INTO runtime_booking.context VALUES('empty',public.crm_v2_booking_context());
SELECT runtime_booking.assert_true((SELECT value->'customer'='null'::jsonb AND value->'sales'='[]'::jsonb AND value->'interests'='[]'::jsonb FROM runtime_booking.context WHERE key='empty'),'intake context has no invented customer');
SELECT runtime_booking.expect_error('SELECT public.crm_v2_booking_command(gen_random_uuid(),runtime_booking.payload()||''{"extra":1}''::jsonb)','CRM_BOOKING_INVALID_INPUT','unknown command fields rejected');
SELECT runtime_booking.expect_error('SELECT public.crm_v2_booking_command(gen_random_uuid(),runtime_booking.payload()-''reason'')','CRM_BOOKING_INVALID_INPUT','missing command reason rejected');
SELECT runtime_booking.expect_error('SELECT public.crm_v2_booking_command(gen_random_uuid(),runtime_booking.payload()||''{"listPriceSatang":10.5}''::jsonb)','CRM_BOOKING_INVALID_INPUT','fractional satang rejected');
SELECT runtime_booking.expect_error('SELECT public.crm_v2_booking_command(gen_random_uuid(),runtime_booking.payload()||''{"discountSatang":250000000}''::jsonb)','CRM_BOOKING_INVALID_INPUT','zero net price rejected');
SELECT runtime_booking.expect_error('SELECT public.crm_v2_booking_command(gen_random_uuid(),runtime_booking.payload()||''{"depositSatang":250000000}''::jsonb)','CRM_BOOKING_INVALID_INPUT','deposit greater than sale price rejected');
INSERT INTO runtime_booking.context VALUES('book',public.crm_v2_booking_command('bc181000-0000-4000-8000-000000000001',runtime_booking.payload()));
INSERT INTO runtime_booking.context VALUES('book-context',public.crm_v2_booking_context((SELECT (value->>'customerId')::uuid FROM runtime_booking.context WHERE key='book')));
SELECT runtime_booking.assert_true((SELECT value#>>'{sales,0,stage}'='booked' AND value#>'{sales,0,listPrice}'='2500000'::jsonb
 AND value#>'{sales,0,discountAmount}'='5000'::jsonb AND value#>'{sales,0,salePrice}'='2495000'::jsonb AND value#>'{sales,0,depositAmount}'='1000'::jsonb
 AND value#>'{sales,0,canCancel}'='true'::jsonb AND value#>'{sales,0,canResume}'='false'::jsonb FROM runtime_booking.context WHERE key='book-context'),'booking context exact prices and actions');
SELECT runtime_booking.assert_true(public.crm_v2_booking_command('bc181000-0000-4000-8000-000000000001',runtime_booking.payload())->>'replayed'='true','identical retry returns original booking');
SELECT runtime_booking.expect_error('SELECT public.crm_v2_booking_command(''bc181000-0000-4000-8000-000000000001'',runtime_booking.payload()||''{"reason":"different"}''::jsonb)','CRM_BOOKING_IDEMPOTENCY_CONFLICT','same key different payload conflicts');
SELECT runtime_booking.assert_true(jsonb_array_length(public.crm_v2_booking_search('SYNTHETIC Booking Customer')->'customers')=1,'search selects exact central identity');
SELECT runtime_booking.assert_true(public.crm_v2_booking_search('%%')->'customers'='[]'::jsonb,'search wildcard characters treated literally');
SELECT runtime_booking.expect_error('SELECT public.crm_v2_booking_search(''x'')','CRM_BOOKING_INVALID_INPUT','search requires two characters');
RESET ROLE;
SELECT runtime_booking.assert_true((SELECT count(*)=1 FROM public.sales_customers WHERE phone='0891800001'),'retry creates only one central customer');
SELECT runtime_booking.assert_true((SELECT count(*)=1 AND bool_and(lead_id IS NULL) FROM public.sales WHERE plot_id='SYNTHETIC-BOOKING-1'),'booking does not create duplicate legacy Lead');
SELECT runtime_booking.assert_true((SELECT has_customer FROM public.plots WHERE id='SYNTHETIC-BOOKING-1'),'booking locks stock atomically');
SELECT runtime_booking.assert_true(NOT EXISTS(SELECT 1 FROM sales_private.booking_write_permits),'write permits not left behind');
SELECT runtime_booking.assert_true((SELECT workspace_state='project_active' AND activation_reason='booking' FROM public.lead_project_interests WHERE id=(SELECT (value->>'interestId')::uuid FROM runtime_booking.context WHERE key='book')),'booking records project association without fake Visit');
SELECT runtime_booking.assert_true(NOT EXISTS(SELECT 1 FROM public.lead_visits WHERE project_interest_id=(SELECT (value->>'interestId')::uuid FROM runtime_booking.context WHERE key='book')),'remote booking creates no fake Visit');
INSERT INTO runtime_booking.context SELECT 'customer-before',to_jsonb(c) FROM public.sales_customers c WHERE id=(SELECT (value->>'customerId')::uuid FROM runtime_booking.context WHERE key='book');
-- Intentionally broad synthetic legacy grants: the V2 trigger must still close
-- direct INSERT/UPDATE/DELETE, including clearing the V2 relation to evade RLS.
GRANT SELECT,INSERT,UPDATE,DELETE ON public.sales TO authenticated;
SET LOCAL ROLE authenticated;
SELECT runtime_booking.expect_error('UPDATE public.sales SET project_interest_id=NULL WHERE id=(SELECT (value->>''saleId'')::uuid FROM runtime_booking.context WHERE key=''book'')','CRM_BOOKING_FORBIDDEN','legacy direct writer cannot unlink V2 sale');
SELECT runtime_booking.expect_error('DELETE FROM public.sales WHERE id=(SELECT (value->>''saleId'')::uuid FROM runtime_booking.context WHERE key=''book'')','CRM_BOOKING_FORBIDDEN','legacy direct delete cannot remove booking history');
SELECT runtime_booking.expect_error('INSERT INTO sales_private.booking_write_permits VALUES(txid_current(),pg_backend_pid())',NULL,'browser cannot create private write capability');
SELECT set_config('request.jwt.claim.sub','bc180000-0000-4000-8000-000000000003',true);
SELECT runtime_booking.assert_true((public.crm_v2_booking_context((SELECT (value->>'customerId')::uuid FROM runtime_booking.context WHERE key='book'))#>'{sales,0,canCancel}')='false'::jsonb,'Owner has read-only booking context');
SELECT runtime_booking.expect_error('SELECT public.crm_v2_booking_command(gen_random_uuid(),runtime_booking.payload())','CRM_BOOKING_FORBIDDEN','Owner cannot book');
SELECT set_config('request.jwt.claim.sub','bc180000-0000-4000-8000-000000000004',true);
SELECT runtime_booking.expect_error('SELECT public.crm_v2_booking_command(gen_random_uuid(),runtime_booking.payload((SELECT (value->>''customerId'')::uuid FROM runtime_booking.context WHERE key=''book'')))','CRM_BOOKING_FORBIDDEN','other Sales cannot book same interest');
SELECT set_config('request.jwt.claim.sub','bc180000-0000-4000-8000-000000000002',true);
INSERT INTO runtime_booking.context SELECT 'cancel-input',jsonb_build_object('command','cancel','reason','SYNTHETIC cancellation reason','customerId',value->'customerId',
 'saleId',value->'saleId','expectedSaleRevision',value->'saleRevision','cancellationCategory','booking_cancelled') FROM runtime_booking.context WHERE key='book';
SELECT runtime_booking.expect_error('SELECT public.crm_v2_booking_command(gen_random_uuid(),(SELECT value FROM runtime_booking.context WHERE key=''cancel-input'')||jsonb_build_object(''expectedSaleRevision'',gen_random_uuid()))','CRM_BOOKING_STALE_STATE','stale cancellation rejected');
INSERT INTO runtime_booking.context VALUES('cancel',public.crm_v2_booking_command('bc181000-0000-4000-8000-000000000002',(SELECT value FROM runtime_booking.context WHERE key='cancel-input')));
SELECT runtime_booking.assert_true(public.crm_v2_booking_command('bc181000-0000-4000-8000-000000000002',(SELECT value FROM runtime_booking.context WHERE key='cancel-input'))->>'replayed'='true','cancel retry does not duplicate history');
RESET ROLE;
SELECT runtime_booking.assert_true((SELECT NOT has_customer FROM public.plots WHERE id='SYNTHETIC-BOOKING-1'),'cancellation releases only unoccupied stock');
INSERT INTO runtime_booking.context SELECT 'cancelled-sale',to_jsonb(s) FROM public.sales s WHERE id=(SELECT (value->>'saleId')::uuid FROM runtime_booking.context WHERE key='book');
SELECT runtime_booking.assert_true((SELECT value->>'crm_stage'='cancelled' AND value->>'contract_status'='Cancelled' AND value->>'cancellation_reason'='SYNTHETIC cancellation reason'
 AND value->'cancelled_at'<>'null'::jsonb AND value->'booked_at'<>'null'::jsonb AND value->'sale_price'='2495000'::jsonb FROM runtime_booking.context WHERE key='cancelled-sale'),'cancel preserves amount and original booking evidence');
SELECT runtime_booking.assert_true(NOT EXISTS(SELECT 1 FROM public.crm_next_actions WHERE customer_id=(SELECT (value->>'customerId')::uuid FROM runtime_booking.context WHERE key='book')),'cancel does not auto reopen or schedule followup');
SET LOCAL ROLE authenticated;
INSERT INTO runtime_booking.context SELECT 'resume-input',jsonb_build_object('command','resume_follow_up','reason','SYNTHETIC resume with customer agreement',
 'customerId',value->'customerId','saleId',value->'saleId','expectedSaleRevision',value->'saleRevision','expectedInterestRevision',value->'interestRevision',
 'expectedActionId',NULL,'nextAction',jsonb_build_object('action','SYNTHETIC call customer',
 'dueAt',to_char(clock_timestamp()+interval '1 day','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))) FROM runtime_booking.context WHERE key='cancel';
SELECT runtime_booking.expect_error('SELECT public.crm_v2_booking_command(gen_random_uuid(),jsonb_set((SELECT value FROM runtime_booking.context WHERE key=''resume-input''),''{nextAction,dueAt}'',''"2000-01-01T00:00:00Z"''::jsonb))','CRM_BOOKING_INVALID_INPUT','resume past due time rolls back');
INSERT INTO runtime_booking.context VALUES('resume',public.crm_v2_booking_command('bc181000-0000-4000-8000-000000000003',(SELECT value FROM runtime_booking.context WHERE key='resume-input')));
SELECT runtime_booking.assert_true(public.crm_v2_booking_command('bc181000-0000-4000-8000-000000000003',(SELECT value FROM runtime_booking.context WHERE key='resume-input'))->>'replayed'='true','resume replay returns one next action');
RESET ROLE;
SELECT runtime_booking.assert_true((SELECT to_jsonb(s)=(SELECT value FROM runtime_booking.context WHERE key='cancelled-sale') FROM public.sales s WHERE id=(SELECT (value->>'saleId')::uuid FROM runtime_booking.context WHERE key='book')),'resume leaves cancelled row byte-for-byte unchanged including revision');
SELECT runtime_booking.assert_true((SELECT to_jsonb(c)=(SELECT value FROM runtime_booking.context WHERE key='customer-before') FROM public.sales_customers c WHERE id=(SELECT (value->>'customerId')::uuid FROM runtime_booking.context WHERE key='book')),'cancel and resume retain entire central customer including cohort and first contact');
SELECT runtime_booking.assert_true((SELECT count(*)=1 FROM public.crm_next_actions WHERE project_interest_id=(SELECT (value->>'interestId')::uuid FROM runtime_booking.context WHERE key='book')),'resume creates one explicit followup plan');
SET LOCAL ROLE authenticated;
INSERT INTO runtime_booking.context SELECT 'rebook-input',runtime_booking.payload((value->>'customerId')::uuid,'SYNTHETIC-BOOKING-2')||jsonb_build_object('expectedInterestRevision',value->'interestRevision','previousSaleId',value->'saleId') FROM runtime_booking.context WHERE key='resume';
INSERT INTO runtime_booking.context VALUES('rebook',public.crm_v2_booking_command('bc181000-0000-4000-8000-000000000004',(SELECT value FROM runtime_booking.context WHERE key='rebook-input')));
INSERT INTO runtime_booking.context VALUES('history',public.crm_v2_booking_context((SELECT (value->>'customerId')::uuid FROM runtime_booking.context WHERE key='book')));
SELECT runtime_booking.assert_true((SELECT jsonb_array_length(value->'sales')=2 AND value#>'{sales,0,bookingRound}'='2'::jsonb
 AND value#>>'{sales,0,previousSaleId}'=(SELECT value->>'saleId' FROM runtime_booking.context WHERE key='book')
 AND value#>>'{sales,1,stage}'='cancelled' FROM runtime_booking.context WHERE key='history'),'rebook appends new round and retains cancelled round');
-- Followup after cancelling one of several bookings is permitted; another active
-- booking must not be modified or silently cancelled by the followup command.
INSERT INTO runtime_booking.context SELECT 'resume-again-input',(SELECT value FROM runtime_booking.context WHERE key='resume-input')||jsonb_build_object(
 'expectedInterestRevision',value->'interestRevision','expectedActionId',(SELECT value->'nextActionId' FROM runtime_booking.context WHERE key='resume')) FROM runtime_booking.context WHERE key='rebook';
INSERT INTO runtime_booking.context VALUES('resume-again',public.crm_v2_booking_command(gen_random_uuid(),(SELECT value FROM runtime_booking.context WHERE key='resume-again-input')));
SELECT runtime_booking.assert_true((public.crm_v2_booking_context((SELECT (value->>'customerId')::uuid FROM runtime_booking.context WHERE key='book'))#>>'{sales,0,stage}')='booked','followup permits separate active booking unchanged');
SELECT runtime_booking.expect_error('SELECT public.crm_v2_booking_command(gen_random_uuid(),runtime_booking.payload()||''{"plotId":"SYNTHETIC-BOOKING-3"}''::jsonb)','CRM_BOOKING_DUPLICATE_REVIEW_REQUIRED','duplicate phone never merges or creates another customer');
SELECT runtime_booking.expect_error('SELECT public.crm_v2_booking_command(gen_random_uuid(),jsonb_set(runtime_booking.payload(),''{newCustomer,phone}'',''"0891800002"''::jsonb)||''{"plotId":"SYNTHETIC-BOOKING-2"}''::jsonb)','CRM_BOOKING_PLOT_UNAVAILABLE','occupied stock rejects entire new-customer booking transaction');
RESET ROLE;
SELECT runtime_booking.assert_true(NOT EXISTS(SELECT 1 FROM public.sales_customers WHERE phone='0891800002'),'failed booking rolls back new customer, SLA and audit');
-- Legacy history unknowns stay NULL. Private fixture permit simulates a separately
-- reviewed import, never an authenticated browser capability.
INSERT INTO sales_private.booking_write_permits VALUES(txid_current(),pg_backend_pid());
INSERT INTO public.sales(project_interest_id,plot_id,booking_round,crm_stage,booking_route,booking_route_reason,contract_status,
 booked_at,sale_price,booking_amount,list_price,discount_amount,payment_method)
 SELECT (value->>'interestId')::uuid,'SYNTHETIC-BOOKING-3',3,'booked','legacy_import','SYNTHETIC evidence import','Reserved',
 NULL,NULL,NULL,NULL,NULL,NULL FROM runtime_booking.context WHERE key='book';
DELETE FROM sales_private.booking_write_permits WHERE transaction_id=txid_current();
SET LOCAL ROLE authenticated;
SELECT runtime_booking.assert_true((public.crm_v2_booking_context((SELECT (value->>'customerId')::uuid FROM runtime_booking.context WHERE key='book'))#>'{sales,2,bookedAt}')='null'::jsonb
 AND (public.crm_v2_booking_context((SELECT (value->>'customerId')::uuid FROM runtime_booking.context WHERE key='book'))#>'{sales,2,salePrice}')='null'::jsonb,'unknown imported dates and money remain null');
RESET ROLE;
INSERT INTO public.lead_visits(id,project_interest_id,checked_in_by_user_id,checked_in_at)
 SELECT 'bc182000-0000-4000-8000-000000000001',(value->>'interestId')::uuid,'bc180000-0000-4000-8000-000000000002',clock_timestamp()-interval '1 hour'
 FROM runtime_booking.context WHERE key='book';
SET LOCAL ROLE authenticated;
INSERT INTO runtime_booking.context SELECT 'visit-input',runtime_booking.payload((value->>'customerId')::uuid,'SYNTHETIC-BOOKING-4')||jsonb_build_object(
 'expectedInterestRevision',value->'interestRevision','bookingRoute','visited','visitId','bc182000-0000-4000-8000-000000000001') FROM runtime_booking.context WHERE key='resume-again';
SELECT runtime_booking.assert_true((public.crm_v2_booking_context((SELECT (value->>'customerId')::uuid FROM runtime_booking.context WHERE key='book'))#>'{interests,0,visits}')='[]'::jsonb,'awaiting-voice Visit is not offered as completed booking evidence');
SELECT runtime_booking.expect_error('SELECT public.crm_v2_booking_command(gen_random_uuid(),(SELECT value FROM runtime_booking.context WHERE key=''visit-input''))','CRM_BOOKING_CONFLICT','visited booking rejects missing Customer Voices');
RESET ROLE;
INSERT INTO public.customer_voices(id,visit_id,crm_answers,crm_form_version,crm_submission_state,crm_submitted_at,crm_validated_at,crm_submitted_by_customer)
 VALUES('bc182000-0000-4000-8000-000000000002','bc182000-0000-4000-8000-000000000001','{}'::jsonb,'SYNTHETIC-v1','submitted',
 clock_timestamp()-interval '10 minutes',clock_timestamp()-interval '10 minutes',true);
UPDATE public.lead_visits SET status='completed',completed_at=clock_timestamp()-interval '10 minutes',
 completed_voice_id='bc182000-0000-4000-8000-000000000002',completion_evidence_state='submitted' WHERE id='bc182000-0000-4000-8000-000000000001';
-- A legacy association with unknown activation date must not acquire an invented
-- date/reason merely because the same interest later gets a new booking.
UPDATE public.lead_project_interests SET activation_reason='legacy_import',activated_at=NULL WHERE id=(SELECT (value->>'interestId')::uuid FROM runtime_booking.context WHERE key='book');
SET LOCAL ROLE authenticated;
SELECT runtime_booking.assert_true(jsonb_array_length(public.crm_v2_booking_context((SELECT (value->>'customerId')::uuid FROM runtime_booking.context WHERE key='book'))#>'{interests,0,visits}')=1,'completed evidenced Visit is selectable');
INSERT INTO runtime_booking.context VALUES('visited-book',public.crm_v2_booking_command(gen_random_uuid(),(SELECT value FROM runtime_booking.context WHERE key='visit-input')));
RESET ROLE;
SELECT runtime_booking.assert_true((SELECT booking_visit_id='bc182000-0000-4000-8000-000000000001'::uuid AND booking_route='visited' FROM public.sales WHERE id=(SELECT (value->>'saleId')::uuid FROM runtime_booking.context WHERE key='visited-book')),'visited booking stores same-interest completion reference');
SELECT runtime_booking.assert_true((SELECT activation_reason='legacy_import' AND activated_at IS NULL FROM public.lead_project_interests WHERE id=(SELECT (value->>'interestId')::uuid FROM runtime_booking.context WHERE key='book')),'new booking preserves historical unknown activation evidence');
SELECT runtime_booking.assert_true(EXISTS(SELECT 1 FROM public.crm_audit_events WHERE entity_id=(SELECT (value->>'saleId')::uuid FROM runtime_booking.context WHERE key='book')
 AND event_type='resume_follow_up' AND old_values#>>'{interest,engagement_status}'='new' AND new_values#>>'{interest,engagement_status}'='follow_up'),'resume audit includes explicit old and new interest status');
-- History beyond the first page is retained and readable, never .find()/single().
INSERT INTO sales_private.booking_write_permits VALUES(txid_current(),pg_backend_pid());
INSERT INTO public.sales(project_interest_id,plot_id,booking_round,crm_stage,booking_route,booking_route_reason,contract_status,
 cancelled_at,cancellation_category,cancellation_reason,booked_at,sale_price,booking_amount)
 SELECT (value->>'interestId')::uuid,NULL,n,'cancelled','without_visit','SYNTHETIC archived round','Cancelled',
 clock_timestamp()-interval '1 day','other','SYNTHETIC historical test',clock_timestamp()-interval '2 days',NULL,NULL
 FROM runtime_booking.context CROSS JOIN generate_series(5,55) n WHERE key='book';
DELETE FROM sales_private.booking_write_permits WHERE transaction_id=txid_current();
SET LOCAL ROLE authenticated;
SELECT runtime_booking.assert_true(jsonb_array_length(public.crm_v2_booking_context((SELECT (value->>'customerId')::uuid FROM runtime_booking.context WHERE key='book'),0)->'sales')=50
 AND public.crm_v2_booking_context((SELECT (value->>'customerId')::uuid FROM runtime_booking.context WHERE key='book'),0)->>'hasMore'='true','booking history first page explicitly limited to 50');
SELECT runtime_booking.assert_true(jsonb_array_length(public.crm_v2_booking_context((SELECT (value->>'customerId')::uuid FROM runtime_booking.context WHERE key='book'),1)->'sales')=5
 AND public.crm_v2_booking_context((SELECT (value->>'customerId')::uuid FROM runtime_booking.context WHERE key='book'),1)->>'hasMore'='false','all older booking rounds remain readable on next page');
RESET ROLE;
INSERT INTO public.leads(id,phone) VALUES('bc183000-0000-4000-8000-000000000001','000-000-0000');
INSERT INTO public.sales_customers(id,customer_name,record_origin,legacy_source_lead_id,phone,phone_data_status,intake_status,
 owner_user_id,created_by_user_id,lead_created_at)
 VALUES('bc183000-0000-4000-8000-000000000002','SYNTHETIC unmapped historical sale','legacy_import','bc183000-0000-4000-8000-000000000001',NULL,
 'unknown_legacy','legacy_unclassified','bc180000-0000-4000-8000-000000000002','bc180000-0000-4000-8000-000000000001',NULL);
INSERT INTO public.sales(lead_id,plot_id,contract_status) VALUES('bc183000-0000-4000-8000-000000000001','SYNTHETIC-BOOKING-7','Reserved');
SET LOCAL ROLE authenticated;
SELECT runtime_booking.expect_error('SELECT public.crm_v2_booking_context(''bc183000-0000-4000-8000-000000000002'')','CRM_BOOKING_SETUP_REQUIRED','unlinked legacy sales block incomplete central history');
SELECT runtime_booking.expect_error('SELECT public.crm_v2_booking_command(gen_random_uuid(),runtime_booking.payload(''bc183000-0000-4000-8000-000000000002'',''SYNTHETIC-BOOKING-8''))','CRM_BOOKING_SETUP_REQUIRED','unlinked legacy sale blocks newbooking cutover bypass');
RESET ROLE;
INSERT INTO public.sales(plot_id,contract_status) VALUES('SYNTHETIC-BOOKING-8',' Cancelled ');
SET LOCAL ROLE authenticated;
SELECT runtime_booking.expect_error('SELECT public.crm_v2_booking_command(gen_random_uuid(),jsonb_set(runtime_booking.payload(),''{newCustomer,phone}'',''"0891800003"''::jsonb)||''{"plotId":"SYNTHETIC-BOOKING-8"}''::jsonb)','CRM_BOOKING_PLOT_UNAVAILABLE','malformed legacy status follows exact active-plot index and fails closed');
RESET ROLE;
UPDATE public.lead_project_interests SET owner_user_id='bc180000-0000-4000-8000-000000000004' WHERE id=(SELECT (value->>'interestId')::uuid FROM runtime_booking.context WHERE key='book');
SET LOCAL ROLE authenticated;
SELECT runtime_booking.expect_error('SELECT public.crm_v2_booking_command(''bc181000-0000-4000-8000-000000000001'',runtime_booking.payload())','CRM_BOOKING_FORBIDDEN','former owner cannot replay old booking receipt');
RESET ROLE;
UPDATE public.crm_settings SET booking_enabled=false WHERE id;
SET LOCAL ROLE authenticated;
SELECT runtime_booking.expect_error('SELECT public.crm_v2_booking_command(''bc181000-0000-4000-8000-000000000001'',runtime_booking.payload())','CRM_BOOKING_SETUP_REQUIRED','kill switch blocks even cached command');
RESET ROLE;
SELECT 'BOOKING_HISTORY_SNAPSHOT:'||value::text FROM runtime_booking.context WHERE key='history';
SELECT 'BOOKING_HISTORY_RUNTIME:'||jsonb_build_object('assertions',(SELECT count(*) FROM runtime_booking.assertions),'syntheticOnly',true,'productionCertified',false)::text;
ROLLBACK;
