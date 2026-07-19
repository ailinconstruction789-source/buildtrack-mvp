-- ==============================================================================
-- 🛠️ สคริปต์แก้ไขปัญหาสิทธิ์การอัปโหลดรูปรวมหน้างานขั้นเด็ดขาด (Final RLS Fix)
-- ==============================================================================

-- 1. แก้ไขสิทธิ์ตาราง plots
-- อนุญาตให้ Foreman, Site Engineer, QC สามารถอัปเดตตาราง plots ได้
DROP POLICY IF EXISTS "Allow foreman and engineers update plots" ON public.plots;
CREATE POLICY "Allow foreman and engineers update plots" 
ON public.plots 
FOR UPDATE 
TO authenticated 
USING ((auth.jwt() -> 'user_metadata' ->> 'role') IN ('Foreman', 'Site Engineer', 'QC')) 
WITH CHECK ((auth.jwt() -> 'user_metadata' ->> 'role') IN ('Foreman', 'Site Engineer', 'QC'));

-- 2. แก้ไขสิทธิ์ Storage (Objects) ของ Supabase
-- ระบบ Storage ของ Supabase ต้องการสิทธิ์ SELECT, INSERT, UPDATE ควบคู่กันถึงจะอัปโหลดผ่าน SDK ได้
DROP POLICY IF EXISTS "Allow authenticated selects to task_images" ON storage.objects;
CREATE POLICY "Allow authenticated selects to task_images" 
ON storage.objects 
FOR SELECT 
TO authenticated 
USING (bucket_id = 'task_images');

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

DROP POLICY IF EXISTS "Allow authenticated deletes to task_images" ON storage.objects;
CREATE POLICY "Allow authenticated deletes to task_images" 
ON storage.objects 
FOR DELETE 
TO authenticated 
USING (bucket_id = 'task_images');
