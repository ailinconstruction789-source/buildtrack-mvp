"use client";

import React, { useState, useMemo } from 'react';
import { 
  Search, Plus, Filter, Download, Upload, Phone, Calendar, 
  MapPin, Home, CheckCircle, XCircle, Clock, AlertTriangle, 
  MessageSquare, User, Building, FileText, ArrowRight, Save, 
  Edit3, Trash2, Eye, MoreHorizontal, Check, RefreshCw, Loader2
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { supabase } from '@/lib/supabase';
import { Lead, CRMStatus, LostReason, MarketingChannel } from '@/types/sales';
import { parseExcelRowToLead, downloadLeadTrackerTemplate, ParsedLeadRow, CRM_STATUS_OPTIONS, LOST_REASON_OPTIONS, MARKETING_CHANNEL_OPTIONS } from '@/lib/salesImportHelper';
import CustomerVoicesModal from './CustomerVoicesModal';

interface LeadTrackerViewProps {
  leads: Lead[];
  plots?: any[];
  projects?: any[];
  selectedProjectName?: string;
  user?: any;
  onRefresh: () => void;
  onSelectPlotForBooking?: (plotId: string, lead: Lead) => void;
}

const CRM_STATUS_LIST = CRM_STATUS_OPTIONS;
const LOST_REASONS = LOST_REASON_OPTIONS;
const CHANNELS = MARKETING_CHANNEL_OPTIONS;

export default function LeadTrackerView({
  leads,
  plots = [],
  projects = [],
  selectedProjectName = 'all',
  user,
  onRefresh,
  onSelectPlotForBooking
}: LeadTrackerViewProps) {
  const [search, setSearch] = useState('');
  const [filterProject, setFilterProject] = useState<string>(selectedProjectName || 'all');
  const [filterChannel, setFilterChannel] = useState<string>('all');
  const [filterCRMStatus, setFilterCRMStatus] = useState<string>('all');
  const [filterAgent, setFilterAgent] = useState<string>('all');

  // Modals state
  const [showAddLeadModal, setShowAddLeadModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importData, setImportData] = useState<ParsedLeadRow[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [showFollowUpModal, setShowFollowUpModal] = useState<{ isOpen: boolean; lead: Lead | null }>({ isOpen: false, lead: null });
  const [showVisitModal, setShowVisitModal] = useState<{ isOpen: boolean; lead: Lead | null }>({ isOpen: false, lead: null });
  const [showBookingModal, setShowBookingModal] = useState<{ isOpen: boolean; lead: Lead | null }>({ isOpen: false, lead: null });
  const [showLostModal, setShowLostModal] = useState<{ isOpen: boolean; lead: Lead | null }>({ isOpen: false, lead: null });
  const [showSurveyModal, setShowSurveyModal] = useState<{ isOpen: boolean; lead: Lead | null }>({ isOpen: false, lead: null });
  
  const [isSubmitting, setIsSubmitting] = useState(false);

  // New Lead Form State
  const [newLeadForm, setNewLeadForm] = useState({
    customer_name: '',
    phone: '',
    occupation: '',
    project_name: selectedProjectName !== 'all' ? selectedProjectName : (projects[0]?.name || 'ไอลิน สันทราย 2'),
    channel: 'Facebook',
    agent_name: user?.username || 'Bell',
    interested_plot_name: '',
    appointment_date: '',
    notes: ''
  });

  // Filtered Leads
  const filteredLeads = useMemo(() => {
    return leads.filter(l => {
      if (filterProject !== 'all' && l.project_name && l.project_name !== filterProject) return false;
      if (filterChannel !== 'all' && (l.channel || l.source) !== filterChannel) return false;
      if (filterCRMStatus !== 'all' && l.crm_status !== filterCRMStatus) return false;
      if (filterAgent !== 'all' && (l.agent_name || l.created_by_agent) !== filterAgent) return false;
      
      if (search) {
        const q = search.toLowerCase();
        const matchName = l.customer_name?.toLowerCase().includes(q);
        const matchPhone = l.phone?.includes(q);
        const matchPlot = l.interested_plot_name?.toLowerCase().includes(q);
        const matchNotes = l.notes?.toLowerCase().includes(q);
        if (!matchName && !matchPhone && !matchPlot && !matchNotes) return false;
      }
      return true;
    });
  }, [leads, filterProject, filterChannel, filterCRMStatus, filterAgent, search]);

  // Handle Quick Add New Lead
  const handleCreateLead = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const now = new Date().toISOString();
      const payload = {
        customer_name: newLeadForm.customer_name,
        phone: newLeadForm.phone,
        occupation: newLeadForm.occupation,
        project_name: newLeadForm.project_name,
        channel: newLeadForm.channel,
        source: newLeadForm.channel,
        agent_name: newLeadForm.agent_name,
        created_by_agent: user?.username || newLeadForm.agent_name,
        interested_plot_name: newLeadForm.interested_plot_name,
        lead_date: now,
        contacted_date: now,
        appointment_date: newLeadForm.appointment_date ? new Date(newLeadForm.appointment_date).toISOString() : null,
        crm_status: 'Follow-up — อยู่ระหว่างติดตาม',
        auto_status: newLeadForm.appointment_date ? 'นัดชมแล้ว' : 'ติดต่อได้',
        notes: newLeadForm.notes,
        created_at: now
      };

      const { error } = await supabase.from('leads').insert([payload]);
      if (error) throw error;

      setShowAddLeadModal(false);
      setNewLeadForm({
        customer_name: '',
        phone: '',
        occupation: '',
        project_name: selectedProjectName !== 'all' ? selectedProjectName : (projects[0]?.name || 'ไอลิน สันทราย 2'),
        channel: 'Facebook',
        agent_name: user?.username || 'Bell',
        interested_plot_name: '',
        appointment_date: '',
        notes: ''
      });
      onRefresh();
    } catch (err) {
      console.error('Error creating lead:', err);
      alert('บันทึก Lead ไม่สำเร็จ');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle Quick Status Update
  const handleUpdateCRMStatus = async (leadId: string, newStatus: string) => {
    try {
      await supabase.from('leads').update({ crm_status: newStatus }).eq('id', leadId);
      onRefresh();
    } catch (err) {
      console.error('Error updating status:', err);
    }
  };

  // Handle Log Follow-up
  const handleLogFollowUp = async (lead: Lead, note: string) => {
    setIsSubmitting(true);
    try {
      const currentCount = lead.follow_up_count || 0;
      const now = new Date().toISOString();
      const newNote = note ? `${lead.notes ? lead.notes + ' | ' : ''}Follow-up #${currentCount + 1}: ${note}` : lead.notes;

      await supabase.from('leads').update({
        follow_up_count: currentCount + 1,
        last_follow_up_date: now,
        notes: newNote
      }).eq('id', lead.id);

      setShowFollowUpModal({ isOpen: false, lead: null });
      onRefresh();
    } catch (err) {
      console.error('Error logging follow-up:', err);
      alert('บันทึกการติดตามไม่สำเร็จ');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle Visit Check-in
  const handleCheckInVisit = async (lead: Lead, plotName: string, notes: string) => {
    setIsSubmitting(true);
    try {
      const now = new Date().toISOString();
      await supabase.from('leads').update({
        actual_visit_date: now,
        interested_plot_name: plotName || lead.interested_plot_name,
        auto_status: 'เข้าชมแล้ว',
        crm_status: 'Considering — กำลังพิจารณา / เปรียบเทียบ',
        status: 'Visit',
        notes: notes ? `${lead.notes ? lead.notes + ' | ' : ''}เข้าชมโครงการ: ${notes}` : lead.notes
      }).eq('id', lead.id);

      setShowVisitModal({ isOpen: false, lead: null });
      onRefresh();
    } catch (err) {
      console.error('Error check-in visit:', err);
      alert('เช็คอินเข้าชมไม่สำเร็จ');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle Convert to Booking
  const handleConvertToBooking = async (lead: Lead, plotId: string, plotName: string, salePrice: number, bookingAmount: number) => {
    setIsSubmitting(true);
    try {
      const now = new Date().toISOString();
      const closingAgent = user?.username || lead.agent_name || 'Unknown';

      // 1. Update Lead
      await supabase.from('leads').update({
        booking_date: now,
        booking_amount: bookingAmount,
        interested_plot_id: plotId,
        interested_plot_name: plotName,
        closing_agent: closingAgent,
        crm_status: 'Booked — จองแล้ว',
        auto_status: 'จองแล้ว',
        status: 'Reserved'
      }).eq('id', lead.id);

      // 2. Insert into sales table
      if (plotId) {
        await supabase.from('sales').insert([{
          lead_id: lead.id,
          plot_id: plotId,
          sale_price: salePrice,
          booking_amount: bookingAmount,
          contract_status: 'Reserved',
          created_at: now
        }]);

        // 3. Lock plot in plots table
        await supabase.from('plots').update({
          has_customer: true,
          sale_status: 'Reserved'
        }).eq('id', plotId);
      }

      setShowBookingModal({ isOpen: false, lead: null });
      onRefresh();
    } catch (err) {
      console.error('Error converting to booking:', err);
      alert('ดำเนินการจองไม่สำเร็จ');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle Mark as Lost
  const handleMarkAsLost = async (lead: Lead, reason: string, detail: string) => {
    setIsSubmitting(true);
    try {
      await supabase.from('leads').update({
        lost_reason: reason,
        lost_reason_detail: detail,
        crm_status: 'Lost — ยุติการซื้อ / ไม่จอง',
        auto_status: 'Lost',
        status: 'Cancelled'
      }).eq('id', lead.id);

      // If had a plot reserved, free it up
      if (lead.interested_plot_id) {
        await supabase.from('plots').update({
          has_customer: false,
          sale_status: 'ready_for_sale'
        }).eq('id', lead.interested_plot_id);

        await supabase.from('sales').update({
          contract_status: 'Cancelled',
          cancellation_reason: reason
        }).eq('lead_id', lead.id);
      }

      setShowLostModal({ isOpen: false, lead: null });
      onRefresh();
    } catch (err) {
      console.error('Error marking as lost:', err);
      alert('บันทึก Lost ไม่สำเร็จ');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Export to Excel (.xlsx) matching ailin_funnel_sep2569_v3
  const handleExportExcel = () => {
    const dataToExport = filteredLeads.map((l, i) => ({
      'No.': i + 1,
      'วันที่ Lead เข้า': l.lead_date ? new Date(l.lead_date).toLocaleDateString('th-TH') : '',
      'ชื่อลูกค้า': l.customer_name,
      'เบอร์โทร': l.phone || '',
      'โครงการ': l.project_name || '',
      'ช่องทาง': l.channel || l.source || '',
      'เซลล์': l.agent_name || l.created_by_agent || '',
      'ติดต่อได้ (วันที่)': l.contacted_date ? new Date(l.contacted_date).toLocaleDateString('th-TH') : '',
      'นัดชม (วันที่)': l.appointment_date ? new Date(l.appointment_date).toLocaleDateString('th-TH') : '',
      'เข้าชมจริง (วันที่)': l.actual_visit_date ? new Date(l.actual_visit_date).toLocaleDateString('th-TH') : '',
      'Follow-up (ครั้ง)': l.follow_up_count || 0,
      'Follow-up ล่าสุด': l.last_follow_up_date ? new Date(l.last_follow_up_date).toLocaleDateString('th-TH') : '',
      'แปลงที่เล็ง/จอง': l.interested_plot_name || '',
      'จอง (วันที่)': l.booking_date ? new Date(l.booking_date).toLocaleDateString('th-TH') : '',
      'มูลค่าจอง (บาท)': l.booking_amount || '',
      'ยื่นกู้ (วันที่)': l.loan_submission_date ? new Date(l.loan_submission_date).toLocaleDateString('th-TH') : '',
      'อนุมัติ (วันที่)': l.loan_approved_date ? new Date(l.loan_approved_date).toLocaleDateString('th-TH') : '',
      'โอน (วันที่)': l.transferred_date ? new Date(l.transferred_date).toLocaleDateString('th-TH') : '',
      'Lost Reason (เลือก)': l.lost_reason || '',
      'Lost Reason (ระบุ)': l.lost_reason_detail || '',
      'CRM Status': l.crm_status || 'Follow-up — อยู่ระหว่างติดตาม',
      'หมายเหตุ': l.notes || ''
    }));

    const ws = XLSX.utils.json_to_sheet(dataToExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Lead Tracker');
    XLSX.writeFile(wb, `Ailin_Lead_Tracker_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  // Download 22-column Excel Template
  const handleDownloadTemplate = () => {
    const projectNames = projects?.map((p: any) => p.name) || [];
    downloadLeadTrackerTemplate(
      projectNames.length > 0 ? projectNames : ['ไอลิน 3', 'ไอลิน 4', 'ไอลิน 6', 'ไอลิน สันทราย 2'],
      user?.username || 'Bell'
    );
  };

  // Handle Excel File Upload & Parse
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const XLSXLib = await import('xlsx');
        const bstr = event.target?.result;
        const wb = XLSXLib.read(bstr, { type: 'binary' });

        const sheetName = wb.SheetNames.find(n => n.includes('Lead') || n.includes('Tracker')) || wb.SheetNames[0];
        const ws = wb.Sheets[sheetName];
        const rawRows = XLSXLib.utils.sheet_to_json(ws);

        if (!rawRows || rawRows.length === 0) {
          alert('ไม่พบข้อมูลในไฟล์ กรุณาตรวจสอบการกรอกข้อมูล');
          return;
        }

        const defaultProj = selectedProjectName !== 'all' ? selectedProjectName : (projects[0]?.name || 'ไอลิน 6');
        const defaultAg = user?.username || 'ส่วนกลาง';

        const parsedRows: ParsedLeadRow[] = [];
        for (let i = 0; i < rawRows.length; i++) {
          const rowObj = rawRows[i] as Record<string, any>;
          const parsed = parseExcelRowToLead(rowObj, i + 2, defaultProj, defaultAg);
          if (parsed) {
            if (parsed.interested_plot_name && plots.length > 0) {
              const normalizedPlot = parsed.interested_plot_name.replace(/\s+/g, '').toLowerCase();
              const matched = plots.find(p => {
                const pName = (p.plot_name || '').replace(/\s+/g, '').toLowerCase();
                return pName === normalizedPlot || p.id === parsed.interested_plot_name;
              });
              if (matched) {
                parsed.matched_plot_id = matched.id;
              }
            }
            parsedRows.push(parsed);
          }
        }

        if (parsedRows.length === 0) {
          alert('ไม่พบแถวข้อมูลลูกค้าที่ถูกต้องในไฟล์ (ต้องมีข้อมูลชื่อลูกค้า)');
          return;
        }

        setImportData(parsedRows);
      } catch (err) {
        console.error('Error parsing Excel:', err);
        alert('ไฟล์ไม่ถูกต้องหรือไม่สามารถอ่านได้ครับ');
      }
    };
    reader.readAsBinaryString(file);
  };

  // Confirm Import & Save to Database
  const handleConfirmImport = async () => {
    if (importData.length === 0) return;
    setIsImporting(true);
    try {
      let updatedCount = 0;
      let insertedCount = 0;

      const { data: allLeadsData } = await supabase.from('leads').select('id, customer_name, phone, project_name, status, agent_name, created_at');

      for (const row of importData) {
        const existingLead = allLeadsData?.find(l => 
          l.customer_name?.toLowerCase() === row.customer_name.toLowerCase() && 
          (row.phone ? l.phone === row.phone : true) && 
          (l.project_name === row.project_name || (!l.project_name && !row.project_name))
        );

        const leadPayload = {
          customer_name: row.customer_name,
          phone: row.phone,
          project_name: row.project_name,
          channel: row.channel,
          source: row.channel,
          agent_name: row.agent_name,
          lead_date: row.lead_date,
          contacted_date: row.contacted_date,
          appointment_date: row.appointment_date,
          actual_visit_date: row.actual_visit_date,
          follow_up_count: row.follow_up_count,
          last_follow_up_date: row.last_follow_up_date,
          interested_plot_id: row.matched_plot_id || null,
          interested_plot_name: row.interested_plot_name || null,
          booking_date: row.booking_date,
          booking_amount: row.booking_amount,
          loan_submission_date: row.loan_submission_date,
          loan_approved_date: row.loan_approved_date,
          transferred_date: row.transferred_date,
          lost_reason: row.lost_reason,
          lost_reason_detail: row.lost_reason_detail,
          crm_status: row.crm_status,
          auto_status: row.auto_status,
          notes: row.notes,
          occupation: row.occupation,
          interest: row.interest,
          status: row.legacy_status,
          created_by_agent: user?.username || row.agent_name
        };

        let currentLeadId = '';

        if (existingLead) {
          await supabase.from('leads').update(leadPayload).eq('id', existingLead.id);
          currentLeadId = existingLead.id;
          updatedCount++;
        } else {
          const { data: newLeads, error: newLeadsErr } = await supabase.from('leads').insert([{
            ...leadPayload,
            created_at: row.lead_date || new Date().toISOString()
          }]).select();

          if (newLeadsErr) {
            console.error('Insert Lead Error:', newLeadsErr);
            continue;
          }
          if (newLeads && newLeads.length > 0) {
            currentLeadId = newLeads[0].id;
            insertedCount++;
          }
        }

        if (currentLeadId && (row.matched_plot_id || row.booking_date || row.crm_status.includes('จอง') || row.crm_status.includes('โอน') || row.crm_status.includes('สัญญา'))) {
          const contractStatus = row.transferred_date || row.crm_status.includes('โอน') ? 'Transferred' : (row.crm_status.includes('สัญญา') ? 'Contracted' : 'Reserved');
          const salePrice = row.sale_price || row.booking_amount || 0;

          const { data: existingSale } = await supabase.from('sales').select('id').eq('lead_id', currentLeadId).maybeSingle();

          const salePayload = {
            plot_id: row.matched_plot_id || null,
            sale_price: salePrice,
            booking_amount: row.booking_amount,
            land_office_price: row.land_office_price,
            contract_status: contractStatus,
            ...(row.transferred_date ? { transferred_at: row.transferred_date } : {})
          };

          if (existingSale) {
            await supabase.from('sales').update(salePayload).eq('id', existingSale.id);
          } else {
            await supabase.from('sales').insert([{
              lead_id: currentLeadId,
              ...salePayload,
              bank_status: row.loan_approved_date ? 'Approved' : (row.loan_submission_date ? 'Pre-approved' : 'Pending'),
              created_at: row.booking_date || row.lead_date || new Date().toISOString()
            }]);
          }

          if (row.matched_plot_id) {
            await supabase.from('plots').update({
              has_customer: true,
              sale_status: row.transferred_date ? 'transferred' : 'sold'
            }).eq('id', row.matched_plot_id);
          }
        }
      }

      setShowImportModal(false);
      setImportData([]);
      onRefresh();
      alert(`นำเข้าข้อมูลสำเร็จ: อัปเดตข้อมูลเดิม ${updatedCount} รายการ, เพิ่มข้อมูลใหม่ ${insertedCount} รายการ`);
    } catch (err) {
      console.error('Error importing leads:', err);
      alert('เกิดข้อผิดพลาดในการนำเข้าข้อมูล โปรดลองอีกครั้ง');
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="space-y-4 animate-fade-in p-2 sm:p-4">
      
      {/* 🚀 Header & Quick Action Bar 🚀 */}
      <div className="bg-white p-4 sm:p-5 rounded-2xl shadow-sm border border-slate-200/80 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg sm:text-xl font-black text-slate-800 flex items-center gap-2">
            <span className="p-2 rounded-xl bg-blue-50 text-blue-600"><FileText size={20} /></span>
            📋 Lead Tracker (ระบบจัดการและติดตามลูกค้ามุ่งหวัง)
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            ติดตามลูกค้าครบวงจร 22 คอลัมน์ (Lead ➡️ Visit ➡️ Book ➡️ Transfer)
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          <button
            onClick={() => setShowAddLeadModal(true)}
            className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2.5 rounded-xl text-xs flex items-center gap-2 shadow-sm transition-all cursor-pointer"
          >
            <Plus size={16} /> + เพิ่ม Lead ใหม่ (ทักแชท/โทร)
          </button>

          <button
            onClick={() => setShowImportModal(true)}
            className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-3 py-2.5 rounded-xl text-xs flex items-center gap-1.5 transition-colors cursor-pointer shadow-sm"
          >
            <Upload size={15} /> นำเข้า Excel (.xlsx)
          </button>
          
          <button
            onClick={handleExportExcel}
            className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold px-3 py-2.5 rounded-xl text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <Download size={15} /> ส่งออก Excel (.xlsx)
          </button>
        </div>
      </div>

      {/* 🔍 Search & Filters Bar */}
      <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200/80 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="ค้นหาชื่อลูกค้า, เบอร์โทร, แปลงที่เล็ง, โน้ต..."
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
          value={filterChannel}
          onChange={e => setFilterChannel(e.target.value)}
          className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="all">📱 ทุกช่องทาง</option>
          {CHANNELS.map(c => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>

        <select
          value={filterCRMStatus}
          onChange={e => setFilterCRMStatus(e.target.value)}
          className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 max-w-[200px]"
        >
          <option value="all">📊 ทุกสถานะ CRM</option>
          {CRM_STATUS_LIST.map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      {/* 📊 Interactive Lead Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200/80 overflow-hidden">
        <div className="overflow-x-auto max-h-[680px]">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200 sticky top-0 z-10 shadow-sm">
              <tr>
                <th className="p-3 whitespace-nowrap">No.</th>
                <th className="p-3 whitespace-nowrap">วันที่เข้า</th>
                <th className="p-3 whitespace-nowrap">ชื่อลูกค้า</th>
                <th className="p-3 whitespace-nowrap">เบอร์โทร</th>
                <th className="p-3 whitespace-nowrap">โครงการ</th>
                <th className="p-3 whitespace-nowrap">ช่องทาง</th>
                <th className="p-3 whitespace-nowrap">เซลล์</th>
                <th className="p-3 whitespace-nowrap">แปลงที่เล็ง</th>
                <th className="p-3 whitespace-nowrap text-center">นัดชม</th>
                <th className="p-3 whitespace-nowrap text-center">เข้าชมจริง</th>
                <th className="p-3 whitespace-nowrap text-center">Follow-up</th>
                <th className="p-3 whitespace-nowrap">สถานะ CRM</th>
                <th className="p-3 whitespace-nowrap text-right">การจัดการด่วน</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium">
              {filteredLeads.length === 0 ? (
                <tr>
                  <td colSpan={13} className="text-center py-12 text-slate-400">
                    ไม่พบข้อมูลลูกค้าตามเงื่อนไขที่ค้นหา
                  </td>
                </tr>
              ) : (
                filteredLeads.map((l, index) => {
                  const hasVisited = !!l.actual_visit_date;
                  const isBooked = l.crm_status?.includes('Booked') || l.status === 'Reserved';
                  const isLost = l.crm_status?.includes('Lost') || l.status === 'Cancelled';

                  return (
                    <tr key={l.id} className="hover:bg-slate-50/80 transition-colors group">
                      <td className="p-3 font-bold text-slate-400">{index + 1}</td>
                      <td className="p-3 text-slate-500 whitespace-nowrap">
                        {l.lead_date ? new Date(l.lead_date).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }) : '-'}
                      </td>
                      <td className="p-3 font-bold text-slate-900 whitespace-nowrap">
                        {l.customer_name}
                        {l.occupation && <span className="block text-[10px] text-slate-400 font-normal">{l.occupation}</span>}
                      </td>
                      <td className="p-3 text-slate-600 font-mono whitespace-nowrap">{l.phone || '-'}</td>
                      <td className="p-3 font-semibold text-slate-700 whitespace-nowrap">{l.project_name || '-'}</td>
                      <td className="p-3 whitespace-nowrap">
                        <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 font-semibold text-[11px] border border-slate-200">
                          {l.channel || l.source || 'Walk in'}
                        </span>
                      </td>
                      <td className="p-3 text-slate-700 whitespace-nowrap font-medium">
                        {l.agent_name || l.created_by_agent || '-'}
                      </td>
                      <td className="p-3 whitespace-nowrap font-bold text-indigo-700">
                        {l.interested_plot_name ? `🏠 ${l.interested_plot_name}` : '-'}
                      </td>
                      <td className="p-3 text-center whitespace-nowrap">
                        {l.appointment_date ? (
                          <span className="text-cyan-700 font-bold bg-cyan-50 px-2 py-0.5 rounded-md border border-cyan-200">
                            {new Date(l.appointment_date).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })}
                          </span>
                        ) : '-'}
                      </td>
                      <td className="p-3 text-center whitespace-nowrap">
                        {hasVisited ? (
                          <span className="text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200 flex items-center justify-center gap-1">
                            <Check size={12} /> {new Date(l.actual_visit_date!).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })}
                          </span>
                        ) : (
                          <button
                            onClick={() => setShowVisitModal({ isOpen: true, lead: l })}
                            className="text-[11px] font-bold text-blue-600 hover:text-blue-800 bg-blue-50 px-2 py-0.5 rounded-md border border-blue-200 cursor-pointer"
                          >
                            + เช็คอินเข้าชม
                          </button>
                        )}
                      </td>
                      <td className="p-3 text-center whitespace-nowrap">
                        <button
                          onClick={() => setShowFollowUpModal({ isOpen: true, lead: l })}
                          className="font-bold text-amber-700 bg-amber-50 hover:bg-amber-100 px-2 py-0.5 rounded-md border border-amber-200 inline-flex items-center gap-1 cursor-pointer"
                          title="กดเพื่อบันทึก Follow-up"
                        >
                          <Phone size={11} /> {l.follow_up_count || 0} ครั้ง
                        </button>
                      </td>
                      <td className="p-3 whitespace-nowrap">
                        <select
                          value={l.crm_status || 'Follow-up — อยู่ระหว่างติดตาม'}
                          onChange={e => handleUpdateCRMStatus(l.id, e.target.value)}
                          className={`text-xs font-bold px-2 py-1 rounded-lg border focus:outline-none cursor-pointer ${
                            isBooked ? 'bg-orange-50 text-orange-800 border-orange-200' :
                            isLost ? 'bg-rose-50 text-rose-800 border-rose-200' :
                            'bg-slate-50 text-slate-700 border-slate-200'
                          }`}
                        >
                          {CRM_STATUS_LIST.map(s => (
                            <option key={s} value={s}>{s}</option>
                          ))}
                        </select>
                      </td>
                      <td className="p-3 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* Button 1: Convert to Booking */}
                          {!isBooked && !isLost && (
                            <button
                              onClick={() => setShowBookingModal({ isOpen: true, lead: l })}
                              className="bg-orange-600 hover:bg-orange-700 text-white font-bold px-2.5 py-1 rounded-lg text-xs flex items-center gap-1 shadow-sm transition-colors cursor-pointer"
                              title="เปลี่ยนเป็นวางเงินจอง"
                            >
                              <Home size={12} /> จองแปลง
                            </button>
                          )}

                          {/* Button 2: Survey */}
                          <button
                            onClick={() => setShowSurveyModal({ isOpen: true, lead: l })}
                            className="bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold p-1.5 rounded-lg text-xs transition-colors cursor-pointer"
                            title="ทำแบบสอบถาม Customer Voices"
                          >
                            <MessageSquare size={14} />
                          </button>

                          {/* Button 3: Lost */}
                          {!isLost && (
                            <button
                              onClick={() => setShowLostModal({ isOpen: true, lead: l })}
                              className="bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold p-1.5 rounded-lg text-xs transition-colors cursor-pointer"
                              title="ระบุเป็น Lost / ยกเลิก"
                            >
                              <XCircle size={14} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ➕ Modal 1: Add New Lead */}
      {showAddLeadModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-3xl max-w-lg w-full shadow-2xl border border-slate-200 overflow-hidden">
            <div className="bg-blue-900 px-6 py-4 text-white flex justify-between items-center">
              <h3 className="font-black text-base flex items-center gap-2">
                <Plus size={18} /> + บันทึก Lead ใหม่ (Inbound / แชท / โทร)
              </h3>
              <button onClick={() => setShowAddLeadModal(false)} className="text-white/80 hover:text-white cursor-pointer">
                <XCircle size={20} />
              </button>
            </div>
            <form onSubmit={handleCreateLead} className="p-6 space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="block text-slate-700 font-bold mb-1">ชื่อลูกค้า *</label>
                  <input
                    type="text"
                    required
                    value={newLeadForm.customer_name}
                    onChange={e => setNewLeadForm({ ...newLeadForm, customer_name: e.target.value })}
                    placeholder="เช่น คุณสมชาย ใจดี"
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 font-medium focus:ring-2 focus:ring-blue-500 focus:bg-white focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-bold mb-1">เบอร์โทร</label>
                  <input
                    type="text"
                    value={newLeadForm.phone}
                    onChange={e => setNewLeadForm({ ...newLeadForm, phone: e.target.value })}
                    placeholder="081-xxx-xxxx"
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 font-medium focus:ring-2 focus:ring-blue-500 focus:bg-white focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-bold mb-1">อาชีพ</label>
                  <input
                    type="text"
                    value={newLeadForm.occupation}
                    onChange={e => setNewLeadForm({ ...newLeadForm, occupation: e.target.value })}
                    placeholder="เช่น พนักงานเอกชน, เจ้าของธุรกิจ"
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 font-medium focus:ring-2 focus:ring-blue-500 focus:bg-white focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-bold mb-1">โครงการ</label>
                  <select
                    value={newLeadForm.project_name}
                    onChange={e => setNewLeadForm({ ...newLeadForm, project_name: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 font-bold focus:ring-2 focus:ring-blue-500 focus:bg-white focus:outline-none"
                  >
                    {projects.map((p: any) => (
                      <option key={p.id || p.name} value={p.name}>{p.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-slate-700 font-bold mb-1">ช่องทางการติดต่อ</label>
                  <select
                    value={newLeadForm.channel}
                    onChange={e => setNewLeadForm({ ...newLeadForm, channel: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 font-bold focus:ring-2 focus:ring-blue-500 focus:bg-white focus:outline-none"
                  >
                    {CHANNELS.map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-slate-700 font-bold mb-1">แปลงที่เล็งไว้ (ถ้ามี)</label>
                  <input
                    type="text"
                    value={newLeadForm.interested_plot_name}
                    onChange={e => setNewLeadForm({ ...newLeadForm, interested_plot_name: e.target.value })}
                    placeholder="เช่น A-05"
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 font-medium focus:ring-2 focus:ring-blue-500 focus:bg-white focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-bold mb-1">วันนัดชมโครงการ (ถ้ามี)</label>
                  <input
                    type="date"
                    value={newLeadForm.appointment_date}
                    onChange={e => setNewLeadForm({ ...newLeadForm, appointment_date: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 font-medium focus:ring-2 focus:ring-blue-500 focus:bg-white focus:outline-none"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-slate-700 font-bold mb-1">หมายเหตุ / ความต้องการ</label>
                  <textarea
                    rows={2}
                    value={newLeadForm.notes}
                    onChange={e => setNewLeadForm({ ...newLeadForm, notes: e.target.value })}
                    placeholder="เช่น งบ 3.5 ล้าน, ชอบบ้านแปลงมุม, นัดดูวันเสาร์บ่าย"
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 font-medium focus:ring-2 focus:ring-blue-500 focus:bg-white focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddLeadModal(false)}
                  className="px-4 py-2 rounded-xl border border-slate-300 font-bold text-slate-600 hover:bg-slate-100"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-5 py-2 rounded-xl flex items-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  {isSubmitting ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  บันทึก Lead
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 📞 Modal 2: Log Follow-up */}
      {showFollowUpModal.isOpen && showFollowUpModal.lead && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl p-6 space-y-4 border border-slate-200">
            <h3 className="font-black text-base text-slate-800 flex items-center gap-2">
              <Phone className="text-amber-500" size={18} /> บันทึกการ Follow-up ลูกค้า
            </h3>
            <p className="text-xs text-slate-500">
              ลูกค้า: <strong className="text-slate-800">{showFollowUpModal.lead.customer_name}</strong> (ปัจจุบัน Follow-up ไปแล้ว {showFollowUpModal.lead.follow_up_count || 0} ครั้ง)
            </p>
            
            <form onSubmit={(e: any) => {
              e.preventDefault();
              handleLogFollowUp(showFollowUpModal.lead!, e.target.note.value);
            }} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-700 font-bold mb-1">ผลการพูดคุย / ติดตามผลรอบนี้ *</label>
                <textarea
                  name="note"
                  required
                  rows={3}
                  placeholder="เช่น โทรแจ้งโปรโมชั่นใหม่ ลูกค้าขอเวลาเช็คสเตทเม้นท์ นัดคุยอีกทีวันจันทร์"
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl p-3 font-medium focus:ring-2 focus:ring-amber-500 focus:bg-white focus:outline-none"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowFollowUpModal({ isOpen: false, lead: null })}
                  className="px-4 py-2 rounded-xl border border-slate-300 font-bold text-slate-600 hover:bg-slate-100"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="bg-amber-600 hover:bg-amber-700 text-white font-bold px-5 py-2 rounded-xl flex items-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  {isSubmitting ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  + นับ Follow-up เพิ่ม 1 ครั้ง
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 📍 Modal 3: Check-in Visit */}
      {showVisitModal.isOpen && showVisitModal.lead && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl p-6 space-y-4 border border-slate-200">
            <h3 className="font-black text-base text-slate-800 flex items-center gap-2">
              <MapPin className="text-emerald-500" size={18} /> 📍 เช็คอินลูกค้าเข้าชมโครงการจริง
            </h3>
            <p className="text-xs text-slate-500">
              ลูกค้า: <strong className="text-slate-800">{showVisitModal.lead.customer_name}</strong> ({showVisitModal.lead.phone})
            </p>
            
            <form onSubmit={(e: any) => {
              e.preventDefault();
              handleCheckInVisit(showVisitModal.lead!, e.target.plotName.value, e.target.notes.value);
            }} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-700 font-bold mb-1">แปลงที่ลูกค้าสนใจเป็นพิเศษ</label>
                <input
                  name="plotName"
                  type="text"
                  defaultValue={showVisitModal.lead.interested_plot_name || ''}
                  placeholder="เช่น A-05, B-12"
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl p-3 font-medium focus:ring-2 focus:ring-emerald-500 focus:bg-white focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-slate-700 font-bold mb-1">ความคิดเห็นลูกค้าตอนพาชม</label>
                <textarea
                  name="notes"
                  rows={2}
                  placeholder="เช่น ชอบวิวหน้าสวน ขอกลับไปคุยกับครอบครัวก่อน"
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl p-3 font-medium focus:ring-2 focus:ring-emerald-500 focus:bg-white focus:outline-none"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowVisitModal({ isOpen: false, lead: null })}
                  className="px-4 py-2 rounded-xl border border-slate-300 font-bold text-slate-600 hover:bg-slate-100"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-5 py-2 rounded-xl flex items-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  {isSubmitting ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  ยืนยันการเข้าชมจริง
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 🚀 Modal 4: Convert to Booking */}
      {showBookingModal.isOpen && showBookingModal.lead && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-3xl max-w-lg w-full shadow-2xl p-6 space-y-4 border border-slate-200">
            <h3 className="font-black text-base text-slate-800 flex items-center gap-2">
              <Home className="text-orange-500" size={18} /> 🚀 วางเงินจองและล็อกแปลง (Convert to Booking)
            </h3>
            <p className="text-xs text-slate-500">
              ลูกค้า: <strong className="text-slate-800">{showBookingModal.lead.customer_name}</strong> | เซลล์ผู้ปิดการขาย: <strong className="text-orange-600">{user?.username || 'Current User'}</strong>
            </p>
            
            <form onSubmit={(e: any) => {
              e.preventDefault();
              const plotSelect = e.target.plotSelect;
              const selectedOpt = plotSelect.options[plotSelect.selectedIndex];
              const pId = selectedOpt.value;
              const pName = selectedOpt.text;
              const price = Number(e.target.salePrice.value) || 0;
              const deposit = Number(e.target.bookingAmount.value) || 0;
              handleConvertToBooking(showBookingModal.lead!, pId, pName, price, deposit);
            }} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-700 font-bold mb-1">เลือกแปลงที่ต้องการจอง *</label>
                <select
                  name="plotSelect"
                  required
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl p-3 font-bold focus:ring-2 focus:ring-orange-500 focus:bg-white focus:outline-none"
                >
                  <option value="">-- เลือกแปลงบ้าน --</option>
                  {plots.filter(p => !p.has_customer && p.sale_status !== 'transferred').map((p: any) => (
                    <option key={p.id} value={p.id}>
                      {p.plot_name || p.id} ({p.house_types?.type_name || 'แบบบ้านมาตรฐาน'}) - ฿{(p.selling_price || 0).toLocaleString()}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-bold mb-1">ราคาขายตกลง (บาท) *</label>
                  <input
                    name="salePrice"
                    type="number"
                    required
                    defaultValue={3000000}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl p-3 font-bold text-slate-800 focus:ring-2 focus:ring-orange-500 focus:bg-white focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-bold mb-1">เงินจอง (บาท) *</label>
                  <input
                    name="bookingAmount"
                    type="number"
                    required
                    defaultValue={10000}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl p-3 font-bold text-slate-800 focus:ring-2 focus:ring-orange-500 focus:bg-white focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowBookingModal({ isOpen: false, lead: null })}
                  className="px-4 py-2 rounded-xl border border-slate-300 font-bold text-slate-600 hover:bg-slate-100"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="bg-orange-600 hover:bg-orange-700 text-white font-bold px-5 py-2.5 rounded-xl flex items-center gap-2 cursor-pointer shadow-lg shadow-orange-500/20 disabled:opacity-50"
                >
                  {isSubmitting ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  ล็อกแปลง & บันทึกจองทันที
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ❌ Modal 5: Mark as Lost */}
      {showLostModal.isOpen && showLostModal.lead && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl p-6 space-y-4 border border-slate-200">
            <h3 className="font-black text-base text-rose-800 flex items-center gap-2">
              <XCircle className="text-rose-600" size={18} /> ระบุสาเหตุที่ยุติการซื้อ (Lost Lead)
            </h3>
            <p className="text-xs text-slate-500">
              ลูกค้า: <strong className="text-slate-800">{showLostModal.lead.customer_name}</strong>
            </p>
            
            <form onSubmit={(e: any) => {
              e.preventDefault();
              handleMarkAsLost(showLostModal.lead!, e.target.reason.value, e.target.detail.value);
            }} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-700 font-bold mb-1">สาเหตุหลักที่ไม่ซื้อ (Lost Reason) *</label>
                <select
                  name="reason"
                  required
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl p-3 font-bold focus:ring-2 focus:ring-rose-500 focus:bg-white focus:outline-none"
                >
                  {LOST_REASONS.map(r => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-slate-700 font-bold mb-1">รายละเอียดเพิ่มเติม (ถ้ามี)</label>
                <textarea
                  name="detail"
                  rows={2}
                  placeholder="เช่น ลูกค้าติดภาระหนี้บัตร 3 ใบ / ตัดสินใจไปซื้อโครงการอื่นแถวแม่โจ้"
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl p-3 font-medium focus:ring-2 focus:ring-rose-500 focus:bg-white focus:outline-none"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowLostModal({ isOpen: false, lead: null })}
                  className="px-4 py-2 rounded-xl border border-slate-300 font-bold text-slate-600 hover:bg-slate-100"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="bg-rose-600 hover:bg-rose-700 text-white font-bold px-5 py-2 rounded-xl flex items-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  {isSubmitting ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  บันทึก Lost (ปลดล็อกแปลง)
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 🗣️ Customer Voices Modal */}
      {showSurveyModal.isOpen && (
        <CustomerVoicesModal
          isOpen={showSurveyModal.isOpen}
          onClose={() => setShowSurveyModal({ isOpen: false, lead: null })}
          lead={showSurveyModal.lead}
          projectName={showSurveyModal.lead?.project_name || selectedProjectName}
          user={user}
          onSaved={onRefresh}
        />
      )}

      {/* 📥 Excel Import Modal 📥 */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col border border-slate-200">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-5 sm:p-6 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-emerald-50 text-emerald-600 rounded-2xl">
                  <Upload size={22} />
                </div>
                <div>
                  <h2 className="text-lg sm:text-xl font-black text-slate-800">
                    นำเข้าข้อมูลลูกค้า & Lead Tracker ด้วย Excel (.xlsx)
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    รองรับไฟล์ Funnel 22 คอลัมน์ภาษาไทย และไฟล์ Excel เดิม พร้อมระบบจับคู่อัตโนมัติ
                  </p>
                </div>
              </div>
              <button 
                onClick={() => { setShowImportModal(false); setImportData([]); }}
                className="text-slate-400 hover:text-slate-600 p-2 rounded-xl hover:bg-slate-100 transition-colors"
              >
                <XCircle size={22} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 sm:p-6 overflow-y-auto flex-1 space-y-4">
              <div className="bg-emerald-50/70 border border-emerald-200/70 p-4 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="space-y-1">
                  <h4 className="font-bold text-emerald-900 text-xs flex items-center gap-1.5">
                    <CheckCircle size={15} className="text-emerald-600" />
                    โครงสร้างไฟล์ที่แนะนำ (22 คอลัมน์มาตรฐาน)
                  </h4>
                  <p className="text-[11px] text-emerald-700 leading-relaxed">
                    มีคอลัมน์: วันที่ Lead เข้า, ชื่อลูกค้า (*จำเป็น), เบอร์โทร, โครงการ, ช่องทาง, เซลล์, วันที่นัดชม, เข้าชมจริง, แปลง, วันที่จอง, ยื่นกู้, โอน, CRM Status, Lost Reason ฯลฯ
                  </p>
                </div>
                <button
                  onClick={handleDownloadTemplate}
                  className="bg-white border border-emerald-300 text-emerald-800 px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 hover:bg-emerald-100 shrink-0 shadow-sm cursor-pointer"
                >
                  <Download size={14} /> ดาวน์โหลด Template (22 คอลัมน์)
                </button>
              </div>

              {/* Upload Input */}
              <div className="bg-slate-50 border border-dashed border-slate-300 rounded-2xl p-5 text-center">
                <label className="block text-xs font-bold text-slate-700 mb-2">เลือกไฟล์ Excel ที่ต้องการนำเข้า (.xlsx, .xls, .csv)</label>
                <input 
                  type="file" 
                  accept=".xlsx, .xls, .csv" 
                  onChange={handleFileUpload}
                  className="block w-full max-w-md mx-auto text-xs text-slate-500 file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-emerald-600 file:text-white hover:file:bg-emerald-700 cursor-pointer border border-slate-200 rounded-xl bg-white"
                />
              </div>

              {/* Preview Table */}
              {importData.length > 0 && (
                <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                  <div className="bg-slate-100/80 px-4 py-3 border-b border-slate-200 flex justify-between items-center">
                    <span className="font-black text-xs text-slate-800 flex items-center gap-2">
                      <Check size={14} className="text-emerald-600" />
                      Preview ข้อมูลที่ตรวจพบ ({importData.length} รายการ)
                    </span>
                    <span className="text-[11px] text-slate-500 bg-white px-2.5 py-0.5 rounded-full border border-slate-200 font-semibold">
                      พร้อมนำเข้า
                    </span>
                  </div>
                  <div className="overflow-x-auto max-h-[320px]">
                    <table className="w-full text-left text-xs whitespace-nowrap">
                      <thead className="bg-slate-50 sticky top-0 shadow-sm z-10 border-b border-slate-200 text-slate-600 font-bold text-[11px]">
                        <tr>
                          <th className="px-3 py-2.5">ลำดับ</th>
                          <th className="px-3 py-2.5">วันที่ Lead</th>
                          <th className="px-3 py-2.5">โครงการ</th>
                          <th className="px-3 py-2.5">ชื่อลูกค้า</th>
                          <th className="px-3 py-2.5">เบอร์โทร</th>
                          <th className="px-3 py-2.5">ช่องทาง</th>
                          <th className="px-3 py-2.5">เซลล์</th>
                          <th className="px-3 py-2.5">นัด/เข้าชม</th>
                          <th className="px-3 py-2.5">แปลงที่เล็ง</th>
                          <th className="px-3 py-2.5">CRM Status</th>
                          <th className="px-3 py-2.5">Lost Reason</th>
                          <th className="px-3 py-2.5">หมายเหตุ</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 bg-white">
                        {importData.slice(0, 100).map((row, idx) => (
                          <tr key={idx} className="hover:bg-slate-50">
                            <td className="px-3 py-2 font-mono text-slate-400">{idx + 1}</td>
                            <td className="px-3 py-2">{row.lead_date ? new Date(row.lead_date).toLocaleDateString('th-TH') : '-'}</td>
                            <td className="px-3 py-2 font-bold text-slate-700">{row.project_name}</td>
                            <td className="px-3 py-2 font-black text-blue-900">{row.customer_name}</td>
                            <td className="px-3 py-2 font-mono text-slate-600">{row.phone || '-'}</td>
                            <td className="px-3 py-2">
                              <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md font-semibold text-[10px]">
                                {row.channel}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-slate-600">{row.agent_name}</td>
                            <td className="px-3 py-2 text-[11px]">
                              {row.actual_visit_date ? (
                                <span className="text-emerald-700 font-bold">เข้าชม {new Date(row.actual_visit_date).toLocaleDateString('th-TH')}</span>
                              ) : row.appointment_date ? (
                                <span className="text-purple-700 font-bold">นัด {new Date(row.appointment_date).toLocaleDateString('th-TH')}</span>
                              ) : '-'}
                            </td>
                            <td className="px-3 py-2">
                              {row.interested_plot_name ? (
                                <span className="bg-emerald-50 text-emerald-800 font-bold px-1.5 py-0.5 rounded border border-emerald-200 text-[10px]">
                                  {row.interested_plot_name}
                                </span>
                              ) : '-'}
                            </td>
                            <td className="px-3 py-2">
                              <span className="bg-blue-50 text-blue-800 font-bold px-2 py-0.5 rounded-full text-[10px] border border-blue-200">
                                {row.crm_status}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-rose-600 text-[11px]">{row.lost_reason || '-'}</td>
                            <td className="px-3 py-2 text-slate-500 max-w-[150px] truncate text-[11px]">{row.notes || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {importData.length > 100 && (
                    <div className="p-2 text-center text-xs text-slate-500 bg-slate-50 border-t border-slate-200 font-medium">
                      แสดงตัวอย่างสูงสุด 100 รายการแรกเท่านั้น (ระบบจะนำเข้าทั้งหมด {importData.length} รายการ)
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 sm:p-5 border-t border-slate-100 bg-slate-50 flex justify-end gap-3 rounded-b-3xl">
              <button 
                onClick={() => { setShowImportModal(false); setImportData([]); }}
                className="px-4 py-2.5 rounded-xl font-bold text-slate-600 bg-white border border-slate-300 hover:bg-slate-100 transition-colors text-xs"
                disabled={isImporting}
              >
                ยกเลิก
              </button>
              <button 
                onClick={handleConfirmImport}
                disabled={importData.length === 0 || isImporting}
                className="px-5 py-2.5 rounded-xl font-black text-white bg-emerald-600 hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 text-xs shadow-md shadow-emerald-600/20 cursor-pointer"
              >
                {isImporting ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                {isImporting ? 'กำลังบันทึกลงระบบ...' : `ยืนยันนำเข้าข้อมูล (${importData.length} รายการ)`}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
