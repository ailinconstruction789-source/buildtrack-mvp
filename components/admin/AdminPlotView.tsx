// ==============================================================================
// 🏡 BUILDTRACK: ADMIN PLOT VIEW (ระบบจัดการและเพิ่มแปลงบ้าน / สาธารณูปโภค)
// ==============================================================================

import React, { useState, useMemo } from 'react';
import { 
  MapIcon, Download, Upload, X, Plus, Loader2, AlertTriangle, 
  Search, Edit3, Trash2, Check, Filter, Layers, Zap, CheckCircle2, 
  Building, ChevronRight, AlertCircle, CheckSquare, Square, Save, RotateCw 
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { backfillUnassignedSnapshotsForPlot, isUnassignedForemanName } from '@/lib/handoverForeman';

interface AdminPlotViewProps {
  setView: (view: string) => void;
  setSelectedProject: (project: any) => void;
  selectedProject: any;
  projects?: any[];
  plots?: any[];
  batchPlots: any[];
  setBatchPlots: (plots: any[]) => void;
  houseTypes: any[];
  foremenList: any[];
  isSubmitting: boolean;
  handleDownloadTemplate: () => void;
  handleImportExcel: (e: any) => void;
  handleAddPlot: () => void;
  onUpdatePlot?: (plotId: string, updates: { house_type_id: string; foreman_name?: string; garage_orientation?: string }) => Promise<void>;
  onBulkAddPlots?: (newPlots: any[]) => Promise<void>;
  fetchAllData?: () => Promise<void>;
}

export default function AdminPlotView({
  setView,
  setSelectedProject,
  selectedProject,
  projects = [],
  plots = [],
  batchPlots,
  setBatchPlots,
  houseTypes = [],
  foremenList = [],
  isSubmitting,
  handleDownloadTemplate,
  handleImportExcel,
  handleAddPlot,
  onUpdatePlot,
  onBulkAddPlots,
  fetchAllData
}: AdminPlotViewProps) {
  // Filters & Search
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'left' | 'right' | 'infrastructure'>('all');

  // Multi-select checkboxes state
  const [selectedPlotIds, setSelectedPlotIds] = useState<Set<string>>(new Set());

  // Modals
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [showAddSingleModal, setShowAddSingleModal] = useState(false);
  const [showBulkEditModal, setShowBulkEditModal] = useState(false);
  const [editingPlot, setEditingPlot] = useState<any | null>(null);

  // Bulk Edit House Type & Orientation State
  const [bulkEditTargetHouseType, setBulkEditTargetHouseType] = useState<string>('KEEP_EXISTING');
  const [bulkPlotConfigs, setBulkPlotConfigs] = useState<Record<string, { house_type_id: string; garage_orientation: 'left' | 'right' | 'standard' }>>({});

  // Single Edit plot state
  const [editHouseTypeId, setEditHouseTypeId] = useState('');
  const [editForemanName, setEditForemanName] = useState('');
  const [editGarageOrientation, setEditGarageOrientation] = useState<'left' | 'right' | 'standard'>('standard');
  const [editWarningConfirmed, setEditWarningConfirmed] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);

  // Bulk Create State
  const [bulkPrefix, setBulkPrefix] = useState('A-');
  const [bulkStartNum, setBulkStartNum] = useState<number>(1);
  const [bulkEndNum, setBulkEndNum] = useState<number>(20);
  const [bulkPadZeros, setBulkPadZeros] = useState(true);
  const [bulkHouseTypeId, setBulkHouseTypeId] = useState('');
  const [bulkForemanName, setBulkForemanName] = useState('');
  const [bulkOrientationPattern, setBulkOrientationPattern] = useState<'standard' | 'left' | 'right' | 'alternate'>('alternate');

  // Single Add State
  const [singlePlotName, setSinglePlotName] = useState('');
  const [singleHouseTypeId, setSingleHouseTypeId] = useState('');
  const [singleForemanName, setSingleForemanName] = useState('');
  const [singleGarageOrientation, setSingleGarageOrientation] = useState<'left' | 'right' | 'standard'>('standard');

  // Get current project's plots
  const currentProjectName = selectedProject?.name || '';
  const currentPlots = useMemo(() => {
    if (!currentProjectName) return [];
    return plots.filter(p => p.project_name === currentProjectName);
  }, [plots, currentProjectName]);

  // House types map for quick lookup
  const houseTypeMap = useMemo(() => {
    const map = new Map<string, any>();
    houseTypes.forEach(ht => map.set(ht.id, ht));
    return map;
  }, [houseTypes]);

  // Selected house type for single editing
  const selectedEditHouseType = houseTypeMap.get(editHouseTypeId);
  const isEditInfrastructure = Boolean(selectedEditHouseType?.is_infrastructure);

  // Filtered plots in table
  const filteredPlots = useMemo(() => {
    return currentPlots.filter(p => {
      // Search
      const searchMatch = !searchTerm.trim() || 
        (p.plot_name || p.id).toLowerCase().includes(searchTerm.toLowerCase().trim());
      if (!searchMatch) return false;

      // Category filter
      const ht = houseTypeMap.get(p.house_type_id);
      if (categoryFilter === 'infrastructure') {
        return Boolean(ht?.is_infrastructure);
      }
      if (categoryFilter === 'left') {
        return p.garage_orientation === 'left' && !ht?.is_infrastructure;
      }
      if (categoryFilter === 'right') {
        return p.garage_orientation === 'right' && !ht?.is_infrastructure;
      }
      return true;
    });
  }, [currentPlots, searchTerm, categoryFilter, houseTypeMap]);

  // Counts
  const leftCount = currentPlots.filter(p => p.garage_orientation === 'left').length;
  const rightCount = currentPlots.filter(p => p.garage_orientation === 'right').length;
  const infraCount = currentPlots.filter(p => Boolean(houseTypeMap.get(p.house_type_id)?.is_infrastructure)).length;

  // Toggle single plot selection
  const handleToggleSelectPlot = (id: string) => {
    setSelectedPlotIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Toggle select all visible filtered plots
  const handleToggleSelectAll = () => {
    if (selectedPlotIds.size === filteredPlots.length && filteredPlots.length > 0) {
      setSelectedPlotIds(new Set());
    } else {
      setSelectedPlotIds(new Set(filteredPlots.map(p => p.id)));
    }
  };

  // Open Bulk Edit House Type & Orientation Modal
  const handleOpenBulkEditModal = () => {
    if (selectedPlotIds.size === 0) return;
    const initialConfig: Record<string, { house_type_id: string; garage_orientation: 'left' | 'right' | 'standard' }> = {};
    selectedPlotIds.forEach(id => {
      const p = currentPlots.find(plot => plot.id === id);
      if (p) {
        initialConfig[id] = {
          house_type_id: p.house_type_id || '',
          garage_orientation: p.garage_orientation === 'left' || p.garage_orientation === 'right' ? p.garage_orientation : 'standard'
        };
      }
    });
    setBulkPlotConfigs(initialConfig);
    setBulkEditTargetHouseType('KEEP_EXISTING');
    setShowBulkEditModal(true);
  };

  // Bulk Shortcuts inside modal
  const handleSetAllBulkOrientation = (orientation: 'left' | 'right' | 'standard') => {
    setBulkPlotConfigs(prev => {
      const next = { ...prev };
      Object.keys(next).forEach(id => {
        next[id] = { ...next[id], garage_orientation: orientation };
      });
      return next;
    });
  };

  const handleAlternateBulkOrientation = () => {
    setBulkPlotConfigs(prev => {
      const next = { ...prev };
      Object.keys(next).forEach((id, index) => {
        const plot = currentPlots.find(p => p.id === id);
        const numMatch = (plot?.plot_name || id).match(/\d+/);
        const plotNum = numMatch ? parseInt(numMatch[0]) : index + 1;
        const orientation = plotNum % 2 === 1 ? 'left' : 'right';
        next[id] = { ...next[id], garage_orientation: orientation };
      });
      return next;
    });
  };

  // Save Bulk Changes to Supabase
  const handleSaveBulkChanges = async () => {
    if (selectedPlotIds.size === 0) return;
    setIsUpdating(true);
    try {
      const targetHouseTypeObj = bulkEditTargetHouseType !== 'KEEP_EXISTING' ? houseTypeMap.get(bulkEditTargetHouseType) : null;
      const isTargetInfra = Boolean(targetHouseTypeObj?.is_infrastructure);

      const updatePromises = Array.from(selectedPlotIds).map(async (id) => {
        const currentPlot = currentPlots.find(p => p.id === id);
        if (!currentPlot) return;

        const config = bulkPlotConfigs[id];
        const finalHouseTypeId = bulkEditTargetHouseType === 'KEEP_EXISTING' 
          ? (config?.house_type_id || currentPlot.house_type_id)
          : bulkEditTargetHouseType;

        const finalIsInfra = Boolean(houseTypeMap.get(finalHouseTypeId)?.is_infrastructure);
        const finalOrientation = finalIsInfra ? 'standard' : (config?.garage_orientation || 'standard');

        const payload: any = {
          house_type_id: finalHouseTypeId,
          garage_orientation: finalOrientation
        };

        let { error } = await supabase
          .from('plots')
          .update(payload)
          .eq('id', id);

        if (error && error.code === '42703') {
          delete payload.garage_orientation;
          await supabase.from('plots').update(payload).eq('id', id);
        }
      });

      await Promise.all(updatePromises);

      if (fetchAllData) await fetchAllData();
      setShowBulkEditModal(false);
      const count = selectedPlotIds.size;
      setSelectedPlotIds(new Set());
      alert(`บันทึกการเปลี่ยนแปลง ${count} แปลงเรียบร้อยแล้ว`);
    } catch (err: any) {
      alert(err.message || 'บันทึกการเปลี่ยนแปลงไม่สำเร็จ');
    } finally {
      setIsUpdating(false);
    }
  };

  // Open Single Edit Modal
  const handleOpenEdit = (plot: any) => {
    setEditingPlot(plot);
    setEditHouseTypeId(plot.house_type_id || '');
    setEditForemanName(plot.foreman_name || '');
    setEditGarageOrientation(plot.garage_orientation === 'left' || plot.garage_orientation === 'right' ? plot.garage_orientation : 'standard');
    setEditWarningConfirmed(false);
  };

  // Submit Single Edit Plot
  const handleSavePlotEdit = async () => {
    if (!editingPlot) return;
    if (!editHouseTypeId) {
      alert('กรุณาเลือกแบบบ้านหรือสาธารณูปโภคครับ');
      return;
    }

    setIsUpdating(true);
    try {
      const payload: any = {
        house_type_id: editHouseTypeId,
        foreman_name: editForemanName || null,
        garage_orientation: isEditInfrastructure ? 'standard' : editGarageOrientation
      };

      let { error } = await supabase
        .from('plots')
        .update(payload)
        .eq('id', editingPlot.id);

      if (error && error.code === '42703') {
        delete payload.garage_orientation;
        const res = await supabase.from('plots').update(payload).eq('id', editingPlot.id);
        error = res.error;
      }

      if (error) throw error;

      if (editForemanName && !isUnassignedForemanName(editForemanName)) {
        await backfillUnassignedSnapshotsForPlot(supabase, editingPlot.id, editForemanName);
      }

      if (fetchAllData) await fetchAllData();
      setEditingPlot(null);
    } catch (err: any) {
      alert(err.message || 'บันทึกการแก้ไขไม่สำเร็จ');
    } finally {
      setIsUpdating(false);
    }
  };

  // Generate Preview List for Bulk Create
  const generatedBulkList = useMemo(() => {
    const list: any[] = [];
    const start = Math.min(bulkStartNum, bulkEndNum);
    const end = Math.max(bulkStartNum, bulkEndNum);

    for (let i = start; i <= end; i++) {
      const numStr = bulkPadZeros ? String(i).padStart(2, '0') : String(i);
      const plotName = `${bulkPrefix}${numStr}`;

      let orientation: 'left' | 'right' | 'standard' = 'standard';
      if (bulkOrientationPattern === 'left') orientation = 'left';
      else if (bulkOrientationPattern === 'right') orientation = 'right';
      else if (bulkOrientationPattern === 'alternate') {
        orientation = i % 2 === 1 ? 'left' : 'right'; // แปลงคี่จอดซ้าย แปลงคู่จอดขวา
      }

      list.push({
        plot_name: plotName,
        house_type_id: bulkHouseTypeId,
        foreman_name: bulkForemanName,
        garage_orientation: orientation
      });
    }
    return list;
  }, [bulkPrefix, bulkStartNum, bulkEndNum, bulkPadZeros, bulkHouseTypeId, bulkForemanName, bulkOrientationPattern]);

  // Submit Bulk Create
  const handleConfirmBulkCreate = async () => {
    if (!selectedProject?.name) {
      alert('กรุณาเลือกโครงการก่อนครับ');
      return;
    }
    if (!bulkHouseTypeId) {
      alert('กรุณาเลือกแบบบ้านเริ่มต้นสำหรับแปลงที่จะสร้างครับ');
      return;
    }
    if (generatedBulkList.length === 0) return;

    setIsUpdating(true);
    try {
      const isSelectedInfra = Boolean(houseTypeMap.get(bulkHouseTypeId)?.is_infrastructure);

      const plotsToInsert = generatedBulkList.map(p => ({
        id: `${selectedProject.name}-${p.plot_name}`,
        plot_name: p.plot_name,
        house_type_id: p.house_type_id,
        foreman_name: p.foreman_name || null,
        garage_orientation: isSelectedInfra ? 'standard' : p.garage_orientation,
        project_name: selectedProject.name
      }));

      let { error } = await supabase.from('plots').insert(plotsToInsert);

      if (error && error.code === '42703') {
        const cleanPlots = plotsToInsert.map(({ garage_orientation, ...rest }) => rest);
        const res = await supabase.from('plots').insert(cleanPlots);
        error = res.error;
      }

      if (error) throw error;

      if (fetchAllData) await fetchAllData();
      setShowBulkModal(false);
      alert(`เพิ่มแปลงสำเร็จ ${plotsToInsert.length} แปลงเข้าสู่โครงการ ${selectedProject.name}`);
    } catch (err: any) {
      alert(err.message || 'สร้างแปลงเป็นชุดไม่สำเร็จ');
    } finally {
      setIsUpdating(false);
    }
  };

  // Submit Single Plot
  const handleSaveSinglePlot = async () => {
    if (!selectedProject?.name) {
      alert('กรุณาเลือกโครงการก่อนครับ');
      return;
    }
    if (!singlePlotName.trim() || !singleHouseTypeId) {
      alert('กรุณาระบุรหัสแปลงและเลือกแบบบ้านครับ');
      return;
    }

    setIsUpdating(true);
    try {
      const cleanName = singlePlotName.trim().toUpperCase();
      const isSelectedInfra = Boolean(houseTypeMap.get(singleHouseTypeId)?.is_infrastructure);

      const payload: any = {
        id: `${selectedProject.name}-${cleanName}`,
        plot_name: cleanName,
        house_type_id: singleHouseTypeId,
        foreman_name: singleForemanName || null,
        garage_orientation: isSelectedInfra ? 'standard' : singleGarageOrientation,
        project_name: selectedProject.name
      };

      let { error } = await supabase.from('plots').insert([payload]);

      if (error && error.code === '42703') {
        delete payload.garage_orientation;
        const res = await supabase.from('plots').insert([payload]);
        error = res.error;
      }

      if (error) throw error;

      if (fetchAllData) await fetchAllData();
      setShowAddSingleModal(false);
      setSinglePlotName('');
    } catch (err: any) {
      alert(err.message || 'เพิ่มแปลงไม่สำเร็จ');
    } finally {
      setIsUpdating(false);
    }
  };

  // Selected plots objects for bulk edit
  const selectedPlotsList = useMemo(() => {
    return currentPlots.filter(p => selectedPlotIds.has(p.id));
  }, [currentPlots, selectedPlotIds]);

  return (
    <div className="animate-in slide-in-from-bottom duration-300 max-w-6xl mx-auto mt-4 sm:mt-8 px-4 sm:px-0 space-y-6">
      {/* Back button */}
      <button 
        onClick={() => setView(selectedProject ? 'project-detail' : 'dashboard')} 
        className="text-xs sm:text-base font-bold text-blue-600 flex items-center gap-1.5"
      >
        ← BACK TO DASHBOARD
      </button>

      {/* Main Container */}
      <div className="bg-white p-6 sm:p-8 rounded-3xl border border-slate-200 shadow-xl space-y-6">
        {/* Header & Project Selector */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-100 pb-6">
          <div>
            <h2 className="text-xl sm:text-2xl font-black text-slate-800 uppercase italic tracking-tight flex items-center gap-2">
              <MapIcon className="text-rose-600" /> จัดการแปลงบ้านและผังโครงการ
            </h2>
            <p className="text-xs text-slate-500 font-medium mt-1">
              กำหนดแบบบ้าน, ระบุตำแหน่งโรงจอดรถซ้าย/ขวา, และจัดการรายชื่อแปลงในโครงการ
            </p>
          </div>

          {/* Project Selector Dropdown */}
          <div className="flex items-center gap-2 bg-slate-50 p-2 rounded-2xl border border-slate-200">
            <Building size={16} className="text-purple-600 ml-2" />
            <span className="text-xs font-bold text-slate-500">เลือกโครงการ:</span>
            <select
              value={selectedProject?.name || ''}
              onChange={(e) => {
                const found = projects.find(p => p.name === e.target.value);
                if (found) setSelectedProject(found);
                setSelectedPlotIds(new Set());
              }}
              className="px-3 py-1.5 bg-white border border-slate-200 rounded-xl font-black text-xs text-slate-800 outline-none focus:border-purple-600 cursor-pointer min-w-[180px]"
            >
              <option value="" disabled>-- เลือกโครงการ --</option>
              {projects.map(p => (
                <option key={p.name} value={p.name}>{p.name}</option>
              ))}
            </select>
          </div>
        </div>

        {selectedProject ? (
          <>
            {/* Quick Stats Bar */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200/80">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">แปลงทั้งหมด</span>
                <span className="text-xl font-black text-slate-800">{currentPlots.length} แปลง</span>
              </div>
              <div className="bg-blue-50/60 p-3.5 rounded-2xl border border-blue-200/60">
                <span className="text-[10px] font-bold text-blue-600 uppercase tracking-wider block">🚗 โรงจอดรถซ้าย</span>
                <span className="text-xl font-black text-blue-700">{leftCount} แปลง</span>
              </div>
              <div className="bg-purple-50/60 p-3.5 rounded-2xl border border-purple-200/60">
                <span className="text-[10px] font-bold text-purple-600 uppercase tracking-wider block">🚗 โรงจอดรถขวา</span>
                <span className="text-xl font-black text-purple-700">{rightCount} แปลง</span>
              </div>
              <div className="bg-amber-50/60 p-3.5 rounded-2xl border border-amber-200/60">
                <span className="text-[10px] font-bold text-amber-700 uppercase tracking-wider block">🏗️ สาธารณูปโภค</span>
                <span className="text-xl font-black text-amber-800">{infraCount} รายการ</span>
              </div>
            </div>

            {/* Actions & Filters Bar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
              {/* Category Filter Pills */}
              <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl text-xs font-bold">
                <button
                  type="button"
                  onClick={() => setCategoryFilter('all')}
                  className={`px-3 py-1.5 rounded-lg transition-all ${
                    categoryFilter === 'all'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  ทั้งหมด ({currentPlots.length})
                </button>
                <button
                  type="button"
                  onClick={() => setCategoryFilter('left')}
                  className={`px-3 py-1.5 rounded-lg transition-all ${
                    categoryFilter === 'left'
                      ? 'bg-white text-blue-700 shadow-sm'
                      : 'text-slate-500 hover:text-blue-700'
                  }`}
                >
                  🚗 โรงรถซ้าย ({leftCount})
                </button>
                <button
                  type="button"
                  onClick={() => setCategoryFilter('right')}
                  className={`px-3 py-1.5 rounded-lg transition-all ${
                    categoryFilter === 'right'
                      ? 'bg-white text-purple-700 shadow-sm'
                      : 'text-slate-500 hover:text-purple-700'
                  }`}
                >
                  🚗 โรงรถขวา ({rightCount})
                </button>
                <button
                  type="button"
                  onClick={() => setCategoryFilter('infrastructure')}
                  className={`px-3 py-1.5 rounded-lg transition-all ${
                    categoryFilter === 'infrastructure'
                      ? 'bg-white text-amber-800 shadow-sm'
                      : 'text-slate-500 hover:text-amber-800'
                  }`}
                >
                  🏗️ สาธารณูปโภค ({infraCount})
                </button>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => {
                    setBulkHouseTypeId(houseTypes[0]?.id || '');
                    setBulkForemanName('');
                    setShowBulkModal(true);
                  }}
                  className="px-3.5 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-black text-xs shadow-md shadow-purple-500/20 flex items-center gap-1.5 transition"
                >
                  <Zap size={14} />
                  <span>สร้างแปลงเป็นชุด</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setSingleHouseTypeId(houseTypes[0]?.id || '');
                    setSingleForemanName('');
                    setSinglePlotName('');
                    setShowAddSingleModal(true);
                  }}
                  className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-black text-xs shadow-md flex items-center gap-1.5 transition"
                >
                  <Plus size={14} />
                  <span>เพิ่มแปลงเดี่ยว</span>
                </button>

                {/* Excel Import / Export */}
                <div className="flex items-center gap-1.5 pl-2 border-l border-slate-200">
                  <button
                    type="button"
                    onClick={handleDownloadTemplate}
                    className="p-2 rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-100 transition"
                    title="ดาวน์โหลดเทมเพลต Excel"
                  >
                    <Download size={15} />
                  </button>
                  <label 
                    className="p-2 rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-100 transition cursor-pointer"
                    title="นำเข้าจากไฟล์ Excel"
                  >
                    <Upload size={15} />
                    <input type="file" accept=".xlsx, .xls" onChange={handleImportExcel} className="hidden" />
                  </label>
                </div>
              </div>
            </div>

            {/* 🌟 Multi-Select Action Bar (แถบเครื่องมือเมื่อมีการติ๊กเลือกแปลง) 🌟 */}
            {selectedPlotIds.size > 0 && (
              <div className="bg-purple-50 border-2 border-purple-300 rounded-2xl p-3.5 flex flex-wrap items-center justify-between gap-3 animate-in fade-in slide-in-from-top-2 shadow-sm">
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-xl bg-purple-600 text-white text-xs font-black flex items-center justify-center shadow">
                    {selectedPlotIds.size}
                  </div>
                  <div>
                    <span className="text-xs font-black text-purple-900 block">
                      เลือกอยู่ {selectedPlotIds.size} แปลง จาก {filteredPlots.length} แปลง
                    </span>
                    <span className="text-[11px] text-purple-700">
                      คลิกปุ่มด้านขวาเพื่อเปิดหน้าต่างเปลี่ยนแบบบ้านและกำหนดโรงจอดรถพร้อมกัน
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleOpenBulkEditModal}
                    className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-black shadow-md shadow-purple-500/20 flex items-center gap-1.5 transition"
                  >
                    <Building size={15} />
                    <span>🏠 เปลี่ยนแบบบ้านและโรงจอดรถพร้อมกัน ({selectedPlotIds.size} แปลง)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedPlotIds(new Set())}
                    className="px-3 py-2 bg-white text-slate-600 hover:bg-slate-100 border border-slate-200 rounded-xl text-xs font-bold transition"
                  >
                    ยกเลิกการเลือก
                  </button>
                </div>
              </div>
            )}

            {/* Search Input */}
            <div className="relative">
              <Search className="absolute left-3.5 top-3 text-slate-400" size={16} />
              <input
                type="text"
                placeholder="ค้นหารหัสแปลง เช่น A-01, B-12..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-4 py-2.5 font-bold text-xs text-slate-800 outline-none focus:border-purple-600"
              />
            </div>

            {/* Existing Plots Table */}
            <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
              <div className="overflow-x-auto max-h-[500px]">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-900 text-white text-[11px] font-mono uppercase tracking-wider sticky top-0 z-10">
                      <th className="py-3 px-3 w-10 text-center">
                        <input
                          type="checkbox"
                          checked={filteredPlots.length > 0 && selectedPlotIds.size === filteredPlots.length}
                          onChange={handleToggleSelectAll}
                          className="rounded text-purple-600 cursor-pointer w-4 h-4"
                          title="เลือกทั้งหมด"
                        />
                      </th>
                      <th className="py-3 px-3 w-12">#</th>
                      <th className="py-3 px-4">รหัสแปลง</th>
                      <th className="py-3 px-4">แบบบ้าน / หมวดหมู่</th>
                      <th className="py-3 px-4">ทิศทางโรงจอดรถ</th>
                      <th className="py-3 px-4">โฟร์แมน</th>
                      <th className="py-3 px-4 text-right">การจัดการ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {filteredPlots.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-12 text-center text-slate-400 font-medium">
                          {currentPlots.length === 0 
                            ? 'ยังไม่มีแปลงบ้านในโครงการนี้ กดปุ่ม "สร้างแปลงเป็นชุด" หรือ "เพิ่มแปลงเดี่ยว" เพื่อเริ่มต้น' 
                            : 'ไม่พบแปลงบ้านตามเงื่อนไขที่ค้นหา'}
                        </td>
                      </tr>
                    ) : (
                      filteredPlots.map((plot, idx) => {
                        const ht = houseTypeMap.get(plot.house_type_id);
                        const isInfra = Boolean(ht?.is_infrastructure);
                        const isSelected = selectedPlotIds.has(plot.id);

                        return (
                          <tr 
                            key={plot.id} 
                            className={`transition-colors ${isSelected ? 'bg-purple-50/70' : 'hover:bg-slate-50/80'}`}
                          >
                            <td className="py-3 px-3 text-center">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => handleToggleSelectPlot(plot.id)}
                                className="rounded text-purple-600 cursor-pointer w-4 h-4"
                              />
                            </td>
                            <td className="py-3 px-3 font-mono text-slate-400 text-[11px]">{idx + 1}</td>
                            <td className="py-3 px-4 font-black text-slate-900 text-sm">
                              {plot.plot_name || plot.id}
                            </td>
                            <td className="py-3 px-4">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-bold text-slate-800">{ht?.type_name || 'ยังไม่ระบุแบบ'}</span>
                                {isInfra ? (
                                  <span className="px-2 py-0.5 rounded-md bg-amber-100 text-amber-800 border border-amber-200 text-[10px] font-black">
                                    🏗️ สาธารณูปโภค
                                  </span>
                                ) : ht?.floor_count ? (
                                  <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-[10px] font-bold">
                                    {ht.floor_count} ชั้น
                                  </span>
                                ) : null}
                              </div>
                            </td>
                            <td className="py-3 px-4">
                              {isInfra ? (
                                <span className="text-slate-400 text-[11px]">-</span>
                              ) : plot.garage_orientation === 'left' ? (
                                <span className="px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200 text-[10px] font-black inline-flex items-center gap-1">
                                  <span>🚗 โรงจอดรถซ้าย</span>
                                </span>
                              ) : plot.garage_orientation === 'right' ? (
                                <span className="px-2.5 py-1 rounded-full bg-purple-50 text-purple-700 border border-purple-200 text-[10px] font-black inline-flex items-center gap-1">
                                  <span>🚗 โรงจอดรถขวา</span>
                                </span>
                              ) : (
                                <span className="text-slate-400 text-[11px]">มาตรฐาน / ไม่ระบุ</span>
                              )}
                            </td>
                            <td className="py-3 px-4 font-medium text-slate-600">
                              {plot.foreman_name || <span className="text-slate-300">-</span>}
                            </td>
                            <td className="py-3 px-4 text-right">
                              <button
                                type="button"
                                onClick={() => handleOpenEdit(plot)}
                                className="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-bold transition-all shadow-sm"
                              >
                                แก้ไข
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        ) : (
          <div className="text-center py-12">
            <Building className="mx-auto text-purple-400 mb-3" size={48} />
            <h3 className="text-base font-bold text-slate-800">กรุณาเลือกโครงการด้านบน</h3>
            <p className="text-xs text-slate-400 mt-1">เลือกโครงการเพื่อดูรายการแปลงบ้านและเริ่มต้นจัดการผังแปลง</p>
          </div>
        )}
      </div>

      {/* 🌟 MODAL: BATCH EDIT HOUSE TYPE & GARAGE ORIENTATION (เปลี่ยนแบบบ้านและเลือกโรงจอดรถซ้าย/ขวาพร้อมกัน) 🌟 */}
      {showBulkEditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/75 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-3xl max-w-3xl w-full max-h-[92vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden">
            {/* Header */}
            <div className="p-5 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-purple-600 text-white flex items-center justify-center shadow-md shadow-purple-500/20">
                  <Building size={20} />
                </div>
                <div>
                  <h3 className="font-black text-slate-800 text-base sm:text-lg">
                    จัดการแบบบ้านและโรงจอดรถพร้อมกัน ({selectedPlotsList.length} แปลง)
                  </h3>
                  <p className="text-xs text-slate-500 font-medium">
                    โครงการ: {selectedProject?.name} • กำหนดแบบบ้านและเลือกทิศทางโรงจอดรถซ้าย/ขวาในหน้านี้ แล้วกดบันทึกพร้อมกัน
                  </p>
                </div>
              </div>
              <button 
                onClick={() => setShowBulkEditModal(false)}
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-200/60"
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 sm:p-6 space-y-5 overflow-y-auto flex-1">
              {/* ส่วนที่ 1: เปลี่ยนแบบบ้านพร้อมกัน */}
              <div className="bg-purple-50/70 p-4 rounded-2xl border border-purple-200 space-y-2">
                <label className="block text-xs font-black text-purple-900 uppercase tracking-wider">
                  🏠 เปลี่ยนแบบบ้านสำหรับ {selectedPlotsList.length} แปลงที่เลือก
                </label>
                <select
                  value={bulkEditTargetHouseType}
                  onChange={(e) => setBulkEditTargetHouseType(e.target.value)}
                  className="w-full bg-white border border-purple-300 rounded-xl px-3 py-2.5 font-bold text-xs text-slate-800 outline-none focus:border-purple-600 shadow-sm cursor-pointer"
                >
                  <option value="KEEP_EXISTING">-- คงแบบบ้านเดิมของแต่ละแปลงไว้ (ไม่เปลี่ยนแบบบ้าน) --</option>
                  {houseTypes.map(ht => (
                    <option key={ht.id} value={ht.id}>
                      เปลี่ยนเป็น: {ht.is_infrastructure ? '🏗️ ' : '🏠 '} {ht.type_name} {ht.floor_count ? `(${ht.floor_count} ชั้น)` : ''}
                    </option>
                  ))}
                </select>
                {bulkEditTargetHouseType !== 'KEEP_EXISTING' && houseTypeMap.get(bulkEditTargetHouseType)?.is_infrastructure && (
                  <p className="text-[11px] font-bold text-amber-700">
                    💡 แบบที่เลือกเป็นงานสาธารณูปโภค ระบบจะตั้งค่าโรงจอดรถเป็น &quot;มาตรฐาน/ไม่ระบุ&quot; ให้โดยอัตโนมัติ
                  </p>
                )}
              </div>

              {/* ส่วนที่ 2: แถบปุ่มลัดตั้งค่าโรงจอดรถด่วนทุกแปลง */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-black text-slate-700 uppercase tracking-wider">
                    ⚡ ปุ่มลัดกำหนดทิศทางโรงจอดรถทุกแปลงในคลิกเดียว:
                  </label>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <button
                    type="button"
                    onClick={() => handleSetAllBulkOrientation('left')}
                    className="p-2.5 rounded-xl border border-blue-200 bg-blue-50/80 hover:bg-blue-100 text-blue-700 text-xs font-black flex items-center justify-center gap-1.5 transition shadow-sm"
                  >
                    <span>🚗 ซ้ายทั้งหมด</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleSetAllBulkOrientation('right')}
                    className="p-2.5 rounded-xl border border-purple-200 bg-purple-50/80 hover:bg-purple-100 text-purple-700 text-xs font-black flex items-center justify-center gap-1.5 transition shadow-sm"
                  >
                    <span>🚗 ขวาทั้งหมด</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleAlternateBulkOrientation}
                    className="p-2.5 rounded-xl border border-emerald-200 bg-emerald-50/80 hover:bg-emerald-100 text-emerald-800 text-xs font-black flex items-center justify-center gap-1.5 transition shadow-sm"
                    title="แปลงเลขคี่เป็นซ้าย แปลงเลขคู่เป็นขวา"
                  >
                    <span>🔄 สลับคี่ซ้าย-คู่ขวา</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleSetAllBulkOrientation('standard')}
                    className="p-2.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-600 text-xs font-bold flex items-center justify-center gap-1.5 transition"
                  >
                    <span>➖ ไม่ระบุ/มาตรฐาน</span>
                  </button>
                </div>
              </div>

              {/* ส่วนที่ 3: ตารางรายการแปลงทั้งหมดที่เลือก */}
              <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                <div className="bg-slate-900 text-white px-4 py-2.5 text-[11px] font-mono uppercase tracking-wider flex items-center justify-between">
                  <span>รายการแปลงที่เลือก ({selectedPlotsList.length} แปลง)</span>
                  <span>เลือกทิศโรงจอดรถของแต่ละแปลง</span>
                </div>

                <div className="divide-y divide-slate-100 max-h-[300px] overflow-y-auto bg-white p-1">
                  {selectedPlotsList.map((plot, i) => {
                    const currentConfig = bulkPlotConfigs[plot.id] || { 
                      house_type_id: plot.house_type_id, 
                      garage_orientation: plot.garage_orientation || 'standard' 
                    };
                    const targetHtId = bulkEditTargetHouseType === 'KEEP_EXISTING' ? currentConfig.house_type_id : bulkEditTargetHouseType;
                    const htObj = houseTypeMap.get(targetHtId);
                    const isInfra = Boolean(htObj?.is_infrastructure);

                    return (
                      <div key={plot.id} className="p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/80 transition-colors">
                        <div className="flex items-center gap-2.5">
                          <span className="w-6 h-6 rounded-lg bg-slate-100 text-slate-500 font-mono text-[10px] font-bold flex items-center justify-center shrink-0">
                            {i + 1}
                          </span>
                          <div>
                            <span className="font-black text-slate-800 text-sm">{plot.plot_name || plot.id}</span>
                            <div className="flex items-center gap-1 mt-0.5">
                              <span className="text-[11px] text-slate-500 font-medium">แบบ: {htObj?.type_name || 'ยังไม่ระบุ'}</span>
                              {bulkEditTargetHouseType !== 'KEEP_EXISTING' && (
                                <span className="text-[9px] bg-purple-100 text-purple-700 px-1 rounded font-bold">
                                  จะเปลี่ยนใหม่
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Orientation Toggle Buttons for this specific plot */}
                        {!isInfra ? (
                          <div className="flex items-center gap-1.5 self-end sm:self-auto">
                            <button
                              type="button"
                              onClick={() => {
                                setBulkPlotConfigs(prev => ({
                                  ...prev,
                                  [plot.id]: { ...prev[plot.id], garage_orientation: 'left' }
                                }));
                              }}
                              className={`px-3 py-1.5 rounded-xl border text-xs font-black transition flex items-center gap-1 ${
                                currentConfig.garage_orientation === 'left'
                                  ? 'border-blue-600 bg-blue-50 text-blue-700 shadow-sm'
                                  : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-100'
                              }`}
                            >
                              <span>🚗 โรงรถซ้าย</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                setBulkPlotConfigs(prev => ({
                                  ...prev,
                                  [plot.id]: { ...prev[plot.id], garage_orientation: 'right' }
                                }));
                              }}
                              className={`px-3 py-1.5 rounded-xl border text-xs font-black transition flex items-center gap-1 ${
                                currentConfig.garage_orientation === 'right'
                                  ? 'border-purple-600 bg-purple-50 text-purple-700 shadow-sm'
                                  : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-100'
                              }`}
                            >
                              <span>🚗 โรงรถขวา</span>
                            </button>
                          </div>
                        ) : (
                          <span className="text-slate-400 text-xs italic px-3">
                            สาธารณูปโภค (ไม่ระบุโรงจอดรถ)
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="p-5 border-t border-slate-100 bg-slate-50 flex flex-col sm:flex-row items-center justify-between gap-3">
              <span className="text-xs font-bold text-slate-500">
                พร้อมบันทึก: <span className="text-purple-700 font-black">{selectedPlotsList.length}</span> แปลง
              </span>

              <div className="flex items-center gap-2 w-full sm:w-auto">
                <button
                  type="button"
                  onClick={() => setShowBulkEditModal(false)}
                  className="flex-1 sm:flex-none px-4 py-2.5 rounded-xl border border-slate-200 text-slate-600 font-bold text-xs hover:bg-slate-200/60 transition"
                >
                  ยกเลิก
                </button>

                <button
                  type="button"
                  disabled={isUpdating}
                  onClick={handleSaveBulkChanges}
                  className="flex-1 sm:flex-none px-6 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-black text-xs shadow-lg shadow-purple-500/20 flex items-center justify-center gap-1.5 transition disabled:opacity-50"
                >
                  {isUpdating ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                  <span>💾 ยืนยันบันทึกการเปลี่ยนแปลงทั้งหมด ({selectedPlotsList.length} แปลง)</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 📝 MODAL: SINGLE EDIT PLOT */}
      {editingPlot && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-5">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-black text-slate-800 text-base flex items-center gap-2">
                <Edit3 size={18} className="text-purple-600" />
                <span>แก้ไขแปลง {editingPlot.plot_name || editingPlot.id}</span>
              </h3>
              <button 
                onClick={() => setEditingPlot(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">
                  แบบบ้าน / สาธารณูปโภค <span className="text-rose-500 font-bold">*</span>
                </label>
                <select
                  value={editHouseTypeId}
                  onChange={(e) => setEditHouseTypeId(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 font-bold text-xs outline-none focus:border-purple-600"
                >
                  {houseTypes.map(ht => (
                    <option key={ht.id} value={ht.id}>
                      {ht.is_infrastructure ? '🏗️ ' : '🏠 '} {ht.type_name}
                    </option>
                  ))}
                </select>
              </div>

              {!isEditInfrastructure ? (
                <div>
                  <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">
                    ทิศทางโรงจอดรถ <span className="text-rose-500 font-bold">*</span>
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setEditGarageOrientation('left')}
                      className={`p-2.5 rounded-xl border-2 text-xs font-black flex items-center justify-center gap-1.5 transition-all ${
                        editGarageOrientation === 'left'
                          ? 'border-blue-600 bg-blue-50 text-blue-700 shadow-sm'
                          : 'border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100'
                      }`}
                    >
                      <span>🚗 โรงจอดรถซ้าย</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setEditGarageOrientation('right')}
                      className={`p-2.5 rounded-xl border-2 text-xs font-black flex items-center justify-center gap-1.5 transition-all ${
                        editGarageOrientation === 'right'
                          ? 'border-purple-600 bg-purple-50 text-purple-700 shadow-sm'
                          : 'border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100'
                      }`}
                    >
                      <span>🚗 โรงจอดรถขวา</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-amber-800 text-[11px] font-medium flex items-center gap-2">
                  <span>💡 งานสาธารณูปโภคไม่มีโรงจอดรถซ้าย/ขวา</span>
                </div>
              )}

              <div>
                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">
                  โฟร์แมนผู้รับผิดชอบ
                </label>
                <select
                  value={editForemanName}
                  onChange={(e) => setEditForemanName(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 font-bold text-xs outline-none focus:border-purple-600"
                >
                  <option value="">-- ไม่ระบุ --</option>
                  {foremenList.map(f => (
                    <option key={f.id || f.username} value={f.username}>{f.username}</option>
                  ))}
                </select>
              </div>

              {(editingPlot.inspection_round > 0 || editingPlot.is_completed) && (
                <div className="p-3 bg-rose-50 rounded-xl border border-rose-200 space-y-2">
                  <div className="flex items-center gap-1.5 text-rose-700 font-black text-xs">
                    <AlertTriangle size={14} />
                    <span>คำเตือน: แปลงนี้มีประวัติการตรวจงานไปแล้ว</span>
                  </div>
                  <p className="text-[11px] text-rose-600 leading-relaxed font-medium">
                    การเปลี่ยนแบบบ้านหรือทิศทางโรงจอดรถ อาจส่งผลต่อตำแหน่งหมุดและรูปภาพในประวัติการตรวจเดิม
                  </p>
                  <label className="flex items-center gap-2 cursor-pointer pt-1">
                    <input
                      type="checkbox"
                      checked={editWarningConfirmed}
                      onChange={(e) => setEditWarningConfirmed(e.target.checked)}
                      className="rounded text-rose-600"
                    />
                    <span className="text-[11px] font-bold text-rose-800">ฉันเข้าใจและยืนยันการเปลี่ยนแปลงนี้</span>
                  </label>
                </div>
              )}
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingPlot(null)}
                className="flex-1 bg-slate-100 text-slate-600 font-bold py-2.5 rounded-xl text-xs hover:bg-slate-200"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                disabled={isUpdating || ((editingPlot.inspection_round > 0 || editingPlot.is_completed) && !editWarningConfirmed)}
                onClick={handleSavePlotEdit}
                className="flex-1 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white font-black py-2.5 rounded-xl text-xs shadow-md flex items-center justify-center gap-1.5"
              >
                {isUpdating ? <Loader2 size={14} className="animate-spin" /> : 'บันทึกการแก้ไข'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ⚡ MODAL: BULK CREATE PLOTS */}
      {showBulkModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-3xl max-w-2xl w-full p-6 sm:p-8 shadow-2xl border border-slate-200 space-y-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b pb-4">
              <div>
                <h3 className="font-black text-slate-800 text-lg flex items-center gap-2">
                  <Zap size={20} className="text-purple-600" />
                  <span>สร้างแปลงเป็นชุด (Bulk Create Plots)</span>
                </h3>
                <p className="text-xs text-slate-500 font-medium mt-0.5">
                  โครงการ: {selectedProject?.name}
                </p>
              </div>
              <button 
                onClick={() => setShowBulkModal(false)}
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600"
              >
                <X size={20} />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">
                  Prefix รหัสแปลง
                </label>
                <input
                  type="text"
                  value={bulkPrefix}
                  onChange={(e) => setBulkPrefix(e.target.value.toUpperCase())}
                  placeholder="เช่น A-, B-, หรือว่างไว้"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-black text-xs text-slate-800 outline-none focus:border-purple-600"
                />
              </div>

              <div>
                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">
                  หมายเลขแปลง (เริ่มต้น - สิ้นสุด)
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="1"
                    value={bulkStartNum}
                    onChange={(e) => setBulkStartNum(parseInt(e.target.value) || 1)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-mono font-bold text-xs text-slate-800 text-center outline-none"
                  />
                  <span className="text-slate-400 font-bold">ถึง</span>
                  <input
                    type="number"
                    min="1"
                    value={bulkEndNum}
                    onChange={(e) => setBulkEndNum(parseInt(e.target.value) || 1)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-mono font-bold text-xs text-slate-800 text-center outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">
                  แบบบ้านเริ่มต้น <span className="text-rose-500 font-bold">*</span>
                </label>
                <select
                  value={bulkHouseTypeId}
                  onChange={(e) => setBulkHouseTypeId(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-bold text-xs text-slate-800 outline-none focus:border-purple-600"
                >
                  <option value="" disabled>-- เลือกแบบบ้าน --</option>
                  {houseTypes.map(ht => (
                    <option key={ht.id} value={ht.id}>
                      {ht.is_infrastructure ? '🏗️ ' : '🏠 '} {ht.type_name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">
                  โฟร์แมนเริ่มต้น
                </label>
                <select
                  value={bulkForemanName}
                  onChange={(e) => setBulkForemanName(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-bold text-xs text-slate-800 outline-none focus:border-purple-600"
                >
                  <option value="">-- ไม่ระบุ --</option>
                  {foremenList.map(f => (
                    <option key={f.id || f.username} value={f.username}>{f.username}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Pattern โรงจอดรถ */}
            <div>
              <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">
                รูปแบบกำหนดทิศโรงจอดรถ
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <button
                  type="button"
                  onClick={() => setBulkOrientationPattern('alternate')}
                  className={`p-2 rounded-xl border text-xs font-bold transition ${
                    bulkOrientationPattern === 'alternate'
                      ? 'border-purple-600 bg-purple-50 text-purple-700 shadow-sm'
                      : 'border-slate-200 bg-slate-50 text-slate-500'
                  }`}
                >
                  🔄 สลับซ้าย-ขวา
                </button>
                <button
                  type="button"
                  onClick={() => setBulkOrientationPattern('left')}
                  className={`p-2 rounded-xl border text-xs font-bold transition ${
                    bulkOrientationPattern === 'left'
                      ? 'border-blue-600 bg-blue-50 text-blue-700 shadow-sm'
                      : 'border-slate-200 bg-slate-50 text-slate-500'
                  }`}
                >
                  🚗 ซ้ายทั้งหมด
                </button>
                <button
                  type="button"
                  onClick={() => setBulkOrientationPattern('right')}
                  className={`p-2 rounded-xl border text-xs font-bold transition ${
                    bulkOrientationPattern === 'right'
                      ? 'border-purple-600 bg-purple-50 text-purple-700 shadow-sm'
                      : 'border-slate-200 bg-slate-50 text-slate-500'
                  }`}
                >
                  🚗 ขวาทั้งหมด
                </button>
                <button
                  type="button"
                  onClick={() => setBulkOrientationPattern('standard')}
                  className={`p-2 rounded-xl border text-xs font-bold transition ${
                    bulkOrientationPattern === 'standard'
                      ? 'border-slate-600 bg-slate-100 text-slate-800 shadow-sm'
                      : 'border-slate-200 bg-slate-50 text-slate-500'
                  }`}
                >
                  ➖ มาตรฐาน/ไม่ระบุ
                </button>
              </div>
            </div>

            {/* Live Preview List */}
            <div className="border border-slate-200 rounded-2xl p-4 bg-slate-50 space-y-2">
              <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                <span>ตัวอย่างแปลงที่จะสร้าง ({generatedBulkList.length} แปลง):</span>
                <label className="flex items-center gap-1.5 cursor-pointer text-slate-500 font-normal">
                  <input
                    type="checkbox"
                    checked={bulkPadZeros}
                    onChange={(e) => setBulkPadZeros(e.target.checked)}
                    className="rounded text-purple-600"
                  />
                  <span>เติมศูนย์ข้างหน้า (01, 02)</span>
                </label>
              </div>

              <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto p-2 bg-white rounded-xl border border-slate-200">
                {generatedBulkList.slice(0, 50).map((p, i) => (
                  <span key={i} className="px-2 py-1 rounded-md bg-slate-100 text-[10px] font-mono font-bold text-slate-700 flex items-center gap-1">
                    <span>{p.plot_name}</span>
                    <span className="text-[9px] text-slate-400">
                      ({p.garage_orientation === 'left' ? 'ซ้าย' : p.garage_orientation === 'right' ? 'ขวา' : '-'})
                    </span>
                  </span>
                ))}
                {generatedBulkList.length > 50 && (
                  <span className="px-2 py-1 text-[10px] font-bold text-slate-400">
                    ... และอีก {generatedBulkList.length - 50} แปลง
                  </span>
                )}
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowBulkModal(false)}
                className="flex-1 bg-slate-100 text-slate-600 font-bold py-3 rounded-xl text-xs hover:bg-slate-200"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                disabled={isUpdating || generatedBulkList.length === 0}
                onClick={handleConfirmBulkCreate}
                className="flex-1 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white font-black py-3 rounded-xl text-xs shadow-lg shadow-purple-500/20 flex items-center justify-center gap-1.5"
              >
                {isUpdating ? <Loader2 size={16} className="animate-spin" /> : `ยืนยันสร้าง ${generatedBulkList.length} แปลง`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ➕ MODAL: ADD SINGLE PLOT */}
      {showAddSingleModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-5">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-black text-slate-800 text-base flex items-center gap-2">
                <Plus size={18} className="text-purple-600" />
                <span>เพิ่มแปลงเดี่ยวใหม่</span>
              </h3>
              <button 
                onClick={() => setShowAddSingleModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">
                  รหัสแปลง <span className="text-rose-500 font-bold">*</span>
                </label>
                <input
                  type="text"
                  value={singlePlotName}
                  onChange={(e) => setSinglePlotName(e.target.value.toUpperCase())}
                  placeholder="เช่น A-15, แปลงพิเศษ-01"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 font-bold text-xs outline-none focus:border-purple-600"
                />
              </div>

              <div>
                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">
                  แบบบ้าน / สาธารณูปโภค <span className="text-rose-500 font-bold">*</span>
                </label>
                <select
                  value={singleHouseTypeId}
                  onChange={(e) => setSingleHouseTypeId(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 font-bold text-xs outline-none focus:border-purple-600"
                >
                  <option value="" disabled>-- เลือกแบบบ้าน --</option>
                  {houseTypes.map(ht => (
                    <option key={ht.id} value={ht.id}>
                      {ht.is_infrastructure ? '🏗️ ' : '🏠 '} {ht.type_name}
                    </option>
                  ))}
                </select>
              </div>

              {!houseTypeMap.get(singleHouseTypeId)?.is_infrastructure && (
                <div>
                  <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">
                    ทิศทางโรงจอดรถ
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setSingleGarageOrientation('left')}
                      className={`p-2.5 rounded-xl border-2 text-xs font-black flex items-center justify-center gap-1.5 transition-all ${
                        singleGarageOrientation === 'left'
                          ? 'border-blue-600 bg-blue-50 text-blue-700 shadow-sm'
                          : 'border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100'
                      }`}
                    >
                      <span>🚗 โรงจอดรถซ้าย</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setSingleGarageOrientation('right')}
                      className={`p-2.5 rounded-xl border-2 text-xs font-black flex items-center justify-center gap-1.5 transition-all ${
                        singleGarageOrientation === 'right'
                          ? 'border-purple-600 bg-purple-50 text-purple-700 shadow-sm'
                          : 'border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100'
                      }`}
                    >
                      <span>🚗 โรงจอดรถขวา</span>
                    </button>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">
                  โฟร์แมนผู้รับผิดชอบ
                </label>
                <select
                  value={singleForemanName}
                  onChange={(e) => setSingleForemanName(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 font-bold text-xs outline-none focus:border-purple-600"
                >
                  <option value="">-- ไม่ระบุ --</option>
                  {foremenList.map(f => (
                    <option key={f.id || f.username} value={f.username}>{f.username}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowAddSingleModal(false)}
                className="flex-1 bg-slate-100 text-slate-600 font-bold py-2.5 rounded-xl text-xs hover:bg-slate-200"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                disabled={isUpdating}
                onClick={handleSaveSinglePlot}
                className="flex-1 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white font-black py-2.5 rounded-xl text-xs shadow-md flex items-center justify-center gap-1.5"
              >
                {isUpdating ? <Loader2 size={14} className="animate-spin" /> : 'เพิ่มแปลง'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
