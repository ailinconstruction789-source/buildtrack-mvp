'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { CentralApiError, centralApi, type CentralApi } from '@/lib/sales/centralClient';
import type { CentralSnapshot } from '@/lib/sales/centralContracts';
import CentralLeadForm from './CentralLeadForm';

export default function CentralLeadsView({ api = centralApi, leadWorkEnabled = false, workScheduleEnabled = false, notificationsEnabled = false, slaPreviewEnabled = false }: { api?: CentralApi; leadWorkEnabled?: boolean; workScheduleEnabled?: boolean; notificationsEnabled?: boolean; slaPreviewEnabled?: boolean }) {
  const [page, setPage] = useState(0);
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{ key: string; data: CentralSnapshot | null; error: Error | null }>({ key: '', data: null, error: null });
  const [tab, setTab] = useState<'all' | 'waiting'>('waiting');
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [notice, setNotice] = useState('');
  const key = `${page}:${revision}`;
  const current = state.key === key;
  const snapshot = current ? state.data : null;
  const error = current ? state.error : null;

  useEffect(() => {
    let cancelled = false;
    api.read(page).then(data => { if (!cancelled) setState({ key, data, error: null }); })
      .catch(failure => { if (!cancelled) setState({ key, data: null, error: failure instanceof Error ? failure : new Error('โหลดรายการไม่สำเร็จ') }); });
    return () => { cancelled = true; };
  }, [api, page, key]);

  const visible = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return (snapshot?.customers || []).filter(customer => {
      const waiting = !customer.interests.length || customer.interests.some(interest => interest.workspaceState === 'central_interest');
      return (tab === 'all' || waiting) && (!query || `${customer.name} ${customer.phone ?? ''}`.toLocaleLowerCase().includes(query));
    });
  }, [snapshot, tab, search]);
  const ownerName = (id: string) => snapshot?.salesOwners.find(owner => owner.userId === id)?.displayName || id;
  const needsLogin = error instanceof CentralApiError && error.status === 401;
  const needsSetup = error instanceof CentralApiError && ['SETUP_REQUIRED', 'FEATURE_DISABLED'].includes(error.code);
  const forbidden = error instanceof CentralApiError && error.status === 403;

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 sm:px-8 sm:py-10">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><Link href="/" className="text-sm text-blue-700 hover:underline">← กลับ BuildTrack</Link>
            <h1 className="mt-3 text-2xl sm:text-3xl font-bold text-slate-900">Lead ส่วนกลาง</h1>
            <p className="mt-2 text-sm text-slate-500">รับลูกค้าครั้งเดียว แล้วดูแลความสนใจแยกตามโครงการ</p></div>
          <button type="button" disabled={!snapshot || snapshot.actor.role === 'owner' || showForm}
            onClick={() => { setNotice(''); setShowForm(true); }} className="rounded-xl bg-blue-700 text-white px-5 py-3 text-sm font-semibold disabled:opacity-40">+ บันทึก Lead ใหม่</button>
        </div>
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
          {slaPreviewEnabled && snapshot.actor.role === 'admin' && !showForm && <Link href="/sales-crm/sla-processing" prefetch={false} className="inline-block rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-blue-700">ประมวลผลและตรวจใบรับ (Admin) →</Link>}
          {slaPreviewEnabled && snapshot.actor.role === 'admin' && !showForm && <Link href="/sales-crm/sla-preview" prefetch={false} className="inline-block rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-blue-700">ตรวจแผนแจ้งเตือน (Admin) →</Link>}
          {notificationsEnabled && !showForm && <Link href="/sales-crm/notifications" prefetch={false} className="inline-block rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-blue-700">การแจ้งเตือนของฉัน →</Link>}
          {workScheduleEnabled && snapshot.actor.role === 'admin' && !showForm && <Link href="/sales-crm/work-schedule" prefetch={false} className="inline-block rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-blue-700">จัดเวรฝ่ายขาย (Admin) →</Link>}
          {snapshot.actor.role === 'owner' && <p className="text-sm text-slate-600">สิทธิ์ Owner: อ่านข้อมูลทุกโครงการ ไม่มีสิทธิ์สร้างหรือแก้ Lead</p>}
          {showForm && <CentralLeadForm snapshot={snapshot} save={api.create} onClose={() => setShowForm(false)} onSaved={() => {
            setShowForm(false); setNotice('บันทึก Lead ส่วนกลางแล้ว ผู้ดูแลและโครงการที่สนใจถูกบันทึกในคำขอเดียวกัน'); setPage(0); setRevision(n => n + 1);
          }} />}
          <section className="rounded-2xl bg-white border border-slate-200 overflow-hidden">
            <div className="p-4 flex flex-wrap gap-3 items-center border-b border-slate-200">
              <div className="flex rounded-xl bg-slate-100 p-1" role="group" aria-label="ประเภทลูกค้า">
                <button type="button" aria-pressed={tab === 'waiting'} onClick={() => setTab('waiting')} className={`rounded-lg px-3 py-2 text-sm ${tab === 'waiting' ? 'bg-white shadow-sm font-semibold' : ''}`}>รอเข้าโครงการ</button>
                <button type="button" aria-pressed={tab === 'all'} onClick={() => setTab('all')} className={`rounded-lg px-3 py-2 text-sm ${tab === 'all' ? 'bg-white shadow-sm font-semibold' : ''}`}>ลูกค้าทั้งหมด</button>
              </div>
              <input aria-label="ค้นหาลูกค้าในหน้านี้" value={search} onChange={event => setSearch(event.target.value)} placeholder="ค้นหาชื่อหรือเบอร์ในหน้านี้…"
                className="min-w-0 flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500" />
              <span className="text-xs text-slate-500">แสดง {visible.length} จาก {snapshot.customers.length} รายการในหน้านี้</span>
            </div>
            <div className="overflow-x-auto"><table className="w-full text-sm text-left">
              <thead className="bg-slate-50 text-slate-500"><tr>{['ลูกค้า', 'วันที่เป็น Lead', 'โครงการที่สนใจ', 'ผู้ดูแล'].map(label => <th key={label} className="p-4 font-medium">{label}</th>)}</tr></thead>
              <tbody className="divide-y divide-slate-100">
                {!visible.length && <tr><td colSpan={4} className="p-10 text-center text-slate-500">ไม่พบรายการในหน้านี้ตามเงื่อนไข</td></tr>}
                {visible.map(customer => <tr key={customer.id}>
                  <td className="p-4"><span className="font-semibold text-slate-900">{customer.name}</span><span className="block text-slate-500 mt-1">{customer.phone ?? 'ไม่ทราบ (ข้อมูลเก่า)'}</span>
                    {customer.channel && <span className="block text-xs text-slate-400 mt-1">{customer.channel}</span>}
                    {leadWorkEnabled && <Link href={`/sales-crm/${encodeURIComponent(customer.id)}`} prefetch={false}
                      aria-label={`งานส่วนกลางของ ${customer.name}`} className="mt-2 inline-block text-xs font-semibold text-blue-700 hover:underline">ดูงานส่วนกลาง →</Link>}</td>
                  <td className="p-4 whitespace-nowrap text-slate-600">{customer.leadCreatedAt ? new Date(customer.leadCreatedAt).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok' }) : 'ไม่ทราบวันที่'}</td>
                  <td className="p-4"><div className="flex flex-wrap gap-2">
                    {!customer.interests.length && <span className="text-slate-400">ยังไม่ระบุโครงการ</span>}
                    {customer.interests.map(interest => <span key={interest.id} className={`rounded-xl border px-3 py-2 text-xs ${interest.workspaceState === 'project_active' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-blue-50 border-blue-200 text-blue-800'}`}>
                      <span className="font-semibold">{interest.projectName}</span><span className="block mt-1">{interest.workspaceState === 'project_active' ? 'มีงานในโครงการแล้ว' : 'สนใจ / รอเข้าโครงการ'}</span>
                      {interest.plotId && <span className="block mt-1">เล็ง: {interest.plotId}</span>}
                      <span className="block mt-1">ผู้ดูแล: {ownerName(interest.ownerUserId)}</span>
                      {leadWorkEnabled && <Link href={`/sales-crm/${encodeURIComponent(customer.id)}?interestId=${encodeURIComponent(interest.id)}`} prefetch={false}
                        aria-label={`ติดตามโครงการ ${interest.projectName} ของ ${customer.name}`} className="mt-2 block font-semibold underline">ดูงานโครงการ →</Link>}
                    </span>)}
                  </div></td>
                  <td className="p-4 text-slate-600">{ownerName(customer.ownerUserId)}{customer.ownerUserId === snapshot.actor.userId ? ' (คุณ)' : ''}</td>
                </tr>)}
              </tbody>
            </table></div>
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
