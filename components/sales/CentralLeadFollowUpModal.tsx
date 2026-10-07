'use client';

import React, { useState, useEffect } from 'react';
import { 
  X, Phone, MessageSquare, UserCheck, Calendar, Clock, 
  Building2, User, FileText, CheckCircle2, AlertCircle, Loader2,
  History, ArrowRight, PhoneCall, PhoneOff, Clock3, PlusCircle
} from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface ActivityItem {
  id: string;
  activity_type: string;
  result?: string;
  note?: string;
  occurred_at: string;
  recorded_by?: string;
  next_follow_up_at?: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  customer: {
    id: string;
    name: string;
    phone?: string | null;
    channel?: string | null;
    notes?: string | null;
    status?: string | null;
    ownerUserId?: string;
    salesOwner?: string | null;
  } | null;
  initialInterest?: {
    id?: string;
    projectName?: string;
    plotId?: string | null;
    ownerUserId?: string;
  } | null;
  projects: string[];
  salesOwners: { userId: string; displayName: string }[];
  onSaved?: (notice: string) => void;
}

export default function CentralLeadFollowUpModal({
  isOpen,
  onClose,
  customer,
  initialInterest,
  projects = [],
  salesOwners = [],
  onSaved
}: Props) {
  const [projectName, setProjectName] = useState('');
  const [channel, setChannel] = useState<'call' | 'chat' | 'follow_up' | 'note'>('call');
  const [result, setResult] = useState<'contact_success' | 'customer_requested_later' | 'no_answer' | 'other'>('contact_success');
  const [leadStatus, setLeadStatus] = useState('Follow Up');
  const [notes, setNotes] = useState('');
  const [hasSchedule, setHasSchedule] = useState(false);
  const [nextDate, setNextDate] = useState('');
  const [nextTime, setNextTime] = useState('10:00');
  const [agentName, setAgentName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  
  // History state
  const [historyList, setHistoryList] = useState<ActivityItem[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [activeTab, setActiveTab] = useState<'form' | 'history'>('form');

  // Initialize defaults on open
  useEffect(() => {
    if (isOpen && customer) {
      setErrorMsg('');
      setActiveTab('form');
      setChannel('call');
      setResult('contact_success');
      setLeadStatus(customer.status || 'Follow Up');
      setNotes('');
      setHasSchedule(false);

      // Default next date in 3 days
      const d = new Date();
      d.setDate(d.getDate() + 3);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      setNextDate(`${yyyy}-${mm}-${dd}`);
      setNextTime('10:00');

      const proj = initialInterest?.projectName || (projects.length > 0 ? projects[0] : '');
      setProjectName(proj);

      const initialOwnerId = initialInterest?.ownerUserId || customer.ownerUserId;
      const ownerObj = salesOwners.find(o => o.userId === initialOwnerId);
      setAgentName(ownerObj?.displayName || customer.salesOwner || salesOwners[0]?.displayName || 'Sales');

      // Load history
      loadHistory(customer.id);
    }
  }, [isOpen, customer, initialInterest, projects, salesOwners]);

  const loadHistory = async (customerId: string) => {
    setLoadingHistory(true);
    try {
      const { data, error } = await supabase
        .from('lead_activities')
        .select('*')
        .eq('customer_id', customerId)
        .order('occurred_at', { ascending: false })
        .limit(20);

      if (!error && data) {
        setHistoryList(data);
      } else {
        setHistoryList([]);
      }
    } catch {
      setHistoryList([]);
    } finally {
      setLoadingHistory(false);
    }
  };

  if (!isOpen || !customer) return null;

  const getChannelLabel = (ch: string) => {
    switch (ch) {
      case 'call': return '📞 โทรศัพท์';
      case 'chat': return '💬 LINE / แชท';
      case 'follow_up': return '🤝 พบตัว / ติดตาม';
      case 'note': return '📝 โน้ตบันทึก';
      default: return ch;
    }
  };

  const getResultLabel = (res: string) => {
    switch (res) {
      case 'contact_success': return '✅ ติดต่อสำเร็จ / สนใจ';
      case 'customer_requested_later': return '⏳ ขอติดต่อกลับภายหลัง';
      case 'no_answer': return '📵 ไม่รับสาย / ไม่สะดวก';
      case 'other': return '⚪ อื่นๆ';
      default: return res;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!notes.trim()) {
      setErrorMsg('กรุณาระบุรายละเอียดการติดตามหรือสิ่งที่ได้พูดคุยกับลูกค้า');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg('');

    try {
      const now = new Date();
      const timeBangkokStr = now.toLocaleDateString('th-TH', { 
        day: '2-digit', month: 'short', year: 'numeric', 
        hour: '2-digit', minute: '2-digit' 
      });

      const nextFollowUpAt = hasSchedule && nextDate 
        ? `${nextDate}T${nextTime || '10:00'}:00+07:00`
        : null;

      // 1. Try to record in lead_activities table
      try {
        await supabase
          .from('lead_activities')
          .insert([{
            customer_id: customer.id,
            activity_type: channel,
            result: result,
            occurred_at: now.toISOString(),
            note: notes.trim(),
            next_follow_up_at: nextFollowUpAt
          }]);
      } catch (err) {
        console.warn('Could not insert to lead_activities (schema or RLS policy), falling back to leads update:', err);
      }

      // 2. Prepare timestamped summary notes for customer profile
      const newEntryHeader = `[${timeBangkokStr} โดย ${agentName} (${getChannelLabel(channel)}: ${getResultLabel(result)})]`;
      const scheduleHeader = hasSchedule && nextDate ? `\n➡️ นัดติดตามต่อ: ${nextDate} ${nextTime}` : '';
      const formattedNote = `${newEntryHeader}\n${notes.trim()}${scheduleHeader}`;
      
      const combinedNotes = customer.notes 
        ? `${formattedNote}\n\n---\n${customer.notes}` 
        : formattedNote;

      // 3. Update main leads table in Supabase
      const { error: updateError } = await supabase
        .from('leads')
        .update({
          status: leadStatus,
          auto_status: `ติดตาม: ${getResultLabel(result)}`,
          notes: combinedNotes,
          sales_owner: agentName,
          updated_at: now.toISOString()
        })
        .eq('id', customer.id);

      if (updateError) {
        throw new Error(updateError.message || 'บันทึกข้อมูลลงฐานข้อมูลไม่สำเร็จ');
      }

      const successNotice = `บันทึกการติดตามลูกค้า "${customer.name}" สำเร็จแล้ว (${getResultLabel(result)})`;
      if (onSaved) onSaved(successNotice);
      onClose();
    } catch (err: any) {
      console.error('Error saving follow-up:', err);
      setErrorMsg(err.message || 'เกิดข้อผิดพลาดในการบันทึก กรุณาลองใหม่อีกครั้ง');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-3 sm:p-6 bg-slate-950/70 backdrop-blur-xs animate-in fade-in duration-200">
      <div 
        className="relative w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-slate-100 overflow-hidden flex flex-col max-h-[88vh] my-auto animate-in zoom-in-95 duration-200"
        role="dialog"
        aria-modal="true"
        aria-labelledby="followup-modal-title"
      >
        {/* Unified Sticky Header */}
        <div className="sticky top-0 z-20 bg-white/95 backdrop-blur-sm border-b border-slate-100 shrink-0">
          <div className="flex items-center justify-between px-5 sm:px-6 py-3.5 sm:py-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-sm shadow-blue-200 shrink-0">
                <MessageSquare size={20} />
              </div>
              <div>
                <h3 id="followup-modal-title" className="text-base font-bold text-slate-800 flex items-center gap-2">
                  บันทึกการติดตามลูกค้า (Follow-up)
                </h3>
                <p className="text-xs text-slate-500 font-medium">
                  บันทึกประวัติการติดต่อ ผลการคุย และวางแผนงานติดตาม
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="ปิดหน้าต่าง"
              className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
            >
              <X size={18} />
            </button>
          </div>

          {/* Customer Summary Banner & Tabs */}
          <div className="px-5 sm:px-6 py-2.5 bg-slate-50 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2.5 text-xs">
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="font-bold text-slate-800 text-sm">{customer.name}</span>
              {customer.phone && (
                <span className="text-slate-600 flex items-center gap-1 font-mono bg-white px-2 py-0.5 rounded-md border border-slate-200 text-xs">
                  <Phone size={12} className="text-blue-500" /> {customer.phone}
                </span>
              )}
              {customer.channel && (
                <span className="text-slate-500 bg-slate-200/70 px-2 py-0.5 rounded-md font-medium text-[11px]">
                  ช่องทาง: {customer.channel}
                </span>
              )}
            </div>

            {/* Tab Switcher */}
            <div className="flex items-center gap-1 bg-slate-200/80 p-0.5 rounded-lg shrink-0">
            <button
              type="button"
              onClick={() => setActiveTab('form')}
              className={`px-2.5 py-1 rounded-md font-bold text-[11px] transition-all ${
                activeTab === 'form' 
                  ? 'bg-white text-blue-700 shadow-2xs' 
                  : 'text-slate-600 hover:text-slate-800'
              }`}
            >
              + บันทึกครั้งใหม่
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('history')}
              className={`px-2.5 py-1 rounded-md font-bold text-[11px] transition-all flex items-center gap-1 ${
                activeTab === 'history' 
                  ? 'bg-white text-blue-700 shadow-2xs' 
                  : 'text-slate-600 hover:text-slate-800'
              }`}
            >
              <History size={12} /> ประวัติ ({historyList.length})
            </button>
          </div>
        </div>
      </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-4">
          {errorMsg && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 font-medium flex items-start gap-2 animate-in fade-in">
              <AlertCircle size={16} className="text-rose-500 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {activeTab === 'history' ? (
            /* History Tab View */
            <div className="space-y-3">
              <h4 className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                <History size={14} className="text-blue-600" /> ประวัติการติดตามและการติดต่อที่ผ่านมา
              </h4>
              {loadingHistory ? (
                <div className="py-12 flex flex-col items-center justify-center text-slate-400 gap-2">
                  <Loader2 size={24} className="animate-spin text-blue-600" />
                  <span className="text-xs">กำลังโหลดประวัติ...</span>
                </div>
              ) : historyList.length > 0 ? (
                <div className="space-y-2.5">
                  {historyList.map(item => (
                    <div key={item.id} className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-1.5 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-800 flex items-center gap-1.5">
                          {getChannelLabel(item.activity_type)}
                          <span className="font-normal text-slate-400">·</span>
                          <span className="text-blue-700 font-semibold">{getResultLabel(item.result || '')}</span>
                        </span>
                        <span className="text-[11px] text-slate-400 font-mono">
                          {new Date(item.occurred_at).toLocaleDateString('th-TH', {
                            day: '2-digit', month: 'short', year: 'numeric',
                            hour: '2-digit', minute: '2-digit'
                          })}
                        </span>
                      </div>
                      {item.note && (
                        <p className="text-slate-600 bg-white p-2.5 rounded-lg border border-slate-100 whitespace-pre-wrap">
                          {item.note}
                        </p>
                      )}
                      {item.next_follow_up_at && (
                        <div className="text-[11px] text-amber-700 font-medium flex items-center gap-1">
                          <Clock3 size={12} /> นัดหมายติดตามต่อ: {new Date(item.next_follow_up_at).toLocaleString('th-TH')}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-10 text-center text-slate-400 text-xs border border-dashed border-slate-200 rounded-xl space-y-2">
                  <p>ยังไม่มีรายการบันทึกในระบบกิจกรรม</p>
                  {customer.notes && (
                    <div className="max-w-lg mx-auto text-left bg-slate-50 p-3 rounded-lg border border-slate-200 text-slate-600 text-xs whitespace-pre-wrap">
                      <strong className="block text-slate-700 mb-1">โน้ตประวัติเดิมของลูกค้า:</strong>
                      {customer.notes}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            /* Form Tab View */
            <form id="followup-form" onSubmit={handleSubmit} className="space-y-4">
              {/* Channel Selector */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  ช่องทางการติดต่อ <span className="text-rose-500">*</span>
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <button
                    type="button"
                    onClick={() => setChannel('call')}
                    className={`py-2 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                      channel === 'call'
                        ? 'bg-blue-50 border-blue-400 text-blue-800 shadow-2xs'
                        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <PhoneCall size={14} className={channel === 'call' ? 'text-blue-600' : 'text-slate-400'} />
                    โทรศัพท์
                  </button>
                  <button
                    type="button"
                    onClick={() => setChannel('chat')}
                    className={`py-2 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                      channel === 'chat'
                        ? 'bg-emerald-50 border-emerald-400 text-emerald-800 shadow-2xs'
                        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <MessageSquare size={14} className={channel === 'chat' ? 'text-emerald-600' : 'text-slate-400'} />
                    LINE / แชท
                  </button>
                  <button
                    type="button"
                    onClick={() => setChannel('follow_up')}
                    className={`py-2 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                      channel === 'follow_up'
                        ? 'bg-indigo-50 border-indigo-400 text-indigo-800 shadow-2xs'
                        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <UserCheck size={14} className={channel === 'follow_up' ? 'text-indigo-600' : 'text-slate-400'} />
                    พบตัว / ติดตาม
                  </button>
                  <button
                    type="button"
                    onClick={() => setChannel('note')}
                    className={`py-2 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                      channel === 'note'
                        ? 'bg-amber-50 border-amber-400 text-amber-800 shadow-2xs'
                        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <FileText size={14} className={channel === 'note' ? 'text-amber-600' : 'text-slate-400'} />
                    บันทึกโน้ต
                  </button>
                </div>
              </div>

              {/* Result & Lead Status Row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">
                    ผลการติดต่อ <span className="text-rose-500">*</span>
                  </label>
                  <select
                    value={result}
                    onChange={(e) => setResult(e.target.value as any)}
                    className="w-full text-xs font-medium bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white"
                  >
                    <option value="contact_success">✅ ติดต่อสำเร็จ / สนใจ</option>
                    <option value="customer_requested_later">⏳ ขอให้ติดต่อกลับภายหลัง</option>
                    <option value="no_answer">📵 ไม่รับสาย / ไม่สะดวกคุย</option>
                    <option value="other">⚪ อื่น ๆ</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">
                    ปรับสถานะ Lead
                  </label>
                  <select
                    value={leadStatus}
                    onChange={(e) => setLeadStatus(e.target.value)}
                    className="w-full text-xs font-medium bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white"
                  >
                    <option value="Follow Up">🟢 Follow Up (กำลังติดตามงาน)</option>
                    <option value="Contacted">🟢 Contacted (ติดต่อแล้ว)</option>
                    <option value="Interested">🔥 Interested (สนใจมาก)</option>
                    <option value="Unqualified">💤 Unqualified (ไม่สนใจ / ยกเลิกติดตาม)</option>
                    <option value="Nurture">💤 Nurture (พักการติดต่อ / Cold Lead)</option>
                  </select>
                </div>
              </div>

              {/* Quick reason pills when marking as Unqualified / Nurture */}
              {(leadStatus === 'Unqualified' || leadStatus === 'Nurture') && (
                <div className="p-3 bg-amber-50/80 border border-amber-200 rounded-xl space-y-2 animate-in fade-in">
                  <span className="text-[11px] font-bold text-amber-900 block">
                    คลิกเพื่อใส่เหตุผลด่วนในบันทึก:
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      '🏷️ งบประมาณไม่พอ / กู้ไม่ผ่าน',
                      '🏡 แบบบ้าน/ทำเลไม่ตรงสเปก',
                      '🤝 ไปซื้อโครงการอื่นแล้ว',
                      '⏳ ยังไม่มีแผนซื้อในระยะนี้ (พักติดตาม 1 ปี)'
                    ].map((reasonText) => (
                      <button
                        key={reasonText}
                        type="button"
                        onClick={() => {
                          setNotes(prev => prev.trim() ? `${prev}\n• เหตุผล: ${reasonText}` : `• เหตุผล: ${reasonText}`);
                        }}
                        className="text-[10px] font-semibold bg-white hover:bg-amber-100 text-amber-900 border border-amber-300 rounded-lg px-2 py-1 transition-colors cursor-pointer"
                      >
                        {reasonText}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Target Project & Sales Owner */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5 flex items-center gap-1">
                    <Building2 size={13} className="text-blue-500" /> โครงการที่เกี่ยวข้อง
                  </label>
                  <select
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    className="w-full text-xs font-medium bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white"
                  >
                    <option value="">ส่วนกลาง / ทั่วไป</option>
                    {projects.map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5 flex items-center gap-1">
                    <User size={13} className="text-indigo-500" /> ผู้บันทึก / Sales ผู้ดูแล
                  </label>
                  <select
                    value={agentName}
                    onChange={(e) => setAgentName(e.target.value)}
                    className="w-full text-xs font-medium bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white"
                  >
                    {salesOwners.length > 0 ? (
                      salesOwners.map(o => (
                        <option key={o.userId} value={o.displayName}>{o.displayName}</option>
                      ))
                    ) : (
                      <option value="Sales">Sales</option>
                    )}
                  </select>
                </div>
              </div>

              {/* Follow-up Notes Textarea */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  รายละเอียดที่คุย / บันทึกการติดตาม <span className="text-rose-500">*</span>
                </label>
                <textarea
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="พิมพ์ข้อความสรุปการสนทนา เช่น สอบถามความพร้อมเรื่องเอกสาร สนใจบ้านแปลงมุม ลูกค้าสะดวกให้ติดต่อกลับ..."
                  className="w-full text-xs font-normal bg-slate-50 border border-slate-200 rounded-xl p-3 text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white"
                />
              </div>

              {/* Optional Next Follow-up Schedule */}
              <div className="p-3.5 bg-slate-50 border border-slate-200/80 rounded-xl space-y-2.5">
                <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={hasSchedule}
                    onChange={(e) => setHasSchedule(e.target.checked)}
                    className="rounded text-blue-600 focus:ring-blue-500"
                  />
                  <span>⏰ วางแผนนัดติดตามงานรอบถัดไป (Next Action / Due Date)</span>
                </label>

                {hasSchedule && (
                  <div className="grid grid-cols-2 gap-3 pt-1 animate-in fade-in">
                    <div>
                      <span className="block text-[11px] text-slate-500 font-medium mb-1">วันที่ต้องตามงาน:</span>
                      <input
                        type="date"
                        value={nextDate}
                        onChange={(e) => setNextDate(e.target.value)}
                        className="w-full text-xs font-medium bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-800 focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <span className="block text-[11px] text-slate-500 font-medium mb-1">เวลา:</span>
                      <input
                        type="time"
                        value={nextTime}
                        onChange={(e) => setNextTime(e.target.value)}
                        className="w-full text-xs font-medium bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-800 focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                )}
              </div>
            </form>
          )}
        </div>

        {/* Sticky Footer Actions */}
        <div className="sticky bottom-0 z-20 px-5 sm:px-6 py-3.5 border-t border-slate-100 bg-slate-50/95 backdrop-blur-sm flex items-center justify-end gap-2.5 shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="px-4 py-2 text-xs font-bold text-slate-600 hover:text-slate-800 bg-white border border-slate-200 rounded-xl hover:bg-slate-100 transition-colors disabled:opacity-50 cursor-pointer"
          >
            ปิด
          </button>
          {activeTab === 'form' && (
            <button
              type="submit"
              form="followup-form"
              disabled={isSubmitting}
              className="px-5 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl shadow-sm transition-all flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
            >
              {isSubmitting ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  กำลังบันทึก...
                </>
              ) : (
                <>
                  <CheckCircle2 size={14} />
                  บันทึกการติดตาม
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
