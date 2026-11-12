// ==============================================================================
// 🏡 BUILDTRACK: QC PLOT TASK TAB (แท็บฟอร์มและแบบ QC ในหน้ารายละเอียดแปลง)
// ==============================================================================

import React, { useState, useEffect } from 'react';
import { 
  FileText, MapPin, CheckCircle, AlertTriangle, Settings, Eye, RotateCcw, 
  ExternalLink, Layers, ShieldCheck, ChevronRight, Check, X 
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { QCPlotTaskConfig, QCFormTemplate, QCReferenceDrawing } from '@/types/qc.types';
import { resolveTaskInspectionConfig } from '@/lib/qc/qcConfigService';
import QCFormLibraryModal from './QCFormLibraryModal';
import QCDrawingLibraryModal from './QCDrawingLibraryModal';

interface QCPlotTaskTabProps {
  plot: any;
  taskTemplates: any[];
  currentUserRole: string;
  loggedInUsername: string;
  onPreviewTaskQC?: (task: any) => void;
}

export default function QCPlotTaskTab({
  plot,
  taskTemplates = [],
  currentUserRole,
  loggedInUsername,
  onPreviewTaskQC
}: QCPlotTaskTabProps) {
  const [taskConfigs, setTaskConfigs] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);

  // Modals for override
  const [formModalOpen, setFormModalOpen] = useState(false);
  const [drawingModalOpen, setDrawingModalOpen] = useState(false);
  const [activeTaskTarget, setActiveTaskTarget] = useState<any>(null);

  const canEdit = currentUserRole === 'Admin' || currentUserRole === 'Owner' || currentUserRole === 'QC';

  // Load configuration resolutions for all tasks of this plot
  const loadPlotTasksQC = async () => {
    if (!plot) return;
    setLoading(true);
    const resolutions: Record<string, any> = {};

    for (const task of taskTemplates) {
      try {
        const res = await resolveTaskInspectionConfig({
          projectName: plot.project_name,
          plotId: plot.id,
          houseTypeId: plot.house_type_id,
          taskTemplateId: task.id,
          taskName: task.task_name
        });
        resolutions[task.id] = res;
      } catch (err) {
        resolutions[task.id] = { state: 'load_error', inspectionMethod: 'legacy', sourceLabel: 'เกิดข้อผิดพลาด' };
      }
    }

    setTaskConfigs(resolutions);
    setLoading(false);
  };

  useEffect(() => {
    loadPlotTasksQC();
  }, [plot?.id, taskTemplates]);

  // Handle Plot Specific Override: Select Form
  const handleSelectFormOverride = async (tmpl: QCFormTemplate) => {
    if (!activeTaskTarget) return;

    try {
      const payload: Partial<QCPlotTaskConfig> = {
        project_name: plot.project_name,
        plot_id: plot.id,
        task_template_id: activeTaskTarget.id,
        task_name: activeTaskTarget.task_name,
        inspection_method: 'form_v2',
        is_active: true,
        form_template_id: tmpl.id,
        form_version: tmpl.version,
        is_plot_override: true,
        created_by: loggedInUsername,
        updated_at: new Date().toISOString()
      };

      await supabase.from('qc_plot_task_configs').upsert(payload, { onConflict: 'plot_id,task_template_id' });
      await loadPlotTasksQC();
      setActiveTaskTarget(null);
    } catch (err: any) {
      alert(err.message || 'บันทึกการปรับเฉพาะแปลงไม่สำเร็จ');
    }
  };

  // Handle Plot Specific Override: Select Drawing
  const handleSelectDrawingOverride = async (draw: QCReferenceDrawing) => {
    if (!activeTaskTarget) return;

    try {
      const payload = {
        drawing_id: draw.id,
        drawing_version: draw.version,
        is_plot_override: true,
        updated_at: new Date().toISOString()
      };

      await supabase.from('qc_plot_task_configs')
        .update(payload)
        .eq('plot_id', plot.id)
        .eq('task_template_id', activeTaskTarget.id);

      await loadPlotTasksQC();
      setActiveTaskTarget(null);
    } catch (err: any) {
      alert(err.message || 'บันทึกแบบเฉพาะแปลงไม่สำเร็จ');
    }
  };

  // Revert Plot Override to Standard
  const handleRevertToStandard = async (task: any) => {
    if (!confirm(`คุณต้องการลบการปรับแต่งเฉพาะแปลงของงาน "${task.task_name}" และกลับไปใช้มาตรฐานโครงการหรือไม่?`)) return;

    try {
      await supabase
        .from('qc_plot_task_configs')
        .delete()
        .eq('plot_id', plot.id)
        .eq('task_template_id', task.id);

      await loadPlotTasksQC();
    } catch (err: any) {
      alert(err.message || 'ไม่สามารถคืนค่าเป็นมาตรฐานได้');
    }
  };

  return (
    <div className="space-y-4">
      {/* Overview Banner */}
      <div className="bg-gradient-to-r from-purple-900 to-indigo-900 text-white p-5 rounded-2xl shadow-md flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="bg-purple-600 px-2 py-0.5 rounded text-[10px] font-mono font-bold">QC FORM V2</span>
            <h3 className="font-bold text-base">ระบบฟอร์มและแบบแปลน QC เฉพาะแปลง ({plot.plot_name || plot.id})</h3>
          </div>
          <p className="text-xs text-purple-200 mt-1">
            โครงการ: {plot.project_name} • แบบบ้าน: {plot.house_types?.type_name || plot.house_type_id}
          </p>
        </div>
      </div>

      {/* Task List */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 text-slate-500 uppercase text-[10px] border-b border-slate-200">
                <th className="py-3 px-4">ประเภทงาน</th>
                <th className="py-3 px-4">วิธีตรวจ (Method)</th>
                <th className="py-3 px-4">ฟอร์มตรวจ</th>
                <th className="py-3 px-4">แบบอ้างอิง</th>
                <th className="py-3 px-4">แหล่งที่มา</th>
                <th className="py-3 px-4 text-center">ความพร้อม</th>
                {canEdit && <th className="py-3 px-4 text-right">ปรับแต่ง</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {taskTemplates.map(task => {
                const res = taskConfigs[task.id];
                const isV2 = res?.inspectionMethod === 'form_v2';
                const isReady = res?.state === 'form_v2_ready';
                const isLocked = res?.isLocked;
                const isOverride = res?.config?.is_plot_override;

                return (
                  <tr key={task.id} className="hover:bg-slate-50">
                    <td className="py-3 px-4 font-bold text-slate-800">{task.task_name}</td>
                    <td className="py-3 px-4">
                      {isV2 ? (
                        <span className="bg-purple-100 text-purple-700 font-bold px-2 py-0.5 rounded-full text-[10px]">
                          ฟอร์มตรวจใหม่
                        </span>
                      ) : (
                        <span className="bg-slate-100 text-slate-600 font-bold px-2 py-0.5 rounded-full text-[10px]">
                          ระบบตรวจเดิม
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      {isV2 && res?.formTemplate ? (
                        <div className="font-bold text-slate-700 truncate max-w-[160px]">
                          {res.formTemplate.title} (v{res.formTemplate.version})
                        </div>
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      {isV2 && res?.referenceDrawing ? (
                        <div className="text-slate-700 truncate max-w-[160px]">
                          {res.referenceDrawing.drawing_number} (v{res.referenceDrawing.version})
                        </div>
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-[11px] font-bold text-slate-600">
                      {res?.sourceLabel || 'ระบบเดิม'}
                    </td>
                    <td className="py-3 px-4 text-center">
                      {isV2 ? (
                        <span className={`px-2 py-0.5 rounded-full font-bold text-[10px] ${
                          isReady ? 'bg-emerald-100 text-emerald-700' :
                          res?.state === 'incomplete_config' ? 'bg-amber-100 text-amber-700' :
                          'bg-rose-100 text-rose-700'
                        }`}>
                          {isReady ? 'พร้อมตรวจ' : res?.state === 'incomplete_config' ? 'ยังตั้งค่าไม่ครบ' : 'เกิดข้อผิดพลาด'}
                        </span>
                      ) : (
                        <span className="text-slate-400 text-[10px]">ตามระบบเดิม</span>
                      )}
                    </td>

                    {/* Actions */}
                    {canEdit && (
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {isV2 && isReady && onPreviewTaskQC && (
                            <button
                              onClick={() => onPreviewTaskQC(task)}
                              className="p-1 text-purple-600 hover:text-purple-800 hover:bg-purple-50 rounded"
                              title="ดูหน้าตรวจ"
                            >
                              <Eye size={14} />
                            </button>
                          )}

                          {!isLocked && (
                            <button
                              onClick={() => {
                                setActiveTaskTarget(task);
                                setFormModalOpen(true);
                              }}
                              className="px-2 py-1 bg-purple-50 hover:bg-purple-100 text-purple-700 rounded text-[10px] font-bold"
                            >
                              ปรับฟอร์ม
                            </button>
                          )}

                          {!isLocked && (
                            <button
                              onClick={() => {
                                setActiveTaskTarget(task);
                                setDrawingModalOpen(true);
                              }}
                              className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-[10px] font-bold"
                            >
                              ปรับแบบ
                            </button>
                          )}

                          {isOverride && !isLocked && (
                            <button
                              onClick={() => handleRevertToStandard(task)}
                              className="p-1 text-slate-400 hover:text-slate-700 rounded"
                              title="กลับไปใช้มาตรฐานโครงการ"
                            >
                              <RotateCcw size={12} />
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Form Library Selector Modal */}
      <QCFormLibraryModal
        isOpen={formModalOpen}
        onClose={() => setFormModalOpen(false)}
        onSelectTemplate={handleSelectFormOverride}
        currentUserRole={currentUserRole}
        loggedInUsername={loggedInUsername}
      />

      {/* Drawing Library Selector Modal */}
      <QCDrawingLibraryModal
        isOpen={drawingModalOpen}
        onClose={() => setDrawingModalOpen(false)}
        onSelectDrawing={handleSelectDrawingOverride}
        currentUserRole={currentUserRole}
        loggedInUsername={loggedInUsername}
        projectName={plot.project_name}
      />
    </div>
  );
}
