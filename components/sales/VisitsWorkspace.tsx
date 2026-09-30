'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { visitsApi, VisitsApiError, type VisitsApi } from '@/lib/sales/visitsClient';
import { activeAppointment, type VisitCommand, type VisitsInput, type VisitsSnapshot } from '@/lib/sales/visitsContracts';
import { clearVisitsPending, readVisitsPending, writeVisitsPending, VisitsPendingError } from '@/lib/sales/visitsPending';
import { displayBangkokTime } from '@/lib/sales/leadWorkDates';
import { bookingButtonClass } from './BookingForm';
import VisitActionForm, { visitCommandLabels } from './VisitActionForm';

interface Props { customerId: string; interestId: string; api?: VisitsApi; sopEnabled?: boolean; voicesEnabled?: boolean }
interface Pending { actor: string; input: VisitsInput; uncertain: boolean }
interface Editor { action: VisitCommand; appointmentId?: string; visitId?: string }
const appointmentLabels = { scheduled: 'นัดหมาย', rescheduled: 'เลื่อนนัดแล้ว', attended: 'เข้าชมแล้ว', no_show: 'ไม่มาตามนัด', cancelled: 'ยกเลิกนัด' };
const visitLabels = { awaiting_voice: 'รอ Customer Voices — ยังไม่สำเร็จ', completed: 'Visit สำเร็จ', cancelled: 'ยกเลิกการเข้าชม' };

