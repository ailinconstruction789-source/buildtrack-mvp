-- SALES V2 NOTIFICATION INBOX -- DESIGN ONLY, 2026-09-17. NEVER RUN ON SUPABASE.
-- Depends on the UNAPPLIED base and companions 04, 05 and 06. Not deployment SQL.
-- Static tests do NOT validate PostgreSQL syntax, RLS or concurrent transactions.
-- A separately reviewed deployment migration and isolated database tests are required.
-- Reuses the existing notification ledger. No emitter, scheduler, SLA calculation,
-- backfill, ready-proof fabrication or KPI scoring. The agreed future warning is
-- 30 minutes (configurable later); this inbox neither calculates nor sends it.
BEGIN;
DO $draft_only$
BEGIN
  RAISE EXCEPTION 'DESIGN ONLY: notification inbox draft is not authorized for database execution';
END;
$draft_only$;

ALTER TABLE public.crm_settings
  ADD COLUMN notifications_enabled boolean NOT NULL DEFAULT false;

-- Nullable provenance leaves existing notices untouched and ineligible. A future
-- trusted SLA writer must bind a READY calculation to owner/scope/calendar and
-- provide matching metadata on the notice. No default or legacy inference.
ALTER TABLE public.crm_notifications
  ADD COLUMN lifecycle_revision uuid,
  ADD COLUMN calendar_id uuid REFERENCES sales_private.crm_work_calendars(id) ON DELETE RESTRICT,
  ADD COLUMN calendar_version_id uuid,
  ADD COLUMN staff_due_at_snapshot timestamptz,
  ADD COLUMN service_due_at_snapshot timestamptz,
  ADD CONSTRAINT crm_notification_calendar_version_fk FOREIGN KEY (calendar_version_id,calendar_id)
    REFERENCES sales_private.crm_work_calendar_versions(id,calendar_id) ON DELETE RESTRICT;
CREATE INDEX crm_notifications_own_inbox_idx ON public.crm_notifications(recipient_user_id,created_at DESC,id DESC)
  WHERE withdrawn_at IS NULL AND task_id IS NOT NULL;

-- The base own-recipient SELECT policy alone allows future/withdrawn/stale rows.
-- Revoke table access, even for Admin, so reads cannot bypass this projection.
-- No direct read/update/delete grants, no new receipt ledger, no user impersonation.
REVOKE ALL ON public.crm_notifications FROM PUBLIC, anon, authenticated;

