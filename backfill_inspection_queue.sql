-- ==============================================================================
-- FIX: BACKFILL LATEST ACTION FOR ASSIGNMENTS
-- Run this script to fix the missing Inspection Queue items.
-- This will look at all 16,000+ task_updates and update the plot_task_assignments
-- with the correct latest action, role, and date.
-- ==============================================================================

DO $$
DECLARE
    r RECORD;
    v_action TEXT;
    v_role TEXT;
    v_created_at TIMESTAMPTZ;
BEGIN
    -- Loop through all existing assignments
    FOR r IN SELECT plot_id, task_template_id FROM plot_task_assignments LOOP
        
        -- Get the absolute latest update for this task
        SELECT action, role, created_at 
        INTO v_action, v_role, v_created_at
        FROM task_updates
        WHERE plot_id = r.plot_id AND task_template_id = r.task_template_id
        ORDER BY created_at DESC
        LIMIT 1;

        -- If an update exists, save it to the assignment
        IF FOUND THEN
            UPDATE plot_task_assignments
            SET latest_action = v_action,
                latest_role = v_role,
                latest_update_created_at = v_created_at
            WHERE plot_id = r.plot_id AND task_template_id = r.task_template_id;
        END IF;

    END LOOP;
END;
$$ LANGUAGE plpgsql;
