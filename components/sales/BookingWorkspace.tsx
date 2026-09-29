'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { bookingApi, BookingApiError, type BookingApi } from '@/lib/sales/bookingClient';
import { type BookingContext, type BookingInput, type BookingSearch } from '@/lib/sales/bookingContracts';
import { BookingPendingError, clearBookingPending, readBookingPending, writeBookingPending } from '@/lib/sales/bookingPending';
import { bookingRoundLabel, displayBookingHistoryDate } from '@/lib/sales/importedBookingHistory';
import BookingForm, { bookingButtonClass, bookingFieldClass } from './BookingForm';
import BookingActionForm, { cancellationLabels } from './BookingActionForm';
import PostBookingLink from './PostBookingLink';

interface Props { initialCustomerId?: string | null; api?: BookingApi }
interface Pending { actor: string; input: BookingInput; uncertain: boolean }
type Editor = { type: 'book'; newCustomer: boolean } | { type: 'cancel' | 'resume_follow_up'; saleId: string } | null;
const money = (value: number | null) => value === null ? 'ไม่ทราบ' : `${value.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท`;
const stageLabels: Record<string, string> = { booked: 'จอง', contracted: 'ทำสัญญา', downpayment: 'ดาวน์', document_prep: 'เตรียมเอกสาร', loan_submitted: 'ยื่นกู้', loan_rejected: 'กู้ถูกปฏิเสธ', loan_approved: 'กู้อนุมัติ', transfer_pending: 'รอโอน', transferred: 'โอนแล้ว', handover: 'ส่งมอบ', cancelled: 'ยกเลิก' };

