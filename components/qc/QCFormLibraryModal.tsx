// ==============================================================================
// 📋 BUILDTRACK: QC FORM LIBRARY & BUILDER MODAL (คลังแม่แบบฟอร์มตรวจ)
// ==============================================================================

import React, { useState, useEffect } from 'react';
import { 
  X, Plus, FileText, CheckCircle, AlertTriangle, Layers, Eye, Edit3, 
  Trash2, Copy, Save, Tag, ShieldAlert, Sparkles, Check, ArrowRight, CornerDownRight, RefreshCw
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { QCFormTemplate, QCFormItem, QCFormItemType } from '@/types/qc.types';

export const CATEGORY_CODE_PREFIX: Record<string, string> = {
  'งานโครงสร้าง': 'STR',
  'งานสถาปัตย์': 'ARC',
  'งานระบบสุขาภิบาล': 'SAN',
  'งานระบบไฟฟ้า': 'ELC',
  'งานภายนอก': 'EXT'
};

export function generateNextFormCode(category: string, existingTemplates: QCFormTemplate[]): string {
  const prefix = CATEGORY_CODE_PREFIX[category] || 'GEN';
  const pattern = new RegExp(`^QC-${prefix}-(\\d+)$`, 'i');
  let maxSeq = 0;

  for (const t of existingTemplates) {
    const match = String(t.code || '').trim().match(pattern);
    if (match) {
      const seq = parseInt(match[1], 10);
      if (!Number.isNaN(seq) && seq > maxSeq) {
        maxSeq = seq;
      }
    }
  }

  return `QC-${prefix}-${String(maxSeq + 1).padStart(3, '0')}`;
}

interface QCFormLibraryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectTemplate?: (template: QCFormTemplate, applyToAllHouseTypes?: boolean) => void;
  currentUserRole: string;
  loggedInUsername: string;
  activeTarget?: {
    houseTypeId: string;
    houseTypeName?: string;
    taskName: string;
  } | null;
}

