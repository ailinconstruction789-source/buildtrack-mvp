import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Users, Save, Loader2, Search, Check, Copy } from 'lucide-react';

export default function ProcurementDashboard({ projects, plots, taskTemplates, assignments, contractors, fetchAllData }: any) {
  const [selectedProject, setSelectedProject] = useState('');
  const [selectedTask, setSelectedTask] = useState('');
  const [targetPlots, setTargetPlots] = useState<any[]>([]);
  
  // State for the "Apply to All" fields
  const [globalName, setGlobalName] = useState('');
  const [globalPhone, setGlobalPhone] = useState('');

  // Edits map: plot_id -> { name, phone }
  const [edits, setEdits] = useState<Record<string, { name: string; phone: string }>>({});
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [saveStatus, setSaveStatus] = useState<{ type: 'success' | 'error' | '', message: '' | string }>({ type: '', message: '' });

  // 1. Filter plots based on project and task selection
  useEffect(() => {
    if (selectedProject && selectedTask) {
      // Get all plots in the selected project
      const projPlots = plots.filter((p: any) => p.project_name === selectedProject);
      
      // Filter plots that DO NOT have a contractor assigned for this specific task
      const unassignedPlots = projPlots.filter((p: any) => {
        const matchingTemplates = taskTemplates.filter((t: any) => t.task_name === selectedTask);
        const templateForThisPlot = matchingTemplates.find((t: any) => t.house_type_id === p.house_type_id);
        
        if (!templateForThisPlot) return false;

        const assignment = assignments.find((a: any) => a.plot_id === p.id && a.task_template_id === templateForThisPlot.id);
        // If no assignment exists, or it exists but contractor_name is empty/null, include it.
        return !assignment || !assignment.contractor_name || assignment.contractor_name.trim() === '';
      });

      // Sort plots by name (e.g. A01, A02)
      unassignedPlots.sort((a: any, b: any) => (a.plot_name || '').localeCompare(b.plot_name || ''));

      setTargetPlots(unassignedPlots);
      
      // Initialize edits state
      const initialEdits: Record<string, { name: string; phone: string }> = {};
      unassignedPlots.forEach((p: any) => {
        initialEdits[p.id] = { name: '', phone: '' };
      });
      setEdits(initialEdits);
      setSaveStatus({ type: '', message: '' });
      setGlobalName('');
      setGlobalPhone('');
    } else {
      setTargetPlots([]);
      setEdits({});
    }
  }, [selectedProject, selectedTask, plots, assignments]);

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
      
      const matchingTemplates = taskTemplates.filter((t: any) => t.task_name === selectedTask);

      const promises = plotsToUpdate.map(async (plotId) => {
        const plot = plots.find((p: any) => p.id === plotId);
        const templateForThisPlot = matchingTemplates.find((t: any) => t.house_type_id === plot?.house_type_id);
        if (!templateForThisPlot) return null;

        const existingAssignment = assignments.find((a: any) => a.plot_id === plotId && a.task_template_id === templateForThisPlot.id);
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

      await Promise.all(promises);

      setSaveStatus({ type: 'success', message: 'บันทึกข้อมูลช่างเรียบร้อยแล้ว!' });
      
      // Refresh global state so the dashboard updates
      if (fetchAllData) {
        await fetchAllData();
      }
      
    } catch (err: any) {
      console.error(err);
      setSaveStatus({ type: 'error', message: 'เกิดข้อผิดพลาดในการบันทึกข้อมูล: ' + err.message });
    } finally {
      setIsSubmitting(false);
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
              {Array.from(new Set(taskTemplates.map((t: any) => t.task_name))).sort().map((taskName: any) => (
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
