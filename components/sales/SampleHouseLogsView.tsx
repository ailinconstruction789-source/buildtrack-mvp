"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { 
  Home, Calendar, Sun, Moon, CheckCircle2, XCircle, 
  AlertTriangle, Filter, Search, User, Clock, Building2, 
  ChevronLeft, ChevronRight, Eye, ShieldCheck, RefreshCw, 
  Sparkles, CheckSquare, Square, X, Download, BarChart2, Award
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { isSampleHouse } from '@/lib/sales/sampleHouseHelper';

interface SampleHouseLogsViewProps {
  projects?: any[];
  plots?: any[];
  user?: any;
  selectedProjectName?: string;
}

const MORNING_CHECKLIST_LABELS: Record<string, string> = {
  'm_cleanliness': '🏠 สภาพบ้านตัวอย่าง & ความสะอาด',
  'm_lights_ac': '💡 ระบบไฟ & แอร์',
  'm_toilet': '🚻 ห้องน้ำ & ของใช้',
  'm_drinking_water': '🥤 น้ำดื่ม & เครื่องดื่มต้อนรับ',
  'm_buddha_water': '🛕 จุดพระบูชา & น้ำพระ',
  'm_golf_cart': '🛺 รถกอล์ฟ & ความพร้อมใช้งาน',
  'm_sales_docs': '📄 เอกสารการขาย & Price List',
};

const EVENING_CHECKLIST_LABELS: Record<string, string> = {
  'e_turn_off_ac': '❄️ ระบบปรับอากาศ (ปิดแอร์ทุกเครื่อง)',
  'e_turn_off_lights': '💡 ระบบไฟฟ้า (ปิดไฟทุกดวง)',
  'e_turn_off_water': '🚰 ระบบน้ำ (ตรวจก๊อกน้ำทุกจุด)',
  'e_lock_doors_windows': '🔒 ประตู & หน้าต่าง (ดิจิทัลล็อก)',
  'e_charge_golf_cart': '🛺 รถกอล์ฟ (เข้าจุดจอด & เสียบชาร์จ)',
  'e_secure_documents': '📁 เอกสารสำคัญ (เก็บเข้าตู้ล็อก)',
  'e_security_check': '🛡️ ความปลอดภัยโดยรวมรอบบ้าน',
};

const THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
];

