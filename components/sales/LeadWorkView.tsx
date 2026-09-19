'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { leadWorkApi, LeadWorkApiError, type LeadWorkApi } from '@/lib/sales/leadWorkClient';
import { leadLifecycleApi, LeadLifecycleApiError, type LeadLifecycleApi } from '@/lib/sales/leadLifecycleClient';
import type { LeadLifecycleContext } from '@/lib/sales/leadLifecycleReadContracts';
import type { LeadWorkScope, LeadWorkSnapshot } from '@/lib/sales/leadWorkReadContracts';
import { displayBangkokTime, isLeadWorkOverdue } from '@/lib/sales/leadWorkDates';
import LeadOperations from './LeadOperations';

interface Props { scope: LeadWorkScope; api?: LeadWorkApi; lifecycleEnabled?: boolean; lifecycleApi?: LeadLifecycleApi }
const channelLabels: Record<string, string> = { phone: 'โทรศัพท์', chat: 'แชท', email: 'อีเมล', in_person: 'พบด้วยตนเอง', other: 'อื่น ๆ' };
const resultLabels: Record<string, string> = { contact_success: 'ติดต่อสำเร็จ', no_answer: 'ไม่รับสาย / ไม่ตอบ (ไม่ใช่ติดต่อสำเร็จ)', customer_requested_later: 'ลูกค้าขอให้ติดต่อภายหลัง', other: 'อื่น ๆ' };

export default function LeadWorkView({ scope, api = leadWorkApi, lifecycleEnabled = false, lifecycleApi = leadLifecycleApi }: Props) {
    // A route scope switch starts a separate workspace; late reads cannot fill it.
    return <LeadWorkWorkspace key={`${scope.customerId}:${scope.interestId ?? 'central'}`} scope={scope} api={api} lifecycleEnabled={lifecycleEnabled} lifecycleApi={lifecycleApi} />;
}

