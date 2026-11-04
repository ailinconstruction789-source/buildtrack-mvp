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
 * Loads all duty snapshots for a specific month (year and month 1-12) and foreman.
 * Used by the Owner Audit Calendar to accurately render past days and show loading progress.
 */
export async function loadForemanMonthlySnapshots(
  year: number,
  month: number,
  foremanName?: string
): Promise<any[]> {
  const startStr = `${year}-${String(month).padStart(2, '0')}-01`;
  const endDay = new Date(year, month, 0).getDate();
  const endStr = `${year}-${String(month).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`;
  const targetFmLower = foremanName ? foremanName.toLowerCase().trim() : '';

  try {
    let query = supabase
      .from('foreman_daily_duty_snapshots')
      .select('*')
      .gte('snapshot_date', startStr)
      .lte('snapshot_date', endStr);

    if (targetFmLower && targetFmLower !== 'all') {
      query = query.ilike('foreman_name', targetFmLower);
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
      const prefix = `bt_foreman_snapshot_${year}-${String(month).padStart(2, '0')}`;
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(prefix)) {
          const raw = localStorage.getItem(key);
          if (raw) {
            try {
              const parsed = JSON.parse(raw);
              if (Array.isArray(parsed)) results.push(...parsed);
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

  // 3. Collect active Defects
  if (Array.isArray(defects)) {
    defects.forEach(d => {
      const plotIdStr = String(d.plot_id);
      if (!matchedPlotIds.has(plotIdStr)) return;

      const plot = plotMap.get(plotIdStr);
      if (!plot) return;

      const pFm = getPlotForemanName(plot) || 'ยังไม่ระบุโฟร์แมน';
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
    // Group updates by `${plot_id}-${task_template_id}`
    const updatesByTask = new Map<string, any[]>();
    allUpdatesRecord.forEach(u => {
      const plotIdStr = String(u.plot_id);
      if (!matchedPlotIds.has(plotIdStr)) return;
      if (!u.task_template_id) return;

      const key = `${plotIdStr}-${u.task_template_id}`;
      if (!updatesByTask.has(key)) {
        updatesByTask.set(key, []);
      }
      updatesByTask.get(key)!.push(u);
    });

    updatesByTask.forEach((updatesList, key) => {
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

      const [plotIdStr, taskIdStr] = key.split('-');
      const plot = plotMap.get(plotIdStr);
      if (!plot) return;

      const pFm = getPlotForemanName(plot) || 'ยังไม่ระบุโฟร์แมน';
      const task = taskMap.get(taskIdStr);

      reworkItems.push({
        id: `task-rework-${key}`,
        type: 'task_rework',
        plot_id: plotIdStr,
        plot_name: plot.name || plot.plot_number || `แปลง ${plot.id}`,
        project_name: plot.project_name || 'ไอลิน',
        foreman_name: pFm,
        title: `งวดงานไม่ผ่าน: ${task?.task_name || 'งานก่อสร้าง'}`,
        description: latest.text || latest.action || 'QC สั่งแจ้งแก้ไขงวดงาน',
        task_name: task?.task_name || 'งานก่อสร้าง',
        task_template_id: taskIdStr,
        severity: 'high',
        status: 'rework_required',
        status_label: 'QC สั่งแก้ไข',
        created_at: latest.created_at,
        reporter: latest.user_name || latest.role || 'QC',
        contractor_name: latest.contractor_name || '',
        taskObj: task || { id: taskIdStr, task_name: 'งานก่อสร้าง', task_order: 1 },
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

export interface DayInspectionCompliance {
  date: string; // YYYY-MM-DD
  dayNumber: number; // 1-31
  dayOfWeek: number; // 0 = Sunday, 1 = Monday, ... 6 = Saturday
  totalScheduled: number;
  updated: number;
  roadblock: number;
  pending: number;
  complianceRate: number; // percentage (0-100)
  status: 'complete' | 'partial' | 'missed' | 'empty' | 'future';
  isToday: boolean;
  isFuture: boolean;
  tasksCount: number;
  plotsCount: number;
  foremanStats: Record<string, { total: number; updated: number; roadblock: number; pending: number; rate: number }>;
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
}

export interface GetMonthlyInspectionOptions {
  year: number;
  month: number; // 1-12
  plots: any[];
  taskTemplates: any[];
  schedules: Record<string, any>;
  assignments?: any[];
  allUpdatesRecord?: any[];
  foremanName?: string;
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
    foremanName = 'all',
    existingSnapshots = [],
    todayDateStr
  } = options;

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

    // Scheduled tasks on this date
    const tasks = getForemanScheduledTasksForDate({
      plots,
      taskTemplates,
      schedules,
      assignments,
      allUpdatesRecord,
      foremanName: foremanName || 'all',
      targetDate: dateStr,
      existingSnapshots,
    });

    const summary = computeForemanDailySummary(tasks);

    let status: 'complete' | 'partial' | 'missed' | 'empty' | 'future' = 'empty';
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

    // Breakdown per foreman
    const foremanStats: Record<string, { total: number; updated: number; roadblock: number; pending: number; rate: number }> = {};
    tasks.forEach(t => {
      const fm = t.foreman_name || 'ยังไม่ระบุ';
      if (!foremanStats[fm]) {
        foremanStats[fm] = { total: 0, updated: 0, roadblock: 0, pending: 0, rate: 0 };
      }
      foremanStats[fm].total++;
      if (t.is_updated_today) foremanStats[fm].updated++;
      else if (t.status_reason) foremanStats[fm].roadblock++;
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
      tasksCount: summary.totalTasks,
      plotsCount: summary.plotsCount,
      foremanStats,
    });
  }

  // Monthly summary
  const activePastDays = days.filter(d => !d.isFuture && d.totalScheduled > 0);
  const totalWorkDays = activePastDays.length;
  const completeDays = activePastDays.filter(d => d.status === 'complete').length;
  const partialDays = activePastDays.filter(d => d.status === 'partial').length;
  const missedDays = activePastDays.filter(d => d.status === 'missed').length;

  const avgComplianceRate = totalWorkDays > 0
    ? Math.round(activePastDays.reduce((acc, d) => acc + d.complianceRate, 0) / totalWorkDays)
    : 100;

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
  };
}
