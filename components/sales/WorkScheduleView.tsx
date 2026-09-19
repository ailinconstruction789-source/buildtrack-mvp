'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { workScheduleApi, WorkScheduleApiError, type WorkScheduleApi } from '@/lib/sales/workScheduleClient';
import type { WorkScheduleResult, WorkScheduleSnapshot } from '@/lib/sales/workScheduleContracts';
import { readWorkSchedulePending } from '@/lib/sales/workSchedulePending';
import WorkScheduleForm from './WorkScheduleForm';

const subscribe = () => () => undefined;
const client = () => true;
const server = () => false;
const safeError = (failure: unknown) => failure instanceof WorkScheduleApiError ? failure.message : 'โหลดตารางเวรไม่ได้ กรุณาตรวจสอบอีกครั้ง';

export default function WorkScheduleView({ api = workScheduleApi }: { api?: WorkScheduleApi }) {
    const [attempt, setAttempt] = useState(0);
    const [state, setState] = useState<{ attempt: number; data: WorkScheduleSnapshot | null; error: string }>({ attempt: -1, data: null, error: '' });
    const hydrated = useSyncExternalStore(subscribe, client, server);
    useEffect(() => {
        let cancelled = false;
        void Promise.resolve().then(async () => {
            if (cancelled) return;
            const data = await api.read(null);
            if (cancelled) return;
            if (data.actor.role !== 'admin' || data.selectedSalesUserId !== null || data.calendar !== null) throw new Error('ข้อมูลเริ่มต้นไม่ตรงขอบเขต');
            if (!cancelled) setState({ attempt, data, error: '' });
        }).catch(failure => { if (!cancelled) setState({ attempt, data: null, error: safeError(failure) }); });
        return () => { cancelled = true; };
    }, [api, attempt]);
    if (!hydrated || state.attempt !== attempt) return <main className="p-8"><p role="status">กำลังตรวจสิทธิ์ Admin และข้อมูลเวร…</p></main>;
    if (!state.data) return <main className="mx-auto max-w-4xl space-y-4 p-8"><h1 className="text-2xl font-bold">ยังเปิดหน้าจัดเวรไม่ได้</h1>
        <p role="alert">{state.error}</p><p className="text-sm">ไม่มีการสร้างเวรหรือเปิดสิทธิ์ให้อัตโนมัติ คำขอค้างในแท็บยังไม่ถูกล้าง</p>
        <button type="button" onClick={() => setAttempt(value => value + 1)} className="text-blue-700 underline">ตรวจสิทธิ์อีกครั้ง</button>
        <Link href="/sales-crm" className="block text-blue-700 underline">กลับ Lead ส่วนกลาง</Link></main>;
    return <ScheduleSession key={`${state.data.actor.userId}:${attempt}`} initial={state.data} api={api} />;
}

