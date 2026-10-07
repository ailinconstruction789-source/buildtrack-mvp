'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { 
  User, Phone, MapPin, Calendar, Clock, ChevronRight, X, Sparkles, 
  Building, BookmarkCheck, FileText, ExternalLink, Filter, Search, 
  CheckCircle2, RefreshCw, Tag, AlertCircle, History, ArrowRight, Key,
  Plus, LayoutGrid, Table, PhoneCall, CalendarDays, CheckSquare, 
  TrendingUp, DollarSign, ShieldAlert, Award, ChevronDown, Check,
  Edit3, Trash2, ArrowUpRight, MessageSquare, AlertTriangle, Loader2, Save,
  Home, CheckCircle
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import CentralLeadBookingModal from './CentralLeadBookingModal';
import CentralLeadFollowUpModal from './CentralLeadFollowUpModal';
import CentralVisitAppointmentModal from './CentralVisitAppointmentModal';
import RentalContractModal from './RentalContractModal';
import RentalActionModal from './RentalActionModal';
import AdminCustomerImportExportModal from './AdminCustomerImportExportModal';
import type { Lead, CRMStatus } from '@/types/sales';

interface Props {
  currentUser?: {
    userId?: string;
    id?: string;
    username?: string;
    displayName?: string;
    name?: string;
    role?: string;
  } | null;
  projects?: any[];
  plots?: any[];
  onBack?: () => void;
}

