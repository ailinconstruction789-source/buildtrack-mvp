-- SALES V2 ADD PROJECT INTEREST -- DESIGN ONLY, 2026-09-24.
-- NEVER RUN ON SUPABASE. Depends on guarded base + 04/05. Defaults disabled.
-- Reuses the central customer's identity and existing project-interest table.
-- No new Lead, booking, Visit, reminder, SLA, cohort reset or stock reservation.
BEGIN;
DO $draft_only$
BEGIN
  RAISE EXCEPTION 'DESIGN ONLY: project interests are not authorized for database execution';
END;
$draft_only$;

ALTER TABLE public.crm_settings ADD COLUMN project_interests_enabled boolean NOT NULL DEFAULT false;
CREATE TABLE sales_private.project_interest_write_permits(transaction_id bigint PRIMARY KEY,backend_pid integer NOT NULL);
CREATE TABLE sales_private.project_interest_command_requests (
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL,request_payload jsonb NOT NULL,response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(actor_user_id,request_id)
);
ALTER TABLE sales_private.project_interest_write_permits ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_private.project_interest_command_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sales_private.project_interest_write_permits,sales_private.project_interest_command_requests FROM PUBLIC,anon,authenticated;
-- Base already revokes browser writes to lead_project_interests and audit events.
-- Do not broaden grants or add a table guard incompatible with intake/booking.
CREATE FUNCTION sales_private.crm_interests_protect_receipt()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $protect_receipt$
BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'CRM_INTERESTS_FORBIDDEN'; END IF;
  IF NOT EXISTS(SELECT 1 FROM sales_private.project_interest_write_permits
    WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid()) THEN RAISE EXCEPTION 'CRM_INTERESTS_FORBIDDEN'; END IF;
  RETURN NEW;
END;
$protect_receipt$;
REVOKE ALL ON FUNCTION sales_private.crm_interests_protect_receipt() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER crm_interests_protect_receipt BEFORE INSERT OR UPDATE OR DELETE ON sales_private.project_interest_command_requests
  FOR EACH ROW EXECUTE FUNCTION sales_private.crm_interests_protect_receipt();

CREATE FUNCTION sales_private.crm_interests_uuid(value jsonb)
RETURNS uuid LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog
AS $uuid$
BEGIN
  IF jsonb_typeof(value) IS DISTINCT FROM 'string' OR (value#>>'{}') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
    RAISE EXCEPTION 'CRM_INTERESTS_INVALID_INPUT'; END IF;
  RETURN (value#>>'{}')::uuid;
END;
$uuid$;
REVOKE ALL ON FUNCTION sales_private.crm_interests_uuid(jsonb) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.crm_v2_project_interests_capabilities()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog
AS $capabilities$
  SELECT jsonb_build_object('contract_version','project_interests_v1','enabled',COALESCE(public.crm_v2_role() IN ('sales','admin','owner') AND
    (SELECT central_intake_enabled AND lead_work_enabled AND lead_lifecycle_enabled AND project_interests_enabled FROM public.crm_settings WHERE id),false));
$capabilities$;
REVOKE ALL ON FUNCTION public.crm_v2_project_interests_capabilities() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_v2_project_interests_capabilities() TO authenticated;

CREATE FUNCTION public.crm_v2_project_interests_context(p_customer_id uuid,p_page integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog
AS $context$
DECLARE
  actor_id uuid:=auth.uid(); actor_role text:=public.crm_v2_role(); c public.sales_customers%ROWTYPE;
  projects_json jsonb; projects_more boolean; interests_json jsonb; interests_more boolean;
BEGIN
  IF actor_id IS NULL OR COALESCE(actor_role,'') NOT IN ('sales','admin','owner') THEN RAISE EXCEPTION 'CRM_INTERESTS_FORBIDDEN'; END IF;
  IF (public.crm_v2_project_interests_capabilities()->>'enabled')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'CRM_INTERESTS_SETUP_REQUIRED'; END IF;
  IF p_customer_id IS NULL OR p_page IS NULL OR p_page NOT BETWEEN 0 AND 100000 THEN RAISE EXCEPTION 'CRM_INTERESTS_INVALID_INPUT'; END IF;
  SELECT * INTO c FROM public.sales_customers WHERE id=p_customer_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'CRM_INTERESTS_NOT_FOUND'; END IF;
  WITH rows AS (
    SELECT p.name FROM public.projects p WHERE p.is_closed IS NOT TRUE
      AND NOT EXISTS(SELECT 1 FROM public.lead_project_interests i WHERE i.customer_id=c.id AND i.project_name=p.name)
      ORDER BY p.name LIMIT 201
  ), numbered AS(SELECT *,row_number() OVER(ORDER BY name) rn FROM rows)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('name',name) ORDER BY name) FILTER(WHERE rn<=200),'[]'::jsonb),count(*)>200
    INTO projects_json,projects_more FROM numbered;
  WITH rows AS (
    SELECT * FROM public.lead_project_interests WHERE customer_id=c.id ORDER BY project_name,id LIMIT 51 OFFSET p_page*50
  ), numbered AS(SELECT *,row_number() OVER(ORDER BY project_name,id) rn FROM rows)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'projectName',project_name,'ownerUserId',owner_user_id,'revision',lifecycle_revision,
    'status',engagement_status,'plotId',interested_plot_id) ORDER BY project_name,id) FILTER(WHERE rn<=50),'[]'::jsonb),count(*)>50
    INTO interests_json,interests_more FROM numbered;
  RETURN jsonb_build_object('actor',jsonb_build_object('userId',actor_id,'role',actor_role),
    'customer',jsonb_build_object('id',c.id,'name',c.customer_name,'ownerUserId',c.owner_user_id,'revision',c.lifecycle_revision,'intakeStatus',c.intake_status,
      'canAdd',(actor_role='admin' OR (actor_role='sales' AND actor_id=c.owner_user_id)) AND c.intake_status<>'lost'
        AND c.merged_into_customer_id IS NULL AND EXISTS(SELECT 1 FROM sales_private.crm_user_roles WHERE user_id=c.owner_user_id AND role='sales' AND is_active)),
    'projects',projects_json,'projectsHasMore',projects_more,'interests',interests_json,'page',p_page,'hasMore',interests_more);
