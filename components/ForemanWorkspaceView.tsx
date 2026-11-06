'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  HardHat,
  Calendar,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Clock,
  AlertTriangle,
  AlertCircle,
  Cloud,
  MessageSquare,
  Search,
  Filter,
  RefreshCw,
  Building2,
  Home,
  Check,
  X,
  Sparkles,
  Info,
  CalendarDays,
  User,
  ArrowRight,
  CheckSquare,
  ShieldCheck,
  ExternalLink,
  Wrench,
  ShieldAlert,
  Flame,
  ClipboardList,
  Grid,
  SortAsc,
  Activity,
} from 'lucide-react';
import {
  ROADBLOCK_REASONS,
  getRoadblockReason,
  normalizeDateStr,
  getPlotForemanName,
  getForemanScheduledTasksForDate,
  computeForemanDailySummary,
  saveForemanDailySnapshot,
  loadForemanDailySnapshot,
  recordForemanTaskRoadblockReason,
  getForemanReworkItems,
  getForemanDailyActivities,
  type ForemanDailyTask,
  type ForemanDailySummary,
  type ForemanReworkItem,
  type ForemanDailyActivitySummary,
  type RoadblockReasonId,
} from '@/lib/foremanDuty';
import ForemanInspectionCalendar from './ForemanInspectionCalendar';
import ForemanDailyActivityView from './ForemanDailyActivityView';
import MeterStatusBadges from './MeterStatusBadges';

interface ForemanWorkspaceViewProps {
  plots: any[];
  projects: any[];
  taskTemplates: any[];
  schedules: Record<string, any>;
  assignments?: any[];
  allUpdatesRecord?: any[];
  allUsers?: any[];
  foremenList?: any[];
  defects?: any[];
  loggedInUser?: any;
  currentUserRole?: string;
  isAdmin?: boolean;
  isOwner?: boolean;
  isSiteEngineer?: boolean;
  isProjectPlanner?: boolean;
  isForeman?: boolean;
  onNavigateToTaskChat: (plot: any, task: any) => void;
  onNavigateToDefectChat?: (plot: any, defect: any) => void;
  onSelectPlot?: (plot: any) => void;
  fetchAllData?: () => Promise<void>;
  inspectionQueue?: any[];
  setSelectedGlobalProject?: (p: any) => void;
}

