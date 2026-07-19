-- Allow Sales role to update plots (e.g. land_size, selling_price)
DROP POLICY IF EXISTS "Allow sales update plots" ON public.plots;
CREATE POLICY "Allow sales update plots" 
ON public.plots 
FOR UPDATE TO authenticated 
USING ((auth.jwt() -> 'user_metadata' ->> 'role') IN ('Sales', 'Admin', 'Owner', 'Project Planner')) 
WITH CHECK ((auth.jwt() -> 'user_metadata' ->> 'role') IN ('Sales', 'Admin', 'Owner', 'Project Planner'));
