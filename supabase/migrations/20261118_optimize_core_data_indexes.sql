-- ==============================================================================
-- ⚡ BUILDTRACK: OPTIMIZE CORE DATA QUERY PERFORMANCE (FIX STATEMENT TIMEOUT)
-- ==============================================================================
-- แก้ปัญหา "canceling statement due to statement timeout" ตอนโหลดข้อมูลหลัก
-- โดยเพิ่ม Index ให้คอลัมน์ที่ใช้ ORDER BY / WHERE / JOIN บ่อยใน fetchAllData
-- และรัน ANALYZE เพื่อให้ PostgreSQL Planner เลือกแผนการค้นหาที่เร็วที่สุด
-- ==============================================================================

-- 1. task_updates (26,000+ rows): เร่งความเร็ว ORDER BY created_at DESC LIMIT 1000
CREATE INDEX IF NOT EXISTS idx_task_updates_created_at_desc
  ON public.task_updates (created_at DESC);

-- เร่งความเร็ว View vw_qc_se_performance ที่กรองเฉพาะ action ที่เกี่ยวข้องกับการตรวจงาน
CREATE INDEX IF NOT EXISTS idx_task_updates_perf_action_created_at
  ON public.task_updates (action, created_at DESC)
  WHERE action IN (
    'ส่งงาน 100%',
    'Site Engineer อนุมัติ',
    'QC อนุมัติ',
    'QC ไม่อนุมัติ',
    'Site Engineer ไม่อนุมัติ'
  );

-- 2. plot_task_assignments (13,000+ rows): เร่งความเร็วการกรองตามแปลงและ View ความคืบหน้า
CREATE INDEX IF NOT EXISTS idx_plot_task_assignments_plot_task
  ON public.plot_task_assignments (plot_id, task_template_id);

CREATE INDEX IF NOT EXISTS idx_plot_task_assignments_progress_100
  ON public.plot_task_assignments (plot_id, task_template_id)
  WHERE current_progress = 100;

-- 3. plot_task_schedules: เร่งความเร็วการกรองตามแปลงและ View สถานะแผนงาน
CREATE INDEX IF NOT EXISTS idx_plot_task_schedules_plot_task
  ON public.plot_task_schedules (plot_id, task_template_id);

-- 4. notifications: เร่งความเร็วการดึงแจ้งเตือนตามผู้ใช้/ตำแหน่งแบบเรียงจากล่าสุด
CREATE INDEX IF NOT EXISTS idx_notifications_target_user_created
  ON public.notifications (target_user, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_target_role_created
  ON public.notifications (target_role, created_at DESC);

-- 5. defects & defect_updates: เร่งความเร็ว ORDER BY created_at DESC LIMIT 500
CREATE INDEX IF NOT EXISTS idx_defects_created_at_desc
  ON public.defects (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_defect_updates_created_at_desc
  ON public.defect_updates (created_at DESC);

-- 6. qc_inspections: เร่งความเร็ว Subquery EXISTS ใน vw_inspection_queue
CREATE INDEX IF NOT EXISTS idx_qc_inspections_pending_pe
  ON public.qc_inspections (plot_id, task_template_id)
  WHERE document_status = 'pending_pe';

-- 7. leads: เร่งความเร็ว ORDER BY created_at DESC
CREATE INDEX IF NOT EXISTS idx_leads_created_at_desc
  ON public.leads (created_at DESC);

-- 8. อัปเดตสถิติตารางให้ PostgreSQL Query Planner ใช้งาน Index ใหม่ทันที
ANALYZE public.task_updates;
ANALYZE public.plot_task_assignments;
ANALYZE public.plot_task_schedules;
ANALYZE public.notifications;
ANALYZE public.defects;
ANALYZE public.defect_updates;
ANALYZE public.qc_inspections;
ANALYZE public.leads;
ANALYZE public.plots;
