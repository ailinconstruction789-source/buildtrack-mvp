-- ==========================================
-- 🛠️ สคริปต์ซ่อมแซมข้อมูล Auth (Fix Database Query Schema Error) 🛠️
-- โปรดก๊อปปี้ไปรันใน SQL Editor ของ Supabase เพื่อแก้บัคของระบบหลังบ้านครับ
-- ==========================================

UPDATE auth.users
SET 
  confirmation_token = COALESCE(confirmation_token, ''),
  recovery_token = COALESCE(recovery_token, ''),
  email_change_token_new = COALESCE(email_change_token_new, ''),
  email_change = COALESCE(email_change, ''),
  phone_change = COALESCE(phone_change, ''),
  phone_change_token = COALESCE(phone_change_token, ''),
  email_change_token_current = COALESCE(email_change_token_current, ''),
  reauthentication_token = COALESCE(reauthentication_token, ''),
  is_sso_user = COALESCE(is_sso_user, false),
  is_super_admin = COALESCE(is_super_admin, false);
