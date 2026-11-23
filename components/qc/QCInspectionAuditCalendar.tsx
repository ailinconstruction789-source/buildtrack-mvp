'use client';
import React, { useState, useMemo, useEffect } from 'react';
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Flame,
  CheckCircle2,
  AlertTriangle,
  Clock,
  UserX,
  UserCheck,
  Building2,
  Home,
  Info,
  X,
  Search,
  Sparkles,
  HelpCircle,
  ShieldAlert,
  ArrowRight,
  Scale,
} from 'lucide-react';
import {
  buildQCMonthlyAuditCalendar,
  getQCMetricFormulaDetails,
  type QCDayInspectionAudit,
  type QCMonthlyAuditSummary,
  type MetricFormulaInfo,
} from '@/lib/qc/qcAuditAnalyticsService';
import type { QCPlanItem } from '@/lib/qc/qcInspectionPlanService';
import type { QCLeaveRequest } from '@/lib/qc/qcLeaveAndStandInService';
import { getQCCapacityThreshold } from '@/lib/qc/qcCapacitySettingService';
import QCCapacityThresholdModal from './QCCapacityThresholdModal';

interface QCInspectionAuditCalendarProps {
  planItems?: QCPlanItem[];
  leaves?: QCLeaveRequest[];
  projects?: string[];
  inspectors?: string[];
  initialYear?: number;
  initialMonth?: number;
  onSelectTask?: (task: QCPlanItem) => void;
  currentUserRole?: string;
  currentUsername?: string;
  allUpdatesRecord?: any[];
  taskWeightsMap?: Map<string, any>;
  onThresholdChanged?: (newThreshold: number) => void;
}

const WEEKDAY_NAMES = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];

