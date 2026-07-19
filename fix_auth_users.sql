-- 1. อัปเดตข้อมูลผู้ใช้งานเดิมที่มีปัญหา (ที่มีค่าเป็น NULL) ให้เป็นค่าว่าง ('') เพื่อให้ Supabase Auth ทำงานได้
UPDATE auth.users
SET 
  confirmation_token = COALESCE(confirmation_token, ''),
  recovery_token = COALESCE(recovery_token, ''),
  email_change_token_new = COALESCE(email_change_token_new, ''),
  email_change = COALESCE(email_change, '');

-- 2. อัปเดตฟังก์ชัน admin_create_user เพื่อให้ตอนเพิ่มผู้ใช้ใหม่ จะใส่ค่า '' แทน NULL เสมอ
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
    
    -- 2.1 เพิ่มข้อมูลใน auth.users เพื่อให้ล็อกอินได้ (ป้องกัน Database error querying schema โดยกำหนด token ต่างๆ เป็น '')
    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
        INSERT INTO auth.users (
            id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, 
            raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
            confirmation_token, recovery_token, email_change_token_new, email_change
        )
        VALUES (
            v_user_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 
            v_email, crypt(v_password, gen_salt('bf')), now(), 
            '{"provider":"email","providers":["email"]}', json_build_object('username', p_username, 'role', p_role), 
            now(), now(),
            '', '', '', ''
        );
        
        INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider, created_at, updated_at)
        VALUES (gen_random_uuid(), v_user_id, v_user_id::text, json_build_object('sub', v_user_id, 'email', v_email), 'email', now(), now());
    END IF;

    -- 2.2 เพิ่มข้อมูลใน public.users เพื่อให้แสดงผลในหน้าตาราง (ไม่ต้องระบุ PIN)
    IF NOT EXISTS (SELECT 1 FROM public.users WHERE username = p_username) THEN
        INSERT INTO public.users (username, role) VALUES (p_username, p_role);
    END IF;
END;
$$;
