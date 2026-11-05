'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { 
  X, User, HardHat, Check, Users, Save, AlertCircle, Plus, 
  CheckCircle2, ShieldCheck, Info
} from 'lucide-react';
import { SEForemanMap } from '@/lib/plannerScoring';

interface SEForemanAssignmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  siteEngineers: any[];
  foremenList: any[];
  plots: any[];
  initialMap: SEForemanMap;
  onSave: (newMap: SEForemanMap) => Promise<void>;
  currentUserName?: string;
}

export default function SEForemanAssignmentModal({
  isOpen,
  onClose,
  siteEngineers = [],
  foremenList = [],
  plots = [],
  initialMap = {},
  onSave,
  currentUserName = 'Executive'
}: SEForemanAssignmentModalProps) {
  // Local state of mapping: { [seName]: string[] }
  const [mapState, setMapState] = useState<SEForemanMap>({});
  const [selectedSe, setSelectedSe] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [customSeName, setCustomSeName] = useState('');
  const [showAddSeInput, setShowAddSeInput] = useState(false);

  // Initialize mapping when modal opens or initialMap changes
  useEffect(() => {
    if (isOpen) {
      setMapState({ ...(initialMap || {}) });
      setSaveSuccess(false);

      // Default select the first SE (or 'BANK' if available)
      const seNames = getAvailableSeNames();
      if (seNames.length > 0) {
        const defaultSe = seNames.find((n) => n.toUpperCase() === 'BANK') || seNames[0];
        setSelectedSe(defaultSe);
      }
    }
  }, [isOpen, initialMap]);

  // Extract all unique SE names
  const getAvailableSeNames = (): string[] => {
    const names = new Set<string>();
    siteEngineers.forEach((se: any) => {
      const n = (se.username || se.name || '').trim();
      if (n) names.add(n);
    });
    // Add any SE names from initialMap
    Object.keys(initialMap || {}).forEach((n) => {
      if (n.trim()) names.add(n.trim());
    });
    // Also check if any plot already has a site_engineer
    plots.forEach((p: any) => {
      const se = (p.site_engineer || '').trim();
      if (se && se !== 'วิศวกรส่วนกลาง' && se !== 'วิศวกรส่วนกลาง (Site Engineer)') {
        names.add(se);
      }
    });

    // Ensure 'BANK' is present if in system
    if (names.size === 0) names.add('BANK');
    return Array.from(names);
  };

  const seNamesList = useMemo(() => getAvailableSeNames(), [siteEngineers, initialMap, plots]);

  // Extract unique foremen with their plot count
  const foremenData = useMemo(() => {
    const counts: Record<string, number> = {};
    plots.forEach((p: any) => {
      const fm = (p.foreman_name || p.foreman || '').trim();
      if (fm) {
        counts[fm] = (counts[fm] || 0) + 1;
      }
    });

    const set = new Set<string>();
    foremenList.forEach((f: any) => {
      const n = (f.username || f.name || '').trim();
      if (n) set.add(n);
    });
    Object.keys(counts).forEach((fm) => set.add(fm));

    return Array.from(set).map((name) => ({
      name,
      plotCount: counts[name] || 0
    })).sort((a, b) => b.plotCount - a.plotCount);
  }, [foremenList, plots]);

  if (!isOpen) return null;

  // Find which SE currently has this foreman assigned
  const getAssignedSeForForeman = (foremanName: string): string | null => {
    for (const [se, foremen] of Object.entries(mapState)) {
      if (foremen && foremen.includes(foremanName)) {
        return se;
      }
    }
    return null;
  };

  // Toggle foreman assignment for currently selected SE
  const handleToggleForeman = (foremanName: string) => {
    if (!selectedSe) return;

    setMapState((prev) => {
      const next: SEForemanMap = {};
      // Deep clone existing map
      Object.keys(prev).forEach((k) => {
        next[k] = [...(prev[k] || [])];
      });

      if (!next[selectedSe]) {
        next[selectedSe] = [];
      }

      const isAssignedToCurrent = next[selectedSe].includes(foremanName);

      if (isAssignedToCurrent) {
        // Remove from current SE
        next[selectedSe] = next[selectedSe].filter((f) => f !== foremanName);
      } else {
        // Remove from any other SE first (a foreman belongs to 1 primary SE team)
        Object.keys(next).forEach((se) => {
          next[se] = next[se].filter((f) => f !== foremanName);
        });
        // Add to current SE
        next[selectedSe].push(foremanName);
      }

      return next;
    });
  };

  // Add a new custom SE
  const handleAddCustomSe = () => {
    const trimmed = customSeName.trim();
    if (!trimmed) return;
    if (!seNamesList.includes(trimmed)) {
      setMapState((prev) => ({
        ...prev,
        [trimmed]: prev[trimmed] || []
      }));
    }
    setSelectedSe(trimmed);
    setCustomSeName('');
    setShowAddSeInput(false);
  };

  // Calculate summary stats for the selected SE
  const selectedSeForemen = mapState[selectedSe] || [];
  const totalPlotsUnderSelectedSe = selectedSeForemen.reduce((acc, fm) => {
    const found = foremenData.find((f) => f.name === fm);
    return acc + (found ? found.plotCount : 0);
  }, 0);

  // Save handler
  const handleSave = async () => {
    setIsSaving(true);
    setSaveError(null);
    try {
      await onSave(mapState);
      setSaveSuccess(true);
      setTimeout(() => {
        onClose();
      }, 800);
    } catch (err: any) {
      setSaveError(err?.message || 'เกิดข้อผิดพลาดในการบันทึกข้อมูล กรุณาลองใหม่อีกครั้ง');
      console.error('Failed to save SE-foreman mapping:', err);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl shadow-2xl max-w-3xl w-full overflow-hidden border border-slate-200 flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="bg-gradient-to-r from-slate-900 via-blue-950 to-slate-900 text-white p-5 md:p-6 flex items-start justify-between border-b border-slate-800 shrink-0">
          <div>
            <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-blue-500/20 text-blue-300 rounded-full text-xs font-black uppercase tracking-wider mb-2 border border-blue-500/30">
              <Users size={13} /> SE ➔ Foremen Team Mapping
            </div>
            <h2 className="text-xl md:text-2xl font-black text-white flex items-center gap-2">
              จัดการผูกทีมโฟร์แมนเข้ากับ Site Engineer
            </h2>
            <p className="text-xs text-slate-300 mt-1 max-w-xl font-medium">
              กำหนดว่าวิศวกร (SE) แต่ละท่านดูแลโฟร์แมนคนไหนบ้าง — ทุกแปลงบ้านในมือของโฟร์แมนจะถูกนำมาคำนวณคะแนนถ่วงน้ำหนักให้ SE ท่านนั้นโดยอัตโนมัติ
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-xl transition-all cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 md:p-6 space-y-6 overflow-y-auto flex-1">
          
          {/* Step 1: Select Site Engineer */}
          <div>
            <div className="flex items-center justify-between mb-2.5">
              <label className="text-xs font-black text-slate-700 flex items-center gap-1.5 uppercase tracking-wide">
                <User size={15} className="text-blue-600" />
                1. เลือก Site Engineer ที่ต้องการจัดการทีม:
              </label>
              <button
                type="button"
                onClick={() => setShowAddSeInput(!showAddSeInput)}
                className="text-xs font-bold text-blue-600 hover:text-blue-700 hover:underline flex items-center gap-1 cursor-pointer"
              >
                <Plus size={13} /> เพิ่มชื่อวิศวกรใหม่
              </button>
            </div>

            {showAddSeInput && (
              <div className="mb-3 p-3 bg-blue-50 rounded-2xl border border-blue-200 flex items-center gap-2">
                <input
                  type="text"
                  placeholder="พิมพ์ชื่อ Site Engineer..."
                  value={customSeName}
                  onChange={(e) => setCustomSeName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAddCustomSe(); }}
                  className="flex-1 bg-white border border-blue-300 rounded-xl px-3 py-1.5 text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  type="button"
                  onClick={handleAddCustomSe}
                  className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all cursor-pointer"
                >
                  เพิ่ม
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddSeInput(false)}
                  className="p-1.5 text-slate-400 hover:text-slate-600 text-xs cursor-pointer"
                >
                  ยกเลิก
                </button>
              </div>
            )}

            {/* SE Selection Pill Buttons */}
            <div className="flex flex-wrap gap-2">
              {seNamesList.map((name) => {
                const isSelected = selectedSe === name;
                const countFm = (mapState[name] || []).length;
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => setSelectedSe(name)}
                    className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl font-black text-xs md:text-sm transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-blue-600 text-white shadow-md shadow-blue-600/25 ring-2 ring-blue-400'
                        : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200'
                    }`}
                  >
                    <User size={15} className={isSelected ? 'text-white' : 'text-blue-600'} />
                    {name}
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                        isSelected ? 'bg-white/20 text-white' : 'bg-slate-200/80 text-slate-600'
                      }`}
                    >
                      {countFm} โฟร์แมน
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Step 2: Select Foremen for the chosen SE */}
          <div>
            <div className="flex items-center justify-between mb-2.5">
              <label className="text-xs font-black text-slate-700 flex items-center gap-1.5 uppercase tracking-wide">
                <HardHat size={15} className="text-amber-500" />
                2. ติ๊กเลือกโฟร์แมนที่อยู่ใต้การดูแลของ <span className="text-blue-600 font-black underline">{selectedSe || 'วิศวกร'}</span>:
              </label>
              <span className="text-[11px] text-slate-400 font-bold">
                (คลิกเพื่อเพิ่ม / ปลดออก)
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              {foremenData.map((fm) => {
                const isSelected = selectedSeForemen.includes(fm.name);
                const assignedOtherSe = getAssignedSeForForeman(fm.name);
                const isAssignedToOther = assignedOtherSe && assignedOtherSe !== selectedSe;

                return (
                  <div
                    key={fm.name}
                    onClick={() => handleToggleForeman(fm.name)}
                    className={`p-3.5 rounded-2xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                      isSelected
                        ? 'bg-blue-50/70 border-blue-400 ring-2 ring-blue-400/30 shadow-xs'
                        : isAssignedToOther
                        ? 'bg-slate-50/60 border-slate-200 hover:border-slate-300 opacity-70'
                        : 'bg-white border-slate-200 hover:border-blue-300 hover:bg-blue-50/20'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div
                        className={`w-8 h-8 rounded-xl flex items-center justify-center font-black text-xs shrink-0 ${
                          isSelected
                            ? 'bg-blue-600 text-white'
                            : 'bg-amber-100 text-amber-800 border border-amber-200'
                        }`}
                      >
                        {isSelected ? <Check size={16} strokeWidth={3} /> : <HardHat size={15} />}
                      </div>
                      <div className="min-w-0">
                        <span className="font-black text-sm text-slate-900 block truncate">
                          {fm.name}
                        </span>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                            {fm.plotCount} แปลงในมือ
                          </span>
                          {isAssignedToOther && (
                            <span className="text-[9px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded truncate max-w-[90px]" title={`ปัจจุบันอยู่กับ ${assignedOtherSe}`}>
                              อยู่กับ {assignedOtherSe}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div
                      className={`w-5 h-5 rounded-lg border flex items-center justify-center shrink-0 transition-colors ${
                        isSelected
                          ? 'bg-blue-600 border-blue-600 text-white'
                          : 'border-slate-300 bg-white'
                      }`}
                    >
                      {isSelected && <Check size={13} strokeWidth={3} />}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Summary Box */}
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200/80 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-blue-600 text-white rounded-xl shadow-xs">
                <ShieldCheck size={20} />
              </div>
              <div>
                <span className="text-[10px] font-bold text-blue-800 uppercase tracking-wider block">
                  สรุปสายงานวิศวกร: {selectedSe}
                </span>
                <span className="font-black text-sm text-slate-900">
                  ดูแลโฟร์แมน <span className="text-blue-600">{selectedSeForemen.length}</span> คน
                  ({selectedSeForemen.join(', ') || 'ยังไม่ได้เลือก'}) ➔ รับผิดชอบบ้านรวม{' '}
                  <span className="text-blue-600 font-black">{totalPlotsUnderSelectedSe}</span> แปลง
                </span>
              </div>
            </div>
            
            <div className="text-right shrink-0">
              <span className="text-[10px] font-bold text-slate-400 block">เกณฑ์ประเมินลูกโซ่</span>
              <span className="text-xs font-black text-slate-700">คำนวณถ่วงน้ำหนักอัตโนมัติ</span>
            </div>
          </div>

        </div>

        {saveError && (
          <div className="mx-5 mb-2 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
            <AlertCircle size={15} className="shrink-0 text-rose-600" />
            <span className="font-semibold">{saveError}</span>
          </div>
        )}

        {/* Footer */}
        <div className="p-4 md:p-5 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-3 shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="px-4 py-2.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold transition-all cursor-pointer"
          >
            ยกเลิก
          </button>

          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-black transition-all shadow-md shadow-blue-600/20 cursor-pointer disabled:opacity-50"
          >
            {isSaving ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                กำลังบันทึกและผูกแปลง...
              </>
            ) : saveSuccess ? (
              <>
                <CheckCircle2 size={16} className="text-emerald-300" />
                บันทึกเรียบร้อยแล้ว!
              </>
            ) : (
              <>
                <Save size={16} />
                บันทึกการจัดทีม (Save Team Mapping)
              </>
            )}
          </button>
        </div>

      </div>
    </div>
  );
}
