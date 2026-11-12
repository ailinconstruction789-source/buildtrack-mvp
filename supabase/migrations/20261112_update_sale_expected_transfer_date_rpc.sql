-- Allow Sales and Admin roles to update expected_transfer_date on active sales
-- (including CRM v2 and external-cutover records protected by RLS and triggers).

CREATE OR REPLACE FUNCTION public.update_sale_expected_transfer_date(
  p_sale_id uuid,
  p_expected_transfer_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_sale public.sales%ROWTYPE;
  v_old_sale jsonb;
  v_new_sale jsonb;
  v_updated_id uuid;
  v_updated_date date;
BEGIN
  IF auth.uid() IS NULL OR public.crm_v2_role() NOT IN ('sales', 'admin') THEN
    RAISE EXCEPTION 'CRM_FORECAST_FORBIDDEN';
  END IF;

  IF p_sale_id IS NULL THEN
    RAISE EXCEPTION 'CRM_SALE_NOT_FOUND';
  END IF;

  IF p_expected_transfer_date IS NOT NULL
     AND (p_expected_transfer_date < DATE '0001-01-01' OR p_expected_transfer_date > DATE '9999-12-31') THEN
    RAISE EXCEPTION 'CRM_FORECAST_INVALID_DATE';
  END IF;

  IF to_regprocedure('customer_source_membership_private.sale_member(uuid)') IS NOT NULL
     AND NOT customer_source_membership_private.sale_member(p_sale_id) THEN
    RAISE EXCEPTION 'CRM_SOURCE_RETIRED';
  END IF;

  SELECT * INTO v_sale
  FROM public.sales
  WHERE id = p_sale_id
  FOR UPDATE;

  IF v_sale.id IS NULL THEN
    RAISE EXCEPTION 'CRM_SALE_NOT_FOUND';
  END IF;

  IF v_sale.crm_stage = 'cancelled' OR v_sale.contract_status = 'Cancelled' THEN
    RAISE EXCEPTION 'CRM_BOOKING_CONFLICT';
  END IF;

  IF v_sale.expected_transfer_date IS NOT DISTINCT FROM p_expected_transfer_date THEN
    RETURN jsonb_build_object(
      'id', v_sale.id,
      'expected_transfer_date', v_sale.expected_transfer_date
    );
  END IF;

  v_old_sale := to_jsonb(v_sale);
  v_new_sale := v_old_sale || jsonb_build_object('expected_transfer_date', p_expected_transfer_date);

  IF to_regclass('sales_private.booking_write_permits') IS NOT NULL THEN
    INSERT INTO sales_private.booking_write_permits (transaction_id, backend_pid)
    VALUES (txid_current(), pg_backend_pid())
    ON CONFLICT (transaction_id) DO UPDATE
      SET backend_pid = EXCLUDED.backend_pid;
  END IF;

  IF to_regclass('sales_private.post_booking_external_write_permits') IS NOT NULL THEN
    INSERT INTO sales_private.post_booking_external_write_permits (
      transaction_id,
      backend_pid,
      actor_user_id,
      old_sale,
      new_sale
    )
    VALUES (
      txid_current(),
      pg_backend_pid(),
      auth.uid(),
      v_old_sale,
      v_new_sale
    )
    ON CONFLICT (transaction_id) DO UPDATE
      SET backend_pid = EXCLUDED.backend_pid,
          actor_user_id = EXCLUDED.actor_user_id,
          old_sale = EXCLUDED.old_sale,
          new_sale = EXCLUDED.new_sale;
  END IF;

  UPDATE public.sales
  SET expected_transfer_date = p_expected_transfer_date
  WHERE id = v_sale.id
  RETURNING id, expected_transfer_date
  INTO v_updated_id, v_updated_date;

  IF to_regclass('sales_private.booking_write_permits') IS NOT NULL THEN
    DELETE FROM sales_private.booking_write_permits
    WHERE transaction_id = txid_current() AND backend_pid = pg_backend_pid();
  END IF;

  IF to_regclass('sales_private.post_booking_external_write_permits') IS NOT NULL THEN
    DELETE FROM sales_private.post_booking_external_write_permits
    WHERE transaction_id = txid_current() AND backend_pid = pg_backend_pid();
  END IF;

  RETURN jsonb_build_object(
    'id', v_updated_id,
    'expected_transfer_date', v_updated_date
  );
END;
$$;

REVOKE ALL ON FUNCTION public.update_sale_expected_transfer_date(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_sale_expected_transfer_date(uuid, date) TO authenticated;