export default function QCInspectionAuditCalendar({
  planItems = [],
  leaves = [],
  projects = [],
  inspectors = [],
  initialYear,
  initialMonth,
  onSelectTask,
  currentUserRole = 'admin',
  currentUsername = 'admin',
  allUpdatesRecord = [],
  taskWeightsMap = new Map(),
  onThresholdChanged,
}: QCInspectionAuditCalendarProps) {
  const now = new Date();
  const [currentYear, setCurrentYear] = useState<number>(initialYear || now.getFullYear());
  const [currentMonth, setCurrentMonth] = useState<number>(initialMonth || now.getMonth() + 1);
  const [selectedInspector, setSelectedInspector] = useState<string>('all');
  const [selectedProject, setSelectedProject] = useState<string>('all');

  // Daily Overload Threshold & Capacity Modal
  const [dailyOverloadThreshold, setDailyOverloadThreshold] = useState<number>(12);
  const [isCapacityModalOpen, setIsCapacityModalOpen] = useState<boolean>(false);

  useEffect(() => {
    getQCCapacityThreshold().then(val => setDailyOverloadThreshold(val));
  }, []);

  // Drill-down states
  const [selectedDayDetail, setSelectedDayDetail] = useState<QCDayInspectionAudit | null>(null);
  const [dayTaskSearch, setDayTaskSearch] = useState<string>('');
  const [dayTaskTab, setDayTaskTab] = useState<'all' | 'hold_point' | 'completed' | 'deferred' | 'cannot_inspect'>('all');

  // Formula explanation modal
  const [activeFormulaKey, setActiveFormulaKey] = useState<string | null>(null);

  // Calculate monthly summary
  const monthlySummary: QCMonthlyAuditSummary = useMemo(() => {
    return buildQCMonthlyAuditCalendar({
      year: currentYear,
      month: currentMonth,
      planItems,
      leaves,
      targetInspector: selectedInspector,
      targetProject: selectedProject,
      dailyOverloadThreshold,
    });
  }, [currentYear, currentMonth, planItems, leaves, selectedInspector, selectedProject, dailyOverloadThreshold]);

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

  // Calendar grid empty slot padding before day 1
  const firstDayOfWeek = useMemo(() => {
    return new Date(Date.UTC(currentYear, currentMonth - 1, 1)).getUTCDay();
  }, [currentYear, currentMonth]);

  // Filter tasks in Day Detail Modal
  const filteredDayTasks = useMemo(() => {
    if (!selectedDayDetail) return [];
    return selectedDayDetail.tasks.filter(t => {
      if (dayTaskTab === 'hold_point' && !t.snapshot_is_hold_point) return false;
      if (dayTaskTab === 'completed' && t.execution_status !== 'passed' && t.execution_status !== 'failed') return false;
      if (dayTaskTab === 'deferred' && t.plan_status !== 'deferred') return false;
      if (dayTaskTab === 'cannot_inspect' && t.execution_status !== 'cannot_inspect') return false;

      if (dayTaskSearch.trim()) {
        const q = dayTaskSearch.toLowerCase().trim();
        const mTask = (t.task_name || '').toLowerCase().includes(q);
        const mPlot = (t.plot_name || '').toLowerCase().includes(q);
        const mProj = (t.project_name || '').toLowerCase().includes(q);
        const mInsp = (t.assigned_inspector_username || '').toLowerCase().includes(q);
        if (!mTask && !mPlot && !mProj && !mInsp) return false;
      }
      return true;
    });
  }, [selectedDayDetail, dayTaskTab, dayTaskSearch]);

  const formulaInfo: MetricFormulaInfo | null = useMemo(() => {
    if (!activeFormulaKey) return null;
    return getQCMetricFormulaDetails(activeFormulaKey, dailyOverloadThreshold);
  }, [activeFormulaKey, dailyOverloadThreshold]);

  return (
    <div className="bg-white rounded-3xl border border-slate-200 p-5 sm:p-7 shadow-xs space-y-6">
      
      {/* 1. Header with Month Switcher & Filters */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-100 pb-5">
        <div>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-purple-50 text-purple-700 rounded-xl text-xs font-black border border-purple-200 mb-2">
            <Calendar size={13} />
            <span>QC AUDIT CALENDAR • ปฏิทินตรวจสอบแผนงาน QC</span>
          </div>
          <h3 className="text-lg sm:text-2xl font-black text-slate-900 tracking-tight flex items-center gap-2">
            <span>ปฏิทินตรวจสอบผลงานและภาระงาน QC รายเดือน</span>
          </h3>
          <p className="text-xs text-slate-500 font-medium">
            บันทึกความสม่ำเสมอ แผนงานถ่วงน้ำหนัก วันลา และการจัดผู้ตรวจแทนอย่างเป็นธรรม
          </p>
        </div>

        {/* Month Switcher & Filters */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Project Filter */}
          {projects.length > 0 && (
            <select
              value={selectedProject}
              onChange={e => setSelectedProject(e.target.value)}
              className="bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs font-bold text-slate-700 cursor-pointer focus:outline-none focus:ring-2 focus:ring-purple-400"
            >
              <option value="all">🏢 ทุกโครงการ</option>
              {projects.map(p => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          )}

          {/* Inspector Filter */}
          {inspectors.length > 0 && (
            <select
              value={selectedInspector}
              onChange={e => setSelectedInspector(e.target.value)}
              className="bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs font-bold text-slate-700 cursor-pointer focus:outline-none focus:ring-2 focus:ring-purple-400"
            >
              <option value="all">👤 ผู้ตรวจทุกคน</option>
              {inspectors.map(i => (
                <option key={i} value={i}>{i}</option>
              ))}
            </select>
          )}

          {/* Month Switcher */}
          <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-2xl p-1 shrink-0">
            <button
              type="button"
              onClick={handlePrevMonth}
              className="p-1.5 hover:bg-white text-slate-600 rounded-xl transition-all cursor-pointer shadow-2xs"
              title="เดือนก่อนหน้า"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="text-xs sm:text-sm font-black text-slate-800 px-2 min-w-[120px] text-center">
              {monthlySummary.monthLabel}
            </span>
            <button
              type="button"
              onClick={handleNextMonth}
              className="p-1.5 hover:bg-white text-slate-600 rounded-xl transition-all cursor-pointer shadow-2xs"
              title="เดือนถัดไป"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          {/* Capacity Setting Button (Admin) */}
          <button
            type="button"
            onClick={() => setIsCapacityModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-gradient-to-r from-purple-600 via-indigo-600 to-indigo-700 hover:from-purple-700 hover:to-indigo-800 text-white rounded-2xl text-xs font-bold shadow-md shadow-indigo-900/20 transition-all shrink-0 cursor-pointer"
            title="วิเคราะห์ภาระงานย้อนหลัง (จันทร์–เสาร์) และกำหนดเกณฑ์ภาระงานรายวัน"
          >
            <Scale size={14} className="text-amber-300" />
            <span>เกณฑ์ภาระงาน ({dailyOverloadThreshold} แต้ม)</span>
          </button>
        </div>
      </div>

      {/* 2. Monthly Rollup Scorecards (Clickable for Formula Breakdown) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 text-center">
        {/* Clearance Rate */}
        <div
          onClick={() => setActiveFormulaKey('clearance_rate')}
          className="bg-purple-50 hover:bg-purple-100/80 p-3 rounded-2xl border border-purple-200 transition-all cursor-pointer group"
          title="คลิกเพื่อดูสูตรและการคิดคะแนน"
        >
          <p className="text-[10px] text-purple-700 font-bold flex items-center justify-center gap-1">
            <Sparkles size={11} />
            <span>เคลียร์แต้มรวม</span>
            <Info size={10} className="text-purple-400 group-hover:text-purple-600" />
          </p>
          <p className="text-2xl font-black text-purple-800">{monthlySummary.clearanceRatePct}%</p>
          <p className="text-[9px] text-purple-600 font-semibold">
            {monthlySummary.totalCompletedPoints} / {monthlySummary.totalBaselinePlannedPoints} แต้ม
          </p>
        </div>

        {/* Days 100% Completed */}
        <div className="bg-emerald-50 p-3 rounded-2xl border border-emerald-200">
          <p className="text-[10px] text-emerald-700 font-bold flex items-center justify-center gap-1">
            <CheckCircle2 size={11} />
            <span>ตรวจครบ 100%</span>
          </p>
          <p className="text-2xl font-black text-emerald-800">{monthlySummary.daysCompletedCount} วัน</p>
          <p className="text-[9px] text-emerald-600 font-semibold">เคลียร์แผนงานครบถ้วน</p>
        </div>

        {/* Partial / Deferred */}
        <div className="bg-amber-50 p-3 rounded-2xl border border-amber-200">
          <p className="text-[10px] text-amber-700 font-bold flex items-center justify-center gap-1">
            <Clock size={11} />
            <span>ตรวจบางส่วน / เลื่อน</span>
          </p>
          <p className="text-2xl font-black text-amber-800">{monthlySummary.daysPartialCount} วัน</p>
          <p className="text-[9px] text-amber-600 font-semibold">เลื่อนตรวจ {monthlySummary.totalDeferredPoints} แต้ม</p>
        </div>

        {/* Hold Point On-Time */}
        <div
          onClick={() => setActiveFormulaKey('hold_point_ontime')}
          className="bg-rose-50 hover:bg-rose-100/80 p-3 rounded-2xl border border-rose-200 transition-all cursor-pointer group"
          title="คลิกเพื่อดูสูตรและการคิดคะแนน"
        >
          <p className="text-[10px] text-rose-700 font-bold flex items-center justify-center gap-1">
            <Flame size={11} />
            <span>Hold Point ทันเวลา</span>
            <Info size={10} className="text-rose-400 group-hover:text-rose-600" />
          </p>
          <p className="text-2xl font-black text-rose-700">{monthlySummary.holdPointOnTimePct}%</p>
          <p className="text-[9px] text-rose-600 font-semibold">
            ทัน {monthlySummary.holdPointOnTimeCount} จาก {monthlySummary.holdPointTotal} จุด
          </p>
        </div>

        {/* Leave Days */}
        <div className="bg-blue-50 p-3 rounded-2xl border border-blue-200">
          <p className="text-[10px] text-blue-700 font-bold flex items-center justify-center gap-1">
            <UserX size={11} />
            <span>วันลาที่อนุมัติ</span>
          </p>
          <p className="text-2xl font-black text-blue-800">{monthlySummary.daysLeaveCount} วัน</p>
          <p className="text-[9px] text-blue-600 font-semibold">ไม่ถูกคิดเป็น 0% ใน KPI</p>
        </div>

        {/* Overloaded Days */}
        <div
          onClick={() => setActiveFormulaKey('overload_rate')}
          className="bg-orange-50 hover:bg-orange-100/80 p-3 rounded-2xl border border-orange-200 transition-all cursor-pointer group"
          title="คลิกเพื่อดูสูตรและการคิดคะแนน"
        >
          <p className="text-[10px] text-orange-700 font-bold flex items-center justify-center gap-1">
            <AlertTriangle size={11} />
            <span>ภาระงานเกินกำลัง</span>
            <Info size={10} className="text-orange-400 group-hover:text-orange-600" />
          </p>
          <p className="text-2xl font-black text-orange-800">{monthlySummary.overloadedDaysTotal} วัน</p>
          <p className="text-[9px] text-orange-600 font-semibold">เกิน {dailyOverloadThreshold} แต้ม/คน/วัน</p>
        </div>
      </div>

      {/* 3. Monthly Calendar Grid */}
      <div className="space-y-2">
        {/* Day Header Row */}
        <div className="grid grid-cols-7 gap-1 text-center font-black text-xs text-slate-500 pb-1">
          {WEEKDAY_NAMES.map((name, i) => (
            <div key={name} className={`py-1 ${i === 0 ? 'text-rose-600' : ''}`}>
              {name}
            </div>
          ))}
        </div>

        {/* Days Grid */}
        <div className="grid grid-cols-7 gap-1.5">
          {/* Empty cells before month start */}
          {Array.from({ length: firstDayOfWeek }).map((_, i) => (
            <div key={`empty-${i}`} className="min-h-[75px] sm:min-h-[90px] bg-slate-50/40 rounded-2xl border border-dashed border-slate-100 opacity-40"></div>
          ))}

          {/* Actual days */}
          {monthlySummary.days.map(day => {
            const hasTasks = day.totalTasksCount > 0;
            const isClickable = true;

            return (
              <div
                key={day.dateStr}
                onClick={() => setSelectedDayDetail(day)}
                className={`min-h-[75px] sm:min-h-[90px] p-2 rounded-2xl border transition-all flex flex-col justify-between ${
                  day.statusColorClass
                } ${isClickable ? 'cursor-pointer hover:shadow-md hover:scale-[1.02]' : ''}`}
              >
                {/* Top Row: Date Number and Special Icons */}
                <div className="flex items-start justify-between">
                  <span className={`text-xs sm:text-sm font-black ${day.dayOfWeek === 0 ? 'text-rose-600' : 'text-slate-800'}`}>
                    {day.dayNumber}
                  </span>

                  <div className="flex items-center gap-0.5">
                    {day.holdPointsCount > 0 && (
                      <span className="p-0.5 bg-rose-600 text-white rounded-md text-[9px] font-black" title={`Hold Point ${day.holdPointsCount} งาน`}>
                        <Flame size={10} />
                      </span>
                    )}
                    {day.isOnLeave && (
                      <span className="p-0.5 bg-blue-600 text-white rounded-md text-[9px] font-black" title="มีประวัติลาที่อนุมัติ">
                        <UserX size={10} />
                      </span>
                    )}
                    {day.standInCount > 0 && (
                      <span className="p-0.5 bg-purple-600 text-white rounded-md text-[9px] font-black" title="มีการตรวจแทน">
                        <UserCheck size={10} />
                      </span>
                    )}
                  </div>
                </div>

                {/* Middle / Bottom Content */}
                <div className="space-y-1 pt-1">
                  {hasTasks ? (
                    <>
                      <div className="text-[10px] font-black truncate leading-tight">
                        {day.totalCompletedPoints} / {day.totalPlannedPoints} แต้ม
                      </div>
                      <div className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-white/70 backdrop-blur-xs truncate text-center shadow-2xs">
                        {day.statusLabel}
                      </div>
                    </>
                  ) : day.status === 'on_leave' ? (
                    <div className="text-[9px] font-black text-blue-700 bg-blue-100/80 px-1 py-0.5 rounded-md text-center truncate">
                      ลาพักผ่อน
                    </div>
                  ) : (
                    <div className="text-[9px] text-slate-400 text-center font-medium">
                      {day.dayOfWeek === 0 ? 'วันหยุด' : 'ไม่มีงาน'}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 4. Legend Bar */}
      <div className="flex items-center justify-between text-xs text-slate-500 pt-2 border-t border-slate-100 flex-wrap gap-2">
        <div className="flex items-center gap-3 flex-wrap text-[11px] font-bold">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-emerald-500"></span>
            <span>ตรวจครบ 100%</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-amber-400"></span>
            <span>ตรวจบางส่วน / มีการเลื่อนตรวจ</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-blue-500"></span>
            <span>วันลาที่อนุมัติ</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-orange-400"></span>
            <span>รอจัดผู้ตรวจ</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-slate-300"></span>
            <span>ไม่มีงานตามแผน</span>
          </span>
        </div>

        <button
          type="button"
          onClick={() => setActiveFormulaKey('clearance_rate')}
          className="text-[11px] font-bold text-purple-700 hover:text-purple-900 flex items-center gap-1 cursor-pointer"
        >
          <HelpCircle size={13} />
          <span>ดูสูตรและที่มาของตัวเลข</span>
        </button>
      </div>

      {/* 5. Drill-Down Day Detail Modal */}
      {selectedDayDetail && (
        <div className="fixed inset-0 z-[1300] flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl max-w-2xl sm:max-w-3xl w-full p-5 sm:p-6 shadow-2xl border border-slate-200 flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200">
            
            {/* Modal Header */}
            <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-100 shrink-0">
              <div className="space-y-1">
                <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 bg-purple-50 text-purple-700 rounded-lg text-xs font-black border border-purple-200">
                  <Calendar size={13} />
                  <span>รายละเอียดแผนตรวจรายวัน: {selectedDayDetail.dateStr}</span>
                </div>
                <h3 className="text-base sm:text-lg font-black text-slate-900">
                  {selectedDayDetail.statusLabel}
                </h3>
              </div>
              <button
                onClick={() => setSelectedDayDetail(null)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 transition-all cursor-pointer shrink-0"
              >
                <X size={20} />
              </button>
            </div>

            {/* Scorecards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 py-3 shrink-0 text-center">
              <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                <p className="text-[10px] text-slate-500 font-bold">แผนงานทั้งหมด</p>
                <p className="text-xl font-black text-slate-800">{selectedDayDetail.totalPlannedPoints} แต้ม</p>
                <p className="text-[9px] text-slate-400">{selectedDayDetail.totalTasksCount} รายการ</p>
              </div>

              <div className="bg-emerald-50 p-2.5 rounded-xl border border-emerald-200">
                <p className="text-[10px] text-emerald-700 font-bold">ตรวจเสร็จจริง</p>
                <p className="text-xl font-black text-emerald-800">{selectedDayDetail.totalCompletedPoints} แต้ม</p>
                <p className="text-[9px] text-emerald-600 font-semibold">{selectedDayDetail.completedTasksCount} รายการ</p>
              </div>

              <div className="bg-amber-50 p-2.5 rounded-xl border border-amber-200">
                <p className="text-[10px] text-amber-700 font-bold">เลื่อนตรวจ</p>
                <p className="text-xl font-black text-amber-800">{selectedDayDetail.totalDeferredPoints} แต้ม</p>
                <p className="text-[9px] text-amber-600 font-semibold">{selectedDayDetail.deferredTasksCount} รายการ</p>
              </div>

              <div className="bg-rose-50 p-2.5 rounded-xl border border-rose-200">
                <p className="text-[10px] text-rose-700 font-bold">Hold Point</p>
                <p className="text-xl font-black text-rose-800">{selectedDayDetail.holdPointsCount} จุด</p>
                <p className="text-[9px] text-rose-600 font-semibold">งานโครงสร้างวิกฤต</p>
              </div>
            </div>

            {/* Inspector Breakdown Row */}
            {selectedDayDetail.inspectors.length > 0 && (
              <div className="bg-slate-50 p-3 rounded-2xl border border-slate-200 space-y-1.5 shrink-0">
                <p className="text-xs font-black text-slate-700">รายชื่อผู้ตรวจในวันนี้:</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {selectedDayDetail.inspectors.map(insp => (
                    <div
                      key={insp.username}
                      className="bg-white p-2 rounded-xl border border-slate-200 flex items-center justify-between text-xs"
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-slate-800">{insp.username}</span>
                        {insp.isOnLeave && (
                          <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-[9px] font-black">
                            ลา
                          </span>
                        )}
                        {insp.isOverloaded && (
                          <span className="px-1.5 py-0.5 bg-orange-100 text-orange-700 rounded text-[9px] font-black">
                            เกิน {dailyOverloadThreshold} แต้ม
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] font-black text-purple-700">
                        {insp.completedPoints} / {insp.plannedPoints} แต้ม ({insp.tasksCount} งาน)
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Filter Tabs & Search */}
            <div className="flex items-center justify-between gap-2 py-2 shrink-0 flex-wrap">
              <div className="flex items-center gap-1 text-[11px] font-bold">
                <button
                  type="button"
                  onClick={() => setDayTaskTab('all')}
                  className={`px-2.5 py-1 rounded-lg cursor-pointer ${
                    dayTaskTab === 'all' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  ทั้งหมด ({selectedDayDetail.tasks.length})
                </button>
                <button
                  type="button"
                  onClick={() => setDayTaskTab('hold_point')}
                  className={`px-2.5 py-1 rounded-lg cursor-pointer ${
                    dayTaskTab === 'hold_point' ? 'bg-rose-600 text-white' : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  Hold Point ({selectedDayDetail.holdPointsCount})
                </button>
                <button
                  type="button"
                  onClick={() => setDayTaskTab('deferred')}
                  className={`px-2.5 py-1 rounded-lg cursor-pointer ${
                    dayTaskTab === 'deferred' ? 'bg-amber-600 text-white' : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  เลื่อนตรวจ ({selectedDayDetail.deferredTasksCount})
                </button>
              </div>

              <div className="relative">
                <Search size={12} className="absolute left-2.5 top-2 text-slate-400" />
                <input
                  type="text"
                  value={dayTaskSearch}
                  onChange={e => setDayTaskSearch(e.target.value)}
                  placeholder="ค้นหาชื่องาน/แปลง..."
                  className="pl-7 pr-2.5 py-1 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-purple-400"
                />
              </div>
            </div>

            {/* Task Items List */}
            <div className="flex-1 overflow-y-auto custom-scrollbar pr-1 space-y-2">
              {filteredDayTasks.length === 0 ? (
                <div className="text-center py-10 text-xs text-slate-400">
                  ไม่มีรายการงานที่ตรงกับตัวกรอง
                </div>
              ) : (
                filteredDayTasks.map(task => (
                  <div
                    key={task.id}
                    className="p-3 bg-slate-50 rounded-2xl border border-slate-200 space-y-1.5"
                  >
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="px-2 py-0.5 bg-blue-100 text-blue-800 rounded-md text-[10px] font-black">
                          {task.project_name}
                        </span>
                        <span className="px-2 py-0.5 bg-slate-200 text-slate-800 rounded-md text-[10px] font-black">
                          {task.plot_name}
                        </span>
                        {task.snapshot_is_hold_point && (
                          <span className="px-2 py-0.5 bg-rose-600 text-white rounded-md text-[10px] font-black flex items-center gap-1">
                            <Flame size={11} />
                            <span>Hold Point</span>
                          </span>
                        )}
                      </div>

                      <div className="text-[11px] font-black text-purple-700 bg-purple-100 px-2 py-0.5 rounded-lg">
                        {task.snapshot_weight_score ?? '-'} แต้ม
                      </div>
                    </div>

                    <h4 className="text-xs font-black text-slate-900">{task.task_name}</h4>

                    <div className="flex items-center justify-between text-[10px] text-slate-500 pt-1 border-t border-slate-200/60 flex-wrap gap-2">
                      <div>
                        ผู้ตรวจ: <span className="font-bold text-slate-700">{task.assigned_inspector_username || 'รอจัดผู้ตรวจ'}</span>
                        {task.actual_inspector_username && task.actual_inspector_username !== task.assigned_inspector_username && (
                          <span className="ml-1 text-purple-700 font-bold">(ตรวจโดย {task.actual_inspector_username})</span>
                        )}
                      </div>

                      <div>
                        {task.plan_status === 'deferred' ? (
                          <span className="text-amber-700 font-bold">เลื่อนตรวจ: {task.deferral_reason}</span>
                        ) : task.execution_status === 'passed' ? (
                          <span className="text-emerald-700 font-bold">✅ ผ่าน (ได้ {task.earned_points} แต้ม)</span>
                        ) : task.execution_status === 'failed' ? (
                          <span className="text-rose-700 font-bold">❌ ตรวจไม่ผ่าน/สั่งแก้ (ได้ {task.earned_points} แต้ม)</span>
                        ) : task.execution_status === 'cannot_inspect' ? (
                          <span className="text-amber-700 font-bold">⚠️ ตรวจไม่ได้ (0 แต้ม)</span>
                        ) : (
                          <span className="text-slate-500 font-bold">⏳ รอผลการตรวจ</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Modal Footer */}
            <div className="pt-3 border-t border-slate-100 flex items-center justify-end shrink-0">
              <button
                type="button"
                onClick={() => setSelectedDayDetail(null)}
                className="px-4 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-xs cursor-pointer"
              >
                ปิด
              </button>
            </div>

          </div>
        </div>
      )}

      {/* 6. Formula & Explainability Drawer / Modal */}
      {formulaInfo && (
        <div className="fixed inset-0 z-[1350] flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl max-w-lg w-full p-5 sm:p-6 shadow-2xl border border-slate-200 space-y-4 animate-in zoom-in-95 duration-200">
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
              <div>
                <span className="px-2 py-0.5 bg-purple-50 text-purple-700 rounded text-[10px] font-black border border-purple-200">
                  สูตรและการคำนวณที่โปร่งใส
                </span>
                <h3 className="text-base font-black text-slate-900 mt-1">{formulaInfo.title}</h3>
              </div>
              <button
                onClick={() => setActiveFormulaKey(null)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="bg-purple-50/70 p-3 rounded-2xl border border-purple-200">
                <p className="font-bold text-purple-800">สูตร:</p>
                <p className="text-sm font-black text-purple-950 mt-0.5">{formulaInfo.formulaDescription}</p>
              </div>

              <div className="space-y-1.5">
                <p><span className="font-black text-slate-800">ตัวตั้ง (Numerator):</span> {formulaInfo.numeratorDescription}</p>
                <p><span className="font-black text-slate-800">ตัวหาร (Denominator):</span> {formulaInfo.denominatorDescription}</p>
                <p><span className="font-black text-slate-800">ข้อยกเว้น (Exclusions):</span> {formulaInfo.exclusionsDescription}</p>
              </div>

              <div className="p-3 bg-amber-50 rounded-2xl border border-amber-200 text-amber-900">
                <p className="font-black flex items-center gap-1 mb-1">
                  <ShieldAlert size={14} className="text-amber-700" />
                  <span>หลักความยุติธรรม (Fairness Guarantee):</span>
                </p>
                <p className="text-[11px] leading-relaxed">{formulaInfo.fairnessNote}</p>
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={() => setActiveFormulaKey(null)}
                className="px-4 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs cursor-pointer"
              >
                เข้าใจแล้ว
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 7. Capacity Threshold & Historical Analytics Modal */}
      <QCCapacityThresholdModal
        isOpen={isCapacityModalOpen}
        onClose={() => setIsCapacityModalOpen(false)}
        currentUserRole={currentUserRole}
        currentUsername={currentUsername}
        allUpdatesRecord={allUpdatesRecord}
        taskWeightsMap={taskWeightsMap}
        onThresholdUpdated={newVal => {
          setDailyOverloadThreshold(newVal);
          onThresholdChanged?.(newVal);
        }}
      />

    </div>
  );
}
