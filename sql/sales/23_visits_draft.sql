-- SALES V2 APPOINTMENTS / CHECK-IN -- DESIGN ONLY, 2026-09-23.
-- NEVER RUN ON SUPABASE. Depends on guarded base + 04/05; disabled by default.
-- No survey completion/public token, checklist, project activation, stock,
-- booking, customer cohort, next action, reminder, KPI or legacy mutation.
BEGIN;
DO $draft_only$
BEGIN
  RAISE EXCEPTION 'DESIGN ONLY: visits foundation is not authorized for database execution';
END;
$draft_only$;

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
ROLLBACK;
