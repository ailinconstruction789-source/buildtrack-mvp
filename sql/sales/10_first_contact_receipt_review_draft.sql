-- SALES V2 FIRST-CONTACT RECEIPT REVIEW -- DESIGN ONLY, 2026-09-17.
-- NEVER RUN ON SUPABASE. Depends on UNAPPLIED base and companions 04--09.
-- NOT a deployment migration. Source checks are not PostgreSQL/RLS validation.
-- Read one historical OWN Admin receipt without retrying a processing command.
-- No new ledger, flags, receipt/audit writes, locks, clock calculation or delivery.
BEGIN;
DO $draft_only$
BEGIN
  RAISE EXCEPTION 'DESIGN ONLY: receipt review is not authorized for database execution';
END;
$draft_only$;

CREATE FUNCTION public.crm_v2_sla_receipt_capabilities()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $capabilities$
  WITH readiness AS (
    SELECT public.crm_v2_role()='admin' AND COALESCE((SELECT central_intake_enabled AND lead_work_enabled
      AND lead_lifecycle_enabled AND work_schedule_enabled AND notifications_enabled AND sla_preview_enabled
      FROM public.crm_settings WHERE id),false) AS enabled,
      COALESCE((SELECT sla_processing_enabled FROM public.crm_settings WHERE id),false) AS processing
  )
  SELECT jsonb_build_object('contract_version','first_contact_receipt_review_v1','enabled',enabled,
    'processing_enabled',enabled AND processing) FROM readiness;
$capabilities$;
REVOKE ALL ON FUNCTION public.crm_v2_sla_receipt_capabilities() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_v2_sla_receipt_capabilities() TO authenticated;

-- STABLE uses one read snapshot. There is intentionally no current-task lookup:
-- the receipt is a historical result, not a statement about current task/notice
-- state. Turning processing OFF must not remove this safe recovery lookup.
-- found=false is not proof that a command never committed: it can be in flight,
-- unavailable to this actor, absent, or associated with a different task ID.
CREATE FUNCTION public.crm_v2_first_contact_receipt(p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog SET timezone = 'UTC'
AS $receipt$
DECLARE
  actor_id uuid:=auth.uid(); actor_role text:=public.crm_v2_role();
  request_id_value uuid; task_id_value uuid; receipt_response jsonb; found_receipt boolean;
  projected_receipt jsonb:=NULL;
  uuid_pattern text:='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
BEGIN
  IF actor_id IS NULL OR actor_role IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'CRM_SLA_RECEIPT_FORBIDDEN'; END IF;
  IF NOT COALESCE((SELECT central_intake_enabled AND lead_work_enabled AND lead_lifecycle_enabled
    AND work_schedule_enabled AND notifications_enabled AND sla_preview_enabled
    FROM public.crm_settings WHERE id),false) THEN RAISE EXCEPTION 'CRM_SLA_RECEIPT_SETUP_REQUIRED'; END IF;
  IF jsonb_typeof(p_request) IS DISTINCT FROM 'object' OR octet_length(p_request::text)>1024 THEN
    RAISE EXCEPTION 'CRM_SLA_RECEIPT_INVALID_INPUT';
  END IF;
  IF NOT (p_request ?& ARRAY['requestId','taskId'])
    OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_request) k WHERE k NOT IN ('requestId','taskId'))
    OR jsonb_typeof(p_request->'requestId') IS DISTINCT FROM 'string' OR jsonb_typeof(p_request->'taskId') IS DISTINCT FROM 'string'
    OR length(p_request->>'requestId')<>36 OR (p_request->>'requestId') !~ uuid_pattern
    OR length(p_request->>'taskId')<>36 OR (p_request->>'taskId') !~ uuid_pattern THEN
    RAISE EXCEPTION 'CRM_SLA_RECEIPT_INVALID_INPUT';
  END IF;
  request_id_value:=(p_request->>'requestId')::uuid; task_id_value:=(p_request->>'taskId')::uuid;
  SELECT r.response INTO receipt_response FROM sales_private.crm_first_contact_processing_requests r
    WHERE r.actor_user_id=actor_id AND r.request_id=request_id_value AND r.task_id=task_id_value;
  found_receipt:=FOUND;
  IF found_receipt THEN
    -- Project only the public 09 receipt contract. Do not forward future private
    -- fields, request_payload, raw actor objects, notes or any evaluation source.
    -- Keep historical values EXACTLY, including processedAt and replayed: this
    -- lookup is NOT a command replay and does not claim that a notice is current.
    projected_receipt:=jsonb_build_object(
      'actor',jsonb_build_object('userId',receipt_response#>'{actor,userId}','role',receipt_response#>'{actor,role}'),
      'requestId',receipt_response->'requestId','taskId',receipt_response->'taskId',
      'processedAt',receipt_response->'processedAt','replayed',receipt_response->'replayed',
      'outcome',receipt_response->'outcome','reason',receipt_response->'reason',
      'serviceDueAt',receipt_response->'serviceDueAt','staffDueAt',receipt_response->'staffDueAt',
      'notificationId',receipt_response->'notificationId','notificationType',receipt_response->'notificationType',
      'completedByActivityId',receipt_response->'completedByActivityId','completedAt',receipt_response->'completedAt',
      'withdrawnCount',receipt_response->'withdrawnCount');
  END IF;
  RETURN jsonb_build_object('actor',jsonb_build_object('userId',actor_id,'role','admin'),
    'requestId',request_id_value,'taskId',task_id_value,'found',found_receipt,'receipt',projected_receipt);
END;
$receipt$;
REVOKE ALL ON FUNCTION public.crm_v2_first_contact_receipt(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_v2_first_contact_receipt(jsonb) TO authenticated;

ROLLBACK;
