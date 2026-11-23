-- ==============================================================================
-- 📋 BUILDTRACK: COMBINED ALL-IN-ONE QC INSPECTION PLAN MIGRATION (PHASE 1 + PHASE 3)
-- File: 20261121_combined_qc_inspection_plan_full_migration.sql
-- ==============================================================================
-- รันไฟล์นี้ไฟล์เดียวใน Supabase SQL Editor จะสร้างตาราง นโยบายความปลอดภัย (RLS) 
-- และ Index ทั้งหมดครบถ้วนในลำดับที่ถูกต้อง 100%
-- ==============================================================================

-- 1. ตารางแม่แบบน้ำหนักงานตรวจ (QC Task Weights)
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

-- 2. ตารางแผนตรวจงานประจำวัน QC (QC Daily Inspection Plans)
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

-- 3. ตารางรายการงานในแผนตรวจรายวัน + Snapshot น้ำหนัก + Stand-in (QC Daily Plan Items)
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

-- 4. ตารางทะเบียนการลาของ QC (QC Leave Requests)
CREATE TABLE IF NOT EXISTS public.qc_leave_requests (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  applicant_username TEXT NOT NULL,
  applicant_role TEXT NOT NULL DEFAULT 'QC',
  leave_type TEXT NOT NULL CHECK (leave_type IN ('planned', 'emergency')),
  time_scope TEXT NOT NULL CHECK (time_scope IN ('full_day', 'partial_day')),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  start_time TIME WITHOUT TIME ZONE NULL,
  end_time TIME WITHOUT TIME ZONE NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')) DEFAULT 'pending',
  approver_username TEXT NULL,
  approved_at TIMESTAMPTZ NULL,
  rejection_reason TEXT NULL,
  cancelled_at TIMESTAMPTZ NULL,
  cancelled_by TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Rule: Self-approval is strictly forbidden at database constraint level
  CONSTRAINT chk_qc_leave_no_self_approval CHECK (
    approver_username IS NULL OR approver_username <> applicant_username
  ),
  -- Date sanity
  CONSTRAINT chk_qc_leave_date_order CHECK (start_date <= end_date)
);

CREATE INDEX IF NOT EXISTS idx_qc_leave_lookup 
  ON public.qc_leave_requests (applicant_username, start_date, end_date, status);

-- 5. ตารางประวัติการมอบหมายผู้ตรวจแทน (QC Stand-in Handovers)
CREATE TABLE IF NOT EXISTS public.qc_stand_in_handovers (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  plan_item_id TEXT NOT NULL,
  original_inspector_username TEXT NOT NULL,
  stand_in_inspector_username TEXT NOT NULL,
  assigned_by TEXT NOT NULL,
  approved_by TEXT NULL,
  handover_reason TEXT NOT NULL,
  handover_effective_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_scope TEXT NULL,
  remaining_scope TEXT NULL,
  original_due_date DATE NOT NULL,
  new_due_date DATE NULL,
  status TEXT NOT NULL CHECK (status IN ('pending_ack', 'accepted', 'rejected', 'cancelled')) DEFAULT 'accepted',
  acknowledged_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Rule: Cannot assign self as stand-in for self
  CONSTRAINT chk_qc_handover_different_inspector CHECK (
    original_inspector_username <> stand_in_inspector_username
  )
);

CREATE INDEX IF NOT EXISTS idx_qc_handover_plan_item
  ON public.qc_stand_in_handovers (plan_item_id, status);

CREATE INDEX IF NOT EXISTS idx_qc_handover_inspectors
  ON public.qc_stand_in_handovers (original_inspector_username, stand_in_inspector_username);

-- 6. Row Level Security (RLS) & Policies
ALTER TABLE public.qc_task_weights ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qc_daily_inspection_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qc_daily_plan_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qc_leave_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qc_stand_in_handovers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow read qc_task_weights" ON public.qc_task_weights;
CREATE POLICY "Allow read qc_task_weights" ON public.qc_task_weights FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow read qc_daily_inspection_plans" ON public.qc_daily_inspection_plans;
CREATE POLICY "Allow read qc_daily_inspection_plans" ON public.qc_daily_inspection_plans FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow read qc_daily_plan_items" ON public.qc_daily_plan_items;
CREATE POLICY "Allow read qc_daily_plan_items" ON public.qc_daily_plan_items FOR SELECT USING (true);

DROP POLICY IF EXISTS "qc_leave_read_policy" ON public.qc_leave_requests;
CREATE POLICY "qc_leave_read_policy" ON public.qc_leave_requests FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow write qc_task_weights" ON public.qc_task_weights;
CREATE POLICY "Allow write qc_task_weights" ON public.qc_task_weights FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow write qc_daily_inspection_plans" ON public.qc_daily_inspection_plans;
CREATE POLICY "Allow write qc_daily_inspection_plans" ON public.qc_daily_inspection_plans FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow write qc_daily_plan_items" ON public.qc_daily_plan_items;
CREATE POLICY "Allow write qc_daily_plan_items" ON public.qc_daily_plan_items FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "qc_leave_insert_policy" ON public.qc_leave_requests;
CREATE POLICY "qc_leave_insert_policy" ON public.qc_leave_requests FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "qc_leave_update_policy" ON public.qc_leave_requests;
CREATE POLICY "qc_leave_update_policy" ON public.qc_leave_requests FOR UPDATE USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "qc_handover_all_policy" ON public.qc_stand_in_handovers;
CREATE POLICY "qc_handover_all_policy" ON public.qc_stand_in_handovers FOR ALL USING (true) WITH CHECK (true);

-- -----------------------------------------------------------------------------
-- 7. ตารางการตั้งค่าระบบ QC (qc_system_settings)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.qc_system_settings (
  setting_key TEXT PRIMARY KEY,
  setting_value NUMERIC NOT NULL,
  description TEXT,
  updated_by TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO public.qc_system_settings (setting_key, setting_value, description, updated_by)
VALUES ('daily_overload_threshold', 12, 'เกณฑ์ภาระงานตรวจสูงสุดต่อวันของ QC (แต้ม/คน/วัน)', 'system')
ON CONFLICT (setting_key) DO NOTHING;

ALTER TABLE public.qc_system_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow read qc_system_settings" ON public.qc_system_settings;
CREATE POLICY "Allow read qc_system_settings" ON public.qc_system_settings FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow write qc_system_settings" ON public.qc_system_settings;
CREATE POLICY "Allow write qc_system_settings" ON public.qc_system_settings FOR ALL USING (true) WITH CHECK (true);

