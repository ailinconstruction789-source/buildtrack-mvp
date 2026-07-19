-- ==============================================================================
-- 🚀 BUILDTRACK: AUTO READY FOR SALE TRIGGER (QC APPROVED)
-- ==============================================================================

-- 1. Create the Trigger Function
CREATE OR REPLACE FUNCTION auto_update_plot_sale_status()
RETURNS TRIGGER AS $$
DECLARE
    v_plot_id VARCHAR;
    v_total_counted_tasks INT;
    v_completed_counted_tasks INT;
    v_has_customer BOOLEAN;
BEGIN
    -- Determine plot_id from plot_task_assignments
    v_plot_id := NEW.plot_id;

    -- Count total tasks that are "progress counted" (not excluded, is_progress_counted=true)
    SELECT COUNT(t.id) INTO v_total_counted_tasks
    FROM plots p
    JOIN task_templates t ON p.house_type_id = t.house_type_id
    LEFT JOIN plot_task_assignments pta ON p.id = pta.plot_id AND t.id = pta.task_template_id
    WHERE p.id = v_plot_id
      AND NOT COALESCE(pta.is_excluded, false) 
      AND COALESCE(t.is_progress_counted, true);

    -- Count completed tasks that are "progress counted"
    SELECT COUNT(t.id) INTO v_completed_counted_tasks
    FROM plots p
    JOIN task_templates t ON p.house_type_id = t.house_type_id
    LEFT JOIN plot_task_assignments pta ON p.id = pta.plot_id AND t.id = pta.task_template_id
    WHERE p.id = v_plot_id
      AND NOT COALESCE(pta.is_excluded, false) 
      AND COALESCE(t.is_progress_counted, true)
      AND pta.actual_end_date IS NOT NULL; -- This is the QC passed condition!

    -- If all counted tasks are completed
    IF v_total_counted_tasks > 0 AND v_total_counted_tasks = v_completed_counted_tasks THEN
        -- Check if it has a customer
        SELECT has_customer INTO v_has_customer
        FROM plots WHERE id = v_plot_id;

        IF v_has_customer THEN
            -- บ้านสั่งสร้าง / มีลูกค้าจองแล้ว
            UPDATE plots 
            SET sale_status = 'ready_to_transfer', is_completed = true 
            WHERE id = v_plot_id AND sale_status != 'transferred' AND sale_status != 'ready_to_transfer';
        ELSE
            -- บ้านสร้างก่อนขาย / ยังไม่มีลูกค้า
            UPDATE plots 
            SET sale_status = 'ready_for_sale', is_completed = true 
            WHERE id = v_plot_id AND sale_status != 'ready_for_sale';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Drop the old trigger if it exists
DROP TRIGGER IF EXISTS auto_update_plot_sale_status_trigger ON plot_task_assignments;

-- 3. Create the Trigger
CREATE TRIGGER auto_update_plot_sale_status_trigger
AFTER UPDATE OF actual_end_date ON plot_task_assignments
FOR EACH ROW
WHEN (OLD.actual_end_date IS DISTINCT FROM NEW.actual_end_date AND NEW.actual_end_date IS NOT NULL)
EXECUTE FUNCTION auto_update_plot_sale_status();
