-- LOCAL SYNTHETIC INSTALLATION CANDIDATE ONLY. No production execution path.
-- Additive to the installed foundation/external-import/booking chain. Does not
-- reinstall SQL04/05, import identities, activate features or edit legacy data.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='30s';
SET LOCAL transaction_timeout='30s';
DO $visits_install_review$
BEGIN
  IF current_database() !~ '^buildtrack_sales_runtime_[a-f0-9]+$'
    OR session_user !~ '^runtime_[a-f0-9]+$'
    OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet
    OR current_setting('buildtrack.synthetic_runtime',true) IS DISTINCT FROM 'on'
    OR current_setting('buildtrack.central_visits_release',true) IS DISTINCT FROM 'local_synthetic_v1' THEN
    RAISE EXCEPTION 'CENTRAL_VISITS_LOCAL_SYNTHETIC_ONLY';
  END IF;
  PERFORM crm_external_private.cutover_operator_check();
  PERFORM pg_advisory_xact_lock(20260929,23);
  IF NOT crm_external_private.booking_writer_ready()
    OR to_regprocedure('public.crm_v2_record_lead_work(uuid,jsonb)') IS NULL
    OR to_regprocedure('public.crm_v2_lead_work_snapshot(uuid,uuid)') IS NULL
    OR to_regprocedure('public.crm_v2_visits_command(uuid,jsonb)') IS NOT NULL
    OR to_regclass('crm_external_private.visit_workflow_releases') IS NOT NULL THEN
    RAISE EXCEPTION 'CENTRAL_VISITS_INSTALLED_BOOKING_CHAIN_REQUIRED';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.customer_voices'::regclass
    AND tgname='crm_foundation_legacy_fields_sealed' AND tgenabled IN ('O','A')
    AND tgfoid='sales_private.reject_sealed_legacy_fields()'::regprocedure)
    OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.crm_settings'::regclass
      AND tgname='external_bridge_activation_seal' AND tgenabled IN ('O','A')
      AND tgfoid='crm_external_private.reject_unreviewed_activation()'::regprocedure) THEN
    RAISE EXCEPTION 'CENTRAL_VISITS_EXPECTED_SEALS_REQUIRED';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_proc p,LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    WHERE p.pronamespace='public'::regnamespace AND p.proname IN
      ('crm_v2_lead_work_capabilities','crm_v2_lead_work_snapshot','crm_v2_record_lead_work',
       'crm_v2_lead_lifecycle_capabilities','crm_v2_lead_lifecycle_context','crm_v2_change_lead_lifecycle')
      AND a.grantee<>p.proowner) THEN RAISE EXCEPTION 'CENTRAL_VISITS_GENERAL_WORK_MUST_REMAIN_SEALED'; END IF;
END;
$visits_install_review$;
LOCK TABLE public.crm_settings,public.customer_voices,public.lead_appointments,
  public.lead_visits,public.house_visit_checklist_runs IN SHARE ROW EXCLUSIVE MODE;
CREATE TEMP TABLE central_visits_existing_functions ON COMMIT DROP AS SELECT oid FROM pg_proc;
CREATE TEMP TABLE central_visits_existing_relations ON COMMIT DROP AS SELECT oid FROM pg_class;
CREATE TEMP TABLE central_visits_settings_before ON COMMIT DROP AS SELECT to_jsonb(s) AS value FROM public.crm_settings s;
CREATE TEMP TABLE central_visits_preserved_functions ON COMMIT DROP AS
SELECT oid,pg_get_functiondef(oid) AS definition FROM pg_proc WHERE oid IN
  ('crm_external_private.guard_materialized_history()'::regprocedure,
   'crm_external_private.booking_interest_allowed(jsonb,jsonb)'::regprocedure,
   'crm_external_private.booking_activation_allowed(jsonb)'::regprocedure,
   'public.crm_v2_record_lead_work(uuid,jsonb)'::regprocedure,
   'public.crm_v2_change_lead_lifecycle(uuid,jsonb)'::regprocedure);
CREATE TEMP TABLE central_visits_shared_before ON COMMIT DROP AS
SELECT c.oid,c.relname,c.relacl,c.relowner,c.relrowsecurity,NULL::text AS data_hash
FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relname IN
  ('sales','plots','leads','customer_voices','projects','sales_customers','lead_project_interests');
DO $visits_before$
DECLARE r record; result text;
BEGIN
  FOR r IN SELECT * FROM central_visits_shared_before LOOP
    EXECUTE format('SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,''[]'')) FROM public.%I t',r.relname) INTO result;
    UPDATE central_visits_shared_before SET data_hash=result WHERE oid=r.oid;
  END LOOP;
END;
$visits_before$;

-- Reviewed source: sql/sales/23_visits_draft.sql
-- LF-normalized SHA256: 3ee0d99bcf766e9c4da7790a0518ae6cf342ecc21a8d496f07f43d27a7628768
-- SALES V2 APPOINTMENTS / CHECK-IN -- DESIGN ONLY, 2026-09-23.
-- NEVER RUN ON SUPABASE. Depends on guarded base + 04/05; disabled by default.
-- No survey completion/public token, checklist, project activation, stock,
-- booking, customer cohort, next action, reminder, KPI or legacy mutation.


ALTER TABLE public.crm_settings ADD COLUMN visits_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.lead_appointments ADD COLUMN revision uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.lead_visits ADD COLUMN revision uuid NOT NULL DEFAULT gen_random_uuid();
CREATE INDEX lead_appointments_scope_page_idx ON public.lead_appointments(project_interest_id,starts_at DESC,id DESC);
CREATE INDEX lead_visits_scope_page_idx ON public.lead_visits(project_interest_id,checked_in_at DESC,id DESC);
CREATE TABLE sales_private.visits_write_permits(transaction_id bigint PRIMARY KEY,backend_pid integer NOT NULL);
CREATE TABLE sales_private.visits_command_requests (
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL,request_payload jsonb NOT NULL,response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(actor_user_id,request_id)
);
CREATE TABLE sales_private.visits_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.sales_customers(id) ON DELETE RESTRICT,
  project_interest_id uuid NOT NULL,
  command text NOT NULL CHECK(command IN ('schedule','reschedule','cancel_appointment','no_show','check_in','cancel_visit')),
  appointment_id uuid,visit_id uuid,
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 1000),
  occurred_at timestamptz NOT NULL CHECK(isfinite(occurred_at)),
  recorded_at timestamptz NOT NULL CHECK(isfinite(recorded_at)),
  details jsonb NOT NULL CHECK(jsonb_typeof(details)='object'),
  FOREIGN KEY(project_interest_id,customer_id) REFERENCES public.lead_project_interests(id,customer_id) ON DELETE RESTRICT,
  FOREIGN KEY(appointment_id,project_interest_id) REFERENCES public.lead_appointments(id,project_interest_id) ON DELETE RESTRICT,
  FOREIGN KEY(visit_id,project_interest_id) REFERENCES public.lead_visits(id,project_interest_id) ON DELETE RESTRICT,
  CHECK(occurred_at<=recorded_at),
  CHECK((command IN ('schedule','reschedule','cancel_appointment','no_show') AND appointment_id IS NOT NULL AND visit_id IS NULL)
    OR (command IN ('check_in','cancel_visit') AND visit_id IS NOT NULL))
);
CREATE INDEX visits_events_scope_page_idx ON sales_private.visits_events(project_interest_id,recorded_at DESC,id DESC);
ALTER TABLE sales_private.visits_write_permits ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_private.visits_command_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_private.visits_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sales_private.visits_write_permits,sales_private.visits_command_requests,sales_private.visits_events FROM PUBLIC,anon,authenticated;

-- Even privileged legacy callers cannot write these V2 tables without the private
-- transaction permit. This permit never authorizes a completed Visit or evidence.
CREATE FUNCTION sales_private.crm_visits_protect_appointment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $protect_appointment$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM sales_private.visits_write_permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid()) THEN
    RAISE EXCEPTION 'CRM_VISITS_FORBIDDEN'; END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'CRM_VISITS_CONFLICT'; END IF;
  IF NOT isfinite(NEW.starts_at) OR NOT isfinite(NEW.created_at) OR NOT isfinite(NEW.updated_at)
    OR (NEW.ends_at IS NOT NULL AND NOT isfinite(NEW.ends_at)) THEN RAISE EXCEPTION 'CRM_VISITS_INVALID_INPUT'; END IF;
  IF TG_OP='INSERT' AND NEW.status<>'scheduled' THEN RAISE EXCEPTION 'CRM_VISITS_CONFLICT'; END IF;
  IF TG_OP='UPDATE' AND (OLD.status NOT IN ('scheduled','rescheduled')
    OR NEW.status NOT IN ('rescheduled','attended','cancelled','no_show')
    OR NEW.id IS DISTINCT FROM OLD.id OR NEW.project_interest_id IS DISTINCT FROM OLD.project_interest_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.notes IS DISTINCT FROM OLD.notes
    OR NEW.revision IS NOT DISTINCT FROM OLD.revision
    OR (NEW.status<>'rescheduled' AND (NEW.starts_at IS DISTINCT FROM OLD.starts_at OR NEW.ends_at IS DISTINCT FROM OLD.ends_at
      OR NEW.assigned_sales_user_id IS DISTINCT FROM OLD.assigned_sales_user_id))) THEN RAISE EXCEPTION 'CRM_VISITS_CONFLICT'; END IF;
  RETURN NEW;
END;
$protect_appointment$;
REVOKE ALL ON FUNCTION sales_private.crm_visits_protect_appointment() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER crm_visits_protect_appointment BEFORE INSERT OR UPDATE OR DELETE ON public.lead_appointments
  FOR EACH ROW EXECUTE FUNCTION sales_private.crm_visits_protect_appointment();

CREATE FUNCTION sales_private.crm_visits_protect_visit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $protect_visit$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM sales_private.visits_write_permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid()) THEN
    RAISE EXCEPTION 'CRM_VISITS_FORBIDDEN'; END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'CRM_VISITS_CONFLICT'; END IF;
  IF NEW.completed_at IS NOT NULL OR NEW.completed_voice_id IS NOT NULL OR NEW.completion_evidence_state IS NOT NULL
    OR NOT isfinite(NEW.checked_in_at) OR NOT isfinite(NEW.created_at) THEN RAISE EXCEPTION 'CRM_VISITS_CONFLICT'; END IF;
  IF TG_OP='INSERT' AND NEW.status<>'awaiting_voice' THEN RAISE EXCEPTION 'CRM_VISITS_CONFLICT'; END IF;
  IF TG_OP='UPDATE' AND (OLD.status<>'awaiting_voice' OR NEW.status<>'cancelled'
    OR NEW.id IS DISTINCT FROM OLD.id OR NEW.project_interest_id IS DISTINCT FROM OLD.project_interest_id
    OR NEW.appointment_id IS DISTINCT FROM OLD.appointment_id OR NEW.checked_in_at IS DISTINCT FROM OLD.checked_in_at
    OR NEW.checked_in_by_user_id IS DISTINCT FROM OLD.checked_in_by_user_id OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.revision IS NOT DISTINCT FROM OLD.revision) THEN RAISE EXCEPTION 'CRM_VISITS_CONFLICT'; END IF;
  RETURN NEW;
END;
$protect_visit$;
REVOKE ALL ON FUNCTION sales_private.crm_visits_protect_visit() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER crm_visits_protect_visit BEFORE INSERT OR UPDATE OR DELETE ON public.lead_visits
  FOR EACH ROW EXECUTE FUNCTION sales_private.crm_visits_protect_visit();

CREATE FUNCTION sales_private.crm_visits_protect_history()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $protect_history$
BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'CRM_VISITS_CONFLICT'; END IF;
  IF NOT EXISTS(SELECT 1 FROM sales_private.visits_write_permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid()) THEN
    RAISE EXCEPTION 'CRM_VISITS_FORBIDDEN'; END IF;
  RETURN NEW;
END;
$protect_history$;
REVOKE ALL ON FUNCTION sales_private.crm_visits_protect_history() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER crm_visits_protect_event BEFORE INSERT OR UPDATE OR DELETE ON sales_private.visits_events
  FOR EACH ROW EXECUTE FUNCTION sales_private.crm_visits_protect_history();
CREATE TRIGGER crm_visits_protect_receipt BEFORE INSERT OR UPDATE OR DELETE ON sales_private.visits_command_requests
  FOR EACH ROW EXECUTE FUNCTION sales_private.crm_visits_protect_history();

CREATE FUNCTION sales_private.crm_visits_uuid(value jsonb,nullable boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog
AS $uuid$
BEGIN
  IF nullable AND value='null'::jsonb THEN RETURN NULL; END IF;
  IF jsonb_typeof(value) IS DISTINCT FROM 'string' OR (value#>>'{}') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
    RAISE EXCEPTION 'CRM_VISITS_INVALID_INPUT'; END IF;
  RETURN (value#>>'{}')::uuid;
END;
$uuid$;
REVOKE ALL ON FUNCTION sales_private.crm_visits_uuid(jsonb,boolean) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.crm_v2_visits_capabilities()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog
AS $capabilities$
  SELECT jsonb_build_object('contract_version','visits_v1','enabled',COALESCE(public.crm_v2_role() IN ('sales','admin','owner') AND
    (SELECT central_intake_enabled AND lead_work_enabled AND lead_lifecycle_enabled AND visits_enabled FROM public.crm_settings WHERE id),false));
$capabilities$;
REVOKE ALL ON FUNCTION public.crm_v2_visits_capabilities() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_v2_visits_capabilities() TO authenticated;

CREATE FUNCTION public.crm_v2_visits_context(p_customer_id uuid,p_interest_id uuid,p_appointment_page integer DEFAULT 0,p_visit_page integer DEFAULT 0,p_event_page integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC'
AS $context$
DECLARE
  actor_id uuid:=auth.uid(); actor_role text:=public.crm_v2_role();
  c public.sales_customers%ROWTYPE; i public.lead_project_interests%ROWTYPE;
  appointments_json jsonb; visits_json jsonb; events_json jsonb;
  appointments_more boolean; visits_more boolean; events_more boolean;
BEGIN
  IF actor_id IS NULL OR COALESCE(actor_role,'') NOT IN ('sales','admin','owner') THEN RAISE EXCEPTION 'CRM_VISITS_FORBIDDEN'; END IF;
  IF (public.crm_v2_visits_capabilities()->>'enabled')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'CRM_VISITS_SETUP_REQUIRED'; END IF;
  IF p_customer_id IS NULL OR p_interest_id IS NULL OR p_appointment_page IS NULL OR p_appointment_page NOT BETWEEN 0 AND 100000
    OR p_visit_page IS NULL OR p_visit_page NOT BETWEEN 0 AND 100000 OR p_event_page IS NULL OR p_event_page NOT BETWEEN 0 AND 100000 THEN
    RAISE EXCEPTION 'CRM_VISITS_INVALID_INPUT'; END IF;
  SELECT * INTO c FROM public.sales_customers WHERE id=p_customer_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'CRM_VISITS_NOT_FOUND'; END IF;
  SELECT * INTO i FROM public.lead_project_interests WHERE id=p_interest_id AND customer_id=p_customer_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'CRM_VISITS_NOT_FOUND'; END IF;
  WITH rows AS(SELECT * FROM public.lead_appointments WHERE project_interest_id=i.id ORDER BY starts_at DESC,id DESC LIMIT 51 OFFSET p_appointment_page*50),
  numbered AS(SELECT *,row_number() OVER(ORDER BY starts_at DESC,id DESC) rn FROM rows)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'revision',revision,'startsAt',starts_at,'endsAt',ends_at,'status',status,
    'assignedSalesUserId',assigned_sales_user_id,'createdAt',created_at) ORDER BY starts_at DESC,id DESC) FILTER(WHERE rn<=50),'[]'::jsonb),count(*)>50
    INTO appointments_json,appointments_more FROM numbered;
  WITH rows AS(SELECT * FROM public.lead_visits WHERE project_interest_id=i.id ORDER BY checked_in_at DESC,id DESC LIMIT 51 OFFSET p_visit_page*50),
  numbered AS(SELECT *,row_number() OVER(ORDER BY checked_in_at DESC,id DESC) rn FROM rows)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'revision',revision,'appointmentId',appointment_id,'status',status,'checkedInAt',checked_in_at,
    'checkedInByUserId',checked_in_by_user_id,'completedAt',completed_at,'completedVoiceId',completed_voice_id) ORDER BY checked_in_at DESC,id DESC)
    FILTER(WHERE rn<=50),'[]'::jsonb),count(*)>50 INTO visits_json,visits_more FROM numbered;
  WITH rows AS(SELECT * FROM sales_private.visits_events WHERE project_interest_id=i.id ORDER BY recorded_at DESC,id DESC LIMIT 51 OFFSET p_event_page*50),
  numbered AS(SELECT *,row_number() OVER(ORDER BY recorded_at DESC,id DESC) rn FROM rows)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'command',command,'appointmentId',appointment_id,'visitId',visit_id,
    'occurredAt',occurred_at,'recordedAt',recorded_at,'actorUserId',actor_user_id,'reason',reason,'details',details) ORDER BY recorded_at DESC,id DESC)
    FILTER(WHERE rn<=50),'[]'::jsonb),count(*)>50 INTO events_json,events_more FROM numbered;
  RETURN jsonb_build_object('actor',jsonb_build_object('userId',actor_id,'role',actor_role),
    'scope',jsonb_build_object('customerId',c.id,'customerName',c.customer_name,'interestId',i.id,'projectName',i.project_name,
      'ownerUserId',i.owner_user_id,'interestRevision',i.lifecycle_revision,'engagementStatus',i.engagement_status,
      'canEdit',(actor_role='admin' OR (actor_role='sales' AND actor_id=i.owner_user_id)) AND c.merged_into_customer_id IS NULL
        AND i.engagement_status<>'lost' AND EXISTS(SELECT 1 FROM sales_private.crm_user_roles WHERE user_id=i.owner_user_id AND role='sales' AND is_active)),
    'appointments',appointments_json,'appointmentPage',p_appointment_page,'appointmentsHasMore',appointments_more,
    'visits',visits_json,'visitPage',p_visit_page,'visitsHasMore',visits_more,'events',events_json,'eventPage',p_event_page,'eventsHasMore',events_more);
