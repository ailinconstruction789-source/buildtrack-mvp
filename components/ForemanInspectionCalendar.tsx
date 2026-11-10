'use client';

import React, { useState, useMemo, useEffect } from 'react';
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  User,
  Sparkles,
  ArrowRight,
  X,
  ExternalLink,
  Loader2,
  RotateCw,
  Activity,
  Briefcase,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Search,
  Building2,
  Home,
  CheckSquare,
  ListFilter,
  Layers,
} from 'lucide-react';
import {
  getMonthlyForemanInspectionCompliance,
  getPlotForemanName,
  loadForemanMonthlySnapshots,
  getRoadblockReason,
  type MonthInspectionSummary,
  type DayInspectionCompliance,
  type MonthForemanWorkloadStat,
  type ForemanDailyTask,
} from '@/lib/foremanDuty';

interface ForemanInspectionCalendarProps {
  plots: any[];
  taskTemplates: any[];
  schedules: Record<string, any>;
  assignments?: any[];
  allUpdatesRecord?: any[];
  foremenList?: any[];
  selectedForeman?: string;
  onSelectForeman?: (foreman: string) => void;
  onSelectDate?: (dateStr: string) => void;
  onViewDayActivity?: (dateStr: string) => void;
  snapshots?: any[];
  title?: string;
  compact?: boolean;
  isLoading?: boolean;
  projectName?: string;
}

const EMPTY_SNAPSHOTS: any[] = [];

const WEEKDAY_NAMES = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];

