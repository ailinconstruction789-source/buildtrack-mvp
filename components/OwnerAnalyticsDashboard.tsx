import React, { useMemo } from 'react';
import { TrendingUp, AlertTriangle, Target, ShieldAlert, Award, Users } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer } from 'recharts';

export default function OwnerAnalyticsDashboard({
  projects, plots, taskTemplates, schedules, defects, allUpdatesRecord, foremenList, latestUpdatesMap, contractors, assignments
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
    }).sort((a: any, b: any) => b.onTimeRate - a.onTimeRate || a.totalReworks - b.totalReworks);
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
      let plannedTotalWeight = 0;
      let totalCost = 0;
      let naivePlannedTotal = 0;
      let taskCount = 0;

      pPlots.forEach((p: any) => {
        const pTasks = taskTemplates?.filter((t: any) => t.house_type_id === p.house_type_id) || [];
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

      return {
        name: proj.name,
        actualAvg: Math.round(proj.progress || 0),
        plannedAvg: totalCost > 0 
          ? Math.round(plannedTotalWeight / totalCost) 
          : (taskCount > 0 ? Math.round(naivePlannedTotal / taskCount) : 0),
      };
    });
  }, [projects, plots, taskTemplates, schedules]);

  // 5. Contractor Performance Scorecard
  const contractorPerformance = useMemo(() => {
    if (!contractors || !assignments) return [];
    
    return contractors.map((c: any) => {
      const cAssignments = assignments.filter((a: any) => a.contractor_name === c.name);
      let delayedTasks = 0;
      let totalTasks = 0;
      let totalReworks = 0;
      let defectCount = 0;

      cAssignments.forEach((a: any) => {
        totalTasks++;
        const key = `${a.plot_id}-${a.task_template_id}`;
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

      // Count reworks
      if (allUpdatesRecord) {
        allUpdatesRecord.forEach((upd: any) => {
          if (upd.action && (upd.action.includes('แจ้งแก้ไข') || upd.action.includes('ไม่อนุมัติ'))) {
             const isThisContractor = cAssignments.some((a:any) => String(a.plot_id) === String(upd.plot_id) && String(a.task_template_id) === String(upd.task_template_id));
             if (isThisContractor) totalReworks++;
          }
        });
      }

      // Count defects
      defectCount = defects?.filter((d: any) => {
         return cAssignments.some((a:any) => String(a.plot_id) === String(d.plot_id) && String(a.task_template_id) === String(d.task_id));
      }).length || 0;

      const onTimeRate = totalTasks > 0 ? Math.round(((totalTasks - delayedTasks) / totalTasks) * 100) : 100;

      return {
        name: c.name,
        taskCount: totalTasks,
        onTimeRate,
        totalReworks,
        defectCount
      };
    }).sort((a: any, b: any) => b.onTimeRate - a.onTimeRate || a.totalReworks - b.totalReworks);

  }, [contractors, assignments, schedules, latestUpdatesMap, allUpdatesRecord, defects]);

  return (
    <div className="space-y-6 sm:space-y-8 mt-8">
      <div className="flex items-center gap-3 border-b border-slate-200 pb-4">
        <TrendingUp className="text-blue-600" size={28} />
        <h2 className="text-xl sm:text-3xl font-black text-slate-800 italic uppercase">Deep Analytics <span className="text-slate-400 text-sm sm:text-base font-bold ml-2">สำหรับผู้บริหาร</span></h2>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 1. Project S-Curve (Planned vs Actual) */}
        <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm hover:shadow-md transition-shadow lg:col-span-2">
          <h3 className="font-black text-lg text-slate-800 mb-6 flex items-center gap-2"><Target className="text-indigo-500" /> Planned vs Actual Progress</h3>
          <div className="h-[350px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={projectProgressData} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fontWeight: 700, fill: '#64748b' }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} domain={[0, 100]} tickFormatter={(val) => `${val}%`} />
                <RechartsTooltip 
                  cursor={{ fill: '#f8fafc' }}
                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                  formatter={(value: any) => [`${value}%`, '']}
                />
                <Legend iconType="circle" wrapperStyle={{ paddingTop: '20px', fontSize: '12px', fontWeight: 700 }} />
                <Bar dataKey="plannedAvg" name="แผนงาน (Planned)" fill="#94a3b8" radius={[4, 4, 0, 0]} maxBarSize={60} />
                <Bar dataKey="actualAvg" name="ทำได้จริง (Actual)" fill="#3b82f6" radius={[4, 4, 0, 0]} maxBarSize={60} />
              </BarChart>
            </ResponsiveContainer>
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

        {/* 5. Contractor Scorecard */}
        <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
          <h3 className="font-black text-lg text-slate-800 mb-6 flex items-center gap-2"><Users className="text-indigo-500" /> Contractor Scorecard</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className="p-3 text-xs font-black uppercase text-slate-500">Contractor</th>
                  <th className="p-3 text-xs font-black uppercase text-slate-500 text-center">On-time</th>
                  <th className="p-3 text-xs font-black uppercase text-slate-500 text-center">Reworks</th>
                  <th className="p-3 text-xs font-black uppercase text-slate-500 text-center">Defects</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {contractorPerformance.slice(0, 5).map((c: any, idx: number) => (
                  <tr key={idx} className="hover:bg-slate-50 transition-colors">
                    <td className="p-3 font-bold text-sm text-slate-700 flex items-center gap-2">
                      {idx === 0 && <span className="text-yellow-500 text-lg">👑</span>}
                      {c.name}
                    </td>
                    <td className="p-3 text-center">
                      <span className={`font-black text-xs px-2 py-1 rounded-md ${c.onTimeRate >= 80 ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>{c.onTimeRate}%</span>
                    </td>
                    <td className="p-3 text-center font-bold text-sm text-slate-600">{c.totalReworks}</td>
                    <td className="p-3 text-center font-bold text-sm text-slate-600">{c.defectCount}</td>
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
