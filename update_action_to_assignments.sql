-- ==============================================================================
-- FIX: ADD LATEST ACTION TO ASSIGNMENTS
-- This fixes the Inspection Queue bug where tasks disappear when they fall off
-- the 3,000 limit in task_updates by caching the latest action directly in the assignment.
-- ==============================================================================

-- 1. Add new columns to plot_task_assignments
ALTER TABLE plot_task_assignments 
ADD COLUMN IF NOT EXISTS latest_action TEXT,
ADD COLUMN IF NOT EXISTS latest_role TEXT,
ADD COLUMN IF NOT EXISTS latest_update_created_at TIMESTAMPTZ;

-- 2. Update the Database Trigger to track the latest action
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

    -- Calculate Min Start Date
    SELECT MIN(created_at) INTO min_start
    FROM task_updates
    WHERE plot_id::text = v_plot_id AND task_template_id = v_task_template_id;

    -- Calculate End Date
    -- BUG FIX: Use MIN(created_at) to lock the actual_end_date to the FIRST time it was completed
    SELECT MIN(created_at) INTO max_end
    FROM task_updates
    WHERE plot_id::text = v_plot_id AND task_template_id = v_task_template_id
      AND is_completed = true;

    -- Calculate Latest Progress, Action, Role, and Created At
    SELECT progress, action, role, created_at 
    INTO latest_progress, v_latest_action, v_latest_role, v_latest_created_at
    FROM task_updates
    WHERE plot_id::text = v_plot_id AND task_template_id = v_task_template_id
    ORDER BY created_at DESC
    LIMIT 1;

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

-- 3. Backfill Data: Run the logic over existing assignments to populate the new columns
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
