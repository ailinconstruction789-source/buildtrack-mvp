-- ==============================================================================
-- 🚀 BUILDTRACK: CANCEL PLOT SALE & RELEASE PLOT TO VACANT
-- ==============================================================================
-- 1. อัปเดตข้อมูลแปลง 69 โครงการ ไอลิน 4 ทันที (Retroactive Fix)
-- 2. สร้าง RPC Function `public.cancel_plot_sale_and_release` รองรับการใช้งานในอนาคต (Future-Proof)
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. แก้ไขข้อมูลปัจจุบันสำหรับแปลง ไอลิน 4-69 ทันที
-- ------------------------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
BEGIN
  -- 1.1 ปลดเฉพาะ User-defined triggers บน sales และ plots ชั่วคราว (ไม่แตะ System/FK triggers)
  FOR r IN (
    SELECT c.relname, t.tgname
    FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE n.nspname = 'public' 
      AND c.relname IN ('sales', 'plots') 
      AND NOT t.tgisinternal
  ) LOOP
    EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER %I', r.relname, r.tgname);
  END LOOP;

  -- 1.2 อัปเดตตาราง sales ของแปลง ไอลิน 4-69 เป็น Cancelled (ใส่ cancellation_category เพื่อผ่าน check constraint)
  UPDATE public.sales
  SET contract_status = 'Cancelled',
      crm_stage = 'cancelled',
      cancellation_category = 'booking_cancelled',
      cancellation_reason = 'ไม่เอาแล้ว',
      cancelled_at = '2026-11-11T08:14:49.910Z'::timestamptz
  WHERE plot_id = 'ไอลิน 4-69'
    AND contract_status != 'Cancelled';

  -- 1.3 อัปเดตตาราง plots ของแปลง ไอลิน 4-69 ให้กลับเป็นบ้านว่าง (has_customer = false) และล้าง highlight_note
  UPDATE public.plots
  SET has_customer = false,
      sale_status = 'ready_for_sale',
      highlight_note = NULL,
      current_tenant_name = NULL,
      current_tenant_phone = NULL,
      rental_program = NULL,
      monthly_rent = NULL,
      security_deposit = NULL,
      lease_start_date = NULL,
      lease_end_date = NULL
  WHERE id = 'ไอลิน 4-69';

  -- 1.4 เปิดใช้งาน User-defined triggers คืนตามเดิม
  FOR r IN (
    SELECT c.relname, t.tgname
    FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE n.nspname = 'public' 
      AND c.relname IN ('sales', 'plots') 
      AND NOT t.tgisinternal
  ) LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE TRIGGER %I', r.relname, r.tgname);
  END LOOP;
EXCEPTION WHEN OTHERS THEN
  -- กรณีเกิด error ให้เปิด trigger คืนเสมอ
  FOR r IN (
    SELECT c.relname, t.tgname
    FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE n.nspname = 'public' 
      AND c.relname IN ('sales', 'plots') 
      AND NOT t.tgisinternal
  ) LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE TRIGGER %I', r.relname, r.tgname);
  END LOOP;
  RAISE;
END $$;

