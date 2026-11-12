/**
 * Foreman Duty & Daily Work Dispatch Helper
 * 
 * Manages daily task schedules, point-in-time plan snapshots,
 * and inspection compliance for foremen.
 */

import { supabase } from './supabase';
import {
  resolveHandoverDefectForeman,
  isHandoverDefectCompleted,
  isUnassignedForemanName,
  canonicalizeForemanName,
} from './handoverForeman';

export const ROADBLOCK_REASONS = [
  {
    id: 'prior_task_delayed',
    label: 'งานก่อนหน้ายังไม่เสร็จ / เลื่อน',
    icon: '🔄',
    color: 'amber',
    description: 'งานขั้นตอนก่อนหน้านี้ยังดำเนินการไม่แล้วเสร็จ ทำให้ไม่สามารถเริ่มงานขั้นตอนนี้ได้',
  },
  {
    id: 'cannot_start',
    label: 'ยังไม่สามารถเริ่มงานได้',
    icon: '⏳',
    color: 'orange',
    description: 'หน้างานยังไม่พร้อมเริ่มงานตามแผน',
  },
  {
    id: 'material_issue',
    label: 'ติดปัญหาวัสดุ (ของขาด / จัดส่งล่าช้า)',
    icon: '🧱',
    color: 'rose',
    description: 'รอวัสดุเข้าหน้าไซต์ วัสดุไม่พอ หรือร้านค้าเลื่อนกำหนดส่ง',
  },
  {
    id: 'worker_issue',
    label: 'ติดปัญหาช่าง (ขาดช่าง / ช่างไม่เข้างาน)',
    icon: '👷',
    color: 'purple',
    description: 'ผู้รับเหมาหรือช่างไม่เข้าหน้างาน ช่างขาด หรือติดงานไซต์อื่น',
  },
  {
    id: 'weather_issue',
    label: 'ติดสภาพอากาศ / ฝนตก',
    icon: '🌧️',
    color: 'sky',
    description: 'ฝนตกหนัก น้ำท่วมขัง หรือสภาพอากาศไม่อำนวยต่อการทำงาน',
  },
  {
    id: 'other',
    label: 'อื่นๆ (ระบุในหมายเหตุ)',
    icon: '📝',
    color: 'slate',
    description: 'เหตุผลอื่นๆ นอกเหนือจากตัวเลือกข้างต้น',
  },
] as const;

export type RoadblockReasonId = (typeof ROADBLOCK_REASONS)[number]['id'];

export interface RoadblockReasonMeta {
  id: string;
  label: string;
  icon: string;
  color: string;
  description: string;
}

export function getRoadblockReason(reasonId?: string | null): RoadblockReasonMeta | null {
  if (!reasonId) return null;
  const match = ROADBLOCK_REASONS.find(r => r.id === reasonId || r.label === reasonId || reasonId.includes(r.label));
  if (match) return match;
  return {
    id: reasonId,
    label: reasonId,
    icon: '⚠️',
    color: 'slate',
    description: reasonId,
  };
}

const INTERNAL_REF_MARKER_REGEX = /\s*\[ref:[^\]]+\]/g;

/**
 * Removes internal deduplication markers (e.g. `[ref:sub_...]`) from text
 * before displaying to users while preserving stored DB values for idempotency.
 */
export function stripInternalRefMarkers(text?: string | null): string {
  if (!text) return '';
  return String(text).replace(INTERNAL_REF_MARKER_REGEX, '').trim();
}

export interface RoadblockDisplayInfo {
  reasonMeta: RoadblockReasonMeta;
  icon: string;
  reasonLabel: string;
  note: string;
  cleanText: string;
  formattedText: string;
}

function unwrapOuterParens(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('(') && trimmed.endsWith(')') && trimmed.length >= 2) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

/**
 * Parses a roadblock update's text/action into display-safe fields with its matching
 * reason icon from ROADBLOCK_REASONS and without internal `[ref:...]` markers.
 * Returns null for non-roadblock updates.
 */
export function parseRoadblockDisplay(
  text?: string | null,
  action?: string | null
): RoadblockDisplayInfo | null {
  const cleanText = stripInternalRefMarkers(text);
  const actionStr = String(action || '').trim();
  const isRoadblock =
    actionStr.startsWith('แจ้งติดปัญหา') ||
    actionStr.includes('ติดปัญหา') ||
    cleanText.startsWith('เหตุผล:');

  if (!isRoadblock) return null;

  const actionReason = actionStr.startsWith('แจ้งติดปัญหา:')
    ? actionStr.slice('แจ้งติดปัญหา:'.length).trim()
    : '';
  const textBody = cleanText.startsWith('เหตุผล:')
    ? cleanText.slice('เหตุผล:'.length).trim()
    : '';

  const exactFromAction = actionReason
    ? ROADBLOCK_REASONS.find(r => r.label === actionReason || r.id === actionReason)
    : undefined;
  const prefixFromText = textBody
    ? ROADBLOCK_REASONS.find(r => textBody.startsWith(r.label))
    : undefined;
  const fallbackMatch = ROADBLOCK_REASONS.find(
    r => actionStr.includes(r.label) || textBody.includes(r.label)
  );

  const matched = exactFromAction || prefixFromText || fallbackMatch;
  const reasonMeta: RoadblockReasonMeta = matched || {
    id: actionReason || textBody || 'other',
    label: actionReason || textBody || 'แจ้งติดปัญหา',
    icon: '⚠️',
    color: 'slate',
    description: actionReason || textBody || 'แจ้งติดปัญหา',
  };

  let reasonLabel = reasonMeta.label;
  let note = '';

  if (matched) {
    if (textBody.startsWith(matched.label)) {
      const remainder = textBody.slice(matched.label.length).trim();
      note = remainder ? unwrapOuterParens(remainder) : '';
    } else if (!textBody && cleanText) {
      note = cleanText;
    }
  } else if (actionReason && textBody.startsWith(actionReason)) {
    reasonLabel = actionReason;
    const remainder = textBody.slice(actionReason.length).trim();
    note = remainder ? unwrapOuterParens(remainder) : '';
  } else if (textBody) {
    reasonLabel = textBody;
  } else if (cleanText) {
    note = cleanText;
  }

  const formattedText = cleanText
    ? `${reasonMeta.icon} ${cleanText}`
    : `${reasonMeta.icon} เหตุผล: ${reasonLabel}`;

  return {
    reasonMeta,
    icon: reasonMeta.icon,
    reasonLabel,
    note,
    cleanText,
    formattedText,
  };
}

/**
 * Formats any task_updates `text_content` for UI display:
 * strips internal `[ref:...]` tags and prepends the matching roadblock icon when applicable.
 */
export function formatTaskUpdateDisplayText(
  text?: string | null,
  action?: string | null
): string {
  const roadblock = parseRoadblockDisplay(text, action);
  if (roadblock) return roadblock.formattedText;
  return stripInternalRefMarkers(text);
}

/**
 * Formats a roadblock `action` string with its matching icon if not already present.
 */
export function formatRoadblockActionLabel(
  action?: string | null,
  text?: string | null
): string {
  const actionStr = stripInternalRefMarkers(action);
  if (!actionStr) return '';
  const roadblock = parseRoadblockDisplay(text, actionStr);
  if (!roadblock || actionStr.startsWith(roadblock.icon)) return actionStr;
  return `${roadblock.icon} ${actionStr}`;
}

export interface LoadSnapshotResult {
  status: 'success' | 'empty' | 'cache_fallback' | 'error';
  storage: 'remote' | 'local_cache' | 'none';
  data: ForemanDailyTask[] | any[];
  error?: any;
}

export interface ForemanDailyTask {
  id: string; // `${plot_id}-${task_template_id}`
  plot_id: string;
  plot_name: string;
  project_name: string;
  house_type_id?: string;
  foreman_name: string;
  task_template_id: string | number;
  task_name: string;
  task_order?: number;
  planned_start: string; // YYYY-MM-DD
  planned_end: string;   // YYYY-MM-DD
  current_progress: number;
  contractor_name?: string;
  is_updated_today: boolean;
  last_updated_at?: string | null;
  last_action?: string | null;
  last_role?: string | null;
  status_reason?: string | null;
  status_note?: string | null;
  is_snapshot?: boolean;
  is_completed_early?: boolean;
  completion_date?: string | null;
  is_out_of_plan?: boolean;
  out_of_plan_badge?: string;
  is_handover?: boolean;
  defect_id?: string;
  handover_round?: number;
  defectObj?: any;
}

export interface ForemanDailySummary {
  totalTasks: number;
  updatedTasks: number;
  roadblockTasks: number;
  pendingTasks: number;
  complianceRate: number; // percentage (0-100)
  plotsCount: number;
  completedEarlyTasks?: number;
}

export interface GetForemanTasksOptions {
  plots: any[];
  taskTemplates: any[];
  schedules: Record<string, any>;
  assignments?: any[];
  allUpdatesRecord?: any[];
  defects?: any[];
  defectUpdates?: any[];
  contractors?: any[];
  foremenList?: any[];
  foremanName: string; // specific foreman username or 'all'
  targetDate: string;  // YYYY-MM-DD
  existingSnapshots?: any[];
  preIndexedUpdates?: Map<string, any[]>;
  preIndexedDefectUpdates?: Map<string, any[]>;
  todayDateStr?: string;
}

const BKK_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Bangkok',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

/**
 * Normalizes date input to YYYY-MM-DD format in Asia/Bangkok (+07:00) business timezone.
 * Date-only strings (YYYY-MM-DD) are preserved without timezone shifts.
 * ISO timestamp strings representing an instant in time (with 'T' and timezone or 'Z')
 * are converted to the business date in Asia/Bangkok (+07:00).
 */
