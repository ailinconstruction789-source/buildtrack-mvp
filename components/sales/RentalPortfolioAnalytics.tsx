"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { 
  PiggyBank, 
  TrendingUp, 
  Home, 
  DollarSign, 
  Sparkles, 
  Building, 
  PieChart, 
  CheckCircle2, 
  Clock, 
  AlertCircle, 
  Calendar,
  Key,
  Users,
  Coins,
  RefreshCw,
  BookmarkCheck,
  Tag,
  ShieldCheck,
  FileCheck,
  ArrowRight
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { RentalContract, RentalProgramType, RENTAL_PROGRAM_DETAILS, Lead } from '@/types/sales';
import { parseRentalInceptionDetails } from '@/lib/rentalHelper';

interface RentalPortfolioAnalyticsProps {
  projectName?: string;
  onRefresh?: () => void;
}

export default function RentalPortfolioAnalytics({
  projectName,
  onRefresh
}: RentalPortfolioAnalyticsProps) {
  const [contracts, setContracts] = useState<RentalContract[]>([]);
  const [bookedLeads, setBookedLeads] = useState<Lead[]>([]);
  const [totalPlotsCount, setTotalPlotsCount] = useState<number>(0);
  const [loading, setLoading] = useState(false);

  const fetchData = async (isCancelled = false) => {
    setLoading(true);
    try {
      // 1. Fetch total plots for occupancy calculation
      let plotsQuery = supabase.from('plots').select('id, project_name, sale_status, monthly_rent');
      if (projectName && projectName !== 'all') {
        plotsQuery = plotsQuery.eq('project_name', projectName);
      }
      const { data: plotsData } = await plotsQuery;
      if (!isCancelled) {
        setTotalPlotsCount(plotsData?.length || 0);
      }

      // 2. Fetch all rental contracts (Active, Renewed, ConvertedToBuy, MovedOut, Cancelled)
      let contractsQuery = supabase
        .from('rental_contracts')
        .select('*')
        .order('created_at', { ascending: false });

      if (projectName && projectName !== 'all') {
        contractsQuery = contractsQuery.eq('project_name', projectName);
      }

      const { data: contractsData } = await contractsQuery;
      if (!isCancelled) {
        setContracts(contractsData || []);
      }

      // 3. Fetch rental booking leads (PendingContract or rental deal in Reserved)
      let bookedLeadsQuery = supabase
        .from('leads')
        .select('*')
        .or('rental_status.eq.PendingContract,and(deal_type.eq.rent,status.eq.Reserved)')
        .order('booking_date', { ascending: false, nullsFirst: false });

      if (projectName && projectName !== 'all') {
        bookedLeadsQuery = bookedLeadsQuery.eq('project_name', projectName);
      }

      const { data: leadsData } = await bookedLeadsQuery;
      if (!isCancelled) {
        // Exclude leads that already have an active contract in contractsData
        const activeLeadIds = new Set((contractsData || []).filter(c => ['Active', 'Renewed'].includes(c.status)).map(c => c.lead_id).filter(Boolean));
        const pendingList = (leadsData || []).filter(l => !activeLeadIds.has(l.id));
        setBookedLeads(pendingList as Lead[]);
      }

    } catch (err) {
      console.error('Error fetching rental portfolio analytics:', err);
    } finally {
      if (!isCancelled) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    let isCancelled = false;
    fetchData(isCancelled);
    return () => {
      isCancelled = true;
    };
  }, [projectName]);

  // Aggregate Metrics & Analytics
  const stats = useMemo(() => {
    // 1. Active Contracts
    const activeContracts = contracts.filter(c => ['Active', 'Renewed'].includes(c.status));
    const activeUnits = activeContracts.length;
    const occupancyRate = totalPlotsCount > 0 ? (activeUnits / totalPlotsCount) * 100 : 0;

    let monthlyRevenue = 0;
    let totalSecurityDeposit = 0;
    let totalAdvanceRent = 0;
    let totalContractFee = 0;
    let programACount = 0;
    let programBCount = 0;
    let programCCount = 0;
    let programBMonthlyRent = 0;
    let programCMonthlyRent = 0;
    let totalRentToOwnSavings = 0;

    activeContracts.forEach((c) => {
      const inception = parseRentalInceptionDetails(c);
      const rent = Number(c.monthly_rent || 0);
      const deposit = inception.securityDeposit !== null && inception.securityDeposit !== undefined
        ? Number(inception.securityDeposit)
        : Number(c.security_deposit || 0);
      const advance = inception.advanceRent !== null && inception.advanceRent !== undefined
        ? Number(inception.advanceRent)
        : Number(c.advance_rent || 0);
      const fee = inception.contractFee !== null && inception.contractFee !== undefined
        ? Number(inception.contractFee)
        : (Number(c.contract_fee || 0) > 0 ? Number(c.contract_fee) : (c.program_type === 'program_c' ? 20000 : 0));
      const savings = Number(c.accumulated_savings || 0);

      monthlyRevenue += rent;
      totalSecurityDeposit += deposit;
      totalAdvanceRent += advance;
      totalContractFee += fee;
      totalRentToOwnSavings += savings;

      if (c.program_type === 'program_a') {
        programACount++;
      } else if (c.program_type === 'program_b') {
        programBCount++;
        programBMonthlyRent += rent;
      } else if (c.program_type === 'program_c') {
        programCCount++;
        programCMonthlyRent += rent;
      }
    });

    const projectedAnnualYield = monthlyRevenue * 12;

    // 2. Booking Data (งานจองเช่าใหม่)
    const bookingUnits = bookedLeads.length;
    let totalBookingDepositPool = 0;
    let projectedFirstMonthRent = 0;
    let projectedBookingDeposits = 0;
    let bookingProgramA = 0;
    let bookingProgramB = 0;
    let bookingProgramC = 0;

    bookedLeads.forEach(l => {
      const bAmount = Number(l.booking_amount || l.bookingAmount || 0);
      const rent = Number(l.rental_monthly_rent || 0);
      const deposit = Number(l.rental_deposit || (rent * 2));

      totalBookingDepositPool += bAmount;
      projectedFirstMonthRent += rent;
      projectedBookingDeposits += deposit;

      const prog = l.rental_program || 'program_a';
      if (prog === 'program_a') bookingProgramA++;
      else if (prog === 'program_b') bookingProgramB++;
      else if (prog === 'program_c') bookingProgramC++;
    });

    // 3. Lifecycle / Pipeline Funnel
    const convertedToBuyCount = contracts.filter(c => c.status === 'ConvertedToBuy').length;
    const movedOutCount = contracts.filter(c => ['MovedOut', 'Terminated'].includes(c.status)).length;
    const cancelledCount = contracts.filter(c => c.status === 'Cancelled').length;
    const totalLifetimeManaged = activeUnits + bookingUnits + convertedToBuyCount + movedOutCount;

    // 4. Combined Financial Inflow Pool (เงินสดรวมที่บริหารจัดการ)
    const totalManagedDepositPool = totalSecurityDeposit + totalBookingDepositPool;

    return {
      activeUnits,
      occupancyRate,
      monthlyRevenue,
      projectedAnnualYield,
      totalSecurityDeposit,
      totalAdvanceRent,
      totalContractFee,
      totalRentToOwnSavings,
      totalManagedDepositPool,
      programACount,
      programBCount,
      programCCount,
      programBMonthlyRent,
      programCMonthlyRent,
      // Booking data
      bookingUnits,
      totalBookingDepositPool,
      projectedFirstMonthRent,
      bookingProgramA,
      bookingProgramB,
      bookingProgramC,
      // Funnel
      convertedToBuyCount,
      movedOutCount,
      cancelledCount,
      totalLifetimeManaged
    };
  }, [contracts, bookedLeads, totalPlotsCount]);

  return (
    <div className="space-y-4">

      {/* Header Refresh Bar */}
      <div className="flex items-center justify-between bg-white px-4 py-2.5 rounded-2xl border border-slate-200/90 shadow-2xs">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-700">
          <Sparkles size={15} className="text-amber-500" />
          <span>รายงานวิเคราะห์พอร์ตบ้านเช่า & สถานะการจอง (Ailin Rental Insights)</span>
          {projectName && projectName !== 'all' && (
            <span className="px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 border border-blue-200 text-[11px]">
              {projectName}
            </span>
          )}
        </div>
        <button
          onClick={() => { fetchData(); onRefresh?.(); }}
          disabled={loading}
          className="p-1.5 rounded-xl hover:bg-slate-100 text-slate-500 hover:text-slate-800 transition-colors flex items-center gap-1.5 text-xs font-bold cursor-pointer"
          title="รีเฟรชข้อมูลรายงาน"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          <span>{loading ? 'กำลังโหลด...' : 'รีเฟรช'}</span>
        </button>
      </div>
      
      {/* 🚀 Main KPI Metric Cards (5 Cards Grid) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        
        {/* Card 1: Active Rental Units & Occupancy */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200/90 shadow-2xs space-y-1.5">
          <div className="flex items-center justify-between text-slate-500 text-xs font-bold">
            <span className="flex items-center gap-1.5 text-slate-700">
              <Home size={15} className="text-blue-600" /> บ้านกำลังเช่า (Active)
            </span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 font-mono font-bold">
              {stats.occupancyRate.toFixed(1)}% เช่า
            </span>
          </div>

          <div className="text-2xl font-black text-slate-900 font-mono flex items-baseline gap-1.5">
            {stats.activeUnits} <span className="text-xs font-normal text-slate-500">/ {totalPlotsCount} แปลงทั้งหมด</span>
          </div>

          <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
            <div 
              className="bg-blue-600 h-full rounded-full transition-all duration-500" 
              style={{ width: `${Math.min(100, stats.occupancyRate)}%` }}
            />
          </div>
          <p className="text-[10px] text-slate-400">คิดเป็น {stats.occupancyRate.toFixed(1)}% ของบ้านในโครงการ</p>
        </div>

        {/* Card 2: NEW - Pending Rental Bookings & Booking Deposits (งานจองเช่า) */}
        <div className="bg-gradient-to-br from-amber-50/80 via-white to-amber-50/40 p-4 rounded-2xl border border-amber-300 shadow-2xs space-y-1.5">
          <div className="flex items-center justify-between text-amber-900 text-xs font-bold">
            <span className="flex items-center gap-1.5">
              <BookmarkCheck size={15} className="text-amber-600" /> จองเช่ารอทำสัญญา
            </span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300 font-bold">
              {stats.bookingUnits} แปลง
            </span>
          </div>

          <div className="text-2xl font-black text-amber-950 font-mono">
            ฿{stats.totalBookingDepositPool.toLocaleString()} <span className="text-xs font-normal text-amber-800">บ.</span>
          </div>

          <p className="text-[10px] text-amber-800 font-medium">
            เงินจองเช่าถือครอง • รอทำสัญญา {stats.bookingUnits} ราย
          </p>
        </div>

        {/* Card 3: Monthly Recurring Cash Flow */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200/90 shadow-2xs space-y-1.5">
          <div className="flex items-center justify-between text-slate-500 text-xs font-bold">
            <span className="flex items-center gap-1.5 text-emerald-800">
              <TrendingUp size={15} className="text-emerald-600" /> ค่าเช่าหมุนเวียน/เดือน
            </span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold">
              Recurring
            </span>
          </div>

          <div className="text-2xl font-black text-emerald-950 font-mono">
            ฿{stats.monthlyRevenue.toLocaleString()} <span className="text-xs font-normal text-emerald-700">บ./ด.</span>
          </div>

          <p className="text-[10px] text-slate-500">
            ประมาณการ <b>฿{stats.projectedAnnualYield.toLocaleString()}</b> บ./ปี
          </p>
        </div>

        {/* Card 4: Program B Rent-to-Own Savings Pool */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200/90 shadow-2xs space-y-1.5">
          <div className="flex items-center justify-between text-amber-800 text-xs font-bold">
            <span className="flex items-center gap-1.5">
              <PiggyBank size={15} className="text-amber-600" /> ออมดาวน์ (แบบ B)
            </span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300 font-bold">
              Rent to Own
            </span>
          </div>

          <div className="text-2xl font-black text-amber-950 font-mono">
            ฿{stats.totalRentToOwnSavings.toLocaleString()} <span className="text-xs font-normal text-amber-800">บาท</span>
          </div>

          <p className="text-[10px] text-amber-800">
            เงินสะสมของลูกค้า <b>{stats.programBCount} ราย</b> รอแปลงซื้อ
          </p>
        </div>

        {/* Card 5: Security Deposits & Fees Pool */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200/90 shadow-2xs space-y-1.5">
          <div className="flex items-center justify-between text-slate-500 text-xs font-bold">
            <span className="flex items-center gap-1.5 text-indigo-900">
              <ShieldCheck size={15} className="text-indigo-600" /> ประกัน & ค่าสัญญาถือครอง
            </span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 font-bold">
              Inflow
            </span>
          </div>

          <div className="text-2xl font-black text-indigo-950 font-mono">
            ฿{stats.totalSecurityDeposit.toLocaleString()} <span className="text-xs font-normal text-indigo-700">บาท</span>
          </div>

          <p className="text-[10px] text-slate-500">
            ค่าสัญญา C: ฿{stats.totalContractFee.toLocaleString()} • ประกันคืนเมื่อหมดสัญญา
          </p>
        </div>

      </div>

      {/* 🔄 Section 2: Complete Rental Funnel / Pipeline (วงจรงานเช่าครบวงจร) */}
      <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/90 shadow-2xs space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-slate-100">
          <div>
            <h4 className="font-bold text-xs sm:text-sm text-slate-900 flex items-center gap-1.5">
              <PieChart size={16} className="text-blue-600" />
              <span>ภาพรวมวงจรงานเช่าครบวงจร (Rental Lifecycle & Conversion Funnel)</span>
            </h4>
            <p className="text-[11px] text-slate-500">
              ติดตามเส้นทางลูกค้าตั้งแต่ล็อกแปลงจองเช่า $\rightarrow$ เซ็นสัญญาเช่าจริง $\rightarrow$ เปลี่ยนเป็นเจ้าของบ้าน
            </p>
          </div>
          <span className="text-xs font-bold px-2.5 py-1 rounded-xl bg-slate-100 text-slate-700 self-start sm:self-auto">
            รวมทุกสถานะ: {stats.totalLifetimeManaged} รายการ
          </span>
        </div>

        {/* Funnel Progress Breakdown Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          
          {/* Stage 1: จองเช่าแล้ว */}
          <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-xl space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-amber-900 flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-amber-500"></span> 1. จองเช่ารอสัญญา
              </span>
              <span className="text-xs font-black text-amber-800 font-mono">{stats.bookingUnits} หลัง</span>
            </div>
            <p className="text-[10px] text-amber-700">
              เงินจองรวม <b>฿{stats.totalBookingDepositPool.toLocaleString()}</b> บ.
            </p>
          </div>

          {/* Stage 2: สัญญาเช่ามีผล (Active) */}
          <div className="p-3 bg-blue-50/70 border border-blue-200 rounded-xl space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-blue-900 flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-blue-500"></span> 2. กำลังเช่าจริง (Active)
              </span>
              <span className="text-xs font-black text-blue-800 font-mono">{stats.activeUnits} หลัง</span>
            </div>
            <p className="text-[10px] text-blue-700">
              รายรับค่าเช่า <b>฿{stats.monthlyRevenue.toLocaleString()}</b> บ./ด.
            </p>
          </div>

          {/* Stage 3: เปลี่ยนเป็นซื้อบ้านสำเร็จ (Won) */}
          <div className="p-3 bg-emerald-50/70 border border-emerald-200 rounded-xl space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-emerald-900 flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-emerald-500"></span> 3. แปลงเป็นซื้อสำเร็จ 🏡
              </span>
              <span className="text-xs font-black text-emerald-800 font-mono">{stats.convertedToBuyCount} หลัง</span>
            </div>
            <p className="text-[10px] text-emerald-700">
              {stats.convertedToBuyCount > 0 ? 'แปลงสิทธิ์ซื้อบ้านสำเร็จแล้ว' : 'ยังไม่มีการแปลงสิทธิ์'}
            </p>
          </div>

          {/* Stage 4: ย้ายออก / สิ้นสุดสัญญา */}
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-700 flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-slate-400"></span> 4. ย้ายออก / ครบสัญญา
              </span>
              <span className="text-xs font-black text-slate-700 font-mono">{stats.movedOutCount} หลัง</span>
            </div>
            <p className="text-[10px] text-slate-500">
              คืนเงินประกันตามเงื่อนไข
            </p>
          </div>

        </div>
      </div>

      {/* 📊 Section 3: Program A, B, C In-Depth Breakdown */}
      <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/90 shadow-2xs space-y-3">
        <h4 className="font-bold text-xs sm:text-sm text-slate-800 flex items-center gap-1.5">
          <Coins size={16} className="text-amber-600" />
          <span>วิเคราะห์มูลค่าและศักยภาพตามประเภทโปรแกรม (Program A / B / C Economics)</span>
        </h4>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          
          {/* Program A Card */}
          <div className="p-4 bg-gradient-to-b from-blue-50/70 to-blue-50/30 border border-blue-200 rounded-2xl space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-xs text-blue-950 flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-blue-500"></span> แบบ A: Rent (เช่าทั่วไป)
              </span>
              <span className="text-sm font-black text-blue-700 font-mono">{stats.programACount} หลัง</span>
            </div>
            <div className="space-y-1 text-xs">
              <div className="flex justify-between text-slate-600">
                <span>กำลังเช่าอยู่:</span>
                <b className="text-slate-900">{stats.programACount} สัญญา</b>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>จองเช่ารอสัญญา:</span>
                <b className="text-amber-800">{stats.bookingProgramA} ราย</b>
              </div>
            </div>
            <div className="pt-2 border-t border-blue-200/60 text-[11px] text-slate-600">
              📌 เงินประกัน 2 เดือน • เหมาะกับลูกค้าเน้นอยู่อาศัย ไม่ได้วางแผนซื้อบ้าน
            </div>
          </div>

          {/* Program B Card */}
          <div className="p-4 bg-gradient-to-b from-amber-50/70 to-amber-50/30 border border-amber-300 rounded-2xl space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-xs text-amber-950 flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-amber-500"></span> แบบ B: Rent to Own (เช่าซื้อ)
              </span>
              <span className="text-sm font-black text-amber-800 font-mono">{stats.programBCount} หลัง</span>
            </div>
            <div className="space-y-1 text-xs">
              <div className="flex justify-between text-slate-600">
                <span>ยอดเงินออมดาวน์สะสม:</span>
                <b className="text-amber-900 font-bold">฿{stats.totalRentToOwnSavings.toLocaleString()} บ.</b>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>ค่าเช่าเฉลี่ยรวม/เดือน:</span>
                <b className="text-slate-900">฿{stats.programBMonthlyRent.toLocaleString()} บ./ด.</b>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>จองเช่ารอสัญญา:</span>
                <b className="text-amber-800">{stats.bookingProgramB} ราย</b>
              </div>
            </div>
            <div className="pt-2 border-t border-amber-200 text-[11px] text-amber-900 font-medium">
              💡 สะสมเงินดาวน์ +5,000 บ./เดือน ตัดเป็นส่วนลดเงินซื้อบ้านเมื่อพร้อมกู้
            </div>
          </div>

          {/* Program C Card */}
          <div className="p-4 bg-gradient-to-b from-purple-50/70 to-purple-50/30 border border-purple-200 rounded-2xl space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-xs text-purple-950 flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-purple-500"></span> แบบ C: Rent & Save (เช่าออม)
              </span>
              <span className="text-sm font-black text-purple-700 font-mono">{stats.programCCount} หลัง</span>
            </div>
            <div className="space-y-1 text-xs">
              <div className="flex justify-between text-slate-600">
                <span>ค่าธรรมเนียมสัญญาเช่าออม:</span>
                <b className="text-purple-900 font-bold">฿{stats.totalContractFee.toLocaleString()} บ.</b>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>ค่าเช่าเฉลี่ยรวม/เดือน:</span>
                <b className="text-slate-900">฿{stats.programCMonthlyRent.toLocaleString()} บ./ด.</b>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>จองเช่ารอสัญญา:</span>
                <b className="text-amber-800">{stats.bookingProgramC} ราย</b>
              </div>
            </div>
            <div className="pt-2 border-t border-purple-200/60 text-[11px] text-purple-900 font-medium">
              🏷️ ลดราคาบ้าน 10% (ปีที่ 1) / 5% (ปีที่ 2) • ปี 4+ ดอกเบี้ย 8%
            </div>
          </div>

        </div>
      </div>

      {/* 🟡 Section 4: รายการแปลงที่ติดจองเช่าอยู่ขณะนี้ (Pending Rental Bookings) */}
      {bookedLeads.length > 0 && (
        <div className="bg-white p-4 sm:p-5 rounded-2xl border border-amber-300 shadow-2xs space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-amber-100">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse"></span>
              <h4 className="font-bold text-xs sm:text-sm text-amber-950 flex items-center gap-1.5">
                <span>รายการแปลงที่วางเงินจองเช่าแล้ว (รอทำสัญญาจริง): {bookedLeads.length} รายการ</span>
              </h4>
            </div>
            <span className="text-[11px] font-bold text-amber-900 bg-amber-100 px-2.5 py-0.5 rounded-full">
              เงินจองรวม: ฿{stats.totalBookingDepositPool.toLocaleString()} บาท
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-slate-400 font-bold text-[11px]">
                  <th className="py-2 px-2.5">แปลงบ้าน</th>
                  <th className="py-2 px-2.5">ผู้จองเช่า</th>
                  <th className="py-2 px-2.5">โปรแกรม</th>
                  <th className="py-2 px-2.5 text-right">เงินจองเช่า</th>
                  <th className="py-2 px-2.5 text-right">ค่างวดตกลง</th>
                  <th className="py-2 px-2.5">วันที่จอง</th>
                  <th className="py-2 px-2.5">วันที่นัดเริ่มสัญญา</th>
                  <th className="py-2 px-2.5">ผู้ดูแล</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {bookedLeads.map(lead => {
                  const plotName = lead.interested_plot_name || lead.interested_plot_id || '-';
                  const prog = lead.rental_program || 'program_a';
                  const progLabel = prog === 'program_b' ? 'แบบ B: เช่าซื้อ' : prog === 'program_c' ? 'แบบ C: เช่าออม' : 'แบบ A: เช่าทั่วไป';
                  const progColor = prog === 'program_b' ? 'bg-amber-50 text-amber-900 border-amber-200' : prog === 'program_c' ? 'bg-purple-50 text-purple-900 border-purple-200' : 'bg-blue-50 text-blue-900 border-blue-200';
                  const bookingAmount = Number(lead.booking_amount || lead.bookingAmount || 0);
                  const rent = Number(lead.rental_monthly_rent || 0);

                  return (
                    <tr key={lead.id} className="hover:bg-amber-50/40 transition-colors">
                      <td className="py-2.5 px-2.5 font-black text-amber-900">
                        แปลง {plotName}
                      </td>
                      <td className="py-2.5 px-2.5">
                        <div className="font-bold text-slate-900">{lead.customer_name}</div>
                        {lead.phone && <div className="text-[10px] text-slate-400">{lead.phone}</div>}
                      </td>
                      <td className="py-2.5 px-2.5">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${progColor}`}>
                          {progLabel}
                        </span>
                      </td>
                      <td className="py-2.5 px-2.5 text-right font-black text-amber-950 font-mono">
                        ฿{bookingAmount.toLocaleString()} บ.
                      </td>
                      <td className="py-2.5 px-2.5 text-right font-bold text-slate-800 font-mono">
                        ฿{rent.toLocaleString()} บ./ด.
                      </td>
                      <td className="py-2.5 px-2.5 text-slate-600">
                        {lead.booking_date ? String(lead.booking_date).split('T')[0] : (lead.bookingDate ? String(lead.bookingDate).split('T')[0] : '-')}
                      </td>
                      <td className="py-2.5 px-2.5 text-slate-600">
                        {lead.rental_start_date ? String(lead.rental_start_date).split('T')[0] : 'ยังไม่ระบุ'}
                      </td>
                      <td className="py-2.5 px-2.5 text-slate-500 font-medium">
                        {lead.agent_name || lead.sales_owner || lead.created_by_agent || 'ทีมขาย'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

    </div>
  );
}