END;
$context$;
REVOKE ALL ON FUNCTION public.crm_v2_visits_context(uuid,uuid,integer,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_v2_visits_context(uuid,uuid,integer,integer,integer) TO authenticated;

CREATE FUNCTION public.crm_v2_visits_command(p_request_id uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC'
AS $command$
DECLARE
  actor_id uuid:=auth.uid(); actor_role text:=public.crm_v2_role(); actor_name text; owner_active boolean:=false;
  command_name text; allowed_keys text[]; reason_value text; enabled boolean;
  customer_id_value uuid; interest_id_value uuid; expected_interest uuid; appointment_id_value uuid; expected_appointment uuid;
  visit_id_value uuid; expected_visit uuid; event_id_value uuid; response_value jsonb; details_value jsonb;
  starts_value timestamptz; ends_value timestamptz; occurred_value timestamptz; latest_event_time timestamptz; server_now timestamptz;
  c public.sales_customers%ROWTYPE; i public.lead_project_interests%ROWTYPE; a public.lead_appointments%ROWTYPE; v public.lead_visits%ROWTYPE;
  role_row sales_private.crm_user_roles%ROWTYPE; receipt sales_private.visits_command_requests%ROWTYPE;
BEGIN
  IF actor_id IS NULL OR COALESCE(actor_role,'') NOT IN ('sales','admin') THEN RAISE EXCEPTION 'CRM_VISITS_FORBIDDEN'; END IF;
  SELECT central_intake_enabled AND lead_work_enabled AND lead_lifecycle_enabled AND visits_enabled INTO enabled FROM public.crm_settings WHERE id FOR SHARE;
  IF enabled IS DISTINCT FROM true THEN RAISE EXCEPTION 'CRM_VISITS_SETUP_REQUIRED'; END IF;
  IF p_request_id IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR octet_length(p_payload::text)>16384
    OR jsonb_typeof(p_payload->'command') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'CRM_VISITS_INVALID_INPUT'; END IF;
  command_name:=p_payload->>'command';
  allowed_keys:=ARRAY['command','customerId','interestId','expectedInterestRevision','reason','occurredAt']||CASE command_name
    WHEN 'schedule' THEN ARRAY['startsAt','endsAt'] WHEN 'reschedule' THEN ARRAY['appointmentId','expectedAppointmentRevision','startsAt','endsAt']
    WHEN 'cancel_appointment' THEN ARRAY['appointmentId','expectedAppointmentRevision'] WHEN 'no_show' THEN ARRAY['appointmentId','expectedAppointmentRevision']
    WHEN 'check_in' THEN ARRAY['appointmentId','expectedAppointmentRevision'] WHEN 'cancel_visit' THEN ARRAY['visitId','expectedVisitRevision'] ELSE NULL END;
  IF command_name NOT IN ('schedule','reschedule','cancel_appointment','no_show','check_in','cancel_visit')
    OR allowed_keys IS NULL OR NOT(p_payload ?& allowed_keys) OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE NOT(k=ANY(allowed_keys)))
    OR jsonb_typeof(p_payload->'reason') IS DISTINCT FROM 'string' OR jsonb_typeof(p_payload->'occurredAt') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'CRM_VISITS_INVALID_INPUT'; END IF;
  BEGIN
    customer_id_value:=sales_private.crm_visits_uuid(p_payload->'customerId'); interest_id_value:=sales_private.crm_visits_uuid(p_payload->'interestId');
    expected_interest:=sales_private.crm_visits_uuid(p_payload->'expectedInterestRevision'); reason_value:=sales_private.crm_work_text(p_payload->>'reason',1000);
    occurred_value:=sales_private.crm_work_timestamp(p_payload->>'occurredAt');
    IF command_name IN ('schedule','reschedule') THEN
      IF jsonb_typeof(p_payload->'startsAt') IS DISTINCT FROM 'string' OR jsonb_typeof(p_payload->'endsAt') NOT IN ('string','null') THEN
        RAISE EXCEPTION 'CRM_VISITS_INVALID_INPUT'; END IF;
      starts_value:=sales_private.crm_work_timestamp(p_payload->>'startsAt');
      IF p_payload->'endsAt'<>'null'::jsonb THEN ends_value:=sales_private.crm_work_timestamp(p_payload->>'endsAt'); END IF;
    END IF;
    IF command_name IN ('reschedule','cancel_appointment','no_show','check_in') THEN
      appointment_id_value:=sales_private.crm_visits_uuid(p_payload->'appointmentId',command_name='check_in');
      expected_appointment:=sales_private.crm_visits_uuid(p_payload->'expectedAppointmentRevision',command_name='check_in');
      IF (appointment_id_value IS NULL)<>(expected_appointment IS NULL) THEN RAISE EXCEPTION 'CRM_VISITS_INVALID_INPUT'; END IF;
    ELSIF command_name='cancel_visit' THEN
      visit_id_value:=sales_private.crm_visits_uuid(p_payload->'visitId'); expected_visit:=sales_private.crm_visits_uuid(p_payload->'expectedVisitRevision');
    END IF;
  EXCEPTION WHEN raise_exception THEN RAISE EXCEPTION 'CRM_VISITS_INVALID_INPUT'; END;
  IF occurred_value<TIMESTAMPTZ '0001-01-01 00:00:00+00' OR occurred_value>=TIMESTAMPTZ '10000-01-01 00:00:00+00'
    OR starts_value<TIMESTAMPTZ '0001-01-01 00:00:00+00' OR starts_value>=TIMESTAMPTZ '10000-01-01 00:00:00+00'
    OR ends_value<TIMESTAMPTZ '0001-01-01 00:00:00+00' OR ends_value>=TIMESTAMPTZ '10000-01-01 00:00:00+00'
    OR ends_value<=starts_value THEN RAISE EXCEPTION 'CRM_VISITS_INVALID_INPUT'; END IF;

  -- Same customer -> interest -> ordered roles ordering as 04/05/18. Private
  -- request lock prevents same actor/request racing across two customer scopes.
  PERFORM pg_advisory_xact_lock(hashtextextended('visits:'||actor_id::text||':'||p_request_id::text,0));
  SELECT * INTO c FROM public.sales_customers WHERE id=customer_id_value FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CRM_VISITS_NOT_FOUND'; END IF;
  SELECT * INTO i FROM public.lead_project_interests WHERE id=interest_id_value AND customer_id=customer_id_value FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CRM_VISITS_NOT_FOUND'; END IF;
  actor_role:=NULL;
  FOR role_row IN SELECT * FROM sales_private.crm_user_roles WHERE user_id IN(actor_id,i.owner_user_id) ORDER BY user_id FOR SHARE LOOP
    IF role_row.user_id=actor_id AND role_row.is_active THEN actor_role:=role_row.role; actor_name:=role_row.display_name; END IF;
    IF role_row.user_id=i.owner_user_id THEN owner_active:=role_row.is_active AND role_row.role='sales'; END IF;
  END LOOP;
  IF COALESCE(actor_role,'') NOT IN ('sales','admin') OR (actor_role='sales' AND actor_id<>i.owner_user_id) OR NOT owner_active THEN
    RAISE EXCEPTION 'CRM_VISITS_FORBIDDEN'; END IF;
  SELECT * INTO receipt FROM sales_private.visits_command_requests WHERE actor_user_id=actor_id AND request_id=p_request_id;
  IF FOUND THEN
    IF receipt.request_payload IS DISTINCT FROM p_payload THEN RAISE EXCEPTION 'CRM_VISITS_IDEMPOTENCY_CONFLICT'; END IF;
    RETURN receipt.response||jsonb_build_object('replayed',true);
  END IF;
  IF c.merged_into_customer_id IS NOT NULL OR i.engagement_status='lost' THEN RAISE EXCEPTION 'CRM_VISITS_SCOPE_CLOSED'; END IF;
  IF i.lifecycle_revision IS DISTINCT FROM expected_interest THEN RAISE EXCEPTION 'CRM_VISITS_STALE_STATE'; END IF;
  IF command_name='cancel_visit' THEN
    SELECT appointment_id INTO appointment_id_value FROM public.lead_visits WHERE id=visit_id_value AND project_interest_id=i.id;
    IF NOT FOUND THEN RAISE EXCEPTION 'CRM_VISITS_NOT_FOUND'; END IF;
  END IF;
  IF appointment_id_value IS NOT NULL THEN
    SELECT * INTO a FROM public.lead_appointments WHERE id=appointment_id_value AND project_interest_id=i.id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'CRM_VISITS_NOT_FOUND'; END IF;
    IF command_name<>'cancel_visit' AND a.revision IS DISTINCT FROM expected_appointment THEN RAISE EXCEPTION 'CRM_VISITS_STALE_STATE'; END IF;
    IF command_name<>'cancel_visit' AND a.status NOT IN ('scheduled','rescheduled') THEN RAISE EXCEPTION 'CRM_VISITS_CONFLICT'; END IF;
  END IF;
  IF visit_id_value IS NOT NULL THEN
    SELECT * INTO v FROM public.lead_visits WHERE id=visit_id_value AND project_interest_id=i.id FOR UPDATE;
    IF NOT FOUND OR v.appointment_id IS DISTINCT FROM appointment_id_value THEN RAISE EXCEPTION 'CRM_VISITS_NOT_FOUND'; END IF;
    IF v.revision IS DISTINCT FROM expected_visit THEN RAISE EXCEPTION 'CRM_VISITS_STALE_STATE'; END IF;
    IF v.status<>'awaiting_voice' THEN RAISE EXCEPTION 'CRM_VISITS_CONFLICT'; END IF;
  END IF;
  SELECT max(occurred_at) INTO latest_event_time FROM sales_private.visits_events WHERE project_interest_id=i.id;
  server_now:=clock_timestamp();
  IF (c.lead_created_at IS NOT NULL AND NOT isfinite(c.lead_created_at))
    OR (a.id IS NOT NULL AND (NOT isfinite(a.created_at) OR NOT isfinite(a.starts_at)))
    OR (v.id IS NOT NULL AND NOT isfinite(v.checked_in_at)) THEN RAISE EXCEPTION 'CRM_VISITS_SETUP_REQUIRED'; END IF;
  IF occurred_value>server_now OR occurred_value<c.lead_created_at OR occurred_value<latest_event_time
    OR occurred_value<a.created_at OR occurred_value<v.checked_in_at OR occurred_value<v.created_at
    OR (command_name='no_show' AND occurred_value<a.starts_at)
    OR (command_name IN ('schedule','reschedule') AND starts_value<server_now) THEN RAISE EXCEPTION 'CRM_VISITS_INVALID_INPUT'; END IF;
  IF command_name='check_in' AND appointment_id_value IS NOT NULL AND EXISTS(SELECT 1 FROM public.lead_visits WHERE appointment_id=appointment_id_value) THEN
    RAISE EXCEPTION 'CRM_VISITS_CONFLICT'; END IF;

  INSERT INTO sales_private.visits_write_permits VALUES(txid_current(),pg_backend_pid());
  IF command_name='schedule' THEN
    INSERT INTO public.lead_appointments(project_interest_id,starts_at,ends_at,assigned_sales_user_id,created_at,updated_at)
      VALUES(i.id,starts_value,ends_value,i.owner_user_id,server_now,server_now) RETURNING * INTO a;
    details_value:=jsonb_build_object('startsAt',a.starts_at,'endsAt',a.ends_at,'status',a.status);
  ELSIF command_name='reschedule' THEN
    details_value:=jsonb_build_object('previousStartsAt',a.starts_at,'previousEndsAt',a.ends_at,'previousStatus',a.status,
      'startsAt',starts_value,'endsAt',ends_value,'status','rescheduled');
    UPDATE public.lead_appointments SET starts_at=starts_value,ends_at=ends_value,status='rescheduled',assigned_sales_user_id=i.owner_user_id,
      revision=gen_random_uuid(),updated_at=server_now WHERE id=a.id RETURNING * INTO a;
  ELSIF command_name IN ('cancel_appointment','no_show') THEN
    details_value:=jsonb_build_object('previousStatus',a.status,'status',CASE command_name WHEN 'no_show' THEN 'no_show' ELSE 'cancelled' END);
    UPDATE public.lead_appointments SET status=details_value->>'status',revision=gen_random_uuid(),updated_at=server_now WHERE id=a.id RETURNING * INTO a;
  ELSIF command_name='check_in' THEN
    INSERT INTO public.lead_visits(project_interest_id,appointment_id,checked_in_at,checked_in_by_user_id,created_at)
      VALUES(i.id,a.id,occurred_value,actor_id,server_now) RETURNING * INTO v;
    details_value:=jsonb_build_object('previousStatus',NULL,'status','awaiting_voice');
    IF a.id IS NOT NULL THEN
      UPDATE public.lead_appointments SET status='attended',revision=gen_random_uuid(),updated_at=server_now WHERE id=a.id RETURNING * INTO a;
    END IF;
  ELSIF command_name='cancel_visit' THEN
    details_value:=jsonb_build_object('previousStatus',v.status,'status','cancelled');
    UPDATE public.lead_visits SET status='cancelled',revision=gen_random_uuid() WHERE id=v.id RETURNING * INTO v;
    -- Attended appointment remains attended. A replacement is a new appointment/
    -- walk-in Visit; this historical row cannot manufacture a second attendance.
  END IF;
  INSERT INTO sales_private.visits_events(customer_id,project_interest_id,command,appointment_id,visit_id,actor_user_id,reason,occurred_at,recorded_at,details)
    VALUES(c.id,i.id,command_name,a.id,v.id,actor_id,reason_value,occurred_value,server_now,details_value) RETURNING id INTO event_id_value;
  INSERT INTO public.crm_audit_events(customer_id,entity_type,entity_id,event_type,reason_text,actor_user_id,actor_kind,actor_name_snapshot,new_values,occurred_at,recorded_at)
    VALUES(c.id,CASE WHEN v.id IS NULL THEN 'lead_appointment' ELSE 'lead_visit' END,COALESCE(v.id,a.id),'visits_'||command_name,
      reason_value,actor_id,'staff',actor_name,jsonb_build_object('interestId',i.id,'appointmentId',a.id,'visitId',v.id,'eventId',event_id_value,'details',details_value),occurred_value,server_now);
  response_value:=jsonb_build_object('requestId',p_request_id,'command',command_name,'customerId',c.id,'interestId',i.id,
    'appointmentId',a.id,'appointmentRevision',a.revision,'visitId',v.id,'visitRevision',v.revision,'eventId',event_id_value,'replayed',false);
  INSERT INTO sales_private.visits_command_requests(actor_user_id,request_id,request_payload,response,created_at) VALUES(actor_id,p_request_id,p_payload,response_value,server_now);
  DELETE FROM sales_private.visits_write_permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid();
  RETURN response_value;
END;
$command$;
REVOKE ALL ON FUNCTION public.crm_v2_visits_command(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_v2_visits_command(uuid,jsonb) TO authenticated;

-- No grants to anon and no public questionnaire command. Future versioned survey
-- validation must own completion + per-Visit submitted evidence atomically.

-- Reviewed source: sql/sales/25_visit_sop_draft.sql
-- LF-normalized SHA256: d79fa42b5881b8a052caa3e96dce79281161b078d3bbf4e04f0bedf0b009cf5d
-- SALES V2 VISIT SOP -- DESIGN ONLY, 2026-09-24.
-- NEVER RUN ON SUPABASE. Base + 04/05/23 dependencies, disabled by default.
-- SOP is Sales work, not Visit/Voice completion, stock reservation or KPI credit.
-- Standalone preparation and Admin correction workflows are intentionally deferred.


ALTER TABLE public.crm_settings ADD COLUMN visit_sop_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.house_visit_checklist_runs
  ADD COLUMN revision uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN departed_at timestamptz,
  ADD COLUMN next_action_id uuid REFERENCES public.crm_next_actions(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX checklist_run_per_appointment_idx ON public.house_visit_checklist_runs(appointment_id) WHERE appointment_id IS NOT NULL;
CREATE TABLE sales_private.visit_sop_write_permits(transaction_id bigint PRIMARY KEY,backend_pid integer NOT NULL);
CREATE TABLE sales_private.visit_sop_command_requests (
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL,request_payload jsonb NOT NULL,response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(actor_user_id,request_id)
);
CREATE TABLE sales_private.visit_sop_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.house_visit_checklist_runs(id) ON DELETE RESTRICT,
  command text NOT NULL CHECK(command IN ('start','save_stage','complete_stage','start_tour')),
  stage text NOT NULL CHECK(stage IN ('stage_a','stage_b','stage_c','completed')),
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 1000),
  occurred_at timestamptz NOT NULL CHECK(isfinite(occurred_at)),recorded_at timestamptz NOT NULL CHECK(isfinite(recorded_at)),
  details jsonb NOT NULL CHECK(jsonb_typeof(details)='object'),CHECK(occurred_at<=recorded_at)
);
CREATE INDEX visit_sop_events_page_idx ON sales_private.visit_sop_events(run_id,recorded_at DESC,id DESC);
ALTER TABLE sales_private.visit_sop_write_permits ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_private.visit_sop_command_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_private.visit_sop_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sales_private.visit_sop_write_permits,sales_private.visit_sop_command_requests,sales_private.visit_sop_events FROM PUBLIC,anon,authenticated;

CREATE FUNCTION sales_private.crm_sop_template()
RETURNS TABLE(stage text,item_key text,label text,ordinal integer) LANGUAGE sql IMMUTABLE SET search_path=pg_catalog
AS $template$
 VALUES
 ('stage_a','check_sample_house','ตรวจบ้านตัวอย่าง / บ้านที่จะพาชม',1),
 ('stage_a','turn_on_lights','เปิดไฟทุกจุดสำคัญ',2),
 ('stage_a','turn_on_ac','เปิดแอร์ / ระบายอากาศล่วงหน้า',3),
 ('stage_a','check_toilet','เช็กห้องน้ำ (แห้ง สะอาด กลิ่นหอม)',4),
 ('stage_a','check_cleanliness','เช็กฝุ่นและความสะอาดทั่วไป',5),
 ('stage_a','arrange_furniture','จัดระเบียบเฟอร์นิเจอร์และพร็อพ',6),
 ('stage_a','prepare_drinking_water','เตรียมน้ำดื่ม / เครื่องดื่มต้อนรับ',7),
 ('stage_a','buddha_water_sop','ถวายน้ำพระ / ตรวจพื้นที่พระตาม SOP บริษัท',8),
 ('stage_a','prepare_golf_cart','เตรียมรถกอล์ฟ (ทำความสะอาดเบาะ)',9),
 ('stage_a','check_golf_cart_battery','ตรวจระดับแบตเตอรี่รถกอล์ฟ',10),
 ('stage_a','check_tour_route','เช็กเส้นทางที่จะพาชม (ไม่มีสิ่งกีดขวาง)',11),
 ('stage_a','prepare_price_list','เตรียม Price List ล่าสุด',12),
 ('stage_a','prepare_stock_list','เตรียม Stock List / แปลงว่างล่าสุด',13),
 ('stage_a','prepare_layout','เตรียม Layout & Floor Plan แบบบ้าน',14),
 ('stage_a','check_promotions','ตรวจโปรโมชั่น / ของแถมแคมเปญล่าสุด',15),
 ('stage_a','check_loan_info','ตรวจข้อมูลสินเชื่อเบื้องต้น / ดอกเบี้ยธนาคาร',16),
 ('stage_c','turn_off_lights','ปิดไฟทุกจุด',17),
 ('stage_c','turn_off_ac','ปิดแอร์',18),
 ('stage_c','turn_off_water','ปิดน้ำ / ตรวจก๊อกน้ำ',19),
 ('stage_c','check_doors_windows','ตรวจประตูดิจิทัล & ล็อกหน้าต่างทุกบาน',20),
 ('stage_c','collect_documents','เก็บเอกสารและแผ่นพับเข้าที่',21),
 ('stage_c','reset_house_condition','เก็บบ้านและเฟอร์นิเจอร์กลับสภาพเดิม',22),
 ('stage_c','return_golf_cart','นำรถกอล์ฟคืนจุดจอดและเสียบชาร์จ',23),
 ('stage_c','record_customer_feedback','บันทึกความคิดเห็นลูกค้า',24),
 ('stage_c','record_interested_plot','บันทึกแปลงที่ลูกค้าสนใจ',25),
 ('stage_c','record_objections','บันทึกข้อกังวลของลูกค้า',26),
 ('stage_c','review_lead_stage','ทบทวนสถานะการติดตามลูกค้า',27),
 ('stage_c','set_next_action','ตรวจงานติดตามครั้งถัดไป',28),
 ('stage_c','set_next_follow_up','ตรวจวันเวลาติดตามครั้งถัดไป',29);
$template$;
REVOKE ALL ON FUNCTION sales_private.crm_sop_template() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION sales_private.crm_sop_protect_run()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $protect_run$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM sales_private.visit_sop_write_permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid()) THEN RAISE EXCEPTION 'CRM_SOP_FORBIDDEN'; END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'CRM_SOP_SCOPE_CLOSED'; END IF;
  IF NEW.template_version<>'house_visit_v1' OR NEW.project_interest_id IS NULL OR (NEW.appointment_id IS NULL AND NEW.visit_id IS NULL)
    OR NOT isfinite(NEW.created_at) OR NOT isfinite(NEW.updated_at) THEN RAISE EXCEPTION 'CRM_SOP_INVALID_INPUT'; END IF;
  IF TG_OP='INSERT' AND (NEW.current_stage<>'stage_a' OR NEW.stage_a_completed_at IS NOT NULL OR NEW.stage_b_started_at IS NOT NULL
    OR NEW.stage_c_completed_at IS NOT NULL OR NEW.departed_at IS NOT NULL OR NEW.next_action_id IS NOT NULL) THEN RAISE EXCEPTION 'CRM_SOP_INVALID_INPUT'; END IF;
  IF TG_OP='UPDATE' AND (OLD.current_stage='completed' OR NEW.id IS DISTINCT FROM OLD.id OR NEW.project_name IS DISTINCT FROM OLD.project_name
    OR NEW.plot_id IS DISTINCT FROM OLD.plot_id OR NEW.project_interest_id IS DISTINCT FROM OLD.project_interest_id
    OR NEW.appointment_id IS DISTINCT FROM OLD.appointment_id OR NEW.template_version IS DISTINCT FROM OLD.template_version
    OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.revision IS NOT DISTINCT FROM OLD.revision
    OR (OLD.visit_id IS NOT NULL AND NEW.visit_id IS DISTINCT FROM OLD.visit_id)
    OR (OLD.stage_a_completed_at IS NOT NULL AND NEW.stage_a_completed_at IS DISTINCT FROM OLD.stage_a_completed_at)
    OR (OLD.stage_b_started_at IS NOT NULL AND NEW.stage_b_started_at IS DISTINCT FROM OLD.stage_b_started_at)
    OR (OLD.stage_c_completed_at IS NOT NULL AND NEW.stage_c_completed_at IS DISTINCT FROM OLD.stage_c_completed_at)) THEN RAISE EXCEPTION 'CRM_SOP_SCOPE_CLOSED'; END IF;
  IF (NEW.stage_a_completed_at IS NOT NULL AND NOT isfinite(NEW.stage_a_completed_at))
    OR (NEW.stage_b_started_at IS NOT NULL AND (NOT isfinite(NEW.stage_b_started_at) OR NEW.stage_b_started_at<NEW.stage_a_completed_at))
    OR (NEW.departed_at IS NOT NULL AND (NOT isfinite(NEW.departed_at) OR NEW.departed_at<NEW.stage_b_started_at))
    OR (NEW.stage_c_completed_at IS NOT NULL AND (NOT isfinite(NEW.stage_c_completed_at) OR NEW.stage_c_completed_at<NEW.departed_at)) THEN RAISE EXCEPTION 'CRM_SOP_INVALID_INPUT'; END IF;
  IF NEW.visit_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.lead_visits WHERE id=NEW.visit_id AND project_interest_id=NEW.project_interest_id
    AND appointment_id IS NOT DISTINCT FROM NEW.appointment_id) THEN RAISE EXCEPTION 'CRM_SOP_NOT_FOUND'; END IF;
  RETURN NEW;
