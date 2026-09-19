'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { WorkScheduleApiError } from '@/lib/sales/workScheduleClient';
import { parseWorkScheduleInput, type WorkScheduleInput, type WorkScheduleResult, type WorkScheduleSnapshot } from '@/lib/sales/workScheduleContracts';
import { readWorkSchedulePending, writeWorkSchedulePending, clearWorkSchedulePending } from '@/lib/sales/workSchedulePending';
import { workScheduleFromLocal, workScheduleToLocal } from '@/lib/sales/workScheduleDates';
import { prepareSlaWorkCalendar } from '@/lib/sales/slaCalendar';
import { displayBangkokTime } from '@/lib/sales/leadWorkDates';

interface Props {
    snapshot: WorkScheduleSnapshot;
    disabled?: boolean;
    save: (input: WorkScheduleInput) => Promise<WorkScheduleResult>;
    onSaved: (result: WorkScheduleResult) => Promise<void>;
    onLockedChange: (locked: boolean) => void;
    onRefreshRequired: () => Promise<void>;
}
type Row = { key: string; type: 'work' | 'leave' | 'break'; startsAt: string; endsAt: string };
const kinds = { work: 'ทำงาน', leave: 'ลาที่อนุมัติแล้ว', break: 'พัก' };
const field = 'mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100';

function ScheduleTimeInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
    // Native datetime-local only supports millisecond fractions. Existing exact
    // microsecond evidence uses a text editor for its whole mounted field lifetime,
    // so editing does not switch control types or silently blank/truncate its value.
    const [precise] = useState(() => /\.\d{4,6}$/.test(value));
    return <input type={precise ? 'text' : 'datetime-local'} step="0.001" required value={value}
        title={precise ? 'เวลาละเอียดตามกรุงเทพฯ รูปแบบ ปี-เดือน-วันTชั่วโมง:นาที:วินาที.เศษวินาที ไม่เกิน 6 หลัก' : 'เวลากรุงเทพฯ UTC+07:00'}
        onChange={event => onChange(event.target.value)} className={field} />;
}

/** Mounted only after browser hydration and a verified Admin read. Storage is a
 * single queue per Admin, not per selected Sales; no second publication can hide it. */
