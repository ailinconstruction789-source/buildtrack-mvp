'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { slaReceiptApi, SlaReceiptClientError, type SlaReceiptApi } from '@/lib/sales/slaReceiptClient';
import type { SlaReceiptContext } from '@/lib/sales/slaReceiptContracts';
import { slaPreviewApi, SlaPreviewClientError, type SlaPreviewApi } from '@/lib/sales/slaPreviewClient';
import { parseSlaPreviewSnapshot } from '@/lib/sales/slaPreviewContracts';
import type { SlaPreviewRow, SlaPreviewSnapshot } from '@/lib/sales/slaPreviewTypes';
import { slaProcessingApi, SlaProcessingClientError, type SlaProcessingApi } from '@/lib/sales/slaProcessingClient';
import { parseSlaProcessingInput, parseSlaProcessingResult, type SlaProcessingInput, type SlaProcessingResult } from '@/lib/sales/slaProcessingContracts';
import { processPendingFirstContact, readSlaProcessingPending, settleSlaProcessingPendingReceipt, SlaProcessingPendingError } from '@/lib/sales/slaProcessingPending';
import { isCentralUuid } from '@/lib/sales/centralContracts';
import SlaProcessingReceipt, { processingReasons, processingTime } from './SlaProcessingReceipt';

interface Props { receiptApi?: SlaReceiptApi; previewApi?: SlaPreviewApi; processingApi?: SlaProcessingApi; newRequestId?: () => string }
type Queue = { input: SlaProcessingInput | null; error: string };
type Selection = { kind: 'new'; row: SlaPreviewRow } | { kind: 'retry'; input: SlaProcessingInput };
const createId = () => crypto.randomUUID();
const equal = (a: SlaProcessingInput, b: SlaProcessingInput) => a.requestId === b.requestId && a.taskId === b.taskId;
const button = 'rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-blue-700 disabled:opacity-40';
function safeError(error: unknown): string {
    if (error instanceof SlaReceiptClientError || error instanceof SlaPreviewClientError || error instanceof SlaProcessingClientError || error instanceof SlaProcessingPendingError) return error.message;
    return 'ตรวจยืนยันผลไม่ได้ กรุณาตรวจใบรับและรหัสคำขอเดิมก่อน ห้ามสร้างรหัสใหม่ข้ามคำขอค้าง';
}
function validContext(value: SlaReceiptContext, actorId?: string) {
    if (!value?.actor || value.actor.role !== 'admin' || !isCentralUuid(value.actor.userId) || value.actor.userId.length !== 36
        || typeof value.processingEnabled !== 'boolean' || (actorId && value.actor.userId !== actorId)) throw new Error('Invalid Admin context');
    return value;
}
function currentQueue(actorId: string): Queue {
    try { return { input: readSlaProcessingPending(actorId), error: '' }; }
    catch (error) { return { input: null, error: safeError(error) }; }
}

/** Mount/refresh only READ. All processing is behind a separate explicit review
 * and checkbox; no polling, timers, bulk action or automatic pending retries. */
