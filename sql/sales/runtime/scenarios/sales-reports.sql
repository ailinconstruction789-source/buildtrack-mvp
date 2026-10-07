-- SYNTHETIC LOCAL REPORT TESTS ONLY. Everything created or changed rolls back.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $isolation$
BEGIN
  IF current_database() !~ '^buildtrack_sales_runtime_' OR current_setting('buildtrack.synthetic_runtime',true) IS DISTINCT FROM 'on'
    OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet THEN
    RAISE EXCEPTION 'REFUSED: sales report tests require isolated synthetic loopback runner';
  END IF;
END;
$isolation$;
CREATE SCHEMA runtime_sales_reports;
CREATE TABLE runtime_sales_reports.assertions(label text PRIMARY KEY);
CREATE TABLE runtime_sales_reports.context(key text PRIMARY KEY,value jsonb NOT NULL);
GRANT USAGE ON SCHEMA runtime_sales_reports TO authenticated,anon;
GRANT SELECT,INSERT,UPDATE ON runtime_sales_reports.context,runtime_sales_reports.assertions TO authenticated,anon;
CREATE FUNCTION runtime_sales_reports.assert_true(condition boolean,label text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $assert$
BEGIN
  IF condition IS DISTINCT FROM true THEN RAISE EXCEPTION 'ASSERTION FAILED: %',label; END IF;
  INSERT INTO runtime_sales_reports.assertions VALUES(label);
END;
$assert$;
CREATE FUNCTION runtime_sales_reports.expect_error(statement text,expected_message text,label text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $expect$
DECLARE actual_message text;
BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS actual_message=MESSAGE_TEXT;
    IF expected_message IS NOT NULL AND actual_message<>expected_message THEN
      RAISE EXCEPTION 'ASSERTION FAILED: %; expected %, received %',label,expected_message,actual_message;
    END IF;
    INSERT INTO runtime_sales_reports.assertions VALUES(label); RETURN;
  END;
  RAISE EXCEPTION 'ASSERTION FAILED: %; expected error',label;
END;
$expect$;
CREATE FUNCTION runtime_sales_reports.business_snapshot()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $business$
  SELECT jsonb_build_object(
    'legacyLeads',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.leads r),
    'legacyLinks',(SELECT jsonb_agg(to_jsonb(r) ORDER BY legacy_lead_id) FROM public.crm_legacy_lead_links r),
    'customers',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.sales_customers r),
    'interests',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.lead_project_interests r),
    'sales',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.sales r),
    'plots',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.plots r),
    'settings',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.crm_settings r),
    'tasks',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.crm_sla_tasks r),
    'actions',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.crm_next_actions r),
    'notices',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.crm_notifications r),
    'audits',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.crm_audit_events r),
    'receipts',(SELECT jsonb_agg(to_jsonb(r) ORDER BY actor_user_id,request_id) FROM sales_private.booking_command_requests r),
    'permits',(SELECT jsonb_agg(to_jsonb(r) ORDER BY transaction_id) FROM sales_private.booking_write_permits r));
$business$;
REVOKE ALL ON FUNCTION runtime_sales_reports.business_snapshot() FROM PUBLIC;
INSERT INTO auth.users(id) VALUES
 ('bc200000-0000-4000-8000-000000000001'),('bc200000-0000-4000-8000-000000000002'),
 ('bc200000-0000-4000-8000-000000000003'),('bc200000-0000-4000-8000-000000000004'),('bc200000-0000-4000-8000-000000000005');
INSERT INTO sales_private.crm_user_roles(user_id,role,display_name,is_active) VALUES
 ('bc200000-0000-4000-8000-000000000001','admin','SYNTHETIC REPORT ADMIN',true),
 ('bc200000-0000-4000-8000-000000000002','sales','SYNTHETIC REPORT SALES',true),
 ('bc200000-0000-4000-8000-000000000003','owner','SYNTHETIC REPORT OWNER',true),
 ('bc200000-0000-4000-8000-000000000004','sales','SYNTHETIC INACTIVE SALES',false);
INSERT INTO public.projects(name,is_closed) VALUES('SYNTHETIC REPORT A',false),('SYNTHETIC REPORT B',true),('SYNTHETIC REPORT EMPTY',false);
INSERT INTO public.plots(id,project_name,plot_name,has_customer,sale_status)
 SELECT 'SYNTHETIC-REPORT-A-'||n,'SYNTHETIC REPORT A','SYNTHETIC '||n,false,'available' FROM generate_series(1,100) n;
INSERT INTO public.plots(id,project_name,has_customer,sale_status) VALUES('SYNTHETIC-REPORT-B-1','SYNTHETIC REPORT B',false,'available');
INSERT INTO public.crm_settings(id,central_intake_enabled,lead_work_enabled,lead_lifecycle_enabled,booking_enabled,booking_cutover_reviewed)
 VALUES(true,true,true,true,false,false) ON CONFLICT(id) DO UPDATE SET central_intake_enabled=true,lead_work_enabled=true,
 lead_lifecycle_enabled=true,booking_enabled=false,booking_cutover_reviewed=false;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','bc200000-0000-4000-8000-000000000002',true);
