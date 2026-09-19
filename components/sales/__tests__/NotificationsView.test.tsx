import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: vi.fn() } } }));
import NotificationsView from '../NotificationsView';
import { NotificationClientError } from '@/lib/sales/notificationClient';
import type { NotificationSnapshot, SalesNotification } from '@/lib/sales/notificationContracts';

const USER = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000002';
const NOTICE = '00000000-0000-4000-8000-000000000003';
const CUSTOMER = '00000000-0000-4000-8000-000000000004';
const INTEREST = '00000000-0000-4000-8000-000000000005';
const NOW = '2026-09-17T03:00:00.000001Z';
const READ = '2026-09-17T03:01:00.000002Z';
function notification(overrides: Partial<SalesNotification> = {}): SalesNotification {
    return { id: NOTICE, taskId: '00000000-0000-4000-8000-000000000006', customerId: CUSTOMER, interestId: null,
        customerName: 'ลูกค้าทดสอบ', projectName: null, taskType: 'first_contact', type: 'due_soon',
        availableAt: NOW, createdAt: NOW, readAt: null, staffDueAt: '2026-09-17T03:30:00Z', serviceDueAt: '2026-09-18T03:00:00Z', ...overrides };
}
function snapshot(overrides: Partial<NotificationSnapshot> = {}): NotificationSnapshot {
    return { actor: { userId: USER, role: 'sales' }, asOf: NOW, page: 0, pageSize: 50, hasMore: false, unreadCount: 1, notifications: [notification()], ...overrides };
}
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
afterEach(cleanup);

