import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Calendar, Phone, HardHat, AlertTriangle, CheckCircle, PackageCheck, CloudRain, ChevronLeft, ChevronRight, User, Home, Clock } from 'lucide-react';

interface ContractorScheduleViewProps {
  view: string;
  schedules: any; // Record<string, any>
  assignments: any[]; // Array of plot_task_assignments
  plots: any[];
  taskTemplates: any[];
  contractors: any[];
  weatherInfo: any;
  latestUpdatesMap: any;
  loggedInUser: any;
}

const ContractorScheduleView = function ContractorScheduleView({
  view, schedules, assignments, plots, taskTemplates, contractors, weatherInfo, latestUpdatesMap, loggedInUser
}: ContractorScheduleViewProps) {
  // View is now conditionally rendered by parent
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const [currentWeekOffset, setCurrentWeekOffset] = useState(0);
  const [checklists, setChecklists] = useState<Record<string, boolean>>({});
  
  // Mobile Swipe State
  const [activeDayIdx, setActiveDayIdx] = useState(0);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (window.innerWidth >= 768) return;
    const container = e.currentTarget;
    const scrollLeft = container.scrollLeft;
    const width = container.clientWidth;
    // + gap is handled roughly by rounding
    const newIdx = Math.round(scrollLeft / width);
    if (newIdx !== activeDayIdx && newIdx >= 0 && newIdx < 7) {
      setActiveDayIdx(newIdx);
    }
  };

  const scrollTo = (idx: number) => {
    setActiveDayIdx(idx);
    const container = scrollContainerRef.current;
    if (container && container.children[idx]) {
      container.children[idx].scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
    }
  };

  useEffect(() => {
    try {
      const stored = localStorage.getItem('buildtrack_call_checklists');
      if (stored) {
        setChecklists(JSON.parse(stored));
      }
    } catch (e) {}
  }, []);

  const toggleChecklist = (key: string) => {
    setChecklists(prev => {
      const updated = { ...prev, [key]: !prev[key] };
      localStorage.setItem('buildtrack_call_checklists', JSON.stringify(updated));
      return updated;
    });
  };

  // === 1. Prepare Data ===
  const isForeman = loggedInUser?.role?.toLowerCase() === 'foreman';

  const scheduleList = useMemo(() => {
    return Object.values(schedules || {}).map((sched: any) => {
      const plot = plots.find(p => p.id === sched.plot_id);
      if (!plot) return null;
      if (isForeman && plot.foreman !== loggedInUser.username) return null;

      const task = taskTemplates.find(t => t.id === sched.task_template_id);
      
      // Find assignment to get contractor name
      const assignment = assignments.find(a => a.plot_id === sched.plot_id && a.task_template_id === sched.task_template_id);
      const contractorName = assignment?.contractor_name || 'ไม่ระบุช่าง';
      const contractor = contractors.find(c => c.name === contractorName);
      
      const updateData = latestUpdatesMap?.[`${sched.plot_id}-${sched.task_template_id}`];
      const actualProgress = updateData?.progress || assignment?.current_progress || 0;
      const pStart = new Date(sched.planned_start).getTime();
      const pEnd = new Date(sched.planned_end).getTime();

      const t = today.getTime();
      const isLateOngoing = pEnd < t && actualProgress < 100;
      const isLateToStart = pStart < t && actualProgress === 0;
      const isOverdue = isLateOngoing || isLateToStart;

      return {
        ...sched,
        plot,
        task,
        contractorName,
        contractorPhone: contractor?.phone || null,
        actualProgress,
        pStart,
        pEnd,
        isOverdue
      };
    }).filter(s => s !== null && s.task); // Filter out invalid or unauthorized plots
  }, [schedules, assignments, plots, taskTemplates, contractors, latestUpdatesMap, isForeman, loggedInUser]);

  // === 2. Generate Calendar Dates ===
  const calendarDays = useMemo(() => {
    const days = [];
    const startDate = new Date(today);
    startDate.setDate(today.getDate() + (currentWeekOffset * 7));
    for (let i = 0; i < 7; i++) {
      const d = new Date(startDate);
      d.setDate(startDate.getDate() + i);
      days.push(d);
    }
    return days;
  }, [today, currentWeekOffset]);

  // === 3. Clash Detection ===
  // Check if multiple contractors are scheduled for the same plot on the same day
  const getClashesForDay = (date: Date, list: typeof scheduleList) => {
    const time = date.getTime();
    const activeForDay = list.filter(s => s.pStart <= time && time <= s.pEnd);
    
    // Group by plot
    const plotGroups: Record<string, typeof scheduleList> = {};
    activeForDay.forEach(s => {
      if (!plotGroups[s.plot_id]) plotGroups[s.plot_id] = [];
      plotGroups[s.plot_id].push(s);
    });

    // Find plots with multiple different contractors
    const clashes: any[] = [];
    Object.entries(plotGroups).forEach(([plotId, tasks]) => {
      const uniqueContractors = new Set(tasks.map(t => t.contractorName));
      if (uniqueContractors.size > 1) {
        clashes.push({ plotId, tasks });
      }
    });
    return clashes;
  };

  const calendarDaysData = useMemo(() => {
    return calendarDays.map((date) => {
      const isToday = date.getTime() === today.getTime();
      const clashes = getClashesForDay(date, scheduleList);
      const tasksForDay = scheduleList.filter(s => s.pStart <= date.getTime() && date.getTime() <= s.pEnd);
      
      const groupedTasks = Object.entries(
        tasksForDay.reduce((acc: any, t: any) => {
          if (!acc[t.plot_id]) acc[t.plot_id] = [];
          acc[t.plot_id].push(t);
          return acc;
        }, {})
      );

      const groupedTasksWithDetails = groupedTasks.map(([plotId, tasks]: [string, any]) => {
        const isClashing = clashes.some(c => c.plotId === plotId);
        const uniqueContractorNames = Array.from(new Set(tasks.map((t:any) => t.contractorName.split(' ')[0]))).join(' / ');
        return { plotId, tasks, isClashing, uniqueContractorNames };
      });

      return {
        date,
        isToday,
        clashes,
        tasksForDay,
        groupedTasksWithDetails
      };
    });
  }, [calendarDays, scheduleList, today]);

  // === 4. Weather Context ===
  const isRainExpected = weatherInfo?.alert?.type === 'rain';

  // === 5. Today's Operations ===
  const todaysWork = useMemo(() => {
    return scheduleList.filter(s => {
      const t = today.getTime();
      const isOngoingToday = s.pStart <= t && t <= s.pEnd;
      return isOngoingToday || s.isOverdue;
    }).sort((a, b) => {
      if (a.isOverdue && !b.isOverdue) return -1;
      if (!a.isOverdue && b.isOverdue) return 1;
      return a.plot_id.localeCompare(b.plot_id);
    });
  }, [scheduleList, today]);

  // === 6. Call List (Next 2 Days + Overdue) ===
  const { tomorrow, dayAfter } = useMemo(() => {
    const tom = new Date(today); tom.setDate(tom.getDate() + 1);
    const da = new Date(today); da.setDate(da.getDate() + 2);
    return { tomorrow: tom, dayAfter: da };
  }, [today]);

  const { callList, callListByContractor } = useMemo(() => {
    const list = scheduleList.filter(s => {
      const tStart = new Date(s.pStart);
      tStart.setHours(0,0,0,0);
      const isNext2Days = tStart.getTime() === tomorrow.getTime() || tStart.getTime() === dayAfter.getTime();
      return isNext2Days || s.isOverdue;
    }).sort((a, b) => {
      if (a.isOverdue && !b.isOverdue) return -1;
      if (!a.isOverdue && b.isOverdue) return 1;
      return a.pStart - b.pStart;
    });

    const grouped: Record<string, any[]> = {};
    list.forEach(s => {
      if (!grouped[s.contractorName]) grouped[s.contractorName] = [];
      grouped[s.contractorName].push(s);
    });

    return { callList: list, callListByContractor: grouped };
  }, [scheduleList, tomorrow, dayAfter]);

  return (
    <div className="animate-in fade-in zoom-in-95 duration-500 w-full px-2 sm:px-6 mx-auto pb-12">
      <div className="mb-6 sm:mb-8 mt-6 sm:mt-8">
        <h2 className="font-semibold text-2xl tracking-tight sm:text-4xl text-[#1d1d1f] flex items-center gap-3">
          <Calendar className="text-blue-600" size={32}/> 
          แผนปฏิบัติการผู้รับเหมา
        </h2>
        <p className="text-[#86868b] mt-2">ตารางคุมงาน, ตรวจสอบพื้นที่ทับซ้อน และโพยโทรตามช่าง (สำหรับ Site Engineer และ Foreman)</p>
      </div>

      {/* === TOP SECTION: 7-DAY TIMELINE === */}
      <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] border border-white shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-5 sm:p-8 mb-6 sm:mb-8">
        <div className="flex items-center justify-between mb-6">
          <h3 className="font-semibold text-xl text-[#1d1d1f] flex items-center gap-2">
            <Clock size={20} className="text-emerald-500"/> Timeline 7 วัน
          </h3>
          <div className="flex items-center gap-2 bg-black/5 p-1 rounded-xl">
            <button onClick={() => setCurrentWeekOffset(prev => prev - 1)} className="p-2 hover:bg-white rounded-lg transition-colors"><ChevronLeft size={18}/></button>
            <span className="text-xs font-semibold px-2">สัปดาห์ที่ {currentWeekOffset > 0 ? `+${currentWeekOffset}` : currentWeekOffset}</span>
            <button onClick={() => setCurrentWeekOffset(prev => prev + 1)} className="p-2 hover:bg-white rounded-lg transition-colors"><ChevronRight size={18}/></button>
          </div>
        </div>

        {/* MOBILE DAY PICKER TABS */}
        <div className="flex md:hidden gap-2 mb-4 overflow-x-auto custom-scrollbar pb-2 snap-x">
          {calendarDaysData.map((day, idx) => (
            <button 
              key={idx} 
              onClick={() => scrollTo(idx)} 
              className={`snap-center shrink-0 px-4 py-2 rounded-full font-bold text-sm transition-colors border ${activeDayIdx === idx ? 'bg-blue-600 text-white border-blue-600 shadow-md' : 'bg-slate-50 text-slate-500 border-slate-200'}`}
            >
               {day.date.toLocaleDateString('th-TH', { weekday: 'short' })} {day.date.getDate()}
            </button>
          ))}
        </div>

        {/* TIMELINE CONTAINER */}
        <div className="pb-4 relative">
          <div 
            ref={scrollContainerRef}
            onScroll={handleScroll}
            className="flex md:grid md:grid-cols-7 gap-4 md:gap-3 overflow-x-auto snap-x snap-mandatory custom-scrollbar pb-2 md:min-w-[800px]"
          >
            {calendarDaysData.map((dayData, idx) => {
              const { date, isToday, clashes, tasksForDay, groupedTasksWithDetails } = dayData;

              return (
                <div key={idx} className={`snap-center snap-always w-full shrink-0 md:w-auto flex flex-col border ${isToday ? 'border-blue-500 bg-blue-50/30 shadow-sm' : 'border-black/5 bg-slate-50/50'} rounded-2xl overflow-hidden`}>
                  <div className={`text-center py-2 border-b ${isToday ? 'bg-blue-500 text-white border-blue-600' : 'bg-black/5 border-black/5 text-[#86868b]'}`}>
                    <div className="text-xs font-bold uppercase tracking-wider">{date.toLocaleDateString('th-TH', { weekday: 'short' })}</div>
                    <div className="text-2xl font-black mt-0.5">{date.getDate()}</div>
                  </div>
                  
                  <div className="p-2 flex flex-col gap-2 min-h-[120px] max-h-[300px] overflow-y-auto custom-scrollbar">
                    {clashes.length > 0 && (
                      <div className="bg-rose-100 text-rose-700 text-[11px] font-bold px-2 py-2 rounded-lg flex items-center gap-1.5 shadow-sm border border-rose-200">
                        <AlertTriangle size={14} className="shrink-0"/> ระวังทับซ้อน {clashes.length} แปลง
                      </div>
                    )}

                    {tasksForDay.length === 0 ? (
                      <div className="text-center text-slate-300 text-[10px] md:text-xs font-medium mt-6">ไม่มีงาน</div>
                    ) : (
                      groupedTasksWithDetails.map((group, i) => {
                        const { plotId, tasks, isClashing, uniqueContractorNames } = group;
                        
                        return (
                          <div key={i} className={`p-3 md:p-2 rounded-xl border shadow-sm text-left ${isClashing ? 'bg-rose-50 border-rose-200' : 'bg-white border-black/5'}`}>
                            <div className="flex items-center justify-between mb-2 pb-1.5 border-b border-black/5">
                              <span className="text-xs font-black text-[#1d1d1f] bg-[#f5f5f7] px-2 py-0.5 rounded-md border border-black/5 flex items-center gap-1">
                                🏠 {plotId}
                              </span>
                              <span className="text-[10px] font-bold text-slate-400">{tasks.length} งาน</span>
                            </div>
                            {isClashing && (
                               <div className="text-[10px] bg-rose-100 text-rose-700 px-2 py-1 rounded mb-2 font-bold break-words leading-tight">
                                  ⚡ ชนกัน: {uniqueContractorNames}
                               </div>
                            )}
                            <div className="flex flex-col gap-2">
                              {tasks.map((t: any, idx: number) => (
                                <div key={idx} className="flex flex-col gap-1">
                                  <div className="flex justify-between items-start">
                                    <p className="text-xs md:text-[11px] text-[#515154] font-semibold leading-tight line-clamp-2 pr-1">{t.task.task_name}</p>
                                    <span className="text-[10px] px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded font-bold shrink-0" title={t.contractorName}>{t.contractorName.split(' ')[0]}</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )
                      })
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 sm:gap-8">
        {/* === BOTTOM LEFT: TODAY'S OP === */}
        <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] border border-white shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-5 sm:p-8 flex flex-col h-full">
          <div className="flex items-center justify-between mb-6">
            <h3 className="font-semibold text-xl text-[#1d1d1f] flex items-center gap-2">
              <HardHat size={20} className="text-orange-500"/> งานวันนี้ (Today)
            </h3>
            <span className="bg-orange-100 text-orange-600 font-bold px-3.5 py-1.5 rounded-full text-sm">{todaysWork.length} งาน</span>
          </div>

          <div className="flex flex-col gap-3 flex-1 overflow-y-auto custom-scrollbar pr-2 max-h-[500px]">
            {todaysWork.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-slate-400 opacity-50 py-10">
                <CheckCircle size={48} className="mb-4"/>
                <p>ไม่มีช่างเข้าทำงานในวันนี้</p>
              </div>
            ) : (
              todaysWork.map((w, i) => {
                const isOutdoor = w.task.task_name.includes('หลังคา') || w.task.task_name.includes('สีภายนอก') || w.task.task_name.includes('โครงสร้าง') || w.task.task_name.includes('รั้ว') || w.task.task_name.includes('ฉาบ');
                const showWeatherWarning = isRainExpected && isOutdoor;

                return (
                  <div key={i} className={`border rounded-2xl p-4 shadow-sm flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center transition-colors ${w.isOverdue ? 'border-rose-500 bg-rose-50/50' : 'bg-white border-black/5 hover:border-blue-500'}`}>
                    <div className="flex items-start gap-4 flex-1">
                      <div className={`w-14 h-14 rounded-xl flex items-center justify-center font-bold text-xl shrink-0 border ${w.isOverdue ? 'bg-rose-100 text-rose-700 border-rose-200' : 'bg-[#f5f5f7] text-[#1d1d1f] border-black/5'}`}>
                        {w.plot_id}
                      </div>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <h4 className={`font-semibold text-base ${w.isOverdue ? 'text-rose-700' : 'text-[#1d1d1f]'}`}>{w.task.task_name}</h4>
                          {w.isOverdue && <span className="bg-rose-100 text-rose-700 text-[11px] px-2 py-0.5 rounded-full font-bold flex items-center gap-1 animate-pulse"><AlertTriangle size={12}/> ล่าช้า!</span>}
                          {showWeatherWarning && <span className="bg-blue-100 text-blue-700 text-[11px] px-2 py-0.5 rounded-full flex items-center gap-1 font-bold animate-pulse"><CloudRain size={12}/> ระวังฝนตก</span>}
                        </div>
                        <p className="text-sm text-[#86868b] flex items-center gap-1.5"><User size={14}/> {w.contractorName}</p>
                      </div>
                    </div>
                    
                    <div className="flex flex-col items-end shrink-0 w-full sm:w-auto mt-2 sm:mt-0 pt-3 sm:pt-0 border-t sm:border-t-0 border-black/5">
                      <span className="text-xs text-[#86868b] font-bold mb-1 uppercase tracking-wider">สถานะหน้างานจริง</span>
                      <div className="flex items-center gap-2 w-full justify-end">
                        <div className="w-24 sm:w-32 h-2.5 bg-slate-100 rounded-full overflow-hidden">
                          <div className={`h-full ${w.actualProgress === 100 ? 'bg-emerald-500' : w.actualProgress > 0 ? 'bg-blue-500' : 'bg-slate-300'} rounded-full`} style={{width: `${w.actualProgress}%`}}></div>
                        </div>
                        <span className={`text-sm font-bold w-8 text-right ${w.actualProgress === 100 ? 'text-emerald-600' : 'text-[#1d1d1f]'}`}>{w.actualProgress}%</span>
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* === BOTTOM RIGHT: CALL LIST === */}
        <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] border border-white shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-5 sm:p-8 flex flex-col h-full">
          <div className="flex items-center justify-between mb-6">
            <h3 className="font-semibold text-xl text-[#1d1d1f] flex items-center gap-2">
              <Phone size={20} className="text-blue-600"/> โพยโทรตามช่าง (Next 2 Days)
            </h3>
            <span className="bg-blue-100 text-blue-600 font-bold px-3.5 py-1.5 rounded-full text-sm">{Object.keys(callListByContractor).length} ทีม</span>
          </div>

          <div className="flex flex-col gap-4 flex-1 overflow-y-auto custom-scrollbar pr-2 max-h-[500px]">
            {Object.keys(callListByContractor).length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-slate-400 opacity-50 py-10">
                <CheckCircle size={48} className="mb-4"/>
                <p>ไม่มีคิวช่างเข้าใหม่ในอีก 2 วันข้างหน้า</p>
              </div>
            ) : (
              Object.entries(callListByContractor).map(([contractorName, tasks]: [string, any[]], idx) => {
                const phone = tasks[0].contractorPhone || 'ไม่มีเบอร์ในระบบ';
                
                return (
                  <div key={idx} className="bg-slate-50 border border-black/5 rounded-2xl p-4 shadow-sm">
                    <div className="flex justify-between items-start mb-4 pb-3 border-b border-black/5">
                      <div>
                        <h4 className="font-bold text-[#1d1d1f] text-base flex items-center gap-2"><User size={16} className="text-slate-400"/> {contractorName}</h4>
                        <p className="text-sm text-blue-600 font-bold mt-1 flex items-center gap-1.5"><Phone size={14}/> {phone}</p>
                      </div>
                      <a href={`tel:${phone}`} className="bg-blue-600 text-white p-2 rounded-xl shadow-md hover:bg-blue-700 active:scale-95 transition-all">
                        <Phone size={18}/>
                      </a>
                    </div>
                    
                    <div className="flex flex-col gap-2 mb-4">
                      {tasks.map((t, i) => (
                        <div key={i} className={`flex items-start gap-3 p-2.5 rounded-lg border ${t.isOverdue ? 'bg-rose-50 border-rose-200' : 'bg-white border-black/5'}`}>
                          <div className={`w-10 h-10 rounded-lg font-bold text-xs flex items-center justify-center shrink-0 ${t.isOverdue ? 'bg-rose-100 text-rose-700' : 'bg-blue-50 text-blue-700'}`}>
                            {t.plot_id}
                          </div>
                          <div className="flex-1 mt-0.5">
                            <p className={`text-sm font-semibold leading-tight ${t.isOverdue ? 'text-rose-700' : 'text-[#1d1d1f]'}`}>{t.task.task_name}</p>
                            <p className={`text-xs font-bold mt-1 ${t.isOverdue ? 'text-rose-500' : 'text-[#86868b]'}`}>
                               {t.isOverdue ? '🚨 ล่าช้ากว่าแผน!' : `เริ่ม: ${new Date(t.pStart).toLocaleDateString('th-TH', {day: 'numeric', month: 'short'})}`}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Material Checklist */}
                    <div className="bg-white rounded-xl p-4 border border-black/5">
                      <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-1.5"><PackageCheck size={14}/> Checklist ก่อนช่างเข้า</p>
                      {['โทรคอนเฟิร์มช่างแล้ว', 'ตรวจสอบของเข้าหน้างานครบถ้วน'].map((label, cIdx) => {
                         const checkKey = `chk_${contractorName}_${label}`;
                         const isChecked = checklists[checkKey] || false;
                         return (
                           <label key={cIdx} className="flex items-center gap-3 cursor-pointer mb-2.5 group">
                             <input type="checkbox" checked={isChecked} onChange={() => toggleChecklist(checkKey)} className="w-5 h-5 rounded text-blue-600 focus:ring-blue-500 border-slate-300"/>
                             <span className={`text-sm font-medium transition-colors ${isChecked ? 'text-blue-600 line-through opacity-70' : 'text-[#1d1d1f] group-hover:text-blue-600'}`}>{label}</span>
                           </label>
                         );
                      })}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default React.memo(ContractorScheduleView);
