import React, { useState, useMemo } from 'react';
import { 
  X, Calendar, Download, Printer, Search, UserCheck, 
  Clock, CheckCircle, AlertTriangle, ChevronDown, ChevronUp,
  HardHat, ShieldAlert, FileText, Building2, User
} from 'lucide-react';

interface DailyAccountabilityModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedDate: string;
  setSelectedDate: (date: string) => void;
  allUpdatesRecord: any[];
  defects: any[];
  defectUpdates: any[];
  allUsers: any[];
  plots: any[];
  taskTemplates: any[];
  projects: any[];
}

export default function DailyAccountabilityModal({
  isOpen,
  onClose,
  selectedDate,
  setSelectedDate,
  allUpdatesRecord,
  defects,
  defectUpdates,
  allUsers,
  plots,
  taskTemplates,
  projects
}: DailyAccountabilityModalProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | 'Foreman' | 'Site Engineer' | 'QC'>('all');
  const [expandedUser, setExpandedUser] = useState<string | null>(null);

  // Map users for fast O(1) lookup
  const userMap = useMemo(() => {
    const map = new Map<string, any>();
    (allUsers || []).forEach(u => {
      if (u.username) map.set(u.username.toLowerCase(), u);
      if (u.name) map.set(u.name.toLowerCase(), u);
    });
    return map;
  }, [allUsers]);

  // Normalize role
  const getRole = (roleStr?: string, userName?: string): 'Foreman' | 'Site Engineer' | 'QC' | 'Other' => {
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

  // Compile all activities for target date
  const targetActivities = useMemo(() => {
    const list: any[] = [];

    // 1. Task Updates
    (allUpdatesRecord || []).forEach(u => {
      if (new Date(u.created_at).toLocaleDateString('en-CA') === selectedDate && u.role !== 'Admin') {
        const role = getRole(u.role, u.user_name);
        const task = (taskTemplates || []).find(t => t.id === u.task_template_id);
        list.push({
          id: `upd-${u.id}`,
          rawTime: new Date(u.created_at).getTime(),
          timeStr: new Date(u.created_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }),
          user: u.user_name || 'ไม่ระบุชื่อ',
          role,
          plot: u.plot_id,
          taskName: task ? task.task_name : (u.action || 'อัปเดตงาน'),
          action: u.action || 'บันทึกงาน',
          detail: u.text_content || '-',
          progress: u.progress,
          image: extractFirstValidImageUrl(u.image_url || u.images),
          type: 'update'
        });
      }
    });

    // 2. Defects
    (defects || []).forEach(d => {
      if (new Date(d.created_at).toLocaleDateString('en-CA') === selectedDate) {
        const userObj = userMap.get((d.reported_by || '').toLowerCase());
        if (userObj?.role === 'Admin') return;
        const role = getRole(userObj?.role, d.reported_by);
        const task = (taskTemplates || []).find(t => t.id === d.task_id);
        list.push({
          id: `def-${d.id}`,
          rawTime: new Date(d.created_at).getTime(),
          timeStr: new Date(d.created_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }),
          user: d.reported_by || 'ไม่ระบุชื่อ',
          role,
          plot: d.plot_id,
          taskName: task ? task.task_name : 'งานแจ้งซ่อม/Defect',
          action: 'แจ้ง Defect / สั่งแก้ไข',
          detail: d.description || 'แนบรูปภาพจุดบกพร่อง',
          progress: null,
          image: extractFirstValidImageUrl(d.image_url || d.images),
          type: 'defect'
        });
      }
    });

    // Sort descending by time
    return list.sort((a, b) => b.rawTime - a.rawTime);
  }, [allUpdatesRecord, defects, selectedDate, taskTemplates, userMap]);

  // Aggregate by Staff Member
  const staffSummaries = useMemo(() => {
    const map = new Map<string, {
      user: string;
      role: 'Foreman' | 'Site Engineer' | 'QC' | 'Other';
      plots: Set<string>;
      firstTime: number;
      lastTime: number;
      updatesCount: number;
      inspectionsCount: number;
      approvedCount: number;
      reworksCount: number;
      activities: any[];
    }>();

    targetActivities.forEach(act => {
      const key = act.user;
      if (!map.has(key)) {
        map.set(key, {
          user: act.user,
          role: act.role,
          plots: new Set<string>(),
          firstTime: act.rawTime,
          lastTime: act.rawTime,
          updatesCount: 0,
          inspectionsCount: 0,
          approvedCount: 0,
          reworksCount: 0,
          activities: []
        });
      }

      const item = map.get(key)!;
      if (act.plot) item.plots.add(String(act.plot));
      item.firstTime = Math.min(item.firstTime, act.rawTime);
      item.lastTime = Math.max(item.lastTime, act.rawTime);
      item.activities.push(act);

      const actionLower = (act.action || '').toLowerCase();
      if (act.type === 'defect' || actionLower.includes('ตีกลับ') || actionLower.includes('แก้')) {
        item.reworksCount++;
      } else if (actionLower.includes('อนุมัติ') || actionLower.includes('ผ่าน')) {
        item.approvedCount++;
        item.inspectionsCount++;
      } else if (actionLower.includes('ส่ง') || act.progress === 100) {
        item.inspectionsCount++;
      } else {
        item.updatesCount++;
      }
    });

    return Array.from(map.values()).sort((a, b) => b.activities.length - a.activities.length);
  }, [targetActivities]);

  // Filtered staff list
  const filteredStaff = useMemo(() => {
    return staffSummaries.filter(s => {
      const matchRole = roleFilter === 'all' || s.role === roleFilter;
      const matchSearch = searchTerm.trim() === '' || 
        s.user.toLowerCase().includes(searchTerm.toLowerCase()) ||
        Array.from(s.plots).some(p => p.toLowerCase().includes(searchTerm.toLowerCase()));
      return matchRole && matchSearch;
    });
  }, [staffSummaries, roleFilter, searchTerm]);

  // Overall totals
  const totalStaffCount = staffSummaries.length;
  const totalActivitiesCount = targetActivities.length;
  const totalUniquePlotsCount = useMemo(() => {
    const s = new Set<string>();
    targetActivities.forEach(a => { if (a.plot) s.add(String(a.plot)); });
    return s.size;
  }, [targetActivities]);

  // Export CSV Handler
  const handleExportCSV = () => {
    if (staffSummaries.length === 0) {
      alert('ไม่มีข้อมูลสำหรับส่งออกในวันที่เลือก');
      return;
    }

    const headers = ['ชื่อผู้ปฏิบัติงาน', 'ตำแหน่ง', 'จำนวนแปลงที่เข้าตรวจ', 'แปลงที่ตรวจ', 'เวลาเริ่มบันทึกแรก', 'เวลาบันทึกล่าสุด', 'อัปเดตงานทั่วไป', 'ส่งตรวจ/เข้าตรวจ', 'อนุมัติผ่าน', 'สั่งแก้ไข/ตีกลับ', 'รวมกิจกรรม'];
    const rows = staffSummaries.map(s => [
      `"${s.user}"`,
      `"${s.role}"`,
      s.plots.size,
      `"${Array.from(s.plots).join(', ')}"`,
      `"${new Date(s.firstTime).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}"`,
      `"${new Date(s.lastTime).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}"`,
      s.updatesCount,
      s.inspectionsCount,
      s.approvedCount,
      s.reworksCount,
      s.activities.length
    ]);

    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `Daily_Accountability_Report_${selectedDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[999] bg-black/60 backdrop-blur-md flex items-center justify-center p-3 sm:p-6 animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl shadow-2xl max-w-5xl w-full max-h-[92vh] flex flex-col overflow-hidden border border-slate-100">
        
        {/* Modal Header */}
        <div className="p-5 sm:p-6 border-b border-slate-100 bg-slate-50 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-2xl bg-indigo-100 text-indigo-600 flex items-center justify-center font-black">
                <FileText size={20} />
              </div>
              <div>
                <h3 className="text-lg sm:text-xl font-black text-slate-800 tracking-tight">
                  ตารางประเมินการปฏิบัติงานรายบุคคล (Daily Accountability Table)
                </h3>
                <p className="text-xs font-bold text-slate-500 mt-0.5">
                  สรุปผลงานระดับบริหาร • ใช้ประกอบ Morning Standup & การประเมินผลรายวัน
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 self-end sm:self-auto">
            <button
              onClick={handleExportCSV}
              className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold px-3.5 py-2 rounded-xl transition-all shadow-sm flex items-center gap-1.5 cursor-pointer"
            >
              <Download size={14} /> Export CSV
            </button>
            <button
              onClick={() => window.print()}
              className="bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-extrabold px-3 py-2 rounded-xl transition-all shadow-sm flex items-center gap-1.5 cursor-pointer"
            >
              <Printer size={14} /> พิมพ์
            </button>
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-full transition-colors cursor-pointer"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Toolbar & Summary Ribbon */}
        <div className="p-4 sm:p-5 bg-white border-b border-slate-100 flex flex-wrap items-center justify-between gap-4">
          
          {/* Date Picker & Quick Select */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5">
              <Calendar size={15} className="text-slate-500" />
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="bg-transparent text-xs sm:text-sm font-bold text-slate-700 outline-none cursor-pointer"
              />
            </div>
            <button
              onClick={() => setSelectedDate(new Date().toLocaleDateString('en-CA'))}
              className={`text-xs font-extrabold px-2.5 py-1.5 rounded-lg transition-all cursor-pointer ${
                selectedDate === new Date().toLocaleDateString('en-CA') 
                  ? 'bg-indigo-50 text-indigo-600 border border-indigo-200' 
                  : 'text-slate-500 hover:bg-slate-100'
              }`}
            >
              วันนี้
            </button>
          </div>

          {/* Quick Stats Badges */}
          <div className="flex items-center gap-2 text-xs font-bold flex-wrap">
            <div className="bg-slate-100 text-slate-700 px-3 py-1.5 rounded-xl flex items-center gap-1.5">
              <UserCheck size={14} className="text-indigo-600" />
              <span>พนักงาน: <strong>{totalStaffCount}</strong> คน</span>
            </div>
            <div className="bg-blue-50 text-blue-700 px-3 py-1.5 rounded-xl flex items-center gap-1.5">
              <Building2 size={14} className="text-blue-600" />
              <span>แปลงที่เข้าตรวจ: <strong>{totalUniquePlotsCount}</strong> แปลง</span>
            </div>
            <div className="bg-emerald-50 text-emerald-700 px-3 py-1.5 rounded-xl flex items-center gap-1.5">
              <CheckCircle size={14} className="text-emerald-600" />
              <span>กิจกรรมทั้งหมด: <strong>{totalActivitiesCount}</strong> ครั้ง</span>
            </div>
          </div>
        </div>

        {/* Filter & Search Bar */}
        <div className="px-5 py-3 bg-slate-50 border-b border-slate-200/60 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1 bg-white p-1 rounded-xl border border-slate-200 text-xs font-extrabold">
            <button
              onClick={() => setRoleFilter('all')}
              className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${roleFilter === 'all' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
            >
              ทุกคน ({staffSummaries.length})
            </button>
            <button
              onClick={() => setRoleFilter('Foreman')}
              className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${roleFilter === 'Foreman' ? 'bg-amber-500 text-white shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
            >
              👷 โฟร์แมน ({staffSummaries.filter(s => s.role === 'Foreman').length})
            </button>
            <button
              onClick={() => setRoleFilter('Site Engineer')}
              className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${roleFilter === 'Site Engineer' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
            >
              📐 วิศวกร ({staffSummaries.filter(s => s.role === 'Site Engineer').length})
            </button>
            <button
              onClick={() => setRoleFilter('QC')}
              className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${roleFilter === 'QC' ? 'bg-purple-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
            >
              🔍 QC ({staffSummaries.filter(s => s.role === 'QC').length})
            </button>
          </div>

          <div className="relative flex-1 sm:w-56 max-w-xs">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="ค้นหาชื่อพนักงาน หรือ แปลง..."
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-white rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-700 font-medium"
            />
          </div>
        </div>

        {/* Staff Table */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-4 sm:p-6 bg-slate-100/60">
          {filteredStaff.length === 0 ? (
            <div className="bg-white rounded-2xl border border-dashed border-slate-200 p-12 text-center">
              <div className="w-16 h-16 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-3">
                <HardHat size={28} />
              </div>
              <p className="text-slate-500 font-bold text-sm">
                ไม่พบประวัติการบันทึกการปฏิบัติงานในระบบสำหรับวันที่เลือก
              </p>
              <p className="text-xs text-slate-400 mt-1">
                ลองเลือกดูวันที่อื่น หรือตรวจสอบว่ามีการบันทึกงานเข้ามาหรือไม่
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredStaff.map((staff, idx) => {
                const isExpanded = expandedUser === staff.user;
                const firstTimeStr = new Date(staff.firstTime).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
                const lastTimeStr = new Date(staff.lastTime).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });

                return (
                  <div key={idx} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden transition-all hover:border-indigo-200">
                    {/* Summary Row */}
                    <div
                      onClick={() => setExpandedUser(isExpanded ? null : staff.user)}
                      className="p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 cursor-pointer hover:bg-slate-50/70 transition-colors"
                    >
                      {/* Left: User Identity */}
                      <div className="flex items-center gap-3.5 min-w-[220px]">
                        <div className={`w-11 h-11 rounded-2xl flex items-center justify-center font-black text-sm shrink-0 shadow-sm ${
                          staff.role === 'Foreman' ? 'bg-amber-100 text-amber-700' :
                          staff.role === 'Site Engineer' ? 'bg-blue-100 text-blue-700' :
                          staff.role === 'QC' ? 'bg-purple-100 text-purple-700' :
                          'bg-slate-100 text-slate-700'
                        }`}>
                          <User size={20} />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h4 className="font-black text-slate-800 text-sm sm:text-base">
                              {staff.user}
                            </h4>
                            <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md ${
                              staff.role === 'Foreman' ? 'bg-amber-50 text-amber-700 border border-amber-200' :
                              staff.role === 'Site Engineer' ? 'bg-blue-50 text-blue-700 border border-blue-200' :
                              staff.role === 'QC' ? 'bg-purple-50 text-purple-700 border border-purple-200' :
                              'bg-slate-100 text-slate-600'
                            }`}>
                              {staff.role}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 text-xs text-slate-400 font-bold mt-0.5">
                            <Clock size={12} />
                            <span>ช่วงเวลาปฏิบัติงาน: <strong>{firstTimeStr} - {lastTimeStr} น.</strong></span>
                          </div>
                        </div>
                      </div>

                      {/* Middle: Work Breakdown Pills */}
                      <div className="flex flex-wrap items-center gap-2">
                        {/* Plots badge */}
                        <span className="text-xs font-bold bg-slate-100 text-slate-700 px-2.5 py-1 rounded-lg flex items-center gap-1" title="แปลงที่เข้าตรวจ">
                          <Building2 size={13} className="text-slate-500" />
                          <span>{staff.plots.size} แปลง</span>
                        </span>

                        {/* Updates */}
                        {staff.updatesCount > 0 && (
                          <span className="text-xs font-bold bg-blue-50 text-blue-700 px-2.5 py-1 rounded-lg">
                            อัปเดตงาน: {staff.updatesCount}
                          </span>
                        )}

                        {/* Approved */}
                        {staff.approvedCount > 0 && (
                          <span className="text-xs font-bold bg-emerald-50 text-emerald-700 px-2.5 py-1 rounded-lg flex items-center gap-1">
                            <CheckCircle size={13} /> ตรวจผ่าน: {staff.approvedCount}
                          </span>
                        )}

                        {/* Reworks */}
                        {staff.reworksCount > 0 && (
                          <span className="text-xs font-bold bg-rose-50 text-rose-700 px-2.5 py-1 rounded-lg flex items-center gap-1">
                            <ShieldAlert size={13} /> สั่งแก้/Defect: {staff.reworksCount}
                          </span>
                        )}
                      </div>

                      {/* Right: Activity Count & Accordion Toggle */}
                      <div className="flex items-center justify-between md:justify-end gap-3 shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-slate-100">
                        <div className="text-right">
                          <span className="text-sm font-black text-slate-800">
                            {staff.activities.length} กิจกรรม
                          </span>
                          <p className="text-[10px] font-bold text-slate-400">
                            คลิกเพื่อดูบันทึก
                          </p>
                        </div>
                        <div className="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center text-slate-500">
                          {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        </div>
                      </div>
                    </div>

                    {/* Accordion Detail: List of logs for this staff */}
                    {isExpanded && (
                      <div className="border-t border-slate-100 bg-slate-50/50 p-4 sm:p-5">
                        <h5 className="text-xs font-black uppercase text-slate-400 tracking-wider mb-3">
                          ประวัติการบันทึกงานตลอดทั้งวัน ({staff.activities.length} รายการ)
                        </h5>
                        <div className="divide-y divide-slate-200/60 bg-white rounded-xl border border-slate-200 overflow-hidden">
                          {staff.activities.map((act, aIdx) => (
                            <div key={aIdx} className="p-3.5 sm:p-4 flex items-start justify-between gap-3 hover:bg-slate-50 transition-colors">
                              <div className="flex items-start gap-3 min-w-0">
                                <span className="text-xs font-black text-slate-500 bg-slate-100 px-2 py-1 rounded-md shrink-0">
                                  {act.timeStr} น.
                                </span>
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap mb-1">
                                    <span className="text-xs font-black text-slate-800 bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-md">
                                      แปลง {act.plot || '-'}
                                    </span>
                                    <span className={`text-[11px] font-black px-2 py-0.5 rounded-md ${
                                      act.type === 'defect' ? 'bg-rose-100 text-rose-700' :
                                      (act.action || '').includes('ผ่าน') || (act.action || '').includes('อนุมัติ') ? 'bg-emerald-100 text-emerald-700' :
                                      'bg-blue-100 text-blue-700'
                                    }`}>
                                      {act.action}
                                    </span>
                                    {act.progress !== null && act.progress !== undefined && (
                                      <span className="text-[11px] font-bold text-slate-400">
                                        ({act.progress}%)
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-xs font-bold text-slate-700 truncate">
                                    {act.taskName}
                                  </p>
                                  {act.detail && act.detail !== '-' && (
                                    <p className="text-xs font-medium text-slate-500 mt-1 italic line-clamp-2">
                                      "{act.detail}"
                                    </p>
                                  )}
                                </div>
                              </div>

                              {/* Thumbnail (if any) */}
                              {act.image && (
                                <a 
                                  href={act.image} 
                                  target="_blank" 
                                  rel="noopener noreferrer" 
                                  className="shrink-0 group"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <img 
                                    src={act.image} 
                                    alt="แนบรูปถ่าย" 
                                    className="w-12 h-12 object-cover rounded-lg border border-slate-200 group-hover:scale-105 transition-transform" 
                                    onError={(e) => {
                                      (e.currentTarget as HTMLElement).style.display = 'none';
                                    }}
                                  />
                                </a>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 sm:p-5 bg-white border-t border-slate-100 flex justify-between items-center text-xs font-bold text-slate-400">
          <span>แสดงข้อมูลเฉพาะวันที่: {selectedDate}</span>
          <button
            onClick={onClose}
            className="px-5 py-2 bg-slate-100 text-slate-700 hover:bg-slate-200 font-extrabold rounded-xl transition-all cursor-pointer"
          >
            ปิดหน้าต่าง
          </button>
        </div>
      </div>
    </div>
  );
}
