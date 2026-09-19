'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { slaPreviewApi, SlaPreviewClientError, type SlaPreviewApi } from '@/lib/sales/slaPreviewClient';
import type { SlaPreviewReason, SlaPreviewRule, SlaPreviewSnapshot } from '@/lib/sales/slaPreviewTypes';

const reasons: Record<SlaPreviewReason, string> = {
    SCOPE_CLOSED: 'Lead ปิดหรือถูกรวมแล้ว ต้องตรวจงานค้าง', LEGACY_REVIEW: 'ข้อมูลเก่า ต้องตรวจหลักฐานก่อน',
    OWNER_NOT_READY: 'ผู้ดูแลไม่ตรงหรือไม่ใช่ Sales ที่เปิดใช้งาน', OWNER_REVIEW: 'เปลี่ยนผู้ดูแลหรือประวัติไม่ชัดเจน ต้องให้ Admin ตรวจ',
    MISSING_CREATION_EVIDENCE: 'หลักฐานเริ่ม Lead ยังไม่ครบ', CONTACT_REVIEW: 'พบหลักฐานติดต่อหรือข้อมูลจบงาน ต้องตรวจงานเดิม',
    CUSTOMER_POSTPONEMENT: 'ลูกค้าขอติดต่อภายหลัง ต้องตรวจข้อยกเว้น', EXCEPTION_REVIEW: 'มีข้อยกเว้นที่ต้องตรวจ',
    POLICY_REVIEW: 'ค่าหรือนโยบายเดิมไม่ตรงกับรุ่นที่ตรวจรับ', SOURCE_TIME_REVIEW: 'วันเริ่มหรือกำหนดบริการไม่ตรงหลักฐาน',
    MISSING_CALENDAR: 'ยังไม่มีเวรที่มีรุ่นสำหรับ Sales นี้', INVALID_CALENDAR: 'ข้อมูลเวรไม่ถูกต้องหรือไม่ตรงผู้ดูแล',
    INSUFFICIENT_COVERAGE: 'เวรยังไม่ครอบคลุมช่วงที่ต้องคำนวณ', STAFF_CALCULATION_REVIEW: 'ต้องตรวจเงื่อนไขคำนวณกำหนด Sales',
    DUE_SOON: 'เข้าเงื่อนไขเตือนก่อนกำหนด (ยังไม่ส่ง)', OVERDUE: 'เข้าเงื่อนไขแจ้งเกินกำหนด (ยังไม่ส่ง)',
    NOT_DUE_YET: 'ยังไม่ถึงเวลาแจ้ง', OUTSIDE_WORKING_HOURS: 'ขณะนี้อยู่นอกช่วงทำงานจริง จึงยังไม่แจ้ง',
    REMINDER_REVIEW: 'เงื่อนไขแจ้งเตือนยังไม่ครบ',
};
const ruleLabels: Record<SlaPreviewRule, string> = {
    out_of_hours: 'Lead เข้านอกเวร → 2 ชั่วโมงทำงานจากช่วงถัดไป',
    service_deadline: 'Lead เข้าในเวร → กำหนดบริการ 24 ชั่วโมงอยู่ในช่วงทำงาน',
    off_shift_service_deadline: 'Lead เข้าในเวร แต่กำหนดตกนอกเวร → 2 ชั่วโมงทำงานจากช่วงถัดไป',
};
const timeLabel = (value: string) => new Date(value).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' });
const safeError = (error: unknown) => error instanceof SlaPreviewClientError ? error.message : 'ตรวจแผนไม่ได้ กรุณาโหลดข้อมูลใหม่';

