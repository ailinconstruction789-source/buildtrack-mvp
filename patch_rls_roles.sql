-- ==========================================
-- 🛡️ Security Patch: Restrict Write Access
-- ==========================================

-- 1. ลบ Policy เก่าที่หละหลวมออก
DROP POLICY IF EXISTS "Allow auth all contractors" ON public.contractors;
DROP POLICY IF EXISTS "Allow auth all house_types" ON public.house_types;
DROP POLICY IF EXISTS "Allow auth all assignments" ON public.plot_task_assignments;
DROP POLICY IF EXISTS "Allow auth all schedules" ON public.plot_task_schedules;

-- 2. อนุญาตให้ "ทุกคนที่ล็อกอิน" สามารถ "อ่าน (SELECT)" ข้อมูลได้
CREATE POLICY "Allow read contractors" ON public.contractors FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow read house_types" ON public.house_types FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow read assignments" ON public.plot_task_assignments FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow read schedules" ON public.plot_task_schedules FOR SELECT TO authenticated USING (true);

-- 3. อนุญาตให้แก้ไข/ลบ/เพิ่ม (ALL) ได้เฉพาะ Role ที่กำหนดเท่านั้น
CREATE POLICY "Allow admin write contractors" ON public.contractors FOR ALL TO authenticated 
USING ((auth.jwt() -> 'user_metadata' ->> 'role') IN ('Admin', 'Owner', 'Project Planner')) 
WITH CHECK ((auth.jwt() -> 'user_metadata' ->> 'role') IN ('Admin', 'Owner', 'Project Planner'));

CREATE POLICY "Allow admin write house_types" ON public.house_types FOR ALL TO authenticated 
USING ((auth.jwt() -> 'user_metadata' ->> 'role') IN ('Admin', 'Owner', 'Project Planner')) 
WITH CHECK ((auth.jwt() -> 'user_metadata' ->> 'role') IN ('Admin', 'Owner', 'Project Planner'));

CREATE POLICY "Allow admin write assignments" ON public.plot_task_assignments FOR ALL TO authenticated 
USING ((auth.jwt() -> 'user_metadata' ->> 'role') IN ('Admin', 'Owner', 'Project Planner')) 
WITH CHECK ((auth.jwt() -> 'user_metadata' ->> 'role') IN ('Admin', 'Owner', 'Project Planner'));

CREATE POLICY "Allow admin write schedules" ON public.plot_task_schedules FOR ALL TO authenticated 
USING ((auth.jwt() -> 'user_metadata' ->> 'role') IN ('Admin', 'Owner', 'Project Planner')) 
WITH CHECK ((auth.jwt() -> 'user_metadata' ->> 'role') IN ('Admin', 'Owner', 'Project Planner'));
