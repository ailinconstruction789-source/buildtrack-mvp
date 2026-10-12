import React, { useMemo, useState } from 'react';
import { Calendar, ChevronLeft, ChevronRight, Home, CheckCircle } from 'lucide-react';
import { constructionScheduleGanttLanes, constructionScheduleGanttRange, constructionScheduleHouseTypeIndex } from '@/lib/constructionSchedule';
import { useConstructionScheduleToday } from '@/hooks/constructionScheduleToday';

const MasterGanttChart = function MasterGanttChart({
  view, plots, taskTemplates, schedules, latestUpdatesMap, projects, contractors, assignments
}: any) {
  // View is conditionally rendered in parent
  const [currentMonthOffset, setCurrentMonthOffset] = useState(0);
  const [selectedProject, setSelectedProject] = useState<string>('all');

  const today = useConstructionScheduleToday();

  // Generate a 3-month timeline based on offset
  const timelineDates = useMemo(() => {
    const dates = [];
    const startDate = new Date(today);
    startDate.setDate(1); // Start at 1st of the month
    startDate.setMonth(startDate.getMonth() + currentMonthOffset);
    
    // We'll show 90 days
    for (let i = 0; i < 90; i++) {
      const d = new Date(startDate);
      d.setDate(startDate.getDate() + i);
      dates.push(d);
    }
    return dates;
  }, [today, currentMonthOffset]);

  const startDateMs = timelineDates[0].getTime();
  const endDateMs = timelineDates[timelineDates.length - 1].getTime();

  const filteredPlots = useMemo(() => {
    if (selectedProject === 'all') return plots || [];
    return (plots || []).filter((p: any) => p.project_name === selectedProject);
  }, [plots, selectedProject]);

  const tasksByHouseType = useMemo(() => constructionScheduleHouseTypeIndex(taskTemplates || []), [taskTemplates]);
  const ganttRows = useMemo(() => filteredPlots.map((plot: any, pIdx: number) => {
    const activeTasks = (tasksByHouseType.get(plot.house_type_id) || []).flatMap((task: any) => {
      const sched = schedules?.[`${plot.id}-${task.id}`];
      if (!sched || !sched.planned_start || !sched.planned_end) return [];
      const range = constructionScheduleGanttRange(sched.planned_start, sched.planned_end, startDateMs, endDateMs);
      if (!range) return [];
      const updateData = latestUpdatesMap?.[`${plot.id}-${task.id}`];
      return [{ task, sched, ...range, progress: updateData?.progress || 0 }];
    });
    const { lanes, laneCount } = constructionScheduleGanttLanes(activeTasks);
    return { plot, pIdx, activeTasks, lanes, laneCount };
  }).filter((row: any) => row.activeTasks.length > 0), [filteredPlots, tasksByHouseType, schedules, latestUpdatesMap, startDateMs, endDateMs]);

  return (
    <div className="animate-in fade-in zoom-in-95 duration-500 w-full px-2 sm:px-6 mx-auto pb-12 mt-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-8 gap-4">
        <div>
          <h2 className="font-semibold text-2xl tracking-tight sm:text-4xl text-[#1d1d1f] flex items-center gap-3">
            <Calendar className="text-indigo-600" size={32}/> 
            Master Gantt Chart
          </h2>
          <p className="text-[#86868b] mt-2">แผนภาพรวมระยะยาว 3 เดือน (Project Planner & Admin)</p>
        </div>
        
        <div className="flex items-center gap-3">
          <select 
            value={selectedProject} 
            onChange={(e) => setSelectedProject(e.target.value)}
            className="px-4 py-2 rounded-xl border border-slate-200 bg-white font-bold text-sm text-slate-700 outline-none focus:border-indigo-500 shadow-sm"
          >
            <option value="all">ทุกโครงการ</option>
            {projects?.map((p: any) => (
              <option key={p.name} value={p.name}>{p.name}</option>
            ))}
          </select>
          <div className="flex items-center gap-2 bg-white border border-slate-200 shadow-sm p-1 rounded-xl">
            <button onClick={() => setCurrentMonthOffset(prev => prev - 1)} className="p-2 hover:bg-slate-50 rounded-lg transition-colors"><ChevronLeft size={18}/></button>
            <span className="text-xs font-black px-2 text-slate-600 uppercase">
               {timelineDates[0].toLocaleDateString('th-TH', { month: 'short', year: 'numeric' })}
            </span>
            <button onClick={() => setCurrentMonthOffset(prev => prev + 1)} className="p-2 hover:bg-slate-50 rounded-lg transition-colors"><ChevronRight size={18}/></button>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-[2rem] border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-auto custom-scrollbar max-h-[calc(100vh-220px)]">
          <div className="inline-block min-w-full">
            {/* Header: Dates */}
            <div className="flex border-b border-slate-200 bg-slate-50 sticky top-0 z-30 shadow-sm">
              <div className="w-[180px] shrink-0 border-r border-slate-200 p-4 font-black text-slate-600 sticky left-0 bg-slate-50 z-40 flex items-center gap-2 shadow-[2px_0_10px_rgba(0,0,0,0.02)]">
                 <Home size={18} /> บ้าน (Plots)
              </div>
              <div className="flex flex-1">
                {timelineDates.map((date, idx) => {
                  const isToday = date.getTime() === today.getTime();
                  return (
                    <div key={idx} className={`w-[40px] shrink-0 border-r border-slate-100 flex flex-col items-center justify-center py-2 ${isToday ? 'bg-indigo-100 text-indigo-700' : ''}`}>
                       <span className="text-[10px] font-bold uppercase opacity-50">{date.toLocaleDateString('th-TH', { weekday: 'short' })}</span>
                       <span className="text-xs font-black">{date.getDate()}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Body: Plots and Tasks */}
            <div className="flex flex-col relative z-10 min-h-[400px]">
               {ganttRows.map(({ plot, pIdx, activeTasks, lanes, laneCount }: any) => {
                  const bgClass = pIdx % 2 === 0 ? 'bg-white' : 'bg-slate-100/70';

                  return (
                    <div key={pIdx} className={`flex border-b-2 border-slate-300 transition-colors group hover:bg-indigo-50/60 ${bgClass}`}>
                       {/* Plot Column */}
                       <div className={`w-[180px] shrink-0 border-r border-slate-200 p-3 sticky left-0 z-20 shadow-[2px_0_10px_rgba(0,0,0,0.02)] group-hover:bg-indigo-50/60 transition-colors ${bgClass}`}>
                          <div className="sticky top-24">
                             <p className="font-black text-sm text-slate-800 flex items-center gap-2">
                                <span className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-700 flex items-center justify-center border border-indigo-100 shadow-sm">{plot.plot_name || plot.id}</span>
                             </p>
                             <p className="text-[10px] font-bold text-slate-400 mt-1 pl-10 truncate">{plot.project_name}</p>
                          </div>
                       </div>
                       
                       {/* Gantt Area */}
                       <div className="flex-1 relative min-h-[60px] py-3 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iMTAwJSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48bGluZSB4MT0iMzkiIHkxPSIwIiB4Mj0iMzkiIHkyPSIxMDAlIiBzdHJva2U9IiNmMWY1ZjkiIHN0cm9rZS13aWR0aD0iMSIvPjwvc3ZnPg==')]">
                          {activeTasks.map((at: any, tIdx: number) => {
                             const yOffset = lanes[tIdx] * 28;

                             return (
                                <div 
                                   key={tIdx} 
                                   className={`absolute h-6 rounded-md shadow-sm border text-[10px] font-bold flex items-center px-2 truncate cursor-pointer transition-all hover:brightness-95 hover:scale-[1.02] hover:z-30 ${at.progress === 100 ? 'bg-emerald-100 border-emerald-300 text-emerald-800' : 'bg-indigo-100 border-indigo-300 text-indigo-800'}`}
                                   style={{ 
                                      left: `${at.left}px`, 
                                      width: `${at.width}px`,
                                      top: `${12 + yOffset}px`,
                                      zIndex: 10
                                   }}
                                   title={`${at.task.task_name} (${at.progress}%)`}
                                >
                                   {at.width > 50 && <span className="truncate">{at.task.task_name}</span>}
                                   {at.progress === 100 && <CheckCircle size={10} className="ml-1 shrink-0 text-emerald-600"/>}
                                </div>
                             )
                          })}
                          
                          {/* Invisible div to ensure row height fits stacked tasks */}
                          <div style={{ height: `${laneCount * 28 + 12}px` }}></div>
                       </div>
                    </div>
                  );
               })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default React.memo(MasterGanttChart);
