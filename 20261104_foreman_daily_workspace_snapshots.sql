-- ==============================================================================
-- Migration: Foreman Daily Workspace & Point-in-Time Inspection Snapshots
-- File: 20261104_foreman_daily_workspace_snapshots.sql
-- Description:
--   1. Creates table foreman_daily_duty_snapshots to record daily tasks dispatch
--      for foremen and freeze point-in-time plan dates and inspection updates.
--   2. Supports historical playback: even if future Gantt schedules shift,
--      past daily snapshots remain untouched.
--   3. Enables standard non-start roadblock reasons logging (prior task delayed,
--      cannot start, material issue, worker issue, weather issue, etc.).
-- ==============================================================================

CREATE TABLE IF NOT EXISTS foreman_daily_duty_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date DATE NOT NULL,
  foreman_name TEXT NOT NULL,
  plot_id TEXT NOT NULL,
  project_name TEXT,
  task_template_id TEXT NOT NULL,
  task_name TEXT NOT NULL,
  task_order INT,
  planned_start DATE,
  planned_end DATE,
  current_progress NUMERIC DEFAULT 0,
  contractor_name TEXT,
  is_updated_today BOOLEAN DEFAULT false,
  status_reason TEXT,       -- 'prior_task_delayed', 'cannot_start', 'material_issue', 'worker_issue', 'weather_issue', 'other'
  status_note TEXT,         -- optional explanation
  last_updated_at TIMESTAMPTZ,
  updated_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT uq_foreman_snapshot UNIQUE (snapshot_date, plot_id, task_template_id)
);

-- Fast lookup indexes
CREATE INDEX IF NOT EXISTS idx_fdds_date_foreman 
  ON foreman_daily_duty_snapshots(snapshot_date, foreman_name);

CREATE INDEX IF NOT EXISTS idx_fdds_plot_date 
  ON foreman_daily_duty_snapshots(plot_id, snapshot_date);

CREATE INDEX IF NOT EXISTS idx_fdds_date 
  ON foreman_daily_duty_snapshots(snapshot_date);

-- Enable Row Level Security (RLS)
ALTER TABLE foreman_daily_duty_snapshots ENABLE ROW LEVEL SECURITY;

-- Resilient RLS Policies for authenticated and anon roles
DROP POLICY IF EXISTS "Allow select foreman daily snapshots" ON foreman_daily_duty_snapshots;
CREATE POLICY "Allow select foreman daily snapshots" ON foreman_daily_duty_snapshots
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow insert foreman daily snapshots" ON foreman_daily_duty_snapshots;
CREATE POLICY "Allow insert foreman daily snapshots" ON foreman_daily_duty_snapshots
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Allow update foreman daily snapshots" ON foreman_daily_duty_snapshots;
CREATE POLICY "Allow update foreman daily snapshots" ON foreman_daily_duty_snapshots
  FOR UPDATE USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow delete foreman daily snapshots" ON foreman_daily_duty_snapshots;
CREATE POLICY "Allow delete foreman daily snapshots" ON foreman_daily_duty_snapshots
  FOR DELETE USING (true);

-- Grant table permissions
GRANT ALL ON TABLE foreman_daily_duty_snapshots TO anon, authenticated, service_role;

COMMENT ON TABLE foreman_daily_duty_snapshots IS 'Stores daily dispatch tasks and inspection compliance snapshots for site foremen.';
