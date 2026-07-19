-- 1. Fix RLS for plot_task_assignments
DROP POLICY IF EXISTS "Allow admin write assignments" ON plot_task_assignments;

CREATE POLICY "Allow admin write assignments" 
ON plot_task_assignments
FOR ALL 
USING (true)
WITH CHECK (
  latest_role IN ('Admin', 'Owner', 'Project Planner', 'Site Engineer', 'Foreman', 'QC', 'Procurement')
  OR latest_role IS NULL
);

-- 2. Fix the Date Resurrection Bug in the Trigger
CREATE OR REPLACE FUNCTION update_task_progress_trigger()
RETURNS TRIGGER AS $BODY
DECLARE
    v_plot_id VARCHAR;
    v_task_template_id UUID;
    min_start TIMESTAMPTZ;
    max_end TIMESTAMPTZ;
    latest_progress INTEGER;
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_plot_id := OLD.plot_id;
        v_task_template_id := OLD.task_template_id;
    ELSE
        v_plot_id := NEW.plot_id;
        v_task_template_id := NEW.task_template_id;
    END IF;

    SELECT progress INTO latest_progress
    FROM task_updates
    WHERE plot_id = v_plot_id AND task_template_id = v_task_template_id
    ORDER BY created_at DESC
    LIMIT 1;

    IF latest_progress = 100 THEN
        SELECT MAX(created_at) INTO max_end
        FROM task_updates
        WHERE plot_id = v_plot_id AND task_template_id = v_task_template_id
          AND progress = 100;
    ELSE
        max_end := NULL;
    END IF;

    IF COALESCE(latest_progress, 0) = 0 THEN
        min_start := NULL;
    ELSE
        SELECT MIN(created_at) INTO min_start
        FROM task_updates
        WHERE plot_id = v_plot_id AND task_template_id = v_task_template_id
          AND progress > 0;
    END IF;

    INSERT INTO plot_task_assignments (plot_id, task_template_id, current_progress, actual_start_date, actual_end_date)
    VALUES (v_plot_id, v_task_template_id, COALESCE(latest_progress, 0), min_start, max_end)
    ON CONFLICT (plot_id, task_template_id)
    DO UPDATE SET 
        current_progress = EXCLUDED.current_progress,
        actual_start_date = EXCLUDED.actual_start_date,
        actual_end_date = EXCLUDED.actual_end_date;

    RETURN NULL;
END;
$BODY LANGUAGE plpgsql;

-- 3. Force Sync the Stale Assignments (like Plot 21)
UPDATE plot_task_assignments pta
SET 
  latest_action = tu.action,
  latest_role = tu.role,
  latest_update_created_at = tu.created_at,
  current_progress = tu.progress
FROM (
  SELECT DISTINCT ON (plot_id, task_template_id)
    plot_id, task_template_id, action, role, created_at, progress
  FROM task_updates
  ORDER BY plot_id, task_template_id, created_at DESC
) tu
WHERE pta.plot_id = tu.plot_id 
  AND pta.task_template_id = tu.task_template_id
  AND (pta.latest_action IS DISTINCT FROM tu.action OR pta.current_progress IS DISTINCT FROM tu.progress);

