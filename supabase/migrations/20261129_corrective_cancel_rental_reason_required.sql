-- ==============================================================================
-- BUILDTRACK CORRECTIVE MIGRATION (ISSUE 6 / PART D):
-- SERVER-SIDE NON-EMPTY CANCELLATION REASON ENFORCEMENT FOR
-- public.sales_tx_cancel_rental_booking(uuid, jsonb)
-- ==============================================================================
-- Corrective migration layered on top of:
--   - 20261125_rental_purchase_plot_ownership_transactions.sql
--   - 20261126_legacy_plot_release_rpc.sql
--   - 20261127_corrective_legacy_purchase_holder_guard.sql
--   - 20261128_corrective_stock_and_sale_guard_interop.sql
--
-- Guarantees:
-- 1. Rejects missing or whitespace-only cancellation `reason` server-side with
--    `SALES_TX_CANCEL_REASON_REQUIRED` (no silent default / actor fallback).
-- 2. Stores the real trimmed cancellation reason in `public.leads.lost_reason`
--    and records the server-verified actor (`v_actor.actor_label`) separately in
--    `public.leads.lost_reason_detail`, audit notes, and `public.status_history`.
-- 3. Preserves exact lock ordering, Active/Renewed rejection
--    (`SALES_TX_CANNOT_CANCEL_ACTIVE_RENTAL`), optimistic concurrency checks,
--    idempotency replay, and scoped `plot_stock_write_permits`.
-- ==============================================================================

BEGIN;

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS lost_reason text,
  ADD COLUMN IF NOT EXISTS lost_reason_detail text;

