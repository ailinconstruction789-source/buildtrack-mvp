'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { queueMonitorApi, QueueMonitorClientError, type QueueMonitorApi } from '@/lib/sales/queueMonitorClient';
import { parseQueueMonitorSnapshot, queueMonitorWarnings, type QueueDispatchRequest, type QueueMonitorSnapshot, type QueueMonitorWarning } from '@/lib/sales/queueMonitorContracts';

const warningLabels: Record<QueueMonitorWarning, string> = {
    WRITERS_DISABLED: 'มีตัวเปิดการประมวลผลที่ยังปิดอยู่ การอ่านหน้านี้จะไม่เปิดให้เอง',
    BURST_DISABLED: 'ยังไม่เปิดการประมวลผลแบบหลายรอบต่อเนื่อง จึงใช้ผลทดสอบแบบนั้นยืนยันความเร็วจริงไม่ได้',
    REVIEW_REQUIRED: 'คำขอนี้อยู่ในสถานะรอตรวจ ต้องรักษาหลักฐานเดิมและให้ผู้รับผิดชอบตรวจสาเหตุก่อนแก้ไข',
    RESERVATION_ELAPSED: 'ผ่านเวลารอของคำขอที่จองไว้แล้ว แต่ผลอาจยังอยู่ระหว่างทำหรือยังไม่ทราบ ห้ามสรุปว่าล้มเหลวหรือปลดล็อกเอง',
    RETRY_WAIT: 'คำขออยู่ในช่วงรอลองใหม่ตามหลักฐานเดิม หน้านี้ไม่สั่งลองใหม่หรือสร้างคำขอแทน',
    ATTEMPT_LIMIT: 'บันทึกความพยายามถึงขีดจำกัด 5 ครั้งแล้ว ต้องตรวจหลักฐาน ไม่เปลี่ยนหมายเลขเพื่อเริ่มนับใหม่',
    REQUEST_AGE_TARGET: 'อายุคำขอนี้ถึง 5 นาทีแล้ว เป็นเหตุให้ตรวจสอบ ไม่ใช่เวลาส่งแจ้งเตือนถึงหน้าจอและไม่ใช้ตัดคะแนน Sales',
    CANDIDATES_TRUNCATED: 'ถึงขีดจำกัดการนับที่แน่นอน แสดงเพียงค่าขั้นต่ำและตัวอย่าง 901 งาน ยังยืนยันยอดทั้งหมดไม่ได้',
    STORED_HELD: 'พบผลประเมินที่บันทึกไว้ว่าให้รอตรวจในกลุ่มตัวอย่าง ผลนี้อาจเก่าและยังไม่ได้คำนวณใหม่',
    MISSING_STORED_REVIEW: 'บางงานในกลุ่มตัวอย่างไม่มีผลประเมินเดิมที่อ่านได้ อาจยังไม่มีผลหรือรูปแบบไม่พร้อมอ่าน ไม่ได้แปลว่าแจ้งเตือนไม่ผ่านหรืองานล้มเหลว',
    LATENCY_UNMEASURED: 'ยังไม่ทราบเวลาแจ้งเตือนจากฐานข้อมูลถึงหน้าจอ และยังไม่ทราบอายุการตรวจครบชุด จึงยังยืนยันเป้า 5 นาทีไม่ได้',
};
const statusLabels: Record<QueueDispatchRequest['status'], string> = {
    reserved: 'จองคำขอแล้ว — อาจกำลังทำ / ยังไม่ทราบผล',
    retry_wait: 'รอลองใหม่ตามคำขอเดิม',
    review: 'หยุดรอตรวจหลักฐาน',
    completed: 'ยืนยันผลแล้ว 1 รอบ — ไม่ใช่งานทั้งหมดเสร็จ',
};
const errorLabels = {
    TRANSIENT_RETRY: 'ปัญหาชั่วคราว รอการตรวจและลองตามกลไกเดิม',
    RETRY_LIMIT: 'ถึงขีดจำกัดการลองใหม่',
    PROCESSING_REVIEW: 'ต้องตรวจหลักฐานการประมวลผล',
};
const timeLabel = (value: string) => new Date(value).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'medium' });
const safeError = (failure: unknown) => failure instanceof QueueMonitorClientError ? failure.message : 'อ่านข้อมูลตรวจคิวไม่ได้ กรุณาลองโหลดใหม่';
const identityFailure = (failure: unknown) => failure instanceof QueueMonitorClientError
    && ['ACTOR_CHANGED', 'ACTOR_CHANGED_AFTER_REQUEST', 'SESSION_UNAVAILABLE', 'UNAUTHENTICATED', 'FORBIDDEN'].includes(failure.code);
