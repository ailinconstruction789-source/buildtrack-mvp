-- ==============================================================================
-- 🚀 BUILDTRACK: TASK EXCLUSION (N/A) FEATURE MIGRATION
-- ==============================================================================

-- 1. Add is_excluded column to plot_task_assignments
ALTER TABLE plot_task_assignments 
ADD COLUMN IF NOT EXISTS is_excluded BOOLEAN DEFAULT FALSE;

-- 2. Update the Plot Progress View to exclude tasks marked as N/A
DROP VIEW IF EXISTS vw_project_progress;
DROP VIEW IF EXISTS vw_plot_progress;

CREATE OR REPLACE VIEW vw_plot_progress AS
SELECT 
    p.id AS plot_id,
    p.project_name,
    p.house_type_id,
    p.foreman_name,
    -- นับเฉพาะงานที่ไม่ได้ถูกยกเว้น
    COUNT(t.id) FILTER (WHERE NOT COALESCE(pta.is_excluded, false)) AS total_tasks,
    -- รวมเปอร์เซ็นต์เฉพาะงานที่ไม่ได้ถูกยกเว้น
    COALESCE(SUM(pta.current_progress) FILTER (WHERE NOT COALESCE(pta.is_excluded, false)), 0) AS sum_progress,
    -- รวมงบประมาณเฉพาะงานที่ไม่ได้ถูกยกเว้น
    COALESCE(SUM(t.cost) FILTER (WHERE NOT COALESCE(pta.is_excluded, false)), 0) AS total_cost,
    
    -- คำนวณ Overall Progress โดยข้ามงานที่ยกเว้นไป
    CASE 
        WHEN COALESCE(SUM(t.cost) FILTER (WHERE NOT COALESCE(pta.is_excluded, false)), 0) > 0 THEN 
            ROUND((SUM(pta.current_progress * t.cost) FILTER (WHERE NOT COALESCE(pta.is_excluded, false)) / SUM(t.cost) FILTER (WHERE NOT COALESCE(pta.is_excluded, false)))::NUMERIC)
        WHEN COUNT(t.id) FILTER (WHERE NOT COALESCE(pta.is_excluded, false)) > 0 THEN 
            ROUND(COALESCE(SUM(pta.current_progress) FILTER (WHERE NOT COALESCE(pta.is_excluded, false)), 0)::NUMERIC / COUNT(t.id) FILTER (WHERE NOT COALESCE(pta.is_excluded, false))) 
        ELSE 0 
    END AS overall_progress
FROM plots p
LEFT JOIN task_templates t ON p.house_type_id = t.house_type_id
LEFT JOIN plot_task_assignments pta ON p.id = pta.plot_id AND t.id = pta.task_template_id
GROUP BY p.id, p.project_name, p.house_type_id, p.foreman_name;

-- 3. Recreate the Project Progress View (No changes needed, but must be recreated since it depends on vw_plot_progress)
CREATE OR REPLACE VIEW vw_project_progress AS
SELECT 
    vpp.project_name,
    COUNT(vpp.plot_id) AS plot_count,
    CASE 
        WHEN SUM(vpp.total_cost) > 0 THEN 
            ROUND((SUM(vpp.overall_progress * vpp.total_cost) / SUM(vpp.total_cost))::NUMERIC)
        WHEN COUNT(vpp.plot_id) > 0 THEN 
            ROUND(SUM(vpp.overall_progress)::NUMERIC / COUNT(vpp.plot_id)) 
        ELSE 0 
    END AS project_progress
FROM vw_plot_progress vpp
GROUP BY vpp.project_name;