export function normalizeDateStr(dateInput: any): string | null {
  if (!dateInput) return null;
  if (typeof dateInput === 'string') {
    const trimmed = dateInput.trim();
    if (!trimmed) return null;
    // 1. Date-only pattern YYYY-MM-DD: preserve as-is without timezone shifting
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return trimmed;
    }
    // 2. Timestamp with timezone (e.g. ISO 8601 with Z, +, or T)
    const d = new Date(trimmed);
    if (!isNaN(d.getTime())) {
      try {
        return BKK_FORMATTER.format(d);
      } catch {
        const utcMs = d.getTime() + 7 * 3600 * 1000;
        const bkk = new Date(utcMs);
        const y = bkk.getUTCFullYear();
        const m = String(bkk.getUTCMonth() + 1).padStart(2, '0');
        const day = String(bkk.getUTCDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
      }
    }
  }
  if (dateInput instanceof Date && !isNaN(dateInput.getTime())) {
    try {
      return BKK_FORMATTER.format(dateInput);
    } catch {
      const utcMs = dateInput.getTime() + 7 * 3600 * 1000;
      const bkk = new Date(utcMs);
      const y = bkk.getUTCFullYear();
      const m = String(bkk.getUTCMonth() + 1).padStart(2, '0');
      const day = String(bkk.getUTCDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    }
  }
  return null;
}

/**
 * Extracts effective foreman name for a plot.
 */
export function getPlotForemanName(plot: any): string {
  if (!plot) return '';
  return (plot.foreman_name || plot.foreman || '').trim();
}

/**
 * Checks whether a date falls on Sunday (dayOfWeek === 0),
 * which is the weekly holiday for foremen (วันหยุดประจำสัปดาห์).
 */
export function isForemanWeeklyHoliday(dateInput: any): boolean {
  const norm = normalizeDateStr(dateInput);
  if (!norm) return false;
  const parts = norm.split('-').map(Number);
  if (parts.length !== 3 || parts.some(n => Number.isNaN(n))) return false;
  const [year, month, day] = parts;
  return new Date(year, month - 1, day).getDay() === 0;
}

/**
 * Checks whether a construction task template should be excluded from planned
 * inspection schedules and compliance denominators (e.g. marked "ไม่นำมาคำนวณในแผนงาน",
 * assigned N/A exclusion for the plot, or globally excluded for the plot's house type).
 */
export function isTaskExcludedFromPlan(task: any, assign?: any, plot?: any): boolean {
  if (task?.is_progress_counted === false) return true;
  if (Boolean(assign?.is_excluded)) return true;
  const plotTypeName = String(plot?.house_types?.type_name || plot?.house_type_name || '').trim();
  if (
    plotTypeName &&
    Array.isArray(task?.excluded_house_types) &&
    task.excluded_house_types.some((ht: any) => String(ht).trim() === plotTypeName)
  ) {
    return true;
  }
  return false;
}

export const SNAPSHOT_DAY_LOCK_PLOT_ID = '__DAY_LOCK__';
export const SNAPSHOT_DAY_LOCK_TASK_PREFIX = '__FREEZE__';

/**
 * Identifies synthetic freeze-marker rows stored in foreman_daily_duty_snapshots
 * to lock completed past dates against retroactive schedule backdates/additions.
 */
export function isDayFreezeMarkerRow(snap: any): boolean {
  if (!snap) return false;
  return (
    String(snap.plot_id || '') === SNAPSHOT_DAY_LOCK_PLOT_ID ||
    String(snap.task_template_id || '').startsWith(SNAPSHOT_DAY_LOCK_TASK_PREFIX)
  );
}

/**
 * Checks whether a given date already has a freeze marker (either global or for a specific project).
 */
export function isPastDateFrozenInSnapshots(
  targetDate: string,
  existingSnapshots: any[] = [],
  projectName?: string | null
): boolean {
  const normDate = normalizeDateStr(targetDate) || targetDate;
  const targetProj = projectName && projectName !== 'all' ? projectName.trim() : null;
  if (!Array.isArray(existingSnapshots) || existingSnapshots.length === 0) return false;

  for (const snap of existingSnapshots) {
    if (!isDayFreezeMarkerRow(snap)) continue;
    const snapDate = normalizeDateStr(snap.snapshot_date);
    if (snapDate !== normDate) continue;
    const tid = String(snap.task_template_id || '');
    if (tid === SNAPSHOT_DAY_LOCK_TASK_PREFIX) return true;
    if (targetProj && tid === `${SNAPSHOT_DAY_LOCK_TASK_PREFIX}:${targetProj}`) return true;
  }
  return false;
}

/**
 * Maps a ForemanDailyTask into a database row payload for foreman_daily_duty_snapshots.
 */
export function toSnapshotDbRow(t: ForemanDailyTask, snapshotDate: string, updatedBy: string = 'Foreman') {
  const normDate = normalizeDateStr(snapshotDate) || snapshotDate;
  const nowIso = new Date().toISOString();
  return {
    snapshot_date: normDate,
    foreman_name: t.foreman_name,
    plot_id: String(t.plot_id),
    project_name: t.project_name,
    task_template_id: String(t.task_template_id),
    task_name: t.task_name,
    task_order: t.task_order || 0,
    planned_start: t.planned_start,
    planned_end: t.planned_end,
    current_progress: t.current_progress,
    contractor_name: t.contractor_name || '',
    is_updated_today: t.is_updated_today,
    status_reason: t.status_reason || null,
    status_note: t.status_note || null,
    last_updated_at: t.last_updated_at || nowIso,
    updated_by: updatedBy,
    updated_at: nowIso,
  };
}

/**
 * Core Algorithm: Retrieves scheduled tasks for a foreman on a target date.
 * Enforces Rule 1: Overdue tasks (targetDate > planned_end) are EXCLUDED.
 * Checks whether an update was made on targetDate.
 */
export function getForemanScheduledTasksForDate(options: GetForemanTasksOptions): ForemanDailyTask[] {
  const {
    plots,
    taskTemplates,
    schedules,
    assignments = [],
    allUpdatesRecord = [],
    defects = [],
    defectUpdates = [],
    contractors = [],
    foremenList = [],
    foremanName,
    targetDate,
    existingSnapshots = [],
    preIndexedUpdates,
    preIndexedDefectUpdates
  } = options;

  if (!targetDate || !Array.isArray(plots)) return [];

  const normTargetDate = normalizeDateStr(targetDate) || targetDate;
  const isTargetAll = !foremanName || foremanName.toLowerCase() === 'all';
  const targetFmLower = foremanName ? foremanName.toLowerCase().trim() : '';

  // 1. Build fast map of existing snapshots and day-lock markers for this date
  const snapshotMap = new Map<string, any>();
  let hasGlobalFreezeMarker = false;
  const frozenProjectsOnDate = new Set<string>();
  if (Array.isArray(existingSnapshots)) {
    existingSnapshots.forEach(snap => {
      const snapDate = normalizeDateStr(snap.snapshot_date);
      if (snapDate === normTargetDate) {
        if (isDayFreezeMarkerRow(snap)) {
          const tid = String(snap.task_template_id || '');
          if (tid === SNAPSHOT_DAY_LOCK_TASK_PREFIX) {
            hasGlobalFreezeMarker = true;
          } else if (tid.startsWith(`${SNAPSHOT_DAY_LOCK_TASK_PREFIX}:`)) {
            frozenProjectsOnDate.add(tid.slice(SNAPSHOT_DAY_LOCK_TASK_PREFIX.length + 1).trim());
          }
          return;
        }
        const key = `${snap.plot_id}-${snap.task_template_id}`;
        snapshotMap.set(key, snap);
      }
    });
  }

  // 2. Build fast map of assignments by plot_id-task_template_id
  const assignmentMap = new Map<string, any>();
  if (Array.isArray(assignments)) {
    assignments.forEach(a => {
      const key = `${a.plot_id}-${a.task_template_id}`;
      assignmentMap.set(key, a);
    });
  }

  // 3. Fast map of ALL updates grouped by plot_id-task_template_id
  const updatesByTaskMap = new Map<string, any[]>();
  if (Array.isArray(allUpdatesRecord)) {
    allUpdatesRecord.forEach(u => {
      if (!u.plot_id || !u.task_template_id) return;
      const k = `${u.plot_id}-${u.task_template_id}`;
      if (!updatesByTaskMap.has(k)) {
        updatesByTaskMap.set(k, []);
      }
      updatesByTaskMap.get(k)!.push(u);
    });
  }

  // 3.1 Fast map of updates on target date by plot_id-task_template_id (or use pre-indexed map)
  const targetDateUpdatesMap = preIndexedUpdates || new Map<string, any[]>();
  if (!preIndexedUpdates && Array.isArray(allUpdatesRecord)) {
    allUpdatesRecord.forEach(u => {
      const uDate = normalizeDateStr(u.created_at) || normalizeDateStr(u.date);
      if (uDate === normTargetDate) {
        const key = `${u.plot_id}-${u.task_template_id}`;
        if (!targetDateUpdatesMap.has(key)) {
          targetDateUpdatesMap.set(key, []);
        }
        targetDateUpdatesMap.get(key)!.push(u);
      }
    });
  }

  const nowBangkokStr = options.todayDateStr
    ? (normalizeDateStr(options.todayDateStr) || options.todayDateStr)
    : (normalizeDateStr(new Date()) || new Date().toISOString().split('T')[0]);
  const isViewingToday = normTargetDate === nowBangkokStr;
  const isViewingPast = normTargetDate < nowBangkokStr;
  const isPlotFrozenOnDate = (p: any): boolean =>
    isViewingPast &&
    (hasGlobalFreezeMarker || Boolean(p?.project_name && frozenProjectsOnDate.has(String(p.project_name).trim())));

  // Build index of plots with snapshots on target date for target foreman
  const historicalPlotIdsForFm = new Set<string>();
  if (Array.isArray(existingSnapshots)) {
    existingSnapshots.forEach(s => {
      if (isDayFreezeMarkerRow(s)) return;
      const sDate = normalizeDateStr(s.snapshot_date);
      if (sDate === normTargetDate) {
        const sFm = (s.foreman_name || '').trim().toLowerCase();
        if (isTargetAll || sFm === targetFmLower) {
          historicalPlotIdsForFm.add(String(s.plot_id));
        }
      }
    });
  }

  // 4. Filter plots assigned to foreman
  const matchedPlots = plots.filter(plot => {
    const pFm = getPlotForemanName(plot);
    if (isTargetAll) return true;
    if (pFm.toLowerCase() === targetFmLower) return true;
    // If this plot has a snapshot recorded on target date for this foreman, include it (Finding G)
    if (historicalPlotIdsForFm.has(String(plot.id))) return true;
    return false;
  });

  const dailyTasks: ForemanDailyTask[] = [];

  matchedPlots.forEach(plot => {
    const rawPlotFm = getPlotForemanName(plot);
    const plotFm = (!rawPlotFm || isUnassignedForemanName(rawPlotFm))
      ? 'ยังไม่ระบุโฟร์แมน'
      : canonicalizeForemanName(rawPlotFm, foremenList);
    const plotName = plot.name || plot.plot_number || `แปลง ${plot.id}`;
    const projectName = plot.project_name || 'ไอลิน';

    // Tasks for this plot: match house_type_id if available, or all templates
    const plotTasks = Array.isArray(taskTemplates)
      ? taskTemplates.filter(t => !plot.house_type_id || !t.house_type_id || String(t.house_type_id) === String(plot.house_type_id))
      : [];

    plotTasks.forEach(task => {
      const scheduleKey = `${plot.id}-${task.id}`;
      const altScheduleKey = `${plot.id}_${task.id}`;
      const taskAssign = assignmentMap.get(scheduleKey) || assignmentMap.get(altScheduleKey);
      if (isTaskExcludedFromPlan(task, taskAssign, plot)) {
        return;
      }
      const snapshot = snapshotMap.get(scheduleKey);
      // Frozen past dates strictly lock to existing snapshots; do not inject newly backdated/added schedules
      if (isPlotFrozenOnDate(plot) && !snapshot) {
        return;
      }
      const plan = schedules[scheduleKey] || schedules[altScheduleKey];

      // If a frozen snapshot exists for this task on targetDate, prioritize snapshot values
      const pStart = normalizeDateStr(snapshot?.planned_start || plan?.planned_start);
      const pEnd = normalizeDateStr(snapshot?.planned_end || plan?.planned_end);

      // If no schedule exists, cannot determine planned date
      if (!pStart || !pEnd) return;

      // RULE 1: Overdue tasks (targetDate > planned_end) MUST NOT appear in today's task list
      if (normTargetDate > pEnd) {
        return;
      }

      // Check if scheduled on target date: planned_start <= targetDate <= planned_end
      if (normTargetDate < pStart || normTargetDate > pEnd) {
        return;
      }

      // Today (live operational view): reflect live plot foreman immediately even if an earlier morning snapshot existed.
      // Past dates: preserve historical foreman from snapshot (Finding G), EXCEPT when the snapshot only recorded an
      // unassigned placeholder ("ยังไม่ระบุโฟร์แมน") and the plot now has a real foreman assigned.
      const rawSnapFm = String(snapshot?.foreman_name || '').trim();
      const hasConcreteSnapFm = Boolean(rawSnapFm) && !isUnassignedForemanName(rawSnapFm);
      const taskForeman = isViewingToday
        ? plotFm
        : (hasConcreteSnapFm ? canonicalizeForemanName(rawSnapFm, foremenList) : plotFm);

      if (!isTargetAll && taskForeman.toLowerCase() !== targetFmLower) {
        return;
      }

      // If viewing past date and no snapshot exists, verify if current foreman was already assigned on targetDate
      if (!isViewingToday && !snapshot?.foreman_name) {
        const assignedDate = normalizeDateStr(plot.foreman_assigned_at || plot.foremanAssignedAt);
        if (assignedDate && normTargetDate < assignedDate) {
          // Current foreman was assigned after this target date; un-snapshotted tasks should not be retroactively attributed
          if (!isTargetAll && plotFm.toLowerCase() === targetFmLower) {
            return;
          }
        }
      }

      // Current progress check:
      // For today: live assignment progress takes precedence (Finding 12)
      // For past dates: snapshot progress is frozen historical truth (Finding 12)
      const assign = assignmentMap.get(scheduleKey);
      const curProgress = isViewingToday
        ? Number(assign?.current_progress ?? snapshot?.current_progress ?? 0)
        : Number(snapshot?.current_progress ?? assign?.current_progress ?? 0);

      // Check updates on target date
      const updatesToday = targetDateUpdatesMap.get(scheduleKey) || [];
      const sortedUpdatesToday = [...updatesToday].sort((a, b) => {
        const ta = new Date(b.created_at || b.date || 0).getTime();
        const tb = new Date(a.created_at || a.date || 0).getTime();
        return ta - tb;
      });
      const latestUpdateToday = sortedUpdatesToday[0] || null;

      // Check whether latest update or snapshot indicates a roadblock
      const isLatestUpdateRoadblock = Boolean(
        latestUpdateToday &&
        (String(latestUpdateToday.action || '').includes('ติดปัญหา') ||
         String(latestUpdateToday.action || '').startsWith('แจ้งติดปัญหา') ||
         String(latestUpdateToday.text_content || '').startsWith('เหตุผล:'))
      );

      // Determine roadblock reason and note
      let statusReason = snapshot?.status_reason || null;
      let statusNote = snapshot?.status_note || null;

      if (!statusReason && isLatestUpdateRoadblock && latestUpdateToday) {
        const actStr = String(latestUpdateToday.action || '');
        const textStr = String(latestUpdateToday.text_content || '');
        const parsed = parseRoadblockDisplay(textStr, actStr);
        const matchedReason = parsed && ROADBLOCK_REASONS.some(r => r.id === parsed.reasonMeta.id)
          ? parsed.reasonMeta
          : null;
        if (matchedReason) {
          statusReason = matchedReason.id;
        } else if (actStr.startsWith('แจ้งติดปัญหา:')) {
          statusReason = actStr.replace('แจ้งติดปัญหา:', '').trim();
        } else {
          statusReason = 'other';
        }
        if (!statusNote && parsed?.note) {
          statusNote = parsed.note;
        }
      }

      // Check whether task is updated today with actual progress (not just a roadblock report)
      let isUpdatedToday = false;
      if (statusReason) {
        // Active roadblock today takes precedence -> counted as roadblock, not progress update
        isUpdatedToday = false;
      } else if (snapshot?.is_updated_today) {
        isUpdatedToday = true;
      } else if (sortedUpdatesToday.length > 0) {
        const hasProgressUpdateToday = sortedUpdatesToday.some(u => {
          const act = String(u.action || '');
          const text = String(u.text_content || '');
          return !act.includes('ติดปัญหา') && !text.startsWith('เหตุผล:');
        });
        isUpdatedToday = hasProgressUpdateToday;
      }

      // Check whether task is currently under active rejection / rework (capped to <= targetDate on past dates)
      const rawTaskUpdates = updatesByTaskMap.get(scheduleKey) || [];
      const taskUpdates = isViewingPast
        ? rawTaskUpdates.filter(u => (normalizeDateStr(u.created_at || u.date) || '') <= normTargetDate)
        : rawTaskUpdates;
      let isRejectedCurrently = false;
      if (taskUpdates.length > 0) {
        const sortedDesc = [...taskUpdates].sort((a, b) => {
          const ta = new Date(b.created_at || b.date || 0).getTime();
          const tb = new Date(a.created_at || a.date || 0).getTime();
          return ta - tb;
        });
        const latestAct = String(sortedDesc[0]?.action || '');
        if (latestAct.includes('แจ้งแก้ไข') || latestAct.includes('ไม่อนุมัติ') || latestAct.includes('ตีกลับ') || latestAct.includes('ไม่ผ่าน')) {
          isRejectedCurrently = true;
        }
      }

      // Check whether task was completed (100%) BEFORE targetDate
      let isCompletedEarly = false;
      let completionDate: string | null = normalizeDateStr(assign?.actual_end_date);

      if (curProgress >= 100 && !isRejectedCurrently) {
        // Find earliest 100% update in current 100% streak
        if (!completionDate && taskUpdates.length > 0) {
          const sortedAsc = [...taskUpdates].sort((a, b) => {
            const ta = new Date(a.created_at || a.date || 0).getTime();
            const tb = new Date(b.created_at || b.date || 0).getTime();
            return ta - tb;
          });
          for (let i = sortedAsc.length - 1; i >= 0; i--) {
            if (Number(sortedAsc[i].progress) >= 100) {
              completionDate = normalizeDateStr(sortedAsc[i].created_at || sortedAsc[i].date);
            } else {
              break;
            }
          }
        }

        // If completion date is known, check if before target date
        if (completionDate) {
          if (completionDate < normTargetDate) {
            isCompletedEarly = true;
          }
        } else {
          // If no timestamp found, but current progress is 100% and zero updates occurred on targetDate:
          // it was completed prior to targetDate!
          if (updatesToday.length === 0) {
            isCompletedEarly = true;
          }
        }
      }

      const contractorName = assign?.contractor_name || assign?.contractors?.name || plan?.contractor_name || '';

      dailyTasks.push({
        id: scheduleKey,
        plot_id: String(plot.id),
        plot_name: plotName,
        project_name: projectName,
        house_type_id: plot.house_type_id ? String(plot.house_type_id) : undefined,
        foreman_name: taskForeman,
        task_template_id: String(task.id),
        task_name: task.task_name || snapshot?.task_name || 'งานก่อสร้าง',
        task_order: Number(task.task_order || 0),
        planned_start: pStart,
        planned_end: pEnd,
        current_progress: curProgress,
        contractor_name: contractorName,
        is_updated_today: isUpdatedToday,
        last_updated_at: snapshot?.last_updated_at || latestUpdateToday?.created_at || null,
        last_action: latestUpdateToday?.action || (isUpdatedToday ? 'อัปเดตแล้ว' : null),
        last_role: latestUpdateToday?.role || null,
        status_reason: statusReason,
        status_note: statusNote,
        is_snapshot: Boolean(snapshot),
        is_completed_early: isCompletedEarly,
        completion_date: completionDate,
      });
    });
  });

  // 5. Append scheduled Handover Inspection tasks (`defects` with `defect_stage === 'handover'`)
  // Handover tasks can be handled by a different foreman than construction (`plots.foreman_name`),
  // so we look up each defect's plot in `plots` directly and evaluate ownership per defect.
  if (Array.isArray(defects) && defects.length > 0) {
    const plotByIdMap = new Map<string, any>();
    plots.forEach(p => {
      if (p && p.id !== undefined && p.id !== null) {
        plotByIdMap.set(String(p.id), p);
      }
    });

    const contractorMap = new Map<string, any>();
    if (Array.isArray(contractors)) {
      contractors.forEach(c => {
        if (c && c.id !== undefined && c.id !== null) {
          contractorMap.set(String(c.id), c);
        }
      });
    }

    const defectUpdatesByDefectId = new Map<string, any[]>();
    const targetDateDefectUpdatesMap = preIndexedDefectUpdates || new Map<string, any[]>();

    if (Array.isArray(defectUpdates)) {
      defectUpdates.forEach(du => {
        if (!du || !du.defect_id) return;
        const dIdStr = String(du.defect_id);
        if (!defectUpdatesByDefectId.has(dIdStr)) {
          defectUpdatesByDefectId.set(dIdStr, []);
        }
        defectUpdatesByDefectId.get(dIdStr)!.push(du);

        if (!preIndexedDefectUpdates) {
          const duDate = normalizeDateStr(du.created_at) || normalizeDateStr(du.date);
          if (duDate === normTargetDate) {
            if (!targetDateDefectUpdatesMap.has(dIdStr)) {
              targetDateDefectUpdatesMap.set(dIdStr, []);
            }
            targetDateDefectUpdatesMap.get(dIdStr)!.push(du);
          }
        }
      });
    }

    const isDefectRoadblockRow = (u: any): boolean => {
      if (!u) return false;
      const actStr = String(u.action || '');
      const noteStr = String(u.note || '');
      return Boolean(
        parseRoadblockDisplay(noteStr, actStr) ||
        actStr.includes('ติดปัญหา') ||
        actStr.startsWith('แจ้งติดปัญหา') ||
        noteStr.startsWith('เหตุผล:')
      );
    };

    defects.forEach(d => {
      if (!d || d.defect_stage !== 'handover') return;
      const plot = plotByIdMap.get(String(d.plot_id));
      if (!plot) return;

      const templateKey = `handover:${d.id}`;
      const scheduleKey = `${plot.id}-${templateKey}`;
      const snapshot = snapshotMap.get(scheduleKey);
      if (isPlotFrozenOnDate(plot) && !snapshot) {
        return;
      }

      const pStart = normalizeDateStr(snapshot?.planned_start || d.planned_start);
      const pEnd = normalizeDateStr(snapshot?.planned_end || d.planned_end);
      if (!pStart || !pEnd) return;

      // Enforce exact same date-window & overdue exclusion rules (ข้อ 3)
      if (normTargetDate < pStart || normTargetDate > pEnd) {
        return;
      }

      // Today: live handover foreman (per defect -> plot.handover_foreman_name -> plot.foreman_name)
      // Past dates: snapshot foreman preserves historical attribution across takeovers, unless snapshot was unassigned placeholder
      const rawLiveFm = resolveHandoverDefectForeman(d, plot);
      const liveForeman = (!rawLiveFm || isUnassignedForemanName(rawLiveFm))
        ? 'ยังไม่ระบุโฟร์แมน'
        : canonicalizeForemanName(rawLiveFm, foremenList);
      const rawSnapFm = String(snapshot?.foreman_name || '').trim();
      const hasConcreteSnapFm = Boolean(rawSnapFm) && !isUnassignedForemanName(rawSnapFm);
      const taskForeman = isViewingToday
        ? liveForeman
        : (hasConcreteSnapFm ? canonicalizeForemanName(rawSnapFm, foremenList) : liveForeman);

      if (!isTargetAll && taskForeman.toLowerCase() !== targetFmLower) {
        return;
      }

      const curProgress = isViewingToday
        ? Number(d.progress ?? snapshot?.current_progress ?? 0)
        : Number(snapshot?.current_progress ?? d.progress ?? 0);

      const updatesToday = targetDateDefectUpdatesMap.get(String(d.id)) || [];
      const sortedUpdatesToday = [...updatesToday].sort((a, b) => {
        const ta = new Date(b.created_at || b.date || 0).getTime();
        const tb = new Date(a.created_at || a.date || 0).getTime();
        return ta - tb;
      });
      const latestUpdateToday = sortedUpdatesToday[0] || null;
      const isLatestUpdateRoadblock = Boolean(latestUpdateToday && isDefectRoadblockRow(latestUpdateToday));

      let statusReason = snapshot?.status_reason || null;
      let statusNote = snapshot?.status_note || null;

      // If today has a newer non-roadblock progress update than snapshot roadblock, clear stale roadblock
      if (isViewingToday && statusReason && sortedUpdatesToday.length > 0 && !isLatestUpdateRoadblock) {
        const latestNonRb = sortedUpdatesToday.find(u => !isDefectRoadblockRow(u));
        const snapTime = new Date(snapshot?.last_updated_at || snapshot?.updated_at || 0).getTime();
        const updTime = new Date(latestNonRb?.created_at || latestNonRb?.date || 0).getTime();
        if (!snapTime || updTime >= snapTime) {
          statusReason = null;
          statusNote = null;
        }
      }

      if (isLatestUpdateRoadblock && latestUpdateToday) {
        const actStr = String(latestUpdateToday.action || '');
        const textStr = String(latestUpdateToday.note || '');
        const parsed = parseRoadblockDisplay(textStr, actStr);
        const matchedReason = parsed && ROADBLOCK_REASONS.some(r => r.id === parsed.reasonMeta.id)
          ? parsed.reasonMeta
          : null;
        if (matchedReason) {
          statusReason = matchedReason.id;
        } else if (actStr.startsWith('แจ้งติดปัญหา:')) {
          statusReason = actStr.replace('แจ้งติดปัญหา:', '').trim();
        } else {
          statusReason = 'other';
        }
        statusNote = parsed?.note || statusNote || null;
      }

      let isUpdatedToday = false;
      if (statusReason) {
        isUpdatedToday = false;
      } else if (!isViewingToday && snapshot?.is_updated_today) {
        isUpdatedToday = true;
      } else if (sortedUpdatesToday.some(u => !isDefectRoadblockRow(u))) {
        isUpdatedToday = true;
      } else if (snapshot?.is_updated_today) {
        isUpdatedToday = true;
      }

      // Check whether defect was completed (100% or closed/resolved) BEFORE targetDate (capped to <= targetDate on past dates)
      const rawDefectUpds = defectUpdatesByDefectId.get(String(d.id)) || [];
      const allDefectUpds = isViewingPast
        ? rawDefectUpds.filter(u => (normalizeDateStr(u.created_at || u.date) || '') <= normTargetDate)
        : rawDefectUpds;
      let isRejectedCurrently = false;
      if (allDefectUpds.length > 0) {
        const sortedDesc = [...allDefectUpds].sort((a, b) => {
          const ta = new Date(b.created_at || b.date || 0).getTime();
          const tb = new Date(a.created_at || a.date || 0).getTime();
          return ta - tb;
        });
        const latestNoteAct = `${sortedDesc[0]?.action || ''} ${sortedDesc[0]?.note || ''}`;
        if (
          latestNoteAct.includes('แจ้งแก้ไข') ||
          latestNoteAct.includes('ไม่อนุมัติ') ||
          latestNoteAct.includes('ตีกลับ') ||
          latestNoteAct.includes('ไม่ผ่าน')
        ) {
          isRejectedCurrently = true;
        }
      }

      let isCompletedEarly = false;
      let completionDate: string | null = normalizeDateStr(d.actual_end || d.resolved_at || d.completed_at);

      if ((curProgress >= 100 || isHandoverDefectCompleted(d)) && !isRejectedCurrently) {
        if (!completionDate && allDefectUpds.length > 0) {
          const sortedAsc = [...allDefectUpds].sort((a, b) => {
            const ta = new Date(a.created_at || a.date || 0).getTime();
            const tb = new Date(b.created_at || b.date || 0).getTime();
            return ta - tb;
          });
          for (let i = sortedAsc.length - 1; i >= 0; i--) {
            if (!isDefectRoadblockRow(sortedAsc[i]) && Number(sortedAsc[i].progress) >= 100) {
              completionDate = normalizeDateStr(sortedAsc[i].created_at || sortedAsc[i].date);
            } else if (!isDefectRoadblockRow(sortedAsc[i])) {
              break;
            }
          }
        }

        if (completionDate) {
          if (completionDate < normTargetDate) {
            isCompletedEarly = true;
          }
        } else if (updatesToday.length === 0) {
          isCompletedEarly = true;
        }
      }

      const plotName = plot.name || plot.plot_number || `แปลง ${plot.id}`;
      const projectName = plot.project_name || 'ไอลิน';
      const contractorName =
        d.contractor_name ||
        contractorMap.get(String(d.contractor_id || ''))?.name ||
        '';
      const handoverRound = Number(d.inspection_round || d.round || plot.inspection_round || 1);
      const rbMeta = statusReason ? getRoadblockReason(statusReason) : null;

      dailyTasks.push({
        id: scheduleKey,
        plot_id: String(plot.id),
        plot_name: plotName,
        project_name: projectName,
        house_type_id: plot.house_type_id ? String(plot.house_type_id) : undefined,
        foreman_name: taskForeman,
        task_template_id: templateKey,
        task_name: d.description || d.title || snapshot?.task_name || 'รายการตรวจรับบ้าน',
        task_order: 9000 + handoverRound,
        planned_start: pStart,
        planned_end: pEnd,
        current_progress: curProgress,
        contractor_name: contractorName,
        is_updated_today: isUpdatedToday,
        last_updated_at: snapshot?.last_updated_at || latestUpdateToday?.created_at || null,
        last_action: isLatestUpdateRoadblock
          ? `แจ้งติดปัญหา: ${rbMeta?.label || statusReason}`
          : latestUpdateToday
          ? (Number(latestUpdateToday.progress) >= 100
              ? 'แก้ไข Defect เสร็จสิ้น 100%'
              : `อัปเดตงานตรวจรับ (${latestUpdateToday.progress ?? curProgress}%)`)
          : (isUpdatedToday ? 'อัปเดตแล้ว' : null),
        last_role: latestUpdateToday?.created_by ? 'Foreman' : null,
        status_reason: statusReason,
        status_note: statusNote,
        is_snapshot: Boolean(snapshot),
        is_completed_early: isCompletedEarly,
        completion_date: completionDate,
        is_handover: true,
        defect_id: String(d.id),
        handover_round: handoverRound,
        defectObj: d,
      });
    });
  }

  // Sort by Plot name, then task order
  dailyTasks.sort((a, b) => {
    if (a.plot_name !== b.plot_name) return a.plot_name.localeCompare(b.plot_name, 'th');
    return (a.task_order || 0) - (b.task_order || 0);
  });

  return dailyTasks;
}

/**
 * Computes summary KPI metrics for a daily task list.
 */
export function computeForemanDailySummary(tasks: ForemanDailyTask[]): ForemanDailySummary {
  // Only tasks that are NOT completed early count towards today's active inspection workload
  const activeTasks = tasks.filter(t => !t.is_completed_early);
  const completedEarlyTasks = tasks.filter(t => t.is_completed_early);

  const totalTasks = activeTasks.length;
  let updatedTasks = 0;
  let roadblockTasks = 0;
  let pendingTasks = 0;

  const plotSet = new Set<string>();

  activeTasks.forEach(t => {
    plotSet.add(t.plot_id);
    if (t.status_reason) {
      roadblockTasks++;
    } else if (t.is_updated_today) {
      updatedTasks++;
    } else {
      pendingTasks++;
    }
  });

  // Compliance counts both actual progress updates and valid roadblock reason reports on active tasks
  const compliantCount = updatedTasks + roadblockTasks;
  const complianceRate = totalTasks > 0 ? Math.round((compliantCount / totalTasks) * 100) : 100;

  return {
    totalTasks,
    updatedTasks,
    roadblockTasks,
    pendingTasks,
    complianceRate,
    plotsCount: plotSet.size,
    completedEarlyTasks: completedEarlyTasks.length,
  };
}

/**
 * Local storage key helper for resilient caching of daily snapshots.
 */
function getLocalSnapshotKey(snapshotDate: string, foremanName: string): string {
  const safeFm = (foremanName || 'all').trim().toLowerCase();
  return `buildtrack_fm_snapshot_${snapshotDate}_${safeFm}`;
}

/**
 * Saves or updates daily tasks snapshot for historical preservation.
 * Dual-writes to Supabase and localStorage for resilience.
 */
export async function saveForemanDailySnapshot(
  tasks: ForemanDailyTask[],
  snapshotDate: string,
  foremanName: string,
  updatedBy: string = 'Foreman',
  customSupabase?: any
): Promise<{ success: boolean; count: number; storage?: 'remote' | 'local_cache' | 'none'; isRemoteSynced?: boolean; error?: string }> {
  if (!Array.isArray(tasks) || tasks.length === 0) {
    return { success: true, count: 0, storage: 'none', isRemoteSynced: true };
  }

  const client = customSupabase || supabase;
  const normDate = normalizeDateStr(snapshotDate) || snapshotDate;

  // 1. Save to localStorage immediately as fast resilient cache
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const localKey = getLocalSnapshotKey(normDate, foremanName);
      const tasksWithDate = tasks.map(t => ({
        ...t,
        snapshot_date: normDate
      }));
      localStorage.setItem(localKey, JSON.stringify(tasksWithDate));
    }
  } catch (err) {
    console.warn('Could not cache foreman snapshot in localStorage', err);
  }

  // 2. Dual-write to Supabase table foreman_daily_duty_snapshots
  try {
    const rows = tasks.map(t => toSnapshotDbRow(t, normDate, updatedBy));

    const upsertBuilder = client
      .from('foreman_daily_duty_snapshots')
      .upsert(rows, { onConflict: 'snapshot_date,plot_id,task_template_id' });

    const { data, error } = typeof upsertBuilder.select === 'function'
      ? await upsertBuilder.select('id')
      : await upsertBuilder;

    if (error) {
      console.warn('Supabase snapshot upsert notice (fallback used):', error.message);
      return { success: true, count: tasks.length, storage: 'local_cache', isRemoteSynced: false, error: error.message };
    }

    return { success: true, count: data?.length || tasks.length, storage: 'remote', isRemoteSynced: true };
  } catch (err: any) {
    console.warn('Supabase snapshot save error (fallback to local cache):', err?.message || err);
    return { success: true, count: tasks.length, storage: 'local_cache', isRemoteSynced: false, error: err?.message || String(err) };
  }
}

