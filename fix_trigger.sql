CREATE OR REPLACE FUNCTION update_task_progress_trigger()
RETURNS TRIGGER AS $BODY
DECLARE
    v_plot_id VARCHAR;
    v_task_template_id UUID;
    min_start TIMESTAMPTZ;
    max_end TIMESTAMPTZ;
    latest_progress INTEGER;
BEGIN
    -- Determine IDs based on operation
    IF TG_OP = 'DELETE' THEN
        v_plot_id := OLD.plot_id;
        v_task_template_id := OLD.task_template_id;
    ELSE
        v_plot_id := NEW.plot_id;
        v_task_template_id := NEW.task_template_id;
    END IF;

    -- Calculate Latest Progress
    SELECT progress INTO latest_progress
    FROM task_updates
    WHERE plot_id = v_plot_id AND task_template_id = v_task_template_id
    ORDER BY created_at DESC
    LIMIT 1;

    -- Calculate Max End Date (Only when latest progress is 100)
    IF latest_progress = 100 THEN
        SELECT MAX(created_at) INTO max_end
        FROM task_updates
        WHERE plot_id = v_plot_id AND task_template_id = v_task_template_id
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
        WHERE plot_id = v_plot_id AND task_template_id = v_task_template_id
          AND progress > 0;
    END IF;

    -- UPSERT into plot_task_assignments
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
