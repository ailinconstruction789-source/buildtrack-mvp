-- ============================================================================
-- Migration / Safe Backfill: Assign ไอลิน 3 (unassigned -> DEN)
-- and ไอลิน 4 handover cycle (Auen fallback -> DEN)
-- Date: 2026-11-12
--
-- คำแนะนำการใช้งานใน Supabase SQL Editor:
--   1. ให้รันเฉพาะส่วน "SECTION 1: PREVIEW" เพื่อตรวจสอบรายการที่จะถูกปรับก่อน
--   2. เมื่อตรวจสอบเรียบร้อยแล้ว จึงค่อยรันส่วน "SECTION 2: APPLY BACKFILL"
--   * ปลอดภัย ไม่กระทบข้อมูลก่อสร้างของ VIEW, LEAB หรือ Auen ในแปลงก่อสร้างเดิม
-- ============================================================================

-- Prerequisite columns (idempotent with 20261104_cascading_planning_kpi & 20261112_handover_foreman_assignment.sql)
ALTER TABLE public.plots
  ADD COLUMN IF NOT EXISTS foreman_assigned_at TIMESTAMPTZ;

ALTER TABLE public.plots
  ADD COLUMN IF NOT EXISTS handover_foreman_name TEXT;

ALTER TABLE public.plots
  ADD COLUMN IF NOT EXISTS handover_foreman_assigned_at TIMESTAMPTZ;

ALTER TABLE public.defects
  ADD COLUMN IF NOT EXISTS defect_stage TEXT DEFAULT 'construction';

ALTER TABLE public.defects
  ADD COLUMN IF NOT EXISTS foreman_name TEXT;

ALTER TABLE public.defects
  ADD COLUMN IF NOT EXISTS handover_cycle INTEGER;

-- ============================================================================
-- SECTION 1: PREVIEW (อ่านอย่างเดียว ไม่แก้ไขข้อมูล)
-- ============================================================================

-- 1.1 ตรวจสอบชื่อ username จริงของโฟร์แมน Den ในระบบ (ตาราง users ใช้คอลัมน์ username และ role)
SELECT id, username, role
FROM public.users
WHERE lower(trim(role)) IN ('foreman', 'โฟร์แมน')
  AND lower(trim(username)) = 'den';

-- 1.2 ตรวจสอบแปลงในโครงการ ไอลิน 3 ที่ยังไม่มีโฟร์แมน หรือถูกระบุเป็น Den/DEN
SELECT id, project_name, foreman_name, foreman_assigned_at, handover_foreman_name
FROM public.plots
WHERE regexp_replace(COALESCE(project_name, ''), '\s+', '', 'g') = 'ไอลิน3'
  AND (
    foreman_name IS NULL
    OR trim(foreman_name) = ''
    OR trim(foreman_name) IN ('ยังไม่ระบุโฟร์แมน', 'ยังไม่ระบุ', '-')
    OR lower(trim(foreman_name)) IN ('unassigned', 'den')
  );

-- 1.3 ตรวจสอบ snapshot ประวัติรายวันของ ไอลิน 3 ที่ยังเก็บคำว่ายังไม่ระบุ / placeholder
SELECT snapshot_date, plot_id, project_name, foreman_name, task_template_id
FROM public.foreman_daily_duty_snapshots
WHERE (
    regexp_replace(COALESCE(project_name, ''), '\s+', '', 'g') = 'ไอลิน3'
    OR plot_id IN (
      SELECT id FROM public.plots
      WHERE regexp_replace(COALESCE(project_name, ''), '\s+', '', 'g') = 'ไอลิน3'
    )
  )
  AND (
    foreman_name IS NULL
    OR trim(foreman_name) = ''
    OR trim(foreman_name) IN ('ยังไม่ระบุโฟร์แมน', 'ยังไม่ระบุ', '-')
    OR lower(trim(foreman_name)) IN ('unassigned', 'den')
  )
ORDER BY snapshot_date, plot_id;

-- 1.4 ตรวจสอบแปลงในโครงการ ไอลิน 4 ที่มีงานตรวจรับมอบบ้าน (defect_stage = 'handover') ภายใต้ Auen
SELECT
  p.id AS plot_id,
  p.project_name,
  p.foreman_name AS construction_foreman,
  p.handover_foreman_name,
  p.handover_foreman_assigned_at,
  count(d.id) AS handover_defect_count
