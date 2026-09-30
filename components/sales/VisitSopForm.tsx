'use client';

import { useState } from 'react';
import { VISIT_SOP_TEMPLATE, parseVisitSopInput, type VisitSopAnswerResult, type VisitSopInput, type VisitSopSnapshot } from '@/lib/sales/visitSopContracts';
import { bangkokInputTimestamp, bangkokTimestampInput } from '@/lib/sales/leadWorkDates';
import { bookingButtonClass, bookingFieldClass } from './BookingForm';

export default function VisitSopForm({ snapshot, disabled, onSubmit }: { snapshot: VisitSopSnapshot; disabled: boolean; onSubmit: (input: VisitSopInput) => void }) {
  const run = snapshot.run, stage = run?.currentStage;
  const itemStage = stage === 'stage_a' || stage === 'stage_c' ? stage : null;
  const [answers, setAnswers] = useState(() => itemStage ? VISIT_SOP_TEMPLATE[itemStage].map(([key]) => {
    const item = run?.items.find(row => row.key === key); return { key, result: item?.result ?? 'pending' as VisitSopAnswerResult, reason: item?.reason ?? '' };
  }) : []);
  const [plotQuery, setPlotQuery] = useState(''), [plotId, setPlotId] = useState(''), [reason, setReason] = useState(''), [occurred, setOccurred] = useState('');
  const [feedback, setFeedback] = useState(run?.recap.feedback ?? ''), [objections, setObjections] = useState(run?.recap.objections ?? '');
  const [departed, setDeparted] = useState(run?.departedAt ? bangkokTimestampInput(run.departedAt) : ''), [error, setError] = useState('');
  const mayWrite = snapshot.scope.canWrite && snapshot.actor.role === 'sales' && snapshot.actor.userId === snapshot.scope.ownerUserId
    && snapshot.scope.engagementStatus !== 'lost' && snapshot.anchor.visitStatus !== 'cancelled' && !['cancelled', 'no_show'].includes(snapshot.anchor.appointmentStatus ?? '') && stage !== 'completed';
  const plots = snapshot.plots.filter(plot => `${plot.id} ${plot.name}`.toLocaleLowerCase().includes(plotQuery.trim().toLocaleLowerCase()));
  if (!mayWrite) return null;
  const submit = (command: VisitSopInput['command']) => {
    if (disabled) return;
    try {
      const base = { requestId: crypto.randomUUID(), customerId: snapshot.scope.customerId, interestId: snapshot.scope.interestId,
        appointmentId: snapshot.scope.appointmentId, visitId: snapshot.scope.visitId, expectedInterestRevision: snapshot.scope.interestRevision,
        occurredAt: bangkokInputTimestamp(occurred), reason, command };
      let raw: unknown;
      if (!run) {
        if (command !== 'start' || !snapshot.plots.some(plot => plot.id === plotId)) throw new Error('กรุณาเลือกบ้านหรือแปลงที่จะพาชมในโครงการนี้');
        raw = { ...base, plotId };
      } else {
        const ref = { ...base, runId: run.id, expectedRunRevision: run.revision };
        if (stage === 'stage_b') {
          if (command !== 'start_tour' || !snapshot.anchor.visitId || !snapshot.anchor.checkedInAt) throw new Error('ต้องเช็คอินลูกค้าจริงก่อนเริ่มพาชม');
          raw = ref;
        } else {
          if (!itemStage || !['save_stage', 'complete_stage'].includes(command)) throw new Error('ช่วง SOP ไม่ตรงกับข้อมูลล่าสุด');
          if (itemStage === 'stage_c' && command === 'complete_stage' && !snapshot.nextAction) throw new Error('สร้างงานติดตามจริงในหน้างานติดตามก่อน แล้วโหลดข้อมูลล่าสุด');
          const originalDeparture = run.departedAt && departed === bangkokTimestampInput(run.departedAt) ? run.departedAt : null;
          raw = { ...ref, stage: itemStage, answers: answers.map(row => ({ ...row, reason: row.reason.trim() || null })),
            recap: itemStage === 'stage_c' ? { feedback, objections, departedAt: departed ? originalDeparture ?? bangkokInputTimestamp(departed) : null } : null };
        }
      }
      setError(''); onSubmit(parseVisitSopInput(raw));
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'กรุณาตรวจรายการ SOP'); }
  };
  return <form aria-label="บันทึก SOP พาชม" className="space-y-4 rounded-xl border border-blue-200 bg-white p-5" onSubmit={event => {
    event.preventDefault(); submit(!run ? 'start' : stage === 'stage_b' ? 'start_tour' : 'save_stage');
  }}>
    <h2 className="text-lg font-bold">{!run ? 'เริ่ม SOP สำหรับการพาชมครั้งนี้' : stage === 'stage_a' ? 'Stage A · เตรียมก่อนพาชม 16 รายการ' : stage === 'stage_b' ? 'Stage B · เริ่มพาชม' : 'Stage C · หลังพาชม 13 รายการ'}</h2>
    <p className="text-sm text-slate-600">Sales ผู้ดูแลปัจจุบันบันทึกงานที่ทำจริง ไม่ติ๊กครบหรือเติมวันเวลาให้อัตโนมัติ</p>
    {error && <p role="alert" className="text-rose-700">{error}</p>}
    <fieldset disabled={disabled} className="space-y-4">
      {!run && <>
        <label className="block">ค้นหาบ้าน / แปลงสำหรับพาชม<input className={bookingFieldClass} value={plotQuery} onChange={e => { setPlotQuery(e.target.value); setPlotId(''); }} /></label>
        <label className="block">บ้าน / แปลงที่จะพาชม *<select className={bookingFieldClass} value={plotId} onChange={e => setPlotId(e.target.value)}><option value="">เลือกบ้านหรือแปลง</option>
          {plots.map(plot => <option key={plot.id} value={plot.id}>{plot.name} · {plot.id}</option>)}</select></label>
        <p className="text-sm text-slate-600">แสดงบ้านในโครงการนี้ทุกสถานะ รวมบ้านตัวอย่าง ไม่ใช่รายการแปลงว่าง การเลือกนี้ไม่จองแปลงและไม่เปลี่ยนแปลงที่ลูกค้าเล็ง</p>
        {snapshot.plotsHasMore && <p className="text-sm text-amber-800">แสดง 200 บ้าน / แปลงแรก ยังมีรายการที่ไม่แสดง หากไม่พบให้ Admin ตรวจสอบก่อน</p>}
      </>}
      {itemStage && <div className="space-y-3">{VISIT_SOP_TEMPLATE[itemStage].map(([key, label], index) => {
        const answer = answers.find(row => row.key === key)!;
        return <div key={key} className="rounded-lg border p-3"><label className="block">{index + 1}. {label}<select aria-label={label} className={bookingFieldClass} value={answer.result} onChange={event => {
          const result = event.target.value as VisitSopAnswerResult; setAnswers(rows => rows.map(row => row.key === key ? { ...row, result, reason: result === 'pending' || result === 'done' ? '' : row.reason } : row));
        }}><option value="pending">ยังไม่ได้ตอบ / ยังไม่ทำ</option><option value="done">ทำแล้ว</option><option value="not_applicable">ไม่เกี่ยวข้อง (ระบุเหตุผล)</option><option value="skipped">ข้าม (ระบุเหตุผล)</option></select></label>
          {['not_applicable', 'skipped'].includes(answer.result) && <label className="mt-2 block text-sm">เหตุผล: {label}<input className={bookingFieldClass} value={answer.reason} maxLength={1000} onChange={event => setAnswers(rows => rows.map(row => row.key === key ? { ...row, reason: event.target.value } : row))} /></label>}
        </div>;
      })}</div>}
      {stage === 'stage_b' && !snapshot.anchor.visitId && <p className="rounded-lg bg-amber-50 p-3 text-amber-900">ยังไม่มีการเช็คอินจริง ให้กลับหน้านัดหมาย / เข้าชมเพื่อเช็คอินก่อน ไม่มีการสร้าง Visit ให้อัตโนมัติ</p>}
      {stage === 'stage_c' && <>
        <p className="rounded-lg bg-blue-50 p-3 text-sm text-blue-900">ควรทำ Stage C ภายในวันเดียวกับที่ลูกค้ากลับ ตามเวลากรุงเทพฯ ระบบเก็บเวลาจริงไว้ แต่ยังไม่คิดคะแนนหรือบทลงโทษอัตโนมัติ</p>
        <label className="block">ความคิดเห็นลูกค้า *<input className={bookingFieldClass} maxLength={2000} value={feedback} onChange={e => setFeedback(e.target.value)} /></label>
        <label className="block">ข้อกังวลลูกค้า (ถ้าไม่มี ให้ระบุว่าไม่มี) *<input className={bookingFieldClass} maxLength={2000} value={objections} onChange={e => setObjections(e.target.value)} /></label>
        <label className="block">เวลาลูกค้ากลับจริง (กรุงเทพฯ) *<input className={bookingFieldClass} type="datetime-local" step="1" value={departed} onChange={e => setDeparted(e.target.value)} /></label>
        <p className="text-sm text-slate-600">การติ๊กทบทวนแปลง / สถานะ / งานติดตามเป็นหลักฐานการตรวจเท่านั้น ไม่แก้ Lead หรือสร้างงานซ้ำจากแบบฟอร์มนี้</p>
      </>}
      <label className="block">วันเวลาที่ทำรายการจริง (กรุงเทพฯ) *<input className={bookingFieldClass} type="datetime-local" step="1" value={occurred} onChange={e => setOccurred(e.target.value)} /></label>
      <label className="block">เหตุผล / บันทึกการทำงานครั้งนี้ *<input className={bookingFieldClass} maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} /></label>
      <div className="flex flex-wrap gap-3"><button className={bookingButtonClass} type="submit" disabled={disabled || stage === 'stage_b' && !snapshot.anchor.visitId}>
        {!run ? 'เริ่ม SOP' : stage === 'stage_b' ? 'บันทึกเริ่มพาชมจริง' : 'บันทึกความคืบหน้าช่วงนี้'}</button>
        {itemStage && <button type="button" className={`${bookingButtonClass} bg-blue-700 text-white`} disabled={disabled || itemStage === 'stage_c' && !snapshot.nextAction} onClick={() => submit('complete_stage')}>
          {itemStage === 'stage_a' ? 'ยืนยัน Stage A ครบและไป Stage B' : 'ยืนยัน Stage C ครบ (เฉพาะ SOP)'}</button>}
      </div>
    </fieldset>
  </form>;
}
