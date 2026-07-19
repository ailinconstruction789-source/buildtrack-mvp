"use client";

import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import SalesReports from './SalesReports';
import { Loader2 } from 'lucide-react';

export default function SalesReportsView({ project, viewType = 'reports' }: { project: any, viewType?: 'reports' | 'agent' }) {
  const [leads, setLeads] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      const projName = project?.name;
      try {
        let leadsData: any[] = [];
        let from = 0;
        const limit = 1000;
        let hasMore = true;

        while (hasMore) {
          let query = supabase.from('leads').select('*').range(from, from + limit - 1);
          if (projName) {
             query = query.eq('project_name', projName);
          }
          const { data: chunk, error: leadsErr } = await query;
          if (leadsErr) throw leadsErr;
          
          if (chunk && chunk.length > 0) {
            leadsData = [...leadsData, ...chunk];
            if (chunk.length < limit) {
              hasMore = false; // We fetched less than limit, no more pages
            } else {
              from += limit;
            }
          } else {
            hasMore = false;
          }
        }
        
        if (!leadsData || leadsData.length === 0) {
          setLeads([]);
          setLoading(false);
          return;
        }

        // Chunking array helper to prevent PostgREST URL length limit errors
        const chunkArray = (arr: any[], size: number) => Array.from({ length: Math.ceil(arr.length / size) }, (v, i) => arr.slice(i * size, i * size + size));
        
        let salesData: any[] = [];
        let historyData: any[] = [];
        let plotsData: any[] = [];
        const leadIds = leadsData.map(l => l.id);
        const chunks = chunkArray(leadIds, 100);
        
        for (const chunk of chunks) {
          const { data: sData } = await supabase.from('sales').select('*').in('lead_id', chunk);
          if (sData) {
             salesData = [...salesData, ...sData];
             const plotIds = sData.map(s => s.plot_id).filter(Boolean);
             if (plotIds.length > 0) {
               const { data: pData } = await supabase.from('plots').select('id, plot_id, selling_price').in('plot_id', plotIds);
               if (pData) plotsData = [...plotsData, ...pData];
             }
          }
          
          const { data: hData } = await supabase.from('status_history').select('*').in('entity_id', chunk).order('created_at', { ascending: true });
          if (hData) historyData = [...historyData, ...hData];
        }

        const formattedLeads = leadsData.map(l => {
          const sale = salesData?.find(s => s.lead_id === l.id);
          const history = historyData?.filter(h => h.entity_id === l.id).map(h => ({
             status: h.new_status,
             timestamp: h.created_at,
             note: h.changed_by
          })) || [];
          
          // Excel imports save the 'Booking Date' into sale.created_at
          const explicitReserved = history.find(h => h.status === 'Reserved')?.timestamp?.split('T')[0];
          const saleCreatedAt = sale?.created_at?.split('T')[0];
          const bookingDate = explicitReserved || saleCreatedAt || l.created_at?.split('T')[0] || null;

          const plotInfo = plotsData?.find(p => p.plot_id === sale?.plot_id);
          const rawSellingPrice = sale?.sale_price ? Number(sale.sale_price) : (plotInfo?.selling_price || 0);

          return {
            id: l.id,
            name: l.customer_name,
            project: l.project_name,
            status: l.status,
            plot: sale?.plot_id || null,
            salePrice: rawSellingPrice,
            expectedTransferDate: sale?.expected_transfer_date || null,
            bookingDate,
            agentName: l.agent_name || 'ไม่ระบุ',
            created_at: l.created_at,
            history
          };
        });
        
        setLeads(formattedLeads);
      } catch(e) {
        console.error('Error fetching sales data for reports:', e);
      }
      setLoading(false);
    };

    fetchData();
  }, [project]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-slate-50">
        <Loader2 className="animate-spin text-blue-600" size={48} />
      </div>
    );
  }

  return (
    <div className="h-full overflow-hidden flex flex-col bg-[#f8fafc]">
      <header className="bg-white border-b border-gray-200 px-8 py-5 flex items-center justify-between shrink-0 shadow-sm z-10">
        <div>
          <h1 className="text-2xl font-black text-[#0f172a] tracking-tight">
            {viewType === 'agent' ? 'สรุปผลงานพนักงานขาย' : 'รายงานสรุปยอด'} {project ? `- ${project.name}` : '(รวมทุกโครงการ)'}
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            {viewType === 'agent' ? 'สรุปผลงานของฝ่ายขายแยกตามบุคคล' : 'สรุปข้อมูลการจองและการโอนกรรมสิทธิ์'}
          </p>
        </div>
      </header>
      <div className="flex-1 overflow-auto p-2 md:p-6">
        <div className="bg-white rounded-2xl shadow-[0_4px_24px_rgba(0,0,0,0.02)] border border-gray-100 min-h-full">
          <SalesReports leads={leads} projectName={project?.name || 'ทุกโครงการ'} viewType={viewType} />
        </div>
      </div>
    </div>
  );
}