/**
 * Loads daily snapshot for a specific date and foreman.
 * Falls back to localStorage cache if Supabase table is not yet migrated.
 */
export async function loadForemanDailySnapshot(
  snapshotDate: string,
  foremanName?: string,
  customSupabase?: any,
  options?: { plotIds?: (string | number)[] }
): Promise<LoadSnapshotResult> {
  const normDate = normalizeDateStr(snapshotDate) || snapshotDate;
  const targetFmLower = foremanName ? foremanName.toLowerCase().trim() : '';
  const client = customSupabase || supabase;
  let remoteError: any = null;

  try {
    let query = client
      .from('foreman_daily_duty_snapshots')
      .select('*')
      .eq('snapshot_date', normDate);

    if (targetFmLower && targetFmLower !== 'all') {
      const pids = (options?.plotIds || []).map(String).filter(Boolean);
      if (pids.length > 0) {
        const sanitizedPids = pids.map(id => id.replace(/[(),"]/g, '').trim()).filter(Boolean);
        if (sanitizedPids.length > 0) {
          query = query.or(`foreman_name.ilike.${targetFmLower},plot_id.in.(${sanitizedPids.join(',')}),plot_id.eq.${SNAPSHOT_DAY_LOCK_PLOT_ID}`);
        } else {
          query = typeof (query as any).or === 'function'
            ? (query as any).or(`foreman_name.ilike.${targetFmLower},plot_id.eq.${SNAPSHOT_DAY_LOCK_PLOT_ID}`)
            : query.ilike('foreman_name', targetFmLower);
        }
      } else {
        query = typeof (query as any).or === 'function'
          ? (query as any).or(`foreman_name.ilike.${targetFmLower},plot_id.eq.${SNAPSHOT_DAY_LOCK_PLOT_ID}`)
          : query.ilike('foreman_name', targetFmLower);
      }
    }

    const { data, error } = await query;
    if (!error && Array.isArray(data)) {
      const res: any = data;
      res.status = data.length > 0 ? 'success' : 'empty';
      res.storage = 'remote';
      res.data = data;
      return res;
    }
    if (error) {
      remoteError = error;
    }
  } catch (err) {
    remoteError = err;
  }

  // Fallback: check localStorage
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const localKey = getLocalSnapshotKey(normDate, foremanName || 'all');
      const cached = localStorage.getItem(localKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const res: any = parsed;
          res.status = 'cache_fallback';
          res.storage = 'local_cache';
          res.error = remoteError;
          res.data = parsed;
          return res;
        }
      }
    }
  } catch (err) {
    // ignore
  }

  const emptyRes: any = [];
  emptyRes.status = remoteError ? 'error' : 'empty';
  emptyRes.storage = remoteError ? 'none' : 'remote';
  emptyRes.error = remoteError;
  emptyRes.data = [];
  return emptyRes;
}

