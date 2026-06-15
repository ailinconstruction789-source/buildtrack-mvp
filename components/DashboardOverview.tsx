import React from 'react';
import { Wrench, Users, PlusCircle, Building, ClipboardList, Monitor, Settings, Map as MapIcon, AlertTriangle, Grid, Clock, SortAsc, CheckCircle, HardHat, FolderOpen, Activity, AlertCircle, Home, Tag, Hammer, UserCheck } from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface DashboardOverviewProps {
  view: string;
  setView: (v: string) => void;
  isSiteEngineer: boolean;
  isQC: boolean;
  isAdmin: boolean;
  isOwner: boolean;
  isForeman: boolean;
  isProcurement: boolean;
  isProjectPlanner: boolean;
  isMobileLayout: boolean;
  projects: any[];
  plots: any[];
  taskTemplates: any[];
  loggedInUser: any;
  inspectionQueue: any[];
  inspectionFilterTab: string;
  setInspectionFilterTab: (t: string) => void;
  inspectionViewMode: string;
  setInspectionViewMode: (m: string) => void;
  inspectionSort: string;
  setInspectionSort: (s: string) => void;
  activePlotsCount: number;
  completedPlotsCount: number;
  delayedPlotsCount: number;
  setSelectedProject: (p: any) => void;
  setSelectedPlot: (p: any) => void;
  setSelectedTask: (t: any) => void;
  setTaskReturnView: (v: string) => void;
  setUpdates: (u: any[]) => void;
  setProgressValue: (v: number) => void;
  setMapGrid: (g: any[]) => void;
  setIsEditMapMode: (b: boolean) => void;
  setGridCols: (c: number) => void;
  setGridRows: (r: number) => void;
  setMapZoom: (z: number) => void;
  handleEditProject: (p: any) => void;
  loading?: boolean;
}

