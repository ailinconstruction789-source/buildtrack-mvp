-- SALES V2 FIRST-CONTACT SLA PREVIEW SOURCE -- DESIGN ONLY, 2026-09-17.
-- NEVER RUN ON SUPABASE. Depends on the UNAPPLIED base and companions 04--07.
-- This is not a deployment migration. Static checks do not validate PostgreSQL,
-- RLS or runtime transaction behavior; isolated database tests remain required.
-- Admin-only READ source for a server-side dry run. No calculation, proof write,
-- deadline persistence, notification delivery, cron, import or feature enablement.
-- Raw calendars/evidence must remain server-side, never forwarded to the browser.
BEGIN;
DO $draft_only$
BEGIN
  RAISE EXCEPTION 'DESIGN ONLY: SLA preview draft is not authorized for database execution';
END;
$draft_only$;

ALTER TABLE public.crm_settings
  ADD COLUMN sla_preview_enabled boolean NOT NULL DEFAULT false;

CREATE FUNCTION public.crm_v2_sla_preview_capabilities()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $capabilities$
  SELECT jsonb_build_object('contract_version','first_contact_preview_v1','enabled',
    public.crm_v2_role()='admin' AND COALESCE((
      SELECT central_intake_enabled AND lead_work_enabled AND lead_lifecycle_enabled
        AND work_schedule_enabled AND notifications_enabled AND sla_preview_enabled
      FROM public.crm_settings WHERE id),false));
$capabilities$;
REVOKE ALL ON FUNCTION public.crm_v2_sla_preview_capabilities() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_v2_sla_preview_capabilities() TO authenticated;

