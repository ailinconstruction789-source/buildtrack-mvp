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
  RefreshCw
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { RentalContract, RentalProgramType, RENTAL_PROGRAM_DETAILS } from '@/types/sales';

interface RentalPortfolioAnalyticsProps {
  projectName?: string;
  onRefresh?: () => void;
}

export default function RentalPortfolioAnalytics({
  projectName,
  onRefresh
}: RentalPortfolioAnalyticsProps) {
  const [contracts, setContracts] = useState<RentalContract[]>([]);
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

      // 2. Fetch all active rental contracts
      let contractsQuery = supabase
        .from('rental_contracts')
        .select('*')
        .eq('status', 'Active');

      if (projectName && projectName !== 'all') {
        contractsQuery = contractsQuery.eq('project_name', projectName);
      }

      const { data: contractsData } = await contractsQuery;
      if (!isCancelled) {
        setContracts(contractsData || []);
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

  // Aggregate Metrics
  const stats = useMemo(() => {
    const activeUnits = contracts.length;
    const occupancyRate = totalPlotsCount > 0 ? (activeUnits / totalPlotsCount) * 100 : 0;

    let monthlyRevenue = 0;
    let totalSecurityDeposit = 0;
    let programACount = 0;
    let programBCount = 0;
    let programCCount = 0;
    let totalRentToOwnSavings = 0;
    let projectedAnnualYield = 0;

    contracts.forEach((c) => {
      const rent = Number(c.monthly_rent || 0);
      const deposit = Number(c.security_deposit || 0);
      const savings = Number(c.accumulated_savings || 0);

      monthlyRevenue += rent;
      totalSecurityDeposit += deposit;
      totalRentToOwnSavings += savings;

      if (c.program_type === 'program_a') programACount++;
      else if (c.program_type === 'program_b') programBCount++;
      else if (c.program_type === 'program_c') programCCount++;
    });

    projectedAnnualYield = monthlyRevenue * 12;

    return {
      activeUnits,
      occupancyRate,
      monthlyRevenue,
      totalSecurityDeposit,
      totalRentToOwnSavings,
      projectedAnnualYield,
      programACount,
      programBCount,
      programCCount
    };
  }, [contracts, totalPlotsCount]);

  return (
    <div className="space-y-4">
      
      {/* 🚀 Main KPI Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        
        {/* Card 1: Active Rental Units & Occupancy */}
        <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/90 shadow-2xs space-y-2">
          <div className="flex items-center justify-between text-slate-500 text-xs font-bold">
            <span className="flex items-center gap-1.5 text-slate-700">
              <Home size={16} className="text-blue-600" /> บ้านเช่าที่กำลังเช่าอยู่
            </span>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
              {stats.occupancyRate.toFixed(1)}% อัตราเช่า
            </span>
          </div>

          <div className="text-2xl sm:text-3xl font-black text-slate-900 font-mono flex items-baseline gap-1.5">
            {stats.activeUnits} <span className="text-xs font-normal text-slate-500">/ {totalPlotsCount} แปลงทั้งหมด</span>
          </div>

          <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
            <div 
              className="bg-blue-600 h-full rounded-full transition-all duration-500" 
              style={{ width: `${Math.min(100, stats.occupancyRate)}%` }}
            />
          </div>
        </div>

        {/* Card 2: Monthly Cash Flow */}
        <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/90 shadow-2xs space-y-2">
          <div className="flex items-center justify-between text-slate-500 text-xs font-bold">
            <span className="flex items-center gap-1.5 text-emerald-800">
              <TrendingUp size={16} className="text-emerald-600" /> กระแสเงินสดค่าเช่า/เดือน
            </span>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
              Recurring
            </span>
          </div>

          <div className="text-2xl sm:text-3xl font-black text-emerald-950 font-mono">
            ฿{stats.monthlyRevenue.toLocaleString()} <span className="text-xs font-normal text-emerald-700">บ./ด.</span>
          </div>

          <p className="text-[11px] text-slate-500">
            ประมาณการรายรับค่าเช่า <b>฿{stats.projectedAnnualYield.toLocaleString()}</b> บ./ปี
          </p>
        </div>

        {/* Card 3: Program B Rent-to-Own Pool */}
        <div className="bg-white p-4 sm:p-5 rounded-2xl border border-amber-200 bg-amber-50/30 shadow-2xs space-y-2">
          <div className="flex items-center justify-between text-amber-800 text-xs font-bold">
            <span className="flex items-center gap-1.5">
              <PiggyBank size={16} className="text-amber-600" /> กองทุนสะสมเงินดาวน์ (แบบ B)
            </span>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300">
              Rent to Own
            </span>
          </div>

          <div className="text-2xl sm:text-3xl font-black text-amber-950 font-mono">
            ฿{stats.totalRentToOwnSavings.toLocaleString()} <span className="text-xs font-normal text-amber-800">บาท</span>
          </div>

          <p className="text-[11px] text-amber-800">
            เงินสะสมของลูกค้า <b>{stats.programBCount} ราย</b> ที่เตรียมแปลงเป็นผู้ซื้อบ้าน
          </p>
        </div>

        {/* Card 4: Security Deposits Held */}
        <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/90 shadow-2xs space-y-2">
          <div className="flex items-center justify-between text-slate-500 text-xs font-bold">
            <span className="flex items-center gap-1.5 text-slate-700">
              <DollarSign size={16} className="text-indigo-600" /> เงินประกันการเช่าที่ถือครอง
            </span>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
              Deposit Pool
            </span>
          </div>

          <div className="text-2xl sm:text-3xl font-black text-indigo-950 font-mono">
            ฿{stats.totalSecurityDeposit.toLocaleString()} <span className="text-xs font-normal text-indigo-700">บาท</span>
          </div>

          <p className="text-[11px] text-slate-500">
            เงินประกันเฉลี่ย 2 เดือนต่อสัญญา คืนเมื่อสิ้นสุดสัญญา
          </p>
        </div>

      </div>

      {/* 📊 Rental Program Breakdown Cards */}
      <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/90 shadow-2xs space-y-3">
        <h4 className="font-bold text-xs text-slate-800 flex items-center gap-1.5">
          <PieChart size={15} className="text-blue-600" /> สัดส่วนโปรแกรมการเช่าที่ลูกค้านิยม (Rental Program Breakdown)
        </h4>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          
          {/* Program A Card */}
          <div className="p-3.5 bg-blue-50/60 border border-blue-200 rounded-xl space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-bold text-xs text-blue-950">แบบ A: Rent (เช่าทั่วไป)</span>
              <span className="text-xs font-black text-blue-700 font-mono">{stats.programACount} หลัง</span>
            </div>
            <p className="text-[10px] text-slate-600">
              อยู่สบาย ประกัน 2 เดือน ไม่ต้องการซื้อบ้าน
            </p>
          </div>

          {/* Program B Card */}
          <div className="p-3.5 bg-amber-50/60 border border-amber-200 rounded-xl space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-bold text-xs text-amber-950">แบบ B: Rent to Own (เช่าซื้อ)</span>
              <span className="text-xs font-black text-amber-700 font-mono">{stats.programBCount} หลัง</span>
            </div>
            <p className="text-[10px] text-slate-600">
              สะสมเงินซื้อบ้าน +5,000 บ./เดือน เตรียมแปลงเป็นเจ้าของบ้าน
            </p>
          </div>

          {/* Program C Card */}
          <div className="p-3.5 bg-purple-50/60 border border-purple-200 rounded-xl space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-bold text-xs text-purple-950">แบบ C: Rent & Save (เช่าออม)</span>
              <span className="text-xs font-black text-purple-700 font-mono">{stats.programCCount} หลัง</span>
            </div>
            <p className="text-[10px] text-slate-600">
              สิทธิประโยชน์ลดราคาบ้าน 10% (ปีที่ 1) / 5% (ปีที่ 2)
            </p>
          </div>

        </div>
      </div>

    </div>
  );
}
