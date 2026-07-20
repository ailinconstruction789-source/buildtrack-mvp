import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

export function useBuildTrackData(loggedInUser: any, selectedProjectName?: string | null) {
  const [loading, setLoading] = useState(true);
  
  // 🏢 Core Data States
  const [projects, setProjects] = useState<any[]>([]);
  const [houseTypes, setHouseTypes] = useState<any[]>([]);
  const [taskTemplates, setTaskTemplates] = useState<any[]>([]);
  const [plots, setPlots] = useState<any[]>([]);
  const [contractors, setContractors] = useState<any[]>([]);
  const [allUsers, setAllUsers] = useState<any[]>([]);
  
  // 📊 Dynamic Data States
  const [assignments, setAssignments] = useState<any[]>([]);
  const [schedules, setSchedules] = useState<any>({});
  const [defects, setDefects] = useState<any[]>([]);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [materialRequests, setMaterialRequests] = useState<any[]>([]);
  const [materialReceipts, setMaterialReceipts] = useState<any[]>([]);
  
  // 📈 Derived / Mapped Data States
  const [latestUpdatesMap, setLatestUpdatesMap] = useState<any>({});
  const [taskDates, setTaskDates] = useState<any>({});
  const [allUpdatesRecord, setAllUpdatesRecord] = useState<any[]>([]);
  const [inspectionQueueView, setInspectionQueueView] = useState<any[]>([]);
  const [plotStatuses, setPlotStatuses] = useState<any[]>([]);

  const fetchWithoutLimit = async (table: string, projectName?: string | null, orderBy: string = 'id', ascending: boolean = true, selectQuery: string = '*', secondaryOrderBy: string | null = 'id') => {
    let allData: any[] = [];
    let from = 0; let to = 999;
    let hasMore = true;

    while (hasMore) {
      let query;
      // Use PostgREST embedded filtering if we need to filter by project_name
      if (projectName && projectName !== 'all' && (table === 'plot_task_assignments' || table === 'plot_task_schedules' || table === 'vw_active_plot_task_assignments')) {
        query = supabase.from(table)
          .select(`${selectQuery}, plots!inner(project_name)`)
          .eq('plots.project_name', projectName)
          .order(orderBy, { ascending });
      } else if (projectName && projectName !== 'all' && (table === 'plots' || table === 'vw_plot_progress')) {
        query = supabase.from(table)
          .select(selectQuery)
          .eq('project_name', projectName)
          .order(orderBy, { ascending });
      } else {
        query = supabase.from(table).select(selectQuery).order(orderBy, { ascending });
      }
      
      // Ensure stable pagination by adding a secondary sort (if provided and different from primary)
      if (secondaryOrderBy && orderBy !== secondaryOrderBy) {
        query = query.order(secondaryOrderBy, { ascending: true });
      }
      query = query.range(from, to);
      
      const { data, error } = await query;
      if (error) {
        // Fallback to fetch all if the inner join fails (e.g. no explicit foreign key defined in PostgREST cache)
        if (projectName && projectName !== 'all') {
           console.warn(`Optimized fetch failed for ${table}, falling back to full fetch. Please ensure foreign keys are defined or run SQL migrations.`);
           let fallbackQuery = supabase.from(table).select(selectQuery).order(orderBy, { ascending });
           if (secondaryOrderBy && orderBy !== secondaryOrderBy) fallbackQuery = fallbackQuery.order(secondaryOrderBy, { ascending: true });
           fallbackQuery = fallbackQuery.range(from, to);
           
           const fallbackResult = await fallbackQuery;
           if (fallbackResult.error) {
             console.error(`Fallback error in fetchWithoutLimit for table ${table}:`, fallbackResult.error);
             break;
           }
           if (fallbackResult.data && fallbackResult.data.length > 0) {
             allData = [...allData, ...fallbackResult.data];
             from += 1000; to += 1000;
             if (fallbackResult.data.length < 1000) hasMore = false;
           } else { hasMore = false; }
        } else {
           console.error(`Error in fetchWithoutLimit for table ${table}:`, error);
           break;
        }
      } else if (data && data.length > 0) {
        allData = [...allData, ...data];
        from += 1000; to += 1000;
        if (data.length < 1000) hasMore = false;
      } else { hasMore = false; }
    }
    return allData;
  };

  const fetchAllData = useCallback(async () => {
    if (!loggedInUser) return;
    
    try {
      setLoading(true);

      const [
        { data: projs },
        { data: types },
        tasks,
        plotsData,
        { data: contData },
        { data: notifData },
        plotProgressData,
        { data: projectProgressData },
        assignData,
        schedulesData,
        recentUpdates,
        defectsData,
        { data: materialReqData },
        { data: materialReceiptData },
        { data: inspectionQueueData },
        { data: plotStatusesData }
      ] = await Promise.all([
        supabase.from('projects').select('*').order('created_at', { ascending: true }),
        supabase.from('house_types').select('*'),
        fetchWithoutLimit('task_templates', null, 'task_order', true),
        fetchWithoutLimit('plots', selectedProjectName, 'created_at', true, '*, house_types(type_name)'),
        supabase.from('contractors').select('*'),
        supabase.from('notifications').select('*').or(`target_user.eq.${loggedInUser.username},target_role.eq.${loggedInUser.role}`).order('created_at', { ascending: false }),
        fetchWithoutLimit('vw_plot_progress', selectedProjectName, 'plot_id', true, '*', null),
        supabase.from('vw_project_progress').select('*'),
        fetchWithoutLimit('vw_active_plot_task_assignments', selectedProjectName),
        fetchWithoutLimit('plot_task_schedules', selectedProjectName),
        supabase.from('task_updates').select('*').order('created_at', { ascending: false }).limit(1000).then(res => res.data || []),
        supabase.from('defects').select('*').order('created_at', { ascending: false }).limit(500).then(res => res.data || []),
        supabase.from('vw_task_material_requests').select('*'),
        supabase.from('task_material_receipts').select('*').order('created_at', { ascending: true }),
        supabase.from('vw_inspection_queue').select('*'),
        supabase.from('vw_plot_status_dashboard').select('*')
      ]);

      setNotifications(notifData || []);
      setDefects(defectsData || []);
      setMaterialRequests(materialReqData || []);
      setMaterialReceipts(materialReceiptData || []);
      setInspectionQueueView(inspectionQueueData || []);
      setPlotStatuses(plotStatusesData || []);
      setAssignments((prev: any) => {
        const newMap = new Map(assignData?.map((a: any) => [a.id, a]) || []);
        prev?.forEach((p: any) => { if (!newMap.has(p.id)) newMap.set(p.id, p); });
        return Array.from(newMap.values());
      });
      setContractors(contData || []);
      setAllUpdatesRecord((prev: any) => {
        const newMap = new Map(recentUpdates?.map((u: any) => [u.id, u]) || []);
        prev?.forEach((p: any) => { if (!newMap.has(p.id)) newMap.set(p.id, p); });
        return Array.from(newMap.values()).sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      });
      
      const latestUpdates: any = {}; 
      const tDates: any = {};
      const newSched: any = {};

      schedulesData?.forEach((s: any) => { newSched[`${s.plot_id}-${s.task_template_id}`] = s; });
      setSchedules((prev: any) => ({...prev, ...newSched}));
      
      // We populate latestUpdatesMap and taskDates from the new DB columns in plot_task_assignments
      assignData?.forEach((assign: any) => { 
        const key = `${assign.plot_id}-${assign.task_template_id}`; 
        latestUpdates[key] = {
           plot_id: assign.plot_id,
           task_template_id: assign.task_template_id,
           progress: assign.current_progress || 0,
           actual_end_date: assign.actual_end_date,
           action: assign.latest_action,
           role: assign.latest_role,
           created_at: assign.latest_update_created_at
        }; 
        tDates[key] = { start: assign.actual_start_date, end: assign.actual_end_date };
      });
      
      // Inspection Queue needs action, role, and created_at
      const seenTaskUpdates = new Set();
      recentUpdates?.forEach((upd: any) => {
        const key = `${upd.plot_id}-${upd.task_template_id}`;
        if (!seenTaskUpdates.has(key)) {
          seenTaskUpdates.add(key);
          if (latestUpdates[key]) {
            // ONLY use task_updates as fallback if assignData didn't have latest_action
            if (!latestUpdates[key].action) {
              latestUpdates[key].action = upd.action;
              latestUpdates[key].role = upd.role;
              latestUpdates[key].created_at = upd.created_at;
              latestUpdates[key].progress = upd.progress;
            }
          } else {
            latestUpdates[key] = {
              plot_id: upd.plot_id,
              task_template_id: upd.task_template_id,
              progress: upd.progress,
              action: upd.action,
              role: upd.role,
              created_at: upd.created_at
            };
          }
        }
      });
      
      setLatestUpdatesMap(latestUpdates); 
      setTaskDates(tDates);

      const formattedPlots = plotsData?.map((plot: any) => {
        const progressRecord = plotProgressData?.find((p: any) => p.plot_id === plot.id);
        return { 
          ...plot, 
          has_customer: !!plot.has_customer,
          type: plot.house_types?.type_name || 'ไม่ระบุแบบ', 
          foreman: plot.foreman_name, 
          progress: progressRecord ? Number(progressRecord.overall_progress) : 0 
        };
      }).sort((a: any, b: any) => (a.id || '').localeCompare(b.id || '', undefined, { numeric: true, sensitivity: 'base' }));

      const formattedProjects = projs?.map((proj: any) => {
        const progressRecord = projectProgressData?.find((p: any) => p.project_name === proj.name);
        const uniqueMigrated = Array.from(new Map((proj.layout_data || []).map((item: any) => [item.id, item])).values());
        return { 
          name: proj.name, 
          layout_data: uniqueMigrated, 
          plotCount: plotsData?.filter((p: any) => p.project_name === proj.name).length || 0, 
          progress: progressRecord ? Number(progressRecord.project_progress) : 0,
          is_closed: !!proj.is_closed 
        };
      });

      setHouseTypes(types || []); 
      setTaskTemplates(tasks || []); 
      setPlots(formattedPlots || []); 
      setProjects(formattedProjects || []); 
      setLoading(false);

      // 🌟 BACKGROUND LAZY LOAD: Fetch archive data 3 seconds after active data is loaded
      // This ensures the Analytics pages have full history without slowing down the initial app load
      setTimeout(async () => {
        try {
          const [archiveAssign, archiveUpdatesData] = await Promise.all([
            fetchWithoutLimit('plot_task_assignments', selectedProjectName),
            fetchWithoutLimit('task_updates', null, 'created_at', false)
          ]);
          const archiveUpdates = archiveUpdatesData || [];
          
          if (!archiveAssign || archiveAssign.length === 0) return;

          setAssignments((prev: any) => {
            const newMap = new Map(archiveAssign.map((a: any) => [a.id, a]));
            prev?.forEach((p: any) => { if (!newMap.has(p.id)) newMap.set(p.id, p); });
            return Array.from(newMap.values());
          });
          
          setAllUpdatesRecord((prev: any) => {
            const newMap = new Map(archiveUpdates?.map((u: any) => [u.id, u]) || []);
            prev?.forEach((p: any) => { if (!newMap.has(p.id)) newMap.set(p.id, p); });
            return Array.from(newMap.values()).sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
          });

          setTaskDates((prev: any) => {
             const tDates = { ...prev };
             archiveAssign.forEach((assign: any) => {
               const key = `${assign.plot_id}-${assign.task_template_id}`; 
               if (!tDates[key]) {
                  tDates[key] = { start: assign.actual_start_date, end: assign.actual_end_date };
               }
             });
             return tDates;
          });

          setLatestUpdatesMap((prev: any) => {
             const latestUpdates = { ...prev };
             archiveAssign.forEach((assign: any) => { 
                const key = `${assign.plot_id}-${assign.task_template_id}`; 
                if (!latestUpdates[key]) {
                  latestUpdates[key] = {
                     plot_id: assign.plot_id,
                     task_template_id: assign.task_template_id,
                     progress: assign.current_progress || 0,
                     actual_end_date: assign.actual_end_date,
                     action: assign.latest_action,
                     role: assign.latest_role,
                     created_at: assign.latest_update_created_at
                  };
                }
             });
             const seenArchiveUpdates = new Set();
             archiveUpdates?.forEach((upd: any) => {
                const key = `${upd.plot_id}-${upd.task_template_id}`;
                if (!seenArchiveUpdates.has(key)) {
                  seenArchiveUpdates.add(key);
                  if (latestUpdates[key]) {
                    // ONLY use archive updates as fallback if assignData didn't have latest_action
                    if (!latestUpdates[key].action) {
                      latestUpdates[key].action = upd.action;
                      latestUpdates[key].role = upd.role;
                      latestUpdates[key].created_at = upd.created_at;
                      latestUpdates[key].progress = upd.progress;
                    }
                  } else {
                    latestUpdates[key] = {
                      plot_id: upd.plot_id,
                      task_template_id: upd.task_template_id,
                      progress: upd.progress,
                      action: upd.action,
                      role: upd.role,
                      created_at: upd.created_at
                    };
                  }
                }
             });
             return latestUpdates;
          });
        } catch (e) {
          console.error("Background archive load failed", e);
        }
      }, 3000);

    } catch (error) {
      console.error('Error fetching core data:', error);
      setLoading(false);
    }
  }, [loggedInUser, selectedProjectName]);

  // 🌟 ฟังก์ชันโหลดข้อมูลเจาะจงแปลง (Lazy Load Plot Details)
  const fetchPlotDetails = useCallback(async (plotId: string) => {
    try {
      const [
        { data: assignData },
        { data: schedData },
        { data: updData },
        { data: defData }
      ] = await Promise.all([
        supabase.from('plot_task_assignments').select('*').eq('plot_id', plotId),
        supabase.from('plot_task_schedules').select('*').eq('plot_id', plotId),
        supabase.from('task_updates').select('*').eq('plot_id', plotId).order('created_at', { ascending: false }),
        supabase.from('defects').select('*').eq('plot_id', plotId).order('created_at', { ascending: false })
      ]);

      setAssignments((prev: any) => {
        const others = prev.filter((a: any) => a.plot_id !== plotId);
        return [...others, ...(assignData || [])];
      });

      setSchedules((prev: any) => {
        const newSched = { ...prev };
        schedData?.forEach((s: any) => { newSched[`${s.plot_id}-${s.task_template_id}`] = s; });
        return newSched;
      });

      setTaskDates((prev: any) => {
        const newDates = { ...prev };
        assignData?.forEach((a: any) => {
          newDates[`${a.plot_id}-${a.task_template_id}`] = { start: a.actual_start_date, end: a.actual_end_date };
        });
        return newDates;
      });

      setLatestUpdatesMap((prev: any) => {
        const newMap = { ...prev };
        assignData?.forEach((a: any) => {
          const key = `${a.plot_id}-${a.task_template_id}`;
          if (!newMap[key]) {
            newMap[key] = { plot_id: a.plot_id, task_template_id: a.task_template_id, progress: a.current_progress || 0 };
          } else {
            newMap[key].progress = a.current_progress || 0;
          }
        });
        const seenTasks = new Set();
        updData?.forEach((upd: any) => {
          const key = `${upd.plot_id}-${upd.task_template_id}`;
          if (!seenTasks.has(key)) {
            seenTasks.add(key);
            if (!newMap[key]) {
              newMap[key] = {
                plot_id: upd.plot_id,
                task_template_id: upd.task_template_id,
                progress: upd.progress,
                action: upd.action,
                role: upd.role,
                created_at: upd.created_at
              };
            } else {
              // ONLY use task updates as fallback if assignData didn't have latest_action
              if (!newMap[key].action) {
                newMap[key].action = upd.action;
                newMap[key].role = upd.role;
                newMap[key].created_at = upd.created_at;
                newMap[key].progress = upd.progress;
              }
            }
          }
        });
        return newMap;
      });

      setAllUpdatesRecord((prev: any) => {
        const others = prev.filter((u: any) => u.plot_id !== plotId);
        return [...others, ...(updData || [])];
      });

      setDefects((prev: any) => {
        const others = prev.filter((d: any) => d.plot_id !== plotId);
        return [...others, ...(defData || [])];
      });

    } catch (err) {
      console.error('Error fetching plot details:', err);
    }
  }, []);

  // 🌟 ฟังก์ชันโหลดข้อมูล Analytics ผู้บริหาร
  const fetchOwnerAnalyticsData = useCallback(async () => {
    try {
      const [assignData, schedData, updData, { data: defData }] = await Promise.all([
        fetchWithoutLimit('plot_task_assignments'),
        fetchWithoutLimit('plot_task_schedules'),
        fetchWithoutLimit('task_updates', null, 'created_at', false),
        supabase.from('defects').select('*').order('created_at', { ascending: false })
      ]);

      const latestUpdates: any = {}; 
      const tDates: any = {}; 
      const newSched: any = {};

      schedData?.forEach((s: any) => { newSched[`${s.plot_id}-${s.task_template_id}`] = s; });
      setSchedules(newSched);
      
      assignData?.forEach((assign: any) => { 
        const key = `${assign.plot_id}-${assign.task_template_id}`; 
        latestUpdates[key] = {
           plot_id: assign.plot_id,
           task_template_id: assign.task_template_id,
           progress: assign.current_progress || 0,
        }; 
        tDates[key] = { start: assign.actual_start_date, end: assign.actual_end_date };
      });
      
      updData?.forEach((upd: any) => {
        const key = `${upd.plot_id}-${upd.task_template_id}`;
        if (latestUpdates[key] && !latestUpdates[key].action) {
          latestUpdates[key].action = upd.action;
          latestUpdates[key].role = upd.role;
          latestUpdates[key].created_at = upd.created_at;
        }
      });
      
      setLatestUpdatesMap(latestUpdates); 
      setTaskDates(tDates);
      setAllUpdatesRecord(updData || []);
      setDefects(defData || []);

    } catch (err) {
      console.error('Error fetching analytics:', err);
    }
  }, []);

  const fetchUsers = useCallback(async () => {
    try {
      const { data } = await supabase.from('users').select('*').order('role', { ascending: true }).order('username', { ascending: true });
      if (data) setAllUsers(data);
    } catch (error) {
      console.error('Error fetching users:', error);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  useEffect(() => {
    if (loggedInUser) fetchAllData();
  }, [loggedInUser, fetchAllData]);

  useEffect(() => {
    if (!loggedInUser) return;

    const channel = supabase
      .channel('realtime_task_updates')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'task_updates' },
        (payload) => {
          const newUpdate = payload.new;
          setAllUpdatesRecord((prev) => [newUpdate, ...prev]);
          setLatestUpdatesMap((prev: any) => {
            const key = `${newUpdate.plot_id}-${newUpdate.task_template_id}`;
            return {
              ...prev,
              [key]: {
                ...prev[key],
                plot_id: newUpdate.plot_id,
                task_template_id: newUpdate.task_template_id,
                progress: newUpdate.progress,
                created_at: newUpdate.created_at,
                action: newUpdate.action,
                role: newUpdate.role
              }
            };
          });
          
          // Refresh the queue when an update arrives
          supabase.from('vw_inspection_queue').select('*').then(({data}) => {
             if (data) setInspectionQueueView(data);
          });
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'task_material_requests' },
        async () => {
          // Refresh material requests and receipts when changes happen
          const [
            { data: materialReqData },
            { data: materialReceiptData }
          ] = await Promise.all([
            supabase.from('vw_task_material_requests').select('*'),
            supabase.from('task_material_receipts').select('*').order('created_at', { ascending: true })
          ]);
          if (materialReqData) setMaterialRequests(materialReqData);
          if (materialReceiptData) setMaterialReceipts(materialReceiptData);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loggedInUser]);

  const togglePlotSaleStatus = async (plotId: string, currentStatus: string, pausedAt: string | null) => {
    try {
      if (currentStatus === 'active' || !currentStatus) {
        // Pause plot
        const { error } = await supabase.from('plots').update({ 
          sale_status: 'ready_for_sale', 
          paused_for_sale_at: new Date().toISOString() 
        }).eq('id', plotId);
        if (error) throw error;
      } else if (currentStatus === 'ready_for_sale') {
        // Resume plot
        if (pausedAt) {
          const offsetMs = Date.now() - new Date(pausedAt).getTime();
          
          const { data: plotSchedules } = await supabase.from('plot_task_schedules').select('*').eq('plot_id', plotId);
          if (plotSchedules) {
            for (const sched of plotSchedules) {
               const key = `${plotId}-${sched.task_template_id}`;
               const progress = latestUpdatesMap[key]?.progress || 0;
               if (progress < 100) {
                 const newStart = new Date(new Date(sched.planned_start).getTime() + offsetMs).toISOString();
                 const newEnd = new Date(new Date(sched.planned_end).getTime() + offsetMs).toISOString();
                 await supabase.from('plot_task_schedules').update({
                    planned_start: newStart,
                    planned_end: newEnd
                 }).eq('id', sched.id);
               }
            }
          }
        }
        
        const { error } = await supabase.from('plots').update({ 
          sale_status: 'active', 
          paused_for_sale_at: null 
        }).eq('id', plotId);
        if (error) throw error;
      }
      
      await fetchAllData();
      return true;
    } catch (e) {
      console.error("Error toggling sale status:", e);
      return false;
    }
  };

  const resetHandoverCycle = async (plotId: string, currentCycle: number) => {
    try {
      const { error } = await supabase.from('plots').update({
        handover_cycle: (currentCycle || 1) + 1,
        inspection_round: 0
      }).eq('id', plotId);
      if (error) throw error;
      await fetchPlotDetails(plotId);
      await fetchAllData();
      return true;
    } catch (e) {
      console.error("Error resetting handover cycle:", e);
      return false;
    }
  };

  const updateInspectionRound = async (plotId: string, newRound: number) => {
    try {
      const { error } = await supabase.from('plots').update({
        inspection_round: newRound
      }).eq('id', plotId);
      if (error) throw error;
      await fetchPlotDetails(plotId);
      await fetchAllData();
      return true;
    } catch (e) {
      console.error("Error updating inspection round:", e);
      return false;
    }
  };

  return {
    loading, setLoading,
    projects, setProjects,
    houseTypes, setHouseTypes,
    taskTemplates, setTaskTemplates,
    plots, setPlots,
    contractors, setContractors,
    allUsers, setAllUsers,
    assignments, setAssignments,
    schedules, setSchedules,
    defects,
    setDefects,
    notifications, setNotifications,
    latestUpdatesMap, setLatestUpdatesMap,
    taskDates, setTaskDates,
    allUpdatesRecord, setAllUpdatesRecord,
    fetchAllData,
    fetchPlotDetails,
    fetchOwnerAnalyticsData,
    fetchWithoutLimit,
    togglePlotSaleStatus,
    resetHandoverCycle,
    updateInspectionRound,
    materialRequests,
    setMaterialRequests,
    materialReceipts,
    setMaterialReceipts,
    inspectionQueueView,
    setInspectionQueueView,
    plotStatuses
  };
}
