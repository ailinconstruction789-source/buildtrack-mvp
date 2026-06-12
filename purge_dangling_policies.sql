-- ==============================================================================
-- Purge Dangling Public Policies
-- ==============================================================================

-- Drop public policies on notifications
DROP POLICY IF EXISTS "Allow public select on notifications" ON public.notifications;
DROP POLICY IF EXISTS "Allow public insert on notifications" ON public.notifications;
DROP POLICY IF EXISTS "Allow public update on notifications" ON public.notifications;
DROP POLICY IF EXISTS "Allow public delete on notifications" ON public.notifications;

-- Drop public policies on task_updates
DROP POLICY IF EXISTS "Allow public select on task_updates" ON public.task_updates;
DROP POLICY IF EXISTS "Allow public insert on task_updates" ON public.task_updates;
DROP POLICY IF EXISTS "Allow public update on task_updates" ON public.task_updates;
DROP POLICY IF EXISTS "Allow public delete on task_updates" ON public.task_updates;

-- Drop public policies on plot_task_assignments
DROP POLICY IF EXISTS "Allow public select on plot_task_assignments" ON public.plot_task_assignments;
DROP POLICY IF EXISTS "Allow public insert on plot_task_assignments" ON public.plot_task_assignments;
DROP POLICY IF EXISTS "Allow public update on plot_task_assignments" ON public.plot_task_assignments;
DROP POLICY IF EXISTS "Allow public delete on plot_task_assignments" ON public.plot_task_assignments;

-- Note: Role-based policies have been implemented in supabase_security_migration.sql
