'use client';
import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  Sliders,
  Scale,
  Sparkles,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  ShieldCheck,
  Flame,
  BarChart2,
  Info,
  Calendar,
  Check,
} from 'lucide-react';
import {
  getQCCapacityThreshold,
  saveQCCapacityThreshold,
  analyzeQCHistoricalWorkload,
  type QCHistoricalCapacityAnalysis,
  type WeekdayWorkloadStat,
} from '@/lib/qc/qcCapacitySettingService';
import { canManageQCWeights, type QCTaskWeight } from '@/lib/qc/qcInspectionPlanService';

interface QCCapacityThresholdModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUserRole?: string;
  currentUsername?: string;
  allUpdatesRecord?: any[];
  taskWeightsMap?: Map<string, QCTaskWeight>;
  onThresholdUpdated?: (newThreshold: number) => void;
}

export default function QCCapacityThresholdModal({
  isOpen,
  onClose,
  currentUserRole = 'admin',
  currentUsername = 'admin',
  allUpdatesRecord = [],
  taskWeightsMap = new Map(),
  onThresholdUpdated,
}: QCCapacityThresholdModalProps) {
  const isAdmin = canManageQCWeights(currentUserRole);

  const [currentThreshold, setCurrentThreshold] = useState<number>(12);
  const [selectedThreshold, setSelectedThreshold] = useState<number>(12);
  const [lookbackDays, setLookbackDays] = useState<number>(60);
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Load existing threshold on modal open
  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    setSaveSuccess(false);
    setErrorMessage(null);

    getQCCapacityThreshold()
      .then(val => {
        setCurrentThreshold(val);
        setSelectedThreshold(val);
      })
      .catch(() => {
        setCurrentThreshold(12);
        setSelectedThreshold(12);
      })
      .finally(() => setLoading(false));
  }, [isOpen]);

  // Run historical workload analysis across Monday - Saturday
  const analysis: QCHistoricalCapacityAnalysis = useMemo(() => {
    return analyzeQCHistoricalWorkload({
      allUpdatesRecord,
      weightsMap: taskWeightsMap,
      lookbackDays,
    });
  }, [allUpdatesRecord, taskWeightsMap, lookbackDays]);

  if (!isOpen) return null;

  const handleSave = async () => {
    if (!isAdmin) {
      setErrorMessage('คุณไม่มีสิทธิ์ผู้ดูแลระบบ (Admin) ในการเปลี่ยนค่าเกณฑ์นี้');
      return;
    }

    setSaving(true);
    setErrorMessage(null);

    const result = await saveQCCapacityThreshold({
      threshold: selectedThreshold,
      actorUsername: currentUsername,
      actorRole: currentUserRole,
    });

    setSaving(false);
    if (result.success) {
      setCurrentThreshold(selectedThreshold);
      setSaveSuccess(true);
      onThresholdUpdated?.(selectedThreshold);
      setTimeout(() => {
        setSaveSuccess(false);
        onClose();
      }, 1200);
    } else {
      setErrorMessage(result.error || 'เกิดข้อผิดพลาดในการบันทึกค่า');
    }
  };

  const maxWeekdayAvg = Math.max(...analysis.weekdayStats.map(s => s.averagePointsPerDay), 1);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-100 w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="px-6 py-5 bg-gradient-to-r from-purple-700 via-indigo-700 to-indigo-900 text-white flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-white/10 backdrop-blur-md flex items-center justify-center border border-white/20 shadow-inner">
              <Scale size={22} className="text-amber-300" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-white tracking-wide">
                  ตั้งค่าภาระงานตรวจสูงสุดต่อวัน
                </h2>
                <span className="text-[11px] font-semibold bg-white/20 text-purple-100 px-2 py-0.5 rounded-full border border-white/25">
                  Admin Only
                </span>
              </div>
              <p className="text-xs text-purple-200 mt-0.5">
                วิเคราะห์สถิติภาระงานจริงในอดีต (จันทร์–เสาร์) และกำหนดเกณฑ์แต้มที่เหมาะสม
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-white/70 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 text-slate-700">
          
          {/* Admin Role Notice if not admin */}
          {!isAdmin && (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start gap-3 text-amber-800 text-xs">
              <AlertTriangle size={18} className="text-amber-600 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold">โหมดแสดงผลอย่างเดียว: </span>
                บัญชีของคุณไม่มีสิทธิ์ Admin ในการแก้ไขเกณฑ์ภาระงาน แต่สามารถดูผลการวิเคราะห์สถิติเพื่อใช้อ้างอิงได้
              </div>
            </div>
          )}

          {/* Historical Analytics Section */}
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <BarChart2 size={18} className="text-indigo-600" />
                <h3 className="font-bold text-slate-800 text-sm">
                  ผลการวิเคราะห์ภาระงานจริงย้อนหลัง (Historical Workload)
                </h3>
              </div>

              {/* Lookback Filter */}
              <div className="flex items-center gap-1.5 text-xs">
                <span className="text-slate-400">ช่วงเวลาย้อนหลัง:</span>
                {[30, 60, 90].map(days => (
                  <button
                    key={days}
                    type="button"
                    onClick={() => setLookbackDays(days)}
                    className={`px-2.5 py-1 rounded-lg font-semibold transition-all ${
                      lookbackDays === days
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {days} วัน
                  </button>
                ))}
              </div>
            </div>

            {/* Quick Metrics Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-slate-50 border border-slate-100 rounded-2xl p-3 text-center">
                <p className="text-[11px] text-slate-400 font-medium">ตรวจแล้วทั้งหมด</p>
                <p className="text-lg font-black text-slate-800 mt-0.5">
                  {analysis.totalQCInspections}{' '}
                  <span className="text-xs font-normal text-slate-500">งาน</span>
                </p>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  {analysis.totalQCPoints} แต้มสะสม
                </p>
              </div>

              <div className="bg-indigo-50/60 border border-indigo-100 rounded-2xl p-3 text-center">
                <p className="text-[11px] text-indigo-500 font-medium">เฉลี่ยต่อวันทำงาน</p>
                <p className="text-lg font-black text-indigo-700 mt-0.5">
                  {analysis.overallAveragePointsPerDay}{' '}
                  <span className="text-xs font-normal text-indigo-500">แต้ม/วัน</span>
                </p>
                <p className="text-[10px] text-indigo-400 mt-0.5">
                  เฉลี่ยจากวันที่ตรวจจริง
                </p>
              </div>

              <div className="bg-amber-50/70 border border-amber-100 rounded-2xl p-3 text-center">
                <p className="text-[11px] text-amber-600 font-medium">วันที่มีงานหนาแน่นสุด</p>
                <p className="text-lg font-black text-amber-700 mt-0.5">
                  วัน{analysis.peakWeekday}
                </p>
                <p className="text-[10px] text-amber-500 mt-0.5">
                  Peak Weekday
                </p>
              </div>

              <div className="bg-emerald-50/60 border border-emerald-100 rounded-2xl p-3 text-center">
                <p className="text-[11px] text-emerald-600 font-medium">ตรวจได้สูงสุดใน 1 วัน</p>
                <p className="text-lg font-black text-emerald-700 mt-0.5">
                  {analysis.overallMaxSingleDayPoints}{' '}
                  <span className="text-xs font-normal text-emerald-500">แต้ม</span>
                </p>
                <p className="text-[10px] text-emerald-500 mt-0.5">
                  Max Daily Throughput
                </p>
              </div>
            </div>

            {/* 6 Weekdays Breakdown (Monday to Saturday) */}
            <div className="bg-slate-50/70 rounded-2xl p-4 border border-slate-200/80 space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-slate-700 flex items-center gap-1.5">
                  <Calendar size={14} className="text-indigo-500" />
                  การกระจายภาระงานเฉลี่ยแยกตามวัน (จันทร์ – เสาร์)
                </span>
                <span className="text-[11px] text-slate-400">
                  (ไม่รวมวันอาทิตย์ที่เป็นวันหยุด)
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
                {analysis.weekdayStats.map(stat => {
                  const isPeak = stat.dayName === analysis.peakWeekday && stat.averagePointsPerDay > 0;
                  const barHeightPct = maxWeekdayAvg > 0 
                    ? Math.round((stat.averagePointsPerDay / maxWeekdayAvg) * 100) 
                    : 10;

                  return (
                    <div
                      key={stat.dayIndex}
                      className={`relative rounded-xl p-2.5 flex flex-col justify-between transition-all border ${
                        isPeak
                          ? 'bg-amber-50/90 border-amber-300 shadow-sm'
                          : 'bg-white border-slate-200/90'
                      }`}
                    >
                      {isPeak && (
                        <span className="absolute -top-2 right-1.5 bg-amber-500 text-white text-[9px] font-black px-1.5 py-0.2 rounded-full shadow-sm flex items-center gap-0.5">
                          <Flame size={10} /> Peak
                        </span>
                      )}

                      <div className="text-center">
                        <p className={`text-xs font-bold ${isPeak ? 'text-amber-800' : 'text-slate-700'}`}>
                          {stat.dayAbbr}
                        </p>
                        <p className="text-[10px] text-slate-400">
                          {stat.dayName}
                        </p>
                      </div>

                      {/* Visual mini bar */}
                      <div className="my-2 h-12 flex items-end justify-center">
                        <div
                          className={`w-4 rounded-t-md transition-all duration-500 ${
                            isPeak
                              ? 'bg-gradient-to-t from-amber-400 to-amber-500'
                              : 'bg-gradient-to-t from-indigo-300 to-indigo-500'
                          }`}
                          style={{ height: `${Math.max(barHeightPct, 15)}%` }}
                        />
                      </div>

                      <div className="text-center pt-1 border-t border-slate-100">
                        <p className={`text-sm font-black ${isPeak ? 'text-amber-700' : 'text-indigo-600'}`}>
                          {stat.averagePointsPerDay}
                        </p>
                        <p className="text-[9px] text-slate-400">
                          แต้มเฉลี่ย
                        </p>
                        <p className="text-[9px] text-slate-400 mt-0.5">
                          {stat.totalInspections} งาน ({stat.activeDaysCount} วัน)
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* AI / System Recommendation Banner */}
            <div className="bg-gradient-to-r from-purple-50 via-indigo-50 to-blue-50 border border-purple-200/80 rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="p-2 bg-purple-600 text-white rounded-xl shadow-sm shrink-0">
                  <Sparkles size={18} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-bold text-purple-900">
                      คำแนะนำระบบจากการวิเคราะห์สถิติ:
                    </p>
                    <span className="text-xs font-black bg-purple-200/80 text-purple-900 px-2 py-0.5 rounded-full">
                      แนะนำ {analysis.recommendedThreshold} แต้ม/วัน
                    </span>
                  </div>
                  <p className="text-[11px] text-purple-700/90 mt-1 leading-relaxed">
                    {analysis.recommendationReason}
                  </p>
                </div>
              </div>

              {isAdmin && selectedThreshold !== analysis.recommendedThreshold && (
                <button
                  type="button"
                  onClick={() => setSelectedThreshold(analysis.recommendedThreshold)}
                  className="shrink-0 px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold rounded-xl shadow-sm transition-all"
                >
                  เลือก {analysis.recommendedThreshold} แต้ม
                </button>
              )}
            </div>
          </div>

          {/* Admin Setting Form */}
          <div className="border-t border-slate-100 pt-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold text-slate-800 text-sm flex items-center gap-1.5">
                  <Sliders size={16} className="text-indigo-600" />
                  กำหนดเกณฑ์ภาระงานตรวจต่อวัน (แต้ม/คน/วัน)
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  ระบบจะใช้เกณฑ์นี้ในการแสดงสีส้มเตือนภาระงานเกินกำลังในปฏิทิน และตรวจสอบการมอบหมายงานแทน
                </p>
              </div>

              <div className="text-right">
                <span className="text-[11px] text-slate-400">เกณฑ์ปัจจุบัน: </span>
                <span className="text-sm font-black text-slate-700 bg-slate-100 px-2.5 py-0.5 rounded-lg">
                  {currentThreshold} แต้ม
                </span>
              </div>
            </div>

            {/* Presets */}
            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-400 text-xs font-medium">ค่าแนะนำยอดนิยม:</span>
              {[10, 12, 14, 16].map(val => (
                <button
                  key={val}
                  type="button"
                  disabled={!isAdmin}
                  onClick={() => setSelectedThreshold(val)}
                  className={`px-3 py-1.5 rounded-xl font-bold transition-all ${
                    selectedThreshold === val
                      ? 'bg-indigo-600 text-white shadow-sm ring-2 ring-indigo-300'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {val} แต้ม
                </button>
              ))}
            </div>

            {/* Stepper & Slider */}
            <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="w-full sm:flex-1 space-y-2">
                <div className="flex justify-between text-xs font-medium text-slate-500">
                  <span>6 แต้ม (ผ่อนคลาย)</span>
                  <span className="font-bold text-indigo-600">
                    {selectedThreshold} แต้ม/วัน
                  </span>
                  <span>30 แต้ม (เข้มข้นสูง)</span>
                </div>
                <input
                  type="range"
                  min="6"
                  max="30"
                  step="1"
                  disabled={!isAdmin}
                  value={selectedThreshold}
                  onChange={e => setSelectedThreshold(parseInt(e.target.value, 10))}
                  className="w-full accent-indigo-600 cursor-pointer disabled:cursor-not-allowed"
                />
              </div>

              {/* Number display / stepper */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={!isAdmin || selectedThreshold <= 6}
                  onClick={() => setSelectedThreshold(prev => Math.max(6, prev - 1))}
                  className="w-9 h-9 rounded-xl bg-white border border-slate-200 hover:bg-slate-100 font-bold text-slate-700 flex items-center justify-center disabled:opacity-40 transition-colors"
                >
                  -
                </button>
                <div className="w-16 h-10 bg-white border-2 border-indigo-500 rounded-xl flex items-center justify-center text-lg font-black text-indigo-700 shadow-inner">
                  {selectedThreshold}
                </div>
                <button
                  type="button"
                  disabled={!isAdmin || selectedThreshold >= 30}
                  onClick={() => setSelectedThreshold(prev => Math.min(30, prev + 1))}
                  className="w-9 h-9 rounded-xl bg-white border border-slate-200 hover:bg-slate-100 font-bold text-slate-700 flex items-center justify-center disabled:opacity-40 transition-colors"
                >
                  +
                </button>
              </div>
            </div>

            {/* Feedback messages */}
            {errorMessage && (
              <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-xl p-3 text-xs flex items-center gap-2">
                <AlertTriangle size={16} />
                <span>{errorMessage}</span>
              </div>
            )}

            {saveSuccess && (
              <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl p-3 text-xs flex items-center gap-2 font-bold animate-in fade-in">
                <CheckCircle2 size={16} />
                <span>บันทึกการตั้งค่าเกณฑ์ภาระงานเรียบร้อยแล้ว</span>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
          <p className="text-[11px] text-slate-400">
            * เกณฑ์นี้จะถูกบันทึกในตาราง <code className="text-slate-600 font-mono">qc_system_settings</code> และมีผลทันที
          </p>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-200 rounded-xl transition-colors"
            >
              ปิดหน้าต่าง
            </button>

            {isAdmin && (
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || selectedThreshold === currentThreshold}
                className="px-5 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed rounded-xl shadow-md transition-all flex items-center gap-1.5"
              >
                {saving ? (
                  <span>กำลังบันทึก...</span>
                ) : (
                  <>
                    <Check size={14} />
                    <span>บันทึกเกณฑ์ {selectedThreshold} แต้ม</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
