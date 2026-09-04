import os
import re

handover_path = r'd:\buildtrack\buildtrack-mvp-main\components\HouseHandoverView.tsx'

with open(handover_path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Add props
content = content.replace(
    'isMobileLayout\n}: any) {',
    'isMobileLayout,\n  setView,\n  setSelectedDefect,\n  setDefectReturnView\n}: any) {'
)

# 2. Change onClick for rows to transition view
content = content.replace(
    'onClick={() => setSelectedDefect(defect)}',
    "onClick={() => { setSelectedDefect(defect); setDefectReturnView('house-detail'); setView('defect-progress'); }}"
)

# 3. Add states for scheduleInputs
if 'const [defectScheduleInputs, setDefectScheduleInputs] = useState<any>({});' not in content:
    content = content.replace(
        'const [isSubmitting, setIsSubmitting] = useState(false);',
        'const [isSubmitting, setIsSubmitting] = useState(false);\n  const [defectScheduleInputs, setDefectScheduleInputs] = useState<any>({});'
    )

# 4. Add handleSaveSchedules function
save_func = """
  const handleSaveDefectSchedules = async () => {
    setIsSubmitting(true);
    try {
      const payloads: any[] = [];
      Object.keys(defectScheduleInputs).forEach(defectId => {
        const plan = defectScheduleInputs[defectId];
        if (plan.start && plan.end) {
          payloads.push({ id: defectId, planned_start: plan.start, planned_end: plan.end });
        }
      });
      if (payloads.length === 0) {
        setIsSubmitting(false);
        alert('ไม่มีการแก้ไขข้อมูล หรือกรอกวันที่ไม่ครบครับ');
        return;
      }
      
      for (const p of payloads) {
        if (new Date(p.planned_end) < new Date(p.planned_start)) {
           throw new Error('วันสิ้นสุดต้องอยู่หลังวันเริ่มงานครับ');
        }
      }
      
      const { error } = await supabase.from('defects').upsert(payloads);
      if (error) throw error;
      
      alert('บันทึกแผนซ่อมทั้งหมดเรียบร้อยแล้ว');
      setDefectScheduleInputs({});
      if (fetchAllData) await fetchAllData();
    } catch (e: any) {
      alert('Error: ' + e.message);
    }
    setIsSubmitting(false);
  };
"""
if 'handleSaveDefectSchedules' not in content:
    content = content.replace('// === Gantt Chart Calculation ===', save_func + '\n  // === Gantt Chart Calculation ===')

# 5. Render "Save Plan" button
save_btn = """
          {['Admin', 'Project Planner', 'Owner'].includes(currentUserRole) && Object.keys(defectScheduleInputs).length > 0 && (
            <button onClick={handleSaveDefectSchedules} disabled={isSubmitting} className="bg-emerald-500 hover:bg-emerald-600 text-white font-bold px-4 py-2 rounded-xl shadow-md transition-all active:scale-95 flex items-center justify-center gap-2">
              {isSubmitting ? <Loader2 className="animate-spin" size={16}/> : 'บันทึกแผนซ่อม (Save)'}
            </button>
          )}
"""
content = content.replace(
    '</button>\n          )}',
    '</button>\n          )}\n' + save_btn
)

# 6. Replace Plan & Actual static text with inputs if user has permission
# In HouseHandoverView, we have:
# <div className="flex items-center gap-1 pb-1.5 mb-1.5 border-b border-dashed border-black/5">
#   <span className="text-[8px] font-bold uppercase text-slate-400 w-8 shrink-0 text-left">Plan:</span>
#   <div className="flex-1 text-[9px] sm:text-[11px] font-bold text-[#1d1d1f] text-center">
#      {defect.planned_start ? new Date(defect.planned_start).toLocaleDateString('en-GB',{day:'2-digit',month:'2-digit',year:'2-digit'}) : '-'}
#   </div>
# </div>
# <div className="flex items-center gap-1">
#   <span className="text-[8px] font-bold uppercase text-slate-400 w-8 shrink-0 text-left">Finish:</span>
#   <div className="flex-1 text-[9px] sm:text-[11px] font-bold text-[#1d1d1f] text-center">
#     {defect.planned_end ? new Date(defect.planned_end).toLocaleDateString('en-GB',{day:'2-digit',month:'2-digit',year:'2-digit'}) : '-'}
#   </div>
# </div>
# <div className="text-[9px] font-bold text-center mt-1 text-slate-500">({durationText})</div>

inputs_block = """
                            {['Project Planner', 'Admin', 'Owner'].includes(currentUserRole) ? (
                              <>
                                <div className="flex items-center gap-1 pb-1 mb-1 border-b border-dashed border-purple-200">
                                  <input type="date" value={defectScheduleInputs[defect.id]?.start || (defect.planned_start ? defect.planned_start.split('T')[0] : '')}
                                     onClick={(e) => e.stopPropagation()}
                                     onChange={(e) => {
                                        const newStart = e.target.value;
                                        let currentEnd = defectScheduleInputs[defect.id]?.end || (defect.planned_end ? defect.planned_end.split('T')[0] : '');
                                        let currentDuration = defectScheduleInputs[defect.id]?.duration || (dStartTs && dEndTs ? Math.ceil((dEndTs - dStartTs) / 86400000) + 1 : '');
                                        let newEnd = currentEnd;
                                        if (newStart && currentDuration && Number(currentDuration) > 0) {
                                           const d = new Date(newStart); d.setDate(d.getDate() + (Number(currentDuration) - 1));
                                           newEnd = d.toISOString().split('T')[0];
                                        }
                                        setDefectScheduleInputs((prev: any) => ({...prev, [defect.id]: { start: newStart, end: newEnd, duration: currentDuration }}));
                                     }} 
                                     className="w-full border border-purple-200 rounded px-1 py-0.5 text-[8px] sm:text-[9px] font-bold text-[#1d1d1f] outline-none focus:border-purple-500 bg-white shadow-sm" 
                                  />
                                </div>
                                <div className="flex items-center gap-1 pb-1 mb-1 border-b border-dashed border-purple-200">
                                  <input type="number" min="1" placeholder="วัน" value={defectScheduleInputs[defect.id]?.duration || (dStartTs && dEndTs ? Math.ceil((dEndTs - dStartTs) / 86400000) + 1 : '')} 
                                     onClick={(e) => e.stopPropagation()}
                                     onChange={(e) => {
                                        const newDuration = e.target.value;
                                        let currentStart = defectScheduleInputs[defect.id]?.start || (defect.planned_start ? defect.planned_start.split('T')[0] : '');
                                        let currentEnd = defectScheduleInputs[defect.id]?.end || (defect.planned_end ? defect.planned_end.split('T')[0] : '');
                                        let newEnd = currentEnd;
                                        if (currentStart && newDuration && Number(newDuration) > 0) {
                                           const d = new Date(currentStart); d.setDate(d.getDate() + (Number(newDuration) - 1));
                                           newEnd = d.toISOString().split('T')[0];
                                        }
                                        setDefectScheduleInputs((prev: any) => ({...prev, [defect.id]: { start: currentStart, end: newEnd, duration: newDuration }}));
                                     }}
                                     className="w-full border border-purple-200 rounded px-1 py-0.5 text-[8px] sm:text-[9px] font-bold text-center text-purple-600 outline-none focus:border-purple-500 bg-white shadow-sm" 
                                  />
                                </div>
                                <div className="flex items-center gap-1">
                                  <input type="date" value={defectScheduleInputs[defect.id]?.end || (defect.planned_end ? defect.planned_end.split('T')[0] : '')} 
                                     onClick={(e) => e.stopPropagation()}
                                     onChange={(e) => {
                                        const newEnd = e.target.value;
                                        let currentStart = defectScheduleInputs[defect.id]?.start || (defect.planned_start ? defect.planned_start.split('T')[0] : '');
                                        let currentDuration = defectScheduleInputs[defect.id]?.duration || (dStartTs && dEndTs ? Math.ceil((dEndTs - dStartTs) / 86400000) + 1 : '');
                                        let newDuration = currentDuration;
                                        if (currentStart && newEnd) {
                                           const diffTime = new Date(newEnd).getTime() - new Date(currentStart).getTime();
                                           newDuration = String(Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24))) + 1);
                                        }
                                        setDefectScheduleInputs((prev: any) => ({...prev, [defect.id]: { start: currentStart, end: newEnd, duration: newDuration }}));
                                     }} 
                                     className="w-full border border-purple-200 rounded px-1 py-0.5 text-[8px] sm:text-[9px] font-bold text-[#1d1d1f] outline-none focus:border-purple-500 bg-white shadow-sm text-center" 
                                  />
                                </div>
                              </>
                            ) : (
                              <>
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
                              </>
                            )}
"""

content = re.sub(
    r'<div className="flex items-center gap-1 pb-1\.5 mb-1\.5 border-b border-dashed border-black/5">.*?<div className="text-\[9px\] font-bold text-center mt-1 text-slate-500">\(\{durationText\}\)</div>',
    inputs_block,
    content,
    flags=re.DOTALL
)

# Note: Remove DefectProgressModal since we no longer use it.
content = re.sub(r'<DefectProgressModal.*?</DefectProgressModal>', '', content, flags=re.DOTALL)
content = content.replace("import DefectProgressModal from './DefectProgressModal';", "")

with open(handover_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("Patched HouseHandoverView.tsx")
