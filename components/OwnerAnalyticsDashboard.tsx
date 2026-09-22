import React, { useMemo, useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { TrendingUp, AlertTriangle, Target, ShieldAlert, Award, Users, Activity, CloudRain, Clock, CalendarClock, ArrowUpDown } from 'lucide-react';
import { LineChart, Line, BarChart, Bar, ComposedChart, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer } from 'recharts';
import WeeklyHeatmap from './Analytics/WeeklyHeatmap';
import BillingCycleHeatmap from './Analytics/BillingCycleHeatmap';

export default function OwnerAnalyticsDashboard({
  projects, plots, taskTemplates, schedules: rawSchedules, defects, allUpdatesRecord: rawAllUpdatesRecord, foremenList, latestUpdatesMap: rawLatestUpdatesMap, contractors, assignments, weatherInfo, qcSePerformance
}: any) {

  const [selectedProjectId, setSelectedProjectId] = useState<string>('all');

  const activeProjectsList = useMemo(() => {
    return (projects || [])
      .filter((proj: any) => !proj.is_closed)
      .filter((proj: any) => {
        const projPlots = (plots || []).filter((p: any) => p.project_name === proj.name);
        return projPlots.some((p: any) => p.progress < 100);
      });
  }, [projects, plots]);

  const activePlots = useMemo(() => {
    return new Set(
      (plots || [])
        .filter((p: any) => {
           if (selectedProjectId !== 'all') return p.project_name === selectedProjectId;
           return activeProjectsList.some((ap: any) => ap.name === p.project_name);
        })
        .map((p: any) => p.id)
    );
  }, [plots, activeProjectsList, selectedProjectId]);

  // Helper: Strictly exclude completed (100% finished or handed over) and ready-for-sale houses from risk analysis
  const isPlotCompletedOrReadyForSale = (p: any) => {
    if (!p) return true;
    const isCompleted = Boolean(p.is_completed) || Number(p.progress) >= 100 || p.handover_status === 'completed';
    const isReadyForSale = p.sale_status === 'ready_for_sale';
    return isCompleted || isReadyForSale;
  };

  // Only plots that are currently under active construction in the selected project(s)
  const activeUnderConstructionPlots = useMemo(() => {
    return (plots || []).filter((p: any) => {
      if (!activePlots.has(p.id)) return false;
      return !isPlotCompletedOrReadyForSale(p);
    });
  }, [plots, activePlots]);

  const activeUnderConstructionPlotIds = useMemo(() => {
    return new Set(activeUnderConstructionPlots.map((p: any) => String(p.id)));
  }, [activeUnderConstructionPlots]);

  const schedules = useMemo(() => {
    const res: any = {};
    Object.keys(rawSchedules || {}).forEach(k => {
      const item = rawSchedules[k];
      const plotId = item?.plot_id || (k.length >= 73 ? k.substring(0, 36) : k.split('-')[0]);
      if (activePlots.has(plotId)) res[k] = rawSchedules[k];
    });
    return res;
  }, [rawSchedules, activePlots]);

  const latestUpdatesMap = useMemo(() => {
    const res: any = {};
    Object.keys(rawLatestUpdatesMap || {}).forEach(k => {
      const item = rawLatestUpdatesMap[k];
      const plotId = item?.plot_id || (k.length >= 73 ? k.substring(0, 36) : k.split('-')[0]);
      if (activePlots.has(plotId)) res[k] = rawLatestUpdatesMap[k];
    });
    return res;
  }, [rawLatestUpdatesMap, activePlots]);

  const allUpdatesRecord = useMemo(() => {
    return (rawAllUpdatesRecord || []).filter((u: any) => activePlots.has(u.plot_id));
  }, [rawAllUpdatesRecord, activePlots]);
  
  // 1. Real Bottleneck & Handoff Latency Analysis (Focused on active construction plots)
  const bottleneckData = useMemo(() => {
    const taskWaitTimes: Record<string, { reworks: number, totalWaitMs: number, waitCount: number }> = {};
    const taskInstances: Record<string, any[]> = {};

    if (allUpdatesRecord) {
      allUpdatesRecord
        .filter((upd: any) => activeUnderConstructionPlotIds.has(String(upd.plot_id)))
        .forEach((upd: any) => {
          const key = `${upd.plot_id}-${upd.task_template_id}`;
          if (!taskInstances[key]) taskInstances[key] = [];
          taskInstances[key].push(upd);
        });
    }

    Object.keys(taskInstances).forEach(key => {
      const updates = taskInstances[key].sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      const taskId = updates[0].task_template_id;
      if (!taskWaitTimes[taskId]) taskWaitTimes[taskId] = { reworks: 0, totalWaitMs: 0, waitCount: 0 };
      
      let lastSubmitTime: number | null = null;
      
      updates.forEach((u: any) => {
        if (u.progress === 100 && (u.action === 'ส่งงาน 100%' || !u.action?.includes('QC'))) {
          lastSubmitTime = new Date(u.created_at).getTime();
        }
        
        const isRejection = (u.action && (u.action.includes('แจ้งแก้ไข') || u.action.includes('ตีกลับ'))) || u.status === 'rejected' || Boolean(u.is_rejected);
        if (isRejection) {
           taskWaitTimes[taskId].reworks++;
        }
        
        if (u.action && (u.action.includes('QC') || u.action.includes('Site Engineer'))) {
          if (lastSubmitTime) {
            const checkTime = new Date(u.created_at).getTime();
            if (checkTime >= lastSubmitTime) {
                taskWaitTimes[taskId].totalWaitMs += (checkTime - lastSubmitTime);
                taskWaitTimes[taskId].waitCount++;
            }
            lastSubmitTime = null; 
          }
        }
      });
    });

    return Object.entries(taskWaitTimes)
      .map(([taskId, stat]) => {
        const task = taskTemplates?.find((t:any) => String(t.id) === String(taskId));
        const avgWaitDays = stat.waitCount > 0 ? (stat.totalWaitMs / stat.waitCount / (1000 * 60 * 60 * 24)).toFixed(1) : 0;
        return { 
          taskName: task ? task.task_name : 'ไม่ระบุ', 
          count: stat.reworks, 
          avgWaitDays: Number(avgWaitDays) 
        };
      })
      .filter(t => t.count > 0)
      .sort((a, b) => b.count - a.count || b.avgWaitDays - a.avgWaitDays)
      .slice(0, 5); 
  }, [allUpdatesRecord, taskTemplates, activeUnderConstructionPlotIds]);

  // 2. Real Team Performance Matrix (Foreman Leaderboard)
  const foremanPerformance = useMemo(() => {
    if (!foremenList) return [];
    return foremenList.map((foreman: any) => {
      const fPlots = plots?.filter((p: any) => p.foreman === foreman.username) || [];
      let completedTasks = 0;
      let delayedTasks = 0;
      let totalReworks = 0;

      fPlots.forEach((p: any) => {
        const pTasks = taskTemplates?.filter((t: any) => t.house_type_id === p.house_type_id) || [];
        
        pTasks.forEach((t: any) => {
           const key = `${p.id}-${t.id}`;
           const plan = schedules?.[key];
           const actual = latestUpdatesMap?.[key];
           
           // ตรวจสอบว่ามีประวัติเสร็จ 100% แบบที่ไม่ใช่ Silent Mode (คีย์ย้อนหลัง) หรือไม่
           const updatesForTask = allUpdatesRecord?.filter((u: any) => String(u.plot_id) === String(p.id) && String(u.task_template_id) === String(t.id)) || [];
           const hasNormalCompletion = updatesForTask.some((u: any) => u.progress === 100 && !u.is_silent);
           
           if (actual && actual.progress === 100 && hasNormalCompletion) {
             completedTasks++;
             const pEnd = plan && plan.planned_end ? new Date(plan.planned_end).getTime() : 0;
             const aEnd = actual.created_at ? new Date(actual.created_at).getTime() : 0; 
             if (pEnd > 0 && aEnd > pEnd + 86400000) {
               delayedTasks++;
             }
           }
        });
      });

      if (allUpdatesRecord) {
        allUpdatesRecord.forEach((upd: any) => {
          if (upd.action && upd.action.includes('แจ้งแก้ไข') && fPlots.some((p:any) => String(p.id) === String(upd.plot_id))) {
            totalReworks++;
          }
        });
      }

      const onTimeRate = completedTasks > 0 ? Math.round(((completedTasks - delayedTasks) / completedTasks) * 100) : -1;
      const defectCount = defects?.filter((d: any) => fPlots.some((p: any) => p.id === d.plot_id)).length || 0;
      
      let riskLevel = 'Low';
      if (onTimeRate !== -1) {
         if (onTimeRate < 70 || totalReworks > 10) riskLevel = 'High';
         else if (onTimeRate < 85 || defectCount > 5) riskLevel = 'Medium';
      } else {
         riskLevel = 'N/A';
      }

      return {
        name: foreman.username,
        plotsCount: fPlots.length,
        completedTasks,
        onTimeRate,
        totalReworks,
        defectCount,
        riskLevel
      };
    }).sort((a: any, b: any) => b.onTimeRate - a.onTimeRate || b.completedTasks - a.completedTasks || a.totalReworks - b.totalReworks);
  }, [foremenList, plots, taskTemplates, schedules, latestUpdatesMap, allUpdatesRecord, defects]);

  // 3. Real EVM S-Curve Forecasting (Line Chart)
  const sCurveData = useMemo(() => {
    if (!schedules || !taskTemplates) return [];

    let totalBudget = 0;
    let minDate = new Date().getTime();
    let maxDate = new Date().getTime();

    const taskCostMap: Record<string, number> = {};
    taskTemplates.forEach((t: any) => { taskCostMap[t.id] = Number(t.cost) || 0; });

    const scheduleItems: any[] = [];
    Object.keys(schedules).forEach(key => {
       let taskId = schedules[key].task_template_id;
       if (!taskId && key.length >= 73) {
          taskId = key.substring(37); // UUID-UUID => second UUID
       } else if (!taskId) {
          const parts = key.split('-');
          taskId = parts.length >= 2 ? parts[1] : key;
       }
       
       const plan = schedules[key];
       if (plan.planned_start && plan.planned_end) {
          const s = new Date(plan.planned_start).getTime();
          const e = new Date(plan.planned_end).getTime();
          if (s < minDate) minDate = s;
          if (e > maxDate) maxDate = e;
          
          const cost = taskCostMap[taskId] || 0;
          totalBudget += cost;
          
          scheduleItems.push({
             key, cost, start: s, end: e
          });
       }
    });

    if (scheduleItems.length === 0 || totalBudget === 0) return [];

    const buckets: any[] = [];
    let current = new Date(minDate);
    current.setDate(1); // Start of month
    
    // For MVP readability, if maxDate is way too far, let's limit buckets to +3 months from today max
    const todayObj = new Date();
    todayObj.setMonth(todayObj.getMonth() + 3);
    const endBoundLimit = todayObj.getTime();
    
    const endBound = new Date(Math.min(maxDate, endBoundLimit));
    endBound.setMonth(endBound.getMonth() + 2);
    
    // Prevent infinite loop if minDate is bad
    let loopCount = 0;
    while (current < endBound && loopCount < 36) {
       buckets.push({
          time: current.getTime(),
          label: current.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
          plannedValue: 0,
          earnedValue: 0,
          forecast: null,
          month: ''
       });
       current.setMonth(current.getMonth() + 1);
       loopCount++;
    }

    const today = new Date().getTime();

    buckets.forEach(bucket => {
       let pv = 0;
       scheduleItems.forEach(item => {
          if (item.end <= bucket.time) {
             pv += item.cost;
          } else if (item.start < bucket.time && item.end > bucket.time) {
             const ratio = (bucket.time - item.start) / (item.end - item.start);
             pv += (item.cost * ratio);
          }
       });
       bucket.plannedValue = Math.round((pv / totalBudget) * 100);

       if (bucket.time <= today || (bucket.time - today < 30 * 24 * 60 * 60 * 1000 && bucket.time >= today)) {
          let ev = 0;
          Object.keys(latestUpdatesMap || {}).forEach(key => {
             const actual = latestUpdatesMap[key];
             let taskId = actual.task_template_id;
             if (!taskId && key.length >= 73) {
                taskId = key.substring(37);
             }
             const cost = taskCostMap[taskId] || 0;
             if (actual.progress === 100 && (actual.created_at || actual.actual_end_date)) {
                const aTime = new Date(actual.created_at || actual.actual_end_date).getTime();
                if (aTime <= bucket.time) {
                   ev += cost;
                }
             }
          });
          bucket.earnedValue = Math.round((ev / totalBudget) * 100);
       } else {
          bucket.earnedValue = null as any;
       }
    });

    let latestValidBucket = -1;
    let currentEV = 0;
    for (let i = buckets.length - 1; i >= 0; i--) {
       if (buckets[i].earnedValue !== null) {
          latestValidBucket = i;
          currentEV = buckets[i].earnedValue;
          break;
       }
    }

    let avgVelocity = 0;
    if (latestValidBucket > 0 && currentEV > 0) {
       avgVelocity = currentEV / latestValidBucket;
    } else {
       avgVelocity = 5; 
    }

    buckets.forEach((bucket, idx) => {
       if (idx >= latestValidBucket) {
          const diff = idx - latestValidBucket;
          let forecast = currentEV + (diff * avgVelocity);
          if (forecast > 100) forecast = 100;
          bucket.forecast = Math.round(forecast);
       } else {
          bucket.forecast = null as any;
       }
       
       bucket.month = bucket.label;
       bucket.planned = bucket.plannedValue;
       bucket.actual = bucket.earnedValue;
    });

    return buckets;
  }, [schedules, taskTemplates, latestUpdatesMap]);

  // 3.5 Cash Flow Forecasting (Predictive Cash Outflow/Inflow)
  const cashFlowData = useMemo(() => {
    if (!sCurveData || sCurveData.length === 0) return [];
    
    // สมมติฐานมูลค่าโครงการ (ในความจริงจะดึงจาก budget)
    const AVG_PLOT_VALUE = 2500000; 
    const totalProjectValue = (plots?.length || 10) * AVG_PLOT_VALUE;
    
    return sCurveData.map((bucket: any, idx: number, arr: any[]) => {
       const prevPlanned = idx === 0 ? 0 : arr[idx-1].plannedValue;
       const prevActual = idx === 0 ? 0 : arr[idx-1].earnedValue || 0;
       
       let prevForecast = 0;
       if (idx > 0) {
          prevForecast = arr[idx-1].forecast !== null ? arr[idx-1].forecast : (arr[idx-1].earnedValue !== null ? arr[idx-1].earnedValue : arr[idx-1].plannedValue);
       }
       
       // Monthly (Marginal) Cash Flow
       const plannedFlow = Math.max(0, (bucket.plannedValue - prevPlanned) / 100) * totalProjectValue;
       const actualFlow = bucket.earnedValue !== null ? Math.max(0, (bucket.earnedValue - prevActual) / 100) * totalProjectValue : null;
       const forecastFlow = bucket.forecast !== null ? Math.max(0, (bucket.forecast - prevForecast) / 100) * totalProjectValue : null;
       
       return {
          month: bucket.label,
          plannedFlow,
          actualFlow,
          forecastFlow,
          labelPlanned: plannedFlow > 0 ? (plannedFlow / 1000000).toFixed(1) + 'M' : '',
          labelActual: actualFlow !== null && actualFlow > 0 ? (actualFlow / 1000000).toFixed(1) + 'M' : '',
          labelForecast: forecastFlow !== null && forecastFlow > 0 ? (forecastFlow / 1000000).toFixed(1) + 'M' : ''
       };
    });
  }, [sCurveData, plots]);

  // 4. Real Contractor Predictive Scorecard
  const contractorPerformance = useMemo(() => {
    if (!contractors || !assignments) return [];
    
    return contractors.map((c: any) => {
      const cAssignments = assignments.filter((a: any) => a.contractor_name === c.name);
      let delayedTasks = 0;
      let totalAllocatedTasks = 0;
      let completedTasksCount = 0;
      let delayedCompletedTasks = 0;
      let ongoingDelayedTasks = 0;
      let totalReworks = 0;
      let defectCount = 0;

      const nowTime = Date.now();

      // Pre-group updates for performance
      const updatesByKey: Record<string, any[]> = {};
      if (allUpdatesRecord) {
        allUpdatesRecord.forEach((upd: any) => {
          const key = `${upd.plot_id}-${upd.task_template_id}`;
          if (!updatesByKey[key]) updatesByKey[key] = [];
          updatesByKey[key].push(upd);
        });
      }

      cAssignments.forEach((a: any) => {
        totalAllocatedTasks++;
        const key = `${a.plot_id}-${a.task_template_id}`;
        const plan = schedules?.[key];
        const actual = latestUpdatesMap?.[key];
        const pStart = plan && plan.planned_start ? new Date(plan.planned_start).getTime() : 0;
        const pEnd = plan && plan.planned_end ? new Date(plan.planned_end).getTime() : 0;
        
        // Calculate allocated duration in days (minimum 1 day)
        const plannedDurationDays = (pStart > 0 && pEnd > 0) 
            ? Math.max(1, Math.ceil((pEnd - pStart) / (1000 * 60 * 60 * 24)))
            : 0;

        if (plannedDurationDays > 0) {
          const taskUpdates = updatesByKey[key] || [];
          
          if (taskUpdates.length > 0) {
            // Sort ascending to find the first recorded update
            taskUpdates.sort((u1, u2) => new Date(u1.created_at).getTime() - new Date(u2.created_at).getTime());
            const actualStart = new Date(taskUpdates[0].created_at).getTime();

            if (actual && actual.progress === 100) {
               completedTasksCount++;
               const actualEnd = new Date(actual.created_at).getTime();
               const actualDurationDays = Math.max(1, Math.ceil((actualEnd - actualStart) / (1000 * 60 * 60 * 24)));
               if (actualDurationDays > plannedDurationDays) {
                 delayedCompletedTasks++;
               }
            } else {
               const currentDurationDays = Math.max(1, Math.ceil((nowTime - actualStart) / (1000 * 60 * 60 * 24)));
               if (currentDurationDays > plannedDurationDays) {
                 ongoingDelayedTasks++;
               }
            }
          }
          // Note: If taskUpdates is empty, they haven't started. We don't penalize them 
          // because it might be due to predecessor delays, but we also don't count it as a success.
        }
      });

      if (allUpdatesRecord) {
        allUpdatesRecord.forEach((upd: any) => {
          if (upd.action && (upd.action.includes('แจ้งแก้ไข') || upd.action.includes('ไม่อนุมัติ'))) {
             const isThisContractor = cAssignments.some((a:any) => String(a.plot_id) === String(upd.plot_id) && String(a.task_template_id) === String(upd.task_template_id));
             if (isThisContractor) totalReworks++;
          }
        });
      }

      defectCount = defects?.filter((d: any) => {
         return cAssignments.some((a:any) => String(a.plot_id) === String(d.plot_id) && String(a.task_template_id) === String(d.task_id));
      }).length || 0;

      // 🌟 Bayesian Average Scoring (Only for contractors with completed tasks) 🌟
      const rawOnTimeRate = completedTasksCount > 0 ? ((completedTasksCount - delayedCompletedTasks) / completedTasksCount) * 100 : -1;
      const confidenceTasks = 3; // น้ำหนักสมมติ (เท่ากับผลงาน 3 งาน)
      const globalAverageRate = 80; // ค่าเฉลี่ยมาตรฐานที่ตั้งไว้
      
      let bayesianScore = -1;
      let onTimeRate = -1;
      
      if (completedTasksCount > 0) {
          bayesianScore = Math.round(
            ((rawOnTimeRate * completedTasksCount) + (globalAverageRate * confidenceTasks)) / (completedTasksCount + confidenceTasks)
          );
          onTimeRate = Math.round(rawOnTimeRate); // % จริงๆ ตามหน้างาน
      }
      
      let delayProbability = 10;
      
      if (completedTasksCount > 0) {
          // Strict Penalties based on Bayesian Score to prevent false positives from new contractors
          if (bayesianScore < 80) delayProbability += 40;
          else if (bayesianScore < 90) delayProbability += 20;
      }

      // 🚨 Hybrid Penalty: Penalize ongoing delayed tasks directly to their risk score
      delayProbability += (ongoingDelayedTasks * 15);

      // Strict Rework Penalties (Immediate effect + Threshold trigger)
      delayProbability += (totalReworks * 5);
      if (totalReworks > 3) delayProbability += 20;

      // Strict Defect Penalties (Immediate effect + Threshold trigger)
      delayProbability += (defectCount * 10);
      if (defectCount > 2) delayProbability += 20;

      // Max capped at 99%
      delayProbability = Math.min(delayProbability, 99);

      return {
        name: c.name,
        taskCount: totalAllocatedTasks,
        completedTasksCount,
        onTimeRate,
        bayesianScore,
        totalReworks,
        defectCount,
        delayProbability
      };
    }).sort((a: any, b: any) => {
        // Sort N/A (onTimeRate = -1) to the bottom
        if (a.onTimeRate === -1 && b.onTimeRate !== -1) return 1;
        if (a.onTimeRate !== -1 && b.onTimeRate === -1) return -1;
        
        // Then sort by onTimeRate descending
        if (b.onTimeRate !== a.onTimeRate) return b.onTimeRate - a.onTimeRate;
        
        // Tie-breaker 1: More completed tasks is better
        if (b.completedTasksCount !== a.completedTasksCount) return b.completedTasksCount - a.completedTasksCount;
        
        // Tie-breaker 2: Fewer reworks is better
        return a.totalReworks - b.totalReworks;
    });
  }, [contractors, assignments, schedules, latestUpdatesMap, allUpdatesRecord, defects]);

  // Helper to format timestamps to Thai Buddhist Era (พ.ศ.)
  const formatThaiDate = (val: any) => {
    if (!val) return 'ไม่ระบุ';
    const d = new Date(val);
    if (isNaN(d.getTime())) return 'ไม่ระบุ';
    const thaiYear = d.getFullYear() + 543;
    const months = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
    return `${d.getDate()} ${months[d.getMonth()]} ${thaiYear}`;
  };


  // 6. Overdue Critical Plots (Delay > 7 days on active construction plots only)
  const criticalPlots = useMemo(() => {
    if (!activeUnderConstructionPlots || !taskTemplates || !schedules || !latestUpdatesMap) return [];
    
    const overdueList: any[] = [];
    const nowTime = Date.now();
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

    activeUnderConstructionPlots.forEach((p: any) => {
       const pTasks = taskTemplates.filter((t: any) => t.house_type_id === p.house_type_id);
       
       pTasks.forEach((t: any) => {
          const key = `${p.id}-${t.id}`;
          const plan = schedules[key];
          const actual = latestUpdatesMap[key];
          
          if (plan && plan.planned_end) {
             const pEnd = new Date(plan.planned_end).getTime();
             
             // If task is not 100% finished, and it's overdue by > 7 days
             if ((!actual || actual.progress < 100) && (nowTime - pEnd > SEVEN_DAYS_MS)) {
                // Find contractor
                const assign = assignments?.find((a:any) => String(a.plot_id) === String(p.id) && String(a.task_template_id) === String(t.id));
                const delayDays = Math.floor((nowTime - pEnd) / (1000 * 60 * 60 * 24));
                
                overdueList.push({
                   plotName: p.plot_number || p.plot_name || String(p.id).substring(0,6),
                   taskName: t.task_name,
                   delayDays,
                   contractor: assign?.contractor_name || 'ไม่ระบุ',
                   foreman: p.foreman || 'ไม่ระบุ'
                });
             }
          }
       });
    });
    
    return overdueList.sort((a, b) => b.delayDays - a.delayDays).slice(0, 3);
  }, [activeUnderConstructionPlots, taskTemplates, schedules, latestUpdatesMap, assignments]);

  // 4.5 Predictive Delay Analysis (Local AI Engine - Active Construction Plots Only)
  const predictiveAlerts = useMemo(() => {
    if (!activeUnderConstructionPlots || !taskTemplates || !schedules || !latestUpdatesMap || !contractorPerformance) return [];
    
    const alerts: any[] = [];
    const nowTime = Date.now();
    const MS_PER_DAY = 24 * 60 * 60 * 1000;
    
    activeUnderConstructionPlots.forEach((p: any) => {
       const pTasks = taskTemplates.filter((t: any) => t.house_type_id === p.house_type_id);
       let minPlannedStart = 0;
       let maxPlannedEnd = 0;
       let totalProgress = 0;
       let firstActualStart = 0;
       let lastActualUpdate = 0;
       
       pTasks.forEach((t: any) => {
          const key = `${p.id}-${t.id}`;
          const plan = schedules[key] || schedules[`${p.id}_${t.id}`];
          const actual = latestUpdatesMap[key] || latestUpdatesMap[`${p.id}_${t.id}`];
          
          if (plan) {
             if (plan.planned_start) {
                const pStart = new Date(plan.planned_start).getTime();
                if (pStart > 0 && (minPlannedStart === 0 || pStart < minPlannedStart)) minPlannedStart = pStart;
             }
             if (plan.planned_end) {
                const pEnd = new Date(plan.planned_end).getTime();
                if (pEnd > 0 && pEnd > maxPlannedEnd) maxPlannedEnd = pEnd;
             }
          }
          
          if (actual && typeof actual.progress === 'number') {
             totalProgress += actual.progress;
             if (actual.created_at) {
                const aTime = new Date(actual.created_at).getTime();
                if (aTime > 0) {
                   if (firstActualStart === 0 || aTime < firstActualStart) firstActualStart = aTime;
                   if (aTime > lastActualUpdate) lastActualUpdate = aTime;
                }
             }
          }
       });
       
       const avgTaskProgress = pTasks.length > 0 ? totalProgress / pTasks.length : 0;
       const overallProgress = Math.min(99.9, Math.max(0, p.progress !== undefined && p.progress !== null ? Math.max(Number(p.progress), avgTaskProgress) : avgTaskProgress));
       
       // Fallbacks if schedule bounds are missing
       if (maxPlannedEnd === 0 && minPlannedStart > 0) {
          maxPlannedEnd = minPlannedStart + (90 * MS_PER_DAY);
       }
       if (minPlannedStart === 0 && maxPlannedEnd > 0) {
          minPlannedStart = maxPlannedEnd - (90 * MS_PER_DAY);
       }
       if (maxPlannedEnd === 0) return; // Cannot forecast without schedule
       
       const totalPlannedDays = Math.max(14, Math.round((maxPlannedEnd - minPlannedStart) / MS_PER_DAY));
       const plannedVelocity = 100 / totalPlannedDays; // % per day planned
       
       // Find contractor for this plot
       const plotAssignments = assignments?.filter((a: any) => String(a.plot_id) === String(p.id)) || [];
       const mainContractor = plotAssignments[0]?.contractor_name || 'ผู้รับเหมาหลัก';
       const contractorStat = contractorPerformance.find((c: any) => c.name === mainContractor);
       
       let penaltyDays = 0;
       const riskFactors: string[] = [];
       
       if (contractorStat) {
          if (contractorStat.delayProbability > 50) {
             const pDays = Math.max(3, Math.round(contractorStat.delayProbability / 10));
             penaltyDays += pDays;
             riskFactors.push(`ผู้รับเหมา (${mainContractor}) สถิติล่าช้า ${contractorStat.delayProbability}% (+${pDays}วัน)`);
          }
          if (contractorStat.totalReworks >= 3) {
             const rDays = Math.min(5, contractorStat.totalReworks);
             penaltyDays += rDays;
             riskFactors.push(`งานแก้งาน/ตีกลับ ${contractorStat.totalReworks} ครั้ง (+${rDays}วัน)`);
          }
       }
       
       // Check if work has stalled without updates
       if (lastActualUpdate > 0 && (nowTime - lastActualUpdate > 10 * MS_PER_DAY) && overallProgress < 90) {
          const stagnantDays = Math.floor((nowTime - lastActualUpdate) / MS_PER_DAY);
          penaltyDays += Math.min(10, stagnantDays);
          riskFactors.push(`ไม่มีอัปเดตงานมา ${stagnantDays} วัน`);
       }

       let expectedEnd = 0;
       let delayDays = 0;
       let velocityDesc = '';

       // CASE 1: Plot hasn't started yet (0% progress)
       if (overallProgress === 0) {
          if (minPlannedStart > 0 && nowTime > minPlannedStart + (5 * MS_PER_DAY)) {
             const startDelay = Math.floor((nowTime - minPlannedStart) / MS_PER_DAY);
             expectedEnd = maxPlannedEnd + ((startDelay + penaltyDays) * MS_PER_DAY);
             delayDays = Math.ceil((expectedEnd - maxPlannedEnd) / MS_PER_DAY);
             velocityDesc = `ยังไม่เริ่มงาน (เกินกำหนดเริ่ม ${startDelay} วัน)`;
          } else {
             return; // On track to start
          }
       } 
       // CASE 2: Plot in progress
       else {
          const effectiveStart = firstActualStart > 0 ? firstActualStart : minPlannedStart;
          const daysSinceStart = Math.max(7, (nowTime - effectiveStart) / MS_PER_DAY);
          const actualVelocityPerDay = overallProgress / daysSinceStart;
          
          // Blended velocity (70% actual, 30% planned) with a floor of 0.15%/day
          const blendedVelocity = Math.max(0.15, (actualVelocityPerDay * 0.7) + (plannedVelocity * 0.3));
          const remainingProgress = 100 - overallProgress;
          const daysToFinish = remainingProgress / blendedVelocity;
          
          expectedEnd = nowTime + Math.round((daysToFinish + penaltyDays) * MS_PER_DAY);
          delayDays = Math.ceil((expectedEnd - maxPlannedEnd) / MS_PER_DAY);
          velocityDesc = `ความเร็วเฉลี่ย ${blendedVelocity.toFixed(2)}%/วัน`;
       }
       
       // Alert threshold: Delay >= 5 days
       if (delayDays >= 5) {
          const plotLabel = p.plot_number || p.plot_name || `แปลง ${String(p.id).substring(0, 6)}`;
          const severity = delayDays > 14 ? 'high' : 'medium';
          
          alerts.push({
             type: 'predictive',
             severity,
             plotId: p.id,
             plotName: plotLabel,
             title: `คาดการณ์ล่าช้า: แปลง ${plotLabel}`,
             delayDays,
             overallProgress: Math.round(overallProgress),
             plannedEndDate: formatThaiDate(maxPlannedEnd),
             forecastEndDate: formatThaiDate(expectedEnd),
             contractor: mainContractor,
             foreman: p.foreman || 'ไม่ระบุ',
             message: `ความคืบหน้าปัจจุบัน ${Math.round(overallProgress)}% (${velocityDesc}) คาดการณ์ว่าจะส่งมอบล่าช้ากว่าแผน ${delayDays} วัน`,
             recommendation: riskFactors.length > 0 
                ? `⚠️ ปัจจัยเสี่ยง: ${riskFactors.join(', ')} ควรเร่งรัดผู้รับเหมา (${mainContractor}) และประสานโฟร์แมน (${p.foreman || 'ประจำแปลง'}) แก้ไขปัญหาหน้างานด่วน`
                : `ควรเร่งรัดลำดับงานคู่ขนาน (Fast-tracking) และเพิ่มจำนวนช่าง เพื่อชดเชยเวลาที่คาดว่าจะล่าช้า ${delayDays} วัน`
          });
       }
    });
    
    return alerts;
  }, [activeUnderConstructionPlots, taskTemplates, schedules, latestUpdatesMap, contractorPerformance, assignments]);

  // Sorting state for plot predictive alerts (Default: 'plot_asc' as requested)
  const [plotSortBy, setPlotSortBy] = useState<'plot_asc' | 'delay_desc' | 'progress_asc' | 'risk_severity'>('plot_asc');

  // Sorted list of predictive delay plots
  const sortedPredictiveAlerts = useMemo(() => {
    const list = [...predictiveAlerts];
    if (plotSortBy === 'plot_asc') {
      return list.sort((a, b) => (a.plotName || '').localeCompare(b.plotName || '', undefined, { numeric: true, sensitivity: 'base' }));
    }
    if (plotSortBy === 'delay_desc') {
      return list.sort((a, b) => b.delayDays - a.delayDays);
    }
    if (plotSortBy === 'progress_asc') {
      return list.sort((a, b) => a.overallProgress - b.overallProgress);
    }
    if (plotSortBy === 'risk_severity') {
      return list.sort((a, b) => {
        const aSev = a.severity === 'high' ? 2 : 1;
        const bSev = b.severity === 'high' ? 2 : 1;
        if (bSev !== aSev) return bSev - aSev;
        return b.delayDays - a.delayDays;
      });
    }
    return list;
  }, [predictiveAlerts, plotSortBy]);

  // Weather risk: Categorize active tasks on active plots (Outdoor vs Indoor)
  const weatherRiskAnalysis = useMemo(() => {
    let outdoorTasksCount = 0;
    let indoorTasksCount = 0;
    
    activeUnderConstructionPlots.forEach((p: any) => {
      const pTasks = taskTemplates?.filter((t: any) => t.house_type_id === p.house_type_id) || [];
      pTasks.forEach((t: any) => {
        const key = `${p.id}-${t.id}`;
        const actual = latestUpdatesMap[key];
        if (!actual || actual.progress < 100) {
          const name = t.task_name || '';
          if (/เสาเข็ม|ฐานราก|โครงสร้าง|คาน|เสา|หลังคา|ก่อ|ฉาบ|ภายนอก|รั้ว|ถนน|ดิน|ระบายน้ำ/i.test(name)) {
            outdoorTasksCount++;
          } else {
            indoorTasksCount++;
          }
        }
      });
    });

    return { outdoorTasksCount, indoorTasksCount };
  }, [activeUnderConstructionPlots, taskTemplates, latestUpdatesMap]);

  // Contractor capacity & workload on active construction plots
  const contractorWorkloadStats = useMemo(() => {
    const plotCounts: Record<string, number> = {};
    assignments?.forEach((a: any) => {
      if (activeUnderConstructionPlotIds.has(String(a.plot_id)) && a.contractor_name) {
        plotCounts[a.contractor_name] = (plotCounts[a.contractor_name] || 0) + 1;
      }
    });

    return (contractorPerformance || []).map((c: any) => ({
      name: c.name,
      activePlotsCount: plotCounts[c.name] || 0,
      onTimeRate: c.onTimeRate,
      totalReworks: c.totalReworks,
      delayProbability: c.delayProbability
    })).sort((a: any, b: any) => b.activePlotsCount - a.activePlotsCount);
  }, [assignments, activeUnderConstructionPlotIds, contractorPerformance]);

  // EVM Schedule Performance Index (SPI) metrics
  const evmMetrics = useMemo(() => {
    if (!sCurveData || sCurveData.length === 0) return { spi: '1.00', status: 'On Track' };
    const pastBuckets = sCurveData.filter((b: any) => b.actual > 0);
    const latest = pastBuckets[pastBuckets.length - 1];
    if (!latest || !latest.planned) return { spi: '1.00', status: 'On Track' };
    const spi = (latest.actual / latest.planned).toFixed(2);
    const spiNum = Number(spi);
    const status = spiNum >= 1 ? 'Ahead of Schedule' : spiNum >= 0.9 ? 'Slightly Behind' : 'Critically Delayed';
    return { spi, planned: latest.planned, actual: latest.actual, status };
  }, [sCurveData]);

  // 5. Smart Risk Alerts (Real AI Analysis)
  const [aiAlerts, setAiAlerts] = useState<any[]>([]);
  const [isAnalyzingAI, setIsAnalyzingAI] = useState(false);
  const [aiAnalysisError, setAiAnalysisError] = useState<string | null>(null);

  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  useEffect(() => {
    let isMounted = true;
    
    const fetchNewAIAnalysis = async () => {
      setIsAnalyzingAI(true);
      setAiAnalysisError(null);
      try {
        const predictivePayload = predictiveAlerts.slice(0, 5).map(a => ({
          plot: a.plotName,
          delayDays: a.delayDays,
          progress: `${a.overallProgress}%`,
          plannedEnd: a.plannedEndDate,
          forecastEnd: a.forecastEndDate,
          contractor: a.contractor
        }));

        const res = await fetch('/api/ai-risk-analysis', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bottleneckData,
            sCurveData,
            contractorPerformance,
            contractorWorkloadStats,
            weatherInfo,
            weatherRiskAnalysis,
            evmMetrics,
            predictiveDelays: predictivePayload,
            activePlotStats: {
              totalUnderConstruction: activeUnderConstructionPlots.length,
              delayedPlotsCount: predictiveAlerts.length,
              criticalOverdueCount: criticalPlots.length
            }
          })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to analyze');
        
        const newAlerts = Array.isArray(data) ? data : [];
        
        if (isMounted) {
          setAiAlerts(newAlerts);
          setLastUpdated(new Date());
        }

        // Save to Supabase (fire and forget)
        supabase.from('ai_risk_reports').insert([{ report_data: newAlerts }]).then(({error}) => {
           if (error) console.error("Failed to cache AI report:", error);
        });
      } catch (err: any) {
        console.error(err);
        if (isMounted) setAiAnalysisError(err.message);
      } finally {
        if (isMounted) setIsAnalyzingAI(false);
      }
    };

    const checkAndFetchAI = async () => {
      try {
        // 1. Check database for latest report
        const { data: reports, error: fetchErr } = await supabase
          .from('ai_risk_reports')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(1);

        if (fetchErr) throw fetchErr;

        let needsNewAnalysis = false;
        
        if (reports && reports.length > 0) {
          const report = reports[0];
          const reportAgeMs = Date.now() - new Date(report.created_at).getTime();
          const oneHourMs = 60 * 60 * 1000;
          
          if (reportAgeMs < oneHourMs) {
            // Cache is valid
            if (isMounted) {
              setAiAlerts(Array.isArray(report.report_data) ? report.report_data : []);
              setLastUpdated(new Date(report.created_at));
            }
          } else {
            needsNewAnalysis = true;
          }
        } else {
          needsNewAnalysis = true;
        }

        // 2. Run new analysis if needed
        if (needsNewAnalysis) {
          await fetchNewAIAnalysis();
        }
      } catch (err: any) {
        console.error(err);
        if (isMounted) setAiAnalysisError(err.message);
      }
    };
    
    // Only run if we actually have data loaded
    if (bottleneckData.length > 0 && sCurveData.length > 0) {
      checkAndFetchAI();
    }

    return () => { isMounted = false; };
  }, [bottleneckData, sCurveData, contractorPerformance, weatherInfo, activeUnderConstructionPlots.length]);

  const handleForceRefreshAI = async () => {
    setIsAnalyzingAI(true);
    setAiAnalysisError(null);
    try {
      const predictivePayload = predictiveAlerts.slice(0, 5).map(a => ({
        plot: a.plotName,
        delayDays: a.delayDays,
        progress: `${a.overallProgress}%`,
        plannedEnd: a.plannedEndDate,
        forecastEnd: a.forecastEndDate,
        contractor: a.contractor
      }));

      const res = await fetch('/api/ai-risk-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bottleneckData,
          sCurveData,
          contractorPerformance,
          contractorWorkloadStats,
          weatherInfo,
          weatherRiskAnalysis,
          evmMetrics,
          predictiveDelays: predictivePayload,
          activePlotStats: {
            totalUnderConstruction: activeUnderConstructionPlots.length,
            delayedPlotsCount: predictiveAlerts.length,
            criticalOverdueCount: criticalPlots.length
          }
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to analyze');
      
      const newAlerts = Array.isArray(data) ? data : [];
      setAiAlerts(newAlerts);
      setLastUpdated(new Date());

      // Save to Supabase
      await supabase.from('ai_risk_reports').insert([{ report_data: newAlerts }]);
    } catch (err: any) {
      console.error(err);
      setAiAnalysisError(err.message);
    } finally {
      setIsAnalyzingAI(false);
    }
  };

  return (
    <div className="space-y-6 sm:space-y-8 mt-8">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-slate-200 pb-4 gap-4">
        <div className="flex items-center gap-3">
          <TrendingUp className="text-blue-600" size={28} />
          <h2 className="text-xl sm:text-3xl font-black text-slate-800 italic uppercase">Deep Analytics <span className="text-slate-400 text-sm sm:text-base font-bold ml-2">สำหรับผู้บริหาร</span></h2>
        </div>
        <div className="w-full sm:w-auto">
          <select 
            value={selectedProjectId} 
            onChange={(e) => setSelectedProjectId(e.target.value)}
            className="w-full sm:w-64 bg-white border border-slate-200 rounded-xl px-4 py-2 font-bold text-slate-700 outline-none focus:border-blue-500 shadow-sm cursor-pointer"
          >
            <option value="all">ภาพรวมทุกโครงการ (ที่กำลังก่อสร้าง)</option>
            {activeProjectsList.map((proj: any) => (
              <option key={proj.name} value={proj.name}>{proj.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* ======================================================== */}
      {/* กรอบที่ 1: 🏡 คาดการณ์ความล่าช้ารายแปลงก่อสร้าง (Plot-by-Plot Forecast) */}
      {/* ======================================================== */}
      <div className="bg-gradient-to-br from-slate-900 via-slate-850 to-slate-900 rounded-[2rem] p-6 shadow-xl border border-slate-750">
         <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 mb-6">
            <div className="flex flex-wrap items-center gap-3">
              <div className="p-2.5 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30 shrink-0">
                <CalendarClock size={22} />
              </div>
              <div>
                <h3 className="font-black text-lg text-white flex items-center gap-2">
                  คาดการณ์ความล่าช้ารายแปลงก่อสร้าง
                </h3>
                <p className="text-xs text-slate-400 font-medium mt-0.5">
                  วิเคราะห์ความเร็วงานจริง (Velocity) และความเสี่ยงผู้รับเหมา เฉพาะบ้านกำลังก่อสร้าง
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5 self-end sm:self-auto">
              <span className={`text-[11px] font-bold px-3 py-1 rounded-full border shadow-sm ${
                sortedPredictiveAlerts.length > 0 
                  ? 'bg-rose-950/80 text-rose-300 border-rose-800/60' 
                  : 'bg-emerald-950/80 text-emerald-300 border-emerald-800/60'
              }`}>
                {sortedPredictiveAlerts.length > 0 
                  ? `พบความเสี่ยงล่าช้า ${sortedPredictiveAlerts.length} แปลง` 
                  : 'ทุกแปลงตามแผน'} 
                <span className="opacity-70 ml-1">/ กำลังสร้าง {activeUnderConstructionPlots.length} แปลง</span>
              </span>

              {/* Sorting Dropdown (Default: plot_asc) */}
              <div className="flex items-center gap-1.5 bg-slate-800 px-3 py-1.5 rounded-xl border border-slate-700 shadow-sm">
                <ArrowUpDown size={13} className="text-amber-400 shrink-0" />
                <span className="text-[11px] text-slate-400 font-bold hidden md:inline">เรียงตาม:</span>
                <select
                  value={plotSortBy}
                  onChange={(e: any) => setPlotSortBy(e.target.value)}
                  className="bg-transparent text-slate-200 text-xs font-bold outline-none cursor-pointer"
                >
                  <option value="plot_asc" className="bg-slate-800 text-white">🔢 เลขแปลง (ค่าเริ่มต้น)</option>
                  <option value="delay_desc" className="bg-slate-800 text-white">⏳ ล่าช้ามากที่สุด ➔ น้อยสุด</option>
                  <option value="progress_asc" className="bg-slate-800 text-white">📉 % ความคืบหน้าน้อยสุด</option>
                  <option value="risk_severity" className="bg-slate-800 text-white">🚨 ความเสี่ยงวิกฤตก่อน</option>
                </select>
              </div>
            </div>
         </div>

         {sortedPredictiveAlerts.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
               {sortedPredictiveAlerts.map((alert, idx) => (
                 <div key={idx} className="bg-slate-800/80 hover:bg-slate-800 rounded-2xl p-4 border border-slate-700 flex flex-col justify-between hover:border-amber-500/50 transition-all shadow-md group">
                    <div>
                      <div className="flex items-start justify-between gap-2 mb-3">
                          <div className="flex items-center gap-2">
                            <span className="px-2.5 py-1 rounded-lg bg-amber-500/20 text-amber-300 font-black text-sm border border-amber-500/30">
                              แปลง {alert.plotName}
                            </span>
                            <span className="text-xs text-slate-400 font-bold">
                              {alert.foreman ? `โฟร์แมน: ${alert.foreman}` : ''}
                            </span>
                          </div>

                          <span className={`px-2.5 py-0.5 rounded-full text-xs font-black border ${
                            alert.severity === 'high' 
                              ? 'bg-rose-500/25 text-rose-300 border-rose-500/50 animate-pulse' 
                              : 'bg-amber-500/25 text-amber-300 border-amber-500/50'
                          }`}>
                            +{alert.delayDays} วัน
                          </span>
                      </div>

                      {/* Progress Bar & Velocity */}
                      <div className="space-y-1.5 mb-3 bg-slate-900/90 p-2.5 rounded-xl border border-slate-750">
                        <div className="flex justify-between text-[11px] font-bold">
                          <span className="text-slate-400">ความคืบหน้ารวม</span>
                          <span className="text-white">{alert.overallProgress}%</span>
                        </div>
                        <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
                          <div 
                            className={`h-full rounded-full transition-all ${
                              alert.severity === 'high' ? 'bg-gradient-to-r from-amber-500 to-rose-500' : 'bg-gradient-to-r from-blue-500 to-amber-500'
                            }`}
                            style={{ width: `${Math.min(100, Math.max(5, alert.overallProgress))}%` }}
                          />
                        </div>
                        <div className="flex justify-between text-[10px] text-slate-400 pt-0.5">
                          <span>ช่าง: {alert.contractor || 'ไม่ระบุ'}</span>
                          <span className="text-amber-400/90 font-medium">ความเร็วต่ำกว่าแผน</span>
                        </div>
                      </div>

                      {/* Date Comparison Timeline */}
                      {alert.plannedEndDate && alert.forecastEndDate && (
                        <div className="flex items-center justify-between text-[11px] font-medium text-slate-300 bg-slate-900/90 px-3 py-2 rounded-xl border border-slate-750 mb-3">
                          <div>
                            <span className="text-slate-400 block text-[10px]">แผนเดิม</span>
                            <strong className="text-slate-200">{alert.plannedEndDate}</strong>
                          </div>
                          <span className="text-slate-500 font-bold">➔</span>
                          <div className="text-right">
                            <span className="text-rose-400 block text-[10px]">คาดการณ์เสร็จ</span>
                            <strong className="text-rose-300 font-bold">{alert.forecastEndDate}</strong>
                          </div>
                        </div>
                      )}

                      <p className="text-slate-300 text-xs leading-relaxed">{alert.message}</p>
                    </div>

                    <div className="mt-3 pt-3 border-t border-slate-700/60">
                      <p className="text-indigo-300 text-xs font-bold flex items-start gap-1.5">
                        <span className="shrink-0">💡</span> <span>{alert.recommendation}</span>
                      </p>
                    </div>
                 </div>
               ))}
            </div>
         ) : (
            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-6 text-center text-emerald-300">
               <p className="font-black text-base flex items-center justify-center gap-2">
                 🎉 ทุกแปลงที่กำลังก่อสร้างดำเนินงานได้ตามแผนงาน
               </p>
               <p className="text-xs text-emerald-400/80 mt-1">
                 ไม่พบแปลงที่มีแนวโน้มส่งมอบล่าช้าเกินเกณฑ์เตือนภัย (วิเคราะห์จากความเร็วงานจริงและสถิติประวัติผู้รับเหมา)
               </p>
            </div>
         )}
      </div>

      {/* ======================================================== */}
      {/* กรอบที่ 2: 🤖 AI Executive Risk Report (4 เสาหลักกลยุทธ์) */}
      {/* ======================================================== */}
      <div className="bg-gradient-to-br from-slate-900 via-slate-850 to-slate-900 rounded-[2rem] p-6 shadow-xl border border-slate-700">
         <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 mb-6">
            <div className="flex flex-wrap items-center gap-3">
              <div className="p-2.5 rounded-xl bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 shrink-0">
                <Activity size={22} />
              </div>
              <div>
                <h3 className="font-black text-lg text-white flex items-center gap-2">
                  AI Executive Risk Report (4 เสาหลักกลยุทธ์)
                </h3>
                <p className="text-xs text-indigo-300/80 font-medium mt-0.5">
                  วิเคราะห์เชิงลึก: สภาพอากาศ • สภาพคล่องผู้รับเหมา • คอขวด QC • มูลค่างาน (EVM)
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 self-end sm:self-auto">
              {lastUpdated && (
                <span className="text-slate-400 text-xs font-medium">
                  อัปเดตล่าสุด: {lastUpdated.toLocaleTimeString('th-TH')}
                </span>
              )}
              {isAnalyzingAI ? (
                <span className="text-indigo-400 text-xs font-bold animate-pulse flex items-center gap-1">
                  🤖 กำลังวิเคราะห์ข้อมูลใหม่...
                </span>
              ) : (
                <button 
                  onClick={handleForceRefreshAI}
                  className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold py-2 px-3.5 rounded-xl flex items-center gap-1.5 transition-all shadow-md hover:shadow-indigo-500/25 border border-indigo-400/30"
                  title="สั่งให้ AI ประมวลผลสถานการณ์ ณ ปัจจุบันทันที"
                >
                  <Activity size={14} /> วิเคราะห์เดี๋ยวนี้
                </button>
              )}
            </div>
         </div>

         {aiAnalysisError && (
            <div className="bg-rose-500/20 text-rose-300 p-4 rounded-xl text-sm font-bold mb-4 border border-rose-500/30">
               ⚠️ {aiAnalysisError}
            </div>
         )}

         {aiAlerts.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
               {aiAlerts.map((alert, idx) => (
                 <div key={idx} className="bg-slate-800/80 hover:bg-slate-800 rounded-2xl p-5 border border-slate-700 flex flex-col justify-between hover:border-indigo-500/50 transition-all shadow-md">
                    <div>
                      <div className="flex items-start justify-between gap-2 mb-3">
                          <div className="flex items-center gap-2.5">
                            <div className={`p-2.5 rounded-xl shrink-0 ${
                              alert.severity === 'high' ? 'bg-rose-500/20 text-rose-400' : 
                              alert.severity === 'medium' ? 'bg-amber-500/20 text-amber-400' : 'bg-blue-500/20 text-blue-400'
                            }`}>
                              {alert.type === 'weather' && <CloudRain size={20} />}
                              {alert.type === 'contractor' && <Users size={20} />}
                              {alert.type === 'defect' && <ShieldAlert size={20} />}
                              {alert.type === 'evm' && <Target size={20} />}
                              {alert.type === 'bottleneck' && <Clock size={20} />}
                              {!['weather', 'contractor', 'defect', 'evm', 'bottleneck'].includes(alert.type) && <AlertTriangle size={20} />}
                            </div>
                            <div>
                              <h4 className={`font-bold text-sm ${
                                alert.severity === 'high' ? 'text-rose-300' : 
                                alert.severity === 'medium' ? 'text-amber-300' : 'text-blue-300'
                              }`}>{alert.title}</h4>
                              <span className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider">
                                {alert.type === 'weather' ? 'สภาพอากาศ & งานภายนอก' :
                                 alert.type === 'contractor' ? 'สภาพคล่อง & ภาระงานผู้รับเหมา' :
                                 alert.type === 'defect' || alert.type === 'bottleneck' ? 'คอขวด QC & งานแก้งาน' :
                                 alert.type === 'evm' ? 'EVM S-Curve กำหนดการโครงการ' : 'รายงานความเสี่ยง'}
                              </span>
                            </div>
                          </div>

                          <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black shrink-0 uppercase border ${
                            alert.severity === 'high' ? 'bg-rose-500/20 text-rose-300 border-rose-500/40' :
                            alert.severity === 'medium' ? 'bg-amber-500/20 text-amber-300 border-amber-500/40' :
                            'bg-blue-500/20 text-blue-300 border-blue-500/40'
                          }`}>
                            {alert.severity === 'high' ? 'ความเสี่ยงสูง' : alert.severity === 'medium' ? 'ควรเฝ้าระวัง' : 'ปกติ'}
                          </span>
                      </div>

                      <p className="text-slate-300 text-xs leading-relaxed mt-2">{alert.message}</p>
                    </div>

                    <div className="mt-4 pt-3 border-t border-slate-700/60">
                      <p className="text-indigo-300 text-xs font-bold flex items-start gap-1.5">
                        <span className="shrink-0">💡</span> <span>คำแนะนำเชิงกลยุทธ์: {alert.recommendation}</span>
                      </p>
                    </div>
                 </div>
               ))}
            </div>
         ) : !isAnalyzingAI && !aiAnalysisError && (
            <div className="text-center py-8 text-slate-400 font-bold text-sm bg-slate-900/60 rounded-2xl border border-slate-800">
               คลิกปุ่ม "วิเคราะห์เดี๋ยวนี้" เพื่อให้ AI ประมวลผลบทวิเคราะห์ 4 เสาหลักของโครงการ
            </div>
         )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 1. EVM S-Curve (Planned vs Actual) */}
        <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm hover:shadow-md transition-shadow lg:col-span-2">
          <div className="flex justify-between items-start mb-6">
             <div>
               <h3 className="font-black text-lg text-slate-800 flex items-center gap-2"><Target className="text-indigo-500" /> S-Curve Forecasting (EVM)</h3>
               <p className="text-xs text-slate-500 mt-1 font-medium">เปรียบเทียบมูลค่างานตามแผน (PV) กับผลงานที่ทำได้จริง (EV) เพื่อดูว่าโครงการเร็วกว่าหรือช้ากว่าแผน</p>
             </div>
          </div>
          <div className="h-[350px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={sCurveData} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 12, fontWeight: 700, fill: '#64748b' }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} domain={[0, 100]} tickFormatter={(val) => `${val}%`} />
                <RechartsTooltip 
                  cursor={{ stroke: '#e2e8f0', strokeWidth: 2, strokeDasharray: '5 5' }}
                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                />
                <Legend iconType="circle" wrapperStyle={{ paddingTop: '20px', fontSize: '12px', fontWeight: 700 }} />
                <Line type="monotone" dataKey="planned" name="Planned Value (PV)" stroke="#94a3b8" strokeWidth={3} dot={false} />
                <Line type="monotone" dataKey="actual" name="Earned Value (EV)" stroke="#3b82f6" strokeWidth={4} activeDot={{ r: 6 }} />
                <Line type="monotone" dataKey="forecast" name="Forecast (EAC)" stroke="#f59e0b" strokeWidth={3} strokeDasharray="5 5" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* 1.5 Cash Flow Forecast (Bar Chart) */}
        <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm hover:shadow-md transition-shadow lg:col-span-2 mt-2">
          <div className="flex justify-between items-start mb-6">
             <div>
               <h3 className="font-black text-lg text-slate-800 flex items-center gap-2"><TrendingUp className="text-emerald-500" /> Predictive Cash Flow Forecast</h3>
               <p className="text-xs text-slate-500 mt-1 font-medium">พยากรณ์กระแสเงินสดตามความคืบหน้า (อ้างอิงจาก Velocity ล่าสุด)</p>
             </div>
          </div>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={cashFlowData} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 12, fontWeight: 700, fill: '#64748b' }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} tickFormatter={(val) => `${(val/1000000).toFixed(1)}M`} />
                <RechartsTooltip 
                  cursor={{ fill: '#f1f5f9' }}
                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                  formatter={(value: any) => new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB', maximumFractionDigits: 0 }).format(Number(value) || 0)}
                />
                <Legend iconType="circle" wrapperStyle={{ paddingTop: '20px', fontSize: '12px', fontWeight: 700 }} />
                <Bar dataKey="plannedFlow" name="Planned Cash Outflow" fill="#cbd5e1" radius={[4, 4, 0, 0]} barSize={30} />
                <Bar dataKey="actualFlow" name="Actual Cash Outflow" fill="#3b82f6" radius={[4, 4, 0, 0]} barSize={30} />
                <Bar dataKey="forecastFlow" name="Predicted Cash Outflow" fill="#10b981" radius={[4, 4, 0, 0]} barSize={30} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* 2. Top QC Rejections (งานที่โดนตีกลับ/สั่งแก้ไขบ่อยที่สุด) */}
        <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm flex flex-col justify-center hover:shadow-md transition-shadow lg:col-span-2">
          <div className="mb-6">
            <h3 className="font-black text-lg text-slate-800 flex items-center gap-2">
              <ShieldAlert className="text-rose-500" /> งานที่โดนตีกลับ/แจ้งแก้ไขบ่อยที่สุด (Top QC Rejections)
            </h3>
            <p className="text-xs text-slate-500 mt-1 font-medium">
              จัดอันดับขั้นตอนงานที่ถูก QC หรือวิศวกรสั่งแก้ไข/ตีกลับบ่อยที่สุด เพื่อชี้เป้าจุดบกพร่องและควบคุมมาตรฐานฝีมือช่างเป็นพิเศษ
            </p>
          </div>
          <div className="space-y-4">
            {bottleneckData.length > 0 ? (
              bottleneckData.map((b: any, idx: number) => {
                const maxCount = bottleneckData[0]?.count || 1;
                const fillPercent = Math.max(15, Math.round((b.count / maxCount) * 100));
                const badgeColor =
                  idx === 0
                    ? 'bg-rose-100 text-rose-700 border border-rose-200'
                    : idx === 1
                    ? 'bg-amber-100 text-amber-700 border border-amber-200'
                    : 'bg-slate-100 text-slate-700 border border-slate-200';

                return (
                  <div key={idx} className="flex items-center gap-3">
                    <div className={`w-8 h-8 shrink-0 font-black rounded-full flex items-center justify-center text-sm ${badgeColor}`}>
                      {idx + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-sm text-slate-700 truncate">{b.taskName}</p>
                      <div className="w-full bg-slate-100 h-2 rounded-full mt-1.5 overflow-hidden">
                        <div
                          className="bg-gradient-to-r from-amber-500 to-rose-500 h-full rounded-full transition-all duration-500"
                          style={{ width: `${fillPercent}%` }}
                        />
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-black text-rose-600 text-sm">โดนตีกลับ {b.count} ครั้ง</div>
                      {b.avgWaitDays > 0 ? (
                        <div className="text-[11px] font-medium text-slate-400">เวลารอตรวจ {b.avgWaitDays} วัน</div>
                      ) : null}
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="text-center py-8 px-4 bg-emerald-50/60 rounded-2xl border border-emerald-100/80">
                <div className="text-2xl mb-1">🎉</div>
                <div className="text-emerald-700 font-bold text-sm">ยอดเยี่ยม! ไม่พบงานที่ถูกตีกลับหรือสั่งแก้ไข</div>
                <div className="text-xs text-emerald-600/80 mt-0.5">ทุกขั้นตอนผ่านการตรวจสอบตามมาตรฐานในโครงการที่เลือก</div>
              </div>
            )}
          </div>
        </div>



        {/* Good vs Bad Contractors Leaderboard */}
        <div className="lg:col-span-2 grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Top Performers */}
          <div className="bg-gradient-to-br from-emerald-50 to-teal-50 p-6 rounded-[2rem] border border-emerald-200 shadow-sm hover:shadow-md transition-shadow">
            <h4 className="font-black text-emerald-800 mb-4 flex items-center gap-2">
              <span className="text-xl">🏆</span> ช่างผลงานดีเด่น (Top Performers)
            </h4>
            <div className="space-y-3">
              {contractorPerformance.filter((c: any) => c.bayesianScore >= 80 && c.delayProbability <= 30)
                .sort((a: any, b: any) => b.bayesianScore - a.bayesianScore)
                .slice(0, 3)
                .map((c: any, idx: number) => (
                <div key={idx} className="bg-white/80 p-4 rounded-xl flex justify-between items-center border border-emerald-100 shadow-sm">
                  <div>
                    <p className="font-bold text-slate-800">{c.name}</p>
                    <p className="text-[10px] font-bold text-emerald-600 mt-0.5">
                      ตรงเวลา {c.onTimeRate}% • ตีกลับ {c.totalReworks} ครั้ง <span className="text-emerald-700/50">({c.completedTasksCount} งานที่เสร็จแล้ว)</span>
                    </p>
                  </div>
                  <div className="bg-emerald-100 text-emerald-700 px-3 py-1.5 rounded-lg text-xs font-black" title={`คะแนนความเชื่อมั่น (Bayesian): ${c.bayesianScore}`}>
                    Grade A
                  </div>
                </div>
              ))}
              {contractorPerformance.filter((c: any) => c.bayesianScore >= 80 && c.delayProbability <= 30).length === 0 && (
                <div className="text-center py-6 text-sm font-bold text-emerald-600/50">ยังไม่มีผู้รับเหมาที่ผ่านเกณฑ์ดีเด่น</div>
              )}
            </div>
          </div>

          {/* At-Risk Contractors */}
          <div className="bg-gradient-to-br from-rose-50 to-red-50 p-6 rounded-[2rem] border border-rose-200 shadow-sm hover:shadow-md transition-shadow">
            <h4 className="font-black text-rose-800 mb-4 flex items-center gap-2">
              <span className="text-xl">⚠️</span> ช่างต้องเฝ้าระวัง (At-Risk)
            </h4>
            <div className="space-y-3">
              {contractorPerformance.filter((c: any) => c.delayProbability > 50 || c.totalReworks > 3)
                .sort((a: any, b: any) => b.delayProbability - a.delayProbability)
                .slice(0, 3)
                .map((c: any, idx: number) => (
                <div key={idx} className="bg-white/80 p-4 rounded-xl flex justify-between items-center border border-rose-100 shadow-sm">
                  <div>
                    <p className="font-bold text-slate-800">{c.name}</p>
                    <p className="text-[10px] font-bold text-rose-600 mt-0.5">เสี่ยงล่าช้า {c.delayProbability}% • ตีกลับ {c.totalReworks} ครั้ง ({c.completedTasksCount} งานที่เสร็จแล้ว)</p>
                  </div>
                  <div className="bg-rose-100 text-rose-700 px-3 py-1.5 rounded-lg text-xs font-black">
                    Grade C
                  </div>
                </div>
              ))}
              {contractorPerformance.filter((c: any) => c.delayProbability > 50 || c.totalReworks > 3).length === 0 && (
                <div className="text-center py-6 text-sm font-bold text-rose-600/50">ไม่มีผู้รับเหมาในกลุ่มเสี่ยง 🎉</div>
              )}
            </div>
          </div>
        </div>

        {/* 4. Team Performance Matrix (Foreman) */}
        <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm hover:shadow-md transition-shadow lg:col-span-2">
          <div className="mb-6">
            <h3 className="font-black text-lg text-slate-800 flex items-center gap-2"><Award className="text-yellow-500" /> Foreman Leadership Matrix</h3>
            <p className="text-xs text-slate-500 mt-1 font-medium">ประเมินจาก: % ส่งงานตรงเวลาของ <span className="font-bold text-slate-700">"งานที่จบแล้วจริง"</span>, จำนวนครั้งที่ถูก QC แจ้งแก้, และจำนวน Defect</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className="p-3 text-xs font-black uppercase text-slate-500">Foreman</th>
                  <th className="p-3 text-xs font-black uppercase text-slate-500 text-center">Completed Tasks</th>
                  <th className="p-3 text-xs font-black uppercase text-slate-500 text-center">On-time %</th>
                  <th className="p-3 text-xs font-black uppercase text-slate-500 text-center">Reworks</th>
                  <th className="p-3 text-xs font-black uppercase text-slate-500 text-center">SPI / Quality Grade</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {foremanPerformance.slice(0, 5).map((f: any, idx: number) => (
                  <tr key={idx} className="hover:bg-slate-50 transition-colors">
                    <td className="p-3 font-bold text-sm text-slate-700 flex items-center gap-2">
                      {idx === 0 && f.onTimeRate !== -1 && <span className="text-yellow-500 text-lg">👑</span>}
                      {f.name}
                    </td>
                    <td className="p-3 text-center font-bold text-sm text-slate-600">{f.completedTasks} งาน</td>
                    <td className="p-3 text-center">
                      {f.onTimeRate === -1 ? (
                        <span className="font-black text-xs px-2 py-1 rounded-md bg-slate-100 text-slate-400">N/A</span>
                      ) : (
                        <span className={`font-black text-xs px-2 py-1 rounded-md ${f.onTimeRate >= 80 ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>{f.onTimeRate}%</span>
                      )}
                    </td>
                    <td className="p-3 text-center font-bold text-sm text-slate-600">{f.totalReworks}</td>
                    <td className="p-3 text-center">
                      <span className={`font-black text-xs px-3 py-1 rounded-full ${
                        f.riskLevel === 'N/A' ? 'bg-slate-50 text-slate-400' :
                        f.riskLevel === 'Low' ? 'bg-emerald-50 text-emerald-600' :
                        f.riskLevel === 'Medium' ? 'bg-amber-50 text-amber-600' : 'bg-rose-50 text-rose-600'
                      }`}>
                        {f.riskLevel === 'N/A' ? 'ยังไม่มีข้อมูล' : f.riskLevel === 'Low' ? 'Grade A (Excellent)' : f.riskLevel === 'Medium' ? 'Grade B (Average)' : 'Grade C (Action Needed)'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* 5. Performance Heatmaps (Weekly & Billing Cycle) */}
        <div className="lg:col-span-2 space-y-6">
           <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              <WeeklyHeatmap data={qcSePerformance} roleFilter="se" title="Weekly Work Habits (Site Engineer)" colorScheme="blue" />
              <WeeklyHeatmap data={qcSePerformance} roleFilter="qc" title="Weekly Work Habits (QC)" colorScheme="purple" />
           </div>
           <div className="grid grid-cols-1 gap-6">
              <BillingCycleHeatmap data={qcSePerformance} />
           </div>
        </div>

      </div>
    </div>
  );
}
