"use client";

import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import SalesIntelligence from './SalesIntelligence';
import { Loader2 } from 'lucide-react';

export default function SalesIntelligenceView({ project }: { project: any }) {
  const [leads, setLeads] = useState<any[]>([]);
  const [projectsData, setProjectsData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      const projName = project?.name;
      try {
        let leadsData: any[] = [];
        let fetchedProjects: any[] = [];
        
        // Fetch projects
        const { data: pData, error: pErr } = await supabase.from('projects').select('name, is_closed');
        const { data: plotData } = await supabase.from('plots').select('project_name');

        if (!pErr && pData) {
          fetchedProjects = pData.map(p => {
             const count = plotData?.filter(pl => pl.project_name === p.name).length || 0;
             return { ...p, plotCount: count };
          });
        }
        setProjectsData(fetchedProjects);

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
        const leadIds = leadsData.map(l => l.id);
        const chunks = chunkArray(leadIds, 100);
        
        for (const chunk of chunks) {
          const { data: sData } = await supabase.from('sales').select('*').in('lead_id', chunk);
          if (sData) salesData = [...salesData, ...sData];
          
          const { data: hData } = await supabase.from('status_history').select('*').in('entity_id', chunk).order('created_at', { ascending: true });
          if (hData) historyData = [...historyData, ...hData];
        }

        const plotIds = salesData.map(s => s.plot_id).filter(Boolean);
        const uniquePlotIds = Array.from(new Set(plotIds));
        let plotsData: any[] = [];
        if (uniquePlotIds.length > 0) {
          const pChunks = chunkArray(uniquePlotIds, 100);
          for (const pc of pChunks) {
            const { data: pData } = await supabase.from('plots').select('id, house_type_id, land_size, selling_price').in('id', pc);
            if (pData) plotsData = [...plotsData, ...pData];
          }
        }
        const { data: houseTypes } = await supabase.from('house_types').select('id, type_name');

        const formattedLeads = leadsData.map(l => {
          const sale = salesData?.find(s => s.lead_id === l.id);
          const history = historyData?.filter(h => h.entity_id === l.id).map(h => ({
             status: h.new_status,
             timestamp: h.created_at,
             note: h.changed_by
          })) || [];
          
          const visitDate = history.find(h => h.status === 'Visit')?.timestamp?.split('T')[0] || l.created_at.split('T')[0];
          const bookingDate = history.find(h => h.status === 'Reserved')?.timestamp?.split('T')[0] || null;

          const plot = plotsData.find(p => p.id === sale?.plot_id);
          const houseType = houseTypes?.find(ht => ht.id === plot?.house_type_id);

          return {
            id: l.id,
            name: l.customer_name,
            project: l.project_name,
            status: l.status,
            plot: sale?.plot_id || null,
            salePrice: sale?.sale_price ? Number(sale.sale_price) : 0,
            rawSellingPrice: plot?.selling_price || 0,
            landSize: plot?.land_size || 0,
            houseModel: houseType?.type_name || 'ไม่ระบุ',
            expectedTransferDate: sale?.expected_transfer_date || null,
            bookingDate,
            visitDate,
            agentName: l.agent_name || 'ไม่ระบุ',
            source: l.source || 'Walk-in',
            bankStatus: sale?.bank_status || 'Pending',
            cancelReason: sale?.cancellation_reason || '',
            created_at: l.created_at,
            history
          };
        });
        
        setLeads(formattedLeads);
      } catch(e) {
        console.error('Error fetching sales data for intelligence:', e);
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
      <div className="flex-1 overflow-auto bg-slate-50 min-h-full p-0">
        <SalesIntelligence leads={leads} projectName={project?.name || 'ทุกโครงการ'} projectsData={projectsData} />
      </div>
    </div>
  );
}
