import React, { useState, useEffect, useMemo, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { buildProcurementIndex } from '@/lib/constructionProcurement';
import { useCommittedRequestScope } from '@/hooks/useCommittedRequestScope';
import { Users, Save, Loader2, Search, Check, Copy } from 'lucide-react';

export default function ProcurementDashboard({ projects, plots, taskTemplates, assignments, contractors, fetchAllData, loggedInUser }: any) {
  const [selectedProject, setSelectedProject] = useState('');
  const [selectedTask, setSelectedTask] = useState('');
  const index = useMemo(() => buildProcurementIndex(plots, taskTemplates, assignments), [plots, taskTemplates, assignments]);
  const taskNames = useMemo(() => Array.from(new Set<string>(taskTemplates.map((task: any) => task.task_name))).sort(), [taskTemplates]);
  const targetPlots = useMemo(() => {
    if (!selectedProject || !selectedTask) return [];
    const templates = index.tasksByNameAndHouse.get(selectedTask);
    return plots.filter((plot: any) => {
      if (plot.project_name !== selectedProject) return false;
      const template = templates?.get(plot.house_type_id);
      if (!template) return false;
      const assignment = index.assignmentsByPlotAndTask.get(plot.id)?.get(template.id);
      return !assignment || !assignment.contractor_name || assignment.contractor_name.trim() === '';
    }).sort((a: any, b: any) => (a.plot_name || '').localeCompare(b.plot_name || ''));
  }, [selectedProject, selectedTask, plots, index]);
  const editingScopeKey = JSON.stringify([selectedProject, selectedTask, loggedInUser?.id, loggedInUser?.authUserId, loggedInUser?.username, loggedInUser?.role]);
  const captureSelection = useCommittedRequestScope(editingScopeKey);
  const draftScope = useRef<string | null>(null);
  
  // State for the "Apply to All" fields
  const [globalName, setGlobalName] = useState('');
  const [globalPhone, setGlobalPhone] = useState('');

  // Edits map: plot_id -> { name, phone }
  const [edits, setEdits] = useState<Record<string, { name: string; phone: string }>>({});
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [saveStatus, setSaveStatus] = useState<{ type: 'success' | 'error' | '', message: '' | string }>({ type: '', message: '' });

  // Refresh eligible rows without erasing an in-progress draft for the same selection.
  useEffect(() => {
    const sameSelection = draftScope.current === editingScopeKey;
    draftScope.current = editingScopeKey;
    setEdits(previous => {
      const next: Record<string, { name: string; phone: string }> = {};
      targetPlots.forEach((plot: any) => { next[plot.id] = sameSelection && previous[plot.id] ? previous[plot.id] : { name: '', phone: '' }; });
      return next;
    });
    if (!sameSelection) {
      setIsSubmitting(false);
      setSaveStatus({ type: '', message: '' });
      setGlobalName('');
      setGlobalPhone('');
    }
  }, [editingScopeKey, targetPlots]);

  const handleEditChange = (plotId: string, field: 'name' | 'phone', value: string) => {
    setEdits(prev => {
      const match = field === 'name' ? contractors?.find((c: any) => c.name === value) : null;
      return {
        ...prev,
        [plotId]: {
          ...prev[plotId],
          [field]: value,
          // Auto-fill phone if we selected a known contractor and the phone field hasn't been manually overridden
          ...(match && match.phone && field === 'name' ? { phone: match.phone } : {})
        }
      };
    });
    if (saveStatus.message) setSaveStatus({ type: '', message: '' });
  };

  const handleGlobalNameChange = (val: string) => {
    setGlobalName(val);
    const match = contractors?.find((c: any) => c.name === val);
    if (match && match.phone) setGlobalPhone(match.phone);
  };

  const handleApplyToAll = () => {
    if (!globalName && !globalPhone) return;
    
    setEdits(prev => {
      const newEdits = { ...prev };
      Object.keys(newEdits).forEach(plotId => {
        newEdits[plotId] = {
          name: globalName || newEdits[plotId].name,
          phone: globalPhone || newEdits[plotId].phone
        };
      });
      return newEdits;
    });
  };

  const handleSave = async () => {
    const isCurrentSelection = captureSelection();
    if (!selectedProject || !selectedTask) return;
    
    // Filter out plots that have no changes (empty name AND empty phone)
    const plotsToUpdate = Object.keys(edits).filter(plotId => {
      return edits[plotId].name.trim() !== '' || edits[plotId].phone.trim() !== '';
    });

    if (plotsToUpdate.length === 0) {
      setSaveStatus({ type: 'error', message: 'กรุณากรอกข้อมูลช่างอย่างน้อย 1 แปลง' });
      return;
    }

    setIsSubmitting(true);
    setSaveStatus({ type: '', message: '' });

    try {
      // Fetch existing assignments for these plots to not overwrite other fields if we use upsert
      // Actually, upsert in Supabase overwrites the entire row if not careful, but we can do UPDATEs for existing, and INSERT for new.
      // A safer approach: check if assignment exists in our global state, then use update or insert.
      
      const matchingTemplates = index.tasksByNameAndHouse.get(selectedTask);

      const promises = plotsToUpdate.map(async (plotId) => {
        const plot = index.plotsById.get(plotId);
        const templateForThisPlot = matchingTemplates?.get(plot?.house_type_id);
        if (!plot || !templateForThisPlot) throw new Error('ไม่พบแปลงหรืองานที่เลือก กรุณาตรวจข้อมูลอีกครั้ง');

        const existingAssignment: any = index.assignmentsByPlotAndTask.get(plotId)?.get(templateForThisPlot.id);
        const { name, phone } = edits[plotId];
        
        if (existingAssignment) {
          // UPDATE
          return supabase
            .from('plot_task_assignments')
            .update({
              contractor_name: name.trim() || null,
              contractor_phone: phone.trim() || null,
              latest_update_created_at: new Date().toISOString()
            })
            .eq('id', existingAssignment.id);
        } else {
          // INSERT
          return supabase
            .from('plot_task_assignments')
            .insert([{
              plot_id: plotId,
              task_template_id: templateForThisPlot.id,
              contractor_name: name.trim() || null,
              contractor_phone: phone.trim() || null,
              current_progress: 0,
              latest_action: 'ระบุช่างรับเหมา',
              latest_role: 'Procurement',
              latest_update_created_at: new Date().toISOString()
            }]);
        }
      });

      const results = await Promise.all(promises);
      const failed = results.find(result => result?.error);
      
      // Refresh global state so the dashboard updates
      if (fetchAllData) {
        await fetchAllData();
      }
      if (failed?.error) throw failed.error;
      if (isCurrentSelection()) setSaveStatus({ type: 'success', message: 'บันทึกข้อมูลช่างเรียบร้อยแล้ว!' });
      
    } catch (err: any) {
      console.error(err);
      if (isCurrentSelection()) setSaveStatus({ type: 'error', message: 'เกิดข้อผิดพลาดในการบันทึกข้อมูล: ' + err.message });
    } finally {
      if (isCurrentSelection()) setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="p-6 border-b border-slate-100 bg-slate-50/50">
        <div className="flex items-center gap-3 mb-1">
          <div className="p-2 bg-emerald-100 text-emerald-600 rounded-lg">
            <Users className="w-5 h-5" />
          </div>
          <h2 className="text-lg font-bold text-slate-800">ระบบระบุช่างแบบรวดเร็ว (Bulk Contractor Assignment)</h2>
        </div>
        <p className="text-sm text-slate-500 ml-11">
          เลือกโครงการและงานเพื่อระบุช่างให้กับหลายแปลงพร้อมกันอย่างรวดเร็ว
        </p>
      </div>

      <datalist id="contractors-list">
        {contractors?.map((c: any) => (
          <option key={c.id} value={c.name} />
        ))}
      </datalist>

      <div className="p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">1. เลือกโครงการ</label>
            <select
              value={selectedProject}
              onChange={(e) => setSelectedProject(e.target.value)}
              className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
            >
              <option value="">-- กรุณาเลือกโครงการ --</option>
              {projects.map((p: any) => (
                <option key={p.name} value={p.name}>{p.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">2. เลือกงาน</label>
            <select
              value={selectedTask}
              onChange={(e) => setSelectedTask(e.target.value)}
              className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
              disabled={!selectedProject}
            >
              <option value="">-- กรุณาเลือกงาน --</option>
              {taskNames.map((taskName: string) => (
                <option key={taskName} value={taskName}>{taskName}</option>
              ))}
            </select>
          </div>
        </div>

        {selectedProject && selectedTask && (
          <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
            <div className="bg-slate-50 border-b border-slate-200 p-4 flex flex-col md:flex-row md:items-end gap-4 justify-between">
              <div>
                <h3 className="font-semibold text-slate-800">รายการแปลงที่ยังไม่ระบุช่าง ({targetPlots.length} แปลง)</h3>
                <p className="text-xs text-slate-500 mt-1">
                  พิมพ์ชื่อช่างที่ต้องการ แล้วกดบันทึก
                </p>
              </div>
              
              {/* Apply to All Section */}
              <div className="flex flex-col sm:flex-row items-end gap-2 bg-emerald-50 p-3 rounded-lg border border-emerald-100">
                <div className="flex flex-col sm:flex-row gap-2 w-full">
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-emerald-800 mb-1">ชื่อช่าง (ระบุทั้งหมด)</label>
                    <input 
                      type="text" 
                      list="contractors-list"
                      placeholder="ใส่ชื่อช่าง..." 
                      className="w-full text-sm p-2 border border-emerald-200 rounded outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400"
                      value={globalName}
                      onChange={(e) => handleGlobalNameChange(e.target.value)}
                    />
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-emerald-800 mb-1">เบอร์โทร (ระบุทั้งหมด)</label>
                    <input 
                      type="text" 
                      placeholder="ใส่เบอร์โทร..." 
                      className="w-full text-sm p-2 border border-emerald-200 rounded outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400"
                      value={globalPhone}
                      onChange={(e) => setGlobalPhone(e.target.value)}
                    />
                  </div>
                </div>
                <button 
                  onClick={handleApplyToAll}
                  className="px-3 py-2 bg-emerald-600 text-white text-sm font-medium rounded hover:bg-emerald-700 transition-colors flex items-center gap-1 shrink-0 h-[38px]"
                  title="เติมข้อมูลให้ทุกแปลงด้านล่าง"
                >
                  <Copy className="w-4 h-4" /> ใช้กับทั้งหมด
                </button>
              </div>
            </div>

            {targetPlots.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm text-slate-600">
                  <thead className="bg-slate-50 text-xs text-slate-500 font-semibold uppercase border-b border-slate-200">
                    <tr>
                      <th className="px-4 py-3 w-[15%]">แปลง</th>
                      <th className="px-4 py-3 w-[45%]">ชื่อช่างผู้รับเหมา</th>
                      <th className="px-4 py-3 w-[40%]">เบอร์โทรติดต่อ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {targetPlots.map((plot: any) => (
                      <tr key={plot.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-4 py-3 font-medium text-slate-800">
                          {plot.plot_name}
                        </td>
                        <td className="px-4 py-3">
                          <input 
                            type="text" 
                            list="contractors-list"
                            className="w-full p-2 border border-slate-200 rounded text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none transition-all"
                            placeholder="ระบุชื่อช่าง..."
                            value={edits[plot.id]?.name || ''}
                            onChange={(e) => handleEditChange(plot.id, 'name', e.target.value)}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <input 
                            type="text" 
                            className="w-full p-2 border border-slate-200 rounded text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none transition-all"
                            placeholder="ระบุเบอร์โทร..."
                            value={edits[plot.id]?.phone || ''}
                            onChange={(e) => handleEditChange(plot.id, 'phone', e.target.value)}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-8 text-center text-slate-500">
                <Search className="w-12 h-12 mx-auto text-slate-300 mb-3" />
                <p>ไม่พบแปลงที่ยังไม่ระบุช่างในงานนี้</p>
                <p className="text-xs text-slate-400 mt-1">ทุกแปลงอาจมีการระบุช่างเรียบร้อยแล้ว หรือยังไม่มีแปลงในโครงการนี้</p>
              </div>
            )}

            {/* Save Button */}
            {targetPlots.length > 0 && (
              <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
                <div>
                  {saveStatus.message && (
                    <div className={`text-sm font-medium flex items-center gap-1 ${saveStatus.type === 'error' ? 'text-rose-600' : 'text-emerald-600'}`}>
                      {saveStatus.type === 'success' && <Check className="w-4 h-4" />}
                      {saveStatus.message}
                    </div>
                  )}
                </div>
                <button
                  onClick={handleSave}
                  disabled={isSubmitting}
                  className="px-5 py-2.5 bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700 transition-colors flex items-center gap-2 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  {isSubmitting ? 'กำลังบันทึก...' : 'บันทึกข้อมูลช่าง'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