const STAGES = [
  { id: 'all', label: 'ทั้งหมด', color: 'bg-slate-100 text-slate-700' },
  { id: 'active', label: '🔥 กำลังติดตาม / สนใจ', color: 'bg-blue-50 text-blue-700 border-blue-200' },
  { id: 'appointment', label: '📅 นัดชมโครงการ', color: 'bg-purple-50 text-purple-700 border-purple-200' },
  { id: 'loan', label: '🏦 เช็คเครดิต / ยื่นกู้', color: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  { id: 'booked', label: '🏷️ วางจองแล้ว', color: 'bg-amber-50 text-amber-700 border-amber-200' },
  { id: 'transferred', label: '🏡 โอนกรรมสิทธิ์แล้ว', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  { id: 'rented', label: '🔑 สัญญาเช่า / เช่าออม', color: 'bg-teal-50 text-teal-700 border-teal-200' },
  { id: 'lost', label: '❌ ยุติการซื้อ', color: 'bg-rose-50 text-rose-700 border-rose-200' }
];

export default function MySalesWorkspace({
  currentUser,
  projects = [],
  plots = [],
  onBack
}: Props) {
  // 👤 User identity determination
  const myUsername = currentUser?.username || '';
  const myDisplayName = currentUser?.displayName || currentUser?.name || currentUser?.username || 'พนักงานขาย';
  const myUserId = currentUser?.userId || currentUser?.id || '';

  // 🎛️ Navigation & Filter States
  const [scopeMode, setScopeMode] = useState<'my_leads' | 'all_leads'>('my_leads');
  const [viewMode, setViewMode] = useState<'table' | 'kanban'>('table');
  const [selectedYear, setSelectedYear] = useState<string>('2026'); // Default to 2026 (ปีปัจจุบัน)
  const [selectedProject, setSelectedProject] = useState<string>('all');
  const [selectedStage, setSelectedStage] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // 📦 Data State
  const [leads, setLeads] = useState<any[]>([]);
  const [dbPlots, setDbPlots] = useState<any[]>(plots || []);
  const [salesOwners, setSalesOwners] = useState<{ userId: string; displayName: string }[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // 🪟 Modals State
  const [showAddLeadModal, setShowAddLeadModal] = useState(false);
  const [showAdminDataModal, setShowAdminDataModal] = useState(false);
  const [bookingTarget, setBookingTarget] = useState<any | null>(null);
  const [followUpTarget, setFollowUpTarget] = useState<any | null>(null);
  const [appointmentTarget, setAppointmentTarget] = useState<any | null>(null);
  const [rentalTarget, setRentalTarget] = useState<any | null>(null);
  const [rentalActionTarget, setRentalActionTarget] = useState<any | null>(null);

  // 🛡️ Admin Role Check
  const isAdmin = ['admin', 'owner', 'superadmin', 'manager'].includes((currentUser?.role || '').toLowerCase());

  // 📝 New Lead Form State
  const [newCustomerName, setNewCustomerName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newProject, setNewProject] = useState('');
  const [newPlotName, setNewPlotName] = useState('');
  const [newChannel, setNewChannel] = useState('Facebook');
  const [newNotes, setNewNotes] = useState('');
  const [isSavingLead, setIsSavingLead] = useState(false);

  // Project names list
  const projectNames = useMemo(() => {
    const list = projects.map(p => typeof p === 'string' ? p : p.name || p.project_name).filter(Boolean);
    return Array.from(new Set(list));
  }, [projects]);

  // Set default project for new lead
  useEffect(() => {
    if (projectNames.length > 0 && !newProject) {
      setNewProject(projectNames[0]);
    }
  }, [projectNames, newProject]);

  // Helper: extract year of an item
  const getItemYear = useCallback((item: any): number => {
    if (!item) return 2026;
    // 1. Transferred date
    const transDate = item.transferred_date || item.transferredAt || item.importedHistory?.transferredDate;
    if (transDate) {
      const d = new Date(transDate);
      if (!isNaN(d.getTime())) return d.getFullYear();
    }
    // 2. Booking date
    const bookDate = item.booking_date || item.bookedAt || item.importedHistory?.bookedDate;
    if (bookDate) {
      const d = new Date(bookDate);
      if (!isNaN(d.getTime())) return d.getFullYear();
    }
    // 3. Appointment date
    if (item.appointment_date) {
      const d = new Date(item.appointment_date);
      if (!isNaN(d.getTime())) return d.getFullYear();
    }
    // 4. Created / Updated date
    const createDate = item.lead_date || item.created_at || item.updated_at;
    if (createDate) {
      const d = new Date(createDate);
      if (!isNaN(d.getTime())) return d.getFullYear();
    }
    return 2026;
  }, []);

  // Fetch leads, sales, plots, and sales owners
  const fetchData = useCallback(async (isSilent = false) => {
    if (!isSilent) setIsLoading(true);
    else setIsRefreshing(true);

    try {
      // 1. Fetch leads from database
      const { data: leadsData, error: leadsErr } = await supabase
        .from('leads')
        .select('*')
        .order('created_at', { ascending: false });

      if (leadsErr) throw leadsErr;

      // 2. Fetch plots from database if needed
      const { data: plotsData } = await supabase
        .from('plots')
        .select('*, house_types(type_name)');
      
      const combinedPlots = plotsData && plotsData.length > 0 ? plotsData : (plots || []);
      setDbPlots(combinedPlots);

      // 3. Fetch projects list
      const { data: projList } = await supabase
        .from('projects')
        .select('name, is_closed')
        .order('name');

      const projectNamesList = (projList || []).map((p: any) => p.name).filter((n: string) => n && n !== 'ลูกค้าทั่วไป');

      // 4. Fetch sales from crm_v2_project_sales RPC across projects
      let allSalesRows: any[] = [];
      try {
        const salesPromises = projectNamesList.map(async (name: string) => {
          const rows: any[] = [];
          let page = 0;
          let hasMore = true;
          while (hasMore && page < 5) {
            const { data: res, error } = await supabase.rpc('crm_v2_project_sales', {
              p_project_name: name,
              p_tab: 'all',
              p_query: '',
              p_page: page
            });
            if (error) break;
            if (res?.rows) rows.push(...res.rows);
            hasMore = Boolean(res?.hasMore);
            page++;
          }
          return rows;
        });
        const rpcResults = await Promise.all(salesPromises);
        allSalesRows = rpcResults.flat();
      } catch (e) {
        console.warn('RPC crm_v2_project_sales error or not permitted:', e);
      }

      // 5. Fallback: If RPC yielded 0 rows, query direct sales table
      if (allSalesRows.length === 0) {
        const { data: directSales } = await supabase.from('sales').select('*, plots(*)');
        if (directSales && directSales.length > 0) {
          allSalesRows = directSales.map((s: any) => ({
            saleId: s.id,
            customerName: s.customer_name || s.customerName,
            phone: s.phone || '',
            plotId: s.plot_id || s.plots?.id,
            plotName: s.plots?.plot_name || s.plot_id,
            projectName: s.plots?.project_name,
            stage: s.contract_status?.toLowerCase() === 'transferred' ? 'transferred'
              : s.contract_status?.toLowerCase() === 'contracted' ? 'contracted'
              : s.contract_status?.toLowerCase() === 'cancelled' ? 'cancelled'
              : 'booked',
            bookedAt: s.booked_at || s.created_at,
            transferredAt: s.transferred_at,
            cancelledAt: s.cancelled_at,
            ownerName: s.agent_name || s.owner_name,
            salePrice: s.sale_price || s.plots?.selling_price,
            expectedTransferDate: s.expected_transfer_date || s.plots?.expected_transfer_date
          }));
        }
      }

      // 6. Merge leads with sales and plots
      const mergedLeads: any[] = (leadsData || []).map((l: any) => ({ ...l }));
      const matchedSaleIds = new Set<string>();

      mergedLeads.forEach(lead => {
        // Backfill plot from legacy 'interest' field if empty
        if (!lead.interested_plot_name && lead.interest && lead.interest !== 'Any' && lead.interest !== 'None') {
          const rawInterest = String(lead.interest).trim();
          const hyphenMatch = rawInterest.match(/\-([A-Za-z0-9\/_]+)$/);
          lead.interested_plot_name = hyphenMatch ? hyphenMatch[1].trim() : rawInterest;
        }

        // Adjust display crm_status if status is Reserved / Booked / Transferred
        if ((lead.status === 'Reserved' || lead.status === 'Booked') && (!lead.crm_status || lead.crm_status.includes('Follow-up'))) {
          lead.crm_status = 'วางเงินจองแปลงแล้ว';
        } else if (lead.status === 'Transferred' && (!lead.crm_status || lead.crm_status.includes('Follow-up'))) {
          lead.crm_status = 'โอนกรรมสิทธิ์แล้ว';
        }

        const cleanLeadName = (lead.customer_name || '').toLowerCase().replace(/^(นาย|นาง|นางสาว|คุณ)\s*/, '').trim();
        
        // Find matching sale row
        const matchedSale = allSalesRows.find(s => {
          if (s.leadId && s.leadId === lead.id) return true;
          if (cleanLeadName && s.customerName) {
            const cleanSaleCust = s.customerName.toLowerCase().replace(/^(นาย|นาง|นางสาว|คุณ)\s*/, '').trim();
            const matchProj = !lead.project_name || !s.projectName || lead.project_name === s.projectName;
            return matchProj && (cleanLeadName.includes(cleanSaleCust) || cleanSaleCust.includes(cleanLeadName));
          }
          return false;
        });

        if (matchedSale) {
          matchedSaleIds.add(matchedSale.saleId);
          if (!lead.interested_plot_name && matchedSale.plotName) {
            lead.interested_plot_name = matchedSale.plotName;
          }
          if (!lead.project_name && matchedSale.projectName) {
            lead.project_name = matchedSale.projectName;
          }
          if (!lead.sales_owner && matchedSale.ownerName) {
            lead.sales_owner = matchedSale.ownerName;
          }
          if (matchedSale.bookedAt && !lead.booking_date) {
            lead.booking_date = matchedSale.bookedAt;
          }
          if (matchedSale.transferredAt && !lead.transferred_date) {
            lead.transferred_date = matchedSale.transferredAt;
          }
          if (matchedSale.importedHistory?.transferredDate && !lead.transferred_date) {
            lead.transferred_date = matchedSale.importedHistory.transferredDate;
          }
          if (matchedSale.importedHistory?.bookedDate && !lead.booking_date) {
            lead.booking_date = matchedSale.importedHistory.bookedDate;
          }

          if (matchedSale.stage === 'transferred') {
            lead.status = 'Transferred';
            lead.crm_status = 'โอนกรรมสิทธิ์แล้ว';
          } else if (matchedSale.stage === 'contracted') {
            lead.status = 'Contracted';
            lead.crm_status = 'ทำสัญญาแล้ว';
          } else if (matchedSale.stage === 'booked' && lead.status !== 'Transferred') {
            lead.status = 'Booked';
            lead.crm_status = 'วางเงินจองแปลงแล้ว';
          } else if (matchedSale.stage === 'cancelled') {
            lead.status = 'Cancelled';
            lead.crm_status = 'ยกเลิก / ยุติการซื้อ';
          }
        }

        // Also check matched plots in plotsData (for plot_name, highlight_note, sale_status)
        if (combinedPlots && combinedPlots.length > 0 && cleanLeadName) {
          const matchedPlot = combinedPlots.find((p: any) => {
            const matchProj = !lead.project_name || p.project_name === lead.project_name;
            if (!matchProj) return false;
            const highlight = (p.highlight_note || '').toLowerCase();
            const pTenant = (p.current_tenant_name || '').toLowerCase();
            return highlight.includes(cleanLeadName) || pTenant.includes(cleanLeadName);
          });

          if (matchedPlot) {
            if (!lead.interested_plot_name) lead.interested_plot_name = matchedPlot.plot_name || matchedPlot.id;
            if (matchedPlot.sale_status === 'transferred' && lead.status !== 'Transferred') {
              lead.status = 'Transferred';
              lead.crm_status = 'โอนกรรมสิทธิ์แล้ว';
            }
            if (matchedPlot.current_tenant_name) {
              lead.status = 'Rented';
              lead.crm_status = 'สัญญาเช่า / เช่าออม';
            }
          }
        }
      });

      // 7. Synthesize leads for sales rows that had no prior lead record
      allSalesRows.forEach(s => {
        if (s.customerName && !matchedSaleIds.has(s.saleId)) {
          const cleanSaleCust = s.customerName.toLowerCase().replace(/^(นาย|นาง|นางสาว|คุณ)\s*/, '').trim();
          const exists = mergedLeads.some(l => {
            const lName = (l.customer_name || '').toLowerCase().replace(/^(นาย|นาง|นางสาว|คุณ)\s*/, '').trim();
            return lName && (lName.includes(cleanSaleCust) || cleanSaleCust.includes(lName));
          });

          if (!exists && cleanSaleCust) {
            mergedLeads.push({
              id: s.saleId || `sale-${Math.random().toString(36).slice(2, 7)}`,
              customer_name: s.customerName,
              phone: s.phone || '',
              project_name: s.projectName || '',
              interested_plot_name: s.plotName || s.plotId || '',
              status: s.stage === 'transferred' ? 'Transferred' : s.stage === 'contracted' ? 'Contracted' : s.stage === 'booked' ? 'Booked' : s.stage === 'cancelled' ? 'Cancelled' : 'Active',
              crm_status: s.stage === 'transferred' ? 'โอนกรรมสิทธิ์แล้ว' : s.stage === 'contracted' ? 'ทำสัญญาแล้ว' : s.stage === 'booked' ? 'วางเงินจองแปลงแล้ว' : s.stage === 'cancelled' ? 'ยกเลิกการซื้อ' : 'กำลังติดตาม',
              sales_owner: s.ownerName || 'ทีมขาย',
              created_by_agent: s.ownerName || 'ทีมขาย',
              channel: 'Walk in',
              source: 'CRM Sales Record',
              sale_price: s.salePrice,
              booking_date: s.bookedAt || s.importedHistory?.bookedDate || null,
              transferred_date: s.transferredAt || s.importedHistory?.transferredDate || null,
              created_at: s.bookedAt || s.importedHistory?.bookedDate || s.transferredAt || s.importedHistory?.transferredDate || new Date().toISOString(),
              updated_at: s.transferredAt || s.importedHistory?.transferredDate || s.bookedAt || new Date().toISOString(),
              notes: s.importedHistory ? `[ประวัติการขายเดิม: แถวที่ ${s.importedHistory.sourceRow || '-'}]` : '',
              _isMergedSalesRecord: true
            });
          }
        }
      });

      // 8. Synthesize rentals from plots with current_tenant_name
      if (combinedPlots && combinedPlots.length > 0) {
        combinedPlots.forEach((p: any) => {
          if (p.current_tenant_name) {
            const cleanTenant = p.current_tenant_name.toLowerCase().replace(/^(นาย|นาง|นางสาว|คุณ)\s*/, '').trim();
            const exists = mergedLeads.some(l => {
              const lName = (l.customer_name || '').toLowerCase().replace(/^(นาย|นาง|นางสาว|คุณ)\s*/, '').trim();
              return lName && (lName.includes(cleanTenant) || cleanTenant.includes(lName));
            });
            if (!exists && cleanTenant) {
              mergedLeads.push({
                id: `rental-plot-${p.id}`,
                customer_name: p.current_tenant_name,
                phone: p.current_tenant_phone || '',
                project_name: p.project_name || '',
                interested_plot_name: p.plot_name || p.id,
                status: 'Rented',
                crm_status: 'สัญญาเช่า / เช่าออม',
                sales_owner: 'ทีมขาย',
                created_by_agent: 'ระบบเช่า',
                channel: 'Direct Rental',
                monthly_rent: p.monthly_rent,
                rental_program: p.rental_program,
                created_at: p.lease_start_date || p.created_at || new Date().toISOString(),
                updated_at: p.lease_start_date || p.updated_at || new Date().toISOString()
              });
            }
          }
        });
      }

      setLeads(mergedLeads);

      // 9. Fetch sales owners / app_users
      const { data: usersData } = await supabase
        .from('app_users')
        .select('id, username, display_name, role');

      if (usersData) {
        const salesList = usersData.map(u => ({
          userId: u.id || u.username,
          displayName: u.display_name || u.username
        }));
        setSalesOwners(salesList);
      }
    } catch (err: any) {
      console.error('Error fetching sales workspace data:', err);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [plots]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Notice auto-dismiss
  useEffect(() => {
    if (notice) {
      const timer = setTimeout(() => setNotice(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [notice]);

  // Helper: check if a lead belongs to the current user
  const isMyLead = useCallback((lead: any) => {
    if (!lead) return false;
    const ownerName = lead.sales_owner || lead.salesOwner || lead.agent_name || lead.created_by_agent || '';
    const ownerId = lead.owner_user_id || lead.ownerUserId || '';

    if (myUserId && ownerId && String(ownerId) === String(myUserId)) return true;
    if (myUsername && ownerName.toLowerCase() === myUsername.toLowerCase()) return true;
    if (myDisplayName && ownerName.toLowerCase() === myDisplayName.toLowerCase()) return true;
    return false;
  }, [myUserId, myUsername, myDisplayName]);

  // Helper: extract plot name from lead fields, auto_status, notes, or plots table
  const getLeadPlotName = useCallback((lead: any): string | null => {
    if (!lead) return null;
    // 1. Direct fields
    if (lead.interested_plot_name && String(lead.interested_plot_name).trim()) {
      return String(lead.interested_plot_name).trim();
    }
    if (lead.interested_plot_id && String(lead.interested_plot_id).trim()) {
      return String(lead.interested_plot_id).trim();
    }
    
    // 2. Extract from legacy 'interest' field (e.g. "20", "ไอลิน 6-20", "ไอลิน 4-72", "4")
    if (lead.interest && String(lead.interest).trim() && lead.interest !== 'Any' && lead.interest !== 'None') {
      const rawInterest = String(lead.interest).trim();
      const hyphenMatch = rawInterest.match(/\-([A-Za-z0-9\/_]+)$/);
      return hyphenMatch ? hyphenMatch[1].trim() : rawInterest;
    }

    // 3. Extract from auto_status (e.g. "จองแปลง A01 (ไอลิน 6)")
    if (lead.auto_status) {
      const match = String(lead.auto_status).match(/แปลง\s*([A-Za-z0-9\-/_]+)/i);
      if (match && match[1]) return match[1].trim();
    }

    // 3. Extract from notes (e.g. "• โครงการ: ไอลิน 6 (แปลง A01)" or "แปลง A01")
    if (lead.notes) {
      const match = String(lead.notes).match(/แปลง\s*([A-Za-z0-9\-/_]+)/i);
      if (match && match[1]) return match[1].trim();
    }

    // 4. Match from dbPlots prop
    if (dbPlots && dbPlots.length > 0 && lead.customer_name) {
      const cleanCustomerName = String(lead.customer_name).toLowerCase().replace(/^(นาย|นาง|นางสาว|คุณ)\s*/, '').trim();
      if (cleanCustomerName) {
        const matchedPlot = dbPlots.find((p: any) => {
          const matchProj = !lead.project_name || p.project_name === lead.project_name || p.project === lead.project_name;
          if (!matchProj) return false;
          const highlight = (p.highlight_note || '').toLowerCase();
          const pCust = (p.customer_name || '').toLowerCase();
          const pTenant = (p.current_tenant_name || '').toLowerCase();
          return highlight.includes(cleanCustomerName) || pCust.includes(cleanCustomerName) || pTenant.includes(cleanCustomerName);
        });
        if (matchedPlot) {
          return matchedPlot.plot_name || matchedPlot.plot_number || matchedPlot.id;
        }
      }
    }

    return null;
  }, [dbPlots]);

  // Categorize Lead Stage (Strict Check)
  const getStageCategory = useCallback((lead: any): string => {
    const statusLower = (lead.status || '').toLowerCase().trim();
    const crmLower = (lead.crm_status || '').toLowerCase().trim();
    const notesLower = (lead.notes || '').toLowerCase();

    // 1. Transferred (โอนกรรมสิทธิ์สำเร็จ / โอนแล้ว)
    if (
      statusLower === 'transferred' || statusLower === 'closed_won' ||
      crmLower.includes('โอนกรรมสิทธิ์') || crmLower.includes('โอนแล้ว') ||
      Boolean(lead.transferred_date || lead.transferredAt)
    ) {
      return 'transferred';
    }

    // 2. Rented
    if (
      statusLower.includes('rent') || crmLower.includes('rent') ||
      statusLower.includes('เช่า') || crmLower.includes('เช่า') ||
      notesLower.includes('สัญญาเช่า') || notesLower.includes('ผู้เช่า')
    ) {
      return 'rented';
    }

    // 3. Lost / Cancelled
    if (
      statusLower === 'lost' || statusLower === 'cancelled' ||
      statusLower === 'closed_lost' || statusLower === 'nurture' ||
      statusLower === 'cold' || statusLower === 'unqualified' ||
      statusLower === 'dropped' ||
      crmLower.includes('ยุติการซื้อ') || crmLower.includes('ไม่จอง') ||
      crmLower.includes('ยกเลิก') || crmLower.includes('lost')
    ) {
      return 'lost';
    }

    // 4. Booked / Contracted
    if (
      statusLower === 'booked' || statusLower === 'contracted' || 
      statusLower === 'reserved' ||
      crmLower.startsWith('booked') || crmLower.startsWith('contracted') ||
      crmLower.includes('วางเงินจองแปลงแล้ว') || crmLower.includes('จองแล้ว') ||
      crmLower.includes('ทำสัญญาแล้ว') ||
      (lead.notes && lead.notes.includes('🏷️ บันทึกการจอง')) ||
      (lead.auto_status && lead.auto_status.includes('จองแปลง'))
    ) {
      return 'booked';
    }

    // 5. Appointments
    if (
      lead.appointment_date || crmLower.includes('นัด') ||
      statusLower.includes('visit') || statusLower.includes('appointment')
    ) {
      return 'appointment';
    }

    // 6. Loan / Pre-approve
    if (
      crmLower.includes('กู้') || crmLower.includes('สินเชื่อ') ||
      crmLower.includes('pre-approve') || crmLower.includes('พิจารณา')
    ) {
      return 'loan';
    }

    return 'active';
  }, []);

  // Available Years list
  const availableYears = useMemo(() => {
    const yearsSet = new Set<number>();
    yearsSet.add(2026);
    yearsSet.add(2025);
    yearsSet.add(2024);
    leads.forEach(l => {
      const y = getItemYear(l);
      if (y && y >= 2020 && y <= 2030) {
        yearsSet.add(y);
      }
    });
    return Array.from(yearsSet).sort((a, b) => b - a);
  }, [leads, getItemYear]);

  // Filter Leads
  const filteredLeads = useMemo(() => {
    return leads.filter(lead => {
      // Scope Filter (My Leads vs All)
      if (scopeMode === 'my_leads' && !isMyLead(lead)) {
        return false;
      }

      // Year Filter
      if (selectedYear !== 'all') {
        const itemYear = getItemYear(lead);
        const stage = getStageCategory(lead);
        const targetYearNum = parseInt(selectedYear, 10);

        // When viewing current year (2026), keep active pipeline leads visible so ongoing follow-ups are never lost.
        // For past years (e.g. 2025, 2024), strictly filter items matching that year.
        if (selectedYear === '2026') {
          if (stage === 'active' || stage === 'appointment' || stage === 'loan') {
            // keep ongoing active pipeline leads
          } else if (itemYear !== targetYearNum) {
            return false;
          }
        } else {
          if (itemYear !== targetYearNum) {
            return false;
          }
        }
      }

      // Project Filter
      if (selectedProject !== 'all' && lead.project_name !== selectedProject) {
        return false;
      }

      // Stage Filter
      if (selectedStage !== 'all') {
        const cat = getStageCategory(lead);
        if (cat !== selectedStage) return false;
      }

      // Search Filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = lead.customer_name?.toLowerCase().includes(q);
        const matchPhone = lead.phone?.includes(q);
        const matchPlot = lead.interested_plot_name?.toLowerCase().includes(q) || lead.interested_plot_id?.toLowerCase().includes(q);
        const matchNotes = lead.notes?.toLowerCase().includes(q);
        if (!matchName && !matchPhone && !matchPlot && !matchNotes) return false;
      }

      return true;
    });
  }, [leads, scopeMode, isMyLead, selectedYear, selectedProject, selectedStage, searchQuery, getItemYear, getStageCategory]);

  // Today's Action Items & Metrics
  const myLeadsOnly = useMemo(() => leads.filter(isMyLead), [leads, isMyLead]);

  const metrics = useMemo(() => {
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const targetYearNum = selectedYear === 'all' ? null : parseInt(selectedYear, 10);

    const targetList = scopeMode === 'my_leads' ? myLeadsOnly : leads;

    let dueFollowUpCount = 0;
    let upcomingVisitsCount = 0;
    let yearBookedCount = 0;
    let yearTransferredCount = 0;
    let activeRentedCount = 0;

    targetList.forEach(l => {
      const stage = getStageCategory(l);
      const itemYear = getItemYear(l);
      const matchYear = targetYearNum === null || itemYear === targetYearNum;

      // Follow-up due today or overdue
      if (stage === 'active' || stage === 'appointment' || stage === 'loan') {
        if (l.appointment_date && l.appointment_date <= todayStr) {
          dueFollowUpCount++;
        } else if (l.last_follow_up_date && l.last_follow_up_date <= todayStr) {
          dueFollowUpCount++;
        }
      }

      // Upcoming Visits
      if (l.appointment_date && l.appointment_date >= todayStr) {
        upcomingVisitsCount++;
      }

      // Year Booked
      if (stage === 'booked' && matchYear) {
        yearBookedCount++;
      }

      // Year Transferred
      if (stage === 'transferred' && matchYear) {
        yearTransferredCount++;
      }

      // Rented
      if (stage === 'rented') {
        activeRentedCount++;
      }
    });

    return {
      total: targetList.length,
      dueFollowUpCount,
      upcomingVisitsCount,
      yearBookedCount,
      yearTransferredCount,
      activeRentedCount
    };
  }, [leads, myLeadsOnly, scopeMode, selectedYear, getStageCategory, getItemYear]);

  // Create New Lead Handler
  const handleCreateLead = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCustomerName.trim()) return;

    setIsSavingLead(true);
    try {
      const now = new Date();
      const timeStr = now.toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      const initialNote = `[${timeStr} 👤 บันทึก Lead ใหม่ โดย ${myDisplayName}]\n` +
        (newNotes.trim() ? `• รายละเอียด: ${newNotes.trim()}` : '• สร้าง Lead ใหม่เข้าระบบ');

      const { data, error } = await supabase
        .from('leads')
        .insert([{
          customer_name: newCustomerName.trim(),
          phone: newPhone.trim() || null,
          project_name: newProject || (projectNames[0] || 'ไอลิน สันทราย 2'),
          interested_plot_name: newPlotName.trim() || null,
          channel: newChannel,
          source: newChannel,
          status: 'New',
          crm_status: 'Follow-up — อยู่ระหว่างติดตาม',
          sales_owner: myDisplayName,
          created_by_agent: myDisplayName,
          notes: initialNote,
          created_at: now.toISOString(),
          updated_at: now.toISOString()
        }])
        .select()
        .single();

      if (error) throw error;

      setNotice(`บันทึก Lead ใหม่ "${newCustomerName.trim()}" สำเร็จเรียบร้อยแล้ว!`);
      setShowAddLeadModal(false);
      setNewCustomerName('');
      setNewPhone('');
      setNewPlotName('');
      setNewNotes('');
      fetchData(true);
    } catch (err: any) {
      console.error('Error creating lead:', err);
      alert('เกิดข้อผิดพลาดในการบันทึก Lead: ' + (err.message || ''));
    } finally {
      setIsSavingLead(false);
    }
  };

  // Quick Change Lead Stage Handler
  const handleQuickStatusChange = async (leadId: string, newCrmStatus: string, stageLabel: string) => {
    try {
      const now = new Date();
      const timeStr = now.toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      
      const lead = leads.find(l => l.id === leadId);
      const updatedNotes = `[${timeStr} 🔄 ปรับสถานะเป็น "${stageLabel}" โดย ${myDisplayName}]\n` + (lead?.notes || '');

      const { error } = await supabase
        .from('leads')
        .update({
          crm_status: newCrmStatus,
          status: stageLabel,
          notes: updatedNotes,
          updated_at: now.toISOString()
        })
        .eq('id', leadId);

      if (error) throw error;
      setNotice(`ปรับสถานะลูกค้าเป็น "${stageLabel}" แล้ว`);
      fetchData(true);
    } catch (err: any) {
      console.error('Error updating status:', err);
    }
  };

  return (
    <div className="w-full min-h-screen bg-slate-50 flex flex-col space-y-5 pb-16">
      
      {/* 🌟 1. Top Personal Header Banner */}
      <div className="bg-white border-b border-slate-200/90 shadow-2xs sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3.5">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            
            {/* Left User & Title */}
            <div className="flex items-center gap-3">
              {onBack && (
                <button
                  type="button"
                  onClick={onBack}
                  className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 transition-colors cursor-pointer shrink-0"
                  title="กลับหน้าหลัก"
                >
                  <ArrowRight size={18} className="rotate-180" />
                </button>
              )}

              <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-amber-500 via-orange-500 to-amber-600 flex items-center justify-center text-white font-black shadow-md shadow-amber-500/20 shrink-0">
                <Award size={22} />
              </div>

              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-base sm:text-lg font-black text-slate-900 tracking-tight flex items-center gap-1.5">
                    พื้นที่ทำงานของฉัน (My Sales Hub)
                  </h1>
                  <span className="px-2 py-0.5 rounded-md bg-amber-50 border border-amber-200 text-[10px] font-black text-amber-800">
                    ✨ {myDisplayName}
                  </span>
                </div>
                <p className="text-xs text-slate-500 font-medium">
                  โฟกัสลูกค้าในความดูแล จัดการการจอง โอนกรรมสิทธิ์ เช่า และติดตามผลการขาย
                </p>
              </div>
            </div>

            {/* Right Controls & Scope Toggle */}
            <div className="flex items-center gap-2.5 flex-wrap">
              {/* Scope Switcher: My Leads vs All Team Leads */}
              <div className="bg-slate-100 p-1 rounded-xl flex items-center border border-slate-200 shadow-2xs">
                <button
                  type="button"
                  onClick={() => setScopeMode('my_leads')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                    scopeMode === 'my_leads'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <User size={13} className={scopeMode === 'my_leads' ? 'text-amber-600' : 'text-slate-400'} />
                  ลูกค้าของฉัน ({myLeadsOnly.length})
                </button>
                <button
                  type="button"
                  onClick={() => setScopeMode('all_leads')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                    scopeMode === 'all_leads'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Building size={13} className={scopeMode === 'all_leads' ? 'text-blue-600' : 'text-slate-400'} />
                  ลูกค้าทั้งหมดในทีม ({leads.length})
                </button>
              </div>

              {/* View Switcher: Table vs Kanban */}
              <div className="bg-slate-100 p-1 rounded-xl flex items-center border border-slate-200 shadow-2xs">
                <button
                  type="button"
                  onClick={() => setViewMode('table')}
                  className={`p-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    viewMode === 'table' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-800'
                  }`}
                  title="มุมมองตาราง (Table View)"
                >
                  <Table size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('kanban')}
                  className={`p-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    viewMode === 'kanban' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-800'
                  }`}
                  title="มุมมองการ์ดบอร์ด (Kanban View)"
                >
                  <LayoutGrid size={16} />
                </button>
              </div>

              {/* Refresh Button */}
              <button
                type="button"
                onClick={() => fetchData(true)}
                disabled={isRefreshing}
                className="p-2 rounded-xl bg-white border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-colors shadow-2xs cursor-pointer"
                title="รีเฟรชข้อมูล"
              >
                <RefreshCw size={16} className={isRefreshing ? 'animate-spin text-amber-600' : ''} />
              </button>

              {/* Admin Data Hub Button (Excel Import & Export) - Admin Only */}
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => setShowAdminDataModal(true)}
                  className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-black flex items-center gap-1.5 shadow-sm cursor-pointer transition-all active:scale-95"
                  title="ศูนย์นำเข้าและส่งออกข้อมูลลูกค้า (เฉพาะ Admin)"
                >
                  <FileText size={14} className="text-amber-400" />
                  <span>จัดการ Excel (Admin)</span>
                </button>
              )}

              {/* Add Lead Button */}
              <button
                type="button"
                onClick={() => setShowAddLeadModal(true)}
                className="px-3.5 py-2 bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm shadow-orange-500/20 cursor-pointer transition-all active:scale-95"
              >
                <Plus size={15} />
                + เพิ่ม Lead ใหม่
              </button>
            </div>

          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 w-full space-y-5">
        
        {/* Notice Alert */}
        {notice && (
          <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-2xl text-xs font-bold text-emerald-900 flex items-center justify-between gap-2 shadow-2xs animate-in fade-in">
            <span className="flex items-center gap-2">
              <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
              {notice}
            </span>
            <button type="button" onClick={() => setNotice(null)} className="text-emerald-700 hover:text-emerald-900">
              <X size={14} />
            </button>
          </div>
        )}

        {/* 📊 2. Today's Action & Metric Highlight Cards (5 Cards) */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          
          {/* Card 1: ต้องโทรตามวันนี้ */}
          <div 
            onClick={() => setSelectedStage(selectedStage === 'active' ? 'all' : 'active')}
            className="bg-white p-3.5 rounded-2xl border border-slate-200/80 shadow-2xs hover:border-amber-400 transition-all cursor-pointer flex items-center justify-between"
          >
            <div>
              <span className="text-[11px] font-bold text-slate-500 block">🔴 ต้องโทรตามวันนี้</span>
              <span className="text-xl sm:text-2xl font-black text-slate-800">{metrics.dueFollowUpCount}</span>
              <span className="text-[10px] text-slate-400 block mt-0.5">ถึงกำหนดติดตาม</span>
            </div>
            <div className="w-9 h-9 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center font-bold shrink-0">
              <PhoneCall size={18} />
            </div>
          </div>

          {/* Card 2: นัดหมายเข้าชมโครงการ */}
          <div 
            onClick={() => setSelectedStage(selectedStage === 'appointment' ? 'all' : 'appointment')}
            className="bg-white p-3.5 rounded-2xl border border-slate-200/80 shadow-2xs hover:border-purple-400 transition-all cursor-pointer flex items-center justify-between"
          >
            <div>
              <span className="text-[11px] font-bold text-slate-500 block">📅 นัดชมโครงการ</span>
              <span className="text-xl sm:text-2xl font-black text-purple-700">{metrics.upcomingVisitsCount}</span>
              <span className="text-[10px] text-slate-400 block mt-0.5">นัดหมายที่จะถึง</span>
            </div>
            <div className="w-9 h-9 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center font-bold shrink-0">
              <CalendarDays size={18} />
            </div>
          </div>

          {/* Card 3: ยอดจอง */}
          <div 
            onClick={() => setSelectedStage(selectedStage === 'booked' ? 'all' : 'booked')}
            className="bg-white p-3.5 rounded-2xl border border-slate-200/80 shadow-2xs hover:border-amber-400 transition-all cursor-pointer flex items-center justify-between"
          >
            <div>
              <span className="text-[11px] font-bold text-slate-500 block">
                🏷️ ยอดจอง ({selectedYear === 'all' ? 'รวม' : selectedYear})
              </span>
              <span className="text-xl sm:text-2xl font-black text-amber-600">{metrics.yearBookedCount}</span>
              <span className="text-[10px] text-slate-400 block mt-0.5">ปิดการจองสำเร็จ</span>
            </div>
            <div className="w-9 h-9 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center font-bold shrink-0">
              <Tag size={18} />
            </div>
          </div>

          {/* Card 4: ยอดโอนกรรมสิทธิ์ */}
          <div 
            onClick={() => setSelectedStage(selectedStage === 'transferred' ? 'all' : 'transferred')}
            className="bg-white p-3.5 rounded-2xl border border-slate-200/80 shadow-2xs hover:border-emerald-400 transition-all cursor-pointer flex items-center justify-between"
          >
            <div>
              <span className="text-[11px] font-bold text-slate-500 block">
                🏡 โอนสำเร็จ ({selectedYear === 'all' ? 'รวม' : selectedYear})
              </span>
              <span className="text-xl sm:text-2xl font-black text-emerald-700">{metrics.yearTransferredCount}</span>
              <span className="text-[10px] text-slate-400 block mt-0.5">โอนกรรมสิทธิ์แล้ว</span>
            </div>
            <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold shrink-0">
              <Home size={18} />
            </div>
          </div>

          {/* Card 5: สัญญาเช่า / เช่าออม */}
          <div 
            onClick={() => setSelectedStage(selectedStage === 'rented' ? 'all' : 'rented')}
            className="bg-white p-3.5 rounded-2xl border border-slate-200/80 shadow-2xs hover:border-teal-400 transition-all cursor-pointer flex items-center justify-between col-span-2 sm:col-span-1"
          >
            <div>
              <span className="text-[11px] font-bold text-slate-500 block">🔑 สัญญาเช่า / เช่าออม</span>
              <span className="text-xl sm:text-2xl font-black text-teal-700">{metrics.activeRentedCount}</span>
              <span className="text-[10px] text-slate-400 block mt-0.5">สัญญาเช่าที่ดำเนินอยู่</span>
            </div>
            <div className="w-9 h-9 rounded-xl bg-teal-50 text-teal-600 flex items-center justify-center font-bold shrink-0">
              <Key size={18} />
            </div>
          </div>

        </div>

        {/* 🔍 3. Filters Bar: Year + Project + Search + Stage Pills */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-2xs space-y-3">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            
            {/* Year Selector */}
            <div className="w-full sm:w-44">
              <div className="relative">
                <Calendar size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <select
                  value={selectedYear}
                  onChange={e => setSelectedYear(e.target.value)}
                  className="w-full pl-9 pr-8 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:bg-white focus:ring-2 focus:ring-amber-500 focus:outline-none appearance-none cursor-pointer"
                >
                  <option value="2026">📅 ปี 2026 (ปีปัจจุบัน)</option>
                  <option value="2025">📅 ปี 2025 (ปีก่อนหน้า)</option>
                  <option value="2024">📅 ปี 2024 (ปีก่อนหน้า)</option>
                  {availableYears.filter(y => y !== 2026 && y !== 2025 && y !== 2024).map(y => (
                    <option key={y} value={String(y)}>📅 ปี {y}</option>
                  ))}
                  <option value="all">🌐 ทุกปี (ประวัติรวมทั้งหมด)</option>
                </select>
                <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              </div>
            </div>

            {/* Project Selector */}
            <div className="w-full sm:w-56">
              <div className="relative">
                <Building size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <select
                  value={selectedProject}
                  onChange={e => setSelectedProject(e.target.value)}
                  className="w-full pl-9 pr-8 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:bg-white focus:ring-2 focus:ring-amber-500 focus:outline-none appearance-none cursor-pointer"
                >
                  <option value="all">🏢 ทุกโครงการ ({projectNames.length})</option>
                  {projectNames.map(p => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
                <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              </div>
            </div>

            {/* Search Input */}
            <div className="w-full sm:flex-1 relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="🔍 ค้นหาชื่อลูกค้า, เบอร์โทร, แปลงที่สนใจ หรือโน้ต..."
                className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:bg-white focus:ring-2 focus:ring-amber-500 focus:outline-none"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X size={13} />
                </button>
              )}
            </div>

          </div>

          {/* Stage Filter Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 pt-1 scrollbar-none">
            {STAGES.map(st => {
              const count = leads.filter(l => {
                if (scopeMode === 'my_leads' && !isMyLead(l)) return false;
                if (selectedProject !== 'all' && l.project_name !== selectedProject) return false;
                
                // Year filtering for pill count
                if (selectedYear !== 'all') {
                  const itemYear = getItemYear(l);
                  const stage = getStageCategory(l);
                  const targetYearNum = parseInt(selectedYear, 10);
                  if (selectedYear === '2026') {
                    if (stage === 'active' || stage === 'appointment' || stage === 'loan') {
                      // include
                    } else if (itemYear !== targetYearNum) {
                      return false;
                    }
                  } else if (itemYear !== targetYearNum) {
                    return false;
                  }
                }

                if (st.id === 'all') return true;
                return getStageCategory(l) === st.id;
              }).length;

              const isSelected = selectedStage === st.id;

              return (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => setSelectedStage(st.id)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all border cursor-pointer ${
                    isSelected
                      ? 'bg-slate-900 text-white border-slate-900 shadow-xs'
                      : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {st.label} <span className={`ml-1 text-[10px] px-1.5 py-0.2 rounded-full font-black ${isSelected ? 'bg-slate-700 text-white' : 'bg-slate-100 text-slate-500'}`}>{count}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 📋 4. Content Area: Table vs Kanban */}
        {isLoading ? (
          <div className="bg-white p-12 rounded-3xl border border-slate-200 text-center space-y-3">
            <Loader2 size={32} className="animate-spin text-amber-500 mx-auto" />
            <p className="text-xs font-bold text-slate-500">กำลังโหลดข้อมูลลูกค้า...</p>
          </div>
        ) : filteredLeads.length === 0 ? (
          <div className="bg-white p-12 rounded-3xl border border-slate-200 text-center space-y-3">
            <User size={40} className="text-slate-300 mx-auto" />
            <h3 className="text-sm font-bold text-slate-700">ไม่พบข้อมูลลูกค้าตามเงื่อนไขที่เลือก</h3>
            <p className="text-xs text-slate-400">
              {scopeMode === 'my_leads' 
                ? 'คุณยังไม่มี Lead ที่ตรงกับตัวกรองนี้ ลองกดปุ่ม "+ เพิ่ม Lead ใหม่" เพื่อเพิ่มลูกค้าเข้าระบบ' 
                : 'ไม่พบรายการ Lead ที่ตรงกับการค้นหา'}
            </p>
            <button
              type="button"
              onClick={() => setShowAddLeadModal(true)}
              className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-bold inline-flex items-center gap-1.5 shadow-xs cursor-pointer"
            >
              <Plus size={14} /> + เพิ่ม Lead ของฉัน
            </button>
          </div>
        ) : viewMode === 'table' ? (
          /* =========================================================
             TABLE VIEW
          ========================================================= */
          <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wider text-[11px]">
                    <th className="py-3 px-4">ลูกค้า / เบอร์โทร</th>
                    <th className="py-3 px-4">โครงการ & แปลง</th>
                    <th className="py-3 px-4">ช่องทาง</th>
                    <th className="py-3 px-4">ผู้ดูแล</th>
                    <th className="py-3 px-4">สถานะการขาย</th>
                    <th className="py-3 px-4 text-center">การจัดการ / บันทึก</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700 font-medium">
                  {filteredLeads.map((lead, idx) => {
                    const stage = getStageCategory(lead);
                    const isMine = isMyLead(lead);
                    const plotName = getLeadPlotName(lead);

                    return (
                      <tr key={lead.id || idx} className="hover:bg-amber-50/30 transition-colors">
                        
                        {/* Customer Info */}
                        <td className="py-3 px-4">
                          <div className="flex items-start gap-2.5">
                            <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-xs font-black shrink-0 ${
                              isMine ? 'bg-amber-100 text-amber-900 border border-amber-200' : 'bg-slate-100 text-slate-600'
                            }`}>
                              {lead.customer_name?.charAt(0) || 'L'}
                            </div>
                            <div>
                              <span className="font-bold text-slate-900 block text-xs">
                                {lead.customer_name}
                              </span>
                              {lead.phone ? (
                                <a 
                                  href={`tel:${lead.phone}`}
                                  className="text-[11px] font-semibold text-blue-600 hover:underline inline-flex items-center gap-1 mt-0.5"
                                >
                                  <Phone size={11} /> {lead.phone}
                                </a>
                              ) : (
                                <span className="text-[10px] text-slate-400">ไม่มีเบอร์โทร</span>
                              )}
                            </div>
                          </div>
                        </td>

                        {/* Project & Plot */}
                        <td className="py-3 px-4">
                          <span className="font-bold text-slate-800 block text-xs">
                            {lead.project_name || '-'}
                          </span>
                          {plotName ? (
                            <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-md border mt-0.5 ${
                              stage === 'transferred' ? 'text-emerald-800 bg-emerald-50 border-emerald-200' :
                              stage === 'booked' ? 'text-amber-800 bg-amber-50 border-amber-200' :
                              'text-blue-800 bg-blue-50 border-blue-200'
                            }`}>
                              <Tag size={10} /> แปลง {plotName}
                            </span>
                          ) : stage === 'booked' ? (
                            <button
                              type="button"
                              onClick={() => setBookingTarget(lead)}
                              className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-800 bg-amber-50 hover:bg-amber-100 px-2 py-0.5 rounded-md border border-amber-300 mt-0.5 cursor-pointer"
                              title="คลิกเพื่อเลือกล็อคแปลงและบันทึกของแถม/ส่วนลด"
                            >
                              ⚠️ ยังไม่ระบุแปลง (กดเลือกแปลง)
                            </button>
                          ) : (
                            <span className="text-[10px] text-slate-400">ยังไม่ระบุแปลง</span>
                          )}
                        </td>

                        {/* Channel */}
                        <td className="py-3 px-4">
                          <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-[10px] font-bold border border-slate-200">
                            {lead.channel || lead.source || 'Walk in'}
                          </span>
                        </td>

                        {/* Sales Owner */}
                        <td className="py-3 px-4">
                          <span className={`text-xs font-bold flex items-center gap-1 ${
                            isMine ? 'text-amber-800' : 'text-slate-600'
                          }`}>
                            <User size={12} className={isMine ? 'text-amber-600' : 'text-slate-400'} />
                            {lead.sales_owner || lead.salesOwner || lead.agent_name || 'ทีมขาย'}
                            {isMine && <span className="text-[9px] bg-amber-100 text-amber-800 px-1 py-0.2 rounded font-black">คุณ</span>}
                          </span>
                        </td>

                        {/* CRM Status */}
                        <td className="py-3 px-4">
                          <div className="space-y-1">
                            <span className={`px-2.5 py-1 rounded-lg text-[10px] font-black inline-block border ${
                              stage === 'transferred' ? 'bg-emerald-100 text-emerald-900 border-emerald-300' :
                              stage === 'booked' ? 'bg-amber-100 text-amber-900 border-amber-300' :
                              stage === 'rented' ? 'bg-teal-100 text-teal-900 border-teal-300' :
                              stage === 'appointment' ? 'bg-purple-100 text-purple-900 border-purple-300' :
                              stage === 'loan' ? 'bg-indigo-100 text-indigo-900 border-indigo-300' :
                              stage === 'lost' ? 'bg-rose-100 text-rose-900 border-rose-300' :
                              'bg-blue-100 text-blue-900 border-blue-300'
                            }`}>
                              {stage === 'transferred' ? '🏡 โอนกรรมสิทธิ์แล้ว' : (lead.crm_status || lead.status || 'กำลังติดตาม')}
                            </span>
                            {lead.transferred_date && (
                              <span className="text-[10px] text-emerald-700 font-bold block flex items-center gap-1">
                                <CheckCircle size={10} /> โอน: {String(lead.transferred_date).split('T')[0]}
                              </span>
                            )}
                            {lead.appointment_date && stage !== 'transferred' && (
                              <span className="text-[10px] text-purple-700 font-bold block flex items-center gap-1">
                                <Calendar size={10} /> นัด: {lead.appointment_date}
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Actions */}
                        <td className="py-3 px-4 text-center">
                          <div className="flex items-center justify-center gap-1.5 flex-wrap">
                            
                            {/* Follow up modal button */}
                            <button
                              type="button"
                              onClick={() => setFollowUpTarget({ customer: lead })}
                              className="px-2.5 py-1 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-lg text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer transition-colors shadow-2xs"
                              title="บันทึกผลการโทร / ติดตาม"
                            >
                              <PhoneCall size={12} className="text-blue-600" />
                              ติดตาม
                            </button>

                            {/* Book Plot modal button */}
                            <button
                              type="button"
                              onClick={() => setBookingTarget(lead)}
                              className="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 rounded-lg text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer transition-colors shadow-2xs"
                              title="บันทึกการจองแปลง (พร้อมเลือกของแถม/ส่วนลด)"
                            >
                              <Tag size={12} className="text-amber-600" />
                              จองแปลง
                            </button>

                            {/* Rental Contract modal button */}
                            <button
                              type="button"
                              onClick={() => setRentalTarget(lead)}
                              className="px-2.5 py-1 bg-teal-50 hover:bg-teal-100 text-teal-900 border border-teal-200 rounded-lg text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer transition-colors shadow-2xs"
                              title="ทำสัญญาเช่า (แบบ A, B, C)"
                            >
                              <Key size={12} className="text-teal-600" />
                              เช่า
                            </button>

                          </div>
                        </td>

                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          /* =========================================================
             KANBAN BOARD VIEW (Horizontal Scrollable 6 Columns)
          ========================================================= */
          <div className="flex gap-4 overflow-x-auto pb-4 items-start scrollbar-thin">
            
            {/* Column 1: สนใจ & กำลังติดตาม */}
            <div className="bg-slate-100/90 rounded-2xl p-3 border border-slate-200 space-y-3 min-w-[280px] w-72 shrink-0">
              <div className="flex items-center justify-between pb-1 border-b border-slate-200">
                <span className="text-xs font-black text-blue-900 flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-blue-500"></span>
                  🔥 กำลังติดตาม (Follow-up)
                </span>
                <span className="text-[11px] font-black text-blue-700 bg-blue-100 px-2 py-0.5 rounded-full">
                  {filteredLeads.filter(l => getStageCategory(l) === 'active').length}
                </span>
              </div>

              <div className="space-y-2.5 max-h-[70vh] overflow-y-auto pr-0.5">
                {filteredLeads.filter(l => getStageCategory(l) === 'active').map(lead => (
                  <LeadKanbanCard 
                    key={lead.id} 
                    lead={lead} 
                    isMine={isMyLead(lead)}
                    plotName={getLeadPlotName(lead)}
                    stage="active"
                    onBook={() => setBookingTarget(lead)}
                    onFollowUp={() => setFollowUpTarget({ customer: lead })}
                    onRent={() => setRentalTarget(lead)}
                    onQuickStatus={(status, label) => handleQuickStatusChange(lead.id, status, label)}
                  />
                ))}
              </div>
            </div>

            {/* Column 2: นัดหมายเข้าชมโครงการ */}
            <div className="bg-slate-100/90 rounded-2xl p-3 border border-slate-200 space-y-3 min-w-[280px] w-72 shrink-0">
              <div className="flex items-center justify-between pb-1 border-b border-slate-200">
                <span className="text-xs font-black text-purple-900 flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-purple-500"></span>
                  📅 นัดชมโครงการ (Visit)
                </span>
                <span className="text-[11px] font-black text-purple-700 bg-purple-100 px-2 py-0.5 rounded-full">
                  {filteredLeads.filter(l => getStageCategory(l) === 'appointment').length}
                </span>
              </div>

              <div className="space-y-2.5 max-h-[70vh] overflow-y-auto pr-0.5">
                {filteredLeads.filter(l => getStageCategory(l) === 'appointment').map(lead => (
                  <LeadKanbanCard 
                    key={lead.id} 
                    lead={lead} 
                    isMine={isMyLead(lead)}
                    plotName={getLeadPlotName(lead)}
                    stage="appointment"
                    onBook={() => setBookingTarget(lead)}
                    onFollowUp={() => setFollowUpTarget({ customer: lead })}
                    onRent={() => setRentalTarget(lead)}
                    onQuickStatus={(status, label) => handleQuickStatusChange(lead.id, status, label)}
                  />
                ))}
              </div>
            </div>

            {/* Column 3: ยื่นกู้ & พิจารณา */}
            <div className="bg-slate-100/90 rounded-2xl p-3 border border-slate-200 space-y-3 min-w-[280px] w-72 shrink-0">
              <div className="flex items-center justify-between pb-1 border-b border-slate-200">
                <span className="text-xs font-black text-indigo-900 flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-indigo-500"></span>
                  🏦 ยื่นกู้ / พิจารณา (Loan)
                </span>
                <span className="text-[11px] font-black text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded-full">
                  {filteredLeads.filter(l => getStageCategory(l) === 'loan').length}
                </span>
              </div>

              <div className="space-y-2.5 max-h-[70vh] overflow-y-auto pr-0.5">
                {filteredLeads.filter(l => getStageCategory(l) === 'loan').map(lead => (
                  <LeadKanbanCard 
                    key={lead.id} 
                    lead={lead} 
                    isMine={isMyLead(lead)}
                    plotName={getLeadPlotName(lead)}
                    stage="loan"
                    onBook={() => setBookingTarget(lead)}
                    onFollowUp={() => setFollowUpTarget({ customer: lead })}
                    onRent={() => setRentalTarget(lead)}
                    onQuickStatus={(status, label) => handleQuickStatusChange(lead.id, status, label)}
                  />
                ))}
              </div>
            </div>

            {/* Column 4: วางจองแล้ว (Booked) */}
            <div className="bg-slate-100/90 rounded-2xl p-3 border border-slate-200 space-y-3 min-w-[280px] w-72 shrink-0">
              <div className="flex items-center justify-between pb-1 border-b border-slate-200">
                <span className="text-xs font-black text-amber-900 flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-500"></span>
                  🏷️ วางจองแล้ว (Booked)
                </span>
                <span className="text-[11px] font-black text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                  {filteredLeads.filter(l => getStageCategory(l) === 'booked').length}
                </span>
              </div>

              <div className="space-y-2.5 max-h-[70vh] overflow-y-auto pr-0.5">
                {filteredLeads.filter(l => getStageCategory(l) === 'booked').map(lead => (
                  <LeadKanbanCard 
                    key={lead.id} 
                    lead={lead} 
                    isMine={isMyLead(lead)}
                    plotName={getLeadPlotName(lead)}
                    stage="booked"
                    onBook={() => setBookingTarget(lead)}
                    onFollowUp={() => setFollowUpTarget({ customer: lead })}
                    onRent={() => setRentalTarget(lead)}
                    onQuickStatus={(status, label) => handleQuickStatusChange(lead.id, status, label)}
                  />
                ))}
              </div>
            </div>

            {/* Column 5: โอนกรรมสิทธิ์สำเร็จ (Transferred & Won) */}
            <div className="bg-emerald-50/80 rounded-2xl p-3 border border-emerald-200 space-y-3 min-w-[280px] w-72 shrink-0">
              <div className="flex items-center justify-between pb-1 border-b border-emerald-200">
                <span className="text-xs font-black text-emerald-900 flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                  🏡 โอนกรรมสิทธิ์สำเร็จ (Won)
                </span>
                <span className="text-[11px] font-black text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-full">
                  {filteredLeads.filter(l => getStageCategory(l) === 'transferred').length}
                </span>
              </div>

              <div className="space-y-2.5 max-h-[70vh] overflow-y-auto pr-0.5">
                {filteredLeads.filter(l => getStageCategory(l) === 'transferred').map(lead => (
                  <LeadKanbanCard 
                    key={lead.id} 
                    lead={lead} 
                    isMine={isMyLead(lead)}
                    plotName={getLeadPlotName(lead)}
                    stage="transferred"
                    onBook={() => setBookingTarget(lead)}
                    onFollowUp={() => setFollowUpTarget({ customer: lead })}
                    onRent={() => setRentalTarget(lead)}
                    onQuickStatus={(status, label) => handleQuickStatusChange(lead.id, status, label)}
                  />
                ))}
              </div>
            </div>

            {/* Column 6: สัญญาเช่า / เช่าออม (Rented) */}
            <div className="bg-teal-50/80 rounded-2xl p-3 border border-teal-200 space-y-3 min-w-[280px] w-72 shrink-0">
              <div className="flex items-center justify-between pb-1 border-b border-teal-200">
                <span className="text-xs font-black text-teal-900 flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-teal-500"></span>
                  🔑 สัญญาเช่า / เช่าออม
                </span>
                <span className="text-[11px] font-black text-teal-800 bg-teal-100 px-2 py-0.5 rounded-full">
                  {filteredLeads.filter(l => getStageCategory(l) === 'rented').length}
                </span>
              </div>

              <div className="space-y-2.5 max-h-[70vh] overflow-y-auto pr-0.5">
                {filteredLeads.filter(l => getStageCategory(l) === 'rented').map(lead => (
                  <LeadKanbanCard 
                    key={lead.id} 
                    lead={lead} 
                    isMine={isMyLead(lead)}
                    plotName={getLeadPlotName(lead)}
                    stage="rented"
                    onBook={() => setBookingTarget(lead)}
                    onFollowUp={() => setFollowUpTarget({ customer: lead })}
                    onRent={() => setRentalTarget(lead)}
                    onQuickStatus={(status, label) => handleQuickStatusChange(lead.id, status, label)}
                  />
                ))}
              </div>
            </div>

          </div>
        )}

      </div>

      {/* =========================================================
          MODALS
      ========================================================= */}

      {/* 1. Modal: เพิ่ม Lead ใหม่ */}
      {showAddLeadModal && (
        <div className="fixed inset-0 z-[400] flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-100 w-full max-w-lg overflow-hidden animate-in zoom-in-95">
            
            <div className="flex items-center justify-between p-5 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-amber-500 text-white flex items-center justify-center font-black">
                  <Plus size={18} />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-800">เพิ่ม Lead ลูกค้าใหม่</h3>
                  <p className="text-xs text-slate-500 font-medium">บันทึกชื่อลูกค้าและกำหนดตนเองเป็นผู้ดูแลอัตโนมัติ</p>
                </div>
              </div>
              <button 
                type="button" 
                onClick={() => setShowAddLeadModal(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateLead} className="p-5 space-y-4">
              
              {/* Sales Owner Badge */}
              <div className="p-3 bg-amber-50 rounded-2xl border border-amber-200 text-xs font-bold text-amber-900 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <User size={14} className="text-amber-600" />
                  พนักงานขายผู้ดูแล: <strong>{myDisplayName}</strong> (คุณ)
                </span>
                <span className="text-[10px] bg-amber-200/80 px-2 py-0.5 rounded-full font-black text-amber-900">
                  Auto-Assigned
                </span>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  ชื่อ-นามสกุล ลูกค้า <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={newCustomerName}
                  onChange={e => setNewCustomerName(e.target.value)}
                  placeholder="เช่น คุณสมชาย รักดี"
                  className="w-full text-xs font-bold bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-slate-800 focus:bg-white focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">เบอร์โทรศัพท์</label>
                  <input
                    type="tel"
                    value={newPhone}
                    onChange={e => setNewPhone(e.target.value)}
                    placeholder="08x-xxx-xxxx"
                    className="w-full text-xs font-bold bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-slate-800 focus:bg-white focus:ring-2 focus:ring-amber-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">ช่องทางที่ติดต่อ</label>
                  <select
                    value={newChannel}
                    onChange={e => setNewChannel(e.target.value)}
                    className="w-full text-xs font-bold bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-slate-800 focus:bg-white focus:ring-2 focus:ring-amber-500"
                  >
                    <option value="Facebook">Facebook</option>
                    <option value="Line OA">Line OA</option>
                    <option value="Walk in">Walk in</option>
                    <option value="โทร">โทรศัพท์</option>
                    <option value="TikTok">TikTok</option>
                    <option value="Lemon8">Lemon8</option>
                    <option value="Referral">คนแนะนำ (Referral)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">โครงการที่สนใจ</label>
                  <select
                    value={newProject}
                    onChange={e => setNewProject(e.target.value)}
                    className="w-full text-xs font-bold bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-slate-800 focus:bg-white focus:ring-2 focus:ring-amber-500"
                  >
                    {projectNames.map(p => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">แปลงที่เล็งไว้ (ถ้ามี)</label>
                  <input
                    type="text"
                    value={newPlotName}
                    onChange={e => setNewPlotName(e.target.value)}
                    placeholder="เช่น A01 หรือ 4"
                    className="w-full text-xs font-bold bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-slate-800 focus:bg-white focus:ring-2 focus:ring-amber-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">บันทึกเบื้องต้น / ความต้องการลูกค้า</label>
                <textarea
                  rows={3}
                  value={newNotes}
                  onChange={e => setNewNotes(e.target.value)}
                  placeholder="เช่น ลูกค้าสนใจบ้าน 3 นอน งบ 2.8 ล้าน กำลังเช็คบูโร..."
                  className="w-full text-xs bg-slate-50 border border-slate-200 rounded-xl p-3 text-slate-800 focus:bg-white focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddLeadModal(false)}
                  className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={isSavingLead || !newCustomerName.trim()}
                  className="px-5 py-2 bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm cursor-pointer disabled:opacity-50"
                >
                  {isSavingLead ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  บันทึก Lead ใหม่
                </button>
              </div>

            </form>

          </div>
        </div>
      )}

      {/* 2. Modal: จองแปลง (CentralLeadBookingModal) */}
      {bookingTarget && (
        <CentralLeadBookingModal
          isOpen={true}
          onClose={() => setBookingTarget(null)}
          customer={bookingTarget}
          initialInterest={{
            projectName: bookingTarget.project_name,
            plotId: bookingTarget.interested_plot_name || bookingTarget.interested_plot_id
          }}
          projects={projectNames}
          salesOwners={salesOwners}
          currentUser={currentUser}
          onSaved={(msg) => {
            setNotice(msg);
            setBookingTarget(null);
            fetchData(true);
          }}
        />
      )}

      {/* 3. Modal: บันทึกติดตาม (CentralLeadFollowUpModal) */}
      {followUpTarget && (
        <CentralLeadFollowUpModal
          isOpen={true}
          onClose={() => setFollowUpTarget(null)}
          customer={followUpTarget.customer}
          projects={projectNames}
          salesOwners={salesOwners}
          onSaved={(msg) => {
            setNotice(msg);
            setFollowUpTarget(null);
            fetchData(true);
          }}
        />
      )}

      {/* 4. Modal: นัดหมายเข้าชมโครงการ (CentralVisitAppointmentModal) */}
      {appointmentTarget && (
        <CentralVisitAppointmentModal
          isOpen={true}
          onClose={() => setAppointmentTarget(null)}
          customer={appointmentTarget.customer}
          projects={projectNames}
          salesOwners={salesOwners}
          onSaved={(msg) => {
            setNotice(msg);
            setAppointmentTarget(null);
            fetchData(true);
          }}
        />
      )}

      {/* 5. Modal: สัญญาเช่า (RentalContractModal) */}
      {rentalTarget && (
        <RentalContractModal
          isOpen={true}
          onClose={() => setRentalTarget(null)}
          lead={rentalTarget}
          projectName={rentalTarget.project_name}
          salesOwners={salesOwners}
          user={currentUser}
          onSaved={() => {
            setNotice(`บันทึกสัญญาเช่าเรียบร้อยแล้ว`);
            setRentalTarget(null);
            fetchData(true);
          }}
        />
      )}

      {/* 6. Modal: Admin Customer Import & Export */}
      {showAdminDataModal && (
        <AdminCustomerImportExportModal
          isOpen={true}
          onClose={() => setShowAdminDataModal(false)}
          currentUser={currentUser}
          projects={projectNames}
          plots={dbPlots}
          allLeads={leads}
          onImportComplete={(msg) => {
            setNotice(msg);
            setShowAdminDataModal(false);
            fetchData(true);
          }}
        />
      )}

    </div>
  );
}

// 🗂️ Helper: Kanban Card Component
function LeadKanbanCard({
  lead,
  isMine,
  plotName,
  stage,
  onBook,
  onFollowUp,
  onRent,
  onQuickStatus
}: {
  lead: any;
  isMine: boolean;
  plotName: string | null;
  stage: string;
  onBook: () => void;
  onFollowUp: () => void;
  onRent: () => void;
  onQuickStatus: (status: string, label: string) => void;
}) {
  return (
    <div className={`p-3.5 bg-white rounded-xl border transition-all shadow-2xs space-y-2.5 ${
      stage === 'transferred' ? 'border-emerald-200 ring-1 ring-emerald-100' :
      isMine ? 'border-amber-200 ring-1 ring-amber-100' : 'border-slate-200/80 hover:border-slate-300'
    }`}>
      
      {/* Header: Name & Owner */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <span className="font-black text-xs text-slate-900 block leading-snug">
            {lead.customer_name}
          </span>
          {lead.phone && (
            <a href={`tel:${lead.phone}`} className="text-[11px] font-semibold text-blue-600 hover:underline flex items-center gap-1 mt-0.5">
              <Phone size={10} /> {lead.phone}
            </a>
          )}
        </div>

        {isMine ? (
          <span className="text-[9px] font-black bg-amber-100 text-amber-900 px-1.5 py-0.5 rounded border border-amber-200 shrink-0">
            คุณดูแล
          </span>
        ) : (
          <span className="text-[9px] font-bold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded shrink-0">
            {lead.sales_owner || 'ทีมขาย'}
          </span>
        )}
      </div>

      {/* Project & Plot badge */}
      <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
        <span className="font-bold text-slate-700">{lead.project_name || '-'}</span>
        {plotName ? (
          <span className={`font-bold px-1.5 py-0.2 rounded border ${
            stage === 'transferred' ? 'text-emerald-900 bg-emerald-50 border-emerald-200' : 'text-amber-900 bg-amber-50 border-amber-200'
          }`}>
            แปลง {plotName}
          </span>
        ) : stage === 'booked' ? (
          <button
            type="button"
            onClick={onBook}
            className="text-[9px] font-bold text-amber-800 bg-amber-50 hover:bg-amber-100 px-1.5 py-0.2 rounded border border-amber-300 cursor-pointer"
            title="คลิกเพื่อเลือกแปลงที่จอง"
          >
            ⚠️ ยังไม่ระบุแปลง
          </button>
        ) : null}
      </div>

      {/* Channel / Transfer date */}
      <div className="flex items-center justify-between text-[10px] text-slate-500">
        <span className="bg-slate-100 px-1.5 py-0.5 rounded font-medium">
          {lead.channel || 'Walk in'}
        </span>
        {stage === 'transferred' && lead.transferred_date ? (
          <span className="font-bold text-emerald-700 flex items-center gap-1">
            <CheckCircle size={10} /> โอน: {String(lead.transferred_date).split('T')[0]}
          </span>
        ) : lead.appointment_date ? (
          <span className="font-bold text-purple-700 flex items-center gap-1">
            <Calendar size={10} /> นัด {lead.appointment_date}
          </span>
        ) : null}
      </div>

      {/* Actions */}
      <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-1">
        <button
          type="button"
          onClick={onFollowUp}
          className="px-2 py-1 bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-lg text-[10px] font-bold inline-flex items-center gap-1 cursor-pointer"
        >
          <PhoneCall size={10} className="text-blue-600" /> ตาม
        </button>

        <div className="flex items-center gap-1">
          {stage !== 'transferred' && (
            <button
              type="button"
              onClick={onBook}
              className="px-2 py-1 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 rounded-lg text-[10px] font-black inline-flex items-center gap-1 cursor-pointer"
            >
              <Tag size={10} className="text-amber-600" /> จอง
            </button>
          )}
          <button
            type="button"
            onClick={onRent}
            className="px-2 py-1 bg-teal-50 hover:bg-teal-100 text-teal-900 border border-teal-200 rounded-lg text-[10px] font-black inline-flex items-center gap-1 cursor-pointer"
          >
            <Key size={10} className="text-teal-600" /> เช่า
          </button>
        </div>
      </div>

    </div>
  );
}
