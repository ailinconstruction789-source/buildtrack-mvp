-- Drop the existing trigger
DROP TRIGGER IF EXISTS trigger_update_task_progress ON task_updates;

-- Recreate the trigger to also fire on DELETE
CREATE TRIGGER trigger_update_task_progress
AFTER INSERT OR UPDATE OR DELETE ON task_updates
FOR EACH ROW
EXECUTE FUNCTION update_task_progress_trigger();
