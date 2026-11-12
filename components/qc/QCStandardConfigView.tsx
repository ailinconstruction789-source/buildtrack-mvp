// ==============================================================================
// ⚙️ BUILDTRACK: QC STANDARD CONFIG VIEW (ชุดตรวจมาตรฐานโครงการ)
// ==============================================================================

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Settings, CheckCircle, AlertTriangle, Layers, Plus, Edit3, Trash2,
  FileText, MapPin, Filter, ArrowRight, ShieldCheck, Check, Sparkles, Building, Users,
  Eye, X, Loader2
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { QCStandardSet, QCFormTemplate, QCReferenceDrawing, QCTaskConfigResolution } from '@/types/qc.types';
import { resolveStandardSetPreviewConfig } from '@/lib/qc/qcConfigService';
import QCFormLibraryModal from './QCFormLibraryModal';
import QCDrawingLibraryModal from './QCDrawingLibraryModal';
import QCScopeAssignmentModal from './QCScopeAssignmentModal';
import QCInspectionRunner from './QCInspectionRunner';

interface QCStandardConfigViewProps {
  selectedProject?: string;
  currentUserRole: string;
  loggedInUsername: string;
  houseTypes?: any[];
  taskTemplates?: any[];
  plots?: any[];
  projects?: any[];
  onSelectProject?: (proj: any) => void;
}

