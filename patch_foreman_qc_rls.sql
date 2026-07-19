DROP POLICY IF EXISTS "Allow admin write assignments" ON public.plot_task_assignments;
CREATE POLICY "Allow admin write assignments" ON public.plot_task_assignments FOR ALL TO authenticated 
USING ((auth.jwt() -> 'user_metadata' ->> 'role') IN ('Admin', 'Owner', 'Project Planner', 'Site Engineer', 'Foreman', 'QC')) 
WITH CHECK ((auth.jwt() -> 'user_metadata' ->> 'role') IN ('Admin', 'Owner', 'Project Planner', 'Site Engineer', 'Foreman', 'QC'));

DROP POLICY IF EXISTS "Allow admin write schedules" ON public.plot_task_schedules;
CREATE POLICY "Allow admin write schedules" ON public.plot_task_schedules FOR ALL TO authenticated 
USING ((auth.jwt() -> 'user_metadata' ->> 'role') IN ('Admin', 'Owner', 'Project Planner', 'Site Engineer', 'Foreman', 'QC')) 
WITH CHECK ((auth.jwt() -> 'user_metadata' ->> 'role') IN ('Admin', 'Owner', 'Project Planner', 'Site Engineer', 'Foreman', 'QC'));