const setupFailure = (failure: unknown) => failure instanceof QueueMonitorClientError && ['FEATURE_DISABLED', 'SETUP_REQUIRED'].includes(failure.code);

export default function QueueMonitorView({ api = queueMonitorApi }: { api?: QueueMonitorApi }) {
    const [attempt, setAttempt] = useState(0);
    const [state, setState] = useState<{ attempt: number; api: QueueMonitorApi | null; data: QueueMonitorSnapshot | null; error: unknown }>({ attempt: -1, api: null, data: null, error: null });
    useEffect(() => {
        let cancelled = false;
        void Promise.resolve().then(() => api.read()).then(value => {
            const data = parseQueueMonitorSnapshot(value);
            if (!cancelled) setState({ attempt, api, data, error: null });
        }).catch(error => { if (!cancelled) setState({ attempt, api, data: null, error }); });
        return () => { cancelled = true; };
    }, [api, attempt]);
    // Switching API/session removes old Admin evidence before the new read settles.
    if (state.attempt !== attempt || state.api !== api) return <main className="p-8"><p role="status">กำลังตรวจสิทธิ์ Admin และอ่านสถานะคิว…</p></main>;
    if (!state.data) return <main className="mx-auto max-w-3xl space-y-4 p-8">
        <h1 className="text-2xl font-bold">{setupFailure(state.error) ? 'ยังไม่เปิดหน้าตรวจคิวแจ้งเตือน' : 'ยังอ่านสถานะคิวไม่ได้'}</h1>
        <p role="alert">{safeError(state.error)}</p>
        <p className="text-sm text-slate-600">ยังไม่มีผลตรวจล่าสุด ไม่ได้หมายความว่าคิวว่าง หน้านี้ไม่ประมวลผลหรือเปลี่ยนข้อมูล</p>
        <button type="button" onClick={() => setAttempt(value => value + 1)} className="text-blue-700 underline">ตรวจสิทธิ์อีกครั้ง</button>
        <Link href="/sales-crm" prefetch={false} className="block text-blue-700 underline">กลับ Lead ส่วนกลาง</Link>
    </main>;
    return <QueueMonitorSession key={`${state.data.actor.userId}:${attempt}`} initial={state.data} api={api} onRecheck={() => setAttempt(value => value + 1)} />;
}

