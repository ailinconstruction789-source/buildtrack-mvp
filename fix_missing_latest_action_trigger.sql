-- ==============================================================================
-- FIX: ADD LATEST ACTION BACK TO ASSIGNMENTS
-- The 'ultimate_fix.sql' updated the trigger to fix a date resurrection bug,
-- but accidentally removed the code that updates latest_action and latest_role.
-- This caused the Inspection Queue to stop seeing new tasks submitted by Foremen.
-- ==============================================================================

-- 1. Fix the Date Resurrection Bug in the Trigger while KEEPING latest action
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

    RETURN NULL; -- AFTER trigger returns NULL
END;
$$ LANGUAGE plpgsql;

-- 2. Backfill Data: Run the logic over existing assignments to populate missing columns
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
