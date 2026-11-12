// ==============================================================================
// 📋 BUILDTRACK: QC INSPECTION RUNNER COMPONENT (หน้าตรวจงานแบบฟอร์มใหม่)
// ==============================================================================

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  CheckCircle, XCircle, AlertTriangle, Clock, Camera, Save, Send, ShieldCheck, 
  MapPin, FileText, ChevronRight, ArrowLeft, RefreshCw, AlertCircle, Eye, 
  RotateCcw, Check, Plus, Trash2, Loader2, Sparkles, Image as ImageIcon
} from 'lucide-react';
import { 
  QCFormTemplate, 
  QCReferenceDrawing, 
  QCInspection, 
  QCInspectionAnswer, 
  QCDrawingAnnotation, 
  QCFormItem,
  QCTaskConfigResolution 
} from '@/types/qc.types';
import { 
  saveInspectionDraft, 
  submitInspection, 
  approveInspection, 
  createRetestRound, 
  reopenInspection,
  evaluateInspectionAnswers 
} from '@/lib/qc/qcInspectionService';
import QCDrawingViewer from './QCDrawingViewer';

interface QCInspectionRunnerProps {
  resolution: QCTaskConfigResolution;
  plotId: string;
  plotLabel?: string;
  projectName: string;
  taskTemplateId: string;
  taskName: string;
  houseTypeId: string;
  loggedInUser: { username: string; id?: string; role?: string };
  currentUserRole: string;
  onBack: () => void;
  onInspectionUpdated: () => void;
  isMobileLayout?: boolean;
  previewOnly?: boolean;
  initialTab?: 'form' | 'drawing';
  onTabChange?: (tab: 'form' | 'drawing') => void;
}

