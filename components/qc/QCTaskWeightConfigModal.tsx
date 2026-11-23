'use client';
import React, { useState, useMemo } from 'react';
import {
  X,
  Scale,
  Search,
  CheckCircle2,
  AlertTriangle,
  Flame,
  Save,
  ShieldAlert,
  HelpCircle,
  Layers,
  CheckCheck,
} from 'lucide-react';
import {
  canManageQCWeights,
  saveQCTaskWeightsBatch,
  saveQCTaskWeightsMultiGroup,
  type QCTaskWeight,
} from '@/lib/qc/qcInspectionPlanService';

export interface GroupedTaskTemplate {
  nameKey: string;
  task_name: string;
  templateIds: string[];
  houseTypeCount: number;
  sampleTaskOrder?: number;
}

interface QCTaskWeightConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  taskTemplates: any[];
  currentWeights: Map<string, QCTaskWeight>;
  currentUserRole: string;
  loggedInUsername: string;
  onSaved?: () => void;
}

export default function QCTaskWeightConfigModal({
  isOpen,
  onClose,
  taskTemplates = [],
  currentWeights = new Map(),
  currentUserRole,
  loggedInUsername,
  onSaved,
}: QCTaskWeightConfigModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [editingWeights, setEditingWeights] = useState<Record<string, { weight: number; scope: string; isHoldPoint: boolean }>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [feedbackMsg, setFeedbackMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const isAuthorized = canManageQCWeights(currentUserRole);

  // Group task templates by unique task name (Option 1)
  const groupedTemplates: GroupedTaskTemplate[] = useMemo(() => {
    const map = new Map<string, GroupedTaskTemplate>();
    (taskTemplates || []).forEach(t => {
      const rawName = (t.task_name || '').trim();
      if (!rawName) return;
      const key = rawName.toLowerCase();
      const existing = map.get(key);
      if (existing) {
        existing.templateIds.push(String(t.id));
        existing.houseTypeCount++;
      } else {
        map.set(key, {
          nameKey: key,
          task_name: rawName,
          templateIds: [String(t.id)],
          houseTypeCount: 1,
          sampleTaskOrder: t.task_order,
        });
      }
    });

    return Array.from(map.values()).sort((a, b) => {
      const orderA = a.sampleTaskOrder ?? 999;
      const orderB = b.sampleTaskOrder ?? 999;
      if (orderA !== orderB) return orderA - orderB;
      return a.task_name.localeCompare(b.task_name, 'th');
    });
  }, [taskTemplates]);

  // Number of items with pending unsaved changes
  const pendingCount = Object.keys(editingWeights).length;

  // Initialize or read editing state for a grouped task
  const getWeightState = (group: GroupedTaskTemplate) => {
    if (editingWeights[group.nameKey]) {
      const cur = editingWeights[group.nameKey];
      return {
        ...cur,
        isConfigured: true,
        isPending: true,
      };
    }

    // Check if any template in this group has saved weights
    for (const tid of group.templateIds) {
      const w = currentWeights.get(tid);
      if (w) {
        return {
          weight: w.weight_score,
          scope: w.scope_description || '',
          isHoldPoint: w.is_hold_point,
          isConfigured: true,
          isPending: false,
        };
      }
    }

    return {
      weight: 2, // default suggestion 2
      scope: '',
      isHoldPoint: false,
      isConfigured: false,
      isPending: false,
    };
  };

  const handleWeightChange = (group: GroupedTaskTemplate, val: number) => {
    const cur = getWeightState(group);
    setEditingWeights(prev => ({
      ...prev,
      [group.nameKey]: { ...cur, weight: val },
    }));
  };

  const handleScopeChange = (group: GroupedTaskTemplate, scope: string) => {
    const cur = getWeightState(group);
    setEditingWeights(prev => ({
      ...prev,
      [group.nameKey]: { ...cur, scope },
    }));
  };

  const handleHoldPointToggle = (group: GroupedTaskTemplate) => {
    const cur = getWeightState(group);
    setEditingWeights(prev => ({
      ...prev,
      [group.nameKey]: { ...cur, isHoldPoint: !cur.isHoldPoint },
    }));
  };

  // 1. Single Item Save
  const handleSaveGroup = async (group: GroupedTaskTemplate) => {
    if (!isAuthorized) {
      setFeedbackMsg({ type: 'error', text: 'คุณไม่มีสิทธิ์แก้ไขแม่แบบน้ำหนักงาน' });
      return;
    }
    const state = getWeightState(group);
    setIsSaving(true);
    setSavingKey(group.nameKey);
    setFeedbackMsg(null);

    const res = await saveQCTaskWeightsBatch({
      taskTemplateIds: group.templateIds,
      weightScore: state.weight,
      scopeDescription: state.scope,
      isHoldPoint: state.isHoldPoint,
      actorUsername: loggedInUsername,
      actorRole: currentUserRole,
    });

    setIsSaving(false);
    setSavingKey(null);

    if (res.success) {
      setFeedbackMsg({
        type: 'success',
        text: `บันทึกค่าน้ำหนัก "${group.task_name}" (${group.templateIds.length} แบบบ้าน) เรียบร้อยแล้ว`,
      });
      // Remove from pending
      setEditingWeights(prev => {
        const next = { ...prev };
        delete next[group.nameKey];
        return next;
      });
      onSaved?.();
      setTimeout(() => setFeedbackMsg(null), 2500);
    } else {
      setFeedbackMsg({ type: 'error', text: res.error || 'เกิดข้อผิดพลาดในการบันทึก' });
    }
  };

  // 2. Batch Save All (บันทึกทีเดียวทั้งหมด)
  const handleSaveAll = async () => {
    if (!isAuthorized) {
      setFeedbackMsg({ type: 'error', text: 'คุณไม่มีสิทธิ์แก้ไขแม่แบบน้ำหนักงาน' });
      return;
    }

    // If user edited specific items, save those; otherwise save all filtered items
    const targetGroups = pendingCount > 0
      ? groupedTemplates.filter(g => editingWeights[g.nameKey])
      : filteredGroups;

    if (targetGroups.length === 0) {
      setFeedbackMsg({ type: 'error', text: 'ไม่มีรายการที่จะบันทึก' });
      return;
    }

    setIsSaving(true);
    setSavingKey(null);
    setFeedbackMsg(null);

    const itemsToSave = targetGroups.map(group => {
      const state = getWeightState(group);
      return {
        taskTemplateIds: group.templateIds,
        weightScore: state.weight,
        scopeDescription: state.scope,
        isHoldPoint: state.isHoldPoint,
      };
    });

    const res = await saveQCTaskWeightsMultiGroup(
      itemsToSave,
      loggedInUsername,
      currentUserRole
    );

    setIsSaving(false);

    if (res.success) {
      setFeedbackMsg({
        type: 'success',
        text: `บันทึกค่าน้ำหนักเรียบร้อยแล้วทั้งหมด ${targetGroups.length} ชื่องาน (${res.count || targetGroups.length} แม่แบบในทุกแบบบ้าน)`,
      });
      setEditingWeights({});
      onSaved?.();
      setTimeout(() => setFeedbackMsg(null), 3000);
    } else {
      setFeedbackMsg({ type: 'error', text: res.error || 'เกิดข้อผิดพลาดในการบันทึก' });
    }
  };

  // Filter grouped templates by search query
  const filteredGroups = useMemo(() => {
    if (!searchQuery.trim()) return groupedTemplates;
    const q = searchQuery.toLowerCase().trim();
    return groupedTemplates.filter(g => g.task_name.toLowerCase().includes(q));
  }, [groupedTemplates, searchQuery]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl max-w-2xl sm:max-w-3xl w-full p-5 sm:p-6 shadow-2xl border border-slate-200 flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-100 shrink-0">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 bg-purple-50 text-purple-700 rounded-lg text-xs font-black border border-purple-200">
                <Scale size={13} />
                <span>ตั้งค่าน้ำหนักแม่แบบงานตรวจ (QC Task Weights)</span>
              </div>
              <span className="text-[11px] text-slate-500 font-bold bg-slate-100 px-2 py-0.5 rounded-md">
                รวมกลุ่มชื่องาน ({groupedTemplates.length} รายการ จาก {taskTemplates.length} แม่แบบ)
              </span>
            </div>
            <h3 className="text-base sm:text-lg font-black text-slate-900">
              กำหนดแต้มภาระงานตามขอบเขตจริง (1–5 แต้ม)
            </h3>
            <p className="text-xs text-slate-500 font-medium">
              เลือกแต้มหลายรายการแล้วกด "บันทึกทั้งหมด" ได้ทันที • คะแนนจะ Snapshot เมื่อยืนยันแผนรายวัน
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 transition-all cursor-pointer shrink-0"
          >
            <X size={20} />
          </button>
        </div>

        {/* Feedback Alert */}
        {feedbackMsg && (
          <div
            className={`p-3 rounded-xl text-xs font-bold flex items-center gap-2 mt-3 shrink-0 ${
              feedbackMsg.type === 'success'
                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                : 'bg-rose-50 text-rose-800 border border-rose-200'
            }`}
          >
            {feedbackMsg.type === 'success' ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
            <span>{feedbackMsg.text}</span>
          </div>
        )}

        {/* Pending Unsaved Changes Banner */}
        {pendingCount > 0 && isAuthorized && (
          <div className="flex items-center justify-between px-3.5 py-2 bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-2xl text-xs text-amber-900 mt-3 shrink-0 animate-in fade-in">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping" />
              <span className="font-bold">
                คุณได้เลือกคะแนนไว้ <span className="font-black text-amber-700 underline">{pendingCount} รายการ</span> ที่ยังไม่ได้บันทึก
              </span>
            </div>
            <button
              type="button"
              disabled={isSaving}
              onClick={handleSaveAll}
              className="px-3.5 py-1.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white text-xs font-black rounded-xl shadow-xs flex items-center gap-1.5 transition-all cursor-pointer active:scale-95 disabled:opacity-50"
            >
              <CheckCheck size={14} />
              <span>{isSaving && !savingKey ? 'กำลังบันทึก...' : `บันทึกทีเดียวทั้ง ${pendingCount} รายการ`}</span>
            </button>
          </div>
        )}

        {/* Search Bar */}
        <div className="py-3 shrink-0">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="ค้นหาชื่องานเพื่อตั้งค่าน้ำหนัก..."
              className="w-full pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:ring-2 focus:ring-purple-500 focus:outline-none transition-all placeholder:text-slate-400"
            />
          </div>
        </div>

        {/* Body Task List */}
        <div className="flex-1 overflow-y-auto custom-scrollbar pr-1 space-y-3">
          {filteredGroups.length === 0 ? (
            <div className="text-center py-10 text-xs text-slate-400">
              ไม่พบชื่องานที่ตรงกับการค้นหา
            </div>
          ) : (
            filteredGroups.map(group => {
              const state = getWeightState(group);
              const isCurrentlySaving = isSaving && savingKey === group.nameKey;
              const hasUnsavedChange = Boolean(editingWeights[group.nameKey]);

              return (
                <div
                  key={group.nameKey}
                  className={`p-3.5 rounded-2xl border space-y-2.5 transition-all ${
                    hasUnsavedChange
                      ? 'bg-amber-50/30 border-amber-300 shadow-xs ring-1 ring-amber-300/50'
                      : 'bg-slate-50 border-slate-200 hover:border-purple-200'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="text-xs sm:text-sm font-black text-slate-900">{group.task_name}</h4>
                        <span className="px-2 py-0.5 bg-purple-50 text-purple-700 border border-purple-200 rounded-md text-[10px] font-bold flex items-center gap-1">
                          <Layers size={11} />
                          <span>ใช้งานใน {group.houseTypeCount} แบบบ้าน</span>
                        </span>
                      </div>
                      <p className="text-[10px] text-slate-400 mt-0.5">
                        ลำดับงวดประมาณ: {group.sampleTaskOrder || '-'} • ครอบคลุมแม่แบบ {group.templateIds.length} รายการ
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {hasUnsavedChange ? (
                        <span className="px-2 py-0.5 bg-amber-100 text-amber-800 border border-amber-300 rounded-lg text-[10px] font-black animate-pulse">
                          เลือกแล้ว (รอบันทึก {state.weight} แต้ม)
                        </span>
                      ) : state.isConfigured ? (
                        <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg text-[10px] font-black">
                          ระบุแล้ว ({state.weight} แต้ม)
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 bg-slate-200 text-slate-600 rounded-lg text-[10px] font-bold">
                          ยังไม่ระบุน้ำหนัก
                        </span>
                      )}
                      {state.isHoldPoint && (
                        <span className="px-2 py-0.5 bg-rose-100 text-rose-700 border border-rose-300 rounded-lg text-[10px] font-black flex items-center gap-1">
                          <Flame size={11} />
                          <span>Hold Point</span>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Weight Selector & Scope Inputs */}
                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 pt-2 border-t border-slate-200/60 items-center">
                    {/* Weight Score Buttons */}
                    <div className="sm:col-span-4 flex items-center gap-1">
                      <span className="text-[10px] font-bold text-slate-500 mr-1">คะแนน:</span>
                      {[1, 2, 3, 4, 5].map(pt => (
                        <button
                          key={pt}
                          type="button"
                          disabled={!isAuthorized || isSaving}
                          onClick={() => handleWeightChange(group, pt)}
                          className={`w-7 h-7 rounded-lg text-xs font-black transition-all cursor-pointer ${
                            state.weight === pt
                              ? 'bg-purple-600 text-white shadow-xs scale-105'
                              : 'bg-white hover:bg-slate-200 border border-slate-200 text-slate-700'
                          }`}
                        >
                          {pt}
                        </button>
                      ))}
                    </div>

                    {/* Scope description input */}
                    <div className="sm:col-span-5">
                      <input
                        type="text"
                        disabled={!isAuthorized || isSaving}
                        value={state.scope}
                        onChange={e => handleScopeChange(group, e.target.value)}
                        placeholder="ระบุขอบเขตงาน เช่น ตรวจทาบเหล็ก 5 จุด"
                        className="w-full px-2.5 py-1 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-purple-400 placeholder:text-slate-400"
                      />
                    </div>

                    {/* Hold Point toggle & Individual Save button */}
                    <div className="sm:col-span-3 flex items-center justify-end gap-2">
                      <label className="flex items-center gap-1 text-[10px] font-bold text-slate-600 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          disabled={!isAuthorized || isSaving}
                          checked={state.isHoldPoint}
                          onChange={() => handleHoldPointToggle(group)}
                          className="rounded text-purple-600 focus:ring-purple-400"
                        />
                        <span>Hold Point</span>
                      </label>

                      {isAuthorized && (
                        <button
                          type="button"
                          disabled={isSaving}
                          onClick={() => handleSaveGroup(group)}
                          className={`px-2.5 py-1 text-[11px] font-bold rounded-lg shadow-2xs transition-all flex items-center gap-1 cursor-pointer disabled:opacity-50 ${
                            hasUnsavedChange
                              ? 'bg-amber-600 hover:bg-amber-700 text-white'
                              : 'bg-purple-600 hover:bg-purple-700 text-white'
                          }`}
                          title="บันทึกเฉพาะรายการนี้"
                        >
                          <Save size={12} />
                          <span>{isCurrentlySaving ? 'กำลังบันทึก...' : 'บันทึก'}</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="pt-3 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500 shrink-0">
          <div className="text-[11px] flex items-center gap-1.5 text-slate-500 flex-wrap">
            <HelpCircle size={13} className="text-slate-400 shrink-0" />
            <span>งานย่อย 1 แต้ม • งานทั่วไป 2 แต้ม • งานซับซ้อน/โครงสร้าง 3-5 แต้ม</span>
            {pendingCount > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-black text-[10px] animate-pulse">
                เลือกค้างไว้ {pendingCount} รายการ
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-xs cursor-pointer transition-all"
            >
              ปิด
            </button>
            {isAuthorized && (
              <button
                type="button"
                disabled={isSaving}
                onClick={handleSaveAll}
                className="px-5 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white rounded-xl font-black text-xs shadow-md shadow-purple-500/20 flex items-center gap-1.5 transition-all cursor-pointer active:scale-95 disabled:opacity-50"
                title="บันทึกการตั้งค่าน้ำหนักทั้งหมดที่เลือกไว้ในครั้งเดียว"
              >
                <Save size={14} />
                <span>
                  {isSaving && !savingKey
                    ? 'กำลังบันทึกทั้งหมด...'
                    : pendingCount > 0
                    ? `บันทึกทั้งหมด (${pendingCount} รายการ)`
                    : 'บันทึกทั้งหมด'}
                </span>
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
