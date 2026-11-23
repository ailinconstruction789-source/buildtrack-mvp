'use client';
import React, { useState, useMemo, useEffect } from 'react';
import {
  Calendar,
  Layers,
  Search,
  Filter,
  Flame,
  AlertTriangle,
  Clock,
  Building2,
  CheckCircle2,
  Scale,
  UserX,
  UserCheck,
  ArrowRight,
  ShieldAlert,
  CalendarCheck2,
  Sparkles,
  BarChart3,
  CalendarDays,
  ListTodo,
  Home,
} from 'lucide-react';
import {
  buildQCDailyInspectionPlan,
  type QCInspectionTaskItem,
  type QCDailyPlanSummary,
} from '@/lib/qcInspectionPlan';
import {
  canManageQCWeights,
  getQCTaskWeights,
  getMonthlyQCPlanItems,
  type QCTaskWeight,
  type QCPlanItem,
} from '@/lib/qc/qcInspectionPlanService';
import { canAssignStandIn } from '@/lib/qc/qcLeaveAndStandInService';
import { getQCCapacityThreshold } from '@/lib/qc/qcCapacitySettingService';
import QCTaskWeightConfigModal from './QCTaskWeightConfigModal';
import QCLeaveRequestModal from './QCLeaveRequestModal';
import QCStandInAssignmentModal from './QCStandInAssignmentModal';
import QCInspectionAuditCalendar from './QCInspectionAuditCalendar';
import QCCapacityThresholdModal from './QCCapacityThresholdModal';

interface QCDailyInspectionPlanViewProps {
  inspectionQueue?: any[];
  taskTemplates?: any[];
  plots?: any[];
  projects?: any[];
  allUpdatesRecord?: any[];
  currentUserRole?: string;
  loggedInUsername?: string;
  setSelectedProject?: (project: any) => void;
  setSelectedPlot?: (plot: any) => void;
  setSelectedTask?: (task: any) => void;
  setTaskReturnView?: (view: string) => void;
  setView?: (view: string) => void;
}

