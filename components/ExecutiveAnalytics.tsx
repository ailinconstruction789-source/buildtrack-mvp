import React, { useMemo } from 'react';
import { Activity, DollarSign, Wallet, Hammer, ChevronRight } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

export default function ExecutiveAnalytics({
  loading, projects, plots, taskTemplates, schedules, latestUpdatesMap, foremenList, allUpdatesRecord
}: any) {

  // 💰 1. Financial Analytics
  const financialData = useMemo(() => {
    let expectedRevenue = 0;
    let sunkCost = 0;
    let totalConstructionCost = 0;
    let totalPlannedBudget = 0;

    if (!plots || !taskTemplates) return { expectedRevenue, sunkCost, totalConstructionCost, totalPlannedBudget };

    plots.forEach((p: any) => {
      if (p.has_customer && !p.is_completed) {
        expectedRevenue += Number(p.selling_price || 0);
      }

      const pTasks = taskTemplates.filter((t: any) => t.house_type_id === p.house_type_id);
      let plotCompletedCost = 0;

      pTasks.forEach((t: any) => {
        const taskCost = Number(t.cost || 0);
        totalPlannedBudget += taskCost;

        const key = `${p.id}-${t.id}`;
        const actual = latestUpdatesMap?.[key];
        if (actual && Number(actual.progress) === 100) {
          plotCompletedCost += taskCost;
        }
      });

      totalConstructionCost += plotCompletedCost;

      if (p.sale_status === 'ready_for_sale') {
        sunkCost += plotCompletedCost;
      }
    });

    return { expectedRevenue, sunkCost, totalConstructionCost, totalPlannedBudget };
  }, [plots, taskTemplates, latestUpdatesMap]);

  const formatCurrency = (val: number) => {
    if (val >= 1000000) return `฿ ${(val / 1000000).toFixed(2)}M`;
    if (val >= 1000) return `฿ ${(val / 1000).toFixed(0)}k`;
    return `฿ ${val.toLocaleString()}`;
  };

  // 🏅 2. Contractor Quality Score
  const foremanPerformance = useMemo(() => {
    if (!foremenList) return [];
    return foremenList.map((foreman: any) => {
      const fPlots = plots?.filter((p: any) => p.foreman === foreman.username) || [];
      let totalTasks = 0;
      let totalReworks = 0;

      fPlots.forEach((p: any) => {
        const pTasks = taskTemplates?.filter((t: any) => t.house_type_id === p.house_type_id) || [];
        totalTasks += pTasks.length;
      });

      if (allUpdatesRecord) {
        allUpdatesRecord.forEach((upd: any) => {
          if (upd.action && upd.action.includes('แจ้งแก้ไข') && fPlots.some((p:any) => String(p.id) === String(upd.plot_id))) {
            totalReworks++;
          }
        });
      }

      const reworkRate = totalTasks > 0 ? (totalReworks / totalTasks) * 100 : 0;
      const qualityScore = Math.max(0, Math.round(100 - reworkRate * 2)); 
      
      return {
        name: foreman.username,
        score: qualityScore,
        reworks: totalReworks
      };
    }).sort((a: any, b: any) => b.score - a.score);
  }, [foremenList, plots, taskTemplates, allUpdatesRecord]);

  // 📈 3. S-Curve Data (Earned Value Management)
  const sCurveData = useMemo(() => {
    if (!schedules || !taskTemplates) return [];

    const taskCostMap: Record<string, number> = {};
    taskTemplates.forEach((t: any) => {
      taskCostMap[t.id] = Number(t.cost || 0);
    });

    const monthlyData: Record<string, { PV: number, EV: number }> = {};
    const ensureMonth = (monthStr: string) => {
      if (!monthlyData[monthStr]) monthlyData[monthStr] = { PV: 0, EV: 0 };
    };

    const currentMonth = new Date().toISOString().slice(0, 7);
    ensureMonth(currentMonth);

    if (schedules) {
      const schedArray = Array.isArray(schedules) ? schedules : Object.keys(schedules).map(k => ({...schedules[k], _key: k}));
      schedArray.forEach((s: any) => {
        if (!s.planned_end || !s.planned_start) return;
        
        let taskId = s.task_template_id;
        if (!taskId && s._key) {
           const parts = s._key.split('-');
           taskId = parts.length === 10 ? parts.slice(5).join('-') : (parts.length >= 2 ? parts[1] : s._key);
        }
        const cost = taskCostMap[taskId] || 0;
        
        const start = new Date(s.planned_start);
        const end = new Date(s.planned_end);
        
        if (isNaN(start.getTime()) || isNaN(end.getTime())) return;

        if (start.toISOString().slice(0, 7) === end.toISOString().slice(0, 7)) {
            const m = end.toISOString().slice(0, 7);
            ensureMonth(m);
            monthlyData[m].PV += cost;
        } else {
            const totalMs = end.getTime() - start.getTime() || 1;
            let current = new Date(start.getFullYear(), start.getMonth(), 1);
            const endMonth = new Date(end.getFullYear(), end.getMonth(), 1);
            
            while (current <= endMonth) {
                const m = current.toISOString().slice(0, 7);
                const endOfMonth = new Date(current.getFullYear(), current.getMonth() + 1, 0, 23, 59, 59, 999);
                
                const spanStart = Math.max(start.getTime(), current.getTime());
                const spanEnd = Math.min(end.getTime(), endOfMonth.getTime());
                const spanMs = Math.max(0, spanEnd - spanStart);
                
                ensureMonth(m);
                monthlyData[m].PV += (cost * (spanMs / totalMs));
                
                current = new Date(current.getFullYear(), current.getMonth() + 1, 1);
            }
        }
      });
    }

    if (latestUpdatesMap) {
      Object.keys(latestUpdatesMap).forEach(key => {
        const upd = latestUpdatesMap[key];
        const progress = Number(upd.progress || 0);
        if (progress === 0) return;

        let taskId = upd.task_template_id;
        if (!taskId) {
          const parts = key.split('-');
          taskId = parts.length === 10 ? parts.slice(5).join('-') : (parts.length >= 2 ? parts[1] : key);
        }
        const cost = taskCostMap[taskId] || 0;

        if (progress === 100) {
          const dateStr = upd.actual_end_date || upd.resolved_at || upd.created_at || upd.updated_at;
          if (dateStr) {
            const date = new Date(dateStr);
            if (!isNaN(date.getTime())) {
              const monthStr = date.toISOString().slice(0, 7);
              ensureMonth(monthStr);
              monthlyData[monthStr].EV += cost;
            } else {
              monthlyData[currentMonth].EV += cost;
            }
          } else {
            monthlyData[currentMonth].EV += cost;
          }
        } else {
          // Partial progress -> assign to current month
          monthlyData[currentMonth].EV += (cost * (progress / 100));
        }
      });
    }

    const sortedMonths = Object.keys(monthlyData).sort();
    let cumulativePV = 0;
    let cumulativeEV = 0;

    return sortedMonths.map(month => {
      cumulativePV += monthlyData[month].PV;
      cumulativeEV += monthlyData[month].EV;
      
      const date = new Date(`${month}-01`);
      const monthName = date.toLocaleString('en-US', { month: 'short', year: '2-digit' });

      const displayEV = month <= currentMonth ? cumulativeEV : null;

      return {
        name: monthName,
        month: month,
        PV: cumulativePV,
        EV: displayEV
      };
    });
  }, [schedules, taskTemplates, latestUpdatesMap]);

  return (
    <div className="mt-12 bg-[#fbfbfd] p-6 sm:p-12 rounded-[2.5rem] border border-black/[0.04] shadow-[0_8px_30px_rgb(0,0,0,0.04)] font-sans antialiased">
      {/* Header */}
      <div className="flex flex-col mb-10">
        <h2 className="text-3xl sm:text-5xl font-semibold text-[#1d1d1f] tracking-tight">Executive Analytics</h2>
        <p className="text-[#86868b] text-sm sm:text-base font-medium mt-2">Financial overview and operational quality insights.</p>
      </div>

      {/* 1. Top Section: Financial Metrics */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 mb-10">
          {[1,2,3,4].map(i => (
            <div key={i} className="bg-white p-8 rounded-3xl border border-black/[0.03] shadow-[0_2px_10px_rgba(0,0,0,0.02)] flex flex-col justify-between h-[180px] animate-pulse">
               <div className="flex items-center gap-2 mb-8"><div className="w-8 h-8 rounded-full bg-slate-100"></div><div className="w-24 h-4 bg-slate-100 rounded"></div></div>
               <div><div className="w-3/4 h-10 bg-slate-100 rounded mb-2"></div><div className="w-1/2 h-3 bg-slate-100 rounded"></div></div>
            </div>
          ))}
        </div>
      ) : (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 mb-10">
        <div className="bg-white p-8 rounded-3xl border border-black/[0.03] shadow-[0_2px_10px_rgba(0,0,0,0.02)] flex flex-col justify-between hover:shadow-[0_8px_20px_rgba(0,0,0,0.04)] transition-shadow duration-300">
          <div className="flex items-center gap-2 mb-8">
            <div className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center"><Activity size={16} className="text-blue-500" /></div>
            <span className="text-[#86868b] text-sm font-semibold tracking-wide uppercase">Expected Revenue</span>
          </div>
          <div>
            <div className="text-4xl sm:text-5xl font-semibold text-[#1d1d1f] tracking-tight mb-2">{formatCurrency(financialData.expectedRevenue)}</div>
            <p className="text-[#86868b] text-xs font-medium">รอรับรู้รายได้จากบ้านที่ลูกค้าจองแล้ว</p>
          </div>
        </div>

        <div className="bg-white p-8 rounded-3xl border border-black/[0.03] shadow-[0_2px_10px_rgba(0,0,0,0.02)] flex flex-col justify-between hover:shadow-[0_8px_20px_rgba(0,0,0,0.04)] transition-shadow duration-300">
          <div className="flex items-center gap-2 mb-8">
            <div className="w-8 h-8 rounded-full bg-orange-50 flex items-center justify-center"><Wallet size={16} className="text-orange-500" /></div>
            <span className="text-[#86868b] text-sm font-semibold tracking-wide uppercase">Sunk Cost</span>
          </div>
          <div>
            <div className="text-4xl sm:text-5xl font-semibold text-[#1d1d1f] tracking-tight mb-2">{formatCurrency(financialData.sunkCost)}</div>
            <p className="text-[#86868b] text-xs font-medium">ต้นทุนจมในบ้านพร้อมขาย (รอระบายสต๊อก)</p>
          </div>
        </div>

        <div className="bg-white p-8 rounded-3xl border border-black/[0.03] shadow-[0_2px_10px_rgba(0,0,0,0.02)] flex flex-col justify-between hover:shadow-[0_8px_20px_rgba(0,0,0,0.04)] transition-shadow duration-300">
          <div className="flex items-center gap-2 mb-8">
            <div className="w-8 h-8 rounded-full bg-purple-50 flex items-center justify-center"><Hammer size={16} className="text-purple-500" /></div>
            <span className="text-[#86868b] text-sm font-semibold tracking-wide uppercase">Total WIP Cost</span>
          </div>
          <div>
            <div className="text-4xl sm:text-4xl font-semibold text-[#1d1d1f] tracking-tight mb-2">{formatCurrency(financialData.totalConstructionCost)}</div>
            <p className="text-[#86868b] text-xs font-medium">ต้นทุนงานก่อสร้างทั้งหมดที่ทำเสร็จแล้ว</p>
          </div>
        </div>

        <div className="bg-white p-6 sm:p-8 rounded-3xl border border-black/[0.03] shadow-[0_2px_10px_rgba(0,0,0,0.02)] flex flex-col justify-between hover:shadow-[0_8px_20px_rgba(0,0,0,0.04)] transition-shadow duration-300">
          <div className="flex items-center gap-2 mb-8">
            <div className="w-8 h-8 rounded-full bg-emerald-50 flex items-center justify-center"><DollarSign size={16} className="text-emerald-500" /></div>
            <span className="text-[#86868b] text-xs sm:text-sm font-semibold tracking-wide uppercase">Planned Budget</span>
          </div>
          <div>
            <div className="text-4xl sm:text-4xl font-semibold text-[#1d1d1f] tracking-tight mb-2">{formatCurrency(financialData.totalPlannedBudget)}</div>
            <p className="text-[#86868b] text-xs font-medium">งบประมาณต้นทุนรวมทั้งหมดตามแผน</p>
          </div>
        </div>
      </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white p-8 rounded-3xl border border-black/[0.03] shadow-[0_2px_10px_rgba(0,0,0,0.02)] animate-pulse h-[400px]">
             <div className="h-6 w-1/3 bg-slate-100 rounded mb-8"></div>
             <div className="w-full h-full bg-slate-50 rounded-xl"></div>
          </div>
          <div className="bg-white p-8 rounded-3xl border border-black/[0.03] shadow-[0_2px_10px_rgba(0,0,0,0.02)] animate-pulse h-[400px]">
             <div className="flex justify-between mb-8"><div className="h-6 w-1/3 bg-slate-100 rounded"></div><div className="h-4 w-1/4 bg-slate-100 rounded"></div></div>
             <div className="space-y-4">
                {[1,2,3,4,5].map(i => <div key={i} className="w-full h-14 bg-slate-50 rounded-2xl"></div>)}
             </div>
          </div>
        </div>
      ) : (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 2. Middle Section: Construction S-Curve */}
        <div className="bg-white p-8 rounded-3xl border border-black/[0.03] shadow-[0_2px_10px_rgba(0,0,0,0.02)]">
          <div className="flex justify-between items-center mb-8">
            <h3 className="text-xl font-semibold text-[#1d1d1f] tracking-tight">Construction S-Curve (EVM)</h3>
          </div>
          
          <div className="h-[300px] w-full">
            {sCurveData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={sCurveData}
                  margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                  <XAxis 
                    dataKey="name" 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fill: '#86868b', fontSize: 12 }} 
                    dy={10}
                  />
                  <YAxis 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fill: '#86868b', fontSize: 12 }} 
                    tickFormatter={(val) => `฿${(val/1000000).toFixed(1)}M`}
                  />
                  <Tooltip 
                    contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 8px 30px rgba(0,0,0,0.12)', padding: '16px' }}
                    formatter={(value: any, name: any) => [`฿${Number(value).toLocaleString()}`, name === 'PV' ? 'Planned Value (Budget)' : 'Earned Value (Actual WIP)']}
                    labelStyle={{ fontWeight: 'bold', color: '#1d1d1f', marginBottom: '8px' }}
                  />
                  <Legend 
                    iconType="circle" 
                    wrapperStyle={{ paddingTop: '20px', fontSize: '14px', fontWeight: 500 }}
                    formatter={(value) => <span className="text-[#1d1d1f] ml-1">{value === 'PV' ? 'Planned Value (Budget)' : 'Earned Value (Actual WIP)'}</span>}
                  />
                  <Line 
                    type="monotone" 
                    name="PV"
                    dataKey="PV" 
                    stroke="#0066cc" 
                    strokeWidth={3} 
                    dot={{ r: 4, fill: '#0066cc', strokeWidth: 0 }}
                    activeDot={{ r: 6, strokeWidth: 0 }}
                  />
                  <Line 
                    type="monotone" 
                    name="EV"
                    dataKey="EV" 
                    stroke="#34c759" 
                    strokeWidth={3} 
                    dot={{ r: 4, fill: '#34c759', strokeWidth: 0 }}
                    activeDot={{ r: 6, strokeWidth: 0 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="w-full h-full flex items-center justify-center text-[#86868b] text-sm">
                No schedule data available for S-Curve.
              </div>
            )}
          </div>
        </div>

        {/* 3. Bottom Section: Contractor Quality Score */}
        <div className="bg-white p-8 rounded-3xl border border-black/[0.03] shadow-[0_2px_10px_rgba(0,0,0,0.02)]">
          <div className="flex justify-between items-center mb-8">
            <h3 className="text-xl font-semibold text-[#1d1d1f] tracking-tight">Contractor Quality Score</h3>
            <span className="text-[#86868b] text-xs font-medium">Based on rework rates</span>
          </div>

          <div className="space-y-4">
            {foremanPerformance.length === 0 ? (
              <p className="text-[#86868b] text-sm text-center py-8">No contractor data.</p>
            ) : foremanPerformance.slice(0, 5).map((f: any, idx: number) => (
              <div key={idx} className="flex items-center justify-between p-4 rounded-2xl hover:bg-[#fbfbfd] transition-colors group cursor-pointer border border-transparent hover:border-black/[0.02]">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-[#f5f5f7] flex items-center justify-center font-semibold text-[#1d1d1f]">
                    {idx + 1}
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-[#1d1d1f]">{f.name}</h4>
                    <p className="text-xs text-[#86868b] font-medium">{f.reworks} reworks historically</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <span className={`text-lg font-semibold tracking-tight ${f.score >= 90 ? 'text-emerald-500' : f.score >= 70 ? 'text-orange-500' : 'text-rose-500'}`}>
                      {f.score}
                    </span>
                    <span className="text-[#86868b] text-xs font-medium ml-1">pts</span>
                  </div>
                  <ChevronRight size={16} className="text-[#d2d2d7] group-hover:text-[#1d1d1f] transition-colors" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      )}
    </div>
  );
}