export default function ForemanWorkspaceView({
  plots = [],
  projects = [],
  taskTemplates = [],
  schedules = {},
  assignments = [],
  allUpdatesRecord = [],
  allUsers = [],
  foremenList = [],
  defects = [],
  loggedInUser,
  currentUserRole = '',
  isAdmin = false,
  isOwner = false,
  isSiteEngineer = false,
  isProjectPlanner = false,
  isForeman = false,
  onNavigateToTaskChat,
  onNavigateToDefectChat,
  onSelectPlot,
  fetchAllData,
  inspectionQueue = [],
  setSelectedGlobalProject,
}: ForemanWorkspaceViewProps) {
  // Check if current user has Owner role
  const isOwnerUser = isOwner || currentUserRole?.toLowerCase() === 'owner';

  // Main view mode: 'schedule' (งานตามแผน) | 'rework' (งานที่ต้องแก้ไข & Defect) | 'calendar' (ปฏิทินตรวจงานรายเดือน)
  // 🌟 For Owner, default to 'calendar' as requested; for others, default to 'schedule'
  const [mainTab, setMainTab] = useState<'schedule' | 'activity' | 'rework' | 'calendar'>(() => {
    return isOwnerUser ? 'calendar' : 'schedule';
  });

  // Keep in sync if isOwnerUser resolves after initial mount
  const hasInitializedTabRef = useRef(false);
  useEffect(() => {
    if (!hasInitializedTabRef.current && isOwnerUser) {
      setMainTab('calendar');
      hasInitializedTabRef.current = true;
    }
  }, [isOwnerUser]);

  // Today's date in local YYYY-MM-DD
  const todayStr = useMemo(() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }, []);

  // Selected date for daily dispatch
  const [selectedDate, setSelectedDate] = useState<string>(todayStr);

  // Current user's foreman identity
  const currentForemanName = useMemo(() => {
    return (loggedInUser?.username || loggedInUser?.name || '').trim();
  }, [loggedInUser]);

  // Can the user switch foremen? (Admins, Owners, SEs, Planners can inspect anyone)
  const canSwitchForeman = isAdmin || isOwner || isSiteEngineer || isProjectPlanner;

  // Selected foreman for filtering
  const [selectedForeman, setSelectedForeman] = useState<string>(() => {
    if (isForeman && currentForemanName) return currentForemanName;
    return 'all';
  });

  // Project filter
  const [selectedProject, setSelectedProject] = useState<string>('all');

  // Schedule status tab filter: 'all' | 'pending' | 'updated' | 'roadblock'
  const [activeTab, setActiveTab] = useState<'all' | 'pending' | 'updated' | 'roadblock' | 'completed_early' | 'out_of_plan'>('all');
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  // Rework filter: 'all' | 'defect' | 'task_rework'
  const [reworkFilter, setReworkFilter] = useState<'all' | 'defect' | 'task_rework'>('all');
  const [reworkViewMode, setReworkViewMode] = useState<'card' | 'list'>('card');
  const [reworkSort, setReworkSort] = useState<'time' | 'plot'>('time');

  // Search queries
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [reworkSearch, setReworkSearch] = useState<string>('');

  // Snapshots loaded from database/cache
  const [snapshots, setSnapshots] = useState<any[]>([]);
  type SnapshotLoadStatus = 'idle' | 'loading' | 'loaded_data' | 'loaded_empty' | 'cached_offline' | 'failed';
  const [isLoadingSnapshots, setIsLoadingSnapshots] = useState<boolean>(false);
  const [snapshotLoadStatus, setSnapshotLoadStatus] = useState<SnapshotLoadStatus>('idle');
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'cached_offline' | 'error'>('idle');
  const [roadblockSubmitError, setRoadblockSubmitError] = useState<string | null>(null);
  const lastAutoSaveSignatureRef = useRef<string>('');
  const activeScopeRef = useRef<{ date: string; foreman: string }>({ date: '', foreman: '' });

  // Roadblock Reason Modal State
  const [selectedTaskForRoadblock, setSelectedTaskForRoadblock] = useState<ForemanDailyTask | null>(null);
  const [selectedReasonId, setSelectedReasonId] = useState<string>('material_issue');
  const [roadblockNote, setRoadblockNote] = useState<string>('');
  const [roadblockSubmissionId, setRoadblockSubmissionId] = useState<string>('');
  const [isSubmittingReason, setIsSubmittingReason] = useState<boolean>(false);

  // Build unique foremen options from users list and plots
  const availableForemen = useMemo(() => {
    const set = new Map<string, string>();
    if (Array.isArray(foremenList)) {
      foremenList.forEach(u => {
        const name = (u.username || u.name || '').trim();
        if (name) set.set(name.toLowerCase(), name);
      });
    }
    if (Array.isArray(plots)) {
      plots.forEach(p => {
        const name = getPlotForemanName(p);
        if (name && !set.has(name.toLowerCase())) {
          set.set(name.toLowerCase(), name);
        }
      });
    }
    return Array.from(set.values()).sort((a, b) => a.localeCompare(b, 'th'));
  }, [foremenList, plots]);

  // Load snapshot when date or foreman changes
  const loadSnapshotForCurrentView = useCallback(async () => {
    const targetDate = selectedDate;
    const targetForeman = selectedForeman;
    activeScopeRef.current = { date: targetDate, foreman: targetForeman };
    setIsLoadingSnapshots(true);
    setSnapshotLoadStatus('loading');
    try {
      const relevantPlotIds = targetForeman && targetForeman !== 'all'
        ? (plots || []).filter(p => (getPlotForemanName(p) || '').toLowerCase() === targetForeman.toLowerCase()).map(p => p.id)
        : [];
      const res: any = await loadForemanDailySnapshot(targetDate, targetForeman, undefined, { plotIds: relevantPlotIds });
      if (activeScopeRef.current.date === targetDate && activeScopeRef.current.foreman === targetForeman) {
        const tasks = Array.isArray(res) ? res : (res?.data || []);
        const status = res?.status || (Array.isArray(res) ? (res.length > 0 ? 'success' : 'empty') : 'error');
        if (status === 'error') {
          setSnapshotLoadStatus('failed');
          setSnapshots([]);
          setAutoSaveStatus('error');
        } else if (status === 'cache_fallback') {
          // Stale cache: display offline view only, do NOT auto-save to remote (Issue 2)
          setSnapshots(tasks);
          setSnapshotLoadStatus('cached_offline');
          setAutoSaveStatus('cached_offline');
        } else {
          setSnapshots(tasks);
          setSnapshotLoadStatus(tasks.length > 0 ? 'loaded_data' : 'loaded_empty');
        }
      }
    } catch (err) {
      console.warn('Error loading foreman daily snapshot:', err);
      if (activeScopeRef.current.date === targetDate && activeScopeRef.current.foreman === targetForeman) {
        setSnapshotLoadStatus('failed');
      }
    } finally {
      if (activeScopeRef.current.date === targetDate && activeScopeRef.current.foreman === targetForeman) {
        setIsLoadingSnapshots(false);
      }
    }
  }, [selectedDate, selectedForeman]);

  useEffect(() => {
    loadSnapshotForCurrentView();
  }, [loadSnapshotForCurrentView]);

  // Compute daily tasks
  const dailyTasks = useMemo(() => {
    const tasks = getForemanScheduledTasksForDate({
      plots,
      taskTemplates,
      schedules,
      assignments,
      allUpdatesRecord,
      foremanName: selectedForeman,
      targetDate: selectedDate,
      existingSnapshots: snapshots,
    });

    // Project filter
    if (selectedProject !== 'all') {
      return tasks.filter(t => t.project_name === selectedProject);
    }

    return tasks;
  }, [
    plots,
    taskTemplates,
    schedules,
    assignments,
    allUpdatesRecord,
    selectedForeman,
    selectedDate,
    snapshots,
    selectedProject,
  ]);

  // Compute active rejected/rework tasks directly from inspectionQueue (exact same source & format as Image 1)
  const reworkQueue = useMemo(() => {
    const queue = (inspectionQueue || []).filter((q: any) => {
      if (!q.isRejected) return false;
      if (selectedProject && selectedProject !== 'all' && q.project_name && q.project_name !== selectedProject) return false;
      if (isForeman && loggedInUser?.username) {
        return q.foreman === loggedInUser.username;
      }
      if (selectedForeman && selectedForeman !== 'all') {
        return q.foreman === selectedForeman;
      }
      return true;
    }).map((q: any) => ({
      ...q,
      time: q.time || (q.created_at ? new Date(q.created_at).getTime() : 0)
    }));

    queue.sort((a: any, b: any) => {
      if (reworkSort === 'plot') return (String(a.plot_name || a.plot_id || '')).localeCompare(String(b.plot_name || b.plot_id || ''));
      return (b.time || 0) - (a.time || 0);
    });

    return queue;
  }, [inspectionQueue, selectedProject, isForeman, loggedInUser?.username, selectedForeman, reworkSort]);

  // Compute active rework items (Defects + Rejected tasks)
  const reworkItems: ForemanReworkItem[] = useMemo(() => {
    const items = getForemanReworkItems({
      plots,
      defects,
      allUpdatesRecord,
      taskTemplates,
      foremanName: selectedForeman,
    });

    if (selectedProject !== 'all') {
      return items.filter(i => i.project_name === selectedProject);
    }

    return items;
  }, [plots, defects, allUpdatesRecord, taskTemplates, selectedForeman, selectedProject]);

  // KPI Summary for Daily Tasks
  const summary: ForemanDailySummary = useMemo(() => {
    return computeForemanDailySummary(dailyTasks);
  }, [dailyTasks]);

  // Daily actual activities log (Timeline feed & in-plan vs out-of-plan categorization)
  const dailyActivities: ForemanDailyActivitySummary = useMemo(() => {
    return getForemanDailyActivities({
      targetDate: selectedDate,
      foremanName: selectedForeman,
      projectName: selectedProject,
      plots,
      taskTemplates,
      schedules,
      allUpdatesRecord,
      defects,
      existingSnapshots: snapshots,
    });
  }, [
    selectedDate,
    selectedForeman,
    selectedProject,
    plots,
    taskTemplates,
    schedules,
    allUpdatesRecord,
    defects,
    snapshots,
  ]);

  // Filtered daily tasks for display
  const filteredTasks = useMemo(() => {
    return dailyTasks.filter(t => {
      // Completed early filter:
      if (activeTab === 'completed_early') {
        if (!t.is_completed_early) return false;
      } else {
        // By default, exclude completed early tasks from active inspection tabs (all, pending, updated, roadblock)
        if (t.is_completed_early) return false;
      }

      // Out of plan tab filter:
      if (activeTab === 'out_of_plan') return false;

      // Tab filter
      if (activeTab === 'pending' && (t.is_updated_today || t.status_reason)) return false;
      if (activeTab === 'updated' && !t.is_updated_today) return false;
      if (activeTab === 'roadblock' && (!t.status_reason || t.is_updated_today)) return false;

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchPlot = t.plot_name.toLowerCase().includes(q);
        const matchTask = t.task_name.toLowerCase().includes(q);
        const matchContractor = (t.contractor_name || '').toLowerCase().includes(q);
        const matchFm = t.foreman_name.toLowerCase().includes(q);
        if (!matchPlot && !matchTask && !matchContractor && !matchFm) return false;
      }

      return true;
    });
  }, [dailyTasks, activeTab, searchQuery]);

  // Distinct Out-of-Plan Tasks updated today
  const outOfPlanTasks = useMemo(() => {
    const map = new Map<string, any>();
    (dailyActivities.items || [])
      .filter(item => item.category === 'out_of_plan')
      .forEach(item => {
        const key = `${item.plot_id}-${item.task_template_id || item.task_name}`;
        if (!map.has(key)) {
          const schedKey1 = `${item.plot_id}-${item.task_template_id}`;
          const schedKey2 = `${item.plot_id}_${item.task_template_id}`;
          const sched = schedules[schedKey1] || schedules[schedKey2];
          const assign = (assignments || []).find(
            (a: any) => String(a.plot_id) === String(item.plot_id) &&
                        String(a.task_template_id) === String(item.task_template_id)
          );

          map.set(key, {
            id: `out-of-plan-${key}`,
            plot_id: item.plot_id,
            plot_name: item.plot_name,
            project_name: item.project_name,
            foreman_name: item.foreman_name,
            task_template_id: item.task_template_id,
            task_name: item.task_name,
            planned_start: sched?.planned_start || null,
            planned_end: sched?.planned_end || null,
            current_progress: typeof item.progress === 'number' ? item.progress : (item.is_100_percent ? 100 : 0),
            contractor_name: assign?.contractor_name || assign?.contractor || null,
            is_updated_today: true,
            last_action: item.action,
            last_text: item.text_content,
            last_time: item.timeStr,
            categoryLabel: item.categoryLabel || 'งานนอกแผน / ล่วงหน้า',
            image_urls: item.image_urls || [],
            is_100_percent: item.is_100_percent,
            plotObj: item.plotObj,
            taskObj: item.taskObj,
          });
        }
      });
    return Array.from(map.values());
  }, [dailyActivities.items, schedules, assignments]);

  // Filtered out-of-plan tasks by search query
  const filteredOutOfPlanTasks = useMemo(() => {
    if (!searchQuery.trim()) return outOfPlanTasks;
    const q = searchQuery.toLowerCase().trim();
    return outOfPlanTasks.filter(t => {
      const matchPlot = t.plot_name.toLowerCase().includes(q);
      const matchTask = t.task_name.toLowerCase().includes(q);
      const matchContractor = (t.contractor_name || '').toLowerCase().includes(q);
      const matchFm = t.foreman_name.toLowerCase().includes(q);
      const matchAction = (t.last_action || '').toLowerCase().includes(q);
      const matchText = (t.last_text || '').toLowerCase().includes(q);
      return matchPlot || matchTask || matchContractor || matchFm || matchAction || matchText;
    });
  }, [outOfPlanTasks, searchQuery]);

  // Helper to render an Out-of-Plan task card
  const renderOutOfPlanCard = (task: any) => (
    <div
      key={task.id}
      className="bg-white rounded-2xl p-5 border border-purple-200/90 shadow-xs hover:shadow-md transition-all flex flex-col justify-between group relative overflow-hidden"
    >
      <div className="absolute top-0 right-0 w-24 h-24 bg-purple-500/5 rounded-bl-full pointer-events-none" />
      <div>
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="px-2.5 py-1 bg-purple-50 text-purple-700 font-black text-xs rounded-lg border border-purple-200">
                {task.plot_name}
              </span>
              <span className="text-[11px] text-slate-400 font-bold">
                {task.project_name}
              </span>
            </div>
            {selectedForeman === 'all' && (
              <p className="text-[11px] text-slate-500 font-semibold flex items-center gap-1">
                <User size={12} className="text-slate-400" />
                <span>โฟร์แมน: {task.foreman_name}</span>
              </p>
            )}
          </div>

          <span className="px-2.5 py-1 bg-purple-100 text-purple-800 border border-purple-300 text-[11px] font-black rounded-lg flex items-center gap-1 shrink-0">
            <Sparkles size={13} className="text-purple-600" />
            <span>{task.categoryLabel}</span>
          </span>
        </div>

        <div className="mb-3">
          <h4 className="text-base font-black text-slate-900 group-hover:text-purple-700 transition-colors">
            {task.task_name}
          </h4>
          <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1.5 font-medium">
            <Calendar size={13} className="text-slate-400" />
            <span>
              {task.planned_start && task.planned_end
                ? `ตามแผน: ${task.planned_start} ถึง ${task.planned_end}`
                : 'งานนอกตารางแผนหลัก'}
            </span>
          </p>
        </div>

        <div className="space-y-1.5 mb-3 bg-purple-50/50 p-3 rounded-xl border border-purple-100">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-500 font-bold">ความคืบหน้าปัจจุบัน</span>
            <span className="font-black text-purple-800">{task.current_progress}%</span>
          </div>
          <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden">
            <div
              className={`h-2 rounded-full transition-all duration-300 ${
                task.current_progress >= 100
                  ? 'bg-emerald-500'
                  : task.current_progress > 0
                  ? 'bg-purple-600'
                  : 'bg-slate-300'
              }`}
              style={{ width: `${Math.min(100, Math.max(0, task.current_progress))}%` }}
            />
          </div>
          {task.contractor_name && (
            <p className="text-[11px] text-slate-500 font-medium truncate pt-1">
              👷 ผู้รับเหมา: <span className="font-bold text-slate-700">{task.contractor_name}</span>
            </p>
          )}
        </div>

        {task.last_action && (
          <div className="mb-3 p-2.5 bg-purple-50/70 rounded-xl border border-purple-100 text-[11px] text-purple-900 font-medium flex items-center justify-between">
            <span>อัปเดต: <strong className="font-bold">{task.last_action}</strong></span>
            {task.last_time && <span className="text-purple-600 font-bold">{task.last_time}</span>}
          </div>
        )}

        {task.last_text && (
          <div className="mb-3 p-2.5 bg-slate-50 rounded-xl border border-slate-100 text-xs text-slate-600 font-medium line-clamp-2">
            {task.last_text}
          </div>
        )}

        {task.image_urls && task.image_urls.length > 0 && (
          <div className="mb-3 flex items-center gap-1.5 flex-wrap">
            {task.image_urls.slice(0, 3).map((img: string, idx: number) => (
              <div
                key={idx}
                onClick={() => setPreviewImage(img)}
                className="w-10 h-10 rounded-lg overflow-hidden border border-slate-200 cursor-pointer hover:opacity-80 transition-opacity"
              >
                <img src={img} alt="ภาพงาน" className="w-full h-full object-cover" />
              </div>
            ))}
            {task.image_urls.length > 3 && (
              <span className="text-[10px] text-slate-400 font-bold">
                +{task.image_urls.length - 3} รูป
              </span>
            )}
          </div>
        )}
      </div>

      <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
        <div className="text-[11px] text-purple-700 font-bold">
          ⚡ อัปเดตนอกตารางวันนี้
        </div>
        <button
          onClick={() => {
            const plot = task.plotObj || plots.find((p: any) => String(p.id) === String(task.plot_id));
            const tObj = task.taskObj || taskTemplates.find((t: any) => String(t.id) === String(task.task_template_id)) || {
              id: task.task_template_id,
              task_name: task.task_name,
              task_order: 1,
            };
            if (plot && onNavigateToTaskChat) {
              onNavigateToTaskChat(plot, tObj);
            }
          }}
          className="px-3.5 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-black shadow-xs transition-all flex items-center gap-1.5 cursor-pointer active:scale-95"
        >
          <MessageSquare size={13} />
          <span>เข้าห้องแชท / อัปเดต</span>
        </button>
      </div>
    </div>
  );

  // Filtered rework items for display
  const filteredReworkItems = useMemo(() => {
    return reworkItems.filter(item => {
      if (reworkFilter !== 'all' && item.type !== reworkFilter) return false;
      if (reworkSearch.trim()) {
        const q = reworkSearch.toLowerCase().trim();
        const mPlot = item.plot_name.toLowerCase().includes(q);
        const mTitle = item.title.toLowerCase().includes(q);
        const mDesc = (item.description || '').toLowerCase().includes(q);
        const mTask = (item.task_name || '').toLowerCase().includes(q);
        const mContractor = (item.contractor_name || '').toLowerCase().includes(q);
        if (!mPlot && !mTitle && !mDesc && !mTask && !mContractor) return false;
      }
      return true;
    });
  }, [reworkItems, reworkFilter, reworkSearch]);

  // Date navigation handlers
  const handlePrevDay = () => {
    const cur = new Date(selectedDate);
    cur.setDate(cur.getDate() - 1);
    setSelectedDate(normalizeDateStr(cur) || selectedDate);
  };

  const handleNextDay = () => {
    const cur = new Date(selectedDate);
    cur.setDate(cur.getDate() + 1);
    setSelectedDate(normalizeDateStr(cur) || selectedDate);
  };

  const handleJumpToToday = () => {
    setSelectedDate(todayStr);
  };

  // Format date display in Thai
  const thaiDateLabel = useMemo(() => {
    try {
      const [y, m, d] = selectedDate.split('-').map(Number);
      const dateObj = new Date(y, m - 1, d);
      return dateObj.toLocaleDateString('th-TH', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    } catch {
      return selectedDate;
    }
  }, [selectedDate]);

  const isViewingPast = selectedDate < todayStr;
  const isViewingToday = selectedDate === todayStr;

  // Automatic Background Snapshot Synchronization
  useEffect(() => {
    if (!dailyTasks || dailyTasks.length === 0) return;

    // Content signature of current view & compliance status
    if (isLoadingSnapshots || snapshotLoadStatus === 'loading' || snapshotLoadStatus === 'failed' || snapshotLoadStatus === 'cached_offline' || snapshotLoadStatus === 'idle') {
      return;
    }

    const contentSignature = dailyTasks
      .map(t => `${t.id}:${t.current_progress}:${t.is_updated_today ? 1 : 0}:${t.status_reason || ''}:${t.status_note || ''}`)
      .join('|');
    const currentSignature = `${selectedDate}::${selectedForeman}::${contentSignature}`;

    if (lastAutoSaveSignatureRef.current === currentSignature) return;

    // Auto-save is triggered for today's tasks or when viewing a past date that has no snapshot yet
    if (!isViewingToday) return;


    const timerDate = selectedDate;
    const timerForeman = selectedForeman;

    const timer = setTimeout(async () => {
      if (
        activeScopeRef.current.date !== timerDate ||
        activeScopeRef.current.foreman !== timerForeman
      ) {
        return;
      }
      setAutoSaveStatus('saving');
      try {
        const saveRes = await saveForemanDailySnapshot(
          dailyTasks,
          timerDate,
          timerForeman,
          loggedInUser?.username || loggedInUser?.name || 'AutoSync'
        );
        if (saveRes && saveRes.success) {
          if (saveRes.isRemoteSynced) {
            lastAutoSaveSignatureRef.current = currentSignature;
            setAutoSaveStatus('saved');
          } else if (saveRes.storage === 'local_cache') {
            setAutoSaveStatus('cached_offline');
          } else {
            setAutoSaveStatus('saved');
          }
        } else {
          setAutoSaveStatus('error');
        }
      } catch (err) {
        console.warn('Background auto-save notice:', err);
        setAutoSaveStatus('error');
      }
    }, 600);

    return () => clearTimeout(timer);
  }, [
    dailyTasks,
    selectedDate,
    selectedForeman,
    summary.updatedTasks,
    summary.roadblockTasks,
    isViewingToday,
    isLoadingSnapshots,
    snapshotLoadStatus,
    loggedInUser,
  ]);

  // Submit Roadblock Reason
  const handleSubmitRoadblock = async () => {
    if (!selectedTaskForRoadblock) return;
    setIsSubmittingReason(true);
    setRoadblockSubmitError(null);
    try {
      const updatedBy = loggedInUser?.username || loggedInUser?.name || 'Foreman';
      const res = await recordForemanTaskRoadblockReason(
        selectedTaskForRoadblock,
        selectedDate,
        selectedReasonId,
        roadblockNote,
        updatedBy,
        undefined,
        { clientSubmissionId: roadblockSubmissionId }
      );

      if (!res || !res.success) {
        setRoadblockSubmitError(res?.error || 'เกิดข้อผิดพลาดในการบันทึกเหตุผล กรุณาลองใหม่อีกครั้ง');
        return;
      }

      // Refresh snapshot data
      await loadSnapshotForCurrentView();
      if (fetchAllData) {
        fetchAllData().catch(() => {});
      }

      // Close modal on success
      setSelectedTaskForRoadblock(null);
      setRoadblockNote('');
      setRoadblockSubmissionId('');
    } catch (err: any) {
      console.error('Error submitting roadblock reason:', err);
      setRoadblockSubmitError(err?.message || 'เกิดข้อผิดพลาดในการบันทึกเหตุผล');
    } finally {
      setIsSubmittingReason(false);
    }
  };

  // Quick navigate to task chat
  const handleOpenChat = (task: ForemanDailyTask) => {
    const plot = plots.find(p => String(p.id) === String(task.plot_id));
    const targetTaskTemplate = taskTemplates.find(
      t => String(t.id) === String(task.task_template_id)
    ) || {
      id: task.task_template_id,
      task_name: task.task_name,
      task_order: task.task_order || 1,
      house_type_id: task.house_type_id,
    };

    if (plot && onNavigateToTaskChat) {
      onNavigateToTaskChat(plot, targetTaskTemplate);
    }
  };

  // Quick navigate to defect chat
  const handleOpenDefectChat = (item: ForemanReworkItem) => {
    const plot = plots.find(p => String(p.id) === String(item.plot_id));
    if (plot && onNavigateToDefectChat && item.defectObj) {
      onNavigateToDefectChat(plot, item.defectObj);
    }
  };

  // Quick navigate to rework task chat
  const handleOpenReworkTaskChat = (item: ForemanReworkItem) => {
    const plot = plots.find(p => String(p.id) === String(item.plot_id));
    const task =
      item.taskObj ||
      taskTemplates.find(t => String(t.id) === String(item.task_template_id)) || {
        id: item.task_template_id || 0,
        task_name: item.task_name || 'งานก่อสร้าง',
        task_order: 1,
      };

    if (plot && onNavigateToTaskChat) {
      onNavigateToTaskChat(plot, task);
    }
  };

  return (
    <div className="space-y-6 pb-20 animate-in fade-in duration-300">
      {/* 🌟 Top Banner / Header */}
      <div className="bg-gradient-to-r from-slate-900 via-blue-950 to-slate-900 rounded-3xl p-6 sm:p-8 text-white shadow-xl relative overflow-hidden border border-slate-800">
        <div className="absolute -right-12 -top-12 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute right-40 -bottom-12 w-48 h-48 bg-amber-500/10 rounded-full blur-2xl pointer-events-none" />

        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-amber-500/20 text-amber-300 rounded-full text-xs font-black tracking-wide border border-amber-500/30">
              <HardHat size={14} className="stroke-[2.5]" />
              <span>ห้องทำงานโฟร์แมน • FOREMAN WORKSPACE</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white flex items-center gap-3">
              <span>งานประจำวันและการเข้าตรวจไซต์</span>
            </h1>
            <p className="text-slate-300 text-sm max-w-2xl leading-relaxed">
              ติดตามงานก่อสร้างตามแผนประจำวันของโฟร์แมน ตรวจสอบงานที่ถูกสั่งแก้ไข/Defect ค้าง
              พร้อมระบบแช่แข็งประวัติแผนงานย้อนหลังอัตโนมัติ (Auto-Snapshot)
            </p>
          </div>

          {/* Quick Date Switcher in Header (Enabled for Schedule mode) */}
          <div className="bg-white/10 backdrop-blur-md p-3 rounded-2xl border border-white/15 flex flex-col sm:flex-row items-center gap-3 shrink-0">
            <div className="flex items-center gap-1.5">
              <button
                onClick={handlePrevDay}
                className="p-2 hover:bg-white/15 text-slate-200 hover:text-white rounded-xl transition-all cursor-pointer active:scale-95"
                title="วันก่อนหน้า"
              >
                <ChevronLeft size={18} />
              </button>

              <div className="text-center px-2">
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">วันที่เลือกตรวจงาน</p>
                <div className="flex items-center gap-1.5 justify-center">
                  <Calendar size={14} className="text-amber-400" />
                  <input
                    type="date"
                    value={selectedDate}
                    onChange={e => setSelectedDate(e.target.value)}
                    className="bg-transparent font-black text-sm text-white focus:outline-none cursor-pointer"
                  />
                </div>
              </div>

              <button
                onClick={handleNextDay}
                className="p-2 hover:bg-white/15 text-slate-200 hover:text-white rounded-xl transition-all cursor-pointer active:scale-95"
                title="วันถัดไป"
              >
                <ChevronRight size={18} />
              </button>
            </div>

            {!isViewingToday && (
              <button
                onClick={handleJumpToToday}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-black transition-all shadow-md active:scale-95 cursor-pointer whitespace-nowrap"
              >
                กลับมาวันนี้
              </button>
            )}
            {outOfPlanTasks.length > 0 && (
              <button
                onClick={() => setActiveTab('out_of_plan')}
                className={`px-4 py-2 rounded-xl text-xs font-black transition-all cursor-pointer ${
                  activeTab === 'out_of_plan'
                    ? 'bg-purple-600 text-white shadow-sm'
                    : 'bg-purple-50 text-purple-700 hover:bg-purple-100 border border-purple-200'
                }`}
              >
                🟣 นอกแผน / ล่วงหน้า ({outOfPlanTasks.length})
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 🚀 Primary Mode Switcher (2 Big Tabs) */}
      <div className="flex items-center gap-3 border-b border-slate-200 pb-2">
        <button
          onClick={() => setMainTab('schedule')}
          className={`flex items-center gap-2.5 px-5 py-3 rounded-2xl text-xs sm:text-sm font-black transition-all cursor-pointer ${
            mainTab === 'schedule'
              ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20'
              : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200/80'
          }`}
        >
          <CalendarDays size={18} />
          <span>งานตามแผนประจำวัน</span>
          <span
            className={`px-2 py-0.5 rounded-full text-[11px] font-black ${
              mainTab === 'schedule' ? 'bg-blue-700 text-blue-100' : 'bg-slate-100 text-slate-600'
            }`}
          >
            {summary.totalTasks}
          </span>
        </button>

        <button
          onClick={() => setMainTab('activity')}
          className={`flex items-center gap-2.5 px-5 py-3 rounded-2xl text-xs sm:text-sm font-black transition-all cursor-pointer ${
            mainTab === 'activity'
              ? 'bg-purple-600 text-white shadow-md shadow-purple-500/20'
              : 'bg-white text-slate-600 hover:bg-purple-50 hover:text-purple-700 border border-slate-200/80'
          }`}
        >
          <Activity size={18} />
          <span>บันทึกกิจกรรมจริง</span>
          <span
            className={`px-2 py-0.5 rounded-full text-[11px] font-black ${
              mainTab === 'activity' ? 'bg-purple-700 text-purple-100' : 'bg-slate-100 text-slate-600'
            }`}
          >
            {dailyActivities.totalActivities}
          </span>
        </button>

        <button
          onClick={() => setMainTab('rework')}
          className={`flex items-center gap-2.5 px-5 py-3 rounded-2xl text-xs sm:text-sm font-black transition-all cursor-pointer ${
            mainTab === 'rework'
              ? 'bg-rose-600 text-white shadow-md shadow-rose-500/20'
              : 'bg-white text-slate-600 hover:bg-rose-50 hover:text-rose-700 border border-slate-200/80'
          }`}
        >
          <Wrench size={18} />
          <span>งานที่ต้องแก้ไขด่วน</span>
          {reworkQueue.length > 0 && (
            <span
              className={`px-2 py-0.5 rounded-full text-[11px] font-black animate-pulse ${
                mainTab === 'rework' ? 'bg-rose-800 text-rose-100' : 'bg-rose-100 text-rose-700'
              }`}
            >
              {reworkQueue.length}
            </span>
          )}
        </button>
      
        {(isAdmin || isOwner || isSiteEngineer || isProjectPlanner) && (
          <button
            onClick={() => setMainTab('calendar')}
            className={`flex items-center gap-2.5 px-5 py-3 rounded-2xl text-xs sm:text-sm font-black transition-all cursor-pointer ${
              mainTab === 'calendar'
                ? 'bg-amber-600 text-white shadow-md shadow-amber-500/20'
                : 'bg-white text-slate-600 hover:bg-amber-50 hover:text-amber-800 border border-slate-200/80'
            }`}
          >
            <Calendar size={18} />
            <span>ปฏิทินตรวจงานรายเดือน (Owner)</span>
          </button>
        )}
      </div>

      {/* ⚠️ Actionable Rework Banner (Shown in Schedule mode if rework items exist) */}
      {mainTab === 'schedule' && reworkQueue.length > 0 && (
        <div className="bg-gradient-to-r from-rose-50 via-amber-50 to-rose-50 border border-rose-200/90 rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs animate-in slide-in-from-top-2">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-rose-500 text-white rounded-xl shadow-xs shrink-0">
              <Flame size={18} className="animate-bounce" />
            </div>
            <div>
              <p className="text-sm font-black text-rose-950 flex items-center gap-2">
                <span>มีงานที่ต้องแก้ไขด่วนค้างอยู่ {reworkQueue.length} รายการ</span>
                <span className="px-2 py-0.5 bg-rose-200/80 text-rose-800 text-[10px] font-black rounded-full">
                  ต้องเร่งดำเนินการ
                </span>
              </p>
              <p className="text-xs text-rose-800 font-medium mt-0.5">
                มีงวดงานที่โดน QC สั่งแจ้งแก้ไข หรือ Defect ที่ยังรอการแก้ไขในแปลงที่คุณรับผิดชอบ
              </p>
            </div>
          </div>
          <button
            onClick={() => setMainTab('rework')}
            className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-black rounded-xl transition-all shadow-xs shrink-0 cursor-pointer flex items-center gap-1.5 active:scale-95 whitespace-nowrap"
          >
            <span>ดูรายการงานแก้ไข ({reworkQueue.length})</span>
            <ArrowRight size={14} />
          </button>
        </div>
      )}

      {/* 📜 Past Date Historical Snapshot Notice */}
      {mainTab === 'schedule' && isViewingPast && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-center justify-between gap-4 text-amber-900 shadow-xs animate-in slide-in-from-top-2">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-100 rounded-xl text-amber-700 shrink-0">
              <Clock size={20} />
            </div>
            <div>
              <p className="text-sm font-black">
                📜 คุณกำลังดูบันทึกประวัติแผนงานย้อนหลัง ณ {thaiDateLabel}
              </p>
              <p className="text-xs text-amber-700 mt-0.5">
                ข้อมูลแผนงานและการตรวจงานถูกแช่แข็งตามสภาพจริง ณ วันดังกล่าว ไม่ถูกกระทบจากการขยายหรือเปลี่ยนแผนในอนาคต
              </p>
            </div>
          </div>
          <button
            onClick={handleJumpToToday}
            className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-xl transition-all shrink-0 cursor-pointer"
          >
            ไปที่วันนี้
          </button>
        </div>
      )}

      {/* ⚙️ Toolbar: Foreman Selector, Project Filter, Search & Auto-Save Badge */}
      {mainTab !== 'calendar' && (
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-200/80 flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          {/* Foreman Selector */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-black text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
              <User size={14} className="text-blue-600" />
              โฟร์แมน:
            </span>
            {canSwitchForeman ? (
              <select
                value={selectedForeman}
                onChange={e => setSelectedForeman(e.target.value)}
                className="bg-slate-50 border border-slate-200 text-slate-800 text-xs font-bold rounded-xl px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:outline-none transition-all cursor-pointer"
              >
                <option value="all">👷 โฟร์แมนทุกคน (รวมทุกไซต์)</option>
                {availableForemen.map(fm => (
                  <option key={fm} value={fm}>
                    👷 โฟร์แมน: {fm}
                  </option>
                ))}
              </select>
            ) : (
              <span className="px-3 py-1.5 bg-blue-50 text-blue-700 rounded-xl text-xs font-black border border-blue-200">
                👷 โฟร์แมน: {selectedForeman === 'all' ? currentForemanName || 'ฉัน' : selectedForeman}
              </span>
            )}
          </div>

          {/* Project Filter */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-black text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
              <Building2 size={14} className="text-slate-600" />
              โครงการ:
            </span>
            <select
              value={selectedProject}
              onChange={e => setSelectedProject(e.target.value)}
              className="bg-slate-50 border border-slate-200 text-slate-800 text-xs font-bold rounded-xl px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:outline-none transition-all cursor-pointer"
            >
              <option value="all">ทุกโครงการ</option>
              {projects.map((p: any, idx: number) => {
                const name = p.name || p.project_name || `โครงการ ${idx + 1}`;
                return (
                  <option key={p.id || name} value={name}>
                    {name}
                  </option>
                );
              })}
            </select>
          </div>
        </div>

        {/* Search & Auto-Save Status Badge */}
        {mainTab !== 'activity' && (
        <div className="flex items-center gap-2">
          <div className="relative flex-1 sm:w-64">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder={mainTab === 'schedule' ? 'ค้นหาแปลง, ชื่องาน, ช่าง...' : 'ค้นหารายการแก้ไข, แปลง, ช่าง...'}
              value={mainTab === 'schedule' ? searchQuery : reworkSearch}
              onChange={e => {
                if (mainTab === 'schedule') setSearchQuery(e.target.value);
                else setReworkSearch(e.target.value);
              }}
              className="w-full bg-slate-50 border border-slate-200 text-xs font-medium rounded-xl pl-9 pr-3 py-2 focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />
          </div>

          {/* ☁️ Auto-Save Status Badge */}
          <div
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-black transition-all border shrink-0 shadow-xs ${
              autoSaveStatus === 'cached_offline'
                ? 'bg-amber-50 border-amber-200/90 text-amber-800'
                : autoSaveStatus === 'error'
                ? 'bg-red-50 border-red-200/90 text-red-800'
                : autoSaveStatus === 'idle'
                ? 'bg-slate-50 border-slate-200/90 text-slate-600'
                : 'bg-emerald-50 border-emerald-200/90 text-emerald-800'
            }`}
            title="ระบบบันทึกประวัติแผนงานประจำวันให้อัตโนมัติในเบื้องหลัง"
          >
            {autoSaveStatus === 'saving' ? (
              <>
                <RefreshCw size={13} className="animate-spin text-emerald-600" />
                <span>กำลังบันทึกอัตโนมัติ...</span>
              </>
            ) : autoSaveStatus === 'cached_offline' ? (
              <>
                <CheckCircle2 size={13} className="stroke-[2.5] text-amber-600" />
                <span>บันทึกลงแคชเครื่องแล้ว (ออฟไลน์)</span>
              </>
            ) : autoSaveStatus === 'saved' ? (
              <>
                <CheckCircle2 size={13} className="stroke-[2.5] text-emerald-600" />
                <span>บันทึกประวัติอัตโนมัติแล้ว</span>
              </>
            ) : autoSaveStatus === 'error' ? (
              <>
                <AlertCircle size={13} className="stroke-[2.5] text-red-600" />
                <span>การบันทึกขัดข้อง (คลิกเพื่อลองใหม่)</span>
              </>
            ) : (
              <>
                <Cloud size={13} className="stroke-[2.5] text-slate-500" />
                <span>พร้อมบันทึกอัตโนมัติ</span>
              </>
            )}
          </div>
        </div>
        )}
      </div>
      )}

      {/* ============================================================== */}
      {/* 📅 MODE 1: DAILY SCHEDULED TASKS (งานตามแผนประจำวัน) */}
      {/* ============================================================== */}
      {mainTab === 'schedule' && (
        <div className="space-y-6">
          {/* 📊 KPI Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 sm:gap-4">
            {/* Total Tasks */}
            <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-500">งานตามแผนวันนี้</span>
                <div className="p-2 bg-blue-50 text-blue-600 rounded-xl">
                  <CalendarDays size={18} />
                </div>
              </div>
              <div className="mt-2">
                <div className="text-2xl font-black text-slate-900">{summary.totalTasks}</div>
                <p className="text-[11px] text-slate-400 font-medium mt-0.5">
                  กระจายใน {summary.plotsCount} แปลงบ้าน
                </p>
              </div>
            </div>

            {/* Updated Today */}
            <div className="bg-white rounded-2xl p-4 border border-emerald-200/80 shadow-xs flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-emerald-700">อัปเดตแล้ววันนี้</span>
                <div className="p-2 bg-emerald-50 text-emerald-600 rounded-xl">
                  <CheckCircle2 size={18} />
                </div>
              </div>
              <div className="mt-2">
                <div className="text-2xl font-black text-emerald-600">{summary.updatedTasks}</div>
                <p className="text-[11px] text-emerald-700 font-medium mt-0.5">
                  {summary.totalTasks > 0
                    ? `${Math.round((summary.updatedTasks / summary.totalTasks) * 100)}% ของงานทั้งหมด`
                    : 'ไม่มีงานตกค้าง'}
                </p>
              </div>
            </div>

            {/* Roadblocks Reported */}
            <div className="bg-white rounded-2xl p-4 border border-amber-200/80 shadow-xs flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-amber-700">แจ้งติดปัญหา</span>
                <div className="p-2 bg-amber-50 text-amber-600 rounded-xl">
                  <AlertTriangle size={18} />
                </div>
              </div>
              <div className="mt-2">
                <div className="text-2xl font-black text-amber-600">{summary.roadblockTasks}</div>
                <p className="text-[11px] text-amber-700 font-medium mt-0.5">มีบันทึกเหตุผลรองรับ</p>
              </div>
            </div>

            {/* Pending Tasks */}
            <div className="bg-white rounded-2xl p-4 border border-rose-200/80 shadow-xs flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-rose-700">ยังไม่อัปเดต</span>
                <div className="p-2 bg-rose-50 text-rose-600 rounded-xl">
                  <Clock size={18} />
                </div>
              </div>
              <div className="mt-2">
                <div className="text-2xl font-black text-rose-600">{summary.pendingTasks}</div>
                <p className="text-[11px] text-rose-700 font-medium mt-0.5">รอโฟร์แมนเข้าตรวจสอบ</p>
              </div>
            </div>

            {/* Out-of-Plan / Early Work Today */}
            <div
              onClick={() => setActiveTab(activeTab === 'out_of_plan' ? 'all' : 'out_of_plan')}
              className={`rounded-2xl p-4 border shadow-xs flex flex-col justify-between cursor-pointer transition-all ${
                activeTab === 'out_of_plan'
                  ? 'bg-purple-50/90 border-purple-400 ring-2 ring-purple-500/20 shadow-md'
                  : 'bg-white border-purple-200/80 hover:border-purple-300 hover:bg-purple-50/30'
              }`}
              title="คลิกเพื่อกรองดูเฉพาะงานนอกแผน/ล่วงหน้า"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-black text-purple-900">นอกแผน / ล่วงหน้า</span>
                <div className="p-2 bg-purple-100 text-purple-700 rounded-xl">
                  <Sparkles size={18} />
                </div>
              </div>
              <div className="mt-2">
                <div className="text-2xl font-black text-purple-700">
                  {outOfPlanTasks.length}
                </div>
                <p className="text-[11px] text-purple-600 font-medium mt-0.5">
                  อัปเดตนอกตารางแผน
                </p>
              </div>
            </div>

            {/* Daily Compliance Gauge */}
            <div className="bg-gradient-to-br from-blue-600 to-indigo-700 rounded-2xl p-4 text-white shadow-md flex flex-col justify-between col-span-2 md:col-span-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-blue-100">อัตราการตรวจงาน</span>
                <Sparkles size={18} className="text-amber-300" />
              </div>
              <div className="mt-2">
                <div className="text-3xl font-black tracking-tight">{summary.complianceRate}%</div>
                <div className="w-full bg-blue-900/40 rounded-full h-2 mt-2 overflow-hidden">
                  <div
                    className="bg-amber-300 h-2 rounded-full transition-all duration-500"
                    style={{ width: `${summary.complianceRate}%` }}
                  />
                </div>
                <p className="text-[10px] text-blue-100 font-semibold mt-1">
                  (อัปเดตงาน + แจ้งติดปัญหา)
                </p>
              </div>
            </div>
          </div>

          {/* ⚡ Daily Total Effort Banner */}
          {outOfPlanTasks.length > 0 && (
            <div className="bg-purple-50/80 border border-purple-200/90 rounded-2xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-purple-950 shadow-2xs">
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 bg-purple-600 text-white rounded-lg shrink-0">
                  <Sparkles size={16} />
                </div>
                <div>
                  <span className="font-black">สรุปการลงพื้นที่จริงวันนี้: </span>
                  <span>
                    โฟร์แมนตรวจและอัปเดตงานจริงรวม{' '}
                    <strong className="text-purple-700 font-black text-sm">
                      {summary.updatedTasks + summary.roadblockTasks + outOfPlanTasks.length}
                    </strong>{' '}
                    งาน (ในแผน {summary.updatedTasks + summary.roadblockTasks} งาน + นอกแผน/ล่วงหน้า {outOfPlanTasks.length} งาน)
                  </span>
                </div>
              </div>
              <button
                onClick={() => setActiveTab(activeTab === 'out_of_plan' ? 'all' : 'out_of_plan')}
                className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl font-bold transition-all shrink-0 cursor-pointer text-xs active:scale-95"
              >
                {activeTab === 'out_of_plan' ? 'ดูงานทั้งหมด' : `ดูงานนอกแผน (${outOfPlanTasks.length})`}
              </button>
            </div>
          )}

          {/* 🏷️ Filter Tabs for Schedule */}
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 pb-3">
            <button
              onClick={() => setActiveTab('all')}
              className={`px-4 py-2 rounded-xl text-xs font-black transition-all cursor-pointer ${
                activeTab === 'all'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
              }`}
            >
              ทั้งหมด ({summary.totalTasks})
            </button>
            <button
              onClick={() => setActiveTab('pending')}
              className={`px-4 py-2 rounded-xl text-xs font-black transition-all cursor-pointer ${
                activeTab === 'pending'
                  ? 'bg-rose-600 text-white shadow-sm'
                  : 'bg-white text-rose-700 hover:bg-rose-50 border border-rose-200'
              }`}
            >
              ⏳ ยังไม่อัปเดต ({summary.pendingTasks})
            </button>
            <button
              onClick={() => setActiveTab('updated')}
              className={`px-4 py-2 rounded-xl text-xs font-black transition-all cursor-pointer ${
                activeTab === 'updated'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'bg-white text-emerald-700 hover:bg-emerald-50 border border-emerald-200'
              }`}
            >
              ✅ อัปเดตแล้ว ({summary.updatedTasks})
            </button>
            <button
              onClick={() => setActiveTab('roadblock')}
              className={`px-4 py-2 rounded-xl text-xs font-black transition-all cursor-pointer ${
                activeTab === 'roadblock'
                  ? 'bg-amber-600 text-white shadow-sm'
                  : 'bg-white text-amber-700 hover:bg-amber-50 border border-amber-200'
              }`}
            >
              ⚠️ แจ้งติดปัญหา ({summary.roadblockTasks})
            </button>
            {(summary.completedEarlyTasks || 0) > 0 && (
              <button
                onClick={() => setActiveTab('completed_early')}
                className={`px-4 py-2 rounded-xl text-xs font-black transition-all cursor-pointer ${
                  activeTab === 'completed_early'
                    ? 'bg-emerald-700 text-white shadow-sm'
                    : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100 border border-emerald-300'
                }`}
              >
                🎉 เสร็จล่วงหน้า ({summary.completedEarlyTasks})
              </button>
            )}
          </div>

          {/* Banner notification for completed early tasks */}
          {(summary.completedEarlyTasks || 0) > 0 && activeTab !== 'completed_early' && (
            <div className="bg-emerald-50/80 border border-emerald-200/90 rounded-2xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-emerald-950 shadow-2xs">
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 bg-emerald-600 text-white rounded-lg shrink-0">
                  <CheckCircle2 size={16} />
                </div>
                <span>
                  มีงานในแผนที่โฟร์แมนตรวจและส่งมอบความคืบหน้า <strong>100% เสร็จสิ้นล่วงหน้าแล้ว {summary.completedEarlyTasks} รายการ</strong> (ระบบไม่นำมานับเป็นงานค้างของวันนี้)
                </span>
              </div>
              <button
                onClick={() => setActiveTab('completed_early')}
                className="px-3 py-1 bg-white hover:bg-emerald-100 text-emerald-800 rounded-xl font-bold border border-emerald-300 transition-all cursor-pointer whitespace-nowrap self-end sm:self-auto"
              >
                ดูรายการที่เสร็จแล้ว ({summary.completedEarlyTasks})
              </button>
            </div>
          )}

          {/* 📋 Task Cards List */}
          {activeTab === 'out_of_plan' ? (
            filteredOutOfPlanTasks.length === 0 ? (
              <div className="bg-white rounded-3xl p-12 text-center border border-slate-200/80 shadow-xs space-y-3">
                <div className="w-16 h-16 bg-purple-50 text-purple-600 rounded-full flex items-center justify-center mx-auto">
                  <Sparkles size={32} />
                </div>
                <h3 className="text-lg font-black text-slate-800">ไม่มีงานนอกแผน/ล่วงหน้า</h3>
                <p className="text-sm text-slate-500 max-w-md mx-auto">
                  {searchQuery ? 'ไม่พบรายการงานนอกแผนที่ตรงกับคำค้นหา' : 'ไม่มีการอัปเดตงานนอกแผนหรือล่วงหน้าในวันนี้'}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {filteredOutOfPlanTasks.map(task => renderOutOfPlanCard(task))}
              </div>
            )
          ) : filteredTasks.length === 0 && !(activeTab === 'all' && filteredOutOfPlanTasks.length > 0) ? (
            <div className="bg-white rounded-3xl p-12 text-center border border-slate-200/80 shadow-xs space-y-3">
              <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mx-auto">
                <CheckSquare size={32} />
              </div>
              <h3 className="text-lg font-black text-slate-800">ไม่มีงานตามเงื่อนไขที่เลือก</h3>
              <p className="text-sm text-slate-500 max-w-md mx-auto">
                {activeTab === 'pending'
                  ? 'ยินดีด้วย! คุณได้เข้าตรวจและอัปเดตงานตามแผนของวันนี้ครบถ้วนแล้ว'
                  : 'ไม่พบรายการงานตามแผนที่ตรงกับเงื่อนไขการค้นหาหรือตัวกรองในขณะนี้'}
              </p>
            </div>
          ) : (
            <>
            {filteredTasks.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {filteredTasks.map(task => {
                const reasonMeta = getRoadblockReason(task.status_reason);

                return (
                  <div
                    key={task.id}
                    className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs hover:shadow-md transition-all flex flex-col justify-between group"
                  >
                    <div>
                      {/* Card Header: Plot & Status Badge */}
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div className="space-y-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="px-2.5 py-1 bg-blue-50 text-blue-700 font-black text-xs rounded-lg border border-blue-200">
                              {task.plot_name}
                            </span>
                            <span className="text-[11px] text-slate-400 font-bold">
                              {task.project_name}
                            </span>
                          </div>
                          {selectedForeman === 'all' && (
                            <p className="text-[11px] text-slate-500 font-semibold flex items-center gap-1">
                              <User size={12} className="text-slate-400" />
                              <span>โฟร์แมน: {task.foreman_name}</span>
                            </p>
                          )}
                        </div>

                        {/* Status Badge */}
                        {task.is_completed_early ? (
                          <span className="px-2.5 py-1 bg-emerald-100 text-emerald-800 border border-emerald-300 text-[11px] font-black rounded-lg flex items-center gap-1 shrink-0">
                            <CheckCircle2 size={13} className="stroke-[2.5]" />
                            <span>เสร็จ 100% ล่วงหน้าแล้ว</span>
                          </span>
                        ) : task.is_updated_today ? (
                          <span className="px-2.5 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px] font-black rounded-lg flex items-center gap-1 shrink-0">
                            <CheckCircle2 size={13} className="stroke-[2.5]" />
                            <span>อัปเดตแล้ววันนี้</span>
                          </span>
                        ) : task.status_reason ? (
                          <span className="px-2.5 py-1 bg-amber-50 text-amber-800 border border-amber-200 text-[11px] font-black rounded-lg flex items-center gap-1 shrink-0">
                            <span>{reasonMeta?.icon || '⚠️'}</span>
                            <span className="truncate max-w-[120px]">{reasonMeta?.label || 'ติดปัญหา'}</span>
                          </span>
                        ) : (
                          <span className="px-2.5 py-1 bg-rose-50 text-rose-700 border border-rose-200 text-[11px] font-black rounded-lg flex items-center gap-1 shrink-0">
                            <Clock size={13} />
                            <span>ยังไม่อัปเดต</span>
                          </span>
                        )}
                      </div>

                      {/* Task Name & Order */}
                      <div className="mb-3">
                        <h4 className="text-base font-black text-slate-900 group-hover:text-blue-600 transition-colors">
                          {task.task_name}
                        </h4>
                        <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1.5 font-medium">
                          <Calendar size={13} className="text-slate-400" />
                          <span>
                            ตามแผน: {task.planned_start} ถึง {task.planned_end}
                          </span>
                        </p>
                      </div>

                      {/* Progress bar */}
                      <div className="space-y-1.5 mb-3 bg-slate-50 p-3 rounded-xl border border-slate-100">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-slate-500 font-bold">ความคืบหน้าปัจจุบัน</span>
                          <span className="font-black text-slate-800">{task.current_progress}%</span>
                        </div>
                        <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden">
                          <div
                            className={`h-2 rounded-full transition-all duration-300 ${
                              task.current_progress >= 100
                                ? 'bg-emerald-500'
                                : task.current_progress > 0
                                ? 'bg-blue-600'
                                : 'bg-slate-300'
                            }`}
                            style={{ width: `${Math.min(100, Math.max(0, task.current_progress))}%` }}
                          />
                        </div>
                        {task.contractor_name && (
                          <p className="text-[11px] text-slate-500 font-medium truncate pt-1">
                            👷 ผู้รับเหมา: <span className="font-bold text-slate-700">{task.contractor_name}</span>
                          </p>
                        )}
                      </div>

                      {/* Reason Callout if reported */}
                      {task.status_reason && !task.is_updated_today && (
                        <div className="mb-3 p-3 bg-amber-50/80 rounded-xl border border-amber-200/80 text-amber-900 space-y-1">
                          <div className="text-xs font-black flex items-center gap-1.5 text-amber-800">
                            <span>{reasonMeta?.icon}</span>
                            <span>{reasonMeta?.label}</span>
                          </div>
                          {task.status_note && (
                            <p className="text-[11px] text-amber-700 font-medium leading-relaxed">
                              หมายเหตุ: {task.status_note}
                            </p>
                          )}
                        </div>
                      )}

                      {/* Update note if updated today */}
                      {task.is_updated_today && task.last_action && (
                        <div className="mb-3 p-2.5 bg-emerald-50/70 rounded-xl border border-emerald-100 text-[11px] text-emerald-800 font-medium">
                          บันทึกวันนี้: <span className="font-bold">{task.last_action}</span>
                        </div>
                      )}
                    </div>

                    {/* Card Action Buttons */}
                    <div className="pt-3 border-t border-slate-100 flex items-center gap-2">
                      <button
                        onClick={() => handleOpenChat(task)}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-black shadow-xs active:scale-95 transition-all cursor-pointer"
                        title="เข้าห้องแชทและบันทึกอัปเดตงานนี้"
                      >
                        <MessageSquare size={14} className="stroke-[2.5]" />
                        <span>เข้าห้องแชท / อัปเดต</span>
                      </button>

                      <button
                        onClick={() => {
                          setSelectedTaskForRoadblock(task);
                          setSelectedReasonId(task.status_reason || 'material_issue');
                          setRoadblockNote(task.status_note || '');
                          setRoadblockSubmissionId('sub_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7));
                        }}
                        className={`p-2 rounded-xl text-xs font-bold border transition-all active:scale-95 cursor-pointer ${
                          task.status_reason
                            ? 'bg-amber-50 border-amber-300 text-amber-700 hover:bg-amber-100'
                            : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100 hover:text-amber-700'
                        }`}
                        title="แจ้งเหตุผลไม่เริ่มงาน / ติดปัญหา"
                      >
                        <AlertTriangle size={15} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            )}

            {/* 🟣 Out-of-Plan Section in All Tab */}
            {activeTab === 'all' && filteredOutOfPlanTasks.length > 0 && (
              <div className="mt-8 pt-6 border-t-2 border-dashed border-purple-200 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <div className="p-2 bg-purple-100 text-purple-700 rounded-xl">
                      <Sparkles size={18} />
                    </div>
                    <div>
                      <h3 className="text-base sm:text-lg font-black text-slate-900 flex items-center gap-2">
                        <span>งานนอกแผน / ทำล่วงหน้าที่อัปเดตวันนี้</span>
                        <span className="px-2.5 py-0.5 bg-purple-100 text-purple-800 rounded-full text-xs font-black">
                          {filteredOutOfPlanTasks.length} รายการ
                        </span>
                      </h3>
                      <p className="text-xs text-slate-500 font-medium">
                        งานที่โฟร์แมนเข้าตรวจสอบหรือส่งงานในวันนี้ โดยอยู่นอกตารางแผนประจำวัน
                      </p>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {filteredOutOfPlanTasks.map(task => renderOutOfPlanCard(task))}
                </div>
              </div>
            )}
            </>
          )}
        </div>
      )}

      {/* ============================================================== */}
      {/* 📜 MODE 4: DAILY ACTUAL ACTIVITIES (บันทึกกิจกรรมจริงประจำวัน) */}
      {/* ============================================================== */}
      {mainTab === 'activity' && (
        <ForemanDailyActivityView
          activitySummary={dailyActivities}
          selectedDate={selectedDate}
          selectedForeman={selectedForeman}
          onNavigateToTaskChat={handleOpenChat as any}
          onNavigateToDefectChat={handleOpenDefectChat as any}
          onSelectPlot={onSelectPlot}
          onSwitchToSchedule={() => setMainTab('schedule')}
        />
      )}

      {/* ============================================================== */}
      {/* 🛠️ MODE 2: REWORKS & DEFECTS (งานที่ต้องแก้ไข & Defect ค้าง) */}
      {/* ============================================================== */}
      {mainTab === 'rework' && (
        <div className="space-y-6 animate-in fade-in duration-200">
          {/* ส่วนหัว: โซนแท็บเมนูและปุ่มเปลี่ยนมุมมองแบบเดียวกับรูปที่ 1 */}
          <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 mb-4 sm:mb-8">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6">
              <h2 className="font-semibold text-xl tracking-tight sm:text-2xl text-[#1d1d1f] flex items-center gap-2">
                <ClipboardList className="text-orange-500" size={24} />
                <span>⚠️ งานที่ต้องแก้ไขด่วน</span>
                <span className="bg-[#1d1d1f] text-white text-[11px] px-2.5 py-0.5 rounded-full font-medium">
                  {reworkQueue.length}
                </span>
              </h2>
            </div>

            <div className="flex items-center gap-2 w-full xl:w-auto">
              {/* View Mode Toggle: Card / List */}
              <div className="flex bg-black/5 p-1 rounded-xl shrink-0 backdrop-blur-md">
                <button
                  onClick={() => setReworkViewMode('card')}
                  className={`p-2 rounded-lg transition-colors duration-150 active:scale-[0.98] ${
                    reworkViewMode === 'card' ? 'bg-white shadow-sm text-blue-500' : 'text-[#86868b] hover:text-[#1d1d1f]'
                  }`}
                  title="มุมมองการ์ด"
                >
                  <Grid size={16} />
                </button>
                <button
                  onClick={() => setReworkViewMode('list')}
                  className={`p-2 rounded-lg transition-colors duration-150 active:scale-[0.98] ${
                    reworkViewMode === 'list' ? 'bg-white shadow-sm text-blue-500' : 'text-[#86868b] hover:text-[#1d1d1f]'
                  }`}
                  title="มุมมองตาราง"
                >
                  <ClipboardList size={16} />
                </button>
              </div>

              {/* เรียงลำดับ: ล่าสุด / รหัสแปลง */}
              <div className="flex bg-white/80 backdrop-blur-md rounded-xl shadow-[0_2px_10px_rgb(0,0,0,0.02)] border border-white overflow-hidden text-[11px] sm:text-xs font-medium flex-1 xl:flex-none">
                <button
                  onClick={() => setReworkSort('time')}
                  className={`flex-1 xl:flex-none px-4 py-2.5 flex justify-center items-center gap-1.5 transition-colors duration-150 active:scale-[0.98] ${
                    reworkSort === 'time' ? 'bg-black/5 text-[#1d1d1f]' : 'text-[#86868b] hover:bg-black/5'
                  }`}
                >
                  <Clock size={14} /> ล่าสุด
                </button>
                <button
                  onClick={() => setReworkSort('plot')}
                  className={`flex-1 xl:flex-none px-4 py-2.5 flex justify-center items-center gap-1.5 border-l border-black/5 transition-colors duration-150 active:scale-[0.98] ${
                    reworkSort === 'plot' ? 'bg-black/5 text-[#1d1d1f]' : 'text-[#86868b] hover:bg-black/5'
                  }`}
                >
                  <SortAsc size={14} /> รหัสแปลง
                </button>
              </div>
            </div>
          </div>

          {/* พื้นที่แสดงผลคิวงาน */}
          {reworkQueue.length === 0 ? (
            <div className="bg-white/60 backdrop-blur-xl rounded-[2rem] border border-dashed border-black/10 p-10 sm:p-16 text-center flex flex-col items-center justify-center gap-4">
              <div className="w-20 h-20 bg-emerald-50 rounded-full flex items-center justify-center mb-2">
                <CheckCircle2 size={36} className="text-emerald-400" />
              </div>
              <p className="text-[#86868b] font-medium text-sm sm:text-lg">ไม่มีงานที่ต้องแก้ไขด่วนในขณะนี้</p>
            </div>
          ) : (
            <div className="max-h-[70vh] overflow-y-auto custom-scrollbar pr-1 sm:pr-3 pb-4">
              {reworkViewMode === 'card' ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {reworkQueue.map((q) => {
                    const isUrgent = (Date.now() - q.time) > 172800000;
                    const relatedPlot = plots.find(p => String(p.id) === String(q.plot_id));
                    const relatedTask = taskTemplates.find(t => String(t.id) === String(q.task_template_id));
                    const relatedProject = projects.find(p => p.name === q.project_name);
                    const clickAction = () => {
                      if (setSelectedGlobalProject && relatedProject) {
                        setSelectedGlobalProject(relatedProject);
                      }
                      if (relatedPlot && relatedTask && onNavigateToTaskChat) {
                        onNavigateToTaskChat(relatedPlot, relatedTask);
                      }
                    };

                    return (
                      <button
                        key={`${q.plot_id}-${q.task_template_id}`}
                        onClick={clickAction}
                        className={`bg-white/80 backdrop-blur-xl p-5 sm:p-6 rounded-[1.5rem] border ${
                          isUrgent ? 'border-rose-400 bg-rose-50/50' : 'border-white'
                        } shadow-[0_4px_20px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] hover:-translate-y-1 active:scale-[0.98] transition-all duration-300 text-left group relative overflow-hidden cursor-pointer`}
                      >
                        {isUrgent && <div className="absolute top-0 left-0 w-full h-1.5 bg-rose-500"></div>}
                        <div className="flex justify-between items-start mb-4">
                          <span
                            className={`text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-lg text-white shadow-sm ${
                              q.statusFor === 'Rework' ? 'bg-orange-500' : (q.statusFor === 'QC' ? 'bg-purple-500' : 'bg-blue-500')
                            }`}
                          >
                            {q.statusFor === 'Rework' ? 'แก้ไข' : `รอ ${q.statusFor}`}
                          </span>
                          <span
                            className={`text-[10px] font-medium flex items-center gap-1.5 px-2.5 py-1 rounded-lg ${
                              isUrgent ? 'bg-rose-100 text-rose-600' : 'bg-black/5 text-[#86868b]'
                            }`}
                          >
                            <Clock size={12} /> {new Date(q.time).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })}{' '}
                            {new Date(q.time).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                          <h4 className="font-semibold text-[#1d1d1f] text-2xl">{q.plot_name || q.plot_id}</h4>
                          {relatedPlot && <MeterStatusBadges plot={relatedPlot} size="sm" interactive={false} />}
                          {isUrgent && <AlertTriangle size={18} className="text-rose-500" />}
                          {q.isRejected && (
                            <span className="bg-orange-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-md flex items-center gap-1 shadow-sm whitespace-nowrap shrink-0">
                              ⚠️ ถูกตีกลับ
                            </span>
                          )}
                        </div>
                        <p className="text-xs sm:text-sm font-medium text-[#86868b] line-clamp-2 mb-4 min-h-[32px] sm:min-h-[40px] leading-relaxed">
                          {q.task_name}
                        </p>
                        <div className="flex items-center gap-2 pt-4 border-t border-black/5">
                          <div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
                            <HardHat size={12} className="text-slate-400" />
                          </div>
                          <p className="text-[11px] sm:text-xs text-[#86868b] font-medium truncate">{q.foreman}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                /* List View matching Image 1's list view */
                <div className="flex flex-col gap-6 w-full">
                  {Object.entries(
                    reworkQueue.reduce((acc: Record<string, any[]>, q: any) => {
                      const key = q.plot_name || q.plot_id;
                      if (!acc[key]) acc[key] = [];
                      acc[key].push(q);
                      return acc;
                    }, {} as Record<string, any[]>)
                  ).map(([plotId, rawItems]) => {
                    const items = rawItems as any[];
                    const relatedPlot = plots.find(p => String(p.id) === String(items[0]?.plot_id) || p.plot_name === plotId);
                    return (
                      <div
                        key={plotId}
                        className="bg-white/80 backdrop-blur-xl rounded-[1.5rem] border border-white shadow-[0_4px_20px_rgb(0,0,0,0.03)] overflow-hidden w-full"
                      >
                        <div className="bg-black/[0.02] border-b border-black/5 px-5 py-4 flex items-center justify-between">
                          <h3 className="font-semibold text-[#1d1d1f] flex items-center gap-2 text-lg">
                            <Home size={18} className="text-blue-500" /> แปลง {plotId}
                            {relatedPlot && <MeterStatusBadges plot={relatedPlot} size="sm" interactive={false} />}
                          </h3>
                          <span className="text-[11px] font-medium bg-black/5 text-[#86868b] px-2.5 py-1 rounded-lg">
                            {items.length} งาน
                          </span>
                        </div>
                        <div className="flex flex-col">
                          {items.map((q: any, idx: number) => {
                            const isUrgent = (Date.now() - q.time) > 172800000;
                            const rPlot = plots.find(p => String(p.id) === String(q.plot_id));
                            const relatedTask = taskTemplates.find(t => String(t.id) === String(q.task_template_id));
                            const relatedProject = projects.find(p => p.name === q.project_name);
                            const clickAction = () => {
                              if (setSelectedGlobalProject && relatedProject) {
                                setSelectedGlobalProject(relatedProject);
                              }
                              if (rPlot && relatedTask && onNavigateToTaskChat) {
                                onNavigateToTaskChat(rPlot, relatedTask);
                              }
                            };
                            return (
                              <button
                                key={`${q.plot_id}-${q.task_template_id}`}
                                onClick={clickAction}
                                className={`p-4 sm:p-5 text-left flex flex-col sm:flex-row sm:items-center justify-between gap-4 group transition-all duration-300 ${
                                  idx !== items.length - 1 ? 'border-b border-black/5' : ''
                                } hover:bg-black/[0.02] ${isUrgent ? 'border-l-4 border-l-rose-500 bg-rose-50/30' : 'border-l-4 border-l-transparent'} cursor-pointer`}
                              >
                                <div className="flex items-center gap-4 flex-1 overflow-hidden">
                                  <div
                                    className={`w-12 h-12 rounded-2xl flex flex-col items-center justify-center shrink-0 shadow-sm ${
                                      q.statusFor === 'Rework'
                                        ? 'bg-orange-100 text-orange-600'
                                        : (q.statusFor === 'QC' ? 'bg-purple-100 text-purple-600' : 'bg-blue-100 text-blue-600')
                                    }`}
                                  >
                                    <span className="text-[10px] font-bold uppercase tracking-wider">
                                      {q.statusFor === 'Rework' ? 'แก้ไข' : `รอ ${q.statusFor}`}
                                    </span>
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                                      <p className="text-sm sm:text-base font-semibold text-[#1d1d1f] truncate group-hover:text-blue-600 transition-colors">
                                        {q.task_name}
                                      </p>
                                      {isUrgent && (
                                        <span className="bg-rose-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-md flex items-center gap-1 shadow-sm whitespace-nowrap shrink-0">
                                          <AlertTriangle size={12} /> ด่วนมาก
                                        </span>
                                      )}
                                      {q.isRejected && (
                                        <span className="bg-orange-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-md flex items-center gap-1 shadow-sm whitespace-nowrap shrink-0">
                                          ⚠️ ถูกตีกลับ
                                        </span>
                                      )}
                                    </div>
                                    <p className="text-[11px] sm:text-xs text-[#86868b] font-medium flex items-center gap-1.5">
                                      <HardHat size={14} /> {q.foreman}
                                    </p>
                                  </div>
                                </div>
                                <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center gap-1 shrink-0 pt-2 sm:pt-0 sm:pl-4">
                                  <span className={`text-[11px] sm:text-xs font-medium ${isUrgent ? 'text-rose-500' : 'text-[#86868b]'}`}>
                                    <Clock size={12} className="inline mr-1" /> {new Date(q.time).toLocaleDateString('th-TH', { month: 'short', day: 'numeric' })}{' '}
                                    {new Date(q.time).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}
                                  </span>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ============================================================== */}
      {/* 📅 MODE 3: MONTHLY AUDIT CALENDAR (ปฏิทินตรวจงานรายเดือน) */}
      {/* ============================================================== */}
      {mainTab === 'calendar' && (
        <ForemanInspectionCalendar
          plots={plots}
          projectName={selectedProject}
          taskTemplates={taskTemplates}
          schedules={schedules}
          assignments={assignments}
          allUpdatesRecord={allUpdatesRecord}
          foremenList={foremenList}
          selectedForeman={selectedForeman}
          onSelectForeman={setSelectedForeman}
          snapshots={snapshots}
          onSelectDate={(dateStr) => {
            setSelectedDate(dateStr);
            setMainTab('schedule');
          }}
          onViewDayActivity={(dateStr) => {
            setSelectedDate(dateStr);
            setMainTab('activity');
          }}
        />
      )}

      {/* 🖼️ Fullscreen Image Preview Lightbox */}
      {previewImage && (
        <div
          onClick={() => setPreviewImage(null)}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200 cursor-pointer"
        >
          <div
            onClick={e => e.stopPropagation()}
            className="relative max-w-4xl max-h-[90vh] bg-white rounded-2xl overflow-hidden shadow-2xl p-2"
          >
            <button
              onClick={() => setPreviewImage(null)}
              className="absolute top-4 right-4 p-2 bg-black/60 hover:bg-black/80 text-white rounded-full transition-all cursor-pointer z-10"
            >
              <X size={18} />
            </button>
            <img
              src={previewImage}
              alt="ภาพขยายขนาดใหญ่"
              className="max-h-[85vh] w-auto max-w-full rounded-xl object-contain mx-auto"
            />
          </div>
        </div>
      )}

      {/* ⚠️ Roadblock Reason Modal */}
      {selectedTaskForRoadblock && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 sm:p-7 shadow-2xl border border-slate-200 space-y-5 animate-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 bg-amber-50 text-amber-700 rounded-lg text-xs font-black border border-amber-200">
                  <AlertTriangle size={13} />
                  <span>บันทึกสถานะงานไม่เริ่ม / ติดปัญหา</span>
                </div>
                <h3 className="text-lg font-black text-slate-900">
                  {selectedTaskForRoadblock.task_name}
                </h3>
                <p className="text-xs text-slate-500 font-medium">
                  {selectedTaskForRoadblock.plot_name} ({selectedTaskForRoadblock.project_name})
                </p>
              </div>
              <button
                onClick={() => { setSelectedTaskForRoadblock(null); setRoadblockSubmitError(null); }}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 transition-all cursor-pointer"
              >
                <X size={20} />
              </button>
            </div>

            {roadblockSubmitError && (
              <div className="p-3 bg-red-50 border border-red-200 text-red-800 rounded-xl text-xs flex items-center gap-2">
                <AlertTriangle size={14} className="text-red-600 shrink-0" />
                <span>{roadblockSubmitError}</span>
              </div>
            )}

            {/* Standard Reasons Options */}
            <div className="space-y-2">
              <label className="text-xs font-black text-slate-700 uppercase tracking-wider">
                เลือกเหตุผลตามมาตรฐาน:
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {ROADBLOCK_REASONS.map(reason => {
                  const isSelected = selectedReasonId === reason.id;
                  return (
                    <button
                      key={reason.id}
                      type="button"
                      onClick={() => setSelectedReasonId(reason.id)}
                      className={`text-left p-3 rounded-xl border text-xs font-bold transition-all cursor-pointer flex items-start gap-2.5 ${
                        isSelected
                          ? 'border-amber-500 bg-amber-50/70 text-amber-950 shadow-xs ring-2 ring-amber-500/20'
                          : 'border-slate-200 hover:border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <span className="text-base leading-none shrink-0">{reason.icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="font-black truncate">{reason.label}</div>
                        <div className="text-[10px] text-slate-500 font-normal line-clamp-1 mt-0.5">
                          {reason.description}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Additional Note */}
            <div className="space-y-1.5">
              <label className="text-xs font-black text-slate-700 uppercase tracking-wider">
                รายละเอียดเพิ่มเติม (ถ้ามี):
              </label>
              <textarea
                rows={3}
                value={roadblockNote}
                onChange={e => setRoadblockNote(e.target.value)}
                placeholder="ระบุรายละเอียด เช่น รอปูนเข้าช่วงบ่าย 14:00 น. หรือ ช่างกำลังเดินทางมาจากแปลง B-02..."
                className="w-full bg-slate-50 border border-slate-200 text-xs font-medium rounded-xl p-3 focus:ring-2 focus:ring-amber-500 focus:outline-none transition-all placeholder:text-slate-400"
              />
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setSelectedTaskForRoadblock(null)}
                className="px-4 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-all cursor-pointer"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={handleSubmitRoadblock}
                disabled={isSubmittingReason}
                className="px-5 py-2.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-black rounded-xl shadow-md transition-all active:scale-95 cursor-pointer flex items-center gap-1.5"
              >
                {isSubmittingReason ? (
                  <RefreshCw size={14} className="animate-spin" />
                ) : (
                  <Check size={14} className="stroke-[2.5]" />
                )}
                <span>บันทึกสถานะงาน</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
