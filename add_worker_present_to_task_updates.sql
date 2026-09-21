-- ==============================================================================
-- Migration: Add is_worker_present column to task_updates
-- Description: Tracks whether contractors/workers were present on-site during this task update.
-- Default is true (workers present). If false, indicates no workers attended on that day.
-- ==============================================================================

ALTER TABLE task_updates 
ADD COLUMN IF NOT EXISTS is_worker_present BOOLEAN DEFAULT true;

-- Update existing records so they default to true
UPDATE task_updates 
SET is_worker_present = true 
WHERE is_worker_present IS NULL;

-- Add descriptive comment
COMMENT ON COLUMN task_updates.is_worker_present IS 'True if workers/contractors were present on site; False if no workers attended';