export default function SlaPreviewView({ api = slaPreviewApi }: { api?: SlaPreviewApi }) {
    const [attempt, setAttempt] = useState(0);
    const [state, setState] = useState<{ attempt: number; data: SlaPreviewSnapshot | null; error: unknown }>({ attempt: -1, data: null, error: null });
    useEffect(() => {
        let cancelled = false;
        void Promise.resolve().then(() => api.read(0)).then(data => {
            if (data.actor.role !== 'admin' || data.page !== 0 || data.mode !== 'dry_run') throw new Error('รูปแบบไม่ตรงขอบเขต');
            if (!cancelled) setState({ attempt, data, error: null });
        }).catch(error => { if (!cancelled) setState({ attempt, data: null, error }); });
        return () => { cancelled = true; };
    }, [api, attempt]);
    if (state.attempt !== attempt) return <main className="p-8"><p role="status">กำลังตรวจสิทธิ์ Admin และจำลองแผนจากหลักฐาน…</p></main>;
    if (!state.data) return <main className="mx-auto max-w-3xl space-y-4 p-8"><h1 className="text-2xl font-bold">ยังตรวจแผนแจ้งเตือนไม่ได้</h1>
        <p role="alert">{safeError(state.error)}</p><p className="text-sm text-slate-600">หน้านี้ไม่สร้างเวร งาน หรือแจ้งเตือนเมื่อระบบยังไม่พร้อม</p>
        <button type="button" onClick={() => setAttempt(value => value + 1)} className="text-blue-700 underline">ตรวจสิทธิ์อีกครั้ง</button>
        <Link href="/sales-crm" className="block text-blue-700 underline">กลับ Lead ส่วนกลาง</Link></main>;
    return <PreviewSession key={`${state.data.actor.userId}:${attempt}`} initial={state.data} api={api} onRecheck={() => setAttempt(value => value + 1)} />;
}

