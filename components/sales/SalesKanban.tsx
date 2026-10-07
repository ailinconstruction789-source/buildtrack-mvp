"use client";

import React, { useState, useEffect } from 'react';
import { Search, Plus, Map as MapIcon, Users, ListFilter, Download, ChevronRight, Home, Phone, Calendar, ArrowRight, ArrowLeft, LogOut, UserCheck, User, Key, X, FileText, Clock, CheckCircle, XCircle, Banknote, Building2, FileSignature, Pickaxe, Loader2, TrendingUp, Upload, Trash2, PieChart, Lightbulb, Sun, Moon, AlertTriangle, Sparkles, CreditCard } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import SalesMap from './SalesMap';
import SalesPricing from './SalesPricing';
import DailyVisitsScheduleView from './DailyVisitsScheduleView';
import DailyHouseInspectionModal from './DailyHouseInspectionModal';
import RentalContractModal from './RentalContractModal';
import RentalActionModal from './RentalActionModal';
import RentalPaymentLedgerModal from './RentalPaymentLedgerModal';
import CentralLeadBookingModal from './CentralLeadBookingModal';
import LeadPicker from './LeadPicker';
import { RENTAL_PROGRAM_DETAILS } from '@/types/sales';
import { deleteCustomerWithCascade } from '@/lib/customerDeletionHelper';
import { parseExcelRowToLead, downloadLeadTrackerTemplate, ParsedLeadRow } from '@/lib/salesImportHelper';
import { isSampleHouse, isPlotEligibleForSampleHouse, toggleSampleHouse, fetchTodayInspectionStatus, SampleHouseInspectionStatus } from '@/lib/sales/sampleHouseHelper';

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

export const stageToKanbanStatus = (stage: string): string => {
  switch (stage?.toLowerCase()) {
    case 'booked': return 'Reserved';
    case 'contracted': return 'Contracted';
    case 'downpayment': return 'DownPayment';
    case 'document_prep': return 'DocumentPrep';
    case 'loan_submitted':
    case 'loan_processing': return 'LoanProcessing';
    case 'loan_approved': return 'Approved';
    case 'transfer_pending': return 'Approved';
    case 'transferred': return 'Transferred';
    case 'handover': return 'Handover';
    case 'cancelled':
    case 'loan_rejected': return 'Cancelled';
    default: return 'Reserved';
  }
};

export const kanbanStatusToStage = (status: string): string => {
  switch (status) {
    case 'Reserved': return 'booked';
    case 'Contracted': return 'contracted';
    case 'DownPayment': return 'downpayment';
    case 'DocumentPrep': return 'document_prep';
    case 'LoanProcessing': return 'loan_submitted';
    case 'Approved': return 'loan_approved';
    case 'Transferred': return 'transferred';
    case 'Handover': return 'handover';
    case 'Cancelled': return 'cancelled';
    default: return 'booked';
  }
};

