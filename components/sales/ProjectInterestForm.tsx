'use client';

import { useState } from 'react';
import AvailablePlotSelect from './AvailablePlotSelect';
import { parseProjectInterestInput, type ProjectInterestInput, type ProjectInterestsSnapshot } from '@/lib/sales/projectInterestsContracts';
import type { InterestedPlot } from '@/lib/sales/plotAvailability';
import { bookingButtonClass, bookingFieldClass } from './BookingForm';

export default function ProjectInterestForm({ snapshot, disabled, onSubmit }: { snapshot: ProjectInterestsSnapshot; disabled: boolean; onSubmit: (input: ProjectInterestInput) => void }) {
  const [project, setProject] = useState(''), [plot, setPlot] = useState<InterestedPlot | null>(null), [reason, setReason] = useState(''), [error, setError] = useState('');
  const mayAdd = snapshot.customer.canAdd && snapshot.actor.role !== 'owner' && snapshot.customer.intakeStatus !== 'lost'
    && (snapshot.actor.role === 'admin' || snapshot.actor.userId === snapshot.customer.ownerUserId);
  const projects = snapshot.projects.filter(item => !snapshot.interests.some(existing => existing.projectName === item.name));
  if (!mayAdd) return null;
  return <form aria-label="เพิ่มโครงการที่สนใจ" className="space-y-4 rounded-xl border border-blue-200 bg-white p-5" onSubmit={event => {
    event.preventDefault(); if (disabled) return;
    try {
      if (!projects.some(item => item.name === project)) throw new Error('กรุณาเลือกโครงการใหม่ที่ยังไม่มีใน Lead นี้');
      if (plot && plot.project_name !== project) throw new Error('แปลงไม่ตรงกับโครงการ กรุณาเลือกใหม่');
      const input = parseProjectInterestInput({ requestId: crypto.randomUUID(), customerId: snapshot.customer.id, expectedCustomerRevision: snapshot.customer.revision,
        projectName: project, plotId: plot?.id ?? null, reason });
      setError(''); onSubmit(input);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'กรุณาตรวจข้อมูลอีกครั้ง'); }
  }}>
    <h2 className="text-lg font-bold">เพิ่มโครงการให้ Lead คนเดิม</h2>
    <p className="text-sm text-slate-600">ผู้ดูแลเริ่มต้นเป็นเจ้าของ Lead ส่วนกลางคนเดิม หากต้องเปลี่ยนผู้ดูแล ให้ Admin ใช้กระบวนการเปลี่ยนผู้ดูแล</p>
    {error && <p role="alert" className="text-rose-700">{error}</p>}
    {snapshot.projectsHasMore && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">แสดงโครงการที่เลือกได้ 200 โครงการแรก ยังมีโครงการอื่นที่ไม่ได้แสดง หากไม่พบโครงการที่ต้องการให้ Admin ตรวจสอบก่อน</p>}
    {!projects.length ? <p>ไม่มีโครงการใหม่ที่เลือกได้ในรายการนี้ โครงการเดิมรวมถึง Lost จะไม่ถูกเพิ่มซ้ำหรือเปิดใหม่จากหน้านี้</p> : <fieldset disabled={disabled} className="space-y-4">
      <label className="block">โครงการที่สนใจ *<select className={bookingFieldClass} value={project} onChange={event => { setProject(event.target.value); setPlot(null); }}>
        <option value="">เลือกโครงการ</option>{projects.map(item => <option key={item.name}>{item.name}</option>)}
      </select></label>
      <AvailablePlotSelect projectName={project} value={plot} onChange={setPlot} disabled={disabled} />
      <label className="block">เหตุผลที่เพิ่มโครงการ *<input className={bookingFieldClass} value={reason} maxLength={1000} onChange={event => setReason(event.target.value)} /></label>
      <p className="text-sm text-slate-600">เลือกแปลงได้แต่ยังไม่จองหรือล็อกแปลง ไม่สร้างลูกค้าซ้ำ และไม่เริ่มนับวันเป็น Lead หรือ SLA ใหม่</p>
      <button type="submit" disabled={disabled} className={`${bookingButtonClass} bg-blue-700 text-white`}>บันทึกโครงการที่สนใจ</button>
    </fieldset>}
  </form>;
}