export default function SlaProcessingView({ receiptApi = slaReceiptApi, previewApi = slaPreviewApi,
    processingApi = slaProcessingApi, newRequestId = createId }: Props) {
    const [attempt, setAttempt] = useState(0);
    const [state, setState] = useState<{ attempt: number; context: SlaReceiptContext | null; error: string }>({ attempt: -1, context: null, error: '' });
    useEffect(() => {
        let cancelled = false;
        void Promise.resolve().then(() => receiptApi.context()).then(value => {
            const context = validContext(value);
            if (!cancelled) setState({ attempt, context, error: '' });
        }).catch(error => { if (!cancelled) setState({ attempt, context: null, error: safeError(error) }); });
        return () => { cancelled = true; };
    }, [receiptApi, attempt]);
    if (state.attempt !== attempt) return <main className="p-8"><p role="status">กำลังตรวจสิทธิ์ Admin สำหรับใบรับและการประมวลผล…</p></main>;
    if (!state.context) return <main className="mx-auto max-w-3xl space-y-4 p-8"><h1 className="text-2xl font-bold">ยังเปิดหน้าประมวลผลไม่ได้</h1>
        <p role="alert">{state.error}</p><p className="text-sm text-slate-600">ไม่มีการส่งคำสั่งหรืออ่านคำขอค้างของบัญชีอื่น</p>
        <button type="button" className={button} onClick={() => setAttempt(value => value + 1)}>ตรวจบัญชีใหม่</button>
        <Link href="/sales-crm" className="block text-sm text-blue-700 underline">กลับ Lead ส่วนกลาง</Link></main>;
    return <ProcessingSession key={`${state.context.actor.userId}:${attempt}`} initial={state.context} receiptApi={receiptApi}
        previewApi={previewApi} processingApi={processingApi} newRequestId={newRequestId} onRecheck={() => setAttempt(value => value + 1)} />;
}