function QueueMonitorSession({ initial, api, onRecheck }: { initial: QueueMonitorSnapshot; api: QueueMonitorApi; onRecheck: () => void }) {
    const [snapshot, setSnapshot] = useState<QueueMonitorSnapshot | null>(initial);
    const [busy, setBusy] = useState(false), [error, setError] = useState('');
    const [blocked, setBlocked] = useState<'identity' | 'setup' | null>(null);
    const alive = useRef(true), generation = useRef(0), busyRef = useRef(false), blockedRef = useRef(false);
    const actorId = initial.actor.userId;
    useEffect(() => { alive.current = true; return () => { alive.current = false; generation.current += 1; }; }, []);
    const invalidate = useCallback(() => {
        if (!alive.current) return;
        blockedRef.current = true; generation.current += 1; busyRef.current = false;
        setSnapshot(null); setBusy(false); setBlocked('identity');
        setError('บัญชีเปลี่ยนหรือยืนยันสิทธิ์ Admin ไม่ได้ กรุณาตรวจบัญชีใหม่');
    }, []);
    useEffect(() => api.watchActor?.(actorId, invalidate), [api, actorId, invalidate]);
    async function load() {
        if (!alive.current || busyRef.current || blockedRef.current) return;
        const request = ++generation.current;
        busyRef.current = true; setBusy(true); setSnapshot(null); setError('');
        try {
            const value = await api.read(actorId);
            if (!alive.current || request !== generation.current) return;
            if (value?.actor?.userId !== actorId || value?.actor?.role !== 'admin') { invalidate(); return; }
            setSnapshot(parseQueueMonitorSnapshot(value, actorId));
        } catch (failure) {
            if (!alive.current || request !== generation.current) return;
            setSnapshot(null);
            if (identityFailure(failure)) invalidate();
            else {
                if (setupFailure(failure)) { blockedRef.current = true; setBlocked('setup'); }
                setError(safeError(failure));
            }
        } finally { if (alive.current && request === generation.current) { busyRef.current = false; setBusy(false); } }
    }
    return <main className="min-h-screen bg-slate-50 px-4 py-6 sm:px-8 sm:py-10"><div className="mx-auto max-w-5xl space-y-5">
        <header className="space-y-3">
            <Link href="/sales-crm" prefetch={false} className="text-sm text-blue-700 hover:underline">← กลับ Lead ส่วนกลาง</Link>
            <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-bold text-slate-900">ตรวจคิวแจ้งเตือนติดต่อครั้งแรก</h1>
                <button type="button" disabled={busy || blocked !== null} onClick={() => { void load(); }} className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-blue-700 disabled:opacity-40">โหลดล่าสุด</button></div>
            <p className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950">สำหรับ Admin · อ่านอย่างเดียว · ไม่ส่งแจ้งเตือน ไม่ลองใหม่ ไม่ปลดล็อก ไม่เปลี่ยนงานหรือคะแนน KPI</p>
            <p className="text-sm text-slate-600">อ่านเมื่อเปิดหน้าและเมื่อกดโหลดล่าสุดเท่านั้น ไม่มีการตรวจหรือสั่งทำงานอัตโนมัติจากหน้านี้ · เวลาไทย</p>
        </header>
        {error && <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{error}</p>}
        {blocked && <button type="button" onClick={onRecheck} className="text-sm font-semibold text-blue-700 underline">{blocked === 'identity' ? 'ตรวจบัญชีใหม่' : 'ตรวจสิทธิ์อีกครั้ง'}</button>}
        {busy && <p role="status" className="text-sm text-slate-600">กำลังอ่านสถานะล่าสุด…</p>}
        {!snapshot && !busy && <p className="text-sm text-slate-600">ยังไม่มีผลตรวจล่าสุด ไม่ได้หมายความว่าคิวว่างหรือประมวลผลครบแล้ว</p>}
        {snapshot && <QueueEvidence snapshot={snapshot} />}
        <section aria-labelledby="queue-review-heading" className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
            <h2 id="queue-review-heading" className="font-semibold text-slate-900">แนวทางตรวจเมื่อคิวรอหรือผลยังไม่ชัดเจน</h2>
            <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-700">
                <li>เก็บเวลาที่ตรวจ หมายเลขคำขอและความพยายามเดิม พร้อมสถานะและผลรอบที่ยืนยันแล้วไว้เป็นหลักฐาน ห้ามรีเซ็ต ลบ หรือเปลี่ยนหมายเลขเพื่อข้ามการกันซ้ำ</li>
                <li>ให้ผู้รับผิดชอบที่ได้รับอนุญาตตรวจสาเหตุจากหลักฐานเดิม รวมถึงสิทธิ์ เวร และผลที่อาจบันทึกสำเร็จแล้ว ไม่ตีความผลที่ยังไม่ทราบว่าล้มเหลว</li>
                <li>วางวิธีแก้และวิธีย้อนกลับเพื่อขออนุมัติแยกต่างหาก หน้านี้ยังไม่มีเครื่องมือแก้คิวหรือสั่งประมวลผล</li>
            </ol>
            <div className="flex flex-wrap gap-4 text-sm font-semibold text-blue-700">
                <Link href="/sales-crm/sla-preview" prefetch={false} className="hover:underline">เปิดหน้าจำลองแผนจากหลักฐาน →</Link>
                <Link href="/sales-crm/work-schedule" prefetch={false} className="hover:underline">เปิดหน้าตารางเวร →</Link>
            </div>
            <p className="text-xs text-slate-500">ลิงก์เป็นเพียงการเปิดหน้า ไม่บันทึกเวรหรือสั่งงานจากหน้าตรวจคิว</p>
        </section>
    </div></main>;
}

