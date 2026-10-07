import React, { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: vi.fn() } } }));
import QueueMonitorView from '../QueueMonitorView';
import { QueueMonitorClientError, type QueueMonitorApi } from '@/lib/sales/queueMonitorClient';
import { QUEUE_MONITOR_CONTRACT_VERSION, type QueueDispatchRequest, type QueueMonitorSnapshot } from '@/lib/sales/queueMonitorContracts';

const ADMIN = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000002';
const REQUEST = '00000000-0000-4000-8000-000000000003';
const ATTEMPT = '00000000-0000-4000-8000-000000000004';
const AS_OF = '2026-09-23T03:06:00.000001Z';
function request(overrides: Partial<QueueDispatchRequest> = {}): QueueDispatchRequest {
    return { requestId: REQUEST, attemptId: ATTEMPT, attemptCount: 1, status: 'reserved', policyVersion: 'bounded_burst_v2',
        createdAt: '2026-09-23T03:00:00Z', preparedAt: '2026-09-23T03:00:00Z', nextAttemptAt: '2026-09-23T03:01:00Z',
        completedAt: null, receipt: null, lastErrorCode: null, ...overrides };
}
function completed(overrides: Partial<QueueDispatchRequest> = {}): QueueDispatchRequest {
    return request({ status: 'completed', completedAt: '2026-09-23T03:00:05Z', receipt: {
        startedAt: '2026-09-23T03:00:01Z', finishedAt: '2026-09-23T03:00:04Z', processedCount: 10,
        heldCount: 2, notifiedCount: 3, sweepFinished: false,
    }, ...overrides });
}
function snapshot(overrides: Partial<QueueMonitorSnapshot> = {}): QueueMonitorSnapshot {
    return { contractVersion: QUEUE_MONITOR_CONTRACT_VERSION, actor: { userId: ADMIN, role: 'admin' }, asOf: AS_OF,
        readOnly: true, targetSeconds: 300, deliveryLatencySeconds: null, sweepAgeSeconds: null,
        gates: { processing: true, cycle: true, worker: true, dispatcher: true, burst: true },
        candidates: { sampleCount: 895, exact: true, scanLimit: 901, storedHeldCount: 2, withoutStoredReviewCount: 3 },
        cursor: { afterCreatedAt: null, afterTaskId: null }, currentRequest: request(), ...overrides };
}
function deferred<T>() {
    let resolve!: (value: T) => void; let reject!: (failure: unknown) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject };
}
async function opened(api: QueueMonitorApi) {
    const result = render(<QueueMonitorView api={api} />);
    await screen.findByRole('heading', { name: 'ตรวจคิวแจ้งเตือนติดต่อครั้งแรก' });
    return result;
}
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('read-only Admin queue monitor', () => {
    it('only reads on open and explicit reload; does not process, retry, unlock or poll', async () => {
        const api = { read: vi.fn().mockResolvedValue(snapshot()), process: vi.fn(), retry: vi.fn(), unlock: vi.fn() };
        await opened(api);
        expect(api.read).toHaveBeenCalledExactlyOnceWith();
        expect(screen.getAllByRole('button').map(button => button.textContent)).toEqual(['โหลดล่าสุด']);
        vi.useFakeTimers();
        await act(async () => { vi.advanceTimersByTime(600_000); window.dispatchEvent(new Event('online')); document.dispatchEvent(new Event('visibilitychange')); });
        expect(api.read).toHaveBeenCalledTimes(1);
        expect(api.process).not.toHaveBeenCalled(); expect(api.retry).not.toHaveBeenCalled(); expect(api.unlock).not.toHaveBeenCalled();
        vi.useRealTimers(); fireEvent.click(screen.getByRole('button', { name: 'โหลดล่าสุด' }));
        await screen.findByText(REQUEST); expect(api.read).toHaveBeenLastCalledWith(ADMIN); expect(api.read).toHaveBeenCalledTimes(2);
    });
    it('shows server time, exact scoped workset and stored samples without latency claims', async () => {
        const { container } = await opened({ read: vi.fn().mockResolvedValue(snapshot()) });
        expect(container.querySelector('time')).toHaveAttribute('dateTime', AS_OF);
        expect(container.querySelector('time')).toHaveTextContent('10:06:00');
        expect(screen.getByText('จำนวนงานที่นับได้ครบ ณ รอบอ่านนี้')).toBeInTheDocument();
        expect(screen.getByText('895 งาน')).toBeInTheDocument();
        expect(screen.getByText('ผลเดิมรอตรวจ ในตัวอย่าง 895 งาน')).toBeInTheDocument();
        expect(screen.getByText(/ไม่ใช่จำนวนแจ้งเตือนค้างส่ง/)).toBeInTheDocument();
        expect(screen.getByText('ไม่ทราบ — ยังไม่ได้วัดครบเส้นทาง')).toBeInTheDocument();
        expect(screen.getByText(/ผลประเมินที่บันทึกไว้อาจเป็นผลเก่า/)).toBeInTheDocument();
        expect(screen.getByText(/ยังยืนยันเป้า 5 นาทีไม่ได้/)).toBeInTheDocument();
        expect(screen.queryByText(/ส่งสำเร็จทั้งหมด/)).not.toBeInTheDocument();
    });
    it('distinguishes truncated lower-bound counts from historical sample counts', async () => {
        await opened({ read: vi.fn().mockResolvedValue(snapshot({ candidates: { sampleCount: 901, exact: false, scanLimit: 901, storedHeldCount: 10, withoutStoredReviewCount: 20 } })) });
        expect(screen.getByText('อย่างน้อย 901 งาน')).toBeInTheDocument();
        expect(screen.getByText('จำนวนงานขั้นต่ำ (ยังนับไม่ครบ)')).toBeInTheDocument();
        expect(screen.getByText('ผลเดิมรอตรวจ ในตัวอย่าง 901 งาน')).toBeInTheDocument();
        expect(screen.getByText(/แสดงเพียงค่าขั้นต่ำและตัวอย่าง 901 งาน/)).toBeInTheDocument();
    });
    it('does not mistake zero candidates or no request for all Sales work being done', async () => {
        await opened({ read: vi.fn().mockResolvedValue(snapshot({ currentRequest: null, candidates: { sampleCount: 0, exact: true, scanLimit: 901, storedHeldCount: 0, withoutStoredReviewCount: 0 } })) });
        expect(screen.getByText(/ไม่พบงานในขอบเขตที่อ่าน ไม่ได้หมายความว่างานฝ่ายขายทั้งหมดเสร็จแล้ว/)).toBeInTheDocument();
        expect(screen.getByText(/ยังไม่มีคำขอที่บันทึกไว้.*ไม่ได้ยืนยันว่าคิวว่าง/)).toBeInTheDocument();
    });
    it('labels a reserved elapsed request as unknown/in-flight, with evidence IDs and no recovery command', async () => {
        await opened({ read: vi.fn().mockResolvedValue(snapshot()) });
        expect(screen.getByText('จองคำขอแล้ว — อาจกำลังทำ / ยังไม่ทราบผล')).toBeInTheDocument();
        expect(screen.getByText(/ห้ามสรุปว่าล้มเหลวหรือปลดล็อกเอง/)).toBeInTheDocument();
        expect(screen.getByText(REQUEST)).toBeInTheDocument(); expect(screen.getByText(ATTEMPT)).toBeInTheDocument();
        expect(screen.getByText('1 / 5 ครั้ง')).toBeInTheDocument();
        expect(screen.getByText(/อายุคำขอนี้ถึง 5 นาทีแล้ว.*ไม่ใช่เวลาส่งแจ้งเตือน/)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /ลองใหม่|ปลดล็อก|ประมวลผล/ })).not.toBeInTheDocument();
    });
    it('shows retry-wait and its safe error category without initiating retry', async () => {
        const api = { read: vi.fn().mockResolvedValue(snapshot({ currentRequest: request({ status: 'retry_wait', lastErrorCode: 'TRANSIENT_RETRY' }) })), retry: vi.fn() };
        await opened(api); expect(screen.getByText('รอลองใหม่ตามคำขอเดิม')).toBeInTheDocument();
        expect(screen.getByText(/คำขออยู่ในช่วงรอลองใหม่/)).toBeInTheDocument();
        expect(screen.getByText(/เหตุผลที่บันทึก:.*TRANSIENT_RETRY/)).toBeInTheDocument(); expect(api.retry).not.toHaveBeenCalled();
    });
    it.each(['RETRY_LIMIT', 'PROCESSING_REVIEW'] as const)('shows review status and %s without reset or replacement IDs', async lastErrorCode => {
        const { container } = await opened({ read: vi.fn().mockResolvedValue(snapshot({ currentRequest: request({ status: 'review', attemptCount: 5, lastErrorCode }) })) });
        expect(screen.getByText('หยุดรอตรวจหลักฐาน')).toBeInTheDocument();
        expect(container.querySelector('[data-warning="REVIEW_REQUIRED"]')).toBeInTheDocument();
        expect(container.querySelector('[data-warning="ATTEMPT_LIMIT"]')).toBeInTheDocument();
        expect(screen.getByText(/ไม่เปลี่ยนหมายเลขเพื่อเริ่มนับใหม่/)).toBeInTheDocument();
    });
    it.each([false, true])('restricts completed evidence to one committed cycle; sweepFinished=%s is not current backlog completion', async sweepFinished => {
        const cycle = completed(); cycle.receipt!.sweepFinished = sweepFinished;
        const { container } = await opened({ read: vi.fn().mockResolvedValue(snapshot({ currentRequest: cycle })) });
        expect(screen.getByText('ยืนยันผลแล้ว 1 รอบ — ไม่ใช่งานทั้งหมดเสร็จ')).toBeInTheDocument();
        expect(screen.getByText('ตรวจ 10 งาน · รอตรวจ 2 งาน · ผลประเมินระบุแจ้ง 3 งาน')).toBeInTheDocument();
        expect(screen.getByText(/ไม่รวมรายการเดิม ไม่ใช่หลักฐานว่าผู้ใช้เห็นจริง/)).toBeInTheDocument();
        expect(screen.getByText(/nextAttemptAt ไม่ใช่ตารางรันครั้งถัดไป/)).toBeInTheDocument();
        expect(screen.getByText(/ไม่ยืนยันสถานะงานที่เข้ามาภายหลัง/)).toBeInTheDocument();
        expect(container.querySelector('[data-warning="REQUEST_AGE_TARGET"]')).not.toBeInTheDocument();
        expect(container.querySelector('[data-warning="RESERVATION_ELAPSED"]')).not.toBeInTheDocument();
    });
    it('labels raw database switches as configuration, not a running scheduler', async () => {
        const { container } = await opened({ read: vi.fn().mockResolvedValue(snapshot({ gates: { processing: false, cycle: false, worker: false, dispatcher: false, burst: false } })) });
        expect(screen.getByText('สวิตช์ในฐานข้อมูลและข้อจำกัดของหลักฐาน')).toBeInTheDocument();
        expect(screen.getAllByText('ค่าปิด')).toHaveLength(5);
        expect(screen.getByText(/ไม่ยืนยันว่าตัวตั้งเวลา Cron หรือตัวประมวลผลกำลังทำงานจริง/)).toBeInTheDocument();
        expect(container.querySelector('[data-warning="WRITERS_DISABLED"]')).toBeInTheDocument();
        expect(container.querySelector('[data-warning="BURST_DISABLED"]')).toBeInTheDocument();
    });
    it('gives bounded read-only investigation guidance and safe internal navigation', async () => {
        await opened({ read: vi.fn().mockResolvedValue(snapshot()) });
        expect(screen.getByText(/ห้ามรีเซ็ต ลบ หรือเปลี่ยนหมายเลข/)).toBeInTheDocument();
        expect(screen.getByText(/วางวิธีแก้และวิธีย้อนกลับเพื่อขออนุมัติแยกต่างหาก/)).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'เปิดหน้าจำลองแผนจากหลักฐาน →' })).toHaveAttribute('href', '/sales-crm/sla-preview');
        expect(screen.getByRole('link', { name: 'เปิดหน้าตารางเวร →' })).toHaveAttribute('href', '/sales-crm/work-schedule');
        expect(screen.queryByRole('textbox')).not.toBeInTheDocument(); expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    });
    it.each(['FEATURE_DISABLED', 'SETUP_REQUIRED'])('shows initial %s as unavailable, never as an empty queue', async code => {
        const read = vi.fn().mockRejectedValue(new QueueMonitorClientError(code, 'ระบบยังไม่พร้อม', 503));
        render(<QueueMonitorView api={{ read }} />); await screen.findByRole('alert');
        expect(screen.getByRole('heading')).toHaveTextContent('ยังไม่เปิดหน้าตรวจคิว');
        expect(screen.queryByText('0 งาน')).not.toBeInTheDocument(); expect(read).toHaveBeenCalledTimes(1);
    });
    it('hides raw initial errors and rechecks only when explicitly requested', async () => {
        const read = vi.fn().mockRejectedValueOnce(new Error('PRIVATE_DATABASE_SECRET')).mockResolvedValueOnce(snapshot());
        render(<QueueMonitorView api={{ read }} />); await screen.findByRole('alert');
        expect(screen.queryByText(/PRIVATE_DATABASE_SECRET/)).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'ตรวจสิทธิ์อีกครั้ง' }));
        await screen.findByText(REQUEST); expect(read).toHaveBeenCalledTimes(2);
    });
    it.each(['actor', 'readOnly', 'candidateCount', 'latency'])('rejects a malformed initial %s without private evidence', async field => {
        const bad = snapshot();
        if (field === 'actor') (bad.actor as { role: string }).role = 'sales';
        if (field === 'readOnly') (bad as unknown as { readOnly: boolean }).readOnly = false;
        if (field === 'candidateCount') bad.candidates.sampleCount = 1000;
        if (field === 'latency') (bad as unknown as { deliveryLatencySeconds: number }).deliveryLatencySeconds = 1;
        render(<QueueMonitorView api={{ read: vi.fn().mockResolvedValue(bad) }} />);
        await screen.findByRole('alert'); expect(screen.queryByText(REQUEST)).not.toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: 'ชุดงานติดต่อครั้งแรกที่ยังเปิด' })).not.toBeInTheDocument();
    });
    it('serializes manual reads and removes old evidence while a slow read is pending', async () => {
        const response = deferred<QueueMonitorSnapshot>();
        const api = { read: vi.fn().mockResolvedValueOnce(snapshot()).mockReturnValueOnce(response.promise) };
        await opened(api); const reload = screen.getByRole('button', { name: 'โหลดล่าสุด' });
        fireEvent.click(reload); fireEvent.click(reload);
        expect(api.read).toHaveBeenCalledTimes(2); expect(reload).toBeDisabled();
        expect(screen.queryByText(REQUEST)).not.toBeInTheDocument();
        await act(async () => response.resolve(snapshot())); expect(screen.getByText(REQUEST)).toBeInTheDocument(); expect(reload).toBeEnabled();
    });
    it('redacts a failed refresh and allows only an explicit safe read retry', async () => {
        const read = vi.fn().mockResolvedValueOnce(snapshot()).mockRejectedValueOnce(new Error('PRIVATE_DATABASE_SECRET')).mockResolvedValueOnce(snapshot());
        await opened({ read }); fireEvent.click(screen.getByRole('button', { name: 'โหลดล่าสุด' }));
        await screen.findByRole('alert'); expect(screen.queryByText(REQUEST)).not.toBeInTheDocument();
        expect(screen.queryByText(/PRIVATE_DATABASE_SECRET/)).not.toBeInTheDocument();
        expect(screen.getByText(/ยังไม่มีผลตรวจล่าสุด ไม่ได้หมายความว่าคิวว่างหรือประมวลผลครบแล้ว/)).toBeInTheDocument();
        expect(read).toHaveBeenCalledTimes(2);
        fireEvent.click(screen.getByRole('button', { name: 'โหลดล่าสุด' })); await screen.findByText(REQUEST); expect(read).toHaveBeenCalledTimes(3);
    });
    it.each(['ACTOR_CHANGED', 'ACTOR_CHANGED_AFTER_REQUEST', 'SESSION_UNAVAILABLE', 'UNAUTHENTICATED', 'FORBIDDEN'])('freezes and redacts on %s until explicit identity recheck', async code => {
        const read = vi.fn().mockResolvedValueOnce(snapshot()).mockRejectedValueOnce(new QueueMonitorClientError(code, 'สิทธิ์ไม่พร้อม', 403)).mockResolvedValueOnce(snapshot({ actor: { userId: OTHER, role: 'admin' } }));
        await opened({ read }); fireEvent.click(screen.getByRole('button', { name: 'โหลดล่าสุด' }));
        await screen.findByRole('button', { name: 'ตรวจบัญชีใหม่' });
        expect(screen.queryByText(REQUEST)).not.toBeInTheDocument(); expect(screen.getByRole('button', { name: 'โหลดล่าสุด' })).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'ตรวจบัญชีใหม่' })); await screen.findByText(REQUEST);
        expect(read).toHaveBeenCalledTimes(3); expect(read).toHaveBeenLastCalledWith();
    });
    it.each(['FEATURE_DISABLED', 'SETUP_REQUIRED'])('freezes refresh after %s and supports explicit setup recheck', async code => {
        const read = vi.fn().mockResolvedValueOnce(snapshot()).mockRejectedValueOnce(new QueueMonitorClientError(code, 'ไม่พร้อม', 503)).mockResolvedValueOnce(snapshot());
        await opened({ read }); fireEvent.click(screen.getByRole('button', { name: 'โหลดล่าสุด' }));
        await screen.findByRole('button', { name: 'ตรวจสิทธิ์อีกครั้ง' }); expect(screen.queryByText(REQUEST)).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'โหลดล่าสุด' })).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'ตรวจสิทธิ์อีกครั้ง' })); await screen.findByText(REQUEST); expect(read).toHaveBeenCalledTimes(3);
    });
    it.each(['actor', 'role'])('rejects a changed %s in the refreshed response', async field => {
        const changed = snapshot({ actor: { userId: field === 'actor' ? OTHER : ADMIN, role: 'admin' } });
        if (field === 'role') (changed.actor as { role: string }).role = 'owner';
        const read = vi.fn().mockResolvedValueOnce(snapshot()).mockResolvedValueOnce(changed);
        await opened({ read }); fireEvent.click(screen.getByRole('button', { name: 'โหลดล่าสุด' }));
        await screen.findByRole('button', { name: 'ตรวจบัญชีใหม่' }); expect(screen.queryByText(REQUEST)).not.toBeInTheDocument();
    });
    it('rejects malformed refreshed evidence instead of retaining the old snapshot', async () => {
        const bad = snapshot(); bad.candidates.storedHeldCount = 900;
        await opened({ read: vi.fn().mockResolvedValueOnce(snapshot()).mockResolvedValueOnce(bad) });
        fireEvent.click(screen.getByRole('button', { name: 'โหลดล่าสุด' })); await screen.findByRole('alert');
        expect(screen.queryByText(REQUEST)).not.toBeInTheDocument(); expect(screen.queryByText('900 งาน')).not.toBeInTheDocument();
    });
    it('redacts on auth events immediately and ignores late old-actor reads', async () => {
        let invalidate!: () => void; const unsubscribe = vi.fn(); const response = deferred<QueueMonitorSnapshot>();
        const api = { read: vi.fn().mockResolvedValueOnce(snapshot()).mockReturnValueOnce(response.promise),
            watchActor: vi.fn((_id: string, callback: () => void) => { invalidate = callback; return unsubscribe; }) };
        const { unmount } = await opened(api); await waitFor(() => expect(api.watchActor).toHaveBeenCalledWith(ADMIN, expect.any(Function)));
        fireEvent.click(screen.getByRole('button', { name: 'โหลดล่าสุด' })); act(() => invalidate());
        await act(async () => response.resolve(snapshot())); expect(screen.queryByText(REQUEST)).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'ตรวจบัญชีใหม่' })).toBeEnabled();
        expect(api.read).toHaveBeenCalledTimes(2); unmount(); expect(unsubscribe).toHaveBeenCalledOnce();
    });
    it('redacts established evidence immediately on API replacement and ignores old refresh completion', async () => {
        const oldRead = deferred<QueueMonitorSnapshot>(), newRead = deferred<QueueMonitorSnapshot>();
        const oldApi = { read: vi.fn().mockResolvedValueOnce(snapshot()).mockReturnValueOnce(oldRead.promise) };
        const newApi = { read: vi.fn().mockReturnValueOnce(newRead.promise) };
        const { rerender } = await opened(oldApi); fireEvent.click(screen.getByRole('button', { name: 'โหลดล่าสุด' }));
        rerender(<QueueMonitorView api={newApi} />); expect(screen.queryByText(REQUEST)).not.toBeInTheDocument();
        await act(async () => oldRead.resolve(snapshot())); expect(screen.queryByText(REQUEST)).not.toBeInTheDocument();
        await act(async () => newRead.resolve(snapshot({ currentRequest: request({ requestId: OTHER }) })));
        expect(screen.getByText(OTHER)).toBeInTheDocument(); expect(screen.queryByText(REQUEST)).not.toBeInTheDocument();
    });
    it('ignores a stale initial request when the API changes', async () => {
        const response = deferred<QueueMonitorSnapshot>();
        const oldApi = { read: vi.fn().mockReturnValue(response.promise) };
        const nextApi = { read: vi.fn().mockResolvedValue(snapshot({ currentRequest: null })) };
        const { rerender } = render(<QueueMonitorView api={oldApi} />); await waitFor(() => expect(oldApi.read).toHaveBeenCalledOnce());
        rerender(<QueueMonitorView api={nextApi} />); await screen.findByText(/ยังไม่มีคำขอที่บันทึกไว้ในสถานะปัจจุบัน/);
        await act(async () => response.resolve(snapshot())); expect(screen.queryByText(REQUEST)).not.toBeInTheDocument();
    });
    it('does not update or re-read after unmount during refresh', async () => {
        const response = deferred<QueueMonitorSnapshot>(); const unsubscribe = vi.fn();
        const api = { read: vi.fn().mockResolvedValueOnce(snapshot()).mockReturnValueOnce(response.promise), watchActor: vi.fn(() => unsubscribe) };
        const { unmount } = await opened(api); fireEvent.click(screen.getByRole('button', { name: 'โหลดล่าสุด' })); unmount();
        await act(async () => response.resolve(snapshot())); expect(api.read).toHaveBeenCalledTimes(2); expect(unsubscribe).toHaveBeenCalledOnce();
    });
    it('has no background read after StrictMode settles', async () => {
        const api = { read: vi.fn().mockResolvedValue(snapshot()) };
        render(<StrictMode><QueueMonitorView api={api} /></StrictMode>); await screen.findByText(REQUEST);
        const reads = api.read.mock.calls.length; vi.useFakeTimers();
        await act(async () => vi.advanceTimersByTime(600_000)); expect(api.read).toHaveBeenCalledTimes(reads);
    });
});