export default function VisitsWorkspace(props: Props) { return <VisitsSession key={`${props.customerId}:${props.interestId}`} {...props} />; }
function VisitsSession({ customerId, interestId, api = visitsApi, sopEnabled = false, voicesEnabled = false }: Props) {
  const [appointmentPage, setAppointmentPage] = useState(0), [visitPage, setVisitPage] = useState(0), [eventPage, setEventPage] = useState(0), [revision, setRevision] = useState(0);
  const [loaded, setLoaded] = useState<{ key: string; api?: VisitsApi; snapshot?: VisitsSnapshot; error?: string }>({ key: '' });
  const [editor, setEditor] = useState<Editor | null>(null), [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [storageError, setStorageError] = useState(''), [notice, setNotice] = useState('');
  const mounted = useRef(false), writing = useRef(false), pendingRef = useRef<Pending | null>(null), storageBlocked = useRef(false);
  const recoveredActor = useRef(''), successfulReceipt = useRef(false);
  const key = `${customerId}:${interestId}:${appointmentPage}:${visitPage}:${eventPage}:${revision}`;
  const snapshot = loaded.key === key && loaded.api === api ? loaded.snapshot : undefined;
  const mayEdit = !!snapshot && snapshot.scope.canEdit && snapshot.scope.engagementStatus !== 'lost' && snapshot.actor.role !== 'owner'
    && (snapshot.actor.role === 'admin' || snapshot.actor.userId === snapshot.scope.ownerUserId);
  const locked = !!pending || busy || !!storageError;
  const setReceipt = (value: Pending | null) => { pendingRef.current = value; if (mounted.current) setPending(value); };
  const blockStorage = (failure: unknown) => {
    storageBlocked.current = true;
    if (mounted.current) setStorageError(failure instanceof Error ? failure.message : 'ตรวจคำขอค้างไม่ได้ กรุณาให้ Admin ตรวจสอบ');
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
    let cancelled = false;
    api.read({ customerId, interestId, appointmentPage, visitPage, eventPage }).then(value => {
      if (cancelled) return;
      try {
        if (pendingRef.current && pendingRef.current.actor !== value.actor.userId) throw new VisitsPendingError();
        if (recoveredActor.current !== value.actor.userId) {
          const receipt = readVisitsPending(value.actor.userId); recoveredActor.current = value.actor.userId;
          if (receipt) { const recovered = { actor: value.actor.userId, input: receipt, uncertain: true }; pendingRef.current = recovered; setPending(recovered); }
        }
      } catch (failure) { storageBlocked.current = true; setStorageError(failure instanceof Error ? failure.message : 'ตรวจคำขอค้างไม่ได้'); }
      setLoaded({ key, api, snapshot: value });
    }).catch(failure => { if (!cancelled) setLoaded({ key, api, error: failure instanceof Error ? failure.message : 'โหลดนัดหมายและเข้าชมไม่ได้' }); });
    return () => { cancelled = true; };
  }, [api, customerId, interestId, appointmentPage, visitPage, eventPage, key]);
  const save = async (input: VisitsInput) => {
    if (writing.current || storageBlocked.current || successfulReceipt.current || !snapshot || snapshot.actor.role === 'owner') return;
    const existing = pendingRef.current;
    if (existing ? existing.actor !== snapshot.actor.userId : !mayEdit || input.customerId !== customerId || input.interestId !== interestId) return;
    writing.current = true; setBusy(true); setError(''); setNotice('');
    const actor = existing?.actor ?? snapshot.actor.userId;
    let receipt: Pending;
    try {
      const normalized = writeVisitsPending(actor, existing?.input ?? input);
      receipt = { actor, input: normalized, uncertain: existing?.uncertain ?? false }; setReceipt(receipt);
    } catch (failure) { blockStorage(failure); setBusy(false); writing.current = false; return; }
    try {
      const result = await api.save(receipt.input, actor); successfulReceipt.current = true;
      try { clearVisitsPending(actor, receipt.input); }
      catch (failure) { if (mounted.current) setNotice('บันทึกสำเร็จแล้ว ห้ามส่งซ้ำ'); blockStorage(failure); return; }
      setReceipt(null); successfulReceipt.current = false;
      if (mounted.current) {
        setNotice(`บันทึกสำเร็จแล้ว · ลูกค้า ${result.customerId} · โครงการที่สนใจ ${result.interestId} · กำลังอ่านข้อมูลล่าสุด`);
        setEditor(null); setAppointmentPage(0); setVisitPage(0); setEventPage(0); setRevision(value => value + 1);
      }
    } catch (failure) {
      if (failure instanceof VisitsApiError && failure.definitelyNotSaved && !receipt.uncertain) {
        try { clearVisitsPending(actor, receipt.input); setReceipt(null); } catch (storageFailure) { blockStorage(storageFailure); }
      } else setReceipt({ ...receipt, uncertain: true });
      if (mounted.current) setError(failure instanceof Error ? failure.message : 'ยังยืนยันผลบันทึกไม่ได้');
    } finally { writing.current = false; if (mounted.current) setBusy(false); }
  };
  const changePage = (kind: 'appointment' | 'visit' | 'event', page: number) => {
    if (locked) return; setEditor(null); setError('');
    if (kind === 'appointment') setAppointmentPage(page); else if (kind === 'visit') setVisitPage(page); else setEventPage(page);
  };
  const selectedAppointment = editor?.appointmentId ? snapshot?.appointments.find(row => row.id === editor.appointmentId) : undefined;
  const selectedVisit = editor?.visitId ? snapshot?.visits.find(row => row.id === editor.visitId) : undefined;
  return <main className="mx-auto max-w-6xl space-y-5 p-4 sm:p-8">
    <header className="flex flex-wrap justify-between gap-3"><div><h1 className="text-2xl font-bold">นัดหมายและเข้าชมโครงการ</h1>
      <p className="text-sm text-slate-600">จาก Lead ส่วนกลาง · แยกตามโครงการที่สนใจ · เก็บประวัติทุกครั้ง</p></div>
      {!locked ? <Link href="/sales-crm" prefetch={false} className="text-blue-700 underline">กลับ Lead ส่วนกลาง</Link> : <p>ตรวจผลคำขอค้างก่อนออกจากหน้านี้</p>}
    </header>
    <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">เช็คอินยังไม่นับเป็น Visit สำเร็จ ต้องส่ง Customer Voices ของการเข้าชมครั้งนั้นและผ่านการตรวจตามกติกาก่อน ไม่มีปุ่มปิด Visit สำเร็จด้วยมือ</p>
    {notice && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-emerald-800">{notice}</p>}
    {(error || storageError) && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-rose-800">{storageError || error}</p>}
    {pending && <section aria-label="คำขอนัดหมายและเข้าชมค้าง" className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-4">
      <h2 className="font-bold">มีคำขอที่ต้องตรวจผลก่อนเริ่มรายการใหม่</h2><p className="break-all text-sm">{visitCommandLabels[pending.input.command]} · คำขอ {pending.input.requestId} · ลูกค้า {pending.input.customerId} · โครงการที่สนใจ {pending.input.interestId}</p>
      {(pending.input.customerId !== customerId || pending.input.interestId !== interestId) && <p>คำขอนี้เป็นของลูกค้าหรือโครงการอื่น จะตรวจด้วยข้อมูลเดิมเท่านั้น</p>}
      <p className="text-sm">เก็บคำขอชั่วคราวในแท็บนี้ ห้ามล้างข้อมูลแท็บ หากเปลี่ยนบัญชีให้กลับเข้าบัญชีผู้ทำรายการเดิม</p>
      <button className={bookingButtonClass} disabled={busy || !!storageError || !snapshot || snapshot.actor.role === 'owner' || pending.actor !== snapshot.actor.userId}
        onClick={() => void save(pending.input)}>{busy ? 'กำลังตรวจผล…' : 'ตรวจผลซ้ำด้วยคำขอเดิม'}</button>
    </section>}
    {!snapshot ? loaded.key === key && loaded.api === api && loaded.error ? <section role="alert" className="space-y-3 rounded-lg border p-4"><p>{loaded.error}</p>
      <p>ไม่แสดงข้อมูลเก่าแทน และการโหลดใหม่ไม่ส่งคำขอบันทึก</p><button className={bookingButtonClass} disabled={busy} onClick={() => setRevision(value => value + 1)}>โหลดข้อมูลใหม่</button></section>
      : <p role="status">กำลังโหลดนัดหมายและการเข้าชม…</p> : <>
      <section aria-label="ลูกค้าและโครงการที่สนใจ" className="space-y-3 rounded-xl border bg-white p-5"><h2 className="text-xl font-bold">{snapshot.scope.customerName}</h2>
        <p>{snapshot.scope.projectName}</p><p className="break-all text-xs text-slate-500">ลูกค้า {customerId} · โครงการที่สนใจ {interestId} · ผู้รับผิดชอบ {snapshot.scope.ownerUserId}</p>
        {snapshot.actor.role === 'owner' ? <p>Owner ดูข้อมูลได้อย่างเดียว</p> : !mayEdit && <p>ดูประวัติได้ แต่ไม่มีสิทธิ์บันทึกหรือสถานะ Lead นี้ยังไม่เปิดให้ทำรายการ</p>}
        <div className="flex flex-wrap gap-3">{mayEdit && <><button className={bookingButtonClass} disabled={locked} onClick={() => setEditor({ action: 'schedule' })}>สร้างนัดหมาย</button>
          <button className={bookingButtonClass} disabled={locked} onClick={() => setEditor({ action: 'check_in' })}>เช็คอิน Walk-in ไม่มีนัด</button></>}
          <button className={bookingButtonClass} disabled={locked} onClick={() => { setEditor(null); setRevision(value => value + 1); }}>โหลดประวัติล่าสุด</button></div>
      </section>
      {editor && mayEdit && (!editor.appointmentId || selectedAppointment) && (!editor.visitId || selectedVisit) && <VisitActionForm key={`${key}:${editor.action}:${editor.appointmentId ?? editor.visitId ?? 'new'}`}
        snapshot={snapshot} action={editor.action} appointment={selectedAppointment} visit={selectedVisit} disabled={locked} onSubmit={input => void save(input)} onClose={() => setEditor(null)} />}
      <section aria-label="นัดหมายทั้งหมด" className="space-y-3 rounded-xl border bg-white p-5"><h2 className="text-lg font-bold">นัดหมาย</h2><p className="text-sm">หน้า {appointmentPage + 1} · ไม่เกิน 50 รายการต่อหน้า</p>
        {!snapshot.appointments.length && <p>ไม่มีนัดหมายในหน้านี้</p>}
        {snapshot.appointments.map(row => <article key={row.id} aria-label={`นัดหมาย ${row.id}`} className="space-y-2 rounded-lg border p-4">
          <h3 className="font-bold">{displayBangkokTime(row.startsAt)} · {appointmentLabels[row.status]}</h3><p className="text-sm">สิ้นสุด: {displayBangkokTime(row.endsAt)}</p>
          <p className="break-all text-xs text-slate-500">รหัสนัด {row.id} · ผู้รับผิดชอบ {row.assignedSalesUserId}</p>
          {sopEnabled && !locked && !editor && <Link prefetch={false} className="inline-block text-sm text-blue-700 underline"
            href={`/sales-crm/sop?${new URLSearchParams({ customerId, interestId, appointmentId: row.id })}`}>SOP เตรียมบ้าน / ประวัติของนัด {row.id}</Link>}
          {mayEdit && activeAppointment(row.status) && <div className="flex flex-wrap gap-2">{(['reschedule', 'cancel_appointment', 'no_show', 'check_in'] as const).map(action =>
            <button key={action} className={bookingButtonClass} disabled={locked} onClick={() => setEditor({ action, appointmentId: row.id })}>{visitCommandLabels[action]}</button>)}</div>}
        </article>)}
        <div className="flex gap-3"><button className={bookingButtonClass} disabled={locked || appointmentPage === 0} onClick={() => changePage('appointment', appointmentPage - 1)}>นัดก่อนหน้า</button>
          <button className={bookingButtonClass} disabled={locked || !snapshot.appointmentsHasMore} onClick={() => changePage('appointment', appointmentPage + 1)}>นัดถัดไป</button></div>
      </section>
      <section aria-label="การเข้าชมทั้งหมด" className="space-y-3 rounded-xl border bg-white p-5"><h2 className="text-lg font-bold">การเข้าชมทุกครั้ง</h2><p className="text-sm">หน้า {visitPage + 1} · ไม่เกิน 50 รายการต่อหน้า</p>
        {!snapshot.visits.length && <p>ไม่มีการเข้าชมในหน้านี้</p>}
        {snapshot.visits.map(row => <article key={row.id} aria-label={`การเข้าชม ${row.id}`} className="space-y-2 rounded-lg border p-4"><h3 className="font-bold">{visitLabels[row.status]}</h3>
          <p>เช็คอิน: {displayBangkokTime(row.checkedInAt)}</p><p className="text-sm">{row.appointmentId ? `จากนัดหมาย ${row.appointmentId}` : 'Walk-in ไม่มีนัดหมาย'}</p>
          {row.status === 'completed' && <p>สำเร็จ: {displayBangkokTime(row.completedAt)} · Customer Voices {row.completedVoiceId}</p>}
          <p className="break-all text-xs text-slate-500">รหัส Visit {row.id} · ผู้เช็คอิน {row.checkedInByUserId}</p>
          {voicesEnabled && row.status !== 'cancelled' && !locked && !editor && <Link prefetch={false} className="mr-4 inline-block text-sm text-blue-700 underline"
            href={`/sales-crm/customer-voices?${new URLSearchParams({ customerId, interestId, visitId: row.id })}`}>{row.status === 'completed' ? 'ดู Customer Voices ของครั้งนี้' : 'QR แบบประเมิน Customer Voices'}</Link>}
          {sopEnabled && !locked && !editor && <Link prefetch={false} className="inline-block text-sm text-blue-700 underline"
            href={`/sales-crm/sop?${new URLSearchParams({ customerId, interestId, visitId: row.id })}`}>SOP พาชม / ปิดบ้าน / ประวัติ Visit {row.id}</Link>}
          {mayEdit && row.status === 'awaiting_voice' && <button className={bookingButtonClass} disabled={locked} onClick={() => setEditor({ action: 'cancel_visit', visitId: row.id })}>ยกเลิกการเข้าชม</button>}
        </article>)}
        <div className="flex gap-3"><button className={bookingButtonClass} disabled={locked || visitPage === 0} onClick={() => changePage('visit', visitPage - 1)}>Visit ก่อนหน้า</button>
          <button className={bookingButtonClass} disabled={locked || !snapshot.visitsHasMore} onClick={() => changePage('visit', visitPage + 1)}>Visit ถัดไป</button></div>
      </section>
      <section aria-label="ประวัติการเปลี่ยนแปลง" className="space-y-3 rounded-xl border bg-white p-5"><h2 className="text-lg font-bold">ประวัติพร้อมเหตุผล</h2><p className="text-sm">หน้า {eventPage + 1} · ไม่เกิน 50 รายการต่อหน้า · ไม่มีปุ่มแก้ไขหรือลบประวัติ</p>
        {!snapshot.events.length && <p>ไม่มีเหตุการณ์ในหน้านี้</p>}
        {snapshot.events.map(row => <article key={row.id} aria-label={`เหตุการณ์ ${row.id}`} className="space-y-2 rounded-lg border p-4"><h3 className="font-bold">{visitCommandLabels[row.command]}</h3>
          <p>เกิดเหตุการณ์: {displayBangkokTime(row.occurredAt)}</p><p className="text-sm">บันทึกเข้าระบบ: {displayBangkokTime(row.recordedAt)}</p><p>เหตุผล: {row.reason}</p>
          {row.details.previousStartsAt && <p className="text-sm">เริ่มนัดเดิม: {displayBangkokTime(row.details.previousStartsAt)}</p>}
          {row.details.startsAt && <p className="text-sm">เริ่มนัดใหม่: {displayBangkokTime(row.details.startsAt)}</p>}
          <p className="break-all text-xs text-slate-500">ผู้บันทึก {row.actorUserId}{row.appointmentId ? ` · นัดหมาย ${row.appointmentId}` : ''}{row.visitId ? ` · Visit ${row.visitId}` : ''}</p>
        </article>)}
        <div className="flex gap-3"><button className={bookingButtonClass} disabled={locked || eventPage === 0} onClick={() => changePage('event', eventPage - 1)}>เหตุการณ์ก่อนหน้า</button>
          <button className={bookingButtonClass} disabled={locked || !snapshot.eventsHasMore} onClick={() => changePage('event', eventPage + 1)}>เหตุการณ์ถัดไป</button></div>
      </section>
    </>}
  </main>;
}
