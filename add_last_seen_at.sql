-- ==============================================================================
-- 🟢 สคริปต์เพิ่มระบบติดตามสถานะออนไลน์ (Online Status Tracker)
-- ==============================================================================
-- โปรดคัดลอกโค้ดนี้ทั้งหมดไปรันในเมนู "SQL Editor" ของ Supabase เพื่อเพิ่ม
-- คอลัมน์สำหรับเก็บเวลาล่าสุดที่ผู้ใช้งานกำลังออนไลน์อยู่
-- ==============================================================================

-- 1. เพิ่มคอลัมน์ last_seen_at ลงในตาราง users 
-- (ถ้ามีอยู่แล้วจะไม่เกิด error ด้วยคำสั่ง IF NOT EXISTS)
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

-- 2. สร้าง Function ไว้เคลียร์สถานะออฟไลน์ให้เร็วขึ้น (Optional: ใช้เรียกผ่าน API ได้)
CREATE OR REPLACE FUNCTION update_user_last_seen(p_username TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE public.users 
    SET last_seen_at = now()
    WHERE username = p_username;
END;
$$;