export default function ForemanInspectionCalendar({
  plots = [],
  taskTemplates = [],
  schedules = {},
  assignments = [],
  allUpdatesRecord = [],
  foremenList = [],
  selectedForeman: propForeman,
  onSelectForeman,
  onSelectDate,
  onViewDayActivity,
  snapshots = EMPTY_SNAPSHOTS,
  projectName,
  title = 'ปฏิทินตรวจสอบการเข้างานของโฟร์แมน (Owner Audit Calendar)',
  compact: _compact = false,
  isLoading: propIsLoading = false,
}: ForemanInspectionCalendarProps) {
  const now = useMemo(() => new Date(), []);
  const todayStr = useMemo(() => {
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }, [now]);

  // Year & Month state
  const [currentYear, setCurrentYear] = useState<number>(now.getFullYear());
  const [currentMonth, setCurrentMonth] = useState<number>(now.getMonth() + 1); // 1-12

  // Internal foreman filter
  const [internalForeman, setInternalForeman] = useState<string>(propForeman || 'all');
  const activeForeman = propForeman !== undefined ? propForeman : internalForeman;

  const handleForemanChange = (fm: string) => {
    setInternalForeman(fm);
    if (onSelectForeman) onSelectForeman(fm);
  };

  // Selected Day Modal for Drill-down
  const [selectedDayDetail, setSelectedDayDetail] = useState<DayInspectionCompliance | null>(null);
  const [selectedDayForeman, setSelectedDayForeman] = useState<string>('all');
  const [dayTaskSearch, setDayTaskSearch] = useState<string>('');
  const [dayTaskStatusFilter, setDayTaskStatusFilter] = useState<'all' | 'updated' | 'roadblock' | 'pending' | 'completed_early'>('all');

  const handleOpenDayDetail = (day: DayInspectionCompliance) => {
    setSelectedDayForeman('all');
    setDayTaskSearch('');
    setDayTaskStatusFilter('all');
    setSelectedDayDetail(day);
  };

  // Loaded monthly snapshots and fetch state
  const [monthlySnapshots, setMonthlySnapshots] = useState<any[]>(snapshots || []);
  const [isLoadingSnapshots, setIsLoadingSnapshots] = useState<boolean>(true);
  const [refreshKey, setRefreshKey] = useState<number>(0);

  const snapshotsRef = React.useRef(snapshots);
  snapshotsRef.current = snapshots;
  const snapshotsFingerprint = useMemo(() => {
    if (!snapshots || snapshots.length === 0) return '0';
    return `${snapshots.length}:` + snapshots.map(s =>
      `${s.id || ''}_${s.snapshot_date || ''}_${s.plot_id || ''}_${s.task_template_id || ''}_${s.planned_start || ''}_${s.planned_end || ''}_${s.is_updated_today ? 1 : 0}_${s.status_reason || ''}_${s.status_note || ''}_${s.current_progress || 0}`
    ).join(';');
  }, [snapshots]);

  const plotsFingerprint = useMemo(() => {
    if (!plots || plots.length === 0) return '0';
    return plots.map(p => `${p.id}:${getPlotForemanName(p) || ''}`).join('|');
  }, [plots]);

  const activeRequestRef = React.useRef<{ year: number; month: number; foreman: string; project: string }>({
    year: 0,
    month: 0,
    foreman: '',
    project: ''
  });

  // Fetch monthly snapshots whenever month, year, foreman, or refresh is triggered
  useEffect(() => {
    let isCancelled = false;
    const reqYear = currentYear;
    const reqMonth = currentMonth;
    const reqForeman = activeForeman;
    const reqProject = projectName || 'all';
    activeRequestRef.current = { year: reqYear, month: reqMonth, foreman: reqForeman, project: reqProject };

    setIsLoadingSnapshots(true);

    const relevantPlotIds = reqForeman && reqForeman !== 'all'
      ? (plots || []).filter(p => (getPlotForemanName(p) || '').toLowerCase() === reqForeman.toLowerCase()).map(p => p.id)
      : [];

    loadForemanMonthlySnapshots(reqYear, reqMonth, reqForeman, projectName, undefined, { plotIds: relevantPlotIds })
      .then(snaps => {
        if (!isCancelled) {
          if (
            activeRequestRef.current.year !== reqYear ||
            activeRequestRef.current.month !== reqMonth ||
            activeRequestRef.current.foreman !== reqForeman ||
            activeRequestRef.current.project !== reqProject
          ) {
            return;
          }
          const currentPropsSnapshots = snapshotsRef.current || [];
          const merged = [...currentPropsSnapshots, ...(snaps || [])];
          const uniqueMap = new Map();
          merged.forEach(s => {
            const k = s.id ? `id_${s.id}` : `${s.snapshot_date}_${s.plot_id}_${s.foreman_name}`;
            uniqueMap.set(k, s);
          });
          setMonthlySnapshots(Array.from(uniqueMap.values()));
        }
      })
      .catch(err => {
        console.warn('Error loading monthly snapshots:', err);
      })
      .finally(() => {
        if (!isCancelled) {
          if (
            activeRequestRef.current.year === reqYear &&
            activeRequestRef.current.month === reqMonth &&
            activeRequestRef.current.foreman === reqForeman &&
            activeRequestRef.current.project === reqProject
          ) {
            setIsLoadingSnapshots(false);
          }
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [currentYear, currentMonth, activeForeman, projectName, snapshotsFingerprint, plotsFingerprint, refreshKey]);

  const handleManualRefresh = () => {
    setRefreshKey(k => k + 1);
  };

  // Overall loading flag (true if fetching snapshots or parent data is not yet available)
  const isDataLoading = propIsLoading || isLoadingSnapshots || plots.length === 0;

  // Available foremen list
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

  const targetProject = projectName && projectName !== 'all' ? projectName.trim() : null;

  // Filter plots by project
  const scopedPlots = useMemo(() => {
    if (!targetProject) return plots;
    return (plots || []).filter(p => p.project_name === targetProject);
  }, [plots, targetProject]);

  const scopedPlotIds = useMemo(() => {
    if (!targetProject) return null;
    return new Set(scopedPlots.map(p => String(p.id)));
  }, [scopedPlots, targetProject]);

  // Filter schedules by scoped plots (Finding H: support hyphenated plot IDs such as A-01)
  const scopedSchedules = useMemo(() => {
    if (!scopedPlotIds || !schedules) return schedules;
    const res: Record<string, any> = {};
    Object.keys(schedules).forEach(k => {
      const scheduleItem = schedules[k];
      if (scheduleItem?.plot_id && scopedPlotIds.has(String(scheduleItem.plot_id))) {
        res[k] = scheduleItem;
        return;
      }
      for (const pid of scopedPlotIds) {
        if (k === pid || k.startsWith(`${pid}-`) || k.startsWith(`${pid}_`)) {
          res[k] = scheduleItem;
          return;
        }
      }
    });
    return res;
  }, [schedules, scopedPlotIds]);

  // Filter updates by scoped plots
  const scopedUpdates = useMemo(() => {
    if (!scopedPlotIds) return allUpdatesRecord;
    return (allUpdatesRecord || []).filter(u => scopedPlotIds.has(String(u.plot_id)));
  }, [allUpdatesRecord, scopedPlotIds]);

  // Filter monthly snapshots by project (Issue 7: merge live snapshots into monthlySnapshots by identity)
  const scopedMonthlySnapshots = useMemo(() => {
    const map = new Map<string, any>();
    (monthlySnapshots || []).forEach(s => {
      const k = s.id ? `id_${s.id}` : `${s.snapshot_date}_${s.plot_id}_${s.task_template_id}`;
      map.set(k, s);
    });
    (snapshots || []).forEach(s => {
      const k = s.id ? `id_${s.id}` : `${s.snapshot_date}_${s.plot_id}_${s.task_template_id}`;
      map.set(k, s);
    });
    const merged = Array.from(map.values());
    if (!targetProject) return merged;
    return merged.filter(s => {
      if (s.project_name === targetProject) return true;
      if (scopedPlotIds && scopedPlotIds.has(String(s.plot_id))) return true;
      return false;
    });
  }, [snapshots, monthlySnapshots, targetProject, scopedPlotIds]);

  // Compute monthly data
  const monthlyData: MonthInspectionSummary = useMemo(() => {
    return getMonthlyForemanInspectionCompliance({
      year: currentYear,
      month: currentMonth,
      plots: scopedPlots,
      taskTemplates,
      schedules: scopedSchedules,
      assignments,
      allUpdatesRecord: scopedUpdates,
      foremanName: activeForeman,
      projectName,
      existingSnapshots: scopedMonthlySnapshots,
      todayDateStr: todayStr,
    });
  }, [
    currentYear,
    currentMonth,
    scopedPlots,
    taskTemplates,
    scopedSchedules,
    assignments,
    scopedUpdates,
    activeForeman,
    projectName,
    scopedMonthlySnapshots,
    todayStr,
  ]);

  // Month navigation
  const handlePrevMonth = () => {
    if (currentMonth === 1) {
      setCurrentMonth(12);
      setCurrentYear(prev => prev - 1);
    } else {
      setCurrentMonth(prev => prev - 1);
    }
  };

  const handleNextMonth = () => {
    if (currentMonth === 12) {
      setCurrentMonth(1);
      setCurrentYear(prev => prev + 1);
    } else {
      setCurrentMonth(prev => prev + 1);
    }
  };

  const handleResetToCurrentMonth = () => {
    setCurrentYear(now.getFullYear());
    setCurrentMonth(now.getMonth() + 1);
  };

  // Tasks for selected day detail drill-down
  const dayTasks: ForemanDailyTask[] = selectedDayDetail?.tasks || [];

  const filteredDayTasks = useMemo(() => {
    return dayTasks.filter(task => {
      // Foreman filter
      if (selectedDayForeman !== 'all') {
        const fm = task.foreman_name || 'ยังไม่ระบุ';
        if (fm.toLowerCase() !== selectedDayForeman.toLowerCase()) return false;
      }

      // Status filter
      if (dayTaskStatusFilter === 'updated' && (!task.is_updated_today || Boolean(task.status_reason) || task.is_completed_early)) {
        return false;
      }
      if (dayTaskStatusFilter === 'roadblock' && !task.status_reason) {
        return false;
      }
      if (dayTaskStatusFilter === 'pending' && (task.is_updated_today || Boolean(task.status_reason) || task.is_completed_early)) {
        return false;
      }
      if (dayTaskStatusFilter === 'completed_early' && !task.is_completed_early) {
        return false;
      }

      // Search query
      if (dayTaskSearch.trim()) {
        const q = dayTaskSearch.toLowerCase().trim();
        const mTask = (task.task_name || '').toLowerCase().includes(q);
        const mPlot = (task.plot_name || '').toLowerCase().includes(q);
        const mProj = (task.project_name || '').toLowerCase().includes(q);
        const mContractor = (task.contractor_name || '').toLowerCase().includes(q);
        if (!mTask && !mPlot && !mProj && !mContractor) return false;
      }

      return true;
    });
  }, [dayTasks, selectedDayForeman, dayTaskStatusFilter, dayTaskSearch]);

  // First day padding in the calendar (0 = Sun, 1 = Mon...)
  const firstDayOfWeek = useMemo(() => {
    return new Date(currentYear, currentMonth - 1, 1).getDay();
  }, [currentYear, currentMonth]);

  return (
    <div className="bg-white rounded-3xl p-5 sm:p-7 border border-slate-200/80 shadow-sm space-y-6 animate-in fade-in duration-200">
      {/* Top Header: Title, Month Navigation, Foreman Selector & Refresh */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-100">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-amber-50 text-amber-800 rounded-full text-xs font-black border border-amber-200/80">
            <Calendar size={13} className="text-amber-600" />
            <span>OWNER AUDIT • ปฏิทินตรวจงานรายเดือน</span>
          </div>
          <h3 className="text-xl sm:text-2xl font-black text-slate-900 flex items-center gap-2">
            <span>{title}</span>
          </h3>
          <p className="text-xs text-slate-500 font-medium">
            ภาพรวมความสม่ำเสมอในการเข้าตรวจไซต์และอัปเดตงานของโฟร์แมนตลอดทั้งเดือน
          </p>
        </div>

        {/* Toolbar: Stepper & Foreman Selector & Manual Refresh */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Foreman Selector */}
          <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5">
            <User size={13} className="text-blue-600" />
            <select
              value={activeForeman}
              onChange={e => handleForemanChange(e.target.value)}
              className="bg-transparent text-xs font-bold text-slate-800 focus:outline-none cursor-pointer"
            >
              <option value="all">👷 โฟร์แมนทุกคน (รวมทุกไซต์)</option>
              {availableForemen.map(fm => (
                <option key={fm} value={fm}>
                  👷 โฟร์แมน: {fm}
                </option>
              ))}
            </select>
          </div>

          {/* Month Stepper */}
          <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-xl p-1">
            <button
              onClick={handlePrevMonth}
              className="p-1.5 hover:bg-white text-slate-600 hover:text-slate-900 rounded-lg transition-all cursor-pointer active:scale-95"
              title="เดือนก่อนหน้า"
            >
              <ChevronLeft size={16} />
            </button>

            <span className="px-3 text-xs font-black text-slate-800 whitespace-nowrap">
              {monthlyData.monthLabel}
            </span>

            <button
              onClick={handleNextMonth}
              className="p-1.5 hover:bg-white text-slate-600 hover:text-slate-900 rounded-lg transition-all cursor-pointer active:scale-95"
              title="เดือนถัดไป"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          {/* Reset to Today / Current Month */}
          {(currentYear !== now.getFullYear() || currentMonth !== now.getMonth() + 1) && (
            <button
              onClick={handleResetToCurrentMonth}
              className="px-3 py-1.5 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-xl text-xs font-bold transition-all cursor-pointer"
            >
              เดือนนี้
            </button>
          )}

          {/* Manual Refresh Button */}
          <button
            onClick={handleManualRefresh}
            className="p-2 hover:bg-slate-100 text-slate-500 hover:text-slate-800 rounded-xl border border-slate-200 transition-all cursor-pointer active:scale-95"
            title="รีเฟรชข้อมูลปฏิทิน"
          >
            <RotateCw size={14} className={isLoadingSnapshots ? 'animate-spin text-blue-600' : ''} />
          </button>
        </div>
      </div>

      {/* ⏳ Loading Status Notification (เพื่อความชัดเจน ไม่ให้ Owner สับสนว่าไม่ได้ทำ) */}
      {isDataLoading && (
        <div className="flex items-center justify-between gap-3 p-3.5 bg-blue-50/90 border border-blue-200/90 rounded-2xl text-blue-900 shadow-xs animate-in fade-in duration-200">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-600 text-white rounded-xl shadow-xs shrink-0">
              <Loader2 size={16} className="animate-spin" />
            </div>
            <div>
              <p className="text-xs sm:text-sm font-black flex items-center gap-2 text-blue-950">
                <span>กำลังเรียกข้อมูลและประมวลผลการเข้าตรวจงาน...</span>
                <span className="inline-block w-2 h-2 rounded-full bg-blue-600 animate-ping" />
              </p>
              <p className="text-[11px] text-blue-700 font-medium">
                ระบบกำลังเชื่อมต่อดึงประวัติการอัปเดตงานและบันทึกประวัติย้อนหลัง กรุณารอสักครู่
              </p>
            </div>
          </div>
          <span className="text-[11px] font-bold text-blue-700 bg-white px-2.5 py-1 rounded-xl border border-blue-200 shrink-0 hidden sm:inline-block shadow-2xs">
            กำลังโหลดข้อมูล...
          </span>
        </div>
      )}

      {/* 📊 Monthly Summary Scorecards */}
      <div className={`grid grid-cols-2 lg:grid-cols-5 gap-3 transition-opacity duration-300 ${isDataLoading ? 'opacity-85' : 'opacity-100'}`}>
        {/* Average Compliance Rate */}
        <div className="bg-gradient-to-br from-blue-600 to-indigo-700 rounded-2xl p-4 text-white shadow-md flex flex-col justify-between col-span-2 lg:col-span-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-blue-100">ตรวจงานเฉลี่ยเดือนนี้</span>
            <Sparkles size={16} className="text-amber-300" />
          </div>
          <div className="mt-2">
            <div className="text-3xl font-black">{monthlyData.avgComplianceRate}%</div>
            <p className="text-[10px] text-blue-100 font-semibold mt-1">
              จาก {monthlyData.totalWorkDays} วันที่มีแผนงาน
            </p>
          </div>
        </div>

        {/* Complete Days (Green) */}
        <div className="bg-emerald-50/70 border border-emerald-200/90 rounded-2xl p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black text-emerald-800">วันที่ตรวจครบ 100%</span>
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
          </div>
          <div className="mt-2">
            <div className="text-2xl font-black text-emerald-700">{monthlyData.completeDays} วัน</div>
            <p className="text-[10px] text-emerald-600 font-semibold mt-0.5">อัปเดตครบทุกรายการ</p>
          </div>
        </div>

        {/* Partial Days (Yellow/Amber) */}
        <div className="bg-amber-50/70 border border-amber-200/90 rounded-2xl p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black text-amber-800">วันที่ตรวจไม่ครบ</span>
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
          </div>
          <div className="mt-2">
            <div className="text-2xl font-black text-amber-700">{monthlyData.partialDays} วัน</div>
            <p className="text-[10px] text-amber-600 font-semibold mt-0.5">มีงานค้างบางรายการ</p>
          </div>
        </div>

        {/* Missed Days (Red) */}
        <div className="bg-rose-50/70 border border-rose-200/90 rounded-2xl p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black text-rose-800">ตรวจน้อย / ไม่อัปเดต</span>
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
          </div>
          <div className="mt-2">
            <div className="text-2xl font-black text-rose-700">{monthlyData.missedDays} วัน</div>
            <p className="text-[10px] text-rose-600 font-semibold mt-0.5">ต่ำกว่า 40% ของแผน</p>
          </div>
        </div>

        {/* Total Working Days */}
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black text-slate-600">วันที่มีแผนงาน</span>
            <Calendar size={16} className="text-slate-400" />
          </div>
          <div className="mt-2">
            <div className="text-2xl font-black text-slate-800">{monthlyData.totalWorkDays} วัน</div>
            <p className="text-[10px] text-slate-500 font-medium mt-0.5">ไม่นับวันหยุด/ไม่มีแผน</p>
          </div>
        </div>
      </div>

      {/* 📊 สรุปภาพรวมภาระงานของโฟร์แมนประจำเดือน (Monthly Foreman Workload Distribution) */}
      <div className={`bg-white rounded-3xl p-5 sm:p-6 border border-slate-200/90 shadow-xs space-y-4 transition-opacity duration-300 ${isDataLoading ? 'opacity-85' : 'opacity-100'}`}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-blue-50 text-blue-600 rounded-lg">
                <Briefcase size={16} />
              </div>
              <h3 className="text-sm sm:text-base font-black text-slate-900">
                สรุปภาระงานโฟร์แมนประจำเดือน {monthlyData.monthLabel}
              </h3>
            </div>
            <p className="text-xs text-slate-500 font-medium">
              ยอดงานตามแผนในเดือนนี้รวมทั้งสิ้น <span className="font-bold text-slate-900">{monthlyData.totalMonthTasks} งาน</span> (ตรวจคืบหน้า {monthlyData.totalMonthUpdated} งาน, แจ้งติดปัญหา {monthlyData.totalMonthRoadblocks} งาน, ค้าง {monthlyData.totalMonthPending} งาน)
            </p>
          </div>
          {monthlyData.foremanWorkloadStats && monthlyData.foremanWorkloadStats.length > 0 && (
            <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-600 shrink-0">
              <span>โฟร์แมนที่ได้รับมอบหมาย:</span>
              <span className="font-black text-blue-600 px-2 py-0.5 bg-blue-100 text-blue-800 rounded-md">
                {monthlyData.foremanWorkloadStats.length} คน
              </span>
            </div>
          )}
        </div>

        {!monthlyData.foremanWorkloadStats || monthlyData.foremanWorkloadStats.length === 0 ? (
          <div className="py-6 text-center text-xs text-slate-400 italic">
            ไม่มีข้อมูลแผนงานที่บันทึกไว้ในเดือนนี้
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3.5">
            {monthlyData.foremanWorkloadStats.map(st => {
              const isSelected = activeForeman && activeForeman.toLowerCase() === st.foremanName.toLowerCase();
              return (
                <div
                  key={st.foremanName}
                  onClick={() => handleForemanChange(isSelected ? 'all' : st.foremanName)}
                  className={`p-4 rounded-2xl border transition-all flex flex-col justify-between space-y-3 cursor-pointer group ${
                    isSelected
                      ? 'bg-blue-50/70 border-blue-400 shadow-md ring-2 ring-blue-500/20'
                      : 'bg-slate-50/50 hover:bg-slate-50 border-slate-200/80 hover:border-slate-300 hover:shadow-xs'
                  }`}
                  title={isSelected ? 'คลิกเพื่อยกเลิกการกรอง (ดูโฟร์แมนทุกคน)' : `คลิกเพื่อกรองเฉพาะโฟร์แมน ${st.foremanName}`}
                >
                  {/* Card Header: Foreman Name & Share Badge */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-8 h-8 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center font-black text-xs shrink-0 group-hover:bg-blue-600 group-hover:text-white transition-colors">
                        <User size={15} />
                      </div>
                      <div className="min-w-0">
                        <h4 className="text-xs font-black text-slate-900 truncate">
                          โฟร์แมน: {st.foremanName}
                        </h4>
                        <p className="text-[10px] text-slate-500 font-medium truncate">
                          {st.plotsCount} แปลง {st.projectNames.length > 0 ? `(${st.projectNames.join(', ')})` : ''}
                        </p>
                      </div>
                    </div>
                    <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 border border-indigo-200 text-[10px] font-black rounded-lg shrink-0" title="สัดส่วนภาระงานที่ได้รับมอบหมายในเดือนนี้">
                      {st.sharePercentage}% ของเดือน
                    </span>
                  </div>

                  {/* Tasks Count & Rate */}
                  <div className="flex items-baseline justify-between pt-1">
                    <div>
                      <span className="text-2xl font-black text-slate-900">{st.totalTasks}</span>
                      <span className="text-[11px] text-slate-500 font-semibold ml-1">งานในเดือนนี้</span>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded-lg text-xs font-black ${
                        st.complianceRate >= 100
                          ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                          : st.complianceRate >= 40
                          ? 'bg-amber-100 text-amber-800 border border-amber-200'
                          : 'bg-rose-100 text-rose-800 border border-rose-200'
                      }`}
                      title="อัตราการเข้าตรวจงานสะสมทั้งเดือน"
                    >
                      {st.complianceRate}%
                    </span>
                  </div>

                  {/* Progress bar */}
                  <div className="w-full bg-slate-200 rounded-full h-1.5 overflow-hidden">
                    <div
                      className={`h-1.5 rounded-full transition-all ${
                        st.complianceRate >= 100 ? 'bg-emerald-500' : st.complianceRate >= 40 ? 'bg-blue-600' : 'bg-rose-500'
                      }`}
                      style={{ width: `${Math.min(100, st.complianceRate)}%` }}
                    />
                  </div>

                  {/* Sub-breakdown */}
                  <div className="grid grid-cols-3 gap-1 pt-1 text-center text-[10px] font-bold border-t border-slate-200/60">
                    <div className="bg-emerald-50/80 p-1.5 rounded-xl text-emerald-700" title="รายงานความคืบหน้า">
                      <span className="block text-[9px] font-medium text-emerald-600">คืบหน้า</span>
                      {st.updatedTasks}
                    </div>
                    <div className="bg-amber-50/80 p-1.5 rounded-xl text-amber-700" title="แจ้งติดปัญหา">
                      <span className="block text-[9px] font-medium text-amber-600">ติดปัญหา</span>
                      {st.roadblockTasks}
                    </div>
                    <div className="bg-rose-50/80 p-1.5 rounded-xl text-rose-700" title="ยังไม่อัปเดต">
                      <span className="block text-[9px] font-medium text-rose-600">ค้าง</span>
                      {st.pendingTasks}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 📅 Monthly Calendar Grid */}
      <div className="space-y-2">
        {/* Day of Week Header */}
        <div className="grid grid-cols-7 gap-1.5 sm:gap-2 text-center text-xs font-black text-slate-400 uppercase py-1">
          {WEEKDAY_NAMES.map((name, i) => (
            <div key={name} className={i === 0 || i === 6 ? 'text-rose-400 font-bold' : ''}>
              {name}
            </div>
          ))}
        </div>

        {/* Calendar Day Cells */}
        <div className={`grid grid-cols-7 gap-1.5 sm:gap-2 transition-opacity duration-300 ${isDataLoading ? 'opacity-85' : 'opacity-100'}`}>
          {/* Empty prefix padding for days before month start */}
          {Array.from({ length: firstDayOfWeek }).map((_, idx) => (
            <div key={`empty-prefix-${idx}`} className="min-h-[75px] sm:min-h-[90px] rounded-2xl bg-slate-50/40 border border-dashed border-slate-100" />
          ))}

          {/* Days of the month */}
          {monthlyData.days.map(day => {
            const isClickable = day.totalScheduled > 0 || day.isToday;

            // Determine cell styling
            let cellBg = 'bg-slate-50/70 border-slate-200/80 text-slate-600';
            let badgeBg = 'bg-slate-100 text-slate-500';
            let statusText = 'ไม่มีแผน';

            if (day.isFuture) {
              cellBg = 'bg-slate-50/40 border-slate-200/50 text-slate-400';
              badgeBg = 'bg-slate-100 text-slate-400';
              statusText = day.totalScheduled > 0 ? `${day.totalScheduled} งาน` : 'ไม่มีแผน';
            } else if (day.status === 'complete') {
              cellBg = 'bg-emerald-50/90 border-emerald-300 text-emerald-950 hover:bg-emerald-100/90 shadow-xs';
              badgeBg = 'bg-emerald-600 text-white';
              statusText = `ครบ 100%`;
            } else if (day.status === 'partial') {
              cellBg = 'bg-amber-50/90 border-amber-300 text-amber-950 hover:bg-amber-100/90 shadow-xs';
              badgeBg = 'bg-amber-500 text-white';
              statusText = `${day.complianceRate}%`;
            } else if (day.status === 'missed') {
              cellBg = 'bg-rose-50/90 border-rose-300 text-rose-950 hover:bg-rose-100/90 shadow-xs';
              badgeBg = 'bg-rose-600 text-white';
              statusText = day.totalScheduled > 0 ? `ค้าง ${day.pending}` : 'ไม่อัปเดต';
            }

            return (
              <div
                key={day.date}
                onClick={() => {
                  handleOpenDayDetail(day);
                }}
                className={`min-h-[75px] sm:min-h-[95px] p-2 sm:p-2.5 rounded-2xl border transition-all flex flex-col justify-between relative group ${
                  isClickable ? 'cursor-pointer hover:shadow-md' : 'cursor-default'
                } ${cellBg} ${day.isToday ? 'ring-2 ring-blue-500 shadow-md' : ''}`}
                title={`คลิกดูรายละเอียดวันที่ ${day.date}`}
              >
                {/* Cell Header: Day number + Today indicator */}
                <div className="flex items-center justify-between">
                  <span className={`text-xs sm:text-sm font-black ${day.isToday ? 'text-blue-600' : ''}`}>
                    {day.dayNumber}
                  </span>

                  {day.isToday && (
                    <span className="px-1.5 py-0.2 bg-blue-600 text-white text-[9px] font-black rounded-md">
                      วันนี้
                    </span>
                  )}
                </div>

                {/* Cell Body: Status Pill & Stats */}
                <div className="mt-1 space-y-1">
                  {day.totalScheduled > 0 ? (
                    <>
                      <div className="flex items-center justify-between gap-1">
                        <span className={`text-[9px] sm:text-[10px] font-black px-1.5 py-0.5 rounded-md truncate ${badgeBg}`}>
                          {statusText}
                        </span>
                      </div>
                      <p className="text-[9px] sm:text-[10px] font-semibold opacity-80 truncate hidden sm:block">
                        {day.updated + day.roadblock}/{day.totalScheduled} งาน
                      </p>
                    </>
                  ) : (
                    <p className="text-[9px] font-normal text-slate-400 truncate hidden sm:block">
                      {day.isFuture ? 'ยังไม่ถึง' : '-'}
                    </p>
                  )}
                </div>

                {/* Hover indicator arrow */}
                <div className="absolute right-1.5 bottom-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <ExternalLink size={12} className="text-slate-400" />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 🏷️ Legend */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-100 text-xs">
        <div className="flex flex-wrap items-center gap-3 font-bold text-slate-600">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-md bg-emerald-500 border border-emerald-600" />
            <span>ตรวจครบ 100%</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-md bg-amber-500 border border-amber-600" />
            <span>ตรวจไม่ครบ (มีงานค้าง)</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-md bg-rose-500 border border-rose-600" />
            <span>ตรวจน้อย / ไม่อัปเดต</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-md bg-slate-200 border border-slate-300" />
            <span>ไม่มีแผนงาน / อนาคต</span>
          </span>
        </div>

        <p className="text-[11px] text-slate-400 font-medium">
          💡 คลิกที่กล่องวันที่เพื่อดูสรุปรายแปลงหรือเจาะลึกงานวันนั้น
        </p>
      </div>

      {/* 🔍 Day Detail Drill-Down Modal */}
      {selectedDayDetail && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-3 sm:p-4 pb-6 sm:pb-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-2xl sm:max-w-3xl w-full p-5 sm:p-6 shadow-2xl border border-slate-200 my-auto flex flex-col max-h-[90vh] sm:max-h-[88vh] animate-in zoom-in-95 duration-200">
            {/* Modal Header (Fixed at top) */}
            <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-100 shrink-0">
              <div className="space-y-1">
                <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 bg-blue-50 text-blue-700 rounded-lg text-xs font-black border border-blue-200">
                  <Calendar size={13} />
                  <span>บันทึกการเข้าตรวจงานประจำวัน</span>
                </div>
                <h3 className="text-base sm:text-lg font-black text-slate-900">
                  วันที่ {selectedDayDetail.date}
                </h3>
                <p className="text-xs text-slate-500 font-medium">
                  {selectedDayDetail.isToday
                    ? 'วันนี้'
                    : selectedDayDetail.isFuture
                    ? 'วันตามแผนในอนาคต'
                    : 'ประวัติการตรวจงานที่ผ่านมา'}
                </p>
              </div>
              <button
                onClick={() => setSelectedDayDetail(null)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 transition-all cursor-pointer shrink-0"
              >
                <X size={20} />
              </button>
            </div>

            {/* Scrollable Body */}
            <div className="overflow-y-auto custom-scrollbar pr-1 py-3 space-y-4 flex-1">
              {/* Day Stats Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                  <p className="text-[10px] text-slate-500 font-bold">แผนงาน</p>
                  <p className="text-lg font-black text-slate-800">{selectedDayDetail.totalScheduled}</p>
                </div>
                <div className="bg-emerald-50 p-2.5 rounded-xl border border-emerald-200">
                  <p className="text-[10px] text-emerald-700 font-bold">รายงานความคืบหน้า</p>
                  <p className="text-lg font-black text-emerald-700">{selectedDayDetail.updated}</p>
                </div>
                <div className="bg-amber-50 p-2.5 rounded-xl border border-amber-200">
                  <p className="text-[10px] text-amber-700 font-bold">ติดปัญหา</p>
                  <p className="text-lg font-black text-amber-700">{selectedDayDetail.roadblock}</p>
                </div>
                <div className="bg-rose-50 p-2.5 rounded-xl border border-rose-200">
                  <p className="text-[10px] text-rose-700 font-bold">ยังไม่อัปเดต</p>
                  <p className="text-lg font-black text-rose-700">{selectedDayDetail.pending}</p>
                </div>
              </div>

              {/* Breakdown by Foreman on this date */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-black text-slate-700 uppercase tracking-wider">
                    ผลการตรวจงานแยกตามโฟร์แมนในวันนี้:
                  </p>
                  <span className="text-[10px] text-slate-400 font-medium">
                    คลิกเพื่อกรองดูรายการงานเฉพาะโฟร์แมน
                  </span>
                </div>

                {Object.keys(selectedDayDetail.foremanStats).length === 0 ? (
                  <p className="text-xs text-slate-400 italic py-2">ไม่มีงานตามแผนในวันนี้</p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {/* All foremen toggle pill */}
                    <div
                      onClick={() => setSelectedDayForeman('all')}
                      className={`p-2.5 rounded-xl border transition-all flex items-center justify-between gap-2 text-xs cursor-pointer ${
                        selectedDayForeman === 'all'
                          ? 'bg-blue-600 text-white border-blue-600 shadow-xs ring-2 ring-blue-300'
                          : 'bg-slate-50 hover:bg-slate-100/80 border-slate-200 text-slate-700'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <div className={`p-1 rounded-lg ${selectedDayForeman === 'all' ? 'bg-blue-500 text-white' : 'bg-slate-200 text-slate-600'}`}>
                          <Layers size={13} />
                        </div>
                        <span className="font-black">โฟร์แมนทุกคน (รวมทุกไซต์)</span>
                      </div>
                      <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-md ${selectedDayForeman === 'all' ? 'bg-blue-700 text-white' : 'bg-slate-200 text-slate-600'}`}>
                        {selectedDayDetail.totalScheduled} งาน
                      </span>
                    </div>

                    {Object.entries(selectedDayDetail.foremanStats).map(([fmName, st]) => {
                      const isFmActive = selectedDayForeman.toLowerCase() === fmName.toLowerCase();
                      return (
                        <div
                          key={fmName}
                          onClick={() => setSelectedDayForeman(isFmActive ? 'all' : fmName)}
                          className={`p-2.5 rounded-xl border transition-all flex items-center justify-between gap-2 text-xs cursor-pointer ${
                            isFmActive
                              ? 'bg-blue-600 text-white border-blue-600 shadow-xs ring-2 ring-blue-300'
                              : 'bg-slate-50 hover:bg-slate-100/80 border-slate-200 text-slate-700'
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <div className={`p-1 rounded-lg shrink-0 ${isFmActive ? 'bg-blue-500 text-white' : 'bg-blue-100 text-blue-700'}`}>
                              <User size={13} />
                            </div>
                            <div className="min-w-0">
                              <p className={`font-black truncate ${isFmActive ? 'text-white' : 'text-slate-800'}`}>
                                โฟร์แมน: {fmName}
                              </p>
                              <p className={`text-[10px] truncate ${isFmActive ? 'text-blue-100' : 'text-slate-500'}`}>
                                ตรวจ {st.updated + st.roadblock} / {st.total} งาน (ค้าง {st.pending})
                              </p>
                            </div>
                          </div>

                          <span
                            className={`px-2 py-0.5 rounded-lg text-xs font-black shrink-0 ${
                              isFmActive
                                ? 'bg-white text-blue-700'
                                : st.rate >= 100
                                ? 'bg-emerald-100 text-emerald-800'
                                : st.rate >= 40
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-rose-100 text-rose-800'
                            }`}
                          >
                            {st.rate}%
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* 📋 รายการงานเจาะลึกในวันนี้ (Task Drill-down List) */}
              <div className="space-y-2 pt-2 border-t border-slate-100">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h4 className="text-xs font-black text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                      <ListFilter size={13} className="text-blue-600" />
                      <span>รายการงานในวันนี้ ({filteredDayTasks.length} รายการ)</span>
                      {selectedDayForeman !== 'all' && (
                        <span className="text-[10px] font-bold text-blue-600 normal-case">
                          [โฟร์แมน: {selectedDayForeman}]
                        </span>
                      )}
                    </h4>
                  </div>

                  {/* Filter Pills */}
                  <div className="flex items-center gap-1 overflow-x-auto custom-scrollbar pb-1 text-[10px] font-bold">
                    <button
                      type="button"
                      onClick={() => setDayTaskStatusFilter('all')}
                      className={`px-2 py-1 rounded-lg transition-all shrink-0 cursor-pointer ${
                        dayTaskStatusFilter === 'all'
                          ? 'bg-slate-800 text-white'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      ทั้งหมด ({dayTasks.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setDayTaskStatusFilter('updated')}
                      className={`px-2 py-1 rounded-lg transition-all shrink-0 cursor-pointer ${
                        dayTaskStatusFilter === 'updated'
                          ? 'bg-emerald-600 text-white'
                          : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200'
                      }`}
                    >
                      คืบหน้า ({selectedDayDetail.updated})
                    </button>
                    <button
                      type="button"
                      onClick={() => setDayTaskStatusFilter('roadblock')}
                      className={`px-2 py-1 rounded-lg transition-all shrink-0 cursor-pointer ${
                        dayTaskStatusFilter === 'roadblock'
                          ? 'bg-amber-600 text-white'
                          : 'bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200'
                      }`}
                    >
                      ติดปัญหา ({selectedDayDetail.roadblock})
                    </button>
                    <button
                      type="button"
                      onClick={() => setDayTaskStatusFilter('pending')}
                      className={`px-2 py-1 rounded-lg transition-all shrink-0 cursor-pointer ${
                        dayTaskStatusFilter === 'pending'
                          ? 'bg-rose-600 text-white'
                          : 'bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200'
                      }`}
                    >
                      ยังไม่อัปเดต ({selectedDayDetail.pending})
                    </button>
                  </div>
                </div>

                {/* Search Bar */}
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-2.5 text-slate-400" />
                  <input
                    type="text"
                    value={dayTaskSearch}
                    onChange={e => setDayTaskSearch(e.target.value)}
                    placeholder="ค้นหาชื่องาน, แปลงบ้าน, หรือโครงการ..."
                    className="w-full pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none transition-all placeholder:text-slate-400"
                  />
                  {dayTaskSearch && (
                    <button
                      type="button"
                      onClick={() => setDayTaskSearch('')}
                      className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-600 p-0.5 rounded-full cursor-pointer"
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>

                {/* Task List */}
                <div className="space-y-2 max-h-60 sm:max-h-72 overflow-y-auto custom-scrollbar pr-1">
                  {filteredDayTasks.length === 0 ? (
                    <div className="py-8 text-center text-xs text-slate-400 space-y-1">
                      <p className="font-semibold">ไม่พบรายการงานที่ตรงกับเงื่อนไข</p>
                      <p className="text-[11px] text-slate-400">ลองเปลี่ยนตัวกรองสถานะหรือค้นหาด้วยคำอื่น</p>
                    </div>
                  ) : (
                    filteredDayTasks.map(task => {
                      const reasonMeta = getRoadblockReason(task.status_reason);
                      return (
                        <div
                          key={task.id}
                          className="p-3 bg-slate-50/80 hover:bg-white rounded-xl border border-slate-200/80 hover:border-blue-200 hover:shadow-xs transition-all space-y-2"
                        >
                          {/* Row 1: Badges & Status */}
                          <div className="flex items-start justify-between gap-2 flex-wrap">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="px-2 py-0.5 bg-blue-100 text-blue-800 rounded-md text-[10px] font-black border border-blue-200">
                                🏢 {task.project_name || 'ไอลิน'}
                              </span>
                              <span className="px-2 py-0.5 bg-slate-200 text-slate-800 rounded-md text-[10px] font-black">
                                🏠 {task.plot_name}
                              </span>
                              <span className="px-2 py-0.5 bg-purple-50 text-purple-700 rounded-md text-[10px] font-semibold border border-purple-200/60">
                                👤 {task.foreman_name}
                              </span>
                            </div>

                            {/* Status Badge */}
                            <div className="shrink-0">
                              {task.is_completed_early ? (
                                <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 border border-emerald-300 text-[10px] font-black rounded-lg flex items-center gap-1">
                                  <CheckCircle2 size={11} className="stroke-[2.5]" />
                                  <span>เสร็จ 100% ล่วงหน้า</span>
                                </span>
                              ) : task.status_reason ? (
                                <span className="px-2 py-0.5 bg-amber-50 text-amber-800 border border-amber-200 text-[10px] font-black rounded-lg flex items-center gap-1">
                                  <span>{reasonMeta?.icon || '⚠️'}</span>
                                  <span className="truncate max-w-[130px]">{reasonMeta?.label || 'แจ้งติดปัญหา'}</span>
                                </span>
                              ) : task.is_updated_today ? (
                                <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-black rounded-lg flex items-center gap-1">
                                  <CheckCircle2 size={11} className="stroke-[2.5]" />
                                  <span>รายงานความคืบหน้า {task.current_progress}%</span>
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 bg-rose-50 text-rose-700 border border-rose-200 text-[10px] font-black rounded-lg flex items-center gap-1">
                                  <Clock size={11} />
                                  <span>ยังไม่อัปเดต</span>
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Row 2: Task Name */}
                          <div>
                            <p className="text-xs font-black text-slate-900">
                              {task.task_name}
                            </p>
                            {task.contractor_name && (
                              <p className="text-[10px] text-slate-500 font-medium mt-0.5">
                                👷 ผู้รับเหมา: {task.contractor_name}
                              </p>
                            )}
                          </div>

                          {/* Row 3: Roadblock Note (if any) */}
                          {task.status_reason && task.status_note && (
                            <div className="p-2 bg-amber-50 border border-amber-200/80 rounded-lg text-[10px] text-amber-900 font-medium">
                              <span className="font-bold">หมายเหตุ: </span>
                              {task.status_note}
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>

            {/* Pinned Footer Actions */}
            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 shrink-0 bg-white flex-wrap">
              <button
                type="button"
                onClick={() => setSelectedDayDetail(null)}
                className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-all cursor-pointer"
              >
                ปิด
              </button>

              {onViewDayActivity && (
                <button
                  type="button"
                  onClick={() => {
                    const d = selectedDayDetail.date;
                    setSelectedDayDetail(null);
                    onViewDayActivity(d);
                  }}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white text-xs font-black rounded-xl shadow-xs transition-all flex items-center gap-1.5 cursor-pointer active:scale-95"
                >
                  <Activity size={13} />
                  <span>ดูบันทึกกิจกรรมจริงวันนี้</span>
                </button>
              )}

              {onSelectDate && (
                <button
                  type="button"
                  onClick={() => {
                    const d = selectedDayDetail.date;
                    setSelectedDayDetail(null);
                    onSelectDate(d);
                  }}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-black rounded-xl shadow-xs transition-all flex items-center gap-1.5 cursor-pointer active:scale-95"
                >
                  <span>เปิดดูรายการงานของวันนี้</span>
                  <ArrowRight size={13} />
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
