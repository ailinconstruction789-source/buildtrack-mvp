"use client";

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { 
  Key, 
  Search, 
  Filter, 
  Plus, 
  Home, 
  Phone, 
  Calendar, 
  Clock, 
  CreditCard, 
  TrendingUp, 
  PiggyBank, 
  Building2, 
  CheckCircle2, 
  AlertTriangle, 
  RefreshCw, 
  FileText, 
  Share2, 
  Wrench, 
  Smartphone, 
  Trash2, 
  ChevronRight, 
  ExternalLink, 
  DollarSign, 
  ShieldCheck, 
  AlertCircle,
  LayoutGrid,
  List,
  Sparkles,
  ArrowRight,
  Receipt
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { 
  RentalContract, 
  RentalProgramType, 
  RENTAL_PROGRAM_DETAILS, 
  Lead 
} from '@/types/sales';
import RentalContractModal from './RentalContractModal';
import RentalPaymentLedgerModal from './RentalPaymentLedgerModal';
import RentalActionModal from './RentalActionModal';
import RentalMaintenanceModal from './RentalMaintenanceModal';
import TenantPortalModal from './TenantPortalModal';
import AdminDeleteCustomerModal from './AdminDeleteCustomerModal';
import RentalReceiptModal from './RentalReceiptModal';

interface RentalManagementWorkspaceProps {
  projects?: any[];
  plots?: any[];
  user?: any;
  selectedProjectName?: string;
  onNavigateToAnalytics?: () => void;
  onNavigateToAlerts?: () => void;
}

export default function RentalManagementWorkspace({
  projects = [],
  plots = [],
  user,
  selectedProjectName,
  onNavigateToAnalytics,
  onNavigateToAlerts
}: RentalManagementWorkspaceProps) {
  const [contracts, setContracts] = useState<RentalContract[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProject, setSelectedProject] = useState<string>(selectedProjectName || 'all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'Active' | 'expiring' | 'overdue' | 'ConvertedToBuy' | 'MovedOut' | 'Cancelled'>('all');
  const [programFilter, setProgramFilter] = useState<'all' | RentalProgramType>('all');
  const [viewMode, setViewMode] = useState<'table' | 'grid'>('table');

  // Overdue payment map by plot_id or contract_id
  const [overdueMap, setOverdueMap] = useState<Record<string, number>>({});

  // Modals state
  const [contractModal, setContractModal] = useState<{ isOpen: boolean; lead: Lead | null; plotId: string | null }>({
    isOpen: false,
    lead: null,
    plotId: null
  });

  const [ledgerModal, setLedgerModal] = useState<{ 
    isOpen: boolean; 
    contractId?: string; 
    plotId?: string; 
    plot?: any;
    lead?: any;
    projectName?: string;
  }>({
    isOpen: false
  });

  const [actionModal, setActionModal] = useState<{
    isOpen: boolean;
    lead?: Lead | null;
    plot?: any | null;
  }>({
    isOpen: false
  });

  const [maintenanceModal, setMaintenanceModal] = useState<{
    isOpen: boolean;
    plotId?: string | null;
    plotName?: string | null;
    projectName?: string;
    lead?: Lead | null;
  }>({
    isOpen: false
  });

  const [portalModal, setPortalModal] = useState<{
    isOpen: boolean;
    contract: RentalContract | null;
    payments: any[];
  }>({
    isOpen: false,
    contract: null,
    payments: []
  });

  const [deleteModal, setDeleteModal] = useState<{
    isOpen: boolean;
    lead: Lead | null;
  }>({
    isOpen: false,
    lead: null
  });

  const isAdmin = !user?.role || 
    user?.role?.toLowerCase() === 'admin' || 
    user?.role?.toLowerCase() === 'owner' || 
    user?.role?.toLowerCase() === 'superadmin';

  // Fetch all rental contracts and overdue payments
  const fetchContractsData = useCallback(async () => {
    setLoading(true);
    try {
      // 1. Fetch contracts
      let query = supabase.from('rental_contracts').select('*').order('created_at', { ascending: false });
      if (selectedProject && selectedProject !== 'all') {
        query = query.eq('project_name', selectedProject);
      }
      const { data: contractList, error: contractErr } = await query;
      if (contractErr) throw contractErr;

      setContracts(contractList || []);

      // 2. Fetch overdue payments to flag rows
      const todayStr = new Date().toISOString().split('T')[0];
      let overdueQuery = supabase
        .from('rental_payments')
        .select('contract_id, plot_id, amount_due')
        .or(`payment_status.eq.Overdue,and(payment_status.eq.Pending,due_date.lt.${todayStr})`);

      if (selectedProject && selectedProject !== 'all') {
        overdueQuery = overdueQuery.eq('project_name', selectedProject);
      }
      const { data: overdues } = await overdueQuery;

      const ovMap: Record<string, number> = {};
      if (overdues) {
        overdues.forEach((p: any) => {
          if (p.contract_id) ovMap[p.contract_id] = (ovMap[p.contract_id] || 0) + Number(p.amount_due || 0);
          if (p.plot_id) ovMap[p.plot_id] = (ovMap[p.plot_id] || 0) + Number(p.amount_due || 0);
        });
      }
      setOverdueMap(ovMap);

    } catch (err) {
      console.error('Error fetching rental contracts:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedProject]);

  useEffect(() => {
    fetchContractsData();
  }, [fetchContractsData]);

  // Expiry check helper (days remaining)
  const getRemainingDays = (endDateStr?: string | null): number => {
    if (!endDateStr) return 999;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const end = new Date(endDateStr);
    end.setHours(0, 0, 0, 0);
    return Math.ceil((end.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  };

  // Filtered Contracts
  const filteredContracts = useMemo(() => {
    return contracts.filter((c) => {
      // 1. Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = c.tenant_name?.toLowerCase().includes(q);
        const matchesPhone = c.tenant_phone?.includes(q);
        const matchesPlot = (c.plot_name || c.plot_id)?.toLowerCase().includes(q);
        const matchesProject = c.project_name?.toLowerCase().includes(q);
        if (!matchesName && !matchesPhone && !matchesPlot && !matchesProject) return false;
      }

      // 2. Program Filter
      if (programFilter !== 'all' && c.program_type !== programFilter) {
        return false;
      }

      // 3. Status Filter
      if (statusFilter === 'all') return true;
      if (statusFilter === 'Active') return c.status === 'Active';
      if (statusFilter === 'ConvertedToBuy') return c.status === 'ConvertedToBuy';
      if (statusFilter === 'MovedOut') return c.status === 'MovedOut';
      if (statusFilter === 'Cancelled') return c.status === 'Cancelled';
      if (statusFilter === 'expiring') {
        const days = getRemainingDays(c.lease_end_date);
        return c.status === 'Active' && days <= 60 && days >= 0;
      }
      if (statusFilter === 'overdue') {
        const hasOverdue = (overdueMap[c.id] || overdueMap[c.plot_id] || 0) > 0;
        return c.status === 'Active' && hasOverdue;
      }

      return true;
    });
  }, [contracts, searchQuery, programFilter, statusFilter, overdueMap]);

  // Aggregate KPI summary
  const summary = useMemo(() => {
    let activeCount = 0;
    let totalMonthlyRevenue = 0;
    let totalSavingsPool = 0;
    let expiringCount = 0;
    let overdueCount = 0;

    contracts.forEach((c) => {
      if (c.status === 'Active') {
        activeCount++;
        totalMonthlyRevenue += Number(c.monthly_rent || 0);
        totalSavingsPool += Number(c.accumulated_savings || 0);

        const days = getRemainingDays(c.lease_end_date);
        if (days <= 60 && days >= 0) expiringCount++;
        if ((overdueMap[c.id] || overdueMap[c.plot_id] || 0) > 0) overdueCount++;
      }
    });

    return {
      activeCount,
      totalMonthlyRevenue,
      totalSavingsPool,
      expiringCount,
      overdueCount
    };
  }, [contracts, overdueMap]);

  // Open Portal with fetched payments
  const handleOpenPortal = async (contract: RentalContract) => {
    try {
      const { data: payments } = await supabase
        .from('rental_payments')
        .select('*')
        .eq('contract_id', contract.id)
        .order('period_month', { ascending: true });

      setPortalModal({
        isOpen: true,
        contract,
        payments: payments || []
      });
    } catch (e) {
      setPortalModal({
        isOpen: true,
        contract,
        payments: []
      });
    }
  };

  return (
    <div className="w-full h-full bg-slate-50 overflow-y-auto p-4 md:p-6 space-y-6">
      
      {/* 🌟 Top Header & Quick Links */}
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 bg-white p-5 rounded-3xl border border-slate-200/80 shadow-xs">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 bg-gradient-to-br from-amber-500 to-amber-700 text-white rounded-2xl shadow-md shadow-amber-500/20">
              <Key size={22} className="stroke-[2.5]" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight flex items-center gap-2">
                Ailin Rental Management
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200/80 font-bold">
                  ระบบงานเช่า & ผ่อนตรง
                </span>
              </h1>
              <p className="text-xs text-slate-500">
                บริหารสัญญาเช่าครบวงจร (Program A/B/C) • บันทึกค่างวด • แปลงเป็นซื้อ • แจ้งซ่อม • Portal ผู้เช่า
              </p>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2.5 w-full lg:w-auto">
          {onNavigateToAnalytics && (
            <button
              onClick={onNavigateToAnalytics}
              className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <TrendingUp size={15} className="text-blue-600" /> วิเคราะห์พอร์ต & Yield
            </button>
          )}

          {onNavigateToAlerts && (
            <button
              onClick={onNavigateToAlerts}
              className="px-3.5 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200/70 font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <AlertCircle size={15} className="text-rose-600" /> แจ้งเตือนด่วน ({summary.expiringCount + summary.overdueCount})
            </button>
          )}

          <button
            onClick={() => setContractModal({ isOpen: true, lead: null, plotId: null })}
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-700 hover:to-amber-800 text-white font-bold text-xs flex items-center gap-1.5 shadow-md shadow-amber-600/20 transition-all cursor-pointer hover:scale-102"
          >
            <Plus size={16} strokeWidth={3} /> ทำสัญญาเช่าใหม่
          </button>
        </div>
      </div>

      {/* 🚀 KPI Summary Ribbon */}
      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        
        {/* Active Leases */}
        <div className="bg-white p-4.5 rounded-2xl border border-slate-200/90 shadow-2xs space-y-1.5">
          <div className="flex items-center justify-between text-slate-500 text-xs font-bold">
            <span className="flex items-center gap-1.5 text-slate-700">
              <Home size={16} className="text-blue-600" /> สัญญาที่กำลังเช่าอยู่
            </span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-mono font-bold">
              Active
            </span>
          </div>
          <div className="text-2xl sm:text-3xl font-black text-slate-900 font-mono">
            {summary.activeCount} <span className="text-xs font-normal text-slate-500">สัญญา</span>
          </div>
          <p className="text-[11px] text-slate-500">
            จากทั้งหมด {contracts.length} สัญญาทุกสถานะ
          </p>
        </div>

        {/* Monthly Recurring Rent */}
        <div className="bg-white p-4.5 rounded-2xl border border-slate-200/90 shadow-2xs space-y-1.5">
          <div className="flex items-center justify-between text-slate-500 text-xs font-bold">
            <span className="flex items-center gap-1.5 text-emerald-800">
              <TrendingUp size={16} className="text-emerald-600" /> กระแสเงินสดค่าเช่า/ด.
            </span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-bold">
              Monthly
            </span>
          </div>
          <div className="text-2xl sm:text-3xl font-black text-emerald-950 font-mono">
            ฿{summary.totalMonthlyRevenue.toLocaleString()} <span className="text-xs font-normal text-emerald-700">บ./ด.</span>
          </div>
          <p className="text-[11px] text-slate-500">
            ประมาณการ ฿{(summary.totalMonthlyRevenue * 12).toLocaleString()} บ./ปี
          </p>
        </div>

        {/* Rent to Own Pool */}
        <div className="bg-white p-4.5 rounded-2xl border border-amber-200 bg-amber-50/20 shadow-2xs space-y-1.5">
          <div className="flex items-center justify-between text-amber-800 text-xs font-bold">
            <span className="flex items-center gap-1.5">
              <PiggyBank size={16} className="text-amber-600" /> ยอดสะสมดาวน์ (แบบ B)
            </span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 font-bold">
              Rent to Own
            </span>
          </div>
          <div className="text-2xl sm:text-3xl font-black text-amber-950 font-mono">
            ฿{summary.totalSavingsPool.toLocaleString()} <span className="text-xs font-normal text-amber-800">บาท</span>
          </div>
          <p className="text-[11px] text-amber-800">
            เตรียมแปลงเป็นเงินดาวน์ซื้อบ้าน
          </p>
        </div>

        {/* Urgent Action Needed */}
        <div className="bg-white p-4.5 rounded-2xl border border-rose-200 bg-rose-50/20 shadow-2xs space-y-1.5">
          <div className="flex items-center justify-between text-rose-800 text-xs font-bold">
            <span className="flex items-center gap-1.5">
              <AlertTriangle size={16} className="text-rose-600" /> รายการที่ต้องติดตาม
            </span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-100 text-rose-900 font-bold">
              Urgent
            </span>
          </div>
          <div className="text-2xl sm:text-3xl font-black text-rose-950 font-mono">
            {summary.expiringCount + summary.overdueCount} <span className="text-xs font-normal text-rose-800">รายการ</span>
          </div>
          <p className="text-[11px] text-rose-700">
            ใกล้หมดอายุ {summary.expiringCount} • ค้างจ่าย {summary.overdueCount}
          </p>
        </div>

      </div>

      {/* 🔍 Search & Filters Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/90 shadow-2xs space-y-3.5">
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
          
          {/* Search Input */}
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="ค้นหาชื่อผู้เช่า, เบอร์โทร, แปลงบ้าน, หรือโครงการ..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-medium focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-all"
            />
          </div>

          {/* Project Selector */}
          <div className="flex items-center gap-2 shrink-0">
            <Building2 size={16} className="text-slate-400 shrink-0" />
            <select
              value={selectedProject}
              onChange={(e) => setSelectedProject(e.target.value)}
              className="px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 cursor-pointer"
            >
              <option value="all">ทุกโครงการ (All Projects)</option>
              {projects.map((p) => (
                <option key={p.id || p.name} value={p.name}>
                  {p.name}
                </option>
              ))}
            </select>

            {/* Refresh */}
            <button
              onClick={fetchContractsData}
              disabled={loading}
              className="p-2.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
              title="รีเฟรชข้อมูล"
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            </button>

            {/* View Mode Toggle */}
            <div className="flex items-center p-1 bg-slate-100 rounded-xl">
              <button
                onClick={() => setViewMode('table')}
                className={`p-1.5 rounded-lg transition-all cursor-pointer ${
                  viewMode === 'table' ? 'bg-white shadow-xs text-slate-900 font-bold' : 'text-slate-500 hover:text-slate-900'
                }`}
                title="ตาราง (Table View)"
              >
                <List size={16} />
              </button>
              <button
                onClick={() => setViewMode('grid')}
                className={`p-1.5 rounded-lg transition-all cursor-pointer ${
                  viewMode === 'grid' ? 'bg-white shadow-xs text-slate-900 font-bold' : 'text-slate-500 hover:text-slate-900'
                }`}
                title="การ์ด (Grid View)"
              >
                <LayoutGrid size={16} />
              </button>
            </div>
          </div>

        </div>

        {/* Sub-Filters: Status & Program */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 text-xs">
          
          {/* Status Tabs */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-slate-400 font-bold text-[11px] mr-1">สถานะ:</span>
            {[
              { id: 'all', label: 'ทั้งหมด' },
              { id: 'Active', label: 'กำลังเช่า' },
              { id: 'expiring', label: `ใกล้หมดอายุ (${summary.expiringCount})`, color: 'text-amber-700 bg-amber-50 border-amber-200' },
              { id: 'overdue', label: `ค้างชำระ (${summary.overdueCount})`, color: 'text-rose-700 bg-rose-50 border-rose-200' },
              { id: 'ConvertedToBuy', label: 'เปลี่ยนเป็นซื้อแล้ว' },
              { id: 'MovedOut', label: 'ย้ายออกแล้ว' },
              { id: 'Cancelled', label: 'ยกเลิก' },
            ].map((tab: any) => {
              const isActive = statusFilter === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setStatusFilter(tab.id)}
                  className={`px-3 py-1.5 rounded-xl font-bold transition-all cursor-pointer ${
                    isActive
                      ? 'bg-slate-900 text-white shadow-xs'
                      : tab.color || 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* Program Filter */}
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400 font-bold text-[11px]">โปรแกรม:</span>
            <button
              onClick={() => setProgramFilter('all')}
              className={`px-2.5 py-1 rounded-lg font-bold text-[11px] transition-all cursor-pointer ${
                programFilter === 'all' ? 'bg-amber-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              ทั้งหมด
            </button>
            <button
              onClick={() => setProgramFilter('program_a')}
              className={`px-2.5 py-1 rounded-lg font-bold text-[11px] transition-all cursor-pointer ${
                programFilter === 'program_a' ? 'bg-blue-600 text-white' : 'bg-blue-50 text-blue-700 border border-blue-200/60 hover:bg-blue-100'
              }`}
            >
              แบบ A: เช่าทั่วไป
            </button>
            <button
              onClick={() => setProgramFilter('program_b')}
              className={`px-2.5 py-1 rounded-lg font-bold text-[11px] transition-all cursor-pointer ${
                programFilter === 'program_b' ? 'bg-amber-600 text-white' : 'bg-amber-50 text-amber-800 border border-amber-200/60 hover:bg-amber-100'
              }`}
            >
              แบบ B: เช่าซื้อ
            </button>
            <button
              onClick={() => setProgramFilter('program_c')}
              className={`px-2.5 py-1 rounded-lg font-bold text-[11px] transition-all cursor-pointer ${
                programFilter === 'program_c' ? 'bg-purple-600 text-white' : 'bg-purple-50 text-purple-700 border border-purple-200/60 hover:bg-purple-100'
              }`}
            >
              แบบ C: เช่าออม
            </button>
          </div>

        </div>
      </div>

      {/* 📄 Content Area: Table or Grid */}
      {loading ? (
        <div className="bg-white rounded-3xl border border-slate-200 p-16 text-center text-slate-400">
          <RefreshCw size={28} className="animate-spin mx-auto mb-3 text-amber-500" />
          <div className="font-bold text-slate-700 text-sm">กำลังโหลดข้อมูลสัญญาเช่า...</div>
          <div className="text-xs text-slate-400 mt-1">โปรดรอสักครู่</div>
        </div>
      ) : filteredContracts.length === 0 ? (
        <div className="bg-white rounded-3xl border border-slate-200 p-16 text-center space-y-3">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center border border-amber-200">
            <Key size={28} />
          </div>
          <div className="font-bold text-slate-800 text-base">ไม่พบสัญญาเช่าที่ตรงตามเงื่อนไข</div>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            คุณสามารถกดปุ่ม "ทำสัญญาเช่าใหม่" ด้านบนเพื่อเริ่มบันทึกข้อมูลสัญญาเช่าหลังแรกได้ทันที
          </p>
          <button
            onClick={() => setContractModal({ isOpen: true, lead: null, plotId: null })}
            className="px-5 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs inline-flex items-center gap-1.5 shadow-md shadow-amber-600/20 transition-all cursor-pointer"
          >
            <Plus size={16} /> ทำสัญญาเช่าใหม่
          </button>
        </div>
      ) : viewMode === 'table' ? (
        
        /* 📊 Table View */
        <div className="bg-white rounded-3xl border border-slate-200/90 shadow-2xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-500 font-black uppercase text-[10px] tracking-wider">
                  <th className="py-3.5 px-4">แปลง / โครงการ</th>
                  <th className="py-3.5 px-4">ผู้เช่า / ติดต่อ</th>
                  <th className="py-3.5 px-4">โปรแกรมเช่า</th>
                  <th className="py-3.5 px-4 text-right">ค่าเช่า / ด.</th>
                  <th className="py-3.5 px-4">ระยะเวลาสัญญา</th>
                  <th className="py-3.5 px-4 text-center">สถานะ</th>
                  <th className="py-3.5 px-4 text-right">จัดการสัญญา</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                {filteredContracts.map((contract) => {
                  const programInfo = RENTAL_PROGRAM_DETAILS[contract.program_type] || RENTAL_PROGRAM_DETAILS.program_a;
                  const daysRemaining = getRemainingDays(contract.lease_end_date);
                  const isExpiring = contract.status === 'Active' && daysRemaining <= 60 && daysRemaining >= 0;
                  const overdueAmount = overdueMap[contract.id] || overdueMap[contract.plot_id] || 0;
                  const isOverdue = contract.status === 'Active' && overdueAmount > 0;

                  return (
                    <tr key={contract.id} className="hover:bg-slate-50/80 transition-colors">
                      
                      {/* Plot & Project */}
                      <td className="py-3.5 px-4">
                        <div className="font-bold text-slate-900 flex items-center gap-1.5">
                          <Home size={14} className="text-slate-400" />
                          <span>แปลง {contract.plot_name || contract.plot_id}</span>
                        </div>
                        <div className="text-[11px] text-slate-400">
                          {contract.project_name}
                        </div>
                      </td>

                      {/* Tenant Info */}
                      <td className="py-3.5 px-4">
                        <div className="font-bold text-slate-900">
                          {contract.tenant_name}
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-slate-500 mt-0.5">
                          {contract.tenant_phone && (
                            <a 
                              href={`tel:${contract.tenant_phone}`}
                              className="text-emerald-700 hover:underline flex items-center gap-0.5 font-mono"
                            >
                              <Phone size={11} /> {contract.tenant_phone}
                            </a>
                          )}
                          {contract.agent_name && (
                            <span className="text-slate-400">
                              (เซลล์: {contract.agent_name})
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Program Badge */}
                      <td className="py-3.5 px-4">
                        <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold border ${
                          contract.program_type === 'program_a'
                            ? 'bg-blue-50 text-blue-800 border-blue-200'
                            : contract.program_type === 'program_b'
                            ? 'bg-amber-50 text-amber-800 border-amber-300'
                            : 'bg-purple-50 text-purple-800 border-purple-200'
                        }`}>
                          {programInfo.name}
                        </span>

                        {contract.program_type === 'program_b' && (contract.accumulated_savings || 0) > 0 && (
                          <div className="text-[10px] text-amber-800 font-mono mt-1 font-bold">
                            สะสมดาวน์: ฿{(contract.accumulated_savings || 0).toLocaleString()}
                          </div>
                        )}
                      </td>

                      {/* Monthly Rent */}
                      <td className="py-3.5 px-4 text-right">
                        <div className="font-bold font-mono text-slate-900 text-sm">
                          ฿{Number(contract.monthly_rent || 0).toLocaleString()}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          ประกัน: ฿{Number(contract.security_deposit || 0).toLocaleString()}
                        </div>
                      </td>

                      {/* Lease Duration & Expiry */}
                      <td className="py-3.5 px-4">
                        <div className="text-slate-700 font-mono text-[11px]">
                          {contract.lease_start_date} <span className="text-slate-400">ถึง</span> {contract.lease_end_date}
                        </div>
                        {contract.status === 'Active' && (
                          <div className={`text-[10px] font-bold mt-0.5 ${
                            daysRemaining <= 30
                              ? 'text-rose-600 animate-pulse'
                              : daysRemaining <= 60
                              ? 'text-amber-600'
                              : 'text-slate-400'
                          }`}>
                            {daysRemaining < 0
                              ? `หมดอายุแล้ว ${Math.abs(daysRemaining)} วัน`
                              : `เหลืออีก ${daysRemaining} วัน`}
                          </div>
                        )}
                      </td>

                      {/* Status */}
                      <td className="py-3.5 px-4 text-center">
                        {isOverdue ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-rose-100 text-rose-800 border border-rose-200 animate-pulse">
                            ⚠️ ค้างชำระ (฿{overdueAmount.toLocaleString()})
                          </span>
                        ) : isExpiring ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-100 text-amber-800 border border-amber-300">
                            ⏳ สัญญาใกล้หมด
                          </span>
                        ) : contract.status === 'Active' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <CheckCircle2 size={11} /> กำลังเช่า
                          </span>
                        ) : contract.status === 'ConvertedToBuy' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                            🎉 ซื้อบ้านแล้ว
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600">
                            {contract.status}
                          </span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          
                          {/* 💳 ตารางค่างวด & รับเงิน */}
                          <button
                            type="button"
                            onClick={() => setLedgerModal({
                              isOpen: true,
                              contractId: contract.id,
                              plotId: contract.plot_id,
                              projectName: contract.project_name,
                              plot: { id: contract.plot_id, plot_name: contract.plot_name, project_name: contract.project_name },
                              lead: contract.lead_id ? { id: contract.lead_id, customer_name: contract.tenant_name, phone: contract.tenant_phone || undefined } : null
                            })}
                            className="p-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold transition-colors cursor-pointer"
                            title="เปิดตารางค่างวด & บันทึกรับชำระเงิน"
                          >
                            <CreditCard size={15} className="text-emerald-700" />
                          </button>

                          {/* ⚡ ดำเนินการ (ต่อสัญญา/ซื้อบ้าน/ย้ายออก) */}
                          <button
                            type="button"
                            onClick={() => setActionModal({
                              isOpen: true,
                              plot: { id: contract.plot_id, plot_name: contract.plot_name, project_name: contract.project_name },
                              lead: contract.lead_id ? { id: contract.lead_id, customer_name: contract.tenant_name, phone: contract.tenant_phone || undefined } as any : null
                            })}
                            className="p-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold transition-colors cursor-pointer"
                            title="ดำเนินการ: เปลี่ยนเป็นซื้อบ้าน / ต่อสัญญา / ย้ายออก"
                          >
                            <Key size={15} className="text-amber-700" />
                          </button>

                          {/* 🔧 แจ้งซ่อมบำรุง */}
                          <button
                            type="button"
                            onClick={() => setMaintenanceModal({
                              isOpen: true,
                              plotId: contract.plot_id,
                              plotName: contract.plot_name || undefined,
                              projectName: contract.project_name,
                              lead: contract.lead_id ? { id: contract.lead_id, customer_name: contract.tenant_name, phone: contract.tenant_phone || undefined } as any : null
                            })}
                            className="p-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold transition-colors cursor-pointer"
                            title="บันทึกแจ้งซ่อมระหว่างเช่า (Maintenance)"
                          >
                            <Wrench size={15} className="text-blue-700" />
                          </button>

                          {/* 📱 Mobile Portal ผู้เช่า */}
                          <button
                            type="button"
                            onClick={() => handleOpenPortal(contract)}
                            className="p-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold transition-colors cursor-pointer"
                            title="เปิดดูหน้า Portal ผู้เช่า (Mobile & PromptPay QR)"
                          >
                            <Smartphone size={15} className="text-purple-700" />
                          </button>

                          {/* 🗑️ ลบข้อมูล (เฉพาะ Admin) */}
                          {isAdmin && contract.lead_id && (
                            <button
                              type="button"
                              onClick={() => setDeleteModal({
                                isOpen: true,
                                lead: {
                                  id: contract.lead_id || '',
                                  customer_name: contract.tenant_name,
                                  interested_plot_id: contract.plot_id,
                                  interested_plot_name: contract.plot_name,
                                  project_name: contract.project_name,
                                  phone: contract.tenant_phone || ''
                                } as any
                              })}
                              className="p-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-600 transition-colors cursor-pointer"
                              title="ลบข้อมูลสัญญาและลูกค้า (Admin)"
                            >
                              <Trash2 size={15} />
                            </button>
                          )}

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
        
        /* 📱 Grid View */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredContracts.map((contract) => {
            const programInfo = RENTAL_PROGRAM_DETAILS[contract.program_type] || RENTAL_PROGRAM_DETAILS.program_a;
            const daysRemaining = getRemainingDays(contract.lease_end_date);
            const isExpiring = contract.status === 'Active' && daysRemaining <= 60 && daysRemaining >= 0;
            const overdueAmount = overdueMap[contract.id] || overdueMap[contract.plot_id] || 0;
            const isOverdue = contract.status === 'Active' && overdueAmount > 0;

            return (
              <div
                key={contract.id}
                className="bg-white rounded-3xl border border-slate-200/90 shadow-2xs p-5 space-y-4 hover:shadow-md transition-shadow relative overflow-hidden flex flex-col justify-between"
              >
                {/* Top Program Banner */}
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black border ${
                      contract.program_type === 'program_a'
                        ? 'bg-blue-50 text-blue-800 border-blue-200'
                        : contract.program_type === 'program_b'
                        ? 'bg-amber-50 text-amber-900 border-amber-300'
                        : 'bg-purple-50 text-purple-800 border-purple-200'
                    }`}>
                      {programInfo.name}
                    </span>
                    <h3 className="font-black text-slate-900 text-base mt-1.5 flex items-center gap-1.5">
                      <Home size={16} className="text-amber-600" />
                      แปลง {contract.plot_name || contract.plot_id}
                    </h3>
                    <p className="text-xs text-slate-400">{contract.project_name}</p>
                  </div>

                  {/* Status Tag */}
                  <div>
                    {isOverdue ? (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-rose-100 text-rose-800 border border-rose-200 animate-pulse">
                        ค้างชำระ ฿{overdueAmount.toLocaleString()}
                      </span>
                    ) : isExpiring ? (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-100 text-amber-800 border border-amber-300">
                        ใกล้หมดใน {daysRemaining} วัน
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                        {contract.status}
                      </span>
                    )}
                  </div>
                </div>

                {/* Tenant Details Box */}
                <div className="p-3 bg-slate-50 rounded-2xl space-y-1.5 border border-slate-100">
                  <div className="flex items-center justify-between text-xs font-bold text-slate-800">
                    <span>{contract.tenant_name}</span>
                    {contract.tenant_phone && (
                      <a href={`tel:${contract.tenant_phone}`} className="text-emerald-700 hover:underline flex items-center gap-1 font-mono text-[11px]">
                        <Phone size={12} /> {contract.tenant_phone}
                      </a>
                    )}
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1 border-t border-slate-200/60 font-mono">
                    <span>สัญญา: {contract.lease_start_date} ~ {contract.lease_end_date}</span>
                    <span>({contract.lease_duration_months} ด.)</span>
                  </div>
                </div>

                {/* Financial Overview */}
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="p-2.5 bg-slate-50/80 rounded-xl border border-slate-100">
                    <span className="text-[10px] text-slate-400 block">ค่าเช่ารายเดือน</span>
                    <span className="font-black text-slate-900 font-mono text-sm">
                      ฿{Number(contract.monthly_rent || 0).toLocaleString()}
                    </span>
                  </div>

                  <div className="p-2.5 bg-slate-50/80 rounded-xl border border-slate-100">
                    <span className="text-[10px] text-slate-400 block">
                      {contract.program_type === 'program_b' ? 'ยอดสะสมดาวน์' : 'เงินประกันการเช่า'}
                    </span>
                    <span className="font-black font-mono text-sm text-slate-900">
                      ฿{contract.program_type === 'program_b' 
                        ? Number(contract.accumulated_savings || 0).toLocaleString() 
                        : Number(contract.security_deposit || 0).toLocaleString()}
                    </span>
                  </div>
                </div>

                {/* Action Button Strip */}
                <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-1.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setLedgerModal({
                      isOpen: true,
                      contractId: contract.id,
                      plotId: contract.plot_id,
                      projectName: contract.project_name,
                      plot: { id: contract.plot_id, plot_name: contract.plot_name, project_name: contract.project_name },
                      lead: contract.lead_id ? { id: contract.lead_id, customer_name: contract.tenant_name, phone: contract.tenant_phone || undefined } : null
                    })}
                    className="flex-1 py-2 px-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold flex items-center justify-center gap-1 transition-colors cursor-pointer shadow-xs"
                  >
                    <CreditCard size={14} /> ตารางค่างวด
                  </button>

                  <button
                    type="button"
                    onClick={() => setActionModal({
                      isOpen: true,
                      plot: { id: contract.plot_id, plot_name: contract.plot_name, project_name: contract.project_name },
                      lead: contract.lead_id ? { id: contract.lead_id, customer_name: contract.tenant_name, phone: contract.tenant_phone || undefined } as any : null
                    })}
                    className="p-2 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 transition-colors cursor-pointer"
                    title="ดำเนินการสัญญา (ซื้อบ้าน/ต่อสัญญา/ย้ายออก)"
                  >
                    <Key size={15} />
                  </button>

                  <button
                    type="button"
                    onClick={() => handleOpenPortal(contract)}
                    className="p-2 rounded-xl bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 transition-colors cursor-pointer"
                    title="Portal ผู้เช่า (Mobile)"
                  >
                    <Smartphone size={15} />
                  </button>

                  <button
                    type="button"
                    onClick={() => setMaintenanceModal({
                      isOpen: true,
                      plotId: contract.plot_id,
                      plotName: contract.plot_name || undefined,
                      projectName: contract.project_name,
                      lead: contract.lead_id ? { id: contract.lead_id, customer_name: contract.tenant_name, phone: contract.tenant_phone || undefined } as any : null
                    })}
                    className="p-2 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 transition-colors cursor-pointer"
                    title="แจ้งซ่อมบำรุง"
                  >
                    <Wrench size={15} />
                  </button>
                </div>

              </div>
            );
          })}
        </div>
      )}

      {/* 🌟 Modal 1: Rental Contract Creation */}
      {contractModal.isOpen && (
        <RentalContractModal
          isOpen={contractModal.isOpen}
          onClose={() => setContractModal({ isOpen: false, lead: null, plotId: null })}
          lead={contractModal.lead}
          plotId={contractModal.plotId}
          projectName={selectedProject !== 'all' ? selectedProject : 'ไอลิน สันทราย 2'}
          user={user}
          onSaved={fetchContractsData}
        />
      )}

      {/* 🌟 Modal 2: Rental Payment Ledger */}
      {ledgerModal.isOpen && (
        <RentalPaymentLedgerModal
          isOpen={ledgerModal.isOpen}
          onClose={() => setLedgerModal({ isOpen: false })}
          contractId={ledgerModal.contractId}
          plotId={ledgerModal.plotId}
          projectName={ledgerModal.projectName || selectedProject}
          plot={ledgerModal.plot}
          lead={ledgerModal.lead}
          user={user}
          onSaved={fetchContractsData}
        />
      )}

      {/* 🌟 Modal 3: Rental Action (Convert to Buy / Renew / Move Out) */}
      {actionModal.isOpen && (
        <RentalActionModal
          isOpen={actionModal.isOpen}
          onClose={() => setActionModal({ isOpen: false })}
          lead={actionModal.lead}
          plot={actionModal.plot}
          user={user}
          onSaved={fetchContractsData}
        />
      )}

      {/* 🌟 Modal 4: Rental Maintenance Tickets */}
      {maintenanceModal.isOpen && (
        <RentalMaintenanceModal
          isOpen={maintenanceModal.isOpen}
          onClose={() => setMaintenanceModal({ isOpen: false })}
          plotId={maintenanceModal.plotId}
          plotName={maintenanceModal.plotName}
          projectName={maintenanceModal.projectName || selectedProject}
          lead={maintenanceModal.lead}
          user={user}
          onSaved={fetchContractsData}
        />
      )}

      {/* 🌟 Modal 5: Tenant Portal Mobile Preview */}
      {portalModal.isOpen && (
        <TenantPortalModal
          isOpen={portalModal.isOpen}
          onClose={() => setPortalModal({ isOpen: false, contract: null, payments: [] })}
          contract={portalModal.contract}
          payments={portalModal.payments}
          onOpenMaintenance={() => {
            if (portalModal.contract) {
              setPortalModal({ isOpen: false, contract: null, payments: [] });
              setMaintenanceModal({
                isOpen: true,
                plotId: portalModal.contract.plot_id,
                plotName: portalModal.contract.plot_name,
                projectName: portalModal.contract.project_name
              });
            }
          }}
        />
      )}

      {/* 🌟 Modal 6: Admin Cascading Deletion */}
      {deleteModal.isOpen && deleteModal.lead && (
        <AdminDeleteCustomerModal
          isOpen={deleteModal.isOpen}
          onClose={() => setDeleteModal({ isOpen: false, lead: null })}
          lead={deleteModal.lead}
          user={user}
          onDeleted={fetchContractsData}
        />
      )}

    </div>
  );
}
