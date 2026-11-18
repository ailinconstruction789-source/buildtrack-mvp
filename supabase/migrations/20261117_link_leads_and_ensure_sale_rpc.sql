-- ==============================================================================
-- 🚀 BUILDTRACK: LINK ORPHANED LEADS & AUTO-ENSURE SALES RECORD RPC
-- ==============================================================================
-- 1. เชื่อมต่อรายการขายให้กับ 2 เคสปัจจุบันทันที:
--    - คุณสุรีย์นิภา ศรีรัตน์ (ไอลิน6 แปลง 15)
--    - คุณนันท์ลภัส เจริญรุ่งวาณิชย์ (ไอลิน 4 แปลง 29)
-- 2. สร้าง RPC Function `public.ensure_lead_sale_record` รองรับการ Auto-Create ในอนาคต
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. แก้ไขข้อมูลสำหรับ 2 เคสปัจจุบันทันที (Retroactive Fix)
-- ------------------------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
  v_sale_15_id uuid := gen_random_uuid();
  v_sale_29_id uuid := gen_random_uuid();
BEGIN
  -- 1.1 ปลด User-defined triggers บน sales และ plots ชั่วคราว
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

  -- 1.2 สร้าง/เชื่อมรายการขายสำหรับ คุณสุรีย์นิภา ศรีรัตน์ (ไอลิน6 แปลง 15)
  IF NOT EXISTS (
    SELECT 1 FROM public.sales 
    WHERE lead_id = '2b282464-eb8e-4547-a13c-03471cd7bf14'::uuid
      AND contract_status != 'Cancelled'
  ) THEN
    INSERT INTO public.sales (
      id,
      lead_id,
      plot_id,
      sale_price,
      bank_name,
      payment_method,
      contract_status,
      crm_stage,
      booking_route,
      booking_route_reason,
      booked_at
    ) VALUES (
      v_sale_15_id,
      '2b282464-eb8e-4547-a13c-03471cd7bf14'::uuid,
      '15',
      2899000,
      'ธอส.',
      'mortgage',
      'Contracted',
      'transfer_pending',
      'without_visit',
      'Auto-linked from Lead workflow',
      '2026-10-04T05:00:00+00:00'::timestamptz
    );

    UPDATE public.plots
    SET has_customer = true,
        highlight_note = 'ลูกค้า: นางสาวสุรีย์นิภา ศรีรัตน์ (รอโอน)'
    WHERE id = '15';
  END IF;

  -- 1.3 สร้าง/เชื่อมรายการขายสำหรับ คุณนันท์ลภัส เจริญรุ่งวาณิชย์ (ไอลิน 4 แปลง 29)
  IF NOT EXISTS (
    SELECT 1 FROM public.sales 
    WHERE lead_id = 'ce5d44e0-a8f8-43b2-a881-89f66514a8f9'::uuid
      AND contract_status != 'Cancelled'
  ) THEN
    INSERT INTO public.sales (
      id,
      lead_id,
      plot_id,
      sale_price,
      bank_name,
      payment_method,
      contract_status,
      crm_stage,
      booking_route,
      booking_route_reason,
      booked_at
    ) VALUES (
      v_sale_29_id,
      'ce5d44e0-a8f8-43b2-a881-89f66514a8f9'::uuid,
      'ไอลิน 4-29',
      4268000,
      'ออมสิน',
      'mortgage',
      'Contracted',
      'transfer_pending',
      'without_visit',
      'Auto-linked from Lead workflow',
      '2026-09-29T05:00:00+00:00'::timestamptz
    );

    UPDATE public.plots
    SET has_customer = true,
        highlight_note = 'ลูกค้า: นันท์ลภัส เจริญรุ่งวาณิชย์ (รอโอน)'
    WHERE id = 'ไอลิน 4-29';
  END IF;

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
-- 2. สร้าง RPC Function ส่วนกลาง: ensure_lead_sale_record (Future-Proof)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_lead_sale_record(
  p_lead_id uuid,
  p_plot_id text,
  p_sale_price numeric DEFAULT NULL,
  p_land_office_price numeric DEFAULT NULL,
  p_bank_name text DEFAULT NULL,
  p_payment_method text DEFAULT 'mortgage',
  p_stage text DEFAULT 'booked',
  p_event_date timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_role text;
  v_sale_id uuid;
  v_target_plot_id text;
  v_target_contract_status text;
  r RECORD;
BEGIN
  -- 2.1 ตรวจสอบสิทธิ์ผู้ใช้งาน
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'CRM_AUTH_REQUIRED';
  END IF;

  v_role := public.crm_v2_role();
  IF v_role NOT IN ('sales', 'admin', 'owner') THEN
    IF (auth.jwt() -> 'user_metadata' ->> 'role') NOT IN ('Sales', 'Admin', 'Owner') THEN
      RAISE EXCEPTION 'CRM_FORBIDDEN';
    END IF;
  END IF;

  IF p_lead_id IS NULL THEN
    RAISE EXCEPTION 'CRM_LEAD_REQUIRED';
  END IF;

  -- 2.2 หาแปลงที่ดินเป้าหมาย
  IF p_plot_id IS NOT NULL AND btrim(p_plot_id) <> '' THEN
    v_target_plot_id := btrim(p_plot_id);
  ELSE
    SELECT COALESCE(interested_plot_id, interested_plot_name) INTO v_target_plot_id
    FROM public.leads
    WHERE id = p_lead_id;
  END IF;

  IF v_target_plot_id IS NULL OR btrim(v_target_plot_id) = '' THEN
    RAISE EXCEPTION 'CRM_PLOT_REQUIRED';
  END IF;

  -- คำนวณ contract_status
  v_target_contract_status := CASE 
    WHEN p_stage IN ('transferred', 'handover') THEN 'Transferred'
    WHEN p_stage = 'booked' THEN 'Reserved'
    WHEN p_stage = 'cancelled' THEN 'Cancelled'
    ELSE 'Contracted'
  END;

  -- 2.3 ปลด User-defined triggers ชั่วคราว
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

  -- 2.4 ตรวจสอบว่ามีรายการขายอยู่แล้วหรือไม่
  SELECT id INTO v_sale_id
  FROM public.sales
  WHERE lead_id = p_lead_id AND contract_status != 'Cancelled'
  LIMIT 1;

  IF v_sale_id IS NOT NULL THEN
    -- อัปเดตรายการเดิมให้มีข้อมูลครบถ้วน
    UPDATE public.sales
    SET plot_id = COALESCE(v_target_plot_id, plot_id),
        sale_price = COALESCE(p_sale_price, sale_price),
        land_office_price = COALESCE(p_land_office_price, land_office_price),
        bank_name = COALESCE(p_bank_name, bank_name),
        payment_method = COALESCE(p_payment_method, payment_method, 'mortgage'),
        contract_status = v_target_contract_status,
        crm_stage = COALESCE(p_stage, crm_stage),
        transferred_at = CASE WHEN p_stage = 'transferred' THEN COALESCE(p_event_date, transferred_at, clock_timestamp()) ELSE transferred_at END,
        contracted_at = CASE WHEN p_stage = 'contracted' THEN COALESCE(p_event_date, contracted_at, clock_timestamp()) ELSE contracted_at END,
        crm_handover_at = CASE WHEN p_stage = 'handover' THEN COALESCE(p_event_date, crm_handover_at, clock_timestamp()) ELSE crm_handover_at END
    WHERE id = v_sale_id;
  ELSE
    -- สร้างรายการขายใหม่และเชื่อมต่อทันที
    v_sale_id := gen_random_uuid();
    INSERT INTO public.sales (
      id,
      lead_id,
      plot_id,
      sale_price,
      land_office_price,
      bank_name,
      payment_method,
      contract_status,
      crm_stage,
      booking_route,
      booking_route_reason,
      booked_at,
      transferred_at,
      contracted_at,
      crm_handover_at
    ) VALUES (
      v_sale_id,
      p_lead_id,
      v_target_plot_id,
      p_sale_price,
      p_land_office_price,
      p_bank_name,
      COALESCE(p_payment_method, 'mortgage'),
      v_target_contract_status,
      COALESCE(p_stage, 'booked'),
      'without_visit',
      'Auto-created from Lead deal workflow',
      clock_timestamp(),
      CASE WHEN p_stage = 'transferred' THEN COALESCE(p_event_date, clock_timestamp()) ELSE NULL END,
      CASE WHEN p_stage = 'contracted' THEN COALESCE(p_event_date, clock_timestamp()) ELSE NULL END,
      CASE WHEN p_stage = 'handover' THEN COALESCE(p_event_date, clock_timestamp()) ELSE NULL END
    );
  END IF;

  -- 2.5 อัปเดตสถานะแปลงที่ดิน
  UPDATE public.plots
  SET has_customer = true,
      sale_status = CASE 
        WHEN p_stage IN ('transferred', 'handover') THEN 'transferred'
        ELSE COALESCE(sale_status, 'ready_for_sale')
      END
  WHERE id = v_target_plot_id;

  IF NOT FOUND THEN
    UPDATE public.plots
    SET has_customer = true,
        sale_status = CASE 
          WHEN p_stage IN ('transferred', 'handover') THEN 'transferred'
          ELSE COALESCE(sale_status, 'ready_for_sale')
        END
    WHERE plot_name = v_target_plot_id
      AND project_name IN (SELECT project_name FROM public.leads WHERE id = p_lead_id);
  END IF;

  -- 2.6 เปิดใช้งาน User-defined triggers คืนตามเดิม
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

  RETURN jsonb_build_object(
    'success', true,
    'sale_id', v_sale_id,
    'plot_id', v_target_plot_id
  );
EXCEPTION WHEN OTHERS THEN
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

REVOKE ALL ON FUNCTION public.ensure_lead_sale_record(uuid, text, numeric, numeric, text, text, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_lead_sale_record(uuid, text, numeric, numeric, text, text, text, timestamptz) TO authenticated;
