'use client';

import { useState } from 'react';
import { bahtToSatang } from '@/lib/sales/bookingContracts';
import { bangkokInputTimestamp } from '@/lib/sales/leadWorkDates';
import { parsePostBookingInput, parseTransferDate, postBookingTargets, type PostBookingInput, type PostBookingSnapshot } from '@/lib/sales/postBookingContracts';
import type { SaleStage } from '@/lib/sales/workflow';
import { bookingButtonClass, bookingFieldClass } from './BookingForm';

export const postBookingStageLabels: Record<SaleStage, string> = {
  booked: 'จอง', contracted: 'ทำสัญญา', downpayment: 'ดาวน์', document_prep: 'เตรียมเอกสาร',
  loan_submitted: 'ยื่นกู้', loan_rejected: 'กู้ถูกปฏิเสธ', loan_approved: 'กู้อนุมัติ',
  transfer_pending: 'รอโอน', transferred: 'โอนแล้ว', handover: 'ส่งมอบ', cancelled: 'ยกเลิก',
};
interface Props {
  snapshot: PostBookingSnapshot; target: SaleStage; disabled: boolean;
  onSubmit: (input: PostBookingInput) => void; onClose: () => void;
}

export default function PostBookingForm({ snapshot, target, disabled, onSubmit, onClose }: Props) {
  const [reason, setReason] = useState(''), [evidenceNote, setEvidenceNote] = useState(''), [occurred, setOccurred] = useState('');
  const [bankName, setBankName] = useState(''), [amount, setAmount] = useState(''), [error, setError] = useState('');
  const [transferDate, setTransferDate] = useState('');
  const { sale, actor, latestAttempt } = snapshot;
  const result = target === 'loan_approved' || target === 'loan_rejected';
  const transfer = target === 'transferred';
  const allowed = actor.role !== 'owner' && (actor.role === 'admin' || actor.userId === sale.ownerUserId)
    && sale.canEdit && postBookingTargets(sale.stage, sale.paymentMethod).includes(target)
    && (!result || latestAttempt !== null);

  return <form aria-label="บันทึกงานหลังจอง" className="space-y-4 rounded-xl border border-blue-200 bg-white p-5" onSubmit={event => {
    event.preventDefault();
    if (disabled || !allowed) return;
    try {
      const base = { requestId: crypto.randomUUID(), customerId: sale.customerId, saleId: sale.id,
        expectedSaleRevision: sale.revision, expectedInterestRevision: sale.interestRevision, reason };
      let input: PostBookingInput;
      if (transfer) input = parsePostBookingInput({ ...base, command: 'confirm_transfer', transferDate: parseTransferDate(transferDate) });
      else {
        const evidence = { ...base, evidenceNote, occurredAt: bangkokInputTimestamp(occurred) };
        input = parsePostBookingInput(target === 'loan_submitted' ? { ...evidence, command: 'submit_loan', bankName }
          : result ? { ...evidence, command: 'loan_result', loanAttemptId: latestAttempt!.id,
            result: target === 'loan_approved' ? 'approved' : 'rejected', approvedAmountSatang: target === 'loan_approved' ? bahtToSatang(amount) : null }
            : { ...evidence, command: 'advance', nextStage: target });
      }
      setError(''); onSubmit(input);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'กรุณาตรวจสอบข้อมูลอีกครั้ง'); }
  }}>
    <h2 className="font-bold">บันทึกสถานะ: {postBookingStageLabels[target]}</h2>
    <p className="text-sm text-slate-600">{sale.projectName} · แปลง {sale.plotId ?? 'ไม่ทราบ'} · บันทึกเหตุการณ์จริงพร้อมเหตุผล ไม่แก้ประวัติย้อนหลัง</p>
    {target === 'loan_submitted' && <p className="text-sm text-slate-600">สร้างการยื่นกู้รอบใหม่ โดยเก็บผลของทุกรอบเดิมไว้</p>}
    {target === 'downpayment' && <p className="text-sm text-amber-800">บันทึกเฉพาะสถานะการดาวน์ ยังไม่ใช่บัญชีรับเงินหรือใบเสร็จรับเงิน</p>}
    {transfer && <p className="text-sm text-slate-600">ระบุวันโอนจริงและเหตุผลเท่านั้น ไม่ต้องแนบไฟล์หรืออ้างอิงเอกสาร ระบบจะเก็บวันที่โดยไม่เติมเวลาโอนสมมติ</p>}
    {result && latestAttempt && <p className="text-sm">ผลของรอบ {latestAttempt.attemptNumber} · {latestAttempt.bankName} · รหัส {latestAttempt.id}</p>}
    {error && <p role="alert" className="text-rose-700">{error}</p>}
    <fieldset disabled={disabled || !allowed} className="space-y-4">
      {target === 'loan_submitted' && <label className="block">ชื่อธนาคาร *<input className={bookingFieldClass} maxLength={200} value={bankName} onChange={event => setBankName(event.target.value)} /></label>}
      {target === 'loan_approved' && <label className="block">วงเงินอนุมัติจริง (บาท) *<input className={bookingFieldClass} inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} /></label>}
      {transfer ? <label className="block">วันโอนจริง *<input className={bookingFieldClass} type="date" value={transferDate} onChange={event => setTransferDate(event.target.value)} /></label>
        : <label className="block">วันเวลาเกิดเหตุการณ์ (เวลากรุงเทพฯ) *<input className={bookingFieldClass} type="datetime-local" step="1" value={occurred} onChange={event => setOccurred(event.target.value)} /></label>}
      <label className="block">เหตุผล *<input className={bookingFieldClass} maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} /></label>
      {!transfer && <><label className="block">รายละเอียดหลักฐานที่ผู้บันทึกอ้างอิง *<input className={bookingFieldClass} maxLength={1000} value={evidenceNote} onChange={event => setEvidenceNote(event.target.value)} /></label>
        <p className="text-sm text-amber-800">ข้อความนี้เป็นข้อมูลที่ผู้บันทึกระบุ ยังไม่ใช่การอัปโหลดหรือตรวจยืนยันเอกสารจากธนาคาร</p></>}
      <div className="flex flex-wrap gap-3"><button type="submit" className={bookingButtonClass}>{transfer ? 'ยืนยันวันโอนจริง' : 'ยืนยันบันทึกงานหลังจอง'}</button>
        <button type="button" className={bookingButtonClass} disabled={disabled || !allowed} onClick={() => { if (!disabled && allowed) onClose(); }}>ปิดแบบฟอร์ม</button></div>
    </fieldset>
  </form>;
}
