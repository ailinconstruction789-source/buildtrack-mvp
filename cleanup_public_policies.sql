-- Drop dangling public RLS policies created in earlier migrations
DROP POLICY IF EXISTS "Allow public select on notifications" ON notifications;
DROP POLICY IF EXISTS "Allow public select on task_updates" ON task_updates;
DROP POLICY IF EXISTS "Allow public select on plot_task_assignments" ON plot_task_assignments;
