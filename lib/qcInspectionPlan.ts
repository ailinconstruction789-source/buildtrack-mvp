import { normalizeDateStr } from './foremanDuty';

export type QCWorkloadCategory = 'hold_point' | 'system' | 'architectural' | 'minor';

export interface QCInspectionTaskItem {
  id: string;
  plot_id: string;
  plot_name: string;
  project_name: string;
  task_template_id: string;
  task_name: string;
  task_order?: number;
  cost?: number;
  foreman_name?: string;
  se_submitted_at: string; // ISO string
  se_user_name?: string;
  is_urgent?: boolean;
  is_rejected?: boolean;

  // Weighted score & classification
  weight_score: number; // 1 to 5 points
  category: QCWorkloadCategory;
  category_label: string;
  is_hold_point: boolean;
  is_late_handoff: boolean; // Submitted after cut-off time (e.g. 17:00)
  target_inspection_date: string; // YYYY-MM-DD
  se_handoff_time_str: string;
}

export interface QCDailyPlanSummary {
  targetDate: string; // YYYY-MM-DD
  targetDateLabel: string;
  totalTasks: number;
  totalPoints: number;
  holdPointsCount: number;
  lateHandoffCount: number;
  reworkCount: number;
  tasks: QCInspectionTaskItem[];
  byCategory: Record<QCWorkloadCategory, { count: number; points: number }>;
  byProject: Record<string, { count: number; points: number }>;
}

export interface BuildQCPlanOptions {
  inspectionQueue: any[]; // Items from vw_inspection_queue
  taskTemplates?: any[];
  plots?: any[];
  todayDateStr?: string; // YYYY-MM-DD override for testing
  cutOffHour?: number; // e.g. 17 (17:00)
  targetForeman?: string;
  targetProject?: string;
  weightsMap?: Map<string, { weight_score: number; is_hold_point: boolean; scope_description?: string }>;
}

// Keyword classifications for Thai construction terminology
const HOLD_POINT_KEYWORDS = [
  'ฐานราก', 'เสาเข็ม', 'งานโครงสร้าง', 'เสา', 'คาน', 'เทปูน', 'เทคอนกรีต',
  'ผูกเหล็ก', 'คอดิน', 'พื้นคอนกรีต', 'บันไดคอนกรีต', 'หลังคา', 'โครงหลังคา'
];

const SYSTEM_KEYWORDS = [
  'ท่อ', 'ร้อยสาย', 'สายไฟ', 'สุขาภิบาล', 'ไฟฟ้า', 'ประปา', 'กันซึม',
  'บ่อเกรอะ', 'ถังบำบัด', 'เดินสาย', 'แอร์', 'เมนไฟ'
];

const MINOR_KEYWORDS = [
  'ทำความสะอาด', 'เก็บกวาด', 'ปูหญ้า', 'จัดสวน', 'เคลียร์พื้นที่', 'เศษวัสดุ'
];

/**
 * Calculates the weighted inspection effort points (1 - 5 pts) and category
 * based on task name, keywords, and construction impact.
 */
export function calculateQCWorkloadWeight(taskName: string = '', cost: number = 0): {
  weight_score: number;
  category: QCWorkloadCategory;
  category_label: string;
  is_hold_point: boolean;
} {
  const name = taskName.trim().toLowerCase();

  // 1. Hold Point / Structural (3 - 5 pts)
  const isHoldPoint = HOLD_POINT_KEYWORDS.some(kw => name.includes(kw.toLowerCase()));
  if (isHoldPoint) {
    // High-impact structural elements get 5 pts, roof/subs get 4
    const isCriticalConcrete = name.includes('ฐานราก') || name.includes('เสา') || name.includes('คาน') || name.includes('เทคอนกรีต');
    const score = isCriticalConcrete ? 5 : 4;
    return {
      weight_score: score,
      category: 'hold_point',
      category_label: 'งานโครงสร้าง / Hold Point',
      is_hold_point: true,
    };
  }

  // 2. Systems / Concealed (3 pts)
  const isSystem = SYSTEM_KEYWORDS.some(kw => name.includes(kw.toLowerCase()));
  if (isSystem) {
    return {
      weight_score: 3,
      category: 'system',
      category_label: 'งานระบบ / ปิดทับ (MEP)',
      is_hold_point: false,
    };
  }

  // 3. Minor / Cleanup (1 pt)
  const isMinor = MINOR_KEYWORDS.some(kw => name.includes(kw.toLowerCase()));
  if (isMinor) {
    return {
      weight_score: 1,
      category: 'minor',
      category_label: 'งานเก็บกวาด / ย่อย',
      is_hold_point: false,
    };
  }

  // 4. Default: Architectural / Finishing (2 pts)
  return {
    weight_score: 2,
    category: 'architectural',
    category_label: 'งานสถาปัตย์ / ตกแต่ง',
    is_hold_point: false,
  };
}

