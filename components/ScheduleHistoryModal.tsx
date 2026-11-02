import React, { useEffect, useState } from 'react';
import { X, Calendar, Clock, Award, ShieldCheck, AlertCircle, Loader2, ArrowRight } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { getScoreBadgeStyle, parsePlotBaseline, exemptSchedulePenalty, PlotBaselineData } from '@/lib/plannerScoring';

interface ScheduleHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  plot: any;
  isAdminOrOwner: boolean;
  currentUserName: string;
  onRefresh?: () => void;
}

export default function ScheduleHistoryModal({
  isOpen,
  onClose,
  plot,
  isAdminOrOwner,
  currentUserName,
  onRefresh
}: ScheduleHistoryModalProps) {
  const [loading, setLoading] = useState(true);
  const [revisions, setRevisions] = useState<any[]>([]);
  const [exemptingId, setExemptingId] = useState<string | null>(null);
  const [plotData, setPlotData] = useState<any>(plot);

  useEffect(() => {
    setPlotData(plot);
  }, [plot]);

  useEffect(() => {
    if (!isOpen || !plot?.id) return;

    let isMounted = true;
    const fetchHistory = async () => {
      setLoading(true);
      try {
        // 1. Try querying plot_schedule_revisions table
        const { data: revData, error: revError } = await supabase
          .from('plot_schedule_revisions')
          .select('*')
          .eq('plot_id', plot.id)
          .order('created_at', { ascending: false });

        if (!revError && revData && revData.length > 0) {
          if (isMounted) setRevisions(revData);
        } else {
          // 2. Fallback to task_updates
          const { data: updData } = await supabase
            .from('task_updates')
            .select('*')
            .eq('plot_id', plot.id)
            .in('action', ['LOCK_BASELINE', 'REVISE_SCHEDULE', 'EXEMPT_SCHEDULE_PENALTY'])
            .order('created_at', { ascending: false });

          if (isMounted && updData) {
            const mapped = updData.map((u: any) => {
              let parsed: any = {};
              try { parsed = JSON.parse(u.text_content); } catch {}
              return {
                id: u.id,
                action: u.action,
                revised_by: u.user_name || u.role,
                previous_planned_end: parsed.previous_planned_end,
                new_planned_end: parsed.new_planned_end,
                diff_days: parsed.diff_days,
                previous_score: parsed.previous_score,
                new_score: parsed.new_score,
                reason: parsed.reason || parsed.message,
                is_exempted: u.action === 'EXEMPT_SCHEDULE_PENALTY',
                exempted_by: parsed.exempted_by,
                created_at: u.created_at
              };
            });
            setRevisions(mapped);
          }
        }
      } catch (err) {
        console.warn('Error fetching schedule revisions:', err);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchHistory();

    return () => { isMounted = false; };
  }, [isOpen, plot?.id]);

  if (!isOpen || !plot) return null;

  const baseline: PlotBaselineData = parsePlotBaseline(plotData);
  const scoreStyle = getScoreBadgeStyle(baseline.score);

  const formatDate = (d: string | null | undefined) => {
    if (!d) return '-';
    try {
      return new Date(d).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });
    } catch {
      return d;
    }
  };

  const formatDateTime = (d: string | null | undefined) => {
    if (!d) return '-';
    try {
      const dt = new Date(d);
      return `${dt.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })} ${dt.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.`;
    } catch {
      return d;
    }
  };

  const handleExempt = async (rev: any) => {
    if (!confirm('ยืนยันอนุมัติยกเว้นบทลงโทษ (เหตุสุดวิสัย / ปัจจัยภายนอก) สำหรับการปรับแผนนี้หรือไม่?\nคะแนนแผนงานจะได้รับการคืน +25 คะแนน')) {
      return;
    }

    setExemptingId(rev.id);
    try {
      const result = await exemptSchedulePenalty(
        supabase,
        plotData,
        baseline,
        rev.id,
        currentUserName,
        'อนุมัติเหตุสุดวิสัย'
      );

      if (result.success) {
        // Update local state
        setPlotData((prev: any) => ({
          ...prev,
          schedule_delay_revisions: result.newRevisions,
          schedule_planning_score: result.newScore
        }));

        setRevisions((prev) =>
          prev.map((r) =>
            r.id === rev.id
              ? { ...r, is_exempted: true, exempted_by: currentUserName }
              : r
          )
        );

        if (onRefresh) onRefresh();
      } else {
        alert(result.error || 'เกิดข้อผิดพลาดในการยกเว้นบทลงโทษ');
      }
    } finally {
      setExemptingId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl max-w-xl w-full overflow-hidden border border-slate-200 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="bg-slate-900 p-4 text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-indigo-500/20 rounded-xl text-indigo-400">
              <Award className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-black text-base leading-tight">ประวัติคะแนนและการปรับแผนงาน</h3>
              <p className="text-xs text-slate-400 font-medium">แปลง {plot.plot_name || plot.id} ({plot.project_name})</p>
            </div>
          </div>
          <button 
            type="button" 
            onClick={onClose} 
            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Current Score Summary Card */}
        <div className="p-4 bg-slate-50 border-b border-slate-200">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-[10px] font-bold uppercase text-slate-400 block mb-0.5">คะแนนการวางแผนปัจจุบัน</span>
              <div className="flex items-center gap-2">
                <span className={`px-2.5 py-1 rounded-lg text-sm font-black border flex items-center gap-1.5 shadow-xs ${scoreStyle.bg} ${scoreStyle.text} ${scoreStyle.border}`}>
                  <span className={`w-2 h-2 rounded-full ${scoreStyle.dot}`} />
                  {baseline.score} คะแนน
                </span>
                <span className="text-xs font-bold text-slate-600">({scoreStyle.grade})</span>
              </div>
            </div>

            <div className="text-right">
              <span className="text-[10px] font-bold uppercase text-slate-400 block mb-0.5">แผนงานหลัก (Baseline)</span>
              {baseline.isLocked ? (
                <div className="text-xs font-bold text-slate-800">
                  {formatDate(baseline.start)} - {formatDate(baseline.end)}
                  <span className="block text-[10px] font-medium text-slate-500">
                    ล็อกโดย {baseline.lockedBy} ({formatDate(baseline.lockedAt)})
                  </span>
                </div>
              ) : (
                <span className="text-xs font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                  ยังไม่ได้ล็อก Baseline
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Revisions Timeline List */}
        <div className="p-4 overflow-y-auto flex-1 space-y-3">
          <h4 className="text-xs font-black uppercase text-slate-500 tracking-wider flex items-center gap-1.5 mb-2">
            <Clock size={14} />
            ประวัติการปรับแผนงาน ({revisions.length} รายการ)
          </h4>

          {loading ? (
            <div className="py-12 flex flex-col items-center justify-center text-slate-400 gap-2">
              <Loader2 className="animate-spin" size={24} />
              <span className="text-xs font-bold">กำลังโหลดประวัติ...</span>
            </div>
          ) : revisions.length === 0 ? (
            <div className="py-12 text-center text-slate-400 bg-slate-50 rounded-xl border border-dashed border-slate-200">
              <Award className="mx-auto mb-2 text-slate-300" size={32} />
              <p className="text-xs font-bold text-slate-600">ยังไม่มีประวัติการขยายเวลาแผนงาน</p>
              <p className="text-[10px] text-slate-400 mt-0.5">แผนงานของแปลงนี้ยังรักษากรอบเวลาเดิมได้ 100%</p>
            </div>
          ) : (
            revisions.map((rev, idx) => (
              <div 
                key={rev.id || idx}
                className={`p-3.5 rounded-xl border transition-all ${
                  rev.is_exempted
                    ? 'bg-emerald-50/50 border-emerald-200'
                    : 'bg-white border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
                      ครั้งที่ {revisions.length - idx}
                    </span>
                    <span className="text-xs font-bold text-slate-700">{rev.revised_by || 'Project Planner'}</span>
                  </div>
                  <span className="text-[10px] text-slate-400 font-medium">
                    {formatDateTime(rev.created_at)}
                  </span>
                </div>

                {/* Date Extension Details */}
                {rev.new_planned_end && (
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-600 mb-2 bg-slate-50 p-2 rounded-lg border border-slate-100">
                    <Calendar size={13} className="text-slate-400" />
                    <span>{formatDate(rev.previous_planned_end)}</span>
                    <ArrowRight size={12} className="text-slate-400" />
                    <span className="text-rose-600">{formatDate(rev.new_planned_end)}</span>
                    {rev.diff_days && (
                      <span className="text-[10px] font-black bg-rose-100 text-rose-700 px-1.5 py-0.2 rounded">
                        +{rev.diff_days} วัน
                      </span>
                    )}
                  </div>
                )}

                {/* Reason */}
                {rev.reason && (
                  <p className="text-xs font-medium text-slate-700 mb-2 pl-2 border-l-2 border-slate-300">
                    <span className="font-bold text-slate-500 text-[10px] block">สาเหตุ:</span>
                    {rev.reason}
                  </p>
                )}

                {/* Score and Exemption Status */}
                <div className="flex items-center justify-between pt-1 border-t border-slate-100 mt-2">
                  <div className="flex items-center gap-2">
                    {rev.previous_score !== undefined && rev.new_score !== undefined && (
                      <span className="text-[10px] font-bold text-slate-500">
                        คะแนน: {rev.previous_score} ➔ {rev.new_score}
                      </span>
                    )}
                  </div>

                  {rev.is_exempted ? (
                    <div className="flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                      <ShieldCheck size={12} />
                      <span>ยกเว้นบทลงโทษแล้ว {rev.exempted_by ? `(โดย ${rev.exempted_by})` : ''}</span>
                    </div>
                  ) : isAdminOrOwner ? (
                    <button
                      type="button"
                      onClick={() => handleExempt(rev)}
                      disabled={exemptingId === rev.id}
                      className="inline-flex items-center gap-1 text-[10px] font-black text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 px-2.5 py-1 rounded-lg transition-colors disabled:opacity-50"
                      title="อนุมัติยกเว้นบทลงโทษเนื่องจากเหตุสุดวิสัย คืนคะแนน +25"
                    >
                      {exemptingId === rev.id ? (
                        <Loader2 className="animate-spin" size={12} />
                      ) : (
                        <ShieldCheck size={12} />
                      )}
                      <span>ยกเว้นบทลงโทษ (เหตุสุดวิสัย)</span>
                    </button>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="p-3 bg-slate-50 border-t border-slate-200 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-800 text-white text-xs font-bold hover:bg-slate-700 transition-colors"
          >
            ปิด
          </button>
        </div>
      </div>
    </div>
  );
}