export default function DashboardOverview({
  view, setView, loading,
  isSiteEngineer, isQC, isAdmin, isOwner, isForeman, isProcurement, isProjectPlanner,
  isMobileLayout,
  projects, plots, taskTemplates, loggedInUser,
  inspectionQueue, inspectionFilterTab, setInspectionFilterTab,
  inspectionViewMode, setInspectionViewMode,
  inspectionSort, setInspectionSort,
  activePlotsCount, completedPlotsCount, delayedPlotsCount,
  setSelectedProject, setSelectedPlot, setSelectedTask, setTaskReturnView,
  setUpdates, setProgressValue, setMapGrid, setIsEditMapMode,
  setGridCols, setGridRows, setMapZoom,
  handleEditProject
}: DashboardOverviewProps) {
  if (view !== 'dashboard') return null;

  return (
    <div className="animate-in fade-in zoom-in-95 duration-500">
        {(isSiteEngineer || isQC || isAdmin || isOwner || isForeman || isProcurement || isProjectPlanner) && (
        <div className="mb-6 sm:mb-12 mt-8 ">
        <div className="flex flex-col md:flex-row md:justify-between md:items-end mb-3 sm:mb-6 gap-3">
        <h2 className="font-bold text-xl tracking-tight sm:text-3xl text-[#1d1d1f] italic uppercase tracking-tighter">Projects Overview</h2>
        {isMobileLayout && (
            <div className="flex flex-wrap gap-2 shrink-0 w-full">
            {isProcurement && (<button onClick={() => setView('procurement-contractors')} className="flex-1 items-center justify-center gap-1.5 bg-emerald-600 text-white px-3 py-2.5 rounded-lg font-bold text-[10px] shadow-sm flex"><Wrench size={14} /> ช่าง</button>)}
            {isAdmin && (
                <>
                <button onClick={() => setView('admin-users')} className="flex-1 items-center justify-center gap-1.5 bg-white text-rose-600 border border-rose-200 px-2 py-2.5 rounded-lg font-bold text-[10px] shadow-sm flex whitespace-nowrap"><Users size={14} /> ผู้ใช้</button>
                <button onClick={() => setView('admin-project')} className="flex-1 items-center justify-center gap-1.5 bg-slate-800 text-white px-2 py-2.5 rounded-lg font-bold text-[10px] shadow-sm flex whitespace-nowrap"><PlusCircle size={14} /> โครงการ</button>
                <button onClick={() => setView('admin-house-types')} className="flex-1 items-center justify-center gap-1.5 bg-rose-50 text-rose-600 border border-rose-200 px-2 py-2.5 rounded-lg font-bold text-[10px] shadow-sm flex whitespace-nowrap"><Building size={14} /> แบบบ้าน</button>
                <button onClick={() => setView('admin-tasks')} className="flex-1 items-center justify-center gap-1.5 bg-rose-50 text-rose-600 border border-rose-200 px-2 py-2.5 rounded-lg font-bold text-[10px] shadow-sm flex whitespace-nowrap"><ClipboardList size={14} /> งวดงาน</button>
                <button onClick={() => setView('admin-visualizer')} className="flex-1 items-center justify-center gap-1.5 bg-rose-50 text-rose-600 border border-rose-200 px-2 py-2.5 rounded-lg font-bold text-[10px] shadow-sm flex whitespace-nowrap"><Monitor size={14} /> 2.5D</button>
                </>
            )}
            </div>
        )}
      </div>
      
      <div className={`grid gap-3 sm:gap-6 ${isMobileLayout ? 'grid-cols-1' : 'grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'}`}>
        {loading ? (
          [1, 2, 3, 4].map(i => (
            <div key={i} className="bg-slate-50 w-full p-5 sm:p-8 rounded-2xl sm:rounded-[2rem] border border-black/5 flex flex-col justify-between min-h-[140px] sm:min-h-[180px]">
               <div>
                 <div className="animate-pulse bg-slate-200 h-6 sm:h-8 w-3/4 rounded-lg mb-2"></div>
                 <div className="animate-pulse bg-slate-200 h-3 sm:h-4 w-1/3 rounded-md mb-8"></div>
               </div>
               <div>
                 <div className="flex justify-between mb-2">
                   <div className="animate-pulse bg-slate-200 h-2 sm:h-3 w-1/4 rounded"></div>
                   <div className="animate-pulse bg-slate-200 h-2 sm:h-3 w-1/4 rounded"></div>
                 </div>
                 <div className="animate-pulse bg-slate-200 h-2 sm:h-3 w-full rounded-full"></div>
               </div>
            </div>
          ))
        ) : projects.map((proj) => (
          <div key={proj.name} onClick={() => { 
              const conf = proj.layout_data?.find((c: any) => c.type === 'config');
              setGridCols(conf?.cols || 40); setGridRows(conf?.rows || 24); setMapZoom(1);
              setSelectedProject(proj); setMapGrid(proj.layout_data?.filter((c: any) => c.type !== 'config') || []); setIsEditMapMode(false); setView('project-detail'); 
          }} className="premium-card w-full p-5 sm:p-8 text-left hover:border-blue-500 group relative overflow-hidden cursor-pointer">
            
            {/* 🌟 ปุ่มแก้ไขชื่อโครงการ (แสดงเฉพาะ Admin) */}
            {isAdmin && (
              <button onClick={(e) => { e.stopPropagation(); handleEditProject(proj); }} className="absolute top-4 right-4 p-2 bg-[#f5f5f7] text-[#86868b] rounded-xl opacity-0 group-hover:opacity-100 hover:bg-blue-600 hover:text-white transition-all z-20 shadow-sm" title="แก้ไขชื่อโครงการ">
                <Settings size={20} />
              </button>
            )}

            <Building size={isMobileLayout ? 60 : 100} className="absolute -right-4 -bottom-4 sm:-right-6 sm:-bottom-6 text-slate-50 group-hover:text-blue-50 transition-colors rotate-12" />
            <h3 className="text-xl sm:text-3xl font-bold text-[#1d1d1f] mb-1 sm:mb-2 relative z-10 w-full truncate text-left">{proj.name}</h3>
            <p className="text-[10px] sm:text-sm text-slate-400 font-bold uppercase tracking-wider mb-4 sm:mb-8 relative z-10 flex items-center gap-1.5">
              <MapIcon size={12} className="sm:w-4 sm:h-4"/> {isForeman ? `งานของคุณ ${plots.filter(p => p.project_name === proj.name && p.foreman === loggedInUser.username).length} แปลง` : `รวมทั้งหมด ${proj.plotCount || plots.filter(p => p.project_name === proj.name).length} แปลง`}
            </p>
            <div className="mt-2 sm:mt-4 relative z-10">
              <div className="flex justify-between items-end mb-1.5 sm:mb-2">
                <span className="text-[9px] sm:text-[10px] font-black text-slate-400 tracking-wider">OVERALL PROGRESS</span>
                <div className="flex items-center gap-2 sm:gap-3">
                  <span className="text-[9px] sm:text-[10px] font-bold text-slate-400">แผน: {Math.min(100, Math.round((proj.progress || 0) + 12))}%</span>
                  <span className="text-[10px] sm:text-xs font-black text-blue-600">จริง: {proj.progress || 0}%</span>
                </div>
              </div>
              <div className="h-2 sm:h-3 bg-[#f5f5f7] rounded-full overflow-hidden relative">
                {/* 📊 แถบแผนงาน (Plan) - สีเทาจาง */}
                <div className="absolute top-0 left-0 h-full bg-slate-200 transition-all duration-1000" style={{width: `${Math.min(100, Math.round((proj.progress || 0) + 12))}%`}}></div>
                {/* 📊 แถบงานจริง (Actual) - สีหลัก */}
                <div className="absolute top-0 left-0 h-full bg-blue-600 transition-all duration-1000" style={{width: `${proj.progress || 0}%`}}></div>
              </div>
            </div>
          </div>
        ))}
      </div>
        {/* 🌟 ส่วนหัว: โซนแท็บเมนูและปุ่มเปลี่ยนมุมมอง */}
          <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3 mb-4 sm:mb-6 mt-8">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6">
                <h2 className="font-bold text-lg tracking-tight sm:text-2xl text-[#1d1d1f] italic uppercase tracking-tighter flex items-center gap-2"><ClipboardList className={isQC ? 'text-purple-600' : 'text-blue-600'} size={20}/> Inspection Queue <span className="bg-slate-800 text-white text-[10px] px-2 py-0.5 rounded-full">{inspectionQueue.length}</span></h2>
                
                {/* 🌟 1. TABS คัดงานด่วน */}
                <div className="flex bg-slate-200/60 p-1 rounded-xl w-fit border border-black/10">
                  <button onClick={() => setInspectionFilterTab('all')} className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all ${inspectionFilterTab === 'all' ? 'bg-white shadow-sm text-[#1d1d1f]' : 'text-[#86868b] hover:text-[#1d1d1f]'}`}>ทั้งหมด</button>
                  <button onClick={() => setInspectionFilterTab('urgent')} className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 ${inspectionFilterTab === 'urgent' ? 'bg-rose-500 shadow-sm text-white' : 'text-[#86868b] hover:text-rose-600'}`}><AlertTriangle size={14}/> ด่วน <span className={`${inspectionFilterTab === 'urgent' ? 'bg-white/20 text-white' : 'bg-rose-100 text-rose-600'} px-1.5 py-0.5 rounded-md text-[10px] leading-none`}>{inspectionQueue.filter(q => (Date.now() - q.time) > 172800000).length}</span></button>
                </div>
            </div>
            
            <div className="flex items-center gap-2 w-full xl:w-auto">
                {/* 🌟 2. View Mode Toggle (ปุ่มเปลี่ยนสลับ Card / List) */}
                <div className="flex bg-slate-200/60 p-1 rounded-xl shrink-0 border border-black/10">
                  <button onClick={() => setInspectionViewMode('card')} className={`p-1.5 sm:p-2 rounded-lg transition-all ${inspectionViewMode === 'card' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-400 hover:text-blue-500'}`} title="มุมมองการ์ด"><Grid size={16}/></button>
                  <button onClick={() => setInspectionViewMode('list')} className={`p-1.5 sm:p-2 rounded-lg transition-all ${inspectionViewMode === 'list' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-400 hover:text-blue-500'}`} title="มุมมองตาราง"><ClipboardList size={16}/></button>
                </div>
                
                {/* เรียงลำดับ (ของเดิม) */}
                <div className="flex bg-white rounded-xl shadow-sm border border-black/5 overflow-hidden text-[10px] sm:text-xs font-bold flex-1 xl:flex-none"><button onClick={() => setInspectionSort('time')} className={`flex-1 xl:flex-none px-3 sm:px-4 py-2 flex justify-center items-center gap-1.5 ${inspectionSort === 'time' ? 'bg-[#f5f5f7] text-[#1d1d1f]' : 'text-slate-400'}`}><Clock size={14}/> ล่าสุด</button><button onClick={() => setInspectionSort('plot')} className={`flex-1 xl:flex-none px-3 sm:px-4 py-2 flex justify-center items-center gap-1.5 border-l border-black/5 ${inspectionSort === 'plot' ? 'bg-[#f5f5f7] text-[#1d1d1f]' : 'text-slate-400'}`}><SortAsc size={14}/> รหัสแปลง</button></div>
            </div>
          </div>

          {/* 🌟 พื้นที่แสดงผลคิวงาน */}
          {loading ? (
             <div className="flex flex-col gap-3">
               {[1,2,3].map(i => (
                 <div key={i} className="bg-slate-50 border border-slate-100 p-4 rounded-xl flex items-center gap-4 w-full">
                    <div className="w-12 h-12 rounded-xl bg-slate-200 animate-pulse shrink-0"></div>
                    <div className="flex flex-col gap-2 flex-1">
                      <div className="h-4 w-1/3 bg-slate-200 rounded animate-pulse"></div>
                      <div className="h-3 w-1/4 bg-slate-200 rounded animate-pulse"></div>
                    </div>
                 </div>
               ))}
             </div>
          ) : inspectionQueue.filter(q => inspectionFilterTab === 'all' || (inspectionFilterTab === 'urgent' && (Date.now() - q.time) > 172800000)).length === 0 ? ( 
            <div className="bg-white rounded-2xl sm:rounded-[2rem] border border-dashed border-black/10 p-8 sm:p-16 text-center flex flex-col items-center justify-center gap-3 sm:gap-4">
                <div className="w-16 h-16 sm:w-20 sm:h-20 bg-[#f5f5f7] rounded-full flex items-center justify-center"><CheckCircle size={32} className="text-emerald-400 opacity-50"/></div>
                <p className="text-slate-400 font-bold italic text-sm sm:text-xl">ไม่มีงานรอตรวจสอบในหมวดหมู่นี้</p>
            </div> 
          ) : (
            <div className="max-h-[50vh] sm:max-h-[600px] overflow-y-auto custom-scrollbar pr-1 sm:pr-3 pb-2">
              <div className={`${inspectionViewMode === 'card' ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4' : 'flex flex-col gap-2'}`}>
                {(() => {
                  const filteredQ = inspectionQueue.filter(q => inspectionFilterTab === 'all' || (inspectionFilterTab === 'urgent' && (Date.now() - q.time) > 172800000));
                  
                  if (inspectionViewMode === 'list') {
                    // Group by plot_id
                    const grouped = filteredQ.reduce((acc, q) => {
                      if (!acc[q.plot_id]) acc[q.plot_id] = [];
                      acc[q.plot_id].push(q);
                      return acc;
                    }, {} as Record<string, typeof filteredQ>);
                    
                    return (
                      <div className="flex flex-col gap-6 w-full">
                        {Object.entries(grouped).map(([plotId, items]: any) => (
                          <div key={plotId} className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden w-full">
                            <div className="bg-slate-50 border-b border-black/5 px-4 py-3 flex items-center justify-between">
                              <h3 className="font-bold text-[#1d1d1f] flex items-center gap-2"><Home size={18} className="text-blue-500"/> แปลง {plotId}</h3>
                              <span className="text-xs font-bold bg-slate-200 text-slate-600 px-2 py-0.5 rounded-md">{items.length} งาน</span>
                            </div>
                            <div className="flex flex-col">
                              {items.map((q: any, idx: number) => {
                                const isUrgent = (Date.now() - q.time) > 172800000;
                                const relatedProject = projects.find(p => p.name === q.project_name); const relatedPlot = plots.find(p => p.id === q.plot_id); const relatedTask = taskTemplates.find(t => t.id === q.task_template_id);
                                const clickAction = () => { setSelectedProject(relatedProject); setSelectedPlot(relatedPlot); setSelectedTask(relatedTask); setTaskReturnView('dashboard'); setView('task-progress'); };
                                
                                return (
                                  <button key={`${q.plot_id}-${q.task_template_id}`} onClick={clickAction} className={`p-3 sm:p-4 text-left flex flex-col sm:flex-row sm:items-center justify-between gap-3 group transition-all ${idx !== items.length - 1 ? 'border-b border-black/5' : ''} hover:bg-slate-50 ${isUrgent ? 'border-l-4 border-l-rose-500 bg-rose-50/30' : 'border-l-4 border-l-transparent'}`}>
                                    <div className="flex items-center gap-3 sm:gap-4 flex-1 overflow-hidden">
                                        <div className={`w-10 h-10 sm:w-12 sm:h-12 rounded-xl flex flex-col items-center justify-center shrink-0 shadow-inner ${q.statusFor === 'QC' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                                          <span className="text-[9px] sm:text-[10px] font-bold uppercase">รอ {q.statusFor}</span>
                                        </div>
                                        <div className="flex-1 min-w-0">
                                          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                                              <p className="text-xs sm:text-sm font-bold text-[#1d1d1f] truncate group-hover:text-blue-600 transition-colors">{q.task_name}</p>
                                              {isUrgent && <span className="bg-rose-500 text-white text-[9px] sm:text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1 animate-pulse shadow-sm whitespace-nowrap shrink-0"><AlertTriangle size={10}/> ด่วนมาก: ต้องรีบเข้าตรวจ</span>}
                                          </div>
                                          <p className="text-[10px] sm:text-xs text-slate-400 font-bold flex items-center gap-1"><HardHat size={12}/> {q.foreman}</p>
                                        </div>
                                    </div>
                                    <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center gap-1 shrink-0 pt-2 sm:pt-0 sm:pl-4">
                                        <span className={`text-[10px] sm:text-xs font-bold ${isUrgent ? 'text-rose-600' : 'text-slate-400'}`}><Clock size={12} className="inline mr-1"/> {new Date(q.time).toLocaleDateString('th-TH', {month:'short', day:'numeric'})} {new Date(q.time).toLocaleTimeString('th-TH', {hour: '2-digit', minute:'2-digit'})}</span>
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  }

                  // Card View rendering
                  return filteredQ.map(q => {
                    const isUrgent = (Date.now() - q.time) > 172800000;
                    const relatedProject = projects.find(p => p.name === q.project_name); const relatedPlot = plots.find(p => p.id === q.plot_id); const relatedTask = taskTemplates.find(t => t.id === q.task_template_id);
                    const clickAction = () => { setSelectedProject(relatedProject); setSelectedPlot(relatedPlot); setSelectedTask(relatedTask); setTaskReturnView('dashboard'); setView('task-progress'); };

                    return (
                      <button key={`${q.plot_id}-${q.task_template_id}`} onClick={clickAction} className={`bg-white p-4 sm:p-5 rounded-2xl sm:rounded-[1.5rem] border ${isUrgent ? 'border-rose-400 bg-rose-50/50' : 'border-black/5'} shadow-sm hover:border-blue-500 hover:shadow-lg hover:-translate-y-1 transition-all text-left group relative overflow-hidden`}>
                          {isUrgent && <div className="absolute top-0 left-0 w-full h-1.5 bg-rose-500"></div>}
                          <div className="flex justify-between items-start mb-3 mt-1 sm:mt-0">
                            <span className={`text-[9px] sm:text-xs font-bold uppercase tracking-widest px-2.5 py-1 rounded-md text-white shadow-sm ${q.statusFor === 'QC' ? 'bg-purple-600' : 'bg-blue-600'}`}>รอ {q.statusFor}</span>
                            <span className={`text-[9px] sm:text-[10px] font-bold flex items-center gap-1 px-2 py-1 rounded-md ${isUrgent ? 'bg-rose-100 text-rose-600 animate-pulse' : 'bg-[#f5f5f7] text-[#86868b]'}`}><Clock size={10}/> {new Date(q.time).toLocaleDateString('th-TH',{day:'numeric', month:'short'})} {new Date(q.time).toLocaleTimeString('th-TH', {hour: '2-digit', minute:'2-digit'})}</span>
                          </div>
                          <div className="flex items-center gap-2 mb-1.5">
                            <h4 className="font-bold text-[#1d1d1f] text-2xl">{q.plot_id}</h4>
                            {isUrgent && <AlertTriangle size={16} className="text-rose-500 animate-pulse"/>}
                          </div>
                          <p className="text-xs sm:text-sm font-bold text-[#86868b] line-clamp-2 my-1.5 min-h-[32px] sm:min-h-[40px]">{q.task_name}</p>
                          <p className="text-[10px] sm:text-xs text-slate-400 flex items-center gap-1.5 mt-3 pt-3 border-t border-black/5"><HardHat size={14} className="text-slate-300"/> {q.foreman}</p>
                      </button>
                    );
                  });
                })()}
              </div>
            </div>
          )}
        </div>
      )}


        <div className="mb-6 sm:mb-12">
        <h2 className="font-bold text-xl tracking-tight sm:text-3xl text-[#1d1d1f] italic uppercase tracking-tighter mb-4 sm:mb-6">Executive Summary</h2>
        <div className={`grid gap-3 sm:gap-6 ${isMobileLayout ? 'grid-cols-2' : 'grid-cols-2 md:grid-cols-3 xl:grid-cols-4'}`}>
            <div className="bg-white p-4 sm:p-6 rounded-2xl sm:rounded-[2rem] border border-black/5 shadow-sm flex flex-col justify-center items-center sm:items-start text-center sm:text-left h-28 sm:h-auto">
              <div className="flex items-center gap-1.5 sm:gap-3 text-[#86868b] mb-1 sm:mb-4"><FolderOpen size={16} className="sm:w-5 sm:h-5 hidden sm:block"/><span className="text-[10px] sm:text-sm font-bold uppercase tracking-wide truncate">Total Projects</span></div>
              <div className="text-2xl sm:text-5xl font-bold text-[#1d1d1f]">{projects.length}</div>
            </div>
            <div className="bg-white p-4 sm:p-6 rounded-2xl sm:rounded-[2rem] border border-black/5 shadow-sm flex flex-col justify-center items-center sm:items-start text-center sm:text-left h-28 sm:h-auto">
              <div className="flex items-center gap-1.5 sm:gap-3 text-blue-500 mb-1 sm:mb-4"><Activity size={16} className="sm:w-5 sm:h-5 hidden sm:block"/><span className="text-[10px] sm:text-sm font-bold uppercase tracking-wide truncate">Active Plots</span></div>
              <div className="text-2xl sm:text-5xl font-bold text-blue-600">{activePlotsCount}</div>
            </div>

            {/* 🌟 New Card: Customer Waiting */}
            <div className="bg-pink-50 p-4 sm:p-6 rounded-2xl sm:rounded-[2rem] border border-pink-200 shadow-sm flex flex-col justify-center items-center sm:items-start text-center sm:text-left h-28 sm:h-auto">
              <div className="flex items-center gap-1.5 sm:gap-3 text-pink-600 mb-1 sm:mb-4"><UserCheck size={16} className="sm:w-5 sm:h-5 hidden sm:block"/><span className="text-[10px] sm:text-sm font-bold uppercase tracking-wide truncate">เร่งปิดจ๊อบ</span></div>
              <div className="text-2xl sm:text-5xl font-bold text-pink-600">{plots.filter(p => p.has_customer && !p.is_completed).length}</div>
            </div>
            
            {/* 🌟 New Card: Ready for Sale */}
            <div className="bg-amber-50 p-4 sm:p-6 rounded-2xl sm:rounded-[2rem] border border-amber-200 shadow-sm flex flex-col justify-center items-center sm:items-start text-center sm:text-left h-28 sm:h-auto">
              <div className="flex items-center gap-1.5 sm:gap-3 text-amber-600 mb-1 sm:mb-4"><Tag size={16} className="sm:w-5 sm:h-5 hidden sm:block"/><span className="text-[10px] sm:text-sm font-bold uppercase tracking-wide truncate">Ready for Sale</span></div>
              <div className="text-2xl sm:text-5xl font-bold text-amber-600">{plots.filter(p => p.sale_status === 'ready_for_sale').length}</div>
            </div>

            <div className="bg-white p-4 sm:p-6 rounded-2xl sm:rounded-[2rem] border border-black/5 shadow-sm flex flex-col justify-center items-center sm:items-start text-center sm:text-left h-28 sm:h-auto">
              <div className="flex items-center gap-1.5 sm:gap-3 text-emerald-500 mb-1 sm:mb-4"><CheckCircle size={16} className="sm:w-5 sm:h-5 hidden sm:block"/><span className="text-[10px] sm:text-sm font-bold uppercase tracking-wide truncate">Completed</span></div>
              <div className="text-2xl sm:text-5xl font-bold text-emerald-600">{plots.filter(p => p.is_completed && p.progress === 100).length}</div>
            </div>

            {/* 🌟 New Card: Transferred - Pending Finishes */}
            <div className="bg-purple-50 p-4 sm:p-6 rounded-2xl sm:rounded-[2rem] border border-purple-200 shadow-sm flex flex-col justify-center items-center sm:items-start text-center sm:text-left h-28 sm:h-auto">
              <div className="flex items-center gap-1.5 sm:gap-3 text-purple-600 mb-1 sm:mb-4"><Hammer size={16} className="sm:w-5 sm:h-5 hidden sm:block"/><span className="text-[10px] sm:text-sm font-bold uppercase tracking-wide truncate">Pending Finish</span></div>
              <div className="text-2xl sm:text-5xl font-bold text-purple-600">{plots.filter(p => p.is_completed && p.progress < 100).length}</div>
            </div>

            <div className={`p-4 sm:p-6 rounded-2xl sm:rounded-[2rem] border shadow-sm flex flex-col justify-center items-center sm:items-start text-center sm:text-left h-28 sm:h-auto ${delayedPlotsCount > 0 ? 'bg-rose-50 border-rose-200' : 'bg-white border-black/5'}`}>
              <div className={`flex items-center gap-1.5 sm:gap-3 mb-1 sm:mb-4 ${delayedPlotsCount > 0 ? 'text-rose-500' : 'text-slate-400'}`}><AlertCircle size={16} className="sm:w-5 sm:h-5 hidden sm:block"/><span className="text-[10px] sm:text-sm font-bold uppercase tracking-wide truncate">Delayed</span></div>
              <div className={`text-2xl sm:text-5xl font-bold ${delayedPlotsCount > 0 ? 'text-rose-600' : 'text-slate-300'}`}>{delayedPlotsCount}</div>
            </div>
        </div>
      </div>
    </div>
  );
}
