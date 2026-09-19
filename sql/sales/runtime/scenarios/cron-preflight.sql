-- SYNTHETIC LOCAL PREFLIGHT TESTS ONLY. No pg_cron extension/launcher is installed.
-- The cron catalog/API below are explicitly FAKE compatibility fixtures, not
-- proof of Supabase or real pg_cron integration. Every fixture is rolled back.
BEGIN;
DO $isolation$
BEGIN
  IF current_database() !~ '^buildtrack_sales_runtime_'
    OR current_setting('buildtrack.synthetic_runtime',true) IS DISTINCT FROM 'on'
    OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet THEN
    RAISE EXCEPTION 'REFUSED: cron preflight scenarios require isolated synthetic loopback runner';
  END IF;
  IF to_regnamespace('cron') IS NOT NULL OR EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    RAISE EXCEPTION 'REFUSED: cron preflight fixtures require no existing cron catalog or extension';
  END IF;
END;
$isolation$;
CREATE SCHEMA runtime_cron;
CREATE TABLE runtime_cron.assertions(label text PRIMARY KEY);
CREATE TABLE runtime_cron.context(key text PRIMARY KEY,value jsonb NOT NULL);
CREATE FUNCTION runtime_cron.assert_true(condition boolean,label text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $assert$
BEGIN
  IF condition IS DISTINCT FROM true THEN RAISE EXCEPTION 'ASSERTION FAILED: %',label; END IF;
  INSERT INTO runtime_cron.assertions VALUES(label);
END;
$assert$;
CREATE FUNCTION runtime_cron.expect_error(statement text,expected_state text,label text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $expect$
DECLARE actual_state text;
BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS actual_state=RETURNED_SQLSTATE;
    IF actual_state<>expected_state THEN RAISE EXCEPTION 'ASSERTION FAILED: %; expected %, got %',label,expected_state,actual_state; END IF;
    INSERT INTO runtime_cron.assertions VALUES(label); RETURN;
  END;
  RAISE EXCEPTION 'ASSERTION FAILED: %; expected error',label;
END;
$expect$;
CREATE FUNCTION runtime_cron.snapshot()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $snapshot$
  SELECT jsonb_build_object(
    'settings',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.crm_settings r),
    'customers',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.sales_customers r),
    'tasks',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.crm_sla_tasks r),
    'notices',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.crm_notifications r),
    'audit',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.crm_audit_events r),
    'receipts',(SELECT jsonb_agg(to_jsonb(r) ORDER BY actor_user_id,request_id) FROM sales_private.crm_first_contact_processing_requests r),
    'cycles',(SELECT jsonb_agg(to_jsonb(r) ORDER BY actor_user_id,request_id) FROM sales_private.crm_first_contact_cycle_requests r),
    'cursor',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM sales_private.crm_first_contact_cycle_cursor r));
$snapshot$;
REVOKE ALL ON FUNCTION runtime_cron.snapshot() FROM PUBLIC;
GRANT USAGE ON SCHEMA runtime_cron TO anon,authenticated;
GRANT INSERT,SELECT ON runtime_cron.assertions,runtime_cron.context TO anon,authenticated;

INSERT INTO runtime_cron.context VALUES('initial',runtime_cron.snapshot());
INSERT INTO runtime_cron.context VALUES('missing',sales_private.crm_first_contact_cron_preflight());
SELECT runtime_cron.assert_true((SELECT value#>'{extension,installed}'='false'::jsonb
 AND value#>>'{inventory,visibility}'='missing_catalog' AND value#>'{inventory,jobCount}'='null'::jsonb
 FROM runtime_cron.context WHERE key='missing'),'absent cron is unknown inventory not zero');
SELECT runtime_cron.assert_true((SELECT value->'automationReady'='false'::jsonb
 AND value->>'blockingReason'='CRON_BINDING_NOT_VALIDATED' FROM runtime_cron.context WHERE key='missing'),
 'unvalidated actual Cron binding always blocks automation');
