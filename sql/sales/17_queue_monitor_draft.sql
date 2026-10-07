-- SALES V2 ADMIN QUEUE MONITOR -- DESIGN ONLY, 2026-09-23.
-- NEVER RUN ON SUPABASE. Depends on UNAPPLIED base and companions 04--16.
-- Read-only operational evidence, not recovery, scheduler or activation approval.
-- Stored assessments are not fresh eligibility; candidate work is not a delivery
-- backlog. No persisted commit/browser observation proves five-minute delivery.
BEGIN;
DO $draft_only$
BEGIN
  RAISE EXCEPTION 'DESIGN ONLY: queue monitor is not authorized for database execution';
END;
$draft_only$;

ALTER TABLE public.crm_settings ADD COLUMN sla_queue_monitor_enabled boolean NOT NULL DEFAULT false;

CREATE FUNCTION public.crm_v2_queue_monitor_capabilities()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog SET timezone = 'UTC'
AS $capabilities$
  SELECT jsonb_build_object('contract_version','first_contact_queue_monitor_v1','enabled',
    auth.uid() IS NOT NULL AND public.crm_v2_role()='admin' AND COALESCE((
      SELECT central_intake_enabled AND lead_work_enabled AND lead_lifecycle_enabled AND work_schedule_enabled
        AND notifications_enabled AND sla_preview_enabled AND sla_queue_monitor_enabled
      FROM public.crm_settings WHERE id),false));
$capabilities$;
REVOKE ALL ON FUNCTION public.crm_v2_queue_monitor_capabilities() FROM PUBLIC, anon, authenticated,
  buildtrack_sales_sla_worker, buildtrack_sales_sla_dispatcher;
GRANT EXECUTE ON FUNCTION public.crm_v2_queue_monitor_capabilities() TO authenticated;

-- One STABLE read snapshot, no row/advisory locks and no processing invocation.
-- Writer kill switches do not hide evidence. Exact PK lookups bound receipt work;
-- the existing11 partial index supports the ordered901 candidate prefix.
CREATE FUNCTION public.crm_v2_queue_monitor_snapshot()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog SET timezone = 'UTC'
AS $snapshot$
DECLARE
  actor_id uuid:=auth.uid(); actor_role text:=public.crm_v2_role(); as_of timestamptz:=statement_timestamp();
  settings_row public.crm_settings%ROWTYPE; cursor_row sales_private.crm_first_contact_cycle_cursor%ROWTYPE;
  current_id uuid; request_row sales_private.crm_first_contact_dispatch_requests%ROWTYPE;
  attempt_row sales_private.crm_first_contact_dispatch_attempts%ROWTYPE;
  receipt_row sales_private.crm_first_contact_worker_cycles%ROWTYPE;
  sample_count integer; held_count integer; unknown_count integer;
  receipt_value jsonb:=NULL; request_value jsonb:=NULL; response_value jsonb;
  started_at_value timestamptz; finished_at_value timestamptz;
  processed_count integer; receipt_held_count integer; notified_count integer;
  minimum_at constant timestamptz:=TIMESTAMPTZ '0001-01-01 00:00:00+00';
  maximum_at constant timestamptz:=TIMESTAMPTZ '9999-12-31 23:59:59.999999+00';
