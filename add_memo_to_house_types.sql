-- 1. เพิ่มคอลัมน์ memo เข้าไปในตาราง house_types (ถ้ายังไม่มี)
ALTER TABLE house_types ADD COLUMN IF NOT EXISTS memo TEXT;

-- 2. (เผื่อไว้) โหลด Schema Cache ของ Supabase ใหม่ เพื่อให้ API มองเห็นคอลัมน์ใหม่
NOTIFY pgrst, 'reload schema';