SELECT runtime_cron.assert_true((SELECT value#>'{cycleCandidates,sampleCount}'='0'::jsonb
 AND value#>'{cycleCandidates,countIsExact}'='true'::jsonb FROM runtime_cron.context WHERE key='missing'),
 'empty visible candidate set is exact zero');
SET LOCAL ROLE anon;
SELECT runtime_cron.expect_error('SELECT sales_private.crm_first_contact_cron_preflight()','42501','anon cannot invoke private preflight');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT runtime_cron.expect_error('SELECT sales_private.crm_first_contact_cron_preflight()','42501','authenticated cannot invoke private preflight');
SELECT runtime_cron.expect_error('SELECT sales_private.crm_first_contact_cron_inventory()','42501','authenticated cannot invoke private inventory');
RESET ROLE;
SELECT runtime_cron.assert_true(runtime_cron.snapshot()=(SELECT value FROM runtime_cron.context WHERE key='initial'),
 'initial reads and denied calls preserve full business state');

-- Fake relation/function names are not an installed extension. Never patch
-- pg_extension/pg_depend to pretend a real pg_cron integration was tested.
CREATE SCHEMA cron;
REVOKE ALL ON SCHEMA cron FROM PUBLIC;
CREATE TABLE cron.job(jobid bigint PRIMARY KEY,jobname text,schedule text,command text,database text,username text,active boolean);
REVOKE ALL ON cron.job FROM PUBLIC;
CREATE FUNCTION cron.schedule_in_database(text,text,text,text,text,boolean) RETURNS bigint LANGUAGE sql AS 'SELECT 1::bigint';
CREATE FUNCTION cron.alter_job(bigint,text,text,text,text,boolean) RETURNS void LANGUAGE sql AS 'SELECT';
SELECT runtime_cron.assert_true(sales_private.crm_first_contact_cron_preflight()#>'{extension,installed}'='false'::jsonb
 AND sales_private.crm_first_contact_cron_preflight()#>'{extension,catalogOwnedByExtension}'='false'::jsonb
 AND sales_private.crm_first_contact_cron_preflight()#>'{extension,registrationApiOwnedByExtension}'='false'::jsonb,
 'lookalike cron objects never prove extension authenticity');
SELECT runtime_cron.assert_true(sales_private.crm_first_contact_cron_inventory()->'jobCount'='0'::jsonb,
 'empty fully visible synthetic catalog can report zero separately from authenticity');
INSERT INTO cron.job VALUES
 (1,'buildtrack-sales-first-contact-v1','* * * * *','SELECT private_wrapper();','other_database','OTHER_OWNER_SECRET',false),
 (2,'buildtrack-sales-first-contact-v1','* * * * *','SELECT private_wrapper();',current_database(),'CURRENT_OWNER_SECRET',true),
 (3,'unnamed-direct09','* * * * *','SELECT public.crm_v2_process_first_contact(''TOKEN_SECRET'');',current_database(),'SECRET',true),
 (4,'unnamed-direct11','* * * * *','SELECT PUBLIC.CRM_V2_PROCESS_FIRST_CONTACT_CYCLE(''TOKEN_SECRET'');',current_database(),'SECRET',false),
 (5,'future-worker','* * * * *','CALL sales_private.crm_first_contact_worker_tick();',current_database(),'SECRET',true),
 (6,'opaque-wrapper','* * * * *','SELECT unknown_wrapper(''TOKEN_SECRET'');',current_database(),'SECRET',true),
 (7,'direct-system13','* * * * *','SELECT sales_private.crm_first_contact_worker_cycle(''TOKEN_SECRET'');',current_database(),'SECRET',false),
 (8,'direct-prepare14','* * * * *','SELECT sales_private.crm_first_contact_dispatch_prepare();',current_database(),'SECRET',true),
 (9,'direct-execute14','* * * * *','SELECT sales_private.crm_first_contact_dispatch_execute(''TOKEN_SECRET'');',current_database(),'SECRET',false);
INSERT INTO runtime_cron.context VALUES('jobs_before',(SELECT jsonb_agg(to_jsonb(j) ORDER BY jobid) FROM cron.job j));
INSERT INTO runtime_cron.context VALUES('catalog',sales_private.crm_first_contact_cron_preflight());
SELECT runtime_cron.assert_true((SELECT value#>'{inventory,jobCount}'='9'::jsonb
 AND value#>'{inventory,reservedNameCount}'='2'::jsonb AND value#>'{inventory,activeReservedNameCount}'='1'::jsonb
 FROM runtime_cron.context WHERE key='catalog'),'detect inactive and cross owner database name collisions');
SELECT runtime_cron.assert_true((SELECT value#>'{inventory,knownCommandCount}'='6'::jsonb
 AND value#>>'{inventory,commandScanCoverage}'='known_direct_calls_only' FROM runtime_cron.context WHERE key='catalog'),
 'known direct scan is case insensitive but explicitly not wrapper coverage');
SELECT runtime_cron.assert_true((SELECT value::text NOT LIKE '%SECRET%' AND value::text NOT LIKE '%private_wrapper%'
 AND value::text NOT LIKE '%other_database%' FROM runtime_cron.context WHERE key='catalog'),
 'preflight never leaks command credentials usernames or database names');
ALTER TABLE cron.job ALTER COLUMN jobname TYPE varchar(128);
SELECT runtime_cron.assert_true(sales_private.crm_first_contact_cron_inventory()->>'visibility'='unexpected_catalog'
 AND sales_private.crm_first_contact_cron_inventory()->'reservedNameCount'='null'::jsonb,'wrong column type is unknown not empty');
ALTER TABLE cron.job ALTER COLUMN jobname TYPE text;
ALTER TABLE cron.job RENAME TO stored_job;
CREATE VIEW cron.job AS SELECT * FROM cron.stored_job;
SELECT runtime_cron.assert_true(sales_private.crm_first_contact_cron_inventory()->>'visibility'='unexpected_catalog',
 'lookalike view is not accepted as cron base relation');
DROP VIEW cron.job;
ALTER TABLE cron.stored_job RENAME TO job;

CREATE ROLE runtime_cron_partial NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE runtime_cron_bypass NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS;
GRANT USAGE ON SCHEMA sales_private,runtime_cron TO runtime_cron_partial,runtime_cron_bypass;
GRANT INSERT,SELECT ON runtime_cron.assertions,runtime_cron.context TO runtime_cron_partial,runtime_cron_bypass;
GRANT EXECUTE ON FUNCTION sales_private.crm_first_contact_cron_preflight(),sales_private.crm_first_contact_cron_inventory()
 TO runtime_cron_partial,runtime_cron_bypass;
SET LOCAL ROLE runtime_cron_bypass;
SELECT runtime_cron.assert_true(sales_private.crm_first_contact_cron_inventory()->>'visibility'='insufficient_privilege',
 'bypass without schema usage does not fabricate complete inventory');
RESET ROLE;
GRANT USAGE ON SCHEMA cron TO runtime_cron_partial,runtime_cron_bypass;
SET LOCAL ROLE runtime_cron_bypass;
SELECT runtime_cron.assert_true(sales_private.crm_first_contact_cron_inventory()->>'visibility'='insufficient_privilege'
 AND sales_private.crm_first_contact_cron_inventory()->'jobCount'='null'::jsonb,'bypass without table select is unknown');
RESET ROLE;
GRANT SELECT ON cron.job TO runtime_cron_partial,runtime_cron_bypass;
ALTER TABLE cron.job ENABLE ROW LEVEL SECURITY;
CREATE POLICY hide_all_jobs ON cron.job FOR SELECT TO runtime_cron_partial USING(false);
SET LOCAL ROLE runtime_cron_partial;
SELECT runtime_cron.assert_true((SELECT count(*)=0 FROM cron.job),'synthetic RLS really hides all jobs from ordinary reader');
SELECT runtime_cron.assert_true(sales_private.crm_first_contact_cron_inventory()->>'visibility'='partial_visibility'
 AND sales_private.crm_first_contact_cron_inventory()->'jobCount'='null'::jsonb
 AND sales_private.crm_first_contact_cron_inventory()->'inventoryComplete'='false'::jsonb,
 'RLS hidden conflicts never become a clear inventory');
SELECT runtime_cron.assert_true(sales_private.crm_first_contact_cron_preflight()#>'{cycleCandidates,known}'='false'::jsonb
 AND sales_private.crm_first_contact_cron_preflight()#>'{settings,flags}'='null'::jsonb,
 'ordinary partial role cannot claim complete business counts');
RESET ROLE;
SET LOCAL ROLE runtime_cron_bypass;
SELECT runtime_cron.assert_true(sales_private.crm_first_contact_cron_inventory()->'reservedNameCount'='2'::jsonb,
 'current role with bypass and select sees full synthetic catalog');
SELECT runtime_cron.assert_true(sales_private.crm_first_contact_cron_preflight()#>'{cycleCandidates,sampleCount}'='null'::jsonb,
 'bypass without business SELECT still returns unknown candidate count');
RESET ROLE;
SELECT runtime_cron.assert_true(runtime_cron.snapshot()=(SELECT value FROM runtime_cron.context WHERE key='initial'),
 'all catalog inspections preserve tasks notifications audits receipts cursor and settings');
SELECT runtime_cron.assert_true((SELECT jsonb_agg(to_jsonb(j) ORDER BY jobid) FROM cron.job j)=
 (SELECT value FROM runtime_cron.context WHERE key='jobs_before'),'inspections never alter or overwrite any cron job');

-- Candidate sizing is a snapshot, not notification eligibility or production data.
INSERT INTO auth.users VALUES('fc140000-0000-4000-8000-000000000001');
INSERT INTO public.sales_customers(id,customer_name,phone,owner_user_id,created_by_user_id,owner_assigned_at,lead_created_at)
 SELECT ('fc140000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'SYNTHETIC Cron Lead '||i,'0000000014'||i,
 'fc140000-0000-4000-8000-000000000001','fc140000-0000-4000-8000-000000000001',transaction_timestamp(),transaction_timestamp()
 FROM generate_series(101,1011) i;
INSERT INTO public.crm_sla_tasks(id,customer_id,owner_user_id,task_type,obligation_started_at,service_due_at)
 SELECT ('fc140000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,('fc140000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
 'fc140000-0000-4000-8000-000000000001','first_contact',transaction_timestamp(),transaction_timestamp()+interval '24 hours'
 FROM generate_series(101,995) i;
SELECT runtime_cron.assert_true(sales_private.crm_first_contact_cron_preflight()#>'{cycleCandidates,sampleCount}'='895'::jsonb
 AND sales_private.crm_first_contact_cron_preflight()#>'{cycleCandidates,minimumCyclesAtCurrentCap}'='90'::jsonb
 AND sales_private.crm_first_contact_cron_preflight()#>'{cycleCandidates,countIsExact}'='true'::jsonb,
 '895 candidates require90 cycles even though no notification is proven eligible');
INSERT INTO public.crm_sla_tasks(id,customer_id,owner_user_id,task_type,obligation_started_at,service_due_at)
 SELECT ('fc140000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,('fc140000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
 'fc140000-0000-4000-8000-000000000001','first_contact',transaction_timestamp(),transaction_timestamp()+interval '24 hours'
 FROM generate_series(996,1001) i;
SELECT runtime_cron.assert_true(sales_private.crm_first_contact_cron_preflight()#>'{cycleCandidates,sampleCount}'='901'::jsonb
 AND sales_private.crm_first_contact_cron_preflight()#>'{cycleCandidates,countIsExact}'='false'::jsonb,
 'exactly901 samples are conservatively a lower bound');
INSERT INTO public.crm_sla_tasks(id,customer_id,owner_user_id,task_type,obligation_started_at,service_due_at)
 SELECT ('fc140000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,('fc140000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
 'fc140000-0000-4000-8000-000000000001','first_contact',transaction_timestamp(),transaction_timestamp()+interval '24 hours'
 FROM generate_series(1002,1011) i;
SELECT runtime_cron.assert_true(sales_private.crm_first_contact_cron_preflight()#>'{cycleCandidates,sampleCount}'='901'::jsonb,
 'larger candidate set remains bounded901');
UPDATE public.crm_sla_tasks SET status='cancelled',cancelled_at=transaction_timestamp(),
 cancelled_by_user_id='fc140000-0000-4000-8000-000000000001',cancellation_reason='SYNTHETIC preflight closed scope'
 WHERE id='fc140000-0000-4000-8000-000000000101';
UPDATE public.crm_sla_tasks SET task_type='follow_up' WHERE id='fc140000-0000-4000-8000-000000000102';
-- Reduce under cap again to establish that known out-of-scope tasks are excluded.
DELETE FROM public.crm_sla_tasks WHERE id NOT IN (
 SELECT id FROM public.crm_sla_tasks ORDER BY id LIMIT 900);
SELECT runtime_cron.assert_true(sales_private.crm_first_contact_cron_preflight()#>'{cycleCandidates,sampleCount}'='898'::jsonb,
 'closed and followup tasks are excluded from cycle candidates');
INSERT INTO public.crm_settings(id,central_intake_enabled,lead_work_enabled,lead_lifecycle_enabled,
 work_schedule_enabled,notifications_enabled,sla_preview_enabled,sla_processing_enabled,sla_cycle_enabled)
 VALUES(true,true,true,true,true,true,true,true,true);
SELECT runtime_cron.assert_true(sales_private.crm_first_contact_cron_preflight()#>'{settings,allExistingGatesEnabled}'='true'::jsonb
 AND sales_private.crm_first_contact_cron_preflight()->'automationReady'='false'::jsonb,
 'even all eight existing gates never authorizes automatic worker');
UPDATE public.crm_settings SET sla_cycle_enabled=false WHERE id;
SELECT runtime_cron.assert_true(sales_private.crm_first_contact_cron_preflight()#>'{settings,allExistingGatesEnabled}'='false'::jsonb,
 'closed existing gate is reported without changing it');
DELETE FROM public.crm_settings WHERE id;
SELECT runtime_cron.assert_true(sales_private.crm_first_contact_cron_preflight()#>'{settings,known}'='false'::jsonb
 AND sales_private.crm_first_contact_cron_preflight()#>'{settings,allExistingGatesEnabled}'='null'::jsonb,
 'missing settings are unknown instead of ready');
INSERT INTO runtime_cron.context VALUES('final_before',runtime_cron.snapshot());
SELECT sales_private.crm_first_contact_cron_preflight();
SELECT runtime_cron.assert_true(runtime_cron.snapshot()=(SELECT value FROM runtime_cron.context WHERE key='final_before'),
 'populated task read preserves full business state');
SELECT 'CRON_PREFLIGHT_RUNTIME:'||jsonb_build_object('suite','cron_preflight','assertions',count(*),
 'realCronExtensionTested',false)::text FROM runtime_cron.assertions;
ROLLBACK;
