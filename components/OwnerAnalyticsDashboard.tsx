import React, { useMemo } from 'react';
import { TrendingUp, AlertTriangle, Target, ShieldAlert, Award } from 'lucide-react';

export default function OwnerAnalyticsDashboard({
  projects, plots, taskTemplates, schedules, defects, allUpdatesRecord, foremenList, latestUpdatesMap
}: any) {

  // 1. Bottleneck & Rework Analysis
  // หางวดงานที่โดนตีกลับ (Rework) บ่อยสุด
  const bottleneckData = useMemo(() => {
    const reworkCounts: Record<string, number> = {};
    if (allUpdatesRecord) {
      allUpdatesRecord.forEach((upd: any) => {
        if (upd.action && (upd.action.includes('แจ้งแก้ไข') || upd.action.includes('ไม่อนุมัติ'))) {
          reworkCounts[upd.task_template_id] = (reworkCounts[upd.task_template_id] || 0) + 1;
        }
      });
    }
    return Object.entries(reworkCounts)
      .map(([taskId, count]) => {
        const task = taskTemplates?.find((t:any) => String(t.id) === String(taskId));
        return { taskName: task ? task.task_name : 'ไม่ระบุ', count };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 5); // Top 5
  }, [allUpdatesRecord, taskTemplates]);

  // 2. Team Performance Matrix (Foreman Leaderboard)
  const foremanPerformance = useMemo(() => {
    if (!foremenList) return [];
    return foremenList.map((foreman: any) => {
      const fPlots = plots?.filter((p: any) => p.foreman === foreman.username) || [];
      let totalTasks = 0;
      let delayedTasks = 0;
      let totalReworks = 0;

      fPlots.forEach((p: any) => {
        const pTasks = taskTemplates?.filter((t: any) => t.house_type_id === p.house_type_id) || [];
        totalTasks += pTasks.length;
        
        pTasks.forEach((t: any) => {
           const key = `${p.id}-${t.id}`;
           const plan = schedules?.[key];
           const actual = latestUpdatesMap?.[key];
           
           if (actual && actual.progress === 100) {
             const pEnd = plan && plan.planned_end ? new Date(plan.planned_end).getTime() : 0;
             const aEnd = actual.created_at ? new Date(actual.created_at).getTime() : 0; 
             if (pEnd > 0 && aEnd > pEnd + 86400000) {
               delayedTasks++;
             }
           }
        });
      });

      // Reworks for this foreman
      if (allUpdatesRecord) {
        allUpdatesRecord.forEach((upd: any) => {
          if (upd.action && upd.action.includes('แจ้งแก้ไข') && fPlots.some((p:any) => String(p.id) === String(upd.plot_id))) {
            totalReworks++;
          }
        });
      }

      const onTimeRate = totalTasks > 0 ? Math.round(((totalTasks - delayedTasks) / totalTasks) * 100) : 100;
      const defectCount = defects?.filter((d: any) => fPlots.some((p: any) => p.id === d.plot_id)).length || 0;

      return {
        name: foreman.username,
        plotsCount: fPlots.length,
        onTimeRate,
        totalReworks,
        defectCount
      };
    }).sort((a, b) => b.onTimeRate - a.onTimeRate || a.totalReworks - b.totalReworks);
  }, [foremenList, plots, taskTemplates, schedules, latestUpdatesMap, allUpdatesRecord, defects]);

  // 3. Defect Stats
  const defectStats = useMemo(() => {
    if (!defects) return { total: 0, pending: 0, resolved: 0, avgResolveTime: 0 };
    const resolvedDefects = defects.filter((d: any) => d.status === 'resolved' && d.resolved_at);
    let totalResolveDays = 0;
    resolvedDefects.forEach((d: any) => {
      const createDate = new Date(d.created_at).getTime();
      const resolveDate = new Date(d.resolved_at).getTime();
      totalResolveDays += Math.max(0, (resolveDate - createDate) / (1000 * 60 * 60 * 24));
    });
    const avgResolveTime = resolvedDefects.length > 0 ? Math.round((totalResolveDays / resolvedDefects.length) * 10) / 10 : 0;
    
    return {
      total: defects.length,
      pending: defects.filter((d: any) => d.status === 'pending').length,
      resolved: resolvedDefects.length,
      avgResolveTime
    };
  }, [defects]);

  // 4. Simplified S-Curve (Planned vs Actual)
  const projectProgressData = useMemo(() => {
    if (!projects) return [];
    return projects.map((proj: any) => {
      const pPlots = plots?.filter((p: any) => p.project_name === proj.name) || [];
      let actualTotal = 0;
      let plannedTotal = 0;
      let taskCount = 0;

      pPlots.forEach((p: any) => {
        const pTasks = taskTemplates?.filter((t: any) => t.house_type_id === p.house_type_id) || [];
        taskCount += pTasks.length;
        pTasks.forEach((t: any) => {
           const key = `${p.id}-${t.id}`;
           actualTotal += (latestUpdatesMap?.[key]?.progress || 0);
           
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
           plannedTotal += plannedProg;
        });
      });

      return {
        name: proj.name,
        actualAvg: taskCount > 0 ? Math.round(actualTotal / taskCount) : 0,
        plannedAvg: taskCount > 0 ? Math.round(plannedTotal / taskCount) : 0,
      };
    });
  }, [projects, plots, taskTemplates, latestUpdatesMap, schedules]);

  return (
    <div className="space-y-6 sm:space-y-8 mt-8">
      <div className="flex items-center gap-3 border-b border-slate-200 pb-4">
        <TrendingUp className="text-blue-600" size={28} />
        <h2 className="text-xl sm:text-3xl font-black text-slate-800 italic uppercase">Deep Analytics <span className="text-slate-400 text-sm sm:text-base font-bold ml-2">สำหรับผู้บริหาร</span></h2>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 1. Project S-Curve (Planned vs Actual) */}
        <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
          <h3 className="font-black text-lg text-slate-800 mb-6 flex items-center gap-2"><Target className="text-indigo-500" /> Planned vs Actual Progress</h3>
          <div className="space-y-6">
            {projectProgressData.map((proj: any, idx: number) => (
              <div key={idx} className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="font-bold text-slate-700">{proj.name}</span>
                  <span className={`text-xs font-black px-2 py-1 rounded-lg ${proj.actualAvg >= proj.plannedAvg ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                    {proj.actualAvg >= proj.plannedAvg ? 'นำหน้าแผน' : 'ล่าช้ากว่าแผน'}
                  </span>
                </div>
                <div className="relative h-4 bg-slate-100 rounded-full overflow-hidden">
                  <div className="absolute top-0 left-0 h-full bg-slate-300 opacity-50" style={{ width: `${proj.plannedAvg}%` }}></div>
                  <div className={`absolute top-0 left-0 h-full ${proj.actualAvg >= proj.plannedAvg ? 'bg-emerald-500' : 'bg-blue-600'}`} style={{ width: `${proj.actualAvg}%`, zIndex: 10 }}></div>
                </div>
                <div className="flex justify-between text-[10px] font-bold text-slate-400">
                  <span className="text-blue-600">Actual: {proj.actualAvg}%</span>
                  <span>Planned: {proj.plannedAvg}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 2. Defect Stats */}
        <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm flex flex-col justify-center hover:shadow-md transition-shadow">
          <h3 className="font-black text-lg text-slate-800 mb-6 flex items-center gap-2"><ShieldAlert className="text-rose-500" /> Defect & Quality Control</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-rose-50 p-5 rounded-2xl border border-rose-100">
              <p className="text-xs font-black uppercase text-rose-500 mb-1">Total Defects</p>
              <p className="text-3xl sm:text-4xl font-black text-rose-700">{defectStats.total}</p>
              <p className="text-[10px] sm:text-xs font-bold text-rose-400 mt-2">Pending: {defectStats.pending}</p>
            </div>
            <div className="bg-emerald-50 p-5 rounded-2xl border border-emerald-100">
              <p className="text-xs font-black uppercase text-emerald-600 mb-1">Avg Resolve Time</p>
              <p className="text-3xl sm:text-4xl font-black text-emerald-700">{defectStats.avgResolveTime} <span className="text-sm">วัน</span></p>
              <p className="text-[10px] sm:text-xs font-bold text-emerald-500 mt-2">Resolved: {defectStats.resolved}</p>
            </div>
          </div>
        </div>

        {/* 3. Bottleneck Analysis */}
        <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
          <h3 className="font-black text-lg text-slate-800 mb-6 flex items-center gap-2"><AlertTriangle className="text-amber-500" /> Top 5 Reworked Tasks (คอขวด)</h3>
          <div className="space-y-4">
            {bottleneckData.length > 0 ? bottleneckData.map((b: any, idx: number) => (
              <div key={idx} className="flex items-center gap-3">
                <div className="w-8 h-8 shrink-0 bg-amber-100 text-amber-700 font-black rounded-full flex items-center justify-center text-sm">{idx + 1}</div>
                <div className="flex-1">
                  <p className="font-bold text-sm text-slate-700 truncate max-w-[200px] sm:max-w-full">{b.taskName}</p>
                  <div className="w-full bg-slate-100 h-1.5 rounded-full mt-1.5 overflow-hidden">
                    <div className="bg-amber-500 h-full transition-all duration-1000" style={{ width: `${Math.min((b.count / bottleneckData[0].count) * 100, 100)}%` }}></div>
                  </div>
                </div>
                <div className="font-black text-slate-600 text-sm">{b.count} ครั้ง</div>
              </div>
            )) : <div className="text-slate-400 font-bold text-sm text-center py-8">ไม่มีข้อมูลตีกลับงาน 🎉</div>}
          </div>
        </div>

        {/* 4. Team Performance Matrix */}
        <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
          <h3 className="font-black text-lg text-slate-800 mb-6 flex items-center gap-2"><Award className="text-yellow-500" /> Foreman Leaderboard</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className="p-3 text-xs font-black uppercase text-slate-500">Foreman</th>
                  <th className="p-3 text-xs font-black uppercase text-slate-500 text-center">On-time</th>
                  <th className="p-3 text-xs font-black uppercase text-slate-500 text-center">Reworks</th>
                  <th className="p-3 text-xs font-black uppercase text-slate-500 text-center">Defects</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {foremanPerformance.slice(0, 5).map((f: any, idx: number) => (
                  <tr key={idx} className="hover:bg-slate-50 transition-colors">
                    <td className="p-3 font-bold text-sm text-slate-700 flex items-center gap-2">
                      {idx === 0 && <span className="text-yellow-500 text-lg">👑</span>}
                      {f.name}
                    </td>
                    <td className="p-3 text-center">
                      <span className={`font-black text-xs px-2 py-1 rounded-md ${f.onTimeRate >= 80 ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>{f.onTimeRate}%</span>
                    </td>
                    <td className="p-3 text-center font-bold text-sm text-slate-600">{f.totalReworks}</td>
                    <td className="p-3 text-center font-bold text-sm text-slate-600">{f.defectCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
