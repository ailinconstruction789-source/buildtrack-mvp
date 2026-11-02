import React, { useState } from 'react';
import { AlertTriangle, Calendar, Clock, ArrowRight, ShieldAlert, X } from 'lucide-react';
import { getScoreBadgeStyle } from '@/lib/plannerScoring';

interface ScheduleRevisionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
  plotName: string;
  previousEnd: string;
  newEnd: string;
  diffDays: number;
  currentScore: number;
  nextScore: number;
  revisionCount: number;
  isSubmitting: boolean;
}

const QUICK_REASONS = [
  'ลูกค้าขอปรับเปลี่ยนแบบ / เพิ่มเติมงาน',
  'สภาพอากาศ / ฝนตกหนัก / ภัยธรรมชาติ',
  'ผู้รับเหมาทิ้งงาน / จัดหาช่างชุดใหม่',
  'วัสดุก่อสร้างขาดตลาด / ซัพพลายเออร์ส่งของช้า',
  'รอการอนุมัติแบบหรือใบอนุญาตจากหน่วยงานราชการ',
  'งานระบบสาธารณูปโภค (น้ำ-ไฟฟ้า) ล่าช้า',
  'อื่นๆ (ระบุในรายละเอียด)'
];

export default function ScheduleRevisionModal({
  isOpen,
  onClose,
  onConfirm,
  plotName,
  previousEnd,
  newEnd,
  diffDays,
  currentScore,
  nextScore,
  revisionCount,
  isSubmitting
}: ScheduleRevisionModalProps) {
  const [selectedQuickReason, setSelectedQuickReason] = useState(QUICK_REASONS[0]);
  const [customDetail, setCustomDetail] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  if (!isOpen) return null;

  const currentStyle = getScoreBadgeStyle(currentScore);
  const nextStyle = getScoreBadgeStyle(nextScore);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalReason = customDetail.trim() 
      ? `${selectedQuickReason}: ${customDetail.trim()}`
      : selectedQuickReason;

    if (!finalReason) {
      setErrorMsg('กรุณาระบุเหตุผลการปรับแผนงาน');
      return;
    }
    setErrorMsg('');
    await onConfirm(finalReason);
  };

  const formatDate = (d: string) => {
    try {
      return new Date(d).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });
    } catch {
      return d;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden border border-slate-200 animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="bg-gradient-to-r from-amber-500 to-rose-500 p-4 text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-white/20 rounded-xl backdrop-blur-xs">
              <AlertTriangle className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="font-black text-base leading-tight">ยืนยันการปรับขยายแผนงาน</h3>
              <p className="text-xs text-amber-100 font-medium">แปลง {plotName}</p>
            </div>
          </div>
          <button 
            type="button" 
            onClick={onClose} 
            disabled={isSubmitting}
            className="p-1.5 rounded-lg hover:bg-white/20 text-white/80 hover:text-white transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Comparison Cards */}
          <div className="grid grid-cols-2 gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
            <div>
              <span className="text-[10px] font-bold uppercase text-slate-400 block mb-0.5">วันสิ้นสุดเดิม</span>
              <div className="flex items-center gap-1.5 font-bold text-slate-700 text-xs sm:text-sm">
                <Calendar size={14} className="text-slate-400" />
                <span>{formatDate(previousEnd)}</span>
              </div>
            </div>
            <div className="border-l border-slate-200 pl-3">
              <span className="text-[10px] font-bold uppercase text-rose-500 block mb-0.5">วันสิ้นสุดใหม่</span>
              <div className="flex items-center gap-1.5 font-black text-rose-600 text-xs sm:text-sm">
                <Calendar size={14} className="text-rose-500" />
                <span>{formatDate(newEnd)}</span>
                <span className="text-[10px] bg-rose-100 text-rose-700 px-1.5 py-0.5 rounded-full font-bold">+{diffDays} วัน</span>
              </div>
            </div>
          </div>

          {/* Score Impact Banner */}
          <div className="p-3.5 bg-gradient-to-br from-rose-50 to-amber-50 rounded-xl border border-rose-200">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-slate-700 flex items-center gap-1">
                <Clock size={14} className="text-rose-500" />
                ผลกระทบคะแนนแผนงาน (ครั้งที่ {revisionCount})
              </span>
              <span className="text-[10px] font-bold text-rose-600 bg-rose-100 px-2 py-0.5 rounded-full">
                -25 คะแนน
              </span>
            </div>

            <div className="flex items-center justify-center gap-4 py-1">
              <div className="text-center">
                <span className="text-[10px] text-slate-400 font-bold block">คะแนนเดิม</span>
                <span className={`text-sm font-black px-3 py-1 rounded-lg border ${currentStyle.bg} ${currentStyle.text} ${currentStyle.border}`}>
                  {currentScore} คะแนน
                </span>
              </div>

              <ArrowRight className="text-slate-400 shrink-0" size={18} />

              <div className="text-center">
                <span className="text-[10px] text-rose-500 font-bold block">คะแนนใหม่</span>
                <span className={`text-sm font-black px-3 py-1 rounded-lg border shadow-xs ${nextStyle.bg} ${nextStyle.text} ${nextStyle.border}`}>
                  {nextScore} คะแนน
                </span>
              </div>
            </div>
          </div>

          {/* Reason Selection */}
          <div className="space-y-2">
            <label className="text-xs font-black text-slate-700 block">
              สาเหตุการปรับขยายเวลา <span className="text-rose-500">*</span>
            </label>
            <select
              value={selectedQuickReason}
              onChange={(e) => setSelectedQuickReason(e.target.value)}
              className="w-full text-xs font-bold bg-white border border-slate-300 rounded-xl px-3 py-2 text-slate-800 outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500"
            >
              {QUICK_REASONS.map((r, i) => (
                <option key={i} value={r}>{r}</option>
              ))}
            </select>

            <textarea
              rows={2}
              placeholder="ระบุรายละเอียดเพิ่มเติม เช่น เลขที่แบบแก้ไข หรือบันทึกข้อตกลง..."
              value={customDetail}
              onChange={(e) => setCustomDetail(e.target.value)}
              className="w-full text-xs font-medium bg-white border border-slate-300 rounded-xl p-2.5 text-slate-800 outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500 placeholder:text-slate-400"
            />
          </div>

          {errorMsg && (
            <p className="text-xs font-bold text-rose-600 bg-rose-50 p-2 rounded-lg border border-rose-200">
              {errorMsg}
            </p>
          )}

          <p className="text-[10px] text-slate-500 italic">
            * หมายเหตุ: หากเป็นเหตุสุดวิสัยหรือปัจจัยภายนอก เจ้าของโครงการ/Admin สามารถอนุมัติยกเว้นบทลงโทษได้ในภายหลัง
          </p>

          {/* Actions */}
          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-50"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-xs font-black text-white shadow-md shadow-rose-600/20 transition-all disabled:opacity-50 flex items-center justify-center gap-1.5"
            >
              {isSubmitting ? 'กำลังบันทึก...' : 'ยืนยันบันทึกการปรับแผน'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