CREATE FUNCTION sales_private.crm_visible_sla_notifications(p_actor uuid,p_as_of timestamptz)
RETURNS TABLE (
  id uuid, task_id uuid, customer_id uuid, interest_id uuid,
  customer_name text, project_name text, task_type text, notification_type text,
  available_at timestamptz, created_at timestamptz, read_at timestamptz,
  staff_due_at timestamptz, service_due_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $visible$
  SELECT n.id,t.id,c.id,i.id,c.customer_name,i.project_name,t.task_type,n.notification_type,
    n.available_at,n.created_at,n.read_at,t.staff_due_at,t.service_due_at
  FROM public.crm_notifications n
  JOIN public.crm_sla_tasks t ON t.id=n.task_id
  JOIN public.sales_customers c ON c.id=t.customer_id
  LEFT JOIN public.lead_project_interests i ON i.id=t.project_interest_id AND i.customer_id=c.id
  JOIN sales_private.crm_user_roles r ON r.user_id=p_actor AND r.role='sales' AND r.is_active
  JOIN sales_private.crm_work_calendars h ON h.id=n.calendar_id AND h.sales_user_id=p_actor
    AND h.current_version_id=n.calendar_version_id
  JOIN sales_private.crm_work_calendar_versions v ON v.id=n.calendar_version_id
    AND v.calendar_id=h.id AND v.sales_user_id=p_actor
  WHERE p_actor IS NOT NULL AND isfinite(p_as_of)
    AND n.recipient_user_id=p_actor AND t.owner_user_id=p_actor
    AND n.withdrawn_at IS NULL AND n.notification_type IN ('due_soon','overdue')
    AND n.visit_id IS NULL AND n.checklist_run_id IS NULL
    AND t.status='open' AND t.accountability_state='ready' AND t.task_type IN ('first_contact','follow_up')
    AND c.merged_into_customer_id IS NULL AND c.intake_status<>'lost'
    AND ((t.project_interest_id IS NULL AND c.owner_user_id=p_actor AND n.lifecycle_revision=c.lifecycle_revision)
      OR (t.project_interest_id IS NOT NULL AND i.id IS NOT NULL AND i.engagement_status<>'lost'
        AND i.owner_user_id=p_actor AND n.lifecycle_revision=i.lifecycle_revision))
    -- Text comparisons are deliberate: malformed/untrusted JSON can only hide a
    -- notice, never raise a cast error or substitute an inferred default binding.
    AND jsonb_typeof(t.evaluation_snapshot->'notificationBinding')='object'
    AND t.evaluation_snapshot#>>'{notificationBinding,state}'='ready'
    AND t.evaluation_snapshot#>>'{notificationBinding,ownerUserId}'=p_actor::text
    AND t.evaluation_snapshot#>>'{notificationBinding,lifecycleRevision}'=n.lifecycle_revision::text
    AND t.evaluation_snapshot#>>'{notificationBinding,calendarId}'=h.id::text
    AND t.evaluation_snapshot#>>'{notificationBinding,calendarVersion}'=v.id::text
    AND (t.evaluation_snapshot#>>'{lifecycleReview,state}') IS DISTINCT FROM 'owner_change_pending_review'
    AND n.staff_due_at_snapshot=t.staff_due_at AND n.service_due_at_snapshot=t.service_due_at
    AND isfinite(n.available_at) AND isfinite(n.created_at) AND isfinite(t.created_at)
    AND isfinite(t.staff_due_at) AND isfinite(t.service_due_at) AND isfinite(t.notify_at)
    AND n.available_at>=TIMESTAMPTZ '0001-01-01 00:00:00+00'
    AND n.created_at<=TIMESTAMPTZ '9999-12-31 23:59:59.999999+00'
    AND t.staff_due_at BETWEEN TIMESTAMPTZ '0001-01-01 00:00:00+00' AND TIMESTAMPTZ '9999-12-31 23:59:59.999999+00'
    AND t.service_due_at BETWEEN TIMESTAMPTZ '0001-01-01 00:00:00+00' AND TIMESTAMPTZ '9999-12-31 23:59:59.999999+00'
    AND n.available_at<=n.created_at AND n.created_at<=p_as_of
    AND n.available_at>=t.notify_at AND n.created_at>=t.created_at
    AND (n.read_at IS NULL OR (isfinite(n.read_at) AND n.read_at>=n.created_at AND n.read_at<=p_as_of))
    AND ((n.notification_type='due_soon' AND n.created_at<=t.staff_due_at)
      OR (n.notification_type='overdue' AND n.created_at>t.staff_due_at))
    -- Delivery evidence uses the time of creation, NOT the time of inbox reading.
    -- A valid already-delivered notice remains readable outside working hours.
    AND v.coverage_complete AND v.published_at<=n.created_at
    AND n.created_at>=v.coverage_starts_at AND n.created_at<v.coverage_ends_at
    AND t.notify_at>=v.coverage_starts_at AND t.notify_at<v.coverage_ends_at
    AND t.staff_due_at>=v.coverage_starts_at AND t.staff_due_at<=v.coverage_ends_at
    AND EXISTS (SELECT 1 FROM public.crm_work_periods w
      WHERE w.calendar_version_id=v.id AND w.sales_user_id=p_actor AND w.period_type='work'
        AND w.starts_at<=n.created_at AND n.created_at<w.ends_at)
    AND NOT EXISTS (SELECT 1 FROM public.crm_work_periods x
      WHERE x.calendar_version_id=v.id AND x.sales_user_id=p_actor AND x.period_type IN ('leave','break')
        AND x.starts_at<=n.created_at AND n.created_at<x.ends_at);
$visible$;
REVOKE ALL ON FUNCTION sales_private.crm_visible_sla_notifications(uuid,timestamptz) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.crm_v2_notifications_capabilities()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $capabilities$
  SELECT jsonb_build_object('contract_version','notifications_v1','enabled',
    public.crm_v2_role() IN ('sales','admin','owner') AND COALESCE((
      SELECT central_intake_enabled AND lead_work_enabled AND lead_lifecycle_enabled
        AND work_schedule_enabled AND notifications_enabled
      FROM public.crm_settings WHERE id),false));
$capabilities$;
REVOKE ALL ON FUNCTION public.crm_v2_notifications_capabilities() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_v2_notifications_capabilities() TO authenticated;

-- One STABLE read snapshot. No read acknowledgment, locks, last_seen or other
-- mutation occurs on opening/refreshing/paginating the inbox. Admin and Owner do
-- not inspect someone else's inbox; supported SLA notices currently belong to Sales.
CREATE FUNCTION public.crm_v2_notifications_snapshot(p_page integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog SET timezone = 'UTC'
AS $snapshot$
DECLARE
  actor_id uuid:=auth.uid(); actor_role text:=public.crm_v2_role(); as_of timestamptz;
  notice_json jsonb; has_more boolean; unread_count bigint;
BEGIN
  IF actor_id IS NULL OR actor_role IS NULL OR actor_role NOT IN ('sales','admin','owner') THEN
    RAISE EXCEPTION 'CRM_NOTIFICATION_FORBIDDEN';
  END IF;
  IF NOT COALESCE((SELECT central_intake_enabled AND lead_work_enabled AND lead_lifecycle_enabled
    AND work_schedule_enabled AND notifications_enabled FROM public.crm_settings WHERE id),false) THEN
    RAISE EXCEPTION 'CRM_NOTIFICATION_SETUP_REQUIRED';
  END IF;
  IF p_page IS NULL OR p_page<0 OR p_page>1000 THEN RAISE EXCEPTION 'CRM_NOTIFICATION_INVALID_INPUT'; END IF;
  as_of:=clock_timestamp();
  WITH visible AS MATERIALIZED (
    SELECT * FROM sales_private.crm_visible_sla_notifications(actor_id,as_of)
  ), page_rows AS (
    SELECT * FROM visible ORDER BY created_at DESC,id DESC LIMIT 51 OFFSET p_page*50
  ), numbered AS (
    SELECT p.*,row_number() OVER (ORDER BY created_at DESC,id DESC) AS rn FROM page_rows p
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id',n.id,'taskId',n.task_id,'customerId',n.customer_id,'interestId',n.interest_id,
      'customerName',n.customer_name,'projectName',n.project_name,'taskType',n.task_type,'type',n.notification_type,
      'availableAt',n.available_at,'createdAt',n.created_at,'readAt',n.read_at,
      'staffDueAt',n.staff_due_at,'serviceDueAt',n.service_due_at) ORDER BY n.rn)
      FILTER (WHERE n.rn<=50),'[]'::jsonb),count(*)>50,
    (SELECT count(*) FROM visible WHERE read_at IS NULL)
    INTO notice_json,has_more,unread_count FROM numbered n;
  RETURN jsonb_build_object('actor',jsonb_build_object('userId',actor_id,'role',actor_role),
    'asOf',as_of,'page',p_page,'pageSize',50,'hasMore',has_more,'unreadCount',unread_count,'notifications',notice_json);
END;
$snapshot$;
REVOKE ALL ON FUNCTION public.crm_v2_notifications_snapshot(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_v2_notifications_snapshot(integer) TO authenticated;

-- Monotonic, intrinsically idempotent acknowledgment of ONE own current notice.
-- It is not contact success, task completion or CRM edit authority. A retry of a
-- now-withdrawn notice returns NOT_AVAILABLE rather than revealing its old state.
-- Compatible lock order: settings -> customer -> interest -> calendar head ->
-- actor role -> SLA task -> notification. All future SLA writers must follow it.
CREATE FUNCTION public.crm_v2_mark_notification_read(p_notification_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog SET timezone = 'UTC'
AS $acknowledge$
DECLARE
  actor_id uuid:=auth.uid(); actor_role text:=public.crm_v2_role(); enabled boolean;
  initial_task_id uuid; initial_customer_id uuid; initial_interest_id uuid; initial_calendar_id uuid;
  customer_row public.sales_customers%ROWTYPE;
  interest_row public.lead_project_interests%ROWTYPE;
  head_row sales_private.crm_work_calendars%ROWTYPE;
  role_row sales_private.crm_user_roles%ROWTYPE;
  task_row public.crm_sla_tasks%ROWTYPE;
  notice_row public.crm_notifications%ROWTYPE;
  server_now timestamptz; acknowledged_at timestamptz;
BEGIN
  IF actor_id IS NULL OR actor_role IS NULL OR actor_role NOT IN ('sales','admin','owner') THEN
    RAISE EXCEPTION 'CRM_NOTIFICATION_FORBIDDEN';
  END IF;
  SELECT central_intake_enabled AND lead_work_enabled AND lead_lifecycle_enabled
    AND work_schedule_enabled AND notifications_enabled INTO enabled
    FROM public.crm_settings WHERE id FOR SHARE;
  IF enabled IS DISTINCT FROM true THEN RAISE EXCEPTION 'CRM_NOTIFICATION_SETUP_REQUIRED'; END IF;
  IF p_notification_id IS NULL THEN RAISE EXCEPTION 'CRM_NOTIFICATION_INVALID_INPUT'; END IF;

  -- Unlocked lookup resolves only own row's lock targets; it is not authority.
  -- Re-read and compare all targets after locking; never expose lookup results.
  SELECT t.id,t.customer_id,t.project_interest_id,n.calendar_id
    INTO initial_task_id,initial_customer_id,initial_interest_id,initial_calendar_id
    FROM public.crm_notifications n JOIN public.crm_sla_tasks t ON t.id=n.task_id
    WHERE n.id=p_notification_id AND n.recipient_user_id=actor_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'CRM_NOTIFICATION_NOT_AVAILABLE'; END IF;
  SELECT * INTO customer_row FROM public.sales_customers WHERE id=initial_customer_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CRM_NOTIFICATION_NOT_AVAILABLE'; END IF;
  IF initial_interest_id IS NOT NULL THEN
    SELECT * INTO interest_row FROM public.lead_project_interests
      WHERE id=initial_interest_id AND customer_id=initial_customer_id FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'CRM_NOTIFICATION_NOT_AVAILABLE'; END IF;
  END IF;
  SELECT * INTO head_row FROM sales_private.crm_work_calendars
    WHERE id=initial_calendar_id AND sales_user_id=actor_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CRM_NOTIFICATION_NOT_AVAILABLE'; END IF;
  actor_role:=NULL;
  SELECT * INTO role_row FROM sales_private.crm_user_roles WHERE user_id=actor_id FOR SHARE;
  IF FOUND AND role_row.is_active THEN actor_role:=role_row.role; END IF;
  IF actor_role IS NULL OR actor_role NOT IN ('sales','admin','owner') THEN
    RAISE EXCEPTION 'CRM_NOTIFICATION_FORBIDDEN';
  END IF;
  SELECT * INTO task_row FROM public.crm_sla_tasks WHERE id=initial_task_id FOR SHARE;
  IF NOT FOUND OR task_row.customer_id IS DISTINCT FROM initial_customer_id
    OR task_row.project_interest_id IS DISTINCT FROM initial_interest_id THEN
    RAISE EXCEPTION 'CRM_NOTIFICATION_NOT_AVAILABLE';
  END IF;
  SELECT * INTO notice_row FROM public.crm_notifications WHERE id=p_notification_id FOR UPDATE;
  IF NOT FOUND OR notice_row.recipient_user_id IS DISTINCT FROM actor_id
    OR notice_row.task_id IS DISTINCT FROM initial_task_id
    OR notice_row.calendar_id IS DISTINCT FROM initial_calendar_id THEN
    RAISE EXCEPTION 'CRM_NOTIFICATION_NOT_AVAILABLE';
  END IF;
  -- Sample after lock waits. This statement gets a fresh snapshot in this VOLATILE
  -- command and reuses exactly the inbox predicate under all authoritative locks.
  server_now:=clock_timestamp();
  IF NOT EXISTS (SELECT 1 FROM sales_private.crm_visible_sla_notifications(actor_id,server_now)
    WHERE id=p_notification_id) THEN RAISE EXCEPTION 'CRM_NOTIFICATION_NOT_AVAILABLE'; END IF;
  UPDATE public.crm_notifications n SET read_at=COALESCE(n.read_at,server_now)
    WHERE n.id=p_notification_id AND n.recipient_user_id=actor_id RETURNING n.read_at INTO acknowledged_at;
  RETURN jsonb_build_object('notificationId',p_notification_id,'readAt',acknowledged_at);
END;
$acknowledge$;
REVOKE ALL ON FUNCTION public.crm_v2_mark_notification_read(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_v2_mark_notification_read(uuid) TO authenticated;

-- Still WITHHELD: no new ready task, notification delivery, cron registration,
-- feature enablement, migration import or live validation is performed here.
ROLLBACK;
