// ==============================================================================
// 📋 BUILDTRACK: QC AUDIT ANALYTICS & CALENDAR SERVICE (PHASE 4)
// lib/qc/qcAuditAnalyticsService.ts
// ==============================================================================

import { supabase } from '@/lib/supabase';
import {
  type QCPlanItem,
  type QCTaskWeight,
} from './qcInspectionPlanService';
import {
  type QCLeaveRequest,
  checkInspectorLeaveOverlap,
} from './qcLeaveAndStandInService';

export type QCDayStatus =
  | 'completed' // 100% completed
  | 'partial' // partially completed or deferred
  | 'on_leave' // inspector on approved leave
  | 'waiting_inspector' // tasks waiting for assignment
  | 'has_backlog' // overdue backlog
  | 'rest_day'; // Sunday / no planned tasks

export interface QCDayInspectionAudit {
  dateStr: string; // YYYY-MM-DD
  dayNumber: number;
  dayOfWeek: number; // 0 = Sunday
  status: QCDayStatus;
  statusLabel: string;
  statusColorClass: string;

  // Points & Metrics
  totalPlannedPoints: number;
  totalCompletedPoints: number;
  totalDeferredPoints: number;
  totalTasksCount: number;
  completedTasksCount: number;
  deferredTasksCount: number;
  holdPointsCount: number;
  lateHandoffCount: number;
  cannotInspectCount: number;
  standInCount: number;

  // Details
  isOnLeave: boolean;
  leaveSummary?: string;
  inspectors: Array<{
    username: string;
    plannedPoints: number;
    completedPoints: number;
    tasksCount: number;
    isOnLeave: boolean;
    isOverloaded: boolean; // > 12 points
  }>;
  tasks: QCPlanItem[];
}

export interface QCMonthlyAuditSummary {
  year: number;
  month: number; // 1 - 12
  monthLabel: string;
  totalDaysInMonth: number;
  workingDaysCount: number;

  // Monthly Rollup Metrics
  totalBaselinePlannedPoints: number;
  totalCompletedPoints: number;
  totalDeferredPoints: number;
  clearanceRatePct: number; // completed / planned * 100

  // Category counts
  daysCompletedCount: number;
  daysPartialCount: number;
  daysLeaveCount: number;
  daysWaitingCount: number;
  daysRestCount: number;

  // Special Indicators
  holdPointTotal: number;
  holdPointOnTimeCount: number;
  holdPointOnTimePct: number;
  lateHandoffTotal: number; // SE sent after 17:00
  cannotInspectTotal: number; // Site blocked / unready
  standInTasksTotal: number; // Handed over to stand-ins
  overloadedDaysTotal: number; // Days where an inspector had > 12 pts

  // Days list for calendar
  days: QCDayInspectionAudit[];
}

export interface MetricFormulaInfo {
  metricName: string;
  title: string;
  formulaDescription: string;
  numeratorDescription: string;
  denominatorDescription: string;
  exclusionsDescription: string;
  fairnessNote: string;
}

const THAI_MONTH_NAMES = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
];

/**
 * 1. Build Monthly QC Inspection Audit Calendar & Metrics
 */