END;
$context$;
REVOKE ALL ON FUNCTION public.crm_v2_project_interests_context(uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_v2_project_interests_context(uuid,integer) TO authenticated;

CREATE FUNCTION public.crm_v2_add_project_interest(p_request_id uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC'
AS $command$
DECLARE
  actor_id uuid:=auth.uid(); actor_role text:=public.crm_v2_role(); actor_name text; owner_active boolean:=false; enabled boolean;
  customer_id_value uuid; expected_revision uuid; project_value text; plot_value text; reason_value text;
  c public.sales_customers%ROWTYPE; interest_row public.lead_project_interests%ROWTYPE;
  role_row sales_private.crm_user_roles%ROWTYPE; receipt sales_private.project_interest_command_requests%ROWTYPE;
  event_id_value uuid:=gen_random_uuid(); server_now timestamptz; response_value jsonb;
BEGIN
  IF actor_id IS NULL OR COALESCE(actor_role,'') NOT IN ('sales','admin') THEN RAISE EXCEPTION 'CRM_INTERESTS_FORBIDDEN'; END IF;
  SELECT central_intake_enabled AND lead_work_enabled AND lead_lifecycle_enabled AND project_interests_enabled
    INTO enabled FROM public.crm_settings WHERE id FOR SHARE;
  IF enabled IS DISTINCT FROM true THEN RAISE EXCEPTION 'CRM_INTERESTS_SETUP_REQUIRED'; END IF;
  IF p_request_id IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR octet_length(p_payload::text)>16384 THEN RAISE EXCEPTION 'CRM_INTERESTS_INVALID_INPUT'; END IF;
  IF NOT(p_payload ?& ARRAY['customerId','expectedCustomerRevision','projectName','plotId','reason'])
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN ('customerId','expectedCustomerRevision','projectName','plotId','reason'))
    OR jsonb_typeof(p_payload->'projectName') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_payload->'plotId') NOT IN ('string','null')
    OR jsonb_typeof(p_payload->'reason') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'CRM_INTERESTS_INVALID_INPUT'; END IF;
  BEGIN
    customer_id_value:=sales_private.crm_interests_uuid(p_payload->'customerId');
    expected_revision:=sales_private.crm_interests_uuid(p_payload->'expectedCustomerRevision');
    reason_value:=sales_private.crm_work_text(p_payload->>'reason',1000);
    -- Validate text without rewriting an exact existing project/plot primary key.
    PERFORM sales_private.crm_work_text(p_payload->>'projectName',200);
    project_value:=p_payload->>'projectName';
    IF length(project_value)>200 THEN RAISE EXCEPTION 'CRM_INTERESTS_INVALID_INPUT'; END IF;
    plot_value:=p_payload->>'plotId';
    IF plot_value IS NOT NULL THEN
      PERFORM sales_private.crm_work_text(plot_value,255);
      IF length(plot_value)>255 THEN RAISE EXCEPTION 'CRM_INTERESTS_INVALID_INPUT'; END IF;
    END IF;
  EXCEPTION WHEN raise_exception THEN RAISE EXCEPTION 'CRM_INTERESTS_INVALID_INPUT'; END;
  -- Shared customer lock serializes interest creation with booking, lost closure
  -- and central owner changes. Request lock also covers reuse across customers.
  PERFORM pg_advisory_xact_lock(hashtextextended('project-interest:'||actor_id::text||':'||p_request_id::text,0));
  SELECT * INTO c FROM public.sales_customers WHERE id=customer_id_value FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CRM_INTERESTS_NOT_FOUND'; END IF;
  actor_role:=NULL;
  FOR role_row IN SELECT * FROM sales_private.crm_user_roles WHERE user_id IN(actor_id,c.owner_user_id) ORDER BY user_id FOR SHARE LOOP
    IF role_row.user_id=actor_id AND role_row.is_active THEN actor_role:=role_row.role; actor_name:=role_row.display_name; END IF;
    IF role_row.user_id=c.owner_user_id THEN owner_active:=role_row.is_active AND role_row.role='sales'; END IF;
  END LOOP;
  IF COALESCE(actor_role,'') NOT IN ('sales','admin') OR (actor_role='sales' AND actor_id<>c.owner_user_id) OR NOT owner_active THEN RAISE EXCEPTION 'CRM_INTERESTS_FORBIDDEN'; END IF;
  SELECT * INTO receipt FROM sales_private.project_interest_command_requests WHERE actor_user_id=actor_id AND request_id=p_request_id;
  IF FOUND THEN
    IF receipt.request_payload IS DISTINCT FROM p_payload THEN RAISE EXCEPTION 'CRM_INTERESTS_IDEMPOTENCY_CONFLICT'; END IF;
    RETURN receipt.response||jsonb_build_object('replayed',true);
  END IF;
  IF c.merged_into_customer_id IS NOT NULL OR c.intake_status='lost' THEN RAISE EXCEPTION 'CRM_INTERESTS_SCOPE_CLOSED'; END IF;
  IF c.lifecycle_revision IS DISTINCT FROM expected_revision THEN RAISE EXCEPTION 'CRM_INTERESTS_STALE_STATE'; END IF;
  PERFORM 1 FROM public.projects WHERE name=project_value AND is_closed IS NOT TRUE FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CRM_INTERESTS_NOT_FOUND'; END IF;
  IF EXISTS(SELECT 1 FROM public.lead_project_interests WHERE customer_id=c.id AND project_name=project_value) THEN RAISE EXCEPTION 'CRM_INTERESTS_PROJECT_EXISTS'; END IF;
  IF plot_value IS NOT NULL THEN
    -- Selecting a plot does not reserve it, but the exact stock state is checked
    -- under the same plot lock used by booking; unknown/null is never vacant.
    PERFORM 1 FROM public.plots WHERE id=plot_value AND project_name=project_value AND has_customer IS FALSE
      AND lower(btrim(COALESCE(sale_status,''))) IN ('','active','normal','ready_for_sale','available','vacant') FOR UPDATE;
    IF NOT FOUND OR EXISTS(SELECT 1 FROM public.sales WHERE plot_id=plot_value AND COALESCE(crm_stage,lower(contract_status),'unknown')<>'cancelled') THEN
      RAISE EXCEPTION 'CRM_INTERESTS_PLOT_UNAVAILABLE'; END IF;
  END IF;
  server_now:=clock_timestamp();
  INSERT INTO public.lead_project_interests(customer_id,project_name,owner_user_id,created_by_user_id,
    interested_plot_id,workspace_state,engagement_status,owner_assigned_at,interest_created_at,created_at,updated_at)
    VALUES(c.id,project_value,c.owner_user_id,actor_id,plot_value,'central_interest','new',server_now,server_now,server_now,server_now)
    RETURNING * INTO interest_row;
  INSERT INTO public.crm_audit_events(id,customer_id,entity_type,entity_id,event_type,reason_text,actor_user_id,actor_kind,
    actor_name_snapshot,new_values,occurred_at,recorded_at)
    VALUES(event_id_value,c.id,'interest',interest_row.id,'project_interest_added',reason_value,actor_id,'staff',actor_name,
      jsonb_build_object('projectName',project_value,'ownerUserId',c.owner_user_id,'plotId',plot_value,'workspaceState','central_interest',
        'engagementStatus','new','interestRevision',interest_row.lifecycle_revision,'interestCreatedAt',server_now),server_now,server_now);
  response_value:=jsonb_build_object('requestId',p_request_id,'customerId',c.id,'interestId',interest_row.id,
    'interestRevision',interest_row.lifecycle_revision,'ownerUserId',c.owner_user_id,'projectName',project_value,
    'plotId',plot_value,'eventId',event_id_value,'replayed',false);
  INSERT INTO sales_private.project_interest_write_permits VALUES(txid_current(),pg_backend_pid());
  INSERT INTO sales_private.project_interest_command_requests(actor_user_id,request_id,request_payload,response,created_at)
    VALUES(actor_id,p_request_id,p_payload,response_value,server_now);
  DELETE FROM sales_private.project_interest_write_permits WHERE transaction_id=txid_current() AND backend_pid=pg_backend_pid();
  RETURN response_value;
END;
$command$;
REVOKE ALL ON FUNCTION public.crm_v2_add_project_interest(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_v2_add_project_interest(uuid,jsonb) TO authenticated;
ROLLBACK;