export default function QCFormLibraryModal({
  isOpen,
  onClose,
  onSelectTemplate,
  currentUserRole,
  loggedInUsername,
  activeTarget
}: QCFormLibraryModalProps) {
  const [templates, setTemplates] = useState<QCFormTemplate[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('ทั้งหมด');
  const [editingTemplate, setEditingTemplate] = useState<QCFormTemplate | null>(null);
  const [isPreviewMode, setIsPreviewMode] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [applyToAllHouseTypes, setApplyToAllHouseTypes] = useState<boolean>(false);
  const [autoSyncCode, setAutoSyncCode] = useState<boolean>(true);

  const isAdmin = currentUserRole === 'Admin' || currentUserRole === 'Owner';
  const canEdit = isAdmin;

  // Fetch templates
  const fetchTemplates = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('qc_form_templates')
        .select('*, items:qc_form_items(*)')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setTemplates(data || []);
    } catch (err: any) {
      setErrorMsg(err.message || 'ไม่สามารถโหลดแม่แบบฟอร์มได้');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchTemplates();
      setEditingTemplate(null);
      setIsPreviewMode(false);
      setApplyToAllHouseTypes(false);
    }
  }, [isOpen]);

  // Categories
  const categories = ['ทั้งหมด', 'งานโครงสร้าง', 'งานสถาปัตย์', 'งานระบบสุขาภิบาล', 'งานระบบไฟฟ้า', 'งานภายนอก'];

  const filteredTemplates = templates.filter(t => {
    if (selectedCategory === 'ทั้งหมด') return true;
    return t.category === selectedCategory;
  });

  // Start new template
  const handleCreateNew = () => {
    const defaultCategory = selectedCategory !== 'ทั้งหมด' ? selectedCategory : 'งานสถาปัตย์';
    const nextCode = generateNextFormCode(defaultCategory, templates);
    const newTmpl: QCFormTemplate = {
      id: '',
      code: nextCode,
      title: 'แบบฟอร์มตรวจงานใหม่',
      description: '',
      category: defaultCategory,
      version: 1,
      status: 'draft',
      items: [
        {
          id: `temp-${Date.now()}-1`,
          form_template_id: '',
          item_order: 1,
          section_title: 'การตรวจสอบทั่วไป',
          item_code: 'Q01',
          item_text: 'ตรวจสอบความเรียบร้อยและระดับงาน',
          item_type: 'pass_fail_na',
          is_required: true,
          is_critical: false,
          require_remark_on_fail: true,
          require_photo_on_fail: false
        }
      ]
    };
    setAutoSyncCode(true);
    setEditingTemplate(newTmpl);
    setIsPreviewMode(false);
  };

  // Clone as new version
  const handleCloneNewVersion = (tmpl: QCFormTemplate) => {
    const nextVersion = tmpl.version + 1;
    const cloned: QCFormTemplate = {
      ...tmpl,
      id: '', // New record
      version: nextVersion,
      status: 'draft',
      items: (tmpl.items || []).map((it, idx) => ({
        ...it,
        id: `temp-${Date.now()}-${idx}`,
        form_template_id: ''
      }))
    };
    setAutoSyncCode(false);
    setEditingTemplate(cloned);
    setIsPreviewMode(false);
  };

  // Add Item to Template
  const handleAddItem = () => {
    if (!editingTemplate) return;
    const items = editingTemplate.items || [];
    const nextNum = items.length + 1;
    const newItem: QCFormItem = {
      id: `temp-${Date.now()}-${nextNum}`,
      form_template_id: editingTemplate.id,
      item_order: nextNum,
      section_title: items[items.length - 1]?.section_title || 'หมวดตรวจสอบ',
      item_code: `Q${String(nextNum).padStart(2, '0')}`,
      item_text: '',
      item_type: 'pass_fail_na',
      is_required: true,
      is_critical: false,
      require_remark_on_fail: true,
      require_photo_on_fail: false
    };
    setEditingTemplate({ ...editingTemplate, items: [...items, newItem] });
  };

  // Save Template
  const handleSaveTemplate = async (publish: boolean = false) => {
    if (!editingTemplate) return;
    if (!editingTemplate.title.trim()) {
      alert('กรุณาระบุชื่อแบบฟอร์ม');
      return;
    }

    setLoading(true);
    try {
      const templatePayload = {
        code: editingTemplate.code,
        title: editingTemplate.title,
        description: editingTemplate.description || '',
        category: editingTemplate.category,
        version: editingTemplate.version,
        status: publish ? 'published' : editingTemplate.status,
        created_by: loggedInUsername,
        updated_at: new Date().toISOString()
      };

      let tmplId = editingTemplate.id;

      if (tmplId) {
        const { error: updErr } = await supabase
          .from('qc_form_templates')
          .update(templatePayload)
          .eq('id', tmplId);
        if (updErr) throw updErr;
      } else {
        const { data: insData, error: insErr } = await supabase
          .from('qc_form_templates')
          .insert([templatePayload])
          .select('id')
          .single();
        if (insErr) throw insErr;
        tmplId = insData.id;
      }

      // Save items
      if (tmplId && editingTemplate.items) {
        // delete old items and re-insert
        await supabase.from('qc_form_items').delete().eq('form_template_id', tmplId);
        const itemsPayload = editingTemplate.items.map((it, idx) => ({
          form_template_id: tmplId,
          item_order: idx + 1,
          section_title: it.section_title || 'หมวดตรวจสอบ',
          item_code: it.item_code || `Q${idx + 1}`,
          item_text: it.item_text || 'คำถามตรวจสอบ',
          description: it.description || '',
          item_type: it.item_type,
          is_required: it.is_required,
          is_critical: it.is_critical,
          require_remark_on_fail: it.require_remark_on_fail,
          require_photo_on_fail: it.require_photo_on_fail,
          unit: it.unit || null,
          target_value: it.target_value ?? null,
          min_value: it.min_value ?? null,
          max_value: it.max_value ?? null,
          options: it.options || []
        }));

        await supabase.from('qc_form_items').insert(itemsPayload);
      }

      await fetchTemplates();
      setEditingTemplate(null);
    } catch (err: any) {
      if (err?.code === '23505') {
        alert(`รหัสแบบฟอร์ม "${editingTemplate.code}" (v${editingTemplate.version}) มีอยู่ในระบบแล้ว กรุณากดปุ่มสร้างรหัสอัตโนมัติ หรือเปลี่ยนรหัสใหม่ครับ`);
      } else {
        alert(err.message || 'บันทึกฟอร์มไม่สำเร็จ');
      }
    } finally {
      setLoading(false);
    }
  };

  // Quickly publish a draft template and select it immediately
  const handlePublishAndSelect = async (tmpl: QCFormTemplate) => {
    setLoading(true);
    try {
      const { data: updated, error } = await supabase
        .from('qc_form_templates')
        .update({ status: 'published', updated_at: new Date().toISOString() })
        .eq('id', tmpl.id)
        .select('*, items:qc_form_items(*)')
        .single();
      if (error) throw error;
      if (onSelectTemplate && updated) {
        onSelectTemplate(updated, applyToAllHouseTypes);
        onClose();
      } else {
        await fetchTemplates();
      }
    } catch (err: any) {
      alert(err.message || 'เผยแพร่ฟอร์มไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  // Delete template (Admin only)
  const handleDeleteTemplate = async (tmpl: QCFormTemplate) => {
    if (!isAdmin) {
      alert('เฉพาะผู้ดูแลระบบ (Admin) เท่านั้นที่สามารถลบแบบฟอร์มได้');
      return;
    }

    const confirmDelete = window.confirm(
      `คุณแน่ใจหรือไม่ว่าต้องการลบแบบฟอร์ม "${tmpl.title}" (${tmpl.code} v${tmpl.version}) ออกจากระบบ?\n\nข้อตรวจและข้อมูลทั้งหมดของฟอร์มนี้จะถูกลบอย่างถาวร`
    );
    if (!confirmDelete) return;

    setLoading(true);
    try {
      // Clean standard sets referencing this template
      await supabase.from('qc_standard_sets').delete().eq('form_template_id', tmpl.id);
      // Clean plot task configs referencing this template
      await supabase.from('qc_plot_task_configs').delete().eq('form_template_id', tmpl.id);
      // Delete form items
      await supabase.from('qc_form_items').delete().eq('form_template_id', tmpl.id);
      // Delete template
      const { error } = await supabase.from('qc_form_templates').delete().eq('id', tmpl.id);
      if (error) throw error;

      if (editingTemplate?.id === tmpl.id) {
        setEditingTemplate(null);
      }

      await fetchTemplates();
    } catch (err: any) {
      console.error('Error deleting template:', err);
      alert(err.message || 'ไม่สามารถลบแบบฟอร์มได้');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 z-[999] animate-in fade-in">
      <div className="bg-white rounded-3xl max-w-5xl w-full h-[90vh] flex flex-col overflow-hidden shadow-2xl border border-slate-200">
        {/* Header */}
        <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="bg-purple-600 p-2 rounded-xl">
              <FileText size={20} />
            </div>
            <div>
              <h3 className="font-bold text-base">คลังแม่แบบฟอร์มตรวจ QC (QC Form Library)</h3>
              <p className="text-xs text-slate-400">
                {activeTarget
                  ? `เลือกชุดคำถามกลางสำหรับ: ${activeTarget.taskName}${activeTarget.houseTypeName ? ` (${activeTarget.houseTypeName})` : ''}`
                  : 'สร้างแม่แบบคำถามกลางครั้งเดียว เพื่อนำไปใช้ซ้ำได้กับทุกแบบบ้าน'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-white rounded-lg"><X size={20} /></button>
        </div>

        {/* Apply across all house types banner when picking for a task */}
        {activeTarget && !editingTemplate && onSelectTemplate && (
          <div className="px-6 py-2.5 bg-purple-50 border-b border-purple-200 flex flex-wrap items-center justify-between gap-2 shrink-0">
            <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-purple-900 select-none">
              <input
                type="checkbox"
                checked={applyToAllHouseTypes}
                onChange={(e) => setApplyToAllHouseTypes(e.target.checked)}
                className="w-4 h-4 rounded text-purple-600 focus:ring-purple-500"
              />
              <span>
                ✨ ผูกฟอร์มที่เลือกกับงาน <span className="underline">&quot;{activeTarget.taskName}&quot;</span> ในทุกแบบบ้านของโครงการนี้ด้วย (ไม่ซ้ำซ้อน)
              </span>
            </label>
            <span className="text-[10px] text-purple-600 font-bold">
              * แบบแปลนของแต่ละแบบบ้านจะแยกอ้างอิงตามแบบบ้านนั้นๆ เสมอ
            </span>
          </div>
        )}

        {/* Content View */}
        <div className="flex-1 overflow-hidden flex flex-col md:flex-row">
          {/* Main List or Editor */}
          {!editingTemplate ? (
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Category Filter & Actions */}
              <div className="p-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3 bg-slate-50 shrink-0">
                <div className="flex items-center gap-1.5 overflow-x-auto">
                  {categories.map(cat => (
                    <button
                      key={cat}
                      onClick={() => setSelectedCategory(cat)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
                        selectedCategory === cat 
                          ? 'bg-purple-600 text-white shadow-sm' 
                          : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>

                {canEdit && (
                  <button
                    onClick={handleCreateNew}
                    className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-md"
                  >
                    <Plus size={16} />
                    <span>สร้างแม่แบบใหม่</span>
                  </button>
                )}
              </div>

              {/* Templates Grid */}
              <div className="flex-1 overflow-y-auto p-4 sm:p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredTemplates.length === 0 ? (
                  <div className="col-span-full py-12 text-center space-y-3 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                    <FileText className="mx-auto text-slate-300" size={40} />
                    <p className="text-sm font-bold text-slate-600">ยังไม่มีแม่แบบฟอร์มตรวจในหมวดนี้</p>
                    {canEdit && (
                      <button
                        onClick={handleCreateNew}
                        className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-bold inline-flex items-center gap-1.5 shadow-sm"
                      >
                        <Plus size={14} />
                        <span>+ สร้างแม่แบบฟอร์มแรก</span>
                      </button>
                    )}
                  </div>
                ) : (
                  filteredTemplates.map(tmpl => (
                    <div
                      key={tmpl.id}
                      className="bg-white border border-slate-200 rounded-2xl p-5 hover:border-purple-300 hover:shadow-md transition-all flex flex-col justify-between"
                    >
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-mono text-xs font-bold text-purple-700 bg-purple-50 px-2 py-0.5 rounded-lg border border-purple-200">
                            {tmpl.code} (v{tmpl.version})
                          </span>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            tmpl.status === 'published' ? 'bg-emerald-100 text-emerald-700' :
                            tmpl.status === 'retired' ? 'bg-slate-100 text-slate-500' :
                            'bg-amber-100 text-amber-700'
                          }`}>
                            {tmpl.status === 'published' ? 'เผยแพร่แล้ว' : tmpl.status === 'retired' ? 'ยกเลิก' : 'ฉบับร่าง'}
                          </span>
                        </div>
                        <h4 className="font-bold text-slate-800 text-base">{tmpl.title}</h4>
                        {tmpl.description && <p className="text-xs text-slate-500 mt-1">{tmpl.description}</p>}
                        <div className="mt-3 flex items-center gap-2 text-xs text-slate-400 font-bold">
                          <Tag size={12} />
                          <span>หมวด: {tmpl.category}</span>
                          <span>• {tmpl.items?.length || 0} ข้อตรวจ</span>
                        </div>
                      </div>

                      <div className="mt-5 pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1">
                          {isAdmin && (
                            <button
                              onClick={() => {
                                setAutoSyncCode(false);
                                setEditingTemplate(tmpl);
                              }}
                              className="p-1.5 text-slate-600 hover:text-purple-600 hover:bg-purple-50 rounded-lg text-xs font-bold transition-colors"
                              title="แก้ไขฟอร์ม (เฉพาะ Admin)"
                            >
                              <Edit3 size={16} />
                            </button>
                          )}
                          {isAdmin && (
                            <button
                              onClick={() => handleDeleteTemplate(tmpl)}
                              className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg text-xs font-bold transition-colors"
                              title="ลบฟอร์ม (เฉพาะ Admin)"
                            >
                              <Trash2 size={16} />
                            </button>
                          )}
                          {isAdmin && tmpl.status === 'published' && (
                            <button
                              onClick={() => handleCloneNewVersion(tmpl)}
                              className="p-1.5 text-slate-600 hover:text-blue-600 hover:bg-blue-50 rounded-lg text-xs font-bold flex items-center gap-1 transition-colors"
                              title="สร้างเวอร์ชันใหม่ (Clone)"
                            >
                              <Copy size={14} />
                              <span className="text-[10px]">v{tmpl.version + 1}</span>
                            </button>
                          )}
                        </div>

                        {onSelectTemplate && tmpl.status === 'published' && (
                          <button
                            onClick={() => {
                              onSelectTemplate(tmpl, applyToAllHouseTypes);
                              onClose();
                            }}
                            className="px-3 py-1.5 bg-purple-600 text-white hover:bg-purple-700 rounded-xl text-xs font-bold transition-all shadow-sm"
                          >
                            {applyToAllHouseTypes ? 'เลือกใช้กับทุกแบบบ้าน' : 'เลือกใช้ฟอร์มนี้'}
                          </button>
                        )}
                        {onSelectTemplate && tmpl.status === 'draft' && canEdit && (
                          <button
                            onClick={() => handlePublishAndSelect(tmpl)}
                            className="px-3 py-1.5 bg-emerald-50 text-emerald-700 hover:bg-emerald-600 hover:text-white rounded-xl text-xs font-bold transition-all border border-emerald-200"
                          >
                            เผยแพร่และเลือกใช้
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : (
            /* Template Editor / Preview Mode */
            <div className="flex-1 flex flex-col overflow-hidden bg-slate-50">
              {/* Editor Header Bar */}
              <div className="p-4 bg-white border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 shrink-0">
                <div className="flex items-center gap-2">
                  <button onClick={() => setEditingTemplate(null)} className="p-1 text-slate-400 hover:text-slate-700"><ArrowRight className="rotate-180" size={18} /></button>
                  <h4 className="font-bold text-slate-800 text-sm">
                    {editingTemplate.id ? `แก้ไขแบบฟอร์ม: ${editingTemplate.title}` : 'สร้างแบบฟอร์มใหม่'} (v{editingTemplate.version})
                  </h4>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setIsPreviewMode(!isPreviewMode)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1 border ${
                      isPreviewMode ? 'bg-purple-600 text-white' : 'bg-white text-slate-700 border-slate-200'
                    }`}
                  >
                    <Eye size={14} />
                    <span>{isPreviewMode ? 'กลับไปโหมดแก้ไข' : 'ดูตัวอย่างหน้าคนตรวจ (Preview)'}</span>
                  </button>

                  {!isPreviewMode && (
                    <>
                      {editingTemplate.id && isAdmin && (
                        <button
                          type="button"
                          onClick={() => handleDeleteTemplate(editingTemplate)}
                          className="px-3 py-1.5 text-rose-600 hover:bg-rose-50 border border-rose-200 rounded-xl text-xs font-bold flex items-center gap-1 transition-colors"
                          title="ลบฟอร์มนี้ออกจากระบบ"
                        >
                          <Trash2 size={14} />
                          <span>ลบฟอร์ม</span>
                        </button>
                      )}
                      <button
                        onClick={() => handleSaveTemplate(false)}
                        className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-bold"
                      >
                        บันทึกฉบับร่าง
                      </button>
                      <button
                        onClick={() => handleSaveTemplate(true)}
                        className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center gap-1"
                      >
                        <Check size={14} />
                        <span>เผยแพร่ (Publish)</span>
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Editor Fields or Preview */}
              <div className="flex-1 overflow-y-auto p-4 sm:p-6">
                {!isPreviewMode ? (
                  <div className="max-w-4xl mx-auto space-y-5">
                    {/* Basic Meta */}
                    <div className="bg-white p-5 rounded-2xl border border-slate-200 space-y-3">
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <label className="text-[10px] font-bold text-slate-400 uppercase">รหัสแบบฟอร์ม</label>
                            {!editingTemplate.id && (
                              <button
                                type="button"
                                onClick={() => {
                                  const nextCode = generateNextFormCode(editingTemplate.category, templates);
                                  setAutoSyncCode(true);
                                  setEditingTemplate({ ...editingTemplate, code: nextCode });
                                }}
                                className="text-[10px] font-bold text-purple-600 hover:text-purple-800 flex items-center gap-0.5"
                                title="สร้างรหัสอัตโนมัติตามหมวดงาน"
                              >
                                <RefreshCw size={10} />
                                <span>รันรหัสใหม่</span>
                              </button>
                            )}
                          </div>
                          <input
                            type="text"
                            value={editingTemplate.code}
                            onChange={(e) => {
                              setAutoSyncCode(false);
                              setEditingTemplate({ ...editingTemplate, code: e.target.value });
                            }}
                            placeholder="เช่น QC-ARC-001"
                            className="w-full border border-slate-200 rounded-xl p-2 text-xs font-mono font-bold text-slate-800"
                          />
                        </div>
                        <div className="sm:col-span-2">
                          <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">ชื่อแบบฟอร์มตรวจ</label>
                          <input
                            type="text"
                            value={editingTemplate.title}
                            onChange={(e) => setEditingTemplate({ ...editingTemplate, title: e.target.value })}
                            placeholder="เช่น แบบฟอร์มตรวจงานก่อผนังมวลเบา"
                            className="w-full border border-slate-200 rounded-xl p-2 text-xs font-bold text-slate-800"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">หมวดหมู่งาน</label>
                          <select
                            value={editingTemplate.category}
                            onChange={(e) => {
                              const newCategory = e.target.value;
                              if (autoSyncCode && !editingTemplate.id) {
                                const nextCode = generateNextFormCode(newCategory, templates);
                                setEditingTemplate({ ...editingTemplate, category: newCategory, code: nextCode });
                              } else {
                                setEditingTemplate({ ...editingTemplate, category: newCategory });
                              }
                            }}
                            className="w-full border border-slate-200 rounded-xl p-2 text-xs font-bold text-slate-800"
                          >
                            {categories.filter(c => c !== 'ทั้งหมด').map(c => (
                              <option key={c} value={c}>{c}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">คำอธิบาย</label>
                          <input
                            type="text"
                            value={editingTemplate.description || ''}
                            onChange={(e) => setEditingTemplate({ ...editingTemplate, description: e.target.value })}
                            placeholder="รายละเอียดหรือมาตรฐานที่เกี่ยวข้อง..."
                            className="w-full border border-slate-200 rounded-xl p-2 text-xs font-bold text-slate-800"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Question Items */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h4 className="font-bold text-slate-800 text-sm">รายการตรวจ ({editingTemplate.items?.length || 0} ข้อ)</h4>
                        <button
                          onClick={handleAddItem}
                          className="px-3 py-1.5 bg-purple-50 text-purple-700 hover:bg-purple-100 rounded-xl text-xs font-bold flex items-center gap-1"
                        >
                          <Plus size={14} /> เพิ่มข้อตรวจ
                        </button>
                      </div>

                      {(editingTemplate.items || []).map((item, idx) => (
                        <div key={item.id} className="bg-white p-4 rounded-2xl border border-slate-200 space-y-3 relative group">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-xs font-bold text-purple-700 bg-purple-50 px-2 py-0.5 rounded-md">
                                ข้อ {idx + 1}
                              </span>
                              <input
                                type="text"
                                value={item.item_code}
                                onChange={(e) => {
                                  const updated = [...(editingTemplate.items || [])];
                                  updated[idx] = { ...item, item_code: e.target.value };
                                  setEditingTemplate({ ...editingTemplate, items: updated });
                                }}
                                placeholder="รหัส เช่น Q01"
                                className="w-20 border border-slate-200 rounded-lg p-1 text-xs font-mono font-bold"
                              />
                              <input
                                type="text"
                                value={item.section_title || ''}
                                onChange={(e) => {
                                  const updated = [...(editingTemplate.items || [])];
                                  updated[idx] = { ...item, section_title: e.target.value };
                                  setEditingTemplate({ ...editingTemplate, items: updated });
                                }}
                                placeholder="หมวดย่อย..."
                                className="w-32 border border-slate-200 rounded-lg p-1 text-xs"
                              />
                            </div>

                            <button
                              onClick={() => {
                                const updated = (editingTemplate.items || []).filter((_, i) => i !== idx);
                                setEditingTemplate({ ...editingTemplate, items: updated });
                              }}
                              className="text-slate-400 hover:text-rose-600 p-1"
                              title="ลบข้อนี้"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>

                          <div>
                            <input
                              type="text"
                              value={item.item_text}
                              onChange={(e) => {
                                const updated = [...(editingTemplate.items || [])];
                                updated[idx] = { ...item, item_text: e.target.value };
                                setEditingTemplate({ ...editingTemplate, items: updated });
                              }}
                              placeholder="คำถามหรือเกณฑ์ที่ต้องตรวจสอบ (เช่น ตรวจแนวดิ่งของผนัง)..."
                              className="w-full border border-slate-200 rounded-xl p-2.5 text-xs font-bold text-slate-800"
                            />
                          </div>

                          {/* Item Config Row */}
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-xs">
                            <div>
                              <label className="text-[10px] font-bold text-slate-400 block mb-0.5">ประเภทคำตอบ</label>
                              <select
                                value={item.item_type}
                                onChange={(e) => {
                                  const updated = [...(editingTemplate.items || [])];
                                  updated[idx] = { ...item, item_type: e.target.value as QCFormItemType };
                                  setEditingTemplate({ ...editingTemplate, items: updated });
                                }}
                                className="w-full border border-slate-200 rounded-lg p-1.5 text-xs font-bold"
                              >
                                <option value="pass_fail_na">ผ่าน / ไม่ผ่าน / N/A</option>
                                <option value="number">ตัวเลขที่วัดได้</option>
                                <option value="drawing_point">จุดปักหมุดบนแบบ</option>
                                <option value="text">ข้อความ / หมายเหตุ</option>
                                <option value="photo">รูปถ่ายหลักฐาน</option>
                              </select>
                            </div>

                            {item.item_type === 'number' && (
                              <>
                                <div>
                                  <label className="text-[10px] font-bold text-slate-400 block mb-0.5">หน่วย</label>
                                  <input
                                    type="text"
                                    value={item.unit || ''}
                                    onChange={(e) => {
                                      const updated = [...(editingTemplate.items || [])];
                                      updated[idx] = { ...item, unit: e.target.value };
                                      setEditingTemplate({ ...editingTemplate, items: updated });
                                    }}
                                    placeholder="มม., ซม."
                                    className="w-full border border-slate-200 rounded-lg p-1.5 text-xs"
                                  />
                                </div>
                                <div>
                                  <label className="text-[10px] font-bold text-slate-400 block mb-0.5">ต่ำสุด (Min)</label>
                                  <input
                                    type="number"
                                    step="any"
                                    value={item.min_value ?? ''}
                                    onChange={(e) => {
                                      const updated = [...(editingTemplate.items || [])];
                                      updated[idx] = { ...item, min_value: e.target.value === '' ? null : Number(e.target.value) };
                                      setEditingTemplate({ ...editingTemplate, items: updated });
                                    }}
                                    className="w-full border border-slate-200 rounded-lg p-1.5 text-xs"
                                  />
                                </div>
                                <div>
                                  <label className="text-[10px] font-bold text-slate-400 block mb-0.5">สูงสุด (Max)</label>
                                  <input
                                    type="number"
                                    step="any"
                                    value={item.max_value ?? ''}
                                    onChange={(e) => {
                                      const updated = [...(editingTemplate.items || [])];
                                      updated[idx] = { ...item, max_value: e.target.value === '' ? null : Number(e.target.value) };
                                      setEditingTemplate({ ...editingTemplate, items: updated });
                                    }}
                                    className="w-full border border-slate-200 rounded-lg p-1.5 text-xs"
                                  />
                                </div>
                              </>
                            )}
                          </div>

                          {/* Flags: Required, Critical, Require Remark */}
                          <div className="flex flex-wrap items-center gap-4 pt-1 border-t border-slate-100 text-xs">
                            <label className="flex items-center gap-1.5 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={item.is_required}
                                onChange={(e) => {
                                  const updated = [...(editingTemplate.items || [])];
                                  updated[idx] = { ...item, is_required: e.target.checked };
                                  setEditingTemplate({ ...editingTemplate, items: updated });
                                }}
                                className="rounded text-purple-600"
                              />
                              <span className="font-bold text-slate-700">จำเป็นต้องตรวจ (Required)</span>
                            </label>

                            <label className="flex items-center gap-1.5 cursor-pointer text-rose-700">
                              <input
                                type="checkbox"
                                checked={item.is_critical}
                                onChange={(e) => {
                                  const updated = [...(editingTemplate.items || [])];
                                  updated[idx] = { ...item, is_critical: e.target.checked };
                                  setEditingTemplate({ ...editingTemplate, items: updated });
                                }}
                                className="rounded text-rose-600"
                              />
                              <span className="font-bold">ข้อสำคัญ (ถ้าตกจะไม่ผ่านทันที)</span>
                            </label>

                            <label className="flex items-center gap-1.5 cursor-pointer text-slate-600">
                              <input
                                type="checkbox"
                                checked={item.require_remark_on_fail}
                                onChange={(e) => {
                                  const updated = [...(editingTemplate.items || [])];
                                  updated[idx] = { ...item, require_remark_on_fail: e.target.checked };
                                  setEditingTemplate({ ...editingTemplate, items: updated });
                                }}
                                className="rounded text-purple-600"
                              />
                              <span>ไม่ผ่านต้องมีหมายเหตุ</span>
                            </label>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  /* Inspector Preview Mode */
                  <div className="max-w-3xl mx-auto bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
                    <div className="bg-purple-50 p-3 rounded-xl border border-purple-200 flex items-center gap-2 text-xs text-purple-800 font-bold">
                      <Eye size={16} />
                      <span>โหมดแสดงตัวอย่าง (Preview): หน้าตาฟอร์มตรวจตามมุมมองของผู้ตรวจสอบคุณภาพจริง</span>
                    </div>

                    <h3 className="font-bold text-slate-800 text-lg border-b pb-2">{editingTemplate.title} (v{editingTemplate.version})</h3>

                    <div className="space-y-3">
                      {(editingTemplate.items || []).map((item, idx) => (
                        <div key={item.id} className="p-4 rounded-xl border border-slate-200 flex items-center justify-between gap-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-xs font-bold text-purple-700 bg-purple-50 px-2 py-0.5 rounded">
                                {item.item_code}
                              </span>
                              {item.is_critical && (
                                <span className="text-[10px] font-bold text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded">
                                  ข้อสำคัญ
                                </span>
                              )}
                              {item.is_required && <span className="text-red-500 text-xs">*</span>}
                            </div>
                            <p className="font-bold text-slate-800 text-sm leading-relaxed mt-1">{item.item_text}</p>
                          </div>

                          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
                            <span className="px-3 py-1 bg-white text-emerald-700 rounded-lg text-xs font-bold shadow-sm">ผ่าน</span>
                            <span className="px-3 py-1 text-slate-500 text-xs font-bold">ไม่ผ่าน</span>
                            <span className="px-2 py-1 text-slate-400 text-xs font-bold">N/A</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
