'use client';
import React, { useState, useEffect } from 'react';
import { LayoutDashboard, ClipboardList, Home, PieChart, BarChartHorizontal, TrendingUp, Building2, Users, Lightbulb, Grid, Calendar, Activity, ShieldAlert, PlusCircle, MapIcon, Building, DollarSign, Monitor, FileSpreadsheet, Wrench, FolderOpen, Smartphone, ChevronRight, Gift, CalendarDays } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import Link from 'next/link';

const Sidebar = React.memo(({
  activeView,
  setView,
  setSelectedProject,
  isAdmin,
  isOwner,
  isSiteEngineer,
  isProjectPlanner,
  isQC,
  isForeman,
  isSales,
  isProcurement,
  isStore,
  isMobilePreview,
  setIsMobilePreview,
  isMobileLayout
}: any) => {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(true);
  const [todayVisitsCount, setTodayVisitsCount] = useState<number>(0);

  useEffect(() => {
    if (!isSales && !isAdmin && !isOwner) return;
    const fetchTodayVisits = async () => {
      try {
        const today = new Date();
        const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        const { data } = await supabase
          .from('leads')
          .select('id, appointment_date, actual_visit_date, crm_status, status');
        
        if (data) {
          const count = data.filter(l => {
            if (!l.appointment_date || l.actual_visit_date) return false;
            if (l.crm_status?.includes('Lost') || l.status === 'Cancelled') return false;
            const d = new Date(l.appointment_date);
            if (isNaN(d.getTime())) return false;
            const dStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            return dStr === todayStr;
          }).length;
          setTodayVisitsCount(count);
        }
      } catch (e) {
        // silent fallback
      }
    };
    fetchTodayVisits();
  }, [isSales, isAdmin, isOwner]);

  return (
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

            <div className={`flex-1 overflow-y-auto dark-scrollbar p-8 pb-4 ${isSidebarCollapsed ? 'px-4' : ''}`}>
              <div className={`flex items-center mb-10 text-white cursor-pointer hover:scale-105 transition-transform shrink-0 ${isSidebarCollapsed ? 'justify-center gap-0' : 'gap-3'}`} onClick={() => { setView('dashboard'); setSelectedProject(null); }}>
                <div className="bg-blue-600 p-2 rounded-xl shadow-lg shadow-blue-500/50 shrink-0"><LayoutDashboard size={28} /></div>
                {!isSidebarCollapsed && <h1 className="font-black text-2xl tracking-tighter uppercase italic">BuildTrack</h1>}
              </div>

              <div className="space-y-6">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-3 px-2">Overview</p>
                    <nav className="space-y-1">
                      {/* 📜 เมนูแรกสุด: ไทม์ไลน์รวมหน้าไซต์ (สำหรับ Owner และ Admin) */}
                      {(isAdmin || isOwner || isSiteEngineer) && (
                        <button onClick={() => setView('global-feed')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold transition-all ${activeView === 'global-feed' ? 'bg-blue-600 text-white shadow-md' : 'hover:bg-slate-800 hover:text-white'}`}><ClipboardList size={18} /> Live Feed หน้าไซต์</button>
                      )}
                      <button onClick={() => { setView('dashboard'); setSelectedProject(null); }} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold transition-all ${activeView === 'dashboard' ? 'bg-blue-600 text-white shadow-md' : 'hover:bg-slate-800 hover:text-white'}`}><Home size={18} /> Dashboard</button>
                      {(isAdmin || isProjectPlanner || isQC || isSiteEngineer || isOwner || isForeman) && (
                        <button onClick={() => setView('reports')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold transition-all ${activeView === 'reports' ? 'bg-blue-600 text-white shadow-md' : 'hover:bg-slate-800 hover:text-white'}`}><PieChart size={18} /> Reports & Analytics</button>
                      )}
                    </nav>
                  </div>

                  {/* SALES & CRM */}
                  {(isAdmin || isOwner || isSales) && (
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-3 px-2">Sales & CRM</p>
                      <nav className="space-y-1">
                          <Link href="/sales-crm" title="Lead ส่วนกลาง (เตรียมเปิดใช้)" aria-label="Lead ส่วนกลาง (เตรียมเปิดใช้)"
                            className={`w-full flex items-center gap-3 py-3 rounded-xl font-bold hover:bg-slate-800 hover:text-[#d4af37] ${isSidebarCollapsed ? 'justify-center px-0' : 'px-4'}`}>
                            <Users size={18} />{!isSidebarCollapsed && <span>Lead ส่วนกลาง <span className="text-[10px] text-slate-500">เตรียมเปิดใช้</span></span>}
                          </Link>
                          <button 
                            onClick={() => setView('sales-daily-visits')} 
                            className={`w-full flex items-center justify-between px-4 py-3 rounded-xl font-bold transition-all ${activeView === 'sales-daily-visits' ? 'bg-[#d4af37] text-white shadow-md' : 'hover:bg-slate-800 hover:text-[#d4af37]'}`}
                          >
                            <div className="flex items-center gap-3">
                              <CalendarDays size={18} /> 
                              <span>ตารางนัดเข้าชม (Visits)</span>
                            </div>
                            {todayVisitsCount > 0 && (
                              <span className="bg-rose-500 text-white text-[10px] font-black px-2 py-0.5 rounded-full animate-pulse shadow-sm">
                                {todayVisitsCount}
                              </span>
                            )}
                          </button>
                          <button onClick={() => setView('sales-dashboard-excel')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold transition-all ${activeView === 'sales-dashboard-excel' ? 'bg-[#d4af37] text-white shadow-md' : 'hover:bg-slate-800 hover:text-[#d4af37]'}`}><BarChartHorizontal size={18} /> Dashboard (Excel)</button>
                          <button onClick={() => setView('sales-dashboard')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold transition-all ${activeView === 'sales-dashboard' ? 'bg-[#d4af37] text-white shadow-md' : 'hover:bg-slate-800 hover:text-[#d4af37]'}`}><LayoutDashboard size={18} /> ระบบฝ่ายขาย (Kanban)</button>
                          <button onClick={() => setView('sales-reports')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold transition-all ${activeView === 'sales-reports' ? 'bg-[#d4af37] text-white shadow-md' : 'hover:bg-slate-800 hover:text-[#d4af37]'}`}><TrendingUp size={18} /> รายงานสรุปยอด (Sales)</button>
                          <button onClick={() => setView('sales-summary-table')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold transition-all ${activeView === 'sales-summary-table' ? 'bg-[#d4af37] text-white shadow-md' : 'hover:bg-slate-800 hover:text-[#d4af37]'}`}><Building2 size={18} /> ตารางสรุปฝั่งขาย</button>
                          {/* 🎁 ของแถมโครงการ (Promotions) - เฉพาะ Admin & Sales */}
                          {(isAdmin || isSales) && (
                            <button onClick={() => setView('sales-promotions')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold transition-all ${activeView === 'sales-promotions' ? 'bg-[#d4af37] text-white shadow-md' : 'hover:bg-slate-800 hover:text-[#d4af37]'}`}><Gift size={18} /> ของแถมโครงการ (Promotions)</button>
                          )}
                          <button onClick={() => setView('agent-performance')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold transition-all ${activeView === 'agent-performance' ? 'bg-[#d4af37] text-white shadow-md' : 'hover:bg-slate-800 hover:text-[#d4af37]'}`}><Users size={18} /> สรุปผลงานเซลล์</button>
                          <button onClick={() => setView('sales-intelligence')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold transition-all ${activeView === 'sales-intelligence' ? 'bg-[#d4af37] text-white shadow-md' : 'hover:bg-slate-800 hover:text-[#d4af37]'}`}><Lightbulb size={18} /> Strategic Report</button>
                      </nav>
                    </div>
                  )}

                  {(isAdmin || isProjectPlanner || isOwner || isQC || isSiteEngineer || isForeman) && (
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-3 px-2">Planning & Schedule</p>
                      <nav className="space-y-1">
                        {(isAdmin || isProjectPlanner || isOwner) && (
                          <button onClick={() => setView('master-gantt')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold transition-all ${activeView === 'master-gantt' ? 'bg-blue-600 text-white shadow-md' : 'hover:bg-slate-800 hover:text-white'}`}><Grid size={18} /> Master Gantt Chart</button>
                        )}
                        {(isAdmin || isProjectPlanner || isQC || isSiteEngineer || isOwner || isForeman) && (
                          <button onClick={() => setView('contractor-schedule')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold transition-all ${activeView === 'contractor-schedule' ? 'bg-blue-600 text-white shadow-md' : 'hover:bg-slate-800 hover:text-white'}`}><Calendar size={18} /> แผนงานผู้รับเหมา</button>
                        )}
                      </nav>
                    </div>
                  )}

                  {(isAdmin || isQC || isSiteEngineer || isOwner || isForeman || isProjectPlanner || isProcurement) && (
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-3 px-2">Quality Control</p>
                      <nav className="space-y-1">
                        {(isAdmin || isOwner || isProjectPlanner || isQC || isSiteEngineer || isProcurement) && (
                          <button onClick={() => setView('qc-performance')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold transition-all ${activeView === 'qc-performance' ? 'bg-rose-600 text-white shadow-md' : 'hover:bg-slate-800 hover:text-white'}`}><Activity size={18} /> ประเมินผล QC</button>
                        )}
                        {(isAdmin || isQC || isSiteEngineer || isOwner || isForeman) && (
                          <button onClick={() => setView('defects')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold transition-all ${activeView === 'defects' ? 'bg-blue-600 text-white shadow-md' : 'hover:bg-slate-800 hover:text-white'}`}><ShieldAlert size={18} /> Defect Tracking</button>
                        )}
                      </nav>
                    </div>
                  )}
                </div>

                {(isAdmin || isProcurement || isStore) && (
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
                        <>
                          <button onClick={() => setView('billing-queue')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold transition-all ${activeView === 'billing-queue' ? 'bg-indigo-600 text-white shadow-md' : 'hover:bg-slate-800 hover:text-white'}`}><FileSpreadsheet size={18} /> คิวตั้งเบิก (Billing Queue)</button>
                          <button onClick={() => setView('procurement-contractors')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold transition-all ${activeView === 'procurement-contractors' ? 'bg-emerald-600 text-white shadow-md' : 'hover:bg-slate-800 hover:text-white'}`}><Wrench size={18} /> จัดการรายชื่อช่าง</button>
                          <button onClick={() => setView('procurement-dashboard')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold transition-all ${activeView === 'procurement-dashboard' ? 'bg-emerald-600 text-white shadow-md' : 'hover:bg-slate-800 hover:text-white'}`}><Users size={18} /> ระบุช่างแบบรวดเร็ว</button>
                        </>
                      )}
                      {(isAdmin || isStore) && (
                        <button onClick={() => setView('store-dashboard')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold transition-all ${activeView === 'store-dashboard' ? 'bg-blue-600 text-white shadow-md' : 'hover:bg-slate-800 hover:text-white'}`}><FolderOpen size={18} /> เบิกจ่ายวัสดุ (Store)</button>
                      )}
                    </nav>
                  </div>
                )}
              </div>

            <div className="p-8 pt-4 mt-auto">
              {isAdmin && (
                <button onClick={() => setIsMobilePreview(!isMobilePreview)} className="w-full flex items-center justify-center gap-2 p-3 bg-slate-800 rounded-xl font-bold text-xs text-slate-400 hover:text-white hover:bg-slate-700 transition-colors">
                  <Smartphone size={16} /> จำลองมือถือ (Mobile View)
                </button>
              )}
            </div>
    </aside>

  );
});

export default Sidebar;
