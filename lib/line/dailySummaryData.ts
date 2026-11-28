import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { isExternalProject } from '@/lib/projectUtils';
import { isRelevantExecutiveProject } from '@/lib/constructionReportsIndex';
import {
  diffCalendarDays,
  getBangkokDayWindow,
  toBangkokDateString,
  type BangkokDayWindow,
} from './bangkokDate';
import type {
  DailySummaryReport,
  ProjectConstructionMetrics,
  SalesSummaryMetrics,
  TransferScheduleItem,
  UrgentAlertItem,
} from './dailySummaryTypes';

export interface RawProjectRow {
  id?: string | number;
  name?: string | null;
  is_closed?: boolean | null;
  is_external?: boolean | null;
  layout_data?: unknown;
}

export interface RawPlotRow {
  id: string | number;
  plot_name?: string | null;
  project_name?: string | null;
  house_type_id?: string | number | null;
  is_completed?: boolean | null;
  progress?: number | null;
  sale_status?: string | null;
  foreman_name?: string | null;
}

export interface RawTaskTemplateRow {
  id: string | number;
  house_type_id?: string | number | null;
  task_name?: string | null;
  cost?: number | string | null;
  require_qc?: boolean | null;
  is_progress_counted?: boolean | null;
}

export interface RawAssignmentRow {
  plot_id: string | number;
  task_template_id: string | number;
  current_progress?: number | null;
  is_excluded?: boolean | null;
  latest_action?: string | null;
  latest_role?: string | null;
  latest_update_created_at?: string | null;
}

export interface RawScheduleRow {
  plot_id: string | number;
  task_template_id: string | number;
  planned_start?: string | null;
  planned_end?: string | null;
}

export interface RawTaskUpdateRow {
  plot_id: string | number;
  task_template_id: string | number;
  progress?: number | null;
  action?: string | null;
  role?: string | null;
  created_at: string;
  is_worker_present?: boolean | null;
}

export interface RawInspectionQueueRow {
  plot_id: string | number;
  task_template_id: string | number;
  project_name?: string | null;
  statusFor?: string | null;
  created_at?: string | null;
}

export interface RawQcInspectionRow {
  id?: string;
  plot_id: string | number;
  task_template_id: string | number;
  document_status?: string | null;
  overall_result?: string | null;
  inspected_at?: string | null;
  created_at?: string | null;
}

export interface RawQcLeaveRow {
  id?: string;
  applicant_username?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  status?: string | null;
}

export interface RawDefectRow {
  id?: string;
  plot_id: string | number;
  status?: string | null;
  created_at?: string | null;
}

export interface RawMaterialRequestRow {
  id?: string;
  plot_id: string | number;
  status?: string | null;
  requested_at?: string | null;
}

export interface RawLeadRow {
  id: string | number;
  project_name?: string | null;
  customer_name?: string | null;
  status?: string | null;
  crm_status?: string | null;
  lead_date?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  contacted_date?: string | null;
  actual_visit_date?: string | null;
  booking_date?: string | null;
  loan_approved_date?: string | null;
  transferred_date?: string | null;
  interested_plot_id?: string | number | null;
  interested_plot_name?: string | null;
}

export interface RawSaleRow {
  id: string | number;
  lead_id?: string | number | null;
  plot_id?: string | number | null;
  contract_status?: string | null;
  crm_stage?: string | null;
  bank_status?: string | null;
  expected_transfer_date?: string | null;
  transferred_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface RawLeadVisitRow {
  id?: string | number;
  lead_id?: string | number | null;
  project_name?: string | null;
  visit_date?: string | null;
  visited_at?: string | null;
  created_at?: string | null;
}

export interface RawCustomerVoiceRow {
  id?: string | number;
  project_name?: string | null;
  customer_name?: string | null;
  survey_date?: string | null;
  created_at?: string | null;
  score_average?: number | string | null;
}

export interface DailySummaryRawData {
  projects: RawProjectRow[];
  plots: RawPlotRow[];
  taskTemplates: RawTaskTemplateRow[];
  assignments: RawAssignmentRow[];
  schedules: RawScheduleRow[];
  todayUpdates: RawTaskUpdateRow[];
  recentUpdatesBeforeToday: RawTaskUpdateRow[];
  inspectionQueue: RawInspectionQueueRow[];
  qcInspections: RawQcInspectionRow[];
  qcLeaves: RawQcLeaveRow[];
  defects: RawDefectRow[];
  materialRequests: RawMaterialRequestRow[];
  leads: RawLeadRow[];
  sales: RawSaleRow[];
  leadVisits: RawLeadVisitRow[];
  customerVoices: RawCustomerVoiceRow[];
}

export interface DailySummaryOptions {
  reportDate?: string | Date;
  projectFilter?: string | null;
  appUrl?: string | null;
}

/**
 * Creates a server-side Supabase client for cron/webhook tasks.
 * Prefers SUPABASE_SERVICE_ROLE_KEY so server-side aggregation can read all tables regardless of RLS.
 */
export function createLineSummarySupabaseClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error('Missing Supabase credentials (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)');
  }
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

interface FilterableQuery<T> {
  eq(column: string, value: unknown): FilterableQuery<T>;
  gte(column: string, value: unknown): FilterableQuery<T>;
  lte(column: string, value: unknown): FilterableQuery<T>;
  lt(column: string, value: unknown): FilterableQuery<T>;
  in(column: string, values: unknown[]): FilterableQuery<T>;
  range(from: number, to: number): PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
}

