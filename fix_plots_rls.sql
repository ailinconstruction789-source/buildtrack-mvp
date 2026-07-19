-- ==============================================================================
-- 🛠️ สคริปต์แก้ไขปัญหาสิทธิ์การอัปโหลดรูปรวมหน้างานสำหรับไอดีใหม่ (Foreman/Engineer)
-- ==============================================================================

-- 1. แก้ไขสิทธิ์ในตาราง plots: อนุญาตให้ Foreman, Site Engineer และ QC สามารถอัปเดตข้อมูลในตาราง plots ได้
-- เพื่อให้สามารถบันทึกลิงก์ "รูปรวมหน้างาน" (overview_image_url) ลงตารางได้สำเร็จ
DROP POLICY IF EXISTS "Allow foreman and engineers update plots" ON public.plots;
CREATE POLICY "Allow foreman and engineers update plots" 
ON public.plots 
FOR UPDATE 
TO authenticated 
USING ((auth.jwt() -> 'user_metadata' ->> 'role') IN ('Foreman', 'Site Engineer', 'QC')) 
WITH CHECK ((auth.jwt() -> 'user_metadata' ->> 'role') IN ('Foreman', 'Site Engineer', 'QC'));

-- 2. แก้ไขสิทธิ์ใน Storage: ตรวจสอบและอนุญาตให้ผู้ใช้ที่ล็อกอินแล้วอัปโหลดไฟล์รูปภาพได้
-- (ป้องกันกรณีไอดีใหม่ติดสิทธิ์ Upload ไฟล์เข้า Storage ของ Supabase)
DROP POLICY IF EXISTS "Allow authenticated uploads to task_images" ON storage.objects;
CREATE POLICY "Allow authenticated uploads to task_images" 
ON storage.objects 
FOR INSERT 
TO authenticated 
WITH CHECK (bucket_id = 'task_images');

DROP POLICY IF EXISTS "Allow authenticated updates to task_images" ON storage.objects;
CREATE POLICY "Allow authenticated updates to task_images" 
ON storage.objects 
FOR UPDATE 
TO authenticated 
USING (bucket_id = 'task_images');
