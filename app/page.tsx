
'use client';
import React, { useState, useEffect, useMemo, useCallback, useTransition } from 'react';
import { supabase } from '@/lib/supabase';
import { useBuildTrackData } from '@/hooks/useBuildTrackData';
import LoginView from '@/components/LoginView';
import DashboardOverview from '@/components/DashboardOverview';
import ContractorScheduleView from '@/components/ContractorScheduleView';
import MapVisualizer from '@/components/MapVisualizer';
import HouseDetailView from '@/components/HouseDetailView';
import TaskProgressView from '@/components/TaskProgressView';
import OwnerAnalyticsDashboard from '@/components/OwnerAnalyticsDashboard';
import ExecutiveAnalytics from '@/components/ExecutiveAnalytics';
import MasterGanttChart from '@/components/MasterGanttChart';
import MaterialStoreDashboard from '@/components/MaterialStoreDashboard';
import AdminPlotPricing from '@/components/AdminPlotPricing';
// ถอด browser-image-compression ออกเพื่อใช้ Native ป้องกัน Error
import {
  LayoutDashboard, Map as MapIcon, Truck, ChevronRight, ClipboardList, Loader2,
  Send, Camera, CheckCircle, XCircle, UserCog, X, Maximize2, HardHat, PlusCircle, Settings, Building, FolderOpen, Users, Trash2, Search, Filter, LogOut, AlertTriangle, Eraser, Grid, Paintbrush, Clock, SortAsc,
  UserPlus, Phone, CalendarDays, Wrench, Bell, CalendarClock, TrendingUp, AlertCircle, BarChartHorizontal, Save, Calendar, Smartphone, Monitor, ZoomIn, ZoomOut,
  PieChart, Home, Activity, Download, Copy, Pickaxe, ShieldAlert, Printer, CheckSquare, Square, ImageIcon, Tag, Hammer, UserCheck, DollarSign, ArrowLeft
} from 'lucide-react';

