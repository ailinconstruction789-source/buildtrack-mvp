-- SALES V2 VISIT SOP -- DESIGN ONLY, 2026-09-24.
-- NEVER RUN ON SUPABASE. Base + 04/05/23 dependencies, disabled by default.
-- SOP is Sales work, not Visit/Voice completion, stock reservation or KPI credit.
-- Standalone preparation and Admin correction workflows are intentionally deferred.
BEGIN;
DO $draft_only$
BEGIN
  RAISE EXCEPTION 'DESIGN ONLY: visit SOP is not authorized for database execution';
END;
$draft_only$;

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
ROLLBACK;