SELECT runtime_sales_reports.assert_true(public.crm_v2_sales_reports_capabilities()='{"contract_version":"sales_reports_v1","enabled":false}'::jsonb,'reports inherit disabled booking gate');
SELECT runtime_sales_reports.expect_error('SELECT public.crm_v2_sales_report()','CRM_SALES_REPORTS_SETUP_REQUIRED','disabled reports reject read');
RESET ROLE;
UPDATE public.crm_settings SET booking_enabled=true WHERE id;
SET LOCAL ROLE authenticated;
SELECT runtime_sales_reports.expect_error('SELECT public.crm_v2_sales_report()','CRM_SALES_REPORTS_SETUP_REQUIRED','cutover review gate is required');
RESET ROLE;
UPDATE public.crm_settings SET booking_cutover_reviewed=true WHERE id;
SET LOCAL ROLE authenticated;
SELECT runtime_sales_reports.assert_true(public.crm_v2_sales_reports_capabilities()='{"contract_version":"sales_reports_v1","enabled":true}'::jsonb,'report capability exact version and enabled state');
INSERT INTO runtime_sales_reports.context VALUES('baseline',public.crm_v2_sales_report()),('baseline-september',public.crm_v2_sales_report(NULL,'2026-09-01','2026-09-30'));
SELECT runtime_sales_reports.assert_true(public.crm_v2_sales_report('SYNTHETIC REPORT EMPTY')->'totals'=
 '{"customers":0,"interests":0,"bookingRounds":0,"cancelledRounds":0,"netBookedHomes":0,"inProgress":0,"transferred":0,"knownNetSaleValue":"0.00","unknownNetSaleValueCount":0,"unknownBookedAtRounds":0,"unknownCancelledAtRounds":0}'::jsonb,'empty report has exact zero counts and decimal zero string');
