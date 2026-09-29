'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { CentralApiError } from '@/lib/sales/centralClient';
import { parseCentralCreateInput, type CentralCreateInput, type CentralCreateResult, type CentralSnapshot } from '@/lib/sales/centralContracts';
import type { InterestedPlot } from '@/lib/sales/plotAvailability';
import AvailablePlotSelect from './AvailablePlotSelect';
import { CentralPendingError, clearCentralPending, readCentralPending, writeCentralPending } from '@/lib/sales/centralPending';

interface Props {
  snapshot: CentralSnapshot;
  save: (input: CentralCreateInput, expectedActor: string) => Promise<CentralCreateResult>;
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

export default function CentralLeadForm(props: Props) {
  return <CentralLeadFormSession key={props.snapshot.actor.userId} {...props} />;
}
function CentralLeadFormSession({ snapshot, save, onSaved, onClose }: Props) {
  const [recovery] = useState(() => {
    try { return { input: readCentralPending(snapshot.actor.userId), error: '' }; }
    catch (failure) { return { input: null, error: failure instanceof Error ? failure.message : 'ตรวจคำขอค้างไม่ได้' }; }
  });
  const [name, setName] = useState(recovery.input?.name ?? '');
  const [phone, setPhone] = useState(recovery.input?.phone ?? '');
  const [channel, setChannel] = useState(recovery.input?.channel ?? 'โทร');
  const [notes, setNotes] = useState(recovery.input?.notes ?? '');
  const [owner, setOwner] = useState(recovery.input?.assignedSalesUserId ?? '');
  const [interests, setInterests] = useState<{ projectName: string; plot: InterestedPlot | null }[]>(() => recovery.input?.interests.map(interest => ({
    projectName: interest.projectName, plot: interest.plotId ? { id: interest.plotId, project_name: interest.projectName,
      plot_name: null, has_customer: null, sale_status: null } : null,
  })) ?? []);
  const [saving, setSaving] = useState(false);
  const [uncertain, setUncertain] = useState(!!recovery.input);
  const [error, setError] = useState('');
  const [storageError, setStorageError] = useState(recovery.error);
  const pending = useRef<CentralCreateInput | null>(recovery.input);
  const inFlight = useRef(false);
  const mounted = useRef(false);
  const completed = useRef(false);
  const frozen = saving || uncertain || !!storageError;
  const isAdmin = snapshot.actor.role === 'admin';
  const fieldClass = 'w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100';

  useEffect(() => {
    mounted.current = true;
    const unload = (event: BeforeUnloadEvent) => { if (pending.current || inFlight.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', unload);
    return () => { mounted.current = false; window.removeEventListener('beforeunload', unload); };
  }, []);

  if (snapshot.actor.role === 'owner') return <p>Owner อ่านข้อมูลได้ แต่ไม่มีสิทธิ์สร้าง Lead</p>;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (inFlight.current || storageError || completed.current) return;
    setError('');
    try {
      const input = pending.current || parseCentralCreateInput({
        requestId: requestId(), name, phone, channel, notes,
        interests: interests.map(interest => ({ projectName: interest.projectName, plotId: interest.plot?.id || null })),
        ...(isAdmin ? { assignedSalesUserId: owner } : {}),
      });
      pending.current = writeCentralPending(snapshot.actor.userId, input);
      inFlight.current = true;
      setSaving(true);
      const result = await save(input, snapshot.actor.userId);
      completed.current = true;
      clearCentralPending(snapshot.actor.userId, input);
      pending.current = null;
      if (mounted.current) { setUncertain(false); onSaved(result); }
    } catch (failure) {
      if (failure instanceof CentralPendingError) {
        if (mounted.current) setStorageError(failure.message);
        return;
      }
      if (mounted.current) setError(failure instanceof Error ? failure.message : 'บันทึกไม่สำเร็จ กรุณาลองใหม่');
      if (pending.current) {
        if (!uncertain && failure instanceof CentralApiError && failure.definitelyNotSaved) {
          try {
            clearCentralPending(snapshot.actor.userId, pending.current);
            pending.current = null; if (mounted.current) setUncertain(false);
          } catch (storageFailure) { if (mounted.current) setStorageError(storageFailure instanceof Error ? storageFailure.message : 'ตรวจคำขอค้างไม่ได้'); }
        } else {
          // The request may have committed before the connection was interrupted.
          // Freeze its payload and reuse the SAME idempotency key on a retry.
          if (mounted.current) setUncertain(true);
        }
      }
    } finally { inFlight.current = false; if (mounted.current) setSaving(false); }
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
        <p className="text-xs text-slate-500">เลือกแปลงที่เล็งได้โดยไม่จองหรือล็อกแปลง การติดตามและเข้าชมยังอยู่ส่วนกลาง เมื่อจองจึงเชื่อมลูกค้าคนเดิมกับข้อมูลจองของโครงการ</p>
      </fieldset>
      {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}
      {storageError && <p role="alert" className="text-sm text-rose-800">{storageError}</p>}
      {uncertain && <p className="text-sm text-amber-800">ยังยืนยันผลบันทึกไม่ได้ กรุณาลองซ้ำด้วยคำขอเดิม ข้อมูลถูกพักไว้เพื่อป้องกันสร้าง Lead ซ้ำ</p>}
      <div className="flex flex-wrap justify-end gap-3">
        <button type="button" onClick={onClose} disabled={frozen} className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm disabled:opacity-50">ยกเลิก</button>
        <button type="submit" disabled={saving || !!storageError} className="rounded-xl bg-blue-700 text-white px-5 py-2.5 font-semibold text-sm disabled:opacity-50">
          {saving ? 'กำลังบันทึก…' : uncertain ? 'ลองบันทึกซ้ำด้วยคำขอเดิม' : 'บันทึก Lead ส่วนกลาง'}</button>
      </div>
    </form>
  );
}
