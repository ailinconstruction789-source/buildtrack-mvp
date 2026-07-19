"use client";

import React, { useState, useEffect } from 'react';
import { Search, Plus, Map as MapIcon, Users, ListFilter, Download, ChevronRight, Home, Phone, Calendar, ArrowRight, ArrowLeft, LogOut, UserCheck, User, Key, X, FileText, Clock, CheckCircle, XCircle, Banknote, Building2, FileSignature, Pickaxe, Loader2, TrendingUp, Upload, Trash2, PieChart, Lightbulb } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import * as XLSX from 'xlsx';
import SalesMap from './SalesMap';
import SalesPricing from './SalesPricing';
import SalesReports from './SalesReports';
import SalesIntelligence from './SalesIntelligence';

const initialLeads: any[] = [];

export const STATUS_CONFIG: Record<string, { label: string, color: string, bg: string, icon: any }> = {
  'Visit': { label: 'เยี่ยมชมโครงการ', color: 'text-blue-700', bg: 'bg-blue-50', icon: Users },
  'Negotiation': { label: 'กำลังเจรจา', color: 'text-orange-700', bg: 'bg-orange-50', icon: Search },
  'Reserved': { label: 'จองแล้ว', color: 'text-emerald-700', bg: 'bg-emerald-50', icon: Home },
  'DownPayment': { label: 'ผ่อนดาวน์/สัญญา', color: 'text-yellow-700', bg: 'bg-yellow-50', icon: Banknote },
  'DocumentPrep': { label: 'รอยื่นเอกสาร', color: 'text-cyan-700', bg: 'bg-cyan-50', icon: FileText },
  'LoanProcessing': { label: 'รอผลสินเชื่อ', color: 'text-indigo-700', bg: 'bg-indigo-50', icon: Clock },
  'Approved': { label: 'อนุมัติแล้ว', color: 'text-blue-700', bg: 'bg-blue-50', icon: CheckCircle },
  'Contracted': { label: 'ทำสัญญา', color: 'text-pink-700', bg: 'bg-pink-50', icon: FileSignature },
  'Transferred': { label: 'โอนกรรมสิทธิ์', color: 'text-violet-700', bg: 'bg-violet-50', icon: UserCheck },
  'Handover': { label: 'รับมอบบ้าน', color: 'text-sky-700', bg: 'bg-sky-50', icon: Key },
  'Cancelled': { label: 'ยกเลิกจอง', color: 'text-red-700', bg: 'bg-red-50', icon: XCircle }
};

const BANK_LOGOS: Record<string, string> = {
  'กสิกรไทย': 'https://www.google.com/s2/favicons?domain=kasikornbank.com&sz=128',
  'ไทยพาณิชย์': 'https://www.google.com/s2/favicons?domain=scb.co.th&sz=128',
  'กรุงเทพ': 'https://www.google.com/s2/favicons?domain=bangkokbank.com&sz=128',
  'กรุงไทย': 'https://www.google.com/s2/favicons?domain=krungthai.com&sz=128',
  'ออมสิน': 'https://www.google.com/s2/favicons?domain=gsb.or.th&sz=128',
  'ธอส.': 'https://www.google.com/s2/favicons?domain=ghbank.co.th&sz=128',
  'กรุงศรี': 'https://www.google.com/s2/favicons?domain=krungsri.com&sz=128'
};

const getNextStatuses = (current: string) => {
  switch (current) {
    case 'Visit': return ['Visit', 'Negotiation', 'Reserved', 'Cancelled'];
    case 'Negotiation': return ['Negotiation', 'Reserved', 'Cancelled'];
    case 'Reserved': return ['Reserved', 'Contracted', 'Cancelled'];
    case 'Contracted': return ['Contracted', 'DownPayment', 'DocumentPrep', 'Transferred', 'Cancelled'];
    case 'DownPayment': return ['DownPayment', 'DocumentPrep', 'Transferred', 'Cancelled'];
    case 'DocumentPrep': return ['DocumentPrep', 'LoanProcessing', 'Cancelled'];
    case 'LoanProcessing': return ['LoanProcessing', 'Approved', 'DocumentPrep', 'Cancelled'];
    case 'Approved': return ['Approved', 'Transferred', 'Cancelled'];
    case 'Transferred': return ['Transferred', 'Handover', 'Cancelled'];
    case 'Handover': return ['Handover'];
    case 'Cancelled': return ['Cancelled'];
    default: return [current];
  }
};

const formatPhoneNumber = (value: string) => {
  let val = value.replace(/\D/g, '');
  if (val.length > 10) val = val.slice(0, 10);
  if (val.length > 6) return `${val.slice(0,3)}-${val.slice(3,6)}-${val.slice(6)}`;
  if (val.length > 3) return `${val.slice(0,3)}-${val.slice(3)}`;
  return val;
};

