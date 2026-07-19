-- ==============================================================================
-- 🚀 BUILDTRACK: ADD is_progress_counted to task_templates
-- ==============================================================================

-- 1. เพิ่ม Column is_progress_counted ลงใน task_templates
ALTER TABLE task_templates 
ADD COLUMN IF NOT EXISTS is_progress_counted BOOLEAN DEFAULT TRUE;

-- 2. ดรอป View เดิมทิ้งก่อนสร้างใหม่เพื่อแก้ปัญหา dependencies
DROP VIEW IF EXISTS vw_project_progress;
DROP VIEW IF EXISTS vw_plot_progress;

-- 3. สร้าง View ใหม่โดยเพิ่มเงื่อนไข COALESCE(t.is_progress_counted, true)
CREATE OR REPLACE VIEW vw_plot_progress AS
SELECT 
    p.id AS plot_id,
    p.project_name,
    p.house_type_id,
    p.foreman_name,
    -- นับเฉพาะงานที่ไม่ได้ถูกยกเว้นระดับ Plot (pta.is_excluded) และระดับแบบบ้าน (t.is_progress_counted)
    COUNT(t.id) FILTER (WHERE NOT COALESCE(pta.is_excluded, false) AND COALESCE(t.is_progress_counted, true)) AS total_tasks,
    
    -- รวมเปอร์เซ็นต์
    COALESCE(SUM(pta.current_progress) FILTER (WHERE NOT COALESCE(pta.is_excluded, false) AND COALESCE(t.is_progress_counted, true)), 0) AS sum_progress,
    
    -- รวมงบประมาณ
    COALESCE(SUM(t.cost) FILTER (WHERE NOT COALESCE(pta.is_excluded, false) AND COALESCE(t.is_progress_counted, true)), 0) AS total_cost,
    
    -- คำนวณ Overall Progress โดยข้ามงานที่ยกเว้นไป
    CASE 
        WHEN COALESCE(SUM(t.cost) FILTER (WHERE NOT COALESCE(pta.is_excluded, false) AND COALESCE(t.is_progress_counted, true)), 0) > 0 THEN 
            ROUND((SUM(pta.current_progress * t.cost) FILTER (WHERE NOT COALESCE(pta.is_excluded, false) AND COALESCE(t.is_progress_counted, true)) / SUM(t.cost) FILTER (WHERE NOT COALESCE(pta.is_excluded, false) AND COALESCE(t.is_progress_counted, true)))::NUMERIC)
        WHEN COUNT(t.id) FILTER (WHERE NOT COALESCE(pta.is_excluded, false) AND COALESCE(t.is_progress_counted, true)) > 0 THEN 
            ROUND(COALESCE(SUM(pta.current_progress) FILTER (WHERE NOT COALESCE(pta.is_excluded, false) AND COALESCE(t.is_progress_counted, true)), 0)::NUMERIC / COUNT(t.id) FILTER (WHERE NOT COALESCE(pta.is_excluded, false) AND COALESCE(t.is_progress_counted, true))) 
        ELSE 0 
    END AS overall_progress
FROM plots p
LEFT JOIN task_templates t ON p.house_type_id = t.house_type_id
LEFT JOIN plot_task_assignments pta ON p.id = pta.plot_id AND t.id = pta.task_template_id
GROUP BY p.id, p.project_name, p.house_type_id, p.foreman_name;

-- 4. สร้าง Project Progress View กลับคืนมา
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
