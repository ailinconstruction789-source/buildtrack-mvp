-- ==============================================================================
-- 📋 BUILDTRACK: QC DAILY INSPECTION PLAN & WEIGHTED SCORING MIGRATION (PHASE 1)
-- Migration: 20261121_qc_daily_inspection_plan_and_weights.sql
-- ==============================================================================

-- 1. แม่แบบน้ำหนักงานตรวจ (QC Task Weights)
CREATE TABLE IF NOT EXISTS public.qc_task_weights (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    task_template_id TEXT NOT NULL,
    weight_score INTEGER NOT NULL CHECK (weight_score BETWEEN 1 AND 5),
    scope_description TEXT, -- ขอบเขตและปริมาณงานที่ต้องตรวจ
    is_hold_point BOOLEAN NOT NULL DEFAULT false, -- flag สำหรับงานโครงสร้างวิกฤต/เทคอนกรีต
    created_by TEXT,
    updated_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_qc_task_weight_task UNIQUE (task_template_id)
);

CREATE INDEX IF NOT EXISTS idx_qc_task_weights_template ON public.qc_task_weights(task_template_id);

-- 2. แผนตรวจงานประจำวัน QC (QC Daily Inspection Plans)
CREATE TABLE IF NOT EXISTS public.qc_daily_inspection_plans (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    plan_date DATE NOT NULL, -- วันที่ตรวจ (YYYY-MM-DD)
    project_name TEXT NOT NULL,
    inspector_username TEXT, -- ผู้ตรวจ (NULL = อยู่ในคิวส่วนกลางรอผู้จัดแผนมอบหมาย)
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed', 'completed')),
    total_planned_tasks INTEGER NOT NULL DEFAULT 0,
    total_planned_points INTEGER NOT NULL DEFAULT 0,
    total_completed_tasks INTEGER NOT NULL DEFAULT 0,
    total_completed_points INTEGER NOT NULL DEFAULT 0,
    total_deferred_tasks INTEGER NOT NULL DEFAULT 0,
    total_deferred_points INTEGER NOT NULL DEFAULT 0,
    confirmed_at TIMESTAMPTZ,
    confirmed_by TEXT,
    created_by TEXT,
    updated_by TEXT,
    version INTEGER NOT NULL DEFAULT 1, -- Optimistic locking / Concurrency guard
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_qc_daily_plan_date_user UNIQUE (plan_date, inspector_username, project_name)
);

CREATE INDEX IF NOT EXISTS idx_qc_daily_plans_date ON public.qc_daily_inspection_plans(plan_date);
CREATE INDEX IF NOT EXISTS idx_qc_daily_plans_inspector ON public.qc_daily_inspection_plans(inspector_username);