BEGIN
  IF actor_id IS NULL OR actor_role IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'CRM_QUEUE_MONITOR_FORBIDDEN'; END IF;
  SELECT * INTO settings_row FROM public.crm_settings WHERE id;
  IF NOT FOUND OR (settings_row.central_intake_enabled AND settings_row.lead_work_enabled
    AND settings_row.lead_lifecycle_enabled AND settings_row.work_schedule_enabled AND settings_row.notifications_enabled
    AND settings_row.sla_preview_enabled AND settings_row.sla_queue_monitor_enabled) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'CRM_QUEUE_MONITOR_SETUP_REQUIRED';
  END IF;
  IF NOT isfinite(as_of) OR as_of<minimum_at OR as_of>maximum_at THEN RAISE EXCEPTION 'CRM_QUEUE_MONITOR_SETUP_REQUIRED'; END IF;
  SELECT * INTO cursor_row FROM sales_private.crm_first_contact_cycle_cursor WHERE id;
  IF NOT FOUND OR (cursor_row.after_created_at IS NULL)<>(cursor_row.after_task_id IS NULL)
    OR (cursor_row.after_created_at IS NOT NULL AND (NOT isfinite(cursor_row.after_created_at)
      OR cursor_row.after_created_at<minimum_at OR cursor_row.after_created_at>maximum_at)) THEN
    RAISE EXCEPTION 'CRM_QUEUE_MONITOR_SETUP_REQUIRED';
  END IF;
  SELECT count(*),count(*) FILTER (WHERE review_state='held'),
    count(*) FILTER (WHERE review_state IS NULL OR review_state NOT IN ('ready','held','completed','closed'))
    INTO sample_count,held_count,unknown_count FROM (
      SELECT CASE WHEN jsonb_typeof(evaluation_snapshot->'processingReview')='object'
        AND jsonb_typeof(evaluation_snapshot#>'{processingReview,state}')='string'
        THEN evaluation_snapshot#>>'{processingReview,state}' ELSE NULL END AS review_state
      FROM public.crm_sla_tasks WHERE task_type='first_contact' AND project_interest_id IS NULL
        AND source_activity_id IS NULL AND status='open' ORDER BY created_at,id LIMIT 901
    ) bounded;
  SELECT current_request_id INTO current_id FROM sales_private.crm_first_contact_dispatch_control WHERE id;
  IF NOT FOUND THEN RAISE EXCEPTION 'CRM_QUEUE_MONITOR_SETUP_REQUIRED'; END IF;
  IF current_id IS NOT NULL THEN
    SELECT * INTO request_row FROM sales_private.crm_first_contact_dispatch_requests WHERE request_id=current_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'CRM_QUEUE_MONITOR_SETUP_REQUIRED'; END IF;
    SELECT * INTO attempt_row FROM sales_private.crm_first_contact_dispatch_attempts WHERE attempt_id=request_row.current_attempt_id;
    IF NOT FOUND OR attempt_row.request_id IS DISTINCT FROM current_id OR attempt_row.attempt_no IS DISTINCT FROM request_row.attempt_count
      OR request_row.status NOT IN ('reserved','retry_wait','review','completed')
      OR request_row.policy_version NOT IN ('completion_spacing_v1','bounded_burst_v2')
      OR NOT isfinite(request_row.created_at) OR request_row.created_at<minimum_at OR request_row.created_at>as_of
      OR NOT isfinite(attempt_row.prepared_at) OR attempt_row.prepared_at<request_row.created_at OR attempt_row.prepared_at>as_of
      OR NOT isfinite(request_row.next_attempt_at) OR request_row.next_attempt_at<request_row.created_at OR request_row.next_attempt_at>maximum_at
      OR (request_row.status='completed')<>(request_row.completed_at IS NOT NULL)
      OR (request_row.completed_at IS NOT NULL AND (NOT isfinite(request_row.completed_at)
        OR request_row.completed_at<attempt_row.prepared_at OR request_row.completed_at>as_of))
      OR (request_row.status IN ('reserved','completed') AND request_row.last_error_code IS NOT NULL)
      OR (request_row.status='retry_wait' AND request_row.last_error_code IS DISTINCT FROM 'TRANSIENT_RETRY')
      OR (request_row.status='review' AND COALESCE(request_row.last_error_code IN ('RETRY_LIMIT','PROCESSING_REVIEW'),false) IS NOT TRUE) THEN
      RAISE EXCEPTION 'CRM_QUEUE_MONITOR_SETUP_REQUIRED';
    END IF;
    SELECT * INTO receipt_row FROM sales_private.crm_first_contact_worker_cycles WHERE request_id=current_id;
    -- The14 execution transaction commits the receipt and completion together.
    -- Any contradictory stored pair is unknown/setup trouble, not a failed job.
    IF (request_row.status='completed') IS DISTINCT FROM FOUND THEN RAISE EXCEPTION 'CRM_QUEUE_MONITOR_SETUP_REQUIRED'; END IF;
    IF request_row.status='completed' THEN
      response_value:=receipt_row.response;
      IF response_value->'actor' IS DISTINCT FROM jsonb_build_object('kind','system','name','first_contact_worker_v1')
        OR response_value->>'requestId' IS DISTINCT FROM current_id::text
        OR response_value->'maxItems' IS DISTINCT FROM '10'::jsonb
        OR response_value->'replayed' IS DISTINCT FROM 'false'::jsonb
        OR jsonb_typeof(response_value->'processedCount') IS DISTINCT FROM 'number'
        OR (response_value->>'processedCount') !~ '^(10|[0-9])$'
        OR jsonb_typeof(response_value->'sweepFinished') IS DISTINCT FROM 'boolean'
        OR jsonb_typeof(response_value->'receipts') IS DISTINCT FROM 'array'
        OR jsonb_typeof(response_value->'startedAt') IS DISTINCT FROM 'string'
        OR jsonb_typeof(response_value->'finishedAt') IS DISTINCT FROM 'string' THEN
        RAISE EXCEPTION 'CRM_QUEUE_MONITOR_SETUP_REQUIRED';
      END IF;
      processed_count:=(response_value->>'processedCount')::integer;
      IF jsonb_array_length(response_value->'receipts')<>processed_count OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(response_value->'receipts') children(child)
        WHERE jsonb_typeof(child) IS DISTINCT FROM 'object'
          OR child->'actor' IS DISTINCT FROM jsonb_build_object('kind','system','name','first_contact_worker_v1')
          OR COALESCE(child->>'outcome' IN ('held','scheduled','completed','closed','notified','already_notified','suppressed'),false) IS NOT TRUE
      ) THEN RAISE EXCEPTION 'CRM_QUEUE_MONITOR_SETUP_REQUIRED'; END IF;
      BEGIN
        started_at_value:=sales_private.crm_work_timestamp(response_value->>'startedAt');
        finished_at_value:=sales_private.crm_work_timestamp(response_value->>'finishedAt');
      EXCEPTION WHEN raise_exception OR invalid_text_representation OR datetime_field_overflow THEN
        RAISE EXCEPTION 'CRM_QUEUE_MONITOR_SETUP_REQUIRED';
      END;
      IF NOT isfinite(started_at_value) OR NOT isfinite(finished_at_value)
        OR started_at_value<attempt_row.prepared_at OR finished_at_value<started_at_value
        OR finished_at_value>request_row.completed_at OR receipt_row.created_at IS DISTINCT FROM finished_at_value THEN
        RAISE EXCEPTION 'CRM_QUEUE_MONITOR_SETUP_REQUIRED';
      END IF;
      SELECT count(*) FILTER (WHERE child->>'outcome'='held'),count(*) FILTER (WHERE child->>'outcome'='notified')
        INTO receipt_held_count,notified_count FROM jsonb_array_elements(response_value->'receipts') children(child);
      receipt_value:=jsonb_build_object('startedAt',started_at_value,'finishedAt',finished_at_value,
        'processedCount',processed_count,'sweepFinished',response_value->'sweepFinished',
        'heldCount',receipt_held_count,'notifiedCount',notified_count);
    END IF;
    request_value:=jsonb_build_object('requestId',request_row.request_id,'attemptId',request_row.current_attempt_id,
      'attemptCount',request_row.attempt_count,'status',request_row.status,'policyVersion',request_row.policy_version,
      'createdAt',request_row.created_at,'preparedAt',attempt_row.prepared_at,'nextAttemptAt',request_row.next_attempt_at,
      'completedAt',request_row.completed_at,'lastErrorCode',request_row.last_error_code,'receipt',receipt_value);
  END IF;
  RETURN jsonb_build_object('contractVersion','first_contact_queue_monitor_v1',
    'actor',jsonb_build_object('userId',actor_id,'role','admin'),'asOf',as_of,'readOnly',true,
    'targetSeconds',300,'deliveryLatencySeconds',NULL,'sweepAgeSeconds',NULL,
    'gates',jsonb_build_object('processing',settings_row.sla_processing_enabled,'cycle',settings_row.sla_cycle_enabled,
      'worker',settings_row.sla_worker_enabled,'dispatcher',settings_row.sla_dispatcher_enabled,'burst',settings_row.sla_burst_enabled),
    'candidates',jsonb_build_object('sampleCount',sample_count,'exact',sample_count<901,'scanLimit',901,
      'storedHeldCount',held_count,'withoutStoredReviewCount',unknown_count),
    'cursor',jsonb_build_object('afterCreatedAt',cursor_row.after_created_at,'afterTaskId',cursor_row.after_task_id),
    'currentRequest',request_value);
END;
$snapshot$;
REVOKE ALL ON FUNCTION public.crm_v2_queue_monitor_snapshot() FROM PUBLIC, anon, authenticated,
  buildtrack_sales_sla_worker, buildtrack_sales_sla_dispatcher;
GRANT EXECUTE ON FUNCTION public.crm_v2_queue_monitor_snapshot() TO authenticated;

-- Supabase commonly has this role; isolated fixtures deliberately need not.
-- Remove any direct creation-time default grant instead of trusting its JWTs.
DO $service_acl$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    REVOKE ALL ON FUNCTION public.crm_v2_queue_monitor_capabilities(),public.crm_v2_queue_monitor_snapshot() FROM service_role;
  END IF;
END;
$service_acl$;
-- No table/schema grant, role membership, receipt write, retry/reset endpoint,
-- policy recalculation, Cron catalog access, scheduler or activation claim.
ROLLBACK;
