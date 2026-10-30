'use client';

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  Calendar,
  Clock,
  MapPin,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  HelpCircle,
  Search,
  Filter,
  RefreshCw,
  Scan,
  Maximize2,
  X,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Camera,
  User,
  Building,
  Printer,
  ShieldAlert,
  HardHat,
  ArrowRight,
  Info,
  ClipboardList
} from 'lucide-react';
import {
  auditPhoto,
  getCachedPhotoAudit,
  fetchBatchPhotoAuditsFromDb,
  PhotoAuditResult,
  PhotoAuditStatus
} from '@/lib/photoAudit';
import { ProjectMap3DColonySim } from './ProjectMap3DColonySim';

export interface DailySiteActivitiesViewProps {
  allUpdatesRecord?: any[];
  defects?: any[];
  defectUpdates?: any[];
  plots?: any[];
  projects?: any[];
  taskTemplates?: any[];
  allUsers?: any[];
  currentUser?: any;
  onSelectPlot?: (plot: any) => void;
  onSelectTask?: (taskId: string, plotId: string) => void;
  selectedProject?: any;
  mapGrid?: any[];
  plotBounds?: Record<string, { minX: number; minY: number; maxX: number; maxY: number }>;
  gridCols?: number;
  gridRows?: number;
  getPlotOverallStatus?: (plotId: any) => any;
  houseTypes?: any[];
  plotsActiveToday?: Set<string>;
  setSelectedPlot?: (plot: any) => void;
  setSelectedTask?: (task: any) => void;
  setView?: (v: string) => void;
}

interface ActivityItem {
  id: string;
  sourceType: 'task_update' | 'defect' | 'defect_update';
  plotId: string;
  projectName: string;
  taskName: string;
  taskId?: string;
  userName: string;
  userRole: string;
  actionText: string;
  detailText: string;
  createdAt: string;
  weatherInfo?: string;
  imageUrls: string[];
}

