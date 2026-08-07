import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { CheckCircle2, Circle, Clock, FileText, Home, Save, Calendar, CheckSquare } from 'lucide-react';

interface WaitingForTransferDetailsProps {
  plots: any[];
  carriedOverPlots?: any[];
  validRecords: any[];
}

export default function WaitingForTransferDetails({ plots, carriedOverPlots = [], validRecords }: WaitingForTransferDetailsProps) {
  // We need to display plots that are currently in "Waiting" status.
  const waitingPlots = plots; // The parent component should pass ONLY the waiting plots.
  const allTargetPlots = [...plots, ...carriedOverPlots];

  const [savingId, setSavingId] = useState<string | null>(null);
  const [tasksProgress, setTasksProgress] = useState<Record<string, Record<string, number>>>({});
  const [actualProgress, setActualProgress] = useState<Record<string, number>>({});

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

      } catch (err) {
        console.error('Error fetching tasks progress:', err);
      }
    };
    
    fetchProgress();
  }, [waitingPlots, carriedOverPlots]);

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

  const inspectionTasks = [
    { key: 'inspect1', label: 'ตรวจครั้งที่ 1' },
    { key: 'inspect2', label: 'ตรวจครั้งที่ 2' },
    { key: 'termite', label: 'ฉีดน้ำยาปลวก' },
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
                    <span>โครงการ {plot.project_name} - แปลง {plot.plot_name}</span>
                  </div>
                  <div className="flex justify-between items-center mt-2 text-sm">
                    <span>ความคืบหน้า:</span>
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
                  {/* Foreman Checklists (Read-only UI placeholder) */}
                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                    <h4 className="text-xs font-black text-slate-400 uppercase tracking-wider mb-4">ตรวจสอบงานก่อสร้าง (รออัปเดตจากช่าง)</h4>
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
                    <div className="grid grid-cols-2 gap-y-3 gap-x-2 mt-3 pt-3 border-t border-slate-200/60">
                      {/* Inspection Rounds */}
                      <div className="flex items-center gap-2 text-xs text-slate-600 font-medium">
                        {(plot.handover_cycle || 0) >= 2 ? (
                          <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />
                        ) : (
                          <Circle size={14} className="text-slate-300 shrink-0" />
                        )}
                        <span className="truncate">ตรวจครั้งที่ 1</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-slate-600 font-medium">
                        {(plot.handover_cycle || 0) >= 3 ? (
                          <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />
                        ) : (
                          <Circle size={14} className="text-slate-300 shrink-0" />
                        )}
                        <span className="truncate">ตรวจครั้งที่ 2</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-slate-400 font-medium opacity-60">
                        <Circle size={14} className="text-slate-200 shrink-0" />
                        <span className="truncate">ฉีดน้ำยาปลวก (เร็วๆนี้)</span>
                      </div>
                    </div>
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
    </div>
  );
}
