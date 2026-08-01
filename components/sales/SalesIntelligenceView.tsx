"use client";

import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import SalesIntelligence from './SalesIntelligence';
import { Loader2, ArrowLeft, Building2, ArrowRight, Layers } from 'lucide-react';

export default function SalesIntelligenceView({ project, projects, onBack }: { project: any, projects?: any[], onBack?: () => void }) {
  const [internalProject, setInternalProject] = useState<any>(project || null);
  const [hasSelected, setHasSelected] = useState<boolean>(!!project);

  const [leads, setLeads] = useState<any[]>([]);
  const [projectsData, setProjectsData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (project) {
      setInternalProject(project);
      setHasSelected(true);
    }
  }, [project]);

  useEffect(() => {
    if (!hasSelected) return;

    const fetchData = async () => {
      setLoading(true);
      const projName = internalProject === 'all' ? null : internalProject?.name;
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
  }, [hasSelected, internalProject]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-slate-50">
        <Loader2 className="animate-spin text-blue-600" size={48} />
      </div>
    );
  }

  if (!hasSelected) {
    return (
      <div className="h-screen overflow-y-auto bg-[#f5f5f7] p-4 sm:p-8 w-full custom-scrollbar">
        <div className="flex items-center gap-4 mb-8">
          {onBack && (
            <button onClick={onBack} className="p-2 hover:bg-slate-200 rounded-full transition-colors bg-white shadow-sm">
              <ArrowLeft size={24} className="text-slate-600" />
            </button>
          )}
          <div className="flex items-center gap-3">
            <div className="bg-[#d4af37] p-3 rounded-2xl shadow-lg shadow-[#d4af37]/30">
              <Building2 className="text-white" size={28} />
            </div>
            <div>
              <h2 className="text-2xl sm:text-3xl font-black italic text-slate-800 uppercase tracking-tight">Strategic Report</h2>
              <p className="text-sm font-bold text-slate-500">เลือกโครงการที่ต้องการวิเคราะห์ข้อมูลเชิงลึก</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {/* Card for All Projects */}
          <div 
            onClick={() => { setInternalProject('all'); setHasSelected(true); }}
            className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.1)] border border-slate-700 overflow-hidden cursor-pointer hover:shadow-[0_20px_50px_rgb(0,0,0,0.2)] hover:-translate-y-1.5 transition-all duration-300 group flex flex-col"
          >
            <div className="h-44 relative overflow-hidden shrink-0 flex items-center justify-center">
              <div className="absolute inset-0 bg-blue-500/10" />
              <Layers size={64} className="text-white opacity-40 group-hover:scale-110 transition-transform duration-700 group-hover:opacity-60" />
              <h3 className="absolute bottom-4 left-5 text-white font-black text-2xl italic tracking-wide">ภาพรวมทุกโครงการ</h3>
            </div>
            <div className="p-5 flex-1 flex flex-col justify-between">
              <p className="text-sm font-bold text-slate-400 line-clamp-2 mb-6">วิเคราะห์ข้อมูลเชิงลึก และสถิติรวมของทุกโครงการในพอร์ตโฟลิโอของคุณ</p>
              <button className="w-full py-3.5 bg-white/10 text-white rounded-xl font-black text-sm flex items-center justify-center gap-2 group-hover:bg-blue-600 group-hover:text-white transition-all">
                ดูรายงานรวมทั้งหมด <ArrowRight size={18} />
              </button>
            </div>
          </div>

          {projects?.map((p, index) => (
            <div 
              key={p.id || p.name || index}
              onClick={() => { setInternalProject(p); setHasSelected(true); }}
              className="bg-white rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-100 overflow-hidden cursor-pointer hover:shadow-[0_20px_50px_rgb(0,0,0,0.1)] hover:-translate-y-1.5 transition-all duration-300 group flex flex-col"
            >
              <div className="h-44 bg-slate-100 relative overflow-hidden shrink-0">
                {p.logo_url ? (
                  <img src={p.logo_url} alt={p.name} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700" />
                ) : (
                  <div className="flex items-center justify-center h-full text-slate-300">
                    <Building2 size={64} className="opacity-30 group-hover:scale-110 transition-transform duration-700" />
                  </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-slate-900/90 via-slate-900/20 to-transparent" />
                <h3 className="absolute bottom-4 left-5 text-white font-black text-2xl italic tracking-wide">{p.name}</h3>
              </div>
              <div className="p-5 flex-1 flex flex-col justify-between">
                <p className="text-sm font-bold text-slate-500 line-clamp-2 mb-6">{p.description || 'ไม่ได้ระบุคำอธิบายโครงการ'}</p>
                <button className="w-full py-3.5 bg-[#d4af37]/10 text-[#d4af37] rounded-xl font-black text-sm flex items-center justify-center gap-2 group-hover:bg-[#d4af37] group-hover:text-white transition-all">
                  วิเคราะห์โครงการนี้ <ArrowRight size={18} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const handleBack = () => {
    if (!project) {
      setHasSelected(false);
      setInternalProject(null);
    } else if (onBack) {
      onBack();
    }
  };

  return (
    <div className="h-full overflow-hidden flex flex-col bg-[#f8fafc]">
      {/* Header specific to SalesIntelligence when selected from itself */}
      <header className="bg-white border-b border-gray-200 px-4 md:px-8 py-3 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 sm:gap-0 shrink-0">
        <div className="flex items-center gap-4">
          <button onClick={handleBack} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
            <ArrowLeft size={20} className="text-slate-600" />
          </button>
          <div>
            <h1 className="text-xl font-bold text-[#0f172a]">
              Strategic Report {internalProject === 'all' ? '- ภาพรวมทุกโครงการ' : `- ${internalProject?.name}`}
            </h1>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-auto bg-slate-50 p-0 relative">
        <SalesIntelligence 
          leads={leads} 
          projectName={internalProject === 'all' ? 'ทุกโครงการ' : internalProject?.name} 
          projectsData={projectsData} 
        />
      </div>
    </div>
  );
}
