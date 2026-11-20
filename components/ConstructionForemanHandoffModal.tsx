import React, { useState, useMemo } from 'react';
import {
  X,
  UserCheck,
  ArrowRight,
  ShieldCheck,
  Clock,
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Info,
} from 'lucide-react';
import {
  PlotConstructionForemanInfo,
  executeConstructionForemanHandoff,
} from '@/lib/foremanHandoff';
import { supabase } from '@/lib/supabase';

interface ConstructionForemanHandoffModalProps {
  isOpen: boolean;
  onClose: () => void;
  plot: any;
  foremanInfo: PlotConstructionForemanInfo;
  foremenList: Array<{ id?: string; username?: string; name?: string; role?: string }>;
  currentUserName: string;
  onSuccess: (newForeman: string, previousForeman: string) => void;
  showAlert?: (title: string, message: string) => void;
  showToast?: (message: string) => void;
}

const QUICK_REASONS = [
  'เกลี่ยภาระงานให้สมดุล',
  'โฟร์แมนคนเดิมติดภารกิจ/ไม่สะดวก',
  'ลาพัก / สลับไซต์งาน',
  'งานโครงสร้างเสร็จแล้ว ส่งมอบต่องานสถาปัตย์',
];

export default function ConstructionForemanHandoffModal({
  isOpen,
  onClose,
  plot,
  foremanInfo,
  foremenList = [],
  currentUserName,
  onSuccess,
  showAlert,
  showToast,
}: ConstructionForemanHandoffModalProps) {
  const [selectedForeman, setSelectedForeman] = useState<string>('');
  const [mode, setMode] = useState<'takeover' | 'reassign_all'>('takeover');
  const [reason, setReason] = useState<string>('');
  const [showCompletedList, setShowCompletedList] = useState<boolean>(false);
  const [showPendingList, setShowPendingList] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Available foremen (excluding current foreman)
  const availableForemen = useMemo(() => {
    const currentLower = (foremanInfo.currentForeman || '').trim().toLowerCase();
    const list: string[] = [];
    foremenList.forEach(u => {
      const name = (u.username || u.name || '').trim();
      if (name && name.toLowerCase() !== currentLower && !list.some(n => n.toLowerCase() === name.toLowerCase())) {
        list.push(name);
      }
    });
    return list;
  }, [foremenList, foremanInfo.currentForeman]);

  if (!isOpen) return null;

  const handleSubmit = async () => {
    if (!selectedForeman) {
      if (showAlert) showAlert('แจ้งเตือน', 'กรุณาเลือกโฟร์แมนคนใหม่ที่จะรับผิดชอบแปลงนี้');
      else alert('กรุณาเลือกโฟร์แมนคนใหม่');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await executeConstructionForemanHandoff(supabase, {
        plotId: String(plot.id),
        incomingForeman: selectedForeman,
        currentForeman: foremanInfo.currentForeman,
        mode,
        reason: reason.trim() || undefined,
        actorName: currentUserName,
        foremanInfo,
      });

      if (!res.success) {
        throw new Error(res.error || 'เกิดข้อผิดพลาดในการเปลี่ยนโฟร์แมน');
      }

      if (showToast) {
        showToast(
          mode === 'takeover'
            ? `เปลี่ยนผู้รับผิดชอบเป็น "${selectedForeman}" เรียบร้อยแล้ว (งานที่เสร็จ ${foremanInfo.completedCount} งานยังคงเป็นของ ${foremanInfo.currentForeman || 'คนเดิม'})`
            : `เปลี่ยนผู้รับผิดชอบงานทั้งหมดเป็น "${selectedForeman}" เรียบร้อยแล้ว`
        );
      }

      onSuccess(selectedForeman, foremanInfo.currentForeman);
      onClose();
    } catch (err: any) {
      if (showAlert) showAlert('ข้อผิดพลาด', err.message || 'บันทึกการส่งมอบไม่สำเร็จ');
      else alert(err.message || 'บันทึกการส่งมอบไม่สำเร็จ');
    } finally {
      setIsSubmitting(false);
    }
  };

  const plotDisplayName = plot?.plot_name || plot?.name || `แปลง ${plot?.id}`;

  return (
    <div className="fixed inset-0 z-[99999] flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl shadow-2xl max-w-xl w-full max-h-[90vh] flex flex-col overflow-hidden border border-slate-200 animate-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-900 text-white p-5 sm:p-6 shrink-0 flex items-center justify-between border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center text-indigo-300 shadow-inner">
              <RefreshCw size={20} className={isSubmitting ? 'animate-spin' : ''} />
            </div>
            <div>
              <h3 className="font-bold text-lg sm:text-xl leading-tight">เปลี่ยนโฟร์แมนผู้รับผิดชอบ</h3>
              <p className="text-xs text-slate-300 mt-0.5">
                {plot?.project_name ? `${plot.project_name} • ` : ''}{plotDisplayName}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 active:scale-95 flex items-center justify-center text-white transition-all disabled:opacity-50"
            title="ปิด"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 sm:p-6 overflow-y-auto space-y-5 text-sm text-slate-700">
          
          {/* Current vs New Foreman banner */}
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 shadow-xs">
            {/* Current */}
            <div className="flex-1 bg-white p-3 rounded-xl border border-slate-200 shadow-2xs">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">โฟร์แมนปัจจุบัน</span>
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-600 font-bold text-xs">
                  {foremanInfo.currentForeman ? foremanInfo.currentForeman.charAt(0).toUpperCase() : '?'}
                </div>
                <div className="min-w-0">
                  <p className="font-bold text-slate-800 text-sm truncate">
                    {foremanInfo.currentForeman || 'ยังไม่ระบุ'}
                  </p>
                  {foremanInfo.previousForeman && (
                    <p className="text-[10px] text-slate-400 truncate">
                      รับช่วงจาก: <strong className="text-slate-600 font-semibold">{foremanInfo.previousForeman}</strong>
                    </p>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-center text-indigo-500 py-1">
              <ArrowRight size={20} className="hidden sm:block" />
              <ChevronDown size={20} className="block sm:hidden" />
            </div>

            {/* Target Selector */}
            <div className="flex-1 bg-indigo-50/60 p-3 rounded-xl border border-indigo-200 shadow-2xs">
              <label htmlFor="select-incoming-foreman" className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider block mb-1">
                โฟร์แมนคนใหม่ <span className="text-rose-500">*</span>
              </label>
              <select
                id="select-incoming-foreman"
                value={selectedForeman}
                onChange={e => setSelectedForeman(e.target.value)}
                disabled={isSubmitting}
                className="w-full bg-white border border-indigo-300 rounded-lg px-2.5 py-1.5 text-xs sm:text-sm font-semibold text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
              >
                <option value="">-- เลือกโฟร์แมนคนใหม่ --</option>
                {availableForemen.map(fm => (
                  <option key={fm} value={fm}>
                    {fm}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Smart Task Breakdown Preview */}
          <div className="space-y-3">
            <h4 className="font-bold text-slate-800 text-xs sm:text-sm flex items-center gap-1.5">
              <Info size={16} className="text-indigo-600" /> การแบ่งสถานะงานในแปลงนี้
            </h4>

            {/* 1. Finished & QC Passed */}
            <div className="bg-emerald-50/70 border border-emerald-200 rounded-2xl p-3.5 transition-all">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-sm mt-0.5">
                    <ShieldCheck size={18} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-bold text-emerald-950 text-sm">
                        งานที่เสร็จแล้ว & ผ่าน QC
                      </p>
                      <span className="bg-emerald-600 text-white text-[10px] px-2 py-0.5 rounded-full font-bold">
                        {foremanInfo.completedCount} งาน
                      </span>
                    </div>
                    <p className="text-xs text-emerald-800 mt-0.5 leading-relaxed">
                      {mode === 'takeover' ? (
                        <>
                          ระบบจะ <strong>ล็อกชื่อ {foremanInfo.currentForeman || 'คนเดิม'}</strong> ไว้ถาวร เพื่อให้ผลงานและประวัติ KPI ของคนเดิมถูกต้องครบถ้วน
                        </>
                      ) : (
                        <>
                          จะถูกเปลี่ยนเป็นชื่อ <strong>{selectedForeman || 'คนใหม่'}</strong> ตามโหมดที่เลือก
                        </>
                      )}
                    </p>
                  </div>
                </div>
                {foremanInfo.completedCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowCompletedList(!showCompletedList)}
                    className="text-emerald-700 hover:text-emerald-900 text-xs font-bold p-1 flex items-center gap-0.5 shrink-0"
                  >
                    {showCompletedList ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </button>
                )}
              </div>

              {showCompletedList && foremanInfo.completedCount > 0 && (
                <div className="mt-3 pt-3 border-t border-emerald-200 space-y-1.5 max-h-36 overflow-y-auto pr-1">
                  {foremanInfo.completedTasks.map(t => (
                    <div key={t.taskId} className="text-xs flex items-center justify-between bg-white/80 px-2.5 py-1.5 rounded-lg border border-emerald-200/60">
                      <span className="font-medium text-slate-700">#{t.taskOrder} {t.taskName}</span>
                      <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded">100% QC ผ่าน</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 2. Incomplete / Pending Tasks */}
            <div className="bg-amber-50/70 border border-amber-200 rounded-2xl p-3.5 transition-all">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-amber-500 text-white flex items-center justify-center shrink-0 shadow-sm mt-0.5">
                    <Clock size={18} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-bold text-amber-950 text-sm">
                        งานที่ยังไม่เสร็จ / ยังไม่ได้ทำ
                      </p>
                      <span className="bg-amber-500 text-white text-[10px] px-2 py-0.5 rounded-full font-bold">
                        {foremanInfo.pendingCount} งาน
                      </span>
                    </div>
                    <p className="text-xs text-amber-800 mt-0.5 leading-relaxed">
                      จะโอนย้ายไปเป็นความรับผิดชอบของ <strong>{selectedForeman || 'โฟร์แมนคนใหม่'}</strong> ทันที และจะแสดงในหน้ารายวันของคนใหม่
                    </p>
                  </div>
                </div>
                {foremanInfo.pendingCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowPendingList(!showPendingList)}
                    className="text-amber-700 hover:text-amber-900 text-xs font-bold p-1 flex items-center gap-0.5 shrink-0"
                  >
                    {showPendingList ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </button>
                )}
              </div>

              {showPendingList && foremanInfo.pendingCount > 0 && (
                <div className="mt-3 pt-3 border-t border-amber-200 space-y-1.5 max-h-36 overflow-y-auto pr-1">
                  {foremanInfo.pendingTasks.map(t => (
                    <div key={t.taskId} className="text-xs flex items-center justify-between bg-white/80 px-2.5 py-1.5 rounded-lg border border-amber-200/60">
                      <span className="font-medium text-slate-700">#{t.taskOrder} {t.taskName}</span>
                      <span className="text-[10px] font-bold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">
                        {t.currentProgress}% {t.qcStatus === 'rejected' ? '(สั่งแก้)' : t.qcStatus === 'pending' ? '(รอ QC)' : ''}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Mode Selector */}
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-2.5">
            <span className="text-xs font-bold text-slate-700 block">รูปแบบการโอนย้ายงาน:</span>
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="radio"
                name="handoff-mode"
                checked={mode === 'takeover'}
                onChange={() => setMode('takeover')}
                disabled={isSubmitting}
                className="mt-0.5 text-indigo-600 focus:ring-indigo-500"
              />
              <div>
                <span className="font-bold text-slate-800 text-xs sm:text-sm">
                  ส่งมอบงานต่อ (แนะนำ)
                </span>
                <p className="text-[11px] text-slate-500">
                  งานที่เสร็จและผ่าน QC แล้วจะยังเป็นชื่อคนเดิม ({foremanInfo.currentForeman || 'คนเดิม'}) โอนเฉพาะงานค้างและงานในอนาคตให้คนใหม่
                </p>
              </div>
            </label>

            <label className="flex items-start gap-2.5 cursor-pointer pt-1 border-t border-slate-200/70">
              <input
                type="radio"
                name="handoff-mode"
                checked={mode === 'reassign_all'}
                onChange={() => setMode('reassign_all')}
                disabled={isSubmitting}
                className="mt-0.5 text-indigo-600 focus:ring-indigo-500"
              />
              <div>
                <span className="font-bold text-slate-800 text-xs sm:text-sm">
                  แก้ไขผู้รับผิดชอบทั้งหมด
                </span>
                <p className="text-[11px] text-slate-500">
                  เปลี่ยนชื่อผู้รับผิดชอบทุกงานในแปลงนี้เป็นคนใหม่ (ใช้กรณีระบุชื่อผิดพลาดตั้งแต่ต้น)
                </p>
              </div>
            </label>
          </div>

          {/* Reason & Notes */}
          <div className="space-y-2">
            <label htmlFor="handoff-reason-input" className="text-xs font-bold text-slate-700 block">
              เหตุผลในการเปลี่ยนโฟร์แมน / หมายเหตุ:
            </label>
            <div className="flex flex-wrap gap-1.5 mb-1.5">
              {QUICK_REASONS.map(qr => (
                <button
                  key={qr}
                  type="button"
                  onClick={() => setReason(qr)}
                  disabled={isSubmitting}
                  className={`text-[10px] px-2 py-1 rounded-full font-semibold border transition-all ${
                    reason === qr
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200'
                  }`}
                >
                  {qr}
                </button>
              ))}
            </div>
            <textarea
              id="handoff-reason-input"
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="ระบุเหตุผล เช่น เกลี่ยภาระงานหน้างาน, งานแรกเสร็จส่งต่องานสถาปัตย์..."
              rows={2}
              disabled={isSubmitting}
              className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 text-xs text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 resize-none"
            />
          </div>
        </div>

        {/* Footer Actions */}
        <div className="bg-slate-50 p-4 sm:p-5 border-t border-slate-200 flex items-center justify-end gap-3 shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="px-4 py-2 text-xs sm:text-sm font-bold text-slate-600 hover:text-slate-800 hover:bg-slate-200 rounded-xl transition-all disabled:opacity-50"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting || !selectedForeman}
            className="px-5 py-2.5 text-xs sm:text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 active:scale-95 rounded-xl shadow-md hover:shadow-lg transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? (
              <>
                <RefreshCw size={16} className="animate-spin" />
                กำลังบันทึกการส่งมอบ...
              </>
            ) : (
              <>
                <UserCheck size={16} />
                ยืนยันการเปลี่ยนโฟร์แมน
              </>
            )}
          </button>
        </div>

      </div>
    </div>
  );
}