function QueueEvidence({ snapshot }: { snapshot: QueueMonitorSnapshot }) {
    const request = snapshot.currentRequest;
    const gates: [keyof QueueMonitorSnapshot['gates'], string][] = [['processing', 'ประมวลผล'], ['cycle', 'ทำงานทีละรอบ'], ['worker', 'ตัวรับงาน'], ['dispatcher', 'ตัวจัดส่งคำขอ'], ['burst', 'หลายรอบต่อเนื่อง']];
    return <>
        <p className="text-xs text-slate-500">ข้อมูลจากเซิร์ฟเวอร์ ณ <time dateTime={snapshot.asOf}>{timeLabel(snapshot.asOf)}</time> · ไม่ใช่ข้อมูลสดต่อเนื่อง</p>
        <section aria-labelledby="queue-observations-heading" className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50 p-5">
            <h2 id="queue-observations-heading" className="font-semibold text-amber-950">สิ่งที่ต้องตรวจต่อ</h2>
            <ul className="list-disc space-y-2 pl-5 text-sm text-amber-950">{queueMonitorWarnings(snapshot).map(code => <li key={code} data-warning={code}>{warningLabels[code]}</li>)}</ul>
        </section>
        <section aria-labelledby="queue-workset-heading" className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
            <h2 id="queue-workset-heading" className="font-semibold text-slate-900">ชุดงานติดต่อครั้งแรกที่ยังเปิด</h2>
            <p className="text-sm text-slate-600">รวมงานที่อาจยังไม่ถึงเวลาแจ้งด้วย จึงไม่ใช่จำนวนแจ้งเตือนค้างส่งหรือจำนวนลูกค้าที่เกินกำหนด</p>
            <dl className="grid gap-4 text-sm sm:grid-cols-3">
                <div><dt className="text-slate-500">{snapshot.candidates.exact ? 'จำนวนงานที่นับได้ครบ ณ รอบอ่านนี้' : 'จำนวนงานขั้นต่ำ (ยังนับไม่ครบ)'}</dt><dd className="mt-1 text-xl font-semibold text-slate-900">{snapshot.candidates.exact ? '' : 'อย่างน้อย '}{snapshot.candidates.sampleCount} งาน</dd></div>
                <div><dt className="text-slate-500">ผลเดิมรอตรวจ ในตัวอย่าง {snapshot.candidates.sampleCount} งาน</dt><dd className="mt-1 text-xl font-semibold text-slate-900">{snapshot.candidates.storedHeldCount} งาน</dd></div>
                <div><dt className="text-slate-500">ไม่มีผลประเมินเดิมที่อ่านได้ ในตัวอย่างนี้</dt><dd className="mt-1 text-xl font-semibold text-slate-900">{snapshot.candidates.withoutStoredReviewCount} งาน</dd></div>
            </dl>
            <p className="text-xs text-slate-500">ผลประเมินที่บันทึกไว้อาจเป็นผลเก่า ไม่ได้ตรวจความถูกต้องหรือคำนวณใหม่จากการเปิดหน้านี้</p>
            {snapshot.candidates.sampleCount === 0 && <p className="text-sm text-slate-600">ไม่พบงานในขอบเขตที่อ่าน ไม่ได้หมายความว่างานฝ่ายขายทั้งหมดเสร็จแล้ว</p>}
        </section>
        <section aria-labelledby="queue-dispatch-heading" className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
            <h2 id="queue-dispatch-heading" className="font-semibold text-slate-900">สถานะคำขอของตัวจัดส่ง</h2>
            {!request ? <p className="text-sm text-slate-600">ยังไม่มีคำขอที่บันทึกไว้ในสถานะปัจจุบัน ไม่ได้ยืนยันว่าคิวว่างหรือระบบกำลังทำงาน</p> : <>
                <p className="rounded-xl bg-slate-100 p-3 text-sm font-semibold text-slate-800">{statusLabels[request.status]}</p>
                <dl className="grid gap-3 text-sm sm:grid-cols-2">
                    <div><dt className="text-xs text-slate-500">หมายเลขคำขอเดิม</dt><dd className="mt-1 break-all font-mono">{request.requestId}</dd></div>
                    <div><dt className="text-xs text-slate-500">หมายเลขความพยายามเดิม</dt><dd className="mt-1 break-all font-mono">{request.attemptId}</dd></div>
                    <div><dt className="text-xs text-slate-500">ความพยายามที่บันทึก</dt><dd className="mt-1">{request.attemptCount} / 5 ครั้ง</dd></div>
                    <div><dt className="text-xs text-slate-500">นโยบายของคำขอนี้</dt><dd className="mt-1 break-all">{request.policyVersion}</dd></div>
                    <div><dt className="text-xs text-slate-500">สร้างคำขอ</dt><dd className="mt-1">{timeLabel(request.createdAt)}</dd></div>
                    <div><dt className="text-xs text-slate-500">เตรียมความพยายามล่าสุด</dt><dd className="mt-1">{timeLabel(request.preparedAt)}</dd></div>
                    <div><dt className="text-xs text-slate-500">เวลารอที่บันทึกในคำขอ (nextAttemptAt)</dt><dd className="mt-1">{timeLabel(request.nextAttemptAt)}</dd></div>
                    <div><dt className="text-xs text-slate-500">ยืนยันจบรอบ</dt><dd className="mt-1">{request.completedAt ? timeLabel(request.completedAt) : 'ยังไม่ยืนยัน'}</dd></div>
                </dl>
                <p className="text-xs text-slate-600">nextAttemptAt ไม่ใช่ตารางรันครั้งถัดไป โดยเฉพาะคำขอที่จบแล้วในแบบหลายรอบต่อเนื่อง เวลานี้ไม่ยืนยันว่า Cron จะทำงานหรือแจ้งเตือนถึงหน้าจอแล้ว</p>
                {request.lastErrorCode && <p className="text-sm text-amber-900">เหตุผลที่บันทึก: {errorLabels[request.lastErrorCode]} ({request.lastErrorCode})</p>}
                {request.receipt && <div className="space-y-2 border-t border-slate-200 pt-4">
                    <h3 className="text-sm font-semibold text-slate-800">หลักฐานผลที่ยืนยันแล้วของรอบนี้เท่านั้น</h3>
                    <p className="text-sm text-slate-700">ตรวจ {request.receipt.processedCount} งาน · รอตรวจ {request.receipt.heldCount} งาน · ผลประเมินระบุแจ้ง {request.receipt.notifiedCount} งาน</p>
                    <p className="text-xs text-slate-500">ผลระบุแจ้งนับเฉพาะรอบนี้ที่บันทึกผลว่าสร้างแจ้งเตือน ไม่รวมรายการเดิม ไม่ใช่หลักฐานว่าผู้ใช้เห็นจริงหรือยอดสะสมทั้งคิว</p>
                    <p className="text-xs text-slate-600">เริ่ม {timeLabel(request.receipt.startedAt)} · จบ {timeLabel(request.receipt.finishedAt)}</p>
                    <p className="text-sm text-slate-700">การเดินชุดงานในรอบนั้น: {request.receipt.sweepFinished ? 'ถึงท้ายชุด ณ รอบนั้น' : 'ยังไม่ถึงท้ายชุด'} · ไม่ยืนยันสถานะงานที่เข้ามาภายหลัง</p>
                </div>}
            </>}
        </section>
        <section aria-labelledby="queue-config-heading" className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
            <h2 id="queue-config-heading" className="font-semibold text-slate-900">สวิตช์ในฐานข้อมูลและข้อจำกัดของหลักฐาน</h2>
            <ul className="grid gap-2 text-sm sm:grid-cols-2">{gates.map(([key, label]) => <li key={key}>{label}: <span className="font-semibold">{snapshot.gates[key] ? 'ค่าเปิด' : 'ค่าปิด'}</span></li>)}</ul>
            <p className="text-xs text-slate-500">เป็นสวิตช์ในฐานข้อมูล ณ รอบอ่าน ไม่ยืนยันว่าตัวตั้งเวลา Cron หรือตัวประมวลผลกำลังทำงานจริง</p>
            <dl className="grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-slate-500">เวลาแจ้งจากฐานข้อมูลถึงหน้าจอ</dt><dd className="mt-1 font-semibold">ไม่ทราบ — ยังไม่ได้วัดครบเส้นทาง</dd></div>
                <div><dt className="text-slate-500">อายุการตรวจครบชุดงาน</dt><dd className="mt-1 font-semibold">ไม่ทราบ — ตำแหน่งเดินชุดไม่บอกเวลาที่ตรวจครบ</dd></div></dl>
            <p className="text-xs text-slate-600">ตำแหน่งเดินชุดที่บันทึก: {snapshot.cursor.afterTaskId ? 'มีตำแหน่งค้างไว้' : 'ไม่มีตำแหน่งค้างไว้'} · ไม่ใช่ผลตรวจสด</p>
            <p className="text-sm text-slate-700">เป้าหมายไม่เกิน 5 นาทีต้องทดสอบครบเส้นทางแยกต่างหาก หน้านี้ไม่รับรองผลและไม่เปลี่ยน SLA ของ Sales</p>
        </section>
    </>;
}
