import React, { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: vi.fn() } } }));
import NotificationsView from '../NotificationsView';
import { NOTIFICATION_REFRESH_DELAY_MS } from '../useNotificationRefresh';
import { NotificationClientError, type NotificationApi } from '@/lib/sales/notificationClient';
import type { NotificationSnapshot, SalesNotification } from '@/lib/sales/notificationContracts';

const USER = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000002';
const NOTICE = '00000000-0000-4000-8000-000000000003';
const NOW = '2026-09-23T03:00:00.000001Z';
const READ = '2026-09-23T03:01:00.000002Z';
function notice(overrides: Partial<SalesNotification> = {}): SalesNotification {
    return { id: NOTICE, taskId: '00000000-0000-4000-8000-000000000006', customerId: '00000000-0000-4000-8000-000000000004',
        interestId: null, customerName: 'ลูกค้าทดสอบ', projectName: null, taskType: 'first_contact', type: 'due_soon',
        availableAt: NOW, createdAt: NOW, readAt: null, staffDueAt: '2026-09-23T03:30:00Z', serviceDueAt: '2026-09-24T03:00:00Z', ...overrides };
}
function snapshot(overrides: Partial<NotificationSnapshot> = {}): NotificationSnapshot {
    return { actor: { userId: USER, role: 'sales' }, asOf: NOW, page: 0, pageSize: 50, hasMore: false,
        unreadCount: 1, notifications: [notice()], ...overrides };
}
function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
let visibility: DocumentVisibilityState, online: boolean;
beforeEach(() => {
    vi.useFakeTimers(); visibility = 'visible'; online = true;
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
    vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online);
});
afterEach(() => { cleanup(); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });
const advance = async (ms = NOTIFICATION_REFRESH_DELAY_MS) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
const changeVisibility = (value: DocumentVisibilityState) => act(() => { visibility = value; fireEvent(document, new Event('visibilitychange')); });
const changeConnection = (value: boolean) => act(() => { online = value; fireEvent(window, new Event(value ? 'online' : 'offline')); });
async function mount(api: NotificationApi, strict = false) {
    let view!: ReturnType<typeof render>;
    await act(async () => { view = render(strict ? <StrictMode><NotificationsView api={api} /></StrictMode> : <NotificationsView api={api} />); });
    return view;
}

