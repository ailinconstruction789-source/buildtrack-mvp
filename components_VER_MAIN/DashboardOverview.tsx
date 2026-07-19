import React from 'react';
import { Wrench, Users, PlusCircle, Building, ClipboardList, Monitor, Settings, Map as MapIcon, AlertTriangle, Grid, Clock, SortAsc, CheckCircle, HardHat, FolderOpen, Activity, AlertCircle } from 'lucide-react';
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
}

export default function DashboardOverview({
  view, setView,
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
        <h2 className="font-black text-xl sm:text-3xl text-slate-800 italic uppercase tracking-tighter">Projects Overview</h2>
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
        {projects.map((proj) => (
          <div key={proj.name} onClick={() => { 
              const conf = proj.layout_data?.find((c: any) => c.type === 'config');
              setGridCols(conf?.cols || 40); setGridRows(conf?.rows || 24); setMapZoom(1);
              setSelectedProject(proj); setMapGrid(proj.layout_data?.filter((c: any) => c.type !== 'config') || []); setIsEditMapMode(false); setView('project-detail'); 
          }} className="bg-white w-full p-5 sm:p-8 rounded-2xl sm:rounded-[2rem] border border-slate-200 text-left hover:border-blue-500 hover:shadow-2xl hover:-translate-y-1 transition-all group relative overflow-hidden cursor-pointer">
            
            {/* 🌟 ปุ่มแก้ไขชื่อโครงการ (แสดงเฉพาะ Admin) */}
            {isAdmin && (
              <button onClick={(e) => { e.stopPropagation(); handleEditProject(proj); }} className="absolute top-4 right-4 p-2 bg-slate-100 text-slate-500 rounded-xl opacity-0 group-hover:opacity-100 hover:bg-blue-600 hover:text-white transition-all z-20 shadow-sm" title="แก้ไขชื่อโครงการ">
                <Settings size={20} />
              </button>
            )}

            <Building size={isMobileLayout ? 60 : 100} className="absolute -right-4 -bottom-4 sm:-right-6 sm:-bottom-6 text-slate-50 group-hover:text-blue-50 transition-colors rotate-12" />
            <h3 className="text-xl sm:text-3xl font-black text-slate-800 mb-1 sm:mb-2 relative z-10 w-full truncate text-left">{proj.name}</h3>
            <p className="text-[10px] sm:text-sm text-slate-400 font-bold uppercase tracking-wider mb-4 sm:mb-8 relative z-10 flex items-center gap-1.5">
              <MapIcon size={12} className="sm:w-4 sm:h-4"/> {isForeman ? `งานของคุณ ${plots.filter(p => p.project_name === proj.name && p.foreman === loggedInUser.username).length} แปลง` : `รวมทั้งหมด ${proj.plotCount || plots.filter(p => p.project_name === proj.name).length} แปลง`}
            </p>
            <div className="h-2 sm:h-3 bg-slate-100 rounded-full overflow-hidden relative z-10 mt-4 sm:mt-6"><div className="h-full bg-blue-600 transition-all duration-1000" style={{width: `${proj.progress || 0}%`}}></div></div>
          </div>
        ))}
      </div>
        {/* 🌟 ส่วนหัว: โซนแท็บเมนูและปุ่มเปลี่ยนมุมมอง */}
          <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3 mb-4 sm:mb-6 mt-8">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6">
                <h2 className="font-black text-lg sm:text-2xl text-slate-800 italic uppercase tracking-tighter flex items-center gap-2"><ClipboardList className={isQC ? 'text-purple-600' : 'text-blue-600'} size={20}/> Inspection Queue <span className="bg-slate-800 text-white text-[10px] px-2 py-0.5 rounded-full">{inspectionQueue.length}</span></h2>
                
                {/* 🌟 1. TABS คัดงานด่วน */}
                <div className="flex bg-slate-200/60 p-1 rounded-xl w-fit border border-slate-200/80">
                  <button onClick={() => setInspectionFilterTab('all')} className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all ${inspectionFilterTab === 'all' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}>ทั้งหมด</button>
                  <button onClick={() => setInspectionFilterTab('urgent')} className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 ${inspectionFilterTab === 'urgent' ? 'bg-rose-500 shadow-sm text-white' : 'text-slate-500 hover:text-rose-600'}`}><AlertTriangle size={14}/> ด่วน <span className={`${inspectionFilterTab === 'urgent' ? 'bg-white/20 text-white' : 'bg-rose-100 text-rose-600'} px-1.5 py-0.5 rounded-md text-[10px] leading-none`}>{inspectionQueue.filter(q => (Date.now() - q.time) > 172800000).length}</span></button>
                </div>
            </div>
            
            <div className="flex items-center gap-2 w-full xl:w-auto">
                {/* 🌟 2. View Mode Toggle (ปุ่มเปลี่ยนสลับ Card / List) */}
                <div className="flex bg-slate-200/60 p-1 rounded-xl shrink-0 border border-slate-200/80">
                  <button onClick={() => setInspectionViewMode('card')} className={`p-1.5 sm:p-2 rounded-lg transition-all ${inspectionViewMode === 'card' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-400 hover:text-blue-500'}`} title="มุมมองการ์ด"><Grid size={16}/></button>
                  <button onClick={() => setInspectionViewMode('list')} className={`p-1.5 sm:p-2 rounded-lg transition-all ${inspectionViewMode === 'list' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-400 hover:text-blue-500'}`} title="มุมมองตาราง"><ClipboardList size={16}/></button>
                </div>
                
                {/* เรียงลำดับ (ของเดิม) */}
                <div className="flex bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden text-[10px] sm:text-xs font-bold flex-1 xl:flex-none"><button onClick={() => setInspectionSort('time')} className={`flex-1 xl:flex-none px-3 sm:px-4 py-2 flex justify-center items-center gap-1.5 ${inspectionSort === 'time' ? 'bg-slate-100 text-slate-800' : 'text-slate-400'}`}><Clock size={14}/> ล่าสุด</button><button onClick={() => setInspectionSort('plot')} className={`flex-1 xl:flex-none px-3 sm:px-4 py-2 flex justify-center items-center gap-1.5 border-l border-slate-200 ${inspectionSort === 'plot' ? 'bg-slate-100 text-slate-800' : 'text-slate-400'}`}><SortAsc size={14}/> รหัสแปลง</button></div>
            </div>
          </div>

          {/* 🌟 พื้นที่แสดงผลคิวงาน */}
          {inspectionQueue.filter(q => inspectionFilterTab === 'all' || (inspectionFilterTab === 'urgent' && (Date.now() - q.time) > 172800000)).length === 0 ? ( 
            <div className="bg-white rounded-2xl sm:rounded-[2rem] border border-dashed border-slate-300 p-8 sm:p-16 text-center flex flex-col items-center justify-center gap-3 sm:gap-4">
                <div className="w-16 h-16 sm:w-20 sm:h-20 bg-slate-50 rounded-full flex items-center justify-center"><CheckCircle size={32} className="text-emerald-400 opacity-50"/></div>
                <p className="text-slate-400 font-bold italic text-sm sm:text-xl">ไม่มีงานรอตรวจสอบในหมวดหมู่นี้</p>
            </div> 
          ) : (
            <div className="max-h-[50vh] sm:max-h-[600px] overflow-y-auto custom-scrollbar pr-1 sm:pr-3 pb-2">
              <div className={`${inspectionViewMode === 'card' ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4' : 'flex flex-col gap-2'}`}>
                {inspectionQueue.filter(q => inspectionFilterTab === 'all' || (inspectionFilterTab === 'urgent' && (Date.now() - q.time) > 172800000)).map(q => {
                  const isUrgent = (Date.now() - q.time) > 172800000;
                  const relatedProject = projects.find(p => p.name === q.project_name); const relatedPlot = plots.find(p => p.id === q.plot_id); const relatedTask = taskTemplates.find(t => t.id === q.task_template_id);
                  
                  const clickAction = () => { setSelectedProject(relatedProject); setSelectedPlot(relatedPlot); setSelectedTask(relatedTask); setTaskReturnView('dashboard'); setView('task-progress'); };

                  {/* 🌟 Layout แบบ List View (ตารางแนวนอน) */}
                  if (inspectionViewMode === 'list') {
                      return (
                        <button key={`${q.plot_id}-${q.task_template_id}`} onClick={clickAction} className={`bg-white p-3 sm:p-4 rounded-xl sm:rounded-2xl border ${isUrgent ? 'border-rose-400 bg-rose-50/50' : 'border-slate-200'} shadow-sm hover:border-blue-500 hover:shadow-md transition-all text-left flex flex-col sm:flex-row sm:items-center justify-between gap-3 group`}>
                          <div className="flex items-center gap-3 sm:gap-4 flex-1 overflow-hidden">
                              <div className={`w-12 h-12 sm:w-14 sm:h-14 rounded-xl flex flex-col items-center justify-center shrink-0 shadow-inner ${q.statusFor === 'QC' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                                <span className="text-[10px] sm:text-xs font-black uppercase">รอ {q.statusFor}</span>
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                    <h4 className="font-black text-slate-800 text-lg sm:text-xl truncate">{q.plot_id}</h4>
                                    {isUrgent && <span className="bg-rose-500 text-white text-[9px] sm:text-[10px] font-black px-1.5 py-0.5 rounded flex items-center gap-1 animate-pulse shadow-sm"><AlertTriangle size={10}/> ค้างตรวจนาน</span>}
                                </div>
                                <p className="text-xs sm:text-sm font-bold text-slate-600 truncate">{q.task_name}</p>
                              </div>
                          </div>
                          <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center gap-2 shrink-0 border-t sm:border-t-0 sm:border-l border-slate-100 pt-2 sm:pt-0 sm:pl-4">
                              <p className="text-[10px] sm:text-xs text-slate-400 font-bold flex items-center gap-1"><HardHat size={12}/> {q.foreman}</p>
                              <span className={`text-[10px] sm:text-xs font-black ${isUrgent ? 'text-rose-600' : 'text-slate-400'}`}><Clock size={12} className="inline mr-1"/> {new Date(q.time).toLocaleDateString('th-TH', {month:'short', day:'numeric'})} {new Date(q.time).toLocaleTimeString('th-TH', {hour: '2-digit', minute:'2-digit'})}</span>
                          </div>
                        </button>
                      )
                  }

                  {/* 🌟 Layout แบบ Card View (การ์ดสี่เหลี่ยมของเดิม แต่อัปเกรด) */}
                  return (
                    <button key={`${q.plot_id}-${q.task_template_id}`} onClick={clickAction} className={`bg-white p-4 sm:p-5 rounded-2xl sm:rounded-[1.5rem] border ${isUrgent ? 'border-rose-400 bg-rose-50/50' : 'border-slate-200'} shadow-sm hover:border-blue-500 hover:shadow-lg hover:-translate-y-1 transition-all text-left group relative overflow-hidden`}>
                        {isUrgent && <div className="absolute top-0 left-0 w-full h-1.5 bg-rose-500"></div>}
                        <div className="flex justify-between items-start mb-3 mt-1 sm:mt-0">
                          <span className={`text-[9px] sm:text-xs font-black uppercase tracking-widest px-2.5 py-1 rounded-md text-white shadow-sm ${q.statusFor === 'QC' ? 'bg-purple-600' : 'bg-blue-600'}`}>รอ {q.statusFor}</span>
                          <span className={`text-[9px] sm:text-[10px] font-black flex items-center gap-1 px-2 py-1 rounded-md ${isUrgent ? 'bg-rose-100 text-rose-600 animate-pulse' : 'bg-slate-100 text-slate-500'}`}><Clock size={10}/> {new Date(q.time).toLocaleDateString('th-TH',{day:'numeric', month:'short'})} {new Date(q.time).toLocaleTimeString('th-TH', {hour: '2-digit', minute:'2-digit'})}</span>
                        </div>
                        <div className="flex items-center gap-2 mb-1.5">
                          <h4 className="font-black text-slate-800 text-2xl">{q.plot_id}</h4>
                          {isUrgent && <AlertTriangle size={16} className="text-rose-500 animate-pulse"/>}
                        </div>
                        <p className="text-xs sm:text-sm font-bold text-slate-600 line-clamp-2 my-1.5 min-h-[32px] sm:min-h-[40px]">{q.task_name}</p>
                        <p className="text-[10px] sm:text-xs text-slate-400 flex items-center gap-1.5 mt-3 pt-3 border-t border-slate-200/60"><HardHat size={14} className="text-slate-300"/> {q.foreman}</p>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}


        <div className="mb-6 sm:mb-12">
        <h2 className="font-black text-xl sm:text-3xl text-slate-800 italic uppercase tracking-tighter mb-4 sm:mb-6">Executive Summary</h2>
        <div className={`grid gap-3 sm:gap-6 ${isMobileLayout ? 'grid-cols-2' : 'grid-cols-4'}`}>
            <div className="bg-white p-4 sm:p-6 rounded-2xl sm:rounded-[2rem] border border-slate-200 shadow-sm flex flex-col justify-center items-center sm:items-start text-center sm:text-left h-28 sm:h-auto">
              <div className="flex items-center gap-1.5 sm:gap-3 text-slate-500 mb-1 sm:mb-4"><FolderOpen size={16} className="sm:w-5 sm:h-5 hidden sm:block"/><span className="text-[10px] sm:text-sm font-black uppercase tracking-wide truncate">Total Projects</span></div>
              <div className="text-2xl sm:text-5xl font-black text-slate-800">{projects.length}</div>
            </div>
            <div className="bg-white p-4 sm:p-6 rounded-2xl sm:rounded-[2rem] border border-slate-200 shadow-sm flex flex-col justify-center items-center sm:items-start text-center sm:text-left h-28 sm:h-auto">
              <div className="flex items-center gap-1.5 sm:gap-3 text-blue-500 mb-1 sm:mb-4"><Activity size={16} className="sm:w-5 sm:h-5 hidden sm:block"/><span className="text-[10px] sm:text-sm font-black uppercase tracking-wide truncate">Active Plots</span></div>
              <div className="text-2xl sm:text-5xl font-black text-blue-600">{activePlotsCount}</div>
            </div>
            <div className="bg-white p-4 sm:p-6 rounded-2xl sm:rounded-[2rem] border border-slate-200 shadow-sm flex flex-col justify-center items-center sm:items-start text-center sm:text-left h-28 sm:h-auto">
              <div className="flex items-center gap-1.5 sm:gap-3 text-emerald-500 mb-1 sm:mb-4"><CheckCircle size={16} className="sm:w-5 sm:h-5 hidden sm:block"/><span className="text-[10px] sm:text-sm font-black uppercase tracking-wide truncate">Completed</span></div>
              <div className="text-2xl sm:text-5xl font-black text-emerald-600">{completedPlotsCount}</div>
            </div>
            <div className={`p-4 sm:p-6 rounded-2xl sm:rounded-[2rem] border shadow-sm flex flex-col justify-center items-center sm:items-start text-center sm:text-left h-28 sm:h-auto ${delayedPlotsCount > 0 ? 'bg-rose-50 border-rose-200' : 'bg-white border-slate-200'}`}>
              <div className={`flex items-center gap-1.5 sm:gap-3 mb-1 sm:mb-4 ${delayedPlotsCount > 0 ? 'text-rose-500' : 'text-slate-400'}`}><AlertCircle size={16} className="sm:w-5 sm:h-5 hidden sm:block"/><span className="text-[10px] sm:text-sm font-black uppercase tracking-wide truncate">Delayed</span></div>
              <div className={`text-2xl sm:text-5xl font-black ${delayedPlotsCount > 0 ? 'text-rose-600' : 'text-slate-300'}`}>{delayedPlotsCount}</div>
            </div>
        </div>
      </div>
    </div>
  );
}
