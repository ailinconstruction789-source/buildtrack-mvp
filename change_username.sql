CREATE OR REPLACE FUNCTION admin_change_username(p_old_username TEXT, p_new_username TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_user_id UUID;
    v_old_email TEXT;
    v_new_email TEXT;
BEGIN
    -- ป้องกันค่าว่าง
    IF trim(p_new_username) = '' THEN
        RAISE EXCEPTION 'Username cannot be empty';
    END IF;

    v_old_email := LOWER(REPLACE(p_old_username, ' ', '')) || '@buildtrack.local';
    v_new_email := LOWER(REPLACE(p_new_username, ' ', '')) || '@buildtrack.local';

    -- หา user id
    SELECT id INTO v_user_id FROM auth.users WHERE email = v_old_email;

    IF v_user_id IS NOT NULL THEN
        -- เช็คว่าอีเมลใหม่ซ้ำไหม
        IF EXISTS (SELECT 1 FROM auth.users WHERE email = v_new_email) THEN
            RAISE EXCEPTION 'This username already exists';
        END IF;

        -- อัปเดต auth.users
        UPDATE auth.users 
        SET email = v_new_email, 
            raw_user_meta_data = jsonb_set(raw_user_meta_data, '{username}', to_jsonb(p_new_username))
        WHERE id = v_user_id;

        -- อัปเดต auth.identities
        UPDATE auth.identities
        SET identity_data = jsonb_set(identity_data, '{email}', to_jsonb(v_new_email))
        WHERE user_id = v_user_id;
    END IF;

    -- อัปเดตตารางที่เกี่ยวข้องทั้งหมดเพื่อความสม่ำเสมอของข้อมูล
    UPDATE public.users SET username = p_new_username WHERE username = p_old_username;
    UPDATE public.foremen SET name = p_new_username WHERE name = p_old_username;
    UPDATE public.task_updates SET user_name = p_new_username WHERE user_name = p_old_username;
    UPDATE public.defects SET reported_by = p_new_username WHERE reported_by = p_old_username;
    UPDATE public.assignments SET user_name = p_new_username WHERE user_name = p_old_username;
    
    -- ตารางใหม่ๆ ที่อาจจะมี
    UPDATE public.task_material_requests SET requested_by = p_new_username WHERE requested_by = p_old_username;

EXCEPTION
    WHEN OTHERS THEN
        RAISE;
END;
$$;
