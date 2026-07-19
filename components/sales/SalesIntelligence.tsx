"use client";

import React, { useMemo, useState, useEffect } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, Cell, LineChart, Line, PieChart, Pie, ScatterChart, Scatter, ZAxis } from 'recharts';
import { Target, TrendingUp, AlertTriangle, Wallet, Users, Activity, Lightbulb, CheckCircle2, ChevronRight, Ban, Zap, Info, ArrowRight, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';

export default function SalesIntelligence({ leads, projectName, projectsData }: { leads: any[], projectName?: string, projectsData?: any[] }) {
  
  const [aiInsights, setAiInsights] = useState<any>(null);
  const [loadingAi, setLoadingAi] = useState(true);
  const [aiError, setAiError] = useState<string | null>(null);

  // ==========================================
  // 1. DATA PROCESSING (MEMOIZED)
  // ==========================================

  const data = useMemo(() => {
    let activeLeads = leads;
    
    // KPI Data
    const totalVisits = activeLeads.length;
    const bookings = activeLeads.filter(l => ['Reserved', 'Contract Signed', 'Down Payment', 'Bank Processing', 'Bank Approved', 'Transferred'].includes(l.status));
    const transfers = activeLeads.filter(l => l.status === 'Transferred');
    const rejects = activeLeads.filter(l => l.bankStatus === 'Rejected' || l.status === 'Bank Rejected');
    const cancels = activeLeads.filter(l => l.status === 'Cancelled' || l.status === 'Refunded');
    
    const rejectRate = bookings.length > 0 ? Math.round((rejects.length / bookings.length) * 100) : 0;
    const lostRevenue = cancels.reduce((sum, l) => sum + (l.salePrice || 0), 0);
    const totalRevenue = transfers.reduce((sum, l) => sum + (l.salePrice || 0), 0);

    // 2. Project Positioning Data
    const projectMap: Record<string, { bookings: number, transfers: number, revenue: number, cancels: number, priceSum: number }> = {};
    activeLeads.forEach(l => {
      const pName = l.project || 'Unknown';
      if (!projectMap[pName]) projectMap[pName] = { bookings: 0, transfers: 0, revenue: 0, cancels: 0, priceSum: 0 };
      
      if (['Reserved', 'Contract Signed', 'Down Payment', 'Bank Processing', 'Bank Approved', 'Transferred'].includes(l.status)) {
        projectMap[pName].bookings++;
        projectMap[pName].priceSum += (l.salePrice || 0);
      }
      if (l.status === 'Transferred') {
        projectMap[pName].transfers++;
        projectMap[pName].revenue += (l.salePrice || 0);
      }
      if (l.status === 'Cancelled') {
        projectMap[pName].cancels++;
      }
    });

    const projectPerformance = Object.entries(projectMap).map(([name, stats]) => {
      const avgPrice = stats.bookings > 0 ? stats.priceSum / stats.bookings : 0;
      const cancelRate = stats.bookings > 0 ? (stats.cancels / stats.bookings) * 100 : 0;
      return {
        name,
        bookings: stats.bookings,
        transfers: stats.transfers,
        revenue: stats.revenue,
        avgPrice,
        cancelRate
      };
    }).filter(p => p.bookings > 0);

    // 3. Pricing & Preferences (Sweet Spot)
    const priceRanges = {
      '< 2M': 0,
      '2M - 3M': 0,
      '3M - 5M': 0,
      '> 5M': 0
    };
    bookings.forEach(l => {
      const price = l.salePrice || 0;
      if (price < 2000000) priceRanges['< 2M']++;
      else if (price < 3000000) priceRanges['2M - 3M']++;
      else if (price < 5000000) priceRanges['3M - 5M']++;
      else priceRanges['> 5M']++;
    });
    const pricingPreferences = Object.entries(priceRanges).map(([range, count]) => ({ range, count }));

    // 4. Seasonality
    const monthMap: Record<string, number> = {};
    bookings.forEach(l => {
      if (l.bookingDate) {
        const date = new Date(l.bookingDate);
        const monthYear = date.toLocaleString('default', { month: 'short', year: '2-digit' });
        monthMap[monthYear] = (monthMap[monthYear] || 0) + 1;
      }
    });
    const seasonality = Object.entries(monthMap).map(([month, count]) => ({ month, count }));

    // 5. Cancellations & Risk
    const cancelReasons: Record<string, number> = {};
    cancels.forEach(l => {
      const reason = l.cancelReason || 'กู้ไม่ผ่าน (เครดิต/ภาระหนี้)';
      cancelReasons[reason] = (cancelReasons[reason] || 0) + 1;
    });
    const cancellationData = Object.entries(cancelReasons)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    // 6. Fastest Selling Plots (Sweet Spot Analysis)
    const plotSales = bookings.map(l => {
      let daysToBook = 0;
      if (l.bookingDate && l.visitDate) {
        daysToBook = Math.max(0, Math.floor((new Date(l.bookingDate).getTime() - new Date(l.visitDate).getTime()) / (1000 * 3600 * 24)));
      }
      return {
        plot: l.plot,
        houseModel: l.houseModel,
        landSize: l.landSize,
        price: l.salePrice || l.rawSellingPrice,
        daysToBook,
        status: l.status
      };
    }).filter(p => p.plot && p.houseModel && p.houseModel !== 'ไม่ระบุ');
    
    // Sort by fastest booking
    plotSales.sort((a, b) => a.daysToBook - b.daysToBook);
    const topFastestSellingPlots = plotSales.slice(0, 10);

    // 7. Sales Velocity & Predictions
    const projectLifecycle: Record<string, {
      firstBookingDate: number | null,
      transfers: number,
      totalPlots: number,
      transferDates: number[]
    }> = {};

    activeLeads.forEach(l => {
      const pName = l.project || 'Unknown';
      if (!projectLifecycle[pName]) {
        projectLifecycle[pName] = { firstBookingDate: null, transfers: 0, totalPlots: 0, transferDates: [] };
      }
      
      const isBooked = ['Reserved', 'Contract Signed', 'Down Payment', 'Bank Processing', 'Bank Approved', 'Transferred'].includes(l.status);
      if (isBooked) {
         projectLifecycle[pName].totalPlots++;
         if (l.bookingDate) {
           const bTime = new Date(l.bookingDate).getTime();
           if (!projectLifecycle[pName].firstBookingDate || bTime < projectLifecycle[pName].firstBookingDate) {
             projectLifecycle[pName].firstBookingDate = bTime;
           }
         }
      }

      if (l.status === 'Transferred') {
         projectLifecycle[pName].transfers++;
         if (l.transferDate) {
           projectLifecycle[pName].transferDates.push(new Date(l.transferDate).getTime());
         }
      }
    });

    const projectPredictions = Object.entries(projectLifecycle).map(([name, p]) => {
      p.transferDates.sort((a,b) => a - b);
      
      const dbProject = projectsData?.find(proj => proj.name === name);
      const absoluteTotalPlots = dbProject?.plotCount > 0 ? dbProject.plotCount : p.totalPlots;
      
      const threshold90 = Math.max(1, Math.floor(absoluteTotalPlots * 0.9));
      let monthsTo90 = 0;
      
      const isCompleted = dbProject ? dbProject.is_closed : (p.transfers >= threshold90);

      if (p.transfers >= threshold90 && p.firstBookingDate) {
        const date90 = p.transferDates[threshold90 - 1];
        monthsTo90 = (date90 - p.firstBookingDate) / (1000 * 3600 * 24 * 30.44); 
      }

      return {
        name,
        totalPlots: p.totalPlots,
        absoluteTotalPlots,
        transfers: p.transfers,
        firstBookingDate: p.firstBookingDate,
        isCompleted,
        monthsTo90: Math.max(0, monthsTo90),
        predicted90Date: null as number | null
      };
    }).filter(p => p.totalPlots > 0);

    const completedProjects = projectPredictions.filter(p => p.isCompleted && p.monthsTo90 > 0);
    const avgVelocity = completedProjects.length > 0 
       ? completedProjects.reduce((sum, p) => sum + p.monthsTo90, 0) / completedProjects.length 
       : 12;

    projectPredictions.forEach(p => {
       if (!p.isCompleted && p.firstBookingDate) {
          const predictedTime = p.firstBookingDate + (avgVelocity * 30.44 * 24 * 3600 * 1000);
          p.predicted90Date = predictedTime;
       }
    });

    return {
      totalVisits,
      bookings: bookings.length,
      transfers: transfers.length,
      rejectRate,
      lostRevenue,
      totalRevenue,
      projectPerformance,
      pricingPreferences,
      seasonality,
      cancellationData,
      topFastestSellingPlots,
      projectPredictions,
      avgVelocity
    };
  }, [leads]);

  // AI FETCH EFFECT
  useEffect(() => {
    let isMounted = true;
    
    const checkAndFetchAI = async () => {
      setLoadingAi(true);
      setAiError(null);
      
      const pName = projectName || 'ALL';
      
      try {
        // 1. Check Database Cache First
        const { data: reports, error: fetchErr } = await supabase
          .from('ai_sales_reports')
          .select('*')
          .eq('project_name', pName)
          .order('created_at', { ascending: false })
          .limit(1);

        // If the table doesn't exist yet, we will catch the error and fallback to API
        if (!fetchErr && reports && reports.length > 0) {
          const report = reports[0];
          const reportAgeMs = Date.now() - new Date(report.created_at).getTime();
          const oneHourMs = 60 * 60 * 1000;
          
          if (reportAgeMs < oneHourMs) {
            // Cache is valid (< 1 hour old), use it directly
            if (isMounted) {
              setAiInsights(report.report_data);
              setLoadingAi(false);
            }
            return;
          }
        }
        
        // 2. Cache expired or not found, call AI API
        const response = await fetch('/api/ai-sales-analysis', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ salesData: data })
        });
        
        if (response.ok) {
          const result = await response.json();
          if (isMounted) {
            setAiInsights(result);
            setLoadingAi(false);
          }
          // 3. Save new result to database for caching
          supabase.from('ai_sales_reports').insert([{
            project_name: pName,
            report_data: result
          }]).then(({error}) => {
             if (error) console.error("Failed to cache AI sales report:", error);
          });
          
        } else {
          console.error("Failed to fetch AI insights", response.status);
          if (isMounted) {
            setAiError("ระบบ AI กำลังมีผู้ใช้งานจำนวนมาก หรือเซิร์ฟเวอร์ตอบสนองล่าช้า (Server Busy / Rate Limit) ทำให้ยังไม่สามารถสรุปรายงานได้ในขณะนี้ กรุณารอสักครู่แล้วโหลดหน้าใหม่อีกครั้งครับ");
            setLoadingAi(false);
          }
        }
      } catch (err) {
        console.error("AI Analysis error:", err);
        if (isMounted) {
          setAiError("ระบบ AI กำลังมีผู้ใช้งานจำนวนมาก หรือเซิร์ฟเวอร์ตอบสนองล่าช้า (Server Busy) ทำให้ยังไม่สามารถสรุปรายงานได้ในขณะนี้ กรุณารอสักครู่แล้วโหลดหน้าใหม่อีกครั้งครับ");
          setLoadingAi(false);
        }
      }
    };

    if (data.bookings > 0 || data.totalVisits > 0) {
      checkAndFetchAI();
    } else {
      setLoadingAi(false);
    }

    return () => { isMounted = false; };
  }, [data]);

  const COLORS = ['#f43f5e', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#64748b'];

  const formatMoney = (amount: number) => {
    if (amount >= 1000000) return `${(amount / 1000000).toFixed(1)}M`;
    if (amount >= 100000) return `${(amount / 100000).toFixed(1)} แสน`;
    return amount.toLocaleString();
  };

  const highestCancelReason = data.cancellationData[0] || { name: 'ไม่มีข้อมูล', count: 0 };
  const sweetSpotRange = [...data.pricingPreferences].sort((a, b) => b.count - a.count)[0] || { range: 'ไม่มี', count: 0 };
  const cashCowProject = [...data.projectPerformance].sort((a, b) => b.transfers - a.transfers)[0] || { name: 'ไม่มี', transfers: 0, cancelRate: 0 };

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-800 pb-20">
      
      {/* HEADER SECTION */}
      <div className="bg-white border-b border-gray-200 px-8 py-10 relative overflow-hidden">
        <div className="absolute top-0 right-0 p-8 opacity-5">
          <Lightbulb size={200} />
        </div>
        <div className="max-w-[1400px] mx-auto relative z-10">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3 text-[#d4af37] font-black text-sm tracking-widest uppercase">
              <Lightbulb size={20} />
              Strategic Analysis Report
            </div>
            {loadingAi && (
              <div className="flex items-center gap-2 text-blue-600 bg-blue-50 px-3 py-1.5 rounded-full text-sm font-bold">
                <Loader2 size={16} className="animate-spin" />
                AI Analyst is analyzing...
              </div>
            )}
          </div>
          <h1 className="text-4xl md:text-5xl font-black text-[#0f172a] tracking-tight leading-tight mb-4">
            รายงานการวิเคราะห์ข้อมูลเชิงลึก<br className="hidden md:block"/>และกลยุทธ์การขาย
          </h1>
          <p className="text-lg text-slate-500 max-w-2xl font-medium">
            บทสรุปผู้บริหาร วิเคราะห์พฤติกรรมลูกค้า ประสิทธิภาพโครงการ และคุณภาพของกระแสเงินสด เพื่อวางแผนกลยุทธ์ที่แม่นยำอ้างอิงจากฐานข้อมูลจริงแบบ Real-time วิเคราะห์โดย AI
          </p>
        </div>
      </div>

      <div className="max-w-[1400px] mx-auto px-4 md:px-8 py-8 space-y-12">

        {/* 1. EXECUTIVE SUMMARY */}
        <section>
          <div className="flex items-center gap-3 mb-6">
            <div className="bg-slate-800 text-white w-8 h-8 rounded-full flex items-center justify-center font-black">1</div>
            <h2 className="text-2xl font-black text-slate-800">บทสรุปผู้บริหาร (Executive Summary)</h2>
          </div>
          
          <div className="bg-white rounded-3xl p-6 md:p-8 border border-slate-200 shadow-sm mb-6 flex flex-col md:flex-row gap-6 items-center relative overflow-hidden">
             {loadingAi && <div className="absolute inset-0 bg-white/80 backdrop-blur-sm z-10 flex items-center justify-center"><Loader2 className="animate-spin text-blue-500 w-8 h-8" /></div>}
            <div className={`p-4 rounded-2xl ${aiError ? 'bg-red-50 text-red-600' : 'bg-rose-50 text-rose-700'}`}>
              {aiError ? <AlertTriangle size={32} /> : <Zap size={32} />}
            </div>
            <div className="flex-1">
              <h3 className="text-xl font-bold mb-2">
                {aiError ? "พบข้อผิดพลาดจาก AI" : "ข้อค้นพบที่สำคัญที่สุด (Key Finding)"}
              </h3>
              <p className={`text-lg leading-relaxed ${aiError ? 'text-red-500 font-medium' : 'text-slate-600'}`}>
                {aiError || aiInsights?.executiveSummary || "กำลังวิเคราะห์ข้อมูลยอดขายและกระแสเงินสดทั้งหมด..."}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow border-b-4 border-b-emerald-500">
              <div className="text-slate-500 text-sm font-bold mb-2 uppercase tracking-wider">Total Revenue</div>
              <div className="text-3xl font-black text-[#10b981]">฿{formatMoney(data.totalRevenue)}</div>
              <div className="text-sm font-medium text-slate-400 mt-2">ยอดโอนสำเร็จ {data.transfers} หลัง</div>
            </div>
            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow border-b-4 border-b-rose-500">
              <div className="text-slate-500 text-sm font-bold mb-2 uppercase tracking-wider">Lost Revenue</div>
              <div className="text-3xl font-black text-rose-500">฿{formatMoney(data.lostRevenue)}</div>
              <div className="text-sm font-medium text-slate-400 mt-2">ยอดหลุดจอง/ทิ้งดาวน์</div>
            </div>
            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
              <div className="text-slate-500 text-sm font-bold mb-2 uppercase tracking-wider">Total Bookings</div>
              <div className="text-3xl font-black text-blue-600">{data.bookings}</div>
              <div className="text-sm font-medium text-slate-400 mt-2">จากผู้เยี่ยมชม {data.totalVisits} ราย</div>
            </div>
            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow border-b-4 border-b-orange-500">
              <div className="text-slate-500 text-sm font-bold mb-2 uppercase tracking-wider">Bank Reject Rate</div>
              <div className="text-3xl font-black text-orange-500">{data.rejectRate}%</div>
              <div className="text-sm font-medium text-slate-400 mt-2">อัตรากู้ไม่ผ่าน (Reject)</div>
            </div>
          </div>
        </section>

        {/* 2. PROJECT POSITIONING */}
        <section>
          <div className="flex items-center gap-3 mb-6">
            <div className="bg-slate-800 text-white w-8 h-8 rounded-full flex items-center justify-center font-black">2</div>
            <h2 className="text-2xl font-black text-slate-800">ประสิทธิภาพแยกตามโครงการ (Project Positioning)</h2>
          </div>
          
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-white rounded-3xl p-6 border border-slate-200 shadow-sm relative">
              <h3 className="font-bold text-lg mb-6 flex items-center gap-2"><Target className="text-blue-500"/> Project Performance (Volume vs Price)</h3>
              <div className="h-[350px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis type="number" dataKey="bookings" name="ยอดจอง (หลัง)" axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 12, fontWeight: 'bold'}} />
                    <YAxis type="number" dataKey="avgPrice" name="ราคาเฉลี่ย (บาท)" tickFormatter={(v) => formatMoney(v)} axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 12, fontWeight: 'bold'}} />
                    <ZAxis type="number" dataKey="transfers" range={[100, 1000]} name="โอนแล้ว" />
                    <RechartsTooltip cursor={{strokeDasharray: '3 3'}} contentStyle={{ borderRadius: '1rem', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.1)', fontWeight: 'bold' }} />
                    <Scatter name="Projects" data={data.projectPerformance} fill="#3b82f6">
                      {data.projectPerformance.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Scatter>
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="space-y-4 flex flex-col">
              <div className="bg-emerald-50 rounded-3xl p-6 border border-emerald-100 flex-1 relative overflow-hidden">
                {loadingAi && <div className="absolute inset-0 bg-emerald-50/80 backdrop-blur-sm z-20 flex items-center justify-center"><Loader2 className="animate-spin text-emerald-500 w-8 h-8" /></div>}
                <div className="absolute top-0 right-0 p-4 opacity-10">
                  <TrendingUp size={80} />
                </div>
                <div className="flex items-center gap-2 text-emerald-700 font-black mb-3">
                  <TrendingUp size={20} />
                  Cash Cow Project
                </div>
                <h4 className="text-xl font-bold text-slate-800 mb-2">โครงการ {cashCowProject.name}</h4>
                <p className="text-slate-600 text-sm leading-relaxed relative z-10">
                  {aiInsights?.cashCowProject || "กำลังวิเคราะห์โครงสร้างรายได้..."}
                </p>
              </div>
              
              <div className="bg-rose-50 rounded-3xl p-6 border border-rose-100 flex-1 relative overflow-hidden">
                {loadingAi && <div className="absolute inset-0 bg-rose-50/80 backdrop-blur-sm z-20 flex items-center justify-center"><Loader2 className="animate-spin text-rose-500 w-8 h-8" /></div>}
                <div className="absolute top-0 right-0 p-4 opacity-10">
                  <AlertTriangle size={80} />
                </div>
                <div className="flex items-center gap-2 text-rose-700 font-black mb-3">
                  <AlertTriangle size={20} />
                  Risk Alert
                </div>
                <p className="text-slate-600 text-sm leading-relaxed relative z-10">
                  {aiInsights?.riskProject || "กำลังวิเคราะห์ความเสี่ยงรายโครงการ..."}
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* 3 & 4. PREFERENCES & SEASONALITY */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          
          {/* Preferences */}
          <div>
            <div className="flex items-center gap-3 mb-6">
              <div className="bg-slate-800 text-white w-8 h-8 rounded-full flex items-center justify-center font-black">3</div>
              <h2 className="text-2xl font-black text-slate-800">ช่วงราคาที่นิยม (Sweet Spot)</h2>
            </div>
            
            <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm relative overflow-hidden h-[400px] flex flex-col">
              {loadingAi && <div className="absolute inset-0 bg-white/80 backdrop-blur-sm z-20 flex items-center justify-center"><Loader2 className="animate-spin text-blue-500 w-8 h-8" /></div>}
              <div className="absolute top-0 right-0 bg-blue-600 text-white text-xs font-black px-4 py-2 rounded-bl-2xl">
                Insight
              </div>
              <p className="text-slate-600 font-medium mb-6 mt-4 pr-12 leading-relaxed">
                {aiInsights?.sweetSpot || "กำลังวิเคราะห์ช่วงราคา..."}
              </p>
              
              <div className="flex-1 w-full min-h-0">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.pricingPreferences} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="range" axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 12, fontWeight: 'bold'}} dy={10} />
                    <YAxis axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 12, fontWeight: 'bold'}} />
                    <RechartsTooltip cursor={{fill: '#f8fafc'}} contentStyle={{ borderRadius: '1rem', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.1)', fontWeight: 'bold' }} />
                    <Bar dataKey="count" fill="#3b82f6" radius={[6, 6, 0, 0]} barSize={40}>
                      {data.pricingPreferences.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.range === sweetSpotRange.range ? '#3b82f6' : '#e2e8f0'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Seasonality */}
          <div>
            <div className="flex items-center gap-3 mb-6">
              <div className="bg-slate-800 text-white w-8 h-8 rounded-full flex items-center justify-center font-black">4</div>
              <h2 className="text-2xl font-black text-slate-800">ฤดูกาลขาย (Seasonality)</h2>
            </div>
            
            <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm relative overflow-hidden h-[400px] flex flex-col">
              {loadingAi && <div className="absolute inset-0 bg-white/80 backdrop-blur-sm z-20 flex items-center justify-center"><Loader2 className="animate-spin text-[#d4af37] w-8 h-8" /></div>}
               <div className="absolute top-0 right-0 bg-[#d4af37] text-white text-xs font-black px-4 py-2 rounded-bl-2xl">
                Trend
              </div>
              <p className="text-slate-600 font-medium mb-6 mt-4 pr-12 leading-relaxed">
                {aiInsights?.seasonality || "กำลังวิเคราะห์วัฏจักรการขาย..."}
              </p>

              <div className="flex-1 w-full min-h-0">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.seasonality} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 12, fontWeight: 'bold'}} dy={10} />
                    <YAxis axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 12, fontWeight: 'bold'}} />
                    <RechartsTooltip contentStyle={{ borderRadius: '1rem', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.1)', fontWeight: 'bold' }} />
                    <Line type="monotone" dataKey="count" name="ยอดจอง" stroke="#d4af37" strokeWidth={4} dot={{r: 6, fill: '#d4af37', strokeWidth: 2, stroke: '#fff'}} activeDot={{r: 8}} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </section>

        {/* 5. SALES VELOCITY & PREDICTIONS */}
        <section>
          <div className="flex items-center gap-3 mb-6">
            <div className="bg-slate-800 text-white w-8 h-8 rounded-full flex items-center justify-center font-black">5</div>
            <h2 className="text-2xl font-black text-slate-800">พยากรณ์การขายและการโอน (Sales & Transfer Prediction)</h2>
          </div>
          
          <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm relative overflow-hidden mb-6">
            {loadingAi && <div className="absolute inset-0 bg-white/80 backdrop-blur-sm z-20 flex items-center justify-center"><Loader2 className="animate-spin text-indigo-500 w-8 h-8" /></div>}
             <div className="absolute top-0 right-0 bg-indigo-600 text-white text-xs font-black px-4 py-2 rounded-bl-2xl">
              Prediction
            </div>
            
            <p className="text-slate-600 font-medium mb-6 mt-4 pr-12 leading-relaxed">
              {aiInsights?.salesPrediction || "กำลังวิเคราะห์ความเร็วการขายและคาดการณ์วันโอน..."}
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
               <div className="bg-indigo-50/50 p-6 rounded-2xl border border-indigo-100">
                  <h3 className="font-bold text-indigo-800 mb-4 flex items-center gap-2">
                     <CheckCircle2 size={18} /> โครงการในอดีต (Historical Velocity)
                  </h3>
                  <div className="space-y-4">
                     {data.projectPredictions.filter(p => p.isCompleted).map((p, idx) => (
                        <div key={idx} className="bg-white p-4 rounded-xl border border-indigo-50 shadow-sm flex justify-between items-center">
                           <div>
                             <div className="font-bold text-slate-800">{p.name}</div>
                             <div className="text-[10px] text-slate-500 font-medium">รวม {p.absoluteTotalPlots} แปลง</div>
                           </div>
                           <div className="text-right">
                             <div className="font-black text-indigo-600">{p.monthsTo90.toFixed(1)} <span className="text-xs">เดือน</span></div>
                             <div className="text-[10px] text-slate-500 font-medium">ถึงโอน 90%</div>
                           </div>
                        </div>
                     ))}
                     {data.projectPredictions.filter(p => p.isCompleted).length === 0 && (
                        <div className="text-center text-slate-400 font-medium py-4 text-sm">ยังไม่มีโครงการในอดีตที่โอนถึง 90%</div>
                     )}
                  </div>
                  <div className="mt-4 pt-4 border-t border-indigo-100 flex justify-between items-center">
                     <span className="font-bold text-slate-600 text-sm">ค่าเฉลี่ยทั้งหมด (Avg Velocity)</span>
                     <span className="font-black text-lg text-indigo-700">{data.avgVelocity.toFixed(1)} <span className="text-xs">เดือน</span></span>
                  </div>
               </div>

               <div className="bg-emerald-50/50 p-6 rounded-2xl border border-emerald-100">
                  <h3 className="font-bold text-emerald-800 mb-4 flex items-center gap-2">
                     <TrendingUp size={18} /> คาดการณ์โครงการปัจจุบัน (Active Projects ETA)
                  </h3>
                  <div className="space-y-4">
                     {data.projectPredictions.filter(p => !p.isCompleted).map((p, idx) => {
                        const predictedDate = p.predicted90Date ? new Date(p.predicted90Date).toLocaleDateString('th-TH', { month: 'long', year: 'numeric' }) : 'N/A';
                        const startDate = p.firstBookingDate ? new Date(p.firstBookingDate).toLocaleDateString('th-TH', { month: 'short', year: '2-digit' }) : 'N/A';
                        
                        return (
                           <div key={idx} className="bg-white p-4 rounded-xl border border-emerald-50 shadow-sm relative overflow-hidden group">
                              <div className="absolute right-0 top-0 bottom-0 w-1.5 bg-emerald-400"></div>
                              <div className="flex justify-between items-start mb-2">
                                <div className="font-bold text-slate-800 text-lg">{p.name}</div>
                                <div className="bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded text-[10px] font-bold">กำลังขาย</div>
                              </div>
                              <div className="flex gap-4 text-xs font-medium text-slate-500 mb-3">
                                 <div>เริ่มขาย: <span className="text-slate-700">{startDate}</span></div>
                                 <div className="flex flex-col">
                                    <span>โอนแล้ว: <span className="text-emerald-600 font-bold">{p.transfers}/{p.absoluteTotalPlots}</span> แปลง</span>
                                    <span className="text-[10px] text-slate-400">(จากยอดจอง {p.totalPlots} แปลง)</span>
                                 </div>
                              </div>
                              <div className="bg-emerald-50 p-3 rounded-lg flex items-center justify-between border border-emerald-100">
                                 <span className="text-xs font-bold text-emerald-800">คาดการณ์ปิดโอน 90%</span>
                                 <span className="text-emerald-600 font-black flex items-center gap-1">
                                    <Zap size={14} /> {predictedDate}
                                 </span>
                              </div>
                           </div>
                        );
                     })}
                     {data.projectPredictions.filter(p => !p.isCompleted).length === 0 && (
                        <div className="text-center text-slate-400 font-medium py-4 text-sm">ยังไม่มีโครงการที่กำลังขาย</div>
                     )}
                  </div>
               </div>
            </div>
          </div>
        </section>

        {/* 6. ROOT CAUSE OF CANCELLATIONS */}
        <section>
          <div className="flex items-center gap-3 mb-6">
            <div className="bg-slate-800 text-white w-8 h-8 rounded-full flex items-center justify-center font-black">6</div>
            <h2 className="text-2xl font-black text-slate-800">รากเหง้าของการยกเลิกจอง (Root Cause Analysis)</h2>
          </div>
          
          <div className="bg-white rounded-3xl p-0 border border-slate-200 shadow-sm overflow-hidden flex flex-col md:flex-row relative">
            {loadingAi && <div className="absolute inset-0 bg-white/80 backdrop-blur-sm z-20 flex items-center justify-center"><Loader2 className="animate-spin text-rose-500 w-8 h-8" /></div>}
            
            <div className="flex-1 p-8 border-b md:border-b-0 md:border-r border-slate-100 flex flex-col justify-center">
              <h3 className="font-black text-xl text-slate-800 mb-6 flex items-center gap-2">
                <Activity className="text-rose-500" />
                Cancellation Reasons
              </h3>
              
              {data.cancellationData.length > 0 ? (
                <div className="h-[250px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={data.cancellationData} cx="50%" cy="50%" innerRadius={70} outerRadius={100} paddingAngle={2} dataKey="count">
                        {data.cancellationData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <RechartsTooltip contentStyle={{ borderRadius: '1rem', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.1)', fontWeight: 'bold' }} />
                      <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{ fontSize: '12px', fontWeight: 'bold', paddingTop: '10px' }}/>
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="text-center py-12 text-slate-400 font-bold">ไม่มีข้อมูลการยกเลิกจอง 🎉</div>
              )}
            </div>

            <div className="flex-1 p-8 bg-slate-50 flex flex-col justify-center">
              <div className="bg-white p-6 rounded-2xl border border-rose-100 shadow-sm relative">
                <div className="absolute -left-3 -top-3 bg-rose-500 text-white p-2 rounded-xl shadow-lg">
                  <Ban size={24} />
                </div>
                <h4 className="font-bold text-lg text-slate-800 ml-6 mb-3">เจาะลึกปัญหา (Deep Dive)</h4>
                <p className="text-slate-600 leading-relaxed font-medium">
                  {aiInsights?.rootCause || "กำลังวิเคราะห์สาเหตุการยกเลิก..."}
                </p>
              </div>
            </div>

          </div>
        </section>

        {/* 7. HOLISTIC STRATEGIC RECOMMENDATIONS */}
        <section>
          <div className="flex items-center gap-3 mb-6">
            <div className="bg-slate-800 text-white w-8 h-8 rounded-full flex items-center justify-center font-black">7</div>
            <h2 className="text-2xl font-black text-slate-800">ข้อเสนอแนะเชิงกลยุทธ์ (Holistic Recommendations)</h2>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 relative">
            {loadingAi && <div className="absolute inset-0 bg-white/80 backdrop-blur-sm z-20 flex items-center justify-center rounded-3xl"><Loader2 className="animate-spin text-slate-800 w-12 h-12" /></div>}
            
            {aiInsights?.recommendations ? (
              aiInsights.recommendations.map((rec: any, idx: number) => (
                <div key={idx} className={`bg-gradient-to-br ${idx === 0 ? 'from-slate-800 to-slate-900' : idx === 1 ? 'from-blue-600 to-blue-800' : 'from-emerald-600 to-emerald-800'} rounded-3xl p-8 text-white shadow-lg relative overflow-hidden group hover:-translate-y-1 transition-transform`}>
                  <div className="absolute top-0 right-0 p-6 opacity-10 group-hover:scale-110 transition-transform">
                    {idx === 0 ? <Wallet size={100} /> : idx === 1 ? <Target size={100} /> : <Users size={100} />}
                  </div>
                  <h3 className={`font-black text-xl mb-4 ${idx === 0 ? 'text-[#d4af37]' : idx === 1 ? 'text-blue-200' : 'text-emerald-200'} relative z-10`}>{idx + 1}. {rec.title}</h3>
                  <ul className="space-y-4 relative z-10">
                    {rec.bullets.map((bullet: string, bIdx: number) => (
                      <li key={bIdx} className="flex items-start gap-3">
                        <CheckCircle2 className={`${idx === 0 ? 'text-[#d4af37]' : idx === 1 ? 'text-blue-300' : 'text-emerald-300'} shrink-0 mt-0.5`} size={18} />
                        <span className="text-white text-sm leading-relaxed">{bullet}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            ) : (
              // Fallback Skeletons
              [1, 2, 3].map(i => (
                <div key={i} className="bg-slate-200 animate-pulse h-64 rounded-3xl"></div>
              ))
            )}
          </div>
          
          {/* Winning Formula Analysis (New Feature) */}
          {aiInsights?.winningFormula && (
            <div className="mt-8 border-t border-slate-200 pt-8">
              <div className="flex items-center gap-3 mb-4">
                <div className="bg-amber-100 p-2 rounded-xl text-amber-600">
                  <Lightbulb size={24} className="animate-pulse" />
                </div>
                <h3 className="text-xl font-bold text-slate-800">สูตรสำเร็จ & ทิศทางในอนาคต (Winning Formula)</h3>
              </div>
              <div className="bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-200 p-6 rounded-3xl relative overflow-hidden shadow-sm">
                <div className="absolute top-0 right-0 p-4 opacity-5">
                  <Target size={120} />
                </div>
                <p className="text-slate-700 leading-relaxed relative z-10 text-lg">
                  {aiInsights.winningFormula}
                </p>
              </div>
            </div>
          )}
        </section>

      </div>
    </div>
  );
}
