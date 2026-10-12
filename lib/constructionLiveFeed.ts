type FeedTimestamp = string | number | Date | null | undefined;

export interface ConstructionFeedTask {
  id?: unknown;
  task_name?: string | null;
}

export interface ConstructionFeedUpdate extends Record<string, unknown> {
  id?: unknown;
  task_template_id?: unknown;
  created_at?: FeedTimestamp;
  is_silent?: unknown;
  action?: unknown;
  is_handover?: unknown;
}

export interface ConstructionFeedDefect {
  id?: unknown;
  plot_id?: unknown;
  task_template_id?: unknown;
  task_id?: unknown;
  contractor_id?: unknown;
  description?: string | null;
  inspection_round?: unknown;
  handover_cycle?: unknown;
  reported_by?: string | null;
  reporter_name?: string | null;
  progress?: unknown;
  image_url?: unknown;
  created_at?: FeedTimestamp;
  defect_stage?: string | null;
}

export interface ConstructionFeedDefectUpdate {
  id?: unknown;
  defect_id?: unknown;
  created_by?: string | null;
  progress?: unknown;
  note?: string | null;
  image_urls?: unknown;
  created_at?: FeedTimestamp;
}

export interface ConstructionFeedContractor {
  id?: unknown;
  name?: string | null;
}

export interface ConstructionFeedPlot {
  id?: unknown;
  handover_status?: string | null;
  handover_completed_at?: FeedTimestamp;
  handover_completed_by?: string | null;
  inspection_round?: unknown;
}

export interface ConstructionLiveFeedInput {
  allUpdatesRecord?: readonly ConstructionFeedUpdate[] | null;
  taskTemplates?: readonly ConstructionFeedTask[] | null;
  defectUpdates?: readonly ConstructionFeedDefectUpdate[] | null;
  defects?: readonly ConstructionFeedDefect[] | null;
  contractors?: readonly ConstructionFeedContractor[] | null;
  plots?: readonly ConstructionFeedPlot[] | null;
}

export interface ConstructionLiveFeedItem extends Record<string, unknown> {
  id?: unknown;
  created_at?: FeedTimestamp;
  task_name?: unknown;
  is_handover: boolean;
  feed_category: 'handover' | 'construction';
}

function firstStrictBy<T>(rows: readonly T[], keyOf: (row: T) => unknown): Map<unknown, T> {
  const result = new Map<unknown, T>();
  for (const row of rows) {
    const key = keyOf(row);
    // Array.find with === never matches NaN, unlike Map's SameValueZero comparison.
    if (typeof key === 'number' && Number.isNaN(key)) continue;
    if (!result.has(key)) result.set(key, row);
  }
  return result;
}

/** Build only while the feed is used; preserve source order for equal/invalid timestamps. */
export function buildConstructionLiveFeed({
  allUpdatesRecord = [], taskTemplates = [], defectUpdates = [], defects = [], contractors = [], plots = [],
}: ConstructionLiveFeedInput): ConstructionLiveFeedItem[] {
  const tasksById = firstStrictBy(taskTemplates || [], task => task.id);
  const defectsById = firstStrictBy(defects || [], defect => defect.id);
  const contractorsById = firstStrictBy(contractors || [], contractor => String(contractor.id));
  const items: ConstructionLiveFeedItem[] = [];

  for (const update of allUpdatesRecord || []) {
    if (update.is_silent) continue;
    const task = tasksById.get(update.task_template_id);
    const isHandover = Boolean((task?.task_name && task.task_name.includes('ตรวจรับ'))
      || (typeof update.action === 'string' && update.action.includes('ตรวจรับ')) || update.is_handover);
    items.push({
      ...update,
      id: update.id,
      task_name: task ? task.task_name : (update.action || 'งานก่อสร้าง'),
      is_handover: isHandover,
      feed_category: isHandover ? 'handover' : 'construction',
    });
  }

  for (const update of defectUpdates || []) {
    const defect = defectsById.get(update.defect_id);
    if (!defect) continue;
    const taskId = defect.task_template_id || defect.task_id;
    const task = tasksById.get(taskId);
    const contractor = contractorsById.get(String(defect.contractor_id));
    const isCompleted = update.progress === 100;
    items.push({
      id: `defect-upd-${update.id}`,
      defect,
      plot_id: defect.plot_id,
      task_template_id: taskId,
      task_name: defect.description || task?.task_name || 'งานแก้ไขตรวจรับมอบบ้าน',
      user_name: update.created_by || 'ช่างผู้รับเหมา',
      role: update.created_by && update.created_by.includes('QC') ? 'QC'
        : (update.created_by && update.created_by.includes('Foreman') ? 'Foreman' : 'ช่างซ่อม/ผู้รับเหมา'),
      action: isCompleted ? 'แก้ไข Defect เสร็จสิ้น 100%' : `อัปเดตงานแก้ไข Defect (${update.progress}%)`,
      text_content: update.note || `อัปเดตความคืบหน้า ${update.progress}%`,
      progress: update.progress || 0,
      is_completed: isCompleted,
      image_url: update.image_urls,
      created_at: update.created_at,
      is_handover: true,
      handover_round: defect.inspection_round,
      handover_cycle: defect.handover_cycle,
      defect_description: defect.description,
      contractor_name: contractor ? contractor.name : null,
      feed_category: 'handover',
    });
  }

  for (const defect of defects || []) {
    if (defect.defect_stage !== 'handover') continue;
    const taskId = defect.task_template_id || defect.task_id;
    const task = tasksById.get(taskId);
    const contractor = contractorsById.get(String(defect.contractor_id));
    items.push({
      id: `defect-init-${defect.id}`,
      defect,
      plot_id: defect.plot_id,
      task_template_id: taskId,
      task_name: defect.description || task?.task_name || 'แจ้งรายการตรวจรับมอบบ้าน',
      user_name: defect.reported_by || defect.reporter_name || 'ผู้ตรวจรับมอบบ้าน',
      role: 'ตรวจรับมอบบ้าน',
      action: `บันทึกรายการตรวจรับบ้าน (รอบที่ ${defect.inspection_round || 1})`,
      text_content: defect.description || 'พบรายการที่ต้องแก้ไขในการตรวจรับมอบบ้าน',
      progress: defect.progress || 0,
      is_completed: defect.progress === 100,
      image_url: defect.image_url,
      created_at: defect.created_at,
      is_handover: true,
      handover_round: defect.inspection_round,
      handover_cycle: defect.handover_cycle,
      contractor_name: contractor ? contractor.name : null,
      feed_category: 'handover',
    });
  }

  for (const plot of plots || []) {
    if (plot.handover_status !== 'completed' || !plot.handover_completed_at) continue;
    items.push({
      id: `plot-handover-done-${plot.id}`,
      plot_id: plot.id,
      task_name: 'ตรวจรับมอบบ้านสำเร็จสมบูรณ์',
      user_name: plot.handover_completed_by || 'Admin',
      role: 'ผู้มีอำนาจอนุมัติ',
      action: '🏆 อนุมัติผ่านและปิดการตรวจรับมอบบ้าน',
      text_content: `แปลง ${plot.id} ผ่านการตรวจรับมอบบ้านเรียบร้อยแล้วทุกรายการ ส่งมอบบ้านสำเร็จ`,
      progress: 100,
      is_completed: true,
      created_at: plot.handover_completed_at,
      is_handover: true,
      is_handover_completed: true,
      handover_round: plot.inspection_round,
      feed_category: 'handover',
    });
  }
  return items.sort((a, b) => new Date(b.created_at as string).getTime() - new Date(a.created_at as string).getTime());
}
