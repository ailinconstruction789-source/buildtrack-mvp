// ==============================================================================
// 🎯 BUILDTRACK: QC SMART PLOT ACTIVATION MODAL (เปิดใช้ฟอร์มตรวจกับแปลงบ้าน)
// ==============================================================================

import React, { useState, useEffect, useMemo } from 'react';
import { 
  X, Check, AlertTriangle, CheckCircle2, ShieldAlert, ArrowRight, 
  Layers, Filter, Users, RefreshCw, Loader2, Sparkles, AlertCircle, Eye,
  Building, Search, CheckSquare, Square, Zap, Info
} from 'lucide-react';
import { 
  previewSmartPlotsQC, 
  executeSmartActivatePlotsQC, 
  SmartPlotQCPreview 
} from '@/lib/qc/qcConfigService';
import { supabase } from '@/lib/supabase';

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
  // Project selection
  const availableProjects = useMemo(() => {
    const set = new Set<string>();
    if (selectedProject) set.add(selectedProject);
    for (const p of plots) {
      if (p.project_name) set.add(p.project_name);
    }
    return Array.from(set);
  }, [selectedProject, plots]);

  const [currentProject, setCurrentProject] = useState<string>(selectedProject || availableProjects[0] || '');

  // UI Filters
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [houseTypeFilter, setHouseTypeFilter] = useState<string>('ทั้งหมด');
  const [selectedPlotIds, setSelectedPlotIds] = useState<string[]>([]);
  const [exemptCompletedTasks, setExemptCompletedTasks] = useState<boolean>(true);

  // Data & Loading
  const [plotPreviews, setPlotPreviews] = useState<SmartPlotQCPreview[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [isActivating, setIsActivating] = useState<boolean>(false);
  const [activationResult, setActivationResult] = useState<{
    success: boolean;
    totalPlotsProcessed: number;
    totalExemptedCompletedTasks: number;
    totalActivatedTasks: number;
  } | null>(null);

  // Sync project when props change
  useEffect(() => {
    if (selectedProject && selectedProject !== currentProject) {
      setCurrentProject(selectedProject);
    }
  }, [selectedProject]);

  // Load plot previews for current project
  useEffect(() => {
    if (!isOpen || !currentProject) return;

    let isMounted = true;
    async function loadPreviews() {
      setLoading(true);
      setActivationResult(null);
      try {
        const projectPlots = plots.filter(p => p.project_name === currentProject);
        const plotIds = projectPlots.map(p => p.id);

        if (plotIds.length === 0) {
          if (isMounted) {
            setPlotPreviews([]);
            setSelectedPlotIds([]);
          }
          return;
        }

        const previews = await previewSmartPlotsQC({
          projectName: currentProject,
          plotIds
        });

        if (isMounted) {
          setPlotPreviews(previews);
          // By default, select all plots in the project
          setSelectedPlotIds(previews.map(p => p.plotId));
        }
      } catch (err) {
        console.error('Error loading smart plot previews:', err);
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    loadPreviews();

    return () => {
      isMounted = false;
    };
  }, [isOpen, currentProject, plots]);

  // Filtered Previews
  const filteredPreviews = useMemo(() => {
    return plotPreviews.filter(p => {
      const matchSearch = searchTerm.trim() === '' || 
        p.plotName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.houseTypeName.toLowerCase().includes(searchTerm.toLowerCase());

      const matchHt = houseTypeFilter === 'ทั้งหมด' || p.houseTypeId === houseTypeFilter;

      return matchSearch && matchHt;
    });
  }, [plotPreviews, searchTerm, houseTypeFilter]);

  // Aggregate stats for selected plots
  const selectedStats = useMemo(() => {
    const selectedPreviews = plotPreviews.filter(p => selectedPlotIds.includes(p.plotId));
    const totalPlots = selectedPreviews.length;
    let totalExempted = 0;
    let totalActive = 0;

    for (const p of selectedPreviews) {
      totalExempted += p.completedTasksCount;
      totalActive += p.activeTasksCount;
    }

    return { totalPlots, totalExempted, totalActive };
  }, [plotPreviews, selectedPlotIds]);

  // Selection handlers
  const handleTogglePlot = (plotId: string) => {
    setSelectedPlotIds(prev =>
      prev.includes(plotId) ? prev.filter(id => id !== plotId) : [...prev, plotId]
    );
  };

  const handleSelectAllFiltered = () => {
    const filteredIds = filteredPreviews.map(p => p.plotId);
    setSelectedPlotIds(prev => Array.from(new Set([...prev, ...filteredIds])));
  };

  const handleClearFiltered = () => {
    const filteredIds = new Set(filteredPreviews.map(p => p.plotId));
    setSelectedPlotIds(prev => prev.filter(id => !filteredIds.has(id)));
  };

  // Execution: Smart Activation
  const handleExecuteActivation = async () => {
    if (selectedPlotIds.length === 0) {
      alert('กรุณาเลือกแปลงที่ต้องการเปิดใช้งานอย่างน้อย 1 แปลง');
      return;
    }

    setIsActivating(true);
    try {
      const result = await executeSmartActivatePlotsQC({
        projectName: currentProject,
        selectedPlotIds,
        exemptCompletedTasks,
        actorUsername: loggedInUsername,
        actorRole: currentUserRole
      });

      setActivationResult(result);
    } catch (err: any) {
      console.error('Error executing smart activation:', err);
      alert(err.message || 'เกิดข้อผิดพลาดในการเปิดใช้งานระบบฟอร์ม');
    } finally {
      setIsActivating(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 z-[999] animate-in fade-in">
      <div className="bg-white rounded-3xl max-w-5xl w-full h-[92vh] flex flex-col overflow-hidden shadow-2xl border border-slate-200">
        
        {/* Header */}
        <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="bg-purple-600 p-2.5 rounded-2xl shadow-md">
              <Zap size={22} className="text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-base sm:text-lg">เปิดใช้งานฟอร์มตรวจ QC กับแปลงบ้าน</h3>
                <span className="bg-purple-500/20 text-purple-300 text-[10px] font-bold px-2 py-0.5 rounded-full border border-purple-400/30">
                  Smart Forward QC
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                คำนวณงานที่ผ่านแล้วในอดีตให้อัตโนมัติ (ไม่ต้องตรวจย้อนหลัง) และเปิดใช้ฟอร์มใหม่เฉพาะงานที่รอตรวจ
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content Area */}
        <div className="flex-1 flex flex-col overflow-hidden bg-slate-50">

          {/* Project & Filter Toolbar */}
          <div className="bg-white px-6 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 shrink-0">
            {/* Project Selector */}
            <div className="flex items-center gap-2">
              <label className="text-xs font-bold text-slate-500 flex items-center gap-1">
                <Building size={14} className="text-purple-600" />
                <span>โครงการ:</span>
              </label>
              <select
                value={currentProject}
                onChange={(e) => setCurrentProject(e.target.value)}
                disabled={loading || isActivating}
                className="bg-slate-100 border border-slate-300 rounded-xl px-3 py-1.5 text-xs font-bold text-slate-800 outline-none focus:border-purple-500"
              >
                {availableProjects.map(proj => (
                  <option key={proj} value={proj}>{proj}</option>
                ))}
              </select>
            </div>

            {/* Search & House Type Filter */}
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="ค้นหาชื่อแปลง / แบบบ้าน..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="bg-slate-100 border border-slate-300 rounded-xl pl-8 pr-3 py-1.5 text-xs text-slate-700 outline-none focus:border-purple-500 w-48 sm:w-60"
                />
              </div>

              <select
                value={houseTypeFilter}
                onChange={(e) => setHouseTypeFilter(e.target.value)}
                className="bg-slate-100 border border-slate-300 rounded-xl px-3 py-1.5 text-xs font-bold text-slate-700 outline-none focus:border-purple-500"
              >
                <option value="ทั้งหมด">แบบบ้านทั้งหมด</option>
                {houseTypes.map(ht => (
                  <option key={ht.id} value={ht.id}>{ht.type_name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Active Result View (When completed) */}
          {activationResult ? (
            <div className="flex-1 overflow-y-auto p-6 flex items-center justify-center">
              <div className="max-w-md w-full bg-white rounded-3xl p-6 sm:p-8 border border-slate-200 shadow-xl text-center space-y-5 animate-in zoom-in-95">
                <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto shadow-inner">
                  <CheckCircle2 size={36} />
                </div>
                <div>
                  <h4 className="font-bold text-slate-800 text-xl">เปิดใช้งานระบบฟอร์มตรวจสำเร็จ!</h4>
                  <p className="text-xs text-slate-500 mt-1">
                    ระบบได้ตั้งค่าและคำนวณการตรวจสำหรับโครงการ <span className="font-bold text-slate-700">{currentProject}</span> เรียบร้อยแล้ว
                  </p>
                </div>

                <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200 text-left space-y-2.5 text-xs">
                  <div className="flex justify-between items-center text-slate-700 font-bold">
                    <span>จำนวนแปลงที่อัปเดต:</span>
                    <span className="text-purple-700 font-mono text-sm">{activationResult.totalPlotsProcessed} แปลง</span>
                  </div>
                  <div className="flex justify-between items-center text-slate-600">
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                      งานที่ผ่านแล้ว (ไม่ต้องตรวจย้อนหลัง):
                    </span>
                    <span className="font-bold text-emerald-700 font-mono text-sm">{activationResult.totalExemptedCompletedTasks.toLocaleString()} งาน</span>
                  </div>
                  <div className="flex justify-between items-center text-slate-600">
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-purple-600"></span>
                      งานที่เปิดใช้ฟอร์มตรวจ QC ใหม่:
                    </span>
                    <span className="font-bold text-purple-700 font-mono text-sm">{activationResult.totalActivatedTasks.toLocaleString()} งาน</span>
                  </div>
                </div>

                <button
                  onClick={() => {
                    onAssigned();
                    onClose();
                  }}
                  className="w-full py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-sm font-bold shadow-md transition-all flex items-center justify-center gap-2"
                >
                  <span>เสร็จสิ้น (ไปที่หน้าตรวจงาน)</span>
                  <ArrowRight size={16} />
                </button>
              </div>
            </div>
          ) : (
            /* Main Plot Selection & Calculation View */
            <div className="flex-1 flex flex-col overflow-hidden">
              
              {/* Quick Select Actions */}
              <div className="px-6 py-2.5 bg-slate-100 border-b border-slate-200 flex items-center justify-between text-xs text-slate-600 shrink-0">
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleSelectAllFiltered}
                    className="font-bold text-purple-700 hover:text-purple-800 flex items-center gap-1 hover:underline"
                  >
                    <CheckSquare size={14} />
                    <span>เลือกแปลงทั้งหมดในหน้านี้ ({filteredPreviews.length} แปลง)</span>
                  </button>
                  <span className="text-slate-300">•</span>
                  <button
                    onClick={handleClearFiltered}
                    className="font-bold text-slate-500 hover:text-slate-700 hover:underline"
                  >
                    ล้างการเลือก
                  </button>
                </div>
                <div className="font-bold text-slate-700">
                  เลือกแล้ว: <span className="text-purple-700 font-mono text-sm">{selectedPlotIds.length}</span> จาก {plotPreviews.length} แปลง
                </div>
              </div>

              {/* Plot Cards Grid */}
              <div className="flex-1 overflow-y-auto p-4 sm:p-6">
                {loading ? (
                  <div className="py-20 text-center space-y-3">
                    <Loader2 size={36} className="mx-auto text-purple-600 animate-spin" />
                    <p className="text-sm font-bold text-slate-600">กำลังคำนวณสถานะความคืบหน้ารายแปลง...</p>
                  </div>
                ) : filteredPreviews.length === 0 ? (
                  <div className="py-20 text-center space-y-3 bg-white rounded-2xl border border-dashed border-slate-200">
                    <AlertCircle size={36} className="mx-auto text-slate-300" />
                    <p className="text-sm font-bold text-slate-600">ไม่พบแปลงในโครงการนี้ตามเงื่อนไขที่เลือก</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
                    {filteredPreviews.map(p => {
                      const isSelected = selectedPlotIds.includes(p.plotId);

                      return (
                        <div
                          key={p.plotId}
                          onClick={() => handleTogglePlot(p.plotId)}
                          className={`bg-white rounded-2xl p-4 border transition-all cursor-pointer flex flex-col justify-between select-none shadow-sm ${
                            isSelected 
                              ? 'border-purple-500 ring-2 ring-purple-100 bg-purple-50/20' 
                              : 'border-slate-200 hover:border-slate-300'
                          }`}
                        >
                          <div>
                            {/* Card Top */}
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <div className={`w-5 h-5 rounded-md flex items-center justify-center border transition-colors ${
                                  isSelected ? 'bg-purple-600 border-purple-600 text-white' : 'border-slate-300 bg-white'
                                }`}>
                                  {isSelected && <Check size={12} strokeWidth={3} />}
                                </div>
                                <span className="font-bold text-slate-800 text-base">
                                  {p.plotName}
                                </span>
                              </div>
                              <span className="font-mono text-xs font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                                {p.overallProgress}%
                              </span>
                            </div>

                            <p className="text-xs text-slate-500 font-medium pl-7">
                              แบบบ้าน: <span className="font-bold text-slate-700">{p.houseTypeName}</span>
                            </p>

                            {/* Progress bar */}
                            <div className="w-full bg-slate-100 h-1.5 rounded-full mt-3 overflow-hidden">
                              <div 
                                className="bg-emerald-500 h-full rounded-full transition-all"
                                style={{ width: `${p.overallProgress}%` }}
                              />
                            </div>
                          </div>

                          {/* Task Breakdown Badges */}
                          <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between gap-1 text-[11px] font-bold">
                            <span className="bg-emerald-50 text-emerald-700 px-2 py-1 rounded-lg border border-emerald-100 flex items-center gap-1" title="งานที่เคยผ่านไปแล้ว จะไม่ต้องตรวจย้อนหลัง">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                              ผ่านแล้ว {p.completedTasksCount} งาน
                            </span>
                            <span className="bg-purple-50 text-purple-700 px-2 py-1 rounded-lg border border-purple-100 flex items-center gap-1" title="งานที่ต้องใช้แบบฟอร์มตรวจ QC ใหม่">
                              <span className="w-1.5 h-1.5 rounded-full bg-purple-600"></span>
                              รอตรวจใหม่ {p.activeTasksCount} งาน
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Bottom Action Bar */}
              <div className="bg-white px-6 py-4 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shrink-0 shadow-lg">
                <div className="space-y-1">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={exemptCompletedTasks}
                      onChange={(e) => setExemptCompletedTasks(e.target.checked)}
                      className="rounded text-purple-600 w-4 h-4"
                    />
                    <span className="text-xs font-bold text-slate-800">
                      คำนวณข้ามงานที่ผ่านแล้วในอดีตอัตโนมัติ (แนะนำ — ไม่ต้องตรวจย้อนหลัง)
                    </span>
                  </label>
                  <p className="text-[11px] text-slate-400 pl-6">
                    {selectedStats.totalPlots > 0 ? (
                      <>
                        เลือกไว้ <span className="font-bold text-slate-700">{selectedStats.totalPlots} แปลง</span> • ข้ามงานเก่า <span className="font-bold text-emerald-600">{selectedStats.totalExempted.toLocaleString()} งาน</span> • เปิดฟอร์มใหม่ <span className="font-bold text-purple-700">{selectedStats.totalActive.toLocaleString()} งาน</span>
                      </>
                    ) : (
                      'กรุณาเลือกแปลงที่ต้องการเปิดใช้งานระบบ'
                    )}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={onClose}
                    disabled={isActivating}
                    className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-xl text-xs font-bold"
                  >
                    ยกเลิก
                  </button>
                  <button
                    type="button"
                    onClick={handleExecuteActivation}
                    disabled={selectedPlotIds.length === 0 || isActivating}
                    className="px-5 py-2.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold shadow-md transition-all flex items-center gap-2"
                  >
                    {isActivating ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        <span>กำลังประมวลผล...</span>
                      </>
                    ) : (
                      <>
                        <Zap size={16} />
                        <span>เปิดใช้งานฟอร์มตรวจ QC ({selectedPlotIds.length} แปลง)</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
