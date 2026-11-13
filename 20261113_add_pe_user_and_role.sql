-- ==============================================================================
-- 👷 Migration: สร้างบัญชี PE และเพิ่มสิทธิ์ Role 'Project Engineer' ในระบบ
-- ==============================================================================
-- ข้อมูลบัญชีสำหรับเข้าสู่ระบบ:
--   - Username : PE
--   - PIN      : 1234  (Password สำหรับ Supabase Auth: 1234BT!)
--   - Role     : Project Engineer
-- ==============================================================================

-- 1. เพิ่มผู้ใช้ PE ใน auth.users และ public.users
DO $$
DECLARE
    v_username TEXT := 'PE';
    v_role TEXT := 'Project Engineer';
    v_email TEXT := 'pe@buildtrack.local';
    v_password TEXT := '1234BT!';
    v_user_id UUID := gen_random_uuid();
BEGIN
    -- 1.1 สร้างใน auth.users ของ Supabase
    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        INSERT INTO auth.users (
            id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, 
            raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
            confirmation_token, recovery_token, email_change_token_new, email_change
        )
        VALUES (
            v_user_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 
            v_email, crypt(v_password, gen_salt('bf')), now(), 
            '{"provider":"email","providers":["email"]}', json_build_object('username', v_username, 'role', v_role), 
            now(), now(),
            '', '', '', ''
        );
        
        INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider, created_at, updated_at)
        VALUES (gen_random_uuid(), v_user_id, v_user_id::text, json_build_object('sub', v_user_id, 'email', v_email), 'email', now(), now());
    ELSE
        -- หากมีอยู่แล้ว อัปเดตรหัสผ่านและ role ให้พร้อมใช้งาน
        UPDATE auth.users 
        SET encrypted_password = crypt(v_password, gen_salt('bf')),
            raw_user_meta_data = json_build_object('username', v_username, 'role', v_role),
            updated_at = now()
        WHERE email = v_email;
    END IF;

    -- 1.2 เพิ่มใน public.users เพื่อให้ปรากฏในรายชื่อสำหรับ Login
    IF NOT EXISTS (SELECT 1 FROM public.users WHERE username = v_username) THEN
        INSERT INTO public.users (username, role) VALUES (v_username, v_role);
    ELSE
        UPDATE public.users SET role = v_role WHERE username = v_username;
    END IF;
END $$;

-- 2. ขยายสิทธิ์ RLS ให้ครอบคลุม Role 'Project Engineer' เสมือน 'Site Engineer'
DROP POLICY IF EXISTS "Allow specific roles write task_updates" ON public.task_updates;
CREATE POLICY "Allow specific roles write task_updates" ON public.task_updates 
FOR ALL TO authenticated 
USING ((auth.jwt() -> 'user_metadata' ->> 'role') IN ('Admin', 'Owner', 'Site Engineer', 'Project Engineer', 'Foreman', 'QC', 'Project Planner')) 
WITH CHECK ((auth.jwt() -> 'user_metadata' ->> 'role') IN ('Admin', 'Owner', 'Site Engineer', 'Project Engineer', 'Foreman', 'QC', 'Project Planner'));

DROP POLICY IF EXISTS "Allow admin write schedules" ON public.plot_task_schedules;
CREATE POLICY "Allow admin write schedules" ON public.plot_task_schedules 
FOR ALL TO authenticated 
USING ((auth.jwt() -> 'user_metadata' ->> 'role') IN ('Admin', 'Owner', 'Project Planner', 'Site Engineer', 'Project Engineer')) 
WITH CHECK ((auth.jwt() -> 'user_metadata' ->> 'role') IN ('Admin', 'Owner', 'Project Planner', 'Site Engineer', 'Project Engineer'));

DROP POLICY IF EXISTS "Allow admin write assignments" ON public.plot_task_assignments;
CREATE POLICY "Allow admin write assignments" ON public.plot_task_assignments 
FOR ALL TO authenticated 
USING ((auth.jwt() -> 'user_metadata' ->> 'role') IN ('Admin', 'Owner', 'Project Planner', 'Site Engineer', 'Project Engineer')) 
WITH CHECK ((auth.jwt() -> 'user_metadata' ->> 'role') IN ('Admin', 'Owner', 'Project Planner', 'Site Engineer', 'Project Engineer'));
