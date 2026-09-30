'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { visitFollowUpApi } from '@/lib/sales/visitFollowUpClient';
import { LeadWorkApiError, type LeadWorkApi } from '@/lib/sales/leadWorkClient';
import type { LeadWorkScope, LeadWorkSnapshot } from '@/lib/sales/leadWorkReadContracts';
import { displayBangkokTime } from '@/lib/sales/leadWorkDates';
import LeadWorkForm from './LeadWorkForm';

type FollowUpApi = LeadWorkApi & { watchIdentity?: (callback: () => void) => () => void };
interface Props { scope: LeadWorkScope; api?: FollowUpApi }

export default function VisitFollowUpWorkspace(props: Props) {
  return <FollowUpSession key={`${props.scope.customerId}:${props.scope.interestId ?? 'invalid'}`} {...props} />;
}
function FollowUpSession({ scope, api = visitFollowUpApi }: Props) {
  const [revision, setRevision] = useState(0), [identity, setIdentity] = useState(0);
  const [loaded, setLoaded] = useState<{ key: string; api?: FollowUpApi; snapshot?: LeadWorkSnapshot; error?: string }>({ key: '' });
  const [locked, setLocked] = useState(true), [notice, setNotice] = useState('');
  const epoch = useRef(0), lockedRef = useRef(true);
  const key = `${revision}:${identity}`;
  const snapshot = loaded.key === key && loaded.api === api ? loaded.snapshot : undefined;
  const error = loaded.key === key && loaded.api === api ? loaded.error : undefined;
  const setLock = useCallback((value: boolean) => { lockedRef.current = value; setLocked(value); }, []);
  const refresh = useCallback(async () => { setLock(true); setRevision(value => value + 1); }, [setLock]);

  useEffect(() => {
    const block = (event: BeforeUnloadEvent | MouseEvent) => {
      if (lockedRef.current && (event.type === 'beforeunload' || (event.target instanceof Element && event.target.closest('a[href]')))) {
        event.preventDefault(); if (event.type === 'beforeunload') event.returnValue = false; else event.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', block); document.addEventListener('click', block, true);
    return () => { window.removeEventListener('beforeunload', block); document.removeEventListener('click', block, true); };
  }, []);
  useEffect(() => {
    const invalidate = () => { epoch.current++; };
    const stop = api.watchIdentity?.(() => {
      invalidate(); setLock(true); setIdentity(value => value + 1);
      setNotice('บัญชีเปลี่ยนแล้ว จึงซ่อนข้อมูลเดิม หากมีคำขอค้างให้กลับบัญชีเดิมเพื่อตรวจคำขอเดิม');
    });
    return () => { invalidate(); stop?.(); };
  }, [api, setLock]);
  useEffect(() => {
    let cancelled = false; const currentEpoch = epoch.current;
    const current = () => !cancelled && currentEpoch === epoch.current;
    void Promise.resolve().then(async () => {
      if (!current()) return;
      if (!scope.interestId) throw new Error('ต้องเลือกโครงการที่สนใจจากหน้าส่วนกลางก่อน');
      const value = await api.read(scope);
      if (!current()) return;
      if (value.scope.customerId !== scope.customerId || value.scope.interestId !== scope.interestId || value.customer.id !== scope.customerId || !value.projectName) {
        throw new Error('ข้อมูลตอบกลับไม่ตรงกับลูกค้าหรือโครงการที่เลือก');
      }
      setLoaded({ key, api, snapshot: value });
    }).catch(failure => {
      if (!current()) return;
      setLoaded({ key, api, error: failure instanceof Error ? failure.message : 'โหลดแผนติดตามไม่ได้' }); setLock(false);
    });
    return () => { cancelled = true; };
  }, [api, key, scope, setLock]);

  const visitsHref = `/sales-crm/visits?${new URLSearchParams({ customerId: scope.customerId, interestId: scope.interestId ?? '' })}`;
  return <main className="mx-auto max-w-5xl space-y-5 p-4 sm:p-8">
    <header className="flex flex-wrap justify-between gap-3"><div><h1 className="text-2xl font-bold">งานติดตามหลังเข้าชม</h1>
      <p className="text-sm text-slate-600">ตั้งหรือเปลี่ยนงานถัดไปของโครงการนี้ก่อนยืนยัน SOP ช่วงปิดบ้าน</p></div>
      {locked ? <span className="text-sm text-slate-500">ตรวจคำขอค้างก่อนออกจากหน้านี้</span> : <Link href={visitsHref} prefetch={false} className="text-blue-700 underline">กลับนัดหมาย / เข้าชม</Link>}
    </header>
    <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">แผนงานไม่ใช่หลักฐานการติดต่อจริง และไม่ทำให้ Visit หรือ SOP สำเร็จโดยอัตโนมัติ ไม่มีการเปลี่ยนเจ้าของ Lead ปิด Lost หรือทำแทน Sales</p>
    {notice && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-emerald-900">{notice}</p>}
    {!snapshot && !error && <p role="status">กำลังตรวจสิทธิ์และโหลดแผนล่าสุด…</p>}
    {error && <section role="alert" className="space-y-3 rounded-xl border border-amber-300 p-4"><p>{error}</p>
      <p>ไม่ใช้ข้อมูลเก่าแทน และไม่ส่งคำขอบันทึกซ้ำจากการโหลด</p><button disabled={locked} onClick={() => void refresh()} className="rounded-lg border px-3 py-2">โหลดข้อมูลใหม่</button></section>}
    {snapshot && <>
      <section className="space-y-2 rounded-xl border bg-white p-5"><h2 className="text-xl font-bold">{snapshot.customer.name}</h2>
        <p>{snapshot.projectName} · {snapshot.customer.phone ?? 'ไม่ทราบเบอร์ (ข้อมูลเก่า)'}</p><p>ผู้รับผิดชอบ: {snapshot.owner.displayName ?? snapshot.owner.userId}</p>
        <h3 className="font-semibold">งานถัดไปปัจจุบัน</h3>{snapshot.currentAction ? <><p>{snapshot.currentAction.action}</p><p>กำหนด {displayBangkokTime(snapshot.currentAction.dueAt)} (กรุงเทพฯ)</p></> : <p>ยังไม่มีงานถัดไปที่เปิดอยู่</p>}
        <p className="text-xs text-slate-500">ข้อมูล ณ {displayBangkokTime(snapshot.asOf)} · ไม่ใช่คะแนน KPI</p>
      </section>
      <LeadWorkForm key={`${key}:${snapshot.actor.userId}`} mode="visit_follow_up" snapshot={snapshot} onLockedChange={setLock}
        onRefreshRequired={refresh} onSaved={() => { setNotice('บันทึกแผนถัดไปสำเร็จแล้ว ไม่ต้องส่งซ้ำ กรุณาโหลดสถานะล่าสุดก่อนทำงานต่อ'); }}
        save={input => {
          if (input.command !== 'set_next_action' || input.customerId !== scope.customerId || input.interestId !== scope.interestId
            || snapshot.actor.role !== 'sales' || snapshot.actor.userId !== snapshot.owner.userId || !snapshot.canWrite || !snapshot.owner.active || snapshot.scopeClosed) {
            return Promise.reject(new LeadWorkApiError('FORBIDDEN', 'หน้านี้ให้ Sales เจ้าของโครงการบันทึกแผนถัดไปเท่านั้น', 403));
          }
          return api.save(input, snapshot.actor.userId);
        }} />
      <section className="space-y-3 rounded-xl border bg-white p-5"><h2 className="font-bold">ประวัติแผนงาน</h2>
        <p className="text-xs text-slate-500">ล่าสุดไม่เกิน {snapshot.history.limit} รายการ{snapshot.history.actionsHasMore ? ' · ยังมีรายการเก่ากว่านี้' : ''} · ไม่มีการลบประวัติ</p>
        {snapshot.actions.map(action => <article key={action.id} className="space-y-1 border-t pt-3 text-sm"><p className="font-semibold">{action.action}</p>
          <p>กำหนดเดิม {displayBangkokTime(action.dueAt)} · {action.status === 'open' ? 'แผนปัจจุบัน' : action.status === 'superseded' ? 'มีแผนใหม่แทน ไม่ใช่ทำสำเร็จ' : 'ปิดแผน ไม่ใช่ทำสำเร็จ'}</p>
          {action.closeReason && <p>เหตุผลเปลี่ยนแผน: {action.closeReason}</p>}</article>)}
        {!snapshot.actions.length && <p>ยังไม่มีประวัติแผนงาน</p>}
      </section>
    </>}
  </main>;
}
