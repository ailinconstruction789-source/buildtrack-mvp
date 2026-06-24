import React from 'react';
import { Wrench, Users, PlusCircle, Building, ClipboardList, Monitor, Settings, Map as MapIcon, AlertTriangle, Grid, Clock, SortAsc, CheckCircle, HardHat, FolderOpen, Activity, AlertCircle, Home } from 'lucide-react';
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
  isStore: boolean;
  isProjectPlanner: boolean;
  isMobileLayout: boolean;
  projects: any[];
  plots: any[];
  taskTemplates: any[];
  schedules?: any;
  latestUpdatesMap?: any;
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
}

const DashboardOverview = function DashboardOverview({
  view, setView,
  isSiteEngineer, isQC, isAdmin, isOwner, isForeman, isProcurement, isStore, isProjectPlanner,
  isMobileLayout,
  projects, plots, taskTemplates, schedules, latestUpdatesMap, loggedInUser,
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
    <div className="animate-in fade-in zoom-in-95 duration-500 w-full mx-auto">
        {(isSiteEngineer || isQC || isAdmin || isOwner || isForeman || isProcurement || isStore || isProjectPlanner) && (
        <div className="mb-6 sm:mb-12 mt-6 sm:mt-8">
        <div className="flex flex-col md:flex-row md:justify-between md:items-end mb-4 sm:mb-6 gap-3">
        <h2 className="font-semibold text-2xl tracking-tight sm:text-4xl text-[#1d1d1f]">Projects Overview</h2>
        {isMobileLayout && (
            <div className="flex flex-wrap gap-2 shrink-0 w-full">
            {isProcurement && (<button onClick={() => setView('procurement-contractors')} className="flex-1 items-center justify-center gap-1.5 bg-emerald-500 text-white px-3 py-2.5 rounded-xl font-medium text-[12px] shadow-sm flex active:scale-95 transition-all"><Wrench size={16} /> ช่าง</button>)}
            {isStore && (<button onClick={() => setView('store-dashboard')} className="flex-1 items-center justify-center gap-1.5 bg-blue-500 text-white px-3 py-2.5 rounded-xl font-medium text-[12px] shadow-sm flex active:scale-95 transition-all"><FolderOpen size={16} /> สโตร์</button>)}
            {isAdmin && (
                <>
                <button onClick={() => setView('admin-users')} className="flex-1 items-center justify-center gap-1.5 bg-white/70 backdrop-blur-md text-[#1d1d1f] border border-black/5 px-2 py-2.5 rounded-xl font-medium text-[12px] shadow-sm flex whitespace-nowrap active:scale-95 transition-all"><Users size={16} /> ผู้ใช้</button>
                <button onClick={() => setView('admin-project')} className="flex-1 items-center justify-center gap-1.5 bg-[#1d1d1f] text-white px-2 py-2.5 rounded-xl font-medium text-[12px] shadow-sm flex whitespace-nowrap active:scale-95 transition-all"><PlusCircle size={16} /> โครงการ</button>
                <button onClick={() => setView('admin-house-types')} className="flex-1 items-center justify-center gap-1.5 bg-white/70 backdrop-blur-md text-[#1d1d1f] border border-black/5 px-2 py-2.5 rounded-xl font-medium text-[12px] shadow-sm flex whitespace-nowrap active:scale-95 transition-all"><Building size={16} /> แบบบ้าน</button>
                <button onClick={() => setView('admin-tasks')} className="flex-1 items-center justify-center gap-1.5 bg-white/70 backdrop-blur-md text-[#1d1d1f] border border-black/5 px-2 py-2.5 rounded-xl font-medium text-[12px] shadow-sm flex whitespace-nowrap active:scale-95 transition-all"><ClipboardList size={16} /> งวดงาน</button>
                <button onClick={() => setView('admin-visualizer')} className="flex-1 items-center justify-center gap-1.5 bg-white/70 backdrop-blur-md text-[#1d1d1f] border border-black/5 px-2 py-2.5 rounded-xl font-medium text-[12px] shadow-sm flex whitespace-nowrap active:scale-95 transition-all"><Monitor size={16} /> 2.5D</button>
                </>
            )}
            </div>
        )}
      </div>
      
      <div className={`grid gap-4 sm:gap-6 ${isMobileLayout ? 'grid-cols-1' : 'grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'}`}>
        {projects.map((proj) => {
          let plannedAvg = 0;
          if (schedules && taskTemplates && plots) {
            const pPlots = plots.filter((p: any) => p.project_name === proj.name);
              let plannedTotalWeight = 0;
              let totalCost = 0;
              let naivePlannedTotal = 0;
              let taskCount = 0;
              pPlots.forEach((p: any) => {
                const pTasks = taskTemplates.filter((t: any) => t.house_type_id === p.house_type_id);
                taskCount += pTasks.length;
                pTasks.forEach((t: any) => {
                   const key = `${p.id}-${t.id}`;
                   const plan = schedules?.[key];
                   let plannedProg = 0;
                   const today = Date.now();
                   if (plan && plan.planned_start && plan.planned_end) {
                     const pStart = new Date(plan.planned_start).getTime();
                     const pEnd = new Date(plan.planned_end).getTime();
                     if (today >= pEnd) plannedProg = 100;
                     else if (today <= pStart) plannedProg = 0;
                     else plannedProg = Math.round(((today - pStart) / (pEnd - pStart)) * 100);
                   }
                   
                   const taskCost = t.cost ? Number(t.cost) : 0;
                   plannedTotalWeight += (plannedProg * taskCost);
                   totalCost += taskCost;
                   naivePlannedTotal += plannedProg;
                });
              });
              plannedAvg = totalCost > 0 
                ? Math.round(plannedTotalWeight / totalCost) 
                : (taskCount > 0 ? Math.round(naivePlannedTotal / taskCount) : 0);
            }

          return (
          <div key={proj.name} onClick={() => { 
              const conf = proj.layout_data?.find((c: any) => c.type === 'config');
              setGridCols(conf?.cols || 40); setGridRows(conf?.rows || 24); setMapZoom(1);
              setSelectedProject(proj); setMapGrid(proj.layout_data?.filter((c: any) => c.type !== 'config') || []); setIsEditMapMode(false); setView('project-detail'); 
          }} className="bg-white/80 backdrop-blur-2xl w-full p-6 sm:p-8 rounded-[2rem] sm:rounded-[2.5rem] border border-white shadow-[0_8px_30px_rgb(0,0,0,0.04)] text-left hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] hover:-translate-y-1 active:scale-[0.98] transition-all duration-300 group relative overflow-hidden cursor-pointer">
            
            {/* 🌟 ปุ่มแก้ไขชื่อโครงการ (แสดงเฉพาะ Admin) */}
            {isAdmin && (
              <button onClick={(e) => { e.stopPropagation(); handleEditProject(proj); }} className="absolute top-4 right-4 p-2.5 bg-black/5 backdrop-blur-md text-[#86868b] rounded-full opacity-0 group-hover:opacity-100 hover:bg-[#1d1d1f] hover:text-white transition-all duration-300 z-20 shadow-sm" title="แก้ไขชื่อโครงการ">
                <Settings size={18} />
              </button>
            )}

            <Building size={isMobileLayout ? 80 : 120} className="absolute -right-6 -bottom-6 text-slate-100/50 group-hover:text-blue-50 transition-colors rotate-12 pointer-events-none" />
            <h3 className="text-2xl sm:text-3xl font-semibold tracking-tight text-[#1d1d1f] mb-2 relative z-10 w-full truncate text-left">{proj.name}</h3>
            <p className="text-[12px] sm:text-sm text-[#86868b] font-medium tracking-wide mb-6 sm:mb-8 relative z-10 flex items-center gap-1.5">
              <MapIcon size={14} className="sm:w-4 sm:h-4"/> {isForeman ? `งานของคุณ ${plots.filter(p => p.project_name === proj.name && p.foreman === loggedInUser.username).length} แปลง` : `รวมทั้งหมด ${proj.plotCount || plots.filter(p => p.project_name === proj.name).length} แปลง`}
            </p>
            <div className="relative z-10 mt-4 sm:mt-6">
              <div className="flex justify-between text-[10px] font-bold text-[#86868b] mb-2 px-1">
                <span className="text-blue-500">ทำได้จริง: {proj.progress || 0}%</span>
                <span>ตามแผน: {plannedAvg}%</span>
              </div>
              <div className="h-2.5 sm:h-3 bg-black/5 rounded-full overflow-hidden shadow-inner relative">
                <div className="absolute top-0 left-0 h-full bg-slate-300 opacity-60 rounded-full" style={{ width: `${plannedAvg}%` }}></div>
                <div className={`absolute top-0 left-0 h-full ${proj.progress >= plannedAvg ? 'bg-emerald-500' : 'bg-blue-500'} rounded-full transition-all duration-1000 ease-out`} style={{ width: `${proj.progress || 0}%`, zIndex: 10 }}></div>
              </div>
            </div>
          </div>
        )
      })}
      </div>

      {/* 🌟 ส่วนหัว: โซนแท็บเมนูและปุ่มเปลี่ยนมุมมอง */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 mb-4 sm:mb-8 mt-10">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6">
            <h2 className="font-semibold text-xl tracking-tight sm:text-2xl text-[#1d1d1f] flex items-center gap-2"><ClipboardList className={isQC ? 'text-purple-500' : 'text-blue-500'} size={24}/> Inspection Queue <span className="bg-[#1d1d1f] text-white text-[11px] px-2.5 py-0.5 rounded-full font-medium">{inspectionQueue.length}</span></h2>
            
            {/* 🌟 1. TABS คัดงานด่วน */}
            <div className="flex bg-black/5 p-1 rounded-xl w-fit backdrop-blur-md">
              <button onClick={() => setInspectionFilterTab('all')} className={`px-4 py-2 text-xs font-medium rounded-lg transition-all duration-300 ${inspectionFilterTab === 'all' ? 'bg-white shadow-sm text-[#1d1d1f]' : 'text-[#86868b] hover:text-[#1d1d1f]'}`}>ทั้งหมด</button>
              <button onClick={() => setInspectionFilterTab('urgent')} className={`px-4 py-2 text-xs font-medium rounded-lg transition-all duration-300 flex items-center gap-1.5 ${inspectionFilterTab === 'urgent' ? 'bg-white shadow-sm text-rose-500' : 'text-[#86868b] hover:text-rose-500'}`}><AlertTriangle size={14}/> ด่วน <span className={`${inspectionFilterTab === 'urgent' ? 'bg-rose-100 text-rose-600' : 'bg-rose-50 text-rose-400'} px-1.5 py-0.5 rounded-md text-[10px] leading-none`}>{inspectionQueue.filter(q => (Date.now() - q.time) > 172800000).length}</span></button>
            </div>
        </div>
        
        <div className="flex items-center gap-2 w-full xl:w-auto">
            {/* 🌟 2. View Mode Toggle */}
            <div className="flex bg-black/5 p-1 rounded-xl shrink-0 backdrop-blur-md">
              <button onClick={() => setInspectionViewMode('card')} className={`p-2 rounded-lg transition-all duration-300 ${inspectionViewMode === 'card' ? 'bg-white shadow-sm text-blue-500' : 'text-[#86868b] hover:text-[#1d1d1f]'}`} title="มุมมองการ์ด"><Grid size={16}/></button>
              <button onClick={() => setInspectionViewMode('list')} className={`p-2 rounded-lg transition-all duration-300 ${inspectionViewMode === 'list' ? 'bg-white shadow-sm text-blue-500' : 'text-[#86868b] hover:text-[#1d1d1f]'}`} title="มุมมองตาราง"><ClipboardList size={16}/></button>
            </div>
            
            {/* เรียงลำดับ */}
            <div className="flex bg-white/80 backdrop-blur-md rounded-xl shadow-[0_2px_10px_rgb(0,0,0,0.02)] border border-white overflow-hidden text-[11px] sm:text-xs font-medium flex-1 xl:flex-none">
              <button onClick={() => setInspectionSort('time')} className={`flex-1 xl:flex-none px-4 py-2.5 flex justify-center items-center gap-1.5 transition-colors ${inspectionSort === 'time' ? 'bg-black/5 text-[#1d1d1f]' : 'text-[#86868b] hover:bg-black/5'}`}><Clock size={14}/> ล่าสุด</button>
              <button onClick={() => setInspectionSort('plot')} className={`flex-1 xl:flex-none px-4 py-2.5 flex justify-center items-center gap-1.5 border-l border-black/5 transition-colors ${inspectionSort === 'plot' ? 'bg-black/5 text-[#1d1d1f]' : 'text-[#86868b] hover:bg-black/5'}`}><SortAsc size={14}/> รหัสแปลง</button>
            </div>
        </div>
      </div>

      {/* 🌟 พื้นที่แสดงผลคิวงาน */}
      {inspectionQueue.filter(q => inspectionFilterTab === 'all' || (inspectionFilterTab === 'urgent' && (Date.now() - q.time) > 172800000)).length === 0 ? ( 
        <div className="bg-white/60 backdrop-blur-xl rounded-[2rem] border border-dashed border-black/10 p-10 sm:p-16 text-center flex flex-col items-center justify-center gap-4">
            <div className="w-20 h-20 bg-emerald-50 rounded-full flex items-center justify-center mb-2"><CheckCircle size={36} className="text-emerald-400"/></div>
            <p className="text-[#86868b] font-medium text-sm sm:text-lg">ไม่มีงานรอตรวจสอบในหมวดหมู่นี้</p>
        </div> 
      ) : (
        <div className="max-h-[50vh] sm:max-h-[600px] overflow-y-auto custom-scrollbar pr-1 sm:pr-3 pb-4">
          <div className={`${inspectionViewMode === 'card' ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4' : 'flex flex-col gap-3'}`}>
            {(() => {
              const filteredQ = inspectionQueue.filter(q => inspectionFilterTab === 'all' || (inspectionFilterTab === 'urgent' && (Date.now() - q.time) > 172800000));
              
              if (inspectionViewMode === 'list') {
                const grouped = filteredQ.reduce((acc, q) => {
                  if (!acc[q.plot_id]) acc[q.plot_id] = [];
                  acc[q.plot_id].push(q);
                  return acc;
                }, {} as Record<string, typeof filteredQ>);
                
                return (
                  <div className="flex flex-col gap-6 w-full">
                    {Object.entries(grouped).map(([plotId, items]: any) => (
                      <div key={plotId} className="bg-white/80 backdrop-blur-xl rounded-[1.5rem] border border-white shadow-[0_4px_20px_rgb(0,0,0,0.03)] overflow-hidden w-full">
                        <div className="bg-black/[0.02] border-b border-black/5 px-5 py-4 flex items-center justify-between">
                          <h3 className="font-semibold text-[#1d1d1f] flex items-center gap-2 text-lg"><Home size={18} className="text-blue-500"/> แปลง {plotId}</h3>
                          <span className="text-[11px] font-medium bg-black/5 text-[#86868b] px-2.5 py-1 rounded-lg">{items.length} งาน</span>
                        </div>
                        <div className="flex flex-col">
                          {items.map((q: any, idx: number) => {
                            const isUrgent = (Date.now() - q.time) > 172800000;
                            const relatedProject = projects.find(p => p.name === q.project_name); const relatedPlot = plots.find(p => p.id === q.plot_id); const relatedTask = taskTemplates.find(t => t.id === q.task_template_id);
                            const clickAction = () => { setSelectedProject(relatedProject); setSelectedPlot(relatedPlot); setSelectedTask(relatedTask); setTaskReturnView('dashboard'); setView('task-progress'); };
                            
                            return (
                              <button key={`${q.plot_id}-${q.task_template_id}`} onClick={clickAction} className={`p-4 sm:p-5 text-left flex flex-col sm:flex-row sm:items-center justify-between gap-4 group transition-all duration-300 ${idx !== items.length - 1 ? 'border-b border-black/5' : ''} hover:bg-black/[0.02] ${isUrgent ? 'border-l-4 border-l-rose-500 bg-rose-50/30' : 'border-l-4 border-l-transparent'}`}>
                                <div className="flex items-center gap-4 flex-1 overflow-hidden">
                                    <div className={`w-12 h-12 rounded-2xl flex flex-col items-center justify-center shrink-0 shadow-sm ${q.statusFor === 'QC' ? 'bg-purple-100 text-purple-600' : 'bg-blue-100 text-blue-600'}`}>
                                      <span className="text-[10px] font-bold uppercase tracking-wider">รอ {q.statusFor}</span>
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                                          <p className="text-sm sm:text-base font-semibold text-[#1d1d1f] truncate group-hover:text-blue-600 transition-colors">{q.task_name}</p>
                                          {isUrgent && <span className="bg-rose-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-md flex items-center gap-1 shadow-sm whitespace-nowrap shrink-0"><AlertTriangle size={12}/> ด่วนมาก</span>}
                                      </div>
                                      <p className="text-[11px] sm:text-xs text-[#86868b] font-medium flex items-center gap-1.5"><HardHat size={14}/> {q.foreman}</p>
                                    </div>
                                </div>
                                <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center gap-1 shrink-0 pt-2 sm:pt-0 sm:pl-4">
                                    <span className={`text-[11px] sm:text-xs font-medium ${isUrgent ? 'text-rose-500' : 'text-[#86868b]'}`}><Clock size={12} className="inline mr-1"/> {new Date(q.time).toLocaleDateString('th-TH', {month:'short', day:'numeric'})} {new Date(q.time).toLocaleTimeString('th-TH', {hour: '2-digit', minute:'2-digit'})}</span>
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
                  <button key={`${q.plot_id}-${q.task_template_id}`} onClick={clickAction} className={`bg-white/80 backdrop-blur-xl p-5 sm:p-6 rounded-[1.5rem] border ${isUrgent ? 'border-rose-400 bg-rose-50/50' : 'border-white'} shadow-[0_4px_20px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] hover:-translate-y-1 active:scale-[0.98] transition-all duration-300 text-left group relative overflow-hidden`}>
                      {isUrgent && <div className="absolute top-0 left-0 w-full h-1.5 bg-rose-500"></div>}
                      <div className="flex justify-between items-start mb-4">
                        <span className={`text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-lg text-white shadow-sm ${q.statusFor === 'QC' ? 'bg-purple-500' : 'bg-blue-500'}`}>รอ {q.statusFor}</span>
                        <span className={`text-[10px] font-medium flex items-center gap-1.5 px-2.5 py-1 rounded-lg ${isUrgent ? 'bg-rose-100 text-rose-600' : 'bg-black/5 text-[#86868b]'}`}><Clock size={12}/> {new Date(q.time).toLocaleDateString('th-TH',{day:'numeric', month:'short'})} {new Date(q.time).toLocaleTimeString('th-TH', {hour: '2-digit', minute:'2-digit'})}</span>
                      </div>
                      <div className="flex items-center gap-2 mb-2">
                        <h4 className="font-semibold text-[#1d1d1f] text-2xl">{q.plot_id}</h4>
                        {isUrgent && <AlertTriangle size={18} className="text-rose-500"/>}
                      </div>
                      <p className="text-xs sm:text-sm font-medium text-[#86868b] line-clamp-2 mb-4 min-h-[32px] sm:min-h-[40px] leading-relaxed">{q.task_name}</p>
                      <div className="flex items-center gap-2 pt-4 border-t border-black/5">
                        <div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
                          <HardHat size={12} className="text-slate-400"/>
                        </div>
                        <p className="text-[11px] sm:text-xs text-[#86868b] font-medium truncate">{q.foreman}</p>
                      </div>
                  </button>
                );
              });
            })()}
          </div>
        </div>
      )}
    </div>
  )}

  <div className="mb-8 sm:mb-12 mt-10">
    <h2 className="font-semibold text-xl tracking-tight sm:text-2xl text-[#1d1d1f] mb-4 sm:mb-8">Executive Summary</h2>
    <div className={`grid gap-4 sm:gap-6 ${isMobileLayout ? 'grid-cols-2' : 'grid-cols-4'}`}>
        <div className="bg-white/80 backdrop-blur-xl p-5 sm:p-6 rounded-[1.5rem] border border-white shadow-[0_4px_20px_rgb(0,0,0,0.03)] flex flex-col justify-center items-center sm:items-start text-center sm:text-left h-32 sm:h-auto hover:-translate-y-1 transition-transform duration-300">
          <div className="flex items-center gap-2 text-[#86868b] mb-2 sm:mb-4"><FolderOpen size={18} className="hidden sm:block"/><span className="text-[11px] sm:text-sm font-semibold tracking-wide">Total Projects</span></div>
          <div className="text-3xl sm:text-5xl font-semibold tracking-tight text-[#1d1d1f]">{projects.length}</div>
        </div>
        <div className="bg-white/80 backdrop-blur-xl p-5 sm:p-6 rounded-[1.5rem] border border-white shadow-[0_4px_20px_rgb(0,0,0,0.03)] flex flex-col justify-center items-center sm:items-start text-center sm:text-left h-32 sm:h-auto hover:-translate-y-1 transition-transform duration-300">
          <div className="flex items-center gap-2 text-blue-500 mb-2 sm:mb-4"><Activity size={18} className="hidden sm:block"/><span className="text-[11px] sm:text-sm font-semibold tracking-wide">Active Plots</span></div>
          <div className="text-3xl sm:text-5xl font-semibold tracking-tight text-blue-500">{activePlotsCount}</div>
        </div>
        <div className="bg-white/80 backdrop-blur-xl p-5 sm:p-6 rounded-[1.5rem] border border-white shadow-[0_4px_20px_rgb(0,0,0,0.03)] flex flex-col justify-center items-center sm:items-start text-center sm:text-left h-32 sm:h-auto hover:-translate-y-1 transition-transform duration-300">
          <div className="flex items-center gap-2 text-emerald-500 mb-2 sm:mb-4"><CheckCircle size={18} className="hidden sm:block"/><span className="text-[11px] sm:text-sm font-semibold tracking-wide">Completed</span></div>
          <div className="text-3xl sm:text-5xl font-semibold tracking-tight text-emerald-500">{completedPlotsCount}</div>
        </div>
        <div className={`p-5 sm:p-6 rounded-[1.5rem] shadow-[0_4px_20px_rgb(0,0,0,0.03)] flex flex-col justify-center items-center sm:items-start text-center sm:text-left h-32 sm:h-auto hover:-translate-y-1 transition-transform duration-300 ${delayedPlotsCount > 0 ? 'bg-rose-50/80 backdrop-blur-xl border border-rose-100' : 'bg-white/80 backdrop-blur-xl border border-white'}`}>
          <div className={`flex items-center gap-2 mb-2 sm:mb-4 ${delayedPlotsCount > 0 ? 'text-rose-500' : 'text-[#86868b]'}`}><AlertCircle size={18} className="hidden sm:block"/><span className="text-[11px] sm:text-sm font-semibold tracking-wide">Delayed</span></div>
          <div className={`text-3xl sm:text-5xl font-semibold tracking-tight ${delayedPlotsCount > 0 ? 'text-rose-500' : 'text-slate-300'}`}>{delayedPlotsCount}</div>
        </div>
    </div>
  </div>
</div>
  );
}

export default React.memo(DashboardOverview);
