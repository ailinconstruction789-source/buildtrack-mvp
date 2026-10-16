-- =========================================================================
-- AILIN Sales KPI Master Evaluations Migration
-- Table: public.sales_kpi_evaluations
-- Description: Stores monthly KPI evaluations, rubric ratings, attendance, 
--              and executive feedback for sales staff (Bell, Piwe, Ying, Nook, Field)
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.sales_kpi_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  agent_id TEXT NOT NULL, -- 'BELL', 'PIEW', 'YING', 'NOOK', 'FIELD'
  reviewer_username TEXT NOT NULL DEFAULT 'TEAW',
  evaluations_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  final_score NUMERIC(5,2) NOT NULL DEFAULT 0,
  actual_sales INTEGER NOT NULL DEFAULT 0,
  qualified_leads INTEGER NOT NULL DEFAULT 0,
  executive_feedback TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sales_kpi_evaluations_period_agent_unique UNIQUE (year, month, agent_id)
);

-- Fast lookup index by evaluation period (year, month)
CREATE INDEX IF NOT EXISTS idx_sales_kpi_evaluations_period 
  ON public.sales_kpi_evaluations (year, month);

-- Fast lookup index by sales agent
CREATE INDEX IF NOT EXISTS idx_sales_kpi_evaluations_agent 
  ON public.sales_kpi_evaluations (agent_id);

-- Enable Row Level Security (RLS)
ALTER TABLE public.sales_kpi_evaluations ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if re-running
DROP POLICY IF EXISTS "Allow read sales_kpi_evaluations" ON public.sales_kpi_evaluations;
DROP POLICY IF EXISTS "Allow insert update sales_kpi_evaluations" ON public.sales_kpi_evaluations;

-- Allow read for authenticated and anon users
CREATE POLICY "Allow read sales_kpi_evaluations"
  ON public.sales_kpi_evaluations
  FOR SELECT
  TO authenticated, anon
  USING (true);

-- Allow insert/update for authenticated and anon users
CREATE POLICY "Allow insert update sales_kpi_evaluations"
  ON public.sales_kpi_evaluations
  FOR ALL
  TO authenticated, anon
  USING (true)
  WITH CHECK (true);
