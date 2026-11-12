// ==============================================================================
// 📐 BUILDTRACK: QC DRAWING LIBRARY MODAL (คลังแบบแปลนและเอกสารอ้างอิง)
// ==============================================================================

import React, { useState, useEffect, useRef } from 'react';
import {
  X, Plus, MapPin, Upload, FileCheck, Layers, Eye, Edit3, Trash2,
  Copy, Tag, Check, ArrowRight, ExternalLink, Filter, Loader2,
  Image as ImageIcon, FileText, Globe, Building2, Home, Link2
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { QCReferenceDrawing, QCGarageOrientation } from '@/types/qc.types';
import QCMasterPlanViewportModal from './QCMasterPlanViewportModal';

export type DrawingUploadScope = 'house_type' | 'project_plan' | 'common' | 'plot';

interface QCDrawingLibraryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectDrawing?: (drawing: QCReferenceDrawing) => void;
  currentUserRole: string;
  loggedInUsername: string;
  projectName?: string;
  plots?: any[];
  houseTypes?: any[];
  taskTemplates?: any[];
  projects?: any[];
  activeTarget?: {
    houseTypeId: string;
    houseTypeName?: string;
    taskName: string;
    taskTemplateId?: string;
  } | null;
  onDrawingsChanged?: () => void;
}