export default function QCStandardConfigView({
  selectedProject = '',
  currentUserRole,
  loggedInUsername,
  houseTypes = [],
  taskTemplates = [],
  plots = [],
  projects = [],
  onSelectProject
}: QCStandardConfigViewProps) {
  const projectNamesList = Array.from(
    new Set([
      ...(selectedProject ? [selectedProject] : []),
      ...projects.map((p: any) => p.name).filter(Boolean),
      ...plots.map((p: any) => p.project_name).filter(Boolean)
    ])
  );

  const [currentProject, setCurrentProject] = useState<string>(
    selectedProject || projectNamesList[0] || ''
  );
  const [standardSets, setStandardSets] = useState<QCStandardSet[]>([]);
  const [allDrawings, setAllDrawings] = useState<QCReferenceDrawing[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterIncompleteOnly, setFilterIncompleteOnly] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'house' | 'infrastructure'>('all');
  const [selectedHouseType, setSelectedHouseType] = useState<string>('ทั้งหมด');
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  // Modals
  const [formLibraryOpen, setFormLibraryOpen] = useState(false);
  const [drawingLibraryOpen, setDrawingLibraryOpen] = useState(false);
  const [scopeAssignmentOpen, setScopeAssignmentOpen] = useState(false);
  const [activeConfigTarget, setActiveConfigTarget] = useState<{
    houseTypeId: string;
    houseTypeName: string;
    taskName: string;
    taskTemplateId: string;
    existingSet?: QCStandardSet;
  } | null>(null);

  // Admin View-Only Preview Modal state
  const [previewTarget, setPreviewTarget] = useState<{
    houseTypeId: string;
    houseTypeName: string;
    taskName: string;
    taskTemplateId: string;
    standardSet: QCStandardSet;
  } | null>(null);
  const [previewPlotId, setPreviewPlotId] = useState<string>('');
  const [previewResolution, setPreviewResolution] = useState<QCTaskConfigResolution | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewTab, setPreviewTab] = useState<'form' | 'drawing'>('form');
  const previewRequestSeqRef = useRef(0);

  const canEdit = currentUserRole === 'Admin' || currentUserRole === 'Owner' || currentUserRole === 'QC';

  // Sync currentProject if props load or change
  useEffect(() => {
    if (selectedProject && selectedProject !== currentProject) {
      setCurrentProject(selectedProject);
    } else if (!currentProject && projectNamesList.length > 0) {
      setCurrentProject(projectNamesList[0]);
    }
  }, [selectedProject, projectNamesList.join('|')]);

  // Counts for category tabs
  const houseCount = houseTypes.filter(ht => !ht.is_infrastructure).length;
  const infraCount = houseTypes.filter(ht => !!ht.is_infrastructure).length;

  // Fetch standard sets & drawings for current project
  const fetchStandardSets = useCallback(async () => {
    if (!currentProject) return;
    setLoading(true);
    try {
      const [setsRes, drawsRes] = await Promise.all([
        supabase
          .from('qc_standard_sets')
          .select('*, form_template:qc_form_templates(*), reference_drawing:qc_reference_drawings(*)')
          .eq('project_name', currentProject),
        supabase
          .from('qc_reference_drawings')
          .select('*')
          .eq('status', 'active')
      ]);

      if (setsRes.error) throw setsRes.error;
      setStandardSets(setsRes.data || []);
      if (!drawsRes.error) {
        setAllDrawings(drawsRes.data || []);
      }
    } catch (err: any) {
      console.error('Error fetching standard sets:', err);
    } finally {
      setLoading(false);
    }
  }, [currentProject]);

  useEffect(() => {
    fetchStandardSets();
  }, [fetchStandardSets]);

  // House types filtered by Category & Specific Selection
  const availableHouseTypes = houseTypes.filter(ht => {
    if (categoryFilter === 'house') return !ht.is_infrastructure;
    if (categoryFilter === 'infrastructure') return !!ht.is_infrastructure;
    return true;
  });

  const filteredHouseTypes = availableHouseTypes.filter(ht => {
    if (selectedHouseType === 'ทั้งหมด') return true;
    return ht.id === selectedHouseType || ht.type_name === selectedHouseType;
  });

  // Helper to get drawings linked to a specific (houseTypeId, taskId, set)
  const getTaskDrawings = (htId: string, taskId: string, set?: QCStandardSet) => {
    const taskSpecificDrawings = allDrawings.filter(
      d => d.house_type_id === htId && d.task_template_id === taskId
    );
    const leftDraw = taskSpecificDrawings.find(d => d.garage_orientation === 'left');
    const rightDraw = taskSpecificDrawings.find(d => d.garage_orientation === 'right');
    const standardTaskDraw = taskSpecificDrawings.find(d => !d.garage_orientation || d.garage_orientation === 'standard');
    const setDraw = set?.reference_drawing || (set?.drawing_id ? allDrawings.find(d => d.id === set.drawing_id) : undefined);

    return { leftDraw, rightDraw, standardTaskDraw, setDraw, hasAny: Boolean(leftDraw || rightDraw || standardTaskDraw || setDraw) };
  };

  // Calculate task counts
  let totalTasksCount = 0;
  let readyTasksCount = 0;

  filteredHouseTypes.forEach(ht => {
    const tasks = taskTemplates.filter(t => t.house_type_id === ht.id);
    const seen = new Set<string>();
    tasks.forEach(task => {
      if (seen.has(task.task_name)) return;
      seen.add(task.task_name);
      totalTasksCount++;
      const set = standardSets.find(s => s.house_type_id === ht.id && s.task_name === task.task_name);
      const drawsInfo = getTaskDrawings(ht.id, task.id, set);
      const hasForm = Boolean(set?.form_template_id);
      const isReady = hasForm && (!set?.require_plot_drawing ? true : drawsInfo.hasAny);
      if (isReady) readyTasksCount++;
    });
  });

  // Handle Form Selection (supports applying to all house types sharing same task_name)
  const handleSelectForm = async (tmpl: QCFormTemplate, applyToAllHouseTypes: boolean = false) => {
    if (!activeConfigTarget || !currentProject) return;

    try {
      const targetHouseTypeIds = applyToAllHouseTypes
        ? Array.from(
            new Set(
              taskTemplates
                .filter(t => t.task_name === activeConfigTarget.taskName)
                .map(t => t.house_type_id)
                .filter(Boolean)
            )
          )
        : [activeConfigTarget.houseTypeId];

      const payloads: Partial<QCStandardSet>[] = targetHouseTypeIds.map(htId => ({
        project_name: currentProject,
        house_type_id: htId,
        task_name: activeConfigTarget.taskName,
        set_name: `ชุดตรวจมาตรฐาน - ${activeConfigTarget.taskName}`,
        form_template_id: tmpl.id,
        form_version: tmpl.version,
        is_active: true,
        created_by: loggedInUsername,
        updated_at: new Date().toISOString()
      }));

      const { error } = await supabase
        .from('qc_standard_sets')
        .upsert(payloads, { onConflict: 'project_name,house_type_id,task_name' });

      if (error) throw error;
      await fetchStandardSets();
      if (applyToAllHouseTypes && targetHouseTypeIds.length > 1) {
        setStatusNotice(`ผูกฟอร์ม "${tmpl.title}" ให้กับงาน "${activeConfigTarget.taskName}" ทั้งหมด ${targetHouseTypeIds.length} แบบบ้านในโครงการ ${currentProject} เรียบร้อยแล้ว`);
        setTimeout(() => setStatusNotice(null), 5000);
      }
      setActiveConfigTarget(null);
    } catch (err: any) {
      alert(err.message || 'บันทึกการผูกฟอร์มไม่สำเร็จ');
    }
  };

  // Handle Drawing Selection
  const handleSelectDrawing = async (draw: QCReferenceDrawing) => {
    if (!activeConfigTarget || !currentProject) return;

    try {
      // If drawing belongs to this house_type without task_template_id, link task_template_id
      if (
        draw.house_type_id === activeConfigTarget.houseTypeId &&
        !draw.task_template_id &&
        activeConfigTarget.taskTemplateId
      ) {
        await supabase
          .from('qc_reference_drawings')
          .update({ task_template_id: activeConfigTarget.taskTemplateId })
          .eq('id', draw.id);
      }

      if (activeConfigTarget.existingSet) {
        const payload = {
          drawing_id: draw.id,
          drawing_version: draw.version,
          updated_at: new Date().toISOString()
        };

        const { error } = await supabase
          .from('qc_standard_sets')
          .update(payload)
          .eq('project_name', currentProject)
          .eq('house_type_id', activeConfigTarget.houseTypeId)
          .eq('task_name', activeConfigTarget.taskName);

        if (error) throw error;
      } else {
        setStatusNotice(
          `แบบแปลน "${draw.title}" พร้อมใช้งานแล้ว — กรุณากด "เลือกฟอร์ม" ในแถวเดียวกันเพื่อเลือกชุดคำถามตรวจและเปิดใช้งานครับ`
        );
        setTimeout(() => setStatusNotice(null), 6000);
      }

      await fetchStandardSets();
      setActiveConfigTarget(null);
    } catch (err: any) {
      alert(err.message || 'บันทึกการผูกแบบแปลนไม่สำเร็จ');
    }
  };

  // Toggle Require Plot Drawing
  const handleToggleRequirePlotDrawing = async (set: QCStandardSet) => {
    try {
      const { error } = await supabase
        .from('qc_standard_sets')
        .update({
          require_plot_drawing: !set.require_plot_drawing,
          updated_at: new Date().toISOString()
        })
        .eq('id', set.id);

      if (error) throw error;
      await fetchStandardSets();
    } catch (err: any) {
      alert(err.message || 'อัปเดตไม่สำเร็จ');
    }
  };

  // Candidate plots for simulating Form + Drawing + Viewport preview in current project
  const getPreviewCandidatePlots = (houseTypeId: string) => {
    const projectPlots = plots.filter(p => !currentProject || p.project_name === currentProject);
    const matching = projectPlots.filter(p => p.house_type_id === houseTypeId);
    const pool = matching.length > 0 ? matching : projectPlots;
    return [...pool].sort((a, b) =>
      String(a.plot_name || a.id).localeCompare(String(b.plot_name || b.id), undefined, { numeric: true })
    );
  };

  const loadPreviewResolution = async (
    target: {
      houseTypeId: string;
      houseTypeName: string;
      taskName: string;
      taskTemplateId: string;
      standardSet: QCStandardSet;
    },
    samplePlotId: string
  ) => {
    const reqSeq = ++previewRequestSeqRef.current;
    const plotObj = plots.find(p => p.id === samplePlotId);
    setPreviewLoading(true);
    try {
      const res = await resolveStandardSetPreviewConfig({
        projectName: currentProject,
        houseTypeId: target.houseTypeId,
        taskTemplateId: target.taskTemplateId,
        taskName: target.taskName,
        plotId: samplePlotId || undefined,
        garageOrientation: plotObj?.garage_orientation || 'standard',
        standardSet: target.standardSet
      });
      if (reqSeq === previewRequestSeqRef.current) {
        setPreviewResolution(res);
      }
    } finally {
      if (reqSeq === previewRequestSeqRef.current) {
        setPreviewLoading(false);
      }
    }
  };

  const handleOpenPreview = async (target: {
    houseTypeId: string;
    houseTypeName: string;
    taskName: string;
    taskTemplateId: string;
    standardSet: QCStandardSet;
  }) => {
    const candidates = getPreviewCandidatePlots(target.houseTypeId);
    const defaultPlotId = candidates[0]?.id || '';
    setPreviewTarget(target);
    setPreviewPlotId(defaultPlotId);
    setPreviewTab('form');
    setPreviewResolution(null);
    await loadPreviewResolution(target, defaultPlotId);
  };

  const handleClosePreview = () => {
    previewRequestSeqRef.current++;
    setPreviewTarget(null);
    setPreviewResolution(null);
    setPreviewLoading(false);
  };

  return (
    <div className="space-y-6">
      {/* Notice Banner */}
      {statusNotice && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-3 rounded-2xl text-xs font-bold flex items-center justify-between shadow-sm animate-in fade-in">
          <div className="flex items-center gap-2">
            <CheckCircle size={16} className="text-emerald-600 shrink-0" />
            <span>{statusNotice}</span>
          </div>
          <button onClick={() => setStatusNotice(null)} className="text-emerald-600 hover:text-emerald-900">✕</button>
        </div>
      )}

      {/* Header and Filter */}
      <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <Settings className="text-purple-600 shrink-0" size={20} />
              <h3 className="text-base font-bold text-slate-800">
                ชุดตรวจมาตรฐาน QC โครงการ:
              </h3>
              {/* Project Selector Dropdown */}
              <select
                value={currentProject}
                onChange={(e) => {
                  const newProjName = e.target.value;
                  setCurrentProject(newProjName);
                  const projObj = projects.find((p: any) => p.name === newProjName);
                  if (onSelectProject && projObj) {
                    onSelectProject(projObj);
                  }
                }}
                className="bg-purple-50 text-purple-900 border border-purple-200 rounded-xl px-3 py-1 text-xs font-black outline-none cursor-pointer hover:bg-purple-100 transition-colors"
              >
                {projectNamesList.length === 0 ? (
                  <option value="">-- ไม่มีโครงการ --</option>
                ) : (
                  projectNamesList.map(pName => (
                    <option key={pName} value={pName}>{pName}</option>
                  ))
                )}
              </select>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              สร้างฟอร์มตรวจกลางครั้งเดียว แล้วผูกกับงวดงานของแต่ละแบบบ้าน พร้อมอัปโหลดแบบแปลนแยกซ้าย/ขวาหรือผังโครงการ
            </p>
            <div className="flex items-center gap-2 mt-2 text-[11px] font-bold">
              <span className="text-slate-500">รวมทั้งหมด: {totalTasksCount} งวดงาน</span>
              <span className="text-slate-300">•</span>
              <span className="text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                พร้อมใช้งาน {readyTasksCount}
              </span>
              <span className="text-amber-800 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200">
                ยังไม่ครบ {totalTasksCount - readyTasksCount}
              </span>
            </div>
          </div>

          {/* Quick Library & Scope Actions */}
          {canEdit && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setActiveConfigTarget(null);
                  setFormLibraryOpen(true);
                }}
                className="px-3.5 py-2 bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 rounded-xl text-xs font-bold flex items-center gap-1.5 transition"
              >
                <FileText size={14} />
                <span>จัดการคลังฟอร์ม</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveConfigTarget(null);
                  setDrawingLibraryOpen(true);
                }}
                className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 rounded-xl text-xs font-bold flex items-center gap-1.5 transition"
              >
                <MapPin size={14} />
                <span>จัดการคลังแบบแปลน</span>
              </button>
              <button
                type="button"
                onClick={() => setScopeAssignmentOpen(true)}
                disabled={!currentProject}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-md transition disabled:opacity-50"
              >
                <Users size={14} />
                <span>เปิดใช้ฟอร์มกับแปลงบ้าน</span>
              </button>
            </div>
          )}
        </div>

        {/* Filters Row */}
        <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-slate-100">
          {/* หมวดหมู่: ทั้งหมด / บ้าน / สาธารณูปโภค */}
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl text-xs font-bold">
            <button
              type="button"
              onClick={() => {
                setCategoryFilter('all');
                setSelectedHouseType('ทั้งหมด');
              }}
              className={`px-2.5 py-1 rounded-lg transition-all ${
                categoryFilter === 'all'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              ทั้งหมด ({houseTypes.length})
            </button>
            <button
              type="button"
              onClick={() => {
                setCategoryFilter('house');
                setSelectedHouseType('ทั้งหมด');
              }}
              className={`px-2.5 py-1 rounded-lg transition-all ${
                categoryFilter === 'house'
                  ? 'bg-white text-blue-700 shadow-sm'
                  : 'text-slate-500 hover:text-blue-700'
              }`}
            >
              🏠 บ้าน ({houseCount})
            </button>
            <button
              type="button"
              onClick={() => {
                setCategoryFilter('infrastructure');
                setSelectedHouseType('ทั้งหมด');
              }}
              className={`px-2.5 py-1 rounded-lg transition-all ${
                categoryFilter === 'infrastructure'
                  ? 'bg-white text-amber-800 shadow-sm'
                  : 'text-slate-500 hover:text-amber-800'
              }`}
            >
              🏗️ สาธารณูปโภค ({infraCount})
            </button>
          </div>

          {/* House Type Filter Dropdown */}
          <div className="flex items-center gap-1.5 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200">
            <span className="text-[10px] font-bold text-slate-400 uppercase">เลือกแบบ:</span>
            <select
              value={selectedHouseType}
              onChange={(e) => setSelectedHouseType(e.target.value)}
              className="bg-transparent text-xs font-bold text-slate-800 outline-none cursor-pointer"
            >
              <option value="ทั้งหมด">ทั้งหมด ({availableHouseTypes.length})</option>
              {availableHouseTypes.map(ht => (
                <option key={ht.id} value={ht.id}>
                  {ht.is_infrastructure ? '🏗️ ' : '🏠 '} {ht.type_name}
                </option>
              ))}
            </select>
          </div>

          {/* Incomplete toggle */}
          <button
            onClick={() => setFilterIncompleteOnly(!filterIncompleteOnly)}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 border transition-all ${
              filterIncompleteOnly
                ? 'bg-amber-500 text-white border-amber-500 shadow-sm'
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            }`}
          >
            <AlertTriangle size={14} />
            <span>กรองเฉพาะที่ยังไม่ครบ</span>
          </button>
        </div>
      </div>

      {/* Matrix Table */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-900 text-white text-[11px] font-mono uppercase tracking-wider">
                <th className="py-3 px-4">แบบบ้าน / สาธารณูปโภค</th>
                <th className="py-3 px-4">ประเภทงาน (งวดงานจริง)</th>
                <th className="py-3 px-4">ฟอร์มตรวจ (คำถาม)</th>
                <th className="py-3 px-4">แบบอ้างอิง (แปลน)</th>
                <th className="py-3 px-4">เงื่อนไขแบบเฉพาะแปลง</th>
                <th className="py-3 px-4 text-center">ความพร้อม</th>
                {canEdit && <th className="py-3 px-4 text-right">จัดการ</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredHouseTypes.length === 0 ? (
                <tr>
                  <td colSpan={canEdit ? 7 : 6} className="py-12 text-center text-slate-400 font-medium">
                    ไม่พบแบบบ้านหรือสาธารณูปโภคตามเงื่อนไขที่เลือก
                  </td>
                </tr>
              ) : (
                filteredHouseTypes.flatMap(ht => {
                  const tasksForType = taskTemplates
                    .filter(t => t.house_type_id === ht.id)
                    .sort((a, b) => (a.task_order || 0) - (b.task_order || 0));

                  if (tasksForType.length === 0) {
                    if (filterIncompleteOnly) return [];
                    return [
                      <tr key={`empty-${ht.id}`} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-bold text-slate-800">{ht.type_name}</span>
                            {ht.is_infrastructure ? (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                                🏗️ สาธารณูปโภค
                              </span>
                            ) : (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                                🏠 บ้าน
                              </span>
                            )}
                          </div>
                        </td>
                        <td colSpan={canEdit ? 6 : 5} className="py-3 px-4 text-slate-400 italic text-[11px]">
                          ยังไม่มีงวดงานที่กำหนดในระบบสำหรับแบบนี้ (กำหนดประเภทงานได้ที่เมนู &quot;จัดการงวดงาน&quot;)
                        </td>
                      </tr>
                    ];
                  }

                  const seenTaskNames = new Set<string>();
                  const uniqueTasks = tasksForType.filter(t => {
                    if (seenTaskNames.has(t.task_name)) return false;
                    seenTaskNames.add(t.task_name);
                    return true;
                  });

                  return uniqueTasks.map(task => {
                    const taskName = task.task_name;
                    const set = standardSets.find(s => s.house_type_id === ht.id && s.task_name === taskName);
                    const hasForm = Boolean(set?.form_template_id);
                    const drawsInfo = getTaskDrawings(ht.id, task.id, set);
                    const isReady = hasForm && (!set?.require_plot_drawing ? true : drawsInfo.hasAny);

                    if (filterIncompleteOnly && isReady) return null;

                    return (
                      <tr key={`${ht.id}-${taskName}`} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-bold text-slate-800">{ht.type_name}</span>
                            {ht.is_infrastructure ? (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                                🏗️ สาธารณูปโภค
                              </span>
                            ) : (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                                🏠 บ้าน
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-4 font-bold text-purple-900">
                          <div className="flex items-center gap-1.5">
                            {task.task_order !== undefined && task.task_order !== null && (
                              <span className="font-mono text-[10px] text-slate-400 font-semibold">
                                #{task.task_order}
                              </span>
                            )}
                            <span>{taskName}</span>
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          {hasForm && set?.form_template ? (
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono text-[10px] bg-purple-50 text-purple-700 px-2 py-0.5 rounded font-bold">
                                v{set.form_version}
                              </span>
                              <span className="font-bold text-slate-800 truncate max-w-[180px]">
                                {set.form_template.title}
                              </span>
                            </div>
                          ) : (
                            <span className="text-amber-600 font-bold bg-amber-50 px-2 py-0.5 rounded text-[11px]">
                              ยังไม่เลือกฟอร์ม
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          {drawsInfo.hasAny ? (
                            <div className="flex flex-wrap items-center gap-1">
                              {drawsInfo.leftDraw && (
                                <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200" title={drawsInfo.leftDraw.title}>
                                  🚗 ซ้าย: {drawsInfo.leftDraw.drawing_number}
                                </span>
                              )}
                              {drawsInfo.rightDraw && (
                                <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-purple-50 text-purple-700 border border-purple-200" title={drawsInfo.rightDraw.title}>
                                  🚗 ขวา: {drawsInfo.rightDraw.drawing_number}
                                </span>
                              )}
                              {drawsInfo.standardTaskDraw && (
                                <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200" title={drawsInfo.standardTaskDraw.title}>
                                  📐 {drawsInfo.standardTaskDraw.title}
                                </span>
                              )}
                              {drawsInfo.setDraw &&
                                drawsInfo.setDraw.id !== drawsInfo.leftDraw?.id &&
                                drawsInfo.setDraw.id !== drawsInfo.rightDraw?.id &&
                                drawsInfo.setDraw.id !== drawsInfo.standardTaskDraw?.id && (
                                  <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200 truncate max-w-[160px]" title={drawsInfo.setDraw.title}>
                                    {drawsInfo.setDraw.project_name ? '🗺️ ' : '🌐 '}
                                    {drawsInfo.setDraw.title}
                                  </span>
                                )}
                            </div>
                          ) : (
                            <span className="text-slate-400 text-[11px]">ไม่มีแบบมาตรฐาน</span>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          {set ? (
                            <label className="flex items-center gap-1.5 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={set.require_plot_drawing}
                                disabled={!canEdit}
                                onChange={() => handleToggleRequirePlotDrawing(set)}
                                className="rounded text-purple-600"
                              />
                              <span className="text-[11px] font-bold text-slate-700">บังคับแบบเฉพาะแปลง</span>
                            </label>
                          ) : (
                            <span className="text-slate-300">-</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold inline-flex items-center gap-1 ${
                            isReady ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                          }`}>
                            {isReady ? <CheckCircle size={12} /> : <AlertTriangle size={12} />}
                            <span>{isReady ? 'พร้อมใช้งาน' : 'ยังไม่ครบ'}</span>
                          </span>
                        </td>
                        {canEdit && (
                          <td className="py-3 px-4 text-right">
                            <div className="flex items-center justify-end gap-1">
                              {hasForm && set && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleOpenPreview({
                                      houseTypeId: ht.id,
                                      houseTypeName: ht.type_name,
                                      taskName,
                                      taskTemplateId: task.id,
                                      standardSet: set
                                    })
                                  }
                                  className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-lg text-[10px] font-bold flex items-center gap-1 transition"
                                  title="ดูตัวอย่างหน้าฟอร์มและแบบแปลนที่ผูกไว้ (ดูอย่างเดียว)"
                                >
                                  <Eye size={12} />
                                  <span>ดูตัวอย่าง</span>
                                </button>
                              )}
                              <button
                                onClick={() => {
                                  setActiveConfigTarget({
                                    houseTypeId: ht.id,
                                    houseTypeName: ht.type_name,
                                    taskName,
                                    taskTemplateId: task.id,
                                    existingSet: set
                                  });
                                  setFormLibraryOpen(true);
                                }}
                                className="px-2.5 py-1 bg-purple-50 hover:bg-purple-100 text-purple-700 rounded-lg text-[10px] font-bold flex items-center gap-1"
                              >
                                <FileText size={12} />
                                <span>เลือกฟอร์ม</span>
                              </button>
                              <button
                                onClick={() => {
                                  setActiveConfigTarget({
                                    houseTypeId: ht.id,
                                    houseTypeName: ht.type_name,
                                    taskName,
                                    taskTemplateId: task.id,
                                    existingSet: set
                                  });
                                  setDrawingLibraryOpen(true);
                                }}
                                className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-[10px] font-bold flex items-center gap-1"
                              >
                                <MapPin size={12} />
                                <span>เลือกแบบ</span>
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  });
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Form Library Selector Modal */}
      <QCFormLibraryModal
        isOpen={formLibraryOpen}
        onClose={() => setFormLibraryOpen(false)}
        onSelectTemplate={activeConfigTarget ? handleSelectForm : undefined}
        currentUserRole={currentUserRole}
        loggedInUsername={loggedInUsername}
        activeTarget={activeConfigTarget}
      />

      {/* Drawing Library Selector Modal */}
      <QCDrawingLibraryModal
        isOpen={drawingLibraryOpen}
        onClose={() => setDrawingLibraryOpen(false)}
        onSelectDrawing={activeConfigTarget ? handleSelectDrawing : undefined}
        currentUserRole={currentUserRole}
        loggedInUsername={loggedInUsername}
        projectName={currentProject}
        plots={plots}
        houseTypes={houseTypes}
        taskTemplates={taskTemplates}
        projects={projects}
        activeTarget={activeConfigTarget}
        onDrawingsChanged={fetchStandardSets}
      />

      {/* Scope & Bulk Assignment Modal */}
      <QCScopeAssignmentModal
        isOpen={scopeAssignmentOpen}
        onClose={() => setScopeAssignmentOpen(false)}
        selectedProject={currentProject}
        plots={plots}
        houseTypes={houseTypes}
        taskTemplates={taskTemplates}
        currentUserRole={currentUserRole}
        loggedInUsername={loggedInUsername}
        onAssigned={fetchStandardSets}
      />

      {/* Admin View-Only Form & Drawing Preview Modal */}
      {previewTarget && (() => {
        const candidatePlots = getPreviewCandidatePlots(previewTarget.houseTypeId);
        const selectedPlotObj = candidatePlots.find(p => p.id === previewPlotId);

        return (
          <div className="fixed inset-0 z-[1050] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-2 sm:p-5 animate-in fade-in duration-150">
            <div className="w-full max-w-6xl h-[92vh] bg-slate-100 rounded-3xl overflow-hidden shadow-2xl border border-slate-700 flex flex-col">
              {/* Preview Top Bar */}
              <div className="bg-white border-b border-slate-200 px-4 py-3 flex flex-wrap items-center justify-between gap-3 shrink-0">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-xl bg-indigo-600 text-white flex items-center justify-center shrink-0">
                    <Eye size={16} />
                  </div>
                  <div className="min-w-0">
                    <h4 className="font-bold text-slate-800 text-xs sm:text-sm truncate">
                      ตัวอย่างฟอร์มตรวจ QC (Admin ดูอย่างเดียว) — {previewTarget.taskName}
                    </h4>
                    <p className="text-[11px] text-slate-500 truncate">
                      แบบ: {previewTarget.houseTypeName} • โครงการ: {currentProject || '-'}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {candidatePlots.length > 0 && (
                    <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1">
                      <span className="text-[11px] font-bold text-slate-500">จำลองแปลง:</span>
                      <select
                        aria-label="จำลองมุมมองของแปลง"
                        value={previewPlotId}
                        onChange={(e) => {
                          const nextId = e.target.value;
                          setPreviewPlotId(nextId);
                          loadPreviewResolution(previewTarget, nextId);
                        }}
                        className="bg-transparent text-xs font-bold text-slate-800 outline-none cursor-pointer"
                      >
                        {candidatePlots.map(p => {
                          const orientTag =
                            p.garage_orientation === 'left'
                              ? ' (ซ้าย)'
                              : p.garage_orientation === 'right'
                              ? ' (ขวา)'
                              : '';
                          return (
                            <option key={p.id} value={p.id}>
                              แปลง {p.plot_name || p.id}{orientTag}
                            </option>
                          );
                        })}
                      </select>
                      {previewResolution?.viewport && (
                        <span className="text-[10px] font-bold bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">
                          ซูม {Number(previewResolution.viewport.zoom_level).toFixed(1)}x
                        </span>
                      )}
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={handleClosePreview}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition"
                  >
                    <X size={14} />
                    <span>ปิดตัวอย่าง</span>
                  </button>
                </div>
              </div>

              {/* Preview Body */}
              <div className="flex-1 min-h-0 flex flex-col p-2 sm:p-3">
                {previewLoading || !previewResolution ? (
                  <div className="flex-1 bg-white rounded-2xl border border-slate-200 flex flex-col items-center justify-center gap-2 text-slate-500">
                    <Loader2 size={28} className="animate-spin text-purple-600" />
                    <span className="text-xs font-bold">กำลังโหลดตัวอย่างฟอร์มและแบบแปลน...</span>
                  </div>
                ) : (
                  <div className="flex-1 min-h-0 flex flex-col">
                    <QCInspectionRunner
                      key={`${previewTarget.taskTemplateId}-${previewPlotId || 'none'}`}
                      resolution={previewResolution}
                      plotId={previewPlotId}
                      plotLabel={selectedPlotObj?.plot_name || selectedPlotObj?.id || ''}
                      projectName={currentProject}
                      taskTemplateId={previewTarget.taskTemplateId}
                      taskName={previewTarget.taskName}
                      houseTypeId={previewTarget.houseTypeId}
                      loggedInUser={{ username: loggedInUsername, role: currentUserRole }}
                      currentUserRole={currentUserRole}
                      onBack={handleClosePreview}
                      onInspectionUpdated={() => {}}
                      previewOnly={true}
                      initialTab={previewTab}
                      onTabChange={setPreviewTab}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