END;
$protect_run$;
REVOKE ALL ON FUNCTION sales_private.crm_sop_protect_run() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER crm_sop_protect_run BEFORE INSERT OR UPDATE OR DELETE ON public.house_visit_checklist_runs FOR EACH ROW EXECUTE FUNCTION sales_private.crm_sop_protect_run();

CREATE FUNCTION sales_private.crm_sop_protect_item()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $protect_item$
DECLARE run_stage text;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM sales_private.visit_sop_write_permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid()) THEN RAISE EXCEPTION 'CRM_SOP_FORBIDDEN'; END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'CRM_SOP_SCOPE_CLOSED'; END IF;
  SELECT current_stage INTO run_stage FROM public.house_visit_checklist_runs WHERE id=NEW.run_id;
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM sales_private.crm_sop_template() WHERE stage=NEW.stage AND item_key=NEW.item_key AND label=NEW.item_label_snapshot) THEN RAISE EXCEPTION 'CRM_SOP_INVALID_INPUT'; END IF;
  IF TG_OP='INSERT' AND (run_stage<>'stage_a' OR NEW.result<>'pending' OR NEW.answered_by_user_id IS NOT NULL OR NEW.answered_at IS NOT NULL) THEN RAISE EXCEPTION 'CRM_SOP_INVALID_INPUT'; END IF;
  IF TG_OP='UPDATE' AND (run_stage<>NEW.stage OR NEW.id IS DISTINCT FROM OLD.id OR NEW.run_id IS DISTINCT FROM OLD.run_id
    OR NEW.stage IS DISTINCT FROM OLD.stage OR NEW.item_key IS DISTINCT FROM OLD.item_key OR NEW.item_label_snapshot IS DISTINCT FROM OLD.item_label_snapshot) THEN RAISE EXCEPTION 'CRM_SOP_SCOPE_CLOSED'; END IF;
  RETURN NEW;
END;
$protect_item$;
REVOKE ALL ON FUNCTION sales_private.crm_sop_protect_item() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER crm_sop_protect_item BEFORE INSERT OR UPDATE OR DELETE ON public.house_visit_checklist_items FOR EACH ROW EXECUTE FUNCTION sales_private.crm_sop_protect_item();

CREATE FUNCTION sales_private.crm_sop_protect_history()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $protect_history$
BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'CRM_SOP_SCOPE_CLOSED'; END IF;
  IF NOT EXISTS(SELECT 1 FROM sales_private.visit_sop_write_permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid()) THEN RAISE EXCEPTION 'CRM_SOP_FORBIDDEN'; END IF;
  RETURN NEW;
END;
$protect_history$;
REVOKE ALL ON FUNCTION sales_private.crm_sop_protect_history() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER crm_sop_protect_event BEFORE INSERT OR UPDATE OR DELETE ON sales_private.visit_sop_events FOR EACH ROW EXECUTE FUNCTION sales_private.crm_sop_protect_history();
CREATE TRIGGER crm_sop_protect_receipt BEFORE INSERT OR UPDATE OR DELETE ON sales_private.visit_sop_command_requests FOR EACH ROW EXECUTE FUNCTION sales_private.crm_sop_protect_history();

CREATE FUNCTION public.crm_v2_visit_sop_capabilities()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog
AS $capabilities$
 SELECT jsonb_build_object('contract_version','visit_sop_v1','enabled',COALESCE(public.crm_v2_role() IN ('sales','admin','owner') AND
   (SELECT central_intake_enabled AND lead_work_enabled AND lead_lifecycle_enabled AND visits_enabled AND visit_sop_enabled FROM public.crm_settings WHERE id),false));
$capabilities$;
REVOKE ALL ON FUNCTION public.crm_v2_visit_sop_capabilities() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_v2_visit_sop_capabilities() TO authenticated;

CREATE FUNCTION public.crm_v2_visit_sop_context(p_customer_id uuid,p_interest_id uuid,p_appointment_id uuid,p_visit_id uuid,p_event_page integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC'
AS $context$
DECLARE
 actor_id uuid:=auth.uid(); actor_role text:=public.crm_v2_role();
 c public.sales_customers%ROWTYPE; i public.lead_project_interests%ROWTYPE; a public.lead_appointments%ROWTYPE; v public.lead_visits%ROWTYPE;
 r public.house_visit_checklist_runs%ROWTYPE; next_row public.crm_next_actions%ROWTYPE;
 plots_json jsonb; plots_more boolean; items_json jsonb; events_json jsonb; events_more boolean; run_json jsonb; matches integer; anchor_live boolean;
BEGIN
 IF actor_id IS NULL OR COALESCE(actor_role,'') NOT IN ('sales','admin','owner') THEN RAISE EXCEPTION 'CRM_SOP_FORBIDDEN'; END IF;
 IF (public.crm_v2_visit_sop_capabilities()->>'enabled')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'CRM_SOP_SETUP_REQUIRED'; END IF;
 IF p_customer_id IS NULL OR p_interest_id IS NULL OR (p_appointment_id IS NULL)=(p_visit_id IS NULL)
   OR p_event_page IS NULL OR p_event_page NOT BETWEEN 0 AND 100000 THEN RAISE EXCEPTION 'CRM_SOP_INVALID_INPUT'; END IF;
 SELECT * INTO c FROM public.sales_customers WHERE id=p_customer_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'CRM_SOP_NOT_FOUND'; END IF;
 SELECT * INTO i FROM public.lead_project_interests WHERE id=p_interest_id AND customer_id=c.id;
 IF NOT FOUND THEN RAISE EXCEPTION 'CRM_SOP_NOT_FOUND'; END IF;
 IF p_visit_id IS NOT NULL THEN
   SELECT * INTO v FROM public.lead_visits WHERE id=p_visit_id AND project_interest_id=i.id;
   IF NOT FOUND THEN RAISE EXCEPTION 'CRM_SOP_NOT_FOUND'; END IF;
   IF v.appointment_id IS NOT NULL THEN SELECT * INTO a FROM public.lead_appointments WHERE id=v.appointment_id AND project_interest_id=i.id; END IF;
 ELSE
   SELECT * INTO a FROM public.lead_appointments WHERE id=p_appointment_id AND project_interest_id=i.id;
   IF NOT FOUND THEN RAISE EXCEPTION 'CRM_SOP_NOT_FOUND'; END IF;
   SELECT * INTO v FROM public.lead_visits WHERE appointment_id=a.id AND project_interest_id=i.id;
 END IF;
 SELECT count(*) INTO matches FROM public.house_visit_checklist_runs WHERE project_interest_id=i.id
   AND ((a.id IS NOT NULL AND appointment_id=a.id) OR (v.id IS NOT NULL AND visit_id=v.id));
 IF matches>1 THEN RAISE EXCEPTION 'CRM_SOP_SETUP_REQUIRED'; END IF;
 SELECT * INTO r FROM public.house_visit_checklist_runs WHERE project_interest_id=i.id
   AND ((a.id IS NOT NULL AND appointment_id=a.id) OR (v.id IS NOT NULL AND visit_id=v.id));
 IF r.id IS NOT NULL THEN
   IF r.template_version<>'house_visit_v1' OR (SELECT count(*) FROM public.house_visit_checklist_items WHERE run_id=r.id)<>29
     OR EXISTS(SELECT 1 FROM sales_private.crm_sop_template() t WHERE NOT EXISTS(SELECT 1 FROM public.house_visit_checklist_items x WHERE x.run_id=r.id AND x.stage=t.stage AND x.item_key=t.item_key AND x.item_label_snapshot=t.label)) THEN RAISE EXCEPTION 'CRM_SOP_SETUP_REQUIRED'; END IF;
   SELECT jsonb_agg(jsonb_build_object('stage',x.stage,'key',x.item_key,'label',x.item_label_snapshot,'result',x.result,'reason',x.reason,
     'answeredByUserId',x.answered_by_user_id,'answeredAt',x.answered_at) ORDER BY t.ordinal) INTO items_json
     FROM public.house_visit_checklist_items x JOIN sales_private.crm_sop_template() t ON t.stage=x.stage AND t.item_key=x.item_key WHERE x.run_id=r.id;
   run_json:=jsonb_build_object('id',r.id,'revision',r.revision,'plotId',r.plot_id,'responsibleSalesUserId',r.responsible_sales_user_id,
     'templateVersion',r.template_version,'currentStage',r.current_stage,'stageACompletedAt',r.stage_a_completed_at,'stageBStartedAt',r.stage_b_started_at,
     'stageCCompletedAt',r.stage_c_completed_at,'departedAt',r.departed_at,'recap',jsonb_build_object('feedback',COALESCE(r.recap->>'feedback',''),'objections',COALESCE(r.recap->>'objections','')),
     'nextAction',r.next_action,'nextFollowUpAt',r.next_follow_up_at,'items',items_json,'createdAt',r.created_at,'updatedAt',r.updated_at);
 END IF;
 WITH rows AS(SELECT id FROM public.plots WHERE project_name=i.project_name ORDER BY id LIMIT 201),
 numbered AS(SELECT *,row_number() OVER(ORDER BY id) rn FROM rows)
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'name',id) ORDER BY id) FILTER(WHERE rn<=200),'[]'::jsonb),count(*)>200 INTO plots_json,plots_more FROM numbered;
 WITH rows AS(SELECT * FROM sales_private.visit_sop_events WHERE run_id=r.id ORDER BY recorded_at DESC,id DESC LIMIT 51 OFFSET p_event_page*50),
 numbered AS(SELECT *,row_number() OVER(ORDER BY recorded_at DESC,id DESC) rn FROM rows)
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'command',command,'stage',stage,'occurredAt',occurred_at,'recordedAt',recorded_at,
   'actorUserId',actor_user_id,'reason',reason) ORDER BY recorded_at DESC,id DESC) FILTER(WHERE rn<=50),'[]'::jsonb),count(*)>50 INTO events_json,events_more FROM numbered;
 SELECT * INTO next_row FROM public.crm_next_actions WHERE project_interest_id=i.id AND customer_id=c.id AND status='open';
 anchor_live:=(a.id IS NULL OR a.status IN ('scheduled','rescheduled') OR (a.status='attended' AND v.id IS NOT NULL))
   AND (v.id IS NULL OR v.status IN ('awaiting_voice','completed'));
 RETURN jsonb_build_object('actor',jsonb_build_object('userId',actor_id,'role',actor_role),
   'scope',jsonb_build_object('customerId',c.id,'customerName',c.customer_name,'interestId',i.id,'appointmentId',p_appointment_id,'visitId',p_visit_id,
     'projectName',i.project_name,'ownerUserId',i.owner_user_id,'interestRevision',i.lifecycle_revision,'engagementStatus',i.engagement_status,
     'canWrite',actor_role='sales' AND actor_id=i.owner_user_id AND c.merged_into_customer_id IS NULL AND i.engagement_status<>'lost'
       AND anchor_live AND COALESCE(r.current_stage<>'completed',true)
       AND EXISTS(SELECT 1 FROM sales_private.crm_user_roles WHERE user_id=i.owner_user_id AND role='sales' AND is_active)),
   'anchor',jsonb_build_object('appointmentStatus',a.status,'visitId',v.id,'visitStatus',v.status,'checkedInAt',v.checked_in_at),
   'plots',plots_json,'plotsHasMore',plots_more,'run',run_json,
   'nextAction',CASE WHEN next_row.id IS NULL THEN NULL ELSE jsonb_build_object('id',next_row.id,'action',next_row.action_text,'dueAt',next_row.due_at) END,
   'events',events_json,'eventPage',p_event_page,'eventsHasMore',events_more);
