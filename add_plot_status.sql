-- เพิ่มคอลัมน์สำหรับการจัดการสถานะลูกค้าและบ้านเสร็จพร้อมโอน

ALTER TABLE plots
ADD COLUMN IF NOT EXISTS has_customer BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS is_completed BOOLEAN DEFAULT false;

-- อัปเดตข้อมูลเดิมให้มีค่าเป็น false ป้องกันค่า Null
UPDATE plots SET has_customer = false WHERE has_customer IS NULL;
UPDATE plots SET is_completed = false WHERE is_completed IS NULL;
