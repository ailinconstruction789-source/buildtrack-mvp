ALTER TABLE task_material_requests 
ADD COLUMN IF NOT EXISTS delivery_mode TEXT NOT NULL DEFAULT 'single' CHECK (delivery_mode IN ('single', 'partial')),
ADD COLUMN IF NOT EXISTS material_type TEXT NOT NULL DEFAULT 'boq' CHECK (material_type IN ('boq', 'extra')),
ADD COLUMN IF NOT EXISTS extra_reason TEXT;

DROP VIEW IF EXISTS vw_task_material_requests;
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