-- STABLE keeps the entire paginated queue, settings, role, audit evidence and
-- calendar projection on one statement snapshot. Opening it acquires no row or
-- advisory locks and writes nothing, including read_at, last_seen or readiness.
-- No arbitrary actor/owner/customer inputs: this is the bounded Admin queue only.
CREATE FUNCTION public.crm_v2_sla_preview_source(p_page integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog SET timezone = 'UTC'
AS $source$
DECLARE
  actor_id uuid:=auth.uid(); actor_role text:=public.crm_v2_role(); as_of timestamptz;
  settings_row public.crm_settings%ROWTYPE;
  task_row public.crm_sla_tasks%ROWTYPE;
  customer_row public.sales_customers%ROWTYPE;
  owner_row sales_private.crm_user_roles%ROWTYPE;
  head_row sales_private.crm_work_calendars%ROWTYPE;
  version_row sales_private.crm_work_calendar_versions%ROWTYPE;
  task_json jsonb:='[]'::jsonb; calendar_json jsonb; periods_json jsonb;
  page_count integer:=0; has_more boolean:=false; period_count bigint;
  original_hours integer; creation_count bigint; valid_creation_count bigint;
  creation_proven boolean; unchanged_owner boolean; pending_lifecycle boolean;
BEGIN
  IF actor_id IS NULL OR actor_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'CRM_SLA_PREVIEW_FORBIDDEN';
  END IF;
  SELECT * INTO settings_row FROM public.crm_settings WHERE id;
  IF NOT FOUND OR (settings_row.central_intake_enabled AND settings_row.lead_work_enabled
    AND settings_row.lead_lifecycle_enabled AND settings_row.work_schedule_enabled
    AND settings_row.notifications_enabled AND settings_row.sla_preview_enabled) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'CRM_SLA_PREVIEW_SETUP_REQUIRED';
  END IF;
  IF p_page IS NULL OR p_page<0 OR p_page>1000 THEN RAISE EXCEPTION 'CRM_SLA_PREVIEW_INVALID_INPUT'; END IF;
  as_of:=clock_timestamp();
  -- Do not silently remove closed scopes, legacy rows or missing/contradictory
  -- evidence: the engine must explain why those rows are held. This first pass
  -- excludes project-scoped, follow-up and activity-derived obligations entirely.
  FOR task_row IN SELECT t.* FROM public.crm_sla_tasks t
    WHERE t.task_type='first_contact' AND t.project_interest_id IS NULL
      AND t.status='open' AND t.source_activity_id IS NULL
    ORDER BY t.created_at ASC,t.id ASC LIMIT 21 OFFSET p_page*20
  LOOP
    page_count:=page_count+1;
    IF page_count>20 THEN has_more:=true; EXIT; END IF;
    SELECT * INTO customer_row FROM public.sales_customers WHERE id=task_row.customer_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'CRM_SLA_PREVIEW_SETUP_REQUIRED'; END IF;
    SELECT * INTO owner_row FROM sales_private.crm_user_roles WHERE user_id=task_row.owner_user_id;

    -- Only the original JSON NUMBER integer is evidence. Nested CASE prevents
    -- casts being evaluated before shape/length guards; no 24-hour fallback and
    -- no unsafe cast of an arbitrary-length JSON string or numeric exponent.
    original_hours:=CASE WHEN jsonb_typeof(task_row.evaluation_snapshot->'initialContactHours')='number' THEN
      CASE WHEN (task_row.evaluation_snapshot->>'initialContactHours') ~ '^[1-9][0-9]{0,9}$' THEN
        CASE WHEN (task_row.evaluation_snapshot->>'initialContactHours')::bigint<=2147483647
          THEN (task_row.evaluation_snapshot->>'initialContactHours')::integer ELSE NULL END
      ELSE NULL END ELSE NULL END;

    -- Count ALL customer-created events for this entity, including malformed
    -- duplicates, before accepting exactly one correctly bound original event.
    -- A correcting event anywhere that points at it invalidates original proof.
    SELECT count(*),count(*) FILTER (WHERE a.customer_id=customer_row.id
      AND a.actor_kind='staff' AND a.actor_user_id IS NOT NULL AND a.correction_of_event_id IS NULL
      AND a.actor_user_id=customer_row.created_by_user_id
      AND isfinite(a.occurred_at) AND isfinite(a.recorded_at)
      AND a.occurred_at=customer_row.lead_created_at AND a.occurred_at=task_row.obligation_started_at
      AND a.recorded_at>=a.occurred_at AND a.recorded_at<=as_of
      AND jsonb_typeof(a.new_values)='object' AND jsonb_typeof(a.new_values->'ownerUserId')='string'
      AND a.new_values->>'ownerUserId'=customer_row.owner_user_id::text
      AND NOT EXISTS (SELECT 1 FROM public.crm_audit_events correction WHERE correction.correction_of_event_id=a.id))
      INTO creation_count,valid_creation_count
      FROM public.crm_audit_events a
      WHERE a.entity_type='customer' AND a.entity_id=customer_row.id AND a.event_type='created';
    creation_proven:=creation_count=1 AND valid_creation_count=1;
    -- The actual 05 owner-transfer event uses sales_customer, not customer.
    -- Reject an ABA transfer even when the current owner equals the original.
    -- Corrections to either creation/ownership entity (or referencing that
    -- history under different metadata) require review, never inferred continuity.
    unchanged_owner:=COALESCE(creation_proven
      AND customer_row.owner_assigned_at=customer_row.lead_created_at
      AND NOT EXISTS (SELECT 1 FROM public.crm_audit_events a
        WHERE a.entity_id=customer_row.id AND a.entity_type IN ('sales_customer','customer') AND a.event_type='reassign_owner')
      AND NOT EXISTS (SELECT 1 FROM public.crm_audit_events correction
        LEFT JOIN public.crm_audit_events original ON original.id=correction.correction_of_event_id
        WHERE correction.correction_of_event_id IS NOT NULL
          AND ((correction.entity_id=customer_row.id AND correction.entity_type IN ('customer','sales_customer'))
            OR (original.entity_id=customer_row.id AND original.entity_type IN ('customer','sales_customer')))),false);
    -- No clear-review protocol exists yet. Any presence, even null/malformed,
    -- is pending; do not invent a "cleared" state for current 05 owner changes.
    pending_lifecycle:=jsonb_typeof(task_row.evaluation_snapshot) IS DISTINCT FROM 'object'
      OR task_row.evaluation_snapshot ? 'lifecycleReview';

    calendar_json:=NULL;
    SELECT * INTO head_row FROM sales_private.crm_work_calendars WHERE sales_user_id=task_row.owner_user_id;
    IF FOUND THEN
      SELECT * INTO version_row FROM sales_private.crm_work_calendar_versions
        WHERE id=head_row.current_version_id AND calendar_id=head_row.id AND sales_user_id=task_row.owner_user_id;
      IF NOT FOUND OR version_row.published_at IS NULL OR NOT isfinite(version_row.published_at)
        OR version_row.published_at>as_of THEN RAISE EXCEPTION 'CRM_SLA_PREVIEW_SETUP_REQUIRED'; END IF;
      WITH bounded AS (
        SELECT id,sales_user_id,period_type,starts_at,ends_at FROM public.crm_work_periods
          WHERE calendar_version_id=version_row.id
          ORDER BY starts_at,id LIMIT 401
      )
      SELECT COALESCE(jsonb_agg(jsonb_build_object('id',p.id,'salesUserId',p.sales_user_id,
        'type',p.period_type,'startsAt',p.starts_at,'endsAt',p.ends_at) ORDER BY p.starts_at,p.id),'[]'::jsonb),count(*)
        INTO periods_json,period_count FROM bounded p;
      -- Never silently truncate a calendar or treat unversioned legacy rows as
      -- complete. Invalid overlap/coverage in a bounded raw calendar is left to
      -- the pure engine to hold explicitly; this source does not calculate it.
      -- 06's composite version/owner FK already forbids mixed-owner periods. Still
      -- project every row of this version: do not silently hide inconsistent
      -- evidence if a future schema/import path weakens that invariant.
      IF period_count>400 THEN RAISE EXCEPTION 'CRM_SLA_PREVIEW_SETUP_REQUIRED'; END IF;
      calendar_json:=jsonb_build_object('id',head_row.id,'version',version_row.id,'ownerUserId',task_row.owner_user_id,
        'coverage',jsonb_build_object('startsAt',version_row.coverage_starts_at,'endsAt',version_row.coverage_ends_at,
          'complete',version_row.coverage_complete),'periods',periods_json);
    END IF;

    task_json:=task_json || jsonb_build_array(jsonb_build_object(
      'id',task_row.id,'customerId',customer_row.id,'customerName',customer_row.customer_name,
      'ownerUserId',task_row.owner_user_id,'ownerName',NULLIF(btrim(owner_row.display_name),''),
      'scopeOwnerUserId',customer_row.owner_user_id,
      'ownerIsActiveSales',COALESCE(owner_row.role='sales' AND owner_row.is_active,false),
      'lifecycleRevision',customer_row.lifecycle_revision,
      'scopeClosed',customer_row.merged_into_customer_id IS NOT NULL OR customer_row.intake_status='lost',
      'recordOrigin',customer_row.record_origin,'leadCreatedAt',customer_row.lead_created_at,
      'obligationStartedAt',task_row.obligation_started_at,'serviceDueAt',task_row.service_due_at,
      'taskCreatedAt',task_row.created_at,'initialContactHours',original_hours,
      'creationProven',creation_proven,'ownerHistoryUnchanged',unchanged_owner,'lifecycleReviewPending',pending_lifecycle,
      -- Inconsistent terminal metadata on an open task still requires review;
      -- do not infer completion/cancellation or expose the raw private fields.
      'hasContactEvidence',customer_row.first_contacted_at IS NOT NULL
        OR task_row.completed_at IS NOT NULL OR task_row.completed_by_activity_id IS NOT NULL
        OR EXISTS (SELECT 1 FROM public.lead_activities a
        WHERE a.customer_id=customer_row.id AND a.result='contact_success'),
      'hasCustomerPostponement',EXISTS (SELECT 1 FROM public.lead_activities a
        WHERE a.customer_id=customer_row.id AND a.result='customer_requested_later')
        OR EXISTS (SELECT 1 FROM public.crm_sla_exceptions e WHERE e.task_id=task_row.id AND e.exception_type='customer_requested_later'),
      'hasExceptions',task_row.accountability_state='exception'
        OR task_row.cancelled_at IS NOT NULL OR task_row.cancelled_by_user_id IS NOT NULL
        OR task_row.cancellation_reason IS NOT NULL
        OR EXISTS (SELECT 1 FROM public.crm_sla_exceptions e WHERE e.task_id=task_row.id),
      'calendar',calendar_json));
  END LOOP;
  RETURN jsonb_build_object('actor',jsonb_build_object('userId',actor_id,'role','admin'),'asOf',as_of,
    'page',p_page,'pageSize',20,'hasMore',has_more,
    'settings',jsonb_build_object('version',settings_row.version,'initialContactHours',settings_row.initial_contact_hours,
      'nextShiftResponseMinutes',settings_row.next_shift_response_minutes),'tasks',task_json);
END;
$source$;
REVOKE ALL ON FUNCTION public.crm_v2_sla_preview_source(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_v2_sla_preview_source(integer) TO authenticated;

-- WITHHELD: even an eligible preview must NOT persist notificationBinding,
-- staff_due_at, notify_at, read_at, a new notice or a recalculated service clock.
ROLLBACK;
