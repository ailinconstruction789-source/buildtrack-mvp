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
} from 'lucide-react';
import {
  getMonthlyForemanInspectionCompliance,
  getPlotForemanName,
  loadForemanMonthlySnapshots,
  type MonthInspectionSummary,
  type DayInspectionCompliance,
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
                  setSelectedDayDetail(day);
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-5 animate-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 bg-blue-50 text-blue-700 rounded-lg text-xs font-black border border-blue-200">
                  <Calendar size={13} />
                  <span>บันทึกการเข้าตรวจงานประจำวัน</span>
                </div>
                <h3 className="text-lg font-black text-slate-900">
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
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 transition-all cursor-pointer"
              >
                <X size={20} />
              </button>
            </div>

            {/* Day Stats Cards */}
            <div className="grid grid-cols-4 gap-2 text-center">
              <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                <p className="text-[10px] text-slate-500 font-bold">แผนงาน</p>
                <p className="text-lg font-black text-slate-800">{selectedDayDetail.totalScheduled}</p>
              </div>
              <div className="bg-emerald-50 p-2.5 rounded-xl border border-emerald-200">
                <p className="text-[10px] text-emerald-700 font-bold">อัปเดตแล้ว</p>
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
              <p className="text-xs font-black text-slate-700 uppercase tracking-wider">
                ผลการตรวจงานแยกตามโฟร์แมนในวันนี้:
              </p>
              {Object.keys(selectedDayDetail.foremanStats).length === 0 ? (
                <p className="text-xs text-slate-400 italic py-2">ไม่มีงานตามแผนในวันนี้</p>
              ) : (
                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {Object.entries(selectedDayDetail.foremanStats).map(([fmName, st]) => (
                    <div
                      key={fmName}
                      className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 bg-blue-100 text-blue-700 rounded-lg">
                          <User size={13} />
                        </div>
                        <div>
                          <p className="font-black text-slate-800">โฟร์แมน: {fmName}</p>
                          <p className="text-[10px] text-slate-500">
                            ตรวจ {st.updated + st.roadblock} / {st.total} งาน (ค้าง {st.pending})
                          </p>
                        </div>
                      </div>

                      <span
                        className={`px-2 py-1 rounded-lg text-xs font-black ${
                          st.rate >= 100
                            ? 'bg-emerald-100 text-emerald-800'
                            : st.rate >= 40
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-rose-100 text-rose-800'
                        }`}
                      >
                        {st.rate}%
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 flex-wrap">
              <button
                onClick={() => setSelectedDayDetail(null)}
                className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-all cursor-pointer"
              >
                ปิด
              </button>

              {onViewDayActivity && (
                <button
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
