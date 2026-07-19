-- 1. เพิ่มคอลัมน์ plot_name เข้าไปในตาราง plots
ALTER TABLE plots ADD COLUMN IF NOT EXISTS plot_name TEXT;

-- 2. อัปเดตข้อมูลเก่าให้ plot_name มีค่าเท่ากับ id เดิม (เผื่อไว้สำหรับข้อมูลเก่า)
UPDATE plots SET plot_name = id WHERE plot_name IS NULL;

-- 3. แจ้งเตือน Supabase ให้โหลด schema ใหม่
NOTIFY pgrst, 'reload schema';
