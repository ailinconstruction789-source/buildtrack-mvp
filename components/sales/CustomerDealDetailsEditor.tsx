'use client';

import { useEffect, useRef, useState } from 'react';
import { SALES_BANK_NAMES } from '@/lib/sales/banks';
import { bahtToSatang } from '@/lib/sales/bookingContracts';
import { customerDealEditApi, CustomerDealEditApiError } from '@/lib/sales/customerDealEditClient';
import { parseCustomerDealEditInput, type CustomerDealEditInput, type CustomerDealEditSnapshot } from '@/lib/sales/customerDealEditContracts';
import { clearCustomerDealEditPending, readCustomerDealEditPending, writeCustomerDealEditPending } from '@/lib/sales/customerDealEditPending';
import { bookingButtonClass, bookingFieldClass } from './BookingForm';

interface Props {
  saleId: string; projectName: string; onSaved: () => void;
  onBusyChange?: (busy: boolean) => void; currentUserId?: string;
}
interface Pending { actor: string; input: CustomerDealEditInput; uncertain: boolean }
const money = (value: number | null) => value === null ? 'ไม่ทราบ' : `${value.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท`;
const nullable = (value: string) => value.trim() || null;

export default function CustomerDealDetailsEditor(props: Props) {
  return <DetailsSession key={`${props.saleId}:${props.projectName}:${props.currentUserId ?? ''}`} {...props} />;
}