function PreviewSession({ initial, api, onRecheck }: { initial: SlaPreviewSnapshot; api: SlaPreviewApi; onRecheck: () => void }) {
    const [snapshot, setSnapshot] = useState<SlaPreviewSnapshot | null>(initial);
    const [page, setPage] = useState(initial.page), [busy, setBusy] = useState(false), [error, setError] = useState('');
    const [identityChanged, setIdentityChanged] = useState(false);
    const alive = useRef(true), generation = useRef(0), busyRef = useRef(false), identityInvalid = useRef(false);
    const actorId = initial.actor.userId;
    useEffect(() => { alive.current = true; return () => { alive.current = false; generation.current += 1; }; }, []);
    const invalidate = useCallback(() => {
        if (!alive.current) return;
        identityInvalid.current = true; generation.current += 1; busyRef.current = false;
        setSnapshot(null); setBusy(false); setIdentityChanged(true); setError('บัญชีเปลี่ยนหรือยืนยันบัญชีไม่ได้ กรุณาตรวจบัญชีใหม่');
    }, []);
    useEffect(() => api.watchActor?.(actorId, invalidate), [api, actorId, invalidate]);
    async function load(target: number) {
        if (busyRef.current || identityInvalid.current || target < 0 || target > 1000) return;
        const request = ++generation.current;
        busyRef.current = true; setBusy(true); setSnapshot(null); setError(''); setPage(target);
        try {
            const next = await api.read(target);
            if (!alive.current || request !== generation.current) return;
            if (next.actor.userId !== actorId || next.actor.role !== 'admin') { invalidate(); return; }
            if (next.page !== target || next.mode !== 'dry_run') throw new Error('ขอบเขตเปลี่ยน');
            setSnapshot(next);
        } catch (failure) {
            if (!alive.current || request !== generation.current) return;
            if (failure instanceof SlaPreviewClientError && ['ACTOR_CHANGED', 'ACTOR_CHANGED_AFTER_REQUEST', 'SESSION_UNAVAILABLE'].includes(failure.code)) invalidate();
            else setError(safeError(failure));
        } finally { if (alive.current && request === generation.current) { busyRef.current = false; setBusy(false); } }
    }
    const frozen = busy || identityChanged;
    return <main className="min-h-screen bg-slate-50 px-4 py-6 sm:px-8 sm:py-10"><div className="mx-auto max-w-5xl space-y-5">
        <header className="space-y-3"><Link href="/sales-crm" className="text-sm text-blue-700 hover:underline">← กลับ Lead ส่วนกลาง</Link>
            <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-bold text-slate-900">ตรวจแผนแจ้งเตือนติดต่อครั้งแรก</h1>
                <button type="button" disabled={frozen} onClick={() => { void load(0); }} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-blue-700 disabled:opacity-40">คำนวณล่าสุด</button></div>
            <p className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950">โหมดจำลองสำหรับ Admin · ไม่บันทึกกำหนด ไม่ส่งแจ้งเตือน ไม่ปิดงาน และไม่คิดคะแนน KPI</p>
            <p className="text-sm text-slate-600">เฉพาะงานติดต่อครั้งแรกที่ยังเปิดใน Lead ส่วนกลาง · เตือนก่อนกำหนด 30 นาที · เวลาไทย</p>
            <p className="text-xs text-slate-500">ยังไม่รวม Follow-up / Hot หลัง Visit ผลพร้อมในหน้านี้ยังต้องตรวจข้อมูลล่าสุดและกันซ้ำอีกครั้งก่อนส่งจริง</p>
        </header>
        {error && <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{error}</p>}
        {identityChanged && <button type="button" onClick={onRecheck} className="text-sm font-semibold text-blue-700 underline">ตรวจบัญชีใหม่</button>}
        {busy && <p role="status" className="text-sm text-slate-600">กำลังอ่านหลักฐานและคำนวณใหม่…</p>}
        {snapshot && <>
            <div className="flex flex-wrap gap-3 text-sm text-slate-700"><span>ในหน้านี้: เข้าเงื่อนไขแจ้ง {snapshot.rows.filter(row => row.state === 'would_notify').length}</span>
                <span>ยังไม่ถึงเวลา/นอกเวร {snapshot.rows.filter(row => row.state === 'scheduled').length}</span>
                <span>รอตรวจหลักฐาน {snapshot.rows.filter(row => row.state === 'held').length}</span></div>
            <p className="text-xs text-slate-500">ข้อมูล ณ {timeLabel(snapshot.asOf)} · นโยบาย {snapshot.policyVersion}</p>
            {!snapshot.rows.length && <section className="rounded-2xl border border-slate-200 bg-white p-8 text-center"><h2 className="font-semibold">ไม่พบงานติดต่อครั้งแรกที่เปิดในหน้านี้</h2>
                <p className="mt-2 text-sm text-slate-500">ไม่ได้หมายความว่างานฝ่ายขายทั้งหมดเสร็จแล้ว</p></section>}
            {snapshot.rows.map(row => <article key={row.taskId} aria-label={`แผนของ ${row.customerName}`} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
                <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold text-slate-900">{row.customerName}</h2>
                    <p className="mt-1 text-sm text-slate-500">ผู้ดูแล: {row.ownerName ?? row.ownerUserId ?? 'ยังไม่พร้อม'}</p></div>
                    <span className={`rounded-lg px-3 py-1 text-xs font-semibold ${row.state === 'held' ? 'bg-amber-50 text-amber-900' : row.state === 'would_notify' ? 'bg-blue-50 text-blue-800' : 'bg-slate-100 text-slate-700'}`}>
                        {row.state === 'held' ? 'รอตรวจ ไม่ส่ง' : row.state === 'would_notify' ? 'เข้าเงื่อนไข (จำลอง)' : 'ยังไม่แจ้ง'}</span></div>
                <p className="text-sm text-slate-700">{reasons[row.reason]}</p>
                <dl className="grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-xs text-slate-500">กำหนดบริการที่บันทึกไว้ (ไม่เปลี่ยน)</dt><dd className="mt-1">{timeLabel(row.serviceDueAt)}</dd></div>
                    <div><dt className="text-xs text-slate-500">กำหนด Sales ที่คำนวณในรอบนี้</dt><dd className="mt-1">{row.staffDueAt ? timeLabel(row.staffDueAt) : 'ยังไม่คำนวณ'}</dd></div></dl>
                {row.rule && <p className="text-xs text-slate-600">{ruleLabels[row.rule]}</p>}
                {row.calendarVersion && <p className="break-all text-xs text-slate-500">รุ่นเวร: {row.calendarVersion}</p>}
                <Link href={`/sales-crm/${encodeURIComponent(row.customerId)}`} prefetch={false} className="inline-block text-sm font-semibold text-blue-700 hover:underline">ดูหลักฐานและงานส่วนกลาง →</Link>
            </article>)}
        </>}
        <nav aria-label="หน้าแผนแจ้งเตือน" className="flex items-center justify-between gap-3 border-t border-slate-200 pt-4 text-sm">
            <button type="button" disabled={frozen || page === 0} onClick={() => { void load(page - 1); }} className="text-blue-700 disabled:opacity-30">← ก่อนหน้า</button>
            <span className="text-slate-500">หน้า {page + 1} · หน้าละ 20 งาน</span>
            <button type="button" disabled={frozen || !snapshot?.hasMore || page >= 1000} onClick={() => { void load(page + 1); }} className="text-blue-700 disabled:opacity-30">ถัดไป →</button>
        </nav>
        {page === 1000 && snapshot?.hasMore && <p className="text-sm text-amber-900">ถึงขีดจำกัดการเปิดหน้า ยังมีงานที่ไม่ได้แสดง กรุณาตรวจขอบเขตเพิ่มเติม</p>}
        <Link href="/sales-crm/work-schedule" prefetch={false} className="inline-block text-sm font-semibold text-blue-700 hover:underline">ตรวจหรือจัดเวรฝ่ายขาย (Admin) →</Link>
    </div></main>;
}
