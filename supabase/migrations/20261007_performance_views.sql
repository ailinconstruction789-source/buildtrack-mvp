-- ==========================================
-- 1. Owner Analytics: S-Curve & EVM Metrics
-- ==========================================
-- Pre-calculates Planned Value (PV) and Earned Value (EV) by month for S-Curve.
-- Uses explicit ::text casts on IDs to prevent type mismatch (uuid vs text).

CREATE OR REPLACE VIEW vw_scurve_metrics AS
WITH planned AS (
    SELECT 
        TO_CHAR(DATE_TRUNC('month', s.planned_start), 'YYYY-MM') AS month_label,
        COUNT(s.id) AS planned_tasks_count,
        SUM(COALESCE(t.cost, 0)) AS planned_value
    FROM plot_task_schedules s
    JOIN task_templates t ON s.task_template_id::text = t.id::text
    WHERE s.planned_start IS NOT NULL
    GROUP BY DATE_TRUNC('month', s.planned_start)
),
actual AS (
    SELECT 
        TO_CHAR(DATE_TRUNC('month', a.actual_end_date), 'YYYY-MM') AS month_label,
        COUNT(a.id) AS actual_tasks_count,
        SUM(COALESCE(t.cost, 0)) AS earned_value
    FROM plot_task_assignments a
    JOIN task_templates t ON a.task_template_id::text = t.id::text
    WHERE a.current_progress = 100 AND a.actual_end_date IS NOT NULL
    GROUP BY DATE_TRUNC('month', a.actual_end_date)
)
SELECT 
    COALESCE(p.month_label, a.month_label) AS month,
    COALESCE(p.planned_value, 0) AS planned_value,
    COALESCE(a.earned_value, 0) AS earned_value,
    SUM(COALESCE(p.planned_value, 0)) OVER (ORDER BY COALESCE(p.month_label, a.month_label)) AS cumulative_planned_value,
    SUM(COALESCE(a.earned_value, 0)) OVER (ORDER BY COALESCE(p.month_label, a.month_label)) AS cumulative_earned_value
FROM planned p
FULL OUTER JOIN actual a ON p.month_label = a.month_label
ORDER BY month;


-- ==========================================
-- 2. QC Performance: Bottlenecks & Defect Stats
-- ==========================================
-- Identifies contractors and tasks with the highest rework rates.
-- Uses explicit ::text casts to safely link defects (text task_id) with task_templates (uuid id).

CREATE OR REPLACE VIEW vw_qc_bottlenecks AS
SELECT 
    COALESCE(a.contractor_name, 'ไม่ระบุผู้รับเหมา') AS contractor_name,
    t.task_name,
    COUNT(d.id) AS total_defects,
    COUNT(CASE WHEN d.status = 'resolved' THEN 1 END) AS resolved_defects,
    MAX(d.created_at) AS last_defect_date
FROM defects d
JOIN task_templates t ON d.task_id::text = t.id::text
LEFT JOIN plot_task_assignments a ON a.plot_id::text = d.plot_id::text AND a.task_template_id::text = d.task_id::text
GROUP BY COALESCE(a.contractor_name, 'ไม่ระบุผู้รับเหมา'), t.task_name
ORDER BY total_defects DESC;


-- ==========================================
-- 3. Sales Intelligence: Velocity & Forecast
-- ==========================================
-- Calculates average days to transfer from leads data safely.

CREATE OR REPLACE VIEW vw_sales_intelligence_metrics AS
WITH completed_sales AS (
    SELECT 
        COALESCE(project_name, 'Unknown') AS project_name,
        COUNT(*) AS total_transferred,
        AVG(
            CASE 
                WHEN transferred_date IS NOT NULL AND booking_date IS NOT NULL 
                THEN EXTRACT(EPOCH FROM (transferred_date::timestamptz - booking_date::timestamptz))/86400
                ELSE NULL 
            END
        ) AS avg_days_to_transfer
    FROM leads 
    WHERE (status ILIKE '%transfer%' OR crm_status ILIKE '%transfer%')
    GROUP BY project_name
)
SELECT 
    project_name,
    total_transferred,
    COALESCE(ROUND(avg_days_to_transfer::numeric, 2), 0) AS avg_days_to_transfer,
    CASE 
        WHEN avg_days_to_transfer > 0 THEN ROUND((30.0 / avg_days_to_transfer::numeric), 2)
        ELSE 0 
    END AS estimated_sales_per_month
FROM completed_sales;