export default function SampleHouseLogsView({
  projects: externalProjects = [],
  plots: externalPlots = [],
  user,
  selectedProjectName = 'all'
}: SampleHouseLogsViewProps) {
  const [logs, setLogs] = useState<any[]>([]);
  const [projectsList, setProjectsList] = useState<any[]>(externalProjects);
  const [plotsList, setPlotsList] = useState<any[]>(externalPlots);
  const [loading, setLoading] = useState<boolean>(true);
  
  // Filters
  const [selectedProject, setSelectedProject] = useState<string>(selectedProjectName || 'all');
  const [selectedRoutine, setSelectedRoutine] = useState<'all' | 'morning' | 'evening'>('all');
  const [selectedStatus, setSelectedStatus] = useState<'all' | 'normal' | 'issue'>('all');
  const [searchTerm, setSearchTerm] = useState<string>('');
  
  // Month / Year Picker (Defaults to current month/year)
  const now = new Date();
  const [currentYear, setCurrentYear] = useState<number>(now.getFullYear());
  const [currentMonth, setCurrentMonth] = useState<number>(now.getMonth()); // 0-11
  
  // Selected Day Filter (if user clicks on a day in calendar)
  const [selectedDayDate, setSelectedDayDate] = useState<string | null>(null);

  // Detail Modal
  const [selectedLogDetail, setSelectedLogDetail] = useState<any | null>(null);

  // Fetch Projects & Plots if needed
  useEffect(() => {
    const fetchMetadata = async () => {
      try {
        if (projectsList.length === 0) {
          const { data: pData } = await supabase.from('projects').select('*');
          if (pData) setProjectsList(pData);
        }
        if (plotsList.length === 0) {
          const { data: plData } = await supabase.from('plots').select('id, plot_name, project_name, sale_status, has_customer, highlight_note');
          if (plData) setPlotsList(plData);
        }
      } catch (e) {
        console.error('Error fetching metadata:', e);
      }
    };
    fetchMetadata();
  }, []);

  // Fetch Inspection Logs from house_visit_checklists
  const fetchLogs = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('house_visit_checklists')
        .select('*')
        .is('lead_id', null)
        .order('created_at', { ascending: false });

      if (selectedProject !== 'all') {
        query = query.eq('project_name', selectedProject);
      }

      const { data, error } = await query;
      if (error) throw error;
      setLogs(data || []);
    } catch (err) {
      console.error('Error fetching sample house logs:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [selectedProject]);

  // Project Names for Dropdown
  const projectOptions = useMemo(() => {
    const names = Array.from(new Set([
      ...projectsList.map(p => p.name || p.project_name).filter(Boolean),
      ...logs.map(l => l.project_name).filter(Boolean)
    ])) as string[];
    return names.sort((a, b) => a.localeCompare(b, 'th'));
  }, [projectsList, logs]);

  // Filter logs for the selected Year and Month
  const monthLogs = useMemo(() => {
    return logs.filter(log => {
      if (!log.created_at) return false;
      const d = new Date(log.created_at);
      return d.getFullYear() === currentYear && d.getMonth() === currentMonth;
    });
  }, [logs, currentYear, currentMonth]);

  // Calendar Day Map for current month
  const calendarDaysData = useMemo(() => {
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const firstDayOfWeek = new Date(currentYear, currentMonth, 1).getDay(); // 0 = Sun
    
    // Group logs by YYYY-MM-DD
    const dayMap: Record<string, { morning: any[]; evening: any[] }> = {};
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      dayMap[dateStr] = { morning: [], evening: [] };
    }

    monthLogs.forEach(log => {
      const d = new Date(log.created_at);
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (dayMap[dateStr]) {
        const isEve = log.stage === 'daily_routine_evening' || log.customer_name?.includes('รอบเย็น');
        if (isEve) {
          dayMap[dateStr].evening.push(log);
        } else {
          dayMap[dateStr].morning.push(log);
        }
      }
    });

    return { daysInMonth, firstDayOfWeek, dayMap };
  }, [monthLogs, currentYear, currentMonth]);

  // Consistency & KPI Statistics for current month
  const stats = useMemo(() => {
    const today = new Date();
    const isCurrentMonthNow = today.getFullYear() === currentYear && today.getMonth() === currentMonth;
    const daysElapsed = isCurrentMonthNow ? today.getDate() : calendarDaysData.daysInMonth;
    
    let daysWithAnyCheck = 0;
    let daysWithBothChecks = 0;
    let totalMorningCount = 0;
    let totalEveningCount = 0;

    Object.entries(calendarDaysData.dayMap).forEach(([dateStr, data]) => {
      const dNum = parseInt(dateStr.split('-')[2], 10);
      if (dNum <= daysElapsed) {
        const hasM = data.morning.length > 0;
        const hasE = data.evening.length > 0;
        if (hasM) totalMorningCount += data.morning.length;
        if (hasE) totalEveningCount += data.evening.length;
        if (hasM || hasE) daysWithAnyCheck++;
        if (hasM && hasE) daysWithBothChecks++;
      }
    });

    const consistencyRate = daysElapsed > 0 ? Math.round((daysWithAnyCheck / daysElapsed) * 100) : 0;
    const fullRoutineRate = daysElapsed > 0 ? Math.round((daysWithBothChecks / daysElapsed) * 100) : 0;

    return {
      daysElapsed,
      daysWithAnyCheck,
      daysWithBothChecks,
      totalMorningCount,
      totalEveningCount,
      consistencyRate,
      fullRoutineRate
    };
  }, [calendarDaysData, currentYear, currentMonth]);

  // Filtered Table Rows
  const filteredLogs = useMemo(() => {
    return monthLogs.filter(log => {
      // Selected Day filter from calendar
      if (selectedDayDate) {
        const d = new Date(log.created_at);
        const logDateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        if (logDateStr !== selectedDayDate) return false;
      }

      // Routine Filter
      if (selectedRoutine !== 'all') {
        const isEve = log.stage === 'daily_routine_evening' || log.customer_name?.includes('รอบเย็น');
        if (selectedRoutine === 'morning' && isEve) return false;
        if (selectedRoutine === 'evening' && !isEve) return false;
      }

      // Status Filter
      if (selectedStatus !== 'all') {
        const hasIssue = log.objections || log.lead_crm_status === 'Requires Attention';
        if (selectedStatus === 'issue' && !hasIssue) return false;
        if (selectedStatus === 'normal' && hasIssue) return false;
      }

      // Search Filter
      if (searchTerm.trim()) {
        const q = searchTerm.trim().toLowerCase();
        const agent = (log.agent_name || '').toLowerCase();
        const plot = (log.house_or_plot_name || '').toLowerCase();
        const proj = (log.project_name || '').toLowerCase();
        const notes = (log.customer_feedback || log.objections || '').toLowerCase();
        if (!agent.includes(q) && !plot.includes(q) && !proj.includes(q) && !notes.includes(q)) {
          return false;
        }
      }

      return true;
    });
  }, [monthLogs, selectedDayDate, selectedRoutine, selectedStatus, searchTerm]);

  // Month navigation handlers
  const handlePrevMonth = () => {
    setSelectedDayDate(null);
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear(prev => prev - 1);
    } else {
      setCurrentMonth(prev => prev - 1);
    }
  };

  const handleNextMonth = () => {
    setSelectedDayDate(null);
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear(prev => prev + 1);
    } else {
      setCurrentMonth(prev => prev + 1);
    }
  };

  // Helper to determine plot status badge
  const getPlotStatusInfo = (plotNameStr?: string, projectNameStr?: string) => {
    if (!plotNameStr) return { label: 'บ้านตัวอย่าง', color: 'bg-amber-100 text-amber-800 border-amber-200' };
    
    // Clean string to match plot ID or plot name
    const match = plotsList.find(p => {
      if (projectNameStr && p.project_name && p.project_name !== projectNameStr) return false;
      const cleanTarget = plotNameStr.replace(/บ้านตัวอย่าง|แปลง|\s+/g, '').trim().toLowerCase();
      const pId = (p.id || '').replace(/บ้านตัวอย่าง|แปลง|\s+/g, '').trim().toLowerCase();
      const pName = (p.plot_name || '').replace(/บ้านตัวอย่าง|แปลง|\s+/g, '').trim().toLowerCase();
      return cleanTarget === pId || cleanTarget === pName || plotNameStr.includes(p.id) || plotNameStr.includes(p.plot_name);
    });

    if (match) {
      if (isSampleHouse(match)) {
        return { label: '🟢 บ้านตัวอย่างปัจจุบัน', color: 'bg-emerald-100 text-emerald-800 border-emerald-300' };
      }
      const st = (match.sale_status || '').toLowerCase();
      if (['transferred', 'sold', 'handover'].includes(st)) {
        return { label: '🤝 โอนแล้ว (อดีตบ้านตัวอย่าง)', color: 'bg-purple-100 text-purple-800 border-purple-200' };
      }
      if (['booked', 'reserved', 'contracted', 'downpayment'].includes(st) || match.has_customer) {
        return { label: '📑 จองแล้ว (อดีตบ้านตัวอย่าง)', color: 'bg-blue-100 text-blue-800 border-blue-200' };
      }
    }

    return { label: '🏡 บ้านตัวอย่าง', color: 'bg-amber-50 text-amber-800 border-amber-200' };
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      
      {/* 🌟 1. Top Header */}
      <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div className="p-2.5 bg-gradient-to-br from-amber-500 to-amber-600 text-white rounded-2xl shadow-md shadow-amber-500/20">
              <ShieldCheck size={26} />
            </div>
            <div>
              <h1 className="text-2xl font-black text-slate-800 tracking-tight flex items-center gap-2">
                บันทึกตรวจบ้านตัวอย่าง (Sample House SOP Logs)
              </h1>
              <p className="text-xs sm:text-sm text-slate-500 font-medium">
                ตรวจสอบความสม่ำเสมอในการเปิด-ปิดบ้านตัวอย่างของฝ่ายขาย และประวัติการตรวจเช็คทุกโครงการ
              </p>
            </div>
          </div>
        </div>

        {/* Month Selector & Project Switcher */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Project Selector */}
          <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-2xl px-3.5 py-2 shadow-sm">
            <Building2 size={16} className="text-slate-400" />
            <select
              value={selectedProject}
              onChange={(e) => {
                setSelectedProject(e.target.value);
                setSelectedDayDate(null);
              }}
              className="text-xs font-bold text-slate-700 bg-transparent focus:outline-none cursor-pointer"
            >
              <option value="all">🏢 ทุกโครงการ (All Projects)</option>
              {projectOptions.map(pName => (
                <option key={pName} value={pName}>{pName}</option>
              ))}
            </select>
          </div>

          {/* Month Navigation */}
          <div className="flex items-center bg-slate-50 border border-slate-200 rounded-2xl p-1 shadow-sm">
            <button
              onClick={handlePrevMonth}
              className="p-1.5 hover:bg-white text-slate-600 hover:text-slate-900 rounded-xl transition-all"
              title="เดือนก่อนหน้า"
            >
              <ChevronLeft size={18} />
            </button>
            <span className="px-3 text-xs font-black text-slate-800 min-w-[130px] text-center">
              {THAI_MONTHS[currentMonth]} {currentYear + 543}
            </span>
            <button
              onClick={handleNextMonth}
              className="p-1.5 hover:bg-white text-slate-600 hover:text-slate-900 rounded-xl transition-all"
              title="เดือนถัดไป"
            >
              <ChevronRight size={18} />
            </button>
          </div>

          <button
            onClick={fetchLogs}
            disabled={loading}
            className="p-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-2xl transition-colors shrink-0"
            title="รีเฟรชข้อมูล"
          >
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* 🌟 2. KPI Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        
        {/* Consistency Rate Card */}
        <div className="bg-white rounded-3xl p-5 border border-slate-200 shadow-sm flex flex-col justify-between relative overflow-hidden">
          <div className="flex justify-between items-start mb-3">
            <span className="text-xs font-black uppercase text-slate-400 tracking-wider">ความสม่ำเสมอในเดือนนี้</span>
            <div className="p-2 bg-blue-50 text-blue-600 rounded-xl">
              <Award size={18} />
            </div>
          </div>
          <div>
            <div className="text-3xl font-black text-slate-800 tracking-tight flex items-baseline gap-1">
              {stats.consistencyRate}%
              <span className="text-xs font-semibold text-slate-400">
                ({stats.daysWithAnyCheck}/{stats.daysElapsed} วัน)
              </span>
            </div>
            <div className="w-full bg-slate-100 h-2 rounded-full mt-3 overflow-hidden">
              <div 
                className={`h-full rounded-full transition-all duration-500 ${
                  stats.consistencyRate >= 90 ? 'bg-emerald-500' : stats.consistencyRate >= 70 ? 'bg-amber-500' : 'bg-rose-500'
                }`}
                style={{ width: `${stats.consistencyRate}%` }}
              ></div>
            </div>
          </div>
          <p className="text-[11px] text-slate-500 font-medium mt-3">
            {stats.consistencyRate >= 90 ? '🌟 ยอดเยี่ยม! มีการตรวจสม่ำเสมอ' : stats.consistencyRate >= 70 ? '⚡ พอใช้ได้ ควรเปิด-ปิดบ้านให้ครบทุกวัน' : '⚠️ มีวันที่ขาดการตรวจเช็ค กรุณากำชับทีม'}
          </p>
        </div>

        {/* Morning Checks Card */}
        <div className="bg-white rounded-3xl p-5 border border-slate-200 shadow-sm flex flex-col justify-between">
          <div className="flex justify-between items-start mb-3">
            <span className="text-xs font-black uppercase text-slate-400 tracking-wider">☀️ ตรวจรอบเช้า (เปิดบ้าน)</span>
            <div className="p-2 bg-amber-50 text-amber-600 rounded-xl">
              <Sun size={18} />
            </div>
          </div>
          <div>
            <div className="text-3xl font-black text-amber-600 tracking-tight">
              {stats.totalMorningCount} <span className="text-xs font-semibold text-slate-400">ครั้ง</span>
            </div>
            <p className="text-xs text-slate-500 font-medium mt-2">
              เปิดแอร์, เตรียมน้ำดื่ม, ความสะอาด, รถกอล์ฟ
            </p>
          </div>
          <div className="mt-2 text-[11px] font-bold text-amber-700 bg-amber-50 px-2.5 py-1 rounded-lg w-fit">
            SOP เตรียมรับลูกค้า
          </div>
        </div>

        {/* Evening Checks Card */}
        <div className="bg-white rounded-3xl p-5 border border-slate-200 shadow-sm flex flex-col justify-between">
          <div className="flex justify-between items-start mb-3">
            <span className="text-xs font-black uppercase text-slate-400 tracking-wider">🌙 ตรวจรอบเย็น (ปิดบ้าน)</span>
            <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl">
              <Moon size={18} />
            </div>
          </div>
          <div>
            <div className="text-3xl font-black text-indigo-600 tracking-tight">
              {stats.totalEveningCount} <span className="text-xs font-semibold text-slate-400">ครั้ง</span>
            </div>
            <p className="text-xs text-slate-500 font-medium mt-2">
              ปิดแอร์, ปิดไฟ, ล็อกประตูดิจิทัล, ชาร์จรถกอล์ฟ
            </p>
          </div>
          <div className="mt-2 text-[11px] font-bold text-indigo-700 bg-indigo-50 px-2.5 py-1 rounded-lg w-fit">
            SOP ความปลอดภัย & ประหยัดไฟ
          </div>
        </div>

        {/* Full Routine (Both Morning & Evening) */}
        <div className="bg-white rounded-3xl p-5 border border-slate-200 shadow-sm flex flex-col justify-between">
          <div className="flex justify-between items-start mb-3">
            <span className="text-xs font-black uppercase text-slate-400 tracking-wider">ตรวจครบทั้งเช้า-เย็น</span>
            <div className="p-2 bg-emerald-50 text-emerald-600 rounded-xl">
              <CheckCircle2 size={18} />
            </div>
          </div>
          <div>
            <div className="text-3xl font-black text-emerald-600 tracking-tight">
              {stats.daysWithBothChecks} <span className="text-xs font-semibold text-slate-400">/ {stats.daysElapsed} วัน</span>
            </div>
            <p className="text-xs text-slate-500 font-medium mt-2">
              คิดเป็น {stats.fullRoutineRate}% ของวันที่ผ่านมา
            </p>
          </div>
          <div className="mt-2 text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-lg w-fit">
            ครบถ้วน 100% SOP
          </div>
        </div>

      </div>

      {/* 🌟 3. Monthly Consistency Calendar View */}
      <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
          <div>
            <h3 className="font-black text-lg text-slate-800 flex items-center gap-2">
              <Calendar className="text-blue-600" size={20} />
              ปฏิทินบันทึกการตรวจประจำวัน ({THAI_MONTHS[currentMonth]} {currentYear + 543})
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              คลิกที่วันในปฏิทินเพื่อกรองดูรายการตรวจของวันนั้นๆ ด้านล่าง
            </p>
          </div>

          <div className="flex items-center gap-3 text-xs font-bold text-slate-600">
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-amber-500"></span> ☀️ รอบเช้า</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-indigo-500"></span> 🌙 รอบเย็น</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-slate-300"></span> ⚪ ไม่ได้ตรวจ</span>
            {selectedDayDate && (
              <button
                onClick={() => setSelectedDayDate(null)}
                className="ml-2 text-rose-600 hover:text-rose-700 bg-rose-50 px-2 py-1 rounded-lg text-xs font-black transition-colors"
              >
                ✕ ล้างตัวเลือกวัน
              </button>
            )}
          </div>
        </div>

        {/* Days of Week Header */}
        <div className="grid grid-cols-7 gap-1.5 sm:gap-2 text-center text-xs font-black text-slate-400 mb-2 uppercase tracking-wider">
          <div className="text-rose-500">อา.</div>
          <div>จ.</div>
          <div>อ.</div>
          <div>พ.</div>
          <div>พฤ.</div>
          <div>ศ.</div>
          <div className="text-blue-500">ส.</div>
        </div>

        {/* Calendar Grid */}
        <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
          {/* Empty cells before the 1st day of month */}
          {Array.from({ length: calendarDaysData.firstDayOfWeek }).map((_, i) => (
            <div key={`empty-${i}`} className="h-20 sm:h-24 bg-slate-50/50 rounded-2xl border border-dashed border-slate-200/60 opacity-30"></div>
          ))}

          {/* Days of current month */}
          {Array.from({ length: calendarDaysData.daysInMonth }).map((_, i) => {
            const dayNum = i + 1;
            const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
            const dayData = calendarDaysData.dayMap[dateStr] || { morning: [], evening: [] };
            const hasM = dayData.morning.length > 0;
            const hasE = dayData.evening.length > 0;
            
            const today = new Date();
            const isToday = today.getFullYear() === currentYear && today.getMonth() === currentMonth && today.getDate() === dayNum;
            const isFuture = new Date(currentYear, currentMonth, dayNum) > today;
            const isSelected = selectedDayDate === dateStr;

            return (
              <div
                key={dateStr}
                onClick={() => setSelectedDayDate(isSelected ? null : dateStr)}
                className={`h-20 sm:h-24 rounded-2xl p-2 sm:p-2.5 flex flex-col justify-between transition-all cursor-pointer border ${
                  isSelected
                    ? 'ring-2 ring-blue-500 bg-blue-50/60 border-blue-300 shadow-md'
                    : isToday
                    ? 'bg-amber-50/40 border-amber-300 font-bold'
                    : isFuture
                    ? 'bg-slate-50/40 border-slate-100 opacity-60'
                    : hasM || hasE
                    ? 'bg-white border-slate-200 hover:border-blue-300 hover:shadow-sm'
                    : 'bg-slate-50/80 border-slate-200 hover:bg-slate-100'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className={`text-xs font-black ${isToday ? 'text-amber-600 bg-amber-100 px-1.5 py-0.5 rounded-md' : 'text-slate-700'}`}>
                    {dayNum}
                  </span>
                  {isToday && <span className="text-[9px] font-bold text-amber-600 hidden sm:inline">วันนี้</span>}
                </div>

                {/* Badges for checks */}
                <div className="space-y-1 mt-1">
                  {hasM && (
                    <div className="bg-amber-500 text-white rounded-md px-1.5 py-0.5 text-[9px] font-black flex items-center gap-1 shadow-xs truncate" title={`ตรวจเช้า: ${dayData.morning.map(m => m.agent_name).join(', ')}`}>
                      <Sun size={10} className="shrink-0" />
                      <span className="truncate">{dayData.morning[0]?.agent_name || 'เช้า'}</span>
                    </div>
                  )}
                  {hasE && (
                    <div className="bg-indigo-600 text-white rounded-md px-1.5 py-0.5 text-[9px] font-black flex items-center gap-1 shadow-xs truncate" title={`ตรวจเย็น: ${dayData.evening.map(e => e.agent_name).join(', ')}`}>
                      <Moon size={10} className="shrink-0" />
                      <span className="truncate">{dayData.evening[0]?.agent_name || 'เย็น'}</span>
                    </div>
                  )}
                  {!hasM && !hasE && !isFuture && (
                    <div className="text-[9px] text-slate-400 font-semibold px-1 text-center">
                      -
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 🌟 4. Detailed Inspection History Table */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
        
        {/* Table Controls & Filters */}
        <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-base text-slate-800 flex items-center gap-2">
              ประวัติการตรวจเช็คละเอียด
              <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-700">
                {filteredLogs.length} รายการ
              </span>
            </h3>
            {selectedDayDate && (
              <span className="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-lg border border-blue-200">
                📅 วันที่ {selectedDayDate}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Routine Filter */}
            <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-xl p-1 shadow-xs text-xs font-bold">
              <button
                onClick={() => setSelectedRoutine('all')}
                className={`px-3 py-1.5 rounded-lg transition-all ${selectedRoutine === 'all' ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-slate-800'}`}
              >
                ทั้งหมด
              </button>
              <button
                onClick={() => setSelectedRoutine('morning')}
                className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1 ${selectedRoutine === 'morning' ? 'bg-amber-500 text-white' : 'text-slate-500 hover:text-amber-600'}`}
              >
                <Sun size={12} /> รอบเช้า
              </button>
              <button
                onClick={() => setSelectedRoutine('evening')}
                className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1 ${selectedRoutine === 'evening' ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:text-indigo-600'}`}
              >
                <Moon size={12} /> รอบเย็น
              </button>
            </div>

            {/* Status Filter */}
            <select
              value={selectedStatus}
              onChange={(e: any) => setSelectedStatus(e.target.value)}
              className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 focus:outline-none cursor-pointer shadow-xs"
            >
              <option value="all">ผลตรวจทั้งหมด</option>
              <option value="normal">🟢 ปกติเรียบร้อย</option>
              <option value="issue">⚠️ มีข้อสังเกต / ปัญหา</option>
            </select>

            {/* Search Input */}
            <div className="relative">
              <Search size={14} className="absolute left-3 top-2.5 text-slate-400" />
              <input
                type="text"
                placeholder="ค้นหาชื่อเซลล์ / แปลง / หมายเหตุ..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-8 pr-3 py-1.5 border border-slate-200 rounded-xl text-xs font-semibold bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 w-44 sm:w-56"
              />
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-500 text-[11px] font-black uppercase tracking-wider border-b border-slate-200">
              <tr>
                <th className="px-6 py-4">วันและเวลาที่ตรวจ</th>
                <th className="px-6 py-4">โครงการ</th>
                <th className="px-6 py-4">แปลง / สถานที่</th>
                <th className="px-6 py-4">รอบการตรวจ</th>
                <th className="px-6 py-4">ผู้ตรวจเช็ค (เซลล์)</th>
                <th className="px-6 py-4">ผลการตรวจ</th>
                <th className="px-6 py-4 text-center">Checklist ผ่าน</th>
                <th className="px-6 py-4 text-center">รายละเอียด</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
              {filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center text-slate-400 font-bold">
                    <Clock size={32} className="opacity-30 mx-auto mb-2" />
                    ไม่พบรายการตรวจเช็คตามเงื่อนไขที่เลือก
                  </td>
                </tr>
              ) : (
                filteredLogs.map(log => {
                  const isEve = log.stage === 'daily_routine_evening' || log.customer_name?.includes('รอบเย็น');
                  const hasIssue = log.objections || log.lead_crm_status === 'Requires Attention';
                  const dateObj = new Date(log.created_at);
                  const dateFormatted = `${dateObj.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })} • ${dateObj.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.`;
                  
                  const plotBadge = getPlotStatusInfo(log.house_or_plot_name, log.project_name);
                  
                  const checklistObj = log.stage_a_checklist || {};
                  const totalKeys = Object.keys(isEve ? EVENING_CHECKLIST_LABELS : MORNING_CHECKLIST_LABELS).length;
                  const passedCount = Object.values(checklistObj).filter(Boolean).length;

                  return (
                    <tr key={log.id} className="hover:bg-slate-50/70 transition-colors">
                      {/* Date & Time */}
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="font-bold text-slate-800">{dateFormatted}</div>
                      </td>

                      {/* Project */}
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="font-bold text-slate-700 bg-slate-100 px-2.5 py-1 rounded-lg text-xs">
                          {log.project_name || 'ไอลิน 6'}
                        </span>
                      </td>

                      {/* Plot / Location */}
                      <td className="px-6 py-4">
                        <div className="flex flex-col gap-1">
                          <span className="font-black text-slate-800 text-xs">
                            {log.house_or_plot_name || 'บ้านตัวอย่าง'}
                          </span>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md border w-fit ${plotBadge.color}`}>
                            {plotBadge.label}
                          </span>
                        </div>
                      </td>

                      {/* Routine Type */}
                      <td className="px-6 py-4 whitespace-nowrap">
                        {isEve ? (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-indigo-50 text-indigo-700 border border-indigo-200 shadow-xs">
                            <Moon size={12} className="text-indigo-600" /> รอบเย็น (ปิดบ้าน)
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200 shadow-xs">
                            <Sun size={12} className="text-amber-600" /> รอบเช้า (เปิดบ้าน)
                          </span>
                        )}
                      </td>

                      {/* Inspector */}
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-blue-100 text-blue-700 font-bold text-xs flex items-center justify-center">
                            {(log.agent_name || 'S').charAt(0).toUpperCase()}
                          </div>
                          <span className="font-bold text-slate-800">{log.agent_name || 'เจ้าหน้าที่'}</span>
                        </div>
                      </td>

                      {/* Status / Issues */}
                      <td className="px-6 py-4">
                        {hasIssue ? (
                          <div className="flex flex-col gap-1">
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200 w-fit">
                              <AlertTriangle size={12} /> มีข้อสังเกต
                            </span>
                            <span className="text-xs text-rose-600 line-clamp-1">
                              {log.objections || log.customer_feedback}
                            </span>
                          </div>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <CheckCircle2 size={12} /> ปกติเรียบร้อย
                          </span>
                        )}
                      </td>

                      {/* Checklist Count */}
                      <td className="px-6 py-4 text-center whitespace-nowrap">
                        <span className="font-black text-xs text-slate-700">
                          {passedCount} / {totalKeys} ข้อ
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="px-6 py-4 text-center whitespace-nowrap">
                        <button
                          onClick={() => setSelectedLogDetail(log)}
                          className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5 mx-auto"
                        >
                          <Eye size={14} /> ดู Checklist
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 🌟 5. Log Detail Modal (Checklist Popup) */}
      {selectedLogDetail && (
        <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 animate-fade-in overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-xl w-full shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
            
            {/* Modal Header */}
            <div className="bg-slate-900 text-white p-5 flex items-center justify-between border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div className={`p-2.5 rounded-2xl ${
                  selectedLogDetail.stage === 'daily_routine_evening' ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30' : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                }`}>
                  {selectedLogDetail.stage === 'daily_routine_evening' ? <Moon size={22} /> : <Sun size={22} />}
                </div>
                <div>
                  <h3 className="font-black text-base text-white">
                    {selectedLogDetail.stage === 'daily_routine_evening' ? 'รายละเอียดตรวจรอบเย็น (ปิดบ้าน)' : 'รายละเอียดตรวจรอบเช้า (เปิดบ้าน)'}
                  </h3>
                  <p className="text-xs text-slate-400">
                    {selectedLogDetail.project_name} • {selectedLogDetail.house_or_plot_name}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSelectedLogDetail(null)}
                className="p-2 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-5 overflow-y-auto custom-scrollbar flex-1">
              
              {/* Info Summary */}
              <div className="grid grid-cols-2 gap-3 bg-slate-50 p-4 rounded-2xl border border-slate-100 text-xs">
                <div>
                  <span className="text-slate-400 font-bold block">ผู้ตรวจเช็ค</span>
                  <span className="font-black text-slate-800 text-sm mt-0.5 block">{selectedLogDetail.agent_name || 'เจ้าหน้าที่'}</span>
                </div>
                <div>
                  <span className="text-slate-400 font-bold block">วันและเวลา</span>
                  <span className="font-bold text-slate-700 text-sm mt-0.5 block">
                    {new Date(selectedLogDetail.created_at).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })}
                  </span>
                </div>
              </div>

              {/* Checklist Items */}
              <div>
                <h4 className="font-bold text-xs text-slate-500 uppercase tracking-wider mb-3">
                  รายการตรวจเช็คตามมาตรฐาน SOP
                </h4>
                <div className="space-y-2">
                  {(() => {
                    const isEve = selectedLogDetail.stage === 'daily_routine_evening';
                    const itemsDict = isEve ? EVENING_CHECKLIST_LABELS : MORNING_CHECKLIST_LABELS;
                    const answers = selectedLogDetail.stage_a_checklist || {};

                    return Object.entries(itemsDict).map(([key, label]) => {
                      const isPassed = Boolean(answers[key]);
                      return (
                        <div
                          key={key}
                          className={`p-3 rounded-xl border flex items-center justify-between gap-3 text-xs font-semibold ${
                            isPassed 
                              ? 'bg-emerald-50/50 border-emerald-200 text-slate-800' 
                              : 'bg-slate-50 border-slate-200 text-slate-500'
                          }`}
                        >
                          <span>{label}</span>
                          {isPassed ? (
                            <span className="flex items-center gap-1 text-emerald-600 font-bold bg-emerald-100/80 px-2 py-0.5 rounded-md">
                              <CheckCircle2 size={14} /> ผ่าน
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-slate-400 font-bold bg-slate-200/80 px-2 py-0.5 rounded-md">
                              <XCircle size={14} /> ข้าม
                            </span>
                          )}
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>

              {/* Feedback / Notes */}
              {selectedLogDetail.customer_feedback && (
                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                  <h4 className="font-bold text-xs text-slate-500 uppercase tracking-wider mb-1">
                    หมายเหตุเพิ่มเติม / ข้อสังเกต
                  </h4>
                  <p className="text-xs text-slate-700 leading-relaxed font-medium">
                    {selectedLogDetail.customer_feedback}
                  </p>
                </div>
              )}

            </div>

            {/* Modal Footer */}
            <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-end">
              <button
                onClick={() => setSelectedLogDetail(null)}
                className="px-5 py-2.5 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-bold transition-all shadow-sm"
              >
                ปิดหน้าต่าง
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
