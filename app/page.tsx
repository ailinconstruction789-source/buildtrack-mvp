'use client';
import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
// ถอด browser-image-compression ออกเพื่อใช้ Native ป้องกัน Error
import { 
  LayoutDashboard, Map as MapIcon, Truck, ChevronRight, ClipboardList, Loader2,
  Send, Camera, CheckCircle, XCircle, UserCog, X, Maximize2, HardHat, PlusCircle, Settings, Building, FolderOpen, Users, Trash2, Search, Filter, LogOut, AlertTriangle, Eraser, Grid, Paintbrush, Clock, SortAsc,
  UserPlus, Phone, CalendarDays, Wrench, Bell, CalendarClock, TrendingUp, AlertCircle, BarChartHorizontal, Save, Calendar, Smartphone, Monitor, ZoomIn, ZoomOut,
  PieChart, Home, Activity, Download, Copy, Pickaxe, ShieldAlert, Printer, CheckSquare, Square, ImageIcon
} from 'lucide-react';

// 🌟 1. ฟังก์ชันบีบอัดรูปภาพ Native (แก้ปัญหา Error: compressImageNative is not a function) 🌟
const compressImageNative = (file: File): Promise<File> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const MAX_WIDTH = 1280;
        const MAX_HEIGHT = 1280;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) { height *= MAX_WIDTH / width; width = MAX_WIDTH; }
        } else {
          if (height > MAX_HEIGHT) { width *= MAX_HEIGHT / height; height = MAX_HEIGHT; }
        }
        canvas.width = width;
        canvas.height = height;
        ctx?.drawImage(img, 0, 0, width, height);

        canvas.toBlob((blob) => {
          if (blob) {
            resolve(new File([blob], file.name, { type: 'image/jpeg', lastModified: Date.now() }));
          } else {
            reject(new Error('Canvas to Blob failed'));
          }
        }, 'image/jpeg', 0.7);
      };
      img.onerror = (error) => reject(error);
    };
    reader.onerror = (error) => reject(error);
  });
};

