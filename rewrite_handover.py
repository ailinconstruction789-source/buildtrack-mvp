import os
import re

# 1. Patch HouseDetailView.tsx to pass isMobileLayout
detail_path = r'd:\buildtrack\buildtrack-mvp-main\components\HouseDetailView.tsx'
with open(detail_path, 'r', encoding='utf-8') as f:
    detail_content = f.read()

if 'isMobileLayout={isMobileLayout}' not in detail_content.split('<HouseHandoverView')[1]:
    detail_content = detail_content.replace(
        '<HouseHandoverView \n                         selectedPlot={selectedPlot} ',
        '<HouseHandoverView \n                         isMobileLayout={isMobileLayout}\n                         selectedPlot={selectedPlot} '
    )
    with open(detail_path, 'w', encoding='utf-8') as f:
        f.write(detail_content)
    print("Patched HouseDetailView.tsx")

# 2. Rewrite HouseHandoverView.tsx
handover_path = r'd:\buildtrack\buildtrack-mvp-main\components\HouseHandoverView.tsx'

new_code = """import React, { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { ShieldAlert, CheckCircle, PlusCircle, Loader2, Calendar, HardHat, Pickaxe, History } from 'lucide-react';
import DefectTaskSelectModal from './DefectTaskSelectModal';
import DefectProgressModal from './DefectProgressModal';

export default function HouseHandoverView({ 
  selectedPlot, 
  defects, 
  setDefects, 
  currentUserRole,
  resetHandoverCycle,
  updateInspectionRound,
  fetchAllData,
  taskTemplates,
  contractors,
  assignments,
  schedules,
  isMobileLayout
}: any) {
  const [isSelectModalOpen, setIsSelectModalOpen] = useState(false);
  const [selectedDefect, setSelectedDefect] = useState<any>(null);
  const [viewingRound, setViewingRound] = useState<number>(selectedPlot?.inspection_round || 1);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const cycle = selectedPlot.handover_cycle || 1;
  const currentRound = selectedPlot.inspection_round || 0;

  // Show defects only for the selected cycle and viewing round
  const roundDefects = defects.filter((d: any) => 
    d.plot_id === selectedPlot.id && 
    d.defect_stage === 'handover' &&
    d.handover_cycle === cycle &&
    d.inspection_round === viewingRound
  );

  const handleNextRound = async () => {
    if (confirm(`ยืนยันเริ่มการตรวจรอบที่ ${currentRound + 1} ใช่หรือไม่? \\n(งานที่ยังแก้ไม่เสร็จจะถูกยกยอดมารอบใหม่ด้วย)`)) {
      setIsSubmitting(true);
      try {
        const nextRound = currentRound + 1;
        await updateInspectionRound(selectedPlot.id, nextRound);
        
        // Carry over unresolved defects
        const unresolvedDefects = defects.filter((d: any) => 
          d.plot_id === selectedPlot.id && 
          d.defect_stage === 'handover' &&
          d.handover_cycle === cycle &&
          d.inspection_round === currentRound &&
          d.status === 'pending'
        );

        if (unresolvedDefects.length > 0) {
          const newCarryOvers = unresolvedDefects.map((d: any) => ({
            plot_id: selectedPlot.id,
            description: d.description,
            reported_by: currentUserRole,
            status: 'pending',
            defect_stage: 'handover',
            handover_cycle: cycle,
            inspection_round: nextRound,
            task_template_id: d.task_template_id,
            contractor_id: d.contractor_id // Keep original contractor
          }));
          await supabase.from('defects').insert(newCarryOvers);
        }
        
        setViewingRound(nextRound);
        if (fetchAllData) await fetchAllData();
      } catch (e: any) {
        alert('Error: ' + e.message);
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  const handleResetCycle = async () => {
    if (confirm("คุณแน่ใจหรือไม่ว่าต้องการรีเซ็ตการตรวจรับบ้าน? (ใช้กรณีลูกค้ายกเลิก/ทิ้งดาวน์) ข้อมูล Defect เดิมจะถูกเก็บเป็นประวัติรอบเก่า")) {
      await resetHandoverCycle(selectedPlot.id, cycle);
      setViewingRound(1);
    }
  };

  const handleSelectTasks = async (selectedTasks: any[]) => {
    if (currentRound === 0) {
      alert("กรุณากด 'เริ่มตรวจรอบที่ 1' ก่อนเพิ่มรายการ");
      return;
    }
    setIsSubmitting(true);
    try {
      const newDefects = selectedTasks.map(t => {
        // Auto assign original contractor if available
        const originalAssignment = assignments?.find((a: any) => a.task_template_id === t.id && a.plot_id === selectedPlot.id);
        const contractorId = originalAssignment?.contractor_id || null;

        return {
          plot_id: selectedPlot.id,
          description: `แก้: ${t.task_name}`,
          reported_by: currentUserRole,
          status: 'pending',
          defect_stage: 'handover',
          handover_cycle: cycle,
          inspection_round: currentRound,
          task_template_id: t.id,
          contractor_id: contractorId
        };
      });

      const { error } = await supabase.from('defects').insert(newDefects);
      if (error) throw error;
      
      setIsSelectModalOpen(false);
      if (fetchAllData) await fetchAllData();
    } catch (e: any) {
      alert("Error adding defects: " + e.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Build rounds list for history dropdown
  const roundsList = Array.from({length: currentRound}, (_, i) => i + 1).reverse();

  // === Gantt Chart Calculation ===
  let minStart = Infinity;
  let maxEnd = -Infinity;
  let hasDates = false;

  roundDefects.forEach((d: any) => {
    if (d.planned_start) {
      const ts = new Date(d.planned_start).getTime();
      if (ts < minStart) minStart = ts;
      hasDates = true;
    }
    if (d.planned_end) {
      const ts = new Date(d.planned_end).getTime();
      if (ts > maxEnd) maxEnd = ts;
      hasDates = true;
    }
  });

  const today = new Date();
  today.setHours(0,0,0,0);
  const todayTs = today.getTime();

  let chartStart = todayTs - (5 * 86400000);
  let chartEnd = todayTs + (25 * 86400000);

  if (hasDates) {
    if (minStart !== Infinity) chartStart = minStart - (5 * 86400000);
    if (maxEnd !== -Infinity) chartEnd = maxEnd + (5 * 86400000);
    // Ensure chartEnd >= chartStart
    if (chartEnd <= chartStart) chartEnd = chartStart + (30 * 86400000);
  }

  const totalChartDays = Math.round((chartEnd - chartStart) / 86400000) + 1;
  const totalChartMs = totalChartDays * 86400000;

  const getChartLeft = (timestamp: any) => {
    const d = new Date(timestamp); d.setHours(0, 0, 0, 0);
    return Math.max(0, ((d.getTime() - chartStart) / totalChartMs) * 100);
  };

  const getChartWidth = (startTs: any, endTs: any) => {
    const dStart = new Date(startTs); dStart.setHours(0, 0, 0, 0);
    const dEnd = new Date(endTs); dEnd.setHours(0, 0, 0, 0);
    return Math.max(0, (((dEnd.getTime() + 86400000) - dStart.getTime()) / totalChartMs) * 100);
  };

  const timeMarkers: any[] = [];
  let current = new Date(chartStart);
  while (current.getTime() <= chartEnd) {
    const currentMonthStr = current.toLocaleDateString('th-TH', { month: 'short', year: '2-digit' });
    let monthLabel = null;
    if (current.getDate() === 1 || current.getTime() === chartStart) {
        monthLabel = currentMonthStr;
    }
    timeMarkers.push({
      dayLabel: current.getDate(),
      monthLabel: monthLabel,
      isMonth: current.getDate() === 1,
      left: getChartLeft(current.getTime())
    });
    current.setDate(current.getDate() + 1);
  }

  return (
    <div className="bg-[#f5f5f7] rounded-3xl p-4 sm:p-6 shadow-sm border border-black/5 animate-fade-in mt-6">
      {/* Header */}
      <div className="bg-white rounded-2xl p-4 sm:p-6 mb-4 sm:mb-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shadow-sm border border-slate-100 relative overflow-hidden">
        <div className="absolute top-0 left-0 w-2 h-full bg-purple-500"></div>
        <div className="pl-2">
          <h2 className="text-lg sm:text-xl font-black text-slate-800 flex items-center gap-2">
            <ShieldAlert className="text-purple-500" /> ตรวจรับบ้าน (Handover)
          </h2>
          <div className="flex flex-wrap items-center gap-2 mt-1.5">
            <span className="text-[11px] font-bold text-purple-600 bg-purple-50 px-2 py-0.5 rounded-full border border-purple-100">รอบการขาย: Cycle {cycle}</span>
            <span className="text-[11px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full border border-slate-200">รอบการตรวจ: {currentRound === 0 ? 'ยังไม่เริ่ม' : `Round ${currentRound}`}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3 w-full md:w-auto">
          {currentUserRole !== 'Owner' && currentUserRole !== 'Admin' ? null : (
            <button onClick={handleResetCycle} className="text-[10px] sm:text-xs font-bold text-rose-500 bg-rose-50 px-3 py-2 rounded-lg hover:bg-rose-100 border border-rose-100 transition-colors flex items-center gap-1.5">
              <History size={14}/> ลูกค้ายกเลิก
            </button>
          )}
          {['Admin', 'Site Engineer', 'QC', 'Owner'].includes(currentUserRole) && (
            <button onClick={handleNextRound} disabled={isSubmitting} className="w-full md:w-auto bg-purple-600 hover:bg-purple-700 text-white text-xs sm:text-sm font-bold px-5 py-2.5 rounded-xl shadow-md transition-all active:scale-95 flex items-center justify-center gap-2 disabled:opacity-50">
              {isSubmitting ? <Loader2 className="animate-spin" size={16}/> : currentRound === 0 ? 'เริ่มตรวจรอบที่ 1 >' : `เริ่มตรวจรอบที่ ${currentRound + 1} >`}
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-4 mb-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-white p-4 rounded-xl border border-black/5 shadow-sm">
           <button 
             onClick={() => setIsSelectModalOpen(true)}
             disabled={currentRound === 0}
             className="w-full sm:w-auto bg-purple-50 border border-purple-200 text-purple-600 hover:bg-purple-100 px-4 py-2 rounded-xl font-bold flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
           >
             <PlusCircle size={18} /> เพิ่มรายการแจ้งซ่อม (ลูกค้า)
           </button>
           
           <div className="flex items-center gap-2 w-full sm:w-auto">
             <span className="text-[10px] sm:text-xs font-bold text-slate-500 shrink-0">เลือกดูรอบตรวจ:</span>
             <select 
                value={viewingRound}
                onChange={(e) => setViewingRound(parseInt(e.target.value))}
                className="bg-white border border-slate-300 text-slate-700 font-bold text-sm rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-purple-500 outline-none w-full sm:w-auto"
             >
               {roundsList.length === 0 ? (
                 <option value={1}>รอบที่ 1</option>
               ) : (
                 roundsList.map(r => (
                   <option key={r} value={r}>
                     {r === currentRound ? `📌 ปัจจุบัน (รอบที่ ${r})` : `ย้อนหลัง (รอบที่ ${r})`}
                   </option>
                 ))
               )}
             </select>
           </div>
        </div>
      </div>

      {/* 🌟 GANTT CHART TABLE 🌟 */}
      <div className="bg-white rounded-2xl shadow-xl border border-black/5 overflow-hidden flex flex-col relative h-[500px]">
          <div className="overflow-x-auto overflow-y-auto w-full h-full custom-scrollbar relative">
             <table className="w-full border-collapse min-w-max relative z-0">
               <thead className="bg-[#f5f5f7] sticky top-0 z-[50] shadow-sm">
                 <tr>
                   <th className={`sticky left-0 bg-[#f5f5f7] z-[65] border-b border-r border-black/5 p-3 sm:p-5 text-left ${isMobileLayout ? 'w-[220px] min-w-[220px] max-w-[220px]' : 'w-[280px] min-w-[280px] max-w-[280px]'} shadow-[4px_0_10px_-4px_rgba(0,0,0,0.1)] text-[#1d1d1f]`}>
                     รายละเอียดงานซ่อม (Defect)
                   </th>
                   
                   <th className={`sticky ${isMobileLayout ? 'left-[220px]' : 'left-[280px]'} bg-[#f5f5f7] z-[65] border-b border-r border-black/5 p-3 sm:p-5 text-center w-[120px] sm:w-[140px] min-w-[120px] sm:min-w-[140px] max-w-[120px] sm:max-w-[140px] text-[#1d1d1f]`}>
                     แผน & ทำจริง
                   </th>
                   
                   {/* Timeline Header */}
                   <th className="bg-[#f5f5f7] border-b border-black/5 p-0 relative w-full z-[60]" style={{ minWidth: `${totalChartDays * 36}px`, height: isMobileLayout ? '40px' : '56px' }}>
                      {todayTs >= chartStart && todayTs <= chartEnd && (
                         <div className="absolute top-0 bottom-0 border-l-2 sm:border-l-[3px] border-dashed border-rose-500 z-[10] flex flex-col items-center pointer-events-none" style={{ left: `${getChartLeft(todayTs)}%` }}>
                            <span className="bg-rose-500 text-white text-[7px] sm:text-[11px] font-bold px-1.5 sm:px-2.5 py-0.5 sm:py-1 rounded-b-md sm:rounded-b-lg shadow-md mt-0 sm:mt-1">ปัจจุบัน</span>
                         </div>
                      )}
                      <div className="absolute inset-0 flex pointer-events-none">
                         {timeMarkers.map((marker, i) => (
                            <div key={i} className={`absolute flex flex-col items-center justify-end h-full pb-1 border-l border-black/5 ${marker.isMonth ? 'border-black/20' : ''}`} style={{ left: `${marker.left}%`, width: `calc(100% / ${totalChartDays})` }}>
                               {marker.monthLabel && ( <span className={`text-[8px] sm:text-[10px] font-bold text-blue-600 absolute ${isMobileLayout ? 'top-0' : 'top-1'} whitespace-nowrap bg-blue-50 px-1 rounded`}>{marker.monthLabel}</span> )}
                               <span className={`text-[9px] sm:text-[11px] ${marker.isMonth ? 'font-black text-slate-800' : 'font-bold text-slate-400'}`}>{marker.dayLabel}</span>
                            </div>
                         ))}
                      </div>
                   </th>
                 </tr>
               </thead>
               
               <tbody>
                  {roundDefects.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="text-center py-20 text-slate-400 sticky left-0 z-10 w-full">
                        <CheckCircle size={48} className="mx-auto mb-3 opacity-20" />
                        <p className="font-bold">ไม่มีรายการแจ้งซ่อมในรอบนี้</p>
                      </td>
                    </tr>
                  ) : (
                    roundDefects.map((defect: any) => {
                      const taskTemp = taskTemplates?.find((t:any) => t.id === defect.task_template_id);
                      const contractor = contractors?.find((c:any) => c.id === defect.contractor_id);
                      const isPending = defect.status === 'pending';
                      
                      const dStartTs = defect.planned_start ? new Date(defect.planned_start).getTime() : null;
                      const dEndTs = defect.planned_end ? new Date(defect.planned_end).getTime() : null;

                      let durationText = '-';
                      if (dStartTs && dEndTs) {
                          const diff = dEndTs - dStartTs;
                          durationText = `${Math.max(0, Math.ceil(diff / (86400000))) + 1} วัน`;
                      }

                      return (
                        <tr key={defect.id} className="group transition-colors cursor-pointer table-row bg-white hover:bg-slate-50/80" onClick={() => setSelectedDefect(defect)}>
                          {/* Col 1: Detail */}
                          <td className={`p-2 sm:p-3 border-b border-black/5 ${isMobileLayout ? 'h-[100px] w-[220px] min-w-[220px] max-w-[220px] z-[45]' : 'h-[110px] w-[280px] min-w-[280px] max-w-[280px] z-20'} flex flex-col justify-between bg-white sticky left-0 shadow-[4px_0_10px_-4px_rgba(0,0,0,0.1)]`}>
                             <div className="min-w-0">
                                <div className="flex items-start gap-1.5">
                                   <span className={`text-[10px] sm:text-[11px] font-black shrink-0 bg-[#f5f5f7] px-1.5 py-0.5 rounded border mt-0.5 ${isPending ? 'text-rose-500 border-rose-100' : 'text-emerald-500 border-emerald-100'}`}>
                                     {isPending ? 'รอซ่อม' : '✅ เสร็จ'}
                                   </span>
                                   <h4 className={`font-bold text-xs sm:text-sm leading-tight text-ellipsis overflow-hidden [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical] ${isPending ? 'text-[#1d1d1f]' : 'text-slate-400 line-through'}`} title={taskTemp?.task_name || defect.description}>
                                      {taskTemp?.task_name || defect.description}
                                   </h4>
                                </div>
                             </div>
                             
                             <div className="flex flex-col gap-1 mt-1 border-t border-slate-100 pt-1">
                                <div className="flex items-center gap-1.5">
                                    <div className="w-5 h-5 rounded-full bg-blue-50 border border-blue-200 flex items-center justify-center shrink-0">
                                        <HardHat size={11} className="text-blue-600"/>
                                    </div>
                                    <div className="flex flex-col min-w-0 flex-1">
                                        <span className="text-[10px] sm:text-xs font-bold text-blue-700 truncate">{contractor?.name ? contractor.name.split(' ')[0] : 'ยังไม่ระบุช่าง'}</span>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <div className="w-full bg-[#f5f5f7] rounded-full h-1.5 max-w-[80px]">
                                      <div className={`h-full rounded-full transition-all duration-1000 ${defect.progress === 100 ? 'bg-gradient-to-r from-emerald-400 to-emerald-500' : 'bg-gradient-to-r from-purple-500 to-indigo-500'}`} style={{ width: `${defect.progress || 0}%` }}></div>
                                  </div>
                                  <span className="text-[9px] sm:text-[10px] font-bold text-[#86868b]">{defect.progress || 0}%</span>
                                </div>
                             </div>
                          </td>
                          
                          {/* Col 2: Dates */}
                          <td className={`sticky ${isMobileLayout ? 'left-[220px]' : 'left-[280px]'} bg-white z-[40] border-b border-r border-black/5 p-1.5 sm:p-2 align-middle w-[120px] sm:w-[140px] min-w-[120px] sm:min-w-[140px] max-w-[120px] sm:max-w-[140px] shadow-[6px_0_10px_-6px_rgba(0,0,0,0.1)]`}>
                            <div className="flex items-center gap-1 pb-1.5 mb-1.5 border-b border-dashed border-black/5">
                              <span className="text-[8px] font-bold uppercase text-slate-400 w-8 shrink-0 text-left">Plan:</span>
                              <div className="flex-1 text-[9px] sm:text-[11px] font-bold text-[#1d1d1f] text-center">
                                 {defect.planned_start ? new Date(defect.planned_start).toLocaleDateString('en-GB',{day:'2-digit',month:'2-digit',year:'2-digit'}) : '-'}
                              </div>
                            </div>
                            <div className="flex items-center gap-1">
                              <span className="text-[8px] font-bold uppercase text-slate-400 w-8 shrink-0 text-left">Finish:</span>
                              <div className="flex-1 text-[9px] sm:text-[11px] font-bold text-[#1d1d1f] text-center">
                                {defect.planned_end ? new Date(defect.planned_end).toLocaleDateString('en-GB',{day:'2-digit',month:'2-digit',year:'2-digit'}) : '-'}
                              </div>
                            </div>
                            <div className="text-[9px] font-bold text-center mt-1 text-slate-500">({durationText})</div>
                          </td>

                          {/* Col 3: Gantt Chart */}
                          <td className="border-b border-black/5 p-0 relative z-10 w-full" style={{ minWidth: `${totalChartDays * 36}px`, height: isMobileLayout ? '100px' : '110px' }}>
                             <div className="absolute inset-0 pointer-events-none z-0" style={{ 
                                  backgroundImage: `repeating-linear-gradient(to right, transparent, transparent calc(100% / ${totalChartDays} - 1px), #f1f5f9 calc(100% / ${totalChartDays} - 1px), #f1f5f9 calc(100% / ${totalChartDays}))`,
                                  backgroundSize: `calc(100% / ${totalChartDays}) 100%`
                               }}>
                                {todayTs >= chartStart && todayTs <= chartEnd && ( <div className="absolute top-0 bottom-0 border-l-2 sm:border-l-[3px] border-dashed border-rose-500/80 z-[15] pointer-events-none" style={{ left: `${getChartLeft(todayTs)}%` }}></div> )}
                             </div>
                             
                             <div className="relative w-full h-full flex flex-col px-0">
                                {dStartTs && dEndTs && ( 
                                   <div className={`absolute h-4 rounded-sm z-[20] shadow-sm opacity-90 ${isPending ? 'bg-purple-500' : 'bg-emerald-500'}`} style={{ left: `${getChartLeft(dStartTs)}%`, width: `${getChartWidth(dStartTs, dEndTs)}%`, top: '40%' }}>
                                      <span className="absolute -top-4 text-[8px] sm:text-[9px] font-bold text-[#86868b] bg-white/95 border border-black/5 px-1 py-0 rounded shadow-sm" style={{ left: '2px' }}>{defect.progress || 0}%</span>
                                   </div> 
                                )}
                             </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
               </tbody>
             </table>
          </div>
      </div>

      <DefectTaskSelectModal 
        isOpen={isSelectModalOpen} 
        onClose={() => setIsSelectModalOpen(false)} 
        taskTemplates={taskTemplates}
        selectedPlot={selectedPlot}
        onSelectTask={handleSelectTasks}
      />

      <DefectProgressModal
        isOpen={!!selectedDefect}
        onClose={() => setSelectedDefect(null)}
        defect={selectedDefect}
        taskTemplate={taskTemplates?.find((t:any) => t.id === selectedDefect?.task_template_id)}
        contractors={contractors}
        currentUserRole={currentUserRole}
        onDefectUpdated={async () => {
            if (fetchAllData) await fetchAllData();
        }}
      />
    </div>
  );
}
"""

with open(handover_path, 'w', encoding='utf-8') as f:
    f.write(new_code)
print("Rewrote HouseHandoverView.tsx")
