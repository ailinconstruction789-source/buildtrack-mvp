'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { visitSopApi, VisitSopApiError, type VisitSopApi } from '@/lib/sales/visitSopClient';
import type { VisitSopAnchor, VisitSopInput, VisitSopResult, VisitSopSnapshot } from '@/lib/sales/visitSopContracts';
import { clearVisitSopPending, readVisitSopPending, writeVisitSopPending, VisitSopPendingError } from '@/lib/sales/visitSopPending';
import { displayBangkokTime } from '@/lib/sales/leadWorkDates';
import VisitSopForm from './VisitSopForm';
import { bookingButtonClass } from './BookingForm';

interface Props { anchor: VisitSopAnchor; api?: VisitSopApi; followUpEnabled?: boolean }
interface Pending { actor: string; input: VisitSopInput; uncertain: boolean }
const stageLabels = { stage_a: 'Stage A · ก่อนพาชม', stage_b: 'Stage B · รอเริ่มพาชม', stage_c: 'Stage C · หลังพาชม', completed: 'SOP ครบแล้ว' };
const answerLabels = { pending: 'ยังไม่ได้ตอบ / ยังไม่ทำ', done: 'ทำแล้ว', not_applicable: 'ไม่เกี่ยวข้อง', skipped: 'ข้าม' };
const commandLabels = { start: 'เริ่ม SOP', save_stage: 'บันทึกความคืบหน้า', complete_stage: 'ยืนยันช่วงครบ', start_tour: 'เริ่มพาชมจริง' };
const sameAnchor = (left: VisitSopAnchor, right: VisitSopAnchor) => left.customerId === right.customerId && left.interestId === right.interestId && left.appointmentId === right.appointmentId && left.visitId === right.visitId;
function sopLink(result: VisitSopResult) {
  const params = new URLSearchParams({ customerId: result.customerId, interestId: result.interestId });
  if (result.appointmentId) params.set('appointmentId', result.appointmentId); else if (result.visitId) params.set('visitId', result.visitId);
  return `/sales-crm/sop?${params}`;
}
export default function VisitSopWorkspace(props: Props) { return <VisitSopSession key={JSON.stringify(props.anchor)} {...props} />; }
function VisitSopSession({ anchor, api = visitSopApi, followUpEnabled = false }: Props) {
  const { customerId, interestId, appointmentId, visitId } = anchor;
  const [eventPage, setEventPage] = useState(0), [revision, setRevision] = useState(0);
  const [loaded, setLoaded] = useState<{ key: string; api?: VisitSopApi; snapshot?: VisitSopSnapshot; error?: string }>({ key: '' });
  const [pending, setPending] = useState<Pending | null>(null), [saved, setSaved] = useState<VisitSopResult | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [storageError, setStorageError] = useState(''), [notice, setNotice] = useState('');
  const mounted = useRef(false), writing = useRef(false), pendingRef = useRef<Pending | null>(null), storageBlocked = useRef(false);
  const identityEpoch = useRef(0), recoveredActor = useRef(''), successfulReceipt = useRef(false);
  const key = `${customerId}:${interestId}:${appointmentId ?? visitId}:${eventPage}:${revision}`;
  const snapshot = loaded.key === key && loaded.api === api ? loaded.snapshot : undefined;
  const mayWrite = !!snapshot && snapshot.scope.canWrite && snapshot.actor.role === 'sales' && snapshot.actor.userId === snapshot.scope.ownerUserId
    && snapshot.scope.engagementStatus !== 'lost' && snapshot.anchor.visitStatus !== 'cancelled' && !['cancelled', 'no_show'].includes(snapshot.anchor.appointmentStatus ?? '') && snapshot.run?.currentStage !== 'completed';
  const locked = busy || !!pending || !!storageError;
  const setReceipt = (value: Pending | null) => { pendingRef.current = value; if (mounted.current) setPending(value); };
  const blockStorage = (failure: unknown) => { storageBlocked.current = true; if (mounted.current) setStorageError(failure instanceof Error ? failure.message : 'ตรวจคำขอ SOP ไม่ได้'); };
  useEffect(() => {
    mounted.current = true;
    const blocked = () => pendingRef.current !== null || writing.current || storageBlocked.current || successfulReceipt.current;
    const unload = (event: BeforeUnloadEvent) => { if (blocked()) { event.preventDefault(); event.returnValue = ''; } };
    const navigation = (event: MouseEvent) => { if (blocked() && event.target instanceof Element && event.target.closest('a[href]')) { event.preventDefault(); event.stopPropagation(); } };
    window.addEventListener('beforeunload', unload); document.addEventListener('click', navigation, true);
    return () => { mounted.current = false; window.removeEventListener('beforeunload', unload); document.removeEventListener('click', navigation, true); };
  }, []);
  useEffect(() => {
    const invalidate = () => { identityEpoch.current++; };
    const stop = api.watchIdentity?.(() => {
      invalidate(); recoveredActor.current = ''; pendingRef.current = null; storageBlocked.current = false; successfulReceipt.current = false;
      setPending(null); setSaved(null); setError(''); setStorageError(''); setEventPage(0); setRevision(value => value + 1);
      setNotice('บัญชีเปลี่ยนแล้ว จึงซ่อนข้อมูล SOP เดิม หากมีคำขอค้างให้กลับเข้าบัญชีเดิมเพื่อตรวจคำขอเดิม');
    }); return () => { stop?.(); invalidate(); };
  }, [api]);
  useEffect(() => {
    let cancelled = false; const epoch = identityEpoch.current;
    api.read({ customerId, interestId, appointmentId, visitId, eventPage }).then(value => {
      if (cancelled || epoch !== identityEpoch.current) return;
      try {
        if (pendingRef.current && pendingRef.current.actor !== value.actor.userId) { setPending(null); setSaved(null); throw new VisitSopPendingError(); }
        if (recoveredActor.current !== value.actor.userId) {
          const receipt = readVisitSopPending(value.actor.userId); recoveredActor.current = value.actor.userId;
          if (receipt) { const restored = { actor: value.actor.userId, input: receipt, uncertain: true }; pendingRef.current = restored; setPending(restored); }
        }
      } catch (failure) { blockStorage(failure); }
      setLoaded({ key, api, snapshot: value });
    }).catch(failure => { if (!cancelled && epoch === identityEpoch.current) setLoaded({ key, api, error: failure instanceof Error ? failure.message : 'โหลด SOP ไม่ได้' }); });
    return () => { cancelled = true; };
  }, [api, customerId, interestId, appointmentId, visitId, eventPage, key]);
  const save = async (input: VisitSopInput) => {
    if (writing.current || storageBlocked.current || successfulReceipt.current || !snapshot || snapshot.actor.role !== 'sales') return;
    const existing = pendingRef.current;
    if (existing ? existing.actor !== snapshot.actor.userId : !mayWrite || !sameAnchor(input, anchor)) return;
    const epoch = identityEpoch.current, current = () => mounted.current && epoch === identityEpoch.current;
    writing.current = true; setBusy(true); setError(''); setNotice(''); setSaved(null);
    const actor = existing?.actor ?? snapshot.actor.userId; let receipt: Pending;
    try {
      const normalized = writeVisitSopPending(actor, existing?.input ?? input);
      receipt = { actor, input: normalized, uncertain: existing?.uncertain ?? false }; setReceipt(receipt);
    } catch (failure) { blockStorage(failure); setBusy(false); writing.current = false; return; }
    try {
      const result = await api.save(receipt.input, actor); if (current()) successfulReceipt.current = true;
      try { clearVisitSopPending(actor, receipt.input); }
      catch (failure) { if (current()) { setNotice('บันทึก SOP สำเร็จแล้ว ห้ามส่งซ้ำ'); blockStorage(failure); } return; }
      if (current()) { setReceipt(null); successfulReceipt.current = false; setSaved(result); setNotice('บันทึก SOP แล้ว กำลังอ่านข้อมูลล่าสุด — ไม่ได้เปลี่ยนสถานะ Visit เป็นสำเร็จ'); setEventPage(0); setRevision(value => value + 1); }
    } catch (failure) {
      if (failure instanceof VisitSopApiError && failure.definitelyNotSaved && !receipt.uncertain) {
        try { clearVisitSopPending(actor, receipt.input); if (current()) setReceipt(null); } catch (storageFailure) { if (current()) blockStorage(storageFailure); }
      } else if (current()) setReceipt({ ...receipt, uncertain: true });
      if (current()) setError(failure instanceof Error ? failure.message : 'ยังยืนยันผล SOP ไม่ได้');
    } finally { writing.current = false; if (mounted.current) setBusy(false); }
  };
  const reload = (page = eventPage) => { if (!writing.current && !pendingRef.current && !storageBlocked.current) { setEventPage(page); setError(''); setRevision(value => value + 1); } };
  const visitsHref = `/sales-crm/visits?${new URLSearchParams({ customerId, interestId })}`;
  const followUpHref = `/sales-crm/visit-follow-up?${new URLSearchParams({ customerId, interestId })}`;
  return <main className="mx-auto max-w-5xl space-y-5 p-4 sm:p-8">
    <header className="flex flex-wrap justify-between gap-3"><div><h1 className="text-2xl font-bold">SOP เตรียมบ้านและพาชม</h1><p className="text-sm text-slate-600">Stage A → เริ่มพาชมจริง → Stage C · เก็บความคืบหน้าทีละช่วง</p></div>
      {locked ? <p>ตรวจคำขอค้างก่อนออกจากหน้านี้</p> : <Link href={visitsHref} prefetch={false} className="text-blue-700 underline">กลับนัดหมาย / เข้าชม</Link>}
    </header>
    <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">SOP เป็นการรับรองงานที่ Sales ทำ ไม่ใช่แบบ Customer Voices การทำ SOP ครบไม่ทำให้ Visit สำเร็จ และไม่เปลี่ยนการจอง แปลงที่สนใจ หรือสถานะ Lead ให้อัตโนมัติ</p>
    {notice && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-emerald-800">{notice}</p>}
    {(error || storageError) && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-rose-800">{storageError || error}</p>}
    {saved && !locked && <p className="text-sm"><Link href={sopLink(saved)} prefetch={false} className="text-blue-700 underline">เปิด SOP ที่บันทึกสำเร็จ</Link> · ลูกค้า {saved.customerId} · {stageLabels[saved.stage]}</p>}
    {pending && <section aria-label="คำขอ SOP ค้าง" className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-4">
      <h2 className="font-bold">ต้องตรวจผลคำขอเดิมก่อนเริ่มงานใหม่</h2><p className="break-all text-sm">{commandLabels[pending.input.command]} · คำขอ {pending.input.requestId} · ลูกค้า {pending.input.customerId}</p>
      {!sameAnchor(pending.input, anchor) && <p>คำขอค้างเป็นของนัดหมายหรือ Visit อื่น จะส่งข้อมูลเดิมเท่านั้น</p>}
      <p className="text-sm">ไม่ส่งซ้ำอัตโนมัติ ข้อมูลคำขออยู่ชั่วคราวในแท็บนี้ ห้ามล้างข้อมูลแท็บ</p>
      <button className={bookingButtonClass} disabled={busy || !!storageError || !snapshot || snapshot.actor.role !== 'sales' || pending.actor !== snapshot.actor.userId} onClick={() => void save(pending.input)}>{busy ? 'กำลังตรวจผล…' : 'ตรวจผลซ้ำด้วยคำขอเดิม'}</button>
    </section>}
    {!snapshot ? loaded.key === key && loaded.api === api && loaded.error ? <section role="alert" className="space-y-3 rounded-lg border p-4"><p>{loaded.error}</p><p>ไม่แสดงข้อมูลเก่าแทน และโหลดใหม่ไม่ส่งคำขอบันทึกซ้ำ</p>
      <button className={bookingButtonClass} disabled={busy} onClick={() => setRevision(value => value + 1)}>โหลดข้อมูลใหม่</button></section> : <p role="status">กำลังตรวจสิทธิ์และโหลด SOP…</p> : <>
      <section className="space-y-3 rounded-xl border bg-white p-5"><h2 className="text-xl font-bold">{snapshot.scope.customerName}</h2><p>{snapshot.scope.projectName} · {snapshot.run ? stageLabels[snapshot.run.currentStage] : 'ยังไม่เริ่ม SOP'}</p>
        <p className="break-all text-xs text-slate-500">ผู้ดูแลปัจจุบัน {snapshot.scope.ownerUserId} · {appointmentId ? `นัดหมาย ${appointmentId}` : `Visit ${visitId}`}</p>
        <p className="text-sm">เช็คอินจริง: {displayBangkokTime(snapshot.anchor.checkedInAt)} · Visit: {snapshot.anchor.visitStatus === 'completed' ? 'สำเร็จตามหลักฐาน Customer Voices' : snapshot.anchor.visitStatus === 'awaiting_voice' ? 'รอ Customer Voices — ยังไม่สำเร็จ' : snapshot.anchor.visitStatus === 'cancelled' ? 'ยกเลิก' : 'ยังไม่มี'}</p>
        {!mayWrite && <p className="rounded-lg bg-slate-100 p-3 text-sm">{snapshot.actor.role !== 'sales' ? 'Admin และ Owner ดูได้อย่างเดียว ไม่ทำ SOP แทน Sales และยังไม่มีเครื่องมือแก้หลักฐานย้อนหลัง' : 'ดูประวัติได้ แต่ไม่ใช่ผู้ดูแลปัจจุบัน หรืองานนี้ปิดแล้ว'}</p>}
        {!locked && <button className={bookingButtonClass} onClick={() => reload()}>โหลด SOP ล่าสุด</button>}
      </section>
      <section aria-label="งานติดตามจริง" className="space-y-2 rounded-xl border bg-white p-5"><h2 className="font-bold">งานติดตามครั้งถัดไปของโครงการนี้</h2>
        {snapshot.nextAction ? <><p>{snapshot.nextAction.action}</p><p className="text-sm">กำหนด {displayBangkokTime(snapshot.nextAction.dueAt)}</p></> : <p>ยังไม่มีงานติดตามจริง ต้องสร้างก่อนยืนยัน Stage C ครบ</p>}
        <p className="text-sm text-slate-600">ระบบตรวจงานติดตามและกำหนดเวลาอีกครั้งขณะยืนยัน Stage C ไม่สร้างงานติดตามซ้ำจากรายการติ๊ก</p>
        {followUpEnabled && !locked && <Link href={followUpHref} prefetch={false} className="text-blue-700 underline">ดู / กำหนดงานติดตามครั้งถัดไป</Link>}
        {!followUpEnabled && <p className="text-sm text-amber-800">ยังไม่เปิดการตั้งแผนถัดไปจากหน้านี้ กรุณาให้ Admin ตรวจการเปิดใช้</p>}
      </section>
      {mayWrite && <VisitSopForm key={`${key}:${snapshot.run?.revision ?? 'new'}`} snapshot={snapshot} disabled={locked} onSubmit={input => void save(input)} />}
      {snapshot.run && <section aria-label="หลักฐาน SOP ที่บันทึกแล้ว" className="space-y-3 rounded-xl border bg-white p-5"><h2 className="font-bold">หลักฐาน SOP ที่บันทึกแล้ว</h2>
        <p>บ้าน / แปลงที่พาชม: {snapshot.run.plotId}</p><p className="text-sm">Stage A ครบ: {displayBangkokTime(snapshot.run.stageACompletedAt)} · เริ่มพาชม: {displayBangkokTime(snapshot.run.stageBStartedAt)}</p>
        <p className="text-sm">ลูกค้ากลับ: {displayBangkokTime(snapshot.run.departedAt)} · Stage C ครบ: {displayBangkokTime(snapshot.run.stageCCompletedAt)}</p>
        <p>ความคิดเห็น: {snapshot.run.recap.feedback || 'ยังไม่บันทึก'}</p><p>ข้อกังวล: {snapshot.run.recap.objections || 'ยังไม่บันทึก'}</p>
        {snapshot.run.currentStage === 'completed' && <p className="text-sm">งานติดตามที่ตรวจตอนปิด SOP: {snapshot.run.nextAction} · {displayBangkokTime(snapshot.run.nextFollowUpAt)}</p>}
        <details><summary className="cursor-pointer font-semibold">ดูผลตรวจทั้ง 29 รายการ</summary><ul className="mt-3 space-y-2">{snapshot.run.items.map(item => <li key={item.key} className="rounded-lg border p-3 text-sm"><p>{item.label} · {answerLabels[item.result]}</p>
          {item.reason && <p>เหตุผล: {item.reason}</p>}{item.answeredAt && <p className="text-xs text-slate-500">ทำรายการจริง {displayBangkokTime(item.answeredAt)} · ผู้ทำ {item.answeredByUserId}</p>}</li>)}</ul></details>
      </section>}
      <section aria-label="ประวัติ SOP" className="space-y-3 rounded-xl border bg-white p-5"><h2 className="font-bold">ประวัติพร้อมเหตุผล</h2><p className="text-sm">หน้า {eventPage + 1} · ไม่เกิน 50 รายการต่อหน้า · ไม่มีปุ่มแก้ไขหรือลบประวัติ</p>
        {!snapshot.events.length && <p>ยังไม่มีเหตุการณ์ในหน้านี้</p>}{snapshot.events.map(event => <article key={event.id} className="space-y-1 rounded-lg border p-3 text-sm"><h3 className="font-semibold">{commandLabels[event.command]} · {stageLabels[event.stage]}</h3>
          <p>เกิดจริง: {displayBangkokTime(event.occurredAt)}</p><p>บันทึกเข้าระบบ: {displayBangkokTime(event.recordedAt)}</p><p>เหตุผล: {event.reason}</p><p className="break-all text-xs text-slate-500">ผู้ทำ {event.actorUserId} · เหตุการณ์ {event.id}</p></article>)}
        <div className="flex gap-3"><button className={bookingButtonClass} disabled={locked || eventPage === 0} onClick={() => reload(eventPage - 1)}>ประวัติ SOP ก่อนหน้า</button>
          <button className={bookingButtonClass} disabled={locked || !snapshot.eventsHasMore} onClick={() => reload(eventPage + 1)}>ประวัติ SOP ถัดไป</button></div>
      </section>
    </>}
  </main>;
}
