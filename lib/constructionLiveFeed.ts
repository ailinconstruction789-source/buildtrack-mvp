import { parseRoadblockDisplay } from './foremanDuty';
import { QCInspection } from '@/types/qc.types';
import { extractQCInspectionRefId } from '@/components/qc/QCInspectionInlineCard';

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
  action?: unknown;
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
  qcInspections?: readonly QCInspection[] | null;
}

export interface ConstructionLiveFeedItem extends Record<string, unknown> {
  id?: unknown;
  created_at?: FeedTimestamp;
  task_name?: unknown;
  is_handover: boolean;
  feed_category: 'handover' | 'construction';
  qc_inspection?: QCInspection | null;
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

export function isQCOrPEUpdateRow(update: Record<string, any>): boolean {
  const role = String(update?.role || '');
  const action = String(update?.action || '');
  const text = String(update?.text_content || '');
  if (role === 'Site Engineer' || action.startsWith('Site Engineer')) return false;
  return (
    role === 'QC' ||
    role === 'PE' ||
    role === 'Project Engineer' ||
    action.includes('QC') ||
    action.includes('PE อนุมัติ') ||
    action.includes('PE สั่งแก้') ||
    text.includes('แบบฟอร์มใหม่') ||
    Boolean(extractQCInspectionRefId(text))
  );
}

export function buildSyntheticUpdateFromQCInspection(insp: QCInspection, taskNameFallback?: string | null) {
  const isPassed = insp.inspection_result === 'passed';
  const isCond = insp.inspection_result === 'conditional';
  const isApproved = insp.document_status === 'approved';
  const isRejected = insp.document_status === 'rejected' || insp.inspection_result === 'failed';

  const action = isPassed
    ? 'QC อนุมัติ'
    : isCond
      ? (isApproved ? 'PE อนุมัติผ่านมีเงื่อนไข' : 'QC ส่งตรวจแบบมีเงื่อนไข (รอ PE อนุมัติ)')
      : 'QC แจ้งแก้ไข';

  const textContent = isPassed
    ? `ผ่านการตรวจ QC แบบฟอร์มใหม่ (${insp.form_title} v${insp.form_version || 1} - ผ่าน ${insp.passed_items}/${insp.total_items} ข้อ)`
    : isCond
      ? (isApproved
          ? `ผ่านการตรวจ QC แบบมีเงื่อนไข (อนุมัติโดยวิศวกรโครงการ ${insp.pe_reviewer_name || ''} - มีรายการส่งต่องานถัดไป)`
          : `ตรวจพบรายการผ่านแบบมีเงื่อนไข (${insp.conditional_items || 0} ข้อ) ส่งต่อให้วิศวกรโครงการ (PE) พิจารณาอนุมัติ`)
      : `ไม่ผ่านการตรวจ QC แบบฟอร์มใหม่ (${insp.form_title} v${insp.form_version || 1} - ไม่ผ่าน ${insp.failed_items} ข้อ)`;

  return {
    id: `qc-insp-${insp.id}`,
    plot_id: insp.plot_id,
    task_template_id: insp.task_template_id,
    task_name: insp.task_name || taskNameFallback || 'งานก่อสร้าง',
    user_name: insp.approved_by || insp.pe_reviewer_name || insp.inspector_name || 'QC',
    role: insp.pe_reviewer_name ? 'Project Engineer' : (insp.inspector_role || 'QC'),
    action,
    text_content: textContent,
    progress: isRejected ? 95 : 100,
    is_completed: isPassed || (isApproved && isCond),
    image_url: Array.isArray(insp.photo_urls) ? insp.photo_urls.join(',') : '',
    created_at: insp.approved_at || insp.pe_reviewed_at || insp.submitted_at || insp.updated_at || insp.created_at,
    qc_inspection: insp,
    is_synthetic_qc: true
  };
}

/**
 * จับคู่ประวัติ task_updates ของงานหนึ่งๆ กับรายการใบตรวจ qc_inspections (และสร้างรายการจำลองหากใบตรวจส่งแล้วแต่ยังไม่มี row ใน task_updates)
 */
export function mergeTaskUpdatesWithQCInspections(
  updates: readonly Record<string, any>[],
  qcInspections?: readonly QCInspection[] | null,
  taskNameFallback?: string | null
): Record<string, any>[] {
  const validInspections = (qcInspections || []).filter(i => i && i.document_status !== 'draft');
  if (validInspections.length === 0) return [...(updates || [])];

  const byId = new Map<string, QCInspection>();
  const sortedAsc = [...validInspections].sort((a, b) => (a.round_number || 1) - (b.round_number || 1));
  for (const insp of sortedAsc) {
    if (insp.id) byId.set(String(insp.id), insp);
  }

  const matchedIds = new Set<string>();
  let fallbackRoundCursor = 0;

  const enriched = (updates || []).map((upd) => {
    if (!isQCOrPEUpdateRow(upd)) return upd;

    const refId = extractQCInspectionRefId(upd.text_content);
    let matched: QCInspection | undefined = refId ? byId.get(refId) : undefined;

    if (!matched) {
      // จับคู่ตามลำดับรอบตรวจ หรือใช้รอบล่าสุด
      while (fallbackRoundCursor < sortedAsc.length && matchedIds.has(String(sortedAsc[fallbackRoundCursor].id))) {
        fallbackRoundCursor++;
      }
      matched = sortedAsc[fallbackRoundCursor] || sortedAsc[sortedAsc.length - 1];
    }

    if (matched) {
      matchedIds.add(String(matched.id));
      const mergedImageUrl =
        upd.image_url && String(upd.image_url).trim() !== ''
          ? upd.image_url
          : Array.isArray(matched.photo_urls) && matched.photo_urls.length > 0
            ? matched.photo_urls.join(',')
            : upd.image_url;
      return {
        ...upd,
        image_url: mergedImageUrl,
        qc_inspection: matched
      };
    }

    return upd;
  });

  // หากมีใบตรวจที่ส่งผลแล้ว (submitted / approved / pending_pe / rejected) แต่ยังไม่มีใน task_updates ให้แทรกตามเวลาจริง
  const unmatched = sortedAsc.filter(i => !matchedIds.has(String(i.id)));
  if (unmatched.length === 0) return enriched;

  const combined = [
    ...enriched,
    ...unmatched.map(insp => buildSyntheticUpdateFromQCInspection(insp, taskNameFallback))
  ];

  return combined.sort(
    (a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime()
  );
}

/** Build only while the feed is used; preserve source order for equal/invalid timestamps. */
export function buildConstructionLiveFeed({
  allUpdatesRecord = [], taskTemplates = [], defectUpdates = [], defects = [], contractors = [], plots = [], qcInspections = [],
}: ConstructionLiveFeedInput): ConstructionLiveFeedItem[] {
  const tasksById = firstStrictBy(taskTemplates || [], task => task.id);
  const defectsById = firstStrictBy(defects || [], defect => defect.id);
  const contractorsById = firstStrictBy(contractors || [], contractor => String(contractor.id));
  const items: ConstructionLiveFeedItem[] = [];

  const validQCInspections = (qcInspections || []).filter(i => i && i.document_status !== 'draft');
  const qcById = new Map<string, QCInspection>();
  const qcByPlotTask = new Map<string, QCInspection[]>();
  for (const insp of validQCInspections) {
    if (insp.id) qcById.set(String(insp.id), insp);
    const key = `${String(insp.plot_id).trim().toLowerCase()}::${String(insp.task_template_id).trim().toLowerCase()}`;
    const list = qcByPlotTask.get(key) || [];
    list.push(insp);
    qcByPlotTask.set(key, list);
  }
  for (const list of qcByPlotTask.values()) {
    list.sort((a, b) => (b.round_number || 1) - (a.round_number || 1));
  }
  const matchedQCInspectionIds = new Set<string>();

  for (const update of allUpdatesRecord || []) {
    if (update.is_silent) continue;
    const task = tasksById.get(update.task_template_id);
    const isHandover = Boolean((task?.task_name && task.task_name.includes('ตรวจรับ'))
      || (typeof update.action === 'string' && update.action.includes('ตรวจรับ')) || update.is_handover);

    let matchedQC: QCInspection | undefined;
    if (!isHandover && isQCOrPEUpdateRow(update)) {
      const refId = extractQCInspectionRefId(typeof update.text_content === 'string' ? update.text_content : null);
      if (refId && qcById.has(refId)) {
        matchedQC = qcById.get(refId);
      } else {
        const key = `${String(update.plot_id || '').trim().toLowerCase()}::${String(update.task_template_id || '').trim().toLowerCase()}`;
        const candidates = qcByPlotTask.get(key);
        if (candidates && candidates.length > 0) {
          matchedQC = candidates.find(c => !matchedQCInspectionIds.has(String(c.id))) || candidates[0];
        }
      }
      if (matchedQC?.id) {
        matchedQCInspectionIds.add(String(matchedQC.id));
      }
    }

    const mergedImageUrl =
      update.image_url && String(update.image_url).trim() !== ''
        ? update.image_url
        : matchedQC && Array.isArray(matchedQC.photo_urls) && matchedQC.photo_urls.length > 0
          ? matchedQC.photo_urls.join(',')
          : update.image_url;

    items.push({
      ...update,
      id: update.id,
      image_url: mergedImageUrl,
      task_name: task ? task.task_name : (update.action || 'งานก่อสร้าง'),
      is_handover: isHandover,
      feed_category: isHandover ? 'handover' : 'construction',
      ...(matchedQC ? { qc_inspection: matchedQC } : {}),
    });
  }

  for (const insp of validQCInspections) {
    if (matchedQCInspectionIds.has(String(insp.id))) continue;
    const task = tasksById.get(insp.task_template_id);
    const synth = buildSyntheticUpdateFromQCInspection(insp, task?.task_name);
    items.push({
      ...synth,
      is_handover: false,
      feed_category: 'construction',
    });
  }

  for (const update of defectUpdates || []) {
    const defect = defectsById.get(update.defect_id);
    if (!defect) continue;
    const taskId = defect.task_template_id || defect.task_id;
    const task = tasksById.get(taskId);
    const contractor = contractorsById.get(String(defect.contractor_id));
    const isCompleted = update.progress === 100;
    const roadblockInfo = parseRoadblockDisplay(
      typeof update.note === 'string' ? update.note : '',
      typeof update.action === 'string' ? update.action : ''
    );
    items.push({
      id: `defect-upd-${update.id}`,
      defect,
      plot_id: defect.plot_id,
      task_template_id: taskId,
      task_name: defect.description || task?.task_name || 'งานแก้ไขตรวจรับมอบบ้าน',
      user_name: update.created_by || 'ช่างผู้รับเหมา',
      role: update.created_by && update.created_by.includes('QC') ? 'QC'
        : (roadblockInfo || (update.created_by && update.created_by.includes('Foreman')) ? 'Foreman' : 'ช่างซ่อม/ผู้รับเหมา'),
      action: roadblockInfo
        ? `แจ้งติดปัญหา: ${roadblockInfo.reasonLabel}`
        : (isCompleted ? 'แก้ไข Defect เสร็จสิ้น 100%' : `อัปเดตงานแก้ไข Defect (${update.progress}%)`),
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