export default function ConstructionApp() {
  // ==========================================
  // 1. STATES
  // ==========================================
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [loggedInUser, setLoggedInUser] = useState<any>(null);
  const [loginData, setLoginData] = useState({ username: '', pin: '' });

  const [view, setView] = useState('dashboard'); 
  const [selectedProject, setSelectedProject] = useState(null);
  const [selectedPlot, setSelectedPlot] = useState(null);
  const [selectedTask, setSelectedTask] = useState(null);
  
  const [projects, setProjects] = useState([]);
  const [plots, setPlots] = useState([]);
  const [houseTypes, setHouseTypes] = useState([]);
  const [taskTemplates, setTaskTemplates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editPlotModal, setEditPlotModal] = useState({ isOpen: false, plot: null, id: '', house_type_id: '', foreman_name: '' });
  const [editProjectModal, setEditProjectModal] = useState({ isOpen: false, oldName: '', newName: '' });
  
  const [updates, setUpdates] = useState([]); 
  const [allUpdatesRecord, setAllUpdatesRecord] = useState([]); 
  const [latestUpdatesMap, setLatestUpdatesMap] = useState({});
  const [taskDates, setTaskDates] = useState({}); 
  const [assignments, setAssignments] = useState([]); 
  const [schedules, setSchedules] = useState({}); 

  const [notifications, setNotifications] = useState([]);
  const [showNotifs, setShowNotifs] = useState(false);
  const [contractors, setContractors] = useState([]);
  
  const [inputText, setInputText] = useState('');
  const [progressValue, setProgressValue] = useState(0); 
  const [isSending, setIsSending] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState([]); 
  const [fullImageUrl, setFullImageUrl] = useState(null);
  
  const [newProjectName, setNewProjectName] = useState('');
  const [newPlot, setNewPlot] = useState({ id: '', house_type_id: '', foreman_name: '' });
  const [newUser, setNewUser] = useState({ name: '', role: 'Foreman' }); 
  const [newContractor, setNewContractor] = useState({ name: '', phone: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const [searchPlot, setSearchPlot] = useState('');
  const [filterForeman, setFilterForeman] = useState('');
  const [searchContractor, setSearchContractor] = useState(''); 
  const [inspectionSort, setInspectionSort] = useState('time');
  
  const [assignModal, setAssignModal] = useState({ isOpen: false, task: null, name: '', phone: '' });
  const [dialogConfig, setDialogConfig] = useState({ isOpen: false, title: '', message: '', type: 'confirm', onConfirm: null });
  const [scheduleInputs, setScheduleInputs] = useState({}); 
  const [copyModalOpen, setCopyModalOpen] = useState(false);
  const [copySourcePlot, setCopySourcePlot] = useState('');
  
  const [isMobilePreview, setIsMobilePreview] = useState(false);
  const [isRealMobile, setIsRealMobile] = useState(false);

  const [gridCols, setGridCols] = useState(40);
  const [gridRows, setGridRows] = useState(24);
  const [mapZoom, setMapZoom] = useState(1); 
  const [isEditMapMode, setIsEditMapMode] = useState(false);
  const [mapGrid, setMapGrid] = useState([]); 
  const [mapTool, setMapTool] = useState('plot'); 
  const [mapSelectedPlot, setMapSelectedPlot] = useState('');
  const [isDrawing, setIsDrawing] = useState(false);
  const [lastDrawCell, setLastDrawCell] = useState(null);

  // 🌟 Print Export States 🌟
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [allTaskImages, setAllTaskImages] = useState([]);
  const [selectedExportImages, setSelectedExportImages] = useState([]);

  // ==========================================
  // 2. HELPER FUNCTIONS
  // ==========================================
  const showConfirm = (title, message, onConfirmAction) => setDialogConfig({ isOpen: true, title, message, type: 'confirm', onConfirm: onConfirmAction });
  const showAlert = (title, message) => setDialogConfig({ isOpen: true, title, message, type: 'alert', onConfirm: null });
  const closeDialog = () => setDialogConfig({ ...dialogConfig, isOpen: false });

  const handleZoomIn = () => setMapZoom(prev => Math.min(prev + 0.2, 2.5));
  const handleZoomOut = () => setMapZoom(prev => Math.max(prev - 0.2, 0.5));
  const handleZoomReset = () => setMapZoom(1);

  const getTaskStatus = (plannedEnd, actualEnd, progress) => {
    if (!plannedEnd) return { label: 'ยังไม่มีแผน', color: 'text-slate-500 bg-slate-100 border-slate-300', barColor: 'bg-slate-300', code: 'none' };
    const pEnd = new Date(plannedEnd).getTime(); const aEnd = actualEnd ? new Date(actualEnd).getTime() : Date.now(); const diffDays = Math.floor((aEnd - pEnd) / (1000 * 60 * 60 * 24)); 
    if (progress === 100) {
      if (diffDays <= 2 && diffDays >= -2) return { label: 'เสร็จตามแผน', color: 'text-emerald-700 bg-emerald-100 border-emerald-300', barColor: 'bg-emerald-500', code: 'completed' };
      if (diffDays < -2) return { label: 'เร็วกว่าแผน', color: 'text-indigo-700 bg-indigo-100 border-indigo-300', barColor: 'bg-indigo-500', code: 'ahead' };
      return { label: `เสร็จช้ากว่าแผน ${diffDays} วัน`, color: 'text-rose-700 bg-rose-100 border-rose-300', barColor: 'bg-rose-500', code: 'delayed' };
    } else {
      if (diffDays > 2) return { label: `ล่าช้า ${diffDays} วัน`, color: 'text-rose-700 bg-rose-100 border-rose-300', barColor: 'bg-rose-500', code: 'delayed' };
      return { label: 'กำลังดำเนินการ', color: 'text-blue-700 bg-blue-100 border-blue-300', barColor: 'bg-blue-500', code: 'on-track' };
    }
  };

  const getPlotOverallStatus = (plotId) => {
    const plotInfo = plots.find(p => p.id === plotId); const plotTasks = taskTemplates.filter(t => t.house_type_id === plotInfo?.house_type_id);
    if (!plotTasks.length) return { actual: 0, planned: 0, status: 'none', label: 'ยังไม่มีงาน', colors: 'bg-white border-slate-300 text-slate-500' };
    let totalActual = 0; let totalPlanned = 0; const today = Date.now();
    plotTasks.forEach(task => {
        const key = `${plotId}-${task.id}`; totalActual += (latestUpdatesMap[key]?.progress || 0); const plan = schedules[key]; let plannedProg = 0;
        if (plan && plan.planned_start && plan.planned_end) { const pStart = new Date(plan.planned_start).getTime(); const pEnd = new Date(plan.planned_end).getTime();
            if (today >= pEnd) plannedProg = 100; else if (today <= pStart) plannedProg = 0; else plannedProg = Math.round(((today - pStart) / (pEnd - pStart)) * 100);
        } totalPlanned += plannedProg;
    });
    const actualAvg = Math.round(totalActual / plotTasks.length); const plannedAvg = Math.round(totalPlanned / plotTasks.length);
    if (actualAvg === 0 && plannedAvg === 0) return { actual: actualAvg, planned: plannedAvg, status: 'none', label: 'รอดำเนินการ', colors: 'bg-white/90 border-slate-300 text-slate-500' };
    if (actualAvg >= 100 && plannedAvg >= 100) return { actual: actualAvg, planned: plannedAvg, status: 'completed', label: 'เสร็จสมบูรณ์', colors: 'bg-emerald-100/90 border-emerald-500 text-emerald-800' };
    if (actualAvg < plannedAvg - 10) return { actual: actualAvg, planned: plannedAvg, status: 'delayed', label: 'ล่าช้ากว่าแผน', colors: 'bg-rose-100/90 border-rose-500 text-rose-800' };
    if (actualAvg > plannedAvg + 10) return { actual: actualAvg, planned: plannedAvg, status: 'ahead', label: 'เร็วกว่าแผน', colors: 'bg-indigo-100/90 border-indigo-500 text-indigo-800' };
    return { actual: actualAvg, planned: plannedAvg, status: 'on-track', label: 'ตามแผน', colors: 'bg-blue-100/90 border-blue-500 text-blue-800' };
  };

  const getAdjacency = (x, y, type, plotId) => ({ hasTop: mapGrid.some(c => c.x === x && c.y === y - 1 && c.type === type && (type !== 'plot' || c.plotId === plotId)), hasBottom: mapGrid.some(c => c.x === x && c.y === y + 1 && c.type === type && (type !== 'plot' || c.plotId === plotId)), hasLeft: mapGrid.some(c => c.x === x - 1 && c.y === y && c.type === type && (type !== 'plot' || c.plotId === plotId)), hasRight: mapGrid.some(c => c.x === x + 1 && c.y === y && c.type === type && (type !== 'plot' || c.plotId === plotId)) });

  // ==========================================
  // 3. API FETCHING & EFFECTS
  // ==========================================
  const fetchAllData = async () => {
    try {
      setLoading(true);
      const { data: projs } = await supabase.from('projects').select('*').order('created_at', { ascending: true });
      const { data: types } = await supabase.from('house_types').select('*');
      const { data: tasks } = await supabase.from('task_templates').select('*').order('task_order', { ascending: true });
      const { data: plotsData } = await supabase.from('plots').select('*, house_types(type_name)').order('created_at', { ascending: true });
      const { data: allUpdates } = await supabase.from('task_updates').select('*').order('created_at', { ascending: true });
      const { data: assignData } = await supabase.from('plot_task_assignments').select('*');
      const { data: contData } = await supabase.from('contractors').select('*');
      const { data: notifData } = await supabase.from('notifications').select('*').order('created_at', { ascending: false });
      const { data: scheduleData } = await supabase.from('plot_task_schedules').select('*');

      if (notifData && loggedInUser) setNotifications(notifData.filter(n => n.target_user === loggedInUser.username || n.target_role === loggedInUser.role));
      setAssignments(assignData || []); setContractors(contData || []); setAllUpdatesRecord(allUpdates || []);

      const schedMap = {}; scheduleData?.forEach(s => { schedMap[`${s.plot_id}-${s.task_template_id}`] = s; }); setSchedules(schedMap);
      const latestUpdates = {}; const tDates = {}; 
      allUpdates?.forEach(upd => { 
        const key = `${upd.plot_id}-${upd.task_template_id}`; latestUpdates[key] = upd; 
        if (!tDates[key]) tDates[key] = { start: upd.created_at, end: null };
        if (new Date(upd.created_at) < new Date(tDates[key].start)) tDates[key].start = upd.created_at;
        if (upd.action === 'QC อนุมัติผ่าน' || upd.action === 'QC อนุมัติ') tDates[key].end = upd.created_at;
      });
      setLatestUpdatesMap(latestUpdates); setTaskDates(tDates);

      const formattedPlots = plotsData?.map(plot => {
        const plotTasks = tasks.filter(t => t.house_type_id === plot.house_type_id); let sumProgress = 0;
        plotTasks.forEach(task => sumProgress += (latestUpdates[`${plot.id}-${task.id}`]?.progress || 0));
        return { ...plot, type: plot.house_types?.type_name || 'ไม่ระบุแบบ', foreman: plot.foreman_name, progress: plotTasks.length > 0 ? Math.round(sumProgress / plotTasks.length) : 0 };
      });

      const formattedProjects = projs?.map(proj => {
        const projectPlots = formattedPlots?.filter(p => p.project_name === proj.name) || []; let totalPlotProgress = 0; projectPlots.forEach(p => totalPlotProgress += p.progress);
        const uniqueMigrated = Array.from(new Map((proj.layout_data || []).map(item => [item.id, item])).values());
        return { name: proj.name, layout_data: uniqueMigrated, plotCount: projectPlots.length, progress: projectPlots.length > 0 ? Math.round(totalPlotProgress / projectPlots.length) : 0 };
      });

      setHouseTypes(types || []); setTaskTemplates(tasks || []); setPlots(formattedPlots || []); setProjects(formattedProjects || []); 
    } catch (error) { console.error('Error fetching data:', error); } finally { setLoading(false); }
  };

  useEffect(() => {
    const checkMobile = () => setIsRealMobile(window.innerWidth < 768);
    checkMobile(); window.addEventListener('resize', checkMobile); return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => { const fetchUsers = async () => { try { const { data } = await supabase.from('users').select('*').order('role', { ascending: true }).order('username', { ascending: true }); setAllUsers(data || []); } catch (err) { console.error(err); } }; fetchUsers(); }, []);
 // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (loggedInUser) fetchAllData(); }, [loggedInUser]);
  useEffect(() => { setScheduleInputs({}); }, [selectedPlot?.id]);

  // ==========================================
  // 4. HANDLERS
  // ==========================================
  const handleLogin = () => { const user = allUsers.find(u => u.username === loginData.username && u.pin === loginData.pin); if (user) { setLoggedInUser(user); } else { showAlert('ล้มเหลว', 'ชื่อผู้ใช้หรือ PIN ไม่ถูกต้อง'); } };
  const handleLogout = () => { setLoggedInUser(null); setLoginData({ username: '', pin: '' }); setView('dashboard'); setProjects([]); setPlots([]); setIsEditMapMode(false); setIsMobilePreview(false); };
  
  const handleNotifClick = async (notif) => { 
    if (!notif.is_read) { await supabase.from('notifications').update({ is_read: true }).eq('id', notif.id); fetchAllData(); } 
    setShowNotifs(false); 
    const pInfo = plots.find(p => p.id === notif.plot_id); const pProject = projects.find(pj => pj.name === pInfo?.project_name); const tInfo = taskTemplates.find(t => t.id === notif.task_template_id); 
    if (pInfo && pProject && tInfo) { setSelectedProject(pProject); setSelectedPlot(pInfo); setSelectedTask(tInfo); setView('task-progress'); supabase.from('task_updates').select('*').eq('task_template_id', tInfo.id).eq('plot_id', pInfo.id).order('created_at', { ascending: true }).then(({data}) => { setUpdates(data || []); setProgressValue(data?.length ? data[data.length-1].progress : 0); }); } 
  };

  const handleSaveAllSchedules = async () => {
    setIsSubmitting(true);
    try {
      const payloads = []; Object.keys(scheduleInputs).forEach(taskId => { const plan = scheduleInputs[taskId]; if (plan.start && plan.end) { payloads.push({ plot_id: selectedPlot.id, task_template_id: taskId, planned_start: plan.start, planned_end: plan.end }); } });
      if (payloads.length === 0) { setIsSubmitting(false); return showAlert('แจ้งเตือน', 'ไม่มีการแก้ไขข้อมูล หรือกรอกวันที่ไม่ครบครับ'); }
      for (const p of payloads) { if (new Date(p.planned_end) < new Date(p.planned_start)) throw new Error('วันสิ้นสุดต้องอยู่หลังวันเริ่มงานครับ'); await supabase.from('plot_task_schedules').delete().match({ plot_id: p.plot_id, task_template_id: p.task_template_id }); await supabase.from('plot_task_schedules').insert([p]); }
      showAlert('สำเร็จ', 'บันทึกแผนงานทั้งหมดเรียบร้อยแล้ว'); setScheduleInputs({}); await fetchAllData();
    } catch (e) { showAlert('Error', (e as Error).message); } setIsSubmitting(false);
  };

  const handleConfirmCopy = () => {
    const newInputs = { ...scheduleInputs }; const sourceTasks = taskTemplates.filter(t => t.house_type_id === selectedPlot.house_type_id); let hasData = false;
    sourceTasks.forEach(task => { const sourcePlan = schedules[`${copySourcePlot}-${task.id}`]; if (sourcePlan && sourcePlan.planned_start && sourcePlan.planned_end) { newInputs[task.id] = { start: sourcePlan.planned_start, end: sourcePlan.planned_end }; hasData = true; } });
    if (!hasData) { showAlert('แจ้งเตือน', 'แปลงต้นทางที่คุณเลือกยังไม่มีข้อมูลแผนงานครับ'); return; }
    setScheduleInputs(newInputs); setCopyModalOpen(false); setCopySourcePlot(''); showAlert('สำเร็จ', 'ดึงข้อมูลแผนงานสำเร็จ! กรุณากด "บันทึกแผนงานทั้งหมด" เพื่อยืนยันลงระบบครับ');
  };

  const handleExportCSV = () => {
    let csvContent = "data:text/csv;charset=utf-8,\uFEFFชื่อโครงการ,รหัสแปลง (Plot),แบบบ้าน,โฟร์แมน,ความคืบหน้าจริง (%),ความคืบหน้าตามแผน (%),สถานะ\n";
    displayPlots.forEach(plot => { const statusInfo = getPlotOverallStatus(plot.id); csvContent += `${plot.project_name?.replace(/,/g, ' ')},${plot.id?.replace(/,/g, ' ')},${plot.type?.replace(/,/g, ' ')},${plot.foreman?.replace(/,/g, ' ') || 'ไม่ระบุ'},${plot.progress}%,${statusInfo.planned}%,${statusInfo.label}\n`; });
    const link = document.createElement("a"); link.setAttribute("href", encodeURI(csvContent)); link.setAttribute("download", `BuildTrack_Report_${new Date().toISOString().split('T')[0]}.csv`); document.body.appendChild(link); link.click(); document.body.removeChild(link);
  };

  const toggleFence = (dir, x, y, mode) => { setMapGrid(prev => { const id = `fence-${dir}-${x}-${y}`; if (mode === 'add') { return prev.some(c => c.id === id) ? prev : [...prev, { id, type: `fence-${dir}`, x, y }]; } else { return prev.filter(c => c.id !== id); } }); };
  const handleMouseDown = (x, y) => { if (!isEditMapMode) return; setIsDrawing(true); setLastDrawCell({x, y}); if (mapTool === 'eraser') eraseCell(x, y); else if (mapTool === 'plot' || mapTool === 'road') { if (mapTool === 'plot' && !mapSelectedPlot) { setIsDrawing(false); return showAlert('แจ้งเตือน', 'เลือกรหัสแปลงก่อน'); } paintCell(x, y); } };
  const handleMouseEnter = (x, y) => { if (!isDrawing || !isEditMapMode) return; if (mapTool === 'fence' || mapTool === 'eraser') { if (lastDrawCell) { const dx = x - lastDrawCell.x, dy = y - lastDrawCell.y; if (Math.abs(dx) >= 1 && dy === 0) toggleFence('v', Math.max(x, lastDrawCell.x), y, mapTool === 'eraser' ? 'erase' : 'add'); else if (Math.abs(dy) >= 1 && dx === 0) toggleFence('h', x, Math.max(y, lastDrawCell.y), mapTool === 'eraser' ? 'erase' : 'add'); } if (mapTool === 'eraser') eraseCell(x, y); setLastDrawCell({x, y}); } else { paintCell(x, y); setLastDrawCell({x, y}); } };
  const handleMouseUp = () => { setIsDrawing(false); setLastDrawCell(null); };
  const paintCell = (x, y) => setMapGrid(prev => [...prev.filter(c => !((c.type === 'plot' || c.type === 'road') && c.x === x && c.y === y)), { id: `${x}-${y}`, type: mapTool, x, y, plotId: mapTool === 'plot' ? mapSelectedPlot : null }]);
  const eraseCell = (x, y) => setMapGrid(prev => prev.filter(c => !((c.type === 'plot' || c.type === 'road') && c.x === x && c.y === y)));
  const handleSaveMap = async () => { setIsSubmitting(true); try { const finalGrid = [...mapGrid.filter(c => c.type !== 'config'), { id: 'GRID_CONFIG', type: 'config', cols: gridCols, rows: gridRows }]; await supabase.from('projects').update({ layout_data: finalGrid }).eq('name', selectedProject.name); showAlert('สำเร็จ', 'บันทึกแผนผังเรียบร้อย!'); await fetchAllData(); setSelectedProject(prev => ({ ...prev, layout_data: finalGrid })); setIsEditMapMode(false); } catch (e) { showAlert('Error', (e as Error).message); } finally { setIsSubmitting(false); } };

  // =========================================================================
  // 🌟 ADMIN / PROCUREMENT FORMS HANDLERS (ฟังก์ชันกรอกข้อมูลทำงานจริง 100%) 🌟
  // =========================================================================
  const handleAddUser = async () => { 
      if (!newUser.name.trim() || allUsers.some(u => u.username === newUser.name.trim())) return showAlert('แจ้งเตือน', 'ระบุชื่อให้ถูกต้องและไม่ซ้ำ'); 
      setIsSubmitting(true); 
      try { 
          if (newUser.role === 'Foreman') await supabase.from('foremen').insert([{ name: newUser.name.trim() }]); 
          await supabase.from('users').insert([{ username: newUser.name.trim(), pin: '1234', role: newUser.role }]); 
          setNewUser({ ...newUser, name: '' }); 
          const { data } = await supabase.from('users').select('*').order('role', { ascending: true }).order('username', { ascending: true }); 
          setAllUsers(data || []); 
          showAlert('สำเร็จ', `เพิ่มผู้ใช้งานเรียบร้อยแล้ว!`); 
      } catch (e) { showAlert('Error', (e as Error).message); } finally { setIsSubmitting(false); } 
  };
  
  const handleDeleteUser = (id, name, role) => { 
      showConfirm('ยืนยันลบ', `ลบผู้ใช้งาน ${name}?`, async () => { 
          try { 
              if(role === 'Foreman') await supabase.from('foremen').delete().eq('name', name); 
              await supabase.from('users').delete().eq('username', name); 
              const { data } = await supabase.from('users').select('*').order('role', { ascending: true }).order('username', { ascending: true }); 
              setAllUsers(data || []); closeDialog(); 
          } catch (e) { showAlert('Error', (e as Error).message); } 
      }); 
  };
  
  const handleAddProject = async () => { 
      if (!newProjectName.trim()) return; setIsSubmitting(true); 
      try { 
          await supabase.from('projects').insert([{ name: newProjectName.trim() }]); 
          setNewProjectName(''); await fetchAllData(); setView('dashboard'); showAlert('สำเร็จ', 'สร้างโครงการใหม่เรียบร้อยแล้ว');
      } catch (e) { showAlert('Error', (e as Error).message); } finally { setIsSubmitting(false); } 
  };
  
  const handleAddPlot = async () => { 
      if (!newPlot.id.trim() || !newPlot.house_type_id) return showAlert('แจ้งเตือน', 'กรอกรหัสแปลงและเลือกแบบบ้านให้ครบถ้วน'); setIsSubmitting(true); 
      try { 
          await supabase.from('plots').insert([{ id: newPlot.id.trim(), house_type_id: newPlot.house_type_id, foreman_name: newPlot.foreman_name, project_name: selectedProject.name }]); 
          setNewPlot({ id: '', house_type_id: '', foreman_name: '' }); await fetchAllData(); setView('project-detail'); showAlert('สำเร็จ', 'เพิ่มแปลงบ้านลงโครงการเรียบร้อยแล้ว');
      } catch (e) { showAlert('Error', (e as Error).message); } finally { setIsSubmitting(false); } 
  };
  
  const handleAddContractor = async () => { 
      if (!newContractor.name.trim() || !newContractor.phone.trim()) return showAlert('แจ้งเตือน', 'กรุณากรอกข้อมูลช่างให้ครบ'); setIsSubmitting(true); 
      try { 
          await supabase.from('contractors').insert([{ name: newContractor.name.trim(), phone: newContractor.phone.trim() }]); 
          setNewContractor({ name: '', phone: '' }); await fetchAllData(); showAlert('สำเร็จ', 'เพิ่มรายชื่อช่างใหม่เรียบร้อยแล้ว');
      } catch (e) { showAlert('Error', (e as Error).message); } finally { setIsSubmitting(false); } 
  };
  
  const handleDeleteContractor = (id, name) => { 
      showConfirm('ยืนยันลบ', `ลบรายชื่อช่าง ${name} ออกจากระบบ?`, async () => { 
          try { await supabase.from('contractors').delete().eq('id', id); await fetchAllData(); closeDialog(); } catch (e) { showAlert('Error', (e as Error).message); } 
      }); 
  };
  
  const handleAssignContractor = async () => { 
      setIsSubmitting(true); 
      try { 
          await supabase.from('plot_task_assignments').delete().match({ plot_id: selectedPlot.id, task_template_id: assignModal.task.id }); 
          await supabase.from('plot_task_assignments').insert([{ plot_id: selectedPlot.id, task_template_id: assignModal.task.id, contractor_name: assignModal.name, contractor_phone: assignModal.phone }]); 
          setAssignModal({ isOpen: false, task: null, name: '', phone: '' }); await fetchAllData(); showAlert('สำเร็จ', 'มอบหมายงานให้ช่างเรียบร้อยแล้ว');
      } catch (e) { showAlert('Error', (e as Error).message); } setIsSubmitting(false); 
  };
// 🌟 ฟังก์ชันลบแปลงบ้าน 🌟
  const handleDeletePlot = (plotId) => { 
      showConfirm('ยืนยันลบแปลง', `ลบแปลง ${plotId} ใช่หรือไม่? (ข้อมูลงานที่อัปเดตไปแล้วทั้งหมดจะหายไป)`, async () => { 
          setIsSubmitting(true);
          try { 
              // ลบข้อมูลที่เกี่ยวข้องก่อน (ป้องการ Error Foreign Key)
              await supabase.from('task_updates').delete().eq('plot_id', plotId);
              await supabase.from('plot_task_schedules').delete().eq('plot_id', plotId);
              await supabase.from('plot_task_assignments').delete().eq('plot_id', plotId);
              
              // ลบแปลงหลัก
              await supabase.from('plots').delete().eq('id', plotId); 
              
              await fetchAllData(); 
              closeDialog(); 
              showAlert('สำเร็จ', `ลบแปลง ${plotId} ออกจากระบบแล้ว`);
          } catch (e) { 
              showAlert('ข้อผิดพลาด', e.message); 
          } finally {
              setIsSubmitting(false);
          }
      }); 
  };
  // 🌟 ฟังก์ชันเปิดหน้าต่างแก้ไข และดึงค่าเดิมมาใส่ในช่องกรอก
  const handleEditPlot = (plot) => {
    setEditPlotModal({
      isOpen: true,
      plot: plot,
      id: plot.id,
      house_type_id: plot.house_type_id,
      foreman_name: plot.foreman_name || ''
    });
  };

  // 🌟 ฟังก์ชันบันทึกการแก้ไขลงฐานข้อมูล Supabase
  const handleUpdatePlot = async () => {
      if (!editPlotModal.id.trim() || !editPlotModal.house_type_id) return showAlert('แจ้งเตือน', 'กรุณากรอกข้อมูลให้ครบถ้วน');
      setIsSubmitting(true);
      
      const oldId = editPlotModal.plot.id; // ชื่อเดิม (เช่น A-01)
      const newId = editPlotModal.id.trim(); // ชื่อใหม่ (เช่น A-02)

      try {
        // 1. อัปเดตตารางแปลงหลัก (plots)
        const { error: plotError } = await supabase
          .from('plots')
          .update({
            id: newId,
            house_type_id: editPlotModal.house_type_id,
            foreman_name: editPlotModal.foreman_name
          })
          .eq('id', oldId);
        if (plotError) throw plotError;

        // 2. 🌟 สำคัญ: อัปเดตชื่อใน "ข้อมูลผังโครงการ" (layout_data) เพื่อไม่ให้ชื่อในแผนที่หาย
        if (selectedProject && selectedProject.layout_data) {
          const updatedLayout = selectedProject.layout_data.map(cell => {
            if (cell.type === 'plot' && cell.plotId === oldId) {
              return { ...cell, plotId: newId }; // เปลี่ยน ID ในช่องนั้นๆ เป็นชื่อใหม่
            }
            return cell;
          });

          const { error: layoutError } = await supabase
            .from('projects')
            .update({ layout_data: updatedLayout })
            .eq('name', selectedProject.name);
          
          if (layoutError) throw layoutError;
        }

        // 3. อัปเดตข้อมูลอื่นๆ ที่เกี่ยวข้อง (แชท, แผนงาน, ช่าง) เพื่อให้ประวัติไม่หาย
        await supabase.from('task_updates').update({ plot_id: newId }).eq('plot_id', oldId);
        await supabase.from('plot_task_schedules').update({ plot_id: newId }).eq('plot_id', oldId);
        await supabase.from('plot_task_assignments').update({ plot_id: newId }).eq('plot_id', oldId);

        setEditPlotModal({ ...editPlotModal, isOpen: false });
        await fetchAllData();
        
      // อัปเดตตัวแปรในหน้าปัจจุบันให้เห็นการเปลี่ยนแปลงทันที
        if (selectedProject) {
          const { data: updatedProj } = await supabase.from('projects').select('*').eq('name', selectedProject.name).single();
          setSelectedProject(updatedProj);
          
          // 🌟 🌟 เพิ่ม 3 บรรทัดนี้ เพื่อสั่งให้หน้าจอวาดผังใหม่ตามชื่อที่แก้ทันที! 🌟 🌟
          if (updatedProj && updatedProj.layout_data) {
              setMapGrid(updatedProj.layout_data.filter(c => c.type !== 'config'));
          }
        }

        showAlert('สำเร็จ', 'แก้ไขข้อมูลและอัปเดตผังโครงการเรียบร้อยแล้ว');
      } catch (e) {
        showAlert('ข้อผิดพลาด', e.message);
      } finally {
        setIsSubmitting(false);
      }
    };
// 🌟 1. ฟังก์ชันเปิดหน้าต่างแก้ไขโครงการ
  const handleEditProject = (proj) => {
    setEditProjectModal({ isOpen: true, oldName: proj.name, newName: proj.name });
  };

  // 🌟 2. ฟังก์ชันบันทึกการแก้ไขชื่อโครงการ (อัปเดต 2 ตารางพร้อมกัน)
  const handleUpdateProject = async () => {
    if (!editProjectModal.newName.trim()) return showAlert('แจ้งเตือน', 'กรุณาระบุชื่อโครงการ');
    setIsSubmitting(true);
    try {
      // ขั้นตอนที่ ก: อัปเดตตาราง projects
      const { error: projError } = await supabase
        .from('projects')
        .update({ name: editProjectModal.newName.trim() })
        .eq('name', editProjectModal.oldName);
      if (projError) throw projError;

      // ขั้นตอนที่ ข: อัปเดตตาราง plots ทุกแปลงที่สังกัดโครงการนี้ (สำคัญมาก!)
      const { error: plotError } = await supabase
        .from('plots')
        .update({ project_name: editProjectModal.newName.trim() })
        .eq('project_name', editProjectModal.oldName);
      if (plotError) throw plotError;

      setEditProjectModal({ ...editProjectModal, isOpen: false });
      await fetchAllData();
      showAlert('สำเร็จ', 'เปลี่ยนชื่อโครงการเรียบร้อยแล้ว');
    } catch (e) {
      showAlert('ข้อผิดพลาด', e.message);
    } finally {
      setIsSubmitting(false);
    }
  };
  const handleSendPost = async () => {
    if ((!inputText.trim() && selectedFiles.length === 0) || isSending) return;
    setIsSending(true);
    try {
      let imageUrls = [];
      if (selectedFiles.length > 0) { 
        imageUrls = await Promise.all(selectedFiles.map(async (f) => { 
          const comp = await compressImageNative(f.file); // 🌟 ใช้ Native Compression ลบ Error 🌟
          const path = `${selectedPlot.id}/${Date.now()}-${Math.random().toString(36).substr(2,9)}`; 
          const { error } = await supabase.storage.from('task_images').upload(path, comp);
          if (error) throw new Error('อัปโหลดรูปไม่สำเร็จ กรุณาลองใหม่');
          return supabase.storage.from('task_images').getPublicUrl(path).data.publicUrl; 
        })); 
      }
      const actionLabel = progressValue === 100 ? 'ส่งงาน 100%' : 'อัปเดตงาน';
      const { error } = await supabase.from('task_updates').insert([{ plot_id: selectedPlot.id, task_template_id: selectedTask.id, user_name: loggedInUser.username, role: currentUserRole, action: actionLabel, text_content: inputText || actionLabel, progress: progressValue, image_url: imageUrls.join(',') }]);
      if (error) throw error;
      await fetchAllData(); const { data } = await supabase.from('task_updates').select('*').eq('task_template_id', selectedTask.id).eq('plot_id', selectedPlot.id).order('created_at', { ascending: true }); setUpdates(data || []); setInputText(''); setSelectedFiles([]);
    } catch (e) { showAlert('Error', (e as Error).message); } setIsSending(false);
  };

  const handleReviewAction = async (isApproved) => {
    setIsSending(true); const finalP = isApproved ? 100 : 95; const roleLabel = currentUserRole === 'Site Engineer' ? 'Site Engineer' : 'QC'; const actionLabel = isApproved ? `${roleLabel} อนุมัติ` : `${roleLabel} แจ้งแก้ไข`;
    try {
      let imageUrls = [];
      if (selectedFiles.length > 0) { 
        imageUrls = await Promise.all(selectedFiles.map(async (f) => { 
          const comp = await compressImageNative(f.file); // 🌟 ใช้ Native Compression ลบ Error 🌟
          const path = `${selectedPlot.id}/review-${Date.now()}-${Math.random().toString(36).substr(2,9)}`; 
          const { error } = await supabase.storage.from('task_images').upload(path, comp);
          if (error) throw new Error('อัปโหลดรูปไม่สำเร็จ กรุณาลองใหม่');
          return supabase.storage.from('task_images').getPublicUrl(path).data.publicUrl; 
        })); 
      }
      const { error } = await supabase.from('task_updates').insert([{ plot_id: selectedPlot.id, task_template_id: selectedTask.id, user_name: loggedInUser.username, role: currentUserRole, action: actionLabel, text_content: inputText || (isApproved ? 'งานเรียบร้อยดี ตรวจผ่าน' : 'พบข้อบกพร่อง กรุณาแก้ไข'), progress: finalP, image_url: imageUrls.join(',') }]);
      if (error) throw error;
      if (!isApproved) {
         const notifPayload = [];
         if (currentUserRole === 'Site Engineer') { notifPayload.push({ plot_id: selectedPlot.id, task_template_id: selectedTask.id, message: `ตีกลับงานโดย Site Engineer: ${selectedTask.task_name}`, target_user: selectedPlot.foreman, target_role: 'Foreman' }); } 
         else if (currentUserRole === 'QC') { notifPayload.push({ plot_id: selectedPlot.id, task_template_id: selectedTask.id, message: `ตีกลับงานโดย QC: ${selectedTask.task_name}`, target_user: selectedPlot.foreman, target_role: 'Foreman' }); notifPayload.push({ plot_id: selectedPlot.id, task_template_id: selectedTask.id, message: `QC ตีกลับงานที่อนุมัติแล้ว: ${selectedTask.task_name}`, target_user: null, target_role: 'Site Engineer' }); }
         if (notifPayload.length > 0) await supabase.from('notifications').insert(notifPayload);
      }
      await fetchAllData(); const { data } = await supabase.from('task_updates').select('*').eq('task_template_id', selectedTask.id).eq('plot_id', selectedPlot.id).order('created_at', { ascending: true }); setUpdates(data || []); setProgressValue(finalP); setInputText(''); setSelectedFiles([]);
    } catch (e) { showAlert('Error', (e as Error).message); } setIsSending(false);
  };

  // 🌟 Print Export Logic 🌟
  const handleOpenExportModal = () => {
    let imgs = [];
    updates.forEach(u => {
      if(u.image_url) { imgs = [...imgs, ...u.image_url.split(',').filter(url => url.trim() !== '')]; }
    });
    setAllTaskImages(imgs); setSelectedExportImages(imgs); setExportModalOpen(true);
  };
  const toggleExportImage = (url) => {
    if (selectedExportImages.includes(url)) { setSelectedExportImages(selectedExportImages.filter(img => img !== url)); } 
    else { setSelectedExportImages([...selectedExportImages, url]); }
  };
  const imageChunks = [];
  for (let i = 0; i < selectedExportImages.length; i += 8) { imageChunks.push(selectedExportImages.slice(i, i + 8)); }

  // ==========================================
  // 5. DERIVED VARIABLES (ป้องกัน Error & สิทธิ์ทำงาน 100%)
  // ==========================================
  const currentUserRole = loggedInUser?.role || '';
  
  // 🌟 SAFE ROLE CHECKS (Case-Insensitive) 🌟
  const isAdmin = currentUserRole?.toLowerCase() === 'admin';
  const isProcurement = currentUserRole?.toLowerCase() === 'procurement';
  const isProjectPlanner = currentUserRole?.toLowerCase() === 'project planner';
  const isQC = currentUserRole?.toLowerCase() === 'qc';
  const isSiteEngineer = currentUserRole?.toLowerCase() === 'site engineer';
  const isForeman = currentUserRole?.toLowerCase() === 'foreman';

  const isMobileLayout = isMobilePreview || isRealMobile; 
  const unreadNotifs = notifications.filter(n => !n.is_read);
  const foremenList = allUsers.filter(u => u.role === 'Foreman');

  const todayDateString = new Date().toLocaleDateString('en-CA'); 
  const plotsActiveToday = useMemo(() => {
    if (!allUpdatesRecord || !Array.isArray(allUpdatesRecord)) return new Set();
    return new Set(allUpdatesRecord.filter(u => new Date(u.created_at).toLocaleDateString('en-CA') === todayDateString).map(u => u.plot_id));
  }, [allUpdatesRecord, todayDateString]);

  const displayPlots = plots.filter(p => {
    const isCurrentProject = p.project_name === selectedProject?.name;
    const matchSearch = p.id.toLowerCase().includes(searchPlot.toLowerCase());
    const matchForeman = filterForeman === '' || p.foreman === filterForeman;
    const roleAllowed = !isForeman || p.foreman === loggedInUser?.username;
    return isCurrentProject && matchSearch && matchForeman && roleAllowed;
  });

  let inspectionQueue = [];
  if (isSiteEngineer || isQC || isAdmin) {
    Object.values(latestUpdatesMap).forEach((upd: any) => {
      const task = taskTemplates.find(t => t.id === upd.task_template_id); const plot = plots.find(p => p.id === upd.plot_id); if (!task || !plot) return;
      const isPendingSE = isSiteEngineer && upd.progress === 100 && (upd.action === 'ส่งงาน 100%' || upd.role === 'Foreman');
      const isPendingQC = isQC && upd.progress === 100 && upd.action === 'Site Engineer อนุมัติ';
      const isAdminView = isAdmin && upd.progress === 100 && (upd.action === 'ส่งงาน 100%' || upd.action === 'Site Engineer อนุมัติ');
      if (isPendingSE || isPendingQC || isAdminView) inspectionQueue.push({ ...upd, task_name: task.task_name, plot_id: plot.id, project_name: plot.project_name, foreman: plot.foreman, time: new Date(upd.created_at).getTime(), statusFor: isPendingQC || (isAdminView && upd.action === 'Site Engineer อนุมัติ') ? 'QC' : 'Site Engineer' });
    });
    inspectionQueue.sort((a, b) => { if (inspectionSort === 'plot') return a.plot_id.localeCompare(b.plot_id); return b.time - a.time; });
  }

  const lastUpd = updates.length > 0 ? updates[updates.length - 1] : null;
  const isPendingSE = lastUpd?.progress === 100 && (lastUpd?.action === 'ส่งงาน 100%' || lastUpd?.role === 'Foreman');
  const isPendingQC = lastUpd?.progress === 100 && lastUpd?.action === 'Site Engineer อนุมัติ';
  const isTaskCompleted = lastUpd?.progress === 100 && (lastUpd?.action === 'QC อนุมัติ' || lastUpd?.action === 'QC อนุมัติผ่าน');
  const currentAssignment = assignments.slice().reverse().find(a => a.plot_id === selectedPlot?.id && a.task_template_id === selectedTask?.id);
  const isLockedForForeman = isForeman && !currentAssignment;

  const plotBounds = {};
  mapGrid.filter(c => c.type === 'plot').forEach(c => {
    if (!plotBounds[c.plotId]) plotBounds[c.plotId] = { minX: c.x, maxX: c.x, minY: c.y, maxY: c.y };
    else { plotBounds[c.plotId].minX = Math.min(plotBounds[c.plotId].minX, c.x); plotBounds[c.plotId].maxX = Math.max(plotBounds[c.plotId].maxX, c.x); plotBounds[c.plotId].minY = Math.min(plotBounds[c.plotId].minY, c.y); plotBounds[c.plotId].maxY = Math.max(plotBounds[c.plotId].maxY, c.y); }
  });

  let totalPlotsCount = plots.length;
  let completedPlotsCount = plots.filter(p => p.progress === 100).length;
  let delayedPlotsCount = 0; plots.forEach(p => { if (getPlotOverallStatus(p.id).status === 'delayed') delayedPlotsCount++; });
  let activePlotsCount = totalPlotsCount - completedPlotsCount;
  const totalReworks = (allUpdatesRecord || []).filter(u => u.action.includes('แจ้งแก้ไข') || u.action.includes('ไม่อนุมัติ')).length;

  let globalMinDate = Infinity; let globalMaxDate = -Infinity;
  let plotPlanStart = Infinity; let plotPlanEnd = -Infinity;
  let plotActualStart = Infinity; let plotActualEnd = -Infinity;
  let hasAnySchedule = false; const todayTs = new Date().setHours(0,0,0,0);

  if (view === 'house-detail' && selectedPlot) {
     const plotTasks = taskTemplates.filter(t => t.house_type_id === selectedPlot.house_type_id);
     plotTasks.forEach(task => {
        const key = `${selectedPlot.id}-${task.id}`;
        const pStart = schedules[key]?.planned_start ? new Date(schedules[key].planned_start).getTime() : null;
        const pEnd = schedules[key]?.planned_end ? new Date(schedules[key].planned_end).getTime() : null;
        const aStart = taskDates[key]?.start ? new Date(taskDates[key].start).getTime() : null;
        const aEnd = taskDates[key]?.end ? new Date(taskDates[key].end).getTime() : null;

        if (pStart) { if (pStart < globalMinDate) globalMinDate = pStart; if (pStart < plotPlanStart) plotPlanStart = pStart; hasAnySchedule = true; }
        if (aStart) { if (aStart < globalMinDate) globalMinDate = aStart; if (aStart < plotActualStart) plotActualStart = aStart; hasAnySchedule = true; }
        if (pEnd) { if (pEnd > globalMaxDate) globalMaxDate = pEnd; if (pEnd > plotPlanEnd) plotPlanEnd = pEnd; }
        if (aEnd) { if (aEnd > globalMaxDate) globalMaxDate = aEnd; if (aEnd > plotActualEnd) plotActualEnd = aEnd; }
     });
     if (globalMinDate === Infinity) { globalMinDate = Date.now() - (7 * 86400000); globalMaxDate = Date.now() + (14 * 86400000); }
  }

// 🌟 ปรับระบบคำนวณตำแหน่งเส้นเวลาให้ตรงเป๊ะเที่ยงคืน และเผื่อความกว้างแถบให้ครอบคลุมเต็มวัน 🌟
  const minD = new Date(globalMinDate); minD.setHours(0,0,0,0);
  const maxD = new Date(globalMaxDate); maxD.setHours(0,0,0,0);
  
  // ล็อกเวลาเริ่มต้นและสิ้นสุดตารางให้ลงตัวที่ "เที่ยงคืนเป๊ะ" เสมอ (เผื่อหัวท้าย 2-3 วันไม่ให้อึดอัด)
  const chartStart = minD.getTime() - (2 * 86400000);
  const chartEnd = maxD.getTime() + (3 * 86400000); 
  const totalChartMs = chartEnd - chartStart;

  const getChartLeft = (timestamp) => {
      const d = new Date(timestamp); d.setHours(0,0,0,0); // บังคับให้คำนวณจากเที่ยงคืนเป๊ะ
      return Math.max(0, ((d.getTime() - chartStart) / totalChartMs) * 100);
  };
  
  const getChartWidth = (startTs, endTs) => {
      const dStart = new Date(startTs); dStart.setHours(0,0,0,0);
      const dEnd = new Date(endTs); dEnd.setHours(0,0,0,0);
      // บวกเวลาเพิ่ม 1 วันเต็ม (86400000 ms) เพื่อให้ความกว้างของแถบ ลากคลุมวันสิ้นสุดไปจนเต็มช่อง
      return Math.max(0.5, (((dEnd.getTime() + 86400000) - dStart.getTime()) / totalChartMs) * 100);
  };
// 🌟 ปรับปรุงการเก็บข้อมูลวันที่และเดือนแยกแถวกัน 🌟
  const timeMarkers = [];
  if (hasAnySchedule) {
     const dayMs = 86400000; 
     const showDays = (totalChartMs / dayMs) <= 60; 
     let current = new Date(chartStart);
     let lastMonthStr = "";

     while (current.getTime() <= chartEnd) {
        const currentMonthStr = current.toLocaleDateString('th-TH', { month: 'short', year: '2-digit' });
        let monthLabel = null;

        // ถ้าเข้าสู่เดือนใหม่ หรือเป็นจุดเริ่มต้นผัง ให้บันทึกชื่อเดือนแยกไว้
        if (currentMonthStr !== lastMonthStr) {
           monthLabel = currentMonthStr;
           lastMonthStr = currentMonthStr;
        }

        timeMarkers.push({ 
           dayLabel: current.getDate(),        // แสดงตัวเลขวันที่เสมอ ไม่โดนข้อความทับแล้ว
           monthLabel: monthLabel,             // แยกชื่อเดือนเอาไว้ไปแสดงแถวบน
           isMonth: current.getDate() === 1,   // ส่งค่าไปทำเส้นไฮไลท์แนวตั้งในตารางด้านล่างเหมือนเดิม
           left: getChartLeft(current.getTime()) 
        });
        current.setDate(current.getDate() + (showDays ? 1 : 7)); 
     }
  }

  const totalPlannedDays = (plotPlanEnd !== -Infinity && plotPlanStart !== Infinity) ? Math.ceil((plotPlanEnd - plotPlanStart) / 86400000) : 0;
  const daysElapsed = (plotPlanStart !== Infinity) ? Math.ceil((todayTs - plotPlanStart) / 86400000) : 0;
  const daysRemaining = (plotPlanEnd !== -Infinity) ? Math.ceil((plotPlanEnd - todayTs) / 86400000) : 0;
  const isSummaryDelayed = daysElapsed > 0 && selectedPlot?.progress < (daysElapsed / totalPlannedDays) * 100 && (daysElapsed / totalPlannedDays)*100 - selectedPlot?.progress > 10; 

  // ==========================================
  // 6. RENDER UI
  // ==========================================
  if (!loggedInUser) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4">
        {dialogConfig.isOpen && (
          <div className="fixed inset-0 z-[500] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white rounded-[2rem] shadow-2xl max-w-sm w-full p-6 text-center space-y-4"><div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-2"><AlertTriangle size={32} /></div><h3 className="text-xl font-black">{dialogConfig.title}</h3><p className="text-slate-500 font-medium">{dialogConfig.message}</p><button onClick={closeDialog} className="w-full bg-slate-800 text-white font-bold py-3.5 rounded-xl">รับทราบ</button></div>
          </div>
        )}
        <div className="bg-white p-6 sm:p-12 rounded-[2.5rem] shadow-2xl w-full max-w-md border border-slate-100 relative overflow-hidden">
          <div className="absolute -top-20 -right-20 w-40 h-40 bg-blue-500 rounded-full blur-3xl opacity-20 pointer-events-none"></div>
          <div className="absolute -bottom-20 -left-20 w-40 h-40 bg-emerald-500 rounded-full blur-3xl opacity-20 pointer-events-none"></div>
          
          <div className="flex justify-center mb-6 relative z-10"><div className="bg-blue-50 p-4 rounded-3xl"><LayoutDashboard className="text-blue-600" size={48} /></div></div>
          <h1 className="text-4xl font-black text-slate-800 italic uppercase tracking-tighter mb-2 text-center relative z-10">BuildTrack</h1>
          <p className="text-center text-slate-400 font-bold text-sm mb-8 tracking-widest relative z-10">PROJECT MANAGEMENT SYSTEM</p>
          
          <div className="space-y-4 sm:space-y-5 relative z-10">
            <div>
               <label className="text-xs font-bold text-slate-400 uppercase tracking-widest ml-1 mb-1 block">Username</label>
               <select value={loginData.username} onChange={e => setLoginData({...loginData, username: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 font-bold outline-none focus:border-blue-500 focus:bg-white transition-colors text-slate-700 appearance-none"><option value="" disabled>-- เลือกชื่อของคุณ --</option>{allUsers.map(u => <option key={u.id} value={u.username}>{u.username} ({u.role})</option>)}</select>
            </div>
            <div>
               <label className="text-xs font-bold text-slate-400 uppercase tracking-widest ml-1 mb-1 block">PIN Code</label>
               <input type="password" maxLength={4} value={loginData.pin} onChange={e => setLoginData({...loginData, pin: e.target.value.replace(/[^0-9]/g, '')})} onKeyDown={(e) => e.key === 'Enter' && handleLogin()} placeholder="••••" className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 font-black text-center tracking-[1em] outline-none focus:border-blue-500 focus:bg-white transition-colors text-2xl text-slate-700" />
            </div>
            <button onClick={handleLogin} disabled={!loginData.username || loginData.pin.length !== 4} className="w-full bg-slate-900 text-white font-black py-4 rounded-2xl shadow-xl hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed mt-4">Sign In</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen font-sans text-slate-900 transition-all duration-500 ${isMobilePreview ? 'bg-slate-900 flex items-center justify-center py-4 sm:py-10' : 'bg-slate-50'}`}>
      
      {/* 🖨️ CSS สำหรับการพิมพ์หน้ากระดาษ A4 🖨️ */}
      <style dangerouslySetInnerHTML={{__html: `
        @media print {
          @page { size: A4 portrait; margin: 10mm; }
          /* บังคับให้บราวเซอร์พริ้นต์สีพื้นหลังและกรอบออกมาให้ครบ */
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}} />

      <div className={`${isMobilePreview ? 'w-[390px] h-[844px] bg-slate-50 border-[14px] border-slate-950 rounded-[3rem] shadow-2xl relative overflow-hidden flex flex-col' : 'flex h-screen w-full overflow-hidden'} print:hidden`}>
      
        {/* Modals & Dialogs */}
        {assignModal.isOpen && (
          <div className="absolute inset-0 z-[600] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 fixed">
            <div className="bg-white rounded-[2rem] shadow-2xl max-w-sm w-full p-6 space-y-5 animate-in zoom-in-95 duration-200">
              <div><h3 className="text-xl font-black text-slate-800 italic uppercase">Assign Contractor</h3><p className="text-sm text-slate-500 font-bold tracking-widest">{selectedPlot?.id} - {assignModal.task?.task_name}</p></div>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-black text-slate-500 mb-1 uppercase tracking-widest">เลือกช่างผู้รับเหมา</label>
                  {contractors.length === 0 ? ( <p className="text-base text-rose-500 font-bold italic">ไม่พบรายชื่อช่างในระบบ</p> ) : (
                    <select value={assignModal.name} onChange={(e) => { const c = contractors.find(x => x.name === e.target.value); setAssignModal({...assignModal, name: c?.name || '', phone: c?.phone || ''}); }} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 font-bold outline-none focus:border-emerald-500 text-slate-700 cursor-pointer"><option value="" disabled>-- เลือกช่าง --</option>{contractors.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}</select>
                  )}
                </div>
                <div><label className="block text-sm font-black text-slate-500 mb-1 uppercase tracking-widest">เบอร์โทรศัพท์ (อัตโนมัติ)</label><input type="text" value={assignModal.phone} readOnly className="w-full bg-slate-100 border border-slate-200 rounded-xl px-4 py-3 font-bold text-slate-500 cursor-not-allowed" /></div>
              </div>
              <div className="flex gap-3 w-full mt-2">
                <button onClick={() => setAssignModal({ isOpen: false, task: null, name: '', phone: '' })} className="flex-1 bg-slate-100 text-slate-600 font-bold py-3.5 rounded-xl hover:bg-slate-200">ยกเลิก</button>
                <button onClick={handleAssignContractor} disabled={isSubmitting || !assignModal.name} className="flex-1 bg-emerald-600 text-white font-bold py-3.5 rounded-xl hover:bg-emerald-700 flex justify-center items-center gap-2 disabled:opacity-50">{isSubmitting ? <Loader2 className="animate-spin" size={16}/> : 'บันทึกข้อมูล'}</button>
              </div>
            </div>
          </div>
        )}

        {/* 🌟 Modal สำหรับ Export รูปตั้งเบิก 🌟 */}
        {exportModalOpen && (
          <div className="absolute inset-0 z-[600] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 fixed">
            <div className="bg-white rounded-[2rem] shadow-2xl max-w-3xl w-full max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
              <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                <div>
                  <h3 className="text-xl font-black text-slate-800 italic uppercase flex items-center gap-2"><Printer className="text-blue-600"/> ส่งออกรูปถ่ายตั้งเบิก</h3>
                  <p className="text-sm text-slate-500 font-bold tracking-widest mt-1">แปลง: {selectedPlot?.id} - {selectedTask?.task_name}</p>
                </div>
                <button onClick={() => setExportModalOpen(false)} className="p-2 hover:bg-slate-200 rounded-full transition-colors text-slate-400"><X size={24}/></button>
              </div>
              
              <div className="flex-1 overflow-y-auto p-6 bg-slate-100">
                 {allTaskImages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-40 text-slate-400 font-bold"><ImageIcon size={48} className="mb-4 opacity-50"/> ไม่พบรูปภาพในงานนี้</div>
                 ) : (
                    <>
                      <div className="flex justify-between items-center mb-4">
                         <span className="font-bold text-sm text-slate-500">คลิกเพื่อยกเลิกรูปที่ไม่ต้องการ ({selectedExportImages.length}/{allTaskImages.length})</span>
                         <span className="text-xs font-bold text-blue-500 bg-blue-50 px-3 py-1 rounded-lg">จัดเรียงหน้าละ 8 รูปอัตโนมัติ</span>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                        {allTaskImages.map((img, idx) => {
                           const isSelected = selectedExportImages.includes(img);
                           return (
                              <div key={idx} onClick={() => toggleExportImage(img)} className={`relative cursor-pointer rounded-xl overflow-hidden border-4 transition-all aspect-square ${isSelected ? 'border-emerald-500 shadow-md scale-100' : 'border-transparent opacity-50 scale-95'}`}>
                                 <img src={img} className="w-full h-full object-cover" />
                                 <div className="absolute top-2 right-2 bg-white rounded-md shadow-sm">
                                    {isSelected ? <CheckSquare className="text-emerald-500" size={20}/> : <Square className="text-slate-300" size={20}/>}
                                 </div>
                              </div>
                           );
                        })}
                      </div>
                    </>
                 )}
              </div>

              <div className="p-6 border-t border-slate-100 bg-white flex justify-end gap-3">
                <button onClick={() => setExportModalOpen(false)} className="px-6 py-3 bg-slate-100 text-slate-600 font-bold rounded-xl hover:bg-slate-200">ยกเลิก</button>
                <button onClick={() => window.print()} disabled={selectedExportImages.length === 0} className="px-8 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 flex items-center gap-2 shadow-lg disabled:opacity-50">
                  <Printer size={18}/> พิมพ์รายงาน (A4)
                </button>
              </div>
            </div>
          </div>
        )}

        {copyModalOpen && (
          <div className="absolute inset-0 z-[600] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 fixed">
            <div className="bg-white rounded-[2rem] shadow-2xl max-w-sm w-full p-6 space-y-5 animate-in zoom-in-95 duration-200">
              <div><h3 className="text-xl font-black text-slate-800 italic uppercase flex items-center gap-2"><Copy className="text-blue-600"/> Copy Schedule</h3><p className="text-sm text-slate-500 font-bold tracking-widest mt-1">คัดลอกแผนงานจากแปลงต้นแบบ</p></div>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-black text-slate-500 mb-2 uppercase tracking-widest">เลือกแปลงต้นทาง (แบบบ้านเดียวกัน)</label>
                  <select value={copySourcePlot} onChange={(e) => setCopySourcePlot(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 font-bold outline-none focus:border-blue-500 text-slate-700 cursor-pointer">
                    <option value="" disabled>-- เลือกแปลง --</option>
                    {plots.filter(p => p.house_type_id === selectedPlot?.house_type_id && p.id !== selectedPlot?.id).map(p => (<option key={p.id} value={p.id}>{p.id} ({p.foreman || 'ไม่ระบุโฟร์แมน'})</option>))}
                  </select>
                </div>
                <div className="bg-blue-50 p-3 rounded-xl border border-blue-100 flex items-start gap-2"><AlertCircle size={16} className="text-blue-500 shrink-0 mt-0.5"/><p className="text-xs font-bold text-blue-700 leading-relaxed">ระบบจะดึงวันที่ตามแผนมาใส่ในช่องกรอกให้คุณตรวจสอบก่อนกดบันทึกจริงครับ</p></div>
              </div>
              <div className="flex gap-3 w-full mt-2">
                <button onClick={() => setCopyModalOpen(false)} className="flex-1 bg-slate-100 text-slate-600 font-bold py-3.5 rounded-xl hover:bg-slate-200">ยกเลิก</button>
                <button onClick={handleConfirmCopy} disabled={!copySourcePlot} className="flex-1 bg-blue-600 text-white font-bold py-3.5 rounded-xl hover:bg-blue-700 flex justify-center items-center gap-2 disabled:opacity-50"><Download size={16}/> ดึงข้อมูล</button>
              </div>
            </div>
          </div>
        )}

        {fullImageUrl && (
          <div className="fixed inset-0 z-[600] bg-black/90 backdrop-blur-sm flex items-center justify-center p-4 cursor-zoom-out" onClick={() => setFullImageUrl(null)}><button className="absolute top-6 right-6 text-white hover:text-rose-500 transition-colors bg-white/10 p-3 rounded-full backdrop-blur-md" onClick={() => setFullImageUrl(null)}><X size={28} /></button><img src={fullImageUrl} className="max-w-full max-h-[90vh] object-contain rounded-2xl shadow-2xl" onClick={(e) => e.stopPropagation()} alt="Full size" /></div>
        )}

        {dialogConfig.isOpen && (
          <div className="absolute inset-0 z-[600] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 fixed"><div className="bg-white rounded-[2rem] shadow-2xl max-w-sm w-full p-6 text-center space-y-4"><div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-2 ${dialogConfig.type === 'confirm' ? 'bg-rose-100 text-rose-600' : 'bg-blue-100 text-blue-600'}`}><AlertTriangle size={32} /></div><h3 className="text-xl font-black">{dialogConfig.title}</h3><p className="text-slate-500 font-medium">{dialogConfig.message}</p><div className="flex gap-3 w-full mt-4">{dialogConfig.type === 'confirm' ? (<><button onClick={closeDialog} className="flex-1 bg-slate-100 text-slate-600 font-bold py-3.5 rounded-xl hover:bg-slate-200">ยกเลิก</button><button onClick={dialogConfig.onConfirm} className="flex-1 bg-rose-600 text-white font-bold py-3.5 rounded-xl hover:bg-rose-700">ยืนยัน</button></>) : (<button onClick={closeDialog} className="w-full bg-slate-800 text-white font-bold py-3.5 rounded-xl">รับทราบ</button>)}</div></div></div>
        )}

        {/* 🧭 Left Sidebar (Desktop Only) */}
        {!isMobileLayout && (
          <aside className="w-72 bg-slate-900 text-slate-300 flex flex-col justify-between hidden md:flex shrink-0 shadow-2xl z-50">
             <div className="p-8 pb-4">
                <div className="flex items-center gap-3 mb-10 text-white cursor-pointer hover:scale-105 transition-transform" onClick={() => setView('dashboard')}>
                   <div className="bg-blue-600 p-2 rounded-xl shadow-lg shadow-blue-500/50"><LayoutDashboard size={28} /></div>
                   <h1 className="font-black text-2xl tracking-tighter uppercase italic">BuildTrack</h1>
                </div>

                <div className="space-y-6">
                   <div>
                     <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-3 px-2">Main Menu</p>
                     <nav className="space-y-1">
                        <button onClick={() => setView('dashboard')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold transition-all ${view === 'dashboard' ? 'bg-blue-600 text-white shadow-md' : 'hover:bg-slate-800 hover:text-white'}`}><Home size={18}/> Dashboard</button>
                        
                        {(isAdmin || isProjectPlanner || isQC || isSiteEngineer) && (
                           <button onClick={() => setView('reports')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold transition-all ${view === 'reports' ? 'bg-blue-600 text-white shadow-md' : 'hover:bg-slate-800 hover:text-white'}`}><PieChart size={18}/> Reports & Analytics</button>
                        )}
                     </nav>
                   </div>

                   {(isAdmin || isProcurement) && (
                     <div>
                       <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-3 px-2">Management</p>
                       <nav className="space-y-1">
                          {isAdmin && (
                            <>
                              <button onClick={() => setView('admin-project')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold transition-all ${view === 'admin-project' ? 'bg-rose-600 text-white shadow-md' : 'hover:bg-slate-800 hover:text-white'}`}><PlusCircle size={18}/> สร้างโครงการ</button>
                              <button onClick={() => setView('admin-plot')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold transition-all ${view === 'admin-plot' ? 'bg-rose-600 text-white shadow-md' : 'hover:bg-slate-800 hover:text-white'}`}><MapIcon size={18}/> เพิ่มแปลงบ้าน</button>
                              <button onClick={() => setView('admin-users')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold transition-all ${view === 'admin-users' ? 'bg-rose-600 text-white shadow-md' : 'hover:bg-slate-800 hover:text-white'}`}><Users size={18}/> จัดการผู้ใช้งาน</button>
                            </>
                          )}
                          {(isAdmin || isProcurement) && (
                             <button onClick={() => setView('procurement-contractors')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold transition-all ${view === 'procurement-contractors' ? 'bg-emerald-600 text-white shadow-md' : 'hover:bg-slate-800 hover:text-white'}`}><Wrench size={18}/> จัดการรายชื่อช่าง</button>
                          )}
                       </nav>
                     </div>
                   )}
                </div>
             </div>

             <div className="p-8 pt-4 mt-auto">
                {isAdmin && (
                   <button onClick={() => setIsMobilePreview(!isMobilePreview)} className="w-full flex items-center justify-center gap-2 p-3 bg-slate-800 rounded-xl font-bold text-xs text-slate-400 hover:text-white hover:bg-slate-700 transition-colors">
                      <Smartphone size={16}/> จำลองมือถือ (Mobile View)
                   </button>
                )}
             </div>
          </aside>
        )}

        <div className="flex-1 flex flex-col h-full bg-slate-50 relative overflow-hidden">
           
           {/* 📱 Top Header (Mobile & Preview Only) */}
           {isMobileLayout && (
             <header className="bg-slate-900 text-white p-3 sm:p-4 shrink-0 shadow-md z-30">
               <div className="flex justify-between items-center">
                 <div className="flex items-center gap-2" onClick={() => setView('dashboard')}>
                   <div className="bg-blue-600 p-1.5 rounded-lg"><LayoutDashboard size={18} /></div>
                   <h1 className="font-black text-base sm:text-lg tracking-tighter uppercase italic">BuildTrack</h1>
                 </div>
                 <div className="flex items-center gap-2 sm:gap-3">
                    <div className="relative">
                       <button onClick={() => setShowNotifs(!showNotifs)} className="relative p-2 bg-slate-800 text-slate-300 rounded-full hover:text-white"><Bell size={18} />{unreadNotifs.length > 0 && <span className="absolute top-0 right-0 w-2.5 h-2.5 sm:w-3 sm:h-3 bg-rose-500 rounded-full border border-slate-900"></span>}</button>
                       {showNotifs && (
                          <div className="absolute top-12 right-0 w-[280px] sm:w-[300px] bg-white rounded-2xl shadow-2xl border border-slate-200 z-50 overflow-hidden text-slate-800 animate-in slide-in-from-top-2">
                            <div className="p-3 bg-slate-50 border-b border-slate-200 flex justify-between items-center"><h3 className="font-black italic text-sm sm:text-base">Notifications</h3><span className="text-[9px] sm:text-[10px] font-bold text-slate-500">{unreadNotifs.length} Unread</span></div>
                            <div className="max-h-[50vh] overflow-y-auto custom-scrollbar">
                               {notifications.length === 0 ? ( <div className="p-6 text-center text-slate-400 text-xs sm:text-sm font-bold">ไม่มีการแจ้งเตือน</div> ) : (
                                 notifications.map(n => (
                                   <div key={n.id} onClick={() => handleNotifClick(n)} className={`p-3 border-b border-slate-100 cursor-pointer ${n.is_read ? 'opacity-60 bg-white' : 'bg-rose-50'}`}>
                                      <div className="flex justify-between items-start mb-1 gap-2"><span className="text-[8px] sm:text-[9px] font-black uppercase text-rose-500 bg-rose-100 px-1.5 py-0.5 rounded">{n.plot_id}</span><span className="text-[8px] sm:text-[9px] text-slate-400 font-bold whitespace-nowrap">{new Date(n.created_at).toLocaleDateString('th-TH',{day:'numeric', month:'short'})}</span></div>
                                      <p className="text-[10px] sm:text-xs font-bold text-slate-700 leading-snug mt-1">{n.message}</p>
                                   </div>
                                 ))
                               )}
                            </div>
                          </div>
                       )}
                    </div>
                    {isAdmin && <button onClick={() => setIsMobilePreview(false)} className="p-2 bg-slate-800 text-slate-300 rounded-full hover:text-white"><Monitor size={18}/></button>}
                 </div>
               </div>
             </header>
           )}

           {/* 💻 Top Header (Desktop) */}
           {!isMobileLayout && (
             <header className="bg-white border-b border-slate-200 p-3 sm:p-4 shrink-0 shadow-sm z-30 flex justify-end items-center gap-4">
                
                {/* 🔔 Notifications */}
                <div className="relative">
                   <button onClick={() => setShowNotifs(!showNotifs)} className="relative p-2.5 bg-slate-100 text-slate-500 rounded-full hover:text-blue-600 hover:bg-blue-50 transition-colors"><Bell size={20} />{unreadNotifs.length > 0 && <span className="absolute top-0 right-0 w-3.5 h-3.5 bg-rose-500 rounded-full border-2 border-white"></span>}</button>
                   {showNotifs && (
                      <div className="absolute top-14 right-0 w-80 sm:w-96 bg-white rounded-2xl shadow-2xl border border-slate-200 z-50 overflow-hidden text-slate-800 animate-in slide-in-from-top-2">
                        <div className="p-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center"><h3 className="font-black italic text-lg">Notifications</h3><span className="text-xs font-bold text-slate-500">{unreadNotifs.length} Unread</span></div>
                        <div className="max-h-[60vh] overflow-y-auto custom-scrollbar">
                           {notifications.length === 0 ? ( <div className="p-8 text-center text-slate-400 text-sm font-bold flex flex-col items-center gap-2"><Bell size={32} className="opacity-20"/> ไม่มีการแจ้งเตือน</div> ) : (
                             notifications.map(n => (
                               <div key={n.id} onClick={() => handleNotifClick(n)} className={`p-4 border-b border-slate-100 cursor-pointer hover:bg-slate-50 transition-colors ${n.is_read ? 'opacity-60 bg-white' : 'bg-rose-50/40'}`}>
                                  <div className="flex justify-between items-start mb-1 gap-2"><span className="text-[10px] font-black uppercase text-rose-500 tracking-widest bg-rose-100 px-2 py-0.5 rounded shrink-0">{n.plot_id}</span><span className="text-[10px] text-slate-400 font-bold whitespace-nowrap">{new Date(n.created_at).toLocaleDateString('th-TH',{day:'numeric', month:'short'})} • {new Date(n.created_at).toLocaleTimeString('th-TH', {hour:'2-digit', minute:'2-digit'})}</span></div>
                                  <p className="text-sm font-bold text-slate-700 leading-snug mt-2">{n.message}</p>
                               </div>
                             ))
                           )}
                        </div>
                      </div>
                   )}
                </div>

                {/* 👤 User Profile */}
                <div className="flex items-center gap-3 border-l border-slate-200 pl-4">
                   <div className="text-right hidden sm:block">
                      <p className="text-sm font-bold text-slate-700 leading-none mb-1">{loggedInUser.username}</p>
                      <p className={`text-[10px] font-black uppercase tracking-widest leading-none ${isAdmin ? 'text-rose-500' : isQC ? 'text-purple-500' : isSiteEngineer ? 'text-blue-500' : isProjectPlanner ? 'text-pink-500' : isProcurement ? 'text-emerald-500' : 'text-orange-500'}`}>{currentUserRole}</p>
                   </div>
                   <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-blue-600 to-purple-600 flex items-center justify-center text-white font-black shadow-md">{loggedInUser.username.charAt(0)}</div>
                   <button onClick={handleLogout} className="ml-1 p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors" title="ออกจากระบบ"><LogOut size={18}/></button>
                </div>
             </header>
           )}

           {/* 🌟 Scrollable Content Area 🌟 */}
           <main className={`flex-1 overflow-y-auto custom-scrollbar ${isMobileLayout ? 'p-3 pb-24' : 'p-6 sm:p-8 pb-12'} scroll-smooth relative`}>
             <div className={`${isMobileLayout || view === 'reports' ? 'w-full' : 'max-w-[1400px] mx-auto'}`}> 
               
               {/* 🏢 View: Dashboard */}
               {view === 'dashboard' && (
                  <div className="animate-in fade-in zoom-in-95 duration-500">
                    
                    <div className="mb-6 sm:mb-12">
                       <h2 className="font-black text-xl sm:text-3xl text-slate-800 italic uppercase tracking-tighter mb-4 sm:mb-6">Executive Summary</h2>
                       <div className={`grid gap-3 sm:gap-6 ${isMobileLayout ? 'grid-cols-2' : 'grid-cols-4'}`}>
                          <div className="bg-white p-4 sm:p-6 rounded-2xl sm:rounded-[2rem] border border-slate-200 shadow-sm flex flex-col justify-center items-center sm:items-start text-center sm:text-left h-28 sm:h-auto">
                            <div className="flex items-center gap-1.5 sm:gap-3 text-slate-500 mb-1 sm:mb-4"><FolderOpen size={16} className="sm:w-5 sm:h-5 hidden sm:block"/><span className="text-[10px] sm:text-sm font-black uppercase tracking-wide truncate">Total Projects</span></div>
                            <div className="text-2xl sm:text-5xl font-black text-slate-800">{projects.length}</div>
                          </div>
                          <div className="bg-white p-4 sm:p-6 rounded-2xl sm:rounded-[2rem] border border-slate-200 shadow-sm flex flex-col justify-center items-center sm:items-start text-center sm:text-left h-28 sm:h-auto">
                            <div className="flex items-center gap-1.5 sm:gap-3 text-blue-500 mb-1 sm:mb-4"><Activity size={16} className="sm:w-5 sm:h-5 hidden sm:block"/><span className="text-[10px] sm:text-sm font-black uppercase tracking-wide truncate">Active Plots</span></div>
                            <div className="text-2xl sm:text-5xl font-black text-blue-600">{activePlotsCount}</div>
                          </div>
                          <div className="bg-white p-4 sm:p-6 rounded-2xl sm:rounded-[2rem] border border-slate-200 shadow-sm flex flex-col justify-center items-center sm:items-start text-center sm:text-left h-28 sm:h-auto">
                            <div className="flex items-center gap-1.5 sm:gap-3 text-emerald-500 mb-1 sm:mb-4"><CheckCircle size={16} className="sm:w-5 sm:h-5 hidden sm:block"/><span className="text-[10px] sm:text-sm font-black uppercase tracking-wide truncate">Completed</span></div>
                            <div className="text-2xl sm:text-5xl font-black text-emerald-600">{completedPlotsCount}</div>
                          </div>
                          <div className={`p-4 sm:p-6 rounded-2xl sm:rounded-[2rem] border shadow-sm flex flex-col justify-center items-center sm:items-start text-center sm:text-left h-28 sm:h-auto ${delayedPlotsCount > 0 ? 'bg-rose-50 border-rose-200' : 'bg-white border-slate-200'}`}>
                            <div className={`flex items-center gap-1.5 sm:gap-3 mb-1 sm:mb-4 ${delayedPlotsCount > 0 ? 'text-rose-500' : 'text-slate-400'}`}><AlertCircle size={16} className="sm:w-5 sm:h-5 hidden sm:block"/><span className="text-[10px] sm:text-sm font-black uppercase tracking-wide truncate">Delayed</span></div>
                            <div className={`text-2xl sm:text-5xl font-black ${delayedPlotsCount > 0 ? 'text-rose-600' : 'text-slate-300'}`}>{delayedPlotsCount}</div>
                          </div>
                       </div>
                    </div>

                    {(isSiteEngineer || isQC || isAdmin) && (
                      <div className="mb-6 sm:mb-12">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3 sm:mb-6">
                          <h2 className="font-black text-lg sm:text-2xl text-slate-800 italic uppercase tracking-tighter flex items-center gap-2"><ClipboardList className={isQC ? 'text-purple-600' : 'text-blue-600'} size={20}/> Inspection Queue <span className="bg-rose-600 text-white text-[10px] px-2 py-0.5 rounded-full">{inspectionQueue.length}</span></h2>
                          <div className="flex bg-white rounded-lg sm:rounded-xl shadow-sm border border-slate-200 overflow-hidden text-[10px] sm:text-sm font-bold"><button onClick={() => setInspectionSort('time')} className={`px-3 sm:px-4 py-2 sm:py-2.5 flex items-center gap-1.5 ${inspectionSort === 'time' ? 'bg-slate-100 text-slate-800' : 'text-slate-400'}`}><Clock size={14}/> ล่าสุด</button><button onClick={() => setInspectionSort('plot')} className={`px-3 sm:px-4 py-2 sm:py-2.5 flex items-center gap-1.5 border-l border-slate-200 ${inspectionSort === 'plot' ? 'bg-slate-100 text-slate-800' : 'text-slate-400'}`}><SortAsc size={14}/> รหัสแปลง</button></div>
                        </div>
                        {inspectionQueue.length === 0 ? ( 
                          <div className="bg-white rounded-2xl sm:rounded-[2rem] border border-dashed border-slate-300 p-8 sm:p-16 text-center flex flex-col items-center justify-center gap-3 sm:gap-4">
                             <div className="w-16 h-16 sm:w-20 sm:h-20 bg-slate-50 rounded-full flex items-center justify-center"><CheckCircle size={32} className="text-emerald-400 opacity-50"/></div>
                             <p className="text-slate-400 font-bold italic text-sm sm:text-xl">ไม่มีงานรอตรวจสอบ</p>
                          </div> 
                        ) : (
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-6">
                            {inspectionQueue.map(q => {
                              const relatedProject = projects.find(p => p.name === q.project_name); const relatedPlot = plots.find(p => p.id === q.plot_id); const relatedTask = taskTemplates.find(t => t.id === q.task_template_id);
                              return (
                                <button key={`${q.plot_id}-${q.task_template_id}`} onClick={() => {
                                   setSelectedProject(relatedProject); setSelectedPlot(relatedPlot); setSelectedTask(relatedTask); setView('task-progress');
                                   supabase.from('task_updates').select('*').eq('task_template_id', q.task_template_id).eq('plot_id', q.plot_id).order('created_at', { ascending: true }).then(({data}) => { setUpdates(data || []); setProgressValue(data?.length ? data[data.length-1].progress : 0); });
                                }} className="bg-white p-4 sm:p-6 rounded-xl sm:rounded-[1.5rem] border border-slate-200 shadow-sm hover:border-blue-500 hover:shadow-lg hover:-translate-y-1 transition-all text-left group">
                                  <div className="flex justify-between items-start mb-2 sm:mb-3"><span className={`text-[9px] sm:text-xs font-black uppercase tracking-widest px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-md text-white ${q.statusFor === 'QC' ? 'bg-purple-600' : 'bg-blue-600'}`}>รอ {q.statusFor}</span><span className="text-[9px] sm:text-xs text-slate-400 font-bold">{new Date(q.time).toLocaleTimeString('th-TH', {hour: '2-digit', minute:'2-digit'})}</span></div>
                                  <h4 className="font-black text-slate-800 text-lg sm:text-2xl">{q.plot_id}</h4><p className="text-xs sm:text-base font-bold text-slate-600 truncate my-1 sm:my-1.5">{q.task_name}</p><p className="text-[10px] sm:text-sm text-slate-400 flex items-center gap-1 sm:gap-1.5 mt-1.5 sm:mt-2"><HardHat size={12} className="sm:w-3.5 sm:h-3.5"/> {q.foreman}</p>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}

                    <div className="flex flex-col md:flex-row md:justify-between md:items-end mb-3 sm:mb-6 gap-3">
                      <h2 className="font-black text-xl sm:text-3xl text-slate-800 italic uppercase tracking-tighter">Projects Overview</h2>
                      {isMobileLayout && (
                         <div className="flex flex-wrap gap-2 shrink-0 w-full">
                           {isProcurement && (<button onClick={() => setView('procurement-contractors')} className="flex-1 items-center justify-center gap-1.5 bg-emerald-600 text-white px-3 py-2.5 rounded-lg font-bold text-[10px] shadow-sm flex"><Wrench size={14} /> ช่าง</button>)}
                           {isAdmin && (
                             <><button onClick={() => setView('admin-users')} className="flex-1 items-center justify-center gap-1.5 bg-white text-rose-600 border border-rose-200 px-3 py-2.5 rounded-lg font-bold text-[10px] shadow-sm flex"><Users size={14} /> ผู้ใช้</button><button onClick={() => setView('admin-project')} className="flex-1 items-center justify-center gap-1.5 bg-slate-800 text-white px-3 py-2.5 rounded-lg font-bold text-[10px] shadow-sm flex"><PlusCircle size={14} /> โครงการ</button></>
                           )}
                         </div>
                      )}
                    </div>
                    
                    <div className={`grid gap-3 sm:gap-6 ${isMobileLayout ? 'grid-cols-1' : 'grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'}`}>
                      {projects.map((proj) => (
                        <div key={proj.name} onClick={() => { 
                            const conf = proj.layout_data?.find(c => c.type === 'config');
                            setGridCols(conf?.cols || 40); setGridRows(conf?.rows || 24); setMapZoom(1);
                            setSelectedProject(proj); setMapGrid(proj.layout_data?.filter(c => c.type !== 'config') || []); setIsEditMapMode(false); setView('project-detail'); 
                        }} className="bg-white w-full p-5 sm:p-8 rounded-2xl sm:rounded-[2rem] border border-slate-200 text-left hover:border-blue-500 hover:shadow-2xl hover:-translate-y-1 transition-all group relative overflow-hidden cursor-pointer">
                          
                          {/* 🌟 ปุ่มแก้ไขชื่อโครงการ (แสดงเฉพาะ Admin) */}
                          {isAdmin && (
                            <button onClick={(e) => { e.stopPropagation(); handleEditProject(proj); }} className="absolute top-4 right-4 p-2 bg-slate-100 text-slate-500 rounded-xl opacity-0 group-hover:opacity-100 hover:bg-blue-600 hover:text-white transition-all z-20 shadow-sm" title="แก้ไขชื่อโครงการ">
                              <Settings size={20} />
                            </button>
                          )}

                          <Building size={isMobileLayout ? 60 : 100} className="absolute -right-4 -bottom-4 sm:-right-6 sm:-bottom-6 text-slate-50 group-hover:text-blue-50 transition-colors rotate-12" />
                          <h3 className="text-xl sm:text-3xl font-black text-slate-800 mb-1 sm:mb-2 relative z-10 w-full truncate text-left">{proj.name}</h3>
                          <Building size={isMobileLayout ? 60 : 100} className="absolute -right-4 -bottom-4 sm:-right-6 sm:-bottom-6 text-slate-50 group-hover:text-blue-50 transition-colors rotate-12" />
                          <h3 className="text-xl sm:text-3xl font-black text-slate-800 mb-1 sm:mb-2 relative z-10 w-full truncate text-left">{proj.name}</h3>
                          <p className="text-[10px] sm:text-sm text-slate-400 font-bold uppercase tracking-wider mb-4 sm:mb-8 relative z-10 flex items-center gap-1.5">
                            <MapIcon size={12} className="sm:w-4 sm:h-4"/> {isForeman ? `งานของคุณ ${plots.filter(p => p.project_name === proj.name && p.foreman === loggedInUser.username).length} แปลง` : `รวมทั้งหมด ${proj.plotCount} แปลง`}
                          </p>
                          <div className="h-2 sm:h-3 bg-slate-100 rounded-full overflow-hidden relative z-10 mt-4 sm:mt-6"><div className="h-full bg-blue-600 transition-all duration-1000" style={{width: `${proj.progress}%`}}></div></div>
                        </div>
                      ))}
                    </div>
                  </div>
               )}

               {/* 📊 🌟 View: Reports & Analytics 🌟 */}
               {view === 'reports' && (
                 <div className="animate-in slide-in-from-bottom-4 duration-500 max-w-[1400px] mx-auto">
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end mb-6 sm:mb-8 gap-3 sm:gap-4">
                       <div>
                          <h2 className="text-2xl sm:text-4xl font-black text-slate-800 italic uppercase tracking-tighter">Project Reports</h2>
                          <p className="text-slate-500 text-[10px] sm:text-sm font-bold uppercase tracking-widest mt-0.5 sm:mt-1">ภาพรวมและประสิทธิภาพโครงการ</p>
                       </div>
                       <button onClick={handleExportCSV} className="bg-emerald-600 text-white font-black px-4 sm:px-6 py-2.5 sm:py-3.5 rounded-lg sm:rounded-xl hover:bg-emerald-700 transition-colors shadow-lg flex items-center justify-center gap-2 text-xs sm:text-base w-full sm:w-auto">
                          <Download size={16} className="sm:w-5 sm:h-5"/> ดาวน์โหลดรายงาน (CSV)
                       </button>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 mb-4 sm:mb-6">
                       
                       <div className="bg-white p-5 sm:p-8 rounded-2xl sm:rounded-[2rem] border border-slate-200 shadow-sm lg:col-span-2">
                          <h3 className="font-black text-lg sm:text-xl text-slate-800 mb-4 sm:mb-6 flex items-center gap-2"><PieChart className="text-blue-600" size={20}/> สถานะแปลงบ้านทั้งหมด</h3>
                          <div className="flex flex-col sm:flex-row gap-5 sm:gap-10 items-center">
                             <div className="relative w-32 h-32 sm:w-40 sm:h-40 shrink-0">
                                <svg viewBox="0 0 36 36" className="w-full h-full transform -rotate-90">
                                   <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="#f1f5f9" strokeWidth="4" />
                                   {totalPlotsCount > 0 && (
                                     <>
                                       <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="#10b981" strokeWidth="4" strokeDasharray={`${(completedPlotsCount/totalPlotsCount)*100}, 100`} />
                                       <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="#f43f5e" strokeWidth="4" strokeDasharray={`${(delayedPlotsCount/totalPlotsCount)*100}, 100`} strokeDashoffset={`-${(completedPlotsCount/totalPlotsCount)*100}`} />
                                       <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="#3b82f6" strokeWidth="4" strokeDasharray={`${((totalPlotsCount - completedPlotsCount - delayedPlotsCount)/totalPlotsCount)*100}, 100`} strokeDashoffset={`-${((completedPlotsCount+delayedPlotsCount)/totalPlotsCount)*100}`} />
                                     </>
                                   )}
                                </svg>
                                <div className="absolute inset-0 flex flex-col items-center justify-center">
                                   <span className="text-2xl sm:text-3xl font-black text-slate-800">{totalPlotsCount}</span>
                                   <span className="text-[8px] sm:text-[10px] font-black uppercase text-slate-400">Total Plots</span>
                                </div>
                             </div>
                             
                             <div className="flex-1 w-full space-y-3 sm:space-y-4">
                                <div className="flex justify-between items-center bg-emerald-50 p-2.5 sm:p-3 rounded-lg sm:rounded-xl border border-emerald-100">
                                   <span className="font-bold text-xs sm:text-sm text-emerald-700 flex items-center gap-1.5 sm:gap-2"><div className="w-2 h-2 sm:w-3 sm:h-3 rounded-full bg-emerald-500"></div> เสร็จสมบูรณ์</span>
                                   <span className="font-black text-base sm:text-lg text-emerald-700">{completedPlotsCount} <span className="text-[10px] sm:text-xs text-emerald-500 font-bold">({totalPlotsCount?Math.round((completedPlotsCount/totalPlotsCount)*100):0}%)</span></span>
                                </div>
                                <div className="flex justify-between items-center bg-blue-50 p-2.5 sm:p-3 rounded-lg sm:rounded-xl border border-blue-100">
                                   <span className="font-bold text-xs sm:text-sm text-blue-700 flex items-center gap-1.5 sm:gap-2"><div className="w-2 h-2 sm:w-3 sm:h-3 rounded-full bg-blue-500"></div> ตามแผน</span>
                                   <span className="font-black text-base sm:text-lg text-blue-700">{totalPlotsCount - completedPlotsCount - delayedPlotsCount} <span className="text-[10px] sm:text-xs text-blue-500 font-bold">({totalPlotsCount?Math.round(((totalPlotsCount-completedPlotsCount-delayedPlotsCount)/totalPlotsCount)*100):0}%)</span></span>
                                </div>
                                <div className="flex justify-between items-center bg-rose-50 p-2.5 sm:p-3 rounded-lg sm:rounded-xl border border-rose-100">
                                   <span className="font-bold text-xs sm:text-sm text-rose-700 flex items-center gap-1.5 sm:gap-2"><div className="w-2 h-2 sm:w-3 sm:h-3 rounded-full bg-rose-500"></div> ล่าช้ากว่าแผน</span>
                                   <span className="font-black text-base sm:text-lg text-rose-700">{delayedPlotsCount} <span className="text-[10px] sm:text-xs text-rose-500 font-bold">({totalPlotsCount?Math.round((delayedPlotsCount/totalPlotsCount)*100):0}%)</span></span>
                                </div>
                             </div>
                          </div>
                       </div>

                       <div className="bg-white p-5 sm:p-8 rounded-2xl sm:rounded-[2rem] border border-slate-200 shadow-sm flex flex-col justify-between space-y-3 sm:space-y-4">
                          <div className="bg-slate-50 rounded-lg sm:rounded-xl p-4 sm:p-5 border border-slate-100 flex items-center gap-3 sm:gap-4">
                             <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center"><Building size={20} className="sm:w-6 sm:h-6"/></div>
                             <div><p className="text-[8px] sm:text-[10px] font-black uppercase tracking-widest text-slate-400">Total Projects</p><p className="text-xl sm:text-2xl font-black text-slate-800">{projects.length}</p></div>
                          </div>
                          
                          <div className="bg-rose-50 rounded-lg sm:rounded-xl p-4 sm:p-5 border border-rose-100 flex items-center gap-3 sm:gap-4">
                             <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-rose-200 text-rose-600 flex items-center justify-center"><ShieldAlert size={20} className="sm:w-6 sm:h-6"/></div>
                             <div><p className="text-[8px] sm:text-[10px] font-black uppercase tracking-widest text-rose-500">Total Reworks (ตีกลับ)</p><p className="text-xl sm:text-2xl font-black text-rose-700">{totalReworks} <span className="text-xs sm:text-sm font-bold opacity-60">ครั้ง</span></p></div>
                          </div>

                          <div className="bg-slate-50 rounded-lg sm:rounded-xl p-4 sm:p-5 border border-slate-100 flex items-center gap-3 sm:gap-4">
                             <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center"><HardHat size={20} className="sm:w-6 sm:h-6"/></div>
                             <div><p className="text-[8px] sm:text-[10px] font-black uppercase tracking-widest text-slate-400">Foremen Team</p><p className="text-xl sm:text-2xl font-black text-slate-800">{foremenList.length}</p></div>
                          </div>
                       </div>

                    </div>

                    <div className="bg-white rounded-2xl sm:rounded-[2rem] border border-slate-200 shadow-sm overflow-hidden mb-6">
                       <div className="p-4 sm:p-6 border-b border-slate-100"><h3 className="font-black text-lg sm:text-xl text-slate-800">ความคืบหน้าภาพรวมรายโครงการ</h3></div>
                       <div className="overflow-x-auto custom-scrollbar">
                         <table className="w-full text-left border-collapse min-w-[600px]">
                           <thead className="bg-slate-50">
                             <tr>
                               <th className="p-3 sm:p-4 pl-4 sm:pl-8 text-[10px] sm:text-xs font-black uppercase text-slate-500 tracking-widest w-1/3">Project Name</th>
                               <th className="p-3 sm:p-4 text-[10px] sm:text-xs font-black uppercase text-slate-500 tracking-widest text-center">Total Plots</th>
                               <th className="p-3 sm:p-4 text-[10px] sm:text-xs font-black uppercase text-slate-500 tracking-widest text-center">Delayed</th>
                               <th className="p-3 sm:p-4 pr-4 sm:pr-8 text-[10px] sm:text-xs font-black uppercase text-slate-500 tracking-widest w-1/3">Overall Progress</th>
                             </tr>
                           </thead>
                           <tbody>
                             {projects.map((proj, idx) => {
                                const projPlots = plots.filter(p => p.project_name === proj.name);
                                const dCount = projPlots.filter(p => getPlotOverallStatus(p.id).status === 'delayed').length;
                                return (
                                  <tr key={idx} className="border-b border-slate-100 hover:bg-slate-50/50">
                                    <td className="p-3 sm:p-4 pl-4 sm:pl-8 font-bold text-slate-700 text-xs sm:text-sm">{proj.name}</td>
                                    <td className="p-3 sm:p-4 text-center font-bold text-slate-600 text-xs sm:text-sm">{proj.plotCount}</td>
                                    <td className="p-3 sm:p-4 text-center"><span className={`font-bold px-2 sm:px-3 py-1 rounded-md sm:rounded-lg text-[10px] sm:text-xs ${dCount > 0 ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-400'}`}>{dCount > 0 ? `${dCount} แปลง` : '-'}</span></td>
                                    <td className="p-3 sm:p-4 pr-4 sm:pr-8">
                                       <div className="flex items-center gap-2 sm:gap-3">
                                          <div className="flex-1 bg-slate-200 h-1.5 sm:h-2 rounded-full overflow-hidden"><div className="bg-blue-600 h-full" style={{width:`${proj.progress}%`}}></div></div>
                                          <span className="font-black text-xs sm:text-sm w-8 sm:w-10 text-right text-blue-600">{proj.progress}%</span>
                                       </div>
                                    </td>
                                  </tr>
                                );
                             })}
                           </tbody>
                         </table>
                       </div>
                    </div>

                 </div>
               )}

               {/* 🗺️ View: Project Detail & Map Builder */}
               {view === 'project-detail' && selectedProject && (
                 <div className="animate-in slide-in-from-right duration-300">
                   <div className="flex justify-between items-end mb-4 sm:mb-6">
                      <button onClick={() => setView('dashboard')} className="text-xs sm:text-base font-bold text-blue-600 flex items-center gap-1 sm:gap-2 hover:translate-x-[-4px] transition-transform">← {isMobileLayout ? 'BACK' : 'BACK TO PROJECTS'}</button>
                      {isAdmin && (
                        <div className="flex flex-wrap justify-end gap-1.5 sm:gap-3">
                          <button onClick={() => setView('admin-plot')} className="flex items-center gap-1 sm:gap-2 px-2.5 sm:px-5 py-1.5 sm:py-3 rounded-lg sm:rounded-full font-bold text-[10px] sm:text-sm bg-white text-blue-600 border border-blue-200 hover:bg-blue-50 transition-colors shadow-sm sm:shadow-md"><PlusCircle size={14} className="sm:w-4 sm:h-4"/> เพิ่มแปลง</button>
                          <button onClick={() => setIsEditMapMode(!isEditMapMode)} className={`flex items-center gap-1 sm:gap-2 px-2.5 sm:px-5 py-1.5 sm:py-3 rounded-lg sm:rounded-full font-bold text-[10px] sm:text-sm transition-colors shadow-sm sm:shadow-md ${isEditMapMode ? 'bg-orange-500 text-white' : 'bg-slate-800 text-white hover:bg-slate-700'}`}>
                            <Grid size={14} className="sm:w-4 sm:h-4"/> {isEditMapMode ? 'ปิดจัดผัง' : 'จัดผัง'}
                          </button>
                        </div>
                      )}
                   </div>

                   <div className="mb-6 sm:mb-8 p-4 sm:p-8 bg-white rounded-2xl sm:rounded-[2.5rem] shadow-xl border border-slate-200 overflow-hidden relative">
                     <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 sm:mb-6 gap-3 sm:gap-4">
                        <div>
                          <h2 className="text-xl sm:text-4xl font-black text-slate-800 italic uppercase tracking-tighter">{selectedProject.name} MAP</h2>
                          <p className="text-slate-500 text-[10px] sm:text-sm font-bold uppercase tracking-widest flex items-center gap-1.5 sm:gap-2 mt-0.5 sm:mt-1"><MapIcon size={12} className="sm:w-4 sm:h-4"/> จำลองผังโครงการ ({gridCols}x{gridRows} Grid)</p>
                        </div>
                        
                        <div className="flex items-center gap-2 sm:gap-3 w-full sm:w-auto">
                          
                          {/* 🌟 UX: ช่องค้นหาช่างเข้างานวันนี้ (Contractor Radar) 🌟 */}
                          <div className="relative hidden lg:block mr-2 w-64">
                             <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                             <input type="text" placeholder="ค้นหาช่าง..." value={searchContractor} onChange={(e) => setSearchContractor(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-8 pr-3 py-2 text-xs font-bold outline-none focus:border-blue-500 text-slate-700 shadow-sm" />
                          </div>

                          <div className="flex bg-slate-100 rounded-lg border border-slate-200 shadow-sm p-1">
                             <button onClick={handleZoomOut} className="p-1.5 sm:p-2.5 text-slate-500 hover:text-blue-600 hover:bg-white rounded-md sm:rounded-lg transition-colors"><ZoomOut size={16} className="sm:w-5 sm:h-5"/></button>
                             <button onClick={handleZoomReset} className="px-2 sm:px-4 text-[10px] sm:text-sm font-black text-slate-600 hover:text-blue-600 hover:bg-white rounded-md sm:rounded-lg transition-colors">{Math.round(mapZoom * 100)}%</button>
                             <button onClick={handleZoomIn} className="p-1.5 sm:p-2.5 text-slate-500 hover:text-blue-600 hover:bg-white rounded-md sm:rounded-lg transition-colors"><ZoomIn size={16} className="sm:w-5 sm:h-5"/></button>
                          </div>
                          {isEditMapMode && (
                            <button onClick={handleSaveMap} disabled={isSubmitting} className="bg-blue-600 text-white px-4 sm:px-8 py-2 sm:py-3.5 rounded-lg sm:rounded-xl font-black shadow-lg hover:bg-blue-700 flex items-center justify-center gap-1.5 sm:gap-2 flex-1 sm:flex-none text-xs sm:text-base">
                              {isSubmitting ? <Loader2 className="animate-spin" size={16}/> : 'บันทึก'}
                            </button>
                          )}
                        </div>
                     </div>

                     {/* Mobile Search Bar */}
                     <div className="lg:hidden w-full mb-4 sm:mb-6 relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                        <input type="text" placeholder="ค้นหาชื่อช่างในผัง..." value={searchContractor} onChange={(e) => setSearchContractor(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-8 pr-3 py-2 text-xs font-bold outline-none focus:border-blue-500 text-slate-700 shadow-sm" />
                     </div>

                     {isEditMapMode && (
                       <div className="flex flex-col xl:flex-row gap-3 sm:gap-4 mb-4 sm:mb-6 p-3 sm:p-5 bg-slate-50 rounded-xl sm:rounded-2xl border border-slate-200 shadow-inner">
                         <div className="flex flex-wrap gap-1.5 sm:gap-3">
                            <button onClick={() => setMapTool('plot')} className={`px-2 sm:px-4 py-1.5 sm:py-3 rounded-lg sm:rounded-xl font-bold text-[10px] sm:text-sm border-2 flex items-center gap-1.5 sm:gap-2 ${mapTool === 'plot' ? 'bg-emerald-500 text-white border-emerald-500 shadow-sm' : 'bg-white text-emerald-600 border-emerald-200'}`}><Paintbrush size={12} className="sm:w-4 sm:h-4"/> ระบายบ้าน</button>
                            {mapTool === 'plot' && (
                              <select value={mapSelectedPlot} onChange={e => setMapSelectedPlot(e.target.value)} className="bg-white border border-slate-300 rounded-lg sm:rounded-xl px-2 sm:px-3 py-1.5 sm:py-3 text-[10px] sm:text-sm font-bold outline-none text-emerald-800 shadow-sm"><option value="">-- รหัสแปลง --</option>{plots.filter(p => p.project_name === selectedProject.name).map(p => <option key={p.id} value={p.id}>{p.id}</option>)}</select>
                            )}
                            <div className="w-px h-8 sm:h-12 bg-slate-300 mx-1 sm:mx-2 self-center hidden sm:block"></div>
                            <button onClick={() => setMapTool('road')} className={`px-2 sm:px-4 py-1.5 sm:py-3 rounded-lg sm:rounded-xl font-bold text-[10px] sm:text-sm border-2 flex items-center gap-1.5 sm:gap-2 ${mapTool === 'road' ? 'bg-slate-700 text-white border-slate-700 shadow-sm' : 'bg-white text-slate-600 border-slate-200'}`}>สร้างถนน</button>
                            <button onClick={() => setMapTool('fence')} className={`px-2 sm:px-4 py-1.5 sm:py-3 rounded-lg sm:rounded-xl font-bold text-[10px] sm:text-sm border-2 flex items-center gap-1.5 sm:gap-2 ${mapTool === 'fence' ? 'bg-orange-500 text-white border-orange-500 shadow-sm' : 'bg-white text-slate-600 border-slate-200'}`}>สร้างเส้นรั้ว</button>
                            <div className="w-px h-8 sm:h-12 bg-slate-300 mx-1 sm:mx-2 self-center hidden sm:block"></div>
                            <button onClick={() => setMapTool('eraser')} className={`px-2 sm:px-4 py-1.5 sm:py-3 rounded-lg sm:rounded-xl font-bold text-[10px] sm:text-sm border-2 flex items-center gap-1.5 sm:gap-2 ml-auto ${mapTool === 'eraser' ? 'bg-rose-500 text-white border-rose-500 shadow-sm' : 'bg-white text-slate-600 border-slate-200'}`}><Eraser size={12} className="sm:w-4 sm:h-4"/> ลบ</button>
                         </div>
                         <div className="flex items-center gap-2 sm:gap-3 bg-white px-3 sm:px-4 py-1.5 sm:py-2.5 rounded-lg sm:rounded-xl shadow-sm border border-slate-200 xl:ml-auto w-fit">
                            <span className="text-[9px] sm:text-xs font-black text-slate-500 uppercase">ขนาด Grid</span>
                            <input type="number" value={gridCols} onChange={e=>setGridCols(Number(e.target.value))} className="w-10 sm:w-16 text-center text-[10px] sm:text-sm font-bold border border-slate-200 rounded outline-none focus:border-blue-500 bg-slate-50 p-1 sm:p-1.5"/>
                            <span className="text-[10px] sm:text-sm text-slate-400">x</span>
                            <input type="number" value={gridRows} onChange={e=>setGridRows(Number(e.target.value))} className="w-10 sm:w-16 text-center text-[10px] sm:text-sm font-bold border border-slate-200 rounded outline-none focus:border-blue-500 bg-slate-50 p-1 sm:p-1.5"/>
                         </div>
                       </div>
                     )}

                     {/* 🌟 UX Blueprint Map 🌟 */}
                     <div className="w-full overflow-auto pb-4 custom-scrollbar bg-slate-100 rounded-xl sm:rounded-3xl border-2 sm:border-4 border-slate-300 shadow-inner" style={{ height: isMobileLayout ? '350px' : '600px' }}>
                       <div 
                          className={`relative bg-slate-50 select-none origin-top-left transition-transform duration-200 ${isEditMapMode ? 'cursor-crosshair' : 'cursor-grab'}`} 
                          style={{ 
                             width: `${gridCols * 40}px`, 
                             height: `${gridRows * 40}px`, 
                             minWidth: '100%', 
                             transform: `scale(${mapZoom})`,
                             backgroundImage: `radial-gradient(#cbd5e1 1.5px, transparent 1.5px)`,
                             backgroundSize: `40px 40px` // Dot grid pattern
                          }} 
                          onMouseLeave={handleMouseUp} onMouseUp={handleMouseUp}
                       >
                         <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${gridCols}, 1fr)`, gridTemplateRows: `repeat(${gridRows}, 1fr)` }}>
                           {Array.from({length: gridCols * gridRows}).map((_, i) => {
                             const x = i % gridCols, y = Math.floor(i / gridCols);
                             const cellData = mapGrid.find(c => c.x === x && c.y === y && (c.type === 'plot' || c.type === 'road'));
                             
                             let baseStyles = 'border-r border-b border-transparent '; // Remove solid grid lines
                             if (isEditMapMode && !cellData) baseStyles += 'hover:bg-blue-100/30 ';

                             if (cellData?.type === 'plot') {
                               const adj = getAdjacency(x, y, 'plot', cellData.plotId);
                               baseStyles = 'bg-emerald-100/50 border-emerald-300 ';
                               // Remove inner borders for contiguous plots
                               if (adj.hasTop) baseStyles += '!border-t-0 '; if (adj.hasBottom) baseStyles += '!border-b-0 '; if (adj.hasLeft) baseStyles += '!border-l-0 '; if (adj.hasRight) baseStyles += '!border-r-0 ';
                             } else if (cellData?.type === 'road') { 
                               baseStyles = 'bg-slate-600 flex items-center justify-center border-slate-700 '; 
                             }

                             return (
                               <div key={i} className={`relative transition-colors duration-75 border ${baseStyles}`} onMouseDown={() => handleMouseDown(x, y)} onMouseEnter={() => handleMouseEnter(x, y)} onClick={() => { if (!isEditMapMode && cellData?.type === 'plot') { const plotInfo = plots.find(p => p.id === cellData.plotId); if (plotInfo) { setSelectedPlot(plotInfo); setView('house-detail'); } } }}>
                                 {cellData?.type === 'road' && (() => {
                                    const adj = getAdjacency(x, y, 'road', null);
                                    return (<>{adj.hasLeft && adj.hasRight && !adj.hasTop && !adj.hasBottom && <div className="w-full h-0 border-t-2 border-dashed border-yellow-500/40" />}{adj.hasTop && adj.hasBottom && !adj.hasLeft && !adj.hasRight && <div className="h-full w-0 border-l-2 border-dashed border-yellow-500/40" />}{adj.hasTop && adj.hasBottom && adj.hasLeft && adj.hasRight && <div className="w-2 h-2 bg-yellow-500/40 rounded-full" />}</>);
                                 })()}
                               </div>
                             );
                           })}
                         </div>
                         {mapGrid.filter(c => c.type === 'fence-h').map(c => (<div key={c.id} className="absolute border-t-4 border-dashed border-orange-500 z-20 pointer-events-none" style={{ left: `${(c.x / gridCols) * 100}%`, top: `${(c.y / gridRows) * 100}%`, width: `${(1 / gridCols) * 100}%`, height: '6px', transform: 'translateY(-50%)' }} />))}
                         {mapGrid.filter(c => c.type === 'fence-v').map(c => (<div key={c.id} className="absolute border-l-4 border-dashed border-orange-500 z-20 pointer-events-none" style={{ left: `${(c.x / gridCols) * 100}%`, top: `${(c.y / gridRows) * 100}%`, width: '6px', height: `${(1 / gridRows) * 100}%`, transform: 'translateX(-50%)' }} />))}
                         
                         {/* 🌟 UX Blueprint: Smart Hover Tooltips & Contractor Filter 🌟 */}
                         {Object.entries(plotBounds).map(([plotId, bounds]:any) => {
                           const plotInfo = plots.find(p => p.id === plotId); if (!plotInfo) return null;
                           const w = bounds.maxX - bounds.minX + 1, h = bounds.maxY - bounds.minY + 1;
                           const statusInfo = getPlotOverallStatus(plotInfo.id);

                           const isMatchContractor = searchContractor === '' || assignments.some(a => a.plot_id === plotId && a.contractor_name.toLowerCase().includes(searchContractor.toLowerCase()));
                           const isActiveToday = plotsActiveToday.has(plotId);

                           return (
                             <div key={`label-${plotId}`} className={`absolute flex items-center justify-center p-1 transition-all ${isEditMapMode ? 'opacity-50 pointer-events-none' : 'hover:z-50 cursor-pointer group'} ${!isMatchContractor ? 'opacity-20 scale-95 grayscale' : 'opacity-100'}`} style={{ left: `${(bounds.minX / gridCols) * 100}%`, top: `${(bounds.minY / gridRows) * 100}%`, width: `${(w / gridCols) * 100}%`, height: `${(h / gridRows) * 100}%` }} onClick={() => { if (!isEditMapMode) { setSelectedPlot(plotInfo); setView('house-detail'); } }}>
                                
                                {isActiveToday && (
                                   <div className="absolute -top-3 -top-3 left-1/2 -translate-x-1/2 sm:-top-4 bg-yellow-400 text-slate-900 rounded-full p-1 sm:p-1.5 shadow-lg animate-bounce z-[60] border-2 border-white" title="มีการทำงานในแปลงนี้วันนี้">
                                      <Pickaxe size={14} className="w-3 h-3 sm:w-4 sm:h-4"/>
                                   </div>
                                )}

                                <div className={`w-full h-full border-[2px] sm:border-[3px] rounded-md sm:rounded-lg shadow-sm backdrop-blur-sm flex flex-col items-center justify-center relative transition-all group-hover:shadow-md group-hover:scale-[1.02] ${statusInfo.colors}`}>
                                   <span className="font-black text-[10px] sm:text-sm">{plotInfo.id}</span>
                                   
                                   <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-[160px] sm:w-[180px] bg-slate-900 text-white rounded-xl sm:rounded-2xl shadow-2xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all p-3 sm:p-4 pointer-events-none z-[100] border border-slate-700">
                                      <div className="flex justify-between items-center w-full mb-1 sm:mb-2">
                                         <span className="font-black text-xs sm:text-sm">{plotInfo.id}</span>
                                         <span className={`text-[8px] sm:text-[10px] font-black px-1.5 sm:px-2 py-0.5 rounded-full ${statusInfo.status === 'delayed' ? 'bg-rose-500 text-white' : statusInfo.status === 'completed' ? 'bg-emerald-500 text-white' : statusInfo.status === 'ahead' ? 'bg-indigo-500 text-white' : statusInfo.status === 'on-track' ? 'bg-blue-500 text-white' : 'bg-slate-600 text-slate-300'}`}>{statusInfo.label}</span>
                                      </div>
                                      <p className="text-[9px] sm:text-[10px] text-slate-400 mb-2 sm:mb-3 flex items-center gap-1 sm:gap-1.5"><HardHat size={10} className="sm:w-3 sm:h-3"/> {plotInfo.foreman || 'ไม่ระบุ'}</p>
                                      
                                      <div className="w-full space-y-1.5 sm:space-y-2 mt-1">
                                         <div className="flex justify-between text-[8px] sm:text-[10px] font-bold text-slate-400 leading-none"><span>Plan</span><span>{statusInfo.planned}%</span></div>
                                         <div className="w-full bg-slate-700 h-1 sm:h-1.5 rounded-full overflow-hidden"><div className="bg-slate-400 h-full" style={{width:`${statusInfo.planned}%`}}></div></div>
                                         
                                         <div className="flex justify-between text-[8px] sm:text-[10px] font-bold text-slate-400 leading-none pt-1"><span>Actual</span><span className={statusInfo.status === 'delayed' ? 'text-rose-400' : 'text-blue-400'}>{statusInfo.actual}%</span></div>
                                         <div className="w-full bg-slate-700 h-1 sm:h-1.5 rounded-full overflow-hidden"><div className={`h-full ${statusInfo.status === 'delayed' ? 'bg-rose-500' : 'bg-blue-500'}`} style={{width:`${statusInfo.actual}%`}}></div></div>
                                      </div>
                                      <div className="absolute top-full left-1/2 -translate-x-1/2 border-[5px] sm:border-[6px] border-transparent border-t-slate-900"></div>
                                   </div>
                                </div>
                             </div>
                           )
                         })}
                       </div>
                     </div>
                   </div>

                   <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 sm:mb-6 mt-8 sm:mt-12 gap-3 sm:gap-4">
                      <h3 className="font-black text-xl sm:text-3xl text-slate-800 italic uppercase">Plot Directory</h3>
                      <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 w-full sm:w-auto">
                        <div className="relative flex-1 sm:w-64"><Search className="absolute left-3 sm:left-4 top-1/2 -translate-y-1/2 text-slate-400" size={14} className="sm:w-[18px] sm:h-[18px]"/><input type="text" placeholder="ค้นหาแปลง (เช่น A-01)" value={searchPlot} onChange={(e) => setSearchPlot(e.target.value)} className="w-full bg-white border border-slate-200 rounded-lg sm:rounded-xl pl-9 sm:pl-11 pr-3 sm:pr-4 py-2 sm:py-3.5 text-xs sm:text-sm font-bold outline-none focus:border-blue-500 text-slate-700 shadow-sm" /></div>
                        {currentUserRole !== 'Foreman' && (
                           <div className="relative flex-1 sm:w-64"><Filter className="absolute left-3 sm:left-4 top-1/2 -translate-y-1/2 text-slate-400" size={14} className="sm:w-[18px] sm:h-[18px]"/><select value={filterForeman} onChange={(e) => setFilterForeman(e.target.value)} className="w-full bg-white border border-slate-200 rounded-lg sm:rounded-xl pl-9 sm:pl-11 pr-3 sm:pr-4 py-2 sm:py-3.5 text-xs sm:text-sm font-bold outline-none focus:border-blue-500 text-slate-700 appearance-none shadow-sm cursor-pointer"><option value="">โฟร์แมนทั้งหมด</option>{foremenList.map(f => <option key={f.id} value={f.username}>{f.username}</option>)}</select></div>
                        )}
                      </div>
                   </div>
                   
                   <div className={`grid gap-3 sm:gap-6 ${isMobileLayout ? 'grid-cols-2' : 'grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'}`}>
                      {displayPlots.map((plot) => {
                        // 🌟 ดึงข้อมูล Status ของแปลงนั้นๆ เพื่อเอา % แผนงาน (planned) และ % งานจริง (actual) 🌟
                        const statusInfo = getPlotOverallStatus(plot.id);

                        return (
                          <div key={plot.id} onClick={() => { setSelectedPlot(plot); setView('house-detail'); }} className="relative group w-full bg-white p-4 sm:p-8 rounded-xl sm:rounded-[2.5rem] border border-slate-200 text-left hover:border-blue-500 hover:shadow-xl hover:-translate-y-1 transition-all flex flex-col justify-between h-full cursor-pointer">
                           {/* 🌟 ปุ่มลบแปลงบ้าน (เห็นเฉพาะ Admin) 🌟 */}
                            {isAdmin && (
                              <button onClick={(e) => { e.stopPropagation(); handleDeletePlot(plot.id); }} className="absolute top-3 right-3 sm:top-5 sm:right-5 p-1.5 sm:p-2 bg-rose-50 text-rose-500 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-rose-500 hover:text-white transition-all z-20 shadow-sm" title="ลบแปลงนี้">
                                <Trash2 size={16} />
                              </button>
                            )} 
                            {/* 🌟 เพิ่มปุ่มแก้ไข (ใหม่) วางไว้ทางซ้ายของปุ่มลบเล็กน้อย */}
                            {isAdmin && (
                              <button onClick={(e) => { e.stopPropagation(); handleEditPlot(plot); }} className="absolute top-3 right-12 sm:top-5 sm:right-16 p-1.5 sm:p-2 bg-blue-50 text-blue-500 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-blue-500 hover:text-white transition-all z-20 shadow-sm" title="แก้ไขแปลงนี้">
                                <Settings size={16} />
                              </button>
                            )}
                            {/* ส่วนหัวของการ์ด และป้ายสถานะ */}
                            <div className="flex justify-between items-start w-full mb-1 sm:mb-2">
                              <h3 className={`${isMobileLayout ? 'text-2xl' : 'text-4xl sm:text-5xl'} font-black text-slate-800 truncate`}>{plot.id}</h3>
                              <span className={`text-[8px] sm:text-[10px] font-black px-2 py-1 rounded-full ${statusInfo.status === 'delayed' ? 'bg-rose-100 text-rose-600' : statusInfo.status === 'completed' ? 'bg-emerald-100 text-emerald-600' : statusInfo.status === 'ahead' ? 'bg-indigo-100 text-indigo-600' : statusInfo.status === 'on-track' ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-500'}`}>
                                {statusInfo.label}
                              </span>
                            </div>

                            <div className={`${isMobileLayout ? 'text-[9px]' : 'text-base'} font-bold text-slate-500 mb-1 sm:mb-3 flex items-center gap-1.5`}><HardHat size={isMobileLayout ? 12 : 18} className="text-orange-500" /> {plot.foreman || 'ไม่ระบุ'}</div>
                            <p className={`${isMobileLayout ? 'text-[8px]' : 'text-xs'} text-slate-400 font-bold uppercase tracking-wider mb-4 sm:mb-6`}>{plot.type}</p>
                            
                            {/* 🌟 ส่วนแถบ Progress: แบ่งเป็น Plan และ Actual 🌟 */}
                            <div className="w-full mt-auto space-y-2 sm:space-y-4">
                              
                              {/* แถบ Plan (แผนงาน) */}
                              <div>
                                <div className={`flex items-center justify-between font-black ${isMobileLayout ? 'text-[8px]' : 'text-[10px] sm:text-xs'} mb-1 sm:mb-1.5`}>
                                  <span className="text-slate-400 uppercase tracking-widest">Plan (แผน)</span>
                                  <span className="text-slate-500">{statusInfo.planned}%</span>
                                </div>
                                <div className="h-1.5 sm:h-2.5 bg-slate-100 rounded-full overflow-hidden">
                                  <div className="h-full bg-slate-300 transition-all duration-500" style={{width: `${statusInfo.planned}%`}}></div>
                                </div>
                              </div>

                              {/* แถบ Actual (งานจริง) */}
                              <div>
                                <div className={`flex items-center justify-between font-black ${isMobileLayout ? 'text-[8px]' : 'text-[10px] sm:text-xs'} mb-1 sm:mb-1.5`}>
                                  <span className="text-slate-400 uppercase tracking-widest">Actual (จริง)</span>
                                  <span className={`${statusInfo.status === 'delayed' ? 'text-rose-500' : 'text-blue-600'} ${isMobileLayout ? 'text-sm' : 'text-lg'}`}>{statusInfo.actual}%</span>
                                </div>
                                <div className="h-1.5 sm:h-2.5 bg-slate-100 rounded-full overflow-hidden">
                                  <div className={`h-full transition-all duration-500 ${statusInfo.status === 'delayed' ? 'bg-rose-500' : 'bg-blue-500'}`} style={{width: `${statusInfo.actual}%`}}></div>
                                </div>
                              </div>

                            </div>
                            
                            {/* ไอคอนจอบสีเหลืองในการ์ด (ผมปรับให้อยู่ตรงกลางบนเหมือนกันเพื่อความสวยงามครับ) */}
                            {plotsActiveToday.has(plot.id) && ( 
                              <div className="absolute -top-2 left-1/2 -translate-x-1/2 sm:-top-3 bg-yellow-400 text-slate-900 rounded-full p-1 sm:p-1.5 shadow-sm sm:shadow-md animate-bounce border-2 border-white">
                                  <Pickaxe size={isMobileLayout ? 12 : 16} />
                              </div> 
                            )}
                          </div>
                        );
                      })}
                   </div>
                 </div>
               )}

               {/* 📋 LEVEL 3: House Detail */}
               {view === 'house-detail' && selectedPlot && (
                 <div className="animate-in slide-in-from-right duration-300">
                   <button onClick={() => setView('project-detail')} className="mb-4 sm:mb-6 text-xs sm:text-base font-bold text-blue-600 flex items-center gap-1.5 hover:-translate-x-1 transition-transform">← {isMobileLayout ? 'BACK' : `BACK TO ${selectedProject?.name}`}</button>
                   
                   <div className="bg-white rounded-2xl sm:rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden border-b-8 border-b-slate-800">
                     <div className="bg-slate-800 p-5 sm:p-8 text-white relative overflow-hidden flex flex-col gap-4 sm:gap-6">
                       <HardHat size={isMobileLayout ? 120 : 180} className="absolute -right-5 -bottom-5 sm:-right-10 sm:-bottom-10 opacity-5 rotate-[-20deg] pointer-events-none" />
                       
                       <div className="flex flex-col sm:flex-row justify-between items-start w-full relative z-10 gap-3 sm:gap-4">
                          <div>
                             <h2 className={`${isMobileLayout ? 'text-3xl' : 'text-5xl'} font-black text-white mb-1 sm:mb-2 italic tracking-tighter`}>{selectedPlot.id}</h2>
                             <p className="text-slate-400 font-bold uppercase tracking-widest text-[9px] sm:text-sm italic">Foreman: {selectedPlot.foreman || 'ไม่ระบุ'} | Model: {selectedPlot.type}</p>
                          </div>
                          
                          {isProjectPlanner && (
                            <div className="flex gap-2 w-full sm:w-auto mt-2 sm:mt-0">
                              <button onClick={() => setCopyModalOpen(true)} className="flex-1 sm:w-auto bg-slate-700 text-slate-200 font-black px-3 sm:px-6 py-2.5 sm:py-4 rounded-lg sm:rounded-2xl hover:bg-slate-600 hover:text-white transition-colors shadow-sm flex items-center justify-center gap-1.5 sm:gap-2 text-[10px] sm:text-base border border-slate-600">
                                 <Copy size={isMobileLayout ? 14 : 20}/> คัดลอกแผน
                              </button>
                              <button onClick={handleSaveAllSchedules} disabled={isSubmitting} className="flex-1 sm:w-auto bg-pink-600 text-white font-black px-4 sm:px-8 py-2.5 sm:py-4 rounded-lg sm:rounded-2xl hover:bg-pink-700 transition-colors shadow-lg flex items-center justify-center gap-1.5 sm:gap-2 text-[10px] sm:text-base">
                                 {isSubmitting ? <Loader2 size={isMobileLayout ? 14 : 20} className="animate-spin"/> : <><Save size={isMobileLayout ? 14 : 20}/> บันทึกแผนงาน</>}
                              </button>
                            </div>
                          )}
                       </div>

                       <div className={`bg-white/10 backdrop-blur-md rounded-xl sm:rounded-[1.5rem] p-3 sm:p-6 border border-white/10 grid ${isMobileLayout ? 'grid-cols-2 gap-3' : 'grid-cols-4 gap-6'} relative z-10 text-left`}>
                          <div className="flex flex-col">
                             <p className={`${isMobileLayout ? 'text-[8px]' : 'text-xs'} text-slate-400 uppercase tracking-widest font-black mb-0.5 sm:mb-2`}>กรอบเวลา</p>
                             <div className={`font-bold ${isMobileLayout ? 'text-[9px] leading-tight' : 'text-base'} mt-0.5 sm:mt-0`}>
                                {plotPlanStart !== Infinity && plotPlanEnd !== -Infinity ? 
                                  `${new Date(plotPlanStart).toLocaleDateString('th-TH', {day:'numeric',month:'short'})} - ${new Date(plotPlanEnd).toLocaleDateString('th-TH', {day:'numeric',month:'short'})}` 
                                : <span className="text-slate-500 italic">ยังไม่มีแผน</span>}
                             </div>
                          </div>
                          <div className="flex flex-col">
                             <p className={`${isMobileLayout ? 'text-[8px]' : 'text-xs'} text-slate-400 uppercase tracking-widest font-black mb-0.5 sm:mb-2`}>ผ่านไปแล้ว</p>
                             <div className={`font-black ${isMobileLayout ? 'text-lg' : 'text-2xl'} text-blue-300 mt-0.5 sm:mt-0`}>
                                {plotPlanStart !== Infinity ? `${Math.min(daysElapsed, totalPlannedDays)} วัน` : '-'}
                             </div>
                          </div>
                          <div className="flex flex-col">
                             <p className={`${isMobileLayout ? 'text-[8px]' : 'text-xs'} text-slate-400 uppercase tracking-widest font-black mb-0.5 sm:mb-2`}>เหลือเวลา</p>
                             <div className={`font-black ${isMobileLayout ? 'text-lg' : 'text-2xl'} text-emerald-300 mt-0.5 sm:mt-0`}>
                                {plotPlanEnd !== -Infinity ? `${Math.max(0, daysRemaining)} วัน` : '-'}
                             </div>
                          </div>
                          <div className="flex flex-col">
                             <p className={`${isMobileLayout ? 'text-[8px]' : 'text-xs'} text-slate-400 uppercase tracking-widest font-black mb-0.5 sm:mb-2`}>สถานะ</p>
                             <div className={`font-black ${isMobileLayout ? 'mt-0.5' : 'mt-2'}`}>
                                {plotPlanStart === Infinity ? <span className="text-slate-500 text-[10px] sm:text-base">รอแผนงาน</span> :
                                 isSummaryDelayed ? <span className="bg-rose-500 text-white px-2 sm:px-4 py-0.5 sm:py-2 rounded sm:rounded-lg text-[9px] sm:text-sm shadow-sm">ล่าช้า 🔴</span> : 
                                 selectedPlot?.progress === 100 ? <span className="bg-emerald-500 text-white px-2 sm:px-4 py-0.5 sm:py-2 rounded sm:rounded-lg text-[9px] sm:text-sm shadow-sm">เสร็จ 🟢</span> :
                                 <span className="bg-blue-500 text-white px-2 sm:px-4 py-0.5 sm:py-2 rounded sm:rounded-lg text-[9px] sm:text-sm shadow-sm">ตามแผน 🔵</span>}
                             </div>
                          </div>
                       </div>
                     </div>

                     <div className="bg-slate-50 w-full overflow-x-auto custom-scrollbar border-t border-slate-200" style={{ maxHeight: '800px', overflowY: 'auto' }}>
                       {isMobileLayout && <div className="text-center text-[10px] text-slate-400 font-bold py-2 bg-slate-100 border-b border-slate-200">↔️ ปัดซ้าย-ขวา เพื่อดูตาราง ↔️</div>}
                       <table className={`text-left border-collapse w-full relative ${isMobileLayout ? 'min-w-[600px]' : 'min-w-[1200px]'}`}>
                         <thead className="sticky top-0 z-[60] bg-slate-100 shadow-sm text-[10px] sm:text-xs font-black uppercase text-slate-500 tracking-widest">
                           <tr>
                             <th className={`sticky left-0 bg-slate-100 z-[65] border-b border-r border-slate-200 p-3 sm:p-5 ${isMobileLayout ? 'w-[140px] max-w-[140px]' : 'w-[280px] min-w-[280px] max-w-[280px]'} shadow-[4px_0_15px_-5px_rgba(0,0,0,0.1)]`}>Task Name</th>
                             {!isMobileLayout && ( 
                                <>
                                  <th className="sticky left-[280px] bg-slate-100 z-[65] border-b border-r border-slate-200 p-5 text-center w-[140px] min-w-[140px] max-w-[140px]">Start</th>
                                  <th className="sticky left-[420px] bg-slate-100 z-[65] border-b border-r border-slate-200 p-5 text-center w-[100px] min-w-[100px] max-w-[100px] text-pink-600">Duration</th>
                                  <th className="sticky left-[520px] bg-slate-100 z-[65] border-b border-r border-slate-200 p-5 text-center w-[140px] min-w-[140px] max-w-[140px] shadow-[4px_0_10px_-4px_rgba(0,0,0,0.05)]">Finish</th>
                                </> 
                              )}
                             <th className={`bg-slate-100 border-b border-slate-200 p-0 relative ${isMobileLayout ? 'min-w-[400px] h-12' : 'min-w-[800px] h-20'} w-full z-[60]`}>
                                {todayTs >= chartStart && todayTs <= chartEnd && (
                                   <div className="absolute top-0 bottom-[-5000px] border-l-2 sm:border-l-[3px] border-dashed border-rose-500 z-[10] flex flex-col items-center pointer-events-none" style={{ left: `${getChartLeft(todayTs)}%` }}>
                                      <span className="bg-rose-500 text-white text-[7px] sm:text-[11px] font-black px-1.5 sm:px-2.5 py-0.5 sm:py-1 rounded-b-md sm:rounded-b-lg shadow-md mt-0 sm:mt-1">ปัจจุบัน</span>
                                   </div>
                                )}
                                  {/* 🌟 ปรับปรุงการวาด Row วันที่และเดือนเป็น 2 ชั้น 🌟 */}
                                            <div className="absolute inset-0 flex pointer-events-none">
                                                {timeMarkers.map((m, i) => (
                                                  <div key={i} className={`border-l h-full relative ${m.isMonth ? 'border-slate-300 bg-slate-200/20' : 'border-slate-200/50'}`} style={{position: 'absolute', left: `${m.left}%`}}>
                                                    
                                                    {/* 🔵 แถวบน: แสดงชื่อเดือนแบบป้ายคลุมหัว (ตรงที่กากบาทสีน้ำเงิน) */}
                                                    {m.monthLabel && (
                                                        <div className="absolute top-1.5 sm:top-2 left-1 bg-slate-800 text-white font-black px-2 py-0.5 rounded shadow-sm text-[8px] sm:text-[10px] whitespace-nowrap z-30 border border-slate-700">
                                                          {m.monthLabel}
                                                        </div>
                                                    )}
                                                    
                                                    {/* ⚪ แถวล่าง: แสดงตัวเลขวันที่ตามปกติทุกวัน */}
                                                    <div className="absolute bottom-1 sm:bottom-2 left-1">
                                                        <span className="text-[8px] sm:text-xs font-black text-slate-400">{m.dayLabel}</span>
                                                    </div>

                                                  </div>
                                                ))}
                                            </div>
                             </th>
                           </tr>
                         </thead>
                         <tbody>
                           {taskTemplates.filter(t => t.house_type_id === selectedPlot.house_type_id).map((task) => {
                             const key = `${selectedPlot.id}-${task.id}`;
                             const tProgress = latestUpdatesMap[key]?.progress || 0;
                             const assignment = assignments.slice().reverse().find(a => a.plot_id === selectedPlot.id && a.task_template_id === task.id);
                             const dates = taskDates[key];
                             const plan = schedules[key] || {};
                             const statusObj = getTaskStatus(plan.planned_end, dates?.end, tProgress);

                             const pStartTs = plan.planned_start ? new Date(plan.planned_start).getTime() : null;
                             const pEndTs = plan.planned_end ? new Date(plan.planned_end).getTime() : null;
                             const aStartTs = dates?.start ? new Date(dates.start).getTime() : null;
                             const aEndTs = dates?.end ? new Date(dates.end).getTime() : (aStartTs ? Date.now() : null);

                             return (
                               <tr key={task.id} className="group hover:bg-slate-50/80 transition-colors bg-white">
                                 <td className={`sticky left-0 bg-white z-[40] border-b border-r border-slate-200 p-2 sm:p-4 align-top shadow-[4px_0_15px_-5px_rgba(0,0,0,0.05)] ${isMobileLayout ? 'w-[140px]' : 'w-[280px]'}`}>
                                   <div onClick={() => { setSelectedTask(task); setView('task-progress'); supabase.from('task_updates').select('*').eq('task_template_id', task.id).eq('plot_id', selectedPlot.id).order('created_at', { ascending: true }).then(({data}) => { setUpdates(data || []); setProgressValue(data?.length ? data[data.length-1].progress : 0); }); }} className="flex justify-between items-start gap-1 sm:gap-3 cursor-pointer group/item hover:bg-slate-50 p-1.5 sm:p-2 -mx-1 sm:-mx-2 -mt-1 rounded-xl transition-colors">
                                      <div className="flex-1 pr-1">
                                         <div className="flex items-start sm:items-center gap-1.5 sm:gap-2 mb-1.5 sm:mb-2">
                                           <span className={`w-5 h-5 sm:w-8 sm:h-8 rounded-md sm:rounded-xl bg-slate-100 flex items-center justify-center text-[9px] sm:text-xs font-black text-slate-500 shrink-0 mt-0.5 sm:mt-0`}>{task.task_order}</span>
                                           <h4 className={`font-bold text-slate-700 ${isMobileLayout ? 'text-[10px] leading-tight' : 'text-sm sm:text-base leading-tight'} group-hover/item:text-blue-600 transition-colors`}>{task.task_name}</h4>
                                         </div>
                                         <div className="flex items-center gap-1.5 sm:gap-2 mt-1 sm:mt-2">
                                            <span className={`text-[9px] sm:text-xs font-black text-blue-600 bg-blue-50 px-1.5 py-0.5 sm:px-2.5 sm:py-1.5 rounded-md sm:rounded-lg`}>{tProgress}%</span>
                                            {plan.planned_end && (
                                              isMobileLayout 
                                                ? <span className="text-[8px] text-slate-400 font-bold truncate max-w-[50px]">{new Date(plan.planned_end).toLocaleDateString('th-TH',{day:'numeric',month:'short'})}</span>
                                                : <span className={`text-[10px] sm:text-xs font-black px-2.5 py-1.5 rounded-lg border uppercase tracking-wider ${statusObj.color}`}>{statusObj.label}</span>
                                            )}
                                         </div>
                                      </div>
                                      <div className="text-slate-400 group-hover/item:text-blue-600 p-1 sm:p-2 rounded-lg bg-slate-50 mt-1 sm:mt-0"><ChevronRight size={isMobileLayout ? 14 : 20}/></div>
                                   </div>
                                   <div className={`mt-2 sm:mt-3 pt-2 sm:pt-3 border-t border-slate-100 ${isMobileLayout ? 'px-0' : 'px-1'}`}>
                                      {assignment ? ( <p className={`text-[9px] sm:text-xs font-bold text-slate-500 flex items-center gap-1 sm:gap-2`}><HardHat size={isMobileLayout?12:14} className="text-emerald-500"/> {isMobileLayout ? assignment.contractor_name.split(' ')[0] : assignment.contractor_name}</p> ) : ( <p className={`text-[9px] sm:text-xs font-bold text-rose-500 flex items-center gap-1 sm:gap-2`}><AlertTriangle size={isMobileLayout?12:14}/> {isMobileLayout ? 'ไม่ระบุ' : 'ยังไม่ระบุช่าง'}</p> )}
                                      {(isProcurement || isAdmin || isProjectPlanner) && ( <button onClick={(e) => { e.stopPropagation(); setAssignModal({ isOpen: true, task: task, name: assignment?.contractor_name || '', phone: assignment?.contractor_phone || '' }); }} className={`mt-2 sm:mt-4 w-full bg-emerald-50 text-emerald-700 font-bold ${isMobileLayout ? 'px-2 py-1.5 text-[8px] rounded-lg' : 'px-4 py-2.5 text-xs sm:text-sm rounded-xl'} hover:bg-emerald-100 transition-colors border border-emerald-200 flex items-center justify-center gap-1.5 sm:gap-2`}>
                                          {assignment ? <><Wrench size={isMobileLayout ? 10 : 16}/> แก้ไข</> : <><UserPlus size={isMobileLayout ? 10 : 16}/> มอบหมาย</>}
                                        </button>
                                      )}
                                   </div>
                                 </td>

                                  {!isMobileLayout && currentUserRole === 'Project Planner' && (() => {
                                    const currentStart = scheduleInputs[task.id]?.start !== undefined ? scheduleInputs[task.id].start : (plan.planned_start || '');
                                    const currentEnd = scheduleInputs[task.id]?.end !== undefined ? scheduleInputs[task.id].end : (plan.planned_end || '');
                                    
                                    let initialDuration = '';
                                    if (currentStart && currentEnd) {
                                      const diffTime = new Date(currentEnd).getTime() - new Date(currentStart).getTime();
                                      initialDuration = String(Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24))) + 1);
                                    }
                                    const currentDuration = scheduleInputs[task.id]?.duration !== undefined ? scheduleInputs[task.id].duration : initialDuration;

                                    return (
                                      <>
                                        <td className="sticky left-[280px] bg-white z-[40] border-b border-r border-slate-200 p-4 align-top bg-pink-50/20 w-[140px] min-w-[140px] max-w-[140px]">
                                            <input type="date" value={currentStart} 
                                              onChange={(e) => {
                                                  const newStart = e.target.value; let newEnd = currentEnd;
                                                  if (newStart && currentDuration && Number(currentDuration) > 0) {
                                                    const d = new Date(newStart); d.setDate(d.getDate() + (Number(currentDuration) - 1));
                                                    newEnd = d.toISOString().split('T')[0];
                                                  }
                                                  setScheduleInputs(prev => ({...prev, [task.id]: { ...prev[task.id], start: newStart, end: newEnd, duration: currentDuration }}));
                                              }} 
                                              className="w-full border border-pink-200 rounded-lg px-2 py-2 text-[10px] sm:text-xs font-bold text-slate-700 outline-none focus:border-pink-500 bg-white shadow-sm" 
                                            />
                                        </td>
                                        <td className="sticky left-[420px] bg-white z-[40] border-b border-r border-slate-200 p-4 align-top bg-pink-50/20 w-[100px] min-w-[100px] max-w-[100px]">
                                            <input type="number" min="1" placeholder="วัน" value={currentDuration} 
                                              onChange={(e) => {
                                                  const newDuration = e.target.value; let newEnd = currentEnd;
                                                  if (currentStart && newDuration && Number(newDuration) > 0) {
                                                    const d = new Date(currentStart); d.setDate(d.getDate() + (Number(newDuration) - 1));
                                                    newEnd = d.toISOString().split('T')[0];
                                                  }
                                                  setScheduleInputs(prev => ({...prev, [task.id]: { ...prev[task.id], duration: newDuration, end: newEnd, start: currentStart }}));
                                              }}
                                              className="w-full border border-pink-200 rounded-lg px-2 py-2 text-[10px] sm:text-xs font-black text-center text-pink-600 outline-none focus:border-pink-500 bg-white shadow-sm" 
                                            />
                                        </td>
                                        <td className="sticky left-[520px] bg-white z-[40] border-b border-r border-slate-200 p-4 align-top bg-pink-50/20 shadow-[4px_0_10px_-4px_rgba(0,0,0,0.05)] w-[140px] min-w-[140px] max-w-[140px]">
                                            <input type="date" value={currentEnd} 
                                              onChange={(e) => {
                                                  const newEnd = e.target.value; let newDuration = currentDuration;
                                                  if (currentStart && newEnd) {
                                                    const diffTime = new Date(newEnd).getTime() - new Date(currentStart).getTime();
                                                    newDuration = String(Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24))) + 1);
                                                  }
                                                  setScheduleInputs(prev => ({...prev, [task.id]: { ...prev[task.id], end: newEnd, duration: newDuration, start: currentStart }}));
                                              }} 
                                              className="w-full border border-pink-200 rounded-lg px-2 py-2 text-[10px] sm:text-xs font-bold text-slate-700 outline-none focus:border-pink-500 bg-white shadow-sm" 
                                            />
                                        </td>
                                      </>
                                    );
                                  })()}

                                  {!isMobileLayout && currentUserRole !== 'Project Planner' && (() => {
                                    let durationText = '-';
                                    if (plan.planned_start && plan.planned_end) {
                                      const diff = new Date(plan.planned_end).getTime() - new Date(plan.planned_start).getTime();
                                      durationText = `${Math.max(0, Math.ceil(diff / (86400000))) + 1} วัน`;
                                    }
                                    return (
                                      <>
                                        <td className="sticky left-[280px] bg-white z-[40] border-b border-r border-slate-200 p-4 align-top text-center w-[140px] min-w-[140px] max-w-[140px]"><div className="text-[10px] sm:text-sm font-bold text-slate-700 mb-2">{plan.planned_start ? new Date(plan.planned_start).toLocaleDateString('th-TH',{day:'numeric',month:'short'}) : '-'}</div><div className="text-[10px] sm:text-sm font-bold text-blue-600">{dates?.start ? new Date(dates.start).toLocaleDateString('th-TH',{day:'numeric',month:'short'}) : '-'}</div></td>
                                        <td className="sticky left-[420px] bg-white z-[40] border-b border-r border-slate-200 p-4 align-middle text-center w-[100px] min-w-[100px] max-w-[100px] font-black text-slate-600 text-xs sm:text-sm">{durationText}</td>
                                        <td className="sticky left-[520px] bg-white z-[40] border-b border-r border-slate-200 p-4 align-top text-center shadow-[4px_0_10px_-4px_rgba(0,0,0,0.05)] w-[140px] min-w-[140px] max-w-[140px]"><div className="text-[10px] sm:text-sm font-bold text-slate-700 mb-2">{plan.planned_end ? new Date(plan.planned_end).toLocaleDateString('th-TH',{day:'numeric',month:'short'}) : '-'}</div><div className="text-[10px] sm:text-sm font-bold text-green-600">{dates?.end ? new Date(dates.end).toLocaleDateString('th-TH',{day:'numeric',month:'short'}) : '-'}</div></td>
                                      </>
                                    );
                                  })()}

                                 <td className={`border-b border-slate-200 p-0 relative ${isMobileLayout ? 'h-[100px]' : 'h-[140px]'} z-10 w-full`}>
                                   <div className="absolute inset-0 flex pointer-events-none z-0">
                                      {timeMarkers.map((m, i) => ( <div key={i} className={`border-l h-full ${m.isMonth ? 'border-slate-300 bg-slate-50/50' : 'border-slate-100'}`} style={{position: 'absolute', left: `${m.left}%`}}></div> ))}
                                   </div>
                                   <div className="relative w-full h-full flex flex-col justify-center px-0">
                                      {pStartTs && pEndTs && ( <div className={`absolute ${isMobileLayout ? 'h-1.5' : 'h-3'} bg-slate-800 rounded-full z-[20] shadow-sm`} style={{ left: `${getChartLeft(pStartTs)}%`, width: `${getChartWidth(pStartTs, pEndTs)}%` }} /> )}
                                      {aStartTs && ( <div className={`absolute ${isMobileLayout ? 'h-3.5 mt-5' : 'h-5 mt-7'} rounded-full z-[25] shadow-sm ${statusObj.barColor}`} style={{ left: `${getChartLeft(aStartTs)}%`, width: `${getChartWidth(aStartTs, aEndTs)}%` }}><span className={`absolute ${isMobileLayout ? '-top-3.5 text-[7px] px-1 py-0' : '-top-5 text-[9px] px-1.5 py-0.5'} left-0 font-black text-slate-600 bg-white/95 border border-slate-200 rounded shadow-sm`}>{tProgress}%</span></div> )}
                                   </div>
                                 </td>
                               </tr>
                             )
                           })}
                         </tbody>
                       </table>
                     </div>
                   </div>
                 </div>
               )}

               {/* 💬 LEVEL 4: Task Progress */}
               {view === 'task-progress' && selectedTask && (
                   <div className="animate-in slide-in-from-right duration-300">
                       <button onClick={() => setView('house-detail')} className="mb-4 sm:mb-6 text-xs sm:text-base font-bold text-blue-600 flex items-center gap-1.5 hover:-translate-x-1 transition-transform">← {isMobileLayout ? 'BACK' : 'BACK TO PLOT'}</button>
                       <div className="bg-white rounded-2xl sm:rounded-[2.5rem] shadow-2xl border border-slate-200 overflow-hidden flex flex-col h-[75vh] sm:h-[800px] relative border-b-8 border-b-blue-600">
                           <header className={`${isMobileLayout ? 'p-4' : 'p-6 sm:p-10'} bg-slate-800 text-white flex justify-between items-center shrink-0`}>
                               <div>
                                   <h1 className={`${isMobileLayout ? 'text-lg' : 'text-2xl sm:text-4xl'} font-black text-white leading-tight mb-1 sm:mb-2 italic uppercase tracking-tight`}>{selectedTask.task_name}</h1>
                                   <p className="text-[10px] sm:text-sm text-slate-400 font-bold uppercase tracking-widest">Plot {selectedPlot.id} / Task {selectedTask.task_order}</p>
                               </div>
                               
                               <div className="flex items-center gap-4">
                                 {isTaskCompleted && !isMobileLayout && (
                                    <button onClick={handleOpenExportModal} className="bg-white/20 hover:bg-white/30 text-white font-bold py-2 px-4 rounded-xl flex items-center gap-2 transition-colors text-sm border border-white/20">
                                      <Printer size={16}/> ส่งออกรูปตั้งเบิก
                                    </button>
                                 )}
                                 <div className={`${isMobileLayout ? 'text-3xl' : 'text-5xl sm:text-6xl'} font-black text-blue-400 italic tracking-tighter`}>{isTaskCompleted ? <CheckCircle size={isMobileLayout?32:48} className="text-green-400 inline-block"/> : `${progressValue}%`}</div>
                               </div>
                           </header>

                           {isTaskCompleted && isMobileLayout && (
                              <div className="bg-slate-700 p-2 flex justify-center">
                                 <button onClick={handleOpenExportModal} className="bg-white/10 hover:bg-white/20 text-white font-bold py-1.5 px-4 rounded-lg flex items-center gap-2 transition-colors text-xs border border-white/20 w-full justify-center">
                                   <Printer size={14}/> ส่งออกรูปถ่ายตั้งเบิก
                                 </button>
                              </div>
                           )}

                           <main className={`flex-1 overflow-y-auto ${isMobileLayout ? 'p-3 pb-32 space-y-3' : 'p-4 sm:px-8 sm:pt-8 sm:pb-[280px] space-y-4 sm:space-y-6'} bg-slate-50/50`}>
                               {updates.map((update) => (
                               <div key={update.id} className={`flex ${isMobileLayout ? 'gap-2' : 'gap-3 sm:gap-5'} animate-in slide-in-from-bottom-4`}>
                                   <div className={`${isMobileLayout ? 'w-8 h-8 rounded-lg text-xs' : 'w-10 h-10 sm:w-14 sm:h-14 rounded-2xl text-sm sm:text-base'} flex items-center justify-center text-white font-black shrink-0 shadow-lg ${update.role === 'QC' ? 'bg-purple-600' : update.role === 'Site Engineer' ? 'bg-blue-600' : 'bg-slate-600'}`}>{update.user_name.charAt(0)}</div>
                                   <div className={`flex-1 bg-white ${isMobileLayout ? 'p-3 rounded-2xl' : 'p-5 sm:p-6 rounded-[1.5rem] sm:rounded-[2rem]'} border border-slate-200 shadow-sm relative`}>
                                       <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start mb-2 sm:mb-4 gap-1 sm:gap-2">
                                         <p className={`text-[9px] sm:text-xs font-black uppercase italic tracking-widest leading-tight ${update.role === 'QC' ? 'text-purple-400' : update.role === 'Site Engineer' ? 'text-blue-400' : 'text-slate-400'}`}>{update.action} • {update.user_name} • {update.progress}%</p>
                                         <span className={`text-[8px] sm:text-xs text-slate-500 font-bold bg-slate-50 border border-slate-100 ${isMobileLayout ? 'px-2 py-0.5' : 'px-3 py-1.5'} rounded-lg shrink-0 w-fit`}>{new Date(update.created_at).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })} • {new Date(update.created_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.</span>
                                       </div>
                                       <p className={`text-slate-700 ${isMobileLayout ? 'text-xs mb-2' : 'text-sm sm:text-base mb-4'} font-medium leading-relaxed`}>{update.text_content}</p>
                                       {update.image_url && (
                                           <div className={`grid gap-2 ${update.image_url.split(',').filter(u => u.trim() !== '').length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                                               {update.image_url.split(',').filter(u => u.trim() !== '').map((url, i) => (
                                                  <img key={i} src={url.trim()} onClick={() => setFullImageUrl(url.trim())} className={`w-full aspect-video ${isMobileLayout ? 'h-24' : 'h-32 sm:h-48'} object-cover rounded-xl sm:rounded-2xl cursor-zoom-in border border-slate-100 shadow-sm hover:opacity-90 transition-opacity`} alt="Task Update" /> 
                                               ))}
                                           </div>
                                       )}
                                   </div>
                               </div>
                               ))}
                           </main>
                           
                           {/* 🏡 🌟 Chat Input 🌟 */}
                           <footer className={`absolute bottom-0 left-0 right-0 bg-white/95 backdrop-blur-xl border-t border-slate-200 ${isMobileLayout ? 'p-3' : 'p-4 sm:p-6'} shadow-[0_-10px_20px_rgba(0,0,0,0.05)] z-20`}>
                               {selectedFiles.length > 0 && (
                                   <div className={`flex gap-2 sm:gap-3 mb-2 sm:mb-4 overflow-x-auto pb-1 sm:pb-2`}>
                                       {selectedFiles.map((file, idx) => (
                                       <div key={idx} className="relative shrink-0 animate-in fade-in zoom-in duration-300">
                                           <img src={file.previewUrl} className={`${isMobileLayout ? 'w-12 h-12 border-2' : 'w-16 h-16 sm:w-20 sm:h-20 border-4'} object-cover rounded-xl border-blue-500 shadow-sm`} />
                                           <button onClick={() => { const n = [...selectedFiles]; n.splice(idx, 1); setSelectedFiles(n); }} className={`absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full ${isMobileLayout ? 'p-0.5 border' : 'p-1 border-2'} border-white hover:bg-red-600`}><X size={10} /></button>
                                       </div>
                                       ))}
                                   </div>
                               )}

                               {isTaskCompleted ? (
                                  <div className={`bg-green-100 text-green-700 py-3 sm:py-4 px-4 sm:px-6 rounded-xl sm:rounded-[1.5rem] font-black text-center uppercase tracking-widest border border-green-200 flex items-center justify-center gap-2 ${isMobileLayout ? 'text-[10px]' : 'text-xs sm:text-sm'}`}><CheckCircle size={isMobileLayout ? 16 : 20}/> ตรวจสอบและอนุมัติเสร็จสิ้น</div>
                               ) : isLockedForForeman ? (
                                  <div className={`bg-rose-50 text-rose-600 py-3 sm:py-4 px-4 sm:px-6 rounded-xl sm:rounded-[1.5rem] font-black text-center border border-rose-200 flex flex-col items-center justify-center gap-1`}><span className={`flex items-center gap-1.5 uppercase tracking-widest ${isMobileLayout ? 'text-[10px]' : 'text-xs sm:text-sm'}`}><AlertTriangle size={isMobileLayout ? 16 : 20}/> ยังไม่สามารถส่งงานได้</span><span className={`font-bold opacity-80 ${isMobileLayout ? 'text-[8px]' : 'text-[10px] sm:text-xs'}`}>กรุณารอผู้จัดจ้างระบุชื่อช่างก่อนครับ</span></div>
                               ) : isSiteEngineer ? (
                                 isPendingSE ? (
                                   <div className={`flex flex-col ${isMobileLayout ? 'gap-2' : 'gap-3 sm:gap-4'}`}>
                                     <div className={`flex ${isMobileLayout ? 'gap-1.5' : 'gap-2 sm:gap-3'} items-center`}>
                                         <label className={`text-slate-400 hover:text-blue-600 ${isMobileLayout ? 'p-2 rounded-lg' : 'p-2 sm:p-4 rounded-xl sm:rounded-[1.5rem]'} bg-slate-100 cursor-pointer shadow-sm active:scale-90 transition-transform`}><Camera size={isMobileLayout ? 18 : 24} /><input type="file" multiple accept="image/*" className="hidden" onChange={(e) => { const files = Array.from(e.target.files).map(f => ({ file: f, previewUrl: URL.createObjectURL(f) })); setSelectedFiles([...selectedFiles, ...files].slice(0, 4)); }} /></label>
                                         <input type="text" value={inputText} onChange={(e) => setInputText(e.target.value)} placeholder="ระบุความคิดเห็น..." className={`flex-1 bg-slate-100 ${isMobileLayout ? 'rounded-lg px-3 py-2.5 text-[10px]' : 'rounded-xl sm:rounded-[1.5rem] px-4 sm:px-6 py-3 sm:py-4 text-xs sm:text-sm'} font-bold outline-none focus:border-blue-500`} />
                                     </div>
                                     <div className={`flex ${isMobileLayout ? 'gap-1.5' : 'gap-2 sm:gap-4'}`}>
                                       <button onClick={() => handleReviewAction(false)} disabled={isSending} className={`flex-1 bg-red-50 text-red-600 ${isMobileLayout ? 'py-2 rounded-lg text-[9px]' : 'py-3 sm:py-4 rounded-xl sm:rounded-[1.5rem] text-[10px] sm:text-sm'} font-black border border-red-200 uppercase tracking-widest hover:bg-red-100 flex justify-center items-center gap-1.5 disabled:opacity-50`}>{isSending ? <Loader2 className="animate-spin" size={14}/> : 'ไม่อนุมัติ (แก้ 95%)'}</button>
                                       <button onClick={() => handleReviewAction(true)} disabled={isSending} className={`flex-1 bg-blue-600 text-white ${isMobileLayout ? 'py-2 rounded-lg text-[9px]' : 'py-3 sm:py-4 rounded-xl sm:rounded-[1.5rem] text-[10px] sm:text-sm'} font-black uppercase tracking-widest hover:bg-blue-700 flex justify-center items-center gap-1.5 disabled:opacity-50`}>{isSending ? <Loader2 className="animate-spin" size={14}/> : 'ตรวจสอบผ่าน'}</button>
                                     </div>
                                   </div>
                                 ) : ( <div className={`bg-slate-100 text-slate-400 py-3 sm:py-4 rounded-xl sm:rounded-[1.5rem] font-black text-center uppercase tracking-widest border border-slate-200 ${isMobileLayout ? 'text-[9px]' : 'text-xs sm:text-sm'}`}>รอโฟร์แมน 100% หรือ รอ QC ตรวจ</div> )
                               ) : isQC ? (
                                 isPendingQC ? (
                                   <div className={`flex flex-col ${isMobileLayout ? 'gap-2' : 'gap-3 sm:gap-4'}`}>
                                     <div className={`flex ${isMobileLayout ? 'gap-1.5' : 'gap-2 sm:gap-3'} items-center`}>
                                         <label className={`text-slate-400 hover:text-purple-600 ${isMobileLayout ? 'p-2 rounded-lg' : 'p-2 sm:p-4 rounded-xl sm:rounded-[1.5rem]'} bg-slate-100 cursor-pointer shadow-sm active:scale-90 transition-transform`}><Camera size={isMobileLayout ? 18 : 24} /><input type="file" multiple accept="image/*" className="hidden" onChange={(e) => { const files = Array.from(e.target.files).map(f => ({ file: f, previewUrl: URL.createObjectURL(f) })); setSelectedFiles([...selectedFiles, ...files].slice(0, 4)); }} /></label>
                                         <input type="text" value={inputText} onChange={(e) => setInputText(e.target.value)} placeholder="ระบุความคิดเห็น..." className={`flex-1 bg-slate-100 ${isMobileLayout ? 'rounded-lg px-3 py-2.5 text-[10px]' : 'rounded-xl sm:rounded-[1.5rem] px-4 sm:px-6 py-3 sm:py-4 text-xs sm:text-sm'} font-bold outline-none focus:border-purple-500`} />
                                     </div>
                                     <div className={`flex ${isMobileLayout ? 'gap-1.5' : 'gap-2 sm:gap-4'}`}>
                                       <button onClick={() => handleReviewAction(false)} disabled={isSending} className={`flex-1 bg-red-50 text-red-600 ${isMobileLayout ? 'py-2 rounded-lg text-[9px]' : 'py-3 sm:py-4 rounded-xl sm:rounded-[1.5rem] text-[10px] sm:text-sm'} font-black border border-red-200 uppercase tracking-widest hover:bg-red-100 flex justify-center items-center gap-1.5 disabled:opacity-50`}>{isSending ? <Loader2 className="animate-spin" size={14}/> : 'ไม่อนุมัติ (แก้ 95%)'}</button>
                                       <button onClick={() => handleReviewAction(true)} disabled={isSending} className={`flex-1 bg-purple-600 text-white ${isMobileLayout ? 'py-2 rounded-lg text-[9px]' : 'py-3 sm:py-4 rounded-xl sm:rounded-[1.5rem] text-[10px] sm:text-sm'} font-black uppercase tracking-widest hover:bg-purple-700 flex justify-center items-center gap-1.5 disabled:opacity-50`}>{isSending ? <Loader2 className="animate-spin" size={14}/> : 'QC ผ่าน (Complete)'}</button>
                                     </div>
                                   </div>
                                 ) : ( <div className={`bg-slate-100 text-slate-400 py-3 sm:py-4 rounded-xl sm:rounded-[1.5rem] font-black text-center uppercase tracking-widest border border-slate-200 ${isMobileLayout ? 'text-[9px]' : 'text-xs sm:text-sm'}`}>รองานผ่าน Site Engineer ก่อน</div> )
                               ) : isProcurement || isProjectPlanner ? (
                                   <div className={`bg-slate-100 text-slate-500 py-3 sm:py-4 px-4 sm:px-6 rounded-xl sm:rounded-[1.5rem] font-black text-center uppercase tracking-widest border border-slate-200 flex items-center justify-center gap-2 ${isMobileLayout ? 'text-[10px]' : 'text-xs sm:text-sm'}`}><AlertCircle size={18}/> ใช้สิทธิ์อัปเดตงานไม่ได้</div>
                               ) : (
                                 isPendingSE || isPendingQC ? (
                                   <div className={`bg-orange-100 text-orange-600 py-3 sm:py-4 px-4 sm:px-6 rounded-xl sm:rounded-[1.5rem] font-black text-center uppercase tracking-widest border border-orange-200 flex items-center justify-center gap-2 ${isMobileLayout ? 'text-[10px]' : 'text-xs sm:text-sm'}`}><Clock size={18}/> งานรอตรวจสอบ ({isPendingSE ? 'Site Engineer' : 'QC'})</div>
                                 ) : (
                                   <div className={`space-y-2 sm:space-y-4`}>
                                       <div className={`flex items-center gap-2 sm:gap-4 ${isMobileLayout ? 'px-1' : 'px-2'}`}>
                                           <span className={`font-black text-slate-500 uppercase italic tracking-widest ${isMobileLayout ? 'text-[8px]' : 'text-[10px] sm:text-xs'}`}>Progress</span>
                                           <input type="range" min={updates.length > 0 ? updates[updates.length-1].progress : 0} max="100" step="5" value={progressValue} onChange={(e) => setProgressValue(Number(e.target.value))} className={`flex-1 accent-blue-600 ${isMobileLayout ? 'h-1.5' : 'h-2 sm:h-2.5'} bg-slate-200 rounded-lg appearance-none cursor-pointer`} />
                                           <span className={`font-black text-blue-600 text-right italic ${isMobileLayout ? 'text-sm w-10' : 'text-xl sm:text-2xl w-16 sm:w-20'}`}>{progressValue}%</span>
                                       </div>
                                       <div className={`flex items-center ${isMobileLayout ? 'gap-1.5' : 'gap-2 sm:gap-3'}`}>
                                           <label className={`text-slate-400 hover:text-blue-600 ${isMobileLayout ? 'p-2 rounded-lg' : 'p-3 sm:p-4 rounded-xl sm:rounded-[1.5rem]'} bg-slate-100 cursor-pointer shadow-sm active:scale-90 transition-transform`}><Camera size={isMobileLayout ? 18 : 24} /><input type="file" multiple accept="image/*" className="hidden" onChange={(e) => { const files = Array.from(e.target.files).map(f => ({ file: f, previewUrl: URL.createObjectURL(f) })); setSelectedFiles([...selectedFiles, ...files].slice(0, 4)); }} /></label>
                                           <input type="text" value={inputText} onChange={(e) => setInputText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSendPost()} placeholder="อธิบายงาน..." className={`flex-1 bg-slate-100 ${isMobileLayout ? 'rounded-lg px-3 py-2 text-[10px]' : 'rounded-xl sm:rounded-[1.5rem] px-5 sm:px-6 py-3 sm:py-4 text-sm'} font-bold outline-none border-2 border-transparent focus:border-blue-500 shadow-inner`} />
                                           <button onClick={handleSendPost} disabled={isSending} className={`${isMobileLayout ? 'p-2 rounded-lg' : 'p-3 sm:p-4 rounded-xl sm:rounded-[1.5rem]'} text-white shadow-md disabled:opacity-50 ${progressValue === 100 ? 'bg-orange-500 hover:bg-orange-600' : 'bg-blue-600 hover:bg-blue-700'}`}>{isSending ? <Loader2 className="animate-spin" size={isMobileLayout ? 18 : 24}/> : <Send size={isMobileLayout ? 18 : 24}/>}</button>
                                       </div>
                                   </div>
                                 )
                               )}
                           </footer>
                       </div>
                   </div>
               )}

               {/* 🌟 1. ADMIN / PROCUREMENT FORMS 🌟 */}
               {view === 'procurement-contractors' && (isAdmin || isProcurement) && (
                 <div className="animate-in slide-in-from-bottom duration-300 max-w-3xl mx-auto mt-4 sm:mt-8 px-4 sm:px-0">
                    <button onClick={() => setView('dashboard')} className="mb-4 sm:mb-6 text-xs sm:text-base font-bold text-blue-600 flex items-center gap-1.5">← {isMobileLayout ? 'BACK' : 'BACK TO DASHBOARD'}</button>
                    <div className="bg-white p-5 sm:p-10 rounded-2xl sm:rounded-[2.5rem] border border-slate-200 shadow-xl">
                       <h2 className="text-xl sm:text-3xl font-black text-slate-800 uppercase italic tracking-tight mb-6 sm:mb-8 flex items-center gap-2"><Wrench className="text-emerald-500"/> Contractors DB</h2>
                       <div className="flex flex-col sm:flex-row gap-3 mb-8">
                         <input type="text" value={newContractor.name} onChange={(e) => setNewContractor({...newContractor, name: e.target.value})} placeholder="ชื่อช่างผู้รับเหมา..." className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-emerald-500" />
                         <input type="text" value={newContractor.phone} onChange={(e) => setNewContractor({...newContractor, phone: e.target.value})} placeholder="เบอร์โทรศัพท์..." className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-emerald-500" />
                         <button onClick={handleAddContractor} disabled={isSubmitting} className="bg-emerald-600 text-white px-6 py-3 rounded-xl font-black shadow-lg hover:bg-emerald-700 flex justify-center items-center gap-2">{isSubmitting ? <Loader2 className="animate-spin" size={18}/> : 'เพิ่มช่าง'}</button>
                       </div>
                       <div className="space-y-3">
                         <h3 className="text-xs sm:text-sm font-black text-slate-500 uppercase tracking-widest mb-4">รายชื่อช่างในระบบ</h3>
                         {contractors.length === 0 ? <p className="text-sm text-slate-400 italic">ยังไม่มีข้อมูลช่างในระบบ</p> : null}
                         {contractors.map(c => (
                           <div key={c.id} className="flex justify-between items-center p-4 bg-slate-50 rounded-xl border border-slate-100">
                             <div><span className="font-bold text-slate-700 block text-sm sm:text-base">{c.name}</span><span className="text-xs text-slate-500 flex items-center gap-1"><Phone size={12}/> {c.phone}</span></div>
                             <button onClick={() => handleDeleteContractor(c.id, c.name)} className="text-slate-400 hover:text-rose-500 p-2 bg-white rounded-lg shadow-sm"><Trash2 size={16} /></button>
                           </div>
                         ))}
                       </div>
                    </div>
                 </div>
               )}

               {/* 🌟 2. ADMIN FORMS: USERS 🌟 */}
               {view === 'admin-users' && isAdmin && (
                 <div className="animate-in slide-in-from-bottom duration-300 max-w-3xl mx-auto mt-4 sm:mt-8 px-4 sm:px-0">
                    <button onClick={() => setView('dashboard')} className="mb-4 sm:mb-6 text-xs sm:text-base font-bold text-blue-600 flex items-center gap-1.5">← {isMobileLayout ? 'BACK' : 'BACK TO DASHBOARD'}</button>
                    <div className="bg-white p-5 sm:p-10 rounded-2xl sm:rounded-[2.5rem] border border-slate-200 shadow-xl">
                       <h2 className="text-xl sm:text-3xl font-black text-slate-800 uppercase italic tracking-tight mb-6 sm:mb-8 flex items-center gap-2"><Users className="text-rose-600"/> Manage Users</h2>
                       <div className="flex flex-col sm:flex-row gap-3 mb-8">
                         <input type="text" value={newUser.name} onChange={(e) => setNewUser({...newUser, name: e.target.value})} placeholder="ชื่อผู้ใช้ใหม่..." className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-rose-500" />
                         <select value={newUser.role} onChange={(e) => setNewUser({...newUser, role: e.target.value})} className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-rose-500 text-slate-700">
                           <option value="Foreman">Foreman</option><option value="Site Engineer">Site Engineer</option><option value="QC">QC</option><option value="Project Planner">Project Planner (วางแผน)</option><option value="Procurement">Procurement (จัดจ้าง)</option><option value="Admin">Admin</option>
                         </select>
                         <button onClick={handleAddUser} disabled={isSubmitting} className="bg-rose-600 text-white px-6 py-3 rounded-xl font-black shadow-lg hover:bg-rose-700 flex justify-center items-center gap-2">{isSubmitting ? <Loader2 className="animate-spin" size={18}/> : 'เพิ่มผู้ใช้'}</button>
                       </div>
                       <div className="space-y-3">
                         <h3 className="text-xs sm:text-sm font-black text-slate-500 uppercase tracking-widest mb-4">รายชื่อในระบบ (รหัสผ่านเริ่มต้น: 1234)</h3>
                         {allUsers.length === 0 ? <p className="text-sm text-slate-400 italic">ไม่มีข้อมูลผู้ใช้</p> : null}
                         {allUsers.map(u => (
                           <div key={u.id} className="flex justify-between items-center p-4 bg-slate-50 rounded-xl border border-slate-100">
                             <div><span className="font-bold text-slate-700 block text-sm sm:text-base">{u.username}</span><span className={`text-[9px] sm:text-xs font-black uppercase tracking-widest mt-1 inline-block ${u.role === 'Admin' ? 'text-rose-500' : u.role === 'QC' ? 'text-purple-500' : u.role === 'Site Engineer' ? 'text-blue-500' : u.role === 'Project Planner' ? 'text-pink-500' : u.role === 'Procurement' ? 'text-emerald-500' : 'text-orange-500'}`}>{u.role}</span></div>
                             <button onClick={() => handleDeleteUser(u.id, u.username, u.role)} className="text-slate-400 hover:text-rose-500 p-2 bg-white rounded-lg shadow-sm"><Trash2 size={16} /></button>
                           </div>
                         ))}
                       </div>
                    </div>
                 </div>
               )}

               {/* 🌟 3. ADMIN FORMS: PROJECTS 🌟 */}
               {view === 'admin-project' && isAdmin && (
                 <div className="animate-in slide-in-from-bottom duration-300 max-w-xl mx-auto mt-4 sm:mt-8 px-4 sm:px-0">
                    <button onClick={() => setView('dashboard')} className="mb-4 sm:mb-6 text-xs sm:text-base font-bold text-blue-600 flex items-center gap-1.5">← {isMobileLayout ? 'BACK' : 'BACK TO PROJECTS'}</button>
                    <div className="bg-white p-6 sm:p-10 rounded-2xl sm:rounded-[2.5rem] border border-slate-200 shadow-xl">
                       <h2 className="text-xl sm:text-3xl font-black text-slate-800 uppercase italic tracking-tight mb-6 sm:mb-8 flex items-center gap-2"><PlusCircle className="text-rose-600"/> Add Project</h2>
                       <div className="space-y-4">
                          <input type="text" value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-4 text-sm font-bold outline-none focus:border-rose-500" placeholder="ชื่อโครงการ..." />
                          <button onClick={handleAddProject} disabled={isSubmitting} className="w-full bg-rose-600 text-white font-black py-4 rounded-xl shadow-lg hover:bg-rose-700 flex justify-center items-center gap-2 text-sm sm:text-lg">{isSubmitting ? <Loader2 className="animate-spin" size={20}/> : 'ยืนยันสร้างโครงการ'}</button>
                       </div>
                    </div>
                 </div>
               )}

               {/* 🌟 4. ADMIN FORMS: PLOTS 🌟 */}
               {view === 'admin-plot' && isAdmin && (
                 <div className="animate-in slide-in-from-bottom duration-300 max-w-xl mx-auto mt-4 sm:mt-8 px-4 sm:px-0">
                    <button onClick={() => setView(selectedProject ? 'project-detail' : 'dashboard')} className="mb-4 sm:mb-6 text-xs sm:text-base font-bold text-blue-600 flex items-center gap-1.5">← CANCEL</button>
                    <div className="bg-white p-6 sm:p-10 rounded-2xl sm:rounded-[2.5rem] border border-slate-200 shadow-xl">
                       {selectedProject ? (
                         <>
                           <div className="mb-6 sm:mb-8">
                              <h2 className="text-xl sm:text-3xl font-black text-slate-800 uppercase italic tracking-tight flex items-center gap-2"><MapIcon className="text-rose-600"/> Add Plot</h2>
                              <p className="text-sm font-bold text-slate-500 mt-2">To: {selectedProject.name}</p>
                           </div>
                           <div className="space-y-4">
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div>
                                  <label className="block text-xs font-black text-slate-500 mb-1 uppercase tracking-widest">รหัสแปลง (Plot ID)</label>
                                  <input type="text" value={newPlot.id} onChange={(e) => setNewPlot({...newPlot, id: e.target.value.toUpperCase()})} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 font-black text-rose-600 outline-none focus:border-rose-500 text-sm" placeholder="เช่น C-01" />
                                </div>
                                <div>
                                  <label className="block text-xs font-black text-slate-500 mb-1 uppercase tracking-widest">ผู้รับผิดชอบ (Foreman)</label>
                                  <select value={newPlot.foreman_name} onChange={(e) => setNewPlot({...newPlot, foreman_name: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-rose-500 text-slate-700">
                                    <option value="" disabled>-- เลือกโฟร์แมน --</option>
                                    {foremenList.map(f => <option key={f.id} value={f.username}>{f.username}</option>)}
                                  </select>
                                </div>
                              </div>
                              <div>
                                <label className="block text-xs font-black text-slate-500 mb-1 uppercase tracking-widest">แบบบ้าน (House Type)</label>
                                <select value={newPlot.house_type_id} onChange={(e) => setNewPlot({...newPlot, house_type_id: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-rose-500 text-slate-700">
                                  <option value="" disabled>-- เลือกแบบบ้าน --</option>
                                  {houseTypes.map(type => <option key={type.id} value={type.id}>{type.type_name}</option>)}
                                </select>
                              </div>
                              <button onClick={handleAddPlot} disabled={isSubmitting} className="w-full bg-rose-600 text-white font-black py-4 rounded-xl mt-4 shadow-lg hover:bg-rose-700 flex justify-center items-center gap-2 text-sm sm:text-lg">{isSubmitting ? <Loader2 className="animate-spin" size={20}/> : 'ยืนยันเพิ่มแปลงบ้าน'}</button>
                           </div>
                         </>
                       ) : (
                         <div className="text-center py-10">
                            <AlertTriangle className="mx-auto text-rose-500 mb-4" size={48}/>
                            <p className="text-slate-500 font-bold mb-6">กรุณาเลือกโครงการจากหน้า Dashboard ก่อน</p>
                            <button onClick={() => setView('dashboard')} className="px-6 py-3 bg-slate-100 rounded-xl font-bold text-slate-600 hover:bg-slate-200 transition-colors">กลับไปหน้าหลัก</button>
                         </div>
                       )}
                    </div>
                 </div>
               )}

             </div>
           </main>
           
           {/* 📱 Mobile Bottom Navigation */}
           {isMobileLayout && (
              <nav className="bg-white border-t border-slate-200 p-2 fixed bottom-0 left-[14px] right-[14px] rounded-b-[2rem] z-[100] shadow-[0_-10px_40px_rgba(0,0,0,0.1)] flex justify-around">
                 <button onClick={() => setView('dashboard')} className={`flex flex-col items-center p-2 rounded-xl w-16 ${view === 'dashboard' ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}>
                    <Home size={20} className={view === 'dashboard' ? 'fill-blue-100' : ''}/>
                    <span className="text-[9px] font-black mt-1">หน้าหลัก</span>
                 </button>
                 {(isAdmin || isProjectPlanner || isQC || isSiteEngineer) && (
                    <button onClick={() => setView('reports')} className={`flex flex-col items-center p-2 rounded-xl w-16 ${view === 'reports' ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}>
                       <PieChart size={20} className={view === 'reports' ? 'fill-blue-100' : ''}/>
                       <span className="text-[9px] font-black mt-1">รายงาน</span>
                    </button>
                 )}
                 {(isAdmin || isProcurement) && (
                    <button onClick={() => setView('procurement-contractors')} className={`flex flex-col items-center p-2 rounded-xl w-16 ${view === 'procurement-contractors' ? 'text-emerald-600' : 'text-slate-400 hover:text-slate-600'}`}>
                       <Wrench size={20} className={view === 'procurement-contractors' ? 'fill-emerald-100' : ''}/>
                       <span className="text-[9px] font-black mt-1">ช่าง</span>
                    </button>
                 )}
                 {isAdmin && (
                    <button onClick={() => handleLogout()} className={`flex flex-col items-center p-2 rounded-xl w-16 text-rose-600 hover:bg-rose-50'}`}>
                       <LogOut size={20} className='fill-rose-100'/>
                       <span className="text-[9px] font-black mt-1">ออกระบบ</span>
                    </button>
                 )}
              </nav>
           )}
        </div>
            </div>
            {editPlotModal.isOpen && (
                <div className="absolute inset-0 z-[600] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 fixed">
                  <div className="bg-white rounded-[2rem] shadow-2xl max-w-sm w-full p-6 space-y-5 animate-in zoom-in-95 duration-200">
                    <div>
                      <h3 className="text-xl font-black text-slate-800 italic uppercase flex items-center gap-2"><Settings className="text-blue-600"/> Edit Plot Info</h3>
                      <p className="text-sm text-slate-500 font-bold">แก้ไขข้อมูลแปลง: {editPlotModal.plot?.id}</p>
                    </div>
                    <div className="space-y-4">
                      <div>
                        <label className="block text-xs font-black text-slate-500 mb-1 uppercase tracking-widest">รหัสแปลง</label>
                        <input type="text" value={editPlotModal.id} onChange={(e) => setEditPlotModal({...editPlotModal, id: e.target.value.toUpperCase()})} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 font-black text-blue-600 outline-none focus:border-blue-500 text-sm" />
                      </div>
                      <div>
                        <label className="block text-xs font-black text-slate-500 mb-1 uppercase tracking-widest">แบบบ้าน</label>
                        <select value={editPlotModal.house_type_id} onChange={(e) => setEditPlotModal({...editPlotModal, house_type_id: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-blue-500 text-slate-700">
                          {houseTypes.map(type => <option key={type.id} value={type.id}>{type.type_name}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-black text-slate-500 mb-1 uppercase tracking-widest">โฟร์แมน</label>
                        <select value={editPlotModal.foreman_name} onChange={(e) => setEditPlotModal({...editPlotModal, foreman_name: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-blue-500 text-slate-700">
                          <option value="">-- เลือกโฟร์แมน --</option>
                          {foremenList.map(f => <option key={f.id} value={f.username}>{f.username}</option>)}
                        </select>
                      </div>
                    </div>
                    <div className="flex gap-3 w-full mt-2">
                      <button onClick={() => setEditPlotModal({...editPlotModal, isOpen: false})} className="flex-1 bg-slate-100 text-slate-600 font-bold py-3.5 rounded-xl hover:bg-slate-200">ยกเลิก</button>
                      <button onClick={handleUpdatePlot} disabled={isSubmitting} className="flex-1 bg-blue-600 text-white font-bold py-3.5 rounded-xl hover:bg-blue-700 flex justify-center items-center gap-2">
                        {isSubmitting ? <Loader2 className="animate-spin" size={16}/> : 'บันทึกแก้ไข'}
                      </button>
                    </div>
                  </div>
                </div>
              )} 
              {editProjectModal.isOpen && (
                <div className="absolute inset-0 z-[600] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 fixed">
                  <div className="bg-white rounded-[2rem] shadow-2xl max-w-sm w-full p-6 space-y-5 animate-in zoom-in-95 duration-200">
                    <div>
                      <h3 className="text-xl font-black text-slate-800 italic uppercase flex items-center gap-2"><Settings className="text-blue-600"/> Edit Project Name</h3>
                      <p className="text-sm text-slate-500 font-bold">ชื่อเดิม: {editProjectModal.oldName}</p>
                    </div>
                    <div className="space-y-4">
                      <div>
                        <label className="block text-xs font-black text-slate-500 mb-1 uppercase tracking-widest">ชื่อโครงการใหม่</label>
                        <input type="text" value={editProjectModal.newName} onChange={(e) => setEditProjectModal({...editProjectModal, newName: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 font-bold text-slate-700 outline-none focus:border-blue-500" placeholder="ระบุชื่อโครงการ..." />
                      </div>
                    </div>
                    <div className="flex gap-3 w-full mt-2">
                      <button onClick={() => setEditProjectModal({...editProjectModal, isOpen: false})} className="flex-1 bg-slate-100 text-slate-600 font-bold py-3.5 rounded-xl hover:bg-slate-200">ยกเลิก</button>
                      <button onClick={handleUpdateProject} disabled={isSubmitting} className="flex-1 bg-blue-600 text-white font-bold py-3.5 rounded-xl hover:bg-blue-700 flex justify-center items-center gap-2">
                        {isSubmitting ? <Loader2 className="animate-spin" size={16}/> : 'บันทึกแก้ไข'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
        {/* 🖨️ 🌟 ระบบจัดหน้า A4 สำหรับพิมพ์ 🌟 🖨️ */}
        <div id="printable-a4" className="hidden print:block absolute top-0 left-0 w-full bg-white z-[9999] text-black">
           {imageChunks.map((chunk, pageIdx) => (
             <div key={pageIdx} style={{ 
                boxSizing: 'border-box', 
                /* สั่งให้ขึ้นหน้าใหม่เฉพาะถ้าไม่ใช่หน้าสุดท้าย */
                pageBreakAfter: pageIdx === imageChunks.length - 1 ? 'auto' : 'always',
                breakAfter: pageIdx === imageChunks.length - 1 ? 'auto' : 'page',
                display: 'flex', 
                flexDirection: 'column',
                 paddingBottom: '10mm'
                }}>
               
               <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '3mm' }}>
                 <div>
                   <h1 style={{ fontSize: '18pt', fontWeight: 'bold', margin: '0 0 5px 0', textTransform: 'uppercase' }}>รายงานภาพถ่ายประกอบการตั้งเบิกผลงาน</h1>
                   <div style={{ display: 'flex', gap: '15px', fontSize: '10pt', color: '#475569' }}>
                     <span><strong>แปลง:</strong> {selectedPlot?.id}</span>
                     <span><strong>งาน:</strong> {selectedTask?.task_name}</span>
                     <span><strong>รุ่น:</strong> {selectedPlot?.type}</span>
                   </div>
                 </div>
                 <span style={{ fontSize: '9pt', fontWeight: 'bold', color: '#64748b' }}>หน้าที่ {pageIdx + 1} / {imageChunks.length}</span>
               </div>

               <hr style={{ border: 'none', borderTop: '1.5px solid #0f172a', margin: '0 0 5mm 0' }} />

               <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '5mm', flex: 1 }}>
                 {chunk.map((url, imgIdx) => (
                   <div key={imgIdx} style={{ border: '1px solid #e2e8f0', borderRadius: '6px', overflow: 'hidden', background: '#fff', padding: '6px', boxSizing: 'border-box' }}>
                     <img src={url} alt={`รูปที่ ${pageIdx * 8 + imgIdx + 1}`} style={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', display: 'block', borderRadius: '3px' }} />
                   </div>
                 ))}
               </div>

               <div style={{ marginTop: '5mm' }}>
                 <hr style={{ border: 'none', borderTop: '1px solid #cbd5e1', margin: '0 0 3mm 0' }} />
                 <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9pt', color: '#334155' }}>
                   <span><strong>ผู้ตรวจรับ:</strong> {loggedInUser?.username} ({loggedInUser?.role})</span>
                   <span><strong>วันที่ออกเอกสาร:</strong> {new Date().toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
                 </div>
               </div>

             </div>
           ))}
        </div>

      
    </div> 
  );
}