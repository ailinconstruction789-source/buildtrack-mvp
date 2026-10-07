-- SYNTHETIC LOCAL PROJECT-INTEREST TESTS ONLY. Entire scenario rolls back.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $isolation$
BEGIN
  IF current_database() !~ '^buildtrack_sales_runtime_' OR current_setting('buildtrack.synthetic_runtime',true) IS DISTINCT FROM 'on'
    OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet THEN RAISE EXCEPTION 'REFUSED: isolated synthetic interests only'; END IF;
END;
$isolation$;
CREATE SCHEMA runtime_interests;
CREATE TABLE runtime_interests.assertions(label text PRIMARY KEY);
CREATE TABLE runtime_interests.context(key text PRIMARY KEY,value jsonb NOT NULL);
GRANT USAGE ON SCHEMA runtime_interests TO authenticated,anon;
GRANT SELECT,INSERT,UPDATE ON runtime_interests.context,runtime_interests.assertions TO authenticated,anon;
CREATE FUNCTION runtime_interests.assert_true(condition boolean,label text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $assert$
BEGIN
  IF condition IS DISTINCT FROM true THEN RAISE EXCEPTION 'ASSERTION FAILED: %',label; END IF;
  INSERT INTO runtime_interests.assertions VALUES(label);
END;
$assert$;
CREATE FUNCTION runtime_interests.expect_error(statement text,expected_message text,label text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $expect$
DECLARE actual_message text;
BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS actual_message=MESSAGE_TEXT;
    IF expected_message IS NOT NULL AND actual_message<>expected_message THEN
      RAISE EXCEPTION 'ASSERTION FAILED: %; expected %, received %',label,expected_message,actual_message; END IF;
    INSERT INTO runtime_interests.assertions VALUES(label); RETURN;
  END;
  RAISE EXCEPTION 'ASSERTION FAILED: %; expected error',label;
END;
$expect$;
CREATE FUNCTION runtime_interests.payload(n integer DEFAULT 1,project_value text DEFAULT ' SYNTHETIC INTEREST A ',plot_value text DEFAULT ' SYNTHETIC INTEREST PLOT ')
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $payload$
  SELECT jsonb_build_object('customerId',id,'expectedCustomerRevision',lifecycle_revision,'projectName',project_value,'plotId',plot_value,
    'reason','SYNTHETIC customer expressed interest') FROM public.sales_customers WHERE id=('bc241000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
$payload$;
CREATE FUNCTION runtime_interests.snapshot(n integer DEFAULT 1,page_value integer DEFAULT 0)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $snapshot$
  SELECT public.crm_v2_project_interests_context(('bc241000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,page_value);
$snapshot$;
CREATE FUNCTION runtime_interests.business_snapshot()
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
    'settings',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.crm_settings r),
    'audits',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.crm_audit_events r),
    'receipts',(SELECT jsonb_agg(to_jsonb(r) ORDER BY actor_user_id,request_id) FROM sales_private.project_interest_command_requests r),
    'permits',(SELECT jsonb_agg(to_jsonb(r) ORDER BY transaction_id) FROM sales_private.project_interest_write_permits r));
$business$;
REVOKE ALL ON FUNCTION runtime_interests.business_snapshot() FROM PUBLIC;
INSERT INTO auth.users(id) SELECT ('bc240000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid FROM generate_series(1,5) n;
INSERT INTO sales_private.crm_user_roles(user_id,role,display_name,is_active) VALUES
 ('bc240000-0000-4000-8000-000000000001','admin','SYNTHETIC INTEREST ADMIN',true),
 ('bc240000-0000-4000-8000-000000000002','sales','SYNTHETIC INTEREST SALES',true),
 ('bc240000-0000-4000-8000-000000000003','owner','SYNTHETIC INTEREST OWNER',true),
 ('bc240000-0000-4000-8000-000000000004','sales','SYNTHETIC INTEREST OTHER',true),
 ('bc240000-0000-4000-8000-000000000005','sales','SYNTHETIC INTEREST INACTIVE',false);
INSERT INTO public.projects(name,is_closed) VALUES(' SYNTHETIC INTEREST A ',false),('SYNTHETIC INTEREST B',false),('SYNTHETIC INTEREST CLOSED',true);
INSERT INTO public.plots(id,project_name,has_customer,sale_status) VALUES
 (' SYNTHETIC INTEREST PLOT ',' SYNTHETIC INTEREST A ',false,'available'),
 ('SYNTHETIC-INTEREST-OCCUPIED','SYNTHETIC INTEREST B',true,'available'),
 ('SYNTHETIC-INTEREST-UNKNOWN','SYNTHETIC INTEREST B',NULL,'available'),
 ('SYNTHETIC-INTEREST-MALFORMED','SYNTHETIC INTEREST B',false,'available');
INSERT INTO public.sales(plot_id,contract_status) VALUES('SYNTHETIC-INTEREST-MALFORMED',' Cancelled ');
INSERT INTO public.sales_customers(id,customer_name,phone,intake_channel,owner_user_id,created_by_user_id,lead_created_at)
 SELECT ('bc241000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'SYNTHETIC INTEREST CUSTOMER '||n,'08924000'||lpad(n::text,2,'0'),'phone',
 'bc240000-0000-4000-8000-000000000002','bc240000-0000-4000-8000-000000000002',clock_timestamp()-interval '3 days' FROM generate_series(1,8) n;
INSERT INTO public.crm_settings(id,central_intake_enabled,lead_work_enabled,lead_lifecycle_enabled,project_interests_enabled)
 VALUES(true,true,true,true,false) ON CONFLICT(id) DO UPDATE SET central_intake_enabled=true,lead_work_enabled=true,lead_lifecycle_enabled=true,project_interests_enabled=false;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','bc240000-0000-4000-8000-000000000002',true);
SELECT runtime_interests.assert_true(public.crm_v2_project_interests_capabilities()='{"contract_version":"project_interests_v1","enabled":false}'::jsonb,'interest feature defaults disabled');
SELECT runtime_interests.expect_error('SELECT runtime_interests.snapshot()','CRM_INTERESTS_SETUP_REQUIRED','disabled context fails closed');
SELECT runtime_interests.expect_error('SELECT public.crm_v2_add_project_interest(gen_random_uuid(),runtime_interests.payload())','CRM_INTERESTS_SETUP_REQUIRED','disabled command fails closed');
RESET ROLE;
UPDATE public.crm_settings SET project_interests_enabled=true,visits_enabled=true WHERE id;
INSERT INTO runtime_interests.context VALUES('before-add',runtime_interests.business_snapshot());
SET LOCAL ROLE authenticated;
INSERT INTO runtime_interests.context VALUES('input',runtime_interests.payload());
INSERT INTO runtime_interests.context VALUES('result',public.crm_v2_add_project_interest('bc243000-0000-4000-8000-000000000001',(SELECT value FROM runtime_interests.context WHERE key='input')));
INSERT INTO runtime_interests.context VALUES('snapshot',runtime_interests.snapshot());
SELECT runtime_interests.assert_true((SELECT value->>'projectName'=' SYNTHETIC INTEREST A ' AND value->>'plotId'=' SYNTHETIC INTEREST PLOT '
 AND value->>'ownerUserId'='bc240000-0000-4000-8000-000000000002' FROM runtime_interests.context WHERE key='result'),'new interest preserves exact project and plot keys and central owner');
SELECT runtime_interests.assert_true((SELECT value#>>'{customer,canAdd}'='true' AND value#>>'{interests,0,status}'='new'
 AND jsonb_array_length(value->'interests')=1 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(value->'projects') p WHERE p->>'name' IN (' SYNTHETIC INTEREST A ','SYNTHETIC INTEREST CLOSED')) FROM runtime_interests.context WHERE key='snapshot'),'context excludes existing and closed projects');
-- Real downstream readers must accept the newly-created interest on the same
-- customer, without manufacturing work, a Visit or a project booking.
INSERT INTO runtime_interests.context VALUES('handoff-search',public.crm_v2_central_search(
 '{"search":"","project":" SYNTHETIC INTEREST A ","channel":"","owner":"","status":"","unassignedOnly":false}'::jsonb));
INSERT INTO runtime_interests.context SELECT 'handoff-work',public.crm_v2_lead_work_snapshot(
 (value->>'customerId')::uuid,(value->>'interestId')::uuid) FROM runtime_interests.context WHERE key='result';
INSERT INTO runtime_interests.context SELECT 'handoff-visits',public.crm_v2_visits_context(
 (value->>'customerId')::uuid,(value->>'interestId')::uuid) FROM runtime_interests.context WHERE key='result';
SELECT runtime_interests.assert_true((SELECT jsonb_array_length(s.value->'customers')=1
 AND s.value#>>'{customers,0,id}'=r.value->>'customerId'
 AND s.value#>>'{customers,0,interests,0,id}'=r.value->>'interestId'
 AND s.value#>>'{customers,0,interests,0,workspaceState}'='central_interest'
 FROM runtime_interests.context s CROSS JOIN runtime_interests.context r WHERE s.key='handoff-search' AND r.key='result'),
 'central search finds the same customer and new central interest');
SELECT runtime_interests.assert_true((SELECT w.value->'scope'=jsonb_build_object('customerId',r.value->>'customerId','interestId',r.value->>'interestId')
 AND w.value->>'projectName'=r.value->>'projectName' AND w.value#>>'{owner,userId}'=r.value->>'ownerUserId'
 AND w.value->>'canWrite'='true' AND w.value->'currentAction'='null'::jsonb
 FROM runtime_interests.context w CROSS JOIN runtime_interests.context r WHERE w.key='handoff-work' AND r.key='result'),
 'new interest opens writable project-scoped lead work without copying old tasks');
SELECT runtime_interests.assert_true((SELECT v.value#>>'{scope,customerId}'=r.value->>'customerId'
 AND v.value#>>'{scope,interestId}'=r.value->>'interestId' AND v.value#>>'{scope,ownerUserId}'=r.value->>'ownerUserId'
 AND v.value#>>'{scope,canEdit}'='true' AND v.value->'appointments'='[]'::jsonb AND v.value->'visits'='[]'::jsonb AND v.value->'events'='[]'::jsonb
 FROM runtime_interests.context v CROSS JOIN runtime_interests.context r WHERE v.key='handoff-visits' AND r.key='result'),
 'new interest opens the existing appointments and Visits workflow without invented history');
SELECT runtime_interests.assert_true(public.crm_v2_add_project_interest('bc243000-0000-4000-8000-000000000001',(SELECT value FROM runtime_interests.context WHERE key='input'))=
 (SELECT value||'{"replayed":true}'::jsonb FROM runtime_interests.context WHERE key='result'),'same request replays exact interest and audit identity');
SELECT runtime_interests.expect_error('SELECT public.crm_v2_add_project_interest(''bc243000-0000-4000-8000-000000000001'',runtime_interests.payload()||''{"reason":"different"}''::jsonb)','CRM_INTERESTS_IDEMPOTENCY_CONFLICT','same request changed payload conflicts');
SELECT runtime_interests.expect_error('SELECT public.crm_v2_add_project_interest(gen_random_uuid(),runtime_interests.payload())','CRM_INTERESTS_PROJECT_EXISTS','distinct command never duplicates same project interest');
SELECT runtime_interests.expect_error('SELECT public.crm_v2_add_project_interest(gen_random_uuid(),runtime_interests.payload(2)||''{"extra":1}''::jsonb)','CRM_INTERESTS_INVALID_INPUT','extra field rejected');
SELECT runtime_interests.expect_error('SELECT public.crm_v2_add_project_interest(gen_random_uuid(),runtime_interests.payload(2)-''reason'')','CRM_INTERESTS_INVALID_INPUT','missing reason rejected');
SELECT runtime_interests.expect_error('SELECT public.crm_v2_add_project_interest(gen_random_uuid(),runtime_interests.payload(2)||jsonb_build_object(''reason'',chr(10)))','CRM_INTERESTS_INVALID_INPUT','multiline reason rejected');
SELECT runtime_interests.expect_error('SELECT public.crm_v2_add_project_interest(gen_random_uuid(),runtime_interests.payload(2)||''{"plotId":9}''::jsonb)','CRM_INTERESTS_INVALID_INPUT','invalid plot type rejected');
SELECT runtime_interests.expect_error('SELECT public.crm_v2_add_project_interest(gen_random_uuid(),runtime_interests.payload(2)||jsonb_build_object(''expectedCustomerRevision'',gen_random_uuid()))','CRM_INTERESTS_STALE_STATE','stale central revision rejected');
SELECT runtime_interests.expect_error('SELECT public.crm_v2_add_project_interest(gen_random_uuid(),runtime_interests.payload(2,''SYNTHETIC INTEREST CLOSED'',NULL))','CRM_INTERESTS_NOT_FOUND','closed project rejected');
SELECT runtime_interests.expect_error('SELECT public.crm_v2_add_project_interest(gen_random_uuid(),runtime_interests.payload(2,''SYNTHETIC INTEREST A'',NULL))','CRM_INTERESTS_NOT_FOUND','trimmed different project key not silently rewritten');
SELECT runtime_interests.expect_error('SELECT public.crm_v2_add_project_interest(gen_random_uuid(),runtime_interests.payload(2,''SYNTHETIC INTEREST B'','' SYNTHETIC INTEREST PLOT ''))','CRM_INTERESTS_PLOT_UNAVAILABLE','plot from another project rejected');
SELECT runtime_interests.expect_error('SELECT public.crm_v2_add_project_interest(gen_random_uuid(),runtime_interests.payload(2,''SYNTHETIC INTEREST B'',''SYNTHETIC-INTEREST-OCCUPIED''))','CRM_INTERESTS_PLOT_UNAVAILABLE','occupied plot rejected');
SELECT runtime_interests.expect_error('SELECT public.crm_v2_add_project_interest(gen_random_uuid(),runtime_interests.payload(2,''SYNTHETIC INTEREST B'',''SYNTHETIC-INTEREST-UNKNOWN''))','CRM_INTERESTS_PLOT_UNAVAILABLE','unknown stock flag is not vacant');
SELECT runtime_interests.expect_error('SELECT public.crm_v2_add_project_interest(gen_random_uuid(),runtime_interests.payload(2,''SYNTHETIC INTEREST B'',''SYNTHETIC-INTEREST-MALFORMED''))','CRM_INTERESTS_PLOT_UNAVAILABLE','legacy active sale overrides apparently vacant plot flag');
RESET ROLE;
SELECT runtime_interests.assert_true((runtime_interests.business_snapshot()-ARRAY['interests','audits','receipts'])=(SELECT value-ARRAY['interests','audits','receipts'] FROM runtime_interests.context WHERE key='before-add'),'adding interest changes no customer revision cohort stock booking Visit SLA or work');
SELECT runtime_interests.assert_true((SELECT workspace_state='central_interest' AND activated_at IS NULL AND activation_reason IS NULL AND interest_created_at>c.lead_created_at
 FROM public.lead_project_interests i JOIN public.sales_customers c ON c.id=i.customer_id WHERE i.id=(SELECT (value->>'interestId')::uuid FROM runtime_interests.context WHERE key='result')),'interest starts central with independent operational date');
SELECT runtime_interests.assert_true((SELECT reason_text='SYNTHETIC customer expressed interest' AND event_type='project_interest_added' FROM public.crm_audit_events WHERE id=(SELECT (value->>'eventId')::uuid FROM runtime_interests.context WHERE key='result')),'reason and audit appended atomically');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','bc240000-0000-4000-8000-000000000003',true);
SELECT runtime_interests.assert_true(runtime_interests.snapshot()#>>'{customer,canAdd}'='false','Owner reads without mutation rights');
SELECT runtime_interests.expect_error('SELECT public.crm_v2_add_project_interest(gen_random_uuid(),runtime_interests.payload(2))','CRM_INTERESTS_FORBIDDEN','Owner cannot add interest');
SELECT set_config('request.jwt.claim.sub','bc240000-0000-4000-8000-000000000004',true);
SELECT runtime_interests.assert_true(runtime_interests.snapshot()#>>'{customer,canAdd}'='false','other Sales reads every project but cannot add for someone else');
SELECT runtime_interests.expect_error('SELECT public.crm_v2_add_project_interest(gen_random_uuid(),runtime_interests.payload(2))','CRM_INTERESTS_FORBIDDEN','other Sales cannot add interest');
SELECT set_config('request.jwt.claim.sub','bc240000-0000-4000-8000-000000000001',true);
SELECT public.crm_v2_add_project_interest(gen_random_uuid(),runtime_interests.payload(2,'SYNTHETIC INTEREST B',NULL));
SELECT runtime_interests.assert_true(runtime_interests.snapshot(2)#>>'{interests,0,ownerUserId}'='bc240000-0000-4000-8000-000000000002','Admin creation still inherits current central Sales owner');
RESET ROLE;
UPDATE public.sales_customers SET owner_user_id='bc240000-0000-4000-8000-000000000005' WHERE id='bc241000-0000-4000-8000-000000000003';
UPDATE public.sales_customers SET intake_status='lost' WHERE id='bc241000-0000-4000-8000-000000000004';
UPDATE public.sales_customers SET merged_into_customer_id='bc241000-0000-4000-8000-000000000001' WHERE id='bc241000-0000-4000-8000-000000000005';
SET LOCAL ROLE authenticated;
SELECT runtime_interests.assert_true(runtime_interests.snapshot(3)#>>'{customer,canAdd}'='false','inactive current central owner disables add');
SELECT runtime_interests.expect_error('SELECT public.crm_v2_add_project_interest(gen_random_uuid(),runtime_interests.payload(3))','CRM_INTERESTS_FORBIDDEN','even Admin must repair inactive owner first');
SELECT runtime_interests.expect_error('SELECT public.crm_v2_add_project_interest(gen_random_uuid(),runtime_interests.payload(4))','CRM_INTERESTS_SCOPE_CLOSED','lost central customer rejected');
SELECT runtime_interests.expect_error('SELECT public.crm_v2_add_project_interest(gen_random_uuid(),runtime_interests.payload(5))','CRM_INTERESTS_SCOPE_CLOSED','merged central customer rejected');
SELECT runtime_interests.assert_true(runtime_interests.snapshot(4)#>>'{customer,canAdd}'='false' AND runtime_interests.snapshot(5)#>>'{customer,canAdd}'='false','closed and merged customers remain read-only');
SELECT runtime_interests.expect_error('INSERT INTO public.lead_project_interests(customer_id,project_name,owner_user_id,created_by_user_id) VALUES(''bc241000-0000-4000-8000-000000000006'',''SYNTHETIC INTEREST B'',''bc240000-0000-4000-8000-000000000002'',''bc240000-0000-4000-8000-000000000002'')',NULL,'browser has no direct interest insert grant');
SELECT runtime_interests.expect_error('INSERT INTO sales_private.project_interest_write_permits VALUES(txid_current(),pg_backend_pid())',NULL,'browser cannot forge receipt permit');
RESET ROLE;
SELECT runtime_interests.expect_error('UPDATE sales_private.project_interest_command_requests SET response=''{}''','CRM_INTERESTS_FORBIDDEN','even privileged update cannot rewrite immutable receipt');
SELECT runtime_interests.expect_error('DELETE FROM sales_private.project_interest_command_requests','CRM_INTERESTS_FORBIDDEN','even privileged delete cannot remove receipt');
-- Inject failure only into this synthetic receipt insertion to prove rollback of
-- both the interest and its already-appended audit; no production trigger altered.
CREATE FUNCTION runtime_interests.fail_receipt() RETURNS trigger LANGUAGE plpgsql AS $fail$
BEGIN RAISE EXCEPTION 'SYNTHETIC_INJECTED_FAILURE'; END;
$fail$;
CREATE TRIGGER zz_runtime_interests_fail BEFORE INSERT ON sales_private.project_interest_command_requests FOR EACH ROW EXECUTE FUNCTION runtime_interests.fail_receipt();
INSERT INTO runtime_interests.context VALUES('before-failure',runtime_interests.business_snapshot());
SET LOCAL ROLE authenticated;
SELECT runtime_interests.expect_error('SELECT public.crm_v2_add_project_interest(gen_random_uuid(),runtime_interests.payload(6))','SYNTHETIC_INJECTED_FAILURE','receipt failure rolls back entire command');
RESET ROLE;
SELECT runtime_interests.assert_true(runtime_interests.business_snapshot()=(SELECT value FROM runtime_interests.context WHERE key='before-failure'),'failed command leaves no interest audit receipt or permit');
DROP TRIGGER zz_runtime_interests_fail ON sales_private.project_interest_command_requests;
-- Deterministic bounded project selection and interest pages across all projects.
INSERT INTO public.projects(name,is_closed) SELECT 'SYNTHETIC INTEREST PAGE '||lpad(n::text,3,'0'),false FROM generate_series(1,255) n;
INSERT INTO public.lead_project_interests(customer_id,project_name,owner_user_id,created_by_user_id)
 SELECT 'bc241000-0000-4000-8000-000000000007','SYNTHETIC INTEREST PAGE '||lpad(n::text,3,'0'),
 'bc240000-0000-4000-8000-000000000002','bc240000-0000-4000-8000-000000000001' FROM generate_series(1,51) n;
SET LOCAL ROLE authenticated;
SELECT runtime_interests.assert_true(jsonb_array_length(runtime_interests.snapshot(7)->'interests')=50 AND runtime_interests.snapshot(7)->>'hasMore'='true','interest first page fifty with explicit more');
SELECT runtime_interests.assert_true(jsonb_array_length(runtime_interests.snapshot(7,1)->'interests')=1 AND runtime_interests.snapshot(7,1)->>'hasMore'='false','remaining interests accessible on second page');
SELECT runtime_interests.assert_true(jsonb_array_length(runtime_interests.snapshot(7)->'projects')=200 AND runtime_interests.snapshot(7)->>'projectsHasMore'='true','project chooser bounded at two hundred with explicit truncation');
SELECT public.crm_v2_add_project_interest(gen_random_uuid(),runtime_interests.payload(7,'SYNTHETIC INTEREST PAGE 255',NULL));
SELECT runtime_interests.assert_true(jsonb_array_length(runtime_interests.snapshot(7,1)->'interests')=2,'valid project outside chooser page accepted through exact key');
SELECT set_config('request.jwt.claim.sub','bc240000-0000-4000-8000-000000000002',true);
RESET ROLE;
UPDATE public.sales_customers SET owner_user_id='bc240000-0000-4000-8000-000000000004',lifecycle_revision=gen_random_uuid() WHERE id='bc241000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT runtime_interests.expect_error('SELECT public.crm_v2_add_project_interest(''bc243000-0000-4000-8000-000000000001'',(SELECT value FROM runtime_interests.context WHERE key=''input''))','CRM_INTERESTS_FORBIDDEN','former central owner cannot replay receipt');
RESET ROLE;
UPDATE public.crm_settings SET project_interests_enabled=false WHERE id;
SET LOCAL ROLE authenticated;
SELECT runtime_interests.expect_error('SELECT public.crm_v2_add_project_interest(''bc243000-0000-4000-8000-000000000001'',(SELECT value FROM runtime_interests.context WHERE key=''input''))','CRM_INTERESTS_SETUP_REQUIRED','kill switch checked before replay');
RESET ROLE;
UPDATE public.crm_settings SET project_interests_enabled=true WHERE id;
SELECT runtime_interests.assert_true(NOT EXISTS(SELECT 1 FROM sales_private.project_interest_write_permits),'no receipt permit left behind');
INSERT INTO runtime_interests.context VALUES('before-read',runtime_interests.business_snapshot());
SET LOCAL ROLE authenticated;
SELECT runtime_interests.snapshot();
RESET ROLE;
SELECT runtime_interests.assert_true(runtime_interests.business_snapshot()=(SELECT value FROM runtime_interests.context WHERE key='before-read'),'GET changes no business or private state');
SET TRANSACTION READ ONLY;
SET LOCAL ROLE authenticated;
DO $readonly$
BEGIN
  IF current_setting('transaction_read_only')<>'on' OR runtime_interests.snapshot()#>>'{customer,id}'<>'bc241000-0000-4000-8000-000000000001' THEN
    RAISE EXCEPTION 'READ_ONLY_INTERESTS_FAILED'; END IF;
END;
$readonly$;
SELECT 'INTERESTS_SNAPSHOT:'||value::text FROM runtime_interests.context WHERE key='snapshot';
SELECT 'INTERESTS_RESULT:'||value::text FROM runtime_interests.context WHERE key='result';
SELECT 'INTERESTS_INPUT:'||(value||'{"requestId":"bc243000-0000-4000-8000-000000000001"}'::jsonb)::text FROM runtime_interests.context WHERE key='input';
SELECT 'INTERESTS_RUNTIME:'||jsonb_build_object('suite','project-interests','assertions',(SELECT count(*)+1 FROM runtime_interests.assertions),
 'readOnlyTransaction',true,'syntheticOnly',true,'realDatabaseTested',false,'productionCertified',false)::text;
ROLLBACK;
