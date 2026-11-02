"use client";
import { customerActualTransferDay, customerBusinessDay, customerExpectedTransferDay } from '@/lib/sales/customerBusinessDate';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search, Plus, Map as MapIcon, Users, ListFilter, Download, ChevronRight, Home, Phone, Calendar, ArrowRight, ArrowLeft, LogOut, UserCheck, User, Key, X, FileText, Clock, CheckCircle, XCircle, Banknote, Building2, FileSignature, Pickaxe, Loader2, TrendingUp, Upload, Trash2, PieChart, Lightbulb, Sun, Moon, AlertTriangle, Sparkles, CreditCard, BookmarkCheck } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import SalesMap from './SalesMap';
import SalesPricing from './SalesPricing';
import DailyVisitsScheduleView from './DailyVisitsScheduleView';
import DailyHouseInspectionModal from './DailyHouseInspectionModal';
import RentalContractModal from './RentalContractModal';
import RentalActionModal from './RentalActionModal';
import RentalPaymentLedgerModal from './RentalPaymentLedgerModal';
import CentralLeadBookingModal from './CentralLeadBookingModal';
import SalesDealStatusModal, { type SalesDealEditorModel } from './SalesDealStatusModal';
import { SALES_BANK_LOGOS as BANK_LOGOS } from '@/lib/sales/banks';
import { salesDealStageOf, salesDealStages } from '@/lib/sales/dealStatus';
import { customerDealDetails, extractAgreedPrices, extractExpectedTransferDate, updateExpectedTransferDateInNotes } from '@/lib/sales/customerDealDetails';
import { crmSaleCustomer, SALES_WITH_CUSTOMER_SELECT } from '@/lib/sales/saleCustomer';
import LeadPicker from './LeadPicker';
import { RENTAL_PROGRAM_DETAILS } from '@/types/sales';
import { deleteCustomerWithCascade } from '@/lib/customerDeletionHelper';
import { parseExcelRowToLead, downloadLeadTrackerTemplate, ParsedLeadRow } from '@/lib/salesImportHelper';
import { isSampleHouse, isPlotEligibleForSampleHouse, toggleSampleHouse, fetchTodayInspectionStatus, SampleHouseInspectionStatus } from '@/lib/sales/sampleHouseHelper';
import { fetchSalesWithoutLimit } from '@/lib/sales/fetchWithoutLimit';
import { useSalesStaffOptions } from '@/hooks/useSalesStaffOptions';
import SalesOverlay from './SalesOverlay';
import { canStartSalesDeal, getLeadStage } from '@/lib/sales/leadStage';
import { loadSalesStatusHistory, mergeSalesTimeline, type SalesStatusHistoryRow } from '@/lib/sales/salesStatusHistory';
import { subscribeToSalesSync } from '@/lib/sales/salesSyncBroadcast';

async function checkedResult<T extends { error?: { message?: string } | null }>(query: PromiseLike<T>): Promise<T> {
  const result = await query;
  if (result.error) throw new Error(result.error.message || 'บันทึกข้อมูลไม่สำเร็จ');
  return result;
}

const canCreateBooking = (lead: any) => !lead || canStartSalesDeal(lead);

const initialLeads: any[] = [];

export const STATUS_CONFIG: Record<string, { label: string, color: string, bg: string, icon: any }> = {
  'Lost': { label: 'ไม่สนใจ / Lost', color: 'text-slate-600', bg: 'bg-slate-100', icon: XCircle },
  'legacy_unclassified': { label: 'ข้อมูลเดิม / ยังไม่ระบุขั้นตอน', color: 'text-slate-600', bg: 'bg-slate-100', icon: Users },
  'Visit': { label: 'เยี่ยมชมโครงการ', color: 'text-blue-700', bg: 'bg-blue-50', icon: Users },
  'Negotiation': { label: 'กำลังเจรจา', color: 'text-orange-700', bg: 'bg-orange-50', icon: Search },
  'Reserved': { label: 'จองแล้ว', color: 'text-emerald-700', bg: 'bg-emerald-50', icon: Home },
  'DownPayment': { label: 'ผ่อนดาวน์/สัญญา', color: 'text-yellow-700', bg: 'bg-yellow-50', icon: Banknote },
  'DocumentPrep': { label: 'รอยื่นเอกสาร', color: 'text-cyan-700', bg: 'bg-cyan-50', icon: FileText },
  'LoanProcessing': { label: 'รอผลสินเชื่อ', color: 'text-indigo-700', bg: 'bg-indigo-50', icon: Clock },
  'Approved': { label: 'อนุมัติแล้ว', color: 'text-blue-700', bg: 'bg-blue-50', icon: CheckCircle },
  'Contracted': { label: 'ทำสัญญา', color: 'text-pink-700', bg: 'bg-pink-50', icon: FileSignature },
  'TransferPending': { label: 'รอโอน', color: 'text-emerald-700', bg: 'bg-emerald-50', icon: Clock },
  'LoanRejected': { label: 'สินเชื่อไม่ผ่าน รอยื่นใหม่', color: 'text-orange-700', bg: 'bg-orange-50', icon: AlertTriangle },
  'Transferred': { label: 'โอนกรรมสิทธิ์', color: 'text-violet-700', bg: 'bg-violet-50', icon: UserCheck },
  'Handover': { label: 'รับมอบบ้าน', color: 'text-sky-700', bg: 'bg-sky-50', icon: Key },
  'Cancelled': { label: 'ยกเลิกจอง', color: 'text-red-700', bg: 'bg-red-50', icon: XCircle },
  // Status aliases for robustness
  'Booked': { label: 'จองแล้ว', color: 'text-emerald-700', bg: 'bg-emerald-50', icon: Home },
  'Follow Up': { label: 'กำลังติดตาม', color: 'text-blue-700', bg: 'bg-blue-50', icon: Users },
  'Follow-up': { label: 'กำลังติดตาม', color: 'text-blue-700', bg: 'bg-blue-50', icon: Users },
  'Active': { label: 'กำลังติดตาม / สนใจ', color: 'text-blue-700', bg: 'bg-blue-50', icon: Users },
  'New': { label: 'ลูกค้าใหม่', color: 'text-blue-700', bg: 'bg-blue-50', icon: Users },
  'Rented': { label: 'สัญญาเช่า', color: 'text-teal-700', bg: 'bg-teal-50', icon: Key },
  'Rent': { label: 'สัญญาเช่า', color: 'text-teal-700', bg: 'bg-teal-50', icon: Key }
};

const getNextStatuses = (current?: string | null) => {
  const raw = String(current || '').trim();
  const normalized = stageToKanbanStatus(raw) || raw;
  let statuses: string[];
  switch (normalized) {
    case 'Visit': statuses = ['Visit', 'Negotiation', 'Reserved', 'Cancelled']; break;
    case 'Negotiation': statuses = ['Negotiation', 'Reserved', 'Cancelled']; break;
    case 'Reserved': statuses = ['Reserved', 'Contracted', 'Cancelled']; break;
    case 'Contracted': statuses = ['Contracted', 'DownPayment', 'DocumentPrep', 'TransferPending', 'Transferred', 'Cancelled']; break;
    case 'DownPayment': statuses = ['DownPayment', 'DocumentPrep', 'TransferPending', 'Transferred', 'Cancelled']; break;
    case 'DocumentPrep': statuses = ['DocumentPrep', 'LoanProcessing', 'TransferPending', 'Cancelled']; break;
    case 'LoanProcessing': statuses = ['LoanProcessing', 'Approved', 'LoanRejected', 'DocumentPrep', 'Cancelled']; break;
    case 'LoanRejected': statuses = ['LoanRejected', 'DocumentPrep', 'Cancelled']; break;
    case 'Approved': statuses = ['Approved', 'TransferPending', 'Transferred', 'Cancelled']; break;
    case 'TransferPending': statuses = ['TransferPending', 'Transferred', 'Cancelled']; break;
    case 'Transferred': statuses = ['Transferred', 'Handover', 'Cancelled']; break;
    case 'Handover': statuses = ['Handover']; break;
    case 'Cancelled': statuses = ['Cancelled', 'Visit', 'Reserved']; break;
    case 'Lost': statuses = ['Lost', 'Visit', 'Reserved']; break;
    default:
      statuses = STATUS_CONFIG[normalized] ? [normalized, 'Reserved', 'Cancelled'] : ['Visit', 'Negotiation', 'Reserved', 'Cancelled'];
      break;
  }
  return statuses.filter(s => Boolean(STATUS_CONFIG[s]));
};

const formatPhoneNumber = (value: string | null | undefined) => {
  let val = (value ?? '').replace(/\D/g, '');
  if (val.length > 10) val = val.slice(0, 10);
  if (val.length > 6) return `${val.slice(0,3)}-${val.slice(3,6)}-${val.slice(6)}`;
  if (val.length > 3) return `${val.slice(0,3)}-${val.slice(3)}`;
  return val;
};

export const normalizePlotKey = (name?: string | null): string => {
  if (!name) return '';
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/^(al\d+|yr|k\d+พิเศษ|k\d+|ไอลิน\s*\d+|โยริว|กานต์รวี\s*\d+)[-_/\s]*/i, '')
    .replace(/^0+/, '')
    .trim();
};

export const stageToKanbanStatus = (stage: string): string => {
  switch (stage?.toLowerCase()) {
    case 'visit': return 'Visit';
    case 'negotiation': return 'Negotiation';
    case 'booked': return 'Reserved';
    case 'contracted': return 'Contracted';
    case 'downpayment': return 'DownPayment';
    case 'document_prep': return 'DocumentPrep';
    case 'loan_submitted':
    case 'loan_processing': return 'LoanProcessing';
    case 'loan_approved': return 'Approved';
    case 'transfer_pending': return 'TransferPending';
    case 'transferred': return 'Transferred';
    case 'handover': return 'Handover';
    case 'loan_rejected': return 'LoanRejected';
    case 'cancelled': return 'Cancelled';
    case 'lost': return 'Lost';
    default: return 'Reserved';
  }
};

export const kanbanStatusToStage = (status: string): string => {
  switch (status) {
    case 'Visit': return 'visit';
    case 'Negotiation': return 'negotiation';
    case 'Reserved': return 'booked';
    case 'Contracted': return 'contracted';
    case 'DownPayment': return 'downpayment';
    case 'DocumentPrep': return 'document_prep';
    case 'LoanProcessing': return 'loan_submitted';
    case 'Approved': return 'loan_approved';
    case 'TransferPending': return 'transfer_pending';
    case 'LoanRejected': return 'loan_rejected';
    case 'Transferred': return 'transferred';
    case 'Handover': return 'handover';
    case 'Cancelled': return 'cancelled';
    case 'Lost': return 'lost';
    default: return 'booked';
  }
};

export function parseStageFromNoteText(text?: string | null): string | null {
  if (!text) return null;
  const t = text.toLowerCase();
  if (t.includes('รอโอน') || t.includes('transfer pending') || t.includes('transfer_pending')) return 'TransferPending';
  if (t.includes('โอน') || t.includes('transfer')) return 'Transferred';
  if (t.includes('อนุมัติ') || t.includes('approved')) return 'Approved';
  if (t.includes('สินเชื่อ') || t.includes('loan') || t.includes('กู้') || t.includes('pre-approve') || t.includes('pre-approval')) return 'LoanProcessing';
  if (t.includes('เตรียมเอกสาร') || t.includes('document') || t.includes('รอยื่น')) return 'DocumentPrep';
  if (t.includes('สัญญา') || t.includes('contract')) return 'Contracted';
  if (t.includes('ดาวน์') || t.includes('downpayment')) return 'DownPayment';
  if (t.includes('ยกเลิก') || t.includes('cancel')) return 'Cancelled';
  if (t.includes('จอง') || t.includes('book') || t.includes('reserved')) return 'Reserved';
  return null;
}

export function extractMilestonesFromLeadNotes(notes?: string | null, defaultAgent: string = ''): Array<{ status: string; timestamp: string; note: string }> {
  if (!notes || typeof notes !== 'string') return [];
  const regex = /\[([0-9]{4}-[0-9]{2}-[0-9]{2}(?:T[^\s\]]+)?)[^\]]*โดย\s+([^\]]+)\]\s*([^\r\n]+)/g;
  const milestones: Array<{ status: string; timestamp: string; note: string }> = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(notes)) !== null) {
    const timestamp = match[1];
    const agent = match[2]?.trim() || defaultAgent;
    const rawStage = match[3]?.trim() || '';
    const mapped = parseStageFromNoteText(rawStage);
    if (mapped) {
      milestones.push({ status: mapped, timestamp, note: agent });
    }
  }
  return milestones;
}

