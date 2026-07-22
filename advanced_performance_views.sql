-- ==============================================================================
-- PHASE 2: ADVANCED PERFORMANCE OPTIMIZATION (VIEWS & TRIGGERS)
-- ==============================================================================

-- Create a view that accurately computes the planned and actual progress
-- exactly like the getPlotOverallStatus JavaScript function, but fully in SQL.
CREATE OR REPLACE VIEW vw_plot_overall_status AS
WITH task_status AS (
    SELECT 
        p.id AS plot_id,
        t.id AS task_id,
        t.cost,
        COALESCE(a.current_progress, 0) AS actual_progress,
        s.planned_start,
        s.planned_end,
        -- Calculate planned progress based on today (CURRENT_DATE)
        CASE 
            WHEN s.planned_start IS NULL OR s.planned_end IS NULL THEN 0
            WHEN CURRENT_DATE >= s.planned_end::date THEN 100
            WHEN CURRENT_DATE <= s.planned_start::date THEN 0
            ELSE 
               -- date - date yields an integer (days). We cast to numeric for division.
               ((CURRENT_DATE - s.planned_start::date)::numeric / NULLIF((s.planned_end::date - s.planned_start::date)::numeric, 0)) * 100
        END AS planned_progress
    FROM plots p
    JOIN task_templates t ON p.house_type_id = t.house_type_id
    LEFT JOIN plot_task_assignments a ON p.id = a.plot_id AND t.id = a.task_template_id
    LEFT JOIN plot_task_schedules s ON p.id = s.plot_id AND t.id = s.task_template_id
    WHERE t.is_progress_counted = true 
      AND (a.is_excluded IS NULL OR a.is_excluded = false)
),
plot_aggregates AS (
    SELECT 
        plot_id,
        SUM(cost) AS total_cost,
        SUM(actual_progress * COALESCE(cost, 1)) AS total_actual_weighted,
        SUM(planned_progress * COALESCE(cost, 1)) AS total_planned_weighted,
        COUNT(task_id) AS task_count,
        SUM(actual_progress) AS sum_actual,
        SUM(planned_progress) AS sum_planned
    FROM task_status
    GROUP BY plot_id
)
SELECT 
    p.id AS plot_id,
    p.project_name,
    p.house_type_id,
    p.sale_status,
    CASE 
        WHEN a.total_cost > 0 THEN ROUND((a.total_actual_weighted / a.total_cost)::numeric)
        WHEN a.task_count > 0 THEN ROUND((a.sum_actual / a.task_count)::numeric)
        ELSE 0
    END AS actual_avg,
    CASE 
        WHEN a.total_cost > 0 THEN ROUND((a.total_planned_weighted / a.total_cost)::numeric)
        WHEN a.task_count > 0 THEN ROUND((a.sum_planned / a.task_count)::numeric)
        ELSE 0
    END AS planned_avg,
    -- Determine Status string based on the JS logic
    CASE 
        WHEN p.sale_status = 'ready_for_sale' THEN 'ready_for_sale'
        WHEN a.task_count = 0 THEN 'none'
        WHEN (CASE WHEN a.total_cost > 0 THEN ROUND((a.total_actual_weighted / a.total_cost)::numeric) ELSE ROUND((a.sum_actual / a.task_count)::numeric) END) = 0 
             AND (CASE WHEN a.total_cost > 0 THEN ROUND((a.total_planned_weighted / a.total_cost)::numeric) ELSE ROUND((a.sum_planned / a.task_count)::numeric) END) = 0 THEN 'none'
        WHEN (CASE WHEN a.total_cost > 0 THEN ROUND((a.total_actual_weighted / a.total_cost)::numeric) ELSE ROUND((a.sum_actual / a.task_count)::numeric) END) >= 100 
             AND (CASE WHEN a.total_cost > 0 THEN ROUND((a.total_planned_weighted / a.total_cost)::numeric) ELSE ROUND((a.sum_planned / a.task_count)::numeric) END) >= 100 THEN 'completed'
        WHEN (CASE WHEN a.total_cost > 0 THEN ROUND((a.total_actual_weighted / a.total_cost)::numeric) ELSE ROUND((a.sum_actual / a.task_count)::numeric) END) < (CASE WHEN a.total_cost > 0 THEN ROUND((a.total_planned_weighted / a.total_cost)::numeric) ELSE ROUND((a.sum_planned / a.task_count)::numeric) END) - 10 THEN 'delayed'
        WHEN (CASE WHEN a.total_cost > 0 THEN ROUND((a.total_actual_weighted / a.total_cost)::numeric) ELSE ROUND((a.sum_actual / a.task_count)::numeric) END) > (CASE WHEN a.total_cost > 0 THEN ROUND((a.total_planned_weighted / a.total_cost)::numeric) ELSE ROUND((a.sum_planned / a.task_count)::numeric) END) + 10 THEN 'ahead'
        ELSE 'on-track'
    END AS status_code
FROM plots p
LEFT JOIN plot_aggregates a ON p.id = a.plot_id;