export function buildQCMonthlyAuditCalendar(params: {
  year: number;
  month: number; // 1 - 12
  planItems: QCPlanItem[];
  leaves?: QCLeaveRequest[];
  targetInspector?: string;
  targetProject?: string;
  dailyOverloadThreshold?: number;
}): QCMonthlyAuditSummary {
  const {
    year,
    month,
    planItems = [],
    leaves = [],
    targetInspector,
    targetProject,
    dailyOverloadThreshold = 12,
  } = params;

  // Filter items (Exclude Admin Demo Project)
  const validItems = planItems.filter(item => {
    const proj = (item.project_name || '').toLowerCase();
    if (proj.includes('demo') || proj === 'admin demo project') return false;
    if (targetProject && targetProject !== 'all' && (item.project_name || '').toLowerCase() !== targetProject.toLowerCase()) {
      return false;
    }
    if (targetInspector && targetInspector !== 'all') {
      const matchAssignee = (item.assigned_inspector_username || '').toLowerCase() === targetInspector.toLowerCase();
      const matchActual = (item.actual_inspector_username || '').toLowerCase() === targetInspector.toLowerCase();
      if (!matchAssignee && !matchActual) return false;
    }
    return true;
  });

  // Calculate days in month
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const daysList: QCDayInspectionAudit[] = [];

  let totalBaselinePlannedPoints = 0;
  let totalCompletedPoints = 0;
  let totalDeferredPoints = 0;

  let daysCompletedCount = 0;
  let daysPartialCount = 0;
  let daysLeaveCount = 0;
  let daysWaitingCount = 0;
  let daysRestCount = 0;

  let holdPointTotal = 0;
  let holdPointOnTimeCount = 0;
  let lateHandoffTotal = 0;
  let cannotInspectTotal = 0;
  let standInTasksTotal = 0;
  let overloadedDaysTotal = 0;
  let workingDaysCount = 0;

  for (let dayNum = 1; dayNum <= daysInMonth; dayNum++) {
    const dStr = `${year}-${String(month).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
    const dateObj = new Date(`${dStr}T12:00:00Z`);
    const dayOfWeek = dateObj.getUTCDay(); // 0 = Sunday
    const isSunday = dayOfWeek === 0;

    if (!isSunday) {
      workingDaysCount++;
    }

    // Tasks scheduled on this day
    const dayTasks = validItems.filter(it => it.due_date === dStr || it.original_plan_date === dStr);

    let dayPlannedPts = 0;
    let dayCompletedPts = 0;
    let dayDeferredPts = 0;
    let dayHoldPtsCount = 0;
    let dayLateHandoffCount = 0;
    let dayCannotInspectCount = 0;
    let dayStandInCount = 0;
    let dayCompletedTasks = 0;
    let dayDeferredTasks = 0;

    // Inspector workload grouping
    const inspectorWorkloads = new Map<string, { planned: number; completed: number; count: number }>();

    dayTasks.forEach(task => {
      const w = task.snapshot_weight_score || 0;
      dayPlannedPts += w;

      if (task.snapshot_is_hold_point) {
        dayHoldPtsCount++;
        holdPointTotal++;
        if (task.execution_status === 'passed' || task.execution_status === 'failed') {
          holdPointOnTimeCount++;
        }
      }

      if (task.is_late_handoff) {
        dayLateHandoffCount++;
        lateHandoffTotal++;
      }

      if ((task as any).is_stand_in) {
        dayStandInCount++;
        standInTasksTotal++;
      }

      if (task.execution_status === 'cannot_inspect') {
        dayCannotInspectCount++;
        cannotInspectTotal++;
      }

      if (task.execution_status === 'passed' || task.execution_status === 'failed') {
        dayCompletedPts += task.earned_points;
        dayCompletedTasks++;
      } else if (task.plan_status === 'deferred') {
        dayDeferredPts += w;
        dayDeferredTasks++;
      }

      const inspName = task.assigned_inspector_username || task.actual_inspector_username || 'Unassigned';
      if (!inspectorWorkloads.has(inspName)) {
        inspectorWorkloads.set(inspName, { planned: 0, completed: 0, count: 0 });
      }
      const cur = inspectorWorkloads.get(inspName)!;
      cur.planned += w;
      cur.completed += task.earned_points;
      cur.count++;
    });

    totalBaselinePlannedPoints += dayPlannedPts;
    totalCompletedPoints += dayCompletedPts;
    totalDeferredPoints += dayDeferredPts;

    // Check Leave status for this day
    let isOnLeave = false;
    let leaveSummary = '';
    if (targetInspector && targetInspector !== 'all') {
      const lCheck = checkInspectorLeaveOverlap(targetInspector, dStr, leaves);
      if (lCheck.isOnLeave) {
        isOnLeave = true;
        leaveSummary = lCheck.leave?.reason || (lCheck.capacityFactor === 0 ? 'ลาเต็มวัน' : 'ลาบางช่วงเวลา');
      }
    } else {
      // General check: any approved leave on this day
      const dayLeaves = leaves.filter(l => l.status === 'approved' && dStr >= l.start_date && dStr <= l.end_date);
      if (dayLeaves.length > 0) {
        isOnLeave = true;
        leaveSummary = `มีผู้ลา ${dayLeaves.length} ท่าน (${dayLeaves.map(l => l.applicant_username).join(', ')})`;
      }
    }

    // Build inspector detail list & check overload
    let hasOverload = false;
    const inspectorsList: QCDayInspectionAudit['inspectors'] = [];
    inspectorWorkloads.forEach((v, k) => {
      const isOvl = v.planned > dailyOverloadThreshold;
      if (isOvl) hasOverload = true;
      const lk = checkInspectorLeaveOverlap(k, dStr, leaves);
      inspectorsList.push({
        username: k,
        plannedPoints: v.planned,
        completedPoints: v.completed,
        tasksCount: v.count,
        isOnLeave: lk.isOnLeave,
        isOverloaded: isOvl,
      });
    });

    if (hasOverload) {
      overloadedDaysTotal++;
    }

    // Determine Day Status & Color
    let status: QCDayStatus = 'rest_day';
    let statusLabel = 'ไม่มีงานตามแผน';
    let statusColorClass = 'bg-slate-50 border-slate-200 text-slate-500';

    if (isOnLeave && dayTasks.length === 0) {
      status = 'on_leave';
      statusLabel = leaveSummary || 'วันลาพัก';
      statusColorClass = 'bg-blue-50 border-blue-200 text-blue-700';
      daysLeaveCount++;
    } else if (dayTasks.length === 0) {
      status = 'rest_day';
      statusLabel = isSunday ? 'วันหยุดประจำสัปดาห์' : 'ไม่มีงานตามแผน';
      statusColorClass = 'bg-slate-50 border-slate-200 text-slate-400';
      daysRestCount++;
    } else {
      const unassignedTasks = dayTasks.filter(t => !t.assigned_inspector_username);
      if (unassignedTasks.length > 0 && dayCompletedTasks === 0) {
        status = 'waiting_inspector';
        statusLabel = `รอจัดผู้ตรวจ (${unassignedTasks.length} รายการ)`;
        statusColorClass = 'bg-orange-50 border-orange-300 text-orange-700';
        daysWaitingCount++;
      } else if (dayCompletedTasks === dayTasks.length && dayPlannedPts > 0) {
        status = 'completed';
        statusLabel = `ตรวจครบ 100% (${dayCompletedPts}/${dayPlannedPts} แต้ม)`;
        statusColorClass = 'bg-emerald-50 border-emerald-300 text-emerald-800';
        daysCompletedCount++;
      } else if (dayDeferredTasks > 0 || (dayCompletedPts > 0 && dayCompletedPts < dayPlannedPts)) {
        status = 'partial';
        statusLabel = `ตรวจ ${dayCompletedPts}/${dayPlannedPts} แต้ม (เลื่อน ${dayDeferredPts})`;
        statusColorClass = 'bg-amber-50 border-amber-300 text-amber-800';
        daysPartialCount++;
      } else {
        status = 'has_backlog';
        statusLabel = `งานค้างตรวจ (${dayTasks.length - dayCompletedTasks} รายการ)`;
        statusColorClass = 'bg-rose-50 border-rose-300 text-rose-700';
        daysPartialCount++;
      }
    }

    daysList.push({
      dateStr: dStr,
      dayNumber: dayNum,
      dayOfWeek,
      status,
      statusLabel,
      statusColorClass,
      totalPlannedPoints: dayPlannedPts,
      totalCompletedPoints: dayCompletedPts,
      totalDeferredPoints: dayDeferredPts,
      totalTasksCount: dayTasks.length,
      completedTasksCount: dayCompletedTasks,
      deferredTasksCount: dayDeferredTasks,
      holdPointsCount: dayHoldPtsCount,
      lateHandoffCount: dayLateHandoffCount,
      cannotInspectCount: dayCannotInspectCount,
      standInCount: dayStandInCount,
      isOnLeave,
      leaveSummary,
      inspectors: inspectorsList,
      tasks: dayTasks,
    });
  }

  const clearanceRatePct =
    totalBaselinePlannedPoints > 0
      ? Math.round((totalCompletedPoints / totalBaselinePlannedPoints) * 100)
      : 100;

  const holdPointOnTimePct =
    holdPointTotal > 0 ? Math.round((holdPointOnTimeCount / holdPointTotal) * 100) : 100;

  return {
    year,
    month,
    monthLabel: `${THAI_MONTH_NAMES[month - 1]} ${year + 543}`,
    totalDaysInMonth: daysInMonth,
    workingDaysCount,
    totalBaselinePlannedPoints,
    totalCompletedPoints,
    totalDeferredPoints,
    clearanceRatePct,
    daysCompletedCount,
    daysPartialCount,
    daysLeaveCount,
    daysWaitingCount,
    daysRestCount,
    holdPointTotal,
    holdPointOnTimeCount,
    holdPointOnTimePct,
    lateHandoffTotal,
    cannotInspectTotal,
    standInTasksTotal,
    overloadedDaysTotal,
    days: daysList,
  };
}

/**
 * 2. Transparent Metric Formula & Explanations
 */
export function getQCMetricFormulaDetails(metricKey: string, customThreshold: number = 12): MetricFormulaInfo {
  const directory: Record<string, MetricFormulaInfo> = {
    clearance_rate: {
      metricName: 'Clearance Rate (อัตราการเคลียร์แต้มภาระงาน)',
      title: 'สูตรคำนวณอัตราความสำเร็จตามแผนงาน',
      formulaDescription: '(แต้มที่ตรวจเสร็จจริง ÷ แต้มแผนงานตั้งต้น) × 100',
      numeratorDescription: 'แต้มที่ตรวจเสร็จจริง (ได้ทั้ง Passed และ Failed/สั่งแก้ เพราะ QC เข้าตรวจจริง)',
      denominatorDescription: 'แต้มแผนตั้งต้นทั้งหมด (รวมแต้มงานที่เลื่อนตรวจ เพื่อคงตัวหารประวัติศาสตร์ ไม่ฟอกคะแนน)',
      exclusionsDescription: 'ไม่นำวันลาที่อนุมัติแล้ว และงานใน Admin Demo Project มารวมเป็นตัวหาร',
      fairnessNote: 'งานตรวจไม่ผ่าน (Failed) ได้คะแนนเต็มเท่ากับงานผ่าน เพื่อป้องกันไม่ให้ QC ปล่อยผ่านงานแย่เพียงเพื่อเร่งเปอร์เซ็นต์',
    },
    hold_point_ontime: {
      metricName: 'Hold Point On-Time Rate (งานวิกฤตตรวจทันเวลา)',
      title: 'ประสิทธิภาพการเข้าตรวจงานวิกฤต/เทคอนกรีต',
      formulaDescription: '(จำนวนงาน Hold Point ที่ตรวจทันเวลา ÷ งาน Hold Point ทั้งหมด) × 100',
      numeratorDescription: 'งานโครงสร้างหรือจุด Hold Point ที่ได้รับการตรวจภายในวันตามแผนหรือเวลานัดหมาย',
      denominatorDescription: 'งานโครงสร้าง/Hold Point ที่ SE ส่งตรวจและถึงกำหนดตรวจในรอบนั้น',
      exclusionsDescription: 'งานที่ส่งหลังเวลา Cut-off 17:00 น. จะถูกยกยอดไปรอบวันถัดไปโดยไม่คิดเป็นความล่าช้าของ QC',
      fairnessNote: 'เน้นป้องกันปัญหาคอนกรีตเซ็ตตัวและไซต์งานชะงัก โดยจัดลำดับให้งาน Hold Point อยู่บนสุดของคิวตรวจเสมอ',
    },
    overload_rate: {
      metricName: 'Workload Overload Monitoring (การตรวจจับภาระงานเกินกำลัง)',
      title: `เกณฑ์ความปลอดภัยของภาระงานรายวัน (> ${customThreshold} แต้ม)`,
      formulaDescription: `ผลรวมแต้มถ่วงน้ำหนักของงานตรวจที่มอบหมายในวันนั้น > ${customThreshold} แต้ม (กำหนดโดย Admin จากสถิติจันทร์–เสาร์)`,
      numeratorDescription: `จำนวนวันที่ QC มีแต้มงานตามแผนเกิน ${customThreshold} แต้ม/คน/วัน`,
      denominatorDescription: 'จำนวนวันทำงานทั้งหมดในเดือน',
      exclusionsDescription: 'วันหยุดวันอาทิตย์ และวันลาพักร้อนที่อนุมัติแล้ว',
      fairnessNote: 'หากเกิดงานค้างในวันที่ภาระงานเกินเกณฑ์ ระบบจะบันทึกว่าเป็นข้อจำกัดด้าน Capacity ของระบบ ไม่ใช่ความบกพร่องส่วนบุคคล',
    },
    se_handoff_integrity: {
      metricName: 'SE Handoff Integrity (การส่งมอบงานของ Site Engineer)',
      title: 'การวิเคราะห์คุณภาพและความตรงต่อเวลาในการส่งตรวจของ SE',
      formulaDescription: 'นับจำนวนงานที่ส่งหลัง Cut-off (17:00 น.) หรืองานที่หน้างานไม่พร้อมตรวจ',
      numeratorDescription: 'งานส่งหลัง 17:00 + งานที่ QC ไปถึงแล้วตรวจไม่ได้ (Cannot Inspect / ล็อกกุญแจ)',
      denominatorDescription: 'งานที่ SE ส่งตรวจทั้งหมดในรอบเดือน',
      exclusionsDescription: 'งานด่วนฉุกเฉินที่มีบันทึกอนุมัติ Fast-track จากผู้จัดการโครงการ',
      fairnessNote: 'ช่วยให้ผู้บริหารเห็นความจริงว่าความล่าช้าเกิดจาก SE ส่งงานช้า หรือเกิดจาก QC ตรวจไม่ทันอย่างแท้จริง',
    },
  };

  return directory[metricKey] || {
    metricName: metricKey,
    title: 'รายละเอียดเกณฑ์การวัดผล',
    formulaDescription: 'คำนวณตามมาตรฐานแต้มถ่วงน้ำหนัก 1-5 แต้ม',
    numeratorDescription: 'ผลรวมคะแนนจริง',
    denominatorDescription: 'แผนงานตั้งต้น',
    exclusionsDescription: 'ไม่รวมข้อมูล Demo',
    fairnessNote: 'ยึดหลักความโปร่งใสและตรวจสอบย้อนกลับได้ทุกรายการ',
  };
}
