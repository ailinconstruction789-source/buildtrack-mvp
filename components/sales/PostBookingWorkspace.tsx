'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { postBookingApi, PostBookingApiError, type PostBookingApi } from '@/lib/sales/postBookingClient';
import { displayTransferDate, postBookingTargets, type PostBookingInput, type PostBookingSnapshot } from '@/lib/sales/postBookingContracts';
import { clearPostBookingPending, readPostBookingPending, writePostBookingPending, PostBookingPendingError } from '@/lib/sales/postBookingPending';
import { displayBangkokTime } from '@/lib/sales/leadWorkDates';
import type { SaleStage } from '@/lib/sales/workflow';
import { bookingButtonClass } from './BookingForm';
import PostBookingForm, { postBookingStageLabels } from './PostBookingForm';

interface Props { saleId: string; api?: PostBookingApi }
interface Pending { actor: string; input: PostBookingInput; uncertain: boolean }
const loanLabels = { submitted: 'ยื่นแล้ว', pending: 'รอผล', rejected: 'ปฏิเสธ', approved: 'อนุมัติ', withdrawn: 'ถอนคำขอ' };
const money = (value: number | null) => value === null ? 'ไม่ทราบ' : `${value.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท`;

export default function PostBookingWorkspace(props: Props) {
  return <PostBookingSession key={props.saleId} {...props} />;
}
function PostBookingSession({ saleId, api = postBookingApi }: Props) {
  const [attemptPage, setAttemptPage] = useState(0), [eventPage, setEventPage] = useState(0), [revision, setRevision] = useState(0);
  const [loaded, setLoaded] = useState<{ key: string; api?: PostBookingApi; snapshot?: PostBookingSnapshot; error?: string }>({ key: '' });
  const [target, setTarget] = useState<SaleStage | null>(null), [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [storageError, setStorageError] = useState(''), [notice, setNotice] = useState('');
  const mounted = useRef(false), writing = useRef(false), pendingRef = useRef<Pending | null>(null), storageBlocked = useRef(false);
  const recoveredActor = useRef(''), successfulReceipt = useRef(false);
  const key = `${saleId}:${attemptPage}:${eventPage}:${revision}`;
  const snapshot = loaded.key === key && loaded.api === api ? loaded.snapshot : undefined;
  const mayEdit = !!snapshot && snapshot.sale.canEdit && snapshot.actor.role !== 'owner'
    && (snapshot.actor.role === 'admin' || snapshot.actor.userId === snapshot.sale.ownerUserId);
  const locked = !!pending || busy || !!storageError;
  const setReceipt = (value: Pending | null) => { pendingRef.current = value; if (mounted.current) setPending(value); };
  const blockStorage = (failure: unknown) => {
    storageBlocked.current = true;
    if (mounted.current) setStorageError(failure instanceof Error ? failure.message : 'ตรวจคำขอค้างไม่ได้ กรุณาให้ Admin ตรวจสอบ');
  };

  useEffect(() => {
    mounted.current = true;
    const isBlocked = () => pendingRef.current !== null || writing.current || storageBlocked.current || successfulReceipt.current;
    const unload = (event: BeforeUnloadEvent) => { if (isBlocked()) { event.preventDefault(); event.returnValue = ''; } };
    const navigation = (event: MouseEvent) => {
      if (isBlocked() && event.target instanceof Element && event.target.closest('a[href]')) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener('beforeunload', unload); document.addEventListener('click', navigation, true);
    return () => { mounted.current = false; window.removeEventListener('beforeunload', unload); document.removeEventListener('click', navigation, true); };
  }, []);
  useEffect(() => {
    let cancelled = false;
    api.read({ saleId, attemptPage, eventPage }).then(value => {
      if (cancelled) return;
      try {
        if (pendingRef.current && pendingRef.current.actor !== value.actor.userId) throw new PostBookingPendingError();
        if (recoveredActor.current !== value.actor.userId) {
          const receipt = readPostBookingPending(value.actor.userId);
          recoveredActor.current = value.actor.userId;
          if (receipt) {
            const recovered = { actor: value.actor.userId, input: receipt, uncertain: true };
            pendingRef.current = recovered; setPending(recovered);
          }
        }
      } catch (failure) {
        storageBlocked.current = true;
        setStorageError(failure instanceof Error ? failure.message : 'ตรวจคำขอค้างไม่ได้ กรุณาให้ Admin ตรวจสอบ');
      }
      setLoaded({ key, api, snapshot: value });
    }).catch(failure => { if (!cancelled) setLoaded({ key, api, error: failure instanceof Error ? failure.message : 'โหลดข้อมูลหลังจองไม่ได้' }); });
    return () => { cancelled = true; };
  }, [api, saleId, attemptPage, eventPage, key]);

  const save = async (input: PostBookingInput) => {
    if (writing.current || storageBlocked.current || successfulReceipt.current || !snapshot || snapshot.actor.role === 'owner') return;
    const existing = pendingRef.current;
    // Recovery is deliberately not limited to the currently displayed sale; the server rechecks the original command.
    if (existing ? existing.actor !== snapshot.actor.userId : !mayEdit || input.saleId !== snapshot.sale.id) return;
    writing.current = true; setBusy(true); setError(''); setNotice('');
    const actor = existing?.actor ?? snapshot.actor.userId;
    let receipt: Pending;
    try {
      const normalized = writePostBookingPending(actor, existing?.input ?? input);
      receipt = { actor, input: normalized, uncertain: existing?.uncertain ?? false };
      setReceipt(receipt);
    } catch (failure) { blockStorage(failure); setBusy(false); writing.current = false; return; }
    try {
      const result = await api.save(receipt.input, actor);
      successfulReceipt.current = true;
      try { clearPostBookingPending(actor, receipt.input); }
      catch (failure) {
        if (mounted.current) setNotice(`บันทึกสำเร็จแล้ว · รหัสจอง ${result.saleId} · ห้ามส่งซ้ำ`);
        blockStorage(failure); return;
      }
      setReceipt(null); successfulReceipt.current = false;
      if (mounted.current) {
        setNotice(`บันทึกสำเร็จแล้ว · รหัสจอง ${result.saleId} · กำลังอ่านข้อมูลล่าสุด`);
        setTarget(null); setAttemptPage(0); setEventPage(0); setRevision(value => value + 1);
      }
    } catch (failure) {
      if (failure instanceof PostBookingApiError && failure.definitelyNotSaved && !receipt.uncertain) {
        try { clearPostBookingPending(actor, receipt.input); setReceipt(null); } catch (storageFailure) { blockStorage(storageFailure); }
      } else setReceipt({ ...receipt, uncertain: true });
      if (mounted.current) setError(failure instanceof Error ? failure.message : 'ยังยืนยันผลบันทึกไม่ได้');
    } finally { writing.current = false; if (mounted.current) setBusy(false); }
  };
  const targets = snapshot && mayEdit ? postBookingTargets(snapshot.sale.stage, snapshot.sale.paymentMethod) : [];
  const changePage = (kind: 'attempt' | 'event', page: number) => {
    if (locked) return;
    setTarget(null); setError('');
    if (kind === 'attempt') setAttemptPage(page); else setEventPage(page);
  };

  return <main className="mx-auto max-w-6xl space-y-5 p-4 sm:p-8">
    <header className="flex flex-wrap justify-between gap-3"><div><h1 className="text-2xl font-bold">งานหลังจอง</h1>
      <p className="mt-1 text-sm text-slate-600">ลูกค้าจาก Lead ส่วนกลาง · ประวัติแยกตามรอบจอง · เก็บทุกรอบยื่นกู้และเหตุผล</p></div>
      {!locked ? <nav aria-label="ไปยังส่วนงานขาย" className="flex flex-wrap gap-4 text-blue-700 underline">
        <Link href="/sales-crm" prefetch={false}>Lead ส่วนกลาง</Link>
        <Link href={snapshot ? `/sales-crm/projects?projectName=${encodeURIComponent(snapshot.sale.projectName)}` : '/sales-crm/projects'} prefetch={false}>ลูกค้าจองในโครงการ</Link>
        {snapshot && <Link href={`/sales-crm/bookings?customerId=${snapshot.sale.customerId}`} prefetch={false}>ประวัติจอง / ยกเลิกจอง</Link>}
      </nav> : <p className="text-sm text-slate-600">ตรวจผลคำขอค้างก่อนออกจากหน้านี้</p>}
    </header>
    <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">บันทึกได้ถึงยืนยันโอนจริง โดยใช้วันโอนจริงและเหตุผล ไม่ต้องแนบไฟล์หรืออ้างอิงเอกสาร ยังไม่เปิดส่งมอบ ส่วนรายละเอียดหลักฐานของงานอื่นเป็นข้อความที่ผู้บันทึกระบุ ไม่ใช่การตรวจยืนยันเอกสารจากธนาคาร</p>
    {notice && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-emerald-800">{notice}</p>}
    {(error || storageError) && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-rose-800">{storageError || error}</p>}
    {pending && <section aria-label="คำขอหลังจองค้าง" className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-4">
      <h2 className="font-bold">มีคำขอที่ต้องตรวจผลก่อนเริ่มรายการใหม่</h2>
      <p className="break-all text-sm">คำขอ {pending.input.requestId} · {pending.input.command} · รหัสจอง {pending.input.saleId} · ลูกค้า {pending.input.customerId}</p>
      {pending.input.saleId !== saleId && <p className="font-semibold">คำขอนี้เป็นของรอบจองอื่น การตรวจผลจะใช้ข้อมูลเดิมของคำขอนั้นเท่านั้น</p>}
      <p className="text-sm">เก็บคำขอชั่วคราวในแท็บนี้ ห้ามล้างข้อมูลแท็บ หากเปลี่ยนบัญชีให้กลับเข้าบัญชีผู้ทำรายการเดิม</p>
      <button className={bookingButtonClass} disabled={busy || !!storageError || !snapshot || snapshot.actor.role === 'owner' || pending.actor !== snapshot.actor.userId}
        onClick={() => void save(pending.input)}>{busy ? 'กำลังตรวจผล…' : 'ตรวจผลซ้ำด้วยคำขอเดิม'}</button>
    </section>}
    {!snapshot ? loaded.key === key && loaded.api === api && loaded.error ? <section role="alert" className="space-y-3 rounded-lg border p-4">
      <p>{loaded.error}</p><p>ไม่แสดงข้อมูลเก่าแทน และการโหลดใหม่จะไม่ส่งคำขอบันทึก</p>
      <button disabled={busy} className={bookingButtonClass} onClick={() => setRevision(value => value + 1)}>โหลดข้อมูลใหม่</button>
    </section> : <p role="status">กำลังโหลดข้อมูลหลังจอง…</p> : <>
      <section className="space-y-3 rounded-xl border bg-white p-5" aria-label="ข้อมูลรอบจอง">
        <div className="flex flex-wrap justify-between gap-3"><h2 className="text-xl font-bold">{snapshot.sale.customerName}</h2><strong className="text-blue-800">{postBookingStageLabels[snapshot.sale.stage]}</strong></div>
        <p>{snapshot.sale.projectName} · แปลง {snapshot.sale.plotId ?? 'ไม่ทราบ'}</p>
        <dl className="grid gap-3 text-sm sm:grid-cols-4"><div><dt>การชำระ</dt><dd>{snapshot.sale.paymentMethod === 'cash' ? 'เงินสด' : snapshot.sale.paymentMethod === 'mortgage' ? 'กู้ธนาคาร' : 'ไม่ทราบ'}</dd></div>
          <div><dt>วันที่จอง</dt><dd>{displayBangkokTime(snapshot.sale.bookedAt)}</dd></div><div><dt>วันที่ทำสัญญา</dt><dd>{displayBangkokTime(snapshot.sale.contractedAt)}</dd></div>
          <div><dt>วันโอนจริง</dt><dd>{displayTransferDate(snapshot.sale.transferDate)}</dd></div></dl>
        <p className="break-all text-xs text-slate-500">รหัสลูกค้า {snapshot.sale.customerId} · รหัสจอง {snapshot.sale.id} · ผู้รับผิดชอบ {snapshot.sale.ownerUserId}</p>
        {snapshot.actor.role === 'owner' ? <p>Owner ดูข้อมูลได้อย่างเดียว</p> : !mayEdit && <p>ดูประวัติได้ แต่บัญชีหรือสถานะนี้ยังไม่เปิดให้บันทึกต่อในหน้านี้</p>}
        {snapshot.sale.paymentMethod === null && <p className="text-amber-800">ข้อมูลเก่าไม่ทราบวิธีชำระ อ่านได้อย่างเดียว กรุณาให้ Admin ตรวจสอบหลักฐานก่อนใช้งานขั้นถัดไป</p>}
        <div className="flex flex-wrap gap-3">{targets.map(value => <button key={value} className={bookingButtonClass} disabled={locked}
          onClick={() => { setTarget(value); setError(''); }}>{value === 'transferred' ? 'ยืนยันโอนจริง' : `บันทึก${postBookingStageLabels[value]}`}</button>)}
          <button className={bookingButtonClass} disabled={locked} onClick={() => { setTarget(null); setRevision(value => value + 1); }}>โหลดประวัติล่าสุด</button></div>
      </section>
      {target && targets.includes(target) && <PostBookingForm key={`${key}:${target}`} snapshot={snapshot} target={target} disabled={locked} onSubmit={input => void save(input)} onClose={() => setTarget(null)} />}
      <section aria-label="ประวัติยื่นกู้" className="space-y-3 rounded-xl border bg-white p-5"><h2 className="text-lg font-bold">ประวัติยื่นกู้ทุกรอบ</h2>
        <p className="text-sm text-slate-600">หน้า {attemptPage + 1} · ไม่เกิน 50 รายการต่อหน้า · ไม่แทนข้อมูลที่ไม่มีหลักฐานด้วยวันที่หรือวงเงินสมมติ</p>
        {snapshot.latestAttempt && <p>รอบล่าสุด: {snapshot.latestAttempt.attemptNumber} · {snapshot.latestAttempt.bankName} · {loanLabels[snapshot.latestAttempt.status]}</p>}
        {!snapshot.attempts.length && <p>ไม่มีรายการยื่นกู้ในหน้านี้</p>}
        {snapshot.attempts.map(attempt => <article key={attempt.id} aria-label={`ยื่นกู้รอบ ${attempt.attemptNumber}`} className="space-y-2 rounded-lg border p-4">
          <h3 className="font-bold">รอบ {attempt.attemptNumber} · {attempt.bankName} · {loanLabels[attempt.status]}</h3>
          <p className="text-sm">วันที่ยื่น: {displayBangkokTime(attempt.submittedAt)} · วันที่ผล: {displayBangkokTime(attempt.resultAt)}</p>
          <p>วงเงินอนุมัติ: {money(attempt.approvedAmount)}</p><p>เหตุผลผลพิจารณา: {attempt.resultReason ?? 'ไม่ทราบ'}</p>
          <p className="break-all text-xs text-slate-500">รหัสยื่นกู้ {attempt.id} · ผู้บันทึก {attempt.recordedByUserId}</p>
        </article>)}
        <div className="flex gap-3"><button className={bookingButtonClass} disabled={locked || attemptPage === 0} onClick={() => changePage('attempt', attemptPage - 1)}>รอบกู้ก่อนหน้า</button>
          <button className={bookingButtonClass} disabled={locked || !snapshot.attemptsHasMore} onClick={() => changePage('attempt', attemptPage + 1)}>รอบกู้ถัดไป</button></div>
      </section>
      <section aria-label="ประวัติเปลี่ยนสถานะ" className="space-y-3 rounded-xl border bg-white p-5"><h2 className="text-lg font-bold">ประวัติเปลี่ยนสถานะหลังจอง</h2>
        <p className="text-sm text-slate-600">หน้า {eventPage + 1} · ไม่เกิน 50 รายการต่อหน้า · ประวัติเหตุการณ์เก็บถาวร ไม่มีปุ่มแก้ไขหรือลบ</p>
        {!snapshot.events.length && <p>ไม่มีเหตุการณ์หลังจองในหน้านี้</p>}
        {snapshot.events.map(event => <article key={event.id} aria-label={`เหตุการณ์ ${event.id}`} className="space-y-2 rounded-lg border p-4">
          <h3 className="font-bold">{postBookingStageLabels[event.fromStage]} → {postBookingStageLabels[event.toStage]}</h3>
          {event.command === 'confirm_transfer' ? <p className="text-sm">วันโอนจริง: {displayTransferDate(event.transferDate)}</p>
            : <p className="text-sm">เกิดเหตุการณ์: {displayBangkokTime(event.occurredAt)}</p>}
          <p className="text-sm">บันทึกเข้าระบบ: {displayBangkokTime(event.recordedAt)}</p>
          <p>เหตุผล: {event.reason}</p>{event.evidenceNote !== null && <p>หลักฐานที่ผู้บันทึกอ้างอิง: {event.evidenceNote}</p>}
          <p className="break-all text-xs text-slate-500">ผู้บันทึก {event.actorUserId}{event.loanAttemptId ? ` · รหัสยื่นกู้ ${event.loanAttemptId}` : ''}</p>
        </article>)}
        <div className="flex gap-3"><button className={bookingButtonClass} disabled={locked || eventPage === 0} onClick={() => changePage('event', eventPage - 1)}>เหตุการณ์ก่อนหน้า</button>
          <button className={bookingButtonClass} disabled={locked || !snapshot.eventsHasMore} onClick={() => changePage('event', eventPage + 1)}>เหตุการณ์ถัดไป</button></div>
      </section>
    </>}
  </main>;
}