export default function BookingWorkspace(props: Props) {
  return <BookingWorkspaceSession key={props.initialCustomerId ?? 'search'} {...props} />;
}
function BookingWorkspaceSession({ initialCustomerId = null, api = bookingApi }: Props) {
  const [customerId, setCustomerId] = useState(initialCustomerId), [page, setPage] = useState(0), [revision, setRevision] = useState(0);
  const [loaded, setLoaded] = useState<{ key: string; context?: BookingContext; error?: string }>({ key: '' });
  const [editor, setEditor] = useState<Editor>(null), [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [storageError, setStorageError] = useState(''), [notice, setNotice] = useState('');
  const [query, setQuery] = useState(''), [searchBusy, setSearchBusy] = useState(false);
  const [search, setSearch] = useState<{ query: string; result: BookingSearch } | null>(null);
  const mounted = useRef(false), writing = useRef(false), pendingRef = useRef<Pending | null>(null), searchSequence = useRef(0);
  const recoveredActor = useRef(''), successfulReceipt = useRef(false);
  const key = `${customerId ?? 'new'}:${page}:${revision}`;
  const context = loaded.key === key ? loaded.context : undefined;
  const locked = !!pending || busy || !!storageError;
  const setReceipt = (value: Pending | null) => { pendingRef.current = value; if (mounted.current) setPending(value); };

  useEffect(() => {
    mounted.current = true;
    const unload = (event: BeforeUnloadEvent) => { if (pendingRef.current || writing.current) { event.preventDefault(); event.returnValue = ''; } };
    const navigation = (event: MouseEvent) => {
      if ((pendingRef.current || writing.current) && event.target instanceof Element && event.target.closest('a[href]')) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener('beforeunload', unload); document.addEventListener('click', navigation, true);
    return () => { mounted.current = false; window.removeEventListener('beforeunload', unload); document.removeEventListener('click', navigation, true); };
  }, []);
  useEffect(() => {
    let cancelled = false;
    api.read(customerId, page).then(value => {
      if (cancelled) return;
      try {
        if (pendingRef.current && pendingRef.current.actor !== value.actor.userId) throw new BookingPendingError();
        if (recoveredActor.current !== value.actor.userId) {
          const receipt = readBookingPending(value.actor.userId);
          recoveredActor.current = value.actor.userId;
          if (receipt) {
            const recovered = { actor: value.actor.userId, input: receipt, uncertain: true };
            pendingRef.current = recovered; setPending(recovered);
          }
        }
      } catch (failure) { setStorageError(failure instanceof Error ? failure.message : 'ตรวจคำขอค้างไม่ได้'); }
      setLoaded({ key, context: value });
    }).catch(failure => { if (!cancelled) setLoaded({ key, error: failure instanceof Error ? failure.message : 'โหลดการจองไม่ได้' }); });
    return () => { cancelled = true; };
  }, [api, customerId, page, key]);

  const save = async (input: BookingInput) => {
    if (writing.current || storageError || successfulReceipt.current || !context || context.actor.role === 'owner') return;
    writing.current = true; setBusy(true); setError('');
    const existing = pendingRef.current;
    const actor = existing?.actor ?? context.actor.userId;
    let receipt: Pending;
    try {
      const normalized = writeBookingPending(actor, existing?.input ?? input);
      receipt = { actor, input: normalized, uncertain: existing?.uncertain ?? false };
      setReceipt(receipt);
    } catch (failure) {
      setStorageError(failure instanceof Error ? failure.message : 'เก็บคำขอไม่ได้'); setBusy(false); writing.current = false; return;
    }
    try {
      const result = await api.save(receipt.input, actor);
      successfulReceipt.current = true;
      try { clearBookingPending(actor, receipt.input); }
      catch (failure) {
        if (mounted.current) { setNotice('บันทึกสำเร็จแล้ว ห้ามส่งซ้ำ'); setStorageError(failure instanceof Error ? failure.message : 'ล้างคำขอที่สำเร็จไม่ได้'); }
        return;
      }
      setReceipt(null); successfulReceipt.current = false;
      if (mounted.current) {
        setNotice(result.command === 'resume_follow_up' ? 'บันทึกงานติดตามแล้ว ประวัติการจองที่ยกเลิกยังคงเดิม' : 'บันทึกสำเร็จแล้ว กำลังอ่านข้อมูลล่าสุด');
        setEditor(null); setCustomerId(result.customerId); setPage(0); setRevision(value => value + 1);
      }
    } catch (failure) {
      if (failure instanceof BookingApiError && failure.definitelyNotSaved && !receipt.uncertain) {
        try { clearBookingPending(actor, receipt.input); setReceipt(null); }
        catch (storageFailure) { if (mounted.current) setStorageError(storageFailure instanceof Error ? storageFailure.message : 'ตรวจคำขอไม่ได้'); }
      } else setReceipt({ ...receipt, uncertain: true });
      if (mounted.current) setError(failure instanceof Error ? failure.message : 'ยังยืนยันผลบันทึกไม่ได้');
    } finally { writing.current = false; if (mounted.current) setBusy(false); }
  };
  const find = async (searchPage = 0) => {
    if (locked || query.trim().length < 2) return;
    const searched = query.trim(), sequence = ++searchSequence.current;
    setSearchBusy(true); setError(''); setSearch(null); setEditor(null);
    try {
      const result = await api.search(searched, searchPage);
      if (mounted.current && sequence === searchSequence.current) setSearch({ query: searched, result });
    } catch (failure) { if (mounted.current && sequence === searchSequence.current) setError(failure instanceof Error ? failure.message : 'ค้นหาไม่ได้'); }
    finally { if (mounted.current && sequence === searchSequence.current) setSearchBusy(false); }
  };
  const chooseCustomer = (id: string | null) => {
    if (locked) return; searchSequence.current++; setSearchBusy(false); setCustomerId(id); setPage(0); setEditor(null); setError(''); setNotice(''); setSearch(null);
  };
  const selectedSale = editor && editor.type !== 'book' ? context?.sales.find(sale => sale.id === editor.saleId) : undefined;
  const mayBook = context && context.actor.role !== 'owner' && (context.actor.role === 'admin' || context.customer?.ownerUserId === context.actor.userId || context.interests.some(interest => interest.canEdit));

  return <main className="mx-auto max-w-6xl space-y-5 p-4 sm:p-8">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-bold">การจองและประวัติลูกค้าส่วนกลาง</h1>
      <p className="mt-1 text-sm text-slate-600">ลูกค้าคนเดิมเชื่อมทุกรอบจอง แยกโครงการและแปลง ไม่ลบประวัติยกเลิก</p></div>
      {!locked ? <Link href="/sales-crm" prefetch={false} className="text-blue-700 underline">← Lead ส่วนกลาง</Link> : <span className="text-sm text-slate-500">ตรวจผลคำขอค้างก่อนออกจากหน้านี้</span>}
    </header>
    {notice && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-emerald-800">{notice}</p>}
    {(error || storageError) && <div role="alert" className="rounded-lg bg-rose-50 p-3 text-rose-800">{storageError || error}</div>}
    {pending && <section aria-label="คำขอการจองค้าง" className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-4">
      <h2 className="font-bold">มีคำขอที่ต้องตรวจผลก่อนเริ่มรายการใหม่</h2>
      <p className="break-all text-sm">คำขอ {pending.input.requestId} · {pending.input.command} · ลูกค้า {pending.input.customerId ?? 'สร้างพร้อมจอง'}{pending.input.command === 'book' ? ` · ${pending.input.projectName} / ${pending.input.plotId}` : ''}</p>
      <p className="text-sm">เก็บข้อมูลเฉพาะในแท็บนี้ชั่วคราว ห้ามล้างข้อมูลแท็บ หากเปลี่ยนบัญชีให้กลับเข้าบัญชีผู้ทำรายการเดิม</p>
      <button className={bookingButtonClass} disabled={busy || !!storageError || !context || context.actor.role === 'owner'} onClick={() => void save(pending.input)}>
        {busy ? 'กำลังตรวจผล…' : 'ตรวจผลซ้ำด้วยคำขอเดิม'}</button>
    </section>}
    {!context ? loaded.key === key && loaded.error ? <section role="alert" className="space-y-3 rounded-lg border p-4"><p>{loaded.error}</p>
      <p>ยังไม่แสดงข้อมูลเก่าแทน และไม่ส่งคำขอบันทึกซ้ำจากการโหลด</p><button disabled={busy} className={bookingButtonClass} onClick={() => setRevision(value => value + 1)}>โหลดข้อมูลใหม่</button></section>
      : <p role="status">กำลังโหลดข้อมูลการจอง…</p> : <>
      {context.actor.role === 'owner' && <p className="rounded-lg bg-slate-100 p-3">Owner ดูข้อมูลได้อย่างเดียว</p>}
      {!context.customer ? <section className="space-y-3 rounded-xl border bg-white p-5">
        <h2 className="font-bold">ค้นหา Lead ส่วนกลางก่อนจอง</h2>
        <p className="text-sm text-slate-600">ค้นหาจากทุกโครงการ ไม่รวมคนจากชื่อหรือเบอร์ที่เหมือนกันโดยอัตโนมัติ</p>
        <form className="flex gap-3" onSubmit={e => { e.preventDefault(); void find(); }}>
          <label className="flex-1">ชื่อหรือเบอร์โทร (อย่างน้อย 2 ตัวอักษร)<input disabled={locked} className={bookingFieldClass} value={query} onChange={e => {
            searchSequence.current++; setQuery(e.target.value); setSearch(null); setSearchBusy(false); setEditor(null);
          }} /></label><button type="submit" disabled={locked || searchBusy || query.trim().length < 2} className={bookingButtonClass}>ค้นหาลูกค้า</button>
        </form>
        {searchBusy && <p role="status">กำลังค้นหา…</p>}
        {search && search.query === query.trim() && <>
          {!search.result.customers.length && <p>ไม่พบลูกค้าในผลค้นหานี้</p>}
          <ul className="divide-y">{search.result.customers.map(person => <li key={person.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div><p className="font-semibold">{person.name} · {person.phone ?? 'ไม่ทราบเบอร์'}</p><p className="break-all text-xs text-slate-500">รหัสลูกค้า {person.id}</p></div>
            <button disabled={locked} className={bookingButtonClass} onClick={() => chooseCustomer(person.id)}>เลือกลูกค้า {person.name}</button>
          </li>)}</ul>
          <div className="flex gap-3"><button disabled={locked || searchBusy || search.result.page === 0} className={bookingButtonClass} onClick={() => void find(search.result.page - 1)}>ผลค้นหาก่อนหน้า</button>
            <span>หน้าผลค้นหา {search.result.page + 1}</span><button disabled={locked || searchBusy || !search.result.hasMore} className={bookingButtonClass} onClick={() => void find(search.result.page + 1)}>ผลค้นหาถัดไป</button></div>
          {context.actor.role !== 'owner' && <button disabled={locked} className={bookingButtonClass} onClick={() => setEditor({ type: 'book', newCustomer: true })}>ตรวจแล้วว่าไม่ใช่ลูกค้าคนเดียวกัน — สร้าง Lead พร้อมจอง</button>}
        </>}
      </section> : <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white p-5">
        <div><h2 className="text-lg font-bold">{context.customer.name}</h2><p>{context.customer.phone ?? 'ไม่ทราบเบอร์'}</p><p className="break-all text-xs text-slate-500">รหัสลูกค้า {context.customer.id}</p></div>
        <div className="flex gap-3"><button disabled={locked || !mayBook} className={bookingButtonClass} onClick={() => setEditor({ type: 'book', newCustomer: false })}>เพิ่มรอบจองใหม่</button>
          <button disabled={locked} className={bookingButtonClass} onClick={() => chooseCustomer(null)}>ค้นหาลูกค้าคนอื่น</button></div>
      </section>}
      {editor?.type === 'book' && <BookingForm key={`${key}:${editor.newCustomer}`} context={context} newCustomer={editor.newCustomer} disabled={locked} onSubmit={input => void save(input)} onClose={() => setEditor(null)} />}
      {editor && editor.type !== 'book' && selectedSale && <BookingActionForm key={`${key}:${editor.type}:${selectedSale.id}`} context={context} sale={selectedSale} action={editor.type} disabled={locked} onSubmit={input => void save(input)} onClose={() => setEditor(null)} />}
      {context.customer && <section className="space-y-3">
        <h2 className="text-lg font-bold">ประวัติการจองทุกครั้ง</h2><p className="text-sm text-slate-600">หน้า {page + 1} · ไม่เกิน 50 รายการต่อหน้า · ข้อมูลเก่าที่ไม่มีหลักฐานแสดง “ไม่ทราบ”</p>
        <p className="text-xs text-slate-500">เลขรอบคือลำดับที่ระบบบันทึกได้ ไม่ใช่จำนวนครั้งที่ลูกค้าเคยจองทั้งหมดเมื่อประวัติเก่าไม่ทราบรอบ</p>
        {!context.sales.length && <p>ยังไม่มีประวัติการจอง</p>}
        {context.sales.map(sale => <article key={sale.id} aria-label={`ประวัติ${bookingRoundLabel(sale.bookingRound)} ${sale.projectName} ${sale.plotId ?? 'ไม่ทราบแปลง'}`} className="space-y-3 rounded-xl border bg-white p-4">
          <div className="flex flex-wrap justify-between gap-2"><h3 className="font-bold">{sale.projectName} · แปลง {sale.plotId ?? 'ไม่ทราบแปลง'} · {bookingRoundLabel(sale.bookingRound)}</h3>
            <span className={sale.stage === 'cancelled' ? 'font-bold text-rose-700' : 'font-bold text-blue-800'}>{stageLabels[sale.stage] ?? sale.stage}</span></div>
          <dl className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div><dt>ราคาก่อนส่วนลด</dt><dd>{money(sale.listPrice)}</dd></div><div><dt>ส่วนลด</dt><dd>{money(sale.discountAmount)}</dd></div>
            <div><dt>ราคาขายบ้าน</dt><dd>{money(sale.salePrice)}</dd></div><div><dt>เงินจองที่รับ</dt><dd>{money(sale.depositAmount)}</dd></div>
            <div><dt>วันที่จอง</dt><dd>{displayBookingHistoryDate(sale.bookedAt, sale.importedHistory?.bookedDate)}</dd></div><div><dt>การชำระ</dt><dd>{sale.paymentMethod === 'cash' ? 'เงินสด' : sale.paymentMethod === 'mortgage' ? 'กู้ธนาคาร' : 'ไม่ทราบ'}</dd></div>
            {sale.importedHistory && ['transferred', 'handover'].includes(sale.stage) && <div><dt>วันที่โอนตามข้อมูลเดิม</dt><dd>{displayBookingHistoryDate(null, sale.importedHistory.transferredDate)}</dd></div>}
          </dl>
          {sale.importedHistory && <p className="text-xs text-slate-500">ประวัตินำเข้า · อ้างอิงแถว {sale.importedHistory.sourceRow} ในชีต · ไม่ใช้วันนำเข้าแทนวันเกิดเหตุการณ์</p>}
          {sale.stage === 'cancelled' && <div className="rounded-lg bg-rose-50 p-3 text-sm"><p>วันที่ยกเลิก: {displayBookingHistoryDate(sale.cancelledAt, sale.importedHistory?.cancelledDate)}</p>
            <p>ประเภท: {sale.cancellationCategory ? cancellationLabels[sale.cancellationCategory] : 'ไม่ทราบ'}</p><p>เหตุผลยกเลิก: {sale.cancellationReason ?? 'ไม่ทราบ'}</p></div>}
          <p className="break-all text-xs text-slate-500">รหัสจอง {sale.id}{sale.previousSaleId ? ` · อ้างอิงจองเดิม ${sale.previousSaleId}` : ''}</p>
          {!locked && !editor && !sale.importedHistory && <PostBookingLink saleId={sale.id} label={`งานสัญญา / สินเชื่อ / โอน ${bookingRoundLabel(sale.bookingRound)} →`} />}
          {context.actor.role !== 'owner' && <div className="flex gap-3">
            {sale.canCancel && <button disabled={locked} className={bookingButtonClass} onClick={() => setEditor({ type: 'cancel', saleId: sale.id })}>ยกเลิกจอง{bookingRoundLabel(sale.bookingRound)}</button>}
            {sale.canResume && <button disabled={locked} className={bookingButtonClass} onClick={() => setEditor({ type: 'resume_follow_up', saleId: sale.id })}>กลับมาติดตามต่อจาก{bookingRoundLabel(sale.bookingRound)}</button>}
          </div>}
        </article>)}
        <div className="flex gap-3"><button disabled={locked || page === 0} className={bookingButtonClass} onClick={() => { setEditor(null); setPage(value => value - 1); }}>ประวัติก่อนหน้า</button>
          <button disabled={locked || !context.hasMore} className={bookingButtonClass} onClick={() => { setEditor(null); setPage(value => value + 1); }}>ประวัติถัดไป</button>
          <button disabled={locked} className={bookingButtonClass} onClick={() => { setEditor(null); setRevision(value => value + 1); }}>โหลดประวัติล่าสุด</button></div>
      </section>}
    </>}
  </main>;
}
