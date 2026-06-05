import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

export function useBuildTrackData(loggedInUser: any) {
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

  const fetchWithoutLimit = async (table: string) => {
    let allData: any[] = [];
    let from = 0; let to = 999;
    let hasMore = true;
    while (hasMore) {
      const { data, error } = await supabase.from(table).select('*').range(from, to);
      if (error) break;
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
        { data: recentUpdates }
      ] = await Promise.all([
        supabase.from('projects').select('*').order('created_at', { ascending: true }),
        supabase.from('house_types').select('*'),
        supabase.from('task_templates').select('*').order('task_order', { ascending: true }),
        supabase.from('plots').select('*, house_types(type_name)').order('created_at', { ascending: true }),
        supabase.from('contractors').select('*'),
        // Only fetch relevant notifications at the DB layer
        supabase.from('notifications')
          .select('*')
          .or(`target_user.eq.${loggedInUser.username},target_role.eq.${loggedInUser.role}`)
          .order('created_at', { ascending: false }),
        supabase.from('vw_plot_progress').select('*'),
        supabase.from('vw_project_progress').select('*'),
        fetchWithoutLimit('plot_task_assignments'),
        fetchWithoutLimit('plot_task_schedules'),
        supabase.from('task_updates').select('*').order('created_at', { ascending: false }).limit(200) // For global feed
      ]);

      setNotifications(notifData || []);
      setAssignments(assignData || []); 
      setContractors(contData || []); 
      setAllUpdatesRecord(recentUpdates || []);
      
      const latestUpdates: any = {}; 
      const tDates: any = {}; 
      const newSched: any = {};

      schedulesData?.forEach((s: any) => { newSched[`${s.plot_id}-${s.task_template_id}`] = s; });
      setSchedules(newSched);
      
      // We populate latestUpdatesMap and taskDates from the new DB columns in plot_task_assignments
      // instead of looping through all task_updates.
      assignData?.forEach((assign: any) => { 
        const key = `${assign.plot_id}-${assign.task_template_id}`; 
        latestUpdates[key] = {
           plot_id: assign.plot_id,
           task_template_id: assign.task_template_id,
           progress: assign.current_progress || 0,
        }; 
        tDates[key] = { start: assign.actual_start_date, end: assign.actual_end_date };
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
      
    } catch (error) { 
      console.error('Error fetching data:', error); 
    } finally { 
      setLoading(false); 
    }
  }, [loggedInUser]);

  // Atomic fetch function for lazy loading heavy specific plot data
  const fetchPlotDetails = useCallback(async (plotId: string) => {
    try {
      const [
        { data: schedulesData },
        { data: updatesData },
        { data: defectsData }
      ] = await Promise.all([
        supabase.from('plot_task_schedules').select('*').eq('plot_id', plotId),
        supabase.from('task_updates').select('*').eq('plot_id', plotId).order('created_at', { ascending: true }),
        supabase.from('defects').select('*').eq('plot_id', plotId)
      ]);

      setSchedules((prev: any) => {
        const newSched = { ...prev };
        schedulesData?.forEach((s: any) => { newSched[`${s.plot_id}-${s.task_template_id}`] = s; });
        return newSched;
      });

      setDefects((prev: any) => {
        const existingWithoutCurrentPlot = prev.filter((d: any) => d.plot_id !== plotId);
        return [...existingWithoutCurrentPlot, ...(defectsData || [])];
      });

      // Update latestUpdatesMap so action fields are populated for QC logic if viewed
      if (updatesData && updatesData.length > 0) {
        setLatestUpdatesMap((prev: any) => {
           const newUpdates = { ...prev };
           updatesData.forEach((upd: any) => {
              newUpdates[`${upd.plot_id}-${upd.task_template_id}`] = upd;
           });
           return newUpdates;
        });
        
        // Also merge into allUpdatesRecord so history is available for this plot
        setAllUpdatesRecord((prev: any) => {
           const existing = prev.filter((u: any) => u.plot_id !== plotId);
           return [...existing, ...updatesData];
        });
      }
    } catch (error) {
      console.error(`Error fetching details for plot ${plotId}:`, error);
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
    defects, setDefects,
    notifications, setNotifications,
    latestUpdatesMap, setLatestUpdatesMap,
    taskDates, setTaskDates,
    allUpdatesRecord, setAllUpdatesRecord,
    fetchAllData,
    fetchPlotDetails
  };
}
