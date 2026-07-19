-- ==============================================================================
-- FIX: ROBUST TASK COMPLETION TRIGGER
-- Adds is_completed flag and fixes the "Date Shifting" bug in actual_end_date
-- ==============================================================================

-- 1. Add `is_completed` column to track completion robustly
ALTER TABLE task_updates ADD COLUMN IF NOT EXISTS is_completed BOOLEAN DEFAULT false;

-- 2. Update the Database Trigger to use is_completed and MIN(created_at)
CREATE OR REPLACE FUNCTION update_task_progress_trigger()
RETURNS TRIGGER AS $$
DECLARE
    v_plot_id TEXT;
    v_task_template_id UUID;
    min_start TIMESTAMPTZ;
    max_end TIMESTAMPTZ;
    latest_progress INTEGER;
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

    -- Calculate Latest Progress
    SELECT progress INTO latest_progress
    FROM task_updates
    WHERE plot_id::text = v_plot_id AND task_template_id = v_task_template_id
    ORDER BY created_at DESC
    LIMIT 1;

    -- UPSERT into plot_task_assignments
    INSERT INTO plot_task_assignments (plot_id, task_template_id, current_progress, actual_start_date, actual_end_date)
    VALUES (v_plot_id, v_task_template_id, COALESCE(latest_progress, 0), min_start, max_end)
    ON CONFLICT (plot_id, task_template_id)
    DO UPDATE SET 
        current_progress = EXCLUDED.current_progress,
        actual_start_date = EXCLUDED.actual_start_date,
        actual_end_date = EXCLUDED.actual_end_date;

    RETURN NULL; -- AFTER trigger returns NULL
END;
$$ LANGUAGE plpgsql;

-- 3. Backfill Data & Auto-Trigger Updates
-- This statement will automatically fire the new trigger for all completed tasks,
-- recalculating their dates and fixing any shifted dates retroactively!
UPDATE task_updates 
SET is_completed = true 
WHERE progress >= 100 AND is_completed = false;