export default function SalesKanban({ 
  project: externalProject, 
  projects, 
  user, 
  initialTab = 'daily_visits',
  onBack 
}: { 
  project?: any, 
  projects?: any[], 
  user?: any, 
  initialTab?: string,
  onBack?: () => void 
}) {
  const [internalProject, setInternalProject] = useState<any>(externalProject || null);

  useEffect(() => {
    if (externalProject) setInternalProject(externalProject);
  }, [externalProject]);

  const project = internalProject;

  const [leads, setLeads] = useState(initialLeads);
  const [rawLeads, setRawLeads] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'daily_visits' | 'map' | 'booked' | 'transferred' | 'list' | 'pricing'>((initialTab as any) || 'daily_visits');
  const [search, setSearch] = useState('');
  
  const [panelState, setPanelState] = useState<{type: 'default' | 'booking' | 'customer' | 'new-customer', plotId: string, lead: any}>({ type: 'default', plotId: '', lead: null });
  const [isSubmitting, setIsSubmitting] = useState(false);

  // For Customer Editing
  const [editCustomerForm, setEditCustomerForm] = useState({ name: '', phone: '', occupation: '', status: '', plot: '', salePrice: '', bank: '', cancelReason: '', landOfficePrice: '', agentName: '', transactionDate: new Date().toISOString().split('T')[0], note: '' });

  // Real Plot Data from Supabase
  const [projectPlots, setProjectPlots] = useState<string[]>([]);
  const [projectPlotsData, setProjectPlotsData] = useState<any[]>([]);
  const [plotInfo, setPlotInfo] = useState<any>(null);
  const [loadingPlotInfo, setLoadingPlotInfo] = useState(false);
  const [fullImageUrl, setFullImageUrl] = useState<string | null>(null);

  // Sample House State & Daily Inspection
  const [showDailyInspectionModal, setShowDailyInspectionModal] = useState(false);
  const [sampleHouseInspection, setSampleHouseInspection] = useState<SampleHouseInspectionStatus | null>(null);
  const [isTogglingSampleHouse, setIsTogglingSampleHouse] = useState(false);

  // Rental & Booking Modals State
  const [showRentalModal, setShowRentalModal] = useState<{ isOpen: boolean; lead: any | null; plotId?: string | null }>({ isOpen: false, lead: null });
  const [showRentalActionModal, setShowRentalActionModal] = useState<{ isOpen: boolean; lead: any | null; plot?: any | null }>({ isOpen: false, lead: null });
  const [showRentalPaymentModal, setShowRentalPaymentModal] = useState<{ isOpen: boolean; plot: any | null; lead: any | null; contractId?: string | null }>({ isOpen: false, plot: null, lead: null });
  const [showBookingModal, setShowBookingModal] = useState<{ isOpen: boolean; lead: any | null; plotId?: string | null }>({ isOpen: false, lead: null });
  const [selectedPlotLead, setSelectedPlotLead] = useState<any | null>(null);

  // Excel Import State
  const [showImportModal, setShowImportModal] = useState(false);
  const [importData, setImportData] = useState<ParsedLeadRow[]>([]);
  const [isImporting, setIsImporting] = useState(false);

  // Project Availability State for Selector (Filter only projects with available houses)
  const [projectAvailability, setProjectAvailability] = useState<Record<string, { total: number; vacant: number }>>({});
  const [loadingAvailability, setLoadingAvailability] = useState(false);
  const [showOnlyAvailable, setShowOnlyAvailable] = useState(true);

  useEffect(() => {
    if (internalProject) return;
    let isCancelled = false;
    const fetchAvailability = async () => {
      setLoadingAvailability(true);
      try {
        const { data: plotsData } = await supabase
          .from('plots')
          .select('id, project_name, has_customer, sale_status');
        const { data: salesData } = await supabase
          .from('sales')
          .select('plot_id, contract_status');

        if (isCancelled) return;

        const occupied = new Set((salesData || [])
          .filter((s: any) => (s.contract_status || '').toLowerCase() !== 'cancelled')
          .map((s: any) => s.plot_id));

        const counts: Record<string, { total: number; vacant: number }> = {};
        for (const p of plotsData || []) {
          if (!p.project_name) continue;
          if (!counts[p.project_name]) {
            counts[p.project_name] = { total: 0, vacant: 0 };
          }
          counts[p.project_name].total++;
          const isVacant = p.has_customer === false &&
            (!p.sale_status || ['active', 'normal', 'ready_for_sale', 'available', 'vacant', ''].includes(p.sale_status.toLowerCase())) &&
            !occupied.has(p.id);
          if (isVacant) {
            counts[p.project_name].vacant++;
          }
        }
        setProjectAvailability(counts);
      } catch (err) {
        console.error('Error fetching project availability:', err);
      } finally {
        if (!isCancelled) setLoadingAvailability(false);
      }
    };
    fetchAvailability();
    return () => { isCancelled = true; };
  }, [internalProject]);

  // Fetch Leads and Sales Data from Supabase
  const fetchData = async () => {
    if (!internalProject) return;
    const projName = internalProject.name;
    try {
      // 1. Fetch plots for dropdowns
      const { data: plotsData } = await supabase.from('plots').select('*').eq('project_name', projName);
      if (plotsData) {
        setProjectPlots(plotsData.map(p => p.id));
        setProjectPlotsData(plotsData);
      }

      // 2. Fetch sales from crm_v2_project_sales RPC
      const salesRows: any[] = [];
      let page = 0;
      let hasMore = true;
      while (hasMore && page < 10) {
        const { data: res, error } = await supabase.rpc('crm_v2_project_sales', {
          p_project_name: projName,
          p_tab: 'all',
          p_query: '',
          p_page: page
        });
        if (error) break;
        if (res?.rows) salesRows.push(...res.rows);
        hasMore = Boolean(res?.hasMore);
        page++;
      }

      // 3. Fallback to direct sales table if RPC returns 0
      let fallbackSales: any[] = [];
      if (salesRows.length === 0 && plotsData && plotsData.length > 0) {
        const plotIds = plotsData.map((p: any) => p.id);
        const { data: directSales } = await supabase.from('sales').select('*').in('plot_id', plotIds.slice(0, 100));
        if (directSales) fallbackSales = directSales;
      }

      // 4. Fetch leads from leads table
      const { data: leadsData } = await supabase.from('leads').select('*').eq('project_name', projName);

      // 5. Format sales from CRM V2 into Kanban lead structure
      let formattedLeads: any[] = [];

      if (salesRows.length > 0) {
        formattedLeads = salesRows.map((s: any) => {
          const kanbanStatus = stageToKanbanStatus(s.stage);
          const bookDate = s.importedHistory?.bookedDate || s.bookedAt?.split('T')[0] || '';
          const transferDate = s.importedHistory?.transferredDate || s.transferredAt?.split('T')[0] || null;
          const cancelDate = s.importedHistory?.cancelledDate || s.cancelledAt?.split('T')[0] || null;
          const visitDate = bookDate || s.created_at?.split('T')[0] || '';
          const matchingPlot = plotsData?.find((p: any) => p.id === s.plotId || p.plot_name === s.plotName);
          
          return {
            id: s.saleId,
            saleId: s.saleId,
            name: s.customerName || 'ลูกค้าไม่ระบุชื่อ',
            phone: s.phone || '',
            occupation: '',
            interest: projName,
            status: kanbanStatus,
            plot: s.plotId || matchingPlot?.id || null,
            plotName: s.plotName || matchingPlot?.plot_name || s.plotId || null,
            bank: s.bankName || '',
            cancelReason: s.cancellationReason || '',
            landOfficePrice: '',
            salePrice: s.salePrice ? Number(s.salePrice) : Number(matchingPlot?.selling_price || 0),
            expectedTransferDate: s.expectedTransferDate || s.expected_transfer_date || matchingPlot?.expected_transfer_date || null,
            visitDate,
            bookingDate: bookDate,
            transferredDate: transferDate,
            cancelledDate: cancelDate,
            agentName: s.ownerName || '',
            source: 'Walk-in',
            bankStatus: 'Pending',
            stage: s.stage,
            importedHistory: s.importedHistory,
            history: [
              ...(bookDate ? [{ status: 'Reserved', timestamp: bookDate, note: s.ownerName }] : []),
              ...(transferDate ? [{ status: 'Transferred', timestamp: transferDate, note: s.ownerName }] : []),
              ...(cancelDate ? [{ status: 'Cancelled', timestamp: cancelDate, note: s.cancellationReason }] : [])
            ]
          };
        });
      } else if (fallbackSales.length > 0) {
        formattedLeads = fallbackSales.map((s: any) => {
          const matchingPlot = plotsData?.find((p: any) => p.id === s.plot_id);
          const matchingLead = leadsData?.find((l: any) => l.id === s.lead_id);
          const status = s.contract_status === 'Cancelled' ? 'Cancelled'
            : s.contract_status === 'Transferred' ? 'Transferred'
            : 'Reserved';
          return {
            id: s.id,
            saleId: s.id,
            name: matchingLead?.customer_name || 'ลูกค้าไม่ระบุชื่อ',
            phone: matchingLead?.phone || '',
            occupation: matchingLead?.occupation || '',
            interest: projName,
            status,
            plot: s.plot_id || null,
            plotName: matchingPlot?.plot_name || s.plot_id || null,
            bank: s.bank_name || '',
            cancelReason: s.cancellation_reason || '',
            landOfficePrice: s.land_office_price?.toString() || '',
            salePrice: s.sale_price ? Number(s.sale_price) : Number(matchingPlot?.selling_price || 0),
            expectedTransferDate: s.expected_transfer_date || matchingPlot?.expected_transfer_date || null,
            visitDate: s.created_at?.split('T')[0] || '',
            bookingDate: s.booked_at?.split('T')[0] || s.created_at?.split('T')[0] || '',
            transferredDate: s.transferred_at?.split('T')[0] || null,
            cancelledDate: s.cancelled_at?.split('T')[0] || null,
            agentName: matchingLead?.agent_name || '',
            source: matchingLead?.source || 'Walk-in',
            bankStatus: s.bank_status || 'Pending',
            stage: s.contract_status,
            history: []
          };
        });
      }

      // Also append any prospective leads from leads table that don't have sales
      if (leadsData && leadsData.length > 0) {
        const existingNames = new Set(formattedLeads.map(l => l.name));
        leadsData.forEach((l: any) => {
          if (!existingNames.has(l.customer_name)) {
            formattedLeads.push({
              id: l.id,
              name: l.customer_name,
              phone: l.phone || '',
              occupation: l.occupation || '',
              interest: l.interest || projName,
              status: l.status || 'Visit',
              plot: null,
              plotName: null,
              bank: '',
              cancelReason: '',
              landOfficePrice: '',
              salePrice: 0,
              expectedTransferDate: null,
              visitDate: l.created_at?.split('T')[0] || '',
              bookingDate: null,
              agentName: l.agent_name || '',
              source: l.source || 'Walk-in',
              bankStatus: 'Pending',
              history: []
            });
          }
        });
      }

      setLeads(formattedLeads);
      setRawLeads([...formattedLeads, ...(leadsData || [])]);
    } catch(e) {
      console.error('Error fetching sales data:', e);
    }
  };

  useEffect(() => {
    fetchData();
  }, [internalProject?.name]);

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
            else if (actualAvg < plannedAvg) statusInfo = { status: 'delayed', label: 'ล่าช้ากว่าแผน', color: 'text-rose-600' };
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

          if (isSampleHouse(plotData)) {
            const insp = await fetchTodayInspectionStatus(project?.name || 'ไอลิน6', plotData.plot_name || plotData.id);
            setSampleHouseInspection(insp);
          } else {
            setSampleHouseInspection(null);
          }
        } else {
          setPlotInfo(null);
          setSampleHouseInspection(null);
        }
      } catch (err) {
        console.error("Error fetching plot info:", err);
      } finally {
        setLoadingPlotInfo(false);
      }
    };

    fetchPlotInfo();
  }, [panelState.plotId]);

  const handleToggleSampleHouse = async () => {
    if (!plotInfo && !panelState.plotId) return;
    const targetId = plotInfo?.id || panelState.plotId;
    const activePlot = plotInfo || projectPlotsData.find(p => p.id === targetId);
    const currentIsSample = isSampleHouse(activePlot);
    const newIsSample = !currentIsSample;

    if (newIsSample) {
      const eligibility = isPlotEligibleForSampleHouse(activePlot, panelState.lead, panelState.lead?.status);
      if (!eligibility.eligible) {
        alert(eligibility.reason || 'แปลงนี้มีลูกค้าจองหรือโอนแล้ว ไม่สามารถตั้งเป็นบ้านตัวอย่างได้');
        return;
      }
    }

    setIsTogglingSampleHouse(true);
    try {
      const res = await toggleSampleHouse(targetId, newIsSample, activePlot, panelState.lead);
      if (!res.success) {
        alert(res.error || 'ไม่สามารถบันทึกสถานะบ้านตัวอย่างได้');
        return;
      }

      await fetchData();
      // Re-fetch plot details
      const { data: updatedPlot } = await supabase
        .from('plots')
        .select('*, house_types(type_name)')
        .eq('id', targetId)
        .maybeSingle();

      if (updatedPlot) {
        setPlotInfo((prev: any) => ({ ...prev, ...updatedPlot }));
        if (newIsSample) {
          const insp = await fetchTodayInspectionStatus(project?.name || 'ไอลิน6', updatedPlot.plot_name || targetId);
          setSampleHouseInspection(insp);
        } else {
          setSampleHouseInspection(null);
        }
      }
    } catch (err) {
      console.error('Error toggling sample house:', err);
    } finally {
      setIsTogglingSampleHouse(false);
    }
  };

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
    if (status === 'Available' || status === 'Cancelled' || status === 'Rejected' || !lead) {
      setPanelState({ type: 'booking', plotId, lead: null });
    } else if (lead) {
      setPanelState({ type: 'customer', plotId, lead });
      setEditCustomerForm({ name: lead.name, phone: lead.phone, occupation: lead.occupation || '', status: lead.status, plot: lead.plot || '', salePrice: lead.salePrice?.toString() || '', bank: lead.bank || '', cancelReason: lead.cancelReason || '', landOfficePrice: lead.landOfficePrice || '', transactionDate: new Date().toISOString().split('T')[0], agentName: lead.agentName || '', note: '' });
    }
  };

  const handleEditLeadClick = (lead: any) => {
    setActiveTab('map');
    setPanelState({ type: 'customer', plotId: lead.plot || '', lead });
    setEditCustomerForm({ name: lead.name, phone: lead.phone, occupation: lead.occupation || '', status: lead.status, plot: lead.plot || '', salePrice: lead.salePrice?.toString() || '', bank: lead.bank || '', cancelReason: lead.cancelReason || '', landOfficePrice: lead.landOfficePrice || '', transactionDate: new Date().toISOString().split('T')[0], agentName: lead.agentName || '', note: '' });
  };

  const handleSaveBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const formData = new FormData(e.target as HTMLFormElement);
      const projName = internalProject?.name || project?.name || 'ไอลิน6';
      const name = (formData.get('name') as string)?.trim() || 'ลูกค้าไม่ระบุชื่อ';
      const phoneInput = (formData.get('phone') as string) || '';
      const cleanPhone = phoneInput.replace(/[^0-9]/g, '') || '0800000000';
      const occupation = (formData.get('occupation') as string)?.trim() || '';
      const salePriceInput = formData.get('salePrice') as string;
      const parsedSalePrice = salePriceInput ? Number(salePriceInput.replace(/[^0-9.-]+/g,"")) : 0;
      const txDateStr = formData.get('transactionDate') as string;
      const txDate = txDateStr ? new Date(`${txDateStr}T12:00:00Z`).toISOString() : new Date().toISOString();

      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      const actorId = sessionData?.session?.user?.id;

      // 1. Attempt CRM V2 booking endpoint
      let bookingSuccess = false;
      if (token) {
        try {
          const res = await fetch('/api/sales-crm/bookings', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
              requestId: crypto.randomUUID(),
              command: 'book',
              reason: 'จองแปลงจากระบบ Kanban',
              customerId: null,
              newCustomer: {
                name,
                phone: cleanPhone,
                channel: 'walk_in',
                notes: occupation ? `อาชีพ: ${occupation}` : '',
                assignedSalesUserId: null,
              },
              projectName: projName,
              expectedInterestRevision: null,
              plotId: panelState.plotId,
              paymentMethod: 'mortgage',
              bookingRoute: 'without_visit',
              visitId: null,
              listPriceSatang: Math.round(parsedSalePrice * 100),
              discountSatang: 0,
              depositSatang: 0,
              previousSaleId: null,
            })
          });

          if (res.ok) {
            bookingSuccess = true;
          } else {
            const errJson = await res.json().catch(() => null);
            // If admin requires assignedSalesUserId, retry with actorId
            if (errJson?.error?.code === 'INVALID_INPUT' && actorId) {
              const retryRes = await fetch('/api/sales-crm/bookings', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                  requestId: crypto.randomUUID(),
                  command: 'book',
                  reason: 'จองแปลงจากระบบ Kanban',
                  customerId: null,
                  newCustomer: {
                    name,
                    phone: cleanPhone,
                    channel: 'walk_in',
                    notes: occupation ? `อาชีพ: ${occupation}` : '',
                    assignedSalesUserId: actorId,
                  },
                  projectName: projName,
                  expectedInterestRevision: null,
                  plotId: panelState.plotId,
                  paymentMethod: 'mortgage',
                  bookingRoute: 'without_visit',
                  visitId: null,
                  listPriceSatang: Math.round(parsedSalePrice * 100),
                  discountSatang: 0,
                  depositSatang: 0,
                  previousSaleId: null,
                })
              });
              if (retryRes.ok) bookingSuccess = true;
            }
          }
        } catch (apiErr) {
          console.warn("API booking error, falling back to direct CRM V2 table write:", apiErr);
        }
      }

      // 2. Direct database insert fallback into CRM V2 sales table
      if (!bookingSuccess) {
        await supabase.from('sales').insert([{
          plot_id: panelState.plotId,
          contract_status: 'Reserved',
          crm_stage: 'booked',
          sale_price: parsedSalePrice,
          booked_at: txDate,
          created_at: txDate
        }]);
      }

      await fetchData();
      setPanelState({ type: 'default', plotId: '', lead: null });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveNewCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const formData = new FormData(e.target as HTMLFormElement);
      const projName = internalProject?.name || project?.name || 'ไอลิน6';
      const name = (formData.get('name') as string)?.trim() || 'ลูกค้าไม่ระบุชื่อ';
      const phoneInput = (formData.get('phone') as string) || '';
      const cleanPhone = phoneInput.replace(/[^0-9]/g, '') || '0800000000';
      const occupation = (formData.get('occupation') as string)?.trim() || '';
      
      const interestPrimary = formData.get('interest') as string;
      const interestSecondary = formData.get('interestSecondary') as string;
      const otherProjects = formData.getAll('otherProjects') as string[];
      
      let finalInterest = interestPrimary === 'Any' ? 'Any' : `${interestPrimary}`;
      if (interestSecondary && interestSecondary.trim()) {
         finalInterest = interestPrimary === 'Any' ? interestSecondary.trim() : `${finalInterest}, ${interestSecondary.trim()}`;
      }
      if (otherProjects.length > 0) {
         const otherProjectsStr = `สนใจโครงการอื่น: ${otherProjects.join(', ')}`;
         finalInterest = finalInterest === 'Any' ? otherProjectsStr : `${finalInterest} (${otherProjectsStr})`;
      }

      const notesText = [occupation ? `อาชีพ: ${occupation}` : '', finalInterest !== 'Any' ? `สนใจ: ${finalInterest}` : ''].filter(Boolean).join(' | ');

      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      const actorId = sessionData?.session?.user?.id;

      // Call CRM V2 central endpoint
      let centralSuccess = false;
      if (token) {
        try {
          const res = await fetch('/api/sales-crm/central', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
              requestId: crypto.randomUUID(),
              name,
              phone: cleanPhone,
              channel: 'walk_in',
              notes: notesText,
              interests: [{ projectName: projName, plotId: null }],
            })
          });

          if (res.ok) {
            centralSuccess = true;
          } else {
            const errJson = await res.json().catch(() => null);
            if (errJson?.error?.code === 'SALES_OWNER_REQUIRED' && actorId) {
              const retryRes = await fetch('/api/sales-crm/central', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                  requestId: crypto.randomUUID(),
                  name,
                  phone: cleanPhone,
                  channel: 'walk_in',
                  notes: notesText,
                  interests: [{ projectName: projName, plotId: null }],
                  assignedSalesUserId: actorId,
                })
              });
              if (retryRes.ok) centralSuccess = true;
            }
          }
        } catch (apiErr) {
          console.warn("API central error:", apiErr);
        }
      }

      await fetchData();
      setPanelState({ type: 'default', plotId: '', lead: null });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteCustomer = async (leadId: string) => {
    if (!window.confirm("คุณต้องการลบข้อมูลลูกค้านี้ใช่หรือไม่?\nการลบจะทำการปลดแปลงกลับเป็นแปลงว่าง (Available) และลบสัญญาเช่า ประวัติค่างวด ยอดจอง และประวัติที่เกี่ยวข้องทั้งหมดออกถาวร")) return;
    
    try {
      setIsSubmitting(true);
      const result = await deleteCustomerWithCascade(leadId, panelState.plotId || panelState.lead?.plot);
      
      if (!result.success) {
        throw new Error(result.error || 'ลบข้อมูลลูกค้าไม่สำเร็จ');
      }

      // Refresh
      await fetchData();
      setPanelState({ type: 'default', plotId: '', lead: null });
      alert(`🗑️ ลบข้อมูลลูกค้า "${result.customerName || 'ลูกค้า'}" สำเร็จ! ${result.releasedPlotIds.length > 0 ? `ปลดแปลง ${result.releasedPlotIds.join(', ')} เรียบร้อยแล้ว` : ''}`);
    } catch (err: any) {
      console.error("Error deleting customer", err);
      alert(err.message || "เกิดข้อผิดพลาดในการลบข้อมูลลูกค้า");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const leadId = panelState.lead.id;
      const saleId = panelState.lead.saleId || panelState.lead.id;
      const oldStatus = panelState.lead.status;
      const newStatus = editCustomerForm.status;
      const isNewBooking = oldStatus === 'Visit' && newStatus !== 'Visit';
      const txDateStr = editCustomerForm.transactionDate;
      const txDate = txDateStr ? new Date(`${txDateStr}T12:00:00Z`).toISOString() : new Date().toISOString();
      const parsedSalePrice = editCustomerForm.salePrice ? Number(editCustomerForm.salePrice.replace(/[^0-9.-]+/g,"")) : null;
      const parsedLandOfficePrice = editCustomerForm.landOfficePrice ? Number(editCustomerForm.landOfficePrice.replace(/[^0-9.-]+/g,"")) : null;
      
      const salePayload: any = {
        contract_status: newStatus === 'Transferred' || newStatus === 'Handover' ? 'Transferred' : (newStatus === 'Contracted' || newStatus === 'DownPayment' || newStatus === 'DocumentPrep' || newStatus === 'LoanProcessing' || newStatus === 'Approved' ? 'Contracted' : newStatus === 'Cancelled' ? 'Cancelled' : 'Reserved'),
        crm_stage: kanbanStatusToStage(newStatus),
        cancellation_reason: newStatus === 'Cancelled' ? editCustomerForm.cancelReason : null,
        sale_price: parsedSalePrice,
        land_office_price: parsedLandOfficePrice,
        bank_name: editCustomerForm.bank || null,
        ...(newStatus === 'Transferred' || newStatus === 'Handover' ? { transferred_at: txDate } : {}),
        ...(newStatus === 'Cancelled' ? { cancelled_at: txDate } : {})
      };

      // 1. Update sales record if saleId exists
      if (saleId) {
        await supabase.from('sales').update(salePayload).eq('id', saleId);
      }

      // 2. Also check if there is an existing sale by lead_id
      const { data: existingSale } = await supabase.from('sales').select('id').eq('lead_id', leadId).maybeSingle();
      if (existingSale && existingSale.id !== saleId) {
        await supabase.from('sales').update(salePayload).eq('id', existingSale.id);
      } else if (isNewBooking && !saleId) {
        await supabase.from('sales').insert([{ plot_id: panelState.plotId, ...salePayload }]);
      }

      if (oldStatus !== newStatus || editCustomerForm.bank !== panelState.lead.bank || editCustomerForm.note) {
        let noteParts = [];
        if (oldStatus === newStatus && editCustomerForm.bank !== panelState.lead.bank) {
          noteParts.push(`เปลี่ยนธนาคารเป็น: ${editCustomerForm.bank}`);
        } else if ((newStatus === 'DocumentPrep' || newStatus === 'LoanProcessing') && editCustomerForm.bank) {
          noteParts.push(`ยื่นผ่าน: ${editCustomerForm.bank}`);
        } else if (newStatus === 'Cancelled' && editCustomerForm.cancelReason) {
          noteParts.push(`เหตุผล: ${editCustomerForm.cancelReason}`);
        } else if (newStatus === 'Approved' && editCustomerForm.landOfficePrice) {
          noteParts.push(`ราคา ท.ด. ฿${parseInt(editCustomerForm.landOfficePrice).toLocaleString()}`);
        }
        
        if (editCustomerForm.note) {
          noteParts.push(`หมายเหตุ: ${editCustomerForm.note}`);
        }
        
        const finalNote = noteParts.join(' | ');

        await supabase.from('status_history').insert([{
          entity_type: 'lead',
          entity_id: leadId,
          old_status: oldStatus,
          new_status: newStatus,
          changed_by: (user?.username || 'Unknown') + (finalNote ? ` (${finalNote})` : ''),
          created_at: txDate
        }]);
      }

      await fetchData();
      setPanelState({ type: 'default', plotId: '', lead: null });
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredLeads = sortLeadsByPlot(leads.filter(l => {
    if (search && !l.name.toLowerCase().includes(search.toLowerCase()) && !l.phone.includes(search) && (!l.plot || !l.plot.toLowerCase().includes(search.toLowerCase()))) return false;
    return true;
  }));

  const bookedLeads = sortLeadsByPlot(leads.filter(l => ['Reserved', 'Contracted', 'DownPayment', 'DocumentPrep', 'LoanProcessing', 'Approved'].includes(l.status)));
  const transferredLeads = sortLeadsByPlot(leads.filter(l => ['Transferred', 'Handover'].includes(l.status)));

  // Count today's scheduled visits
  const todayVisitsCount = React.useMemo(() => {
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    return rawLeads.filter(l => {
      if (!l.appointment_date) return false;
      const isLost = l.crm_status?.includes('Lost') || l.status === 'Cancelled';
      if (isLost || l.actual_visit_date) return false;
      const d = new Date(l.appointment_date);
      if (isNaN(d.getTime())) return false;
      const dStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      return dStr === todayStr;
    }).length;
  }, [rawLeads]);

  const handleUpdateTransferDate = async (leadId: string, newDate: string) => {
    // Optimistic UI update
    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, expectedTransferDate: newDate } : l));
    
    // Save to database
    const targetLead = leads.find(l => l.id === leadId);
    const saleId = targetLead?.saleId || leadId;
    const plotId = targetLead?.plot;

    try {
      if (saleId) {
        await supabase
          .from('sales')
          .update({ expected_transfer_date: newDate || null })
          .eq('id', saleId);
      }
      if (leadId && leadId !== saleId) {
        await supabase
          .from('sales')
          .update({ expected_transfer_date: newDate || null })
          .eq('lead_id', leadId);
      }
      if (plotId) {
        await supabase
          .from('plots')
          .update({ expected_transfer_date: newDate || null })
          .eq('id', plotId);
      }
    } catch (err) {
      console.error("Failed to update transfer date", err);
      fetchData(); // Revert on error
    }
  };

  // Excel Import Handlers
  const handleDownloadTemplate = () => {
    const projectNames = projects?.map((p: any) => p.name) || [];
    downloadLeadTrackerTemplate(
      projectNames.length > 0 ? projectNames : ['ไอลิน 3', 'ไอลิน 4', 'ไอลิน 6', 'ไอลิน สันทราย 2'],
      user?.username || 'Jane'
    );
  };

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
          alert("ไม่พบข้อมูลในไฟล์ กรุณาตรวจสอบการกรอกข้อมูล");
          return;
        }

        const { data: allPlotsData } = await supabase.from('plots').select('id, plot_name, project_name');
        const defaultProj = internalProject?.name || project?.name || 'ไอลิน 6';
        const defaultAg = user?.username || 'ส่วนกลาง';

        const parsedRows: ParsedLeadRow[] = [];
        for (let i = 0; i < rawRows.length; i++) {
          const rowObj = rawRows[i] as Record<string, any>;
          const parsed = parseExcelRowToLead(rowObj, i + 2, defaultProj, defaultAg);
          if (parsed) {
            if (parsed.interested_plot_name && allPlotsData) {
              const normalizedPlotStr = parsed.interested_plot_name.replace(/\s+/g, '').toLowerCase();
              const projPrefix = parsed.project_name.replace(/\s+/g, '').toLowerCase();
              const matched = allPlotsData.find(p => {
                const pName = (p.plot_name || '').replace(/\s+/g, '').toLowerCase();
                const pProj = (p.project_name || '').toLowerCase();
                if (pProj !== parsed.project_name.toLowerCase()) return false;
                return pName === normalizedPlotStr || 
                       `${projPrefix}-${pName}` === normalizedPlotStr || 
                       `${projPrefix}${pName}` === normalizedPlotStr ||
                       pName === normalizedPlotStr.replace(new RegExp(`^${projPrefix}-?`), '');
              });
              if (matched) {
                parsed.matched_plot_id = matched.id;
              }
            }
            parsedRows.push(parsed);
          }
        }

        if (parsedRows.length === 0) {
          alert("ไม่พบแถวข้อมูลลูกค้าที่ถูกต้องในไฟล์ (ต้องมีข้อมูลชื่อลูกค้า)");
          return;
        }

        setImportData(parsedRows);
      } catch (err) {
        console.error("Error parsing Excel:", err);
        alert("ไฟล์ไม่ถูกต้องหรือไม่สามารถอ่านได้ครับ");
      }
    };
    reader.readAsBinaryString(file);
  };

  const handleExportData = async () => {
    const XLSX = await import('xlsx');
    const exportRows = leads.map(l => {
      const transferDate = l.history.find((h: any) => h.status === 'Transferred')?.timestamp?.split('T')[0] || '';
      const cancelDate = l.history.find((h: any) => h.status === 'Cancelled')?.timestamp?.split('T')[0] || '';
      const plotName = l.plot ? projectPlotsData.find(p => p.id === l.plot)?.plot_name || l.plot : '';
      return {
        'Project Name': project?.name || '',
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
      'Project Name': project?.name || '', 'Customer Name': '', 'Phone': '', 'Occupation': '', 'Interest': '', 'Status': '', 'Plot': '', 'Sale Price': '', 'Land Price': '', 'Sales Agent': '', 'Visit Date': '', 'Booking Date': '', 'Transfer Date': '', 'Cancel Date': ''
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
    try {
      let updatedCount = 0;
      let insertedCount = 0;

      // Fetch all leads to match across all projects
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
          // UPDATE EXISTING LEAD
          await supabase.from('leads').update(leadPayload).eq('id', existingLead.id);
          currentLeadId = existingLead.id;

          if (row.legacy_status !== existingLead.status) {
            await supabase.from('status_history').insert([{
              entity_type: 'lead',
              entity_id: existingLead.id,
              old_status: existingLead.status,
              new_status: row.legacy_status,
              changed_by: (user?.username || 'Unknown') + ' (System Import Update)',
              created_at: row.transferred_date || row.booking_date || new Date().toISOString()
            }]);
          }
          updatedCount++;
        } else {
          // INSERT NEW LEAD
          const { data: newLeadsData, error: newLeadsError } = await supabase.from('leads').insert([{
            ...leadPayload,
            created_at: row.lead_date || new Date().toISOString()
          }]).select();
          
          if (newLeadsError) {
            console.error("Insert Lead Error Detailed:", newLeadsError);
            continue;
          }

          if (newLeadsData && newLeadsData.length > 0) {
            currentLeadId = newLeadsData[0].id;
            await supabase.from('status_history').insert([{
              entity_type: 'lead',
              entity_id: currentLeadId,
              new_status: row.legacy_status,
              changed_by: (user?.username || 'Unknown') + ' (System Import)',
              created_at: row.transferred_date || row.booking_date || row.lead_date || new Date().toISOString()
            }]);
            insertedCount++;
          }
        }

        // Sync with sales table & plots
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

  const handleBack = () => {
    if (!project && internalProject) {
      setInternalProject(null);
    } else if (onBack) {
      onBack();
    }
  };

  if (!internalProject) {
    const validProjects = (projects || []).filter(p => p.name && p.name !== 'ลูกค้าทั่วไป');
    const availableProjectsCount = validProjects.filter(p => {
      const avail = projectAvailability[p.name];
      if (avail !== undefined) return avail.vacant > 0 && !p.is_closed;
      return !p.is_closed;
    }).length;

    const displayedProjects = validProjects.filter(p => {
      if (showOnlyAvailable) {
        if (p.is_closed) return false;
        const avail = projectAvailability[p.name];
        if (avail !== undefined) return avail.vacant > 0;
        return true;
      }
      return true;
    });

    return (
      <div className="h-screen overflow-y-auto bg-[#f5f5f7] p-4 sm:p-8 w-full custom-scrollbar">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div className="flex items-center gap-4">
            {onBack && (
              <button onClick={onBack} className="p-2.5 hover:bg-slate-200 rounded-2xl transition-colors bg-white shadow-sm border border-slate-200/60">
                <ArrowLeft size={22} className="text-slate-700" />
              </button>
            )}
            <div className="flex items-center gap-3">
              <div className="bg-[#d4af37] p-3 rounded-2xl shadow-lg shadow-[#d4af37]/30">
                <Building2 className="text-white" size={26} />
              </div>
              <div>
                <h2 className="text-2xl sm:text-3xl font-black italic text-slate-800 uppercase tracking-tight">Sales Kanban</h2>
                <p className="text-xs sm:text-sm font-bold text-slate-500">กรุณาเลือกโครงการที่ต้องการเข้าสู่ระบบฝ่ายขาย</p>
              </div>
            </div>
          </div>

          {/* Toggle filter: เฉพาะที่มีบ้านว่าง vs ทั้งหมด */}
          <div className="flex items-center gap-1.5 bg-white p-1.5 rounded-2xl border border-slate-200 shadow-sm self-start sm:self-auto">
            <button
              type="button"
              onClick={() => setShowOnlyAvailable(true)}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 ${
                showOnlyAvailable
                  ? 'bg-[#0f172a] text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              <span>🏡 เฉพาะที่มีบ้านว่าง</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                showOnlyAvailable ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-100 text-slate-600'
              }`}>
                {availableProjectsCount}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setShowOnlyAvailable(false)}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 ${
                !showOnlyAvailable
                  ? 'bg-[#0f172a] text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              <span>ทั้งหมด</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                !showOnlyAvailable ? 'bg-slate-700 text-slate-200' : 'bg-slate-100 text-slate-600'
              }`}>
                {validProjects.length}
              </span>
            </button>
          </div>
        </div>

        {displayedProjects.length === 0 ? (
          <div className="bg-white rounded-3xl p-12 text-center border border-slate-200/80 shadow-sm max-w-lg mx-auto mt-12">
            <div className="w-16 h-16 bg-amber-50 text-amber-500 rounded-full flex items-center justify-center mx-auto mb-4 border border-amber-200">
              <Home size={32} />
            </div>
            <h3 className="text-lg font-black text-slate-800 mb-2">ไม่พบโครงการที่มีบ้านว่างในขณะนี้</h3>
            <p className="text-xs text-slate-500 mb-6">โครงการทั้งหมดอาจถูกจองหรือปิดการขายแล้ว คุณสามารถกดดูโครงการทั้งหมดได้</p>
            <button
              type="button"
              onClick={() => setShowOnlyAvailable(false)}
              className="px-5 py-2.5 bg-[#0f172a] text-white text-xs font-bold rounded-xl shadow hover:bg-slate-800 transition-colors"
            >
              ดูโครงการทั้งหมด
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {displayedProjects.map((p, index) => {
              const avail = projectAvailability[p.name];
              const isClosed = p.is_closed || (avail !== undefined && avail.vacant <= 0);

              return (
                <div 
                  key={p.id || p.name || index}
                  onClick={() => {
                    setInternalProject(p);
                    setActiveTab('daily_visits');
                  }}
                  className="bg-white rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-100 overflow-hidden cursor-pointer hover:shadow-[0_20px_50px_rgb(0,0,0,0.1)] hover:-translate-y-1.5 transition-all duration-300 group flex flex-col relative"
                >
                  <div className="h-44 bg-slate-100 relative overflow-hidden shrink-0">
                    {p.logo_url ? (
                      <img src={p.logo_url} alt={p.name} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700" />
                    ) : (
                      <div className="flex items-center justify-center h-full text-slate-300">
                        <Building2 size={64} className="opacity-30 group-hover:scale-110 transition-transform duration-700" />
                      </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-slate-900/90 via-slate-900/20 to-transparent" />
                    
                    {/* Badge: จำนวนบ้านว่าง */}
                    <div className="absolute top-3.5 right-3.5">
                      {avail ? (
                        avail.vacant > 0 ? (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black bg-emerald-500/90 text-white backdrop-blur-md shadow-md border border-emerald-300/30">
                            <Home size={12} />
                            ว่าง {avail.vacant} หลัง
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-800/80 text-slate-300 backdrop-blur-md border border-slate-700/50">
                            ขายหมดแล้ว
                          </span>
                        )
                      ) : p.is_closed ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-900/80 text-rose-200 backdrop-blur-md border border-rose-700/50">
                          ปิดโครงการ
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-800/60 text-slate-300 backdrop-blur-md">
                          กำลังเปิดขาย
                        </span>
                      )}
                    </div>

                    <h3 className="absolute bottom-4 left-5 text-white font-black text-2xl italic tracking-wide">{p.name}</h3>
                  </div>
                  <div className="p-5 flex-1 flex flex-col justify-between">
                    <div>
                      <p className="text-xs font-medium text-slate-500 line-clamp-2 mb-3">{p.description || 'โครงการคุณภาพพร้อมสิ่งอำนวยความสะดวกครบครัน'}</p>
                      {avail && (
                        <div className="flex items-center justify-between text-[11px] font-bold text-slate-600 bg-slate-50 px-3 py-2 rounded-xl border border-slate-100 mb-4">
                          <span>ทั้งหมด {avail.total} แปลง</span>
                          <span className={avail.vacant > 0 ? "text-emerald-600 font-black" : "text-slate-400"}>
                            {avail.vacant > 0 ? `เหลือขาย ${avail.vacant} หลัง` : 'ขายหมดแล้ว'}
                          </span>
                        </div>
                      )}
                    </div>
                    <button className="w-full py-3 bg-[#d4af37]/10 text-[#d4af37] rounded-xl font-black text-sm flex items-center justify-center gap-2 group-hover:bg-[#d4af37] group-hover:text-white transition-all">
                      เข้าสู่ระบบฝ่ายขาย <ArrowRight size={18} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="h-screen overflow-hidden bg-[#f8fafc] font-sans flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 md:px-8 py-4 md:py-5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 sm:gap-0 z-10 shrink-0">
        <div className="flex items-center gap-4">
          <button onClick={handleBack} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
            <ArrowLeft size={24} className="text-slate-600" />
          </button>
          <div>
            <h1 className="text-3xl font-bold text-[#0f172a] tracking-tight">Sales Management - {internalProject.name}</h1>
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
        </div>
      </header>

      {/* Navigation Tabs */}
      <div className="px-4 md:px-8 pt-4 md:pt-6 pb-2 border-b border-gray-200 bg-white flex flex-col lg:flex-row lg:items-center justify-between gap-4 lg:gap-0">
        <div className="flex gap-4 md:gap-8 overflow-x-auto w-full lg:w-auto pb-1 no-scrollbar shrink-0">
          <button 
            onClick={() => setActiveTab('daily_visits')}
            className={`pb-4 px-2 text-sm font-bold border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'daily_visits' ? 'border-rose-600 text-rose-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            <Calendar size={18} className={activeTab === 'daily_visits' ? 'text-rose-600' : ''} />
            <span>📅 ตารางนัดเข้าชม</span>
            {todayVisitsCount > 0 && (
              <span className="bg-rose-500 text-white text-[10px] font-black px-1.5 py-0.5 rounded-full animate-pulse shadow-sm">
                {todayVisitsCount}
              </span>
            )}
          </button>
          <button 
            onClick={() => setActiveTab('map')}
            className={`pb-4 px-2 text-sm font-bold border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'map' ? 'border-[#d4af37] text-[#0f172a]' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            <MapIcon size={18} className={activeTab === 'map' ? 'text-[#d4af37]' : ''} />
            Project Map
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
            onClick={() => setActiveTab('list')}
            className={`pb-4 px-2 text-sm font-bold border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'list' ? 'border-[#d4af37] text-[#0f172a]' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            <Users size={18} className={activeTab === 'list' ? 'text-[#d4af37]' : ''} />
            Customer Pipeline
          </button>
          <button 
            onClick={() => setActiveTab('pricing')}
            className={`pb-4 px-2 text-sm font-bold border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'pricing' ? 'border-[#d4af37] text-[#0f172a]' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            <Building2 size={18} className={activeTab === 'pricing' ? 'text-[#d4af37]' : ''} />
            ราคาบ้านและที่ดิน
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
            {/* DAILY VISITS SCHEDULE TAB */}
            {activeTab === 'daily_visits' && (
              <div className="h-full overflow-y-auto bg-slate-50">
                <DailyVisitsScheduleView
                  leads={rawLeads}
                  plots={projectPlotsData}
                  projects={projects}
                  selectedProjectName={project?.name}
                  user={user}
                  onRefresh={fetchData}
                  onSelectPlotForBooking={(plotId: string, lead: any) => {
                    setActiveTab('map');
                    handlePlotClick(plotId, 'Available', lead);
                  }}
                />
              </div>
            )}



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



            
          </div> {/* End Tab Content */}

          {/* Side Panel (Only visible in Project Map tab) */}
          {activeTab === 'map' && (
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
            
              {/* 🏡 Sample House Status & Setting Card */}
              {panelState.plotId && (() => {
                const currentTargetPlot = plotInfo || projectPlotsData.find(d => d.id === panelState.plotId);
                const isCurrentSample = isSampleHouse(currentTargetPlot);
                const eligibility = isPlotEligibleForSampleHouse(currentTargetPlot, panelState.lead, panelState.lead?.status);

                if (!isCurrentSample && !eligibility.eligible) {
                  return (
                    <div className="mb-4 rounded-2xl p-3.5 bg-slate-50 border border-slate-200/90 flex items-center justify-between gap-3 text-slate-500 text-xs shadow-sm">
                      <div className="flex items-center gap-2.5">
                        <span className="text-base opacity-70">🏡</span>
                        <div>
                          <div className="font-bold text-slate-700">แปลงนี้มีลูกค้าจอง / โอนแล้ว</div>
                          <div className="text-[11px] text-slate-500 mt-0.5">{eligibility.reason}</div>
                        </div>
                      </div>
                      <span className="text-[10px] font-bold px-2 py-1 rounded bg-slate-200 text-slate-600 shrink-0">
                        ไม่สามารถตั้งได้
                      </span>
                    </div>
                  );
                }

                return (
                  <div className={`mb-4 rounded-2xl p-4 border transition-all ${
                    isCurrentSample
                      ? 'bg-gradient-to-br from-amber-50 to-amber-100/60 border-amber-300 shadow-sm'
                      : 'bg-slate-50 border-slate-200'
                  }`}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <span className="text-xl">🏡</span>
                        <div>
                          <div className="text-xs font-black text-slate-800 flex items-center gap-1.5">
                            {isCurrentSample ? (
                              <span className="text-amber-900 flex items-center gap-1">
                                <span>บ้านตัวอย่างประจำโครงการ</span>
                                <span className="px-1.5 py-0.2 bg-amber-500 text-white rounded text-[9px] font-black">ACTIVE</span>
                              </span>
                            ) : (
                              <span className="text-slate-600">สถานะบ้านตัวอย่าง</span>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-500">
                            {isCurrentSample ? 'เปิดรับลูกค้าเข้าชม · มี SOP ตรวจเช็คประจำวัน' : 'กำหนดแปลงว่างนี้เป็นบ้านตัวอย่างสำหรับต้อนรับลูกค้า'}
                          </div>
                        </div>
                      </div>

                      {/* Toggle switch button */}
                      <button
                        type="button"
                        onClick={handleToggleSampleHouse}
                        disabled={isTogglingSampleHouse}
                        className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 cursor-pointer shadow-sm ${
                          isCurrentSample
                            ? 'bg-amber-600 hover:bg-amber-700 text-white shadow-amber-600/20'
                            : 'bg-white hover:bg-slate-100 text-slate-700 border border-slate-300'
                        }`}
                      >
                        {isTogglingSampleHouse ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : isCurrentSample ? (
                          '✓ เป็นบ้านตัวอย่าง'
                        ) : (
                          '+ ตั้งเป็นบ้านตัวอย่าง'
                        )}
                      </button>
                    </div>

                    {/* If Sample House: Show Inspection Status & Inspection Trigger Button */}
                    {isCurrentSample && (
                      <div className="mt-3 pt-3 border-t border-amber-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <div className={`px-2.5 py-1 rounded-lg text-xs font-black flex items-center gap-1.5 ${
                            sampleHouseInspection?.status === 'morning_checked'
                              ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                              : sampleHouseInspection?.status === 'evening_checked'
                              ? 'bg-indigo-100 text-indigo-800 border border-indigo-300'
                              : 'bg-rose-100 text-rose-800 border border-rose-300 animate-pulse'
                          }`}>
                            <span>{sampleHouseInspection?.status === 'morning_checked' ? '☀️' : sampleHouseInspection?.status === 'evening_checked' ? '🌙' : '⚠️'}</span>
                            <span>{sampleHouseInspection?.badgeLabel || '⚠️ รอตรวจเปิดบ้าน'}</span>
                          </div>
                          {sampleHouseInspection?.inspectorName && (
                            <span className="text-[10px] text-amber-900 font-medium">
                              โดย {sampleHouseInspection.inspectorName}
                            </span>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={() => setShowDailyInspectionModal(true)}
                          className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-black px-3 py-1.5 rounded-lg text-xs flex items-center justify-center gap-1.5 shadow-sm transition-colors cursor-pointer"
                        >
                          <span>📝</span> บันทึกตรวจเปิด/ปิดบ้าน
                        </button>
                      </div>
                    )}
                  </div>
                );
              })()}

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

                      {/* 🔑 Rental Information Card */}
                      {(plotInfo.sale_status === 'Rented' || plotInfo.rental_program || plotInfo.current_tenant_name) && (
                        <div className="col-span-2 p-3 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl space-y-2">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5 font-bold text-xs text-blue-900">
                              <Key size={14} className="text-blue-600" /> ข้อมูลการเช่า (Active Lease)
                            </div>
                            {plotInfo.rental_program && RENTAL_PROGRAM_DETAILS[plotInfo.rental_program as keyof typeof RENTAL_PROGRAM_DETAILS] && (
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${RENTAL_PROGRAM_DETAILS[plotInfo.rental_program as keyof typeof RENTAL_PROGRAM_DETAILS].badgeColor}`}>
                                {RENTAL_PROGRAM_DETAILS[plotInfo.rental_program as keyof typeof RENTAL_PROGRAM_DETAILS].name}
                              </span>
                            )}
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-700">
                            <div>ผู้เช่า: <b className="text-slate-900">{plotInfo.current_tenant_name || '-'}</b></div>
                            <div>ค่าเช่า: <b className="text-blue-700">{plotInfo.monthly_rent ? `${Number(plotInfo.monthly_rent).toLocaleString()} บ./ด.` : '-'}</b></div>
                            {plotInfo.lease_end_date && (
                              <div className="col-span-2 text-slate-500">
                                ระยะเวลา: {plotInfo.lease_start_date || '-'} ถึง <b className="text-slate-800">{plotInfo.lease_end_date}</b>
                              </div>
                            )}
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-1">
                            <button
                              type="button"
                              onClick={() => {
                                setShowRentalPaymentModal({
                                  isOpen: true,
                                  plot: plotInfo,
                                  lead: null
                                });
                              }}
                              className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-bold py-1.5 px-2 rounded-lg text-xs flex items-center justify-center gap-1.5 shadow-sm cursor-pointer transition-colors"
                            >
                              <CreditCard size={13} /> 💳 ติดตามการจ่ายค่าเช่า
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setShowRentalActionModal({
                                  isOpen: true,
                                  lead: null,
                                  plot: plotInfo
                                });
                              }}
                              className="w-full bg-gradient-to-r from-blue-700 to-indigo-700 hover:from-blue-800 hover:to-indigo-800 text-white font-bold py-1.5 px-2 rounded-lg text-xs flex items-center justify-center gap-1.5 shadow-sm cursor-pointer transition-colors"
                            >
                              <Key size={13} /> 🔑 จัดการสัญญา
                            </button>
                          </div>
                        </div>
                      )}
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
                <div className="flex flex-col h-full animate-in fade-in duration-300 space-y-5">
                  <div className="flex justify-between items-center pb-3 border-b border-slate-100">
                    <h3 className="font-bold text-lg text-slate-800 flex items-center gap-2">
                      <Home className="text-emerald-600" /> แปลง {projectPlotsData.find(d => d.id === panelState.plotId)?.plot_name || panelState.plotId}
                    </h3>
                    <button onClick={() => setPanelState({ type: 'default', plotId: '', lead: null })} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                      <X size={18} />
                    </button>
                  </div>

                  {/* Status Banner */}
                  <div className="bg-emerald-50 border border-emerald-200/80 rounded-2xl p-3.5 text-emerald-900">
                    <div className="flex items-center gap-2 font-black text-xs text-emerald-800">
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
                      🟢 สถานะ: แปลงว่าง (พร้อมขาย / ให้เช่า)
                    </div>
                    <p className="text-[11px] text-emerald-700/80 mt-1">
                      แปลงนี้ยังไม่มีการวางเงินจอง สามารถเลือกลูกค้าจาก Lead CRM หรือสร้าง Walk-in เพื่อทำรายการจองหรือเช่าได้ทันที
                    </p>
                  </div>

                  {/* 🔍 Searchable Lead Dropdown & Action Buttons */}
                  <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-3">
                    <LeadPicker
                      selectedLead={selectedPlotLead}
                      onSelectLead={(lead) => setSelectedPlotLead(lead)}
                      projectName={project?.name}
                      currentPlotName={projectPlotsData.find(d => d.id === panelState.plotId)?.plot_name || panelState.plotId}
                      label="เลือกลูกค้าสำหรับแปลงนี้ (Lead CRM)"
                      placeholder="🔍 คลิกเพื่อค้นหา หรือ เลือกลูกค้า..."
                    />

                    {/* Action Buttons: จอง vs เช่า */}
                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          setShowBookingModal({
                            isOpen: true,
                            lead: selectedPlotLead,
                            plotId: panelState.plotId
                          });
                        }}
                        className="w-full bg-gradient-to-r from-orange-500 to-amber-600 hover:from-orange-600 hover:to-amber-700 text-white font-bold py-2.5 px-3 rounded-xl text-xs flex items-center justify-center gap-1.5 shadow-sm shadow-orange-500/20 cursor-pointer transition-all"
                      >
                        <span>⚡ บันทึกการจอง</span>
                        {selectedPlotLead && <span className="truncate max-w-[70px]">({selectedPlotLead.customer_name})</span>}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowRentalModal({
                            isOpen: true,
                            lead: selectedPlotLead,
                            plotId: panelState.plotId
                          });
                        }}
                        className="w-full bg-gradient-to-r from-blue-700 to-indigo-700 hover:from-blue-800 hover:to-indigo-800 text-white font-bold py-2.5 px-3 rounded-xl text-xs flex items-center justify-center gap-1.5 shadow-sm shadow-blue-700/20 cursor-pointer transition-all"
                      >
                        <Key size={13} />
                        <span>🔑 ทำสัญญาเช่า</span>
                        {selectedPlotLead && <span className="truncate max-w-[70px]">({selectedPlotLead.customer_name})</span>}
                      </button>
                    </div>
                  </div>

                  {/* Interested Leads in this plot */}
                  {(() => {
                    const plotName = projectPlotsData.find(d => d.id === panelState.plotId)?.plot_name || panelState.plotId;
                    const interestedLeads = rawLeads.filter(l => 
                      (l.interested_plot_name === plotName || l.interested_plot_id === panelState.plotId) &&
                      !l.crm_status?.includes('Booked') && !l.crm_status?.includes('Transferred') && !l.crm_status?.includes('Lost')
                    );

                    return (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <h4 className="font-bold text-xs text-slate-700 flex items-center gap-1.5">
                            <Users size={14} className="text-blue-600" /> Lead ที่ระบุว่าสนใจแปลงนี้ ({plotName})
                          </h4>
                          <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-100">
                            {interestedLeads.length} ราย
                          </span>
                        </div>

                        {interestedLeads.length > 0 ? (
                          <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                            {interestedLeads.map(lead => (
                              <div key={lead.id} className="p-3 bg-slate-50 border border-slate-200/80 rounded-xl flex items-center justify-between gap-2">
                                <div>
                                  <div className="font-bold text-slate-800 text-xs">{lead.customer_name}</div>
                                  <div className="text-[11px] text-slate-500 flex items-center gap-2 mt-0.5">
                                    <span>📞 {lead.phone || '-'}</span>
                                    <span className="bg-slate-200 px-1.5 py-0.2 rounded text-[10px]">{lead.channel || lead.source || 'Walk in'}</span>
                                  </div>
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setShowBookingModal({
                                        isOpen: true,
                                        lead: lead,
                                        plotId: panelState.plotId
                                      });
                                    }}
                                    className="bg-orange-600 hover:bg-orange-700 text-white font-bold text-[11px] px-2.5 py-1.5 rounded-lg shadow-sm flex items-center gap-1 cursor-pointer transition-colors"
                                  >
                                    ⚡ จอง
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setShowRentalModal({
                                        isOpen: true,
                                        lead: lead,
                                        plotId: panelState.plotId
                                      });
                                    }}
                                    className="bg-gradient-to-r from-blue-700 to-indigo-700 hover:from-blue-800 hover:to-indigo-800 text-white font-bold text-[11px] px-2.5 py-1.5 rounded-lg shadow-sm flex items-center gap-1 cursor-pointer transition-colors"
                                  >
                                    <Key size={11} /> 🔑 เช่า
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-center py-3 bg-slate-50 rounded-xl border border-slate-100 text-xs text-slate-400">
                            ยังไม่มี Lead ที่ระบุว่าสนใจแปลงนี้โดยเฉพาะ
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* Actions */}
                  <div className="space-y-2 pt-2 border-t border-slate-100">
                    <button
                      type="button"
                      onClick={() => {
                        setActiveTab('list');
                      }}
                      className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl text-xs flex items-center justify-center gap-2 shadow-md shadow-blue-600/10 cursor-pointer transition-colors"
                    >
                      <Users size={16} /> ไปที่ Customer Pipeline เพื่อดูลูกค้าทั้งหมด
                    </button>
                    <button
                      type="button"
                      onClick={() => setPanelState({ type: 'default', plotId: '', lead: null })}
                      className="w-full bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold py-2.5 rounded-xl text-xs cursor-pointer transition-colors"
                    >
                      ปิดหน้าต่าง
                    </button>
                  </div>
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
                      <button type="submit" disabled={isSubmitting} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                        {isSubmitting ? <><Loader2 className="animate-spin" size={18} /> กำลังบันทึก...</> : 'บันทึกการเยี่ยมชม (Visit)'}
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
                      <label className={`block text-xs font-semibold mb-1 ${['Transferred', 'Handover'].includes(editCustomerForm.status) ? 'text-blue-700 bg-blue-50 px-2 py-1 rounded-md inline-block border border-blue-200 shadow-sm' : 'text-slate-700'}`}>
                        {['Transferred', 'Handover'].includes(editCustomerForm.status) ? '🗓️ วันที่โอนกรรมสิทธิ์ (ระบุย้อนหลังได้)' : 'วันที่ทำรายการ / วันที่อัปเดตสถานะ'}
                      </label>
                      <input 
                        type="date" 
                        value={editCustomerForm.transactionDate} 
                        onChange={e => setEditCustomerForm({...editCustomerForm, transactionDate: e.target.value})}
                        className={`w-full border rounded-xl px-4 py-2 focus:outline-none focus:border-[#d4af37] text-sm text-gray-700 ${['Transferred', 'Handover'].includes(editCustomerForm.status) ? 'border-blue-300 bg-blue-50/30' : 'border-slate-200'}`} 
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

                      {['DocumentPrep', 'LoanProcessing', 'Approved', 'Transferred'].includes(editCustomerForm.status) && (
                        <div className="mb-3 animate-in slide-in-from-top-2 duration-200">
                          <label className="block text-xs font-semibold text-slate-700 mb-1">หมายเหตุเพิ่มเติม (ถ้ามี)</label>
                          <textarea 
                            className="w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:outline-none focus:border-slate-500 text-slate-700 bg-white text-sm min-h-[60px]"
                            value={editCustomerForm.note || ''}
                            onChange={e => setEditCustomerForm({...editCustomerForm, note: e.target.value})}
                            placeholder="ระบุหมายเหตุเพิ่มเติม (ไม่บังคับ)"
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
                      <button type="submit" disabled={isSubmitting} className={`w-full text-white font-bold py-3 rounded-xl transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 ${editCustomerForm.status === 'Cancelled' ? 'bg-red-600 hover:bg-red-700' : 'bg-[#0f172a] hover:bg-[#1e293b]'}`}>
                        {isSubmitting ? <><Loader2 className="animate-spin" size={18} /> กำลังบันทึก...</> : 'บันทึกการเปลี่ยนแปลง'}
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
        )}
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
                <div className="border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                  <div className="bg-gray-50 px-4 py-3 border-b border-gray-200 flex justify-between items-center">
                    <span className="font-semibold text-gray-700 text-xs flex items-center gap-1.5">
                      <CheckCircle size={15} className="text-emerald-600" />
                      Preview ข้อมูล ({importData.length} รายการ)
                    </span>
                    <span className="text-[11px] text-gray-500 bg-white px-2.5 py-0.5 rounded-full border border-gray-200 font-semibold">
                      พร้อมนำเข้า
                    </span>
                  </div>
                  <div className="overflow-x-auto max-h-[300px]">
                    <table className="w-full text-left text-xs whitespace-nowrap">
                      <thead className="bg-white sticky top-0 shadow-sm z-10 text-gray-600 font-bold border-b border-gray-100">
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
                      <tbody className="divide-y divide-gray-100 bg-white">
                        {importData.slice(0, 100).map((row, idx) => (
                          <tr key={idx} className="hover:bg-gray-50">
                            <td className="px-3 py-2 font-mono text-gray-400">{idx + 1}</td>
                            <td className="px-3 py-2">{row.lead_date ? new Date(row.lead_date).toLocaleDateString('th-TH') : '-'}</td>
                            <td className="px-3 py-2 font-bold text-gray-700">{row.project_name}</td>
                            <td className="px-3 py-2 font-bold text-blue-900">{row.customer_name}</td>
                            <td className="px-3 py-2 font-mono text-gray-600">{row.phone || '-'}</td>
                            <td className="px-3 py-2">
                              <span className="bg-gray-100 text-gray-700 px-2 py-0.5 rounded text-[10px] font-semibold">
                                {row.channel}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-gray-600">{row.agent_name}</td>
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
                            <td className="px-3 py-2 text-gray-500 max-w-[150px] truncate text-[11px]">{row.notes || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {importData.length > 100 && (
                    <div className="p-2 text-center text-xs text-gray-500 bg-gray-50 border-t border-gray-200">
                      แสดงตัวอย่างสูงสุด 100 รายการแรกเท่านั้น (ระบบจะนำเข้าทั้งหมด {importData.length} รายการ)
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

      {/* Daily House Inspection SOP Modal */}
      {showDailyInspectionModal && (
        <DailyHouseInspectionModal
          isOpen={showDailyInspectionModal}
          onClose={() => setShowDailyInspectionModal(false)}
          projectName={project?.name || 'ไอลิน6'}
          user={user}
          sampleHouses={projectPlotsData.filter(p => isSampleHouse(p)).map(p => p.plot_name || p.id)}
          initialLocation={plotInfo?.plot_name ? `บ้านตัวอย่าง แปลง ${plotInfo.plot_name}` : undefined}
          onSaved={async () => {
            await fetchData();
            if (panelState.plotId) {
              const insp = await fetchTodayInspectionStatus(project?.name || 'ไอลิน6', plotInfo?.plot_name || panelState.plotId);
              setSampleHouseInspection(insp);
            }
          }}
        />
      )}

      {/* 🏷️ Central Lead Booking Modal */}
      {showBookingModal.isOpen && (
        <CentralLeadBookingModal
          isOpen={showBookingModal.isOpen}
          onClose={() => setShowBookingModal({ isOpen: false, lead: null })}
          customer={showBookingModal.lead ? {
            id: showBookingModal.lead.id,
            name: showBookingModal.lead.customer_name || showBookingModal.lead.name,
            phone: showBookingModal.lead.phone,
            channel: showBookingModal.lead.channel,
            salesOwner: showBookingModal.lead.sales_owner || showBookingModal.lead.agent_name,
            notes: showBookingModal.lead.notes
          } : null}
          initialInterest={{
            projectName: project?.name,
            plotId: showBookingModal.plotId || panelState.plotId
          }}
          projects={projects?.map(p => p.name) || [project?.name || 'ไอลิน6']}
          salesOwners={[]}
          onSaved={async () => {
            await fetchData();
            setPanelState({ type: 'default', plotId: '', lead: null });
          }}
          onSwitchToRental={() => {
            setShowRentalModal({
              isOpen: true,
              lead: showBookingModal.lead,
              plotId: showBookingModal.plotId || panelState.plotId
            });
          }}
        />
      )}

      {/* 🔑 Rental Contract Modal (Programs A, B, C) */}
      {showRentalModal.isOpen && (
        <RentalContractModal
          isOpen={showRentalModal.isOpen}
          onClose={() => setShowRentalModal({ isOpen: false, lead: null })}
          lead={showRentalModal.lead}
          plotId={showRentalModal.plotId}
          projectName={project?.name || 'ไอลิน สันทราย 2'}
          user={user}
          onSaved={fetchData}
        />
      )}

      {/* 🔑 Rental Action Modal (Convert to Buy / Renew / Move Out) */}
      {showRentalActionModal.isOpen && (
        <RentalActionModal
          isOpen={showRentalActionModal.isOpen}
          onClose={() => setShowRentalActionModal({ isOpen: false, lead: null, plot: null })}
          lead={showRentalActionModal.lead}
          plot={showRentalActionModal.plot}
          user={user}
          onSaved={fetchData}
        />
      )}

      {/* 💳 Rental Payment Ledger Modal */}
      {showRentalPaymentModal.isOpen && (
        <RentalPaymentLedgerModal
          isOpen={showRentalPaymentModal.isOpen}
          onClose={() => setShowRentalPaymentModal({ isOpen: false, plot: null, lead: null })}
          plot={showRentalPaymentModal.plot}
          plotId={showRentalPaymentModal.plot?.id}
          lead={showRentalPaymentModal.lead}
          projectName={project?.name || 'ไอลิน สันทราย 2'}
          user={user}
          onSaved={fetchData}
        />
      )}

    </div>
  );
}
