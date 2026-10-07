-- SYNTHETIC LOCAL VOICES TESTS ONLY. Verified legacy facade is runner-owned.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $isolation$ BEGIN
 IF current_database() !~ '^buildtrack_sales_runtime_' OR current_setting('buildtrack.synthetic_runtime',true) IS DISTINCT FROM 'on'
 OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet THEN RAISE EXCEPTION 'REFUSED: isolated synthetic Voices only'; END IF;
END $isolation$;
CREATE SCHEMA runtime_voice;
CREATE TABLE runtime_voice.assertions(label text PRIMARY KEY);
CREATE TABLE runtime_voice.context(key text PRIMARY KEY,value jsonb NOT NULL);
GRANT USAGE ON SCHEMA runtime_voice TO authenticated,anon;
GRANT SELECT,INSERT,UPDATE ON runtime_voice.context,runtime_voice.assertions TO authenticated,anon;
CREATE FUNCTION runtime_voice.assert_true(condition boolean,label text) RETURNS void LANGUAGE plpgsql AS $assert$
BEGIN IF condition IS DISTINCT FROM true THEN RAISE EXCEPTION 'ASSERTION FAILED: %',label; END IF; INSERT INTO runtime_voice.assertions VALUES(label); END $assert$;
CREATE FUNCTION runtime_voice.expect_error(statement text,expected_message text,label text) RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $expect$
DECLARE actual_message text;
BEGIN
 BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN
 GET STACKED DIAGNOSTICS actual_message=MESSAGE_TEXT;
 IF expected_message IS NOT NULL AND actual_message<>expected_message THEN RAISE EXCEPTION 'ASSERTION FAILED: %; expected %, received %',label,expected_message,actual_message; END IF;
 INSERT INTO runtime_voice.assertions VALUES(label); RETURN; END;
 RAISE EXCEPTION 'ASSERTION FAILED: %; expected error',label;
END $expect$;
CREATE FUNCTION runtime_voice.answers() RETURNS jsonb LANGUAGE sql IMMUTABLE AS $answers$
 SELECT '{"score_knowledge":1,"score_problem_solving":2,"score_service_mind":3,"score_appearance":4,"score_cleanliness":5,"score_house_design":4,"score_price":3,"score_location":2}'::jsonb;
$answers$;
CREATE FUNCTION runtime_voice.payload(n integer,cmd text DEFAULT 'issue',raw_token text DEFAULT repeat('a',64),extra jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $payload$
 SELECT jsonb_build_object('command',cmd,'customerId',i.customer_id,'interestId',i.id,'visitId',v.id,'expectedInterestRevision',i.lifecycle_revision,
 'expectedVisitRevision',v.revision,'expectedTokenId',(SELECT id FROM sales_private.visit_submission_tokens WHERE visit_id=v.id AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>statement_timestamp()),
 'tokenHash',encode(sha256(convert_to(raw_token,'UTF8')),'hex'),'reason','SYNTHETIC customer QR reason')||extra
 FROM public.lead_project_interests i JOIN public.lead_visits v ON v.project_interest_id=i.id WHERE i.id=('bc262000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
$payload$;
CREATE FUNCTION runtime_voice.snapshot(n integer DEFAULT 1) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER AS $snapshot$
 SELECT public.crm_v2_customer_voices_context((p->>'customerId')::uuid,(p->>'interestId')::uuid,(p->>'visitId')::uuid) FROM (SELECT runtime_voice.payload(n) p) x;
$snapshot$;
CREATE FUNCTION runtime_voice.business_snapshot() RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER AS $business$
 SELECT jsonb_build_object(
 'customers',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.sales_customers r),
 'interests',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.lead_project_interests r),
 'appointments',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.lead_appointments r),
 'sales',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.sales r),'plots',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.plots r),
 'actions',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.crm_next_actions r),'sla',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.crm_sla_tasks r),
 'runs',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.house_visit_checklist_runs r),'items',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.house_visit_checklist_items r));
