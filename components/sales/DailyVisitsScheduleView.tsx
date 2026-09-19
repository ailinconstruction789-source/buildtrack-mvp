"use client";

import React, { useState, useMemo } from 'react';
import { 
  Calendar, Clock, Phone, Home, Sparkles, User, MapPin, 
  Search, Filter, ChevronRight, CheckCircle2, AlertCircle, 
  Plus, MessageSquare, ArrowRight, RefreshCw, XCircle, 
  CalendarDays, Check, AlertTriangle, Building, Tag, ExternalLink
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Lead, CRMStatus } from '@/types/sales';
import HouseVisitChecklistModal from './HouseVisitChecklistModal';
import CustomerVoicesModal from './CustomerVoicesModal';

interface DailyVisitsScheduleViewProps {
  leads: Lead[];
  plots?: any[];
  projects?: any[];
  selectedProjectName?: string;
  user?: any;
  onRefresh: () => void;
  onSelectPlotForBooking?: (plotId: string, lead: Lead) => void;
  onOpenAddLeadModal?: () => void;
}

export default function DailyVisitsScheduleView({
  leads = [],
  plots = [],
  projects = [],
  selectedProjectName = 'all',
  user,
  onRefresh,
  onSelectPlotForBooking,
  onOpenAddLeadModal
}: DailyVisitsScheduleViewProps) {
  const [search, setSearch] = useState('');
  const [filterProject, setFilterProject] = useState<string>(selectedProjectName || 'all');
  const [filterAgent, setFilterAgent] = useState<string>('all');
  const [activeTabSection, setActiveTabSection] = useState<'all' | 'today' | 'upcoming' | 'overdue' | 'completed'>('all');

  // Modals state
  const [showChecklistModal, setShowChecklistModal] = useState<{ isOpen: boolean; lead: Lead | null }>({ isOpen: false, lead: null });
  const [showSurveyModal, setShowSurveyModal] = useState<{ isOpen: boolean; lead: Lead | null }>({ isOpen: false, lead: null });
  const [showRescheduleModal, setShowRescheduleModal] = useState<{ isOpen: boolean; lead: Lead | null }>({ isOpen: false, lead: null });
  const [newDateInput, setNewDateInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Normalize date helper (YYYY-MM-DD in local time)
  const getNormalizedDateStr = (dateInput: string | Date | null | undefined): string | null => {
    if (!dateInput) return null;
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return null;
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const today = new Date();
  const todayStr = getNormalizedDateStr(today) || '';

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = getNormalizedDateStr(tomorrow) || '';

  // Filter Unique Agents
  const agentList = useMemo(() => {
    const set = new Set<string>();
    leads.forEach(l => {
      const ag = l.agent_name || l.created_by_agent;
      if (ag) set.add(ag);
    });
    return Array.from(set);
  }, [leads]);

  // Filtered Leads
  const filteredLeads = useMemo(() => {
    return leads.filter(l => {
      // Must have appointment date or actual visit date
      if (!l.appointment_date && !l.actual_visit_date) return false;

      // Project filter
      if (filterProject !== 'all' && l.project_name !== filterProject) return false;

      // Agent filter
      if (filterAgent !== 'all' && (l.agent_name !== filterAgent && l.created_by_agent !== filterAgent)) return false;

      // Search
      if (search) {
        const q = search.toLowerCase();
        const nameMatch = l.customer_name?.toLowerCase().includes(q);
        const phoneMatch = l.phone?.includes(q);
        const plotMatch = l.interested_plot_name?.toLowerCase().includes(q);
        const agentMatch = (l.agent_name || l.created_by_agent || '').toLowerCase().includes(q);
        const notesMatch = l.notes?.toLowerCase().includes(q);
        if (!nameMatch && !phoneMatch && !plotMatch && !agentMatch && !notesMatch) return false;
      }

      return true;
    });
  }, [leads, filterProject, filterAgent, search]);

  // Categorize Leads into 4 Groups
  const { todayLeads, upcomingLeads, overdueLeads, completedLeads } = useMemo(() => {
    const todayGroup: Lead[] = [];
    const upcomingGroup: Lead[] = [];
    const overdueGroup: Lead[] = [];
    const completedGroup: Lead[] = [];

    filteredLeads.forEach(l => {
      const isLost = l.crm_status?.includes('Lost') || l.status === 'Cancelled';
      if (isLost) return; // exclude cancelled/lost from active agenda

      const hasVisited = !!l.actual_visit_date;
      const apptDateStr = getNormalizedDateStr(l.appointment_date);

      if (hasVisited) {
        completedGroup.push(l);
      } else if (apptDateStr === todayStr) {
        todayGroup.push(l);
      } else if (apptDateStr && apptDateStr > todayStr) {
        upcomingGroup.push(l);
      } else if (apptDateStr && apptDateStr < todayStr) {
        overdueGroup.push(l);
      }
    });

    // Sort today by appointment date/time
    todayGroup.sort((a, b) => new Date(a.appointment_date || '').getTime() - new Date(b.appointment_date || '').getTime());
    // Sort upcoming ascending
    upcomingGroup.sort((a, b) => new Date(a.appointment_date || '').getTime() - new Date(b.appointment_date || '').getTime());
    // Sort overdue descending (most recent overdue first)
    overdueGroup.sort((a, b) => new Date(b.appointment_date || '').getTime() - new Date(a.appointment_date || '').getTime());
    // Sort completed descending
    completedGroup.sort((a, b) => new Date(b.actual_visit_date || '').getTime() - new Date(a.actual_visit_date || '').getTime());

    return {
      todayLeads: todayGroup,
      upcomingLeads: upcomingGroup,
      overdueLeads: overdueGroup,
      completedLeads: completedGroup
    };
  }, [filteredLeads, todayStr]);

  // Handle Quick Reschedule
  const handleSaveReschedule = async () => {
    if (!showRescheduleModal.lead || !newDateInput) return;
    setIsSubmitting(true);
    try {
      await supabase.from('leads').update({
        appointment_date: new Date(`${newDateInput}T10:00:00Z`).toISOString(),
        crm_status: 'Follow-up — อยู่ระหว่างติดตาม'
      }).eq('id', showRescheduleModal.lead.id);

      setShowRescheduleModal({ isOpen: false, lead: null });
      setNewDateInput('');
      onRefresh();
    } catch (err) {
      console.error('Error rescheduling:', err);
      alert('เลื่อนนัดหมายไม่สำเร็จ');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle Instant Quick Check-in
  const handleInstantCheckIn = async (lead: Lead) => {
    if (!confirm(`ยืนยันการเช็คอินเข้าชมจริงสำหรับคุณ ${lead.customer_name}?`)) return;
    setIsSubmitting(true);
    try {
      const now = new Date().toISOString();
      await supabase.from('leads').update({
        actual_visit_date: now,
        auto_status: 'เข้าชมแล้ว',
        crm_status: 'Considering — กำลังพิจารณา / เปรียบเทียบ'
      }).eq('id', lead.id);

      onRefresh();
    } catch (err) {
      console.error('Error instant check-in:', err);
      alert('เช็คอินไม่สำเร็จ');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-7xl mx-auto">
      
      {/* 🚀 Header & Overview Bar */}
      <div className="bg-white p-5 sm:p-6 rounded-3xl shadow-sm border border-slate-200/80 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 rounded-2xl bg-gradient-to-tr from-rose-500 to-amber-500 text-white shadow-md shadow-rose-500/20">
              <CalendarDays size={24} />
            </div>
            <div>
              <h2 className="text-xl sm:text-2xl font-black text-slate-900 flex items-center gap-2">
                ตารางนัดหมายเข้าชม & แผนพาชมประจำวัน
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Daily House Tour Agenda · ตรวจสอบคิวนัดเข้าชมโครงการ พร้อมเริ่มขั้นตอน SOP เตรียมบ้านได้ทันที
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          <button
            onClick={() => setShowChecklistModal({ isOpen: true, lead: null })}
            className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-4 py-2.5 rounded-xl text-xs flex items-center gap-2 shadow-md shadow-indigo-600/20 transition-all cursor-pointer"
          >
            <Home size={15} /> 🏡 SOP ตรวจบ้าน (Stage A)
          </button>

          {onOpenAddLeadModal && (
            <button
              onClick={onOpenAddLeadModal}
              className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2.5 rounded-xl text-xs flex items-center gap-2 shadow-md shadow-blue-600/20 transition-all cursor-pointer"
            >
              <Plus size={15} /> + เพิ่มนัดหมายใหม่
            </button>
          )}

          <button
            onClick={onRefresh}
            className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold p-2.5 rounded-xl text-xs transition-colors cursor-pointer"
            title="รีเฟรชข้อมูล"
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      {/* 📊 4 KPI Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Card 1: Today */}
        <div 
          onClick={() => setActiveTabSection('today')}
          className={`p-4 rounded-2xl border transition-all cursor-pointer ${
            activeTabSection === 'today' 
              ? 'bg-rose-50 border-rose-300 shadow-md ring-2 ring-rose-500/20' 
              : 'bg-white border-slate-200/80 hover:border-rose-300 hover:bg-rose-50/40'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-rose-700 uppercase tracking-wider flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
              นัดเข้าชมวันนี้
            </span>
            <span className="p-1.5 rounded-lg bg-rose-100 text-rose-700"><Clock size={16} /></span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-black text-rose-900">{todayLeads.length}</span>
            <span className="text-xs font-semibold text-rose-600">ท่าน</span>
          </div>
          <p className="text-[11px] text-rose-600/80 mt-1 font-medium">
            {todayLeads.length > 0 ? 'เตรียมบ้าน Stage A ล่วงหน้า' : 'ไม่มีคิวนัดวันนี้'}
          </p>
        </div>

        {/* Card 2: Upcoming */}
        <div 
          onClick={() => setActiveTabSection('upcoming')}
          className={`p-4 rounded-2xl border transition-all cursor-pointer ${
            activeTabSection === 'upcoming' 
              ? 'bg-amber-50 border-amber-300 shadow-md ring-2 ring-amber-500/20' 
              : 'bg-white border-slate-200/80 hover:border-amber-300 hover:bg-amber-50/40'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-amber-700 uppercase tracking-wider">
              นัดเร็วๆ นี้ (Upcoming)
            </span>
            <span className="p-1.5 rounded-lg bg-amber-100 text-amber-700"><Calendar size={16} /></span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-black text-amber-900">{upcomingLeads.length}</span>
            <span className="text-xs font-semibold text-amber-600">ท่าน</span>
          </div>
          <p className="text-[11px] text-amber-600/80 mt-1 font-medium">
            นัดหมายใน 7-14 วันข้างหน้า
          </p>
        </div>

        {/* Card 3: Overdue */}
        <div 
          onClick={() => setActiveTabSection('overdue')}
          className={`p-4 rounded-2xl border transition-all cursor-pointer ${
            activeTabSection === 'overdue' 
              ? 'bg-orange-50 border-orange-300 shadow-md ring-2 ring-orange-500/20' 
              : 'bg-white border-slate-200/80 hover:border-orange-300 hover:bg-orange-50/40'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-orange-700 uppercase tracking-wider">
              เลยกำหนดนัด (Overdue)
            </span>
            <span className="p-1.5 rounded-lg bg-orange-100 text-orange-700"><AlertTriangle size={16} /></span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-black text-orange-900">{overdueLeads.length}</span>
            <span className="text-xs font-semibold text-orange-600">ท่าน</span>
          </div>
          <p className="text-[11px] text-orange-600/80 mt-1 font-medium">
            เลยวันนัดแต่ยังไม่เช็คอิน / รอโทรเลื่อนนัด
          </p>
        </div>

        {/* Card 4: Completed */}
        <div 
          onClick={() => setActiveTabSection('completed')}
          className={`p-4 rounded-2xl border transition-all cursor-pointer ${
            activeTabSection === 'completed' 
              ? 'bg-emerald-50 border-emerald-300 shadow-md ring-2 ring-emerald-500/20' 
              : 'bg-white border-slate-200/80 hover:border-emerald-300 hover:bg-emerald-50/40'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-emerald-700 uppercase tracking-wider">
              เข้าชมเรียบร้อยแล้ว
            </span>
            <span className="p-1.5 rounded-lg bg-emerald-100 text-emerald-700"><CheckCircle2 size={16} /></span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-black text-emerald-900">{completedLeads.length}</span>
            <span className="text-xs font-semibold text-emerald-600">ท่าน</span>
          </div>
          <p className="text-[11px] text-emerald-600/80 mt-1 font-medium">
            อยู่ระหว่างพิจารณา / รอทำสัญญา
          </p>
        </div>
      </div>

      {/* 🔍 Search & Filters Bar */}
      <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200/80 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3 flex-1 min-w-[300px]">
          <div className="relative flex-1 min-w-[220px]">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="ค้นหาชื่อลูกค้า, เบอร์โทร, แปลง, เซลล์..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <select
            value={filterProject}
            onChange={e => setFilterProject(e.target.value)}
            className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">🏢 ทุกโครงการ</option>
            {projects.map((p: any) => (
              <option key={p.id || p.name} value={p.name}>{p.name}</option>
            ))}
          </select>

          <select
            value={filterAgent}
            onChange={e => setFilterAgent(e.target.value)}
            className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">🧑‍💼 ทุกเซลล์ผู้ดูแล</option>
            {agentList.map(ag => (
              <option key={ag} value={ag}>{ag}</option>
            ))}
          </select>
        </div>

        {/* Section Tabs */}
        <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
          <button
            onClick={() => setActiveTabSection('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              activeTabSection === 'all' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            ทั้งหมด ({filteredLeads.length})
          </button>
          <button
            onClick={() => setActiveTabSection('today')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              activeTabSection === 'today' ? 'bg-rose-500 text-white shadow-sm' : 'text-slate-500 hover:text-rose-600'
            }`}
          >
            วันนี้ ({todayLeads.length})
          </button>
          <button
            onClick={() => setActiveTabSection('upcoming')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              activeTabSection === 'upcoming' ? 'bg-amber-500 text-white shadow-sm' : 'text-slate-500 hover:text-amber-600'
            }`}
          >
            เร็วๆ นี้ ({upcomingLeads.length})
          </button>
          <button
            onClick={() => setActiveTabSection('overdue')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              activeTabSection === 'overdue' ? 'bg-orange-500 text-white shadow-sm' : 'text-slate-500 hover:text-orange-600'
            }`}
          >
            เลยนัด ({overdueLeads.length})
          </button>
          <button
            onClick={() => setActiveTabSection('completed')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              activeTabSection === 'completed' ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-500 hover:text-emerald-600'
            }`}
          >
            เข้าชมแล้ว ({completedLeads.length})
          </button>
        </div>
      </div>

      {/* 📋 Section 1: 🔴 นัดหมายวันนี้ (Today's Scheduled Visits) */}
      {(activeTabSection === 'all' || activeTabSection === 'today') && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-black text-rose-900 flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse" />
              🔴 นัดหมายเข้าชมวันนี้ (Today: {new Date().toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })})
            </h3>
            <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-rose-100 text-rose-800">
              {todayLeads.length} รายการ
            </span>
          </div>

          {todayLeads.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200/80 p-8 text-center space-y-2">
              <div className="w-12 h-12 rounded-full bg-rose-50 text-rose-400 flex items-center justify-center mx-auto">
                <Clock size={24} />
              </div>
              <p className="text-xs font-bold text-slate-700">ไม่มีลูกค้านัดหมายเข้าชมโครงการในวันนี้</p>
              <p className="text-[11px] text-slate-400">คุณสามารถตรวจสอบคิวในส่วน "นัดหมายที่จะถึงเร็วๆ นี้" หรือเริ่มตรวจบ้านตัวอย่างประจำวันได้ครับ</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {todayLeads.map((l) => (
                <div 
                  key={l.id} 
                  className="bg-white rounded-2xl border-2 border-rose-200/90 shadow-sm p-5 hover:shadow-md transition-all relative overflow-hidden flex flex-col justify-between group"
                >
                  <div className="absolute top-0 right-0 left-0 h-1 bg-gradient-to-r from-rose-500 to-amber-500" />
                  
                  <div>
                    {/* Card Top Row */}
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="text-base font-black text-slate-900">{l.customer_name}</h4>
                          <span className="px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 text-[10px] font-black border border-rose-200">
                            นัดวันนี้ 🔥
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 font-medium flex items-center gap-1.5 mt-0.5">
                          <Building size={12} className="text-slate-400" />
                          <strong className="text-slate-700">{l.project_name || 'ไม่ระบุโครงการ'}</strong>
                          {l.channel && <span>· ผ่าน {l.channel}</span>}
                        </p>
                      </div>

                      {l.interested_plot_name && (
                        <span className="bg-emerald-50 text-emerald-800 font-bold px-2.5 py-1 rounded-xl border border-emerald-200 text-xs flex items-center gap-1 shadow-sm">
                          <Home size={13} className="text-emerald-600" /> {l.interested_plot_name}
                        </span>
                      )}
                    </div>

                    {/* Customer Info Box */}
                    <div className="bg-slate-50 rounded-xl p-3 grid grid-cols-2 gap-2 text-xs mb-3 border border-slate-100">
                      <div>
                        <span className="text-[10px] text-slate-400 font-bold block">เบอร์โทรศัพท์</span>
                        <a href={`tel:${l.phone}`} className="font-mono font-bold text-blue-600 hover:underline flex items-center gap-1">
                          <Phone size={11} /> {l.phone || '-'}
                        </a>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400 font-bold block">เซลล์ผู้ดูแล</span>
                        <span className="font-bold text-slate-700 flex items-center gap-1">
                          <User size={11} /> {l.agent_name || l.created_by_agent || '-'}
                        </span>
                      </div>
                      {l.appointment_date && (
                        <div className="col-span-2 pt-1 border-t border-slate-200/60 flex items-center justify-between text-slate-600">
                          <span className="text-[11px] font-semibold flex items-center gap-1">
                            <Clock size={12} className="text-rose-600" /> 
                            เวลานัด: {new Date(l.appointment_date).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.
                          </span>
                          <span className="text-[10px] font-bold text-slate-400">Follow-up แล้ว {l.follow_up_count || 0} ครั้ง</span>
                        </div>
                      )}
                    </div>

                    {l.notes && (
                      <p className="text-[11px] text-slate-600 bg-amber-50/60 border border-amber-100 rounded-lg p-2 mb-3 line-clamp-2">
                        💬 <strong>โน้ต:</strong> {l.notes}
                      </p>
                    )}
                  </div>

                  {/* Actions Bar */}
                  <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
                    <button
                      onClick={() => setShowChecklistModal({ isOpen: true, lead: l })}
                      className="bg-indigo-600 hover:bg-indigo-700 text-white font-black px-3.5 py-2 rounded-xl text-xs flex items-center gap-1.5 shadow-md shadow-indigo-600/20 transition-all cursor-pointer"
                    >
                      <Sparkles size={14} /> 🏡 เริ่ม SOP ตรวจบ้าน & พาชม
                    </button>

                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => handleInstantCheckIn(l)}
                        className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-bold px-2.5 py-2 rounded-xl text-xs flex items-center gap-1 border border-emerald-200 transition-colors cursor-pointer"
                        title="เช็คอินเข้าชมจริงทันที"
                      >
                        <Check size={13} /> เช็คอิน
                      </button>

                      <button
                        onClick={() => { setShowRescheduleModal({ isOpen: true, lead: l }); setNewDateInput(todayStr); }}
                        className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold px-2.5 py-2 rounded-xl text-xs transition-colors cursor-pointer"
                        title="เลื่อนนัดหมาย"
                      >
                        <Calendar size={13} />
                      </button>

                      <button
                        onClick={() => setShowSurveyModal({ isOpen: true, lead: l })}
                        className="bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold p-2 rounded-xl text-xs transition-colors cursor-pointer"
                        title="ทำแบบสอบถาม Customer Voices"
                      >
                        <MessageSquare size={13} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 📋 Section 2: 🟡 นัดหมายเร็วๆ นี้ (Upcoming Appointments in 7-14 Days) */}
      {(activeTabSection === 'all' || activeTabSection === 'upcoming') && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-black text-amber-900 flex items-center gap-2">
              <Calendar size={16} className="text-amber-600" />
              🟡 นัดหมายที่จะถึงเร็วๆ นี้ (Upcoming)
            </h3>
            <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800">
              {upcomingLeads.length} รายการ
            </span>
          </div>

          {upcomingLeads.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200/80 p-6 text-center text-xs text-slate-400">
              ไม่มีคิวนัดหมายล่วงหน้าในช่วงนี้
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {upcomingLeads.map((l) => {
                const apptDate = new Date(l.appointment_date || '');
                const diffTime = apptDate.getTime() - today.getTime();
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                return (
                  <div key={l.id} className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-sm hover:shadow-md transition-all flex flex-col justify-between">
                    <div>
                      <div className="flex items-start justify-between gap-1 mb-2">
                        <div>
                          <h4 className="font-bold text-slate-900 text-xs">{l.customer_name}</h4>
                          <span className="text-[11px] text-slate-500">{l.project_name}</span>
                        </div>
                        <span className="bg-amber-50 text-amber-800 font-bold px-2 py-0.5 rounded-md border border-amber-200 text-[10px]">
                          {diffDays === 1 ? 'พรุ่งนี้' : `อีก ${diffDays} วัน`}
                        </span>
                      </div>

                      <div className="text-[11px] text-slate-600 space-y-1 mb-3">
                        <div className="flex items-center gap-1.5 font-bold text-indigo-700">
                          <Calendar size={12} />
                          {apptDate.toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short' })}
                        </div>
                        {l.interested_plot_name && (
                          <div className="flex items-center gap-1 text-emerald-700 font-semibold">
                            <Home size={12} /> แปลง: {l.interested_plot_name}
                          </div>
                        )}
                        <div className="flex items-center gap-1 text-slate-500">
                          <User size={12} /> เซลล์: {l.agent_name || l.created_by_agent || '-'}
                        </div>
                      </div>
                    </div>

                    <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
                      <button
                        onClick={() => setShowChecklistModal({ isOpen: true, lead: l })}
                        className="text-[11px] font-bold text-indigo-700 hover:text-indigo-900 bg-indigo-50 px-2.5 py-1.5 rounded-lg border border-indigo-200 flex items-center gap-1 cursor-pointer"
                      >
                        <Sparkles size={12} /> เตรียมบ้าน SOP
                      </button>

                      <button
                        onClick={() => { setShowRescheduleModal({ isOpen: true, lead: l }); setNewDateInput(todayStr); }}
                        className="text-[11px] text-slate-600 hover:text-slate-800 p-1.5 rounded-lg bg-slate-100 cursor-pointer"
                        title="แก้ไขวันนัด"
                      >
                        <Calendar size={12} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 📋 Section 3: ⚠️ เลยกำหนดนัด / รออัปเดต (Overdue Visits) */}
      {(activeTabSection === 'all' || activeTabSection === 'overdue') && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-black text-orange-900 flex items-center gap-2">
              <AlertTriangle size={16} className="text-orange-600" />
              ⚠️ เลยกำหนดนัด / ยังไม่เช็คอิน (Overdue Follow-up)
            </h3>
            <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-orange-100 text-orange-800">
              {overdueLeads.length} รายการ
            </span>
          </div>

          {overdueLeads.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200/80 p-6 text-center text-xs text-slate-400">
              ไม่มีลูกค้านัดหมายที่เลยกำหนด ยอดเยี่ยมมากครับ!
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {overdueLeads.map((l) => (
                <div key={l.id} className="bg-white rounded-2xl border border-orange-200 p-4 shadow-sm flex flex-col justify-between">
                  <div>
                    <div className="flex items-start justify-between gap-1 mb-2">
                      <div>
                        <h4 className="font-bold text-slate-900 text-xs">{l.customer_name}</h4>
                        <span className="text-[11px] text-slate-500">{l.project_name}</span>
                      </div>
                      <span className="bg-orange-50 text-orange-800 font-bold px-2 py-0.5 rounded-md border border-orange-200 text-[10px]">
                        เลยนัด
                      </span>
                    </div>

                    <div className="text-[11px] text-slate-600 space-y-1 mb-3">
                      <div className="text-rose-700 font-semibold">
                        นัดเดิม: {new Date(l.appointment_date!).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </div>
                      <div className="font-mono text-blue-600 font-bold">
                        📞 {l.phone || '-'}
                      </div>
                      <div className="text-slate-500">
                        เซลล์: {l.agent_name || l.created_by_agent || '-'}
                      </div>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
                    <button
                      onClick={() => { setShowRescheduleModal({ isOpen: true, lead: l }); setNewDateInput(todayStr); }}
                      className="text-[11px] font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 px-2.5 py-1.5 rounded-lg border border-blue-200 flex items-center gap-1 cursor-pointer"
                    >
                      <Calendar size={12} /> เลื่อนนัดหมาย
                    </button>

                    <button
                      onClick={() => handleInstantCheckIn(l)}
                      className="text-[11px] font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-2.5 py-1.5 rounded-lg border border-emerald-200 flex items-center gap-1 cursor-pointer"
                    >
                      <Check size={12} /> เข้าชมแล้ว
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 📋 Section 4: 🟢 ประวัติเข้าชมเรียบร้อยแล้ว (Completed Visits) */}
      {(activeTabSection === 'all' || activeTabSection === 'completed') && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-black text-emerald-900 flex items-center gap-2">
              <CheckCircle2 size={16} className="text-emerald-600" />
              🟢 เข้าชมโครงการเรียบร้อยแล้ว (Visited)
            </h3>
            <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
              {completedLeads.length} รายการ
            </span>
          </div>

          {completedLeads.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200/80 p-6 text-center text-xs text-slate-400">
              ยังไม่มีประวัติการเข้าชมโครงการ
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {completedLeads.slice(0, 12).map((l) => (
                <div key={l.id} className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-sm flex flex-col justify-between">
                  <div>
                    <div className="flex items-start justify-between gap-1 mb-2">
                      <div>
                        <h4 className="font-bold text-slate-900 text-xs">{l.customer_name}</h4>
                        <span className="text-[11px] text-slate-500">{l.project_name}</span>
                      </div>
                      <span className="bg-emerald-50 text-emerald-800 font-bold px-2 py-0.5 rounded-md border border-emerald-200 text-[10px]">
                        เข้าชมแล้ว ✓
                      </span>
                    </div>

                    <div className="text-[11px] text-slate-600 space-y-1 mb-3">
                      <div className="text-emerald-800 font-bold">
                        วันที่เข้าชม: {new Date(l.actual_visit_date!).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })}
                      </div>
                      {l.interested_plot_name && (
                        <div className="text-indigo-700 font-bold">
                          แปลงที่เล็ง: {l.interested_plot_name}
                        </div>
                      )}
                      <div className="text-slate-500 text-[10px]">
                        สถานะ: {l.crm_status || 'Considering'}
                      </div>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
                    <button
                      onClick={() => setShowChecklistModal({ isOpen: true, lead: l })}
                      className="text-[11px] font-bold text-purple-700 bg-purple-50 hover:bg-purple-100 px-2.5 py-1.5 rounded-lg border border-purple-200 flex items-center gap-1 cursor-pointer"
                    >
                      <Sparkles size={12} /> สรุปผลการขาย (Stage C)
                    </button>

                    <button
                      onClick={() => setShowSurveyModal({ isOpen: true, lead: l })}
                      className="p-1.5 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 cursor-pointer"
                      title="แบบสอบถาม Customer Voices"
                    >
                      <MessageSquare size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 📅 Modal: Quick Reschedule */}
      {showRescheduleModal.isOpen && showRescheduleModal.lead && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-3xl max-w-sm w-full shadow-2xl p-6 space-y-4 border border-slate-200">
            <h3 className="font-black text-base text-slate-800 flex items-center gap-2">
              <Calendar size={18} className="text-blue-600" />
              เลื่อนนัดหมายเข้าชม
            </h3>
            <p className="text-xs text-slate-500">
              ลูกค้า: <strong className="text-slate-800">{showRescheduleModal.lead.customer_name}</strong>
            </p>

            <div className="space-y-2">
              <label className="block text-xs font-bold text-slate-700">เลือกวันนัดหมายใหม่ *</label>
              <input
                type="date"
                value={newDateInput}
                onChange={e => setNewDateInput(e.target.value)}
                className="w-full bg-slate-50 border border-slate-300 rounded-xl p-3 text-xs font-bold text-slate-800 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => { setShowRescheduleModal({ isOpen: false, lead: null }); setNewDateInput(''); }}
                className="px-4 py-2 rounded-xl border border-slate-300 font-bold text-slate-600 hover:bg-slate-100 text-xs cursor-pointer"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                disabled={isSubmitting || !newDateInput}
                onClick={handleSaveReschedule}
                className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2 rounded-xl text-xs flex items-center gap-1.5 shadow-md shadow-blue-600/20 disabled:opacity-50 cursor-pointer"
              >
                <Check size={14} /> บันทึกวันนัดใหม่
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 🗣️ Customer Voices Modal */}
      {showSurveyModal.isOpen && (
        <CustomerVoicesModal
          isOpen={showSurveyModal.isOpen}
          onClose={() => setShowSurveyModal({ isOpen: false, lead: null })}
          lead={showSurveyModal.lead}
          projectName={showSurveyModal.lead?.project_name || (filterProject !== 'all' ? filterProject : 'ไอลิน 6')}
          user={user}
          onSaved={onRefresh}
        />
      )}

      {/* 🏡 SOP House & Sales Visit Checklist Modal (Stage A ➡️ B ➡️ C) */}
      {showChecklistModal.isOpen && (
        <HouseVisitChecklistModal
          isOpen={showChecklistModal.isOpen}
          onClose={() => setShowChecklistModal({ isOpen: false, lead: null })}
          lead={showChecklistModal.lead}
          projectName={showChecklistModal.lead?.project_name || (filterProject !== 'all' ? filterProject : 'ไอลิน 6')}
          user={user}
          plots={plots}
          onOpenSurvey={(lead) => {
            setShowChecklistModal({ isOpen: false, lead: null });
            setShowSurveyModal({ isOpen: true, lead });
          }}
          onSaved={onRefresh}
        />
      )}

    </div>
  );
}