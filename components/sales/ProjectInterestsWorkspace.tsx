'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { projectInterestsApi, ProjectInterestsApiError, type ProjectInterestsApi } from '@/lib/sales/projectInterestsClient';
import type { ProjectInterestInput, ProjectInterestResult, ProjectInterestsSnapshot } from '@/lib/sales/projectInterestsContracts';
import { clearProjectInterestsPending, readProjectInterestsPending, writeProjectInterestsPending, ProjectInterestsPendingError } from '@/lib/sales/projectInterestsPending';
import ProjectInterestForm from './ProjectInterestForm';
import { bookingButtonClass } from './BookingForm';

interface Props { customerId: string; visitsEnabled?: boolean; api?: ProjectInterestsApi }
interface Pending { actor: string; input: ProjectInterestInput; uncertain: boolean }
const statuses: Record<string, string> = { new: 'ใหม่', contacted: 'ติดต่อแล้ว', considering: 'กำลังพิจารณา', follow_up: 'ติดตามต่อ', nurture: 'ดูแลระยะยาว', lost: 'Lost — ปิดความสนใจ' };
const workLink = (customer: string, interest: string) => `/sales-crm/${customer}?${new URLSearchParams({ interestId: interest })}`;
const visitLink = (customer: string, interest: string) => `/sales-crm/visits?${new URLSearchParams({ customerId: customer, interestId: interest })}`;

