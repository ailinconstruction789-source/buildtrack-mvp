-- ==========================================
-- 🛡️ สคริปต์อัปเกรดความปลอดภัยขั้นสูงสุด (Supabase Security Migration) 🛡️
-- โปรดคัดลอกโค้ดนี้ทั้งหมดไปรันในเมนู "SQL Editor" ของ Supabase
-- ==========================================

-- 1. สร้าง Users เข้าสู่ระบบรักษาความปลอดภัยของ Supabase (auth.users)
-- (ใช้ PIN ปัจจุบัน + 'BT!' เพื่อให้รหัสผ่านยาวครบ 6 ตัวอักษรตามมาตรฐาน)
INSERT INTO auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
SELECT 
  '00000000-0000-0000-0000-000000000000',
  gen_random_uuid(),
  'authenticated',
  'authenticated',
  LOWER(REPLACE(username, ' ', '')) || '@buildtrack.local',
  crypt(pin || 'BT!', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}',
  json_build_object('username', username, 'role', role),
  now(),
  now()
FROM public.users
WHERE NOT EXISTS (
  SELECT 1 FROM auth.users au WHERE au.email = LOWER(REPLACE(public.users.username, ' ', '')) || '@buildtrack.local'
);

-- 2. สร้าง Identities ให้ Users เพื่อให้ Login ผ่าน Email ได้
INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider, created_at, updated_at)
SELECT 
  gen_random_uuid(),
  au.id,
  au.id::text,
  json_build_object('sub', au.id, 'email', au.email),
  'email',
  now(),
  now()
FROM auth.users au
WHERE NOT EXISTS (
  SELECT 1 FROM auth.identities ai WHERE ai.user_id = au.id
);

-- 3. ลบความลับ (PIN) ออกจากตารางที่คนทั่วไปมองเห็นได้! (Commented out to keep for trial purposes)
-- ALTER TABLE public.users DROP COLUMN IF EXISTS pin;

-- 4. เปิดใช้งานระบบล็อกฐานข้อมูล (Row Level Security - RLS)
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plot_task_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plot_task_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.defects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contractors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.house_types ENABLE ROW LEVEL SECURITY;

-- 5. สร้างกฎเหล็ก (Policies): อนุญาตให้อ่าน/เขียน ได้เฉพาะคนที่ Login แล้วเท่านั้น!
-- (ตาราง users ยอมให้อ่านได้ เพื่อใช้แสดงใน Dropdown ตอนหน้า Login)
CREATE POLICY "Allow public read access to users" ON public.users FOR SELECT TO public USING (true);
CREATE POLICY "Allow authenticated full access to users" ON public.users FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- นโยบายสำหรับตารางอื่นๆ: ให้คนที่ Login แล้วอ่านและแก้ไขได้ตาม Role
-- projects, plots, task_templates: ให้ทุกคนอ่านได้ แต่เฉพาะ Admin/Planner สร้าง/แก้ไขได้
CREATE POLICY "Allow read projects" ON public.projects FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow admin/planner write projects" ON public.projects FOR ALL TO authenticated USING ((auth.jwt() -> 'user_metadata' ->> 'role') IN ('Admin', 'Project Planner', 'Owner')) WITH CHECK ((auth.jwt() -> 'user_metadata' ->> 'role') IN ('Admin', 'Project Planner', 'Owner'));

CREATE POLICY "Allow read plots" ON public.plots FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow admin/planner write plots" ON public.plots FOR ALL TO authenticated USING ((auth.jwt() -> 'user_metadata' ->> 'role') IN ('Admin', 'Project Planner', 'Owner')) WITH CHECK ((auth.jwt() -> 'user_metadata' ->> 'role') IN ('Admin', 'Project Planner', 'Owner'));

CREATE POLICY "Allow read task_templates" ON public.task_templates FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow admin/planner write task_templates" ON public.task_templates FOR ALL TO authenticated USING ((auth.jwt() -> 'user_metadata' ->> 'role') IN ('Admin', 'Project Planner', 'Owner')) WITH CHECK ((auth.jwt() -> 'user_metadata' ->> 'role') IN ('Admin', 'Project Planner', 'Owner'));

-- task_updates: ควบคุมให้เหมาะสม
CREATE POLICY "Allow read task_updates" ON public.task_updates FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow specific roles write task_updates" ON public.task_updates FOR ALL TO authenticated USING ((auth.jwt() -> 'user_metadata' ->> 'role') IN ('Admin', 'Owner', 'Site Engineer', 'Foreman', 'QC', 'Project Planner')) WITH CHECK ((auth.jwt() -> 'user_metadata' ->> 'role') IN ('Admin', 'Owner', 'Site Engineer', 'Foreman', 'QC', 'Project Planner'));

-- ตารางที่เหลือ: อนุญาต authenticated อ่านเขียน
CREATE POLICY "Allow auth all assignments" ON public.plot_task_assignments FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow auth all schedules" ON public.plot_task_schedules FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow auth all defects" ON public.defects FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow auth all notifications" ON public.notifications FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow auth all contractors" ON public.contractors FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow auth all house_types" ON public.house_types FOR ALL TO authenticated USING (true) WITH CHECK (true);
