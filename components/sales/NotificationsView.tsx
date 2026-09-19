'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { notificationApi, NotificationClientError, type NotificationApi } from '@/lib/sales/notificationClient';
import type { NotificationSnapshot, SalesNotification } from '@/lib/sales/notificationContracts';

const readableError = (failure: unknown) => failure instanceof NotificationClientError
    ? failure.message : 'ตรวจสอบรายการไม่ได้ กรุณาลองโหลดใหม่';
const timeLabel = (value: string) => new Date(value).toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

export default function NotificationsView({ api = notificationApi }: { api?: NotificationApi }) {
    const [attempt, setAttempt] = useState(0);
    const [state, setState] = useState<{ attempt: number; data: NotificationSnapshot | null; error: unknown }>({ attempt: -1, data: null, error: null });
    useEffect(() => {
        let cancelled = false;
        void Promise.resolve().then(() => api.read(0)).then(data => {
            if (!cancelled) setState({ attempt, data, error: null });
        }).catch(error => { if (!cancelled) setState({ attempt, data: null, error }); });
        return () => { cancelled = true; };
    }, [api, attempt]);
    if (state.attempt !== attempt) return <main className="p-8"><p role="status">กำลังตรวจสิทธิ์และโหลดแจ้งเตือนของคุณ…</p></main>;
    if (!state.data) {
        const failure = state.error;
        const setup = failure instanceof NotificationClientError && ['FEATURE_DISABLED', 'SETUP_REQUIRED'].includes(failure.code);
        const login = failure instanceof NotificationClientError && failure.status === 401;
        return <main className="mx-auto max-w-3xl space-y-4 p-8"><h1 className="text-2xl font-bold">{setup ? 'ยังไม่เปิดระบบแจ้งเตือนฝ่ายขาย' : login ? 'เข้าสู่ระบบก่อนดูแจ้งเตือน' : 'ยังโหลดแจ้งเตือนไม่ได้'}</h1>
            <p role="alert">{readableError(failure)}</p>
            <p className="text-sm text-slate-600">ไม่มีการสร้างแจ้งเตือนหรือเปลี่ยนสิทธิ์จากการเปิดหน้านี้</p>
            <button type="button" onClick={() => setAttempt(value => value + 1)} className="text-blue-700 underline">ตรวจสิทธิ์อีกครั้ง</button>
            <Link href="/sales-crm" className="block text-blue-700 underline">กลับ Lead ส่วนกลาง</Link></main>;
    }
    return <NotificationSession key={`${state.data.actor.userId}:${attempt}`} initial={state.data} api={api} onReauthenticate={() => setAttempt(value => value + 1)} />;
}

