'use client';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { LeadLifecycleApiError } from '@/lib/sales/leadLifecycleClient';
import { parseLeadLifecycleInput, type LeadLifecycleInput, type LeadLifecycleResult } from '@/lib/sales/leadLifecycleContracts';
import type { LeadLifecycleContext } from '@/lib/sales/leadLifecycleReadContracts';
import { displayBangkokTime, isLeadWorkOverdue } from '@/lib/sales/leadWorkDates';
import { clearLeadLifecyclePending, LeadLifecyclePendingError, readLeadLifecyclePending, writeLeadLifecyclePending } from '@/lib/sales/leadLifecyclePending';

interface Props {
    context: LeadLifecycleContext;
    save: (input: LeadLifecycleInput) => Promise<LeadLifecycleResult>;
    onSaved: (result: LeadLifecycleResult) => void;
    onLockedChange: (locked: boolean) => void;
    onRefreshRequired: () => Promise<void>;
    disabled?: boolean;
}

const subscribeHydration = () => () => undefined;
const clientReady = () => true;
const serverReady = () => false;
const refreshCodes = ['STALE_SCOPE', 'STALE_ACTION', 'FORBIDDEN', 'ACTOR_CHANGED', 'SCOPE_CLOSED', 'UNAUTHENTICATED',
    'NOT_FOUND', 'INACTIVE_TARGET', 'BOOKING_HISTORY_EXISTS', 'OPEN_INTERESTS', 'UNCHANGED_OWNER', 'FEATURE_DISABLED', 'SETUP_REQUIRED'];

function permissions(context: LeadLifecycleContext) {
    const { work, blockers } = context;
    const sameScope = work.customer.id === work.scope.customerId && (!work.currentAction
        || (work.currentAction.customerId === work.scope.customerId && work.currentAction.interestId === work.scope.interestId));
    const admin = work.actor.role === 'admin';
    const ownedSales = work.actor.role === 'sales' && work.actor.userId === work.owner.userId && work.owner.active;
    return {
        reassign: sameScope && context.canReassign && admin && !work.scopeClosed,
        close: sameScope && context.canClose && !work.scopeClosed && (admin || ownedSales) && !blockers.hasBookingHistory
            && (work.scope.interestId !== null || !blockers.hasOpenInterests),
    };
}

export default function LeadLifecycleForm(props: Props) {
    const ready = useSyncExternalStore(subscribeHydration, clientReady, serverReady);
    if (!ready) return <p role="status" className="text-sm text-slate-500">กำลังตรวจคำขอเปลี่ยนแปลง Lead ค้าง…</p>;
    const { actor, scope } = props.context.work;
    return <LifecycleSession key={`${actor.userId}:${scope.customerId}:${scope.interestId ?? 'central'}`} {...props} />;
}