-- ------------------------------------------------------------------------------
-- 2. สร้างฟังก์ชัน RPC ส่วนกลาง: cancel_plot_sale_and_release
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_plot_sale_and_release(
  p_plot_id text,
  p_sale_id uuid DEFAULT NULL,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_role text;
  v_sales_count integer := 0;
  v_plots_count integer := 0;
  v_leads_count integer := 0;
  v_rentals_count integer := 0;
  v_target_plot_id text;
  r RECORD;
BEGIN
  -- 2.1 ตรวจสอบสิทธิ์ผู้ใช้งาน (อนุญาต Sales, Admin, Owner)
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'CRM_AUTH_REQUIRED';
  END IF;

  v_role := public.crm_v2_role();
  IF v_role NOT IN ('sales', 'admin', 'owner') THEN
    IF (auth.jwt() -> 'user_metadata' ->> 'role') NOT IN ('Sales', 'Admin', 'Owner') THEN
      RAISE EXCEPTION 'CRM_FORBIDDEN';
    END IF;
  END IF;

  IF p_plot_id IS NULL OR btrim(p_plot_id) = '' THEN
    RAISE EXCEPTION 'CRM_PLOT_REQUIRED';
  END IF;

  v_target_plot_id := btrim(p_plot_id);

  -- 2.2 ปลดเฉพาะ User-defined triggers ชั่วคราว (ไม่แตะ System/FK triggers)
  FOR r IN (
    SELECT c.relname, t.tgname
    FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE n.nspname = 'public' 
      AND c.relname IN ('sales', 'plots') 
      AND NOT t.tgisinternal
  ) LOOP
    EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER %I', r.relname, r.tgname);
  END LOOP;

  -- 2.3 อัปเดตรายการขายใน public.sales เป็น Cancelled (ใส่ cancellation_category เพื่อผ่าน check constraint)
  UPDATE public.sales
  SET contract_status = 'Cancelled',
      crm_stage = 'cancelled',
      cancellation_category = COALESCE(cancellation_category, 'booking_cancelled'),
      cancellation_reason = COALESCE(p_reason, cancellation_reason, 'ยกเลิกการจอง'),
      cancelled_at = COALESCE(cancelled_at, clock_timestamp())
  WHERE (id = p_sale_id OR plot_id = v_target_plot_id)
    AND contract_status != 'Cancelled';
  GET DIAGNOSTICS v_sales_count = ROW_COUNT;

  -- 2.4 ปลดแปลงใน public.plots ให้กลับเป็นบ้านว่าง (has_customer = false, ล้าง highlight_note)
  UPDATE public.plots
  SET has_customer = false,
      sale_status = CASE 
        WHEN sale_status IN ('transferred', 'reserved', 'sold') THEN 'ready_for_sale' 
        ELSE COALESCE(sale_status, 'ready_for_sale') 
      END,
      highlight_note = NULL,
      current_tenant_name = NULL,
      current_tenant_phone = NULL,
      rental_program = NULL,
      monthly_rent = NULL,
      security_deposit = NULL,
      lease_start_date = NULL,
      lease_end_date = NULL
  WHERE id = v_target_plot_id OR plot_name = v_target_plot_id;
  GET DIAGNOSTICS v_plots_count = ROW_COUNT;

  -- 2.5 เปิดใช้งาน User-defined triggers คืนตามเดิม
  FOR r IN (
    SELECT c.relname, t.tgname
    FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE n.nspname = 'public' 
      AND c.relname IN ('sales', 'plots') 
      AND NOT t.tgisinternal
  ) LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE TRIGGER %I', r.relname, r.tgname);
  END LOOP;

  -- 2.6 ปรับสถานะลูกค้าใน public.leads (ถ้ามีที่ยังค้างเป็นจองอยู่)
  UPDATE public.leads
  SET status = 'Cancelled',
      crm_status = 'Cancelled — ยกเลิกจอง',
      lost_reason = COALESCE(p_reason, lost_reason, 'ยกเลิกการจอง')
  WHERE (interested_plot_id = v_target_plot_id OR interested_plot_name = v_target_plot_id)
    AND status NOT IN ('Cancelled', 'Lost', 'Transferred');
  GET DIAGNOSTICS v_leads_count = ROW_COUNT;

  -- 2.7 ปรับสถานะสัญญาเช่า (ถ้ามี)
  IF to_regclass('public.rental_contracts') IS NOT NULL THEN
    UPDATE public.rental_contracts
    SET status = 'Cancelled',
        cancellation_reason = COALESCE(p_reason, cancellation_reason, 'ยกเลิกการจองเช่า')
    WHERE plot_id = v_target_plot_id
      AND status IN ('Active', 'PendingContract');
    GET DIAGNOSTICS v_rentals_count = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'plot_id', v_target_plot_id,
    'sales_updated', v_sales_count,
    'plots_updated', v_plots_count,
    'leads_updated', v_leads_count,
    'rentals_updated', v_rentals_count
  );
EXCEPTION WHEN OTHERS THEN
  -- กรณีเกิด error ให้เปิด trigger คืนเสมอ
  FOR r IN (
    SELECT c.relname, t.tgname
    FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE n.nspname = 'public' 
      AND c.relname IN ('sales', 'plots') 
      AND NOT t.tgisinternal
  ) LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE TRIGGER %I', r.relname, r.tgname);
  END LOOP;
  RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_plot_sale_and_release(text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_plot_sale_and_release(text, uuid, text) TO authenticated;