SELECT runtime_sales_reports.assert_true((SELECT count(*)=11 AND bool_and(value='0') FROM jsonb_each_text(public.crm_v2_sales_report('SYNTHETIC REPORT EMPTY')->'stageCounts')),'empty report includes all eleven stages');
RESET ROLE;
-- Four exact Bangkok cohort boundaries; one central-only customer; a leap-day
-- customer; and a merged duplicate that must not add another identity count.
INSERT INTO public.sales_customers(id,customer_name,phone,owner_user_id,created_by_user_id,lead_created_at,monthly_income,personal_data)
 SELECT ('bc201000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'SYNTHETIC REPORT PRIVATE CUSTOMER '||n,'08920000'||lpad(n::text,2,'0'),
 'bc200000-0000-4000-8000-000000000002','bc200000-0000-4000-8000-000000000001',
 CASE n WHEN 1 THEN TIMESTAMPTZ '2026-08-31 17:00:00+00' WHEN 2 THEN TIMESTAMPTZ '2026-08-31 16:59:59.999999+00'
 WHEN 3 THEN TIMESTAMPTZ '2026-09-30 16:59:59.999999+00' WHEN 4 THEN TIMESTAMPTZ '2026-09-30 17:00:00+00'
 WHEN 6 THEN TIMESTAMPTZ '2026-09-10 00:00:00+00' WHEN 7 THEN TIMESTAMPTZ '2024-02-29 00:00:00+00'
 ELSE TIMESTAMPTZ '2026-09-10 00:00:00+00' END,999999,'{"SYNTHETIC_PRIVATE":"never expose"}'::jsonb
 FROM unnest(ARRAY[1,2,3,4,6,7,8]) n;
UPDATE public.sales_customers SET merged_into_customer_id='bc201000-0000-4000-8000-000000000001' WHERE id='bc201000-0000-4000-8000-000000000008';
INSERT INTO public.leads(id,phone) VALUES('bc201000-0000-4000-8000-000000000009','000-000-0000');
INSERT INTO public.sales_customers(id,customer_name,record_origin,legacy_source_lead_id,phone,phone_data_status,intake_status,
 owner_user_id,created_by_user_id,lead_created_at)
 VALUES('bc201000-0000-4000-8000-000000000005','SYNTHETIC REPORT UNKNOWN','legacy_import','bc201000-0000-4000-8000-000000000009',NULL,
 'unknown_legacy','legacy_unclassified','bc200000-0000-4000-8000-000000000002','bc200000-0000-4000-8000-000000000001',NULL);
INSERT INTO public.lead_project_interests(id,customer_id,project_name,owner_user_id,created_by_user_id)
 SELECT ('bc202000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('bc201000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 'SYNTHETIC REPORT A','bc200000-0000-4000-8000-000000000002','bc200000-0000-4000-8000-000000000001' FROM unnest(ARRAY[1,2,3,4,5,7]) n;
INSERT INTO public.lead_project_interests(id,customer_id,project_name,owner_user_id,created_by_user_id)
 VALUES('bc202000-0000-4000-8000-000000000008','bc201000-0000-4000-8000-000000000001','SYNTHETIC REPORT B','bc200000-0000-4000-8000-000000000002','bc200000-0000-4000-8000-000000000001');
INSERT INTO public.crm_legacy_lead_links(legacy_lead_id,customer_id,project_interest_id,resolution_note)
 VALUES('bc201000-0000-4000-8000-000000000009','bc201000-0000-4000-8000-000000000005','bc202000-0000-4000-8000-000000000005',
 'SYNTHETIC reviewed historical identity and interest mapping');
INSERT INTO sales_private.booking_write_permits VALUES(txid_current(),pg_backend_pid());
INSERT INTO public.sales(id,project_interest_id,plot_id,booking_round,previous_sale_id,crm_stage,booking_route,booking_route_reason,
 contract_status,booked_at,cancelled_at,cancellation_category,cancellation_reason,sale_price,payment_method)
 SELECT ('bc203000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'bc202000-0000-4000-8000-000000000001',
 CASE WHEN n>=14 THEN NULL WHEN n=2 THEN 'SYNTHETIC-REPORT-A-1' ELSE 'SYNTHETIC-REPORT-A-'||n END,n,
 CASE WHEN n=2 THEN 'bc203000-0000-4000-8000-000000000001'::uuid ELSE NULL END,
 CASE n WHEN 1 THEN 'cancelled' WHEN 2 THEN 'booked' WHEN 3 THEN 'booked' WHEN 4 THEN 'booked' WHEN 5 THEN 'transferred' WHEN 6 THEN 'handover'
 WHEN 7 THEN 'contracted' WHEN 8 THEN 'downpayment' WHEN 9 THEN 'document_prep' WHEN 10 THEN 'loan_submitted' WHEN 11 THEN 'loan_rejected'
 WHEN 12 THEN 'loan_approved' WHEN 13 THEN 'transfer_pending' ELSE 'cancelled' END,'legacy_import','SYNTHETIC proven source',
 CASE WHEN n=1 OR n>=14 THEN 'Cancelled' ELSE 'Reserved' END,
 CASE WHEN n=4 THEN NULL WHEN n=2 THEN TIMESTAMPTZ '2027-01-01 00:00:00+00' ELSE TIMESTAMPTZ '2025-01-01 00:00:00+00' END,
 CASE WHEN n=1 OR n>=14 THEN TIMESTAMPTZ '2025-02-01 00:00:00+00' ELSE NULL END,
 CASE WHEN n=1 OR n>=14 THEN 'other' ELSE NULL END,CASE WHEN n=1 OR n>=14 THEN 'SYNTHETIC cancellation' ELSE NULL END,
 CASE n WHEN 2 THEN 10.10 WHEN 3 THEN 0 WHEN 4 THEN NULL WHEN 5 THEN 20.20 WHEN 6 THEN 30.30 WHEN 7 THEN 40.40 WHEN 8 THEN 50.50
 WHEN 9 THEN 60.60 WHEN 10 THEN 70.70 WHEN 11 THEN 80.80 WHEN 12 THEN 90.90 WHEN 13 THEN 100.10 ELSE 999999 END,'cash'
 FROM generate_series(1,64) n;
INSERT INTO public.sales(id,project_interest_id,plot_id,booking_round,crm_stage,booking_route,booking_route_reason,contract_status,booked_at,sale_price)
 SELECT ('bc204000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('bc202000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 'SYNTHETIC-REPORT-A-'||(n+70),1,CASE WHEN n=3 THEN 'transferred' ELSE 'booked' END,'legacy_import','SYNTHETIC evidence','Reserved',
 TIMESTAMPTZ '2026-09-15 00:00:00+00',n*100 FROM generate_series(2,4) n;
INSERT INTO public.sales(id,project_interest_id,plot_id,booking_round,crm_stage,booking_route,booking_route_reason,contract_status,booked_at,sale_price)
 VALUES('bc204000-0000-4000-8000-000000000008','bc202000-0000-4000-8000-000000000008','SYNTHETIC-REPORT-B-1',1,'booked','legacy_import',
 'SYNTHETIC closed project evidence','Reserved',TIMESTAMPTZ '2025-01-01 00:00:00+00',1000);
-- One-statement circular evidence seed respects immediate FKs and immutable18.
INSERT INTO public.crm_import_batches(id,source_name,file_hash,mapping_version,created_by_admin_id)
 VALUES('bc205000-0000-4000-8000-000000000001','SYNTHETIC REPORT SOURCE','SYNTHETIC REPORT HASH','SYNTHETIC-v1','bc200000-0000-4000-8000-000000000001');
WITH seeded_sale AS (
 INSERT INTO public.sales(id,project_interest_id,booking_round,crm_stage,booking_route,booking_route_reason,contract_status,legacy_cancellation_batch_id)
 VALUES('bc205000-0000-4000-8000-000000000002','bc202000-0000-4000-8000-000000000005',1,'cancelled','legacy_import',
 'SYNTHETIC proven old cancellation','Cancelled','bc205000-0000-4000-8000-000000000001') RETURNING id
)
INSERT INTO sales_private.crm_legacy_source_snapshots(import_batch_id,legacy_sale_id,source_payload)
 SELECT 'bc205000-0000-4000-8000-000000000001',id,jsonb_build_object('id',id,'contract_status','Cancelled') FROM seeded_sale;
DELETE FROM sales_private.booking_write_permits WHERE transaction_id=txid_current();
SET LOCAL ROLE authenticated;
INSERT INTO runtime_sales_reports.context VALUES('all',public.crm_v2_sales_report()),('project',public.crm_v2_sales_report('SYNTHETIC REPORT A')),
 ('september',public.crm_v2_sales_report('SYNTHETIC REPORT A','2026-09-01','2026-09-30')),
 ('all-september',public.crm_v2_sales_report(NULL,'2026-09-01','2026-09-30'));
SELECT runtime_sales_reports.assert_true((SELECT value->'totals'=
 '{"customers":6,"interests":6,"bookingRounds":68,"cancelledRounds":53,"netBookedHomes":15,"inProgress":12,"transferred":3,"knownNetSaleValue":"1454.60","unknownNetSaleValueCount":1,"unknownBookedAtRounds":2,"unknownCancelledAtRounds":1}'::jsonb
 FROM runtime_sales_reports.context WHERE key='project'),'all project rounds aggregate beyond first fifty with zero and unknown money distinguished');
SELECT runtime_sales_reports.assert_true((SELECT value->'totals'=
 '{"customers":2,"interests":2,"bookingRounds":65,"cancelledRounds":52,"netBookedHomes":13,"inProgress":10,"transferred":3,"knownNetSaleValue":"854.60","unknownNetSaleValueCount":1,"unknownBookedAtRounds":1,"unknownCancelledAtRounds":0}'::jsonb
 FROM runtime_sales_reports.context WHERE key='september'),'cohort includes exact Bangkok boundaries and every sale regardless of booked month');
SELECT runtime_sales_reports.assert_true((SELECT value->'stageCounts'=
 '{"booked":5,"contracted":1,"downpayment":1,"document_prep":1,"loan_submitted":1,"loan_rejected":1,"loan_approved":1,"transfer_pending":1,"transferred":2,"handover":1,"cancelled":53}'::jsonb
 FROM runtime_sales_reports.context WHERE key='project'),'each of eleven stages counted independently without combining rejected loan and cancellation');
SELECT runtime_sales_reports.assert_true((SELECT (a.value#>>'{totals,customers}')::bigint=(b.value#>>'{totals,customers}')::bigint+7
 AND (a.value#>>'{totals,interests}')::bigint=(b.value#>>'{totals,interests}')::bigint+7
 AND (a.value#>>'{totals,bookingRounds}')::bigint=(b.value#>>'{totals,bookingRounds}')::bigint+69
 AND (a.value#>>'{totals,netBookedHomes}')::bigint=(b.value#>>'{totals,netBookedHomes}')::bigint+16
 AND (a.value#>>'{totals,knownNetSaleValue}')::numeric=(b.value#>>'{totals,knownNetSaleValue}')::numeric+2454.60
 FROM runtime_sales_reports.context a CROSS JOIN runtime_sales_reports.context b WHERE a.key='all' AND b.key='baseline'),'all-company count deduplicates multi-project customer and includes central-only leads');
SELECT runtime_sales_reports.assert_true((SELECT (a.value#>>'{totals,customers}')::bigint=(b.value#>>'{totals,customers}')::bigint+3
 AND (a.value#>>'{totals,interests}')::bigint=(b.value#>>'{totals,interests}')::bigint+3
 AND (a.value#>>'{totals,bookingRounds}')::bigint=(b.value#>>'{totals,bookingRounds}')::bigint+66
 AND (a.value#>>'{totals,knownNetSaleValue}')::numeric=(b.value#>>'{totals,knownNetSaleValue}')::numeric+1854.60
 FROM runtime_sales_reports.context a CROSS JOIN runtime_sales_reports.context b WHERE a.key='all-september' AND b.key='baseline-september'),'company cohort keeps zero-project lead and does not duplicate customer across two interests');
SELECT runtime_sales_reports.assert_true((SELECT value->'coverage'='{"unknownLeadDateCustomers":1,"excludedUnknownLeadDateCustomers":0}'::jsonb FROM runtime_sales_reports.context WHERE key='project'),'all-date report includes unknown cohort and reports evidence gap');
SELECT runtime_sales_reports.assert_true((SELECT value->'coverage'='{"unknownLeadDateCustomers":1,"excludedUnknownLeadDateCustomers":1}'::jsonb FROM runtime_sales_reports.context WHERE key='september'),'ranged report exposes excluded unknown-date customers before filtering');
SELECT runtime_sales_reports.assert_true(public.crm_v2_sales_report('SYNTHETIC REPORT A','2026-09-01','2026-09-01')#>>'{totals,bookingRounds}'='64','inclusive first day contains all rounds for same original Lead');
SELECT runtime_sales_reports.assert_true(public.crm_v2_sales_report('SYNTHETIC REPORT A','2026-09-30','2026-09-30')#>>'{totals,bookingRounds}'='1','inclusive final day includes last local microsecond');
SELECT runtime_sales_reports.assert_true(public.crm_v2_sales_report('SYNTHETIC REPORT A','2026-08-31','2026-08-31')#>>'{totals,knownNetSaleValue}'='200.00','one microsecond before Bangkok month start belongs to prior day');
SELECT runtime_sales_reports.assert_true(public.crm_v2_sales_report('SYNTHETIC REPORT A','2026-10-01','2026-10-01')#>>'{totals,knownNetSaleValue}'='400.00','Bangkok next-month midnight excluded from prior month');
SELECT runtime_sales_reports.assert_true(public.crm_v2_sales_report('SYNTHETIC REPORT A','2024-02-29','2024-02-29')#>>'{totals,customers}'='1','valid leap day includes interested customer without booking');
SELECT runtime_sales_reports.assert_true(public.crm_v2_sales_report('SYNTHETIC REPORT A','0001-01-01','9999-12-31')#>>'{totals,customers}'='5','full CE range accepted but unknown date still excluded');
SELECT runtime_sales_reports.assert_true(public.crm_v2_sales_report('SYNTHETIC REPORT B')#>>'{totals,knownNetSaleValue}'='1000.00','closed project history still aggregates');
SELECT runtime_sales_reports.assert_true((SELECT value::text NOT LIKE '%PRIVATE%' AND value::text NOT LIKE '%089200%'
 AND NOT(value ?| ARRAY['customers','rows','salesOwners','scores','kpi','agents']) FROM runtime_sales_reports.context WHERE key='project'),'report contains aggregates and project labels only no customer or staff details');
DO $date_inputs$
DECLARE bad text;
BEGIN
  FOREACH bad IN ARRAY ARRAY['','2026-02-29','2025-02-29','1900-02-29','2026-04-31','2026-13-01','2026-00-01','2026-01-00',
    '0000-01-01','10000-01-01','2569/09/01','2026-9-01',' 2026-09-01','2026-09-01 ','2026-09-01T00:00:00Z','infinity','today'] LOOP
    PERFORM runtime_sales_reports.expect_error(format('SELECT public.crm_v2_sales_report(''SYNTHETIC REPORT A'',%L,''9999-12-31'')',bad),
      'CRM_SALES_REPORTS_INVALID_INPUT','reject malformed cohort date: '||bad);
  END LOOP;
END;
$date_inputs$;
SELECT runtime_sales_reports.expect_error('SELECT public.crm_v2_sales_report(NULL,''2026-09-01'',NULL)','CRM_SALES_REPORTS_INVALID_INPUT','from-only range rejected');
SELECT runtime_sales_reports.expect_error('SELECT public.crm_v2_sales_report(NULL,NULL,''2026-09-30'')','CRM_SALES_REPORTS_INVALID_INPUT','to-only range rejected');
SELECT runtime_sales_reports.expect_error('SELECT public.crm_v2_sales_report(NULL,''2026-09-30'',''2026-09-01'')','CRM_SALES_REPORTS_INVALID_INPUT','reversed range rejected');
SELECT runtime_sales_reports.expect_error('SELECT public.crm_v2_sales_report(''SYNTHETIC REPORT MISSING'')','CRM_SALES_REPORTS_NOT_FOUND','unknown project rejected');
SELECT runtime_sales_reports.expect_error('SELECT public.crm_v2_sales_report(''SYNTHETIC REPORT A '')','CRM_SALES_REPORTS_NOT_FOUND','project identity remains exact');
SELECT runtime_sales_reports.expect_error('SELECT public.crm_v2_sales_report(chr(10)||''SYNTHETIC REPORT A'')','CRM_SALES_REPORTS_INVALID_INPUT','project control characters rejected');
SELECT runtime_sales_reports.expect_error('SELECT public.crm_v2_sales_report(repeat(''x'',201))','CRM_SALES_REPORTS_INVALID_INPUT','overlong project rejected');
SELECT set_config('request.jwt.claim.sub','bc200000-0000-4000-8000-000000000003',true);
SELECT runtime_sales_reports.assert_true(public.crm_v2_sales_report('SYNTHETIC REPORT A')#>>'{actor,role}'='owner','Owner may read aggregate report');
SELECT set_config('request.jwt.claim.sub','bc200000-0000-4000-8000-000000000001',true);
SELECT runtime_sales_reports.assert_true(public.crm_v2_sales_report('SYNTHETIC REPORT A')#>>'{actor,role}'='admin','Admin may read aggregate report');
SELECT set_config('request.jwt.claim.sub','bc200000-0000-4000-8000-000000000004',true);
SELECT runtime_sales_reports.expect_error('SELECT public.crm_v2_sales_report()','CRM_SALES_REPORTS_FORBIDDEN','inactive caller rejected');
SELECT set_config('request.jwt.claim.sub','bc200000-0000-4000-8000-000000000005',true);
SELECT runtime_sales_reports.expect_error('SELECT public.crm_v2_sales_report()','CRM_SALES_REPORTS_FORBIDDEN','unmapped caller rejected');
SELECT set_config('request.jwt.claim.sub','',true);
SELECT runtime_sales_reports.expect_error('SELECT public.crm_v2_sales_report()','CRM_SALES_REPORTS_FORBIDDEN','missing actor rejected');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT runtime_sales_reports.expect_error('SELECT public.crm_v2_sales_report()',NULL,'anon denied aggregate RPC');
SELECT runtime_sales_reports.expect_error('SELECT public.crm_v2_sales_reports_capabilities()',NULL,'anon denied capability RPC');
RESET ROLE;
-- No-booking legacy Leads must not vanish from a seemingly complete denominator.
-- The same phone as a known customer is deliberately NOT an identity mapping.
INSERT INTO public.leads(id,phone) VALUES('bc206000-0000-4000-8000-000000000002','0892000001');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','bc200000-0000-4000-8000-000000000001',true);
SELECT runtime_sales_reports.expect_error('SELECT public.crm_v2_sales_report()','CRM_SALES_REPORTS_SETUP_REQUIRED','unbooked legacy Lead with matching phone still requires reviewed link');
SELECT runtime_sales_reports.expect_error('SELECT public.crm_v2_sales_report(''SYNTHETIC REPORT EMPTY'',''1901-01-01'',''1901-01-01'')','CRM_SALES_REPORTS_SETUP_REQUIRED','unclassifiable unbooked legacy identity gap blocks all project and date scopes');
RESET ROLE;
INSERT INTO public.crm_legacy_lead_links(legacy_lead_id,customer_id,resolution_note)
 VALUES('bc206000-0000-4000-8000-000000000002','bc201000-0000-4000-8000-000000000008','SYNTHETIC deliberately stale merged identity');
SET LOCAL ROLE authenticated;
SELECT runtime_sales_reports.expect_error('SELECT public.crm_v2_sales_report(''SYNTHETIC REPORT B'')','CRM_SALES_REPORTS_SETUP_REQUIRED','legacy link to merged identity blocks global denominator');
RESET ROLE;
UPDATE public.crm_legacy_lead_links SET customer_id='bc201000-0000-4000-8000-000000000006',resolution_note='SYNTHETIC reviewed central-only identity'
 WHERE legacy_lead_id='bc206000-0000-4000-8000-000000000002';
SET LOCAL ROLE authenticated;
SELECT runtime_sales_reports.assert_true(public.crm_v2_sales_report('SYNTHETIC REPORT A')#>>'{totals,bookingRounds}'='68','reviewed central-only legacy mapping restores complete reports without inventing interest');
RESET ROLE;
DELETE FROM public.crm_legacy_lead_links WHERE legacy_lead_id='bc206000-0000-4000-8000-000000000002';
DELETE FROM public.leads WHERE id='bc206000-0000-4000-8000-000000000002';
DELETE FROM public.crm_legacy_lead_links WHERE legacy_lead_id='bc201000-0000-4000-8000-000000000009';
SET LOCAL ROLE authenticated;
SELECT runtime_sales_reports.expect_error('SELECT public.crm_v2_sales_report(''SYNTHETIC REPORT B'')','CRM_SALES_REPORTS_SETUP_REQUIRED','legacy_source_lead_id alone does not substitute for reviewed mapping');
RESET ROLE;
INSERT INTO public.crm_legacy_lead_links(legacy_lead_id,customer_id,project_interest_id,resolution_note)
 VALUES('bc201000-0000-4000-8000-000000000009','bc201000-0000-4000-8000-000000000005','bc202000-0000-4000-8000-000000000005',
 'SYNTHETIC reviewed historical identity and interest mapping');
UPDATE public.sales_customers SET merged_into_customer_id='bc201000-0000-4000-8000-000000000006' WHERE id='bc201000-0000-4000-8000-000000000007';
SET LOCAL ROLE authenticated;
SELECT runtime_sales_reports.expect_error('SELECT public.crm_v2_sales_report(''SYNTHETIC REPORT A'',''2026-09-01'',''2026-09-30'')','CRM_SALES_REPORTS_SETUP_REQUIRED','merged customer with unbooked orphan interest fails before cohort');
SELECT runtime_sales_reports.expect_error('SELECT public.crm_v2_sales_report()','CRM_SALES_REPORTS_SETUP_REQUIRED','unbooked orphan interest blocks all-company count');
SELECT runtime_sales_reports.assert_true(public.crm_v2_sales_report('SYNTHETIC REPORT B')#>>'{totals,bookingRounds}'='1','classified orphan interest does not contaminate unrelated project scope');
RESET ROLE;
UPDATE public.sales_customers SET merged_into_customer_id=NULL WHERE id='bc201000-0000-4000-8000-000000000007';
-- Incomplete data outside a selected cohort still blocks misleading totals.
INSERT INTO public.sales(id,plot_id,contract_status) VALUES('bc206000-0000-4000-8000-000000000001','SYNTHETIC-REPORT-A-100','Reserved');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','bc200000-0000-4000-8000-000000000001',true);
SELECT runtime_sales_reports.expect_error('SELECT public.crm_v2_sales_report(''SYNTHETIC REPORT A'',''1901-01-01'',''1901-01-01'')','CRM_SALES_REPORTS_SETUP_REQUIRED','unlinked legacy sale cannot hide outside cohort');
SELECT runtime_sales_reports.expect_error('SELECT public.crm_v2_sales_report()','CRM_SALES_REPORTS_SETUP_REQUIRED','all-company report rejects any unlinked sale');
SELECT runtime_sales_reports.assert_true(public.crm_v2_sales_report('SYNTHETIC REPORT B')#>>'{totals,bookingRounds}'='1','known other-project gap does not block selected project');
RESET ROLE;
UPDATE public.sales SET plot_id=NULL WHERE id='bc206000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT runtime_sales_reports.expect_error('SELECT public.crm_v2_sales_report(''SYNTHETIC REPORT B'')','CRM_SALES_REPORTS_SETUP_REQUIRED','unknown legacy plot makes assignment gap global');
RESET ROLE;
DELETE FROM public.sales WHERE id='bc206000-0000-4000-8000-000000000001';
UPDATE public.plots SET project_name='SYNTHETIC REPORT B' WHERE id='SYNTHETIC-REPORT-A-72';
SET LOCAL ROLE authenticated;
SELECT runtime_sales_reports.expect_error('SELECT public.crm_v2_sales_report(''SYNTHETIC REPORT A'',''2026-09-01'',''2026-09-30'')','CRM_SALES_REPORTS_SETUP_REQUIRED','outside-cohort plot mismatch blocks original project');
SELECT runtime_sales_reports.expect_error('SELECT public.crm_v2_sales_report(''SYNTHETIC REPORT B'')','CRM_SALES_REPORTS_SETUP_REQUIRED','plot mismatch blocks receiving project');
RESET ROLE;
UPDATE public.plots SET project_name='SYNTHETIC REPORT A' WHERE id='SYNTHETIC-REPORT-A-72';
UPDATE public.sales_customers SET lead_created_at='infinity'::timestamptz WHERE id='bc201000-0000-4000-8000-000000000002';
SET LOCAL ROLE authenticated;
SELECT runtime_sales_reports.expect_error('SELECT public.crm_v2_sales_report(''SYNTHETIC REPORT A'',''2026-09-01'',''2026-09-30'')','CRM_SALES_REPORTS_SETUP_REQUIRED','nonfinite original Lead evidence fails before cohort');
RESET ROLE;
UPDATE public.sales_customers SET lead_created_at=TIMESTAMPTZ '2026-08-31 16:59:59.999999+00' WHERE id='bc201000-0000-4000-8000-000000000002';
INSERT INTO sales_private.booking_write_permits VALUES(txid_current(),pg_backend_pid());
UPDATE public.sales SET sale_price='NaN'::numeric WHERE id='bc204000-0000-4000-8000-000000000002';
DELETE FROM sales_private.booking_write_permits WHERE transaction_id=txid_current();
SET LOCAL ROLE authenticated;
SELECT runtime_sales_reports.expect_error('SELECT public.crm_v2_sales_report(''SYNTHETIC REPORT A'',''2026-09-01'',''2026-09-30'')','CRM_SALES_REPORTS_SETUP_REQUIRED','nonfinite known sale value cannot silently enter totals');
RESET ROLE;
INSERT INTO sales_private.booking_write_permits VALUES(txid_current(),pg_backend_pid());
UPDATE public.sales SET sale_price=-1 WHERE id='bc204000-0000-4000-8000-000000000002';
DELETE FROM sales_private.booking_write_permits WHERE transaction_id=txid_current();
SET LOCAL ROLE authenticated;
SELECT runtime_sales_reports.expect_error('SELECT public.crm_v2_sales_report(''SYNTHETIC REPORT A'')','CRM_SALES_REPORTS_SETUP_REQUIRED','negative legacy known price is review-required not zero');
RESET ROLE;
INSERT INTO sales_private.booking_write_permits VALUES(txid_current(),pg_backend_pid());
UPDATE public.sales SET sale_price=200 WHERE id='bc204000-0000-4000-8000-000000000002';
DELETE FROM sales_private.booking_write_permits WHERE transaction_id=txid_current();
UPDATE public.sales_customers SET merged_into_customer_id='bc201000-0000-4000-8000-000000000006' WHERE id='bc201000-0000-4000-8000-000000000002';
SET LOCAL ROLE authenticated;
SELECT runtime_sales_reports.expect_error('SELECT public.crm_v2_sales_report(''SYNTHETIC REPORT A'',''2026-09-01'',''2026-09-30'')','CRM_SALES_REPORTS_SETUP_REQUIRED','merged customer sale requires reviewed identity relink');
RESET ROLE;
UPDATE public.sales_customers SET merged_into_customer_id=NULL WHERE id='bc201000-0000-4000-8000-000000000002';
UPDATE sales_private.crm_user_roles SET is_active=false WHERE user_id='bc200000-0000-4000-8000-000000000002';
SET LOCAL ROLE authenticated;
SELECT runtime_sales_reports.assert_true(public.crm_v2_sales_report('SYNTHETIC REPORT A')#>>'{totals,bookingRounds}'='68','historical inactive Sales owner does not erase history');
RESET ROLE;
UPDATE sales_private.crm_user_roles SET role='owner' WHERE user_id='bc200000-0000-4000-8000-000000000002';
SET LOCAL ROLE authenticated;
SELECT runtime_sales_reports.expect_error('SELECT public.crm_v2_sales_report(''SYNTHETIC REPORT A'')','CRM_SALES_REPORTS_SETUP_REQUIRED','invalid interest-owner mapping blocks totals');
RESET ROLE;
UPDATE sales_private.crm_user_roles SET role='sales',is_active=true WHERE user_id='bc200000-0000-4000-8000-000000000002';
INSERT INTO public.projects(name,is_closed) SELECT 'SYNTHETIC REPORT LIMIT '||n,false FROM generate_series(1,1001) n;
SET LOCAL ROLE authenticated;
SELECT runtime_sales_reports.expect_error('SELECT public.crm_v2_sales_report()','CRM_SALES_REPORTS_SETUP_REQUIRED','more than one thousand projects fails closed instead of truncating');
RESET ROLE;
DELETE FROM public.projects WHERE name LIKE 'SYNTHETIC REPORT LIMIT %';
UPDATE public.crm_settings SET lead_lifecycle_enabled=false WHERE id;
SET LOCAL ROLE authenticated;
SELECT runtime_sales_reports.expect_error('SELECT public.crm_v2_sales_report()','CRM_SALES_REPORTS_SETUP_REQUIRED','dependency kill switch closes aggregate reads');
RESET ROLE;
UPDATE public.crm_settings SET lead_lifecycle_enabled=true WHERE id;
INSERT INTO runtime_sales_reports.context VALUES('before',runtime_sales_reports.business_snapshot());
SET LOCAL ROLE authenticated;
SELECT runtime_sales_reports.expect_error('SELECT * FROM sales_private.crm_legacy_source_snapshots',NULL,'report grants no raw legacy snapshot access');
SELECT runtime_sales_reports.expect_error('SELECT * FROM public.sales',NULL,'report grants no raw legacy sale access');
INSERT INTO runtime_sales_reports.context VALUES('readonly',public.crm_v2_sales_report('SYNTHETIC REPORT A','2026-09-01','2026-09-30'));
RESET ROLE;
SELECT runtime_sales_reports.assert_true(runtime_sales_reports.business_snapshot()=(SELECT value FROM runtime_sales_reports.context WHERE key='before'),'report reads leave all business data stock settings receipts and work unchanged');
SET TRANSACTION READ ONLY;
SET LOCAL ROLE authenticated;
DO $read_only$
DECLARE result jsonb;
BEGIN
  result:=public.crm_v2_sales_report('SYNTHETIC REPORT A','2026-09-01','2026-09-30');
  IF current_setting('transaction_read_only')<>'on' OR result#>>'{totals,bookingRounds}'<>'65'
    OR result#>>'{totals,knownNetSaleValue}'<>'854.60' THEN RAISE EXCEPTION 'READ_ONLY_SALES_REPORT_FAILED'; END IF;
END;
$read_only$;
SELECT 'SALES_REPORTS_SNAPSHOT:'||value::text FROM runtime_sales_reports.context WHERE key='september';
SELECT 'SALES_REPORTS_RUNTIME:'||jsonb_build_object('suite','sales_reports','assertions',(SELECT count(*)+1 FROM runtime_sales_reports.assertions),
 'readOnlyTransaction',true,'syntheticOnly',true,'realDatabaseTested',false,'productionCertified',false)::text;
ROLLBACK;
