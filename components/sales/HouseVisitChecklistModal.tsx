"use client";

import React, { useState, useEffect } from 'react';
import { 
  X, CheckCircle, Clock, AlertCircle, Home, CheckSquare, 
  Square, ArrowRight, ArrowLeft, Save, User, Calendar, 
  Phone, Sparkles, FileText, ChevronRight, HelpCircle,
  Car, ShieldCheck, ThumbsUp, AlertTriangle, RefreshCw, Loader2
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Lead, CRMStatus } from '@/types/sales';
import { CRM_STATUS_OPTIONS } from '@/lib/salesImportHelper';

interface HouseVisitChecklistModalProps {
  isOpen: boolean;
  onClose: () => void;
  lead?: Lead | null;
  projectName?: string;
  user?: any;
  plots?: any[];
  onOpenSurvey?: (lead: Lead) => void;
  onSaved?: () => void;
}

// Stage A Checklist Items
const STAGE_A_CATEGORIES = [
  {
    id: 'house_condition',
    title: '🏠 สภาพบ้านตัวอย่าง & ความสะอาด',
    description: 'เตรียมความพร้อมของสถานที่และบรรยากาศต้อนรับ',
    items: [
      { id: 'check_sample_house', label: 'ตรวจบ้านตัวอย่าง / บ้านที่จะพาชม' },
      { id: 'turn_on_lights', label: 'เปิดไฟทุกจุดสำคัญ' },
      { id: 'turn_on_ac', label: 'เปิดแอร์ / ระบายอากาศล่วงหน้า' },
      { id: 'check_toilet', label: 'เช็กห้องน้ำ (แห้ง สะอาด กลิ่นหอม)' },
      { id: 'check_cleanliness', label: 'เช็กฝุ่นและความสะอาดทั่วไป' },
      { id: 'arrange_furniture', label: 'จัดระเบียบเฟอร์นิเจอร์และพร็อพ' },
      { id: 'prepare_drinking_water', label: 'เตรียมน้ำดื่ม / เครื่องดื่มต้อนรับ' },
      { id: 'buddha_water_sop', label: 'ถวายน้ำพระ / ตรวจพื้นที่พระตาม SOP บริษัท' },
    ]
  },
  {
    id: 'vehicle_route',
    title: '🛺 รถกอล์ฟ & เส้นทางพาชม',
    description: 'เตรียมความพร้อมยานพาหนะและทัศนียภาพเส้นทาง',
    items: [
      { id: 'prepare_golf_cart', label: 'เตรียมรถกอล์ฟ (ทำความสะอาดเบาะ)' },
      { id: 'check_golf_cart_battery', label: 'ตรวจระดับแบตเตอรี่รถกอล์ฟ' },
      { id: 'check_tour_route', label: 'เช็กเส้นทางที่จะพาชม (ไม่มีสิ่งกีดขวาง)' },
    ]
  },
  {
    id: 'sales_docs',
    title: '📄 เอกสารการขาย & โปรโมชั่น',
    description: 'เตรียมข้อมูลและราคาที่อัปเดตล่าสุด',
    items: [
      { id: 'prepare_price_list', label: 'เตรียม Price List ล่าสุด' },
      { id: 'prepare_stock_list', label: 'เตรียม Stock List / แปลงว่างล่าสุด' },
      { id: 'prepare_layout', label: 'เตรียม Layout & Floor Plan แบบบ้าน' },
      { id: 'check_promotions', label: 'ตรวจโปรโมชั่น / ของแถมแคมเปญล่าสุด' },
      { id: 'check_loan_info', label: 'ตรวจข้อมูลสินเชื่อเบื้องต้น / ดอกเบี้ยธนาคาร' },
    ]
  }
];

// Stage C Shutdown Items
const STAGE_C_SHUTDOWN_ITEMS = [
  { id: 'turn_off_lights', label: 'ปิดไฟทุกจุด' },
  { id: 'turn_off_ac', label: 'ปิดแอร์' },
  { id: 'turn_off_water', label: 'ปิดน้ำ / ตรวจก๊อกน้ำ' },
  { id: 'check_doors_windows', label: 'ตรวจประตูดิจิทัล & ล็อกหน้าต่างทุกบาน' },
  { id: 'collect_documents', label: 'เก็บเอกสารและแผ่นพับเข้าที่' },
  { id: 'reset_house_condition', label: 'เก็บบ้านและเฟอร์นิเจอร์กลับสภาพเดิม' },
  { id: 'return_golf_cart', label: 'นำรถกอล์ฟคืนจุดจอดและเสียบชาร์จ' },
];

