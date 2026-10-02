'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { 
  Building2, Users, Calendar, MapPin, FileText, CheckCircle, 
  ArrowLeft, Bell, Shield, Layers, LayoutDashboard, ChevronRight, X 
} from 'lucide-react';
import { CentralApiError, centralApi, type CentralApi } from '@/lib/sales/centralClient';
import { parseCentralSearchFilters, type CentralSearchSnapshot, type CentralSearchFilters } from '@/lib/sales/centralContracts';
import CentralLeadForm from './CentralLeadForm';
import CentralLeadTracker from './CentralLeadTracker';
import { LeadTrackerHeader } from './LeadTrackerPresentation';
import { EMPTY_TRACKER_FILTERS } from '@/lib/sales/centralTracker';

const SalesKanban = dynamic(() => import('./SalesKanban'));

export default function CentralLeadsView({ 
  api = centralApi, 
  visitsEnabled = false, 
  leadWorkEnabled = false, 
  workScheduleEnabled = false, 
  notificationsEnabled = false, 
  slaPreviewEnabled = false, 
  queueMonitorEnabled = false, 
  bookingEnabled = false, 
  projectSalesEnabled = false, 
  reportsEnabled = projectSalesEnabled 
}: { 
  api?: CentralApi; 
  visitsEnabled?: boolean; 
  leadWorkEnabled?: boolean; 
  workScheduleEnabled?: boolean; 
  notificationsEnabled?: boolean; 
  slaPreviewEnabled?: boolean; 
  queueMonitorEnabled?: boolean; 
  bookingEnabled?: boolean; 
  projectSalesEnabled?: boolean; 
  reportsEnabled?: boolean 
}) {
  const [page, setPage] = useState(0);
  const [revision, setRevision] = useState(0);
  const [activeTab, setActiveTab] = useState<'table' | 'kanban' | 'visits' | 'map' | 'booked' | 'reports'>('table');
  const [state, setState] = useState<{ key: string; api?: CentralApi; data: CentralSearchSnapshot | null; error: Error | null }>({ key: '', data: null, error: null });
  const [filters, setFilters] = useState({ ...EMPTY_TRACKER_FILTERS });
  const [appliedFilters, setAppliedFilters] = useState({ ...EMPTY_TRACKER_FILTERS });
  const [filterError, setFilterError] = useState('');
  const identityEpoch = useRef(0);
  const [formEpoch, setFormEpoch] = useState(0);
  const [showForm, setShowForm] = useState(false);
  const [notice, setNotice] = useState('');
  const key = `${page}:${revision}:${JSON.stringify(appliedFilters)}`;
  const current = state.key === key && state.api === api;
  const snapshot = current ? state.data : null;
  const error = current ? state.error : null;

  useEffect(() => {
    let cancelled = false;
    const epoch = identityEpoch.current;
    api.read(page, appliedFilters).then(data => { if (!cancelled && epoch === identityEpoch.current) setState({ key, api, data, error: null }); })
      .catch(failure => { if (!cancelled && epoch === identityEpoch.current) setState({ key, api, data: null, error: failure instanceof Error ? failure : new Error('โหลดรายการไม่สำเร็จ') }); });
    return () => { cancelled = true; };
  }, [api, page, key, appliedFilters]);

  useEffect(() => api.watchIdentity?.(() => {
    identityEpoch.current += 1;
    setShowForm(false); setNotice('บัญชีเปลี่ยนแล้ว แบบฟอร์มที่ยังไม่ส่งถูกปิด หากเคยส่งคำขอค้าง ให้กลับบัญชีเดิมและเปิดบันทึก Lead ใหม่เพื่อตรวจคำขอเดิม'); setFilterError(''); setFilters({ ...EMPTY_TRACKER_FILTERS });
    setAppliedFilters({ ...EMPTY_TRACKER_FILTERS }); setPage(0); setRevision(n => n + 1);
  }), [api]);

  const applyFilters = (next: CentralSearchFilters) => {
    if (showForm) return;
    try {
      const normalized = parseCentralSearchFilters(next);
      setFilters(normalized); setAppliedFilters(normalized); setPage(0); setFilterError(''); setRevision(n => n + 1);
    } catch (failure) { setFilterError(failure instanceof Error ? failure.message : 'ตัวกรองไม่ถูกต้อง'); }
  };

  const needsLogin = error instanceof CentralApiError && error.status === 401;
  const needsSetup = error instanceof CentralApiError && ['SETUP_REQUIRED', 'FEATURE_DISABLED'].includes(error.code);
  const forbidden = error instanceof CentralApiError && error.status === 403;

  return (
    <main className="min-h-screen bg-slate-50/70 pb-16">
      {/* 🌟 Modern BuildTrack Navigation Header */}
      <header className="sticky top-0 z-30 border-b border-slate-200/90 bg-white/95 backdrop-blur shadow-2xs">
        <div className="mx-auto max-w-screen-2xl px-4 py-3 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-sm font-black">
                <Building2 size={22} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-lg font-black text-slate-900 tracking-tight sm:text-xl">Lead ส่วนกลาง</h1>
                  <span className="rounded-md bg-blue-50 px-2 py-0.5 text-[10px] font-black text-blue-700 border border-blue-100 uppercase">
                    BuildTrack CRM
                  </span>
                </div>
                <p className="text-xs text-slate-500 font-medium">ศูนย์กลางข้อมูลลูกค้าและติดตามงานขายทุกโครงการ</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              {showForm ? (
                <span aria-disabled="true" className="text-xs font-semibold text-slate-400 px-3 py-1.5 rounded-xl border border-slate-200 bg-slate-50">
                  ← กลับ BuildTrack (ปิดแบบฟอร์มก่อน)
                </span>
              ) : (
                <Link href="/" className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 hover:text-blue-700 transition-colors shadow-2xs">
                  <ArrowLeft size={14} /> ← กลับ BuildTrack
                </Link>
              )}

              {snapshot && notificationsEnabled && !showForm && (
                <Link href="/sales-crm/notifications" prefetch={false} className="inline-flex items-center gap-1 rounded-xl border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-100 transition-colors shadow-2xs">
                  <Bell size={13} /> การแจ้งเตือนของฉัน →
                </Link>
              )}

              {snapshot && (
                <span className="hidden sm:inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-100/80 px-2.5 py-1 text-[11px] font-bold text-slate-700">
                  <Shield size={12} className="text-slate-500" />
                  {snapshot.actor.role.toUpperCase()}
                </span>
              )}
            </div>
          </div>

          {/* 🌟 6 Core Navigation Tabs */}
          <div className="mt-3 flex overflow-x-auto border-t border-slate-100 pt-2 gap-1.5 custom-scrollbar">
            <button
              type="button"
              onClick={() => setActiveTab('table')}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${activeTab === 'table' ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'}`}
            >
              📋 ทะเบียน Lead
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('kanban')}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${activeTab === 'kanban' ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'}`}
            >
              📊 กระดาน Pipeline
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('visits')}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${activeTab === 'visits' ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'}`}
            >
              📅 ตารางนัดเข้าชม
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('map')}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${activeTab === 'map' ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'}`}
            >
              🗺️ ผังแปลงโครงการ
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('booked')}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${activeTab === 'booked' ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'}`}
            >
              📑 ลูกค้าจอง & รอโอน
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('reports')}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${activeTab === 'reports' ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'}`}
            >
              📈 สรุปยอดขาย
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-screen-2xl px-4 py-5 sm:px-6 space-y-4">
        {/* Active Tab View Rendering */}
        {activeTab !== 'table' ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm overflow-hidden min-h-[600px]">
            <SalesKanban initialTab={
              activeTab === 'kanban' ? 'list' : 
              activeTab === 'visits' ? 'daily_visits' : 
              activeTab === 'map' ? 'map' : 
              activeTab === 'booked' ? 'booked' : 'reports'
            } />
          </div>
        ) : (
          <>
            <LeadTrackerHeader subtitle="ลูกค้าคนเดียว · สนใจได้หลายโครงการ · เก็บประวัติต่อเนื่อง" actions={
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" disabled={!snapshot || snapshot.actor.role === 'owner' || showForm}
                  onClick={() => { setNotice(''); setFormEpoch(identityEpoch.current); setShowForm(true); }} className="rounded-xl bg-blue-700 hover:bg-blue-800 text-white px-5 py-2.5 text-xs font-black shadow-sm disabled:opacity-40 transition-colors flex items-center gap-1.5">
                  + บันทึก Lead ใหม่
                </button>
              </div>
            } />

            {notice && <p role="status" className="rounded-xl bg-emerald-50 border border-emerald-200 p-4 text-xs font-bold text-emerald-800 flex items-center gap-2 animate-in fade-in"><CheckCircle size={16} /> {notice}</p>}
            {!current && <p role="status" className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-500 font-medium">กำลังตรวจสิทธิ์และโหลดข้อมูล…</p>}
            {error && <section className="rounded-2xl border border-amber-200 bg-amber-50 p-6 space-y-3">
              <h2 className="font-bold text-lg text-amber-950">{needsLogin ? 'เข้าสู่ระบบก่อนใช้งาน' : needsSetup ? 'ยังไม่เปิดการบันทึก Lead ส่วนกลาง' : forbidden ? 'บัญชีนี้ยังไม่มีสิทธิ์ใช้งาน' : 'โหลดรายการ Lead ไม่สำเร็จ'}</h2>
              <p role="alert" className="text-sm text-amber-900">{error.message}</p>
              {needsSetup && <p className="text-sm text-amber-900">หน้านี้ไม่สร้างข้อมูลลงระบบเก่าแทนเมื่อระบบใหม่ยังไม่พร้อม ต้องตรวจข้อมูลเดิม ติดตั้งฐานข้อมูล และยืนยันสิทธิ์ก่อนเปิดใช้</p>}
              <div className="flex flex-wrap gap-4 text-sm items-center">
                <button type="button" onClick={() => setRevision(n => n + 1)} className="font-semibold underline">ตรวจสอบอีกครั้ง</button>
                <button type="button" onClick={() => setActiveTab('kanban')} className="font-bold text-blue-700 bg-white px-3 py-1.5 rounded-lg border border-blue-200 shadow-sm">📊 เปิดกระดาน Pipeline (Sales Kanban) แทน →</button>
                <Link href="/" className="underline">กลับหน้าหลัก{needsLogin ? 'เพื่อเข้าสู่ระบบ' : ''}</Link>
              </div>
            </section>}

            {snapshot && <>
              {/* 🌟 Sales Quick Navigation Pills */}
              {!showForm && (
                <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200/90 bg-white p-3 shadow-2xs">
                  <span className="text-xs font-bold text-slate-500 mr-1 flex items-center gap-1"><Layers size={14} /> ทางลัดงานขาย:</span>
                  {projectSalesEnabled && <Link href="/sales-crm/projects/map" prefetch={false} className="rounded-lg border border-indigo-200 bg-indigo-50/80 hover:bg-indigo-100 px-3 py-1.5 text-xs font-bold text-indigo-800 transition-colors">ผังแปลงทุกโครงการ →</Link>}
                  {projectSalesEnabled && <Link href="/sales-crm/projects" prefetch={false} className="rounded-lg border border-blue-200 bg-blue-50/80 hover:bg-blue-100 px-3 py-1.5 text-xs font-bold text-blue-800 transition-colors">ลูกค้าจองและประวัติแยกโครงการ →</Link>}
                  {reportsEnabled && <Link href="/sales-crm/reports" prefetch={false} className="rounded-lg border border-slate-200 bg-white hover:bg-slate-50 px-3 py-1.5 text-xs font-bold text-blue-800 transition-colors">รายงานจองจากส่วนกลาง →</Link>}
                  {bookingEnabled && snapshot.actor.role !== 'owner' && <Link href="/sales-crm/bookings" prefetch={false} className="rounded-lg border border-orange-200 bg-orange-50/80 hover:bg-orange-100 px-3 py-1.5 text-xs font-bold text-orange-800 transition-colors">ลูกค้ามาจองเลย: ค้นหา / สร้าง Lead พร้อมจอง →</Link>}
                </div>
              )}

              {/* 🌟 Admin Tools Panel (เฉพาะ Admin) */}
              {!showForm && snapshot.actor.role === 'admin' && (queueMonitorEnabled || slaPreviewEnabled || workScheduleEnabled) && (
                <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50/80 p-3 text-xs">
                  <span className="font-bold text-slate-600 flex items-center gap-1"><Shield size={14} className="text-blue-600" /> เครื่องมือผู้ดูแล (Admin):</span>
                  {queueMonitorEnabled && <Link href="/sales-crm/queue-monitor" prefetch={false} className="rounded-lg border border-slate-300 bg-white hover:bg-slate-100 px-2.5 py-1 text-xs font-bold text-blue-700 transition-colors">ตรวจคิวแจ้งเตือน (Admin) →</Link>}
                  {slaPreviewEnabled && <Link href="/sales-crm/sla-processing" prefetch={false} className="rounded-lg border border-slate-300 bg-white hover:bg-slate-100 px-2.5 py-1 text-xs font-bold text-blue-700 transition-colors">ประมวลผลและตรวจใบรับ (Admin) →</Link>}
                  {slaPreviewEnabled && <Link href="/sales-crm/sla-preview" prefetch={false} className="rounded-lg border border-slate-300 bg-white hover:bg-slate-100 px-2.5 py-1 text-xs font-bold text-blue-700 transition-colors">ตรวจแผนแจ้งเตือน (Admin) →</Link>}
                  {workScheduleEnabled && <Link href="/sales-crm/work-schedule" prefetch={false} className="rounded-lg border border-slate-300 bg-white hover:bg-slate-100 px-2.5 py-1 text-xs font-bold text-blue-700 transition-colors">จัดเวรฝ่ายขาย (Admin) →</Link>}
                </div>
              )}

              {snapshot.actor.role === 'owner' && <p className="text-xs text-slate-500 font-medium px-1">สิทธิ์ Owner: อ่านข้อมูลทุกโครงการ ไม่มีสิทธิ์สร้างหรือแก้ Lead</p>}

              {/* 🌟 Modal Dialog for "+ บันทึก Lead ใหม่" */}
              {showForm && (
                <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-200">
                  <div className="w-full max-w-2xl bg-white rounded-3xl shadow-2xl p-6 sm:p-8 animate-in zoom-in-95 duration-200 space-y-4">
                    <CentralLeadForm snapshot={snapshot} save={api.create} onClose={() => setShowForm(false)} onSaved={() => {
                      if (formEpoch !== identityEpoch.current) return;
                      setShowForm(false); setNotice('บันทึก Lead ส่วนกลางแล้ว ผู้ดูแลและโครงการที่สนใจถูกบันทึกในคำขอเดียวกัน'); setFilters({ ...EMPTY_TRACKER_FILTERS }); setAppliedFilters({ ...EMPTY_TRACKER_FILTERS }); setPage(0); setRevision(n => n + 1);
                    }} />
                  </div>
                </div>
              )}

              <section>
                {filterError && <p role="alert" className="mb-3 text-xs font-bold text-red-700">{filterError}</p>}
                <CentralLeadTracker snapshot={snapshot} filters={filters} onFilterChange={setFilters} onApply={applyFilters} visitsEnabled={visitsEnabled} leadWorkEnabled={leadWorkEnabled} bookingEnabled={bookingEnabled} disabled={showForm} />
                <div className="border-t border-slate-200 p-4 flex items-center justify-between text-xs font-bold text-slate-700">
                  <button type="button" disabled={page === 0 || showForm} onClick={() => setPage(n => n - 1)} className="rounded-xl border border-slate-200 bg-white hover:bg-slate-50 px-3 py-1.5 disabled:opacity-30 transition-colors">← ก่อนหน้า</button>
                  <span className="text-slate-500 font-medium">หน้า {page + 1} · หน้าละ 50 รายการ</span>
                  <button type="button" disabled={!snapshot.hasMore || showForm} onClick={() => setPage(n => n + 1)} className="rounded-xl border border-slate-200 bg-white hover:bg-slate-50 px-3 py-1.5 disabled:opacity-30 transition-colors">ถัดไป →</button>
                </div>
              </section>
            </>}
          </>
        )}
      </div>
    </main>
  );
}
