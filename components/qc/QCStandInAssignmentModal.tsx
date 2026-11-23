'use client';
import React, { useState, useMemo, useEffect } from 'react';
import {
  X,
  UserCheck,
  AlertTriangle,
  CheckCircle2,
  Calendar,
  Building2,
  Home,
  Clock,
  ArrowRight,
  ShieldAlert,
  Flame,
} from 'lucide-react';
import {
  validateStandInCandidate,
  reassignTaskToStandIn,
  type CandidateValidationResult,
} from '@/lib/qc/qcLeaveAndStandInService';
import type { QCPlanItem } from '@/lib/qc/qcInspectionPlanService';
import { getQCCapacityThreshold } from '@/lib/qc/qcCapacitySettingService';

interface CandidateOption {
  username: string;
  role: string;
  name?: string;
}

interface QCStandInAssignmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  planItem: QCPlanItem;
  availableCandidates?: CandidateOption[];
  currentUserRole: string;
  loggedInUsername: string;
  existingItems?: QCPlanItem[];
  onHandoverSuccess?: (updatedItem: QCPlanItem) => void;
}

export default function QCStandInAssignmentModal({
  isOpen,
  onClose,
  planItem,
  availableCandidates = [],
  currentUserRole,
  loggedInUsername,
  existingItems = [],
  onHandoverSuccess,
}: QCStandInAssignmentModalProps) {
  const [selectedCandidate, setSelectedCandidate] = useState<string>('');
  const [handoverReason, setHandoverReason] = useState<string>('');
  const [completedScope, setCompletedScope] = useState<string>('');
  const [remainingScope, setRemainingScope] = useState<string>('');
  const [newDueDate, setNewDueDate] = useState<string>(planItem?.due_date || '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [capacityThreshold, setCapacityThreshold] = useState<number>(12);

  useEffect(() => {
    getQCCapacityThreshold().then(val => setCapacityThreshold(val));
  }, []);

  // Fallback candidate list if none provided
  const candidateList = useMemo(() => {
    if (availableCandidates.length > 0) return availableCandidates;
    return [
      { username: 'qc_inspector_1', role: 'QC', name: 'QC สมศักดิ์' },
      { username: 'qc_inspector_2', role: 'QC', name: 'QC ปราณี' },
      { username: 'qc_lead', role: 'Head QC', name: 'หัวหน้า QC ณรงค์' },
      { username: 'site_eng_1', role: 'Site Engineer', name: 'SE วิชัย (วิศวกรประจำโครงการ)' },
    ];
  }, [availableCandidates]);

  // Selected candidate object
  const selectedCandidateObj = useMemo(() => {
    return candidateList.find(c => c.username === selectedCandidate);
  }, [candidateList, selectedCandidate]);

  // Real-time Candidate Validation
  const validation: CandidateValidationResult | null = useMemo(() => {
    if (!selectedCandidateObj || !planItem) return null;
    return validateStandInCandidate({
      candidateUsername: selectedCandidateObj.username,
      candidateRole: selectedCandidateObj.role,
      planItem,
      existingItems,
      dailyPointCapacityThreshold: capacityThreshold,
    });
  }, [selectedCandidateObj, planItem, existingItems, capacityThreshold]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCandidateObj) {
      setErrorMsg('กรุณาเลือกผู้ตรวจแทน');
      return;
    }
    if (!handoverReason.trim()) {
      setErrorMsg('กรุณาระบุเหตุผลในการมอบหมายงานตรวจแทน');
      return;
    }

    if (validation && !validation.isValid) {
      setErrorMsg(validation.errors.join(' | '));
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);

    const res = await reassignTaskToStandIn({
      planItem,
      standInUsername: selectedCandidateObj.username,
      standInRole: selectedCandidateObj.role,
      actorUsername: loggedInUsername,
      actorRole: currentUserRole,
      handoverReason,
      completedScope,
      remainingScope,
      newDueDate: newDueDate !== planItem.due_date ? newDueDate : undefined,
      existingItems,
    });

    setIsSubmitting(false);

    if (res.success && res.updatedItem) {
      onHandoverSuccess?.(res.updatedItem);
      onClose();
    } else {
      setErrorMsg(res.error || 'เกิดข้อผิดพลาดในการมอบหมายผู้ตรวจแทน');
    }
  };

  if (!isOpen || !planItem) return null;

  return (
    <div className="fixed inset-0 z-[1250] flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl max-w-xl sm:max-w-2xl w-full p-5 sm:p-6 shadow-2xl border border-slate-200 flex flex-col max-h-[92vh] animate-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-100 shrink-0">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 bg-purple-50 text-purple-700 rounded-lg text-xs font-black border border-purple-200">
              <UserCheck size={13} />
              <span>มอบหมายผู้ตรวจแทน (Stand-in Assignment)</span>
            </div>
            <h3 className="text-base sm:text-lg font-black text-slate-900">
              โอนงานตรวจพร้อมบันทึกประวัติการส่งต่อ
            </h3>
            <p className="text-xs text-slate-500 font-medium">
              ผู้ตรวจเดิมยังคงได้รับเครดิตในส่วนที่ตรวจไปแล้ว • ตรวจสอบสิทธิ์และป้องกัน Conflict of Interest
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 transition-all cursor-pointer shrink-0"
          >
            <X size={20} />
          </button>
        </div>

        {/* Error Feedback */}
        {errorMsg && (
          <div className="p-3 my-2 rounded-xl text-xs font-bold bg-rose-50 text-rose-800 border border-rose-200 flex items-center gap-2 shrink-0">
            <AlertTriangle size={15} />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto custom-scrollbar pr-1 space-y-4 pt-2">
          
          {/* Target Task Summary Card */}
          <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="px-2 py-0.5 bg-blue-100 text-blue-800 rounded-md text-[10px] font-black border border-blue-200 flex items-center gap-1">
                  <Building2 size={11} />
                  <span>{planItem.project_name}</span>
                </span>
                <span className="px-2 py-0.5 bg-slate-200 text-slate-800 rounded-md text-[10px] font-black flex items-center gap-1">
                  <Home size={11} />
                  <span>{planItem.plot_name}</span>
                </span>
                {planItem.snapshot_is_hold_point && (
                  <span className="px-2 py-0.5 bg-rose-600 text-white rounded-lg text-[10px] font-black flex items-center gap-1">
                    <Flame size={11} />
                    <span>Hold Point</span>
                  </span>
                )}
              </div>

              <div className="text-[11px] font-black text-purple-700 bg-purple-100/80 px-2.5 py-0.5 rounded-lg border border-purple-200">
                {planItem.snapshot_weight_score ?? '-'} แต้มภาระงาน
              </div>
            </div>

            <div>
              <h4 className="text-xs font-black text-slate-900">{planItem.task_name}</h4>
              <p className="text-[10px] text-slate-500 pt-0.5">
                ผู้ตรวจปัจจุบัน: <span className="font-bold text-slate-700">{planItem.assigned_inspector_username || 'ยังไม่ระบุ'}</span> • กำหนดตรวจ: <span className="font-bold">{planItem.due_date}</span>
              </p>
              {planItem.se_submitted_by && (
                <p className="text-[10px] text-slate-500">
                  SE ผู้ส่งตรวจ: <span className="font-bold text-indigo-700">{planItem.se_submitted_by}</span> (ห้ามผู้ส่งตรวจเป็นผู้ตรวจแทน)
                </p>
              )}
            </div>
          </div>

          {/* Stand-in Candidate Selection */}
          <div>
            <label className="text-xs font-bold text-slate-700 block mb-1">
              เลือกผู้ตรวจแทน (Stand-in Candidate)
            </label>
            <select
              value={selectedCandidate}
              onChange={e => setSelectedCandidate(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-purple-400 cursor-pointer"
              required
            >
              <option value="">-- กรุณาเลือกผู้ตรวจแทน --</option>
              {candidateList.map(c => (
                <option key={c.username} value={c.username}>
                  {c.name ? `${c.name} (${c.username})` : c.username} — ตำแหน่ง: {c.role}
                </option>
              ))}
            </select>
          </div>

          {/* Real-time Validation Box */}
          {validation && (
            <div
              className={`p-3 rounded-2xl border text-xs space-y-1.5 ${
                !validation.isValid
                  ? 'bg-rose-50 border-rose-300 text-rose-900'
                  : validation.isOverloaded
                  ? 'bg-amber-50 border-amber-300 text-amber-900'
                  : 'bg-emerald-50 border-emerald-300 text-emerald-900'
              }`}
            >
              <div className="font-black flex items-center gap-1.5">
                {!validation.isValid ? (
                  <>
                    <ShieldAlert size={14} className="text-rose-600" />
                    <span>ไม่สามารถมอบหมายให้ผู้ใช้นี้ได้:</span>
                  </>
                ) : validation.isOverloaded ? (
                  <>
                    <AlertTriangle size={14} className="text-amber-600" />
                    <span>แจ้งเตือนภาระงานสูง:</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 size={14} className="text-emerald-600" />
                    <span>คุณสมบัติผ่านเกณฑ์การตรวจแทน:</span>
                  </>
                )}
              </div>

              {validation.errors.map((err, i) => (
                <p key={i} className="text-[11px] font-semibold text-rose-700 pl-5">
                  • {err}
                </p>
              ))}

              {validation.warnings.map((warn, i) => (
                <p key={i} className="text-[11px] font-semibold text-amber-800 pl-5">
                  • {warn}
                </p>
              ))}

              <div className="text-[10px] text-slate-600 pt-1 border-t border-slate-200/40 flex justify-between">
                <span>แต้มปัจจุบัน: {validation.currentPlannedPoints} แต้ม</span>
                <span>แต้มหลังรับงาน: {validation.postHandoverPoints} แต้ม</span>
              </div>
            </div>
          )}

          {/* Handover Reason */}
          <div>
            <label className="text-xs font-bold text-slate-700 block mb-1">
              เหตุผลในการส่งต่องาน (จำเป็นต้องระบุ)
            </label>
            <input
              type="text"
              value={handoverReason}
              onChange={e => setHandoverReason(e.target.value)}
              placeholder="เช่น QC ติดภารกิจลาพักร้อน, มอบหมายเพื่อเร่งตรวจงานเทปูน"
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:ring-2 focus:ring-purple-400 focus:outline-none placeholder:text-slate-400"
              required
            />
          </div>

          {/* Scope tracking */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1">
                ขอบเขตที่ตรวจไปแล้ว (ถ้ามี)
              </label>
              <input
                type="text"
                value={completedScope}
                onChange={e => setCompletedScope(e.target.value)}
                placeholder="เช่น ตรวจเหล็กแกนแล้ว"
                className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-purple-400"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1">
                ขอบเขตที่เหลือให้ตรวจแทน
              </label>
              <input
                type="text"
                value={remainingScope}
                onChange={e => setRemainingScope(e.target.value)}
                placeholder="เช่น ตรวจระยะทาบและทำความสะอาด"
                className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-purple-400"
              />
            </div>
          </div>

          {/* New Due Date (if rescheduling needed) */}
          <div>
            <label className="text-xs font-bold text-slate-700 block mb-1">
              กำหนดวันที่ตรวจ (ปรับเปลี่ยนได้หากผู้ตรวจแทนต้องเข้าวันอื่น)
            </label>
            <input
              type="date"
              value={newDueDate}
              onChange={e => setNewDueDate(e.target.value)}
              className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-purple-400"
            />
          </div>

          {/* Submit Button */}
          <div className="pt-2">
            <button
              type="submit"
              disabled={isSubmitting || (validation !== null && !validation.isValid)}
              className="w-full py-2.5 bg-purple-600 hover:bg-purple-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all shadow-xs cursor-pointer"
            >
              <UserCheck size={14} />
              <span>{isSubmitting ? 'กำลังบันทึกการส่งต่อ...' : 'ยืนยันการมอบหมายผู้ตรวจแทน'}</span>
            </button>
          </div>
        </form>

        {/* Footer */}
        <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500 shrink-0">
          <div className="text-[11px] text-slate-400">
            💡 ความล่าช้าก่อนการส่งต่อจะไม่ถูกนับเป็นความรับผิดชอบของผู้ตรวจแทน
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold cursor-pointer"
          >
            ปิด
          </button>
        </div>

      </div>
    </div>
  );
}