function LifecycleSession({ context, save, onSaved, onLockedChange, onRefreshRequired, disabled = false }: Props) {
    const { work } = context;
    const { actor, scope } = work;
    const allowed = permissions(context);
    const [recovery] = useState(() => {
        try { return { input: readLeadLifecyclePending(actor.userId, scope), error: '' }; }
        catch (failure) { return { input: null, error: (failure as Error).message }; }
    });
    const [command, setCommand] = useState<LeadLifecycleInput['command']>(() => recovery.input?.command ?? (allowed.reassign ? 'reassign_owner' : 'close_lost'));
    const [reason, setReason] = useState(recovery.input?.reason ?? '');
    const [target, setTarget] = useState(recovery.input?.command === 'reassign_owner' ? recovery.input.newOwnerUserId : '');
    const [search, setSearch] = useState('');
    const [pending, setPending] = useState<LeadLifecycleInput | null>(recovery.input);
    const pendingRef = useRef(recovery.input);
    const uncertainRef = useRef(!!recovery.input);
    const inFlight = useRef(false);
    const confirmedRef = useRef(false);
    const refreshRef = useRef(false);
    const mounted = useRef(true);
    const [busy, setBusy] = useState(false);
    const [confirmed, setConfirmed] = useState(false);
    const [needsRefresh, setNeedsRefresh] = useState(false);
    const [storageBlocked, setStorageBlocked] = useState(!!recovery.error);
    const [error, setError] = useState(recovery.error);
    const contextKey = JSON.stringify([context, disabled]);
    // A changed context invalidates review permanently, even if it later changes
    // back to the same values. Pending receipts are deliberately independent of it.
    const contextToken = useMemo(() => ({ key: contextKey }), [contextKey]);
    const [preview, setPreview] = useState<{ input: LeadLifecycleInput; token: typeof contextToken } | null>(null);
    const previewRef = useRef<typeof preview>(null);
    const reviewed = preview?.token === contextToken ? preview.input : null;
    const locked = !!pending || storageBlocked || busy;
    const canCommand = (kind: LeadLifecycleInput['command']) => kind === 'reassign_owner' ? allowed.reassign : allowed.close;
    const permitted = canCommand(pending?.command ?? command);
    const frozen = disabled || locked || confirmed || needsRefresh;
    const currentAction = work.currentAction;
    const candidates = context.candidates.filter(candidate => candidate.userId !== work.owner.userId);
    const filtered = candidates.filter(candidate => `${candidate.displayName ?? ''} ${candidate.userId}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
    const candidateName = (id: string) => context.candidates.find(candidate => candidate.userId === id)?.displayName ?? id;
    const fieldClass = 'mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100';

    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    useEffect(() => { onLockedChange(locked); }, [locked, onLockedChange]);
    useEffect(() => {
        if (!locked) return;
        const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    }, [locked]);

    function invalidate() { previewRef.current = null; setPreview(null); setError(''); }
    function review(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (disabled || inFlight.current || pendingRef.current || storageBlocked || confirmedRef.current || refreshRef.current || !canCommand(command)) return;
        setError(''); previewRef.current = null; setPreview(null);
        try {
            if (command === 'reassign_owner' && !candidates.some(candidate => candidate.userId === target)) {
                throw new Error('กรุณาเลือก Sales คนใหม่จากรายชื่อที่โหลดไว้ โดยต้องไม่ใช่ผู้ดูแลคนเดิม');
            }
            const input = parseLeadLifecycleInput({ requestId: crypto.randomUUID(), command,
                customerId: scope.customerId, interestId: scope.interestId, expectedRevision: work.lifecycleRevision,
                expectedActionId: currentAction?.id ?? null, reason,
                ...(command === 'reassign_owner' ? { newOwnerUserId: target } : {}),
            });
            const nextPreview = { input, token: contextToken };
            previewRef.current = nextPreview; setPreview(nextPreview);
        } catch (failure) { setError(failure instanceof Error ? failure.message : 'กรุณาตรวจข้อมูลก่อนยืนยัน'); }
    }

    async function send() {
        if (disabled || inFlight.current || storageBlocked || confirmedRef.current || refreshRef.current) return;
        const input = pendingRef.current ?? (previewRef.current?.token === contextToken ? previewRef.current.input : null);
        if (!input || !canCommand(input.command)) return;
        // New review must still reference an available different Sales. A pending
        // replay keeps its original target even if the successful command moved it.
        if (!pendingRef.current && input.command === 'reassign_owner' && !candidates.some(candidate => candidate.userId === input.newOwnerUserId)) return;
        setError('');
        try { writeLeadLifecyclePending(actor.userId, scope, input); }
        catch (failure) { setStorageBlocked(true); setError((failure as LeadLifecyclePendingError).message); onLockedChange(true); return; }
        pendingRef.current = input; setPending(input);
        inFlight.current = true; setBusy(true);
        // Parent locks tabs/navigation synchronously before the first POST call.
        onLockedChange(true);
        let result: LeadLifecycleResult;
        try { result = await save(input); confirmedRef.current = true; }
        catch (failure) {
            if (!mounted.current) return;
            setError(failure instanceof LeadLifecycleApiError ? failure.message : 'ยังยืนยันผลเปลี่ยนแปลง Lead ไม่ได้ ส่งซ้ำได้เฉพาะคำขอเดิมเท่านั้น');
            if (!uncertainRef.current && failure instanceof LeadLifecycleApiError && failure.definitelyNotSaved) {
                try {
                    clearLeadLifecyclePending(actor.userId, scope, input);
                    pendingRef.current = null; setPending(null); previewRef.current = null; setPreview(null);
                    if (refreshCodes.includes(failure.code)) { refreshRef.current = true; setNeedsRefresh(true); }
                } catch (storageFailure) { uncertainRef.current = true; setStorageBlocked(true); setError((storageFailure as Error).message); }
            } else uncertainRef.current = true;
            return;
        } finally { inFlight.current = false; if (mounted.current) setBusy(false); }
        if (!mounted.current) return;
        setConfirmed(true); previewRef.current = null; setPreview(null);
        try {
            clearLeadLifecyclePending(actor.userId, scope, input);
            pendingRef.current = null; uncertainRef.current = false; setPending(null);
        } catch (failure) { setStorageBlocked(true); setError(`ยืนยันว่าบันทึกสำเร็จแล้ว แต่ ${(failure as Error).message}`); }
        // The POST is already confirmed; parent refresh failure never enters its catch.
        try { await onSaved(result); }
        catch { if (mounted.current) setError('บันทึกสำเร็จแล้ว แต่โหลดข้อมูลล่าสุดไม่ได้ กรุณาตรวจสถานะก่อนเริ่มรายการใหม่'); }
    }

    async function refresh() {
        if (disabled || inFlight.current || pendingRef.current || storageBlocked) return;
        inFlight.current = true; setBusy(true); onLockedChange(true);
        try {
            await onRefreshRequired();
            if (mounted.current) { refreshRef.current = false; confirmedRef.current = false; setNeedsRefresh(false); setConfirmed(false); previewRef.current = null; setPreview(null); setReason(''); setTarget(''); setSearch(''); setError(''); }
        } catch { if (mounted.current) setError('โหลดสถานะล่าสุดไม่สำเร็จ ยังเริ่มคำขอใหม่ไม่ได้ กรุณาตรวจสอบอีกครั้ง'); }
        finally { inFlight.current = false; if (mounted.current) setBusy(false); }
    }

    return <section className="space-y-4 rounded-2xl border border-amber-200 bg-white p-5 sm:p-6">
        <div><h2 className="text-lg font-bold text-slate-900">จัดการผู้ดูแล / ปิด Lead ก่อนจอง</h2>
            <p className="mt-1 text-sm text-slate-500">ตรวจผลกระทบก่อนยืนยันทุกครั้ง ไม่เปลี่ยนวันเริ่ม Lead และไม่ลบประวัติ</p></div>
        {disabled && <p className="rounded-xl bg-slate-100 p-3 text-sm text-slate-700">ยังไม่เปิดให้เปลี่ยนแปลงในขณะนี้ คำขอค้างยังเก็บไว้ ห้ามเริ่มใหม่แทนคำขอเดิม</p>}
        {!allowed.reassign && !allowed.close && <p className="text-sm text-slate-700">อ่านอย่างเดียว: {work.scopeClosed ? 'งานนี้ปิดแล้ว' : 'สิทธิ์หรือเงื่อนไขปัจจุบันไม่อนุญาตให้ทำรายการ'}</p>}
        {context.blockers.hasBookingHistory && <p className="text-sm text-amber-900">มีประวัติการจองแล้ว ปิดเป็น Lost ก่อนจองจากหน้านี้ไม่ได้</p>}
        {scope.interestId === null && context.blockers.hasOpenInterests && <p className="text-sm text-amber-900">ยังมีงานในโครงการที่เปิดอยู่ ต้องตรวจแต่ละโครงการก่อนปิด Lead ส่วนกลาง</p>}
        {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
        {pending && <div className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
            <p>{confirmed ? 'ยืนยันว่าบันทึกสำเร็จแล้ว ห้ามส่งคำขอใหม่' : 'มีคำขอเปลี่ยนแปลงค้าง ผลเดิมอาจสำเร็จแล้ว จึงห้ามแก้ข้อมูลหรือสร้างคำขอใหม่'}</p>
            <p className="break-all">รหัสคำขอ: <code>{pending.requestId}</code></p>
            <p>คำขอเดิม: {pending.command === 'reassign_owner' ? `ย้ายผู้ดูแลไป ${candidateName(pending.newOwnerUserId)}` : 'ปิดเป็น Lost ก่อนจอง'}</p>
            <p>เหตุผลเดิม: {pending.reason}</p>
            {(!permitted || disabled) && <p>สถานะหรือสิทธิ์ปัจจุบันไม่ให้ส่งซ้ำ กรุณาให้ Admin ตรวจรหัสคำขอนี้ ไม่ได้แปลว่าคำขอเดิมล้มเหลว</p>}
            {!confirmed && <button type="button" disabled={disabled || busy || storageBlocked || !permitted} onClick={send} className="rounded-xl bg-amber-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">{busy ? 'กำลังยืนยันผล…' : 'ส่งคำขอเปลี่ยนแปลงเดิมซ้ำ'}</button>}
        </div>}
        {(allowed.reassign || allowed.close || pending) && !confirmed && <form aria-label="ตรวจทานการเปลี่ยนแปลง Lead" onSubmit={review} className="space-y-4">
            <fieldset disabled={frozen} className="space-y-4">
                <label className="block text-sm font-medium text-slate-700">รายการที่ต้องการทำ<select className={fieldClass} value={command} onChange={event => { invalidate(); setCommand(event.target.value as LeadLifecycleInput['command']); }}>
                    <option value="reassign_owner" disabled={!allowed.reassign}>ย้ายผู้ดูแล (Admin)</option>
                    <option value="close_lost" disabled={!allowed.close}>ปิดเป็น Lost ก่อนจอง</option>
                </select></label>
                {command === 'reassign_owner' && <>
                    <label className="block text-sm font-medium text-slate-700">ค้นหา Sales ในรายชื่อที่โหลด<input className={fieldClass} value={search} onChange={event => { invalidate(); setSearch(event.target.value); setTarget(''); }} placeholder="ค้นหาชื่อ Sales…" /></label>
                    <label className="block text-sm font-medium text-slate-700">Sales ผู้ดูแลคนใหม่ *<select className={fieldClass} required value={target} onChange={event => { invalidate(); setTarget(event.target.value); }}>
                        <option value="">เลือก Sales คนใหม่</option>
                        {filtered.map(candidate => <option key={candidate.userId} value={candidate.userId}>{candidate.displayName ?? candidate.userId}</option>)}
                        {pending?.command === 'reassign_owner' && !filtered.some(candidate => candidate.userId === pending.newOwnerUserId)
                            && <option value={pending.newOwnerUserId}>ผู้ดูแลตามคำขอเดิม: {candidateName(pending.newOwnerUserId)}</option>}
                    </select></label>
                    {!filtered.length && <p className="text-sm text-slate-500">ไม่พบ Sales คนใหม่ในรายชื่อที่โหลด ห้ามกรอกรหัสผู้ใช้เอง</p>}
                    {context.candidatesTruncated && <p className="text-sm text-amber-900">รายชื่อที่โหลดเป็นเพียงบางส่วน การค้นหานี้ค้นเฉพาะรายการที่แสดง หากไม่พบให้ Admin ตรวจรายชื่อก่อน</p>}
                </>}
                <label className="block text-sm font-medium text-slate-700">เหตุผลการเปลี่ยนแปลง *<input className={fieldClass} required value={reason} onChange={event => { invalidate(); setReason(event.target.value); }} /></label>
                <p className="text-xs text-slate-500">เหตุผลบรรทัดเดียว ไม่เกิน 1,000 ตัวอักษร ไม่ใส่รหัสผ่านหรือข้อมูลส่วนบุคคลที่ไม่จำเป็น</p>
            </fieldset>
            {!pending && <button type="submit" disabled={frozen || !permitted} className="rounded-xl border border-blue-300 px-4 py-2.5 text-sm font-semibold text-blue-800 disabled:opacity-40">ตรวจทานก่อนยืนยัน</button>}
        </form>}
        {preview && !reviewed && !pending && <p role="status" className="text-sm text-amber-900">ข้อมูลหรือสถานะเปลี่ยนหลังตรวจทาน กรุณาตรวจทานใหม่ก่อนยืนยัน</p>}
        {reviewed && !pending && !confirmed && <section aria-label="ผลกระทบก่อนยืนยัน" className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm">
            <h3 className="font-bold text-amber-950">{reviewed.command === 'reassign_owner' ? 'ยืนยันการย้ายผู้ดูแล' : 'ยืนยันการปิด Lost ก่อนจอง'}</h3>
            <p>ลูกค้า: {work.customer.name} · ขอบเขต: {work.projectName ?? 'Lead ส่วนกลาง'}</p>
            <p>ผู้ดูแลปัจจุบัน: {work.owner.displayName ?? work.owner.userId}{work.owner.active ? '' : ' (ไม่พร้อมใช้งาน)'}</p>
            {reviewed.command === 'reassign_owner' && <p>ผู้ดูแลคนใหม่: {candidateName(reviewed.newOwnerUserId)}</p>}
            <p>งานปัจจุบัน: {currentAction?.action ?? 'ไม่มีงานถัดไปที่เปิดอยู่'}</p>
            {currentAction && <p>กำหนดเดิม: {displayBangkokTime(currentAction.dueAt)} · {isLeadWorkOverdue(currentAction.dueAt, work.asOf) ? 'เลยกำหนดแล้ว ณ เวลาโหลดข้อมูล' : 'ยังไม่เลยกำหนด ณ เวลาโหลดข้อมูล'}</p>}
            <p>งาน SLA ที่เปิดอยู่: {context.impact.openSlaCount} รายการ · การแจ้งเตือนที่เกี่ยวข้องซึ่งจะถอน: {context.impact.pendingNotificationCount} รายการ</p>
            <p className="text-xs text-amber-900">จำนวนเป็นภาพข้อมูล ณ {displayBangkokTime(work.asOf)} อาจเปลี่ยนก่อนยืนยัน ระบบจะตรวจเงื่อนไขอีกครั้งตอนบันทึก</p>
            <p>{reviewed.command === 'reassign_owner' ? 'ย้ายเฉพาะขอบเขตนี้ งานถัดไปยังใช้ข้อความและกำหนดเดิม งาน SLA ย้ายผู้รับผิดชอบและรอกำหนดเวลาของพนักงานใหม่ตามนโยบาย' : 'ปิดเฉพาะขอบเขตนี้ ยกเลิกงานถัดไปและงาน SLA ที่เปิดอยู่ ไม่ถือว่าทำงานสำเร็จ'}</p>
            <p className="font-semibold">สิ่งที่ไม่เปลี่ยน: วันเริ่ม Lead, กำหนดบริการเดิม, ประวัติเกินกำหนดและหลักฐานเดิม ไม่ลบข้อมูล ไม่ให้คะแนน KPI อัตโนมัติ</p>
            <p>เหตุผล: {reviewed.reason}</p>
            <div className="flex flex-wrap gap-3">
                <button type="button" disabled={disabled || busy || storageBlocked} onClick={invalidate} className="rounded-xl border border-slate-300 bg-white px-4 py-2 disabled:opacity-40">กลับไปแก้ไข</button>
                <button type="button" disabled={disabled || busy || storageBlocked || !canCommand(reviewed.command)} onClick={send} className="rounded-xl bg-amber-900 px-4 py-2 font-semibold text-white disabled:opacity-40">ยืนยันการเปลี่ยนแปลง Lead</button>
            </div>
        </section>}
        {confirmed && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">ยืนยันว่าบันทึกการเปลี่ยนแปลงสำเร็จแล้ว ไม่ต้องส่งซ้ำ แม้โหลดข้อมูลล่าสุดไม่สำเร็จ</p>}
        {(needsRefresh || confirmed) && !pending && !storageBlocked && <div className="space-y-2">
            <p className="text-sm text-slate-600">ต้องตรวจสถานะและสิทธิ์ล่าสุดก่อนเริ่มรายการใหม่</p>
            <button type="button" onClick={refresh} disabled={disabled || busy} className="rounded-xl border border-blue-300 px-4 py-2 text-sm font-semibold text-blue-800 disabled:opacity-40">โหลดสถานะล่าสุดก่อนทำรายการใหม่</button>
        </div>}
    </section>;
}