FROM public.plots p
JOIN public.defects d
  ON d.plot_id = p.id
 AND d.defect_stage = 'handover'
WHERE regexp_replace(COALESCE(p.project_name, ''), '\s+', '', 'g') = 'ไอลิน4'
  AND (
    lower(trim(COALESCE(p.foreman_name, ''))) = 'auen'
    OR lower(trim(COALESCE(p.handover_foreman_name, ''))) IN ('auen', 'den')
  )
GROUP BY p.id, p.project_name, p.foreman_name, p.handover_foreman_name, p.handover_foreman_assigned_at;

-- 1.5 ตรวจสอบ snapshot งานตรวจรับบ้าน (handover:%) ของ ไอลิน 4 ภายใต้ Auen
SELECT s.snapshot_date, s.plot_id, s.project_name, s.foreman_name, s.task_template_id
FROM public.foreman_daily_duty_snapshots s
WHERE s.task_template_id LIKE 'handover:%'
  AND s.plot_id IN (
    SELECT p.id
    FROM public.plots p
    JOIN public.defects d ON d.plot_id = p.id AND d.defect_stage = 'handover'
    WHERE regexp_replace(COALESCE(p.project_name, ''), '\s+', '', 'g') = 'ไอลิน4'
      AND (
        lower(trim(COALESCE(p.foreman_name, ''))) = 'auen'
        OR lower(trim(COALESCE(p.handover_foreman_name, ''))) IN ('auen', 'den')
      )
  )
ORDER BY s.snapshot_date, s.plot_id;

-- ============================================================================
-- SECTION 2: APPLY BACKFILL (รันเมื่อตรวจ SECTION 1 แล้วถูกต้อง)
-- ============================================================================
BEGIN;

DO $$
DECLARE
  v_den_username TEXT;