/**
 * Loads all duty snapshots for a specific month (year and month 1-12) and foreman.
 * Used by the Owner Audit Calendar to accurately render past days and show loading progress.
 */
export async function loadForemanMonthlySnapshots(
  year: number,
  month: number,
  foremanName?: string,
  projectName?: string,
  customSupabase?: any,
  options?: { plotIds?: (string | number)[] }
): Promise<any[]> {
  const startStr = `${year}-${String(month).padStart(2, '0')}-01`;
  const endDay = new Date(year, month, 0).getDate();
  const endStr = `${year}-${String(month).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`;
  const targetFmLower = foremanName ? foremanName.toLowerCase().trim() : '';
  const targetProj = projectName && projectName !== 'all' ? projectName.trim() : null;
  const client = customSupabase || supabase;

  try {
    let query = client
      .from('foreman_daily_duty_snapshots')
      .select('*')
      .gte('snapshot_date', startStr)
      .lte('snapshot_date', endStr);

    if (targetFmLower && targetFmLower !== 'all') {
      const pids = (options?.plotIds || []).map(String).filter(Boolean);
      if (pids.length > 0) {
        const sanitizedPids = pids.map(id => id.replace(/[(),"]/g, '').trim()).filter(Boolean);
        if (sanitizedPids.length > 0) {
          query = query.or(`foreman_name.ilike.${targetFmLower},plot_id.in.(${sanitizedPids.join(',')}),plot_id.eq.${SNAPSHOT_DAY_LOCK_PLOT_ID}`);
        } else {
          query = typeof (query as any).or === 'function'
            ? (query as any).or(`foreman_name.ilike.${targetFmLower},plot_id.eq.${SNAPSHOT_DAY_LOCK_PLOT_ID}`)
            : query.ilike('foreman_name', targetFmLower);
        }
      } else {
        query = typeof (query as any).or === 'function'
          ? (query as any).or(`foreman_name.ilike.${targetFmLower},plot_id.eq.${SNAPSHOT_DAY_LOCK_PLOT_ID}`)
          : query.ilike('foreman_name', targetFmLower);
      }
    }
    if (targetProj) {
      query = typeof (query as any).in === 'function'
        ? (query as any).in('project_name', [targetProj, '__SYSTEM__'])
        : query.eq('project_name', targetProj);
    }

    const { data, error } = await query;
    if (!error && Array.isArray(data)) {
      return data;
    }
  } catch (err) {
    // Fall back to local storage
  }

  // Fallback: search localStorage
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const results: any[] = [];
      const prefixNew = `buildtrack_fm_snapshot_${year}-${String(month).padStart(2, '0')}`;
      const prefixOld = `bt_foreman_snapshot_${year}-${String(month).padStart(2, '0')}`;
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.startsWith(prefixNew) || key.startsWith(prefixOld))) {
          const raw = localStorage.getItem(key);
          if (raw) {
            try {
              const parsed = JSON.parse(raw);
              if (Array.isArray(parsed)) {
                const inferredDate = key.match(/\d{4}-\d{2}-\d{2}/)?.[0] || startStr;
                parsed.forEach((item: any) => {
                  if (!item.snapshot_date) item.snapshot_date = inferredDate;
                  if (targetFmLower && targetFmLower !== 'all') {
                    const iFm = (item.foreman_name || '').trim().toLowerCase();
                    const pidSet = new Set((options?.plotIds || []).map(String));
                    const matchPlot = item.plot_id && pidSet.has(String(item.plot_id));
                    if (iFm !== targetFmLower && !matchPlot) return;
                  }
                  if (targetProj) {
                    if (item.project_name && item.project_name !== targetProj && !isDayFreezeMarkerRow(item)) return;
                  }
                  results.push(item);
                });
              }
            } catch (_) {}
          }
        }
      }
      return results;
    }
  } catch (err) {
    // ignore
  }

  return [];
}

export interface FreezePastSnapshotsOptions {
  year: number;
  month: number; // 1-12
  plots: any[];
  taskTemplates: any[];
  schedules: Record<string, any>;
  assignments?: any[];
  allUpdatesRecord?: any[];
  defects?: any[];
  defectUpdates?: any[];
  contractors?: any[];
  foremenList?: any[];
  existingSnapshots?: any[];
  projectName?: string;
  todayDateStr?: string;
  updatedBy?: string;
  customSupabase?: any;
}

/**
 * Backfills and freezes snapshots for completed past dates (< today) in a month
 * that do not yet carry a day-lock marker. Preserves existing snapshot rows intact
 * and writes a freeze marker per past date so later schedule edits cannot alter history.
 */
export async function freezePastDailySnapshotsForMonth(
  options: FreezePastSnapshotsOptions
): Promise<{ success: boolean; frozenDates: string[]; addedRows: any[]; error?: string }> {
  const {
    year,
    month,
    plots = [],
    taskTemplates = [],
    schedules = {},
    assignments = [],
    allUpdatesRecord = [],
    defects = [],
    defectUpdates = [],
    contractors = [],
    foremenList = [],
    existingSnapshots = [],
    projectName,
    todayDateStr,
    updatedBy = 'AutoFreeze',
    customSupabase,
  } = options;

  const hasSchedules = schedules && Object.keys(schedules).length > 0;
  const hasHandoverDefects = Array.isArray(defects) && defects.some(d => d?.defect_stage === 'handover');
  if (!Array.isArray(plots) || plots.length === 0 || !Array.isArray(taskTemplates) || taskTemplates.length === 0 || (!hasSchedules && !hasHandoverDefects)) {
    return { success: true, frozenDates: [], addedRows: [] };
  }

  const client = customSupabase || supabase;
  if (!customSupabase && typeof client?.auth?.getSession === 'function') {
    try {
      const { data: sessionData } = await client.auth.getSession();
      if (!sessionData?.session) {
        return { success: true, frozenDates: [], addedRows: [] };
      }
    } catch {
      return { success: true, frozenDates: [], addedRows: [] };
    }
  }

  const nowBangkokStr = todayDateStr
    ? (normalizeDateStr(todayDateStr) || todayDateStr)
    : (normalizeDateStr(new Date()) || new Date().toISOString().split('T')[0]);

  const targetProj = projectName && projectName !== 'all' ? projectName.trim() : null;
  const scopedPlots = targetProj ? plots.filter(p => p.project_name === targetProj) : plots;
  if (scopedPlots.length === 0) {
    return { success: true, frozenDates: [], addedRows: [] };
  }
  const scopedPlotIds = targetProj ? new Set(scopedPlots.map(p => String(p.id))) : null;
  const scopedDefects = scopedPlotIds
    ? (defects || []).filter(d => d && scopedPlotIds.has(String(d.plot_id)))
    : (defects || []);
  const scopedDefectIds = new Set(scopedDefects.map(d => String(d.id)));

  const existingKeySet = new Set<string>();
  (existingSnapshots || []).forEach(s => {
    const sDate = normalizeDateStr(s.snapshot_date);
    if (sDate) {
      existingKeySet.add(`${sDate}::${s.plot_id}::${s.task_template_id}`);
    }
  });

  // Pre-index updates & defect updates by date once for fast multi-day freezing
  const updatesByDateAndKey = new Map<string, Map<string, any[]>>();
  if (Array.isArray(allUpdatesRecord)) {
    allUpdatesRecord.forEach(u => {
      if (scopedPlotIds && !scopedPlotIds.has(String(u.plot_id))) return;
      const uDate = normalizeDateStr(u.created_at) || normalizeDateStr(u.date);
      if (!uDate) return;
      if (!updatesByDateAndKey.has(uDate)) updatesByDateAndKey.set(uDate, new Map());
      const key = `${u.plot_id}-${u.task_template_id}`;
      const m = updatesByDateAndKey.get(uDate)!;
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(u);
    });
  }

  const defectUpdatesByDateAndId = new Map<string, Map<string, any[]>>();
  if (Array.isArray(defectUpdates)) {
    defectUpdates.forEach(du => {
      if (!du || !du.defect_id) return;
      const dIdStr = String(du.defect_id);
      if (scopedPlotIds && !scopedDefectIds.has(dIdStr)) return;
      const duDate = normalizeDateStr(du.created_at) || normalizeDateStr(du.date);
      if (!duDate) return;
      if (!defectUpdatesByDateAndId.has(duDate)) defectUpdatesByDateAndId.set(duDate, new Map());
      const m = defectUpdatesByDateAndId.get(duDate)!;
      if (!m.has(dIdStr)) m.set(dIdStr, []);
      m.get(dIdStr)!.push(du);
    });
  }

  const daysInMonth = new Date(year, month, 0).getDate();
  const rowsToInsert: any[] = [];
  const frozenDates: string[] = [];

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (dateStr >= nowBangkokStr) continue;
    // Sundays are weekly foreman holidays — never freeze as pending/missed duty days
    if (isForemanWeeklyHoliday(dateStr)) continue;
    if (isPastDateFrozenInSnapshots(dateStr, existingSnapshots, targetProj)) continue;

    const tasks = getForemanScheduledTasksForDate({
      plots: scopedPlots,
      taskTemplates,
      schedules,
      assignments,
      allUpdatesRecord,
      defects: scopedDefects,
      defectUpdates,
      contractors,
      foremenList,
      foremanName: 'all',
      targetDate: dateStr,
      existingSnapshots,
      preIndexedUpdates: updatesByDateAndKey.get(dateStr),
      preIndexedDefectUpdates: defectUpdatesByDateAndId.get(dateStr),
      todayDateStr: nowBangkokStr,
    });

    const activeTasks = tasks.filter(t => !t.is_completed_early);
    activeTasks.forEach(t => {
      const k = `${dateStr}::${t.plot_id}::${t.task_template_id}`;
      if (!existingKeySet.has(k)) {
        existingKeySet.add(k);
        rowsToInsert.push(toSnapshotDbRow(t, dateStr, updatedBy));
      }
    });

    const lockTaskId = targetProj ? `${SNAPSHOT_DAY_LOCK_TASK_PREFIX}:${targetProj}` : SNAPSHOT_DAY_LOCK_TASK_PREFIX;
    const lockKey = `${dateStr}::${SNAPSHOT_DAY_LOCK_PLOT_ID}::${lockTaskId}`;
    if (!existingKeySet.has(lockKey)) {
      existingKeySet.add(lockKey);
      const nowIso = new Date().toISOString();
      rowsToInsert.push({
        snapshot_date: dateStr,
        foreman_name: '__ALL__',
        plot_id: SNAPSHOT_DAY_LOCK_PLOT_ID,
        project_name: targetProj || '__SYSTEM__',
        task_template_id: lockTaskId,
        task_name: targetProj ? `FROZEN_PAST_DAY:${targetProj}` : 'FROZEN_PAST_DAY',
        task_order: 0,
        planned_start: dateStr,
        planned_end: dateStr,
        current_progress: 0,
        contractor_name: '',
        is_updated_today: false,
        status_reason: null,
        status_note: null,
        last_updated_at: nowIso,
        updated_by: updatedBy,
        updated_at: nowIso,
      });
    }
    frozenDates.push(dateStr);
  }

  if (rowsToInsert.length === 0) {
    return { success: true, frozenDates: [], addedRows: [] };
  }

  try {
    const CHUNK_SIZE = 300;
    for (let i = 0; i < rowsToInsert.length; i += CHUNK_SIZE) {
      const chunk = rowsToInsert.slice(i, i + CHUNK_SIZE);
      const { error } = await client
        .from('foreman_daily_duty_snapshots')
        .upsert(chunk, { onConflict: 'snapshot_date,plot_id,task_template_id', ignoreDuplicates: true });
      if (error) {
        console.warn('Auto-freeze past snapshots notice:', error.message);
        return { success: false, frozenDates: [], addedRows: [], error: error.message };
      }
    }
    return { success: true, frozenDates, addedRows: rowsToInsert };
  } catch (err: any) {
    console.warn('Auto-freeze past snapshots error:', err?.message || err);
    return { success: false, frozenDates: [], addedRows: [], error: err?.message || String(err) };
  }
}

