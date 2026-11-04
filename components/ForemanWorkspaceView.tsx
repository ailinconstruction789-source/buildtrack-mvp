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
  type ForemanDailyTask,
  type ForemanDailySummary,
  type RoadblockReasonId,
} from '@/lib/foremanDuty';

interface ForemanWorkspaceViewProps {
  plots: any[];
  projects: any[];
  taskTemplates: any[];
  schedules: Record<string, any>;
  assignments?: any[];
  allUpdatesRecord?: any[];
  allUsers?: any[];
  foremenList?: any[];
  loggedInUser?: any;
  currentUserRole?: string;
  isAdmin?: boolean;
  isOwner?: boolean;
  isSiteEngineer?: boolean;
  isProjectPlanner?: boolean;
  isForeman?: boolean;
  onNavigateToTaskChat: (plot: any, task: any) => void;
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
  loggedInUser,
  currentUserRole = '',
  isAdmin = false,
  isOwner = false,
  isSiteEngineer = false,
  isProjectPlanner = false,
  isForeman = false,
  onNavigateToTaskChat,
  onSelectPlot,
  fetchAllData,
}: ForemanWorkspaceViewProps) {
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

  // Status tab filter: 'all' | 'pending' | 'updated' | 'roadblock'
  const [activeTab, setActiveTab] = useState<'all' | 'pending' | 'updated' | 'roadblock'>('all');

  // Search query
  const [searchQuery, setSearchQuery] = useState<string>('');

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

  // KPI Summary
  const summary: ForemanDailySummary = useMemo(() => {
    return computeForemanDailySummary(dailyTasks);
  }, [dailyTasks]);

  // Filtered tasks for display
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
  const isViewingFuture = selectedDate > todayStr;

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
              <span>ห้องทำงานโฟร์แมน • DAILY WORK DISPATCH</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white flex items-center gap-3">
              <span>งานประจำวันและการเข้าตรวจไซต์</span>
            </h1>
            <p className="text-slate-300 text-sm max-w-2xl leading-relaxed">
              ติดตามงานก่อสร้างตามแผนประจำวันของโฟร์แมน อัปเดตความคืบหน้าเข้าห้องแชท หรือแจ้งเหตุผลงานไม่เริ่ม
              พร้อมระบบแช่แข็งประวัติแผนงานย้อนหลัง (Point-in-Time Snapshot)
            </p>
          </div>

          {/* Quick Date Switcher in Header */}
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

      {/* 📜 Past Date Historical Snapshot Notice */}
      {isViewingPast && (
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
                ข้อมูลแผนงานและการตรวจงานจะถูกแช่แข็งตามสภาพจริง ณ วันดังกล่าว ไม่ถูกกระทบจากการขยายหรือเปลี่ยนแผนในอนาคต
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

      {/* ⚙️ Toolbar: Foreman Selector, Project Filter, Search & Snapshot Actions */}
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

        {/* Search & Freeze Snapshot */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1 sm:w-64">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="ค้นหาแปลง, ชื่องาน, ช่าง..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
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

      {/* 🏷️ Filter Tabs */}
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
