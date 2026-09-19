import React, { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: vi.fn(), onAuthStateChange: vi.fn() } } }));
import SlaProcessingView from '../SlaProcessingView';
import { SlaProcessingClientError } from '@/lib/sales/slaProcessingClient';
import { SlaReceiptClientError, type SlaReceiptApi } from '@/lib/sales/slaReceiptClient';
import { SlaPreviewClientError, type SlaPreviewApi } from '@/lib/sales/slaPreviewClient';
import type { SlaReceiptContext, SlaReceiptLookup } from '@/lib/sales/slaReceiptContracts';
import type { SlaProcessingInput, SlaProcessingResult } from '@/lib/sales/slaProcessingContracts';
import type { SlaPreviewRow, SlaPreviewSnapshot } from '@/lib/sales/slaPreviewTypes';
import { parseSlaPreviewSnapshot } from '@/lib/sales/slaPreviewContracts';
import { readSlaProcessingPending, slaProcessingPendingKey } from '@/lib/sales/slaProcessingPending';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ADMIN = id(9), OTHER = id(8), TASK = id(1), REQUEST = id(20);
const command: SlaProcessingInput = { requestId: REQUEST, taskId: TASK };
const another: SlaProcessingInput = { requestId: id(21), taskId: id(22) };
const ack = 'ฉันตรวจรหัสงานและเข้าใจผลของการประมวลผลนี้แล้ว';

function row(change: Partial<SlaPreviewRow> = {}): SlaPreviewRow {
    return { taskId: TASK, customerId: id(2), customerName: 'ลูกค้า A', ownerUserId: id(3), ownerName: 'Sales A',
        serviceDueAt: '2026-09-18T03:00:00Z', state: 'would_notify', reason: 'DUE_SOON', staffDueAt: '2026-09-18T03:00:00Z',
        notifyAt: '2026-09-17T03:00:00Z', rule: 'service_deadline', calendarVersion: id(4), notificationType: 'due_soon', ...change };
}
function snapshot(change: Partial<SlaPreviewSnapshot> = {}): SlaPreviewSnapshot {
    return parseSlaPreviewSnapshot({ actor: { userId: ADMIN, role: 'admin' }, asOf: '2026-09-18T02:30:00Z',
        page: 0, pageSize: 20, hasMore: false, mode: 'dry_run', policyVersion: 'first_contact_preview_2026_09_17',
        dueSoonMinutes: 30, rows: [row()], ...change });
}
function context(change: Partial<SlaReceiptContext> = {}): SlaReceiptContext {
    return { actor: { userId: ADMIN, role: 'admin' }, processingEnabled: true, ...change };
}
function receipt(change: Partial<SlaProcessingResult> = {}): SlaProcessingResult {
    return { actor: { userId: ADMIN, role: 'admin' }, ...command, processedAt: '2026-09-18T02:30:00.000001Z',
        replayed: false, outcome: 'held', reason: 'MISSING_CALENDAR', serviceDueAt: '2026-09-18T03:00:00Z',
        staffDueAt: null, notificationId: null, notificationType: null, completedByActivityId: null, completedAt: null,
        withdrawnCount: 0, ...change };
}
function found(value = receipt()): SlaReceiptLookup {
    return { actor: value.actor, requestId: value.requestId, taskId: value.taskId, found: true, receipt: value };
}
function absent(input = command): SlaReceiptLookup {
    return { actor: { userId: ADMIN, role: 'admin' }, ...input, found: false, receipt: null };
}
function seed(input = command, actorId = ADMIN) {
    sessionStorage.setItem(slaProcessingPendingKey(actorId), JSON.stringify({ version: 1, actorId, uncertain: true, input }));
}
function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
function apis(initial = context(), rows = snapshot()) {
    let invalidate: (() => void) | undefined;
    const unsubscribe = vi.fn();
    const receiptApi = {
        context: vi.fn<SlaReceiptApi['context']>().mockResolvedValue(initial),
        lookup: vi.fn<SlaReceiptApi['lookup']>().mockImplementation(async (input, actorId) => found(receipt({ ...input, actor: { userId: actorId, role: 'admin' } }))),
        watchActor: vi.fn((_actor: string, callback: () => void) => { invalidate = callback; return unsubscribe; }),
    };
    const previewApi = { read: vi.fn<SlaPreviewApi['read']>().mockResolvedValue(rows) };
    const processingApi = { process: vi.fn(async (input: SlaProcessingInput, actorId: string) => receipt({ ...input, actor: { userId: actorId, role: 'admin' } })) };
    const newRequestId = vi.fn(() => REQUEST);
    return { receiptApi, previewApi, processingApi, newRequestId, unsubscribe,
        invalidate: () => { if (!invalidate) throw new Error('Watcher not installed'); invalidate(); } };
}
type Harness = ReturnType<typeof apis>;
function view(api: Harness, strict = false) {
    const element = <SlaProcessingView receiptApi={api.receiptApi} previewApi={api.previewApi} processingApi={api.processingApi} newRequestId={api.newRequestId} />;
    return render(strict ? <StrictMode>{element}</StrictMode> : element);
}
async function ready() {
    await screen.findByRole('heading', { name: 'ประมวลผลและตรวจใบรับ SLA' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'โหลดงานล่าสุด' })).toBeEnabled());
}
async function choose(name = 'ลูกค้า A') {
    fireEvent.click(await screen.findByRole('button', { name: `ทบทวนงานของ ${name}` }));
    return screen.getByRole('region', { name: 'ยืนยันการประมวลผล' });
}
function confirm(retry = false) {
    fireEvent.click(screen.getByRole('checkbox', { name: ack }));
    fireEvent.click(screen.getByRole('button', { name: retry ? 'ยืนยันลองคำขอเดิม' : 'ยืนยันประมวลผลหนึ่งงาน' }));
}
function lookup(input = another) {
    fireEvent.change(screen.getByRole('textbox', { name: 'รหัสคำขอ' }), { target: { value: input.requestId } });
    fireEvent.change(screen.getByRole('textbox', { name: 'รหัสงาน' }), { target: { value: input.taskId } });
    fireEvent.click(screen.getByRole('button', { name: 'ค้นหาใบรับเท่านั้น' }));
}
const receiptRegion = () => screen.findByRole('region', { name: 'ใบรับการประมวลผล' });

