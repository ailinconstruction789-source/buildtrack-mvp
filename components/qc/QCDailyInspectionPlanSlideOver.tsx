'use client';
import React, { useState, useMemo, useEffect } from 'react';
import {
  X,
  Calendar,
  AlertTriangle,
  Flame,
  CheckCircle2,
  Clock,
  Layers,
  Search,
  Building2,
  Home,
  ArrowRight,
  Filter,
  ShieldAlert,
  Sparkles,
  Scale,
  UserX,
  UserCheck,
} from 'lucide-react';
import {
  buildQCDailyInspectionPlan,
  type QCInspectionTaskItem,
  type QCDailyPlanSummary,
} from '@/lib/qcInspectionPlan';
import {
  canManageQCWeights,
  getQCTaskWeights,
  type QCTaskWeight,
  type QCPlanItem,
} from '@/lib/qc/qcInspectionPlanService';
import { canAssignStandIn } from '@/lib/qc/qcLeaveAndStandInService';
import QCTaskWeightConfigModal from './QCTaskWeightConfigModal';
import QCLeaveRequestModal from './QCLeaveRequestModal';
import QCStandInAssignmentModal from './QCStandInAssignmentModal';

interface QCDailyInspectionPlanSlideOverProps {
  isOpen: boolean;
  onClose: () => void;
  inspectionQueue: any[];
  taskTemplates?: any[];
  plots?: any[];
  todayDateStr?: string;
  onSelectTask?: (item: QCInspectionTaskItem) => void;
  currentUserRole?: string;
  loggedInUsername?: string;
  currentWeights?: Map<string, QCTaskWeight>;
  onWeightsUpdated?: () => void;
}