/**
 * Records a roadblock / non-start reason for a specific task.
 * Updates both the snapshot and creates a notification update in task_updates.
 */
export async function recordForemanTaskRoadblockReason(
  task: ForemanDailyTask,
  targetDate: string,
  reasonId: string,
  note: string = '',
  updatedBy: string = 'Foreman',
  customSupabase?: any,
  options?: { clientSubmissionId?: string }
): Promise<{ success: boolean; error?: string }> {
  const normDate = normalizeDateStr(targetDate) || targetDate;
  const reasonMeta = getRoadblockReason(reasonId);
  const reasonLabel = reasonMeta ? reasonMeta.label : reasonId;
  const client = customSupabase || supabase;

  let snapError: string | null = null;
  let updateError: string | null = null;

  // 1. Update or upsert snapshot
  try {
    const row = {
      snapshot_date: normDate,
      foreman_name: task.foreman_name,
      plot_id: String(task.plot_id),
      project_name: task.project_name,
      task_template_id: String(task.task_template_id),
      task_name: task.task_name,
      task_order: task.task_order || 0,
      planned_start: task.planned_start,
      planned_end: task.planned_end,
      current_progress: task.current_progress,
      contractor_name: task.contractor_name || '',
      is_updated_today: false,
      status_reason: reasonId,
      status_note: note,
      last_updated_at: new Date().toISOString(),
      updated_by: updatedBy,
      updated_at: new Date().toISOString(),
    };

    const snapRes = await client
      .from('foreman_daily_duty_snapshots')
      .upsert([row], { onConflict: 'snapshot_date,plot_id,task_template_id' });
    if (snapRes?.error) {
      snapError = snapRes.error.message;
      console.warn('Snapshot reason upsert notice:', snapError);
    }
  } catch (err: any) {
    snapError = err?.message || String(err);
    console.warn('Snapshot reason upsert fallback notice:', snapError);
  }

  // 2. Log roadblock in defect_updates (for handover tasks) or task_updates (for construction tasks)
  const isHandoverTask = Boolean(
    task.is_handover ||
    task.defect_id ||
    String(task.task_template_id || '').startsWith('handover:')
  );
  const resolvedDefectId = task.defect_id
    ? String(task.defect_id)
    : (String(task.task_template_id || '').startsWith('handover:')
        ? String(task.task_template_id).replace(/^handover:/, '')
        : '');

  try {
    const subId = options?.clientSubmissionId || '';
    const updateText = note
      ? `เหตุผล: ${reasonLabel} (${note})${subId ? ` [ref:${subId}]` : ''}`
      : `เหตุผล: ${reasonLabel}${subId ? ` [ref:${subId}]` : ''}`;

    if (isHandoverTask && resolvedDefectId) {
      let existingDefectUpdateId: any = null;
      if (subId) {
        const marker = `[ref:${subId}]`;
        const { data: existingRows, error: searchErr } = await client
          .from('defect_updates')
          .select('id, note')
          .eq('defect_id', resolvedDefectId)
          .ilike('note', `%${marker}%`);

        if (searchErr) {
          console.error('Search existing handover roadblock error:', searchErr);
          return {
            success: false,
            error: `เกิดข้อผิดพลาดในการตรวจสอบประวัติการส่งข้อมูล: ${searchErr.message}`
          };
        }

        if (Array.isArray(existingRows) && existingRows.length > 0) {
          existingDefectUpdateId = existingRows[0].id;
        }
      }

      let error: any = null;
      if (existingDefectUpdateId) {
        const updateRes = await client
          .from('defect_updates')
          .update({
            note: updateText,
            progress: task.current_progress,
            created_by: updatedBy,
          })
          .eq('id', existingDefectUpdateId);
        error = updateRes?.error;
      } else {
        const insertRes = await client.from('defect_updates').insert([
          {
            defect_id: resolvedDefectId,
            created_by: updatedBy,
            progress: task.current_progress,
            note: updateText,
            image_urls: null,
            created_at: new Date().toISOString(),
          },
        ]);
        error = insertRes?.error;
      }

      if (error) {
        updateError = error.message;
        console.warn('Notice: could not insert defect_updates entry for handover roadblock', updateError);
      }
    } else {
      // Finding F4: Dedup by unique submission ID across all records without arbitrary limit(10)
      let existingUpdateId: any = null;
      if (subId) {
        const marker = `[ref:${subId}]`;
        const { data: existingRows, error: searchErr } = await client
          .from('task_updates')
          .select('id, text_content')
          .eq('plot_id', task.plot_id)
          .ilike('text_content', `%${marker}%`);

        if (searchErr) {
          console.error('Search existing roadblock error:', searchErr);
          return {
            success: false,
            error: `เกิดข้อผิดพลาดในการตรวจสอบประวัติการส่งข้อมูล: ${searchErr.message}`
          };
        }

        if (Array.isArray(existingRows) && existingRows.length > 0) {
          existingUpdateId = existingRows[0].id;
        }
      }

      let error: any = null;
      if (existingUpdateId) {
        const updateRes = await client
          .from('task_updates')
          .update({
            action: `แจ้งติดปัญหา: ${reasonLabel}`,
            text_content: updateText,
            progress: task.current_progress,
            is_worker_present: reasonId !== 'worker_issue',
            user_name: updatedBy,
          })
          .eq('id', existingUpdateId);
        error = updateRes?.error;
      } else {
        const insertRes = await client.from('task_updates').insert([
          {
            plot_id: task.plot_id,
            task_template_id: task.task_template_id,
            role: 'Foreman',
            action: `แจ้งติดปัญหา: ${reasonLabel}`,
            text_content: updateText,
            progress: task.current_progress,
            is_worker_present: reasonId !== 'worker_issue',
            user_name: updatedBy,
            created_at: new Date().toISOString(),
          },
        ]);
        error = insertRes?.error;
      }

      // Backward compatibility fallback in case legacy database schema uses column 'text'
      if (error && (error.code === 'PGRST204' || error.message?.includes('text_content'))) {
        const fallbackRes = await client.from('task_updates').insert([
          {
            plot_id: task.plot_id,
            task_template_id: task.task_template_id,
            role: 'Foreman',
            action: `แจ้งติดปัญหา: ${reasonLabel}`,
            text: updateText,
            progress: task.current_progress,
            is_worker_present: reasonId !== 'worker_issue',
            user_name: updatedBy,
            created_at: new Date().toISOString(),
          },
        ]);
        error = fallbackRes.error;
      }

      if (error) {
        updateError = error.message;
        console.warn('Notice: could not insert task_updates entry for roadblock', updateError);
      }
    }
  } catch (err: any) {
    updateError = err?.message || String(err);
    console.warn('Notice: could not insert roadblock entry', updateError);
  }

  // 3. Cache update locally
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const localKey = getLocalSnapshotKey(normDate, task.foreman_name);
      const cachedStr = localStorage.getItem(localKey);
      if (cachedStr) {
        const list: ForemanDailyTask[] = JSON.parse(cachedStr);
        const idx = list.findIndex(t => t.id === task.id);
        if (idx >= 0) {
          list[idx].status_reason = reasonId;
          list[idx].status_note = note;
          localStorage.setItem(localKey, JSON.stringify(list));
        }
      }
    }
  } catch (err) {
    // ignore
  }

  // 4. Determine result
  // If task_updates succeeded, the primary operational record is written and live.
  // A secondary snapshot RLS issue should NOT block the foreman from saving work.
  if (updateError && snapError) {
    const cleanError = snapError.includes('app_current_actor')
      ? 'เกิดข้อผิดพลาดด้านสิทธิ์การเข้าถึงฐานข้อมูล กรุณาลองใหม่อีกครั้ง'
      : updateError || snapError;
    return { success: false, error: cleanError };
  }

  if (updateError) {
    return { success: false, error: updateError };
  }

  return { success: true };
}

export interface ForemanReworkItem {
  id: string;
  type: 'defect' | 'task_rework';
  plot_id: string;
  plot_name: string;
  project_name: string;
  foreman_name: string;
  title: string;
  description?: string;
  task_name?: string;
  task_template_id?: string | number;
  severity?: 'high' | 'medium' | 'low';
  status: string;
  status_label: string;
  created_at?: string;
  reporter?: string;
  contractor_name?: string;
  defectObj?: any;
  taskObj?: any;
}

export interface GetForemanReworkOptions {
  plots: any[];
  defects?: any[];
  allUpdatesRecord?: any[];
  taskTemplates?: any[];
  foremanName?: string;
}

/**
 * Extracts all active defects and rejected tasks requiring rectification
 * for the specified foreman.
 */
