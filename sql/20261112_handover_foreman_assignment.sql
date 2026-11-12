-- ==============================================================================
-- Migration: Handover Foreman Handoff & Per-Defect Ownership Tracking
-- File: sql/20261112_handover_foreman_assignment.sql
-- Description:
--   1. Adds `foreman_name` column to `public.defects` so each handover task/defect
--      records the exact foreman responsible for it (preserving completed task
--      attribution to the original foreman while incomplete/new tasks transfer).
--   2. Adds `handover_foreman_name` and `handover_foreman_assigned_at` columns
--      to `public.plots` to track the current handover foreman assigned to the plot
--      independently from construction's `plots.foreman_name`.
-- ==============================================================================

ALTER TABLE public.defects
  ADD COLUMN IF NOT EXISTS foreman_name TEXT;

CREATE INDEX IF NOT EXISTS idx_defects_handover_foreman
  ON public.defects(plot_id, defect_stage, foreman_name);

ALTER TABLE public.plots
  ADD COLUMN IF NOT EXISTS handover_foreman_name TEXT,
  ADD COLUMN IF NOT EXISTS handover_foreman_assigned_at TIMESTAMPTZ;

COMMENT ON COLUMN public.defects.foreman_name IS 'Username/name of the foreman responsible for this defect (primarily handover stage handoffs).';
COMMENT ON COLUMN public.plots.handover_foreman_name IS 'Active foreman overseeing handover inspection work for the current cycle on this plot (can differ from construction foreman_name).';
