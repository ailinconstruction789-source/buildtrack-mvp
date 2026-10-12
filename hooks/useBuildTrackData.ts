import { useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { buildPlotLeadLookup, orderPlotMatchingLeads, type PlotLeadMatchInput } from '@/lib/plotLeadLookup';
import { fetchPaginatedRows } from '@/lib/fetchPaginatedRows';
import type { SalesStartupData, LoadSalesStartupData } from '@/types/salesStartup';

const REFERENCE_DATA_MAX_AGE_MS = 30_000;
const SALES_STARTUP_MAX_AGE_MS = 5_000;
const PLOT_DETAILS_MAX_AGE_MS = 5_000;

interface BuildTrackDataRow extends PlotLeadMatchInput {
  [column: string]: unknown;
  customer_name?: string | null;
  transferred_date?: string | null;
  overall_progress?: number | string | null;
}

async function requireSuccessfulRead<T extends { error?: unknown }>(query: PromiseLike<T>): Promise<T> {
  const result = await query;
  if (result.error) throw result.error;
  return result;
}

export function useBuildTrackData(loggedInUser: any, selectedProjectName?: string | null, salesWorkspaceOnly = false, constructionOverviewOnly = false) {
  const username = loggedInUser?.username;
  const role = loggedInUser?.role;
  const dataIdentity = loggedInUser
    ? JSON.stringify([loggedInUser.id, loggedInUser.authUserId, username, role]) : null;
  const referenceProfileKey = JSON.stringify([dataIdentity, salesWorkspaceOnly]);
  const loadProfileKey = JSON.stringify([dataIdentity, salesWorkspaceOnly, constructionOverviewOnly]);
  const mountedRef = useRef(false);
  const requestVersionRef = useRef(0);
  const plotDetailsRef = useRef(new Map<string, {
    identity: string | null;
    loadedAt: number | null;
    promise: Promise<void>;
  }>());
  const activeContextRef = useRef<{ identity: string | null; projectName: string | null | undefined; profileKey: string | null }>({ identity: null, projectName: selectedProjectName, profileKey: null });
  const invalidatePendingRequests = useCallback(() => { requestVersionRef.current++; }, []);
  const [loading, setLoading] = useState(true);
  const [loadedProfileKey, setLoadedProfileKey] = useState<string | null>(null);
  const [salesDataRevision, setSalesDataRevision] = useState(0);
  const [isAnalyticsLoading, setIsAnalyticsLoading] = useState(false);
  const [isArchiveSyncing, setIsArchiveSyncing] = useState(false);
  const [archiveSyncSuccess, setArchiveSyncSuccess] = useState(false);
  const isAnalyticsFetchedRef = useRef(false);
  const analyticsRequestVersionRef = useRef(0);
  
  // 🏢 Core Data States
  const [projects, setProjects] = useState<any[]>([]);
  const [houseTypes, setHouseTypes] = useState<any[]>([]);
  const [taskTemplates, setTaskTemplates] = useState<any[]>([]);
  const [plots, setPlots] = useState<any[]>([]);
  const [contractors, setContractors] = useState<any[]>([]);
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [staffIdentity, setStaffIdentity] = useState(dataIdentity);
  // Invalidate the previous account's staff snapshot before rendering consumers.
  // A guarded render-time reset avoids briefly showing stale rows after switching
  // accounts, and avoids a synchronous state reset inside the loading effect.
  if (staffIdentity !== dataIdentity) {
    setStaffIdentity(dataIdentity);
    setAllUsers([]);
  }
  
  // 📊 Dynamic Data States
  const [assignments, setAssignments] = useState<any[]>([]);
  const [schedules, setSchedules] = useState<any>({});
  const [defects, setDefects] = useState<any[]>([]);
  const [defectUpdates, setDefectUpdates] = useState<any[]>([]);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [materialRequests, setMaterialRequests] = useState<any[]>([]);
  const [materialReceipts, setMaterialReceipts] = useState<any[]>([]);
  
  // 📈 Derived / Mapped Data States
  const [latestUpdatesMap, setLatestUpdatesMap] = useState<any>({});
  const [taskDates, setTaskDates] = useState<any>({});
  const [allUpdatesRecord, setAllUpdatesRecord] = useState<any[]>([]);
  const [inspectionQueueView, setInspectionQueueView] = useState<any[]>([]);
  const [plotStatuses, setPlotStatuses] = useState<any[]>([]);
  const [plotOverallStatuses, setPlotOverallStatuses] = useState<any[]>([]);
  const [qcSePerformance, setQcSePerformance] = useState<any[]>([]);

  const fetchWithoutLimit = useCallback(async (table: string, projectName?: string | null, orderBy: string = 'id', ascending: boolean = true, selectQuery: string = '*', secondaryOrderBy: string | readonly string[] | null = 'id', throwOnError = false) => {
    const concurrency = table === 'plot_task_assignments' || table === 'plot_task_schedules' ? 3 : 1;
    const secondaryColumns = typeof secondaryOrderBy === 'string' ? [secondaryOrderBy] : (secondaryOrderBy || []);
    return fetchPaginatedRows<BuildTrackDataRow>(async (from, to, requestCount) => {
      const selectOptions = requestCount ? { count: 'exact' as const } : undefined;
      let query;
      // Use PostgREST embedded filtering if we need to filter by project_name
      if (projectName && projectName !== 'all' && (table === 'plot_task_assignments' || table === 'plot_task_schedules')) {
        query = supabase.from(table)
          .select(`${selectQuery}, plots!inner(project_name)`, selectOptions)
          .eq('plots.project_name', projectName)
          .order(orderBy, { ascending });
      } else if (projectName && projectName !== 'all' && (table === 'plots' || table === 'vw_plot_progress' || table === 'vw_plot_overall_status')) {
        query = supabase.from(table)
          .select(selectQuery, selectOptions)
          .eq('project_name', projectName)
          .order(orderBy, { ascending });
      } else {
        query = supabase.from(table).select(selectQuery, selectOptions).order(orderBy, { ascending });
      }
      
      // Ensure stable pagination by adding a secondary sort (if provided and different from primary)
      for (const column of secondaryColumns) {
        if (column !== orderBy) query = query.order(column, { ascending: true });
      }
      query = query.range(from, to);
      
      const { data, error, count } = await query;
      if (error) {
        // Fallback to fetch all if the inner join fails (e.g. no explicit foreign key defined in PostgREST cache)
        if (projectName && projectName !== 'all') {
           console.warn(`Optimized fetch failed for ${table}, falling back to full fetch. Please ensure foreign keys are defined or run SQL migrations.`);
           let fallbackQuery = supabase.from(table).select(selectQuery, selectOptions).order(orderBy, { ascending });
           for (const column of secondaryColumns) {
             if (column !== orderBy) fallbackQuery = fallbackQuery.order(column, { ascending: true });
           }
           fallbackQuery = fallbackQuery.range(from, to);
           
           const fallbackResult = await fallbackQuery;
           if (fallbackResult.error) {
             if (throwOnError) throw fallbackResult.error;
             console.error(`Fallback error in fetchWithoutLimit for table ${table}:`, fallbackResult.error);
             return { data: null };
           }
           return { data: fallbackResult.data as unknown as BuildTrackDataRow[] | null, count: fallbackResult.count };
        } else {
           if (throwOnError) throw error;
           console.warn(`Warning in fetchWithoutLimit for table ${table}:`, error);
           return { data: null };
        }
      }
      // The SDK cannot infer row fields from a runtime table/select string.
      return { data: data as unknown as BuildTrackDataRow[] | null, count };
    }, { concurrency });
  }, []);

  // Share the raw read with Sales Hub, without persisting customer rows or
  // sharing them between accounts. Explicit refreshes always bypass the snapshot.
  const salesStartupRef = useRef<{
    identity: string;
    loadedAt: number | null;
    promise: Promise<SalesStartupData>;
  } | null>(null);
  const fetchSalesStartupLeads = useCallback(async () => {
    // Retain Hub ordering for a single page. If pagination is needed, restart
    // with a unique secondary order so timestamp ties cannot cross page bounds.
    const { data, error } = await supabase.from('leads').select('*')
      .order('created_at', { ascending: false }).range(0, 999);
    if (error) throw error;
    if (data?.length === 1000) return fetchWithoutLimit('leads', null, 'created_at', false, '*', 'id', true);
    return (data || []) as unknown as BuildTrackDataRow[];
  }, [fetchWithoutLimit]);
  const loadSalesStartupData: LoadSalesStartupData = useCallback(async (options = {}) => {
    if (!dataIdentity) throw new Error('Sales startup requires a signed-in account');
    if (!mountedRef.current || activeContextRef.current.identity !== dataIdentity) {
      throw new Error('Sales startup account changed');
    }
    let entry = salesStartupRef.current;
    if (options.fresh || !entry || entry.identity !== dataIdentity
      || (entry.loadedAt !== null && Date.now() - entry.loadedAt >= SALES_STARTUP_MAX_AGE_MS)) {
      const next = {
        identity: dataIdentity,
        loadedAt: null as number | null,
        promise: Promise.all([
          fetchSalesStartupLeads(),
          fetchWithoutLimit('plots', null, 'id', true, '*, house_types(type_name)', 'id', true),
        ]).then(([leads, plots]) => ({ leads, plots })),
      };
      next.promise = next.promise.then(result => {
        next.loadedAt = Date.now();
        return result;
      }).catch(error => {
        if (salesStartupRef.current === next) salesStartupRef.current = null;
        throw error;
      });
      salesStartupRef.current = next;
      entry = next;
    }
    const result = await entry.promise;
    if (!mountedRef.current || activeContextRef.current.identity !== dataIdentity) {
      throw new Error('Sales startup account changed');
    }
    if (options.fresh) setSalesDataRevision(revision => revision + 1);
    return result;
  }, [dataIdentity, fetchSalesStartupLeads, fetchWithoutLimit]);

  const fetchReferenceData = useCallback(async () => {
    const [projs, types, tasks, contractors] = await Promise.all([
      supabase.from('projects').select('*').order('created_at', { ascending: true }),
      supabase.from('house_types').select('*'),
      salesWorkspaceOnly ? Promise.resolve([]) : fetchWithoutLimit('task_templates', null, 'task_order', true, '*', 'id', true),
      salesWorkspaceOnly ? Promise.resolve({ data: [], error: null }) : supabase.from('contractors').select('*'),
    ]);
    const error = projs.error || types.error || contractors.error;
    if (error) throw error;
    return [projs, types, tasks, contractors] as const;
  }, [fetchWithoutLimit, salesWorkspaceOnly]);

  const referenceCacheRef = useRef<{
    identity: string;
    loadedAt: number | null;
    promise: ReturnType<typeof fetchReferenceData>;
  } | null>(null);

  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      activeContextRef.current = { identity: null, projectName: undefined, profileKey: null };
      invalidatePendingRequests();
      referenceCacheRef.current = null;
      salesStartupRef.current = null;
      plotDetailsRef.current.clear();
      analyticsRequestVersionRef.current++;
    };
  }, [invalidatePendingRequests]);

  useLayoutEffect(() => {
    referenceCacheRef.current = null;
    if (salesStartupRef.current?.identity !== dataIdentity) salesStartupRef.current = null;
    invalidatePendingRequests();
    plotDetailsRef.current.clear();
    isAnalyticsFetchedRef.current = false;
    analyticsRequestVersionRef.current++;
    setIsAnalyticsLoading(false);
    setIsArchiveSyncing(false);
    setArchiveSyncSuccess(false);
    // A failed refresh may retain this account's snapshot, never another actor's.
    setLoadedProfileKey(null);
    setProjects([]);
    setHouseTypes([]);
    setTaskTemplates([]);
    setPlots([]);
    setContractors([]);
    setAssignments([]);
    setSchedules({});
    setDefects([]);
    setDefectUpdates([]);
    setNotifications([]);
    setMaterialRequests([]);
    setMaterialReceipts([]);
    setLatestUpdatesMap({});
    setTaskDates({});
    setAllUpdatesRecord([]);
    setInspectionQueueView([]);
    setPlotStatuses([]);
    setPlotOverallStatuses([]);
    setQcSePerformance([]);
  }, [dataIdentity, invalidatePendingRequests]);

  useLayoutEffect(() => {
    plotDetailsRef.current.clear();
  }, [selectedProjectName]);

  useLayoutEffect(() => {
    activeContextRef.current = { identity: dataIdentity, projectName: selectedProjectName, profileKey: loadProfileKey };
  }, [dataIdentity, selectedProjectName, loadProfileKey]);

  // Direct callers refresh after writes. Only navigation opts into reusing references.
  const fetchAllData = useCallback(async (options: { reuseReferenceData?: boolean } = {}) => {
    if (!dataIdentity || !mountedRef.current || activeContextRef.current.identity !== dataIdentity
      || activeContextRef.current.profileKey !== loadProfileKey) return;
    const projectToLoad = activeContextRef.current.projectName;
    const requestVersion = ++requestVersionRef.current;
    // A refresh after a write must never reuse details read before that write.
    if (!options.reuseReferenceData) plotDetailsRef.current.clear();
    const isCurrentRequest = () => mountedRef.current && requestVersionRef.current === requestVersion;
    
    try {
      setLoading(true);

      let referenceCache = referenceCacheRef.current;
      if (!options.reuseReferenceData || !referenceCache || referenceCache.identity !== referenceProfileKey
        || (referenceCache.loadedAt !== null && Date.now() - referenceCache.loadedAt >= REFERENCE_DATA_MAX_AGE_MS)) {
        const entry = { identity: referenceProfileKey, loadedAt: null as number | null, promise: fetchReferenceData() };
        entry.promise = entry.promise.then(result => {
          entry.loadedAt = Date.now();
          return result;
        }).catch(error => {
          if (referenceCacheRef.current === entry) referenceCacheRef.current = null;
          throw error;
        });
        referenceCacheRef.current = entry;
        referenceCache = entry;
      }

      const salesStartup = salesWorkspaceOnly
        ? loadSalesStartupData({ fresh: !options.reuseReferenceData }) : null;
      const [
        [{ data: projs }, { data: types }, tasks, { data: contData }],
        plotsData,
        { data: notifData },
        plotProgressData,
        { data: projectProgressData },
        assignData,
        schedulesData,
        recentUpdates,
        defectsData,
        defectUpdatesData,
        { data: materialReqData },
        { data: materialReceiptData },
        { data: inspectionQueueData },
        { data: plotStatusesData },
        plotOverallStatusesData,
        qcSePerformanceData,
        leadsData
      ] = await Promise.all([
        referenceCache.promise,
        salesStartup ? salesStartup.then(data => data.plots as BuildTrackDataRow[]) : fetchWithoutLimit('plots', null, 'created_at', true, '*, house_types(type_name)', 'id', true),
        requireSuccessfulRead(supabase.from('notifications').select('*').or(`target_user.eq.${username},target_role.eq.${role}`).order('created_at', { ascending: false })),
        fetchWithoutLimit('vw_plot_progress', null, 'plot_id', true, '*', null, true),
        requireSuccessfulRead(supabase.from('vw_project_progress').select('*')),
        salesWorkspaceOnly || constructionOverviewOnly ? [] : fetchWithoutLimit('plot_task_assignments', projectToLoad, 'id', true, '*', 'id', true),
        salesWorkspaceOnly || constructionOverviewOnly ? [] : fetchWithoutLimit('plot_task_schedules', projectToLoad, 'id', true, '*', 'id', true),
        salesWorkspaceOnly ? [] : requireSuccessfulRead(supabase.from('task_updates').select('*').order('created_at', { ascending: false }).limit(1000)).then(res => res.data || []),
        salesWorkspaceOnly ? [] : requireSuccessfulRead(supabase.from('defects').select('*').order('created_at', { ascending: false }).limit(500)).then(res => res.data || []),
        salesWorkspaceOnly ? [] : requireSuccessfulRead(supabase.from('defect_updates').select('*').order('created_at', { ascending: false }).limit(500)).then(res => res.data || []),
        salesWorkspaceOnly ? { data: [] } : requireSuccessfulRead(supabase.from('vw_task_material_requests').select('*')),
        salesWorkspaceOnly ? { data: [] } : requireSuccessfulRead(supabase.from('task_material_receipts').select('*').order('created_at', { ascending: true })),
        salesWorkspaceOnly ? { data: [] } : requireSuccessfulRead(supabase.from('vw_inspection_queue').select('*')),
        salesWorkspaceOnly ? { data: [] } : requireSuccessfulRead(supabase.from('vw_plot_status_dashboard').select('*')),
        salesWorkspaceOnly ? [] : fetchWithoutLimit('vw_plot_overall_status', null, 'plot_id', true, '*', null, true),
        salesWorkspaceOnly || constructionOverviewOnly ? null : fetchWithoutLimit('vw_qc_se_performance', null, 'date', true, '*', ['role', 'action', 'day_of_week', 'day_of_month', 'hour_of_day'], true)
          .catch(error => {
            console.error('Error fetching QC performance:', error);
            return null;
          }),
        salesStartup ? salesStartup.then(data => orderPlotMatchingLeads(data.leads) as BuildTrackDataRow[]) : fetchWithoutLimit('leads', null, 'created_at', false, 'id, customer_name, phone, project_name, interested_plot_id, interested_plot_name, status, crm_status, booking_date, transferred_date, agent_name, notes', 'id', true)
      ]);
      if (!isCurrentRequest()) return;
      if (!options.reuseReferenceData && !salesWorkspaceOnly) setSalesDataRevision(revision => revision + 1);

      setNotifications(notifData || []);
      // Sales Hub does not consume these construction snapshots. Keep an already
      // loaded snapshot on return, and fetch fresh data when leaving Sales Hub.
      if (!salesWorkspaceOnly) {
      setDefects(defectsData || []);
      setDefectUpdates(defectUpdatesData || []);
      setMaterialRequests(materialReqData || []);
      setMaterialReceipts(materialReceiptData || []);
      setInspectionQueueView(inspectionQueueData || []);
      setPlotStatuses(plotStatusesData || []);
      setPlotOverallStatuses(plotOverallStatusesData || []);
      // Keep the previous complete snapshot if a QC page fails; core data can still load.
      if (qcSePerformanceData !== null) setQcSePerformance(qcSePerformanceData);
      setAssignments((prev: any) => {
        const newMap = new Map(assignData?.map((a: any) => [a.id, a]) || []);
        prev?.forEach((p: any) => { if (!newMap.has(p.id)) newMap.set(p.id, p); });
        return Array.from(newMap.values());
      });
      setContractors(contData || []);
      setAllUpdatesRecord((prev: any) => {
        const newMap = new Map(recentUpdates?.map((u: any) => [u.id, u]) || []);
        prev?.forEach((p: any) => { if (!newMap.has(p.id)) newMap.set(p.id, p); });
        return Array.from(newMap.values()).sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      });
      
      const latestUpdates: any = {}; 
      const tDates: any = {};
      const newSched: any = {};

      schedulesData?.forEach((s: any) => { newSched[`${s.plot_id}-${s.task_template_id}`] = s; });
      setSchedules((prev: any) => ({...prev, ...newSched}));
      
      // We populate latestUpdatesMap and taskDates from the new DB columns in plot_task_assignments
      assignData?.forEach((assign: any) => { 
        const key = `${assign.plot_id}-${assign.task_template_id}`; 
        latestUpdates[key] = {
           plot_id: assign.plot_id,
           task_template_id: assign.task_template_id,
           progress: assign.current_progress || 0,
           actual_end_date: assign.actual_end_date,
           action: assign.latest_action,
           role: assign.latest_role,
           created_at: assign.latest_update_created_at
        }; 
        tDates[key] = { start: assign.actual_start_date, end: assign.actual_end_date };
      });
      
      // Inspection Queue needs action, role, and created_at
      const seenTaskUpdates = new Set();
      recentUpdates?.forEach((upd: any) => {
        const key = `${upd.plot_id}-${upd.task_template_id}`;
        if (!seenTaskUpdates.has(key)) {
          seenTaskUpdates.add(key);
          if (latestUpdates[key]) {
            // ONLY use task_updates as fallback if assignData didn't have latest_action
            if (!latestUpdates[key].action) {
              latestUpdates[key].action = upd.action;
              latestUpdates[key].role = upd.role;
              latestUpdates[key].created_at = upd.created_at;
              latestUpdates[key].progress = upd.progress;
            } else if ((latestUpdates[key].progress === 0 || latestUpdates[key].progress === undefined) && upd.progress > 0) {
              // Self-healing fallback: If assignment cache had 0 progress but task_updates has real progress
              latestUpdates[key].progress = upd.progress;
              if (upd.action) latestUpdates[key].action = upd.action;
              if (upd.role) latestUpdates[key].role = upd.role;
              if (upd.created_at) latestUpdates[key].created_at = upd.created_at;
            }
            if (!tDates[key]?.end && (upd.progress === 100 || upd.is_completed)) {
              tDates[key] = { ...tDates[key], end: upd.created_at };
            }
          } else {
            latestUpdates[key] = {
              plot_id: upd.plot_id,
              task_template_id: upd.task_template_id,
              progress: upd.progress,
              action: upd.action,
              role: upd.role,
              created_at: upd.created_at
            };
          }
        }
      });
      
      if (!constructionOverviewOnly) {
        setLatestUpdatesMap(latestUpdates);
        setTaskDates(tDates);
      }
      }

      const plotLeadLookup = buildPlotLeadLookup(leadsData || []);
      const formattedPlots = plotsData?.map((plot: any) => {
        const progressRecord = plotProgressData?.find((p: any) => p.plot_id === plot.id);
        const matchingLead = plotLeadLookup.findForPlot(plot);

        const isLeadTransferred = matchingLead?.status === 'Transferred' || plot.sale_status === 'transferred';
        const isLeadBooked = matchingLead && (matchingLead.status === 'Reserved' || matchingLead.status === 'Booked' || matchingLead.status === 'Contracted' || matchingLead.booking_date);
        const computedHasCustomer = Boolean(plot.has_customer || isLeadBooked || isLeadTransferred);
        const computedSaleStatus = isLeadTransferred ? 'transferred' : (isLeadBooked ? 'sold' : (plot.sale_status || 'ready_for_sale'));
        const customerHighlight = matchingLead ? `ลูกค้า: ${matchingLead.customer_name} (${isLeadTransferred ? 'โอนแล้ว' : 'จองแล้ว'})` : plot.highlight_note;

        return { 
          ...plot, 
          has_customer: computedHasCustomer,
          sale_status: computedSaleStatus,
          customer_name: matchingLead?.customer_name || plot.customer_name || null,
          booking_date: matchingLead?.booking_date || plot.booking_date || null,
          transferred_date: matchingLead?.transferred_date || plot.transferred_date || null,
          highlight_note: customerHighlight,
          type: plot.house_types?.type_name || 'ไม่ระบุแบบ', 
          foreman: plot.foreman_name, 
          progress: Number(progressRecord?.overall_progress ?? 0)
        };
      }).sort((a: any, b: any) => (a.id || '').localeCompare(b.id || '', undefined, { numeric: true, sensitivity: 'base' }));

      const formattedProjects = projs?.map((proj: any) => {
        const progressRecord = projectProgressData?.find((p: any) => p.project_name === proj.name);
        const uniqueMigrated = Array.from(new Map((proj.layout_data || []).map((item: any) => [item.id, item])).values());
        return { 
          name: proj.name, 
          layout_data: uniqueMigrated, 
          plotCount: plotsData?.filter((p: any) => p.project_name === proj.name).length || 0, 
          progress: Number(progressRecord?.project_progress ?? 0),
          is_closed: !!proj.is_closed 
        };
      });

      setHouseTypes(types || []); 
      if (!salesWorkspaceOnly) setTaskTemplates(tasks || []);
      setPlots(formattedPlots || []); 
      setProjects(formattedProjects || []); 
      setLoadedProfileKey(loadProfileKey);
      setLoading(false);

      // ข้อมูลประวัติงานฉบับเต็มจะถูกโหลดแบบ On-Demand เฉพาะเมื่อเปิดดูแปลงนั้นๆ (fetchPlotDetails)
      // หรือเมื่อเข้าหน้ารายงานผู้บริหาร (fetchOwnerAnalyticsData) เพื่อประหยัด RAM และเน็ตมือถือหน้างาน

    } catch (error) {
      console.error('Error fetching core data:', error);
      if (isCurrentRequest()) {
        setLoading(false);
        setLoadedProfileKey(loadProfileKey);
      }
    }
  }, [dataIdentity, username, role, loadProfileKey, referenceProfileKey, salesWorkspaceOnly, constructionOverviewOnly, loadSalesStartupData, fetchReferenceData, fetchWithoutLimit]);

  // 🌟 ฟังก์ชันโหลดข้อมูลเจาะจงแปลง (Lazy Load Plot Details)
  const fetchPlotDetails = useCallback(async (plotId: string, options: { fresh?: boolean } = {}) => {
    if (!mountedRef.current || activeContextRef.current.identity !== dataIdentity) return;
    const cached = plotDetailsRef.current.get(plotId);
    if (!options.fresh && cached?.identity === dataIdentity
      && (cached.loadedAt === null || Date.now() - cached.loadedAt < PLOT_DETAILS_MAX_AGE_MS)) {
      await cached.promise;
      return;
    }
    const entry = { identity: dataIdentity, loadedAt: null as number | null, promise: Promise.resolve() };
    const isCurrent = () => mountedRef.current
      && activeContextRef.current.identity === dataIdentity
      && plotDetailsRef.current.get(plotId) === entry;
    const load = async () => {
    try {
      const results = await Promise.all([
        supabase.from('plot_task_assignments').select('*').eq('plot_id', plotId),
        supabase.from('plot_task_schedules').select('*').eq('plot_id', plotId),
        supabase.from('task_updates').select('*').eq('plot_id', plotId).order('created_at', { ascending: false }),
        supabase.from('defects').select('*').eq('plot_id', plotId).order('created_at', { ascending: false })
      ]);
      const error = results.find(result => result.error)?.error;
      if (error) throw error;
      if (!isCurrent()) return;
      const [{ data: assignData }, { data: schedData }, { data: updData }, { data: defData }] = results;

      setAssignments((prev: any) => {
        const others = prev.filter((a: any) => a.plot_id !== plotId);
        return [...others, ...(assignData || [])];
      });

      setSchedules((prev: any) => {
        const newSched = { ...prev };
        schedData?.forEach((s: any) => { newSched[`${s.plot_id}-${s.task_template_id}`] = s; });
        return newSched;
      });

      setTaskDates((prev: any) => {
        const newDates = { ...prev };
        assignData?.forEach((a: any) => {
          newDates[`${a.plot_id}-${a.task_template_id}`] = { start: a.actual_start_date, end: a.actual_end_date };
        });
        return newDates;
      });

      setLatestUpdatesMap((prev: any) => {
        const newMap = { ...prev };
        for (const key of Object.keys(newMap)) {
          if (String(newMap[key]?.plot_id) === String(plotId)) delete newMap[key];
        }
        assignData?.forEach((a: any) => {
          const key = `${a.plot_id}-${a.task_template_id}`;
          newMap[key] = {
            plot_id: a.plot_id,
            task_template_id: a.task_template_id,
            progress: a.current_progress || 0,
            actual_end_date: a.actual_end_date,
            action: a.latest_action,
            role: a.latest_role,
            created_at: a.latest_update_created_at
          };
        });
        const seenTasks = new Set();
        updData?.forEach((upd: any) => {
          const key = `${upd.plot_id}-${upd.task_template_id}`;
          if (!seenTasks.has(key)) {
            seenTasks.add(key);
            if (!newMap[key]) {
              newMap[key] = {
                plot_id: upd.plot_id,
                task_template_id: upd.task_template_id,
                progress: upd.progress,
                action: upd.action,
                role: upd.role,
                created_at: upd.created_at
              };
            } else {
              // ONLY use task updates as fallback if assignData didn't have latest_action
              if (!newMap[key].action) {
                newMap[key].action = upd.action;
                newMap[key].role = upd.role;
                newMap[key].created_at = upd.created_at;
                newMap[key].progress = upd.progress;
              }
            }
          }
        });
        return newMap;
      });

      setAllUpdatesRecord((prev: any) => {
        const others = prev.filter((u: any) => u.plot_id !== plotId);
        return [...others, ...(updData || [])];
      });

      setDefects((prev: any) => {
        const others = prev.filter((d: any) => d.plot_id !== plotId);
        return [...others, ...(defData || [])];
      });
      entry.loadedAt = Date.now();

    } catch (err) {
      if (plotDetailsRef.current.get(plotId) === entry) plotDetailsRef.current.delete(plotId);
      console.error('Error fetching plot details:', err);
    }
    };
    plotDetailsRef.current.set(plotId, entry);
    entry.promise = load();
    await entry.promise;
  }, [dataIdentity]);

  // 🌟 ฟังก์ชันโหลดข้อมูล Analytics ผู้บริหาร (พร้อม Progressive Loading ป้องกันเน็ตมือถือหลุด)
  const fetchOwnerAnalyticsData = useCallback(async (forceRefresh = false) => {
    if (!dataIdentity || !mountedRef.current || activeContextRef.current.identity !== dataIdentity) return;
    if (isAnalyticsFetchedRef.current && !forceRefresh) {
      return;
    }
    const requestVersion = ++analyticsRequestVersionRef.current;
    const isCurrentRequest = () => mountedRef.current
      && activeContextRef.current.identity === dataIdentity
      && analyticsRequestVersionRef.current === requestVersion;
    setIsAnalyticsLoading(true);
    setIsArchiveSyncing(true);
    setArchiveSyncSuccess(false);

    try {
      // 🚀 สเต็ปที่ 1 (Fast Load): ดึงข้อมูลสถานะล่าสุดและประวัติล่าสุด 2,000 รายการ โหลดเสร็จใน < 1 วิ!
      const [assignData, schedData, recentUpdData, { data: defData }] = await Promise.all([
        fetchWithoutLimit('plot_task_assignments', null, 'id', true, '*', 'id', true),
        fetchWithoutLimit('plot_task_schedules', null, 'id', true, '*', 'id', true),
        requireSuccessfulRead(supabase.from('task_updates').select('*').order('created_at', { ascending: false }).limit(2000)).then(res => res.data || []),
        requireSuccessfulRead(supabase.from('defects').select('*').order('created_at', { ascending: false }))
      ]);
      if (!isCurrentRequest()) return;

      const latestUpdates: any = {}; 
      const tDates: any = {}; 
      const newSched: any = {};

      schedData?.forEach((s: any) => { newSched[`${s.plot_id}-${s.task_template_id}`] = s; });
      
      assignData?.forEach((assign: any) => { 
        const key = `${assign.plot_id}-${assign.task_template_id}`; 
        latestUpdates[key] = {
           plot_id: assign.plot_id,
           task_template_id: assign.task_template_id,
           progress: assign.current_progress || 0,
           actual_end_date: assign.actual_end_date,
           action: assign.latest_action,
           role: assign.latest_role,
           created_at: assign.latest_update_created_at || assign.actual_end_date
        }; 
        tDates[key] = { start: assign.actual_start_date, end: assign.actual_end_date };
      });
      
      recentUpdData?.forEach((upd: any) => {
        const key = `${upd.plot_id}-${upd.task_template_id}`;
        if (latestUpdates[key]) {
          if (!latestUpdates[key].action) {
            latestUpdates[key].action = upd.action;
            latestUpdates[key].role = upd.role;
          }
          if (!latestUpdates[key].created_at) {
            latestUpdates[key].created_at = upd.created_at;
          }
          if ((latestUpdates[key].progress === 0 || latestUpdates[key].progress === undefined) && upd.progress > 0) {
            latestUpdates[key].progress = upd.progress;
          }
          if (!tDates[key]?.end && (upd.progress === 100 || upd.is_completed)) {
            tDates[key] = { ...tDates[key], end: upd.created_at };
          }
        } else {
          latestUpdates[key] = {
            plot_id: upd.plot_id,
            task_template_id: upd.task_template_id,
            progress: upd.progress,
            action: upd.action,
            role: upd.role,
            created_at: upd.created_at
          };
        }
      });
      
      // Batch state updates ทันที
      setAssignments(assignData || []);
      setSchedules(newSched);
      setLatestUpdatesMap(latestUpdates); 
      setTaskDates(tDates);
      setAllUpdatesRecord(recentUpdData || []);
      setDefects(defData || []);
      isAnalyticsFetchedRef.current = true;
      setIsAnalyticsLoading(false); // แสดงผลหน้าจอพร้อมตัวเลขและผลวิเคราะห์ทันที!

      // 🔄 สเต็ปที่ 2 (Background Sync): ทยอยดึงประวัติย้อนหลังส่วนที่เหลือเงียบๆ ในพื้นหลัง
      (async () => {
        try {
          const fullUpdates = await fetchWithoutLimit('task_updates', null, 'created_at', false, 'id, plot_id, task_template_id, progress, action, role, created_at, user_name, text_content, image_url, is_silent', 'id', true);
          if (!isCurrentRequest()) return;
          if (fullUpdates && fullUpdates.length > 0) {
            setAllUpdatesRecord((prev: any) => {
              if (!isCurrentRequest()) return prev;
              const newMap = new Map(fullUpdates.map((u: any) => [u.id, u]));
              prev?.forEach((p: any) => {
                if (!newMap.has(p.id)) {
                  newMap.set(p.id, p);
                } else {
                  const existing = newMap.get(p.id);
                  if (!existing.user_name && p.user_name) existing.user_name = p.user_name;
                  if (!existing.text_content && p.text_content) existing.text_content = p.text_content;
                  if (!existing.image_url && p.image_url) existing.image_url = p.image_url;
                }
              });
              return Array.from(newMap.values()).sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
            });
            setLatestUpdatesMap((prev: any) => {
              if (!isCurrentRequest()) return prev;
              const updated = { ...prev };
              fullUpdates.forEach((upd: any) => {
                const key = `${upd.plot_id}-${upd.task_template_id}`;
                if (updated[key]) {
                  if (!updated[key].action) {
                    updated[key].action = upd.action;
                    updated[key].role = upd.role;
                  }
                  if (!updated[key].created_at) {
                    updated[key].created_at = upd.created_at;
                  }
                } else {
                  updated[key] = {
                    plot_id: upd.plot_id,
                    task_template_id: upd.task_template_id,
                    progress: upd.progress,
                    action: upd.action,
                    role: upd.role,
                    created_at: upd.created_at
                  };
                }
              });
              return updated;
            });
          }
          setIsArchiveSyncing(false);
          setArchiveSyncSuccess(true);
          setTimeout(() => { if (isCurrentRequest()) setArchiveSyncSuccess(false); }, 4000);
        } catch (bgErr) {
          if (!isCurrentRequest()) return;
          console.warn('Background full updates fetch warning:', bgErr);
          setIsArchiveSyncing(false);
        }
      })();

    } catch (err) {
      if (!isCurrentRequest()) return;
      console.error('Error fetching analytics:', err);
      setIsAnalyticsLoading(false);
      setIsArchiveSyncing(false);
    }
  }, [dataIdentity, fetchWithoutLimit]);

  useEffect(() => {
    // Staff/assignment data is separate from the intentionally public login names.
    // This UI guard is not authorization: database grants/RLS remain mandatory.
    let active = true;
    if (!loggedInUser) return;
    const fetchStaff = async () => {
      try {
        const { data, error } = await supabase.from('users')
          .select('id,username,role,created_at,last_seen_at')
          .order('role', { ascending: true }).order('username', { ascending: true });
        if (active) setAllUsers(error ? [] : data ?? []);
      } catch {
        if (active) setAllUsers([]);
      }
    };
    void fetchStaff();
    return () => { active = false; };
  }, [dataIdentity]);

  useEffect(() => {
    if (dataIdentity) {
      // Delay to avoid synchronous setState inside effect which causes cascading renders
      const timer = setTimeout(() => {
        void fetchAllData({ reuseReferenceData: true });
      }, 0);
      return () => {
        clearTimeout(timer);
        invalidatePendingRequests();
      };
    }
  }, [dataIdentity, selectedProjectName, fetchAllData, invalidatePendingRequests]);

  useEffect(() => {
    if (!loggedInUser || salesWorkspaceOnly) return;

    let active = true;
    let queueVersion = 0;
    let materialVersion = 0;
    const isCurrentSubscription = () => active && mountedRef.current
      && activeContextRef.current.identity === dataIdentity;

    const channel = supabase
      .channel('realtime_task_updates')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'task_updates' },
        (payload) => {
          if (!isCurrentSubscription()) return;
          const newUpdate = payload.new;
          plotDetailsRef.current.delete(String(newUpdate.plot_id));
          setAllUpdatesRecord((prev) => [newUpdate, ...prev]);
          setLatestUpdatesMap((prev: any) => {
            const key = `${newUpdate.plot_id}-${newUpdate.task_template_id}`;
            return {
              ...prev,
              [key]: {
                ...prev[key],
                plot_id: newUpdate.plot_id,
                task_template_id: newUpdate.task_template_id,
                progress: newUpdate.progress,
                created_at: newUpdate.created_at,
                action: newUpdate.action,
                role: newUpdate.role
              }
            };
          });
          
          // Refresh the queue when an update arrives
          const version = ++queueVersion;
          supabase.from('vw_inspection_queue').select('*').then(({data, error}) => {
             if (isCurrentSubscription() && queueVersion === version && !error && data) setInspectionQueueView(data);
          });
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'task_material_requests' },
        async () => {
          if (!isCurrentSubscription()) return;
          const version = ++materialVersion;
          // Refresh material requests and receipts when changes happen
          const [
            { data: materialReqData, error: materialReqError },
            { data: materialReceiptData, error: materialReceiptError }
          ] = await Promise.all([
            supabase.from('vw_task_material_requests').select('*'),
            supabase.from('task_material_receipts').select('*').order('created_at', { ascending: true })
          ]);
          if (!isCurrentSubscription() || materialVersion !== version || materialReqError || materialReceiptError) return;
          if (materialReqData) setMaterialRequests(materialReqData);
          if (materialReceiptData) setMaterialReceipts(materialReceiptData);
        }
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [salesWorkspaceOnly, dataIdentity]);

  const togglePlotSaleStatus = async (plotId: string, currentStatus: string, pausedAt: string | null) => {
    try {
      if (currentStatus === 'active' || !currentStatus) {
        // Pause plot
        const { error } = await supabase.from('plots').update({ 
          sale_status: 'ready_for_sale', 
          paused_for_sale_at: new Date().toISOString() 
        }).eq('id', plotId);
        if (error) throw error;
      } else if (currentStatus === 'ready_for_sale') {
        // Resume plot
        if (pausedAt) {
          const offsetMs = Date.now() - new Date(pausedAt).getTime();
          
          const { data: plotSchedules } = await supabase.from('plot_task_schedules').select('*').eq('plot_id', plotId);
          if (plotSchedules) {
            for (const sched of plotSchedules) {
               const key = `${plotId}-${sched.task_template_id}`;
               const progress = latestUpdatesMap[key]?.progress || 0;
               if (progress < 100) {
                 const newStart = new Date(new Date(sched.planned_start).getTime() + offsetMs).toISOString();
                 const newEnd = new Date(new Date(sched.planned_end).getTime() + offsetMs).toISOString();
                 await supabase.from('plot_task_schedules').update({
                    planned_start: newStart,
                    planned_end: newEnd
                 }).eq('id', sched.id);
               }
            }
          }
        }
        
        const { error } = await supabase.from('plots').update({ 
          sale_status: 'active', 
          paused_for_sale_at: null 
        }).eq('id', plotId);
        if (error) throw error;
      }
      
      await fetchAllData();
      return true;
    } catch (e) {
      console.error("Error toggling sale status:", e);
      return false;
    }
  };

  const resetHandoverCycle = async (plotId: string, currentCycle: number) => {
    try {
      const { error } = await supabase.from('plots').update({
        handover_cycle: (currentCycle || 1) + 1,
        inspection_round: 0,
        handover_status: 'pending',
        handover_completed_at: null,
        handover_completed_by: null,
        inspection_round1_date: null,
        inspection_round1_status: 'pending',
        inspection_round2_date: null,
        inspection_round2_status: 'pending',
        handover_notes: null
      }).eq('id', plotId);
      if (error) throw error;
      await fetchPlotDetails(plotId);
      await fetchAllData();
      return true;
    } catch (e) {
      console.error("Error resetting handover cycle:", e);
      return false;
    }
  };

  const updateInspectionRound = async (plotId: string, newRound: number) => {
    try {
      const { error } = await supabase.from('plots').update({
        inspection_round: newRound
      }).eq('id', plotId);
      if (error) throw error;
      await fetchPlotDetails(plotId);
      await fetchAllData();
      return true;
    } catch (e) {
      console.error("Error updating inspection round:", e);
      return false;
    }
  };

  return {
    loading: loading || (dataIdentity !== null && loadedProfileKey !== loadProfileKey), setLoading,
    isAnalyticsLoading,
    isArchiveSyncing,
    archiveSyncSuccess,
    projects, setProjects,
    houseTypes, setHouseTypes,
    taskTemplates, setTaskTemplates,
    plots, setPlots,
    contractors, setContractors,
    allUsers, setAllUsers,
    assignments, setAssignments,
    schedules, setSchedules,
    defects,
    setDefects,
    defectUpdates,
    setDefectUpdates,
    notifications, setNotifications,
    latestUpdatesMap, setLatestUpdatesMap,
    taskDates, setTaskDates,
    allUpdatesRecord, setAllUpdatesRecord,
    fetchAllData,
    loadSalesStartupData,
    salesDataRevision,
    fetchPlotDetails,
    fetchOwnerAnalyticsData,
    fetchWithoutLimit,
    togglePlotSaleStatus,
    resetHandoverCycle,
    updateInspectionRound,
    materialRequests,
    setMaterialRequests,
    materialReceipts,
    setMaterialReceipts,
    inspectionQueueView,
    setInspectionQueueView,
    plotStatuses,
    plotOverallStatuses,
    setPlotOverallStatuses,
    qcSePerformance,
    setQcSePerformance
  };
}