export function getForemanReworkItems(options: GetForemanReworkOptions): ForemanReworkItem[] {
  const {
    plots = [],
    defects = [],
    allUpdatesRecord = [],
    taskTemplates = [],
    foremanName = 'all'
  } = options;

  if (!Array.isArray(plots)) return [];

  const isTargetAll = !foremanName || foremanName.toLowerCase() === 'all';
  const targetFmLower = foremanName ? foremanName.toLowerCase().trim() : '';

  // 1. Build fast plot lookup
  const plotMap = new Map<string, any>();
  const matchedPlotIds = new Set<string>();

  plots.forEach(plot => {
    const plotIdStr = String(plot.id);
    plotMap.set(plotIdStr, plot);
    const pFm = getPlotForemanName(plot);
    if (isTargetAll || pFm.toLowerCase() === targetFmLower) {
      matchedPlotIds.add(plotIdStr);
    }
  });

  // 2. Build task templates lookup
  const taskMap = new Map<string, any>();
  if (Array.isArray(taskTemplates)) {
    taskTemplates.forEach(t => {
      taskMap.set(String(t.id), t);
    });
  }

  const reworkItems: ForemanReworkItem[] = [];

  // 3. Collect active Defects (accounting for independent handover foreman assignment)
  if (Array.isArray(defects)) {
    defects.forEach(d => {
      const plotIdStr = String(d.plot_id);
      const plot = plotMap.get(plotIdStr);
      if (!plot) return;

      const isHandover = d.defect_stage === 'handover';
      const defectFm = isHandover
        ? resolveHandoverDefectForeman(d, plot)
        : getPlotForemanName(plot);

      if (!isTargetAll) {
        if (isHandover) {
          if (defectFm.toLowerCase() !== targetFmLower) return;
        } else if (!matchedPlotIds.has(plotIdStr)) {
          return;
        }
      }

      const pFm = defectFm || 'ยังไม่ระบุโฟร์แมน';
      const statusLower = (d.status || '').toLowerCase();
      const isClosed =
        statusLower === 'resolved' ||
        statusLower === 'closed' ||
        statusLower === 'completed' ||
        statusLower === 'approved' ||
        d.progress === 100;

      if (isClosed) return;

      const taskId = d.task_id || d.task_template_id;
      const task = taskId ? taskMap.get(String(taskId)) : null;

      let severity: 'high' | 'medium' | 'low' = 'medium';
      const sevLower = (d.severity || '').toLowerCase();
      if (sevLower.includes('high') || sevLower.includes('urgent') || sevLower.includes('เร่งด่วน')) {
        severity = 'high';
      } else if (sevLower.includes('low') || sevLower.includes('น้อย')) {
        severity = 'low';
      }

      const statusLabel =
        statusLower === 'in_progress' || statusLower === 'in progress'
          ? 'กำลังดำเนินการ'
          : statusLower === 'pending_verification'
          ? 'รอ QC ตรวจซ้ำ'
          : 'รอการแก้ไข';

      reworkItems.push({
        id: `defect-${d.id}`,
        type: 'defect',
        plot_id: plotIdStr,
        plot_name: plot.name || plot.plot_number || `แปลง ${plot.id}`,
        project_name: plot.project_name || 'ไอลิน',
        foreman_name: pFm,
        title: d.description || d.title || 'รายการ Defect รอแก้ไข',
        description: d.description || '',
        task_name: task?.task_name || d.task_name || 'งานทั่วไป',
        task_template_id: taskId,
        severity,
        status: d.status || 'open',
        status_label: statusLabel,
        created_at: d.created_at,
        reporter: d.reporter || d.reported_by || 'QC',
        contractor_name: d.contractor_name || '',
        defectObj: d,
        taskObj: task,
      });
    });
  }

  // 4. Collect tasks where latest update is "แจ้งแก้ไข" or "ไม่อนุมัติ"
  if (Array.isArray(allUpdatesRecord)) {
    // Group updates by explicit plotId and taskTemplateId tuple to avoid hyphen corruption
    const updatesByTask = new Map<string, { plotId: string; taskTemplateId: string; updates: any[] }>();
    allUpdatesRecord.forEach(u => {
      const plotIdStr = String(u.plot_id);
      if (!matchedPlotIds.has(plotIdStr)) return;
      if (!u.task_template_id) return;

      const taskIdStr = String(u.task_template_id);
      const groupKey = `${plotIdStr}:::${taskIdStr}`;
      if (!updatesByTask.has(groupKey)) {
        updatesByTask.set(groupKey, { plotId: plotIdStr, taskTemplateId: taskIdStr, updates: [] });
      }
      updatesByTask.get(groupKey)!.updates.push(u);
    });

    updatesByTask.forEach(({ plotId, taskTemplateId, updates: updatesList }) => {
      // Sort newest first
      updatesList.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      const latest = updatesList[0];
      if (!latest) return;

      const act = String(latest.action || '');
      const isRejected = act.includes('แจ้งแก้ไข') || act.includes('ไม่อนุมัติ') || act.includes('ตีกลับ') || act.includes('ไม่ผ่าน');

      if (!isRejected) return;

      // Check if task has already been resolved or approved after this rejection
      if (latest.progress === 100 && (act.includes('อนุมัติ') || act.includes('ผ่าน'))) {
        return;
      }

      const plot = plotMap.get(plotId);
      if (!plot) return;

      const pFm = getPlotForemanName(plot) || 'ยังไม่ระบุโฟร์แมน';
      const task = taskMap.get(taskTemplateId);

      reworkItems.push({
        id: `task-rework-${plotId}-${taskTemplateId}`,
        type: 'task_rework',
        plot_id: plotId,
        plot_name: plot.name || plot.plot_number || `แปลง ${plot.id}`,
        project_name: plot.project_name || 'ไอลิน',
        foreman_name: pFm,
        title: `งวดงานไม่ผ่าน: ${task?.task_name || 'งานก่อสร้าง'}`,
        description: latest.text_content || latest.text || latest.action || 'QC สั่งแจ้งแก้ไขงวดงาน',
        task_name: task?.task_name || 'งานก่อสร้าง',
        task_template_id: taskTemplateId,
        severity: 'high',
        status: 'rework_required',
        status_label: 'QC สั่งแก้ไข',
        created_at: latest.created_at,
        reporter: latest.user_name || latest.role || 'QC',
        contractor_name: latest.contractor_name || '',
        taskObj: task || { id: taskTemplateId, task_name: 'งานก่อสร้าง', task_order: 1 },
      });
    });
  }

  // Sort newest first
  reworkItems.sort((a, b) => {
    const timeA = a.created_at ? new Date(a.created_at).getTime() : 0;
    const timeB = b.created_at ? new Date(b.created_at).getTime() : 0;
    return timeB - timeA;
  });

  return reworkItems;
}

export interface MonthForemanWorkloadStat {
  foremanName: string;
  totalTasks: number;
  updatedTasks: number;
  roadblockTasks: number;
  pendingTasks: number;
  complianceRate: number;
  sharePercentage: number;
  plotsCount: number;
  projectsCount: number;
  projectNames: string[];
}

export interface DayInspectionCompliance {
  date: string; // YYYY-MM-DD
  dayNumber: number; // 1-31
  dayOfWeek: number; // 0 = Sunday, 1 = Monday, ... 6 = Saturday
  totalScheduled: number;
  updated: number;
  roadblock: number;
  pending: number;
  complianceRate: number; // percentage (0-100)
  status: 'complete' | 'partial' | 'missed' | 'empty' | 'future' | 'holiday';
  isToday: boolean;
  isFuture: boolean;
  isHoliday?: boolean;
  isFrozen?: boolean;
  tasksCount: number;
  plotsCount: number;
  foremanStats: Record<string, { total: number; updated: number; roadblock: number; pending: number; rate: number }>;
  tasks?: ForemanDailyTask[];
}

export interface MonthInspectionSummary {
  year: number;
  month: number; // 1-12
  monthLabel: string;
  days: DayInspectionCompliance[];
  totalWorkDays: number;
  completeDays: number;
  partialDays: number;
  missedDays: number;
  avgComplianceRate: number;
  totalMonthTasks: number;
  totalMonthUpdated: number;
  totalMonthRoadblocks: number;
  totalMonthPending: number;
  foremanWorkloadStats: MonthForemanWorkloadStat[];
}

export interface GetMonthlyInspectionOptions {
  year: number;
  month: number; // 1-12
  plots: any[];
  taskTemplates: any[];
  schedules: Record<string, any>;
  assignments?: any[];
  allUpdatesRecord?: any[];
  defects?: any[];
  defectUpdates?: any[];
  contractors?: any[];
  foremenList?: any[];
  foremanName?: string;
  projectName?: string;
  existingSnapshots?: any[];
  todayDateStr?: string;
}

const THAI_MONTH_NAMES = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
];

/**
 * Calculates monthly day-by-day inspection compliance for the Owner Audit Calendar.
 */
export function getMonthlyForemanInspectionCompliance(options: GetMonthlyInspectionOptions): MonthInspectionSummary {
  const {
    year,
    month,
    plots = [],
    taskTemplates = [],
    schedules = {},
    assignments = [],
    allUpdatesRecord = [],
    defects = [],
    defectUpdates = [],
    contractors = [],
    foremenList = [],
    foremanName = 'all',
    projectName,
    existingSnapshots = [],
    todayDateStr
  } = options;

  // Build case-insensitive canonical foreman display name lookup so e.g. 'DEN' and 'Den' merge cleanly
  const canonicalForemanDisplayMap = new Map<string, string>();
  const registerCanonicalForeman = (rawName: any, overwrite = false) => {
    const trimmed = String(rawName || '').trim();
    if (!trimmed || isUnassignedForemanName(trimmed)) return;
    const key = trimmed.toLowerCase();
    if (overwrite || !canonicalForemanDisplayMap.has(key)) {
      canonicalForemanDisplayMap.set(key, trimmed);
    }
  };
  if (Array.isArray(foremenList)) {
    foremenList.forEach(u => registerCanonicalForeman(u?.username || u?.name, true));
  }
  plots.forEach(p => {
    registerCanonicalForeman(p?.foreman_name || p?.foreman);
    registerCanonicalForeman(p?.handover_foreman_name);
  });
  (defects || []).forEach(d => {
    if (d?.defect_stage === 'handover') registerCanonicalForeman(d?.foreman_name);
  });
  const normalizeMonthlyForemanKey = (rawName?: string | null): { key: string; display: string } => {
    const trimmed = String(rawName || '').trim();
    if (!trimmed || isUnassignedForemanName(trimmed)) {
      const unassignedDisplay = trimmed || 'ยังไม่ระบุโฟร์แมน';
      return { key: '__unassigned__', display: unassignedDisplay };
    }
    const key = trimmed.toLowerCase();
    if (!canonicalForemanDisplayMap.has(key)) {
      canonicalForemanDisplayMap.set(key, trimmed);
    }
    return { key, display: canonicalForemanDisplayMap.get(key)! };
  };

  // Project filtering
  const targetProject = projectName && projectName !== 'all' ? projectName.trim() : null;
  const filteredPlots = targetProject ? plots.filter(p => p.project_name === targetProject) : plots;
  const filteredPlotIds = targetProject ? new Set(filteredPlots.map(p => String(p.id))) : null;

  const scopedDefects = filteredPlotIds
    ? (defects || []).filter(d => d && filteredPlotIds.has(String(d.plot_id)))
    : (defects || []);
  const scopedDefectIds = new Set(scopedDefects.map(d => String(d.id)));

  const scopedSnapshots = (existingSnapshots || []).filter(s => {
    if (!targetProject) return true;
    if (isDayFreezeMarkerRow(s)) return true;
    if (s.project_name === targetProject) return true;
    if (filteredPlotIds && filteredPlotIds.has(String(s.plot_id))) return true;
    return false;
  });

  // Pre-index updates by date and plot_id-task_id ONCE before the 31-day loop (R10 performance optimization)
  const updatesByDateAndKey = new Map<string, Map<string, any[]>>();
  if (Array.isArray(allUpdatesRecord)) {
    allUpdatesRecord.forEach(u => {
      if (filteredPlotIds && !filteredPlotIds.has(String(u.plot_id))) return;
      const uDate = normalizeDateStr(u.created_at) || normalizeDateStr(u.date);
      if (uDate) {
        if (!updatesByDateAndKey.has(uDate)) {
          updatesByDateAndKey.set(uDate, new Map<string, any[]>());
        }
        const key = `${u.plot_id}-${u.task_template_id}`;
        const keyMap = updatesByDateAndKey.get(uDate)!;
        if (!keyMap.has(key)) {
          keyMap.set(key, []);
        }
        keyMap.get(key)!.push(u);
      }
    });
  }

  // Pre-index defectUpdates by date and defect_id ONCE before the 31-day loop
  const defectUpdatesByDateAndDefectId = new Map<string, Map<string, any[]>>();
  if (Array.isArray(defectUpdates)) {
    defectUpdates.forEach(du => {
      if (!du || !du.defect_id) return;
      const dIdStr = String(du.defect_id);
      if (filteredPlotIds && !scopedDefectIds.has(dIdStr)) return;
      const duDate = normalizeDateStr(du.created_at) || normalizeDateStr(du.date);
      if (duDate) {
        if (!defectUpdatesByDateAndDefectId.has(duDate)) {
          defectUpdatesByDateAndDefectId.set(duDate, new Map<string, any[]>());
        }
        const keyMap = defectUpdatesByDateAndDefectId.get(duDate)!;
        if (!keyMap.has(dIdStr)) {
          keyMap.set(dIdStr, []);
        }
        keyMap.get(dIdStr)!.push(du);
      }
    });
  }

  const now = new Date();
  const actualTodayStr = todayDateStr || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  
  const daysInMonth = new Date(year, month, 0).getDate();
  const days: DayInspectionCompliance[] = [];

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dObj = new Date(year, month - 1, day);
    const dayOfWeek = dObj.getDay();
    const isToday = dateStr === actualTodayStr;
    const isFuture = dateStr > actualTodayStr;
    const isHoliday = dayOfWeek === 0;

    // Sundays are weekly foreman holidays: excluded from scheduled duty KPI, missed days, and monthly pending totals
    if (isHoliday) {
      days.push({
        date: dateStr,
        dayNumber: day,
        dayOfWeek,
        totalScheduled: 0,
        updated: 0,
        roadblock: 0,
        pending: 0,
        complianceRate: 100,
        status: 'holiday',
        isToday,
        isFuture,
        isHoliday: true,
        isFrozen: false,
        tasksCount: 0,
        plotsCount: 0,
        foremanStats: {},
        tasks: [],
      });
      continue;
    }

    // Scheduled tasks on this date using pre-indexed updates
    const preIndexedUpdates = updatesByDateAndKey.get(dateStr);
    const preIndexedDefectUpdates = defectUpdatesByDateAndDefectId.get(dateStr);
    const tasks = getForemanScheduledTasksForDate({
      plots: filteredPlots,
      taskTemplates,
      schedules,
      assignments,
      allUpdatesRecord: allUpdatesRecord,
      defects: scopedDefects,
      defectUpdates,
      contractors,
      foremenList,
      foremanName: foremanName || 'all',
      targetDate: dateStr,
      existingSnapshots: scopedSnapshots,
      preIndexedUpdates,
      preIndexedDefectUpdates,
      todayDateStr: actualTodayStr,
    });

    const summary = computeForemanDailySummary(tasks);

    let status: 'complete' | 'partial' | 'missed' | 'empty' | 'future' | 'holiday' = 'empty';
    if (isFuture) {
      status = tasks.length > 0 ? 'future' : 'empty';
    } else if (tasks.length === 0) {
      status = 'empty';
    } else if (summary.complianceRate >= 100) {
      status = 'complete';
    } else if (summary.complianceRate >= 40) {
      status = 'partial';
    } else {
      status = 'missed';
    }

    // Breakdown per foreman (count only active tasks for today's required inspection)
    const foremanStats: Record<string, { total: number; updated: number; roadblock: number; pending: number; rate: number }> = {};
    const activeTasksForDay = tasks.filter(t => !t.is_completed_early);
    activeTasksForDay.forEach(t => {
      const { display: fm } = normalizeMonthlyForemanKey(t.foreman_name);
      if (!foremanStats[fm]) {
        foremanStats[fm] = { total: 0, updated: 0, roadblock: 0, pending: 0, rate: 0 };
      }
      foremanStats[fm].total++;
      if (t.status_reason) foremanStats[fm].roadblock++;
      else if (t.is_updated_today) foremanStats[fm].updated++;
      else foremanStats[fm].pending++;
    });

    Object.keys(foremanStats).forEach(fm => {
      const st = foremanStats[fm];
      st.rate = st.total > 0 ? Math.round(((st.updated + st.roadblock) / st.total) * 100) : 100;
    });

    days.push({
      date: dateStr,
      dayNumber: day,
      dayOfWeek,
      totalScheduled: summary.totalTasks,
      updated: summary.updatedTasks,
      roadblock: summary.roadblockTasks,
      pending: summary.pendingTasks,
      complianceRate: summary.complianceRate,
      status,
      isToday,
      isFuture,
      isHoliday: false,
      isFrozen: dateStr < actualTodayStr && isPastDateFrozenInSnapshots(dateStr, scopedSnapshots, targetProject),
      tasksCount: summary.totalTasks,
      plotsCount: summary.plotsCount,
      foremanStats,
      tasks,
    });
  }

  // Monthly summary
  const activePastDays = days.filter(d => !d.isFuture && !d.isHoliday && d.totalScheduled > 0);
  const totalWorkDays = activePastDays.length;
  const completeDays = activePastDays.filter(d => d.status === 'complete').length;
  const partialDays = activePastDays.filter(d => d.status === 'partial').length;
  const missedDays = activePastDays.filter(d => d.status === 'missed').length;

  const avgComplianceRate = totalWorkDays > 0
    ? Math.round(activePastDays.reduce((acc, d) => acc + d.complianceRate, 0) / totalWorkDays)
    : 100;

  // Monthly workload aggregation per foreman (grouped case-insensitively with canonical display name)
  const foremanMap: Record<string, {
    displayName: string;
    total: number;
    updated: number;
    roadblock: number;
    pending: number;
    plots: Set<string>;
    projects: Set<string>;
  }> = {};

  let totalMonthTasks = 0;
  let totalMonthUpdated = 0;
  let totalMonthRoadblocks = 0;
  let totalMonthPending = 0;

  days.forEach(d => {
    totalMonthTasks += d.totalScheduled;
    totalMonthUpdated += d.updated;
    totalMonthRoadblocks += d.roadblock;
    totalMonthPending += d.pending;

    const activeDayTasks = (d.tasks || []).filter(t => !t.is_completed_early);
    activeDayTasks.forEach(t => {
      const { key: fmKey, display: fmDisplay } = normalizeMonthlyForemanKey(t.foreman_name);
      if (!foremanMap[fmKey]) {
        foremanMap[fmKey] = {
          displayName: fmDisplay,
          total: 0,
          updated: 0,
          roadblock: 0,
          pending: 0,
          plots: new Set<string>(),
          projects: new Set<string>(),
        };
      }
      foremanMap[fmKey].total++;
      if (t.status_reason) {
        foremanMap[fmKey].roadblock++;
      } else if (t.is_updated_today) {
        foremanMap[fmKey].updated++;
      } else {
        foremanMap[fmKey].pending++;
      }
      if (t.plot_id) foremanMap[fmKey].plots.add(String(t.plot_id));
      if (t.project_name) foremanMap[fmKey].projects.add(String(t.project_name));
    });
  });

  const foremanWorkloadStats: MonthForemanWorkloadStat[] = Object.values(foremanMap)
    .map((st) => {
      const complianceRate = st.total > 0
        ? Math.round(((st.updated + st.roadblock) / st.total) * 100)
        : 100;
      const sharePercentage = totalMonthTasks > 0
        ? Math.round((st.total / totalMonthTasks) * 100)
        : 0;
      return {
        foremanName: st.displayName,
        totalTasks: st.total,
        updatedTasks: st.updated,
        roadblockTasks: st.roadblock,
        pendingTasks: st.pending,
        complianceRate,
        sharePercentage,
        plotsCount: st.plots.size,
        projectsCount: st.projects.size,
        projectNames: Array.from(st.projects),
      };
    })
    .sort((a, b) => b.totalTasks - a.totalTasks);

  const thaiMonth = THAI_MONTH_NAMES[month - 1] || `เดือน ${month}`;
  const thaiYear = year > 2400 ? year : year + 543;
  const monthLabel = `${thaiMonth} ${thaiYear}`;

  return {
    year,
    month,
    monthLabel,
    days,
    totalWorkDays,
    completeDays,
    partialDays,
    missedDays,
    avgComplianceRate,
    totalMonthTasks,
    totalMonthUpdated,
    totalMonthRoadblocks,
    totalMonthPending,
    foremanWorkloadStats,
  };
}


