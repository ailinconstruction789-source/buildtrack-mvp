-- ==============================================================================
-- FIX: REBUILD INSPECTION QUEUE USING LATEST_ACTION
-- This fixes the bug where tasks disappeared from the QC Queue after being 
-- reset by an Admin. The old view checked if ANY record in task_updates 
-- had 'QC อนุมัติ', which caused reset tasks to be hidden forever.
-- ==============================================================================

CREATE OR REPLACE VIEW vw_inspection_queue AS
SELECT 
    pta.plot_id,
    pta.task_template_id,
    pta.current_progress AS progress,
    pta.latest_action AS action,
    pta.latest_role AS role,
    pta.latest_update_created_at AS created_at,
    tt.task_name,
    p.project_name,
    p.foreman_name AS foreman,
    (pta.latest_action LIKE '%ไม่อนุมัติ%' OR pta.latest_action LIKE '%ไม่ผ่าน%') AS "isRejected",
    -- Mark as urgent if it has been pending for more than 2 days
    (EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - pta.latest_update_created_at)) / 86400 >= 2) AS "isUrgent",
    CASE 
        WHEN pta.current_progress = 100 AND (pta.latest_action = 'ส่งงาน 100%' OR pta.latest_role = 'Foreman') THEN 'Site Engineer'
        WHEN pta.current_progress = 100 AND pta.latest_action = 'Site Engineer อนุมัติ' THEN 'QC'
        ELSE NULL
    END AS "statusFor"
FROM plot_task_assignments pta
JOIN plots p ON p.id::text = pta.plot_id
JOIN task_templates tt ON tt.id = pta.task_template_id
WHERE pta.current_progress = 100 
  AND (
       (pta.latest_action = 'ส่งงาน 100%' OR pta.latest_role = 'Foreman')
       OR (pta.latest_action = 'Site Engineer อนุมัติ')
       OR (pta.latest_action LIKE '%ไม่อนุมัติ%' OR pta.latest_action LIKE '%ไม่ผ่าน%')
  );
