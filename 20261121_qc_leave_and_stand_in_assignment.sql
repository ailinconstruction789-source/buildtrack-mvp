-- ==============================================================================
-- 📋 BUILDTRACK: PHASE 3 QC LEAVE & STAND-IN INSPECTOR ASSIGNMENT MIGRATION
-- File: 20261121_qc_leave_and_stand_in_assignment.sql
-- ==============================================================================

-- 1. Table: qc_leave_requests (ทะเบียนการลาของ QC)
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

-- Index for quick lookup of active leaves by date and user
CREATE INDEX IF NOT EXISTS idx_qc_leave_lookup 
  ON public.qc_leave_requests (applicant_username, start_date, end_date, status);

-- 2. Table: qc_stand_in_handovers (ประวัติการมอบหมายผู้ตรวจแทน)
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

-- 3. Enhance qc_daily_plan_items with stand-in audit tracking (Safe IF EXISTS block)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'qc_daily_plan_items') THEN
    ALTER TABLE public.qc_daily_plan_items
      ADD COLUMN IF NOT EXISTS is_stand_in BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS original_inspector_username TEXT NULL,
      ADD COLUMN IF NOT EXISTS stand_in_handover_id TEXT NULL,
      ADD COLUMN IF NOT EXISTS stand_in_required BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS handover_effective_at TIMESTAMPTZ NULL;
  END IF;
END $$;

-- 4. Row Level Security (RLS)
ALTER TABLE public.qc_leave_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qc_stand_in_handovers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "qc_leave_read_policy" ON public.qc_leave_requests;
CREATE POLICY "qc_leave_read_policy" ON public.qc_leave_requests
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "qc_leave_insert_policy" ON public.qc_leave_requests;
CREATE POLICY "qc_leave_insert_policy" ON public.qc_leave_requests
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "qc_leave_update_policy" ON public.qc_leave_requests;
CREATE POLICY "qc_leave_update_policy" ON public.qc_leave_requests
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "qc_handover_all_policy" ON public.qc_stand_in_handovers;
CREATE POLICY "qc_handover_all_policy" ON public.qc_stand_in_handovers
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
