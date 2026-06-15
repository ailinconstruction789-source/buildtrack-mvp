
import React from 'react';
import { 
  Map as MapIcon, Monitor, Search, ZoomOut, ZoomIn, Loader2, Paintbrush, 
  Eraser, Pickaxe, HardHat, Activity, Trash2, Settings, PlusCircle, Grid, Filter
} from 'lucide-react';

interface MapVisualizerProps {
  view: string;
  setView: (v: string) => void;
  selectedProject: any;
  isAdmin: boolean;
  currentUserRole: string;
  isMobileLayout: boolean;
  isEditMapMode: boolean;
  setIsEditMapMode: (b: boolean) => void;
  gridCols: number;
  setGridCols: (n: number) => void;
  gridRows: number;
  setGridRows: (n: number) => void;
  mapZoom: number;
  handleZoomIn: () => void;
  handleZoomOut: () => void;
  handleZoomReset: () => void;
  mapTool: string;
  setMapTool: (t: string) => void;
  mapSelectedPlot: string;
  setMapSelectedPlot: (p: string) => void;
  plots: any[];
  isSubmitting: boolean;
  handleSaveMap: () => void;
  mapGrid: any[];
  getAdjacency: (x: number, y: number, type: string, plotId: string | null) => any;
  handleMouseDown: (x: number, y: number) => void;
  handleMouseEnter: (x: number, y: number) => void;
  handleMouseUp: () => void;
  setSelectedPlot: (p: any) => void;
  plotBounds: any;
  getPlotOverallStatus: (id: string) => any;
  allUpdatesRecord: any[];
  taskTemplates: any[];
  assignments: any[];
  searchContractor: string;
  setSearchContractor: (s: string) => void;
  plotsActiveToday: Set<string>;
  searchPlot: string;
  setSearchPlot: (s: string) => void;
  filterForeman: string;
  setFilterForeman: (s: string) => void;
  foremenList: any[];
  displayPlots: any[];
  handleDeletePlot: (id: string) => void;
  handleEditPlot: (p: any) => void;
  setIsPresentationOpen: (b: boolean) => void;
  setCurrentSlideIndex: (i: number) => void;
  handleTogglePlotCustomer?: (id: string, current: boolean) => void;
  handleTogglePlotCompleted?: (id: string, current: boolean) => void;
}