beforeEach(() => sessionStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); sessionStorage.clear(); });

describe('Admin explicit first-contact processing and historical receipt UI', () => {
    it('mounts by reading only and never prepares or sends a command automatically', async () => {
        const api = apis(); view(api); await ready();
        expect(api.previewApi.read).toHaveBeenCalledWith(0);
        expect(api.receiptApi.lookup).not.toHaveBeenCalled();
        expect(api.processingApi.process).not.toHaveBeenCalled(); expect(api.newRequestId).not.toHaveBeenCalled();
        expect(readSlaProcessingPending(ADMIN)).toBeNull();
        expect(screen.getByText(/ไม่มีการส่งอัตโนมัติหรือคิด KPI/)).toBeInTheDocument();
    });

    it('StrictMode mount and a manual refresh remain read-only and do not become stuck busy', async () => {
        const api = apis(); view(api, true); await ready(); await screen.findByText('ลูกค้า A');
        fireEvent.click(screen.getByRole('button', { name: 'โหลดงานล่าสุด' })); await ready();
        expect(api.processingApi.process).not.toHaveBeenCalled(); expect(api.newRequestId).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: 'ทบทวนงานของ ลูกค้า A' })).toBeEnabled();
    });

    it('requires review plus checkbox and persists only the minimal command before a single POST', async () => {
        const api = apis();
        api.processingApi.process.mockImplementation(async (input, actorId) => {
            expect(input).toEqual(command); expect(Object.keys(input).sort()).toEqual(['requestId', 'taskId']);
            expect(actorId).toBe(ADMIN); expect(readSlaProcessingPending(ADMIN)).toEqual(command);
            return receipt();
        });
        view(api); await ready(); const review = await choose();
        expect(within(review).getByText(/อาจบันทึกกำหนด Sales/)).toHaveTextContent('ถอนแจ้งเตือนเดิม');
        const submit = screen.getByRole('button', { name: 'ยืนยันประมวลผลหนึ่งงาน' });
        expect(submit).toBeDisabled(); fireEvent.click(submit);
        expect(api.processingApi.process).not.toHaveBeenCalled(); expect(api.newRequestId).not.toHaveBeenCalled();
        confirm(); await receiptRegion();
        expect(api.processingApi.process).toHaveBeenCalledExactlyOnceWith(command, ADMIN);
        expect(api.newRequestId).toHaveBeenCalledOnce(); expect(readSlaProcessingPending(ADMIN)).toBeNull();
    });

    it('selecting another task resets acknowledgement and never processes the first task', async () => {
        const api = apis(context(), snapshot({ rows: [row(), row({ taskId: id(30), customerId: id(31), customerName: 'ลูกค้า B' })] }));
        view(api); await ready(); await choose(); fireEvent.click(screen.getByRole('checkbox', { name: ack }));
        await choose('ลูกค้า B'); expect(screen.getByRole('checkbox', { name: ack })).not.toBeChecked();
        confirm(); await receiptRegion();
        expect(api.processingApi.process).toHaveBeenCalledExactlyOnceWith({ requestId: REQUEST, taskId: id(30) }, ADMIN);
    });

    it('held CONTACT_REVIEW remains selectable and can yield a proven completion without claiming KPI credit', async () => {
        const held = row({ state: 'held', reason: 'CONTACT_REVIEW', staffDueAt: null, notifyAt: null, rule: null, calendarVersion: null, notificationType: null });
        const api = apis(context(), snapshot({ rows: [held] }));
        api.processingApi.process.mockResolvedValue(receipt({ outcome: 'completed', reason: 'CONTACT_PROVEN', completedByActivityId: id(44), completedAt: '2026-09-18T02:00:00.123456Z' }));
        view(api); await ready(); await choose(); confirm(); const region = await receiptRegion();
        expect(within(region).getByRole('heading')).toHaveTextContent('ปิดงานติดต่อครั้งแรกจากหลักฐาน');
        expect(within(region).getByText(/ไม่ใช่ผลประเมิน KPI/)).toBeInTheDocument();
        expect(within(region).getByText(/ไม่ยืนยันว่ากำหนดในงานถูกล้าง/)).toBeInTheDocument();
    });

    it('rechecks the seventh gate before POST and generates no request ID when it was disabled', async () => {
        const api = apis(); view(api); await ready(); await choose();
        api.receiptApi.context.mockResolvedValue(context({ processingEnabled: false })); confirm();
        await screen.findByText(/การประมวลผลถูกปิด ยังตรวจใบรับเดิมได้/);
        expect(api.processingApi.process).not.toHaveBeenCalled(); expect(api.newRequestId).not.toHaveBeenCalled();
        expect(readSlaProcessingPending(ADMIN)).toBeNull();
        expect(screen.getByRole('button', { name: 'ทบทวนงานของ ลูกค้า A' })).toBeDisabled();
    });

    it('processing off still restores and reads a pending receipt but disables new commands and retry', async () => {
        seed(); const api = apis(context({ processingEnabled: false })); view(api); await ready();
        expect(screen.getByRole('button', { name: 'ทบทวนการลองคำขอเดิม' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'ทบทวนงานของ ลูกค้า A' })).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'ตรวจใบรับคำขอค้าง' })); await receiptRegion();
        expect(api.receiptApi.lookup).toHaveBeenCalledExactlyOnceWith(command, ADMIN);
        expect(api.processingApi.process).not.toHaveBeenCalled(); expect(api.newRequestId).not.toHaveBeenCalled();
        expect(readSlaProcessingPending(ADMIN)).toBeNull();
    });

    it('restores sticky pending input across mounts without automatic lookup or retry', async () => {
        seed(); const api = apis(); const first = view(api); await ready();
        expect(screen.getByRole('region', { name: 'คำขอค้างในแท็บ' })).toHaveTextContent(REQUEST);
        expect(screen.getByRole('button', { name: 'ทบทวนงานของ ลูกค้า A' })).toBeDisabled();
        first.unmount(); view(api); await ready();
        expect(readSlaProcessingPending(ADMIN)).toEqual(command);
        expect(api.receiptApi.lookup).not.toHaveBeenCalled(); expect(api.processingApi.process).not.toHaveBeenCalled();
        expect(api.newRequestId).not.toHaveBeenCalled();
    });

    it('not-found never clears pending state or proves the earlier command did not commit', async () => {
        seed(); const api = apis(); api.receiptApi.lookup.mockResolvedValue(absent()); view(api); await ready();
        fireEvent.click(screen.getByRole('button', { name: 'ตรวจใบรับคำขอค้าง' }));
        await screen.findByText(/ยังไม่พบใบรับที่ตรงคำขอ/);
        expect(readSlaProcessingPending(ADMIN)).toEqual(command); expect(api.newRequestId).not.toHaveBeenCalled();
        expect(api.processingApi.process).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: 'ทบทวนงานของ ลูกค้า A' })).toBeDisabled();
    });

    it('found own matching receipt settles only that pending command and labels historical state', async () => {
        seed(); const api = apis(); view(api); await ready();
        fireEvent.click(screen.getByRole('button', { name: 'ตรวจใบรับคำขอค้าง' })); const region = await receiptRegion();
        expect(region).toHaveTextContent('พบใบรับเดิมจากการอ่านเท่านั้น');
        expect(region).toHaveTextContent('ไม่รับรองสถานะงานหรือกล่องแจ้งเตือนปัจจุบัน');
        expect(readSlaProcessingPending(ADMIN)).toBeNull();
        expect(api.processingApi.process).not.toHaveBeenCalled(); expect(api.newRequestId).not.toHaveBeenCalled();
    });

    it('looking up a different own historical receipt cannot clear or bypass the pending pair', async () => {
        seed(); const api = apis(); view(api); await ready(); lookup(another); const region = await receiptRegion();
        expect(region).toHaveTextContent(another.requestId);
        expect(readSlaProcessingPending(ADMIN)).toEqual(command);
        expect(screen.getByRole('button', { name: 'ทบทวนงานของ ลูกค้า A' })).toBeDisabled();
        expect(api.processingApi.process).not.toHaveBeenCalled(); expect(api.newRequestId).not.toHaveBeenCalled();
    });

    it('manual receipt lookup without pending state never creates a queue or request ID', async () => {
        const api = apis(); view(api); await ready(); lookup(); await receiptRegion();
        expect(readSlaProcessingPending(ADMIN)).toBeNull(); expect(api.newRequestId).not.toHaveBeenCalled();
        expect(api.processingApi.process).not.toHaveBeenCalled();
    });

    it('duplicate confirmation clicks while context recheck waits send one command', async () => {
        const gate = deferred<SlaReceiptContext>(), api = apis(); view(api); await ready(); await choose();
        api.receiptApi.context.mockReturnValueOnce(gate.promise);
        fireEvent.click(screen.getByRole('checkbox', { name: ack }));
        const submit = screen.getByRole('button', { name: 'ยืนยันประมวลผลหนึ่งงาน' });
        act(() => { fireEvent.click(submit); fireEvent.click(submit); });
        expect(api.processingApi.process).not.toHaveBeenCalled();
        await act(async () => gate.resolve(context())); await receiptRegion();
        expect(api.processingApi.process).toHaveBeenCalledOnce(); expect(api.newRequestId).toHaveBeenCalledOnce();
    });

    it('a network failure retains the exact pair; only explicit same-command review retries it', async () => {
        const api = apis(); api.processingApi.process.mockRejectedValueOnce(new SlaProcessingClientError('NETWORK_ERROR', 'ผลยังไม่แน่ชัด'));
        view(api); await ready(); await choose(); confirm(); await screen.findByText('ผลยังไม่แน่ชัด');
        expect(readSlaProcessingPending(ADMIN)).toEqual(command); expect(api.processingApi.process).toHaveBeenCalledOnce();
        fireEvent.click(screen.getByRole('button', { name: 'ทบทวนการลองคำขอเดิม' }));
        expect(screen.getByRole('button', { name: 'ยืนยันลองคำขอเดิม' })).toBeDisabled();
        confirm(true); await receiptRegion();
        expect(api.processingApi.process.mock.calls).toEqual([[command, ADMIN], [command, ADMIN]]);
        expect(api.newRequestId).toHaveBeenCalledOnce(); expect(readSlaProcessingPending(ADMIN)).toBeNull();
    });

    it('restored-pending explicit retry never allocates a new request ID', async () => {
        seed(); const api = apis(); api.processingApi.process.mockResolvedValue(receipt({ replayed: true })); view(api); await ready();
        fireEvent.click(screen.getByRole('button', { name: 'ทบทวนการลองคำขอเดิม' })); confirm(true);
        const region = await receiptRegion(); expect(region).toHaveTextContent('ได้รับใบรับเดิมจากคำขอซ้ำ');
        expect(api.processingApi.process).toHaveBeenCalledExactlyOnceWith(command, ADMIN); expect(api.newRequestId).not.toHaveBeenCalled();
    });

    it('even a definitely rejected attempt keeps the write-ahead pending pair', async () => {
        const api = apis(); api.processingApi.process.mockRejectedValue(new SlaProcessingClientError('SETUP_REQUIRED', 'ยังไม่พร้อมประมวลผล', 503, true));
        view(api); await ready(); await choose(); confirm(); await screen.findByText('ยังไม่พร้อมประมวลผล');
        expect(readSlaProcessingPending(ADMIN)).toEqual(command); expect(api.processingApi.process).toHaveBeenCalledOnce();
    });

    it('malformed successful POST remains uncertain and never displays a confirmed receipt', async () => {
        const api = apis(); api.processingApi.process.mockResolvedValue(receipt({ requestId: another.requestId }));
        view(api); await ready(); await choose(); confirm(); await screen.findByRole('alert');
        expect(readSlaProcessingPending(ADMIN)).toEqual(command);
        expect(screen.queryByRole('region', { name: 'ใบรับการประมวลผล' })).not.toBeInTheDocument();
    });

    it.each(['request', 'task', 'actor', 'receipt', 'absent-with-receipt'] as const)('rejects unbound %s lookup without clearing a queue', async changed => {
        seed(); const api = apis(); const value = found();
        if (changed === 'request') value.requestId = another.requestId;
        if (changed === 'task') value.taskId = another.taskId;
        if (changed === 'actor') value.actor = { userId: OTHER, role: 'admin' };
        if (changed === 'receipt') value.receipt = receipt({ taskId: another.taskId });
        if (changed === 'absent-with-receipt') value.found = false;
        api.receiptApi.lookup.mockResolvedValue(value); view(api); await ready();
        fireEvent.click(screen.getByRole('button', { name: 'ตรวจใบรับคำขอค้าง' })); await screen.findByRole('alert');
        expect(readSlaProcessingPending(ADMIN)).toEqual(command); expect(api.newRequestId).not.toHaveBeenCalled();
        expect(screen.queryByRole('region', { name: 'ใบรับการประมวลผล' })).not.toBeInTheDocument();
    });

    it('failed receipt read preserves the queue and hides raw failure details', async () => {
        seed(); const api = apis(); api.receiptApi.lookup.mockRejectedValue(new Error('PRIVATE_SQL_SECRET')); view(api); await ready();
        fireEvent.click(screen.getByRole('button', { name: 'ตรวจใบรับคำขอค้าง' })); await screen.findByRole('alert');
        expect(screen.queryByText(/PRIVATE_SQL_SECRET/)).not.toBeInTheDocument();
        expect(readSlaProcessingPending(ADMIN)).toEqual(command); expect(api.processingApi.process).not.toHaveBeenCalled();
    });

    it.each(['not JSON', '{}', JSON.stringify({ version: 1, actorId: OTHER, uncertain: true, input: command })])('corrupt queue blocks processing without overwriting data %#', async raw => {
        const key = slaProcessingPendingKey(ADMIN); sessionStorage.setItem(key, raw);
        const api = apis(); view(api); await ready();
        expect(screen.getByRole('button', { name: 'ทบทวนงานของ ลูกค้า A' })).toBeDisabled();
        expect(screen.getAllByRole('alert').length).toBeGreaterThan(0); expect(sessionStorage.getItem(key)).toBe(raw);
        expect(api.processingApi.process).not.toHaveBeenCalled(); expect(api.newRequestId).not.toHaveBeenCalled();
    });

    it('unreadable session storage fails closed before allowing a task selection', async () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('PRIVATE_STORAGE'); });
        const api = apis(); view(api); await ready();
        expect(screen.getByRole('button', { name: 'ทบทวนงานของ ลูกค้า A' })).toBeDisabled();
        expect(screen.queryByText(/PRIVATE_STORAGE/)).not.toBeInTheDocument(); expect(api.processingApi.process).not.toHaveBeenCalled();
    });

    it('write-ahead storage failure prevents POST', async () => {
        const api = apis(); view(api); await ready(); await choose();
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('PRIVATE_STORAGE'); });
        confirm(); await screen.findByRole('alert'); expect(api.processingApi.process).not.toHaveBeenCalled();
        expect(screen.queryByText(/PRIVATE_STORAGE/)).not.toBeInTheDocument();
    });

    it('a pending command inserted after selecting a new task blocks confirmation before UUID allocation', async () => {
        const api = apis(); view(api); await ready(); await choose(); seed(another); confirm();
        await screen.findByRole('region', { name: 'คำขอค้างในแท็บ' });
        expect(api.processingApi.process).not.toHaveBeenCalled(); expect(api.newRequestId).not.toHaveBeenCalled();
        expect(readSlaProcessingPending(ADMIN)).toEqual(another);
    });

    it('a queue replaced while lookup waits is never erased by the old matching receipt', async () => {
        seed(); const response = deferred<SlaReceiptLookup>(), api = apis(); api.receiptApi.lookup.mockReturnValue(response.promise);
        view(api); await ready(); fireEvent.click(screen.getByRole('button', { name: 'ตรวจใบรับคำขอค้าง' }));
        seed(another); await act(async () => response.resolve(found())); await receiptRegion();
        expect(readSlaProcessingPending(ADMIN)).toEqual(another);
        expect(screen.getByRole('region', { name: 'คำขอค้างในแท็บ' })).toHaveTextContent(another.requestId);
    });

    it.each(['lookup', 'command'] as const)('known %s receipt remains confirmed if clearing local queue fails', async source => {
        if (source === 'lookup') seed();
        const api = apis(); view(api); await ready();
        vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('denied'); });
        if (source === 'lookup') fireEvent.click(screen.getByRole('button', { name: 'ตรวจใบรับคำขอค้าง' }));
        else { await choose(); confirm(); }
        await receiptRegion(); await screen.findByText(/แต่ล้างคำขอในแท็บไม่ได้/);
        expect(readSlaProcessingPending(ADMIN)).toEqual(command);
        expect(screen.getByRole('region', { name: 'คำขอค้างในแท็บ' })).toBeInTheDocument();
        expect(api.processingApi.process).toHaveBeenCalledTimes(source === 'command' ? 1 : 0);
    });

    it('failed refresh after a confirmed POST preserves the historical receipt and never repeats POST', async () => {
        const api = apis(); view(api); await ready(); await choose(); confirm(); await receiptRegion();
        api.previewApi.read.mockRejectedValueOnce(new SlaPreviewClientError('READ_UNAVAILABLE', 'โหลดรายการล่าสุดไม่ได้'));
        fireEvent.click(screen.getByRole('button', { name: 'โหลดงานล่าสุด' })); await screen.findByText('โหลดรายการล่าสุดไม่ได้');
        expect(screen.getByRole('region', { name: 'ใบรับการประมวลผล' })).toHaveTextContent(REQUEST);
        expect(api.processingApi.process).toHaveBeenCalledOnce(); expect(readSlaProcessingPending(ADMIN)).toBeNull();
    });

    it.each(['sales', 'owner'])('rejects initial %s context before reading queues or mounting Admin controls', async role => {
        const api = apis(); api.receiptApi.context.mockResolvedValue({ actor: { userId: ADMIN, role }, processingEnabled: true } as SlaReceiptContext);
        const storage = vi.spyOn(Storage.prototype, 'getItem'); view(api); await screen.findByRole('alert');
        expect(api.previewApi.read).not.toHaveBeenCalled(); expect(storage).not.toHaveBeenCalled();
        expect(api.processingApi.process).not.toHaveBeenCalled();
    });

    it('a rejected initial context shows a safe error rather than an empty task list', async () => {
        const api = apis(); api.receiptApi.context.mockRejectedValue(new Error('PRIVATE_AUTH_DETAILS')); view(api);
        await screen.findByRole('alert'); expect(screen.queryByText(/PRIVATE_AUTH_DETAILS/)).not.toBeInTheDocument();
        expect(screen.queryByText(/ไม่พบงานติดต่อครั้งแรกที่เปิด/)).not.toBeInTheDocument(); expect(api.previewApi.read).not.toHaveBeenCalled();
    });

    it('identity invalidation removes displayed receipts, pending IDs and customer data without clearing storage', async () => {
        seed(); const api = apis(); view(api); await ready(); lookup(another); await receiptRegion();
        act(() => api.invalidate()); await screen.findByRole('heading', { name: 'ต้องตรวจบัญชีใหม่' });
        expect(screen.queryByText('ลูกค้า A')).not.toBeInTheDocument();
        expect(screen.queryByRole('region', { name: 'ใบรับการประมวลผล' })).not.toBeInTheDocument();
        expect(screen.queryByText(new RegExp(REQUEST))).not.toBeInTheDocument();
        expect(screen.queryByText(new RegExp(another.requestId))).not.toBeInTheDocument();
        expect(readSlaProcessingPending(ADMIN)).toEqual(command); expect(api.processingApi.process).not.toHaveBeenCalled();
    });

    it('a late lookup after logout cannot display or settle the old account pending command', async () => {
        seed(); const response = deferred<SlaReceiptLookup>(), api = apis(); api.receiptApi.lookup.mockReturnValue(response.promise);
        view(api); await ready(); fireEvent.click(screen.getByRole('button', { name: 'ตรวจใบรับคำขอค้าง' }));
        act(() => api.invalidate()); await act(async () => response.resolve(found()));
        expect(screen.getByRole('heading', { name: 'ต้องตรวจบัญชีใหม่' })).toBeInTheDocument();
        expect(screen.queryByRole('region', { name: 'ใบรับการประมวลผล' })).not.toBeInTheDocument();
        expect(readSlaProcessingPending(ADMIN)).toEqual(command);
    });

    it('late POST identity failure stays private and retains the original uncertain pair', async () => {
        const response = deferred<SlaProcessingResult>(), api = apis(); api.processingApi.process.mockReturnValue(response.promise);
        view(api); await ready(); await choose(); confirm(); await waitFor(() => expect(api.processingApi.process).toHaveBeenCalledOnce());
        act(() => api.invalidate());
        await act(async () => response.reject(new SlaProcessingClientError('ACTOR_CHANGED_AFTER_REQUEST', 'บัญชีเปลี่ยน', 409)));
        expect(screen.queryByRole('region', { name: 'ใบรับการประมวลผล' })).not.toBeInTheDocument();
        expect(readSlaProcessingPending(ADMIN)).toEqual(command); expect(api.newRequestId).toHaveBeenCalledOnce();
    });

    it('explicit recheck under another Admin reads only the new actor queue and unsubscribes the old watcher', async () => {
        seed(); const api = apis(); const mounted = view(api); await ready(); act(() => api.invalidate());
        api.receiptApi.context.mockResolvedValue(context({ actor: { userId: OTHER, role: 'admin' } }));
        api.previewApi.read.mockResolvedValue(snapshot({ actor: { userId: OTHER, role: 'admin' }, rows: [] }));
        const storage = vi.spyOn(Storage.prototype, 'getItem');
        fireEvent.click(screen.getByRole('button', { name: 'ตรวจบัญชีใหม่' })); await ready();
        expect(storage.mock.calls.every(([key]) => key === slaProcessingPendingKey(OTHER))).toBe(true);
        expect(screen.queryByRole('region', { name: 'คำขอค้างในแท็บ' })).not.toBeInTheDocument();
        expect(api.unsubscribe).toHaveBeenCalledOnce(); expect(api.processingApi.process).not.toHaveBeenCalled();
        mounted.unmount(); expect(api.unsubscribe).toHaveBeenCalledTimes(2);
    });

    it('identity mismatch in a refreshed preview invalidates and hides old rows', async () => {
        const api = apis(); view(api); await ready();
        api.previewApi.read.mockResolvedValueOnce(snapshot({ actor: { userId: OTHER, role: 'admin' } }));
        fireEvent.click(screen.getByRole('button', { name: 'โหลดงานล่าสุด' }));
        await screen.findByRole('heading', { name: 'ต้องตรวจบัญชีใหม่' }); expect(screen.queryByText('ลูกค้า A')).not.toBeInTheDocument();
        expect(api.processingApi.process).not.toHaveBeenCalled();
    });

    it('watcher setup failure fails closed instead of leaving private task controls visible', async () => {
        const api = apis(); api.receiptApi.watchActor.mockImplementation(() => { throw new Error('listener denied'); });
        view(api); await screen.findByRole('heading', { name: 'ต้องตรวจบัญชีใหม่' });
        expect(screen.queryByText('ลูกค้า A')).not.toBeInTheDocument(); expect(api.processingApi.process).not.toHaveBeenCalled();
    });

    it('empty first-contact page does not imply every sales task is completed', async () => {
        const api = apis(context(), snapshot({ rows: [] })); view(api); await ready();
        expect(screen.getByText(/ไม่พบงานติดต่อครั้งแรกที่เปิดในหน้านี้/)).toHaveTextContent('ไม่ได้หมายความว่างานฝ่ายขายทั้งหมดเสร็จแล้ว');
        expect(api.processingApi.process).not.toHaveBeenCalled();
    });

    it('pagination hides old rows until the correctly bound page arrives without processing', async () => {
        const first = snapshot({ hasMore: true, rows: Array.from({ length: 20 }, (_, n) => row({ taskId: id(100 + n), customerId: id(200 + n), customerName: `ลูกค้า ${n}` })) });
        const api = apis(context(), first), response = deferred<SlaPreviewSnapshot>(); view(api); await ready();
        api.previewApi.read.mockReturnValueOnce(response.promise);
        fireEvent.click(screen.getByRole('button', { name: 'ถัดไป' })); expect(screen.queryByText('ลูกค้า 0')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'โหลดงานล่าสุด' })).toBeDisabled();
        await act(async () => response.resolve(snapshot({ page: 1, rows: [] }))); await ready();
        expect(screen.getByText('หน้า 2 · หน้าละ 20 งาน')).toBeInTheDocument();
        expect(api.previewApi.read.mock.calls).toEqual([[0], [1]]); expect(api.processingApi.process).not.toHaveBeenCalled();
    });

    it('unmounted receipt lookup cannot settle a pending command', async () => {
        seed(); const response = deferred<SlaReceiptLookup>(), api = apis(); api.receiptApi.lookup.mockReturnValue(response.promise);
        const mounted = view(api); await ready(); fireEvent.click(screen.getByRole('button', { name: 'ตรวจใบรับคำขอค้าง' }));
        mounted.unmount(); await act(async () => response.resolve(found()));
        expect(readSlaProcessingPending(ADMIN)).toEqual(command); expect(api.unsubscribe).toHaveBeenCalledOnce();
    });

    it('receipt-read authorization failure invalidates the view while retaining pending storage', async () => {
        seed(); const api = apis(); api.receiptApi.lookup.mockRejectedValue(new SlaReceiptClientError('FORBIDDEN', 'สิทธิ์เปลี่ยน', 403));
        view(api); await ready(); fireEvent.click(screen.getByRole('button', { name: 'ตรวจใบรับคำขอค้าง' }));
        await screen.findByRole('heading', { name: 'ต้องตรวจบัญชีใหม่' });
        expect(readSlaProcessingPending(ADMIN)).toEqual(command); expect(screen.queryByText('ลูกค้า A')).not.toBeInTheDocument();
    });
});
