-- ==============================================================================
-- NEW VIEW: vw_qc_se_performance
-- This view pre-aggregates task_updates data for the Performance Heatmaps.
-- It groups by Date and Hour (in Asia/Bangkok timezone) to reduce data transfer.
-- ==============================================================================

CREATE OR REPLACE VIEW vw_qc_se_performance AS
SELECT 
    role,
    action,
    DATE(created_at AT TIME ZONE 'Asia/Bangkok') AS date,
    EXTRACT(ISODOW FROM (created_at AT TIME ZONE 'Asia/Bangkok')) AS day_of_week,
    EXTRACT(DAY FROM (created_at AT TIME ZONE 'Asia/Bangkok')) AS day_of_month,
    EXTRACT(HOUR FROM (created_at AT TIME ZONE 'Asia/Bangkok')) AS hour_of_day,
    COUNT(*) AS action_count
FROM task_updates
WHERE action IN ('ส่งงาน 100%', 'Site Engineer อนุมัติ', 'QC อนุมัติ', 'QC ไม่อนุมัติ', 'Site Engineer ไม่อนุมัติ')
GROUP BY 
    role, 
    action,
    DATE(created_at AT TIME ZONE 'Asia/Bangkok'),
    EXTRACT(ISODOW FROM (created_at AT TIME ZONE 'Asia/Bangkok')),
    EXTRACT(DAY FROM (created_at AT TIME ZONE 'Asia/Bangkok')),
    EXTRACT(HOUR FROM (created_at AT TIME ZONE 'Asia/Bangkok'));
