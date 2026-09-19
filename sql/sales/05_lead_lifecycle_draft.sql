-- SALES V2 LIFECYCLE -- DESIGN ONLY, 2026-09-16. NEVER RUN ON SUPABASE.
-- Depends on the UNAPPLIED base draft and revised companion 04 (read v2).
-- This is not a deployment migration. Static tests are NOT PostgreSQL/RLS tests.
BEGIN;
DO $draft_only$
BEGIN
  RAISE EXCEPTION 'DESIGN ONLY: lifecycle draft is not authorized for database execution';
END;
$draft_only$;

ALTER TABLE public.crm_settings
  ADD COLUMN lead_lifecycle_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.crm_sla_tasks
  ADD COLUMN cancelled_at timestamptz,
  ADD COLUMN cancelled_by_user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  ADD COLUMN cancellation_reason text,
  ADD CONSTRAINT crm_sla_cancellation_evidence CHECK (
    (cancelled_at IS NULL AND cancelled_by_user_id IS NULL AND cancellation_reason IS NULL)
    OR (status='cancelled' AND cancelled_at IS NOT NULL AND isfinite(cancelled_at)
      AND cancelled_at >= created_at AND cancelled_by_user_id IS NOT NULL
      AND cancellation_reason IS NOT NULL AND btrim(cancellation_reason)<>''));
ALTER TABLE public.crm_notifications
  ADD COLUMN withdrawn_at timestamptz,
  ADD COLUMN withdrawal_reason text,
  ADD CONSTRAINT crm_notification_withdrawal_evidence CHECK (
    (withdrawn_at IS NULL AND withdrawal_reason IS NULL)
    OR (withdrawn_at IS NOT NULL AND isfinite(withdrawn_at)
      AND withdrawal_reason IS NOT NULL AND btrim(withdrawal_reason)<>''));
-- Future read/delivery code must exclude withdrawn notifications and recheck the
-- task's current owner/status. Never move another person's read receipt to a new owner.

CREATE FUNCTION public.crm_v2_lead_lifecycle_capabilities()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $capabilities$
  SELECT jsonb_build_object('contract_version','lead_lifecycle_v1','read_contract_version','lead_lifecycle_read_v1','enabled',
    public.crm_v2_role() IN ('sales','admin','owner') AND COALESCE((
      SELECT central_intake_enabled AND lead_work_enabled AND lead_lifecycle_enabled
      FROM public.crm_settings WHERE id),false));
$capabilities$;
REVOKE ALL ON FUNCTION public.crm_v2_lead_lifecycle_capabilities() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_v2_lead_lifecycle_capabilities() TO authenticated;

