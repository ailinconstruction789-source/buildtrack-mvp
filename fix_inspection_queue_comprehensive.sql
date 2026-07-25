-- ==============================================================================
-- COMPREHENSIVE FIX: INSPECTION QUEUE FLOW
-- 1. Fix Database Trigger
-- 2. Fix Inspection Queue View
-- 3. Backfill Data
-- ==============================================================================

-- 1. 🌟 FIX DATABASE TRIGGER 🌟
-- This ensures that when a Foreman submits or SE/QC rejects, the latest_action is updated correctly.
CREATE OR REPLACE FUNCTION update_task_progress_trigger()
RETURNS TRIGGER AS $$
DECLARE
    v_plot_id TEXT;
    v_task_template_id UUID;
    min_start TIMESTAMPTZ;
    max_end TIMESTAMPTZ;
    latest_progress INTEGER;
    v_latest_action TEXT;
    v_latest_role TEXT;
    v_latest_created_at TIMESTAMPTZ;
BEGIN
    -- Determine IDs based on operation
    IF TG_OP = 'DELETE' THEN
        v_plot_id := OLD.plot_id::text;
        v_task_template_id := OLD.task_template_id::uuid;
    ELSE
        v_plot_id := NEW.plot_id::text;
        v_task_template_id := NEW.task_template_id::uuid;
    END IF;

    -- Calculate Latest Progress, Action, Role, and Created At
    SELECT progress, action, role, created_at 
    INTO latest_progress, v_latest_action, v_latest_role, v_latest_created_at
    FROM task_updates
    WHERE plot_id::text = v_plot_id AND task_template_id = v_task_template_id
    ORDER BY created_at DESC
    LIMIT 1;

    -- Calculate Max End Date
    IF latest_progress = 100 THEN
        SELECT MAX(created_at) INTO max_end
        FROM task_updates
        WHERE plot_id::text = v_plot_id AND task_template_id = v_task_template_id
          AND progress = 100;
    ELSE
        max_end := NULL;
    END IF;

    -- Calculate Min Start Date
    IF COALESCE(latest_progress, 0) = 0 THEN
        min_start := NULL;
    ELSE
        SELECT MIN(created_at) INTO min_start
        FROM task_updates
        WHERE plot_id::text = v_plot_id AND task_template_id = v_task_template_id
          AND progress > 0;
    END IF;

    -- UPSERT into plot_task_assignments
    INSERT INTO plot_task_assignments (
        plot_id, task_template_id, current_progress, actual_start_date, actual_end_date,
        latest_action, latest_role, latest_update_created_at
    )
    VALUES (
        v_plot_id, v_task_template_id, COALESCE(latest_progress, 0), min_start, max_end,
        v_latest_action, v_latest_role, v_latest_created_at
    )
    ON CONFLICT (plot_id, task_template_id)
    DO UPDATE SET 
        current_progress = EXCLUDED.current_progress,
        actual_start_date = EXCLUDED.actual_start_date,
        actual_end_date = EXCLUDED.actual_end_date,
        latest_action = EXCLUDED.latest_action,
        latest_role = EXCLUDED.latest_role,
        latest_update_created_at = EXCLUDED.latest_update_created_at;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- 2. 🌟 FIX INSPECTION QUEUE VIEW 🌟
-- This allows tasks that were "Rejected" (progress 95) to show up in the Rework tab.
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
    (pta.latest_action LIKE '%ไม่อนุมัติ%' OR pta.latest_action LIKE '%ไม่ผ่าน%' OR pta.latest_action LIKE '%แจ้งแก้ไข%') AS "isRejected",
    -- Mark as urgent if it has been pending for more than 2 days
    (EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - pta.latest_update_created_at)) / 86400 >= 2) AS "isUrgent",
    CASE 
        WHEN pta.current_progress = 100 AND (pta.latest_action = 'ส่งงาน 100%' OR pta.latest_role = 'Foreman') THEN 'Site Engineer'
        WHEN pta.current_progress = 100 AND pta.latest_action = 'Site Engineer อนุมัติ' THEN 'QC'
        WHEN pta.current_progress = 95 AND (pta.latest_action LIKE '%ไม่อนุมัติ%' OR pta.latest_action LIKE '%ไม่ผ่าน%' OR pta.latest_action LIKE '%แจ้งแก้ไข%') THEN 'Rework'
        ELSE NULL
    END AS "statusFor"
FROM plot_task_assignments pta
JOIN plots p ON p.id::text = pta.plot_id
JOIN task_templates tt ON tt.id = pta.task_template_id
WHERE (pta.current_progress = 100 AND (pta.latest_action IN ('ส่งงาน 100%', 'Site Engineer อนุมัติ') OR pta.latest_role = 'Foreman'))
   OR (pta.current_progress = 95 AND (pta.latest_action LIKE '%ไม่อนุมัติ%' OR pta.latest_action LIKE '%ไม่ผ่าน%' OR pta.latest_action LIKE '%แจ้งแก้ไข%'));

-- 3. 🌟 BACKFILL DATA 🌟
-- Recover missing states for assignments
UPDATE plot_task_assignments pta
SET 
    latest_action = tu.action,
    latest_role = tu.role,
    latest_update_created_at = tu.created_at
FROM (
    SELECT DISTINCT ON (plot_id, task_template_id) 
        plot_id::text as t_plot_id, 
        task_template_id as t_task_template_id, 
        action, 
        role, 
        created_at
    FROM task_updates
    ORDER BY plot_id, task_template_id, created_at DESC
) tu
WHERE pta.plot_id = tu.t_plot_id AND pta.task_template_id = tu.t_task_template_id;
