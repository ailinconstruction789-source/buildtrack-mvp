'use client';

import { useRef, useState, type FormEvent } from 'react';
import { CentralApiError } from '@/lib/sales/centralClient';
import { parseCentralCreateInput, type CentralCreateInput, type CentralCreateResult, type CentralSnapshot } from '@/lib/sales/centralContracts';
import type { InterestedPlot } from '@/lib/sales/plotAvailability';
import AvailablePlotSelect from './AvailablePlotSelect';

interface Props {
  snapshot: CentralSnapshot;
  save: (input: CentralCreateInput) => Promise<CentralCreateResult>;
  onSaved: (result: CentralCreateResult) => void;
  onClose: () => void;
}

function requestId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export default function CentralLeadForm({ snapshot, save, onSaved, onClose }: Props) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [channel, setChannel] = useState('โทร');
  const [notes, setNotes] = useState('');
  const [owner, setOwner] = useState('');
  const [interests, setInterests] = useState<{ projectName: string; plot: InterestedPlot | null }[]>([]);
  const [saving, setSaving] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef<CentralCreateInput | null>(null);
  const inFlight = useRef(false);
  const frozen = saving || uncertain;
  const isAdmin = snapshot.actor.role === 'admin';
  const fieldClass = 'w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100';

  if (snapshot.actor.role === 'owner') return <p>Owner อ่านข้อมูลได้ แต่ไม่มีสิทธิ์สร้าง Lead</p>;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (inFlight.current) return;
    setError('');
    try {
      const input = pending.current || parseCentralCreateInput({
        requestId: requestId(), name, phone, channel, notes,
        interests: interests.map(interest => ({ projectName: interest.projectName, plotId: interest.plot?.id || null })),
        ...(isAdmin ? { assignedSalesUserId: owner } : {}),
      });
      pending.current = input;
      inFlight.current = true;
      setSaving(true);
      const result = await save(input);
      pending.current = null;
      setUncertain(false);
      onSaved(result);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'บันทึกไม่สำเร็จ กรุณาลองใหม่');
      if (pending.current) {
        if (!uncertain && failure instanceof CentralApiError && failure.definitelyNotSaved) {
          pending.current = null; setUncertain(false);
        } else {
          // The request may have committed before the connection was interrupted.
          // Freeze its payload and reuse the SAME idempotency key on a retry.
          setUncertain(true);
        }
      }
    } finally { inFlight.current = false; setSaving(false); }
  };

  return (
    <form onSubmit={submit} aria-label="บันทึก Lead ส่วนกลาง" className="rounded-2xl border border-blue-200 bg-blue-50/40 p-5 space-y-5">
      <div><h2 className="text-lg font-bold text-slate-900">บันทึก Lead ใหม่</h2>
        <p className="text-sm text-slate-500">มีชื่อและเบอร์ก็เริ่มได้ โครงการและแปลงเพิ่มภายหลังได้</p></div>
      <fieldset disabled={frozen} className="grid gap-4 sm:grid-cols-2 disabled:opacity-70">
        <label className="text-sm font-medium text-slate-700">ชื่อลูกค้า *<input required maxLength={200} value={name}
          onChange={event => setName(event.target.value)} autoComplete="name" className={fieldClass} /></label>
        <label className="text-sm font-medium text-slate-700">เบอร์โทร *<input required type="tel" maxLength={32} value={phone}
          onChange={event => setPhone(event.target.value)} autoComplete="tel" className={fieldClass} /></label>
        <label className="text-sm font-medium text-slate-700">ช่องทางรับเข้า<select value={channel} onChange={event => setChannel(event.target.value)} className={fieldClass}>
          {['โทร', 'Facebook', 'Line OA', 'Line ส่วนตัว', 'Walk in', 'TikTok', 'Youtube', 'Referral', 'Billboard', 'Other'].map(item => <option key={item}>{item}</option>)}
        </select></label>
        {isAdmin ? <label className="text-sm font-medium text-slate-700">Sales ผู้ดูแล *<select required value={owner}
          onChange={event => setOwner(event.target.value)} className={fieldClass}>
          <option value="">เลือก Sales ที่ดูแลลูกค้า</option>
          {snapshot.salesOwners.map(person => <option key={person.userId} value={person.userId}>{person.displayName}</option>)}
        </select></label> : <div className="rounded-xl border border-blue-100 bg-white p-3 text-sm text-blue-800">
          คุณเป็นผู้บันทึกและผู้ดูแล Lead นี้โดยอัตโนมัติ ไม่ต้องกดรับงานอีกครั้ง</div>}
        <label className="text-sm font-medium text-slate-700 sm:col-span-2">หมายเหตุ / ความต้องการ<textarea value={notes} maxLength={4000} rows={3}
          onChange={event => setNotes(event.target.value)} className={fieldClass} /></label>
      </fieldset>
      <fieldset disabled={frozen} className="space-y-3">
        <legend className="text-sm font-semibold text-slate-700 mb-2">โครงการที่สนใจ (ไม่บังคับ เลือกได้หลายโครงการ)</legend>
        <select aria-label="เพิ่มโครงการที่สนใจ" value="" disabled={frozen || interests.length >= 20}
          onChange={event => {
            if (event.target.value && !interests.some(item => item.projectName === event.target.value)) {
              setInterests(items => [...items, { projectName: event.target.value, plot: null }]);
            }
          }} className={fieldClass}>
          <option value="">ยังไม่ระบุ / เลือกเพิ่มโครงการ</option>
          {snapshot.projects.filter(project => !interests.some(item => item.projectName === project.name))
            .map(project => <option key={project.name}>{project.name}</option>)}
        </select>
        {interests.map(interest => <div key={interest.projectName} className="rounded-xl border border-slate-200 bg-white p-3">
          <div className="flex justify-between gap-3 mb-2"><span className="font-semibold text-sm">{interest.projectName}</span>
            <button type="button" disabled={frozen} aria-label={`ลบความสนใจ ${interest.projectName}`}
              onClick={() => setInterests(items => items.filter(item => item.projectName !== interest.projectName))} className="text-xs text-rose-700">นำออก</button></div>
          <AvailablePlotSelect projectName={interest.projectName} value={interest.plot} disabled={frozen}
            onChange={plot => setInterests(items => items.map(item => item.projectName === interest.projectName ? { ...item, plot } : item))} />
        </div>)}
        <p className="text-xs text-slate-500">ความสนใจยังอยู่ส่วนกลาง การเลือกแปลงไม่จองหรือล็อกแปลง งานในโครงการจะเริ่มเมื่อเข้าชมหรือจอง</p>
      </fieldset>
      {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}
      {uncertain && <p className="text-sm text-amber-800">ยังยืนยันผลบันทึกไม่ได้ กรุณาลองซ้ำด้วยคำขอเดิม ข้อมูลถูกพักไว้เพื่อป้องกันสร้าง Lead ซ้ำ</p>}
      <div className="flex flex-wrap justify-end gap-3">
        <button type="button" onClick={onClose} disabled={saving || uncertain} className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm disabled:opacity-50">ยกเลิก</button>
        <button type="submit" disabled={saving} className="rounded-xl bg-blue-700 text-white px-5 py-2.5 font-semibold text-sm disabled:opacity-50">
          {saving ? 'กำลังบันทึก…' : uncertain ? 'ลองบันทึกซ้ำด้วยคำขอเดิม' : 'บันทึก Lead ส่วนกลาง'}</button>
      </div>
    </form>
  );
}
