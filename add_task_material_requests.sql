-- Migration: Add Task Material Requests Table (MVP)
-- This table tracks material requests at the task level for each plot.

CREATE TABLE IF NOT EXISTS task_material_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plot_id TEXT NOT NULL REFERENCES plots(id) ON DELETE CASCADE,
    task_template_id UUID NOT NULL REFERENCES task_templates(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'ordered', 'received')),
    notes TEXT,
    requested_by TEXT, -- Store foreman name/id
    requested_at TIMESTAMPTZ DEFAULT NOW(),
    expected_date TIMESTAMPTZ,
    updated_by TEXT, -- Store store controller name/id
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Ensure only one active request per task per plot (optional, but good for MVP)
    CONSTRAINT uq_plot_task_material UNIQUE (plot_id, task_template_id)
);

-- RLS Policies
ALTER TABLE task_material_requests ENABLE ROW LEVEL SECURITY;

-- Fallback permissive policies so the app continues to function with client-side auth.
CREATE POLICY "Allow public select on task_material_requests" ON task_material_requests FOR SELECT USING (true);
CREATE POLICY "Allow public insert on task_material_requests" ON task_material_requests FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update on task_material_requests" ON task_material_requests FOR UPDATE USING (true);
CREATE POLICY "Allow public delete on task_material_requests" ON task_material_requests FOR DELETE USING (true);

-- View to join with plot and task data for the Store Dashboard
CREATE OR REPLACE VIEW vw_task_material_requests AS
SELECT 
    tmr.*,
    p.project_name,
    p.id AS plot_number,
    p.foreman_name,
    tt.task_name,
    tt.cost
FROM task_material_requests tmr
JOIN plots p ON tmr.plot_id = p.id
JOIN task_templates tt ON tmr.task_template_id = tt.id;

GRANT SELECT ON vw_task_material_requests TO public;
GRANT SELECT ON vw_task_material_requests TO anon;
GRANT SELECT ON vw_task_material_requests TO authenticated;
