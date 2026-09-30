'use client';

import { useState } from 'react';
import { bangkokInputTimestamp, displayBangkokTime } from '@/lib/sales/leadWorkDates';
import { activeAppointment, parseVisitsInput, type VisitAppointment, type VisitCommand, type VisitRow, type VisitsInput, type VisitsSnapshot } from '@/lib/sales/visitsContracts';
import { bookingButtonClass, bookingFieldClass } from './BookingForm';

export const visitCommandLabels: Record<VisitCommand, string> = {
  schedule: 'สร้างนัดหมาย', reschedule: 'เลื่อนนัดหมาย', cancel_appointment: 'ยกเลิกนัดหมาย',
  no_show: 'บันทึกไม่มาตามนัด', check_in: 'เช็คอินเข้าชม', cancel_visit: 'ยกเลิกการเข้าชม',
};
interface Props {
  snapshot: VisitsSnapshot; action: VisitCommand; appointment?: VisitAppointment; visit?: VisitRow;
  disabled: boolean; onSubmit: (input: VisitsInput) => void; onClose: () => void;
}
export default function VisitActionForm({ snapshot, action, appointment, visit, disabled, onSubmit, onClose }: Props) {
  const [reason, setReason] = useState(''), [occurredAt, setOccurredAt] = useState('');
  const [startsAt, setStartsAt] = useState(''), [endsAt, setEndsAt] = useState(''), [error, setError] = useState('');
  const { actor, scope } = snapshot;
  const editable = scope.canEdit && scope.engagementStatus !== 'lost' && actor.role !== 'owner'
    && (actor.role === 'admin' || actor.userId === scope.ownerUserId);
  const allowed = editable && (action === 'schedule' || action === 'check_in' ? !appointment || activeAppointment(appointment.status)
    : action === 'cancel_visit' ? visit?.status === 'awaiting_voice' : !!appointment && activeAppointment(appointment.status));
  const scheduling = action === 'schedule' || action === 'reschedule';
  return <form aria-label="บันทึกนัดหมายและเข้าชม" className="space-y-4 rounded-xl border border-blue-200 bg-white p-5" onSubmit={event => {
    event.preventDefault(); if (disabled || !allowed) return;
    try {
      const base = { requestId: crypto.randomUUID(), command: action, customerId: scope.customerId, interestId: scope.interestId,
        expectedInterestRevision: scope.interestRevision, reason, occurredAt: bangkokInputTimestamp(occurredAt) };
      const appointmentRef = { appointmentId: appointment?.id ?? null, expectedAppointmentRevision: appointment?.revision ?? null };
      const input = parseVisitsInput(action === 'schedule' ? { ...base, startsAt: bangkokInputTimestamp(startsAt), endsAt: endsAt ? bangkokInputTimestamp(endsAt) : null }
        : action === 'reschedule' ? { ...base, ...appointmentRef, startsAt: bangkokInputTimestamp(startsAt), endsAt: endsAt ? bangkokInputTimestamp(endsAt) : null }
          : action === 'cancel_visit' ? { ...base, visitId: visit!.id, expectedVisitRevision: visit!.revision } : { ...base, ...appointmentRef });
      setError(''); onSubmit(input);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'กรุณาตรวจสอบข้อมูลอีกครั้ง'); }
  }}>
    <h2 className="font-bold">{visitCommandLabels[action]}</h2><p className="text-sm text-slate-600">{scope.customerName} · {scope.projectName}</p>
    {appointment && <p className="text-sm">นัดเดิม: {displayBangkokTime(appointment.startsAt)} · รหัส {appointment.id}</p>}
    {action === 'check_in' && <p className="text-sm text-amber-800">{appointment ? 'เช็คอินจากนัดหมายนี้' : 'ลูกค้าเข้าชมโดยไม่มีนัดหมาย (Walk-in)'} — ยังไม่ถือว่า Visit สำเร็จจนกว่า Customer Voices จะส่งและผ่านการตรวจ</p>}
    {(action === 'cancel_visit' || action === 'cancel_appointment') && <p className="text-sm">เก็บประวัติและเหตุผลไว้ ไม่ลบรายการเดิม</p>}
    {error && <p role="alert" className="text-rose-700">{error}</p>}
    <fieldset disabled={disabled || !allowed} className="space-y-4">
      {scheduling && <><label className="block">วันเวลาเริ่มนัด (เวลากรุงเทพฯ) *<input className={bookingFieldClass} type="datetime-local" step="1" value={startsAt} onChange={event => setStartsAt(event.target.value)} /></label>
        <label className="block">วันเวลาสิ้นสุดนัด (ถ้าทราบ)<input className={bookingFieldClass} type="datetime-local" step="1" value={endsAt} onChange={event => setEndsAt(event.target.value)} /></label></>}
      <label className="block">วันเวลาเกิดเหตุการณ์จริง (เวลากรุงเทพฯ) *<input className={bookingFieldClass} type="datetime-local" step="1" value={occurredAt} onChange={event => setOccurredAt(event.target.value)} /></label>
      <label className="block">เหตุผล *<input className={bookingFieldClass} maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} /></label>
      <div className="flex flex-wrap gap-3"><button type="submit" className={bookingButtonClass}>ยืนยัน{visitCommandLabels[action]}</button>
        <button type="button" className={bookingButtonClass} disabled={disabled || !allowed} onClick={() => { if (!disabled && allowed) onClose(); }}>ปิดแบบฟอร์ม</button></div>
    </fieldset>
  </form>;
}