CREATE OR REPLACE FUNCTION public.sales_tx_cancel_rental_booking(
  p_request_id uuid,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
  v_actor record;
  v_req sales_private.rental_tx_requests%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_lead_id uuid;
  v_contract_id uuid;
  v_expected_lead_rev uuid;
  v_expected_contract_rev uuid;
  v_expected_lead_updated_at timestamptz;
  v_reason text;
  v_lead public.leads%ROWTYPE;
  v_contract public.rental_contracts%ROWTYPE;
  v_plot public.plots%ROWTYPE;
  v_plot_key text;
  v_project_name text;
  v_new_lead_rev uuid := gen_random_uuid();
  v_new_contract_rev uuid := gen_random_uuid();
  v_plot_released boolean := false;
  v_cancel_note text;
  v_actor_detail text;
  v_response jsonb;
BEGIN
  IF p_request_id IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'SALES_TX_INVALID_INPUT';
  END IF;

  SELECT * INTO v_actor FROM sales_private.require_sales_writer();

  v_lead_id := NULLIF(btrim(COALESCE(p_payload ->> 'leadId', '')), '')::uuid;
  v_contract_id := NULLIF(btrim(COALESCE(p_payload ->> 'contractId', '')), '')::uuid;
  v_expected_lead_rev := NULLIF(btrim(COALESCE(p_payload ->> 'expectedLeadRevision', '')), '')::uuid;
  v_expected_contract_rev := NULLIF(btrim(COALESCE(p_payload ->> 'expectedContractRevision', '')), '')::uuid;
  v_expected_lead_updated_at := NULLIF(btrim(COALESCE(p_payload ->> 'expectedLeadUpdatedAt', '')), '')::timestamptz;
  v_reason := NULLIF(regexp_replace(COALESCE(p_payload ->> 'reason', ''), '^\s+|\s+$', '', 'g'), '');

  IF v_lead_id IS NULL THEN
    RAISE EXCEPTION 'SALES_TX_INVALID_INPUT';
  END IF;

  -- Strictly require a real non-empty cancellation reason (never substitute actor name)
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'SALES_TX_CANCEL_REASON_REQUIRED';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('crm-booking-command', 0));

  SELECT * INTO v_req
  FROM sales_private.rental_tx_requests
  WHERE actor_user_id = v_actor.actor_id AND request_id = p_request_id;
  IF FOUND THEN
    IF v_req.command <> 'rental_cancel_booking' OR v_req.request_payload IS DISTINCT FROM p_payload THEN
      RAISE EXCEPTION 'SALES_TX_IDEMPOTENCY_CONFLICT';
    END IF;
    RETURN v_req.response || jsonb_build_object('replayed', true);
  END IF;

  -- Peek target plot/project to establish canonical lock order: project -> plot -> lead -> contracts -> sales
  SELECT project_name, COALESCE(interested_plot_id, interested_plot_name)
  INTO v_project_name, v_plot_key
  FROM public.leads
  WHERE id = v_lead_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SALES_TX_LEAD_NOT_FOUND';
  END IF;

  IF v_contract_id IS NOT NULL THEN
    SELECT COALESCE(project_name, v_project_name), COALESCE(plot_id, v_plot_key)
    INTO v_project_name, v_plot_key
    FROM public.rental_contracts
    WHERE id = v_contract_id;
  END IF;

  IF v_project_name IS NOT NULL AND btrim(v_project_name) <> '' THEN
    PERFORM 1 FROM public.projects WHERE name = v_project_name FOR SHARE;
  END IF;

  IF v_project_name IS NOT NULL AND v_plot_key IS NOT NULL THEN
    v_plot := sales_private.lock_plot_in_project(v_project_name, v_plot_key);
  END IF;

  SELECT * INTO v_lead FROM public.leads WHERE id = v_lead_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SALES_TX_LEAD_NOT_FOUND';
  END IF;

  -- Lock related contracts and sales deterministically
  PERFORM 1 FROM public.rental_contracts WHERE lead_id = v_lead_id OR (v_plot.id IS NOT NULL AND plot_id = v_plot.id) ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.sales WHERE lead_id = v_lead_id OR (v_plot.id IS NOT NULL AND plot_id = v_plot.id) ORDER BY id FOR UPDATE;

  -- Reject Active / Renewed rentals unconditionally BEFORE generic stale checks so caller always gets clear Active guidance!
  IF v_lead.status = 'Rented'
     OR v_lead.rental_status IN ('Active', 'Renewed')
     OR v_lead.active_rental_contract_id IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.rental_contracts rc WHERE rc.lead_id = v_lead_id AND rc.status IN ('Active', 'Renewed')) THEN
    RAISE EXCEPTION 'SALES_TX_CANNOT_CANCEL_ACTIVE_RENTAL';
  END IF;

  IF v_lead.status = 'Cancelled' OR v_lead.rental_status = 'Cancelled' THEN
    RAISE EXCEPTION 'SALES_TX_ALREADY_CANCELLED';
  END IF;

  -- Optimistic concurrency / revision checks
  IF v_expected_lead_rev IS NOT NULL AND v_lead.deal_revision IS DISTINCT FROM v_expected_lead_rev THEN
    RAISE EXCEPTION 'SALES_TX_STALE_STATE';
  END IF;
  IF v_expected_lead_updated_at IS NOT NULL AND v_lead.updated_at IS DISTINCT FROM v_expected_lead_updated_at THEN
    RAISE EXCEPTION 'SALES_TX_STALE_STATE';
  END IF;

  IF v_contract_id IS NOT NULL THEN
    SELECT * INTO v_contract FROM public.rental_contracts WHERE id = v_contract_id FOR UPDATE;
    IF NOT FOUND OR v_contract.lead_id IS DISTINCT FROM v_lead_id THEN
      RAISE EXCEPTION 'SALES_TX_IDENTITY_MISMATCH';
    END IF;
    IF v_contract.status IN ('Active', 'Renewed') THEN
      RAISE EXCEPTION 'SALES_TX_CANNOT_CANCEL_ACTIVE_RENTAL';
    END IF;
    IF v_expected_contract_rev IS NOT NULL AND v_contract.deal_revision IS DISTINCT FROM v_expected_contract_rev THEN
      RAISE EXCEPTION 'SALES_TX_STALE_STATE';
    END IF;
    IF v_contract.status <> 'PendingContract' THEN
      RAISE EXCEPTION 'SALES_TX_CONFLICT';
    END IF;
  END IF;

  -- Must strictly be PendingContract (never cancel purchase bookings or ConvertedToBuy)
  IF NOT (
    v_lead.rental_status = 'PendingContract'
    OR v_contract.id IS NOT NULL
    OR EXISTS (SELECT 1 FROM public.rental_contracts rc WHERE rc.lead_id = v_lead_id AND rc.status = 'PendingContract')
    OR (v_lead.deal_type IN ('rent', 'rent_to_own') AND v_lead.status IN ('Reserved', 'Booked') AND COALESCE(v_lead.rental_status, '') NOT IN ('ConvertedToBuy', 'MovedOut', 'Cancelled', 'Expired'))
  ) THEN
    RAISE EXCEPTION 'SALES_TX_CONFLICT';
  END IF;

  -- Verify plot ownership safety before writing
  IF v_plot.id IS NOT NULL THEN
    IF lower(btrim(COALESCE(v_plot.sale_status, ''))) = 'transferred' THEN
      RAISE EXCEPTION 'SALES_TX_CONFLICT';
    END IF;
    IF EXISTS (SELECT 1 FROM public.rental_contracts rc WHERE rc.plot_id = v_plot.id AND rc.status IN ('Active', 'Renewed')) THEN
      RAISE EXCEPTION 'SALES_TX_CANNOT_CANCEL_ACTIVE_RENTAL';
    END IF;
    IF EXISTS (SELECT 1 FROM public.rental_contracts rc WHERE rc.plot_id = v_plot.id AND rc.lead_id IS DISTINCT FROM v_lead_id AND rc.status = 'PendingContract')
       OR EXISTS (SELECT 1 FROM public.sales s WHERE s.plot_id = v_plot.id AND s.lead_id IS DISTINCT FROM v_lead_id AND COALESCE(lower(btrim(s.crm_stage)), lower(btrim(s.contract_status)), 'unknown') <> 'cancelled') THEN
      RAISE EXCEPTION 'SALES_TX_PLOT_HELD_BY_OTHER';
    END IF;
  END IF;

  v_actor_detail := 'ผู้ยกเลิก: ' || v_actor.actor_label || ' | วันที่: ' || to_char(v_now AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD HH24:MI');
  v_cancel_note := '[ยกเลิกการจองเช่า | ผู้ทำรายการ: ' || v_actor.actor_label || '] เหตุผล: ' || v_reason;

  -- 1. Cancel ONLY PendingContract rows belonging to this lead
  UPDATE public.rental_contracts
  SET status = 'Cancelled',
      notes = concat_ws(E'\n', v_cancel_note, NULLIF(notes, '')),
      deal_revision = v_new_contract_rev,
      updated_at = v_now
  WHERE lead_id = v_lead_id
    AND status = 'PendingContract'
    AND (v_contract_id IS NULL OR id = v_contract_id);

  -- 2. Cancel lead (reason stored cleanly in lost_reason; actor recorded separately in lost_reason_detail)
  UPDATE public.leads
  SET status = 'Cancelled',
      crm_status = 'Cancelled — ยกเลิกการจองเช่า',
      rental_status = 'Cancelled',
      lost_reason = v_reason,
      lost_reason_detail = v_actor_detail,
      notes = concat_ws(E'\n\n---\n', v_cancel_note, NULLIF(notes, '')),
      deal_revision = v_new_lead_rev,
      updated_at = v_now
  WHERE id = v_lead_id;

  -- 3. Release plot stock + rental fields ONLY if no other holder remains on the plot
  IF v_plot.id IS NOT NULL AND NOT sales_private.plot_has_active_holder(v_plot.id) THEN
    INSERT INTO sales_private.plot_stock_write_permits (
      transaction_id, backend_pid, actor_user_id, plot_id, command, expected_has_customer, expected_sale_status
    ) VALUES (
      txid_current(), pg_backend_pid(), v_actor.actor_id, v_plot.id, 'rental_cancel_booking', false, 'ready_for_sale'
    );

    UPDATE public.plots
    SET has_customer = false,
        sale_status = 'ready_for_sale',
        current_tenant_name = NULL,
        current_tenant_phone = NULL,
        rental_program = NULL,
        monthly_rent = NULL,
        security_deposit = NULL,
        lease_start_date = NULL,
        lease_end_date = NULL,
        highlight_note = CASE
          WHEN highlight_note IS NOT NULL AND btrim(highlight_note) ~ '^(เช่า:|จองเช่า:)' THEN NULL
          ELSE highlight_note
        END
    WHERE id = v_plot.id;

    DELETE FROM sales_private.plot_stock_write_permits
    WHERE transaction_id = txid_current() AND backend_pid = pg_backend_pid() AND plot_id = v_plot.id;

    v_plot_released := true;
  END IF;

  INSERT INTO public.status_history (entity_type, entity_id, old_status, new_status, changed_by, created_at)
  VALUES (
    'lead', v_lead_id, COALESCE(v_lead.status, 'Reserved'), 'Cancelled',
    'ยกเลิกการจองเช่า | ผู้ทำรายการ: ' || v_actor.actor_label || ' | เหตุผล: ' || v_reason,
    v_now
  );

  v_response := jsonb_build_object(
    'requestId', p_request_id,
    'command', 'rental_cancel_booking',
    'leadId', v_lead_id,
    'contractId', v_contract.id,
    'plotId', v_plot.id,
    'plotReleased', v_plot_released,
    'rentalStatus', 'Cancelled',
    'reason', v_reason,
    'actorLabel', v_actor.actor_label,
    'leadRevision', v_new_lead_rev,
    'replayed', false
  );

  INSERT INTO sales_private.rental_tx_requests (actor_user_id, request_id, command, request_payload, response, created_at)
  VALUES (v_actor.actor_id, p_request_id, 'rental_cancel_booking', p_payload, v_response, v_now);

  RETURN v_response;
END;
$fn$;
REVOKE ALL ON FUNCTION public.sales_tx_cancel_rental_booking(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sales_tx_cancel_rental_booking(uuid, jsonb) TO authenticated;

COMMIT;
