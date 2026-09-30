'use client';

import { useEffect, useRef, useState } from 'react';
import { customerVoicePublicApi, CustomerVoicesApiError, type CustomerVoicePublicApi } from '@/lib/sales/customerVoicesClient';
import { parseVoicePublicInput, parseVoicePublicResult, type VoiceAnswers, type VoicePublicInput } from '@/lib/sales/customerVoicesContracts';
import { displayBangkokTime } from '@/lib/sales/leadWorkDates';
import CustomerVoiceForm, { voiceButtonClass } from './CustomerVoiceForm';

type Submit = Extract<VoicePublicInput, { command: 'submit' }>;
interface Pending { input: Submit; uncertain: boolean }
interface Props { api?: CustomerVoicePublicApi }
export default function CustomerVoicePublic({ api = customerVoicePublicApi }: Props) {
  const [opened, setOpened] = useState<{ formVersion: string; expiresAt: string; api: CustomerVoicePublicApi } | null>(null);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [done, setDone] = useState(false), [expired, setExpired] = useState(false), [invalidLink, setInvalidLink] = useState(false), [linkChanged, setLinkChanged] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null), [revision, setRevision] = useState(0);
  const token = useRef<string | null | undefined>(undefined), mounted = useRef(false), writing = useRef(false), epoch = useRef(0);
  const pendingRef = useRef<Pending | null>(null), finished = useRef(false);
  const active = opened?.api === api ? opened : null;
  useEffect(() => {
    mounted.current = true;
    const unload = (event: BeforeUnloadEvent) => { if (pendingRef.current || writing.current) { event.preventDefault(); event.returnValue = ''; } };
    const hashChanged = () => {
      // Never carry old answers into another Visit when a new QR opens in this same page.
      epoch.current++; token.current = null; setOpened(null); setDone(false); setLinkChanged(true); setError('');
      if (pendingRef.current) { const receipt = { ...pendingRef.current, uncertain: true }; pendingRef.current = receipt; setPending(receipt); }
      try { window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search); } catch { /* No further requests use the new fragment. */ }
    };
    window.addEventListener('beforeunload', unload); window.addEventListener('hashchange', hashChanged);
    return () => { mounted.current = false; window.removeEventListener('beforeunload', unload); window.removeEventListener('hashchange', hashChanged); };
  }, []);
  useEffect(() => {
    let cancelled = false; const generation = ++epoch.current;
    if (token.current === undefined) {
      const match = /^#token=([a-f0-9]{64})$/.exec(window.location.hash);
      // Remove the capability before any request. Do not preserve it in browser history or storage.
      try { window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search); token.current = match?.[1] ?? null; }
      catch { token.current = null; }
      if (!token.current) setInvalidLink(true);
    }
    if (!token.current || finished.current || pendingRef.current) return;
    const input: VoicePublicInput = { command: 'open', token: token.current };
    api.request(input).then(value => {
      if (cancelled || generation !== epoch.current) return;
      const result = parseVoicePublicResult(value, input);
      if (!('formVersion' in result)) throw new Error();
      setOpened({ ...result, api }); setExpired(new Date(result.expiresAt).getTime() <= Date.now()); setError('');
    }).catch(() => { if (!cancelled && generation === epoch.current) setError('เปิดแบบประเมินไม่ได้ ลิงก์อาจหมดอายุหรือถูกยกเลิก กรุณาติดต่อฝ่ายขายหรือลองเปิดอีกครั้ง'); });
    return () => { cancelled = true; };
  }, [api, revision]);
  useEffect(() => {
    if (!active) return;
    const remaining = new Date(active.expiresAt).getTime() - Date.now();
    const timeout = setTimeout(() => setExpired(true), Math.max(0, remaining));
    return () => clearTimeout(timeout);
  }, [active]);
  const remember = (value: Pending | null) => { pendingRef.current = value; if (mounted.current) setPending(value); };
  const submit = async (answers?: VoiceAnswers) => {
    if (writing.current || finished.current || !pendingRef.current && (!active || !token.current || expired)) return;
    const generation = epoch.current, current = () => mounted.current && generation === epoch.current;
    let receipt = pendingRef.current;
    if (!receipt) {
      try {
        const input = parseVoicePublicInput({ command: 'submit', token: token.current, requestId: crypto.randomUUID(), formVersion: active!.formVersion, answers });
        if (input.command !== 'submit') return;
        Object.freeze(input.answers); Object.freeze(input); receipt = { input, uncertain: false };
      } catch { setError('กรุณาตรวจคำตอบ หรือลองใช้อุปกรณ์ที่รองรับการส่งแบบประเมินอย่างปลอดภัย'); return; }
    }
    writing.current = true; setBusy(true); setError(''); remember(receipt);
    try {
      const result = parseVoicePublicResult(await api.request(receipt.input), receipt.input);
      if (!('submitted' in result)) throw new Error();
      if (current()) { finished.current = true; token.current = null; remember(null); setOpened(null); setDone(true); }
    } catch (failure) {
      if (current()) {
        if (failure instanceof CustomerVoicesApiError && failure.definitelyNotSaved && !receipt.uncertain) {
          remember(null); if (failure.code === 'TOKEN_UNAVAILABLE' || failure.code === 'SCOPE_CLOSED') setExpired(true);
        }
        else remember({ ...receipt, uncertain: true });
        setError(failure instanceof CustomerVoicesApiError ? failure.message : 'ยังยืนยันการส่งไม่ได้ กรุณาตรวจผลด้วยคำขอเดิม อย่าเพิ่งปิดหน้านี้');
      }
    } finally { writing.current = false; if (mounted.current) setBusy(false); }
  };
  return <main lang="th" className="mx-auto max-w-3xl space-y-5 p-5 sm:p-8">
    <header><h1 className="text-2xl font-bold">Customer Voices</h1><p className="mt-2 text-slate-600">ความคิดเห็นจากการเข้าชมของคุณ</p></header>
    {done ? <section role="status" className="rounded-xl bg-emerald-50 p-6 text-emerald-900"><h2 className="text-xl font-bold">ขอบคุณ ส่งแบบประเมินแล้ว</h2><p>ปิดหน้านี้ได้เลย ขอบคุณสำหรับความคิดเห็นเพื่อปรับปรุงบริการ</p></section> : <>
      {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-rose-800">{error}</p>}
      {linkChanged && <p role="alert">ลิงก์เปลี่ยนในหน้าเดิม จึงซ่อนคำตอบเดิมแล้ว {pending ? 'ตรวจผลคำขอเดิมให้เสร็จก่อน' : 'กรุณาปิดหน้านี้ แล้วเปิด QR ที่ต้องการอีกครั้ง'}</p>}
      {pending && <section aria-label="ตรวจผลแบบประเมิน" className="space-y-3 rounded-xl bg-amber-50 p-4"><p>เก็บคำตอบเดิมไว้ชั่วคราวในหน้านี้ ยังแก้ไขหรือส่งคำตอบใหม่ไม่ได้ ระบบไม่ส่งซ้ำอัตโนมัติ</p>
        <p>อย่าเพิ่งปิดหรือรีเฟรชหน้า หากปิดแล้วให้ติดต่อฝ่ายขายเพื่อตรวจสถานะก่อนขอลิงก์ใหม่</p>
        <button className={voiceButtonClass} disabled={busy} onClick={() => void submit()}>{busy ? 'กำลังตรวจผล…' : 'ตรวจผลซ้ำด้วยคำขอเดิม'}</button>
      </section>}
      {active ? <><p className="text-sm text-slate-600">ลิงก์ใช้ได้ถึง {displayBangkokTime(active.expiresAt)} · ไม่ต้องเข้าสู่ระบบ</p>
        {expired && <p role="alert">ลิงก์หมดอายุแล้ว กรุณาติดต่อฝ่ายขาย {pending ? 'หากมีคำขอค้างยังตรวจผลเดิมได้' : ''}</p>}
        <CustomerVoiceForm disabled={busy || !!pending || expired} onSubmit={answers => void submit(answers)} />
      </> : error ? <button className={voiceButtonClass} disabled={busy || !!pending} onClick={() => { setError(''); setRevision(value => value + 1); }}>ลองเปิดแบบประเมินอีกครั้ง</button>
        : invalidLink ? <p role="alert">ลิงก์แบบประเมินไม่ถูกต้อง กรุณาขอ QR ใหม่จากฝ่ายขาย</p> : !linkChanged && <p role="status">กำลังเปิดแบบประเมิน…</p>}
    </>}
  </main>;
}
