-- ==============================================================================
-- BUILDTRACK PHASE 3: GUARD-APPROVED LEGACY PLOT RELEASE RPC
-- ==============================================================================
-- Review-ready companion migration (depends on 20261125_rental_purchase_plot_ownership_transactions.sql).
-- Do NOT apply to production without review and dry-run reconciliation first.
--
-- Design guarantees:
-- 1. Zero DISABLE TRIGGER, zero RLS bypass, zero blanket reset.
-- 2. Admin-only (via sales_private.require_sales_writer() + actor_role = 'admin').
-- 3. Operates on ONE explicitly identified plot in a specific project, verified
--    against expectedHasCustomer + expectedSaleStatus (optimistic concurrency).
-- 4. Refuses to release any plot with an active purchase buyer, PendingContract
--    rental booking, Active/Renewed/unknown rental contract, or pending/active
--    rental lead (sales_private.plot_has_active_holder).
-- 5. Refuses transferred/sold/handover plots.
-- 6. Writes plots stock columns strictly via transaction-local permit
--    (sales_private.plot_stock_write_permits) verified by guard_plot_stock_integrity().
-- ==============================================================================

BEGIN;

-- Extend permit & idempotency command allow-lists additively for legacy_plot_release
ALTER TABLE sales_private.plot_stock_write_permits
  DROP CONSTRAINT IF EXISTS plot_stock_write_permits_command_check;

ALTER TABLE sales_private.plot_stock_write_permits
  ADD CONSTRAINT plot_stock_write_permits_command_check CHECK (command IN (
    'rental_book',
    'rental_sign_contract',
    'rental_cancel_booking',
    'rental_move_out',
    'rental_convert_to_buy',
    'purchase_book',
    'purchase_ensure_sale',
    'legacy_plot_release'
  ));

ALTER TABLE sales_private.rental_tx_requests
  DROP CONSTRAINT IF EXISTS rental_tx_requests_command_check;

ALTER TABLE sales_private.rental_tx_requests
  ADD CONSTRAINT rental_tx_requests_command_check CHECK (command IN (
    'rental_book',
    'rental_sign_contract',
    'rental_cancel_booking',
    'rental_move_out',
    'rental_convert_to_buy',
    'purchase_book',
    'legacy_plot_release'
  ));