export default function QCDailyInspectionPlanView({
  inspectionQueue = [],
  taskTemplates = [],
  plots = [],
  projects = [],
  allUpdatesRecord = [],
  currentUserRole = 'QC',
  loggedInUsername = 'user',
  setSelectedProject,
  setSelectedPlot,
  setSelectedTask,
  setTaskReturnView,
  setView,
}: QCDailyInspectionPlanViewProps) {
  const [activeTab, setActiveTab] = useState<'all' | 'hold_point' | 'late' | 'rework'>('all');
  const [viewMode, setViewMode] = useState<'queue' | 'audit_calendar'>('queue');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProjectFilter, setSelectedProjectFilter] = useState('all');
  const [weightsMap, setWeightsMap] = useState<Map<string, QCTaskWeight>>(new Map());
  const [isWeightModalOpen, setIsWeightModalOpen] = useState(false);
  const [isLeaveModalOpen, setIsLeaveModalOpen] = useState(false);
  const [selectedTaskForStandIn, setSelectedTaskForStandIn] = useState<QCPlanItem | null>(null);

  // Daily Capacity Threshold state & Modal
  const [dailyCapacityThreshold, setDailyCapacityThreshold] = useState<number>(12);
  const [isCapacityModalOpen, setIsCapacityModalOpen] = useState(false);
  const [monthlyPlanItems, setMonthlyPlanItems] = useState<QCPlanItem[]>([]);

  useEffect(() => {
    getQCTaskWeights().then(map => setWeightsMap(map));
    getQCCapacityThreshold().then(val => setDailyCapacityThreshold(val));
  }, []);

  useEffect(() => {
    const now = new Date();
    getMonthlyQCPlanItems({
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      inspectionQueue,
      allUpdatesRecord,
      plots,
      weightsMap,
    }).then(items => {
      if (items) setMonthlyPlanItems(items);
    });
  }, [inspectionQueue, allUpdatesRecord, plots, weightsMap]);

  const handleWeightSaved = async () => {
    const updated = await getQCTaskWeights();
    setWeightsMap(updated);
  };

  // Compute daily inspection plan
  const planSummary: QCDailyPlanSummary = useMemo(() => {
    return buildQCDailyInspectionPlan({
      inspectionQueue,
      weightsMap,
      taskTemplates,
      plots,
      targetProject: selectedProjectFilter,
    });
  }, [inspectionQueue, weightsMap, taskTemplates, plots, selectedProjectFilter]);

  // Unique project names for dropdown
  const projectNames = useMemo(() => {
    const set = new Set<string>();
    (inspectionQueue || []).forEach(q => {
      const p = q.project_name || q.projectName;
      if (p && !p.toLowerCase().includes('demo')) {
        set.add(p);
      }
    });
    return Array.from(set);
  }, [inspectionQueue]);

  // Filtered task items
  const filteredTasks = useMemo(() => {
    return planSummary.tasks.filter((item: QCInspectionTaskItem) => {
      if (activeTab === 'hold_point' && !item.is_hold_point) return false;
      if (activeTab === 'late' && !item.is_late_handoff) return false;
      if (activeTab === 'rework' && !item.is_rejected) return false;

      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchPlot = item.plot_name.toLowerCase().includes(query);
        const matchTask = item.task_name.toLowerCase().includes(query);
        const matchProj = item.project_name.toLowerCase().includes(query);
        const matchFm = (item.foreman_name || '').toLowerCase().includes(query);
        if (!matchPlot && !matchTask && !matchProj && !matchFm) return false;
      }

      return true;
    });
  }, [planSummary.tasks, activeTab, searchQuery]);

  const canConfigureWeights = canManageQCWeights(currentUserRole);
  const canReassign = canAssignStandIn(currentUserRole);

  const handleStartInspection = (taskItem: QCInspectionTaskItem) => {
    const relatedProject = projects.find(p => p.name === taskItem.project_name);
    const relatedPlot = plots.find(p => String(p.id) === String(taskItem.plot_id));
    const relatedTask = taskTemplates.find(t => String(t.id) === String(taskItem.task_template_id));

    if (relatedPlot && relatedTask) {
      if (relatedProject && setSelectedProject) setSelectedProject(relatedProject);
      if (setSelectedPlot) setSelectedPlot(relatedPlot);
      if (setSelectedTask) setSelectedTask(relatedTask);
      if (setTaskReturnView) setTaskReturnView('qc-daily-plan');
      if (setView) setView('task-progress');
    }
  };

  return (
    <div className="w-full max-w-7xl mx-auto space-y-6 pb-12">
      {/* 🌟 Header Section 🌟 */}
      <div className="bg-gradient-to-r from-slate-900 via-purple-950 to-slate-900 text-white rounded-3xl p-6 sm:p-8 shadow-xl border border-purple-800/40 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6 relative z-10">
          <div>
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-purple-500/20 text-purple-300 rounded-full text-xs font-bold border border-purple-400/30">
                <CalendarDays size={13} />
                แผนตรวจงานประจำวัน ({planSummary.targetDate})
              </span>
              <span className="px-2.5 py-0.5 bg-white/10 text-slate-300 rounded-md text-[11px] font-bold">
                SE ส่งงานก่อน 17:00 น.
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white flex items-center gap-3">
              <CalendarCheck2 className="text-purple-400" size={32} />
              แผนตรวจงานประจำวัน QC
            </h1>
            <p className="text-xs sm:text-sm text-purple-200/80 mt-1 max-w-2xl font-medium">
              จัดคิวตรวจงานอัตโนมัติจากที่ SE ส่งตรวจ • ระบบคำนวณแต้มถ่วงน้ำหนัก (Weighted Score) เพื่อความโปร่งใสและเป็นธรรม
            </p>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap">
            {/* View Mode Switcher */}
            <div className="bg-slate-800/80 p-1 rounded-2xl border border-purple-500/30 flex items-center">
              <button
                type="button"
                onClick={() => setViewMode('queue')}
                className={`px-3 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                  viewMode === 'queue'
                    ? 'bg-purple-600 text-white shadow-md'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                <ListTodo size={14} />
                <span>คิวตรวจประจำวัน</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('audit_calendar')}
                className={`px-3 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                  viewMode === 'audit_calendar'
                    ? 'bg-purple-600 text-white shadow-md'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                <BarChart3 size={14} />
                <span>ปฏิทินตรวจสอบภาระงาน</span>
              </button>
            </div>

            {/* Leave Request Button */}
            <button
              type="button"
              onClick={() => setIsLeaveModalOpen(true)}
              className="px-3.5 py-2.5 bg-slate-800/90 hover:bg-slate-700/90 text-slate-200 rounded-xl text-xs font-bold border border-slate-700 shadow-sm flex items-center gap-1.5 transition-all cursor-pointer"
            >
              <UserX size={14} className="text-amber-400" />
              <span>การลา QC</span>
            </button>

            {/* Weights Config Button */}
            {canConfigureWeights && (
              <button
                type="button"
                onClick={() => setIsWeightModalOpen(true)}
                className="px-3.5 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-bold shadow-md shadow-purple-900/30 flex items-center gap-1.5 transition-all cursor-pointer"
              >
                <Scale size={14} />
                <span>ตั้งค่าน้ำหนักแม่แบบ</span>
              </button>
            )}

            {/* Capacity Setting Button */}
            <button
              type="button"
              onClick={() => setIsCapacityModalOpen(true)}
              className="px-3.5 py-2.5 bg-gradient-to-r from-purple-600 via-indigo-600 to-indigo-700 hover:from-purple-700 hover:to-indigo-800 text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-900/30 flex items-center gap-1.5 transition-all cursor-pointer"
              title="วิเคราะห์ภาระงานย้อนหลัง (จันทร์–เสาร์) และกำหนดเกณฑ์ภาระงานรายวัน"
            >
              <Scale size={14} className="text-amber-300" />
              <span>เกณฑ์ภาระงาน ({dailyCapacityThreshold} แต้ม)</span>
            </button>
          </div>
        </div>
      </div>

      {/* 📊 Content Switcher 📊 */}
      {viewMode === 'audit_calendar' ? (
        <div className="bg-white rounded-3xl p-6 sm:p-8 shadow-sm border border-slate-200">
          <QCInspectionAuditCalendar
            planItems={monthlyPlanItems}
            projects={projectNames}
            currentUserRole={currentUserRole}
            currentUsername={loggedInUsername}
            allUpdatesRecord={allUpdatesRecord}
            taskWeightsMap={weightsMap}
            onThresholdChanged={newVal => setDailyCapacityThreshold(newVal)}
          />
        </div>
      ) : (
        <>
          {/* 4 Scorecards Row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs flex flex-col justify-between">
              <div className="flex items-center justify-between text-slate-500 mb-2">
                <span className="text-xs font-bold uppercase tracking-wider">งานในแผนวันนี้</span>
                <Layers size={18} className="text-slate-400" />
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-black text-slate-800">{planSummary.totalTasks}</span>
                <span className="text-xs text-slate-500 font-bold">รายการ</span>
              </div>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-purple-200 shadow-xs flex flex-col justify-between bg-gradient-to-br from-purple-50/50 to-white">
              <div className="flex items-center justify-between text-purple-700 mb-2">
                <span className="text-xs font-bold uppercase tracking-wider">แต้มรวมถ่วงน้ำหนัก</span>
                <Scale size={18} className="text-purple-500" />
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-black text-purple-700">{planSummary.totalPoints}</span>
                <span className="text-xs text-purple-600 font-bold">แต้มภาระงาน</span>
              </div>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-rose-200 shadow-xs flex flex-col justify-between bg-gradient-to-br from-rose-50/50 to-white">
              <div className="flex items-center justify-between text-rose-700 mb-2">
                <span className="text-xs font-bold uppercase tracking-wider">Hold Point สำคัญ</span>
                <Flame size={18} className="text-rose-500" />
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-black text-rose-600">{planSummary.holdPointsCount}</span>
                <span className="text-xs text-rose-500 font-bold">จุดวิกฤต</span>
              </div>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-amber-200 shadow-xs flex flex-col justify-between bg-gradient-to-br from-amber-50/50 to-white">
              <div className="flex items-center justify-between text-amber-700 mb-2">
                <span className="text-xs font-bold uppercase tracking-wider">ส่งหลัง 17:00 น.</span>
                <Clock size={18} className="text-amber-500" />
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-black text-amber-600">{planSummary.lateHandoffCount}</span>
                <span className="text-xs text-amber-500 font-bold">งานแทรกนอกรอบ</span>
              </div>
            </div>
          </div>

          {/* 🔍 Search & Filter Toolbar 🔍 */}
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2 flex-1">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                <input
                  type="text"
                  placeholder="ค้นหาแปลงบ้าน, ชื่องาน, โครงการ..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500"
                />
              </div>

              {projectNames.length > 0 && (
                <div className="flex items-center gap-1.5 shrink-0">
                  <Filter size={14} className="text-slate-400" />
                  <select
                    value={selectedProjectFilter}
                    onChange={(e) => setSelectedProjectFilter(e.target.value)}
                    className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-purple-500/20"
                  >
                    <option value="all">ทุกโครงการ ({planSummary.totalTasks})</option>
                    {projectNames.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Quick Filter Tabs */}
            <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0">
              <button
                type="button"
                onClick={() => setActiveTab('all')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-colors ${
                  activeTab === 'all'
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                ทั้งหมด ({planSummary.totalTasks})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('hold_point')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-colors flex items-center gap-1 ${
                  activeTab === 'hold_point'
                    ? 'bg-rose-600 text-white'
                    : 'bg-rose-50 text-rose-700 hover:bg-rose-100'
                }`}
              >
                <Flame size={12} />
                Hold Point ({planSummary.holdPointsCount})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('late')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-colors flex items-center gap-1 ${
                  activeTab === 'late'
                    ? 'bg-amber-600 text-white'
                    : 'bg-amber-50 text-amber-700 hover:bg-amber-100'
                }`}
              >
                <Clock size={12} />
                ส่งหลัง 17:00 ({planSummary.lateHandoffCount})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('rework')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-colors flex items-center gap-1 ${
                  activeTab === 'rework'
                    ? 'bg-blue-600 text-white'
                    : 'bg-blue-50 text-blue-700 hover:bg-blue-100'
                }`}
              >
                ตรวจซ้ำ ({planSummary.reworkCount})
              </button>
            </div>
          </div>

          {/* 📋 Task Cards List 📋 */}
          {filteredTasks.length === 0 ? (
            <div className="bg-white rounded-3xl p-12 text-center border border-slate-200/80 shadow-xs">
              <CheckCircle2 size={44} className="mx-auto text-emerald-500 mb-3" />
              <h3 className="text-base font-black text-slate-800">ไม่มีงานตรวจในแผนตามเงื่อนไขที่เลือก</h3>
              <p className="text-xs text-slate-500 mt-1">
                {searchQuery || selectedProjectFilter !== 'all' || activeTab !== 'all'
                  ? 'ลองเปลี่ยนตัวกรองหรือล้างคำค้นหา'
                  : 'ยังไม่มีงานที่ SE ส่งตรวจและยืนยันรอบในขณะนี้'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredTasks.map((task: QCInspectionTaskItem) => (
                <div
                  key={task.id}
                  className={`bg-white rounded-2xl p-5 border transition-all duration-200 hover:shadow-md flex flex-col justify-between ${
                    task.is_hold_point
                      ? 'border-rose-200 bg-gradient-to-br from-rose-50/20 via-white to-white'
                      : 'border-slate-200/80'
                  }`}
                >
                  <div>
                    {/* Top row: Plot tag & Weight badge */}
                    <div className="flex items-start justify-between gap-2 mb-2.5">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="px-2.5 py-1 bg-blue-100 text-blue-800 rounded-lg text-xs font-black flex items-center gap-1">
                          <Home size={12} />
                          <span>{task.plot_name}</span>
                        </span>
                        <span className="text-[11px] text-slate-500 font-bold truncate max-w-[140px] flex items-center gap-1">
                          <Building2 size={12} />
                          <span>{task.project_name}</span>
                        </span>
                      </div>

                      {/* Weight Points Badge */}
                      <span
                        className={`px-2.5 py-1 rounded-lg text-xs font-black shrink-0 ${
                          task.is_hold_point
                            ? 'bg-rose-500 text-white shadow-xs'
                            : task.weight_score >= 3
                            ? 'bg-indigo-600 text-white'
                            : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {task.weight_score} แต้ม {task.is_hold_point && '(Hold Point)'}
                      </span>
                    </div>

                    {/* Task Title */}
                    <h4 className="text-sm font-black text-slate-800 leading-snug mb-1">
                      {task.task_name}
                    </h4>

                    {/* Sub info */}
                    <div className="space-y-1 text-xs text-slate-500 mt-2">
                      <div className="flex items-center gap-1.5">
                        <Clock size={13} className="text-slate-400" />
                        <span>SE ส่งตรวจ: {task.se_handoff_time_str} น.</span>
                        {task.se_user_name && <span>({task.se_user_name})</span>}
                        {task.is_late_handoff && (
                          <span className="text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.2 rounded font-black">
                            ส่งหลัง 17:00
                          </span>
                        )}
                      </div>
                      {task.is_rejected && (
                        <div className="flex items-center gap-1.5 text-blue-600 font-bold">
                          <span>ตรวจซ้ำ (แก้ไขจากรอบก่อน)</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="mt-5 pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                    {canReassign && (
                      <button
                        type="button"
                        onClick={() => {
                          const converted: QCPlanItem = {
                            id: task.id,
                            plan_id: '',
                            plot_id: task.plot_id,
                            plot_name: task.plot_name,
                            project_name: task.project_name,
                            task_template_id: task.task_template_id,
                            task_name: task.task_name,
                            round_number: 1,
                            snapshot_weight_score: task.weight_score,
                            snapshot_is_hold_point: task.is_hold_point,
                            se_submitted_at: task.se_submitted_at,
                            se_submitted_by: task.se_user_name || '',
                            is_late_handoff: task.is_late_handoff,
                            due_date: task.target_inspection_date,
                            assigned_inspector_username: loggedInUsername,
                            plan_status: 'confirmed',
                            execution_status: 'pending',
                            earned_points: 0,
                            original_plan_date: task.target_inspection_date,
                          };
                          setSelectedTaskForStandIn(converted);
                        }}
                        className="px-2.5 py-1.5 rounded-lg text-xs font-bold text-slate-600 hover:text-slate-900 hover:bg-slate-100 flex items-center gap-1 transition-colors"
                      >
                        <UserCheck size={13} className="text-purple-600" />
                        <span>มอบหมายผู้ตรวจแทน</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => handleStartInspection(task)}
                      className="ml-auto px-3.5 py-1.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white rounded-xl text-xs font-bold shadow-xs flex items-center gap-1 transition-all cursor-pointer active:scale-95"
                    >
                      <span>เข้าตรวจงาน</span>
                      <ArrowRight size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ⚙️ Modals ⚙️ */}
      <QCTaskWeightConfigModal
        isOpen={isWeightModalOpen}
        onClose={() => setIsWeightModalOpen(false)}
        taskTemplates={taskTemplates}
        currentWeights={weightsMap}
        currentUserRole={currentUserRole}
        loggedInUsername={loggedInUsername}
        onSaved={handleWeightSaved}
      />

      <QCLeaveRequestModal
        isOpen={isLeaveModalOpen}
        onClose={() => setIsLeaveModalOpen(false)}
        loggedInUsername={loggedInUsername}
        currentUserRole={currentUserRole}
      />

      {selectedTaskForStandIn && (
        <QCStandInAssignmentModal
          isOpen={!!selectedTaskForStandIn}
          onClose={() => setSelectedTaskForStandIn(null)}
          planItem={selectedTaskForStandIn}
          loggedInUsername={loggedInUsername}
          currentUserRole={currentUserRole}
          existingItems={[]}
          onHandoverSuccess={() => {
            setSelectedTaskForStandIn(null);
          }}
        />
      )}

      <QCCapacityThresholdModal
        isOpen={isCapacityModalOpen}
        onClose={() => setIsCapacityModalOpen(false)}
        currentUserRole={currentUserRole}
        currentUsername={loggedInUsername}
        allUpdatesRecord={allUpdatesRecord}
        taskWeightsMap={weightsMap}
        onThresholdUpdated={newVal => setDailyCapacityThreshold(newVal)}
      />
    </div>
  );
}
