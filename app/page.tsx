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

export default function ConstructionApp() {
  // ==========================================
  // 1. STATES
  // ==========================================
  const [allUsers, setAllUsers] = useState<any[]>([]);
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
  const [loggedInUser, setLoggedInUser] = useState<any>(null);
  const [loginData, setLoginData] = useState({ username: '', pin: '' });

  const [view, setView] = useState('dashboard'); 
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
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
// 🌟 State สำหรับระบบ 2.5D แบบเจาะจงรายงวดงาน (0-99% และ 100%)
  const [editingHouseType, setEditingHouseType] = useState(null);
  const [visualConfig, setVisualConfig] = useState({}); // เก็บค่าแบบ Map { [taskId]: { progress_image, progress_z, done_image, done_z } }
  const [isUploadingLayer, setIsUploadingLayer] = useState(false);
  const [simulatedStatus, setSimulatedStatus] = useState({}); // 🎮 สำหรับกล่องลองเล่นพรีวิวในหน้าตั้งค่า { [taskId]: 'none' | 'progress' | 'done' }

  // ฟังก์ชันอัปโหลดรูปเฉพาะช่อง
  const handleUploadSlot = async (taskId, type, file) => {
    if (!file || !editingHouseType) return;
    setIsUploadingLayer(true);
    try {
      const path = `visualizer/${editingHouseType.id}/${taskId}-${type}-${Date.now()}`;
      const { error } = await supabase.storage.from('task_images').upload(path, file);
      if (error) throw error;
      const url = supabase.storage.from('task_images').getPublicUrl(path).data.publicUrl;
      
      setVisualConfig(prev => ({
        ...prev,
        [taskId]: {
          ...prev[taskId],
          [`${type}_image`]: url,
          [`${type}_z`]: prev[taskId]?.[`${type}_z`] || 10 // ค่าเริ่มต้น Z-index เป็น 10
        }
      }));
    } catch (err) {
      showAlert('อัปโหลดล้มเหลว', err.message);
    }
    setIsUploadingLayer(false);
  };

  // ฟังก์ชันบันทึกการตั้งค่าลง Supabase
  const handleSave25DConfig = async () => {
    if (!editingHouseType) return;
    setIsSubmitting(true);
    try {
      const { error } = await supabase.from('house_types')
        .update({ visual_config: visualConfig })
        .eq('id', editingHouseType.id);
      if (error) throw error;
      await fetchAllData();
      showAlert('สำเร็จ', 'บันทึกการจัดเลเยอร์ 2.5D แบบรายงวดงานเรียบร้อยแล้วครับ');
    } catch (e) {
      showAlert('ผิดพลาด', e.message);
    }
    setIsSubmitting(false);
  };
  
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
  const [currentWeather, setCurrentWeather] = useState(null);

  // 🌟 ดึงสภาพอากาศอัตโนมัติตามพิกัด GPS (ดึงจาก Open-Meteo ฟรีไม่มีลิมิต)
  useEffect(() => {
    const fetchWeather = async (lat = 13.75, lon = 100.51) => { // ค่าเริ่มต้นถ้าไม่เปิด GPS คือ กทม.
       try {
         const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`);
         const data = await res.json();
         const code = data.current_weather.weathercode;
         let icon = '☀️', text = 'ฟ้าโปร่ง';
         if (code > 0 && code <= 3) { icon = '⛅'; text = 'มีเมฆบางส่วน'; }
         else if (code >= 45 && code <= 48) { icon = '🌫️'; text = 'มีหมอก'; }
         else if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) { icon = '🌧️'; text = 'ฝนตก'; }
         else if (code >= 95) { icon = '⛈️'; text = 'ฝนฟ้าคะนอง'; }
         setCurrentWeather({ temp: data.current_weather.temperature, icon, text });
       } catch (e) { console.error('Weather Fetch Error', e); }
    };

    if (navigator.geolocation) {
       navigator.geolocation.getCurrentPosition(
         (pos) => fetchWeather(pos.coords.latitude, pos.coords.longitude),
         () => fetchWeather() // ถ้าผู้ใช้ไม่กดอนุญาต GPS ให้ใช้ค่าเริ่มต้น
       );
    } else fetchWeather();
  }, []);
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
  const [inspectionViewMode, setInspectionViewMode] = useState('card');
  const [inspectionFilterTab, setInspectionFilterTab] = useState('all');
  
  const [assignModal, setAssignModal] = useState({ isOpen: false, task: null, name: '', phone: '' });
  const [dialogConfig, setDialogConfig] = useState({ isOpen: false, title: '', message: '', type: 'confirm', onConfirm: null });
  const [scheduleInputs, setScheduleInputs] = useState({}); 
  const [copyModalOpen, setCopyModalOpen] = useState(false);
  const [copySourcePlot, setCopySourcePlot] = useState('');
  // 🌟 Daily Activity Report States 🌟
  const [activityReportOpen, setActivityReportOpen] = useState(false);
  const [activityReportDate, setActivityReportDate] = useState(new Date().toLocaleDateString('en-CA'));
  
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
  const [isPresentationOpen, setIsPresentationOpen] = useState(false);
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const [defects, setDefects] = useState([]);
  const [defectModal, setDefectModal] = useState({ isOpen: false, task: null, plotId: '' });
  const [newDefectText, setNewDefectText] = useState('');
  const [defectFiles, setDefectFiles] = useState([]);
  const [isSubmittingDefect, setIsSubmittingDefect] = useState(false);

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
      const { data: defectsData } = await supabase.from('defects').select('*');
      setDefects(defectsData || []);

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
  // 🌟 ระบบจำการล็อกอิน และตรวจจับเวลาหมดอายุ (ตั้งไว้ 60 นาที)
  useEffect(() => {
    const TIMEOUT_MS = 60 * 60 * 1000; // 60 นาที (ถ้าอยากได้ 120 นาที เปลี่ยนเลข 60 เป็น 120)
    const savedUser = localStorage.getItem('buildtrack_user');
    const lastActive = localStorage.getItem('buildtrack_last_active');

    if (savedUser && lastActive) {
      if (Date.now() - parseInt(lastActive) < TIMEOUT_MS) {
        setLoggedInUser(JSON.parse(savedUser));
        localStorage.setItem('buildtrack_last_active', Date.now().toString());
      } else {
        localStorage.removeItem('buildtrack_user');
        localStorage.removeItem('buildtrack_last_active');
      }
    }

    const updateActivity = () => {
      if (localStorage.getItem('buildtrack_user')) {
        localStorage.setItem('buildtrack_last_active', Date.now().toString());
      }
    };

    window.addEventListener('mousemove', updateActivity);
    window.addEventListener('keydown', updateActivity);
    window.addEventListener('click', updateActivity);
    window.addEventListener('touchstart', updateActivity);

    const interval = setInterval(() => {
      const lastAct = localStorage.getItem('buildtrack_last_active');
      if (lastAct && (Date.now() - parseInt(lastAct) > TIMEOUT_MS)) {
        setLoggedInUser(null);
        localStorage.removeItem('buildtrack_user');
        localStorage.removeItem('buildtrack_last_active');
        alert('เซสชันหมดอายุเนื่องจากไม่ได้ใช้งานเกิน 60 นาที กรุณาล็อกอินใหม่ครับ 🔒');
      }
    }, 60000);

    return () => {
      window.removeEventListener('mousemove', updateActivity);
      window.removeEventListener('keydown', updateActivity);
      window.removeEventListener('click', updateActivity);
      window.removeEventListener('touchstart', updateActivity);
      clearInterval(interval);
    };
  }, []);
 // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (loggedInUser) fetchAllData(); }, [loggedInUser]);
  useEffect(() => { setScheduleInputs({}); }, [selectedPlot?.id]);
  // 🌟 ระบบจับการกดปุ่มคีย์บอร์ด (ซ้าย, ขวา, ESC) สำหรับโหมด Presentation
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!isPresentationOpen) return;
      if (e.key === 'ArrowRight') setCurrentSlideIndex(prev => Math.min(prev + 1, plots.length - 1));
      if (e.key === 'ArrowLeft') setCurrentSlideIndex(prev => Math.max(prev - 1, 0));
      if (e.key === 'Escape') setIsPresentationOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPresentationOpen, plots.length]);

  // ==========================================
  // 4. HANDLERS
  // ==========================================
  const handleLogin = () => { 
    const user = allUsers.find(u => u.username === loginData.username && u.pin === loginData.pin);
    if (user) { 
      setLoggedInUser(user); 
      // 🌟 สั่งให้เบราว์เซอร์จำผู้ใช้ไว้ และเริ่มนับเวลา
      localStorage.setItem('buildtrack_user', JSON.stringify(user)); 
      localStorage.setItem('buildtrack_last_active', Date.now().toString());
    } else { 
      showAlert('ล้มเหลว', 'ชื่อผู้ใช้หรือ PIN ไม่ถูกต้อง'); 
    } 
  };
// 🌟 ฟังก์ชันเพิ่ม/แก้ไขแบบบ้าน พร้อมระบบอัปเดตชื่ออัตโนมัติป้องกันลิงก์พัง
  const [houseTypeForm, setHouseTypeForm] = useState({ id: '', type_name: '', memo: '' });
  const [isEditingType, setIsEditingType] = useState(false);


// 🌟 ฟังก์ชันจัดการงวดงาน (Task Templates)
  const [editingTaskHouseId, setEditingTaskHouseId] = useState('');
  const [taskForm, setTaskForm] = useState({ id: '', task_name: '', task_order: '' });
  const [isEditingTask, setIsEditingTask] = useState(false);

  const handleSaveTask = async () => {
    if (!editingTaskHouseId) return showAlert('ข้อผิดพลาด', 'กรุณาเลือกแบบบ้านก่อน');
    if (!taskForm.task_name.trim() || !taskForm.task_order) return showAlert('ข้อผิดพลาด', 'กรุณากรอกชื่อและลำดับงาน');
    
    setIsSubmitting(true);
    try {
      if (isEditingTask) {
        // อัปเดตงานเดิม
        const { error } = await supabase.from('task_templates')
          .update({ task_name: taskForm.task_name.trim(), task_order: parseInt(taskForm.task_order) })
          .eq('id', taskForm.id);
        if (error) throw error;
        showAlert('สำเร็จ', 'แก้ไขงวดงานเรียบร้อยแล้ว');
      } else {
        // เพิ่มงานใหม่
        const { error } = await supabase.from('task_templates')
          .insert([{ house_type_id: editingTaskHouseId, task_name: taskForm.task_name.trim(), task_order: parseInt(taskForm.task_order) }]);
        if (error) throw error;
        showAlert('สำเร็จ', 'เพิ่มงวดงานใหม่เรียบร้อยแล้ว');
      }
      setTaskForm({ id: '', task_name: '', task_order: '' });
      setIsEditingTask(false);
      await fetchAllData();
    } catch (e) {
      showAlert('ล้มเหลว', e.message);
    }
    setIsSubmitting(false);
  };

const handleDeleteTask = async (task) => {
    setIsSubmitting(true);
    try {
      // 🎯 สเต็ป 1: วิ่งไปตรวจสอบข้อมูลความสัมพันธ์ในตารางต่างๆ ว่ามีการเอางานนี้ไปใช้หรือยัง
      const { data: updatesCheck } = await supabase.from('task_updates').select('id').eq('task_template_id', task.id).limit(1);
      const { data: schedulesCheck } = await supabase.from('plot_task_schedules').select('id').eq('task_template_id', task.id).limit(1);
      const { data: assignmentsCheck } = await supabase.from('plot_task_assignments').select('id').eq('task_template_id', task.id).limit(1);
      const { data: defectsCheck } = await supabase.from('defects').select('id').eq('task_id', task.id).limit(1);

      // รวบรวมผลลัพธ์ว่ามีตารางไหนเจอข้อมูลบ้างไหม?
      const isUsed = (updatesCheck && updatesCheck.length > 0) || 
                     (schedulesCheck && schedulesCheck.length > 0) || 
                     (assignmentsCheck && assignmentsCheck.length > 0) || 
                     (defectsCheck && defectsCheck.length > 0);

      if (isUsed) {
         // 🛑 ถ้าเจอว่าถูกใช้งานแล้ว ให้บล็อกการลบ และแจ้งเตือนทันที
         setIsSubmitting(false);
         return showAlert(
            'ไม่อนุญาตให้ลบ ❌', 
            `ไม่สามารถลบงาน "${task.task_name}" ได้\n\nเนื่องจากงานนี้ถูกนำไปใช้งานแล้วในบางแปลง (มีการอัปเดตงาน, ผูกแผนงาน, หรือแจ้งซ่อม)\n\nกรุณาลบข้อมูลที่เกี่ยวข้องออกให้หมดก่อน จึงจะสามารถลบงวดงานนี้ได้ครับ`
         );
      }

      // 🟢 สเต็ป 2: ถ้างานนี้เป็นงานใหม่เอี่ยม ยังไม่เคยถูกใช้งานเลย ค่อยอนุญาตให้ลบได้
      setIsSubmitting(false);
      showConfirm('ยืนยันลบงวดงาน', `คุณแน่ใจหรือไม่ว่าต้องการลบงาน "${task.task_name}"?\n(ตรวจสอบแล้ว งานนี้ยังไม่เคยถูกใช้งาน สามารถลบได้อย่างปลอดภัย)`, async () => {
        setIsSubmitting(true);
        try {
          const { error } = await supabase.from('task_templates').delete().eq('id', task.id);
          if (error) throw error;
          
          await fetchAllData();
          closeDialog();
          showAlert('สำเร็จ', 'ลบงวดงานออกจากระบบเรียบร้อยแล้ว');
        } catch (e) {
          showAlert('ล้มเหลว', 'เกิดข้อผิดพลาดในการลบ: ' + e.message);
        }
        setIsSubmitting(false);
      });

    } catch (e) {
      setIsSubmitting(false);
      showAlert('ข้อผิดพลาด', 'ไม่สามารถตรวจสอบสถานะการใช้งานของงานนี้ได้');
    }
  };
const handleLogout = () => { 
    showConfirm('ยืนยันการออกจากระบบ', 'คุณแน่ใจหรือไม่ว่าต้องการออกจากระบบ?', () => {
      // 🌟 ล้างความจำในเบราว์เซอร์ทิ้ง
      localStorage.removeItem('buildtrack_user');
      localStorage.removeItem('buildtrack_last_active');

      setLoggedInUser(null);
      setLoginData({ username: '', pin: '' }); 
      setView('dashboard'); 
      setProjects([]); 
      setPlots([]); 
      setIsEditMapMode(false); 
      setIsMobilePreview(false); 
      
      closeDialog(); // ปิดหน้าต่างยืนยัน
    });
  };
  
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
const handleSendDefect = async () => {
    if ((!newDefectText.trim() && defectFiles.length === 0) || isSubmittingDefect) return;
    setIsSubmittingDefect(true);
    try {
      let imageUrls = [];
      if (defectFiles.length > 0) { 
        imageUrls = await Promise.all(defectFiles.map(async (f) => { 
          // 🌟 ปรับตรงนี้: เช็คก่อนว่ามีฟังก์ชันไหม ถ้าไม่มีให้ใช้ไฟล์ต้นฉบับเลย
          let comp;
          if (typeof compressImageNative === 'function') {
            comp = await compressImageNative(f.file);
          } else {
            console.warn("ไม่พบฟังก์ชันบีบอัดรูป ใช้ไฟล์ต้นฉบับ");
            comp = f.file;
          }
          
          const path = `${defectModal.plotId}/defect-${Date.now()}-${Math.random().toString(36).substr(2,9)}`; 
          const { error } = await supabase.storage.from('task_images').upload(path, comp);
          if (error) throw new Error('อัปโหลดรูปไม่สำเร็จ กรุณาลองใหม่');
          return supabase.storage.from('task_images').getPublicUrl(path).data.publicUrl; 
        })); 
      }
      const { error } = await supabase.from('defects').insert([{ plot_id: defectModal.plotId, task_id: defectModal.task?.id, description: newDefectText.trim(), reported_by: loggedInUser?.username || currentUserRole, status: 'pending', image_url: imageUrls.join(',') }]);
      if (error) throw error;
      
      // 🌟 1. ยิงการแจ้งเตือนไปหา Foreman ที่ดูแลแปลงนี้ 🌟
      const relatedPlot = plots.find(p => p.id === defectModal.plotId);
      if (relatedPlot && relatedPlot.foreman) {
         await supabase.from('notifications').insert([{
            plot_id: defectModal.plotId,
            task_template_id: defectModal.task?.id,
            message: `🛠️ แจ้งซ่อม (Defect) ใหม่: ${newDefectText.trim() || 'คลิกเพื่อดูรูปภาพและรายละเอียดในระบบ'}`,
            target_user: relatedPlot.foreman,
            target_role: 'Foreman'
         }]);
      }

      setNewDefectText(''); setDefectFiles([]);
      const { data } = await supabase.from('defects').select('*'); setDefects(data || []);
    } catch (e) { showAlert('Error', (e as Error).message); } setIsSubmittingDefect(false);
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
      const { error } = await supabase.from('task_updates').insert([{ plot_id: selectedPlot.id, task_template_id: selectedTask.id, user_name: loggedInUser.username, role: currentUserRole, action: actionLabel, text_content: inputText || actionLabel, progress: progressValue, image_url: imageUrls.join(','),weather_info: currentWeather ? `${currentWeather.icon} ${currentWeather.text} (${currentWeather.temp}°C)` : null }]);
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
      const { error } = await supabase.from('task_updates').insert([{ plot_id: selectedPlot.id, task_template_id: selectedTask.id, user_name: loggedInUser.username, role: currentUserRole, action: actionLabel, text_content: inputText || (isApproved ? 'งานเรียบร้อยดี ตรวจผ่าน' : 'พบข้อบกพร่อง กรุณาแก้ไข'), progress: finalP, image_url: imageUrls.join(','),weather_info: currentWeather ? `${currentWeather.icon} ${currentWeather.text} (${currentWeather.temp}°C)` : null }]);
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
  const isOwner = currentUserRole?.toLowerCase() === 'owner';

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
  if (isSiteEngineer || isQC || isAdmin || isOwner) {
    Object.values(latestUpdatesMap).forEach((upd: any) => {
      const task = taskTemplates.find(t => t.id === upd.task_template_id); const plot = plots.find(p => p.id === upd.plot_id); if (!task || !plot) return;
      const isPendingSE = isSiteEngineer && upd.progress === 100 && (upd.action === 'ส่งงาน 100%' || upd.role === 'Foreman');
      const isPendingQC = isQC && upd.progress === 100 && upd.action === 'Site Engineer อนุมัติ';
      const isAdminView = (isAdmin || isOwner) && upd.progress === 100 && (upd.action === 'ส่งงาน 100%' || upd.action === 'Site Engineer อนุมัติ');
      if (isPendingSE || isPendingQC || isAdminView) inspectionQueue.push({ ...upd, task_name: task.task_name, plot_id: plot.id, project_name: plot.project_name, foreman: plot.foreman, time: new Date(upd.created_at).getTime(), statusFor: isPendingQC || (isAdminView && upd.action === 'Site Engineer อนุมัติ') ? 'QC' : 'Site Engineer' });
    });
    inspectionQueue.sort((a, b) => { if (inspectionSort === 'plot') return a.plot_id.localeCompare(b.plot_id); return b.time - a.time; });
    // 🌟 ระบบคัดกรองงานด่วน (ดองไว้นานกว่า 48 ชั่วโมง) และจัดแท็บ
    inspectionQueue.forEach(q => { q.isUrgent = (Date.now() - q.time) > 172800000; }); 
    const urgentQueueCount = inspectionQueue.filter(q => q.isUrgent).length;
    const displayInspectionQueue = inspectionQueue.filter(q => inspectionFilterTab === 'all' || (inspectionFilterTab === 'urgent' && q.isUrgent));
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

      const minD = new Date(globalMinDate); minD.setHours(0,0,0,0);
      const maxD = new Date(globalMaxDate); maxD.setHours(0,0,0,0);
      
      const chartStart = minD.getTime() - (2 * 86400000);
      const chartEnd = maxD.getTime() + (3 * 86400000); 
      
      // 🎯 แก้ปัญหาเส้นทะลุ: คำนวณจำนวนวันทั้งหมดแบบเป๊ะๆ (+1 เพื่อให้วันสุดท้ายเต็มช่อง)
      const totalChartDays = Math.round((chartEnd - chartStart) / 86400000) + 1;
      const totalChartMs = totalChartDays * 86400000; 

      const getChartLeft = (timestamp) => {
          const d = new Date(timestamp); d.setHours(0,0,0,0);
          return Math.max(0, ((d.getTime() - chartStart) / totalChartMs) * 100);
      };

      const getChartWidth = (startTs, endTs) => {
          const dStart = new Date(startTs); dStart.setHours(0,0,0,0);
          const dEnd = new Date(endTs); dEnd.setHours(0,0,0,0);
          return Math.max(0, (((dEnd.getTime() + 86400000) - dStart.getTime()) / totalChartMs) * 100);
      };

      const timeMarkers = [];
      if (hasAnySchedule) {
         let current = new Date(chartStart);
         let lastMonthStr = "";

         // 🎯 บังคับกางวันที่ต่อเนื่อง 1, 2, 3, 4, ... เสมอ ไม่ว่าจะกี่วันก็ตาม
         while (current.getTime() <= chartEnd) {
            const currentMonthStr = current.toLocaleDateString('th-TH', { month: 'short', year: '2-digit' });
            let monthLabel = null;

            if (currentMonthStr !== lastMonthStr) {
               monthLabel = currentMonthStr;
               lastMonthStr = currentMonthStr;
            }

            timeMarkers.push({ 
               dayLabel: current.getDate(),        
               monthLabel: monthLabel,             
               isMonth: current.getDate() === 1,   
               left: getChartLeft(current.getTime()) 
            });
            // 🎯 บังคับบวกทีละ 1 วันเสมอ (เลิกใช้เงื่อนไข showDays ย่อสัปดาห์)
            current.setDate(current.getDate() + 1); 
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
        {/* 🌟 Modal สำหรับ Daily Activity Report 🌟 */}
        {activityReportOpen && (() => {
            const targetDate = activityReportDate;
            const activities = [];

            // 1. ดึงข้อมูลอัปเดตงาน (ดึงทุกคนยกเว้น Admin)
            allUpdatesRecord.filter(u => new Date(u.created_at).toLocaleDateString('en-CA') === targetDate && u.role !== 'Admin').forEach(u => {
                const task = taskTemplates.find(t => t.id === u.task_template_id);
                activities.push({ time: new Date(u.created_at).getTime(), timeStr: new Date(u.created_at).toLocaleTimeString('th-TH', {hour:'2-digit', minute:'2-digit'}), user: u.user_name, role: u.role, plot: u.plot_id, taskName: task ? task.task_name : 'อัปเดตงาน', action: u.action, detail: u.text_content || '-', type: 'update' });
            });

            // 2. ดึงข้อมูลแจ้งซ่อม
            defects.filter(d => new Date(d.created_at).toLocaleDateString('en-CA') === targetDate).forEach(d => {
                const user = allUsers.find(u => u.username === d.reported_by);
                if (user?.role === 'Admin') return;
                const task = taskTemplates.find(t => t.id === d.task_id);
                activities.push({ time: new Date(d.created_at).getTime(), timeStr: new Date(d.created_at).toLocaleTimeString('th-TH', {hour:'2-digit', minute:'2-digit'}), user: d.reported_by, role: user ? user.role : 'Unknown', plot: d.plot_id, taskName: task ? task.task_name : 'ไม่ระบุงาน', action: 'แจ้ง Defect / ซ่อม', detail: d.description || 'แนบรูปภาพ', type: 'defect' });
            });

            // เรียงตามเวลาล่าสุดขึ้นก่อน
            activities.sort((a, b) => b.time - a.time);

            return (
              <div className="absolute inset-0 z-[800] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 fixed">
                 <div className="bg-white rounded-[2rem] shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
                    <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                       <div>
                         <h3 className="text-xl font-black text-slate-800 italic uppercase flex items-center gap-2"><ClipboardList className="text-indigo-600"/> Daily Activity Report</h3>
                         <p className="text-sm text-slate-500 font-bold mt-1">รายงานสรุปการทำงานรายวัน (Print as PDF)</p>
                       </div>
                       <button onClick={() => setActivityReportOpen(false)} className="p-2 hover:bg-slate-200 rounded-full transition-colors text-slate-400"><X size={24}/></button>
                    </div>

                    <div className="p-4 bg-white border-b border-slate-100 flex items-center gap-4 shrink-0">
                       <label className="font-black text-sm text-slate-600 uppercase tracking-widest">เลือกวันที่:</label>
                       <input type="date" value={activityReportDate} onChange={(e) => setActivityReportDate(e.target.value)} className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 font-bold text-slate-700 outline-none focus:border-indigo-500" />
                    </div>

                       <div className="flex-1 overflow-y-auto p-6 bg-slate-50 custom-scrollbar">
                        {activities.length === 0 ? (
                           <div className="text-center py-20 text-slate-400 font-bold text-lg">ไม่มีประวัติการทำงานในระบบสำหรับวันนี้</div>
                        ) : (
                           <div className="space-y-6">
                               {/* 🌟 นำข้อมูลมาจัดกลุ่มตามชื่อผู้ใช้ (Group by User) 🌟 */}
                               {Object.entries(activities.reduce((acc: any, curr: any) => {
                                   if (!acc[curr.user]) acc[curr.user] = { role: curr.role, items: [] };
                                   acc[curr.user].items.push(curr);
                                   return acc;
                               }, {})).map(([user, data]: [string, any], idx) => (
                                   <div key={idx} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                                       {/* หัวข้อชื่อคน */}
                                       <div className="bg-slate-800 px-5 py-3 flex justify-between items-center">
                                           <h4 className="font-black text-white text-lg flex items-center gap-2">👤 {user}</h4>
                                           <span className="text-[10px] font-black bg-white/20 text-white px-2.5 py-1 rounded-lg uppercase tracking-wider">{data.role}</span>
                                       </div>
                                       {/* รายการที่คนๆ นั้นทำ */}
                                       <div className="divide-y divide-slate-100">
                                           {data.items.map((act: any, i: number) => (
                                               <div key={i} className="p-4 flex items-start gap-4 hover:bg-slate-50 transition-colors">
                                                   <div className="w-16 shrink-0 text-center">
                                                       <span className="text-slate-500 font-black text-xs">{act.timeStr}</span>
                                                   </div>
                                                   <div className="flex-1 min-w-0">
                                                       <div className="flex items-center gap-2 mb-1">
                                                           <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-md ${act.type === 'defect' ? 'bg-rose-100 text-rose-600' : 'bg-blue-100 text-blue-600'}`}>{act.action}</span>
                                                           <span className="font-black text-slate-800">แปลง: {act.plot}</span>
                                                       </div>
                                                       <h4 className="font-bold text-slate-700 text-sm truncate">{act.taskName}</h4>
                                                       <p className="text-xs text-slate-500 mt-1 italic">"{act.detail}"</p>
                                                   </div>
                                               </div>
                                           ))}
                                       </div>
                                   </div>
                               ))}
                           </div>
                        )}
                    </div>

                    <div className="p-6 border-t border-slate-100 bg-white flex justify-end gap-3 shrink-0">
                       <button onClick={() => setActivityReportOpen(false)} className="px-6 py-3 bg-slate-100 text-slate-600 font-bold rounded-xl hover:bg-slate-200">ปิด</button>
                       <button onClick={() => window.print()} disabled={activities.length === 0} className="px-8 py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 flex items-center gap-2 shadow-lg disabled:opacity-50">
                          <Printer size={18}/> พิมพ์รายงาน (A4)
                       </button>
                    </div>
                 </div>
              </div>
            );
        })()}
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

        {/* 🌟 หน้าต่างซูมรูปภาพ (ตั้ง z-index ให้สูงสุดระดับ 999999 เพื่อไม่ให้โดน Pop-up อื่นบัง) */}
        {fullImageUrl && (
          <div className="fixed inset-0 z-[999999] bg-black/90 backdrop-blur-sm flex items-center justify-center p-4 cursor-zoom-out" onClick={() => setFullImageUrl(null)}>
             <button className="absolute top-6 right-6 text-white hover:text-rose-500 transition-colors bg-white/10 p-3 rounded-full backdrop-blur-md" onClick={() => setFullImageUrl(null)}><X size={28} /></button>
             <img src={fullImageUrl} className="max-w-full max-h-[90vh] object-contain rounded-2xl shadow-2xl" onClick={(e) => e.stopPropagation()} alt="Full size" />
          </div>
        )}

        {dialogConfig.isOpen && (
          <div className="absolute inset-0 z-[600] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 fixed"><div className="bg-white rounded-[2rem] shadow-2xl max-w-sm w-full p-6 text-center space-y-4"><div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-2 ${dialogConfig.type === 'confirm' ? 'bg-rose-100 text-rose-600' : 'bg-blue-100 text-blue-600'}`}><AlertTriangle size={32} /></div><h3 className="text-xl font-black">{dialogConfig.title}</h3><p className="text-slate-500 font-medium">{dialogConfig.message}</p><div className="flex gap-3 w-full mt-4">{dialogConfig.type === 'confirm' ? (<><button onClick={closeDialog} className="flex-1 bg-slate-100 text-slate-600 font-bold py-3.5 rounded-xl hover:bg-slate-200">ยกเลิก</button><button onClick={dialogConfig.onConfirm} className="flex-1 bg-rose-600 text-white font-bold py-3.5 rounded-xl hover:bg-rose-700">ยืนยัน</button></>) : (<button onClick={closeDialog} className="w-full bg-slate-800 text-white font-bold py-3.5 rounded-xl">รับทราบ</button>)}</div></div></div>
        )}

        {/* 🧭 Left Sidebar (Desktop Only) - ฉบับพับเก็บได้ */}
        {!isMobileLayout && (
          <aside className={`bg-slate-900 text-slate-300 flex-col justify-between hidden md:flex shrink-0 shadow-2xl z-50 transition-all duration-300 relative ${isSidebarCollapsed ? 'w-[88px] sidebar-collapsed' : 'w-72'}`}>
             
             {/* 🌟 ปุ่มพับ/กางเมนู (ลูกศร) วางทับเส้นขอบขวา 🌟 */}
             <button 
                onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
                className="absolute -right-3.5 top-10 bg-slate-800 text-slate-300 hover:text-white rounded-full p-1.5 hover:bg-rose-600 z-[110] shadow-md border border-slate-700 transition-all"
                title={isSidebarCollapsed ? 'กางเมนู' : 'พับเมนู'}
             >
                <ChevronRight size={14} className={`transition-transform duration-300 ${isSidebarCollapsed ? '' : 'rotate-180'}`} />
             </button>

             {/* 🌟 CSS Trick: ซ่อนข้อความเมนูอัตโนมัติเมื่อพับ 🌟 */}
             <style>{`
               .sidebar-collapsed p { display: none !important; }
               .sidebar-collapsed button { justify-content: center !important; padding-left: 0 !important; padding-right: 0 !important; font-size: 0 !important; }
               .sidebar-collapsed button svg { margin-right: 0 !important; margin-left: 0 !important; }
             `}</style>

             <div className={`p-8 pb-4 ${isSidebarCollapsed ? 'px-4' : ''}`}>
                 <div className={`flex items-center mb-10 text-white cursor-pointer hover:scale-105 transition-transform ${isSidebarCollapsed ? 'justify-center gap-0' : 'gap-3'}`} onClick={() => setView('dashboard')}>
                   <div className="bg-blue-600 p-2 rounded-xl shadow-lg shadow-blue-500/50 shrink-0"><LayoutDashboard size={28} /></div>
                   {!isSidebarCollapsed && <h1 className="font-black text-2xl tracking-tighter uppercase italic">BuildTrack</h1>}
                </div>

                <div className="space-y-6">
                   <div>
                     <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-3 px-2">Main Menu</p>
                     <nav className="space-y-1">
                        <button onClick={() => setView('dashboard')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold transition-all ${view === 'dashboard' ? 'bg-blue-600 text-white shadow-md' : 'hover:bg-slate-800 hover:text-white'}`}><Home size={18}/> Dashboard</button>
              Reports          
                        {(isAdmin || isProjectPlanner || isQC || isSiteEngineer || isOwner || isForeman) && (
                           <button onClick={() => setView('reports')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold transition-all ${view === 'reports' ? 'bg-blue-600 text-white shadow-md' : 'hover:bg-slate-800 hover:text-white'}`}><PieChart size={18}/>  & Analytics</button>
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
                              {/* ✅ ปุ่มเมนูจัดการแบบบ้าน (Desktop) */}
                              <button onClick={() => setView('admin-house-types')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold transition-all ${view === 'admin-house-types' ? 'bg-rose-600 text-white shadow-md' : 'hover:bg-slate-800 hover:text-white'}`}><Building size={18}/> จัดการแบบบ้าน</button>
                              {/* ✅ ปุ่มเมนูจัดการงวดงาน (Desktop) */}
                              <button onClick={() => setView('admin-tasks')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold transition-all ${view === 'admin-tasks' ? 'bg-rose-600 text-white shadow-md' : 'hover:bg-slate-800 hover:text-white'}`}><ClipboardList size={18}/> จัดการงวดงาน (Tasks)</button>
                              {/* ✅ ปุ่มเมนูตั้งค่า 2.5D สำหรับ Admin (Desktop) */}
                              <button onClick={() => setView('admin-visualizer')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold transition-all ${view === 'admin-visualizer' ? 'bg-rose-600 text-white shadow-md' : 'hover:bg-slate-800 hover:text-white'}`}><Monitor size={18}/> ตั้งค่า 2.5D แบบบ้าน</button>
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
                {/* 🌟 วิดเจ็ตสภาพอากาศปัจจุบัน (เอามาวางแทรกตรงนี้เลยครับ!) 🌟 */}
                      {currentWeather && (
                          <div className="hidden sm:flex items-center gap-2 bg-sky-50 text-sky-700 px-3 py-1.5 rounded-xl border border-sky-200 shadow-sm ml-2 animate-in fade-in zoom-in duration-500">
                            <span className="text-2xl drop-shadow-sm">{currentWeather.icon}</span>
                            <div className="flex flex-col justify-center">
                                <span className="text-[10px] font-black leading-none text-sky-600">{currentWeather.text}</span>
                                <span className="text-sm font-black leading-tight mt-0.5">{currentWeather.temp}°C</span>
                            </div>
                          </div>
                      )}
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

                    {(isSiteEngineer || isQC || isAdmin || isOwner) && (
                      <div className="mb-6 sm:mb-12">
                      {/* 🌟 ส่วนหัว: โซนแท็บเมนูและปุ่มเปลี่ยนมุมมอง */}
                        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3 mb-4 sm:mb-6">
                          <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6">
                             <h2 className="font-black text-lg sm:text-2xl text-slate-800 italic uppercase tracking-tighter flex items-center gap-2"><ClipboardList className={isQC ? 'text-purple-600' : 'text-blue-600'} size={20}/> Inspection Queue <span className="bg-slate-800 text-white text-[10px] px-2 py-0.5 rounded-full">{inspectionQueue.length}</span></h2>
                             
                             {/* 🌟 1. TABS คัดงานด่วน */}
                             <div className="flex bg-slate-200/60 p-1 rounded-xl w-fit border border-slate-200/80">
                                <button onClick={() => setInspectionFilterTab('all')} className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all ${inspectionFilterTab === 'all' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}>ทั้งหมด</button>
                                <button onClick={() => setInspectionFilterTab('urgent')} className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 ${inspectionFilterTab === 'urgent' ? 'bg-rose-500 shadow-sm text-white' : 'text-slate-500 hover:text-rose-600'}`}><AlertTriangle size={14}/> ด่วน <span className={`${inspectionFilterTab === 'urgent' ? 'bg-white/20 text-white' : 'bg-rose-100 text-rose-600'} px-1.5 py-0.5 rounded-md text-[10px] leading-none`}>{inspectionQueue.filter(q => (Date.now() - q.time) > 172800000).length}</span></button>
                             </div>
                          </div>
                          
                          <div className="flex items-center gap-2 w-full xl:w-auto">
                             {/* 🌟 2. View Mode Toggle (ปุ่มเปลี่ยนสลับ Card / List) */}
                             <div className="flex bg-slate-200/60 p-1 rounded-xl shrink-0 border border-slate-200/80">
                                <button onClick={() => setInspectionViewMode('card')} className={`p-1.5 sm:p-2 rounded-lg transition-all ${inspectionViewMode === 'card' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-400 hover:text-blue-500'}`} title="มุมมองการ์ด"><Grid size={16}/></button>
                                <button onClick={() => setInspectionViewMode('list')} className={`p-1.5 sm:p-2 rounded-lg transition-all ${inspectionViewMode === 'list' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-400 hover:text-blue-500'}`} title="มุมมองตาราง"><ClipboardList size={16}/></button>
                             </div>
                             
                             {/* เรียงลำดับ (ของเดิม) */}
                             <div className="flex bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden text-[10px] sm:text-xs font-bold flex-1 xl:flex-none"><button onClick={() => setInspectionSort('time')} className={`flex-1 xl:flex-none px-3 sm:px-4 py-2 flex justify-center items-center gap-1.5 ${inspectionSort === 'time' ? 'bg-slate-100 text-slate-800' : 'text-slate-400'}`}><Clock size={14}/> ล่าสุด</button><button onClick={() => setInspectionSort('plot')} className={`flex-1 xl:flex-none px-3 sm:px-4 py-2 flex justify-center items-center gap-1.5 border-l border-slate-200 ${inspectionSort === 'plot' ? 'bg-slate-100 text-slate-800' : 'text-slate-400'}`}><SortAsc size={14}/> รหัสแปลง</button></div>
                          </div>
                        </div>

                        {/* 🌟 พื้นที่แสดงผลคิวงาน */}
                        {inspectionQueue.filter(q => inspectionFilterTab === 'all' || (inspectionFilterTab === 'urgent' && (Date.now() - q.time) > 172800000)).length === 0 ? ( 
                          <div className="bg-white rounded-2xl sm:rounded-[2rem] border border-dashed border-slate-300 p-8 sm:p-16 text-center flex flex-col items-center justify-center gap-3 sm:gap-4">
                             <div className="w-16 h-16 sm:w-20 sm:h-20 bg-slate-50 rounded-full flex items-center justify-center"><CheckCircle size={32} className="text-emerald-400 opacity-50"/></div>
                             <p className="text-slate-400 font-bold italic text-sm sm:text-xl">ไม่มีงานรอตรวจสอบในหมวดหมู่นี้</p>
                          </div> 
                        ) : (
                          <div className="max-h-[50vh] sm:max-h-[600px] overflow-y-auto custom-scrollbar pr-1 sm:pr-3 pb-2">
                            <div className={`${inspectionViewMode === 'card' ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4' : 'flex flex-col gap-2'}`}>
                              {inspectionQueue.filter(q => inspectionFilterTab === 'all' || (inspectionFilterTab === 'urgent' && (Date.now() - q.time) > 172800000)).map(q => {
                                const isUrgent = (Date.now() - q.time) > 172800000;
                                const relatedProject = projects.find(p => p.name === q.project_name); const relatedPlot = plots.find(p => p.id === q.plot_id); const relatedTask = taskTemplates.find(t => t.id === q.task_template_id);
                                
                                const clickAction = () => { setSelectedProject(relatedProject); setSelectedPlot(relatedPlot); setSelectedTask(relatedTask); setView('task-progress'); supabase.from('task_updates').select('*').eq('task_template_id', q.task_template_id).eq('plot_id', q.plot_id).order('created_at', { ascending: true }).then(({data}) => { setUpdates(data || []); setProgressValue(data?.length ? data[data.length-1].progress : 0); }); };

                                {/* 🌟 Layout แบบ List View (ตารางแนวนอน) */}
                                if (inspectionViewMode === 'list') {
                                   return (
                                     <button key={`${q.plot_id}-${q.task_template_id}`} onClick={clickAction} className={`bg-white p-3 sm:p-4 rounded-xl sm:rounded-2xl border ${isUrgent ? 'border-rose-400 bg-rose-50/50' : 'border-slate-200'} shadow-sm hover:border-blue-500 hover:shadow-md transition-all text-left flex flex-col sm:flex-row sm:items-center justify-between gap-3 group`}>
                                        <div className="flex items-center gap-3 sm:gap-4 flex-1 overflow-hidden">
                                           <div className={`w-12 h-12 sm:w-14 sm:h-14 rounded-xl flex flex-col items-center justify-center shrink-0 shadow-inner ${q.statusFor === 'QC' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                                              <span className="text-[10px] sm:text-xs font-black uppercase">รอ {q.statusFor}</span>
                                           </div>
                                           <div className="flex-1 min-w-0">
                                              <div className="flex items-center gap-2 mb-1">
                                                 <h4 className="font-black text-slate-800 text-lg sm:text-xl truncate">{q.plot_id}</h4>
                                                 {isUrgent && <span className="bg-rose-500 text-white text-[9px] sm:text-[10px] font-black px-1.5 py-0.5 rounded flex items-center gap-1 animate-pulse shadow-sm"><AlertTriangle size={10}/> ค้างตรวจนาน</span>}
                                              </div>
                                              <p className="text-xs sm:text-sm font-bold text-slate-600 truncate">{q.task_name}</p>
                                           </div>
                                        </div>
                                        <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center gap-2 shrink-0 border-t sm:border-t-0 sm:border-l border-slate-100 pt-2 sm:pt-0 sm:pl-4">
                                           <p className="text-[10px] sm:text-xs text-slate-400 font-bold flex items-center gap-1"><HardHat size={12}/> {q.foreman}</p>
                                           <span className={`text-[10px] sm:text-xs font-black ${isUrgent ? 'text-rose-600' : 'text-slate-400'}`}><Clock size={12} className="inline mr-1"/> {new Date(q.time).toLocaleDateString('th-TH', {month:'short', day:'numeric'})} {new Date(q.time).toLocaleTimeString('th-TH', {hour: '2-digit', minute:'2-digit'})}</span>
                                        </div>
                                     </button>
                                   )
                                }

                                {/* 🌟 Layout แบบ Card View (การ์ดสี่เหลี่ยมของเดิม แต่อัปเกรด) */}
                                return (
                                  <button key={`${q.plot_id}-${q.task_template_id}`} onClick={clickAction} className={`bg-white p-4 sm:p-5 rounded-2xl sm:rounded-[1.5rem] border ${isUrgent ? 'border-rose-400 bg-rose-50/50' : 'border-slate-200'} shadow-sm hover:border-blue-500 hover:shadow-lg hover:-translate-y-1 transition-all text-left group relative overflow-hidden`}>
                                     {isUrgent && <div className="absolute top-0 left-0 w-full h-1.5 bg-rose-500"></div>}
                                     <div className="flex justify-between items-start mb-3 mt-1 sm:mt-0">
                                        <span className={`text-[9px] sm:text-xs font-black uppercase tracking-widest px-2.5 py-1 rounded-md text-white shadow-sm ${q.statusFor === 'QC' ? 'bg-purple-600' : 'bg-blue-600'}`}>รอ {q.statusFor}</span>
                                        <span className={`text-[9px] sm:text-[10px] font-black flex items-center gap-1 px-2 py-1 rounded-md ${isUrgent ? 'bg-rose-100 text-rose-600 animate-pulse' : 'bg-slate-100 text-slate-500'}`}><Clock size={10}/> {new Date(q.time).toLocaleDateString('th-TH',{day:'numeric', month:'short'})} {new Date(q.time).toLocaleTimeString('th-TH', {hour: '2-digit', minute:'2-digit'})}</span>
                                     </div>
                                     <div className="flex items-center gap-2 mb-1.5">
                                        <h4 className="font-black text-slate-800 text-2xl">{q.plot_id}</h4>
                                        {isUrgent && <AlertTriangle size={16} className="text-rose-500 animate-pulse"/>}
                                     </div>
                                     <p className="text-xs sm:text-sm font-bold text-slate-600 line-clamp-2 my-1.5 min-h-[32px] sm:min-h-[40px]">{q.task_name}</p>
                                     <p className="text-[10px] sm:text-xs text-slate-400 flex items-center gap-1.5 mt-3 pt-3 border-t border-slate-200/60"><HardHat size={14} className="text-slate-300"/> {q.foreman}</p>
                                  </button>
                                );
                              })}
                            </div>
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
                             <>
                               <button onClick={() => setView('admin-users')} className="flex-1 items-center justify-center gap-1.5 bg-white text-rose-600 border border-rose-200 px-2 py-2.5 rounded-lg font-bold text-[10px] shadow-sm flex whitespace-nowrap"><Users size={14} /> ผู้ใช้</button>
                               <button onClick={() => setView('admin-project')} className="flex-1 items-center justify-center gap-1.5 bg-slate-800 text-white px-2 py-2.5 rounded-lg font-bold text-[10px] shadow-sm flex whitespace-nowrap"><PlusCircle size={14} /> โครงการ</button>
                               <button onClick={() => setView('admin-house-types')} className="flex-1 items-center justify-center gap-1.5 bg-rose-50 text-rose-600 border border-rose-200 px-2 py-2.5 rounded-lg font-bold text-[10px] shadow-sm flex whitespace-nowrap"><Building size={14} /> แบบบ้าน</button>
                               <button onClick={() => setView('admin-tasks')} className="flex-1 items-center justify-center gap-1.5 bg-rose-50 text-rose-600 border border-rose-200 px-2 py-2.5 rounded-lg font-bold text-[10px] shadow-sm flex whitespace-nowrap"><ClipboardList size={14} /> งวดงาน</button>
                                                              <button onClick={() => setView('admin-visualizer')} className="flex-1 items-center justify-center gap-1.5 bg-rose-50 text-rose-600 border border-rose-200 px-2 py-2.5 rounded-lg font-bold text-[10px] shadow-sm flex whitespace-nowrap"><Monitor size={14} /> 2.5D</button>
                             </>
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
                           <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                           <button onClick={() => setActivityReportOpen(true)} className="bg-indigo-600 text-white font-black px-4 sm:px-6 py-2.5 sm:py-3.5 rounded-lg sm:rounded-xl hover:bg-indigo-700 transition-colors shadow-lg flex items-center justify-center gap-2 text-xs sm:text-base w-full sm:w-auto">
                              <Printer size={16} className="sm:w-5 sm:h-5"/> Daily Activity (PDF)
                           </button>
                           <button onClick={handleExportCSV} className="bg-emerald-600 text-white font-black px-4 sm:px-6 py-2.5 sm:py-3.5 rounded-lg sm:rounded-xl hover:bg-emerald-700 transition-colors shadow-lg flex items-center justify-center gap-2 text-xs sm:text-base w-full sm:w-auto">
                              <Download size={16} className="sm:w-5 sm:h-5"/> สรุปโครงการ (CSV)
                           </button>
                       </div>
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
                    {/* 🌟 ตารางสรุปสถานะการแจ้งซ่อม (Defect Tracking Summary - ฉบับปรับปรุงตามสั่ง) 🌟 */}
                    <div className="bg-white rounded-2xl sm:rounded-[2rem] border border-slate-200 shadow-md overflow-hidden mb-6">
                       <div className="p-5 sm:p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                          <h3 className="font-black text-xl sm:text-2xl text-slate-800 flex items-center gap-2.5"><ShieldAlert className="text-rose-500" size={24}/> Defect Tracking Summary</h3>
                          <span className="bg-rose-100 text-rose-600 text-xs sm:text-sm font-black px-3.5 py-2 rounded-xl shadow-sm">
                             {isForeman 
                               ? `รอดำเนินการของคุณ: ${defects.filter(d => { const p = plots.find(plot => plot.id === d.plot_id); return d.status === 'pending' && p?.foreman === (loggedInUser?.username || currentUserRole); }).length} รายการ`
                               : `รอดำเนินการทั้งหมด: ${defects.filter(d => d.status === 'pending').length} รายการ`
                             }
                          </span>
                       </div>
                       
                       <div className="overflow-x-auto custom-scrollbar">
                          <table className="w-full text-left border-collapse min-w-[1100px]">
                            <thead className="bg-slate-100 border-b border-slate-200">
                              <tr>
                               <th className="p-4 pl-6 sm:pl-8 text-xs font-black uppercase text-slate-600 tracking-wider w-28">วันที่แจ้ง</th>
                               <th className="p-4 text-xs font-black uppercase text-slate-600 tracking-wider w-24">แปลง</th>
                               <th className="p-4 text-xs font-black uppercase text-slate-600 tracking-wider min-w-[250px]">งวดงาน (Task)</th>
                               <th className="p-4 text-xs font-black uppercase text-slate-600 tracking-wider w-40">ผู้แจ้ง (Reporter)</th>
                               <th className="p-4 text-xs font-black uppercase text-slate-600 tracking-wider">รายละเอียด Defect</th>
                               <th className="p-4 text-xs font-black uppercase text-slate-600 tracking-wider w-40">โฟร์แมน</th>
                               <th className="p-4 pr-6 sm:pr-8 text-xs font-black uppercase text-slate-600 tracking-wider text-center w-32">สถานะ</th>
                             </tr>
                           </thead>
                           <tbody className="divide-y divide-slate-100">
                             {(() => {
                                // 🧠 ลอจิกกรองข้อมูล: ถ้าเป็น Foreman ให้เห็นเฉพาะแปลงที่ตัวเองรับผิดชอบ แต่ถ้าตำแหน่งอื่นให้เห็นครบหมด
                                const filteredDefects = defects.filter(defect => {
                                   if (isForeman) {
                                      const plotInfo = plots.find(p => p.id === defect.plot_id);
                                      return plotInfo?.foreman === (loggedInUser?.username || currentUserRole);
                                   }
                                   return true; // ตำแหน่งอื่นๆ เห็นทั้งหมด
                                });

                                if (filteredDefects.length === 0) {
                                   return <tr><td colSpan="7" className="text-center p-12 text-slate-400 font-bold text-sm sm:text-base">ไม่มีรายการแจ้งซ่อมในระบบระบบย่อยนี้ 🎉</td></tr>;
                                }

                                return filteredDefects
                                   .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
                                   .map((defect, idx) => {
                                      const pInfo = plots.find(p => p.id === defect.plot_id);
                                      const foremanName = pInfo ? pInfo.foreman : 'ไม่ระบุ';
                                      
                                      // ดึงชื่องวดงานที่ผูกอยู่กับ defect รายการนี้
                                      const taskInfo = taskTemplates.find(t => t.id === defect.task_id);
                                      const taskName = taskInfo ? taskInfo.task_name : 'งานทั่วไป / ไม่ระบุ';

                                      return (
                                         <tr key={idx} className="hover:bg-slate-50/80 transition-colors">
                                            {/* วันที่แจ้ง (ปรับขนาดตัวหนังสือให้อ่านง่ายสบายตาเป็น text-sm) */}
                                            <td className="p-4 pl-6 sm:pl-8 font-bold text-slate-500 text-xs sm:text-sm">{new Date(defect.created_at).toLocaleDateString('th-TH')}</td>
                                            
                                            {/* เลขแปลง */}
                                            <td className="p-4 font-black text-slate-800 text-sm sm:text-base">{defect.plot_id}</td>
                                            
                                            {/* 🌟 คอลัมน์ที่เพิ่มใหม่: งวดงาน (Task) */}
                                            <td className="p-4 font-bold text-slate-700 text-xs sm:text-sm">
                                               {/* เอา truncate และ max-w-[180px] ออก และเพิ่มการปัดบรรทัดอัตโนมัติ (break-words) */}
                                               <span className="bg-slate-100 text-slate-700 px-3 py-1.5 rounded-md border border-slate-200 inline-block w-full break-words leading-relaxed" title={taskName}>
                                                  {taskName}
                                               </span>
                                            </td>
                                            
                                            {/* ผู้แจ้ง */}
                                            <td className="p-4 font-bold text-slate-600 text-xs sm:text-sm">
                                               <span className="bg-blue-50 text-blue-700 border border-blue-100 px-2 py-1 rounded-md">{defect.reported_by}</span>
                                            </td>
                                            
                                            {/* รายละเอียด Defect */}
                                            <td className="p-4 text-xs sm:text-sm text-slate-600 font-medium truncate max-w-[250px]" title={defect.description}>
                                               {defect.description || 'ดูรูปภาพหลักในระบบ'}
                                            </td>
                                            
                                            {/* โฟร์แมนผู้ดูแล */}
                                            <td className="p-4 font-bold text-slate-700 text-xs sm:text-sm flex items-center gap-1.5 mt-1">
                                               <HardHat size={16} className="text-amber-500 shrink-0"/> {foremanName}
                                            </td>
                                            
                                            {/* สถานะ (ล็อกให้อยู่แถวเดียว ไม่แตกบรรทัดด้วย whitespace-nowrap และพรีเมียมขึ้น) */}
                                            <td className="p-4 pr-6 sm:pr-8 text-center">
                                               <span className={`font-black px-3.5 py-1.5 rounded-xl text-xs sm:text-sm shadow-sm inline-block whitespace-nowrap border ${
                                                  defect.status === 'pending' 
                                                     ? 'bg-rose-50 border-rose-200 text-rose-600' 
                                                     : 'bg-emerald-50 border-emerald-200 text-emerald-600'
                                               }`}>
                                                  {defect.status === 'pending' ? '🔴 รอแก้ไข' : '🟢 แก้แล้ว'}
                                               </span>
                                            </td>
                                         </tr>
                                      );
                                   });
                             })()}
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
                          {/* 🌟 ปุ่มเปิด Presentation Mode */}
                          {['Project Planner', 'Admin', 'Owner'].includes(currentUserRole) && (
                              <button onClick={() => { setIsPresentationOpen(true); setCurrentSlideIndex(0); }} className="bg-indigo-600 hover:bg-indigo-700 text-white px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl font-black text-xs sm:text-sm shadow-md transition-all flex items-center gap-1.5 shrink-0">
                                <Monitor size={16} /> <span className="hidden sm:inline">Presentation Mode</span><span className="inline sm:hidden">โหมดนำเสนอ</span>
                              </button>
                          )}
                          
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

                           // 🌟 หางานล่าสุดที่มีการอัปเดตของแปลงนี้
                           const plotUpdates = allUpdatesRecord?.filter(u => u.plot_id === plotInfo.id) || [];
                           const latestUpdate = plotUpdates.length > 0 ? plotUpdates[plotUpdates.length - 1] : null;
                           const latestTask = latestUpdate ? taskTemplates.find(t => t.id === latestUpdate.task_template_id) : null;
                           const latestTaskStr = latestTask ? `${latestTask.task_name} (${latestUpdate.progress}%)` : 'ยังไม่มีงานอัปเดต';

                           // ดักจับว่าแปลงนี้ใช้ช่างที่เรากำลังค้นหาอยู่หรือไม่

                           // ดักจับว่าแปลงนี้ใช้ช่างที่เรากำลังค้นหาอยู่หรือไม่
                           const currentPlotAssignment = assignments.slice().reverse().find(a => a.plot_id === plotId);
                           const hasSearchedContractor = searchContractor.trim() !== '';
                           const isMatchContractor = currentPlotAssignment?.contractor_name.toLowerCase().includes(searchContractor.toLowerCase());

                           const isActiveToday = plotsActiveToday.has(plotId);

                           // ปรับสไตล์เอฟเฟกต์ไฮไลท์ช่าง
                           let searchHighlightClass = "opacity-100 scale-100";
                           let cardBorderClass = statusInfo.colors; 

                           if (hasSearchedContractor) {
                              if (isMatchContractor) {
                                 // ถ้าใช่ช่างที่ค้นหา: ล็อกขอบสีทองหนาพิเศษ + ใส่เงาไฟนีออนกระพริบวิบวับ
                                 searchHighlightClass = "opacity-100 scale-105 z-50 animate-pulse";
                                 cardBorderClass = "bg-amber-50 border-amber-500 text-amber-900 shadow-[0_0_25px_rgba(245,158,11,0.8)] border-[4px]";
                              } else {
                                 // ถ้าไม่ใช่ช่างที่ค้นหา: ปรับจางลงมากเป็นสีขาวดำ เพื่อขับช่างคนนั้นให้เด่น
                                 searchHighlightClass = "opacity-10 scale-95 grayscale pointer-events-none";
                              }
                           }

                           return (
                             <div key={`label-${plotId}`} className={`absolute flex items-center justify-center p-1 transition-all ${isEditMapMode ? 'opacity-50 pointer-events-none' : 'hover:z-50 cursor-pointer group'} ${searchHighlightClass}`} style={{ left: `${(bounds.minX / gridCols) * 100}%`, top: `${(bounds.minY / gridRows) * 100}%`, width: `${(w / gridCols) * 100}%`, height: `${(h / gridRows) * 100}%` }} onClick={() => { if (!isEditMapMode) { setSelectedPlot(plotInfo); setView('house-detail'); } }}>
                             
                                {/* ✅ โค้ดใหม่: จัดวางไอคอน Pickaxe ไว้ที่จุดกึ่งกลางของแปลงพอดี */}
                                {isActiveToday && (
                                   <div className="absolute top-1/5 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-yellow-400 text-slate-900 rounded-full p-1 sm:p-1.5 shadow-lg animate-bounce z-[60] border-2 border-white" title="มีการทำงานในแปลงนี้วันนี้">
                                      <Pickaxe size={14} className="w-3 h-3 sm:w-4 sm:h-4"/>
                                   </div>
                                )}

                                <div className={`w-full h-full border-[2px] sm:border-[3px] rounded-md sm:rounded-lg shadow-sm backdrop-blur-sm flex flex-col items-center justify-center relative transition-all group-hover:shadow-md group-hover:scale-[1.02] ${cardBorderClass}`}>
                                   
                                   {/* แสดงชื่อแปลงเป็นหลัก */}
                                   <span className="font-black text-[10px] sm:text-sm">{plotInfo.id}</span>
                                   
                                   {/* 🌟 🌟 ถ้ามีการค้นหาช่างและเจอแปลงของช่าง: ให้แถมป้ายชื่อช่างแปะไว้ตรงกลางผังเลย! 🌟 🌟 */}
                                   {hasSearchedContractor && isMatchContractor && (
                                      <div className="absolute -bottom-2 bg-amber-500 text-slate-900 font-black px-1.5 py-0.5 rounded text-[8px] sm:text-[10px] uppercase tracking-wider shadow-md whitespace-nowrap border border-white z-40">
                                         👷‍♂️ {currentPlotAssignment.contractor_name.split(' ')[0]}
                                      </div>
                                   )}
                                   
                                   {/* Tooltip รายละเอียดเมื่อเอาเมาส์ชี้ (คงเดิมไว้ทั้งหมด) */}
                                   <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-[160px] sm:w-[180px] bg-slate-900 text-white rounded-xl sm:rounded-2xl shadow-2xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all p-3 sm:p-4 pointer-events-none z-[100] border border-slate-700">
                                      <div className="flex justify-between items-center w-full mb-1 sm:mb-2">
                                         <span className="font-black text-xs sm:text-sm">{plotInfo.id}</span>
                                         <span className={`text-[8px] sm:text-[10px] font-black px-1.5 sm:px-2 py-0.5 rounded-full ${statusInfo.status === 'delayed' ? 'bg-rose-500 text-white' : statusInfo.status === 'completed' ? 'bg-emerald-500 text-white' : statusInfo.status === 'ahead' ? 'bg-indigo-500 text-white' : statusInfo.status === 'on-track' ? 'bg-blue-500 text-white' : 'bg-slate-600 text-slate-300'}`}>{statusInfo.label}</span>
                                      </div>
                                      <p className="text-[9px] sm:text-[10px] text-slate-400 mb-1 sm:mb-2 flex items-center gap-1 sm:gap-1.5"><HardHat size={10} className="sm:w-3 sm:h-3"/> {plotInfo.foreman || 'ไม่ระบุ'}</p>
                                      
                                      {/* 🌟 กล่องแสดงงานล่าสุดใน Tooltip */}
                                      <div className="bg-slate-800/80 p-1.5 sm:p-2 rounded-lg border border-slate-700/50 mb-2 sm:mb-3">
                                         <p className="text-[8px] text-slate-500 uppercase font-bold tracking-widest mb-0.5 flex items-center gap-1"><Activity size={8}/> งานล่าสุด:</p>
                                         <p className="text-[9px] sm:text-[10px] text-amber-400 font-bold truncate">{latestTaskStr}</p>
                                      </div>
                                      
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
                        
                        // 🌟 หางานล่าสุดที่มีการอัปเดตของการ์ดแปลงนี้
                        const plotUpdates = allUpdatesRecord?.filter(u => u.plot_id === plot.id) || [];
                        const latestUpdate = plotUpdates.length > 0 ? plotUpdates[plotUpdates.length - 1] : null;
                        const latestTask = latestUpdate ? taskTemplates.find(t => t.id === latestUpdate.task_template_id) : null;
                        const latestTaskStr = latestTask ? `${latestTask.task_name} (${latestUpdate.progress}%)` : 'ยังไม่มีงานอัปเดต';

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
                            <p className={`${isMobileLayout ? 'text-[8px]' : 'text-xs'} text-slate-400 font-bold uppercase tracking-wider mb-2 sm:mb-3`}>{plot.type}</p>
                            
                            {/* 🌟 กล่องแสดงงานล่าสุดของการ์ด */}
                            <div className="bg-blue-50/50 border border-blue-100 rounded-lg p-2 sm:p-3 mb-3 sm:mb-4 flex items-center gap-2">
                               <Activity size={isMobileLayout ? 12 : 16} className="text-blue-500 shrink-0"/>
                               <div className="min-w-0 flex-1">
                                  <p className="text-[8px] sm:text-[10px] text-slate-400 font-bold uppercase">อัปเดตล่าสุด</p>
                                  <p className="text-[10px] sm:text-xs font-black text-blue-700 truncate">{latestTaskStr}</p>
                               </div>
                            </div>
                            
                            {/* 🌟 ส่วนแถบ Progress: แบ่งเป็น Plan และ Actual 🌟 */}
                            
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
                   
               {/* 💬 LEVEL 4: Task Progress (ฉบับปรับปรุงฟอนต์ขนาดเท่าชื่องาน) */}
                <div className="bg-slate-800 rounded-xl border-b-4 border-b-rose-600 shadow-lg p-3 text-white">
                  
                  {/* ส่วน Header รวม: ชื่อแปลง + ข้อมูล (บรรทัดเดียว) */}
                  <div className="flex flex-wrap justify-between items-center gap-3">
                    
                    {/* ส่วนซ้าย: ชื่อแปลง (ปรับให้ฟอนต์ชื่อแปลงเด่นกว่าข้อมูลเล็กน้อยตามหลัก Hierarchy) */}
                    <div className="flex-shrink-0">
                        <h2 className="text-xl font-black italic tracking-tighter">{selectedPlot.id}</h2>
                        <p className="text-slate-400 font-bold uppercase text-[9px] italic">{selectedPlot.foreman || 'ไม่ระบุ'}</p>
                    </div>

                    {/* ส่วนกลาง: ข้อมูล 4 ตัว (ปรับฟอนต์ให้เท่าขนาดชื่องานคือ text-xs) */}
                    <div className="flex items-center gap-5 border-l border-slate-600 pl-5">
                        <div className="text-xs">
                          <span className="text-slate-400 font-bold uppercase block text-[9px]">เวลา</span>
                          <span className="font-bold">{plotPlanStart !== Infinity ? `${new Date(plotPlanStart).toLocaleDateString('th-TH', {day:'numeric',month:'short'})}-${new Date(plotPlanEnd).toLocaleDateString('th-TH', {day:'numeric',month:'short'})}` : '-'}</span>
                          <span className="text-rose-400 block font-black text-[9px]">รวม {plotPlanStart !== Infinity ? Math.max(0, Math.ceil((plotPlanEnd - plotPlanStart) / (1000 * 60 * 60 * 24)) + 1) : 0} วัน</span>
                        </div>
                        <div className="text-xs">
                          <span className="text-slate-400 font-bold uppercase block text-[9px]">ผ่าน</span>
                          <span className="text-blue-300 font-black">{plotPlanStart !== Infinity ? Math.min(daysElapsed, totalPlannedDays) : '-'} <span className="font-bold text-[10px]">วัน</span></span>
                        </div>
                        <div className="text-xs">
                          <span className="text-slate-400 font-bold uppercase block text-[9px]">เหลือ</span>
                          <span className="text-emerald-300 font-black">{plotPlanEnd !== -Infinity ? Math.max(0, daysRemaining) : '-'} <span className="font-bold text-[10px]">วัน</span></span>
                        </div>
                        <div className="text-xs">
                          <span className="text-slate-400 font-bold uppercase block text-[9px]">สถานะ</span>
                          {plotPlanStart === Infinity ? <span className="text-slate-400">รอแผน</span> :
                            isSummaryDelayed ? <span className="text-rose-500 font-black">ล่าช้า</span> : 
                            selectedPlot?.progress === 100 ? <span className="text-emerald-500 font-black">เสร็จ</span> :
                            <span className="text-blue-500 font-black">กำลังทำ</span>}
                        </div>
                    </div>

                    {/* ส่วนขวา: ปุ่มจัดการ (คงขนาดเดิมที่ปรับไว้ล่าสุด) */}
                    {isProjectPlanner && (
                      <div className="flex gap-1 ml-auto">
                        <button onClick={() => setCopyModalOpen(true)} className="bg-slate-700 text-slate-200 px-2 py-1 rounded text-[10px] hover:bg-slate-600 border border-slate-600 font-bold">คัดลอก</button>
                        <button onClick={handleSaveAllSchedules} disabled={isSubmitting} className="bg-rose-600 text-white px-2 py-1 rounded text-[10px] hover:bg-rose-700 font-bold">บันทึก</button>
                      </div>
                    )}
                  </div>
                </div>
                     {/* 🌟 โซน 2.5D Task-Linked Visual Progress (แสดงผลตามสถานะงานจริง) 🌟 */}
                     {houseTypes.find(t => t.id === selectedPlot?.house_type_id)?.visual_config && (
                         <div className="bg-slate-900 border-b-8 border-slate-950 p-6 sm:p-10 flex flex-col lg:flex-row items-center gap-8 relative overflow-hidden">
                            <div className="absolute top-1/2 left-1/4 -translate-y-1/2 w-64 h-64 bg-blue-500/20 blur-[100px] rounded-full pointer-events-none"></div>

                            {/* 🏗️ ฝั่งซ้าย: รูปภาพซ้อนเลเยอร์ตามค่าความคืบหน้าจริงของงานย่อย */}
                            <div className="relative w-full lg:w-1/2 aspect-[4/3] sm:aspect-[16/9] lg:aspect-square max-w-[500px] flex items-center justify-center bg-slate-950/40 p-2 rounded-2xl border border-slate-800">
                               {(() => {
                                  // 🧠 แกะลอจิกตรวจสอบสถานะเรียงตาม Z-Index
                                  const config = houseTypes.find(t => t.id === selectedPlot?.house_type_id).visual_config || {};
                                  const activeLayers = [];

                                  taskTemplates
                                     .filter(t => t.house_type_id === selectedPlot?.house_type_id)
                                     .forEach(task => {
                                        const taskConfig = config[task.id];
                                        if (!taskConfig) return; // งานนี้ไม่มีรูปข้ามไปเลย

                                        // ดึงเปอร์เซ็นต์ความคืบหน้าจริงของงานนี้จากแอป
                                        const actualProgress = latestUpdatesMap[`${selectedPlot.id}-${task.id}`]?.progress || 0;

                                        if (actualProgress === 100 && taskConfig.done_image) {
                                           activeLayers.push({ url: taskConfig.done_image, z: Number(taskConfig.done_z || 10), name: task.task_name });
                                        } else if (actualProgress > 0 && actualProgress < 100 && taskConfig.progress_image) {
                                           activeLayers.push({ url: taskConfig.progress_image, z: Number(taskConfig.progress_z || 10), name: task.task_name });
                                        }
                                     });

                                  // จัดลำดับเลเยอร์ภาพเพื่อป้องกันรูปเพี้ยน
                                  return activeLayers
                                     .sort((a, b) => a.z - b.z)
                                     .map((layer, idx) => (
                                        <img 
                                           key={idx}
                                           src={layer.url} 
                                           className="absolute inset-0 w-full h-full object-contain drop-shadow-2xl animate-fade-in" 
                                           style={{ zIndex: layer.z }}
                                           alt={layer.name} 
                                        />
                                     ));
                               })()}
                            </div>

                            {/* 📊 ฝั่งขวา: สรุปรายงานการประกอบร่างดิจิทัล */}
                            <div className="w-full lg:w-1/2 text-white space-y-4 relative z-10">
                               <div>
                                  <h3 className="text-2xl sm:text-3xl font-black italic tracking-tighter mb-1 flex items-center gap-2">
                                     <Monitor className="text-blue-500" size={24}/> 2.5D DIGITAL TWIN
                                  </h3>
                                  <p className="text-slate-400 font-bold text-xs tracking-widest uppercase">แบบบ้าน: {selectedPlot?.type} (ประมวลผลรายงวดงานจริง)</p>
                               </div>

                               <div className="text-xs bg-slate-950/60 p-4 rounded-xl border border-slate-800 text-slate-400 font-medium leading-relaxed">
                                  <p>💡 ระบบจะคำนวณการแสดงผลภาพแบบแยกตามงวดงานจริงหน้าไซต์:</p>
                                  <ul className="list-disc list-inside mt-2 space-y-1 text-slate-300">
                                     <li>งวดงานสถานะ <span className="text-amber-400 font-bold">กำลังดำเนินการ (1-99%)</span> จะดึงภาพเลเยอร์โครงสร้างชั่วคราว</li>
                                     <li>งวดงานสถานะ <span className="text-emerald-400 font-bold">เสร็จสมบูรณ์ (100%)</span> จะดึงภาพสำเร็จมาประกอบร่างทับซ้อนตามลำดับเลเยอร์</li>
                                  </ul>
                               </div>
                            </div>
                         </div>
                     )}            
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
                                 {/* 🌟 2. ปรับหัวตารางวันที่ให้เรียงต่อเนื่อง และล็อกขนาดช่องละ 36px 🌟 */}
                                 <th className="bg-slate-100 border-b border-slate-200 p-0 relative w-full z-[60]" style={{ minWidth: `${totalChartDays * 36}px`, height: isMobileLayout ? '40px' : '56px' }}>
                                    {todayTs >= chartStart && todayTs <= chartEnd && (
                                       <div className="absolute top-0 bottom-0 border-l-2 sm:border-l-[3px] border-dashed border-rose-500 z-[10] flex flex-col items-center pointer-events-none" style={{ left: `${getChartLeft(todayTs)}%` }}>
                                          <span className="bg-rose-500 text-white text-[7px] sm:text-[11px] font-black px-1.5 sm:px-2.5 py-0.5 sm:py-1 rounded-b-md sm:rounded-b-lg shadow-md mt-0 sm:mt-1">ปัจจุบัน</span>
                                       </div>
                                    )}
                                              
                                    <div className="absolute inset-0 flex pointer-events-none">
                                       {timeMarkers.map((m, i) => (
                                          <div key={i} className={`border-l h-full relative ${m.isMonth ? 'border-slate-300 bg-slate-200/20' : 'border-slate-200/50'}`} style={{position: 'absolute', left: `${m.left}%`, width: `${(1 / totalChartDays) * 100}%`}}>
                                                        
                                             {m.monthLabel && (
                                                <div className="absolute top-1.5 sm:top-2 left-1 bg-slate-800 text-white font-black px-2 py-0.5 rounded shadow-sm text-[8px] sm:text-[10px] whitespace-nowrap z-30 border border-slate-700">
                                                   {m.monthLabel}
                                                </div>
                                             )}
                                                        
                                             {/* 🎯 บังคับจัดเลขวันที่ให้อยู่ตรงกลางช่องพอดีเป๊ะ (เติม 0 ข้างหน้าถ้าเป็นเลขหลักเดียว) */}
                                             <div className="absolute bottom-1 sm:bottom-2 w-full flex justify-center">
                                                <span className="text-[8px] sm:text-xs font-black text-slate-400">{String(m.dayLabel).padStart(2, '0')}</span>
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
                                <tr key={task.id} className="group hover:bg-slate-50/80 transition-colors bg-white cursor-pointer" onClick={(e: any) => {
                                  // ถ้าคลิกโดนช่องกรอกข้อความ (INPUT) ให้ข้ามคำสั่งนี้ไป
                                  if (e.target && e.target.tagName === 'INPUT') return;
                                  
                                  // โหลดข้อมูลเข้าสู่หน้า Task Progress
                                  setSelectedTask(task);
                                  setView('task-progress');
                                  supabase.from('task_updates').select('*')
                                    .eq('task_template_id', task.id)
                                    .eq('plot_id', selectedPlot.id)
                                    .order('created_at', { ascending: true })
                                    .then(({data}) => { 
                                       setUpdates(data || []); 
                                       setProgressValue(data?.length ? data[data.length-1].progress : 0); 
                                    });
                               }}>
                                {/* 🌟 2. [ฉบับแก้ไข] บีบความสูงแถวฝั่งซ้าย ล็อก Task Name 2 บรรทัด และล็อกคอลัมน์ให้อยู่กับที่ 🌟 */}
                                {/* 🌟 ปรับขยายความสูงแถว เพื่อไม่ให้เบอร์โทรโดนทับ (มือถือ 90px / คอม 100px) */}
                                 <td className={`p-2 sm:p-3 border-b border-slate-200 ${isMobileLayout ? 'h-[90px]' : 'h-[100px]'} flex flex-col justify-between min-w-0 bg-white sticky left-0 z-20 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)]`}>
                                    <div className="min-w-0">
                                       <div className="flex items-start gap-1.5">
                                          <span className="text-[10px] sm:text-xs font-black text-slate-400 shrink-0 bg-slate-100 px-1.5 py-0.5 rounded border mt-0.5">#{task.task_order}</span>
                                          {/* 🎯 บังคับชื่องานให้แสดงสูงสุด 2 บรรทัดเท่ากันหมด (line-clamp-2) ถ้าสั้นก็อยู่บรรทัดเดียว แต่ความสูงแถวจะเท่ากันเป๊ะ */}
                                          <h4 className="font-black text-slate-800 text-xs sm:text-sm leading-tight text-ellipsis overflow-hidden [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical]" title={task.task_name}>
                                             {task.task_name}
                                          </h4>
                                       </div>
                                    </div>

                                    {/* 🔄 ปุ่มสัญลักษณ์จัดช่าง (เปิดสิทธิ์ให้ Project Planner และ Procurement กดได้) */}
                                    <div className="flex items-center justify-between gap-1 mt-1 border-t border-slate-100 pt-1">
                                       {assignment ? (
                                          <div className="flex items-center gap-1.5 min-w-0 flex-1">
                                             <div className="w-5 h-5 rounded-full bg-blue-50 border border-blue-200 flex items-center justify-center shrink-0">
                                                <HardHat size={11} className="text-blue-600"/>
                                             </div>
                                             <div className="flex flex-col min-w-0 flex-1">
                                                <span className="text-[10px] sm:text-xs font-bold text-blue-700 truncate">{assignment.contractor_name.split(' ')[0]}</span>
                                                {assignment.contractor_phone && <span className="text-[9px] sm:text-[10px] font-medium text-slate-400 truncate">📞 {assignment.contractor_phone}</span>}
                                             </div>
                                             {/* ✅ แก้ไขปุ่มเปลี่ยนช่าง (รูปเฟือง UserCog) ให้เรียก Modal ถูกต้อง */}
                                             {(isAdmin || isProjectPlanner || isProcurement) && (
                                                <button onClick={(e) => { e.stopPropagation(); setAssignModal({ isOpen: true, task: task, name: assignment.contractor_name || '', phone: assignment.contractor_phone || '' }); }} className="w-5 h-5 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-blue-600 shrink-0 transition-colors" title="เปลี่ยนช่าง">
                                                   <UserCog size={12} />
                                                </button>
                                             )}
                                          </div>
                                       ) : (
                                          <div className="w-full">
                                             {/* ✅ แก้ไขปุ่มระบุช่าง ให้เรียก Modal ถูกต้อง */}
                                             {(isAdmin || isProjectPlanner || isProcurement) ? (
                                                <button 
                                                   onClick={(e) => { e.stopPropagation(); setAssignModal({ isOpen: true, task: task, name: '', phone: '' }); }}
                                                   className="flex items-center gap-1 text-[10px] sm:text-xs font-black text-rose-500 hover:text-rose-600 bg-rose-50/50 hover:bg-rose-50 border border-rose-200/60 border-dashed px-2 py-0.5 rounded-md transition-colors w-full justify-center"
                                                >
                                                   <PlusCircle size={12}/> ระบุช่าง
                                                </button>
                                             ) : (
                                                <span className="text-[10px] sm:text-xs font-bold text-slate-400 italic">ยังไม่ระบุช่าง</span>
                                             )}
                                          </div>
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

                                    let actualDurationText = '-';
                                    if (dates?.start) {
                                       const aEnd = dates.end ? new Date(dates.end).getTime() : Date.now();
                                       const aDiff = aEnd - new Date(dates.start).getTime();
                                       actualDurationText = `${Math.max(0, Math.ceil(aDiff / 86400000)) + 1} วัน`;
                                    }

                                    return (
                                       <>
                                         {/* Start Column (Planner) */}
                                         <td className="sticky left-[280px] bg-white z-[40] border-b border-r border-slate-200 p-2 align-middle bg-pink-50/20 w-[140px] min-w-[140px] max-w-[140px]">
                                            <div className="flex items-center gap-1 pb-1.5 mb-1.5 border-b border-dashed border-pink-300">
                                                <span className="text-[8px] font-black uppercase text-pink-500 w-8 shrink-0 text-left">Plan:</span>
                                                <input type="date" value={currentStart} 
                                                   onChange={(e) => {
                                                      const newStart = e.target.value; let newEnd = currentEnd;
                                                      if (newStart && currentDuration && Number(currentDuration) > 0) {
                                                         const d = new Date(newStart); d.setDate(d.getDate() + (Number(currentDuration) - 1));
                                                         newEnd = d.toISOString().split('T')[0];
                                                      }
                                                      setScheduleInputs(prev => ({...prev, [task.id]: { ...prev[task.id], start: newStart, end: newEnd, duration: currentDuration }}));
                                                   }} 
                                                   className="flex-1 w-full border border-pink-200 rounded px-1 py-1 text-[9px] font-bold text-slate-700 outline-none focus:border-pink-500 bg-white shadow-sm" 
                                                />
                                            </div>
                                            <div className="flex items-center gap-1">
                                                <span className="text-[8px] font-black uppercase text-blue-500 w-8 shrink-0 text-left">Actual:</span>
                                                <div className="flex-1 text-[9px] sm:text-[11px] font-bold text-blue-600 text-center">
                                                  {dates?.start ? new Date(dates.start).toLocaleDateString('en-GB',{day:'2-digit',month:'2-digit',year:'2-digit'}) : '-'}
                                                </div>
                                            </div>
                                         </td>
                                            
                                          {/* Duration Column (Planner) */}
                                         <td className="sticky left-[420px] bg-white z-[40] border-b border-r border-slate-200 p-2 align-middle bg-pink-50/20 w-[100px] min-w-[100px] max-w-[100px]">
                                            <div className="flex items-center justify-center pb-1.5 mb-1.5 border-b border-dashed border-pink-300">
                                                {/* ❌ เอาคำว่า Plan: ออก และจัดตัวเลขให้อยู่กึ่งกลาง */}
                                                <input type="number" min="1" placeholder="วัน" value={currentDuration} 
                                                   onChange={(e) => {
                                                      const newDuration = e.target.value; let newEnd = currentEnd;
                                                      if (currentStart && newDuration && Number(newDuration) > 0) {
                                                         const d = new Date(currentStart);
                                                         d.setDate(d.getDate() + (Number(newDuration) - 1));
                                                         newEnd = d.toISOString().split('T')[0];
                                                      }
                                                      setScheduleInputs(prev => ({...prev, [task.id]: { ...prev[task.id], duration: newDuration, end: newEnd, start: currentStart }}));
                                                   }}
                                                   className="w-full border border-pink-200 rounded px-1 py-1 text-[9px] font-black text-center text-pink-600 outline-none focus:border-pink-500 bg-white shadow-sm" 
                                                />
                                            </div>
                                            <div className="flex items-center justify-center">
                                                {/* ❌ เอาคำว่า Actual: ออก และจัดตัวเลขให้อยู่กึ่งกลาง */}
                                                <div className="w-full text-[9px] sm:text-xs font-black text-blue-500 text-center">
                                                  {actualDurationText}
                                                </div>
                                            </div>
                                         </td>

                                         {/* Finish Column (Planner) */}
                                         <td className="sticky left-[520px] bg-white z-[40] border-b border-r border-slate-200 p-2 align-middle bg-pink-50/20 shadow-[4px_0_10px_-4px_rgba(0,0,0,0.05)] w-[140px] min-w-[140px] max-w-[140px]">
                                            <div className="flex items-center justify-center pb-1.5 mb-1.5 border-b border-dashed border-pink-300">
                                                {/* ❌ เอาคำว่า Plan: ออก และจัดตัวเลขให้อยู่กึ่งกลาง */}
                                                <input type="date" value={currentEnd} 
                                                   onChange={(e) => {
                                                      const newEnd = e.target.value;
                                                      let newDuration = currentDuration;
                                                      if (currentStart && newEnd) {
                                                         const diffTime = new Date(newEnd).getTime() - new Date(currentStart).getTime();
                                                         newDuration = String(Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24))) + 1);
                                                      }
                                                      setScheduleInputs(prev => ({...prev, [task.id]: { ...prev[task.id], end: newEnd, duration: newDuration, start: currentStart }}));
                                                   }} 
                                                   className="w-full border border-pink-200 rounded px-1 py-1 text-[9px] font-bold text-slate-700 outline-none focus:border-pink-500 bg-white shadow-sm text-center" 
                                                />
                                            </div>
                                            <div className="flex items-center justify-center">
                                                {/* ❌ เอาคำว่า Actual: ออก และจัดตัวเลขให้อยู่กึ่งกลาง */}
                                                <div className="w-full text-[9px] sm:text-[11px] font-bold text-green-600 text-center">
                                                  {dates?.end ? new Date(dates.end).toLocaleDateString('en-GB',{day:'2-digit',month:'2-digit',year:'2-digit'}) : '-'}
                                                </div>
                                            </div>
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

                                    let actualDurationText = '-';
                                    if (dates?.start) {
                                       const aEnd = dates.end ? new Date(dates.end).getTime() : Date.now();
                                       const aDiff = aEnd - new Date(dates.start).getTime();
                                       actualDurationText = `${Math.max(0, Math.ceil(aDiff / 86400000)) + 1} วัน`;
                                    }

                                    return (
                                       <>
                                         {/* Start Column */}
                                         <td className="sticky left-[280px] bg-white z-[40] border-b border-r border-slate-200 p-2 align-middle w-[140px] min-w-[140px] max-w-[140px]">
                                            <div className="flex items-center gap-1 pb-1.5 mb-1.5 border-b border-dashed border-slate-200">
                                              <span className="text-[8px] font-black uppercase text-slate-400 w-8 shrink-0 text-left">Plan:</span>
                                              <div className="flex-1 text-[9px] sm:text-[11px] font-bold text-slate-700 text-center">
                                                {plan.planned_start ? new Date(plan.planned_start).toLocaleDateString('en-GB',{day:'2-digit',month:'2-digit',year:'2-digit'}) : '-'}
                                              </div>
                                            </div>
                                            <div className="flex items-center gap-1">
                                              <span className="text-[8px] font-black uppercase text-blue-400 w-8 shrink-0 text-left">Actual:</span>
                                              <div className="flex-1 text-[9px] sm:text-[11px] font-bold text-blue-600 text-center">
                                                {dates?.start ? new Date(dates.start).toLocaleDateString('en-GB',{day:'2-digit',month:'2-digit',year:'2-digit'}) : '-'}
                                              </div>
                                            </div>
                                         </td>

                                          {/* Duration Column */}
                                         <td className="sticky left-[420px] bg-white z-[40] border-b border-r border-slate-200 p-2 align-middle w-[100px] min-w-[100px] max-w-[100px]">
                                            <div className="flex items-center justify-center pb-1.5 mb-1.5 border-b border-dashed border-slate-200">
                                              {/* ❌ เอาคำว่า Plan: ออก และจัดตัวเลขให้อยู่กึ่งกลาง */}
                                              <div className="w-full text-[9px] sm:text-xs font-black text-slate-600 text-center">
                                                  {durationText}
                                              </div>
                                            </div>
                                            <div className="flex items-center justify-center">
                                              {/* ❌ เอาคำว่า Actual: ออก และจัดตัวเลขให้อยู่กึ่งกลาง */}
                                              <div className="w-full text-[9px] sm:text-xs font-black text-blue-500 text-center">
                                                  {actualDurationText}
                                              </div>
                                            </div>
                                         </td>

                                         {/* Finish Column */}
                                         <td className="sticky left-[520px] bg-white z-[40] border-b border-r border-slate-200 p-2 align-middle shadow-[4px_0_10px_-4px_rgba(0,0,0,0.05)] w-[140px] min-w-[140px] max-w-[140px]">
                                            <div className="flex items-center justify-center pb-1.5 mb-1.5 border-b border-dashed border-slate-200">
                                              {/* ❌ เอาคำว่า Plan: ออก และจัดตัวเลขให้อยู่กึ่งกลาง */}
                                              <div className="w-full text-[9px] sm:text-[11px] font-bold text-slate-700 text-center">
                                                {plan.planned_end ? new Date(plan.planned_end).toLocaleDateString('en-GB',{day:'2-digit',month:'2-digit',year:'2-digit'}) : '-'}
                                              </div>
                                            </div>
                                            <div className="flex items-center justify-center">
                                              {/* ❌ เอาคำว่า Actual: ออก และจัดตัวเลขให้อยู่กึ่งกลาง */}
                                              <div className="w-full text-[9px] sm:text-[11px] font-bold text-green-600 text-center">
                                                {dates?.end ? new Date(dates.end).toLocaleDateString('en-GB',{day:'2-digit',month:'2-digit',year:'2-digit'}) : '-'}
                                              </div>
                                            </div>
                                         </td>
                                       </>
                                    );
                                 })()}

                                    {/* 🌟 3. บีบความสูงช่องกราฟฝั่งขวาลงให้เท่าฝั่งซ้าย และจัดตำแหน่งแท่งกราฟใหม่ 🌟 */}
                                    {/* 🌟 ปรับขยายความสูงช่องกราฟ ให้เท่ากับฝั่งซ้ายเป๊ะๆ */}
                                     <td className="border-b border-slate-200 p-0 relative z-10 w-full" style={{ minWidth: `${totalChartDays * 36}px`, height: isMobileLayout ? '90px' : '100px' }}>
                                       <div className="absolute inset-0 flex pointer-events-none z-0">
                                          {timeMarkers.map((m, i) => ( <div key={i} className={`border-l h-full ${m.isMonth ? 'border-slate-300 bg-slate-50/50' : 'border-slate-100'}`} style={{position: 'absolute', left: `${m.left}%`, width: `${(1 / totalChartDays) * 100}%`}}></div> ))}
                                          {todayTs >= chartStart && todayTs <= chartEnd && ( <div className="absolute top-0 bottom-0 border-l-2 sm:border-l-[3px] border-dashed border-rose-500/80 z-[15] pointer-events-none" style={{ left: `${getChartLeft(todayTs)}%` }}></div> )}
                                       </div>
                                       
                                       {/* 🌟 ปรับขนาดและตำแหน่งแท่งกราฟให้อยู่ตรงกลางช่องพอดี (ใช้ % แทน px) */}
                                       <div className="relative w-full h-full flex flex-col px-0">
                                          {pStartTs && pEndTs && ( 
                                             <div className="absolute h-2 bg-slate-800 rounded-sm z-[20] shadow-sm opacity-90" style={{ left: `${getChartLeft(pStartTs)}%`, width: `${getChartWidth(pStartTs, pEndTs)}%`, top: '25%' }} /> 
                                          )}
                                          
                                          {aStartTs && ( 
                                             <div className={`absolute h-4 rounded-sm z-[25] shadow-sm ${statusObj.barColor}`} style={{ left: `${getChartLeft(aStartTs)}%`, width: `${getChartWidth(aStartTs, aEndTs)}%`, top: '45%' }}>
                                                <span className="absolute -top-3.5 text-[8px] sm:text-[9px] font-black text-slate-600 bg-white/95 border border-slate-200 px-1 py-0 rounded shadow-sm" style={{ left: '2px' }}>{tProgress}%</span>
                                             </div> 
                                          )}
                                       </div>
                                     </td>
                               </tr>
                             )
                           })}
                         </tbody>
                       </table>
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
                                 {/* 🌟 ปุ่ม Punch List / Defect แยกหน้าต่างแบบมีรูปภาพ */}
                                 {['QC', 'Foreman', 'Site Engineer', 'Admin', 'Owner'].includes(currentUserRole) && (
                                    <button 
                                       onClick={() => setDefectModal({ isOpen: true, task: selectedTask, plotId: selectedPlot.id })}
                                       className={`ml-3 sm:ml-6 bg-rose-600 hover:bg-rose-700 text-white font-black flex items-center gap-1.5 shadow-md border border-rose-500 transition-all ${isMobileLayout ? 'px-2.5 py-2 text-[10px] rounded-lg' : 'px-4 py-3 text-sm rounded-xl'}`}
                                    >
                                       <ShieldAlert size={isMobileLayout ? 14 : 18} />
                                       <span className="hidden sm:inline">แจ้งซ่อม (Defect)</span>
                                       <span className="inline sm:hidden">แจ้งซ่อม</span>
                                       {defects.filter(d => d.plot_id === selectedPlot.id && d.task_id === selectedTask.id && d.status === 'pending').length > 0 && (
                                          <span className="bg-white text-rose-600 text-[10px] font-black px-1.5 py-0.5 rounded-full animate-pulse ml-1 shadow">
                                             {defects.filter(d => d.plot_id === selectedPlot.id && d.task_id === selectedTask.id && d.status === 'pending').length}
                                          </span>
                                       )}
                                    </button>
                                 )}
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
                                         {/* 🌟 ป้ายสภาพอากาศ ณ เวลาที่รายงาน */}
                                          {update.weather_info && (
                                            <span className={`text-[8px] sm:text-xs text-sky-700 font-bold bg-sky-50 border border-sky-100 ${isMobileLayout ? 'px-2 py-0.5' : 'px-3 py-1.5'} rounded-lg shrink-0 w-fit flex items-center gap-1`} title="สภาพอากาศขณะรายงาน">
                                                {update.weather_info}
                                            </span>
                                          )}
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
                               ) : isProcurement || isProjectPlanner || isOwner ? (
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
                           <option value="Foreman">Foreman</option><option value="Site Engineer">Site Engineer</option><option value="QC">QC</option><option value="Project Planner">Project Planner (วางแผน)</option><option value="Procurement">Procurement (จัดจ้าง)</option><option value="Admin">Admin</option><option value="Owner">Owner (ผู้บริหาร / ดูได้อย่างเดียว)</option>
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
               {/* 🌟 ADMIN: ตั้งค่า 2.5D แบบรายงวดงาน (Task-Driven 2.5D Config) 🌟 */}
               {view === 'admin-visualizer' && isAdmin && (
                 <div className="animate-in slide-in-from-bottom duration-300 max-w-6xl mx-auto mt-4 sm:mt-8 px-4 sm:px-0">
                    <button onClick={() => setView('dashboard')} className="mb-4 sm:mb-6 text-xs sm:text-base font-bold text-blue-600 flex items-center gap-1.5">← BACK TO DASHBOARD</button>
                    
                    <div className="bg-white p-4 sm:p-8 rounded-3xl border border-slate-200 shadow-xl">
                       <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b pb-4 mb-6 gap-4">
                          <div>
                             <h2 className="text-xl sm:text-2xl font-black text-slate-800 uppercase italic tracking-tight flex items-center gap-2"><Monitor className="text-rose-600"/> 2.5D Task-Linked Visualizer</h2>
                             <p className="text-xs text-slate-400 font-bold mt-1">กางงวดงานทั้งหมดเพื่อผูกรูปภาพตามสถานะงานจริง</p>
                          </div>
                          
                          {/* เมนูเลือกแบบบ้าน */}
                          <div className="w-full sm:w-64">
                             <select 
                                value={editingHouseType?.id || ''} 
                                onChange={(e) => {
                                   const type = houseTypes.find(t => t.id === e.target.value);
                                   setEditingHouseType(type);
                                   setVisualConfig(type?.visual_config || {});
                                   setSimulatedStatus({}); // รีเซ็ตกล่องลองเล่นพรีวิว
                                }} 
                                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-black text-xs sm:text-sm text-slate-700 outline-none focus:border-rose-500 shadow-sm"
                             >
                                <option value="">-- เลือกแบบบ้านเพื่อตั้งค่า --</option>
                                {houseTypes.map(t => <option key={t.id} value={t.id}>{t.type_name}</option>)}
                             </select>
                          </div>
                       </div>

                       {editingHouseType ? (
                          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                             
                             {/* 🖥️ ฝั่งซ้าย (4 ส่วน): กล่อง Live Preview + แผงสวิตช์ลองเล่นจำลองสถานะ */}
                             <div className="lg:col-span-4 space-y-4">
                                <div className="sticky top-4 space-y-4">
                                   <div className="bg-slate-950 p-4 rounded-2xl aspect-square border-2 border-slate-800 shadow-2xl flex items-center justify-center relative overflow-hidden">
                                      <span className="absolute top-2 left-2 text-[9px] font-bold text-slate-500 tracking-widest uppercase bg-slate-900/80 px-2 py-0.5 rounded-md border border-slate-800 z-30">Live 2.5D Preview</span>
                                      
                                      {/* วนลูปรูปภาพมาซ้อนทับกันตาม Z-Index ที่ตั้งไว้ */}
                                      <div className="relative w-full h-full flex items-center justify-center">
                                         {taskTemplates
                                            .filter(t => t.house_type_id === editingHouseType.id)
                                            .flatMap(task => {
                                               const config = visualConfig[task.id] || {};
                                               const status = simulatedStatus[task.id] || 'none';
                                               const layers = [];
                                               
                                               if (status === 'progress' && config.progress_image) {
                                                  layers.push({ url: config.progress_image, z: Number(config.progress_z || 10) });
                                               }
                                               if (status === 'done' && config.done_image) {
                                                  layers.push({ url: config.done_image, z: Number(config.done_z || 10) });
                                               }
                                               return layers;
                                            })
                                            .sort((a, b) => a.z - b.z) // เรียงลำดับจากล่างขึ้นบนตาม Z-Index
                                            .map((layer, index) => (
                                               <img key={index} src={layer.url} className="absolute inset-0 w-full h-full object-contain transition-all duration-300" style={{ zIndex: layer.z }} alt="Preview layer" />
                                            ))
                                         }
                                      </div>
                                   </div>
                                   
                                   {/* ปุ่มเซฟใหญ่ */}
                                   <button 
                                      onClick={handleSave25DConfig} 
                                      disabled={isSubmitting || isUploadingLayer}
                                      className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-black py-3 rounded-xl shadow-lg transition-all flex justify-center items-center gap-2 text-sm uppercase tracking-wider"
                                   >
                                      {isSubmitting ? <Loader2 className="animate-spin" size={18}/> : <Save size={18}/>} บันทึกโครงสร้างเลเยอร์นี้
                                   </button>
                                </div>
                             </div>

                             {/* 📋 ฝั่งขวา (8 ส่วน): รายการ Task งวดงานทั้งหมดที่ดึงขึ้นมาอัตโนมัติ */}
                             <div className="lg:col-span-8 space-y-4 max-h-[70vh] overflow-y-auto pr-2 custom-scrollbar">
                                {taskTemplates.filter(t => t.house_type_id === editingHouseType.id).length === 0 ? (
                                   <p className="text-center text-slate-400 italic py-10 font-bold">ยังไม่มีงวดงานถูกผูกไว้กับแบบบ้านนี้ กรุณาไปเพิ่มงวดงานก่อนครับ</p>
                                ) : (
                                   taskTemplates
                                      .filter(t => t.house_type_id === editingHouseType.id)
                                      .sort((a, b) => a.task_order - b.task_order)
                                      .map((task) => {
                                         const config = visualConfig[task.id] || {};
                                         const currentSimStatus = simulatedStatus[task.id] || 'none';
                                         
                                         return (
                                            <div key={task.id} className="bg-slate-50 p-4 rounded-2xl border border-slate-200 shadow-sm space-y-4 hover:border-blue-300 transition-colors">
                                               {/* ส่วนหัวของชื่องาน */}
                                               <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b pb-2 border-slate-200">
                                                  <div className="flex items-center gap-2">
                                                     <span className="w-6 h-6 rounded-lg bg-slate-800 text-white font-black text-[10px] flex items-center justify-center">{task.task_order}</span>
                                                     <h4 className="font-black text-slate-700 text-sm">{task.task_name}</h4>
                                                  </div>
                                                  {/* 🎮 สวิตช์จำลองสถานะสำหรับช่อง Preview */}
                                                  <div className="flex bg-slate-200 p-0.5 rounded-lg text-[9px] font-bold w-fit self-end">
                                                     <button onClick={() => setSimulatedStatus({...simulatedStatus, [task.id]: 'none'})} className={`px-2 py-1 rounded-md transition-colors ${currentSimStatus === 'none' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}>ยังไม่เริ่ม</button>
                                                     <button onClick={() => setSimulatedStatus({...simulatedStatus, [task.id]: 'progress'})} className={`px-2 py-1 rounded-md transition-colors ${currentSimStatus === 'progress' ? 'bg-amber-500 text-white shadow-sm' : 'text-slate-500'}`}>กำลังทำ (0-99%)</button>
                                                     <button onClick={() => setSimulatedStatus({...simulatedStatus, [task.id]: 'done'})} className={`px-2 py-1 rounded-md transition-colors ${currentSimStatus === 'done' ? 'bg-emerald-500 text-white shadow-sm' : 'text-slate-500'}`}>เสร็จสิ้น (100%)</button>
                                                  </div>
                                               </div>

                                               {/* ตารางแบ่ง 2 สล็อตสำหรับรูปภาพ */}
                                               <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                  
                                                  {/* สล็อต 1: ช่วงกำลังดำเนินการ (0-99%) */}
                                                  <div className="bg-white p-3 rounded-xl border border-slate-200 flex flex-col justify-between gap-3">
                                                     <div className="flex items-center justify-between">
                                                        <span className="text-[10px] font-black text-amber-600 bg-amber-50 px-2 py-0.5 rounded border border-amber-200 uppercase tracking-wider">🚧 ช่วงกำลังทำ (0-99%)</span>
                                                        <div className="flex items-center gap-1">
                                                           <span className="text-[9px] text-slate-400 font-bold">Z-Index:</span>
                                                           <input type="number" value={config.progress_z ?? 10} onChange={(e) => setVisualConfig({...visualConfig, [task.id]: { ...config, progress_z: Number(e.target.value) }})} className="w-12 text-center border rounded p-0.5 text-xs font-black bg-slate-50" title="ลำดับการวางซ้อนภาพ เลขมากจะทับเลขน้อย" />
                                                        </div>
                                                     </div>
                                                     <div className="flex items-center gap-3">
                                                        <div className="w-14 h-14 bg-slate-100 border rounded-lg flex items-center justify-center overflow-hidden shrink-0">
                                                           {config.progress_image ? <img src={config.progress_image} className="w-full h-full object-contain" /> : <ImageIcon className="text-slate-300" size={20}/>}
                                                        </div>
                                                        <div className="flex-1 space-y-1">
                                                           <label className="block text-[10px] bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold py-1.5 px-2 rounded-md text-center cursor-pointer border transition-colors">
                                                              <input type="file" accept="image/png" className="hidden" onChange={(e) => handleUploadSlot(task.id, 'progress', e.target.files?.[0])} disabled={isUploadingLayer} />
                                                              {isUploadingLayer ? 'อัปโหลด...' : 'เลือกไฟล์ PNG'}
                                                           </label>
                                                           {config.progress_image && (
                                                              <button onClick={() => setVisualConfig({...visualConfig, [task.id]: { ...config, progress_image: '' }})} className="w-full text-[9px] text-rose-500 font-bold text-center block hover:underline">ลบรูปออก</button>
                                                           )}
                                                        </div>
                                                     </div>
                                                  </div>

                                                  {/* สล็อต 2: ช่วงเสร็จสมบูรณ์ (100%) */}
                                                  <div className="bg-white p-3 rounded-xl border border-slate-200 flex flex-col justify-between gap-3">
                                                     <div className="flex items-center justify-between">
                                                        <span className="text-[10px] font-black text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 uppercase tracking-wider">✅ เสร็จสิ้น (100%)</span>
                                                        <div className="flex items-center gap-1">
                                                           <span className="text-[9px] text-slate-400 font-bold">Z-Index:</span>
                                                           <input type="number" value={config.done_z ?? 10} onChange={(e) => setVisualConfig({...visualConfig, [task.id]: { ...config, done_z: Number(e.target.value) }})} className="w-12 text-center border rounded p-0.5 text-xs font-black bg-slate-50" title="ลำดับการวางซ้อนภาพ เลขมากจะทับเลขน้อย" />
                                                        </div>
                                                     </div>
                                                     <div className="flex items-center gap-3">
                                                        <div className="w-14 h-14 bg-slate-100 border rounded-lg flex items-center justify-center overflow-hidden shrink-0">
                                                           {config.done_image ? <img src={config.done_image} className="w-full h-full object-contain" /> : <ImageIcon className="text-slate-300" size={20}/>}
                                                        </div>
                                                        <div className="flex-1 space-y-1">
                                                           <label className="block text-[10px] bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold py-1.5 px-2 rounded-md text-center cursor-pointer border transition-colors">
                                                              <input type="file" accept="image/png" className="hidden" onChange={(e) => handleUploadSlot(task.id, 'done', e.target.files?.[0])} disabled={isUploadingLayer} />
                                                              {isUploadingLayer ? 'อัปโหลด...' : 'เลือกไฟล์ PNG'}
                                                           </label>
                                                           {config.done_image && (
                                                              <button onClick={() => setVisualConfig({...visualConfig, [task.id]: { ...config, done_image: '' }})} className="w-full text-[9px] text-rose-500 font-bold text-center block hover:underline">ลบรูปออก</button>
                                                           )}
                                                        </div>
                                                     </div>
                                                  </div>

                                               </div>
                                            </div>
                                         );
                                      })
                                )}
                             </div>

                          </div>
                       ) : (
                          <div className="text-center text-slate-400 font-bold py-20 border border-dashed rounded-2xl bg-slate-50">
                             ← กรุณาเลือกแบบบ้านที่ด้านบน เพื่อเริ่มต้นกางงวดงานจัดเลเยอร์ภาพครับ
                          </div>
                       )}
                    </div>
                 </div>
               )}
               {/* 🌟 หน้าจอ ADMIN: จัดการแบบบ้าน (HOUSE TYPES) 🌟 */}
               {view === 'admin-house-types' && isAdmin && (
                 <div className="animate-in slide-in-from-bottom duration-300 max-w-4xl mx-auto mt-4 sm:mt-8 px-4 sm:px-0">
                   <button onClick={() => setView('dashboard')} className="mb-4 sm:mb-6 text-xs sm:text-base font-bold text-blue-600 flex items-center gap-1.5">← BACK TO DASHBOARD</button>
                   
                   <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                      {/* 🛠️ ฝั่งซ้าย: ฟอร์ม กรอกข้อมูล เพิ่ม/แก้ไข */}
                      <div className="bg-white p-5 sm:p-6 rounded-2xl border border-slate-200 shadow-md h-fit">
                         <h3 className="font-black text-slate-800 text-lg mb-4 uppercase italic tracking-tight border-b pb-2 flex items-center gap-1.5 text-rose-600">
                            {isEditingType ? '📝 แก้ไขแบบบ้าน' : '➕ เพิ่มแบบบ้านใหม่'}
                         </h3>
                         <div className="space-y-4">
                            <div>
                               <label className="block text-[10px] font-black text-slate-500 mb-1 uppercase tracking-widest">ชื่อแบบบ้าน</label>
                               <input type="text" placeholder="เช่น Type A, บ้านเดี่ยวสองชั้น" value={houseTypeForm.type_name} onChange={(e) => setHouseTypeForm({...houseTypeForm, type_name: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 font-bold text-sm outline-none focus:border-rose-500" />
                            </div>
                            <div>
                               <label className="block text-[10px] font-black text-slate-500 mb-1 uppercase tracking-widest">บันทึกความจำ / รายละเอียด</label>
                               <textarea placeholder="คำอธิบายเพิ่มเติม..." value={houseTypeForm.memo} onChange={(e) => setHouseTypeForm({...houseTypeForm, memo: e.target.value})} rows={3} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 font-bold text-sm outline-none focus:border-rose-500 resize-none" />
                            </div>
                            
                            <div className="flex gap-2 pt-2">
                               {isEditingType && (
                                  <button onClick={() => { setHouseTypeForm({ id: '', type_name: '', memo: '' }); setIsEditingType(false); }} className="bg-slate-100 text-slate-500 px-3 py-2 rounded-xl font-bold text-xs hover:bg-slate-200">ยกเลิก</button>
                                )}
                               <button onClick={handleSaveHouseType} disabled={isSubmitting} className="flex-1 bg-rose-600 text-white font-black py-2.5 rounded-xl text-xs shadow-md hover:bg-rose-700 flex justify-center items-center gap-1.5">
                                  {isSubmitting ? <Loader2 className="animate-spin" size={14}/> : (isEditingType ? 'บันทึกการแก้ไข' : 'เพิ่มแบบบ้าน')}
                               </button>
                            </div>
                         </div>
                      </div>

                      {/* 📋 ฝั่งขวา: รายชื่อตารางแบบบ้านที่มีอยู่เดิม */}
                      <div className="bg-white p-5 sm:p-6 rounded-2xl border border-slate-200 shadow-md lg:col-span-2">
                         <h3 className="font-black text-slate-800 text-lg mb-4 uppercase italic tracking-tight border-b pb-2 flex items-center gap-1.5"><Building size={18} className="text-slate-400"/> แบบบ้านทั้งหมด ({houseTypes.length})</h3>
                         
                         <div className="space-y-2 max-h-[450px] overflow-y-auto pr-1 custom-scrollbar">
                            {houseTypes.map(t => (
                               <div key={t.id} className="bg-slate-50 p-3 rounded-xl border border-slate-200/60 flex items-center justify-between gap-4 group hover:border-rose-200 transition-colors">
                                  <div className="min-w-0">
                                     <h4 className="font-black text-slate-800 text-sm sm:text-base truncate">{t.type_name}</h4>
                                     <p className="text-[11px] text-slate-400 font-medium truncate mt-0.5">{t.memo || 'ไม่มีรายละเอียดเพิ่มเติม'}</p>
                                  </div>
                                  <div className="flex gap-1.5 shrink-0">
                                     <button 
                                        onClick={() => {
                                           setHouseTypeForm({ id: t.id, type_name: t.type_name, memo: t.memo || '' });
                                           setIsEditingType(true);
                                        }} 
                                        className="bg-white border border-slate-200 text-slate-600 p-2 rounded-lg font-bold text-xs hover:bg-slate-100 hover:text-blue-600 transition-colors shadow-sm"
                                        title="แก้ไขชื่อและรายละเอียด"
                                     >
                                        แก้ไขชื่อ
                                     </button>
                                  </div>
                               </div>
                            ))}
                         </div>
                      </div>
                   </div>
                 </div>
               )}
               {/* 🌟 หน้าจอ ADMIN: จัดการงวดงาน (TASK TEMPLATES) 🌟 */}
               {view === 'admin-tasks' && isAdmin && (
                 <div className="animate-in slide-in-from-bottom duration-300 max-w-5xl mx-auto mt-4 sm:mt-8 px-4 sm:px-0">
                   <button onClick={() => setView('dashboard')} className="mb-4 sm:mb-6 text-xs sm:text-base font-bold text-blue-600 flex items-center gap-1.5">← BACK TO DASHBOARD</button>
                   
                   <div className="bg-white p-6 sm:p-10 rounded-2xl sm:rounded-[2.5rem] border border-slate-200 shadow-xl">
                      <h2 className="text-xl sm:text-3xl font-black text-slate-800 uppercase italic tracking-tight mb-6 flex items-center gap-2"><ClipboardList className="text-rose-600"/> Manage Tasks</h2>
                      
                      {/* Dropdown เลือกแบบบ้าน */}
                      <div className="mb-8">
                         <label className="block text-xs font-black text-slate-500 mb-2 uppercase tracking-widest">เลือกแบบบ้านที่ต้องการตั้งค่างวดงาน</label>
                         <select 
                            value={editingTaskHouseId} 
                            onChange={(e) => {
                               setEditingTaskHouseId(e.target.value);
                               setTaskForm({ id: '', task_name: '', task_order: '' });
                               setIsEditingTask(false);
                            }} 
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 font-bold text-slate-700 outline-none focus:border-rose-500"
                         >
                            <option value="">-- กรุณาเลือกแบบบ้าน --</option>
                            {houseTypes.map(t => <option key={t.id} value={t.id}>{t.type_name}</option>)}
                         </select>
                      </div>

                      {editingTaskHouseId && (
                         <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 border-t border-slate-100 pt-8">
                            
                            {/* ฝั่งซ้าย: ฟอร์มเพิ่ม/แก้ไขงวดงาน */}
                            <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200 h-fit">
                               <h3 className="font-black text-slate-800 text-base mb-4 uppercase italic tracking-tight flex items-center gap-1.5 text-rose-600">
                                  {isEditingTask ? '📝 แก้ไขงวดงาน' : '➕ เพิ่มงวดงานใหม่'}
                               </h3>
                               <div className="space-y-4">
                                  <div>
                                     <label className="block text-[10px] font-black text-slate-500 mb-1 uppercase tracking-widest">ลำดับงาน (ตัวเลข)</label>
                                     <input type="number" placeholder="เช่น 1, 2, 3..." value={taskForm.task_order} onChange={(e) => setTaskForm({...taskForm, task_order: e.target.value})} className="w-full border border-slate-300 rounded-xl px-3 py-2.5 font-bold text-sm outline-none focus:border-rose-500" />
                                  </div>
                                  <div>
                                     <label className="block text-[10px] font-black text-slate-500 mb-1 uppercase tracking-widest">ชื่องวดงาน</label>
                                     <textarea placeholder="เช่น งานเทฐานราก, งานก่อผนัง..." value={taskForm.task_name} onChange={(e) => setTaskForm({...taskForm, task_name: e.target.value})} rows={2} className="w-full border border-slate-300 rounded-xl px-3 py-2.5 font-bold text-sm outline-none focus:border-rose-500 resize-none" />
                                  </div>
                                  <div className="flex gap-2 pt-2">
                                     {isEditingTask && (
                                        <button onClick={() => { setTaskForm({ id: '', task_name: '', task_order: '' }); setIsEditingTask(false); }} className="bg-slate-200 text-slate-600 px-3 py-2 rounded-xl font-bold text-xs hover:bg-slate-300">ยกเลิก</button>
                                     )}
                                     <button onClick={handleSaveTask} disabled={isSubmitting} className="flex-1 bg-rose-600 text-white font-black py-2.5 rounded-xl text-xs shadow-md hover:bg-rose-700 flex justify-center items-center gap-1.5">
                                        {isSubmitting ? <Loader2 className="animate-spin" size={14}/> : (isEditingTask ? 'บันทึกการแก้ไข' : 'เพิ่มงาน')}
                                     </button>
                                  </div>
                               </div>
                            </div>

                            {/* ฝั่งขวา: รายการงวดงานทั้งหมด */}
                            <div className="lg:col-span-2 space-y-2 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
                               {taskTemplates.filter(t => t.house_type_id === editingTaskHouseId).length === 0 ? (
                                  <p className="text-center text-slate-400 italic py-10 font-bold">ยังไม่มีงวดงานในแบบบ้านนี้</p>
                               ) : (
                                  taskTemplates
                                    .filter(t => t.house_type_id === editingTaskHouseId)
                                    .sort((a, b) => a.task_order - b.task_order)
                                    .map(task => (
                                     <div key={task.id} className="bg-white p-3 rounded-xl border border-slate-200 flex items-center justify-between gap-4 group hover:border-blue-300 transition-colors shadow-sm">
                                        <div className="flex items-center gap-3 min-w-0 flex-1">
                                           <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center font-black text-slate-500 shrink-0 text-xs">
                                              {task.task_order}
                                           </div>
                                           <h4 className="font-bold text-slate-700 text-sm truncate">{task.task_name}</h4>
                                        </div>
                                        <div className="flex gap-1.5 shrink-0 opacity-100 lg:opacity-0 group-hover:opacity-100 transition-opacity">
                                           <button onClick={() => { setTaskForm({ id: task.id, task_name: task.task_name, task_order: task.task_order }); setIsEditingTask(true); }} className="p-2 bg-slate-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors"><Settings size={16}/></button>
                                           <button onClick={() => handleDeleteTask(task)} className="p-2 bg-slate-50 text-rose-500 rounded-lg hover:bg-rose-100 transition-colors"><Trash2 size={16}/></button>
                                        </div>
                                     </div>
                                  ))
                               )}
                            </div>

                         </div>
                      )}
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
                 {(isAdmin || isProjectPlanner || isQC || isSiteEngineer || isOwner || isForeman) && (
                    <button onClick={() => setView('reports')} className={`flex flex-col items-center p-2 rounded-xl w-16 ${view === 'reports' ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}>
                       <PieChart size={20} className={view === 'reports' ? 'fill-blue-100' : ''}/>
                       <span className="text-[9px] font-black mt-1">รายงาน</span>
                    </button>
                 )}
                 {/* 🌟 ปุ่มออกจากระบบบนมือถือ (เพิ่มใหม่ตามสั่ง) 🌟 */}
                    <button 
                      onClick={handleLogout} 
                      className="flex flex-col items-center justify-center flex-1 py-2 font-bold text-[10px] text-rose-500 hover:text-rose-700 transition-colors"
                    >
                      <LogOut size={20} className="text-rose-500" />
                      ออกระบบ
                    </button>
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
              {/* 🔴 DEFECT MODAL (Punch List) - แบบแนบรูปได้ */}
              {defectModal.isOpen && (
                <div className="fixed inset-0 z-[9999] bg-slate-900/70 backdrop-blur-sm flex justify-center items-center p-4 sm:p-0">
                  <div className="bg-white rounded-2xl sm:rounded-[2rem] shadow-2xl w-full max-w-lg overflow-hidden flex flex-col h-[85vh] sm:max-h-[85vh] animate-in zoom-in-95 duration-200 border border-slate-100">
                    
                    {/* ส่วนหัว */}
                    <div className="bg-gradient-to-r from-rose-600 to-rose-700 p-4 sm:p-6 flex justify-between items-center text-white shrink-0 shadow-sm">
                      <div>
                        <h3 className="font-black text-lg sm:text-xl flex items-center gap-2 tracking-tight"><ShieldAlert size={22}/> รายการ Defect / แจ้งซ่อม</h3>
                        <p className="text-rose-100 text-xs sm:text-sm font-bold mt-1 tracking-widest">แปลง: {defectModal.plotId} | งาน: {defectModal.task?.task_name}</p>
                      </div>
                      <button onClick={() => { setDefectModal({ isOpen: false, task: null, plotId: '' }); setDefectFiles([]); setNewDefectText(''); }} className="p-2 bg-white/10 hover:bg-white/20 rounded-full transition-colors text-white"><X size={20} /></button>
                    </div>
                    
                    {/* รายการ Defect */}
                    <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-slate-50 space-y-3 custom-scrollbar">
                      {defects.filter(d => d.plot_id === defectModal.plotId && d.task_id === defectModal.task?.id).length === 0 ? (
                        <div className="text-center text-slate-400 py-12 font-bold flex flex-col items-center">
                          <CheckCircle size={44} className="text-slate-300 mb-3 opacity-60" />
                          🎉 สภาพเนื้องานเรียบร้อยดี<br/><span className="text-xs text-slate-400 font-medium mt-1">ยังไม่มีรายการแจ้งซ่อมในหน้านี้</span>
                        </div>
                      ) : (
                        defects.filter(d => d.plot_id === defectModal.plotId && d.task_id === defectModal.task?.id).map(defect => (
                          <div key={defect.id} className={`p-3.5 sm:p-4 rounded-2xl border ${defect.status === 'pending' ? 'bg-white border-rose-200 shadow-sm' : 'bg-emerald-50/60 border-emerald-200'}`}>
                            <div className="flex justify-between items-start gap-2 mb-2">
                              <span className={`font-bold text-sm sm:text-base leading-snug pr-2 ${defect.status === 'pending' ? 'text-slate-800' : 'text-slate-500 line-through'}`}>{defect.description || 'ไม่มีคำอธิบาย'}</span>
                              <span className={`text-[10px] sm:text-xs font-black px-2.5 py-1 rounded-lg whitespace-nowrap shrink-0 ${defect.status === 'pending' ? 'bg-rose-100 text-rose-600' : 'bg-emerald-100 text-emerald-700'}`}>
                                {defect.status === 'pending' ? 'รอแก้ไข' : '✅ แก้แล้ว'}
                              </span>
                            </div>
                            
                            {/* รูปภาพ Defect ถ้ามี */}
                            {defect.image_url && (
                                <div className={`grid gap-2 mb-3 ${defect.image_url.split(',').filter(u => u.trim() !== '').length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                                    {defect.image_url.split(',').filter(u => u.trim() !== '').map((url, i) => (
                                        <img key={i} src={url.trim()} onClick={() => setFullImageUrl(url.trim())} className="w-full aspect-video object-cover rounded-xl cursor-zoom-in border border-slate-100 shadow-sm hover:opacity-90" alt="Defect" /> 
                                    ))}
                                </div>
                            )}

                            <div className="flex justify-between items-center text-[10px] sm:text-xs text-slate-500 mt-2 border-t border-slate-100 pt-2.5">
                              <span className="flex items-center gap-1 font-bold text-slate-400"><HardHat size={12}/> ผู้แจ้ง: {defect.reported_by}</span>
                              {defect.status === 'pending' && ['QC', 'Foreman', 'Site Engineer', 'Admin'].includes(currentUserRole) && (
                                <button onClick={async () => {
                                  await supabase.from('defects').update({ status: 'resolved' }).eq('id', defect.id);
                                  const { data } = await supabase.from('defects').select('*'); setDefects(data || []);
                                }} className="bg-emerald-500 hover:bg-emerald-600 text-white px-3 py-1.5 rounded-lg font-bold transition-colors shadow-sm flex items-center gap-1">
                                  <CheckCircle size={14} /> ซ่อมเสร็จแล้ว
                                </button>
                              )}
                            </div>
                          </div>
                        ))
                      )}
                    </div>

                    {/* ช่องพิมพ์และแนบรูป */}
                    {['QC', 'Foreman', 'Site Engineer', 'Admin'].includes(currentUserRole) && (
                      <div className="p-3 sm:p-4 border-t border-slate-200 bg-white shrink-0">
                        {/* โซนแสดงรูปที่เลือก */}
                        {defectFiles.length > 0 && (
                            <div className="flex gap-2 sm:gap-3 mb-2 overflow-x-auto pb-1">
                                {defectFiles.map((file, idx) => (
                                    <div key={idx} className="relative shrink-0 animate-in fade-in zoom-in duration-300">
                                        <img src={file.previewUrl} className="w-12 h-12 sm:w-14 sm:h-14 object-cover rounded-xl border-2 border-rose-500 shadow-sm" />
                                        <button onClick={() => { const n = [...defectFiles]; n.splice(idx, 1); setDefectFiles(n); }} className="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full p-0.5 sm:p-1 border-2 border-white hover:bg-red-600"><X size={10} /></button>
                                    </div>
                                ))}
                            </div>
                        )}
                        <div className="flex items-center gap-2">
                          <label className="text-slate-400 hover:text-rose-600 p-2.5 sm:p-3 rounded-xl bg-slate-100 cursor-pointer shadow-sm active:scale-90 transition-transform">
                              <Camera size={isMobileLayout ? 20 : 22} />
                              <input type="file" multiple accept="image/*" className="hidden" onChange={(e) => { const files = Array.from(e.target.files).map(f => ({ file: f, previewUrl: URL.createObjectURL(f) })); setDefectFiles([...defectFiles, ...files].slice(0, 4)); }} />
                          </label>
                          <input 
                            type="text" value={newDefectText} onChange={(e) => setNewDefectText(e.target.value)}
                            placeholder="ระบุจุดบกพร่อง..." 
                            className="flex-1 bg-slate-50 border border-slate-300 rounded-xl px-3 sm:px-4 py-2.5 sm:py-3 text-xs sm:text-sm font-bold focus:border-rose-500 focus:bg-white outline-none transition-all"
                            onKeyDown={(e) => { if (e.key === 'Enter') handleSendDefect(); }}
                          />
                          <button 
                            onClick={handleSendDefect} disabled={isSubmittingDefect || (!newDefectText.trim() && defectFiles.length === 0)}
                            className="bg-rose-600 text-white px-3 sm:px-5 py-2.5 sm:py-3 rounded-xl hover:bg-rose-700 transition-colors shadow-md flex items-center justify-center gap-1.5 font-bold text-xs sm:text-sm disabled:opacity-50"
                          >
                            {isSubmittingDefect ? <Loader2 className="animate-spin" size={16}/> : <><span className="hidden sm:inline">ส่งเรื่อง</span><Send size={14} /></>}
                          </button>
                        </div>
                      </div>
                    )}
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
              {/* 📺 PRESENTATION MODAL (ห้องประชุม) */}
              {isPresentationOpen && plots.length > 0 && (() => {
                 const currentPlot = plots[currentSlideIndex];
                 
                 // 🌟 คำนวณความคืบหน้าและสถานะ (แก้บั๊ก getPlotStatus)
                 const plotUpdates = allUpdatesRecord.filter(u => u.plot_id === currentPlot.id).sort((a,b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
                 const actualProgress = plotUpdates.length > 0 ? Math.max(...plotUpdates.map(u => Number(u.progress) || 0)) : 0;
                 let sLabel = 'รอดำเนินการ'; let sStatus = 'pending';
                 if (actualProgress >= 100) { sLabel = 'เสร็จสมบูรณ์'; sStatus = 'completed'; }
                 else if (actualProgress > 0) { sLabel = 'กำลังดำเนินการ'; sStatus = 'on-track'; }
                 const statusInfo = { actual: actualProgress, label: sLabel, status: sStatus };
                 const latestUpdate = plotUpdates.length > 0 ? plotUpdates[0] : null;
                 
                 let plotImages = [];
                 plotUpdates.forEach(u => {
                    if (u.image_url) {
                       const urls = u.image_url.split(',').filter(url => url.trim() !== '');
                       
                      // 🌟 ระบบค้นหาช่างฉบับปรับปรุงใหม่ ดึงชื่อช่างตรงตามงวดงานจริง 100%
                       let contractorName = 'ช่างประจำแปลง';
                       
                       if (u.action) {
                          // สเต็ป 1: หาจากชื่อที่ตรงกันหรือใกล้เคียงที่สุดในแปลงนี้ก่อน
                          const matchedAssign = assignments.slice().reverse().find(a => 
                             a.plot_id === currentPlot.id && a.task_name &&
                             (a.task_name === u.action || u.action.includes(a.task_name) || a.task_name.includes(u.action))
                          );
                          
                          if (matchedAssign) {
                             contractorName = matchedAssign.contractor_name;
                          } else {
                             // สเต็ป 2: ถ้ายังไม่เจอ (เพราะชื่อยาว/สั้นไป) ให้ดักจับด้วยคำสำคัญหลักๆ ในชื่องาน (เช่น โครงสร้าง, ฐานราก, ผัง)
                             const plotContracts = assignments.filter(a => a.plot_id === currentPlot.id);
                             const keywordFind = plotContracts.find(a => {
                                const cleanAction = u.action.replace(/\s+/g, '');
                                const cleanTask = a.task_name ? a.task_name.replace(/\s+/g, '') : '';
                                return cleanAction.includes(cleanTask) || cleanTask.includes(cleanAction) ||
                                       (cleanAction.includes('ฐานราก') && cleanTask.includes('ฐานราก')) ||
                                       (cleanAction.includes('โครงสร้าง') && cleanTask.includes('โครงสร้าง'));
                             });
                             if (keywordFind) contractorName = keywordFind.contractor_name;
                          }
                       }

                       urls.forEach(url => { 
                          if (plotImages.length < 4) {
                             plotImages.push({ 
                                url: url.trim(), 
                                date: u.created_at, 
                                action: u.action || 'อัปเดตสถานะงาน',
                                contractor: contractorName
                             }); 
                          }
                       });
                    }
                 });

                 // 🌟 จัดกลุ่มรูปภาพตามชื่องาน (Action) เพื่อให้แสดงกรอบแยกงานอย่างถูกต้อง
                 const groupedImages = plotImages.reduce((acc, img) => {
                    if (!acc[img.action]) acc[img.action] = { contractor: img.contractor, images: [] };
                    acc[img.action].images.push(img);
                    return acc;
                 }, {});
                 
                 const foremanAssignment = assignments.slice().reverse().find(a => a.plot_id === currentPlot.id);
                 const foremanName = foremanAssignment ? foremanAssignment.contractor_name : (currentPlot.foreman || 'ไม่ระบุ');

                 return (
                    <div className="fixed inset-0 z-[99999] bg-slate-900 flex flex-col animate-in fade-in duration-300">
                       {/* Top Bar */}
                       <div className="flex justify-between items-center p-4 sm:p-5 bg-slate-950 border-b border-slate-800 text-white shadow-md shrink-0">
                          <div className="flex items-center gap-4">
                             <div className="bg-indigo-600 text-white font-black px-4 py-2 rounded-xl text-lg sm:text-xl shadow-[0_0_15px_rgba(79,70,229,0.5)]">
                                แปลง: {currentPlot.id}
                             </div>
                             <div className="hidden sm:block text-slate-300 text-sm font-bold tracking-wider">
                                โครงการ: {selectedProject?.name} <span className="mx-2">|</span> รายงานประจำสัปดาห์
                             </div>
                          </div>
                          <div className="flex items-center gap-3 sm:gap-6">
                             <span className="text-slate-400 font-bold text-sm bg-slate-800 px-3 py-1.5 rounded-lg">สไลด์ {currentSlideIndex + 1} / {plots.length}</span>
                             <button onClick={() => setIsPresentationOpen(false)} className="bg-rose-500 hover:bg-rose-600 p-2 sm:px-4 sm:py-2 rounded-xl text-white font-bold transition flex items-center gap-2 shadow-sm">
                                <X size={20} /> <span className="hidden sm:inline">ปิด (Esc)</span>
                             </button>
                          </div>
                       </div>

                       {/* Main Content Area */}
                       <div className="flex-1 overflow-hidden flex items-center justify-center p-4 sm:p-8 relative w-full h-full">
                          {/* Navigation Buttons */}
                          <button onClick={() => setCurrentSlideIndex(p => Math.max(p - 1, 0))} disabled={currentSlideIndex === 0} className="absolute left-2 sm:left-6 p-3 sm:p-5 bg-white/10 hover:bg-white/20 text-white rounded-full disabled:opacity-0 transition z-50 backdrop-blur-md">
                             <ChevronRight size={32} className="rotate-180" />
                          </button>
                          <button onClick={() => setCurrentSlideIndex(p => Math.min(p + 1, plots.length - 1))} disabled={currentSlideIndex === plots.length - 1} className="absolute right-2 sm:right-6 p-3 sm:p-5 bg-white/10 hover:bg-white/20 text-white rounded-full disabled:opacity-0 transition z-50 backdrop-blur-md">
                             <ChevronRight size={32} />
                          </button>

                          {/* Presentation Slide Card (16:9) */}
                          <div className="bg-slate-50 w-full max-w-7xl aspect-[4/3] sm:aspect-[16/9] rounded-2xl sm:rounded-[2rem] shadow-2xl flex flex-col sm:flex-row overflow-hidden border border-slate-700 max-h-full">
                             
{/* ✅ โค้ดใหม่ Left Panel (วางแทนที่ของเดิม) */}
                             <div className="w-full sm:w-5/12 bg-white p-6 sm:p-8 flex flex-col justify-between border-b sm:border-b-0 sm:border-r border-slate-200 shrink-0 overflow-y-auto custom-scrollbar">
                                <div>
                                   <div className="flex justify-between items-start mb-4">
                                      <div>
                                         <h2 className="text-4xl sm:text-5xl font-black text-slate-800 mb-2">{currentPlot.id}</h2>
                                         <div className={`inline-block px-4 py-1.5 rounded-full font-black text-sm sm:text-base shadow-sm ${statusInfo.status === 'delayed' ? 'bg-rose-100 text-rose-700' : statusInfo.status === 'completed' ? 'bg-emerald-100 text-emerald-700' : statusInfo.status === 'ahead' ? 'bg-indigo-100 text-indigo-700' : statusInfo.status === 'on-track' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-700'}`}>
                                            {statusInfo.label}
                                         </div>
                                      </div>
                                      <div className="text-right">
                                         <p className="text-xs sm:text-sm font-bold text-slate-400 uppercase tracking-widest mb-1">ความคืบหน้า</p>
                                         <div className="text-5xl sm:text-6xl font-black text-blue-600 tracking-tighter">{statusInfo.actual}%</div>
                                      </div>
                                   </div>
                                   
                                   <hr className="my-4 border-slate-100 border-[1.5px]" />
                                   
                                   <div className="space-y-5">
                                      {/* 1. แสดงชื่อผู้ควบคุมงาน (Foreman หลักประจำบ้านหลังนี้) */}
                                      <div className="bg-slate-50 border border-slate-200/60 p-3.5 rounded-xl">
                                         <h4 className="text-xs font-black text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-1.5"><Users size={14} className="text-slate-400"/> ผู้ควบคุมงานโครงการ (Foreman)</h4>
                                         <p className="font-black text-slate-800 text-base sm:text-lg">
                                            {currentPlot.foreman || 'ไม่ระบุผู้ควบคุมงานหลัก'}
                                         </p>
                                      </div>

                                      {/* 2. แสดงรายการงานที่มีการอัปเดตสัปดาห์นี้ พร้อมช่างประจำงวดงานนั้นๆ */}
                                      <div>
                                         <h4 className="text-xs font-black text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5"><Activity size={14} className="text-indigo-500"/> รายงานสถานะงานรายงวดในแปลงนี้</h4>
                                         
                                         {plotUpdates.length > 0 ? (
                                            <div className="space-y-3 max-h-[35vh] overflow-y-auto pr-1 custom-scrollbar">
                                               {/* หา Uniq Task Name ที่มีการอัปเดตในสัปดาห์นี้ */}
                                               {Array.from(new Set(plotUpdates.map(u => u.action))).map((taskAction, tIdx) => {
                                                  // ดึงข้อมูลอัปเดตล่าสุดของงานนี้
                                                  const specificTaskUpdates = plotUpdates.filter(u => u.action === taskAction);
                                                  const latestTaskUpdate = specificTaskUpdates[0];
                                                  
                                                  // ค้นหาช่างที่ถูกมอบหมายในงานย่อยชิ้นนี้
                                                  const matchedAssign = assignments.slice().reverse().find(a => a.plot_id === currentPlot.id && a.task_name === taskAction);
                                                  const contractorName = matchedAssign ? matchedAssign.contractor_name : 'ยังไม่มอบหมายช่าง';

                                                  return (
                                                     <div key={tIdx} className="bg-white border border-slate-200 p-3.5 rounded-xl shadow-sm hover:border-indigo-200 transition-colors">
                                                        <div className="flex justify-between items-start gap-2 mb-1.5">
                                                           <span className="font-black text-slate-800 text-sm sm:text-base">{taskAction}</span>
                                                           <span className="bg-blue-50 text-blue-600 text-xs font-black px-2 py-0.5 rounded-md">{latestTaskUpdate.progress}%</span>
                                                        </div>
                                                        
                                                        <div className="text-xs font-medium text-slate-500 mb-2 bg-slate-50 py-1 px-2 rounded-md w-fit flex items-center gap-1">
                                                           <HardHat size={12} className="text-amber-500" /> 
                                                           <span>ช่างผู้รับผิดชอบ: <strong className="text-slate-700 font-bold">{contractorName}</strong></span>
                                                        </div>

                                                        <p className="text-xs text-slate-600 italic pl-2 border-l-2 border-indigo-400 font-medium leading-relaxed bg-indigo-50/20 py-1 rounded-r-md">
                                                           "{latestTaskUpdate.text_content}"
                                                        </p>
                                                        <p className="text-[10px] text-slate-400 font-bold mt-1.5 text-right">
                                                           อัปเดตโดย {latestTaskUpdate.user_name} ({new Date(latestTaskUpdate.created_at).toLocaleDateString('th-TH')})
                                                        </p>
                                                     </div>
                                                  );
                                               })}
                                            </div>
                                         ) : (
                                            <div className="bg-slate-50 border border-slate-200 p-4 rounded-xl text-slate-400 italic text-sm font-medium flex items-center gap-2">
                                               <Clock size={16}/> สัปดาห์นี้ยังไม่มีบันทึกรายงานสถานะงาน
                                            </div>
                                         )}
                                      </div>
                                   </div>
                                </div>

                                <div className="mt-4 pt-4 border-t border-slate-100 shrink-0">
                                   <p className="text-xs text-slate-400 font-bold flex items-center justify-between">
                                      <span>สร้างเมื่อ: {new Date().toLocaleDateString('th-TH')}</span>
                                      <span className="flex items-center gap-1 text-slate-300"><Monitor size={12}/> BuildTrack Presentation</span>
                                   </p>
                                </div>
                             </div>

                            {/* Right Panel: Image Grid (จัดกลุ่มตามงานและช่าง) */}
                             <div className="w-full sm:w-7/12 bg-slate-100 p-4 sm:p-6 flex flex-col relative overflow-y-auto custom-scrollbar">
                                <h3 className="font-black text-slate-700 mb-4 flex items-center gap-2 text-xl sm:text-2xl shrink-0"><Camera className="text-slate-500"/> ภาพถ่าย 4 รูปล่าสุดแยกตามงวดงาน</h3>
                                {plotImages.length > 0 ? (
                                   <div className="flex-1 flex flex-col gap-4">
                                      {Object.entries(groupedImages).map(([action, data]: [string, any], idx) => (
                                         <div key={idx} className="bg-white p-3 sm:p-4 rounded-2xl shadow-sm border border-slate-200">
                                            {/* หัวข้อ: ชื่องาน + ชื่อช่างประจำงานชิ้นนั้น */}
                                            {/* ✅ โค้ดใหม่: รวมชื่องานย่อยและชื่อช่างไว้ในแถบเดียวกันตามที่ลูกพี่วงไว้ */}
                                            <div className="flex items-center justify-between mb-3 border-b border-slate-100 pb-2">
                                               {/* ฝั่งซ้ายโชว์ไอคอนและลำดับกลุ่ม */}
                                               <span className="font-black text-slate-400 text-xs sm:text-sm border-l-4 border-rose-500 pl-2">
                                                  กลุ่มงานที่ {idx + 1}
                                               </span>
                                               
                                               {/* ฝั่งขวา: ป้ายชื่อป้ายใหญ่แสดง [ชื่องาน + ช่างผู้รับผิดชอบ] คู่กัน */}
                                               <span className="bg-amber-50 border border-amber-200 text-amber-800 text-[10px] sm:text-xs font-black px-3 py-1.5 rounded-xl flex flex-wrap items-center gap-2 max-w-[85%] shadow-sm justify-end">
                                                  <div className="flex items-center gap-1 bg-amber-200/50 px-2 py-0.5 rounded-md border border-amber-300/60 text-slate-800">
                                                     <Activity size={12} className="text-indigo-600 animate-pulse"/>
                                                     <span>งาน: <strong className="font-black">{action}</strong></span>
                                                  </div>
                                                  <div className="flex items-center gap-1 bg-white px-2 py-0.5 rounded-md border border-slate-200 text-amber-700">
                                                     <HardHat size={12} className="text-amber-500"/>
                                                     <span>ผู้รับเหมา: <strong className="font-black">{data.contractor}</strong></span>
                                                  </div>
                                               </span>
                                            </div>
                                            
                                            {/* กริดรูปภาพที่สัมพันธ์กับงานนี้ */}
                                            <div className={`grid gap-2 sm:gap-3 ${data.images.length === 1 ?
                                             'grid-cols-1' : 'grid-cols-2'}`}>
                                               {data.images.map((img: any, i: number) => (
                                                   <div key={i} className="relative bg-black rounded-xl overflow-hidden aspect-video group shadow-sm border border-slate-100">
                                                     {/* ✅ เติมคำสั่ง onClick และ cursor-zoom-in เพื่อให้กดซูมภาพได้เหมือนจุดอื่นๆ ในแอปครับ */}
                                                     <img 
                                                        src={img.url} 
                                                        onClick={() => setFullImageUrl(img.url)} 
                                                        className="w-full h-full object-cover opacity-90 transition-transform duration-700 group-hover:scale-105 group-hover:opacity-100 cursor-zoom-in" 
                                                        alt={action} 
                                                     />
                                                     
                                                     {/* 🌟 ป้ายชื่ออัปเดตงาน ทับอยู่บนรูปภาพ */}
                                                     <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 to-transparent p-2.5 pt-8">
                                                        <p className="text-white font-black text-[10px] sm:text-xs drop-shadow truncate mb-0.5">📂 {img.action}</p>
                                                        <p className="text-white/70 font-bold text-[9px] sm:text-[11px] text-right">{new Date(img.date).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })} น.</p>
                                                     </div>
                                                  </div>
                                               ))}
                                            </div>
                                         </div>
                                      ))}
                                   </div>
                                ) : (
                                   <div className="flex-1 flex flex-col items-center justify-center bg-white/50 rounded-[2rem] border-2 border-dashed border-slate-300 min-h-[300px]">
                                      <ImageIcon size={80} className="text-slate-300 mb-4" />
                                      <p className="text-slate-500 font-black text-xl">ยังไม่มีรูปถ่ายความคืบหน้า</p>
                                      <p className="text-slate-400 font-medium text-sm mt-1">โฟร์แมนต้องอัปโหลดรูปผ่านช่องแชทรายงานก่อน</p>
                                   </div>
                                )}
                              </div>

                          </div>
                       </div>
                    </div>
                 );
              })()}
{/* 🖨️ 🌟 ระบบจัดหน้า A4 สำหรับพิมพ์ 🌟 🖨️ */}
        <div id="printable-a4" className="hidden print:block absolute top-0 left-0 w-full bg-white z-[9999] text-black">
           
           {/* 🖨️ พิมพ์รูปถ่ายตั้งเบิก (ถ้าเปิด Modal รูป) */}
           {exportModalOpen && imageChunks.map((chunk, pageIdx) => (
             <div key={pageIdx} style={{ boxSizing: 'border-box', pageBreakAfter: pageIdx === imageChunks.length - 1 ? 'auto' : 'always', breakAfter: pageIdx === imageChunks.length - 1 ? 'auto' : 'page', display: 'flex', flexDirection: 'column', paddingBottom: '10mm' }}>
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

           {/* 🖨️ พิมพ์รายงาน Daily Activity (ถ้าเปิด Modal Activity) */}
           {activityReportOpen && (() => {
                const targetDate = activityReportDate;
                const activities = [];
                
                allUpdatesRecord.filter(u => new Date(u.created_at).toLocaleDateString('en-CA') === targetDate && u.role !== 'Admin').forEach(u => {
                    const task = taskTemplates.find(t => t.id === u.task_template_id);
                    activities.push({ time: new Date(u.created_at).getTime(), timeStr: new Date(u.created_at).toLocaleTimeString('th-TH', {hour:'2-digit', minute:'2-digit'}), user: u.user_name, role: u.role, plot: u.plot_id, taskName: task ? task.task_name : 'อัปเดตงาน', action: u.action, detail: u.text_content || '-', type: 'update' });
                });
                
                defects.filter(d => new Date(d.created_at).toLocaleDateString('en-CA') === targetDate).forEach(d => {
                    const user = allUsers.find(u => u.username === d.reported_by);
                    if (user?.role === 'Admin') return;
                    const task = taskTemplates.find(t => t.id === d.task_id);
                    activities.push({ time: new Date(d.created_at).getTime(), timeStr: new Date(d.created_at).toLocaleTimeString('th-TH', {hour:'2-digit', minute:'2-digit'}), user: d.reported_by, role: user ? user.role : 'Unknown', plot: d.plot_id, taskName: task ? task.task_name : 'ไม่ระบุงาน', action: 'แจ้ง Defect / ซ่อม', detail: d.description || 'แนบรูปภาพ', type: 'defect' });
                });
                
                activities.sort((a, b) => a.time - b.time); // พิมพ์เรียงตามเวลาเช้าไปเย็น

                return (
                    <div style={{ padding: '10mm', boxSizing: 'border-box', fontFamily: 'sans-serif' }}>
                        <div style={{ textAlign: 'center', marginBottom: '20px', borderBottom: '2px solid black', paddingBottom: '10px' }}>
                            <h1 style={{ fontSize: '20pt', fontWeight: 'bold', margin: '0', textTransform: 'uppercase' }}>Daily Activity Report</h1>
                            <p style={{ fontSize: '12pt', margin: '5px 0 0 0', color: '#475569' }}>
                               รายงานการปฏิบัติงานประจำวัน: {new Date(targetDate).toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })}
                            </p>
                        </div>
                      {/* 🌟 แสดงตารางแยกตามบุคคล 🌟 */}
                        {activities.length === 0 ? (
                            <div style={{ padding: '20px', textAlign: 'center', color: '#94a3b8', border: '1px solid #cbd5e1' }}>ไม่มีรายการบันทึกในวันนี้</div>
                        ) : (
                            Object.entries(activities.reduce((acc: any, curr: any) => {
                                if (!acc[curr.user]) acc[curr.user] = { role: curr.role, items: [] };
                                acc[curr.user].items.push(curr);
                                return acc;
                            }, {})).map(([user, data]: [string, any], idx) => (
                                <div key={idx} style={{ marginBottom: '20px', pageBreakInside: 'avoid' }}>
                                    {/* แถบหัวข้อชื่อพนักงาน */}
                                    <div style={{ backgroundColor: '#1e293b', color: 'white', padding: '10px 15px', borderTopLeftRadius: '8px', borderTopRightRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <h3 style={{ margin: 0, fontSize: '12pt' }}>👤 {user}</h3>
                                        <span style={{ fontSize: '9pt', fontWeight: 'bold', backgroundColor: 'rgba(255,255,255,0.2)', padding: '3px 8px', borderRadius: '4px' }}>{data.role}</span>
                                    </div>
                                    
                                    {/* ตารางงานของพนักงานคนนั้น */}
                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '10pt', border: '1px solid #cbd5e1', borderTop: 'none' }}>
                                        <thead>
                                            <tr style={{ backgroundColor: '#f8fafc' }}>
                                                <th style={{ padding: '8px', border: '1px solid #cbd5e1', width: '60px', textAlign: 'center' }}>เวลา</th>
                                                <th style={{ padding: '8px', border: '1px solid #cbd5e1', width: '80px', textAlign: 'center' }}>แปลง</th>
                                                <th style={{ padding: '8px', border: '1px solid #cbd5e1', width: '120px', textAlign: 'left' }}>การกระทำ</th>
                                                <th style={{ padding: '8px', border: '1px solid #cbd5e1', textAlign: 'left' }}>รายละเอียดงาน</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {data.items.map((act: any, i: number) => (
                                                <tr key={i}>
                                                    <td style={{ padding: '8px', border: '1px solid #cbd5e1', textAlign: 'center' }}>{act.timeStr}</td>
                                                    <td style={{ padding: '8px', border: '1px solid #cbd5e1', textAlign: 'center', fontWeight: 'bold' }}>{act.plot}</td>
                                                    <td style={{ padding: '8px', border: '1px solid #cbd5e1' }}>
                                                        <strong style={{ color: act.type === 'defect' ? '#e11d48' : '#2563eb' }}>{act.action}</strong>
                                                    </td>
                                                    <td style={{ padding: '8px', border: '1px solid #cbd5e1' }}>
                                                        <span style={{ display: 'block', fontWeight: 'bold', marginBottom: '2px' }}>{act.taskName}</span>
                                                        <span style={{ color: '#475569' }}>{act.detail}</span>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            ))
                        )}
                        <div style={{ marginTop: '20mm', display: 'flex', justifyContent: 'space-between', fontSize: '10pt', color: '#64748b' }}>
                            <p>ผู้พิมพ์เอกสาร: {loggedInUser?.username} ({currentUserRole})</p>
                            <p>พิมพ์เมื่อ: {new Date().toLocaleString('th-TH')}</p>
                        </div>
                    </div>
                );
           })()}

        </div>

      
    </div> 
  );
}