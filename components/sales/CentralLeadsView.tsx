'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { CentralApiError, centralApi, type CentralApi } from '@/lib/sales/centralClient';
import { parseCentralSearchFilters, type CentralSearchSnapshot, type CentralSearchFilters } from '@/lib/sales/centralContracts';
import CentralLeadForm from './CentralLeadForm';
import CentralLeadTracker from './CentralLeadTracker';
import { LeadTrackerHeader } from './LeadTrackerPresentation';
import { EMPTY_TRACKER_FILTERS } from '@/lib/sales/centralTracker';

export default function CentralLeadsView({ api = centralApi, leadWorkEnabled = false, workScheduleEnabled = false, notificationsEnabled = false, slaPreviewEnabled = false, queueMonitorEnabled = false, bookingEnabled = false, projectSalesEnabled = false, reportsEnabled = projectSalesEnabled }: { api?: CentralApi; leadWorkEnabled?: boolean; workScheduleEnabled?: boolean; notificationsEnabled?: boolean; slaPreviewEnabled?: boolean; queueMonitorEnabled?: boolean; bookingEnabled?: boolean; projectSalesEnabled?: boolean; reportsEnabled?: boolean }) {
  const [page, setPage] = useState(0);
  const [revision, setRevision] = useState(0);
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
    <main className="min-h-screen bg-slate-50 px-4 py-6 sm:px-8 sm:py-10">
      <div className="mx-auto max-w-screen-2xl space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>{showForm ? <span aria-disabled="true" className="text-sm text-slate-400">← กลับ BuildTrack (ปิดแบบฟอร์มก่อน)</span>
            : <Link href="/" className="text-sm text-blue-700 hover:underline">← กลับ BuildTrack</Link>}
            <h1 className="mt-3 text-2xl sm:text-3xl font-bold text-slate-900">Lead ส่วนกลาง</h1>
            <p className="mt-2 text-sm text-slate-500">รับ Lead และติดตามทุกโครงการจากหน้าเดียว · เมื่อจองจึงเชื่อมลูกค้าคนเดิมกับแปลงในโครงการ</p></div>
        </div>
        <LeadTrackerHeader subtitle="ลูกค้าคนเดียว · สนใจได้หลายโครงการ · เก็บประวัติต่อเนื่อง" actions={
          <button type="button" disabled={!snapshot || snapshot.actor.role === 'owner' || showForm}
            onClick={() => { setNotice(''); setFormEpoch(identityEpoch.current); setShowForm(true); }} className="rounded-xl bg-blue-700 text-white px-5 py-3 text-sm font-semibold disabled:opacity-40">+ บันทึก Lead ใหม่</button>
        } />
        {notice && <p role="status" className="rounded-xl bg-emerald-50 border border-emerald-200 p-4 text-sm text-emerald-800">{notice}</p>}
        {!current && <p role="status" className="rounded-2xl border border-slate-200 bg-white p-8 text-slate-500">กำลังตรวจสิทธิ์และโหลดข้อมูล…</p>}
        {error && <section className="rounded-2xl border border-amber-200 bg-amber-50 p-6 space-y-3">
          <h2 className="font-bold text-lg text-amber-950">{needsLogin ? 'เข้าสู่ระบบก่อนใช้งาน' : needsSetup ? 'ยังไม่เปิดการบันทึก Lead ส่วนกลาง' : forbidden ? 'บัญชีนี้ยังไม่มีสิทธิ์ใช้งาน' : 'โหลดรายการ Lead ไม่สำเร็จ'}</h2>
          <p role="alert" className="text-sm text-amber-900">{error.message}</p>
          {needsSetup && <p className="text-sm text-amber-900">หน้านี้ไม่สร้างข้อมูลลงระบบเก่าแทนเมื่อระบบใหม่ยังไม่พร้อม ต้องตรวจข้อมูลเดิม ติดตั้งฐานข้อมูล และยืนยันสิทธิ์ก่อนเปิดใช้</p>}
          <div className="flex gap-4 text-sm"><button type="button" onClick={() => setRevision(n => n + 1)} className="font-semibold underline">ตรวจสอบอีกครั้ง</button>
            <Link href="/" className="underline">กลับหน้าหลัก{needsLogin ? 'เพื่อเข้าสู่ระบบ' : ''}</Link></div>
        </section>}
        {snapshot && <>
          {projectSalesEnabled && !showForm && <Link href="/sales-crm/projects" prefetch={false} className="inline-block rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-semibold text-blue-800">ลูกค้าจองและประวัติแยกโครงการ →</Link>}
          {reportsEnabled && !showForm && <Link href="/sales-crm/reports" prefetch={false} className="inline-block rounded-xl border border-blue-200 bg-white px-4 py-2.5 text-sm font-semibold text-blue-800">รายงานจองจากส่วนกลาง →</Link>}
          {bookingEnabled && snapshot.actor.role !== 'owner' && !showForm && <Link href="/sales-crm/bookings" prefetch={false} className="inline-block rounded-xl border border-orange-200 bg-orange-50 px-4 py-2.5 text-sm font-semibold text-orange-800">ลูกค้ามาจองเลย: ค้นหา / สร้าง Lead พร้อมจอง →</Link>}
          {queueMonitorEnabled && snapshot.actor.role === 'admin' && !showForm && <Link href="/sales-crm/queue-monitor" prefetch={false} className="inline-block rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-blue-700">ตรวจคิวแจ้งเตือน (Admin) →</Link>}
          {slaPreviewEnabled && snapshot.actor.role === 'admin' && !showForm && <Link href="/sales-crm/sla-processing" prefetch={false} className="inline-block rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-blue-700">ประมวลผลและตรวจใบรับ (Admin) →</Link>}
          {slaPreviewEnabled && snapshot.actor.role === 'admin' && !showForm && <Link href="/sales-crm/sla-preview" prefetch={false} className="inline-block rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-blue-700">ตรวจแผนแจ้งเตือน (Admin) →</Link>}
          {notificationsEnabled && !showForm && <Link href="/sales-crm/notifications" prefetch={false} className="inline-block rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-blue-700">การแจ้งเตือนของฉัน →</Link>}
          {workScheduleEnabled && snapshot.actor.role === 'admin' && !showForm && <Link href="/sales-crm/work-schedule" prefetch={false} className="inline-block rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-blue-700">จัดเวรฝ่ายขาย (Admin) →</Link>}
          {snapshot.actor.role === 'owner' && <p className="text-sm text-slate-600">สิทธิ์ Owner: อ่านข้อมูลทุกโครงการ ไม่มีสิทธิ์สร้างหรือแก้ Lead</p>}
          {showForm && <CentralLeadForm snapshot={snapshot} save={api.create} onClose={() => setShowForm(false)} onSaved={() => {
            if (formEpoch !== identityEpoch.current) return;
            setShowForm(false); setNotice('บันทึก Lead ส่วนกลางแล้ว ผู้ดูแลและโครงการที่สนใจถูกบันทึกในคำขอเดียวกัน'); setFilters({ ...EMPTY_TRACKER_FILTERS }); setAppliedFilters({ ...EMPTY_TRACKER_FILTERS }); setPage(0); setRevision(n => n + 1);
          }} />}
          <section>
            {filterError && <p role="alert" className="mb-3 text-sm text-red-700">{filterError}</p>}
            <CentralLeadTracker snapshot={snapshot} filters={filters} onFilterChange={setFilters} onApply={applyFilters} leadWorkEnabled={leadWorkEnabled} bookingEnabled={bookingEnabled} disabled={showForm} />
            <div className="border-t border-slate-200 p-4 flex items-center justify-between text-sm">
              <button type="button" disabled={page === 0 || showForm} onClick={() => setPage(n => n - 1)} className="disabled:opacity-30">← ก่อนหน้า</button>
              <span className="text-slate-500">หน้า {page + 1} · หน้าละ 50 รายการ</span>
              <button type="button" disabled={!snapshot.hasMore || showForm} onClick={() => setPage(n => n + 1)} className="disabled:opacity-30">ถัดไป →</button>
            </div>
          </section>
        </>}
      </div>
    </main>
  );
}
