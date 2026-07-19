-- Drop the old incorrect function
DROP FUNCTION IF EXISTS bulk_mark_plot_completed(INT8, VARCHAR, VARCHAR);

-- Optimized RPC function for Bulk Completing Tasks (PER PLOT) with correct type
CREATE OR REPLACE FUNCTION bulk_mark_plot_completed(p_plot_id VARCHAR, p_username VARCHAR, p_role VARCHAR)
RETURNS VOID AS $$
BEGIN
    INSERT INTO task_updates (plot_id, task_template_id, progress, action, role, user_name, is_silent, is_completed)
    SELECT 
        p.id AS plot_id,
        t.id AS task_template_id,
        100 AS progress,
        'คีย์ข้อมูลย้อนหลัง (100%)' AS action,
        p_role AS role,
        p_username AS user_name,
        true AS is_silent,
        true AS is_completed
    FROM plots p
    JOIN task_templates t ON t.house_type_id = p.house_type_id
    LEFT JOIN plot_task_assignments pta 
        ON pta.plot_id = p.id AND pta.task_template_id = t.id
    WHERE p.id = p_plot_id
      AND (pta.is_excluded IS NULL OR pta.is_excluded = false)
      AND COALESCE(pta.current_progress, 0) < 100;
      
END;
$$ LANGUAGE plpgsql;