// 🌟 ฟังก์ชันบีบอัดรูปภาพ Native — อยู่นอก component เพื่อไม่ให้ถูกสร้างใหม่ทุก render 🌟
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
  // Extracted: [allUsers,
  const [loggedInUser, setLoggedInUser] = useState<any>(null);
  const [loginData, setLoginData] = useState({ username: '', pin: '' });

  const [selectedProject, setSelectedProject] = useState<any>(null);
  const {
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
    fetchPlotDetails,
    fetchOwnerAnalyticsData,
    togglePlotSaleStatus,
    materialRequests, setMaterialRequests
  } = useBuildTrackData(loggedInUser, selectedProject?.name);


  const [view, setViewInternal] = useState('dashboard');
  const [loadingView, setLoadingView] = useState<string | null>(null);

  const setView = useCallback((newView: any) => {
    if (newView === 'project-detail') {
      setViewInternal(newView); // No skeleton for map visualizer
      return;
    }
    setLoadingView(newView);
    setTimeout(() => {
      setViewInternal(newView);
      setLoadingView(null);
    }, 100);
  }, []);
  const [taskReturnView, setTaskReturnView] = useState('house-detail');
  const activeView = loadingView || view;
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(true);
  const [selectedPlot, setSelectedPlot] = useState<any>(null);
  const [selectedTask, setSelectedTask] = useState<any>(null);

  // Extracted: [projects,
  // Extracted: [plots,
  // Extracted: [houseTypes,
  // Extracted: [taskTemplates,
  // Extracted: [loading,
  const [editPlotModal, setEditPlotModal] = useState<any>({ isOpen: false, plot: null, id: '', house_type_id: '', foreman_name: '' });
  const [editProjectModal, setEditProjectModal] = useState({ isOpen: false, oldName: '', newName: '' });
  const [confirmDialog, setConfirmDialog] = useState<any>({ isOpen: false, title: '', message: '', onConfirm: null, isDestructive: true });
  const [errorDialog, setErrorDialog] = useState<any>({ isOpen: false, title: '', message: '' });

  const [toastConfig, setToastConfig] = useState<{message: string, type: 'success'|'error', visible: boolean}>({ message: '', type: 'success', visible: false });
  const showToast = useCallback((message: string, type: 'success'|'error' = 'success') => {
    setToastConfig({ message, type, visible: true });
    setTimeout(() => setToastConfig(prev => ({ ...prev, visible: false })), 4000);
  }, []);

  // 🌟 State สำหรับระบบ 2.5D แบบเจาะจงรายงวดงาน (0-99% และ 100%)
  const [editingHouseType, setEditingHouseType] = useState<any>(null);
  const [visualConfig, setVisualConfig] = useState<Record<string, any>>({}); // เก็บค่าแบบ Map { [taskId]: { progress_image, progress_z, done_image, done_z } }
  const [isUploadingLayer, setIsUploadingLayer] = useState(false);
  const [simulatedStatus, setSimulatedStatus] = useState<Record<string, any>>({}); // 🎮 สำหรับกล่องลองเล่นพรีวิวในหน้าตั้งค่า { [taskId]: 'none' | 'progress' | 'done' }

  // ฟังก์ชันอัปโหลดรูปเฉพาะช่อง
  const handleUploadSlot = async (taskId: string, type: string, file: File | undefined | null) => {
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
    } catch (err: any) {
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
      showToast('บันทึกการจัดเลเยอร์ 2.5D แบบรายงวดงานเรียบร้อยแล้วครับ', "success");
    } catch (e: any) {
      showAlert('ผิดพลาด', e.message);
    }
    setIsSubmitting(false);
  };

  const [updates, setUpdates] = useState<any[]>([]);
  // Extracted: [allUpdatesRecord, 
  // Extracted: [latestUpdatesMap,
  // Extracted: [taskDates, 
  // Extracted: [assignments, 
  // Extracted: [schedules, 

  // Extracted: [notifications,
  const [showNotifs, setShowNotifs] = useState(false);
  // Extracted: [contractors,

  const [inputText, setInputText] = useState('');
  const [currentWeather, setCurrentWeather] = useState<any>(null);

  // 🌤️ Weather Widget 2.0 States
  const [weatherInfo, setWeatherInfo] = useState<any>(null);
  const [showWeatherWidget, setShowWeatherWidget] = useState(false);

  // 🌟 ฟังก์ชันแปลรหัสสภาพอากาศ (WMO Code) เป็นภาษาไทย + ไอคอน
  const getWeatherDetails = (code: number) => {
    if (code === 0) return { icon: '☀️', text: 'ฟ้าใส แดดแรง' };
    if (code === 1 || code === 2) return { icon: '🌤️', text: 'มีเมฆบางส่วน' };
    if (code === 3) return { icon: '☁️', text: 'เมฆหนาตึบ' };
    if (code >= 45 && code <= 48) return { icon: '🌫️', text: 'มีหมอก' };
    if (code >= 51 && code <= 67) return { icon: '🌧️', text: 'ฝนตก' };
    if (code >= 80 && code <= 82) return { icon: '⛈️', text: 'ฝนตกหนัก' };
    if (code >= 95) return { icon: '🌩️', text: 'พายุฝนฟ้าคะนอง' };
    return { icon: '🌡️', text: 'สภาพอากาศปกติ' };
  };

  // 🌟 ฟังก์ชันดึงข้อมูลพยากรณ์และสถานที่
  useEffect(() => {
    let isMounted = true;
    const controller = new AbortController();
    const { signal } = controller;

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(async (position) => {
        if (!isMounted) return;
        const { latitude, longitude } = position.coords;
        try {
          // 1. ดึงชื่อสถานที่ฟรี (Reverse Geocoding)
          const locRes = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=th`, { signal });
          const locData = await locRes.json();
          const placeName = locData.locality || locData.city || "หน้าไซต์งาน";

          // 2. ดึงสภาพอากาศ (ปัจจุบัน + ล่วงหน้ารายชั่วโมง + UV)
          const weatherRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code&hourly=temperature_2m,weather_code,precipitation_probability,uv_index&timezone=auto&forecast_days=1`, { signal });
          const wData = await weatherRes.json();

          // คำนวณพยากรณ์ 4 ชั่วโมงข้างหน้า
          const currentHour = new Date().getHours();
          const nextHours = wData.hourly?.time?.slice(currentHour + 1, currentHour + 5).map((time: string, idx: number) => ({
            time: new Date(time).getHours() + ":00",
            temp: Math.round(wData.hourly.temperature_2m[currentHour + 1 + idx]),
            details: getWeatherDetails(wData.hourly.weather_code[currentHour + 1 + idx]),
            rainProb: wData.hourly.precipitation_probability[currentHour + 1 + idx]
          })) || [];

          // ระบบเตือนภัยหน้างาน (UV & Rain)
          const currentUV = wData.hourly?.uv_index?.[currentHour] || 0;
          const willRain = nextHours.some((h: any) => h.rainProb > 50);

          let alert = null;
          if (willRain) alert = { type: 'rain', msg: '🔵 มีโอกาสฝนตกในอีกไม่กี่ชั่วโมง เตรียมคลุมวัสดุ!' };
          else if (currentUV > 8) alert = { type: 'uv-high', msg: '🔴 UV รุนแรงมาก! หลีกเลี่ยงการตากแดดต่อเนื่อง' };
          else if (currentUV > 5) alert = { type: 'uv-med', msg: '🟠 แดดแรง ทาครีมกันแดดและดื่มน้ำบ่อยๆ นะครับ' };

          if (isMounted) {
            setWeatherInfo({
              location: placeName,
              currentTemp: Math.round(wData.current?.temperature_2m || 0),
              currentDetails: getWeatherDetails(wData.current?.weather_code || 0),
              hourly: nextHours,
              alert: alert
            });
          }
        } catch (e: any) {
          if (e?.name !== 'AbortError') {
            console.error("ดึงข้อมูลอากาศไม่สำเร็จ:", e);
            if (isMounted) {
              setWeatherInfo({
                location: "ข้อมูลไม่พร้อม",
                currentTemp: 0,
                currentDetails: { icon: '🌤️', text: 'ไม่สามารถดึงข้อมูลได้' },
                hourly: [],
                alert: null
              });
            }
          }
        }
      }, (error) => {
        if (!isMounted) return;
        console.warn("Geolocation access denied or failed:", error);
        setWeatherInfo({
          location: "Bangkok (ค่าเริ่มต้น)",
          currentTemp: 30,
          currentDetails: { icon: '☀️', text: 'ไม่ได้ระบุตำแหน่ง' },
          hourly: [],
          alert: null
        });
      }, { timeout: 10000, maximumAge: 60000 });
    } else {
      if (isMounted) {
        setWeatherInfo({
          location: "Bangkok (ค่าเริ่มต้น)",
          currentTemp: 30,
          currentDetails: { icon: '☀️', text: 'เบราว์เซอร์ไม่รองรับ GPS' },
          hourly: [],
          alert: null
        });
      }
    }
    return () => { isMounted = false; controller.abort(); };
  }, []);
  const [progressValue, setProgressValue] = useState(0);
  const [isSending, setIsSending] = useState(false);

  const [selectedFiles, setSelectedFiles] = useState<any[]>([]);
  const [fullImageUrl, setFullImageUrl] = useState<any>(null);
  const [galleryImages, setGalleryImages] = useState<{url: string, label?: string}[]>([]);
  const [galleryIndex, setGalleryIndex] = useState<number>(0);

  const [newProjectName, setNewProjectName] = useState('');
  const [newPlot, setNewPlot] = useState({ id: '', house_type_id: '', foreman_name: '' });
  const [newUser, setNewUser] = useState({ name: '', role: 'Foreman' });
  const [newContractor, setNewContractor] = useState({ name: '', phone: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [searchPlot, setSearchPlot] = useState('');
  const [filterForeman, setFilterForeman] = useState('');
  const [searchTask, setSearchTask] = useState('');
  const [inspectionSort, setInspectionSort] = useState('time');
  const [inspectionViewMode, setInspectionViewMode] = useState('card');
  const [inspectionFilterTab, setInspectionFilterTab] = useState('all');

  const [assignModal, setAssignModal] = useState<any>({ isOpen: false, task: null, name: '', phone: '' });
  const [dialogConfig, setDialogConfig] = useState<any>({ isOpen: false, title: '', message: '', type: 'confirm', onConfirm: null });

  // 🌟 Infinite Scroll State สำหรับ Live Feed 🌟
  const [visibleFeedCount, setVisibleFeedCount] = useState(50);

  // 🌟 Defect Tracking State 🌟
  const [defectFilterStatus, setDefectFilterStatus] = useState('pending');
  const [defectSearchText, setDefectSearchText] = useState('');
  const [defectFilterMy, setDefectFilterMy] = useState(true);  const feedObserverRef = React.useRef<IntersectionObserver | null>(null);
  const observerTargetRef = useCallback((node: HTMLDivElement | null) => {
    if (feedObserverRef.current) feedObserverRef.current.disconnect();
    if (node) {
      feedObserverRef.current = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting) setVisibleFeedCount((prev) => prev + 50);
      }, { threshold: 0.1 });
      feedObserverRef.current.observe(node);
    }
  }, []);
  const [scheduleInputs, setScheduleInputs] = useState<Record<string, any>>({});
  const [copyModalOpen, setCopyModalOpen] = useState(false);
  const [copySourcePlot, setCopySourcePlot] = useState('');
  const [copyStartDate, setCopyStartDate] = useState('');
  // 🌟 Daily Activity Report States 🌟
  const [activityReportOpen, setActivityReportOpen] = useState(false);
  const [activityReportDate, setActivityReportDate] = useState(new Date().toLocaleDateString('en-CA'));

  const [isMobilePreview, setIsMobilePreview] = useState(false);
  const [isRealMobile, setIsRealMobile] = useState(false);

  const [gridCols, setGridCols] = useState(40);
  const [gridRows, setGridRows] = useState(24);
  const [mapZoom, setMapZoom] = useState(1);
  const [isEditMapMode, setIsEditMapMode] = useState(false);
  const [mapGrid, setMapGrid] = useState<any[]>([]);
  const [mapTool, setMapTool] = useState('plot');
  const [mapSelectedPlot, setMapSelectedPlot] = useState('');
  const [isDrawing, setIsDrawing] = useState(false);
  const [lastDrawCell, setLastDrawCell] = useState<any>(null);

  // 🌟 Print Export States 🌟
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [allTaskImages, setAllTaskImages] = useState<any[]>([]);
  const [selectedExportImages, setSelectedExportImages] = useState<any[]>([]);
  const [isPresentationOpen, setIsPresentationOpen] = useState(false);
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  // Extracted: [defects,
  const [defectModal, setDefectModal] = useState<any>({ isOpen: false, task: null, plotId: '' });
  const [newDefectText, setNewDefectText] = useState('');
  const [defectFiles, setDefectFiles] = useState<any[]>([]);
  const [isSubmittingDefect, setIsSubmittingDefect] = useState(false);

  // ==========================================
  // 2. HELPER FUNCTIONS
  // ==========================================
  const showConfirm = (title: string, message: string, onConfirmAction: any) => setDialogConfig({ isOpen: true, title, message, type: 'confirm', onConfirm: onConfirmAction });
  const showAlert = (title: string, message: string) => setDialogConfig({ isOpen: true, title, message, type: 'alert', onConfirm: null });
  const closeDialog = () => setDialogConfig({ ...dialogConfig, isOpen: false });

  const handleZoomIn = () => setMapZoom(prev => Math.min(prev + 0.2, 2.5));
  const handleZoomOut = () => setMapZoom(prev => Math.max(prev - 0.2, 0.5));
  const handleZoomReset = () => setMapZoom(1);

  const getTaskStatus = (plannedEnd: any, actualEnd: any, progress: number) => {
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

  const getPlotOverallStatus = (plotId: any) => {
    const plotInfo = plots.find(p => p.id === plotId); const plotTasks = taskTemplates.filter(t => t.house_type_id === plotInfo?.house_type_id);
    if (!plotTasks.length) return { actual: 0, planned: 0, status: 'none', label: 'ยังไม่มีงาน', colors: 'bg-white border-slate-300 text-slate-500' };
    let totalActual = 0; let totalPlanned = 0; 
    
    // 🌟 Override "today" if plot is paused for sale
    const today = plotInfo?.sale_status === 'ready_for_sale' && plotInfo?.paused_for_sale_at ? new Date(plotInfo.paused_for_sale_at).getTime() : Date.now();
      
    plotTasks.forEach(task => {
      const key = `${plotId}-${task.id}`; totalActual += (latestUpdatesMap[key]?.progress || 0); const plan = schedules[key]; let plannedProg = 0;
      if (plan && plan.planned_start && plan.planned_end) {
        const pStart = new Date(plan.planned_start).getTime(); const pEnd = new Date(plan.planned_end).getTime();
        if (today >= pEnd) plannedProg = 100; else if (today <= pStart) plannedProg = 0; else plannedProg = Math.round(((today - pStart) / (pEnd - pStart)) * 100);
      } totalPlanned += plannedProg;
    });
    const actualAvg = Math.round(totalActual / plotTasks.length); const plannedAvg = Math.round(totalPlanned / plotTasks.length);
    
    // 🌟 Override status if ready for sale
    if (plotInfo?.sale_status === 'ready_for_sale') return { actual: actualAvg, planned: plannedAvg, status: 'ready_for_sale', label: 'พร้อมขาย/รอโอน', colors: 'bg-amber-100/90 border-amber-500 text-amber-800' };

    if (actualAvg === 0 && plannedAvg === 0) return { actual: actualAvg, planned: plannedAvg, status: 'none', label: 'รอดำเนินการ', colors: 'bg-white/90 border-slate-300 text-slate-500' };
    if (actualAvg >= 100 && plannedAvg >= 100) return { actual: actualAvg, planned: plannedAvg, status: 'completed', label: 'เสร็จสมบูรณ์', colors: 'bg-emerald-100/90 border-emerald-500 text-emerald-800' };
    if (actualAvg < plannedAvg - 10) return { actual: actualAvg, planned: plannedAvg, status: 'delayed', label: 'ล่าช้ากว่าแผน', colors: 'bg-rose-100/90 border-rose-500 text-rose-800' };
    if (actualAvg > plannedAvg + 10) return { actual: actualAvg, planned: plannedAvg, status: 'ahead', label: 'เร็วกว่าแผน', colors: 'bg-indigo-100/90 border-indigo-500 text-indigo-800' };
    return { actual: actualAvg, planned: plannedAvg, status: 'on-track', label: 'ตามแผน', colors: 'bg-blue-100/90 border-blue-500 text-blue-800' };
  };

  const getAdjacency = (x: number, y: number, type: string, plotId: string | null) => ({ hasTop: mapGrid.some(c => c.x === x && c.y === y - 1 && c.type === type && (type !== 'plot' || c.plotId === plotId)), hasBottom: mapGrid.some(c => c.x === x && c.y === y + 1 && c.type === type && (type !== 'plot' || c.plotId === plotId)), hasLeft: mapGrid.some(c => c.x === x - 1 && c.y === y && c.type === type && (type !== 'plot' || c.plotId === plotId)), hasRight: mapGrid.some(c => c.x === x + 1 && c.y === y && c.type === type && (type !== 'plot' || c.plotId === plotId)) });

  // ==========================================
  // 3. API FETCHING & EFFECTS
  // ==========================================
  // fetchAllData extracted to hook


  useEffect(() => {
    const checkMobile = () => setIsRealMobile(window.innerWidth < 768);
    checkMobile(); window.addEventListener('resize', checkMobile); return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // 🌟 ระบบจำการล็อกอิน และตรวจจับเวลาหมดอายุ (ตั้งไว้ 60 นาที)
  useEffect(() => {
    const TIMEOUT_MS = 60 * 60 * 1000;
    
    // 🛡️ เช็ค Session จาก Supabase Auth โดยตรง
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const lastActive = localStorage.getItem('buildtrack_last_active');
      
      if (session && lastActive) {
        if (Date.now() - parseInt(lastActive) < TIMEOUT_MS) {
          setLoggedInUser(session.user.user_metadata);
          localStorage.setItem('buildtrack_last_active', Date.now().toString());
        } else {
          await supabase.auth.signOut();
          setLoggedInUser(null);
          localStorage.removeItem('buildtrack_last_active');
        }
      }
    };
    checkSession();

    const updateActivity = () => {
      if (localStorage.getItem('buildtrack_last_active')) {
        // 🌟 Throttle: อัปเดตทุก 30 วินาทีเท่านั้น ป้องกัน write ถี่เกินไปบน touchscreen / keyboard
        const last = parseInt(localStorage.getItem('buildtrack_last_active') || '0');
        if (Date.now() - last > 30000) {
          localStorage.setItem('buildtrack_last_active', Date.now().toString());
        }
      }
    };

    window.addEventListener('mousemove', updateActivity);
    window.addEventListener('keydown', updateActivity);
    window.addEventListener('click', updateActivity);
    window.addEventListener('touchstart', updateActivity);

    const interval = setInterval(async () => {
      const lastAct = localStorage.getItem('buildtrack_last_active');
      if (lastAct && (Date.now() - parseInt(lastAct) > TIMEOUT_MS)) {
        await supabase.auth.signOut();
        setLoggedInUser(null);
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
  // loggedInUser fetchAllData extracted
  useEffect(() => { if (loggedInUser?.role === 'Owner') setView('global-feed'); }, [loggedInUser]);
  useEffect(() => { setScheduleInputs({}); }, [selectedPlot?.id]);

  // Lazy load specific plot details when opening plot view
  useEffect(() => {
    if (selectedPlot?.id && (view === 'house-detail' || view === 'task-progress')) {
      fetchPlotDetails(selectedPlot.id);
    }
  }, [selectedPlot?.id, view, fetchPlotDetails]);

  // 🌟 Lazy load Owner Analytics when opening reports
  useEffect(() => {
    const isRoleAdmin = loggedInUser?.role?.toLowerCase() === 'admin';
    const isRoleOwner = loggedInUser?.role?.toLowerCase() === 'owner';
    if (view === 'reports' && (isRoleAdmin || isRoleOwner)) {
      fetchOwnerAnalyticsData();
    }
  }, [view, loggedInUser?.role, fetchOwnerAnalyticsData]);

  // 🌟 ระบบจับการกดปุ่มคีย์บอร์ด (ซ้าย, ขวา, ESC) สำหรับโหมด Presentation
  useEffect(() => {
    const handleKeyDown = (e: any) => {
      if (!isPresentationOpen) return;
      if (galleryImages.length > 0 || fullImageUrl) return; // ป้องกันการเลื่อนสไลด์หลักซ้อนกับแกลเลอรี่ภาพ
      if (e.key === 'ArrowRight') setCurrentSlideIndex(prev => Math.min(prev + 1, plots.length - 1));
      if (e.key === 'ArrowLeft') setCurrentSlideIndex(prev => Math.max(prev - 1, 0));
      if (e.key === 'Escape') setIsPresentationOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPresentationOpen, plots.length, galleryImages.length, fullImageUrl]);

  // 🌟 ระบบจับการกดปุ่มคีย์บอร์ด (ซ้าย, ขวา, ESC) สำหรับ Gallery Lightbox และ FullImage
  useEffect(() => {
    const handleKeyDown = (e: any) => {
      if (galleryImages.length === 0 && !fullImageUrl) return;
      
      if (galleryImages.length > 0) {
        if (e.key === 'ArrowRight') setGalleryIndex(prev => Math.min(prev + 1, galleryImages.length - 1));
        if (e.key === 'ArrowLeft') setGalleryIndex(prev => Math.max(prev - 1, 0));
      }

      if (e.key === 'Escape') {
        setGalleryImages([]);
        setFullImageUrl(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [fullImageUrl, galleryImages.length]);

  // ==========================================
  // 4. HANDLERS
  // ==========================================
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const handleLogin = async () => {
    if (!loginData.username || !loginData.pin) return;
    setIsLoggingIn(true);
    try {
      // 🛡️ เข้าสู่ระบบอย่างปลอดภัยผ่าน Supabase Auth
      const email = `${loginData.username.toLowerCase().replace(/\s/g, '')}@buildtrack.local`;
      const password = `${loginData.pin}BT!`;

      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      
      if (error) {
        setIsLoggingIn(false);
        return showAlert('ล้มเหลว', `เข้าสู่ระบบไม่ได้: ${error.message} (Email: ${email})`);
      }

      // ดึงข้อมูล User (username, role) ที่เก็บไว้ใน metadata ตอน Migrate
      const userMeta = data.user.user_metadata;
      setLoggedInUser(userMeta);
      localStorage.setItem('buildtrack_last_active', Date.now().toString());
    } catch (e: any) {
      showAlert('Error', e.message);
    } finally {
      setIsLoggingIn(false);
    }
  };
  // 🌟 ฟังก์ชันเพิ่ม/แก้ไขแบบบ้าน พร้อมระบบอัปเดตชื่ออัตโนมัติป้องกันลิงก์พัง
  const [houseTypeForm, setHouseTypeForm] = useState({ id: '', type_name: '', memo: '' });
  const [isEditingType, setIsEditingType] = useState(false);
  // 🌟 ฟังก์ชันบันทึกข้อมูลแบบบ้าน (เพิ่มใหม่ / แก้ไข)
  const handleSaveHouseType = async () => {
    if (!houseTypeForm.type_name.trim()) return showAlert('แจ้งเตือน', 'กรุณาระบุชื่อแบบบ้านครับ');

    setIsSubmitting(true);
    try {
      if (isEditingType) {
        // อัปเดตแบบบ้านเดิม
        const { error } = await supabase.from('house_types')
          .update({ type_name: houseTypeForm.type_name.trim(), memo: houseTypeForm.memo })
          .eq('id', houseTypeForm.id);
        if (error) throw error;
        showToast('แก้ไขข้อมูลแบบบ้านเรียบร้อยแล้ว', "success");
      } else {
        // เพิ่มแบบบ้านใหม่
        const { error } = await supabase.from('house_types')
          .insert([{ type_name: houseTypeForm.type_name.trim(), memo: houseTypeForm.memo }]);
        if (error) throw error;
        showToast('เพิ่มแบบบ้านใหม่เข้าสู่ระบบเรียบร้อยแล้ว', "success");
      }

      // ล้างค่าฟอร์มและโหลดข้อมูลใหม่
      setHouseTypeForm({ id: '', type_name: '', memo: '' });
      setIsEditingType(false);
      await fetchAllData();
    } catch (e: any) {
      showAlert('ล้มเหลว', (e as Error).message);
    }
    setIsSubmitting(false);
  };


  // 🌟 ฟังก์ชันจัดการงวดงาน (Task Templates)
  const [editingTaskHouseId, setEditingTaskHouseId] = useState('');
  const [taskForm, setTaskForm] = useState({ id: '', task_name: '', task_order: '', cost: '' });
  const [isEditingTask, setIsEditingTask] = useState(false);

  const handleSaveTask = async () => {
    if (!editingTaskHouseId) return showAlert('ข้อผิดพลาด', 'กรุณาเลือกแบบบ้านก่อน');
    if (!taskForm.task_name.trim() || !taskForm.task_order) return showAlert('ข้อผิดพลาด', 'กรุณากรอกชื่อและลำดับงาน');

    setIsSubmitting(true);
    try {
      if (isEditingTask) {
        // อัปเดตงานเดิม
        const { error } = await supabase.from('task_templates')
          .update({ task_name: taskForm.task_name.trim(), task_order: parseInt(taskForm.task_order), cost: parseFloat(taskForm.cost) || 0 })
          .eq('id', taskForm.id);
        if (error) throw error;
        showToast('แก้ไขงวดงานเรียบร้อยแล้ว', "success");
      } else {
        // เพิ่มงานใหม่
        const { error } = await supabase.from('task_templates')
          .insert([{ house_type_id: editingTaskHouseId, task_name: taskForm.task_name.trim(), task_order: parseInt(taskForm.task_order), cost: parseFloat(taskForm.cost) || 0 }]);
        if (error) throw error;
        showToast('เพิ่มงวดงานใหม่เรียบร้อยแล้ว', "success");
      }
      setTaskForm({ id: '', task_name: '', task_order: '', cost: '' });
      setIsEditingTask(false);
      await fetchAllData();
    } catch (e: any) {
      showAlert('ล้มเหลว', e.message);
    }
    setIsSubmitting(false);
  };

  const handleDeleteTask = async (task: any) => {
    setIsSubmitting(true);
    try {
      // 🎯 ตรวจสอบความสัมพันธ์ทุกตารางพร้อมกัน (parallel) แทนการรอทีละอัน
      const [
        { data: updatesCheck },
        { data: schedulesCheck },
        { data: assignmentsCheck },
        { data: defectsCheck },
      ] = await Promise.all([
        supabase.from('task_updates').select('id').eq('task_template_id', task.id).limit(1),
        supabase.from('plot_task_schedules').select('id').eq('task_template_id', task.id).limit(1),
        supabase.from('plot_task_assignments').select('id').eq('task_template_id', task.id).limit(1),
        supabase.from('defects').select('id').eq('task_id', task.id).limit(1),
      ]);

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
          showToast('ลบงวดงานออกจากระบบเรียบร้อยแล้ว', "success");
        } catch (e: any) {
          showAlert('ล้มเหลว', 'เกิดข้อผิดพลาดในการลบ: ' + e.message);
        }
        setIsSubmitting(false);
      });

    } catch (e: any) {
      setIsSubmitting(false);
      showAlert('ข้อผิดพลาด', 'ไม่สามารถตรวจสอบสถานะการใช้งานของงานนี้ได้');
    }
  };
  const handleLogout = () => {
    showConfirm('ยืนยันการออกจากระบบ', 'คุณแน่ใจหรือไม่ว่าต้องการออกจากระบบ?', async () => {
      // 🛡️ ออกจากระบบผ่าน Supabase Auth
      await supabase.auth.signOut();
      
      // 🌟 ล้างความจำในเบราว์เซอร์ทิ้ง
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

  const handleNotifClick = async (notif: any) => {
    if (!notif.is_read) { await supabase.from('notifications').update({ is_read: true }).eq('id', notif.id); await fetchAllData(); }
    setShowNotifs(false);
    const pInfo = plots.find(p => p.id === notif.plot_id); const pProject = projects.find(pj => pj.name === pInfo?.project_name); const tInfo = taskTemplates.find(t => t.id === notif.task_template_id);
    if (pInfo && pProject && tInfo) { setSelectedProject(pProject); setSelectedPlot(pInfo); setSelectedTask(tInfo); setView('task-progress'); supabase.from('task_updates').select('*').eq('task_template_id', tInfo.id).eq('plot_id', pInfo.id).order('created_at', { ascending: true }).then(({ data }) => { setUpdates(data || []); setProgressValue(data?.length ? data[data.length - 1].progress : 0); }); }
  };

  const handleSaveAllSchedules = async () => {
    setIsSubmitting(true);
    try {
      const payloads: any[] = []; Object.keys(scheduleInputs).forEach(taskId => { const plan = scheduleInputs[taskId]; if (plan.start && plan.end) { payloads.push({ plot_id: selectedPlot.id, task_template_id: taskId, planned_start: plan.start, planned_end: plan.end }); } });
      if (payloads.length === 0) { setIsSubmitting(false); return showAlert('แจ้งเตือน', 'ไม่มีการแก้ไขข้อมูล หรือกรอกวันที่ไม่ครบครับ'); }
      // 🌟 ตรวจสอบวันที่ทุกรายการก่อน ก่อนที่จะแตะ Database 🌟
      for (const p of payloads) { if (new Date(p.planned_end) < new Date(p.planned_start)) throw new Error('วันสิ้นสุดต้องอยู่หลังวันเริ่มงานครับ'); }
      // 🌟 upsert แบบ batch ครั้งเดียว แทนการ delete+insert ทีละรายการ (atomic & fast) 🌟
      const { error } = await supabase.from('plot_task_schedules').upsert(payloads, { onConflict: 'plot_id,task_template_id' });
      if (error) throw error;
      showToast('บันทึกแผนงานทั้งหมดเรียบร้อยแล้ว', "success"); setScheduleInputs({}); await fetchAllData();
    } catch (e: any) { showAlert('Error', (e as Error).message); } setIsSubmitting(false);
  };

  // 🌟 ฟังก์ชันดึงแผนงานแบบมีระบบ Auto-Shift (เลื่อนวันให้อัตโนมัติ)
  const handleConfirmCopy = () => {
    const newInputs: any = { ...scheduleInputs };
    // ดึงงานทั้งหมดและจัดเรียงตามลำดับ (1, 2, 3...)
    const sourceTasks = taskTemplates.filter(t => t.house_type_id === selectedPlot.house_type_id).sort((a, b) => a.task_order - b.task_order);
    let hasData = false;

    // 1. หาวันเริ่มงานของงาน "ลำดับแรกสุด" ที่มีข้อมูลของแปลงต้นฉบับ
    let originalFirstStartDate = null;
    for (const task of sourceTasks) {
      const sourcePlan = schedules[`${copySourcePlot}-${task.id}`];
      if (sourcePlan && sourcePlan.planned_start) {
        originalFirstStartDate = new Date(sourcePlan.planned_start).getTime();
        break;
      }
    }

    // 2. คำนวณส่วนต่างเวลา (Offset) ระหว่างวันต้นฉบับ กับวันที่ผู้ใช้กำหนดใหม่
    let offsetMs = 0;
    if (originalFirstStartDate && copyStartDate) {
      const newStartMs = new Date(copyStartDate).getTime();
      offsetMs = newStartMs - originalFirstStartDate;
    }

    // 3. วนลูปบวกจำนวนวัน (Offset) เข้าไปในทุกๆ งาน
    sourceTasks.forEach(task => {
      const sourcePlan = schedules[`${copySourcePlot}-${task.id}`];
      if (sourcePlan && sourcePlan.planned_start && sourcePlan.planned_end) {
        // เอาวันที่เดิมมาบวก Offset ที่คำนวณไว้
        const shiftedStart = new Date(new Date(sourcePlan.planned_start).getTime() + offsetMs);
        const shiftedEnd = new Date(new Date(sourcePlan.planned_end).getTime() + offsetMs);

        // คำนวณระยะเวลาจำนวนวัน (Duration) ส่งไปด้วย
        const durationDiff = shiftedEnd.getTime() - shiftedStart.getTime();
        const durationDays = String(Math.max(0, Math.ceil(durationDiff / (1000 * 60 * 60 * 24))) + 1);

        newInputs[task.id] = {
          start: shiftedStart.toISOString().split('T')[0],
          end: shiftedEnd.toISOString().split('T')[0],
          duration: durationDays
        };
        hasData = true;
      }
    });

    if (!hasData) { showAlert('แจ้งเตือน', 'แปลงต้นทางที่คุณเลือกยังไม่มีข้อมูลแผนงานครับ'); return; }
    setScheduleInputs(newInputs);
    setCopyModalOpen(false);
    setCopySourcePlot('');
    setCopyStartDate('');
    showToast('ดึงข้อมูลและปรับเลื่อนแผนงานอัตโนมัติสำเร็จ! กรุณากด "บันทึก" ด้านขวาบน เพื่อยืนยันลงระบบครับ', "success");
  };
  const handleExportCSV = () => {
    let csvContent = "\uFEFFชื่อโครงการ,รหัสแปลง (Plot),แบบบ้าน,โฟร์แมน,ความคืบหน้าจริง (%),ความคืบหน้าตามแผน (%),สถานะ\n";
    displayPlots.forEach(plot => { const statusInfo = getPlotOverallStatus(plot.id); csvContent += `${plot.project_name?.replace(/,/g, ' ')},${plot.id?.replace(/,/g, ' ')},${plot.type?.replace(/,/g, ' ')},${plot.foreman?.replace(/,/g, ' ') || 'ไม่ระบุ'},${plot.progress}%,${statusInfo.planned}%,${statusInfo.label}\n`; });
    // 🌟 ใช้ Blob แทน encodeURI เพื่อรองรับภาษาไทยและอักขระพิเศษได้ถูกต้อง 🌟
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a"); link.setAttribute("href", url); link.setAttribute("download", `BuildTrack_Report_${new Date().toISOString().split('T')[0]}.csv`); document.body.appendChild(link); link.click(); document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const toggleFence = (dir: any, x: any, y: any, mode: any) => { setMapGrid((prev: any) => { const id = `fence-${dir}-${x}-${y}`; if (mode === 'add') { return prev.some((c: any) => c.id === id) ? prev : [...prev, { id, type: `fence-${dir}`, x, y }]; } else { return prev.filter((c: any) => c.id !== id); } }); };
  const handleMouseDown = (x: any, y: any) => { if (!isEditMapMode) return; setIsDrawing(true); setLastDrawCell({ x, y }); if (mapTool === 'eraser') eraseCell(x, y); else if (mapTool === 'plot' || mapTool === 'road') { if (mapTool === 'plot' && !mapSelectedPlot) { setIsDrawing(false); return showAlert('แจ้งเตือน', 'เลือกรหัสแปลงก่อน'); } paintCell(x, y); } };
  const handleMouseEnter = (x: any, y: any) => { if (!isDrawing || !isEditMapMode) return; if (mapTool === 'fence' || mapTool === 'eraser') { if (lastDrawCell) { const dx = x - lastDrawCell.x, dy = y - lastDrawCell.y; if (Math.abs(dx) >= 1 && dy === 0) toggleFence('v', Math.max(x, lastDrawCell.x), y, mapTool === 'eraser' ? 'erase' : 'add'); else if (Math.abs(dy) >= 1 && dx === 0) toggleFence('h', x, Math.max(y, lastDrawCell.y), mapTool === 'eraser' ? 'erase' : 'add'); } if (mapTool === 'eraser') eraseCell(x, y); setLastDrawCell({ x, y }); } else { paintCell(x, y); setLastDrawCell({ x, y }); } };
  const handleMouseUp = () => { setIsDrawing(false); setLastDrawCell(null); };
  const paintCell = (x: any, y: any) => setMapGrid((prev: any) => [...prev.filter((c: any) => !((c.type === 'plot' || c.type === 'road') && c.x === x && c.y === y)), { id: `${x}-${y}`, type: mapTool, x, y, plotId: mapTool === 'plot' ? mapSelectedPlot : null }]);
  const eraseCell = (x: any, y: any) => setMapGrid((prev: any) => prev.filter((c: any) => !((c.type === 'plot' || c.type === 'road') && c.x === x && c.y === y)));
  const handleSaveMap = async () => { setIsSubmitting(true); try { const finalGrid = [...mapGrid.filter(c => c.type !== 'config'), { id: 'GRID_CONFIG', type: 'config', cols: gridCols, rows: gridRows }]; await supabase.from('projects').update({ layout_data: finalGrid }).eq('name', selectedProject.name); showToast('บันทึกแผนผังเรียบร้อย!', "success"); await fetchAllData(); setSelectedProject((prev: any) => ({ ...prev, layout_data: finalGrid })); setIsEditMapMode(false); } catch (e: any) { showAlert('Error', (e as Error).message); } finally { setIsSubmitting(false); } };

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
      showToast(`เพิ่มผู้ใช้งานเรียบร้อยแล้ว!`, "success");
    } catch (e: any) { showAlert('Error', (e as Error).message); } finally { setIsSubmitting(false); }
  };

  const handleDeleteUser = (id: any, name: any, role: any) => {
    showConfirm('ยืนยันลบ', `ลบผู้ใช้งาน ${name}?`, async () => {
      try {
        if (role === 'Foreman') await supabase.from('foremen').delete().eq('name', name);
        await supabase.from('users').delete().eq('username', name);
        const { data } = await supabase.from('users').select('*').order('role', { ascending: true }).order('username', { ascending: true });
        setAllUsers(data || []); closeDialog();
      } catch (e: any) { showAlert('Error', (e as Error).message); }
    });
  };

  const handleAddProject = async () => {
    if (!newProjectName.trim()) return showAlert('แจ้งเตือน', 'กรุณาระบุชื่อโครงการก่อนบันทึก'); 
    setIsSubmitting(true);
    try {
      await supabase.from('projects').insert([{ name: newProjectName.trim() }]);
      setNewProjectName(''); await fetchAllData(); setView('dashboard'); showToast('สร้างโครงการใหม่เรียบร้อยแล้ว', "success");
    } catch (e: any) { showAlert('Error', (e as Error).message); } finally { setIsSubmitting(false); }
  };

  const handleAddPlot = async () => {
    if (!newPlot.id.trim() || !newPlot.house_type_id) return showAlert('แจ้งเตือน', 'กรอกรหัสแปลงและเลือกแบบบ้านให้ครบถ้วน'); setIsSubmitting(true);
    try {
      await supabase.from('plots').insert([{ id: newPlot.id.trim(), house_type_id: newPlot.house_type_id, foreman_name: newPlot.foreman_name, project_name: selectedProject.name }]);
      setNewPlot({ id: '', house_type_id: '', foreman_name: '' }); await fetchAllData(); setView('project-detail'); showToast('เพิ่มแปลงบ้านลงโครงการเรียบร้อยแล้ว', "success");
    } catch (e: any) { showAlert('Error', (e as Error).message); } finally { setIsSubmitting(false); }
  };

  const handleAddContractor = async () => {
    if (!newContractor.name.trim() || !newContractor.phone.trim()) return showAlert('แจ้งเตือน', 'กรุณากรอกข้อมูลช่างให้ครบ'); setIsSubmitting(true);
    try {
      await supabase.from('contractors').insert([{ name: newContractor.name.trim(), phone: newContractor.phone.trim() }]);
      setNewContractor({ name: '', phone: '' }); await fetchAllData(); showToast('เพิ่มรายชื่อช่างใหม่เรียบร้อยแล้ว', "success");
    } catch (e: any) { showAlert('Error', (e as Error).message); } finally { setIsSubmitting(false); }
  };

  const handleDeleteContractor = (id: any, name: any) => {
    showConfirm('ยืนยันลบ', `ลบรายชื่อช่าง ${name} ออกจากระบบ?`, async () => {
      try { await supabase.from('contractors').delete().eq('id', id); await fetchAllData(); closeDialog(); } catch (e: any) { showAlert('Error', (e as Error).message); }
    });
  };

  const handleAssignContractor = async () => {
    setIsSubmitting(true);
    try {
      // 1. ลบของเก่าออกก่อน
      const { error: delErr } = await supabase.from('plot_task_assignments').delete().match({ plot_id: selectedPlot.id, task_template_id: assignModal.task.id });
      if (delErr) throw delErr;

      // 2. บันทึกข้อมูลใหม่ลงไป และขอข้อมูลกลับมาด้วยคำสั่ง .select()
      const { data: newAssign, error: insErr } = await supabase.from('plot_task_assignments').insert([{
        plot_id: selectedPlot.id,
        task_template_id: assignModal.task.id,
        contractor_name: assignModal.name,
        contractor_phone: assignModal.phone
      }]).select();

      if (insErr) throw insErr;

      // 🌟 3. อัปเดต State ตรงๆ เพื่อให้ตารางฝั่งซ้ายเปลี่ยนชื่อช่าง "ทันที" ไม่ง้อโหลดใหม่ 🌟
      if (newAssign && newAssign.length > 0) {
        setAssignments(prev => {
          const filtered = prev.filter(a => !(String(a.plot_id) === String(selectedPlot.id) && String(a.task_template_id) === String(assignModal.task.id)));
          return [...filtered, newAssign[0]];
        });
      }

      setAssignModal({ isOpen: false, task: null, name: '', phone: '' });
      // เอา fetchAllData ออก เพื่อไม่ให้เกิดหน้าจอ Loading โหลดใหม่ทั้งหน้า ซึ่งทำให้ตำแหน่ง Scroll หายไป
      // ข้อมูล State ถูกอัปเดตไปแล้วในขั้นตอนข้างต้น (setAssignments) จึงไม่จำเป็นต้องโหลดใหม่ทั้งหมด
      // ปิด Alert ออกไป เพื่อไม่ให้เด้งขัดจังหวะ ให้ผู้ใช้อยู่ตำแหน่งเดิมและมอบหมายงานต่อไปได้ทันที
    } catch (e: any) {
      showAlert('Error', 'เกิดข้อผิดพลาดจากฐานข้อมูล: ' + (e as Error).message);
    }
    setIsSubmitting(false);
  };
  // 🌟 ฟังก์ชันลบแปลงบ้าน 🌟
  const handleDeletePlot = (plotId: any) => {
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
        showToast(`ลบแปลง ${plotId} ออกจากระบบแล้ว`, "success");
      } catch (e: any) {
        showAlert('ข้อผิดพลาด', e.message);
      } finally {
        setIsSubmitting(false);
      }
    });
  };

  // 🌟 ฟังก์ชันจัดการสถานะลูกค้าและบ้านเสร็จ
  const handleTogglePlotCustomer = async (plotId: any, currentStatus: boolean) => {
    setIsSubmitting(true);
    try {
      const { error } = await supabase.from('plots').update({ has_customer: !currentStatus }).eq('id', plotId);
      if (error) throw error;
      await fetchAllData();
      showToast(!currentStatus ? `กำหนดให้แปลง ${plotId} มีลูกค้าแล้ว 👤` : `ยกเลิกสถานะลูกค้าของแปลง ${plotId} แล้ว`, "success");
    } catch (e: any) { showAlert('ข้อผิดพลาด', e.message); }
    setIsSubmitting(false);
  };

  const handleTogglePlotCompleted = async (plotId: any, currentStatus: boolean, actualProgress: number, hasCustomer: boolean) => {
    if (!currentStatus && !hasCustomer) {
      return showAlert('ไม่อนุญาต ❌', 'ไม่สามารถโอนบ้านได้เนื่องจากแปลงนี้ยังไม่มีลูกค้าจองครับ (กรุณากดระบุลูกค้าก่อน)');
    }
    
    let confirmTitle = 'ยืนยันสถานะ';
    let confirmMsg = currentStatus ? `ยกเลิกสถานะ "โอนแล้ว" ของแปลง ${plotId}?` : `ยืนยันว่าบ้านแปลง ${plotId} โอนกรรมสิทธิ์เรียบร้อยแล้ว ใช่หรือไม่?`;
    
    if (!currentStatus && actualProgress < 100) {
      confirmTitle = '⚠️ ยืนยันการโอนก่อนเก็บงาน';
      confirmMsg = `ความคืบหน้าการก่อสร้างเพิ่งถึง ${actualProgress}% คุณยืนยันที่จะตั้งสถานะว่า "โอนบ้านก่อนเก็บงาน" ใช่หรือไม่? (บ้านจะโชว์เป็น โอนแล้ว-รอเก็บงาน)`;
    }
    
    showConfirm(confirmTitle, confirmMsg, async () => {
      setIsSubmitting(true);
      try {
        const { error } = await supabase.from('plots').update({ is_completed: !currentStatus }).eq('id', plotId);
        if (error) throw error;
        await fetchAllData();
        closeDialog();
        showToast(!currentStatus ? `แปลง ${plotId} โอนกรรมสิทธิ์เรียบร้อยแล้ว! 🔑` : `ยกเลิกสถานะโอนแล้วของแปลง ${plotId} แล้ว`, "success");
      } catch (e: any) { showAlert('ข้อผิดพลาด', e.message); }
      setIsSubmitting(false);
    });
  };

  // 🌟 ฟังก์ชันเปิดหน้าต่างแก้ไข และดึงค่าเดิมมาใส่ในช่องกรอก
  const handleEditPlot = (plot: any) => {
    setEditPlotModal({
      isOpen: true,
      plot: plot,
      id: plot.id,
      house_type_id: plot.house_type_id,
      foreman_name: plot.foreman_name || '',
      selling_price: plot.selling_price || ''
    });
  };

  // 🌟 ฟังก์ชันบันทึกการแก้ไขลงฐานข้อมูล Supabase
  const handleUpdatePlot = async () => {
    if (!editPlotModal.id.trim() || !editPlotModal.house_type_id) return showAlert('แจ้งเตือน', 'กรุณากรอกข้อมูลให้ครบถ้วน');
    setIsSubmitting(true);

    const oldId = editPlotModal.plot?.id; // ชื่อเดิม (เช่น A-01)
    const newId = editPlotModal.id.trim(); // ชื่อใหม่ (เช่น A-02)

    try {
      // 1. อัปเดตตารางแปลงหลัก (plots)
      const { error: plotError } = await supabase
        .from('plots')
        .update({
          id: newId,
          house_type_id: editPlotModal.house_type_id,
          foreman_name: editPlotModal.foreman_name,
          selling_price: parseFloat(editPlotModal.selling_price) || 0
        })
        .eq('id', oldId);
      if (plotError) throw plotError;

      // 2. 🌟 สำคัญ: อัปเดตชื่อใน "ข้อมูลผังโครงการ" (layout_data) เพื่อไม่ให้ชื่อในแผนที่หาย
      if (selectedProject && selectedProject.layout_data) {
        const updatedLayout = selectedProject.layout_data.map((cell: any) => {
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
          setMapGrid(updatedProj.layout_data.filter((c: any) => c.type !== 'config'));
        }
      }

      showToast('แก้ไขข้อมูลและอัปเดตผังโครงการเรียบร้อยแล้ว', "success");
    } catch (e: any) {
      showAlert('ข้อผิดพลาด', e.message);
    } finally {
      setIsSubmitting(false);
    }
  };
  // 🌟 1. ฟังก์ชันเปิดหน้าต่างแก้ไขโครงการ
  const handleEditProject = (proj: any) => {
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
      showToast('เปลี่ยนชื่อโครงการเรียบร้อยแล้ว', "success");
    } catch (e: any) {
      showAlert('ข้อผิดพลาด', e.message);
    } finally {
      setIsSubmitting(false);
    }
  };
  const handleSendDefect = async () => {
    if ((!newDefectText.trim() && defectFiles.length === 0) || isSubmittingDefect) return;
    setIsSubmittingDefect(true);
    try {
      let imageUrls: any[] = [];
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

          const path = `${defectModal.plotId}/defect-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
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
    } catch (e: any) { showAlert('Error', (e as Error).message); } setIsSubmittingDefect(false);
  };
  const handleUploadOverviewImage = async (file: File) => {
    if (!selectedPlot) return;
    try {
      const comp = await compressImageNative(file);
      const path = `${selectedPlot.id}/overview-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const { error } = await supabase.storage.from('task_images').upload(path, comp);
      if (error) throw new Error('อัปโหลดรูปหน้าบ้านไม่สำเร็จ');
      const overviewUrl = supabase.storage.from('task_images').getPublicUrl(path).data.publicUrl;
      await supabase.from('plots').update({ overview_image_url: overviewUrl }).eq('id', selectedPlot.id);
      await fetchAllData();
      showToast('อัปเดตภาพรวมหน้าบ้านเรียบร้อยแล้ว', "success");
    } catch (e: any) {
      showAlert('Error', (e as Error).message);
    }
  };

  const handleSendPost = async () => {
    if ((!inputText.trim() && selectedFiles.length === 0) || isSending) return;
    setIsSending(true);
    try {
      let imageUrls: any[] = [];
      if (selectedFiles.length > 0) {
        imageUrls = await Promise.all(selectedFiles.map(async (f) => {
          const comp = await compressImageNative(f.file); // 🌟 ใช้ Native Compression ลบ Error 🌟
          const path = `${selectedPlot.id}/${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          const { error } = await supabase.storage.from('task_images').upload(path, comp);
          if (error) throw new Error('อัปโหลดรูปไม่สำเร็จ กรุณาลองใหม่');
          return supabase.storage.from('task_images').getPublicUrl(path).data.publicUrl;
        }));
      }
      const actionLabel = progressValue === 100 ? 'ส่งงาน 100%' : 'อัปเดตงาน';
      const { error } = await supabase.from('task_updates').insert([{ plot_id: selectedPlot.id, task_template_id: selectedTask.id, user_name: loggedInUser.username, role: currentUserRole, action: actionLabel, text_content: inputText || actionLabel, progress: progressValue, is_completed: progressValue === 100, image_url: imageUrls.join(','), weather_info: weatherInfo ? `${weatherInfo.currentDetails.icon} ${weatherInfo.currentDetails.text} (${weatherInfo.currentTemp}°C)` : null }]);
      if (error) throw error;

      // 🌟 ดึงประวัติงานสดๆ ทันที เพื่ออัปเดต chat view ให้ผู้ใช้เห็นว่าส่งแล้ว (Instant UI Feedback)
      const { data } = await supabase.from('task_updates').select('*').eq('task_template_id', selectedTask.id).eq('plot_id', selectedPlot.id).order('created_at', { ascending: true });
      setUpdates(data || []); setInputText(''); setSelectedFiles([]);
      
      // 🌟 โหลดข้อมูลภาพรวมเบื้องหลัง (Background refresh) โดยไม่ใช้ await เพื่อไม่ให้แชทกระตุก
      // ให้ Database Trigger เป็นคนจัดการ update plot_task_assignments อัตโนมัติ (Single Source of Truth)
      fetchAllData();
    } catch (e: any) { showAlert('Error', (e as Error).message); } setIsSending(false);
  };
  // 🗑️ ฟังก์ชันลบประวัติการรายงานงาน (Recall Post)
  const handleDeleteUpdate = async (updateId: any, taskTemplateId: any, plotId: any) => {
    showConfirm(
      'ยืนยันการลบรายงาน ⚠️',
      'คุณแน่ใจหรือไม่ว่าต้องการลบประวัติรายงานชิ้นนี้? ระบบจะทำการคำนวณเปอร์เซ็นต์ความคืบหน้าย้อนกลับไปยังครั้งก่อนหน้าให้อัตโนมัติครับ',
      async () => {
        setIsSending(true);
        try {
          // 1. ยิงคำสั่งลบแถวใน Supabase
          const { error } = await supabase.from('task_updates').delete().eq('id', updateId);
          if (error) throw error;

          // 2. ดึงประวัติแชทที่เหลือในงวดงานนี้กลับมาโชว์ทันที (Instant UI Feedback)
          const { data } = await supabase.from('task_updates')
            .select('*')
            .eq('task_template_id', taskTemplateId)
            .eq('plot_id', plotId)
            .order('created_at', { ascending: true });

          setUpdates(data || []);
          // คำนวณค่า progress ปัจจุบันใหม่จากแถวสุดท้ายที่เหลืออยู่ (ถ้าไม่เหลือเลยให้เป็น 0)
          setProgressValue(data?.length ? data[data.length - 1].progress : 0);

          // 3. สั่งโหลดข้อมูลภาพรวมใหม่ทั้งหมดอยู่เบื้องหลัง (Background refresh) เพื่อรีเซ็ต % แผนผังและแดชบอร์ด
          fetchAllData();

          closeDialog();
          showAlert('สำเร็จ ✨', 'ลบประวัติการอัปเดตงานและปรับปรุงความคืบหน้าเรียบร้อยแล้วครับ');
        } catch (e: any) {
          showAlert('Error', (e as Error).message);
        }
        setIsSending(false);
      }
    );
  };
  const handleReviewAction = async (isApproved: any) => {
    setIsSending(true); const finalP = isApproved ? 100 : 95; const roleLabel = currentUserRole === 'Site Engineer' ? 'Site Engineer' : 'QC'; const actionLabel = isApproved ? `${roleLabel} อนุมัติ` : `${roleLabel} แจ้งแก้ไข`;
    try {
      let imageUrls: any[] = [];
      if (selectedFiles.length > 0) {
        imageUrls = await Promise.all(selectedFiles.map(async (f) => {
          const comp = await compressImageNative(f.file); // 🌟 ใช้ Native Compression ลบ Error 🌟
          const path = `${selectedPlot.id}/review-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          const { error } = await supabase.storage.from('task_images').upload(path, comp);
          if (error) throw new Error('อัปโหลดรูปไม่สำเร็จ กรุณาลองใหม่');
          return supabase.storage.from('task_images').getPublicUrl(path).data.publicUrl;
        }));
      }
      const { error } = await supabase.from('task_updates').insert([{ plot_id: selectedPlot.id, task_template_id: selectedTask.id, user_name: loggedInUser.username, role: currentUserRole, action: actionLabel, text_content: inputText || (isApproved ? 'งานเรียบร้อยดี ตรวจผ่าน' : 'พบข้อบกพร่อง กรุณาแก้ไข'), progress: finalP, is_completed: finalP === 100, image_url: imageUrls.join(','), weather_info: weatherInfo ? `${weatherInfo.currentDetails.icon} ${weatherInfo.currentDetails.text} (${weatherInfo.currentTemp}°C)` : null }]);
      if (error) throw error;
      if (!isApproved) {
        const notifPayload = [];
        if (currentUserRole === 'Site Engineer') { notifPayload.push({ plot_id: selectedPlot.id, task_template_id: selectedTask.id, message: `ตีกลับงานโดย Site Engineer: ${selectedTask.task_name}`, target_user: selectedPlot.foreman, target_role: 'Foreman' }); }
        else if (currentUserRole === 'QC') { notifPayload.push({ plot_id: selectedPlot.id, task_template_id: selectedTask.id, message: `ตีกลับงานโดย QC: ${selectedTask.task_name}`, target_user: selectedPlot.foreman, target_role: 'Foreman' }); notifPayload.push({ plot_id: selectedPlot.id, task_template_id: selectedTask.id, message: `QC ตีกลับงานที่อนุมัติแล้ว: ${selectedTask.task_name}`, target_user: null, target_role: 'Site Engineer' }); }
        if (notifPayload.length > 0) await supabase.from('notifications').insert(notifPayload);
      }

      // 🌟 Restore original logic: Update Actual Start and Finish for QC Review 🌟
      const revAssignment = assignments.find((a: any) => a.plot_id === selectedPlot.id && a.task_template_id === selectedTask.id);
      const revPayload: any = { current_progress: finalP };
      if (finalP > 0 && (!revAssignment || !revAssignment.actual_start_date)) {
        revPayload.actual_start_date = new Date().toISOString();
      }
      if (finalP === 100 && (!revAssignment || !revAssignment.actual_end_date)) {
        revPayload.actual_end_date = new Date().toISOString();
      } else if (finalP < 100) {
        revPayload.actual_end_date = null;
      }
      await supabase.from('plot_task_assignments').upsert({
        plot_id: selectedPlot.id,
        task_template_id: selectedTask.id,
        ...revPayload
      }, { onConflict: 'plot_id,task_template_id' });

      // 🌟 อัปเดตสถานะ Defect เป็น resolved และบันทึกเวลา 🌟
      if (isApproved) {
        await supabase.from('defects')
          .update({ status: 'resolved', resolved_at: new Date().toISOString() })
          .eq('plot_id', selectedPlot.id)
          .eq('task_id', selectedTask.id)
          .eq('status', 'pending');
      }

      await fetchAllData();
      // 🌟 ดึงประวัติงานสดๆ หลัง fetchAllData เพื่ออัปเดต chat view
      const { data } = await supabase.from('task_updates').select('*').eq('task_template_id', selectedTask.id).eq('plot_id', selectedPlot.id).order('created_at', { ascending: true });
      setUpdates(data || []); setProgressValue(finalP); setInputText(''); setSelectedFiles([]);
    } catch (e: any) { showAlert('Error', (e as Error).message); } setIsSending(false);
  };

  // 🌟 Print Export Logic 🌟
  const handleOpenExportModal = () => {
    let imgs: any[] = [];
    updates.forEach(u => {
      if (u.image_url) { imgs = [...imgs, ...u.image_url.split(',').filter((url: string) => url.trim() !== '')]; }
    });
    setAllTaskImages(imgs); setSelectedExportImages(imgs); setExportModalOpen(true);
  };
  const toggleExportImage = (url: any) => {
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

  const displayPlots = useMemo(() => plots.filter(p => {
    const isCurrentProject = p.project_name === selectedProject?.name;
    const matchSearch = p.id.toLowerCase().includes(searchPlot.toLowerCase());
    const matchForeman = filterForeman === '' || p.foreman === filterForeman;
    const roleAllowed = !isForeman || p.foreman === loggedInUser?.username;
    return isCurrentProject && matchSearch && matchForeman && roleAllowed;
  }), [plots, selectedProject?.name, searchPlot, filterForeman, isForeman, loggedInUser?.username]);

  const inspectionQueue = useMemo(() => {
    if (!(isSiteEngineer || isQC || isAdmin || isOwner)) return [];
    const queue: any[] = [];
    Object.values(latestUpdatesMap).forEach((upd: any) => {
      const task = taskTemplates.find(t => t.id === upd.task_template_id); const plot = plots.find(p => p.id === upd.plot_id); if (!task || !plot) return;
      const isPendingSEItem = isSiteEngineer && upd.progress === 100 && (upd.action === 'ส่งงาน 100%' || upd.role === 'Foreman');
      const isPendingQCItem = isQC && upd.progress === 100 && upd.action === 'Site Engineer อนุมัติ';
      const isAdminView = (isAdmin || isOwner) && upd.progress === 100 && (upd.action === 'ส่งงาน 100%' || upd.action === 'Site Engineer อนุมัติ');
      if (isPendingSEItem || isPendingQCItem || isAdminView) queue.push({ ...upd, task_name: task.task_name, plot_id: plot.id, project_name: plot.project_name, foreman: plot.foreman, time: new Date(upd.created_at).getTime(), statusFor: isPendingQCItem || (isAdminView && upd.action === 'Site Engineer อนุมัติ') ? 'QC' : 'Site Engineer', isUrgent: (Date.now() - new Date(upd.created_at).getTime()) > 172800000 });
    });
    queue.sort((a, b) => { if (inspectionSort === 'plot') return a.plot_id.localeCompare(b.plot_id); return b.time - a.time; });
    return queue;
  }, [latestUpdatesMap, taskTemplates, plots, isSiteEngineer, isQC, isAdmin, isOwner, inspectionSort]);

  const urgentQueueCount = useMemo(() => inspectionQueue.filter(q => q.isUrgent).length, [inspectionQueue]);
  const displayInspectionQueue = useMemo(() => inspectionQueue.filter(q => inspectionFilterTab === 'all' || (inspectionFilterTab === 'urgent' && q.isUrgent)), [inspectionQueue, inspectionFilterTab]);

  const lastUpd = updates.length > 0 ? updates[updates.length - 1] : null;
  const isPendingSE = lastUpd?.progress === 100 && (lastUpd?.action === 'ส่งงาน 100%' || lastUpd?.role === 'Foreman');
  const isPendingQC = lastUpd?.progress === 100 && lastUpd?.action === 'Site Engineer อนุมัติ';
  const isTaskCompleted = lastUpd?.progress === 100 && (lastUpd?.action === 'QC อนุมัติ' || lastUpd?.action === 'QC อนุมัติผ่าน');
  const currentAssignment = assignments.slice().reverse().find(a => String(a.plot_id) === String(selectedPlot?.id) && String(a.task_template_id) === String(selectedTask?.id));
  const isLockedForForeman = isForeman && !currentAssignment;

  const plotBounds: { [key: string]: any } = {};
  mapGrid.filter(c => c.type === 'plot').forEach(c => {
    if (!plotBounds[c.plotId]) plotBounds[c.plotId] = { minX: c.x, maxX: c.x, minY: c.y, maxY: c.y };
    else { plotBounds[c.plotId].minX = Math.min(plotBounds[c.plotId].minX, c.x); plotBounds[c.plotId].maxX = Math.max(plotBounds[c.plotId].maxX, c.x); plotBounds[c.plotId].minY = Math.min(plotBounds[c.plotId].minY, c.y); plotBounds[c.plotId].maxY = Math.max(plotBounds[c.plotId].maxY, c.y); }
  });

  const totalPlotsCount = plots.length;
  const completedPlotsCount = useMemo(() => plots.filter(p => p.progress === 100).length, [plots]);
  const readyForSalePlotsCount = useMemo(() => plots.filter(p => p.sale_status === 'ready_for_sale').length, [plots]);
  const pendingFinishesPlotsCount = useMemo(() => plots.filter(p => p.is_completed && p.progress < 100).length, [plots]);
  const customerWaitingPlotsCount = useMemo(() => plots.filter(p => p.has_customer && !p.is_completed).length, [plots]);
  const delayedPlotsCount = useMemo(() => plots.filter(p => getPlotOverallStatus(p.id).status === 'delayed').length, [plots, latestUpdatesMap, schedules, taskTemplates]);
  const activePlotsCount = totalPlotsCount - completedPlotsCount;
  const totalReworks = (allUpdatesRecord || []).filter(u => u.action.includes('แจ้งแก้ไข') || u.action.includes('ไม่อนุมัติ')).length;

  let globalMinDate = Infinity; let globalMaxDate = -Infinity;
  let plotPlanStart = Infinity; let plotPlanEnd = -Infinity;
  let plotActualStart = Infinity; let plotActualEnd = -Infinity;
  let hasAnySchedule = false; const todayTs = new Date().setHours(0, 0, 0, 0);

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

  const minD = new Date(globalMinDate); minD.setHours(0, 0, 0, 0);
  const maxD = new Date(globalMaxDate); maxD.setHours(0, 0, 0, 0);

  const chartStart = minD.getTime() - (2 * 86400000);
  const chartEnd = maxD.getTime() + (3 * 86400000);

  // 🎯 แก้ปัญหาเส้นทะลุ: คำนวณจำนวนวันทั้งหมดแบบเป๊ะๆ (+1 เพื่อให้วันสุดท้ายเต็มช่อง)
  const totalChartDays = Math.round((chartEnd - chartStart) / 86400000) + 1;
  const totalChartMs = totalChartDays * 86400000;

  const getChartLeft = (timestamp: any) => {
    const d = new Date(timestamp); d.setHours(0, 0, 0, 0);
    return Math.max(0, ((d.getTime() - chartStart) / totalChartMs) * 100);
  };

  const getChartWidth = (startTs: any, endTs: any) => {
    const dStart = new Date(startTs); dStart.setHours(0, 0, 0, 0);
    const dEnd = new Date(endTs); dEnd.setHours(0, 0, 0, 0);
    return Math.max(0, (((dEnd.getTime() + 86400000) - dStart.getTime()) / totalChartMs) * 100);
  };

  const timeMarkers: any[] = [];
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
  const isSummaryDelayed = daysElapsed > 0 && selectedPlot?.progress < (daysElapsed / totalPlannedDays) * 100 && (daysElapsed / totalPlannedDays) * 100 - selectedPlot?.progress > 10;

  // ==========================================
  // 6. RENDER UI
  // ==========================================
  if (!loggedInUser) {
    return (
      <LoginView
        loginData={loginData}
        setLoginData={setLoginData}
        allUsers={allUsers}
        handleLogin={handleLogin}
        dialogConfig={dialogConfig}
        closeDialog={closeDialog}
      />
    );
  }

  return (
    <div className={`min-h-screen font-sans text-[#1d1d1f] transition-all duration-500 ${isMobilePreview ? 'bg-slate-900 flex items-center justify-center py-4 sm:py-10' : 'bg-[#f5f5f7]'}`}>

      {/* 🖨️ CSS สำหรับการพิมพ์หน้ากระดาษ A4 🖨️ */}
      <style dangerouslySetInnerHTML={{
        __html: `
        @media print {
          @page { size: A4 portrait; margin: 10mm; }
          /* บังคับให้บราวเซอร์พริ้นต์สีพื้นหลังและกรอบออกมาให้ครบ */
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}} />

      <div className={`${isMobilePreview ? '@container w-[390px] h-[844px] bg-slate-50 border-[14px] border-slate-950 rounded-[3rem] shadow-2xl relative overflow-hidden flex flex-col' : '@container flex h-screen w-full overflow-hidden'} print:hidden`}>

        {/* Modals & Dialogs */}
        {assignModal.isOpen && (
          <div className="absolute inset-0 z-[600] bg-black/40 backdrop-blur-xl flex items-center justify-center p-4 fixed transition-all">
            <div className="bg-white rounded-[2rem] shadow-2xl max-w-sm w-full p-6 space-y-5 animate-in zoom-in-95 duration-200">
              <div><h3 className="text-xl font-black text-slate-800 italic uppercase">Assign Contractor</h3><p className="text-sm text-slate-500 font-bold tracking-widest">{selectedPlot?.id} - {assignModal.task?.task_name}</p></div>
              <div className="space-y-4">
                {/* 🌟 อัปเกรด: ระบบค้นหาและเลือกช่าง (Searchable Dropdown) */}
                <div className="relative z-50">
                  <label className="block text-sm font-black text-slate-500 mb-1 uppercase tracking-widest">ค้นหา / เลือกช่างผู้รับเหมา</label>
                  {contractors.length === 0 ? (
                    <p className="text-base text-rose-500 font-bold italic">ไม่พบรายชื่อช่างในระบบ</p>
                  ) : (
                    <div className="relative">
                      {/* กล่อง Input ค้นหา */}
                      <div className="flex items-center bg-slate-50 border border-slate-200 rounded-xl focus-within:border-emerald-500 focus-within:ring-2 focus-within:ring-emerald-500/20 overflow-hidden pr-3 transition-all">
                        <Search size={16} className="text-slate-400 ml-4 shrink-0" />
                        <input
                          type="text"
                          value={assignModal.name}
                          onChange={(e) => {
                            const val = e.target.value;
                            const c = contractors.find(x => x.name.toLowerCase() === val.toLowerCase());
                            setAssignModal({ ...assignModal, name: val, phone: c?.phone || '', showDropdown: true });
                          }}
                          onFocus={() => setAssignModal({ ...assignModal, showDropdown: true })}
                          onBlur={() => setTimeout(() => setAssignModal((prev: any) => ({ ...prev, showDropdown: false })), 200)}
                          placeholder="พิมพ์ชื่อช่างเพื่อค้นหา..."
                          className="w-full px-3 py-3 font-bold outline-none text-slate-700 bg-transparent text-sm placeholder:text-slate-400"
                        />
                        <ChevronRight size={16} className={`text-slate-400 shrink-0 transition-transform ${assignModal.showDropdown ? '-rotate-90' : 'rotate-90'}`} />
                      </div>

                      {/* รายการ Dropdown ที่จะโผล่มาตอนคลิกหรือพิมพ์ */}
                      {assignModal.showDropdown && (
                        <div className="absolute z-[700] w-full mt-2 bg-white border border-slate-200 rounded-xl shadow-2xl max-h-48 overflow-y-auto py-2 animate-in fade-in slide-in-from-top-2 custom-scrollbar">
                          {contractors.filter(c => c.name.toLowerCase().includes((assignModal.name || '').toLowerCase())).length === 0 ? (
                            <div className="px-4 py-3 text-sm font-bold text-slate-400 text-center">ไม่พบชื่อช่างที่ค้นหา</div>
                          ) : (
                            contractors.filter(c => c.name.toLowerCase().includes((assignModal.name || '').toLowerCase())).map(c => (
                              <div
                                key={c.id}
                                onClick={() => setAssignModal({ ...assignModal, name: c.name, phone: c.phone, showDropdown: false })}
                                className="px-4 py-2.5 hover:bg-emerald-50 cursor-pointer font-bold text-slate-700 text-sm transition-colors flex items-center justify-between border-b border-slate-50 last:border-0"
                              >
                                <span>{c.name}</span>
                                {c.phone && <span className="text-[10px] text-slate-400 font-medium tracking-wider">📞 {c.phone}</span>}
                              </div>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div><label className="block text-sm font-black text-slate-500 mb-1 uppercase tracking-widest">เบอร์โทรศัพท์ (อัตโนมัติ)</label><input type="text" value={assignModal.phone} readOnly className="w-full bg-black/5 border-none rounded-2xl px-5 py-4 font-medium text-[#86868b] cursor-not-allowed" /></div>
              </div>
              <div className="flex gap-3 w-full mt-2">
                <button onClick={() => setAssignModal({ isOpen: false, task: null, name: '', phone: '' })} className="flex-1 bg-slate-100 text-slate-600 font-bold py-3.5 rounded-xl hover:bg-slate-200">ยกเลิก</button>
                <button onClick={handleAssignContractor} disabled={isSubmitting || !assignModal.name} className="flex-1 bg-emerald-600 text-white font-bold py-3.5 rounded-xl hover:bg-emerald-700 flex justify-center items-center gap-2 disabled:opacity-50">{isSubmitting ? <Loader2 className="animate-spin" size={16} /> : 'บันทึกข้อมูล'}</button>
              </div>
            </div>
          </div>
        )}

        {/* 🌟 Modal สำหรับ Export รูปตั้งเบิก 🌟 */}
        {exportModalOpen && (
          <div className="absolute inset-0 z-[600] bg-black/40 backdrop-blur-xl flex items-center justify-center p-4 fixed transition-all">
            <div className="bg-white rounded-[2rem] shadow-2xl max-w-3xl w-full max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
              <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                <div>
                  <h3 className="text-xl font-black text-slate-800 italic uppercase flex items-center gap-2"><Printer className="text-blue-600" /> ส่งออกรูปถ่ายตั้งเบิก</h3>
                  <p className="text-sm text-slate-500 font-bold tracking-widest mt-1">แปลง: {selectedPlot?.id} - {selectedTask?.task_name}</p>
                </div>
                <button onClick={() => setExportModalOpen(false)} className="p-2 hover:bg-slate-200 rounded-full transition-colors text-slate-400"><X size={24} /></button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 bg-slate-100">
                {allTaskImages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-40 text-slate-400 font-bold"><ImageIcon size={48} className="mb-4 opacity-50" /> ไม่พบรูปภาพในงานนี้</div>
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
                              {isSelected ? <CheckSquare className="text-emerald-500" size={20} /> : <Square className="text-slate-300" size={20} />}
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
                  <Printer size={18} /> พิมพ์รายงาน (A4)
                </button>
              </div>
            </div>
          </div>
        )}
        {/* 🌟 Modal สำหรับ Daily Activity Report 🌟 */}
        {activityReportOpen && (() => {
          const targetDate = activityReportDate;
          const activities: any[] = [];

          // 1. ดึงข้อมูลอัปเดตงาน (ดึงทุกคนยกเว้น Admin)
          allUpdatesRecord.filter(u => new Date(u.created_at).toLocaleDateString('en-CA') === targetDate && u.role !== 'Admin').forEach(u => {
            const task = taskTemplates.find(t => t.id === u.task_template_id);
            activities.push({ time: new Date(u.created_at).getTime(), timeStr: new Date(u.created_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }), user: u.user_name, role: u.role, plot: u.plot_id, taskName: task ? task.task_name : 'อัปเดตงาน', action: u.action, detail: u.text_content || '-', type: 'update' });
          });

          // 2. ดึงข้อมูลแจ้งซ่อม
          defects.filter(d => new Date(d.created_at).toLocaleDateString('en-CA') === targetDate).forEach(d => {
            const user = allUsers.find(u => u.username === d.reported_by);
            if (user?.role === 'Admin') return;
            const task = taskTemplates.find(t => t.id === d.task_id);
            activities.push({ time: new Date(d.created_at).getTime(), timeStr: new Date(d.created_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }), user: d.reported_by, role: user ? user.role : 'Unknown', plot: d.plot_id, taskName: task ? task.task_name : 'ไม่ระบุงาน', action: 'แจ้ง Defect / ซ่อม', detail: d.description || 'แนบรูปภาพ', type: 'defect' });
          });

          // เรียงตามเวลาล่าสุดขึ้นก่อน
          activities.sort((a, b) => b.time - a.time);

          return (
            <div className="absolute inset-0 z-[800] bg-black/40 backdrop-blur-xl flex items-center justify-center p-4 fixed transition-all">
              <div className="bg-white rounded-[2rem] shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
                <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                  <div>
                    <h3 className="text-xl font-black text-slate-800 italic uppercase flex items-center gap-2"><ClipboardList className="text-indigo-600" /> Daily Activity Report</h3>
                    <p className="text-sm text-slate-500 font-bold mt-1">รายงานสรุปการทำงานรายวัน (Print as PDF)</p>
                  </div>
                  <button onClick={() => setActivityReportOpen(false)} className="p-2 hover:bg-slate-200 rounded-full transition-colors text-slate-400"><X size={24} /></button>
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
                            <span className="text-[10px] font-black bg-white/20 text-white px-2.5 py-1 rounded-lg uppercase tracking-wider mint-wider">{data.role}</span>
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
                    <Printer size={18} /> พิมพ์รายงาน (A4)
                  </button>
                </div>
              </div>
            </div>
          );
        })()}
        {copyModalOpen && (
          <div className="absolute inset-0 z-[600] bg-black/40 backdrop-blur-xl flex items-center justify-center p-4 fixed transition-all">
            <div className="bg-white rounded-[2rem] shadow-2xl max-w-sm w-full p-6 space-y-5 animate-in zoom-in-95 duration-200">
              <div><h3 className="text-xl font-black text-slate-800 italic uppercase flex items-center gap-2"><Copy className="text-blue-600" /> Copy Schedule</h3><p className="text-sm text-slate-500 font-bold tracking-widest mt-1">คัดลอกแผนงานจากแปลงต้นแบบ</p></div>
              <div className="space-y-4">

                {/* ช่อง 1: เลือกแปลง */}
                <div>
                  <label className="block text-sm font-black text-slate-500 mb-2 uppercase tracking-widest">เลือกแปลงต้นทาง (แบบบ้านเดียวกัน)</label>
                  <select
                    value={copySourcePlot}
                    onChange={(e) => {
                      const selectedPlotId = e.target.value;
                      setCopySourcePlot(selectedPlotId);
                      // 🎯 หา "วันที่ของงานแรกสุด" ของแปลงที่เลือกมาใส่เป็นค่าเริ่มต้นให้อัตโนมัติ
                      const sourceTasks = taskTemplates.filter(t => t.house_type_id === selectedPlot?.house_type_id).sort((a, b) => a.task_order - b.task_order);
                      let foundStartDate = '';
                      for (const task of sourceTasks) {
                        const sourcePlan = schedules[`${selectedPlotId}-${task.id}`];
                        if (sourcePlan && sourcePlan.planned_start) {
                          foundStartDate = sourcePlan.planned_start;
                          break;
                        }
                      }
                      setCopyStartDate(foundStartDate);
                    }}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 font-bold outline-none focus:border-blue-500 text-slate-700 cursor-pointer"
                  >
                    <option value="" disabled>-- เลือกแปลงต้นทาง --</option>
                    {plots.filter(p => p.house_type_id === selectedPlot?.house_type_id && p.id !== selectedPlot?.id).map(p => (<option key={p.id} value={p.id}>{p.id} ({p.foreman || 'ไม่ระบุโฟร์แมน'})</option>))}
                  </select>
                </div>

                {/* ช่อง 2: กำหนดวันเริ่มงาน (จะโผล่มาเมื่อเลือกแปลงแล้ว) */}
                {copySourcePlot && (
                  <div className="animate-in fade-in slide-in-from-top-2">
                    <label className="block text-sm font-black text-blue-600 mb-2 uppercase tracking-widest">กำหนดวันเริ่มงานใหม่ (งานที่ 1)</label>
                    <input
                      type="date"
                      value={copyStartDate}
                      onChange={(e) => setCopyStartDate(e.target.value)}
                      className="w-full bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 font-bold outline-none focus:border-blue-500 text-blue-700"
                    />
                    <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 flex items-start gap-2 mt-3"><AlertCircle size={16} className="text-blue-500 shrink-0 mt-0.5" /><p className="text-[10px] font-bold text-slate-500 leading-relaxed">💡 ระบบจะคำนวณและ <span className="text-blue-600">เลื่อนวันทำงานของทุกๆ งวดงาน ให้สอดคล้องกันอัตโนมัติ</span> โดยคงระยะห่างไว้เท่าต้นฉบับครับ</p></div>
                  </div>
                )}
              </div>

              <div className="flex gap-3 w-full mt-2 border-t border-slate-100 pt-4">
                <button onClick={() => { setCopyModalOpen(false); setCopySourcePlot(''); setCopyStartDate(''); }} className="flex-1 bg-slate-100 text-slate-600 font-bold py-3.5 rounded-xl hover:bg-slate-200">ยกเลิก</button>
                <button onClick={handleConfirmCopy} disabled={!copySourcePlot || !copyStartDate} className="flex-1 bg-blue-600 text-white font-bold py-3.5 rounded-xl hover:bg-blue-700 flex justify-center items-center gap-2 disabled:opacity-50"><Download size={16} /> ดึงข้อมูล</button>
              </div>
            </div>
          </div>
        )}

        {/* 🌟 หน้าต่างซูมรูปภาพ (ตั้ง z-index ให้สูงสุดระดับ 999999 เพื่อไม่ให้โดน Pop-up อื่นบัง) */}
        {(fullImageUrl || galleryImages.length > 0) && (
          <div className="fixed inset-0 z-[999999] bg-black/90 backdrop-blur-sm flex items-center justify-center p-4 cursor-zoom-out" onClick={() => { setFullImageUrl(null); setGalleryImages([]); }}>
            <button className="absolute top-6 right-6 text-white hover:text-rose-500 transition-colors bg-white/10 p-3 rounded-full backdrop-blur-md" onClick={() => { setFullImageUrl(null); setGalleryImages([]); }}><X size={28} /></button>
            
            {galleryImages.length > 0 && (
              <>
                <button 
                  onClick={(e) => { e.stopPropagation(); setGalleryIndex(p => Math.max(p - 1, 0)); }} 
                  disabled={galleryIndex === 0} 
                  className="absolute left-4 sm:left-10 p-3 sm:p-5 bg-white/10 hover:bg-white/20 text-white rounded-full disabled:opacity-0 transition z-50 backdrop-blur-md"
                >
                  <ChevronRight size={32} className="rotate-180" />
                </button>
                <button 
                  onClick={(e) => { e.stopPropagation(); setGalleryIndex(p => Math.min(p + 1, galleryImages.length - 1)); }} 
                  disabled={galleryIndex === galleryImages.length - 1} 
                  className="absolute right-4 sm:right-10 p-3 sm:p-5 bg-white/10 hover:bg-white/20 text-white rounded-full disabled:opacity-0 transition z-50 backdrop-blur-md"
                >
                  <ChevronRight size={32} />
                </button>
              </>
            )}

            <div className="relative flex flex-col items-center justify-center" onClick={(e) => e.stopPropagation()}>
               <img src={galleryImages.length > 0 ? galleryImages[galleryIndex].url : fullImageUrl} className="max-w-full max-h-[85vh] object-contain rounded-2xl shadow-2xl" alt="Full size" />
               {galleryImages.length > 0 && galleryImages[galleryIndex].label && (
                 <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/70 text-white px-4 py-2 rounded-lg backdrop-blur-sm text-sm sm:text-base font-bold whitespace-nowrap shadow-lg border border-white/20">
                   {galleryImages[galleryIndex].label}
                 </div>
               )}
            </div>
          </div>
        )}

        {dialogConfig.isOpen && (
          <div className="fixed inset-0 z-[600] bg-black/40 backdrop-blur-xl flex items-center justify-center p-4 transition-all"><div className="bg-white rounded-[2rem] shadow-2xl min-w-[320px] max-w-sm w-full p-6 text-center space-y-4"><div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-2 ${dialogConfig.type === 'confirm' ? 'bg-rose-100 text-rose-600' : 'bg-blue-100 text-blue-600'}`}><AlertTriangle size={32} /></div><h3 className="text-xl font-black">{dialogConfig.title}</h3><p className="text-slate-500 font-medium">{dialogConfig.message}</p><div className="flex gap-3 w-full mt-4">{dialogConfig.type === 'confirm' ? (<><button onClick={closeDialog} className="flex-1 bg-slate-100 text-slate-600 font-bold py-3.5 rounded-xl hover:bg-slate-200">ยกเลิก</button><button onClick={dialogConfig.onConfirm || undefined} className="flex-1 bg-rose-600 text-white font-bold py-3.5 rounded-xl hover:bg-rose-700">ยืนยัน</button></>) : (<button onClick={closeDialog} className="w-full bg-slate-800 text-white font-bold py-3.5 rounded-xl">รับทราบ</button>)}</div></div></div>
        )}



        {/* 🧭 Left Sidebar (Desktop Only) - ฉบับพับเก็บได้ */}
        {!isMobileLayout && (
          <aside className={`bg-slate-900 text-slate-300 flex-col justify-between hidden md:flex shrink-0 shadow-2xl z-[120] transition-all duration-300 relative ${isSidebarCollapsed ? 'w-[88px] sidebar-collapsed' : 'w-72'}`}>

            {/* 🌟 ปุ่มพับ/กางเมนู (ลูกศร) วางทับเส้นขอบขวา 🌟 */}
            <button
              onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
              className="absolute -right-3.5 top-8 bg-white/95 backdrop-blur-xl text-slate-600 hover:text-slate-900 hover:bg-white rounded-full p-1.5 z-[130] shadow-[0_4px_12px_rgba(0,0,0,0.15)] border border-slate-200/80 transition-all duration-300 hover:scale-110"
              title={isSidebarCollapsed ? 'กางเมนู' : 'พับเมนู'}
            >
              <ChevronRight size={18} strokeWidth={2.5} className={`transition-transform duration-300 ${isSidebarCollapsed ? '' : 'rotate-180'}`} />
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
                    {/* 📜 เมนูแรกสุด: ไทม์ไลน์รวมหน้าไซต์ (สำหรับ Owner และ Admin) */}
                    {(isAdmin || isOwner || isSiteEngineer) && (
                      <button onClick={() => setView('global-feed')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold transition-all ${activeView === 'global-feed' ? 'bg-blue-600 text-white shadow-md' : 'hover:bg-slate-800 hover:text-white'}`}><ClipboardList size={18} /> Live Feed หน้าไซต์</button>
                    )}
                    <button onClick={() => setView('dashboard')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold transition-all ${activeView === 'dashboard' ? 'bg-blue-600 text-white shadow-md' : 'hover:bg-slate-800 hover:text-white'}`}><Home size={18} /> Dashboard</button>
                    {(isAdmin || isProjectPlanner || isOwner) && (
                      <button onClick={() => setView('master-gantt')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold transition-all ${activeView === 'master-gantt' ? 'bg-blue-600 text-white shadow-md' : 'hover:bg-slate-800 hover:text-white'}`}><Grid size={18} /> Master Gantt Chart</button>
                    )}
                    {(isAdmin || isProjectPlanner || isQC || isSiteEngineer || isOwner || isForeman) && (
                      <button onClick={() => setView('contractor-schedule')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold transition-all ${activeView === 'contractor-schedule' ? 'bg-blue-600 text-white shadow-md' : 'hover:bg-slate-800 hover:text-white'}`}><Calendar size={18} /> แผนงานผู้รับเหมา</button>
                    )}
                    {(isAdmin || isProjectPlanner || isQC || isSiteEngineer || isOwner || isForeman) && (
                      <button onClick={() => setView('reports')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold transition-all ${activeView === 'reports' ? 'bg-blue-600 text-white shadow-md' : 'hover:bg-slate-800 hover:text-white'}`}><PieChart size={18} /> Reports & Analytics</button>
                    )}
                    {(isAdmin || isQC || isSiteEngineer || isOwner || isForeman) && (
                      <button onClick={() => setView('defects')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold transition-all ${activeView === 'defects' ? 'bg-blue-600 text-white shadow-md' : 'hover:bg-slate-800 hover:text-white'}`}><ShieldAlert size={18} /> Defect Tracking</button>
                    )}
                  </nav>
                </div>

                {(isAdmin || isProcurement) && (
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-3 px-2">Management</p>
                    <nav className="space-y-1">
                      {isAdmin && (
                        <>
                          <button onClick={() => setView('admin-project')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold transition-all ${activeView === 'admin-project' ? 'bg-rose-600 text-white shadow-md' : 'hover:bg-slate-800 hover:text-white'}`}><PlusCircle size={18} /> สร้างโครงการ</button>
                          <button onClick={() => setView('admin-plot')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold transition-all ${activeView === 'admin-plot' ? 'bg-rose-600 text-white shadow-md' : 'hover:bg-slate-800 hover:text-white'}`}><MapIcon size={18} /> เพิ่มแปลงบ้าน</button>
                          <button onClick={() => setView('admin-users')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold transition-all ${activeView === 'admin-users' ? 'bg-rose-600 text-white shadow-md' : 'hover:bg-slate-800 hover:text-white'}`}><Users size={18} /> จัดการผู้ใช้งาน</button>
                          {/* ✅ ปุ่มเมนูจัดการแบบบ้าน (Desktop) */}
                          <button onClick={() => setView('admin-house-types')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold transition-all ${activeView === 'admin-house-types' ? 'bg-rose-600 text-white shadow-md' : 'hover:bg-slate-800 hover:text-white'}`}><Building size={18} /> จัดการแบบบ้าน</button>
                          {/* ✅ ปุ่มเมนูจัดการงวดงาน (Desktop) */}
                          <button onClick={() => setView('admin-tasks')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold transition-all ${activeView === 'admin-tasks' ? 'bg-rose-600 text-white shadow-md' : 'hover:bg-slate-800 hover:text-white'}`}><ClipboardList size={18} /> จัดการงวดงาน (Tasks)</button>
                          {/* ✅ ปุ่มเมนูกำหนดราคาขาย (Desktop) */}
                          <button onClick={() => setView('admin-pricing')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold transition-all ${activeView === 'admin-pricing' ? 'bg-rose-600 text-white shadow-md' : 'hover:bg-slate-800 hover:text-white'}`}><DollarSign size={18} /> กำหนดราคาขาย</button>
                          {/* ✅ ปุ่มเมนูตั้งค่า 2.5D สำหรับ Admin (Desktop) */}
                          <button onClick={() => setView('admin-visualizer')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold transition-all ${activeView === 'admin-visualizer' ? 'bg-rose-600 text-white shadow-md' : 'hover:bg-slate-800 hover:text-white'}`}><Monitor size={18} /> ตั้งค่า 2.5D แบบบ้าน</button>
                        </>
                      )}
                      {(isAdmin || isProcurement) && (
                        <button onClick={() => setView('procurement-contractors')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold transition-all ${activeView === 'procurement-contractors' ? 'bg-emerald-600 text-white shadow-md' : 'hover:bg-slate-800 hover:text-white'}`}><Wrench size={18} /> จัดการรายชื่อช่าง</button>
                      )}
                    </nav>
                  </div>
                )}
              </div>
            </div>

            <div className="p-8 pt-4 mt-auto">
              {isAdmin && (
                <button onClick={() => setIsMobilePreview(!isMobilePreview)} className="w-full flex items-center justify-center gap-2 p-3 bg-slate-800 rounded-xl font-bold text-xs text-slate-400 hover:text-white hover:bg-slate-700 transition-colors">
                  <Smartphone size={16} /> จำลองมือถือ (Mobile View)
                </button>
              )}
            </div>
          </aside>
        )}

        <div className="flex-1 flex flex-col h-full bg-slate-50 relative overflow-hidden">

          {/* 📱 Top Header (Mobile & Preview Only) */}
          {isMobileLayout && (
            <header className="bg-slate-900 text-white p-3 sm:p-4 shrink-0 shadow-md z-[100] relative">
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  {view === 'project-detail' || view === 'house-detail' || view === 'task-progress' ? (
                     <button onClick={() => {
                        if (view === 'project-detail') setView('dashboard');
                        else if (view === 'house-detail') setView('project-detail');
                        else if (view === 'task-progress') setView(taskReturnView);
                     }} className="text-white flex items-center gap-1.5 font-bold text-xs sm:text-sm bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-full transition-colors">
                        <ArrowLeft size={16} /> BACK
                     </button>
                  ) : (
                    <div className="flex items-center gap-2 cursor-pointer" onClick={() => setView('dashboard')}>
                      <div className="bg-blue-600 p-1.5 rounded-lg"><LayoutDashboard size={18} /></div>
                      <h1 className="font-black text-base sm:text-lg tracking-tighter uppercase italic">BuildTrack</h1>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 sm:gap-3">
                  <div className="relative">
                    <button onClick={() => setShowNotifs(!showNotifs)} className="relative p-2 bg-slate-800 text-slate-300 rounded-full hover:text-white"><Bell size={18} />{unreadNotifs.length > 0 && <span className="absolute top-0 right-0 w-2.5 h-2.5 sm:w-3 sm:h-3 bg-rose-500 rounded-full border border-slate-900"></span>}</button>
                    {showNotifs && (
                      <div className="absolute top-12 right-0 w-[280px] sm:w-[300px] bg-white rounded-2xl shadow-2xl border border-slate-200 z-50 overflow-hidden text-slate-800 animate-in slide-in-from-top-2">
                        <div className="p-3 bg-slate-50 border-b border-slate-200 flex justify-between items-center"><h3 className="font-black italic text-sm sm:text-base">Notifications</h3><span className="text-[9px] sm:text-[10px] font-bold text-slate-500">{unreadNotifs.length} Unread</span></div>
                        <div className="max-h-[50vh] overflow-y-auto custom-scrollbar">
                          {notifications.length === 0 ? (<div className="p-6 text-center text-slate-400 text-xs sm:text-sm font-bold">ไม่มีการแจ้งเตือน</div>) : (
                            notifications.map(n => (
                              <div key={n.id} onClick={() => handleNotifClick(n)} className={`p-3 border-b border-slate-100 cursor-pointer ${n.is_read ? 'opacity-60 bg-white' : 'bg-rose-50'}`}>
                                <div className="flex justify-between items-start mb-1 gap-2"><span className="text-[8px] sm:text-[9px] font-black uppercase text-rose-500 bg-rose-100 px-1.5 py-0.5 rounded">{n.plot_id}</span><span className="text-[8px] sm:text-[9px] text-slate-400 font-bold whitespace-nowrap">{new Date(n.created_at).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })}</span></div>
                                <p className="text-[10px] sm:text-xs font-bold text-slate-700 leading-snug mt-1">{n.message}</p>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                  {isAdmin && <button onClick={() => setIsMobilePreview(false)} className="p-2 bg-slate-800 text-slate-300 rounded-full hover:text-white"><Monitor size={18} /></button>}
                </div>
              </div>
            </header>
          )}

          {/* 💻 Top Header (Desktop) */}
          {!isMobileLayout && (
            <header className="bg-white border-b border-slate-200 p-3 sm:p-4 shrink-0 shadow-sm z-[100] flex justify-between items-center gap-4 relative">

              {/* 👈 BACK BUTTON AREA (Left Side) */}
              <div className="flex items-center">
                 {view === 'project-detail' && (
                    <button onClick={() => setView('dashboard')} className="text-sm font-bold text-slate-500 hover:text-blue-600 flex items-center gap-1.5 hover:-translate-x-1 transition-transform">
                       <ArrowLeft size={16}/> BACK TO PROJECTS
                    </button>
                 )}
                 {view === 'house-detail' && (
                    <button onClick={() => setView('project-detail')} className="text-sm font-bold text-slate-500 hover:text-blue-600 flex items-center gap-1.5 hover:-translate-x-1 transition-transform">
                       <ArrowLeft size={16}/> BACK TO {selectedProject?.name || 'PROJECT'}
                    </button>
                 )}
                 {view === 'task-progress' && (
                    <button onClick={() => setView(taskReturnView)} className="text-sm font-bold text-slate-500 hover:text-blue-600 flex items-center gap-1.5 hover:-translate-x-1 transition-transform">
                       <ArrowLeft size={16}/> BACK TO {taskReturnView === 'dashboard' ? 'DASHBOARD' : 'PLOT'}
                    </button>
                 )}
              </div>

              {/* 🔔 Notifications & Right Menu */}
              <div className="flex items-center gap-4 relative">
                <div className="relative">
                  <button onClick={() => setShowNotifs(!showNotifs)} className="relative p-2.5 bg-slate-100 text-slate-500 rounded-full hover:text-blue-600 hover:bg-blue-50 transition-colors"><Bell size={20} />{unreadNotifs.length > 0 && <span className="absolute top-0 right-0 w-3.5 h-3.5 bg-rose-500 rounded-full border-2 border-white"></span>}</button>
                  {showNotifs && (
                    <div className="absolute top-14 right-0 w-80 sm:w-96 bg-white rounded-2xl shadow-2xl border border-slate-200 z-50 overflow-hidden text-slate-800 animate-in slide-in-from-top-2">
                      <div className="p-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center"><h3 className="font-black italic text-lg">Notifications</h3><span className="text-xs font-bold text-slate-500">{unreadNotifs.length} Unread</span></div>
                      <div className="max-h-[60vh] overflow-y-auto custom-scrollbar">
                        {notifications.length === 0 ? (<div className="p-8 text-center text-slate-400 text-sm font-bold flex flex-col items-center gap-2"><Bell size={32} className="opacity-20" /> ไม่มีการแจ้งเตือน</div>) : (
                          notifications.map(n => (
                            <div key={n.id} onClick={() => handleNotifClick(n)} className={`p-4 border-b border-slate-100 cursor-pointer hover:bg-slate-50 transition-colors ${n.is_read ? 'opacity-60 bg-white' : 'bg-rose-50/40'}`}>
                              <div className="flex justify-between items-start mb-1 gap-2"><span className="text-[10px] font-black uppercase text-rose-500 tracking-widest bg-rose-100 px-2 py-0.5 rounded shrink-0">{n.plot_id}</span><span className="text-[10px] text-slate-400 font-bold whitespace-nowrap">{new Date(n.created_at).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })} • {new Date(n.created_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}</span></div>
                              <p className="text-sm font-bold text-slate-700 leading-snug mt-2">{n.message}</p>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </div>
                {/* 🌤️ Weather Widget 2.0 (เวอร์ชันเพิ่มคำบอกสภาพอากาศปัจจุบัน) */}
                <div className="relative z-50">
                  <button
                  onClick={() => setShowWeatherWidget(!showWeatherWidget)}
                  className="hidden sm:flex items-center gap-2 bg-sky-50 hover:bg-sky-100 text-sky-700 px-3 py-1.5 rounded-xl border border-sky-200 shadow-sm ml-2 transition-all cursor-pointer"
                >
                  {weatherInfo ? (
                    <>
                      {/* ไอคอนสภาพอากาศตัวใหญ่ */}
                      <span className="text-2xl drop-shadow-sm">{weatherInfo.currentDetails.icon}</span>

                      {/* 🌟 ปรับตรงนี้: จัดข้อความให้โชว์ทั้ง สถานที่ และ สภาพอากาศปัจจุบันคู่กับอุณหภูมิ */}
                      <div className="flex flex-col justify-center text-left">
                        {/* บรรทัดบน: โชว์หมุดพิกัดสถานที่ */}
                        <span className="text-[9px] font-black leading-none text-sky-600 truncate max-w-[100px]">📍 {weatherInfo.location}</span>
                        {/* บรรทัดล่าง: โชว์คำบอกสภาพอากาศปัจจุบัน + อุณหภูมิ */}
                        <span className="text-xs font-black leading-tight mt-0.5 whitespace-nowrap">
                          {weatherInfo.currentDetails.text} {weatherInfo.currentTemp}°C
                        </span>
                      </div>
                    </>
                  ) : (
                    <span className="text-[10px] font-bold text-sky-500 flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> กำลังโหลด...</span>
                  )}
                </button>

                {/* 🔽 Dropdown แสดงรายละเอียดพยากรณ์ (ปล่อยไว้เหมือนเดิมได้เลยครับ) */}
                {showWeatherWidget && weatherInfo && (
                  <div className="absolute right-0 top-full mt-3 w-[280px] bg-white rounded-2xl shadow-[0_10px_40px_-10px_rgba(0,0,0,0.2)] border border-slate-100 p-4 animate-in fade-in slide-in-from-top-2">
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <h4 className="text-sm font-black text-slate-800 flex items-center gap-1"><MapIcon size={14} className="text-rose-500" /> {weatherInfo.location}</h4>
                        <p className="text-[10px] text-slate-500 font-bold">{new Date().toLocaleDateString('th-TH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
                      </div>
                      <button onClick={() => setShowWeatherWidget(false)} className="text-slate-400 hover:text-slate-700"><X size={16} /></button>
                    </div>

                    <div className="flex items-center gap-3 bg-blue-50/50 p-3 rounded-xl mb-3 border border-blue-50">
                      <span className="text-4xl">{weatherInfo.currentDetails.icon}</span>
                      <div>
                        <div className="text-2xl font-black text-blue-700 leading-none">{weatherInfo.currentTemp}°C</div>
                        <div className="text-xs font-bold text-blue-600/80 mt-1">{weatherInfo.currentDetails.text}</div>
                      </div>
                    </div>

                    {weatherInfo.alert && (
                      <div className={`p-2.5 rounded-lg mb-4 text-[10px] font-bold border ${weatherInfo.alert.type === 'rain' ? 'bg-blue-100 text-blue-800 border-blue-200' : weatherInfo.alert.type === 'uv-high' ? 'bg-rose-100 text-rose-800 border-rose-200' : 'bg-orange-100 text-orange-800 border-orange-200'}`}>
                        {weatherInfo.alert.msg}
                      </div>
                    )}

                    <div className="border-t border-slate-100 pt-3">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">พยากรณ์ 4 ชม. ข้างหน้า</p>
                      <div className="flex justify-between gap-1">
                        {weatherInfo.hourly.map((h: any, i: number) => (
                          <div key={i} className="flex flex-col items-center justify-center bg-slate-50 rounded-lg p-2 flex-1 border border-slate-100">
                            <span className="text-[10px] font-bold text-slate-500">{h.time}</span>
                            <span className="text-lg my-1">{h.details.icon}</span>
                            <span className="text-[11px] font-black text-slate-700">{h.temp}°</span>
                            {h.rainProb > 20 && <span className="text-[8px] font-bold text-blue-500 mt-0.5">{h.rainProb}%</span>}
                          </div>
                        ))}
                      </div>
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
                <button onClick={handleLogout} className="ml-1 p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors" title="ออกจากระบบ"><LogOut size={18} /></button>
              </div>
              </div>
            </header>
          )}

          {/* 🌟 Scrollable Content Area 🌟 */}
          <main className={`flex-1 overflow-y-auto custom-scrollbar ${isMobileLayout ? 'p-3 pb-24' : 'p-6 sm:p-8 pb-12'} scroll-smooth relative`}>
            <div className="w-full">
              {/* 🌟🌟 MAIN VIEW SWITCHER 🌟🌟 */}
              {loadingView ? (
                <div className="flex-1 p-6 sm:p-8 space-y-6 w-full bg-slate-50 min-h-[80vh] relative overflow-hidden flex flex-col">
                   {loadingView === 'master-gantt' ? (
                      <div className="space-y-6 animate-pulse opacity-60 flex-1 flex flex-col">
                         {/* Header: Title and Dropdowns */}
                         <div className="flex justify-between items-start mb-2">
                            <div className="space-y-3">
                               <div className="h-10 w-72 bg-slate-200 rounded-xl"></div>
                               <div className="h-4 w-96 bg-slate-100 rounded-lg"></div>
                            </div>
                            <div className="flex gap-3">
                               <div className="h-10 w-32 bg-slate-200 rounded-xl border border-slate-200"></div>
                               <div className="h-10 w-28 bg-slate-200 rounded-xl border border-slate-200"></div>
                            </div>
                         </div>
                         {/* Gantt Body: Sidebar + Grid */}
                         <div className="flex flex-1 border border-slate-200 rounded-2xl overflow-hidden bg-white">
                            {/* Left Column (Plots) */}
                            <div className="w-[200px] sm:w-[250px] border-r border-slate-200 flex flex-col">
                               <div className="h-14 bg-slate-50 border-b border-slate-200 flex items-center px-4">
                                  <div className="h-5 w-24 bg-slate-200 rounded-lg"></div>
                               </div>
                               {[1,2,3,4,5,6].map(i => (
                                 <div key={i} className="h-24 border-b border-slate-50 p-4 flex flex-col justify-center">
                                    <div className="h-6 w-10 bg-slate-200 rounded-lg mb-2"></div>
                                    <div className="h-3 w-16 bg-slate-100 rounded-md"></div>
                                 </div>
                               ))}
                            </div>
                            {/* Right Column (Timeline Grid) */}
                            <div className="flex-1 flex flex-col relative overflow-hidden">
                               <div className="h-14 bg-slate-50 border-b border-slate-200 flex items-end">
                                 {/* Vertical grid line simulators */}
                                 {Array.from({length: 15}).map((_, i) => (
                                    <div key={i} className="flex-1 border-r border-slate-200/50 h-full flex flex-col items-center justify-center pt-2">
                                       <div className="h-2 w-5 bg-slate-200 rounded-sm mb-1.5"></div>
                                       <div className="h-3 w-4 bg-slate-300 rounded-sm"></div>
                                    </div>
                                 ))}
                               </div>
                               {[1,2,3,4,5,6].map((row, i) => (
                                 <div key={row} className="h-24 border-b border-slate-50 relative flex items-center">
                                    {/* Grid background lines */}
                                    <div className="absolute inset-0 flex">
                                       {Array.from({length: 15}).map((_, j) => (
                                          <div key={j} className="flex-1 border-r border-slate-100 h-full"></div>
                                       ))}
                                    </div>
                                    {/* Simulated Gantt Bars */}
                                    <div className={`absolute h-8 bg-blue-100 rounded-full z-10 flex items-center px-3 shadow-sm`} style={{ left: `${5 + (i%4)*15}%`, width: `${15 + (i%3)*15}%` }}>
                                       <div className="h-2 w-1/2 bg-blue-200 rounded-full"></div>
                                    </div>
                                    {i % 2 === 0 && (
                                       <div className={`absolute h-8 bg-purple-100 rounded-full z-10 flex items-center px-3 shadow-sm`} style={{ left: `${40 + (i%3)*10}%`, width: `${20 + (i%2)*15}%` }}>
                                          <div className="h-2 w-1/3 bg-purple-200 rounded-full"></div>
                                       </div>
                                    )}
                                 </div>
                               ))}
                            </div>
                         </div>
                      </div>
                   ) : loadingView === 'contractor-schedule' ? (
                      <div className="space-y-6 animate-pulse opacity-60 flex-1 flex flex-col">
                         <div className="flex justify-between items-center mb-2">
                            <div className="space-y-3">
                               <div className="h-10 w-64 bg-slate-200 rounded-xl"></div>
                               <div className="h-4 w-48 bg-slate-100 rounded-lg"></div>
                            </div>
                            <div className="h-10 w-32 bg-slate-200 rounded-xl"></div>
                         </div>
                         <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 flex-1">
                            <div className="bg-white rounded-3xl xl:col-span-2 border border-slate-200 shadow-sm p-6 flex flex-col">
                               <div className="h-8 w-1/3 bg-slate-200 rounded-lg mb-6"></div>
                               <div className="flex-1 flex gap-3">
                                  {Array.from({length: 7}).map((_, i) => (
                                     <div key={i} className="flex-1 bg-slate-50 border border-slate-100 rounded-xl h-full flex flex-col gap-2 p-2">
                                        <div className="h-4 w-8 bg-slate-200 mx-auto rounded-sm mt-2 mb-4"></div>
                                        {i % 2 === 0 ? <div className="h-20 bg-blue-100 rounded-lg w-full"></div> : i % 3 === 0 ? <div className="h-16 bg-emerald-100 rounded-lg w-full"></div> : null}
                                     </div>
                                  ))}
                               </div>
                            </div>
                            <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6 flex flex-col gap-4">
                               <div className="h-8 w-1/2 bg-slate-200 rounded-lg mb-4"></div>
                               {[1,2,3,4,5].map(i => <div key={i} className="h-20 bg-slate-50 border border-slate-100 rounded-xl w-full flex items-center p-4 gap-4"><div className="w-10 h-10 rounded-full bg-slate-200"></div><div className="flex-1 space-y-2"><div className="h-4 w-1/2 bg-slate-200 rounded"></div><div className="h-3 w-1/3 bg-slate-100 rounded"></div></div></div>)}
                            </div>
                         </div>
                      </div>
                   ) : loadingView === 'defects' ? (
                      <div className="space-y-6 animate-pulse opacity-60 flex-1 flex flex-col">
                         <div className="flex justify-between items-center mb-2">
                            <div className="h-10 w-64 bg-slate-200 rounded-xl"></div>
                            <div className="flex gap-3"><div className="h-10 w-24 bg-slate-200 rounded-xl"></div><div className="h-10 w-24 bg-slate-200 rounded-xl"></div></div>
                         </div>
                         <div className="w-full flex-1 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
                            <div className="h-14 bg-slate-50 border-b border-slate-200 flex items-center px-6 gap-6">
                               <div className="h-4 w-1/6 bg-slate-200 rounded-md"></div>
                               <div className="h-4 w-1/6 bg-slate-200 rounded-md"></div>
                               <div className="h-4 w-2/6 bg-slate-200 rounded-md"></div>
                               <div className="h-4 w-1/6 bg-slate-200 rounded-md"></div>
                            </div>
                            {[1, 2, 3, 4, 5, 6].map(i => (
                               <div key={i} className="h-20 w-full border-b border-slate-50 p-6 flex items-center gap-6">
                                  <div className="h-6 w-1/6 bg-slate-100 rounded-lg"></div>
                                  <div className="h-6 w-1/6 bg-slate-100 rounded-lg"></div>
                                  <div className="h-8 w-2/6 bg-slate-50 rounded-xl border border-slate-100"></div>
                                  <div className="h-8 w-1/6 bg-slate-100 rounded-lg"></div>
                                  <div className="h-10 w-24 bg-slate-200 rounded-xl ml-auto"></div>
                               </div>
                            ))}
                         </div>
                      </div>
                   ) : (
                      <div className="space-y-6 animate-pulse opacity-60 flex-1 flex flex-col">
                         <div className="flex justify-between items-center mb-2">
                            <div className="h-10 w-64 bg-slate-200 rounded-xl"></div>
                            <div className="h-10 w-48 bg-slate-200 rounded-xl hidden sm:block"></div>
                         </div>
                         <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
                            {[1,2,3,4].map(i => (
                               <div key={i} className="h-32 bg-white rounded-3xl border border-slate-200 shadow-sm p-6 flex flex-col justify-between">
                                  <div className="flex justify-between items-start">
                                     <div className="h-12 w-12 bg-slate-100 rounded-xl"></div>
                                     <div className="h-6 w-16 bg-slate-100 rounded-full"></div>
                                  </div>
                                  <div className="space-y-2 mt-4">
                                     <div className="h-6 w-24 bg-slate-200 rounded-lg"></div>
                                  </div>
                               </div>
                            ))}
                         </div>
                         <div className="flex-1 w-full bg-white rounded-3xl mt-2 border border-slate-200 shadow-sm p-8 flex flex-col">
                            <div className="h-8 w-64 bg-slate-200 rounded-xl mb-8"></div>
                            <div className="flex-1 flex items-end gap-6 px-4">
                               {[1,2,3,4,5,6,7,8,9,10].map(i => (
                                  <div key={i} className="flex-1 bg-slate-100 rounded-t-xl" style={{ height: `${20 + (i%5)*15}%` }}></div>
                               ))}
                            </div>
                         </div>
                      </div>
                   )}
                </div>
              ) : (
                <>
              {/* 📜 🌟 View: Global Timeline Feed (ฟีดรวมทุกรายงานเพื่อผู้บริหาร) 🌟 */}
              {view === 'global-feed' && (
                <div className="animate-in fade-in zoom-in-95 duration-500 max-w-4xl mx-auto">
                  <div className="mb-6 sm:mb-8">
                    <h2 className="font-black text-2xl sm:text-4xl text-slate-800 italic uppercase tracking-tighter flex items-center gap-2">
                      <Activity className="text-blue-600 animate-pulse" size={28} /> Site Activity Live Feed
                    </h2>
                    <p className="text-slate-500 text-[10px] sm:text-sm font-bold uppercase tracking-widest mt-1">ไทม์ไลน์รวมการรายงานแบบ Real-time จากทุกแปลงงาน</p>
                  </div>

                  <div className="space-y-4 sm:space-y-6 pb-12">
                    {(!allUpdatesRecord || allUpdatesRecord.length === 0) ? (
                      <div className="bg-white rounded-3xl border border-dashed border-slate-300 p-12 text-center text-slate-400 font-bold italic">
                        ยังไม่มีประวัติการรายงานงานในระบบย่อยนี้
                      </div>
                    ) : (
                      <>
                        {allUpdatesRecord.slice(0, visibleFeedCount).map((update: any) => {
                        const task = taskTemplates.find(t => t.id === update.task_template_id);
                        const taskName = task ? task.task_name : update.action;

                        // 🌟 ดึงข้อมูลชื่อโครงการของแปลงนี้ขึ้นมา
                        const currentPlotInfo = plots.find(p => String(p.id) === String(update.plot_id));
                        const projectNameText = currentPlotInfo ? currentPlotInfo.project_name : 'ไม่ระบุโครงการ';

                        return (
                          <div key={update.id} className="bg-white rounded-2xl sm:rounded-[2rem] border border-slate-200 shadow-sm overflow-hidden animate-in slide-in-from-bottom-4">

                            {/* ส่วนหัวโพสต์: ป้ายชื่อโครงการ + ล็อกพิกัดแปลง + ชื่องวดงาน */}
                            <div className="bg-slate-800 px-4 sm:px-6 py-3 flex flex-wrap justify-between items-center gap-2">
                              <div className="flex items-center gap-2 flex-wrap min-w-0">

                                {/* 🏢 ป้ายชื่อโครงการ (เพิ่มใหม่ สีน้ำเงินเด่นๆ) */}
                                <span className="bg-blue-600 text-white font-black text-[10px] sm:text-xs px-2.5 py-1 rounded-xl shadow-sm shrink-0 flex items-center gap-1">
                                  🏢 {projectNameText}
                                </span>

                                <span className="bg-amber-400 text-slate-900 font-black text-[10px] sm:text-xs px-2.5 py-1 rounded-xl shadow-sm shrink-0">
                                  📍 แปลง {update.plot_id}
                                </span>

                                <h4 className="font-black text-white text-xs sm:text-sm truncate max-w-[200px] sm:max-w-none" title={taskName}>
                                  🛠️ {taskName}
                                </h4>
                              </div>
                              <span className="bg-white/20 text-white font-black text-[10px] px-2.5 py-1 rounded-lg uppercase tracking-wider ml-auto">
                                {update.progress}%
                              </span>
                            </div>

                            {/* ส่วนเนื้อหาภายในกล่องแชท */}
                            <div className="p-4 sm:p-6 space-y-4">
                              {/* ข้อมูลผู้รายงาน และ สภาพอากาศ */}
                              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100">
                                <div className="flex items-center gap-2.5">
                                  <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-blue-600 to-purple-600 flex items-center justify-center text-white font-black text-sm shadow-md">
                                    {update.user_name.charAt(0)}
                                  </div>
                                  <div>
                                    <span className="font-black text-slate-800 text-sm flex items-center gap-1.5">
                                      {update.user_name}
                                      <span className={`text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded ${update.role === 'QC' ? 'bg-purple-100 text-purple-600' : update.role === 'Site Engineer' ? 'bg-blue-100 text-blue-600' : 'bg-orange-100 text-orange-600'}`}>
                                        {update.role}
                                      </span>
                                    </span>
                                    <p className="text-[10px] text-slate-400 font-bold mt-0.5">
                                      {new Date(update.created_at).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })} • {new Date(update.created_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.
                                    </p>
                                  </div>
                                </div>

                                {/* ป้ายสภาพอากาศ ณ เวลารายงาน */}
                                {update.weather_info && (
                                  <div className="text-[10px] sm:text-xs text-sky-700 font-black bg-sky-50 border border-sky-100 px-2.5 py-1 rounded-xl flex items-center gap-1.5 w-fit" title="สภาพอากาศขณะรายงาน">
                                    <span>{update.weather_info}</span>
                                  </div>
                                )}
                              </div>

                              {/* ข้อความบรรยายเนื้อหางาน */}
                              <p className="text-slate-700 text-xs sm:text-sm font-medium leading-relaxed bg-slate-50 p-3 rounded-xl border border-slate-100/50">
                                {update.text_content}
                              </p>

                              {/* รูปภาพผลงาน (ถ้ามีรูปภาพ จะรองรับการกดคลิกซูมดูรูปใหญ่ได้ทันที) */}
                              {update.image_url && (
                                <div className={`grid gap-2 sm:gap-3 ${update.image_url.split(',').filter((u: string) => u.trim() !== '').length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                                  {update.image_url.split(',').filter((u: string) => u.trim() !== '').map((url: any, i: any) => (
                                    <img
                                      key={i}
                                      src={url.trim()}
                                      onClick={() => setFullImageUrl(url.trim())}
                                      className="w-full aspect-[4/3] sm:aspect-video object-cover rounded-xl border border-slate-200 shadow-sm cursor-zoom-in hover:opacity-95 transition-opacity"
                                      alt="Live Feed Report Image"
                                    />
                                  ))}
                                </div>
                              )}
                            </div>

                          </div>
                        );
                      })}
                      {allUpdatesRecord.length > visibleFeedCount && (
                        <div ref={observerTargetRef} className="py-6 flex justify-center items-center">
                          <span className="bg-slate-100 text-slate-500 text-xs font-bold px-4 py-2 rounded-full flex items-center gap-2">
                            <Loader2 size={14} className="animate-spin" /> กำลังโหลดเพิ่มเติม...
                          </span>
                        </div>
                      )}
                      </>
                    )}
                  </div>
                </div>
              )}
              {/* 👷 Contractor Schedule View */}
              {view === 'contractor-schedule' && (
                <ContractorScheduleView
                  view={view}
                  schedules={schedules}
                  assignments={assignments}
                  plots={plots}
                  taskTemplates={taskTemplates}
                  contractors={contractors}
                  weatherInfo={weatherInfo}
                  latestUpdatesMap={latestUpdatesMap}
                  loggedInUser={loggedInUser}
                />
              )}
              {/* 📅 Master Gantt Chart View */}
              {view === 'master-gantt' && (
                <MasterGanttChart
                  view={view}
                  plots={plots}
                  taskTemplates={taskTemplates}
                  schedules={schedules}
                  latestUpdatesMap={latestUpdatesMap}
                  projects={projects}
                  contractors={contractors}
                  assignments={assignments}
                />
              )}
              {/* 🏢 View: Dashboard */}
              {view === 'dashboard' && (
                <DashboardOverview
                  view={view}
                  setView={setView}
                  isSiteEngineer={isSiteEngineer}
                  isQC={isQC}
                  isAdmin={isAdmin}
                  isOwner={isOwner}
                  isStore={loggedInUser?.role === 'Store' || loggedInUser?.role === 'Admin'}
                  isForeman={isForeman}
                  isProcurement={isProcurement}
                  isProjectPlanner={isProjectPlanner}
                  isMobileLayout={isMobileLayout}
                  projects={projects}
                  plots={plots}
                  taskTemplates={taskTemplates}
                  schedules={schedules}
                  latestUpdatesMap={latestUpdatesMap}
                  loggedInUser={loggedInUser}
                  inspectionQueue={inspectionQueue}
                  inspectionFilterTab={inspectionFilterTab}
                  setInspectionFilterTab={setInspectionFilterTab}
                  inspectionViewMode={inspectionViewMode}
                  setInspectionViewMode={setInspectionViewMode}
                  inspectionSort={inspectionSort}
                  setInspectionSort={setInspectionSort}
                  activePlotsCount={activePlotsCount}
                  completedPlotsCount={completedPlotsCount}
                  delayedPlotsCount={delayedPlotsCount}
                  setSelectedProject={setSelectedProject}
                  setSelectedPlot={setSelectedPlot}
                  setSelectedTask={setSelectedTask}
                  setTaskReturnView={setTaskReturnView}
                  setUpdates={setUpdates}
                  setProgressValue={setProgressValue}
                  setMapGrid={setMapGrid}
                  setIsEditMapMode={setIsEditMapMode}
                  setGridCols={setGridCols}
                  setGridRows={setGridRows}
                  setMapZoom={setMapZoom}
                  handleEditProject={handleEditProject}
                />
              )}

              {/* 📊 🌟 View: Reports & Analytics 🌟 */}
              {view === 'reports' && (
                <div className="animate-in slide-in-from-bottom-4 duration-500 w-full mx-auto">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end mb-6 sm:mb-8 gap-3 sm:gap-4">
                    <div>
                      <h2 className="text-2xl sm:text-4xl font-black text-slate-800 italic uppercase tracking-tighter">Project Reports</h2>
                      <p className="text-slate-500 text-[10px] sm:text-sm font-bold uppercase tracking-widest mt-0.5 sm:mt-1">ภาพรวมและประสิทธิภาพโครงการ</p>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                      <button onClick={() => setActivityReportOpen(true)} className="bg-indigo-600 text-white font-black px-4 sm:px-6 py-2.5 sm:py-3.5 rounded-lg sm:rounded-xl hover:bg-indigo-700 transition-colors shadow-lg flex items-center justify-center gap-2 text-xs sm:text-base w-full sm:w-auto">
                        <Printer size={16} className="sm:w-5 sm:h-5" /> Daily Activity (PDF)
                      </button>
                      <button onClick={handleExportCSV} className="bg-emerald-600 text-white font-black px-4 sm:px-6 py-2.5 sm:py-3.5 rounded-lg sm:rounded-xl hover:bg-emerald-700 transition-colors shadow-lg flex items-center justify-center gap-2 text-xs sm:text-base w-full sm:w-auto">
                        <Download size={16} className="sm:w-5 sm:h-5" /> สรุปโครงการ (CSV)
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 mb-4 sm:mb-6">

                    <div className="bg-white p-5 sm:p-8 rounded-2xl sm:rounded-[2rem] border border-slate-200 shadow-sm lg:col-span-2">
                      <h3 className="font-black text-lg sm:text-xl text-slate-800 mb-4 sm:mb-6 flex items-center gap-2"><PieChart className="text-blue-600" size={20} /> สถานะแปลงบ้านทั้งหมด</h3>
                      <div className="flex flex-col sm:flex-row gap-5 sm:gap-10 items-center">
                        <div className="relative w-32 h-32 sm:w-40 sm:h-40 shrink-0">
                          <svg viewBox="0 0 36 36" className="w-full h-full transform -rotate-90">
                            <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="#f1f5f9" strokeWidth="4" />
                            {totalPlotsCount > 0 && (
                              <>
                                <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="#10b981" strokeWidth="4" strokeDasharray={`${(completedPlotsCount / totalPlotsCount) * 100}, 100`} />
                                <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="#f43f5e" strokeWidth="4" strokeDasharray={`${(delayedPlotsCount / totalPlotsCount) * 100}, 100`} strokeDashoffset={`-${(completedPlotsCount / totalPlotsCount) * 100}`} />
                                <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="#3b82f6" strokeWidth="4" strokeDasharray={`${((totalPlotsCount - completedPlotsCount - delayedPlotsCount) / totalPlotsCount) * 100}, 100`} strokeDashoffset={`-${((completedPlotsCount + delayedPlotsCount) / totalPlotsCount) * 100}`} />
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
                            <span className="font-black text-base sm:text-lg text-emerald-700">{completedPlotsCount} <span className="text-[10px] sm:text-xs text-emerald-500 font-bold">({totalPlotsCount ? Math.round((completedPlotsCount / totalPlotsCount) * 100) : 0}%)</span></span>
                          </div>
                          <div className="flex justify-between items-center bg-blue-50 p-2.5 sm:p-3 rounded-lg sm:rounded-xl border border-blue-100">
                            <span className="font-bold text-xs sm:text-sm text-blue-700 flex items-center gap-1.5 sm:gap-2"><div className="w-2 h-2 sm:w-3 sm:h-3 rounded-full bg-blue-500"></div> ตามแผน</span>
                            <span className="font-black text-base sm:text-lg text-blue-700">{totalPlotsCount - completedPlotsCount - delayedPlotsCount} <span className="text-[10px] sm:text-xs text-blue-500 font-bold">({totalPlotsCount ? Math.round(((totalPlotsCount - completedPlotsCount - delayedPlotsCount) / totalPlotsCount) * 100) : 0}%)</span></span>
                          </div>
                          <div className="flex justify-between items-center bg-rose-50 p-2.5 sm:p-3 rounded-lg sm:rounded-xl border border-rose-100">
                            <span className="font-bold text-xs sm:text-sm text-rose-700 flex items-center gap-1.5 sm:gap-2"><div className="w-2 h-2 sm:w-3 sm:h-3 rounded-full bg-rose-500"></div> ล่าช้ากว่าแผน</span>
                            <span className="font-black text-base sm:text-lg text-rose-700">{delayedPlotsCount} <span className="text-[10px] sm:text-xs text-rose-500 font-bold">({totalPlotsCount ? Math.round((delayedPlotsCount / totalPlotsCount) * 100) : 0}%)</span></span>
                          </div>
                          
                          {/* 🌟 New report items */}
                          <div className="flex justify-between items-center bg-amber-50 p-2.5 sm:p-3 rounded-lg sm:rounded-xl border border-amber-100 mt-2 border-dashed">
                            <span className="font-bold text-xs sm:text-sm text-amber-700 flex items-center gap-1.5 sm:gap-2"><Tag size={12} className="text-amber-500" /> บ้านพร้อมขาย (หยุดเวลา)</span>
                            <span className="font-black text-base sm:text-lg text-amber-700">{readyForSalePlotsCount} <span className="text-[10px] sm:text-xs text-amber-500 font-bold">({totalPlotsCount ? Math.round((readyForSalePlotsCount / totalPlotsCount) * 100) : 0}%)</span></span>
                          </div>
                          <div className="flex justify-between items-center bg-purple-50 p-2.5 sm:p-3 rounded-lg sm:rounded-xl border border-purple-100 border-dashed">
                            <span className="font-bold text-xs sm:text-sm text-purple-700 flex items-center gap-1.5 sm:gap-2"><Hammer size={12} className="text-purple-500" /> โอนแล้ว-รอเก็บงาน</span>
                            <span className="font-black text-base sm:text-lg text-purple-700">{pendingFinishesPlotsCount} <span className="text-[10px] sm:text-xs text-purple-500 font-bold">({totalPlotsCount ? Math.round((pendingFinishesPlotsCount / totalPlotsCount) * 100) : 0}%)</span></span>
                          </div>
                          <div className="flex justify-between items-center bg-pink-50 p-2.5 sm:p-3 rounded-lg sm:rounded-xl border border-pink-100 border-dashed">
                            <span className="font-bold text-xs sm:text-sm text-pink-700 flex items-center gap-1.5 sm:gap-2"><UserCheck size={12} className="text-pink-500" /> เร่งปิดจ๊อบ (มีลูกค้า)</span>
                            <span className="font-black text-base sm:text-lg text-pink-700">{customerWaitingPlotsCount} <span className="text-[10px] sm:text-xs text-pink-500 font-bold">({totalPlotsCount ? Math.round((customerWaitingPlotsCount / totalPlotsCount) * 100) : 0}%)</span></span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="bg-white p-5 sm:p-8 rounded-2xl sm:rounded-[2rem] border border-slate-200 shadow-sm flex flex-col justify-between space-y-3 sm:space-y-4">
                      <div className="bg-slate-50 rounded-lg sm:rounded-xl p-4 sm:p-5 border border-slate-100 flex items-center gap-3 sm:gap-4">
                        <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center"><Building size={20} className="sm:w-6 sm:h-6" /></div>
                        <div><p className="text-[8px] sm:text-[10px] font-black uppercase tracking-widest text-slate-400">Total Projects</p><p className="text-xl sm:text-2xl font-black text-slate-800">{projects.length}</p></div>
                      </div>

                      <div className="bg-rose-50 rounded-lg sm:rounded-xl p-4 sm:p-5 border border-rose-100 flex items-center gap-3 sm:gap-4">
                        <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-rose-200 text-rose-600 flex items-center justify-center"><ShieldAlert size={20} className="sm:w-6 sm:h-6" /></div>
                        <div><p className="text-[8px] sm:text-[10px] font-black uppercase tracking-widest text-rose-500">Total Reworks (ตีกลับ)</p><p className="text-xl sm:text-2xl font-black text-rose-700">{totalReworks} <span className="text-xs sm:text-sm font-bold opacity-60">ครั้ง</span></p></div>
                      </div>

                      <div className="bg-slate-50 rounded-lg sm:rounded-xl p-4 sm:p-5 border border-slate-100 flex items-center gap-3 sm:gap-4">
                        <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center"><HardHat size={20} className="sm:w-6 sm:h-6" /></div>
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
                            let plannedAvg = 0;
                            if (schedules && taskTemplates && plots) {
                              const pPlots = plots.filter((p: any) => p.project_name === proj.name);
                              let plannedTotalWeight = 0;
                              let totalCost = 0;
                              let naivePlannedTotal = 0;
                              let taskCount = 0;
                              pPlots.forEach((p: any) => {
                                const pTasks = taskTemplates.filter((t: any) => t.house_type_id === p.house_type_id);
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
                              plannedAvg = totalCost > 0 
                                ? Math.round(plannedTotalWeight / totalCost) 
                                : (taskCount > 0 ? Math.round(naivePlannedTotal / taskCount) : 0);
                            }
                            return (
                              <tr key={idx} className="border-b border-slate-100 hover:bg-slate-50/50">
                                <td className="p-3 sm:p-4 pl-4 sm:pl-8 font-bold text-slate-700 text-xs sm:text-sm">{proj.name}</td>
                                <td className="p-3 sm:p-4 text-center font-bold text-slate-600 text-xs sm:text-sm">{proj.plotCount}</td>
                                <td className="p-3 sm:p-4 text-center"><span className={`font-bold px-2 sm:px-3 py-1 rounded-md sm:rounded-lg text-[10px] sm:text-xs ${dCount > 0 ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-400'}`}>{dCount > 0 ? `${dCount} แปลง` : '-'}</span></td>
                                <td className="p-3 sm:p-4 pr-4 sm:pr-8">
                                  <div className="flex flex-col gap-1 sm:gap-2 min-w-[120px]">
                                    <div className="flex justify-between items-center text-[9px] sm:text-[10px] mb-1">
                                      <span className="text-blue-500 font-bold">ทำได้จริง: {proj.progress || 0}%</span>
                                      <span className="text-[#86868b] font-bold">ตามแผน: {plannedAvg}%</span>
                                    </div>
                                    <div className="h-2.5 sm:h-3 bg-black/5 rounded-full overflow-hidden shadow-inner relative">
                                      <div className="absolute top-0 left-0 h-full bg-slate-300 opacity-60 rounded-full" style={{ width: `${plannedAvg}%` }}></div>
                                      <div className={`absolute top-0 left-0 h-full ${proj.progress >= plannedAvg ? 'bg-emerald-500' : 'bg-blue-500'} rounded-full transition-all duration-1000 ease-out`} style={{ width: `${proj.progress || 0}%`, zIndex: 10 }}></div>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* 🌟 New Section: Special Status Plots List */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6 mb-6">
                    <div className="bg-white rounded-2xl sm:rounded-[2rem] border border-amber-200 shadow-sm overflow-hidden">
                      <div className="p-4 sm:p-6 border-b border-amber-100 bg-amber-50">
                        <h3 className="font-black text-lg sm:text-xl text-amber-800 flex items-center gap-2"><Tag size={20} className="text-amber-600"/> รายชื่อบ้านพร้อมขาย</h3>
                      </div>
                      <div className="p-4 sm:p-6 max-h-[400px] overflow-y-auto custom-scrollbar">
                        {plots.filter(p => p.sale_status === 'ready_for_sale').length === 0 ? (
                          <p className="text-slate-400 font-bold text-sm text-center py-4">ไม่มีบ้านสถานะพร้อมขาย</p>
                        ) : (
                          <div className="flex flex-col gap-2">
                            {plots.filter(p => p.sale_status === 'ready_for_sale').map((p, i) => (
                              <div key={i} className="flex justify-between items-center p-3 bg-slate-50 rounded-xl border border-slate-100">
                                <span className="font-bold text-slate-700 text-sm">{p.project_name}</span>
                                <span className="font-black text-amber-600 bg-amber-100 px-3 py-1 rounded-lg text-sm">แปลง {p.id}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="bg-white rounded-2xl sm:rounded-[2rem] border border-purple-200 shadow-sm overflow-hidden">
                      <div className="p-4 sm:p-6 border-b border-purple-100 bg-purple-50">
                        <h3 className="font-black text-lg sm:text-xl text-purple-800 flex items-center gap-2"><Hammer size={20} className="text-purple-600"/> รายการโอนแล้ว-รอเก็บงาน</h3>
                      </div>
                      <div className="p-4 sm:p-6 max-h-[400px] overflow-y-auto custom-scrollbar">
                        {plots.filter(p => p.is_completed && p.progress < 100).length === 0 ? (
                          <p className="text-slate-400 font-bold text-sm text-center py-4">ไม่มีงานค้างเก็บหลังโอน</p>
                        ) : (
                          <div className="flex flex-col gap-2">
                            {plots.filter(p => p.is_completed && p.progress < 100).map((p, i) => (
                              <div key={i} className="flex justify-between items-center p-3 bg-slate-50 rounded-xl border border-slate-100">
                                <div>
                                  <span className="font-bold text-slate-700 text-sm block">{p.project_name}</span>
                                  <span className="text-[10px] text-slate-400 font-bold">ความคืบหน้า {p.progress}%</span>
                                </div>
                                <span className="font-black text-purple-600 bg-purple-100 px-3 py-1 rounded-lg text-sm">แปลง {p.id}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="bg-white rounded-2xl sm:rounded-[2rem] border border-pink-200 shadow-sm overflow-hidden">
                      <div className="p-4 sm:p-6 border-b border-pink-100 bg-pink-50">
                        <h3 className="font-black text-lg sm:text-xl text-pink-800 flex items-center gap-2"><UserCheck size={20} className="text-pink-600"/> รายชื่อเร่งปิดจ๊อบ (มีลูกค้า)</h3>
                      </div>
                      <div className="p-4 sm:p-6 max-h-[400px] overflow-y-auto custom-scrollbar">
                        {plots.filter(p => p.has_customer && !p.is_completed).length === 0 ? (
                          <p className="text-slate-400 font-bold text-sm text-center py-4">ไม่มีบ้านที่ลูกค้ารอโอน</p>
                        ) : (
                          <div className="flex flex-col gap-2">
                            {plots.filter(p => p.has_customer && !p.is_completed).map((p, i) => (
                              <div key={i} className="flex justify-between items-center p-3 bg-slate-50 rounded-xl border border-slate-100">
                                <div>
                                  <span className="font-bold text-slate-700 text-sm block">{p.project_name}</span>
                                  <span className="text-[10px] text-slate-400 font-bold">ความคืบหน้า {p.progress}%</span>
                                </div>
                                <span className="font-black text-pink-600 bg-pink-100 px-3 py-1 rounded-lg text-sm">แปลง {p.id}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* 📊 🌟 Executive Analytics สำหรับผู้บริหารและทีมวางแผน 🌟 */}
                  {(isAdmin || isOwner || isProjectPlanner || isSiteEngineer) && (
                    <div className="space-y-8">
                      <OwnerAnalyticsDashboard
                        projects={projects}
                        plots={plots}
                        taskTemplates={taskTemplates}
                        schedules={schedules}
                        defects={defects}
                        allUpdatesRecord={allUpdatesRecord}
                        foremenList={foremenList}
                        latestUpdatesMap={latestUpdatesMap}
                        contractors={contractors}
                        assignments={assignments}
                      />
                      <ExecutiveAnalytics
                        loading={loading}
                        projects={projects}
                        plots={plots}
                        taskTemplates={taskTemplates}
                        schedules={schedules}
                        latestUpdatesMap={latestUpdatesMap}
                        foremenList={foremenList}
                        allUpdatesRecord={allUpdatesRecord}
                      />
                    </div>
                  )}
                </div>
              )}

              {/* ⚠️ View: Defect Tracking (Full Page) ⚠️ */}
              {view === 'defects' && (
                <div className="animate-in slide-in-from-bottom-4 duration-500 w-full mx-auto h-full p-4 sm:p-8">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end mb-6 sm:mb-8 gap-3 sm:gap-4">
                    <div>
                      <h2 className="text-2xl sm:text-4xl font-black text-slate-800 italic uppercase tracking-tighter flex items-center gap-3"><ShieldAlert className="text-rose-500" size={32} /> Defect Tracking</h2>
                      <p className="text-slate-500 text-[10px] sm:text-sm font-bold uppercase tracking-widest mt-0.5 sm:mt-1">ระบบจัดการงานซ่อมแซมและข้อบกพร่อง (Internal)</p>
                    </div>
                  </div>

                  <div className="bg-white p-5 sm:p-6 rounded-2xl sm:rounded-[2rem] border border-slate-200 shadow-sm mb-6 flex flex-col sm:flex-row gap-4 items-center justify-between">
                    <div className="flex w-full sm:w-auto items-center gap-2 flex-wrap">
                      <div className="relative flex-1 sm:w-64 min-w-[200px]">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                        <input type="text" placeholder="ค้นหาแปลง, อาการ..." value={defectSearchText} onChange={(e) => setDefectSearchText(e.target.value)} className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm focus:border-blue-500 outline-none" />
                      </div>
                      <select value={defectFilterStatus} onChange={(e) => setDefectFilterStatus(e.target.value)} className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 font-bold text-sm text-slate-700 outline-none focus:border-blue-500 cursor-pointer min-w-[150px]">
                        <option value="all">สถานะทั้งหมด</option>
                        <option value="pending">รอแก้ไข (Pending)</option>
                        <option value="resolved">แก้ไขแล้ว (Resolved)</option>
                      </select>
                    </div>
                    {isForeman && (
                      <button onClick={() => setDefectFilterMy(!defectFilterMy)} className={`px-4 py-2.5 rounded-xl font-bold text-sm transition-colors border whitespace-nowrap ${defectFilterMy ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100'}`}>
                        {defectFilterMy ? '✓ เฉพาะงานของฉัน' : 'ดูงานทั้งหมด'}
                      </button>
                    )}
                  </div>

                  <div className="bg-white rounded-2xl sm:rounded-[2rem] border border-slate-200 shadow-md overflow-hidden mb-6">
                    <div className="overflow-x-auto custom-scrollbar">
                      <table className="w-full text-left border-collapse min-w-[1100px]">
                        <thead className="bg-slate-100 border-b border-slate-200">
                          <tr>
                            <th className="p-4 pl-6 sm:pl-8 text-xs font-black uppercase text-slate-600 tracking-wider w-32">วันแจ้ง (ค้าง)</th>
                            <th className="p-4 text-xs font-black uppercase text-slate-600 tracking-wider w-24">แปลง</th>
                            <th className="p-4 text-xs font-black uppercase text-slate-600 tracking-wider min-w-[200px]">งวดงาน (Task)</th>
                            <th className="p-4 text-xs font-black uppercase text-slate-600 tracking-wider w-40">ผู้แจ้ง (Reporter)</th>
                            <th className="p-4 text-xs font-black uppercase text-slate-600 tracking-wider">รายละเอียด / รูปภาพ</th>
                            <th className="p-4 pr-6 sm:pr-8 text-xs font-black uppercase text-slate-600 tracking-wider text-center w-40">จัดการ</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {(() => {
                            let filtered = defects.filter(defect => {
                              if (defectFilterStatus !== 'all' && defect.status !== defectFilterStatus) return false;
                              if (defectSearchText) {
                                const text = defectSearchText.toLowerCase();
                                if (!defect.plot_id.toLowerCase().includes(text) && !(defect.description || '').toLowerCase().includes(text)) return false;
                              }
                              if (isForeman && defectFilterMy) {
                                const p = plots.find(plot => plot.id === defect.plot_id);
                                if (p?.foreman !== (loggedInUser?.username || currentUserRole)) return false;
                              }
                              return true;
                            });

                            if (filtered.length === 0) {
                              return <tr><td colSpan={6} className="text-center p-12 text-slate-400 font-bold text-sm sm:text-base"><CheckSquare size={32} className="opacity-30 mx-auto mb-2" /> ไม่มีรายการแจ้งซ่อม</td></tr>;
                            }

                            // จัดกลุ่มตามแปลง (Group by Plot)
                            const grouped: Record<string, any[]> = {};
                            filtered.forEach(d => {
                              if (!grouped[d.plot_id]) grouped[d.plot_id] = [];
                              grouped[d.plot_id].push(d);
                            });

                            return Object.keys(grouped).sort().map(plotId => {
                              // เรียงจากเก่าสุดไปใหม่สุด (เพื่อให้ค้างนานสุดขึ้นก่อน)
                              const plotDefects = grouped[plotId].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
                              const plotInfo = plots.find(p => p.id === plotId);

                              return (
                                <React.Fragment key={`group-${plotId}`}>
                                  {/* 🌟 ส่วนหัวแถวแบ่งกลุ่มแปลง (Plot Header) 🌟 */}
                                  <tr className="bg-slate-800 text-white">
                                    <td colSpan={6} className="p-3 pl-6 sm:pl-8 font-black text-sm tracking-wider">
                                      <div className="flex items-center gap-3">
                                        <Home size={18} className="text-blue-400" /> 
                                        แปลง: {plotId} 
                                        <span className="bg-white/20 px-2 py-0.5 rounded text-xs ml-2">ค้าง {plotDefects.filter(d => d.status === 'pending').length} รายการ</span>
                                        <span className="text-slate-400 text-xs font-medium ml-auto pr-4">โฟร์แมน: {plotInfo?.foreman || 'ไม่ระบุ'}</span>
                                      </div>
                                    </td>
                                  </tr>
                                  {/* รายการ Defect ของแปลงนี้ */}
                                  {plotDefects.map((defect, idx) => {
                                    const taskInfo = taskTemplates.find(t => t.id === defect.task_template_id || t.id === defect.task_id);
                                    const taskName = taskInfo ? taskInfo.task_name : 'ไม่ระบุ';
                                    const daysAging = Math.floor((new Date().getTime() - new Date(defect.created_at).getTime()) / (1000 * 3600 * 24));
                                    const imageUrls = defect.image_urls ? defect.image_urls.split(',').filter((u:string)=>u) : [];

                                    return (
                                      <tr key={idx} className={`hover:bg-slate-50/80 transition-colors ${daysAging > 7 && defect.status === 'pending' ? 'bg-rose-50/50' : ''}`}>
                                        <td className="p-4 pl-6 sm:pl-8">
                                          <div className="font-bold text-slate-700 text-xs sm:text-sm">{new Date(defect.created_at).toLocaleDateString('th-TH')}</div>
                                          {defect.status === 'pending' && <div className={`text-[10px] font-black mt-1 px-2 py-0.5 rounded inline-block ${daysAging > 7 ? 'bg-rose-100 text-rose-700 border border-rose-300 shadow-sm animate-pulse' : 'bg-amber-100 text-amber-700'}`}>{daysAging > 7 ? `🚨 เกิน SLA (${daysAging} วัน)` : `ค้าง ${daysAging} วัน`}</div>}
                                          {defect.status === 'resolved' && defect.resolved_at && <div className="text-[10px] font-bold mt-1 px-2 py-0.5 rounded inline-block bg-emerald-100 text-emerald-700">แก้เมื่อ: {new Date(defect.resolved_at).toLocaleDateString('th-TH')}</div>}
                                        </td>
                                        <td className="p-4 font-black text-slate-800 text-sm sm:text-base">{defect.plot_id}</td>
                                        <td className="p-4 font-bold text-slate-700 text-xs sm:text-sm">
                                          <span className="bg-slate-100 text-slate-700 px-3 py-1.5 rounded-md border border-slate-200 inline-block w-full break-words leading-relaxed" title={taskName}>{taskName}</span>
                                        </td>
                                        <td className="p-4 font-bold text-slate-600 text-xs sm:text-sm">
                                          <span className="bg-blue-50 text-blue-700 border border-blue-100 px-2 py-1 rounded-md">{defect.reporter_name || defect.reported_by || 'System'}</span>
                                          <div className="mt-2 flex flex-col gap-0.5">
                                             <span className="text-[9px] font-black uppercase text-slate-400 tracking-wider">ผู้รับผิดชอบ (Assignee):</span>
                                             <span className="text-[11px] font-bold text-indigo-700 flex items-center gap-1"><HardHat size={12}/> {plotInfo?.foreman || 'ยังไม่ระบุ Foreman'}</span>
                                          </div>
                                        </td>
                                        <td className="p-4 text-xs sm:text-sm text-slate-600 font-medium">
                                          <p className="truncate max-w-[250px] mb-2">{defect.description || 'ไม่มีรายละเอียด'}</p>
                                          {imageUrls.length > 0 && (
                                            <div className="flex gap-2">
                                              {imageUrls.slice(0,2).map((url:string, i:number) => (
                                                <img key={i} src={url} onClick={() => setFullImageUrl(url)} className="w-10 h-10 object-cover rounded shadow-sm border border-slate-200 cursor-zoom-in hover:opacity-80" alt="defect" />
                                              ))}
                                              {imageUrls.length > 2 && <span className="w-10 h-10 flex items-center justify-center bg-slate-100 rounded text-[10px] font-bold text-slate-500 border border-slate-200">+{imageUrls.length - 2}</span>}
                                            </div>
                                          )}
                                        </td>
                                        <td className="p-4 pr-6 sm:pr-8 text-center">
                                          <button 
                                            onClick={() => {
                                              const p = plots.find(pl => pl.id === defect.plot_id);
                                              const t = taskTemplates.find(ta => ta.id === defect.task_template_id || ta.id === defect.task_id);
                                              if (p) {
                                                const proj = projects.find(pr => pr.name === p.project_name);
                                                if (proj) setSelectedProject(proj);
                                                setSelectedPlot(p);
                                                if (t) setSelectedTask(t);
                                                setTaskReturnView('defects'); // 🌟 แก้บัค! เซ็ตให้เวลาย้อนกลับ กลับมาหน้า Defects 🌟
                                                setView('task-progress'); // 🌟 ไปที่หน้าส่งงาน (Chat) โดยตรง 🌟
                                              }
                                            }}
                                            className="bg-blue-600 hover:bg-blue-700 text-white font-black px-4 py-2.5 rounded-xl text-xs sm:text-sm shadow-md transition-all hover:scale-105 flex items-center justify-center gap-2 mx-auto w-full"
                                          >
                                            ลุยงานนี้ <ChevronRight size={16} strokeWidth={3} />
                                          </button>
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </React.Fragment>
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
                <MapVisualizer
                  loading={loading}
                  view={view} setView={setView} selectedProject={selectedProject}
                  isAdmin={isAdmin} currentUserRole={currentUserRole} isMobileLayout={isMobileLayout}
                  isEditMapMode={isEditMapMode} setIsEditMapMode={setIsEditMapMode}
                  gridCols={gridCols} setGridCols={setGridCols} gridRows={gridRows} setGridRows={setGridRows}
                  mapZoom={mapZoom} handleZoomIn={handleZoomIn} handleZoomOut={handleZoomOut} handleZoomReset={handleZoomReset}
                  mapTool={mapTool} setMapTool={setMapTool} mapSelectedPlot={mapSelectedPlot} setMapSelectedPlot={setMapSelectedPlot}
                  plots={plots} isSubmitting={isSubmitting} handleSaveMap={handleSaveMap}
                  mapGrid={mapGrid} getAdjacency={getAdjacency} handleMouseDown={handleMouseDown}
                  handleMouseEnter={handleMouseEnter} handleMouseUp={handleMouseUp}
                  setSelectedPlot={setSelectedPlot} plotBounds={plotBounds} getPlotOverallStatus={getPlotOverallStatus}
                  allUpdatesRecord={allUpdatesRecord} taskTemplates={taskTemplates} assignments={assignments}
                  searchTask={searchTask} setSearchTask={setSearchTask}
                  schedules={schedules} taskDates={taskDates}
                  plotsActiveToday={plotsActiveToday} searchPlot={searchPlot} setSearchPlot={setSearchPlot}
                  filterForeman={filterForeman} setFilterForeman={setFilterForeman} foremenList={foremenList}
                  displayPlots={displayPlots} handleDeletePlot={handleDeletePlot} handleEditPlot={handleEditPlot}
                  setIsPresentationOpen={setIsPresentationOpen} setCurrentSlideIndex={setCurrentSlideIndex}
                />
              )}


              {/* 📋 LEVEL 3: House Detail */}
              {view === 'house-detail' && selectedPlot && (
                <HouseDetailView
                  loading={loading}
                  view={view} setView={setView} selectedPlot={selectedPlot} selectedProject={selectedProject}
                  isMobileLayout={isMobileLayout} plotPlanStart={plotPlanStart} plotPlanEnd={plotPlanEnd}
                  daysElapsed={daysElapsed} totalPlannedDays={totalPlannedDays} daysRemaining={daysRemaining}
                  isSummaryDelayed={isSummaryDelayed} isProjectPlanner={isProjectPlanner}
                  setCopyModalOpen={setCopyModalOpen} handleSaveAllSchedules={handleSaveAllSchedules}
                  isSubmitting={isSubmitting} houseTypes={houseTypes} taskTemplates={taskTemplates}
                  getTaskStatus={getTaskStatus} latestUpdatesMap={latestUpdatesMap} schedules={schedules}
                  scheduleInputs={scheduleInputs}

                  isUploadingLayer={isUploadingLayer} setSelectedTask={setSelectedTask} setDefectModal={setDefectModal}
                  setTaskReturnView={setTaskReturnView}
                  setAssignModal={setAssignModal} simulatedStatus={simulatedStatus} editingHouseType={editingHouseType}
                  currentUserRole={currentUserRole}
                  totalChartDays={totalChartDays} timeMarkers={timeMarkers} todayTs={todayTs}
                  chartStart={chartStart} chartEnd={chartEnd} getChartLeft={getChartLeft} getChartWidth={getChartWidth}
                  assignments={assignments} taskDates={taskDates} setUpdates={setUpdates} setProgressValue={setProgressValue}
                  isAdmin={isAdmin} isProcurement={isProcurement} setScheduleInputs={setScheduleInputs} allUpdatesRecord={allUpdatesRecord}
                  handleTogglePlotCustomer={handleTogglePlotCustomer} handleTogglePlotCompleted={handleTogglePlotCompleted}
                  getPlotOverallStatus={getPlotOverallStatus} handleUploadOverviewImage={handleUploadOverviewImage}
                  togglePlotSaleStatus={togglePlotSaleStatus}
                />
              )}


              {/* 🚀 LEVEL 4: Task Progress */}
              {view === 'task-progress' && selectedTask && (
                <TaskProgressView
                  view={view} setView={setView} taskReturnView={taskReturnView}
                  isMobileLayout={isMobileLayout} selectedTask={selectedTask} selectedPlot={selectedPlot}
                  setProgressValue={setProgressValue} progressValue={progressValue} isSending={isSending}
                  setFullImageUrl={setFullImageUrl} handleDeleteUpdate={handleDeleteUpdate}
                  setExportModalOpen={setExportModalOpen}
                  isProjectPlanner={isProjectPlanner}
                  isAdmin={isAdmin} currentUserRole={currentUserRole} updates={updates} setUpdates={setUpdates}
                  inputText={inputText} setInputText={setInputText}
                  selectedFiles={selectedFiles} setSelectedFiles={setSelectedFiles}

                  isTaskCompleted={isTaskCompleted} handleOpenExportModal={handleOpenExportModal}
                  setDefectModal={setDefectModal} defects={defects} loggedInUser={loggedInUser}
                  isLockedForForeman={isLockedForForeman} isSiteEngineer={isSiteEngineer}
                  isPendingSE={isPendingSE} handleReviewAction={handleReviewAction} isQC={isQC}
                  isPendingQC={isPendingQC} isProcurement={isProcurement} isOwner={isOwner}
                  handleSendPost={handleSendPost}
                />
              )}

              {view === 'procurement-contractors' && (isAdmin || isProcurement) && (
                <div className="animate-in slide-in-from-bottom duration-300 max-w-3xl mx-auto mt-4 sm:mt-8 px-4 sm:px-0">
                  <button onClick={() => setView('dashboard')} className="mb-4 sm:mb-6 text-xs sm:text-base font-bold text-blue-600 flex items-center gap-1.5">← {isMobileLayout ? 'BACK' : 'BACK TO DASHBOARD'}</button>
                  <div className="bg-white p-5 sm:p-10 rounded-2xl sm:rounded-[2.5rem] border border-slate-200 shadow-xl">
                    <h2 className="text-xl sm:text-3xl font-black text-slate-800 uppercase italic tracking-tight mb-6 sm:mb-8 flex items-center gap-2"><Wrench className="text-emerald-500" /> Contractors DB</h2>
                    <div className="flex flex-col sm:flex-row gap-3 mb-8">
                      <input type="text" value={newContractor.name} onChange={(e) => setNewContractor({ ...newContractor, name: e.target.value })} placeholder="ชื่อช่างผู้รับเหมา..." className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-emerald-500" />
                      <input type="text" value={newContractor.phone} onChange={(e) => setNewContractor({ ...newContractor, phone: e.target.value })} placeholder="เบอร์โทรศัพท์..." className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-emerald-500" />
                      <button onClick={handleAddContractor} disabled={isSubmitting} className="bg-emerald-600 text-white px-6 py-3 rounded-xl font-black shadow-lg hover:bg-emerald-700 flex justify-center items-center gap-2">{isSubmitting ? <Loader2 className="animate-spin" size={18} /> : 'เพิ่มช่าง'}</button>
                    </div>
                    <div className="space-y-3">
                      <h3 className="text-xs sm:text-sm font-black text-slate-500 uppercase tracking-widest mb-4">รายชื่อช่างในระบบ</h3>
                      {contractors.length === 0 ? <p className="text-sm text-slate-400 italic">ยังไม่มีข้อมูลช่างในระบบ</p> : null}
                      {contractors.map(c => (
                        <div key={c.id} className="flex justify-between items-center p-4 bg-slate-50 rounded-xl border border-slate-100">
                          <div><span className="font-bold text-slate-700 block text-sm sm:text-base">{c.name}</span><span className="text-xs text-slate-500 flex items-center gap-1"><Phone size={12} /> {c.phone}</span></div>
                          <button onClick={() => handleDeleteContractor(c.id, c.name)} className="text-slate-400 hover:text-rose-500 p-2 bg-white rounded-lg shadow-sm"><Trash2 size={16} /></button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {view === 'store-dashboard' && (loggedInUser?.role === 'Store' || loggedInUser?.role === 'Admin') && (
                <div className="animate-in slide-in-from-bottom duration-300 mx-auto mt-4 sm:mt-8 px-4 sm:px-0">
                  <button onClick={() => setView('dashboard')} className="mb-4 sm:mb-6 text-xs sm:text-base font-bold text-blue-600 flex items-center gap-1.5">← {isMobileLayout ? 'BACK' : 'BACK TO DASHBOARD'}</button>
                  <MaterialStoreDashboard 
                    view={view}
                    materialRequests={materialRequests}
                    plots={plots}
                    taskTemplates={taskTemplates}
                    projects={projects}
                    loggedInUser={loggedInUser}
                    setMaterialRequests={setMaterialRequests}
                  />
                </div>
              )}

              {/* 🌟 2. ADMIN FORMS: USERS 🌟 */}
              {view === 'admin-users' && isAdmin && (
                <div className="animate-in slide-in-from-bottom duration-300 max-w-3xl mx-auto mt-4 sm:mt-8 px-4 sm:px-0">
                  <button onClick={() => setView('dashboard')} className="mb-4 sm:mb-6 text-xs sm:text-base font-bold text-blue-600 flex items-center gap-1.5">← {isMobileLayout ? 'BACK' : 'BACK TO DASHBOARD'}</button>
                  <div className="bg-white p-5 sm:p-10 rounded-2xl sm:rounded-[2.5rem] border border-slate-200 shadow-xl">
                    <h2 className="text-xl sm:text-3xl font-black text-slate-800 uppercase italic tracking-tight mb-6 sm:mb-8 flex items-center gap-2"><Users className="text-rose-600" /> Manage Users</h2>
                    <div className="flex flex-col sm:flex-row gap-3 mb-8">
                      <input type="text" value={newUser.name} onChange={(e) => setNewUser({ ...newUser, name: e.target.value })} placeholder="ชื่อผู้ใช้ใหม่..." className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-rose-500" />
                      <select value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value })} className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-rose-500 text-slate-700">
                        <option value="Foreman">Foreman</option><option value="Site Engineer">Site Engineer</option><option value="QC">QC</option><option value="Project Planner">Project Planner (วางแผน)</option><option value="Procurement">Procurement (จัดจ้าง)</option><option value="Store">Store (สโตร์)</option><option value="Admin">Admin</option><option value="Owner">Owner (ผู้บริหาร / ดูได้อย่างเดียว)</option>
                      </select>
                      <button onClick={handleAddUser} disabled={isSubmitting} className="bg-rose-600 text-white px-6 py-3 rounded-xl font-black shadow-lg hover:bg-rose-700 flex justify-center items-center gap-2">{isSubmitting ? <Loader2 className="animate-spin" size={18} /> : 'เพิ่มผู้ใช้'}</button>
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
                        <h2 className="text-xl sm:text-2xl font-black text-slate-800 uppercase italic tracking-tight flex items-center gap-2"><Monitor className="text-rose-600" /> 2.5D Task-Linked Visualizer</h2>
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
                              {isSubmitting ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />} บันทึกโครงสร้างเลเยอร์นี้
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
                              .map((task: any) => {
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
                                        <button onClick={() => setSimulatedStatus({ ...simulatedStatus, [task.id]: 'none' })} className={`px-2 py-1 rounded-md transition-colors ${currentSimStatus === 'none' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}>ยังไม่เริ่ม</button>
                                        <button onClick={() => setSimulatedStatus({ ...simulatedStatus, [task.id]: 'progress' })} className={`px-2 py-1 rounded-md transition-colors ${currentSimStatus === 'progress' ? 'bg-amber-500 text-white shadow-sm' : 'text-slate-500'}`}>กำลังทำ (0-99%)</button>
                                        <button onClick={() => setSimulatedStatus({ ...simulatedStatus, [task.id]: 'done' })} className={`px-2 py-1 rounded-md transition-colors ${currentSimStatus === 'done' ? 'bg-emerald-500 text-white shadow-sm' : 'text-slate-500'}`}>เสร็จสิ้น (100%)</button>
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
                                            <input type="number" value={config.progress_z ?? 10} onChange={(e) => setVisualConfig({ ...visualConfig, [task.id]: { ...config, progress_z: Number(e.target.value) } })} className="w-12 text-center border rounded p-0.5 text-xs font-black bg-slate-50" title="ลำดับการวางซ้อนภาพ เลขมากจะทับเลขน้อย" />
                                          </div>
                                        </div>
                                        <div className="flex items-center gap-3">
                                          <div className="w-14 h-14 bg-slate-100 border rounded-lg flex items-center justify-center overflow-hidden shrink-0">
                                            {config.progress_image ? <img src={config.progress_image} className="w-full h-full object-contain" /> : <ImageIcon className="text-slate-300" size={20} />}
                                          </div>
                                          <div className="flex-1 space-y-1">
                                            <label className="block text-[10px] bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold py-1.5 px-2 rounded-md text-center cursor-pointer border transition-colors">
                                              <input type="file" accept="image/png" className="hidden" onChange={(e) => handleUploadSlot(task.id, 'progress', e.target.files?.[0])} disabled={isUploadingLayer} />
                                              {isUploadingLayer ? 'อัปโหลด...' : 'เลือกไฟล์ PNG'}
                                            </label>
                                            {config.progress_image && (
                                              <button onClick={() => setVisualConfig({ ...visualConfig, [task.id]: { ...config, progress_image: '' } })} className="w-full text-[9px] text-rose-500 font-bold text-center block hover:underline">ลบรูปออก</button>
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
                                            <input type="number" value={config.done_z ?? 10} onChange={(e) => setVisualConfig({ ...visualConfig, [task.id]: { ...config, done_z: Number(e.target.value) } })} className="w-12 text-center border rounded p-0.5 text-xs font-black bg-slate-50" title="ลำดับการวางซ้อนภาพ เลขมากจะทับเลขน้อย" />
                                          </div>
                                        </div>
                                        <div className="flex items-center gap-3">
                                          <div className="w-14 h-14 bg-slate-100 border rounded-lg flex items-center justify-center overflow-hidden shrink-0">
                                            {config.done_image ? <img src={config.done_image} className="w-full h-full object-contain" /> : <ImageIcon className="text-slate-300" size={20} />}
                                          </div>
                                          <div className="flex-1 space-y-1">
                                            <label className="block text-[10px] bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold py-1.5 px-2 rounded-md text-center cursor-pointer border transition-colors">
                                              <input type="file" accept="image/png" className="hidden" onChange={(e) => handleUploadSlot(task.id, 'done', e.target.files?.[0])} disabled={isUploadingLayer} />
                                              {isUploadingLayer ? 'อัปโหลด...' : 'เลือกไฟล์ PNG'}
                                            </label>
                                            {config.done_image && (
                                              <button onClick={() => setVisualConfig({ ...visualConfig, [task.id]: { ...config, done_image: '' } })} className="w-full text-[9px] text-rose-500 font-bold text-center block hover:underline">ลบรูปออก</button>
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
              {/* 🌟 หน้าจอ ADMIN: กำหนดราคาขาย (PLOT PRICING) 🌟 */}
              {view === 'admin-pricing' && isAdmin && (
                <AdminPlotPricing 
                  projects={projects} 
                  plots={plots} 
                  fetchAllData={fetchAllData} 
                />
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
                          <input type="text" placeholder="เช่น Type A, บ้านเดี่ยวสองชั้น" value={houseTypeForm.type_name} onChange={(e) => setHouseTypeForm({ ...houseTypeForm, type_name: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 font-bold text-sm outline-none focus:border-rose-500" />
                        </div>
                        <div>
                          <label className="block text-[10px] font-black text-slate-500 mb-1 uppercase tracking-widest">บันทึกความจำ / รายละเอียด</label>
                          <textarea placeholder="คำอธิบายเพิ่มเติม..." value={houseTypeForm.memo} onChange={(e) => setHouseTypeForm({ ...houseTypeForm, memo: e.target.value })} rows={3} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 font-bold text-sm outline-none focus:border-rose-500 resize-none" />
                        </div>

                        <div className="flex gap-2 pt-2">
                          {isEditingType && (
                            <button onClick={() => { setHouseTypeForm({ id: '', type_name: '', memo: '' }); setIsEditingType(false); }} className="bg-slate-100 text-slate-500 px-3 py-2 rounded-xl font-bold text-xs hover:bg-slate-200">ยกเลิก</button>
                          )}
                          <button onClick={handleSaveHouseType} disabled={isSubmitting} className="flex-1 bg-rose-600 text-white font-black py-2.5 rounded-xl text-xs shadow-md hover:bg-rose-700 flex justify-center items-center gap-1.5">
                            {isSubmitting ? <Loader2 className="animate-spin" size={14} /> : (isEditingType ? 'บันทึกการแก้ไข' : 'เพิ่มแบบบ้าน')}
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* 📋 ฝั่งขวา: รายชื่อตารางแบบบ้านที่มีอยู่เดิม */}
                    <div className="bg-white p-5 sm:p-6 rounded-2xl border border-slate-200 shadow-md lg:col-span-2">
                      <h3 className="font-black text-slate-800 text-lg mb-4 uppercase italic tracking-tight border-b pb-2 flex items-center gap-1.5"><Building size={18} className="text-slate-400" /> แบบบ้านทั้งหมด ({houseTypes.length})</h3>

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
                    <h2 className="text-xl sm:text-3xl font-black text-slate-800 uppercase italic tracking-tight mb-6 flex items-center gap-2"><ClipboardList className="text-rose-600" /> Manage Tasks</h2>

                    {/* Dropdown เลือกแบบบ้าน */}
                    <div className="mb-8">
                      <label className="block text-xs font-black text-slate-500 mb-2 uppercase tracking-widest">เลือกแบบบ้านที่ต้องการตั้งค่างวดงาน</label>
                      <select
                        value={editingTaskHouseId}
                        onChange={(e) => {
                          setEditingTaskHouseId(e.target.value);
                          setTaskForm({ id: '', task_name: '', task_order: '', cost: '' });
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
                              <input type="number" placeholder="เช่น 1, 2, 3..." value={taskForm.task_order} onChange={(e) => setTaskForm({ ...taskForm, task_order: e.target.value })} className="w-full border border-slate-300 rounded-xl px-3 py-2.5 font-bold text-sm outline-none focus:border-rose-500" />
                            </div>
                            <div>
                              <label className="block text-[10px] font-black text-slate-500 mb-1 uppercase tracking-widest">ชื่องวดงาน</label>
                              <textarea placeholder="เช่น งานเทฐานราก, งานก่อผนัง..." value={taskForm.task_name} onChange={(e) => setTaskForm({ ...taskForm, task_name: e.target.value })} rows={2} className="w-full border border-slate-300 rounded-xl px-3 py-2.5 font-bold text-sm outline-none focus:border-rose-500 resize-none" />
                            </div>
                            <div>
                              <label className="block text-[10px] font-black text-slate-500 mb-1 uppercase tracking-widest">มูลค่างาน / ต้นทุน (บาท)</label>
                              <input type="number" placeholder="เช่น 50000" value={taskForm.cost} onChange={(e) => setTaskForm({ ...taskForm, cost: e.target.value })} className="w-full border border-slate-300 rounded-xl px-3 py-2.5 font-bold text-sm outline-none focus:border-rose-500" />
                            </div>
                            <div className="flex gap-2 pt-2">
                              {isEditingTask && (
                                <button onClick={() => { setTaskForm({ id: '', task_name: '', task_order: '', cost: '' }); setIsEditingTask(false); }} className="bg-slate-200 text-slate-600 px-3 py-2 rounded-xl font-bold text-xs hover:bg-slate-300">ยกเลิก</button>
                              )}
                              <button onClick={handleSaveTask} disabled={isSubmitting} className="flex-1 bg-rose-600 text-white font-black py-2.5 rounded-xl text-xs shadow-md hover:bg-rose-700 flex justify-center items-center gap-1.5">
                                {isSubmitting ? <Loader2 className="animate-spin" size={14} /> : (isEditingTask ? 'บันทึกการแก้ไข' : 'เพิ่มงาน')}
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
                                    <div className="truncate">
                                      <h4 className="font-bold text-slate-700 text-sm truncate">{task.task_name}</h4>
                                      <p className="text-[10px] text-slate-500 font-bold mt-0.5">ต้นทุน: {Number(task.cost || 0).toLocaleString()} ฿</p>
                                    </div>
                                  </div>
                                  <div className="flex gap-1.5 shrink-0 opacity-100 lg:opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button onClick={() => { setTaskForm({ id: task.id, task_name: task.task_name, task_order: task.task_order, cost: task.cost || '' }); setIsEditingTask(true); }} className="p-2 bg-slate-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors"><Settings size={16} /></button>
                                    <button onClick={() => handleDeleteTask(task)} className="p-2 bg-slate-50 text-rose-500 rounded-lg hover:bg-rose-100 transition-colors"><Trash2 size={16} /></button>
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
                    <h2 className="text-xl sm:text-3xl font-black text-slate-800 uppercase italic tracking-tight mb-6 sm:mb-8 flex items-center gap-2"><PlusCircle className="text-rose-600" /> Add Project</h2>
                    <div className="space-y-4">
                      <input type="text" value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-4 text-sm font-bold outline-none focus:border-rose-500" placeholder="ชื่อโครงการ..." />
                      <button onClick={handleAddProject} disabled={isSubmitting} className="w-full bg-rose-600 text-white font-black py-4 rounded-xl shadow-lg hover:bg-rose-700 flex justify-center items-center gap-2 text-sm sm:text-lg">{isSubmitting ? <Loader2 className="animate-spin" size={20} /> : 'ยืนยันสร้างโครงการ'}</button>
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
                          <h2 className="text-xl sm:text-3xl font-black text-slate-800 uppercase italic tracking-tight flex items-center gap-2"><MapIcon className="text-rose-600" /> Add Plot</h2>
                          <p className="text-sm font-bold text-slate-500 mt-2">To: {selectedProject.name}</p>
                        </div>
                        <div className="space-y-4">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                              <label className="block text-xs font-black text-slate-500 mb-1 uppercase tracking-widest">รหัสแปลง (Plot ID)</label>
                              <input type="text" value={newPlot.id} onChange={(e) => setNewPlot({ ...newPlot, id: e.target.value.toUpperCase() })} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 font-black text-rose-600 outline-none focus:border-rose-500 text-sm" placeholder="เช่น C-01" />
                            </div>
                            <div>
                              <label className="block text-xs font-black text-slate-500 mb-1 uppercase tracking-widest">ผู้รับผิดชอบ (Foreman)</label>
                              <select value={newPlot.foreman_name} onChange={(e) => setNewPlot({ ...newPlot, foreman_name: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-rose-500 text-slate-700">
                                <option value="" disabled>-- เลือกโฟร์แมน --</option>
                                {foremenList.map(f => <option key={f.id} value={f.username}>{f.username}</option>)}
                              </select>
                            </div>
                          </div>
                          <div>
                            <label className="block text-xs font-black text-slate-500 mb-1 uppercase tracking-widest">แบบบ้าน (House Type)</label>
                            <select value={newPlot.house_type_id} onChange={(e) => setNewPlot({ ...newPlot, house_type_id: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-rose-500 text-slate-700">
                              <option value="" disabled>-- เลือกแบบบ้าน --</option>
                              {houseTypes.map(type => <option key={type.id} value={type.id}>{type.type_name}</option>)}
                            </select>
                          </div>
                          <button onClick={handleAddPlot} disabled={isSubmitting} className="w-full bg-rose-600 text-white font-black py-4 rounded-xl mt-4 shadow-lg hover:bg-rose-700 flex justify-center items-center gap-2 text-sm sm:text-lg">{isSubmitting ? <Loader2 className="animate-spin" size={20} /> : 'ยืนยันเพิ่มแปลงบ้าน'}</button>
                        </div>
                      </>
                    ) : (
                      <div className="text-center py-10">
                        <AlertTriangle className="mx-auto text-rose-500 mb-4" size={48} />
                        <p className="text-slate-500 font-bold mb-6">กรุณาเลือกโครงการจากหน้า Dashboard ก่อน</p>
                        <button onClick={() => setView('dashboard')} className="px-6 py-3 bg-slate-100 rounded-xl font-bold text-slate-600 hover:bg-slate-200 transition-colors">กลับไปหน้าหลัก</button>
                      </div>
                    )}
                  </div>
                </div>
              )}
              </>
              )}

            </div>
          </main>

          {/* 📱 Mobile Bottom Navigation */}
          {isMobileLayout && (
            <nav className="bg-white border-t border-slate-200 p-2 fixed bottom-0 left-[14px] right-[14px] rounded-b-[2rem] z-[100] shadow-[0_-10px_40px_rgba(0,0,0,0.1)] flex justify-around">
              {/* 📜 ปุ่มแรกบนมือถือ: ฟีดรวม */}
              {(isAdmin || isOwner) && (
                <button onClick={() => setView('global-feed')} className={`flex flex-col items-center p-2 rounded-xl w-16 ${activeView === 'global-feed' ? 'text-blue-600' : 'text-slate-400'}`}>
                  <ClipboardList size={20} className={activeView === 'global-feed' ? 'fill-blue-100' : ''} />
                  <span className="text-[9px] font-black mt-1">ฟีดรวม</span>
                </button>
              )}
              {(loggedInUser?.role === 'Store' || isAdmin) && (
                <button onClick={() => setView('store-dashboard')} className={`flex flex-col items-center p-2 rounded-xl w-16 ${activeView === 'store-dashboard' ? 'text-blue-600' : 'text-slate-400'}`}>
                  <FolderOpen size={20} className={activeView === 'store-dashboard' ? 'fill-blue-100' : ''} />
                  <span className="text-[9px] font-black mt-1">สโตร์</span>
                </button>
              )}
              <button onClick={() => setView('dashboard')} className={`flex flex-col items-center p-2 rounded-xl w-16 ${activeView === 'dashboard' ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}>
                <Home size={20} className={activeView === 'dashboard' ? 'fill-blue-100' : ''} />
                <span className="text-[9px] font-black mt-1">หน้าหลัก</span>
              </button>
              {(isSiteEngineer || isForeman || isAdmin || isProjectPlanner) && (
                <button onClick={() => setView('contractor-schedule')} className={`flex flex-col items-center p-2 rounded-xl w-16 ${activeView === 'contractor-schedule' ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}>
                  <Calendar size={20} className={activeView === 'contractor-schedule' ? 'fill-blue-100' : ''} />
                  <span className="text-[9px] font-black mt-1">งานช่าง</span>
                </button>
              )}
              {(isAdmin || isProjectPlanner) && (
                <button onClick={() => setView('master-gantt')} className={`flex flex-col items-center p-2 rounded-xl w-16 ${activeView === 'master-gantt' ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}>
                  <Grid size={20} className={activeView === 'master-gantt' ? 'fill-blue-100' : ''} />
                  <span className="text-[9px] font-black mt-1">Gantt</span>
                </button>
              )}
              {(isAdmin || isProjectPlanner || isQC || isSiteEngineer || isOwner || isForeman) && (
                <button onClick={() => setView('reports')} className={`flex flex-col items-center p-2 rounded-xl w-16 ${activeView === 'reports' ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}>
                  <PieChart size={20} className={activeView === 'reports' ? 'fill-blue-100' : ''} />
                  <span className="text-[9px] font-black mt-1">รายงาน</span>
                </button>
              )}
              {(isAdmin || isProcurement) && (
                <button onClick={() => setView('procurement-contractors')} className={`flex flex-col items-center p-2 rounded-xl w-16 ${activeView === 'procurement-contractors' ? 'text-emerald-600' : 'text-slate-400 hover:text-slate-600'}`}>
                  <Wrench size={20} className={activeView === 'procurement-contractors' ? 'fill-emerald-100' : ''} />
                  <span className="text-[9px] font-black mt-1">ช่าง</span>
                </button>
              )}
              <button onClick={() => handleLogout()} className="flex flex-col items-center p-2 rounded-xl w-16 text-rose-600 hover:bg-rose-50">
                <LogOut size={20} className="fill-rose-100" />
                <span className="text-[9px] font-black mt-1">ออกระบบ</span>
              </button>
            </nav>
          )}
        </div>
      </div>
      {editPlotModal.isOpen && (
        <div className="absolute inset-0 z-[600] bg-black/40 backdrop-blur-xl flex items-center justify-center p-4 fixed transition-all">
          <div className="bg-white rounded-[2rem] shadow-2xl max-w-sm w-full p-6 space-y-5 animate-in zoom-in-95 duration-200">
            <div>
              <h3 className="text-xl font-black text-slate-800 italic uppercase flex items-center gap-2"><Settings className="text-blue-600" /> Edit Plot Info</h3>
              <p className="text-sm text-slate-500 font-bold">แก้ไขข้อมูลแปลง: {editPlotModal.plot?.id}</p>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-black text-slate-500 mb-1 uppercase tracking-widest">รหัสแปลง</label>
                <input type="text" value={editPlotModal.id} onChange={(e) => setEditPlotModal({ ...editPlotModal, id: e.target.value.toUpperCase() })} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 font-black text-blue-600 outline-none focus:border-blue-500 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-black text-slate-500 mb-1 uppercase tracking-widest">แบบบ้าน</label>
                <select value={editPlotModal.house_type_id} onChange={(e) => setEditPlotModal({ ...editPlotModal, house_type_id: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-blue-500 text-slate-700">
                  {houseTypes.map(type => <option key={type.id} value={type.id}>{type.type_name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-black text-slate-500 mb-1 uppercase tracking-widest">โฟร์แมน</label>
                <select value={editPlotModal.foreman_name} onChange={(e) => setEditPlotModal({ ...editPlotModal, foreman_name: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-blue-500 text-slate-700">
                  <option value="">-- เลือกโฟร์แมน --</option>
                  {foremenList.map(f => <option key={f.id} value={f.username}>{f.username}</option>)}
                </select>
              </div>
            </div>
            <div className="flex gap-3 w-full mt-2">
              <button onClick={() => setEditPlotModal({ ...editPlotModal, isOpen: false })} className="flex-1 bg-slate-100 text-slate-600 font-bold py-3.5 rounded-xl hover:bg-slate-200">ยกเลิก</button>
              <button onClick={handleUpdatePlot} disabled={isSubmitting} className="flex-1 bg-blue-600 text-white font-bold py-3.5 rounded-xl hover:bg-blue-700 flex justify-center items-center gap-2">
                {isSubmitting ? <Loader2 className="animate-spin" size={16} /> : 'บันทึกแก้ไข'}
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
                <h3 className="font-black text-lg sm:text-xl flex items-center gap-2 tracking-tight"><ShieldAlert size={22} /> รายการ Defect / แจ้งซ่อม</h3>
                <p className="text-rose-100 text-xs sm:text-sm font-bold mt-1 tracking-widest">แปลง: {defectModal.plotId} | งาน: {defectModal.task?.task_name}</p>
              </div>
              <button onClick={() => { setDefectModal({ isOpen: false, task: null, plotId: '' }); setDefectFiles([]); setNewDefectText(''); }} className="p-2 bg-white/10 hover:bg-white/20 rounded-full transition-colors text-white"><X size={20} /></button>
            </div>

            {/* รายการ Defect */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-slate-50 space-y-3 custom-scrollbar">
              {defects.filter(d => d.plot_id === defectModal.plotId && d.task_id === defectModal.task?.id).length === 0 ? (
                <div className="text-center text-slate-400 py-12 font-bold flex flex-col items-center">
                  <CheckCircle size={44} className="text-slate-300 mb-3 opacity-60" />
                  🎉 สภาพเนื้องานเรียบร้อยดี<br /><span className="text-xs text-slate-400 font-medium mt-1">ยังไม่มีรายการแจ้งซ่อมในหน้านี้</span>
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
                      <div className={`grid gap-2 mb-3 ${defect.image_url.split(',').filter((u: string) => u.trim() !== '').length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                        {defect.image_url.split(',').filter((u: string) => u.trim() !== '').map((url: any, i: any) => (
                          <img key={i} src={url.trim()} onClick={() => setFullImageUrl(url.trim())} className="w-full aspect-video object-cover rounded-xl cursor-zoom-in border border-slate-100 shadow-sm hover:opacity-90" alt="Defect" />
                        ))}
                      </div>
                    )}

                    <div className="flex justify-between items-center text-[10px] sm:text-xs text-slate-500 mt-2 border-t border-slate-100 pt-2.5">
                      <span className="flex items-center gap-1 font-bold text-slate-400"><HardHat size={12} /> ผู้แจ้ง: {defect.reported_by}</span>
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
                    <input type="file" multiple accept="image/*" className="hidden" onChange={(e) => { const files = Array.from(e.target.files || []).map(f => ({ file: f, previewUrl: URL.createObjectURL(f) })); setDefectFiles([...defectFiles, ...files].slice(0, 4)); }} />
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
                    {isSubmittingDefect ? <Loader2 className="animate-spin" size={16} /> : <><span className="hidden sm:inline">ส่งเรื่อง</span><Send size={14} /></>}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      {editProjectModal.isOpen && (
        <div className="absolute inset-0 z-[600] bg-black/40 backdrop-blur-xl flex items-center justify-center p-4 fixed transition-all">
          <div className="bg-white rounded-[2rem] shadow-2xl max-w-sm w-full p-6 space-y-5 animate-in zoom-in-95 duration-200">
            <div>
              <h3 className="text-xl font-black text-slate-800 italic uppercase flex items-center gap-2"><Settings className="text-blue-600" /> Edit Project Name</h3>
              <p className="text-sm text-slate-500 font-bold">ชื่อเดิม: {editProjectModal.oldName}</p>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-black text-slate-500 mb-1 uppercase tracking-widest">ชื่อโครงการใหม่</label>
                <input type="text" value={editProjectModal.newName} onChange={(e) => setEditProjectModal({ ...editProjectModal, newName: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 font-bold text-slate-700 outline-none focus:border-blue-500" placeholder="ระบุชื่อโครงการ..." />
              </div>
            </div>
            <div className="flex gap-3 w-full mt-2">
              <button onClick={() => setEditProjectModal({ ...editProjectModal, isOpen: false })} className="flex-1 bg-slate-100 text-slate-600 font-bold py-3.5 rounded-xl hover:bg-slate-200">ยกเลิก</button>
              <button onClick={handleUpdateProject} disabled={isSubmitting} className="flex-1 bg-blue-600 text-white font-bold py-3.5 rounded-xl hover:bg-blue-700 flex justify-center items-center gap-2">
                {isSubmitting ? <Loader2 className="animate-spin" size={16} /> : 'บันทึกแก้ไข'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* 📺 PRESENTATION MODAL (ห้องประชุม) */}
      {isPresentationOpen && plots.length > 0 && (() => {
        const currentPlot = plots[currentSlideIndex];

        // 🌟 คำนวณความคืบหน้าและสถานะ (แก้บั๊ก getPlotStatus)
        const allPlotUpdates = allUpdatesRecord.filter((u: any) => u.plot_id === currentPlot.id).sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
        sevenDaysAgo.setHours(0, 0, 0, 0);
        const plotUpdates = allPlotUpdates
          .filter((u: any) => new Date(u.created_at).getTime() >= sevenDaysAgo.getTime())
          .map((u: any) => {
            let assign = assignments.find((a: any) => a.plot_id === u.plot_id && a.task_template_id === u.task_template_id);
            if (!assign && u.action) {
              assign = assignments.find((a: any) => a.plot_id === u.plot_id && a.task_name && (u.action === a.task_name || u.action.includes(a.task_name) || a.task_name.includes(u.action)));
            }
            
            let task = taskTemplates.find((t: any) => t.id === u.task_template_id);
            if (!task && u.action) {
              task = taskTemplates.find((t: any) => t.task_name && (u.action === t.task_name || u.action.includes(t.task_name) || t.task_name.includes(u.action)));
            }
            
            const finalTaskName = assign?.task_name || task?.task_name || u.action;
            const finalTaskId = assign?.task_template_id || task?.id || u.task_template_id || `temp-${u.id || Math.random()}`;

            const exactChatActions = ['Site Engineer อนุมัติ', 'QC อนุมัติ', 'QC อนุมัติผ่าน', 'ส่งงาน', 'อัปเดตงาน', 'อัปเดตสถานะงาน', 'อัพเดตงาน', 'อัพเดตสถานะงาน', 'อัปเดทงาน', 'เข้าตรวจสอบ'];
            if (finalTaskName && exactChatActions.includes(finalTaskName.trim())) {
               return null; 
            }

            return { ...u, action: finalTaskName, task_template_id: finalTaskId };
          })
          .filter(Boolean);

        // เปอร์เซ็นต์เสร็จของบ้านแต่ละหลัง
        const statusInfo = getPlotOverallStatus(currentPlot.id);
        const latestUpdate = plotUpdates.length > 0 ? plotUpdates[0] : null;

        let plotImages: any[] = [];
        plotUpdates.forEach(u => {
          if (u.image_url) {
            const urls = u.image_url.split(',').filter((url: string) => url.trim() !== '');

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

            urls.forEach((url: string) => {
              plotImages.push({
                url: url.trim(),
                date: u.created_at,
                action: u.action || 'อัปเดตสถานะงาน',
                contractor: contractorName,
                progress: u.progress
              });
            });
          }
        });

        // 🌟 จัดกลุ่มรูปภาพตามชื่องาน (Action) เพื่อให้แสดงกรอบแยกงานอย่างถูกต้อง (ลิมิตกลุ่มละ 4 รูป)
        const groupedImages = plotImages.reduce((acc: any, img: any) => {
          if (!acc[img.action]) acc[img.action] = { contractor: img.contractor, progress: img.progress, images: [] };
          if (acc[img.action].images.length < 4) {
            acc[img.action].images.push(img);
          }
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
                {/* 🌟 ฟังก์ชันค้นหาและข้ามแปลง (Jump to Plot) */}
                <div className="flex items-center gap-1.5 sm:gap-2 bg-slate-800 px-2 sm:px-3 py-1.5 rounded-lg border border-slate-700">
                  <Search size={16} className="text-slate-400 shrink-0" />
                  <input
                    id="presentation-plot-search"
                    type="text"
                    list="plot-search-list-top"
                    placeholder="ค้นหาแปลง..."
                    className="bg-transparent border-none text-white text-xs sm:text-sm font-bold outline-none placeholder:text-slate-500 w-20 sm:w-32 focus:ring-0 p-0"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const val = (e.target as HTMLInputElement).value.trim();
                        if (!val) return;
                        const idx = plots.findIndex((p: any) => p.id.toLowerCase() === val.toLowerCase());
                        if (idx !== -1) {
                          setCurrentSlideIndex(idx);
                          (e.target as HTMLInputElement).value = ''; // clear after jumping
                          (e.target as HTMLInputElement).blur(); // remove focus
                        } else {
                          alert('ไม่พบข้อมูลแปลง: ' + val);
                        }
                      }
                    }}
                  />
                  <button
                    className="bg-indigo-500 hover:bg-indigo-400 text-white text-[10px] sm:text-xs font-bold px-2 sm:px-3 py-1 rounded transition-colors"
                    onClick={() => {
                      const input = document.getElementById('presentation-plot-search') as HTMLInputElement;
                      if (input) {
                        const val = input.value.trim();
                        if (!val) return;
                        const idx = plots.findIndex((p: any) => p.id.toLowerCase() === val.toLowerCase());
                        if (idx !== -1) {
                          setCurrentSlideIndex(idx);
                          input.value = '';
                          input.blur();
                        } else {
                          alert('ไม่พบข้อมูลแปลง: ' + val);
                        }
                      }
                    }}
                  >
                    ไป
                  </button>
                  <datalist id="plot-search-list-top">
                    {plots.map((p: any) => <option key={p.id} value={p.id} />)}
                  </datalist>
                </div>
                <span className="hidden sm:inline-block text-slate-400 font-bold text-sm bg-slate-800 px-3 py-1.5 rounded-lg shrink-0">สไลด์ {currentSlideIndex + 1} / {plots.length}</span>
                <span className="sm:hidden text-slate-400 font-bold text-xs shrink-0">{currentSlideIndex + 1}/{plots.length}</span>
                <button onClick={() => setIsPresentationOpen(false)} className="bg-rose-500 hover:bg-rose-600 p-2 sm:px-4 sm:py-2 rounded-xl text-white font-bold transition flex items-center gap-2 shadow-sm shrink-0">
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

              {/* Presentation Slide Card (Fill Screen) */}
              <div 
                className={`bg-[#f5f5f7] rounded-2xl sm:rounded-[2.5rem] shadow-[0_20px_50px_rgba(0,0,0,0.5)] flex flex-col sm:flex-row overflow-hidden border border-slate-800/50 ${isMobileLayout ? 'w-full aspect-[4/3] max-h-full' : 'w-[94vw] h-[88vh] max-w-none max-h-none'}`}
              >

                {/* Left Panel: Table Summary (60%) */}
                <div className="w-full sm:w-7/12 bg-white p-6 sm:p-10 flex flex-col justify-between shrink-0 overflow-y-auto custom-scrollbar shadow-[10px_0_20px_rgba(0,0,0,0.03)] z-10">
                  <div>
                    {/* Header */}
                    <div className="flex justify-between items-start mb-4 border-b border-slate-100 pb-3">
                      <div>
                        <h2 className="text-3xl sm:text-4xl font-black text-slate-800 mb-1">{currentPlot.id}</h2>
                        <div className={`inline-block px-3 py-1 rounded-full font-black text-xs sm:text-sm shadow-sm ${statusInfo.status === 'delayed' ? 'bg-rose-100 text-rose-700' : statusInfo.status === 'completed' ? 'bg-emerald-100 text-emerald-700' : statusInfo.status === 'ahead' ? 'bg-indigo-100 text-indigo-700' : statusInfo.status === 'on-track' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-700'}`}>
                          {statusInfo.label}
                        </div>
                      </div>
                      <div className="flex gap-3 sm:gap-6 text-right">
                        <div>
                          <p className="text-[9px] sm:text-[10px] font-semibold text-slate-400 uppercase tracking-[0.2em] mb-0.5">P L A N</p>
                          <div className="text-2xl sm:text-3xl font-black text-slate-300 tracking-tighter">{statusInfo.planned}%</div>
                        </div>
                        <div>
                          <p className="text-[10px] sm:text-[11px] font-semibold text-slate-400 uppercase tracking-[0.2em] mb-0.5">A C T U A L</p>
                          <div className="text-4xl sm:text-5xl font-black text-blue-600 tracking-tighter">{statusInfo.actual}%</div>
                        </div>
                      </div>
                    </div>

                    {/* Table Area */}
                    <div>
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-3 gap-2">
                        <h4 className="text-[11px] sm:text-xs font-black text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                          <Activity size={14} className="text-indigo-500" /> สถานะงานรายงวดที่มีการอัปเดต (7 วันย้อนหลัง)
                        </h4>
                        <div className="text-[10px] font-bold text-amber-700 bg-amber-50 px-2 py-1 rounded-md flex items-center gap-1 w-fit">
                          <Users size={12} className="text-amber-500" />
                          Foreman: {currentPlot.foreman || 'ไม่ระบุ'}
                        </div>
                      </div>

                      {plotUpdates.length > 0 ? (
                        <div className="overflow-x-auto custom-scrollbar pb-2">
                          <table className="w-full text-left border-collapse min-w-[500px]">
                            <thead>
                              <tr className="border-b border-slate-100">
                                <th className="p-3 text-[10px] font-semibold text-slate-400 uppercase tracking-wider w-[45%]">Task Name</th>
                                <th className="p-3 text-[10px] font-semibold text-slate-400 uppercase tracking-wider text-center">Start</th>
                                <th className="p-3 text-[10px] font-semibold text-rose-500 uppercase tracking-wider text-center">Duration</th>
                                <th className="p-3 text-[10px] font-semibold text-slate-400 uppercase tracking-wider text-center">Finish</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50 bg-white">
                              {Array.from(new Set(plotUpdates.map((u: any) => u.task_template_id))).map((taskId: any, tIdx) => {
                                const specificTaskUpdates = plotUpdates.filter((u: any) => u.task_template_id === taskId);
                                const latestTaskUpdate = specificTaskUpdates[0];
                                const taskProgress = Number(latestTaskUpdate.progress) || 0;
                                const taskAction = latestTaskUpdate.action;

                                const matchedAssign = assignments.slice().reverse().find(a => String(a.plot_id) === String(currentPlot.id) && String(a.task_template_id) === String(taskId));
                                const contractorName = matchedAssign ? matchedAssign.contractor_name : 'ไม่ระบุช่าง';
                                const contractorPhone = matchedAssign?.contractor_phone ? `📞 ${matchedAssign.contractor_phone}` : '';

                                let delayStatusStr = 'ไม่มีแผน';
                                let delayColor = 'text-slate-400 bg-slate-50 border-slate-200';

                                const schedPlan = schedules[`${currentPlot.id}-${taskId}`];
                                const planStart = schedPlan?.planned_start ? new Date(schedPlan.planned_start).toLocaleDateString('th-TH') : '-';
                                const planEnd = schedPlan?.planned_end ? new Date(schedPlan.planned_end).toLocaleDateString('th-TH') : '-';
                                const actualStart = matchedAssign?.actual_start_date ? new Date(matchedAssign.actual_start_date).toLocaleDateString('th-TH') : '-';
                                
                                let first100DateInStreak = null;
                                for (let i = 0; i < specificTaskUpdates.length; i++) {
                                    if (specificTaskUpdates[i].progress < 100) break;
                                    first100DateInStreak = specificTaskUpdates[i].created_at || specificTaskUpdates[i].updated_at;
                                }

                                let rawActualEndToUse = first100DateInStreak || matchedAssign?.actual_end_date;
                                const actualEndRaw = rawActualEndToUse ? new Date(rawActualEndToUse).toLocaleDateString('th-TH') : '-';
                                
                                // Dynamic Actual Finish Date Logic
                                let actualEndUI = <div className="text-[10px] sm:text-[11px] font-bold text-slate-400 whitespace-nowrap bg-slate-50 px-2 py-0.5 rounded w-[90px] text-center">-</div>;
                                if (taskProgress === 100 && actualEndRaw !== '-') {
                                    const tTemplate = taskTemplates.find(t => t.id === taskId);
                                    if (taskAction === 'QC อนุมัติ' || taskAction === 'QC อนุมัติผ่าน' || (!tTemplate?.require_qc && taskAction === 'Site Engineer อนุมัติ')) {
                                      actualEndUI = <div className="flex items-center justify-center gap-1 text-[10px] sm:text-[11px] font-bold text-emerald-700 whitespace-nowrap bg-emerald-50 px-2 py-0.5 rounded w-[110px] text-center"><span>{actualEndRaw}</span><span className="text-[8px] bg-emerald-200 text-emerald-800 px-1 rounded-sm">✅ สำเร็จ</span></div>;
                                    } else if (taskAction === 'Site Engineer อนุมัติ' && tTemplate?.require_qc) {
                                      actualEndUI = <div className="flex items-center justify-center gap-1 text-[10px] sm:text-[11px] font-bold text-orange-700 whitespace-nowrap bg-orange-50 px-2 py-0.5 rounded w-[110px] text-center"><span>{actualEndRaw}</span><span className="text-[8px] bg-orange-200 text-orange-800 px-1 rounded-sm">🔍 รอ QC</span></div>;
                                    } else if (taskAction === 'ส่งงาน 100%' || latestTaskUpdate?.role === 'Foreman') {
                                      actualEndUI = <div className="flex items-center justify-center gap-1 text-[10px] sm:text-[11px] font-bold text-yellow-700 whitespace-nowrap bg-yellow-50 px-2 py-0.5 rounded w-[110px] text-center"><span>{actualEndRaw}</span><span className="text-[8px] bg-yellow-200 text-yellow-800 px-1 rounded-sm">⏳ รอ SE</span></div>;
                                    } else {
                                      actualEndUI = <div className="text-[10px] sm:text-[11px] font-bold text-blue-700 whitespace-nowrap bg-blue-50 px-2 py-0.5 rounded w-[90px] text-center">{actualEndRaw}</div>;
                                    }
                                }


                                const calcDays = (start: string | null, end: string | null) => {
                                   if (!start || !end) return null;
                                   const s = new Date(start); s.setHours(0,0,0,0);
                                   const e = new Date(end); e.setHours(0,0,0,0);
                                   const days = Math.ceil((e.getTime() - s.getTime()) / (1000 * 3600 * 24)) + 1;
                                   return days > 0 ? days : 0;
                                };
                                const planDays = calcDays(schedPlan?.planned_start || null, schedPlan?.planned_end || null);
                                const actualDays = calcDays(matchedAssign?.actual_start_date || null, matchedAssign?.actual_end_date || null) || (matchedAssign?.actual_start_date && taskProgress < 100 ? calcDays(matchedAssign?.actual_start_date, new Date().toISOString()) : null);
                                const planDurationStr = planDays !== null ? `${planDays} วัน` : '-';
                                const actualDurationStr = actualDays !== null ? `${actualDays} วัน` : '-';

                                if (schedPlan?.planned_end) {
                                  const pEnd = new Date(schedPlan.planned_end);
                                  pEnd.setHours(0, 0, 0, 0);

                                  let dateToCompare = new Date();
                                  dateToCompare.setHours(0, 0, 0, 0);

                                  if (taskProgress >= 100 && matchedAssign?.actual_end_date) {
                                    dateToCompare = new Date(matchedAssign.actual_end_date);
                                    dateToCompare.setHours(0, 0, 0, 0);
                                  }

                                  const daysDiff = Math.ceil((dateToCompare.getTime() - pEnd.getTime()) / (1000 * 3600 * 24));

                                  if (daysDiff > 0) {
                                    delayStatusStr = `ล่าช้า ${daysDiff} วัน`;
                                    delayColor = 'text-rose-600 bg-rose-50 border-rose-200';
                                  } else if (daysDiff < 0) {
                                    delayStatusStr = `เร็ว ${Math.abs(daysDiff)} วัน`;
                                    delayColor = 'text-emerald-600 bg-emerald-50 border-emerald-200';
                                  } else {
                                    delayStatusStr = 'ตามแผน';
                                    delayColor = 'text-blue-600 bg-blue-50 border-blue-200';
                                  }
                                }

                                return (
                                  <tr key={tIdx} className="hover:bg-slate-50/50 transition-colors group">
                                    <td className="p-3 align-middle">
                                      <div className="flex items-start gap-2 mb-1.5 pr-2">
                                        <span className="font-bold text-slate-800 text-[11px] sm:text-xs leading-tight line-clamp-2">{taskAction}</span>
                                      </div>
                                      <div className="flex items-center gap-2 mb-2">
                                        <div className="text-[10px] font-medium text-slate-500 flex items-center gap-1 bg-slate-50 px-1.5 py-0.5 rounded truncate max-w-[150px]">
                                          <HardHat size={12} /> {contractorName}
                                        </div>
                                        {contractorPhone && <div className="text-[9px] text-slate-400 font-medium whitespace-nowrap">{contractorPhone}</div>}
                                      </div>
                                      <div className="flex items-center gap-2 pr-6">
                                        <div className="flex-1 bg-slate-100 rounded-full h-1.5 overflow-hidden">
                                          <div className="bg-blue-500 h-1.5 rounded-full" style={{ width: `${taskProgress}%` }}></div>
                                        </div>
                                        <span className="text-blue-600 text-[10px] font-bold shrink-0 w-8">{taskProgress}%</span>
                                      </div>
                                      <div className="mt-2">
                                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md ${delayColor} shadow-sm border`}>
                                          {delayStatusStr}
                                        </span>
                                      </div>
                                    </td>
                                    
                                    <td className="p-2 align-middle">
                                      <div className="flex flex-col justify-center items-center gap-2">
                                        <div className="flex items-center justify-between w-[90px] gap-1.5">
                                          <span className="text-[8px] font-bold text-slate-400 tracking-wider">PLAN</span>
                                          <span className="text-[10px] sm:text-[11px] font-medium text-slate-600 whitespace-nowrap bg-slate-50 px-2 py-0.5 rounded">{planStart}</span>
                                        </div>
                                        <div className="flex items-center justify-between w-[90px] gap-1.5">
                                          <span className="text-[8px] font-bold text-blue-400 tracking-wider">ACTUAL</span>
                                          <span className="text-[10px] sm:text-[11px] font-bold text-blue-700 whitespace-nowrap bg-blue-50 px-2 py-0.5 rounded">{actualStart}</span>
                                        </div>
                                      </div>
                                    </td>

                                    <td className="p-2 align-middle">
                                      <div className="flex flex-col justify-center items-center gap-2">
                                        <div className="text-[10px] sm:text-[11px] font-medium text-slate-600 whitespace-nowrap bg-slate-50 px-2 py-0.5 rounded w-[60px] text-center">{planDurationStr}</div>
                                        <div className="text-[10px] sm:text-[11px] font-bold text-blue-700 whitespace-nowrap bg-blue-50 px-2 py-0.5 rounded w-[60px] text-center">{actualDurationStr}</div>
                                      </div>
                                    </td>

                                    <td className="p-2 align-middle">
                                      <div className="flex flex-col justify-center items-center gap-2">
                                        <div className="text-[10px] sm:text-[11px] font-medium text-slate-600 whitespace-nowrap bg-slate-50 px-2 py-0.5 rounded w-[90px] text-center">{planEnd}</div>
                                        {actualEndUI}
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <div className="bg-slate-50 border border-slate-200 p-6 rounded-xl text-slate-400 italic text-sm font-medium flex flex-col items-center justify-center gap-2 min-h-[200px]">
                          <Clock size={32} className="opacity-50" />
                          สัปดาห์นี้ยังไม่มีบันทึกรายงานสถานะงาน
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 sm:mt-6 pt-3 sm:pt-4 border-t border-slate-100 shrink-0">
                    <p className="text-[10px] sm:text-xs text-slate-400 font-bold flex items-center justify-between">
                      <span>อัปเดตล่าสุด: {new Date().toLocaleDateString('th-TH')}</span>
                      <span className="flex items-center gap-1 text-slate-300"><Monitor size={12} /> BuildTrack Schedule</span>
                    </p>
                  </div>
                </div>

                {/* Right Panel: Image Gallery (40%) */}
                <div className="w-full sm:w-5/12 bg-[#f5f5f7] p-6 sm:p-8 flex flex-col relative overflow-y-auto custom-scrollbar">
                  
                  {/* ภาพรวมหน้าบ้าน (Overview Image) */}
                  {currentPlot.overview_image_url && (
                    <div 
                      className="mb-6 shrink-0 relative w-full h-40 sm:h-56 rounded-2xl overflow-hidden shadow-md border border-slate-200 group cursor-pointer" 
                      onClick={() => {
                        const plotsWithOverview = plots.filter((p: any) => p.overview_image_url);
                        const images = plotsWithOverview.map((p: any) => ({ url: p.overview_image_url, label: `รูปหน้าบ้านแปลง: ${p.id}` }));
                        const idx = plotsWithOverview.findIndex((p: any) => p.id === currentPlot.id);
                        if (images.length > 0) {
                          setGalleryImages(images);
                          setGalleryIndex(idx !== -1 ? idx : 0);
                        }
                      }}
                    >
                      <img src={currentPlot.overview_image_url} alt="Overview" className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" />
                      <div className="absolute bottom-3 left-3 bg-white/90 text-slate-800 px-3 py-1.5 rounded-lg backdrop-blur-sm shadow-sm text-[10px] font-bold flex items-center gap-1.5">
                        <ImageIcon size={14}/> ภาพหน้าบ้าน
                      </div>
                    </div>
                  )}

                  <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2 text-base sm:text-lg shrink-0 tracking-tight"><Camera className="text-slate-400" /> รูปอัปเดตรายงวดงาน</h3>
                  {plotImages.length > 0 ? (
                    <div className="flex-1 flex flex-col">
                      <div className="grid grid-cols-2 gap-2 sm:gap-3 auto-rows-max">
                        {plotImages.slice(0, 6).map((img: any, idx: number) => (
                          <div key={idx} className="relative bg-slate-200 rounded-2xl overflow-hidden aspect-square group shadow-[0_4px_15px_rgba(0,0,0,0.05)] border border-slate-200/50">
                            <img
                              src={img.url}
                              onClick={() => setFullImageUrl(img.url)}
                              className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110 cursor-zoom-in"
                              alt={img.action}
                            />
                            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent p-3 pt-12 pointer-events-none">
                              <p className="text-white font-semibold text-[10px] drop-shadow-md truncate mb-0.5">📂 {img.action}</p>
                              <p className="text-white/80 font-medium text-[9px] text-right">{new Date(img.date).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="flex-1 flex flex-col items-center justify-center bg-slate-100 rounded-2xl border border-dashed border-slate-300 min-h-[250px]">
                      <ImageIcon size={48} className="text-slate-300 mb-3" />
                      <p className="text-slate-400 font-medium text-xs sm:text-sm">ยังไม่มีรูปถ่ายความคืบหน้า</p>
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
          const activities: any[] = [];

          allUpdatesRecord.filter(u => new Date(u.created_at).toLocaleDateString('en-CA') === targetDate && u.role !== 'Admin').forEach(u => {
            const task = taskTemplates.find(t => t.id === u.task_template_id);
            activities.push({ time: new Date(u.created_at).getTime(), timeStr: new Date(u.created_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }), user: u.user_name, role: u.role, plot: u.plot_id, taskName: task ? task.task_name : 'อัปเดตงาน', action: u.action, detail: u.text_content || '-', type: 'update' });
          });

          defects.filter(d => new Date(d.created_at).toLocaleDateString('en-CA') === targetDate).forEach(d => {
            const user = allUsers.find(u => u.username === d.reported_by);
            if (user?.role === 'Admin') return;
            const task = taskTemplates.find(t => t.id === d.task_id);
            activities.push({ time: new Date(d.created_at).getTime(), timeStr: new Date(d.created_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }), user: d.reported_by, role: user ? user.role : 'Unknown', plot: d.plot_id, taskName: task ? task.task_name : 'ไม่ระบุงาน', action: 'แจ้ง Defect / ซ่อม', detail: d.description || 'แนบรูปภาพ', type: 'defect' });
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