async function fetchAllRows<T>(
  supabase: SupabaseClient,
  table: string,
  select: string,
  options?: {
    optional?: boolean;
    applyFilter?: (query: FilterableQuery<T>) => FilterableQuery<T>;
    chunkSize?: number;
  },
): Promise<T[]> {
  const chunkSize = options?.chunkSize ?? 1000;
  const rows: T[] = [];
  let from = 0;

  while (true) {
    let query = supabase.from(table).select(select) as unknown as FilterableQuery<T>;
    if (options?.applyFilter) {
      query = options.applyFilter(query);
    }

    const { data, error } = await query.range(from, from + chunkSize - 1);
    if (error) {
      if (options?.optional) {
        return [];
      }
      throw new Error(`Failed querying ${table}: ${error.message}`);
    }

    const batch = Array.isArray(data) ? data : [];
    rows.push(...batch);
    if (batch.length < chunkSize) break;
    from += chunkSize;
  }

  return rows;
}

async function safeSelectProjects(supabase: SupabaseClient): Promise<RawProjectRow[]> {
  const { data, error } = await supabase
    .from('projects')
    .select('id, name, is_closed, is_external, layout_data');
  if (!error && data) return data as RawProjectRow[];

  // Fallback if is_external or is_closed columns do not exist yet
  const fallback = await supabase.from('projects').select('id, name, layout_data');
  if (fallback.error) throw new Error(`Failed querying projects: ${fallback.error.message}`);
  return (fallback.data || []) as RawProjectRow[];
}

function isPlotCompleted(plot: RawPlotRow): boolean {
  return Boolean(plot?.is_completed) || plot?.sale_status === 'transferred';
}

function isDefectOpen(defect: RawDefectRow): boolean {
  const status = String(defect?.status || '').toLowerCase().trim();
  return !['resolved', 'closed', 'completed', 'done', 'cancelled'].includes(status);
}

function isCancelledStatus(status: unknown, crmStatus?: unknown): boolean {
  const s = String(status || '').toLowerCase();
  const c = String(crmStatus || '').toLowerCase();
  return (
    s.includes('cancel') ||
    s.includes('lost') ||
    c.includes('ยกเลิก') ||
    c.includes('lost') ||
    c.includes('ยุติ')
  );
}

function isTransferredStatus(status: unknown, crmStatus?: unknown, crmStage?: unknown): boolean {
  const s = String(status || '').toLowerCase();
  const c = String(crmStatus || '').toLowerCase();
  const st = String(crmStage || '').toLowerCase();
  return (
    s === 'transferred' ||
    s === 'handover' ||
    st === 'transferred' ||
    st === 'handover' ||
    c.includes('โอนกรรมสิทธิ์') ||
    c.includes('transferred')
  );
}

function computeTaskPlannedProgress(plannedStart: unknown, plannedEnd: unknown, todayStr: string): number {
  const startStr = toBangkokDateString(plannedStart as string | null);
  const endStr = toBangkokDateString(plannedEnd as string | null);
  if (!startStr || !endStr) return 0;
  if (todayStr >= endStr) return 100;
  if (todayStr <= startStr) return 0;
  const totalDays = diffCalendarDays(startStr, endStr);
  if (totalDays <= 0) return 100;
  const elapsedDays = diffCalendarDays(startStr, todayStr);
  return Math.max(0, Math.min(100, (elapsedDays / totalDays) * 100));
}

function isQcApprovalAction(action: string): boolean {
  return (
    action.includes('QC อนุมัติ') ||
    action.includes('QC ผ่าน') ||
    action.includes('PE อนุมัติ') ||
    (action.includes('QC') && (action.includes('อนุมัติ') || action.includes('ผ่าน')))
  );
}

function isQcRejectionAction(action: string): boolean {
  return (
    action.includes('ไม่อนุมัติ') ||
    action.includes('ไม่ผ่าน') ||
    action.includes('แจ้งแก้ไข') ||
    action.includes('ตีกลับ')
  );
}

function buildInspectionQueueFallback(
  assignments: RawAssignmentRow[],
  plotById: Map<string, RawPlotRow>,
): RawInspectionQueueRow[] {
  const items: RawInspectionQueueRow[] = [];
  for (const a of assignments) {
    if (a.is_excluded) continue;
    const plot = plotById.get(String(a.plot_id));
    if (!plot) continue;
    const progress = Number(a.current_progress) || 0;
    const action = String(a.latest_action || '');
    const role = String(a.latest_role || '');

    let statusFor: string | null = null;
    if (progress === 100 && (action === 'ส่งงาน 100%' || role === 'Foreman')) {
      statusFor = 'Site Engineer';
    } else if (progress === 100 && action === 'Site Engineer อนุมัติ') {
      statusFor = 'QC';
    } else if (progress === 95 && isQcRejectionAction(action)) {
      statusFor = 'Rework';
    }

    if (statusFor) {
      items.push({
        plot_id: a.plot_id,
        task_template_id: a.task_template_id,
        project_name: plot.project_name,
        statusFor,
        created_at: a.latest_update_created_at,
      });
    }
  }
  return items;
}