describe('own-recipient inbox', () => {
    it('reads only page zero on open, never marks read automatically or polls', async () => {
        const api = { read: vi.fn().mockResolvedValue(snapshot()), markRead: vi.fn() };
        render(<NotificationsView api={api} />);
        await screen.findByRole('heading', { name: 'การแจ้งเตือนของฉัน' });
        expect(api.read).toHaveBeenCalledExactlyOnceWith(0); expect(api.markRead).not.toHaveBeenCalled();
        expect(screen.getByText('ยังไม่อ่าน 1 รายการ (ทุกหน้า)')).toBeInTheDocument();
        expect(screen.getByText(/“อ่านแล้ว” ไม่ใช่ทำงานสำเร็จ/)).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'เปิดงานติดตาม →' })).toHaveAttribute('href', `/sales-crm/${CUSTOMER}`);
        expect(screen.getByText('ติดต่อลูกค้าครั้งแรก · งานส่วนกลาง')).toBeInTheDocument();
    });
    it('renders project scope, historical overdue label and Bangkok time without a stored message', async () => {
        const api = { read: vi.fn().mockResolvedValue(snapshot({ notifications: [notification({ interestId: INTEREST, projectName: 'โครงการ A',
            taskType: 'follow_up', type: 'overdue', readAt: READ })] })), markRead: vi.fn() };
        render(<NotificationsView api={api} />); await screen.findByText('ติดตามลูกค้า · โครงการ A');
        expect(screen.getByText('เกินกำหนด ณ ตอนแจ้งเตือน')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'เปิดงานติดตาม →' })).toHaveAttribute('href', `/sales-crm/${CUSTOMER}?interestId=${INTEREST}`);
        expect(screen.getByText(/แจ้งเมื่อ/)).toHaveTextContent('10:00');
        expect(screen.getByText(/แจ้งเมื่อ/)).toHaveTextContent('10:01');
        expect(screen.queryByRole('button', { name: 'ทำเครื่องหมายว่าอ่านแล้ว' })).not.toBeInTheDocument();
    });
    it.each(['owner', 'admin', 'sales'] as const)('allows %s to open own empty inbox without an impersonation picker', async role => {
        const api = { read: vi.fn().mockResolvedValue(snapshot({ actor: { userId: USER, role }, unreadCount: 0, notifications: [] })), markRead: vi.fn() };
        render(<NotificationsView api={api} />); await screen.findByText('ไม่มีแจ้งเตือนที่แสดงได้ในหน้านี้');
        expect(screen.getByText(/ไม่ได้หมายความว่างานทั้งหมดเสร็จแล้ว/)).toBeInTheDocument();
        expect(screen.queryByRole('combobox')).not.toBeInTheDocument(); expect(api.markRead).not.toHaveBeenCalled();
    });
    it.each(['SETUP_REQUIRED', 'FEATURE_DISABLED'])('distinguishes %s from an empty inbox', async code => {
        render(<NotificationsView api={{ read: vi.fn().mockRejectedValue(new NotificationClientError(code, 'ระบบยังไม่พร้อม', 503)), markRead: vi.fn() }} />);
        await screen.findByRole('heading', { name: 'ยังไม่เปิดระบบแจ้งเตือนฝ่ายขาย' });
        expect(screen.queryByText('ไม่มีแจ้งเตือนที่แสดงได้ในหน้านี้')).not.toBeInTheDocument();
    });
    it('hides raw failures and can retry initial authentication', async () => {
        const read = vi.fn().mockRejectedValueOnce(new Error('PRIVATE_DATABASE_DETAIL')).mockResolvedValueOnce(snapshot());
        render(<NotificationsView api={{ read, markRead: vi.fn() }} />); await screen.findByRole('alert');
        expect(screen.queryByText(/PRIVATE_DATABASE_DETAIL/)).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'ตรวจสิทธิ์อีกครั้ง' })); await screen.findByText('ลูกค้าทดสอบ');
        expect(read).toHaveBeenCalledTimes(2);
    });
    it('sends only the notice id and captured actor; blocks double click/navigation until acknowledged and refreshed', async () => {
        const response = deferred<{ notificationId: string; readAt: string }>();
        const api = { read: vi.fn().mockResolvedValueOnce(snapshot()).mockResolvedValueOnce(snapshot({ asOf: READ, unreadCount: 0, notifications: [notification({ readAt: READ })] })),
            markRead: vi.fn().mockReturnValue(response.promise) };
        render(<NotificationsView api={api} />); const button = await screen.findByRole('button', { name: 'ทำเครื่องหมายว่าอ่านแล้ว' });
        fireEvent.click(button); fireEvent.click(button);
        expect(api.markRead).toHaveBeenCalledExactlyOnceWith({ notificationId: NOTICE }, USER);
        expect(screen.getByRole('button', { name: 'โหลดล่าสุด' })).toBeDisabled();
        expect(screen.queryByRole('link', { name: 'เปิดงานติดตาม →' })).not.toBeInTheDocument();
        await act(async () => response.resolve({ notificationId: NOTICE, readAt: READ }));
        await screen.findByText('ยังไม่อ่าน 0 รายการ (ทุกหน้า)'); expect(api.read).toHaveBeenCalledTimes(2);
        expect(screen.queryByRole('button', { name: 'ทำเครื่องหมายว่าอ่านแล้ว' })).not.toBeInTheDocument();
    });
    it('preserves a known successful acknowledgment if refresh fails', async () => {
        const api = { read: vi.fn().mockResolvedValueOnce(snapshot()).mockRejectedValueOnce(new Error('private')),
            markRead: vi.fn().mockResolvedValue({ notificationId: NOTICE, readAt: READ }) };
        render(<NotificationsView api={api} />); fireEvent.click(await screen.findByRole('button', { name: 'ทำเครื่องหมายว่าอ่านแล้ว' }));
        await screen.findByText('บันทึกว่าอ่านแล้วสำเร็จ ไม่ต้องส่งซ้ำ แม้โหลดรายการล่าสุดไม่ได้');
        expect(screen.getByRole('alert')).toHaveTextContent('อ่านแล้วถูกบันทึกแล้ว');
        expect(screen.queryByText('ลูกค้าทดสอบ')).not.toBeInTheDocument(); expect(api.markRead).toHaveBeenCalledTimes(1);
    });
    it('on an uncertain result permits safe same-notice retry without creating a new identity', async () => {
        const api = { read: vi.fn().mockResolvedValue(snapshot()), markRead: vi.fn().mockRejectedValueOnce(new Error('connection lost'))
            .mockResolvedValueOnce({ notificationId: NOTICE, readAt: READ }) };
        render(<NotificationsView api={api} />); fireEvent.click(await screen.findByRole('button', { name: 'ทำเครื่องหมายว่าอ่านแล้ว' }));
        await screen.findByRole('alert'); fireEvent.click(screen.getByRole('button', { name: 'ทำเครื่องหมายว่าอ่านแล้ว' }));
        await screen.findByText('บันทึกว่าอ่านแล้วสำเร็จ ไม่ต้องส่งซ้ำ แม้โหลดรายการล่าสุดไม่ได้');
        expect(api.markRead.mock.calls).toEqual([[{ notificationId: NOTICE }, USER], [{ notificationId: NOTICE }, USER]]);
    });
    it('treats a different notification success id as uncertain, not successful', async () => {
        const api = { read: vi.fn().mockResolvedValue(snapshot()), markRead: vi.fn().mockResolvedValue({ notificationId: OTHER, readAt: READ }) };
        render(<NotificationsView api={api} />); fireEvent.click(await screen.findByRole('button', { name: 'ทำเครื่องหมายว่าอ่านแล้ว' }));
        await screen.findByRole('alert'); expect(screen.queryByText(/บันทึกว่าอ่านแล้วสำเร็จ/)).not.toBeInTheDocument();
        expect(api.read).toHaveBeenCalledTimes(1);
    });
    it('removes a withdrawn notice from the actionable snapshot on a definitive rejection', async () => {
        const api = { read: vi.fn().mockResolvedValue(snapshot()), markRead: vi.fn().mockRejectedValue(new NotificationClientError('NOT_AVAILABLE', 'รายการนี้ไม่พร้อมแสดง', 404)) };
        render(<NotificationsView api={api} />); fireEvent.click(await screen.findByRole('button', { name: 'ทำเครื่องหมายว่าอ่านแล้ว' }));
        await screen.findByRole('alert'); expect(screen.queryByRole('article')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'โหลดล่าสุด' })).toBeEnabled();
    });
    it.each(['ACTOR_CHANGED', 'ACTOR_CHANGED_AFTER_REQUEST'])('clears old-account content on %s without claiming the earlier write failed', async code => {
        const api = { read: vi.fn().mockResolvedValue(snapshot()), markRead: vi.fn().mockRejectedValue(new NotificationClientError(code, 'เปลี่ยนบัญชี', 409)) };
        render(<NotificationsView api={api} />); fireEvent.click(await screen.findByRole('button', { name: 'ทำเครื่องหมายว่าอ่านแล้ว' }));
        await screen.findByRole('alert'); expect(screen.getByRole('alert')).toHaveTextContent('อาจถูกบันทึกแล้ว');
        expect(screen.queryByRole('article')).not.toBeInTheDocument(); expect(api.read).toHaveBeenCalledTimes(1);
    });
    it('does not display old page data during loading; refreshing resets to page zero', async () => {
        const response = deferred<NotificationSnapshot>();
        const api = { read: vi.fn().mockResolvedValueOnce(snapshot({ hasMore: true })).mockReturnValueOnce(response.promise).mockResolvedValueOnce(snapshot()), markRead: vi.fn() };
        render(<NotificationsView api={api} />); await screen.findByText('ลูกค้าทดสอบ');
        fireEvent.click(screen.getByRole('button', { name: 'ถัดไป →' })); expect(screen.queryByText('ลูกค้าทดสอบ')).not.toBeInTheDocument();
        await act(async () => response.resolve(snapshot({ page: 1, notifications: [], unreadCount: 0 })));
        await screen.findByText('หน้า 2 · หน้าละ 50 รายการ'); fireEvent.click(screen.getByRole('button', { name: 'โหลดล่าสุด' }));
        await waitFor(() => expect(api.read).toHaveBeenLastCalledWith(0)); await screen.findByText('หน้า 1 · หน้าละ 50 รายการ');
    });
    it.each(['actor', 'role', 'page'])('rejects a changed %s after refresh instead of rendering it', async changed => {
        const different = snapshot({ actor: { userId: changed === 'actor' ? OTHER : USER, role: changed === 'role' ? 'admin' : 'sales' }, page: changed === 'page' ? 1 : 0,
            notifications: [notification({ customerName: 'ข้อมูลผิดขอบเขต' })] });
        const api = { read: vi.fn().mockResolvedValueOnce(snapshot()).mockResolvedValueOnce(different), markRead: vi.fn() };
        render(<NotificationsView api={api} />); await screen.findByText('ลูกค้าทดสอบ'); fireEvent.click(screen.getByRole('button', { name: 'โหลดล่าสุด' }));
        await screen.findByRole('alert'); expect(screen.queryByText('ข้อมูลผิดขอบเขต')).not.toBeInTheDocument();
        expect(screen.queryByRole('article')).not.toBeInTheDocument();
    });
    it('does not start a post-ack read after unmount', async () => {
        const response = deferred<{ notificationId: string; readAt: string }>();
        const api = { read: vi.fn().mockResolvedValue(snapshot()), markRead: vi.fn().mockReturnValue(response.promise) };
        const { unmount } = render(<NotificationsView api={api} />);
        fireEvent.click(await screen.findByRole('button', { name: 'ทำเครื่องหมายว่าอ่านแล้ว' })); unmount();
        await act(async () => response.resolve({ notificationId: NOTICE, readAt: READ })); expect(api.read).toHaveBeenCalledTimes(1);
    });
    it('clears private content on an account event without waiting for another request and unsubscribes on exit', async () => {
        let invalidate!: () => void;
        const unsubscribe = vi.fn();
        const api = { read: vi.fn().mockResolvedValueOnce(snapshot()).mockResolvedValueOnce(snapshot({ actor: { userId: OTHER, role: 'sales' }, notifications: [], unreadCount: 0 })),
            markRead: vi.fn(), watchActor: vi.fn((_id: string, callback: () => void) => { invalidate = callback; return unsubscribe; }) };
        const { unmount } = render(<NotificationsView api={api} />); await screen.findByText('ลูกค้าทดสอบ');
        await waitFor(() => expect(api.watchActor).toHaveBeenLastCalledWith(USER, expect.any(Function)));
        act(() => invalidate()); expect(screen.queryByText('ลูกค้าทดสอบ')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'โหลดล่าสุด' })).toBeDisabled();
        expect(api.read).toHaveBeenCalledTimes(1); expect(api.markRead).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'ตรวจบัญชีใหม่' }));
        await screen.findByText('ไม่มีแจ้งเตือนที่แสดงได้ในหน้านี้');
        // Rendering the new account can precede its passive subscription effect.
        await waitFor(() => expect(api.watchActor).toHaveBeenLastCalledWith(OTHER, expect.any(Function)));
        expect(unsubscribe).toHaveBeenCalledTimes(1); unmount(); expect(unsubscribe).toHaveBeenCalledTimes(2);
    });
    it('ignores an old-account acknowledgment that resolves after identity invalidation', async () => {
        let invalidate!: () => void;
        const response = deferred<{ notificationId: string; readAt: string }>();
        const api = { read: vi.fn().mockResolvedValue(snapshot()), markRead: vi.fn().mockReturnValue(response.promise),
            watchActor: (_id: string, callback: () => void) => { invalidate = callback; return () => undefined; } };
        render(<NotificationsView api={api} />); fireEvent.click(await screen.findByRole('button', { name: 'ทำเครื่องหมายว่าอ่านแล้ว' }));
        act(() => invalidate()); await act(async () => response.resolve({ notificationId: NOTICE, readAt: READ }));
        expect(screen.queryByRole('article')).not.toBeInTheDocument();
        expect(screen.queryByText(/บันทึกว่าอ่านแล้วสำเร็จ/)).not.toBeInTheDocument();
        expect(api.read).toHaveBeenCalledTimes(1); expect(screen.getByRole('button', { name: 'ตรวจบัญชีใหม่' })).toBeEnabled();
    });
    it('ignores an old-account refresh after a successful acknowledgment when identity changes during the read', async () => {
        let invalidate!: () => void;
        const response = deferred<NotificationSnapshot>();
        const api = { read: vi.fn().mockResolvedValueOnce(snapshot()).mockReturnValueOnce(response.promise),
            markRead: vi.fn().mockResolvedValue({ notificationId: NOTICE, readAt: READ }),
            watchActor: (_id: string, callback: () => void) => { invalidate = callback; return () => undefined; } };
        render(<NotificationsView api={api} />); fireEvent.click(await screen.findByRole('button', { name: 'ทำเครื่องหมายว่าอ่านแล้ว' }));
        await waitFor(() => expect(api.read).toHaveBeenCalledTimes(2));
        act(() => invalidate()); await act(async () => response.resolve(snapshot({ asOf: READ, notifications: [notification({ readAt: READ })], unreadCount: 0 })));
        expect(screen.queryByRole('article')).not.toBeInTheDocument();
        expect(screen.queryByText(/บันทึกว่าอ่านแล้วสำเร็จ/)).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'ตรวจบัญชีใหม่' })).toBeEnabled();
        expect(api.markRead).toHaveBeenCalledTimes(1);
    });
    it('ignores stale initial requests after a component api change', async () => {
        const response = deferred<NotificationSnapshot>();
        const oldApi = { read: vi.fn().mockReturnValue(response.promise), markRead: vi.fn() };
        const currentApi = { read: vi.fn().mockResolvedValue(snapshot()), markRead: vi.fn() };
        const { rerender } = render(<NotificationsView api={oldApi} />);
        await waitFor(() => expect(oldApi.read).toHaveBeenCalledOnce()); rerender(<NotificationsView api={currentApi} />);
        await screen.findByText('ลูกค้าทดสอบ');
        await act(async () => response.resolve(snapshot({ notifications: [notification({ customerName: 'เก่า' })] })));
        expect(screen.queryByText('เก่า')).not.toBeInTheDocument();
        expect(within(screen.getByRole('article')).getByText('ลูกค้าทดสอบ')).toBeInTheDocument();
    });
});
