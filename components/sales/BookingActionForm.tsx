'use client';

import { useState } from 'react';
import { CANCELLATION_CATEGORIES, parseBookingInput, type BookingContext, type BookingInput, type CancellationCategory } from '@/lib/sales/bookingContracts';
import { bangkokInputTimestamp } from '@/lib/sales/leadWorkDates';
import { bookingRoundLabel } from '@/lib/sales/importedBookingHistory';
import { bookingButtonClass, bookingFieldClass } from './BookingForm';

export const cancellationLabels: Record<CancellationCategory, string> = {
  booking_cancelled: 'ยกเลิกจอง', downpayment_abandoned: 'ทิ้งดาวน์', final_loan_rejection: 'กู้ไม่ผ่าน (ยุติการจอง)', other: 'อื่น ๆ',
};
interface Props { context: BookingContext; sale: BookingContext['sales'][number]; action: 'cancel' | 'resume_follow_up'; disabled: boolean; onSubmit: (input: BookingInput) => void; onClose: () => void }
export default function BookingActionForm({ context, sale, action, disabled, onSubmit, onClose }: Props) {
  const [category, setCategory] = useState<CancellationCategory>('booking_cancelled');
  const [reason, setReason] = useState(''), [nextAction, setNextAction] = useState(''), [due, setDue] = useState(''), [error, setError] = useState('');
  const interest = context.interests.find(item => item.id === sale.interestId);
  const allowed = context.actor.role !== 'owner' && (action === 'cancel' ? sale.canCancel : sale.canResume) && !!context.customer && !!interest;
  return <form aria-label={action === 'cancel' ? 'ยกเลิกการจอง' : 'กลับมาติดตามต่อ'} onSubmit={event => {
    event.preventDefault(); if (disabled || !allowed) return;
    try {
      const base = { requestId: crypto.randomUUID(), command: action, reason, customerId: context.customer!.id, saleId: sale.id, expectedSaleRevision: sale.revision };
      const input = parseBookingInput(action === 'cancel' ? { ...base, cancellationCategory: category }
        : { ...base, expectedInterestRevision: interest!.revision, expectedActionId: interest!.currentActionId, nextAction: { action: nextAction, dueAt: bangkokInputTimestamp(due) } });
      setError(''); onSubmit(input);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'ตรวจสอบข้อมูลอีกครั้ง'); }
  }} className="space-y-4 rounded-xl border border-amber-200 bg-white p-5">
    <h2 className="font-bold">{action === 'cancel' ? 'ยกเลิกการจอง' : 'กลับมาติดตามต่อ'} · {bookingRoundLabel(sale.bookingRound)} · {sale.projectName} / {sale.plotId ?? 'ไม่ทราบแปลง'}</h2>
    <p className="text-sm text-slate-600">{action === 'cancel' ? 'เก็บรายการและเหตุผลยกเลิกไว้ถาวร ไม่ลบประวัติ' : 'เพิ่มงานติดตามใหม่ โดยรายการจองเดิมยังเป็นยกเลิกและประวัติไม่เปลี่ยน'}</p>
    {error && <p role="alert" className="text-rose-700">{error}</p>}
    <fieldset disabled={disabled || !allowed} className="space-y-4">
      {action === 'cancel' && <label className="block">ประเภทการยกเลิก<select className={bookingFieldClass} value={category} onChange={e => setCategory(e.target.value as CancellationCategory)}>
        {CANCELLATION_CATEGORIES.map(value => <option key={value} value={value}>{cancellationLabels[value]}</option>)}
      </select></label>}
      <label className="block">เหตุผล *<input className={bookingFieldClass} maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} /></label>
      {action === 'resume_follow_up' && <>
        <label className="block">งานติดตามถัดไป *<input className={bookingFieldClass} maxLength={500} value={nextAction} onChange={e => setNextAction(e.target.value)} /></label>
        <label className="block">กำหนดติดตาม (เวลากรุงเทพฯ) *<input type="datetime-local" className={bookingFieldClass} value={due} onChange={e => setDue(e.target.value)} /></label>
      </>}
      <div className="flex gap-3"><button type="submit" className={bookingButtonClass}>ยืนยัน{action === 'cancel' ? 'ยกเลิกจอง' : 'กลับมาติดตามต่อ'}</button>
        <button type="button" className={bookingButtonClass} onClick={onClose}>ปิดแบบฟอร์ม</button></div>
    </fieldset>
  </form>;
}