export interface ForemanDailyActivityItem {
  id: string;
  timestamp: number;
  timeStr: string;
  dateStr: string;
  category: 'in_plan' | 'out_of_plan' | 'defect' | 'roadblock';
  categoryLabel: string;
  categoryColor: 'blue' | 'purple' | 'rose' | 'amber';
  plot_id: string;
  plot_name: string;
  project_name: string;
  foreman_name: string;
  actor_name: string;
  actor_role?: string;
  task_name: string;
  task_template_id?: string | number;
  action: string;
  text_content?: string;
  progress?: number;
  image_urls: string[];
  is_100_percent?: boolean;
  is_handover?: boolean;
  contractor_name?: string;
  defectObj?: any;
  taskObj?: any;
  plotObj?: any;
}

export interface ForemanDailyActivitySummary {
  totalActivities: number;
  inPlanCount: number;
  outOfPlanCount: number;
  defectCount: number;
  roadblockCount: number;
  plotsVisitedCount: number;
  items: ForemanDailyActivityItem[];
}

export interface GetForemanActivitiesOptions {
  plots: any[];
  taskTemplates: any[];
  schedules: Record<string, any>;
  assignments?: any[];
  allUpdatesRecord?: any[];
  defects?: any[];
  defectUpdates?: any[];
  contractors?: any[];
  foremenList?: any[];
  existingSnapshots?: any[];
  foremanName?: string;
  projectName?: string;
  targetDate: string;
  todayDateStr?: string;
}

/**
 * Collects and categorizes all real activities performed by a foreman on a specific date.
 * Categorizes into in-plan, out-of-plan, defect fixes, and roadblock reports.
 */
