import React, { useState } from 'react';
import { AlertTriangle, Calendar, Clock, ArrowRight, ShieldCheck, X, User, HardHat, Info } from 'lucide-react';
import { getScoreBadgeStyle } from '@/lib/plannerScoring';

interface ScheduleRevisionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (reason: string, options?: { isExempt: boolean; revisionType: string }) => Promise<void>;
  plotName: string;
  previousEnd: string;
  newEnd: string;
  diffDays: number;
  currentScore: number;
  nextScore: number;
  revisionCount: number;
  isSubmitting: boolean;
  foremanName?: string;
  siteEngineerName?: string;
}

const REVISION_TYPES = [
  {
    type: 'normal_delay',
    label: 'หน้างานล่าช้าทั่วไป (Site Delay)',
    description: 'งานหน้างานล่าช้ากว่าแผนงานหลักปกติ (หัก 25 คะแนนจากโฟร์แมน)',
    defaultExempt: false
  },
  {
    type: 'force_majeure',
    label: 'สภาพอากาศ / ฝนตกหนัก / ภัยธรรมชาติ (Force Majeure)',
    description: 'เหตุสุดวิสัยที่ไม่สามารถควบคุมได้ (ขอยกเว้นการหักคะแนน คะแนนคงเดิม)',
    defaultExempt: true
  },
  {
    type: 'procurement_delay',
    label: 'จัดซื้อ / ผู้รับเหมาทิ้งงาน / ช่างขาดแคลน',
    description: 'ปัญหาจัดจ้างหรือวัสดุก่อสร้างขาดตลาด (ขอยกเว้นการหักคะแนน)',
    defaultExempt: true
  },
  {
    type: 'customer_change',
    label: 'ลูกค้าขอปรับเปลี่ยนแบบ / เพิ่มเติมงาน',
    description: 'การขยายเวลาตามความประสงค์ของลูกค้า (ขอยกเว้นการหักคะแนน)',
    defaultExempt: true
  },
  {
    type: 'design_delay',
    label: 'รอการอนุมัติแบบ / งานสาธารณูปโภค (น้ำ-ไฟฟ้า)',
    description: 'รอใบอนุญาตราชการหรือแบบสถาปัตย์ (ขอยกเว้นการหักคะแนน)',
    defaultExempt: true
  },
  {
    type: 'other',
    label: 'อื่นๆ (ระบุในรายละเอียด)',
    description: 'สาเหตุอื่นๆ โปรดระบุเพิ่มเติม',
    defaultExempt: false
  }
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
  isSubmitting,
  foremanName,
  siteEngineerName
}: ScheduleRevisionModalProps) {
  const [selectedType, setSelectedType] = useState(REVISION_TYPES[0].type);
  const [isExempt, setIsExempt] = useState(false);
  const [customDetail, setCustomDetail] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  if (!isOpen) return null;

  const handleTypeChange = (typeVal: string) => {
    setSelectedType(typeVal);
    const item = REVISION_TYPES.find(t => t.type === typeVal);
    if (item) {
      setIsExempt(item.defaultExempt);
    }
  };

  const effectiveNextScore = isExempt ? currentScore : nextScore;
  const currentStyle = getScoreBadgeStyle(currentScore);
  const nextStyle = getScoreBadgeStyle(effectiveNextScore);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const typeObj = REVISION_TYPES.find(t => t.type === selectedType);
    const typeLabel = typeObj ? typeObj.label : selectedType;
    const finalReason = customDetail.trim() 
      ? `${typeLabel}: ${customDetail.trim()}`
      : typeLabel;

    if (!finalReason) {
      setErrorMsg('กรุณาระบุเหตุผลการปรับแผนงาน');
      return;
    }
    setErrorMsg('');
    await onConfirm(finalReason, {
      isExempt,
      revisionType: selectedType
    });
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
      <div className="bg-white rounded-3xl shadow-2xl max-w-lg w-full overflow-hidden border border-slate-200 animate-in zoom-in-95 duration-200 flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="bg-gradient-to-r from-amber-500 via-orange-500 to-rose-500 p-4 text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-white/20 rounded-2xl backdrop-blur-xs">
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
            className="p-1.5 rounded-xl hover:bg-white/20 text-white/80 hover:text-white transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto">
          {/* Comparison Cards */}
          <div className="grid grid-cols-2 gap-3 p-3 bg-slate-50 rounded-2xl border border-slate-200">
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

          {/* Personnel in charge */}
          <div className="grid grid-cols-2 gap-2 text-xs bg-slate-50 p-2.5 rounded-xl border border-slate-200 text-slate-600">
            <div className="flex items-center gap-1.5 truncate">
              <HardHat size={14} className="text-amber-500 shrink-0" />
              <span className="text-slate-400">โฟร์แมน:</span>
              <span className="font-bold text-slate-800 truncate">{foremanName || 'ยังไม่ระบุ'}</span>
            </div>
            <div className="flex items-center gap-1.5 truncate border-l border-slate-200 pl-2">
              <User size={14} className="text-blue-500 shrink-0" />
              <span className="text-slate-400">SE:</span>
              <span className="font-bold text-slate-800 truncate">{siteEngineerName || 'วิศวกรส่วนกลาง'}</span>
            </div>
          </div>

          {/* Reason Selection */}
          <div className="space-y-1.5">
            <label className="text-xs font-black text-slate-700 block">
              สาเหตุการขยายเวลาส่งมอบ <span className="text-rose-500">*</span>
            </label>
            <select
              value={selectedType}
              onChange={(e) => handleTypeChange(e.target.value)}
              className="w-full text-xs font-bold bg-white border border-slate-300 rounded-xl px-3 py-2 text-slate-800 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 cursor-pointer"
            >
              {REVISION_TYPES.map((t) => (
                <option key={t.type} value={t.type}>{t.label}</option>
              ))}
            </select>
            <p className="text-[11px] text-slate-500 font-medium">
              {REVISION_TYPES.find(t => t.type === selectedType)?.description}
            </p>

            <textarea
              rows={2}
              placeholder="ระบุรายละเอียดเพิ่มเติม เช่น บันทึกหน้างาน หรือเลขที่เอกสาร..."
              value={customDetail}
              onChange={(e) => setCustomDetail(e.target.value)}
              className="w-full text-xs font-medium bg-white border border-slate-300 rounded-xl p-2.5 text-slate-800 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 placeholder:text-slate-400 mt-1"
            />
          </div>

          {/* Exemption Checkbox (Rule 6) */}
          <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-2xl space-y-1.5">
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={isExempt}
                onChange={(e) => setIsExempt(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded text-amber-600 focus:ring-amber-500 border-slate-300"
              />
              <div className="text-xs">
                <span className="font-black text-amber-950 flex items-center gap-1">
                  <ShieldCheck size={14} className="text-amber-600" />
                  ขอยกเว้นการหักคะแนน (เหตุสุดวิสัย / ปัจจัยภายนอก)
                </span>
                <p className="text-[11px] text-amber-800/90 mt-0.5">
                  ตามข้อตกลง: หากได้รับการยกเว้น คะแนนของโฟร์แมนจะ<strong>คงที่เท่าเดิม ({currentScore} คะแนน)</strong> ไม่โดนหักเพิ่ม 25 คะแนน
                </p>
              </div>
            </label>
          </div>

          {/* Score Impact Banner */}
          <div className={`p-3.5 rounded-2xl border ${isExempt ? 'bg-emerald-50/80 border-emerald-200' : 'bg-gradient-to-br from-rose-50 to-amber-50 border-rose-200'}`}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-slate-700 flex items-center gap-1">
                <Clock size={14} className={isExempt ? 'text-emerald-600' : 'text-rose-500'} />
                ผลกระทบคะแนนแผนงาน (ครั้งที่ {revisionCount})
              </span>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${isExempt ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                {isExempt ? 'คงคะแนนเดิม (ไม่หัก)' : '-25 คะแนน'}
              </span>
            </div>

            <div className="flex items-center justify-center gap-4 py-1">
              <div className="text-center">
                <span className="text-[10px] text-slate-400 font-bold block">คะแนนเดิม</span>
                <span className={`text-xs sm:text-sm font-black px-2.5 py-1 rounded-lg border ${currentStyle.bg} ${currentStyle.text} ${currentStyle.border}`}>
                  {currentScore} คะแนน
                </span>
              </div>

              <ArrowRight className="text-slate-400 shrink-0" size={16} />

              <div className="text-center">
                <span className={`text-[10px] font-bold block ${isExempt ? 'text-emerald-600' : 'text-rose-500'}`}>
                  {isExempt ? 'คะแนนคงที่' : 'คะแนนใหม่'}
                </span>
                <span className={`text-xs sm:text-sm font-black px-2.5 py-1 rounded-lg border shadow-xs ${nextStyle.bg} ${nextStyle.text} ${nextStyle.border}`}>
                  {effectiveNextScore} คะแนน
                </span>
              </div>
            </div>
          </div>

          {errorMsg && (
            <p className="text-xs font-bold text-rose-600 bg-rose-50 p-2.5 rounded-xl border border-rose-200">
              {errorMsg}
            </p>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-50 cursor-pointer"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className={`flex-1 px-4 py-2.5 rounded-xl text-xs font-black text-white shadow-md transition-all disabled:opacity-50 flex items-center justify-center gap-1.5 cursor-pointer ${
                isExempt ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/20' : 'bg-rose-600 hover:bg-rose-700 shadow-rose-600/20'
              }`}
            >
              {isSubmitting ? 'กำลังบันทึก...' : isExempt ? 'ยืนยันบันทึก (ยกเว้นคะแนน)' : 'ยืนยันบันทึก (หัก 25 คะแนน)'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