function ScheduleSession({ initial, api }: { initial: WorkScheduleSnapshot; api: WorkScheduleApi }) {
    const actorId = initial.actor.userId;
    const [recovery] = useState(() => {
        try { return { pending: readWorkSchedulePending(actorId), error: '' }; }
        catch { return { pending: null, error: 'ตรวจคำขอตารางเวรค้างไม่ได้ กรุณาให้ Admin ตรวจสอบ ห้ามล้างข้อมูลแท็บหรือเริ่มคำขอใหม่' }; }
    });
    const [snapshot, setSnapshot] = useState<WorkScheduleSnapshot | null>(initial);
    const [selected, setSelected] = useState(recovery.pending?.salesUserId ?? '');
    const [search, setSearch] = useState('');
    const [readVersion, setReadVersion] = useState(0);
    const [error, setError] = useState(recovery.error), [notice, setNotice] = useState('');
    const [busy, setBusy] = useState(false), [locked, setLocked] = useState(!!recovery.pending || !!recovery.error);
    const [storageBlocked, setStorageBlocked] = useState(!!recovery.error);
    const lockRef = useRef(locked), busyRef = useRef(false), alive = useRef(true), generation = useRef(0);
    const childLocked = useCallback((value: boolean) => { lockRef.current = value; setLocked(value); }, []);
    useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
    const candidates = snapshot?.sales ?? initial.sales;
    const filtered = candidates.filter(person => `${person.displayName ?? ''} ${person.userId}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()) || person.userId === selected);

    function assertNoPending() {
        if (readWorkSchedulePending(actorId)) throw new Error('มีคำขอเดิมค้าง กรุณาโหลดแท็บเดิมเพื่อตรวจรหัสก่อน ห้ามเปลี่ยน Sales หรือส่งรายการใหม่');
    }
    async function load(target: string | null) {
        if (busyRef.current || storageBlocked) return;
        try { assertNoPending(); }
        catch { setStorageBlocked(true); childLocked(true); setError('ตรวจพบคำขอเดิมหรือข้อมูลคิวผิดปกติ ห้ามเริ่มใหม่ กรุณาโหลดแท็บเดิมและให้ Admin ตรวจรหัสคำขอ'); return; }
        const request = ++generation.current;
        busyRef.current = true; setBusy(true); childLocked(true); setError(''); setSnapshot(null);
        try {
            const next = await api.read(target);
            if (!alive.current || request !== generation.current) return;
            if (next.actor.userId !== actorId || next.actor.role !== 'admin' || next.selectedSalesUserId !== target) {
                throw new Error('บัญชีหรือขอบเขตเวรเปลี่ยนไป กรุณาเปิดหน้าใหม่เพื่อตรวจสิทธิ์');
            }
            setSnapshot(next); setReadVersion(value => value + 1); childLocked(false);
        } catch (failure) {
            if (!alive.current || request !== generation.current) return;
            setError(safeError(failure)); childLocked(false);
        } finally { if (alive.current && request === generation.current) { busyRef.current = false; setBusy(false); } }
    }
    function select(target: string) {
        if (lockRef.current || busyRef.current || storageBlocked || target === selected) return;
        if (target && !candidates.some(person => person.userId === target)) return;
        setSelected(target); setNotice(''); void load(target || null);
    }
    async function saved(result: WorkScheduleResult) {
        setNotice('บันทึกตารางเวรสำเร็จแล้ว ไม่ต้องส่งซ้ำ แม้โหลดเวรล่าสุดไม่ได้');
        setSelected(result.salesUserId);
        await load(result.salesUserId);
    }
    const frozen = locked || busy || storageBlocked;
    return <main className="min-h-screen bg-slate-50 px-4 py-6 sm:px-8 sm:py-10"><div className="mx-auto max-w-5xl space-y-5">
        <header className="space-y-3">{frozen ? <span aria-disabled="true" className="text-sm text-slate-400">← กลับ Lead ส่วนกลาง (กำลังตรวจคำขอ)</span>
            : <Link href="/sales-crm" className="text-sm text-blue-700 hover:underline">← กลับ Lead ส่วนกลาง</Link>}
            <h1 className="text-2xl font-bold text-slate-900">จัดเวรฝ่ายขาย</h1>
            <p className="text-sm text-slate-600">Admin จัดช่วงทำงาน พัก และลาที่อนุมัติแล้ว · ไม่ใช่การลงเวลาเข้างานหรือคะแนน Attendance</p></header>
        {notice && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">{notice}</p>}
        {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</p>}
        <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
            <label className="block text-sm">ค้นหา Sales ในรายชื่อที่โหลด<input disabled={frozen} value={search} onChange={event => setSearch(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 disabled:bg-slate-100" placeholder="ชื่อ Sales…" /></label>
            <label className="block text-sm">Sales ที่ต้องการจัดเวร<select disabled={frozen} value={selected} onChange={event => select(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 disabled:bg-slate-100">
                <option value="">เลือก Sales</option>{filtered.map(person => <option key={person.userId} value={person.userId}>{person.displayName ?? person.userId}</option>)}
                {selected && !filtered.some(person => person.userId === selected) && <option value={selected}>Sales ตามคำขอเดิม: {selected}</option>}
            </select></label>
            {(snapshot?.salesHasMore ?? initial.salesHasMore) && <p className="text-sm text-amber-900">แสดงรายชื่อไม่เกิน 200 คน การค้นหานี้ค้นเฉพาะที่โหลด หากไม่พบให้ตรวจรายชื่อก่อน</p>}
            <p className="text-xs text-slate-500">เฉพาะ Admin เท่านั้นที่อ่านหรือแก้ข้อมูลเวรผ่านหน้านี้ได้ ไม่มีข้อมูลสุขภาพหรือเหตุผลลารายบุคคลให้ Sales คนอื่นดู</p>
        </section>
        {busy && <p role="status" className="text-sm text-slate-600">กำลังโหลดเวรล่าสุด…</p>}
        {!storageBlocked && snapshot && (snapshot.selectedSalesUserId || (recovery.pending && readVersion === 0)) && <WorkScheduleForm key={`${readVersion}:${snapshot.selectedSalesUserId ?? 'pending'}`}
            snapshot={snapshot} disabled={busy} save={input => api.save(input, actorId)} onSaved={saved}
            onLockedChange={childLocked} onRefreshRequired={() => load(selected || null)} />}
        {!busy && !snapshot && !storageBlocked && <button type="button" onClick={() => { void load(selected || null); }} className="text-sm font-semibold text-blue-700 underline">โหลดเวรล่าสุดอีกครั้ง</button>}
        {!selected && !recovery.pending && !storageBlocked && <p className="text-sm text-slate-500">เลือก Sales เพื่อดูหรือจัดเวร ยังไม่มีการสร้างตารางจากการเปิดหน้า</p>}
        <p className="text-xs text-slate-500">ข้อมูลเวรเป็นแหล่งคำนวณที่ต้องเชื่อมและตรวจนโยบายก่อนส่งแจ้งเตือนจริง ไม่เปลี่ยนกำหนดบริการหรือคะแนนย้อนหลังจากการบันทึกนี้</p>
    </div></main>;
}
