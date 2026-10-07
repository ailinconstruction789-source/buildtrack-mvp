-- SYNTHETIC LOCAL PROJECT-SALES TESTS ONLY. Every fixture rolls back.
-- This is not a migration and must never run on an application database.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $isolation$
BEGIN
  IF current_database() !~ '^buildtrack_sales_runtime_' OR current_setting('buildtrack.synthetic_runtime',true) IS DISTINCT FROM 'on'
    OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet THEN
    RAISE EXCEPTION 'REFUSED: project sales tests require the isolated synthetic loopback runner';
  END IF;
END;
$isolation$;
CREATE SCHEMA runtime_project_sales;
CREATE TABLE runtime_project_sales.assertions(label text PRIMARY KEY);
CREATE TABLE runtime_project_sales.context(key text PRIMARY KEY,value jsonb NOT NULL);
GRANT USAGE ON SCHEMA runtime_project_sales TO authenticated,anon;
GRANT SELECT,INSERT,UPDATE ON runtime_project_sales.context,runtime_project_sales.assertions TO authenticated,anon;
CREATE FUNCTION runtime_project_sales.assert_true(condition boolean,label text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $assert$
BEGIN
  IF condition IS DISTINCT FROM true THEN RAISE EXCEPTION 'ASSERTION FAILED: %',label; END IF;
  INSERT INTO runtime_project_sales.assertions VALUES(label);
END;
$assert$;
CREATE FUNCTION runtime_project_sales.expect_error(statement text,expected_message text,label text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $expect$
DECLARE actual_message text;
BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS actual_message=MESSAGE_TEXT;
    IF expected_message IS NOT NULL AND actual_message<>expected_message THEN
      RAISE EXCEPTION 'ASSERTION FAILED: %; expected %, received %',label,expected_message,actual_message;
    END IF;
    INSERT INTO runtime_project_sales.assertions VALUES(label); RETURN;
  END;
  RAISE EXCEPTION 'ASSERTION FAILED: %; expected error',label;
END;
$expect$;
CREATE FUNCTION runtime_project_sales.payload(customer_id uuid DEFAULT NULL,plot_id text DEFAULT 'SYNTHETIC-PROJECT-SALES-1')
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $payload$
  SELECT jsonb_build_object('command','book','reason','SYNTHETIC confirmed booking','customerId',customer_id,
    'newCustomer',CASE WHEN customer_id IS NULL THEN jsonb_build_object('name','SYNTHETIC %_ Customer','phone','0891900001',
      'channel','phone','notes','SYNTHETIC PRIVATE NOTES','assignedSalesUserId',NULL) ELSE NULL END,
    'projectName','SYNTHETIC PROJECT SALES','expectedInterestRevision',NULL,'plotId',plot_id,'paymentMethod','mortgage',
    'bookingRoute','without_visit','visitId',NULL,'listPriceSatang',250000000,'discountSatang',500000,'depositSatang',100000,'previousSaleId',NULL);
$payload$;
CREATE FUNCTION runtime_project_sales.business_snapshot()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $business$
  SELECT jsonb_build_object(
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
REVOKE ALL ON FUNCTION runtime_project_sales.business_snapshot() FROM PUBLIC;
INSERT INTO auth.users(id) VALUES
 ('bc190000-0000-4000-8000-000000000001'),('bc190000-0000-4000-8000-000000000002'),
 ('bc190000-0000-4000-8000-000000000003'),('bc190000-0000-4000-8000-000000000004'),
 ('bc190000-0000-4000-8000-000000000005'),('bc190000-0000-4000-8000-000000000006');
INSERT INTO sales_private.crm_user_roles(user_id,role,display_name,is_active) VALUES
 ('bc190000-0000-4000-8000-000000000001','admin','SYNTHETIC Project Admin',true),
 ('bc190000-0000-4000-8000-000000000002','sales','SYNTHETIC Project Sales',true),
 ('bc190000-0000-4000-8000-000000000003','owner','SYNTHETIC Project Owner',true),
 ('bc190000-0000-4000-8000-000000000004','sales','SYNTHETIC Other Sales',true),
 ('bc190000-0000-4000-8000-000000000005','sales','SYNTHETIC Inactive Sales',false);
INSERT INTO public.projects(name,is_closed) VALUES('SYNTHETIC PROJECT SALES',false),('SYNTHETIC PROJECT OTHER',false),('SYNTHETIC PROJECT CLOSED',true);
INSERT INTO public.plots(id,project_name,plot_name,has_customer,sale_status)
 SELECT 'SYNTHETIC-PROJECT-SALES-'||n,'SYNTHETIC PROJECT SALES','SYNTHETIC Plot '||n,false,'available' FROM generate_series(1,20) n;
INSERT INTO public.crm_settings(id,central_intake_enabled,lead_work_enabled,lead_lifecycle_enabled)
 VALUES(true,true,true,true) ON CONFLICT(id) DO UPDATE SET central_intake_enabled=true,lead_work_enabled=true,lead_lifecycle_enabled=true,
 booking_enabled=false,booking_cutover_reviewed=false;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','bc190000-0000-4000-8000-000000000002',true);
SELECT runtime_project_sales.assert_true(public.crm_v2_project_sales_capabilities()='{"contract_version":"project_sales_v1","enabled":false}'::jsonb,'capabilities remain disabled by default');
SELECT runtime_project_sales.expect_error('SELECT public.crm_v2_project_sales()','CRM_PROJECT_SALES_SETUP_REQUIRED','default disabled reader fails closed');
RESET ROLE;
UPDATE public.crm_settings SET booking_enabled=true WHERE id;
SET LOCAL ROLE authenticated;
SELECT runtime_project_sales.expect_error('SELECT public.crm_v2_project_sales()','CRM_PROJECT_SALES_SETUP_REQUIRED','cutover review gate independently blocks reader');
RESET ROLE;
UPDATE public.crm_settings SET booking_cutover_reviewed=true WHERE id;
SET LOCAL ROLE authenticated;
SELECT runtime_project_sales.assert_true(public.crm_v2_project_sales_capabilities()='{"contract_version":"project_sales_v1","enabled":true}'::jsonb,'enabled contract delegates booking capabilities');
INSERT INTO runtime_project_sales.context VALUES('discovery',public.crm_v2_project_sales());
SELECT runtime_project_sales.assert_true((SELECT value->'projectName'='null'::jsonb AND value->'rows'='[]'::jsonb AND value->>'hasMore'='false' FROM runtime_project_sales.context WHERE key='discovery'),'null project discovers projects without exposing customer rows');
SELECT runtime_project_sales.assert_true(EXISTS(SELECT 1 FROM jsonb_array_elements(public.crm_v2_project_sales()->'projects') p WHERE p->>'name'='SYNTHETIC PROJECT CLOSED'),'closed registered project remains discoverable for history');
SELECT runtime_project_sales.assert_true(public.crm_v2_project_sales('SYNTHETIC PROJECT CLOSED')->'rows'='[]'::jsonb,'closed project accepts read-only history selection');
SELECT runtime_project_sales.expect_error('SELECT public.crm_v2_project_sales(NULL,''all'',''ab'')','CRM_PROJECT_SALES_INVALID_INPUT','null project cannot run search');
SELECT runtime_project_sales.expect_error('SELECT public.crm_v2_project_sales(NULL,''all'','''',1)','CRM_PROJECT_SALES_INVALID_INPUT','null project cannot paginate');
SELECT runtime_project_sales.expect_error('SELECT public.crm_v2_project_sales(''SYNTHETIC PROJECT SALES'',''pending'')','CRM_PROJECT_SALES_INVALID_INPUT','unknown tab rejected');
SELECT runtime_project_sales.expect_error('SELECT public.crm_v2_project_sales(''SYNTHETIC PROJECT SALES'',NULL)','CRM_PROJECT_SALES_INVALID_INPUT','null tab rejected');
SELECT runtime_project_sales.expect_error('SELECT public.crm_v2_project_sales(''SYNTHETIC PROJECT SALES'',''all'',NULL)','CRM_PROJECT_SALES_INVALID_INPUT','null query rejected');
SELECT runtime_project_sales.expect_error('SELECT public.crm_v2_project_sales(''SYNTHETIC PROJECT SALES'',''all'',''x'')','CRM_PROJECT_SALES_INVALID_INPUT','single codepoint query rejected');
SELECT runtime_project_sales.expect_error('SELECT public.crm_v2_project_sales(''SYNTHETIC PROJECT SALES'',''all'',chr(128512))','CRM_PROJECT_SALES_INVALID_INPUT','one non-BMP codepoint is not two characters');
SELECT runtime_project_sales.expect_error('SELECT public.crm_v2_project_sales(''SYNTHETIC PROJECT SALES'',''all'',repeat(''x'',201))','CRM_PROJECT_SALES_INVALID_INPUT','overlong search rejected');
SELECT runtime_project_sales.expect_error('SELECT public.crm_v2_project_sales(''SYNTHETIC PROJECT SALES'',''all'',''ab''||chr(10))','CRM_PROJECT_SALES_INVALID_INPUT','control character query rejected before trim');
SELECT runtime_project_sales.expect_error('SELECT public.crm_v2_project_sales(''SYNTHETIC PROJECT SALES'',''all'','''',-1)','CRM_PROJECT_SALES_INVALID_INPUT','negative page rejected');
SELECT runtime_project_sales.expect_error('SELECT public.crm_v2_project_sales(''SYNTHETIC PROJECT SALES'',''all'','''',100001)','CRM_PROJECT_SALES_INVALID_INPUT','oversized page rejected');
SELECT runtime_project_sales.expect_error('SELECT public.crm_v2_project_sales(''SYNTHETIC PROJECT SALES'',''all'','''',NULL)','CRM_PROJECT_SALES_INVALID_INPUT','null page rejected');
SELECT runtime_project_sales.expect_error('SELECT public.crm_v2_project_sales(''SYNTHETIC PROJECT SALES '')','CRM_PROJECT_SALES_NOT_FOUND','project identity is exact not normalized into another project');
SELECT runtime_project_sales.expect_error('SELECT public.crm_v2_project_sales(''UNKNOWN SYNTHETIC PROJECT'')','CRM_PROJECT_SALES_NOT_FOUND','unknown project rejected');
SELECT runtime_project_sales.assert_true(public.crm_v2_project_sales('SYNTHETIC PROJECT SALES','all','  ab  ')->>'query'='ab','query echoes canonical trimmed literal');
INSERT INTO runtime_project_sales.context VALUES('book',public.crm_v2_booking_command('bc191000-0000-4000-8000-000000000001',runtime_project_sales.payload()));
SELECT runtime_project_sales.assert_true((public.crm_v2_project_sales('SYNTHETIC PROJECT SALES')#>>'{rows,0,saleId}')=(SELECT value->>'saleId' FROM runtime_project_sales.context WHERE key='book'),'actual draft18 booking appears by sale identity');
SELECT runtime_project_sales.assert_true((public.crm_v2_project_sales('SYNTHETIC PROJECT SALES')#>>'{rows,0,customerId}')=(SELECT value->>'customerId' FROM runtime_project_sales.context WHERE key='book'),'project booking links same central customer');
SELECT runtime_project_sales.assert_true(public.crm_v2_project_sales('SYNTHETIC PROJECT OTHER')->'rows'='[]'::jsonb,'project scope excludes another projects booking');
SELECT runtime_project_sales.assert_true(jsonb_array_length(public.crm_v2_project_sales('SYNTHETIC PROJECT SALES','all','%_')->'rows')=1,'percent and underscore match literal stored customer text');
SELECT runtime_project_sales.assert_true(public.crm_v2_project_sales('SYNTHETIC PROJECT SALES','all','%%')->'rows'='[]'::jsonb,'percent is not wildcard');
SELECT runtime_project_sales.assert_true(public.crm_v2_project_sales('SYNTHETIC PROJECT SALES','all','__')->'rows'='[]'::jsonb,'underscore is not wildcard');
SELECT runtime_project_sales.assert_true(public.crm_v2_project_sales('SYNTHETIC PROJECT SALES','all',chr(92)||chr(92))->'rows'='[]'::jsonb,'backslash is not escape syntax');
SELECT runtime_project_sales.assert_true(jsonb_array_length(public.crm_v2_project_sales('SYNTHETIC PROJECT SALES','booked','synthetic plot 1')->'rows')=1,'literal plot-name search ignores case');
SELECT runtime_project_sales.assert_true(jsonb_array_length(public.crm_v2_project_sales('SYNTHETIC PROJECT SALES','booked','project-sales-1')->'rows')=1,'literal plot identifier search ignores case');
SELECT runtime_project_sales.assert_true(jsonb_array_length(public.crm_v2_project_sales('SYNTHETIC PROJECT SALES','booked','0891900001')->'rows')=1,'phone literal search');
INSERT INTO runtime_project_sales.context SELECT 'cancel',public.crm_v2_booking_command('bc191000-0000-4000-8000-000000000002',jsonb_build_object(
 'command','cancel','reason','SYNTHETIC customer changed plan','customerId',value->'customerId','saleId',value->'saleId',
 'expectedSaleRevision',value->'saleRevision','cancellationCategory','booking_cancelled')) FROM runtime_project_sales.context WHERE key='book';
INSERT INTO runtime_project_sales.context SELECT 'rebook',public.crm_v2_booking_command('bc191000-0000-4000-8000-000000000003',
 runtime_project_sales.payload((value->>'customerId')::uuid,'SYNTHETIC-PROJECT-SALES-2')||jsonb_build_object('expectedInterestRevision',value->'interestRevision','previousSaleId',value->'saleId')) FROM runtime_project_sales.context WHERE key='cancel';
INSERT INTO runtime_project_sales.context SELECT 'second-plot',public.crm_v2_booking_command('bc191000-0000-4000-8000-000000000004',
 runtime_project_sales.payload((value->>'customerId')::uuid,'SYNTHETIC-PROJECT-SALES-3')||jsonb_build_object('expectedInterestRevision',value->'interestRevision')) FROM runtime_project_sales.context WHERE key='rebook';
SELECT runtime_project_sales.assert_true(jsonb_array_length(public.crm_v2_project_sales('SYNTHETIC PROJECT SALES','booked')->'rows')=2,'multiple active plots remain separate rows for same customer');
SELECT runtime_project_sales.assert_true(jsonb_array_length(public.crm_v2_project_sales('SYNTHETIC PROJECT SALES','cancelled')->'rows')=1,'cancellation retained in separate history tab');
SELECT runtime_project_sales.assert_true((public.crm_v2_project_sales('SYNTHETIC PROJECT SALES','cancelled')#>>'{rows,0,cancellationReason}')='SYNTHETIC customer changed plan','cancellation reason retained verbatim');
SELECT runtime_project_sales.assert_true(EXISTS(SELECT 1 FROM jsonb_array_elements(public.crm_v2_project_sales('SYNTHETIC PROJECT SALES','all')->'rows') r
 WHERE r->>'bookingRound'='2' AND r->>'previousSaleId'=(SELECT value->>'saleId' FROM runtime_project_sales.context WHERE key='book')),'new round references cancellation without replacing it');
RESET ROLE;
SELECT runtime_project_sales.assert_true((SELECT count(*)=3 AND bool_and(lead_id IS NULL) FROM public.sales WHERE project_interest_id=(SELECT (value->>'interestId')::uuid FROM runtime_project_sales.context WHERE key='book')),'new project reader works without legacy lead_id');
INSERT INTO public.sales_customers(id,customer_name,phone,owner_user_id,created_by_user_id)
 VALUES('bc192000-0000-4000-8000-000000000001','SYNTHETIC interested but not booked','0891900002','bc190000-0000-4000-8000-000000000002','bc190000-0000-4000-8000-000000000002');
INSERT INTO public.lead_project_interests(customer_id,project_name,owner_user_id,created_by_user_id)
 VALUES('bc192000-0000-4000-8000-000000000001','SYNTHETIC PROJECT SALES','bc190000-0000-4000-8000-000000000002','bc190000-0000-4000-8000-000000000002');
UPDATE public.sales_customers SET monthly_income=999999,personal_data='{"SYNTHETIC_PRIVATE":"never expose"}',occupation='SYNTHETIC PRIVATE OCCUPATION'
 WHERE id=(SELECT (value->>'customerId')::uuid FROM runtime_project_sales.context WHERE key='book');
-- Private fixture permits are available only to the isolated harness, never callers.
INSERT INTO sales_private.booking_write_permits VALUES(txid_current(),pg_backend_pid());
INSERT INTO public.sales(project_interest_id,plot_id,booking_round,crm_stage,booking_route,booking_route_reason,contract_status,booked_at)
 SELECT (value->>'interestId')::uuid,'SYNTHETIC-PROJECT-SALES-'||n,n,
  CASE n WHEN 4 THEN 'transferred' WHEN 5 THEN 'handover' WHEN 6 THEN 'contracted' WHEN 7 THEN 'downpayment'
    WHEN 8 THEN 'document_prep' WHEN 9 THEN 'loan_submitted' WHEN 10 THEN 'loan_rejected' WHEN 11 THEN 'loan_approved' ELSE 'transfer_pending' END,
  'legacy_import','SYNTHETIC evidence import','Reserved',TIMESTAMPTZ '2001-01-01 00:00:00+00'
 FROM runtime_project_sales.context CROSS JOIN generate_series(4,12) n WHERE key='book';
DELETE FROM sales_private.booking_write_permits WHERE transaction_id=txid_current();
SET LOCAL ROLE authenticated;
SELECT runtime_project_sales.assert_true(public.crm_v2_project_sales('SYNTHETIC PROJECT SALES','all','interested but not booked')->'rows'='[]'::jsonb,'interested-only customer never appears as project booking');
SELECT runtime_project_sales.assert_true(jsonb_array_length(public.crm_v2_project_sales('SYNTHETIC PROJECT SALES','booked')->'rows')=9,'booked tab includes every pretransfer crm stage');
SELECT runtime_project_sales.assert_true(jsonb_array_length(public.crm_v2_project_sales('SYNTHETIC PROJECT SALES','transferred')->'rows')=2,'transferred tab includes transferred and handover only');
SELECT runtime_project_sales.assert_true(public.crm_v2_project_sales('SYNTHETIC PROJECT SALES','all')::text NOT LIKE '%SYNTHETIC_PRIVATE%'
 AND public.crm_v2_project_sales('SYNTHETIC PROJECT SALES','all')::text NOT LIKE '%PRIVATE NOTES%'
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(public.crm_v2_project_sales('SYNTHETIC PROJECT SALES','all')->'rows') r
 WHERE r ?| ARRAY['monthly_income','personal_data','occupation','notes','canEdit','canCancel','booking_revision','lead_id']),'projection excludes sensitive unrelated fields and write capabilities');
SELECT set_config('request.jwt.claim.sub','bc190000-0000-4000-8000-000000000004',true);
SELECT runtime_project_sales.assert_true(jsonb_array_length(public.crm_v2_project_sales('SYNTHETIC PROJECT SALES','all')->'rows')=12,'other Sales can read all project bookings');
SELECT set_config('request.jwt.claim.sub','bc190000-0000-4000-8000-000000000003',true);
SELECT runtime_project_sales.assert_true(public.crm_v2_project_sales('SYNTHETIC PROJECT SALES')#>>'{actor,role}'='owner','Owner gets read projection');
SELECT set_config('request.jwt.claim.sub','bc190000-0000-4000-8000-000000000001',true);
SELECT runtime_project_sales.assert_true(public.crm_v2_project_sales('SYNTHETIC PROJECT SALES')#>>'{actor,role}'='admin','Admin gets read projection');
SELECT set_config('request.jwt.claim.sub','bc190000-0000-4000-8000-000000000005',true);
SELECT runtime_project_sales.expect_error('SELECT public.crm_v2_project_sales()','CRM_PROJECT_SALES_FORBIDDEN','inactive caller rejected');
SELECT set_config('request.jwt.claim.sub','bc190000-0000-4000-8000-000000000006',true);
SELECT runtime_project_sales.expect_error('SELECT public.crm_v2_project_sales()','CRM_PROJECT_SALES_FORBIDDEN','unmapped caller rejected');
SELECT set_config('request.jwt.claim.sub','',true);
SELECT runtime_project_sales.expect_error('SELECT public.crm_v2_project_sales()','CRM_PROJECT_SALES_FORBIDDEN','missing actor rejected');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT runtime_project_sales.expect_error('SELECT public.crm_v2_project_sales()',NULL,'anon cannot execute project read RPC');
SELECT runtime_project_sales.expect_error('SELECT public.crm_v2_project_sales_capabilities()',NULL,'anon cannot execute project capabilities');
RESET ROLE;
-- Proven historical cancellation: unknown fields remain NULL, not invented defaults.
INSERT INTO public.leads(id,phone) VALUES('bc193000-0000-4000-8000-000000000001','000-000-0000');
INSERT INTO public.sales_customers(id,customer_name,record_origin,legacy_source_lead_id,phone,phone_data_status,intake_status,owner_user_id,created_by_user_id,lead_created_at)
 VALUES('bc193000-0000-4000-8000-000000000002','SYNTHETIC historical unknown','legacy_import','bc193000-0000-4000-8000-000000000001',NULL,'unknown_legacy','legacy_unclassified',
 'bc190000-0000-4000-8000-000000000002','bc190000-0000-4000-8000-000000000001',NULL);
INSERT INTO public.lead_project_interests(id,customer_id,project_name,owner_user_id,created_by_user_id)
 VALUES('bc193000-0000-4000-8000-000000000003','bc193000-0000-4000-8000-000000000002','SYNTHETIC PROJECT SALES','bc190000-0000-4000-8000-000000000002','bc190000-0000-4000-8000-000000000001');
INSERT INTO public.crm_import_batches(id,source_name,file_hash,mapping_version,created_by_admin_id)
 VALUES('bc193000-0000-4000-8000-000000000005','SYNTHETIC history','SYNTHETIC-project-sales','SYNTHETIC-v1','bc190000-0000-4000-8000-000000000001');
INSERT INTO sales_private.booking_write_permits VALUES(txid_current(),pg_backend_pid());
-- Seed the already-linked historical row and its source in ONE statement. Both
-- immediate FKs are checked after the statement; no guard/constraint is disabled
-- or deferred, and no UPDATE attempts to relink immutable post-cutover identity.
WITH seeded_sale AS (
 INSERT INTO public.sales(id,lead_id,contract_status,project_interest_id,booking_round,crm_stage,booking_route,
  booking_route_reason,legacy_cancellation_batch_id)
 VALUES('bc193000-0000-4000-8000-000000000004','bc193000-0000-4000-8000-000000000001','Cancelled',
  'bc193000-0000-4000-8000-000000000003',1,'cancelled','legacy_import','SYNTHETIC proven import',
  'bc193000-0000-4000-8000-000000000005') RETURNING id
)
INSERT INTO sales_private.crm_legacy_source_snapshots(import_batch_id,legacy_sale_id,source_payload)
 SELECT 'bc193000-0000-4000-8000-000000000005',id,
  jsonb_build_object('id',id,'contract_status','Cancelled') FROM seeded_sale;
DELETE FROM sales_private.booking_write_permits WHERE transaction_id=txid_current();
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','bc190000-0000-4000-8000-000000000002',true);
INSERT INTO runtime_project_sales.context VALUES('unknown',public.crm_v2_project_sales('SYNTHETIC PROJECT SALES','cancelled','historical unknown'));
SELECT runtime_project_sales.assert_true((SELECT value#>'{rows,0,phone}'='null'::jsonb AND value#>'{rows,0,plotId}'='null'::jsonb
 AND value#>'{rows,0,plotName}'='null'::jsonb AND value#>'{rows,0,bookedAt}'='null'::jsonb AND value#>'{rows,0,cancelledAt}'='null'::jsonb
 AND value#>'{rows,0,cancellationReason}'='null'::jsonb AND value#>'{rows,0,salePrice}'='null'::jsonb
 AND value#>'{rows,0,depositAmount}'='null'::jsonb AND value#>'{rows,0,listPrice}'='null'::jsonb
 AND value#>'{rows,0,discountAmount}'='null'::jsonb AND value#>'{rows,0,paymentMethod}'='null'::jsonb
 FROM runtime_project_sales.context WHERE key='unknown'),'historical phone plot money event dates reason and payment remain unknown');
INSERT INTO runtime_project_sales.context VALUES('history',public.crm_v2_project_sales('SYNTHETIC PROJECT SALES','all'));
SELECT runtime_project_sales.assert_true((SELECT jsonb_array_length(value->'rows')=13 AND value#>>'{rows,12,saleId}'='bc193000-0000-4000-8000-000000000004' FROM runtime_project_sales.context WHERE key='history'),'null booking dates sort last without suppressing old history');
RESET ROLE;
-- Pagination fixtures are distinct cancelled rounds, never duplicate active plots.
INSERT INTO sales_private.booking_write_permits VALUES(txid_current(),pg_backend_pid());
INSERT INTO public.sales(project_interest_id,plot_id,booking_round,crm_stage,booking_route,booking_route_reason,contract_status,booked_at,cancelled_at,cancellation_category,cancellation_reason)
 SELECT (value->>'interestId')::uuid,NULL,n,'cancelled','without_visit','SYNTHETIC archived round','Cancelled',
 TIMESTAMPTZ '2000-01-01 00:00:00+00',TIMESTAMPTZ '2000-01-02 00:00:00+00','other','SYNTHETIC page history'
 FROM runtime_project_sales.context CROSS JOIN generate_series(13,63) n WHERE key='book';
DELETE FROM sales_private.booking_write_permits WHERE transaction_id=txid_current();
SET LOCAL ROLE authenticated;
INSERT INTO runtime_project_sales.context VALUES('page0',public.crm_v2_project_sales('SYNTHETIC PROJECT SALES','all','',0)),('page1',public.crm_v2_project_sales('SYNTHETIC PROJECT SALES','all','',1));
SELECT runtime_project_sales.assert_true((SELECT jsonb_array_length(value->'rows')=50 AND value->>'hasMore'='true' FROM runtime_project_sales.context WHERE key='page0'),'page is bounded to fifty and lookahead detects more');
SELECT runtime_project_sales.assert_true((SELECT jsonb_array_length(value->'rows')=14 AND value->>'hasMore'='false' FROM runtime_project_sales.context WHERE key='page1'),'second page retains every remaining booking round');
SELECT runtime_project_sales.assert_true(NOT EXISTS(SELECT 1 FROM jsonb_array_elements((SELECT value->'rows' FROM runtime_project_sales.context WHERE key='page0')) a
 JOIN jsonb_array_elements((SELECT value->'rows' FROM runtime_project_sales.context WHERE key='page1')) b ON a->>'saleId'=b->>'saleId'),'stable pagination has no duplicate sale across pages');
SELECT runtime_project_sales.assert_true(public.crm_v2_project_sales('SYNTHETIC PROJECT SALES','all','',1)=(SELECT value FROM runtime_project_sales.context WHERE key='page1'),'equal timestamp ordering repeats deterministically');
SELECT runtime_project_sales.assert_true(public.crm_v2_project_sales('SYNTHETIC PROJECT SALES','all','',2)->'rows'='[]'::jsonb,'page beyond history remains empty');
SELECT runtime_project_sales.assert_true(jsonb_array_length(public.crm_v2_project_sales('SYNTHETIC PROJECT SALES','cancelled','SYNTHETIC page history')->'rows')=0,'search does not expose private cancellation-reason text');
RESET ROLE;
-- Missing owner mapping / stale plot mapping cannot be hidden by a tab or query.
UPDATE sales_private.crm_user_roles SET is_active=false,display_name=NULL WHERE user_id='bc190000-0000-4000-8000-000000000002';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','bc190000-0000-4000-8000-000000000001',true);
SELECT runtime_project_sales.assert_true(public.crm_v2_project_sales('SYNTHETIC PROJECT SALES')#>>'{rows,0,ownerName}'='bc190000-0000-4000-8000-000000000002','inactive historical owner remains readable with explicit UUID fallback');
RESET ROLE;
UPDATE sales_private.crm_user_roles SET role='owner' WHERE user_id='bc190000-0000-4000-8000-000000000002';
SET LOCAL ROLE authenticated;
SELECT runtime_project_sales.expect_error('SELECT public.crm_v2_project_sales(''SYNTHETIC PROJECT SALES'',''transferred'',''no matches'')','CRM_PROJECT_SALES_SETUP_REQUIRED','invalid owner mapping fails before filters');
RESET ROLE;
UPDATE sales_private.crm_user_roles SET role='sales',is_active=true,display_name='SYNTHETIC Project Sales' WHERE user_id='bc190000-0000-4000-8000-000000000002';
UPDATE public.plots SET project_name='SYNTHETIC PROJECT OTHER' WHERE id='SYNTHETIC-PROJECT-SALES-2';
SET LOCAL ROLE authenticated;
SELECT runtime_project_sales.expect_error('SELECT public.crm_v2_project_sales(''SYNTHETIC PROJECT SALES'')','CRM_PROJECT_SALES_SETUP_REQUIRED','plot project mismatch blocks interest project');
SELECT runtime_project_sales.expect_error('SELECT public.crm_v2_project_sales(''SYNTHETIC PROJECT OTHER'')','CRM_PROJECT_SALES_SETUP_REQUIRED','plot project mismatch blocks plot project');
RESET ROLE;
UPDATE public.plots SET project_name='SYNTHETIC PROJECT SALES' WHERE id='SYNTHETIC-PROJECT-SALES-2';
UPDATE public.sales_customers SET merged_into_customer_id='bc192000-0000-4000-8000-000000000001'
 WHERE id=(SELECT (value->>'customerId')::uuid FROM runtime_project_sales.context WHERE key='book');
SET LOCAL ROLE authenticated;
SELECT runtime_project_sales.expect_error('SELECT public.crm_v2_project_sales(''SYNTHETIC PROJECT SALES'')','CRM_PROJECT_SALES_SETUP_REQUIRED','merged customer requires explicit sale remapping not inferred identity');
RESET ROLE;
UPDATE public.sales_customers SET merged_into_customer_id=NULL WHERE id=(SELECT (value->>'customerId')::uuid FROM runtime_project_sales.context WHERE key='book');
INSERT INTO public.sales(id,plot_id,contract_status) VALUES('bc194000-0000-4000-8000-000000000001','SYNTHETIC-PROJECT-SALES-20','Reserved');
SET LOCAL ROLE authenticated;
SELECT runtime_project_sales.expect_error('SELECT public.crm_v2_project_sales(''SYNTHETIC PROJECT SALES'',''cancelled'',''no matches'',99)','CRM_PROJECT_SALES_SETUP_REQUIRED','unlinked selected-project legacy sale blocks before filter and pagination');
SELECT runtime_project_sales.assert_true(public.crm_v2_project_sales('SYNTHETIC PROJECT OTHER')->'rows'='[]'::jsonb,'classifiable other-project gap does not block unrelated project');
RESET ROLE;
UPDATE public.sales SET plot_id=NULL WHERE id='bc194000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT runtime_project_sales.expect_error('SELECT public.crm_v2_project_sales(''SYNTHETIC PROJECT OTHER'')','CRM_PROJECT_SALES_SETUP_REQUIRED','unclassifiable legacy sale conservatively blocks any selected project');
SELECT runtime_project_sales.assert_true(public.crm_v2_project_sales()->'rows'='[]'::jsonb,'legacy gap does not fabricate customer data in discovery');
RESET ROLE;
DELETE FROM public.sales WHERE id='bc194000-0000-4000-8000-000000000001';
UPDATE public.crm_settings SET lead_work_enabled=false WHERE id;
SET LOCAL ROLE authenticated;
SELECT runtime_project_sales.expect_error('SELECT public.crm_v2_project_sales(''SYNTHETIC PROJECT SALES'')','CRM_PROJECT_SALES_SETUP_REQUIRED','dependency kill switch closes reads');
RESET ROLE;
UPDATE public.crm_settings SET lead_work_enabled=true WHERE id;
INSERT INTO runtime_project_sales.context VALUES('before',runtime_project_sales.business_snapshot());
SET LOCAL ROLE authenticated;
SELECT runtime_project_sales.expect_error('SELECT * FROM sales_private.booking_command_requests',NULL,'reader grants no private booking receipt access');
SELECT runtime_project_sales.expect_error('SELECT * FROM public.sales',NULL,'reader does not grant raw legacy sales access');
INSERT INTO runtime_project_sales.context VALUES('readonly',public.crm_v2_project_sales('SYNTHETIC PROJECT SALES','all'));
RESET ROLE;
SELECT runtime_project_sales.assert_true(runtime_project_sales.business_snapshot()=(SELECT value FROM runtime_project_sales.context WHERE key='before'),'project reads leave business data stock audit settings tasks and receipts unchanged');
-- No writes from here. Verify the RPC can execute in a real READ ONLY transaction.
SET TRANSACTION READ ONLY;
SET LOCAL ROLE authenticated;
DO $read_only$
DECLARE result jsonb;
BEGIN
  result:=public.crm_v2_project_sales('SYNTHETIC PROJECT SALES','all');
  IF current_setting('transaction_read_only')<>'on' OR jsonb_array_length(result->'rows')<>50
    OR result->>'hasMore'<>'true' THEN RAISE EXCEPTION 'READ_ONLY_PROJECT_SALES_FAILED'; END IF;
END;
$read_only$;
SELECT 'PROJECT_SALES_SNAPSHOT:'||value::text FROM runtime_project_sales.context WHERE key='history';
SELECT 'PROJECT_SALES_RUNTIME:'||jsonb_build_object('suite','project_sales','assertions',(SELECT count(*)+1 FROM runtime_project_sales.assertions),
 'readOnlyTransaction',true,'syntheticOnly',true,'realDatabaseTested',false,'productionCertified',false)::text;
ROLLBACK;
