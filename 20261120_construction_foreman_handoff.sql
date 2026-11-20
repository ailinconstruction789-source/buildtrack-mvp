-- ==============================================================================
-- Migration: Construction Foreman Handoff & Task-Level Ownership Tracking
-- File: 20261120_construction_foreman_handoff.sql
-- Description:
--   1. Adds `foreman_name` to `public.plot_task_assignments` so individual
--      construction tasks can record their responsible foreman independently
--      (freezing completed & QC-passed tasks to the original foreman, while
--      incomplete / pending tasks transfer to the incoming foreman).
--   2. Adds `previous_foreman_name`, `foreman_handoff_at`, and `foreman_handoff_reason`
--      to `public.plots` to display handover history directly on the plot.
--   3. Creates `public.plot_foreman_handovers` audit table to record all handover events.
-- ==============================================================================

-- 1. Add foreman_name column to plot_task_assignments
ALTER TABLE public.plot_task_assignments
  ADD COLUMN IF NOT EXISTS foreman_name TEXT;

CREATE INDEX IF NOT EXISTS idx_pta_plot_foreman
  ON public.plot_task_assignments(plot_id, foreman_name);

-- 2. Add previous foreman tracking to plots table
ALTER TABLE public.plots
  ADD COLUMN IF NOT EXISTS previous_foreman_name TEXT,
  ADD COLUMN IF NOT EXISTS foreman_handoff_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS foreman_handoff_reason TEXT;

-- 3. Create plot_foreman_handovers table for audit & handover logging
CREATE TABLE IF NOT EXISTS public.plot_foreman_handovers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plot_id TEXT NOT NULL,
  from_foreman TEXT,
  to_foreman TEXT NOT NULL,
  handoff_mode TEXT DEFAULT 'takeover', -- 'takeover' (freeze completed) or 'reassign_all'
  reason TEXT,
  completed_tasks_count INTEGER DEFAULT 0,
  transferred_tasks_count INTEGER DEFAULT 0,
  transferred_task_ids JSONB DEFAULT '[]'::jsonb,
  frozen_task_ids JSONB DEFAULT '[]'::jsonb,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_plot_foreman_handovers_plot_id
  ON public.plot_foreman_handovers(plot_id, created_at DESC);

-- Enable RLS and create permissive policies
ALTER TABLE public.plot_foreman_handovers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow select plot_foreman_handovers" ON public.plot_foreman_handovers;
CREATE POLICY "Allow select plot_foreman_handovers" ON public.plot_foreman_handovers
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow insert plot_foreman_handovers" ON public.plot_foreman_handovers;
CREATE POLICY "Allow insert plot_foreman_handovers" ON public.plot_foreman_handovers
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Allow update plot_foreman_handovers" ON public.plot_foreman_handovers;
CREATE POLICY "Allow update plot_foreman_handovers" ON public.plot_foreman_handovers
  FOR UPDATE USING (true);

GRANT ALL ON TABLE public.plot_foreman_handovers TO anon, authenticated, service_role;

-- Comments
COMMENT ON COLUMN public.plot_task_assignments.foreman_name IS 'Foreman responsible for this specific construction task assignment.';
COMMENT ON COLUMN public.plots.previous_foreman_name IS 'Name of the previous foreman who handled this plot prior to the latest handover.';
COMMENT ON COLUMN public.plots.foreman_handoff_at IS 'Timestamp when the plot foreman was last handed off.';
COMMENT ON COLUMN public.plots.foreman_handoff_reason IS 'Reason recorded during the latest foreman handoff.';
COMMENT ON TABLE public.plot_foreman_handovers IS 'Audit log of all construction foreman handovers per plot.';