function ProcessingSession({ initial, receiptApi, previewApi, processingApi, newRequestId, onRecheck }:
    Required<Props> & { initial: SlaReceiptContext; onRecheck: () => void }) {
    const actorId = initial.actor.userId;
    const [context, setContext] = useState(initial);
    const [queue, setQueue] = useState<Queue>(() => currentQueue(actorId));
    const [snapshot, setSnapshot] = useState<SlaPreviewSnapshot | null>(null), [page, setPage] = useState(0);
    const [selection, setSelection] = useState<Selection | null>(null), [acknowledged, setAcknowledged] = useState(false);
    const [receipt, setReceipt] = useState<{ value: SlaProcessingResult; source: 'lookup' | 'command' } | null>(null);
    const [requestId, setRequestId] = useState(''), [taskId, setTaskId] = useState('');
    const [operation, setOperation] = useState<'load' | 'lookup' | 'process' | null>(null);
    const [error, setError] = useState(''), [notice, setNotice] = useState(''), [invalid, setInvalid] = useState(false);
    const alive = useRef(true), identityInvalid = useRef(false), busy = useRef(false), generation = useRef(0);
    useEffect(() => {
        const requestGeneration = generation;
        alive.current = true;
        return () => { alive.current = false; busy.current = false; requestGeneration.current++; };
    }, []);
    const invalidate = useCallback(() => {
        if (!alive.current) return;
        identityInvalid.current = true; generation.current++; busy.current = false;
        setInvalid(true); setSnapshot(null); setSelection(null); setReceipt(null); setRequestId(''); setTaskId(''); setQueue({ input: null, error: '' });
        setOperation(null); setAcknowledged(false); setNotice(''); setError('บัญชีเปลี่ยนหรือสิทธิ์ไม่พร้อม กรุณาตรวจบัญชีใหม่ คำขอเดิมยังไม่ถูกล้าง');
    }, []);
    useEffect(() => {
        try { return (receiptApi.watchActor ?? processingApi.watchActor)?.(actorId, invalidate); }
        catch { invalidate(); }
    }, [receiptApi, processingApi, actorId, invalidate]);
    const begin = useCallback((kind: 'load' | 'lookup' | 'process') => {
        if (!alive.current || identityInvalid.current || busy.current) return null;
        busy.current = true; const request = ++generation.current; setOperation(kind); setError(''); setNotice(''); return request;
    }, []);
    const active = useCallback((request: number) => alive.current && !identityInvalid.current && generation.current === request, []);
    const finish = useCallback((request: number) => { if (active(request)) { busy.current = false; setOperation(null); } }, [active]);
    const failure = useCallback((value: unknown) => {
        if ((value instanceof SlaReceiptClientError || value instanceof SlaPreviewClientError || value instanceof SlaProcessingClientError)
            && ['ACTOR_CHANGED', 'ACTOR_CHANGED_AFTER_REQUEST', 'SESSION_UNAVAILABLE', 'UNAUTHENTICATED', 'FORBIDDEN'].includes(value.code)) invalidate();
        else setError(safeError(value));
    }, [invalidate]);
    const refresh = useCallback(async (target: number) => {
        if (target < 0 || target > 1000) return;
        const request = begin('load'); if (request === null) return;
        setSnapshot(null); setPage(target); setSelection(null); setAcknowledged(false);
        try {
            const latest = await receiptApi.context(); if (!active(request)) return;
            if (latest.actor.userId !== actorId || latest.actor.role !== 'admin') { invalidate(); return; }
            setContext(validContext(latest, actorId)); setQueue(currentQueue(actorId));
            const rows = await previewApi.read(target); if (!active(request)) return;
            if (rows.actor.userId !== actorId || rows.actor.role !== 'admin') { invalidate(); return; }
            setSnapshot(parseSlaPreviewSnapshot(rows, target, actorId));
        } catch (value) { if (active(request)) failure(value); }
        finally { finish(request); }
    }, [receiptApi, previewApi, actorId, active, begin, finish, invalidate, failure]);
    useEffect(() => {
        let cancelled = false;
        void Promise.resolve().then(() => { if (!cancelled) void refresh(0); });
        return () => { cancelled = true; };
    }, [refresh]);

    async function lookup(input: SlaProcessingInput) {
        const request = begin('lookup'); if (request === null) return;
        setReceipt(null); setSelection(null); setAcknowledged(false);
        try {
            const command = parseSlaProcessingInput(input);
            const found = await receiptApi.lookup(command, actorId); if (!active(request)) return;
            if (found.actor.userId !== actorId || found.actor.role !== 'admin') { invalidate(); return; }
            if (found.requestId !== command.requestId || found.taskId !== command.taskId || typeof found.found !== 'boolean') throw new Error('Unbound receipt');
            if (!found.found) {
                if (found.receipt !== null) throw new Error('Invalid absent receipt');
                setNotice('ยังไม่พบใบรับที่ตรงคำขอ อาจยังประมวลผลอยู่หรืออ่านไม่ทัน จึงไม่ยืนยันว่าคำขอเดิมไม่สำเร็จ และจะไม่ล้างคำขอค้าง');
            } else {
                const confirmed = parseSlaProcessingResult(found.receipt, command, actorId);
                setReceipt({ value: confirmed, source: 'lookup' });
                const pending = currentQueue(actorId);
                if (pending.input && equal(pending.input, command)) {
                    const settled = settleSlaProcessingPendingReceipt(actorId, command, confirmed);
                    if (!settled.pendingCleared) setNotice('พบใบรับแล้ว แต่ล้างคำขอในแท็บไม่ได้ ยังไม่อนุญาตให้เริ่มรหัสใหม่');
                }
            }
            setQueue(currentQueue(actorId));
        } catch (value) { if (active(request)) { failure(value); setQueue(currentQueue(actorId)); } }
        finally { finish(request); }
    }
    async function confirm() {
        if (!selection || !acknowledged || !context.processingEnabled || queue.error) return;
        const request = begin('process'); if (request === null) return;
        const selected = selection; setReceipt(null);
        try {
            const latest = await receiptApi.context(); if (!active(request)) return;
            if (latest.actor.userId !== actorId || latest.actor.role !== 'admin') { invalidate(); return; }
            setContext(validContext(latest, actorId));
            if (!latest.processingEnabled) { setSelection(null); setAcknowledged(false); setNotice('การประมวลผลถูกปิด ยังตรวจใบรับเดิมได้ ไม่มีการส่งคำสั่ง'); return; }
            const pending = currentQueue(actorId); setQueue(pending);
            if (pending.error || (selected.kind === 'new' && pending.input)
                || (selected.kind === 'retry' && (!pending.input || !equal(pending.input, selected.input)))) throw new SlaProcessingPendingError();
            const command = selected.kind === 'retry' ? selected.input : parseSlaProcessingInput({ requestId: newRequestId(), taskId: selected.row.taskId });
            // The existing queue writes and reads back BEFORE process() is called.
            const sent = processPendingFirstContact(actorId, command, processingApi);
            setQueue(currentQueue(actorId)); setSelection(null); setAcknowledged(false); setSnapshot(null);
            const result = await sent; if (!active(request)) return;
            setReceipt({ value: result.receipt, source: 'command' }); setQueue(currentQueue(actorId));
            setNotice(result.pendingCleared ? 'ได้รับใบรับแล้ว กดโหลดงานล่าสุดเมื่อต้องการทำรายการต่อ ไม่มีการส่งต่ออัตโนมัติ'
                : 'ได้รับใบรับแล้ว แต่ล้างคำขอในแท็บไม่ได้ ยังไม่อนุญาตให้เริ่มรหัสใหม่');
        } catch (value) { if (active(request)) { failure(value); setQueue(currentQueue(actorId)); } }
        finally { finish(request); }
    }
    function choose(value: Selection) {
        if (busy.current || identityInvalid.current || !context.processingEnabled) return;
        const pending = currentQueue(actorId); setQueue(pending);
        if (pending.error || (value.kind === 'new' && pending.input) || (value.kind === 'retry' && (!pending.input || !equal(pending.input, value.input)))) return;
        setSelection(value); setAcknowledged(false); setError(''); setNotice('');
    }
    if (invalid) return <main className="mx-auto max-w-3xl space-y-4 p-8"><h1 className="text-2xl font-bold">ต้องตรวจบัญชีใหม่</h1>
        <p role="alert">{error}</p><button type="button" onClick={onRecheck} className={button}>ตรวจบัญชีใหม่</button></main>;
    const frozen = operation !== null;
    const newBlocked = frozen || !!queue.input || !!queue.error || !context.processingEnabled;
    return <main className="min-h-screen bg-slate-50 px-4 py-6 sm:px-8 sm:py-10"><div className="mx-auto max-w-5xl space-y-5">
        <header className="space-y-3"><Link href="/sales-crm" className="text-sm text-blue-700 underline">← กลับ Lead ส่วนกลาง</Link>
            <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-bold text-slate-900">ประมวลผลและตรวจใบรับ SLA</h1>
                <button type="button" disabled={frozen} onClick={() => { void refresh(page); }} className={button}>โหลดงานล่าสุด</button></div>
            <p className="text-sm text-slate-600">เฉพาะ Admin · งานติดต่อครั้งแรกใน Lead ส่วนกลาง · ทำทีละคำขอ · เวลาไทย</p>
            <p className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950">การเปิดหน้า โหลดงาน และตรวจใบรับเป็นการอ่านเท่านั้น ต้องเลือกงานและยืนยันแยกก่อนประมวลผล ไม่มีการส่งอัตโนมัติหรือคิด KPI</p>
            {!context.processingEnabled && <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">ปิดการประมวลผลอยู่ — ตรวจใบรับเดิมได้ แต่ส่งหรือลองคำสั่งซ้ำไม่ได้</p>}
        </header>
        {operation && <p role="status" className="text-sm text-slate-600">{operation === 'process' ? 'กำลังยืนยันและประมวลผลหนึ่งคำขอ…' : operation === 'lookup' ? 'กำลังอ่านใบรับเดิม ไม่มีการประมวลผล…' : 'กำลังอ่านรายการงานและสิทธิ์ล่าสุด…'}</p>}
        {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-900">{error}</p>}
        {notice && <p role="status" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-950">{notice}</p>}
        {queue.error && <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">{queue.error} ยังอ่านใบรับด้วยรหัสที่เก็บไว้ได้ แต่ห้ามล้าง storage เพื่อข้ามปัญหา</p>}
        {queue.input && <section aria-label="คำขอค้างในแท็บ" className="space-y-3 rounded-2xl border border-amber-300 bg-amber-50 p-5">
            <h2 className="font-bold text-amber-950">มีคำขอเดิมที่ต้องตรวจผลก่อน</h2><p className="text-sm text-amber-950">ยังเริ่มงานอื่นไม่ได้ ตรวจใบรับก่อน หรือลองด้วยรหัสเดิมหลังทบทวน ไม่มีปุ่มล้างคำขอ</p>
            <p className="break-all text-xs">รหัสคำขอ: {queue.input.requestId}<br />รหัสงาน: {queue.input.taskId}</p>
            <div className="flex flex-wrap gap-3"><button type="button" disabled={frozen} className={button} onClick={() => { if (queue.input) void lookup(queue.input); }}>ตรวจใบรับคำขอค้าง</button>
                <button type="button" disabled={frozen || !context.processingEnabled} className={button} onClick={() => { if (queue.input) choose({ kind: 'retry', input: queue.input }); }}>ทบทวนการลองคำขอเดิม</button></div>
        </section>}
        {receipt && <SlaProcessingReceipt receipt={receipt.value} source={receipt.source} />}
        <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5"><h2 className="font-semibold text-slate-900">ค้นหาใบรับของ Admin บัญชีนี้</h2>
            <p className="text-xs text-slate-500">ระบุรหัสคำขอและรหัสงานคู่เดิม ไม่สามารถดูใบรับของ Admin คนอื่น การไม่พบใบรับไม่ใช่หลักฐานว่าคำสั่งไม่เคยสำเร็จ</p>
            <form className="grid gap-3 sm:grid-cols-2" onSubmit={event => { event.preventDefault(); void lookup({ requestId: requestId.trim(), taskId: taskId.trim() }); }}>
                <label className="text-sm">รหัสคำขอ<input required maxLength={36} disabled={frozen} value={requestId} onChange={event => setRequestId(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 p-2 font-mono text-xs" /></label>
                <label className="text-sm">รหัสงาน<input required maxLength={36} disabled={frozen} value={taskId} onChange={event => setTaskId(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 p-2 font-mono text-xs" /></label>
                <button disabled={frozen} type="submit" className={button}>ค้นหาใบรับเท่านั้น</button>
            </form>
        </section>
        {selection && <section aria-label="ยืนยันการประมวลผล" className="space-y-4 rounded-2xl border-2 border-blue-600 bg-white p-5">
            <h2 className="text-lg font-bold">{selection.kind === 'retry' ? 'ทบทวนคำขอเดิม ไม่สร้างรหัสใหม่' : `ทบทวนงานของ ${selection.row.customerName}`}</h2>
            <p className="break-all text-xs text-slate-600">รหัสงาน: {selection.kind === 'retry' ? selection.input.taskId : selection.row.taskId}</p>
            {selection.kind === 'new' && <p className="text-sm text-slate-600">ผู้ดูแลตามรายการที่อ่าน: {selection.row.ownerName ?? selection.row.ownerUserId ?? 'ยังไม่พร้อม'} · กำหนดบริการ: {processingTime(selection.row.serviceDueAt)}</p>}
            <p className="text-sm text-slate-700">ระบบตรวจข้อมูลล่าสุดอีกครั้ง อาจบันทึกกำหนด Sales ปิดงานเมื่อมีหลักฐานติดต่อสำเร็จ ถอนแจ้งเตือนเดิม หรือสร้างแจ้งเตือนในแอปแบบกันซ้ำ ผลจำลองไม่ใช่การรับรองผลคำสั่ง</p>
            <label className="flex items-start gap-3 text-sm text-slate-900"><input type="checkbox" disabled={frozen} checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} className="mt-1" />ฉันตรวจรหัสงานและเข้าใจผลของการประมวลผลนี้แล้ว</label>
            <div className="flex flex-wrap gap-3"><button type="button" disabled={frozen || !acknowledged || !context.processingEnabled || !!queue.error} onClick={() => { void confirm(); }} className="rounded-xl bg-blue-700 px-5 py-2 text-sm font-semibold text-white disabled:opacity-40">{selection.kind === 'retry' ? 'ยืนยันลองคำขอเดิม' : 'ยืนยันประมวลผลหนึ่งงาน'}</button>
                <button type="button" disabled={frozen} onClick={() => { setSelection(null); setAcknowledged(false); }} className={button}>ปิดการทบทวน</button></div>
        </section>}
        <section aria-label="งานติดต่อครั้งแรก" className="space-y-3"><h2 className="text-lg font-bold text-slate-900">เลือกงานจากรายการจำลองล่าสุด</h2>
            {snapshot && <p className="text-xs text-slate-500">ข้อมูล ณ {processingTime(snapshot.asOf)} · แม้รายการรอตรวจหลักฐาน ก็เลือกให้ระบบตรวจใหม่ได้โดยไม่รับรองว่าจะส่งแจ้งเตือน</p>}
            {!snapshot && !frozen && <p className="text-sm text-slate-600">กดโหลดงานล่าสุดเพื่อเลือกงาน การตรวจใบรับยังใช้งานแยกได้</p>}
            {snapshot?.rows.length === 0 && <p className="rounded-xl bg-white p-5 text-sm text-slate-600">ไม่พบงานติดต่อครั้งแรกที่เปิดในหน้านี้ ไม่ได้หมายความว่างานฝ่ายขายทั้งหมดเสร็จแล้ว</p>}
            {snapshot?.rows.map(row => <article key={row.taskId} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-5">
                <div className="space-y-1"><h3 className="font-semibold text-slate-900">{row.customerName}</h3><p className="text-sm text-slate-600">ผู้ดูแล: {row.ownerName ?? row.ownerUserId ?? 'ยังไม่พร้อม'}</p>
                    <p className="text-xs text-slate-500">ผลจำลอง: {processingReasons[row.reason]} · ยังไม่ใช่ผลประมวลผล</p>
                    <Link href={`/sales-crm/${encodeURIComponent(row.customerId)}`} prefetch={false} className="inline-block text-xs text-blue-700 underline">ดูหลักฐานและงานส่วนกลาง</Link></div>
                <button type="button" disabled={newBlocked} onClick={() => choose({ kind: 'new', row })} className={button} aria-label={`ทบทวนงานของ ${row.customerName}`}>เลือกทบทวน</button>
            </article>)}
            <nav aria-label="หน้ารายการประมวลผล" className="flex items-center justify-between gap-3 pt-3 text-sm"><button type="button" disabled={frozen || page === 0} onClick={() => { void refresh(page - 1); }} className={button}>ก่อนหน้า</button>
                <span>หน้า {page + 1} · หน้าละ 20 งาน</span><button type="button" disabled={frozen || !snapshot?.hasMore || page >= 1000} onClick={() => { void refresh(page + 1); }} className={button}>ถัดไป</button></nav>
            {page === 1000 && snapshot?.hasMore && <p className="text-sm text-amber-950">ถึงขีดจำกัดการเปิดหน้า ยังมีงานที่ไม่ได้แสดง</p>}
        </section>
        <p className="text-xs text-slate-500">คำขอค้างเก็บเฉพาะรหัสในแท็บนี้ ไม่ใช่คิวข้ามแท็บหรือระบบ offline หากปิดแท็บหรือล้างข้อมูลเบราว์เซอร์ ให้ตรวจใบรับก่อนสร้างคำขอใหม่</p>
        <Link href="/sales-crm/sla-preview" prefetch={false} className="inline-block text-sm text-blue-700 underline">กลับหน้าจำลองอย่างเดียว</Link>
    </div></main>;
}