CREATE OR REPLACE FUNCTION public.sales_tx_release_legacy_plot(
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
  v_project_name text;
  v_plot_key text;
  v_expected_has_customer boolean;
  v_expected_sale_status text;
  v_reason text;
  v_lead_id uuid;
  v_plot public.plots%ROWTYPE;
  v_current_status text;
  v_target_status text := 'ready_for_sale';
  v_has_legacy_data boolean := false;
  v_plot_released boolean := false;
  v_response jsonb;
BEGIN
  IF p_request_id IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'SALES_TX_INVALID_INPUT';
  END IF;

  SELECT * INTO v_actor FROM sales_private.require_sales_writer();
  IF v_actor.actor_role <> 'admin' THEN
    RAISE EXCEPTION 'SALES_TX_FORBIDDEN';
  END IF;

  v_project_name := NULLIF(btrim(COALESCE(p_payload ->> 'projectName', '')), '');
  v_plot_key := NULLIF(btrim(COALESCE(p_payload ->> 'plotId', '')), '');
  v_reason := NULLIF(btrim(COALESCE(p_payload ->> 'reason', '')), '');
  v_lead_id := NULLIF(btrim(COALESCE(p_payload ->> 'leadId', '')), '')::uuid;

  IF NOT (p_payload ? 'expectedHasCustomer')
     OR jsonb_typeof(p_payload -> 'expectedHasCustomer') <> 'boolean' THEN
    RAISE EXCEPTION 'SALES_TX_INVALID_INPUT';
  END IF;
  v_expected_has_customer := (p_payload ->> 'expectedHasCustomer')::boolean;
  v_expected_sale_status := lower(btrim(COALESCE(p_payload ->> 'expectedSaleStatus', '')));

  IF v_project_name IS NULL OR v_plot_key IS NULL OR v_reason IS NULL THEN
    RAISE EXCEPTION 'SALES_TX_INVALID_INPUT';
  END IF;

  -- Canonical shared lock order
  PERFORM pg_advisory_xact_lock(hashtextextended('crm-booking-command', 0));

  SELECT * INTO v_req
  FROM sales_private.rental_tx_requests
  WHERE actor_user_id = v_actor.actor_id AND request_id = p_request_id;
  IF FOUND THEN
    IF v_req.command <> 'legacy_plot_release' OR v_req.request_payload IS DISTINCT FROM p_payload THEN
      RAISE EXCEPTION 'SALES_TX_IDEMPOTENCY_CONFLICT';
    END IF;
    RETURN v_req.response || jsonb_build_object('replayed', true);
  END IF;

  PERFORM 1 FROM public.projects WHERE name = v_project_name FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SALES_TX_PROJECT_UNAVAILABLE';
  END IF;

  v_plot := sales_private.lock_plot_in_project(v_project_name, v_plot_key);

  -- Lock all related ownership tables for this plot deterministically
  PERFORM 1 FROM public.leads WHERE interested_plot_id = v_plot.id ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.rental_contracts WHERE plot_id = v_plot.id ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.sales WHERE plot_id = v_plot.id ORDER BY id FOR UPDATE;

  v_current_status := lower(btrim(COALESCE(v_plot.sale_status, '')));

  -- Never release transferred / sold / handed-over plots
  IF v_current_status IN ('transferred', 'sold', 'handover') THEN
    RAISE EXCEPTION 'SALES_TX_CONFLICT';
  END IF;

  -- Optimistic concurrency check against audited dry-run expectations
  IF COALESCE(v_plot.has_customer, false) IS DISTINCT FROM v_expected_has_customer
     OR v_current_status IS DISTINCT FROM v_expected_sale_status THEN
    RAISE EXCEPTION 'SALES_TX_STALE_STATE';
  END IF;

  -- Absolute ownership guard: NEVER release a plot with any active purchase or rental holder
  IF sales_private.plot_has_active_holder(v_plot.id) THEN
    RAISE EXCEPTION 'SALES_TX_PLOT_HELD_BY_OTHER';
  END IF;

  v_has_legacy_data := (
    COALESCE(v_plot.has_customer, false) IS TRUE
    OR v_current_status NOT IN ('', 'active', 'normal', 'ready_for_sale', 'available', 'vacant')
    OR NULLIF(btrim(COALESCE(v_plot.current_tenant_name, '')), '') IS NOT NULL
    OR NULLIF(btrim(COALESCE(v_plot.current_tenant_phone, '')), '') IS NOT NULL
    OR NULLIF(btrim(COALESCE(v_plot.rental_program, '')), '') IS NOT NULL
    OR v_plot.monthly_rent IS NOT NULL
    OR v_plot.security_deposit IS NOT NULL
    OR v_plot.lease_start_date IS NOT NULL
    OR v_plot.lease_end_date IS NOT NULL
    OR btrim(COALESCE(v_plot.highlight_note, '')) LIKE 'จองเช่า:%'
    OR btrim(COALESCE(v_plot.highlight_note, '')) LIKE 'เช่า:%'
  );

  IF v_has_legacy_data THEN
    INSERT INTO sales_private.plot_stock_write_permits (
      transaction_id, backend_pid, actor_user_id, plot_id, command, expected_has_customer, expected_sale_status
    ) VALUES (
      txid_current(), pg_backend_pid(), v_actor.actor_id, v_plot.id, 'legacy_plot_release', false, v_target_status
    );

    UPDATE public.plots
    SET has_customer = false,
        sale_status = v_target_status,
        current_tenant_name = NULL,
        current_tenant_phone = NULL,
        rental_program = NULL,
        monthly_rent = NULL,
        security_deposit = NULL,
        lease_start_date = NULL,
        lease_end_date = NULL,
        highlight_note = NULL
    WHERE id = v_plot.id;

    DELETE FROM sales_private.plot_stock_write_permits
    WHERE transaction_id = txid_current() AND backend_pid = pg_backend_pid() AND plot_id = v_plot.id;

    v_plot_released := true;
  END IF;

  IF v_lead_id IS NOT NULL THEN
    INSERT INTO public.status_history (entity_type, entity_id, old_status, new_status, changed_by, created_at)
    VALUES (
      'lead',
      v_lead_id,
      COALESCE(v_plot.sale_status, 'legacy'),
      v_target_status,
      'คืนแปลง Legacy (' || v_actor.actor_label || ') แปลง ' || COALESCE(v_plot.plot_name, v_plot.id) || ': ' || v_reason,
      v_now
    );
  END IF;

  v_response := jsonb_build_object(
    'requestId', p_request_id,
    'command', 'legacy_plot_release',
    'plotId', v_plot.id,
    'projectName', v_project_name,
    'previousSaleStatus', v_plot.sale_status,
    'previousHasCustomer', COALESCE(v_plot.has_customer, false),
    'plotReleased', v_plot_released,
    'alreadyVacant', NOT v_has_legacy_data,
    'replayed', false
  );

  INSERT INTO sales_private.rental_tx_requests (actor_user_id, request_id, command, request_payload, response, created_at)
  VALUES (v_actor.actor_id, p_request_id, 'legacy_plot_release', p_payload, v_response, v_now);

  RETURN v_response;
END;
$fn$;

REVOKE ALL ON FUNCTION public.sales_tx_release_legacy_plot(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sales_tx_release_legacy_plot(uuid, jsonb) TO authenticated;

COMMIT;