END;
$context$;
REVOKE ALL ON FUNCTION public.crm_v2_visit_sop_context(uuid,uuid,uuid,uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_v2_visit_sop_context(uuid,uuid,uuid,uuid,integer) TO authenticated;

CREATE FUNCTION public.crm_v2_record_visit_sop(p_request_id uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC'
AS $command$
DECLARE
 actor_id uuid:=auth.uid(); actor_role text:=public.crm_v2_role(); actor_name text; owner_active boolean:=false; enabled boolean;
 command_name text; allowed_keys text[]; reason_value text; stage_value text; plot_value text;
 customer_id_value uuid; interest_id_value uuid; appointment_input uuid; visit_input uuid; appointment_value uuid; visit_value uuid;
 expected_interest uuid; run_id_value uuid; expected_run uuid;
 occurred_value timestamptz; departed_value timestamptz; server_now timestamptz; latest_time timestamptz;
 c public.sales_customers%ROWTYPE; i public.lead_project_interests%ROWTYPE; a public.lead_appointments%ROWTYPE; v public.lead_visits%ROWTYPE;
 r public.house_visit_checklist_runs%ROWTYPE; next_row public.crm_next_actions%ROWTYPE; role_row sales_private.crm_user_roles%ROWTYPE;
 receipt sales_private.visit_sop_command_requests%ROWTYPE; answer jsonb; normalized_answers jsonb:='[]'::jsonb; answer_reason text;
 feedback_value text; objections_value text; recap_value jsonb; event_id_value uuid; response_value jsonb; matches integer;
 old_run jsonb; old_items jsonb; new_items jsonb; details_value jsonb;
 trim_chars text:=U&' \00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
BEGIN
 IF actor_id IS NULL OR actor_role IS DISTINCT FROM 'sales' THEN RAISE EXCEPTION 'CRM_SOP_FORBIDDEN'; END IF;
 SELECT central_intake_enabled AND lead_work_enabled AND lead_lifecycle_enabled AND visits_enabled AND visit_sop_enabled INTO enabled FROM public.crm_settings WHERE id FOR SHARE;
 IF enabled IS DISTINCT FROM true THEN RAISE EXCEPTION 'CRM_SOP_SETUP_REQUIRED'; END IF;
 IF p_request_id IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR octet_length(p_payload::text)>65536
   OR jsonb_typeof(p_payload->'command') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'CRM_SOP_INVALID_INPUT'; END IF;
 command_name:=p_payload->>'command';
 allowed_keys:=ARRAY['command','customerId','interestId','appointmentId','visitId','expectedInterestRevision','occurredAt','reason']||CASE command_name
   WHEN 'start' THEN ARRAY['plotId'] WHEN 'save_stage' THEN ARRAY['runId','expectedRunRevision','stage','answers','recap']
   WHEN 'complete_stage' THEN ARRAY['runId','expectedRunRevision','stage','answers','recap'] WHEN 'start_tour' THEN ARRAY['runId','expectedRunRevision'] ELSE NULL END;
 IF allowed_keys IS NULL OR NOT(p_payload ?& allowed_keys) OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE NOT(k=ANY(allowed_keys)))
   OR jsonb_typeof(p_payload->'occurredAt') IS DISTINCT FROM 'string' OR jsonb_typeof(p_payload->'reason') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'CRM_SOP_INVALID_INPUT'; END IF;
 BEGIN
   customer_id_value:=sales_private.crm_visits_uuid(p_payload->'customerId'); interest_id_value:=sales_private.crm_visits_uuid(p_payload->'interestId');
   appointment_input:=sales_private.crm_visits_uuid(p_payload->'appointmentId',true); visit_input:=sales_private.crm_visits_uuid(p_payload->'visitId',true);
   expected_interest:=sales_private.crm_visits_uuid(p_payload->'expectedInterestRevision');
   IF (appointment_input IS NULL)=(visit_input IS NULL) THEN RAISE EXCEPTION 'CRM_SOP_INVALID_INPUT'; END IF;
   occurred_value:=sales_private.crm_work_timestamp(p_payload->>'occurredAt'); reason_value:=sales_private.crm_work_text(p_payload->>'reason',1000);
   IF command_name='start' THEN
     IF jsonb_typeof(p_payload->'plotId') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'CRM_SOP_INVALID_INPUT'; END IF;
     PERFORM sales_private.crm_work_text(p_payload->>'plotId',255); plot_value:=p_payload->>'plotId';
     IF length(plot_value)>255 THEN RAISE EXCEPTION 'CRM_SOP_INVALID_INPUT'; END IF;
   ELSE run_id_value:=sales_private.crm_visits_uuid(p_payload->'runId'); expected_run:=sales_private.crm_visits_uuid(p_payload->'expectedRunRevision'); END IF;
   IF command_name IN ('save_stage','complete_stage') THEN
     IF jsonb_typeof(p_payload->'stage') IS DISTINCT FROM 'string' OR p_payload->>'stage' NOT IN ('stage_a','stage_c')
       OR jsonb_typeof(p_payload->'answers') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'CRM_SOP_INVALID_INPUT'; END IF;
     stage_value:=p_payload->>'stage';
     IF jsonb_array_length(p_payload->'answers')<>(CASE stage_value WHEN 'stage_a' THEN 16 ELSE 13 END) THEN RAISE EXCEPTION 'CRM_SOP_INVALID_INPUT'; END IF;
     FOR answer IN SELECT value FROM jsonb_array_elements(p_payload->'answers') LOOP
       IF jsonb_typeof(answer) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'CRM_SOP_INVALID_INPUT'; END IF;
       IF NOT(answer ?& ARRAY['key','result','reason']) OR EXISTS(SELECT 1 FROM jsonb_object_keys(answer) k WHERE k NOT IN ('key','result','reason'))
         OR jsonb_typeof(answer->'key') IS DISTINCT FROM 'string' OR jsonb_typeof(answer->'result') IS DISTINCT FROM 'string'
         OR answer->>'result' NOT IN ('pending','done','not_applicable','skipped') OR jsonb_typeof(answer->'reason') NOT IN ('string','null')
         OR NOT EXISTS(SELECT 1 FROM sales_private.crm_sop_template() WHERE stage=stage_value AND item_key=answer->>'key') THEN RAISE EXCEPTION 'CRM_SOP_INVALID_INPUT'; END IF;
       answer_reason:=NULL;
       IF answer->>'reason' IS NOT NULL THEN answer_reason:=sales_private.crm_work_text(answer->>'reason',1000); END IF;
       IF answer->>'result' IN ('not_applicable','skipped') AND answer_reason IS NULL THEN RAISE EXCEPTION 'CRM_SOP_INVALID_INPUT'; END IF;
       normalized_answers:=normalized_answers||jsonb_build_array(jsonb_build_object('key',answer->>'key','result',answer->>'result','reason',answer_reason));
     END LOOP;
     IF (SELECT count(DISTINCT value->>'key') FROM jsonb_array_elements(normalized_answers))<>jsonb_array_length(normalized_answers) THEN RAISE EXCEPTION 'CRM_SOP_INVALID_INPUT'; END IF;
     IF stage_value='stage_a' THEN
       IF p_payload->'recap'<>'null'::jsonb THEN RAISE EXCEPTION 'CRM_SOP_INVALID_INPUT'; END IF;
     ELSE
       recap_value:=p_payload->'recap';
       IF jsonb_typeof(recap_value) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'CRM_SOP_INVALID_INPUT'; END IF;
       IF NOT(recap_value ?& ARRAY['feedback','objections','departedAt']) OR EXISTS(SELECT 1 FROM jsonb_object_keys(recap_value) k WHERE k NOT IN ('feedback','objections','departedAt'))
         OR jsonb_typeof(recap_value->'feedback') IS DISTINCT FROM 'string' OR jsonb_typeof(recap_value->'objections') IS DISTINCT FROM 'string'
         OR jsonb_typeof(recap_value->'departedAt') NOT IN ('string','null') THEN RAISE EXCEPTION 'CRM_SOP_INVALID_INPUT'; END IF;
       IF (recap_value->>'feedback') ~ U&'[\0001-\001F\007F-\009F\2028\2029]'
         OR (recap_value->>'objections') ~ U&'[\0001-\001F\007F-\009F\2028\2029]' THEN RAISE EXCEPTION 'CRM_SOP_INVALID_INPUT'; END IF;
       feedback_value:=btrim(recap_value->>'feedback',trim_chars); objections_value:=btrim(recap_value->>'objections',trim_chars);
       IF length(feedback_value)>2000 OR length(objections_value)>2000 THEN RAISE EXCEPTION 'CRM_SOP_INVALID_INPUT'; END IF;
       IF recap_value->>'departedAt' IS NOT NULL THEN departed_value:=sales_private.crm_work_timestamp(recap_value->>'departedAt'); END IF;
     END IF;
   END IF;
 EXCEPTION WHEN raise_exception THEN RAISE EXCEPTION 'CRM_SOP_INVALID_INPUT'; END;
 IF occurred_value<TIMESTAMPTZ '0001-01-01 00:00:00+00' OR occurred_value>=TIMESTAMPTZ '10000-01-01 00:00:00+00'
   OR departed_value<TIMESTAMPTZ '0001-01-01 00:00:00+00' OR departed_value>=TIMESTAMPTZ '10000-01-01 00:00:00+00' THEN RAISE EXCEPTION 'CRM_SOP_INVALID_INPUT'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('visit-sop:'||actor_id::text||':'||p_request_id::text,0));
 SELECT * INTO c FROM public.sales_customers WHERE id=customer_id_value FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CRM_SOP_NOT_FOUND'; END IF;
 SELECT * INTO i FROM public.lead_project_interests WHERE id=interest_id_value AND customer_id=c.id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CRM_SOP_NOT_FOUND'; END IF;
 actor_role:=NULL;
 FOR role_row IN SELECT * FROM sales_private.crm_user_roles WHERE user_id IN(actor_id,i.owner_user_id) ORDER BY user_id FOR SHARE LOOP
   IF role_row.user_id=actor_id AND role_row.is_active THEN actor_role:=role_row.role; actor_name:=role_row.display_name; END IF;
   IF role_row.user_id=i.owner_user_id THEN owner_active:=role_row.is_active AND role_row.role='sales'; END IF;
 END LOOP;
 IF actor_role IS DISTINCT FROM 'sales' OR actor_id<>i.owner_user_id OR NOT owner_active THEN RAISE EXCEPTION 'CRM_SOP_FORBIDDEN'; END IF;
 SELECT * INTO receipt FROM sales_private.visit_sop_command_requests WHERE actor_user_id=actor_id AND request_id=p_request_id;
 IF FOUND THEN
   IF receipt.request_payload IS DISTINCT FROM p_payload THEN RAISE EXCEPTION 'CRM_SOP_IDEMPOTENCY_CONFLICT'; END IF;
   RETURN receipt.response||jsonb_build_object('replayed',true);
 END IF;
 IF c.merged_into_customer_id IS NOT NULL OR i.engagement_status='lost' THEN RAISE EXCEPTION 'CRM_SOP_SCOPE_CLOSED'; END IF;
 IF i.lifecycle_revision IS DISTINCT FROM expected_interest THEN RAISE EXCEPTION 'CRM_SOP_STALE_STATE'; END IF;
 appointment_value:=appointment_input; visit_value:=visit_input;
 IF visit_input IS NOT NULL THEN
   SELECT appointment_id INTO appointment_value FROM public.lead_visits WHERE id=visit_input AND project_interest_id=i.id;
   IF NOT FOUND THEN RAISE EXCEPTION 'CRM_SOP_NOT_FOUND'; END IF;
 END IF;
 IF appointment_value IS NOT NULL THEN
   SELECT * INTO a FROM public.lead_appointments WHERE id=appointment_value AND project_interest_id=i.id FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'CRM_SOP_NOT_FOUND'; END IF;
   IF visit_value IS NULL THEN SELECT id INTO visit_value FROM public.lead_visits WHERE appointment_id=a.id AND project_interest_id=i.id; END IF;
 END IF;
 IF visit_value IS NOT NULL THEN
   SELECT * INTO v FROM public.lead_visits WHERE id=visit_value AND project_interest_id=i.id FOR UPDATE;
   IF NOT FOUND OR v.appointment_id IS DISTINCT FROM a.id THEN RAISE EXCEPTION 'CRM_SOP_NOT_FOUND'; END IF;
 END IF;
 IF (a.id IS NOT NULL AND a.status NOT IN ('scheduled','rescheduled','attended')) OR (a.status='attended' AND v.id IS NULL)
   OR (v.id IS NOT NULL AND v.status NOT IN ('awaiting_voice','completed')) THEN RAISE EXCEPTION 'CRM_SOP_SCOPE_CLOSED'; END IF;
 SELECT count(*) INTO matches FROM public.house_visit_checklist_runs WHERE project_interest_id=i.id
   AND ((a.id IS NOT NULL AND appointment_id=a.id) OR (v.id IS NOT NULL AND visit_id=v.id));
 IF matches>1 THEN RAISE EXCEPTION 'CRM_SOP_SETUP_REQUIRED'; END IF;
 SELECT * INTO r FROM public.house_visit_checklist_runs WHERE project_interest_id=i.id
   AND ((a.id IS NOT NULL AND appointment_id=a.id) OR (v.id IS NOT NULL AND visit_id=v.id)) FOR UPDATE;
 IF command_name='start' THEN
   IF r.id IS NOT NULL THEN RAISE EXCEPTION 'CRM_SOP_ALREADY_STARTED'; END IF;
   PERFORM 1 FROM public.plots WHERE id=plot_value AND project_name=i.project_name FOR SHARE;
   IF NOT FOUND THEN RAISE EXCEPTION 'CRM_SOP_NOT_FOUND'; END IF;
 ELSE
   IF r.id IS NULL OR r.id<>run_id_value THEN RAISE EXCEPTION 'CRM_SOP_NOT_FOUND'; END IF;
   IF r.revision IS DISTINCT FROM expected_run THEN RAISE EXCEPTION 'CRM_SOP_STALE_STATE'; END IF;
   IF r.current_stage='completed' THEN RAISE EXCEPTION 'CRM_SOP_SCOPE_CLOSED'; END IF;
   IF r.template_version<>'house_visit_v1' OR (SELECT count(*) FROM public.house_visit_checklist_items WHERE run_id=r.id)<>29
     OR EXISTS(SELECT 1 FROM sales_private.crm_sop_template() t WHERE NOT EXISTS(SELECT 1 FROM public.house_visit_checklist_items x WHERE x.run_id=r.id AND x.stage=t.stage AND x.item_key=t.item_key AND x.item_label_snapshot=t.label)) THEN RAISE EXCEPTION 'CRM_SOP_SETUP_REQUIRED'; END IF;
   IF command_name IN ('save_stage','complete_stage') AND r.current_stage<>stage_value THEN RAISE EXCEPTION 'CRM_SOP_INCOMPLETE_STAGE'; END IF;
   IF command_name='start_tour' AND r.current_stage<>'stage_b' THEN RAISE EXCEPTION 'CRM_SOP_INCOMPLETE_STAGE'; END IF;
 END IF;
 SELECT max(occurred_at) INTO latest_time FROM sales_private.visit_sop_events WHERE run_id=r.id;
 server_now:=clock_timestamp();
 IF (c.lead_created_at IS NOT NULL AND NOT isfinite(c.lead_created_at)) OR (v.id IS NOT NULL AND NOT isfinite(v.checked_in_at)) THEN RAISE EXCEPTION 'CRM_SOP_SETUP_REQUIRED'; END IF;
 IF occurred_value>server_now OR occurred_value<c.lead_created_at OR occurred_value<latest_time OR departed_value>occurred_value
   OR departed_value<v.checked_in_at OR departed_value<r.stage_b_started_at
   OR (stage_value='stage_c' AND r.departed_at IS NOT NULL AND (departed_value IS NULL OR departed_value<r.departed_at)) THEN RAISE EXCEPTION 'CRM_SOP_INVALID_INPUT'; END IF;
 IF command_name='start_tour' AND (v.id IS NULL OR v.checked_in_at>occurred_value) THEN RAISE EXCEPTION 'CRM_SOP_VISIT_REQUIRED'; END IF;
 IF command_name='complete_stage' THEN
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(normalized_answers) x WHERE x->>'result'='pending') THEN RAISE EXCEPTION 'CRM_SOP_INCOMPLETE_STAGE'; END IF;
   IF stage_value='stage_c' THEN
     IF v.id IS NULL THEN RAISE EXCEPTION 'CRM_SOP_VISIT_REQUIRED'; END IF;
     IF departed_value IS NULL OR btrim(feedback_value)='' OR btrim(objections_value)='' THEN RAISE EXCEPTION 'CRM_SOP_INCOMPLETE_STAGE'; END IF;
     SELECT * INTO next_row FROM public.crm_next_actions WHERE customer_id=c.id AND project_interest_id=i.id AND status='open' FOR SHARE;
     IF NOT FOUND OR NOT isfinite(next_row.due_at) OR next_row.due_at<=clock_timestamp()
       OR next_row.owner_user_id IS DISTINCT FROM i.owner_user_id OR next_row.scope_key IS DISTINCT FROM 'interest:'||i.id::text
       OR length(btrim(next_row.action_text)) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'CRM_SOP_NEXT_ACTION_REQUIRED'; END IF;
   END IF;
 END IF;
 -- Recording time is sampled after every scope/run/action lock wait. Actual
 -- occurredAt remains separate and is never an automatic KPI timeliness proof.
 server_now:=clock_timestamp();
 old_run:=CASE WHEN r.id IS NULL THEN NULL ELSE to_jsonb(r) END;
 SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.stage,x.item_key),'[]'::jsonb) INTO old_items FROM public.house_visit_checklist_items x WHERE x.run_id=r.id;
 INSERT INTO sales_private.visit_sop_write_permits VALUES(txid_current(),pg_backend_pid());
 IF command_name='start' THEN
   INSERT INTO public.house_visit_checklist_runs(project_name,plot_id,project_interest_id,appointment_id,visit_id,responsible_sales_user_id,
     template_version,current_stage,recap,created_at,updated_at)
     VALUES(i.project_name,plot_value,i.id,a.id,v.id,i.owner_user_id,'house_visit_v1','stage_a','{"feedback":"","objections":""}'::jsonb,server_now,server_now) RETURNING * INTO r;
   INSERT INTO public.house_visit_checklist_items(run_id,stage,item_key,item_label_snapshot)
     SELECT r.id,stage,item_key,label FROM sales_private.crm_sop_template();
 ELSE
   IF command_name IN ('save_stage','complete_stage') THEN
     FOR answer IN SELECT value FROM jsonb_array_elements(normalized_answers) LOOP
       UPDATE public.house_visit_checklist_items SET result=answer->>'result',reason=answer->>'reason',
         answered_by_user_id=CASE WHEN answer->>'result'='pending' THEN NULL ELSE actor_id END,
         answered_at=CASE WHEN answer->>'result'='pending' THEN NULL ELSE occurred_value END
         WHERE run_id=r.id AND stage=stage_value AND item_key=answer->>'key'
           AND (result IS DISTINCT FROM answer->>'result' OR reason IS DISTINCT FROM answer->>'reason');
     END LOOP;
   END IF;
   UPDATE public.house_visit_checklist_runs SET revision=gen_random_uuid(),updated_at=server_now,
     responsible_sales_user_id=i.owner_user_id,visit_id=COALESCE(visit_id,v.id),
     current_stage=CASE WHEN command_name='start_tour' THEN 'stage_c' WHEN command_name='complete_stage' AND stage_value='stage_a' THEN 'stage_b'
       WHEN command_name='complete_stage' AND stage_value='stage_c' THEN 'completed' ELSE current_stage END,
     stage_a_completed_at=CASE WHEN command_name='complete_stage' AND stage_value='stage_a' THEN occurred_value ELSE stage_a_completed_at END,
     stage_b_started_at=CASE WHEN command_name='start_tour' THEN occurred_value ELSE stage_b_started_at END,
     stage_c_completed_at=CASE WHEN command_name='complete_stage' AND stage_value='stage_c' THEN occurred_value ELSE stage_c_completed_at END,
     departed_at=CASE WHEN stage_value='stage_c' THEN departed_value ELSE departed_at END,
     recap=CASE WHEN stage_value='stage_c' THEN jsonb_build_object('feedback',feedback_value,'objections',objections_value) ELSE recap END,
     next_action_id=CASE WHEN command_name='complete_stage' AND stage_value='stage_c' THEN next_row.id ELSE next_action_id END,
     next_action=CASE WHEN command_name='complete_stage' AND stage_value='stage_c' THEN next_row.action_text ELSE next_action END,
     next_follow_up_at=CASE WHEN command_name='complete_stage' AND stage_value='stage_c' THEN next_row.due_at ELSE next_follow_up_at END
     WHERE id=r.id RETURNING * INTO r;
 END IF;
 SELECT jsonb_agg(to_jsonb(x) ORDER BY x.stage,x.item_key) INTO new_items FROM public.house_visit_checklist_items x WHERE x.run_id=r.id;
 details_value:=jsonb_build_object('beforeRun',old_run,'afterRun',to_jsonb(r),'beforeItems',old_items,'afterItems',new_items,
   'previousResponsibleSalesUserId',old_run->'responsible_sales_user_id','responsibleSalesUserId',r.responsible_sales_user_id,'nextActionId',next_row.id);
 INSERT INTO sales_private.visit_sop_events(run_id,command,stage,actor_user_id,reason,occurred_at,recorded_at,details)
   VALUES(r.id,command_name,r.current_stage,actor_id,reason_value,occurred_value,server_now,details_value) RETURNING id INTO event_id_value;
 INSERT INTO public.crm_audit_events(customer_id,entity_type,entity_id,event_type,reason_text,actor_user_id,actor_kind,actor_name_snapshot,old_values,new_values,occurred_at,recorded_at)
   VALUES(c.id,'house_visit_checklist_run',r.id,'visit_sop_'||command_name,reason_value,actor_id,'staff',actor_name,
     jsonb_build_object('responsibleSalesUserId',old_run->'responsible_sales_user_id','stage',old_run->'current_stage'),
     jsonb_build_object('eventId',event_id_value,'interestId',i.id,'appointmentId',a.id,'visitId',v.id,'stage',r.current_stage,
       'responsibleSalesUserId',r.responsible_sales_user_id,'nextActionId',next_row.id),occurred_value,server_now);
 response_value:=jsonb_build_object('requestId',p_request_id,'command',command_name,'customerId',c.id,'interestId',i.id,'runId',r.id,'runRevision',r.revision,
   'stage',r.current_stage,'appointmentId',r.appointment_id,'visitId',r.visit_id,'eventId',event_id_value,'replayed',false);
 INSERT INTO sales_private.visit_sop_command_requests(actor_user_id,request_id,request_payload,response,created_at) VALUES(actor_id,p_request_id,p_payload,response_value,server_now);
 DELETE FROM sales_private.visit_sop_write_permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid();
 RETURN response_value;
