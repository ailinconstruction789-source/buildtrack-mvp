-- Add billing tracking to plot_task_assignments
ALTER TABLE plot_task_assignments 
ADD COLUMN IF NOT EXISTS billing_status VARCHAR(50) DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS billed_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS billed_by VARCHAR(255),
ADD COLUMN IF NOT EXISTS billing_ref VARCHAR(255);

-- Create a view for Billing Queue to make it easier to query
DROP VIEW IF EXISTS vw_billing_queue;
CREATE VIEW vw_billing_queue AS
SELECT 
    pta.id as assignment_id,
    pta.plot_id,
    p.project_name,
    p.house_type_id,
    pta.task_template_id,
    t.task_name,
    t.task_order,
    t.cost as task_cost,
    pta.contractor_name,
    pta.contractor_phone,
    pta.current_progress,
    pta.latest_action,
    pta.latest_role,
    pta.latest_update_created_at,
    pta.billing_status,
    pta.billed_at,
    pta.billed_by,
    pta.billing_ref,
    COALESCE(pta.is_excluded, false) as is_excluded
FROM plot_task_assignments pta
JOIN plots p ON pta.plot_id = p.id
JOIN task_templates t ON pta.task_template_id = t.id
WHERE pta.current_progress = 100 
  AND COALESCE(pta.is_excluded, false) = false
  AND (pta.latest_action LIKE '%อนุมัติ%' OR pta.latest_action = 'ส่งงาน 100%');

GRANT SELECT ON vw_billing_queue TO authenticated;
GRANT SELECT ON vw_billing_queue TO anon;
GRANT SELECT ON vw_billing_queue TO public;
