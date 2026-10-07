-- SYNTHETIC LOCAL POST-BOOKING TESTS ONLY. Entire scenario rolls back.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $isolation$
BEGIN
  IF current_database() !~ '^buildtrack_sales_runtime_' OR current_setting('buildtrack.synthetic_runtime',true) IS DISTINCT FROM 'on'
    OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet THEN RAISE EXCEPTION 'REFUSED: isolated synthetic post booking only'; END IF;
END;
$isolation$;
CREATE SCHEMA runtime_post_booking;
CREATE TABLE runtime_post_booking.assertions(label text PRIMARY KEY);
CREATE TABLE runtime_post_booking.context(key text PRIMARY KEY,value jsonb NOT NULL);
GRANT USAGE ON SCHEMA runtime_post_booking TO authenticated,anon;
GRANT SELECT,INSERT,UPDATE ON runtime_post_booking.assertions,runtime_post_booking.context TO authenticated,anon;
CREATE FUNCTION runtime_post_booking.assert_true(condition boolean,label text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $assert$
BEGIN
  IF condition IS DISTINCT FROM true THEN RAISE EXCEPTION 'ASSERTION FAILED: %',label; END IF;
  INSERT INTO runtime_post_booking.assertions VALUES(label);
END;
$assert$;
CREATE FUNCTION runtime_post_booking.expect_error(statement text,expected_message text,label text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $expect$
DECLARE actual_message text;
BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS actual_message=MESSAGE_TEXT;
    IF expected_message IS NOT NULL AND actual_message<>expected_message THEN
      RAISE EXCEPTION 'ASSERTION FAILED: %; expected %, received %',label,expected_message,actual_message;
    END IF;
    INSERT INTO runtime_post_booking.assertions VALUES(label); RETURN;
  END;
  RAISE EXCEPTION 'ASSERTION FAILED: %; expected error',label;
END;
$expect$;
CREATE FUNCTION runtime_post_booking.payload(booking_key text,command_value text DEFAULT 'advance',extra jsonb DEFAULT '{"nextStage":"contracted"}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $payload$
DECLARE s jsonb;
BEGIN
  s:=public.crm_v2_post_booking_context((SELECT (value->>'saleId')::uuid FROM runtime_post_booking.context WHERE key=booking_key))->'sale';
  RETURN jsonb_build_object('command',command_value,'customerId',s->'customerId','saleId',s->'id','expectedSaleRevision',s->'revision',
    'expectedInterestRevision',s->'interestRevision','reason','SYNTHETIC staff reason','evidenceNote','SYNTHETIC STAFF DECLARATION ONLY',
    'occurredAt',to_char(clock_timestamp(),'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))||extra;
END;
$payload$;
CREATE FUNCTION runtime_post_booking.transfer_payload(booking_key text,day_value text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $transfer_payload$
  SELECT (runtime_post_booking.payload(booking_key,'confirm_transfer','{}')-ARRAY['evidenceNote','occurredAt'])
    ||jsonb_build_object('transferDate',COALESCE(day_value,((clock_timestamp() AT TIME ZONE 'Asia/Bangkok')::date)::text));
$transfer_payload$;
CREATE FUNCTION runtime_post_booking.business_snapshot()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $business$
  SELECT jsonb_build_object(
    'customers',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.sales_customers r),
    'interests',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.lead_project_interests r),
    'sales',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.sales r),
    'plots',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.plots r),
    'loans',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.loan_attempts r),
    'settings',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.crm_settings r),
    'audits',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.crm_audit_events r),
    'events',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM sales_private.post_booking_events r),
    'receipts',(SELECT jsonb_agg(to_jsonb(r) ORDER BY actor_user_id,request_id) FROM sales_private.post_booking_command_requests r),
    'bookingPermits',(SELECT jsonb_agg(to_jsonb(r) ORDER BY transaction_id) FROM sales_private.booking_write_permits r),
    'loanPermits',(SELECT jsonb_agg(to_jsonb(r) ORDER BY transaction_id) FROM sales_private.post_booking_write_permits r));
$business$;
REVOKE ALL ON FUNCTION runtime_post_booking.business_snapshot() FROM PUBLIC;
INSERT INTO auth.users(id) VALUES('bc210000-0000-4000-8000-000000000001'),('bc210000-0000-4000-8000-000000000002'),
 ('bc210000-0000-4000-8000-000000000003'),('bc210000-0000-4000-8000-000000000004'),('bc210000-0000-4000-8000-000000000005');
INSERT INTO sales_private.crm_user_roles(user_id,role,display_name,is_active) VALUES
 ('bc210000-0000-4000-8000-000000000001','admin','SYNTHETIC POST ADMIN',true),
 ('bc210000-0000-4000-8000-000000000002','sales','SYNTHETIC POST SALES',true),
 ('bc210000-0000-4000-8000-000000000003','owner','SYNTHETIC POST OWNER',true),
 ('bc210000-0000-4000-8000-000000000004','sales','SYNTHETIC OTHER SALES',true),
 ('bc210000-0000-4000-8000-000000000005','sales','SYNTHETIC INACTIVE SALES',false);
INSERT INTO public.projects(name,is_closed) VALUES('SYNTHETIC POST BOOKING',false);
INSERT INTO public.plots(id,project_name,has_customer,sale_status) SELECT 'SYNTHETIC-POST-'||n,'SYNTHETIC POST BOOKING',false,'available' FROM generate_series(1,15) n;
INSERT INTO public.crm_settings(id,central_intake_enabled,lead_work_enabled,lead_lifecycle_enabled,booking_enabled,booking_cutover_reviewed,post_booking_enabled)
 VALUES(true,true,true,true,true,true,false) ON CONFLICT(id) DO UPDATE SET central_intake_enabled=true,lead_work_enabled=true,
 lead_lifecycle_enabled=true,booking_enabled=true,booking_cutover_reviewed=true,post_booking_enabled=false;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','bc210000-0000-4000-8000-000000000002',true);
DO $seed_bookings$
DECLARE n integer; r jsonb;
BEGIN
  FOR n IN 1..15 LOOP
    r:=public.crm_v2_booking_command(gen_random_uuid(),jsonb_build_object('command','book','reason','SYNTHETIC booking',
      'customerId',NULL,'newCustomer',jsonb_build_object('name','SYNTHETIC POST CUSTOMER '||n,'phone','08921000'||lpad(n::text,2,'0'),
        'channel','phone','notes','SYNTHETIC ONLY','assignedSalesUserId',NULL),
      'projectName','SYNTHETIC POST BOOKING','expectedInterestRevision',NULL,'plotId','SYNTHETIC-POST-'||n,
      'paymentMethod',CASE WHEN n IN(2,3,4,11,12,14) THEN 'cash' ELSE 'mortgage' END,'bookingRoute','without_visit','visitId',NULL,
      'listPriceSatang',100000000,'discountSatang',10000,'depositSatang',100000,'previousSaleId',NULL));
    INSERT INTO runtime_post_booking.context VALUES('book'||n,r);
  END LOOP;
END;
$seed_bookings$;
SELECT runtime_post_booking.assert_true(public.crm_v2_post_booking_capabilities()='{"contract_version":"post_booking_v2","enabled":false}'::jsonb,'new post-booking gate defaults off');
SELECT runtime_post_booking.expect_error('SELECT public.crm_v2_post_booking_context((SELECT (value->>''saleId'')::uuid FROM runtime_post_booking.context WHERE key=''book1''))','CRM_POST_BOOKING_SETUP_REQUIRED','default disabled context');
SELECT runtime_post_booking.expect_error('SELECT public.crm_v2_post_booking_command(gen_random_uuid(),''{}'')','CRM_POST_BOOKING_SETUP_REQUIRED','default disabled command before payload');
RESET ROLE;
UPDATE public.crm_settings SET post_booking_enabled=true WHERE id;
INSERT INTO runtime_post_booking.context SELECT 'unchanged-business',jsonb_build_object(
 'customers',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.sales_customers c),
 'interests',(SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM public.lead_project_interests i),
 'plots',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.plots p));