BEGIN
  -- หา username จริงของโฟร์แมน Den (ยึดตัวพิมพ์ใหญ่ 'DEN' เป็นค่าหลักหากพบ)
  SELECT trim(username)
  INTO v_den_username
  FROM public.users
  WHERE lower(trim(role)) IN ('foreman', 'โฟร์แมน')
    AND lower(trim(username)) = 'den'
  ORDER BY CASE WHEN trim(username) = 'DEN' THEN 0 ELSE 1 END, username
  LIMIT 1;

  IF v_den_username IS NULL OR v_den_username = '' THEN
    v_den_username := 'DEN';
  END IF;

  -- --------------------------------------------------------------------------
  -- ส่วนที่ A: ปรับแปลงโครงการ ไอลิน 3 ที่ยัง "ยังไม่ระบุโฟร์แมน" (และกรณีพิมพ์ DEN/Den ต่างกัน) -> DEN
  -- --------------------------------------------------------------------------
  UPDATE public.plots p
  SET
    foreman_name = v_den_username,
    -- ล้าง foreman_assigned_at เฉพาะแปลงที่ไม่เคยมีโฟร์แมนคนอื่นก่อนหน้า (ยังไม่มี snapshot ของโฟร์แมนคนอื่น)
    foreman_assigned_at = CASE
      WHEN NOT EXISTS (
        SELECT 1
        FROM public.foreman_daily_duty_snapshots s
        WHERE s.plot_id = p.id
          AND s.foreman_name IS NOT NULL
          AND trim(s.foreman_name) <> ''
          AND trim(s.foreman_name) NOT IN ('ยังไม่ระบุโฟร์แมน', 'ยังไม่ระบุ', '-')
          AND lower(trim(s.foreman_name)) NOT IN ('unassigned', 'den')
      ) THEN NULL
      ELSE p.foreman_assigned_at
    END
  WHERE regexp_replace(COALESCE(p.project_name, ''), '\s+', '', 'g') = 'ไอลิน3'
    AND (
      p.foreman_name IS NULL
      OR trim(p.foreman_name) = ''
      OR trim(p.foreman_name) IN ('ยังไม่ระบุโฟร์แมน', 'ยังไม่ระบุ', '-')
      OR lower(trim(p.foreman_name)) IN ('unassigned', 'den')
    );

  -- อัปเดต snapshot ประวัติของ ไอลิน 3 ที่ยังค้างเป็น placeholder หรือสะกด den ต่างเคส
  UPDATE public.foreman_daily_duty_snapshots s
  SET foreman_name = v_den_username
  WHERE (
      regexp_replace(COALESCE(s.project_name, ''), '\s+', '', 'g') = 'ไอลิน3'
      OR s.plot_id IN (
        SELECT p.id
        FROM public.plots p
        WHERE regexp_replace(COALESCE(p.project_name, ''), '\s+', '', 'g') = 'ไอลิน3'
      )
    )
    AND (
      s.foreman_name IS NULL
      OR trim(s.foreman_name) = ''
      OR trim(s.foreman_name) IN ('ยังไม่ระบุโฟร์แมน', 'ยังไม่ระบุ', '-')
      OR lower(trim(s.foreman_name)) IN ('unassigned', 'den')
    );

  -- --------------------------------------------------------------------------
  -- ส่วนที่ B: ปรับเฉพาะ "งานตรวจรับมอบบ้าน" ของ ไอลิน 4 ที่ตกเป็น Auen -> DEN
  -- * คง plots.foreman_name = 'Auen' และงานก่อสร้างของ Auen ไว้เหมือนเดิมทั้งหมด *
  -- --------------------------------------------------------------------------
  WITH target_ailin4_handover_plots AS (
    SELECT DISTINCT p.id
    FROM public.plots p
    JOIN public.defects d
      ON d.plot_id = p.id
     AND d.defect_stage = 'handover'
    WHERE regexp_replace(COALESCE(p.project_name, ''), '\s+', '', 'g') = 'ไอลิน4'
      AND (
        lower(trim(COALESCE(p.foreman_name, ''))) = 'auen'
        OR lower(trim(COALESCE(p.handover_foreman_name, ''))) IN ('auen', 'den')
      )
  )
  UPDATE public.plots p
  SET
    handover_foreman_name = v_den_username,
    handover_foreman_assigned_at = NULL
  FROM target_ailin4_handover_plots t
  WHERE p.id = t.id
    AND (
      p.handover_foreman_name IS NULL
      OR trim(p.handover_foreman_name) = ''
      OR trim(p.handover_foreman_name) IN ('ยังไม่ระบุโฟร์แมน', 'ยังไม่ระบุ', '-')
      OR lower(trim(p.handover_foreman_name)) IN ('unassigned', 'auen', 'den')
    );

  -- อัปเดตเฉพาะ Defect ขั้นตรวจรับมอบบ้าน (defect_stage = 'handover') บนแปลงเป้าหมาย
  UPDATE public.defects d
  SET foreman_name = v_den_username
  WHERE d.defect_stage = 'handover'
    AND d.plot_id IN (
      SELECT DISTINCT p.id
      FROM public.plots p
      WHERE regexp_replace(COALESCE(p.project_name, ''), '\s+', '', 'g') = 'ไอลิน4'
        AND (
          lower(trim(COALESCE(p.foreman_name, ''))) = 'auen'
          OR lower(trim(COALESCE(p.handover_foreman_name, ''))) = lower(v_den_username)
        )
    )
    AND (
      d.foreman_name IS NULL
      OR trim(d.foreman_name) = ''
      OR trim(d.foreman_name) IN ('ยังไม่ระบุโฟร์แมน', 'ยังไม่ระบุ', '-')
      OR lower(trim(d.foreman_name)) IN ('unassigned', 'auen', 'den')
    );

  -- อัปเดตเฉพาะ snapshot งานตรวจรับบ้าน (task_template_id LIKE 'handover:%') บนแปลงเป้าหมาย
  UPDATE public.foreman_daily_duty_snapshots s
  SET foreman_name = v_den_username
  WHERE s.task_template_id LIKE 'handover:%'
    AND s.plot_id IN (
      SELECT DISTINCT p.id
      FROM public.plots p
      JOIN public.defects d
        ON d.plot_id = p.id
       AND d.defect_stage = 'handover'
      WHERE regexp_replace(COALESCE(p.project_name, ''), '\s+', '', 'g') = 'ไอลิน4'
        AND (
          lower(trim(COALESCE(p.foreman_name, ''))) = 'auen'
          OR lower(trim(COALESCE(p.handover_foreman_name, ''))) = lower(v_den_username)
        )
    )
    AND (
      s.foreman_name IS NULL
      OR trim(s.foreman_name) = ''
      OR trim(s.foreman_name) IN ('ยังไม่ระบุโฟร์แมน', 'ยังไม่ระบุ', '-')
      OR lower(trim(s.foreman_name)) IN ('unassigned', 'auen', 'den')
    );

  RAISE NOTICE 'Backfill completed cleanly using foreman username: %', v_den_username;
END $$;

COMMIT;
