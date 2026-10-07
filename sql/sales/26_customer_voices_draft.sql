-- CUSTOMER VOICES PER VISIT -- DESIGN ONLY, 2026-09-24.
-- NEVER RUN ON SUPABASE. Depends on base + 04/05/23; default off.
-- Legacy survey columns are verified in sales_funnel_and_leads_migration.sql.
-- Only hashes are stored. Public replies contain no identity, answers or scope IDs.
-- Public raw-token parameters require request/statement log redaction before activation.
BEGIN;
DO $draft_only$
BEGIN
 RAISE EXCEPTION 'DESIGN ONLY: customer Voices is not authorized for database execution';
END;
$draft_only$;
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
ROLLBACK;