/**
 * Checks whether a given timestamp in Asia/Bangkok is after the cut-off hour (default 17:00).
 */
export function isSubmissionAfterCutoff(isoTimestamp: string, cutOffHour: number = 17): boolean {
  if (!isoTimestamp) return false;
  const d = new Date(isoTimestamp);
  if (isNaN(d.getTime())) return false;

  // Convert to Bangkok hour (+07:00)
  const utcHours = d.getUTCHours();
  const bkkHour = (utcHours + 7) % 24;
  const bkkMinutes = d.getUTCMinutes();

  if (bkkHour > cutOffHour) return true;
  if (bkkHour === cutOffHour && bkkMinutes > 0) return true;
  return false;
}

/**
 * Computes next calendar day string (YYYY-MM-DD) from a given YYYY-MM-DD date.
 */
export function getNextDateStr(dateStr: string, daysAhead: number = 1): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + daysAhead);
  return d.toISOString().split('T')[0];
}

/**
 * Core Algorithm: Builds QC Daily Inspection Plan from current inspection queue.
 * Strictly respects:
 * 1. Excludes 'Admin Demo Project' and demo tasks.
 * 2. Only includes tasks waiting for QC (statusFor === 'QC').
 * 3. Schedules tasks submitted today before cut-off as tomorrow's plan.
 * 4. Schedules tasks submitted after cut-off as next-day queue (Late handoff).
 * 5. Orders by Hold Point first, then FIFO by SE submission time.
 */
