"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { Loader2, Calendar, TrendingUp, Users, BarChart } from 'lucide-react';
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer } from 'recharts';

export default function SalesDashboardExcelStyle({ project }: { project?: any }) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>({ leads: [], sales: [], plots: [], history: [], houseTypes: [] });
  
  const [selectedDateStr, setSelectedDateStr] = useState<string>(new Date().toISOString().split('T')[0]);
  const selectedYear = selectedDateStr.split('-')[0];
  const selectedMonth = selectedDateStr.split('-')[1];

  // Format currency
  const fmtM = (val: number) => new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(val);

  useEffect(() => {
    const fetchAllData = async () => {
      setLoading(true);
      try {
        const { data: pData } = await supabase.from('plots').select('*');
        const { data: lData } = await supabase.from('leads').select('*');
        const { data: hTypeData } = await supabase.from('house_types').select('*');
        
        let salesData: any[] = [];
        let historyData: any[] = [];

        if (lData && lData.length > 0) {
          const chunkArray = (arr: any[], size: number) => Array.from({ length: Math.ceil(arr.length / size) }, (v, i) => arr.slice(i * size, i * size + size));
          const leadIds = lData.map(l => l.id);
          const chunks = chunkArray(leadIds, 100);
          
          for (const chunk of chunks) {
            const { data: sData } = await supabase.from('sales').select('*').in('lead_id', chunk);
            if (sData) salesData = [...salesData, ...sData];
            
            const { data: hData } = await supabase.from('status_history').select('*').in('entity_id', chunk).order('created_at', { ascending: true });
            if (hData) historyData = [...historyData, ...hData];
          }
        }
        
        setData({ plots: pData || [], leads: lData || [], sales: salesData, history: historyData, houseTypes: hTypeData || [] });

      } catch (err) {
        console.error("Dashboard error:", err);
      }
      setLoading(false);
    };

    fetchAllData();
  }, [project]);

  const metrics = useMemo(() => {
    if (!data.leads.length) return null;

    const targetDate = new Date(selectedDateStr);
    const targetMonthPrefix = `${selectedYear}-${selectedMonth.padStart(2, '0')}`;

    const records = data.leads.map((l: any) => {
      const sale = data.sales.find((s: any) => s.lead_id === l.id);
      const plot = data.plots.find((p: any) => p.id === sale?.plot_id) || data.plots.find((p: any) => p.plot_name === l.plot_name);
      
      const history = data.history.filter((h: any) => h.entity_id === l.id);
      const bookingEvt = history.find((h: any) => h.new_status === 'Reserved' || h.new_status === 'Contracted');
      const transferEvt = history.find((h: any) => h.new_status === 'Transferred' || h.new_status === 'Handover');
      const cancelEvt = history.find((h: any) => h.new_status === 'Cancelled');
      
      const createdDate = l.created_at.split('T')[0];
      const bookDate = bookingEvt?.created_at?.split('T')[0] || sale?.created_at?.split('T')[0] || null;
      const transferDate = transferEvt?.created_at?.split('T')[0] || sale?.transferred_at?.split('T')[0] || null;
      const cancelDate = cancelEvt?.created_at?.split('T')[0] || null;

      const salePrice = sale?.sale_price ? Number(sale.sale_price) : (plot?.selling_price || 0);

      return { ...l, sale, plot, salePrice, createdDate, bookDate, transferDate, cancelDate, expectedTransfer: sale?.expected_transfer_date || null };
    });

    const validRecords = records.filter((r: any) => r.createdDate <= targetDate.toISOString().split('T')[0]);
    const viewsAcc = records.filter((r: any) => r.createdDate && r.createdDate.startsWith(selectedYear) && r.createdDate <= targetDate.toISOString().split('T')[0]).length;
    const bookedAcc = records.filter((r: any) => r.bookDate && r.bookDate.startsWith(selectedYear) && r.bookDate <= targetDate.toISOString().split('T')[0] && (!r.cancelDate || r.cancelDate > targetDate.toISOString().split('T')[0]));
    const cancelAcc = records.filter((r: any) => r.cancelDate && r.cancelDate.startsWith(selectedYear) && r.cancelDate <= targetDate.toISOString().split('T')[0]);
    const transferAcc = records.filter((r: any) => r.transferDate && r.transferDate.startsWith(selectedYear) && r.transferDate <= targetDate.toISOString().split('T')[0]);

    const viewsMonth = validRecords.filter((r: any) => r.createdDate.startsWith(targetMonthPrefix));
    const bookedMonth = validRecords.filter((r: any) => r.bookDate?.startsWith(targetMonthPrefix));
    const transferMonth = validRecords.filter((r: any) => r.transferDate?.startsWith(targetMonthPrefix));
    const cancelMonth = validRecords.filter((r: any) => r.cancelDate?.startsWith(targetMonthPrefix));

    const expectingTransfer = validRecords.filter((r: any) => r.expectedTransfer && r.expectedTransfer.startsWith(targetMonthPrefix) && !r.transferDate && (!r.cancelDate || r.cancelDate > targetMonthPrefix));

    const projectGroups: Record<string, { total: number, transferred: number, waiting: number, available: number, transVal: number, waitVal: number, availVal: number }> = {};
    
    data.plots.forEach((p: any) => {
      const isInfra = data.houseTypes?.find((h: any) => h.id === p.house_type_id)?.is_infrastructure;
      if (isInfra) return;

      const proj = p.project_name || 'ไม่ระบุ';
      if (!projectGroups[proj]) { projectGroups[proj] = { total: 0, transferred: 0, waiting: 0, available: 0, transVal: 0, waitVal: 0, availVal: 0 }; }
      
      const price = Number(p.selling_price || 0);
      
      const plotRecords = validRecords.filter((r: any) => r.plot?.id === p.id).sort((a: any, b: any) => (b.createdDate || '').localeCompare(a.createdDate || ''));
      const currentRecord = plotRecords[0];

      let status = 'Available';
      let tDate = '';
      if (currentRecord) {
        if (currentRecord.transferDate && currentRecord.transferDate <= targetDate.toISOString().split('T')[0]) {
          status = 'Transferred';
          tDate = currentRecord.transferDate;
        } else if (currentRecord.bookDate && currentRecord.bookDate <= targetDate.toISOString().split('T')[0] && (!currentRecord.cancelDate || currentRecord.cancelDate > targetDate.toISOString().split('T')[0])) {
          status = 'Waiting';
        }
      } else {
         if (p.sale_status === 'Transferred' || p.sale_status === 'Sold' || p.sale_status === 'Handover') { status = 'Transferred'; }
         else if (p.sale_status === 'Booked' || p.sale_status === 'Contracted' || p.sale_status === 'Reserved') { status = 'Waiting'; }
      }

      const yearStart = `${selectedYear}-01-01`;
      if (status === 'Transferred' && (!tDate || tDate < yearStart)) {
         return; 
      }

      projectGroups[proj].total++;

      if (status === 'Transferred') {
         projectGroups[proj].transferred++;
         projectGroups[proj].transVal += price;
      } else if (status === 'Waiting') {
         projectGroups[proj].waiting++;
         projectGroups[proj].waitVal += price;
      } else {
         projectGroups[proj].available++;
         projectGroups[proj].availVal += price;
      }
    });

    const activeProjects = Object.entries(projectGroups).filter(([_, stats]) => stats.available > 0);
    
    let sumTransVal = 0, sumWaitVal = 0, sumAvailVal = 0;
    let sumTransCnt = 0, sumWaitCnt = 0, sumAvailCnt = 0, sumTotalCnt = 0;
    
    activeProjects.forEach(([_, stats]) => {
      sumTransVal += stats.transVal; sumWaitVal += stats.waitVal; sumAvailVal += stats.availVal;
      sumTransCnt += stats.transferred; sumWaitCnt += stats.waiting; sumAvailCnt += stats.available; sumTotalCnt += stats.total;
    });

    const projChartData = activeProjects.map(([proj, _]) => {
      const bMonth = bookedMonth.filter((r: any) => (r.plot?.project_name === proj || r.project_name === proj)).length;
      const tMonth = transferMonth.filter((r: any) => (r.plot?.project_name === proj || r.project_name === proj)).length;
      return { project: proj, booking: bMonth, transfer: tMonth };
    });

    const months = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
    const years = ['2023', '2024', '2025', '2026'];
    
    const buildLineData = (dateField: string) => months.map((m, idx) => {
      const obj: any = { month: m };
      years.forEach(y => {
        const prefix = `${y}-${String(idx+1).padStart(2, '0')}`;
        obj[`y${y}`] = records.filter((r: any) => r[dateField]?.startsWith(prefix)).length;
      });
      return obj;
    });

    return {
      viewsAcc, bookedAcc, cancelAcc, transferAcc,
      viewsMonth, bookedMonth, transferMonth, cancelMonth, expectingTransfer,
      activeProjects, sumTransVal, sumWaitVal, sumAvailVal,
      sumTransCnt, sumWaitCnt, sumAvailCnt, sumTotalCnt,
      projChartData,
      lineChartTransfers: buildLineData('transferDate'),
      lineChartBookings: buildLineData('bookDate'),
      lineChartViews: buildLineData('createdDate'),
      rawValidRecords: validRecords
    };
  }, [data, selectedDateStr]);

  if (loading) return <div className="flex items-center justify-center h-full"><Loader2 className="animate-spin text-blue-600" size={48} /></div>;
  if (!metrics) return <div className="p-8 text-center text-gray-500">No data available</div>;

  return (
    <div className="bg-[#f8fafc] h-full overflow-y-auto">
      <div className="max-w-7xl mx-auto p-4 md:p-6 lg:p-8 space-y-6">
        
        {/* HEADER */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex flex-col md:flex-row justify-between items-start md:items-center">
          <div className="flex items-center gap-4">
            <div className="bg-blue-900 text-white w-12 h-12 flex items-center justify-center rounded-lg text-2xl font-bold font-serif shadow-inner">A</div>
            <div>
              <h1 className="text-2xl font-black text-blue-900 tracking-tight">Monthly Sale Report {selectedYear}</h1>
              <p className="text-sm font-semibold text-gray-500 tracking-wide uppercase mt-0.5">SOMSAMAI PROPERTY COMPANY LIMITED</p>
            </div>
          </div>
          <div className="mt-4 md:mt-0 flex items-center gap-3">
            <div className="flex items-center gap-2 bg-gray-50 p-1.5 px-3 rounded-lg border border-gray-200 shadow-sm">
              <Calendar className="w-5 h-5 text-blue-600" />
              <input 
                type="date" 
                value={selectedDateStr} 
                onChange={e => setSelectedDateStr(e.target.value)}
                className="bg-transparent border-none text-sm font-bold text-gray-800 focus:ring-0 cursor-pointer outline-none"
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* LEFT METRICS */}
          <div className="lg:col-span-3 space-y-4">
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 flex flex-col gap-4">
              <div className="flex justify-between items-center mb-1 pb-3 border-b border-gray-100">
                 <span className="font-bold text-gray-800 text-base">ยอดสะสมประจำปี {selectedYear}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="font-bold text-gray-600 text-sm">ยอดลูกค้าเข้าชมสะสม</span>
                <span className="text-2xl font-black text-blue-900">{metrics.viewsAcc}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="font-bold text-gray-600 text-sm">ยอดลูกค้าจองสะสม</span>
                <span className="text-2xl font-black text-blue-900">{metrics.bookedAcc.length}</span>
              </div>
              <div className="flex justify-between items-center bg-red-50 p-3 -mx-3 rounded-lg border border-red-100">
                <span className="font-bold text-red-600 text-sm">ยอดลูกค้ายกเลิกสะสม</span>
                <span className="text-2xl font-black text-red-600">{metrics.cancelAcc.length}</span>
              </div>
            </div>

            <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
              <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-100">
                <div className="flex items-center gap-2">
                  <Calendar className="w-5 h-5 text-blue-600" />
                  <span className="font-bold text-gray-800">ประจำเดือน {selectedMonth}/{selectedYear}</span>
                </div>
              </div>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-gray-600 text-sm font-medium">ยอดเข้าชม</span>
                  <span className="text-lg font-bold text-gray-900">{metrics.viewsMonth.length}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-600 text-sm font-medium">ยอดจอง</span>
                  <span className="text-lg font-bold text-blue-600">{metrics.bookedMonth.length}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-600 text-sm font-medium">ยอดโอน</span>
                  <span className="text-lg font-bold text-emerald-600">{metrics.transferMonth.length}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-600 text-sm font-medium">ยอดยกเลิก</span>
                  <span className="text-lg font-bold text-red-600">{metrics.cancelMonth.length}</span>
                </div>
              </div>
            </div>

            {/* MONTHLY DETAILS CARD (3 COLUMNS) */}
            <div className="bg-white p-4 lg:p-5 rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="grid grid-cols-3 gap-2">
                {/* Column 1: Booked */}
                <div>
                  <div className="text-[11px] lg:text-xs font-bold text-slate-700 mb-3 leading-tight text-center">
                    รายการที่<br/>จองในเดือน
                  </div>
                  <div className="flex justify-center">
                    <div className="text-[11px] lg:text-xs font-medium text-sky-700 space-y-1 text-left whitespace-nowrap">
                      {metrics.bookedMonth.length > 0 
                        ? [...metrics.bookedMonth].sort((a: any, b: any) => {
                            const nameA = a.plot?.project_name && a.plot?.plot_name ? `${a.plot.project_name}-${a.plot.plot_name}` : '-';
                            const nameB = b.plot?.project_name && b.plot?.plot_name ? `${b.plot.project_name}-${b.plot.plot_name}` : '-';
                            return nameA.localeCompare(nameB, 'th', { numeric: true });
                          }).map((r: any) => (
                            <div key={r.id}>
                              {r.plot?.project_name && r.plot?.plot_name ? `${r.plot.project_name}-${r.plot.plot_name}` : '-'}
                            </div>
                          ))
                        : <div className="text-center">-</div>
                      }
                    </div>
                  </div>
                </div>

                {/* Column 2: Transferred */}
                <div>
                  <div className="text-[11px] lg:text-xs font-bold text-slate-700 mb-3 leading-tight text-center">
                    รายการโอน<br/>ภายในเดือน
                  </div>
                  <div className="flex justify-center">
                    <div className="text-[11px] lg:text-xs font-medium text-sky-700 space-y-1 text-left whitespace-nowrap">
                      {metrics.transferMonth.length > 0 
                        ? [...metrics.transferMonth].sort((a: any, b: any) => {
                            const nameA = a.plot?.project_name && a.plot?.plot_name ? `${a.plot.project_name}-${a.plot.plot_name}` : '-';
                            const nameB = b.plot?.project_name && b.plot?.plot_name ? `${b.plot.project_name}-${b.plot.plot_name}` : '-';
                            return nameA.localeCompare(nameB, 'th', { numeric: true });
                          }).map((r: any) => (
                            <div key={r.id}>
                              {r.plot?.project_name && r.plot?.plot_name ? `${r.plot.project_name}-${r.plot.plot_name}` : '-'}
                            </div>
                          ))
                        : <div className="text-center">-</div>
                      }
                    </div>
                  </div>
                </div>

                {/* Column 3: Cancelled */}
                <div>
                  <div className="text-[11px] lg:text-xs font-bold text-red-600 mb-3 leading-tight text-center">
                    รายการยกเลิก<br/>ในเดือน
                  </div>
                  <div className="flex justify-center">
                    <div className="text-[11px] lg:text-xs font-medium text-red-600 space-y-1 text-left whitespace-nowrap">
                      {metrics.cancelMonth.length > 0 
                        ? [...metrics.cancelMonth].sort((a: any, b: any) => {
                            const nameA = a.plot?.project_name && a.plot?.plot_name ? `${a.plot.project_name}-${a.plot.plot_name}` : '-';
                            const nameB = b.plot?.project_name && b.plot?.plot_name ? `${b.plot.project_name}-${b.plot.plot_name}` : '-';
                            return nameA.localeCompare(nameB, 'th', { numeric: true });
                          }).map((r: any) => (
                            <div key={r.id}>
                              {r.plot?.project_name && r.plot?.plot_name ? `${r.plot.project_name}-${r.plot.plot_name}` : '-'}
                            </div>
                          ))
                        : <div className="text-center">-</div>
                      }
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-gradient-to-br from-blue-900 to-indigo-900 p-5 rounded-2xl shadow-md text-white">
              <div className="text-blue-100 text-sm font-medium mb-1">คาดว่าจะโอนเดือนนี้</div>
              <div className="flex items-end gap-2 mb-2">
                <span className="text-4xl font-black">{metrics.expectingTransfer.length}</span>
                <span className="text-blue-200 font-medium mb-1">หลัง</span>
              </div>
              <div className="text-sm text-blue-200 font-medium bg-white/10 p-2 rounded inline-block mt-2">
                {fmtM(metrics.expectingTransfer.reduce((sum: number, r: any) => sum + r.salePrice, 0))}
              </div>
            </div>
          </div>

          {/* MAIN CONTENT */}
          <div className="lg:col-span-9 flex flex-col gap-6">
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden flex flex-col xl:flex-row">
              <div className="flex-1 p-0 overflow-x-auto border-r border-gray-100">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="p-3 text-left font-bold text-gray-700">โครงการ</th>
                      <th className="p-3 text-right font-bold text-emerald-600">โอน</th>
                      <th className="p-3 text-right font-bold text-blue-600">รอโอน</th>
                      <th className="p-3 text-right font-bold text-gray-500">ว่าง</th>
                      <th className="p-3 text-right font-bold text-gray-900 bg-gray-100">ทั้งหมด</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.activeProjects.map(([proj, stats]) => (
                      <tr key={proj} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                        <td className="p-3 font-semibold text-gray-800">{proj}</td>
                        <td className="p-3 text-right font-medium text-emerald-600">{stats.transferred}</td>
                        <td className="p-3 text-right font-medium text-blue-600">{stats.waiting}</td>
                        <td className="p-3 text-right text-gray-500">{stats.available}</td>
                        <td className="p-3 text-right font-bold bg-gray-50 text-gray-900">{stats.total}</td>
                      </tr>
                    ))}
                    <tr className="bg-blue-50 border-t-2 border-blue-200">
                      <td className="p-3 font-black text-blue-900">Grand Total</td>
                      <td className="p-3 text-right font-black text-emerald-700">{metrics.sumTransCnt}</td>
                      <td className="p-3 text-right font-black text-blue-700">{metrics.sumWaitCnt}</td>
                      <td className="p-3 text-right font-bold text-gray-700">{metrics.sumAvailCnt}</td>
                      <td className="p-3 text-right font-black text-blue-900">{metrics.sumTotalCnt}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="xl:w-72 p-6 bg-gray-50 flex flex-col justify-center gap-5">
                <div>
                  <div className="text-gray-500 text-xs font-bold uppercase tracking-wider mb-1">ยอดโอนสะสม</div>
                  <div className="text-xl font-black text-emerald-600">{fmtM(metrics.sumTransVal)}</div>
                </div>
                <div>
                  <div className="text-gray-500 text-xs font-bold uppercase tracking-wider mb-1">ยอดรอโอน</div>
                  <div className="text-xl font-black text-blue-600">{fmtM(metrics.sumWaitVal)}</div>
                </div>
                <div>
                  <div className="text-gray-500 text-xs font-bold uppercase tracking-wider mb-1">ยอดคงเหลือ (ว่าง)</div>
                  <div className="text-xl font-black text-gray-800">{fmtM(metrics.sumAvailVal)}</div>
                </div>
              </div>
            </div>

            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
              <h3 className="text-base font-bold text-gray-800 mb-6 flex items-center gap-2"><BarChart className="w-5 h-5 text-blue-600"/> ยอดจองและโอนประจำเดือน แต่ละโครงการ</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={metrics.projChartData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="project" tick={{fontSize: 12, fill: '#64748b'}} axisLine={false} tickLine={false} />
                    <YAxis allowDecimals={false} tick={{fontSize: 12, fill: '#64748b'}} axisLine={false} tickLine={false} />
                    <RechartsTooltip cursor={{fill: '#f8fafc'}} contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}} />
                    <Legend iconType="circle" wrapperStyle={{fontSize: 12, paddingTop: '20px'}} />
                    <Bar dataKey="booking" name="ยอดจองประจำเดือน" fill="#93c5fd" radius={[4,4,0,0]} barSize={24} />
                    <Bar dataKey="transfer" name="ยอดโอนประจำเดือน" fill="#3b82f6" radius={[4,4,0,0]} barSize={24} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>

        {/* LINE CHARTS */}
        <div className="mt-4">
          <div className="flex items-center gap-3 mb-6">
            <TrendingUp className="text-blue-600 w-7 h-7 p-1.5 bg-blue-100 rounded-lg" />
            <h2 className="text-xl font-bold text-gray-800">สรุปยอดจองและยอดโอน บจก. สมสมัย</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 h-80">
              <h3 className="text-center font-bold text-gray-700 mb-4">ยอดโอน ปี 2023 - 2026 (หลัง)</h3>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={metrics.lineChartTransfers}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="month" tick={{fontSize: 12, fill: '#64748b'}} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{fontSize: 12, fill: '#64748b'}} axisLine={false} tickLine={false} />
                  <RechartsTooltip contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}} />
                  <Line type="monotone" dataKey="y2023" name="2023" stroke="#cbd5e1" strokeWidth={2} dot={{r: 3}} />
                  <Line type="monotone" dataKey="y2024" name="2024" stroke="#818cf8" strokeWidth={2} dot={{r: 3}} />
                  <Line type="monotone" dataKey="y2025" name="2025" stroke="#f43f5e" strokeWidth={2} dot={{r: 3}} />
                  <Line type="monotone" dataKey="y2026" name="2026" stroke="#0ea5e9" strokeWidth={3} dot={{r: 4}} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 h-80">
              <h3 className="text-center font-bold text-gray-700 mb-4">ยอดจอง ปี 2023 - 2026 (หลัง)</h3>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={metrics.lineChartBookings}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="month" tick={{fontSize: 12, fill: '#64748b'}} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{fontSize: 12, fill: '#64748b'}} axisLine={false} tickLine={false} />
                  <RechartsTooltip contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}} />
                  <Line type="monotone" dataKey="y2023" name="2023" stroke="#cbd5e1" strokeWidth={2} dot={{r: 3}} />
                  <Line type="monotone" dataKey="y2024" name="2024" stroke="#818cf8" strokeWidth={2} dot={{r: 3}} />
                  <Line type="monotone" dataKey="y2025" name="2025" stroke="#f43f5e" strokeWidth={2} dot={{r: 3}} />
                  <Line type="monotone" dataKey="y2026" name="2026" stroke="#0ea5e9" strokeWidth={3} dot={{r: 4}} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
          
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 h-80">
            <h3 className="text-center font-bold text-gray-700 mb-4">ยอดเข้าชม ปี 2023 - 2026 (ครั้ง)</h3>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={metrics.lineChartViews}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="month" tick={{fontSize: 12, fill: '#64748b'}} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{fontSize: 12, fill: '#64748b'}} axisLine={false} tickLine={false} />
                <RechartsTooltip contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}} />
                <Line type="monotone" dataKey="y2023" name="2023" stroke="#cbd5e1" strokeWidth={2} dot={{r: 3}} />
                <Line type="monotone" dataKey="y2024" name="2024" stroke="#818cf8" strokeWidth={2} dot={{r: 3}} />
                <Line type="monotone" dataKey="y2025" name="2025" stroke="#f43f5e" strokeWidth={2} dot={{r: 3}} />
                <Line type="monotone" dataKey="y2026" name="2026" stroke="#0ea5e9" strokeWidth={3} dot={{r: 4}} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* DETAILED TABLE LIST */}
        <div className="mt-8 pt-6 border-t-2 border-gray-200">
          <div className="flex items-center gap-3 mb-6">
            <div className="bg-blue-100 p-2 rounded-lg">
              <Users className="text-blue-600 w-6 h-6" />
            </div>
            <h2 className="text-xl font-bold text-gray-800">รายชื่อลูกค้า (Customer List)</h2>
          </div>
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="overflow-x-auto max-h-96">
              <table className="w-full text-sm text-left">
                <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
                  <tr>
                    <th className="p-3 font-bold text-gray-700">ลำดับ</th>
                    <th className="p-3 font-bold text-gray-700">วันที่</th>
                    <th className="p-3 font-bold text-gray-700">รายชื่อลูกค้า</th>
                    <th className="p-3 font-bold text-gray-700">เบอร์โทร</th>
                    <th className="p-3 font-bold text-gray-700">โครงการ/บ้านเลขที่</th>
                    <th className="p-3 font-bold text-gray-700">ราคาขาย</th>
                    <th className="p-3 font-bold text-gray-700">Sale</th>
                    <th className="p-3 font-bold text-gray-700">สถานะ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {metrics.rawValidRecords.map((r: any, idx: number) => (
                    <tr key={r.id} className="hover:bg-gray-50">
                      <td className="p-3 text-gray-600">{idx + 1}</td>
                      <td className="p-3 text-gray-600">{r.bookDate || r.createdDate}</td>
                      <td className="p-3 font-medium text-gray-900">{r.customer_name}</td>
                      <td className="p-3 text-gray-600">{r.phone || '-'}</td>
                      <td className="p-3 text-gray-600">{r.plot?.project_name || r.project_name || '-'} / {r.plot?.plot_name || r.plot_name || '-'}</td>
                      <td className="p-3 text-blue-600 font-medium">{r.salePrice ? fmtM(r.salePrice) : '-'}</td>
                      <td className="p-3 text-gray-600">{r.agent_name || '-'}</td>
                      <td className="p-3">
                        <span className={`px-2 py-1 rounded text-xs font-bold ${
                          ['Transferred', 'Handover'].includes(r.status) ? 'bg-emerald-100 text-emerald-700' :
                          ['Reserved', 'Contracted', 'DownPayment', 'DocumentPrep', 'LoanProcessing', 'Approved'].includes(r.status) ? 'bg-blue-100 text-blue-700' :
                          r.status === 'Cancelled' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-700'
                        }`}>
                          {r.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {metrics.rawValidRecords.length === 0 && (
                    <tr>
                      <td colSpan={8} className="p-6 text-center text-gray-500">ไม่มีข้อมูลลูกค้าในปีและเดือนที่เลือก</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
