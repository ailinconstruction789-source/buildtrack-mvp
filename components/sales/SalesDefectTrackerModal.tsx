'use client';

import React, { useState } from 'react';
import { Calendar, Camera, CheckCircle, HardHat, Search, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import SalesOverlay from './SalesOverlay';

export interface PlotDefectTrackerData {
  defects: any[];
  defectUpdatesMap: Record<string, any[]>;
  taskUpdatesMap: Record<string, any[]>;
}

export const EMPTY_PLOT_DEFECT_DATA: PlotDefectTrackerData = {
  defects: [],
  defectUpdatesMap: {},
  taskUpdatesMap: {},
};

export async function fetchPlotDefectTrackerData(plot: any): Promise<PlotDefectTrackerData> {
  if (!plot?.id) return EMPTY_PLOT_DEFECT_DATA;

  try {
    const plotId = String(plot.id);
    const { data: defectsData } = await supabase
      .from('defects')
      .select('*')
      .eq('plot_id', plotId);

    const plotCycle = plot.handover_cycle ?? null;
    const filteredDefects = (Array.isArray(defectsData) ? defectsData : []).filter(
      (d: any) => (d.handover_cycle ?? null) === plotCycle
    );

    const defectIds = filteredDefects.map((d: any) => d.id).filter(Boolean);
    const defectUpdatesMap: Record<string, any[]> = {};
    const taskUpdatesMap: Record<string, any[]> = {};

    if (defectIds.length > 0) {
      const { data: defectUpdates } = await supabase
        .from('defect_updates')
        .select('defect_id, image_urls, note, created_at, created_by')
        .in('defect_id', defectIds);

      (Array.isArray(defectUpdates) ? defectUpdates : []).forEach((du: any) => {
        if (du.image_urls) {
          if (!defectUpdatesMap[du.defect_id]) defectUpdatesMap[du.defect_id] = [];
          defectUpdatesMap[du.defect_id].push(du);
        }
      });
    }

    const { data: taskUpdatesData } = await supabase
      .from('task_updates')
      .select('plot_id, task_template_id, image_url')
      .eq('plot_id', plotId);

    (Array.isArray(taskUpdatesData) ? taskUpdatesData : []).forEach((tu: any) => {
      if (tu.image_url) {
        const key = `${tu.plot_id}_${tu.task_template_id}`;
        if (!taskUpdatesMap[key]) taskUpdatesMap[key] = [];
        taskUpdatesMap[key].push(tu);
      }
    });

    return {
      defects: filteredDefects,
      defectUpdatesMap,
      taskUpdatesMap,
    };
  } catch (err) {
    console.error('Error fetching plot defect tracker data:', err);
    return EMPTY_PLOT_DEFECT_DATA;
  }
}

interface SalesDefectTrackerModalProps {
  plot: any | null;
  plotDefects: any[];
  defectUpdatesMap: Record<string, any[]>;
  taskUpdatesMap: Record<string, any[]>;
  onClose: () => void;
}

export default function SalesDefectTrackerModal({
  plot,
  plotDefects,
  defectUpdatesMap,
  taskUpdatesMap,
  onClose,
}: SalesDefectTrackerModalProps) {
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  if (!plot) return null;

  const total = plotDefects.length;
  const completed = plotDefects.filter((d: any) => (d.progress || 0) >= 100 || d.status === 'resolved').length;
  const inProgress = plotDefects.filter((d: any) => (d.progress || 0) > 0 && (d.progress || 0) < 100).length;
  const pending = total - completed - inProgress;
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <>
      {/* 🔍 MODAL: SALES READ-ONLY DEFECT PUNCHLIST TRACKER */}
      <SalesOverlay className="fixed inset-0 bg-black/75 z-[300] flex items-center justify-center p-3 sm:p-6">
        <div className="bg-white rounded-3xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden animate-fade-in">
          {/* Header */}
          <div className="bg-slate-900 text-white p-5 flex justify-between items-center shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-purple-500/20 border border-purple-400/30 flex items-center justify-center text-purple-300">
                <Search size={22} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-black uppercase text-purple-400 tracking-widest bg-purple-950 px-2 py-0.5 rounded border border-purple-800">
                    Sales Read-Only Tracker
                  </span>
                </div>
                <h3 className="font-black text-lg sm:text-xl text-white leading-tight">
                  แผนเก็บงาน & ติดตามการแก้ไข (Defects Punchlist) — แปลง {plot.plot_name || plot.id} ({plot.project_name || ''})
                </h3>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white rounded-full transition-colors cursor-pointer"
              aria-label="ปิดหน้าต่าง"
            >
              <X size={22} />
            </button>
          </div>

          {/* Content Body */}
          <div className="p-5 overflow-y-auto space-y-6 flex-1 custom-scrollbar bg-slate-50">
            {/* Summary Stats */}
            <div className="space-y-4">
              {/* Progress Summary Card */}
              <div className="bg-white rounded-2xl p-5 shadow-xs border border-slate-200 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
                  <div>
                    <h4 className="font-extrabold text-sm text-slate-800">สรุปความคืบหน้าการซ่อมแก้ไข</h4>
                    <p className="text-xs text-slate-500 font-bold">รายการซ่อมทั้งหมด {total} รายการ</p>
                  </div>

                  <span
                    className={`text-xs font-black px-3 py-1.5 rounded-xl border ${
                      percent === 100
                        ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                        : 'bg-amber-100 text-amber-800 border-amber-300'
                    }`}
                  >
                    {percent === 100 ? '🟢 ซ่อมเรียบร้อย 100%' : `🟡 ซ่อมเสร็จแล้ว ${percent}% (${completed}/${total})`}
                  </span>
                </div>

                {/* Progress Bar */}
                <div className="w-full bg-slate-200 h-2.5 rounded-full overflow-hidden">
                  <div className="bg-emerald-500 h-full transition-all duration-500" style={{ width: `${percent}%` }}></div>
                </div>

                <div className="grid grid-cols-3 gap-3 text-center text-xs font-bold pt-1">
                  <div className="bg-emerald-50 text-emerald-800 p-2 rounded-xl border border-emerald-200">
                    <span className="block text-[10px] text-emerald-600">ซ่อมเสร็จแล้ว</span>
                    <strong className="text-sm font-black">{completed} รายการ</strong>
                  </div>
                  <div className="bg-amber-50 text-amber-800 p-2 rounded-xl border border-amber-200">
                    <span className="block text-[10px] text-amber-600">กำลังดำเนินการซ่อม</span>
                    <strong className="text-sm font-black">{inProgress} รายการ</strong>
                  </div>
                  <div className="bg-rose-50 text-rose-800 p-2 rounded-xl border border-rose-200">
                    <span className="block text-[10px] text-rose-600">รอดำเนินการซ่อม</span>
                    <strong className="text-sm font-black">{pending} รายการ</strong>
                  </div>
                </div>
              </div>
            </div>

            {/* Defects List Cards (Strict Per-Defect Item Photo Matching) */}
            {plotDefects.length === 0 ? (
              <div className="bg-white rounded-2xl p-10 text-center text-slate-400 border border-slate-200 space-y-2">
                <CheckCircle size={40} className="mx-auto text-emerald-400 mb-2" />
                <h4 className="font-black text-base text-slate-800">ยังไม่มีรายการแจ้งซ่อมสำหรับแปลงนี้</h4>
                <p className="text-xs text-slate-400">ยังไม่มีการสร้างรายการ Defect ในระบบ</p>
              </div>
            ) : (
              <div className="space-y-4">
                <h4 className="font-black text-sm text-slate-800 flex items-center gap-2">
                  <HardHat size={18} className="text-purple-600" />
                  รายการงานที่ต้องแก้ไข (Punchlist Items)
                </h4>

                <div className="grid grid-cols-1 gap-3">
                  {plotDefects.map((defect: any, idx: number) => {
                    const isDone = (defect.progress || 0) >= 100 || defect.status === 'resolved';

                    // Match photos STRICTLY to THIS specific defect item
                    const defectImages = defect.image_urls
                      ? defect.image_urls.split(',').map((u: string) => u.trim()).filter(Boolean)
                      : [];

                    const fixImages = (defectUpdatesMap[defect.id] || [])
                      .flatMap((u: any) => (u.image_urls || '').split(',').map((url: string) => url.trim()).filter(Boolean));

                    const taskId = defect.task_id || defect.task_template_id;
                    const taskUpdatesKey = taskId ? `${plot.id}_${taskId}` : '';
                    const taskImages = (taskUpdatesMap[taskUpdatesKey] || [])
                      .flatMap((u: any) => (u.image_url || '').split(',').map((url: string) => url.trim()).filter(Boolean));

                    const imageUrls = Array.from(new Set([...defectImages, ...fixImages, ...taskImages]));

                    return (
                      <div key={defect.id || idx} className="bg-white rounded-2xl p-4 border border-slate-200 shadow-2xs space-y-3">
                        <div className="flex justify-between items-start gap-3">
                          <div className="flex items-start gap-2.5">
                            <span className="w-6 h-6 rounded-full bg-slate-900 text-white font-black text-xs flex items-center justify-center shrink-0 mt-0.5">
                              {idx + 1}
                            </span>
                            <div>
                              <span className="text-[10px] font-black text-slate-500 uppercase bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                                รอบที่ {defect.inspection_round || 1} • {defect.defect_stage || 'งานซ่อม'}
                              </span>
                              <h5 className="font-extrabold text-sm sm:text-base text-slate-900 mt-1 leading-snug">
                                {defect.description || defect.task_name || 'รายการซ่อม'}
                              </h5>
                            </div>
                          </div>

                          <span
                            className={`text-xs font-black px-2.5 py-1 rounded-xl border shrink-0 ${
                              isDone
                                ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                                : (defect.progress || 0) > 0
                                  ? 'bg-amber-100 text-amber-800 border-amber-300'
                                  : 'bg-rose-100 text-rose-800 border-rose-300'
                            }`}
                          >
                            {isDone
                              ? '🟢 ซ่อมเสร็จแล้ว (100%)'
                              : (defect.progress || 0) > 0
                                ? `🟡 กำลังซ่อม (${defect.progress}%)`
                                : '🔴 ยังไม่เริ่มซ่อม'}
                          </span>
                        </div>

                        {/* Defect Fix Schedule Duration */}
                        {(defect.planned_start || defect.planned_end) && (
                          <div className="flex items-center gap-1.5 text-xs font-bold text-purple-800 bg-purple-50 px-3 py-1.5 rounded-xl border border-purple-200 w-fit">
                            <Calendar size={14} className="text-purple-600 shrink-0" />
                            <span>
                              แผนกำหนดซ่อม:{' '}
                              {defect.planned_start
                                ? new Date(defect.planned_start).toLocaleDateString('th-TH', {
                                    day: 'numeric',
                                    month: 'short',
                                    year: 'numeric',
                                  })
                                : 'ไม่ระบุ'}
                              {defect.planned_end
                                ? ` ถึง ${new Date(defect.planned_end).toLocaleDateString('th-TH', {
                                    day: 'numeric',
                                    month: 'short',
                                    year: 'numeric',
                                  })}`
                                : ''}
                              {defect.planned_start &&
                                defect.planned_end &&
                                (() => {
                                  const days = Math.max(
                                    1,
                                    Math.ceil(
                                      (new Date(defect.planned_end).getTime() - new Date(defect.planned_start).getTime()) /
                                        (1000 * 60 * 60 * 24)
                                    ) + 1
                                  );
                                  return ` (รวม ${days} วัน)`;
                                })()}
                            </span>
                          </div>
                        )}

                        {/* Images preview */}
                        {imageUrls.length > 0 ? (
                          <div className="flex flex-col gap-1.5 pt-1">
                            <span className="text-xs font-extrabold text-purple-800 flex items-center gap-1">
                              <Camera size={13} className="text-purple-600" /> ภาพถ่ายแนบเฉพาะงานนี้ ({imageUrls.length} รูป):
                            </span>
                            <div className="flex items-center gap-2 flex-wrap">
                              {imageUrls.map((url: string, i: number) => (
                                <img
                                  key={i}
                                  src={url}
                                  onClick={() => setPreviewImage(url)}
                                  className="w-14 h-14 object-cover rounded-xl border border-purple-200 cursor-zoom-in hover:scale-105 transition-transform shadow-2xs"
                                  alt={`Defect ${idx + 1} photo`}
                                />
                              ))}
                            </div>
                          </div>
                        ) : (
                          <div className="text-[11px] font-bold text-slate-400 italic bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-100 w-fit">
                            📷 รายการนี้ยังไม่มีการแนบรูปภาพถ่ายซ่อม
                          </div>
                        )}

                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-bold text-slate-500 pt-2 border-t border-slate-100">
                          <span>
                            ผู้รับผิดชอบ: <strong className="text-slate-800">{defect.reporter_name || defect.assigned_to || 'ช่างคุมงาน'}</strong>
                          </span>
                          <span>อัปเดต: {defect.updated_at ? new Date(defect.updated_at).toLocaleDateString('th-TH') : '-'}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="p-4 bg-slate-100 border-t border-slate-200 flex justify-end shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="bg-slate-900 hover:bg-slate-800 text-white font-black px-6 py-2.5 rounded-xl text-xs cursor-pointer shadow-md"
            >
              ปิดหน้าต่าง
            </button>
          </div>
        </div>
      </SalesOverlay>

      {/* 🖼️ Image Lightbox Preview Modal */}
      {previewImage && (
        <SalesOverlay
          className="fixed inset-0 bg-black/90 z-[400] flex items-center justify-center p-4"
          onClick={() => setPreviewImage(null)}
        >
          <div className="relative max-w-4xl max-h-[90vh]">
            <img src={previewImage} alt="Preview" className="max-w-full max-h-[85vh] rounded-2xl shadow-2xl object-contain" />
            <button
              type="button"
              onClick={() => setPreviewImage(null)}
              className="absolute -top-4 -right-4 bg-white text-slate-900 rounded-full p-2 shadow-xl hover:bg-slate-200"
              aria-label="ปิดรูปภาพ"
            >
              <X size={20} />
            </button>
          </div>
        </SalesOverlay>
      )}
    </>
  );
}
