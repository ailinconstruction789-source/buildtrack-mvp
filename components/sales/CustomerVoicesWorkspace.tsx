'use client';

import Image from 'next/image';
import Link from 'next/link';
import QRCode from 'qrcode';
import { useEffect, useRef, useState } from 'react';
import { customerVoicesApi, CustomerVoicesApiError, type CustomerVoicesApi } from '@/lib/sales/customerVoicesClient';
import { parseVoiceSnapshot, parseVoiceStaffInput, parseVoiceStaffResult, VOICE_SCORES, VOICE_OPTIONAL_TEXT, VOICE_CHOICES,
  type VoiceScope, type VoiceSnapshot, type VoiceStaffInput } from '@/lib/sales/customerVoicesContracts';
import { displayBangkokTime } from '@/lib/sales/leadWorkDates';
import { voiceButtonClass, voiceFieldClass } from './CustomerVoiceForm';

interface Props { scope: VoiceScope; api?: CustomerVoicesApi }
interface Pending { actor: string; input: VoiceStaffInput; uncertain: boolean }
interface Capability { token: string; tokenId: string; actor: string }
const statusLabels = { awaiting_voice: 'รอ Customer Voices — Visit ยังไม่สำเร็จ', completed: 'Visit สำเร็จแล้วจาก Customer Voices', cancelled: 'ยกเลิก Visit แล้ว' };
export default function CustomerVoicesWorkspace(props: Props) { return <VoiceSession key={JSON.stringify(props.scope)} {...props} />; }
function VoiceSession({ scope, api = customerVoicesApi }: Props) {
  const { customerId, interestId, visitId } = scope;
  const [revision, setRevision] = useState(0), [reason, setReason] = useState('');
  const [loaded, setLoaded] = useState<{ key: string; api?: CustomerVoicesApi; snapshot?: VoiceSnapshot; error?: boolean }>({ key: '' });
  const [pending, setPending] = useState<Pending | null>(null), [capability, setCapability] = useState<Capability | null>(null);
  const [qr, setQr] = useState<{ key: string; dataUrl: string } | null>(null), [qrError, setQrError] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [clock, setClock] = useState(0);
  const mounted = useRef(false), writing = useRef(false), epoch = useRef(0), pendingRef = useRef<Pending | null>(null), expiredToken = useRef('');
  const key = `${customerId}:${interestId}:${visitId}:${revision}`;
  const snapshot = loaded.key === key && loaded.api === api ? loaded.snapshot : undefined;
  const canManage = !!snapshot && snapshot.scope.canManage && snapshot.visit.status === 'awaiting_voice'
    && (snapshot.actor.role === 'admin' || snapshot.actor.role === 'sales' && snapshot.actor.userId === snapshot.scope.ownerUserId);
  const locked = busy || !!pending;
  const active = snapshot?.activeToken;
  const qrAllowed = !!(capability && snapshot && canManage && !locked && active?.id === capability.tokenId
    && snapshot.actor.userId === capability.actor && new Date(active.expiresAt).getTime() > clock);
  const qrKey = qrAllowed ? `${key}:${capability!.tokenId}:${clock}` : '';
  const link = qrAllowed ? `${window.location.origin}/customer-voices#token=${capability!.token}` : '';
  const remember = (value: Pending | null) => { pendingRef.current = value; if (mounted.current) setPending(value); };
  useEffect(() => {
    mounted.current = true;
    const blocked = () => writing.current || !!pendingRef.current;
    const unload = (event: BeforeUnloadEvent) => { if (blocked()) { event.preventDefault(); event.returnValue = ''; } };
    const navigation = (event: MouseEvent) => { if (blocked() && event.target instanceof Element && event.target.closest('a[href]')) { event.preventDefault(); event.stopPropagation(); } };
    window.addEventListener('beforeunload', unload); document.addEventListener('click', navigation, true);
    return () => { mounted.current = false; window.removeEventListener('beforeunload', unload); document.removeEventListener('click', navigation, true); };
  }, []);
  useEffect(() => {
    const invalidate = () => { epoch.current++; };
    const stop = api.watchIdentity?.(() => {
      invalidate(); pendingRef.current = null; setPending(null); setCapability(null); setQr(null); setReason(''); setError(''); setQrError('');
      setRevision(value => value + 1); setNotice('บัญชีเปลี่ยนแล้ว จึงซ่อนข้อมูลและ QR เดิม หากมีคำขอค้าง ให้ผู้มีสิทธิ์โหลดสถานะและออก QR ใหม่อย่างชัดเจนเพื่อยกเลิกลิงก์เดิม');
    }); return () => { stop?.(); invalidate(); };
  }, [api]);
  useEffect(() => {
    let cancelled = false; const generation = epoch.current;
    api.read({ customerId, interestId, visitId }).then(value => {
      if (cancelled || generation !== epoch.current) return;
      const next = parseVoiceSnapshot(value, { customerId, interestId, visitId });
      setClock(Date.now()); setLoaded({ key, api, snapshot: next });
      setCapability(current => current && current.actor === next.actor.userId && current.tokenId === next.activeToken?.id ? current : null);
    }).catch(() => { if (!cancelled && generation === epoch.current) setLoaded({ key, api, error: true }); });
    return () => { cancelled = true; };
  }, [api, customerId, interestId, visitId, key]);
  useEffect(() => {
    if (!active || expiredToken.current === active.id) return;
    const timeout = setTimeout(() => {
      expiredToken.current = active.id; setClock(Date.now());
      if (!writing.current && !pendingRef.current) setRevision(value => value + 1);
    }, Math.max(0, new Date(active.expiresAt).getTime() - Date.now()));
    return () => clearTimeout(timeout);
  }, [active]);
  useEffect(() => {
    if (!link || !qrKey) return;
    let cancelled = false; const generation = epoch.current;
    void QRCode.toDataURL(link, { width: 320, margin: 4, errorCorrectionLevel: 'M' }).then(dataUrl => {
      if (!cancelled && generation === epoch.current) { setQr({ key: qrKey, dataUrl }); setQrError(''); }
    }).catch(() => { if (!cancelled && generation === epoch.current) setQrError('สร้างภาพ QR ไม่ได้ สามารถคัดลอกลิงก์แทนได้'); });
    return () => { cancelled = true; };
  }, [link, qrKey]);
  const save = async (command: VoiceStaffInput['command']) => {
    if (writing.current || !snapshot) return;
    const previous = pendingRef.current;
    if (previous ? previous.actor !== snapshot.actor.userId : !canManage || command === 'revoke' && !active) return;
    let receipt = previous;
    if (!receipt) {
      try {
        const token = command === 'issue' ? Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('') : null;
        const input = parseVoiceStaffInput({ ...scope, requestId: crypto.randomUUID(), command, expectedInterestRevision: snapshot.scope.interestRevision,
          expectedVisitRevision: snapshot.visit.revision, expectedTokenId: active?.id ?? null, token, reason });
        Object.freeze(input); receipt = { actor: snapshot.actor.userId, input, uncertain: false };
      } catch { setError('กรุณาระบุเหตุผล หรือใช้อุปกรณ์ที่รองรับการสร้าง QR อย่างปลอดภัย'); return; }
    }
    const generation = epoch.current, current = () => mounted.current && generation === epoch.current;
    writing.current = true; setBusy(true); setError(''); setNotice(''); setCapability(null); setQr(null); setQrError(''); remember(receipt);
    try {
      const result = parseVoiceStaffResult(await api.save(receipt.input, receipt.actor), receipt.input);
      if (current()) {
        remember(null); setReason(''); setCapability(receipt.input.command === 'issue' && receipt.input.token ? { token: receipt.input.token, tokenId: result.tokenId, actor: receipt.actor } : null);
        setNotice(receipt.input.command === 'issue' ? 'ออก QR สำเร็จแล้ว กำลังตรวจสถานะล่าสุดก่อนแสดง — QR เดิมถูกยกเลิกเมื่อออกใหม่' : 'ยกเลิก QR แล้ว ลิงก์เดิมใช้ไม่ได้');
        setRevision(value => value + 1);
      }
    } catch (failure) {
      if (current()) {
        if (failure instanceof CustomerVoicesApiError && failure.definitelyNotSaved && !receipt.uncertain) remember(null);
        else remember({ ...receipt, uncertain: true });
        setError(failure instanceof CustomerVoicesApiError ? failure.message : 'ยังยืนยันผลไม่ได้ ให้ตรวจด้วยคำขอเดิม ห้ามออก QR ใหม่ในหน้านี้');
      }
    } finally { writing.current = false; if (mounted.current) setBusy(false); }
  };
  const reload = () => { if (!writing.current && !pendingRef.current) { setError(''); setQrError(''); setRevision(value => value + 1); } };
  const copy = async () => {
    if (!link || !qrAllowed || !active || new Date(active.expiresAt).getTime() <= Date.now()) return; const generation = epoch.current;
    try { await navigator.clipboard.writeText(link); if (mounted.current && generation === epoch.current) setNotice('คัดลอกลิงก์แล้ว ส่งให้ลูกค้าที่มา Visit ครั้งนี้เท่านั้น'); }
    catch { if (mounted.current && generation === epoch.current) setError('คัดลอกไม่ได้ กรุณาให้ลูกค้าสแกน QR'); }
  };
  const answers = snapshot?.submission?.answers;
  return <main className="mx-auto max-w-4xl space-y-5 p-4 sm:p-8">
    <header className="flex flex-wrap justify-between gap-3"><div><h1 className="text-2xl font-bold">Customer Voices ต่อ Visit</h1><p className="text-sm text-slate-600">ให้ลูกค้ากรอกผ่าน QR โดยไม่ต้องเข้าสู่ระบบ</p></div>
      {!locked && <Link href={`/sales-crm/visits?${new URLSearchParams({ customerId, interestId })}`} prefetch={false} className="text-blue-700 underline">กลับนัดหมาย / เข้าชม</Link>}</header>
    <p className="rounded-lg bg-blue-50 p-3 text-sm">Visit จะสำเร็จเมื่อลูกค้าส่ง Customer Voices แล้วเท่านั้น การออก QR หรือทำ SOP ครบยังไม่ทำให้ Visit สำเร็จ</p>
    {notice && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-emerald-900">{notice}</p>}
    {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-rose-800">{error}</p>}
    {pending && <section aria-label="คำขอ QR ค้าง" className="space-y-3 rounded-lg bg-amber-50 p-4"><h2 className="font-bold">ตรวจผลคำขอเดิมก่อนทำรายการใหม่</h2>
      <p>คำขออยู่ในหน่วยความจำของหน้านี้เท่านั้น ไม่บันทึกลิงก์ลงเครื่อง และไม่ส่งซ้ำอัตโนมัติ อย่าเพิ่งปิดหรือรีเฟรชหน้า</p>
      <p>หากปิดหน้าไปแล้ว ให้โหลดสถานะล่าสุด และเลือกออก QR ใหม่พร้อมเหตุผล การออกใหม่จะยกเลิก QR เดิม ไม่ได้ส่งแบบประเมินแทนลูกค้า</p>
      <button disabled={busy || !snapshot || pending.actor !== snapshot.actor.userId} className={voiceButtonClass} onClick={() => void save(pending.input.command)}>{busy ? 'กำลังตรวจผล…' : 'ตรวจผลซ้ำด้วยคำขอเดิม'}</button>
    </section>}
    {!snapshot ? loaded.key === key && loaded.api === api && loaded.error ? <section role="alert" className="space-y-3 rounded-lg border p-4"><p>โหลดข้อมูลล่าสุดไม่ได้ จึงไม่แสดง QR หรือข้อมูลเก่าแทน</p><p>หากบันทึกสำเร็จแล้ว การโหลดใหม่ไม่ส่งคำขอบันทึกซ้ำ</p>
      <button disabled={locked} className={voiceButtonClass} onClick={reload}>โหลดข้อมูลใหม่</button></section> : <p role="status">กำลังตรวจสิทธิ์และโหลด Visit…</p> : <>
      <section className="space-y-3 rounded-xl border bg-white p-5"><h2 className="text-xl font-bold">{snapshot.scope.customerName}</h2><p>{snapshot.scope.projectName} · {statusLabels[snapshot.visit.status]}</p>
        <p className="text-sm">เช็คอินจริง {displayBangkokTime(snapshot.visit.checkedInAt)}</p><p className="text-sm">อายุลิงก์เมื่อออกใหม่ {snapshot.ttlHours} ชั่วโมง · ไม่เก็บลิงก์หรือ QR ลงเครื่อง</p>
        {!canManage && <p className="rounded-lg bg-slate-100 p-3">ดูข้อมูลได้อย่างเดียว การจัดการ QR ต้องเป็น Sales ผู้ดูแลปัจจุบันหรือ Admin และ Visit ต้องยังรอแบบประเมิน</p>}
        <button disabled={locked} className={voiceButtonClass} onClick={reload}>ตรวจสถานะล่าสุด</button>
      </section>
      {active && <p className="text-sm">QR ล่าสุดใช้ได้ถึง {displayBangkokTime(active.expiresAt)} {new Date(active.expiresAt).getTime() <= clock ? '— หมดอายุแล้ว' : ''}</p>}
      {qrAllowed && <section aria-label="QR สำหรับลูกค้า" className="space-y-3 rounded-xl border bg-white p-5"><h2 className="font-bold">ให้ลูกค้าสแกนเพื่อประเมิน Visit ครั้งนี้</h2>
        <p className="text-sm text-amber-900">ผู้ที่มีลิงก์นี้ส่งแบบประเมินได้ ส่งให้ลูกค้ารายนี้เท่านั้น ห้ามเผยแพร่สาธารณะ</p>
        {qr?.key === qrKey ? <Image src={qr.dataUrl} unoptimized alt="QR แบบประเมิน Customer Voices" width={320} height={320} /> : <p role="status">กำลังสร้างภาพ QR ในเครื่อง…</p>}
        {qrError && <p role="alert">{qrError}</p>}<button className={voiceButtonClass} onClick={() => void copy()}>คัดลอกลิงก์ให้ลูกค้า</button>
      </section>}
      {canManage && <form aria-label="จัดการ QR Customer Voices" className="space-y-3 rounded-xl border bg-white p-5" onSubmit={event => { event.preventDefault(); void save('issue'); }}>
        <p className="text-sm">{active ? 'การออก QR ใหม่จะยกเลิกลิงก์เดิมทันที' : 'ออก QR ใหม่สำหรับ Visit นี้'} · หากเพิ่งเปิดหน้านี้ จะไม่มีภาพ QR เดิมให้ดึงกลับ เพราะระบบไม่เก็บลิงก์ลับไว้</p>
        <label className="block space-y-2"><span>เหตุผลในการออก / ยกเลิก QR *</span><input className={voiceFieldClass} required maxLength={1000} value={reason} disabled={locked} onChange={event => setReason(event.target.value)} /></label>
        <div className="flex flex-wrap gap-3"><button disabled={locked} className={voiceButtonClass} type="submit">{active ? 'ออก QR ใหม่และยกเลิกอันเดิม' : 'ออก QR ให้ลูกค้า'}</button>
          {active && <button disabled={locked} className={voiceButtonClass} type="button" onClick={() => void save('revoke')}>ยกเลิก QR ปัจจุบัน</button>}</div>
      </form>}
      {snapshot.submission && <section aria-label="แบบประเมินที่ส่งแล้ว" className="space-y-3 rounded-xl border bg-white p-5"><h2 className="font-bold">ส่ง Customer Voices แล้ว</h2><p>ส่งเมื่อ {displayBangkokTime(snapshot.submission.submittedAt)}</p>
        {answers ? <><p className="font-semibold">คะแนนเฉลี่ย {(VOICE_SCORES.reduce((sum, [field]) => sum + answers[field], 0) / VOICE_SCORES.length).toFixed(2)} / 5</p>
          <dl className="space-y-2">{VOICE_SCORES.map(([field, label]) => <div key={field}><dt className="font-medium">{label}</dt><dd>{answers[field]} / 5</dd></div>)}
            {VOICE_OPTIONAL_TEXT.map(([field, label]) => <div key={field}><dt className="font-medium">{label}</dt><dd>{answers[field] ?? 'ไม่ได้ตอบ'}</dd></div>)}
            {Object.values(VOICE_CHOICES).flat().map(([field, label]) => <div key={field}><dt className="font-medium">{label}</dt><dd>{answers[field] === undefined ? 'ไม่ได้ตอบ' : answers[field] ? 'เลือก' : 'ไม่ได้เลือก'}</dd></div>)}
            <div><dt className="font-medium">ค่าเช่าต่อเดือน</dt><dd>{answers.monthly_rent === undefined ? 'ไม่ได้ตอบ' : `${answers.monthly_rent.toLocaleString('th-TH')} บาท`}</dd></div>
          </dl><p className="text-sm text-slate-600">อ่านได้อย่างเดียว ไม่มีการแก้คำตอบหรือตอบแทนลูกค้าในหน้านี้</p></> : <p>สิทธิ์นี้เห็นสถานะส่งแล้วเท่านั้น ไม่แสดงคำตอบหรือข้อมูลส่วนบุคคล</p>}
      </section>}
    </>}
  </main>;
}
