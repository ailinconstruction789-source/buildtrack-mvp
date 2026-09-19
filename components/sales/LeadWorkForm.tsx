'use client';

import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { LeadWorkApiError } from '@/lib/sales/leadWorkClient';
import { parseLeadWorkInput, type LeadWorkInput, type LeadWorkResult } from '@/lib/sales/leadWorkContracts';
import type { LeadWorkSnapshot } from '@/lib/sales/leadWorkReadContracts';
import { bangkokInputTimestamp, bangkokTimestampInput } from '@/lib/sales/leadWorkDates';
import { clearLeadWorkPending, LeadWorkPendingError, readLeadWorkPending, writeLeadWorkPending } from '@/lib/sales/leadWorkPending';

interface Props {
    snapshot: LeadWorkSnapshot;
    save: (input: LeadWorkInput) => Promise<LeadWorkResult>;
    onSaved: (result: LeadWorkResult) => void;
    onLockedChange: (locked: boolean) => void;
    onRefreshRequired: () => Promise<void>;
}

const emptyFields = { command: 'set_next_action', action: '', due: '', reason: '', attemptAction: '', channel: '', result: '', occurred: '' };
function fieldsFrom(input: LeadWorkInput) {
    return { command: input.command, action: input.nextAction.action, due: bangkokTimestampInput(input.nextAction.dueAt), reason: input.reason,
        attemptAction: input.command === 'record_attempt' ? input.attempt.action : '',
        channel: input.command === 'record_attempt' ? input.attempt.channel : '',
        result: input.command === 'record_attempt' ? input.attempt.result : '',
        occurred: input.command === 'record_attempt' ? bangkokTimestampInput(input.attempt.occurredAt) : '' };
}

export function canWriteLeadWork(snapshot: LeadWorkSnapshot): boolean {
    return snapshot.canWrite && snapshot.owner.active && !snapshot.scopeClosed
        && (snapshot.actor.role === 'admin' || (snapshot.actor.role === 'sales' && snapshot.actor.userId === snapshot.owner.userId));
}

const subscribeHydration = () => () => undefined;
const clientReady = () => true;
const serverReady = () => false;

export default function LeadWorkForm(props: Props) {
    // sessionStorage is only read after hydration; no server/client markup mismatch.
    const ready = useSyncExternalStore(subscribeHydration, clientReady, serverReady);
    if (!ready) return <p role="status" className="text-sm text-slate-500">กำลังตรวจคำขอค้างในแท็บนี้…</p>;
    return <LeadWorkFormSession key={`${props.snapshot.actor.userId}:${props.snapshot.scope.customerId}:${props.snapshot.scope.interestId ?? 'central'}`} {...props} />;
}