export function getForemanDailyActivities(options: GetForemanActivitiesOptions): ForemanDailyActivitySummary {
  const {
    plots = [],
    taskTemplates = [],
    schedules = {},
    assignments = [],
    allUpdatesRecord = [],
    defects = [],
    defectUpdates = [],
    contractors = [],
    foremenList = [],
    existingSnapshots = [],
    foremanName = 'all',
    projectName,
    targetDate,
    todayDateStr,
  } = options;

  if (!targetDate || !Array.isArray(plots)) {
    return {
      totalActivities: 0,
      inPlanCount: 0,
      outOfPlanCount: 0,
      defectCount: 0,
      roadblockCount: 0,
      plotsVisitedCount: 0,
      items: [],
    };
  }

  const normTargetDate = normalizeDateStr(targetDate) || targetDate;
  const isWeeklyHolidayTarget = isForemanWeeklyHoliday(normTargetDate);
  const nowBangkokStr = todayDateStr
    ? (normalizeDateStr(todayDateStr) || todayDateStr)
    : (normalizeDateStr(new Date()) || new Date().toISOString().split('T')[0]);
  const isViewingToday = normTargetDate === nowBangkokStr;
  const isTargetAll = !foremanName || foremanName.toLowerCase() === 'all';
  const targetFmLower = foremanName ? foremanName.toLowerCase().trim() : '';
  const targetProj = projectName && projectName !== 'all' ? projectName.trim() : null;

  // 1. Build plot, defect, contractor, snapshot lookups
  const plotMap = new Map<string, any>();
  plots.forEach(plot => {
    const plotIdStr = String(plot.id);
    plotMap.set(plotIdStr, plot);
  });

  const defectMap = new Map<string, any>();
  if (Array.isArray(defects)) {
    defects.forEach(d => {
      if (d && d.id !== undefined && d.id !== null) {
        defectMap.set(String(d.id), d);
      }
    });
  }

  const contractorMap = new Map<string, any>();
  if (Array.isArray(contractors)) {
    contractors.forEach(c => {
      if (c && c.id !== undefined && c.id !== null) {
        contractorMap.set(String(c.id), c);
      }
    });
  }

  const snapshotMapForDate = new Map<string, any>();
  if (Array.isArray(existingSnapshots)) {
    existingSnapshots.forEach(s => {
      if (isDayFreezeMarkerRow(s)) return;
      const sDate = normalizeDateStr(s.snapshot_date);
      if (sDate === normTargetDate) {
        snapshotMapForDate.set(`${s.plot_id}-${s.task_template_id}`, s);
      }
    });
  }

  // 2. Build task template & assignment lookups
  const taskMap = new Map<string, any>();
  if (Array.isArray(taskTemplates)) {
    taskTemplates.forEach(t => {
      taskMap.set(String(t.id), t);
    });
  }

  const assignmentMap = new Map<string, any>();
  if (Array.isArray(assignments)) {
    assignments.forEach(a => {
      assignmentMap.set(`${a.plot_id}-${a.task_template_id}`, a);
    });
  }

  const items: ForemanDailyActivityItem[] = [];

  const formatTimeStr = (isoString?: string | null): { timeStr: string; timestamp: number } => {
    if (!isoString) return { timeStr: 'วันนี้', timestamp: 0 };
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return { timeStr: 'วันนี้', timestamp: 0 };
    const bkkHours = d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false });
    return { timeStr: `${bkkHours} น.`, timestamp: d.getTime() };
  };

  // 3. Scan allUpdatesRecord for targetDate
  if (Array.isArray(allUpdatesRecord)) {
    allUpdatesRecord.forEach(u => {
      const uDate = normalizeDateStr(u.created_at || u.date);
      if (uDate !== normTargetDate) return;

      const plotIdStr = String(u.plot_id);
      const plot = plotMap.get(plotIdStr);
      if (!plot) return;

      if (targetProj && plot.project_name !== targetProj) return;

      const rawPlotFm = getPlotForemanName(plot);
      const plotFm = (!rawPlotFm || isUnassignedForemanName(rawPlotFm))
        ? 'ยังไม่ระบุ'
        : canonicalizeForemanName(rawPlotFm, foremenList);
      const actorName = (u.user_name || u.userName || '').trim();

      if (!isTargetAll) {
        const matchesPlotFm = plotFm.toLowerCase() === targetFmLower;
        const matchesActor = actorName.toLowerCase() === targetFmLower;
        if (!matchesPlotFm && !matchesActor) return;
      }

      const task = taskMap.get(String(u.task_template_id));
      const taskName = task?.task_name || u.task_name || 'งานก่อสร้าง';

      const scheduleKey = `${plot.id}-${u.task_template_id}`;
      const altScheduleKey = `${plot.id}_${u.task_template_id}`;
      const assign = assignmentMap.get(scheduleKey) || assignmentMap.get(altScheduleKey);
      const taskExcludedFromPlan = isTaskExcludedFromPlan(task, assign, plot);
      const plan = schedules[scheduleKey] || schedules[altScheduleKey];
      const pStart = normalizeDateStr(plan?.planned_start);
      const pEnd = normalizeDateStr(plan?.planned_end);

      const isRoadblockUpdate = Boolean(
        String(u.action || '').includes('ติดปัญหา') ||
        String(u.action || '').startsWith('แจ้งติดปัญหา') ||
        String(u.text_content || '').startsWith('เหตุผล:')
      );

      let category: 'in_plan' | 'out_of_plan' | 'roadblock' = 'out_of_plan';
      let categoryLabel = 'งานนอกแผน / งานล่วงหน้า';
      let categoryColor: 'blue' | 'purple' | 'amber' = 'purple';

      if (isRoadblockUpdate) {
        category = 'roadblock';
        categoryLabel = 'แจ้งเหตุผลติดปัญหา';
        categoryColor = 'amber';
      } else if (taskExcludedFromPlan) {
        category = 'out_of_plan';
        categoryLabel = 'งานไม่นับรวมในแผน / นอกแผน';
        categoryColor = 'purple';
      } else if (isWeeklyHolidayTarget) {
        category = 'out_of_plan';
        categoryLabel = 'งานวันหยุด (วันอาทิตย์)';
        categoryColor = 'purple';
      } else if (pStart && pEnd) {
        if (normTargetDate >= pStart && normTargetDate <= pEnd) {
          category = 'in_plan';
          categoryLabel = 'งานตามแผนวันนี้';
          categoryColor = 'blue';
        } else if (normTargetDate < pStart) {
          category = 'out_of_plan';
          categoryLabel = 'เริ่มงานก่อนแผน';
          categoryColor = 'purple';
        } else if (normTargetDate > pEnd) {
          category = 'out_of_plan';
          categoryLabel = 'งานเก็บตกหลังแผน';
          categoryColor = 'purple';
        }
      }

      let imageUrls: string[] = [];
      if (typeof u.image_url === 'string') {
        imageUrls = u.image_url.split(',').map((s: string) => s.trim()).filter(Boolean);
      } else if (Array.isArray(u.image_url)) {
        imageUrls = u.image_url.filter(Boolean);
      }

      const { timeStr, timestamp } = formatTimeStr(u.created_at || u.date);
      const progressNum = typeof u.progress === 'number' ? u.progress : undefined;
      const is100 = progressNum === 100 || u.is_completed === true;

      items.push({
        id: `update-${u.id || Math.random()}`,
        timestamp: timestamp || Date.now(),
        timeStr,
        dateStr: normTargetDate,
        category,
        categoryLabel,
        categoryColor,
        plot_id: plotIdStr,
        plot_name: plot.name || plot.plot_number || `แปลง ${plot.id}`,
        project_name: plot.project_name || 'ไอลิน',
        foreman_name: plotFm,
        actor_name: actorName || plotFm,
        actor_role: u.role || 'โฟร์แมน',
        task_name: taskName,
        task_template_id: u.task_template_id,
        action: u.action || (is100 ? 'ส่งงาน 100%' : 'อัปเดตความคืบหน้า'),
        text_content: u.text_content || u.text || '',
        progress: progressNum,
        image_urls: imageUrls,
        is_100_percent: is100,
        taskObj: task,
        plotObj: plot,
      });
    });
  }

  // 3b. Scan defectUpdates for targetDate (Handover inspection progress, roadblocks, and defect updates)
  if (Array.isArray(defectUpdates)) {
    defectUpdates.forEach(du => {
      const duDate = normalizeDateStr(du.created_at || du.date);
      if (duDate !== normTargetDate) return;

      const defect = defectMap.get(String(du.defect_id));
      if (!defect) return;

      const plotIdStr = String(defect.plot_id);
      const plot = plotMap.get(plotIdStr);
      if (!plot) return;

      if (targetProj && plot.project_name !== targetProj) return;

      const isHandover = defect.defect_stage === 'handover';
      const templateKey = isHandover ? `handover:${defect.id}` : (defect.task_id || defect.task_template_id);
      const snap = isHandover ? snapshotMapForDate.get(`${plot.id}-handover:${defect.id}`) : null;
      const rawLiveFm = isHandover ? resolveHandoverDefectForeman(defect, plot) : getPlotForemanName(plot);
      const liveFm = (!rawLiveFm || isUnassignedForemanName(rawLiveFm))
        ? 'ยังไม่ระบุ'
        : canonicalizeForemanName(rawLiveFm, foremenList);
      const rawSnapFm = String(snap?.foreman_name || '').trim();
      const hasConcreteSnapFm = Boolean(rawSnapFm) && !isUnassignedForemanName(rawSnapFm);
      const responsibleFm = (!isViewingToday && hasConcreteSnapFm)
        ? canonicalizeForemanName(rawSnapFm, foremenList)
        : liveFm;
      const actorName = String(du.created_by || '').trim();

      if (!isTargetAll) {
        const matchesFm = responsibleFm.toLowerCase() === targetFmLower;
        const matchesActor = actorName.toLowerCase() === targetFmLower;
        if (!matchesFm && !matchesActor) return;
      }

      const parsedRb = parseRoadblockDisplay(du.note || '', du.action || '');
      const isRoadblockUpdate = Boolean(
        parsedRb ||
        String(du.action || '').includes('ติดปัญหา') ||
        String(du.note || '').startsWith('เหตุผล:')
      );

      const pStart = normalizeDateStr(snap?.planned_start || defect.planned_start);
      const pEnd = normalizeDateStr(snap?.planned_end || defect.planned_end);

      let category: 'in_plan' | 'out_of_plan' | 'defect' | 'roadblock' = 'defect';
      let categoryLabel = 'อัปเดตงานแก้ไข Defect';
      let categoryColor: 'blue' | 'purple' | 'rose' | 'amber' = 'rose';

      if (isRoadblockUpdate) {
        category = 'roadblock';
        categoryLabel = 'แจ้งเหตุผลติดปัญหา';
        categoryColor = 'amber';
      } else if (isHandover && isWeeklyHolidayTarget) {
        category = 'out_of_plan';
        categoryLabel = 'ตรวจรับในวันหยุด (วันอาทิตย์)';
        categoryColor = 'purple';
      } else if (isHandover && pStart && pEnd) {
        if (normTargetDate >= pStart && normTargetDate <= pEnd) {
          category = 'in_plan';
          categoryLabel = 'ตรวจรับตามแผนวันนี้';
          categoryColor = 'blue';
        } else if (normTargetDate < pStart) {
          category = 'out_of_plan';
          categoryLabel = 'เริ่มตรวจรับก่อนแผน';
          categoryColor = 'purple';
        } else {
          category = 'out_of_plan';
          categoryLabel = 'เก็บตกตรวจรับหลังแผน';
          categoryColor = 'purple';
        }
      } else if (Number(du.progress) === 100) {
        category = 'defect';
        categoryLabel = 'แก้ไข Defect สำเร็จ';
        categoryColor = 'rose';
      }

      let imageUrls: string[] = [];
      const rawImgs = du.image_urls ?? du.image_url;
      if (typeof rawImgs === 'string') {
        imageUrls = rawImgs.split(',').map((s: string) => s.trim()).filter(Boolean);
      } else if (Array.isArray(rawImgs)) {
        imageUrls = rawImgs.filter(Boolean);
      }

      const { timeStr, timestamp } = formatTimeStr(du.created_at || du.date);
      const progressNum = typeof du.progress === 'number' ? du.progress : Number(du.progress ?? defect.progress ?? 0);
      const is100 = progressNum === 100;
      const taskId = defect.task_id || defect.task_template_id;
      const task = taskId ? taskMap.get(String(taskId)) : null;
      const contractorName =
        defect.contractor_name ||
        contractorMap.get(String(defect.contractor_id || ''))?.name ||
        '';

      items.push({
        id: `defect-upd-${du.id || Math.random()}`,
        timestamp: timestamp || Date.now(),
        timeStr,
        dateStr: normTargetDate,
        category,
        categoryLabel,
        categoryColor,
        plot_id: plotIdStr,
        plot_name: plot.name || plot.plot_number || `แปลง ${plot.id}`,
        project_name: plot.project_name || 'ไอลิน',
        foreman_name: responsibleFm,
        actor_name: actorName || responsibleFm,
        actor_role: du.role || (actorName.includes('QC') ? 'QC' : 'โฟร์แมน'),
        task_name: defect.description || defect.title || task?.task_name || 'รายการตรวจรับบ้าน',
        task_template_id: templateKey,
        action: isRoadblockUpdate
          ? `แจ้งติดปัญหา: ${parsedRb?.reasonLabel || 'แจ้งติดปัญหา'}`
          : (is100 ? 'แก้ไข Defect เสร็จสิ้น 100%' : `อัปเดตงาน${isHandover ? 'ตรวจรับบ้าน' : 'แก้ไข Defect'} (${progressNum}%)`),
        text_content: du.note || '',
        progress: progressNum,
        image_urls: imageUrls,
        is_100_percent: is100,
        is_handover: isHandover,
        contractor_name: contractorName,
        defectObj: defect,
        taskObj: task,
        plotObj: plot,
      });
    });
  }

  // 4. Scan defects for targetDate
  if (Array.isArray(defects)) {
    defects.forEach(d => {
      const dCreated = normalizeDateStr(d.created_at);
      const dUpdated = normalizeDateStr(d.updated_at || d.resolved_at);
      if (dCreated !== normTargetDate && dUpdated !== normTargetDate) return;

      const plotIdStr = String(d.plot_id);
      const plot = plotMap.get(plotIdStr);
      if (!plot) return;

      if (targetProj && plot.project_name !== targetProj) return;

      const isHandover = d.defect_stage === 'handover';
      const rawDefectFm = isHandover ? resolveHandoverDefectForeman(d, plot) : getPlotForemanName(plot);
      const plotFm = (!rawDefectFm || isUnassignedForemanName(rawDefectFm))
        ? 'ยังไม่ระบุ'
        : canonicalizeForemanName(rawDefectFm, foremenList);
      if (!isTargetAll && plotFm.toLowerCase() !== targetFmLower) return;

      const taskId = d.task_id || d.task_template_id;
      const task = taskId ? taskMap.get(String(taskId)) : null;

      let imageUrls: string[] = [];
      if (typeof d.image_url === 'string') {
        imageUrls = d.image_url.split(',').map((s: string) => s.trim()).filter(Boolean);
      } else if (Array.isArray(d.image_url)) {
        imageUrls = d.image_url.filter(Boolean);
      }

      const { timeStr, timestamp } = formatTimeStr(d.updated_at || d.created_at);
      const isResolved = d.status === 'resolved' || d.status === 'closed' || d.progress === 100;

      items.push({
        id: `defect-${d.id}`,
        timestamp: timestamp || Date.now(),
        timeStr,
        dateStr: normTargetDate,
        category: 'defect',
        categoryLabel: isResolved ? 'แก้ไข Defect สำเร็จ' : 'บันทึก/ส่งแก้งาน Defect',
        categoryColor: 'rose',
        plot_id: plotIdStr,
        plot_name: plot.name || plot.plot_number || `แปลง ${plot.id}`,
        project_name: plot.project_name || 'ไอลิน',
        foreman_name: plotFm,
        actor_name: d.reporter || d.reported_by || plotFm,
        actor_role: 'QC / โฟร์แมน',
        task_name: d.description || d.title || task?.task_name || 'งานแก้ไข Defect',
        task_template_id: isHandover ? `handover:${d.id}` : taskId,
        action: d.description || d.title || 'รายการแก้ไข Defect',
        text_content: d.note || d.description || '',
        progress: d.progress,
        image_urls: imageUrls,
        is_100_percent: isResolved,
        is_handover: isHandover,
        contractor_name: d.contractor_name || contractorMap.get(String(d.contractor_id || ''))?.name || '',
        defectObj: d,
        taskObj: task,
        plotObj: plot,
      });
    });
  }

  // 5. Scan snapshots for roadblocks reported on targetDate
  if (Array.isArray(existingSnapshots)) {
    existingSnapshots.forEach(s => {
      if (isDayFreezeMarkerRow(s)) return;
      const sDate = normalizeDateStr(s.snapshot_date);
      if (sDate !== normTargetDate) return;
      if (!s.status_reason) return;

      const plotIdStr = String(s.plot_id);
      const taskIdStr = String(s.task_template_id);
      // Avoid duplicate if already added from task_updates / defect_updates
      const alreadyHasRoadblock = items.some(
        it => it.category === 'roadblock' && String(it.plot_id) === plotIdStr && String(it.task_template_id) === taskIdStr
      );
      if (alreadyHasRoadblock) return;

      const plot = plotMap.get(plotIdStr);
      if (!plot) return;

      if (targetProj && plot.project_name !== targetProj) return;

      const isHandoverSnap = taskIdStr.startsWith('handover:');
      const snapDefect = isHandoverSnap ? defectMap.get(taskIdStr.slice('handover:'.length)) : undefined;
      const rawLiveSnapFm = isHandoverSnap && snapDefect
        ? resolveHandoverDefectForeman(snapDefect, plot)
        : getPlotForemanName(plot);
      const liveSnapFm = (!rawLiveSnapFm || isUnassignedForemanName(rawLiveSnapFm))
        ? 'ยังไม่ระบุ'
        : canonicalizeForemanName(rawLiveSnapFm, foremenList);
      const rawSnapFm = String(s.foreman_name || '').trim();
      const plotFm = (!isViewingToday && rawSnapFm && !isUnassignedForemanName(rawSnapFm))
        ? canonicalizeForemanName(rawSnapFm, foremenList)
        : liveSnapFm;
      if (!isTargetAll && plotFm.toLowerCase() !== targetFmLower) return;

      const reasonMeta = getRoadblockReason(s.status_reason);
      const task = !isHandoverSnap ? taskMap.get(taskIdStr) : undefined;
      if (!isHandoverSnap) {
        const assign = assignmentMap.get(`${plotIdStr}-${taskIdStr}`) || assignmentMap.get(`${plotIdStr}_${taskIdStr}`);
        if (isTaskExcludedFromPlan(task, assign, plot)) return;
      }
      const { timeStr, timestamp } = formatTimeStr(s.last_updated_at || s.updated_at);

      items.push({
        id: `roadblock-${s.id || Math.random()}`,
        timestamp: timestamp || Date.now(),
        timeStr,
        dateStr: normTargetDate,
        category: 'roadblock',
        categoryLabel: 'แจ้งเหตุผลติดปัญหา',
        categoryColor: 'amber',
        plot_id: plotIdStr,
        plot_name: plot.name || plot.plot_number || `แปลง ${plot.id}`,
        project_name: plot.project_name || 'ไอลิน',
        foreman_name: plotFm,
        actor_name: s.updated_by || plotFm,
        actor_role: 'โฟร์แมน',
        task_name: snapDefect?.description || snapDefect?.title || task?.task_name || s.task_name || (isHandoverSnap ? 'รายการตรวจรับบ้าน' : 'งานก่อสร้าง'),
        task_template_id: s.task_template_id,
        action: `${reasonMeta?.icon || '⚠️'} ${reasonMeta?.label || s.status_reason}`,
        text_content: s.status_note || '',
        image_urls: [],
        is_handover: isHandoverSnap,
        defectObj: snapDefect,
        taskObj: task,
        plotObj: plot,
      });
    });
  }

  // Sort newest first
  items.sort((a, b) => b.timestamp - a.timestamp);

  const plotsVisited = new Set(items.map(i => i.plot_id));
  const inPlanCount = items.filter(i => i.category === 'in_plan').length;
  const outOfPlanCount = items.filter(i => i.category === 'out_of_plan').length;
  const defectCount = items.filter(i => i.category === 'defect').length;
  const roadblockCount = items.filter(i => i.category === 'roadblock').length;

  return {
    totalActivities: items.length,
    inPlanCount,
    outOfPlanCount,
    defectCount,
    roadblockCount,
    plotsVisitedCount: plotsVisited.size,
    items,
  };
}