INSERT INTO runtime_post_booking.context SELECT 'sale1-before',to_jsonb(s)-ARRAY['crm_stage','booking_revision','contracted_at'] FROM public.sales s
 WHERE id=(SELECT (value->>'saleId')::uuid FROM runtime_post_booking.context WHERE key='book1');
SET LOCAL ROLE authenticated;
SELECT runtime_post_booking.assert_true(public.crm_v2_post_booking_capabilities()='{"contract_version":"post_booking_v2","enabled":true}'::jsonb,'enabled post booking capabilities exact contract');
INSERT INTO runtime_post_booking.context VALUES('input1',runtime_post_booking.payload('book1'));
SELECT runtime_post_booking.expect_error('SELECT public.crm_v2_post_booking_command(gen_random_uuid(),(SELECT value FROM runtime_post_booking.context WHERE key=''input1'')||''{"extra":"forged"}'')','CRM_POST_BOOKING_INVALID_INPUT','unknown payload metadata rejected');
SELECT runtime_post_booking.expect_error('SELECT public.crm_v2_post_booking_command(gen_random_uuid(),(SELECT value FROM runtime_post_booking.context WHERE key=''input1'')-''evidenceNote'')','CRM_POST_BOOKING_INVALID_INPUT','staff declaration required');
SELECT runtime_post_booking.expect_error('SELECT public.crm_v2_post_booking_command(gen_random_uuid(),(SELECT value FROM runtime_post_booking.context WHERE key=''input1'')||jsonb_build_object(''evidenceNote'',''line''||chr(10)||''two''))','CRM_POST_BOOKING_INVALID_INPUT','multiline evidence declaration rejected');
SELECT runtime_post_booking.expect_error('SELECT public.crm_v2_post_booking_command(gen_random_uuid(),(SELECT value FROM runtime_post_booking.context WHERE key=''input1'')||jsonb_build_object(''reason'',repeat(''x'',20000)))','CRM_POST_BOOKING_INVALID_INPUT','oversized command body rejected');
SELECT runtime_post_booking.expect_error('SELECT public.crm_v2_post_booking_command(gen_random_uuid(),(SELECT value FROM runtime_post_booking.context WHERE key=''input1'')||''{"reason":" "}'')','CRM_POST_BOOKING_INVALID_INPUT','blank reason rejected');
SELECT runtime_post_booking.expect_error('SELECT public.crm_v2_post_booking_command(gen_random_uuid(),(SELECT value FROM runtime_post_booking.context WHERE key=''input1'')||''{"occurredAt":"2099-01-01T00:00:00Z"}'')','CRM_POST_BOOKING_INVALID_INPUT','future event rejected');
SELECT runtime_post_booking.expect_error('SELECT public.crm_v2_post_booking_command(gen_random_uuid(),(SELECT value FROM runtime_post_booking.context WHERE key=''input1'')||''{"occurredAt":"2000-01-01T00:00:00Z"}'')','CRM_POST_BOOKING_INVALID_INPUT','event before known booking rejected');
SELECT runtime_post_booking.expect_error('SELECT public.crm_v2_post_booking_command(gen_random_uuid(),(SELECT value FROM runtime_post_booking.context WHERE key=''input1'')||''{"occurredAt":"2026-02-30T00:00:00Z"}'')','CRM_POST_BOOKING_INVALID_INPUT','invalid calendar timestamp rejected');
SELECT runtime_post_booking.expect_error('SELECT public.crm_v2_post_booking_command(gen_random_uuid(),(SELECT value FROM runtime_post_booking.context WHERE key=''input1'')||''{"nextStage":"document_prep"}'')','CRM_POST_BOOKING_CONFLICT','cannot skip contract from booked');
SELECT runtime_post_booking.expect_error('SELECT public.crm_v2_post_booking_command(gen_random_uuid(),(SELECT value FROM runtime_post_booking.context WHERE key=''input1'')||''{"nextStage":"transferred"}'')','CRM_POST_BOOKING_INVALID_INPUT','actual transfer outside command contract');
SELECT runtime_post_booking.expect_error('SELECT public.crm_v2_post_booking_command(gen_random_uuid(),(SELECT value FROM runtime_post_booking.context WHERE key=''input1'')||jsonb_build_object(''expectedInterestRevision'',gen_random_uuid()))','CRM_POST_BOOKING_STALE_STATE','stale interest assignment revision rejected');
INSERT INTO runtime_post_booking.context VALUES('contract1',public.crm_v2_post_booking_command('bc211000-0000-4000-8000-000000000001',(SELECT value FROM runtime_post_booking.context WHERE key='input1')));
SELECT runtime_post_booking.assert_true(public.crm_v2_post_booking_command('bc211000-0000-4000-8000-000000000001',(SELECT value FROM runtime_post_booking.context WHERE key='input1'))->>'replayed'='true','same request returns original stage receipt');
SELECT runtime_post_booking.expect_error('SELECT public.crm_v2_post_booking_command(''bc211000-0000-4000-8000-000000000001'',(SELECT value FROM runtime_post_booking.context WHERE key=''input1'')||''{"reason":"different"}'')','CRM_POST_BOOKING_IDEMPOTENCY_CONFLICT','same request different payload rejected');
SELECT runtime_post_booking.expect_error('SELECT public.crm_v2_post_booking_command(gen_random_uuid(),(SELECT value FROM runtime_post_booking.context WHERE key=''input1''))','CRM_POST_BOOKING_STALE_STATE','new request with old sale revision rejected');
SELECT runtime_post_booking.expect_error('SELECT public.crm_v2_post_booking_command(gen_random_uuid(),runtime_post_booking.payload(''book1'')||''{"nextStage":"transfer_pending"}'')','CRM_POST_BOOKING_CONFLICT','mortgage cannot bypass loan approval');
SELECT public.crm_v2_post_booking_command(gen_random_uuid(),runtime_post_booking.payload('book1','advance','{"nextStage":"downpayment"}'));
SELECT public.crm_v2_post_booking_command(gen_random_uuid(),runtime_post_booking.payload('book1','advance','{"nextStage":"document_prep"}'));
INSERT INTO runtime_post_booking.context VALUES('submit1',public.crm_v2_post_booking_command(gen_random_uuid(),runtime_post_booking.payload('book1','submit_loan','{"bankName":"SYNTHETIC BANK A"}')));
SELECT runtime_post_booking.expect_error('SELECT public.crm_v2_post_booking_command(gen_random_uuid(),runtime_post_booking.payload(''book1'',''submit_loan'',''{"bankName":"SYNTHETIC BANK B"}''))','CRM_POST_BOOKING_CONFLICT','pending purchase application prevents another submit');
SELECT runtime_post_booking.expect_error('SELECT public.crm_v2_post_booking_command(gen_random_uuid(),runtime_post_booking.payload(''book1'',''loan_result'',jsonb_build_object(''loanAttemptId'',gen_random_uuid(),''result'',''approved'',''approvedAmountSatang'',100000)))','CRM_POST_BOOKING_CONFLICT','result must identify actual latest purchase attempt');
SELECT runtime_post_booking.expect_error('SELECT public.crm_v2_post_booking_command(gen_random_uuid(),runtime_post_booking.payload(''book1'',''loan_result'',jsonb_build_object(''loanAttemptId'',(SELECT value->''loanAttemptId'' FROM runtime_post_booking.context WHERE key=''submit1''),''result'',''approved'',''approvedAmountSatang'',0)))','CRM_POST_BOOKING_INVALID_INPUT','approval cannot silently record zero amount');
SELECT runtime_post_booking.expect_error('SELECT public.crm_v2_post_booking_command(gen_random_uuid(),runtime_post_booking.payload(''book1'',''loan_result'',jsonb_build_object(''loanAttemptId'',(SELECT value->''loanAttemptId'' FROM runtime_post_booking.context WHERE key=''submit1''),''result'',''rejected'',''approvedAmountSatang'',100)))','CRM_POST_BOOKING_INVALID_INPUT','rejection cannot carry approved amount');
SELECT runtime_post_booking.expect_error('SELECT public.crm_v2_post_booking_command(gen_random_uuid(),runtime_post_booking.payload(''book1'',''loan_result'',jsonb_build_object(''loanAttemptId'',(SELECT value->''loanAttemptId'' FROM runtime_post_booking.context WHERE key=''submit1''),''result'',''approved'',''approvedAmountSatang'',10.5)))','CRM_POST_BOOKING_INVALID_INPUT','fractional approval satang rejected');
SELECT runtime_post_booking.expect_error('SELECT public.crm_v2_post_booking_command(gen_random_uuid(),runtime_post_booking.payload(''book1'',''loan_result'',jsonb_build_object(''loanAttemptId'',(SELECT value->''loanAttemptId'' FROM runtime_post_booking.context WHERE key=''submit1''),''result'',''rejected'',''approvedAmountSatang'',NULL,''occurredAt'',to_char((public.crm_v2_post_booking_context((SELECT (value->>''saleId'')::uuid FROM runtime_post_booking.context WHERE key=''book1''))#>>''{latestAttempt,submittedAt}'')::timestamptz-interval ''1 microsecond'',''YYYY-MM-DD"T"HH24:MI:SS.US"Z"''))))','CRM_POST_BOOKING_INVALID_INPUT','bank result cannot predate its actual submission even after booking');
RESET ROLE;
-- Deliberately permissive synthetic legacy permissions: private permit/immutable
-- guards must still deny direct browser purchase writes. All revert on rollback.
GRANT INSERT,UPDATE,DELETE ON public.loan_attempts TO authenticated;
CREATE POLICY runtime_post_booking_legacy_write ON public.loan_attempts FOR ALL TO authenticated USING(true) WITH CHECK(true);
SET LOCAL ROLE authenticated;
SELECT runtime_post_booking.expect_error('UPDATE public.loan_attempts SET result_status=''approved'' WHERE id=(SELECT (value->>''loanAttemptId'')::uuid FROM runtime_post_booking.context WHERE key=''submit1'')','CRM_POST_BOOKING_FORBIDDEN','broad legacy grant cannot forge loan approval');
SELECT runtime_post_booking.expect_error('UPDATE public.loan_attempts SET kind=''preapproval'',sale_id=NULL WHERE id=(SELECT (value->>''loanAttemptId'')::uuid FROM runtime_post_booking.context WHERE key=''submit1'')','CRM_POST_BOOKING_FORBIDDEN','purchase kind-change escape denied');
SELECT runtime_post_booking.expect_error('DELETE FROM public.loan_attempts WHERE id=(SELECT (value->>''loanAttemptId'')::uuid FROM runtime_post_booking.context WHERE key=''submit1'')','CRM_POST_BOOKING_FORBIDDEN','browser cannot delete purchase history');
SELECT runtime_post_booking.expect_error('INSERT INTO sales_private.post_booking_write_permits VALUES(txid_current(),pg_backend_pid())',NULL,'browser cannot create loan write permit');
INSERT INTO public.loan_attempts(project_interest_id,attempt_number,kind,bank_name,recorded_by_user_id)
 SELECT (value->>'interestId')::uuid,1,'preapproval','SYNTHETIC PREAPPROVAL','bc210000-0000-4000-8000-000000000002' FROM runtime_post_booking.context WHERE key='book1';