describe('foreground automatic inbox reads', () => {
    it('waits15s after opening, renders new notices and keeps recurring after fast batched reads without POST', async () => {
        const read = vi.fn().mockResolvedValueOnce(snapshot()).mockResolvedValue(snapshot({ unreadCount: 2,
            notifications: [notice(), notice({ id: OTHER, customerName: 'รายการใหม่' })] }));
        const api = { read, markRead: vi.fn() };
        await mount(api);
        await advance(14_999); expect(read).toHaveBeenCalledExactlyOnceWith(0);
        await advance(1); expect(screen.getByText('รายการใหม่')).toBeInTheDocument();
        expect(read).toHaveBeenCalledTimes(2);
        await advance(); await advance();
        expect(read).toHaveBeenCalledTimes(4); expect(api.markRead).not.toHaveBeenCalled();
    });
    it('retains the current page and refreshes unread totals; only manual latest jumps to page zero', async () => {
        const api = { read: vi.fn(async (page = 0) => snapshot({ page, hasMore: page === 0, unreadCount: page ? 7 : 1 })), markRead: vi.fn() };
        await mount(api);
        await act(async () => fireEvent.click(screen.getByRole('button', { name: 'ถัดไป →' })));
        await advance();
        expect(api.read.mock.calls).toEqual([[0], [1], [1]]);
        expect(screen.getByText('หน้า 2 · หน้าละ 50 รายการ')).toBeInTheDocument();
        expect(screen.getByText('ยังไม่อ่าน 7 รายการ (ทุกหน้า)')).toBeInTheDocument();
        await act(async () => fireEvent.click(screen.getByRole('button', { name: 'โหลดล่าสุด' })));
        expect(api.read).toHaveBeenLastCalledWith(0);
    });
    it.each(['hidden', 'offline'] as const)('pauses when%s and coalesces resume events into one immediate GET', async pause => {
        const api = { read: vi.fn().mockResolvedValue(snapshot()), markRead: vi.fn() };
        await mount(api);
        if (pause === 'hidden') changeVisibility('hidden'); else changeConnection(false);
        await advance(120_000); expect(api.read).toHaveBeenCalledTimes(1);
        if (pause === 'offline') {
            expect(screen.getByText(/ออฟไลน์ —/)).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'ทำเครื่องหมายว่าอ่านแล้ว' })).toBeDisabled();
            fireEvent.click(screen.getByRole('button', { name: 'โหลดล่าสุด' }));
            expect(api.read).toHaveBeenCalledTimes(1);
        }
        changeVisibility('visible'); changeConnection(true);
        fireEvent(document, new Event('visibilitychange')); fireEvent(window, new Event('online'));
        await advance(0); expect(api.read).toHaveBeenCalledTimes(2);
        await advance(14_999); expect(api.read).toHaveBeenCalledTimes(2);
        await advance(1); expect(api.read).toHaveBeenCalledTimes(3);
    });
    it('requires both visible and online before resuming', async () => {
        const api = { read: vi.fn().mockResolvedValue(snapshot()), markRead: vi.fn() };
        await mount(api); changeVisibility('hidden'); changeConnection(false);
        changeConnection(true); await advance(30_000); expect(api.read).toHaveBeenCalledTimes(1);
        changeVisibility('visible'); await advance(0); expect(api.read).toHaveBeenCalledTimes(2);
    });
    it('does not spawn an extra initial read when first mounted while hidden', async () => {
        visibility = 'hidden';
        const api = { read: vi.fn().mockResolvedValue(snapshot()), markRead: vi.fn() };
        await mount(api); await advance(60_000); expect(api.read).toHaveBeenCalledTimes(1);
        changeVisibility('visible'); await advance(0); expect(api.read).toHaveBeenCalledTimes(2);
    });
    it('does not overlap a slow GET with ticks/manual reads/writes and waits15s after settlement', async () => {
        const response = deferred<NotificationSnapshot>();
        const api = { read: vi.fn().mockResolvedValueOnce(snapshot()).mockReturnValueOnce(response.promise).mockResolvedValue(snapshot()), markRead: vi.fn() };
        await mount(api); await advance();
        expect(screen.getByText('ลูกค้าทดสอบ')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'โหลดล่าสุด' })).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'โหลดล่าสุด' }));
        fireEvent.click(screen.getByRole('button', { name: 'ทำเครื่องหมายว่าอ่านแล้ว' }));
        await advance(60_000); expect(api.read).toHaveBeenCalledTimes(2); expect(api.markRead).not.toHaveBeenCalled();
        await act(async () => response.resolve(snapshot()));
        await advance(14_999); expect(api.read).toHaveBeenCalledTimes(2);
        await advance(1); expect(api.read).toHaveBeenCalledTimes(3);
    });
    it('defers a visibility resume during a slow GET then performs just one fresh read', async () => {
        const response = deferred<NotificationSnapshot>();
        const api = { read: vi.fn().mockResolvedValueOnce(snapshot()).mockReturnValueOnce(response.promise).mockResolvedValue(snapshot()), markRead: vi.fn() };
        await mount(api); await advance(); changeVisibility('hidden'); changeVisibility('visible');
        await advance(30_000); expect(api.read).toHaveBeenCalledTimes(2);
        await act(async () => response.resolve(snapshot())); await advance(0);
        expect(api.read).toHaveBeenCalledTimes(3); await advance(0); expect(api.read).toHaveBeenCalledTimes(3);
    });
    it('preserves keyboard focus on read-only navigation during a background refresh', async () => {
        const response = deferred<NotificationSnapshot>();
        const api = { read: vi.fn().mockResolvedValueOnce(snapshot()).mockReturnValueOnce(response.promise), markRead: vi.fn() };
        const view = await mount(api);
        const link = screen.getByRole('link', { name: 'เปิดงานติดตาม →' }); link.focus();
        await advance(); expect(link).toHaveFocus(); expect(link).toBeInTheDocument();
        view.unmount(); await act(async () => response.resolve(snapshot()));
        await advance(60_000); expect(api.read).toHaveBeenCalledTimes(2);
    });
});