export default function MapVisualizer(props: MapVisualizerProps) {
  const {
    view, setView, selectedProject, isAdmin, currentUserRole, isMobileLayout,
    isEditMapMode, setIsEditMapMode, gridCols, setGridCols, gridRows, setGridRows,
    mapZoom, handleZoomIn, handleZoomOut, handleZoomReset, mapTool, setMapTool,
    mapSelectedPlot, setMapSelectedPlot, plots, isSubmitting, handleSaveMap,
    mapGrid, getAdjacency, handleMouseDown, handleMouseEnter, handleMouseUp,
    setSelectedPlot, plotBounds, getPlotOverallStatus, allUpdatesRecord,
    taskTemplates, assignments, searchContractor, setSearchContractor,
    plotsActiveToday, searchPlot, setSearchPlot, filterForeman, setFilterForeman,
    foremenList, displayPlots, handleDeletePlot, handleEditPlot,
    setIsPresentationOpen, setCurrentSlideIndex,
    handleTogglePlotCustomer,
    handleTogglePlotCompleted
  } = props;

  return (
    <>
{/* 🗺️ View: Project Detail & Map Builder */}
               {view === 'project-detail' && selectedProject && (
                 <div className="animate-in slide-in-from-right duration-300">
                   <div className="flex justify-between items-end mb-4 sm:mb-6">
                      {/* 🗺️ Header Row */}
                      {isAdmin && (
                        <div className="flex flex-wrap justify-end gap-1.5 sm:gap-3">
                          <button onClick={() => setView('admin-plot')} className="flex items-center gap-1 sm:gap-2 px-2.5 sm:px-5 py-1.5 sm:py-3 rounded-lg sm:rounded-full font-bold text-[10px] sm:text-sm bg-white text-blue-600 border border-blue-200 hover:bg-blue-50 transition-colors shadow-sm sm:shadow-md"><PlusCircle size={14} className="sm:w-4 sm:h-4"/> เพิ่มแปลง</button>
                          <button onClick={() => setIsEditMapMode(!isEditMapMode)} className={`flex items-center gap-1 sm:gap-2 px-2.5 sm:px-5 py-1.5 sm:py-3 rounded-lg sm:rounded-full font-bold text-[10px] sm:text-sm transition-colors shadow-sm sm:shadow-md ${isEditMapMode ? 'bg-orange-500 text-white' : 'bg-slate-800 text-white hover:bg-slate-700'}`}>
                            <Grid size={14} className="sm:w-4 sm:h-4"/> {isEditMapMode ? 'ปิดจัดผัง' : 'จัดผัง'}
                          </button>
                        </div>
                      )}
                   </div>

                   <div className="mb-6 sm:mb-8 p-4 sm:p-8 bg-white rounded-2xl sm:rounded-[2.5rem] shadow-xl border border-black/5 overflow-hidden relative">
                     <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 sm:mb-6 gap-3 sm:gap-4">
                        <div>
                          <h2 className="text-xl sm:text-4xl font-bold text-[#1d1d1f] italic uppercase tracking-tighter">{selectedProject.name} MAP</h2>
                          <p className="text-[#86868b] text-[10px] sm:text-sm font-bold uppercase tracking-widest flex items-center gap-1.5 sm:gap-2 mt-0.5 sm:mt-1"><MapIcon size={12} className="sm:w-4 sm:h-4"/> จำลองผังโครงการ ({gridCols}x{gridRows} Grid)</p>
                        </div>
                        
                        <div className="flex items-center gap-2 sm:gap-3 w-full sm:w-auto">
                          {/* 🌟 ปุ่มเปิด Presentation Mode */}
                          {['Project Planner', 'Admin', 'Owner'].includes(currentUserRole) && (
                              <button onClick={() => { setIsPresentationOpen(true); setCurrentSlideIndex(0); }} className="bg-indigo-600 hover:bg-indigo-700 text-white px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl font-bold text-xs sm:text-sm shadow-md transition-all flex items-center gap-1.5 shrink-0">
                                <Monitor size={16} /> <span className="hidden sm:inline">Presentation Mode</span><span className="inline sm:hidden">โหมดนำเสนอ</span>
                              </button>
                          )}
                          
                          {/* 🌟 UX: ช่องค้นหาช่างเข้างานวันนี้ (Contractor Radar) 🌟 */}
                          <div className="relative hidden lg:block mr-2 w-64">
                             <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                             <input type="text" placeholder="ค้นหาช่าง..." value={searchContractor} onChange={(e) => setSearchContractor(e.target.value)} className="w-full bg-[#f5f5f7] border border-black/5 rounded-lg pl-8 pr-3 py-2 text-xs font-bold outline-none focus:border-blue-500 text-[#1d1d1f] shadow-sm" />
                          </div>

                          <div className="flex bg-[#f5f5f7] rounded-lg border border-black/5 shadow-sm p-1">
                             <button onClick={handleZoomOut} className="p-1.5 sm:p-2.5 text-[#86868b] hover:text-blue-600 hover:bg-white rounded-md sm:rounded-lg transition-colors"><ZoomOut size={16} className="sm:w-5 sm:h-5"/></button>
                             <button onClick={handleZoomReset} className="px-2 sm:px-4 text-[10px] sm:text-sm font-bold text-[#86868b] hover:text-blue-600 hover:bg-white rounded-md sm:rounded-lg transition-colors">{Math.round(mapZoom * 100)}%</button>
                             <button onClick={handleZoomIn} className="p-1.5 sm:p-2.5 text-[#86868b] hover:text-blue-600 hover:bg-white rounded-md sm:rounded-lg transition-colors"><ZoomIn size={16} className="sm:w-5 sm:h-5"/></button>
                          </div>
                          {isEditMapMode && (
                            <button onClick={handleSaveMap} disabled={isSubmitting} className="bg-blue-600 text-white px-4 sm:px-8 py-2 sm:py-3.5 rounded-lg sm:rounded-xl font-bold shadow-lg hover:bg-blue-700 flex items-center justify-center gap-1.5 sm:gap-2 flex-1 sm:flex-none text-xs sm:text-base">
                              {isSubmitting ? <Loader2 className="animate-spin" size={16}/> : 'บันทึก'}
                            </button>
                          )}
                        </div>
                     </div>

                     {/* Mobile Search Bar */}
                     <div className="lg:hidden w-full mb-4 sm:mb-6 relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                        <input type="text" placeholder="ค้นหาชื่อช่างในผัง..." value={searchContractor} onChange={(e) => setSearchContractor(e.target.value)} className="w-full bg-[#f5f5f7] border border-black/5 rounded-lg pl-8 pr-3 py-2 text-xs font-bold outline-none focus:border-blue-500 text-[#1d1d1f] shadow-sm" />
                     </div>

                     {isEditMapMode && (
                       <div className="flex flex-col xl:flex-row gap-3 sm:gap-4 mb-4 sm:mb-6 p-3 sm:p-5 bg-[#f5f5f7] rounded-xl sm:rounded-2xl border border-black/5 shadow-inner">
                         <div className="flex flex-wrap gap-1.5 sm:gap-3">
                            <button onClick={() => setMapTool('plot')} className={`px-2 sm:px-4 py-1.5 sm:py-3 rounded-lg sm:rounded-xl font-bold text-[10px] sm:text-sm border-2 flex items-center gap-1.5 sm:gap-2 ${mapTool === 'plot' ? 'bg-emerald-500 text-white border-emerald-500 shadow-sm' : 'bg-white text-emerald-600 border-emerald-200'}`}><Paintbrush size={12} className="sm:w-4 sm:h-4"/> ระบายบ้าน</button>
                            {mapTool === 'plot' && (
                              <select value={mapSelectedPlot} onChange={e => setMapSelectedPlot(e.target.value)} className="bg-white border border-black/10 rounded-lg sm:rounded-xl px-2 sm:px-3 py-1.5 sm:py-3 text-[10px] sm:text-sm font-bold outline-none text-emerald-800 shadow-sm"><option value="">-- รหัสแปลง --</option>{plots.filter((p: any) => p.project_name === selectedProject.name).map((p: any) => <option key={p.id} value={p.id}>{p.id}</option>)}</select>
                            )}
                            <div className="w-px h-8 sm:h-12 bg-slate-300 mx-1 sm:mx-2 self-center hidden sm:block"></div>
                            <button onClick={() => setMapTool('road')} className={`px-2 sm:px-4 py-1.5 sm:py-3 rounded-lg sm:rounded-xl font-bold text-[10px] sm:text-sm border-2 flex items-center gap-1.5 sm:gap-2 ${mapTool === 'road' ? 'bg-slate-700 text-white border-slate-700 shadow-sm' : 'bg-white text-[#86868b] border-black/5'}`}>สร้างถนน</button>
                            <button onClick={() => setMapTool('fence')} className={`px-2 sm:px-4 py-1.5 sm:py-3 rounded-lg sm:rounded-xl font-bold text-[10px] sm:text-sm border-2 flex items-center gap-1.5 sm:gap-2 ${mapTool === 'fence' ? 'bg-orange-500 text-white border-orange-500 shadow-sm' : 'bg-white text-[#86868b] border-black/5'}`}>สร้างเส้นรั้ว</button>
                            <div className="w-px h-8 sm:h-12 bg-slate-300 mx-1 sm:mx-2 self-center hidden sm:block"></div>
                            <button onClick={() => setMapTool('eraser')} className={`px-2 sm:px-4 py-1.5 sm:py-3 rounded-lg sm:rounded-xl font-bold text-[10px] sm:text-sm border-2 flex items-center gap-1.5 sm:gap-2 ml-auto ${mapTool === 'eraser' ? 'bg-rose-500 text-white border-rose-500 shadow-sm' : 'bg-white text-[#86868b] border-black/5'}`}><Eraser size={12} className="sm:w-4 sm:h-4"/> ลบ</button>
                         </div>
                         <div className="flex items-center gap-2 sm:gap-3 bg-white px-3 sm:px-4 py-1.5 sm:py-2.5 rounded-lg sm:rounded-xl shadow-sm border border-black/5 xl:ml-auto w-fit">
                            <span className="text-[9px] sm:text-xs font-bold text-[#86868b] uppercase">ขนาด Grid</span>
                            <input type="number" value={gridCols} onChange={e=>setGridCols(Number(e.target.value))} className="w-10 sm:w-16 text-center text-[10px] sm:text-sm font-bold border border-black/5 rounded outline-none focus:border-blue-500 bg-[#f5f5f7] p-1 sm:p-1.5"/>
                            <span className="text-[10px] sm:text-sm text-slate-400">x</span>
                            <input type="number" value={gridRows} onChange={e=>setGridRows(Number(e.target.value))} className="w-10 sm:w-16 text-center text-[10px] sm:text-sm font-bold border border-black/5 rounded outline-none focus:border-blue-500 bg-[#f5f5f7] p-1 sm:p-1.5"/>
                         </div>
                       </div>
                     )}

                     {/* 🌟 UX Blueprint Map 🌟 */}
                     <div className="w-full overflow-auto pb-4 custom-scrollbar bg-slate-300 rounded-xl sm:rounded-3xl border-2 sm:border-4 border-slate-400 shadow-inner" style={{ height: isMobileLayout ? '350px' : '600px' }}>
                       <div 
                          className={`relative bg-slate-300 select-none origin-top-left transition-transform duration-200 ${isEditMapMode ? 'cursor-crosshair' : 'cursor-grab'}`} 
                          style={{ 
                             width: `${gridCols * 40}px`, 
                             height: `${gridRows * 40}px`, 
                             minWidth: '100%', 
                             transform: `scale(${mapZoom})`,
                             backgroundImage: `radial-gradient(#94a3b8 1.5px, transparent 1.5px)`,
                             backgroundSize: `40px 40px` // Dot grid pattern
                          }} 
                          onMouseLeave={handleMouseUp} onMouseUp={handleMouseUp}
                       >
                         <div 
                           className="absolute inset-0 grid" 
                           style={{ gridTemplateColumns: `repeat(${gridCols}, 1fr)`, gridTemplateRows: `repeat(${gridRows}, 1fr)` }}
                           onMouseDown={(e) => {
                             const t = (e.target as HTMLElement).closest('[data-x]');
                             if (t) handleMouseDown(parseInt(t.getAttribute('data-x') || '0'), parseInt(t.getAttribute('data-y') || '0'));
                           }}
                           onMouseOver={(e) => {
                             const t = (e.target as HTMLElement).closest('[data-x]');
                             if (t) handleMouseEnter(parseInt(t.getAttribute('data-x') || '0'), parseInt(t.getAttribute('data-y') || '0'));
                           }}
                           onClick={(e) => {
                             if (isEditMapMode) return;
                             const t = (e.target as HTMLElement).closest('[data-plot-id]');
                             const plotId = t?.getAttribute('data-plot-id');
                             if (plotId) {
                               const plotInfo = plots.find(p => p.id === plotId);
                               if (plotInfo) { setSelectedPlot(plotInfo); setView('house-detail'); }
                             }
                           }}
                         >
                           {Array.from({length: gridCols * gridRows}).map((_, i) => {
                             const x = i % gridCols, y = Math.floor(i / gridCols);
                             const cellData = mapGrid.find(c => c.x === x && c.y === y && (c.type === 'plot' || c.type === 'road'));
                             
                             let baseStyles = 'border-r border-b border-transparent '; // Remove solid grid lines
                             if (isEditMapMode && !cellData) baseStyles += 'hover:bg-slate-400/30 ';

                             if (cellData?.type === 'plot') {
                               const adj = getAdjacency(x, y, 'plot', cellData.plotId);
                               baseStyles = 'bg-emerald-100/50 border-emerald-300 ';
                               // Remove inner borders for contiguous plots
                               if (adj.hasTop) baseStyles += '!border-t-0 '; if (adj.hasBottom) baseStyles += '!border-b-0 '; if (adj.hasLeft) baseStyles += '!border-l-0 '; if (adj.hasRight) baseStyles += '!border-r-0 ';
                             } else if (cellData?.type === 'road') { 
                               baseStyles = 'bg-slate-500 flex items-center justify-center border-slate-600 '; 
                             }

                             return (
                               <div key={i} data-x={x} data-y={y} data-plot-id={cellData?.type === 'plot' ? cellData.plotId : undefined} className={`relative transition-colors duration-75 border ${baseStyles}`}>
                                 {cellData?.type === 'road' && (() => {
                                    const adj = getAdjacency(x, y, 'road', null);
                                    return (<>{adj.hasLeft && adj.hasRight && !adj.hasTop && !adj.hasBottom && <div className="w-full h-0 border-t-2 border-dashed border-yellow-500/40 pointer-events-none" />}{adj.hasTop && adj.hasBottom && !adj.hasLeft && !adj.hasRight && <div className="h-full w-0 border-l-2 border-dashed border-yellow-500/40 pointer-events-none" />}{adj.hasTop && adj.hasBottom && adj.hasLeft && adj.hasRight && <div className="w-2 h-2 bg-yellow-500/40 rounded-full pointer-events-none" />}</>);
                                 })()}
                               </div>
                             );
                           })}
                         </div>
                         {mapGrid.filter((c: any) => c.type === 'fence-h').map((c: any) => (<div key={c.id} className="absolute border-t-4 border-dashed border-orange-500 z-20 pointer-events-none" style={{ left: `${(c.x / gridCols) * 100}%`, top: `${(c.y / gridRows) * 100}%`, width: `${(1 / gridCols) * 100}%`, height: '6px', transform: 'translateY(-50%)' }} />))}
                         {mapGrid.filter((c: any) => c.type === 'fence-v').map((c: any) => (<div key={c.id} className="absolute border-l-4 border-dashed border-orange-500 z-20 pointer-events-none" style={{ left: `${(c.x / gridCols) * 100}%`, top: `${(c.y / gridRows) * 100}%`, width: '6px', height: `${(1 / gridRows) * 100}%`, transform: 'translateX(-50%)' }} />))}
                         
                         {/* 🌟 UX Blueprint: Smart Hover Tooltips & Contractor Filter 🌟 */}
                         {Object.entries(plotBounds).map(([plotId, bounds]:any) => {
                           const plotInfo = plots.find((p: any) => p.id === plotId); if (!plotInfo) return null;
                           const w = bounds.maxX - bounds.minX + 1, h = bounds.maxY - bounds.minY + 1;
                           const statusInfo = getPlotOverallStatus(plotInfo.id);

                           // 🌟 หางานล่าสุดที่มีการอัปเดตของแปลงนี้
                           const plotUpdates = allUpdatesRecord?.filter((u: any) => u.plot_id === plotInfo.id) || [];
                           const latestUpdate = plotUpdates.length > 0 ? plotUpdates[plotUpdates.length - 1] : null;
                           const latestTask = latestUpdate ? taskTemplates.find((t: any) => t.id === latestUpdate.task_template_id) : null;
                           const latestTaskStr = latestTask ? `${latestTask.task_name} (${latestUpdate.progress}%)` : 'ยังไม่มีงานอัปเดต';

                           // 🌿 ตรวจสอบสถานะงาน "งานปูหญ้า" ว่าเสร็จ 100% หรือไม่
                           const grassTaskTemplates = taskTemplates?.filter((t: any) => t.task_name.includes('งานปูหญ้า')) || [];
                           let isGrassPlanted = false;
                           if (grassTaskTemplates.length > 0) {
                              const grassTemplateIds = grassTaskTemplates.map((t: any) => String(t.id));
                              const grassUpdates = plotUpdates.filter((u: any) => grassTemplateIds.includes(String(u.task_template_id)));
                              if (grassUpdates.length > 0) {
                                 const latestGrassUpdate = grassUpdates.sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
                                 if (Number(latestGrassUpdate.progress) === 100) isGrassPlanted = true;
                              } else {
                                 const grassAssignment = assignments?.find((a: any) => String(a.plot_id) === String(plotInfo.id) && grassTemplateIds.includes(String(a.task_template_id)));
                                 if (grassAssignment && Number(grassAssignment.current_progress) === 100) isGrassPlanted = true;
                              }
                           }

                           // ดักจับว่าแปลงนี้ใช้ช่างที่เรากำลังค้นหาอยู่หรือไม่

                           // ดักจับว่าแปลงนี้ใช้ช่างที่เรากำลังค้นหาอยู่หรือไม่
                           const currentPlotAssignment = assignments.slice().reverse().find((a: any) => a.plot_id === plotId);
                           const hasSearchedContractor = searchContractor.trim() !== '';
                           const isMatchContractor = currentPlotAssignment?.contractor_name.toLowerCase().includes(searchContractor.toLowerCase());

                           const isActiveToday = plotsActiveToday.has(plotId);

                           // ปรับสไตล์เอฟเฟกต์ไฮไลท์ช่าง
                           let searchHighlightClass = "opacity-100 scale-100";
                           let cardBorderClass = statusInfo.colors; 

                           if (hasSearchedContractor) {
                              if (isMatchContractor) {
                                 // ถ้าใช่ช่างที่ค้นหา: ล็อกขอบสีทองหนาพิเศษ + ใส่เงาไฟนีออนกระพริบวิบวับ
                                 searchHighlightClass = "opacity-100 scale-105 z-50 animate-pulse";
                                 cardBorderClass = "bg-amber-50 border-amber-500 text-amber-900 shadow-[0_0_25px_rgba(245,158,11,0.8)] border-[4px]";
                              } else {
                                 // ถ้าไม่ใช่ช่างที่ค้นหา: ปรับจางลงมากเป็นสีขาวดำ เพื่อขับช่างคนนั้นให้เด่น
                                 searchHighlightClass = "opacity-10 scale-95 grayscale pointer-events-none";
                              }
                           }

                           return (
                             <div key={`label-${plotId}`} className={`absolute flex items-center justify-center p-1 transition-all ${isEditMapMode ? 'opacity-50 pointer-events-none' : 'hover:z-50 cursor-pointer group'} ${searchHighlightClass}`} style={{ left: `${(bounds.minX / gridCols) * 100}%`, top: `${(bounds.minY / gridRows) * 100}%`, width: `${(w / gridCols) * 100}%`, height: `${(h / gridRows) * 100}%` }} onClick={() => { if (!isEditMapMode) { setSelectedPlot(plotInfo); setView('house-detail'); } }}>
                             
                                {/* ✅ โค้ดใหม่: จัดวางไอคอน Pickaxe ไว้ที่จุดกึ่งกลางของแปลงพอดี */}
                                {isActiveToday && (
                                   <div className="absolute top-1/5 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-yellow-400 text-slate-900 rounded-full p-1 sm:p-1.5 shadow-lg animate-bounce z-[60] border-2 border-white" title="มีการทำงานในแปลงนี้วันนี้">
                                      <Pickaxe size={14} className="w-3 h-3 sm:w-4 sm:h-4"/>
                                   </div>
                                )}

                                <div className={`w-full h-full border-[2px] sm:border-[3px] rounded-md sm:rounded-lg shadow-sm backdrop-blur-sm flex flex-col items-center justify-center relative transition-all group-hover:shadow-md group-hover:scale-[1.02] ${cardBorderClass} overflow-hidden`}>
                                   
                                    {/* 🌿 ลาย Grass Hatch ของ AutoCAD (งานปูหญ้าเสร็จ 100%) */}
                                    {isGrassPlanted && (
                                       <div className="absolute inset-0 pointer-events-none z-0 opacity-40" style={{ 
                                          backgroundImage: `url("data:image/svg+xml;utf8,<svg width='40' height='40' xmlns='http://www.w3.org/2000/svg'><g stroke='%2316a34a' stroke-width='1.2' stroke-linecap='round' fill='none'><path d='M10,25 Q12,18 15,12 M10,25 Q15,22 20,18 M10,25 Q8,18 5,14' /><path d='M30,15 Q32,8 35,2 M30,15 Q35,12 40,8 M30,15 Q28,8 25,4' /></g></svg>")`,
                                          backgroundSize: '30px 30px'
                                       }}></div>
                                    )}

                                   {/* แสดงชื่อแปลงเป็นหลัก */}
                                   <div className="flex items-center gap-0.5 sm:gap-1 relative z-10">
                                      <span className={`font-bold text-[10px] sm:text-sm ${isGrassPlanted ? 'bg-white/80 px-1.5 py-0.5 rounded shadow-sm' : ''}`}>{plotInfo.id}</span>
                                      {plotInfo.is_completed && <span className={`text-[8px] sm:text-[10px] ${isGrassPlanted ? 'bg-white/80 rounded-full shadow-sm px-0.5' : ''}`} title="สร้างเสร็จพร้อมโอน">🔑</span>}
                                      {plotInfo.has_customer && <span className={`text-[8px] sm:text-[10px] ${isGrassPlanted ? 'bg-white/80 rounded-full shadow-sm px-0.5' : ''}`} title="มีลูกค้าจองแล้ว">👤</span>}
                                   </div>
                                   
                                   {/* 🌟 🌟 ถ้ามีการค้นหาช่างและเจอแปลงของช่าง: ให้แถมป้ายชื่อช่างแปะไว้ตรงกลางผังเลย! 🌟 🌟 */}
                                   {hasSearchedContractor && isMatchContractor && (
                                      <div className="absolute -bottom-2 bg-amber-500 text-slate-900 font-bold px-1.5 py-0.5 rounded text-[8px] sm:text-[10px] uppercase tracking-wider shadow-md whitespace-nowrap border border-white z-40">
                                         👷‍♂️ {currentPlotAssignment.contractor_name.split(' ')[0]}
                                      </div>
                                   )}
                                   
                                </div>
                                   
                                   {/* Tooltip รายละเอียดเมื่อเอาเมาส์ชี้ (คงเดิมไว้ทั้งหมด) */}
                                   <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-[160px] sm:w-[180px] bg-slate-900 text-white rounded-xl sm:rounded-2xl shadow-2xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all p-3 sm:p-4 pointer-events-none z-[100] border border-slate-700">
                                      <div className="flex justify-between items-center w-full mb-1 sm:mb-2">
                                         <div className="flex items-center gap-1">
                                            <span className="font-bold text-xs sm:text-sm">{plotInfo.id}</span>
                                            {plotInfo.is_completed && <span className="bg-emerald-500 text-white text-[8px] px-1 rounded-sm" title="สร้างเสร็จพร้อมโอน">🔑</span>}
                                            {plotInfo.has_customer && <span className="bg-blue-500 text-white text-[8px] px-1 rounded-sm" title="มีลูกค้าจองแล้ว">👤</span>}
                                         </div>
                                         <span className={`text-[8px] sm:text-[10px] font-bold px-1.5 sm:px-2 py-0.5 rounded-full ${statusInfo.status === 'delayed' ? 'bg-rose-500 text-white' : statusInfo.status === 'completed' ? 'bg-emerald-500 text-white' : statusInfo.status === 'ahead' ? 'bg-indigo-500 text-white' : statusInfo.status === 'on-track' ? 'bg-blue-500 text-white' : 'bg-slate-600 text-slate-300'}`}>{statusInfo.label}</span>
                                      </div>
                                      <p className="text-[9px] sm:text-[10px] text-slate-400 mb-1 sm:mb-2 flex items-center gap-1 sm:gap-1.5"><HardHat size={10} className="sm:w-3 sm:h-3"/> {plotInfo.foreman || 'ไม่ระบุ'}</p>
                                      
                                      {/* 🌟 กล่องแสดงงานล่าสุดใน Tooltip */}
                                      <div className="bg-slate-800/80 p-1.5 sm:p-2 rounded-lg border border-slate-700/50 mb-2 sm:mb-3">
                                         <p className="text-[8px] text-[#86868b] uppercase font-bold tracking-widest mb-0.5 flex items-center gap-1"><Activity size={8}/> งานล่าสุด:</p>
                                         <p className="text-[9px] sm:text-[10px] text-amber-400 font-bold truncate">{latestTaskStr}</p>
                                      </div>
                                      
                                      <div className="w-full space-y-1.5 sm:space-y-2 mt-1">
                                         <div className="flex justify-between text-[8px] sm:text-[10px] font-bold text-slate-400 leading-none"><span>Plan</span><span>{statusInfo.planned}%</span></div>
                                         <div className="w-full bg-slate-700 h-1 sm:h-1.5 rounded-full overflow-hidden"><div className="bg-slate-400 h-full" style={{width:`${statusInfo.planned}%`}}></div></div>
                                         
                                         <div className="flex justify-between text-[8px] sm:text-[10px] font-bold text-slate-400 leading-none pt-1"><span>Actual</span><span className={statusInfo.status === 'delayed' ? 'text-rose-400' : 'text-blue-400'}>{statusInfo.actual}%</span></div>
                                         <div className="w-full bg-slate-700 h-1 sm:h-1.5 rounded-full overflow-hidden"><div className={`h-full ${statusInfo.status === 'delayed' ? 'bg-rose-500' : 'bg-blue-500'}`} style={{width:`${statusInfo.actual}%`}}></div></div>
                                      </div>
                                      <div className="absolute top-full left-1/2 -translate-x-1/2 border-[5px] sm:border-[6px] border-transparent border-t-slate-900"></div>
                                   </div>
                             </div>
                           )
                         })}
                       </div>
                     </div>
                   </div>

                   <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 sm:mb-6 mt-8 sm:mt-12 gap-3 sm:gap-4">
                      <h3 className="font-bold text-xl tracking-tight sm:text-3xl text-[#1d1d1f] italic uppercase">Plot Directory</h3>
                      <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 w-full sm:w-auto">
                        <div className="relative flex-1 sm:w-64"><Search className="absolute left-3 sm:left-4 top-1/2 -translate-y-1/2 text-slate-400 sm:w-[18px] sm:h-[18px]" size={14}/><input type="text" placeholder="ค้นหาแปลง (เช่น A-01)" value={searchPlot} onChange={(e) => setSearchPlot(e.target.value)} className="w-full bg-white border border-black/5 rounded-lg sm:rounded-xl pl-9 sm:pl-11 pr-3 sm:pr-4 py-2 sm:py-3.5 text-xs sm:text-sm font-bold outline-none focus:border-blue-500 text-[#1d1d1f] shadow-sm" /></div>
                        {currentUserRole !== 'Foreman' && (
                           <div className="relative flex-1 sm:w-64"><Filter className="absolute left-3 sm:left-4 top-1/2 -translate-y-1/2 text-slate-400 sm:w-[18px] sm:h-[18px]" size={14}/><select value={filterForeman} onChange={(e) => setFilterForeman(e.target.value)} className="w-full bg-white border border-black/5 rounded-lg sm:rounded-xl pl-9 sm:pl-11 pr-3 sm:pr-4 py-2 sm:py-3.5 text-xs sm:text-sm font-bold outline-none focus:border-blue-500 text-[#1d1d1f] appearance-none shadow-sm cursor-pointer"><option value="">โฟร์แมนทั้งหมด</option>{foremenList.map((f: any) => <option key={f.id} value={f.username}>{f.username}</option>)}</select></div>
                        )}
                      </div>
                   </div>
                   
                   <div className={`grid gap-3 sm:gap-6 ${isMobileLayout ? 'grid-cols-2' : 'grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'}`}>
                        {displayPlots.map((plot: any) => {
                        // 🌟 ดึงข้อมูล Status ของแปลงนั้นๆ เพื่อเอา % แผนงาน (planned) และ % งานจริง (actual) 🌟
                        const statusInfo = getPlotOverallStatus(plot.id);
                        
                        // 🌟 หางานล่าสุดที่มีการอัปเดตของการ์ดแปลงนี้
                        const plotUpdates = allUpdatesRecord?.filter((u: any) => u.plot_id === plot.id) || [];
                        const latestUpdate = plotUpdates.length > 0 ? plotUpdates[plotUpdates.length - 1] : null;
                        const latestTask = latestUpdate ? taskTemplates.find((t: any) => t.id === latestUpdate.task_template_id) : null;
                        const latestTaskStr = latestTask ? `${latestTask.task_name} (${latestUpdate.progress}%)` : 'ยังไม่มีงานอัปเดต';

                        return (
                          <div key={plot.id} onClick={() => { setSelectedPlot(plot); setView('house-detail'); }} className="relative group w-full bg-white p-4 sm:p-8 rounded-xl sm:rounded-[2.5rem] border border-black/5 text-left hover:border-blue-500 hover:shadow-xl hover:-translate-y-1 transition-all flex flex-col justify-between h-full cursor-pointer">
                           {/* 🌟 ปุ่มลบแปลงบ้าน (เห็นเฉพาะ Admin) 🌟 */}
                            {isAdmin && (
                              <button onClick={(e) => { e.stopPropagation(); handleDeletePlot(plot.id); }} className="absolute top-3 right-3 sm:top-5 sm:right-5 p-1.5 sm:p-2 bg-rose-50 text-rose-500 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-rose-500 hover:text-white transition-all z-20 shadow-sm" title="ลบแปลงนี้">
                                <Trash2 size={16} />
                              </button>
                            )} 
                            {/* 🌟 เพิ่มปุ่มแก้ไข (ใหม่) วางไว้ทางซ้ายของปุ่มลบเล็กน้อย */}
                            {isAdmin && (
                              <button onClick={(e) => { e.stopPropagation(); handleEditPlot(plot); }} className="absolute top-3 right-12 sm:top-5 sm:right-16 p-1.5 sm:p-2 bg-blue-50 text-blue-500 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-blue-500 hover:text-white transition-all z-20 shadow-sm" title="แก้ไขแปลงนี้">
                                <Settings size={16} />
                              </button>
                            )}
                            {/* ส่วนหัวของการ์ด และป้ายสถานะ */}
                            <div className="flex justify-between items-start w-full mb-1 sm:mb-2">
                              
                            {isAdmin && handleTogglePlotCustomer && handleTogglePlotCompleted && (
                                <div className="flex gap-2 mb-3 z-20 relative">
                                  <button onClick={(e) => { e.stopPropagation(); handleTogglePlotCustomer(plot.id, !!plot.has_customer); }} className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-bold transition-all border ${plot.has_customer ? 'bg-blue-50 text-blue-600 border-blue-200 hover:bg-blue-100' : 'bg-[#f5f5f7] text-[#86868b] border-transparent hover:bg-slate-200'}`}>
                                    👤 {plot.has_customer ? 'มีลูกค้า' : 'ระบุลูกค้า'}
                                  </button>
                                  <button onClick={(e) => { e.stopPropagation(); handleTogglePlotCompleted(plot.id, !!plot.is_completed); }} className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-bold transition-all border ${plot.is_completed ? 'bg-emerald-50 text-emerald-600 border-emerald-200 hover:bg-emerald-100' : 'bg-[#f5f5f7] text-[#86868b] border-transparent hover:bg-slate-200'}`}>
                                    🔑 {plot.is_completed ? 'โอนแล้ว' : 'พร้อมโอน'}
                                  </button>
                                </div>
                            )}
                              <div className="flex flex-col gap-1">
                                <h3 className={`${isMobileLayout ? 'text-2xl' : 'text-4xl sm:text-5xl'} font-bold text-[#1d1d1f] truncate`}>{plot.id}</h3>
                                <div className="flex gap-1.5">
                                  {plot.is_completed && <span className="bg-emerald-500 text-white text-[10px] px-1.5 py-0.5 rounded-full font-bold shadow-sm" title="สร้างเสร็จพร้อมโอน">🔑 เสร็จแล้ว</span>}
                                  {plot.has_customer && <span className="bg-blue-500 text-white text-[10px] px-1.5 py-0.5 rounded-full font-bold shadow-sm" title="มีลูกค้าจองแล้ว">👤 จองแล้ว</span>}
                                </div>
                              </div>
                              <span className={`text-[8px] sm:text-[10px] font-bold px-2 py-1 rounded-full ${statusInfo.status === 'delayed' ? 'bg-rose-100 text-rose-600' : statusInfo.status === 'completed' ? 'bg-emerald-100 text-emerald-600' : statusInfo.status === 'ahead' ? 'bg-indigo-100 text-indigo-600' : statusInfo.status === 'on-track' ? 'bg-blue-100 text-blue-600' : 'bg-[#f5f5f7] text-[#86868b]'}`}>
                                {statusInfo.label}
                              </span>
                            </div>

                            <div className={`${isMobileLayout ? 'text-[9px]' : 'text-base'} font-bold text-[#86868b] mb-1 sm:mb-3 flex items-center gap-1.5`}><HardHat size={isMobileLayout ? 12 : 18} className="text-orange-500" /> {plot.foreman || 'ไม่ระบุ'}</div>
                            <p className={`${isMobileLayout ? 'text-[8px]' : 'text-xs'} text-slate-400 font-bold uppercase tracking-wider mb-2 sm:mb-3`}>{plot.type}</p>
                            
                            {/* 🌟 กล่องแสดงงานล่าสุดของการ์ด */}
                            <div className="bg-blue-50/50 border border-blue-100 rounded-lg p-2 sm:p-3 mb-3 sm:mb-4 flex items-center gap-2">
                               <Activity size={isMobileLayout ? 12 : 16} className="text-blue-500 shrink-0"/>
                               <div className="min-w-0 flex-1">
                                  <p className="text-[8px] sm:text-[10px] text-slate-400 font-bold uppercase">อัปเดตล่าสุด</p>
                                  <p className="text-[10px] sm:text-xs font-bold text-blue-700 truncate">{latestTaskStr}</p>
                               </div>
                            </div>
                            
                            {/* 🌟 ส่วนแถบ Progress: แบ่งเป็น Plan และ Actual 🌟 */}
                            
                            {/* 🌟 ส่วนแถบ Progress: แบ่งเป็น Plan และ Actual 🌟 */}
                            <div className="w-full mt-auto space-y-2 sm:space-y-4">
                              
                              {/* แถบ Plan (แผนงาน) */}
                              <div>
                                <div className={`flex items-center justify-between font-bold ${isMobileLayout ? 'text-[8px]' : 'text-[10px] sm:text-xs'} mb-1 sm:mb-1.5`}>
                                  <span className="text-slate-400 uppercase tracking-widest">Plan (แผน)</span>
                                  <span className="text-[#86868b]">{statusInfo.planned}%</span>
                                </div>
                                <div className="h-1.5 sm:h-2.5 bg-[#f5f5f7] rounded-full overflow-hidden">
                                  <div className="h-full bg-slate-300 transition-all duration-500" style={{width: `${statusInfo.planned}%`}}></div>
                                </div>
                              </div>

                              {/* แถบ Actual (งานจริง) */}
                              <div>
                                <div className={`flex items-center justify-between font-bold ${isMobileLayout ? 'text-[8px]' : 'text-[10px] sm:text-xs'} mb-1 sm:mb-1.5`}>
                                  <span className="text-slate-400 uppercase tracking-widest">Actual (จริง)</span>
                                  <span className={`${statusInfo.status === 'delayed' ? 'text-rose-500' : 'text-blue-600'} ${isMobileLayout ? 'text-sm' : 'text-lg'}`}>{statusInfo.actual}%</span>
                                </div>
                                <div className="h-1.5 sm:h-2.5 bg-[#f5f5f7] rounded-full overflow-hidden">
                                  <div className={`h-full transition-all duration-500 ${statusInfo.status === 'delayed' ? 'bg-rose-500' : 'bg-blue-500'}`} style={{width: `${statusInfo.actual}%`}}></div>
                                </div>
                              </div>

                            </div>
                            
                            {/* ไอคอนจอบสีเหลืองในการ์ด (ผมปรับให้อยู่ตรงกลางบนเหมือนกันเพื่อความสวยงามครับ) */}
                            {plotsActiveToday.has(plot.id) && ( 
                              <div className="absolute -top-2 left-1/2 -translate-x-1/2 sm:-top-3 bg-yellow-400 text-slate-900 rounded-full p-1 sm:p-1.5 shadow-sm sm:shadow-md animate-bounce border-2 border-white">
                                  <Pickaxe size={isMobileLayout ? 12 : 16} />
                              </div> 
                            )}
                          </div>
                        );
                      })}
                   </div>
                 </div>
               )}

               
    </>
  );
}