$business$;
REVOKE ALL ON FUNCTION runtime_voice.business_snapshot() FROM PUBLIC;
INSERT INTO auth.users(id) SELECT ('bc260000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid FROM generate_series(1,5) n;
INSERT INTO sales_private.crm_user_roles(user_id,role,display_name,is_active) VALUES
 ('bc260000-0000-4000-8000-000000000001','admin','SYNTHETIC VOICE ADMIN',true),('bc260000-0000-4000-8000-000000000002','sales','SYNTHETIC VOICE SALES',true),
 ('bc260000-0000-4000-8000-000000000003','owner','SYNTHETIC VOICE OWNER',true),('bc260000-0000-4000-8000-000000000004','sales','SYNTHETIC VOICE OTHER',true),
 ('bc260000-0000-4000-8000-000000000005','sales','SYNTHETIC VOICE INACTIVE',false);
INSERT INTO public.projects(name,is_closed) VALUES('SYNTHETIC VOICE A',false);
INSERT INTO public.sales_customers(id,customer_name,phone,intake_channel,owner_user_id,created_by_user_id,lead_created_at)
 SELECT ('bc261000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'SYNTHETIC VOICE CUSTOMER '||n,'08926000'||lpad(n::text,2,'0'),'phone',
 'bc260000-0000-4000-8000-000000000002','bc260000-0000-4000-8000-000000000002',clock_timestamp()-interval '3 days' FROM generate_series(1,9) n;
INSERT INTO public.lead_project_interests(id,customer_id,project_name,owner_user_id,created_by_user_id)
 SELECT ('bc262000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('bc261000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 'SYNTHETIC VOICE A','bc260000-0000-4000-8000-000000000002','bc260000-0000-4000-8000-000000000002' FROM generate_series(1,9) n;
INSERT INTO public.crm_settings(id,central_intake_enabled,lead_work_enabled,lead_lifecycle_enabled,visits_enabled,customer_voices_enabled)
 VALUES(true,true,true,true,true,false) ON CONFLICT(id) DO UPDATE SET central_intake_enabled=true,lead_work_enabled=true,lead_lifecycle_enabled=true,visits_enabled=true,customer_voices_enabled=false;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','bc260000-0000-4000-8000-000000000002',true);
DO $visits$ DECLARE n integer; result jsonb; BEGIN
 FOR n IN 1..9 LOOP
 SELECT public.crm_v2_visits_command(gen_random_uuid(),jsonb_build_object('command','check_in','customerId',customer_id,'interestId',id,'expectedInterestRevision',lifecycle_revision,
 'appointmentId',NULL,'expectedAppointmentRevision',NULL,'reason','SYNTHETIC actual Visit','occurredAt',to_char(clock_timestamp(),'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))) INTO result
 FROM public.lead_project_interests WHERE id=('bc262000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
 END LOOP;
END $visits$;
SELECT runtime_voice.assert_true(public.crm_v2_customer_voices_capabilities()='{"contract_version":"customer_voices_v1","enabled":false}','Voices defaults off');
SELECT runtime_voice.expect_error('SELECT runtime_voice.snapshot()','CRM_VOICE_SETUP_REQUIRED','disabled context rejected');
SELECT runtime_voice.expect_error('SELECT public.crm_v2_customer_voices_command(gen_random_uuid(),runtime_voice.payload(1))','CRM_VOICE_SETUP_REQUIRED','disabled issue rejected');
SELECT runtime_voice.expect_error('SELECT public.crm_v2_customer_voice_open(repeat(''a'',64))','CRM_VOICE_TOKEN_UNAVAILABLE','disabled public form uniform failure');
RESET ROLE;
UPDATE public.crm_settings SET customer_voices_enabled=true WHERE id;
INSERT INTO runtime_voice.context VALUES('business-before',runtime_voice.business_snapshot());
-- Simulate the real legacy permissive ALL policy, then prove restrictive V2 privacy.
GRANT SELECT,INSERT,UPDATE,DELETE ON public.customer_voices TO authenticated,anon;
CREATE POLICY runtime_voice_legacy_allow_all ON public.customer_voices FOR ALL TO authenticated,anon USING(true) WITH CHECK(true);
INSERT INTO public.customer_voices(id,customer_name) VALUES('bc264000-0000-4000-8000-000000000001','SYNTHETIC LEGACY');
SET LOCAL ROLE authenticated;
SELECT runtime_voice.assert_true(runtime_voice.snapshot()#>>'{scope,canManage}'='true' AND runtime_voice.snapshot()->'submission'='null','actual Visit awaits real customer response');
INSERT INTO runtime_voice.context VALUES('input',runtime_voice.payload(1));
INSERT INTO runtime_voice.context VALUES('result',public.crm_v2_customer_voices_command('bc263000-0000-4000-8000-000000000001',(SELECT value FROM runtime_voice.context WHERE key='input')));
SELECT runtime_voice.assert_true(public.crm_v2_customer_voices_command('bc263000-0000-4000-8000-000000000001',(SELECT value FROM runtime_voice.context WHERE key='input'))=
 (SELECT value||'{"replayed":true}' FROM runtime_voice.context WHERE key='result'),'same staff command replayed without rotating token');
SELECT runtime_voice.expect_error('SELECT public.crm_v2_customer_voices_command(''bc263000-0000-4000-8000-000000000001'',(SELECT value||''{"reason":"changed"}'' FROM runtime_voice.context WHERE key=''input''))','CRM_VOICE_IDEMPOTENCY_CONFLICT','same request changed reason rejected');
SELECT runtime_voice.expect_error('SELECT public.crm_v2_customer_voices_command(gen_random_uuid(),runtime_voice.payload(2)||''{"actorUserId":null}'')','CRM_VOICE_INVALID_INPUT','no browser actor override');
SELECT runtime_voice.expect_error('SELECT public.crm_v2_customer_voices_command(gen_random_uuid(),runtime_voice.payload(2)||''{"tokenHash":"not-secret"}'')','CRM_VOICE_INVALID_INPUT','hash shape exact lowercase hex');
SELECT runtime_voice.expect_error('SELECT public.crm_v2_customer_voices_command(gen_random_uuid(),runtime_voice.payload(1)||''{"expectedTokenId":null}'')','CRM_VOICE_STALE_STATE','stale QR tab cannot rotate unseen token');
SELECT runtime_voice.expect_error('SELECT public.crm_v2_customer_voices_command(gen_random_uuid(),runtime_voice.payload(2)||jsonb_build_object(''expectedVisitRevision'',gen_random_uuid()))','CRM_VOICE_STALE_STATE','visit revision checked');
SELECT runtime_voice.expect_error('SELECT public.crm_v2_customer_voices_command(gen_random_uuid(),runtime_voice.payload(2)||jsonb_build_object(''expectedInterestRevision'',gen_random_uuid()))','CRM_VOICE_STALE_STATE','interest revision checked');
SELECT set_config('request.jwt.claim.sub','bc260000-0000-4000-8000-000000000004',true);
SELECT runtime_voice.assert_true(runtime_voice.snapshot()#>>'{scope,canManage}'='false','other Sales sees metadata read-only');
SELECT runtime_voice.expect_error('SELECT public.crm_v2_customer_voices_command(gen_random_uuid(),runtime_voice.payload(2))','CRM_VOICE_FORBIDDEN','other Sales cannot issue');
SELECT set_config('request.jwt.claim.sub','bc260000-0000-4000-8000-000000000003',true);
SELECT runtime_voice.expect_error('SELECT public.crm_v2_customer_voices_command(gen_random_uuid(),runtime_voice.payload(2))','CRM_VOICE_FORBIDDEN','Owner read only');
SELECT set_config('request.jwt.claim.sub','bc260000-0000-4000-8000-000000000005',true);
SELECT runtime_voice.expect_error('SELECT runtime_voice.snapshot()','CRM_VOICE_FORBIDDEN','inactive staff denied');
SELECT set_config('request.jwt.claim.sub','',true);
SET LOCAL ROLE anon;
SELECT runtime_voice.expect_error('SELECT public.crm_v2_customer_voices_context(gen_random_uuid(),gen_random_uuid(),gen_random_uuid())',NULL,'anonymous cannot read staff scope');
INSERT INTO runtime_voice.context VALUES('public-open',public.crm_v2_customer_voice_open(repeat('a',64)));
SELECT runtime_voice.assert_true((SELECT value-ARRAY['formVersion','expiresAt']='{}' FROM runtime_voice.context WHERE key='public-open'),'public open contains only form version and expiry');
SELECT runtime_voice.expect_error('SELECT public.crm_v2_customer_voice_open(encode(sha256(convert_to(repeat(''a'',64),''UTF8'')),''hex''))','CRM_VOICE_TOKEN_UNAVAILABLE','stored hash cannot be reused as public bearer for open');
SELECT runtime_voice.expect_error('SELECT public.crm_v2_customer_voice_submit(encode(sha256(convert_to(repeat(''a'',64),''UTF8'')),''hex''),gen_random_uuid(),''customer_voices_v1'',runtime_voice.answers())','CRM_VOICE_TOKEN_UNAVAILABLE','stored hash cannot be reused as public bearer for submit');
SELECT runtime_voice.expect_error('SELECT public.crm_v2_customer_voice_open(''bad'')','CRM_VOICE_TOKEN_UNAVAILABLE','invalid token uniform failure');
SELECT runtime_voice.expect_error('SELECT public.crm_v2_customer_voice_open(repeat(''f'',64))','CRM_VOICE_TOKEN_UNAVAILABLE','unknown token uniform failure');
SELECT runtime_voice.expect_error('SELECT public.crm_v2_customer_voice_submit(repeat(''a'',64),gen_random_uuid(),''customer_voices_v1'',runtime_voice.answers()-''score_price'')','CRM_VOICE_INVALID_INPUT','all eight scores required');
SELECT runtime_voice.expect_error('SELECT public.crm_v2_customer_voice_submit(repeat(''a'',64),gen_random_uuid(),''customer_voices_v1'',runtime_voice.answers()||''{"score_price":0}'')','CRM_VOICE_INVALID_INPUT','zero score rejected');
SELECT runtime_voice.expect_error('SELECT public.crm_v2_customer_voice_submit(repeat(''a'',64),gen_random_uuid(),''customer_voices_v1'',runtime_voice.answers()||''{"score_price":1.5}'')','CRM_VOICE_INVALID_INPUT','fractional score rejected');
SELECT runtime_voice.expect_error('SELECT public.crm_v2_customer_voice_submit(repeat(''a'',64),gen_random_uuid(),''customer_voices_v1'',runtime_voice.answers()||''{"score_price":"5"}'')','CRM_VOICE_INVALID_INPUT','string score rejected');
SELECT runtime_voice.expect_error('SELECT public.crm_v2_customer_voice_submit(repeat(''a'',64),gen_random_uuid(),''customer_voices_v1'',runtime_voice.answers()||''{"customer_name":"spoofed"}'')','CRM_VOICE_INVALID_INPUT','customer cannot override trusted identity');
SELECT runtime_voice.expect_error('SELECT public.crm_v2_customer_voice_submit(repeat(''a'',64),gen_random_uuid(),''wrong'',runtime_voice.answers())','CRM_VOICE_INVALID_INPUT','unknown form rejected');
SELECT runtime_voice.expect_error('SELECT public.crm_v2_customer_voice_submit(repeat(''a'',64),gen_random_uuid(),''customer_voices_v1'',runtime_voice.answers()||''{"source_tiktok":null}'')','CRM_VOICE_INVALID_INPUT','optional booleans cannot be null');
SELECT runtime_voice.expect_error('SELECT public.crm_v2_customer_voice_submit(repeat(''a'',64),gen_random_uuid(),''customer_voices_v1'',runtime_voice.answers()||jsonb_build_object(''nickname'',repeat(''x'',501)))','CRM_VOICE_INVALID_INPUT','optional text bounded');
SELECT runtime_voice.expect_error('SELECT public.crm_v2_customer_voice_submit(repeat(''a'',64),gen_random_uuid(),''customer_voices_v1'',runtime_voice.answers()||jsonb_build_object(''nickname'',chr(10)))','CRM_VOICE_INVALID_INPUT','optional text rejects controls');
SELECT runtime_voice.expect_error('SELECT public.crm_v2_customer_voice_submit(repeat(''a'',64),gen_random_uuid(),''customer_voices_v1'',runtime_voice.answers()||''{"monthly_rent":1.001}'')','CRM_VOICE_INVALID_INPUT','money two decimals only');
INSERT INTO runtime_voice.context VALUES('public-result',public.crm_v2_customer_voice_submit(repeat('a',64),'bc263000-0000-4000-8000-000000000002','customer_voices_v1',runtime_voice.answers()));
SELECT runtime_voice.assert_true((SELECT value='{"submitted":true,"replayed":false}' FROM runtime_voice.context WHERE key='public-result'),'public submit acknowledges without PII or identifiers');
SELECT runtime_voice.assert_true(public.crm_v2_customer_voice_submit(repeat('a',64),'bc263000-0000-4000-8000-000000000002','customer_voices_v1',runtime_voice.answers())='{"submitted":true,"replayed":true}','exact public retry acknowledges once');
SELECT runtime_voice.expect_error('SELECT public.crm_v2_customer_voice_submit(repeat(''a'',64),gen_random_uuid(),''customer_voices_v1'',runtime_voice.answers())','CRM_VOICE_IDEMPOTENCY_CONFLICT','consumed token rejects different request');
SELECT runtime_voice.expect_error('SELECT public.crm_v2_customer_voice_submit(repeat(''a'',64),''bc263000-0000-4000-8000-000000000002'',''customer_voices_v1'',runtime_voice.answers()||''{"score_price":5}'')','CRM_VOICE_IDEMPOTENCY_CONFLICT','consumed token rejects changed answers');
SELECT runtime_voice.expect_error('SELECT public.crm_v2_customer_voice_open(repeat(''a'',64))','CRM_VOICE_TOKEN_UNAVAILABLE','consumed token cannot reopen answers');
SELECT runtime_voice.assert_true((SELECT count(*)=0 FROM public.customer_voices WHERE visit_id IS NOT NULL),'anonymous legacy allow-all does not expose V2 answers');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','bc260000-0000-4000-8000-000000000004',true);
SELECT runtime_voice.assert_true(runtime_voice.snapshot()#>>'{visit,status}'='completed' AND runtime_voice.snapshot()#>'{submission,answers}'='null','other Sales gets completion metadata without answers');
SELECT runtime_voice.assert_true((SELECT count(*)=0 FROM public.customer_voices WHERE visit_id IS NOT NULL),'restrictive RLS blocks other Sales despite legacy ALL policy');
SELECT set_config('request.jwt.claim.sub','bc260000-0000-4000-8000-000000000002',true);
SELECT runtime_voice.assert_true(runtime_voice.snapshot()#>'{submission,answers}'=runtime_voice.answers() AND runtime_voice.snapshot()#>>'{scope,canManage}'='false','current owner can review immutable completed response');
SELECT runtime_voice.assert_true((SELECT count(*)=1 AND bool_and(lead_id IS NULL AND purpose_relocate IS NULL AND education_level IS NULL AND phone IS NULL) FROM public.customer_voices WHERE visit_id IS NOT NULL),'one submitted survey with no fabricated optional answers or legacy link');
SELECT runtime_voice.expect_error('INSERT INTO public.customer_voices(customer_name,visit_id) VALUES(''SYNTHETIC injected'',(runtime_voice.payload(2)->>''visitId'')::uuid)',NULL,'browser direct insert cannot complete survey');
UPDATE public.customer_voices SET customer_name='SYNTHETIC LEGACY EDITED' WHERE id='bc264000-0000-4000-8000-000000000001';
SELECT runtime_voice.assert_true((SELECT customer_name='SYNTHETIC LEGACY EDITED' FROM public.customer_voices WHERE id='bc264000-0000-4000-8000-000000000001'),'legacy NULL-linked row remains editable');
SELECT runtime_voice.expect_error('UPDATE public.customer_voices SET visit_id=(runtime_voice.payload(2)->>''visitId'')::uuid WHERE id=''bc264000-0000-4000-8000-000000000001''','CRM_VOICE_FORBIDDEN','legacy row cannot relink into V2');
SELECT set_config('request.jwt.claim.sub','bc260000-0000-4000-8000-000000000003',true);
SELECT runtime_voice.assert_true(runtime_voice.snapshot()#>'{submission,answers}'=runtime_voice.answers(),'Owner can review private answers');
SELECT set_config('request.jwt.claim.sub','bc260000-0000-4000-8000-000000000001',true);
SELECT runtime_voice.assert_true(runtime_voice.snapshot()#>'{submission,answers}'=runtime_voice.answers(),'Admin can review private answers');
SELECT public.crm_v2_customer_voices_command(gen_random_uuid(),runtime_voice.payload(2,'issue',repeat('b',64)));
SELECT runtime_voice.assert_true(runtime_voice.snapshot(2)->'activeToken'<>'null','Admin can issue on current owner behalf');
SELECT public.crm_v2_customer_voices_command(gen_random_uuid(),runtime_voice.payload(2,'issue',repeat('c',64)));
SELECT runtime_voice.expect_error('SELECT public.crm_v2_customer_voice_open(repeat(''b'',64))','CRM_VOICE_TOKEN_UNAVAILABLE','rotation invalidates previous QR');
SELECT public.crm_v2_customer_voices_command(gen_random_uuid(),runtime_voice.payload(2,'revoke',NULL));
SELECT runtime_voice.expect_error('SELECT public.crm_v2_customer_voice_open(repeat(''c'',64))','CRM_VOICE_TOKEN_UNAVAILABLE','revoked token uniform failure');
RESET ROLE;
SELECT runtime_voice.assert_true(runtime_voice.business_snapshot()=(SELECT value FROM runtime_voice.context WHERE key='business-before'),'survey leaves cohort interest appointment stock booking SOP work and SLA unchanged');
SELECT runtime_voice.expect_error('UPDATE public.customer_voices SET visit_id=NULL WHERE visit_id=(runtime_voice.payload(1)->>''visitId'')::uuid','CRM_VOICE_FORBIDDEN','even privileged mutation cannot unlink immutable V2');
SELECT runtime_voice.expect_error('DELETE FROM public.customer_voices WHERE visit_id=(runtime_voice.payload(1)->>''visitId'')::uuid','CRM_VOICE_FORBIDDEN','even privileged delete cannot erase V2 evidence');
SELECT runtime_voice.expect_error('UPDATE sales_private.voice_submissions SET answers=''{}''','CRM_VOICE_FORBIDDEN','submission receipts immutable');
SELECT runtime_voice.expect_error('DELETE FROM sales_private.voice_events','CRM_VOICE_FORBIDDEN','event history immutable');
INSERT INTO sales_private.visits_write_permits VALUES(txid_current(),pg_backend_pid());
SELECT runtime_voice.expect_error('UPDATE public.lead_visits SET status=''completed'',completed_at=clock_timestamp(),completed_voice_id=gen_random_uuid(),completion_evidence_state=''submitted'',revision=gen_random_uuid() WHERE id=(runtime_voice.payload(3)->>''visitId'')::uuid','CRM_VISITS_CONFLICT','old SQL23 permit never certifies Voice completion');
DELETE FROM sales_private.visits_write_permits WHERE transaction_id=txid_current();
-- Synthetic expired token is seeded through its private permit, not by changing
-- token expiry in a production command or bypassing a trigger.
INSERT INTO sales_private.voice_write_permits VALUES(txid_current(),pg_backend_pid(),(runtime_voice.payload(3)->>'visitId')::uuid,NULL);
INSERT INTO sales_private.visit_submission_tokens(visit_id,token_hash,created_at,expires_at) VALUES((runtime_voice.payload(3)->>'visitId')::uuid,encode(sha256(convert_to(repeat('d',64),'UTF8')),'hex'),clock_timestamp()-interval '2 days',clock_timestamp()-interval '1 day');
DELETE FROM sales_private.voice_write_permits WHERE transaction_id=txid_current();
SELECT runtime_voice.expect_error('SELECT public.crm_v2_customer_voice_open(repeat(''d'',64))','CRM_VOICE_TOKEN_UNAVAILABLE','expired open uniform failure');
SELECT runtime_voice.expect_error('SELECT public.crm_v2_customer_voice_submit(repeat(''d'',64),gen_random_uuid(),''customer_voices_v1'',runtime_voice.answers())','CRM_VOICE_TOKEN_UNAVAILABLE','expired submission rejected');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','bc260000-0000-4000-8000-000000000002',true);
SELECT public.crm_v2_customer_voices_command(gen_random_uuid(),runtime_voice.payload(3,'issue',repeat('e',64)));
SELECT runtime_voice.assert_true(runtime_voice.snapshot(3)->'activeToken'<>'null','expired token can be rotated with context null expected token');
SELECT public.crm_v2_visits_command(gen_random_uuid(),jsonb_build_object('command','cancel_visit','customerId',p->'customerId','interestId',p->'interestId','expectedInterestRevision',p->'expectedInterestRevision',
 'visitId',p->'visitId','expectedVisitRevision',p->'expectedVisitRevision','reason','SYNTHETIC cancellation','occurredAt',to_char(clock_timestamp(),'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))) FROM (SELECT runtime_voice.payload(3) p) x;
SELECT runtime_voice.expect_error('SELECT public.crm_v2_customer_voice_open(repeat(''e'',64))','CRM_VOICE_TOKEN_UNAVAILABLE','cancelled Visit QR becomes unavailable');
SELECT runtime_voice.expect_error('SELECT public.crm_v2_customer_voice_submit(repeat(''e'',64),gen_random_uuid(),''customer_voices_v1'',runtime_voice.answers())','CRM_VOICE_TOKEN_UNAVAILABLE','cancelled Visit cannot submit');
SELECT runtime_voice.expect_error('SELECT public.crm_v2_customer_voices_command(gen_random_uuid(),runtime_voice.payload(1,''issue'',repeat(''9'',64)))','CRM_VOICE_SCOPE_CLOSED','completed Visit cannot issue second survey');
SELECT public.crm_v2_customer_voices_command(gen_random_uuid(),runtime_voice.payload(6,'issue',repeat('6',64)));
SELECT public.crm_v2_change_lead_lifecycle(gen_random_uuid(),jsonb_build_object('command','close_lost','customerId',p->'customerId','interestId',p->'interestId',
 'expectedRevision',p->'expectedInterestRevision','expectedActionId',NULL,'reason','SYNTHETIC scope closed')) FROM (SELECT runtime_voice.payload(6) p) x;
SELECT runtime_voice.expect_error('SELECT public.crm_v2_customer_voice_open(repeat(''6'',64))','CRM_VOICE_TOKEN_UNAVAILABLE','lost interest closes its public form');
SELECT runtime_voice.expect_error('SELECT public.crm_v2_customer_voice_submit(repeat(''6'',64),gen_random_uuid(),''customer_voices_v1'',runtime_voice.answers())','CRM_VOICE_TOKEN_UNAVAILABLE','lost scope cannot submit');
SELECT public.crm_v2_customer_voices_command(gen_random_uuid(),runtime_voice.payload(7,'issue',repeat('7',64)));
SELECT runtime_voice.assert_true(public.crm_v2_customer_voice_submit(repeat('7',64),'bc263000-0000-4000-8000-000000000007','customer_voices_v1',
 runtime_voice.answers()||'{"source_tiktok":false,"nickname":"  SYNTHETIC  ","monthly_rent":123.45}')='{"submitted":true,"replayed":false}','actual optional false text and money are accepted without defaults');
SELECT runtime_voice.assert_true(public.crm_v2_customer_voice_submit(repeat('7',64),'bc263000-0000-4000-8000-000000000007','customer_voices_v1',
 runtime_voice.answers()||'{"source_tiktok":false,"nickname":"SYNTHETIC","monthly_rent":123.45}')='{"submitted":true,"replayed":true}','canonical optional text permits equivalent exact retry');
INSERT INTO runtime_voice.context VALUES('old-owner-input',runtime_voice.payload(4,'issue',repeat('4',64)));
SELECT public.crm_v2_customer_voices_command('bc263000-0000-4000-8000-000000000004',(SELECT value FROM runtime_voice.context WHERE key='old-owner-input'));
SELECT set_config('request.jwt.claim.sub','bc260000-0000-4000-8000-000000000001',true);
SELECT public.crm_v2_change_lead_lifecycle(gen_random_uuid(),jsonb_build_object('command','reassign_owner','customerId',p->'customerId','interestId',p->'interestId',
 'expectedRevision',p->'expectedInterestRevision','expectedActionId',NULL,'newOwnerUserId','bc260000-0000-4000-8000-000000000004','reason','SYNTHETIC handoff')) FROM (SELECT runtime_voice.payload(4) p) x;
SELECT set_config('request.jwt.claim.sub','bc260000-0000-4000-8000-000000000002',true);
SELECT runtime_voice.expect_error('SELECT public.crm_v2_customer_voices_command(''bc263000-0000-4000-8000-000000000004'',(SELECT value FROM runtime_voice.context WHERE key=''old-owner-input''))','CRM_VOICE_FORBIDDEN','former owner cannot replay issuance after handoff');
-- Deliberate receipt failure proves survey/Visit/token/event changes roll back together.
SELECT public.crm_v2_customer_voices_command(gen_random_uuid(),runtime_voice.payload(5,'issue',repeat('5',64)));
RESET ROLE;
CREATE FUNCTION runtime_voice.fail_receipt() RETURNS trigger LANGUAGE plpgsql AS $fail$ BEGIN RAISE EXCEPTION 'SYNTHETIC RECEIPT FAILURE'; END $fail$;
CREATE TRIGGER runtime_voice_fail_receipt BEFORE INSERT ON sales_private.voice_submissions FOR EACH ROW EXECUTE FUNCTION runtime_voice.fail_receipt();
SELECT runtime_voice.expect_error('SELECT public.crm_v2_customer_voice_submit(repeat(''5'',64),gen_random_uuid(),''customer_voices_v1'',runtime_voice.answers())','SYNTHETIC RECEIPT FAILURE','injected receipt failure rolls entire transaction back');
DROP TRIGGER runtime_voice_fail_receipt ON sales_private.voice_submissions;
SELECT runtime_voice.assert_true((SELECT status='awaiting_voice' AND completed_voice_id IS NULL FROM public.lead_visits WHERE id=(runtime_voice.payload(5)->>'visitId')::uuid)
 AND NOT EXISTS(SELECT 1 FROM public.customer_voices WHERE visit_id=(runtime_voice.payload(5)->>'visitId')::uuid)
 AND EXISTS(SELECT 1 FROM sales_private.visit_submission_tokens WHERE token_hash=encode(sha256(convert_to(repeat('5',64),'UTF8')),'hex') AND consumed_at IS NULL),'no partial response Visit completion or token consumption survives failure');
SELECT runtime_voice.assert_true(EXISTS(SELECT 1 FROM sales_private.visit_submission_tokens WHERE token_hash=encode(sha256(convert_to(repeat('a',64),'UTF8')),'hex'))
 AND NOT EXISTS(SELECT 1 FROM sales_private.visit_submission_tokens WHERE token_hash=repeat('a',64))
 AND (SELECT request_payload->>'tokenHash'=encode(sha256(convert_to(repeat('a',64),'UTF8')),'hex') AND NOT(request_payload ? 'token')
 FROM sales_private.voice_staff_requests WHERE actor_user_id='bc260000-0000-4000-8000-000000000002' AND request_id='bc263000-0000-4000-8000-000000000001'),
 'raw QR is never persisted in token storage or staff receipt');
SELECT runtime_voice.assert_true(NOT EXISTS(SELECT 1 FROM sales_private.voice_write_permits),'no reusable completion permits retained');
UPDATE public.crm_settings SET customer_voices_enabled=false WHERE id;
SELECT runtime_voice.expect_error('SELECT public.crm_v2_customer_voice_submit(repeat(''a'',64),''bc263000-0000-4000-8000-000000000002'',''customer_voices_v1'',runtime_voice.answers())','CRM_VOICE_TOKEN_UNAVAILABLE','kill switch also disables cached public acknowledgements');
UPDATE public.crm_settings SET customer_voices_enabled=true WHERE id;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','bc260000-0000-4000-8000-000000000002',true);
SELECT 'VOICE_INPUT:'||(value-'tokenHash'||jsonb_build_object('requestId','bc263000-0000-4000-8000-000000000001','token',repeat('a',64)))::text FROM runtime_voice.context WHERE key='input';
SELECT 'VOICE_RESULT:'||value::text FROM runtime_voice.context WHERE key='result';
SELECT 'VOICE_PUBLIC_INPUT:'||jsonb_build_object('command','submit','token',repeat('a',64),'requestId','bc263000-0000-4000-8000-000000000002','formVersion','customer_voices_v1','answers',runtime_voice.answers())::text;
SELECT 'VOICE_PUBLIC_RESULT:'||value::text FROM runtime_voice.context WHERE key='public-result';
SELECT 'VOICE_SNAPSHOT:'||runtime_voice.snapshot()::text;
-- Read-only transaction proves no hidden token refresh/audit/expiry mutation.
SET TRANSACTION READ ONLY;
SELECT runtime_voice.snapshot();
SELECT 'VOICE_RUNTIME:'||jsonb_build_object('assertions',(SELECT count(*) FROM runtime_voice.assertions),'readOnlyContext',true,'syntheticOnly',true,'productionCertified',false)::text;
ROLLBACK;