END;
$command$;
REVOKE ALL ON FUNCTION public.crm_v2_record_visit_sop(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_v2_record_visit_sop(uuid,jsonb) TO authenticated;

-- Reviewed source: sql/sales/26_customer_voices_draft.sql
-- LF-normalized SHA256: 71610ea2d8b27b7ad1f457f28dd852578b6eca22ce9b3ecfb5d01e4fb41e1204
-- CUSTOMER VOICES PER VISIT -- DESIGN ONLY, 2026-09-24.
-- NEVER RUN ON SUPABASE. Depends on base + 04/05/23; default off.
-- Legacy survey columns are verified in sales_funnel_and_leads_migration.sql.
-- Only hashes are stored. Public replies contain no identity, answers or scope IDs.
-- Public raw-token parameters require request/statement log redaction before activation.

ALTER TABLE public.crm_settings
 ADD COLUMN customer_voices_enabled boolean NOT NULL DEFAULT false,
 ADD COLUMN voice_token_ttl_hours integer NOT NULL DEFAULT 24 CHECK(voice_token_ttl_hours BETWEEN 1 AND 168);
CREATE UNIQUE INDEX voice_one_active_token_idx ON sales_private.visit_submission_tokens(visit_id)
 WHERE consumed_at IS NULL AND revoked_at IS NULL;
CREATE TABLE sales_private.voice_write_permits(
 transaction_id bigint PRIMARY KEY,backend_pid integer NOT NULL,visit_id uuid NOT NULL,voice_id uuid
);
CREATE TABLE sales_private.voice_staff_requests(
 actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,request_id uuid NOT NULL,
 request_payload jsonb NOT NULL,response jsonb NOT NULL,created_at timestamptz NOT NULL,PRIMARY KEY(actor_user_id,request_id)
);
CREATE TABLE sales_private.voice_submissions(
 token_id uuid PRIMARY KEY REFERENCES sales_private.visit_submission_tokens(id) ON DELETE RESTRICT,
 request_id uuid NOT NULL,form_version text NOT NULL,answers jsonb NOT NULL,
 voice_id uuid NOT NULL UNIQUE REFERENCES public.customer_voices(id) ON DELETE RESTRICT,submitted_at timestamptz NOT NULL
);
CREATE TABLE sales_private.voice_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),visit_id uuid NOT NULL REFERENCES public.lead_visits(id) ON DELETE RESTRICT,
 token_id uuid NOT NULL REFERENCES sales_private.visit_submission_tokens(id) ON DELETE RESTRICT,
 command text NOT NULL CHECK(command IN ('issue','revoke','submit')),actor_user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 1000),recorded_at timestamptz NOT NULL CHECK(isfinite(recorded_at))
);
ALTER TABLE sales_private.voice_write_permits ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_private.voice_staff_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_private.voice_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_private.voice_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sales_private.voice_write_permits,sales_private.voice_staff_requests,sales_private.voice_submissions,sales_private.voice_events FROM PUBLIC,anon,authenticated;

CREATE FUNCTION sales_private.crm_voice_answers(p_answers jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $answers$
DECLARE k text; n numeric; result jsonb:='{}';
 scores text[]:=ARRAY['score_knowledge','score_problem_solving','score_service_mind','score_appearance','score_cleanliness','score_house_design','score_price','score_location'];
 texts text[]:=ARRAY['nickname','line_id','age','gender','marital_status','occupation','monthly_income','family_members','previous_residence','reason_other','source_other'];
 choices text[]:=ARRAY['purpose_relocate','purpose_family_expansion','purpose_independence','purpose_rent_to_own','purpose_debt_consolidation',
 'reason_price','reason_location','reason_promotion','reason_design','reason_house_type','source_facebook','source_tiktok','source_youtube','source_billboard'];
BEGIN
 IF jsonb_typeof(p_answers) IS DISTINCT FROM 'object' OR octet_length(p_answers::text)>16384 THEN RAISE EXCEPTION 'CRM_VOICE_INVALID_INPUT'; END IF;
 IF NOT(p_answers ?& scores) OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_answers) x WHERE NOT(x=ANY(scores||texts||choices||ARRAY['monthly_rent']))) THEN RAISE EXCEPTION 'CRM_VOICE_INVALID_INPUT'; END IF;
 FOREACH k IN ARRAY scores LOOP
  IF jsonb_typeof(p_answers->k) IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'CRM_VOICE_INVALID_INPUT'; END IF;
  n:=(p_answers->>k)::numeric;
  IF n<>trunc(n) OR n NOT BETWEEN 1 AND 5 THEN RAISE EXCEPTION 'CRM_VOICE_INVALID_INPUT'; END IF;
  result:=result||jsonb_build_object(k,n::integer);
 END LOOP;
 FOREACH k IN ARRAY texts LOOP
  IF p_answers ? k THEN
   IF jsonb_typeof(p_answers->k) IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'CRM_VOICE_INVALID_INPUT'; END IF;
   BEGIN result:=result||jsonb_build_object(k,sales_private.crm_work_text(p_answers->>k,500));
   EXCEPTION WHEN raise_exception THEN RAISE EXCEPTION 'CRM_VOICE_INVALID_INPUT'; END;
  END IF;
 END LOOP;
 FOREACH k IN ARRAY choices LOOP
  IF p_answers ? k THEN
   IF jsonb_typeof(p_answers->k) IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'CRM_VOICE_INVALID_INPUT'; END IF;
   result:=result||jsonb_build_object(k,p_answers->k);
  END IF;
 END LOOP;
 IF p_answers ? 'monthly_rent' THEN
  IF jsonb_typeof(p_answers->'monthly_rent') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'CRM_VOICE_INVALID_INPUT'; END IF;
  n:=(p_answers->>'monthly_rent')::numeric;
  IF n NOT BETWEEN 0 AND 9999999.99 OR n<>round(n,2) THEN RAISE EXCEPTION 'CRM_VOICE_INVALID_INPUT'; END IF;
  result:=result||jsonb_build_object('monthly_rent',n);
 END IF;
 RETURN result;
END;
$answers$;
REVOKE ALL ON FUNCTION sales_private.crm_voice_answers(jsonb) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION sales_private.crm_voice_protect_history()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $history$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'CRM_VOICE_FORBIDDEN'; END IF;
 IF NOT EXISTS(SELECT 1 FROM sales_private.voice_write_permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid()) THEN RAISE EXCEPTION 'CRM_VOICE_FORBIDDEN'; END IF;
 RETURN NEW;
