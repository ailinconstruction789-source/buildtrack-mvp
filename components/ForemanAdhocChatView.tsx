'use client';

import React, { useState, useMemo, useRef, useCallback } from 'react';
import {
  MessageSquare,
  MessageSquareText,
  Send,
  Camera,
  Image as ImageIcon,
  Tag,
  Filter,
  Search,
  Calendar,
  User,
  Building2,
  Home,
  CheckCircle2,
  Clock,
  Sparkles,
  Trash2,
  Plus,
  RefreshCw,
  AlertCircle,
  X,
  ChevronDown,
  Maximize2,
  Layers,
  Flame,
  Check,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { normalizeDateStr } from '@/lib/foremanDuty';

export const ADHOC_TAGS = [
  { id: 'material', label: 'รับส่งวัสดุ', icon: '📦', color: 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100' },
  { id: 'cleanup', label: 'เคลียร์พื้นที่', icon: '🧹', color: 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100' },
  { id: 'urgent', label: 'งานเร่งด่วน', icon: '⚡', color: 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100' },
  { id: 'owner_request', label: 'คำสั่งพิเศษ', icon: '📋', color: 'bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100' },
  { id: 'obstacle', label: 'อุปสรรคไซต์', icon: '🌧️', color: 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100' },
  { id: 'general', label: 'งานเสริมทั่วไป', icon: '🛠️', color: 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100' },
] as const;

export interface AdhocReportItem {
  id: string;
  plot_id: string | null;
  plot_name: string;
  project_name: string;
  user_name: string;
  role: string;
  action: string;
  text_content: string;
  tag: string;
  clean_text: string;
  image_urls: string[];
  created_at: string;
  timestamp: number;
  dateStr: string;
  timeStr: string;
}

interface ForemanAdhocChatViewProps {
  plots: any[];
  projects: any[];
  allUpdatesRecord?: any[];
  loggedInUser?: any;
  currentUserRole?: string;
  isAdmin?: boolean;
  isOwner?: boolean;
  isSiteEngineer?: boolean;
  isProjectPlanner?: boolean;
  isForeman?: boolean;
  foremenList?: any[];
  selectedProject?: string;
  selectedForeman?: string;
  onPreviewImage?: (url: string) => void;
  fetchAllData?: () => Promise<void>;
}

// Compress image helper using canvas
const compressImage = (file: File): Promise<File> => {
  return new Promise((resolve) => {
    const isImage = file.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|heic|heif)$/i.test(file.name);
    if (!isImage) return resolve(file);

    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.src = objectUrl;

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(file);
    };

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return resolve(file);

      const MAX_WIDTH = 1280;
      const MAX_HEIGHT = 1280;
      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > MAX_WIDTH) {
          height *= MAX_WIDTH / width;
          width = MAX_WIDTH;
        }
      } else {
        if (height > MAX_HEIGHT) {
          width *= MAX_HEIGHT / height;
          height = MAX_HEIGHT;
        }
      }
      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob((blob) => {
        if (blob) {
          const outputName = file.name.replace(/\.(heic|heif|png|webp)$/i, '.jpg');
          const compressed = new File([blob], outputName, { type: 'image/jpeg', lastModified: Date.now() });
          resolve(compressed);
        } else {
          resolve(file);
        }
      }, 'image/jpeg', 0.82);
    };
  });
};

export default function ForemanAdhocChatView({
  plots = [],
  projects = [],
  allUpdatesRecord = [],
  loggedInUser,
  currentUserRole = '',
  isAdmin = false,
  isOwner = false,
  isSiteEngineer = false,
  isProjectPlanner = false,
  isForeman = false,
  foremenList = [],
  selectedProject: initialProject = 'all',
  selectedForeman: initialForeman = 'all',
  onPreviewImage,
  fetchAllData,
}: ForemanAdhocChatViewProps) {
  // Current user's identity
  const currentUserName = useMemo(() => {
    return (loggedInUser?.username || loggedInUser?.name || 'โฟร์แมน').trim();
  }, [loggedInUser]);

  const userRoleDisplay = useMemo(() => {
    const role = (currentUserRole || loggedInUser?.role || 'Foreman').toUpperCase();
    if (role === 'FOREMAN') return 'โฟร์แมน';
    if (role === 'OWNER') return 'เจ้าของโครงการ (Owner)';
    if (role === 'ADMIN' || role === 'PROJECT_ENGINEER' || role === 'PE') return 'ผู้จัดการ / Admin';
    if (role === 'SITE_ENGINEER' || role === 'SE') return 'วิศวกรสนาม (SE)';
    if (role === 'PROJECT_PLANNER') return 'แพลนเนอร์';
    return currentUserRole || 'ทีมงาน';
  }, [currentUserRole, loggedInUser]);

  // Map plots by ID for fast lookup
  const plotsMap = useMemo(() => {
    const map = new Map<string, any>();
    plots.forEach(p => {
      if (p.id) map.set(String(p.id), p);
    });
    return map;
  }, [plots]);

  // Form State
  const [formProject, setFormProject] = useState<string>(() => {
    if (initialProject && initialProject !== 'all') return initialProject;
    if (projects.length > 0) {
      const first = projects[0];
      return first.name || first.project_name || '';
    }
    return '';
  });

  const [formPlotId, setFormPlotId] = useState<string>('all');
  const [selectedTag, setSelectedTag] = useState<string>('material');
  const [reportText, setReportText] = useState<string>('');
  const [attachedFiles, setAttachedFiles] = useState<{ file: File; previewUrl: string }[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // Filter State
  const [filterProject, setFilterProject] = useState<string>(initialProject || 'all');
  const [filterForeman, setFilterForeman] = useState<string>(initialForeman || 'all');
  const [filterTag, setFilterTag] = useState<string>('all');
  const [filterDateRange, setFilterDateRange] = useState<'all' | 'today' | 'week' | 'month'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Local optimistic records
  const [localOptimisticUpdates, setLocalOptimisticUpdates] = useState<any[]>([]);

  // Plots available for selected form project
  const availableFormPlots = useMemo(() => {
    if (!formProject || formProject === 'all') return plots;
    return plots.filter(p => p.project_name === formProject);
  }, [plots, formProject]);

  // Combined updates (Optimistic + allUpdatesRecord)
  const allParsedReports = useMemo<AdhocReportItem[]>(() => {
    const combined = [...localOptimisticUpdates, ...allUpdatesRecord];
    const seenIds = new Set<string>();
    const list: AdhocReportItem[] = [];

    for (const upd of combined) {
      if (!upd || !upd.id) continue;
      if (seenIds.has(upd.id)) continue;

      const isAdhoc =
        upd.action === 'รายงานนอกแผน' ||
        upd.action === 'ADHOC_REPORT' ||
        upd.action === 'รายงานนอกแผน (Chat)' ||
        (!upd.task_template_id && (
          upd.action?.includes('นอกแผน') ||
          upd.action?.includes('ADHOC') ||
          upd.action?.includes('แชท') ||
          upd.action === 'อัปเดตหน้างานพิเศษ'
        ));

      if (!isAdhoc) continue;
      seenIds.add(upd.id);

      // Parse plot & project
      const plot = upd.plot_id ? plotsMap.get(String(upd.plot_id)) : null;
      const plotName = plot?.plot_name || plot?.name || (upd.plot_id ? `แปลง ${upd.plot_id}` : 'พื้นที่ส่วนกลาง / ทั่วไป');
      const projectName = plot?.project_name || upd.project_name || 'ไม่ระบุโครงการ';

      // Parse tag and clean text
      const rawText = (upd.text_content || '').trim();
      let tag = 'งานเสริมทั่วไป';
      let cleanText = rawText;

      const tagMatch = rawText.match(/^\[(.*?)\]\s*([\s\S]*)$/);
      if (tagMatch) {
        tag = tagMatch[1];
        cleanText = tagMatch[2];
      }

      // Parse images
      let imageUrls: string[] = [];
      if (upd.image_url) {
        if (typeof upd.image_url === 'string') {
          imageUrls = upd.image_url.split(',').map((u: string) => u.trim()).filter(Boolean);
        } else if (Array.isArray(upd.image_url)) {
          imageUrls = upd.image_url.filter(Boolean);
        }
      }

      // Format date & time
      const date = upd.created_at ? new Date(upd.created_at) : new Date();
      const timestamp = date.getTime();
      const dateStr = normalizeDateStr(upd.created_at) || todayStr;
      const timeStr = date.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });

      list.push({
        id: upd.id,
        plot_id: upd.plot_id || null,
        plot_name: plotName,
        project_name: projectName,
        user_name: upd.user_name || 'ไม่ระบุชื่อ',
        role: upd.role || 'Foreman',
        action: upd.action || 'รายงานนอกแผน',
        text_content: rawText,
        tag,
        clean_text: cleanText,
        image_urls: imageUrls,
        created_at: upd.created_at || date.toISOString(),
        timestamp,
        dateStr,
        timeStr,
      });
    }

    // Sort descending by created_at timestamp
    list.sort((a, b) => b.timestamp - a.timestamp);
    return list;
  }, [localOptimisticUpdates, allUpdatesRecord, plotsMap]);

  // Today string YYYY-MM-DD
  const todayStr = useMemo(() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }, []);

  // Filtered reports
  const filteredReports = useMemo(() => {
    return allParsedReports.filter(item => {
      // Project filter
      if (filterProject !== 'all' && item.project_name !== filterProject) {
        return false;
      }
      // Foreman filter
      if (filterForeman !== 'all' && item.user_name !== filterForeman) {
        return false;
      }
      // Tag filter
      if (filterTag !== 'all' && item.tag !== filterTag) {
        return false;
      }
      // Date range filter
      if (filterDateRange === 'today') {
        if (item.dateStr !== todayStr) return false;
      } else if (filterDateRange === 'week') {
        const itemDate = new Date(item.created_at).getTime();
        const now = Date.now();
        if (now - itemDate > 7 * 86400000) return false;
      } else if (filterDateRange === 'month') {
        const itemDate = new Date(item.created_at).getTime();
        const now = Date.now();
        if (now - itemDate > 30 * 86400000) return false;
      }
      // Search query
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchText = item.text_content.toLowerCase().includes(query);
        const matchPlot = item.plot_name.toLowerCase().includes(query);
        const matchUser = item.user_name.toLowerCase().includes(query);
        const matchProject = item.project_name.toLowerCase().includes(query);
        if (!matchText && !matchPlot && !matchUser && !matchProject) return false;
      }
      return true;
    });
  }, [allParsedReports, filterProject, filterForeman, filterTag, filterDateRange, searchQuery, todayStr]);

  // Grouped reports by Date for sleek chat timeline
  const groupedReports = useMemo(() => {
    const groups: { dateTitle: string; items: AdhocReportItem[] }[] = [];
    const dateMap = new Map<string, AdhocReportItem[]>();

    for (const item of filteredReports) {
      const d = item.dateStr;
      if (!dateMap.has(d)) {
        dateMap.set(d, []);
      }
      dateMap.get(d)!.push(item);
    }

    const sortedDates = Array.from(dateMap.keys()).sort((a, b) => b.localeCompare(a));
    for (const d of sortedDates) {
      let title = d;
      try {
        const parsed = new Date(d);
        if (d === todayStr) {
          title = `วันนี้ • ${parsed.toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' })}`;
        } else {
          title = parsed.toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
        }
      } catch (e) {
        title = d;
      }
      groups.push({
        dateTitle: title,
        items: dateMap.get(d) || [],
      });
    }

    return groups;
  }, [filteredReports, todayStr]);

  // KPI Metrics
  const metrics = useMemo(() => {
    const totalCount = allParsedReports.length;
    const todayCount = allParsedReports.filter(r => r.dateStr === todayStr).length;
    const withPhotoCount = allParsedReports.filter(r => r.image_urls.length > 0).length;
    const uniqueForemen = new Set(allParsedReports.map(r => r.user_name)).size;

    return { totalCount, todayCount, withPhotoCount, uniqueForemen };
  }, [allParsedReports, todayStr]);

  // Handle Image Selection
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newFiles: { file: File; previewUrl: string }[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const compressed = await compressImage(file);
      newFiles.push({
        file: compressed,
        previewUrl: URL.createObjectURL(compressed),
      });
    }

    setAttachedFiles(prev => [...prev, ...newFiles].slice(0, 5));
    // Clear input
    e.target.value = '';
  };

  const removeAttachedFile = (index: number) => {
    setAttachedFiles(prev => {
      const updated = [...prev];
      URL.revokeObjectURL(updated[index].previewUrl);
      updated.splice(index, 1);
      return updated;
    });
  };

  // Handle Submit New Report
  const handleSubmitReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reportText.trim() && attachedFiles.length === 0) {
      setSubmitError('กรุณากรอกข้อความรายงานหรือแนบรูปภาพก่อนส่ง');
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      // 1. Upload photos if any
      const uploadedUrls: string[] = [];
      const targetPlotId = formPlotId !== 'all' ? formPlotId : null;
      const safePlotFolder = targetPlotId ? String(targetPlotId).replace(/[^a-zA-Z0-9-]/g, '') : 'general';

      for (const item of attachedFiles) {
        const fileExt = item.file.name.split('.').pop() || 'jpg';
        const fileName = `adhoc/${safePlotFolder}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${fileExt}`;

        const { error: uploadError } = await supabase.storage
          .from('task_images')
          .upload(fileName, item.file, { upsert: true });

        if (!uploadError) {
          const { data: publicUrlData } = supabase.storage
            .from('task_images')
            .getPublicUrl(fileName);
          if (publicUrlData?.publicUrl) {
            uploadedUrls.push(publicUrlData.publicUrl);
          }
        } else {
          console.warn('Storage upload note:', uploadError.message);
        }
      }

      // 2. Prepare payload
      const currentTagObj = ADHOC_TAGS.find(t => t.id === selectedTag);
      const tagLabel = currentTagObj ? currentTagObj.label : 'งานเสริมทั่วไป';
      const fullText = `[${tagLabel}] ${reportText.trim()}`;
      const nowIso = new Date().toISOString();

      const insertPayload = {
        plot_id: targetPlotId,
        task_template_id: null,
        user_name: currentUserName,
        role: currentUserRole || loggedInUser?.role || 'Foreman',
        action: 'รายงานนอกแผน',
        text_content: fullText,
        image_url: uploadedUrls.length > 0 ? uploadedUrls.join(',') : null,
        progress: 0,
        is_defect: false,
        is_silent: false,
        created_at: nowIso,
      };

      // 3. Optimistic update
      const tempId = `temp-${Date.now()}`;
      const optimisticRow = {
        ...insertPayload,
        id: tempId,
      };
      setLocalOptimisticUpdates(prev => [optimisticRow, ...prev]);

      // 4. Save to Supabase
      const { data, error } = await supabase
        .from('task_updates')
        .insert([insertPayload])
        .select();

      if (error) {
        throw error;
      }

      // Replace temp row with real row
      if (data && data[0]) {
        setLocalOptimisticUpdates(prev => prev.map(row => (row.id === tempId ? data[0] : row)));
      }

      // 5. Reset form
      setReportText('');
      setAttachedFiles([]);
      setSubmitSuccess(true);
      setTimeout(() => setSubmitSuccess(false), 3000);

      // 6. Refresh data in background
      if (fetchAllData) {
        fetchAllData().catch(err => console.warn('Background refresh error:', err));
      }
    } catch (err: any) {
      console.error('Failed to submit ad-hoc report:', err);
      setSubmitError(err?.message || 'เกิดข้อผิดพลาดในการบันทึกรายงาน กรุณาลองใหม่อีกครั้ง');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Delete report
  const handleDeleteReport = async (reportId: string) => {
    if (!window.confirm('คุณแน่ใจหรือไม่ว่าต้องการลบรายงานนี้?')) return;

    try {
      setLocalOptimisticUpdates(prev => prev.filter(r => r.id !== reportId));
      const { error } = await supabase.from('task_updates').delete().eq('id', reportId);
      if (error) throw error;
      if (fetchAllData) {
        fetchAllData().catch(() => {});
      }
    } catch (err: any) {
      alert('ไม่สามารถลบรายงานได้: ' + (err?.message || 'เกิดข้อผิดพลาด'));
    }
  };

  // Avatar helper
  const getRoleBadge = (role: string) => {
    const r = (role || '').toUpperCase();
    if (r.includes('FOREMAN')) {
      return { label: 'โฟร์แมน', bg: 'bg-blue-100 text-blue-700 border-blue-200' };
    }
    if (r.includes('OWNER')) {
      return { label: 'Owner', bg: 'bg-amber-100 text-amber-800 border-amber-300' };
    }
    if (r.includes('ENGINEER') || r === 'SE' || r === 'PE') {
      return { label: 'วิศวกร', bg: 'bg-indigo-100 text-indigo-700 border-indigo-200' };
    }
    if (r.includes('PLANNER')) {
      return { label: 'แพลนเนอร์', bg: 'bg-purple-100 text-purple-700 border-purple-200' };
    }
    return { label: role || 'ทีมงาน', bg: 'bg-slate-100 text-slate-700 border-slate-200' };
  };

  const getTagBadge = (tag: string) => {
    const found = ADHOC_TAGS.find(t => t.label === tag);
    if (found) {
      return { label: found.label, icon: found.icon, color: found.color };
    }
    return { label: tag, icon: '🏷️', color: 'bg-slate-50 text-slate-700 border-slate-200' };
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* 🌟 Top Header & Overview Banner */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-teal-900 via-slate-900 to-emerald-950 p-6 sm:p-8 text-white shadow-xl border border-teal-500/20">
        <div className="absolute -right-16 -top-16 h-64 w-64 rounded-full bg-teal-500/10 blur-3xl pointer-events-none" />
        <div className="absolute -left-16 -bottom-16 h-64 w-64 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-teal-500/20 border border-teal-400/30 text-teal-300 text-xs font-black uppercase tracking-wider">
              <MessageSquareText size={14} />
              <span>Site Ad-hoc Daily Feed</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-white flex items-center gap-3">
              <span>รายงานงานนอกแผน & บันทึกหน้างาน</span>
              <span className="text-xs px-2.5 py-1 rounded-xl bg-teal-500/20 text-teal-300 font-bold border border-teal-400/30">
                Live Chat
              </span>
            </h2>
            <p className="text-sm text-slate-300 max-w-2xl leading-relaxed">
              ช่องทางสำหรับโฟร์แมนและทีมงาน รายงานความคืบหน้างานเสริม, ขนส่งวัสดุ, เคลียร์พื้นที่, งานเร่งด่วน หรือบันทึกพิเศษนอกเหนือจากรายการที่กำหนดในแผนงาน พร้อมแนบรูปถ่ายตรวจสอบได้ทันที
            </p>
          </div>

          {/* User Badge */}
          <div className="flex items-center gap-3 bg-white/10 backdrop-blur-md px-4 py-3 rounded-2xl border border-white/10 shrink-0">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-teal-500 to-emerald-400 flex items-center justify-center font-black text-white text-base shadow-sm">
              {currentUserName.charAt(0).toUpperCase()}
            </div>
            <div>
              <div className="text-xs text-slate-400 font-bold">ผู้รายงานปัจจุบัน</div>
              <div className="text-sm font-black text-white">{currentUserName}</div>
              <div className="text-[11px] text-teal-300 font-medium">{userRoleDisplay}</div>
            </div>
          </div>
        </div>

        {/* 📊 Metrics Strip */}
        <div className="relative z-10 grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mt-6 pt-6 border-t border-white/10">
          <div className="bg-white/5 rounded-2xl p-3 sm:p-4 border border-white/5">
            <div className="text-xs text-slate-400 font-bold">รายงานทั้งหมด</div>
            <div className="text-2xl font-black text-white mt-1">{metrics.totalCount}</div>
            <div className="text-[11px] text-slate-400 mt-0.5">บันทึกสะสมทั้งหมด</div>
          </div>
          <div className="bg-white/5 rounded-2xl p-3 sm:p-4 border border-teal-400/20 bg-teal-500/5">
            <div className="text-xs text-teal-300 font-bold flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 rounded-full bg-teal-400 animate-pulse" />
              รายงานวันนี้
            </div>
            <div className="text-2xl font-black text-teal-200 mt-1">{metrics.todayCount}</div>
            <div className="text-[11px] text-teal-300/80 mt-0.5">ประจำวันที่ {todayStr}</div>
          </div>
          <div className="bg-white/5 rounded-2xl p-3 sm:p-4 border border-white/5">
            <div className="text-xs text-slate-400 font-bold">มีภาพถ่ายหน้างาน</div>
            <div className="text-2xl font-black text-white mt-1">{metrics.withPhotoCount}</div>
            <div className="text-[11px] text-slate-400 mt-0.5">มีรูปถ่ายตรวจสอบได้</div>
          </div>
          <div className="bg-white/5 rounded-2xl p-3 sm:p-4 border border-white/5">
            <div className="text-xs text-slate-400 font-bold">โฟร์แมนที่มีความเคลื่อนไหว</div>
            <div className="text-2xl font-black text-white mt-1">{metrics.uniqueForemen}</div>
            <div className="text-[11px] text-slate-400 mt-0.5">คนร่วมส่งรายงาน</div>
          </div>
        </div>
      </div>

      {/* ✍️ Form: Compose New Ad-hoc Report */}
      <div className="bg-white rounded-3xl p-5 sm:p-7 shadow-sm border border-slate-200/80">
        <form onSubmit={handleSubmitReport} className="space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <span className="p-2 rounded-xl bg-teal-50 text-teal-700">
                <Sparkles size={18} />
              </span>
              <div>
                <h3 className="text-base font-black text-slate-800">เขียนรายงานหน้างานนอกแผนใหม่</h3>
                <p className="text-xs text-slate-500">เลือกโครงการและแปลง จากนั้นพิมพ์รายละเอียดหรือแนบรูปถ่ายหน้างาน</p>
              </div>
            </div>
          </div>

          {/* Project & Plot Selector Row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            <div>
              <label className="block text-xs font-black text-slate-600 mb-1.5 flex items-center gap-1.5">
                <Building2 size={14} className="text-teal-600" />
                โครงการ
              </label>
              <select
                value={formProject}
                onChange={e => {
                  setFormProject(e.target.value);
                  setFormPlotId('all');
                }}
                className="w-full bg-slate-50 border border-slate-200 text-slate-800 text-xs font-bold rounded-xl px-3.5 py-2.5 focus:ring-2 focus:ring-teal-500 focus:outline-none transition-all cursor-pointer"
              >
                {projects.map((p: any, idx: number) => {
                  const name = p.name || p.project_name || `โครงการ ${idx + 1}`;
                  return (
                    <option key={p.id || name} value={name}>
                      {name}
                    </option>
                  );
                })}
              </select>
            </div>

            <div>
              <label className="block text-xs font-black text-slate-600 mb-1.5 flex items-center gap-1.5">
                <Home size={14} className="text-teal-600" />
                แปลงบ้าน / ตำแหน่งงาน
              </label>
              <select
                value={formPlotId}
                onChange={e => setFormPlotId(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 text-slate-800 text-xs font-bold rounded-xl px-3.5 py-2.5 focus:ring-2 focus:ring-teal-500 focus:outline-none transition-all cursor-pointer"
              >
                <option value="all">📍 พื้นที่ส่วนกลาง / ไม่ระบุแปลงเฉพาะเจาะจง</option>
                {availableFormPlots.map((plot: any) => {
                  const pName = plot.plot_name || plot.name || `แปลง ${plot.id}`;
                  return (
                    <option key={plot.id} value={plot.id}>
                      🏡 {pName} {plot.foreman_name ? `(โฟร์แมน: ${plot.foreman_name})` : ''}
                    </option>
                  );
                })}
              </select>
            </div>
          </div>

          {/* Quick Category Tags */}
          <div>
            <label className="block text-xs font-black text-slate-600 mb-2 flex items-center gap-1.5">
              <Tag size={14} className="text-teal-600" />
              หมวดหมู่งานนอกแผน (กดเพื่อเลือก)
            </label>
            <div className="flex flex-wrap gap-2">
              {ADHOC_TAGS.map(t => {
                const isSelected = selectedTag === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setSelectedTag(t.id)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-black transition-all border cursor-pointer ${
                      isSelected
                        ? 'bg-teal-600 text-white border-teal-600 shadow-sm shadow-teal-500/20 scale-105'
                        : `${t.color}`
                    }`}
                  >
                    <span>{t.icon}</span>
                    <span>{t.label}</span>
                    {isSelected && <Check size={13} className="stroke-[3]" />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Text Area */}
          <div>
            <label className="block text-xs font-black text-slate-600 mb-1.5 flex items-center gap-1.5">
              <MessageSquare size={14} className="text-teal-600" />
              รายละเอียดงานที่ทำ (ข้อความรายงาน)
            </label>
            <textarea
              rows={3}
              value={reportText}
              onChange={e => setReportText(e.target.value)}
              placeholder="พิมพ์รายงานสิ่งที่ได้ทำนอกเหนือจากแผนงาน เช่น 'วันนี้คนงานช่วยขนเหล็ก 12 มม. เข้าแปลง 99 และช่วยเคลียร์เศษปูนรอบรั้วเพื่อเตรียมงานถัดไป...'"
              className="w-full bg-slate-50 border border-slate-200 text-slate-800 text-sm font-medium rounded-2xl p-3.5 focus:ring-2 focus:ring-teal-500 focus:outline-none transition-all placeholder:text-slate-400"
            />
          </div>

          {/* Photo Attachments & Submit Row */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
            <div className="flex items-center gap-2 flex-wrap">
              {/* Camera Button (Mobile) */}
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={handleFileChange}
              />
              <button
                type="button"
                onClick={() => cameraInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-all border border-slate-200 cursor-pointer"
                title="ถ่ายรูปจากกล้องมือถือ"
              >
                <Camera size={16} className="text-teal-600" />
                <span>ถ่ายรูป</span>
              </button>

              {/* File Upload Button */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handleFileChange}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-all border border-slate-200 cursor-pointer"
                title="เลือกรูปภาพจากเครื่อง"
              >
                <ImageIcon size={16} className="text-teal-600" />
                <span>เลือกรูปภาพ</span>
              </button>

              <span className="text-[11px] text-slate-400">
                (แนบได้สูงสุด 5 รูป บีบอัดอัตโนมัติ)
              </span>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-black text-xs sm:text-sm shadow-md shadow-teal-500/20 active:scale-95 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <>
                  <RefreshCw size={16} className="animate-spin" />
                  <span>กำลังส่งรายงาน...</span>
                </>
              ) : (
                <>
                  <Send size={16} />
                  <span>ส่งรายงานเข้าแชท</span>
                </>
              )}
            </button>
          </div>

          {/* Photo Previews */}
          {attachedFiles.length > 0 && (
            <div className="flex flex-wrap gap-2.5 pt-2">
              {attachedFiles.map((fileObj, idx) => (
                <div key={idx} className="relative group w-20 h-20 rounded-xl overflow-hidden border border-slate-200 shadow-xs">
                  <img src={fileObj.previewUrl} alt="preview" className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() => removeAttachedFile(idx)}
                    className="absolute top-1 right-1 p-1 bg-black/60 hover:bg-black/80 text-white rounded-full transition-all cursor-pointer"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Feedback messages */}
          {submitError && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold flex items-center gap-2">
              <AlertCircle size={15} />
              <span>{submitError}</span>
            </div>
          )}

          {submitSuccess && (
            <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold flex items-center gap-2 animate-in fade-in">
              <CheckCircle2 size={15} />
              <span>ส่งรายงานเรียบร้อยแล้ว รายงานถูกอัปเดตลงฟีดสดทันที!</span>
            </div>
          )}
        </form>
      </div>

      {/* 🔍 Search & Filters Bar */}
      <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-200/80 space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Filter by Project */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-black text-slate-500 uppercase flex items-center gap-1">
                <Building2 size={13} />
                โครงการ:
              </span>
              <select
                value={filterProject}
                onChange={e => setFilterProject(e.target.value)}
                className="bg-slate-50 border border-slate-200 text-slate-800 text-xs font-bold rounded-xl px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-teal-500 cursor-pointer"
              >
                <option value="all">ทุกโครงการ ({allParsedReports.length})</option>
                {projects.map((p: any, idx: number) => {
                  const name = p.name || p.project_name || `โครงการ ${idx + 1}`;
                  return (
                    <option key={p.id || name} value={name}>
                      {name}
                    </option>
                  );
                })}
              </select>
            </div>

            {/* Filter by Foreman */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-black text-slate-500 uppercase flex items-center gap-1">
                <User size={13} />
                ผู้รายงาน:
              </span>
              <select
                value={filterForeman}
                onChange={e => setFilterForeman(e.target.value)}
                className="bg-slate-50 border border-slate-200 text-slate-800 text-xs font-bold rounded-xl px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-teal-500 cursor-pointer"
              >
                <option value="all">ทุกคน</option>
                {Array.from(new Set(allParsedReports.map(r => r.user_name))).map(name => (
                  <option key={name} value={name}>
                    👷 {name}
                  </option>
                ))}
              </select>
            </div>

            {/* Filter by Tag */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-black text-slate-500 uppercase flex items-center gap-1">
                <Tag size={13} />
                หมวด:
              </span>
              <select
                value={filterTag}
                onChange={e => setFilterTag(e.target.value)}
                className="bg-slate-50 border border-slate-200 text-slate-800 text-xs font-bold rounded-xl px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-teal-500 cursor-pointer"
              >
                <option value="all">ทุกหมวด</option>
                {ADHOC_TAGS.map(t => (
                  <option key={t.id} value={t.label}>
                    {t.icon} {t.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Date Range pills */}
            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
              <button
                onClick={() => setFilterDateRange('all')}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  filterDateRange === 'all' ? 'bg-white text-slate-800 shadow-xs' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                ทั้งหมด
              </button>
              <button
                onClick={() => setFilterDateRange('today')}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  filterDateRange === 'today' ? 'bg-teal-600 text-white shadow-xs' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                วันนี้
              </button>
              <button
                onClick={() => setFilterDateRange('week')}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  filterDateRange === 'week' ? 'bg-white text-slate-800 shadow-xs' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                7 วันล่าสุด
              </button>
            </div>
          </div>

          {/* Search box */}
          <div className="relative flex-1 sm:max-w-xs">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="ค้นหาข้อความ, แปลง, โฟร์แมน..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 text-xs font-medium rounded-xl pl-8 pr-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>
        </div>
      </div>

      {/* 💬 Feed: Timeline of Ad-hoc Reports */}
      {groupedReports.length === 0 ? (
        <div className="bg-white rounded-3xl p-12 text-center border border-slate-200/80 shadow-xs space-y-4">
          <div className="w-16 h-16 rounded-3xl bg-teal-50 text-teal-600 flex items-center justify-center mx-auto shadow-inner">
            <MessageSquare size={32} />
          </div>
          <div className="space-y-1">
            <h4 className="text-base font-black text-slate-800">ยังไม่มีรายงานงานนอกแผนตามตัวกรองนี้</h4>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              เมื่อโฟร์แมนหรือทีมงานส่งบันทึกงานเสริม งานเร่งด่วน หรือขนส่งวัสดุ รายการจะปรากฏบนฟีดสดนี้โดยอัตโนมัติ
            </p>
          </div>
          {(filterProject !== 'all' || filterForeman !== 'all' || filterTag !== 'all' || searchQuery.trim() || filterDateRange !== 'all') && (
            <button
              onClick={() => {
                setFilterProject('all');
                setFilterForeman('all');
                setFilterTag('all');
                setFilterDateRange('all');
                setSearchQuery('');
              }}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-all cursor-pointer"
            >
              ล้างตัวกรองทั้งหมด
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {groupedReports.map(group => (
            <div key={group.dateTitle} className="space-y-3">
              {/* Date Header Pill */}
              <div className="sticky top-2 z-10 flex items-center justify-center">
                <span className="px-3.5 py-1 rounded-full bg-slate-800/80 backdrop-blur-md text-white text-[11px] font-black shadow-md border border-slate-700/50">
                  📅 {group.dateTitle} ({group.items.length} รายการ)
                </span>
              </div>

              {/* Messages for this date */}
              <div className="space-y-3">
                {group.items.map(item => {
                  const roleBadge = getRoleBadge(item.role);
                  const tagBadge = getTagBadge(item.tag);
                  const canDelete = isAdmin || isOwner || item.user_name === currentUserName;

                  return (
                    <div
                      key={item.id}
                      className="bg-white rounded-3xl p-4 sm:p-5 shadow-xs border border-slate-200/80 hover:border-teal-300 transition-all space-y-3"
                    >
                      {/* Top sender line */}
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3">
                          {/* Avatar */}
                          <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-slate-100 to-slate-200 text-slate-700 flex items-center justify-center font-black text-sm border border-slate-200/80 shrink-0">
                            {item.user_name.charAt(0).toUpperCase()}
                          </div>

                          {/* Name & Role & Project & Plot */}
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-black text-slate-800 text-sm">{item.user_name}</span>
                              <span className={`px-2 py-0.5 rounded-lg text-[10px] font-bold border ${roleBadge.bg}`}>
                                {roleBadge.label}
                              </span>
                              <span className="text-[11px] text-slate-400">• {item.timeStr} น.</span>
                            </div>

                            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md">
                                <Building2 size={11} className="text-slate-400" />
                                {item.project_name}
                              </span>
                              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-teal-700 bg-teal-50 px-2 py-0.5 rounded-md border border-teal-200/60">
                                <Home size={11} className="text-teal-500" />
                                {item.plot_name}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Tag & Actions */}
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-xs font-bold border ${tagBadge.color}`}>
                            <span>{tagBadge.icon}</span>
                            <span>{tagBadge.label}</span>
                          </span>

                          {canDelete && (
                            <button
                              onClick={() => handleDeleteReport(item.id)}
                              className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all cursor-pointer"
                              title="ลบรายงานนี้"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Message Text */}
                      {item.clean_text && (
                        <div className="text-slate-700 text-sm font-medium leading-relaxed bg-slate-50/70 p-3.5 rounded-2xl border border-slate-100 whitespace-pre-line">
                          {item.clean_text}
                        </div>
                      )}

                      {/* Photo Gallery if images present */}
                      {item.image_urls.length > 0 && (
                        <div className="pt-1">
                          <div className="flex flex-wrap gap-2.5">
                            {item.image_urls.map((imgUrl, imgIdx) => (
                              <div
                                key={imgIdx}
                                onClick={() => onPreviewImage?.(imgUrl)}
                                className="relative group w-24 h-24 sm:w-28 sm:h-28 rounded-2xl overflow-hidden border border-slate-200 shadow-xs cursor-pointer bg-slate-100 hover:shadow-md transition-all"
                              >
                                <img
                                  src={imgUrl}
                                  alt="รูปถ่ายรายงานหน้างาน"
                                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                                />
                                <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white">
                                  <Maximize2 size={18} />
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