function LeadWorkFormSession({ snapshot, save, onSaved, onLockedChange, onRefreshRequired }: Props) {
    const [recovery] = useState(() => {
        try { return { input: readLeadWorkPending(snapshot.actor.userId, snapshot.scope), error: '' }; }
        catch (failure) { return { input: null, error: (failure as Error).message }; }
    });
    const [fields, setFields] = useState(() => recovery.input ? fieldsFrom(recovery.input) : emptyFields);
    const [pending, setPending] = useState<LeadWorkInput | null>(recovery.input);
    const pendingRef = useRef<LeadWorkInput | null>(recovery.input);
    const uncertain = useRef(!!recovery.input);
    const inFlight = useRef(false);
    const mounted = useRef(true);
    const [saving, setSaving] = useState(false);
    const [storageBlocked, setStorageBlocked] = useState(!!recovery.error);
    const [confirmed, setConfirmed] = useState(false);
    const confirmedRef = useRef(false);
    const [refreshRequired, setRefreshRequired] = useState(false);
    const refreshRequiredRef = useRef(false);
    const [error, setError] = useState(recovery.error);
    const actor = snapshot.actor.userId, customerId = snapshot.scope.customerId, interestId = snapshot.scope.interestId;
    const writable = canWriteLeadWork(snapshot);
    const locked = storageBlocked || !!pending || saving;
    const frozen = locked || !writable || refreshRequired || confirmed;
    const fieldClass = 'mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100 disabled:text-slate-600';

    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);

    useEffect(() => { onLockedChange(locked); }, [locked, onLockedChange]);
    useEffect(() => {
        if (!locked) return;
        const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    }, [locked]);

    function change(key: keyof typeof emptyFields, value: string) { setFields(current => ({ ...current, [key]: value })); }

    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (inFlight.current || storageBlocked || !writable || refreshRequiredRef.current || confirmedRef.current) return;
        setError('');
        let input: LeadWorkInput;
        try {
            input = pendingRef.current ?? parseLeadWorkInput({
                requestId: crypto.randomUUID(), command: fields.command, customerId, interestId,
                expectedActionId: snapshot.currentAction?.id ?? null,
                nextAction: { action: fields.action, dueAt: bangkokInputTimestamp(fields.due) }, reason: fields.reason,
                ...(fields.command === 'record_attempt' ? { attempt: { action: fields.attemptAction, channel: fields.channel,
                    result: fields.result, occurredAt: bangkokInputTimestamp(fields.occurred) } } : {}),
            });
            // This write-ahead receipt and verified read-back MUST precede every send.
            writeLeadWorkPending(actor, { customerId, interestId }, input);
        } catch (failure) {
            if (failure instanceof LeadWorkPendingError) setStorageBlocked(true);
            setError(failure instanceof Error ? failure.message : 'ตรวจข้อมูลก่อนบันทึกไม่สำเร็จ');
            return;
        }
        pendingRef.current = input; setPending(input);
        // Coordinate the sibling command selector before React commits the next
        // render, so a same-tick click cannot unmount an in-flight work command.
        onLockedChange(true);
        inFlight.current = true; setSaving(true);
        let result: LeadWorkResult;
        try {
            result = await save(input);
            confirmedRef.current = true;
        } catch (failure) {
            if (!mounted.current) return;
            setError(failure instanceof LeadWorkApiError ? failure.message : 'ยังยืนยันผลบันทึกไม่ได้ กรุณาส่งซ้ำด้วยคำขอเดิมเท่านั้น');
            if (!uncertain.current && failure instanceof LeadWorkApiError && failure.definitelyNotSaved) {
                try {
                    clearLeadWorkPending(actor, { customerId, interestId }, input);
                    pendingRef.current = null; setPending(null);
                    if (['STALE_ACTION', 'ACTOR_CHANGED', 'FORBIDDEN', 'INACTIVE_OWNER', 'SCOPE_CLOSED', 'UNAUTHENTICATED'].includes(failure.code)) {
                        refreshRequiredRef.current = true; setRefreshRequired(true);
                    }
                } catch (storageFailure) {
                    uncertain.current = true; setStorageBlocked(true); setError((storageFailure as Error).message);
                }
            } else {
                // Sticky across retry 401/403/feature-disabled/conflict responses.
                uncertain.current = true;
            }
            return;
        } finally {
            inFlight.current = false;
            if (mounted.current) setSaving(false);
        }
        // A refresh/callback/storage cleanup failure is never a failed save.
        if (!mounted.current) return;
        setConfirmed(true);
        try {
            clearLeadWorkPending(actor, { customerId, interestId }, input);
            pendingRef.current = null; uncertain.current = false; setPending(null); setFields(emptyFields);
        } catch (failure) { setStorageBlocked(true); setError(`บันทึกสำเร็จแล้ว แต่ ${(failure as Error).message}`); }
        onSaved(result);
    }

    async function refresh() {
        if (inFlight.current || pendingRef.current) return;
        inFlight.current = true; setSaving(true);
        try { await onRefreshRequired(); if (mounted.current) {
            refreshRequiredRef.current = false; confirmedRef.current = false;
            setRefreshRequired(false); setConfirmed(false); setError('');
        } }
        catch { if (mounted.current) setError('โหลดสถานะล่าสุดไม่สำเร็จ ยังเริ่มคำขอใหม่ไม่ได้ กรุณาลองตรวจสอบอีกครั้ง'); }
        finally { inFlight.current = false; if (mounted.current) setSaving(false); }
    }

    return <section className="rounded-2xl border border-blue-200 bg-white p-5 sm:p-6 space-y-4">
        <div><h2 className="text-lg font-bold text-slate-900">บันทึกงานติดตาม</h2>
            <p className="mt-1 text-sm text-slate-500">เก็บกิจกรรมและแผนถัดไปพร้อมกัน ไม่เปลี่ยนสถานะ Lead และไม่ให้คะแนน KPI อัตโนมัติ</p></div>
        {!writable && <p className="rounded-xl bg-slate-100 p-3 text-sm text-slate-700">อ่านอย่างเดียว: {snapshot.scopeClosed ? 'ขอบเขตงานนี้ปิดแล้ว' : !snapshot.owner.active ? 'ผู้ดูแลไม่ใช่ Sales ที่ใช้งานอยู่' : 'แก้ไขได้เฉพาะ Sales เจ้าของงานนี้กับ Admin'}</p>}
        {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
        {pending && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <p>{confirmed ? 'ยืนยันว่าบันทึกแล้ว ห้ามส่งใหม่' : 'มีคำขอค้าง: ยังไม่ทราบผลแน่ชัด ข้อมูลถูกล็อกและส่งซ้ำได้เฉพาะคำขอเดิม'}</p>
            <p className="mt-1 break-all">รหัสคำขอ: <code>{pending.requestId}</code></p>
            {!writable && <p className="mt-2">สิทธิ์หรือสถานะปัจจุบันไม่อนุญาตให้ส่งซ้ำ ให้ Admin ตรวจรหัสคำขอนี้ ห้ามล้างคำขอหรือเริ่มคำขอใหม่</p>}
        </div>}
        {(writable || pending) && <form aria-label="บันทึกงานติดตาม Lead" onSubmit={submit} className="space-y-4">
            <fieldset disabled={frozen} className="grid gap-4 sm:grid-cols-2">
                <label className="text-sm font-medium text-slate-700 sm:col-span-2">ประเภทการบันทึก<select value={fields.command} onChange={event => change('command', event.target.value)} className={fieldClass}>
                    <option value="set_next_action">ตั้ง / เปลี่ยนงานถัดไป</option><option value="record_attempt">บันทึกการติดต่อ + งานถัดไป</option>
                </select></label>
                {fields.command === 'record_attempt' && <>
                    <label className="text-sm font-medium text-slate-700 sm:col-span-2">สิ่งที่ทำจริง *<input required value={fields.attemptAction} onChange={event => change('attemptAction', event.target.value)} className={fieldClass} /></label>
                    <label className="text-sm font-medium text-slate-700">ช่องทางติดต่อ *<select required value={fields.channel} onChange={event => change('channel', event.target.value)} className={fieldClass}>
                        <option value="">เลือกช่องทาง</option><option value="phone">โทรศัพท์</option><option value="chat">แชท</option><option value="email">อีเมล</option><option value="in_person">พบด้วยตนเอง</option><option value="other">อื่น ๆ</option>
                    </select></label>
                    <label className="text-sm font-medium text-slate-700">ผลการติดต่อ *<select required value={fields.result} onChange={event => change('result', event.target.value)} className={fieldClass}>
                        <option value="">เลือกผลที่เกิดขึ้นจริง</option><option value="contact_success">ติดต่อสำเร็จ</option><option value="no_answer">ไม่รับสาย / ไม่ตอบ</option><option value="customer_requested_later">ลูกค้าขอให้ติดต่อภายหลัง</option><option value="other">อื่น ๆ</option>
                    </select></label>
                    <label className="text-sm font-medium text-slate-700 sm:col-span-2">เวลาที่ทำจริง (กรุงเทพฯ UTC+07:00) *<input required type="datetime-local" step="1" value={fields.occurred} onChange={event => change('occurred', event.target.value)} className={fieldClass} /></label>
                    <p className="text-xs text-amber-800 sm:col-span-2">“ไม่รับสาย / ไม่ตอบ” เป็นเพียงความพยายามติดต่อ ไม่ถือว่าติดต่อสำเร็จ กิจกรรมเก่ากว่าแผนล่าสุดบันทึกผ่านหน้านี้ไม่ได้</p>
                </>}
                <label className="text-sm font-medium text-slate-700">งานถัดไป *<input required value={fields.action} onChange={event => change('action', event.target.value)} className={fieldClass} /></label>
                <label className="text-sm font-medium text-slate-700">กำหนดงานถัดไป (กรุงเทพฯ UTC+07:00) *<input required type="datetime-local" step="1" value={fields.due} onChange={event => change('due', event.target.value)} className={fieldClass} /></label>
                <label className="text-sm font-medium text-slate-700 sm:col-span-2">เหตุผล / รายละเอียดประกอบ *<input required value={fields.reason} onChange={event => change('reason', event.target.value)} className={fieldClass} /></label>
            </fieldset>
            <p className="text-xs text-slate-500">ข้อความงานไม่เกิน 500 ตัวอักษร เหตุผลไม่เกิน 1,000 ตัวอักษร การเปลี่ยนแผนไม่ลบกำหนดเดิมหรือประวัติเกินกำหนด ไม่ใส่รหัสผ่านหรือข้อมูลส่วนบุคคลที่ไม่จำเป็นในรายละเอียด</p>
            {!confirmed && !refreshRequired && <button type="submit" disabled={storageBlocked || saving || !writable} className="rounded-xl bg-blue-700 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40">
                {saving ? 'กำลังบันทึก…' : pending ? 'ส่งซ้ำด้วยคำขอเดิม' : 'บันทึกงานติดตาม'}</button>}
        </form>}
        {(refreshRequired || (confirmed && !storageBlocked)) && <div className="space-y-2">
            <p className="text-sm text-slate-600">{confirmed ? 'บันทึกสำเร็จแล้ว ตรวจข้อมูลล่าสุดก่อนเริ่มงานถัดไป' : 'สถานะงานหรือสิทธิ์อาจเปลี่ยนแล้ว ต้องโหลดข้อมูลล่าสุดก่อนแก้และส่งคำขอใหม่'}</p>
            <button type="button" disabled={saving || storageBlocked || !!pending} onClick={refresh} className="rounded-xl border border-blue-300 px-4 py-2 text-sm font-semibold text-blue-800 disabled:opacity-40">โหลดสถานะล่าสุดก่อนแก้ไข</button>
        </div>}
    </section>;
}