export default function QCDailyInspectionPlanSlideOver({
  isOpen,
  onClose,
  inspectionQueue = [],
  taskTemplates = [],
  plots = [],
  todayDateStr,
  onSelectTask,
  currentUserRole,
  loggedInUsername,
  currentWeights,
  onWeightsUpdated,
}: QCDailyInspectionPlanSlideOverProps) {
  const [activeTab, setActiveTab] = useState<'all' | 'hold_point' | 'late' | 'rework'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProjectFilter, setSelectedProjectFilter] = useState('all');
  const [weightsMap, setWeightsMap] = useState<Map<string, QCTaskWeight>>(currentWeights || new Map());
  const [isWeightModalOpen, setIsWeightModalOpen] = useState(false);
  const [isLeaveModalOpen, setIsLeaveModalOpen] = useState(false);
  const [selectedTaskForStandIn, setSelectedTaskForStandIn] = useState<QCPlanItem | null>(null);

  useEffect(() => {
    if (currentWeights && currentWeights.size > 0) {
      setWeightsMap(currentWeights);
    } else {
      getQCTaskWeights().then(map => setWeightsMap(map));
    }
  }, [currentWeights]);

  const handleWeightSaved = async () => {
    const updated = await getQCTaskWeights();
    setWeightsMap(updated);
    onWeightsUpdated?.();
  };

  // Compute daily inspection plan
  const planSummary: QCDailyPlanSummary = useMemo(() => {
    return buildQCDailyInspectionPlan({
      inspectionQueue,
      taskTemplates,
      plots,
      todayDateStr,
      targetProject: selectedProjectFilter,
      weightsMap,
    });
  }, [inspectionQueue, taskTemplates, plots, todayDateStr, selectedProjectFilter, weightsMap]);

  // Project options for dropdown
  const projectOptions = useMemo(() => {
    const set = new Set<string>();
    (inspectionQueue || []).forEach(q => {
      const p = q.project_name || q.projectName;
      if (p && !p.toLowerCase().includes('demo')) {
        set.add(p);
      }
    });
    return Array.from(set);
  }, [inspectionQueue]);

  // Filter tasks based on tab & search query
  const filteredTasks = useMemo(() => {
    return planSummary.tasks.filter(t => {
      // Tab filter
      if (activeTab === 'hold_point' && !t.is_hold_point) return false;
      if (activeTab === 'late' && !t.is_late_handoff) return false;
      if (activeTab === 'rework' && !t.is_rejected) return false;

      // Search filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const mTask = t.task_name.toLowerCase().includes(q);
        const mPlot = t.plot_name.toLowerCase().includes(q);
        const mProj = t.project_name.toLowerCase().includes(q);
        const mFm = (t.foreman_name || '').toLowerCase().includes(q);
        if (!mTask && !mPlot && !mProj && !mFm) return false;
      }

      return true;
    });
  }, [planSummary.tasks, activeTab, searchQuery]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[1000] overflow-hidden bg-slate-900/60 backdrop-blur-xs flex justify-end animate-in fade-in duration-200">
      <div className="relative w-full max-w-md sm:max-w-xl bg-white h-full shadow-2xl flex flex-col justify-between animate-in slide-in-from-right duration-300">
        
        {/* Header */}
        <div className="p-4 sm:p-5 bg-gradient-to-r from-purple-700 via-indigo-700 to-blue-700 text-white flex items-start justify-between gap-3 shrink-0 shadow-md">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 bg-white/15 backdrop-blur-md rounded-full text-[11px] font-black tracking-wide border border-white/20">
              <Calendar size={13} />
              <span>{planSummary.targetDateLabel}</span>
            </div>
            <h3 className="text-base sm:text-lg font-black tracking-tight flex items-center gap-2">
              <span>แผนตรวจงานประจำวัน QC</span>
              <span className="text-[10px] bg-white/20 px-2 py-0.5 rounded-full font-bold">
                Slide Function
              </span>
            </h3>
            <p className="text-xs text-purple-100 font-medium">
              จัดคิวตรวจงานอัตโนมัติจากที่ SE ส่งตรวจ • คิวงานถ่วงน้ำหนัก (Weighted Score)
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {canManageQCWeights(currentUserRole) && (
              <button
                type="button"
                onClick={() => setIsWeightModalOpen(true)}
                className="px-2.5 py-1.5 text-white/90 hover:text-white rounded-xl hover:bg-white/20 transition-all cursor-pointer flex items-center gap-1.5 text-xs font-bold bg-white/10"
                title="ตั้งค่าน้ำหนักแม่แบบงานตรวจ"
              >
                <Scale size={14} />
                <span className="hidden sm:inline">ตั้งค่าน้ำหนัก</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setIsLeaveModalOpen(true)}
              className="px-2.5 py-1.5 text-white/90 hover:text-white rounded-xl hover:bg-white/20 transition-all cursor-pointer flex items-center gap-1.5 text-xs font-bold bg-white/10"
              title="จัดการคำขอลาและตรวจสอบวันลา"
            >
              <UserX size={14} />
              <span className="hidden sm:inline">การลา</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-white/80 hover:text-white rounded-xl hover:bg-white/10 transition-all cursor-pointer shrink-0"
              title="ปิดหน้าต่าง"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-4 sm:p-5 space-y-4">
          
          {/* Workload Scorecards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
            {/* Total Tasks */}
            <div className="bg-slate-50 p-2.5 rounded-2xl border border-slate-200">
              <p className="text-[10px] text-slate-500 font-bold">งานตามแผน</p>
              <p className="text-xl font-black text-slate-800">{planSummary.totalTasks}</p>
              <p className="text-[9px] text-slate-400">รายการในคิว</p>
            </div>

            {/* Total Points */}
            <div className="bg-purple-50 p-2.5 rounded-2xl border border-purple-200">
              <p className="text-[10px] text-purple-700 font-bold flex items-center justify-center gap-1">
                <Sparkles size={11} />
                <span>แต้มภาระงาน</span>
              </p>
              <p className="text-xl font-black text-purple-800">{planSummary.totalPoints}</p>
              <p className="text-[9px] text-purple-600 font-semibold">แต้มรวมถ่วงน้ำหนัก</p>
            </div>

            {/* Hold Points */}
            <div className="bg-rose-50 p-2.5 rounded-2xl border border-rose-200">
              <p className="text-[10px] text-rose-700 font-bold flex items-center justify-center gap-1">
                <Flame size={11} />
                <span>Hold Point</span>
              </p>
              <p className="text-xl font-black text-rose-700">{planSummary.holdPointsCount}</p>
              <p className="text-[9px] text-rose-600 font-semibold">งานโครงสร้างด่วน</p>
            </div>

            {/* Late Handoff */}
            <div className="bg-amber-50 p-2.5 rounded-2xl border border-amber-200">
              <p className="text-[10px] text-amber-700 font-bold flex items-center justify-center gap-1">
                <Clock size={11} />
                <span>ส่งหลัง 17:00</span>
              </p>
              <p className="text-xl font-black text-amber-700">{planSummary.lateHandoffCount}</p>
              <p className="text-[9px] text-amber-600 font-semibold">รอบตรวจถัดไป</p>
            </div>
          </div>

          {/* Project Dropdown & Search Bar */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              {projectOptions.length > 0 && (
                <div className="relative shrink-0">
                  <select
                    value={selectedProjectFilter}
                    onChange={e => setSelectedProjectFilter(e.target.value)}
                    className="bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-purple-400 cursor-pointer"
                  >
                    <option value="all">🏢 ทุกโครงการ</option>
                    {projectOptions.map(p => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Search Bar */}
              <div className="relative flex-1">
                <Search size={14} className="absolute left-3 top-2.5 text-slate-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="ค้นหาชื่องาน, แปลงบ้าน, หรือโครงการ..."
                  className="w-full pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:ring-2 focus:ring-purple-400 focus:outline-none transition-all placeholder:text-slate-400"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
            </div>

            {/* Filter Tabs */}
            <div className="flex items-center gap-1 overflow-x-auto custom-scrollbar pb-1 text-[11px] font-bold">
              <button
                type="button"
                onClick={() => setActiveTab('all')}
                className={`px-3 py-1 rounded-xl transition-all shrink-0 cursor-pointer ${
                  activeTab === 'all'
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                ทั้งหมด ({planSummary.totalTasks})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('hold_point')}
                className={`px-3 py-1 rounded-xl transition-all shrink-0 cursor-pointer flex items-center gap-1 ${
                  activeTab === 'hold_point'
                    ? 'bg-rose-600 text-white shadow-xs'
                    : 'bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200'
                }`}
              >
                <Flame size={12} />
                <span>Hold Point ({planSummary.holdPointsCount})</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('late')}
                className={`px-3 py-1 rounded-xl transition-all shrink-0 cursor-pointer flex items-center gap-1 ${
                  activeTab === 'late'
                    ? 'bg-amber-600 text-white shadow-xs'
                    : 'bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200'
                }`}
              >
                <Clock size={12} />
                <span>ส่งหลังรอบ ({planSummary.lateHandoffCount})</span>
              </button>
              {planSummary.reworkCount > 0 && (
                <button
                  type="button"
                  onClick={() => setActiveTab('rework')}
                  className={`px-3 py-1 rounded-xl transition-all shrink-0 cursor-pointer flex items-center gap-1 ${
                    activeTab === 'rework'
                      ? 'bg-orange-600 text-white shadow-xs'
                      : 'bg-orange-50 text-orange-700 hover:bg-orange-100 border border-orange-200'
                  }`}
                >
                  <AlertTriangle size={12} />
                  <span>ตีกลับตรวจซ้ำ ({planSummary.reworkCount})</span>
                </button>
              )}
            </div>
          </div>

          {/* Task List */}
          <div className="space-y-2.5">
            {filteredTasks.length === 0 ? (
              <div className="py-12 text-center text-xs text-slate-400 space-y-2 border border-dashed border-slate-200 rounded-3xl">
                <CheckCircle2 size={28} className="mx-auto text-emerald-500 opacity-60" />
                <p className="font-bold text-slate-600">ไม่มีรายการงานที่ตรงกับตัวกรอง</p>
                <p className="text-[11px] text-slate-400">คิวงานตรวจในหมวดนี้เคลียร์ครบถ้วนแล้ว</p>
              </div>
            ) : (
              filteredTasks.map((task, idx) => {
                const isTopPriority = task.is_hold_point;
                return (
                  <div
                    key={task.id}
                    onClick={() => onSelectTask?.(task)}
                    className={`p-3.5 rounded-2xl border transition-all space-y-2.5 ${
                      isTopPriority
                        ? 'bg-rose-50/40 border-rose-200 hover:border-rose-300 hover:shadow-xs'
                        : task.is_late_handoff
                        ? 'bg-amber-50/30 border-amber-200 hover:border-amber-300'
                        : 'bg-slate-50/80 hover:bg-white border-slate-200 hover:border-purple-300 hover:shadow-xs'
                    } ${onSelectTask ? 'cursor-pointer' : ''}`}
                  >
                    {/* Row 1: Priority, Badges, Weight Score */}
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="px-2 py-0.5 bg-blue-100 text-blue-800 rounded-md text-[10px] font-black border border-blue-200 flex items-center gap-1">
                          <Building2 size={11} />
                          <span>{task.project_name}</span>
                        </span>
                        <span className="px-2 py-0.5 bg-slate-200 text-slate-800 rounded-md text-[10px] font-black flex items-center gap-1">
                          <Home size={11} />
                          <span>{task.plot_name}</span>
                        </span>
                        {task.foreman_name && (
                          <span className="text-[10px] font-bold text-slate-500">
                            โฟร์แมน: {task.foreman_name}
                          </span>
                        )}
                      </div>

                      {/* Weight Score Badge */}
                      <div className="flex items-center gap-1.5 shrink-0">
                        {task.is_hold_point ? (
                          <span className="px-2 py-0.5 bg-rose-600 text-white rounded-lg text-[10px] font-black flex items-center gap-1 shadow-2xs">
                            <Flame size={11} />
                            <span>{task.weight_score} แต้ม (Hold Point)</span>
                          </span>
                        ) : task.category === 'system' ? (
                          <span className="px-2 py-0.5 bg-orange-100 text-orange-800 border border-orange-300 rounded-lg text-[10px] font-black">
                            {task.weight_score} แต้ม (ระบบ)
                          </span>
                        ) : task.category === 'minor' ? (
                          <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 border border-emerald-300 rounded-lg text-[10px] font-black">
                            {task.weight_score} แต้ม (งานย่อย)
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 bg-purple-100 text-purple-800 border border-purple-300 rounded-lg text-[10px] font-black">
                            {task.weight_score} แต้ม (สถาปัตย์)
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Row 2: Task Name */}
                    <div>
                      <h4 className="text-xs font-black text-slate-900 leading-snug">
                        {task.task_name}
                      </h4>
                    </div>

                    {/* Row 3: Timestamps & Meta */}
                    <div className="flex items-center justify-between text-[10px] text-slate-500 pt-1 border-t border-slate-200/60 flex-wrap gap-2">
                      <div className="flex items-center gap-1">
                        <Clock size={12} className="text-slate-400" />
                        <span>SE ส่งตรวจ: {task.se_handoff_time_str} น.</span>
                        {task.se_user_name && <span>({task.se_user_name})</span>}
                      </div>

                      <div className="flex items-center gap-1.5">
                        {task.is_late_handoff ? (
                          <span className="text-amber-700 font-bold bg-amber-100/80 px-1.5 py-0.5 rounded text-[9px]">
                            ส่งหลังรอบ 17:00
                          </span>
                        ) : (
                          <span className="text-emerald-700 font-bold bg-emerald-100/80 px-1.5 py-0.5 rounded text-[9px]">
                            ตรวจตามแผนพรุ่งนี้
                          </span>
                        )}
                        {onSelectTask && (
                          <ArrowRight size={13} className="text-slate-400 hover:text-purple-600 transition-colors" />
                        )}
                      </div>
                    </div>

                    {/* Row 4: Stand-in Handover & Action Bar */}
                    <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200/40">
                      {canAssignStandIn(currentUserRole) && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            const planItem: any = {
                              id: task.id,
                              plot_id: task.plot_id,
                              plot_name: task.plot_name,
                              project_name: task.project_name,
                              task_template_id: task.task_template_id,
                              task_name: task.task_name,
                              round_number: 1,
                              snapshot_weight_score: task.weight_score,
                              snapshot_is_hold_point: task.is_hold_point,
                              se_submitted_at: task.se_submitted_at,
                              se_submitted_by: task.se_user_name,
                              is_late_handoff: task.is_late_handoff,
                              due_date: task.target_inspection_date,
                              assigned_inspector_username: task.foreman_name || 'QC',
                              plan_status: 'confirmed',
                              execution_status: 'pending',
                              earned_points: 0,
                              original_plan_date: task.target_inspection_date,
                            };
                            setSelectedTaskForStandIn(planItem);
                          }}
                          className="px-2.5 py-1 text-[10px] font-bold text-purple-700 bg-purple-50 hover:bg-purple-100 border border-purple-200 rounded-lg flex items-center gap-1 transition-all cursor-pointer"
                        >
                          <UserCheck size={12} />
                          <span>มอบหมายผู้ตรวจแทน</span>
                        </button>
                      )}
                      {onSelectTask && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectTask(task);
                          }}
                          className="px-3 py-1 text-[10px] font-bold text-white bg-purple-600 hover:bg-purple-700 rounded-lg flex items-center gap-1 transition-all shadow-2xs cursor-pointer"
                        >
                          <span>เข้าตรวจงาน</span>
                          <ArrowRight size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Footer Info */}
        <div className="p-3.5 sm:p-4 bg-slate-50 border-t border-slate-200 shrink-0 flex items-center justify-between gap-3 text-xs">
          <div className="text-[11px] text-slate-500 font-medium">
            💡 งานโครงสร้าง/Hold Point มีแต้มสูงและถูกจัดให้อยู่บนสุดเพื่อป้องกันงานคอขวด
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold rounded-xl text-xs transition-colors cursor-pointer shrink-0"
          >
            ปิด
          </button>
        </div>

      </div>

      {/* QC Task Weight Configuration Modal */}
      {isWeightModalOpen && (
        <QCTaskWeightConfigModal
          isOpen={isWeightModalOpen}
          onClose={() => setIsWeightModalOpen(false)}
          taskTemplates={taskTemplates}
          currentWeights={weightsMap}
          currentUserRole={currentUserRole || 'Admin'}
          loggedInUsername={loggedInUsername || 'user'}
          onSaved={handleWeightSaved}
        />
      )}

      {/* QC Leave Management Modal */}
      {isLeaveModalOpen && (
        <QCLeaveRequestModal
          isOpen={isLeaveModalOpen}
          onClose={() => setIsLeaveModalOpen(false)}
          currentUserRole={currentUserRole || 'QC'}
          loggedInUsername={loggedInUsername || 'user'}
        />
      )}

      {/* QC Stand-in Assignment Modal */}
      {selectedTaskForStandIn && (
        <QCStandInAssignmentModal
          isOpen={Boolean(selectedTaskForStandIn)}
          onClose={() => setSelectedTaskForStandIn(null)}
          planItem={selectedTaskForStandIn}
          currentUserRole={currentUserRole || 'Admin'}
          loggedInUsername={loggedInUsername || 'user'}
        />
      )}
    </div>
  );
}