function DetailsSession({ saleId, projectName, onSaved, onBusyChange, currentUserId }: Props) {
  const [revision, setRevision] = useState(0), [snapshot, setSnapshot] = useState<CustomerDealEditSnapshot | null>(null);
  const [name, setName] = useState(''), [phone, setPhone] = useState(''), [occupation, setOccupation] = useState('');
  const [price, setPrice] = useState(''), [bank, setBank] = useState(''), [reason, setReason] = useState('');
  const [pending, setPending] = useState<Pending | null>(null), [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState(''), [storageError, setStorageError] = useState('');
  const mounted = useRef(false), writing = useRef(false), storageBlocked = useRef(false), successfulReceipt = useRef(false);
  const pendingRef = useRef<Pending | null>(null), recoveredActor = useRef('');
  const onSavedRef = useRef(onSaved), busyCallback = useRef(onBusyChange);
  onSavedRef.current = onSaved; busyCallback.current = onBusyChange;
  const locked = busy || pending !== null || !!storageError;
  const actor = snapshot?.actor;
  const profileAllowed = !!snapshot && snapshot.customer.canEdit && actor?.role !== 'owner'
    && (actor?.role === 'admin' || actor?.userId === snapshot.customer.ownerUserId);
  const dealAllowed = !!snapshot && snapshot.deal.canEdit && actor?.role !== 'owner'
    && (actor?.role === 'admin' || (actor?.userId === snapshot.deal.ownerUserId && !['cancelled', 'transferred', 'handover'].includes(snapshot.deal.stage)));
  const setReceipt = (value: Pending | null) => { pendingRef.current = value; if (mounted.current) setPending(value); };
  const blockStorage = (failure: unknown) => {
    storageBlocked.current = true;
    if (mounted.current) setStorageError(failure instanceof Error ? failure.message : 'ตรวจคำขอค้างไม่ได้ ห้ามส่งรายการใหม่ กรุณาให้ Admin ตรวจสอบ');
  };

  useEffect(() => {
    mounted.current = true;
    const blocked = () => writing.current || pendingRef.current !== null || storageBlocked.current || successfulReceipt.current;
    const unload = (event: BeforeUnloadEvent) => { if (blocked()) { event.preventDefault(); event.returnValue = ''; } };
    const navigation = (event: MouseEvent) => {
      if (blocked() && event.target instanceof Element && event.target.closest('a[href]')) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener('beforeunload', unload); document.addEventListener('click', navigation, true);
    return () => {
      mounted.current = false; window.removeEventListener('beforeunload', unload); document.removeEventListener('click', navigation, true);
      busyCallback.current?.(false);
    };
  }, []);
  useEffect(() => { busyCallback.current?.(locked); }, [locked, onBusyChange]);

  useEffect(() => {
    const controller = new AbortController(); let cancelled = false;
    setSnapshot(null); setLoadError('');
    customerDealEditApi.read({ saleId, projectName }, { signal: controller.signal }).then(value => {
      if (cancelled) return;
      if (value.deal.id !== saleId || value.deal.projectName !== projectName || (currentUserId && value.actor.userId !== currentUserId)) {
        setLoadError('บัญชีหรือรายการเปลี่ยนระหว่างโหลด กรุณาเปิดรายการใหม่'); return;
      }
      try {
        if (pendingRef.current && pendingRef.current.actor !== value.actor.userId) throw new Error('คำขอค้างเป็นของบัญชีเดิม กรุณากลับเข้าบัญชีผู้ทำรายการ');
        if (recoveredActor.current !== value.actor.userId) {
          const receipt = readCustomerDealEditPending(value.actor.userId);
          recoveredActor.current = value.actor.userId;
          if (receipt) setReceipt({ actor: value.actor.userId, input: receipt, uncertain: true });
        }
      } catch (failure) { blockStorage(failure); }
      setName(value.customer.name); setPhone(value.customer.phone ?? ''); setOccupation(value.customer.occupation ?? '');
      setPrice(value.deal.salePrice === null ? '' : value.deal.salePrice.toFixed(2)); setBank(value.deal.bankName ?? ''); setReason(''); setSnapshot(value);
    }).catch(failure => {
      if (!cancelled) setLoadError(failure instanceof Error ? failure.message : 'ยังไม่สามารถอ่านข้อมูลลูกค้า ราคา และธนาคารได้');
    });
    return () => { cancelled = true; controller.abort(); };
  }, [saleId, projectName, currentUserId, revision]);

  const save = async (input: CustomerDealEditInput) => {
    if (writing.current || storageBlocked.current || successfulReceipt.current || !snapshot || snapshot.actor.role === 'owner') return;
    const existing = pendingRef.current;
    if (existing ? existing.actor !== snapshot.actor.userId
      : (!profileAllowed && !dealAllowed) || input.saleId !== snapshot.deal.id || input.projectName !== snapshot.deal.projectName) return;
    writing.current = true; setBusy(true); busyCallback.current?.(true); setError(''); setNotice('');
    const actorId = existing?.actor ?? snapshot.actor.userId;
    let receipt: Pending;
    try {
      receipt = { actor: actorId, input: writeCustomerDealEditPending(actorId, existing?.input ?? input), uncertain: existing?.uncertain ?? false };
      setReceipt(receipt);
    } catch (failure) { blockStorage(failure); writing.current = false; if (mounted.current) setBusy(false); return; }
    try {
      await customerDealEditApi.save(receipt.input, actorId);
      successfulReceipt.current = true;
      try { clearCustomerDealEditPending(actorId, receipt.input); }
      catch (failure) { if (mounted.current) setNotice('บันทึกสำเร็จแล้ว ห้ามส่งซ้ำ แต่ยังล้างคำขอค้างไม่ได้'); blockStorage(failure); return; }
      setReceipt(null); successfulReceipt.current = false;
      if (mounted.current) {
        setNotice('บันทึกข้อมูลลูกค้า ราคา และธนาคารสำเร็จแล้ว'); setRevision(value => value + 1);
        // A parent refresh failure must not turn a committed write into a new pending command.
        try { onSavedRef.current(); } catch { setNotice('บันทึกสำเร็จแล้ว กรุณาเปิดรายการใหม่เพื่ออ่านข้อมูลล่าสุด'); }
      }
    } catch (failure) {
      if (failure instanceof CustomerDealEditApiError && failure.definitelyNotSaved && !receipt.uncertain) {
        try { clearCustomerDealEditPending(actorId, receipt.input); setReceipt(null); } catch (storageFailure) { blockStorage(storageFailure); }
      } else setReceipt({ ...receipt, uncertain: true });
      if (mounted.current) setError(failure instanceof Error ? failure.message : 'ยังยืนยันผลบันทึกไม่ได้ กรุณาตรวจผลด้วยคำขอเดิม');
    } finally { writing.current = false; if (mounted.current) setBusy(false); }
  };

  const submit = () => {
    if (locked || writing.current || !snapshot || (!profileAllowed && !dealAllowed)) return;
    try {
      const profile = profileAllowed && (name.trim() !== snapshot.customer.name || nullable(phone) !== snapshot.customer.phone || nullable(occupation) !== snapshot.customer.occupation)
        ? { name, phone: nullable(phone), occupation: nullable(occupation) } : null;
      const salePriceSatang = dealAllowed ? (price === '' ? null : bahtToSatang(price)) : null;
      const dealDetails = dealAllowed && (salePriceSatang !== (snapshot.deal.salePrice === null ? null : Math.round(snapshot.deal.salePrice * 100)) || nullable(bank) !== snapshot.deal.bankName)
        ? { salePriceSatang, bankName: nullable(bank) } : null;
      if (profile === null && dealDetails === null) { setError('ยังไม่มีข้อมูลที่เปลี่ยนแปลง'); return; }
      const input = parseCustomerDealEditInput({ requestId: crypto.randomUUID(), command: 'update_details', customerId: snapshot.customer.id,
        saleId: snapshot.deal.id, projectName: snapshot.deal.projectName, expectedCustomerRevision: snapshot.customer.revision,
        expectedInterestRevision: snapshot.deal.interestRevision, expectedSaleRevision: snapshot.deal.revision,
        expectedCustomerDetailsRevision: snapshot.customer.detailsRevision, expectedDealDetailsRevision: snapshot.deal.detailsRevision, reason, profile, dealDetails });
      void save(input);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'กรุณาตรวจสอบข้อมูลก่อนบันทึก'); }
  };

  return <section aria-label="ข้อมูลลูกค้า ราคา และธนาคาร" className="space-y-4 rounded-xl border border-blue-200 bg-white p-4 sm:p-5">
    <h3 className="font-bold">ข้อมูลลูกค้า ราคา และธนาคาร</h3>
    {notice && <p role="status" className="text-sm text-emerald-800">{notice}</p>}
    {(error || storageError) && <p role="alert" className="text-sm text-rose-700">{storageError || error}</p>}
    {pending && <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3" aria-label="คำขอแก้ข้อมูลค้าง">
      <p className="font-semibold">ต้องตรวจผลคำขอเดิมก่อนเริ่มรายการใหม่</p>
      <p className="break-all text-xs">คำขอ {pending.input.requestId} · รหัสจอง {pending.input.saleId}</p>
      {(pending.input.saleId !== saleId || pending.input.projectName !== projectName) && <p className="text-sm">คำขอนี้เป็นของรายการอื่น การตรวจผลจะใช้ข้อมูลเดิมเท่านั้น</p>}
      <p className="text-sm">ห้ามล้างข้อมูลแท็บ หากเปลี่ยนบัญชีให้กลับเข้าบัญชีผู้ทำรายการเดิม</p>
      <button type="button" className={bookingButtonClass} disabled={busy || !!storageError || !snapshot || actor?.role === 'owner' || actor?.userId !== pending.actor}
        onClick={() => void save(pending.input)}>{busy ? 'กำลังตรวจผล…' : 'ตรวจผลซ้ำด้วยคำขอเดิม'}</button>
    </div>}
    {!snapshot ? loadError ? <div className="space-y-2" role="alert"><p>{loadError}</p>
      <p className="text-sm">ยังไม่เปิดให้แก้ข้อมูลในรายการนี้ การโหลดใหม่จะไม่ส่งคำขอบันทึก</p>
      <button type="button" className={bookingButtonClass} disabled={locked} onClick={() => setRevision(value => value + 1)}>โหลดข้อมูลใหม่</button>
    </div> : <p role="status">กำลังอ่านข้อมูลลูกค้า ราคา และธนาคาร…</p> : <form aria-label="แก้ข้อมูลลูกค้า ราคา และธนาคาร" className="space-y-4" onSubmit={event => { event.preventDefault(); submit(); }}>
      <p className="text-sm text-slate-600">{snapshot.deal.projectName} · แปลง {snapshot.deal.plotId ?? 'ไม่ทราบ'}</p>
      <fieldset disabled={locked || !profileAllowed} className="space-y-3"><legend className="font-semibold">ข้อมูลลูกค้ากลาง</legend>
        <p className="text-sm text-slate-600">ชื่อ เบอร์โทร และอาชีพใช้ร่วมกันทุกโครงการของลูกค้าคนนี้</p>
        <label className="block">ชื่อลูกค้า *<input className={bookingFieldClass} maxLength={200} value={name} onChange={event => setName(event.target.value)} /></label>
        <label className="block">เบอร์โทร<input className={bookingFieldClass} maxLength={32} value={phone} onChange={event => setPhone(event.target.value)} /></label>
        <label className="block">อาชีพ<input className={bookingFieldClass} maxLength={200} value={occupation} onChange={event => setOccupation(event.target.value)} /></label>
      </fieldset>
      {!profileAllowed && <p className="text-sm text-slate-600">บัญชีนี้ดูข้อมูลลูกค้ากลางได้อย่างเดียว</p>}
      <fieldset disabled={locked || !dealAllowed} className="space-y-3"><legend className="font-semibold">ข้อมูลเฉพาะรอบจองนี้</legend>
        <p className="text-sm">ราคาจากต้นทาง: {money(snapshot.deal.sourceSalePrice)} · ราคาปัจจุบัน: {money(snapshot.deal.salePrice)}</p>
        <label className="block">ราคาสุทธิปัจจุบัน (บาท)<input className={bookingFieldClass} inputMode="decimal" value={price} onChange={event => setPrice(event.target.value)} /></label>
        <label className="block">ธนาคาร<select className={bookingFieldClass} value={bank} onChange={event => setBank(event.target.value)}>
          <option value="">ไม่ทราบ / ยังไม่ระบุ</option>{SALES_BANK_NAMES.map(value => <option key={value} value={value}>{value}</option>)}
          {snapshot.deal.bankName && !SALES_BANK_NAMES.includes(snapshot.deal.bankName) && <option value={snapshot.deal.bankName}>{snapshot.deal.bankName}</option>}
        </select></label>
        <p className="text-sm text-slate-600">เว้นราคาไว้หากไม่ทราบ การเลือกธนาคารไม่เปลี่ยนวิธีชำระหรือผลยื่นกู้ และไม่เขียนทับข้อมูลต้นทาง</p>
      </fieldset>
      {!dealAllowed && <p className="text-sm text-slate-600">บัญชีหรือสถานะนี้ดูราคาและธนาคารได้อย่างเดียว</p>}
      <label className="block">เหตุผลที่แก้ไข *<input className={bookingFieldClass} disabled={locked || (!profileAllowed && !dealAllowed)} maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} /></label>
      <button type="submit" className={bookingButtonClass} disabled={locked || (!profileAllowed && !dealAllowed)}>{busy ? 'กำลังบันทึก…' : 'บันทึกข้อมูลลูกค้า ราคา และธนาคาร'}</button>
    </form>}
  </section>;
}
