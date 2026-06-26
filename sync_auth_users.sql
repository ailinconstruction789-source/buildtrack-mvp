-- ==============================================================================
-- 🔄 สคริปต์แก้ไขปัญหาระบบผู้ใช้และรหัสผ่านแบบครบวงจร (RPC สำหรับ Admin)
-- ==============================================================================
-- โปรดคัดลอกโค้ดนี้ทั้งหมดไปรันในเมนู "SQL Editor" ของ Supabase เพียง 1 ครั้ง
-- ==============================================================================

-- 1. ฟังก์ชันสำหรับการเปลี่ยนรหัสผ่านโดย Admin
CREATE OR REPLACE FUNCTION admin_change_user_password(p_username TEXT, p_new_pin TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_email TEXT;
    v_password TEXT;
BEGIN
    v_email := LOWER(REPLACE(p_username, ' ', '')) || '@buildtrack.local';
    v_password := p_new_pin || 'BT!';
    
    -- อัปเดตรหัสผ่านในตาราง auth.users ของ Supabase โดยตรง
    UPDATE auth.users 
    SET encrypted_password = crypt(v_password, gen_salt('bf')),
        updated_at = now()
    WHERE email = v_email;
END;
$$;

-- 2. ฟังก์ชันสำหรับการสร้างผู้ใช้ใหม่
CREATE OR REPLACE FUNCTION admin_create_user(p_username TEXT, p_role TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_email TEXT;
    v_password TEXT;
    v_user_id UUID;
BEGIN
    v_email := LOWER(REPLACE(p_username, ' ', '')) || '@buildtrack.local';
    -- รหัสผ่านเริ่มต้นคือ 1234
    v_password := '1234BT!';
    v_user_id := gen_random_uuid();
    
    -- 2.1 เพิ่มข้อมูลใน auth.users เพื่อให้ล็อกอินได้
    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
        VALUES (v_user_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', v_email, crypt(v_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', json_build_object('username', p_username, 'role', p_role), now(), now());
        
        INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider, created_at, updated_at)
        VALUES (gen_random_uuid(), v_user_id, v_user_id::text, json_build_object('sub', v_user_id, 'email', v_email), 'email', now(), now());
    END IF;

    -- 2.2 เพิ่มข้อมูลใน public.users เพื่อให้แสดงผลในหน้าตาราง (ไม่ต้องระบุ PIN)
    IF NOT EXISTS (SELECT 1 FROM public.users WHERE username = p_username) THEN
        INSERT INTO public.users (username, role) VALUES (p_username, p_role);
    END IF;
END;
$$;

-- 3. ฟังก์ชันสำหรับการลบผู้ใช้
CREATE OR REPLACE FUNCTION admin_delete_user(p_username TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_email TEXT;
BEGIN
    v_email := LOWER(REPLACE(p_username, ' ', '')) || '@buildtrack.local';
    
    -- ลบจาก auth.users
    DELETE FROM auth.users WHERE email = v_email;
    
    -- ลบจาก public.users
    DELETE FROM public.users WHERE username = p_username;
END;
$$;

-- ยกเลิก Trigger เดิมที่มีปัญหาเรื่องคอลัมน์ pin ถ้าเคยรันไปแล้ว
DROP TRIGGER IF EXISTS trigger_sync_user_to_auth ON public.users;
DROP FUNCTION IF EXISTS sync_user_to_auth();
