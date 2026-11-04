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
  type ForemanDailyTask,
  type ForemanDailySummary,
  type ForemanReworkItem,
  type RoadblockReasonId,
} from '@/lib/foremanDuty';
import ForemanInspectionCalendar from './ForemanInspectionCalendar';

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
}: ForemanWorkspaceViewProps) {
  // Main view mode: 'schedule' (งานตามแผน) or 'rework' (งานที่ต้องแก้ไข & Defect)
  const [mainTab, setMainTab] = useState<'schedule' | 'rework' | 'calendar'>('schedule');

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
  const [activeTab, setActiveTab] = useState<'all' | 'pending' | 'updated' | 'roadblock'>('all');

  // Rework filter: 'all' | 'defect' | 'task_rework'
  const [reworkFilter, setReworkFilter] = useState<'all' | 'defect' | 'task_rework'>('all');

  // Search queries
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [reworkSearch, setReworkSearch] = useState<string>('');

  // Snapshots loaded from database/cache
  const [snapshots, setSnapshots] = useState<any[]>([]);
  const [isLoadingSnapshots, setIsLoadingSnapshots] = useState<boolean>(false);
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'saved'>('saved');
  const lastAutoSaveSignatureRef = useRef<string>('');

  // Roadblock Reason Modal State
  const [selectedTaskForRoadblock, setSelectedTaskForRoadblock] = useState<ForemanDailyTask | null>(null);
  const [selectedReasonId, setSelectedReasonId] = useState<string>('material_issue');
  const [roadblockNote, setRoadblockNote] = useState<string>('');
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
    setIsLoadingSnapshots(true);
    try {
      const data = await loadForemanDailySnapshot(selectedDate, selectedForeman);
      setSnapshots(data || []);
    } catch (err) {
      console.warn('Error loading foreman daily snapshot:', err);
    } finally {
      setIsLoadingSnapshots(false);
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

  // Filtered daily tasks for display
  const filteredTasks = useMemo(() => {
    return dailyTasks.filter(t => {
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
    const currentSignature = `${selectedDate}::${selectedForeman}::${dailyTasks.length}::${summary.updatedTasks}::${summary.roadblockTasks}`;

    if (lastAutoSaveSignatureRef.current === currentSignature) return;

    // Auto-save is triggered for today's tasks or when viewing a past date that has no snapshot yet
    const shouldAutoSave = isViewingToday || (isViewingPast && snapshots.length === 0);
    if (!shouldAutoSave) return;

    const timer = setTimeout(async () => {
      setAutoSaveStatus('saving');
      try {
        await saveForemanDailySnapshot(
          dailyTasks,
          selectedDate,
          selectedForeman,
          loggedInUser?.username || loggedInUser?.name || 'AutoSync'
        );
        lastAutoSaveSignatureRef.current = currentSignature;
        setAutoSaveStatus('saved');
      } catch (err) {
        console.warn('Background auto-save notice:', err);
        setAutoSaveStatus('saved');
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
    isViewingPast,
    snapshots.length,
    loggedInUser,
  ]);

  // Submit Roadblock Reason
  const handleSubmitRoadblock = async () => {
    if (!selectedTaskForRoadblock) return;
    setIsSubmittingReason(true);
    try {
      const updatedBy = loggedInUser?.username || loggedInUser?.name || 'Foreman';
      await recordForemanTaskRoadblockReason(
        selectedTaskForRoadblock,
        selectedDate,
        selectedReasonId,
        roadblockNote,
        updatedBy
      );

      // Refresh snapshot data
      await loadSnapshotForCurrentView();
      if (fetchAllData) {
        fetchAllData().catch(() => {});
      }

      // Close modal
      setSelectedTaskForRoadblock(null);
      setRoadblockNote('');
    } catch (err) {
      console.error('Error submitting roadblock reason:', err);
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
            {dailyTasks.length}
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
          <span>งานที่ต้องแก้ไข & Defect</span>
          {reworkItems.length > 0 && (
            <span
              className={`px-2 py-0.5 rounded-full text-[11px] font-black animate-pulse ${
                mainTab === 'rework' ? 'bg-rose-800 text-rose-100' : 'bg-rose-100 text-rose-700'
              }`}
            >
              {reworkItems.length}
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
      {mainTab === 'schedule' && reworkItems.length > 0 && (
        <div className="bg-gradient-to-r from-rose-50 via-amber-50 to-rose-50 border border-rose-200/90 rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs animate-in slide-in-from-top-2">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-rose-500 text-white rounded-xl shadow-xs shrink-0">
              <Flame size={18} className="animate-bounce" />
            </div>
            <div>
              <p className="text-sm font-black text-rose-950 flex items-center gap-2">
                <span>มีงานที่ต้องแก้ไข & Defect ค้างอยู่ {reworkItems.length} รายการ</span>
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
            <span>ดูรายการงานแก้ไข ({reworkItems.length})</span>
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
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-black transition-all border shrink-0 bg-emerald-50 border-emerald-200/90 text-emerald-800 shadow-xs"
            title="ระบบแช่แข็งและบันทึกประวัติแผนงานประจำวันให้อัตโนมัติในเบื้องหลัง"
          >
            {autoSaveStatus === 'saving' ? (
              <>
                <RefreshCw size={13} className="animate-spin text-emerald-600" />
                <span>กำลังบันทึกอัตโนมัติ...</span>
              </>
            ) : (
              <>
                <CheckCircle2 size={13} className="stroke-[2.5] text-emerald-600" />
                <span>บันทึกประวัติอัตโนมัติแล้ว</span>
              </>
            )}
          </div>
        </div>
      </div>
      )}

      {/* ============================================================== */}
      {/* 📅 MODE 1: DAILY SCHEDULED TASKS (งานตามแผนประจำวัน) */}
      {/* ============================================================== */}
      {mainTab === 'schedule' && (
        <div className="space-y-6">
          {/* 📊 KPI Summary Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
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

            {/* Daily Compliance Gauge */}
            <div className="bg-gradient-to-br from-blue-600 to-indigo-700 rounded-2xl p-4 text-white shadow-md flex flex-col justify-between col-span-2 lg:col-span-1">
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
              ทั้งหมด ({dailyTasks.length})
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
          </div>

          {/* 📋 Task Cards List */}
          {filteredTasks.length === 0 ? (
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
                        {task.is_updated_today ? (
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
        </div>
      )}

      {/* ============================================================== */}
      {/* 🛠️ MODE 2: REWORKS & DEFECTS (งานที่ต้องแก้ไข & Defect ค้าง) */}
      {/* ============================================================== */}
      {mainTab === 'rework' && (
        <div className="space-y-6 animate-in fade-in duration-200">
          {/* Summary KPIs for Rework */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <div className="bg-white rounded-2xl p-4 border border-rose-200/80 shadow-xs flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-500">งานรอแก้ไขทั้งหมด</span>
                <div className="p-2 bg-rose-50 text-rose-600 rounded-xl">
                  <Wrench size={18} />
                </div>
              </div>
              <div className="mt-2">
                <div className="text-2xl font-black text-rose-600">{reworkItems.length}</div>
                <p className="text-[11px] text-slate-400 font-medium mt-0.5">Defect + งวดงานไม่ผ่าน</p>
              </div>
            </div>

            <div className="bg-white rounded-2xl p-4 border border-purple-200/80 shadow-xs flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-500">Defect ค้างตรวจ</span>
                <div className="p-2 bg-purple-50 text-purple-600 rounded-xl">
                  <ShieldAlert size={18} />
                </div>
              </div>
              <div className="mt-2">
                <div className="text-2xl font-black text-purple-600">
                  {reworkItems.filter(i => i.type === 'defect').length}
                </div>
                <p className="text-[11px] text-slate-400 font-medium mt-0.5">รายการตรวจ Defect</p>
              </div>
            </div>

            <div className="bg-white rounded-2xl p-4 border border-amber-200/80 shadow-xs flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-500">งวดงานโดนแจ้งแก้ไข</span>
                <div className="p-2 bg-amber-50 text-amber-600 rounded-xl">
                  <AlertTriangle size={18} />
                </div>
              </div>
              <div className="mt-2">
                <div className="text-2xl font-black text-amber-600">
                  {reworkItems.filter(i => i.type === 'task_rework').length}
                </div>
                <p className="text-[11px] text-slate-400 font-medium mt-0.5">QC สั่งแก้ในระบบ</p>
              </div>
            </div>

            <div className="bg-gradient-to-br from-rose-600 to-red-700 rounded-2xl p-4 text-white shadow-md flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-rose-100">รายการเร่งด่วน (High)</span>
                <Flame size={18} className="text-amber-300 animate-pulse" />
              </div>
              <div className="mt-2">
                <div className="text-3xl font-black tracking-tight">
                  {reworkItems.filter(i => i.severity === 'high').length}
                </div>
                <p className="text-[10px] text-rose-100 font-semibold mt-1">ต้องรีบประสานช่างด่วน</p>
              </div>
            </div>
          </div>

          {/* 🏷️ Filter Chips for Rework */}
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 pb-3">
            <button
              onClick={() => setReworkFilter('all')}
              className={`px-4 py-2 rounded-xl text-xs font-black transition-all cursor-pointer ${
                reworkFilter === 'all'
                  ? 'bg-rose-600 text-white shadow-sm'
                  : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
              }`}
            >
              ทั้งหมด ({reworkItems.length})
            </button>
            <button
              onClick={() => setReworkFilter('defect')}
              className={`px-4 py-2 rounded-xl text-xs font-black transition-all cursor-pointer ${
                reworkFilter === 'defect'
                  ? 'bg-purple-600 text-white shadow-sm'
                  : 'bg-white text-purple-700 hover:bg-purple-50 border border-purple-200'
              }`}
            >
              🛠️ Defects รายการตรวจแก้ ({reworkItems.filter(i => i.type === 'defect').length})
            </button>
            <button
              onClick={() => setReworkFilter('task_rework')}
              className={`px-4 py-2 rounded-xl text-xs font-black transition-all cursor-pointer ${
                reworkFilter === 'task_rework'
                  ? 'bg-amber-600 text-white shadow-sm'
                  : 'bg-white text-amber-700 hover:bg-amber-50 border border-amber-200'
              }`}
            >
              ⚠️ งวดงานที่โดนแจ้งแก้ไข ({reworkItems.filter(i => i.type === 'task_rework').length})
            </button>
          </div>

          {/* Rework Items List */}
          {filteredReworkItems.length === 0 ? (
            <div className="bg-white rounded-3xl p-12 text-center border border-slate-200/80 shadow-xs space-y-3">
              <div className="w-16 h-16 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center mx-auto">
                <CheckCircle2 size={32} />
              </div>
              <h3 className="text-lg font-black text-slate-800">ไม่มีงานที่ต้องแก้ไขในขณะนี้</h3>
              <p className="text-sm text-slate-500 max-w-md mx-auto">
                ยอดเยี่ยมมาก! ไม่มีรายการ Defect ค้าง หรือรายการงวดงานที่ถูกสั่งแก้ไขในแปลงที่คุณรับผิดชอบ
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {filteredReworkItems.map(item => (
                <div
                  key={item.id}
                  className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs hover:shadow-md transition-all flex flex-col justify-between group"
                >
                  <div>
                    {/* Header: Plot, Type & Severity */}
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="space-y-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="px-2.5 py-1 bg-blue-50 text-blue-700 font-black text-xs rounded-lg border border-blue-200">
                            {item.plot_name}
                          </span>
                          <span className="text-[11px] text-slate-400 font-bold">
                            {item.project_name}
                          </span>
                        </div>
                        {selectedForeman === 'all' && (
                          <p className="text-[11px] text-slate-500 font-semibold flex items-center gap-1">
                            <User size={12} className="text-slate-400" />
                            <span>โฟร์แมน: {item.foreman_name}</span>
                          </p>
                        )}
                      </div>

                      {/* Type Badge */}
                      <span
                        className={`px-2.5 py-1 text-[11px] font-black rounded-lg border flex items-center gap-1 shrink-0 ${
                          item.type === 'defect'
                            ? 'bg-purple-50 text-purple-700 border-purple-200'
                            : 'bg-amber-50 text-amber-800 border-amber-200'
                        }`}
                      >
                        {item.type === 'defect' ? <ShieldAlert size={12} /> : <AlertTriangle size={12} />}
                        <span>{item.type === 'defect' ? 'Defect' : 'งวดงานไม่ผ่าน'}</span>
                      </span>
                    </div>

                    {/* Title & Task */}
                    <div className="mb-3 space-y-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-black uppercase ${
                            item.severity === 'high'
                              ? 'bg-rose-100 text-rose-700'
                              : item.severity === 'low'
                              ? 'bg-blue-100 text-blue-700'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {item.severity === 'high' ? 'ด่วนมาก' : item.severity === 'low' ? 'ปกติ' : 'ปานกลาง'}
                        </span>
                        <span className="text-xs font-bold text-slate-500">{item.task_name}</span>
                      </div>

                      <h4 className="text-base font-black text-slate-900 group-hover:text-rose-600 transition-colors">
                        {item.title}
                      </h4>

                      {item.description && item.description !== item.title && (
                        <p className="text-xs text-slate-600 bg-slate-50 p-2.5 rounded-xl border border-slate-100 leading-relaxed font-medium">
                          {item.description}
                        </p>
                      )}
                    </div>

                    {/* Details: Reporter & Contractor */}
                    <div className="space-y-1 mb-3 text-xs text-slate-500 font-medium">
                      {item.reporter && (
                        <p className="flex items-center gap-1.5">
                          <User size={13} className="text-slate-400" />
                          <span>ผู้สั่งตรวจ/แจ้ง: <strong className="text-slate-700">{item.reporter}</strong></span>
                        </p>
                      )}
                      {item.contractor_name && (
                        <p className="flex items-center gap-1.5">
                          <HardHat size={13} className="text-slate-400" />
                          <span>ช่างรับผิดชอบ: <strong className="text-slate-700">{item.contractor_name}</strong></span>
                        </p>
                      )}
                      {item.created_at && (
                        <p className="flex items-center gap-1.5 text-[11px] text-slate-400">
                          <Clock size={12} />
                          <span>บันทึกเมื่อ: {new Date(item.created_at).toLocaleDateString('th-TH')}</span>
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Action Button */}
                  <div className="pt-3 border-t border-slate-100">
                    {item.type === 'defect' ? (
                      <button
                        onClick={() => handleOpenDefectChat(item)}
                        className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-black shadow-xs active:scale-95 transition-all cursor-pointer"
                        title="เข้าห้องแชท Defect เพื่อตรวจสอบและส่งงานแก้ไข"
                      >
                        <MessageSquare size={14} className="stroke-[2.5]" />
                        <span>เข้าห้องแชท Defect / ส่งงานแก้ไข</span>
                      </button>
                    ) : (
                      <button
                        onClick={() => handleOpenReworkTaskChat(item)}
                        className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-black shadow-xs active:scale-95 transition-all cursor-pointer"
                        title="เข้าห้องแชทงวดงานเพื่อดูข้อความสั่งแก้และอัปเดตงานใหม่"
                      >
                        <MessageSquare size={14} className="stroke-[2.5]" />
                        <span>เข้าห้องแชทงวดงาน / แก้ไขงาน</span>
                      </button>
                    )}
                  </div>
                </div>
              ))}
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
        />
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
                onClick={() => setSelectedTaskForRoadblock(null)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 transition-all cursor-pointer"
              >
                <X size={20} />
              </button>
            </div>

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