function LeadWorkWorkspace({ scope, api, lifecycleEnabled, lifecycleApi }: { scope: LeadWorkScope; api: LeadWorkApi; lifecycleEnabled: boolean; lifecycleApi: LeadLifecycleApi }) {
    const [snapshot, setSnapshot] = useState<LeadWorkSnapshot | null>(null);
    const [context, setContext] = useState<LeadLifecycleContext | null>(null);
    const [readVersion, setReadVersion] = useState(0);
    const [error, setError] = useState<Error | null>(null);
    const [loading, setLoading] = useState(true);
    const [locked, setLocked] = useState(true);
    const [notice, setNotice] = useState('');
    const generation = useRef(0);
    const alive = useRef(false);
    const customerId = scope.customerId, interestId = scope.interestId;

    const read = useCallback(async () => {
        const request = ++generation.current;
        try {
            // One coherent read when lifecycle is enabled; no independent work/
            // lifecycle snapshots from different sessions or points in time.
            const nextContext = lifecycleEnabled ? await lifecycleApi.read({ customerId, interestId }) : null;
            const next = lifecycleEnabled ? nextContext!.work : await api.read({ customerId, interestId });
            if (!alive.current || request !== generation.current) return;
            if (next.scope.customerId !== customerId || next.scope.interestId !== interestId || next.customer.id !== customerId) {
                throw new Error('ข้อมูลตอบกลับไม่ตรงกับลูกค้าหรือโครงการที่เปิดอยู่ จึงยังแสดงไม่ได้');
            }
            setSnapshot(next);
            setContext(nextContext); setReadVersion(value => value + 1);
        } catch (failure) {
            if (!alive.current || request !== generation.current) return;
            const safe = failure instanceof LeadWorkApiError || failure instanceof LeadLifecycleApiError ? failure : new Error('โหลดข้อมูลติดตามไม่สำเร็จ กรุณาตรวจสอบอีกครั้ง');
            setError(safe); setSnapshot(null); setContext(null); setLocked(false);
            throw safe;
        } finally { if (alive.current && request === generation.current) setLoading(false); }
    }, [api, customerId, interestId, lifecycleApi, lifecycleEnabled]);
    const refresh = useCallback(async () => {
        setLoading(true); setError(null);
        await read();
    }, [read]);

    useEffect(() => {
        let cancelled = false;
        alive.current = true;
        // Start external work after the mount commit, including when an injected
        // reader throws synchronously. Strict-mode cleanup cancels that kickoff.
        void Promise.resolve().then(() => { if (!cancelled) return read(); }).catch(() => undefined);
        return () => { cancelled = true; alive.current = false; };
    }, [read]);
    const onLockedChange = useCallback((value: boolean) => setLocked(value), []);
    const needsSetup = (error instanceof LeadWorkApiError || error instanceof LeadLifecycleApiError) && ['FEATURE_DISABLED', 'SETUP_REQUIRED'].includes(error.code);
    const onSaved = useCallback((kind: 'work' | 'lifecycle') => {
        setNotice(`${kind === 'work' ? 'บันทึกงานติดตาม' : 'ทำรายการ Lead '}สำเร็จแล้ว ไม่ต้องส่งคำขอใหม่ซ้ำ แม้การโหลดรายการล่าสุดไม่สำเร็จ`);
        void refresh().catch(() => undefined);
    }, [refresh]);
    const current = snapshot?.currentAction;

    return <main className="min-h-screen bg-slate-50 px-4 py-6 sm:px-8 sm:py-10">
        <div className="mx-auto max-w-5xl space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div>{locked ? <span aria-disabled="true" className="text-sm text-slate-400">← กลับ Lead ส่วนกลาง (มีคำขอค้าง)</span>
                    : <Link href="/sales-crm" className="text-sm text-blue-700 hover:underline">← กลับ Lead ส่วนกลาง</Link>}
                    <h1 className="mt-3 text-2xl font-bold text-slate-900 sm:text-3xl">ติดตาม Lead</h1>
                    <p className="mt-2 text-sm text-slate-500">กิจกรรมจริง · งานถัดไป · ประวัติการเปลี่ยนแผน</p></div>
                <button type="button" disabled={locked || loading} onClick={() => { void refresh().catch(() => undefined); }} className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold disabled:opacity-40">รีเฟรชข้อมูล</button>
            </div>
            {notice && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">{notice}</p>}
            {loading && <p role="status" className="text-sm text-slate-600">กำลังตรวจสิทธิ์และโหลดข้อมูลล่าสุด…</p>}
            {error && <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 space-y-2">
                <h2 className="font-bold text-amber-950">{needsSetup ? 'ยังไม่เปิดระบบติดตาม Lead ใหม่' : 'ยังแสดงข้อมูลติดตามไม่ได้'}</h2>
                <p role="alert" className="text-sm text-amber-900">{error.message}</p>
                {needsSetup && <p className="text-sm text-amber-900">ไม่มีการบันทึกผ่านระบบเก่าแทน และไม่มีการเปิดสิทธิ์อัตโนมัติ</p>}
            </section>}
            {snapshot && <>
                <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
                    <div className="flex flex-wrap justify-between gap-3"><div><h2 className="text-xl font-bold text-slate-900">{snapshot.customer.name}</h2>
                        <p className="mt-1 text-sm text-slate-600">{snapshot.customer.phone ?? 'ไม่ทราบเบอร์ (ข้อมูลเก่า)'}</p></div>
                        <span className="h-fit rounded-full bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-800">{snapshot.projectName ?? 'งานส่วนกลาง / ยังไม่แยกโครงการ'}</span></div>
                    <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
                        <div><dt className="text-slate-500">ผู้ดูแลงานนี้</dt><dd className="mt-1 font-semibold text-slate-800">{snapshot.owner.displayName ?? snapshot.owner.userId}{snapshot.owner.active ? '' : ' (ไม่พร้อมรับงาน)'}</dd></div>
                        <div><dt className="text-slate-500">วันที่เป็น Lead</dt><dd className="mt-1 text-slate-800">{displayBangkokTime(snapshot.customer.leadCreatedAt)}</dd></div>
                    </dl>
                </section>
                <section className={`rounded-2xl border p-5 sm:p-6 ${current && isLeadWorkOverdue(current.dueAt, snapshot.asOf) ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-white'}`}>
                    <h2 className="font-bold text-slate-900">งานถัดไปปัจจุบัน</h2>
                    {current ? <><p className="mt-3 text-lg font-semibold text-slate-900">{current.action}</p>
                        <p className="mt-2 text-sm text-slate-700">กำหนด: {displayBangkokTime(current.dueAt)} (กรุงเทพฯ)</p>
                        {isLeadWorkOverdue(current.dueAt, snapshot.asOf) && <p className="mt-2 text-sm font-semibold text-amber-900">เลยกำหนด ณ เวลาโหลดข้อมูล — ไม่ใช่ผลคะแนน KPI</p>}</>
                        : <p className="mt-3 text-sm text-slate-500">ยังไม่มีแผนงานถัดไปที่เปิดอยู่</p>}
                    <p className="mt-3 text-xs text-slate-500">ข้อมูล ณ {displayBangkokTime(snapshot.asOf)} (UTC+07:00)</p>
                </section>
                <LeadOperations key={`${snapshot.actor.userId}:${readVersion}`} snapshot={snapshot} context={context}
                    lifecycleEnabled={lifecycleEnabled} disabled={loading} workApi={api} lifecycleApi={lifecycleApi}
                    onSaved={onSaved} onLockedChange={onLockedChange} onRefreshRequired={refresh} />
                <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
                    <h2 className="text-lg font-bold text-slate-900">ประวัติแผนงาน</h2>
                    <p className="mt-1 text-xs text-slate-500">แสดงล่าสุดไม่เกิน {snapshot.history.limit} รายการ ไม่ใช่ประวัติทั้งหมดหรือรายงาน KPI{snapshot.history.actionsHasMore ? ' · ยังมีรายการเก่ากว่านี้' : ''}</p>
                    <ol className="mt-4 divide-y divide-slate-100">{snapshot.actions.map(action => <li key={action.id} className="py-4 space-y-1 text-sm">
                        <p className="font-semibold text-slate-900">{action.action} <span className="font-normal text-slate-500">— {action.status === 'open' ? 'แผนปัจจุบัน' : action.status === 'cancelled' ? 'ปิดงานตามขอบเขต Lead (ไม่ใช่ทำสำเร็จ)' : 'มีแผนใหม่แทน (ไม่ใช่ทำสำเร็จ)'}</span></p>
                        <p className="text-slate-700">กำหนดเดิม: {displayBangkokTime(action.dueAt)}</p>
                        <p className="text-xs text-slate-500">ผู้รับผิดชอบแผนรุ่นนี้: {action.ownerUserId}</p>
                        <p className="text-xs text-slate-500">บันทึก: {displayBangkokTime(action.recordedAt)}{action.closedAt ? ` · เปลี่ยนแผน: ${displayBangkokTime(action.closedAt)}` : ''}</p>
                        {action.closeReason && <p className="text-slate-700">เหตุผลเปลี่ยนแผน: {action.closeReason}</p>}
                    </li>)}</ol>
                    {!snapshot.actions.length && <p className="mt-4 text-sm text-slate-500">ยังไม่มีประวัติแผนงาน</p>}
                </section>
                <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
                    <h2 className="text-lg font-bold text-slate-900">กิจกรรมล่าสุด</h2>
                    <p className="mt-1 text-xs text-slate-500">แสดงล่าสุดไม่เกิน {snapshot.history.limit} รายการ ไม่ใช่ประวัติทั้งหมดหรือรายงาน KPI{snapshot.history.activitiesHasMore ? ' · ยังมีรายการเก่ากว่านี้' : ''}</p>
                    <ol className="mt-4 divide-y divide-slate-100">{snapshot.activities.map(activity => <li key={activity.id} className="py-4 space-y-1 text-sm">
                        <p className="font-semibold text-slate-900">{activity.action ?? 'ไม่ทราบรายละเอียดกิจกรรม'}</p>
                        <p className="text-slate-700">{activity.channel ? channelLabels[activity.channel] : 'ไม่ทราบช่องทาง'} · {activity.result ? resultLabels[activity.result] : 'ไม่ทราบผล'}</p>
                        <p className="text-xs text-slate-500">เกิดจริง: {displayBangkokTime(activity.occurredAt)} · บันทึก: {displayBangkokTime(activity.recordedAt)}</p>
                        <p className="text-xs text-slate-500">ผู้ทำ: {activity.performedByUserId ?? 'ไม่ทราบ'} · ผู้บันทึก: {activity.recordedByUserId}</p>
                        {activity.note && <p className="text-slate-700">รายละเอียด: {activity.note}</p>}
                    </li>)}</ol>
                    {!snapshot.activities.length && <p className="mt-4 text-sm text-slate-500">ยังไม่มีหลักฐานกิจกรรม ไม่สรุปว่าไม่เคยติดต่อลูกค้า</p>}
                </section>
            </>}
        </div>
    </main>;
}