export default function QCInspectionRunner({
  resolution,
  plotId,
  plotLabel,
  projectName,
  taskTemplateId,
  taskName,
  houseTypeId,
  loggedInUser,
  currentUserRole,
  onBack,
  onInspectionUpdated,
  isMobileLayout = false,
  previewOnly = false,
  initialTab = 'form',
  onTabChange
}: QCInspectionRunnerProps) {
  const formTemplate = resolution.formTemplate;
  const referenceDrawing = resolution.referenceDrawing;
  const initialInspection = resolution.latestInspection;

  const [activeTab, setActiveTab] = useState<'form' | 'drawing'>(initialTab);
  const handleTabChange = (tab: 'form' | 'drawing') => {
    setActiveTab(tab);
    onTabChange?.(tab);
  };
  const [currentInspection, setCurrentInspection] = useState<QCInspection | null>(initialInspection || null);
  const [answers, setAnswers] = useState<QCInspectionAnswer[]>(() => {
    if (initialInspection?.answers && initialInspection.answers.length > 0) {
      return initialInspection.answers;
    }
    // สร้างคำตอบเริ่มต้นจาก form items
    return (formTemplate?.items || []).map(item => ({
      form_item_id: item.id,
      item_code: item.item_code,
      item_text: item.item_text,
      item_type: item.item_type,
      is_critical: item.is_critical,
      status: 'uninspected',
      numeric_value: null,
      unit: item.unit || '',
      text_value: '',
      selected_options: [],
      photo_urls: [],
      remarks: ''
    }));
  });

  const [annotations, setAnnotations] = useState<QCDrawingAnnotation[]>(
    initialInspection?.annotations || []
  );

  const [isSaving, setIsSaving] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [reopenModalOpen, setReopenModalOpen] = useState(false);
  const [reopenReason, setReopenReason] = useState('');
  const [selectedPhotoPreview, setSelectedPhotoPreview] = useState<string | null>(null);

  const isQC = currentUserRole === 'QC';
  const isAdmin = currentUserRole === 'Admin' || currentUserRole === 'Owner';
  const isReadOnly = Boolean(previewOnly) || (currentInspection?.document_status === 'approved' && !reopenModalOpen);

  // Real-time evaluation calculation
  const currentEvaluation = useMemo(() => {
    if (!formTemplate?.items) return null;
    return evaluateInspectionAnswers(formTemplate.items, answers, annotations);
  }, [formTemplate, answers, annotations]);

  // Update specific answer
  const handleAnswerChange = (itemId: string, patch: Partial<QCInspectionAnswer>) => {
    if (isReadOnly) return;
    setAnswers(prev => prev.map(a => a.form_item_id === itemId ? { ...a, ...patch } : a));
  };

  // Add Annotation Pin
  const handleAddAnnotation = (pin: QCDrawingAnnotation) => {
    if (isReadOnly) return;
    setAnnotations(prev => [...prev, pin]);
  };

  // Delete Annotation Pin
  const handleDeleteAnnotation = (index: number) => {
    if (isReadOnly) return;
    setAnnotations(prev => prev.filter((_, i) => i !== index));
  };

  // Save Draft
  const handleSaveDraft = async () => {
    if (!formTemplate) return;
    setIsSaving(true);
    setStatusMessage(null);

    const res = await saveInspectionDraft({
      inspectionId: currentInspection?.id,
      projectName,
      plotId,
      taskTemplateId,
      taskName,
      roundNumber: currentInspection?.round_number || 1,
      previousInspectionId: currentInspection?.previous_inspection_id,
      formTemplate,
      drawing: referenceDrawing ? { id: referenceDrawing.id, version: referenceDrawing.version, title: referenceDrawing.title } : null,
      inspectorName: loggedInUser.username,
      inspectorRole: currentUserRole,
      answers,
      annotations,
      notes: currentInspection?.notes || '',
      photoUrls: []
    });

    setIsSaving(false);
    if (res.success) {
      setStatusMessage({ text: 'บันทึกร่างเรียบร้อยแล้ว', type: 'success' });
      if (!currentInspection?.id) {
        setCurrentInspection(prev => ({
          ...(prev || {} as any),
          id: res.inspectionId,
          document_status: 'draft',
          round_number: 1
        }));
      }
      setTimeout(() => setStatusMessage(null), 2500);
    } else {
      setStatusMessage({ text: res.error || 'บันทึกร่างไม่สำเร็จ', type: 'error' });
    }
  };

  // Submit Inspection
  const handleSubmitInspection = async () => {
    if (!formTemplate?.items) return;

    // First auto-save draft if needed to get an inspection ID
    let activeInspectionId = currentInspection?.id;
    if (!activeInspectionId) {
      const draftRes = await saveInspectionDraft({
        projectName,
        plotId,
        taskTemplateId,
        taskName,
        roundNumber: currentInspection?.round_number || 1,
        formTemplate,
        drawing: referenceDrawing ? { id: referenceDrawing.id, version: referenceDrawing.version, title: referenceDrawing.title } : null,
        inspectorName: loggedInUser.username,
        inspectorRole: currentUserRole,
        answers,
        annotations
      });
      if (!draftRes.success) {
        setStatusMessage({ text: 'บันทึกร่างไม่สำเร็จก่อนส่งผลตรวจ', type: 'error' });
        return;
      }
      activeInspectionId = draftRes.inspectionId;
    }

    setIsSubmitting(true);
    const subRes = await submitInspection({
      inspectionId: activeInspectionId,
      items: formTemplate.items,
      answers,
      annotations,
      actorUsername: loggedInUser.username,
      actorRole: currentUserRole
    });
    setIsSubmitting(false);

    if (subRes.success) {
      setStatusMessage({ text: 'ส่งผลการตรวจเรียบร้อยแล้ว รอดำเนินการรับรอง', type: 'success' });
      setCurrentInspection(prev => prev ? ({ ...prev, document_status: 'submitted', inspection_result: subRes.evaluation.overallResult }) : null);
      onInspectionUpdated();
    } else {
      setStatusMessage({ text: subRes.error || 'ไม่สามารถส่งผลตรวจได้เนื่องจากข้อมูลยังไม่ครบถ้วน', type: 'error' });
    }
  };

  // Approve / Reject
  const handleApproveAction = async (decision: 'approve' | 'reject') => {
    if (!currentInspection) return;
    setIsApproving(true);

    const appRes = await approveInspection({
      inspection: currentInspection,
      answers,
      actorUsername: loggedInUser.username,
      actorRole: currentUserRole,
      decision
    });

    setIsApproving(false);
    if (appRes.success) {
      setStatusMessage({ 
        text: decision === 'approve' ? 'อนุมัติผ่านงาน QC เรียบร้อยแล้ว (Progress 100%)' : 'แจ้งแก้ไขงานไปยังผู้เกี่ยวข้องแล้ว (Progress 95%)', 
        type: 'success' 
      });
      setCurrentInspection(prev => prev ? ({
        ...prev,
        document_status: decision === 'approve' ? 'approved' : 'rejected',
        inspection_result: decision === 'approve' ? 'passed' : 'failed'
      }) : null);
      onInspectionUpdated();
    } else {
      setStatusMessage({ text: appRes.error || 'เกิดข้อผิดพลาดในการประเมินผล', type: 'error' });
    }
  };

  // Create Retest Round
  const handleCreateRetest = async () => {
    if (!currentInspection) return;
    setIsSaving(true);

    const retestRes = await createRetestRound({
      previousInspection: currentInspection,
      previousAnswers: answers,
      actorUsername: loggedInUser.username,
      actorRole: currentUserRole
    });

    setIsSaving(false);
    if (retestRes.success && retestRes.newInspectionId) {
      setStatusMessage({ text: `สร้างรอบตรวจซ้ำ (รอบที่ ${currentInspection.round_number + 1}) เรียบร้อยแล้ว`, type: 'success' });
      setCurrentInspection({
        ...currentInspection,
        id: retestRes.newInspectionId,
        round_number: currentInspection.round_number + 1,
        previous_inspection_id: currentInspection.id,
        document_status: 'draft',
        inspection_result: null
      });
      // reset answers for failed items
      setAnswers(prev => prev.map(a => a.status === 'failed' ? { ...a, status: 'uninspected', remarks: '' } : a));
      onInspectionUpdated();
    } else {
      setStatusMessage({ text: retestRes.error || 'ไม่สามารถสร้างรอบตรวจซ้ำได้', type: 'error' });
    }
  };

  // Reopen Inspection
  const handleReopen = async () => {
    if (!currentInspection) return;
    const res = await reopenInspection({
      inspectionId: currentInspection.id,
      reason: reopenReason,
      actorUsername: loggedInUser.username,
      actorRole: currentUserRole
    });

    if (res.success) {
      setReopenModalOpen(false);
      setReopenReason('');
      setCurrentInspection({ ...currentInspection, document_status: 'draft' });
      setStatusMessage({ text: 'เปิดผลการตรวจกลับมาแก้ไขเรียบร้อยแล้ว', type: 'success' });
      onInspectionUpdated();
    } else {
      setStatusMessage({ text: res.error || 'ไม่สามารถเปิดผลตรวจกลับมาแก้ไขได้', type: 'error' });
    }
  };

  if (!formTemplate) {
    return (
      <div className="p-8 text-center bg-white rounded-2xl border border-slate-200">
        <AlertTriangle className="text-amber-500 mx-auto mb-3" size={36} />
        <h3 className="font-bold text-slate-800 text-lg">ยังไม่ได้ตั้งค่าแม่แบบฟอร์มตรวจ</h3>
        <p className="text-sm text-slate-500 mt-1">กรุณาติดต่อ Admin เพื่อเลือกฟอร์มตรวจสำหรับงานนี้</p>
        <button onClick={onBack} className="mt-4 px-4 py-2 bg-slate-800 text-white rounded-xl text-xs font-bold">ย้อนกลับ</button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-slate-50 rounded-2xl overflow-hidden border border-slate-200 shadow-xl">
      {/* 🌟 Header Section 🌟 */}
      <header className="bg-slate-900 text-white p-4 sm:p-5 flex flex-wrap items-center justify-between gap-3 shrink-0 border-b-4 border-b-purple-600">
        <div className="flex items-center gap-3">
          <button 
            onClick={onBack} 
            className="p-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-slate-300 hover:text-white transition-colors"
            title="ย้อนกลับ"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <span className="bg-purple-600 text-white font-mono text-[10px] px-2 py-0.5 rounded-full font-bold">
                QC ฟอร์มใหม่
              </span>
              {previewOnly ? (
                <span className="bg-amber-400/20 text-amber-200 border border-amber-400/40 text-[10px] px-2 py-0.5 rounded-full font-bold flex items-center gap-1">
                  <Eye size={10} /> ตัวอย่างสำหรับ Admin (ดูอย่างเดียว)
                </span>
              ) : (
                <>
                  <span className="text-[11px] text-slate-400 font-mono">
                    รอบที่ {currentInspection?.round_number || 1}
                  </span>
                  {currentInspection?.document_status === 'approved' && (
                    <span className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 text-[10px] px-2 py-0.5 rounded-full font-bold flex items-center gap-1">
                      <CheckCircle size={10} /> รับรองแล้ว (Approved)
                    </span>
                  )}
                  {currentInspection?.document_status === 'rejected' && (
                    <span className="bg-rose-500/20 text-rose-400 border border-rose-500/40 text-[10px] px-2 py-0.5 rounded-full font-bold flex items-center gap-1">
                      <XCircle size={10} /> แจ้งแก้ไข (Rework)
                    </span>
                  )}
                  {currentInspection?.document_status === 'submitted' && (
                    <span className="bg-amber-500/20 text-amber-400 border border-amber-500/40 text-[10px] px-2 py-0.5 rounded-full font-bold flex items-center gap-1">
                      <Clock size={10} /> รอตรวจทาน (Submitted)
                    </span>
                  )}
                </>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap mt-0.5">
              <h2 className="text-sm sm:text-base font-bold text-white tracking-wide">
                {(plotLabel || plotId) ? `${taskName} - แปลง ${plotLabel || plotId}` : taskName}
              </h2>
              {resolution.garageOrientation === 'left' && (
                <span className="px-2 py-0.5 bg-blue-500/25 text-blue-300 border border-blue-500/30 rounded-md text-[10px] font-bold">
                  🚗 โรงจอดรถซ้าย
                </span>
              )}
              {resolution.garageOrientation === 'right' && (
                <span className="px-2 py-0.5 bg-purple-500/25 text-purple-300 border border-purple-500/30 rounded-md text-[10px] font-bold">
                  🚗 โรงจอดรถขวา
                </span>
              )}
            </div>
            <p className="text-[10px] text-slate-400">
              ฟอร์ม: {formTemplate.title} (v{formTemplate.version}) • {resolution.sourceLabel}
            </p>
          </div>
        </div>

        {/* Tab switchers & Action buttons */}
        <div className="flex items-center gap-2">
          {/* Tab switches */}
          <div className="bg-slate-800 p-1 rounded-xl flex items-center gap-1 border border-slate-700">
            <button
              onClick={() => handleTabChange('form')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all ${
                activeTab === 'form' 
                  ? 'bg-purple-600 text-white shadow-md' 
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <FileText size={14} />
              <span>รายการตรวจ ({answers.filter(a => a.status !== 'uninspected').length}/{answers.length})</span>
            </button>
            {referenceDrawing && (
              <button
                onClick={() => handleTabChange('drawing')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all ${
                  activeTab === 'drawing' 
                    ? 'bg-purple-600 text-white shadow-md' 
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <MapPin size={14} />
                <span>แบบแปลนและจุดวัด ({annotations.length})</span>
              </button>
            )}
          </div>

          {/* Save / Submit buttons */}
          {!isReadOnly && (
            <>
              <button
                onClick={handleSaveDraft}
                disabled={isSaving}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all disabled:opacity-50"
                title="บันทึกร่าง"
              >
                {isSaving ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />}
                <span className="hidden sm:inline">บันทึกร่าง</span>
              </button>

              <button
                onClick={handleSubmitInspection}
                disabled={isSubmitting || !currentEvaluation?.isValid}
                className="px-4 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-md transition-all disabled:opacity-40"
              >
                {isSubmitting ? <Loader2 className="animate-spin" size={14} /> : <Send size={14} />}
                <span>ส่งผลตรวจ</span>
              </button>
            </>
          )}

          {/* Reopen Button for Admin */}
          {!previewOnly && currentInspection?.document_status === 'approved' && isAdmin && (
            <button
              onClick={() => setReopenModalOpen(true)}
              className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-md"
            >
              <RotateCcw size={14} />
              <span>เปิดผลกลับมาแก้</span>
            </button>
          )}
        </div>
      </header>

      {/* 🌟 Preview Mode Banner (View Only for Admin) 🌟 */}
      {previewOnly && (
        <div className="px-4 py-2.5 bg-amber-50 border-b border-amber-200 text-amber-900 text-xs font-bold flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2">
            <Eye size={15} className="text-amber-700 shrink-0" />
            <span>
              โหมดดูตัวอย่างสำหรับ Admin (ดูอย่างเดียว เพื่อตรวจเช็กความถูกต้องของฟอร์มและแบบแปลน ไม่มีการบันทึกลงฐานข้อมูล)
            </span>
          </div>
          {resolution.errorMessage && (
            <span className="text-[11px] bg-rose-100 text-rose-800 border border-rose-200 px-2.5 py-0.5 rounded-full">
              ⚠️ {resolution.errorMessage}
            </span>
          )}
        </div>
      )}

      {/* 🌟 Status Message Banner 🌟 */}
      {statusMessage && (
        <div className={`px-4 py-2.5 text-xs font-bold flex items-center justify-between border-b ${
          statusMessage.type === 'success' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' :
          statusMessage.type === 'error' ? 'bg-rose-50 text-rose-800 border-rose-200' :
          'bg-blue-50 text-blue-800 border-blue-200'
        }`}>
          <div className="flex items-center gap-2">
            {statusMessage.type === 'success' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
            <span>{statusMessage.text}</span>
          </div>
          <button onClick={() => setStatusMessage(null)} className="text-slate-400 hover:text-slate-700"><XCircle size={14} /></button>
        </div>
      )}

      {/* 🌟 Tab Contents 🌟 */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        {activeTab === 'form' ? (
          <div className="max-w-4xl mx-auto space-y-4">
            {/* Summary Progress Card */}
            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-4">
                <div>
                  <p className="text-[10px] text-slate-400 font-bold uppercase">ความคืบหน้าการตรวจ</p>
                  <p className="text-lg font-bold text-slate-800">
                    {answers.filter(a => a.status !== 'uninspected').length} / {answers.length} รายการ
                  </p>
                </div>
                <div className="h-8 w-px bg-slate-200" />
                <div className="flex items-center gap-2 text-xs font-bold">
                  <span className="text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200 flex items-center gap-1">
                    <CheckCircle size={12} /> ผ่าน: {answers.filter(a => a.status === 'passed').length}
                  </span>
                  <span className="text-rose-600 bg-rose-50 px-2.5 py-1 rounded-lg border border-rose-200 flex items-center gap-1">
                    <XCircle size={12} /> ไม่ผ่าน: {answers.filter(a => a.status === 'failed').length}
                  </span>
                  <span className="text-slate-600 bg-slate-100 px-2.5 py-1 rounded-lg border border-slate-200">
                    N/A: {answers.filter(a => a.status === 'na').length}
                  </span>
                </div>
              </div>

              {/* Critical warning if any critical item fails */}
              {currentEvaluation && currentEvaluation.criticalFailedItems > 0 && (
                <div className="bg-rose-100 border border-rose-300 text-rose-800 px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 animate-pulse">
                  <AlertTriangle size={14} />
                  <span>มีข้อสำคัญไม่ผ่าน ({currentEvaluation.criticalFailedItems} ข้อ) ผลตรวจรวมจะไม่ผ่าน</span>
                </div>
              )}
            </div>

            {/* Checklist Items List */}
            <div className="space-y-3">
              {(formTemplate.items || []).map((item, idx) => {
                const ans = answers.find(a => a.form_item_id === item.id);
                const status = ans?.status || 'uninspected';
                const relatedPins = annotations.filter(p => p.form_item_id === item.id);

                return (
                  <div 
                    key={item.id}
                    className={`bg-white p-4 sm:p-5 rounded-2xl border transition-all shadow-sm ${
                      status === 'passed' ? 'border-emerald-200 bg-emerald-50/20' :
                      status === 'failed' ? 'border-rose-300 bg-rose-50/20 ring-1 ring-rose-200' :
                      status === 'na' ? 'border-slate-200 opacity-75' :
                      'border-slate-200'
                    }`}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold text-purple-700 bg-purple-100 px-2 py-0.5 rounded-md">
                            {item.item_code}
                          </span>
                          {item.is_critical && (
                            <span className="text-[10px] font-bold text-rose-700 bg-rose-100 px-1.5 py-0.5 rounded-md flex items-center gap-0.5">
                              <AlertTriangle size={10} /> ข้อสำคัญ
                            </span>
                          )}
                          {item.is_required && (
                            <span className="text-[10px] text-red-500 font-bold">*จำเป็น</span>
                          )}
                          {item.section_title && (
                            <span className="text-[10px] text-slate-400 font-bold">
                              หมวด: {item.section_title}
                            </span>
                          )}
                        </div>
                        <h4 className="font-bold text-slate-800 text-sm sm:text-base mt-1">
                          {item.item_text}
                        </h4>
                        {item.description && (
                          <p className="text-xs text-slate-500 mt-0.5">{item.description}</p>
                        )}
                        {/* Target & bounds info */}
                        {(item.target_value !== null || item.min_value !== null || item.max_value !== null) && (
                          <div className="mt-1.5 flex items-center gap-2 text-[11px] font-bold text-slate-600 bg-slate-100 px-2 py-1 rounded-lg w-fit">
                            {item.target_value !== null && <span>เกณฑ์เป้าหมาย: {item.target_value} {item.unit}</span>}
                            {item.min_value !== null && <span>(ต่ำสุด: {item.min_value} {item.unit})</span>}
                            {item.max_value !== null && <span>(สูงสุด: {item.max_value} {item.unit})</span>}
                          </div>
                        )}
                      </div>

                      {/* Status / Answer Selectors */}
                      <div className="flex items-center gap-2 shrink-0">
                        {/* Number Input if item_type is number */}
                        {item.item_type === 'number' && (
                          <div className="flex items-center gap-1.5 bg-slate-100 p-1.5 rounded-xl border border-slate-200">
                            <input
                              type="number"
                              step="any"
                              disabled={isReadOnly}
                              value={ans?.numeric_value ?? ''}
                              onChange={(e) => {
                                const val = e.target.value === '' ? null : Number(e.target.value);
                                let autoStatus: 'passed' | 'failed' | 'uninspected' = 'uninspected';
                                if (val !== null) {
                                  autoStatus = 'passed';
                                  if (item.min_value != null && val < item.min_value) autoStatus = 'failed';
                                  if (item.max_value != null && val > item.max_value) autoStatus = 'failed';
                                }
                                handleAnswerChange(item.id, { numeric_value: val, status: autoStatus });
                              }}
                              placeholder="ระบุตัวเลข"
                              className="w-24 bg-white border border-slate-300 rounded-lg px-2 py-1 text-xs font-bold text-slate-800 text-right outline-none focus:border-purple-500"
                            />
                            <span className="text-xs font-bold text-slate-600 pr-1">{item.unit || ''}</span>
                          </div>
                        )}

                        {/* Drawing point indicator */}
                        {item.item_type === 'drawing_point' && (
                          <button
                            type="button"
                            disabled={!referenceDrawing}
                            onClick={() => referenceDrawing && handleTabChange('drawing')}
                            className="px-3 py-1.5 rounded-xl text-xs font-bold bg-purple-50 text-purple-700 border border-purple-200 hover:bg-purple-100 flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <MapPin size={12} />
                            <span>
                              {relatedPins.length > 0
                                ? `จุดวัด (${relatedPins.length})`
                                : referenceDrawing
                                ? (previewOnly ? 'ดูแบบแปลน' : 'ปักหมุดบนแบบ')
                                : 'ยังไม่มีแบบแปลน'}
                            </span>
                          </button>
                        )}

                        {/* Pass / Fail / NA buttons */}
                        <div className="flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200 gap-1">
                          <button
                            type="button"
                            disabled={isReadOnly}
                            onClick={() => handleAnswerChange(item.id, { status: 'passed' })}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 transition-all disabled:cursor-not-allowed ${
                              status === 'passed' 
                                ? 'bg-emerald-600 text-white shadow-sm' 
                                : 'text-slate-600 hover:text-emerald-700 disabled:hover:text-slate-600'
                            }`}
                          >
                            <Check size={12} /> ผ่าน
                          </button>
                          <button
                            type="button"
                            disabled={isReadOnly}
                            onClick={() => handleAnswerChange(item.id, { status: 'failed' })}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 transition-all disabled:cursor-not-allowed ${
                              status === 'failed' 
                                ? 'bg-rose-600 text-white shadow-sm' 
                                : 'text-slate-600 hover:text-rose-700 disabled:hover:text-slate-600'
                            }`}
                          >
                            <XCircle size={12} /> ไม่ผ่าน
                          </button>
                          <button
                            type="button"
                            disabled={isReadOnly}
                            onClick={() => handleAnswerChange(item.id, { status: 'na' })}
                            className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all disabled:cursor-not-allowed ${
                              status === 'na' 
                                ? 'bg-slate-600 text-white shadow-sm' 
                                : 'text-slate-500 hover:text-slate-800 disabled:hover:text-slate-500'
                            }`}
                          >
                            N/A
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Remarks and Photo upload section (especially if failed or required) */}
                    {(status === 'failed' || ans?.remarks || (ans?.photo_urls && ans.photo_urls.length > 0)) && (
                      <div className="mt-3 pt-3 border-t border-slate-100 space-y-2 animate-in fade-in">
                        <div className="flex flex-col sm:flex-row gap-2">
                          <input
                            type="text"
                            disabled={isReadOnly}
                            value={ans?.remarks || ''}
                            onChange={(e) => handleAnswerChange(item.id, { remarks: e.target.value })}
                            placeholder={status === 'failed' ? '⚠️ ระบุข้อบกพร่องที่พบ (จำเป็นเมื่อไม่ผ่าน)...' : 'หมายเหตุเพิ่มเติม...'}
                            className={`flex-1 rounded-xl px-3 py-2 text-xs font-bold outline-none border ${
                              status === 'failed' && (!ans?.remarks || !ans.remarks.trim())
                                ? 'border-rose-400 bg-rose-50 text-rose-900 focus:ring-1 focus:ring-rose-500'
                                : 'border-slate-200 bg-slate-50 text-slate-800 focus:border-purple-500'
                            }`}
                          />
                        </div>

                        {/* Photos preview */}
                        {ans?.photo_urls && ans.photo_urls.length > 0 && (
                          <div className="flex flex-wrap gap-2 pt-1">
                            {ans.photo_urls.map((url, pIdx) => (
                              <div 
                                key={pIdx} 
                                onClick={() => setSelectedPhotoPreview(url)}
                                className="w-14 h-14 rounded-lg overflow-hidden border border-slate-200 relative group cursor-pointer"
                              >
                                <img src={url} alt="หลักฐาน" className="w-full h-full object-cover" />
                                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white">
                                  <Eye size={14} />
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          /* Drawing & Pins View */
          referenceDrawing ? (
            <div className="max-w-5xl mx-auto space-y-4">
              <QCDrawingViewer
                drawing={referenceDrawing}
                annotations={annotations}
                onAddAnnotation={handleAddAnnotation}
                onDeleteAnnotation={handleDeleteAnnotation}
                selectedFormItems={formTemplate.items || []}
                readOnly={isReadOnly}
                selectedPages={resolution.selectedPages || []}
                viewport={resolution.viewport}
              />

              {/* Pins Table / Structured Measurement List */}
              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                <h4 className="font-bold text-slate-800 text-sm mb-3 flex items-center gap-2">
                  <MapPin className="text-purple-600" size={16} />
                  <span>ตารางจุดวัดบนแบบแปลน (Structured Pin Data - {annotations.length} จุด)</span>
                </h4>
                {annotations.length === 0 ? (
                  <p className="text-xs text-slate-400 py-4 text-center">
                    ยังไม่มีการปักหมุดบนแบบ แตะปุ่ม "ปักหมุดจุดวัด (+)" เพื่อเพิ่มจุดบนแบบแปลน
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-slate-200 text-slate-400 uppercase font-mono text-[10px]">
                          <th className="py-2 px-3">จุด</th>
                          <th className="py-2 px-3">หน้า</th>
                          <th className="py-2 px-3">ข้อตรวจที่เชื่อม</th>
                          <th className="py-2 px-3">ค่าที่วัด</th>
                          <th className="py-2 px-3">ผลประเมิน</th>
                          <th className="py-2 px-3">หมายเหตุ</th>
                          {!isReadOnly && <th className="py-2 px-3 text-right">จัดการ</th>}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {annotations.map((pin, pIdx) => {
                          const linkedItem = formTemplate.items?.find(it => it.id === pin.form_item_id);
                          return (
                            <tr key={pIdx} className="hover:bg-slate-50">
                              <td className="py-2.5 px-3 font-mono font-bold text-purple-700">{pin.pin_label}</td>
                              <td className="py-2.5 px-3 text-slate-500 font-mono">หน้า {pin.page_number}</td>
                              <td className="py-2.5 px-3 font-bold text-slate-800">
                                {linkedItem ? `${linkedItem.item_code} ${linkedItem.item_text}` : '-'}
                              </td>
                              <td className="py-2.5 px-3 font-bold text-slate-700">
                                {pin.measured_value !== null ? `${pin.measured_value} ${pin.unit || ''}` : '-'}
                              </td>
                              <td className="py-2.5 px-3">
                                <span className={`px-2 py-0.5 rounded-full font-bold text-[10px] ${
                                  pin.status === 'passed' ? 'bg-emerald-100 text-emerald-700' :
                                  pin.status === 'failed' ? 'bg-rose-100 text-rose-700' :
                                  'bg-slate-100 text-slate-600'
                                }`}>
                                  {pin.status === 'passed' ? 'ผ่าน' : pin.status === 'failed' ? 'ไม่ผ่าน' : 'N/A'}
                                </span>
                              </td>
                              <td className="py-2.5 px-3 text-slate-500 truncate max-w-xs">{pin.remarks || '-'}</td>
                              {!isReadOnly && (
                                <td className="py-2.5 px-3 text-right">
                                  <button
                                    onClick={() => handleDeleteAnnotation(pIdx)}
                                    className="text-rose-500 hover:text-rose-700 p-1"
                                    title="ลบจุดนี้"
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </td>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="p-8 text-center bg-white rounded-2xl border border-slate-200">
              <MapPin size={36} className="text-slate-400 mx-auto mb-2" />
              <p className="font-bold text-slate-700 text-sm">ไม่มีแบบอ้างอิงผูกกับงานนี้</p>
            </div>
          )
        )}
      </div>

      {/* 🌟 Footer Bar: Approve / Reject Controls for QC/Admin 🌟 */}
      {!previewOnly && currentInspection?.document_status === 'submitted' && (isQC || isAdmin) && (
        <footer className="bg-white p-4 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3 shrink-0 shadow-lg">
          <div className="flex items-center gap-2">
            <ShieldCheck size={20} className="text-purple-600" />
            <div>
              <p className="text-xs font-bold text-slate-800">การรับรองผลการตรวจ (QC Review)</p>
              <p className="text-[10px] text-slate-500">
                ผลประเมินอัตโนมัติ: <span className="font-bold">{currentInspection.inspection_result === 'passed' ? 'ผ่าน' : 'ไม่ผ่าน'}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => handleApproveAction('reject')}
              disabled={isApproving}
              className="px-4 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-300 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all disabled:opacity-50"
            >
              <XCircle size={14} />
              <span>แจ้งแก้ไข (สั่งแก้ 95%)</span>
            </button>
            <button
              onClick={() => handleApproveAction('approve')}
              disabled={isApproving || currentInspection.inspection_result !== 'passed'}
              className="px-5 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-md transition-all disabled:opacity-40"
            >
              {isApproving ? <Loader2 className="animate-spin" size={14} /> : <CheckCircle size={14} />}
              <span>อนุมัติผ่าน (Pass 100%)</span>
            </button>
          </div>
        </footer>
      )}

      {/* 🌟 Create Retest Round Button if Inspection is Rejected 🌟 */}
      {!previewOnly && currentInspection?.document_status === 'rejected' && (
        <footer className="bg-amber-50 p-4 border-t border-amber-200 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2 text-amber-800 text-xs font-bold">
            <AlertTriangle size={18} />
            <span>งานนี้ไม่ผ่านการตรวจ (รอบที่ {currentInspection.round_number}) สามารถสร้างรอบการตรวจซ้ำได้</span>
          </div>
          <button
            onClick={handleCreateRetest}
            disabled={isSaving}
            className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-md"
          >
            <RefreshCw size={14} />
            <span>สร้างรอบตรวจซ้ำ (รอบที่ {currentInspection.round_number + 1})</span>
          </button>
        </footer>
      )}

      {/* 🌟 Reopen Modal 🌟 */}
      {reopenModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-[999]">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl border border-slate-200 animate-in zoom-in-95">
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-bold text-slate-800 text-base">ขอเปิดผลตรวจกลับมาแก้ไข</h3>
              <button onClick={() => setReopenModalOpen(false)} className="text-slate-400 hover:text-slate-700"><XCircle size={18} /></button>
            </div>
            <p className="text-xs text-slate-500 mb-3">
              การเปิดผลที่รับรองแล้วกลับมาแก้ไขจะเปลี่ยนสถานะเป็นร่าง และบันทึก Audit Trail ระบุชื่อผู้แก้ไขและเหตุผล
            </p>
            <textarea
              rows={3}
              value={reopenReason}
              onChange={(e) => setReopenReason(e.target.value)}
              placeholder="ระบุเหตุผลในการขอเปิดกลับมาแก้ไข (จำเป็น)..."
              className="w-full border border-slate-300 rounded-xl p-3 text-xs font-bold outline-none focus:border-purple-500 mb-4"
            />
            <div className="flex gap-2">
              <button
                onClick={() => setReopenModalOpen(false)}
                className="flex-1 bg-slate-100 hover:bg-slate-200 py-2.5 rounded-xl text-xs font-bold text-slate-700"
              >
                ยกเลิก
              </button>
              <button
                onClick={handleReopen}
                disabled={!reopenReason.trim()}
                className="flex-1 bg-purple-600 hover:bg-purple-700 py-2.5 rounded-xl text-xs font-bold text-white disabled:opacity-40"
              >
                ยืนยันเปิดกลับมาแก้
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 🌟 Photo Full Preview Modal 🌟 */}
      {selectedPhotoPreview && (
        <div 
          onClick={() => setSelectedPhotoPreview(null)}
          className="fixed inset-0 bg-black/90 flex items-center justify-center p-4 z-[1000] cursor-pointer"
        >
          <img src={selectedPhotoPreview} alt="รูปหลักฐานเต็ม" className="max-h-[90vh] max-w-[90vw] object-contain rounded-xl shadow-2xl" />
        </div>
      )}
    </div>
  );
}