function NotificationSession({ initial, api, onReauthenticate }: { initial: NotificationSnapshot; api: NotificationApi; onReauthenticate: () => void }) {
    const [snapshot, setSnapshot] = useState<NotificationSnapshot | null>(initial);
    const [page, setPage] = useState(initial.page);
    const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
    const [identityChanged, setIdentityChanged] = useState(false);
    const busyRef = useRef(false), alive = useRef(true), generation = useRef(0);
    const identityInvalid = useRef(false);
    const actor = initial.actor;
    useEffect(() => { alive.current = true; return () => { alive.current = false; generation.current += 1; }; }, []);
    const invalidateIdentity = useCallback(() => {
        if (!alive.current) return;
        identityInvalid.current = true; generation.current += 1; busyRef.current = false;
        setIdentityChanged(true); setSnapshot(null); setBusy(false); setNotice('');
        setError('บัญชีเปลี่ยนหรือยืนยันบัญชีไม่ได้ กรุณาตรวจบัญชีใหม่ ผลคำขอเดิมอาจถูกบันทึกแล้ว ห้ามถือว่าล้มเหลว');
    }, []);
    useEffect(() => api.watchActor?.(actor.userId, invalidateIdentity), [api, actor.userId, invalidateIdentity]);
    function assertScope(next: NotificationSnapshot, target: number) {
        if (next.actor.userId !== actor.userId || next.actor.role !== actor.role) throw new NotificationClientError('ACTOR_CHANGED', 'บัญชีหรือสิทธิ์เปลี่ยนไป', 409);
        if (next.page !== target) throw new Error('ขอบเขตเปลี่ยนไป');
    }
    async function load(target: number) {
        if (busyRef.current || identityInvalid.current || target < 0 || target > 1000) return;
        const request = ++generation.current;
        busyRef.current = true; setBusy(true); setSnapshot(null); setError(''); setPage(target);
        try {
            const next = await api.read(target);
            if (!alive.current || request !== generation.current) return;
            assertScope(next, target); setSnapshot(next);
        } catch (failure) {
            if (!alive.current || request !== generation.current) return;
            if (failure instanceof NotificationClientError && ['ACTOR_CHANGED', 'ACTOR_CHANGED_AFTER_REQUEST', 'SESSION_UNAVAILABLE'].includes(failure.code)) invalidateIdentity();
            else setError(readableError(failure));
        } finally { if (alive.current && request === generation.current) { busyRef.current = false; setBusy(false); } }
    }
    async function acknowledge(notification: SalesNotification) {
        if (busyRef.current || identityInvalid.current || !snapshot || notification.readAt !== null) return;
        const request = ++generation.current;
        busyRef.current = true; setBusy(true); setError(''); setNotice('');
        let saved = false;
        try {
            const result = await api.markRead({ notificationId: notification.id }, actor.userId);
            if (!alive.current || request !== generation.current) return;
            if (result.notificationId !== notification.id) throw new Error('ผลตอบกลับไม่ตรงรายการ');
            saved = true;
            setNotice('บันทึกว่าอ่านแล้วสำเร็จ ไม่ต้องส่งซ้ำ แม้โหลดรายการล่าสุดไม่ได้');
            setSnapshot(null);
            const next = await api.read(page);
            if (!alive.current || request !== generation.current) return;
            assertScope(next, page); setSnapshot(next);
        } catch (failure) {
            if (!alive.current || request !== generation.current) return;
            if (failure instanceof NotificationClientError && ['ACTOR_CHANGED', 'ACTOR_CHANGED_AFTER_REQUEST', 'SESSION_UNAVAILABLE'].includes(failure.code)) invalidateIdentity();
            else if (saved) setError(`อ่านแล้วถูกบันทึกแล้ว แต่โหลดรายการล่าสุดไม่ได้: ${readableError(failure)}`);
            else if (failure instanceof NotificationClientError && failure.definitelyNotSaved) {
                // A withdrawn/forbidden notice must not remain actionable from a stale snapshot.
                setSnapshot(null); setError(readableError(failure));
            } else setError('ยังยืนยันผลการกดอ่านแล้วไม่ได้ ลองรายการเดิมอีกครั้งหรือโหลดล่าสุดได้ โดยไม่เปลี่ยนงานติดตาม');
        } finally { if (alive.current && request === generation.current) { busyRef.current = false; setBusy(false); } }
    }
    return <main className="min-h-screen bg-slate-50 px-4 py-6 sm:px-8 sm:py-10"><div className="mx-auto max-w-5xl space-y-5">
        <header className="space-y-3">
            {busy ? <span className="text-sm text-slate-400" aria-disabled="true">← กลับ Lead ส่วนกลาง (กำลังตรวจรายการ)</span>
                : <Link href="/sales-crm" className="text-sm text-blue-700 hover:underline">← กลับ Lead ส่วนกลาง</Link>}
            <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-bold text-slate-900">การแจ้งเตือนของฉัน</h1>
                <button type="button" disabled={busy || identityChanged} onClick={() => { void load(0); }} className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-blue-700 disabled:opacity-40">โหลดล่าสุด</button></div>
            <p className="text-sm text-slate-600">เฉพาะรายการที่ส่งถึงคุณและยังเกี่ยวข้องกับงานปัจจุบัน · เวลาไทย</p>
            <p className="text-sm text-slate-600">“อ่านแล้ว” ไม่ใช่ทำงานสำเร็จ ต้องบันทึกการติดตามที่หน้างานตามจริง และไม่ใช้แจ้งเตือนนี้ตัดคะแนน KPI อัตโนมัติ</p>
        </header>
        {notice && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">{notice}</p>}
        {error && <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{error}</p>}
        {identityChanged && <button type="button" onClick={onReauthenticate} className="text-sm font-semibold text-blue-700 underline">ตรวจบัญชีใหม่</button>}
        {busy && <p role="status" className="text-sm text-slate-600">กำลังตรวจรายการล่าสุด…</p>}
        {snapshot && <>
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm"><p className="font-semibold text-slate-800">ยังไม่อ่าน {snapshot.unreadCount} รายการ (ทุกหน้า)</p>
                <p className="text-xs text-slate-500">ข้อมูล ณ {timeLabel(snapshot.asOf)}</p></div>
            {!snapshot.notifications.length && <section className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
                <h2 className="font-semibold text-slate-800">ไม่มีแจ้งเตือนที่แสดงได้ในหน้านี้</h2>
                <p className="mt-2 text-sm text-slate-500">ไม่ได้หมายความว่างานทั้งหมดเสร็จแล้ว งานที่ยังไม่มีเวรหรือกำหนดที่ตรวจสอบแล้วจะไม่สร้างแจ้งเตือนให้เอง</p></section>}
            <div className="space-y-3">{snapshot.notifications.map(notification => <article key={notification.id} aria-label={`แจ้งเตือน ${notification.customerName}`}
                className={`rounded-2xl border bg-white p-5 ${notification.readAt ? 'border-slate-200' : 'border-blue-200 shadow-sm'}`}>
                <div className="flex flex-wrap items-start justify-between gap-3"><div className="space-y-2">
                    <span className={`inline-block rounded-lg px-2 py-1 text-xs font-semibold ${notification.type === 'overdue' ? 'bg-amber-50 text-amber-900' : 'bg-blue-50 text-blue-800'}`}>
                        {notification.type === 'overdue' ? 'เกินกำหนด ณ ตอนแจ้งเตือน' : 'เตือนก่อนถึงกำหนด'}</span>
                    <h2 className="font-semibold text-slate-900">{notification.customerName}</h2>
                    <p className="text-sm text-slate-600">{notification.taskType === 'first_contact' ? 'ติดต่อลูกค้าครั้งแรก' : 'ติดตามลูกค้า'} · {notification.projectName ?? 'งานส่วนกลาง'}</p>
                </div><span className={`text-xs ${notification.readAt ? 'text-slate-500' : 'font-semibold text-blue-700'}`}>{notification.readAt ? 'อ่านแล้ว' : 'ยังไม่อ่าน'}</span></div>
                <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-xs text-slate-500">กำหนดรับผิดชอบของ Sales</dt><dd className="mt-1 text-slate-800">{timeLabel(notification.staffDueAt)}</dd></div>
                    <div><dt className="text-xs text-slate-500">กำหนดบริการลูกค้า</dt><dd className="mt-1 text-slate-800">{timeLabel(notification.serviceDueAt)}</dd></div></dl>
                <p className="mt-3 text-xs text-slate-500">แจ้งเมื่อ {timeLabel(notification.createdAt)}{notification.readAt ? ` · อ่านเมื่อ ${timeLabel(notification.readAt)}` : ''}</p>
                <div className="mt-4 flex flex-wrap items-center gap-4">
                    {busy ? <span aria-disabled="true" className="text-sm text-slate-400">เปิดงานติดตาม →</span>
                        : <Link href={`/sales-crm/${encodeURIComponent(notification.customerId)}${notification.interestId ? `?interestId=${encodeURIComponent(notification.interestId)}` : ''}`} prefetch={false}
                            className="text-sm font-semibold text-blue-700 hover:underline">เปิดงานติดตาม →</Link>}
                    {!notification.readAt && <button type="button" disabled={busy} onClick={() => { void acknowledge(notification); }}
                        className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-40">ทำเครื่องหมายว่าอ่านแล้ว</button>}
                </div>
            </article>)}</div>
        </>}
        <nav aria-label="หน้าแจ้งเตือน" className="flex items-center justify-between gap-3 border-t border-slate-200 pt-4 text-sm">
            <button type="button" disabled={busy || identityChanged || page === 0} onClick={() => { void load(page - 1); }} className="text-blue-700 disabled:opacity-30">← ก่อนหน้า</button>
            <span className="text-slate-500">หน้า {page + 1} · หน้าละ 50 รายการ</span>
            <button type="button" disabled={busy || !snapshot?.hasMore || page >= 1000} onClick={() => { void load(page + 1); }} className="text-blue-700 disabled:opacity-30">ถัดไป →</button>
        </nav>
        {page === 1000 && snapshot?.hasMore && <p className="text-sm text-amber-900">ถึงขีดจำกัดการเปิดรายการย้อนหลัง กรุณาให้ Admin ตรวจสอบ ไม่ได้แสดงประวัติทั้งหมด</p>}
        <p className="text-xs text-slate-500">รายการที่เปลี่ยนผู้ดูแล ปิดงาน หรืออ้างอิงเวรเก่าจะไม่แสดงเป็นงานปัจจุบัน หน้านี้ไม่สร้างหรือส่งแจ้งเตือนเอง</p>
    </div></main>;
}
