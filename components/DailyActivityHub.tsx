import React, { useState, useMemo } from 'react';
import { 
  Activity, Clock, Calendar, Search, Filter, HardHat, 
  CheckCircle, AlertTriangle, ShieldAlert, Eye, UserCheck, 
  Building2, MapPin, ChevronRight, Layers, FileText, ArrowRight,
  Sparkles, Check, AlertCircle, X, ExternalLink
} from 'lucide-react';
import DailyAccountabilityModal from './DailyAccountabilityModal';

interface DailyActivityHubProps {
  allUpdatesRecord: any[];
  defects: any[];
  defectUpdates: any[];
  allUsers: any[];
  plots: any[];
  projects: any[];
  taskTemplates: any[];
  inspectionQueue?: any[];
  selectedProject?: any;
  setSelectedProject?: (p: any) => void;
  setSelectedPlot?: (p: any) => void;
  setSelectedTask?: (t: any) => void;
  setView?: (v: string) => void;
  isMobileLayout?: boolean;
}

export default function DailyActivityHub({
  allUpdatesRecord = [],
  defects = [],
  defectUpdates = [],
  allUsers = [],
  plots = [],
  projects = [],
  taskTemplates = [],
  inspectionQueue = [],
  selectedProject,
  setSelectedProject,
  setSelectedPlot,
  setSelectedTask,
  setView,
  isMobileLayout = false
}: DailyActivityHubProps) {
  // Current view mode: 'timeline' (แบบที่ 1) หรือ 'walkthrough' (แบบที่ 3)
  const [activeTab, setActiveTab] = useState<'timeline' | 'walkthrough'>('timeline');
  const [roleFilter, setRoleFilter] = useState<'all' | 'foreman' | 'engineer' | 'qc'>('all');
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toLocaleDateString('en-CA'));
  const [searchQuery, setSearchQuery] = useState('');
  const [showBlindSpotsOnly, setShowBlindSpotsOnly] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedPlotDetail, setSelectedPlotDetail] = useState<string | null>(null);

  // 🌟 Key สำหรับจำโครงการที่เลือกใน Daily Activity Hub
  const STORAGE_KEY = 'buildtrack_daily_activity_hub_project';

  // รายชื่อโครงการที่ยังไม่ปิด
  const activeProjectsList = useMemo(() => {
    return (projects || []).filter((p: any) => !p.is_closed);
  }, [projects]);

  // ค้นหาโครงการที่มีแปลงกำลังก่อสร้างจริง เพื่อเป็นค่าเริ่มต้น
  const defaultProjectName = useMemo(() => {
    const projWithActive = activeProjectsList.find((proj: any) => {
      const projPlots = (plots || []).filter((p: any) => p.project_name === proj.name);
      return projPlots.some((p: any) => {
        const prog = Number(p.progress || 0);
        return prog > 0 && prog < 100 && !p.is_completed && p.handover_status !== 'completed' && p.sale_status !== 'ready_for_sale';
      });
    });
    return projWithActive?.name || activeProjectsList[0]?.name || 'ไอลิน6';
  }, [activeProjectsList, plots]);

  // โครงการที่เลือก: ดึงจาก localStorage หรือ prop selectedProject หรือ default
  const [savedProjectName, setSavedProjectName] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) return saved;
      } catch (e) {
        console.warn('Cannot read from localStorage:', e);
      }
    }
    return selectedProject?.name || '';
  });

  // โครงการที่ใช้งานจริง: ถ้าไม่มีการเลือก ให้ใช้ค่าเริ่มต้นโครงการที่กำลังก่อสร้าง
  const effectiveProjectName = useMemo(() => {
    if (savedProjectName) {
      if (savedProjectName === 'all') return 'all';
      const exists = (projects || []).some((p: any) => p.name === savedProjectName);
      if (exists) return savedProjectName;
    }
    if (selectedProject?.name && selectedProject.name !== 'all') {
      return selectedProject.name;
    }
    return defaultProjectName;
  }, [savedProjectName, selectedProject, projects, defaultProjectName]);

  // บันทึกโครงการลง localStorage และอัปเดต state
  const handleProjectChange = (newName: string) => {
    setSavedProjectName(newName);
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(STORAGE_KEY, newName);
      } catch (e) {
        console.warn('Cannot save to localStorage:', e);
      }
    }
    if (setSelectedProject) {
      if (newName === 'all') {
        setSelectedProject(null);
      } else {
        const projObj = (projects || []).find((p: any) => p.name === newName);
        setSelectedProject(projObj || { name: newName });
      }
    }
  };

  // 🌟 Helper: ตรวจสอบว่าแปลงนี้กำลังอยู่ระหว่างการก่อสร้างจริงหรือไม่
  // 1. ตัดบ้านที่ยังไม่มีการเริ่มก่อสร้างใดๆ (progress <= 0 และไม่มีงานเริ่ม)
  // 2. ตัดบ้านที่ก่อสร้างเสร็จแล้วตามเงื่อนไข (progress >= 100, is_completed, handover_status completed, หรือ ready_for_sale)
  const isPlotActiveUnderConstruction = (plot: any) => {
    if (!plot) return false;
    const prog = Number(plot.progress || 0);

    // 1. ตัดบ้านที่ยังไม่เริ่มก่อสร้างใดๆ
    if (prog <= 0) return false;

    // 2. ตัดบ้านที่ก่อสร้างเสร็จแล้วตามเงื่อนไข
    const isCompleted = Boolean(plot.is_completed) || prog >= 100 || plot.handover_status === 'completed';
    const isReadyForSale = plot.sale_status === 'ready_for_sale';
    if (isCompleted || isReadyForSale) return false;

    return true;
  };

  // Map users for fast lookup
  const userMap = useMemo(() => {
    const map = new Map<string, any>();
    (allUsers || []).forEach(u => {
      if (u.username) map.set(u.username.toLowerCase(), u);
      if (u.name) map.set(u.name.toLowerCase(), u);
    });
    return map;
  }, [allUsers]);

  // Normalize role
  const getRoleCategory = (roleStr?: string, userName?: string): 'Foreman' | 'Site Engineer' | 'QC' | 'Other' => {
    const r = (roleStr || '').toLowerCase();
    if (r.includes('foreman') || r.includes('โฟร์แมน')) return 'Foreman';
    if (r.includes('engineer') || r.includes('วิศวกร')) return 'Site Engineer';
    if (r.includes('qc') || r.includes('ควบคุมคุณภาพ')) return 'QC';
    
    if (userName) {
      const u = userMap.get(userName.toLowerCase());
      if (u) {
        const ur = (u.role || '').toLowerCase();
        if (ur.includes('foreman')) return 'Foreman';
        if (ur.includes('engineer')) return 'Site Engineer';
        if (ur.includes('qc')) return 'QC';
      }
    }
    return 'Other';
  };

  // 🌟 Helper ดึง URL รูปภาพแรกที่ถูกต้อง ป้องกันรูปแตก
  const extractFirstValidImageUrl = (raw: any): string | null => {
    if (!raw) return null;
    if (Array.isArray(raw)) {
      for (const item of raw) {
        if (typeof item === 'string') {
          const trimmed = item.trim();
          if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
            return trimmed;
          }
        }
      }
      return null;
    }
    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if (!trimmed || trimmed === 'null' || trimmed === 'undefined') return null;
      const parts = trimmed.split(',').map(s => s.trim()).filter(s => s.startsWith('http://') || s.startsWith('https://'));
      return parts.length > 0 ? parts[0] : null;
    }
    return null;
  };

  // Compile all activities for selected date
  const dayActivities = useMemo(() => {
    const list: any[] = [];

    // 1. Task Updates
    (allUpdatesRecord || []).forEach(u => {
      if (new Date(u.created_at).toLocaleDateString('en-CA') === selectedDate && u.role !== 'Admin') {
        const roleCat = getRoleCategory(u.role, u.user_name);
        const task = (taskTemplates || []).find(t => t.id === u.task_template_id);
        const plotObj = (plots || []).find(p => String(p.id) === String(u.plot_id));
        const validImage = extractFirstValidImageUrl(u.image_url || u.images);
        
        list.push({
          id: `upd-${u.id}`,
          rawTime: new Date(u.created_at).getTime(),
          timeStr: new Date(u.created_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }),
          user: u.user_name || u.username || u.user || (roleCat === 'Foreman' && plotObj?.foreman ? plotObj.foreman : 'ไม่ระบุชื่อ'),
          role: roleCat,
          rawRole: u.role,
          plot: String(u.plot_id),
          projectName: plotObj ? plotObj.project_name : null,
          taskName: task ? task.task_name : (u.action || 'อัปเดตงาน'),
          action: u.action || 'บันทึกงาน',
          detail: u.text_content || '-',
          progress: u.progress,
          image: validImage,
          type: 'update',
          taskObj: task,
          plotObj
        });
      }
    });

    // 2. Defects
    (defects || []).forEach(d => {
      if (new Date(d.created_at).toLocaleDateString('en-CA') === selectedDate) {
        const userObj = userMap.get((d.reported_by || '').toLowerCase());
        if (userObj?.role === 'Admin') return;
        const roleCat = getRoleCategory(userObj?.role, d.reported_by);
        const task = (taskTemplates || []).find(t => t.id === d.task_id);
        const plotObj = (plots || []).find(p => String(p.id) === String(d.plot_id));
        const validImage = extractFirstValidImageUrl(d.image_url || d.images);

        list.push({
          id: `def-${d.id}`,
          rawTime: new Date(d.created_at).getTime(),
          timeStr: new Date(d.created_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }),
          user: d.reported_by || 'ไม่ระบุชื่อ',
          role: roleCat,
          rawRole: userObj?.role || 'QC',
          plot: String(d.plot_id),
          projectName: plotObj ? plotObj.project_name : null,
          taskName: task ? task.task_name : 'งานแจ้งซ่อม/Defect',
          action: 'แจ้ง Defect / สั่งแก้ไข',
          detail: d.description || 'แนบรูปภาพจุดบกพร่อง',
          progress: null,
          image: validImage,
          type: 'defect',
          taskObj: task,
          plotObj
        });
      }
    });

    // Sort descending by time (latest first)
    return list.sort((a, b) => b.rawTime - a.rawTime);
  }, [allUpdatesRecord, defects, selectedDate, taskTemplates, plots, userMap]);

  // Filter activities for timeline based on project selection (if any)
  const scopedActivities = useMemo(() => {
    if (!effectiveProjectName || effectiveProjectName === 'all') return dayActivities;
    return dayActivities.filter(a => !a.projectName || a.projectName === effectiveProjectName);
  }, [dayActivities, effectiveProjectName]);

  // 🌟 3 Role Pillars Metrics (แบบที่ 2)
  const roleMetrics = useMemo(() => {
    const foremanActs = scopedActivities.filter(a => a.role === 'Foreman');
    const engineerActs = scopedActivities.filter(a => a.role === 'Site Engineer');
    const qcActs = scopedActivities.filter(a => a.role === 'QC');

    // Foreman metrics
    const foremanPlots = new Set(foremanActs.map(a => a.plot));
    const foremanSubmits = foremanActs.filter(a => 
      (a.action || '').includes('ส่ง') || a.progress === 100
    ).length;
    const foremanUpdates = foremanActs.filter(a => 
      !(a.action || '').includes('ส่ง') && a.progress !== 100
    ).length;

    // 🏠 รวบรวมแปลงที่กำลังอยู่ระหว่างการก่อสร้างในโครงการที่เลือก
    const activePlotsInScope = (plots || []).filter(p => {
      if (effectiveProjectName && effectiveProjectName !== 'all') {
        if (p.project_name !== effectiveProjectName) return false;
      }
      return isPlotActiveUnderConstruction(p);
    });

    // 👷 จัดกลุ่มโฟร์แมนรายบุคคล พร้อมนับจำนวนกิจกรรมและแปลงที่เข้า
    const foremanByStaff = new Map<string, {
      user: string;
      totalActivities: number;
      totalPlots: Set<string>;
      updates: number;
      submits: number;
    }>();

    // 1. นำโฟร์แมนที่มีการบันทึกกิจกรรมเข้ามา
    foremanActs.forEach(a => {
      const name = a.user || 'โฟร์แมน';
      if (!foremanByStaff.has(name)) {
        foremanByStaff.set(name, {
          user: name,
          totalActivities: 0,
          totalPlots: new Set<string>(),
          updates: 0,
          submits: 0
        });
      }
      const item = foremanByStaff.get(name)!;
      item.totalActivities++;
      if (a.plot) item.totalPlots.add(String(a.plot));
      if ((a.action || '').includes('ส่ง') || a.progress === 100) {
        item.submits++;
      } else {
        item.updates++;
      }
    });

    // 2. นำโฟร์แมนทุกคนที่มีแปลงรับผิดชอบกำลังสร้างอยู่เข้ามาด้วย (เพื่อให้เห็นว่าเข้าครบหรือไม่)
    activePlotsInScope.forEach(p => {
      const fName = (p.foreman || p.foreman_name || '').trim();
      if (fName && !foremanByStaff.has(fName)) {
        foremanByStaff.set(fName, {
          user: fName,
          totalActivities: 0,
          totalPlots: new Set<string>(),
          updates: 0,
          submits: 0
        });
      }
    });

    // 3. คำนวณความครอบคลุมการเข้าตรวจเทียบกับแปลงที่รับผิดชอบ
    const foremanStaffList = Array.from(foremanByStaff.values()).map(f => {
      const assignedActive = activePlotsInScope.filter(p => {
        const pForeman = (p.foreman || p.foreman_name || '').trim().toLowerCase();
        return pForeman === f.user.toLowerCase();
      });
      const totalAssigned = assignedActive.length;
      const visitedAssigned = assignedActive.filter(p => f.totalPlots.has(String(p.id)));
      const visitedAssignedCount = visitedAssigned.length;
      const unvisitedPlots = assignedActive
        .filter(p => !f.totalPlots.has(String(p.id)))
        .map(p => String(p.plot_name || p.id));
      const coverageRate = totalAssigned > 0 ? Math.round((visitedAssignedCount / totalAssigned) * 100) : (f.totalPlots.size > 0 ? 100 : 0);
      const isComplete = totalAssigned > 0 && visitedAssignedCount >= totalAssigned;

      return {
        ...f,
        totalAssigned,
        visitedAssignedCount,
        unvisitedPlots,
        coverageRate,
        isComplete
      };
    }).sort((a, b) => {
      if (b.totalActivities !== a.totalActivities) return b.totalActivities - a.totalActivities;
      return b.totalAssigned - a.totalAssigned;
    });
    const foremanUsers = foremanStaffList.map(s => s.user);

    // Site Engineer metrics
    const engineerInspections = engineerActs.length;
    const engineerApproved = engineerActs.filter(a => 
      (a.action || '').includes('อนุมัติ') || (a.action || '').includes('ผ่าน')
    ).length;
    const engineerPending = (inspectionQueue || []).filter(q => q.statusFor === 'Site Engineer').length;
    const engineerUsers = Array.from(new Set(engineerActs.map(a => a.user)));

    // QC metrics
    const qcTotalInspections = qcActs.length;
    const qcApproved = qcActs.filter(a => 
      (a.action || '').includes('อนุมัติ') || (a.action || '').includes('ผ่าน')
    ).length;
    const qcReworks = qcActs.filter(a => 
      a.type === 'defect' || (a.action || '').includes('ตีกลับ') || (a.action || '').includes('แก้')
    ).length;
    const qcPassRate = qcTotalInspections > 0 ? Math.round((qcApproved / qcTotalInspections) * 100) : 100;
    const qcPending = (inspectionQueue || []).filter(q => q.statusFor === 'QC').length;

    // 🔍 จัดกลุ่มเจ้าหน้าที่ QC รายบุคคล
    const qcByStaff = new Map<string, { user: string; totalActivities: number }>();
    qcActs.forEach(a => {
      const name = a.user || 'QC';
      if (!qcByStaff.has(name)) qcByStaff.set(name, { user: name, totalActivities: 0 });
      qcByStaff.get(name)!.totalActivities++;
    });
    const qcStaffList = Array.from(qcByStaff.values()).sort((a, b) => b.totalActivities - a.totalActivities);
    const qcUsers = qcStaffList.map(s => s.user);

    return {
      foreman: {
        totalPlots: foremanPlots.size,
        submits: foremanSubmits,
        updates: foremanUpdates,
        users: foremanUsers,
        staffList: foremanStaffList
      },
      engineer: {
        inspections: engineerInspections,
        approved: engineerApproved,
        pendingQueue: engineerPending,
        users: engineerUsers
      },
      qc: {
        inspections: qcTotalInspections,
        approved: qcApproved,
        reworks: qcReworks,
        passRate: qcPassRate,
        pendingQueue: qcPending,
        users: qcUsers,
        staffList: qcStaffList
      }
    };
  }, [scopedActivities, inspectionQueue, plots, effectiveProjectName]);

  // 🌟 Timeline Feed Filtered Items (แบบที่ 1)
  const timelineFilteredItems = useMemo(() => {
    return scopedActivities.filter(item => {
      // Role filter
      if (roleFilter === 'foreman' && item.role !== 'Foreman') return false;
      if (roleFilter === 'engineer' && item.role !== 'Site Engineer') return false;
      if (roleFilter === 'qc' && item.role !== 'QC') return false;

      // Search query
      if (searchQuery.trim() !== '') {
        const q = searchQuery.toLowerCase();
        const matchUser = item.user.toLowerCase().includes(q);
        const matchPlot = item.plot.toLowerCase().includes(q);
        const matchTask = item.taskName.toLowerCase().includes(q);
        const matchDetail = item.detail.toLowerCase().includes(q);
        if (!matchUser && !matchPlot && !matchTask && !matchDetail) return false;
      }
      return true;
    });
  }, [scopedActivities, roleFilter, searchQuery]);

  // 🌟 Walkthrough Heatmap & Blind Spot Data (แบบที่ 3)
  const walkthroughPlots = useMemo(() => {
    // Current pool of plots (เฉพาะโครงการที่เลือก และเฉพาะบ้านที่กำลังก่อสร้างจริง)
    const basePlots = (plots || []).filter(p => {
      // 1. กรองเฉพาะโครงการที่เลือก
      if (effectiveProjectName && effectiveProjectName !== 'all') {
        if (p.project_name !== effectiveProjectName) return false;
      }

      // 2. ไม่ต้องแสดงบ้านหลังที่ยังไม่มีการเริ่มก่อสร้างใดๆ เลย กับที่ก่อสร้างเสร็จแล้วตามเงื่อนไข
      return isPlotActiveUnderConstruction(p);
    });

    // Group activities by plot
    const activitiesByPlot = new Map<string, any[]>();
    scopedActivities.forEach(act => {
      if (!act.plot) return;
      if (!activitiesByPlot.has(act.plot)) {
        activitiesByPlot.set(act.plot, []);
      }
      activitiesByPlot.get(act.plot)!.push(act);
    });

    return basePlots.map(plot => {
      const acts = activitiesByPlot.get(String(plot.id)) || [];
      const hasForeman = acts.some(a => a.role === 'Foreman');
      const hasEngineer = acts.some(a => a.role === 'Site Engineer');
      const hasQC = acts.some(a => a.role === 'QC');
      const hasRework = acts.some(a => a.type === 'defect' || (a.action || '').includes('แก้') || (a.action || '').includes('ตีกลับ'));
      const isBlindSpot = acts.length === 0;

      return {
        plot,
        id: String(plot.id),
        projectName: plot.project_name,
        progress: plot.progress || 0,
        activitiesCount: acts.length,
        hasForeman,
        hasEngineer,
        hasQC,
        hasRework,
        isBlindSpot,
        activities: acts
      };
    });
  }, [plots, effectiveProjectName, scopedActivities]);

  // Filtered walkthrough plots
  const displayWalkthroughPlots = useMemo(() => {
    return walkthroughPlots.filter(wp => {
      if (showBlindSpotsOnly && !wp.isBlindSpot) return false;
      if (searchQuery.trim() !== '') {
        const q = searchQuery.toLowerCase();
        const matchId = wp.id.toLowerCase().includes(q);
        const matchProj = (wp.projectName || '').toLowerCase().includes(q);
        const matchInspector = wp.activities.some((a: any) => (a.user || '').toLowerCase().includes(q));
        const matchForeman = ((wp.plot as any)?.foreman || (wp.plot as any)?.foreman_name || '').toLowerCase().includes(q);
        if (!matchId && !matchProj && !matchInspector && !matchForeman) return false;
      }
      return true;
    });
  }, [walkthroughPlots, showBlindSpotsOnly, searchQuery]);

  const totalPlotsCount = walkthroughPlots.length;
  const inspectedPlotsCount = walkthroughPlots.filter(p => !p.isBlindSpot).length;
  const blindSpotsCount = walkthroughPlots.filter(p => p.isBlindSpot).length;
  const coveragePercent = totalPlotsCount > 0 ? Math.round((inspectedPlotsCount / totalPlotsCount) * 100) : 0;

  // Selected plot details modal/drawer (for walkthrough)
  const activePlotData = useMemo(() => {
    if (!selectedPlotDetail) return null;
    return walkthroughPlots.find(wp => wp.id === selectedPlotDetail) || null;
  }, [selectedPlotDetail, walkthroughPlots]);

  return (
    <div className="w-full bg-white rounded-3xl border border-slate-200/80 shadow-sm overflow-hidden mb-8 mt-6">
      
      {/* 🌟 1. Header Toolbar 🌟 */}
      <div className="p-5 sm:p-6 border-b border-slate-100 bg-slate-50/60 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-sm">
              <Activity size={18} className="animate-pulse" />
            </div>
            <div>
              <h3 className="text-xl sm:text-2xl font-black text-slate-800 tracking-tight flex items-center gap-2">
                <span>Daily Activity Hub</span>
                <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
                  {scopedActivities.length} กิจกรรมวันนี้
                </span>
              </h3>
              <p className="text-xs font-semibold text-slate-500 mt-0.5">
                ติดตามการปฏิบัติงานรายวันของ โฟร์แมน • วิศวกรสนาม • ฝ่ายควบคุมคุณภาพ (QC)
              </p>
            </div>
          </div>
        </div>

        {/* Date Selector & View Switcher */}
        <div className="flex flex-wrap items-center gap-2.5 w-full md:w-auto">
          {/* Project Selector */}
          <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-xl px-2.5 py-1.5 shadow-sm">
            <Building2 size={14} className="text-indigo-600 shrink-0" />
            <select
              value={effectiveProjectName}
              onChange={(e) => handleProjectChange(e.target.value)}
              className="text-xs font-bold text-slate-700 bg-transparent outline-none cursor-pointer max-w-[140px] truncate"
            >
              <option value="all">ทุกโครงการ (All)</option>
              {activeProjectsList.map((p: any) => (
                <option key={p.name} value={p.name}>{p.name}</option>
              ))}
            </select>
          </div>

          {/* Date Picker */}
          <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-xl px-3 py-1.5 shadow-sm">
            <Calendar size={14} className="text-slate-400" />
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="text-xs font-bold text-slate-700 bg-transparent outline-none cursor-pointer"
            />
            {selectedDate !== new Date().toLocaleDateString('en-CA') && (
              <button
                onClick={() => setSelectedDate(new Date().toLocaleDateString('en-CA'))}
                className="text-[10px] font-extrabold text-indigo-600 hover:text-indigo-800 ml-1 cursor-pointer"
                title="กลับมาวันนี้"
              >
                วันนี้
              </button>
            )}
          </div>

          {/* View Mode Toggle: แบบ 1 (Timeline) vs แบบ 3 (Walkthrough) */}
          <div className="flex bg-slate-200/70 p-1 rounded-xl text-xs font-bold">
            <button
              onClick={() => setActiveTab('timeline')}
              className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'timeline' 
                  ? 'bg-white text-slate-800 shadow-sm' 
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <Clock size={13} />
              <span>ไทม์ไลน์สด (แบบที่ 1)</span>
            </button>
            <button
              onClick={() => setActiveTab('walkthrough')}
              className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'walkthrough' 
                  ? 'bg-white text-slate-800 shadow-sm' 
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <Layers size={13} />
              <span>ผังตรวจรายแปลง (แบบที่ 3)</span>
            </button>
          </div>

          {/* Button to open Modal Style 5 */}
          <button
            onClick={() => setIsModalOpen(true)}
            className="bg-slate-900 hover:bg-black text-white text-xs font-black px-3.5 py-2 rounded-xl transition-all shadow-sm flex items-center gap-1.5 cursor-pointer shrink-0"
          >
            <FileText size={14} className="text-indigo-400" />
            <span>ตารางประเมินผลงาน (แบบที่ 5)</span>
          </button>
        </div>
      </div>

      {/* 🌟 2. แบบที่ 2: 3 Role Duty Metric Cards (3 เสาหลัก) 🌟 */}
      <div className="p-5 sm:p-6 bg-slate-50/40 border-b border-slate-100">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          
          {/* Card 1: Foreman */}
          <div className="bg-white p-5 rounded-2xl border border-amber-200/70 shadow-sm hover:shadow-md transition-all relative overflow-hidden flex flex-col justify-between">
            <div className="absolute top-0 left-0 w-full h-1 bg-amber-400"></div>
            <div>
              <div className="flex justify-between items-start mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
                    <HardHat size={18} />
                  </div>
                  <div>
                    <h4 className="text-sm font-black text-slate-800">โฟร์แมน (Foreman)</h4>
                    <p className="text-[11px] font-bold text-slate-400">การขับเคลื่อนงานภาคสนาม</p>
                  </div>
                </div>
                <span className="text-[10px] font-black bg-amber-50 text-amber-700 px-2 py-0.5 rounded-md">
                  {roleMetrics.foreman.users.length} คนปฏิบัติงาน
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-100 text-center">
                <div className="bg-slate-50 p-2 rounded-xl">
                  <span className="text-[10px] font-bold text-slate-400 block">แปลงที่เข้า</span>
                  <span className="text-lg font-black text-slate-800">{roleMetrics.foreman.totalPlots}</span>
                </div>
                <div className="bg-slate-50 p-2 rounded-xl">
                  <span className="text-[10px] font-bold text-slate-400 block">อัปเดตงาน</span>
                  <span className="text-lg font-black text-amber-600">{roleMetrics.foreman.updates}</span>
                </div>
                <div className="bg-slate-50 p-2 rounded-xl">
                  <span className="text-[10px] font-bold text-slate-400 block">ส่งตรวจ</span>
                  <span className="text-lg font-black text-indigo-600">{roleMetrics.foreman.submits}</span>
                </div>
              </div>
            </div>

            {/* 🌟 แยกกล่องรายบุคคล (Individual Foreman Sub-Boxes) 🌟 */}
            <div className="mt-3.5 pt-3 border-t border-slate-100">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                  แบ่งช่องแต่ละบุคคล:
                </span>
                <span className="text-[10px] font-bold text-amber-600">
                  คลิกเพื่อกรองงาน
                </span>
              </div>
              {roleMetrics.foreman.staffList.length === 0 ? (
                <p className="text-xs text-slate-400 font-bold italic py-1 text-center">ยังไม่มีโฟร์แมนบันทึกงานวันนี้</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {roleMetrics.foreman.staffList.map((f: any) => {
                    const isSelected = searchQuery.toLowerCase() === f.user.toLowerCase();
                    return (
                      <div
                        key={f.user}
                        onClick={() => {
                          setRoleFilter('foreman');
                          setSearchQuery(isSelected ? '' : f.user);
                        }}
                        className={`p-2.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-2 ${
                          isSelected 
                            ? 'bg-amber-100 border-amber-400 ring-2 ring-amber-300 shadow-sm' 
                            : 'bg-amber-50/50 hover:bg-amber-100/60 border-amber-200/60 shadow-2xs'
                        }`}
                        title={`คลิกเพื่อกรองดูเฉพาะงานของ ${f.user}`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <div className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs font-black shrink-0 ${
                            f.isComplete 
                              ? 'bg-emerald-200 text-emerald-800' 
                              : f.totalAssigned > 0 
                              ? 'bg-amber-200 text-amber-800' 
                              : 'bg-slate-200 text-slate-700'
                          }`}>
                            👷
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-xs font-black text-slate-800 truncate block">
                                {f.user}
                              </span>
                              {f.totalAssigned > 0 && (
                                f.isComplete ? (
                                  <span className="text-[9px] font-black bg-emerald-100 text-emerald-700 px-1 py-0.2 rounded border border-emerald-200">
                                    ครบ 100%
                                  </span>
                                ) : (
                                  <span className="text-[9px] font-black bg-amber-100 text-amber-800 px-1 py-0.2 rounded border border-amber-200">
                                    ขาด {f.totalAssigned - f.visitedAssignedCount} หลัง
                                  </span>
                                )
                              )}
                            </div>
                            <span className="text-[10px] font-bold text-slate-500 block">
                              {f.totalAssigned > 0 
                                ? `เข้าดู ${f.visitedAssignedCount}/${f.totalAssigned} หลังที่รับผิดชอบ (${f.coverageRate}%)`
                                : `เข้า ${f.totalPlots.size} แปลง (นอกสังกัด)`}
                            </span>
                            {f.unvisitedPlots && f.unvisitedPlots.length > 0 && f.unvisitedPlots.length <= 4 && (
                              <span className="text-[9px] font-medium text-rose-500 block truncate">
                                แปลงค้าง: {f.unvisitedPlots.join(', ')}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="text-xs font-black text-amber-700 bg-white/90 px-1.5 py-0.5 rounded-md border border-amber-200 block">
                            {f.totalActivities} กิจกรรม
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Card 2: Site Engineer */}
          <div className="bg-white p-5 rounded-2xl border border-blue-200/70 shadow-sm hover:shadow-md transition-all relative overflow-hidden flex flex-col justify-between">
            <div className="absolute top-0 left-0 w-full h-1 bg-blue-500"></div>
            <div>
              <div className="flex justify-between items-start mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                    <UserCheck size={18} />
                  </div>
                  <div>
                    <h4 className="text-sm font-black text-slate-800">วิศวกรโครงการ (Site Eng)</h4>
                    <p className="text-[11px] font-bold text-slate-400">ตรวจสอบ & รับรองเชิงช่าง</p>
                  </div>
                </div>
                <span className="text-[10px] font-black bg-blue-50 text-blue-700 px-2 py-0.5 rounded-md">
                  {roleMetrics.engineer.users.length} คนปฏิบัติงาน
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-100 text-center">
                <div className="bg-slate-50 p-2 rounded-xl">
                  <span className="text-[10px] font-bold text-slate-400 block">ตรวจเชิงช่าง</span>
                  <span className="text-lg font-black text-slate-800">{roleMetrics.engineer.inspections}</span>
                </div>
                <div className="bg-slate-50 p-2 rounded-xl">
                  <span className="text-[10px] font-bold text-slate-400 block">อนุมัติผ่าน</span>
                  <span className="text-lg font-black text-emerald-600">{roleMetrics.engineer.approved}</span>
                </div>
                <div className="bg-slate-50 p-2 rounded-xl">
                  <span className="text-[10px] font-bold text-slate-400 block">คิวรอตรวจ</span>
                  <span className={`text-lg font-black ${roleMetrics.engineer.pendingQueue > 0 ? 'text-rose-600' : 'text-slate-400'}`}>
                    {roleMetrics.engineer.pendingQueue}
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-3.5 pt-3 border-t border-slate-100">
              {roleMetrics.engineer.users.length > 0 ? (
                <div className="text-[11px] font-bold text-slate-500 truncate flex items-center gap-1.5">
                  <span>📐</span>
                  {roleMetrics.engineer.users.map((u: string) => (
                    <span key={u} className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded-md text-[10px] font-bold border border-blue-200">
                      {u}
                    </span>
                  ))}
                </div>
              ) : (
                <div className="text-[11px] font-bold text-slate-400 italic">
                  ไม่มีวิศวกรเข้าบันทึกงานวันนี้
                </div>
              )}
            </div>
          </div>

          {/* Card 3: QC */}
          <div className="bg-white p-5 rounded-2xl border border-purple-200/70 shadow-sm hover:shadow-md transition-all relative overflow-hidden flex flex-col justify-between">
            <div className="absolute top-0 left-0 w-full h-1 bg-purple-500"></div>
            <div>
              <div className="flex justify-between items-start mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center">
                    <ShieldAlert size={18} />
                  </div>
                  <div>
                    <h4 className="text-sm font-black text-slate-800">ควบคุมคุณภาพ (QC)</h4>
                    <p className="text-[11px] font-bold text-slate-400">ตรวจรับ & ประกันคุณภาพ</p>
                  </div>
                </div>
                <span className="text-[10px] font-black bg-purple-50 text-purple-700 px-2 py-0.5 rounded-md">
                  Pass {roleMetrics.qc.passRate}%
                </span>
              </div>

              {/* 4 Columns Grid (ตรวจแล้ว | ตรวจผ่าน | สั่งแก้ | คิวรอตรวจ) */}
              <div className="grid grid-cols-4 gap-1.5 pt-2 border-t border-slate-100 text-center">
                <div className="bg-slate-50 p-2 rounded-xl">
                  <span className="text-[10px] font-bold text-slate-400 block truncate">ตรวจแล้ว</span>
                  <span className="text-lg font-black text-slate-800">{roleMetrics.qc.inspections}</span>
                </div>
                <div className="bg-slate-50 p-2 rounded-xl">
                  <span className="text-[10px] font-bold text-slate-400 block truncate">ตรวจผ่าน</span>
                  <span className="text-lg font-black text-emerald-600">{roleMetrics.qc.approved}</span>
                </div>
                <div className="bg-slate-50 p-2 rounded-xl">
                  <span className="text-[10px] font-bold text-slate-400 block truncate">สั่งแก้</span>
                  <span className={`text-lg font-black ${roleMetrics.qc.reworks > 0 ? 'text-rose-600' : 'text-slate-400'}`}>
                    {roleMetrics.qc.reworks}
                  </span>
                </div>
                <div className={`p-2 rounded-xl border ${
                  roleMetrics.qc.pendingQueue > 0 ? 'bg-purple-50 border-purple-200' : 'bg-slate-50 border-transparent'
                }`}>
                  <span className="text-[10px] font-bold text-purple-600 block truncate">คิวรอตรวจ</span>
                  <span className={`text-lg font-black ${roleMetrics.qc.pendingQueue > 0 ? 'text-purple-700' : 'text-slate-400'}`}>
                    {roleMetrics.qc.pendingQueue}
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-3.5 pt-3 border-t border-slate-100">
              {roleMetrics.qc.staffList && roleMetrics.qc.staffList.length > 0 ? (
                <div className="text-[11px] font-bold text-slate-500 truncate flex items-center gap-1.5 flex-wrap">
                  <span>🔍</span>
                  {roleMetrics.qc.staffList.map((q: any) => (
                    <span key={q.user} className="bg-purple-50 text-purple-700 px-2 py-0.5 rounded-md text-[10px] font-bold border border-purple-200">
                      {q.user} ({q.totalActivities} งาน)
                    </span>
                  ))}
                </div>
              ) : (
                <div className="text-[11px] font-bold text-slate-400 italic">
                  {roleMetrics.qc.pendingQueue > 0 
                    ? `⚠️ มีงานคอยื่นตรวจถึง QC จำนวน ${roleMetrics.qc.pendingQueue} รายการ`
                    : 'ไม่มีงานค้างรอ QC ตรวจในขณะนี้'}
                </div>
              )}
            </div>
          </div>

        </div>
      </div>

      {/* 🌟 3. Main Body: Toggle View 🌟 */}
      <div className="p-5 sm:p-6">
        
        {/* ==================================================== */}
        {/* VIEW A: แบบที่ 1 Live Timeline Feed                  */}
        {/* ==================================================== */}
        {activeTab === 'timeline' && (
          <div>
            {/* Filter & Search Toolbar */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-5">
              {/* Role filter pills */}
              <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl text-xs font-black">
                <button
                  onClick={() => setRoleFilter('all')}
                  className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                    roleFilter === 'all' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  ทั้งหมด ({scopedActivities.length})
                </button>
                <button
                  onClick={() => setRoleFilter('foreman')}
                  className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                    roleFilter === 'foreman' ? 'bg-white text-amber-600 shadow-sm' : 'text-slate-500 hover:text-amber-600'
                  }`}
                >
                  👷 โฟร์แมน ({scopedActivities.filter(a => a.role === 'Foreman').length})
                </button>
                <button
                  onClick={() => setRoleFilter('engineer')}
                  className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                    roleFilter === 'engineer' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-blue-600'
                  }`}
                >
                  📐 วิศวกร ({scopedActivities.filter(a => a.role === 'Site Engineer').length})
                </button>
                <button
                  onClick={() => setRoleFilter('qc')}
                  className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                    roleFilter === 'qc' ? 'bg-white text-purple-600 shadow-sm' : 'text-slate-500 hover:text-purple-600'
                  }`}
                >
                  🔍 QC ({scopedActivities.filter(a => a.role === 'QC').length})
                </button>
              </div>

              {/* Search */}
              <div className="relative w-full sm:w-64">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="ค้นหาชื่อ, แปลง, ชื่องาน..."
                  className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-700 font-medium"
                />
              </div>
            </div>

            {/* Timeline Stream */}
            {timelineFilteredItems.length === 0 ? (
              <div className="bg-slate-50/70 rounded-2xl border border-dashed border-slate-200 p-12 text-center">
                <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-2">
                  <Clock size={24} />
                </div>
                <p className="text-slate-500 font-bold text-sm">
                  ไม่มีกิจกรรมหน้างานในหมวดหมู่นี้สำหรับวันที่เลือก
                </p>
                <p className="text-xs text-slate-400 mt-0.5">
                  เปลี่ยนตัวกรอง หรือเลือกดูวันที่อื่น
                </p>
              </div>
            ) : (
              <div className="space-y-3 max-h-[520px] overflow-y-auto custom-scrollbar pr-1">
                {timelineFilteredItems.map((act) => {
                  const isRework = act.type === 'defect' || (act.action || '').includes('แก้') || (act.action || '').includes('ตีกลับ');
                  const isApproved = (act.action || '').includes('ผ่าน') || (act.action || '').includes('อนุมัติ');
                  const isSubmit = (act.action || '').includes('ส่ง') || act.progress === 100;

                  return (
                    <div
                      key={act.id}
                      className="p-3.5 sm:p-4 rounded-2xl border border-slate-100 hover:border-slate-200 bg-white shadow-sm hover:shadow transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 group"
                    >
                      {/* Left: User Avatar & Basic Info */}
                      <div className="flex items-start sm:items-center gap-3 min-w-0">
                        {/* Time pill */}
                        <span className="text-xs font-black text-slate-500 bg-slate-100 px-2 py-1 rounded-lg shrink-0">
                          {act.timeStr} น.
                        </span>

                        {/* Role Icon Avatar */}
                        <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-xs shrink-0 ${
                          act.role === 'Foreman' ? 'bg-amber-100 text-amber-700' :
                          act.role === 'Site Engineer' ? 'bg-blue-100 text-blue-700' :
                          act.role === 'QC' ? 'bg-purple-100 text-purple-700' :
                          'bg-slate-100 text-slate-700'
                        }`}>
                          {act.role === 'Foreman' ? <HardHat size={16} /> :
                           act.role === 'Site Engineer' ? <UserCheck size={16} /> :
                           <ShieldAlert size={16} />}
                        </div>

                        {/* Content */}
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-black text-slate-800 text-sm">
                              {act.user}
                            </span>
                            <span className={`text-[10px] font-black uppercase px-1.5 py-0.5 rounded ${
                              act.role === 'Foreman' ? 'bg-amber-50 text-amber-700 border border-amber-200' :
                              act.role === 'Site Engineer' ? 'bg-blue-50 text-blue-700 border border-blue-200' :
                              act.role === 'QC' ? 'bg-purple-50 text-purple-700 border border-purple-200' :
                              'bg-slate-100 text-slate-600'
                            }`}>
                              {act.role}
                            </span>
                            <span className="text-xs font-black text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md">
                              แปลง {act.plot}
                            </span>
                            {act.projectName && (
                              <span className="text-[10px] font-bold text-slate-400 truncate max-w-[120px]">
                                ({act.projectName})
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-xs font-bold text-slate-700 truncate">
                              {act.taskName}
                            </span>
                            {act.detail && act.detail !== '-' && (
                              <span className="text-xs text-slate-400 truncate italic max-w-sm hidden md:inline">
                                • "{act.detail}"
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Right: Action Badge & Thumbnail */}
                      <div className="flex items-center justify-between sm:justify-end gap-2.5 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100">
                        <span className={`text-xs font-black px-2.5 py-1 rounded-lg ${
                          isRework ? 'bg-rose-50 text-rose-700 border border-rose-200' :
                          isApproved ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                          isSubmit ? 'bg-blue-50 text-blue-700 border border-blue-200' :
                          'bg-slate-100 text-slate-700'
                        }`}>
                          {act.action}
                        </span>

                        {act.image && (
                          <a
                            href={act.image}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="shrink-0"
                            title="ดูรูปภาพแนบ"
                          >
                            <img
                              src={act.image}
                              alt="รูปหน้างาน"
                              className="w-8 h-8 rounded-lg object-cover border border-slate-200 hover:scale-110 transition-transform"
                              onError={(e) => {
                                (e.currentTarget as HTMLElement).style.display = 'none';
                              }}
                            />
                          </a>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ==================================================== */}
        {/* VIEW B: แบบที่ 3 Site Walkthrough Heatmap            */}
        {/* ==================================================== */}
        {activeTab === 'walkthrough' && (
          <div>
            {/* Walkthrough Summary Ribbon */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 p-4 bg-slate-50/80 rounded-2xl border border-slate-200/80 mb-5">
              <div className="flex items-center gap-3 flex-wrap">
                <div>
                  <span className="text-xs font-bold text-slate-500">ความครอบคลุมการเดินตรวจ:</span>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-2xl font-black text-slate-800">{coveragePercent}%</span>
                    <span className="text-xs font-bold text-slate-400">
                      ({inspectedPlotsCount}/{totalPlotsCount} แปลงกำลังก่อสร้าง)
                    </span>
                  </div>
                </div>

                <div className="h-8 w-px bg-slate-200 hidden sm:block"></div>

                {/* Blind Spots alert */}
                <div className="flex items-center gap-2">
                  <div className={`px-2.5 py-1 rounded-xl text-xs font-extrabold flex items-center gap-1.5 ${
                    blindSpotsCount > 0 ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'
                  }`}>
                    {blindSpotsCount > 0 ? <AlertTriangle size={14} /> : <CheckCircle size={14} />}
                    <span>{blindSpotsCount > 0 ? `จุดอับยังไม่เข้าตรวจ ${blindSpotsCount} แปลง` : 'เข้าตรวจครบทุกแปลง'}</span>
                  </div>
                </div>
              </div>

              {/* Controls: Search filter badge and toggle blind spots */}
              <div className="flex items-center gap-2 flex-wrap">
                {searchQuery.trim() !== '' && (
                  <div className="flex items-center gap-1.5 px-2.5 py-1 bg-amber-100 text-amber-900 rounded-xl text-xs font-bold border border-amber-300 shadow-2xs">
                    <span>กำลังกรอง: "{searchQuery}" ({displayWalkthroughPlots.length} แปลง)</span>
                    <button 
                      onClick={() => setSearchQuery('')}
                      className="ml-1 p-0.5 hover:bg-amber-200 rounded text-amber-700 cursor-pointer"
                      title="ล้างตัวกรอง"
                    >
                      <X size={13} />
                    </button>
                  </div>
                )}

                <button
                  onClick={() => setShowBlindSpotsOnly(!showBlindSpotsOnly)}
                  className={`text-xs font-black px-3 py-1.5 rounded-xl border transition-all cursor-pointer ${
                    showBlindSpotsOnly 
                      ? 'bg-rose-500 text-white border-rose-500 shadow-sm' 
                      : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  {showBlindSpotsOnly ? '✓ กำลังแสดงเฉพาะจุดอับ' : '⚠️ กรองเฉพาะจุดอับ'}
                </button>
              </div>
            </div>

            {/* Plot Grid */}
            {displayWalkthroughPlots.length === 0 ? (
              <div className="bg-slate-50 rounded-2xl border border-dashed border-slate-200 p-10 text-center text-slate-400 font-bold text-sm">
                {searchQuery.trim() !== '' ? (
                  <div>
                    <p className="text-slate-700 font-black text-sm mb-1">
                      ไม่พบแปลงบ้านที่ตรงกับคำค้นหา "{searchQuery}"
                    </p>
                    <p className="text-xs text-slate-400 mb-3">
                      (ในโครงการนี้มีแปลงที่กำลังอยู่ระหว่างการก่อสร้าง {totalPlotsCount} แปลง)
                    </p>
                    <button
                      onClick={() => setSearchQuery('')}
                      className="px-3.5 py-1.5 bg-white border border-slate-300 text-slate-700 rounded-xl text-xs font-bold hover:bg-slate-100 cursor-pointer shadow-2xs inline-flex items-center gap-1.5"
                    >
                      <X size={13} /> ล้างคำค้นหาเพื่อดูแปลงทั้งหมด
                    </button>
                  </div>
                ) : effectiveProjectName && effectiveProjectName !== 'all' ? (
                  `ไม่พบแปลงบ้านที่กำลังอยู่ระหว่างการก่อสร้างในโครงการ "${effectiveProjectName}" (แปลงทั้งหมดสร้างเสร็จแล้ว หรือยังไม่เริ่มก่อสร้าง)`
                ) : (
                  'ไม่พบแปลงบ้านที่กำลังอยู่ระหว่างการก่อสร้างตามเงื่อนไขที่เลือก'
                )}
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                {displayWalkthroughPlots.map((wp) => {
                  return (
                    <div
                      key={wp.id}
                      onClick={() => setSelectedPlotDetail(selectedPlotDetail === wp.id ? null : wp.id)}
                      className={`p-3.5 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between relative group ${
                        wp.isBlindSpot 
                          ? 'bg-slate-50/80 border-slate-200 text-slate-400 hover:border-amber-300' 
                          : wp.hasRework 
                          ? 'bg-rose-50/50 border-rose-200 hover:border-rose-400 shadow-sm' 
                          : 'bg-white border-slate-200 hover:border-indigo-300 shadow-sm'
                      }`}
                    >
                      {/* Top row: Plot ID and Progress */}
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <span className={`text-base font-black ${wp.isBlindSpot ? 'text-slate-500' : 'text-slate-800'}`}>
                            {wp.id}
                          </span>
                          <span className="text-[10px] font-bold text-slate-400 block truncate max-w-[80px]">
                            {wp.projectName}
                          </span>
                        </div>
                        <span className="text-[10px] font-extrabold bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">
                          {wp.progress}%
                        </span>
                      </div>

                      {/* Middle: Role visit status pills */}
                      <div className="space-y-1 my-1">
                        {wp.isBlindSpot ? (
                          <div className="text-[10px] font-bold text-slate-400 bg-slate-100/80 py-1 px-1.5 rounded-md text-center">
                            ⚪ ยังไม่มีคนเข้า
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 flex-wrap">
                            {wp.hasForeman && (
                              <span className="text-[9px] font-extrabold bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded" title="โฟร์แมนเข้าแล้ว">
                                👷 โฟร์แมน
                              </span>
                            )}
                            {wp.hasEngineer && (
                              <span className="text-[9px] font-extrabold bg-blue-50 text-blue-700 border border-blue-200 px-1.5 py-0.5 rounded" title="วิศวกรตรวจแล้ว">
                                📐 วิศวกร
                              </span>
                            )}
                            {wp.hasQC && (
                              <span className={`text-[9px] font-extrabold px-1.5 py-0.5 rounded border ${
                                wp.hasRework 
                                  ? 'bg-rose-50 text-rose-700 border-rose-200' 
                                  : 'bg-purple-50 text-purple-700 border-purple-200'
                              }`} title="QC ตรวจแล้ว">
                                🔍 QC {wp.hasRework ? '(สั่งแก้)' : '(ผ่าน)'}
                              </span>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Bottom row: Activity count */}
                      <div className="pt-2 border-t border-slate-100 text-[10px] font-bold flex justify-between items-center text-slate-400 mt-1">
                        <span>{wp.activitiesCount} บันทึก</span>
                        <ChevronRight size={12} className="group-hover:translate-x-0.5 transition-transform" />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Expanded Plot Detail Drawer */}
            {activePlotData && (
              <div className="mt-5 p-4 sm:p-5 bg-slate-50 rounded-2xl border border-indigo-200 animate-in fade-in duration-200">
                <div className="flex justify-between items-center mb-3">
                  <div className="flex items-center gap-2">
                    <Building2 size={18} className="text-indigo-600" />
                    <h4 className="text-sm font-black text-slate-800">
                      บันทึกกิจกรรมประจำวันของ แปลง {activePlotData.id} ({activePlotData.projectName})
                    </h4>
                  </div>
                  <button
                    onClick={() => setSelectedPlotDetail(null)}
                    className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
                  >
                    <X size={16} />
                  </button>
                </div>

                {activePlotData.activities.length === 0 ? (
                  <p className="text-xs font-bold text-slate-400">
                    ไม่มีการบันทึกกิจกรรมในแปลงนี้สำหรับวันที่เลือก (แปลงจุดอับ)
                  </p>
                ) : (
                  <div className="space-y-2">
                    {activePlotData.activities.map((act: any, idx: number) => (
                      <div key={idx} className="p-3 bg-white rounded-xl border border-slate-200 flex justify-between items-center gap-3 text-xs">
                        <div className="flex items-center gap-2">
                          <span className="font-black text-slate-400">{act.timeStr} น.</span>
                          <span className="font-black text-slate-700">[{act.role}] {act.user}</span>
                          <span className="font-bold text-slate-500">• {act.taskName}</span>
                        </div>
                        <span className="font-black px-2 py-0.5 rounded bg-slate-100 text-slate-700 shrink-0">
                          {act.action}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

      </div>

      {/* 🌟 4. แบบที่ 5 Modal: Daily Accountability Table Modal 🌟 */}
      <DailyAccountabilityModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        selectedDate={selectedDate}
        setSelectedDate={setSelectedDate}
        allUpdatesRecord={allUpdatesRecord}
        defects={defects}
        defectUpdates={defectUpdates}
        allUsers={allUsers}
        plots={plots}
        taskTemplates={taskTemplates}
        projects={projects}
      />

    </div>
  );
}
