'use client';

import React, { useState, useEffect } from 'react';
import { 
  X, Calendar, Clock, Building2, MapPin, User, 
  Phone, Sparkles, AlertCircle, CheckCircle2, Loader2, FileText 
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { loadAvailablePlots } from '@/lib/sales/plotAvailabilityClient';
import type { InterestedPlot } from '@/lib/sales/plotAvailability';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  customer: {
    id: string;
    name: string;
    phone?: string | null;
    channel?: string | null;
    ownerUserId?: string;
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

export default function CentralVisitAppointmentModal({
  isOpen,
  onClose,
  customer,
  initialInterest,
  projects = [],
  salesOwners = [],
  onSaved
}: Props) {
  const [projectName, setProjectName] = useState('');
  const [plotId, setPlotId] = useState('');
  const [availablePlots, setAvailablePlots] = useState<InterestedPlot[]>([]);
  const [loadingPlots, setLoadingPlots] = useState(false);
  const [appointmentDate, setAppointmentDate] = useState('');
  const [appointmentTime, setAppointmentTime] = useState('10:00');
  const [agentName, setAgentName] = useState('');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Set default tomorrow date
  useEffect(() => {
    if (isOpen) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const yyyy = tomorrow.getFullYear();
      const mm = String(tomorrow.getMonth() + 1).padStart(2, '0');
      const dd = String(tomorrow.getDate()).padStart(2, '0');
      setAppointmentDate(`${yyyy}-${mm}-${dd}`);
      setAppointmentTime('10:00');
      setErrorMsg('');

      const proj = initialInterest?.projectName || (projects.length > 0 ? projects[0] : '');
      setProjectName(proj);
      setPlotId(initialInterest?.plotId || '');

      const initialOwnerId = initialInterest?.ownerUserId || customer?.ownerUserId;
      const ownerObj = salesOwners.find(o => o.userId === initialOwnerId);
      setAgentName(ownerObj?.displayName || salesOwners[0]?.displayName || 'Sales');
      setNotes('');
    }
  }, [isOpen, initialInterest, customer, projects, salesOwners]);

  // Load available plots when project changes
  useEffect(() => {
    if (!projectName) {
      setAvailablePlots([]);
      return;
    }
    let cancelled = false;
    setLoadingPlots(true);
    loadAvailablePlots(projectName)
      .then(plots => {
        if (!cancelled) {
          setAvailablePlots(plots);
          setLoadingPlots(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAvailablePlots([]);
          setLoadingPlots(false);
        }
      });
    return () => { cancelled = true; };
  }, [projectName]);

  if (!isOpen || !customer) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectName) {
      setErrorMsg('กรุณาเลือกโครงการที่ต้องการนัดเข้าชม');
      return;
    }
    if (!appointmentDate) {
      setErrorMsg('กรุณาระบุวันที่นัดหมาย');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg('');

    try {
      const selectedPlot = availablePlots.find(p => p.id === plotId);
      const plotName = selectedPlot ? selectedPlot.plot_name : (plotId || null);
      const appointmentDateTime = `${appointmentDate}T${appointmentTime || '10:00'}:00+07:00`;

      const { error } = await supabase.from('leads').insert({
        customer_name: customer.name,
        phone: customer.phone || null,
        project_name: projectName,
        interested_plot_id: plotId || null,
        interested_plot_name: plotName,
        appointment_date: appointmentDateTime,
        agent_name: agentName || null,
        created_by_agent: agentName || null,
        source: customer.channel || 'ส่วนกลาง (CRM)',
        status: 'Visit',
        auto_status: 'นัดชมโครงการ',
        crm_status: 'Follow-up — อยู่ระหว่างติดตาม',
        notes: notes ? `[นัดเข้าชม] ${notes}` : `นัดหมายเข้าชมโครงการ ${projectName}`
      });

      if (error) {
        throw new Error(error.message || 'บันทึกนัดหมายไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
      }

      const formattedDate = new Date(appointmentDate).toLocaleDateString('th-TH', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });

      onSaved?.(`บันทึกนัดหมายเข้าชมโครงการ ${projectName} วันที่ ${formattedDate} เวลา ${appointmentTime} น. เรียบร้อยแล้ว (ซิงค์เข้าสู่ตารางนัดหมายแล้ว)`);
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'เกิดข้อผิดพลาดในการบันทึกนัดหมาย');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[300] bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 animate-in fade-in duration-200">
      <div className="w-full max-w-lg bg-white rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[88vh] my-auto animate-in zoom-in-95 duration-200">
        {/* Sticky Header */}
        <div className="sticky top-0 z-20 bg-gradient-to-r from-blue-600 to-indigo-700 px-6 py-4 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/20 backdrop-blur-xs text-white">
              <Calendar size={20} />
            </div>
            <div>
              <h3 className="text-base font-black tracking-tight">📅 บันทึกนัดหมายเข้าชมโครงการ</h3>
              <p className="text-xs text-blue-100 font-medium">บันทึกนัดหมายและส่งเข้าตารางคิวหน้าไซต์ทันที</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="ปิดหน้าต่าง"
            className="rounded-xl p-2 text-white/80 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} id="visit-appointment-form" className="flex flex-col flex-1 overflow-hidden">
          <div className="p-5 sm:p-6 space-y-4 overflow-y-auto flex-1">
          {errorMsg && (
            <div role="alert" className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold flex items-center gap-2">
              <AlertCircle size={16} className="shrink-0 text-rose-600" />
              {errorMsg}
            </div>
          )}

          {/* Customer Summary Card */}
          <div className="rounded-2xl border border-slate-100 bg-slate-50/80 p-3.5 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2.5">
              <div className="h-9 w-9 rounded-xl bg-blue-100 text-blue-700 font-black flex items-center justify-center">
                <User size={16} />
              </div>
              <div>
                <span className="font-black text-slate-800 text-sm block">{customer.name}</span>
                <span className="text-slate-500 font-medium flex items-center gap-1">
                  <Phone size={11} /> {customer.phone || 'ไม่ระบุเบอร์โทร'}
                </span>
              </div>
            </div>
            {customer.channel && (
              <span className="px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-slate-600 font-bold text-[11px]">
                {customer.channel}
              </span>
            )}
          </div>

          {/* Project & Plot Selection */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                โครงการที่ต้องการเข้าชม <span className="text-rose-500">*</span>
              </label>
              <select
                value={projectName}
                onChange={e => {
                  setProjectName(e.target.value);
                  setPlotId('');
                }}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-2xs"
                required
              >
                <option value="">-- เลือกโครงการ --</option>
                {projects.map(p => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center justify-between">
                <span>แปลงบ้านที่เล็ง (ถ้ามี)</span>
                {loadingPlots && <span className="text-[10px] text-blue-600 font-medium flex items-center gap-1"><Loader2 size={10} className="animate-spin" /> โหลดแปลง...</span>}
              </label>
              <select
                value={plotId}
                onChange={e => setPlotId(e.target.value)}
                disabled={!projectName || loadingPlots}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-2xs disabled:bg-slate-100 disabled:opacity-60"
              >
                <option value="">-- ยังไม่ระบุแปลง --</option>
                {availablePlots.map(plot => (
                  <option key={plot.id} value={plot.id}>
                    {plot.plot_name} (แปลงว่าง)
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Date & Time Selection */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                วันที่นัดหมาย <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <input
                  type="date"
                  value={appointmentDate}
                  onChange={e => setAppointmentDate(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-2xs"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                เวลานัดหมาย <span className="text-rose-500">*</span>
              </label>
              <input
                type="time"
                value={appointmentTime}
                onChange={e => setAppointmentTime(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-2xs"
                required
              >
              </input>
            </div>
          </div>

          {/* Sales Caretaker */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Sales ผู้ดูแลพาชม
            </label>
            <select
              value={agentName}
              onChange={e => setAgentName(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-2xs"
            >
              {salesOwners.map(owner => (
                <option key={owner.userId} value={owner.displayName}>
                  {owner.displayName}
                </option>
              ))}
            </select>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              หมายเหตุ / ความต้องการลูกค้า
            </label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              placeholder="เช่น ลูกค้าสะดวกช่วงบ่าย สนใจบ้าน 3 นอน หรือมีงบประมาณ 3-4 ล้าน..."
              className="w-full rounded-xl border border-slate-200 bg-white p-3 text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-2xs resize-none"
            />
          </div>
          </div>

          {/* Sticky Action Buttons */}
          <div className="sticky bottom-0 z-20 px-5 sm:px-6 py-3.5 border-t border-slate-100 bg-slate-50/95 backdrop-blur-sm flex items-center justify-end gap-2.5 shrink-0">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 font-bold text-xs transition-colors cursor-pointer"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-sm disabled:opacity-50 transition-all flex items-center gap-1.5 cursor-pointer"
            >
              {isSubmitting ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  กำลังบันทึก...
                </>
              ) : (
                <>
                  <CheckCircle2 size={14} />
                  บันทึกนัดหมายเข้าชม
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
