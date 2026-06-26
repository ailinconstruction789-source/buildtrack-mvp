-- Migration: Add image_url to Task Material Requests

ALTER TABLE task_material_requests
ADD COLUMN IF NOT EXISTS image_url TEXT;

-- Recreate view to include image_url
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
