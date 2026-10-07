-- ==============================================================================
-- 🚀 BUILDTRACK: RENTAL & LEASE PROGRAMS A, B, C DATABASE MIGRATION
-- ระบบสัญญาเช่าและโปรแกรมเช่า 3 รูปแบบ (ไอลิน Ailin):
-- 1. Program A: Rent (เช่าปกติ) — อยู่สบาย ไม่ต้องซื้อ (ประกัน 2 เดือน, ขั้นต่ำ 12 เดือน)
-- 2. Program B: Rent to Own (เช่าซื้อ) — สะสมเงินซื้อบ้าน 5,000 บาท/เดือน หักค่าบ้านตอนโอน
-- 3. Program C: Rent and Save (เช่าออม) — Base Price ลด 10% (ใน 1 ปี) / ลด 5% (ใน 2 ปี)
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. สร้างตาราง rental_contracts สำหรับจัดเก็บสัญญาเช่าและประวัติ
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rental_contracts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
    project_name VARCHAR NOT NULL,
    plot_id VARCHAR NOT NULL,
    plot_name VARCHAR,
    tenant_name VARCHAR NOT NULL,
    tenant_phone VARCHAR,
    agent_name VARCHAR NOT NULL,
    program_type VARCHAR NOT NULL DEFAULT 'program_a', -- 'program_a', 'program_b', 'program_c'
    monthly_rent NUMERIC(15, 2) DEFAULT 0,
    security_deposit NUMERIC(15, 2) DEFAULT 0,
    advance_rent NUMERIC(15, 2) DEFAULT 0,
    savings_per_month NUMERIC(15, 2) DEFAULT 0, -- For Program B
    accumulated_savings NUMERIC(15, 2) DEFAULT 0,
    base_price NUMERIC(15, 2) DEFAULT 0, -- For Program C
    discount_1yr_pct NUMERIC(5, 2) DEFAULT 10.0,
    discount_2yr_pct NUMERIC(5, 2) DEFAULT 5.0,
    lease_duration_months INT DEFAULT 12,
    lease_start_date DATE NOT NULL,
    lease_end_date DATE NOT NULL,
    status VARCHAR DEFAULT 'Active', -- 'Active', 'Renewed', 'ConvertedToBuy', 'MovedOut', 'Cancelled'
    move_out_date DATE,
    deposit_refunded NUMERIC(15, 2),
    conversion_date DATE,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------------------------------
-- 2. อัปเดตตาราง plots: เพิ่มคอลัมน์สถานะและข้อมูลการเช่า
-- ------------------------------------------------------------------------------
ALTER TABLE public.plots
ADD COLUMN IF NOT EXISTS current_tenant_name VARCHAR,
ADD COLUMN IF NOT EXISTS current_tenant_phone VARCHAR,
ADD COLUMN IF NOT EXISTS rental_program VARCHAR,
ADD COLUMN IF NOT EXISTS monthly_rent NUMERIC(15, 2),
ADD COLUMN IF NOT EXISTS security_deposit NUMERIC(15, 2),
ADD COLUMN IF NOT EXISTS accumulated_downpayment NUMERIC(15, 2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS lease_start_date DATE,
ADD COLUMN IF NOT EXISTS lease_end_date DATE;

-- ------------------------------------------------------------------------------
-- 3. อัปเดตตาราง leads: เพิ่มคอลัมน์การเช่าและโปรแกรมเช่า
-- ------------------------------------------------------------------------------
ALTER TABLE public.leads
ADD COLUMN IF NOT EXISTS deal_type VARCHAR DEFAULT 'buy', -- 'buy', 'rent', 'rent_to_own'
ADD COLUMN IF NOT EXISTS rental_program VARCHAR,
ADD COLUMN IF NOT EXISTS rental_monthly_rent NUMERIC(15, 2),
ADD COLUMN IF NOT EXISTS rental_deposit NUMERIC(15, 2),
ADD COLUMN IF NOT EXISTS rental_savings_per_month NUMERIC(15, 2),
ADD COLUMN IF NOT EXISTS rental_accumulated_savings NUMERIC(15, 2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS rental_base_price NUMERIC(15, 2),
ADD COLUMN IF NOT EXISTS rental_start_date DATE,
ADD COLUMN IF NOT EXISTS rental_end_date DATE,
ADD COLUMN IF NOT EXISTS rental_status VARCHAR,
ADD COLUMN IF NOT EXISTS active_rental_contract_id UUID REFERENCES public.rental_contracts(id) ON DELETE SET NULL;

-- ------------------------------------------------------------------------------
-- 4. สร้าง Indexes เพื่อความรวดเร็วในการค้นหาและกรองข้อมูล
-- ------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_rental_contracts_project ON public.rental_contracts(project_name);
CREATE INDEX IF NOT EXISTS idx_rental_contracts_plot ON public.rental_contracts(plot_id);
CREATE INDEX IF NOT EXISTS idx_rental_contracts_status ON public.rental_contracts(status);
CREATE INDEX IF NOT EXISTS idx_leads_deal_type ON public.leads(deal_type);
CREATE INDEX IF NOT EXISTS idx_leads_rental_program ON public.leads(rental_program);

-- ------------------------------------------------------------------------------
-- 5. กำหนด Row Level Security (RLS) สำหรับความปลอดภัยและการเข้าถึง
-- ------------------------------------------------------------------------------
ALTER TABLE public.rental_contracts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow read access to rental_contracts" ON public.rental_contracts;
CREATE POLICY "Allow read access to rental_contracts" ON public.rental_contracts FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow write access to rental_contracts" ON public.rental_contracts;
CREATE POLICY "Allow write access to rental_contracts" ON public.rental_contracts FOR ALL USING (true) WITH CHECK (true);