export default function SalesKanban({ project, projects, user, onBack }: { project?: any, projects?: any[], user?: any, onBack?: () => void }) {
  const [leads, setLeads] = useState(initialLeads);
  const [activeTab, setActiveTab] = useState<'map' | 'list' | 'pricing' | 'booked' | 'transferred' | 'reports' | 'intelligence'>('map');
  const [search, setSearch] = useState('');
  
  // Side Panel State
  const [panelState, setPanelState] = useState<{type: 'default' | 'booking' | 'customer' | 'new-customer', plotId: string, lead: any}>({ type: 'default', plotId: '', lead: null });

  // For Customer Editing
  const [editCustomerForm, setEditCustomerForm] = useState({ name: '', phone: '', occupation: '', status: '', plot: '', salePrice: '', bank: '', cancelReason: '', landOfficePrice: '', agentName: '', transactionDate: new Date().toISOString().split('T')[0] });

  // Real Plot Data from Supabase
  const [projectPlots, setProjectPlots] = useState<string[]>([]);
  const [projectPlotsData, setProjectPlotsData] = useState<any[]>([]);
  const [plotInfo, setPlotInfo] = useState<any>(null);
  const [loadingPlotInfo, setLoadingPlotInfo] = useState(false);
  const [fullImageUrl, setFullImageUrl] = useState<string | null>(null);

  // Excel Import State
  const [showImportModal, setShowImportModal] = useState(false);
  const [importData, setImportData] = useState<any[]>([]);
  const [isImporting, setIsImporting] = useState(false);

  // Fetch Leads and Sales Data from Supabase
  const fetchData = async () => {
    const projName = project?.name || 'ไอลิน6';
    try {
      // 1. Fetch plots for dropdowns
      const { data: plotsData } = await supabase.from('plots').select('id, plot_name').eq('project_name', projName);
      if (plotsData) {
        setProjectPlots(plotsData.map(p => p.id));
        setProjectPlotsData(plotsData);
      }

      // 2. Fetch leads
      const { data: leadsData, error: leadsErr } = await supabase.from('leads').select('*').eq('project_name', projName);
      if (leadsErr) throw leadsErr;
      if (!leadsData || leadsData.length === 0) { setLeads([]); return; }

      // 3. Fetch sales & history in chunks to prevent PostgREST URL length limit errors
      const chunkArray = (arr: any[], size: number) => Array.from({ length: Math.ceil(arr.length / size) }, (v, i) => arr.slice(i * size, i * size + size));
      
      let salesData: any[] = [];
      let historyData: any[] = [];
      const leadIds = leadsData.map(l => l.id);
      const chunks = chunkArray(leadIds, 100);
      
      for (const chunk of chunks) {
        const { data: sData } = await supabase.from('sales').select('*').in('lead_id', chunk);
        if (sData) salesData = [...salesData, ...sData];
        
        const { data: hData } = await supabase.from('status_history').select('*').in('entity_id', chunk).order('created_at', { ascending: true });
        if (hData) historyData = [...historyData, ...hData];
      }

      const formattedLeads = leadsData.map(l => {
        const sale = salesData?.find(s => s.lead_id === l.id);
        const history = historyData?.filter(h => h.entity_id === l.id).map(h => ({
           status: h.new_status,
           timestamp: h.created_at,
           note: h.changed_by
        })) || [];
        
        const visitDate = history.find(h => h.status === 'Visit')?.timestamp?.split('T')[0] || l.created_at.split('T')[0];
        const bookingDate = history.find(h => h.status === 'Reserved')?.timestamp?.split('T')[0] || null;

        return {
          id: l.id,
          name: l.customer_name,
          phone: l.phone || '',
          occupation: l.occupation || '',
          interest: l.interest || '',
          status: l.status,
          plot: sale?.plot_id || null,
          plotName: sale?.plot_id ? plotsData?.find(p => p.id === sale.plot_id)?.plot_name || sale.plot_id : null,
          bank: sale?.bank_name || '',
          cancelReason: sale?.cancellation_reason || '',
          landOfficePrice: sale?.land_office_price?.toString() || '',
            salePrice: sale?.sale_price ? Number(sale.sale_price) : 0,
          expectedTransferDate: sale?.expected_transfer_date || null,
          visitDate,
          bookingDate,
          agentName: l.agent_name || '',
          source: l.source || 'Walk-in',
          bankStatus: sale?.bank_status || 'Pending',
          history
        };
      });
      setLeads(formattedLeads);
    } catch(e) {
      console.error('Error fetching sales data:', e);
    }
  };

  useEffect(() => {
    fetchData();
  }, [project?.name]);

  useEffect(() => {
    if (!panelState.plotId) {
      setPlotInfo(null);
      return;
    }

    const fetchPlotInfo = async () => {
      setLoadingPlotInfo(true);
      try {
        // Fetch plot details
        const { data: plotData } = await supabase
          .from('plots')
          .select('*, house_types(type_name)')
          .eq('project_name', project?.name || 'ไอลิน6')
          .eq('id', panelState.plotId)
          .maybeSingle();

        if (plotData) {
          // Fetch progress from vw_plot_progress
          const { data: progressData } = await supabase
            .from('vw_plot_progress')
            .select('overall_progress')
            .eq('plot_id', plotData.id)
            .maybeSingle();
          
          // Fetch tasks, schedules, and assignments for detailed status
          const [tasksRes, schedRes, assignsRes] = await Promise.all([
            supabase.from('task_templates').select('id, task_name').eq('house_type_id', plotData.house_type_id),
            supabase.from('schedules').select('task_template_id, planned_start, planned_end').eq('plot_id', plotData.id),
            supabase.from('plot_task_assignments').select('task_template_id, current_progress').eq('plot_id', plotData.id)
          ]);

          let progress = progressData?.overall_progress ? Number(progressData.overall_progress) : 0;
          let estimatedCompletion = null;
          
          let statusInfo = null;
          let activeTask: any = null;

          if (tasksRes.data && tasksRes.data.length > 0) {
            let totalActual = 0; 
            let totalPlanned = 0;
            const today = plotData.sale_status === 'ready_for_sale' && plotData.paused_for_sale_at ? new Date(plotData.paused_for_sale_at).getTime() : Date.now();
            
            const schedMap = new Map(schedRes.data?.map((s: any) => [s.task_template_id, s]) || []);
            const assignMap = new Map(assignsRes.data?.map((a: any) => [a.task_template_id, a.current_progress]) || []);

            tasksRes.data.forEach((task: any) => {
              const actual = assignMap.get(task.id) || 0;
              totalActual += actual;
              
              const plan = schedMap.get(task.id) as any;
              let plannedProg = 0;
              if (plan && plan.planned_start && plan.planned_end) {
                const pStart = new Date(plan.planned_start).getTime(); 
                const pEnd = new Date(plan.planned_end).getTime();
                if (today >= pEnd) plannedProg = 100; 
                else if (today <= pStart) plannedProg = 0; 
                else plannedProg = Math.round(((today - pStart) / (pEnd - pStart)) * 100);
              }
              totalPlanned += plannedProg;
              
              if (actual > 0 && actual < 100 && !activeTask) {
                activeTask = `${task.task_name} (${actual}%)`;
              }
            });

            const actualAvg = Math.round(totalActual / tasksRes.data.length); 
            const plannedAvg = Math.round(totalPlanned / tasksRes.data.length);

            if (plotData.sale_status === 'ready_for_sale') statusInfo = { status: 'ready_for_sale', label: 'พร้อมขาย/รอโอน', color: 'text-amber-600' };
            else if (actualAvg === 0 && plannedAvg === 0) statusInfo = { status: 'none', label: 'รอดำเนินการ', color: 'text-slate-500' };
            else if (actualAvg >= 100 && plannedAvg >= 100) statusInfo = { status: 'completed', label: 'เสร็จสมบูรณ์', color: 'text-emerald-600' };
            else if (actualAvg < plannedAvg - 10) statusInfo = { status: 'delayed', label: 'ล่าช้ากว่าแผน', color: 'text-rose-600' };
            else if (actualAvg > plannedAvg + 10) statusInfo = { status: 'ahead', label: 'เร็วกว่าแผน', color: 'text-indigo-600' };
            else statusInfo = { status: 'on-track', label: 'ตามแผน', color: 'text-blue-600' };
          }

          setPlotInfo({
             ...plotData,
             progress,
             estimatedCompletion,
             statusInfo,
             activeTask
          });
        } else {
          setPlotInfo(null);
        }
      } catch (err) {
        console.error("Error fetching plot info:", err);
      } finally {
        setLoadingPlotInfo(false);
      }
    };

    fetchPlotInfo();
  }, [panelState.plotId]);

  useEffect(() => {
    const fetchPlots = async () => {
      try {
        const projName = project?.name || 'ไอลิน6';
        const { data } = await supabase.from('projects').select('layout_data').eq('name', projName).maybeSingle();
        if (data && data.layout_data) {
          const plotItems = data.layout_data.filter((item: any) => item.type === 'plot' && item.plotId);
          // Extract unique plotIds
          const uniquePlotIds = Array.from(new Set(plotItems.map((item: any) => item.plotId))) as string[];
          // Sort numerically if possible, otherwise alphabetically
          uniquePlotIds.sort((a, b) => {
            const numA = parseInt(a.replace(/\D/g, ''), 10);
            const numB = parseInt(b.replace(/\D/g, ''), 10);
            if (!isNaN(numA) && !isNaN(numB) && numA !== numB) {
              return numA - numB;
            }
            return a.localeCompare(b, undefined, { numeric: true });
          });
          setProjectPlots(uniquePlotIds);
        }
      } catch (err) {
        console.error("Error fetching plots:", err);
      }
    };
    fetchPlots();
  }, [project]);

  // Sort leads by plot numerically
  const sortLeadsByPlot = (leadsArray: any[]) => {
    return [...leadsArray].sort((a, b) => {
      const plotA = a.plot || '';
      const plotB = b.plot || '';
      const numA = parseInt(plotA.replace(/\D/g, ''), 10);
      const numB = parseInt(plotB.replace(/\D/g, ''), 10);
      if (!isNaN(numA) && !isNaN(numB) && numA !== numB) {
        return numA - numB;
      }
      return plotA.localeCompare(plotB, undefined, { numeric: true });
    });
  };

  // Compute available plots (A plot is available if it has no leads EXCEPT Visit and Cancelled)
  const availablePlots = projectPlots.filter(p => !leads.find(l => l.plot === p && !['Visit', 'Cancelled', 'Rejected'].includes(l.status)));

  const handlePlotClick = (plotId: string, status: string, lead?: any) => {
    if (status === 'Available' || status === 'Cancelled' || status === 'Rejected') {
      setPanelState({ type: 'booking', plotId, lead: null });
    } else if (lead) {
      setPanelState({ type: 'customer', plotId, lead });
      setEditCustomerForm({ name: lead.name, phone: lead.phone, occupation: lead.occupation || '', status: lead.status, plot: lead.plot || '', salePrice: lead.salePrice?.toString() || '', bank: lead.bank || '', cancelReason: lead.cancelReason || '', landOfficePrice: lead.landOfficePrice || '', transactionDate: new Date().toISOString().split('T')[0], agentName: lead.agentName || '' });
    }
  };

  const handleEditLeadClick = (lead: any) => {
    setActiveTab('map');
    setPanelState({ type: 'customer', plotId: lead.plot || '', lead });
    setEditCustomerForm({ name: lead.name, phone: lead.phone, occupation: lead.occupation || '', status: lead.status, plot: lead.plot || '', salePrice: lead.salePrice?.toString() || '', bank: lead.bank || '', cancelReason: lead.cancelReason || '', landOfficePrice: lead.landOfficePrice || '', transactionDate: new Date().toISOString().split('T')[0], agentName: lead.agentName || '' });
  };

  const handleSaveBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    const formData = new FormData(e.target as HTMLFormElement);
    const projName = project?.name || 'ไอลิน6';
    const txDateStr = formData.get('transactionDate') as string;
    const txDate = txDateStr ? new Date(`${txDateStr}T12:00:00Z`).toISOString() : new Date().toISOString();
    
    const { data: newLead } = await supabase.from('leads').insert([{
      project_name: projName,
      customer_name: formData.get('name'),
      phone: formData.get('phone'),
      occupation: formData.get('occupation'),
      status: 'Reserved',
      interest: 'Any',
      agent_name: user?.username || 'Unknown',
      created_at: txDate
    }]).select().single();

    if (newLead) {
      const salePriceInput = formData.get('salePrice') as string;
      const parsedSalePrice = salePriceInput ? Number(salePriceInput.replace(/[^0-9.-]+/g,"")) : null;

      await supabase.from('sales').insert([{
        lead_id: newLead.id,
        plot_id: panelState.plotId,
        contract_status: 'Reserved',
        sale_price: parsedSalePrice,
        created_at: txDate
      }]);
      
      await supabase.from('status_history').insert([{
        entity_type: 'lead',
        entity_id: newLead.id,
        new_status: 'Reserved',
        changed_by: user?.username || 'Unknown',
        created_at: txDate
      }]);

      await fetchData();
    }
    setPanelState({ type: 'default', plotId: '', lead: null });
  };

  const handleSaveNewCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    const formData = new FormData(e.target as HTMLFormElement);
    const projName = project?.name || 'ไอลิน6';
    const txDateStr = formData.get('transactionDate') as string;
    const txDate = txDateStr ? new Date(`${txDateStr}T12:00:00Z`).toISOString() : new Date().toISOString();
    
    const interestPrimary = formData.get('interest') as string;
    const interestSecondary = formData.get('interestSecondary') as string;
    const otherProjects = formData.getAll('otherProjects') as string[];
    
    let finalInterest = interestPrimary === 'Any' ? 'Any' : `${interestPrimary}`;
    if (interestSecondary.trim()) {
       finalInterest = interestPrimary === 'Any' ? interestSecondary.trim() : `${finalInterest}, ${interestSecondary.trim()}`;
    }
    if (otherProjects.length > 0) {
       const otherProjectsStr = `สนใจโครงการอื่น: ${otherProjects.join(', ')}`;
       finalInterest = finalInterest === 'Any' ? otherProjectsStr : `${finalInterest} (${otherProjectsStr})`;
    }
    
    const { data: newLead } = await supabase.from('leads').insert([{
      project_name: projName,
      customer_name: formData.get('name'),
      phone: formData.get('phone'),
      occupation: formData.get('occupation'),
      status: 'Visit',
      interest: finalInterest,
      agent_name: user?.username || 'Unknown',
      created_at: txDate
    }]).select().single();

    if (newLead) {
      await supabase.from('status_history').insert([{
        entity_type: 'lead',
        entity_id: newLead.id,
        new_status: 'Visit',
        changed_by: user?.username || 'Unknown',
        created_at: txDate
      }]);

      await fetchData();
    }
    setPanelState({ type: 'default', plotId: '', lead: null });
  };

  const handleDeleteCustomer = async (leadId: string) => {
    if (!window.confirm("คุณต้องการลบข้อมูลลูกค้านี้ใช่หรือไม่?\nการลบจะทำให้ประวัติ ยอดจอง และรายงานวิเคราะห์ที่เกี่ยวข้องกับลูกค้าคนนี้ถูกลบออกไปทั้งหมด และไม่สามารถกู้คืนได้")) return;
    
    try {
      // 1. Check if there's a sale attached to free the plot
      const { data: saleData } = await supabase.from('sales').select('id, plot_id').eq('lead_id', leadId).maybeSingle();
      
      if (saleData?.plot_id) {
        // Free up the plot
        await supabase.from('plots').update({ sale_status: 'ready_for_sale', paused_for_sale_at: null }).eq('id', saleData.plot_id);
      }

      // 2. Clean up status history
      if (saleData) {
        await supabase.from('status_history').delete().eq('entity_id', saleData.id);
      }
      await supabase.from('status_history').delete().eq('entity_id', leadId);

      // 3. Delete the lead (sales table deletes on cascade)
      await supabase.from('leads').delete().eq('id', leadId);

      // Refresh
      await fetchData();
      setPanelState({ type: 'default', plotId: '', lead: null });
    } catch (err) {
      console.error("Error deleting customer", err);
      alert("เกิดข้อผิดพลาดในการลบข้อมูลลูกค้า");
    }
  };

  const handleUpdateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    const leadId = panelState.lead.id;
    const oldStatus = panelState.lead.status;
    const newStatus = editCustomerForm.status;
    const isNewBooking = oldStatus === 'Visit' && newStatus !== 'Visit';
    const txDateStr = editCustomerForm.transactionDate;
    const txDate = txDateStr ? new Date(`${txDateStr}T12:00:00Z`).toISOString() : new Date().toISOString();
    
    await supabase.from('leads').update({
      customer_name: editCustomerForm.name,
      phone: editCustomerForm.phone,
      occupation: editCustomerForm.occupation,
      status: newStatus,
      ...(isNewBooking ? { agent_name: user?.username || 'Unknown' } : {})
    }).eq('id', leadId);

    const { data: existingSale } = await supabase.from('sales').select('id').eq('lead_id', leadId).maybeSingle();
    
    const salePayload = {
      contract_status: newStatus === 'Transferred' || newStatus === 'Handover' ? 'Transferred' : (newStatus === 'Contracted' || newStatus === 'DownPayment' || newStatus === 'DocumentPrep' || newStatus === 'LoanProcessing' || newStatus === 'Approved' ? 'Contracted' : 'Reserved'),
      cancellation_reason: newStatus === 'Cancelled' ? editCustomerForm.cancelReason : null,
      sale_price: editCustomerForm.salePrice ? Number(editCustomerForm.salePrice.replace(/[^0-9.-]+/g,"")) : null,
      land_office_price: editCustomerForm.landOfficePrice ? Number(editCustomerForm.landOfficePrice.replace(/[^0-9.-]+/g,"")) : null,
      ...(newStatus === 'Transferred' || newStatus === 'Handover' ? { transferred_at: txDate } : {})
    };

    if (existingSale) {
      await supabase.from('sales').update(salePayload).eq('id', existingSale.id);
    } else if (isNewBooking) {
      await supabase.from('sales').insert([{ lead_id: leadId, ...salePayload }]);
    }

    if (oldStatus !== newStatus || editCustomerForm.bank !== panelState.lead.bank) {
      let note = '';
      if (oldStatus === newStatus && editCustomerForm.bank !== panelState.lead.bank) {
        note = `เปลี่ยนธนาคารเป็น: ${editCustomerForm.bank}`;
      } else if ((newStatus === 'DocumentPrep' || newStatus === 'LoanProcessing') && editCustomerForm.bank) {
        note = `ยื่นผ่าน: ${editCustomerForm.bank}`;
      } else if (newStatus === 'Cancelled' && editCustomerForm.cancelReason) {
        note = `เหตุผล: ${editCustomerForm.cancelReason}`;
      } else if (newStatus === 'Approved' && editCustomerForm.landOfficePrice) {
        note = `ราคา ท.ด. ฿${parseInt(editCustomerForm.landOfficePrice).toLocaleString()}`;
      }
      
      await supabase.from('status_history').insert([{
        entity_type: 'lead',
        entity_id: leadId,
        old_status: oldStatus,
        new_status: newStatus,
        changed_by: (user?.username || 'Unknown') + (note ? ` (${note})` : ''),
        created_at: txDate
      }]);
    }

    await fetchData();
    setPanelState({ type: 'default', plotId: '', lead: null });
  };

  const filteredLeads = sortLeadsByPlot(leads.filter(l => {
    if (search && !l.name.toLowerCase().includes(search.toLowerCase()) && !l.phone.includes(search) && (!l.plot || !l.plot.toLowerCase().includes(search.toLowerCase()))) return false;
    return true;
  }));

  const bookedLeads = sortLeadsByPlot(leads.filter(l => ['Reserved', 'Contracted', 'DownPayment', 'DocumentPrep', 'LoanProcessing', 'Approved'].includes(l.status)));
  const transferredLeads = sortLeadsByPlot(leads.filter(l => ['Transferred', 'Handover'].includes(l.status)));

  const handleUpdateTransferDate = async (leadId: string, newDate: string) => {
    // Optimistic UI update
    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, expectedTransferDate: newDate } : l));
    
    // Save to database
    const { error } = await supabase.from('sales').update({ expected_transfer_date: newDate || null }).eq('lead_id', leadId);
    if (error) {
      console.error("Failed to update transfer date", error);
      fetchData(); // Revert on error
    }
  };

  // Excel Import Handlers
  const handleDownloadTemplate = () => {
    const ws = XLSX.utils.json_to_sheet([
      { 'Customer Name': 'สมชาย ใจดี', 'Phone': '0812345678', 'Occupation': 'เจ้าของธุรกิจ', 'Interest': 'แบบบ้าน A', 'Status': 'Visit', 'Plot': '1', 'Sale Price': 3500000, 'Land Price': 50000, 'Sales Agent': user?.username || 'Jane', 'Visit Date': '25/12/2026', 'Booking Date': '', 'Transfer Date': '', 'Cancel Date': '' }
    ]);
    const guideWs = XLSX.utils.json_to_sheet([
      { 'Status (ภาษาอังกฤษเท่านั้น)': 'Visit', 'ความหมาย': 'เยี่ยมชมโครงการ (ค่าเริ่มต้น)' },
      { 'Status (ภาษาอังกฤษเท่านั้น)': 'Negotiation', 'ความหมาย': 'กำลังเจรจา' },
      { 'Status (ภาษาอังกฤษเท่านั้น)': 'Reserved', 'ความหมาย': 'จองแล้ว' },
      { 'Status (ภาษาอังกฤษเท่านั้น)': 'Contracted', 'ความหมาย': 'ทำสัญญาแล้ว' },
      { 'Status (ภาษาอังกฤษเท่านั้น)': 'DownPayment', 'ความหมาย': 'ผ่อนดาวน์' },
      { 'Status (ภาษาอังกฤษเท่านั้น)': 'DocumentPrep', 'ความหมาย': 'เตรียมเอกสาร' },
      { 'Status (ภาษาอังกฤษเท่านั้น)': 'LoanProcessing', 'ความหมาย': 'ยื่นกู้' },
      { 'Status (ภาษาอังกฤษเท่านั้น)': 'Approved', 'ความหมาย': 'อนุมัติแล้ว' },
      { 'Status (ภาษาอังกฤษเท่านั้น)': 'Transferred', 'ความหมาย': 'โอนกรรมสิทธิ์' },
      { 'Status (ภาษาอังกฤษเท่านั้น)': 'Handover', 'ความหมาย': 'รับมอบบ้าน' },
      { 'Status (ภาษาอังกฤษเท่านั้น)': 'Cancelled', 'ความหมาย': 'ยกเลิก' },
      { 'Status (ภาษาอังกฤษเท่านั้น)': '---', 'ความหมาย': '---' },
      { 'Status (ภาษาอังกฤษเท่านั้น)': 'Sale Price', 'ความหมาย': 'ราคาขายสุทธิ (ตัวเลขเท่านั้น เช่น 3500000)' },
      { 'Status (ภาษาอังกฤษเท่านั้น)': 'Land Price', 'ความหมาย': 'ราคาประเมินที่ดิน/กรมที่ดิน (ตัวเลขเท่านั้น)' },
      { 'Status (ภาษาอังกฤษเท่านั้น)': 'Sales Agent', 'ความหมาย': 'ชื่อพนักงานขายที่ดูแลลูกค้า' },
      { 'Status (ภาษาอังกฤษเท่านั้น)': 'Visit Date', 'ความหมาย': 'วันที่เยี่ยมชม (ถ้าไม่ระบุ ระบบจะใช้วันที่ปัจจุบัน)' },
      { 'Status (ภาษาอังกฤษเท่านั้น)': 'Plot (แปลงบ้าน)', 'ความหมาย': projectPlotsData.length > 0 ? `แปลงที่มีในโครงการ: ${projectPlotsData.map(p => p.plot_name).join(', ')}` : 'โปรดระบุชื่อแปลงให้ตรงกับในระบบ' },
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Template');
    XLSX.utils.book_append_sheet(wb, guideWs, 'Guide');
    XLSX.writeFile(wb, 'Customer_Import_Template.xlsx');
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const bstr = event.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws);
        
        // Get headers from first row to check if the column exists
        if (data.length > 0 && !Object.keys(data[0] as object).some(k => k.trim() === 'Customer Name')) {
          alert("รูปแบบไฟล์ไม่ถูกต้อง ต้องมีคอลัมน์ Customer Name (กรุณาตรวจสอบว่าพิมพ์ชื่อคอลัมน์ถูกต้องและไม่มีเว้นวรรคเกิน)");
          return;
        }

        // Clean data: remove completely empty rows or rows without Customer Name
        const cleanData = data.filter((row: any) => row && row['Customer Name'] && String(row['Customer Name']).trim() !== '');

        if (cleanData.length === 0) {
          alert("ไม่พบข้อมูลลูกค้าในไฟล์ กรุณาตรวจสอบการกรอกข้อมูล");
          return;
        }

        const validStatuses = ['Visit', 'Negotiation', 'Reserved', 'DownPayment', 'DocumentPrep', 'LoanProcessing', 'Approved', 'Contracted', 'Transferred', 'Handover', 'Cancelled'];
        let hasError = false;
        let errorMsg = '';

        for (let i = 0; i < cleanData.length; i++) {
          const row: any = cleanData[i];
          const rowNum = i + 2; // Approximate row number
          
          if (!row['Phone']) {
            hasError = true;
            errorMsg = `บรรทัดที่ ${rowNum} (${row['Customer Name']}): ข้อมูล Phone ห้ามเว้นว่าง`;
            break;
          }
          if (row['Status']) {
            const rawStatus = row['Status'].toString().trim();
            if (!validStatuses.includes(rawStatus)) {
              hasError = true;
              errorMsg = `บรรทัดที่ ${rowNum} (${row['Customer Name']}): สถานะ "${rawStatus}" ไม่ถูกต้อง`;
              break;
            }
          }
          if (row['Plot']) {
            const plotStr = row['Plot'].toString().trim();
            const normalizedPlotStr = plotStr.replace(/\s+/g, '');
            const projPrefix = project?.name ? project.name.replace(/\s+/g, '') : '';
            const matched = projectPlotsData.find(p => {
              const pName = p.plot_name.replace(/\s+/g, '');
              return pName === normalizedPlotStr || 
                     `${projPrefix}-${pName}` === normalizedPlotStr || 
                     `${projPrefix}${pName}` === normalizedPlotStr ||
                     pName === normalizedPlotStr.replace(new RegExp(`^${projPrefix}-?`), '');
            });
            if (!matched) {
              hasError = true;
              errorMsg = `บรรทัดที่ ${rowNum} (${row['Customer Name']}): รหัสแปลง "${plotStr}" ไม่มีอยู่ในระบบของโครงการนี้`;
              break;
            }
            // Update the row to use the matched plot id to avoid issues later
            row['Plot'] = matched.id;
          }
        }

        if (hasError) {
          alert("ไฟล์ถูกปฏิเสธ: " + errorMsg);
          e.target.value = '';
          return;
        }

        setImportData(cleanData);
      } catch (err) {
        console.error("Error parsing Excel:", err);
        alert("ไฟล์ไม่ถูกต้องหรือไม่สามารถอ่านได้ครับ");
      }
    };
    reader.readAsBinaryString(file);
  };

  const parseDateStr = (dateStr: any) => {
    if (!dateStr) return null;
    const str = dateStr.toString().trim();
    
    // Check if it's an Excel serial number (only digits)
    if (/^\d+(\.\d+)?$/.test(str)) {
      const serial = parseFloat(str);
      const utcDays = Math.floor(serial - 25569);
      const utcValue = utcDays * 86400; 
      const dateInfo = new Date(utcValue * 1000);
      return new Date(dateInfo.getFullYear(), dateInfo.getMonth(), dateInfo.getDate(), 12, 0, 0).toISOString();
    }

    const parts = str.split(/[\/\-]/);
    if (parts.length === 3) {
      let day = parseInt(parts[0]);
      let month = parseInt(parts[1]);
      let year = parseInt(parts[2]);
      if (year < 100) year += 2000;
      if (day > 1000) {
        const temp = day;
        day = year;
        year = temp;
      }
      return new Date(Date.UTC(year, month - 1, day, 5, 0, 0)).toISOString();
    }
    
    const parsed = new Date(str);
    if (!isNaN(parsed.getTime())) {
      return new Date(Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate(), 5, 0, 0)).toISOString();
    }
    
    return null;
  };

  const handleExportData = () => {
    const exportRows = leads.map(l => {
      const transferDate = l.history.find((h: any) => h.status === 'Transferred')?.timestamp?.split('T')[0] || '';
      const cancelDate = l.history.find((h: any) => h.status === 'Cancelled')?.timestamp?.split('T')[0] || '';
      const plotName = l.plot ? projectPlotsData.find(p => p.id === l.plot)?.plot_name || l.plot : '';
      return {
        'Customer Name': l.name,
        'Phone': l.phone,
        'Occupation': l.occupation,
        'Interest': l.interest,
        'Status': l.status,
        'Plot': plotName,
        'Sale Price': l.salePrice || '',
        'Land Price': l.landOfficePrice || '',
        'Sales Agent': l.agentName,
        'Visit Date': l.visitDate || '',
        'Booking Date': l.bookingDate || '',
        'Transfer Date': transferDate,
        'Cancel Date': cancelDate
      };
    });

    const ws = XLSX.utils.json_to_sheet(exportRows.length > 0 ? exportRows : [{
      'Customer Name': '', 'Phone': '', 'Occupation': '', 'Interest': '', 'Status': '', 'Plot': '', 'Sale Price': '', 'Land Price': '', 'Sales Agent': '', 'Visit Date': '', 'Booking Date': '', 'Transfer Date': '', 'Cancel Date': ''
    }]);
    
    const guideWs = XLSX.utils.json_to_sheet([
      { 'Status (ภาษาอังกฤษเท่านั้น)': 'Visit', 'ความหมาย': 'เยี่ยมชมโครงการ (ค่าเริ่มต้น)' },
      { 'Status (ภาษาอังกฤษเท่านั้น)': 'Negotiation', 'ความหมาย': 'กำลังเจรจา' },
      { 'Status (ภาษาอังกฤษเท่านั้น)': 'Reserved', 'ความหมาย': 'จองแล้ว' },
      { 'Status (ภาษาอังกฤษเท่านั้น)': 'Contracted', 'ความหมาย': 'ทำสัญญาแล้ว' },
      { 'Status (ภาษาอังกฤษเท่านั้น)': 'DownPayment', 'ความหมาย': 'ผ่อนดาวน์' },
      { 'Status (ภาษาอังกฤษเท่านั้น)': 'DocumentPrep', 'ความหมาย': 'เตรียมเอกสาร' },
      { 'Status (ภาษาอังกฤษเท่านั้น)': 'LoanProcessing', 'ความหมาย': 'ยื่นกู้' },
      { 'Status (ภาษาอังกฤษเท่านั้น)': 'Approved', 'ความหมาย': 'อนุมัติแล้ว' },
      { 'Status (ภาษาอังกฤษเท่านั้น)': 'Transferred', 'ความหมาย': 'โอนกรรมสิทธิ์' },
      { 'Status (ภาษาอังกฤษเท่านั้น)': 'Handover', 'ความหมาย': 'รับมอบบ้าน' },
      { 'Status (ภาษาอังกฤษเท่านั้น)': 'Cancelled', 'ความหมาย': 'ยกเลิก' },
      { 'Status (ภาษาอังกฤษเท่านั้น)': '---', 'ความหมาย': '---' },
      { 'Status (ภาษาอังกฤษเท่านั้น)': 'Sale Price', 'ความหมาย': 'ราคาขายสุทธิ (ตัวเลขเท่านั้น เช่น 3500000)' },
      { 'Status (ภาษาอังกฤษเท่านั้น)': 'Land Price', 'ความหมาย': 'ราคาประเมินที่ดิน/กรมที่ดิน (ตัวเลขเท่านั้น)' },
      { 'Status (ภาษาอังกฤษเท่านั้น)': 'Sales Agent', 'ความหมาย': 'ชื่อพนักงานขายที่ดูแลลูกค้า' },
      { 'Status (ภาษาอังกฤษเท่านั้น)': 'Visit Date', 'ความหมาย': 'วันที่เยี่ยมชม (ถ้าไม่ระบุ ระบบจะใช้วันที่ปัจจุบัน)' },
      { 'Status (ภาษาอังกฤษเท่านั้น)': 'Plot (แปลงบ้าน)', 'ความหมาย': projectPlotsData.length > 0 ? `แปลงที่มีในโครงการ: ${projectPlotsData.map(p => p.plot_name).join(', ')}` : 'โปรดระบุชื่อแปลงให้ตรงกับในระบบ' },
    ]);
    
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Data');
    XLSX.utils.book_append_sheet(wb, guideWs, 'Guide');
    XLSX.writeFile(wb, `Sales_Export_${project?.name || 'Project'}_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const handleConfirmImport = async () => {
    if (importData.length === 0) return;
    setIsImporting(true);
    const projName = project?.name || 'ไอลิน6';
    
    try {
      const validStatuses = ['Visit', 'Negotiation', 'Reserved', 'DownPayment', 'DocumentPrep', 'LoanProcessing', 'Approved', 'Contracted', 'Transferred', 'Handover', 'Cancelled'];
      
      let updatedCount = 0;
      let insertedCount = 0;

      for (const row of importData) {
        const rawStatus = row['Status']?.toString().trim();
        const status = validStatuses.includes(rawStatus) ? rawStatus : 'Visit';
        const visitDate = parseDateStr(row['Visit Date']) || new Date().toISOString();
        const customerName = row['Customer Name']?.toString().trim() || 'Unknown';
        const phone = row['Phone']?.toString().trim() || '';
        let plotId = row['Plot']?.toString().trim() || null;
        // plotId is already matched to UUID in handleFileUpload
        
        const parseMoney = (val: any) => {
          if (val == null || val === '') return null;
          const numStr = val.toString().replace(/[^0-9.-]+/g,"");
          const num = Number(numStr);
          return isNaN(num) ? null : num;
        };
        
        const salePrice = parseMoney(row['Sale Price']);
        const landPrice = parseMoney(row['Land Price']);
        const bookingDate = parseDateStr(row['Booking Date']);
        const transferDate = parseDateStr(row['Transfer Date']);
        const cancelDate = parseDateStr(row['Cancel Date']);
        
        // Find if this lead already exists
        const existingLead = leads.find(l => 
          (plotId && l.plot === plotId) || 
          (l.name.toLowerCase() === customerName.toLowerCase() && l.phone === phone)
        );

        if (existingLead) {
          // UPDATE EXISTING LEAD
          await supabase.from('leads').update({
            customer_name: customerName,
            phone: phone,
            occupation: row['Occupation']?.toString() || '',
            interest: row['Interest']?.toString() || 'Any',
            status: status,
            agent_name: row['Sales Agent']?.toString() || existingLead.agentName || user?.username || 'Unknown'
          }).eq('id', existingLead.id);

          if (['Reserved', 'Contracted', 'DownPayment', 'DocumentPrep', 'LoanProcessing', 'Approved', 'Transferred', 'Handover', 'Cancelled'].includes(status)) {
            const contractStatus = status === 'Transferred' || status === 'Handover' ? 'Transferred' : (status === 'Contracted' || status === 'DownPayment' || status === 'DocumentPrep' || status === 'LoanProcessing' || status === 'Approved' ? 'Contracted' : (status === 'Cancelled' ? 'Cancelled' : 'Reserved'));
            
            // Check if sale exists
            const { data: existingSale } = await supabase.from('sales').select('id').eq('lead_id', existingLead.id).maybeSingle();
            
            const salePayload = {
              plot_id: plotId,
              sale_price: salePrice,
              land_office_price: landPrice,
              contract_status: contractStatus,
              ...(transferDate ? { transferred_at: transferDate } : {})
            };
            
            if (existingSale) {
              const { error: updateSaleErr } = await supabase.from('sales').update(salePayload).eq('id', existingSale.id);
              if (updateSaleErr) console.error("Update Sale Error:", updateSaleErr, salePayload);
            } else {
              const { error: insertSaleErr } = await supabase.from('sales').insert([{
                lead_id: existingLead.id,
                ...salePayload,
                bank_status: 'Pending',
                created_at: bookingDate || existingLead.created_at
              }]);
              if (insertSaleErr) console.error("Insert Sale Error:", insertSaleErr, salePayload);
            }
          }
          
          if (status !== existingLead.status) {
             await supabase.from('status_history').insert([{
               entity_type: 'lead',
               entity_id: existingLead.id,
               old_status: existingLead.status,
               new_status: status,
               changed_by: (user?.username || 'Unknown') + ' (System Import Update)',
               created_at: transferDate || cancelDate || bookingDate || new Date().toISOString()
             }]);
          }
          updatedCount++;
        } else {
          // INSERT NEW LEAD
          const { data: newLeadsData } = await supabase.from('leads').insert([{
            project_name: projName,
            customer_name: customerName,
            phone: phone,
            occupation: row['Occupation']?.toString() || '',
            interest: row['Interest']?.toString() || 'Any',
            status: status,
            agent_name: row['Sales Agent']?.toString() || user?.username || 'Unknown',
            created_at: visitDate
          }]).select();
          
          if (newLeadsData && newLeadsData.length > 0) {
            const newLead = newLeadsData[0];
            
            // Determine the best date for the initial status history record
            let initialHistoryDate = newLead.created_at;
            if (['Transferred', 'Handover'].includes(status) && transferDate) {
               initialHistoryDate = transferDate;
            } else if (status === 'Cancelled' && cancelDate) {
               initialHistoryDate = cancelDate;
            } else if (['Reserved', 'Contracted', 'DownPayment', 'DocumentPrep', 'LoanProcessing', 'Approved'].includes(status) && bookingDate) {
               initialHistoryDate = bookingDate;
            }

            // Insert initial status history for the new lead
            await supabase.from('status_history').insert([{
               entity_type: 'lead',
               entity_id: newLead.id,
               new_status: status,
               changed_by: (user?.username || 'Unknown') + ' (System Import)',
               created_at: initialHistoryDate
            }]);

            // If a booking date was explicitly provided and status isn't just 'Reserved', 
            // log a historical 'Reserved' event so reports can accurately track it
            if (bookingDate && status !== 'Reserved' && ['Contracted', 'DownPayment', 'DocumentPrep', 'LoanProcessing', 'Approved', 'Transferred', 'Handover'].includes(status)) {
              await supabase.from('status_history').insert([{
                 entity_type: 'lead',
                 entity_id: newLead.id,
                 new_status: 'Reserved',
                 changed_by: (user?.username || 'Unknown') + ' (System Import)',
                 created_at: bookingDate
              }]);
            }

            if (['Reserved', 'Contracted', 'DownPayment', 'DocumentPrep', 'LoanProcessing', 'Approved', 'Transferred', 'Handover', 'Cancelled'].includes(status)) {
              const { error: newSaleErr } = await supabase.from('sales').insert([{
                lead_id: newLead.id,
                plot_id: plotId,
                sale_price: salePrice,
                land_office_price: landPrice,
                contract_status: status === 'Transferred' || status === 'Handover' ? 'Transferred' : (status === 'Contracted' || status === 'DownPayment' || status === 'DocumentPrep' || status === 'LoanProcessing' || status === 'Approved' ? 'Contracted' : (status === 'Cancelled' ? 'Cancelled' : 'Reserved')),
                bank_status: 'Pending',
                created_at: bookingDate || newLead.created_at,
                transferred_at: transferDate || null
              }]);
              if (newSaleErr) {
                console.error("Insert New Sale Error:", newSaleErr, { plotId, salePrice, landPrice });
                alert("เกิดข้อผิดพลาดในการบันทึกราคาและแปลง: " + JSON.stringify(newSaleErr));
              }
            }
            insertedCount++;
          } else {
             console.error("Insert Lead Error:", newLeadsData);
          }
        }
      }

      await fetchData();
      setShowImportModal(false);
      setImportData([]);
      alert(`นำเข้าข้อมูลสำเร็จ: อัปเดตข้อมูลเดิม ${updatedCount} รายการ, เพิ่มข้อมูลใหม่ ${insertedCount} รายการ`);
    } catch (err) {
      console.error("Error importing data:", err);
      alert("เกิดข้อผิดพลาดในการนำเข้าข้อมูล โปรดลองอีกครั้ง");
    } finally {
      setIsImporting(false);
    }
  };

  const handleClearData = async () => {
    if (window.confirm("คำเตือน: ข้อมูลลูกค้าและการขายทั้งหมดในโครงการนี้จะถูกลบอย่างถาวร (รวมถึงประวัติทั้งหมด) คุณแน่ใจหรือไม่?")) {
      try {
        const projName = project?.name || 'ไอลิน6';
        // Find all leads for this project
        const { data: leadsData } = await supabase.from('leads').select('id').eq('project_name', projName);
        
        if (leadsData && leadsData.length > 0) {
          const leadIds = leadsData.map(l => l.id);
          
          // Delete status_history for these leads manually
          await supabase.from('status_history').delete().in('entity_id', leadIds);
          
          // Delete leads (sales will cascade automatically)
          const { error } = await supabase.from('leads').delete().eq('project_name', projName);
          if (error) throw error;
        }

        alert("ล้างข้อมูลลูกค้าสำเร็จ");
        fetchData(); // refresh UI
        setPanelState({ type: 'default', plotId: '', lead: null });
      } catch (err) {
        console.error("Error clearing data:", err);
        alert("เกิดข้อผิดพลาดในการล้างข้อมูล");
      }
    }
  };

  return (
    <div className="h-screen overflow-hidden bg-[#f8fafc] font-sans flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 md:px-8 py-4 md:py-5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 sm:gap-0 z-10 shrink-0">
        <div className="flex items-center gap-4">
          {onBack && (
            <button onClick={onBack} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
              <ArrowLeft size={24} className="text-slate-600" />
            </button>
          )}
          <div>
            <h1 className="text-3xl font-bold text-[#0f172a] tracking-tight">Sales Management {project ? `- ${project.name}` : ''}</h1>
            <p className="text-gray-500 text-sm mt-1">Manage leads, bookings, and handovers</p>
          </div>
        </div>
        <div className="flex gap-4 items-center">
          
          {user?.role === 'Admin' && (
            <button 
              onClick={handleClearData}
              className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-xl flex items-center gap-2 text-sm font-semibold shadow-sm hover:bg-red-100 transition-colors">
              <Trash2 size={18} />
              Clear Data
            </button>
          )}

          <button 
            onClick={() => setShowImportModal(true)}
            className="bg-white border border-gray-200 text-gray-700 px-4 py-2 rounded-xl flex items-center gap-2 text-sm font-semibold shadow-sm hover:bg-gray-50 transition-colors">
            <Upload size={18} />
            Import
          </button>
          <button onClick={handleExportData} className="bg-white border border-gray-200 text-gray-700 px-4 py-2 rounded-xl flex items-center gap-2 text-sm font-semibold shadow-sm hover:bg-gray-50 transition-colors">
            <Download size={18} />
            Export
          </button>
          <button 
            onClick={() => { setActiveTab('map'); setPanelState({ type: 'new-customer', plotId: '', lead: null }); }}
            className="bg-[#0f172a] hover:bg-[#1e293b] text-white px-5 py-2 rounded-xl flex items-center gap-2 text-sm font-semibold shadow-md transition-colors">
            <Plus size={18} />
            New Customer
          </button>
        </div>
      </header>

      {/* Navigation Tabs */}
      <div className="px-4 md:px-8 pt-4 md:pt-6 pb-2 border-b border-gray-200 bg-white flex flex-col lg:flex-row lg:items-center justify-between gap-4 lg:gap-0">
        <div className="flex gap-4 md:gap-8 overflow-x-auto w-full lg:w-auto pb-1 no-scrollbar shrink-0">
          <button 
            onClick={() => setActiveTab('map')}
            className={`pb-4 px-2 text-sm font-bold border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'map' ? 'border-[#d4af37] text-[#0f172a]' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            <MapIcon size={18} className={activeTab === 'map' ? 'text-[#d4af37]' : ''} />
            Project Map
          </button>
          <button 
            onClick={() => setActiveTab('list')}
            className={`pb-4 px-2 text-sm font-bold border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'list' ? 'border-[#d4af37] text-[#0f172a]' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            <Users size={18} className={activeTab === 'list' ? 'text-[#d4af37]' : ''} />
            Customer Pipeline
          </button>
          <button 
            onClick={() => setActiveTab('booked')}
            className={`pb-4 px-2 text-sm font-bold border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'booked' ? 'border-[#d4af37] text-[#0f172a]' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            <Calendar size={18} className={activeTab === 'booked' ? 'text-[#d4af37]' : ''} />
            ข้อมูลลูกค้าที่จอง
          </button>
          <button 
            onClick={() => setActiveTab('transferred')}
            className={`pb-4 px-2 text-sm font-bold border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'transferred' ? 'border-[#d4af37] text-[#0f172a]' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            <Home size={18} className={activeTab === 'transferred' ? 'text-[#d4af37]' : ''} />
            ลูกค้าที่โอนแล้ว
          </button>
          <button 
            onClick={() => setActiveTab('pricing')}
            className={`pb-4 px-2 text-sm font-bold border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'pricing' ? 'border-[#d4af37] text-[#0f172a]' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            <Building2 size={18} className={activeTab === 'pricing' ? 'text-[#d4af37]' : ''} />
            ราคาบ้านและที่ดิน
          </button>
          <button 
            onClick={() => setActiveTab('reports')}
            className={`pb-4 px-2 text-sm font-bold border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'reports' ? 'border-[#d4af37] text-[#0f172a]' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            <PieChart size={18} className={activeTab === 'reports' ? 'text-[#d4af37]' : ''} />
            รายงานสรุปผล
          </button>
          <button 
            onClick={() => setActiveTab('intelligence')}
            className={`pb-4 px-2 text-sm font-bold border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'intelligence' ? 'border-[#d4af37] text-[#0f172a]' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            <Lightbulb size={18} className={activeTab === 'intelligence' ? 'text-[#d4af37]' : ''} />
            Business Insights
          </button>
        </div>
        
        {/* Search Bar for List/Booked/Transferred View */}
        {(activeTab === 'list' || activeTab === 'booked' || activeTab === 'transferred') && (
          <div className="relative pb-3">
            <Search className="absolute left-3 top-2.5 text-gray-400" size={16} />
            <input 
              type="text" 
              placeholder="Search by name, plot, or phone..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 pr-4 py-2 border border-gray-300 rounded-xl bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#d4af37] focus:border-transparent text-sm w-72"
            />
          </div>
        )}
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-hidden p-2 md:p-6">
        
        
        {/* GLOBAL WRAPPER */}
        <div className="h-full bg-white rounded-2xl shadow-[0_4px_24px_rgba(0,0,0,0.02)] border border-gray-100 flex overflow-hidden relative">
          <div className="flex-1 h-full relative min-w-0 flex flex-col">
            {/* MAP VIEW TAB */}
            {activeTab === 'map' && (
              <SalesMap leads={leads} projectName={project?.name || 'ไอลิน6'} onPlotClick={handlePlotClick} />
            )}

            {/* LIST VIEW TAB (CRM Table) */}
            {activeTab === 'list' && (
              <div className="h-full flex flex-col overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-gray-50/50 border-b border-gray-200">
                        <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Customer Info</th>
                        <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Status</th>
                        <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Plot / Interest</th>
                        <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Last Update</th>
                        <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Prices</th>
                        <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {filteredLeads.map((lead) => {
                        const StatusIcon = STATUS_CONFIG[lead.status]?.icon || Users;
                        const plotName = projectPlotsData.find(p => p.id === lead.plot)?.plot_name || lead.plot;
                        return (
                          <tr key={lead.id} className="hover:bg-gray-50/50 transition-colors cursor-pointer group">
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-[#0f172a] font-bold text-sm">
                                  {lead.name.charAt(0)}
                                </div>
                                <div>
                                  <div className="font-bold text-[#0f172a]">{lead.name}</div>
                                  <div className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                                    <Phone size={10} /> {lead.phone}
                                    {lead.agentName && <span className="ml-2 px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded flex items-center gap-1 border border-blue-100"><User size={8} /> {lead.agentName}</span>}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${STATUS_CONFIG[lead.status]?.bg} ${STATUS_CONFIG[lead.status]?.color}`}>
                                <StatusIcon size={12} />
                                {STATUS_CONFIG[lead.status]?.label}
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              {lead.plot ? (
                                <div className="flex items-center gap-2">
                                  <span className="font-bold text-[#0f172a] bg-gray-100 px-2 py-1 rounded-md text-sm">{plotName}</span>
                                  {lead.progress !== undefined && (
                                    <div className="text-xs text-gray-500 flex items-center gap-1">
                                      <div className="w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                                        <div className="bg-[#d4af37] h-full" style={{ width: `${lead.progress}%` }}></div>
                                      </div>
                                      {lead.progress}%
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <span className="text-sm text-gray-500">{lead.interest}</span>
                              )}
                            </td>
                            <td className="px-6 py-4">
                              <div className="text-sm text-gray-600 flex flex-col gap-0.5">
                                <span className="flex items-center gap-1.5"><Calendar size={12} className="text-gray-400" /> Visit: {lead.visitDate}</span>
                                {lead.bookingDate && <span className="flex items-center gap-1.5 text-emerald-600"><Calendar size={12} className="text-emerald-400" /> Book: {lead.bookingDate}</span>}
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              <div className="flex flex-col gap-1">
                                {lead.salePrice ? <div className="text-xs font-bold text-emerald-600">ขาย: ฿{Number(lead.salePrice).toLocaleString()}</div> : <div className="text-xs text-gray-400">ขาย: -</div>}
                                {lead.landOfficePrice ? <div className="text-xs font-bold text-blue-600">ท.ด.: ฿{Number(lead.landOfficePrice).toLocaleString()}</div> : <div className="text-xs text-gray-400">ท.ด.: -</div>}
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              <button onClick={() => handleEditLeadClick(lead)} className="text-[#0f172a] font-semibold text-sm hover:text-[#d4af37] transition-colors flex items-center gap-1 opacity-0 group-hover:opacity-100">
                                Edit Profile <ArrowRight size={14} />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                      {filteredLeads.length === 0 && (
                        <tr>
                          <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                            No customers found matching your search.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* BOOKED TAB */}
            {activeTab === 'booked' && (
              <div className="h-full flex flex-col overflow-hidden animate-in fade-in slide-in-from-bottom-2">
                <div className="overflow-y-auto flex-1 p-0 custom-scrollbar">
                  <table className="w-full text-left border-collapse">
                    <thead className="bg-slate-50 sticky top-0 z-10 border-b border-slate-200">
                      <tr>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">รหัสแปลง (Plot)</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">ลูกค้า (Customer)</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">สถานะ (Status)</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">ธนาคาร (Bank)</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">ราคา (Prices)</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">วันที่คาดว่าจะโอน (Expected Transfer)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {bookedLeads.map(lead => {
                        const statusCfg = STATUS_CONFIG[lead.status] || STATUS_CONFIG['Visit'];
                        const StatusIcon = statusCfg.icon;
                        const plotName = projectPlotsData.find(p => p.id === lead.plot)?.plot_name || lead.plot;
                        return (
                          <tr key={lead.id} className="hover:bg-slate-50 transition-colors group cursor-pointer" onClick={() => handleEditLeadClick(lead)}>
                            <td className="px-6 py-4">
                              <span className="font-bold text-[#0f172a] bg-gray-100 px-2 py-1 rounded-md text-sm">{plotName || '-'}</span>
                            </td>
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 font-bold border border-slate-200">
                                  {lead.name?.charAt(0) || '?'}
                                </div>
                                <div>
                                  <div className="font-semibold text-slate-800">{lead.name}</div>
                                  <div className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                                    {formatPhoneNumber(lead.phone)}
                                    {lead.agentName && <span className="ml-2 px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded flex items-center gap-1 border border-blue-100"><User size={8} /> {lead.agentName}</span>}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold ${statusCfg.bg} ${statusCfg.color} border border-white/50 shadow-sm`}>
                                <StatusIcon size={12} />
                                {statusCfg.label}
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              {lead.bank ? (
                                <div className="flex items-center gap-2">
                                  {BANK_LOGOS[lead.bank] && <img src={BANK_LOGOS[lead.bank]} alt={lead.bank} className="w-5 h-5 object-contain" />}
                                  <span className="text-sm font-semibold text-slate-700">{lead.bank}</span>
                                </div>
                              ) : (
                                <span className="text-xs text-gray-400">-</span>
                              )}
                            </td>
                            <td className="px-6 py-4">
                              <div className="flex flex-col gap-1">
                                {lead.salePrice ? <div className="text-xs font-bold text-emerald-600">ขาย: ฿{Number(lead.salePrice).toLocaleString()}</div> : <div className="text-xs text-gray-400">ขาย: -</div>}
                                {lead.landOfficePrice ? <div className="text-xs font-bold text-blue-600">ท.ด.: ฿{Number(lead.landOfficePrice).toLocaleString()}</div> : <div className="text-xs text-gray-400">ท.ด.: -</div>}
                              </div>
                            </td>
                            <td className="px-6 py-4" onClick={(e) => e.stopPropagation()}>
                              <input 
                                type="date"
                                value={lead.expectedTransferDate || ''}
                                onChange={(e) => handleUpdateTransferDate(lead.id, e.target.value)}
                                className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-700 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 bg-white shadow-sm"
                              />
                            </td>
                          </tr>
                        );
                      })}
                      {bookedLeads.length === 0 && (
                        <tr>
                          <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                            ไม่พบข้อมูลลูกค้าที่มีการจอง
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* TRANSFERRED TAB */}
            {activeTab === 'transferred' && (
              <div className="h-full flex flex-col overflow-hidden animate-in fade-in slide-in-from-bottom-2">
                <div className="overflow-y-auto flex-1 p-0 custom-scrollbar">
                  <table className="w-full text-left border-collapse">
                    <thead className="bg-slate-50 sticky top-0 z-10 border-b border-slate-200">
                      <tr>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">รหัสแปลง (Plot)</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">ลูกค้า (Customer)</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">สถานะ (Status)</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">ธนาคาร (Bank)</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">ราคา (Prices)</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">วันที่โอน (Transferred Date)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {transferredLeads.map(lead => {
                        const statusCfg = STATUS_CONFIG[lead.status] || STATUS_CONFIG['Visit'];
                        const StatusIcon = statusCfg.icon;
                        const plotName = projectPlotsData.find(p => p.id === lead.plot)?.plot_name || lead.plot;
                        // Try to find the transfer date from history, fallback to expected transfer date
                        const transferHistory = lead.history?.find((h: any) => h.status === 'Transferred');
                        const transferredDate = transferHistory?.timestamp?.split('T')[0] || lead.expectedTransferDate || '-';
                        
                        return (
                          <tr key={lead.id} className="hover:bg-slate-50 transition-colors group cursor-pointer" onClick={() => handleEditLeadClick(lead)}>
                            <td className="px-6 py-4">
                              <span className="font-bold text-[#0f172a] bg-gray-100 px-2 py-1 rounded-md text-sm">{plotName || '-'}</span>
                            </td>
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-emerald-50 flex items-center justify-center text-emerald-600 font-bold border border-emerald-200">
                                  {lead.name?.charAt(0) || '?'}
                                </div>
                                <div>
                                  <div className="font-semibold text-slate-800">{lead.name}</div>
                                  <div className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                                    {formatPhoneNumber(lead.phone)}
                                    {lead.agentName && <span className="ml-2 px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded flex items-center gap-1 border border-blue-100"><User size={8} /> {lead.agentName}</span>}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold ${statusCfg.bg} ${statusCfg.color} border border-white/50 shadow-sm`}>
                                <StatusIcon size={12} />
                                {statusCfg.label}
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              {lead.bank ? (
                                <div className="flex items-center gap-2">
                                  {BANK_LOGOS[lead.bank] && <img src={BANK_LOGOS[lead.bank]} alt={lead.bank} className="w-5 h-5 object-contain" />}
                                  <span className="text-sm font-semibold text-slate-700">{lead.bank}</span>
                                </div>
                              ) : (
                                <span className="text-xs text-gray-400">-</span>
                              )}
                            </td>
                            <td className="px-6 py-4">
                              <div className="flex flex-col gap-1">
                                {lead.salePrice ? <div className="text-xs font-bold text-emerald-600">ขาย: ฿{Number(lead.salePrice).toLocaleString()}</div> : <div className="text-xs text-gray-400">ขาย: -</div>}
                                {lead.landOfficePrice ? <div className="text-xs font-bold text-blue-600">ท.ด.: ฿{Number(lead.landOfficePrice).toLocaleString()}</div> : <div className="text-xs text-gray-400">ท.ด.: -</div>}
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              <span className="text-sm font-semibold text-slate-700">{transferredDate}</span>
                            </td>
                          </tr>
                        );
                      })}
                      {transferredLeads.length === 0 && (
                        <tr>
                          <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                            ไม่พบข้อมูลลูกค้าที่โอนกรรมสิทธิ์แล้ว
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* PRICING TAB */}
            {activeTab === 'pricing' && (
              <div className="h-full">
                  <SalesPricing project={project} />
              </div>
            )}

            {/* REPORTS TAB */}
            {activeTab === 'reports' && (
              <div className="h-full p-4 md:p-6 overflow-hidden">
                <SalesReports leads={leads} projectName={project?.name || 'ไอลิน6'} />
              </div>
            )}

            {/* INTELLIGENCE TAB */}
            {activeTab === 'intelligence' && (
              <div className="h-full p-0 overflow-y-auto bg-slate-50">
                <SalesIntelligence leads={leads} projectName={project?.name || 'ไอลิน6'} />
              </div>
            )}
            
          </div> {/* End Tab Content */}

          {/* Side Panel */}
          <div className={`
            absolute inset-y-0 right-0 z-50 transform transition-transform duration-300 ease-in-out
            md:relative md:z-auto md:transform-none
            ${panelState.type === 'default' ? 'translate-x-full md:translate-x-0' : 'translate-x-0'}
            w-full md:w-[420px] shrink-0 bg-white md:border-l border-gray-100 overflow-y-auto overflow-x-hidden md:shadow-none
          `}>
            <div key={`${panelState.type}-${panelState.plotId}`} className="flex flex-col min-h-full w-full p-5 md:p-6 relative pt-12 md:pt-6">
                <button 
                  onClick={() => setPanelState({ type: 'default', plotId: '', lead: null })}
                  className="md:hidden absolute top-3 right-4 p-2 bg-slate-100 hover:bg-slate-200 rounded-full z-50 text-slate-500 transition-colors"
                >
                  <X size={18} />
                </button>
            
              {/* Construction Info Widget (Global for any plot) */}
              {panelState.plotId && (
                <div className="mb-6 bg-gradient-to-br from-indigo-50/80 to-blue-50/50 border border-indigo-100 rounded-xl p-4 shadow-sm relative overflow-hidden animate-in fade-in duration-300">
                  <div className="absolute top-0 right-0 p-2 opacity-[0.03] pointer-events-none transform translate-x-4 -translate-y-4">
                      <Pickaxe size={100} />
                  </div>
                  <h4 className="text-[11px] font-bold text-indigo-900 mb-3 flex items-center gap-1.5"><Pickaxe size={14} className="text-indigo-500" /> ข้อมูลจากฝ่ายก่อสร้าง (แปลง {projectPlotsData.find(d => d.id === panelState.plotId)?.plot_name || panelState.plotId})</h4>
                  
                  {loadingPlotInfo ? (
                    <div className="flex items-center gap-2 text-indigo-400 text-xs py-4 justify-center">
                      <Loader2 size={14} className="animate-spin" /> กำลังดึงข้อมูล...
                    </div>
                  ) : plotInfo ? (
                    <div className="flex flex-col gap-4 relative z-10">
                      {plotInfo.overview_image_url && (
                        <div className="w-full aspect-video rounded-lg overflow-hidden border border-indigo-100/50 shadow-sm relative group cursor-pointer" onClick={() => setFullImageUrl(plotInfo.overview_image_url)}>
                          <img src={plotInfo.overview_image_url} alt="รูปหน้าบ้าน" className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                            <span className="opacity-0 group-hover:opacity-100 text-white text-[10px] font-bold bg-black/50 px-2 py-1 rounded-full backdrop-blur-sm transition-opacity shadow-sm">ดูรูปใหญ่</span>
                          </div>
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                        <div className="text-[10px] text-indigo-500/80 font-bold mb-1">ความคืบหน้าก่อสร้าง</div>
                        <div className="flex items-center gap-2">
                            <div className="flex-1 bg-white rounded-full h-1.5 overflow-hidden shadow-inner">
                              <div className="bg-indigo-500 h-full rounded-full transition-all duration-1000 ease-out" style={{ width: `${plotInfo.progress || 0}%` }}></div>
                            </div>
                            <span className="text-xs font-bold text-indigo-900">{plotInfo.progress || 0}%</span>
                        </div>
                      </div>
                      
                      <div>
                        <div className="text-[10px] text-indigo-500/80 font-bold mb-1">แบบบ้าน</div>
                        <div className="text-sm font-bold text-indigo-900 tracking-tight">
                            {plotInfo.house_types?.type_name || plotInfo.house_model || '-'} 
                        </div>
                      </div>

                      <div>
                        <div className="text-[10px] text-indigo-500/80 font-bold mb-1">ขนาดที่ดิน</div>
                        <div className="text-sm font-bold text-indigo-900 tracking-tight">
                            {plotInfo.land_size ? `${plotInfo.land_size} ตร.ว.` : '-'}
                        </div>
                      </div>

                      <div>
                        <div className="text-[10px] text-indigo-500/80 font-bold mb-1">ราคาขาย</div>
                        <div className="text-sm font-bold text-emerald-600 tracking-tight">
                            {plotInfo.selling_price ? `฿${Number(plotInfo.selling_price).toLocaleString()}` : 'ยังไม่ระบุราคา'}
                        </div>
                      </div>
                      {(plotInfo.estimatedCompletion || plotInfo.handover_cycle > 0 || plotInfo.is_completed || plotInfo.statusInfo) && (
                        <div className="col-span-2 pt-3 mt-1 border-t border-indigo-100/60">
                          {plotInfo.estimatedCompletion && !plotInfo.is_completed && (
                            <div className="mb-3">
                              <div className="text-[10px] text-indigo-500/80 font-bold mb-1">คาดว่าจะสร้างเสร็จ</div>
                              <div className="text-xs font-bold text-indigo-900">{new Date(plotInfo.estimatedCompletion).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' })}</div>
                            </div>
                          )}
                          <div>
                              <div className="text-[10px] text-indigo-500/80 font-bold mb-2">สถานะการก่อสร้าง (อัปเดตล่าสุด)</div>
                              <div className="flex flex-col gap-2">
                                {plotInfo.statusInfo && plotInfo.statusInfo.status !== 'none' && (
                                  <div className="flex items-center gap-2">
                                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${plotInfo.statusInfo.color.replace('text-', 'bg-').replace('-600', '-100')} ${plotInfo.statusInfo.color}`}>
                                      {plotInfo.statusInfo.label}
                                    </span>
                                    {plotInfo.activeTask && (
                                      <span className="text-xs text-indigo-900/70 font-semibold truncate" title={plotInfo.activeTask}>
                                        กำลังทำ: {plotInfo.activeTask}
                                      </span>
                                    )}
                                  </div>
                                )}
                                
                                <div className="text-xs font-bold text-indigo-900 mt-1">
                                  {plotInfo.sale_status === 'ready_for_sale' ? (
                                    <span className="text-emerald-600 flex items-center gap-1"><CheckCircle size={12} /> สร้างเสร็จ/พร้อมขายแล้ว</span>
                                  ) : (plotInfo.is_completed || Math.round(plotInfo.progress || 0) === 100) ? (
                                    <span className="text-emerald-600 flex items-center gap-1"><CheckCircle size={12} /> ก่อสร้างเสร็จสิ้น</span>
                                  ) : (
                                    <span className="flex items-center gap-1 text-indigo-600"><Pickaxe size={12} /> อยู่ระหว่างก่อสร้าง {Math.round(plotInfo.progress || 0)}%</span>
                                  )}
                                </div>
                              </div>
                          </div>
                        </div>
                      )}
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-slate-400 py-2">ไม่พบข้อมูลแปลงนี้ในระบบก่อสร้าง</div>
                  )}
                </div>
              )}

              {panelState.type === 'default' ? (
                <div className="hidden md:block">
                  <h3 className="font-bold text-[#0f172a] text-lg mb-4 flex items-center gap-2">
                    <Home className="text-[#d4af37]" />
                    Plot Details
                  </h3>
                  <div className="bg-slate-50 border border-slate-100 rounded-xl p-8 flex flex-col items-center justify-center text-center h-48 mb-6">
                    <MapIcon size={32} className="text-gray-300 mb-3" />
                    <p className="text-sm font-medium text-gray-500">คลิกที่แปลงบ้านบนแผนที่เพื่อดูรายละเอียด, ระบุลูกค้าจอง หรืออัปเดตสถานะ</p>
                  </div>
                  
                  <h4 className="font-bold text-sm text-gray-800 mb-3">Quick Stats</h4>
                  <div className="space-y-3">
                    <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                      <span className="text-sm text-gray-600">Available</span>
                      <span className="font-bold text-[#0f172a]">{availablePlots.length} แปลง</span>
                    </div>
                    <div className="flex justify-between items-center p-3 bg-emerald-50 rounded-lg">
                      <span className="text-sm text-emerald-700">Reserved</span>
                      <span className="font-bold text-emerald-700">{leads.filter(l => l.status === 'Reserved').length}</span>
                    </div>
                    <div className="flex justify-between items-center p-3 bg-teal-50 rounded-lg">
                      <span className="text-sm text-teal-700">Contracted</span>
                      <span className="font-bold text-teal-700">{leads.filter(l => l.status === 'Contracted').length}</span>
                    </div>
                  </div>
                </div>
              ) : null}

              {panelState.type === 'booking' && (
                <div className="flex flex-col h-full animate-in fade-in duration-300">
                  <div className="flex justify-between items-center mb-6">
                    <h3 className="font-bold text-lg text-slate-800 flex items-center gap-2">
                      <Home className="text-[#d4af37]" /> จองแปลง {projectPlotsData.find(d => d.id === panelState.plotId)?.plot_name || panelState.plotId}
                    </h3>
                    <button onClick={() => setPanelState({ type: 'default', plotId: '', lead: null })} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
                  </div>
                  <form onSubmit={handleSaveBooking} className="space-y-5 flex-1" autoComplete="off">
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-1.5">ชื่อลูกค้า</label>
                      <input name="name" type="text" autoComplete="off" className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:outline-none focus:border-[#d4af37] focus:ring-1 focus:ring-[#d4af37] text-sm" placeholder="ระบุชื่อลูกค้า..." required />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-1.5">อาชีพ (ถ้ามี)</label>
                      <input name="occupation" type="text" autoComplete="off" className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:outline-none focus:border-[#d4af37] focus:ring-1 focus:ring-[#d4af37] text-sm" placeholder="เช่น ธุรกิจส่วนตัว, แพทย์..." />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-1.5">เบอร์โทรศัพท์</label>
                      <input name="phone" type="tel" autoComplete="off" onInput={(e) => { e.currentTarget.value = formatPhoneNumber(e.currentTarget.value) }} className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:outline-none focus:border-[#d4af37] focus:ring-1 focus:ring-[#d4af37] text-sm" placeholder="08X-XXX-XXXX" required />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-1.5">วันที่จอง (Transaction Date)</label>
                      <input name="transactionDate" type="date" className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:outline-none focus:border-[#d4af37] text-sm" defaultValue={new Date().toISOString().split('T')[0]} />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-1.5">ราคาขายที่ตกลงกัน (บาท)</label>
                      <input name="salePrice" type="text" autoComplete="off" className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:outline-none focus:border-[#d4af37] focus:ring-1 focus:ring-[#d4af37] text-sm font-semibold" placeholder="เช่น 3500000" />
                    </div>
                    <div className="pt-4">
                      <button type="submit" className="w-full bg-[#0f172a] hover:bg-[#1e293b] text-white font-bold py-3 rounded-xl transition-colors shadow-sm">
                        ยืนยันการจอง
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {panelState.type === 'new-customer' && (
                <div className="flex flex-col h-full animate-in fade-in duration-300">
                  <div className="flex justify-between items-center mb-6">
                    <h3 className="font-bold text-lg text-slate-800 flex items-center gap-2">
                      <Users className="text-blue-600" /> ลูกค้าเยี่ยมชมใหม่
                    </h3>
                    <button onClick={() => setPanelState({ type: 'default', plotId: '', lead: null })} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
                  </div>
                  <form onSubmit={handleSaveNewCustomer} className="space-y-5 flex-1" autoComplete="off">
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-1.5">ชื่อลูกค้า (หรือชื่อเล่น)</label>
                      <input name="name" type="text" autoComplete="off" className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:outline-none focus:border-blue-500 text-sm" placeholder="ระบุชื่อลูกค้า..." required />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-1.5">อาชีพ (ถ้ามี)</label>
                      <input name="occupation" type="text" autoComplete="off" className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:outline-none focus:border-blue-500 text-sm" placeholder="เช่น ธุรกิจส่วนตัว, แพทย์..." />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-1.5">เบอร์โทรศัพท์ (ถ้ามี)</label>
                      <input name="phone" type="tel" autoComplete="off" onInput={(e) => { e.currentTarget.value = formatPhoneNumber(e.currentTarget.value) }} className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:outline-none focus:border-blue-500 text-sm" placeholder="08X-XXX-XXXX" />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-1.5">วันที่เยี่ยมชม (Visit Date)</label>
                      <input name="transactionDate" type="date" className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:outline-none focus:border-blue-500 text-sm" defaultValue={new Date().toISOString().split('T')[0]} />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-1.5">แปลงที่สนใจหลัก (ถ้ามี)</label>
                      <select 
                        name="interest" 
                        className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:outline-none focus:border-blue-500 text-sm appearance-none bg-white"
                        defaultValue="Any"
                      >
                        <option value="Any">ยังไม่ได้ระบุแปลงที่สนใจ (Any)</option>
                        {availablePlots.map(p => (
                          <option key={p} value={p}>{p}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-1.5">แปลงที่สนใจเพิ่มเติม (ถ้ามี)</label>
                      <select 
                        name="interestSecondary" 
                        className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:outline-none focus:border-blue-500 text-sm appearance-none bg-white"
                        defaultValue=""
                      >
                        <option value="">-- ไม่ระบุ --</option>
                        {availablePlots.map(p => (
                          <option key={p} value={p}>{p}</option>
                        ))}
                      </select>
                    </div>
                    {projects && projects.length > 0 && (
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-1.5">สนใจโครงการอื่นเพิ่มเติม (เลือกได้มากกว่า 1 โครงการ)</label>
                        <div className="grid grid-cols-2 gap-2 mt-2">
                          {projects.filter(p => p.name !== project?.name).map((p, index) => (
                            <label key={p.id || p.name || index} className="flex items-center gap-2 text-sm text-slate-600 bg-slate-50 p-2 rounded-lg border border-slate-100 cursor-pointer hover:bg-slate-100 transition-colors">
                              <input type="checkbox" name="otherProjects" value={p.name} className="rounded text-blue-600 focus:ring-blue-500 w-4 h-4" />
                              <span className="font-medium">{p.name}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="pt-4">
                      <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl transition-colors shadow-sm">
                        บันทึกการเยี่ยมชม (Visit)
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {panelState.type === 'customer' && panelState.lead && (
                <div className="flex flex-col h-full animate-in fade-in duration-300">
                  <div className="flex justify-between items-center mb-6">
                    <h3 className="font-bold text-lg text-slate-800 flex items-center gap-2">
                      <UserCheck className="text-[#d4af37]" /> ข้อมูลลูกค้า
                    </h3>
                    <button onClick={() => setPanelState({ type: 'default', plotId: '', lead: null })} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
                  </div>
                  
                  <form onSubmit={handleUpdateCustomer} className="space-y-4 flex-1" autoComplete="off">
                    <div className="flex flex-col items-center p-4 bg-slate-50 border border-slate-100 rounded-2xl text-center mb-2">
                      <div className="w-14 h-14 bg-white rounded-full shadow-sm flex items-center justify-center text-2xl font-bold text-[#0f172a] mb-3">
                        {editCustomerForm.name.charAt(0) || '?'}
                      </div>
                      <div className="text-xs text-gray-500 mb-1">เยี่ยมชมเมื่อ: {panelState.lead.visitDate}</div>
                      {panelState.lead.bookingDate && <div className="text-xs text-emerald-600 font-semibold">จองเมื่อ: {panelState.lead.bookingDate}</div>}
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">ชื่อลูกค้า (แก้ไขได้เมื่อจอง)</label>
                      <input 
                        type="text" 
                        autoComplete="off"
                        value={editCustomerForm.name} 
                        onChange={e => setEditCustomerForm({...editCustomerForm, name: e.target.value})}
                        className="w-full border border-slate-200 rounded-xl px-4 py-2 focus:outline-none focus:border-[#d4af37] text-sm font-bold text-[#0f172a]" 
                        required 
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">วันที่ทำรายการ / วันที่อัปเดตสถานะ</label>
                      <input 
                        type="date" 
                        value={editCustomerForm.transactionDate} 
                        onChange={e => setEditCustomerForm({...editCustomerForm, transactionDate: e.target.value})}
                        className="w-full border border-slate-200 rounded-xl px-4 py-2 focus:outline-none focus:border-[#d4af37] text-sm text-gray-700" 
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">เบอร์โทรศัพท์</label>
                        <input 
                          type="tel" 
                          autoComplete="off"
                          value={editCustomerForm.phone} 
                          onChange={e => setEditCustomerForm({...editCustomerForm, phone: formatPhoneNumber(e.target.value)})}
                          className="w-full border border-slate-200 rounded-xl px-4 py-2 focus:outline-none focus:border-[#d4af37] text-sm" 
                          placeholder="08X-XXX-XXXX"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">อาชีพ</label>
                        <input 
                          type="text" 
                          autoComplete="off"
                          value={editCustomerForm.occupation} 
                          onChange={e => setEditCustomerForm({...editCustomerForm, occupation: e.target.value})}
                          className="w-full border border-slate-200 rounded-xl px-4 py-2 focus:outline-none focus:border-[#d4af37] text-sm" 
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">พนักงานขาย (Sales Agent)</label>
                        <input 
                          type="text" 
                          autoComplete="off"
                          value={editCustomerForm.agentName} 
                          onChange={e => setEditCustomerForm({...editCustomerForm, agentName: e.target.value})}
                          className="w-full border border-slate-200 rounded-xl px-4 py-2 focus:outline-none focus:border-[#d4af37] text-sm" 
                        />
                      </div>
                    </div>

                    <div className="pt-2 border-t border-slate-100">
                      <label className="block text-sm font-semibold text-slate-700 mb-2">อัปเดตสถานะการขาย (Guided Workflow)</label>
                      
                      <div className="flex flex-wrap gap-2 mb-4">
                        {getNextStatuses(panelState.lead.status).map(s => {
                          const config = STATUS_CONFIG[s];
                          const Icon = config.icon;
                          const isSelected = editCustomerForm.status === s;
                          return (
                            <button 
                              key={s} 
                              type="button"
                              onClick={() => setEditCustomerForm({...editCustomerForm, status: s})}
                              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold border transition-all ${isSelected ? 'bg-[#0f172a] text-white border-[#0f172a] shadow-md' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400 hover:bg-slate-50'}`}
                            >
                              <Icon size={14} className={isSelected ? 'text-white' : config.color} />
                              {config.label}
                            </button>
                          )
                        })}
                      </div>

                      {(editCustomerForm.status === 'DocumentPrep' || editCustomerForm.status === 'LoanProcessing') && (
                        <div className="mb-3 animate-in slide-in-from-top-2 duration-200">
                          <label className="block text-xs font-semibold text-slate-700 mb-1">ระบุธนาคาร / วิธีชำระเงิน</label>
                          <div className="relative">
                            {editCustomerForm.bank && editCustomerForm.bank !== 'ซื้อเงินสด' && BANK_LOGOS[editCustomerForm.bank] && (
                              <img src={BANK_LOGOS[editCustomerForm.bank]} alt="Bank Logo" className="absolute left-3 top-1/2 -translate-y-1/2 w-6 h-6 object-contain pointer-events-none" />
                            )}
                            <select 
                              className={`w-full border border-slate-200 rounded-xl py-2.5 focus:outline-none focus:border-cyan-500 font-medium text-slate-700 bg-cyan-50 text-sm appearance-none ${editCustomerForm.bank && editCustomerForm.bank !== 'ซื้อเงินสด' ? 'pl-11 pr-4' : 'px-4'}`}
                              value={editCustomerForm.bank}
                              onChange={e => setEditCustomerForm({...editCustomerForm, bank: e.target.value})}
                              required
                            >
                              <option value="" disabled>-- เลือกธนาคาร/เงินสด --</option>
                              {Object.keys(BANK_LOGOS).map(bank => (
                                <option key={bank} value={bank}>{bank}</option>
                              ))}
                              <option value="ซื้อเงินสด">💵 ซื้อเงินสด</option>
                            </select>
                          </div>
                        </div>
                      )}

                      {['Reserved', 'Contracted', 'DownPayment', 'DocumentPrep', 'LoanProcessing', 'Approved', 'Transferred', 'Handover'].includes(editCustomerForm.status) && (
                        <div className="grid grid-cols-2 gap-3 mb-3 animate-in slide-in-from-top-2 duration-200">
                          <div>
                            <label className="block text-xs font-semibold text-emerald-700 mb-1">ราคาขายที่ตกลงกัน (บาท)</label>
                            <input 
                              type="number"
                              className="w-full border border-emerald-200 rounded-xl px-4 py-2.5 focus:outline-none focus:border-emerald-500 font-medium text-slate-700 bg-emerald-50 text-sm"
                              value={editCustomerForm.salePrice || ''}
                              onChange={e => setEditCustomerForm({...editCustomerForm, salePrice: e.target.value})}
                              placeholder="เช่น 3500000"
                            />
                          </div>
                          {['Approved', 'Transferred', 'Handover'].includes(editCustomerForm.status) && (
                            <div>
                              <label className="block text-xs font-semibold text-blue-700 mb-1">ราคาประเมิน ท.ด. (บาท)</label>
                              <input 
                                type="number"
                                className="w-full border border-blue-200 rounded-xl px-4 py-2.5 focus:outline-none focus:border-blue-500 font-medium text-slate-700 bg-blue-50 text-sm"
                                value={editCustomerForm.landOfficePrice || ''}
                                onChange={e => setEditCustomerForm({...editCustomerForm, landOfficePrice: e.target.value})}
                                placeholder="เช่น 3500000"
                                required
                              />
                            </div>
                          )}
                        </div>
                      )}

                      {editCustomerForm.status === 'Cancelled' && (
                        <div className="mb-3 animate-in slide-in-from-top-2 duration-200">
                          <label className="block text-xs font-semibold text-red-700 mb-1">เหตุผลที่ยกเลิกจอง</label>
                          <textarea 
                            className="w-full border border-red-200 rounded-xl px-4 py-2.5 focus:outline-none focus:border-red-500 font-medium text-slate-700 bg-red-50 text-sm min-h-[80px]"
                            value={editCustomerForm.cancelReason}
                            onChange={e => setEditCustomerForm({...editCustomerForm, cancelReason: e.target.value})}
                            placeholder="ระบุเหตุผล..."
                            required
                          />
                        </div>
                      )}

                      {editCustomerForm.status !== 'Visit' && editCustomerForm.status !== 'Negotiation' && editCustomerForm.status !== 'Cancelled' && (
                        <div>
                          <label className="block text-xs font-semibold text-emerald-700 mb-1">แปลงที่จอง (เลือกได้เฉพาะแปลงว่าง)</label>
                          <select 
                            className="w-full border border-emerald-300 rounded-xl px-4 py-2.5 focus:outline-none focus:border-emerald-500 font-bold text-emerald-800 bg-emerald-50 text-sm"
                            value={editCustomerForm.plot}
                            onChange={e => setEditCustomerForm({...editCustomerForm, plot: e.target.value})}
                            required
                          >
                            <option value="" disabled>-- กรุณาเลือกแปลง --</option>
                            {/* If they already own a plot, include it */}
                            {panelState.lead.plot && <option value={panelState.lead.plot}>{panelState.lead.plot} (แปลงปัจจุบัน)</option>}
                            {availablePlots.map(p => (
                              <option key={p} value={p}>{p} (ว่าง)</option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                    
                    <div className="pt-2 flex flex-col gap-2">
                      <button type="submit" className={`w-full text-white font-bold py-3 rounded-xl transition-colors shadow-sm ${editCustomerForm.status === 'Cancelled' ? 'bg-red-600 hover:bg-red-700' : 'bg-[#0f172a] hover:bg-[#1e293b]'}`}>
                        บันทึกการเปลี่ยนแปลง
                      </button>
                      <button type="button" onClick={() => setPanelState({ type: 'default', plotId: '', lead: null })} className="w-full bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold py-3 rounded-xl transition-colors">
                        ปิดหน้าต่าง
                      </button>
                      {user?.role === 'Admin' && (
                        <button type="button" onClick={() => handleDeleteCustomer(panelState.lead.id)} className="w-full bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 hover:text-red-700 font-bold py-3 rounded-xl transition-colors mt-2 flex items-center justify-center gap-2">
                          <Trash2 size={18} /> ลบข้อมูลลูกค้า
                        </button>
                      )}
                    </div>
                  </form>
                  
                  {/* Timeline History */}
                  {panelState.lead.history && panelState.lead.history.length > 0 && (
                    <div className="mt-8 pt-6 border-t border-slate-200">
                      <h4 className="font-bold text-slate-800 text-sm mb-4 flex items-center gap-2">
                        <Clock size={16} className="text-slate-500" /> ประวัติสถานะ (Timeline)
                      </h4>
                      <div className="space-y-4">
                        {panelState.lead.history.map((h: any, i: number) => {
                          const config = STATUS_CONFIG[h.status] || STATUS_CONFIG['Visit'];
                          const Icon = config.icon;
                          const dateObj = new Date(h.timestamp);
                          const dateStr = dateObj.toLocaleDateString('th-TH', { year: '2-digit', month: 'short', day: 'numeric' });
                          const timeStr = dateObj.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
                          
                          return (
                            <div key={i} className="flex gap-3 relative">
                              {i !== panelState.lead.history.length - 1 && (
                                <div className="absolute top-8 bottom-[-16px] left-[15px] w-0.5 bg-slate-200 z-0"></div>
                              )}
                              <div className={`w-8 h-8 rounded-full ${config.bg} flex items-center justify-center shrink-0 z-10 border border-white shadow-sm`}>
                                <Icon size={14} className={config.color} />
                              </div>
                              <div className="flex-1 bg-white border border-slate-100 rounded-xl p-3 shadow-sm">
                                <div className="flex justify-between items-start mb-1">
                                  <div className="flex items-center gap-2">
                                    <span className={`text-sm font-bold ${config.color}`}>{config.label}</span>
                                  </div>
                                  <span className="text-[10px] text-slate-400 font-medium bg-slate-50 px-2 py-0.5 rounded-full">{dateStr} {timeStr}</span>
                                </div>
                                <p className="text-xs text-slate-500 font-medium mt-1">ผู้ทำรายการ: {h.note || 'System'}</p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
              </div>
            </div>
        </div>
      </div>

      {/* 🌟 Full Screen Image Modal 🌟 */}
      {fullImageUrl && (
        <div className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-sm flex items-center justify-center p-4 sm:p-8 animate-in fade-in duration-200" onClick={() => setFullImageUrl(null)}>
          <button 
            className="absolute top-4 right-4 sm:top-6 sm:right-6 bg-white/10 hover:bg-white/20 text-white rounded-full p-2 transition-colors cursor-pointer border border-white/10"
            onClick={(e) => { e.stopPropagation(); setFullImageUrl(null); }}
          >
            <X size={24} />
          </button>
          <img 
            src={fullImageUrl} 
            alt="Full size" 
            className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl animate-in zoom-in-95 duration-200" 
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
      {/* 🌟 Excel Import Modal 🌟 */}
      {showImportModal && (
        <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col animate-in fade-in zoom-in duration-200">
            <div className="flex items-center justify-between p-6 border-b border-gray-100">
              <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                <Upload size={20} className="text-blue-600" />
                นำเข้าข้อมูลลูกค้าด้วยไฟล์ Excel
              </h2>
              <button onClick={() => { setShowImportModal(false); setImportData([]); }} className="text-gray-400 hover:text-gray-600">
                <X size={24} />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto flex-1">
              <div className="bg-blue-50 border border-blue-100 p-4 rounded-xl mb-6">
                <h3 className="font-semibold text-blue-800 mb-2">คำแนะนำการนำเข้าข้อมูล</h3>
                <ul className="text-sm text-blue-700 list-disc list-inside space-y-1">
                  <li>กรุณาดาวน์โหลด Template ไปกรอกข้อมูลเพื่อป้องกันความผิดพลาดของหัวตาราง</li>
                  <li>สามารถรองรับไฟล์นามสกุล <b>.xlsx, .xls, .csv</b></li>
                  <li>ข้อมูล Customer Name (ชื่อลูกค้า) และ Phone (เบอร์โทร) จำเป็นต้องระบุ</li>
                  <li>หากไม่ระบุ Status ระบบจะตั้งค่าเป็น "Visit" โดยอัตโนมัติ</li>
                </ul>
                <button 
                  onClick={handleDownloadTemplate}
                  className="mt-3 bg-white border border-blue-200 text-blue-700 px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 hover:bg-blue-100 transition-colors"
                >
                  <Download size={16} />
                  ดาวน์โหลด Template
                </button>
              </div>

              <div className="mb-6">
                <label className="block text-sm font-semibold text-gray-700 mb-2">อัปโหลดไฟล์ของคุณ</label>
                <input 
                  type="file" 
                  accept=".xlsx, .xls, .csv" 
                  onChange={handleFileUpload}
                  className="block w-full text-sm text-gray-500 file:mr-4 file:py-2.5 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 cursor-pointer border border-gray-200 rounded-xl bg-gray-50"
                />
              </div>

              {importData.length > 0 && (
                <div className="border border-gray-200 rounded-xl overflow-hidden">
                  <div className="bg-gray-50 px-4 py-3 border-b border-gray-200 flex justify-between items-center">
                    <span className="font-semibold text-gray-700">Preview ข้อมูล ({importData.length} รายการ)</span>
                  </div>
                  <div className="overflow-x-auto max-h-[300px]">
                    <table className="w-full text-left text-sm whitespace-nowrap">
                      <thead className="bg-white sticky top-0 shadow-sm z-10">
                        <tr>
                          <th className="px-4 py-3 font-semibold text-gray-600 border-b border-gray-100">ชื่อลูกค้า</th>
                          <th className="px-4 py-3 font-semibold text-gray-600 border-b border-gray-100">เบอร์โทร</th>
                          <th className="px-4 py-3 font-semibold text-gray-600 border-b border-gray-100">สถานะ</th>
                          <th className="px-4 py-3 font-semibold text-gray-600 border-b border-gray-100">แปลง</th>
                          <th className="px-4 py-3 font-semibold text-gray-600 border-b border-gray-100 text-right">ราคาขาย</th>
                          <th className="px-4 py-3 font-semibold text-gray-600 border-b border-gray-100 text-right">ราคา ท.ด.</th>
                          <th className="px-4 py-3 font-semibold text-gray-600 border-b border-gray-100">ความสนใจ</th>
                          <th className="px-4 py-3 font-semibold text-gray-600 border-b border-gray-100">ผู้ดูแล (Sales)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 bg-white">
                        {importData.slice(0, 100).map((row, idx) => (
                          <tr key={idx} className="hover:bg-gray-50">
                            <td className="px-4 py-2">{row['Customer Name'] || '-'}</td>
                            <td className="px-4 py-2">{row['Phone'] || '-'}</td>
                            <td className="px-4 py-2">
                              <span className="bg-gray-100 text-gray-700 px-2 py-0.5 rounded text-xs font-semibold">
                                {row['Status'] || 'Visit'}
                              </span>
                            </td>
                            <td className="px-4 py-2">{row['Plot'] || '-'}</td>
                            <td className="px-4 py-2 text-right">{row['Sale Price'] ? Number(row['Sale Price']).toLocaleString() : '-'}</td>
                            <td className="px-4 py-2 text-right">{row['Land Price'] ? Number(row['Land Price']).toLocaleString() : '-'}</td>
                            <td className="px-4 py-2">{row['Interest'] || '-'}</td>
                            <td className="px-4 py-2">{row['Sales Agent'] || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {importData.length > 100 && (
                    <div className="p-2 text-center text-xs text-gray-500 bg-gray-50 border-t border-gray-200">
                      แสดงตัวอย่างสูงสุด 100 รายการแรกเท่านั้น
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="p-6 border-t border-gray-100 bg-gray-50 flex justify-end gap-3 rounded-b-2xl">
              <button 
                onClick={() => { setShowImportModal(false); setImportData([]); }}
                className="px-5 py-2.5 rounded-xl font-semibold text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 transition-colors"
                disabled={isImporting}
              >
                ยกเลิก
              </button>
              <button 
                onClick={handleConfirmImport}
                disabled={importData.length === 0 || isImporting}
                className="px-5 py-2.5 rounded-xl font-bold text-white bg-blue-600 hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {isImporting ? <Loader2 size={18} className="animate-spin" /> : <Upload size={18} />}
                {isImporting ? 'กำลังนำเข้า...' : `ยืนยันนำเข้าข้อมูล (${importData.length})`}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
