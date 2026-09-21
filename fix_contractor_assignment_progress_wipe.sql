-- ==============================================================================
-- FIX: PRESERVE TASK PROGRESS AND DATES ON CONTRACTOR ASSIGNMENT
-- ==============================================================================
-- Problem: When a contractor was assigned or edited, the application previously 
-- deleted the plot_task_assignments row and re-inserted it with only contractor_name 
-- and contractor_phone, resetting current_progress to 0 and wiping actual dates.
--
-- Solution:
-- 1. App code now uses UPDATE (or inserts preserving existing task_updates progress).
-- 2. Backfill script has restored all 28 affected tasks across all plots.
-- 3. SQL Trigger fallback: Ensure that any INSERT on plot_task_assignments defaults 
--    to calculating current_progress from task_updates if any exist.
-- ==============================================================================

CREATE OR REPLACE FUNCTION sync_assignment_progress_from_updates()
RETURNS TRIGGER AS $$
DECLARE
    v_min_start TIMESTAMPTZ;
    v_max_end TIMESTAMPTZ;
    v_latest_progress INTEGER;
    v_latest_action TEXT;
    v_latest_role TEXT;
    v_latest_created_at TIMESTAMPTZ;
BEGIN
    -- If current_progress was inserted as 0 or NULL, check if task_updates has existing records
    IF NEW.current_progress IS NULL OR NEW.current_progress = 0 THEN
        SELECT MIN(created_at) INTO v_min_start
        FROM task_updates
        WHERE plot_id = NEW.plot_id AND task_template_id = NEW.task_template_id;

        SELECT MIN(created_at) INTO v_max_end
        FROM task_updates
        WHERE plot_id = NEW.plot_id AND task_template_id = NEW.task_template_id
          AND (is_completed = true OR progress = 100);

        SELECT progress, action, role, created_at
        INTO v_latest_progress, v_latest_action, v_latest_role, v_latest_created_at
        FROM task_updates
        WHERE plot_id = NEW.plot_id AND task_template_id = NEW.task_template_id
        ORDER BY created_at DESC
        LIMIT 1;

        IF v_latest_progress IS NOT NULL AND v_latest_progress > 0 THEN
            NEW.current_progress := v_latest_progress;
            NEW.actual_start_date := v_min_start;
            NEW.actual_end_date := v_max_end;
            NEW.latest_action := v_latest_action;
            NEW.latest_role := v_latest_role;
            NEW.latest_update_created_at := v_latest_created_at;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_assignment_on_insert ON plot_task_assignments;
CREATE TRIGGER trg_sync_assignment_on_insert
BEFORE INSERT ON plot_task_assignments
FOR EACH ROW
EXECUTE FUNCTION sync_assignment_progress_from_updates();
