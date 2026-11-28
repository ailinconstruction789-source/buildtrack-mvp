"use client";

import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { fetchSalesWithoutLimit } from '@/lib/sales/fetchWithoutLimit';
import { isExternalProject } from '@/lib/projectUtils';
import {
  buildSalesIntelligenceRecords,
  type SalesIntelligenceRecord,
} from '@/lib/sales/salesIntelligenceMetrics';
import SalesIntelligence from './SalesIntelligence';
import { Loader2, ArrowLeft, Building2, ArrowRight, Layers } from 'lucide-react';

export default function SalesIntelligenceView({ project, projects, onBack }: { project: any, projects?: any[], onBack?: () => void }) {
  const [internalProject, setInternalProject] = useState<any>(project || null);
  const [hasSelected, setHasSelected] = useState<boolean>(!!project);

  const [leads, setLeads] = useState<SalesIntelligenceRecord[]>([]);
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
        const [pDataRes, allPlots, leadsData, salesData, houseTypesRes] = await Promise.all([
          supabase.from('projects').select('name, is_closed'),
          fetchSalesWithoutLimit('plots', {
            select: 'id, plot_name, project_name, house_type_id, land_size, selling_price, land_appraisal_price, sale_status',
            orderBy: 'id',
            ascending: true,
            ...(projName ? { filterCol: 'project_name', filterVal: projName } : {}),
          }),
          fetchSalesWithoutLimit('leads', {
            select: '*',
            orderBy: 'created_at',
            ascending: false,
            ...(projName ? { filterCol: 'project_name', filterVal: projName } : {}),
          }),
          fetchSalesWithoutLimit('sales', {
            select: '*',
            orderBy: 'created_at',
            ascending: false,
          }),
          supabase.from('house_types').select('id, type_name'),
        ]);

        const visiblePlots = projName
          ? allPlots
          : allPlots.filter((pl: any) => !isExternalProject(pl?.project_name));

        let fetchedProjects: any[] = [];
        if (!pDataRes.error && pDataRes.data) {
          fetchedProjects = pDataRes.data
            .filter((p: any) => projName ? p.name === projName : !isExternalProject(p))
            .map((p: any) => {
              const count = visiblePlots.filter((pl: any) => pl.project_name === p.name).length;
              return { ...p, plotCount: count };
            });
        }
        setProjectsData(fetchedProjects);

        // Fetch status_history in chunks for visit/booking/transfer date fallback
        const chunkArray = <T,>(arr: T[], size: number) =>
          Array.from({ length: Math.ceil(arr.length / size) }, (_, i) => arr.slice(i * size, i * size + size));

        let historyData: any[] = [];
        const leadIds = leadsData.map((l: any) => l.id).filter(Boolean);
        for (const chunk of chunkArray(leadIds, 100)) {
          const { data: hData } = await supabase
            .from('status_history')
            .select('entity_id, new_status, created_at, changed_by')
            .in('entity_id', chunk)
            .order('created_at', { ascending: true });
          if (hData) historyData = historyData.concat(hData);
        }

        const formattedLeads = buildSalesIntelligenceRecords({
          leads: leadsData,
          sales: salesData,
          plots: visiblePlots,
          houseTypes: houseTypesRes.data || [],
          history: historyData,
          projectName: projName,
        });

        setLeads(formattedLeads);
      } catch (e) {
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