export default function WorkScheduleForm({ snapshot, disabled = false, save, onSaved, onLockedChange, onRefreshRequired }: Props) {
    const actorId = snapshot.actor.userId;
    const [recovery] = useState(() => {
        try { return { input: readWorkSchedulePending(actorId), error: '' }; }
        catch { return { input: null, error: 'ตรวจคำขอตารางเวรค้างไม่ได้ กรุณาให้ Admin ตรวจสอบ ห้ามล้างข้อมูลแท็บหรือเริ่มคำขอใหม่' }; }
    });
    const raw = snapshot.calendar?.raw;
    const [draft] = useState(() => {
        const empty = { start: '', end: '', rows: [] as Row[], error: '' };
        // Recovery must not depend on rendering the current revision's dates.
        if (recovery.input || !raw) return empty;
        try { return { start: workScheduleToLocal(raw.coverage.startsAt), end: workScheduleToLocal(raw.coverage.endsAt),
            rows: raw.periods.map(row => ({ key: row.id, type: row.type, startsAt: workScheduleToLocal(row.startsAt), endsAt: workScheduleToLocal(row.endsAt) })), error: '' }; }
        catch { return { ...empty, error: 'วันเวลาเวรรุ่นนี้แสดงในช่องกรุงเทพฯ ไม่ได้ กรุณาให้ Admin ตรวจข้อมูลก่อนแก้ไข ไม่มีการปัดหรือเปลี่ยนเวลาให้เอง' }; }
    });
    const [start, setStart] = useState(draft.start);
    const [end, setEnd] = useState(draft.end);
    const [rows, setRows] = useState<Row[]>(draft.rows);
    const [reason, setReason] = useState('');
    const [complete, setComplete] = useState(false);
    const [pending, setPending] = useState(recovery.input);
    const pendingRef = useRef(recovery.input);
    const uncertain = useRef(!!recovery.input);
    const inFlight = useRef(false), confirmedRef = useRef(false), refreshRef = useRef(false);
    const mounted = useRef(true);
    const [busy, setBusy] = useState(false), [confirmed, setConfirmed] = useState(false);
    const [needsRefresh, setNeedsRefresh] = useState(false), [storageBlocked, setStorageBlocked] = useState(!!recovery.error || !!draft.error);
    const [error, setError] = useState(recovery.error || draft.error);
    const contextKey = JSON.stringify([snapshot, disabled]);
    const token = useMemo(() => ({ key: contextKey }), [contextKey]);
    const [preview, setPreview] = useState<{ input: WorkScheduleInput; token: typeof token; actualPeriods: number } | null>(null);
    const previewRef = useRef<typeof preview>(null);
    const reviewed = preview?.token === token ? preview : null;
    const admin = snapshot.actor.role === 'admin';
    const selected = snapshot.sales.find(sales => sales.userId === snapshot.selectedSalesUserId);
    const locked = !!pending || storageBlocked || busy || confirmed || needsRefresh;
    const frozen = disabled || locked || !admin;

    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    useEffect(() => { onLockedChange(locked); }, [locked, onLockedChange]);
    useEffect(() => {
        if (!pending && !busy && !storageBlocked) return;
        const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    }, [pending, busy, storageBlocked]);
    function invalidate() { previewRef.current = null; setPreview(null); setError(''); }
    function editRow(key: string, values: Partial<Row>) { invalidate(); setRows(previous => previous.map(row => row.key === key ? { ...row, ...values } : row)); }
    function review(event: FormEvent) {
        event.preventDefault();
        if (frozen || inFlight.current || pendingRef.current || confirmedRef.current || refreshRef.current || !selected) return;
        invalidate();
        try {
            const input = parseWorkScheduleInput({ requestId: crypto.randomUUID(), salesUserId: selected.userId,
                expectedVersion: raw?.version ?? null, coverage: { startsAt: workScheduleFromLocal(start), endsAt: workScheduleFromLocal(end) },
                periods: rows.map(row => ({ type: row.type, startsAt: workScheduleFromLocal(row.startsAt), endsAt: workScheduleFromLocal(row.endsAt) })),
                confirmedComplete: complete, reason });
            const prepared = prepareSlaWorkCalendar({ id: 'review', version: 'review', ownerUserId: selected.userId,
                coverage: { ...input.coverage, complete: true }, periods: input.periods.map((row, index) => ({ ...row, id: `row-${index}`, salesUserId: selected.userId })) });
            if (prepared.state !== 'ready') throw new Error('ข้อมูลเวรยังไม่พร้อม กรุณาตรวจช่วงเวลาและข้อมูลให้ครบ');
            const next = { input, token, actualPeriods: prepared.calendar.workPeriods.length };
            previewRef.current = next; setPreview(next);
        } catch (failure) { setError(failure instanceof Error ? failure.message : 'กรุณาตรวจข้อมูลเวรอีกครั้ง'); }
    }
    async function send() {
        if (disabled || !admin || inFlight.current || storageBlocked || confirmedRef.current || refreshRef.current) return;
        const input = pendingRef.current ?? (previewRef.current?.token === token ? previewRef.current.input : null);
        if (!input || (!pendingRef.current && input.salesUserId !== selected?.userId)) return;
        setError('');
        try { writeWorkSchedulePending(actorId, input); }
        catch { setStorageBlocked(true); setError('เก็บคำขอเดิมในแท็บไม่ได้ จึงยังไม่ส่งบันทึก กรุณาหยุดและตรวจข้อมูลแท็บ'); onLockedChange(true); return; }
        pendingRef.current = input; setPending(input); inFlight.current = true; setBusy(true); onLockedChange(true);
        let result: WorkScheduleResult;
        try { result = await save(input); confirmedRef.current = true; }
        catch (failure) {
            if (!mounted.current) return;
            setError(failure instanceof WorkScheduleApiError ? failure.message : 'ยังยืนยันผลบันทึกไม่ได้ ให้ส่งซ้ำเฉพาะคำขอเดิม ห้ามเริ่มใหม่');
            if (!uncertain.current && failure instanceof WorkScheduleApiError && failure.definitelyNotSaved) {
                try {
                    clearWorkSchedulePending(actorId, input.requestId); pendingRef.current = null; setPending(null);
                    previewRef.current = null; setPreview(null); refreshRef.current = true; setNeedsRefresh(true);
                } catch { uncertain.current = true; setStorageBlocked(true); setError('ตรวจ/ล้างคำขอที่ถูกปฏิเสธไม่ได้ ให้ Admin ตรวจรหัสคำขอ ห้ามเริ่มใหม่'); }
            } else uncertain.current = true;
            return;
        } finally { inFlight.current = false; if (mounted.current) setBusy(false); }
        if (!mounted.current) return;
        setConfirmed(true); previewRef.current = null; setPreview(null);
        try { clearWorkSchedulePending(actorId, input.requestId); pendingRef.current = null; setPending(null); }
        catch { setStorageBlocked(true); setError('ยืนยันว่าบันทึกสำเร็จแล้ว แต่ล้างคำขอในแท็บไม่ได้ ให้ Admin ตรวจรหัสก่อนทำรายการใหม่'); return; }
        // Never reinterpret a failed GET after a confirmed POST as a failed save.
        try { await onSaved(result); }
        catch { if (mounted.current) setError('บันทึกสำเร็จแล้ว แต่โหลดเวรล่าสุดไม่ได้ ไม่ต้องส่งบันทึกใหม่'); }
    }
    async function refresh() {
        if (disabled || inFlight.current || pendingRef.current || storageBlocked) return;
        inFlight.current = true; setBusy(true); onLockedChange(true);
        try { await onRefreshRequired(); }
        catch { if (mounted.current) setError('โหลดเวรล่าสุดไม่สำเร็จ ยังเริ่มรายการใหม่ไม่ได้'); }
        finally { inFlight.current = false; if (mounted.current) setBusy(false); }
    }

    return <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
        <h2 className="text-lg font-bold text-slate-900">ตารางเวรของ {selected?.displayName ?? pending?.salesUserId ?? snapshot.selectedSalesUserId ?? 'Sales'}</h2>
        {!admin && <p role="alert">เฉพาะ Admin เท่านั้นที่จัดเวรได้</p>}
        {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
        {pending && <section aria-label="คำขอตารางเวรค้าง" className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm">
            <p>ผลคำขอเดิมอาจสำเร็จแล้ว ห้ามแก้ข้อมูลหรือเปลี่ยน Sales เพื่อส่งคำขอใหม่</p>
            <p className="break-all">รหัสคำขอ: <code>{pending.requestId}</code></p>
            <p>Sales ตามคำขอเดิม: {snapshot.sales.find(person => person.userId === pending.salesUserId)?.displayName ?? pending.salesUserId}</p>
            <p>ช่วงข้อมูลเดิม: {displayBangkokTime(pending.coverage.startsAt)} ถึง {displayBangkokTime(pending.coverage.endsAt)}</p>
            <p>จำนวนช่วง: {pending.periods.length} · เหตุผล: {pending.reason}</p>
            {!confirmed && <button type="button" onClick={send} disabled={disabled || !admin || busy || storageBlocked} className="rounded-xl bg-amber-900 px-4 py-2 text-white disabled:opacity-40">{busy ? 'กำลังตรวจผล…' : 'ส่งคำขอตารางเวรเดิมซ้ำ'}</button>}
        </section>}
        {!pending && !confirmed && selected && admin && <form aria-label="จัดเวร Sales" onSubmit={review} className="space-y-4">
            <p className="text-sm text-slate-600">ระบุช่วงข้อมูลที่ตรวจครบ ช่วงสิ้นสุดไม่นับรวม ทุกเวลาเป็นกรุงเทพฯ (UTC+07:00) ไม่มีการตั้งเวรเริ่มต้นให้อัตโนมัติ</p>
            {raw && <p className="text-xs text-slate-500">รุ่นปัจจุบัน: {raw.version} · บันทึก {displayBangkokTime(snapshot.calendar!.publishedAt)}</p>}
            <fieldset disabled={frozen} className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                    <label className="text-sm">ช่วงข้อมูลเริ่มต้น *<ScheduleTimeInput value={start} onChange={value => { invalidate(); setStart(value); }} /></label>
                    <label className="text-sm">ช่วงข้อมูลสิ้นสุด (ไม่นับรวม) *<ScheduleTimeInput value={end} onChange={value => { invalidate(); setEnd(value); }} /></label>
                </div>
                <p className="text-xs text-slate-500">รองรับช่วงข้อมูลไม่เกิน 366 วัน และไม่เกิน 400 ช่วงต่อรุ่น เวลานอกช่วงที่ยืนยันยังถือว่าไม่ทราบ</p>
                <p className="text-xs text-slate-500">หากเวรเดิมมีเศษวินาทีเกิน 3 หลัก ช่องนั้นจะแสดงเป็นข้อความเวลาเต็ม เช่น 2026-09-16T09:00:00.123456 เพื่อรักษาเวลาต้นฉบับ</p>
                <div className="space-y-3">{rows.map((row, index) => <div key={row.key} className="grid gap-3 rounded-xl border border-slate-200 p-3 sm:grid-cols-2">
                    <label className="text-sm">ประเภทช่วงที่ {index + 1}<select className={field} value={row.type} onChange={event => editRow(row.key, { type: event.target.value as Row['type'] })}>{Object.entries(kinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                    <div className="flex items-end"><button type="button" onClick={() => { invalidate(); setRows(previous => previous.filter(item => item.key !== row.key)); }} className="text-sm text-rose-700 underline">นำช่วงที่ {index + 1} ออกจากฉบับร่าง</button></div>
                    <label className="text-sm">เริ่มช่วงที่ {index + 1} *<ScheduleTimeInput value={row.startsAt} onChange={value => editRow(row.key, { startsAt: value })} /></label>
                    <label className="text-sm">สิ้นสุดช่วงที่ {index + 1} *<ScheduleTimeInput value={row.endsAt} onChange={value => editRow(row.key, { endsAt: value })} /></label>
                </div>)}</div>
                {!rows.length && <p className="text-sm text-amber-900">ยังไม่มีช่วงเวลา หากยืนยันและบันทึก จะหมายถึงตรวจครบแล้วว่าไม่มีเวลาทำงานในช่วงข้อมูลนี้ ไม่ใช่ข้อมูลที่ยังไม่ได้กรอก</p>}
                <button type="button" disabled={rows.length >= 400} onClick={() => { invalidate(); setRows(previous => [...previous, { key: crypto.randomUUID(), type: 'work', startsAt: '', endsAt: '' }]); }} className="rounded-xl border border-blue-300 px-4 py-2 text-sm font-semibold text-blue-800">+ เพิ่มช่วงเวลา</button>
                <label className="block text-sm">เหตุผลการจัดหรือแก้ไขเวร *<input required className={field} value={reason} onChange={event => { invalidate(); setReason(event.target.value); }} /></label>
                <p className="text-xs text-slate-500">ไม่ใส่โรค เอกสารสุขภาพ หรือข้อมูลส่วนบุคคลที่ไม่จำเป็น หน้านี้บันทึกเฉพาะช่วงลาที่อนุมัติแล้ว ไม่ใช่ระบบอนุมัติลา</p>
                <label className="flex gap-3 text-sm"><input type="checkbox" required checked={complete} onChange={event => { invalidate(); setComplete(event.target.checked); }} />ยืนยันว่าข้อมูลเวลาทำงาน พัก และลาที่อนุมัติแล้วครบทั้งหมดในช่วงข้อมูลนี้</label>
            </fieldset>
            <button type="submit" disabled={frozen} className="rounded-xl bg-blue-700 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40">ตรวจทานตารางเวรก่อนบันทึก</button>
        </form>}
        {preview && !reviewed && !pending && <p role="status" className="text-sm text-amber-900">ข้อมูลหรือสถานะเปลี่ยน กรุณาตรวจทานตารางเวรใหม่</p>}
        {reviewed && !pending && !confirmed && <section aria-label="ตรวจทานตารางเวร" className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm">
            <h3 className="font-bold">ยืนยันตารางเวรทั้งชุดของ {selected?.displayName ?? reviewed.input.salesUserId}</h3>
            <p>{displayBangkokTime(reviewed.input.coverage.startsAt)} ถึง {displayBangkokTime(reviewed.input.coverage.endsAt)} (ไม่นับเวลาสิ้นสุด)</p>
            <p>{reviewed.input.periods.length} ช่วงที่กรอก · เหลือ {reviewed.actualPeriods} ช่วงทำงานหลังหักพัก/ลา</p>
            {reviewed.actualPeriods === 0 && <p className="font-semibold text-amber-950">ตารางนี้ไม่มีเวลาทำงานที่ใช้คำนวณ SLA ได้</p>}
            <p>บันทึกเป็นรุ่นใหม่แทนชุดปัจจุบันทั้งชุด ไม่ใช่เพิ่มเฉพาะบางวัน เก็บรุ่นเดิมไว้ ไม่ลบประวัติ ไม่คำนวณกำหนด SLA เดิมย้อนหลังหรือให้คะแนนใหม่อัตโนมัติ</p>
            <p>เหตุผล: {reviewed.input.reason}</p>
            <div className="flex flex-wrap gap-3"><button type="button" disabled={frozen} onClick={invalidate} className="rounded-xl border border-slate-300 bg-white px-4 py-2">กลับไปแก้ตาราง</button>
                <button type="button" disabled={frozen} onClick={send} className="rounded-xl bg-amber-900 px-4 py-2 font-semibold text-white disabled:opacity-40">ยืนยันบันทึกตารางเวรรุ่นใหม่</button></div>
        </section>}
        {confirmed && <p role="status" className="text-sm text-emerald-800">ยืนยันว่าบันทึกตารางเวรสำเร็จแล้ว ไม่ต้องส่งซ้ำแม้โหลดเวรล่าสุดไม่ได้</p>}
        {(needsRefresh || confirmed) && !pending && !storageBlocked && <button type="button" onClick={refresh} disabled={disabled || busy} className="text-sm font-semibold text-blue-700 underline">โหลดเวรล่าสุดก่อนทำรายการใหม่</button>}
    </section>;
}
