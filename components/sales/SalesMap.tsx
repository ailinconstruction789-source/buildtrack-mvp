"use client";

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { Map as MapIcon, ZoomIn, ZoomOut, Pickaxe, Home, Loader2, User } from 'lucide-react';

interface SalesMapProps {
  projectName?: string;
  leads?: any[];
  onPlotClick?: (plotId: string, status: string, lead?: any) => void;
}

export default function SalesMap({ projectName = 'ไอลิน6', leads = [], onPlotClick }: SalesMapProps) {
  const [loading, setLoading] = useState(true);
  const [mapGrid, setMapGrid] = useState<any[]>([]);
  const [gridCols, setGridCols] = useState(40);
  const [gridRows, setGridRows] = useState(24);
  const [mapZoom, setMapZoom] = useState(1);
  const [plots, setPlots] = useState<any[]>([]);
  const [showLegend, setShowLegend] = useState(false);

  useEffect(() => {
    const fetchMapData = async () => {
      setLoading(true);
      try {
        // Fetch project layout
        const { data: projectData } = await supabase
          .from('projects')
          .select('layout_data')
          .eq('name', projectName)
          .maybeSingle();

        if (projectData && projectData.layout_data) {
          const gridConfig = projectData.layout_data.find((c: any) => c.type === 'config');
          if (gridConfig) {
            setGridCols(gridConfig.cols || 40);
            setGridRows(gridConfig.rows || 24);
          }
          setMapGrid(projectData.layout_data.filter((c: any) => c.type !== 'config'));
        }

        // Fetch plots, progress, grass task assignments, and recent photos for this project
        const [plotsRes, progressRes, grassTasksRes, photosRes] = await Promise.all([
          supabase.from('plots').select('*').eq('project_name', projectName),
          supabase.from('vw_plot_progress').select('plot_id, overall_progress'),
          supabase.from('task_updates')
            .select('plot_id, progress, task_templates!inner(task_name)')
            .ilike('task_templates.task_name', '%งานปูหญ้า%')
            .eq('progress', 100),
          supabase.from('task_updates')
            .select('plot_id, photo_url, updated_at')
            .not('photo_url', 'is', null)
            .order('updated_at', { ascending: false })
        ]);
          
        if (plotsRes.data) {
          const latestPhotos: Record<string, string> = {};
          if (photosRes.data) {
            // Since it's ordered by updated_at desc, the first one encountered is the latest
            for (const row of photosRes.data) {
              if (!latestPhotos[row.plot_id] && row.photo_url) {
                latestPhotos[row.plot_id] = row.photo_url;
              }
            }
          }

          const plotsWithProgress = plotsRes.data.map((plot: any) => {
            const prog = progressRes.data?.find((p: any) => p.plot_id === plot.id);
            const isGrassPlanted = grassTasksRes.data?.some((g: any) => g.plot_id === plot.id) || false;
            
            return {
              ...plot,
              progress: prog ? Number(prog.overall_progress) : 0,
              isGrassPlanted,
              latestPhoto: latestPhotos[plot.id] || null
            };
          });
          setPlots(plotsWithProgress);
        }
      } catch (err) {
        console.error("Error fetching sales map data:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchMapData();
  }, [projectName]);

  useEffect(() => {
    // Hide legend by default on mobile screens for a better initial view
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      setShowLegend(false);
    }
  }, []);

  const handleZoomIn = () => setMapZoom(prev => Math.min(prev + 0.2, 2.5));
  const handleZoomOut = () => setMapZoom(prev => Math.max(prev - 0.2, 0.25));
  const handleZoomReset = () => setMapZoom(1);

  const plotBounds = useMemo(() => {
    const bounds: { [key: string]: any } = {};
    mapGrid.filter(c => c.type === 'plot').forEach(c => {
      if (!bounds[c.plotId]) bounds[c.plotId] = { minX: c.x, maxX: c.x, minY: c.y, maxY: c.y };
      else { 
        bounds[c.plotId].minX = Math.min(bounds[c.plotId].minX, c.x); 
        bounds[c.plotId].maxX = Math.max(bounds[c.plotId].maxX, c.x); 
        bounds[c.plotId].minY = Math.min(bounds[c.plotId].minY, c.y); 
        bounds[c.plotId].maxY = Math.max(bounds[c.plotId].maxY, c.y); 
      }
    });
    return bounds;
  }, [mapGrid]);

  const getAdjacency = (x: number, y: number, type: string, plotId: string | null) => ({ 
    hasTop: mapGrid.some(c => c.x === x && c.y === y - 1 && c.type === type && (type !== 'plot' || c.plotId === plotId)), 
    hasBottom: mapGrid.some(c => c.x === x && c.y === y + 1 && c.type === type && (type !== 'plot' || c.plotId === plotId)), 
    hasLeft: mapGrid.some(c => c.x === x - 1 && c.y === y && c.type === type && (type !== 'plot' || c.plotId === plotId)), 
    hasRight: mapGrid.some(c => c.x === x + 1 && c.y === y && c.type === type && (type !== 'plot' || c.plotId === plotId)) 
  });

  const getSalesStatus = (plotId: string) => {
    // Find if any lead is associated with this plot
    const lead = leads.find(l => l.plot === plotId && l.status !== 'Visit' && l.status !== 'Cancelled');
    if (!lead) return 'Available';
    return lead.status;
  };

  const getSalesColor = (status: string) => {
    switch (status) {
      case 'Transferred': return 'bg-violet-50 border-violet-500 text-violet-900 shadow-[0_0_15px_rgba(139,92,246,0.6)] border-[3px]';
      case 'Contracted': return 'bg-pink-50 border-pink-500 text-pink-900 shadow-[0_0_15px_rgba(236,72,153,0.6)] border-[3px]';
      case 'Reserved': return 'bg-emerald-50 border-emerald-500 text-emerald-900 shadow-[0_0_15px_rgba(16,185,129,0.6)] border-[3px]';
      case 'DownPayment': return 'bg-yellow-50 border-yellow-500 text-yellow-900 shadow-[0_0_15px_rgba(234,179,8,0.6)] border-[3px]';
      case 'DocumentPrep': return 'bg-cyan-50 border-cyan-500 text-cyan-900 border-[3px]';
      case 'LoanProcessing': return 'bg-indigo-50 border-indigo-500 text-indigo-900 border-[3px]';
      case 'Approved': return 'bg-blue-50 border-blue-500 text-blue-900 shadow-[0_0_15px_rgba(59,130,246,0.6)] border-[3px]';
      case 'Handover': return 'bg-sky-50 border-sky-500 text-sky-900 shadow-[0_0_15px_rgba(14,165,233,0.6)] border-[3px]';
      case 'Negotiation': return 'bg-orange-50 border-orange-400 text-orange-900 border-[2px]';
      case 'Available': 
      default: return 'bg-white/90 border-slate-300 text-slate-700 shadow-sm hover:border-emerald-400 hover:shadow-md border-[2px]';
    }
  };

  if (loading) {
    return <div className="h-full flex items-center justify-center bg-slate-100 rounded-2xl"><Loader2 className="animate-spin text-blue-500" size={32} /></div>;
  }

  return (
    <div className="flex flex-col w-full h-full min-w-0 bg-slate-100 rounded-2xl overflow-hidden relative border border-slate-200">
      
      {/* Zoom Controls & Legend */}
      <div className="absolute top-4 right-4 z-50 flex flex-col gap-2">
        <div className="flex bg-white rounded-lg shadow-md p-1 border border-black/5">
          <button onClick={handleZoomOut} className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-slate-50 rounded-md transition-colors"><ZoomOut size={16} /></button>
          <button onClick={handleZoomReset} className="px-2 text-xs font-bold text-slate-500 hover:text-blue-600 hover:bg-slate-50 rounded-md transition-colors">{Math.round(mapZoom * 100)}%</button>
          <button onClick={handleZoomIn} className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-slate-50 rounded-md transition-colors"><ZoomIn size={16} /></button>
        </div>
      </div>

      {/* Grid Canvas */}
      <div className="flex-1 w-full h-full overflow-auto bg-slate-300 custom-scrollbar relative">
        <div 
            className="relative mx-auto bg-slate-300 select-none origin-top-left transition-transform duration-200 shrink-0 cursor-grab" 
            style={{ 
                width: `${gridCols * 40}px`, 
                minWidth: `${gridCols * 40}px`,
                height: `${gridRows * 40}px`, 
                transform: `scale(${mapZoom})`,
              backgroundImage: `radial-gradient(#94a3b8 1.5px, transparent 1.5px)`,
              backgroundSize: `40px 40px` // Dot grid pattern
          }} 
        >
          {/* Base Grid & Roads */}
          <div 
            className="absolute inset-0 grid" 
            style={{ gridTemplateColumns: `repeat(${gridCols}, 1fr)`, gridTemplateRows: `repeat(${gridRows}, 1fr)` }}
          >
            {Array.from({length: gridCols * gridRows}).map((_, i) => {
              const x = i % gridCols, y = Math.floor(i / gridCols);
              const cellData = mapGrid.find(c => c.x === x && c.y === y && (c.type === 'plot' || c.type === 'road'));
              
              let baseStyles = 'border-r border-b border-transparent ';
              if (cellData?.type === 'plot') {
                const adj = getAdjacency(x, y, 'plot', cellData.plotId);
                
                return (
                  <div key={i} className="relative border-r border-b border-slate-400">
                    <div className="absolute inset-0 bg-white"></div>
                    {!adj.hasTop && <div className="absolute top-0 left-0 right-0 h-1 bg-slate-400"></div>}
                    {!adj.hasBottom && <div className="absolute bottom-0 left-0 right-0 h-1 bg-slate-400"></div>}
                    {!adj.hasLeft && <div className="absolute top-0 bottom-0 left-0 w-1 bg-slate-400"></div>}
                    {!adj.hasRight && <div className="absolute top-0 bottom-0 right-0 w-1 bg-slate-400"></div>}
                  </div>
                );
              }
              if (cellData?.type === 'road') {
                return (
                  <div key={i} className="bg-slate-400 border-slate-400 border-r border-b relative flex items-center justify-center">
                    {x % 3 === 0 && <div className="w-4 h-0.5 bg-yellow-400/50 rounded-full"></div>}
                  </div>
                );
              }
              return <div key={i} className={baseStyles}></div>;
            })}
          </div>
          
          {/* Plots */}
          {Object.entries(plotBounds).map(([plotId, bounds]:any) => {
            const w = bounds.maxX - bounds.minX + 1;
            const h = bounds.maxY - bounds.minY + 1;
            const activeLead = leads.find(l => {
              if (l.status === 'Visit' || l.status === 'Cancelled') return false;
              if (l.plot === plotId || l.plotName === plotId) return true;
              if (l.plotName) {
                const normL = l.plotName.replace(/\s+/g, '');
                const normId = plotId.replace(/\s+/g, '');
                const prefix = projectName.replace(/\s+/g, '');
                if (`${prefix}-${normL}` === normId || `${prefix}${normL}` === normId) return true;
                if (normL === normId.replace(new RegExp(`^${prefix}-?`), '')) return true;
              }
              return false;
            });
            const status = activeLead ? activeLead.status : 'Available';
            const cardBorderClass = getSalesColor(status);
            
            // Check if Construction is finished or grass is planted
            const plotInfo = plots.find((p: any) => {
              if (p.id === plotId || p.plot_name === plotId) return true;
              const normP = p.plot_name.replace(/\s+/g, '');
              const normId = plotId.replace(/\s+/g, '');
              const prefix = projectName.replace(/\s+/g, '');
              if (`${prefix}-${normP}` === normId || `${prefix}${normP}` === normId) return true;
              if (normP === normId.replace(new RegExp(`^${prefix}-?`), '')) return true;
              return false;
            });
            const isGrassPlanted = plotInfo?.isGrassPlanted || plotInfo?.is_completed || false;

            return (
              <div 
                key={`plot-${plotId}`} 
                className={`absolute flex items-center justify-center p-1 transition-all hover:z-50 cursor-pointer group`} 
                style={{ left: `${(bounds.minX / gridCols) * 100}%`, top: `${(bounds.minY / gridRows) * 100}%`, width: `${(w / gridCols) * 100}%`, height: `${(h / gridRows) * 100}%` }}
                onClick={() => {
                  if (onPlotClick) {
                    onPlotClick(plotId, status, activeLead);
                  }
                }}
              >
                <div className={`w-full h-full rounded-md shadow-sm backdrop-blur-sm flex flex-col items-center justify-center relative transition-all group-hover:scale-[1.05] ${cardBorderClass} overflow-hidden`}>
                  
                  {/* Grass Hatch */}
                  {isGrassPlanted && (
                    <div className="absolute inset-0 pointer-events-none z-0 opacity-40" style={{ 
                        backgroundImage: `url("data:image/svg+xml;utf8,<svg width='40' height='40' xmlns='http://www.w3.org/2000/svg'><g stroke='%2316a34a' stroke-width='1.2' stroke-linecap='round' fill='none'><path d='M10,25 Q12,18 15,12 M10,25 Q15,22 20,18 M10,25 Q8,18 5,14' /><path d='M30,15 Q32,8 35,2 M30,15 Q35,12 40,8 M30,15 Q28,8 25,4' /></g></svg>")`,
                        backgroundSize: '30px 30px'
                    }}></div>
                  )}

                  <div className="flex flex-col items-center relative z-10 w-full px-0.5 mt-2 sm:mt-1">
                    <span className="font-bold text-[8px] sm:text-[9px] leading-tight text-center break-words">{plotId}</span>
                    {status !== 'Available' && status !== 'Cancelled' && (
                      <div className="flex flex-col items-center mt-0.5">
                        <User size={10} className="opacity-80" strokeWidth={2.5} />
                        {activeLead?.agentName && (
                           <span className="text-[5px] sm:text-[6px] text-center leading-none mt-0.5 font-bold opacity-90 truncate w-full max-w-[20px] sm:max-w-[30px]" title={activeLead.agentName}>{activeLead.agentName}</span>
                        )}
                      </div>
                    )}
                  </div>
                  {/* Status Badges */}
                  {(plotInfo?.is_completed || plotInfo?.sale_status === 'ready_for_sale') ? (
                    <div className="absolute top-0 left-0 bg-blue-500 text-white rounded-br-md px-1 py-0.5 text-[6px] sm:text-[8px] font-bold shadow-sm z-30 flex items-center justify-center" title="สร้างเสร็จพร้อมขาย">
                      <span className="text-[7px]">✅</span>
                    </div>
                  ) : (plotInfo?.progress > 0 && (
                    <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-[7px] font-bold flex flex-col items-center z-30 backdrop-blur-sm" title="กำลังก่อสร้าง">
                      <div className="flex items-center gap-1 py-0.5">
                        <Pickaxe size={8} className="text-amber-400" />
                        <span>กำลังสร้าง {Math.round(plotInfo.progress)}%</span>
                      </div>
                      <div className="w-full h-[2px] bg-white/20">
                        <div className="h-full bg-amber-400" style={{ width: `${plotInfo.progress}%` }}></div>
                      </div>
                    </div>
                  ))}
                  {/* Hover Photo Popover */}
                  {plotInfo?.latestPhoto && (
                    <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-[105%] hidden group-hover:flex flex-col items-center z-50 pointer-events-none w-24">
                      <div className="bg-white p-1 rounded-xl shadow-xl border border-slate-200">
                        <img src={plotInfo.latestPhoto} alt="Latest Site Photo" className="w-full h-16 object-cover rounded-lg" />
                      </div>
                      <div className="w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[8px] border-t-white -mt-[1px]"></div>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Color Legend */}
      <div className="absolute top-4 left-4 z-50 flex flex-col gap-2">
        <button 
          onClick={() => setShowLegend(!showLegend)} 
          className="bg-white/95 backdrop-blur-md border border-slate-200 rounded-lg p-2 shadow-md text-xs font-bold text-slate-700 hover:text-indigo-600 transition-colors flex items-center gap-2"
        >
          <MapIcon size={14} /> {showLegend ? 'ซ่อนคำอธิบาย' : 'สัญลักษณ์ (Legend)'}
        </button>

        {showLegend && (
          <div className="bg-white/95 backdrop-blur-md border border-slate-200 rounded-xl p-4 shadow-lg w-52 animate-in fade-in slide-in-from-top-2">
            <h4 className="text-xs font-bold text-slate-800 mb-3 pb-2 border-b border-slate-100 flex items-center justify-between">
              สถานะการขาย <span className="text-[10px] text-slate-400 font-normal">Legend</span>
            </h4>
            <div className="flex flex-col gap-2.5 text-[11px] font-semibold text-slate-600">
              <div className="flex items-center gap-3"><div className="w-3.5 h-3.5 rounded-full bg-slate-50 border border-slate-300 shadow-sm"></div> ว่าง (Available)</div>
              <div className="flex items-center gap-3"><div className="w-3.5 h-3.5 rounded-full bg-emerald-50 border-[2px] border-emerald-500 shadow-sm"></div> จองแล้ว (Reserved)</div>
              <div className="flex items-center gap-3"><div className="w-3.5 h-3.5 rounded-full bg-pink-50 border-[2px] border-pink-500 shadow-sm"></div> ทำสัญญา (Contracted)</div>
              <div className="flex items-center gap-3"><div className="w-3.5 h-3.5 rounded-full bg-yellow-50 border-[2px] border-yellow-500 shadow-sm"></div> ผ่อนดาวน์ (DownPayment)</div>
              <div className="flex items-center gap-3"><div className="w-3.5 h-3.5 rounded-full bg-cyan-50 border-[2px] border-cyan-500 shadow-sm"></div> รอยื่นเอกสาร (Doc Prep)</div>
              <div className="flex items-center gap-3"><div className="w-3.5 h-3.5 rounded-full bg-indigo-50 border-[2px] border-indigo-500 shadow-sm"></div> รอผลสินเชื่อ (Loan Process)</div>
              <div className="flex items-center gap-3"><div className="w-3.5 h-3.5 rounded-full bg-blue-50 border-[2px] border-blue-500 shadow-sm"></div> อนุมัติแล้ว (Approved)</div>
              <div className="flex items-center gap-3"><div className="w-3.5 h-3.5 rounded-full bg-violet-50 border-[2px] border-violet-500 shadow-sm"></div> โอนกรรมสิทธิ์ (Transferred)</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