export function buildQCDailyInspectionPlan(options: BuildQCPlanOptions): QCDailyPlanSummary {
  const {
    inspectionQueue = [],
    taskTemplates = [],
    plots = [],
    todayDateStr,
    cutOffHour = 17,
    targetProject,
    weightsMap,
  } = options;

  const bkkToday = todayDateStr || normalizeDateStr(new Date()) || new Date().toISOString().split('T')[0];
  const targetTomorrow = getNextDateStr(bkkToday, 1);

  // Fast index of templates by ID
  const templateMap = new Map<string, any>();
  taskTemplates.forEach(t => {
    if (t?.id) templateMap.set(String(t.id), t);
  });

  // Fast index of plots by ID
  const plotMap = new Map<string, any>();
  plots.forEach(p => {
    if (p?.id) plotMap.set(String(p.id), p);
  });

  const validItems: QCInspectionTaskItem[] = [];

  inspectionQueue.forEach((q: any) => {
    // 1. Rule: Filter out Demo Project
    const projName = String(q.project_name || q.projectName || '').trim();
    if (projName.toLowerCase().includes('demo') || projName === 'Admin Demo Project') {
      return;
    }

    // Optional project scope filter
    if (targetProject && targetProject !== 'all' && projName.toLowerCase() !== targetProject.toLowerCase()) {
      return;
    }

    // 2. Only items waiting for QC
    if (q.statusFor !== 'QC') {
      return;
    }

    const tpl = templateMap.get(String(q.task_template_id));
    const plot = plotMap.get(String(q.plot_id));

    const taskName = q.task_name || tpl?.task_name || 'งานก่อสร้าง';
    const cost = Number(tpl?.cost || q.cost || 0);
    const weightMeta = calculateQCWorkloadWeight(taskName, cost);

    // Apply configured weight override if available (Direct ID match or fallback by task name)
    let configuredWeight = weightsMap?.get(String(q.task_template_id));
    if (!configuredWeight && weightsMap && taskName) {
      const targetName = taskName.trim().toLowerCase();
      for (const [templateId, w] of weightsMap.entries()) {
        const tmpl = templateMap.get(templateId);
        if (tmpl && (tmpl.task_name || '').trim().toLowerCase() === targetName) {
          configuredWeight = w;
          break;
        }
      }
    }
    const finalWeightScore = configuredWeight ? configuredWeight.weight_score : weightMeta.weight_score;
    const finalIsHoldPoint = configuredWeight ? configuredWeight.is_hold_point : weightMeta.is_hold_point;

    const submittedAt = q.created_at || q.time || new Date().toISOString();
    const subDate = normalizeDateStr(submittedAt) || bkkToday;
    const isLate = isSubmissionAfterCutoff(submittedAt, cutOffHour);

    // Format submission time for display
    let seTimeStr = '-';
    try {
      const d = new Date(submittedAt);
      if (!isNaN(d.getTime())) {
        seTimeStr = d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
      }
    } catch {
      // ignore
    }

    // Target inspection date:
    // If submitted on or before today before cut-off -> target inspection is tomorrow (targetTomorrow)
    // If submitted today after cut-off -> target inspection is next business day (+2 days)
    let targetDate = targetTomorrow;
    if (subDate === bkkToday && isLate) {
      targetDate = getNextDateStr(bkkToday, 2);
    } else if (subDate < bkkToday) {
      // Historical submission still pending QC: urgent backlog on tomorrow's plan
      targetDate = targetTomorrow;
    }

    const item: QCInspectionTaskItem = {
      id: `${q.plot_id}_${q.task_template_id}`,
      plot_id: String(q.plot_id),
      plot_name: q.plot_name || plot?.plot_name || plot?.name || `แปลง ${q.plot_id}`,
      project_name: projName || 'โครงการก่อสร้าง',
      task_template_id: String(q.task_template_id),
      task_name: taskName,
      task_order: tpl?.task_order || q.task_order,
      cost,
      foreman_name: q.foreman || plot?.foreman_name || plot?.foreman,
      se_submitted_at: submittedAt,
      se_user_name: q.user_name || q.user,
      is_urgent: Boolean(q.isUrgent || q.is_urgent),
      is_rejected: Boolean(q.isRejected || q.is_rejected),
      weight_score: finalWeightScore,
      category: finalIsHoldPoint ? 'hold_point' : weightMeta.category,
      category_label: finalIsHoldPoint ? 'งานโครงสร้าง / Hold Point' : weightMeta.category_label,
      is_hold_point: finalIsHoldPoint,
      is_late_handoff: isLate,
      target_inspection_date: targetDate,
      se_handoff_time_str: seTimeStr,
    };

    validItems.push(item);
  });

  // Sort items:
  // 1. Hold points first (Priority 1)
  // 2. Urgent / Rework items next
  // 3. FIFO by SE submission time (earliest first)
  validItems.sort((a, b) => {
    if (a.is_hold_point !== b.is_hold_point) {
      return a.is_hold_point ? -1 : 1;
    }
    if (a.is_rejected !== b.is_rejected) {
      return a.is_rejected ? -1 : 1;
    }
    const ta = new Date(a.se_submitted_at).getTime() || 0;
    const tb = new Date(b.se_submitted_at).getTime() || 0;
    return ta - tb;
  });

  // Aggregate stats
  let totalPoints = 0;
  let holdPointsCount = 0;
  let lateHandoffCount = 0;
  let reworkCount = 0;

  const byCategory: Record<QCWorkloadCategory, { count: number; points: number }> = {
    hold_point: { count: 0, points: 0 },
    system: { count: 0, points: 0 },
    architectural: { count: 0, points: 0 },
    minor: { count: 0, points: 0 },
  };

  const byProject: Record<string, { count: number; points: number }> = {};

  validItems.forEach(item => {
    totalPoints += item.weight_score;
    if (item.is_hold_point) holdPointsCount++;
    if (item.is_late_handoff) lateHandoffCount++;
    if (item.is_rejected) reworkCount++;

    if (byCategory[item.category]) {
      byCategory[item.category].count++;
      byCategory[item.category].points += item.weight_score;
    }

    if (!byProject[item.project_name]) {
      byProject[item.project_name] = { count: 0, points: 0 };
    }
    byProject[item.project_name].count++;
    byProject[item.project_name].points += item.weight_score;
  });

  return {
    targetDate: targetTomorrow,
    targetDateLabel: `แผนตรวจวันพรุ่งนี้ (${targetTomorrow})`,
    totalTasks: validItems.length,
    totalPoints,
    holdPointsCount,
    lateHandoffCount,
    reworkCount,
    tasks: validItems,
    byCategory,
    byProject,
  };
}