END;
$history$;
REVOKE ALL ON FUNCTION sales_private.crm_voice_protect_history() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER voice_staff_receipt_immutable BEFORE INSERT OR UPDATE OR DELETE ON sales_private.voice_staff_requests FOR EACH ROW EXECUTE FUNCTION sales_private.crm_voice_protect_history();
CREATE TRIGGER voice_submission_immutable BEFORE INSERT OR UPDATE OR DELETE ON sales_private.voice_submissions FOR EACH ROW EXECUTE FUNCTION sales_private.crm_voice_protect_history();
CREATE TRIGGER voice_event_immutable BEFORE INSERT OR UPDATE OR DELETE ON sales_private.voice_events FOR EACH ROW EXECUTE FUNCTION sales_private.crm_voice_protect_history();
CREATE FUNCTION sales_private.crm_voice_protect_token()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $token_guard$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'CRM_VOICE_FORBIDDEN'; END IF;
 IF NOT EXISTS(SELECT 1 FROM sales_private.voice_write_permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid() AND visit_id=NEW.visit_id) THEN RAISE EXCEPTION 'CRM_VOICE_FORBIDDEN'; END IF;
 IF NEW.token_hash !~ '^[a-f0-9]{64}$' OR NOT isfinite(NEW.created_at) OR NOT isfinite(NEW.expires_at) THEN RAISE EXCEPTION 'CRM_VOICE_INVALID_INPUT'; END IF;
 IF TG_OP='INSERT' AND (NEW.revoked_at IS NOT NULL OR NEW.consumed_at IS NOT NULL) THEN RAISE EXCEPTION 'CRM_VOICE_FORBIDDEN'; END IF;
 IF TG_OP='UPDATE' AND (OLD.consumed_at IS NOT NULL OR OLD.revoked_at IS NOT NULL
   OR (to_jsonb(NEW)-ARRAY['consumed_at','revoked_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['consumed_at','revoked_at'])
   OR (NEW.consumed_at IS NULL)=(NEW.revoked_at IS NULL)
   OR (NEW.consumed_at IS NOT NULL AND NOT isfinite(NEW.consumed_at)) OR (NEW.revoked_at IS NOT NULL AND NOT isfinite(NEW.revoked_at))) THEN RAISE EXCEPTION 'CRM_VOICE_FORBIDDEN'; END IF;
 RETURN NEW;
END;
$token_guard$;
REVOKE ALL ON FUNCTION sales_private.crm_voice_protect_token() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER voice_token_guard BEFORE INSERT OR UPDATE OR DELETE ON sales_private.visit_submission_tokens FOR EACH ROW EXECUTE FUNCTION sales_private.crm_voice_protect_token();
CREATE FUNCTION sales_private.crm_voice_protect_row()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $row_guard$
BEGIN
 -- Legacy NULL-linked rows remain under their existing policies; neither direction
 -- of changing visit_id is an escape hatch for V2 immutability.
 IF TG_OP='DELETE' THEN
  IF OLD.visit_id IS NOT NULL THEN RAISE EXCEPTION 'CRM_VOICE_FORBIDDEN'; END IF; RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' THEN
  IF OLD.visit_id IS NOT NULL OR NEW.visit_id IS NOT NULL THEN RAISE EXCEPTION 'CRM_VOICE_FORBIDDEN'; END IF; RETURN NEW;
 END IF;
 IF NEW.visit_id IS NULL THEN RETURN NEW; END IF;
 IF NOT EXISTS(SELECT 1 FROM sales_private.voice_write_permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid() AND visit_id=NEW.visit_id AND voice_id=NEW.id)
   OR NEW.crm_submission_state<>'submitted' OR NEW.crm_form_version<>'customer_voices_v1' OR NEW.crm_submitted_by_customer IS DISTINCT FROM true
   OR NEW.crm_answers IS DISTINCT FROM sales_private.crm_voice_answers(NEW.crm_answers)
   OR NEW.crm_submitted_at IS DISTINCT FROM NEW.crm_validated_at OR NOT isfinite(NEW.crm_submitted_at) THEN RAISE EXCEPTION 'CRM_VOICE_FORBIDDEN'; END IF;
 RETURN NEW;
END;
$row_guard$;
REVOKE ALL ON FUNCTION sales_private.crm_voice_protect_row() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER voice_v2_row_guard BEFORE INSERT OR UPDATE OR DELETE ON public.customer_voices FOR EACH ROW EXECUTE FUNCTION sales_private.crm_voice_protect_row();

-- Add ONLY a narrow submitted-evidence completion path. The original SQL23
-- permit still allows only check-in/cancellation and can never complete a Visit.
CREATE OR REPLACE FUNCTION sales_private.crm_visits_protect_visit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $protect_visit$
BEGIN
 IF TG_OP='UPDATE' AND EXISTS(SELECT 1 FROM sales_private.voice_write_permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid() AND visit_id=OLD.id AND voice_id=NEW.completed_voice_id) THEN
  IF OLD.status<>'awaiting_voice' OR NEW.status<>'completed' OR NEW.completion_evidence_state IS DISTINCT FROM 'submitted'
    OR NEW.revision IS NOT DISTINCT FROM OLD.revision OR NOT isfinite(NEW.completed_at) OR NEW.completed_at<OLD.checked_in_at
    OR (to_jsonb(NEW)-ARRAY['status','completed_at','completed_voice_id','completion_evidence_state','revision']) IS DISTINCT FROM
       (to_jsonb(OLD)-ARRAY['status','completed_at','completed_voice_id','completion_evidence_state','revision'])
    OR NOT EXISTS(SELECT 1 FROM public.customer_voices WHERE id=NEW.completed_voice_id AND visit_id=NEW.id AND crm_submission_state='submitted'
      AND crm_form_version='customer_voices_v1' AND crm_submitted_by_customer AND crm_submitted_at=NEW.completed_at AND crm_validated_at=NEW.completed_at)
    THEN RAISE EXCEPTION 'CRM_VOICE_FORBIDDEN'; END IF;
  RETURN NEW;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM sales_private.visits_write_permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid()) THEN RAISE EXCEPTION 'CRM_VISITS_FORBIDDEN'; END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'CRM_VISITS_CONFLICT'; END IF;
 IF NEW.completed_at IS NOT NULL OR NEW.completed_voice_id IS NOT NULL OR NEW.completion_evidence_state IS NOT NULL
   OR NOT isfinite(NEW.checked_in_at) OR NOT isfinite(NEW.created_at) THEN RAISE EXCEPTION 'CRM_VISITS_CONFLICT'; END IF;
 IF TG_OP='INSERT' AND NEW.status<>'awaiting_voice' THEN RAISE EXCEPTION 'CRM_VISITS_CONFLICT'; END IF;
 IF TG_OP='UPDATE' AND (OLD.status<>'awaiting_voice' OR NEW.status<>'cancelled'
   OR NEW.id IS DISTINCT FROM OLD.id OR NEW.project_interest_id IS DISTINCT FROM OLD.project_interest_id
   OR NEW.appointment_id IS DISTINCT FROM OLD.appointment_id OR NEW.checked_in_at IS DISTINCT FROM OLD.checked_in_at
   OR NEW.checked_in_by_user_id IS DISTINCT FROM OLD.checked_in_by_user_id OR NEW.created_at IS DISTINCT FROM OLD.created_at
   OR NEW.revision IS NOT DISTINCT FROM OLD.revision) THEN RAISE EXCEPTION 'CRM_VISITS_CONFLICT'; END IF;
 RETURN NEW;
END;
$protect_visit$;
REVOKE ALL ON FUNCTION sales_private.crm_visits_protect_visit() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.crm_v2_voice_row_readable(p_visit_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $readable$
 SELECT COALESCE(public.crm_v2_role() IN ('admin','owner') OR (public.crm_v2_role()='sales' AND EXISTS(
  SELECT 1 FROM public.lead_visits v JOIN public.lead_project_interests i ON i.id=v.project_interest_id WHERE v.id=p_visit_id AND i.owner_user_id=auth.uid())),false);
$readable$;
REVOKE ALL ON FUNCTION public.crm_v2_voice_row_readable(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_v2_voice_row_readable(uuid) TO authenticated,anon;
ALTER TABLE public.customer_voices ENABLE ROW LEVEL SECURITY;
-- Restrictive policies intersect legacy permissive SELECT / ALL policies.
CREATE POLICY voice_v2_private_read ON public.customer_voices AS RESTRICTIVE FOR SELECT TO authenticated,anon
 USING(visit_id IS NULL OR public.crm_v2_voice_row_readable(visit_id));
CREATE POLICY voice_v2_no_insert ON public.customer_voices AS RESTRICTIVE FOR INSERT TO authenticated,anon WITH CHECK(visit_id IS NULL);
CREATE POLICY voice_v2_no_update ON public.customer_voices AS RESTRICTIVE FOR UPDATE TO authenticated,anon USING(visit_id IS NULL) WITH CHECK(visit_id IS NULL);
CREATE POLICY voice_v2_no_delete ON public.customer_voices AS RESTRICTIVE FOR DELETE TO authenticated,anon USING(visit_id IS NULL);

CREATE FUNCTION public.crm_v2_customer_voices_capabilities()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $capabilities$
 SELECT jsonb_build_object('contract_version','customer_voices_v1','enabled',COALESCE(public.crm_v2_role() IN ('sales','admin','owner') AND
 (SELECT central_intake_enabled AND lead_work_enabled AND lead_lifecycle_enabled AND visits_enabled AND customer_voices_enabled FROM public.crm_settings WHERE id),false));
$capabilities$;
REVOKE ALL ON FUNCTION public.crm_v2_customer_voices_capabilities() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_v2_customer_voices_capabilities() TO authenticated;
CREATE FUNCTION public.crm_v2_customer_voices_context(p_customer_id uuid,p_interest_id uuid,p_visit_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $context$
DECLARE actor_id uuid:=auth.uid(); actor_role text:=public.crm_v2_role(); c public.sales_customers%ROWTYPE; i public.lead_project_interests%ROWTYPE;
 v public.lead_visits%ROWTYPE; t sales_private.visit_submission_tokens%ROWTYPE; voice public.customer_voices%ROWTYPE; ttl integer;
BEGIN
 IF actor_id IS NULL OR COALESCE(actor_role,'') NOT IN ('sales','admin','owner') THEN RAISE EXCEPTION 'CRM_VOICE_FORBIDDEN'; END IF;
 IF (public.crm_v2_customer_voices_capabilities()->>'enabled')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'CRM_VOICE_SETUP_REQUIRED'; END IF;
 IF p_customer_id IS NULL OR p_interest_id IS NULL OR p_visit_id IS NULL THEN RAISE EXCEPTION 'CRM_VOICE_INVALID_INPUT'; END IF;
 SELECT * INTO c FROM public.sales_customers WHERE id=p_customer_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'CRM_VOICE_NOT_FOUND'; END IF;
 SELECT * INTO i FROM public.lead_project_interests WHERE id=p_interest_id AND customer_id=c.id;
 IF NOT FOUND THEN RAISE EXCEPTION 'CRM_VOICE_NOT_FOUND'; END IF;
 SELECT * INTO v FROM public.lead_visits WHERE id=p_visit_id AND project_interest_id=i.id;
 IF NOT FOUND THEN RAISE EXCEPTION 'CRM_VOICE_NOT_FOUND'; END IF;
 SELECT * INTO voice FROM public.customer_voices WHERE visit_id=v.id;
 IF (v.status='completed')<>(voice.id IS NOT NULL) OR (voice.id IS NOT NULL AND (voice.id IS DISTINCT FROM v.completed_voice_id OR voice.crm_submission_state<>'submitted')) THEN RAISE EXCEPTION 'CRM_VOICE_SETUP_REQUIRED'; END IF;
 SELECT * INTO t FROM sales_private.visit_submission_tokens WHERE visit_id=v.id AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>statement_timestamp();
 SELECT voice_token_ttl_hours INTO ttl FROM public.crm_settings WHERE id;
 RETURN jsonb_build_object('actor',jsonb_build_object('userId',actor_id,'role',actor_role),
 'scope',jsonb_build_object('customerId',c.id,'customerName',c.customer_name,'interestId',i.id,'visitId',v.id,'projectName',i.project_name,
 'interestRevision',i.lifecycle_revision,'ownerUserId',i.owner_user_id,'canManage',v.status='awaiting_voice' AND c.merged_into_customer_id IS NULL AND i.engagement_status<>'lost'
   AND (actor_role='admin' OR (actor_role='sales' AND actor_id=i.owner_user_id)) AND EXISTS(SELECT 1 FROM sales_private.crm_user_roles WHERE user_id=i.owner_user_id AND role='sales' AND is_active)),
 'visit',jsonb_build_object('revision',v.revision,'status',v.status,'checkedInAt',v.checked_in_at,'completedAt',v.completed_at),
 'activeToken',CASE WHEN t.id IS NOT NULL AND v.status='awaiting_voice' AND c.merged_into_customer_id IS NULL AND i.engagement_status<>'lost' THEN jsonb_build_object('id',t.id,'expiresAt',t.expires_at) ELSE NULL END,
 'submission',CASE WHEN voice.id IS NOT NULL THEN jsonb_build_object('submittedAt',voice.crm_submitted_at,'answers',CASE WHEN actor_role IN ('admin','owner') OR actor_id=i.owner_user_id THEN voice.crm_answers ELSE NULL END) ELSE NULL END,'ttlHours',ttl);
END;
$context$;
REVOKE ALL ON FUNCTION public.crm_v2_customer_voices_context(uuid,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_v2_customer_voices_context(uuid,uuid,uuid) TO authenticated;

CREATE FUNCTION public.crm_v2_customer_voices_command(p_request_id uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $command$
DECLARE actor_id uuid:=auth.uid(); actor_role text:=public.crm_v2_role(); actor_name text; owner_active boolean:=false; enabled boolean; ttl integer;
 c public.sales_customers%ROWTYPE; i public.lead_project_interests%ROWTYPE; v public.lead_visits%ROWTYPE; a public.lead_appointments%ROWTYPE;
 role_row sales_private.crm_user_roles%ROWTYPE; t sales_private.visit_submission_tokens%ROWTYPE; receipt sales_private.voice_staff_requests%ROWTYPE;
 customer_id_value uuid; interest_id_value uuid; visit_id_value uuid; expected_interest uuid; expected_visit uuid; expected_token uuid;
 reason_value text; command_name text; hash_value text; response_value jsonb; server_now timestamptz;
BEGIN
 IF actor_id IS NULL OR COALESCE(actor_role,'') NOT IN ('sales','admin') THEN RAISE EXCEPTION 'CRM_VOICE_FORBIDDEN'; END IF;
 SELECT central_intake_enabled AND lead_work_enabled AND lead_lifecycle_enabled AND visits_enabled AND customer_voices_enabled,voice_token_ttl_hours INTO enabled,ttl FROM public.crm_settings WHERE id FOR SHARE;
 IF enabled IS DISTINCT FROM true THEN RAISE EXCEPTION 'CRM_VOICE_SETUP_REQUIRED'; END IF;
 IF p_request_id IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR octet_length(p_payload::text)>16384 THEN RAISE EXCEPTION 'CRM_VOICE_INVALID_INPUT'; END IF;
 IF NOT(p_payload ?& ARRAY['command','customerId','interestId','visitId','expectedInterestRevision','expectedVisitRevision','expectedTokenId','tokenHash','reason'])
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN ('command','customerId','interestId','visitId','expectedInterestRevision','expectedVisitRevision','expectedTokenId','tokenHash','reason'))
 OR jsonb_typeof(p_payload->'command') IS DISTINCT FROM 'string' OR p_payload->>'command' NOT IN ('issue','revoke') OR jsonb_typeof(p_payload->'reason') IS DISTINCT FROM 'string'
 OR jsonb_typeof(p_payload->'tokenHash') NOT IN ('string','null') THEN RAISE EXCEPTION 'CRM_VOICE_INVALID_INPUT'; END IF;
 command_name:=p_payload->>'command'; hash_value:=p_payload->>'tokenHash';
 IF (command_name='issue' AND (hash_value IS NULL OR hash_value !~ '^[a-f0-9]{64}$')) OR (command_name='revoke' AND hash_value IS NOT NULL) THEN RAISE EXCEPTION 'CRM_VOICE_INVALID_INPUT'; END IF;
 BEGIN
  customer_id_value:=sales_private.crm_visits_uuid(p_payload->'customerId'); interest_id_value:=sales_private.crm_visits_uuid(p_payload->'interestId');
  visit_id_value:=sales_private.crm_visits_uuid(p_payload->'visitId'); expected_interest:=sales_private.crm_visits_uuid(p_payload->'expectedInterestRevision');
  expected_visit:=sales_private.crm_visits_uuid(p_payload->'expectedVisitRevision'); expected_token:=sales_private.crm_visits_uuid(p_payload->'expectedTokenId',true);
  reason_value:=sales_private.crm_work_text(p_payload->>'reason',1000);
 EXCEPTION WHEN raise_exception THEN RAISE EXCEPTION 'CRM_VOICE_INVALID_INPUT'; END;
 IF command_name='revoke' AND expected_token IS NULL THEN RAISE EXCEPTION 'CRM_VOICE_INVALID_INPUT'; END IF;
 p_payload:=p_payload||jsonb_build_object('reason',reason_value);
 PERFORM pg_advisory_xact_lock(hashtextextended('customer-voices:'||actor_id::text||':'||p_request_id::text,0));
 SELECT * INTO c FROM public.sales_customers WHERE id=customer_id_value FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CRM_VOICE_NOT_FOUND'; END IF;
 SELECT * INTO i FROM public.lead_project_interests WHERE id=interest_id_value AND customer_id=c.id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CRM_VOICE_NOT_FOUND'; END IF;
 actor_role:=NULL;
 FOR role_row IN SELECT * FROM sales_private.crm_user_roles WHERE user_id IN(actor_id,i.owner_user_id) ORDER BY user_id FOR SHARE LOOP
  IF role_row.user_id=actor_id AND role_row.is_active THEN actor_role:=role_row.role; actor_name:=role_row.display_name; END IF;
  IF role_row.user_id=i.owner_user_id THEN owner_active:=role_row.is_active AND role_row.role='sales'; END IF;
 END LOOP;
 IF COALESCE(actor_role,'') NOT IN ('sales','admin') OR (actor_role='sales' AND actor_id<>i.owner_user_id) OR NOT owner_active THEN RAISE EXCEPTION 'CRM_VOICE_FORBIDDEN'; END IF;
 SELECT * INTO receipt FROM sales_private.voice_staff_requests WHERE actor_user_id=actor_id AND request_id=p_request_id;
 IF FOUND THEN
  IF receipt.request_payload IS DISTINCT FROM p_payload THEN RAISE EXCEPTION 'CRM_VOICE_IDEMPOTENCY_CONFLICT'; END IF;
  RETURN receipt.response||jsonb_build_object('replayed',true);
 END IF;
 IF c.merged_into_customer_id IS NOT NULL OR i.engagement_status='lost' THEN RAISE EXCEPTION 'CRM_VOICE_SCOPE_CLOSED'; END IF;
 IF i.lifecycle_revision IS DISTINCT FROM expected_interest THEN RAISE EXCEPTION 'CRM_VOICE_STALE_STATE'; END IF;
 SELECT appointment_id INTO a.id FROM public.lead_visits WHERE id=visit_id_value AND project_interest_id=i.id;
 IF NOT FOUND THEN RAISE EXCEPTION 'CRM_VOICE_NOT_FOUND'; END IF;
 IF a.id IS NOT NULL THEN SELECT * INTO a FROM public.lead_appointments WHERE id=a.id FOR UPDATE; END IF;
 SELECT * INTO v FROM public.lead_visits WHERE id=visit_id_value AND project_interest_id=i.id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CRM_VOICE_NOT_FOUND'; END IF;
 IF v.revision IS DISTINCT FROM expected_visit THEN RAISE EXCEPTION 'CRM_VOICE_STALE_STATE'; END IF;
 IF v.status<>'awaiting_voice' OR (a.id IS NOT NULL AND a.status<>'attended') THEN RAISE EXCEPTION 'CRM_VOICE_SCOPE_CLOSED'; END IF;
 SELECT * INTO t FROM sales_private.visit_submission_tokens WHERE visit_id=v.id AND consumed_at IS NULL AND revoked_at IS NULL FOR UPDATE;
 server_now:=clock_timestamp();
 -- Expired tokens are not active in the read contract, but are revoked on rotation.
 IF expected_token IS DISTINCT FROM (CASE WHEN t.expires_at>server_now THEN t.id ELSE NULL END) THEN RAISE EXCEPTION 'CRM_VOICE_STALE_STATE'; END IF;
 IF command_name='revoke' AND t.id IS NULL THEN RAISE EXCEPTION 'CRM_VOICE_STALE_STATE'; END IF;
 IF EXISTS(SELECT 1 FROM public.customer_voices WHERE visit_id=v.id) THEN RAISE EXCEPTION 'CRM_VOICE_SCOPE_CLOSED'; END IF;
 INSERT INTO sales_private.voice_write_permits VALUES(txid_current(),pg_backend_pid(),v.id,NULL);
 IF t.id IS NOT NULL THEN UPDATE sales_private.visit_submission_tokens SET revoked_at=server_now WHERE id=t.id; END IF;
 IF command_name='issue' THEN
  BEGIN INSERT INTO sales_private.visit_submission_tokens(visit_id,token_hash,expires_at,created_at)
   VALUES(v.id,hash_value,server_now+make_interval(hours=>ttl),server_now) RETURNING * INTO t;
  EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'CRM_VOICE_IDEMPOTENCY_CONFLICT'; END;
 END IF;
 INSERT INTO sales_private.voice_events(visit_id,token_id,command,actor_user_id,reason,recorded_at) VALUES(v.id,t.id,command_name,actor_id,reason_value,server_now);
 INSERT INTO public.crm_audit_events(customer_id,entity_type,entity_id,event_type,reason_text,actor_user_id,actor_kind,actor_name_snapshot,new_values,occurred_at,recorded_at)
 VALUES(c.id,'lead_visit',v.id,'customer_voice_'||command_name,reason_value,actor_id,'staff',actor_name,jsonb_build_object('interestId',i.id,'tokenId',t.id),server_now,server_now);
 response_value:=jsonb_build_object('requestId',p_request_id,'command',command_name,'visitId',v.id,'tokenId',t.id,'expiresAt',t.expires_at,'replayed',false);
 INSERT INTO sales_private.voice_staff_requests VALUES(actor_id,p_request_id,p_payload,response_value,server_now);
 DELETE FROM sales_private.voice_write_permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid();
 RETURN response_value;
END;
$command$;
REVOKE ALL ON FUNCTION public.crm_v2_customer_voices_command(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_v2_customer_voices_command(uuid,jsonb) TO authenticated;

CREATE FUNCTION public.crm_v2_customer_voice_open(p_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $open$
DECLARE expiry timestamptz; token_hash_value text;
BEGIN
 IF p_token IS NULL OR p_token !~ '^[a-f0-9]{64}$' OR NOT EXISTS(SELECT 1 FROM public.crm_settings WHERE id
 AND central_intake_enabled AND lead_work_enabled AND lead_lifecycle_enabled AND visits_enabled AND customer_voices_enabled) THEN RAISE EXCEPTION 'CRM_VOICE_TOKEN_UNAVAILABLE'; END IF;
 token_hash_value:=encode(sha256(convert_to(p_token,'UTF8')),'hex');
 SELECT t.expires_at INTO expiry FROM sales_private.visit_submission_tokens t JOIN public.lead_visits v ON v.id=t.visit_id
 JOIN public.lead_project_interests i ON i.id=v.project_interest_id JOIN public.sales_customers c ON c.id=i.customer_id
 JOIN sales_private.crm_user_roles r ON r.user_id=i.owner_user_id AND r.role='sales' AND r.is_active
 WHERE t.token_hash=token_hash_value AND t.consumed_at IS NULL AND t.revoked_at IS NULL AND t.expires_at>statement_timestamp()
 AND v.status='awaiting_voice' AND isfinite(v.checked_in_at) AND v.checked_in_at<=statement_timestamp()
 AND c.merged_into_customer_id IS NULL AND i.engagement_status<>'lost'
 AND (v.appointment_id IS NULL OR EXISTS(SELECT 1 FROM public.lead_appointments WHERE id=v.appointment_id AND project_interest_id=i.id AND status='attended'));
 IF NOT FOUND THEN RAISE EXCEPTION 'CRM_VOICE_TOKEN_UNAVAILABLE'; END IF;
 RETURN jsonb_build_object('formVersion','customer_voices_v1','expiresAt',expiry);
END;
$open$;
REVOKE ALL ON FUNCTION public.crm_v2_customer_voice_open(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_v2_customer_voice_open(text) TO anon,authenticated;

CREATE FUNCTION public.crm_v2_customer_voice_submit(p_token text,p_request_id uuid,p_form_version text,p_answers jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $submit$
DECLARE enabled boolean; token_hint sales_private.visit_submission_tokens%ROWTYPE; t sales_private.visit_submission_tokens%ROWTYPE;
 c public.sales_customers%ROWTYPE; i public.lead_project_interests%ROWTYPE; v public.lead_visits%ROWTYPE; a public.lead_appointments%ROWTYPE;
 receipt sales_private.voice_submissions%ROWTYPE; answers_value jsonb; voice_id_value uuid; server_now timestamptz; owner_active boolean; token_hash_value text;
BEGIN
 SELECT central_intake_enabled AND lead_work_enabled AND lead_lifecycle_enabled AND visits_enabled AND customer_voices_enabled INTO enabled FROM public.crm_settings WHERE id FOR SHARE;
 IF enabled IS DISTINCT FROM true OR p_token IS NULL OR p_token !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'CRM_VOICE_TOKEN_UNAVAILABLE'; END IF;
 token_hash_value:=encode(sha256(convert_to(p_token,'UTF8')),'hex');
 SELECT * INTO token_hint FROM sales_private.visit_submission_tokens WHERE token_hash=token_hash_value;
 IF NOT FOUND THEN RAISE EXCEPTION 'CRM_VOICE_TOKEN_UNAVAILABLE'; END IF;
 SELECT i0.customer_id,i0.id INTO c.id,i.id FROM public.lead_visits v0 JOIN public.lead_project_interests i0 ON i0.id=v0.project_interest_id WHERE v0.id=token_hint.visit_id;
 SELECT * INTO c FROM public.sales_customers WHERE id=c.id FOR UPDATE;
 SELECT * INTO i FROM public.lead_project_interests WHERE id=i.id AND customer_id=c.id FOR UPDATE;
 SELECT role='sales' AND is_active INTO owner_active FROM sales_private.crm_user_roles WHERE user_id=i.owner_user_id FOR SHARE;
 SELECT appointment_id INTO a.id FROM public.lead_visits WHERE id=token_hint.visit_id;
 IF a.id IS NOT NULL THEN SELECT * INTO a FROM public.lead_appointments WHERE id=a.id FOR UPDATE; END IF;
 SELECT * INTO v FROM public.lead_visits WHERE id=token_hint.visit_id AND project_interest_id=i.id FOR UPDATE;
 SELECT * INTO t FROM sales_private.visit_submission_tokens WHERE id=token_hint.id FOR UPDATE;
 server_now:=clock_timestamp();
 IF c.id IS NULL OR i.id IS NULL OR v.id IS NULL OR t.id IS NULL OR c.merged_into_customer_id IS NOT NULL OR i.engagement_status='lost'
  OR owner_active IS DISTINCT FROM true OR t.revoked_at IS NOT NULL OR v.status='cancelled'
  OR NOT isfinite(v.checked_in_at) OR v.checked_in_at>server_now OR (a.id IS NOT NULL AND a.status<>'attended') THEN RAISE EXCEPTION 'CRM_VOICE_TOKEN_UNAVAILABLE'; END IF;
 -- Retry acknowledgement contains no original answers or identifiers. Successful
 -- consumed-token retries remain retryable after expiry, but never reopen a form.
 IF t.consumed_at IS NULL AND (t.expires_at<=server_now OR v.status<>'awaiting_voice') THEN RAISE EXCEPTION 'CRM_VOICE_TOKEN_UNAVAILABLE'; END IF;
 IF p_request_id IS NULL OR p_form_version IS DISTINCT FROM 'customer_voices_v1' THEN RAISE EXCEPTION 'CRM_VOICE_INVALID_INPUT'; END IF;
 answers_value:=sales_private.crm_voice_answers(p_answers);
 SELECT * INTO receipt FROM sales_private.voice_submissions WHERE token_id=t.id;
 IF t.consumed_at IS NOT NULL THEN
  IF receipt.token_id IS NULL OR v.status<>'completed' OR receipt.voice_id IS DISTINCT FROM v.completed_voice_id THEN RAISE EXCEPTION 'CRM_VOICE_TOKEN_UNAVAILABLE'; END IF;
  IF receipt.request_id IS DISTINCT FROM p_request_id OR receipt.form_version IS DISTINCT FROM p_form_version OR receipt.answers IS DISTINCT FROM answers_value THEN RAISE EXCEPTION 'CRM_VOICE_IDEMPOTENCY_CONFLICT'; END IF;
  RETURN jsonb_build_object('submitted',true,'replayed',true);
 END IF;
 IF receipt.token_id IS NOT NULL OR EXISTS(SELECT 1 FROM public.customer_voices WHERE visit_id=v.id) THEN RAISE EXCEPTION 'CRM_VOICE_TOKEN_UNAVAILABLE'; END IF;
 voice_id_value:=gen_random_uuid();
 INSERT INTO sales_private.voice_write_permits VALUES(txid_current(),pg_backend_pid(),v.id,voice_id_value);
 -- Every optional legacy field is explicitly NULL when omitted, never silently
 -- DEFAULT false. CRM answers preserve the distinction between omitted and false.
 INSERT INTO public.customer_voices(id,lead_id,visit_id,survey_date,customer_name,nickname,age,gender,phone,line_id,project_name,agent_name,
 marital_status,education_level,occupation,monthly_income,family_members,previous_residence,monthly_rent,
 purpose_relocate,purpose_family_expansion,purpose_independence,purpose_rent_to_own,purpose_debt_consolidation,
 reason_price,reason_location,reason_promotion,reason_design,reason_house_type,reason_other,source_facebook,source_tiktok,source_youtube,source_billboard,source_other,
 score_knowledge,score_problem_solving,score_service_mind,score_appearance,score_cleanliness,score_house_design,score_price,score_location,score_average,
 created_at,updated_at,crm_answers,crm_form_version,crm_submission_state,crm_submitted_at,crm_validated_at,crm_submitted_by_customer)
 VALUES(voice_id_value,NULL,v.id,server_now,c.customer_name,answers_value->>'nickname',answers_value->>'age',answers_value->>'gender',NULL,answers_value->>'line_id',i.project_name,NULL,
 answers_value->>'marital_status',NULL,answers_value->>'occupation',answers_value->>'monthly_income',answers_value->>'family_members',answers_value->>'previous_residence',(answers_value->>'monthly_rent')::numeric,
 (answers_value->>'purpose_relocate')::boolean,(answers_value->>'purpose_family_expansion')::boolean,(answers_value->>'purpose_independence')::boolean,(answers_value->>'purpose_rent_to_own')::boolean,(answers_value->>'purpose_debt_consolidation')::boolean,
 (answers_value->>'reason_price')::boolean,(answers_value->>'reason_location')::boolean,(answers_value->>'reason_promotion')::boolean,(answers_value->>'reason_design')::boolean,(answers_value->>'reason_house_type')::boolean,answers_value->>'reason_other',
 (answers_value->>'source_facebook')::boolean,(answers_value->>'source_tiktok')::boolean,(answers_value->>'source_youtube')::boolean,(answers_value->>'source_billboard')::boolean,answers_value->>'source_other',
 (answers_value->>'score_knowledge')::integer,(answers_value->>'score_problem_solving')::integer,(answers_value->>'score_service_mind')::integer,(answers_value->>'score_appearance')::integer,
 (answers_value->>'score_cleanliness')::integer,(answers_value->>'score_house_design')::integer,(answers_value->>'score_price')::integer,(answers_value->>'score_location')::integer,NULL,
 server_now,server_now,answers_value,p_form_version,'submitted',server_now,server_now,true);
 UPDATE public.lead_visits SET status='completed',completed_at=server_now,completed_voice_id=voice_id_value,completion_evidence_state='submitted',revision=gen_random_uuid() WHERE id=v.id;
 UPDATE sales_private.visit_submission_tokens SET consumed_at=server_now WHERE id=t.id;
 INSERT INTO sales_private.voice_submissions VALUES(t.id,p_request_id,p_form_version,answers_value,voice_id_value,server_now);
 INSERT INTO sales_private.voice_events(visit_id,token_id,command,actor_user_id,reason,recorded_at) VALUES(v.id,t.id,'submit',NULL,'Customer submitted versioned questionnaire',server_now);
 INSERT INTO public.crm_audit_events(customer_id,entity_type,entity_id,event_type,reason_text,actor_user_id,actor_kind,new_values,occurred_at,recorded_at)
 VALUES(c.id,'lead_visit',v.id,'customer_voice_submitted','Customer submitted versioned questionnaire',NULL,'customer',
 jsonb_build_object('interestId',i.id,'voiceId',voice_id_value,'formVersion',p_form_version),server_now,server_now);
 DELETE FROM sales_private.voice_write_permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid();
 RETURN jsonb_build_object('submitted',true,'replayed',false);
END;
$submit$;
REVOKE ALL ON FUNCTION public.crm_v2_customer_voice_submit(text,uuid,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_v2_customer_voice_submit(text,uuid,text,jsonb) TO anon,authenticated;

-- Reviewed source: sql/sales/deployment/central_visits_adapter.sql
-- LF-normalized SHA256: 5ececd103e27ea53e90fff6bea45cec0e364ce563fb5c15552a78ecb5edad7eb
-- Additive local adapter. Imported history remains immutable; a new next action,
-- appointment, Visit, checklist or Voice is current work, not historical evidence.
CREATE TABLE crm_external_private.visit_workflow_activation_permits (
  transaction_id bigint PRIMARY KEY,backend_pid integer NOT NULL,batch_id uuid NOT NULL
);
CREATE TABLE crm_external_private.visit_workflow_releases (
  batch_id uuid PRIMARY KEY REFERENCES crm_external_private.snapshot_batches(id),
  plan_digest text NOT NULL,review_reference text NOT NULL,activated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE crm_external_private.visit_workflow_activation_permits ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_external_private.visit_workflow_releases ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER visit_workflow_release_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
  ON crm_external_private.visit_workflow_releases FOR EACH STATEMENT
  EXECUTE FUNCTION account_security_private.prevent_role_review_change();

CREATE FUNCTION crm_external_private.visit_workflow_activation_allowed(p_old jsonb,p_new jsonb)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT p_old IS NOT NULL AND crm_external_private.booking_writer_ready()
    AND EXISTS(SELECT 1 FROM crm_external_private.visit_workflow_activation_permits p
      JOIN crm_external_private.booking_writer_releases w ON w.batch_id=p.batch_id
      WHERE p.transaction_id=txid_current() AND p.backend_pid=pg_backend_pid())
    AND p_old-ARRAY['visits_enabled','visit_sop_enabled','customer_voices_enabled']
      =p_new-ARRAY['visits_enabled','visit_sop_enabled','customer_voices_enabled']
    AND p_new @> '{"visits_enabled":true,"visit_sop_enabled":true,"customer_voices_enabled":true}'::jsonb
    AND NOT EXISTS(SELECT 1 FROM jsonb_each(p_new) j
      WHERE (j.key LIKE '%\_enabled' ESCAPE '\' OR j.key='booking_cutover_reviewed') AND j.value='true'
        AND j.key NOT IN ('central_intake_enabled','lead_work_enabled','lead_lifecycle_enabled',
          'booking_enabled','booking_cutover_reviewed','visits_enabled','visit_sop_enabled','customer_voices_enabled'));
$$;

-- Preserve the booking activation gate; admit only the separate private Visit
-- permit and exactly the three new switches. No GUC is a write capability.
CREATE OR REPLACE FUNCTION crm_external_private.reject_unreviewed_activation()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE allowed boolean:=false;
BEGIN
  IF EXISTS(SELECT 1 FROM jsonb_each(to_jsonb(NEW)) j
    WHERE (j.key LIKE '%\_enabled' ESCAPE '\' OR j.key='booking_cutover_reviewed') AND j.value='true') THEN
    allowed:=crm_external_private.booking_activation_allowed(to_jsonb(NEW));
    IF allowed IS DISTINCT FROM true AND TG_OP='UPDATE' THEN
      allowed:=crm_external_private.visit_workflow_activation_allowed(to_jsonb(OLD),to_jsonb(NEW));
    END IF;
    IF allowed IS DISTINCT FROM true THEN RAISE EXCEPTION 'EXTERNAL_CRM_ACTIVATION_REVIEW_REQUIRED'; END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Preserve the original new-column NULL seal for legacy Voice writes. The only
-- exception is SQL26's atomic submitted Voice insert with its private permit.
CREATE FUNCTION crm_external_private.guard_visit_voice_fields()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF TG_OP='INSERT' AND NEW.visit_id IS NOT NULL AND EXISTS(
    SELECT 1 FROM sales_private.voice_write_permits p WHERE p.transaction_id=txid_current()
      AND p.backend_pid=pg_backend_pid() AND p.visit_id=NEW.visit_id AND p.voice_id=NEW.id)
    AND EXISTS(SELECT 1 FROM public.crm_settings WHERE id AND central_intake_enabled
      AND lead_work_enabled AND lead_lifecycle_enabled AND visits_enabled AND customer_voices_enabled)
    AND NEW.crm_submission_state='submitted' AND NEW.crm_form_version='customer_voices_v1'
    AND NEW.crm_submitted_by_customer IS TRUE THEN RETURN NEW; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(TG_ARGV[0]::jsonb) c
    WHERE to_jsonb(NEW)->c IS DISTINCT FROM 'null'::jsonb) THEN
    RAISE EXCEPTION 'CRM_FOUNDATION_COLUMNS_SEALED';
  END IF;
  RETURN NEW;
END;
$$;
DO $voice_seal_adapter$
DECLARE definition text;
BEGIN
  SELECT pg_get_triggerdef(oid) INTO definition FROM pg_trigger WHERE tgrelid='public.customer_voices'::regclass
    AND tgname='crm_foundation_legacy_fields_sealed' AND NOT tgisinternal
    AND tgfoid='sales_private.reject_sealed_legacy_fields()'::regprocedure;
  IF definition IS NULL THEN RAISE EXCEPTION 'CENTRAL_VISITS_EXPECTED_VOICE_SEAL_REQUIRED'; END IF;
  DROP TRIGGER crm_foundation_legacy_fields_sealed ON public.customer_voices;
  EXECUTE replace(definition,'sales_private.reject_sealed_legacy_fields','crm_external_private.guard_visit_voice_fields');
END;
$voice_seal_adapter$;

-- While sealed, do not make legacy SELECT depend on EXECUTE of a new helper.
-- The helper and its original restrictive predicate are enabled atomically.
ALTER POLICY voice_v2_private_read ON public.customer_voices USING(visit_id IS NULL);

CREATE FUNCTION public.crm_v2_visit_follow_up_capabilities()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT jsonb_build_object('contract_version','visit_follow_up_v1','read_contract_version','lead_work_read_v2',
    'enabled',COALESCE(auth.uid() IS NOT NULL AND public.crm_v2_role() IN ('sales','admin','owner')
      AND (SELECT central_intake_enabled AND lead_work_enabled AND lead_lifecycle_enabled
        AND visits_enabled AND visit_sop_enabled FROM public.crm_settings WHERE id),false));
$$;

CREATE FUNCTION public.crm_v2_visit_follow_up_context(p_customer_id uuid,p_interest_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE snapshot jsonb; actor_role text:=public.crm_v2_role();
BEGIN
  IF auth.uid() IS NULL OR COALESCE(actor_role,'') NOT IN ('sales','admin','owner') THEN RAISE EXCEPTION 'CRM_WORK_FORBIDDEN'; END IF;
  IF (public.crm_v2_visit_follow_up_capabilities()->>'enabled')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'CRM_WORK_SETUP_REQUIRED'; END IF;
  IF p_customer_id IS NULL OR p_interest_id IS NULL THEN RAISE EXCEPTION 'CRM_WORK_INVALID_INPUT'; END IF;
  snapshot:=public.crm_v2_lead_work_snapshot(p_customer_id,p_interest_id);
  RETURN jsonb_set(snapshot,'{canWrite}',to_jsonb(actor_role='sales' AND (snapshot->>'canWrite')::boolean));
END;
$$;

CREATE FUNCTION public.crm_v2_visit_follow_up_command(p_request_id uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE actor_id uuid:=auth.uid(); customer_id_value uuid; interest_id_value uuid;
  owner_id uuid; actor_role text; enabled boolean;
BEGIN
  IF actor_id IS NULL OR public.crm_v2_role() IS DISTINCT FROM 'sales' THEN RAISE EXCEPTION 'CRM_WORK_FORBIDDEN'; END IF;
  SELECT central_intake_enabled AND lead_work_enabled AND lead_lifecycle_enabled
    AND visits_enabled AND visit_sop_enabled INTO enabled FROM public.crm_settings WHERE id FOR SHARE;
  IF enabled IS DISTINCT FROM true THEN RAISE EXCEPTION 'CRM_WORK_SETUP_REQUIRED'; END IF;
  IF p_request_id IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object'
    OR octet_length(p_payload::text)>16384 OR p_payload->>'command' IS DISTINCT FROM 'set_next_action'
    OR jsonb_typeof(p_payload->'customerId') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_payload->'interestId') IS DISTINCT FROM 'string'
    OR (p_payload->>'customerId') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    OR (p_payload->>'interestId') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
    RAISE EXCEPTION 'CRM_WORK_INVALID_INPUT';
  END IF;
  customer_id_value:=(p_payload->>'customerId')::uuid; interest_id_value:=(p_payload->>'interestId')::uuid;
  -- Same request/scope/role lock order as the delegated writer. Rechecking owner
  -- before delegation also prevents replay by a former owner or an Admin.
  PERFORM pg_advisory_xact_lock(hashtextextended('lead-work:'||actor_id::text||':'||p_request_id::text,0));
  PERFORM 1 FROM public.sales_customers WHERE id=customer_id_value FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CRM_WORK_NOT_FOUND'; END IF;
  SELECT owner_user_id INTO owner_id FROM public.lead_project_interests
    WHERE id=interest_id_value AND customer_id=customer_id_value FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CRM_WORK_NOT_FOUND'; END IF;
  IF owner_id IS DISTINCT FROM actor_id THEN RAISE EXCEPTION 'CRM_WORK_FORBIDDEN'; END IF;
  SELECT role INTO actor_role FROM sales_private.crm_user_roles WHERE user_id=actor_id AND is_active FOR SHARE;
  IF actor_role IS DISTINCT FROM 'sales' THEN RAISE EXCEPTION 'CRM_WORK_FORBIDDEN'; END IF;
  RETURN public.crm_v2_record_lead_work(p_request_id,p_payload);
END;
$$;

-- Private, INVOKER, LOCAL-ONLY rehearsal activation. The installer never calls it.
-- A future production release requires its own reviewed operator procedure.
CREATE FUNCTION crm_external_private.enable_visit_workflow(p_batch uuid,p_plan_digest text,p_review_ref text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF current_database() !~ '^buildtrack_sales_runtime_[a-f0-9]+$'
    OR session_user !~ '^runtime_[a-f0-9]+$'
    OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet
    OR current_setting('buildtrack.synthetic_runtime',true) IS DISTINCT FROM 'on'
    OR current_setting('buildtrack.central_visits_release',true) IS DISTINCT FROM 'local_synthetic_v1' THEN
    RAISE EXCEPTION 'CENTRAL_VISITS_LOCAL_SYNTHETIC_ONLY';
  END IF;
  PERFORM crm_external_private.cutover_operator_check();
  IF length(btrim(COALESCE(p_review_ref,'')))<8 OR p_batch IS NULL OR p_plan_digest IS NULL
    OR NOT EXISTS(SELECT 1 FROM crm_external_private.booking_writer_releases w
      JOIN crm_external_private.snapshot_batches b ON b.id=w.batch_id
      WHERE w.batch_id=p_batch AND w.plan_digest=p_plan_digest AND b.plan_digest=p_plan_digest)
    OR EXISTS(SELECT 1 FROM crm_external_private.sales_rollback_receipts WHERE batch_id=p_batch)
    OR NOT crm_external_private.booking_writer_ready() THEN RAISE EXCEPTION 'CENTRAL_VISITS_REVIEW_REQUIRED'; END IF;
  PERFORM 1 FROM public.crm_settings WHERE id FOR UPDATE;
  IF NOT FOUND OR EXISTS(SELECT 1 FROM crm_external_private.visit_workflow_releases) THEN
    RAISE EXCEPTION 'CENTRAL_VISITS_INSTALL_STATE_CHANGED'; END IF;
  INSERT INTO crm_external_private.visit_workflow_activation_permits VALUES(txid_current(),pg_backend_pid(),p_batch);
  UPDATE public.crm_settings SET visits_enabled=true,visit_sop_enabled=true,customer_voices_enabled=true WHERE id;
  DELETE FROM crm_external_private.visit_workflow_activation_permits WHERE transaction_id=txid_current();
  INSERT INTO crm_external_private.visit_workflow_releases(batch_id,plan_digest,review_reference) VALUES(p_batch,p_plan_digest,p_review_ref);
  GRANT EXECUTE ON FUNCTION public.crm_v2_visits_capabilities(),public.crm_v2_visits_context(uuid,uuid,integer,integer,integer),
    public.crm_v2_visits_command(uuid,jsonb),public.crm_v2_visit_sop_capabilities(),
    public.crm_v2_visit_sop_context(uuid,uuid,uuid,uuid,integer),public.crm_v2_record_visit_sop(uuid,jsonb),
    public.crm_v2_customer_voices_capabilities(),public.crm_v2_customer_voices_context(uuid,uuid,uuid),
    public.crm_v2_customer_voices_command(uuid,jsonb),public.crm_v2_visit_follow_up_capabilities(),
    public.crm_v2_visit_follow_up_context(uuid,uuid),public.crm_v2_visit_follow_up_command(uuid,jsonb) TO authenticated;
  GRANT EXECUTE ON FUNCTION public.crm_v2_voice_row_readable(uuid),public.crm_v2_customer_voice_open(text),
    public.crm_v2_customer_voice_submit(text,uuid,text,jsonb) TO anon,authenticated;
  ALTER POLICY voice_v2_private_read ON public.customer_voices
    USING(visit_id IS NULL OR public.crm_v2_voice_row_readable(visit_id));
  RETURN jsonb_build_object('visitsEnabled',true,'visitSopEnabled',true,'customerVoicesEnabled',true,
    'generalLeadWorkEnabled',false,'lifecycleCommandsEnabled',false,'notificationsEnabled',false,'localSyntheticOnly',true);
END;
$$;

-- Seal every new object against inherited Supabase/custom default grants. Keep
-- all existing APIs/identity seals untouched; activation is separate and local.
DO $visits_seal$
DECLARE r record; g record; target text;
BEGIN
  FOR r IN SELECT p.oid,p.proowner,p.proacl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname IN ('public','sales_private','crm_external_private')
      AND NOT EXISTS(SELECT 1 FROM central_visits_existing_functions old WHERE old.oid=p.oid) LOOP
    FOR g IN SELECT DISTINCT grantee FROM aclexplode(coalesce(r.proacl,acldefault('f',r.proowner))) WHERE grantee<>r.proowner LOOP
      target:=CASE WHEN g.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(g.grantee)) END;
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %s',r.oid::regprocedure,target);
    END LOOP;
  END LOOP;
  FOR r IN SELECT c.oid,c.relowner,c.relacl,n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('sales_private','crm_external_private') AND c.relkind='r'
      AND NOT EXISTS(SELECT 1 FROM central_visits_existing_relations old WHERE old.oid=c.oid) LOOP
    FOR g IN SELECT DISTINCT grantee FROM aclexplode(coalesce(r.relacl,acldefault('r',r.relowner))) WHERE grantee<>r.relowner LOOP
      target:=CASE WHEN g.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(g.grantee)) END;
      EXECUTE format('REVOKE ALL ON %I.%I FROM %s',r.nspname,r.relname,target);
    END LOOP;
  END LOOP;
END;
$visits_seal$;
DO $visits_after$
DECLARE r record; result text;
BEGIN
  FOR r IN SELECT * FROM central_visits_shared_before LOOP
    EXECUTE format('SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,''[]'')) FROM public.%I t',r.relname) INTO result;
    IF result IS DISTINCT FROM r.data_hash OR EXISTS(SELECT 1 FROM pg_class c WHERE c.oid=r.oid
      AND (c.relacl IS DISTINCT FROM r.relacl OR c.relowner<>r.relowner OR c.relrowsecurity<>r.relrowsecurity)) THEN
      RAISE EXCEPTION 'CENTRAL_VISITS_SHARED_BASELINE_CHANGED: %',r.relname;
    END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM central_visits_preserved_functions WHERE definition IS DISTINCT FROM pg_get_functiondef(oid)) THEN
    RAISE EXCEPTION 'CENTRAL_VISITS_EXISTING_GUARD_CHANGED'; END IF;
  IF (SELECT to_jsonb(s)-ARRAY['visits_enabled','visit_sop_enabled','customer_voices_enabled','voice_token_ttl_hours'] FROM public.crm_settings s WHERE id)
      IS DISTINCT FROM (SELECT value FROM central_visits_settings_before)
    OR EXISTS(SELECT 1 FROM public.crm_settings WHERE visits_enabled OR visit_sop_enabled OR customer_voices_enabled)
    OR EXISTS(SELECT 1 FROM crm_external_private.visit_workflow_releases) THEN
    RAISE EXCEPTION 'CENTRAL_VISITS_UNEXPECTED_ACTIVATION'; END IF;
  IF EXISTS(SELECT 1 FROM pg_proc p,LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    WHERE p.pronamespace IN ('public'::regnamespace,'sales_private'::regnamespace,'crm_external_private'::regnamespace)
      AND NOT EXISTS(SELECT 1 FROM central_visits_existing_functions old WHERE old.oid=p.oid)
      AND a.grantee<>p.proowner) THEN RAISE EXCEPTION 'CENTRAL_VISITS_UNSEALED_API'; END IF;
END;
$visits_after$;
COMMIT;
