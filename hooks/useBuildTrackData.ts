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
  
  // 📈 Derived / Mapped Data States
  const [latestUpdatesMap, setLatestUpdatesMap] = useState<any>({});
  const [taskDates, setTaskDates] = useState<any>({});
  const [allUpdatesRecord, setAllUpdatesRecord] = useState<any[]>([]);

  const fetchWithoutLimit = async (table: string, projectName?: string | null) => {
    let allData: any[] = [];
    let from = 0; let to = 999;
    let hasMore = true;
    while (hasMore) {
      let query = supabase.from(table).select('*').range(from, to);
      
      const { data, error } = await query;
      if (error) {
        console.error(`Error in fetchWithoutLimit for table ${table}:`, error);
        break;
      }
      if (data && data.length > 0) {
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
        { data: tasks },
        { data: plotsData },
        { data: contData },
        { data: notifData },
        { data: plotProgressData },
        { data: projectProgressData },
        assignData,
        schedulesData,
        { data: recentUpdates },
        { data: defectsData }
      ] = await Promise.all([
        supabase.from('projects').select('*').order('created_at', { ascending: true }),
        supabase.from('house_types').select('*'),
        supabase.from('task_templates').select('*').order('task_order', { ascending: true }),
        supabase.from('plots').select('*, house_types(type_name)').order('created_at', { ascending: true }),
        supabase.from('contractors').select('*'),
        supabase.from('notifications').select('*').or(`target_user.eq.${loggedInUser.username},target_role.eq.${loggedInUser.role}`).order('created_at', { ascending: false }),
        supabase.from('vw_plot_progress').select('*'),
        supabase.from('vw_project_progress').select('*'),
        fetchWithoutLimit('plot_task_assignments', selectedProjectName),
        fetchWithoutLimit('plot_task_schedules', selectedProjectName),
        supabase.from('task_updates').select('*').order('created_at', { ascending: false }).limit(3000),
        supabase.from('defects').select('*').order('created_at', { ascending: false })
      ]);

      setNotifications(notifData || []);
      setDefects(defectsData || []);
      setAssignments(assignData || []);
      setContractors(contData || []);
      setAllUpdatesRecord(recentUpdates || []);
      
      const latestUpdates: any = {}; 
      const tDates: any = {};
      const newSched: any = {};

      schedulesData?.forEach((s: any) => { newSched[`${s.plot_id}-${s.task_template_id}`] = s; });
      setSchedules(newSched);
      
      // We populate latestUpdatesMap and taskDates from the new DB columns in plot_task_assignments
      assignData?.forEach((assign: any) => { 
        const key = `${assign.plot_id}-${assign.task_template_id}`; 
        latestUpdates[key] = {
           plot_id: assign.plot_id,
           task_template_id: assign.task_template_id,
           progress: assign.current_progress || 0,
           actual_end_date: assign.actual_end_date,
        }; 
        tDates[key] = { start: assign.actual_start_date, end: assign.actual_end_date };
      });
      
      // Inspection Queue needs action, role, and created_at
      recentUpdates?.forEach((upd: any) => {
        const key = `${upd.plot_id}-${upd.task_template_id}`;
        if (latestUpdates[key] && !latestUpdates[key].action) {
          latestUpdates[key].action = upd.action;
          latestUpdates[key].role = upd.role;
          latestUpdates[key].created_at = upd.created_at;
          latestUpdates[key].progress = upd.progress;
        } else if (!latestUpdates[key]) {
          latestUpdates[key] = {
            plot_id: upd.plot_id,
            task_template_id: upd.task_template_id,
            progress: upd.progress,
            action: upd.action,
            role: upd.role,
            created_at: upd.created_at
          };
        }
      });
      
      setLatestUpdatesMap(latestUpdates); 
      setTaskDates(tDates);

      const formattedPlots = plotsData?.map((plot: any) => {
        const progressRecord = plotProgressData?.find((p: any) => p.plot_id === plot.id);
        return { 
          ...plot, 
          type: plot.house_types?.type_name || 'ไม่ระบุแบบ', 
          foreman: plot.foreman_name, 
          progress: progressRecord ? Number(progressRecord.overall_progress) : 0 
        };
      });

      const formattedProjects = projs?.map((proj: any) => {
        const progressRecord = projectProgressData?.find((p: any) => p.project_name === proj.name);
        const uniqueMigrated = Array.from(new Map((proj.layout_data || []).map((item: any) => [item.id, item])).values());
        return { 
          name: proj.name, 
          layout_data: uniqueMigrated, 
          plotCount: progressRecord ? Number(progressRecord.plot_count) : 0, 
          progress: progressRecord ? Number(progressRecord.project_progress) : 0 
        };
      });

      setHouseTypes(types || []); 
      setTaskTemplates(tasks || []); 
      setPlots(formattedPlots || []); 
      setProjects(formattedProjects || []); 
      setLoading(false);
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
        updData?.forEach((upd: any) => {
          const key = `${upd.plot_id}-${upd.task_template_id}`;
          if (newMap[key] && !newMap[key].action) {
            newMap[key].action = upd.action;
            newMap[key].role = upd.role;
            newMap[key].created_at = upd.created_at;
          } else if (!newMap[key]) {
            newMap[key] = {
              plot_id: upd.plot_id,
              task_template_id: upd.task_template_id,
              progress: upd.progress,
              action: upd.action,
              role: upd.role,
              created_at: upd.created_at
            };
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
      const [assignData, schedData, { data: updData }, { data: defData }] = await Promise.all([
        fetchWithoutLimit('plot_task_assignments'),
        fetchWithoutLimit('plot_task_schedules'),
        supabase.from('task_updates').select('*').order('created_at', { ascending: false }),
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
                created_at: newUpdate.created_at
              }
            };
          });
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
    togglePlotSaleStatus
  };
}