SELECT runtime_post_booking.assert_true(jsonb_array_length(public.crm_v2_post_booking_context((SELECT (value->>'saleId')::uuid FROM runtime_post_booking.context WHERE key='book1'))->'attempts')=1,'preapproval remains separate from purchase context');
RESET ROLE;
INSERT INTO sales_private.post_booking_write_permits VALUES(txid_current(),pg_backend_pid());
SELECT runtime_post_booking.expect_error('UPDATE public.loan_attempts SET attempt_number=2 WHERE id=(SELECT (value->>''loanAttemptId'')::uuid FROM runtime_post_booking.context WHERE key=''submit1'')','CRM_POST_BOOKING_CONFLICT','purchase attempt identity immutable even with internal permit');
DELETE FROM sales_private.post_booking_write_permits WHERE transaction_id=txid_current();
SET LOCAL ROLE authenticated;
INSERT INTO runtime_post_booking.context VALUES('reject1',public.crm_v2_post_booking_command(gen_random_uuid(),runtime_post_booking.payload('book1','loan_result',
 jsonb_build_object('loanAttemptId',(SELECT value->'loanAttemptId' FROM runtime_post_booking.context WHERE key='submit1'),'result','rejected','approvedAmountSatang',NULL))));
RESET ROLE;
INSERT INTO runtime_post_booking.context SELECT 'rejected-row',to_jsonb(a) FROM public.loan_attempts a WHERE id=(SELECT (value->>'loanAttemptId')::uuid FROM runtime_post_booking.context WHERE key='reject1');
SELECT runtime_post_booking.assert_true((SELECT crm_stage='loan_rejected' AND contract_status='Reserved' AND has_customer
 FROM public.sales s JOIN public.plots p ON p.id=s.plot_id WHERE s.id=(SELECT (value->>'saleId')::uuid FROM runtime_post_booking.context WHERE key='book1')),'loan rejection does not cancel booking or release plot');
INSERT INTO sales_private.post_booking_write_permits VALUES(txid_current(),pg_backend_pid());
SELECT runtime_post_booking.expect_error('UPDATE public.loan_attempts SET result_status=''submitted'' WHERE id=(SELECT (value->>''loanAttemptId'')::uuid FROM runtime_post_booking.context WHERE key=''reject1'')','CRM_POST_BOOKING_CONFLICT','rejected result cannot reset even with internal permit');
SELECT runtime_post_booking.expect_error('DELETE FROM public.loan_attempts WHERE id=(SELECT (value->>''loanAttemptId'')::uuid FROM runtime_post_booking.context WHERE key=''reject1'')','CRM_POST_BOOKING_CONFLICT','purchase history never deleted even with permit');
DELETE FROM sales_private.post_booking_write_permits WHERE transaction_id=txid_current();
SET LOCAL ROLE authenticated;
INSERT INTO runtime_post_booking.context VALUES('submit2',public.crm_v2_post_booking_command(gen_random_uuid(),runtime_post_booking.payload('book1','submit_loan','{"bankName":"SYNTHETIC BANK B"}')));
SELECT runtime_post_booking.assert_true((SELECT value->>'loanAttemptId'<>(SELECT value->>'loanAttemptId' FROM runtime_post_booking.context WHERE key='submit1') FROM runtime_post_booking.context WHERE key='submit2'),'resubmission creates new attempt identity');
INSERT INTO runtime_post_booking.context VALUES('approve2',public.crm_v2_post_booking_command(gen_random_uuid(),runtime_post_booking.payload('book1','loan_result',
 jsonb_build_object('loanAttemptId',(SELECT value->'loanAttemptId' FROM runtime_post_booking.context WHERE key='submit2'),'result','approved','approvedAmountSatang',87654321))));