export const DailySiteActivitiesView: React.FC<DailySiteActivitiesViewProps> = ({
  allUpdatesRecord = [],
  defects = [],
  defectUpdates = [],
  plots = [],
  projects = [],
  taskTemplates = [],
  allUsers = [],
  currentUser,
  onSelectPlot,
  onSelectTask,
  selectedProject,
  mapGrid = [],
  plotBounds = {},
  gridCols = 30,
  gridRows = 20,
  getPlotOverallStatus,
  houseTypes = [],
  plotsActiveToday = new Set(),
  setSelectedPlot,
  setSelectedTask,
  setView
}) => {
  const [dailyMode, setDailyMode] = useState<'timeline' | '3d-colony'>('timeline');

  // 📅 Selected Date (default: today Bangkok YYYY-MM-DD)
  const getTodayBkk = () => {
    const d = new Date();
    const utc = d.getTime() + (d.getTimezoneOffset() * 60000);
    const bkk = new Date(utc + (7 * 3600000));
    return bkk.toISOString().slice(0, 10);
  };

  const [selectedDate, setSelectedDate] = useState<string>(getTodayBkk());
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProjectFilter, setSelectedProjectFilter] = useState('ALL');
  const [selectedPlotFilter, setSelectedPlotFilter] = useState('ALL');
  const [selectedUserFilter, setSelectedUserFilter] = useState('ALL');
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<'ALL' | 'on_time' | 'delayed' | 'cross_day' | 'mismatch' | 'unscanned'>('ALL');
  const [onlyWithPhotos, setOnlyWithPhotos] = useState(false);

  // 🏗️ Selected Project for 3D View (defaults to ไอลิน6 or selectedProject or first project)
  const defaultProj = useMemo(() => {
    if (selectedProject?.name) return selectedProject;
    if (selectedProjectFilter !== 'ALL') {
      const match = projects.find((p: any) => p.name === selectedProjectFilter);
      if (match) return match;
    }
    const ailin = projects.find((p: any) => p.name.includes('ไอลิน'));
    if (ailin) return ailin;
    return projects.length > 0 ? projects[0] : null;
  }, [projects, selectedProject, selectedProjectFilter]);

  const [selected3DProjectName, setSelected3DProjectName] = useState<string>('');

  useEffect(() => {
    if (!selected3DProjectName && defaultProj?.name) {
      setSelected3DProjectName(defaultProj.name);
    }
  }, [defaultProj, selected3DProjectName]);

  const active3DProject = useMemo(() => {
    if (selected3DProjectName) {
      const found = projects.find((p: any) => p.name === selected3DProjectName);
      if (found) return found;
    }
    return defaultProj;
  }, [selected3DProjectName, projects, defaultProj]);

  // Extract layout_data of the selected project
  const projectLayoutData = useMemo(() => {
    return active3DProject?.layout_data || [];
  }, [active3DProject]);

  const configCell = useMemo(() => {
    return projectLayoutData.find((c: any) => c.type === 'config');
  }, [projectLayoutData]);

  const actualGridCols = configCell?.cols || 30;
  const actualGridRows = configCell?.rows || 44;

  const actualMapGrid = useMemo(() => {
    return projectLayoutData.filter((c: any) => c.type !== 'config');
  }, [projectLayoutData]);

  // Filter plots to this project ONLY!
  const projectPlots = useMemo(() => {
    if (!active3DProject) return [];
    return plots.filter((p: any) => p.project_name === active3DProject.name);
  }, [plots, active3DProject]);

  // Compute exact plot bounds from layout_data
  const projectPlotBounds = useMemo(() => {
    const bounds: Record<string, { minX: number; minY: number; maxX: number; maxY: number }> = {};
    
    const plotMapById = new Map<string, any>();
    const plotMapByName = new Map<string, any>();
    projectPlots.forEach((p: any) => {
      plotMapById.set(String(p.id), p);
      if (p.plot_name) plotMapByName.set(String(p.plot_name), p);
    });

    actualMapGrid.filter((c: any) => c.type === 'plot' && c.plotId).forEach((c: any) => {
      const rawId = String(c.plotId);
      const matched = plotMapById.get(rawId) || plotMapByName.get(rawId);

      const updateBounds = (key: string) => {
        if (!bounds[key]) {
          bounds[key] = { minX: c.x, maxX: c.x, minY: c.y, maxY: c.y };
        } else {
          bounds[key].minX = Math.min(bounds[key].minX, c.x);
          bounds[key].maxX = Math.max(bounds[key].maxX, c.x);
          bounds[key].minY = Math.min(bounds[key].minY, c.y);
          bounds[key].maxY = Math.max(bounds[key].maxY, c.y);
        }
      };

      updateBounds(rawId);
      if (matched) {
        updateBounds(String(matched.id));
        if (matched.plot_name) updateBounds(String(matched.plot_name));
      }
    });

    // If layout_data had no plot bounds for this plot, check plotBounds prop
    if (Object.keys(bounds).length === 0 && Object.keys(plotBounds).length > 0) {
      return plotBounds;
    }

    return bounds;
  }, [actualMapGrid, projectPlots, plotBounds]);

  // 🔍 Photo Audits map: key is image URL -> PhotoAuditResult
  const [auditResults, setAuditResults] = useState<Record<string, PhotoAuditResult>>({});
  const [scanningUrls, setScanningUrls] = useState<Record<string, boolean>>({});
  const [isBatchScanning, setIsBatchScanning] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0 });

  // 🖼️ Fullscreen Preview Modal
  const [previewPhoto, setPreviewPhoto] = useState<{
    url: string;
    activity: ActivityItem;
    audit?: PhotoAuditResult;
  } | null>(null);

  // Quick jump dates
  const handlePrevDay = () => {
    const cur = new Date(selectedDate);
    cur.setDate(cur.getDate() - 1);
    setSelectedDate(cur.toISOString().slice(0, 10));
  };

  const handleNextDay = () => {
    const cur = new Date(selectedDate);
    cur.setDate(cur.getDate() + 1);
    setSelectedDate(cur.toISOString().slice(0, 10));
  };

  const handleToday = () => {
    setSelectedDate(getTodayBkk());
  };

  // Helper to extract image URLs from comma-separated string or array
  const parseImages = (raw: any): string[] => {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw.filter(Boolean);
    if (typeof raw === 'string') {
      return raw.split(',').map(s => s.trim()).filter(s => s.length > 5);
    }
    return [];
  };

  // 1. Gather all activity items for the selected date
  const dayActivities = useMemo<ActivityItem[]>(() => {
    const items: ActivityItem[] = [];
    const targetDateStr = selectedDate;

    const isMatchDate = (isoString?: string) => {
      if (!isoString) return false;
      try {
        const d = new Date(isoString);
        if (isNaN(d.getTime())) return false;
        const bkk = new Date(d.getTime() + (7 * 3600000));
        return bkk.toISOString().slice(0, 10) === targetDateStr;
      } catch {
        return false;
      }
    };

    // Task updates
    for (const update of allUpdatesRecord) {
      if (!isMatchDate(update.created_at)) continue;
      const task = taskTemplates.find(t => t.id === update.task_template_id);
      const plot = plots.find(p => String(p.id) === String(update.plot_id));
      const projName = plot?.project_name || (update.plot_id?.includes('-') ? update.plot_id.split('-')[0] : 'โครงการ');

      items.push({
        id: `update-${update.id}`,
        sourceType: 'task_update',
        plotId: update.plot_id || 'ไม่ระบุ',
        projectName: projName,
        taskName: update.task_name || task?.task_name || update.action || 'อัปเดตงานก่อสร้าง',
        taskId: update.task_template_id,
        userName: update.user_name || 'ผู้รับผิดชอบ',
        userRole: update.role || 'Foreman',
        actionText: update.action || 'อัปเดตความคืบหน้า',
        detailText: update.text_content || '',
        createdAt: update.created_at,
        weatherInfo: update.weather_info,
        imageUrls: parseImages(update.image_url)
      });
    }

    // Defects reported on this day
    for (const defect of defects) {
      if (!isMatchDate(defect.created_at)) continue;
      const task = taskTemplates.find(t => t.id === (defect.task_template_id || defect.task_id));
      const plot = plots.find(p => String(p.id) === String(defect.plot_id));
      const projName = plot?.project_name || (defect.plot_id?.includes('-') ? defect.plot_id.split('-')[0] : 'โครงการ');
      const user = allUsers.find(u => u.username === defect.reported_by);

      items.push({
        id: `defect-${defect.id}`,
        sourceType: 'defect',
        plotId: defect.plot_id || 'ไม่ระบุ',
        projectName: projName,
        taskName: defect.description || task?.task_name || 'แจ้งรายการ Defect',
        taskId: defect.task_template_id || defect.task_id,
        userName: defect.reported_by || 'QC / ตรวจรับ',
        userRole: user?.role || defect.role || 'QC',
        actionText: 'แจ้ง Defect / ซ่อมบำรุง',
        detailText: defect.description || '',
        createdAt: defect.created_at,
        imageUrls: parseImages(defect.image_url)
      });
    }

    // Sort newest to oldest
    return items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [allUpdatesRecord, defects, plots, taskTemplates, allUsers, selectedDate]);

  // Load cached audits for visible images on date change (Local Cache + Central Supabase Database)
  useEffect(() => {
    const allUrls: string[] = [];
    const newCached: Record<string, PhotoAuditResult> = {};

    for (const act of dayActivities) {
      for (const url of act.imageUrls) {
        allUrls.push(url);
        if (!auditResults[url]) {
          const cached = getCachedPhotoAudit(url);
          if (cached) {
            newCached[url] = cached;
          }
        }
      }
    }

    if (Object.keys(newCached).length > 0) {
      setAuditResults(prev => ({ ...prev, ...newCached }));
    }

    // Fetch from central database in background for multi-device sync
    if (allUrls.length > 0) {
      fetchBatchPhotoAuditsFromDb(allUrls).then(dbResults => {
        if (dbResults && Object.keys(dbResults).length > 0) {
          setAuditResults(prev => ({ ...prev, ...dbResults }));
        }
      }).catch(() => {});
    }
  }, [dayActivities]);

  // 2. Perform Single Photo Audit
  const handleAuditPhoto = useCallback(async (url: string, activity: ActivityItem, force = false) => {
    if (scanningUrls[url]) return;
    setScanningUrls(prev => ({ ...prev, [url]: true }));

    try {
      const result = await auditPhoto({
        imageUrl: url,
        reportedPlotId: activity.plotId,
        reportedCreatedAt: activity.createdAt,
        forceRescan: force
      });
      setAuditResults(prev => ({ ...prev, [url]: result }));
      if (previewPhoto && previewPhoto.url === url) {
        setPreviewPhoto(prev => prev ? { ...prev, audit: result } : null);
      }
    } catch (err: any) {
      console.error('Audit failed for photo:', url, err);
      setAuditResults(prev => ({
        ...prev,
        [url]: {
          hasWatermark: false,
          scannedAt: new Date().toISOString(),
          error: err.message || 'ไม่สามารถสแกนลายน้ำได้'
        }
      }));
    } finally {
      setScanningUrls(prev => ({ ...prev, [url]: false }));
    }
  }, [scanningUrls, previewPhoto]);

  // 3. Batch Audit All Unscanned Photos for Today
  const handleBatchScanToday = async () => {
    if (isBatchScanning) return;
    const unscanned: { url: string; activity: ActivityItem }[] = [];

    for (const act of dayActivities) {
      for (const url of act.imageUrls) {
        if (!auditResults[url] || !auditResults[url].hasWatermark) {
          unscanned.push({ url, activity: act });
        }
      }
    }

    if (unscanned.length === 0) {
      alert('รูปภาพทั้งหมดในวันนี้ได้รับการสแกนและตรวจสอบเรียบร้อยแล้ว');
      return;
    }

    setIsBatchScanning(true);
    setBatchProgress({ current: 0, total: unscanned.length });

    for (let i = 0; i < unscanned.length; i++) {
      const { url, activity } = unscanned[i];
      setBatchProgress({ current: i + 1, total: unscanned.length });
      await handleAuditPhoto(url, activity, false);
      // Brief pause to stay well within rate limits
      await new Promise(r => setTimeout(r, 600));
    }

    setIsBatchScanning(false);
  };

  // 4. Statistics Calculation
  const stats = useMemo(() => {
    let totalPhotos = 0;
    let onTimeCount = 0;
    let delayedCount = 0;
    let crossDayCount = 0;
    let mismatchPlotCount = 0;
    let unscannedCount = 0;

    for (const act of dayActivities) {
      for (const url of act.imageUrls) {
        totalPhotos++;
        const audit = auditResults[url];
        if (!audit || !audit.audit) {
          unscannedCount++;
          continue;
        }

        const st = audit.audit.status;
        if (st === 'on_time') onTimeCount++;
        else if (st === 'delayed_same_day' || st === 'delayed_late') delayedCount++;
        else if (st === 'cross_day') crossDayCount++;

        if (audit.audit.isPlotMatch === false) {
          mismatchPlotCount++;
        }
      }
    }

    return {
      totalActivities: dayActivities.length,
      totalPhotos,
      onTimeCount,
      delayedCount,
      crossDayCount,
      mismatchPlotCount,
      unscannedCount
    };
  }, [dayActivities, auditResults]);

  // 5. Filter activities
  const filteredActivities = useMemo(() => {
    return dayActivities.filter(act => {
      // Search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const match =
          act.taskName.toLowerCase().includes(q) ||
          act.plotId.toLowerCase().includes(q) ||
          act.userName.toLowerCase().includes(q) ||
          act.detailText.toLowerCase().includes(q) ||
          act.projectName.toLowerCase().includes(q);
        if (!match) return false;
      }

      // Project filter
      if (selectedProjectFilter !== 'ALL' && act.projectName !== selectedProjectFilter) {
        return false;
      }

      // Plot filter
      if (selectedPlotFilter !== 'ALL' && act.plotId !== selectedPlotFilter) {
        return false;
      }

      // User filter
      if (selectedUserFilter !== 'ALL' && act.userName !== selectedUserFilter) {
        return false;
      }

      // Only with photos
      if (onlyWithPhotos && act.imageUrls.length === 0) {
        return false;
      }

      // Status filter
      if (selectedStatusFilter !== 'ALL') {
        if (act.imageUrls.length === 0) return false;
        const matchesStatus = act.imageUrls.some(url => {
          const audit = auditResults[url];
          if (selectedStatusFilter === 'unscanned') {
            return !audit || !audit.audit;
          }
          if (!audit || !audit.audit) return false;

          if (selectedStatusFilter === 'on_time') return audit.audit.status === 'on_time';
          if (selectedStatusFilter === 'delayed') return audit.audit.status === 'delayed_same_day' || audit.audit.status === 'delayed_late';
          if (selectedStatusFilter === 'cross_day') return audit.audit.status === 'cross_day';
          if (selectedStatusFilter === 'mismatch') return audit.audit.isPlotMatch === false;
          return false;
        });
        if (!matchesStatus) return false;
      }

      return true;
    });
  }, [
    dayActivities,
    searchQuery,
    selectedProjectFilter,
    selectedPlotFilter,
    selectedUserFilter,
    selectedStatusFilter,
    onlyWithPhotos,
    auditResults
  ]);

  // Unique options for filters
  const uniqueProjects = useMemo(() => {
    const set = new Set<string>();
    dayActivities.forEach(a => { if (a.projectName) set.add(a.projectName); });
    return Array.from(set);
  }, [dayActivities]);

  const uniquePlots = useMemo(() => {
    const set = new Set<string>();
    dayActivities.forEach(a => { if (a.plotId) set.add(a.plotId); });
    return Array.from(set);
  }, [dayActivities]);

  const uniqueUsers = useMemo(() => {
    const set = new Set<string>();
    dayActivities.forEach(a => { if (a.userName) set.add(a.userName); });
    return Array.from(set);
  }, [dayActivities]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6 animate-in fade-in duration-300">
      {/* 🌟 Header Section 🌟 */}
      <div className="bg-gradient-to-r from-slate-900 via-blue-950 to-slate-900 rounded-3xl p-6 sm:p-8 text-white shadow-xl border border-slate-800">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-blue-500/20 text-blue-300 rounded-full text-xs font-bold border border-blue-500/30">
              <Clock size={14} className="animate-pulse" />
              <span>ระบบตรวจสอบเวลาและลายน้ำภาพถ่ายโฟร์แมน (Time Audit & Watermark OCR)</span>
            </div>
            <h1 className="text-2xl sm:text-3xl lg:text-4xl font-black tracking-tight flex items-center gap-3">
              <span>ดูกิจกรรมประจำวัน</span>
              <span className="text-blue-400 text-lg sm:text-xl font-bold font-mono">
                ({new Date(selectedDate).toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' })})
              </span>
            </h1>
            <p className="text-slate-300 text-xs sm:text-sm max-w-2xl leading-relaxed">
              ติดตามรายงานการทำงานรายวัน เปรียบเทียบเวลาถ่ายจริงจากลายน้ำบนรูปภาพ (Taken At) กับเวลาที่กดส่งรายงาน (Reported At) ป้องกันการถ่ายภาพล่วงหน้าแล้วส่งย้อนหลัง
            </p>
          </div>

          {/* 📅 Date Picker Toolbar */}
          <div className="flex flex-wrap items-center gap-2 bg-slate-800/80 p-2 rounded-2xl border border-slate-700/60 backdrop-blur-md">
            <button
              onClick={handlePrevDay}
              className="p-2 hover:bg-slate-700 rounded-xl transition text-slate-300 hover:text-white"
              title="วันก่อนหน้า"
            >
              <ChevronLeft size={18} />
            </button>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="bg-slate-900 text-white font-bold text-xs sm:text-sm px-3 py-2 rounded-xl border border-slate-700 outline-none focus:border-blue-500 cursor-pointer"
            />
            <button
              onClick={handleNextDay}
              className="p-2 hover:bg-slate-700 rounded-xl transition text-slate-300 hover:text-white"
              title="วันถัดไป"
            >
              <ChevronRight size={18} />
            </button>
            <button
              onClick={handleToday}
              className="px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs rounded-xl shadow transition"
            >
              วันนี้
            </button>
          </div>
        </div>

        {/* 📊 KPI Summary Badges for Selected Date */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mt-6 pt-6 border-t border-slate-800/80">
          <div className="bg-slate-800/60 p-3.5 rounded-2xl border border-slate-700/40">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">กิจกรรมทั้งหมด</span>
            <div className="text-xl sm:text-2xl font-black text-white mt-1">{stats.totalActivities}</div>
            <span className="text-[10px] text-slate-400 font-medium">รายการรายงาน</span>
          </div>

          <div className="bg-slate-800/60 p-3.5 rounded-2xl border border-slate-700/40">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">รูปภาพทั้งหมด</span>
            <div className="text-xl sm:text-2xl font-black text-blue-400 mt-1">{stats.totalPhotos}</div>
            <span className="text-[10px] text-slate-400 font-medium">ภาพไซต์งาน</span>
          </div>

          <div className="bg-emerald-950/40 p-3.5 rounded-2xl border border-emerald-800/50">
            <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider block">🟢 ส่งทันที (≤30น.)</span>
            <div className="text-xl sm:text-2xl font-black text-emerald-300 mt-1">{stats.onTimeCount}</div>
            <span className="text-[10px] text-emerald-400 font-medium">ตรงเวลา</span>
          </div>

          <div className="bg-amber-950/40 p-3.5 rounded-2xl border border-amber-800/50">
            <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wider block">🟡 ส่งช้ากว่าปกติ</span>
            <div className="text-xl sm:text-2xl font-black text-amber-300 mt-1">{stats.delayedCount}</div>
            <span className="text-[10px] text-amber-400 font-medium">ถ่ายล่วงหน้าในวัน</span>
          </div>

          <div className="bg-rose-950/40 p-3.5 rounded-2xl border border-rose-800/50">
            <span className="text-[10px] font-bold text-rose-400 uppercase tracking-wider block">🔴 ถ่ายข้ามวัน</span>
            <div className="text-xl sm:text-2xl font-black text-rose-300 mt-1">{stats.crossDayCount}</div>
            <span className="text-[10px] text-rose-400 font-medium">ถ่ายคนละวัน</span>
          </div>

          <div className="bg-purple-950/40 p-3.5 rounded-2xl border border-purple-800/50">
            <span className="text-[10px] font-bold text-purple-400 uppercase tracking-wider block">⚠️ แปลงไม่ตรงลายน้ำ</span>
            <div className="text-xl sm:text-2xl font-black text-purple-300 mt-1">{stats.mismatchPlotCount}</div>
            <span className="text-[10px] text-purple-400 font-medium">ตรวจสอบแปลง</span>
          </div>
        </div>
      </div>

      {/* 🔀 Mode Switcher: 📋 Timeline Cards vs 🏗️ 3D Colony Sim */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-white p-2 sm:p-2.5 rounded-2xl sm:rounded-3xl border border-slate-200/80 shadow-sm">
        <div className="flex items-center gap-1.5 sm:gap-2">
          <button
            onClick={() => setDailyMode('timeline')}
            className={`flex items-center gap-2 px-3.5 sm:px-5 py-2 sm:py-2.5 rounded-xl sm:rounded-2xl text-xs sm:text-sm font-bold transition-all ${
              dailyMode === 'timeline'
                ? 'bg-slate-900 text-white shadow-md'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <ClipboardList size={16} />
            <span>📋 ไทม์ไลน์ภาพถ่ายและกิจกรรม</span>
          </button>
          <button
            onClick={() => setDailyMode('3d-colony')}
            className={`flex items-center gap-2 px-3.5 sm:px-5 py-2 sm:py-2.5 rounded-xl sm:rounded-2xl text-xs sm:text-sm font-black transition-all ${
              dailyMode === '3d-colony'
                ? 'bg-gradient-to-r from-indigo-600 via-blue-600 to-indigo-700 text-white shadow-lg ring-2 ring-indigo-400'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <span className="text-base">🏗️</span>
            <span>ผังจำลองไซต์งาน 3D (Colony Sim)</span>
            <span className="px-2 py-0.5 rounded-full bg-amber-400 text-slate-950 text-[10px] font-black uppercase tracking-wider animate-pulse">
              Live
            </span>
          </button>
        </div>

        {dailyMode === '3d-colony' && (
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 bg-slate-100 px-3 py-1.5 rounded-xl border border-slate-200">
              <Building size={14} className="text-indigo-600" />
              <span className="text-xs font-bold text-slate-700">ผังโครงการ:</span>
              <select
                value={selected3DProjectName}
                onChange={(e) => setSelected3DProjectName(e.target.value)}
                className="bg-white text-slate-900 font-black text-xs px-2.5 py-1 rounded-lg border border-slate-300 outline-none cursor-pointer shadow-sm"
              >
                {projects.map((pr: any) => (
                  <option key={pr.id || pr.name} value={pr.name}>
                    {pr.name} ({plots.filter((p: any) => p.project_name === pr.name).length} แปลง)
                  </option>
                ))}
              </select>
            </div>
            <div className="text-xs text-slate-500 font-medium hidden md:inline">
              💡 หมุนเมาส์ 360° เพื่อตรวจดูคนทำงานประจำแปลงตามผังที่วางไว้จริง
            </div>
          </div>
        )}
      </div>

      {dailyMode === '3d-colony' ? (
        <div className="w-full">
          <ProjectMap3DColonySim
            selectedProject={active3DProject}
            plots={projectPlots}
            plotBounds={projectPlotBounds}
            mapGrid={actualMapGrid}
            gridCols={actualGridCols}
            gridRows={actualGridRows}
            getPlotOverallStatus={getPlotOverallStatus}
            plotsActiveToday={plotsActiveToday}
            allUpdatesRecord={allUpdatesRecord}
            defects={defects}
            taskTemplates={taskTemplates}
            houseTypes={houseTypes || []}
            selectedDate={selectedDate}
            setSelectedPlot={setSelectedPlot || onSelectPlot}
            setSelectedTask={setSelectedTask}
            setView={setView}
          />
        </div>
      ) : (
        <>
      {/* 🎛️ Filter & Action Bar */}
      <div className="bg-white rounded-3xl p-5 shadow-sm border border-slate-200/80 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          {/* Search Box */}
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input
              type="text"
              placeholder="ค้นหาชื่องาน, แปลง, ชื่อโฟร์แมน, รายละเอียด..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-2xl text-xs sm:text-sm font-medium text-slate-800 outline-none focus:border-blue-500 focus:bg-white transition"
            />
          </div>

          {/* Quick Filter dropdowns */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Project Select */}
            <select
              value={selectedProjectFilter}
              onChange={(e) => setSelectedProjectFilter(e.target.value)}
              className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 outline-none focus:border-blue-500"
            >
              <option value="ALL">🏢 ทุกโครงการ</option>
              {uniqueProjects.map(p => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>

            {/* Plot Select */}
            <select
              value={selectedPlotFilter}
              onChange={(e) => setSelectedPlotFilter(e.target.value)}
              className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 outline-none focus:border-blue-500"
            >
              <option value="ALL">📍 ทุกแปลง</option>
              {uniquePlots.map(pl => (
                <option key={pl} value={pl}>แปลง {pl}</option>
              ))}
            </select>

            {/* User Select */}
            <select
              value={selectedUserFilter}
              onChange={(e) => setSelectedUserFilter(e.target.value)}
              className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 outline-none focus:border-blue-500"
            >
              <option value="ALL">👤 ผู้รายงานทั้งหมด</option>
              {uniqueUsers.map(u => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>

            {/* Time Status Filter */}
            <select
              value={selectedStatusFilter}
              onChange={(e) => setSelectedStatusFilter(e.target.value as any)}
              className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 outline-none focus:border-blue-500"
            >
              <option value="ALL">⏱️ ทุกสถานะเวลา</option>
              <option value="on_time">🟢 ส่งตรงเวลา (≤30น.)</option>
              <option value="delayed">🟡 ส่งช้ากว่าปกติ</option>
              <option value="cross_day">🔴 ถ่ายข้ามวัน</option>
              <option value="mismatch">⚠️ แปลงไม่ตรงกับลายน้ำ</option>
              <option value="unscanned">⚪ ยังไม่ได้สแกน</option>
            </select>

            {/* Photos Only toggle */}
            <label className="flex items-center gap-1.5 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 cursor-pointer hover:bg-slate-100 transition select-none">
              <input
                type="checkbox"
                checked={onlyWithPhotos}
                onChange={(e) => setOnlyWithPhotos(e.target.checked)}
                className="rounded text-blue-600 focus:ring-blue-500"
              />
              <span>📸 เฉพาะที่มีรูป</span>
            </label>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleBatchScanToday}
              disabled={isBatchScanning || stats.totalPhotos === 0}
              className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-2xl text-xs font-bold shadow-md shadow-blue-500/20 disabled:opacity-50 transition"
              title="สแกนอ่านลายน้ำ AI ทุกรูปในวันที่เลือกนี้"
            >
              {isBatchScanning ? (
                <>
                  <RefreshCw size={14} className="animate-spin" />
                  <span>กำลังสแกน ({batchProgress.current}/{batchProgress.total})</span>
                </>
              ) : (
                <>
                  <Sparkles size={14} />
                  <span>สแกนลายน้ำทุกรูป ({stats.unscannedCount})</span>
                </>
              )}
            </button>

            <button
              onClick={() => window.print()}
              className="p-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 hover:text-slate-900 rounded-2xl transition"
              title="พิมพ์รายงานประจำวัน (Print)"
            >
              <Printer size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* 📜 Activities Feed List */}
      <div className="space-y-4">
        {filteredActivities.length === 0 ? (
          <div className="bg-white rounded-3xl border border-dashed border-slate-300 p-12 text-center text-slate-400 font-bold space-y-2">
            <Clock size={40} className="mx-auto text-slate-300 mb-2" />
            <p className="text-base text-slate-600 font-bold">ไม่มีกิจกรรมการรายงานสำหรับเงื่อนไขที่เลือก</p>
            <p className="text-xs text-slate-400">ลองเปลี่ยนวันที่หรือปรับเปลี่ยนตัวกรองค้นหา</p>
          </div>
        ) : (
          filteredActivities.map((activity) => {
            const hasPhotos = activity.imageUrls.length > 0;

            return (
              <div
                key={activity.id}
                className="bg-white rounded-3xl border border-slate-200/80 shadow-sm hover:shadow-md transition-all overflow-hidden"
              >
                {/* Header bar of activity card */}
                <div className="px-5 py-3.5 bg-slate-800 text-white flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="bg-blue-600 text-white font-black text-[10px] px-2.5 py-1 rounded-xl shadow-sm">
                      🏢 {activity.projectName}
                    </span>
                    <button
                      onClick={() => onSelectPlot && onSelectPlot({ id: activity.plotId })}
                      className="bg-amber-400 hover:bg-amber-300 text-slate-900 font-black text-[10px] px-2.5 py-1 rounded-xl shadow-sm transition"
                    >
                      📍 แปลง {activity.plotId}
                    </button>
                    {activity.sourceType === 'defect' ? (
                      <span className="bg-rose-500 text-white font-bold text-[10px] px-2 py-0.5 rounded-lg flex items-center gap-1">
                        <ShieldAlert size={12} /> รายการ Defect
                      </span>
                    ) : null}
                    <h3 className="font-black text-sm text-white truncate max-w-[300px]">
                      {activity.taskName}
                    </h3>
                  </div>

                  <div className="flex items-center gap-2 text-xs text-slate-300">
                    <span className="bg-slate-700/80 px-2.5 py-1 rounded-lg text-[10px] font-bold">
                      {activity.actionText}
                    </span>
                  </div>
                </div>

                {/* Body Content */}
                <div className="p-5 space-y-4">
                  {/* User info & Timestamp */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white font-black flex items-center justify-center text-sm shadow-sm">
                        {activity.userName.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm text-slate-900">{activity.userName}</span>
                          <span className="text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                            {activity.userRole}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400 font-medium flex items-center gap-1 mt-0.5">
                          <Clock size={12} />
                          <span>ส่งรายงานเมื่อ:</span>
                          <span className="font-bold text-slate-600">
                            {new Date(activity.createdAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' })} น.
                          </span>
                          <span>• {new Date(activity.createdAt).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                        </p>
                      </div>
                    </div>

                    {activity.weatherInfo && (
                      <div className="text-[11px] font-bold text-sky-700 bg-sky-50 border border-sky-100 px-3 py-1 rounded-xl w-fit">
                        ⛅ {activity.weatherInfo}
                      </div>
                    )}
                  </div>

                  {/* Notes / Detail */}
                  {activity.detailText && (
                    <p className="text-xs sm:text-sm text-slate-700 bg-slate-50/70 p-3 rounded-2xl border border-slate-100 leading-relaxed font-medium">
                      "{activity.detailText}"
                    </p>
                  )}

                  {/* Photos Grid with Watermark Audit Overlay */}
                  {hasPhotos && (
                    <div className="space-y-2 pt-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                          <Camera size={14} className="text-blue-600" />
                          <span>รูปถ่ายรายงาน ({activity.imageUrls.length} รูป)</span>
                        </span>
                        <span className="text-[10px] text-slate-400 font-medium">
                          คลิกรูปเพื่อดูภาพขยายและผลการตรวจสอบลายน้ำแบบละเอียด
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {activity.imageUrls.map((url, idx) => {
                          const audit = auditResults[url];
                          const isScanning = scanningUrls[url];

                          return (
                            <div
                              key={idx}
                              className="group relative bg-slate-900 rounded-2xl overflow-hidden border border-slate-200 shadow-sm flex flex-col"
                            >
                              {/* Photo thumbnail */}
                              <div className="relative aspect-[4/3] bg-slate-950 overflow-hidden">
                                <img
                                  src={url}
                                  alt={`Report photo ${idx + 1}`}
                                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300 cursor-pointer"
                                  onClick={() => setPreviewPhoto({ url, activity, audit })}
                                />
                                <button
                                  onClick={() => setPreviewPhoto({ url, activity, audit })}
                                  className="absolute top-2 right-2 p-1.5 bg-black/60 hover:bg-black text-white rounded-xl backdrop-blur-sm transition"
                                  title="ดูรูปภาพขนาดเต็ม"
                                >
                                  <Maximize2 size={14} />
                                </button>
                              </div>

                              {/* Watermark Audit Card below photo */}
                              <div className="p-3 bg-white border-t border-slate-100 space-y-2 text-xs">
                                {isScanning ? (
                                  <div className="flex items-center justify-center gap-2 py-2 text-blue-600 font-bold text-xs">
                                    <RefreshCw size={14} className="animate-spin" />
                                    <span>กำลังอ่านลายน้ำ AI...</span>
                                  </div>
                                ) : audit?.audit ? (
                                  <div className="space-y-1.5">
                                    {/* Status Badge */}
                                    <div className="flex items-center justify-between gap-1">
                                      <span className={`text-[10px] font-black px-2 py-0.5 rounded-lg border ${audit.audit.statusBadgeColor}`}>
                                        {audit.audit.statusLabel}
                                      </span>
                                      <button
                                        onClick={() => handleAuditPhoto(url, activity, true)}
                                        className="text-[9px] text-slate-400 hover:text-blue-600 font-bold underline transition"
                                        title="สแกนลายน้ำซ้ำ"
                                      >
                                        สแกนซ้ำ
                                      </button>
                                    </div>

                                    {/* Capture vs Upload time comparison */}
                                    <div className="text-[11px] space-y-0.5 bg-slate-50 p-2 rounded-xl border border-slate-100">
                                      <div className="flex justify-between items-center text-slate-600">
                                        <span className="font-medium">🕒 เวลาถ่ายจริง:</span>
                                        <span className="font-bold text-slate-900 font-mono">
                                          {audit.takenTimeStr || (audit.takenAt ? new Date(audit.takenAt).toLocaleTimeString('th-TH') : '-')}
                                        </span>
                                      </div>
                                      <div className="flex justify-between items-center text-slate-600">
                                        <span className="font-medium">📤 เวลาส่งรายงาน:</span>
                                        <span className="font-bold text-slate-900 font-mono">
                                          {new Date(activity.createdAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.
                                        </span>
                                      </div>
                                      <div className="flex justify-between items-center pt-1 border-t border-slate-200/60 font-bold">
                                        <span className="text-slate-500">⏳ ผลต่างเวลา:</span>
                                        <span className={audit.audit.status === 'on_time' ? 'text-emerald-600' : 'text-amber-600'}>
                                          {audit.audit.timeDiffText}
                                        </span>
                                      </div>
                                    </div>

                                    {/* Plot & Location tags */}
                                    <div className="text-[10px] text-slate-500 space-y-0.5 pt-0.5">
                                      {audit.plotTag && (
                                        <div className="flex items-center justify-between">
                                          <span className="font-medium">🏷️ แปลงในรูป:</span>
                                          <span className={`font-bold ${audit.audit.isPlotMatch === false ? 'text-rose-600' : 'text-emerald-700'}`}>
                                            {audit.audit.plotMatchLabel}
                                          </span>
                                        </div>
                                      )}
                                      {audit.location && (
                                        <div className="truncate text-slate-400" title={audit.location}>
                                          📍 {audit.location}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                ) : audit?.error ? (
                                  <div className="text-[10px] text-rose-600 bg-rose-50 p-2 rounded-xl border border-rose-100 flex items-center justify-between">
                                    <span>⚠️ {audit.error}</span>
                                    <button
                                      onClick={() => handleAuditPhoto(url, activity, true)}
                                      className="font-bold underline text-rose-700"
                                    >
                                      ลองใหม่
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    onClick={() => handleAuditPhoto(url, activity, false)}
                                    className="w-full flex items-center justify-center gap-1.5 py-2 bg-slate-100 hover:bg-blue-50 text-slate-700 hover:text-blue-700 font-bold text-xs rounded-xl border border-slate-200 transition"
                                  >
                                    <Scan size={14} className="text-blue-600" />
                                    <span>สแกนลายน้ำ & ตรวจสอบเวลา</span>
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
        </>
      )}

      {/* 🖼️ Fullscreen Photo Preview & Deep Watermark Inspector Modal */}
      {previewPhoto && (
        <div className="fixed inset-0 z-[1000] bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-5xl w-full max-h-[95vh] flex flex-col overflow-hidden text-white shadow-2xl animate-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="p-4 sm:p-5 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="font-black text-base sm:text-lg flex items-center gap-2">
                  <span>ตรวจลายน้ำรูปภาพ: แปลง {previewPhoto.activity.plotId}</span>
                  <span className="text-xs text-slate-400 font-normal">({previewPhoto.activity.taskName})</span>
                </h3>
                <p className="text-xs text-slate-400 font-medium mt-0.5">
                  รายงานโดย: {previewPhoto.activity.userName} ({previewPhoto.activity.userRole}) • {new Date(previewPhoto.activity.createdAt).toLocaleString('th-TH')}
                </p>
              </div>
              <button
                onClick={() => setPreviewPhoto(null)}
                className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-2xl transition"
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Body: Image on left, Watermark OCR details on right */}
            <div className="flex-1 overflow-y-auto grid grid-cols-1 lg:grid-cols-3 gap-6 p-4 sm:p-6 bg-slate-950/60">
              {/* Image viewer */}
              <div className="lg:col-span-2 flex items-center justify-center bg-black/60 rounded-2xl overflow-hidden border border-slate-800/80 p-2">
                <img
                  src={previewPhoto.url}
                  alt="Full preview"
                  className="max-h-[65vh] w-auto object-contain rounded-xl"
                />
              </div>

              {/* Watermark Details Sidebar */}
              <div className="space-y-4">
                <div className="bg-slate-900 p-4 rounded-2xl border border-slate-800 space-y-3">
                  <h4 className="font-bold text-sm text-blue-400 uppercase tracking-wider flex items-center gap-2">
                    <Sparkles size={16} /> ผลการสแกนลายน้ำ (OCR)
                  </h4>

                  {scanningUrls[previewPhoto.url] ? (
                    <div className="text-center py-8 text-blue-400 font-bold space-y-2">
                      <RefreshCw size={24} className="animate-spin mx-auto" />
                      <p className="text-xs">กำลังวิเคราะห์ภาพถ่าย...</p>
                    </div>
                  ) : previewPhoto.audit?.audit ? (
                    <div className="space-y-3 text-xs">
                      {/* Status */}
                      <div>
                        <span className="text-[10px] text-slate-400 font-bold block mb-1">ผลการประเมินเวลา:</span>
                        <div className={`p-2.5 rounded-xl border font-bold ${previewPhoto.audit.audit.statusBadgeColor}`}>
                          {previewPhoto.audit.audit.statusLabel}
                        </div>
                      </div>

                      {/* Time Comparison */}
                      <div className="bg-slate-800/80 p-3 rounded-xl border border-slate-700/60 space-y-2">
                        <div className="flex justify-between items-center">
                          <span className="text-slate-400">🕒 วันเวลาถ่ายจริง:</span>
                          <span className="font-mono font-bold text-white">
                            {previewPhoto.audit.takenDateStr} {previewPhoto.audit.takenTimeStr}
                          </span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-slate-400">📤 เวลาส่งรายงาน:</span>
                          <span className="font-mono font-bold text-white">
                            {new Date(previewPhoto.activity.createdAt).toLocaleTimeString('th-TH')} น.
                          </span>
                        </div>
                        <div className="flex justify-between items-center pt-2 border-t border-slate-700 font-bold">
                          <span className="text-slate-300">⏳ ผลต่าง:</span>
                          <span className={previewPhoto.audit.audit.status === 'on_time' ? 'text-emerald-400' : 'text-amber-400'}>
                            {previewPhoto.audit.audit.timeDiffText}
                          </span>
                        </div>
                      </div>

                      {/* Plot Verification */}
                      <div className="bg-slate-800/80 p-3 rounded-xl border border-slate-700/60 space-y-1.5">
                        <span className="text-slate-400 text-[10px] block font-bold">การตรวจสอบแปลงบ้าน:</span>
                        <div className="flex justify-between items-center">
                          <span className="text-slate-400">แปลงในรายงาน:</span>
                          <span className="font-bold text-white">แปลง {previewPhoto.activity.plotId}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-slate-400">แปลงในลายน้ำ:</span>
                          <span className="font-bold text-white">{previewPhoto.audit.plotTag || 'ไม่พบในลายน้ำ'}</span>
                        </div>
                        <div className={`text-[11px] font-bold pt-1 ${previewPhoto.audit.audit.isPlotMatch === false ? 'text-rose-400' : 'text-emerald-400'}`}>
                          {previewPhoto.audit.audit.plotMatchLabel}
                        </div>
                      </div>

                      {/* Location text */}
                      {previewPhoto.audit.location && (
                        <div className="bg-slate-800/80 p-3 rounded-xl border border-slate-700/60">
                          <span className="text-slate-400 text-[10px] block font-bold">📍 พิกัดสถานที่ในลายน้ำ:</span>
                          <p className="text-slate-200 font-medium mt-0.5">{previewPhoto.audit.location}</p>
                        </div>
                      )}

                      {/* Raw watermark text */}
                      {previewPhoto.audit.rawWatermarkText && (
                        <div className="bg-slate-800/80 p-3 rounded-xl border border-slate-700/60">
                          <span className="text-slate-400 text-[10px] block font-bold">ข้อความลายน้ำดิบ (Raw Text):</span>
                          <p className="text-slate-300 font-mono text-[10px] whitespace-pre-line mt-1 bg-black/40 p-2 rounded-lg">
                            {previewPhoto.audit.rawWatermarkText}
                          </p>
                        </div>
                      )}

                      <button
                        onClick={() => handleAuditPhoto(previewPhoto.url, previewPhoto.activity, true)}
                        className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-xl border border-slate-700 transition"
                      >
                        🔄 สแกนลายน้ำใหม่อีกครั้ง
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3 py-4 text-center">
                      <p className="text-xs text-slate-400">รูปภาพนี้ยังไม่ได้ทำการสแกนลายน้ำ</p>
                      <button
                        onClick={() => handleAuditPhoto(previewPhoto.url, previewPhoto.activity, false)}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs rounded-xl shadow transition"
                      >
                        สแกนลายน้ำตอนนี้
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-800 bg-slate-900 flex justify-end">
              <button
                onClick={() => setPreviewPhoto(null)}
                className="px-5 py-2 bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs rounded-xl transition"
              >
                ปิดหน้าต่าง
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DailySiteActivitiesView;
