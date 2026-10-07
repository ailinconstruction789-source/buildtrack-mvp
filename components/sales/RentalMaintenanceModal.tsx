"use client";

import React, { useState, useEffect } from 'react';
import { 
  Wrench, 
  XCircle, 
  Plus, 
  CheckCircle2, 
  Clock, 
  AlertTriangle, 
  DollarSign, 
  User, 
  Home, 
  Loader2,
  Calendar,
  FileText,
  ShieldCheck,
  Tag
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { RentalMaintenanceTicket, Lead } from '@/types/sales';

interface RentalMaintenanceModalProps {
  isOpen: boolean;
  onClose: () => void;
  plotId?: string | null;
  plotName?: string | null;
  projectName?: string;
  lead?: Lead | null;
  user?: any;
  onSaved?: () => void;
}

export default function RentalMaintenanceModal({
  isOpen,
  onClose,
  plotId,
  plotName,
  projectName = 'ไอลิน สันทราย 2',
  lead,
  user,
  onSaved
}: RentalMaintenanceModalProps) {
  const [tickets, setTickets] = useState<RentalMaintenanceTicket[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Form State
  const [category, setCategory] = useState<RentalMaintenanceTicket['category']>('plumbing');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<RentalMaintenanceTicket['priority']>('medium');
  const [assignedTo, setAssignedTo] = useState('');
  const [estimatedCost, setEstimatedCost] = useState('0');
  const [actualCost, setActualCost] = useState('0');
  const [isTenantResponsible, setIsTenantResponsible] = useState(false);

  const targetPlotId = plotId || lead?.interested_plot_id || '';
  const targetPlotName = plotName || lead?.interested_plot_name || targetPlotId;
  const tenantName = lead?.customer_name || 'ผู้เช่า';
  const tenantPhone = lead?.phone || '';

  const fetchTickets = async () => {
    if (!targetPlotId && !lead?.id) return;
    setLoading(true);
    try {
      let query = supabase.from('rental_maintenance_tickets').select('*');
      if (targetPlotId) {
        query = query.eq('plot_id', targetPlotId);
      } else if (lead?.id) {
        query = query.eq('lead_id', lead.id);
      }

      const { data, error } = await query.order('created_at', { ascending: false });
      if (!error && data) {
        setTickets(data as RentalMaintenanceTicket[]);
      }
    } catch (err) {
      console.warn('Notice loading maintenance tickets:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchTickets();
      setShowAddForm(false);
    }
  }, [isOpen, targetPlotId, lead?.id]);

  if (!isOpen) return null;

  const handleCreateTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setErrorMsg('กรุณาระบุหัวข้อการแจ้งซ่อม');
      return;
    }
    setSubmitting(true);
    setErrorMsg(null);

    try {
      const now = new Date().toISOString();
      const payload: Partial<RentalMaintenanceTicket> = {
        plot_id: targetPlotId,
        plot_name: targetPlotName,
        project_name: projectName,
        lead_id: lead?.id || null,
        tenant_name: tenantName,
        tenant_phone: tenantPhone || undefined,
        category,
        title: title.trim(),
        description: description.trim() || undefined,
        priority,
        status: 'Reported',
        assigned_to: assignedTo.trim() || undefined,
        estimated_cost: parseFloat(estimatedCost) || 0,
        actual_cost: parseFloat(actualCost) || 0,
        is_tenant_responsible: isTenantResponsible,
        reported_date: now.split('T')[0],
        created_at: now,
        updated_at: now
      };

      const { error } = await supabase.from('rental_maintenance_tickets').insert([payload]);
      if (error) throw error;

      setTitle('');
      setDescription('');
      setEstimatedCost('0');
      setIsTenantResponsible(false);
      setShowAddForm(false);
      await fetchTickets();
      if (onSaved) onSaved();
    } catch (err: any) {
      console.error('Error creating maintenance ticket:', err);
      setErrorMsg(err.message || 'เกิดข้อผิดพลาดในการบันทึกแจ้งซ่อม');
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateStatus = async (ticketId: string, newStatus: RentalMaintenanceTicket['status']) => {
    try {
      const now = new Date().toISOString();
      const updates: any = {
        status: newStatus,
        updated_at: now
      };
      if (newStatus === 'Completed') {
        updates.resolved_date = now.split('T')[0];
      }

      await supabase
        .from('rental_maintenance_tickets')
        .update(updates)
        .eq('id', ticketId);

      await fetchTickets();
      if (onSaved) onSaved();
    } catch (err) {
      console.error('Error updating ticket status:', err);
    }
  };

  return (
    <div className="fixed inset-0 z-[350] flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto animate-fade-in">
      <div className="bg-white rounded-3xl max-w-2xl w-full shadow-2xl border border-slate-200 overflow-hidden my-auto flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-blue-950 text-white px-6 py-5 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-blue-500/20 text-cyan-300 rounded-2xl border border-cyan-400/30">
              <Wrench size={22} className="animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-black text-lg text-white">
                  🔧 รายการแจ้งซ่อม & ดูแลบ้านเช่า
                </h3>
                <span className="text-[10px] bg-cyan-400/20 text-cyan-200 font-bold px-2 py-0.5 rounded-full border border-cyan-400/30">
                  แปลง {targetPlotName}
                </span>
              </div>
              <p className="text-xs text-blue-200/80 mt-0.5">
                ผู้เช่า: <b className="text-white">{tenantName}</b> ({tenantPhone || 'ไม่มีเบอร์'})
              </p>
            </div>
          </div>
          <button 
            type="button" 
            onClick={onClose} 
            className="text-white/70 hover:text-white transition-colors cursor-pointer"
          >
            <XCircle size={22} />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 sm:p-6 overflow-y-auto flex-1 space-y-4 text-xs">
          {errorMsg && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl flex items-center gap-2 font-medium">
              <AlertTriangle size={16} className="shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Toggle Add Form Button */}
          <div className="flex items-center justify-between">
            <div className="font-bold text-slate-700 flex items-center gap-1.5">
              <FileText size={15} className="text-slate-500" /> ประวัติการแจ้งซ่อม ({tickets.length} รายการ)
            </div>
            <button
              type="button"
              onClick={() => setShowAddForm(!showAddForm)}
              className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-3.5 py-1.5 rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
            >
              <Plus size={14} /> {showAddForm ? 'ปิดแบบฟอร์ม' : 'เปิดใบแจ้งซ่อมใหม่'}
            </button>
          </div>

          {/* Add Maintenance Ticket Form */}
          {showAddForm && (
            <form onSubmit={handleCreateTicket} className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3 animate-fade-in">
              <div className="font-bold text-slate-900 flex items-center gap-1.5 text-xs">
                <Plus size={14} className="text-blue-600" /> บันทึกการแจ้งซ่อม / ปัญหาที่พบ
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-bold mb-1">หมวดหมู่ปัญหา *</label>
                  <select
                    value={category}
                    onChange={(e: any) => setCategory(e.target.value)}
                    className="w-full bg-white border border-slate-300 rounded-xl p-2.5 font-bold focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  >
                    <option value="plumbing">🚰 ประปา / ปั๊มน้ำ / ท่อน้ำ</option>
                    <option value="air_conditioner">❄️ เครื่องปรับอากาศ (แอร์)</option>
                    <option value="electrical">⚡ ไฟฟ้า / หลอดไฟ / ปลั๊กไฟ</option>
                    <option value="structure">🏠 หลังคา / ผนัง / โครงสร้าง</option>
                    <option value="appliance">🔌 เครื่องใช้ไฟฟ้า / อุปกรณ์</option>
                    <option value="other">🛠️ อื่นๆ</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-700 font-bold mb-1">ระดับความเร่งด่วน</label>
                  <select
                    value={priority}
                    onChange={(e: any) => setPriority(e.target.value)}
                    className="w-full bg-white border border-slate-300 rounded-xl p-2.5 font-bold focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  >
                    <option value="low">🟢 ทั่วไป (Low)</option>
                    <option value="medium">🟡 ปานกลาง (Medium)</option>
                    <option value="high">🟠 เร่งด่วน (High)</option>
                    <option value="urgent">🔴 ด่วนมาก (Urgent)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">หัวข้อปัญหา *</label>
                <input
                  type="text"
                  required
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="เช่น แอร์ห้องนอนใหญ่ไม่เย็น, น้ำซึมใต้ซิงค์ครัว"
                  className="w-full bg-white border border-slate-300 rounded-xl p-2.5 font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">รายละเอียดเพิ่มเติม</label>
                <textarea
                  rows={2}
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="ระบุอาการ วันที่เริ่มพบปัญหา หรือเวลาที่สะดวกให้ช่างเข้าตรวจ..."
                  className="w-full bg-white border border-slate-300 rounded-xl p-2.5 font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-bold mb-1">ช่าง/ผู้รับผิดชอบ</label>
                  <input
                    type="text"
                    value={assignedTo}
                    onChange={e => setAssignedTo(e.target.value)}
                    placeholder="เช่น ช่างแอร์ไอลิน, โฟร์แมนสมหมาย"
                    className="w-full bg-white border border-slate-300 rounded-xl p-2.5 font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-bold mb-1">ประมาณการค่าใช้จ่าย (บาท)</label>
                  <input
                    type="number"
                    value={estimatedCost}
                    onChange={e => setEstimatedCost(e.target.value)}
                    className="w-full bg-white border border-slate-300 rounded-xl p-2.5 font-bold focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-xl flex items-center gap-2">
                <input
                  type="checkbox"
                  id="tenant-responsible-checkbox"
                  checked={isTenantResponsible}
                  onChange={e => setIsTenantResponsible(e.target.checked)}
                  className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 cursor-pointer"
                />
                <label htmlFor="tenant-responsible-checkbox" className="text-amber-950 font-bold text-[11px] cursor-pointer">
                  เป็นความเสียหายจากผู้เช่า (จะนำไปหักลดเงินประกันตอนสิ้นสุดสัญญา/ย้ายออก)
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  className="px-4 py-2 bg-white border border-slate-300 text-slate-700 font-bold rounded-xl hover:bg-slate-100"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl flex items-center gap-1.5 shadow-sm disabled:opacity-50"
                >
                  {submitting ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                  บันทึกแจ้งซ่อม
                </button>
              </div>
            </form>
          )}

          {/* Tickets List */}
          <div className="space-y-2.5">
            {loading ? (
              <div className="p-6 text-center text-slate-400">
                <Loader2 size={18} className="animate-spin mx-auto mb-2 text-slate-300" />
                กำลังโหลดรายการแจ้งซ่อม...
              </div>
            ) : tickets.length === 0 ? (
              <div className="p-8 text-center bg-slate-50 border border-slate-200 rounded-2xl text-slate-400 space-y-1">
                <ShieldCheck size={28} className="mx-auto text-emerald-500" />
                <div className="font-bold text-slate-700 text-xs">ไม่มีรายการแจ้งซ่อมค้างอยู่</div>
                <div className="text-[10px]">บ้านเช่าแปลงนี้อยู่ในสภาพสมบูรณ์ดี</div>
              </div>
            ) : (
              tickets.map((t) => (
                <div key={t.id} className="p-3.5 bg-white border border-slate-200 rounded-2xl shadow-2xs space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-xs text-slate-900">{t.title}</span>
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                          t.status === 'Completed'
                            ? 'bg-emerald-100 text-emerald-800'
                            : t.status === 'InProgress'
                            ? 'bg-blue-100 text-blue-800'
                            : 'bg-amber-100 text-amber-800'
                        }`}>
                          {t.status === 'Completed' ? '✅ ซ่อมเสร็จแล้ว' : t.status === 'InProgress' ? '🛠️ กำลังดำเนินการ' : '⏳ รับเรื่องแล้ว'}
                        </span>
                        {t.is_tenant_responsible && (
                          <span className="text-[10px] bg-rose-100 text-rose-800 font-bold px-2 py-0.5 rounded-md">
                            หักเงินประกัน
                          </span>
                        )}
                      </div>
                      {t.description && (
                        <p className="text-[11px] text-slate-600 mt-0.5">{t.description}</p>
                      )}
                    </div>

                    <div className="text-right shrink-0">
                      <div className="text-[10px] text-slate-400">วันที่แจ้ง: {t.reported_date}</div>
                      {t.estimated_cost ? (
                        <div className="text-[11px] font-mono font-bold text-slate-700">฿{t.estimated_cost.toLocaleString()} บ.</div>
                      ) : null}
                    </div>
                  </div>

                  {/* Actions for Status Update */}
                  <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-[11px]">
                    <span className="text-slate-500">
                      ผู้รับผิดชอบ: <b>{t.assigned_to || 'ยังไม่ระบุ'}</b>
                    </span>

                    <div className="flex items-center gap-1.5">
                      {t.status !== 'InProgress' && t.status !== 'Completed' && (
                        <button
                          type="button"
                          onClick={() => handleUpdateStatus(t.id, 'InProgress')}
                          className="px-2.5 py-1 bg-blue-50 text-blue-700 font-bold rounded-lg hover:bg-blue-100"
                        >
                          เริ่มเข้าซ่อม
                        </button>
                      )}
                      {t.status !== 'Completed' && (
                        <button
                          type="button"
                          onClick={() => handleUpdateStatus(t.id, 'Completed')}
                          className="px-2.5 py-1 bg-emerald-600 text-white font-bold rounded-lg hover:bg-emerald-700 flex items-center gap-1"
                        >
                          <CheckCircle2 size={12} /> เสร็จสิ้น
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

        </div>

      </div>
    </div>
  );
}