SELECT runtime_post_booking.expect_error('SELECT public.crm_v2_post_booking_command(gen_random_uuid(),runtime_post_booking.payload(''book1'',''loan_result'',jsonb_build_object(''loanAttemptId'',(SELECT value->''loanAttemptId'' FROM runtime_post_booking.context WHERE key=''submit2''),''result'',''rejected'',''approvedAmountSatang'',NULL)))','CRM_POST_BOOKING_CONFLICT','terminal loan result cannot be replaced by another terminal result');
INSERT INTO runtime_post_booking.context VALUES('pending1',public.crm_v2_post_booking_command(gen_random_uuid(),runtime_post_booking.payload('book1','advance','{"nextStage":"transfer_pending"}')));
INSERT INTO runtime_post_booking.context VALUES('history',public.crm_v2_post_booking_context((SELECT (value->>'saleId')::uuid FROM runtime_post_booking.context WHERE key='book1')));
SELECT runtime_post_booking.assert_true((SELECT value#>>'{sale,stage}'='transfer_pending' AND value#>>'{sale,canEdit}'='true'
 AND jsonb_array_length(value->'events')=8 AND jsonb_array_length(value->'attempts')=2
 AND value#>>'{latestAttempt,attemptNumber}'='2' AND value#>>'{latestAttempt,approvedAmount}'='876543.21' FROM runtime_post_booking.context WHERE key='history'),'mortgage history reaches pending with eight events and two retained loan rounds');
SELECT runtime_post_booking.assert_true((SELECT value->'loanAttemptId'='null'::jsonb FROM runtime_post_booking.context WHERE key='pending1'),'advance receipt does not invent new loan application');
RESET ROLE;
SELECT runtime_post_booking.assert_true((SELECT to_jsonb(a)=(SELECT value FROM runtime_post_booking.context WHERE key='rejected-row') FROM public.loan_attempts a
 WHERE id=(SELECT (value->>'loanAttemptId')::uuid FROM runtime_post_booking.context WHERE key='submit1')),'resubmit and approve leave rejected row byte-for-byte unchanged');
SELECT runtime_post_booking.assert_true((SELECT to_jsonb(s)-ARRAY['crm_stage','booking_revision','contracted_at']=(SELECT value FROM runtime_post_booking.context WHERE key='sale1-before') FROM public.sales s
 WHERE id=(SELECT (value->>'saleId')::uuid FROM runtime_post_booking.context WHERE key='book1')),'post booking leaves prices stock legacy contract status and booking identity unchanged');
SELECT runtime_post_booking.assert_true((SELECT value=jsonb_build_object('customers',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.sales_customers c),
 'interests',(SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM public.lead_project_interests i),'plots',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.plots p)) FROM runtime_post_booking.context WHERE key='unchanged-business'),'post booking does not reset cohort owner interest revision or stock');
