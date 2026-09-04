import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { CheckCircle2, Circle, Clock, FileText, Home, Save, Calendar, CheckSquare, Award, ShieldCheck, Gift, ChevronRight, Edit3, X, AlertTriangle, Search, Eye, HardHat, Camera, Check, CheckCircle } from 'lucide-react';

interface WaitingForTransferDetailsProps {
  plots: any[];
  carriedOverPlots?: any[];
  validRecords: any[];
  onViewDefects?: (plot: any) => void;
}

export default function WaitingForTransferDetails({ plots, carriedOverPlots = [], validRecords, onViewDefects }: WaitingForTransferDetailsProps) {
  // We need to display plots that are currently in "Waiting" status.
  const waitingPlots = plots; // The parent component should pass ONLY the waiting plots.
  const allTargetPlots = [...plots, ...carriedOverPlots];

  const [savingId, setSavingId] = useState<string | null>(null);
  const [tasksProgress, setTasksProgress] = useState<Record<string, Record<string, number>>>({});
  const [actualProgress, setActualProgress] = useState<Record<string, number>>({});
  const [defectsMap, setDefectsMap] = useState<Record<string, any[]>>({});
  const [defectUpdatesMap, setDefectUpdatesMap] = useState<Record<string, any[]>>({});
  const [taskUpdatesMap, setTaskUpdatesMap] = useState<Record<string, any[]>>({});
  const [promotionsMap, setPromotionsMap] = useState<Record<string, any[]>>({});
  const [plotsDataMap, setPlotsDataMap] = useState<Record<string, any>>({});

  // Modal State for Booking Inspection Dates
  const [inspectionModal, setInspectionModal] = useState<{
    isOpen: boolean;
    plot: any;
    round1Date: string;
    round1Status: string;
    round2Date: string;
    round2Status: string;
    notes: string;
  } | null>(null);

  // Modal State for Sales Read-Only Defect Punchlist Tracker
  const [salesDefectModalPlot, setSalesDefectModalPlot] = useState<any | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  useEffect(() => {
    const fetchProgress = async () => {
      if (!waitingPlots || waitingPlots.length === 0) return;
      
      try {
        // fetch all task templates
        const { data: templates } = await supabase.from('task_templates').select('id, task_name');
        const templateMap = new Map();
        templates?.forEach(t => templateMap.set(t.id, t.task_name));

        const plotIds = allTargetPlots.map(p => p.id);

        if (plotIds.length === 0) return;

        // fetch fresh plots data including inspection dates
        const { data: plotsData } = await supabase
          .from('plots')
          .select('id, inspection_round1_date, inspection_round1_status, inspection_round2_date, inspection_round2_status, handover_notes')
          .in('id', plotIds);

        const pMap: Record<string, any> = {};
        plotsData?.forEach(p => {
          pMap[p.id] = p;
        });
        setPlotsDataMap(pMap);

        // fetch plot_task_assignments for individual task progress
        const { data: assignments } = await supabase
          .from('plot_task_assignments')
          .select('plot_id, task_template_id, current_progress')
          .in('plot_id', plotIds);
        
        const progressMap: Record<string, Record<string, number>> = {};
        assignments?.forEach(a => {
          const taskName = templateMap.get(a.task_template_id);
          if (taskName) {
            if (!progressMap[a.plot_id]) progressMap[a.plot_id] = {};
            progressMap[a.plot_id][taskName] = a.current_progress || 0;
          }
        });
        setTasksProgress(progressMap);

        // fetch overall actual progress from construction view
        const { data: overallStatuses } = await supabase
          .from('vw_plot_overall_status')
          .select('plot_id, actual_avg')
          .in('plot_id', plotIds);
        
        const overallMap: Record<string, number> = {};
        overallStatuses?.forEach(s => {
          overallMap[s.plot_id] = s.actual_avg || 0;
        });
        setActualProgress(overallMap);

        // fetch defects for handover inspection status
        const { data: defectsData } = await supabase
          .from('defects')
          .select('*')
          .in('plot_id', plotIds);

        const defMap: Record<string, any[]> = {};
        const defectIds: string[] = [];
        defectsData?.forEach(d => {
          // 🚨 BUG FIX: Filter defects by the plot's current handover_cycle
          // This prevents old defects from a previous customer (Cycle 1) from showing up 
          // in the new customer's handover view (Cycle 2) if the old customer canceled.
          const plot = allTargetPlots.find(p => String(p.id) === String(d.plot_id));
          if (plot && d.handover_cycle === plot.handover_cycle) {
            const pKey = String(d.plot_id);
            if (!defMap[pKey]) defMap[pKey] = [];
            defMap[pKey].push(d);
            if (d.id) defectIds.push(d.id);
          }
        });
        setDefectsMap(defMap);

        // fetch defect_updates (photos uploaded strictly when technicians update defect items)
        if (defectIds.length > 0) {
          const { data: defectUpdates } = await supabase
            .from('defect_updates')
            .select('defect_id, image_urls, note, created_at, created_by')
            .in('defect_id', defectIds);

          const duMap: Record<string, any[]> = {};
          defectUpdates?.forEach(du => {
            if (du.image_urls) {
              if (!duMap[du.defect_id]) duMap[du.defect_id] = [];
              duMap[du.defect_id].push(du);
            }
          });
          setDefectUpdatesMap(duMap);
        }

        // fetch plot_promotions for freebies status
        const { data: promotionsData } = await supabase
          .from('plot_promotions')
          .select('id, plot_id, category, item_name, quantity, status, delivery_date, remarks')
          .in('plot_id', plotIds);

        const promoMap: Record<string, any[]> = {};
        promotionsData?.forEach(p => {
          if (!promoMap[p.plot_id]) promoMap[p.plot_id] = [];
          promoMap[p.plot_id].push(p);
        });
        setPromotionsMap(promoMap);
        // fetch task_updates (photos uploaded from construction side)
        const { data: taskUpdatesData } = await supabase
          .from('task_updates')
          .select('plot_id, task_template_id, image_url')
          .in('plot_id', plotIds);
        
        const tuMap: Record<string, any[]> = {};
        taskUpdatesData?.forEach(tu => {
          if (tu.image_url) {
            const key = `${tu.plot_id}_${tu.task_template_id}`;
            if (!tuMap[key]) tuMap[key] = [];
            tuMap[key].push(tu);
          }
        });
        setTaskUpdatesMap(tuMap);

      } catch (err) {
        console.error('Error fetching tasks progress:', err);
      }
    };
    
    fetchProgress();
  }, [waitingPlots, carriedOverPlots]);

  const openModalForPlot = (plot: any) => {
    const freshPlotData = plotsDataMap[plot.id] || plot;
    setInspectionModal({
      isOpen: true,
      plot,
      round1Date: freshPlotData.inspection_round1_date ? freshPlotData.inspection_round1_date.split('T')[0] : '',
      round1Status: freshPlotData.inspection_round1_status || 'scheduled',
      round2Date: freshPlotData.inspection_round2_date ? freshPlotData.inspection_round2_date.split('T')[0] : '',
      round2Status: freshPlotData.inspection_round2_status || 'scheduled',
      notes: freshPlotData.handover_notes || ''
    });
  };

  const handleSaveInspectionDates = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inspectionModal) return;
    setSavingId(inspectionModal.plot.id);

    const payload = {
      inspection_round1_date: inspectionModal.round1Date ? new Date(inspectionModal.round1Date).toISOString() : null,
      inspection_round1_status: inspectionModal.round1Status || 'scheduled',
      inspection_round2_date: inspectionModal.round2Date ? new Date(inspectionModal.round2Date).toISOString() : null,
      inspection_round2_status: inspectionModal.round2Status || 'scheduled',
      handover_notes: inspectionModal.notes.trim() || null,
    };

    try {
      const { error } = await supabase.from('plots').update(payload).eq('id', inspectionModal.plot.id);
      if (error) console.warn('Plots inspection update notice:', error.message);

      setPlotsDataMap(prev => ({
        ...prev,
        [inspectionModal.plot.id]: {
          ...(prev[inspectionModal.plot.id] || {}),
          ...payload
        }
      }));

      setInspectionModal(null);
    } catch (err: any) {
      console.error('Update inspection dates error:', err);
    } finally {
      setSavingId(null);
    }
  };

  if (!waitingPlots || waitingPlots.length === 0) {
    return null;
  }

  // Update names to match the exact task names in task_templates
  const foremanTasks = [
    { key: 'งานติดตั้งสุขภัณฑ์', label: 'งานติดตั้งสุขภัณฑ์' },
    { key: 'งานติดตั้งถังเก็บน้ำ และ ปั้มน้ำ', label: 'งานติดตั้งถังเก็บน้ำ และ ปั้มน้ำ' },
    { key: 'งานปูหญ้า', label: 'งานปูหญ้า' },
    { key: 'งานทำทรายล้าง', label: 'งานทำทรายล้าง' },
    { key: 'งานทาสีเก็บรายละเอียด', label: 'งานทาสีเก็บรายละเอียด' },
  ];

  const adminDocs = [
    { key: 'permit_date', label: 'ใบอนุญาตก่อสร้าง' },
    { key: 'registration_date', label: 'ทะเบียนบ้าน' },
    { key: 'water_meter_date', label: 'มิเตอร์น้ำ' },
    { key: 'electric_meter_date', label: 'มิเตอร์ไฟฟ้า' },
  ];

  const renderPlotList = (plotList: any[]) => {
    return (
      <div className="grid grid-cols-1 gap-6">
        {[...plotList].sort((a, b) => {
          const recordsA = validRecords.filter(r => r.plot?.id === a.id || r.plot_id === a.id).sort((x: any, y: any) => (y.createdDate || '').localeCompare(x.createdDate || ''));
          const recordsB = validRecords.filter(r => r.plot?.id === b.id || r.plot_id === b.id).sort((x: any, y: any) => (y.createdDate || '').localeCompare(x.createdDate || ''));
          const expA = recordsA[0]?.expectedTransfer || '9999-99-99';
          const expB = recordsB[0]?.expectedTransfer || '9999-99-99';
          return expA.localeCompare(expB);
        }).map((plot) => {
          // Find records for this plot
          const records = validRecords.filter(r => r.plot?.id === plot.id || r.plot_id === plot.id).sort((a: any, b: any) => (b.createdDate || '').localeCompare(a.createdDate || ''));
          const currentRecord = records[0];
          
          const expectedTransfer = currentRecord?.expectedTransfer || 'ยังไม่ระบุ';
          const actualTransfer = currentRecord?.transferDate || 'ยังไม่โอน';
          const progress = actualProgress[plot.id] ?? (plot.progress || 0);

          // Plot Fresh Inspection & Promotions Data
          const freshPlotData = plotsDataMap[plot.id] || plot;
          const r1Date = freshPlotData.inspection_round1_date;
          const r2Date = freshPlotData.inspection_round2_date;

          // Defects reported strictly for this plot ID
          const plotDefects = defectsMap[plot.id] || defectsMap[plot.plot_name] || [];

          const completedDefectsCount = plotDefects.filter(d => (d.progress || 0) >= 100 || d.status === 'resolved').length;
          const totalDefectsCount = plotDefects.length;
          const defectFixPercent = totalDefectsCount > 0 ? Math.round((completedDefectsCount / totalDefectsCount) * 100) : 0;

          // Freebie / Promotion Stats for this plot
          const plotPromotions = promotionsMap[plot.id] || [];
          const totalPromos = plotPromotions.length;
          const installedPromos = plotPromotions.filter(p => p.status === 'installed').length;
          const deliveredPromos = plotPromotions.filter(p => p.status === 'delivered').length;
          const promoPercent = totalPromos > 0 ? Math.round(((installedPromos + (deliveredPromos * 0.5)) / totalPromos) * 100) : 0;
          
          return (
            <div key={plot.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden flex flex-col md:flex-row">
              {/* Image & Basic Info */}
              <div className="md:w-1/2 lg:w-2/5 relative bg-slate-100 min-h-[250px]">
                {plot.overview_image_url ? (
                  <img src={plot.overview_image_url} alt={plot.plot_name} className="w-full h-full object-cover absolute inset-0" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-slate-400 absolute inset-0">
                    <Home size={48} opacity={0.2} />
                  </div>
                )}
                <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-t from-slate-900/80 to-transparent"></div>
                <div className="absolute bottom-4 left-4 right-4 text-white">
                  {actualTransfer !== 'ยังไม่โอน' ? (
                    <div className="text-sm font-bold bg-emerald-500/90 px-2 py-1 rounded inline-block mb-2 text-white">โอนสำเร็จ</div>
                  ) : (
                    <div className="text-sm font-bold bg-amber-500/90 px-2 py-1 rounded inline-block mb-2 text-white">รอโอน (สร้างเสร็จ)</div>
                  )}
                  <h3 className="font-black text-xl">{plot.house_types?.type_name || plot.type || 'ไม่ระบุแบบบ้าน'}</h3>
                  <div className="flex items-center gap-1.5 text-slate-200 text-sm mt-1 mb-3">
                    <Home size={14} />
                    <span>โครงการ {plot.project_name} - แปลง {plot.plot_name || plot.id}</span>
                  </div>
                  <div className="flex justify-between items-center mt-2 text-sm">
                    <span>ความคืบหน้าก่อสร้าง:</span>
                    <span className="font-bold">{progress}%</span>
                  </div>
                  <div className="w-full bg-slate-700 h-2 rounded-full mt-1 overflow-hidden">
                    <div className="bg-emerald-400 h-full transition-all duration-500" style={{ width: `${progress}%` }}></div>
                  </div>
                </div>
              </div>

              {/* Details & Checklists */}
              <div className="md:w-1/2 lg:w-3/5 p-6 flex flex-col gap-6">
                
                {/* Dates */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                    <div className="text-xs text-slate-500 font-bold mb-1 flex items-center gap-1"><Calendar size={12}/> สถานะล่าสุด</div>
                    <div className="text-sm font-bold text-slate-700 truncate">{currentRecord?.status || plot.sale_status || '-'}</div>
                  </div>
                  <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                    <div className="text-xs text-slate-500 font-bold mb-1 flex items-center gap-1"><Clock size={12}/> วันที่โอน</div>
                    <div className="text-sm font-bold text-blue-600">
                      <span className="text-[10px] text-slate-400 block mb-0.5">คาดการณ์: {expectedTransfer}</span>
                      {actualTransfer !== 'ยังไม่โอน' ? actualTransfer : 'รอดำเนินการ'}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                  {/* Foreman Checklists & Interactive Inspection Dates */}
                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 flex flex-col justify-between">
                    <div>
                      <div className="flex justify-between items-center mb-4">
                        <h4 className="text-xs font-black text-slate-400 uppercase tracking-wider">ตรวจสอบงานก่อสร้าง & นัดตรวจบ้าน</h4>
                        <button
                          onClick={() => openModalForPlot(plot)}
                          className="text-[11px] font-extrabold text-purple-700 bg-purple-100 hover:bg-purple-200 px-2.5 py-1 rounded-lg transition-all flex items-center gap-1 cursor-pointer"
                        >
                          <Calendar size={13} />
                          <span>{r1Date || r2Date ? 'แก้ไขวันนัด' : '+ ลงวันนัดตรวจ'}</span>
                        </button>
                      </div>

                      <div className="grid grid-cols-2 gap-y-3 gap-x-2">
                        {foremanTasks.map(task => {
                          const taskProg = tasksProgress[plot.id]?.[task.key] || 0;
                          const isDone = taskProg >= 100;
                          return (
                            <div key={task.key} className="flex items-center gap-2 text-xs text-slate-600 font-medium">
                              {isDone ? (
                                <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />
                              ) : (
                                <Circle size={14} className="text-slate-300 shrink-0" />
                              )}
                              <span className="truncate">{task.label}</span>
                              {taskProg > 0 && taskProg < 100 && (
                                <span className="text-[10px] text-amber-500 bg-amber-50 px-1 rounded">{taskProg}%</span>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {/* 📅 Interactive Inspection Rounds 1 & 2 Section */}
                      <div className="mt-3 pt-3 border-t border-slate-200/80 space-y-2">
                        {/* Round 1 Date & Status */}
                        <div className="flex items-center justify-between text-xs bg-white p-2 rounded-xl border border-slate-200">
                          <div className="flex items-center gap-2">
                            <Calendar size={14} className="text-purple-600 shrink-0" />
                            <div>
                              <span className="font-extrabold text-slate-800 block">ตรวจครั้งที่ 1</span>
                              {r1Date ? (
                                <span className="text-[10px] font-bold text-purple-700">
                                  📅 นัดวันที่: {new Date(r1Date).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })}
                                </span>
                              ) : (
                                <span className="text-[10px] text-slate-400 italic">ยังไม่ได้ลงวันนัดหมาย</span>
                              )}
                            </div>
                          </div>

                          <span className={`text-[10px] font-black px-2 py-0.5 rounded-lg border ${
                            freshPlotData.inspection_round1_status === 'passed'
                              ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                              : freshPlotData.inspection_round1_status === 'failed'
                              ? 'bg-rose-100 text-rose-800 border-rose-300'
                              : r1Date
                              ? 'bg-purple-100 text-purple-800 border-purple-300'
                              : 'bg-slate-100 text-slate-500 border-slate-200'
                          }`}>
                            {freshPlotData.inspection_round1_status === 'passed' ? '🟢 ผ่านแล้ว' : freshPlotData.inspection_round1_status === 'failed' ? '🔴 มีงานต้องแก้' : r1Date ? '🔵 นัดแล้ว' : '⚪ รอลงวัน'}
                          </span>
                        </div>

                        {/* Round 2 Date & Status */}
                        <div className="flex items-center justify-between text-xs bg-white p-2 rounded-xl border border-slate-200">
                          <div className="flex items-center gap-2">
                            <Calendar size={14} className="text-amber-600 shrink-0" />
                            <div>
                              <span className="font-extrabold text-slate-800 block">ตรวจครั้งที่ 2 (เก็บงาน)</span>
                              {r2Date ? (
                                <span className="text-[10px] font-bold text-amber-700">
                                  📅 นัดวันที่: {new Date(r2Date).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })}
                                </span>
                              ) : (
                                <span className="text-[10px] text-slate-400 italic">ยังไม่ได้ลงวันนัดรอบ 2</span>
                              )}
                            </div>
                          </div>

                          <span className={`text-[10px] font-black px-2 py-0.5 rounded-lg border ${
                            freshPlotData.inspection_round2_status === 'passed'
                              ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                              : r2Date
                              ? 'bg-amber-100 text-amber-800 border-amber-300'
                              : 'bg-slate-100 text-slate-500 border-slate-200'
                          }`}>
                            {freshPlotData.inspection_round2_status === 'passed' ? '🟢 ผ่านแล้ว' : r2Date ? '🟡 นัดรอบ 2' : '⚪ -'}
                          </span>
                        </div>

                        {/* 🏆 Banner: Completed Handover Status */}
                        {(plot.handover_status === 'completed' || freshPlotData.inspection_round2_status === 'passed' || freshPlotData.inspection_round1_status === 'passed') && (
                          <div className="p-2.5 bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200 rounded-xl flex items-center justify-between gap-2 text-emerald-900 shadow-2xs">
                            <div className="flex items-center gap-2">
                              <Award size={16} className="text-emerald-600 shrink-0" />
                              <span className="text-[11px] font-black text-emerald-900">🏆 ผ่านการตรวจรับมอบบ้านแล้ว</span>
                            </div>
                            <span className="text-[9px] font-black bg-emerald-600 text-white px-2 py-0.5 rounded-md">
                              100%
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* 🔍 BUTTON FOR SALES TO VIEW READ-ONLY DEFECT PUNCHLIST TRACKER */}
                    <button
                      onClick={() => setSalesDefectModalPlot(plot)}
                      className="w-full mt-3 bg-purple-50 hover:bg-purple-100 text-purple-900 font-extrabold py-2.5 px-3 rounded-xl border border-purple-200 text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-2xs hover:shadow-xs active:scale-98"
                    >
                      <Search size={14} className="text-purple-600" />
                      <span>🔍 ดูแผนเก็บงาน & ติดตามงานซ่อม {totalDefectsCount > 0 ? `(${completedDefectsCount}/${totalDefectsCount} งาน)` : ''}</span>
                    </button>
                  </div>

                  {/* Admin Documents Updates */}
                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                    <h4 className="text-xs font-black text-slate-400 uppercase tracking-wider mb-4">สถานะเอกสาร & สาธารณูปโภค (ธุรการ)</h4>
                    <div className="space-y-3">
                      {adminDocs.map(doc => (
                        <div key={doc.key} className="flex items-center justify-between gap-3 text-sm">
                          <div className="flex items-center gap-2 text-slate-700 font-bold w-[120px] shrink-0">
                            <FileText size={14} className="text-slate-400 shrink-0" />
                            <span className="truncate text-xs">{doc.label}</span>
                          </div>
                          <div className="flex items-center gap-2 flex-1">
                            {(() => {
                              const statusKey = doc.key.replace('_date', '_status');
                              const status = plot[statusKey] || 'NotStarted';
                              const dateStr = plot[doc.key] ? new Date(plot[doc.key]).toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
                              
                              if (status === 'NotStarted') {
                                return <div className="text-xs px-2 py-1 bg-slate-100 text-slate-500 rounded-lg w-full text-center">ยังไม่ได้ดำเนินการ</div>;
                              }
                              
                              let statusBadge = null;
                              if (status === 'Submitting') {
                                statusBadge = <div className="text-xs px-2 py-1 bg-yellow-50 text-yellow-700 rounded-lg border border-yellow-200 flex-1">กำลังยื่น ({dateStr})</div>;
                              } else if (status === 'Waiting') {
                                statusBadge = <div className="text-xs px-2 py-1 bg-orange-50 text-orange-700 rounded-lg border border-orange-200 flex-1">รอผล ({dateStr})</div>;
                              } else if (status === 'Received') {
                                statusBadge = <div className="text-xs px-2 py-1 bg-emerald-50 text-emerald-700 rounded-lg border border-emerald-200 flex-1 font-bold">ได้รับแล้ว ({dateStr})</div>;
                              }
                              
                              return (
                                <div className="flex items-center gap-2 w-full">
                                  {statusBadge}
                                  {status === 'Received' && <CheckCircle2 size={16} className="text-emerald-500 shrink-0" />}
                                  {status !== 'Received' && <div className="w-4 shrink-0"></div>}
                                </div>
                              );
                            })()}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* 🎁 🌟 SECTION: สถานะของแถมโครงการ (Promotions Status) 🌟 */}
                <div className="bg-[#fcfbfa] p-4 rounded-xl border border-amber-200/80 shadow-2xs space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-amber-100 pb-2.5">
                    <h4 className="text-xs font-black text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                      <Gift size={16} className="text-[#d4af37]" />
                      สถานะของแถมโครงการ (Promotions)
                    </h4>

                    {totalPromos === 0 ? (
                      <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-2.5 py-0.5 rounded-lg border border-slate-200 w-fit">
                        ⚪ แปลงนี้ไม่ได้เลือกรายการของแถม
                      </span>
                    ) : promoPercent === 100 ? (
                      <span className="text-[11px] font-black text-emerald-900 bg-emerald-100 px-3 py-1 rounded-xl border border-emerald-300 flex items-center gap-1.5 shadow-2xs w-fit">
                        🟢 ติดตั้งครบแล้ว 100% ({installedPromos}/{totalPromos} ชิ้น)
                      </span>
                    ) : (installedPromos + deliveredPromos) > 0 ? (
                      <span className="text-[11px] font-black text-amber-900 bg-amber-100 px-3 py-1 rounded-xl border border-amber-300 flex items-center gap-1.5 shadow-2xs w-fit">
                        🟡 ส่งมอบแล้ว {promoPercent}% ({installedPromos + deliveredPromos}/{totalPromos} ชิ้น)
                      </span>
                    ) : (
                      <span className="text-[11px] font-black text-rose-900 bg-rose-100 px-3 py-1 rounded-xl border border-rose-300 flex items-center gap-1.5 shadow-2xs w-fit">
                        🔴 ยังไม่เรียบร้อย (0/{totalPromos} ชิ้น)
                      </span>
                    )}
                  </div>

                  {totalPromos > 0 ? (
                    <div className="space-y-2.5">
                      {/* Dynamic Progress Bar */}
                      <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden border border-slate-300/60">
                        <div 
                          className={`h-full transition-all duration-500 ${
                            promoPercent === 100 ? 'bg-emerald-500' : promoPercent > 0 ? 'bg-amber-500' : 'bg-rose-500'
                          }`} 
                          style={{ width: `${promoPercent}%` }}
                        ></div>
                      </div>

                      {/* Item badges listing with statuses */}
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {plotPromotions.map((p, idx) => (
                          <span 
                            key={idx}
                            className={`text-[11px] font-extrabold px-2.5 py-1 rounded-xl border flex items-center gap-1.5 shadow-2xs transition-transform hover:scale-105 ${
                              p.status === 'installed' 
                                ? 'bg-emerald-50 text-emerald-950 border-emerald-300' 
                                : p.status === 'delivered'
                                ? 'bg-amber-50 text-amber-950 border-amber-300'
                                : 'bg-rose-50 text-rose-950 border-rose-300'
                            }`}
                            title={`${p.category}: ${p.item_name} (${p.status === 'installed' ? 'ติดตั้งแล้ว' : p.status === 'delivered' ? 'ของมาส่งแล้ว' : 'ยังไม่มา'})`}
                          >
                            <span>{p.status === 'installed' ? '🟢' : p.status === 'delivered' ? '🟡' : '🔴'}</span>
                            <span>{p.item_name}</span>
                            {p.quantity > 1 && <span className="text-[10px] font-black opacity-75">({p.quantity} ชิ้น)</span>}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-400 font-bold italic py-0.5">
                      ยังไม่ได้ระบุรายการของแถมสำหรับแปลงนี้ในระบบ
                    </p>
                  )}
                </div>

              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="mt-8 mb-6">
      <div className="flex items-center gap-3 mb-8 border-b border-gray-100 pb-4">
        <Home className="text-amber-600 w-8 h-8 p-1.5 bg-amber-100 rounded-lg" />
        <div>
          <h2 className="text-2xl font-bold text-gray-800">รายละเอียดบ้านที่รอโอน (Waiting for Transfer)</h2>
          <p className="text-sm text-gray-500">เป้าหมายทั้งหมด {waitingPlots.length + carriedOverPlots.length} แปลง</p>
        </div>
      </div>

      {waitingPlots && waitingPlots.length > 0 && (
        <div className="mb-10">
          <h3 className="text-lg font-bold text-blue-600 mb-4 flex items-center gap-2">
            <span className="bg-blue-100 text-blue-600 p-1.5 rounded-lg"><Calendar size={16} /></span>
            คาดโอนตามเป้าหมายเดือนนี้ ({waitingPlots.length} แปลง)
          </h3>
          {renderPlotList(waitingPlots)}
        </div>
      )}

      {carriedOverPlots && carriedOverPlots.length > 0 && (
        <div>
          <h3 className="text-lg font-bold text-rose-600 mb-4 flex items-center gap-2">
            <span className="bg-rose-100 text-rose-600 p-1.5 rounded-lg"><Clock size={16} /></span>
            คาดโอนตกค้างจากเดือนก่อน ({carriedOverPlots.length} แปลง)
          </h3>
          {renderPlotList(carriedOverPlots)}
        </div>
      )}

      {/* 🛠️ Modal for Booking Inspection Dates 1 & 2 */}
      {inspectionModal && inspectionModal.isOpen && (
        <div className="fixed inset-0 bg-black/70 z-[99999] flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-lg p-6 shadow-2xl border border-slate-100 animate-fade-in space-y-5 relative">
            <div className="flex justify-between items-start border-b border-slate-100 pb-3">
              <div>
                <span className="text-[10px] font-black uppercase text-purple-700 tracking-widest bg-purple-50 px-2 py-0.5 rounded border border-purple-200">
                  นัดหมายวันตรวจรับมอบบ้าน
                </span>
                <h4 className="font-black text-lg text-slate-800 mt-1">
                  แปลง {inspectionModal.plot.plot_name || inspectionModal.plot.id} ({inspectionModal.plot.project_name || ''})
                </h4>
              </div>
              <button 
                onClick={() => setInspectionModal(null)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-full cursor-pointer"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSaveInspectionDates} className="space-y-4">
              {/* Round 1 Section */}
              <div className="bg-purple-50/60 p-4 rounded-2xl border border-purple-100 space-y-3">
                <h5 className="font-extrabold text-xs text-purple-950 flex items-center gap-1.5">
                  <Calendar size={15} className="text-purple-600" />
                  การตรวจรับมอบบ้าน รอบที่ 1
                </h5>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">วันนัดตรวจรอบที่ 1</label>
                    <input
                      type="date"
                      value={inspectionModal.round1Date}
                      onChange={(e) => setInspectionModal(prev => prev ? { ...prev, round1Date: e.target.value } : null)}
                      className="w-full border border-purple-200 rounded-xl p-2.5 text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-purple-500 bg-white"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">สถานะตรวจรอบที่ 1</label>
                    <select
                      value={inspectionModal.round1Status}
                      onChange={(e) => setInspectionModal(prev => prev ? { ...prev, round1Status: e.target.value } : null)}
                      className="w-full border border-purple-200 rounded-xl p-2.5 text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-purple-500 bg-white cursor-pointer"
                    >
                      <option value="scheduled">🔵 นัดหมายแล้ว (Scheduled)</option>
                      <option value="passed">🟢 ตรวจผ่านแล้ว (Passed)</option>
                      <option value="failed">🔴 มีงานต้องแก้ (Failed)</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Round 2 Section */}
              <div className="bg-amber-50/60 p-4 rounded-2xl border border-amber-100 space-y-3">
                <h5 className="font-extrabold text-xs text-amber-950 flex items-center gap-1.5">
                  <Calendar size={15} className="text-amber-600" />
                  การตรวจเก็บงาน รอบที่ 2 (Re-inspection)
                </h5>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">วันนัดตรวจรอบที่ 2</label>
                    <input
                      type="date"
                      value={inspectionModal.round2Date}
                      onChange={(e) => setInspectionModal(prev => prev ? { ...prev, round2Date: e.target.value } : null)}
                      className="w-full border border-amber-200 rounded-xl p-2.5 text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-amber-500 bg-white"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">สถานะตรวจรอบที่ 2</label>
                    <select
                      value={inspectionModal.round2Status}
                      onChange={(e) => setInspectionModal(prev => prev ? { ...prev, round2Status: e.target.value } : null)}
                      className="w-full border border-amber-200 rounded-xl p-2.5 text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-amber-500 bg-white cursor-pointer"
                    >
                      <option value="scheduled">🟡 นัดรอบ 2 แล้ว (Scheduled)</option>
                      <option value="passed">🟢 ตรวจผ่าน 100% (Passed)</option>
                      <option value="failed">🔴 ยังมีงานค้าง (Failed)</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">หมายเหตุการนัดหมาย</label>
                <textarea
                  rows={2}
                  placeholder="เช่น ลูกค้าสะดวกช่วงบ่าย 14:00 น., ให้ช่างทาสีเข้าเก็บงานซ่อมก่อนวันนัด..."
                  value={inspectionModal.notes}
                  onChange={(e) => setInspectionModal(prev => prev ? { ...prev, notes: e.target.value } : null)}
                  className="w-full border border-slate-200 rounded-xl p-2.5 text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setInspectionModal(null)}
                  className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold px-4 py-2.5 rounded-xl text-xs cursor-pointer"
                >
                  ยกเลิก
                </button>

                <button
                  type="submit"
                  disabled={savingId === inspectionModal.plot.id}
                  className="bg-purple-700 hover:bg-purple-800 text-white font-black px-6 py-2.5 rounded-xl text-xs shadow-md transition-all active:scale-95 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {savingId === inspectionModal.plot.id ? 'กำลังบันทึก...' : '💾 บันทึกวันนัดหมาย'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 🔍 MODAL: SALES READ-ONLY DEFECT PUNCHLIST TRACKER */}
      {salesDefectModalPlot && (
        <div className="fixed inset-0 bg-black/75 z-[99999] flex items-center justify-center p-3 sm:p-6">
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
                    แผนเก็บงาน & ติดตามการแก้ไข (Defects Punchlist) — แปลง {salesDefectModalPlot.plot_name || salesDefectModalPlot.id} ({salesDefectModalPlot.project_name || ''})
                  </h3>
                </div>
              </div>

              <button
                onClick={() => setSalesDefectModalPlot(null)}
                className="p-2 text-slate-400 hover:text-white rounded-full transition-colors cursor-pointer"
              >
                <X size={22} />
              </button>
            </div>

            {/* Content Body */}
            <div className="p-5 overflow-y-auto space-y-6 flex-1 custom-scrollbar bg-slate-50">
              
              {/* Summary Stats */}
              {(() => {
                // Find defects strictly for this plot ID
                const plotDefects = defectsMap[salesDefectModalPlot.id] || defectsMap[salesDefectModalPlot.plot_name] || [];

                const total = plotDefects.length;
                const completed = plotDefects.filter(d => (d.progress || 0) >= 100 || d.status === 'resolved').length;
                const inProgress = plotDefects.filter(d => (d.progress || 0) > 0 && (d.progress || 0) < 100).length;
                const pending = total - completed - inProgress;
                const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

                return (
                  <div className="space-y-4">
                    {/* Progress Summary Card */}
                    <div className="bg-white rounded-2xl p-5 shadow-xs border border-slate-200 space-y-3">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
                        <div>
                          <h4 className="font-extrabold text-sm text-slate-800">สรุปความคืบหน้าการซ่อมแก้ไข</h4>
                          <p className="text-xs text-slate-500 font-bold">รายการซ่อมทั้งหมด {total} รายการ</p>
                        </div>

                        <span className={`text-xs font-black px-3 py-1.5 rounded-xl border ${
                          percent === 100 ? 'bg-emerald-100 text-emerald-800 border-emerald-300' : 'bg-amber-100 text-amber-800 border-amber-300'
                        }`}>
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
                );
              })()}

              {/* Defects List Cards (Strict Per-Defect Item Photo Matching) */}
              {(() => {
                const plotDefects = defectsMap[salesDefectModalPlot.id] || defectsMap[salesDefectModalPlot.plot_name] || [];

                if (plotDefects.length === 0) {
                  return (
                    <div className="bg-white rounded-2xl p-10 text-center text-slate-400 border border-slate-200 space-y-2">
                      <CheckCircle size={40} className="mx-auto text-emerald-400 mb-2" />
                      <h4 className="font-black text-base text-slate-800">ยังไม่มีรายการแจ้งซ่อมสำหรับแปลงนี้</h4>
                      <p className="text-xs text-slate-400">ยังไม่มีการสร้างรายการ Defect ในระบบ</p>
                    </div>
                  );
                }

                return (
                  <div className="space-y-4">
                    <h4 className="font-black text-sm text-slate-800 flex items-center gap-2">
                      <HardHat size={18} className="text-purple-600" />
                      รายการงานที่ต้องแก้ไข (Punchlist Items)
                    </h4>

                    <div className="grid grid-cols-1 gap-3">
                      {plotDefects.map((defect, idx) => {
                        const isDone = (defect.progress || 0) >= 100 || defect.status === 'resolved';

                        // 🖼️ Match photos STRICTLY to THIS specific defect item:
                        // 1. defects table (image_urls attached directly to THIS defect item)
                        // 2. defect_updates table (photos uploaded specifically when fixing THIS defect.id)
                        // 3. task_updates table (photos uploaded from construction view for THIS plot and THIS task_id)
                        const defectImages = defect.image_urls
                          ? defect.image_urls.split(',').map((u: string) => u.trim()).filter(Boolean)
                          : [];
                        
                        const fixImages = (defectUpdatesMap[defect.id] || [])
                          .flatMap((u: any) => (u.image_urls || '').split(',').map((url: string) => url.trim()).filter(Boolean));

                        const taskId = defect.task_id || defect.task_template_id;
                        const taskUpdatesKey = taskId ? `${salesDefectModalPlot.id}_${taskId}` : '';
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

                              <span className={`text-xs font-black px-2.5 py-1 rounded-xl border shrink-0 ${
                                isDone ? 'bg-emerald-100 text-emerald-800 border-emerald-300' :
                                (defect.progress || 0) > 0 ? 'bg-amber-100 text-amber-800 border-amber-300' :
                                'bg-rose-100 text-rose-800 border-rose-300'
                              }`}>
                                {isDone ? '🟢 ซ่อมเสร็จแล้ว (100%)' : (defect.progress || 0) > 0 ? `🟡 กำลังซ่อม (${defect.progress}%)` : '🔴 ยังไม่เริ่มซ่อม'}
                              </span>
                            </div>

                            {/* 📅 Defect Fix Schedule Duration (ระยะเวลาแผนเก็บงาน) */}
                            {(defect.planned_start || defect.planned_end) && (
                              <div className="flex items-center gap-1.5 text-xs font-bold text-purple-800 bg-purple-50 px-3 py-1.5 rounded-xl border border-purple-200 w-fit">
                                <Calendar size={14} className="text-purple-600 shrink-0" />
                                <span>
                                  แผนกำหนดซ่อม: {defect.planned_start ? new Date(defect.planned_start).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' }) : 'ไม่ระบุ'}
                                  {defect.planned_end ? ` ถึง ${new Date(defect.planned_end).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}
                                  {defect.planned_start && defect.planned_end && (() => {
                                    const days = Math.max(1, Math.ceil((new Date(defect.planned_end).getTime() - new Date(defect.planned_start).getTime()) / (1000 * 60 * 60 * 24)) + 1);
                                    return ` (รวม ${days} วัน)`;
                                  })()}
                                </span>
                              </div>
                            )}

                            {/* Images preview (Strict 100% Authentic Per-Item Photos) */}
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
                              <span>ผู้รับผิดชอบ: <strong className="text-slate-800">{defect.reporter_name || defect.assigned_to || 'ช่างคุมงาน'}</strong></span>
                              <span>อัปเดต: {defect.updated_at ? new Date(defect.updated_at).toLocaleDateString('th-TH') : '-'}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

            </div>

            {/* Footer */}
            <div className="p-4 bg-slate-100 border-t border-slate-200 flex justify-end shrink-0">
              <button
                onClick={() => setSalesDefectModalPlot(null)}
                className="bg-slate-900 hover:bg-slate-800 text-white font-black px-6 py-2.5 rounded-xl text-xs cursor-pointer shadow-md"
              >
                ปิดหน้าต่าง
              </button>
            </div>

          </div>
        </div>
      )}

      {/* 🖼️ Image Lightbox Preview Modal */}
      {previewImage && (
        <div className="fixed inset-0 bg-black/90 z-[999999] flex items-center justify-center p-4" onClick={() => setPreviewImage(null)}>
          <div className="relative max-w-4xl max-h-[90vh]">
            <img src={previewImage} alt="Preview" className="max-w-full max-h-[85vh] rounded-2xl shadow-2xl object-contain" />
            <button
              onClick={() => setPreviewImage(null)}
              className="absolute -top-4 -right-4 bg-white text-slate-900 rounded-full p-2 shadow-xl hover:bg-slate-200"
            >
              <X size={20} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
