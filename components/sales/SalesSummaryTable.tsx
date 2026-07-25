"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { Loader2, Search, Building2, UserCircle, DollarSign, Home, CheckCircle2, Clock } from 'lucide-react';

export default function SalesSummaryTable() {
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<any[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>('');
  
  const [plots, setPlots] = useState<any[]>([]);
  const [sales, setSales] = useState<any[]>([]);
  const [leads, setLeads] = useState<any[]>([]);

  // Fetch projects on mount
  useEffect(() => {
    const fetchProjects = async () => {
      const { data } = await supabase.from('projects').select('name').order('name');
      if (data && data.length > 0) {
        setProjects(data);
        setSelectedProject(data[0].name);
      }
    };
    fetchProjects();
  }, []);

  // Fetch data when project changes
  useEffect(() => {
    if (!selectedProject) return;
    
    const fetchData = async () => {
      setLoading(true);
      try {
        // 1. Fetch plots excluding infra
        const { data: pData } = await supabase
          .from('plots')
          .select('*, house_types(type_name)')
          .eq('project_name', selectedProject);
        
        const validPlots = (pData || []).filter(p => p.house_types?.type_name !== 'สาธารณูปโภค');
        setPlots(validPlots);

        // 2. Fetch sales for these plots
        const plotIds = validPlots.map(p => p.id);
        let sData: any[] = [];
        if (plotIds.length > 0) {
          const chunkArray = (arr: any[], size: number) => Array.from({ length: Math.ceil(arr.length / size) }, (v, i) => arr.slice(i * size, i * size + size));
          const chunks = chunkArray(plotIds, 100);
          for (const chunk of chunks) {
            const { data } = await supabase.from('sales').select('*').in('plot_id', chunk);
            if (data) sData = [...sData, ...data];
          }
        }
        setSales(sData);

        // 3. Fetch leads for these sales
        const leadIds = sData.map(s => s.lead_id).filter(Boolean);
        let lData: any[] = [];
        if (leadIds.length > 0) {
          const chunkArray = (arr: any[], size: number) => Array.from({ length: Math.ceil(arr.length / size) }, (v, i) => arr.slice(i * size, i * size + size));
          const chunks = chunkArray(leadIds, 100);
          for (const chunk of chunks) {
            const { data } = await supabase.from('leads').select('*').in('id', chunk);
            if (data) lData = [...lData, ...data];
          }
        }
        setLeads(lData);

      } catch (e) {
        console.error(e);
      }
      setLoading(false);
    };

    fetchData();
  }, [selectedProject]);

  // Combine data
  const tableData = useMemo(() => {
    return plots.map(plot => {
      // Find the most recent sale or the active one
      const sale = sales.find(s => s.plot_id === plot.id && s.contract_status !== 'Cancelled') || sales.find(s => s.plot_id === plot.id);
      const lead = sale ? leads.find(l => l.id === sale.lead_id) : null;

      const basePrice = Number(plot.selling_price || 0);
      const salePrice = sale ? Number(sale.sale_price || 0) : 0;
      const landAppraisal = Number(sale?.land_office_price || plot.land_appraisal_price || 0);
      
      const isVacant = !plot.has_customer;

      return {
        id: plot.id,
        plotName: plot.plot_name || plot.id,
        hasCustomer: plot.has_customer,
        customerName: lead?.customer_name || '-',
        status: sale?.contract_status || plot.sale_status || (isVacant ? 'ว่าง' : 'รอดำเนินการ'),
        agentName: lead?.agent_name || '-',
        basePrice,
        salePrice,
        landAppraisal,
        expectedTransfer: sale?.expected_transfer_date ? sale.expected_transfer_date.split('T')[0] : '-',
        actualTransfer: sale?.transferred_at ? sale.transferred_at.split('T')[0] : '-',
        isTransferred: sale?.contract_status === 'Transferred' || plot.sale_status === 'Transferred'
      };
    }).sort((a, b) => String(a.plotName).localeCompare(String(b.plotName), undefined, { numeric: true }));
  }, [plots, sales, leads]);

  // Summary Metrics
  const summary = useMemo(() => {
    let totalBase = 0;
    let totalSale = 0;
    let totalAppraisal = 0;
    let transferred = 0;
    let pending = 0;
    let vacant = 0;

    tableData.forEach(row => {
      totalBase += row.basePrice;
      totalAppraisal += row.landAppraisal;
      if (row.hasCustomer) {
        totalSale += row.salePrice;
      }
      
      if (row.isTransferred) {
        transferred++;
      } else if (!row.hasCustomer) {
        vacant++;
      } else {
        pending++;
      }
    });

    return { totalBase, totalSale, totalAppraisal, transferred, pending, vacant };
  }, [tableData]);

  const fmt = (val: number) => new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB', minimumFractionDigits: 0 }).format(val);

  return (
    <div className="w-full h-full flex flex-col p-4 sm:p-8 space-y-6">
      {/* Header & Project Selector */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white/60 backdrop-blur-xl p-5 rounded-2xl border border-white shadow-sm">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <Building2 className="text-[#d4af37]" />
            ตารางสรุปฝั่งขาย (Sales Summary)
          </h1>
          <p className="text-sm text-slate-500 mt-1">สรุปข้อมูลการขาย ส่วนต่างราคา และสถานะการโอนของโครงการ</p>
        </div>
        
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-slate-600">เลือกโครงการ:</span>
          <select 
            value={selectedProject}
            onChange={(e) => setSelectedProject(e.target.value)}
            className="bg-white border border-slate-200 text-slate-700 text-sm rounded-lg focus:ring-[#d4af37] focus:border-[#d4af37] block w-48 p-2.5 shadow-sm"
          >
            {projects.map(p => (
              <option key={p.name} value={p.name}>{p.name}</option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="flex-1 flex justify-center items-center">
          <Loader2 className="animate-spin text-[#d4af37] w-12 h-12" />
        </div>
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
            <div className="bg-white/80 backdrop-blur-md p-4 rounded-2xl border border-white shadow-sm flex flex-col justify-between">
              <div className="text-xs font-semibold text-slate-400 mb-1">ยอดรวมราคาตั้ง</div>
              <div className="text-lg sm:text-xl font-bold text-slate-800">{fmt(summary.totalBase)}</div>
            </div>
            <div className="bg-white/80 backdrop-blur-md p-4 rounded-2xl border border-white shadow-sm flex flex-col justify-between">
              <div className="text-xs font-semibold text-slate-400 mb-1">ยอดรวมขายได้</div>
              <div className="text-lg sm:text-xl font-bold text-emerald-600">{fmt(summary.totalSale)}</div>
            </div>
            <div className="bg-white/80 backdrop-blur-md p-4 rounded-2xl border border-white shadow-sm flex flex-col justify-between">
              <div className="text-xs font-semibold text-slate-400 mb-1">ยอดรวมราคา ทด (ประเมิน)</div>
              <div className="text-lg sm:text-xl font-bold text-rose-500">{fmt(summary.totalAppraisal)}</div>
            </div>
            <div className="bg-white/80 backdrop-blur-md p-4 rounded-2xl border border-white shadow-sm flex flex-col justify-between">
              <div className="text-xs font-semibold text-slate-400 mb-1">โอนแล้ว</div>
              <div className="text-2xl font-black text-blue-600 flex items-center gap-2"><CheckCircle2 size={20}/> {summary.transferred} <span className="text-sm font-normal text-slate-400">แปลง</span></div>
            </div>
            <div className="bg-white/80 backdrop-blur-md p-4 rounded-2xl border border-white shadow-sm flex flex-col justify-between">
              <div className="text-xs font-semibold text-slate-400 mb-1">รอดำเนินการ</div>
              <div className="text-2xl font-black text-orange-500 flex items-center gap-2"><Clock size={20}/> {summary.pending} <span className="text-sm font-normal text-slate-400">แปลง</span></div>
            </div>
            <div className="bg-white/80 backdrop-blur-md p-4 rounded-2xl border border-white shadow-sm flex flex-col justify-between">
              <div className="text-xs font-semibold text-slate-400 mb-1">ว่าง (ยังไม่มีลูกค้า)</div>
              <div className="text-2xl font-black text-slate-400 flex items-center gap-2"><Home size={20}/> {summary.vacant} <span className="text-sm font-normal text-slate-400">แปลง</span></div>
            </div>
          </div>

          {/* Data Table */}
          <div className="flex-1 bg-white/80 backdrop-blur-md rounded-3xl border border-white shadow-sm overflow-hidden flex flex-col">
            <div className="overflow-x-auto flex-1 custom-scrollbar">
              <table className="w-full text-left border-collapse min-w-[1200px]">
                <thead>
                  <tr className="bg-slate-50/80 text-slate-500 text-[11px] sm:text-xs uppercase tracking-wider sticky top-0 z-10 backdrop-blur-md">
                    <th className="p-4 font-bold border-b border-slate-100 whitespace-nowrap">แปลง</th>
                    <th className="p-4 font-bold border-b border-slate-100 whitespace-nowrap">ลูกค้า</th>
                    <th className="p-4 font-bold border-b border-slate-100 whitespace-nowrap text-center">สถานะ</th>
                    <th className="p-4 font-bold border-b border-slate-100 whitespace-nowrap">เซลล์รับผิดชอบ</th>
                    <th className="p-4 font-bold border-b border-slate-100 whitespace-nowrap text-right">ราคาขายเซล (Sale)</th>
                    <th className="p-4 font-bold border-b border-slate-100 whitespace-nowrap text-right">ราคาตั้ง (Base)</th>
                    <th className="p-4 font-bold border-b border-slate-100 whitespace-nowrap text-right">ราคา ทด (ประเมิน)</th>
                    <th className="p-4 font-bold border-b border-slate-100 whitespace-nowrap text-center">วันโอนคาดการณ์</th>
                    <th className="p-4 font-bold border-b border-slate-100 whitespace-nowrap text-center">วันโอนจริง</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {tableData.length === 0 ? (
                    <tr><td colSpan={9} className="p-8 text-center text-slate-400">ไม่มีข้อมูลแปลงในโครงการนี้ (หรือไม่พบแปลงที่ไม่ใช่สาธารณูปโภค)</td></tr>
                  ) : (
                    tableData.map((row, idx) => (
                      <tr key={row.id} className="hover:bg-black/[0.02] transition-colors">
                        <td className="p-4 font-bold text-slate-700 whitespace-nowrap border-r border-slate-50">{row.plotName}</td>
                        <td className="p-4 whitespace-nowrap">
                          {row.hasCustomer ? (
                            <span className="flex items-center gap-2 font-medium text-slate-800"><UserCircle size={16} className="text-[#d4af37]"/> {row.customerName}</span>
                          ) : (
                            <span className="text-slate-400 italic">ไม่มีลูกค้า</span>
                          )}
                        </td>
                        <td className="p-4 whitespace-nowrap text-center">
                          <span className={`px-2.5 py-1 rounded-lg text-xs font-bold tracking-wide ${
                            row.isTransferred ? 'bg-blue-100 text-blue-700' :
                            !row.hasCustomer ? 'bg-slate-100 text-slate-500' :
                            'bg-emerald-100 text-emerald-700'
                          }`}>
                            {row.status}
                          </span>
                        </td>
                        <td className="p-4 text-slate-600 font-medium whitespace-nowrap">{row.agentName}</td>
                        <td className="p-4 text-right font-bold text-emerald-600 whitespace-nowrap bg-emerald-50/30">{row.hasCustomer ? fmt(row.salePrice) : '-'}</td>
                        <td className="p-4 text-right text-slate-500 whitespace-nowrap">{fmt(row.basePrice)}</td>
                        <td className="p-4 text-right font-semibold text-rose-500 whitespace-nowrap bg-rose-50/30">{row.landAppraisal > 0 ? fmt(row.landAppraisal) : '-'}</td>
                        <td className="p-4 text-center text-slate-600 whitespace-nowrap">{row.hasCustomer ? row.expectedTransfer : '-'}</td>
                        <td className="p-4 text-center font-bold text-blue-600 whitespace-nowrap bg-blue-50/30">{row.isTransferred ? row.actualTransfer : '-'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