SELECT runtime_post_booking.expect_error('UPDATE sales_private.post_booking_events SET evidence_note=''overwrite'' WHERE id=(SELECT (value->>''eventId'')::uuid FROM runtime_post_booking.context WHERE key=''contract1'')','CRM_POST_BOOKING_CONFLICT','stage event immutable even to internal owner');
SELECT runtime_post_booking.expect_error('DELETE FROM sales_private.post_booking_events WHERE id=(SELECT (value->>''eventId'')::uuid FROM runtime_post_booking.context WHERE key=''contract1'')','CRM_POST_BOOKING_CONFLICT','stage event cannot be deleted');
SET LOCAL ROLE authenticated;
SELECT public.crm_v2_post_booking_command(gen_random_uuid(),runtime_post_booking.payload('book2'));
SELECT public.crm_v2_post_booking_command(gen_random_uuid(),runtime_post_booking.payload('book2','advance','{"nextStage":"downpayment"}'));
SELECT runtime_post_booking.expect_error('SELECT public.crm_v2_post_booking_command(gen_random_uuid(),runtime_post_booking.payload(''book2'',''submit_loan'',''{"bankName":"SYNTHETIC BANK"}''))','CRM_POST_BOOKING_CONFLICT','cash purchase cannot create loan');
SELECT public.crm_v2_post_booking_command(gen_random_uuid(),runtime_post_booking.payload('book2','advance','{"nextStage":"transfer_pending"}'));
SELECT public.crm_v2_post_booking_command(gen_random_uuid(),runtime_post_booking.payload('book3'));
SELECT public.crm_v2_post_booking_command(gen_random_uuid(),runtime_post_booking.payload('book3','advance','{"nextStage":"transfer_pending"}'));
SELECT runtime_post_booking.assert_true(public.crm_v2_post_booking_context((SELECT (value->>'saleId')::uuid FROM runtime_post_booking.context WHERE key='book2'))->'latestAttempt'='null'::jsonb,'cash pending has no fake loan attempt');
RESET ROLE;
INSERT INTO sales_private.booking_write_permits VALUES(txid_current(),pg_backend_pid());
UPDATE public.sales SET payment_method=NULL WHERE id=(SELECT (value->>'saleId')::uuid FROM runtime_post_booking.context WHERE key='book4');
UPDATE public.sales SET crm_stage='loan_rejected' WHERE id=(SELECT (value->>'saleId')::uuid FROM runtime_post_booking.context WHERE key='book9');
UPDATE public.sales SET crm_stage='loan_approved' WHERE id=(SELECT (value->>'saleId')::uuid FROM runtime_post_booking.context WHERE key='book10');
DELETE FROM sales_private.booking_write_permits WHERE transaction_id=txid_current();
SET LOCAL ROLE authenticated;
SELECT runtime_post_booking.assert_true(public.crm_v2_post_booking_context((SELECT (value->>'saleId')::uuid FROM runtime_post_booking.context WHERE key='book4'))#>>'{sale,canEdit}'='false','unknown payment stays readable but not editable');
SELECT runtime_post_booking.expect_error('SELECT public.crm_v2_post_booking_command(gen_random_uuid(),runtime_post_booking.payload(''book4''))','CRM_POST_BOOKING_SETUP_REQUIRED','unknown payment never inferred as cash or mortgage');
SELECT runtime_post_booking.expect_error('SELECT public.crm_v2_post_booking_command(gen_random_uuid(),runtime_post_booking.payload(''book9'',''submit_loan'',''{"bankName":"SYNTHETIC BANK"}''))','CRM_POST_BOOKING_SETUP_REQUIRED','loan rejected stage requires actual rejected attempt for resubmission');
SELECT runtime_post_booking.expect_error('SELECT public.crm_v2_post_booking_command(gen_random_uuid(),runtime_post_booking.payload(''book10'',''advance'',''{"nextStage":"transfer_pending"}''))','CRM_POST_BOOKING_SETUP_REQUIRED','loan approved label is not evidence of trusted latest approval');
SELECT set_config('request.jwt.claim.sub','bc210000-0000-4000-8000-000000000003',true);
SELECT runtime_post_booking.assert_true(public.crm_v2_post_booking_context((SELECT (value->>'saleId')::uuid FROM runtime_post_booking.context WHERE key='book6'))#>>'{sale,canEdit}'='false','Owner context read only');
SELECT runtime_post_booking.expect_error('SELECT public.crm_v2_post_booking_command(gen_random_uuid(),runtime_post_booking.payload(''book6''))','CRM_POST_BOOKING_FORBIDDEN','Owner cannot advance status');
SELECT set_config('request.jwt.claim.sub','bc210000-0000-4000-8000-000000000004',true);
SELECT runtime_post_booking.expect_error('SELECT public.crm_v2_post_booking_command(gen_random_uuid(),runtime_post_booking.payload(''book6''))','CRM_POST_BOOKING_FORBIDDEN','other Sales cannot advance somebody elses interest');
SELECT set_config('request.jwt.claim.sub','bc210000-0000-4000-8000-000000000005',true);
SELECT runtime_post_booking.expect_error('SELECT public.crm_v2_post_booking_context((SELECT (value->>''saleId'')::uuid FROM runtime_post_booking.context WHERE key=''book6''))','CRM_POST_BOOKING_FORBIDDEN','inactive caller denied');
SELECT set_config('request.jwt.claim.sub','bc210000-0000-4000-8000-000000000002',true);
INSERT INTO runtime_post_booking.context VALUES('input5',runtime_post_booking.payload('book5'));
SELECT public.crm_v2_post_booking_command('bc211000-0000-4000-8000-000000000005',(SELECT value FROM runtime_post_booking.context WHERE key='input5'));
SELECT public.crm_v2_booking_command(gen_random_uuid(),jsonb_build_object('command','cancel','reason','SYNTHETIC cancellation after contract',
 'customerId',(SELECT value->'customerId' FROM runtime_post_booking.context WHERE key='book5'),'saleId',(SELECT value->'saleId' FROM runtime_post_booking.context WHERE key='book5'),
 'expectedSaleRevision',public.crm_v2_post_booking_context((SELECT (value->>'saleId')::uuid FROM runtime_post_booking.context WHERE key='book5'))#>'{sale,revision}',
 'cancellationCategory','booking_cancelled'));
SELECT runtime_post_booking.assert_true(public.crm_v2_post_booking_command('bc211000-0000-4000-8000-000000000005',(SELECT value FROM runtime_post_booking.context WHERE key='input5'))->>'replayed'='true','same-owner replay after cancellation returns original receipt without reopening');
SELECT runtime_post_booking.assert_true(public.crm_v2_post_booking_context((SELECT (value->>'saleId')::uuid FROM runtime_post_booking.context WHERE key='book5'))#>>'{sale,stage}'='cancelled','post cancellation replay leaves cancelled sale unchanged');
SELECT runtime_post_booking.expect_error('SELECT public.crm_v2_post_booking_command(gen_random_uuid(),runtime_post_booking.payload(''book5''))','CRM_POST_BOOKING_CONFLICT','cancelled sale cannot get new stage commands');
RESET ROLE;
UPDATE public.lead_project_interests SET owner_user_id='bc210000-0000-4000-8000-000000000004',lifecycle_revision=gen_random_uuid()
 WHERE id=(SELECT (value->>'interestId')::uuid FROM runtime_post_booking.context WHERE key='book5');
SET LOCAL ROLE authenticated;
SELECT runtime_post_booking.expect_error('SELECT public.crm_v2_post_booking_command(''bc211000-0000-4000-8000-000000000005'',(SELECT value FROM runtime_post_booking.context WHERE key=''input5''))','CRM_POST_BOOKING_FORBIDDEN','former owner cannot replay historical receipt after reassignment');
RESET ROLE;
-- Failure after sale/loan/event writes must roll the whole command back, including
-- permits; this synthetic audit trigger affects one explicit fake reason only.
CREATE FUNCTION runtime_post_booking.fail_audit() RETURNS trigger LANGUAGE plpgsql AS $fail$
BEGIN
  IF NEW.reason_text='SYNTHETIC INJECT ROLLBACK' THEN RAISE EXCEPTION 'SYNTHETIC_INJECTED_FAILURE'; END IF;
  RETURN NEW;
END;
$fail$;
CREATE TRIGGER runtime_post_booking_fail_audit BEFORE INSERT ON public.crm_audit_events FOR EACH ROW EXECUTE FUNCTION runtime_post_booking.fail_audit();
INSERT INTO runtime_post_booking.context VALUES('before-failure',runtime_post_booking.business_snapshot());
SET LOCAL ROLE authenticated;
SELECT runtime_post_booking.expect_error('SELECT public.crm_v2_post_booking_command(gen_random_uuid(),runtime_post_booking.payload(''book6'')||''{"reason":"SYNTHETIC INJECT ROLLBACK"}'')','SYNTHETIC_INJECTED_FAILURE','late audit failure aborts whole command');
RESET ROLE;
SELECT runtime_post_booking.assert_true(runtime_post_booking.business_snapshot()=(SELECT value FROM runtime_post_booking.context WHERE key='before-failure'),'late failure rolls back sale event audit receipt and both permits');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','bc210000-0000-4000-8000-000000000001',true);
SELECT runtime_post_booking.assert_true(public.crm_v2_post_booking_command(gen_random_uuid(),runtime_post_booking.payload('book6'))->>'stage'='contracted','Admin may advance active Sales-owned interest');
SELECT set_config('request.jwt.claim.sub','bc210000-0000-4000-8000-000000000002',true);
SELECT public.crm_v2_post_booking_command(gen_random_uuid(),runtime_post_booking.payload('book8'));
SELECT public.crm_v2_post_booking_command(gen_random_uuid(),runtime_post_booking.payload('book8','advance','{"nextStage":"document_prep"}'));
RESET ROLE;
INSERT INTO runtime_post_booking.context VALUES('before-loan-failure',runtime_post_booking.business_snapshot());
SET LOCAL ROLE authenticated;
SELECT runtime_post_booking.expect_error('SELECT public.crm_v2_post_booking_command(gen_random_uuid(),runtime_post_booking.payload(''book8'',''submit_loan'',''{"bankName":"SYNTHETIC FAILURE BANK"}'')||''{"reason":"SYNTHETIC INJECT ROLLBACK"}'')','SYNTHETIC_INJECTED_FAILURE','late audit failure after loan insert aborts all work');
RESET ROLE;
SELECT runtime_post_booking.assert_true(runtime_post_booking.business_snapshot()=(SELECT value FROM runtime_post_booking.context WHERE key='before-loan-failure'),'failed loan insert leaves no orphan loan sale event or receipt');
INSERT INTO sales_private.post_booking_write_permits VALUES(txid_current(),pg_backend_pid());
INSERT INTO public.loan_attempts(project_interest_id,sale_id,attempt_number,kind,bank_name,result_status,submitted_at,recorded_by_user_id)
 SELECT (value->>'interestId')::uuid,(value->>'saleId')::uuid,1,'purchase','SYNTHETIC UNRECONCILED PENDING','pending',clock_timestamp(),
 'bc210000-0000-4000-8000-000000000002' FROM runtime_post_booking.context WHERE key='book8';
DELETE FROM sales_private.post_booking_write_permits WHERE transaction_id=txid_current();
SET LOCAL ROLE authenticated;
SELECT runtime_post_booking.expect_error('SELECT public.crm_v2_post_booking_command(gen_random_uuid(),runtime_post_booking.payload(''book8'',''submit_loan'',''{"bankName":"SYNTHETIC NEW BANK"}''))','CRM_POST_BOOKING_CONFLICT','open attempt blocks submit even when old stage incorrectly says document prep');
SELECT public.crm_v2_post_booking_command(gen_random_uuid(),runtime_post_booking.payload('book7'));
SELECT public.crm_v2_post_booking_command(gen_random_uuid(),runtime_post_booking.payload('book7','advance','{"nextStage":"document_prep"}'));
DO $loan_pages$
DECLARE n integer; attempt jsonb;
BEGIN
  FOR n IN 1..51 LOOP
    attempt:=public.crm_v2_post_booking_command(gen_random_uuid(),runtime_post_booking.payload('book7','submit_loan',jsonb_build_object('bankName','SYNTHETIC PAGE BANK '||n)));
    PERFORM public.crm_v2_post_booking_command(gen_random_uuid(),runtime_post_booking.payload('book7','loan_result',jsonb_build_object(
      'loanAttemptId',attempt->'loanAttemptId','result','rejected','approvedAmountSatang',NULL)));
  END LOOP;
END;
$loan_pages$;
INSERT INTO runtime_post_booking.context VALUES('page0',public.crm_v2_post_booking_context((SELECT (value->>'saleId')::uuid FROM runtime_post_booking.context WHERE key='book7'))),
 ('page1',public.crm_v2_post_booking_context((SELECT (value->>'saleId')::uuid FROM runtime_post_booking.context WHERE key='book7'),1,2));
SELECT runtime_post_booking.assert_true((SELECT jsonb_array_length(value->'attempts')=50 AND value->>'attemptsHasMore'='true'
 AND jsonb_array_length(value->'events')=50 AND value->>'eventsHasMore'='true' FROM runtime_post_booking.context WHERE key='page0'),'loan and event lists each bounded fifty with lookahead');
SELECT runtime_post_booking.assert_true((SELECT jsonb_array_length(value->'attempts')=1 AND value->>'attemptsHasMore'='false'
 AND value#>>'{latestAttempt,attemptNumber}'='51' AND value#>>'{attempts,0,attemptNumber}'='1'
 AND jsonb_array_length(value->'events')=4 AND value->>'eventsHasMore'='false' FROM runtime_post_booking.context WHERE key='page1'),'independent pages retain latest attempt regardless of requested history page');
SELECT runtime_post_booking.expect_error('SELECT public.crm_v2_post_booking_context(NULL)','CRM_POST_BOOKING_INVALID_INPUT','null sale read rejected');
SELECT runtime_post_booking.expect_error('SELECT public.crm_v2_post_booking_context(gen_random_uuid())','CRM_POST_BOOKING_NOT_FOUND','unknown sale read rejected');
SELECT runtime_post_booking.expect_error('SELECT public.crm_v2_post_booking_context((SELECT (value->>''saleId'')::uuid FROM runtime_post_booking.context WHERE key=''book1''),-1)','CRM_POST_BOOKING_INVALID_INPUT','negative history page rejected');
SELECT runtime_post_booking.expect_error('SELECT * FROM sales_private.post_booking_events',NULL,'browser cannot read private event table directly');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT runtime_post_booking.expect_error('SELECT public.crm_v2_post_booking_capabilities()',NULL,'anon cannot call capability');
SELECT runtime_post_booking.expect_error('SELECT public.crm_v2_post_booking_context(gen_random_uuid())',NULL,'anon cannot read post booking context');
RESET ROLE;
-- Explicit DATE-only transfer. Historical timestamps below are synthetic source
-- evidence, not backfilled times inferred from the new transfer date.
INSERT INTO sales_private.booking_write_permits VALUES(txid_current(),pg_backend_pid());
UPDATE public.sales SET crm_stage='transfer_pending',booked_at='2024-02-27T00:00:00Z',contracted_at='2024-02-28T17:00:00Z'
 WHERE id IN(SELECT (value->>'saleId')::uuid FROM runtime_post_booking.context WHERE key IN('book11','book13','book14','book15'));
UPDATE public.sales SET crm_stage='transfer_pending',booked_at=NULL,contracted_at=NULL
 WHERE id=(SELECT (value->>'saleId')::uuid FROM runtime_post_booking.context WHERE key='book12');
DELETE FROM sales_private.booking_write_permits WHERE transaction_id=txid_current();
INSERT INTO sales_private.post_booking_write_permits VALUES(txid_current(),pg_backend_pid());
INSERT INTO public.loan_attempts(project_interest_id,sale_id,attempt_number,kind,bank_name,result_status,submitted_at,result_at,result_reason,approved_amount,recorded_by_user_id)
 SELECT (value->>'interestId')::uuid,(value->>'saleId')::uuid,1,'purchase','SYNTHETIC HISTORICAL BANK','approved',
 '2024-02-28T17:00:00Z','2024-02-29T17:00:00Z','SYNTHETIC historical source',900000,'bc210000-0000-4000-8000-000000000002'
 FROM runtime_post_booking.context WHERE key IN('book14','book15');
DELETE FROM sales_private.post_booking_write_permits WHERE transaction_id=txid_current();
INSERT INTO runtime_post_booking.context VALUES('before-transfer',runtime_post_booking.business_snapshot());
SET LOCAL ROLE authenticated;
INSERT INTO runtime_post_booking.context VALUES('report-before-transfer',public.crm_v2_sales_report('SYNTHETIC POST BOOKING'));
INSERT INTO runtime_post_booking.context VALUES('transfer-input1',runtime_post_booking.transfer_payload('book1'));
DO $invalid_dates$
DECLARE bad text;
BEGIN
  FOREACH bad IN ARRAY ARRAY['2023-02-29','2024-02-30','0000-01-01','10000-01-01','2024-2-29','2024-02-29T00:00:00Z','2024-02-29 ','infinity','-infinity','9999-12-31'] LOOP
    PERFORM runtime_post_booking.expect_error(format('SELECT public.crm_v2_post_booking_command(gen_random_uuid(),runtime_post_booking.transfer_payload(''book11'',%L))',bad),
      'CRM_POST_BOOKING_INVALID_INPUT','invalid transfer civil date '||bad);
  END LOOP;
END;
$invalid_dates$;
SELECT runtime_post_booking.expect_error('SELECT public.crm_v2_post_booking_command(gen_random_uuid(),runtime_post_booking.transfer_payload(''book1'')-''transferDate'')','CRM_POST_BOOKING_INVALID_INPUT','transfer requires scalar civil date');
SELECT runtime_post_booking.expect_error('SELECT public.crm_v2_post_booking_command(gen_random_uuid(),runtime_post_booking.transfer_payload(''book1'')||''{"transferDate":null}'')','CRM_POST_BOOKING_INVALID_INPUT','null transfer date rejected');
SELECT runtime_post_booking.expect_error('SELECT public.crm_v2_post_booking_command(gen_random_uuid(),runtime_post_booking.transfer_payload(''book1'')||''{"transferDate":["2024-02-29"]}'')','CRM_POST_BOOKING_INVALID_INPUT','array transfer date rejected');
SELECT runtime_post_booking.expect_error('SELECT public.crm_v2_post_booking_command(gen_random_uuid(),runtime_post_booking.transfer_payload(''book1'')||''{"evidenceNote":"not requested"}'')','CRM_POST_BOOKING_INVALID_INPUT','transfer never accepts declaration metadata');
SELECT runtime_post_booking.expect_error('SELECT public.crm_v2_post_booking_command(gen_random_uuid(),runtime_post_booking.transfer_payload(''book1'')||''{"occurredAt":"2024-02-29T00:00:00Z"}'')','CRM_POST_BOOKING_INVALID_INPUT','transfer never accepts fabricated event time');
SELECT runtime_post_booking.expect_error('SELECT public.crm_v2_post_booking_command(gen_random_uuid(),runtime_post_booking.transfer_payload(''book1'')||''{"reason":" "}'')','CRM_POST_BOOKING_INVALID_INPUT','transfer still requires transition reason');
SELECT runtime_post_booking.expect_error('SELECT public.crm_v2_post_booking_command(gen_random_uuid(),runtime_post_booking.transfer_payload(''book1'',((clock_timestamp() AT TIME ZONE ''Asia/Bangkok'')::date+1)::text))','CRM_POST_BOOKING_INVALID_INPUT','tomorrow Bangkok transfer rejected');
SELECT runtime_post_booking.expect_error('SELECT public.crm_v2_post_booking_command(gen_random_uuid(),runtime_post_booking.transfer_payload(''book1'',''2024-02-29''))','CRM_POST_BOOKING_INVALID_INPUT','transfer before known current booking and events rejected');
SELECT runtime_post_booking.expect_error('SELECT public.crm_v2_post_booking_command(gen_random_uuid(),runtime_post_booking.transfer_payload(''book11'',''2024-02-28''))','CRM_POST_BOOKING_INVALID_INPUT','Bangkok midnight contract is next civil day despite UTC date');
SELECT runtime_post_booking.expect_error('SELECT public.crm_v2_post_booking_command(gen_random_uuid(),runtime_post_booking.transfer_payload(''book15'',''2024-02-29''))','CRM_POST_BOOKING_INVALID_INPUT','Bangkok loan result day bounds transfer independently of contract');
SELECT runtime_post_booking.expect_error('SELECT public.crm_v2_post_booking_command(gen_random_uuid(),runtime_post_booking.transfer_payload(''book13''))','CRM_POST_BOOKING_SETUP_REQUIRED','pending mortgage cannot transfer without trusted approval');
SELECT runtime_post_booking.expect_error('SELECT public.crm_v2_post_booking_command(gen_random_uuid(),runtime_post_booking.transfer_payload(''book14''))','CRM_POST_BOOKING_SETUP_REQUIRED','pending cash with contradictory purchase loan cannot transfer');
SELECT runtime_post_booking.expect_error('SELECT public.crm_v2_post_booking_command(gen_random_uuid(),runtime_post_booking.transfer_payload(''book6''))','CRM_POST_BOOKING_CONFLICT','contracted sale cannot skip to actual transfer');
SELECT runtime_post_booking.expect_error('SELECT public.crm_v2_post_booking_command(gen_random_uuid(),runtime_post_booking.transfer_payload(''book4''))','CRM_POST_BOOKING_SETUP_REQUIRED','unknown method cannot infer transfer eligibility');
SELECT set_config('request.jwt.claim.sub','bc210000-0000-4000-8000-000000000003',true);
SELECT runtime_post_booking.expect_error('SELECT public.crm_v2_post_booking_command(gen_random_uuid(),(SELECT value FROM runtime_post_booking.context WHERE key=''transfer-input1''))','CRM_POST_BOOKING_FORBIDDEN','Owner cannot confirm transfer');
SELECT set_config('request.jwt.claim.sub','bc210000-0000-4000-8000-000000000004',true);
SELECT runtime_post_booking.expect_error('SELECT public.crm_v2_post_booking_command(gen_random_uuid(),(SELECT value FROM runtime_post_booking.context WHERE key=''transfer-input1''))','CRM_POST_BOOKING_FORBIDDEN','other Sales cannot confirm transfer');
SELECT set_config('request.jwt.claim.sub','bc210000-0000-4000-8000-000000000002',true);
SELECT runtime_post_booking.expect_error('SELECT public.crm_v2_post_booking_command(gen_random_uuid(),runtime_post_booking.transfer_payload(''book2'')||''{"reason":"SYNTHETIC INJECT ROLLBACK"}'')','SYNTHETIC_INJECTED_FAILURE','late failure rolls back date-only transfer');
RESET ROLE;
SELECT runtime_post_booking.assert_true(runtime_post_booking.business_snapshot()=(SELECT value FROM runtime_post_booking.context WHERE key='before-transfer'),'invalid and failed transfers change no business row');
UPDATE public.plots SET has_customer=false WHERE id='SYNTHETIC-POST-3';
SET LOCAL ROLE authenticated;
SELECT runtime_post_booking.expect_error('SELECT public.crm_v2_post_booking_command(gen_random_uuid(),runtime_post_booking.transfer_payload(''book3''))','CRM_POST_BOOKING_SETUP_REQUIRED','transfer refuses contradictory vacant plot without repairing stock');
RESET ROLE;
UPDATE public.plots SET has_customer=true WHERE id='SYNTHETIC-POST-3';
SET LOCAL ROLE authenticated;
INSERT INTO runtime_post_booking.context VALUES('transfer1',public.crm_v2_post_booking_command('bc211000-0000-4000-8000-000000000101',(SELECT value FROM runtime_post_booking.context WHERE key='transfer-input1')));
INSERT INTO runtime_post_booking.context VALUES('transfer-history',public.crm_v2_post_booking_context((SELECT (value->>'saleId')::uuid FROM runtime_post_booking.context WHERE key='book1')));
SELECT runtime_post_booking.assert_true((SELECT value#>>'{sale,stage}'='transferred' AND value#>>'{sale,canEdit}'='false'
 AND value#>'{sale,transferDate}'=(SELECT value->'transferDate' FROM runtime_post_booking.context WHERE key='transfer-input1')
 AND jsonb_array_length(value->'events')=9 AND value#>'{events,0,occurredAt}'='null'::jsonb AND value#>'{events,0,evidenceNote}'='null'::jsonb
 AND value#>>'{events,0,command}'='confirm_transfer' AND value#>'{events,0,loanAttemptId}'='null'::jsonb
 AND value#>'{events,0,transferDate}'=value#>'{sale,transferDate}' FROM runtime_post_booking.context WHERE key='transfer-history'),'date-only transfer context has civil date and recorded clock without fake occurrence or evidence');
SELECT runtime_post_booking.assert_true(public.crm_v2_post_booking_command('bc211000-0000-4000-8000-000000000101',(SELECT value FROM runtime_post_booking.context WHERE key='transfer-input1'))=(SELECT value||'{"replayed":true}'::jsonb FROM runtime_post_booking.context WHERE key='transfer1'),'repeated transfer returns same receipt and date');
SELECT runtime_post_booking.expect_error('SELECT public.crm_v2_post_booking_command(''bc211000-0000-4000-8000-000000000101'',(SELECT value FROM runtime_post_booking.context WHERE key=''transfer-input1'')||''{"reason":"changed"}'')','CRM_POST_BOOKING_IDEMPOTENCY_CONFLICT','transfer id cannot be reused with changed reason');
SELECT runtime_post_booking.expect_error('SELECT public.crm_v2_post_booking_command(gen_random_uuid(),runtime_post_booking.transfer_payload(''book1''))','CRM_POST_BOOKING_CONFLICT','fresh request cannot transfer twice');
SELECT runtime_post_booking.expect_error('SELECT public.crm_v2_booking_command(gen_random_uuid(),jsonb_build_object(''command'',''cancel'',''reason'',''SYNTHETIC no reversal'',''customerId'',(SELECT value->''customerId'' FROM runtime_post_booking.context WHERE key=''book1''),''saleId'',(SELECT value->''saleId'' FROM runtime_post_booking.context WHERE key=''book1''),''expectedSaleRevision'',public.crm_v2_post_booking_context((SELECT (value->>''saleId'')::uuid FROM runtime_post_booking.context WHERE key=''book1''))#>''{sale,revision}'',''cancellationCategory'',''booking_cancelled''))','CRM_BOOKING_CONFLICT','booking18 cannot cancel transferred sale or release occupied stock');
INSERT INTO runtime_post_booking.context VALUES('report-after-transfer',public.crm_v2_sales_report('SYNTHETIC POST BOOKING'));
SELECT runtime_post_booking.assert_true((SELECT (value->'totals')-ARRAY['transferred','inProgress']=(SELECT (value->'totals')-ARRAY['transferred','inProgress'] FROM runtime_post_booking.context WHERE key='report-before-transfer')
 AND (value#>>'{totals,transferred}')::int=1 AND (value#>>'{totals,inProgress}')::int=(SELECT (value#>>'{totals,inProgress}')::int-1 FROM runtime_post_booking.context WHERE key='report-before-transfer') FROM runtime_post_booking.context WHERE key='report-after-transfer'),'report20 transfer is subset of existing net bookings not double counted');
RESET ROLE;
SELECT runtime_post_booking.assert_true((SELECT occurred_at IS NULL AND new_values->'transferDate'=(SELECT value->'transferDate' FROM runtime_post_booking.context WHERE key='transfer-input1')
 FROM public.crm_audit_events WHERE entity_id=(SELECT (value->>'saleId')::uuid FROM runtime_post_booking.context WHERE key='book1') AND event_type='post_booking_confirm_transfer'),'audit preserves civil date without inventing occurred timestamp');
SELECT runtime_post_booking.assert_true((SELECT to_jsonb(s)-ARRAY['crm_stage','booking_revision','contract_status','crm_transfer_date']=(SELECT r-ARRAY['crm_stage','booking_revision','contract_status','crm_transfer_date'] FROM jsonb_array_elements((SELECT value->'sales' FROM runtime_post_booking.context WHERE key='before-transfer')) r WHERE r->>'id'=s.id::text)
 AND s.transferred_at IS NULL AND s.contract_status='Transferred' FROM public.sales s WHERE id=(SELECT (value->>'saleId')::uuid FROM runtime_post_booking.context WHERE key='book1')),'transfer changes no price booking identity or legacy transferred timestamp');
SELECT runtime_post_booking.assert_true((SELECT value->'customers'=(runtime_post_booking.business_snapshot())->'customers' AND value->'interests'=(runtime_post_booking.business_snapshot())->'interests'
 AND value->'plots'=(runtime_post_booking.business_snapshot())->'plots' AND value->'loans'=(runtime_post_booking.business_snapshot())->'loans' FROM runtime_post_booking.context WHERE key='before-transfer'),'transfer leaves Lead cohort ownership stock and loan history unchanged');
INSERT INTO sales_private.booking_write_permits VALUES(txid_current(),pg_backend_pid());
SELECT runtime_post_booking.expect_error('UPDATE public.sales SET crm_transfer_date=crm_transfer_date+1 WHERE id=(SELECT (value->>''saleId'')::uuid FROM runtime_post_booking.context WHERE key=''book1'')','CRM_POST_BOOKING_CONFLICT','ordinary18 permit cannot overwrite terminal transfer date');
SELECT runtime_post_booking.expect_error('UPDATE public.sales SET crm_stage=''transfer_pending'',contract_status=''Reserved'' WHERE id=(SELECT (value->>''saleId'')::uuid FROM runtime_post_booking.context WHERE key=''book1'')','CRM_POST_BOOKING_CONFLICT','ordinary18 permit cannot reverse transferred status');
SELECT runtime_post_booking.expect_error('UPDATE public.sales SET crm_transfer_date=current_date,crm_stage=''transferred'',contract_status=''Transferred'' WHERE id=(SELECT (value->>''saleId'')::uuid FROM runtime_post_booking.context WHERE key=''book2'')','CRM_POST_BOOKING_FORBIDDEN','ordinary18 permit cannot forge a transfer');
DELETE FROM sales_private.booking_write_permits WHERE transaction_id=txid_current();
SET LOCAL ROLE authenticated;
SELECT runtime_post_booking.assert_true(public.crm_v2_post_booking_command(gen_random_uuid(),runtime_post_booking.transfer_payload('book11','2024-02-29'))->>'transferDate'='2024-02-29','valid leap date permits same Bangkok contract day without invented ordering');
SELECT runtime_post_booking.assert_true(public.crm_v2_post_booking_command(gen_random_uuid(),runtime_post_booking.transfer_payload('book12','0001-01-01'))->>'transferDate'='0001-01-01','unknown historical booking dates remain unknown and finite earliest CE date valid');
SELECT runtime_post_booking.assert_true(public.crm_v2_post_booking_command(gen_random_uuid(),runtime_post_booking.transfer_payload('book15','2024-03-01'))->>'transferDate'='2024-03-01','same Bangkok approved loan day may transfer without artificial midnight');
SELECT set_config('request.jwt.claim.sub','bc210000-0000-4000-8000-000000000001',true);
SELECT runtime_post_booking.assert_true(public.crm_v2_post_booking_command(gen_random_uuid(),runtime_post_booking.transfer_payload('book2'))->>'stage'='transferred','Admin may confirm Sales-owned cash transfer');
SELECT set_config('request.jwt.claim.sub','bc210000-0000-4000-8000-000000000004',true);
SELECT runtime_post_booking.expect_error('SELECT public.crm_v2_post_booking_command(''bc211000-0000-4000-8000-000000000101'',(SELECT value FROM runtime_post_booking.context WHERE key=''transfer-input1''))','CRM_POST_BOOKING_FORBIDDEN','nonowner cannot replay transfer receipt');
SELECT set_config('request.jwt.claim.sub','bc210000-0000-4000-8000-000000000002',true);
RESET ROLE;
UPDATE public.crm_settings SET post_booking_enabled=false WHERE id;
SET LOCAL ROLE authenticated;
SELECT runtime_post_booking.expect_error('SELECT public.crm_v2_post_booking_command(''bc211000-0000-4000-8000-000000000001'',(SELECT value FROM runtime_post_booking.context WHERE key=''input1''))','CRM_POST_BOOKING_SETUP_REQUIRED','kill switch blocks even saved receipts');
RESET ROLE;
UPDATE public.crm_settings SET post_booking_enabled=true WHERE id;
SELECT runtime_post_booking.assert_true(NOT EXISTS(SELECT 1 FROM sales_private.booking_write_permits) AND NOT EXISTS(SELECT 1 FROM sales_private.post_booking_write_permits),'no reusable permits remain');
INSERT INTO runtime_post_booking.context VALUES('before-read',runtime_post_booking.business_snapshot());
SET LOCAL ROLE authenticated;
INSERT INTO runtime_post_booking.context VALUES('readonly',public.crm_v2_post_booking_context((SELECT (value->>'saleId')::uuid FROM runtime_post_booking.context WHERE key='book1')));
RESET ROLE;
SELECT runtime_post_booking.assert_true(runtime_post_booking.business_snapshot()=(SELECT value FROM runtime_post_booking.context WHERE key='before-read'),'GET leaves all business rows receipts and settings unchanged');
SET TRANSACTION READ ONLY;
SET LOCAL ROLE authenticated;
DO $read_only$
DECLARE result jsonb;
BEGIN
  result:=public.crm_v2_post_booking_context((SELECT (value->>'saleId')::uuid FROM runtime_post_booking.context WHERE key='book1'));
  IF current_setting('transaction_read_only')<>'on' OR result#>>'{sale,stage}'<>'transferred' THEN RAISE EXCEPTION 'READ_ONLY_POST_BOOKING_FAILED'; END IF;
END;
$read_only$;
SELECT 'POST_BOOKING_SNAPSHOT:'||value::text FROM runtime_post_booking.context WHERE key='history';
SELECT 'POST_BOOKING_RESULT:'||value::text FROM runtime_post_booking.context WHERE key='contract1';
SELECT 'POST_BOOKING_INPUT:'||(value||'{"requestId":"bc211000-0000-4000-8000-000000000001"}'::jsonb)::text FROM runtime_post_booking.context WHERE key='input1';
SELECT 'POST_BOOKING_TRANSFER_SNAPSHOT:'||value::text FROM runtime_post_booking.context WHERE key='transfer-history';
SELECT 'POST_BOOKING_TRANSFER_RESULT:'||value::text FROM runtime_post_booking.context WHERE key='transfer1';
SELECT 'POST_BOOKING_TRANSFER_INPUT:'||(value||'{"requestId":"bc211000-0000-4000-8000-000000000101"}'::jsonb)::text FROM runtime_post_booking.context WHERE key='transfer-input1';
SELECT 'POST_BOOKING_RUNTIME:'||jsonb_build_object('suite','post_booking','assertions',(SELECT count(*)+1 FROM runtime_post_booking.assertions),
 'readOnlyTransaction',true,'syntheticOnly',true,'realDatabaseTested',false,'productionCertified',false)::text;
ROLLBACK;