export default function HouseVisitChecklistModal({
  isOpen,
  onClose,
  lead,
  projectName = 'ไอลิน 6',
  user,
  plots = [],
  onOpenSurvey,
  onSaved
}: HouseVisitChecklistModalProps) {
  const [currentStage, setCurrentStage] = useState<'stage_a' | 'stage_b' | 'stage_c'>('stage_a');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [checklistId, setChecklistId] = useState<string | null>(null);

  // Form States
  const [customerName, setCustomerName] = useState(lead?.customer_name || '');
  const [selectedHousePlot, setSelectedHousePlot] = useState(lead?.interested_plot_name || '');
  const [agentName, setAgentName] = useState(user?.username || lead?.agent_name || 'Bell');

  // Stage A state (16 items)
  const [stageAChecklist, setStageAChecklist] = useState<Record<string, boolean>>({});

  // Stage B state
  const [stageBStartedAt, setStageBStartedAt] = useState<string | null>(null);
  const [stageBNotes, setStageBNotes] = useState('');

  // Stage C state
  const [stageCChecklist, setStageCChecklist] = useState<Record<string, boolean>>({});
  const [customerFeedback, setCustomerFeedback] = useState('');
  const [interestedPlot, setInterestedPlot] = useState(lead?.interested_plot_name || '');
  const [objections, setObjections] = useState('');
  const [crmStatus, setCrmStatus] = useState<CRMStatus>((lead?.crm_status as CRMStatus) || 'Considering — กำลังพิจารณา / เปรียบเทียบ');
  const [nextAction, setNextAction] = useState('');
  const [nextFollowUpDate, setNextFollowUpDate] = useState('');

  // Auto-init state when modal opens or lead changes
  useEffect(() => {
    if (lead) {
      setCustomerName(lead.customer_name);
      setSelectedHousePlot(lead.interested_plot_name || '');
      setInterestedPlot(lead.interested_plot_name || '');
      if (lead.crm_status) setCrmStatus(lead.crm_status as CRMStatus);
    }
  }, [lead]);

  if (!isOpen) return null;

  // Toggle Stage A item
  const toggleStageA = (id: string) => {
    setStageAChecklist(prev => ({ ...prev, [id]: !prev[id] }));
  };

  // Check all Stage A
  const handleCheckAllStageA = () => {
    const all: Record<string, boolean> = {};
    STAGE_A_CATEGORIES.forEach(cat => cat.items.forEach(it => { all[it.id] = true; }));
    setStageAChecklist(all);
  };

  // Toggle Stage C item
  const toggleStageC = (id: string) => {
    setStageCChecklist(prev => ({ ...prev, [id]: !prev[id] }));
  };

  // Check all Stage C
  const handleCheckAllStageC = () => {
    const all: Record<string, boolean> = {};
    STAGE_C_SHUTDOWN_ITEMS.forEach(it => { all[it.id] = true; });
    setStageCChecklist(all);
  };

  // Count checked items
  const totalStageAItems = STAGE_A_CATEGORIES.reduce((acc, cat) => acc + cat.items.length, 0);
  const checkedStageACount = Object.values(stageAChecklist).filter(Boolean).length;
  const isStageAComplete = checkedStageACount === totalStageAItems;

  const totalStageCItems = STAGE_C_SHUTDOWN_ITEMS.length;
  const checkedStageCCount = Object.values(stageCChecklist).filter(Boolean).length;

  // Move from Stage A to B
  const handleProceedToStageB = () => {
    setStageBStartedAt(new Date().toISOString());
    setCurrentStage('stage_b');
  };

  // Move from Stage B to C
  const handleProceedToStageC = () => {
    setCurrentStage('stage_c');
  };

  // Final Submit Stage C & Auto-Sync to Database
  const handleCompleteChecklist = async () => {
    setIsSubmitting(true);
    try {
      const now = new Date().toISOString();

      // 1. Save Checklist record
      const checklistPayload = {
        lead_id: lead?.id || null,
        customer_name: customerName || lead?.customer_name || 'ลูกค้าทั่วไป',
        project_name: projectName,
        house_or_plot_name: selectedHousePlot || null,
        agent_name: agentName,
        stage: 'completed',
        stage_a_checklist: stageAChecklist,
        stage_a_completed_at: now,
        stage_b_started_at: stageBStartedAt || now,
        stage_b_visit_notes: stageBNotes,
        stage_c_checklist: stageCChecklist,
        customer_feedback: customerFeedback,
        interested_plot_name: interestedPlot,
        objections: objections,
        lead_crm_status: crmStatus,
        next_action: nextAction,
        next_follow_up_date: nextFollowUpDate ? new Date(nextFollowUpDate).toISOString() : null,
        stage_c_completed_at: now,
        created_at: now,
        updated_at: now
      };

      await supabase.from('house_visit_checklists').insert([checklistPayload]);

      // 2. Auto-Sync to public.leads table (if linked to a lead)
      if (lead?.id) {
        const combinedNotes = [
          lead.notes || '',
          customerFeedback ? `ความเห็นลูกค้า: ${customerFeedback}` : '',
          objections ? `ข้อกังวล: ${objections}` : '',
          nextAction ? `Next Action: ${nextAction}` : ''
        ].filter(Boolean).join(' | ');

        const updateLeadPayload: any = {
          actual_visit_date: now,
          crm_status: crmStatus,
          auto_status: 'เข้าชมแล้ว',
          status: 'Visit',
          interested_plot_name: interestedPlot || lead.interested_plot_name,
          notes: combinedNotes
        };

        if (nextFollowUpDate) {
          updateLeadPayload.last_follow_up_date = now;
          updateLeadPayload.follow_up_count = (lead.follow_up_count || 0) + 1;
        }

        await supabase.from('leads').update(updateLeadPayload).eq('id', lead.id);
      }

      alert('✅ บันทึก Checklist พาชมบ้านและอัปเดตข้อมูลลูกค้าสำเร็จ!');
      if (onSaved) onSaved();
      onClose();
    } catch (err) {
      console.error('Error completing checklist:', err);
      alert('บันทึก Checklist ไม่สำเร็จ โปรดลองอีกครั้ง');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-md flex items-center justify-center p-2 sm:p-4 animate-fade-in overflow-y-auto">
      <div className="bg-white rounded-3xl max-w-3xl w-full shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh]">
        
        {/* 🌟 Header & Stepper */}
        <div className="bg-slate-900 text-white p-4 sm:p-5 border-b border-slate-800 shrink-0">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-indigo-500/20 text-indigo-400 rounded-xl border border-indigo-500/30">
                <Home size={20} />
              </div>
              <div>
                <h2 className="text-base sm:text-lg font-black tracking-tight text-white flex items-center gap-2">
                  Sales & House Visit Checklist (SOP พาชมบ้าน)
                </h2>
                <p className="text-xs text-slate-400">
                  โครงการ: <span className="text-indigo-300 font-bold">{projectName}</span> | ผู้ตรวจ: <span className="text-slate-200 font-semibold">{agentName}</span>
                </p>
              </div>
            </div>
            <button 
              onClick={onClose}
              className="text-slate-400 hover:text-white p-1.5 rounded-xl hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <X size={20} />
            </button>
          </div>

          {/* Stepper Tabs */}
          <div className="grid grid-cols-3 gap-2 bg-slate-800/80 p-1.5 rounded-2xl text-xs font-bold">
            <button
              onClick={() => setCurrentStage('stage_a')}
              className={`py-2 px-3 rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                currentStage === 'stage_a' 
                  ? 'bg-emerald-600 text-white shadow-md' 
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span className="w-5 h-5 rounded-full bg-black/20 flex items-center justify-center text-[10px]">A</span>
              <span className="truncate">1. ก่อนเข้าชม ({checkedStageACount}/{totalStageAItems})</span>
            </button>

            <button
              onClick={() => setCurrentStage('stage_b')}
              className={`py-2 px-3 rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                currentStage === 'stage_b' 
                  ? 'bg-blue-600 text-white shadow-md' 
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span className="w-5 h-5 rounded-full bg-black/20 flex items-center justify-center text-[10px]">B</span>
              <span className="truncate">2. รับลูกค้าหน้างาน</span>
            </button>

            <button
              onClick={() => setCurrentStage('stage_c')}
              className={`py-2 px-3 rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                currentStage === 'stage_c' 
                  ? 'bg-purple-600 text-white shadow-md' 
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span className="w-5 h-5 rounded-full bg-black/20 flex items-center justify-center text-[10px]">C</span>
              <span className="truncate">3. หลังกลับ & Recap</span>
            </button>
          </div>
        </div>

        {/* 📋 Modal Content Area */}
        <div className="p-4 sm:p-6 overflow-y-auto flex-1 space-y-6 text-slate-800">
          
          {/* Customer / House Details Card */}
          <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2">
              <User size={16} className="text-slate-400" />
              <span className="text-slate-500 font-semibold">ลูกค้า:</span>
              <strong className="text-slate-800 font-black text-sm">{customerName || 'ลูกค้าทั่วไป (Walk-in)'}</strong>
              {lead?.phone && <span className="text-slate-500 font-mono">({lead.phone})</span>}
            </div>

            <div className="flex items-center gap-2">
              <Home size={16} className="text-indigo-600" />
              <span className="text-slate-500 font-semibold">บ้าน/แปลงที่พาชม:</span>
              <select
                value={selectedHousePlot}
                onChange={e => setSelectedHousePlot(e.target.value)}
                className="bg-white border border-slate-300 rounded-lg px-2.5 py-1 text-xs font-bold text-slate-700"
              >
                <option value="">-- เลือกแปลง/บ้านตัวอย่าง --</option>
                {plots.map((p: any) => (
                  <option key={p.id} value={p.plot_name || p.id}>
                    {p.plot_name || p.id} ({p.sale_status || 'บ้านตัวอย่าง'})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* 🟢 STAGE A: PRE-VISIT CHECKLIST */}
          {currentStage === 'stage_a' && (
            <div className="space-y-5 animate-fade-in">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-black text-sm text-emerald-900 flex items-center gap-1.5">
                    <ShieldCheck size={18} className="text-emerald-600" />
                    Stage A — รายการตรวจความพร้อมก่อนลูกค้าเข้าชม (16 รายการ)
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    ตรวจสอบความเรียบร้อยตามมาตรฐาน SOP ของโครงการ
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleCheckAllStageA}
                  className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-300 font-bold px-3 py-1.5 rounded-xl text-xs flex items-center gap-1 transition-colors cursor-pointer"
                >
                  <CheckCircle size={14} /> ติ๊กครบทุกข้อ
                </button>
              </div>

              {/* Checklist Categories */}
              <div className="space-y-4">
                {STAGE_A_CATEGORIES.map(cat => (
                  <div key={cat.id} className="border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
                    <div className="bg-slate-100/80 px-4 py-2.5 border-b border-slate-200 flex justify-between items-center">
                      <span className="font-black text-xs text-slate-800">{cat.title}</span>
                      <span className="text-[11px] text-slate-500 font-semibold">{cat.description}</span>
                    </div>
                    <div className="p-3 grid grid-cols-1 sm:grid-cols-2 gap-2 bg-white">
                      {cat.items.map(item => {
                        const isChecked = !!stageAChecklist[item.id];
                        return (
                          <div
                            key={item.id}
                            onClick={() => toggleStageA(item.id)}
                            className={`flex items-center gap-2.5 p-2.5 rounded-xl border transition-all cursor-pointer select-none text-xs font-semibold ${
                              isChecked 
                                ? 'bg-emerald-50/80 border-emerald-300 text-emerald-900' 
                                : 'bg-white border-slate-200 hover:bg-slate-50 text-slate-700'
                            }`}
                          >
                            <div className={`shrink-0 ${isChecked ? 'text-emerald-600' : 'text-slate-300'}`}>
                              {isChecked ? <CheckSquare size={17} /> : <Square size={17} />}
                            </div>
                            <span className={isChecked ? 'line-through text-emerald-800 font-normal' : ''}>
                              {item.label}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

              {/* Stage A Footer Action */}
              <div className="pt-2 flex justify-between items-center border-t border-slate-100">
                <span className="text-xs font-bold text-slate-500">
                  ความพร้อม: <strong className={isStageAComplete ? 'text-emerald-600' : 'text-slate-700'}>{checkedStageACount} / {totalStageAItems} รายการ</strong>
                </span>
                <button
                  type="button"
                  onClick={handleProceedToStageB}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-black px-5 py-2.5 rounded-xl text-xs flex items-center gap-2 shadow-md shadow-emerald-600/20 transition-all cursor-pointer"
                >
                  พร้อมรับลูกค้า ➡️ เข้าสู่ Stage B <ArrowRight size={15} />
                </button>
              </div>
            </div>
          )}

          {/* 🔵 STAGE B: IN-VISIT (RECEIVING CUSTOMER) */}
          {currentStage === 'stage_b' && (
            <div className="space-y-5 animate-fade-in">
              <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="space-y-1">
                  <h3 className="font-black text-sm text-blue-900 flex items-center gap-2">
                    <User size={18} className="text-blue-600" />
                    Stage B — ขั้นตอนรับลูกค้า (Customer On-Site)
                  </h3>
                  <p className="text-xs text-blue-700">
                    เปิดแบบฟอร์มบันทึกความสนใจหรือแบบสอบถามดิจิทัลบนแท็บเล็ต/มือถือ
                  </p>
                </div>
                {lead && onOpenSurvey && (
                  <button
                    type="button"
                    onClick={() => onOpenSurvey(lead)}
                    className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2 rounded-xl text-xs flex items-center gap-1.5 shadow-sm shrink-0 cursor-pointer"
                  >
                    <FileText size={14} /> เปิดแบบสอบถาม Customer Voices (42 ข้อ)
                  </button>
                )}
              </div>

              {/* In-tour notes */}
              <div className="space-y-2">
                <label className="block text-xs font-bold text-slate-700">
                  📝 บันทึกระหว่างพาชมบ้าน / ข้อสังเกตความชอบของลูกค้า
                </label>
                <textarea
                  rows={4}
                  value={stageBNotes}
                  onChange={e => setStageBNotes(e.target.value)}
                  placeholder="เช่น ลูกค้าชอบห้องนั่งเล่นโปร่งโล่ง แฟนชอบครัวไทย สนใจแปลงมุมติดสวน..."
                  className="w-full bg-slate-50 border border-slate-300 rounded-2xl p-3.5 text-xs font-medium focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>

              {/* Stage B Footer Action */}
              <div className="pt-2 flex justify-between items-center border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setCurrentStage('stage_a')}
                  className="px-4 py-2 border border-slate-300 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 flex items-center gap-1.5 cursor-pointer"
                >
                  <ArrowLeft size={14} /> ย้อนกลับ Stage A
                </button>
                <button
                  type="button"
                  onClick={handleProceedToStageC}
                  className="bg-blue-600 hover:bg-blue-700 text-white font-black px-5 py-2.5 rounded-xl text-xs flex items-center gap-2 shadow-md shadow-blue-600/20 transition-all cursor-pointer"
                >
                  ลูกค้าเดินทางกลับ ➡️ เข้าสู่ Stage C (ปิดบ้าน & Recap) <ArrowRight size={15} />
                </button>
              </div>
            </div>
          )}

          {/* 🟣 STAGE C: POST-VISIT SHUTDOWN & SALES RECAP */}
          {currentStage === 'stage_c' && (
            <div className="space-y-5 animate-fade-in">
              <div>
                <h3 className="font-black text-sm text-purple-900 flex items-center gap-1.5">
                  <Sparkles size={18} className="text-purple-600" />
                  Stage C — หลังลูกค้ากลับ (Post-Visit Shutdown & CRM Recap)
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  ตรวจปิดบ้านตัวอย่างตาม SOP และบันทึกสรุปผลการขายเข้าสู่ระบบ Lead Tracker ทันที
                </p>
              </div>

              {/* Part 1: House Shutdown Checklist */}
              <div className="border border-purple-200 rounded-2xl overflow-hidden">
                <div className="bg-purple-50 px-4 py-2.5 border-b border-purple-200 flex justify-between items-center">
                  <span className="font-black text-xs text-purple-900">🔒 รายการตรวจปิดบ้าน & อุปกรณ์ ({checkedStageCCount}/{totalStageCItems})</span>
                  <button
                    type="button"
                    onClick={handleCheckAllStageC}
                    className="text-[11px] text-purple-700 hover:text-purple-900 font-bold underline cursor-pointer"
                  >
                    ติ๊กครบทุกข้อ
                  </button>
                </div>
                <div className="p-3 grid grid-cols-1 sm:grid-cols-2 gap-2 bg-white">
                  {STAGE_C_SHUTDOWN_ITEMS.map(item => {
                    const isChecked = !!stageCChecklist[item.id];
                    return (
                      <div
                        key={item.id}
                        onClick={() => toggleStageC(item.id)}
                        className={`flex items-center gap-2.5 p-2.5 rounded-xl border transition-all cursor-pointer select-none text-xs font-semibold ${
                          isChecked 
                            ? 'bg-purple-50/80 border-purple-300 text-purple-900' 
                            : 'bg-white border-slate-200 hover:bg-slate-50 text-slate-700'
                        }`}
                      >
                        <div className={`shrink-0 ${isChecked ? 'text-purple-600' : 'text-slate-300'}`}>
                          {isChecked ? <CheckSquare size={17} /> : <Square size={17} />}
                        </div>
                        <span className={isChecked ? 'line-through text-purple-800 font-normal' : ''}>
                          {item.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Part 2: Sales Recap & Lead Tracker Auto-Sync */}
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-4">
                <h4 className="font-black text-xs text-slate-800 flex items-center gap-1.5">
                  <FileText size={15} className="text-blue-600" />
                  สรุปผลการขาย (Auto-Sync ไปยัง Lead Tracker)
                </h4>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">🏡 แปลง/บ้านที่ลูกค้าสนใจ</label>
                    <input
                      type="text"
                      value={interestedPlot}
                      onChange={e => setInterestedPlot(e.target.value)}
                      placeholder="เช่น A1, B5"
                      className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 font-bold text-slate-800 focus:ring-2 focus:ring-purple-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 mb-1">📊 อัปเดต CRM Status</label>
                    <select
                      value={crmStatus}
                      onChange={e => setCrmStatus(e.target.value as CRMStatus)}
                      className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 font-bold text-purple-900 focus:ring-2 focus:ring-purple-500 focus:outline-none"
                    >
                      {CRM_STATUS_OPTIONS.map(s => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block font-bold text-slate-700 mb-1">💬 ความเห็น / ความประทับใจของลูกค้า (Customer Feedback)</label>
                    <textarea
                      rows={2}
                      value={customerFeedback}
                      onChange={e => setCustomerFeedback(e.target.value)}
                      placeholder="เช่น ลูกค้าชอบดีไซน์หน้าบ้านและฟังก์ชันห้องนอนล่างมาก ชมว่าโครงการเงียบสงบ..."
                      className="w-full bg-white border border-slate-300 rounded-xl p-2.5 font-medium text-slate-800 focus:ring-2 focus:ring-purple-500 focus:outline-none"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block font-bold text-slate-700 mb-1">⚠️ ข้อโต้แย้ง / ข้อกังวล (Objection)</label>
                    <textarea
                      rows={2}
                      value={objections}
                      onChange={e => setObjections(e.target.value)}
                      placeholder="เช่น ลูกค้ากังวลเรื่องวงเงินกู้ธนาคาร และต้องการเทียบกับโครงการคู่แข่งแถวสันทราย..."
                      className="w-full bg-white border border-slate-300 rounded-xl p-2.5 font-medium text-slate-800 focus:ring-2 focus:ring-purple-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 mb-1">🎯 Next Action (สิ่งที่เซลล์ต้องทำต่อ)</label>
                    <input
                      type="text"
                      value={nextAction}
                      onChange={e => setNextAction(e.target.value)}
                      placeholder="เช่น ส่งตารางคำนวณยอดผ่อน, ส่งโปรโมชั่นเพิ่มทาง Line"
                      className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 font-medium text-slate-800 focus:ring-2 focus:ring-purple-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 mb-1">📅 วันที่นัดหมายติดตามผลถัดไป (Next Follow-up)</label>
                    <input
                      type="date"
                      value={nextFollowUpDate}
                      onChange={e => setNextFollowUpDate(e.target.value)}
                      className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 font-medium text-slate-800 focus:ring-2 focus:ring-purple-500 focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              {/* Stage C Footer Action */}
              <div className="pt-2 flex justify-between items-center border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setCurrentStage('stage_b')}
                  className="px-4 py-2 border border-slate-300 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 flex items-center gap-1.5 cursor-pointer"
                >
                  <ArrowLeft size={14} /> ย้อนกลับ Stage B
                </button>
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={handleCompleteChecklist}
                  className="bg-purple-600 hover:bg-purple-700 text-white font-black px-6 py-2.5 rounded-xl text-xs flex items-center gap-2 shadow-lg shadow-purple-600/30 transition-all cursor-pointer disabled:opacity-50"
                >
                  {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                  เสร็จสิ้น SOP & บันทึกเข้า Lead Tracker
                </button>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