-- Read-only review context: one statement snapshot, no locks or mutation effects.
-- Preview counts may change before confirmation; the write rechecks scope, owner,
-- revision, open action and booking blockers under its transaction locks.
CREATE FUNCTION public.crm_v2_lead_lifecycle_context(p_customer_id uuid,p_interest_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $context$
DECLARE
  actor_id uuid:=auth.uid(); actor_role text:=public.crm_v2_role();
  work_json jsonb; candidates_json jsonb:='[]'::jsonb; candidates_more boolean:=false;
  source_lead_id uuid; scope_owner uuid; closed boolean;
  has_bookings boolean; has_open_interests boolean:=false;
  open_tasks bigint; pending_notices bigint;
BEGIN
  IF actor_id IS NULL OR actor_role IS NULL OR actor_role NOT IN ('sales','admin','owner') THEN
    RAISE EXCEPTION 'CRM_LIFECYCLE_FORBIDDEN';
  END IF;
  IF NOT COALESCE((SELECT central_intake_enabled AND lead_work_enabled AND lead_lifecycle_enabled
    FROM public.crm_settings WHERE id),false) THEN RAISE EXCEPTION 'CRM_LIFECYCLE_SETUP_REQUIRED'; END IF;
  IF p_customer_id IS NULL THEN RAISE EXCEPTION 'CRM_LIFECYCLE_INVALID_INPUT'; END IF;
  -- The shared read-v2 projection validates the customer/interest relationship.
  work_json:=public.crm_v2_lead_work_snapshot(p_customer_id,p_interest_id);
  scope_owner:=(work_json#>>'{owner,userId}')::uuid;
  closed:=(work_json->>'scopeClosed')::boolean;
  SELECT legacy_source_lead_id INTO source_lead_id FROM public.sales_customers WHERE id=p_customer_id;
  has_bookings:=EXISTS (SELECT 1 FROM public.sales s
    JOIN public.lead_project_interests i ON i.id=s.project_interest_id
    WHERE i.customer_id=p_customer_id AND (p_interest_id IS NULL OR i.id=p_interest_id))
    OR EXISTS (SELECT 1 FROM public.sales s WHERE s.lead_id=source_lead_id AND s.project_interest_id IS NULL);
  IF p_interest_id IS NULL THEN
    has_open_interests:=EXISTS (SELECT 1 FROM public.lead_project_interests
      WHERE customer_id=p_customer_id AND engagement_status<>'lost');
  END IF;
  IF actor_role='admin' THEN
    WITH recent AS (
      SELECT user_id,display_name FROM sales_private.crm_user_roles
        WHERE role='sales' AND is_active ORDER BY user_id LIMIT 201
    ), numbered AS (
      SELECT r.*,row_number() OVER (ORDER BY user_id) AS rn FROM recent r
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object('userId',n.user_id,'displayName',n.display_name)
      ORDER BY n.user_id) FILTER (WHERE n.rn<=200),'[]'::jsonb),count(*)>200
      INTO candidates_json,candidates_more FROM numbered n;
  END IF;
  SELECT count(*) INTO open_tasks FROM public.crm_sla_tasks t
    WHERE t.customer_id=p_customer_id AND t.project_interest_id IS NOT DISTINCT FROM p_interest_id AND t.status='open';
  SELECT count(*) INTO pending_notices FROM public.crm_notifications n
    JOIN public.crm_sla_tasks t ON t.id=n.task_id
    WHERE t.customer_id=p_customer_id AND t.project_interest_id IS NOT DISTINCT FROM p_interest_id
      AND t.status='open' AND n.withdrawn_at IS NULL;
  RETURN jsonb_build_object('work',work_json,'candidates',candidates_json,'candidatesTruncated',candidates_more,
    'canReassign',NOT closed AND actor_role='admin',
    'canClose',NOT closed AND (actor_role='admin' OR (actor_role='sales' AND actor_id=scope_owner))
      AND NOT has_bookings AND NOT has_open_interests,
    'blockers',jsonb_build_object('hasBookingHistory',has_bookings,'hasOpenInterests',has_open_interests),
    'impact',jsonb_build_object('openSlaCount',open_tasks,'pendingNotificationCount',pending_notices));
END;
$context$;
REVOKE ALL ON FUNCTION public.crm_v2_lead_lifecycle_context(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_v2_lead_lifecycle_context(uuid,uuid) TO authenticated;

CREATE FUNCTION public.crm_v2_change_lead_lifecycle(p_request_id uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $lifecycle$
DECLARE
  actor_id uuid:=auth.uid(); actor_role text:=public.crm_v2_role(); actor_name text;
  enabled boolean; command_name text; reason_value text;
  customer_id_value uuid; interest_id_value uuid; expected_revision uuid; expected_action uuid;
  new_owner uuid; scope_owner uuid; scope_revision uuid; scope_status text;
  customer_row public.sales_customers%ROWTYPE;
  interest_row public.lead_project_interests%ROWTYPE;
  prior_action public.crm_next_actions%ROWTYPE;
  request_row sales_private.lead_work_command_requests%ROWTYPE;
  task_row public.crm_sla_tasks%ROWTYPE;
  role_row sales_private.crm_user_roles%ROWTYPE; target_active boolean:=false;
  next_action_id uuid; next_revision uuid:=gen_random_uuid(); server_now timestamptz;
  affected_tasks uuid[]:=ARRAY[]::uuid[]; old_tasks jsonb:='[]'::jsonb;
  response_value jsonb;
  uuid_pattern text:='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
BEGIN
  IF actor_id IS NULL OR actor_role IS NULL OR actor_role NOT IN ('sales','admin') THEN
    RAISE EXCEPTION 'CRM_LIFECYCLE_FORBIDDEN';
  END IF;
  SELECT central_intake_enabled AND lead_work_enabled AND lead_lifecycle_enabled INTO enabled
    FROM public.crm_settings WHERE id FOR SHARE;
  IF enabled IS DISTINCT FROM true THEN RAISE EXCEPTION 'CRM_LIFECYCLE_SETUP_REQUIRED'; END IF;
  IF p_request_id IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object'
    OR octet_length(p_payload::text)>16384 THEN RAISE EXCEPTION 'CRM_LIFECYCLE_INVALID_INPUT'; END IF;
  IF NOT (p_payload ?& ARRAY['command','customerId','interestId','expectedRevision','expectedActionId','reason'])
    OR jsonb_typeof(p_payload->'command') IS DISTINCT FROM 'string'
    OR (p_payload->>'command') NOT IN ('reassign_owner','close_lost') THEN
    RAISE EXCEPTION 'CRM_LIFECYCLE_INVALID_INPUT';
  END IF;
  command_name:=p_payload->>'command';
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN (
      'command','customerId','interestId','expectedRevision','expectedActionId','reason','newOwnerUserId'))
    OR (command_name='close_lost' AND p_payload ? 'newOwnerUserId')
    OR (command_name='reassign_owner' AND NOT (p_payload ? 'newOwnerUserId')) THEN
    RAISE EXCEPTION 'CRM_LIFECYCLE_INVALID_INPUT';
  END IF;
  IF jsonb_typeof(p_payload->'customerId') IS DISTINCT FROM 'string'
    OR length(p_payload->>'customerId')<>36 OR (p_payload->>'customerId') !~ uuid_pattern
    OR jsonb_typeof(p_payload->'expectedRevision') IS DISTINCT FROM 'string'
    OR length(p_payload->>'expectedRevision')<>36 OR (p_payload->>'expectedRevision') !~ uuid_pattern
    OR jsonb_typeof(p_payload->'interestId') NOT IN ('string','null')
    OR (jsonb_typeof(p_payload->'interestId')='string'
      AND (length(p_payload->>'interestId')<>36 OR (p_payload->>'interestId') !~ uuid_pattern))
    OR jsonb_typeof(p_payload->'expectedActionId') NOT IN ('string','null')
    OR (jsonb_typeof(p_payload->'expectedActionId')='string'
      AND (length(p_payload->>'expectedActionId')<>36 OR (p_payload->>'expectedActionId') !~ uuid_pattern))
    OR jsonb_typeof(p_payload->'reason') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'CRM_LIFECYCLE_INVALID_INPUT';
  END IF;
  IF command_name='reassign_owner' THEN
    IF jsonb_typeof(p_payload->'newOwnerUserId') IS DISTINCT FROM 'string'
      OR length(p_payload->>'newOwnerUserId')<>36 OR (p_payload->>'newOwnerUserId') !~ uuid_pattern THEN
      RAISE EXCEPTION 'CRM_LIFECYCLE_INVALID_INPUT';
    END IF;
    new_owner:=(p_payload->>'newOwnerUserId')::uuid;
  END IF;
  -- Only translate the text-validator error, before any mutation. Never swallow a
  -- later transaction failure or record a receipt for a partially applied command.
  BEGIN
    reason_value:=sales_private.crm_work_text(p_payload->>'reason',1000);
  EXCEPTION WHEN raise_exception THEN
    RAISE EXCEPTION 'CRM_LIFECYCLE_INVALID_INPUT';
  END;
  customer_id_value:=(p_payload->>'customerId')::uuid;
  interest_id_value:=(p_payload->>'interestId')::uuid;
  expected_revision:=(p_payload->>'expectedRevision')::uuid;
  expected_action:=(p_payload->>'expectedActionId')::uuid;

  -- SAME lock order and receipt namespace as 04: settings -> request -> customer
  -- -> selected interest -> ordered role rows -> action -> ordered SLA tasks.
  -- Every future interest-create/booking/reopen/merge command MUST lock customer
  -- first too. Broad legacy writes must be cut off before enabling this feature.
  PERFORM pg_advisory_xact_lock(hashtextextended('lead-work:'||actor_id::text||':'||p_request_id::text,0));
  SELECT * INTO customer_row FROM public.sales_customers WHERE id=customer_id_value FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CRM_LIFECYCLE_NOT_FOUND'; END IF;
  scope_owner:=customer_row.owner_user_id;
  scope_revision:=customer_row.lifecycle_revision;
  scope_status:=customer_row.intake_status;
  IF interest_id_value IS NOT NULL THEN
    SELECT * INTO interest_row FROM public.lead_project_interests
      WHERE id=interest_id_value AND customer_id=customer_id_value FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'CRM_LIFECYCLE_NOT_FOUND'; END IF;
    scope_owner:=interest_row.owner_user_id;
    scope_revision:=interest_row.lifecycle_revision;
    scope_status:=interest_row.engagement_status;
  END IF;
  -- Derive authority only from rows actually locked by this ordered scan. A role
  -- inserted after the scan must not become an unlocked active actor/target.
  actor_role:=NULL;
  FOR role_row IN SELECT * FROM sales_private.crm_user_roles
    WHERE user_id IN (actor_id,scope_owner,new_owner) ORDER BY user_id FOR SHARE
  LOOP
    IF role_row.user_id=actor_id AND role_row.is_active THEN
      actor_role:=role_row.role; actor_name:=role_row.display_name;
    END IF;
    IF role_row.user_id=new_owner THEN
      target_active:=role_row.role='sales' AND role_row.is_active;
    END IF;
  END LOOP;
  IF actor_role IS NULL OR actor_role NOT IN ('sales','admin')
    OR (command_name='reassign_owner' AND actor_role<>'admin')
    OR (command_name='close_lost' AND actor_role='sales' AND actor_id<>scope_owner) THEN
    RAISE EXCEPTION 'CRM_LIFECYCLE_FORBIDDEN';
  END IF;
  -- Authorization first; replay before state/version checks so a successful close
  -- or transfer can be recovered with exactly the same payload. Admin may rescue
  -- work whose OLD owner is inactive. The NEW owner must be active for new writes.
  SELECT * INTO request_row FROM sales_private.lead_work_command_requests
    WHERE actor_user_id=actor_id AND request_id=p_request_id;
  IF FOUND THEN
    IF request_row.request_payload IS DISTINCT FROM p_payload THEN
      RAISE EXCEPTION 'CRM_LIFECYCLE_IDEMPOTENCY_CONFLICT';
    END IF;
    RETURN request_row.response || jsonb_build_object('replayed',true);
  END IF;
  IF customer_row.merged_into_customer_id IS NOT NULL OR scope_status='lost' THEN
    RAISE EXCEPTION 'CRM_LIFECYCLE_SCOPE_CLOSED';
  END IF;
  IF scope_revision IS DISTINCT FROM expected_revision THEN RAISE EXCEPTION 'CRM_LIFECYCLE_STALE_SCOPE'; END IF;
  SELECT * INTO prior_action FROM public.crm_next_actions
    WHERE customer_id=customer_id_value AND project_interest_id IS NOT DISTINCT FROM interest_id_value
      AND status='open' FOR UPDATE;
  IF prior_action.id IS DISTINCT FROM expected_action THEN RAISE EXCEPTION 'CRM_LIFECYCLE_STALE_ACTION'; END IF;
  IF command_name='reassign_owner' THEN
    IF new_owner=scope_owner THEN RAISE EXCEPTION 'CRM_LIFECYCLE_UNCHANGED_OWNER'; END IF;
    IF target_active IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'CRM_LIFECYCLE_INACTIVE_TARGET';
    END IF;
  ELSE
    -- Lost is pre-booking ONLY, including cancelled/finished booking history.
    -- An unmapped legacy sale for this source customer also requires review first.
    IF EXISTS (SELECT 1 FROM public.sales s
      JOIN public.lead_project_interests i ON i.id=s.project_interest_id
      WHERE i.customer_id=customer_id_value AND (interest_id_value IS NULL OR i.id=interest_id_value))
      OR EXISTS (SELECT 1 FROM public.sales s
        WHERE s.lead_id=customer_row.legacy_source_lead_id AND s.project_interest_id IS NULL) THEN
      RAISE EXCEPTION 'CRM_LIFECYCLE_BOOKING_HISTORY_EXISTS';
    END IF;
    -- Closing intake is NOT closing all projects. Do not hide an active interest.
    IF interest_id_value IS NULL AND EXISTS (SELECT 1 FROM public.lead_project_interests
      WHERE customer_id=customer_id_value AND engagement_status<>'lost') THEN
      RAISE EXCEPTION 'CRM_LIFECYCLE_OPEN_INTERESTS';
    END IF;
  END IF;
  -- Lock all affected open obligations before sampling authoritative time.
  FOR task_row IN SELECT * FROM public.crm_sla_tasks
    WHERE customer_id=customer_id_value AND project_interest_id IS NOT DISTINCT FROM interest_id_value
      AND status='open' ORDER BY id FOR UPDATE
  LOOP
    affected_tasks:=array_append(affected_tasks,task_row.id);
    -- No leave/HR details or unrestricted evaluation_snapshot in the public audit.
    old_tasks:=old_tasks || jsonb_build_array(jsonb_build_object('id',task_row.id,
      'ownerUserId',task_row.owner_user_id,'serviceDueAt',task_row.service_due_at,
      'staffDueAt',task_row.staff_due_at,'accountabilityState',task_row.accountability_state));
  END LOOP;
  server_now:=clock_timestamp();

  IF prior_action.id IS NOT NULL THEN
    UPDATE public.crm_next_actions SET
      status=CASE WHEN command_name='reassign_owner' THEN 'superseded' ELSE 'cancelled' END,
      closed_at=server_now,closed_by_user_id=actor_id,close_reason=reason_value WHERE id=prior_action.id;
    IF command_name='reassign_owner' THEN
      next_action_id:=gen_random_uuid();
      INSERT INTO public.crm_next_actions (
        id,customer_id,project_interest_id,owner_user_id,action_text,due_at,plan_started_at,
        previous_action_id,source_activity_id,recorded_by_user_id,recorded_at
      ) VALUES (
        next_action_id,customer_id_value,interest_id_value,new_owner,prior_action.action_text,
        prior_action.due_at,prior_action.plan_started_at,prior_action.id,prior_action.source_activity_id,actor_id,server_now
      );
    END IF;
  END IF;
  IF interest_id_value IS NULL THEN
    UPDATE public.sales_customers SET
      owner_user_id=CASE WHEN command_name='reassign_owner' THEN new_owner ELSE owner_user_id END,
      owner_assigned_at=CASE WHEN command_name='reassign_owner' THEN server_now ELSE owner_assigned_at END,
      intake_status=CASE WHEN command_name='close_lost' THEN 'lost' ELSE intake_status END,
      lifecycle_revision=next_revision,updated_at=server_now WHERE id=customer_id_value;
  ELSE
    UPDATE public.lead_project_interests SET
      owner_user_id=CASE WHEN command_name='reassign_owner' THEN new_owner ELSE owner_user_id END,
      owner_assigned_at=CASE WHEN command_name='reassign_owner' THEN server_now ELSE owner_assigned_at END,
      engagement_status=CASE WHEN command_name='close_lost' THEN 'lost' ELSE engagement_status END,
      lifecycle_revision=next_revision,updated_at=server_now
      WHERE id=interest_id_value AND customer_id=customer_id_value;
  END IF;
  IF command_name='reassign_owner' THEN
    -- Keep service clock/source/status. New-owner staff fairness requires separate
    -- policy/calendar review: do not inherit the old owner's deadline or score.
    UPDATE public.crm_sla_tasks SET owner_user_id=new_owner,staff_due_at=NULL,notify_at=NULL,
      accountability_state='needs_schedule',
      evaluation_snapshot=evaluation_snapshot || jsonb_build_object('lifecycleReview',jsonb_build_object(
        'state','owner_change_pending_review','revision',next_revision,'changedAt',server_now))
      WHERE id=ANY(affected_tasks);
    INSERT INTO public.crm_sla_exceptions (task_id,exception_type,reason,recorded_by_user_id,created_at)
      SELECT task_id,'owner_change',reason_value,actor_id,server_now FROM unnest(affected_tasks) AS t(task_id);
  ELSE
    -- Cancellation is not contact success/done. Retain deadlines and any existing
    -- lateness; reporting must include cancelled obligations and their close time.
    UPDATE public.crm_sla_tasks SET status='cancelled',cancelled_at=server_now,
      cancelled_by_user_id=actor_id,cancellation_reason=reason_value WHERE id=ANY(affected_tasks);
  END IF;
  UPDATE public.crm_notifications SET withdrawn_at=server_now,withdrawal_reason=reason_value
    WHERE task_id=ANY(affected_tasks) AND withdrawn_at IS NULL;
  INSERT INTO public.crm_audit_events (
    customer_id,entity_type,entity_id,event_type,reason_text,actor_user_id,actor_kind,
    actor_name_snapshot,old_values,new_values,occurred_at,recorded_at
  ) VALUES (
    customer_id_value,CASE WHEN interest_id_value IS NULL THEN 'sales_customer' ELSE 'lead_project_interest' END,
    COALESCE(interest_id_value,customer_id_value),command_name,reason_value,actor_id,'staff',actor_name,
    jsonb_build_object('revision',scope_revision,'ownerUserId',scope_owner,'status',scope_status,
      'nextAction',CASE WHEN prior_action.id IS NULL THEN NULL ELSE to_jsonb(prior_action) END,'openSlaTasks',old_tasks),
    jsonb_build_object('revision',next_revision,'interestId',interest_id_value,
      'ownerUserId',CASE WHEN command_name='reassign_owner' THEN new_owner ELSE scope_owner END,
      'status',CASE WHEN command_name='close_lost' THEN 'lost' ELSE scope_status END,
      'nextActionId',next_action_id,'affectedSlaTaskIds',to_jsonb(affected_tasks),
      'priorWasOverdue',CASE WHEN prior_action.id IS NULL THEN NULL ELSE prior_action.due_at<server_now END),
    server_now,server_now
  );
  response_value:=jsonb_build_object('revision',next_revision,'nextActionId',next_action_id,'replayed',false);
  INSERT INTO sales_private.lead_work_command_requests (actor_user_id,request_id,request_payload,response,created_at)
    VALUES (actor_id,p_request_id,p_payload,response_value,server_now);
  RETURN response_value;
END;
$lifecycle$;
REVOKE ALL ON FUNCTION public.crm_v2_change_lead_lifecycle(uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_v2_change_lead_lifecycle(uuid,jsonb) TO authenticated;

-- No scheduler, SQL execution, legacy sync, sales/plot mutation,
-- reopening, merging, booking cancellation or transfer confirmation in this draft.
-- Pending uncertain commands remain pending: ownership changes never prove a prior
-- write failed. Request reconciliation and lifecycle UI remain separate work.
ROLLBACK;