export default function QCDrawingLibraryModal({
  isOpen,
  onClose,
  onSelectDrawing,
  currentUserRole,
  loggedInUsername,
  projectName = '',
  plots = [],
  houseTypes = [],
  taskTemplates = [],
  projects = [],
  activeTarget = null,
  onDrawingsChanged
}: QCDrawingLibraryModalProps) {
  const [drawings, setDrawings] = useState<QCReferenceDrawing[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [uploadingFile, setUploadingFile] = useState<boolean>(false);
  const [showUploadForm, setShowUploadForm] = useState<boolean>(false);
  const [showManualUrl, setShowManualUrl] = useState<boolean>(false);
  const [filterTab, setFilterTab] = useState<'recommended' | 'house_type' | 'project_common' | 'all'>('all');
  const [activeViewportModalDrawing, setActiveViewportModalDrawing] = useState<QCReferenceDrawing | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);

  // Upload Form State
  const [drawingNumber, setDrawingNumber] = useState('');
  const [drawingTitle, setDrawingTitle] = useState('');
  const [fileUrl, setFileUrl] = useState('');
  const [fileName, setFileName] = useState('');
  const [fileType, setFileType] = useState<'pdf' | 'image'>('image');
  const [associatedScope, setAssociatedScope] = useState<DrawingUploadScope>('house_type');
  const [selectedProjectName, setSelectedProjectName] = useState(projectName);
  const [houseTypeId, setHouseTypeId] = useState('');
  const [plotId, setPlotId] = useState('');
  const [garageOrientation, setGarageOrientation] = useState<QCGarageOrientation>('standard');
  const [taskTemplateId, setTaskTemplateId] = useState('');
  const [totalPages, setTotalPages] = useState<number>(1);
  const [pageLabel, setPageLabel] = useState('หน้า 1: แปลนหลัก');

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const canEdit = currentUserRole === 'Admin' || currentUserRole === 'Owner' || currentUserRole === 'QC';

  // Derive project names list from props
  const projectNamesList = Array.from(
    new Set([
      ...(projectName ? [projectName] : []),
      ...projects.map((p: any) => p.name).filter(Boolean),
      ...plots.map((p: any) => p.project_name).filter(Boolean)
    ])
  );

  // House Type Name lookup
  const houseTypeNameMap = new Map(houseTypes.map(ht => [ht.id, ht.type_name]));
  const plotNameMap = new Map(plots.map(p => [p.id, `${p.plot_name} (${p.project_name})`]));
  const taskNameMap = new Map(taskTemplates.map(t => [t.id, t.task_name]));

  const fetchDrawings = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('qc_reference_drawings')
        .select('*, pages:qc_drawing_pages(*)')
        .eq('status', 'active')
        .order('created_at', { ascending: false });

      if (error) {
        if (error.code === 'PGRST205') {
          console.warn('Table qc_reference_drawings does not exist in Supabase yet.');
          setDrawings([]);
          return;
        }
        throw error;
      }
      setDrawings(data || []);
    } catch (err: any) {
      console.error('Error fetching drawings:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchDrawings();
      setShowUploadForm(false);
      setShowManualUrl(false);
      setSelectedProjectName(projectName || projectNamesList[0] || '');
      if (activeTarget) {
        setFilterTab('recommended');
      } else {
        setFilterTab('all');
      }
    }
  }, [isOpen, projectName, activeTarget?.houseTypeId, activeTarget?.taskName]);

  // Open Upload Form with Smart Defaults
  const handleOpenUploadForm = (presetOrientation?: QCGarageOrientation) => {
    const suffix = presetOrientation === 'left' ? '-L' : presetOrientation === 'right' ? '-R' : '';
    const randCode = String(Date.now()).slice(-4);
    setDrawingNumber(activeTarget ? `DWG-${randCode}${suffix}` : `DWG-${randCode}`);
    setDrawingTitle(
      activeTarget
        ? `${activeTarget.taskName}${activeTarget.houseTypeName ? ` (${activeTarget.houseTypeName})` : ''}${
            presetOrientation === 'left' ? ' - จอดรถซ้าย' : presetOrientation === 'right' ? ' - จอดรถขวา' : ''
          }`
        : ''
    );
    setFileUrl('');
    setFileName('');
    setFileType('image');
    setShowManualUrl(false);
    setSelectedProjectName(projectName || projectNamesList[0] || '');

    if (activeTarget) {
      setAssociatedScope('house_type');
      setHouseTypeId(activeTarget.houseTypeId || '');
      setTaskTemplateId(activeTarget.taskTemplateId || '');
      setGarageOrientation(presetOrientation || 'standard');
    } else {
      setAssociatedScope('house_type');
      setHouseTypeId(houseTypes[0]?.id || '');
      setTaskTemplateId('');
      setGarageOrientation(presetOrientation || 'standard');
    }
    setPlotId('');
    setShowUploadForm(true);
  };

  // Direct File Upload to Supabase Storage (`task_images`)
  const handleFileUpload = async (file: File) => {
    if (!file) return;

    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    const isImage = file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name);

    if (!isPdf && !isImage) {
      alert('รองรับเฉพาะไฟล์รูปภาพ (PNG, JPG, WebP) หรือเอกสาร PDF เท่านั้นครับ');
      return;
    }

    if (file.size > 25 * 1024 * 1024) {
      alert('ไฟล์มีขนาดใหญ่เกิน 25 MB กรุณาลดขนาดไฟล์ก่อนอัปโหลด');
      return;
    }

    setUploadingFile(true);
    try {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const storagePath = `qc_drawings/${Date.now()}_${safeName}`;

      const { error: uploadErr } = await supabase.storage
        .from('task_images')
        .upload(storagePath, file, {
          cacheControl: '3600',
          upsert: false
        });

      if (uploadErr) throw uploadErr;

      const { data: pubData } = supabase.storage
        .from('task_images')
        .getPublicUrl(storagePath);

      setFileUrl(pubData.publicUrl);
      setFileName(file.name);
      setFileType(isPdf ? 'pdf' : 'image');

      if (!drawingTitle.trim()) {
        const cleanBaseName = file.name.replace(/\.[^/.]+$/, '').replace(/[_-]+/g, ' ');
        setDrawingTitle(cleanBaseName);
      }
      if (!drawingNumber.trim()) {
        setDrawingNumber(`DWG-${String(Date.now()).slice(-4)}`);
      }
    } catch (err: any) {
      console.error('File upload error:', err);
      alert(`อัปโหลดไฟล์ไม่สำเร็จ: ${err?.message || 'Unknown error'}`);
    } finally {
      setUploadingFile(false);
    }
  };

  // Save Drawing to DB
  const handleSaveDrawing = async (continueOppositeSide: boolean = false) => {
    if (!drawingNumber.trim() || !drawingTitle.trim() || !fileUrl.trim()) {
      alert('กรุณาอัปโหลดไฟล์แบบแปลน และระบุเลขที่แบบ + ชื่อแบบให้ครบถ้วนครับ');
      return;
    }

    if (associatedScope === 'house_type' && !houseTypeId) {
      alert('กรุณาเลือกแบบบ้านที่ใช้งานกับแบบนี้ครับ');
      return;
    }

    if (associatedScope === 'project_plan' && !selectedProjectName) {
      alert('กรุณาเลือกโครงการสำหรับผังรวมนี้ครับ');
      return;
    }

    if (associatedScope === 'plot' && !plotId) {
      alert('กรุณาเลือกแปลงบ้านสำหรับแบบเฉพาะแปลงนี้ครับ');
      return;
    }

    setLoading(true);
    try {
      const payload: any = {
        drawing_number: drawingNumber.trim(),
        title: drawingTitle.trim(),
        file_url: fileUrl.trim(),
        file_name: fileName || drawingTitle.trim(),
        file_type: fileType,
        version: 1,
        status: 'active',
        total_pages: totalPages || 1,
        project_name:
          associatedScope === 'project_plan' || associatedScope === 'plot'
            ? (selectedProjectName || projectName || null)
            : null,
        house_type_id: associatedScope === 'house_type' ? houseTypeId || null : null,
        plot_id: associatedScope === 'plot' ? plotId || null : null,
        task_template_id: taskTemplateId || null,
        garage_orientation: associatedScope === 'house_type' ? garageOrientation : 'standard',
        created_by: loggedInUsername,
        updated_at: new Date().toISOString()
      };

      let { data: newDraw, error: drawErr } = await supabase
        .from('qc_reference_drawings')
        .insert([payload])
        .select('*, pages:qc_drawing_pages(*)')
        .single();

      if (drawErr && drawErr.code === '42703') {
        delete payload.garage_orientation;
        const res = await supabase.from('qc_reference_drawings').insert([payload]).select('*, pages:qc_drawing_pages(*)').single();
        newDraw = res.data;
        drawErr = res.error;
      }

      if (drawErr) {
        if (drawErr.code === '23505') {
          throw new Error(`เลขที่แบบ "${drawingNumber.trim()}" มีอยู่ในระบบแล้ว กรุณาเปลี่ยนเลขที่แบบใหม่ (เช่น เติม -L, -R หรือ v2)`);
        }
        throw drawErr;
      }

      // Create initial page
      if (newDraw?.id) {
        await supabase.from('qc_drawing_pages').insert([{
          drawing_id: newDraw.id,
          page_number: 1,
          page_label: pageLabel || 'หน้า 1: แปลนหลัก',
          page_image_url: fileType === 'image' ? fileUrl.trim() : null
        }]);
      }

      await fetchDrawings();
      if (onDrawingsChanged) onDrawingsChanged();

      if (continueOppositeSide && associatedScope === 'house_type') {
        const nextSide: QCGarageOrientation = garageOrientation === 'left' ? 'right' : 'left';
        const baseNum = drawingNumber.replace(/-(L|R)$/i, '');
        const sideSuffix = nextSide === 'left' ? '-L' : '-R';
        const cleanTitle = drawingTitle.replace(/\s*-\s*จอดรถ(ซ้าย|ขวา)$/, '');
        setDrawingNumber(`${baseNum}${sideSuffix}`);
        setDrawingTitle(`${cleanTitle} - จอดรถ${nextSide === 'left' ? 'ซ้าย' : 'ขวา'}`);
        setGarageOrientation(nextSide);
        setFileUrl('');
        setFileName('');
      } else {
        setShowUploadForm(false);
        setDrawingNumber('');
        setDrawingTitle('');
        setFileUrl('');
        setFileName('');
        setGarageOrientation('standard');
      }
    } catch (err: any) {
      alert(err.message || 'บันทึกแบบอ้างอิงไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  const handleRetireDrawing = async (draw: QCReferenceDrawing) => {
    if (!confirm(`ต้องการลบ/ปิดใช้งานแบบ "${draw.title} (${draw.drawing_number})" ใช่หรือไม่?`)) return;
    setLoading(true);
    try {
      const { error } = await supabase
        .from('qc_reference_drawings')
        .update({ status: 'retired', updated_at: new Date().toISOString() })
        .eq('id', draw.id);
      if (error) throw error;
      await fetchDrawings();
      if (onDrawingsChanged) onDrawingsChanged();
    } catch (err: any) {
      alert(err.message || 'ลบแบบแปลนไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  // Filtered tasks based on selected house type in upload form
  const tasksForSelectedHouseType = taskTemplates.filter(t =>
    houseTypeId ? t.house_type_id === houseTypeId : true
  );
  const uniqueTaskOptions = Array.from(
    new Map(tasksForSelectedHouseType.map(t => [houseTypeId ? t.id : t.task_name, t])).values()
  ).sort((a, b) => (a.task_order || 0) - (b.task_order || 0));

  // Filter drawings for grid tabs
  const filteredDrawings = drawings.filter(draw => {
    if (filterTab === 'house_type') {
      return Boolean(draw.house_type_id);
    }
    if (filterTab === 'project_common') {
      return !draw.house_type_id && !draw.plot_id;
    }
    if (filterTab === 'recommended' && activeTarget) {
      const matchesTargetHouseTask =
        draw.house_type_id === activeTarget.houseTypeId &&
        (!draw.task_template_id || draw.task_template_id === activeTarget.taskTemplateId);
      const isProjectMasterPlan =
        !draw.house_type_id &&
        !draw.plot_id &&
        (!draw.project_name || draw.project_name === projectName);
      return matchesTargetHouseTask || isProjectMasterPlan;
    }
    return true;
  });

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 z-[999] animate-in fade-in">
        <div className="bg-white rounded-3xl max-w-5xl w-full h-[88vh] flex flex-col overflow-hidden shadow-2xl border border-slate-200">
          {/* Header */}
          <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between border-b border-slate-800 shrink-0">
            <div className="flex items-center gap-3">
              <div className="bg-purple-600 p-2 rounded-xl">
                <MapPin size={20} />
              </div>
              <div>
                <h3 className="font-bold text-base">
                  {activeTarget
                    ? `เลือกแบบแปลนสำหรับ: ${activeTarget.taskName}`
                    : 'คลังแบบแปลนอ้างอิง QC (Drawing Library)'}
                </h3>
                <p className="text-xs text-slate-400">
                  {activeTarget
                    ? `แบบบ้าน: ${activeTarget.houseTypeName || activeTarget.houseTypeId} • รองรับแปลนสลับซ้าย/ขวา ผังโครงการ และแบบมาตรฐานกลาง`
                    : 'แบบแปลนมาตรฐานแบบบ้าน (ซ้าย/ขวา) ผังรวมโครงการ และแบบมาตรฐานกลาง'}
                </p>
              </div>
            </div>
            <button onClick={onClose} className="p-1 text-slate-400 hover:text-white rounded-lg"><X size={20} /></button>
          </div>

          {/* Action Bar & Filter Tabs */}
          {!showUploadForm && (
            <div className="p-4 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                {activeTarget && (
                  <button
                    type="button"
                    onClick={() => setFilterTab('recommended')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                      filterTab === 'recommended'
                        ? 'bg-purple-600 text-white shadow-sm'
                        : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    ⭐ แนะนำสำหรับงานนี้
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setFilterTab('all')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                    filterTab === 'all'
                      ? 'bg-slate-800 text-white shadow-sm'
                      : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  ทั้งหมด ({drawings.length})
                </button>
                <button
                  type="button"
                  onClick={() => setFilterTab('house_type')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                    filterTab === 'house_type'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  🏠 แบบบ้าน (ซ้าย/ขวา)
                </button>
                <button
                  type="button"
                  onClick={() => setFilterTab('project_common')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                    filterTab === 'project_common'
                      ? 'bg-amber-600 text-white shadow-sm'
                      : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  🗺️ ผังโครงการ &amp; แบบกลาง
                </button>
              </div>

              {canEdit && (
                <button
                  type="button"
                  onClick={() => handleOpenUploadForm()}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-md"
                >
                  <Plus size={16} />
                  <span>+ อัปโหลดแบบแปลนใหม่</span>
                </button>
              )}
            </div>
          )}

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-6">
            {showUploadForm ? (
              /* Upload / Register Form */
              <div className="max-w-2xl mx-auto bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-5">
                <div className="flex justify-between items-center border-b pb-3">
                  <div>
                    <h4 className="font-bold text-slate-800 text-base">อัปโหลดและลงทะเบียนแบบแปลนใหม่</h4>
                    <p className="text-[11px] text-slate-500">รองรับไฟล์รูปภาพ (PNG, JPG) และเอกสาร PDF</p>
                  </div>
                  <button onClick={() => setShowUploadForm(false)} className="text-xs text-slate-400 hover:text-slate-700 font-bold px-2 py-1 rounded-lg hover:bg-slate-100">
                    ← กลับหน้ารายการ
                  </button>
                </div>

                {/* 1. Scope Selection First (Clear Decision Tree) */}
                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-3">
                  <label className="text-xs font-bold text-slate-700 block">1. เลือกลักษณะการใช้งานของแบบนี้</label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <button
                      type="button"
                      onClick={() => setAssociatedScope('house_type')}
                      className={`p-2.5 rounded-xl text-left border transition-all ${
                        associatedScope === 'house_type'
                          ? 'bg-purple-600 text-white border-purple-600 shadow-sm'
                          : 'bg-white text-slate-700 border-slate-200 hover:border-purple-300'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 font-bold text-xs mb-0.5">
                        <Home size={14} />
                        <span>แบบบ้าน</span>
                      </div>
                      <p className={`text-[10px] leading-tight ${associatedScope === 'house_type' ? 'text-purple-100' : 'text-slate-400'}`}>
                        ใช้ได้ทุกโครงการ แยกซ้าย/ขวาได้
                      </p>
                    </button>

                    <button
                      type="button"
                      onClick={() => setAssociatedScope('project_plan')}
                      className={`p-2.5 rounded-xl text-left border transition-all ${
                        associatedScope === 'project_plan'
                          ? 'bg-amber-600 text-white border-amber-600 shadow-sm'
                          : 'bg-white text-slate-700 border-slate-200 hover:border-amber-300'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 font-bold text-xs mb-0.5">
                        <Building2 size={14} />
                        <span>ผังรวมโครงการ</span>
                      </div>
                      <p className={`text-[10px] leading-tight ${associatedScope === 'project_plan' ? 'text-amber-100' : 'text-slate-400'}`}>
                        เฉพาะโครงการ เช่น ผังท่อระบายน้ำ
                      </p>
                    </button>

                    <button
                      type="button"
                      onClick={() => setAssociatedScope('common')}
                      className={`p-2.5 rounded-xl text-left border transition-all ${
                        associatedScope === 'common'
                          ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                          : 'bg-white text-slate-700 border-slate-200 hover:border-blue-300'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 font-bold text-xs mb-0.5">
                        <Globe size={14} />
                        <span>แบบมาตรฐานกลาง</span>
                      </div>
                      <p className={`text-[10px] leading-tight ${associatedScope === 'common' ? 'text-blue-100' : 'text-slate-400'}`}>
                        ใช้ร่วมทุกโครงการ เช่น ดีเทลบ่อพัก
                      </p>
                    </button>

                    <button
                      type="button"
                      onClick={() => setAssociatedScope('plot')}
                      className={`p-2.5 rounded-xl text-left border transition-all ${
                        associatedScope === 'plot'
                          ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                          : 'bg-white text-slate-700 border-slate-200 hover:border-emerald-300'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 font-bold text-xs mb-0.5">
                        <MapPin size={14} />
                        <span>เฉพาะแปลง</span>
                      </div>
                      <p className={`text-[10px] leading-tight ${associatedScope === 'plot' ? 'text-emerald-100' : 'text-slate-400'}`}>
                        แปลนพิเศษเฉพาะบ้านหลังเดียว
                      </p>
                    </button>
                  </div>

                  {/* Dynamic Fields per Scope */}
                  {associatedScope === 'house_type' && (
                    <div className="pt-2 space-y-3 border-t border-slate-200/80">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">แบบบ้าน (House Type)</label>
                          <select
                            value={houseTypeId}
                            onChange={(e) => {
                              setHouseTypeId(e.target.value);
                              setTaskTemplateId('');
                            }}
                            className="w-full border border-slate-200 rounded-xl p-2 text-xs font-bold bg-white text-slate-800"
                          >
                            <option value="">-- เลือกแบบบ้าน --</option>
                            {houseTypes.map((ht: any) => (
                              <option key={ht.id} value={ht.id}>
                                {ht.is_infrastructure ? '🏗️ ' : '🏠 '} {ht.type_name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">ผูกกับงวดงาน (ถ้าต้องการระบุ)</label>
                          <select
                            value={taskTemplateId}
                            onChange={(e) => setTaskTemplateId(e.target.value)}
                            className="w-full border border-slate-200 rounded-xl p-2 text-xs font-bold bg-white text-slate-800"
                          >
                            <option value="">-- ทุกงาน / ระบุทีหลัง --</option>
                            {uniqueTaskOptions.map((t: any) => (
                              <option key={t.id} value={t.id}>
                                #{t.task_order} {t.task_name}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      {/* ทิศทางโรงจอดรถ */}
                      <div>
                        <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1.5">
                          ทิศทางโรงจอดรถของไฟล์แปลนนี้ (ระบบสลับอัตโนมัติตามแปลง)
                        </label>
                        <div className="grid grid-cols-3 gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setGarageOrientation('left');
                              if (!drawingNumber.endsWith('-L')) {
                                setDrawingNumber(drawingNumber.replace(/-(L|R)$/i, '') + '-L');
                              }
                            }}
                            className={`p-2 rounded-xl border text-xs font-bold transition flex items-center justify-center gap-1 ${
                              garageOrientation === 'left' ? 'border-blue-600 bg-blue-50 text-blue-700 ring-2 ring-blue-200' : 'border-slate-200 bg-white text-slate-600'
                            }`}
                          >
                            <span>🚗 โรงจอดรถซ้าย</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setGarageOrientation('right');
                              if (!drawingNumber.endsWith('-R')) {
                                setDrawingNumber(drawingNumber.replace(/-(L|R)$/i, '') + '-R');
                              }
                            }}
                            className={`p-2 rounded-xl border text-xs font-bold transition flex items-center justify-center gap-1 ${
                              garageOrientation === 'right' ? 'border-purple-600 bg-purple-50 text-purple-700 ring-2 ring-purple-200' : 'border-slate-200 bg-white text-slate-600'
                            }`}
                          >
                            <span>🚗 โรงจอดรถขวา</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setGarageOrientation('standard');
                              setDrawingNumber(drawingNumber.replace(/-(L|R)$/i, ''));
                            }}
                            className={`p-2 rounded-xl border text-xs font-bold transition flex items-center justify-center gap-1 ${
                              garageOrientation === 'standard' ? 'border-slate-600 bg-slate-100 text-slate-800 ring-2 ring-slate-200' : 'border-slate-200 bg-white text-slate-600'
                            }`}
                          >
                            <span>➖ มาตรฐาน/ทั้งสองฝั่ง</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {associatedScope === 'project_plan' && (
                    <div className="pt-2 border-t border-slate-200/80 grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">โครงการที่ใช้ผังรวมนี้</label>
                        <select
                          value={selectedProjectName}
                          onChange={(e) => setSelectedProjectName(e.target.value)}
                          className="w-full border border-slate-200 rounded-xl p-2 text-xs font-bold bg-white text-slate-800"
                        >
                          <option value="">-- เลือกโครงการ --</option>
                          {projectNamesList.map(pName => (
                            <option key={pName} value={pName}>{pName}</option>
                          ))}
                        </select>
                      </div>
                      <div className="flex items-end">
                        <p className="text-[11px] text-amber-700 bg-amber-50 p-2 rounded-xl border border-amber-200 w-full">
                          💡 ผังรวมโครงการจะสามารถปักหมุด &amp; ล็อคมุมมองซูมสำหรับแต่ละแปลงได้ในขั้นตอนถัดไป
                        </p>
                      </div>
                    </div>
                  )}

                  {associatedScope === 'common' && (
                    <div className="pt-2 border-t border-slate-200/80">
                      <p className="text-[11px] text-blue-700 bg-blue-50 p-2.5 rounded-xl border border-blue-200">
                        🌐 <strong>แบบมาตรฐานกลางวิศวกรรม:</strong> อัปโหลดเพียงครั้งเดียว สามารถเลือกนำไปผูกตรวจได้ใน <strong>ทุกโครงการ</strong> โดยไม่ต้องอัปโหลดซ้ำ
                      </p>
                    </div>
                  )}

                  {associatedScope === 'plot' && (
                    <div className="pt-2 border-t border-slate-200/80 grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">โครงการ</label>
                        <select
                          value={selectedProjectName}
                          onChange={(e) => {
                            setSelectedProjectName(e.target.value);
                            setPlotId('');
                          }}
                          className="w-full border border-slate-200 rounded-xl p-2 text-xs font-bold bg-white text-slate-800"
                        >
                          <option value="">-- เลือกโครงการ --</option>
                          {projectNamesList.map(pName => (
                            <option key={pName} value={pName}>{pName}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">เลือกแปลง (Plot)</label>
                        <select
                          value={plotId}
                          onChange={(e) => setPlotId(e.target.value)}
                          className="w-full border border-slate-200 rounded-xl p-2 text-xs font-bold bg-white text-slate-800"
                        >
                          <option value="">-- เลือกแปลงบ้าน --</option>
                          {plots
                            .filter(p => !selectedProjectName || p.project_name === selectedProjectName)
                            .map(p => (
                              <option key={p.id} value={p.id}>
                                แปลง {p.plot_name} ({houseTypeNameMap.get(p.house_type_id) || 'ไม่ระบุแบบ'})
                              </option>
                            ))}
                        </select>
                      </div>
                    </div>
                  )}
                </div>

                {/* 2. File Upload Dropzone */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-slate-700">2. อัปโหลดไฟล์แบบแปลน (รูปภาพ / PDF)</label>
                    <button
                      type="button"
                      onClick={() => setShowManualUrl(!showManualUrl)}
                      className="text-[11px] font-bold text-purple-600 hover:text-purple-800 flex items-center gap-1"
                    >
                      <Link2 size={12} />
                      <span>{showManualUrl ? 'ซ่อนช่องใส่ URL' : 'หรือวาง URL ลิงก์เอง'}</span>
                    </button>
                  </div>

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,application/pdf"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleFileUpload(f);
                      e.target.value = '';
                    }}
                  />

                  {!fileUrl ? (
                    <div
                      onDragOver={(e) => {
                        e.preventDefault();
                        setIsDragging(true);
                      }}
                      onDragLeave={() => setIsDragging(false)}
                      onDrop={(e) => {
                        e.preventDefault();
                        setIsDragging(false);
                        const f = e.dataTransfer.files?.[0];
                        if (f) handleFileUpload(f);
                      }}
                      onClick={() => !uploadingFile && fileInputRef.current?.click()}
                      className={`border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-all ${
                        isDragging
                          ? 'border-purple-500 bg-purple-50'
                          : 'border-slate-300 hover:border-purple-400 hover:bg-slate-50'
                      }`}
                    >
                      {uploadingFile ? (
                        <div className="flex flex-col items-center gap-2 text-purple-700">
                          <Loader2 className="animate-spin" size={28} />
                          <p className="text-xs font-bold">กำลังอัปโหลดไฟล์แบบแปลนขึ้นระบบ...</p>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center gap-2 text-slate-500">
                          <div className="w-12 h-12 rounded-2xl bg-purple-50 text-purple-600 flex items-center justify-center">
                            <Upload size={22} />
                          </div>
                          <p className="text-xs font-bold text-slate-700">คลิกเพื่อเลือกไฟล์จากเครื่อง หรือลากไฟล์มาวางที่นี่</p>
                          <p className="text-[11px] text-slate-400">รองรับ PNG, JPG, WebP และ PDF (สูงสุด 25 MB)</p>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="border border-emerald-200 bg-emerald-50/50 rounded-2xl p-3 flex items-center gap-4">
                      {fileType === 'image' ? (
                        <img src={fileUrl} alt="Preview" className="w-20 h-20 object-cover rounded-xl border border-slate-200 bg-white shrink-0" />
                      ) : (
                        <div className="w-20 h-20 rounded-xl bg-rose-50 border border-rose-200 flex flex-col items-center justify-center text-rose-600 shrink-0">
                          <FileText size={28} />
                          <span className="text-[10px] font-bold mt-1">PDF</span>
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 text-emerald-700 font-bold text-xs">
                          <Check size={14} />
                          <span>อัปโหลดไฟล์พร้อมใช้งานแล้ว</span>
                        </div>
                        <p className="text-xs font-bold text-slate-800 truncate mt-0.5">{fileName || fileUrl}</p>
                        <div className="flex items-center gap-3 mt-2">
                          <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            className="text-[11px] font-bold text-purple-700 hover:underline"
                          >
                            เปลี่ยนไฟล์ใหม่
                          </button>
                          <a
                            href={fileUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[11px] font-bold text-slate-600 hover:text-slate-900 flex items-center gap-1"
                          >
                            <ExternalLink size={11} />
                            <span>เปิดดูภาพ</span>
                          </a>
                        </div>
                      </div>
                    </div>
                  )}

                  {showManualUrl && (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
                      <div className="sm:col-span-2">
                        <input
                          type="text"
                          value={fileUrl}
                          onChange={(e) => setFileUrl(e.target.value)}
                          placeholder="https://... ลิงก์ไฟล์แบบแปลน"
                          className="w-full border border-slate-200 rounded-xl p-2 text-xs font-mono text-slate-800"
                        />
                      </div>
                      <div>
                        <select
                          value={fileType}
                          onChange={(e) => setFileType(e.target.value as any)}
                          className="w-full border border-slate-200 rounded-xl p-2 text-xs font-bold"
                        >
                          <option value="image">รูปภาพ (PNG/JPG)</option>
                          <option value="pdf">เอกสาร PDF</option>
                        </select>
                      </div>
                    </div>
                  )}
                </div>

                {/* 3. Drawing Metadata */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">เลขที่แบบ (Drawing No.) *</label>
                    <input
                      type="text"
                      value={drawingNumber}
                      onChange={(e) => setDrawingNumber(e.target.value)}
                      placeholder="เช่น AR-101-L, PL-05"
                      className="w-full border border-slate-200 rounded-xl p-2.5 text-xs font-mono font-bold text-slate-800"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">ชื่อแบบแปลน *</label>
                    <input
                      type="text"
                      value={drawingTitle}
                      onChange={(e) => setDrawingTitle(e.target.value)}
                      placeholder="เช่น แปลนงานก่อ ชั้น 1 (จอดรถซ้าย)"
                      className="w-full border border-slate-200 rounded-xl p-2.5 text-xs font-bold text-slate-800"
                    />
                  </div>
                </div>

                {/* Save Action Buttons */}
                <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setShowUploadForm(false)}
                    className="px-4 bg-slate-100 hover:bg-slate-200 py-2.5 rounded-xl text-xs font-bold text-slate-700"
                  >
                    ยกเลิก
                  </button>
                  {associatedScope === 'house_type' && (garageOrientation === 'left' || garageOrientation === 'right') && (
                    <button
                      type="button"
                      onClick={() => handleSaveDrawing(true)}
                      disabled={loading || uploadingFile}
                      className="flex-1 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 py-2.5 px-3 rounded-xl text-xs font-bold disabled:opacity-50"
                    >
                      บันทึกแล้วอัปโหลดฝั่ง{garageOrientation === 'left' ? 'ขวา' : 'ซ้าย'}ต่อ (+)
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleSaveDrawing(false)}
                    disabled={loading || uploadingFile}
                    className="flex-1 bg-purple-600 hover:bg-purple-700 py-2.5 px-4 rounded-xl text-xs font-bold text-white shadow-md disabled:opacity-50"
                  >
                    {loading ? 'กำลังบันทึก...' : 'บันทึกแบบแปลน'}
                  </button>
                </div>
              </div>
            ) : filteredDrawings.length === 0 ? (
              <div className="py-16 text-center space-y-3 bg-slate-50 rounded-3xl border border-dashed border-slate-200">
                <ImageIcon className="mx-auto text-slate-300" size={44} />
                <div>
                  <p className="text-sm font-bold text-slate-700">ยังไม่มีแบบแปลนในหมวดนี้</p>
                  <p className="text-xs text-slate-400 mt-1">
                    กดปุ่ม &quot;+ อัปโหลดแบบแปลนใหม่&quot; เพื่ออัปโหลดรูปแปลนซ้าย/ขวา ผังโครงการ หรือแบบมาตรฐานกลางได้ทันที
                  </p>
                </div>
                {canEdit && (
                  <div className="flex items-center justify-center gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => handleOpenUploadForm(activeTarget ? 'left' : undefined)}
                      className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-bold shadow-sm"
                    >
                      + อัปโหลดแบบแปลนใหม่
                    </button>
                  </div>
                )}
              </div>
            ) : (
              /* Drawing Grid */
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                {filteredDrawings.map(draw => {
                  const htName = draw.house_type_id ? (houseTypeNameMap.get(draw.house_type_id) || draw.house_type_id) : null;
                  const pName = draw.plot_id ? (plotNameMap.get(draw.plot_id) || draw.plot_id) : null;
                  const tName = draw.task_template_id ? (taskNameMap.get(draw.task_template_id) || null) : null;

                  return (
                    <div
                      key={draw.id}
                      className="bg-white border border-slate-200 rounded-2xl overflow-hidden hover:border-purple-300 hover:shadow-md transition-all flex flex-col justify-between"
                    >
                      <div className="h-36 bg-slate-900 flex items-center justify-center relative overflow-hidden group">
                        {draw.file_url && draw.file_type === 'image' ? (
                          <img src={draw.file_url} alt={draw.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                        ) : (
                          <div className="flex flex-col items-center text-slate-400">
                            <FileText size={34} />
                            <span className="text-[10px] font-bold mt-1">PDF DOCUMENT</span>
                          </div>
                        )}
                        <span className="absolute top-2 left-2 bg-black/75 text-white font-mono text-[10px] px-2 py-0.5 rounded-full font-bold">
                          {draw.drawing_number} (v{draw.version})
                        </span>
                        {canEdit && (
                          <button
                            type="button"
                            onClick={() => handleRetireDrawing(draw)}
                            className="absolute top-2 right-2 p-1.5 bg-black/60 hover:bg-rose-600 text-white rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
                            title="ลบแบบแปลนนี้"
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>

                      <div className="p-4 flex-1 flex flex-col justify-between">
                        <div>
                          <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
                            <h4 className="font-bold text-slate-800 text-sm line-clamp-2">{draw.title}</h4>
                          </div>

                          <div className="flex flex-wrap gap-1 mb-2">
                            {draw.garage_orientation === 'left' && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-black bg-blue-50 text-blue-700 border border-blue-200">
                                🚗 จอดรถซ้าย
                              </span>
                            )}
                            {draw.garage_orientation === 'right' && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-black bg-purple-50 text-purple-700 border border-purple-200">
                                🚗 จอดรถขวา
                              </span>
                            )}
                            {(!draw.garage_orientation || draw.garage_orientation === 'standard') && draw.house_type_id && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
                                ➖ มาตรฐานซ้าย/ขวา
                              </span>
                            )}
                            {draw.plot_id ? (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                📍 เฉพาะแปลง: {pName}
                              </span>
                            ) : htName ? (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                                🏠 แบบบ้าน: {htName}
                              </span>
                            ) : draw.project_name ? (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                                🗺️ ผังโครงการ: {draw.project_name}
                              </span>
                            ) : (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                                🌐 มาตรฐานกลาง (ทุกโครงการ)
                              </span>
                            )}
                          </div>

                          {tName && (
                            <p className="text-[10px] text-slate-500 font-bold truncate">
                              งาน: {tName}
                            </p>
                          )}
                        </div>

                        <div className="mt-3 pt-2 border-t border-slate-100 flex flex-col gap-2">
                          {/* Master plan viewport configuration button */}
                          {draw.file_type === 'image' && !draw.plot_id && (
                            <button
                              type="button"
                              onClick={() => setActiveViewportModalDrawing(draw)}
                              className="w-full py-1.5 px-2 bg-purple-50 hover:bg-purple-100 text-purple-700 rounded-xl text-[11px] font-bold flex items-center justify-center gap-1.5 border border-purple-200 transition"
                            >
                              <MapPin size={12} />
                              <span>📍 ล็อคมุมมองซูมแปลงบนผังนี้</span>
                            </button>
                          )}

                          <div className="flex items-center justify-between">
                            {draw.file_url && (
                              <a
                                href={draw.file_url}
                                target="_blank"
                                rel="noreferrer"
                                className="text-[11px] font-bold text-slate-600 hover:text-purple-700 flex items-center gap-1"
                              >
                                <ExternalLink size={12} />
                                <span>ดูไฟล์</span>
                              </a>
                            )}

                            {onSelectDrawing && (
                              <button
                                type="button"
                                onClick={() => {
                                  onSelectDrawing(draw);
                                  onClose();
                                }}
                                className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-bold transition-all shadow-sm"
                              >
                                เลือกแบบนี้
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Master Plan Viewport Modal */}
      {activeViewportModalDrawing && (
        <QCMasterPlanViewportModal
          isOpen={true}
          onClose={() => setActiveViewportModalDrawing(null)}
          drawing={activeViewportModalDrawing}
          projectName={selectedProjectName || projectName}
          plots={plots}
          onSaved={() => fetchDrawings()}
        />
      )}
    </>
  );
}
