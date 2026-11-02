import React from 'react';
import { Lock, Calendar, Clock, Award, ShieldCheck, X, Loader2, Sparkles, AlertCircle } from 'lucide-react';

interface LockBaselineModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  plotName: string;
  projectName?: string;
  startDate: string;
  endDate: string;
  isSubmitting: boolean;
}

export default function LockBaselineModal({
  isOpen,
  onClose,
  onConfirm,
  plotName,
  projectName,
  startDate,
  endDate,
  isSubmitting
}: LockBaselineModalProps) {
  if (!isOpen) return null;

  const formatDate = (d: string) => {
    try {
      return new Date(d).toLocaleDateString('th-TH', { 
        day: 'numeric', 
        month: 'short', 
        year: '2-digit' 
      });
    } catch {
      return d;
    }
  };

  const calculateDays = () => {
    try {
      const s = new Date(startDate).getTime();
      const e = new Date(endDate).getTime();
      return Math.max(0, Math.ceil((e - s) / 86400000)) + 1;
    } catch {
      return 0;
    }
  };

  const totalDays = calculateDays();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden border border-slate-200 animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="bg-gradient-to-r from-indigo-600 via-indigo-700 to-blue-600 p-4 text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-white/20 rounded-xl backdrop-blur-xs text-white shadow-xs">
              <Lock className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-black text-base leading-tight">ล็อกแผนงานหลัก (Lock Baseline)</h3>
              <p className="text-xs text-indigo-100 font-medium">
                แปลง {plotName} {projectName ? `(${projectName})` : ''}
              </p>
            </div>
          </div>
          <button 
            type="button" 
            onClick={onClose} 
            disabled={isSubmitting}
            className="p-1.5 rounded-lg hover:bg-white/20 text-white/80 hover:text-white transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4">
          <p className="text-xs text-slate-600 leading-relaxed">
            ระบบจะกำหนดกรอบเวลาปัจจุบันของแปลงนี้เป็น <strong>เกณฑ์คะแนนหลัก (Baseline)</strong> สำหรับใช้ติดตามประสิทธิภาพการวางแผนงานก่อสร้าง
          </p>

          {/* Schedule Summary Card */}
          <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-2.5">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <span className="text-[10px] font-bold uppercase text-slate-400 block mb-0.5">วันเริ่มงาน</span>
                <div className="flex items-center gap-1.5 font-bold text-slate-800 text-xs sm:text-sm">
                  <Calendar size={14} className="text-indigo-500 shrink-0" />
                  <span>{formatDate(startDate)}</span>
                </div>
              </div>

              <div className="border-l border-slate-200 pl-3">
                <span className="text-[10px] font-bold uppercase text-indigo-500 block mb-0.5">วันสิ้นสุดโครงการ</span>
                <div className="flex items-center gap-1.5 font-black text-indigo-600 text-xs sm:text-sm">
                  <Calendar size={14} className="text-indigo-600 shrink-0" />
                  <span>{formatDate(endDate)}</span>
                </div>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-200/70 flex items-center justify-between text-xs">
              <span className="text-slate-500 font-medium flex items-center gap-1">
                <Clock size={13} className="text-slate-400" />
                ระยะเวลาก่อสร้างตามแผน:
              </span>
              <span className="font-black text-slate-800 bg-white px-2 py-0.5 rounded border border-slate-200">
                รวม {totalDays} วัน
              </span>
            </div>
          </div>

          {/* Initial Score Banner */}
          <div className="p-3 bg-gradient-to-r from-emerald-50 to-teal-50 rounded-xl border border-emerald-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-emerald-100 text-emerald-700 rounded-lg">
                <Award size={18} />
              </div>
              <div>
                <span className="text-xs font-black text-emerald-900 block leading-tight">คะแนนเริ่มต้น</span>
                <span className="text-[10px] text-emerald-700 font-medium">ระดับดีเยี่ยม (แผนตั้งต้น)</span>
              </div>
            </div>
            <span className="text-base font-black px-3 py-1 bg-emerald-600 text-white rounded-lg shadow-xs">
              100 คะแนน
            </span>
          </div>

          {/* Rules Explanation Note */}
          <div className="p-3 bg-indigo-50/60 rounded-xl border border-indigo-100 text-[11px] space-y-1 text-slate-700">
            <span className="font-black text-indigo-900 block flex items-center gap-1">
              <Sparkles size={12} className="text-indigo-600" />
              เกณฑ์การประเมินคะแนน (Ladder Step):
            </span>
            <ul className="list-disc list-inside space-y-0.5 text-slate-600 pl-1 text-[10px]">
              <li>ปรับแก้งานย่อยภายในแปลงโดยไม่เลื่อนวันสิ้นสุด: <strong>คง 100 คะแนน</strong></li>
              <li>หากมีการปรับขยายวันสิ้นสุดโครงการ: <strong>ลดคะแนนตามขั้น (75 ➔ 50 ➔ 25 ➔ 0)</strong></li>
              <li>กรณีเหตุสุดวิสัย / ปัจจัยภายนอก เจ้าของโครงการสามารถอนุมัติยกเว้นโทษได้</li>
            </ul>
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-50 cursor-pointer"
            >
              ยกเลิก
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={isSubmitting}
              className="flex-1 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-xs font-black text-white shadow-md shadow-indigo-600/30 transition-all disabled:opacity-50 flex items-center justify-center gap-1.5 cursor-pointer"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="animate-spin" size={14} />
                  <span>กำลังล็อก Baseline...</span>
                </>
              ) : (
                <>
                  <Lock size={14} />
                  <span>ยืนยันล็อก Baseline</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
