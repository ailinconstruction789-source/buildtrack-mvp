import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: vi.fn(), onAuthStateChange: vi.fn() } } }));
import SlaPreviewView from '../SlaPreviewView';
import { SlaPreviewClientError } from '@/lib/sales/slaPreviewClient';
import type { SlaPreviewRow, SlaPreviewSnapshot } from '@/lib/sales/slaPreviewTypes';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function row(overrides: Partial<SlaPreviewRow> = {}): SlaPreviewRow {
    return { taskId: id(1), customerId: id(2), customerName: 'ลูกค้า A', ownerUserId: id(3), ownerName: 'Sales A',
        serviceDueAt: '2026-09-18T03:00:00Z', state: 'would_notify', reason: 'DUE_SOON', staffDueAt: '2026-09-18T03:00:00Z',
        notifyAt: '2026-09-17T03:00:00Z', rule: 'service_deadline', calendarVersion: id(4), notificationType: 'due_soon', ...overrides };
}
function snapshot(overrides: Partial<SlaPreviewSnapshot> = {}): SlaPreviewSnapshot {
    return { actor: { userId: id(9), role: 'admin' }, asOf: '2026-09-18T02:30:00Z', page: 0, pageSize: 20, hasMore: false,
        mode: 'dry_run', policyVersion: 'first_contact_preview_2026_09_17', dueSoonMinutes: 30, rows: [row()], ...overrides };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
afterEach(cleanup);
describe('read-only Admin first-contact preview', () => {
    it('clearly labels the bounded dry run, timestamps and absence of writes', async () => {
        const api = { read: vi.fn().mockResolvedValue(snapshot()) };
        render(<SlaPreviewView api={api} />); await screen.findByRole('article');
        expect(api.read).toHaveBeenCalledExactlyOnceWith(0);
        expect(screen.getByText(/โหมดจำลองสำหรับ Admin/)).toHaveTextContent('ไม่บันทึกกำหนด ไม่ส่งแจ้งเตือน ไม่ปิดงาน และไม่คิดคะแนน KPI');
        expect(screen.getByText(/เฉพาะงานติดต่อครั้งแรก/)).toHaveTextContent('30 นาที');
        expect(screen.getByText('เข้าเงื่อนไขเตือนก่อนกำหนด (ยังไม่ส่ง)')).toBeInTheDocument();
        expect(screen.getAllByText(/10:00/)).toHaveLength(2);
        expect(screen.queryByRole('button', { name: /ส่ง|บันทึก|อนุมัติ/ })).not.toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'ดูหลักฐานและงานส่วนกลาง →' })).toHaveAttribute('href', `/sales-crm/${id(2)}`);
    });
    it('retains held rows with a reason and no fabricated deadline, with counts explicitly page-scoped', async () => {
        const held = row({ taskId: id(8), customerName: 'ลูกค้า B', state: 'held', reason: 'OWNER_REVIEW', staffDueAt: null, notifyAt: null,
            rule: null, calendarVersion: null, notificationType: null });
        render(<SlaPreviewView api={{ read: vi.fn().mockResolvedValue(snapshot({ rows: [row(), held] })) }} />);
        await screen.findByText('ลูกค้า B'); expect(screen.getByText('ยังไม่คำนวณ')).toBeInTheDocument();
        expect(screen.getByText(/เปลี่ยนผู้ดูแลหรือประวัติไม่ชัดเจน/)).toBeInTheDocument();
        expect(screen.getByText('ในหน้านี้: เข้าเงื่อนไขแจ้ง 1')).toBeInTheDocument();
        expect(screen.getByText('รอตรวจหลักฐาน 1')).toBeInTheDocument();
    });
    it('does not equate an empty initial-contact queue with all sales tasks completed', async () => {
        render(<SlaPreviewView api={{ read: vi.fn().mockResolvedValue(snapshot({ rows: [] })) }} />);
        await screen.findByText('ไม่พบงานติดต่อครั้งแรกที่เปิดในหน้านี้');
        expect(screen.getByText('ไม่ได้หมายความว่างานฝ่ายขายทั้งหมดเสร็จแล้ว')).toBeInTheDocument();
    });
    it.each(['FEATURE_DISABLED', 'SETUP_REQUIRED', 'FORBIDDEN'])('shows %s as an error, not an empty queue', async code => {
        render(<SlaPreviewView api={{ read: vi.fn().mockRejectedValue(new SlaPreviewClientError(code, 'ระบบยังไม่พร้อม', 503)) }} />);
        await screen.findByRole('alert'); expect(screen.queryByText('ไม่พบงานติดต่อครั้งแรกที่เปิดในหน้านี้')).not.toBeInTheDocument();
    });
    it('does not reveal raw errors and can retry initial authentication', async () => {
        const api = { read: vi.fn().mockRejectedValueOnce(new Error('PRIVATE_SQL')).mockResolvedValueOnce(snapshot()) };
        render(<SlaPreviewView api={api} />); await screen.findByRole('alert'); expect(screen.queryByText(/PRIVATE_SQL/)).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'ตรวจสิทธิ์อีกครั้ง' })); await screen.findByText('ลูกค้า A'); expect(api.read).toHaveBeenCalledTimes(2);
    });
    it.each(['sales', 'owner'])('does not trust a mocked %s initial projection to mount Admin UI', async role => {
        render(<SlaPreviewView api={{ read: vi.fn().mockResolvedValue(snapshot({ actor: { userId: id(9), role } as SlaPreviewSnapshot['actor'] })) }} />);
        await screen.findByRole('alert'); expect(screen.queryByRole('article')).not.toBeInTheDocument();
    });
    it('hides old rows while reading another page, and manual refresh starts at page zero', async () => {
        const response = deferred<SlaPreviewSnapshot>();
        const api = { read: vi.fn().mockResolvedValueOnce(snapshot({ hasMore: true })).mockReturnValueOnce(response.promise).mockResolvedValueOnce(snapshot()) };
        render(<SlaPreviewView api={api} />); await screen.findByText('ลูกค้า A'); fireEvent.click(screen.getByRole('button', { name: 'ถัดไป →' }));
        expect(screen.queryByText('ลูกค้า A')).not.toBeInTheDocument(); expect(screen.getByRole('button', { name: 'คำนวณล่าสุด' })).toBeDisabled();
        await act(async () => response.resolve(snapshot({ page: 1, rows: [] }))); await screen.findByText('หน้า 2 · หน้าละ 20 งาน');
        fireEvent.click(screen.getByRole('button', { name: 'คำนวณล่าสุด' })); await screen.findByText('ลูกค้า A');
        expect(api.read.mock.calls).toEqual([[0], [1], [0]]);
    });
    it.each(['actor', 'page', 'mode'])('rejects an unexpected %s after reloading', async changed => {
        const next = { ...snapshot(), ...(changed === 'actor' ? { actor: { userId: id(8), role: 'admin' } } : changed === 'page' ? { page: 1 } : { mode: 'apply' }) };
        const api = { read: vi.fn().mockResolvedValueOnce(snapshot()).mockResolvedValueOnce(next) };
        render(<SlaPreviewView api={api} />); await screen.findByText('ลูกค้า A'); fireEvent.click(screen.getByRole('button', { name: 'คำนวณล่าสุด' }));
        await screen.findByRole('alert'); expect(screen.queryByRole('article')).not.toBeInTheDocument();
    });
    it('discards late results on identity events, requires explicit recheck, and unsubscribes', async () => {
        let invalidate!: () => void;
        const unsubscribe = vi.fn(), response = deferred<SlaPreviewSnapshot>();
        const api = { read: vi.fn().mockResolvedValueOnce(snapshot()).mockReturnValueOnce(response.promise)
            .mockResolvedValueOnce(snapshot({ actor: { userId: id(8), role: 'admin' }, rows: [] })),
            watchActor: vi.fn((_actor: string, callback: () => void) => { invalidate = callback; return unsubscribe; }) };
        const { unmount } = render(<SlaPreviewView api={api} />); await screen.findByText('ลูกค้า A');
        fireEvent.click(screen.getByRole('button', { name: 'คำนวณล่าสุด' })); act(() => invalidate());
        await act(async () => response.resolve(snapshot())); expect(screen.queryByRole('article')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'คำนวณล่าสุด' })).toBeDisabled(); expect(api.read).toHaveBeenCalledTimes(2);
        fireEvent.click(screen.getByRole('button', { name: 'ตรวจบัญชีใหม่' })); await screen.findByText('ไม่พบงานติดต่อครั้งแรกที่เปิดในหน้านี้');
        await waitFor(() => expect(api.watchActor).toHaveBeenLastCalledWith(id(8), expect.any(Function)));
        expect(unsubscribe).toHaveBeenCalledTimes(1); unmount(); expect(unsubscribe).toHaveBeenCalledTimes(2);
    });
});