-- 3. รายการงานในแผนตรวจรายวัน + Snapshot น้ำหนัก (QC Daily Plan Items)
CREATE TABLE IF NOT EXISTS public.qc_daily_plan_items (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    plan_id TEXT REFERENCES public.qc_daily_inspection_plans(id) ON DELETE CASCADE,
    plot_id TEXT NOT NULL,
    task_template_id TEXT NOT NULL,
    task_name TEXT NOT NULL,
    round_number INTEGER NOT NULL DEFAULT 1, -- รอบตรวจ (รองรับตรวจซ้ำ)
    
    -- Immutable Snapshot เมื่อยืนยันแผน (แก้แม่แบบภายหลังไม่เปลี่ยนคะแนนเก่า)
    snapshot_weight_score INTEGER CHECK (snapshot_weight_score BETWEEN 1 AND 5), -- NULL หากไม่มีการตั้งน้ำหนัก
    snapshot_scope_description TEXT,
    snapshot_is_hold_point BOOLEAN NOT NULL DEFAULT false,
    
    -- ข้อมูลการส่งตรวจจาก SE
    se_submitted_at TIMESTAMPTZ NOT NULL,
    se_submitted_by TEXT,
    is_late_handoff BOOLEAN NOT NULL DEFAULT false, -- ส่งหลัง Cut-off (17:00)
    due_date DATE NOT NULL, -- กำหนดตรวจ
    
    -- สถานะการจัดแผน
    assigned_inspector_username TEXT,
    plan_status TEXT NOT NULL DEFAULT 'draft' CHECK (plan_status IN ('draft', 'confirmed', 'deferred')),
    
    -- ผลการตรวจงานจริง (Execution Outcome)
    execution_status TEXT NOT NULL DEFAULT 'pending' 
        CHECK (execution_status IN ('pending', 'passed', 'failed', 'cannot_inspect', 'partial')),
    actual_inspector_username TEXT, -- ผู้ตรวจจริงตาม Auth session
    actual_inspected_at TIMESTAMPTZ,
    earned_points INTEGER NOT NULL DEFAULT 0, -- แต้มที่ตรวจได้จริง
    failure_reason TEXT, -- เหตุผลกรณีตรวจไม่ได้ (เช่น ช่างไม่เข้า/หน้างานไม่พร้อม)
    
    -- ประวัติแผนตั้งต้นและการเลื่อนงาน (12/8/4 Tracking)
    original_plan_date DATE NOT NULL, -- เก็บแผนตั้งต้นเสมอ
    deferred_to_date DATE, -- วันที่เลื่อนไปตรวจ
    deferral_reason TEXT,
    deferred_at TIMESTAMPTZ,
    deferred_by TEXT,

    -- ฟิลด์รองรับผู้ตรวจแทน (Stand-in Fields)
    is_stand_in BOOLEAN NOT NULL DEFAULT false,
    original_inspector_username TEXT NULL,
    stand_in_handover_id TEXT NULL,
    stand_in_required BOOLEAN NOT NULL DEFAULT false,
    handover_effective_at TIMESTAMPTZ NULL,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- ป้องกันการมอบหมาย active ซ้ำในขอบเขตและรอบตรวจเดียวกัน
    CONSTRAINT uq_qc_plan_item_round UNIQUE (plot_id, task_template_id, round_number, plan_status)
);

CREATE INDEX IF NOT EXISTS idx_qc_plan_items_plan ON public.qc_daily_plan_items(plan_id);
CREATE INDEX IF NOT EXISTS idx_qc_plan_items_plot_task ON public.qc_daily_plan_items(plot_id, task_template_id);
CREATE INDEX IF NOT EXISTS idx_qc_plan_items_due ON public.qc_daily_plan_items(due_date);
CREATE INDEX IF NOT EXISTS idx_qc_plan_items_inspector ON public.qc_daily_plan_items(assigned_inspector_username);

-- 4. ตั้งค่า Row Level Security (RLS)
ALTER TABLE public.qc_task_weights ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qc_daily_inspection_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qc_daily_plan_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow read qc_task_weights" ON public.qc_task_weights;
CREATE POLICY "Allow read qc_task_weights" ON public.qc_task_weights FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow read qc_daily_inspection_plans" ON public.qc_daily_inspection_plans;
CREATE POLICY "Allow read qc_daily_inspection_plans" ON public.qc_daily_inspection_plans FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow read qc_daily_plan_items" ON public.qc_daily_plan_items;
CREATE POLICY "Allow read qc_daily_plan_items" ON public.qc_daily_plan_items FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow write qc_task_weights" ON public.qc_task_weights;
CREATE POLICY "Allow write qc_task_weights" ON public.qc_task_weights FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow write qc_daily_inspection_plans" ON public.qc_daily_inspection_plans;
CREATE POLICY "Allow write qc_daily_inspection_plans" ON public.qc_daily_inspection_plans FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow write qc_daily_plan_items" ON public.qc_daily_plan_items;
CREATE POLICY "Allow write qc_daily_plan_items" ON public.qc_daily_plan_items FOR ALL USING (true) WITH CHECK (true);
