import React, { useMemo, useState } from 'react';
import { TrendingUp, AlertTriangle, Target, CheckCircle, Clock, PieChart as PieChartIcon, Calendar, List, X, ShieldAlert } from 'lucide-react';
import { XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line } from 'recharts';

export default function QCPerformanceDashboard({
  plots, taskTemplates, defects, allUpdatesRecord
}: any) {
  const [qcFilterDate, setQcFilterDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [showQCDailyModal, setShowQCDailyModal] = useState(false);

  const qcAnalytics = useMemo(() => {
    if (!defects || !allUpdatesRecord) return null;

    // 1. Defect Leakage Rate
    const constructionDefectsCount = defects.filter((d: any) => d.defect_stage !== 'handover').length;
    const handoverDefectsCount = defects.filter((d: any) => d.defect_stage === 'handover').length;
    const totalDefectsCount = constructionDefectsCount + handoverDefectsCount;
    const leakageRate = totalDefectsCount > 0 ? Math.round((handoverDefectsCount / totalDefectsCount) * 100) : 0;

    const leakageData = [
      { name: 'พบระหว่างสร้าง (QC)', value: constructionDefectsCount, color: '#3b82f6' },
      { name: 'หลุดถึงลูกค้า (Handover)', value: handoverDefectsCount, color: '#f43f5e' }
    ];

    // 2. Turnaround Time (Avg days to resolve defect)
    const resolvedDefects = defects.filter((d: any) => d.status === 'resolved' && d.resolved_at);
    let totalResolveDays = 0;
    resolvedDefects.forEach((d: any) => {
      const start = new Date(d.created_at).getTime();
      const end = new Date(d.resolved_at).getTime();
      totalResolveDays += Math.max(0, (end - start) / (1000 * 60 * 60 * 24));
    });
    const avgTurnaroundTime = resolvedDefects.length > 0 ? (totalResolveDays / resolvedDefects.length).toFixed(1) : '0.0';

    // 3. Rework Rate by QC
    let qcRejectionCount = 0;
    let qcApprovalCount = 0;
    allUpdatesRecord.forEach((upd: any) => {
      if (upd.action === 'QC อนุมัติผ่าน' || upd.action === 'QC อนุมัติ') qcApprovalCount++;
      if (upd.action === 'QC แจ้งแก้ไข') qcRejectionCount++;
    });
    const totalQCReviews = qcApprovalCount + qcRejectionCount;
    const reworkRate = totalQCReviews > 0 ? Math.round((qcRejectionCount / totalQCReviews) * 100) : 0;

    // 4. QC Strictness Index
    const strictnessByMonth: any = {};
    allUpdatesRecord.forEach((upd: any) => {
      if (upd.action && upd.action.includes('QC')) {
        const date = new Date(upd.created_at);
        const monthYear = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        if (!strictnessByMonth[monthYear]) strictnessByMonth[monthYear] = { rejections: 0, total: 0 };
        strictnessByMonth[monthYear].total++;
        if (upd.action === 'QC แจ้งแก้ไข') strictnessByMonth[monthYear].rejections++;
      }
    });

    const strictnessTrend = Object.keys(strictnessByMonth).sort().map(month => {
      const data = strictnessByMonth[month];
      return {
        month,
        strictnessRate: data.total > 0 ? Math.round((data.rejections / data.total) * 100) : 0
      };
    }).slice(-6); // Last 6 months

    // 5. QC Lead Time (Exclude Sundays), Worst Offenders, and Daily Throughput
    const getWorkingHoursDiff = (startTs: number, endTs: number) => {
      let diffMs = 0;
      let curr = new Date(startTs);
      const end = new Date(endTs);
      
      if (curr.toDateString() === end.toDateString()) {
        if (curr.getDay() !== 0) diffMs = end.getTime() - curr.getTime();
        return diffMs / (1000 * 60 * 60);
      }
      
      if (curr.getDay() !== 0) {
        const endOfDay = new Date(curr);
        endOfDay.setHours(23, 59, 59, 999);
        diffMs += endOfDay.getTime() - curr.getTime();
      }
      
      curr.setDate(curr.getDate() + 1);
      curr.setHours(0, 0, 0, 0);
      
      while (curr.toDateString() !== end.toDateString() && curr < end) {
        if (curr.getDay() !== 0) diffMs += 24 * 60 * 60 * 1000;
        curr.setDate(curr.getDate() + 1);
      }
      
      if (end.getDay() !== 0 && curr < end) {
        const startOfDay = new Date(end);
        startOfDay.setHours(0, 0, 0, 0);
        diffMs += end.getTime() - Math.max(startOfDay.getTime(), curr.getTime());
      }
      
      return diffMs / (1000 * 60 * 60);
    };

    const taskInstances: any = {};
    allUpdatesRecord.forEach((upd: any) => {
      const key = `${upd.plot_id}-${upd.task_template_id}`;
      if (!taskInstances[key]) taskInstances[key] = [];
      taskInstances[key].push(upd);
    });

    let totalLeadTimeHours = 0;
    let leadTimeCount = 0;
    const taskStats: any = {}; 

    Object.keys(taskInstances).forEach(key => {
      const updates = taskInstances[key].sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      const taskId = updates[0].task_template_id;
      if (!taskStats[taskId]) taskStats[taskId] = { reworks: 0, leadTimes: [], totalLeadTime: 0 };
      
      let lastSubmitTime: number | null = null;
      
      updates.forEach((u: any) => {
        if (u.progress === 100 && (u.action === 'ส่งงาน 100%' || !u.action?.includes('QC'))) {
          lastSubmitTime = new Date(u.created_at).getTime();
        }
        
        if (u.action && u.action.includes('QC')) {
          if (u.action === 'QC แจ้งแก้ไข') taskStats[taskId].reworks++;
          
          if (lastSubmitTime) {
            const qcTime = new Date(u.created_at).getTime();
            if (qcTime >= lastSubmitTime) {
               const hours = getWorkingHoursDiff(lastSubmitTime, qcTime);
               totalLeadTimeHours += hours;
               leadTimeCount++;
               taskStats[taskId].leadTimes.push(hours);
               taskStats[taskId].totalLeadTime += hours;
            }
            lastSubmitTime = null; 
          }
        }
      });
    });

    const avgQCLeadTimeHours = leadTimeCount > 0 ? (totalLeadTimeHours / leadTimeCount).toFixed(1) : '0.0';

    const worstOffenders = Object.keys(taskStats).map(taskId => {
       const stat = taskStats[taskId];
       const task = taskTemplates?.find((t:any) => String(t.id) === String(taskId));
       const avgLeadTime = stat.leadTimes.length > 0 ? (stat.totalLeadTime / stat.leadTimes.length) : 0;
       return {
         taskName: task ? task.task_name : 'ไม่ระบุ',
         reworks: stat.reworks,
         avgLeadTime: avgLeadTime
       };
    }).filter(t => t.reworks > 0 || t.avgLeadTime > 0)
      .sort((a, b) => (b.reworks * b.avgLeadTime) - (a.reworks * a.avgLeadTime)) 
      .slice(0, 5);

    // Daily QC Throughput
    const passedList: any[] = [];
    const rejectedList: any[] = [];
    
    // Create Date from qcFilterDate (YYYY-MM-DD)
    const [year, month, day] = qcFilterDate.split('-').map(Number);
    const filterDateObj = new Date(year, month - 1, day);
    const filterDateStr = filterDateObj.toDateString();
    
    allUpdatesRecord.forEach((upd: any) => {
       if (new Date(upd.created_at).toDateString() === filterDateStr) {
          const plot = plots?.find((p:any) => String(p.id) === String(upd.plot_id));
          const task = taskTemplates?.find((t:any) => String(t.id) === String(upd.task_template_id));
          const detailObj = {
             plotName: plot ? plot.plot_number : 'ไม่ระบุแปลง',
             taskName: task ? task.task_name : 'ไม่ระบุงาน',
             time: new Date(upd.created_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }),
             action: upd.action
          };

          if (upd.action === 'QC อนุมัติผ่าน' || upd.action === 'QC อนุมัติ') {
             passedList.push(detailObj);
          }
          if (upd.action === 'QC แจ้งแก้ไข') {
             rejectedList.push(detailObj);
          }
       }
    });
    
    const dailyQCTotal = passedList.length + rejectedList.length;

    return {
      leakageRate,
      leakageData,
      avgTurnaroundTime,
      reworkRate,
      strictnessTrend,
      avgQCLeadTimeHours,
      worstOffenders,
      dailyQC: { total: dailyQCTotal, passed: passedList.length, rejected: rejectedList.length, passedList, rejectedList }
    };
  }, [defects, allUpdatesRecord, taskTemplates, qcFilterDate, plots]);

  if (!qcAnalytics) {
     return <div className="p-8 text-center text-slate-500 font-bold">กำลังโหลดข้อมูลประเมินผล QC...</div>;
  }

  return (
    <div className="space-y-6 sm:space-y-8 mt-8">
      <div className="flex items-center gap-3 border-b border-slate-200 pb-4">
        <ShieldAlert className="text-blue-600" size={28} />
        <h2 className="text-xl sm:text-3xl font-black text-slate-800 italic uppercase">QC Performance <span className="text-slate-400 text-sm sm:text-base font-bold ml-2">แดชบอร์ดประเมินผล QC</span></h2>
      </div>

      <div className="space-y-6 animate-in fade-in duration-300">
        {/* Top Row: Daily KPI and Inspection Lead Time */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Daily QC Throughput */}
          <div className="bg-gradient-to-br from-indigo-500 to-purple-600 p-6 rounded-[2rem] border border-indigo-400 shadow-md text-white flex flex-col justify-between">
            <div className="flex justify-between items-start mb-4">
              <div className="flex items-center gap-2 bg-white/20 px-3 py-1.5 rounded-xl backdrop-blur-sm border border-white/30">
                 <Calendar size={16} className="text-indigo-100" />
                 <input 
                   type="date" 
                   value={qcFilterDate}
                   onChange={(e) => setQcFilterDate(e.target.value)}
                   className="bg-transparent text-sm font-bold text-white focus:outline-none"
                   style={{ colorScheme: 'dark' }}
                 />
              </div>
              {qcAnalytics.dailyQC.total > 0 && (
                <button 
                  onClick={() => setShowQCDailyModal(true)}
                  className="flex items-center gap-2 bg-white text-indigo-600 px-3 py-1.5 rounded-xl text-sm font-bold hover:bg-indigo-50 transition-colors shadow-sm"
                >
                  <List size={16} /> ดูรายละเอียด
                </button>
              )}
            </div>
            <div className="flex items-center gap-6">
              <div className="bg-white/20 p-5 rounded-[1.5rem] flex-shrink-0 text-center backdrop-blur-sm border border-white/30">
                <p className="text-5xl font-black">{qcAnalytics.dailyQC.total}</p>
                <p className="text-[10px] font-bold mt-1 uppercase tracking-widest text-indigo-100">Tasks</p>
              </div>
              <div className="flex-1">
                <h3 className="font-black text-xl mb-1 flex items-center gap-2"><Target size={20} /> QC Throughput</h3>
                <p className="text-sm font-medium text-indigo-100 mb-3">สรุปผลการเข้าตรวจงานของ QC ประจำวันที่เลือก</p>
                <div className="flex gap-4">
                   <div className="flex items-center gap-2 bg-emerald-500/30 px-3 py-1.5 rounded-lg border border-emerald-400/50">
                     <CheckCircle size={16} className="text-emerald-300"/>
                     <span className="font-bold text-sm">ผ่าน: {qcAnalytics.dailyQC.passed}</span>
                   </div>
                   <div className="flex items-center gap-2 bg-rose-500/30 px-3 py-1.5 rounded-lg border border-rose-400/50">
                     <AlertTriangle size={16} className="text-rose-300"/>
                     <span className="font-bold text-sm">แก้: {qcAnalytics.dailyQC.rejected}</span>
                   </div>
                </div>
              </div>
            </div>
          </div>

          {/* Inspection Lead Time */}
          <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm flex items-center gap-6 hover:shadow-md transition-shadow">
            <div className="bg-amber-50 p-6 rounded-[1.5rem] border border-amber-100 flex-shrink-0 text-center">
              <p className="text-4xl font-black text-amber-600">{qcAnalytics.avgQCLeadTimeHours}</p>
              <p className="text-[10px] font-bold mt-1 uppercase text-amber-500">Hours / Task</p>
            </div>
            <div className="flex-1">
              <h3 className="font-black text-lg text-slate-800 mb-1 flex items-center gap-2"><Clock className="text-amber-500" /> Avg. Inspection Lead Time</h3>
              <p className="text-sm font-bold text-slate-600 mb-1">ระยะเวลารอ QC เข้าตรวจ</p>
              <p className="text-[10px] text-slate-400 font-medium">ค่าเฉลี่ยตั้งแต่หน้างานกดส่งงาน 100% จนถึง QC เข้าตรวจและบันทึกผล (ไม่นับรวมวันอาทิตย์)</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Worst Offenders */}
          <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm lg:col-span-2 hover:shadow-md transition-shadow">
            <h3 className="font-black text-lg text-slate-800 mb-6 flex items-center gap-2"><AlertTriangle className="text-rose-500" /> QC Bottlenecks Matrix (จุดวิกฤต)</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-slate-50 border-b border-slate-100">
                  <tr>
                    <th className="p-3 text-xs font-black uppercase text-slate-500">Task Name</th>
                    <th className="p-3 text-xs font-black uppercase text-slate-500 text-center">Rework Count</th>
                    <th className="p-3 text-xs font-black uppercase text-slate-500 text-center">Avg Lead Time (Hrs)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {qcAnalytics.worstOffenders.map((task: any, idx: number) => (
                    <tr key={idx} className="hover:bg-slate-50 transition-colors">
                      <td className="p-3 font-bold text-sm text-slate-700 flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center text-xs font-black shrink-0">{idx + 1}</div>
                        <span className="truncate max-w-[200px] sm:max-w-[400px]">{task.taskName}</span>
                      </td>
                      <td className="p-3 text-center">
                        <span className="font-black text-sm text-rose-600">{task.reworks} <span className="text-[10px] text-slate-400 font-medium">ครั้ง</span></span>
                      </td>
                      <td className="p-3 text-center">
                        <span className={`font-black text-sm ${task.avgLeadTime > 24 ? 'text-rose-600' : 'text-slate-600'}`}>{task.avgLeadTime.toFixed(1)} <span className="text-[10px] text-slate-400 font-medium">ชม.</span></span>
                      </td>
                    </tr>
                  ))}
                  {qcAnalytics.worstOffenders.length === 0 && (
                    <tr><td colSpan={3} className="p-6 text-center text-slate-400 font-bold text-sm">ไม่มีข้อมูลปัญหาคอขวด 🎉</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* 1. Defect Leakage Rate */}
          <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
            <h3 className="font-black text-lg text-slate-800 mb-6 flex items-center gap-2">
              <PieChartIcon className="text-purple-500" /> Defect Leakage Rate
            </h3>
            <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
              <div className="w-48 h-48 relative">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={qcAnalytics.leakageData}
                      cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value"
                    >
                      {qcAnalytics.leakageData.map((entry: any, index: number) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <RechartsTooltip />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-2xl font-black text-slate-800">{qcAnalytics.leakageRate}%</span>
                  <span className="text-[10px] font-bold text-slate-400 uppercase">Leakage</span>
                </div>
              </div>
              <div className="flex-1 space-y-4 w-full">
                {qcAnalytics.leakageData.map((d: any, i: number) => (
                  <div key={i} className="bg-slate-50 p-3 rounded-xl border border-slate-100 flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: d.color }}></div>
                      <span className="text-xs font-bold text-slate-600">{d.name}</span>
                    </div>
                    <span className="font-black text-slate-800">{d.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* 2. Rework Rate */}
          <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-center">
            <h3 className="font-black text-lg text-slate-800 mb-6 flex items-center gap-2">
              <AlertTriangle className="text-rose-500" /> Rework Rate by QC
            </h3>
            <div className="flex items-center gap-6">
              <div className="bg-rose-50 p-6 rounded-[2rem] border border-rose-100 flex-shrink-0 text-center">
                <p className="text-4xl font-black text-rose-600">{qcAnalytics.reworkRate}%</p>
                <p className="text-xs font-bold text-rose-400 mt-1 uppercase">Rework Rate</p>
              </div>
              <div className="flex-1">
                <p className="text-sm font-bold text-slate-600 mb-2">อัตราการตีกลับงานเพื่อแก้ไขโดย QC</p>
                <div className="w-full bg-slate-100 h-3 rounded-full overflow-hidden">
                  <div className="bg-rose-500 h-full transition-all duration-1000" style={{ width: `${qcAnalytics.reworkRate}%` }}></div>
                </div>
                <p className="text-[10px] text-slate-400 mt-2 font-medium">
                  อัตราตีกลับสูงแสดงว่าผู้รับเหมาทำงานไม่เรียบร้อยก่อนเรียกตรวจ 
                  อัตราตีกลับต่ำ(0%) อาจหมายถึงการตรวจหละหลวม
                </p>
              </div>
            </div>
          </div>

          {/* 3. Turnaround Time */}
          <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-center">
            <h3 className="font-black text-lg text-slate-800 mb-6 flex items-center gap-2">
              <Clock className="text-emerald-500" /> Defect Turnaround Time
            </h3>
            <div className="flex items-center gap-6">
              <div className="bg-emerald-50 p-6 rounded-[2rem] border border-emerald-100 flex-shrink-0 text-center">
                <p className="text-4xl font-black text-emerald-600">{qcAnalytics.avgTurnaroundTime}</p>
                <p className="text-xs font-bold text-emerald-500 mt-1 uppercase">Days / Defect</p>
              </div>
              <div className="flex-1">
                <p className="text-sm font-bold text-slate-600 mb-2">ความเร็วในการเข้าซ่อมแซม</p>
                <p className="text-xs text-slate-500 leading-relaxed font-medium">
                  ระยะเวลาเฉลี่ยตั้งแต่มีการแจ้งซ่อม (Defect) จนถึงการแก้ไขเสร็จสิ้น 
                  ควรควบคุมให้อยู่ภายใน <span className="font-bold text-slate-800">3-5 วัน</span> เพื่อไม่ให้กระทบแผนงานหลัก
                </p>
              </div>
            </div>
          </div>

          {/* 4. QC Strictness Trend */}
          <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
            <h3 className="font-black text-lg text-slate-800 mb-6 flex items-center gap-2">
              <TrendingUp className="text-amber-500" /> QC Strictness Trend
            </h3>
            <div className="h-[200px] w-full">
              {qcAnalytics.strictnessTrend.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={qcAnalytics.strictnessTrend}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#64748b', fontWeight: 'bold' }} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#64748b' }} domain={[0, 100]} tickFormatter={(val) => `${val}%`} />
                    <RechartsTooltip 
                      cursor={{ stroke: '#cbd5e1', strokeWidth: 1, strokeDasharray: '3 3' }}
                      contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                    />
                    <Line type="monotone" dataKey="strictnessRate" stroke="#f59e0b" strokeWidth={3} dot={{ r: 4, strokeWidth: 2, fill: '#fff' }} activeDot={{ r: 6 }} name="Strictness (%)" />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                 <div className="h-full flex items-center justify-center text-slate-400 font-bold text-sm">
                   ยังไม่มีข้อมูลย้อนหลังเพียงพอ
                 </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Daily QC Modal */}
      {showQCDailyModal && qcAnalytics && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 animate-in fade-in duration-200">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setShowQCDailyModal(false)}></div>
          <div className="relative w-full max-w-2xl bg-white rounded-3xl shadow-2xl flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between p-6 border-b border-slate-100">
              <div>
                <h2 className="text-xl font-black text-slate-800 flex items-center gap-2">
                  <List className="text-indigo-500" /> รายละเอียดการตรวจงาน QC
                </h2>
                <p className="text-sm font-bold text-slate-500 mt-1">ประจำวันที่ {new Date(qcFilterDate).toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
              </div>
              <button onClick={() => setShowQCDailyModal(false)} className="w-10 h-10 bg-slate-100 text-slate-500 rounded-full flex items-center justify-center hover:bg-slate-200 transition-colors">
                <X size={20} />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto space-y-8 flex-1">
              {/* Passed List */}
              <div>
                <h3 className="text-sm font-black text-emerald-600 mb-4 flex items-center gap-2 uppercase tracking-wide">
                  <CheckCircle size={18} /> งานที่ตรวจผ่าน ({qcAnalytics.dailyQC.passedList.length})
                </h3>
                {qcAnalytics.dailyQC.passedList.length > 0 ? (
                  <div className="space-y-3">
                    {qcAnalytics.dailyQC.passedList.map((item: any, idx: number) => (
                      <div key={idx} className="bg-emerald-50 border border-emerald-100 p-4 rounded-2xl flex justify-between items-center">
                        <div>
                          <p className="font-bold text-slate-800">{item.taskName}</p>
                          <p className="text-xs font-bold text-emerald-600 mt-0.5">แปลงบ้าน: {item.plotName}</p>
                        </div>
                        <div className="text-right">
                           <span className="text-xs font-bold bg-white text-emerald-700 px-2 py-1 rounded-lg border border-emerald-200 shadow-sm">{item.time}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-6 bg-slate-50 rounded-2xl border border-slate-100 text-slate-400 font-bold text-sm">ไม่มีงานที่ผ่านในวันที่เลือก</div>
                )}
              </div>

              {/* Rejected List */}
              <div>
                <h3 className="text-sm font-black text-rose-600 mb-4 flex items-center gap-2 uppercase tracking-wide">
                  <AlertTriangle size={18} /> งานที่แจ้งแก้ไข ({qcAnalytics.dailyQC.rejectedList.length})
                </h3>
                {qcAnalytics.dailyQC.rejectedList.length > 0 ? (
                  <div className="space-y-3">
                    {qcAnalytics.dailyQC.rejectedList.map((item: any, idx: number) => (
                      <div key={idx} className="bg-rose-50 border border-rose-100 p-4 rounded-2xl flex justify-between items-center">
                        <div>
                          <p className="font-bold text-slate-800">{item.taskName}</p>
                          <p className="text-xs font-bold text-rose-600 mt-0.5">แปลงบ้าน: {item.plotName}</p>
                        </div>
                        <div className="text-right">
                           <span className="text-xs font-bold bg-white text-rose-700 px-2 py-1 rounded-lg border border-rose-200 shadow-sm">{item.time}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-6 bg-slate-50 rounded-2xl border border-slate-100 text-slate-400 font-bold text-sm">ไม่มีงานที่ต้องแก้ไขในวันที่เลือก 🎉</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