function emptyConstructionMetrics(projectName: string): ProjectConstructionMetrics {
  return {
    projectName,
    totalPlots: 0,
    activePlots: 0,
    completedPlots: 0,
    actualProgressPct: 0,
    plannedProgressPct: 0,
    variancePct: 0,
    todayDeltaPct: 0,
    delayedPlots: 0,
    plotsWithWorkersToday: 0,
    plotsWithoutWorkersToday: 0,
    plotsUpdatedToday: 0,
    qcEnteredToday: 0,
    qcInspectedToday: 0,
    qcPassedToday: 0,
    qcRejectedToday: 0,
    qcBacklogTotal: 0,
    qcBacklogOverdue3Days: 0,
    sePendingCount: 0,
    reworkPendingCount: 0,
    pePendingCount: 0,
  };
}

/**
 * Pure computation engine: converts raw Supabase rows into a structured DailySummaryReport.
 * Exported for deterministic unit testing.
 */
export function computeDailySummaryReport(
  raw: DailySummaryRawData,
  options: DailySummaryOptions = {},
): DailySummaryReport {
  const window: BangkokDayWindow = getBangkokDayWindow(options.reportDate);
  const projectFilter = options.projectFilter?.trim() || null;

  // 1. Determine active commercial projects
  const activeProjects = (raw.projects || []).filter((proj) => {
    if (!proj?.name) return false;
    if (projectFilter) return proj.name === projectFilter;
    if (proj.is_closed) return false;
    if (!isRelevantExecutiveProject(proj.name)) return false;
    if (isExternalProject(proj)) return false;
    return true;
  });

  const activeProjectNames = new Set(activeProjects.map((p) => String(p.name)));
  if (activeProjectNames.size === 0 && projectFilter) {
    activeProjectNames.add(projectFilter);
  }

  const scopedPlots = (raw.plots || []).filter((p) => activeProjectNames.has(String(p.project_name)));
  const plotById = new Map<string, RawPlotRow>();
  for (const plot of scopedPlots) {
    plotById.set(String(plot.id), plot);
  }

  // Group templates by house_type_id
  const templatesByHouseType = new Map<string, RawTaskTemplateRow[]>();
  for (const t of raw.taskTemplates || []) {
    const htId = String(t.house_type_id);
    const list = templatesByHouseType.get(htId);
    if (list) list.push(t);
    else templatesByHouseType.set(htId, [t]);
  }

  // Index assignments & schedules by plot_id -> task_template_id
  const assignmentByPlotTask = new Map<string, RawAssignmentRow>();
  for (const a of raw.assignments || []) {
    if (!plotById.has(String(a.plot_id))) continue;
    assignmentByPlotTask.set(`${a.plot_id}::${a.task_template_id}`, a);
  }

  const scheduleByPlotTask = new Map<string, RawScheduleRow>();
  for (const s of raw.schedules || []) {
    if (!plotById.has(String(s.plot_id))) continue;
    scheduleByPlotTask.set(`${s.plot_id}::${s.task_template_id}`, s);
  }

  // Track latest progress before today (for calculating today's progress delta)
  const latestProgressBeforeToday = new Map<string, { progress: number; time: number }>();
  for (const u of raw.recentUpdatesBeforeToday || []) {
    if (!plotById.has(String(u.plot_id))) continue;
    const tMs = Date.parse(u.created_at);
    if (!Number.isFinite(tMs) || tMs >= window.startMs) continue;
    const key = `${u.plot_id}::${u.task_template_id}`;
    const prev = latestProgressBeforeToday.get(key);
    if (!prev || tMs > prev.time) {
      latestProgressBeforeToday.set(key, { progress: Number(u.progress) || 0, time: tMs });
    }
  }

  // Today's updates scoped to active plots and within Bangkok today
  const scopedTodayUpdates = (raw.todayUpdates || []).filter((u) => {
    if (!plotById.has(String(u.plot_id))) return false;
    const dStr = toBangkokDateString(u.created_at);
    return dStr === window.dateStr;
  });

  const tasksUpdatedToday = new Set<string>();
  const tasksWithWorkProgressToday = new Set<string>();
  for (const u of scopedTodayUpdates) {
    const key = `${u.plot_id}::${u.task_template_id}`;
    tasksUpdatedToday.add(key);
    const action = String(u.action || '');
    const role = String(u.role || '');
    const isReviewOnlyAction =
      role === 'QC' ||
      role === 'PE' ||
      action === 'Site Engineer อนุมัติ' ||
      isQcApprovalAction(action) ||
      isQcRejectionAction(action);
    if (!isReviewOnlyAction) {
      tasksWithWorkProgressToday.add(key);
    }
  }

  // Compute plot-level actual, planned, and start-of-day progress
  interface PlotProgressStat {
    plot: RawPlotRow;
    actualPct: number;
    plannedPct: number;
    startOfDayPct: number;
    weight: number;
    isDelayed: boolean;
    isCompleted: boolean;
  }

  const plotStats = new Map<string, PlotProgressStat>();
  for (const plot of scopedPlots) {
    const plotId = String(plot.id);
    const templates = templatesByHouseType.get(String(plot.house_type_id)) || [];

    let totalCost = 0;
    let weightedActual = 0;
    let weightedPlanned = 0;
    let weightedStartOfDay = 0;
    let countedTasks = 0;

    for (const tmpl of templates) {
      if (tmpl.is_progress_counted === false) continue;
      const key = `${plotId}::${tmpl.id}`;
      const assign = assignmentByPlotTask.get(key);
      if (assign?.is_excluded) continue;

      countedTasks++;
      const cost = Number(tmpl.cost) > 0 ? Number(tmpl.cost) : 1;
      const actualProg = Number(assign?.current_progress) || 0;
      const sched = scheduleByPlotTask.get(key);
      const plannedProg = sched
        ? computeTaskPlannedProgress(sched.planned_start, sched.planned_end, window.dateStr)
        : 0;

      // Estimate progress at 00:00 today
      let startProg = actualProg;
      if (tasksUpdatedToday.has(key)) {
        const before = latestProgressBeforeToday.get(key);
        if (before) {
          startProg = before.progress;
        } else if (tasksWithWorkProgressToday.has(key)) {
          startProg = 0;
        }
      }

      totalCost += cost;
      weightedActual += actualProg * cost;
      weightedPlanned += plannedProg * cost;
      weightedStartOfDay += startProg * cost;
    }

    const completed = isPlotCompleted(plot);
    const actualPct =
      totalCost > 0
        ? weightedActual / totalCost
        : completed
          ? 100
          : Number(plot.progress) || 0;
    const plannedPct = totalCost > 0 ? weightedPlanned / totalCost : completed ? 100 : 0;
    const startOfDayPct = totalCost > 0 ? weightedStartOfDay / totalCost : actualPct;

    const isDelayed =
      !completed &&
      plot.sale_status !== 'ready_for_sale' &&
      actualPct < 100 &&
      countedTasks > 0 &&
      plannedPct > 0 &&
      actualPct + 0.5 < plannedPct;

    plotStats.set(plotId, {
      plot,
      actualPct,
      plannedPct,
      startOfDayPct,
      weight: totalCost > 0 ? totalCost : 1,
      isDelayed,
      isCompleted: completed || actualPct >= 100,
    });
  }

  // Worker presence per plot today
  const workerPresentByPlot = new Map<string, boolean>();
  for (const u of scopedTodayUpdates) {
    const plotId = String(u.plot_id);
    const present = u.is_worker_present !== false;
    if (present || !workerPresentByPlot.has(plotId)) {
      workerPresentByPlot.set(plotId, present);
    }
  }

  // Inspection queue (prefer vw_inspection_queue, fallback to assignments)
  const queueRows =
    raw.inspectionQueue && raw.inspectionQueue.length > 0
      ? raw.inspectionQueue.filter((q) => plotById.has(String(q.plot_id)))
      : buildInspectionQueueFallback(raw.assignments || [], plotById);

  // QC inspections pending PE & today's form submissions
  const scopedQcInspections = (raw.qcInspections || []).filter((qi) =>
    plotById.has(String(qi.plot_id)),
  );

  // Count QC events today from task_updates (deduplicated per plot+task+outcome)
  const qcEnteredKeysByProject = new Map<string, Set<string>>();
  const qcPassedKeysByProject = new Map<string, Set<string>>();
  const qcRejectedKeysByProject = new Map<string, Set<string>>();

  const addKey = (map: Map<string, Set<string>>, proj: string, key: string) => {
    let set = map.get(proj);
    if (!set) {
      set = new Set();
      map.set(proj, set);
    }
    set.add(key);
  };

  for (const u of scopedTodayUpdates) {
    const plot = plotById.get(String(u.plot_id));
    if (!plot) continue;
    const projName = String(plot.project_name);
    const taskKey = `${u.plot_id}::${u.task_template_id}`;
    const action = String(u.action || '');
    const role = String(u.role || '');

    if (action === 'Site Engineer อนุมัติ') {
      addKey(qcEnteredKeysByProject, projName, taskKey);
    }

    if (role === 'QC' || role === 'PE' || action.includes('QC') || action.includes('PE อนุมัติ')) {
      if (isQcRejectionAction(action)) {
        addKey(qcRejectedKeysByProject, projName, taskKey);
      } else if (isQcApprovalAction(action)) {
        addKey(qcPassedKeysByProject, projName, taskKey);
      }
    }
  }

  for (const qi of scopedQcInspections) {
    const plot = plotById.get(String(qi.plot_id));
    if (!plot) continue;
    const inspectedDay = toBangkokDateString(qi.inspected_at || qi.created_at);
    if (inspectedDay !== window.dateStr) continue;
    if (qi.document_status === 'draft') continue;
    const projName = String(plot.project_name);
    const taskKey = `${qi.plot_id}::${qi.task_template_id}`;
    if (qi.overall_result === 'failed' || qi.document_status === 'rejected') {
      addKey(qcRejectedKeysByProject, projName, taskKey);
    } else if (qi.overall_result === 'passed' || qi.document_status === 'approved') {
      addKey(qcPassedKeysByProject, projName, taskKey);
    }
  }

  // Aggregate construction metrics per project
  const projectsList = Array.from(activeProjectNames).sort((a, b) => a.localeCompare(b, 'th'));
  const projectsConstruction: ProjectConstructionMetrics[] = [];

  let overallWeight = 0;
  let overallActualSum = 0;
  let overallPlannedSum = 0;
  let overallStartSum = 0;
  const overall = emptyConstructionMetrics('ภาพรวมทุกโครงการ');

  const threeDaysMs = 3 * 86_400_000;
  const referenceNowMs = window.endMs;

  for (const projName of projectsList) {
    const m = emptyConstructionMetrics(projName);
    let projWeight = 0;
    let projActualSum = 0;
    let projPlannedSum = 0;
    let projStartSum = 0;

    for (const stat of plotStats.values()) {
      if (String(stat.plot.project_name) !== projName) continue;
      m.totalPlots++;
      if (stat.isCompleted) m.completedPlots++;
      else m.activePlots++;

      if (stat.isDelayed) m.delayedPlots++;

      projWeight += stat.weight;
      projActualSum += stat.actualPct * stat.weight;
      projPlannedSum += stat.plannedPct * stat.weight;
      projStartSum += stat.startOfDayPct * stat.weight;

      const plotId = String(stat.plot.id);
      if (workerPresentByPlot.has(plotId)) {
        m.plotsUpdatedToday++;
        if (workerPresentByPlot.get(plotId)) m.plotsWithWorkersToday++;
        else m.plotsWithoutWorkersToday++;
      }
    }

    if (projWeight > 0) {
      m.actualProgressPct = projActualSum / projWeight;
      m.plannedProgressPct = projPlannedSum / projWeight;
      m.variancePct = m.actualProgressPct - m.plannedProgressPct;
      m.todayDeltaPct = Math.max(0, m.actualProgressPct - projStartSum / projWeight);
    }

    overallWeight += projWeight;
    overallActualSum += projActualSum;
    overallPlannedSum += projPlannedSum;
    overallStartSum += projStartSum;

    const enteredSet = qcEnteredKeysByProject.get(projName);
    const passedSet = qcPassedKeysByProject.get(projName);
    const rejectedSet = qcRejectedKeysByProject.get(projName);
    m.qcEnteredToday = enteredSet?.size || 0;
    m.qcPassedToday = passedSet?.size || 0;
    m.qcRejectedToday = rejectedSet?.size || 0;
    const inspectedUnion = new Set<string>([
      ...(passedSet ? Array.from(passedSet) : []),
      ...(rejectedSet ? Array.from(rejectedSet) : []),
    ]);
    m.qcInspectedToday = inspectedUnion.size;

    for (const q of queueRows) {
      const plot = plotById.get(String(q.plot_id));
      if (!plot || String(plot.project_name) !== projName) continue;
      if (q.statusFor === 'QC') {
        m.qcBacklogTotal++;
        const createdMs = Date.parse(q.created_at || '');
        if (Number.isFinite(createdMs) && referenceNowMs - createdMs >= threeDaysMs) {
          m.qcBacklogOverdue3Days++;
        }
      } else if (q.statusFor === 'Site Engineer') {
        m.sePendingCount++;
      } else if (q.statusFor === 'Rework') {
        m.reworkPendingCount++;
      }
    }

    for (const qi of scopedQcInspections) {
      const plot = plotById.get(String(qi.plot_id));
      if (!plot || String(plot.project_name) !== projName) continue;
      if (qi.document_status === 'pending_pe') {
        m.pePendingCount++;
      }
    }

    overall.totalPlots += m.totalPlots;
    overall.activePlots += m.activePlots;
    overall.completedPlots += m.completedPlots;
    overall.delayedPlots += m.delayedPlots;
    overall.plotsWithWorkersToday += m.plotsWithWorkersToday;
    overall.plotsWithoutWorkersToday += m.plotsWithoutWorkersToday;
    overall.plotsUpdatedToday += m.plotsUpdatedToday;
    overall.qcEnteredToday += m.qcEnteredToday;
    overall.qcInspectedToday += m.qcInspectedToday;
    overall.qcPassedToday += m.qcPassedToday;
    overall.qcRejectedToday += m.qcRejectedToday;
    overall.qcBacklogTotal += m.qcBacklogTotal;
    overall.qcBacklogOverdue3Days += m.qcBacklogOverdue3Days;
    overall.sePendingCount += m.sePendingCount;
    overall.reworkPendingCount += m.reworkPendingCount;
    overall.pePendingCount += m.pePendingCount;

    if (m.totalPlots > 0 || projectFilter) {
      projectsConstruction.push(m);
    }
  }

  if (overallWeight > 0) {
    overall.actualProgressPct = overallActualSum / overallWeight;
    overall.plannedProgressPct = overallPlannedSum / overallWeight;
    overall.variancePct = overall.actualProgressPct - overall.plannedProgressPct;
    overall.todayDeltaPct = Math.max(0, overall.actualProgressPct - overallStartSum / overallWeight);
  }

  // 2. Open defects per plot (used both for transfer readiness & alerts)
  const openDefectsByPlot = new Map<string, number>();
  for (const d of raw.defects || []) {
    if (!plotById.has(String(d.plot_id))) continue;
    if (!isDefectOpen(d)) continue;
    const pid = String(d.plot_id);
    openDefectsByPlot.set(pid, (openDefectsByPlot.get(pid) || 0) + 1);
  }

  // 3. Sales & CRM metrics
  const matchesProjectScope = (projName: unknown): boolean => {
    const clean = String(projName || '').trim();
    if (!clean) return !projectFilter;
    if (projectFilter) return clean === projectFilter;
    if (activeProjectNames.size === 0) return true;
    return activeProjectNames.has(clean);
  };

  const leadById = new Map<string, RawLeadRow>();
  for (const lead of raw.leads || []) {
    leadById.set(String(lead.id), lead);
  }

  const scopedLeads = (raw.leads || []).filter((lead) => matchesProjectScope(lead.project_name));

  let leadsToday = 0;
  let leadsMtd = 0;
  const visitedLeadIdsToday = new Set<string>();
  const bookedKeysToday = new Set<string>();
  const bookedKeysMtd = new Set<string>();
  const transferredKeysMtd = new Set<string>();
  let loanApprovedToday = 0;
  let cancellationsToday = 0;
  let slaBreachCount = 0;

  const twentyFourHoursAgoMs = window.endMs - 24 * 60 * 60 * 1000;

  for (const lead of scopedLeads) {
    const leadDay = toBangkokDateString(lead.lead_date || lead.created_at);
    if (leadDay === window.dateStr) leadsToday++;
    if (leadDay && leadDay >= window.monthStartStr && leadDay <= window.dateStr) leadsMtd++;

    const visitDay = toBangkokDateString(lead.actual_visit_date);
    if (visitDay === window.dateStr) {
      visitedLeadIdsToday.add(String(lead.id));
    }

    const cancelled = isCancelledStatus(lead.status, lead.crm_status);

    const bookDay = toBangkokDateString(lead.booking_date);
    if (bookDay && !cancelled) {
      const bookKey = lead.interested_plot_id
        ? `plot:${lead.interested_plot_id}`
        : `lead:${lead.id}`;
      if (bookDay === window.dateStr) bookedKeysToday.add(bookKey);
      if (bookDay >= window.monthStartStr && bookDay <= window.dateStr) {
        bookedKeysMtd.add(bookKey);
      }
    }

    const loanDay = toBangkokDateString(lead.loan_approved_date);
    if (loanDay === window.dateStr) loanApprovedToday++;

    const transferDay = toBangkokDateString(lead.transferred_date);
    if (transferDay && transferDay >= window.monthStartStr && transferDay <= window.dateStr) {
      const tKey = lead.interested_plot_id
        ? `plot:${lead.interested_plot_id}`
        : `lead:${lead.id}`;
      transferredKeysMtd.add(tKey);
    }

    if (cancelled) {
      const updDay = toBangkokDateString(lead.updated_at);
      if (updDay === window.dateStr) cancellationsToday++;
    } else if (!isTransferredStatus(lead.status, lead.crm_status)) {
      if (!lead.contacted_date) {
        const createdMs = Date.parse(lead.lead_date || lead.created_at || '');
        if (Number.isFinite(createdMs) && createdMs <= twentyFourHoursAgoMs) {
          slaBreachCount++;
        }
      }
    }
  }

  let extraVisitsToday = 0;
  for (const v of raw.leadVisits || []) {
    const vDay = toBangkokDateString(v.visited_at || v.visit_date || v.created_at);
    if (vDay !== window.dateStr) continue;
    if (projectFilter && v.project_name && String(v.project_name) !== projectFilter) continue;
    const lid = v.lead_id ? String(v.lead_id) : null;
    if (lid && visitedLeadIdsToday.has(lid)) continue;
    extraVisitsToday++;
  }

  const transfersTodayMap = new Map<string, TransferScheduleItem>();
  const upcomingTransfersMap = new Map<string, TransferScheduleItem>();

  for (const sale of raw.sales || []) {
    const plot = sale.plot_id ? plotById.get(String(sale.plot_id)) : null;
    const lead = sale.lead_id ? leadById.get(String(sale.lead_id)) : null;
    const projName = String(plot?.project_name || lead?.project_name || '').trim();
    if (!matchesProjectScope(projName)) continue;

    const cancelled = isCancelledStatus(sale.contract_status, sale.crm_stage);
    const transferred = isTransferredStatus(sale.contract_status, lead?.crm_status, sale.crm_stage);

    if (cancelled) {
      const updDay = toBangkokDateString(sale.updated_at);
      if (updDay === window.dateStr && !lead) {
        cancellationsToday++;
      }
      continue;
    }

    const saleCreatedDay = toBangkokDateString(sale.created_at);
    const bookKey = sale.plot_id ? `plot:${sale.plot_id}` : `sale:${sale.id}`;
    if (saleCreatedDay === window.dateStr) bookedKeysToday.add(bookKey);
    if (saleCreatedDay && saleCreatedDay >= window.monthStartStr && saleCreatedDay <= window.dateStr) {
      bookedKeysMtd.add(bookKey);
    }

    const actualTransferDay = toBangkokDateString(sale.transferred_at || lead?.transferred_date);
    const expectedTransferDay = toBangkokDateString(sale.expected_transfer_date);

    if (actualTransferDay && actualTransferDay >= window.monthStartStr && actualTransferDay <= window.dateStr) {
      transferredKeysMtd.add(bookKey);
    }

    const plotId = String(sale.plot_id || sale.id);
    const plotLabel = String(plot?.plot_name || plot?.id || lead?.interested_plot_name || 'ไม่ระบุแปลง');
    const stat = plot ? plotStats.get(String(plot.id)) : undefined;
    const houseProgressPct = stat ? stat.actualPct : Number(plot?.progress) || 0;
    const openDefectsCount = plot ? openDefectsByPlot.get(String(plot.id)) || 0 : 0;
    const isHouseReady =
      (stat ? stat.isCompleted : houseProgressPct >= 100) && openDefectsCount === 0;

    const isTransferredToday = actualTransferDay === window.dateStr;
    const isExpectedToday = !transferred && expectedTransferDay === window.dateStr;

    if (isTransferredToday || isExpectedToday) {
      transfersTodayMap.set(plotId, {
        plotId,
        plotLabel,
        projectName: projName || 'ไม่ระบุโครงการ',
        customerName: lead?.customer_name || null,
        expectedTransferDate: expectedTransferDay,
        actualTransferDate: actualTransferDay,
        isTransferredToday,
        isExpectedToday,
        daysUntilTransfer: 0,
        houseProgressPct,
        openDefectsCount,
        isHouseReady,
        bankStatus: sale.bank_status || null,
      });
    } else if (
      !transferred &&
      expectedTransferDay &&
      expectedTransferDay >= window.tomorrowStr &&
      expectedTransferDay <= window.plus7DaysStr
    ) {
      upcomingTransfersMap.set(plotId, {
        plotId,
        plotLabel,
        projectName: projName || 'ไม่ระบุโครงการ',
        customerName: lead?.customer_name || null,
        expectedTransferDate: expectedTransferDay,
        actualTransferDate: null,
        isTransferredToday: false,
        isExpectedToday: false,
        daysUntilTransfer: diffCalendarDays(window.dateStr, expectedTransferDay),
        houseProgressPct,
        openDefectsCount,
        isHouseReady,
        bankStatus: sale.bank_status || null,
      });
    }
  }

  for (const lead of scopedLeads) {
    const tDay = toBangkokDateString(lead.transferred_date);
    if (tDay !== window.dateStr) continue;
    const pid = String(lead.interested_plot_id || lead.id);
    if (transfersTodayMap.has(pid)) continue;
    const plot = lead.interested_plot_id ? plotById.get(String(lead.interested_plot_id)) : null;
    transfersTodayMap.set(pid, {
      plotId: pid,
      plotLabel: String(plot?.plot_name || lead.interested_plot_name || 'ไม่ระบุแปลง'),
      projectName: String(plot?.project_name || lead.project_name || 'ไม่ระบุโครงการ'),
      customerName: lead.customer_name || null,
      expectedTransferDate: null,
      actualTransferDate: tDay,
      isTransferredToday: true,
      isExpectedToday: false,
      daysUntilTransfer: 0,
      houseProgressPct: 100,
      openDefectsCount: plot ? openDefectsByPlot.get(String(plot.id)) || 0 : 0,
      isHouseReady: true,
      bankStatus: 'Approved',
    });
  }

  const transfersToday = Array.from(transfersTodayMap.values()).sort((a, b) =>
    a.plotLabel.localeCompare(b.plotLabel, 'th'),
  );
  const upcomingTransfers7Days = Array.from(upcomingTransfersMap.values()).sort(
    (a, b) => (a.daysUntilTransfer ?? 99) - (b.daysUntilTransfer ?? 99),
  );

  // 4. Customer voices today (alert-only for low scores)
  let customerVoicesToday = 0;
  let lowScoreVoicesToday = 0;
  for (const cv of raw.customerVoices || []) {
    if (!matchesProjectScope(cv.project_name)) continue;
    const cvDay = toBangkokDateString(cv.survey_date || cv.created_at);
    if (cvDay !== window.dateStr) continue;
    customerVoicesToday++;
    if (cv.score_average !== null && cv.score_average !== undefined && Number(cv.score_average) < 3.5) {
      lowScoreVoicesToday++;
    }
  }

  // 5. Build Urgent Alerts (Alert-only — never noisy when 0)
  const urgentAlerts: UrgentAlertItem[] = [];

  for (const t of [...transfersToday, ...upcomingTransfers7Days]) {
    if (t.isTransferredToday) continue;
    if (t.openDefectsCount > 0) {
      const whenLabel =
        t.daysUntilTransfer === 0 ? 'นัดโอนวันนี้' : `นัดโอนใน ${t.daysUntilTransfer} วัน`;
      urgentAlerts.push({
        severity: 'high',
        category: 'defect_transfer',
        message: `แปลง ${t.plotLabel} (${t.projectName}) ค้างแก้ Defect ${t.openDefectsCount} รายการ (${whenLabel})`,
      });
    }
  }

  const pendingMaterials = (raw.materialRequests || []).filter(
    (mr) => plotById.has(String(mr.plot_id)) && String(mr.status || '').toLowerCase() === 'requested',
  );
  if (pendingMaterials.length > 0) {
    urgentAlerts.push({
      severity: 'medium',
      category: 'material_request',
      message: `มีคำขอเบิกวัสดุรอดำเนินการ ${pendingMaterials.length} รายการ`,
    });
  }

  const activeLeaves = (raw.qcLeaves || []).filter((lv) => {
    if (lv.status !== 'approved') return false;
    const start = toBangkokDateString(lv.start_date);
    const end = toBangkokDateString(lv.end_date);
    if (!start || !end) return false;
    return (
      (start <= window.dateStr && end >= window.dateStr) ||
      (start <= window.tomorrowStr && end >= window.tomorrowStr)
    );
  });
  if (activeLeaves.length > 0) {
    const names = Array.from(
      new Set(activeLeaves.map((l) => l.applicant_username).filter(Boolean)),
    ).join(', ');
    urgentAlerts.push({
      severity: 'medium',
      category: 'qc_leave',
      message: `QC ลางานวันนี้/พรุ่งนี้ (${activeLeaves.length} รายการ): ${names}`,
    });
  }

  if (lowScoreVoicesToday > 0) {
    urgentAlerts.push({
      severity: 'high',
      category: 'customer_voice',
      message: `ผลสำรวจลูกค้าวันนี้มีคะแนนต่ำกว่าเกณฑ์ (<3.5) จำนวน ${lowScoreVoicesToday} ราย (จากทั้งหมด ${customerVoicesToday} ราย)`,
    });
  }

  const sales: SalesSummaryMetrics = {
    leadsToday,
    visitsToday: visitedLeadIdsToday.size + extraVisitsToday,
    bookingsToday: bookedKeysToday.size,
    cancellationsToday,
    loanApprovedToday,
    bookingsMtd: bookedKeysMtd.size,
    transfersMtd: transferredKeysMtd.size,
    leadsMtd,
    slaBreachCount,
    transfersToday,
    upcomingTransfers7Days,
    customerVoicesToday,
    lowScoreVoicesToday,
  };

  return {
    reportDate: window.dateStr,
    generatedAt: new Date().toISOString(),
    projectFilter,
    overallConstruction: overall,
    projectsConstruction,
    sales,
    urgentAlerts,
    appUrl: options.appUrl ?? null,
  };
}

