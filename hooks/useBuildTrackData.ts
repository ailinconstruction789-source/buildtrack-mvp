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

  const fetchWithoutLimit = async (tableName: string, orderByCol: string | null = null) => {
    const allData: any[] = [];
    for (let i = 0; i < 50; i++) {
        let query = supabase.from(tableName).select('*').range(i * 1000, ((i + 1) * 1000) - 1);
        if (orderByCol) query = query.order(orderByCol, { ascending: true });
        const { data, error } = await query;
        if (error) { console.error(`fetchWithoutLimit error on ${tableName}:`, error); break; }
        if (data && data.length > 0) allData.push(...data);
        if (!data || data.length < 1000) break;
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
        allUpdates,
        assignData,
        scheduleData,
        defectsData,
      ] = await Promise.all([
        supabase.from('projects').select('*').order('created_at', { ascending: true }),
        supabase.from('house_types').select('*'),
        supabase.from('task_templates').select('*').order('task_order', { ascending: true }),
        supabase.from('plots').select('*, house_types(type_name)').order('created_at', { ascending: true }),
        supabase.from('contractors').select('*'),
        supabase.from('notifications').select('*').order('created_at', { ascending: false }),
        fetchWithoutLimit('task_updates', 'created_at'),
        fetchWithoutLimit('plot_task_assignments'),
        fetchWithoutLimit('plot_task_schedules'),
        fetchWithoutLimit('defects'),
      ]);

      setDefects(defectsData || []);

      if (notifData && loggedInUser) {
        setNotifications(notifData.filter((n: any) => n.target_user === loggedInUser.username || n.target_role === loggedInUser.role));
      }
      
      setAssignments(assignData || []); 
      setContractors(contData || []); 
      setAllUpdatesRecord(allUpdates || []);

      const schedMap: any = {}; 
      scheduleData?.forEach((s: any) => { schedMap[`${s.plot_id}-${s.task_template_id}`] = s; }); 
      setSchedules(schedMap);
      
      const latestUpdates: any = {}; 
      const tDates: any = {}; 
      
      allUpdates?.forEach((upd: any) => { 
        const key = `${upd.plot_id}-${upd.task_template_id}`; 
        latestUpdates[key] = upd; 
        if (!tDates[key]) tDates[key] = { start: upd.created_at, end: null };
        if (new Date(upd.created_at) < new Date(tDates[key].start)) tDates[key].start = upd.created_at;
        if (upd.action === 'QC อนุมัติผ่าน' || upd.action === 'QC อนุมัติ') tDates[key].end = upd.created_at;
      });
      
      setLatestUpdatesMap(latestUpdates); 
      setTaskDates(tDates);

      const formattedPlots = plotsData?.map((plot: any) => {
        const plotTasks = tasks?.filter((t: any) => t.house_type_id === plot.house_type_id) || []; 
        let sumProgress = 0;
        plotTasks.forEach((task: any) => sumProgress += (latestUpdates[`${plot.id}-${task.id}`]?.progress || 0));
        return { 
          ...plot, 
          type: plot.house_types?.type_name || 'ไม่ระบุแบบ', 
          foreman: plot.foreman_name, 
          progress: plotTasks.length > 0 ? Math.round(sumProgress / plotTasks.length) : 0 
        };
      });

      const formattedProjects = projs?.map((proj: any) => {
        const projectPlots = formattedPlots?.filter((p: any) => p.project_name === proj.name) || []; 
        let totalPlotProgress = 0; 
        projectPlots.forEach((p: any) => totalPlotProgress += p.progress);
        const uniqueMigrated = Array.from(new Map((proj.layout_data || []).map((item: any) => [item.id, item])).values());
        return { 
          name: proj.name, 
          layout_data: uniqueMigrated, 
          plotCount: projectPlots.length, 
          progress: projectPlots.length > 0 ? Math.round(totalPlotProgress / projectPlots.length) : 0 
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
    fetchAllData
  };
}
