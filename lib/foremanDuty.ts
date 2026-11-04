/**
 * Foreman Duty & Daily Work Dispatch Helper
 * 
 * Manages daily task schedules, point-in-time plan snapshots,
 * and inspection compliance for foremen.
 */

import { supabase } from './supabase';

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
  const match = ROADBLOCK_REASONS.find(r => r.id === reasonId);
  if (match) return match;
  return {
    id: reasonId,
    label: reasonId,
    icon: '⚠️',
    color: 'slate',
    description: reasonId,
  };
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
}

export interface ForemanDailySummary {
  totalTasks: number;
  updatedTasks: number;
  roadblockTasks: number;
  pendingTasks: number;
  complianceRate: number; // percentage (0-100)
  plotsCount: number;
}

export interface GetForemanTasksOptions {
  plots: any[];
  taskTemplates: any[];
  schedules: Record<string, any>;
  assignments?: any[];
  allUpdatesRecord?: any[];
  foremanName: string; // specific foreman username or 'all'
  targetDate: string;  // YYYY-MM-DD
  existingSnapshots?: any[];
}

/**
 * Normalizes date input to YYYY-MM-DD format.
 */
export function normalizeDateStr(dateInput: any): string | null {
  if (!dateInput) return null;
  if (typeof dateInput === 'string') {
    // If already YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) return dateInput;
    // If ISO string like 2026-11-04T...
    if (dateInput.includes('T')) return dateInput.split('T')[0];
    const d = new Date(dateInput);
    if (!isNaN(d.getTime())) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    }
  }
  if (dateInput instanceof Date && !isNaN(dateInput.getTime())) {
    const y = dateInput.getFullYear();
    const m = String(dateInput.getMonth() + 1).padStart(2, '0');
    const day = String(dateInput.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
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
    foremanName,
    targetDate,
    existingSnapshots = []
  } = options;

  if (!targetDate || !Array.isArray(plots)) return [];

  const normTargetDate = normalizeDateStr(targetDate) || targetDate;
  const isTargetAll = !foremanName || foremanName.toLowerCase() === 'all';
  const targetFmLower = foremanName ? foremanName.toLowerCase().trim() : '';

  // 1. Build fast map of existing snapshots for this date
  const snapshotMap = new Map<string, any>();
  if (Array.isArray(existingSnapshots)) {
    existingSnapshots.forEach(snap => {
      const snapDate = normalizeDateStr(snap.snapshot_date);
      if (snapDate === normTargetDate) {
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

  // 3. Build fast map of updates on target date by plot_id-task_template_id
  const targetDateUpdatesMap = new Map<string, any[]>();
  if (Array.isArray(allUpdatesRecord)) {
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

  // 4. Filter plots assigned to foreman
  const matchedPlots = plots.filter(plot => {
    const pFm = getPlotForemanName(plot);
    if (isTargetAll) return true;
    return pFm.toLowerCase() === targetFmLower;
  });

  const dailyTasks: ForemanDailyTask[] = [];

  matchedPlots.forEach(plot => {
    const plotFm = getPlotForemanName(plot) || 'ยังไม่ระบุโฟร์แมน';
    const plotName = plot.name || plot.plot_number || `แปลง ${plot.id}`;
    const projectName = plot.project_name || 'ไอลิน';

    // Tasks for this plot: match house_type_id if available, or all templates
    const plotTasks = Array.isArray(taskTemplates)
      ? taskTemplates.filter(t => !plot.house_type_id || !t.house_type_id || String(t.house_type_id) === String(plot.house_type_id))
      : [];

    plotTasks.forEach(task => {
      const scheduleKey = `${plot.id}-${task.id}`;
      const altScheduleKey = `${plot.id}_${task.id}`;
      const plan = schedules[scheduleKey] || schedules[altScheduleKey];
      const snapshot = snapshotMap.get(scheduleKey);

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

      // Current progress check
      const assign = assignmentMap.get(scheduleKey);
      const curProgress = Number(snapshot?.current_progress ?? assign?.current_progress ?? 0);

      // If already 100% completed, check if completed BEFORE targetDate
      if (curProgress >= 100) {
        const actualEnd = normalizeDateStr(assign?.actual_end_date);
        if (actualEnd && actualEnd < normTargetDate) {
          // Task completed in the past before this target date
          return;
        }
      }

      // Check updates on target date
      const updatesToday = targetDateUpdatesMap.get(scheduleKey) || [];
      const latestUpdateToday = updatesToday[0] || null;
      const isUpdatedToday = Boolean(
        snapshot?.is_updated_today ||
        updatesToday.length > 0
      );

      const statusReason = snapshot?.status_reason || null;
      const statusNote = snapshot?.status_note || null;
      const contractorName = assign?.contractor_name || assign?.contractors?.name || plan?.contractor_name || '';

      dailyTasks.push({
        id: scheduleKey,
        plot_id: String(plot.id),
        plot_name: plotName,
        project_name: projectName,
        house_type_id: plot.house_type_id ? String(plot.house_type_id) : undefined,
        foreman_name: plotFm,
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
      });
    });
  });

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
  const totalTasks = tasks.length;
  let updatedTasks = 0;
  let roadblockTasks = 0;
  let pendingTasks = 0;

  const plotSet = new Set<string>();

  tasks.forEach(t => {
    plotSet.add(t.plot_id);
    if (t.is_updated_today) {
      updatedTasks++;
    } else if (t.status_reason) {
      roadblockTasks++;
    } else {
      pendingTasks++;
    }
  });

  // Compliance counts both actual progress updates and valid roadblock reason reports
  const compliantCount = updatedTasks + roadblockTasks;
  const complianceRate = totalTasks > 0 ? Math.round((compliantCount / totalTasks) * 100) : 100;

  return {
    totalTasks,
    updatedTasks,
    roadblockTasks,
    pendingTasks,
    complianceRate,
    plotsCount: plotSet.size,
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
  updatedBy: string = 'Foreman'
): Promise<{ success: boolean; count: number; error?: string }> {
  if (!Array.isArray(tasks) || tasks.length === 0) {
    return { success: true, count: 0 };
  }

  const normDate = normalizeDateStr(snapshotDate) || snapshotDate;

  // 1. Save to localStorage immediately as fast resilient cache
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const localKey = getLocalSnapshotKey(normDate, foremanName);
      localStorage.setItem(localKey, JSON.stringify(tasks));
    }
  } catch (err) {
    console.warn('Could not cache foreman snapshot in localStorage', err);
  }

  // 2. Dual-write to Supabase table foreman_daily_duty_snapshots
  try {
    const rows = tasks.map(t => ({
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
      last_updated_at: t.last_updated_at || new Date().toISOString(),
      updated_by: updatedBy,
      updated_at: new Date().toISOString(),
    }));

    const { data, error } = await supabase
      .from('foreman_daily_duty_snapshots')
      .upsert(rows, { onConflict: 'snapshot_date,plot_id,task_template_id' })
      .select('id');

    if (error) {
      console.warn('Supabase snapshot upsert notice (fallback used):', error.message);
      return { success: true, count: tasks.length };
    }

    return { success: true, count: data?.length || tasks.length };
  } catch (err: any) {
    console.warn('Supabase snapshot save error (fallback to local cache):', err?.message || err);
    return { success: true, count: tasks.length };
  }
}

/**
 * Loads daily snapshot for a specific date and foreman.
 * Falls back to localStorage cache if Supabase table is not yet migrated.
 */
export async function loadForemanDailySnapshot(
  snapshotDate: string,
  foremanName?: string
): Promise<any[]> {
  const normDate = normalizeDateStr(snapshotDate) || snapshotDate;
  const targetFmLower = foremanName ? foremanName.toLowerCase().trim() : '';

  try {
    let query = supabase
      .from('foreman_daily_duty_snapshots')
      .select('*')
      .eq('snapshot_date', normDate);

    if (targetFmLower && targetFmLower !== 'all') {
      query = query.ilike('foreman_name', targetFmLower);
    }

    const { data, error } = await query;
    if (!error && Array.isArray(data) && data.length > 0) {
      return data;
    }
  } catch (err) {
    // Fall back to local storage
  }

  // Fallback: check localStorage
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const localKey = getLocalSnapshotKey(normDate, foremanName || 'all');
      const cached = localStorage.getItem(localKey);
      if (cached) {
        return JSON.parse(cached);
      }
    }
  } catch (err) {
    // ignore
  }

  return [];
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
  updatedBy: string = 'Foreman'
): Promise<{ success: boolean; error?: string }> {
  const normDate = normalizeDateStr(targetDate) || targetDate;
  const reasonMeta = getRoadblockReason(reasonId);
  const reasonLabel = reasonMeta ? reasonMeta.label : reasonId;

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

    await supabase
      .from('foreman_daily_duty_snapshots')
      .upsert([row], { onConflict: 'snapshot_date,plot_id,task_template_id' });
  } catch (err) {
    console.warn('Snapshot reason upsert fallback notice:', err);
  }

  // 2. Also log in task_updates so it appears in plot feed and timeline
  try {
    const updateText = note ? `เหตุผล: ${reasonLabel} (${note})` : `เหตุผล: ${reasonLabel}`;
    await supabase.from('task_updates').insert([
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
  } catch (err) {
    console.warn('Notice: could not insert task_updates entry for roadblock', err);
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

  return { success: true };
}
