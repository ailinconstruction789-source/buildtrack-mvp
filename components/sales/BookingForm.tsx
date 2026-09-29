'use client';

import { useState } from 'react';
import AvailablePlotSelect from './AvailablePlotSelect';
import { bahtToSatang, parseBookingInput, type BookingContext, type BookingInput } from '@/lib/sales/bookingContracts';
import type { InterestedPlot } from '@/lib/sales/plotAvailability';
import { displayBangkokTime } from '@/lib/sales/leadWorkDates';
import { bookingRoundLabel } from '@/lib/sales/importedBookingHistory';

export const bookingFieldClass = 'w-full rounded-lg border border-slate-300 px-3 py-2 disabled:bg-slate-100';
export const bookingButtonClass = 'rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold disabled:opacity-50';

interface Props { context: BookingContext; newCustomer: boolean; disabled: boolean; onSubmit: (input: BookingInput) => void; onClose: () => void }
export default function BookingForm({ context, newCustomer, disabled, onSubmit, onClose }: Props) {
  const [projectName, setProject] = useState(''), [plot, setPlot] = useState<InterestedPlot | null>(null);
  const [name, setName] = useState(''), [phone, setPhone] = useState(''), [channel, setChannel] = useState('Walk in');
  const [notes, setNotes] = useState(''), [owner, setOwner] = useState('');
  const [price, setPrice] = useState(''), [discount, setDiscount] = useState(''), [deposit, setDeposit] = useState('');
  const [payment, setPayment] = useState<'cash' | 'mortgage'>('mortgage');
  const [route, setRoute] = useState<'visited' | 'without_visit'>('without_visit'), [visitId, setVisit] = useState('');
  const [previousSale, setPreviousSale] = useState(''), [reason, setReason] = useState(''), [error, setError] = useState('');
  const interest = context.interests.find(item => item.projectName === projectName);
  const mayAddInterest = context.actor.role === 'admin' || context.customer?.ownerUserId === context.actor.userId;
  const projects = context.projects.filter(project => newCustomer || (context.interests.find(item => item.projectName === project.name)?.canEdit ?? mayAddInterest));
  const cancelled = context.sales.filter(sale => sale.interestId === interest?.id && sale.stage === 'cancelled');
  let netPrice = 'กรอกราคาก่อนส่วนลดและส่วนลดให้ครบ';
  try {
    const net = bahtToSatang(price) - bahtToSatang(discount);
    netPrice = net > 0 ? `${(net / 100).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท` : 'ราคาขายต้องมากกว่าศูนย์';
  } catch { /* Incomplete/invalid entries remain editable without inventing money. */ }
  if (context.actor.role === 'owner') return <p>Owner ดูข้อมูลได้อย่างเดียว</p>;
  const submit = (event: React.FormEvent) => {
    event.preventDefault(); if (disabled) return;
    try {
      if (!plot || plot.project_name !== projectName) throw new Error('กรุณาเลือกแปลงว่างที่จะจอง');
      if (newCustomer && context.actor.role === 'admin' && !owner) throw new Error('กรุณาเลือก Sales ผู้ดูแล');
      if (!newCustomer && (!context.customer || !(interest ? interest.canEdit : mayAddInterest))) throw new Error('ไม่มีสิทธิ์จองในโครงการนี้');
      const input = parseBookingInput({ command: 'book', requestId: crypto.randomUUID(), customerId: newCustomer ? null : context.customer!.id,
        newCustomer: newCustomer ? { name, phone, channel, notes, assignedSalesUserId: context.actor.role === 'admin' ? owner : null } : null,
        projectName, expectedInterestRevision: interest?.revision ?? null, plotId: plot.id, paymentMethod: payment,
        bookingRoute: route, visitId: route === 'visited' ? visitId : null,
        listPriceSatang: bahtToSatang(price), discountSatang: bahtToSatang(discount), depositSatang: bahtToSatang(deposit),
        previousSaleId: previousSale || null, reason });
      setError(''); onSubmit(input);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'กรุณาตรวจข้อมูลการจอง'); }
  };
  return <form aria-label="บันทึกการจองส่วนกลาง" onSubmit={submit} className="space-y-4 rounded-xl border border-blue-200 bg-white p-5">
    <h2 className="text-lg font-bold">{newCustomer ? 'สร้าง Lead ส่วนกลางพร้อมจอง' : `จองให้ ${context.customer?.name}`}</h2>
    <p className="text-sm text-slate-600">บันทึกเป็นรอบจองใหม่ ไม่แก้ทับประวัติเก่า ราคาขายบ้าน = ราคาก่อนส่วนลด − ส่วนลด</p>
    {error && <p role="alert" className="text-rose-700">{error}</p>}
    <fieldset disabled={disabled} className="grid gap-4 sm:grid-cols-2">
      {newCustomer && <>
        <label>ชื่อลูกค้า *<input className={bookingFieldClass} value={name} onChange={e => setName(e.target.value)} /></label>
        <label>เบอร์โทร *<input className={bookingFieldClass} value={phone} onChange={e => setPhone(e.target.value)} /></label>
        <label>ช่องทาง<input className={bookingFieldClass} value={channel} onChange={e => setChannel(e.target.value)} /></label>
        <label>หมายเหตุลูกค้า<input className={bookingFieldClass} value={notes} onChange={e => setNotes(e.target.value)} /></label>
        {context.actor.role === 'admin' ? <label>Sales ผู้ดูแล *<select className={bookingFieldClass} value={owner} onChange={e => setOwner(e.target.value)}>
          <option value="">เลือก Sales</option>{context.salesOwners.map(person => <option key={person.userId} value={person.userId}>{person.displayName}</option>)}
        </select></label> : <p className="text-sm text-slate-600">คุณเป็น Sales ผู้ดูแล Lead นี้</p>}
      </>}
      <label>โครงการที่จอง *<select className={bookingFieldClass} value={projectName} onChange={e => {
        setProject(e.target.value); setPlot(null); setRoute('without_visit'); setVisit(''); setPreviousSale('');
      }}><option value="">เลือกโครงการ</option>{projects.map(project => <option key={project.name}>{project.name}</option>)}</select></label>
      <div><AvailablePlotSelect projectName={projectName} value={plot} onChange={setPlot} disabled={disabled} label="แปลงที่จะจอง *" />
        <p className="mt-1 text-xs text-slate-600">ต้องเลือกแปลงก่อนบันทึก ระบบตรวจแปลงว่างอีกครั้งขณะจอง</p></div>
      <label>ราคาก่อนส่วนลด (บาท) *<input inputMode="decimal" className={bookingFieldClass} value={price} onChange={e => setPrice(e.target.value)} /></label>
      <label>ส่วนลด (บาท ใส่ 0 ถ้าไม่มี) *<input inputMode="decimal" className={bookingFieldClass} value={discount} onChange={e => setDiscount(e.target.value)} /></label>
      <label>เงินจองที่รับ (บาท ใส่ 0 ถ้าไม่มี) *<input inputMode="decimal" className={bookingFieldClass} value={deposit} onChange={e => setDeposit(e.target.value)} /></label>
      <p className="rounded-lg bg-blue-50 p-3 text-blue-900">ราคาขายบ้านหลังส่วนลด: <output aria-label="ราคาขายบ้านหลังส่วนลด">{netPrice}</output></p>
      <label>วิธีชำระ<select className={bookingFieldClass} value={payment} onChange={e => setPayment(e.target.value as 'cash' | 'mortgage')}>
        <option value="mortgage">กู้ธนาคาร</option><option value="cash">เงินสด</option></select></label>
      <label>เส้นทางการจอง<select className={bookingFieldClass} value={route} onChange={e => { setRoute(e.target.value as 'visited' | 'without_visit'); setVisit(''); }}>
        <option value="without_visit">จองโดยไม่มี Visit ที่สำเร็จ</option>
        {!!interest?.visits.length && <option value="visited">จองหลัง Visit สำเร็จ</option>}
      </select></label>
      {route === 'visited' && <label>Visit ที่ส่ง Customer Voices แล้ว *<select className={bookingFieldClass} value={visitId} onChange={e => setVisit(e.target.value)}>
        <option value="">เลือก Visit</option>{interest?.visits.map(visit => <option key={visit.id} value={visit.id}>{displayBangkokTime(visit.checkedInAt)} · {visit.id}</option>)}
      </select></label>}
      {!!cancelled.length && <label>อ้างอิงจองที่ยกเลิก (ถ้าเป็นการจองใหม่ต่อเนื่อง)<select className={bookingFieldClass} value={previousSale} onChange={e => setPreviousSale(e.target.value)}>
        <option value="">ไม่อ้างอิงรายการเดิม</option>{cancelled.map(sale => <option key={sale.id} value={sale.id}>{bookingRoundLabel(sale.bookingRound)} · {sale.plotId ?? 'ไม่ทราบแปลง'} · {sale.id}</option>)}
      </select><span className="block text-xs text-slate-500">แสดงรายการจากหน้าประวัติปัจจุบัน เลือกอย่างชัดเจน ไม่มีการเลือกให้อัตโนมัติ</span></label>}
      <label className="sm:col-span-2">{route === 'without_visit' ? 'เหตุผลการจองโดยไม่มี Visit ที่สำเร็จ *' : 'เหตุผลการจอง *'}
        <input className={bookingFieldClass} maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} /></label>
    </fieldset>
    <div className="flex gap-3"><button disabled={disabled} className={`${bookingButtonClass} bg-blue-700 text-white`} type="submit">ยืนยันบันทึกการจอง</button>
      <button disabled={disabled} className={bookingButtonClass} type="button" onClick={onClose}>ปิดแบบฟอร์ม</button></div>
  </form>;
}