/**
 * Fetches live operational data from Supabase and builds the DailySummaryReport.
 */
export async function collectDailySummaryReport(
  supabase: SupabaseClient,
  options: DailySummaryOptions = {},
): Promise<DailySummaryReport> {
  const window = getBangkokDayWindow(options.reportDate);

  const [
    projects,
    plots,
    taskTemplates,
    assignments,
    schedules,
    todayUpdates,
    inspectionQueue,
    qcInspections,
    qcLeaves,
    defects,
    materialRequests,
    leads,
    sales,
    leadVisits,
    customerVoices,
  ] = await Promise.all([
    safeSelectProjects(supabase),
    fetchAllRows<RawPlotRow>(
      supabase,
      'plots',
      'id, plot_name, project_name, house_type_id, is_completed, progress, sale_status, foreman_name',
    ),
    fetchAllRows<RawTaskTemplateRow>(
      supabase,
      'task_templates',
      'id, house_type_id, task_name, cost, require_qc, is_progress_counted',
    ),
    fetchAllRows<RawAssignmentRow>(
      supabase,
      'plot_task_assignments',
      'plot_id, task_template_id, current_progress, is_excluded, latest_action, latest_role, latest_update_created_at',
    ),
    fetchAllRows<RawScheduleRow>(
      supabase,
      'plot_task_schedules',
      'plot_id, task_template_id, planned_start, planned_end',
      { optional: true },
    ),
    fetchAllRows<RawTaskUpdateRow>(
      supabase,
      'task_updates',
      'plot_id, task_template_id, progress, action, role, created_at, is_worker_present',
      {
        applyFilter: (q) => q.gte('created_at', window.startIso).lte('created_at', window.endIso),
      },
    ),
    fetchAllRows<RawInspectionQueueRow>(
      supabase,
      'vw_inspection_queue',
      'plot_id, task_template_id, project_name, statusFor, created_at',
      { optional: true },
    ),
    fetchAllRows<RawQcInspectionRow>(
      supabase,
      'qc_inspections',
      'id, plot_id, task_template_id, document_status, overall_result, inspected_at, created_at',
      { optional: true },
    ),
    fetchAllRows<RawQcLeaveRow>(
      supabase,
      'qc_leave_requests',
      'id, applicant_username, start_date, end_date, status',
      {
        optional: true,
        applyFilter: (q) => q.eq('status', 'approved').gte('end_date', window.dateStr),
      },
    ),
    fetchAllRows<RawDefectRow>(supabase, 'defects', 'id, plot_id, status, created_at', {
      optional: true,
    }),
    fetchAllRows<RawMaterialRequestRow>(
      supabase,
      'task_material_requests',
      'id, plot_id, status, requested_at',
      {
        optional: true,
        applyFilter: (q) => q.eq('status', 'requested'),
      },
    ),
    fetchAllRows<RawLeadRow>(
      supabase,
      'leads',
      'id, project_name, customer_name, status, crm_status, lead_date, created_at, updated_at, contacted_date, actual_visit_date, booking_date, loan_approved_date, transferred_date, interested_plot_id, interested_plot_name',
      { optional: true },
    ),
    fetchAllRows<RawSaleRow>(
      supabase,
      'sales',
      'id, lead_id, plot_id, contract_status, bank_status, expected_transfer_date, transferred_at, created_at, updated_at',
      { optional: true },
    ),
    fetchAllRows<RawLeadVisitRow>(
      supabase,
      'lead_visits',
      'id, lead_id, project_name, visit_date, visited_at, created_at',
      {
        optional: true,
        applyFilter: (q) => q.gte('created_at', window.startIso).lte('created_at', window.endIso),
      },
    ),
    fetchAllRows<RawCustomerVoiceRow>(
      supabase,
      'customer_voices',
      'id, project_name, customer_name, survey_date, created_at, score_average',
      {
        optional: true,
        applyFilter: (q) => q.gte('created_at', window.startIso).lte('created_at', window.endIso),
      },
    ),
  ]);

  const updatedPlotIds = Array.from(new Set(todayUpdates.map((u) => String(u.plot_id))));
  const recentUpdatesBeforeToday =
    updatedPlotIds.length > 0
      ? await fetchAllRows<RawTaskUpdateRow>(
          supabase,
          'task_updates',
          'plot_id, task_template_id, progress, created_at',
          {
            optional: true,
            applyFilter: (q) =>
              q.in('plot_id', updatedPlotIds).lt('created_at', window.startIso),
          },
        )
      : [];

  const resolvedAppUrl =
    options.appUrl ??
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : null);

  return computeDailySummaryReport(
    {
      projects,
      plots,
      taskTemplates,
      assignments,
      schedules,
      todayUpdates,
      recentUpdatesBeforeToday,
      inspectionQueue,
      qcInspections,
      qcLeaves,
      defects,
      materialRequests,
      leads,
      sales,
      leadVisits,
      customerVoices,
    },
    {
      reportDate: window.dateStr,
      projectFilter: options.projectFilter,
      appUrl: resolvedAppUrl,
    },
  );
}