describe('automatic refresh authority and failure boundaries', () => {
    it.each(['ACTOR_CHANGED', 'ACTOR_CHANGED_AFTER_REQUEST', 'SESSION_UNAVAILABLE', 'UNAUTHENTICATED', 'FORBIDDEN', 'SETUP_REQUIRED', 'FEATURE_DISABLED'])(
        'redacts and stops on%s until explicit recheck', async code => {
            const api = { read: vi.fn().mockResolvedValueOnce(snapshot()).mockRejectedValue(new NotificationClientError(code, 'ตรวจสิทธิ์ใหม่', 503)), markRead: vi.fn() };
            await mount(api); await advance();
            expect(screen.queryByRole('article')).not.toBeInTheDocument(); expect(screen.getByRole('alert')).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'โหลดล่าสุด' })).toBeDisabled();
            await advance(120_000); changeVisibility('hidden'); changeVisibility('visible'); await advance(0);
            expect(api.read).toHaveBeenCalledTimes(2); expect(api.markRead).not.toHaveBeenCalled();
        });
    it.each(['actor', 'role', 'page', 'malformed'])('rejects automatic%s mismatch without displaying its content', async mismatch => {
        const wrong = mismatch === 'malformed' ? null : snapshot({
            actor: { userId: mismatch === 'actor' ? OTHER : USER, role: mismatch === 'role' ? 'admin' : 'sales' },
            page: mismatch === 'page' ? 1 : 0, notifications: [notice({ customerName: 'ข้อมูลผิดขอบเขต' })],
        });
        const api = { read: vi.fn().mockResolvedValueOnce(snapshot()).mockResolvedValue(wrong), markRead: vi.fn() };
        await mount(api); await advance();
        expect(screen.queryByRole('article')).not.toBeInTheDocument(); expect(screen.queryByText('ข้อมูลผิดขอบเขต')).not.toBeInTheDocument();
        expect(screen.getByRole('alert')).toBeInTheDocument();
        if (mismatch === 'actor' || mismatch === 'role') { await advance(30_000); expect(api.read).toHaveBeenCalledTimes(2); }
    });
    it('redacts a temporary read failure and recovers later without an empty-inbox claim or POST', async () => {
        const api = { read: vi.fn().mockResolvedValueOnce(snapshot()).mockRejectedValueOnce(new Error('PRIVATE'))
            .mockResolvedValue(snapshot({ notifications: [notice({ customerName: 'ข้อมูลล่าสุด' })] })), markRead: vi.fn() };
        await mount(api); await advance();
        expect(screen.queryByRole('article')).not.toBeInTheDocument(); expect(screen.getByRole('alert')).toHaveTextContent('ยังอัปเดตรายการล่าสุดไม่ได้');
        expect(screen.queryByText(/ไม่มีแจ้งเตือนที่แสดงได้/)).not.toBeInTheDocument(); expect(screen.queryByText(/PRIVATE/)).not.toBeInTheDocument();
        await advance(); expect(screen.getByText('ข้อมูลล่าสุด')).toBeInTheDocument(); expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(api.markRead).not.toHaveBeenCalled();
    });
    it('invalidates immediately during auto GET, ignores late data and unsubscribes on exit', async () => {
        let invalidate!: () => void;
        const response = deferred<NotificationSnapshot>(), unsubscribe = vi.fn();
        const api = { read: vi.fn().mockResolvedValueOnce(snapshot()).mockReturnValueOnce(response.promise), markRead: vi.fn(),
            watchActor: (_id: string, fn: () => void) => { invalidate = fn; return unsubscribe; } };
        const view = await mount(api); await advance(); act(() => invalidate());
        expect(screen.queryByRole('article')).not.toBeInTheDocument();
        await act(async () => response.resolve(snapshot())); await advance(120_000);
        expect(api.read).toHaveBeenCalledTimes(2); expect(screen.queryByRole('article')).not.toBeInTheDocument();
        view.unmount(); expect(unsubscribe).toHaveBeenCalledTimes(1);
    });
    it('does not poll an initial failed/disabled inbox without explicit recheck', async () => {
        const api = { read: vi.fn().mockRejectedValue(new NotificationClientError('FEATURE_DISABLED', 'ยังปิดอยู่', 503)), markRead: vi.fn() };
        await mount(api); await advance(120_000); expect(api.read).toHaveBeenCalledTimes(1);
        expect(screen.getByRole('heading', { name: 'ยังไม่เปิดระบบแจ้งเตือนฝ่ายขาย' })).toBeInTheDocument();
    });
    it('redacts an established inbox on API replacement and ignores its outstanding read', async () => {
        const old = deferred<NotificationSnapshot>(), next = deferred<NotificationSnapshot>();
        const oldApi = { read: vi.fn().mockResolvedValueOnce(snapshot()).mockReturnValueOnce(old.promise), markRead: vi.fn() };
        const nextApi = { read: vi.fn().mockReturnValueOnce(next.promise).mockResolvedValue(snapshot({ notifications: [notice({ customerName: 'ใหม่' })] })), markRead: vi.fn() };
        const view = await mount(oldApi); await advance();
        await act(async () => view.rerender(<NotificationsView api={nextApi} />));
        expect(screen.queryByRole('article')).not.toBeInTheDocument();
        await act(async () => old.resolve(snapshot({ notifications: [notice({ customerName: 'เก่า' })] })));
        expect(screen.queryByRole('article')).not.toBeInTheDocument();
        await act(async () => next.resolve(snapshot({ notifications: [notice({ customerName: 'ใหม่' })] })));
        await advance(); expect(screen.getByText('ใหม่')).toBeInTheDocument(); expect(screen.queryByText('เก่า')).not.toBeInTheDocument();
        expect(oldApi.read).toHaveBeenCalledTimes(2); expect(nextApi.read).toHaveBeenCalledTimes(2);
    });
    it('keeps a single live polling chain in StrictMode and none after unmount', async () => {
        const api = { read: vi.fn().mockResolvedValue(snapshot()), markRead: vi.fn() };
        const view = await mount(api, true), initialCalls = api.read.mock.calls.length;
        await advance(); expect(api.read).toHaveBeenCalledTimes(initialCalls + 1);
        await advance(); expect(api.read).toHaveBeenCalledTimes(initialCalls + 2);
        view.unmount(); await advance(120_000); expect(api.read).toHaveBeenCalledTimes(initialCalls + 2);
        expect(vi.getTimerCount()).toBe(0);
    });
    it.each(['FORBIDDEN', 'SETUP_REQUIRED'])('can restart%s only through an explicit fresh-scope check', async code => {
        const api = { read: vi.fn().mockResolvedValueOnce(snapshot()).mockRejectedValueOnce(new NotificationClientError(code, 'ตรวจใหม่', 503))
            .mockResolvedValue(snapshot()), markRead: vi.fn() };
        await mount(api); await advance();
        await act(async () => fireEvent.click(screen.getByRole('button', { name: code === 'FORBIDDEN' ? 'ตรวจบัญชีใหม่' : 'ตรวจสิทธิ์อีกครั้ง' })));
        expect(api.read).toHaveBeenCalledTimes(3); expect(screen.getByText('ลูกค้าทดสอบ')).toBeInTheDocument();
        await advance(); expect(api.read).toHaveBeenCalledTimes(4); expect(api.markRead).not.toHaveBeenCalled();
    });
});

