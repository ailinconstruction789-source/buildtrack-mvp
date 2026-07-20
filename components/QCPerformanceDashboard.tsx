import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { TrendingUp, AlertTriangle, Target, CheckCircle, Clock, PieChart as PieChartIcon, Calendar, List, X, ShieldAlert, Printer, ChevronLeft, ChevronRight, Filter } from 'lucide-react';
import { XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, BarChart, Bar, Legend } from 'recharts';

export default function QCPerformanceDashboard({
  plots, taskTemplates, defects, allUpdatesRecord, assignments, isAdmin, isOwner, inspectionQueue
}: any) {
  const [qcFilterDate, setQcFilterDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [showQCDailyModal, setShowQCDailyModal] = useState(false);
  const [groupBy, setGroupBy] = useState<'time' | 'contractor' | 'plot'>('time');
  const [lightbox, setLightbox] = useState<{isOpen: boolean, images: string[], currentIndex: number}>({ isOpen: false, images: [], currentIndex: 0 });
  const [valueChartRange, setValueChartRange] = useState<number>(14);
  const [suspectPage, setSuspectPage] = useState(1);

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

    // 4. QC Strictness Index (Last 7 Days)
    const strictnessByDay: any = {};
    const todayForStrictness = new Date();
    // Initialize the last 7 days with 0
    for (let i = 6; i >= 0; i--) {
      const d = new Date(todayForStrictness);
      d.setDate(d.getDate() - i);
      const dateStr = d.toLocaleDateString('en-CA'); // YYYY-MM-DD
      strictnessByDay[dateStr] = { rejections: 0, total: 0 };
    }

    allUpdatesRecord.forEach((upd: any) => {
      if (upd.action && upd.action.includes('QC')) {
        const dateStr = new Date(upd.created_at).toLocaleDateString('en-CA');
        if (strictnessByDay[dateStr]) {
          strictnessByDay[dateStr].total++;
          if (upd.action === 'QC แจ้งแก้ไข') strictnessByDay[dateStr].rejections++;
        }
      }
    });

    const strictnessTrend = Object.keys(strictnessByDay).sort().map(dateStr => {
      const data = strictnessByDay[dateStr];
      // Convert 'YYYY-MM-DD' to 'DD/MM' for display
      const displayDate = dateStr.split('-').slice(1).reverse().join('/');
      return {
        month: displayDate, // Keep the key name 'month' so we don't break the LineChart config below
        strictnessRate: data.total > 0 ? Math.round((data.rejections / data.total) * 100) : 0
      };
    });

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
          if (upd.action === 'QC อนุมัติผ่าน' || upd.action === 'QC อนุมัติ' || upd.action === 'QC แจ้งแก้ไข') {
             const plot = plots?.find((p:any) => String(p.id) === String(upd.plot_id));
             const task = taskTemplates?.find((t:any) => String(t.id) === String(upd.task_template_id));
             const assign = assignments?.find((a:any) => String(a.plot_id) === String(upd.plot_id) && String(a.task_template_id) === String(upd.task_template_id));
             const foremanName = plot?.foreman || 'ไม่ระบุ';
             const contractorName = assign?.contractor_name || 'ไม่ระบุ';
             
             // Find previous SE submit
             const taskUpdates = allUpdatesRecord.filter((u:any) => 
               String(u.plot_id) === String(upd.plot_id) && 
               String(u.task_template_id) === String(upd.task_template_id) &&
               new Date(u.created_at) < new Date(upd.created_at) &&
               u.progress === 100 && (u.action === 'ส่งงาน 100%' || !u.action?.includes('QC'))
             ).sort((a:any, b:any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
             
             const seSubmitTime = taskUpdates.length > 0 
               ? new Date(taskUpdates[0].created_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })
               : '-';
             const seSubmitDate = taskUpdates.length > 0 
               ? new Date(taskUpdates[0].created_at).toLocaleDateString('th-TH', { day: '2-digit', month: 'short' })
               : '';
             const seSubmitFullStr = taskUpdates.length > 0 ? `${seSubmitDate} ${seSubmitTime}` : '-';
             const qcTimeFullStr = `${new Date(upd.created_at).toLocaleDateString('th-TH', { day: '2-digit', month: 'short' })} ${new Date(upd.created_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}`;

             const detailObj = {
                plotName: plot ? (plot.plot_name || plot.id) : 'ไม่ระบุแปลง',
                taskName: task ? task.task_name : 'ไม่ระบุงาน',
                time: new Date(upd.created_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }),
                qcTimeFullStr: qcTimeFullStr,
                seSubmitFullStr: seSubmitFullStr,
                action: upd.action,
                textContent: upd.text_content || '',
                imageUrl: upd.image_url || '',
                foremanName: foremanName,
                contractorName: contractorName
             };

             if (upd.action === 'QC อนุมัติผ่าน' || upd.action === 'QC อนุมัติ') {
                passedList.push(detailObj);
             }
             if (upd.action === 'QC แจ้งแก้ไข') {
                rejectedList.push(detailObj);
             }
          }
       }
    });
    
    const dailyQCTotal = passedList.length + rejectedList.length;

    // 6. Daily QC Value & Workload Trend (Last X days)
    const dailyValueMap: any = {};
    const today = new Date();
    for (let i = valueChartRange - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateStr = d.toLocaleDateString('en-CA');
      dailyValueMap[dateStr] = { date: dateStr, value: 0, count: 0, seSubmitCount: 0, qcInspectCount: 0, qcRejectCount: 0 };
    }

    allUpdatesRecord.forEach((upd: any) => {
      const d = new Date(upd.created_at);
      const dateStr = d.toLocaleDateString('en-CA');
      
      if (dailyValueMap[dateStr]) {
        // Workload Metrics
        if (upd.progress === 100 && (upd.action === 'ส่งงาน 100%' || !upd.action?.includes('QC'))) {
          dailyValueMap[dateStr].seSubmitCount += 1;
        }
        if (upd.action === 'QC อนุมัติผ่าน' || upd.action === 'QC อนุมัติ' || upd.action === 'QC แจ้งแก้ไข') {
          dailyValueMap[dateStr].qcInspectCount += 1;
          if (upd.action === 'QC แจ้งแก้ไข') {
            dailyValueMap[dateStr].qcRejectCount += 1;
          }
        }

        // Value Metrics (Only Passed Tasks)
        if (upd.action === 'QC อนุมัติผ่าน' || upd.action === 'QC อนุมัติ') {
          const task = taskTemplates?.find((t: any) => String(t.id) === String(upd.task_template_id));
          const cost = task?.cost || 0;
          dailyValueMap[dateStr].value += cost;
          dailyValueMap[dateStr].count += 1;
        }
      }
    });
    
    const dailyValueTrend = Object.values(dailyValueMap);

    // 6.5. Today's Activities List
    const targetDateStr = qcFilterDate;
    const todayActivities: any[] = [];
    allUpdatesRecord.forEach((upd: any) => {
      const d = new Date(upd.created_at);
      const dateStr = d.toLocaleDateString('en-CA');
      if (dateStr === targetDateStr) {
        if (upd.progress === 100 && (upd.action === 'ส่งงาน 100%' || !upd.action?.includes('QC'))) {
          todayActivities.push({ type: 'se', action: upd.action, plot_id: upd.plot_id, task_template_id: upd.task_template_id, time: d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) });
        }
        if (upd.action === 'QC อนุมัติผ่าน' || upd.action === 'QC อนุมัติ' || upd.action === 'QC แจ้งแก้ไข') {
          todayActivities.push({ type: 'qc', action: upd.action, plot_id: upd.plot_id, task_template_id: upd.task_template_id, time: d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) });
        }
      }
    });

    todayActivities.forEach(act => {
       const plot = plots?.find((p:any) => String(p.id) === String(act.plot_id));
       const task = taskTemplates?.find((t:any) => String(t.id) === String(act.task_template_id));
       act.plotName = plot?.plot_name || plot?.id || 'ไม่ระบุแปลง';
       act.taskName = task?.task_name || 'ไม่ระบุงาน';
    });

    // 7. Pending Value and Tier Breakdown
    let pendingValue = 0;
    const tierBreakdown = { A: { count: 0, value: 0 }, B: { count: 0, value: 0 }, C: { count: 0, value: 0 } };
    
    (inspectionQueue || []).forEach((q: any) => {
      if (q.statusFor === 'QC') {
         const task = taskTemplates?.find((t: any) => String(t.id) === String(q.task_template_id));
         const cost = task?.cost || 0;
         pendingValue += cost;
         
         if (cost >= 50000) {
            tierBreakdown.A.count++;
            tierBreakdown.A.value += cost;
         } else if (cost >= 10000) {
            tierBreakdown.B.count++;
            tierBreakdown.B.value += cost;
         } else {
            tierBreakdown.C.count++;
            tierBreakdown.C.value += cost;
         }
      }
    });

    // 8. Suspect Approvals (Fast-Track)
    const suspectApprovals: any[] = [];
    const SUSPECT_MINUTES = 10; // Threshold

    const groupedUpdates: Record<string, any[]> = {};
    allUpdatesRecord.forEach((upd: any) => {
      const key = `${upd.plot_id}_${upd.task_template_id}`;
      if (!groupedUpdates[key]) groupedUpdates[key] = [];
      groupedUpdates[key].push(upd);
    });

    Object.values(groupedUpdates).forEach(updates => {
      for (let i = 0; i < updates.length - 1; i++) {
        const upd = updates[i];
        if (upd.action === 'QC อนุมัติผ่าน' || upd.action === 'QC อนุมัติ') {
           const seSubmit = updates.slice(i + 1).find(u => u.progress === 100 && (u.action === 'ส่งงาน 100%' || !u.action?.includes('QC')));
           if (seSubmit) {
             const qcTime = new Date(upd.created_at).getTime();
             const seTime = new Date(seSubmit.created_at).getTime();
             const diffMinutes = (qcTime - seTime) / (1000 * 60);
             if (diffMinutes >= 0 && diffMinutes <= SUSPECT_MINUTES) {
               const plot = plots?.find((p:any) => String(p.id) === String(upd.plot_id));
               const task = taskTemplates?.find((t:any) => String(t.id) === String(upd.task_template_id));
               suspectApprovals.push({
                 id: upd.id,
                 plotName: plot ? (plot.plot_name || plot.id) : 'ไม่ระบุแปลง',
                 taskName: task ? task.task_name : 'ไม่ระบุงาน',
                 qcAction: upd.action,
                 qcTimeFullStr: new Date(upd.created_at).toLocaleString('th-TH', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' }),
                 seTimeFullStr: new Date(seSubmit.created_at).toLocaleString('th-TH', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' }),
                 diffMinutes: Math.round(diffMinutes),
                 imageUrl: upd.image_url,
                 hasNoImage: !upd.image_url
               });
             }
           }
        }
      }
    });

    return {
      leakageRate,
      leakageData,
      avgTurnaroundTime,
      reworkRate,
      strictnessTrend,
      avgQCLeadTimeHours,
      worstOffenders,
      dailyQC: {
        total: dailyQCTotal,
        passed: passedList.length,
        rejected: rejectedList.length,
        passedList,
        rejectedList
      },
      dailyValueTrend,
      pendingValue,
      tierBreakdown,
      suspectApprovals,
      todayActivities
    };
  }, [defects, allUpdatesRecord, taskTemplates, plots, qcFilterDate, assignments, valueChartRange, inspectionQueue]);

  const groupedDailyQC = useMemo(() => {
    if (!qcAnalytics) return null;
    
    const allTasks = [
      ...qcAnalytics.dailyQC.passedList.map((t: any) => ({ ...t, status: 'passed' })),
      ...qcAnalytics.dailyQC.rejectedList.map((t: any) => ({ ...t, status: 'rejected' }))
    ];

    if (groupBy === 'time') return null; // traditional rendering

    const groups: Record<string, any[]> = {};
    allTasks.forEach(task => {
      let key = 'ไม่ระบุ';
      if (groupBy === 'contractor') key = task.contractorName;
      if (groupBy === 'plot') key = task.plotName;
      
      if (!groups[key]) groups[key] = [];
      groups[key].push(task);
    });

    return groups;
  }, [qcAnalytics, groupBy]);

  const handleImageClick = (imageString: string, index: number = 0) => {
    const images = imageString.split(',').map(s => s.trim()).filter(Boolean);
    if (images.length > 0) {
      setLightbox({ isOpen: true, images, currentIndex: index });
    }
  };

  if (!qcAnalytics) {
     return <div className="p-8 text-center text-slate-500 font-bold">กำลังโหลดข้อมูลประเมินผล QC...</div>;
  }

  return (
    <div className="space-y-6 sm:space-y-8 mt-8">
      <div className="flex items-center gap-3 border-b border-slate-200 pb-4">
        <ShieldAlert className="text-blue-600" size={28} />
        <h2 className="text-xl sm:text-3xl font-black text-slate-800 italic uppercase">QC Performance <span className="text-slate-400 text-sm sm:text-base font-bold ml-2">แดชบอร์ดประเมินผล QC</span></h2>
      </div>

      {/* 👑 Owner/Admin Exclusive: Value & Tier Analytics */}
      {(isAdmin || isOwner) && (
        <div className="space-y-6 animate-in fade-in duration-500">
          <div className="flex items-center justify-between">
            <h3 className="font-black text-xl text-slate-800 flex items-center gap-2"><TrendingUp className="text-emerald-500" /> Executive QC Value (ประเมินมูลค่า)</h3>
            <select 
              value={valueChartRange} 
              onChange={(e) => setValueChartRange(Number(e.target.value))}
              className="bg-white border border-slate-200 rounded-xl px-4 py-2 text-sm font-bold text-slate-700 focus:outline-none focus:border-blue-500 shadow-sm"
            >
              <option value={7}>ย้อนหลัง 7 วัน</option>
              <option value={14}>ย้อนหลัง 14 วัน</option>
              <option value={30}>ย้อนหลัง 30 วัน</option>
            </select>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Charts Column */}
            <div className="lg:col-span-2 flex flex-col gap-6">
              {/* Daily Inspected Value Chart */}
              <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm hover:shadow-md transition-shadow flex-1">
                <h4 className="font-bold text-slate-600 mb-4 text-sm flex justify-between items-center">
                  <span>มูลค่างานที่ตรวจผ่านรายวัน (บาท)</span>
                </h4>
                <div className="h-48 sm:h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={qcAnalytics.dailyValueTrend} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis dataKey="date" tick={{fontSize: 10, fill: '#64748b'}} tickFormatter={(val) => val.split('-').slice(1).join('/')} axisLine={false} tickLine={false} />
                      <YAxis tick={{fontSize: 10, fill: '#64748b'}} tickFormatter={(val) => (val / 1000) + 'k'} axisLine={false} tickLine={false} />
                      <RechartsTooltip 
                        cursor={{fill: '#f8fafc'}}
                        content={({ active, payload }) => {
                          if (active && payload && payload.length) {
                            const data = payload[0].payload;
                            return (
                              <div className="bg-slate-800 text-white p-3 rounded-xl shadow-xl border border-slate-700 text-xs z-50">
                                <p className="font-bold mb-1">{data.date}</p>
                                <p className="text-emerald-400 font-black text-sm">{data.value.toLocaleString()} บาท</p>
                                <p className="text-slate-300">จำนวน: {data.count} งาน</p>
                              </div>
                            );
                          }
                          return null;
                        }}
                      />
                      <Bar dataKey="value" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={40} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Workload Comparison Chart */}
              <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm hover:shadow-md transition-shadow flex-1">
                <h4 className="font-bold text-slate-600 mb-4 text-sm flex items-center gap-2">
                  <span>เปรียบเทียบภาระงาน (SE ส่งงาน vs QC ตรวจงาน)</span>
                </h4>
                <div className="h-48 sm:h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={qcAnalytics.dailyValueTrend} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis dataKey="date" tick={{fontSize: 10, fill: '#64748b'}} tickFormatter={(val) => val.split('-').slice(1).join('/')} axisLine={false} tickLine={false} />
                      <YAxis tick={{fontSize: 10, fill: '#64748b'}} axisLine={false} tickLine={false} />
                      <RechartsTooltip 
                        cursor={{fill: '#f8fafc'}}
                        content={({ active, payload }) => {
                          if (active && payload && payload.length >= 2) {
                            const data = payload[0].payload;
                            return (
                              <div className="bg-slate-800 text-white p-3 rounded-xl shadow-xl border border-slate-700 text-xs z-50">
                                <p className="font-bold mb-1">{data.date}</p>
                                <div className="flex items-center gap-2 mb-1">
                                  <div className="w-2 h-2 rounded-full bg-blue-400"></div>
                                  <span className="text-slate-300">SE ส่ง:</span>
                                  <span className="font-bold text-blue-400">{data.seSubmitCount}</span>
                                </div>
                                <div className="flex items-center gap-2 mb-1">
                                  <div className="w-2 h-2 rounded-full bg-emerald-400"></div>
                                  <span className="text-slate-300">QC ตรวจ:</span>
                                  <span className="font-bold text-emerald-400">{data.qcInspectCount}</span>
                                </div>
                                {data.qcRejectCount > 0 && (
                                  <div className="flex items-center gap-2 pl-4">
                                    <div className="w-1.5 h-1.5 rounded-full bg-rose-400"></div>
                                    <span className="text-slate-400 text-[10px]">ตีกลับ:</span>
                                    <span className="font-bold text-rose-400 text-[10px]">{data.qcRejectCount}</span>
                                  </div>
                                )}
                              </div>
                            );
                          }
                          return null;
                        }}
                      />
                      <Bar dataKey="seSubmitCount" name="SE ส่งงาน" fill="#3b82f6" radius={[4, 4, 0, 0]} maxBarSize={30} />
                      <Bar dataKey="qcInspectCount" name="QC ตรวจงาน" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={30} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                {/* Today's Activities Summary */}
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 mt-6">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4 border-b border-slate-200 pb-3">
                    <h5 className="font-bold text-slate-700 text-sm flex items-center gap-2">
                      <Calendar size={16} className="text-blue-500" /> สรุปงานประจำวันที่
                    </h5>
                    <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-xl border border-slate-300 shadow-sm">
                       <input 
                         type="date" 
                         value={qcFilterDate}
                         onChange={(e) => setQcFilterDate(e.target.value)}
                         className="bg-transparent text-sm font-bold text-slate-700 focus:outline-none"
                       />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <h6 className="text-xs font-bold text-blue-600 mb-2 border-b border-blue-200 pb-1">SE ส่งงาน ({qcAnalytics.todayActivities.filter((a: any) => a.type === 'se').length} รายการ)</h6>
                      <ul className="space-y-2 max-h-32 overflow-y-auto pr-2 custom-scrollbar">
                        {qcAnalytics.todayActivities.filter((a: any) => a.type === 'se').length === 0 ? <li className="text-xs text-slate-400 italic">ไม่มีข้อมูลในวันที่เลือก</li> : 
                         qcAnalytics.todayActivities.filter((a: any) => a.type === 'se').map((act: any, i: number) => (
                          <li key={i} className="text-xs text-slate-600 flex justify-between items-start gap-2">
                            <span className="truncate flex-1" title={`${act.plotName} - ${act.taskName}`}>🏠 {act.plotName} - {act.taskName}</span>
                            <span className="text-slate-400 whitespace-nowrap bg-white px-1.5 py-0.5 rounded-md border border-slate-200 text-[10px]">{act.time} น.</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <h6 className="text-xs font-bold text-emerald-600 mb-2 border-b border-emerald-200 pb-1">QC ตรวจงาน ({qcAnalytics.todayActivities.filter((a: any) => a.type === 'qc').length} รายการ)</h6>
                      <ul className="space-y-2 max-h-32 overflow-y-auto pr-2 custom-scrollbar">
                        {qcAnalytics.todayActivities.filter((a: any) => a.type === 'qc').length === 0 ? <li className="text-xs text-slate-400 italic">ไม่มีข้อมูลในวันที่เลือก</li> : 
                         qcAnalytics.todayActivities.filter((a: any) => a.type === 'qc').map((act: any, i: number) => (
                          <li key={i} className="text-xs text-slate-600 flex justify-between items-start gap-2">
                            <span className="truncate flex-1" title={`${act.plotName} - ${act.taskName}`}>
                              {act.action === 'QC แจ้งแก้ไข' ? '❌' : '✅'} {act.plotName} - {act.taskName}
                            </span>
                            <span className="text-slate-400 whitespace-nowrap bg-white px-1.5 py-0.5 rounded-md border border-slate-200 text-[10px]">{act.time} น.</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>

              </div>
            </div>

            {/* Pending Value & Tier Breakdown */}
            <div className="bg-gradient-to-br from-amber-50 to-orange-50 p-6 rounded-[2rem] border border-amber-200 shadow-sm flex flex-col hover:shadow-md transition-shadow">
              <div className="flex items-center gap-2 mb-4">
                <AlertTriangle className="text-amber-500" size={20} />
                <h4 className="font-bold text-amber-800 text-sm">เงินจมในคิวตรวจ (Pending Value)</h4>
              </div>
              <div className="flex-1 flex flex-col justify-center items-center mb-6">
                <p className="text-4xl font-black text-amber-600 mb-1">{qcAnalytics.pendingValue.toLocaleString()}</p>
                <p className="text-xs font-bold text-amber-500 uppercase">บาท</p>
              </div>
              <div className="space-y-3 bg-white/60 p-4 rounded-xl border border-amber-100">
                <p className="text-xs font-bold text-slate-500 mb-2 border-b border-amber-100 pb-2">ค้างตรวจแยกตามระดับ (Tier)</p>
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-rose-600">Tier A ({'>'}50k)</span>
                  <span className="text-xs font-black text-slate-700">{qcAnalytics.tierBreakdown.A.count} งาน <span className="text-slate-400 font-medium whitespace-nowrap">({qcAnalytics.tierBreakdown.A.value.toLocaleString()} ฿)</span></span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-amber-600">Tier B (10k-50k)</span>
                  <span className="text-xs font-black text-slate-700">{qcAnalytics.tierBreakdown.B.count} งาน <span className="text-slate-400 font-medium whitespace-nowrap">({qcAnalytics.tierBreakdown.B.value.toLocaleString()} ฿)</span></span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-emerald-600">Tier C ({'<'}10k)</span>
                  <span className="text-xs font-black text-slate-700">{qcAnalytics.tierBreakdown.C.count} งาน <span className="text-slate-400 font-medium whitespace-nowrap">({qcAnalytics.tierBreakdown.C.value.toLocaleString()} ฿)</span></span>
                </div>
              </div>
            </div>
          </div>

          {/* Suspect Approvals (Fast-Track) Section */}
          {qcAnalytics.suspectApprovals && qcAnalytics.suspectApprovals.length > 0 && (
            <div className="bg-rose-50 p-6 rounded-[2rem] border border-rose-200 shadow-sm">
              <div className="flex items-center gap-2 mb-4">
                <ShieldAlert className="text-rose-600" size={24} />
                <h4 className="font-black text-rose-800 text-lg">รายการเฝ้าระวัง: อนุมัติไวผิดปกติ (Suspect Approvals)</h4>
                <span className="bg-rose-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">{qcAnalytics.suspectApprovals.length} รายการ</span>
              </div>
              <p className="text-xs text-rose-600/80 font-bold mb-4">
                * รายการที่ QC กดอนุมัติผ่านภายใน 10 นาทีหลังจากผู้รับเหมา/SE ส่งงาน (หรือไม่มีการแนบรูปภาพใหม่) ควรตรวจสอบความถูกต้องของหน้างานจริง
              </p>
              
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-rose-200 text-xs text-rose-800">
                      <th className="py-2 px-3 font-bold">เวลาที่ SE ส่ง</th>
                      <th className="py-2 px-3 font-bold">เวลา QC ตรวจ</th>
                      <th className="py-2 px-3 font-bold">แปลง</th>
                      <th className="py-2 px-3 font-bold">ชื่องาน</th>
                      <th className="py-2 px-3 font-bold">เวลาที่ใช้ตรวจ</th>
                      <th className="py-2 px-3 font-bold">รูปถ่ายแนบ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {qcAnalytics.suspectApprovals.slice((suspectPage - 1) * 10, suspectPage * 10).map((suspect: any, idx: number) => (
                      <tr key={`${suspect.id}-${idx}`} className="border-b border-rose-100 last:border-0 text-xs bg-white/40 hover:bg-white/80 transition-colors">
                        <td className="py-2 px-3 text-slate-500 font-medium">{suspect.seTimeFullStr}</td>
                        <td className="py-2 px-3 text-slate-700 font-bold">{suspect.qcTimeFullStr}</td>
                        <td className="py-2 px-3 text-slate-700">{suspect.plotName}</td>
                        <td className="py-2 px-3 text-slate-700">{suspect.taskName}</td>
                        <td className="py-2 px-3">
                          <span className="bg-rose-100 text-rose-700 px-2 py-1 rounded font-bold">{suspect.diffMinutes} นาที</span>
                        </td>
                        <td className="py-2 px-3">
                          {suspect.hasNoImage ? (
                            <span className="text-rose-600 font-bold text-[10px] bg-rose-50 px-2 py-0.5 rounded border border-rose-200">❌ ไม่มีรูป</span>
                          ) : (
                            <span className="text-emerald-600 font-bold text-[10px] bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">✅ มีรูป</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {qcAnalytics.suspectApprovals.length > 10 && (
                  <div className="flex justify-center items-center gap-4 mt-4">
                    <button 
                      onClick={() => setSuspectPage(prev => Math.max(1, prev - 1))}
                      disabled={suspectPage === 1}
                      className="px-3 py-1 bg-white border border-rose-200 text-rose-600 rounded-lg text-xs font-bold disabled:opacity-50 disabled:cursor-not-allowed hover:bg-rose-50 transition-colors flex items-center gap-1"
                    >
                      <ChevronLeft size={14} /> หน้าก่อนหน้า
                    </button>
                    <span className="text-xs font-bold text-rose-800">
                      หน้า {suspectPage} จาก {Math.ceil(qcAnalytics.suspectApprovals.length / 10)}
                    </span>
                    <button 
                      onClick={() => setSuspectPage(prev => Math.min(Math.ceil(qcAnalytics.suspectApprovals.length / 10), prev + 1))}
                      disabled={suspectPage === Math.ceil(qcAnalytics.suspectApprovals.length / 10)}
                      className="px-3 py-1 bg-white border border-rose-200 text-rose-600 rounded-lg text-xs font-bold disabled:opacity-50 disabled:cursor-not-allowed hover:bg-rose-50 transition-colors flex items-center gap-1"
                    >
                      หน้าถัดไป <ChevronRight size={14} />
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

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
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 sm:p-6 animate-in fade-in duration-200 print:hidden">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setShowQCDailyModal(false)}></div>
          <div className="relative w-full max-w-2xl bg-white rounded-3xl shadow-2xl flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between p-6 border-b border-slate-100">
              <div>
                <h2 className="text-xl font-black text-slate-800 flex items-center gap-2">
                  <List className="text-indigo-500" /> รายละเอียดการตรวจงาน QC
                </h2>
                <p className="text-sm font-bold text-slate-500 mt-1">ประจำวันที่ {new Date(qcFilterDate).toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
              </div>
              <div className="flex gap-2">
                <div className="hidden sm:flex items-center bg-slate-100 rounded-xl p-1 border border-slate-200">
                  <button onClick={() => setGroupBy('time')} className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors ${groupBy === 'time' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>เวลา</button>
                  <button onClick={() => setGroupBy('contractor')} className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors ${groupBy === 'contractor' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>ช่างรับเหมา</button>
                  <button onClick={() => setGroupBy('plot')} className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors ${groupBy === 'plot' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>แปลงบ้าน</button>
                </div>
                <button onClick={() => {
                  const originalTitle = document.title;
                  const formattedDate = new Date(qcFilterDate).toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });
                  document.title = `รายการตรวจQC_${formattedDate}`;
                  setTimeout(() => {
                    window.print();
                    document.title = originalTitle;
                  }, 100);
                }} className="h-10 px-4 bg-indigo-600 text-white font-black rounded-xl hover:bg-indigo-700 transition-colors shadow-md flex items-center justify-center gap-2 text-sm">
                  <Printer size={16} /> Export PDF
                </button>
                <button onClick={() => setShowQCDailyModal(false)} className="w-10 h-10 bg-slate-100 text-slate-500 rounded-full flex items-center justify-center hover:bg-slate-200 transition-colors">
                  <X size={20} />
                </button>
              </div>
            </div>
            
            <div className="p-6 overflow-y-auto space-y-8 flex-1">
              {groupBy === 'time' ? (
                <>
                  {/* Passed List */}
                  <div>
                    <h3 className="text-sm font-black text-emerald-600 mb-4 flex items-center gap-2 uppercase tracking-wide">
                      <CheckCircle size={18} /> งานที่ตรวจผ่าน ({qcAnalytics.dailyQC.passedList.length})
                    </h3>
                    {qcAnalytics.dailyQC.passedList.length > 0 ? (
                      <div className="space-y-3">
                        {qcAnalytics.dailyQC.passedList.map((item: any, idx: number) => (
                          <div key={idx} className="bg-emerald-50 border border-emerald-100 p-4 rounded-2xl flex flex-col gap-3">
                            <div className="flex justify-between items-start">
                              <div className="flex items-start gap-3">
                                <div className="w-10 h-10 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center shrink-0 mt-0.5">
                                  <CheckCircle size={20} />
                                </div>
                                <div>
                                  <p className="font-bold text-sm text-slate-800">{item.taskName}</p>
                                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                    <p className="text-xs font-bold text-emerald-600">แปลงบ้าน: {item.plotName}</p>
                                    <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">โฟร์แมน: {item.foremanName}</span>
                                    <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">ช่าง: {item.contractorName}</span>
                                  </div>
                                  {item.textContent && <p className="text-xs text-slate-600 mt-2 bg-white/60 p-2 rounded-lg border border-emerald-100/50">💬 {item.textContent}</p>}
                                </div>
                              </div>
                              <div className="flex flex-col gap-1 shrink-0 text-right">
                                {item.seSubmitFullStr !== '-' && (
                                  <div className="text-[10px] font-bold bg-slate-100 text-slate-500 px-2 py-0.5 rounded-md self-end whitespace-nowrap">
                                    SE ส่ง: {item.seSubmitFullStr}
                                  </div>
                                )}
                                <div className="text-xs font-bold bg-emerald-200/50 text-emerald-700 px-2 py-1 rounded-md self-end whitespace-nowrap">QC ตรวจผ่าน: {item.time}</div>
                              </div>
                            </div>
                            {item.imageUrl && (
                              <div className="flex gap-2 mt-1 overflow-x-auto custom-scrollbar pb-1">
                                {item.imageUrl.split(',').map((imgUrl: string, imgIdx: number) => (
                                  <img key={imgIdx} src={imgUrl.trim()} alt="QC Image" onClick={() => handleImageClick(item.imageUrl, imgIdx)} className="h-16 w-16 object-cover rounded-lg border border-emerald-200 shadow-sm cursor-pointer hover:opacity-80 transition-opacity" />
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-6 text-slate-400 font-medium bg-slate-50 rounded-2xl border border-slate-100 border-dashed">ไม่มีงานที่ผ่านในวันนี้</div>
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
                          <div key={idx} className="bg-rose-50 border border-rose-100 p-4 rounded-2xl flex flex-col gap-3">
                            <div className="flex justify-between items-start">
                              <div className="flex items-start gap-3">
                                <div className="w-10 h-10 bg-rose-100 text-rose-600 rounded-full flex items-center justify-center shrink-0 mt-0.5">
                                  <AlertTriangle size={20} />
                                </div>
                                <div>
                                  <p className="font-bold text-sm text-slate-800">{item.taskName}</p>
                                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                    <p className="text-xs font-bold text-rose-600">แปลงบ้าน: {item.plotName}</p>
                                    <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">โฟร์แมน: {item.foremanName}</span>
                                    <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">ช่าง: {item.contractorName}</span>
                                  </div>
                                  {item.textContent && <p className="text-xs text-slate-600 mt-2 bg-white/60 p-2 rounded-lg border border-rose-100/50">💬 {item.textContent}</p>}
                                </div>
                              </div>
                              <div className="flex flex-col gap-1 shrink-0 text-right">
                                {item.seSubmitFullStr !== '-' && (
                                  <div className="text-[10px] font-bold bg-slate-100 text-slate-500 px-2 py-0.5 rounded-md self-end whitespace-nowrap">
                                    SE ส่ง: {item.seSubmitFullStr}
                                  </div>
                                )}
                                <div className="text-xs font-bold bg-rose-200/50 text-rose-700 px-2 py-1 rounded-md self-end whitespace-nowrap">QC ตีกลับ: {item.time}</div>
                              </div>
                            </div>
                            {item.imageUrl && (
                              <div className="flex gap-2 mt-1 overflow-x-auto custom-scrollbar pb-1">
                                {item.imageUrl.split(',').map((imgUrl: string, imgIdx: number) => (
                                  <img key={imgIdx} src={imgUrl.trim()} alt="QC Image" onClick={() => handleImageClick(item.imageUrl, imgIdx)} className="h-16 w-16 object-cover rounded-lg border border-rose-200 shadow-sm cursor-pointer hover:opacity-80 transition-opacity" />
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-6 bg-slate-50 rounded-2xl border border-slate-100 text-slate-400 font-bold text-sm">ไม่มีงานที่ต้องแก้ไขในวันที่เลือก 🎉</div>
                    )}
                  </div>
                </>
              ) : (
                <div className="space-y-8">
                  {groupedDailyQC && Object.keys(groupedDailyQC).length > 0 ? (
                    Object.entries(groupedDailyQC).map(([groupKey, tasks], gIdx) => (
                      <div key={gIdx} className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm">
                        <h3 className="text-lg font-black text-slate-800 mb-4 border-b border-slate-100 pb-3 flex items-center gap-2">
                          <Filter size={18} className="text-indigo-500" />
                          {groupBy === 'contractor' ? 'ช่างรับเหมา:' : 'แปลงบ้าน:'} <span className="text-indigo-600">{groupKey}</span>
                          <span className="ml-auto text-xs font-bold bg-slate-100 text-slate-500 px-2 py-1 rounded-full">{tasks.length} งาน</span>
                        </h3>
                        <div className="space-y-3">
                          {tasks.map((item: any, idx: number) => {
                            const isPassed = item.status === 'passed';
                            const bgColor = isPassed ? 'bg-emerald-50' : 'bg-rose-50';
                            const borderColor = isPassed ? 'border-emerald-100' : 'border-rose-100';
                            const textColor = isPassed ? 'text-emerald-600' : 'text-rose-600';
                            const Icon = isPassed ? CheckCircle : AlertTriangle;
                            const iconBgColor = isPassed ? 'bg-emerald-100' : 'bg-rose-100';
                            
                            return (
                              <div key={idx} className={`${bgColor} border ${borderColor} p-4 rounded-2xl flex flex-col gap-3`}>
                                <div className="flex justify-between items-start">
                                  <div className="flex items-start gap-3">
                                    <div className={`w-10 h-10 ${iconBgColor} ${textColor} rounded-full flex items-center justify-center shrink-0 mt-0.5`}>
                                      <Icon size={20} />
                                    </div>
                                    <div>
                                      <p className="font-bold text-sm text-slate-800">{item.taskName}</p>
                                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                        <p className={`text-xs font-bold ${textColor}`}>แปลงบ้าน: {item.plotName}</p>
                                        <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">โฟร์แมน: {item.foremanName}</span>
                                        <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">ช่าง: {item.contractorName}</span>
                                      </div>
                                      {item.textContent && <p className={`text-xs text-slate-600 mt-2 bg-white/60 p-2 rounded-lg border ${isPassed ? 'border-emerald-100/50' : 'border-rose-100/50'}`}>💬 {item.textContent}</p>}
                                    </div>
                                  </div>
                                  <div className="flex flex-col gap-1 shrink-0 text-right">
                                    {item.seSubmitFullStr !== '-' && (
                                      <div className="text-[10px] font-bold bg-slate-100 text-slate-500 px-2 py-0.5 rounded-md self-end whitespace-nowrap">
                                        SE ส่ง: {item.seSubmitFullStr}
                                      </div>
                                    )}
                                    <div className={`text-xs font-bold ${isPassed ? 'bg-emerald-200/50 text-emerald-700' : 'bg-rose-200/50 text-rose-700'} px-2 py-1 rounded-md self-end whitespace-nowrap`}>
                                      QC ตรวจ: {item.time}
                                    </div>
                                  </div>
                                </div>
                                {item.imageUrl && (
                                  <div className="flex gap-2 mt-1 overflow-x-auto custom-scrollbar pb-1">
                                    {item.imageUrl.split(',').map((imgUrl: string, imgIdx: number) => (
                                      <img key={imgIdx} src={imgUrl.trim()} alt="QC Image" onClick={() => handleImageClick(item.imageUrl, imgIdx)} className={`h-16 w-16 object-cover rounded-lg border ${isPassed ? 'border-emerald-200' : 'border-rose-200'} shadow-sm cursor-pointer hover:opacity-80 transition-opacity`} />
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-6 text-slate-400 font-medium bg-slate-50 rounded-2xl border border-slate-100 border-dashed">ไม่มีงานในวันนี้</div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Lightbox Modal */}
      {lightbox.isOpen && (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/90 p-4 sm:p-6 animate-in fade-in duration-200">
          <button onClick={() => setLightbox({ ...lightbox, isOpen: false })} className="absolute top-4 right-4 sm:top-6 sm:right-6 text-white/70 hover:text-white transition-colors z-50 bg-black/20 p-2 rounded-full">
            <X size={32} />
          </button>
          
          <div className="relative w-full max-w-5xl h-full max-h-[85vh] flex items-center justify-center">
            {lightbox.images.length > 1 && (
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  setLightbox(prev => ({ ...prev, currentIndex: prev.currentIndex === 0 ? prev.images.length - 1 : prev.currentIndex - 1 }));
                }}
                className="absolute left-2 sm:left-4 z-50 p-3 bg-white/10 hover:bg-white/20 text-white rounded-full backdrop-blur-sm transition-all"
              >
                <ChevronLeft size={32} />
              </button>
            )}

            <img 
              src={lightbox.images[lightbox.currentIndex]} 
              alt="QC Fullscreen" 
              className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />

            {lightbox.images.length > 1 && (
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  setLightbox(prev => ({ ...prev, currentIndex: prev.currentIndex === prev.images.length - 1 ? 0 : prev.currentIndex + 1 }));
                }}
                className="absolute right-2 sm:right-4 z-50 p-3 bg-white/10 hover:bg-white/20 text-white rounded-full backdrop-blur-sm transition-all"
              >
                <ChevronRight size={32} />
              </button>
            )}
          </div>
          
          {lightbox.images.length > 1 && (
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex gap-2 z-50 bg-black/40 px-4 py-2 rounded-full backdrop-blur-sm">
              {lightbox.images.map((_, idx) => (
                <button
                  key={idx}
                  onClick={() => setLightbox(prev => ({ ...prev, currentIndex: idx }))}
                  className={`w-2.5 h-2.5 rounded-full transition-all ${idx === lightbox.currentIndex ? 'bg-white scale-125' : 'bg-white/40 hover:bg-white/60'}`}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Printable A4 Layout for QC Dashboard */}
      {typeof document !== 'undefined' && showQCDailyModal && qcAnalytics && createPortal(
        <>
          <style type="text/css" media="print">
            {`
              body > *:not(#qc-print-portal) { display: none !important; }
              body { display: block !important; }
              @page { size: A4 portrait; margin: 10mm; }
            `}
          </style>
          <div id="qc-print-portal" className="hidden print:block w-full bg-white text-black font-sans">
            <div className="flex justify-between items-end mb-6 border-b-2 border-slate-800 pb-4">
              <div>
                <h1 className="text-2xl font-black uppercase mb-2">รายงานสรุปผลการเข้าตรวจงาน QC</h1>
                <p className="text-sm font-bold text-slate-600">ประจำวันที่: {new Date(qcFilterDate).toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
              </div>
            </div>
            
            {groupBy === 'time' ? (
              <>
                <div className="mb-8">
                  <h3 className="text-xl font-black text-emerald-600 mb-4 flex items-center gap-2 border-b-2 border-emerald-200 pb-2">
                    <CheckCircle size={24} /> งานที่ตรวจผ่าน ({qcAnalytics.dailyQC.passedList.length})
                  </h3>
                  {qcAnalytics.dailyQC.passedList.length > 0 ? (
                    <div className="space-y-4">
                      {qcAnalytics.dailyQC.passedList.map((item: any, idx: number) => (
                        <div key={idx} className="border border-emerald-300 rounded-lg overflow-hidden page-break-inside-avoid shadow-sm">
                          <div className="bg-emerald-50 p-3 flex justify-between items-center border-b border-emerald-200 text-sm">
                            <div className="flex items-center gap-3">
                              <span className="font-bold text-emerald-800 bg-white px-2 py-1 rounded shadow-sm">{item.time}</span>
                              <span className="font-black text-emerald-900 text-lg">{item.taskName}</span>
                            </div>
                            <div className="flex gap-2 text-xs font-bold text-emerald-700">
                              <span className="bg-white px-2 py-1 rounded shadow-sm border border-emerald-100">แปลง: {item.plotName}</span>
                              <span className="bg-white px-2 py-1 rounded shadow-sm border border-emerald-100">โฟร์แมน: {item.foremanName}</span>
                              <span className="bg-white px-2 py-1 rounded shadow-sm border border-emerald-100">ช่าง: {item.contractorName}</span>
                            </div>
                          </div>
                          <div className="p-4 bg-white flex flex-col gap-3">
                            {item.textContent && <div className="text-sm text-slate-700 bg-slate-50 p-2 rounded border border-slate-200">💬 {item.textContent}</div>}
                            {item.imageUrl && (
                              <div className="flex flex-wrap gap-3">
                                {item.imageUrl.split(',').map((imgUrl: string, imgIdx: number) => (
                                  <img key={imgIdx} src={imgUrl.trim()} alt="QC" className="h-48 w-auto max-w-[48%] object-contain rounded-md border border-slate-300 shadow-sm" />
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500 italic">ไม่มีรายการที่ตรวจผ่านในวันนี้</p>
                  )}
                </div>

                <div>
                  <h3 className="text-xl font-black text-rose-600 mb-4 flex items-center gap-2 border-b-2 border-rose-200 pb-2">
                    <AlertTriangle size={24} /> งานที่แจ้งแก้ไข ({qcAnalytics.dailyQC.rejectedList.length})
                  </h3>
                  {qcAnalytics.dailyQC.rejectedList.length > 0 ? (
                    <div className="space-y-4">
                      {qcAnalytics.dailyQC.rejectedList.map((item: any, idx: number) => (
                        <div key={idx} className="border border-rose-300 rounded-lg overflow-hidden page-break-inside-avoid shadow-sm">
                          <div className="bg-rose-50 p-3 flex justify-between items-center border-b border-rose-200 text-sm">
                            <div className="flex items-center gap-3">
                              <span className="font-bold text-rose-800 bg-white px-2 py-1 rounded shadow-sm">{item.time}</span>
                              <span className="font-black text-rose-900 text-lg">{item.taskName}</span>
                            </div>
                            <div className="flex gap-2 text-xs font-bold text-rose-700">
                              <span className="bg-white px-2 py-1 rounded shadow-sm border border-rose-100">แปลง: {item.plotName}</span>
                              <span className="bg-white px-2 py-1 rounded shadow-sm border border-rose-100">โฟร์แมน: {item.foremanName}</span>
                              <span className="bg-white px-2 py-1 rounded shadow-sm border border-rose-100">ช่าง: {item.contractorName}</span>
                            </div>
                          </div>
                          <div className="p-4 bg-white flex flex-col gap-3">
                            {item.textContent && <div className="text-sm text-slate-700 bg-slate-50 p-2 rounded border border-slate-200">💬 {item.textContent}</div>}
                            {item.imageUrl && (
                              <div className="flex flex-wrap gap-3">
                                {item.imageUrl.split(',').map((imgUrl: string, imgIdx: number) => (
                                  <img key={imgIdx} src={imgUrl.trim()} alt="QC" className="h-48 w-auto max-w-[48%] object-contain rounded-md border border-slate-300 shadow-sm" />
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500 italic">ไม่มีรายการที่แจ้งแก้ไขในวันนี้</p>
                  )}
                </div>
              </>
            ) : (
              <div className="space-y-8">
                {groupedDailyQC && Object.keys(groupedDailyQC).length > 0 ? (
                  Object.entries(groupedDailyQC).map(([groupKey, tasks], gIdx) => (
                    <div key={gIdx} className="mb-8">
                      <h3 className="text-2xl font-black text-slate-800 mb-4 border-b-2 border-slate-300 pb-2 flex items-center gap-2 page-break-after-avoid">
                        {groupBy === 'contractor' ? 'ช่างรับเหมา:' : 'แปลงบ้าน:'} <span className="text-indigo-600">{groupKey}</span>
                        <span className="ml-2 text-sm font-bold text-slate-500">({tasks.length} งาน)</span>
                      </h3>
                      <div className="space-y-4">
                        {tasks.map((item: any, idx: number) => {
                          const isPassed = item.status === 'passed';
                          const statusColor = isPassed ? 'text-emerald-800 bg-emerald-100 border-emerald-300' : 'text-rose-800 bg-rose-100 border-rose-300';
                          const statusText = isPassed ? 'ผ่าน' : 'แก้ไข';
                          const borderColor = isPassed ? 'border-emerald-300' : 'border-rose-300';
                          const headerBg = isPassed ? 'bg-emerald-50' : 'bg-rose-50';

                          return (
                            <div key={idx} className={`border ${borderColor} rounded-lg overflow-hidden page-break-inside-avoid shadow-sm`}>
                              <div className={`${headerBg} p-3 flex justify-between items-center border-b ${borderColor} text-sm`}>
                                <div className="flex items-center gap-3">
                                  <span className="font-bold text-slate-700 bg-white px-2 py-1 rounded shadow-sm border border-slate-200">{item.time}</span>
                                  <span className={`font-black px-3 py-1 rounded shadow-sm border ${statusColor}`}>{statusText}</span>
                                  <span className="font-black text-slate-900 text-lg">{item.taskName}</span>
                                </div>
                                <div className="flex gap-2 text-xs font-bold text-slate-600">
                                  <span className="bg-white px-2 py-1 rounded shadow-sm border border-slate-200">แปลง: {item.plotName}</span>
                                  <span className="bg-white px-2 py-1 rounded shadow-sm border border-slate-200">โฟร์แมน: {item.foremanName}</span>
                                  <span className="bg-white px-2 py-1 rounded shadow-sm border border-slate-200">ช่าง: {item.contractorName}</span>
                                </div>
                              </div>
                              <div className="p-4 bg-white flex flex-col gap-3">
                                {item.textContent && <div className="text-sm text-slate-700 bg-slate-50 p-2 rounded border border-slate-200">💬 {item.textContent}</div>}
                                {item.imageUrl && (
                                  <div className="flex flex-wrap gap-3">
                                    {item.imageUrl.split(',').map((imgUrl: string, imgIdx: number) => (
                                      <img key={imgIdx} src={imgUrl.trim()} alt="QC" className="h-48 w-auto max-w-[48%] object-contain rounded-md border border-slate-300 shadow-sm" />
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-slate-500 italic text-center py-4">ไม่มีรายการในวันนี้</p>
                )}
              </div>
            )}
            
            <div className="mt-8 pt-4 border-t border-slate-300 flex justify-between text-xs text-slate-500">
              <span>BuildTrack - Construction Progress Tracking</span>
              <span>พิมพ์เมื่อ: {new Date().toLocaleString('th-TH')}</span>
            </div>
          </div>
        </>,
        document.body
      )}
    </div>
  );
}