export default function SalesKanban({ 
  project: externalProject, 
  projects, 
  plots: externalPlots,
  user, 
  initialTab = 'daily_visits',
  onBack,
  onSelectPlot
}: { 
  project?: any, 
  projects?: any[], 
  plots?: any[],
  user?: any, 
  initialTab?: string,
  /** Old imported-cohort callers may still pass this; native workflows always use their original source. */
  canonicalData?: boolean,
  onBack?: () => void,
  onSelectPlot?: (plot: any) => void
}) {
  const [internalProject, setInternalProject] = useState<any>(externalProject || null);

  useEffect(() => {
    if (externalProject) setInternalProject(externalProject);
  }, [externalProject]);

  const project = internalProject;
  const dataRequest = React.useRef(0);
  const currentDataScope = React.useRef('');
  currentDataScope.current = `${user?.id ?? user?.username ?? ''}:${internalProject?.name ?? ''}`;

  const [leads, setLeads] = useState(initialLeads);
  const pendingForecasts = React.useRef(new Set<string>());
  const [savingForecasts, setSavingForecasts] = useState<string[]>([]);
  const forecastScope = React.useRef('');
  forecastScope.current = `${user?.id ?? user?.username ?? ''}:${internalProject?.name ?? ''}`;
  const [rawLeads, setRawLeads] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'daily_visits' | 'map' | 'booked' | 'rented' | 'transferred' | 'list' | 'pricing'>((initialTab as any) || 'daily_visits');
  const [search, setSearch] = useState('');
  
  const [panelState, setPanelState] = useState<{type: 'default' | 'booking' | 'customer' | 'new-customer', plotId: string, lead: any}>({ type: 'default', plotId: '', lead: null });
  const panelStateRef = React.useRef(panelState);
  useEffect(() => {
    panelStateRef.current = panelState;
  }, [panelState]);
  const [plotInfoRefreshTrigger, setPlotInfoRefreshTrigger] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusHistory, setStatusHistory] = useState<{ scope: string; rows: SalesStatusHistoryRow[]; loading: boolean; error: string }>({ scope: '', rows: [], loading: false, error: '' });
  const [historyRetry, setHistoryRetry] = useState(0);
  const historyLeadId: string | null = panelState.type === 'customer' ? panelState.lead?.leadId || (panelState.lead?.sourceKind === 'lead' ? panelState.lead.id : null) : null;
  const historySaleId: string | null = panelState.type === 'customer' ? panelState.lead?.saleId || null : null;
  const historyScope = JSON.stringify([user?.id, user?.username, user?.role, project?.name, panelState.type, historyLeadId, historySaleId]);
  useEffect(() => {
    let cancelled = false;
    if (!historyLeadId && !historySaleId) {
      setStatusHistory({ scope: historyScope, rows: [], loading: false, error: '' });
      return;
    }
    setStatusHistory(previous => ({ scope: historyScope, rows: previous.scope === historyScope ? previous.rows : [], loading: true, error: '' }));
    loadSalesStatusHistory(historyLeadId, historySaleId).then(rows => {
      if (!cancelled) setStatusHistory({ scope: historyScope, rows, loading: false, error: '' });
    }).catch(() => {
      if (!cancelled) setStatusHistory(previous => ({ ...previous, loading: false, error: 'โหลดประวัติสถานะไม่สำเร็จ กรุณาลองใหม่' }));
    });
    return () => { cancelled = true; };
  }, [historyScope, historyLeadId, historySaleId, historyRetry]);
  const timeline = React.useMemo(() => {
    const rawRows = statusHistory.scope === historyScope ? statusHistory.rows : [];
    const leadBookingDate = panelState.lead?.booking_date || panelState.lead?.bookingDate || panelState.lead?.booked_at || null;
    const contractDateMatch = typeof panelState.lead?.notes === 'string'
      ? panelState.lead.notes.match(/\[วันที่ทำสัญญา:\s*([0-9]{4}-[0-9]{2}-[0-9]{2})\]/)
      : null;
    const leadContractDate = contractDateMatch?.[1]
      ? `${contractDateMatch[1]}T00:00:00.000Z`
      : (panelState.lead?.rental_start_date ? `${panelState.lead.rental_start_date}T00:00:00.000Z` : null);

    const mappedRows = rawRows.map(row => {
      const canonicalStatus = STATUS_CONFIG[row.new_status]
        ? row.new_status
        : salesDealStages.some(stage => stage.id === row.new_status.toLowerCase())
        ? stageToKanbanStatus(row.new_status)
        : row.new_status;

      let effectiveTimestamp = row.created_at;
      if ((canonicalStatus === 'จองแล้ว' || row.new_status === 'Reserved') && leadBookingDate) {
        effectiveTimestamp = leadBookingDate;
      } else if ((canonicalStatus === 'สัญญาเช่า' || row.new_status === 'Rented') && leadContractDate) {
        effectiveTimestamp = leadContractDate;
      }

      return {
        id: row.id,
        status: canonicalStatus,
        timestamp: effectiveTimestamp,
        note: row.changed_by || ''
      };
    });

    const noteMilestones = extractMilestonesFromLeadNotes(panelState.lead?.notes, panelState.lead?.agentName || panelState.lead?.agent_name || '');
    const currentLeadStage = panelState.lead?.status
      ? (STATUS_CONFIG[panelState.lead.status] ? panelState.lead.status : stageToKanbanStatus(panelState.lead.status))
      : (panelState.lead?.crm_status ? (parseStageFromNoteText(panelState.lead.crm_status) || stageToKanbanStatus(panelState.lead.crm_status)) : null);

    const baseHistory = panelState.lead?.history || [];
    const baseStatuses = new Set([
      ...mappedRows.map(r => r.status),
      ...baseHistory.map((h: any) => h.status)
    ]);

    const filteredNoteMilestones = noteMilestones.filter(m => !baseStatuses.has(m.status));
    filteredNoteMilestones.forEach(m => baseStatuses.add(m.status));

    const currentFallback = (currentLeadStage && currentLeadStage !== 'Visit' && !baseStatuses.has(currentLeadStage)) ? [{
      status: currentLeadStage,
      timestamp: panelState.lead?.updated_at || panelState.lead?.created_at || new Date().toISOString(),
      note: panelState.lead?.agentName || panelState.lead?.agent_name || ''
    }] : [];

    const fallbackHistory = [...baseHistory, ...filteredNoteMilestones, ...currentFallback];
    const merged = mergeSalesTimeline(mappedRows, fallbackHistory);
    const deduped: typeof merged = [];
    for (const item of merged) {
      const day = customerBusinessDay(item.timestamp);
      const isDuplicate = deduped.some(prev => prev.status === item.status && customerBusinessDay(prev.timestamp) === day);
      if (!isDuplicate) {
        deduped.push(item);
      }
    }
    return deduped;
  }, [statusHistory.scope, historyScope, statusHistory.rows, panelState.lead]);

  // For Customer Editing
  const [editCustomerForm, setEditCustomerFormState] = useState({ name: '', phone: '', occupation: '', status: '', plot: '', salePrice: '', bank: '', cancelReason: '', landOfficePrice: '', agentName: '', transactionDate: new Date().toISOString().split('T')[0], note: '' });
  const editCustomerFormRef = useRef(editCustomerForm);
  editCustomerFormRef.current = editCustomerForm;
  const formBaselineRef = useRef<any>(null);
  const isFormDirtyRef = useRef(false);

  const setEditCustomerForm = useCallback((updater: any) => {
    isFormDirtyRef.current = true;
    setEditCustomerFormState(updater);
  }, []);

  useEffect(() => {
    if (panelState.type !== 'customer') {
      isFormDirtyRef.current = false;
      formBaselineRef.current = null;
    }
  }, [panelState.type]);

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
  const [showRentalModal, setShowRentalModal] = useState<{ isOpen: boolean; lead: any | null; plotId?: string | null; defaultMode?: 'booking' | 'contract' }>({ isOpen: false, lead: null });
  const [showRentalActionModal, setShowRentalActionModal] = useState<{ isOpen: boolean; lead: any | null; plot?: any | null }>({ isOpen: false, lead: null });
  const [showRentalPaymentModal, setShowRentalPaymentModal] = useState<{ isOpen: boolean; plot: any | null; lead: any | null; contractId?: string | null }>({ isOpen: false, plot: null, lead: null });
  const [showBookingModal, setShowBookingModal] = useState<{ isOpen: boolean; lead: any | null; plotId?: string | null }>({ isOpen: false, lead: null });
  const bookingSalesOwners = useSalesStaffOptions(showBookingModal.isOpen, undefined, String(user?.id ?? user?.username ?? ''));
  const [selectedPlotLead, setSelectedPlotLead] = useState<any | null>(null);

  useEffect(() => {
    dataRequest.current++;
    setLeads([]); setRawLeads([]); setProjectAvailability({});
    setSelectedPlotLead(null);
    setPanelState({ type: 'default', plotId: '', lead: null });
    setShowBookingModal({ isOpen: false, lead: null });
    setShowRentalModal({ isOpen: false, lead: null });
    setShowRentalActionModal({ isOpen: false, lead: null });
    setShowRentalPaymentModal({ isOpen: false, plot: null, lead: null });
  }, [user?.id, user?.username, user?.role]);

  // Excel Import State
  const [showImportModal, setShowImportModal] = useState(false);
  const [importData, setImportData] = useState<ParsedLeadRow[]>([]);
  const [isImporting, setIsImporting] = useState(false);

  // Project Availability State for Selector (Filter only projects with available houses)
  const [projectAvailability, setProjectAvailability] = useState<Record<string, { total: number; vacant: number }>>({});
  const [loadingAvailability, setLoadingAvailability] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showOnlyAvailable, setShowOnlyAvailable] = useState(true); // Default to true so only projects with available houses display on enter

  useEffect(() => {
    if (internalProject) return;
    let isCancelled = false;
    const fetchAvailability = async () => {
      setLoadingAvailability(true);
      setLoadError(null);
      try {
        const [plotsData, salesData] = await Promise.all([
          fetchSalesWithoutLimit('plots', { select: 'id, project_name, has_customer, sale_status', orderBy: 'id', ascending: true }),
          fetchSalesWithoutLimit('sales', { select: 'plot_id, contract_status', orderBy: 'id', ascending: true })
        ]);

        if (isCancelled) return;

        const occupied = new Set((salesData || [])
          .filter((s: any) => (s.contract_status || '').toLowerCase() !== 'cancelled')
          .map((s: any) => s.plot_id));

        const counts: Record<string, { total: number; vacant: number }> = {};
        for (const p of plotsData || []) {
          if (!p.project_name) continue;
          const pName = p.project_name.trim();
          if (!counts[pName]) {
            counts[pName] = { total: 0, vacant: 0 };
          }
          counts[pName].total++;
          const isVacant = p.has_customer === false &&
            (!p.sale_status || ['active', 'normal', 'ready_for_sale', 'available', 'vacant', ''].includes(p.sale_status.toLowerCase())) &&
            !occupied.has(p.id);
          if (isVacant) {
            counts[pName].vacant++;
          }
        }
        setProjectAvailability(counts);
      } catch (err) {
        console.error('Error fetching project availability:', err);
        if (!isCancelled) setLoadError('โหลดจำนวนบ้านว่างไม่สำเร็จ ข้อมูลเดิมที่แสดงอาจไม่ใช่ข้อมูลล่าสุด');
      } finally {
        if (!isCancelled) setLoadingAvailability(false);
      }
    };
    fetchAvailability();
    return () => { isCancelled = true; };
  }, [internalProject, user?.id, user?.username]);

  // Fetch Leads and Sales Data from Supabase without 1000-row or RPC limits
  const fetchData = async () => {
    if (!internalProject) return;
    const projName = internalProject.name;
    const request = ++dataRequest.current;
    const scope = currentDataScope.current;
    const isCurrent = () => dataRequest.current === request && currentDataScope.current === scope;
    setLoadError(null);
    try {
      // 1. Parallel fetch plots, leads, and sales for this project without limit
      const [plotsData, nativeLeads, salesResult] = await Promise.all([
        fetchSalesWithoutLimit('plots', { filterCol: 'project_name', filterVal: projName, select: '*', orderBy: 'id', ascending: true }),
        fetchSalesWithoutLimit('leads', { filterCol: 'project_name', filterVal: projName, select: '*', orderBy: 'created_at', ascending: false }),
        fetchSalesWithoutLimit('sales', { select: SALES_WITH_CUSTOMER_SELECT, orderBy: 'created_at', ascending: false })
      ]);

      if (!isCurrent()) return;
      const leadsData = nativeLeads;
      const allSales = salesResult;
      if (plotsData) {
        setProjectPlots(plotsData.map((p: any) => p.id));
        setProjectPlotsData(plotsData);
      }

      const projectPlotIds = new Set((plotsData || []).map((p: any) => p.id));
      const projectSales = (allSales || []).filter((s: any) =>
        projectPlotIds.has(s.plot_id) ||
        s.plots?.project_name === projName
      );

      // 2. Format sales into Kanban lead structure
      const claimedLeadIds = new Set<string>();

      let formattedLeads: any[] = projectSales.map((s: any) => {
        const matchingPlot = plotsData?.find((p: any) => p.id === s.plot_id || p.plot_name === s.plots?.plot_name);
        const stage = salesDealStageOf(s);
        const kanbanStatus = stageToKanbanStatus(stage);

        // 1. Direct lead_id match
        let matchingLead = s.lead_id ? leadsData?.find((l: any) => l.id === s.lead_id) : undefined;

        // 2. Fallback plot-based & customer-name matching for legacy import records without lead_id
        if (!matchingLead && leadsData && leadsData.length > 0) {
          const sPlotKeys = new Set([
            s.plot_id,
            matchingPlot?.id,
            matchingPlot?.plot_name,
            s.plots?.plot_name,
            normalizePlotKey(matchingPlot?.plot_name),
            normalizePlotKey(s.plots?.plot_name),
            normalizePlotKey(s.plot_id),
          ].filter(Boolean));

          const candidateLeads = leadsData.filter((l: any) => {
            if (!l.id || claimedLeadIds.has(l.id)) return false;

            // If this sale is cancelled, do NOT claim leads that are active or rental leads!
            if (s.contract_status === 'Cancelled' || kanbanStatus === 'Cancelled' || stage === 'cancelled') {
              if (l.deal_type === 'rent' || ['PendingContract', 'Active', 'Renewed'].includes(l.rental_status)) return false;
              if (l.status !== 'Cancelled' && l.status !== 'Lost') return false;
            }

            const lPlotKeys = [
              l.interested_plot_id,
              l.interested_plot_name,
              normalizePlotKey(l.interested_plot_name),
              normalizePlotKey(l.interested_plot_id),
            ].filter(Boolean);

            const plotMatches = lPlotKeys.some(k => sPlotKeys.has(k)) ||
              (l.interested_plot_name && (s.plot_id === `${projName}-${l.interested_plot_name}` || (matchingPlot?.plot_name && l.interested_plot_name === matchingPlot.plot_name)));

            if (plotMatches) return true;

            const leadName = (l.customer_name || '').trim();
            if (leadName) {
              if (matchingPlot?.highlight_note && matchingPlot.highlight_note.includes(leadName)) return true;
              const saleCustName = (s.customer_name || s.customerName || '').trim();
              if (saleCustName && (saleCustName.includes(leadName) || leadName.includes(saleCustName))) return true;
            }

            return false;
          });

          if (candidateLeads.length > 0) {
            candidateLeads.sort((a: any, b: any) => {
              const score = (lead: any) => {
                let sc = 0;
                const st = lead.status || '';
                const isTransferred = st === 'Transferred' || Boolean(lead.transferred_date);
                const isBooked = ['Reserved', 'Booked', 'Contracted', 'DownPayment', 'Approved'].includes(st) || Boolean(lead.booking_date);
                const isActive = !['Cancelled', 'Lost'].includes(st);

                if (kanbanStatus === 'Transferred' || stage === 'transferred') {
                  if (isTransferred) sc += 100;
                  else if (isBooked) sc += 40;
                  else if (isActive) sc += 20;
                } else if (kanbanStatus === 'Reserved' || stage === 'booked') {
                  if (isBooked) sc += 100;
                  else if (isTransferred) sc += 40;
                  else if (isActive) sc += 20;
                } else if (kanbanStatus === 'Cancelled' || stage === 'cancelled') {
                  if (st === 'Cancelled' || st === 'Lost') sc += 100;
                  else sc += 10;
                } else {
                  if (isActive) sc += 50;
                }
                return sc;
              };
              return score(b) - score(a);
            });

            matchingLead = candidateLeads[0];
          }
        }

        const isSaleCancelled = s.contract_status === 'Cancelled' || kanbanStatus === 'Cancelled' || stage === 'cancelled';
        if (matchingLead?.id) {
          const leadIsActiveOrRental = matchingLead.deal_type === 'rent' ||
            ['PendingContract', 'Active', 'Renewed'].includes(matchingLead.rental_status) ||
            (matchingLead.status !== 'Cancelled' && matchingLead.status !== 'Lost');
          if (!isSaleCancelled || !leadIsActiveOrRental) {
            claimedLeadIds.add(matchingLead.id);
          }
        }

        const crmCustomer = crmSaleCustomer(s);
        const bookDate = customerBusinessDay(matchingLead?.booking_date) || customerBusinessDay(s.booked_at) || customerBusinessDay(s.imported_history?.bookedDate || s.importedHistory?.bookedDate) || '';
        const transferDate = customerBusinessDay(s.transferred_at) || customerBusinessDay(s.crm_transfer_date || s.imported_history?.transferredDate || s.importedHistory?.transferredDate) || customerBusinessDay(matchingLead?.transferred_date);
        const cancelDate = customerBusinessDay(s.cancelled_at) || customerBusinessDay(s.imported_history?.cancelledDate || s.importedHistory?.cancelledDate);
        const visitDate = customerBusinessDay(matchingLead?.actual_visit_date) || '';

        return {
          id: s.id,
          saleId: s.id,
          leadId: matchingLead?.id || s.lead_id || null,
          crmStage: s.crm_stage,
          project_name: projName,
          name: matchingLead?.customer_name || crmCustomer?.name || (!s.project_interest_id ? s.customer_name || s.customerName : '') || 'ลูกค้าไม่ระบุชื่อ',
          phone: matchingLead?.phone || crmCustomer?.phone || (!s.project_interest_id ? s.phone : '') || '',
          occupation: matchingLead?.occupation || '',
          interest: projName,
          status: kanbanStatus,
          plot: s.plot_id || matchingPlot?.id || null,
          plotName: s.plots?.plot_name || matchingPlot?.plot_name || s.plot_id || null,
          bank: s.bank_name || (matchingLead?.notes ? customerDealDetails(matchingLead.notes).bank : '') || '',
          cancelReason: s.cancellation_reason || '',
          landOfficePrice: s.land_office_price?.toString() || extractAgreedPrices(matchingLead?.notes).landAppraisalPrice?.toString() || matchingPlot?.land_appraisal_price?.toString() || '',
          salePrice: Number(s.sale_price ?? matchingPlot?.selling_price ?? 0),
          expectedTransferDate: customerExpectedTransferDay(s) || (matchingLead?.notes ? extractExpectedTransferDate(matchingLead.notes) : null) || (matchingLead?.expected_transfer_date ? customerBusinessDay(matchingLead.expected_transfer_date) : null),
          notes: matchingLead?.notes || s.notes || '',
          visitDate,
          bookingDate: bookDate,
          booking_date: matchingLead?.booking_date || s.booked_at || (bookDate ? `${bookDate}T00:00:00.000Z` : null),
          transferredDate: transferDate,
          cancelledDate: cancelDate,
          agentName: matchingLead?.agent_name || matchingLead?.sales_owner || s.agent_name || '',
          source: matchingLead?.source || matchingLead?.channel || 'Walk-in',
          bankStatus: s.bank_status || 'Pending',
          deal_type: matchingLead?.deal_type || (s as any).deal_type || (matchingLead?.crm_status?.includes('เช่า') ? 'rent' : 'sale'),
          customer_name: matchingLead?.customer_name || crmCustomer?.name || (!s.project_interest_id ? s.customer_name || s.customerName : '') || 'ลูกค้าไม่ระบุชื่อ',
          booking_amount: matchingLead?.booking_amount || s.booking_fee || 0,
          rental_program: matchingLead?.rental_program || null,
          rental_monthly_rent: matchingLead?.rental_monthly_rent !== undefined && matchingLead?.rental_monthly_rent !== null ? Number(matchingLead.rental_monthly_rent) : null,
          rental_deposit: matchingLead?.rental_deposit !== undefined && matchingLead?.rental_deposit !== null ? Number(matchingLead.rental_deposit) : null,
          rental_savings_per_month: matchingLead?.rental_savings_per_month !== undefined && matchingLead?.rental_savings_per_month !== null ? Number(matchingLead.rental_savings_per_month) : null,
          rental_base_price: matchingLead?.rental_base_price !== undefined && matchingLead?.rental_base_price !== null ? Number(matchingLead.rental_base_price) : null,
          rental_start_date: matchingLead?.rental_start_date ? String(matchingLead.rental_start_date).split('T')[0] : null,
          rental_end_date: matchingLead?.rental_end_date ? String(matchingLead.rental_end_date).split('T')[0] : null,
          rental_status: matchingLead?.rental_status || null,
          history: [
            ...(bookDate ? [{ status: 'Reserved', timestamp: bookDate, note: matchingLead?.agent_name || matchingLead?.sales_owner || s.agent_name || '' }] : []),
            ...(transferDate ? [{ status: 'Transferred', timestamp: transferDate, note: matchingLead?.agent_name || matchingLead?.sales_owner || s.agent_name || '' }] : []),
            ...(cancelDate ? [{ status: 'Cancelled', timestamp: cancelDate, note: s.cancellation_reason || '' }] : [])
          ]
        };
      });

      // 3. Append prospective leads from leads table that don't have sales
      if (leadsData && leadsData.length > 0) {
        const existingLeadIds = new Set(
          formattedLeads
            .filter(fl => fl.status !== 'Cancelled' && (fl as any).crmStage !== 'cancelled')
            .map(l => l.leadId)
            .filter(Boolean)
        );
        const cancelledLeadIds = new Set(
          formattedLeads
            .filter(fl => fl.status === 'Cancelled' || (fl as any).crmStage === 'cancelled')
            .map(l => l.leadId)
            .filter(Boolean)
        );
        const isLeadActiveOrRental = (lead: any) =>
          lead.deal_type === 'rent' ||
          ['PendingContract', 'Active', 'Renewed'].includes(lead.rental_status) ||
          (lead.status !== 'Cancelled' && lead.status !== 'Lost');
        leadsData.forEach((l: any) => {
          if (l.id && !existingLeadIds.has(l.id) && !claimedLeadIds.has(l.id)) {
            if (cancelledLeadIds.has(l.id) && !isLeadActiveOrRental(l)) {
              return;
            }
            const matchingPlot = plotsData?.find((p: any) =>
              p.id === l.interested_plot_id ||
              p.plot_name === l.interested_plot_name ||
              p.id === `${projName}-${l.interested_plot_name}`
            );
            const bookDate = l.booking_date ? l.booking_date.split('T')[0] : '';
            const transferDate = l.transferred_date ? l.transferred_date.split('T')[0] : null;
            const visitDate = l.actual_visit_date?.split('T')[0] || '';

            const lPlotKeys = [
              l.interested_plot_id,
              l.interested_plot_name,
              matchingPlot?.id,
              matchingPlot?.plot_name,
              normalizePlotKey(l.interested_plot_name),
              normalizePlotKey(l.interested_plot_id),
            ].filter(Boolean);

            // 1. If an unnamed entry for this plot already exists, merge this lead into it
            const unnamedMatchIndex = formattedLeads.findIndex(fl => {
              if (fl.name !== 'ลูกค้าไม่ระบุชื่อ') return false;
              if (fl.status === 'Cancelled' && l.status !== 'Cancelled' && l.status !== 'Lost') return false;
              const flPlotKeys = new Set([
                fl.plot,
                fl.plotName,
                normalizePlotKey(fl.plotName),
                normalizePlotKey(fl.plot),
              ].filter(Boolean));
              return lPlotKeys.some(k => flPlotKeys.has(k));
            });

            if (unnamedMatchIndex !== -1) {
              const target = formattedLeads[unnamedMatchIndex];
              target.leadId = l.id;
              target.name = l.customer_name || target.name;
              target.customer_name = l.customer_name || target.customer_name;
              target.phone = l.phone || target.phone;
              target.agentName = l.agent_name || l.sales_owner || target.agentName;
              if (!target.transferredDate && transferDate) {
                target.transferredDate = transferDate;
              }
              if (!target.bookingDate && bookDate) {
                target.bookingDate = bookDate;
                target.booking_date = l.booking_date;
              }
              if (!target.bank && l.notes) {
                target.bank = customerDealDetails(l.notes).bank;
              }
              if (l.deal_type) target.deal_type = l.deal_type;
              existingLeadIds.add(l.id);
              claimedLeadIds.add(l.id);
              return;
            }

            // 2. Prevent duplicate deal (Transferred or Booked) for the same plot
            const hasDuplicateDeal = formattedLeads.some(fl => {
              if (fl.status === 'Cancelled') return false;
              const flPlotKeys = new Set([
                fl.plot,
                fl.plotName,
                normalizePlotKey(fl.plotName),
                normalizePlotKey(fl.plot),
              ].filter(Boolean));
              const samePlot = lPlotKeys.some(k => flPlotKeys.has(k));
              if (!samePlot) return false;
              const flIsTransferred = ['Transferred', 'Handover'].includes(fl.status);
              const lIsTransferred = l.status === 'Transferred' || Boolean(transferDate);
              if (flIsTransferred && lIsTransferred) return true;
              const flIsBooked = ['Reserved', 'Contracted', 'DownPayment', 'DocumentPrep', 'LoanProcessing', 'LoanRejected', 'Approved', 'TransferPending'].includes(fl.status);
              const lIsBooked = ['Reserved', 'Booked', 'Contracted'].includes(l.status) || Boolean(bookDate);
              if (flIsBooked && lIsBooked) return true;
              return false;
            });

            if (hasDuplicateDeal) {
              return; // Skip duplicate deal row for the same plot
            }

            formattedLeads.push({
              id: l.id,
              leadId: l.id, saleId: null, sourceKind: 'lead', project_name: projName,
              crm_status: l.crm_status,
              name: l.customer_name,
              phone: l.phone || '',
              occupation: l.occupation || '',
              interest: l.interest || projName,
              status: getLeadStage(l) === 'booked' && !STATUS_CONFIG[l.status]
                ? 'Reserved'
                : (l.status || (transferDate ? 'Transferred' : (bookDate ? 'Reserved' : 'Visit'))),
              plot: l.interested_plot_id || matchingPlot?.id || null,
              plotName: l.interested_plot_name || matchingPlot?.plot_name || l.interested_plot_id || null,
              bank: customerDealDetails(l.notes).bank,
              cancelReason: l.lost_reason || '',
              landOfficePrice: extractAgreedPrices(l.notes).landAppraisalPrice?.toString() || matchingPlot?.land_appraisal_price?.toString() || '',
              salePrice: customerDealDetails(l.notes).salePrice ?? (matchingPlot?.selling_price ? Number(matchingPlot.selling_price) : 0),
              expectedTransferDate: extractExpectedTransferDate(l.notes) || (l.expected_transfer_date ? customerBusinessDay(l.expected_transfer_date) : null),
              notes: l.notes || '',
              visitDate: visitDate,
              bookingDate: bookDate,
              booking_date: l.booking_date || (bookDate ? `${bookDate}T00:00:00.000Z` : null),
              transferredDate: transferDate,
              agentName: l.agent_name || l.sales_owner || l.created_by_agent || '',
              source: l.source || l.channel || 'Walk-in',
              bankStatus: 'Pending',
              deal_type: l.deal_type || (l.crm_status?.includes('เช่า') ? 'rent' : 'sale'),
              customer_name: l.customer_name || '',
              booking_amount: l.booking_amount || 0,
              rental_program: l.rental_program || null,
              rental_monthly_rent: l.rental_monthly_rent !== undefined && l.rental_monthly_rent !== null ? Number(l.rental_monthly_rent) : null,
              rental_deposit: l.rental_deposit !== undefined && l.rental_deposit !== null ? Number(l.rental_deposit) : null,
              rental_savings_per_month: l.rental_savings_per_month !== undefined && l.rental_savings_per_month !== null ? Number(l.rental_savings_per_month) : null,
              rental_base_price: l.rental_base_price !== undefined && l.rental_base_price !== null ? Number(l.rental_base_price) : null,
              rental_start_date: l.rental_start_date ? String(l.rental_start_date).split('T')[0] : null,
              rental_end_date: l.rental_end_date ? String(l.rental_end_date).split('T')[0] : null,
              rental_status: l.rental_status || null,
              history: [
                ...(bookDate ? [{ status: 'Reserved', timestamp: bookDate, note: l.agent_name || l.sales_owner || l.created_by_agent || '' }] : []),
                ...(transferDate ? [{ status: 'Transferred', timestamp: transferDate, note: l.agent_name || l.sales_owner || l.created_by_agent || '' }] : [])
              ]
            });
          }
        });
      }

      if (!isCurrent()) return;

      setLeads(formattedLeads);
      setRawLeads([...formattedLeads, ...(leadsData || [])]);

      // Sync panelState.lead and editCustomerForm if open
      if (panelStateRef.current.type === 'customer' && panelStateRef.current.lead) {
        const curLead = panelStateRef.current.lead;
        // Strictly match by unique ID - NEVER fallback to plot!
        const fresh = formattedLeads.find((fl: any) =>
          (curLead.leadId && (fl.leadId === curLead.leadId || fl.id === curLead.leadId)) ||
          (curLead.id && (fl.id === curLead.id || fl.leadId === curLead.id)) ||
          (curLead.saleId && fl.saleId === curLead.saleId)
        );
        if (fresh) {
          setPanelState(prev => ({
            ...prev,
            lead: { ...prev.lead, ...fresh }
          }));

          const curForm = editCustomerFormRef.current;
          const baseline = formBaselineRef.current;
          const hasDraftEdits = isFormDirtyRef.current || (baseline && (
            curForm.name !== baseline.name ||
            curForm.phone !== baseline.phone ||
            curForm.occupation !== baseline.occupation ||
            curForm.agentName !== baseline.agentName ||
            curForm.status !== baseline.status ||
            curForm.plot !== baseline.plot ||
            curForm.salePrice !== baseline.salePrice ||
            curForm.bank !== baseline.bank ||
            curForm.cancelReason !== baseline.cancelReason ||
            curForm.landOfficePrice !== baseline.landOfficePrice ||
            curForm.note !== baseline.note
          ));

          // Only sync server changes into editCustomerForm if user is not actively editing a draft
          if (!hasDraftEdits) {
            const nextForm = {
              name: fresh.customer_name || fresh.name || curForm.name,
              phone: fresh.phone || curForm.phone,
              plot: fresh.plot || fresh.interested_plot_name || curForm.plot,
              agentName: fresh.agentName || fresh.agent_name || curForm.agentName,
              status: fresh.status || curForm.status
            };
            setEditCustomerFormState(prev => ({
              ...prev,
              ...nextForm
            }));
            if (formBaselineRef.current) {
              formBaselineRef.current = {
                ...formBaselineRef.current,
                ...nextForm
              };
            }
          }
        }
      }

      // Refresh plotInfo if viewing a plot
      if (panelStateRef.current.plotId) {
        setPlotInfoRefreshTrigger(t => t + 1);
      }
    } catch(e) {
      console.error('Error fetching sales data in SalesKanban:', e);
      if (!isCurrent()) return;
      setLoadError('โหลดข้อมูลการขายไม่สำเร็จ ข้อมูลเดิมที่แสดงอาจไม่ใช่ข้อมูลล่าสุด กรุณาลองใหม่');
    }
  };

  useEffect(() => {
    fetchData();
    const unsubscribeSync = subscribeToSalesSync(() => {
      fetchData();
    }, 200);

    const handleVisibility = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        fetchData();
      }
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibility);
    }
    return () => {
      dataRequest.current++;
      unsubscribeSync();
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibility);
      }
    };
  }, [internalProject?.name, user?.id, user?.username]);

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
  }, [panelState.plotId, plotInfoRefreshTrigger]);

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
      const canonicalStatus = STATUS_CONFIG[lead.status] ? lead.status : (stageToKanbanStatus(lead.status) || 'Reserved');
      const initialForm = { name: lead.name, phone: lead.phone, occupation: lead.occupation || '', status: canonicalStatus, plot: lead.plot || '', salePrice: lead.salePrice?.toString() || '', bank: lead.bank || '', cancelReason: lead.cancelReason || '', landOfficePrice: lead.landOfficePrice || '', transactionDate: new Date().toISOString().split('T')[0], agentName: lead.agentName || '', note: '' };
      setPanelState({ type: 'customer', plotId, lead });
      formBaselineRef.current = initialForm;
      isFormDirtyRef.current = false;
      setEditCustomerFormState(initialForm);
    }
  };

  const handleEditLeadClick = (lead: any) => {
    setActiveTab('map');
    const canonicalStatus = STATUS_CONFIG[lead.status] ? lead.status : (stageToKanbanStatus(lead.status) || 'Reserved');
    const initialForm = { name: lead.name, phone: lead.phone, occupation: lead.occupation || '', status: canonicalStatus, plot: lead.plot || '', salePrice: lead.salePrice?.toString() || '', bank: lead.bank || '', cancelReason: lead.cancelReason || '', landOfficePrice: lead.landOfficePrice || '', transactionDate: new Date().toISOString().split('T')[0], agentName: lead.agentName || '', note: '' };
    setPanelState({ type: 'customer', plotId: lead.plot || '', lead });
    formBaselineRef.current = initialForm;
    isFormDirtyRef.current = false;
    setEditCustomerFormState(initialForm);
  };

  const handleSaveNewCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const formData = new FormData(e.target as HTMLFormElement);
      const projName = internalProject?.name || project?.name || 'ไอลิน6';
      const name = (formData.get('name') as string)?.trim() || 'ลูกค้าไม่ระบุชื่อ';
      const phoneInput = (formData.get('phone') as string) || '';
      const cleanPhone = phoneInput.replace(/[^0-9]/g, '');
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

      const now = new Date().toISOString();
      const owner = user?.displayName || user?.username || 'ทีมขาย';
      const { data, error } = await supabase.from('leads').insert([{
        customer_name: name,
        phone: cleanPhone || null,
        occupation: occupation || null,
        project_name: projName,
        interest: finalInterest,
        channel: 'Walk in',
        source: 'Walk in',
        status: 'New',
        crm_status: 'Follow-up — อยู่ระหว่างติดตาม',
        agent_name: owner,
        created_by_agent: owner,
        notes: notesText,
        created_at: now,
        updated_at: now,
      }]).select('id').single();
      if (error) throw error;
      if (!data?.id) throw new Error('ไม่ได้รับรหัสลูกค้าหลังบันทึก');
      await fetchData();
      setPanelState({ type: 'default', plotId: '', lead: null });
    } catch (err) {
      alert(err instanceof Error ? err.message : 'บันทึกลูกค้าไม่สำเร็จ');
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
        await checkedResult(supabase.from('sales').update(salePayload).eq('id', saleId));
      }

      // 2. Also check if there is an existing sale by lead_id
      const { data: existingSale } = await checkedResult(supabase.from('sales').select('id').eq('lead_id', leadId).maybeSingle());
      if (existingSale && existingSale.id !== saleId) {
        await checkedResult(supabase.from('sales').update(salePayload).eq('id', existingSale.id));
      } else if (isNewBooking && !saleId) {
        await checkedResult(supabase.from('sales').insert([{ plot_id: panelState.plotId, ...salePayload }]));
      }

      // 3. Update leads table
      if (leadId) {
        const leadUpdatePayload: any = {
          customer_name: editCustomerForm.name.trim(),
          phone: editCustomerForm.phone.trim() || null,
          occupation: editCustomerForm.occupation.trim() || null,
          status: newStatus,
          updated_at: new Date().toISOString()
        };
        if (editCustomerForm.agentName) {
          leadUpdatePayload.agent_name = editCustomerForm.agentName.trim();
        }
        if (newStatus === 'Cancelled') {
          leadUpdatePayload.cancellation_reason = editCustomerForm.cancelReason || null;
          leadUpdatePayload.cancelled_at = txDate;
          if (panelState.lead?.deal_type === 'rent') {
            leadUpdatePayload.rental_status = 'Cancelled';
          }
        }
        await checkedResult(supabase.from('leads').update(leadUpdatePayload).eq('id', leadId));
      }

      if (panelState.lead?.deal_type === 'rent' && newStatus === 'Cancelled') {
        try {
          await supabase.from('rental_contracts')
            .update({ status: 'Cancelled', cancellation_reason: editCustomerForm.cancelReason || 'ยกเลิกการจองเช่า' })
            .eq('lead_id', leadId)
            .in('status', ['Active', 'PendingContract']);
        } catch (rcErr) {
          console.warn('Could not cancel rental contracts:', rcErr);
        }
        const plotIdentifier = panelState.plotId || panelState.lead?.plot;
        if (plotIdentifier) {
          try {
            await supabase.from('plots').update({
              sale_status: 'available',
              has_customer: false,
              current_tenant_name: null,
              current_tenant_phone: null,
              rental_program: null,
              monthly_rent: null,
              security_deposit: null,
              lease_start_date: null,
              lease_end_date: null,
              highlight_note: null
            }).eq('id', plotIdentifier);
          } catch (plotErr) {
            console.warn('Could not release plot on cancellation:', plotErr);
          }
        }
      }

      if (oldStatus !== newStatus || editCustomerForm.bank !== panelState.lead.bank || editCustomerForm.note) {
        let noteParts = [];
        if (oldStatus === newStatus && editCustomerForm.bank !== panelState.lead.bank) {
          noteParts.push(`เปลี่ยนธนาคารเป็น: ${editCustomerForm.bank}`);
        } else if ((newStatus === 'DocumentPrep' || newStatus === 'LoanProcessing') && editCustomerForm.bank) {
          noteParts.push(`ยื่นผ่าน: ${editCustomerForm.bank}`);
        } else if (newStatus === 'Cancelled' && editCustomerForm.cancelReason) {
          noteParts.push(`เหตุผล: ${editCustomerForm.cancelReason}`);
        } else if (['Approved', 'Transferred', 'Handover'].includes(newStatus) && editCustomerForm.landOfficePrice) {
          noteParts.push(`ราคา ท.ด. ฿${parseInt(editCustomerForm.landOfficePrice).toLocaleString()}`);
        }
        
        if (editCustomerForm.note) {
          noteParts.push(`หมายเหตุ: ${editCustomerForm.note}`);
        }
        
        const finalNote = noteParts.join(' | ');

        await checkedResult(supabase.from('status_history').insert([{
          entity_type: 'lead',
          entity_id: leadId,
          old_status: oldStatus,
          new_status: newStatus,
          changed_by: (user?.username || 'Unknown') + (finalNote ? ` (${finalNote})` : ''),
          created_at: txDate
        }]));
      }

      await fetchData();
      setPanelState({ type: 'default', plotId: '', lead: null });
    } catch (err) {
      alert(`บันทึกข้อมูลลูกค้ายังไม่ครบ บางส่วนอาจบันทึกแล้ว: ${err instanceof Error ? err.message : 'กรุณาลองใหม่'}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const isSearchMatch = (l: any) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return Boolean(
      (l.name ?? '').toLowerCase().includes(q) ||
      (l.phone ?? '').includes(search) ||
      (l.plot && l.plot.toLowerCase().includes(q)) ||
      (l.plotName && String(l.plotName).toLowerCase().includes(q))
    );
  };

  const filteredLeads = sortLeadsByPlot(leads.filter(l => isSearchMatch(l)));

  const bookedLeads = sortLeadsByPlot(leads.filter(l => 
    ['Reserved', 'Contracted', 'DownPayment', 'DocumentPrep', 'LoanProcessing', 'LoanRejected', 'Approved', 'TransferPending'].includes(l.status) && isSearchMatch(l)
  ));

  const isRentalCustomer = (l: any) => Boolean(
    l.deal_type === 'rent' ||
    ['Rented', 'Rent'].includes(l.status) ||
    ['Active', 'PendingContract', 'Renewed'].includes(l.rental_status) ||
    String(l.crm_status || '').includes('เช่า') ||
    l.rental_program
  );

  const rentedLeads = sortLeadsByPlot(leads.filter(l => 
    isRentalCustomer(l) && !['Cancelled', 'Lost', 'MovedOut', 'Terminated'].includes(l.status) && l.rental_status !== 'Cancelled' && isSearchMatch(l)
  ));

  const transferredLeads = sortLeadsByPlot(leads.filter(l => 
    ['Transferred', 'Handover'].includes(l.status) && isSearchMatch(l)
  ));

  const getRentalBadge = (lead: any) => {
    if (lead.rental_status === 'Active' || lead.status === 'Rented') {
      return {
        label: 'สัญญาเช่า (เช่าอยู่)',
        color: 'text-teal-700',
        bg: 'bg-teal-50',
        border: 'border-teal-200',
        icon: Key
      };
    }
    if (lead.rental_status === 'PendingContract' || lead.status === 'Reserved') {
      return {
        label: 'จองเช่า (รอทำสัญญา)',
        color: 'text-amber-800',
        bg: 'bg-amber-50',
        border: 'border-amber-300',
        icon: BookmarkCheck
      };
    }
    if (lead.rental_status === 'Renewed') {
      return {
        label: 'ต่อสัญญาเช่า',
        color: 'text-blue-700',
        bg: 'bg-blue-50',
        border: 'border-blue-200',
        icon: CheckCircle
      };
    }
    const cfg = STATUS_CONFIG[lead.status] || STATUS_CONFIG['Reserved'];
    return {
      label: cfg.label,
      color: cfg.color,
      bg: cfg.bg,
      border: 'border-white/50',
      icon: cfg.icon
    };
  };

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
    const targetLead = leads.find(l => l.id === leadId);
    if (!targetLead) return;
    if (pendingForecasts.current.has(leadId)) return;
    const day = customerBusinessDay(newDate);
    if (newDate && !day) return;
    const scope = forecastScope.current;
    pendingForecasts.current.add(leadId);
    setSavingForecasts([...pendingForecasts.current]);

    try {
      let saleId = targetLead.saleId;
      const actualLeadId = targetLead.leadId || (targetLead.sourceKind === 'lead' ? targetLead.id : null);

      // 1. If saleId is not on the in-memory object, try looking up an existing sale by lead_id
      if (!saleId && actualLeadId) {
        try {
          const { data: existingSale } = await supabase
            .from('sales')
            .select('id')
            .eq('lead_id', actualLeadId)
            .maybeSingle();
          if (existingSale?.id) {
            saleId = existingSale.id;
          }
        } catch (e) {
          console.warn('Could not query sales table by lead_id', e);
        }
      }

      // 2. Update sales record if saleId exists
      if (saleId) {
        const result = await checkedResult(supabase
          .from('sales')
          .update({ expected_transfer_date: day || null })
          .eq('id', saleId)
          .select('id,expected_transfer_date')
          .single());
        const saved = result.data;
        if (!saved || saved.id !== saleId || customerExpectedTransferDay(saved) !== (day || null)) {
          throw new Error('ไม่พบวันคาดโอนที่บันทึกได้ในรายการจองนี้');
        }
      }

      // 3. Update leads record notes if actualLeadId exists
      if (actualLeadId) {
        try {
          const { data: currentLead } = await supabase
            .from('leads')
            .select('notes')
            .eq('id', actualLeadId)
            .maybeSingle();
          const baseNotes = currentLead?.notes ?? targetLead.notes ?? '';
          const updatedNotes = updateExpectedTransferDateInNotes(baseNotes, day);
          const { error: leadError } = await supabase
            .from('leads')
            .update({ notes: updatedNotes })
            .eq('id', actualLeadId);
          if (leadError) console.warn('Leads update warning:', leadError.message);
        } catch (leadErr) {
          console.warn('Failed to update leads notes:', leadErr);
        }
      }

      // 4. Update local state
      if (forecastScope.current === scope) {
        setLeads(prev => prev.map(l => l.id === leadId
          ? { 
              ...l, 
              expectedTransferDate: day || null,
              notes: updateExpectedTransferDateInNotes(l.notes, day),
              saleId: saleId || l.saleId 
            } 
          : l
        ));
      }
    } catch (err) {
      console.error("Failed to update transfer date", err);
      if (forecastScope.current === scope) {
        alert(`บันทึกวันคาดโอนไม่สำเร็จ: ${err instanceof Error ? err.message : 'กรุณาลองใหม่'}`);
      }
    } finally {
      pendingForecasts.current.delete(leadId);
      setSavingForecasts([...pendingForecasts.current]);
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
              const rawPlotStr = parsed.interested_plot_name.trim();
              const cleanPlotName = rawPlotStr.replace(/^(AL\d+|YR|K\d+พิเศษ|K\d+)-?/i, '').replace(/^0+/, '').trim();
              const matched = allPlotsData.find(p => {
                const pProj = (p.project_name || '').toLowerCase().replace(/\s+/g, '');
                const targetProj = (parsed.project_name || '').toLowerCase().replace(/\s+/g, '');
                if (pProj !== targetProj) return false;

                const pIdClean = (p.id || '').replace(/^(ไอลิน\s*\d+|โยริว|กานต์รวี\s*\d+)-?/i, '').replace(/^0+/, '').trim();
                const pNameClean = (p.plot_name || '').replace(/^0+/, '').trim();

                return p.id === rawPlotStr ||
                       p.plot_name === rawPlotStr ||
                       pNameClean === cleanPlotName ||
                       pIdClean === cleanPlotName ||
                       p.id === `${parsed.project_name}-${cleanPlotName}`;
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
      const { data: allLeadsData } = await checkedResult(supabase.from('leads').select('id, customer_name, phone, project_name, status, agent_name, created_at'));

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
          await checkedResult(supabase.from('leads').update(leadPayload).eq('id', existingLead.id));
          currentLeadId = existingLead.id;

          if (row.legacy_status !== existingLead.status) {
            await checkedResult(supabase.from('status_history').insert([{
              entity_type: 'lead',
              entity_id: existingLead.id,
              old_status: existingLead.status,
              new_status: row.legacy_status,
              changed_by: (user?.username || 'Unknown') + ' (System Import Update)',
              created_at: row.transferred_date || row.booking_date || new Date().toISOString()
            }]));
          }
          updatedCount++;
        } else {
          // INSERT NEW LEAD
          const { data: newLeadsData, error: newLeadsError } = await checkedResult(supabase.from('leads').insert([{
            ...leadPayload,
            created_at: row.lead_date || new Date().toISOString()
          }]).select());
          
          if (newLeadsError) throw new Error(newLeadsError.message);
          if (!newLeadsData?.length) throw new Error('เพิ่มลูกค้าแล้วแต่ยืนยันรหัสรายการไม่ได้');

          if (newLeadsData && newLeadsData.length > 0) {
            currentLeadId = newLeadsData[0].id;
            await checkedResult(supabase.from('status_history').insert([{
              entity_type: 'lead',
              entity_id: currentLeadId,
              new_status: row.legacy_status,
              changed_by: (user?.username || 'Unknown') + ' (System Import)',
              created_at: row.transferred_date || row.booking_date || row.lead_date || new Date().toISOString()
            }]));
            insertedCount++;
          }
        }

        // Sync with sales table & plots
        if (currentLeadId && (row.matched_plot_id || row.booking_date || row.crm_status.includes('จอง') || row.crm_status.includes('โอน') || row.crm_status.includes('สัญญา'))) {
          const contractStatus = row.transferred_date || row.crm_status.includes('โอน') ? 'Transferred' : (row.crm_status.includes('สัญญา') ? 'Contracted' : 'Reserved');
          const salePrice = row.sale_price || row.booking_amount || 0;

          const { data: existingSale } = await checkedResult(supabase.from('sales').select('id').eq('lead_id', currentLeadId).maybeSingle());

          const salePayload = {
            plot_id: row.matched_plot_id || null,
            sale_price: salePrice,
            booking_amount: row.booking_amount,
            land_office_price: row.land_office_price,
            contract_status: contractStatus,
            ...(row.transferred_date ? { transferred_at: row.transferred_date } : {})
          };

          if (existingSale) {
            await checkedResult(supabase.from('sales').update(salePayload).eq('id', existingSale.id));
          } else {
            await checkedResult(supabase.from('sales').insert([{
              lead_id: currentLeadId,
              ...salePayload,
              bank_status: row.loan_approved_date ? 'Approved' : (row.loan_submission_date ? 'Pre-approved' : 'Pending'),
              created_at: row.booking_date || row.lead_date || new Date().toISOString()
            }]));
          }

          if (row.matched_plot_id) {
            await checkedResult(supabase.from('plots').update({
              has_customer: true,
              sale_status: row.transferred_date ? 'transferred' : 'sold'
            }).eq('id', row.matched_plot_id));
          }
        }
      }

      await fetchData();
      setShowImportModal(false);
      setImportData([]);
      alert(`นำเข้าข้อมูลสำเร็จ: อัปเดตข้อมูลเดิม ${updatedCount} รายการ, เพิ่มข้อมูลใหม่ ${insertedCount} รายการ`);
    } catch (err) {
      console.error("Error importing data:", err);
      alert("นำเข้าข้อมูลยังไม่ครบ บางรายการอาจบันทึกแล้ว กรุณาตรวจรายการก่อนนำเข้าซ้ำ");
    } finally {
      setIsImporting(false);
    }
  };

  const handleClearData = async () => {
    if (window.confirm("คำเตือน: ข้อมูลลูกค้าและการขายทั้งหมดในโครงการนี้จะถูกลบอย่างถาวร (รวมถึงประวัติทั้งหมด) คุณแน่ใจหรือไม่?")) {
      try {
        const projName = project?.name || 'ไอลิน6';
        // Find all leads for this project
        const { data: leadsData } = await checkedResult(supabase.from('leads').select('id').eq('project_name', projName));
        
        if (leadsData && leadsData.length > 0) {
          const leadIds = leadsData.map(l => l.id);
          
          // Delete status_history for these leads manually
          await checkedResult(supabase.from('status_history').delete().in('entity_id', leadIds));
          
          // Delete leads (sales will cascade automatically)
          const { error } = await checkedResult(supabase.from('leads').delete().eq('project_name', projName));
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
        {loadError && <p role="alert" className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs font-bold text-rose-900">{loadError}</p>}
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
      {loadError && <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs font-bold text-rose-900 flex items-center justify-between gap-2">
        <span>{loadError}</span>
        <button type="button" onClick={fetchData} className="shrink-0 underline">ลองใหม่</button>
      </div>}
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
            onClick={() => setActiveTab('rented')}
            className={`pb-4 px-2 text-sm font-bold border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'rented' ? 'border-[#d4af37] text-[#0f172a]' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            <Key size={18} className={activeTab === 'rented' ? 'text-[#d4af37]' : ''} />
            <span>ลูกค้าที่เช่า</span>
            {rentedLeads.length > 0 && (
              <span className="bg-teal-50 text-teal-700 border border-teal-200 text-[10px] font-black px-1.5 py-0.2 rounded-full">
                {rentedLeads.length}
              </span>
            )}
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
        
        {/* Search Bar for List/Booked/Rented/Transferred View */}
        {(activeTab === 'list' || activeTab === 'booked' || activeTab === 'rented' || activeTab === 'transferred') && (
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
                                {STATUS_CONFIG[lead.status]?.label || lead.status}
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
                              <button onClick={() => handleEditLeadClick(lead)} className="text-[#0f172a] font-semibold text-sm hover:text-[#d4af37] transition-colors flex items-center gap-1 opacity-100 group-focus-within:opacity-100 focus:opacity-100">
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
                                  <div className="font-semibold text-slate-800 flex items-center gap-1.5 flex-wrap">
                                    <span>{lead.name}</span>
                                    {lead.deal_type === 'rent' && (
                                      <span className="px-1.5 py-0.2 rounded-md bg-amber-100 text-amber-900 font-bold text-[10px] border border-amber-300">
                                        🔑 จองเช่า
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                                    {formatPhoneNumber(lead.phone)}
                                    {lead.agentName && <span className="ml-2 px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded flex items-center gap-1 border border-blue-100"><User size={8} /> {lead.agentName}</span>}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold ${
                                lead.deal_type === 'rent' ? 'bg-amber-100 text-amber-900 border-amber-300' : `${statusCfg.bg} ${statusCfg.color} border-white/50`
                              } border shadow-sm`}>
                                {lead.deal_type === 'rent' ? <BookmarkCheck size={12} className="text-amber-700" /> : <StatusIcon size={12} />}
                                {lead.deal_type === 'rent' ? 'จองเช่า (รอทำสัญญา)' : statusCfg.label}
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
                              <div className="flex items-center gap-2">
                                <input 
                                  type="date"
                                  value={lead.expectedTransferDate || ''}
                                  disabled={savingForecasts.includes(lead.id)}
                                  onChange={(e) => handleUpdateTransferDate(lead.id, e.target.value)}
                                  className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-700 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 bg-white shadow-sm disabled:opacity-50 cursor-pointer"
                                />
                                {savingForecasts.includes(lead.id) && (
                                  <span className="text-xs text-blue-500 animate-pulse font-medium whitespace-nowrap">กำลังบันทึก...</span>
                                )}
                                {lead.deal_type === 'rent' ? (
                                  <button
                                    type="button"
                                    title="ทำสัญญาเช่าจริง"
                                    onClick={() => {
                                      setShowRentalModal({
                                        isOpen: true,
                                        lead: lead,
                                        plotId: lead.plot || null,
                                        defaultMode: 'contract'
                                      });
                                    }}
                                    className="px-2.5 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-lg text-xs font-bold flex items-center gap-1 shadow-2xs transition-colors shrink-0 cursor-pointer"
                                  >
                                    <FileText size={12} />
                                    <span>ทำสัญญาเช่า</span>
                                  </button>
                                ) : (user?.role === 'Admin' || user?.role === 'Owner') ? (
                                  <button
                                    type="button"
                                    title="เปลี่ยนเป็นสัญญาเช่า (Admin Mode)"
                                    onClick={() => {
                                      setShowRentalModal({
                                        isOpen: true,
                                        lead: lead,
                                        plotId: lead.plot || null,
                                        defaultMode: 'contract'
                                      });
                                    }}
                                    className="px-2.5 py-1.5 bg-teal-50 hover:bg-teal-100 text-teal-700 border border-teal-200 rounded-lg text-xs font-bold flex items-center gap-1 shadow-2xs transition-colors shrink-0 cursor-pointer"
                                  >
                                    <Key size={12} />
                                    <span>เปลี่ยนเป็นเช่า</span>
                                  </button>
                                ) : null}
                              </div>
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

            {/* RENTED TAB */}
            {activeTab === 'rented' && (
              <div className="h-full flex flex-col overflow-hidden animate-in fade-in slide-in-from-bottom-2">
                <div className="overflow-y-auto flex-1 p-0 custom-scrollbar">
                  <table className="w-full text-left border-collapse">
                    <thead className="bg-slate-50 sticky top-0 z-10 border-b border-slate-200">
                      <tr>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">รหัสแปลง (Plot)</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">ลูกค้าผู้เช่า (Customer)</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">สถานะ (Status)</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">โปรแกรมเช่า (Program)</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">ค่าเช่า / เงินประกัน (Rent & Deposit)</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">ระยะเวลาสัญญา (Lease Period)</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">จัดการ (Actions)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {rentedLeads.map(lead => {
                        const badge = getRentalBadge(lead);
                        const BadgeIcon = badge.icon;
                        const plotName = projectPlotsData.find(p => p.id === lead.plot)?.plot_name || lead.plot;
                        const programInfo = lead.rental_program ? ((RENTAL_PROGRAM_DETAILS as any)[lead.rental_program] || null) : null;
                        
                        return (
                          <tr key={lead.id} className="hover:bg-slate-50 transition-colors group cursor-pointer" onClick={() => handleEditLeadClick(lead)}>
                            <td className="px-6 py-4">
                              <span className="font-bold text-[#0f172a] bg-gray-100 px-2 py-1 rounded-md text-sm">{plotName || '-'}</span>
                            </td>
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-teal-50 flex items-center justify-center text-teal-700 font-bold border border-teal-200">
                                  {lead.name?.charAt(0) || <Key size={16} />}
                                </div>
                                <div>
                                  <div className="font-semibold text-slate-800 flex items-center gap-1.5 flex-wrap">
                                    <span>{lead.name}</span>
                                    <span className="px-1.5 py-0.2 rounded-md bg-teal-100 text-teal-900 font-bold text-[10px] border border-teal-300">
                                      🔑 เช่า
                                    </span>
                                  </div>
                                  <div className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                                    {formatPhoneNumber(lead.phone)}
                                    {lead.agentName && <span className="ml-2 px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded flex items-center gap-1 border border-blue-100"><User size={8} /> {lead.agentName}</span>}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold ${badge.bg} ${badge.color} border ${badge.border} shadow-2xs`}>
                                <BadgeIcon size={12} />
                                <span>{badge.label}</span>
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              {programInfo ? (
                                <div className="flex flex-col">
                                  <span className="font-semibold text-slate-700 text-xs">
                                    {programInfo.label}
                                  </span>
                                  {lead.rental_savings_per_month && Number(lead.rental_savings_per_month) > 0 ? (
                                    <span className="text-[11px] text-teal-600 font-medium">
                                      (ออม ฿{Number(lead.rental_savings_per_month).toLocaleString()}/ด.)
                                    </span>
                                  ) : null}
                                </div>
                              ) : (
                                <span className="text-xs text-slate-600 font-medium">
                                  {lead.rental_program || 'สัญญาเช่าทั่วไป'}
                                </span>
                              )}
                            </td>
                            <td className="px-6 py-4">
                              <div className="flex flex-col gap-0.5">
                                {lead.rental_monthly_rent ? (
                                  <div className="text-xs font-bold text-teal-700">
                                    ค่าเช่า: ฿{Number(lead.rental_monthly_rent).toLocaleString()} / ด.
                                  </div>
                                ) : (
                                  <div className="text-xs text-gray-400">ค่าเช่า: -</div>
                                )}
                                {lead.rental_deposit ? (
                                  <div className="text-[11px] text-slate-500">
                                    ประกัน: ฿{Number(lead.rental_deposit).toLocaleString()}
                                  </div>
                                ) : lead.booking_amount ? (
                                  <div className="text-[11px] text-amber-700 font-medium">
                                    เงินจอง: ฿{Number(lead.booking_amount).toLocaleString()}
                                  </div>
                                ) : null}
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              <div className="flex flex-col gap-0.5 text-xs text-slate-700">
                                {lead.rental_start_date || lead.rental_end_date ? (
                                  <div className="flex items-center gap-1 font-medium text-slate-800">
                                    <Calendar size={12} className="text-slate-400 shrink-0" />
                                    <span>{lead.rental_start_date || '-'} ถึง {lead.rental_end_date || '-'}</span>
                                  </div>
                                ) : lead.bookingDate ? (
                                  <div className="text-xs text-slate-500">
                                    วันที่จอง: {lead.bookingDate}
                                  </div>
                                ) : (
                                  <span className="text-gray-400">-</span>
                                )}
                              </div>
                            </td>
                            <td className="px-6 py-4 text-right" onClick={(e) => e.stopPropagation()}>
                              <div className="flex items-center justify-end gap-1.5 flex-wrap">
                                {lead.rental_status === 'PendingContract' || lead.status === 'Reserved' ? (
                                  <button
                                    type="button"
                                    title="ทำสัญญาเช่าจริง"
                                    onClick={() => {
                                      setShowRentalModal({
                                        isOpen: true,
                                        lead: lead,
                                        plotId: lead.plot || null,
                                        defaultMode: 'contract'
                                      });
                                    }}
                                    className="px-2.5 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-lg text-xs font-bold flex items-center gap-1 shadow-2xs transition-colors shrink-0 cursor-pointer"
                                  >
                                    <FileText size={12} />
                                    <span>ทำสัญญาเช่า</span>
                                  </button>
                                ) : (
                                  <>
                                    <button
                                      type="button"
                                      title="จัดการสัญญาเช่า (เปลี่ยนเป็นซื้อ / ต่อสัญญา / สิ้นสุดสัญญา)"
                                      onClick={() => {
                                        const plotObj = projectPlotsData.find(p => p.id === lead.plot) || { id: lead.plot, plot_name: lead.plotName };
                                        setShowRentalActionModal({
                                          isOpen: true,
                                          lead: lead,
                                          plot: plotObj
                                        });
                                      }}
                                      className="px-2.5 py-1.5 bg-teal-50 hover:bg-teal-100 text-teal-700 border border-teal-200 rounded-lg text-xs font-bold flex items-center gap-1 shadow-2xs transition-colors shrink-0 cursor-pointer"
                                    >
                                      <Key size={12} />
                                      <span>จัดการสัญญา</span>
                                    </button>
                                    <button
                                      type="button"
                                      title="บันทึก / ดูประวัติการชำระค่าเช่า"
                                      onClick={() => {
                                        const plotObj = projectPlotsData.find(p => p.id === lead.plot) || { id: lead.plot, plot_name: lead.plotName };
                                        setShowRentalPaymentModal({
                                          isOpen: true,
                                          lead: lead,
                                          plot: plotObj
                                        });
                                      }}
                                      className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 rounded-lg text-xs font-semibold flex items-center gap-1 shadow-2xs transition-colors shrink-0 cursor-pointer"
                                    >
                                      <CreditCard size={13} />
                                    </button>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                      {rentedLeads.length === 0 && (
                        <tr>
                          <td colSpan={7} className="px-6 py-12 text-center text-gray-500">
                            ไม่พบข้อมูลลูกค้าที่เช่า
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
                        const transferredDate = customerActualTransferDay(lead) || '-';
                        
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
                        disabled={!canCreateBooking(selectedPlotLead)}
                        onClick={() => {
                          if (!canCreateBooking(selectedPlotLead)) return;
                          setShowBookingModal({
                            isOpen: true,
                            lead: selectedPlotLead,
                            plotId: panelState.plotId
                          });
                        }}
                        className="w-full bg-gradient-to-r from-orange-500 to-amber-600 hover:from-orange-600 hover:to-amber-700 text-white font-bold py-2.5 px-3 rounded-xl text-xs flex items-center justify-center gap-1.5 shadow-sm shadow-orange-500/20 cursor-pointer transition-all disabled:opacity-50 disabled:cursor-not-allowed"
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
                      canCreateBooking(l)
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
                                      setSelectedPlotLead(lead);
                                    }}
                                    className="bg-orange-600 hover:bg-orange-700 text-white font-bold text-[11px] px-2.5 py-1.5 rounded-lg shadow-sm flex items-center gap-1 cursor-pointer transition-colors"
                                  >
                                    เลือกลูกค้ารายนี้
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
                    <button disabled={isSubmitting} onClick={() => setPanelState({ type: 'default', plotId: '', lead: null })} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
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

              {panelState.type === 'customer' && panelState.lead && (() => {
                // Keep the right-hand form; only its data/save binding shares the Lead editor.
                const panelForm = editCustomerForm;
                const updatePanelForm = setEditCustomerForm;
                const submitPanelForm = handleUpdateCustomer;
                const panelSubmitting = isSubmitting;
                const panelStatuses = getNextStatuses;
                const renderPanel = (editor?: SalesDealEditorModel) => {
                  const editCustomerForm = editor ? { ...panelForm, name: editor.draft.name, phone: editor.draft.phone,
                    occupation: editor.draft.occupation, agentName: editor.draft.agentName || '',
                    salePrice: editor.draft.price, landOfficePrice: editor.draft.landOfficePrice || '',
                    bank: editor.draft.bank, status: stageToKanbanStatus(editor.target),
                    cancelReason: editor.reason, transactionDate: editor.eventDate, note: editor.note } : panelForm;
                  const setEditCustomerForm = (form: typeof panelForm) => {
                    if (!editor) { updatePanelForm(form); return; }
                    // Changing the plot is outside this customer/status save command.
                    if (form.plot !== panelForm.plot) { updatePanelForm(form); return; }
                    editor.setDraft({ ...editor.draft, name: form.name, phone: form.phone, occupation: form.occupation,
                      agentName: form.agentName, price: form.salePrice, landOfficePrice: form.landOfficePrice,
                      bank: form.bank, method: form.bank === editor.draft.bank ? editor.draft.method : form.bank === 'ซื้อเงินสด' ? 'cash' : 'mortgage' });
                    editor.setTarget(kanbanStatusToStage(form.status)); editor.setReason(form.cancelReason);
                    editor.setEventDate(form.transactionDate); editor.setNote(form.note);
                  };
                  const handleUpdateCustomer = async (event: React.FormEvent) => {
                    if (!editor) { await submitPanelForm(event); return; }
                    event.preventDefault();
                    if (editCustomerForm.plot !== (panelState.lead.plot || '')) {
                      alert('การบันทึกข้อมูลลูกค้าไม่ย้ายแปลง กรุณาเลือกแปลงปัจจุบันก่อนบันทึก'); return;
                    }
                    await editor.save({ confirmedBySubmit: true });
                  };
                  const isSubmitting = editor ? editor.busy : panelSubmitting;
                  const isRentalDeal = Boolean(
                    panelState.lead?.deal_type === 'rent' ||
                    panelState.lead?.rental_status === 'Active' ||
                    panelState.lead?.rental_status === 'PendingContract' ||
                    panelState.lead?.status === 'Rented' ||
                    String(panelState.lead?.crm_status || '').includes('เช่า')
                  );
                  const rentalProgramLabel = panelState.lead?.rental_program === 'program_b'
                    ? 'เช่าออม (แบบ B)'
                    : panelState.lead?.rental_program === 'program_c'
                    ? 'เช่าการันตีซื้อ (แบบ C)'
                    : 'เช่าปกติ (แบบ A)';

                  return (
                <div className="flex flex-col h-full animate-in fade-in duration-300">
                  <div className="flex justify-between items-center mb-6">
                    <h3 className="font-bold text-lg text-slate-800 flex items-center gap-2">
                      <UserCheck className="text-[#d4af37]" /> ข้อมูลลูกค้า
                    </h3>
                    <button onClick={() => setPanelState({ type: 'default', plotId: '', lead: null })} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
                  </div>
                  
                  {editor?.loading && <p role="status" className="text-xs text-slate-500">กำลังโหลดข้อมูลล่าสุด…</p>}
                  {editor?.conflictNotice && (
                    <div role="alert" className="p-3 bg-amber-50 border border-amber-300 rounded-xl text-xs text-amber-900 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-1.5 font-medium">
                        <span className="shrink-0">⚠️</span>
                        <span>{editor.conflictNotice}</span>
                      </div>
                      <button
                        type="button"
                        onClick={editor.resolveConflict}
                        className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-lg text-xs shrink-0 cursor-pointer shadow-sm transition-colors"
                      >
                        ยอมรับสถานะใหม่และปรับปรุงตัวเลือก
                      </button>
                    </div>
                  )}
                  {editor?.error && <p role="alert" className="text-sm text-red-700">{editor.error}</p>}
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
                        aria-label="ชื่อลูกค้า" disabled={Boolean(editor && (editor.locked || !editor.resolved?.leadId))}
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
                        aria-label="วันที่ทำรายการ" disabled={editor?.locked}
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
                          aria-label="เบอร์โทรศัพท์" disabled={Boolean(editor && (editor.locked || !editor.resolved?.leadId))}
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
                          aria-label="อาชีพ" disabled={Boolean(editor && (editor.locked || !editor.resolved?.leadId))}
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
                          aria-label="พนักงานขาย" disabled={Boolean(editor && (editor.locked || !editor.resolved?.leadId))}
                          value={editCustomerForm.agentName} 
                          onChange={e => setEditCustomerForm({...editCustomerForm, agentName: e.target.value})}
                          className="w-full border border-slate-200 rounded-xl px-4 py-2 focus:outline-none focus:border-[#d4af37] text-sm" 
                        />
                      </div>
                    </div>

                    <div className="pt-2 border-t border-slate-100">
                      <div className="flex items-center justify-between mb-2">
                        <label className="block text-sm font-semibold text-slate-700">
                          {isRentalDeal ? 'อัปเดตสถานะการเช่า (Rental Workflow)' : 'อัปเดตสถานะการขาย (Guided Workflow)'}
                        </label>
                        {isRentalDeal && (
                          <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                            {rentalProgramLabel}
                          </span>
                        )}
                      </div>
                      
                      {isRentalDeal ? (
                        <div className="space-y-3 mb-4">
                          {/* 1. Status Workflow Buttons for Rental */}
                          <div className="flex flex-wrap gap-2">
                            {panelState.lead?.status !== 'Rented' ? (
                              <>
                                <button
                                  type="button"
                                  disabled={editor?.locked}
                                  onClick={() => setEditCustomerForm({ ...editCustomerForm, status: 'Reserved' })}
                                  className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold border transition-all ${
                                    editCustomerForm.status === 'Reserved'
                                      ? 'bg-amber-500 text-white border-amber-600 shadow-md'
                                      : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                                  }`}
                                >
                                  <Home size={14} className={editCustomerForm.status === 'Reserved' ? 'text-white' : 'text-amber-500'} />
                                  จองเช่าแล้ว
                                </button>

                                <button
                                  type="button"
                                  onClick={() => {
                                    setShowRentalModal({
                                      isOpen: true,
                                      lead: panelState.lead,
                                      plotId: panelState.lead.plot || panelState.plotId || null,
                                      defaultMode: 'contract'
                                    });
                                  }}
                                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-bold bg-gradient-to-r from-blue-600 to-indigo-700 hover:from-blue-700 hover:to-indigo-800 text-white shadow-md shadow-blue-500/20 cursor-pointer transition-all"
                                >
                                  <FileText size={14} /> ทำสัญญาเช่าจริง
                                </button>

                                <button
                                  type="button"
                                  disabled={editor?.locked}
                                  onClick={() => setEditCustomerForm({ ...editCustomerForm, status: 'Cancelled' })}
                                  className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold border transition-all ${
                                    editCustomerForm.status === 'Cancelled'
                                      ? 'bg-rose-600 text-white border-rose-700 shadow-md'
                                      : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50 hover:text-rose-600'
                                  }`}
                                >
                                  <XCircle size={14} className={editCustomerForm.status === 'Cancelled' ? 'text-white' : 'text-rose-500'} />
                                  ยกเลิกจอง
                                </button>
                              </>
                            ) : (
                              <>
                                <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-bold bg-blue-600 text-white shadow-sm">
                                  <Key size={14} /> สัญญาเช่า (Active)
                                </div>

                                <button
                                  type="button"
                                  onClick={() => {
                                    setShowRentalActionModal({
                                      isOpen: true,
                                      lead: panelState.lead,
                                      plot: panelState.plotId || panelState.lead.plot
                                    });
                                  }}
                                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-bold bg-gradient-to-r from-cyan-700 to-blue-800 hover:from-cyan-800 hover:to-blue-900 text-white shadow-sm cursor-pointer transition-all"
                                >
                                  <Key size={14} /> จัดการสัญญาเช่า
                                </button>

                                <button
                                  type="button"
                                  onClick={() => {
                                    setShowRentalPaymentModal({
                                      isOpen: true,
                                      lead: panelState.lead,
                                      plot: plotInfo || (panelState.plotId || panelState.lead.plot ? { id: panelState.plotId || panelState.lead.plot } : null)
                                    });
                                  }}
                                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm cursor-pointer transition-all"
                                >
                                  <Banknote size={14} /> ตารางค่างวด
                                </button>
                              </>
                            )}
                          </div>

                          {/* 2. Rental Summary Card */}
                          <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-3.5 space-y-2">
                            <div className="flex justify-between items-center text-xs">
                              <span className="text-slate-500 font-medium">โปรแกรมเช่า:</span>
                              <span className="font-bold text-slate-800">{rentalProgramLabel}</span>
                            </div>
                            <div className="flex justify-between items-center text-xs">
                              <span className="text-slate-500 font-medium">ค่าเช่ารายเดือน:</span>
                              <span className="font-bold text-blue-700 text-sm">
                                {panelState.lead?.rental_monthly_rent
                                  ? `฿${Number(panelState.lead.rental_monthly_rent).toLocaleString()} / เดือน`
                                  : 'ตามที่ตกลงในสัญญา'}
                              </span>
                            </div>
                            {panelState.lead?.booking_amount ? (
                              <div className="flex justify-between items-center text-xs">
                                <span className="text-slate-500 font-medium">เงินวางจองเช่า:</span>
                                <span className="font-bold text-amber-700">
                                  ฿{Number(panelState.lead.booking_amount).toLocaleString()}
                                </span>
                              </div>
                            ) : null}
                            {panelState.lead?.rental_start_date ? (
                              <div className="flex justify-between items-center text-xs">
                                <span className="text-slate-500 font-medium">วันเริ่มสัญญา / นัดเข้าอยู่:</span>
                                <span className="font-bold text-slate-700">
                                  {panelState.lead.rental_start_date}
                                </span>
                              </div>
                            ) : null}
                          </div>

                          {/* 3. Reason if Cancelled is selected */}
                          {editCustomerForm.status === 'Cancelled' && (
                            <div className="animate-in slide-in-from-top-2 duration-200">
                              <label className="block text-xs font-semibold text-rose-700 mb-1">เหตุผลที่ยกเลิกจองเช่า</label>
                              <textarea
                                className="w-full border border-rose-200 rounded-xl px-4 py-2.5 focus:outline-none focus:border-rose-500 font-medium text-slate-700 bg-rose-50 text-sm min-h-[80px]"
                                aria-label="เหตุผล"
                                disabled={editor?.locked}
                                value={editCustomerForm.cancelReason}
                                onChange={e => setEditCustomerForm({ ...editCustomerForm, cancelReason: e.target.value })}
                                placeholder="ระบุเหตุผลในการยกเลิกจอง..."
                                required
                              />
                            </div>
                          )}

                          {/* 4. Plot dropdown */}
                          {editCustomerForm.status !== 'Cancelled' && (
                            <div>
                              <label className="block text-xs font-semibold text-emerald-700 mb-1">แปลงที่จอง/เช่า</label>
                              <select
                                className="w-full border border-emerald-300 rounded-xl px-4 py-2.5 focus:outline-none focus:border-emerald-500 font-bold text-emerald-800 bg-emerald-50 text-sm"
                                aria-label="แปลงที่จอง"
                                disabled={editor?.locked}
                                value={editCustomerForm.plot}
                                onChange={e => setEditCustomerForm({ ...editCustomerForm, plot: e.target.value })}
                                required
                              >
                                <option value="" disabled>-- กรุณาเลือกแปลง --</option>
                                {panelState.lead.plot && <option value={panelState.lead.plot}>{panelState.lead.plot} (แปลงปัจจุบัน)</option>}
                                {availablePlots.map(p => (
                                  <option key={p} value={p}>{p} (ว่าง)</option>
                                ))}
                              </select>
                            </div>
                          )}
                        </div>
                      ) : (
                        <>
                          <div className="flex flex-wrap gap-2 mb-4">
                            {Array.from(new Set(
                              editor?.choices
                                ? editor.choices.map(stageToKanbanStatus)
                                : getNextStatuses(panelState.lead?.status)
                            )).filter(s => Boolean(STATUS_CONFIG[s])).map(s => {
                              const config = STATUS_CONFIG[s] || STATUS_CONFIG['legacy_unclassified'] || {
                                label: s || 'ไม่ระบุ',
                                color: 'text-slate-600',
                                bg: 'bg-slate-100',
                                icon: Users
                              };
                              const Icon = config.icon || Users;
                              const isSelected = editCustomerForm.status === s;
                              return (
                                <button 
                                  key={s} 
                                  aria-pressed={isSelected}
                                  disabled={editor?.locked}
                                  type="button"
                                  onClick={() => {
                                    const plot = (projectPlotsData || []).find(p => p.id === editCustomerForm.plot || p.id === panelState.lead?.plot);
                                    const fallbackAppraisal = plot?.land_appraisal_price ? String(plot.land_appraisal_price) : '';
                                    const autoPrice = (['Approved', 'Transferred', 'Handover'].includes(s) && !editCustomerForm.landOfficePrice)
                                      ? (panelState.lead?.landOfficePrice || fallbackAppraisal || '')
                                      : editCustomerForm.landOfficePrice;
                                    setEditCustomerForm({ ...editCustomerForm, status: s, landOfficePrice: autoPrice });
                                  }}
                                  className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold border transition-all ${isSelected ? 'bg-[#0f172a] text-white border-[#0f172a] shadow-md' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400 hover:bg-slate-50'}`}
                                >
                                  <Icon size={14} className={isSelected ? 'text-white' : (config.color || 'text-slate-600')} />
                                  {config.label || s}
                                </button>
                              );
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
                                  aria-label="ธนาคาร" disabled={editor?.locked}
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
                                  aria-label="ราคาขายสุทธิ" disabled={editor?.locked}
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
                                    aria-label="ราคาประเมิน" disabled={editor?.locked}
                                    value={editCustomerForm.landOfficePrice || ''}
                                    onChange={e => setEditCustomerForm({...editCustomerForm, landOfficePrice: e.target.value})}
                                    placeholder="เช่น 3500000"
                                    required
                                  />
                                </div>
                              )}
                            </div>
                          )}

                          {['Cancelled', 'LoanRejected'].includes(editCustomerForm.status) && (
                            <div className="mb-3 animate-in slide-in-from-top-2 duration-200">
                              <label className="block text-xs font-semibold text-red-700 mb-1">{editCustomerForm.status === 'Cancelled' ? 'เหตุผลที่ยกเลิกจอง' : 'เหตุผลที่สินเชื่อไม่ผ่าน'}</label>
                              <textarea 
                                className="w-full border border-red-200 rounded-xl px-4 py-2.5 focus:outline-none focus:border-red-500 font-medium text-slate-700 bg-red-50 text-sm min-h-[80px]"
                                aria-label="เหตุผล" disabled={editor?.locked}
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
                                aria-label="หมายเหตุสถานะ" disabled={editor?.locked}
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
                                aria-label="แปลงที่จอง" disabled={editor?.locked}
                                value={editCustomerForm.plot}
                                onChange={e => setEditCustomerForm({...editCustomerForm, plot: e.target.value})}
                                required
                              >
                                <option value="" disabled>-- กรุณาเลือกแปลง --</option>
                                {panelState.lead.plot && <option value={panelState.lead.plot}>{panelState.lead.plot} (แปลงปัจจุบัน)</option>}
                                {availablePlots.map(p => (
                                  <option key={p} value={p}>{p} (ว่าง)</option>
                                ))}
                              </select>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                    
                    <div className="pt-2 flex flex-col gap-2">
                      <button type="submit" disabled={editor ? !editor.canSave : isSubmitting} className={`w-full text-white font-bold py-3 rounded-xl transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 ${editCustomerForm.status === 'Cancelled' ? 'bg-red-600 hover:bg-red-700' : 'bg-[#0f172a] hover:bg-[#1e293b]'}`}>
                        {isSubmitting ? <><Loader2 className="animate-spin" size={18} /> กำลังบันทึก...</> : 'บันทึกการเปลี่ยนแปลง'}
                      </button>
                      <button type="button" disabled={isSubmitting} onClick={() => setPanelState({ type: 'default', plotId: '', lead: null })} className="w-full bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold py-3 rounded-xl transition-colors">
                        ปิดหน้าต่าง
                      </button>
                      {!isRentalDeal && (user?.role === 'Admin' || user?.role === 'Owner') && panelState.lead?.status !== 'Rented' && (
                        <button
                          type="button"
                          disabled={isSubmitting}
                          onClick={() => {
                            setShowRentalModal({
                              isOpen: true,
                              lead: panelState.lead,
                              plotId: panelState.lead.plot || panelState.plotId || null,
                              defaultMode: 'contract'
                            });
                          }}
                          className="w-full bg-gradient-to-r from-teal-600 to-cyan-700 hover:from-teal-700 hover:to-cyan-800 text-white font-bold py-3 rounded-xl transition-all shadow-sm flex items-center justify-center gap-2 mt-1 cursor-pointer text-xs"
                        >
                          <Key size={16} /> 🔑 เปลี่ยนเป็นสัญญาเช่า (Admin Mode)
                        </button>
                      )}
                      {user?.role === 'Admin' && (
                        <button type="button" disabled={isSubmitting || Boolean(editor && !editor.resolved?.leadId)} onClick={() => handleDeleteCustomer(editor?.resolved?.leadId || panelState.lead.id)} className="w-full bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 hover:text-red-700 font-bold py-3 rounded-xl transition-colors mt-2 flex items-center justify-center gap-2">
                          <Trash2 size={18} /> ลบข้อมูลลูกค้า
                        </button>
                      )}
                    </div>
                  </form>
                  
                  {/* Timeline History */}
                  {(timeline.length > 0 || (statusHistory.scope === historyScope && (statusHistory.loading || statusHistory.error))) && (
                    <div aria-label="ประวัติสถานะ" className="mt-8 pt-6 border-t border-slate-200">
                      <h4 className="font-bold text-slate-800 text-sm mb-4 flex items-center gap-2">
                        <Clock size={16} className="text-slate-500" /> ประวัติสถานะ (Timeline)
                      </h4>
                      {statusHistory.scope === historyScope && statusHistory.loading && <p role="status" className="text-xs text-slate-500 mb-3">กำลังโหลดประวัติสถานะ…</p>}
                      {statusHistory.scope === historyScope && statusHistory.error && <p role="alert" className="text-xs text-red-700 mb-3">{statusHistory.error} <button type="button" className="underline" onClick={() => setHistoryRetry(value => value + 1)}>ลองใหม่</button></p>}
                      <div className="space-y-4">
                        {timeline.map((h, i) => {
                          const config = STATUS_CONFIG[h.status] || STATUS_CONFIG['legacy_unclassified'];
                          const Icon = config.icon;
                          const bDay = customerBusinessDay(h.timestamp);
                          let dateStr = '';
                          if (bDay) {
                            const [year, month, day] = bDay.split('-').map(Number);
                            const thaiYear = (year + 543) % 100;
                            const thaiMonths = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
                            dateStr = `${day} ${thaiMonths[month - 1]} ${thaiYear}`;
                          } else {
                            const dateObj = new Date(h.timestamp);
                            dateStr = dateObj.toLocaleDateString('th-TH', { year: '2-digit', month: 'short', day: 'numeric' });
                          }
                          const isDateOnly = typeof h.timestamp === 'string' && (/^\d{4}-\d{2}-\d{2}$/.test(h.timestamp) || h.timestamp.includes('T00:00:00') || h.timestamp.includes('T12:00:00'));
                          const timeStr = isDateOnly ? '' : new Date(h.timestamp).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
                          
                          return (
                            <div key={h.id || `milestone-${i}`} className="flex gap-3 relative">
                              {i !== timeline.length - 1 && (
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
                                  <span className="text-[10px] text-slate-400 font-medium bg-slate-50 px-2 py-0.5 rounded-full">{timeStr ? `${dateStr} ${timeStr}` : dateStr}</span>
                                </div>
                                <p className="text-xs text-slate-500 font-medium mt-1">ผู้ทำรายการ: {h.note || panelState.lead?.agentName || panelState.lead?.agent_name || 'System'}</p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
                  );
                };
                const isRentalDeal = Boolean(
                  panelState.lead?.deal_type === 'rent' ||
                  panelState.lead?.rental_status === 'Active' ||
                  panelState.lead?.rental_status === 'PendingContract' ||
                  panelState.lead?.status === 'Rented' ||
                  String(panelState.lead?.crm_status || '').includes('เช่า')
                );
                return (!isRentalDeal && ['booked', 'transferred', 'loan'].includes(getLeadStage(panelState.lead))) ? <SalesDealStatusModal
                  lead={panelState.lead} currentUser={user}
                  onClose={() => setPanelState({ type: 'default', plotId: '', lead: null })}
                  onSaved={async notice => {
                    const savedScope = currentDataScope.current;
                    setPanelState({ type: 'default', plotId: '', lead: null });
                    await fetchData();
                    if (currentDataScope.current === savedScope) alert(notice);
                  }}
                  renderEditor={renderPanel}
                /> : renderPanel();
              })()}
            </div>
          </div>
        )}
      </div>
    </div>

      {/* 🌟 Full Screen Image Modal 🌟 */}
      {fullImageUrl && (
        <SalesOverlay className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-sm flex items-center justify-center p-4 sm:p-8 animate-in fade-in duration-200" onClick={() => setFullImageUrl(null)}>
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
        </SalesOverlay>
      )}
      {/* 🌟 Excel Import Modal 🌟 */}
      {showImportModal && (
        <SalesOverlay className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
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
        </SalesOverlay>
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
            notes: showBookingModal.lead.notes,
            status: showBookingModal.lead.status,
            crm_status: showBookingModal.lead.crm_status,
            booking_date: showBookingModal.lead.booking_date,
            transferred_date: showBookingModal.lead.transferred_date
          } : null}
          initialInterest={{
            projectName: project?.name,
            plotId: showBookingModal.plotId || panelState.plotId
          }}
          projects={projects?.map(p => p.name) || [project?.name || 'ไอลิน6']}
          salesOwners={bookingSalesOwners}
          currentUser={user}
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
          defaultMode={showRentalModal.defaultMode}
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
