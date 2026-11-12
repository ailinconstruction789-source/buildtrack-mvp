// ==============================================================================
// 🎯 BUILDTRACK: QC SCOPE & BULK ASSIGNMENT MODAL (กำหนดการใช้งานฟอร์ม QC)
// ==============================================================================

import React, { useState, useEffect } from 'react';
import { 
  X, Check, AlertTriangle, CheckCircle, ShieldAlert, ArrowRight, 
  Layers, Filter, Users, RefreshCw, Loader2, Sparkles, AlertCircle, Eye 
} from 'lucide-react';
import { previewScopeAssignment, confirmScopeAssignment, ScopePreviewResult } from '@/lib/qc/qcConfigService';
import { supabase } from '@/lib/supabase';
import { QCStandardSet, QCFormTemplate, QCReferenceDrawing } from '@/types/qc.types';

interface QCScopeAssignmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedProject: string;
  plots: any[];
  houseTypes: any[];
  taskTemplates: any[];
  currentUserRole: string;
  loggedInUsername: string;
  onAssigned: () => void;
}

export default function QCScopeAssignmentModal({
  isOpen,
  onClose,
  selectedProject,
  plots = [],
  houseTypes = [],
  taskTemplates = [],
  currentUserRole,
  loggedInUsername,
  onAssigned
}: QCScopeAssignmentModalProps) {
  // Wizard Steps: 1 = Filter & Selection, 2 = Preview Impact, 3 = Confirmation Result
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Selected State
  const [selectedTaskName, setSelectedTaskName] = useState<string>('');
  const [selectedHouseTypeFilter, setSelectedHouseTypeFilter] = useState<string>('ทั้งหมด');
  const [selectedPlotIds, setSelectedPlotIds] = useState<string[]>([]);
  const [includeFuturePlots, setIncludeFuturePlots] = useState<boolean>(false);
  const [replaceExistingOverrides, setReplaceExistingOverrides] = useState<boolean>(false);

  // Form & Drawing Set
  const [availableSets, setAvailableSets] = useState<QCStandardSet[]>([]);
  const [chosenSetId, setChosenSetId] = useState<string>('');

  // Loading & Preview Data
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewData, setPreviewData] = useState<{
    totalSelected: number;
    eligibleCount: number;
    skippedStartedCount: number;
    incompleteCount: number;
    items: ScopePreviewResult[];
  } | null>(null);

  // Confirming state
  const [isConfirming, setIsConfirming] = useState(false);
  const [confirmResult, setConfirmResult] = useState<{
    success: boolean;
    assignedCount: number;
    skippedCount: number;
    details: any[];
  } | null>(null);

  // Fetch standard sets for selected task
  useEffect(() => {
    if (!isOpen || !selectedProject) return;

    async function loadSets() {
      const { data } = await supabase
        .from('qc_standard_sets')
        .select('*, form_template:qc_form_templates(*), reference_drawing:qc_reference_drawings(*)')
        .eq('project_name', selectedProject)
        .eq('is_active', true);

      setAvailableSets(data || []);
    }
    loadSets();
    setStep(1);
    setPreviewData(null);
    setConfirmResult(null);
    setSelectedPlotIds([]);
  }, [isOpen, selectedProject]);

  // Distinct tasks
  const distinctTasks = Array.from(new Set(taskTemplates.map(t => t.task_name)));

  // Filter plots
  const projectPlots = plots.filter(p => p.project_name === selectedProject);
  const filteredPlots = projectPlots.filter(p => {
    if (selectedHouseTypeFilter === 'ทั้งหมด') return true;
    return p.house_type_id === selectedHouseTypeFilter;
  });

  // Toggle select plot
  const handleTogglePlot = (plotId: string) => {
    setSelectedPlotIds(prev => 
      prev.includes(plotId) ? prev.filter(id => id !== plotId) : [...prev, plotId]
    );
  };

  const handleSelectAllFiltered = () => {
    const ids = filteredPlots.map(p => p.id);
    setSelectedPlotIds(ids);
  };

  const handleClearSelected = () => {
    setSelectedPlotIds([]);
  };

  // Run Preview Impact
  const handleRunPreview = async () => {
    if (!selectedTaskName) {
      alert('กรุณาเลือกประเภทงาน');
      return;
    }
    if (selectedPlotIds.length === 0) {
      alert('กรุณาเลือกแปลงที่ต้องการกำหนดอย่างน้อย 1 แปลง');
      return;
    }

    const chosenSet = availableSets.find(s => s.id === chosenSetId);
    const targetTaskTemplate = taskTemplates.find(t => t.task_name === selectedTaskName);
    const taskTemplateId = targetTaskTemplate?.id || selectedTaskName;

    setLoadingPreview(true);
    try {
      const preview = await previewScopeAssignment({
        projectName: selectedProject,
        selectedPlotIds,
        taskTemplateId,
        taskName: selectedTaskName,
        standardSetId: chosenSetId,
        requirePlotDrawing: chosenSet?.require_plot_drawing
      });

      setPreviewData(preview);
      setStep(2);
    } catch (err: any) {
      alert(err.message || 'เกิดข้อผิดพลาดในการตรวจสอบผลกระทบ');
    } finally {
      setLoadingPreview(false);
    }
  };

  // Confirm Scope Assignment
  const handleConfirmAssignment = async () => {
    const chosenSet = availableSets.find(s => s.id === chosenSetId);
    if (!chosenSet || !chosenSet.form_template_id) {
      alert('ชุดตรวจมาตรฐานยังไม่ได้ระบุแม่แบบฟอร์ม');
      return;
    }

    const targetTaskTemplate = taskTemplates.find(t => t.task_name === selectedTaskName);
    const taskTemplateId = targetTaskTemplate?.id || selectedTaskName;

    setIsConfirming(true);
    try {
      const res = await confirmScopeAssignment({
        projectName: selectedProject,
        selectedPlotIds,
        taskTemplateId,
        taskName: selectedTaskName,
        formTemplateId: chosenSet.form_template_id,
        formVersion: chosenSet.form_version,
        drawingId: chosenSet.drawing_id,
        drawingVersion: chosenSet.drawing_version,
        selectedPages: chosenSet.selected_pages || [],
        requirePlotDrawing: chosenSet.require_plot_drawing,
        replaceOverrides: replaceExistingOverrides,
        actorUsername: loggedInUsername,
        actorRole: currentUserRole
      });

      setConfirmResult(res);
      setStep(3);
      onAssigned();
    } catch (err: any) {
      alert(err.message || 'บันทึกการกำหนดสิทธิ์ไม่สำเร็จ');
    } finally {
      setIsConfirming(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 z-[999] animate-in fade-in">
      <div className="bg-white rounded-3xl max-w-4xl w-full h-[90vh] flex flex-col overflow-hidden shadow-2xl border border-slate-200">
        {/* Header */}
        <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="bg-purple-600 p-2 rounded-xl">
              <Layers size={20} />
            </div>
            <div>
              <h3 className="font-bold text-base">กำหนดการใช้งานฟอร์ม QC (Scope & Bulk Assignment)</h3>
              <p className="text-xs text-slate-400">โครงการ: {selectedProject} • เปิดใช้เฉพาะแปลงและงานที่เลือกอย่างปลอดภัย</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-white rounded-lg"><X size={20} /></button>
        </div>

        {/* Steps Progress */}
        <div className="bg-slate-50 px-6 py-3 border-b border-slate-200 flex items-center justify-between shrink-0 text-xs font-bold">
          <div className="flex items-center gap-4">
            <span className={`flex items-center gap-1.5 ${step === 1 ? 'text-purple-600' : 'text-slate-500'}`}>
              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${step === 1 ? 'bg-purple-600 text-white' : 'bg-slate-200 text-slate-700'}`}>1</span>
              เลือกแปลงและชุดตรวจ
            </span>
            <ArrowRight size={14} className="text-slate-300" />
            <span className={`flex items-center gap-1.5 ${step === 2 ? 'text-purple-600' : 'text-slate-500'}`}>
              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${step === 2 ? 'bg-purple-600 text-white' : 'bg-slate-200 text-slate-700'}`}>2</span>
              ตรวจสอบผลกระทบ (Preview)
            </span>
            <ArrowRight size={14} className="text-slate-300" />
            <span className={`flex items-center gap-1.5 ${step === 3 ? 'text-purple-600' : 'text-slate-500'}`}>
              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${step === 3 ? 'bg-purple-600 text-white' : 'bg-slate-200 text-slate-700'}`}>3</span>
              ผลการบันทึก
            </span>
          </div>
        </div>

        {/* Step Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {step === 1 && (
            <div className="space-y-5 max-w-3xl mx-auto">
              {/* Task Selector */}
              <div className="bg-white p-5 rounded-2xl border border-slate-200 space-y-3 shadow-sm">
                <label className="text-xs font-bold text-slate-700 block">1. เลือกประเภทงานที่ต้องการเปิดใช้ฟอร์มใหม่</label>
                <select
                  value={selectedTaskName}
                  onChange={(e) => {
                    setSelectedTaskName(e.target.value);
                    const matched = availableSets.find(s => s.task_name === e.target.value);
                    if (matched) setChosenSetId(matched.id);
                  }}
                  className="w-full border border-slate-200 rounded-xl p-3 text-xs font-bold text-slate-800 bg-slate-50 outline-none focus:border-purple-500"
                >
                  <option value="">-- กรุณาเลือกประเภทงาน --</option>
                  {distinctTasks.map(tName => (
                    <option key={tName} value={tName}>{tName}</option>
                  ))}
                </select>
              </div>

              {/* Set Selector */}
              {selectedTaskName && (
                <div className="bg-white p-5 rounded-2xl border border-slate-200 space-y-3 shadow-sm">
                  <label className="text-xs font-bold text-slate-700 block">2. เลือกชุดตรวจมาตรฐานของงานนี้</label>
                  {availableSets.filter(s => s.task_name === selectedTaskName).length === 0 ? (
                    <p className="text-xs text-amber-600 bg-amber-50 p-3 rounded-xl border border-amber-200 font-bold">
                      ⚠️ ยังไม่มีการตั้งชุดตรวจมาตรฐานสำหรับงานนี้ในโครงการ กรุณาไปที่แท็บ "ชุดตรวจมาตรฐาน" ก่อน
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {availableSets.filter(s => s.task_name === selectedTaskName).map(s => {
                        const htName = houseTypes.find(ht => ht.id === s.house_type_id)?.type_name || s.house_type_id;
                        return (
                          <label
                            key={s.id}
                            className={`p-3 rounded-xl border flex items-center justify-between cursor-pointer transition-all ${
                              chosenSetId === s.id ? 'border-purple-600 bg-purple-50/40 ring-1 ring-purple-600' : 'border-slate-200 hover:bg-slate-50'
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              <input
                                type="radio"
                                name="chosenSet"
                                checked={chosenSetId === s.id}
                                onChange={() => setChosenSetId(s.id)}
                                className="text-purple-600"
                              />
                              <div>
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200 px-1.5 py-0.5 rounded">
                                    🏠 {htName}
                                  </span>
                                  <p className="text-xs font-bold text-slate-800">{s.set_name}</p>
                                </div>
                                <p className="text-[10px] text-slate-500 mt-0.5">
                                  ฟอร์ม: {s.form_template?.title} (v{s.form_version}) • แปลน: {s.reference_drawing?.title || 'แบบอ้างอิงตามแบบบ้าน/ทิศซ้าย-ขวา'}
                                </p>
                              </div>
                            </div>
                            {s.require_plot_drawing && (
                              <span className="text-[10px] font-bold bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full shrink-0">
                                บังคับแบบเฉพาะแปลง
                              </span>
                            )}
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Plot Selection & Filter */}
              {selectedTaskName && chosenSetId && (
                <div className="bg-white p-5 rounded-2xl border border-slate-200 space-y-3 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2">
                    <label className="text-xs font-bold text-slate-700">3. เลือกแปลงเป้าหมาย (เลือกแล้ว {selectedPlotIds.length} แปลง)</label>
                    <div className="flex items-center gap-2">
                      <select
                        value={selectedHouseTypeFilter}
                        onChange={(e) => setSelectedHouseTypeFilter(e.target.value)}
                        className="text-xs font-bold border border-slate-200 rounded-lg p-1 bg-slate-50"
                      >
                        <option value="ทั้งหมด">แบบบ้าน: ทั้งหมด</option>
                        {houseTypes.map(ht => (
                          <option key={ht.id} value={ht.id}>{ht.type_name}</option>
                        ))}
                      </select>
                      <button onClick={handleSelectAllFiltered} className="text-xs text-purple-600 hover:underline font-bold">เลือกทั้งหมด</button>
                      <button onClick={handleClearSelected} className="text-xs text-slate-400 hover:underline">ล้าง</button>
                    </div>
                  </div>

                  {/* Plot Pills */}
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 max-h-48 overflow-y-auto p-1">
                    {filteredPlots.map(p => {
                      const isSelected = selectedPlotIds.includes(p.id);
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => handleTogglePlot(p.id)}
                          className={`p-2 rounded-xl text-xs font-bold border text-center transition-all ${
                            isSelected 
                              ? 'bg-purple-600 text-white border-purple-600 shadow-sm' 
                              : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                          }`}
                        >
                          {p.plot_name || p.id}
                        </button>
                      );
                    })}
                  </div>

                  {/* Checkbox Options */}
                  <div className="pt-3 border-t border-slate-100 space-y-2 text-xs">
                    <label className="flex items-center gap-2 cursor-pointer text-slate-700">
                      <input
                        type="checkbox"
                        checked={replaceExistingOverrides}
                        onChange={(e) => setReplaceExistingOverrides(e.target.checked)}
                        className="rounded text-purple-600"
                      />
                      <span className="font-bold">แทนที่การตั้งค่าเฉพาะแปลงเดิม (หากไม่ติ๊ก จะคงค่าเฉพาะแปลงไว้)</span>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer text-slate-500">
                      <input
                        type="checkbox"
                        checked={includeFuturePlots}
                        onChange={(e) => setIncludeFuturePlots(e.target.checked)}
                        className="rounded text-purple-600"
                      />
                      <span>รวมแปลงที่จะเพิ่มในอนาคตโดยอัตโนมัติ (เป็นตัวเลือกแยก ไม่ติ๊กโดยปริยาย)</span>
                    </label>
                  </div>
                </div>
              )}
            </div>
          )}

          {step === 2 && previewData && (
            /* Step 2: Impact Preview */
            <div className="space-y-4 max-w-3xl mx-auto">
              <div className="bg-purple-50 p-4 rounded-2xl border border-purple-200">
                <h4 className="font-bold text-purple-900 text-sm">สรุปผลกระทบก่อนยืนยันเปิดใช้งานฟอร์มใหม่</h4>
                <p className="text-xs text-purple-700 mt-0.5">
                  ระบบตรวจสอบประวัติการตรวจจริงและล็อกวิธีตรวจเดิมอัตโนมัติ เพื่อไม่ให้กระทบประวัติย้อนหลัง
                </p>
              </div>

              {/* Statistics Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-center">
                <div className="bg-white p-4 rounded-2xl border border-emerald-200 shadow-sm">
                  <p className="text-[10px] font-bold text-slate-400 uppercase">จะเปลี่ยนเป็นฟอร์มใหม่</p>
                  <p className="text-2xl font-bold text-emerald-600 mt-1">{previewData.eligibleCount} แปลง</p>
                  <p className="text-[10px] text-slate-500 mt-1">ยังไม่เคยเริ่มตรวจ</p>
                </div>
                <div className="bg-white p-4 rounded-2xl border border-amber-200 shadow-sm">
                  <p className="text-[10px] font-bold text-slate-400 uppercase">ข้าม (คงระบบเดิม)</p>
                  <p className="text-2xl font-bold text-amber-600 mt-1">{previewData.skippedStartedCount} แปลง</p>
                  <p className="text-[10px] text-slate-500 mt-1">เริ่มตรวจไปแล้ว</p>
                </div>
                <div className="bg-white p-4 rounded-2xl border border-rose-200 shadow-sm">
                  <p className="text-[10px] font-bold text-slate-400 uppercase">ยังไม่พร้อมตรวจ</p>
                  <p className="text-2xl font-bold text-rose-600 mt-1">{previewData.incompleteCount} แปลง</p>
                  <p className="text-[10px] text-slate-500 mt-1">ขาดแบบเฉพาะแปลง</p>
                </div>
              </div>

              {/* Detailed Plot Table */}
              <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
                <div className="max-h-72 overflow-y-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-100 text-slate-500 uppercase text-[10px]">
                        <th className="py-2.5 px-4">แปลง</th>
                        <th className="py-2.5 px-4">ผลการวิเคราะห์</th>
                        <th className="py-2.5 px-4">การดำเนินการ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {previewData.items.map(it => (
                        <tr key={it.plotId} className="hover:bg-slate-50">
                          <td className="py-2.5 px-4 font-bold text-slate-800">{it.plotName}</td>
                          <td className="py-2.5 px-4">
                            <span className={`px-2 py-0.5 rounded-full font-bold text-[10px] ${
                              it.status === 'eligible' ? 'bg-emerald-100 text-emerald-700' :
                              it.status === 'already_started' ? 'bg-amber-100 text-amber-700' :
                              'bg-rose-100 text-rose-700'
                            }`}>
                              {it.reason}
                            </span>
                          </td>
                          <td className="py-2.5 px-4 text-slate-600 font-bold">
                            {it.status === 'eligible' ? '✅ เปิดใช้ระบบฟอร์มใหม่' : '🔒 คงระบบเดิม'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {step === 3 && confirmResult && (
            /* Step 3: Confirmation Outcome */
            <div className="max-w-md mx-auto text-center space-y-4 py-8">
              <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto shadow-inner">
                <CheckCircle size={36} />
              </div>
              <h3 className="font-bold text-slate-800 text-lg">บันทึกการกำหนดฟอร์ม QC เรียบร้อยแล้ว</h3>
              <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 text-xs space-y-1 text-slate-600">
                <p>จำนวนแปลงที่เปิดใช้ระบบใหม่: <span className="font-bold text-emerald-600">{confirmResult.assignedCount} แปลง</span></p>
                <p>จำนวนแปลงที่ข้าม (คงระบบเดิม): <span className="font-bold text-amber-600">{confirmResult.skippedCount} แปลง</span></p>
              </div>
              <button
                onClick={onClose}
                className="px-6 py-2.5 bg-slate-900 text-white rounded-xl text-xs font-bold hover:bg-slate-800"
              >
                เสร็จสิ้น
              </button>
            </div>
          )}
        </div>

        {/* Footer Navigation */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between shrink-0">
          {step === 1 && (
            <>
              <button onClick={onClose} className="text-xs font-bold text-slate-500 hover:text-slate-800">ยกเลิก</button>
              <button
                onClick={handleRunPreview}
                disabled={loadingPreview || !selectedTaskName || !chosenSetId || selectedPlotIds.length === 0}
                className="px-5 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-md disabled:opacity-40"
              >
                {loadingPreview ? <Loader2 className="animate-spin" size={14} /> : <Eye size={14} />}
                <span>ดูผลกระทบก่อนยืนยัน (Preview Impact)</span>
              </button>
            </>
          )}

          {step === 2 && (
            <>
              <button onClick={() => setStep(1)} className="text-xs font-bold text-slate-500 hover:text-slate-800">ย้อนกลับไปแก้ไข</button>
              <button
                onClick={handleConfirmAssignment}
                disabled={isConfirming || previewData?.eligibleCount === 0}
                className="px-6 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-md disabled:opacity-40"
              >
                {isConfirming ? <Loader2 className="animate-spin" size={14} /> : <Check size={14} />}
                <span>ยืนยันการเปิดใช้งาน ({previewData?.eligibleCount} แปลง)</span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