describe('polling never retries acknowledgments or changes their known outcome', () => {
    it('shares the lock throughout POST and post-ack GET, even across many ticks', async () => {
        const post = deferred<{ notificationId: string; readAt: string }>(), get = deferred<NotificationSnapshot>();
        const api = { read: vi.fn().mockResolvedValueOnce(snapshot()).mockReturnValueOnce(get.promise).mockResolvedValue(snapshot()), markRead: vi.fn().mockReturnValue(post.promise) };
        await mount(api); fireEvent.click(screen.getByRole('button', { name: 'ทำเครื่องหมายว่าอ่านแล้ว' }));
        await advance(60_000); expect(api.read).toHaveBeenCalledTimes(1); expect(api.markRead).toHaveBeenCalledTimes(1);
        await act(async () => post.resolve({ notificationId: NOTICE, readAt: READ }));
        await advance(60_000); expect(api.read).toHaveBeenCalledTimes(2);
        await act(async () => get.resolve(snapshot({ notifications: [notice({ readAt: READ })] })));
        await advance(); expect(api.read).toHaveBeenCalledTimes(3); expect(api.markRead).toHaveBeenCalledTimes(1);
    });
    it('keeps an uncertain-write warning after a successful automatic GET and never replays POST', async () => {
        const api = { read: vi.fn().mockResolvedValue(snapshot()), markRead: vi.fn().mockRejectedValue(new Error('lost response')) };
        await mount(api); await act(async () => fireEvent.click(screen.getByRole('button', { name: 'ทำเครื่องหมายว่าอ่านแล้ว' })));
        await advance(45_000); expect(api.markRead).toHaveBeenCalledExactlyOnceWith({ notificationId: NOTICE }, USER);
        expect(api.read.mock.calls.length).toBeGreaterThan(1); expect(screen.getByRole('alert')).toHaveTextContent('ยังยืนยันผลการกดอ่านแล้วไม่ได้');
    });
    it('preserves known acknowledgment success across failed refresh and automatic recovery', async () => {
        const api = { read: vi.fn().mockResolvedValueOnce(snapshot()).mockRejectedValueOnce(new Error('network'))
            .mockResolvedValue(snapshot({ notifications: [notice({ readAt: READ })] })), markRead: vi.fn().mockResolvedValue({ notificationId: NOTICE, readAt: READ }) };
        await mount(api); await act(async () => fireEvent.click(screen.getByRole('button', { name: 'ทำเครื่องหมายว่าอ่านแล้ว' })));
        await advance(); expect(screen.getByText('บันทึกว่าอ่านแล้วสำเร็จ ไม่ต้องส่งซ้ำ แม้โหลดรายการล่าสุดไม่ได้')).toBeInTheDocument();
        expect(api.markRead).toHaveBeenCalledTimes(1); expect(screen.queryByRole('button', { name: 'ทำเครื่องหมายว่าอ่านแล้ว' })).not.toBeInTheDocument();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
    it('preserves known success when feature is disabled during post-ack read, then pauses', async () => {
        const api = { read: vi.fn().mockResolvedValueOnce(snapshot()).mockRejectedValue(new NotificationClientError('FEATURE_DISABLED', 'ปิดระบบ', 503)),
            markRead: vi.fn().mockResolvedValue({ notificationId: NOTICE, readAt: READ }) };
        await mount(api); await act(async () => fireEvent.click(screen.getByRole('button', { name: 'ทำเครื่องหมายว่าอ่านแล้ว' })));
        await advance(120_000); expect(api.read).toHaveBeenCalledTimes(2); expect(api.markRead).toHaveBeenCalledTimes(1);
        expect(screen.getByText('บันทึกว่าอ่านแล้วสำเร็จ ไม่ต้องส่งซ้ำ แม้โหลดรายการล่าสุดไม่ได้')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'ตรวจสิทธิ์อีกครั้ง' })).toBeEnabled();
    });
    it('coalesces resume events during POST without interrupting its result or overlapping its GET', async () => {
        const post = deferred<{ notificationId: string; readAt: string }>(), get = deferred<NotificationSnapshot>();
        const api = { read: vi.fn().mockResolvedValueOnce(snapshot()).mockReturnValueOnce(get.promise).mockResolvedValue(snapshot({ notifications: [notice({ readAt: READ })] })),
            markRead: vi.fn().mockReturnValue(post.promise) };
        await mount(api); fireEvent.click(screen.getByRole('button', { name: 'ทำเครื่องหมายว่าอ่านแล้ว' }));
        changeVisibility('hidden'); changeConnection(false); changeVisibility('visible'); changeConnection(true);
        await advance(30_000); expect(api.read).toHaveBeenCalledTimes(1);
        await act(async () => post.resolve({ notificationId: NOTICE, readAt: READ }));
        await advance(30_000); expect(api.read).toHaveBeenCalledTimes(2);
        await act(async () => get.resolve(snapshot({ notifications: [notice({ readAt: READ })] }))); await advance(0);
        expect(api.read).toHaveBeenCalledTimes(3); expect(api.markRead).toHaveBeenCalledTimes(1);
        expect(screen.getByText('บันทึกว่าอ่านแล้วสำเร็จ ไม่ต้องส่งซ้ำ แม้โหลดรายการล่าสุดไม่ได้')).toBeInTheDocument();
    });
    it('lets a user-started acknowledgment finish its read-back while hidden, without starting automatic polling', async () => {
        const post = deferred<{ notificationId: string; readAt: string }>();
        const api = { read: vi.fn().mockResolvedValue(snapshot()), markRead: vi.fn().mockReturnValue(post.promise) };
        await mount(api); fireEvent.click(screen.getByRole('button', { name: 'ทำเครื่องหมายว่าอ่านแล้ว' })); changeVisibility('hidden');
        await act(async () => post.resolve({ notificationId: NOTICE, readAt: READ }));
        await advance(60_000); expect(api.read).toHaveBeenCalledTimes(2); expect(api.markRead).toHaveBeenCalledTimes(1);
    });
});