export default function ProjectInterestsWorkspace(props: Props) { return <ProjectInterestsSession key={props.customerId} {...props} />; }
function ProjectInterestsSession({ customerId, visitsEnabled = false, api = projectInterestsApi }: Props) {
  const [page, setPage] = useState(0), [revision, setRevision] = useState(0);
  const [loaded, setLoaded] = useState<{ key: string; api?: ProjectInterestsApi; snapshot?: ProjectInterestsSnapshot; error?: string }>({ key: '' });
  const [pending, setPending] = useState<Pending | null>(null), [saved, setSaved] = useState<ProjectInterestResult | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [storageError, setStorageError] = useState(''), [notice, setNotice] = useState('');
  const mounted = useRef(false), writing = useRef(false), pendingRef = useRef<Pending | null>(null), storageBlocked = useRef(false);
  const identityEpoch = useRef(0), recoveredActor = useRef(''), successfulReceipt = useRef(false);
  const key = `${customerId}:${page}:${revision}`;
  const snapshot = loaded.key === key && loaded.api === api ? loaded.snapshot : undefined;
  const mayAdd = !!snapshot && snapshot.customer.canAdd && snapshot.actor.role !== 'owner' && snapshot.customer.intakeStatus !== 'lost'
    && (snapshot.actor.role === 'admin' || snapshot.actor.userId === snapshot.customer.ownerUserId);
  const locked = busy || !!pending || !!storageError;
  const setReceipt = (value: Pending | null) => { pendingRef.current = value; if (mounted.current) setPending(value); };
  const blockStorage = (failure: unknown) => {
    storageBlocked.current = true;
    if (mounted.current) setStorageError(failure instanceof Error ? failure.message : 'ตรวจคำขอค้างไม่ได้ ให้ Admin ตรวจสอบ');
  };
  useEffect(() => {
    mounted.current = true;
    const blocked = () => pendingRef.current !== null || writing.current || storageBlocked.current || successfulReceipt.current;
    const unload = (event: BeforeUnloadEvent) => { if (blocked()) { event.preventDefault(); event.returnValue = ''; } };
    const navigation = (event: MouseEvent) => {
      if (blocked() && event.target instanceof Element && event.target.closest('a[href]')) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener('beforeunload', unload); document.addEventListener('click', navigation, true);
    return () => { mounted.current = false; window.removeEventListener('beforeunload', unload); document.removeEventListener('click', navigation, true); };
  }, []);
  useEffect(() => {
    // This is a request-generation counter, not a DOM ref to capture at setup.
    // Invalidate whichever generation is current on an identity or API change.
    const invalidateIdentity = () => { identityEpoch.current += 1; };
    const stop = api.watchIdentity?.(() => {
      invalidateIdentity(); recoveredActor.current = ''; pendingRef.current = null; storageBlocked.current = false; successfulReceipt.current = false;
      setPending(null); setSaved(null); setError(''); setStorageError(''); setPage(0); setRevision(value => value + 1);
      setNotice('บัญชีเปลี่ยนแล้ว จึงซ่อนข้อมูลเดิม หากเคยส่งคำขอค้างให้กลับเข้าบัญชีเดิมเพื่อตรวจด้วยคำขอเดิม');
    });
    return () => { stop?.(); invalidateIdentity(); };
  }, [api]);
  useEffect(() => {
    let cancelled = false;
    const epoch = identityEpoch.current;
    api.read({ customerId, page }).then(value => {
      if (cancelled || epoch !== identityEpoch.current) return;
      try {
        if (pendingRef.current && pendingRef.current.actor !== value.actor.userId) {
          // Fail closed even if an auth-change notification was missed: never
          // display the previous account's pending project/customer details.
          setPending(null); setSaved(null); throw new ProjectInterestsPendingError();
        }
        if (recoveredActor.current !== value.actor.userId) {
          const receipt = readProjectInterestsPending(value.actor.userId); recoveredActor.current = value.actor.userId;
          if (receipt) { const restored = { actor: value.actor.userId, input: receipt, uncertain: true }; pendingRef.current = restored; setPending(restored); }
        }
      } catch (failure) { blockStorage(failure); }
      setLoaded({ key, api, snapshot: value });
    }).catch(failure => {
      if (!cancelled && epoch === identityEpoch.current) setLoaded({ key, api, error: failure instanceof Error ? failure.message : 'โหลดโครงการที่สนใจไม่ได้' });
    });
    return () => { cancelled = true; };
  }, [api, customerId, page, key]);

  const save = async (input: ProjectInterestInput) => {
    if (writing.current || storageBlocked.current || successfulReceipt.current || !snapshot || snapshot.actor.role === 'owner') return;
    const existing = pendingRef.current;
    if (existing ? existing.actor !== snapshot.actor.userId : !mayAdd || input.customerId !== customerId) return;
    const epoch = identityEpoch.current, current = () => mounted.current && epoch === identityEpoch.current;
    writing.current = true; setBusy(true); setError(''); setNotice(''); setSaved(null);
    const actor = existing?.actor ?? snapshot.actor.userId;
    let receipt: Pending;
    try {
      const normalized = writeProjectInterestsPending(actor, existing?.input ?? input);
      receipt = { actor, input: normalized, uncertain: existing?.uncertain ?? false }; setReceipt(receipt);
    } catch (failure) { blockStorage(failure); setBusy(false); writing.current = false; return; }
    try {
      const result = await api.save(receipt.input, actor);
      if (current()) successfulReceipt.current = true;
      try { clearProjectInterestsPending(actor, receipt.input); }
      catch (failure) { if (current()) { setNotice('บันทึกสำเร็จแล้ว ห้ามส่งซ้ำ'); blockStorage(failure); } return; }
      if (current()) {
        setReceipt(null); successfulReceipt.current = false; setSaved(result);
        setNotice('เพิ่มโครงการที่สนใจแล้ว โดยใช้ Lead คนเดิม กำลังอ่านข้อมูลล่าสุด'); setPage(0); setRevision(value => value + 1);
      }
    } catch (failure) {
      if (failure instanceof ProjectInterestsApiError && failure.definitelyNotSaved && !receipt.uncertain) {
        try { clearProjectInterestsPending(actor, receipt.input); if (current()) setReceipt(null); }
        catch (storageFailure) { if (current()) blockStorage(storageFailure); }
      } else if (current()) setReceipt({ ...receipt, uncertain: true });
      if (current()) setError(failure instanceof Error ? failure.message : 'ยังยืนยันผลบันทึกไม่ได้');
    } finally {
      writing.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const changePage = (next: number) => {
    if (writing.current || pendingRef.current || storageBlocked.current) return;
    setPage(next); setError('');
  };
  return <main className="mx-auto max-w-5xl space-y-5 p-4 sm:p-8">
    <header className="flex flex-wrap justify-between gap-3"><div><h1 className="text-2xl font-bold">โครงการที่สนใจของ Lead</h1>
      <p className="mt-1 text-sm text-slate-600">เพิ่มความสนใจให้ลูกค้าคนเดิม ติดตามทุกโครงการจากส่วนกลาง</p></div>
      {locked ? <p className="text-sm text-slate-500">ตรวจคำขอค้างก่อนออกจากหน้านี้</p> : <Link href="/sales-crm" prefetch={false} className="text-blue-700 underline">กลับ Lead ส่วนกลาง</Link>}
    </header>
    {notice && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-emerald-800">{notice}</p>}
    {(error || storageError) && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-rose-800">{storageError || error}</p>}
    {saved && !locked && <section aria-label="โครงการที่เพิ่มสำเร็จ" className="space-y-2 rounded-xl border border-emerald-200 p-4">
      <h2 className="font-bold">เพิ่ม {saved.projectName} สำเร็จ</h2><p className="break-all text-xs text-slate-500">ลูกค้า {saved.customerId} · ผู้ดูแล {saved.ownerUserId}</p>
      {saved.customerId !== customerId && <p className="text-sm">ผลนี้เป็นของลูกค้าในคำขอค้าง ไม่ใช่ลูกค้าที่กำลังเปิดอยู่</p>}
      <div className="flex flex-wrap gap-4"><Link href={workLink(saved.customerId, saved.interestId)} prefetch={false} className="text-blue-700 underline">เปิดงานติดตามของโครงการที่เพิ่ม</Link>
        {visitsEnabled && <Link href={visitLink(saved.customerId, saved.interestId)} prefetch={false} className="text-blue-700 underline">นัดหมาย / เช็คอินโครงการที่เพิ่ม</Link>}</div>
    </section>}
    {pending && <section aria-label="คำขอเพิ่มโครงการค้าง" className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-4">
      <h2 className="font-bold">มีคำขอที่ต้องตรวจผลก่อนเริ่มรายการใหม่</h2><p className="break-all text-sm">คำขอ {pending.input.requestId} · ลูกค้า {pending.input.customerId} · โครงการ {pending.input.projectName}</p>
      {pending.input.customerId !== customerId && <p>คำขอนี้เป็นของลูกค้าคนอื่น จะตรวจด้วยข้อมูลเดิมเท่านั้น</p>}
      <p className="text-sm">ไม่ส่งซ้ำอัตโนมัติ เก็บคำขอชั่วคราวในแท็บนี้ ห้ามล้างข้อมูลแท็บ</p>
      <button className={bookingButtonClass} disabled={busy || !!storageError || !snapshot || snapshot.actor.role === 'owner' || pending.actor !== snapshot.actor.userId}
        onClick={() => void save(pending.input)}>{busy ? 'กำลังตรวจผล…' : 'ตรวจผลซ้ำด้วยคำขอเดิม'}</button>
    </section>}
    {!snapshot ? loaded.key === key && loaded.api === api && loaded.error ? <section role="alert" className="space-y-3 rounded-lg border p-4"><p>{loaded.error}</p>
      <p>ไม่ใช้ข้อมูลเก่าแทน และการโหลดใหม่ไม่ส่งคำขอบันทึกซ้ำ</p><button className={bookingButtonClass} disabled={busy} onClick={() => setRevision(value => value + 1)}>โหลดข้อมูลใหม่</button></section>
      : <p role="status">กำลังตรวจสิทธิ์และโหลดโครงการที่สนใจ…</p> : <>
      <section aria-label="Lead ที่กำลังดู" className="space-y-2 rounded-xl border bg-white p-5"><h2 className="text-xl font-bold">{snapshot.customer.name}</h2>
        <p className="break-all text-xs text-slate-500">รหัสลูกค้า {snapshot.customer.id} · ผู้ดูแลส่วนกลาง {snapshot.customer.ownerUserId}</p>
        <p className="text-sm text-slate-600">การเพิ่มโครงการไม่เปลี่ยนวันเริ่มเป็น Lead เจ้าของ Lead ส่วนกลาง หรืองาน SLA เดิม และยังไม่ใช่การจอง</p>
        {!mayAdd && <p className="rounded-lg bg-slate-100 p-3 text-sm">{snapshot.actor.role === 'owner' ? 'Owner ดูข้อมูลได้อย่างเดียว' : snapshot.customer.intakeStatus === 'lost' ? 'Lead นี้ปิดแล้ว ดูประวัติได้แต่ยังเพิ่มโครงการไม่ได้' : 'เฉพาะเจ้าของ Lead ส่วนกลางหรือ Admin ที่เพิ่มโครงการได้'}</p>}
      </section>
      {mayAdd && <ProjectInterestForm key={key} snapshot={snapshot} disabled={locked} onSubmit={input => void save(input)} />}
      <section aria-label="โครงการที่สนใจทั้งหมด" className="space-y-3 rounded-xl border bg-white p-5"><h2 className="text-lg font-bold">โครงการที่มีอยู่แล้ว</h2>
        <p className="text-sm text-slate-600">หน้า {page + 1} · ไม่เกิน 50 รายการต่อหน้า · รวม Lost ไว้เป็นประวัติ ไม่เพิ่มซ้ำหรือเปิดใหม่จากหน้านี้</p>
        {!snapshot.interests.length && <p>ยังไม่มีโครงการที่สนใจในหน้านี้</p>}
        {snapshot.interests.map(interest => <article key={interest.id} aria-label={`ความสนใจ ${interest.projectName}`} className="space-y-2 rounded-lg border p-4">
          <div className="flex flex-wrap justify-between gap-2"><h3 className="font-bold">{interest.projectName}</h3><span className={interest.status === 'lost' ? 'text-rose-700' : 'text-blue-800'}>{statuses[interest.status] ?? interest.status}</span></div>
          <p className="text-sm">แปลงที่เล็ง: {interest.plotId ?? 'ยังไม่ระบุ'}</p><p className="break-all text-xs text-slate-500">ผู้ดูแลโครงการนี้ {interest.ownerUserId}</p>
          {!locked && <div className="flex flex-wrap gap-4"><Link href={workLink(customerId, interest.id)} prefetch={false} className="text-sm text-blue-700 underline">งานติดตาม / ประวัติ {interest.projectName}</Link>
            {visitsEnabled && <Link href={visitLink(customerId, interest.id)} prefetch={false} className="text-sm text-blue-700 underline">นัดหมาย / เข้าชม {interest.projectName}</Link>}</div>}
        </article>)}
        <div className="flex flex-wrap gap-3"><button className={bookingButtonClass} disabled={locked || page === 0} onClick={() => changePage(page - 1)}>โครงการก่อนหน้า</button>
          <button className={bookingButtonClass} disabled={locked || !snapshot.hasMore} onClick={() => changePage(page + 1)}>โครงการถัดไป</button>
          <button className={bookingButtonClass} disabled={locked} onClick={() => { if (!writing.current && !pendingRef.current && !storageBlocked.current) { setError(''); setRevision(value => value + 1); } }}>โหลดข้อมูลล่าสุด</button></div>
      </section>
    </>}
  </main>;
}
