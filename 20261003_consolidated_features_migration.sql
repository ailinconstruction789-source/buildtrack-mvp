-- ==============================================================================
-- 🚀 BUILDTRACK: CONSOLIDATED DATABASE MIGRATION (บันทึกฐานข้อมูล SUPABASE)
-- รวมฟังก์ชันที่พัฒนาทั้งหมด:
-- 1. 🏡 ระบบบ้านตัวอย่าง (Sample House)
-- 2. 🛡️ ระบบบันทึกการตรวจบ้านตัวอย่างประจำวัน (Daily Inspection SOP)
-- 3. 📑 ระบบติดตามเอกสาร & สาธารณูปโภค (Admin Docs & Utilities)
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. อัปเดตตาราง plots: เพิ่มคอลัมน์บ้านตัวอย่างและเอกสารธุรการ/สาธารณูปโภค
-- ------------------------------------------------------------------------------
ALTER TABLE public.plots 
ADD COLUMN IF NOT EXISTS is_sample_house BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS highlight_note TEXT,
ADD COLUMN IF NOT EXISTS permit_status VARCHAR DEFAULT 'NotStarted',
ADD COLUMN IF NOT EXISTS permit_date DATE,
ADD COLUMN IF NOT EXISTS registration_status VARCHAR DEFAULT 'NotStarted',
ADD COLUMN IF NOT EXISTS registration_date DATE,
ADD COLUMN IF NOT EXISTS water_meter_status VARCHAR DEFAULT 'NotStarted',
ADD COLUMN IF NOT EXISTS water_meter_date DATE,
ADD COLUMN IF NOT EXISTS electric_meter_status VARCHAR DEFAULT 'NotStarted',
ADD COLUMN IF NOT EXISTS electric_meter_date DATE;

-- อัปเดตข้อมูลบ้านตัวอย่างเดิมที่มีอยู่ในระบบ (ถ้ามี)
UPDATE public.plots
SET is_sample_house = true, highlight_note = 'sample_house'
WHERE (sale_status IN ('sample', 'sample_house') OR plot_name ILIKE '%บ้านตัวอย่าง%' OR highlight_note ILIKE '%sample_house%')
  AND has_customer IS NOT TRUE;

-- ------------------------------------------------------------------------------
-- 2. สร้างตาราง house_visit_checklists สำหรับจัดเก็บประวัติการตรวจ SOP รายวัน
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.house_visit_checklists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
    customer_name VARCHAR,
    project_name VARCHAR NOT NULL,
    house_or_plot_name VARCHAR,
    agent_name VARCHAR NOT NULL,
    stage VARCHAR DEFAULT 'daily_routine_morning', -- 'daily_routine_morning', 'daily_routine_evening', 'stage_a', etc.
    stage_a_checklist JSONB DEFAULT '{}'::jsonb,
    stage_a_completed_at TIMESTAMPTZ,
    stage_b_started_at TIMESTAMPTZ,
    stage_b_visit_notes TEXT,
    stage_c_checklist JSONB DEFAULT '{}'::jsonb,
    customer_feedback TEXT,
    interested_plot_name VARCHAR,
    objections TEXT,
    lead_crm_status VARCHAR,
    next_action TEXT,
    next_follow_up_date TIMESTAMPTZ,
    stage_c_completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------------------------------
-- 3. สร้าง Index เพื่อให้การโหลดและกรองข้อมูลทำงานได้อย่างรวดเร็ว
-- ------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_hvc_project_name ON public.house_visit_checklists(project_name);
CREATE INDEX IF NOT EXISTS idx_hvc_created_at ON public.house_visit_checklists(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_plots_sample_house ON public.plots(is_sample_house);

-- ------------------------------------------------------------------------------
-- 4. ตั้งค่าสิทธิ์ความปลอดภัย (Row Level Security - RLS) สำหรับเว็บออนไลน์
-- ------------------------------------------------------------------------------
ALTER TABLE public.house_visit_checklists ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow read access to house_visit_checklists" ON public.house_visit_checklists;
CREATE POLICY "Allow read access to house_visit_checklists" ON public.house_visit_checklists FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow write access to house_visit_checklists" ON public.house_visit_checklists;
CREATE POLICY "Allow write access to house_visit_checklists" ON public.house_visit_checklists FOR ALL USING (true) WITH CHECK (true);
