import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: vi.fn() } } }));
import LeadWorkView from '../LeadWorkView';
import LeadWorkForm from '../LeadWorkForm';
import { LeadWorkApiError } from '@/lib/sales/leadWorkClient';
import type { LeadWorkSnapshot } from '@/lib/sales/leadWorkReadContracts';
import { parseLeadWorkInput, type LeadWorkInput, type LeadWorkResult } from '@/lib/sales/leadWorkContracts';
import { leadWorkPendingKey, readLeadWorkPending, writeLeadWorkPending } from '@/lib/sales/leadWorkPending';

const USER = '00000000-0000-4000-8000-000000000001';
const CUSTOMER = '00000000-0000-4000-8000-000000000002';
const OTHER = '00000000-0000-4000-8000-000000000003';
const ACTION = '00000000-0000-4000-8000-000000000004';
const REQUEST = '00000000-0000-4000-8000-000000000005';
const scope = { customerId: CUSTOMER, interestId: null };
const saved = { nextActionId: ACTION, activityId: null, replayed: false };
function snapshot(overrides: Partial<LeadWorkSnapshot> = {}): LeadWorkSnapshot {
    return { actor: { userId: USER, role: 'sales' }, scope, customer: { id: CUSTOMER, name: 'ลูกค้า A', phone: null, leadCreatedAt: null },
        projectName: null, owner: { userId: USER, displayName: 'ฝ่ายขาย A', active: true }, canWrite: true, scopeClosed: false, lifecycleRevision: REQUEST,
        asOf: '2026-09-16T12:00:00+07:00', currentAction: null, actions: [], activities: [],
        history: { limit: 20, actionsHasMore: false, activitiesHasMore: false }, ...overrides };
}
function command(): LeadWorkInput {
    return parseLeadWorkInput({ requestId: REQUEST, command: 'record_attempt', ...scope, expectedActionId: null,
        nextAction: { action: 'โทรติดตาม', dueAt: '2026-09-18T09:45:32.123456+07:00' }, reason: 'นัดหมายใหม่',
        attempt: { action: 'โทรสอบถาม', channel: 'phone', result: 'no_answer', occurredAt: '2026-09-16T11:30:10.123456+07:00' } });
}
function fill() {
    fireEvent.change(screen.getByLabelText('งานถัดไป *'), { target: { value: 'โทรติดตาม' } });
    fireEvent.change(screen.getByLabelText('กำหนดงานถัดไป (กรุงเทพฯ UTC+07:00) *'), { target: { value: '2026-09-18T09:45:32' } });
    fireEvent.change(screen.getByLabelText('เหตุผล / รายละเอียดประกอบ *'), { target: { value: 'ลูกค้าขอนัดใหม่' } });
}
function submit() { fireEvent.submit(screen.getByRole('form', { name: 'บันทึกงานติดตาม Lead' })); }
function form(data = snapshot(), save = vi.fn().mockResolvedValue(saved)) {
    const onSaved = vi.fn(), onLockedChange = vi.fn(), onRefreshRequired = vi.fn().mockResolvedValue(undefined);
    const result = render(<LeadWorkForm snapshot={data} save={save} onSaved={onSaved} onLockedChange={onLockedChange} onRefreshRequired={onRefreshRequired} />);
    return { ...result, save, onSaved, onLockedChange, onRefreshRequired };
}
beforeEach(() => { sessionStorage.clear(); vi.restoreAllMocks(); });
afterEach(cleanup);

describe('lead work form safety', () => {
    it.each([
        { actor: { userId: USER, role: 'owner' as const } },
        { owner: { userId: OTHER, displayName: 'เจ้าของอื่น', active: true } },
        { owner: { userId: USER, displayName: 'เจ้าของไม่พร้อม', active: false } },
        { scopeClosed: true }, { canWrite: false },
    ])('keeps read-only context read-only even when canWrite is accidentally true: %j', change => {
        const { save } = form(snapshot(change));
        expect(screen.getByText(/อ่านอย่างเดียว:/)).toBeInTheDocument();
        expect(screen.queryByRole('form')).not.toBeInTheDocument(); expect(save).not.toHaveBeenCalled();
    });
    it('allows Admin editing without crediting work to the Sales owner or posting an owner field', async () => {
        const { save } = form(snapshot({ actor: { userId: OTHER, role: 'admin' } })); fill(); submit();
        await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
        expect(Object.keys(save.mock.calls[0][0]).sort()).toEqual(['command', 'customerId', 'expectedActionId', 'interestId', 'nextAction', 'reason', 'requestId']);
    });
    it('persists before sending and prevents simultaneous submits synchronously', async () => {
        let finish!: (value: LeadWorkResult) => void;
        const save = vi.fn((input: LeadWorkInput) => {
            expect(readLeadWorkPending(USER, scope)).toEqual(input);
            return new Promise<LeadWorkResult>(resolve => { finish = resolve; });
        });
        form(snapshot(), save); fill(); submit(); submit();
        expect(save).toHaveBeenCalledTimes(1); expect(screen.getByLabelText('งานถัดไป *')).toBeDisabled();
        const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
        await act(async () => finish(saved));
        expect(readLeadWorkPending(USER, scope)).toBeNull();
    });
    it('uses the snapshot expected ID, explicit Bangkok seconds and no fabricated attempt time', async () => {
        const currentAction = { ...scope, id: ACTION, ownerUserId: USER, action: 'เดิม', dueAt: '2026-09-17T09:00:00Z', recordedAt: '2026-09-16T09:00:00+07:00', status: 'open' as const, closedAt: null, closeReason: null };
        const { save } = form(snapshot({ currentAction })); fill();
        fireEvent.change(screen.getByLabelText('ประเภทการบันทึก'), { target: { value: 'record_attempt' } });
        expect(screen.getByLabelText('เวลาที่ทำจริง (กรุงเทพฯ UTC+07:00) *')).toHaveValue('');
        submit(); expect(save).not.toHaveBeenCalled();
        fireEvent.change(screen.getByLabelText('สิ่งที่ทำจริง *'), { target: { value: 'โทรสอบถาม' } });
        fireEvent.change(screen.getByLabelText('ช่องทางติดต่อ *'), { target: { value: 'phone' } });
        fireEvent.change(screen.getByLabelText('ผลการติดต่อ *'), { target: { value: 'no_answer' } });
        fireEvent.change(screen.getByLabelText('เวลาที่ทำจริง (กรุงเทพฯ UTC+07:00) *'), { target: { value: '2026-09-16T11:00:12' } });
        submit();
        await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ expectedActionId: ACTION,
            nextAction: { action: 'โทรติดตาม', dueAt: expect.stringMatching(/^2026-09-18T09:45:32(?:\.000)?\+07:00$/) },
            attempt: { action: 'โทรสอบถาม', channel: 'phone', result: 'no_answer', occurredAt: expect.stringMatching(/^2026-09-16T11:00:12(?:\.000)?\+07:00$/) },
        })));
    });
    it('keeps local/definitive validation errors editable and generates a fresh key only for the next logical request', async () => {
        const save = vi.fn().mockRejectedValue(new LeadWorkApiError('TIME_INVALID', 'ตรวจวันเวลา', 400));
        form(snapshot(), save); submit(); expect(save).not.toHaveBeenCalled(); fill(); submit();
        await screen.findByText('ตรวจวันเวลา'); expect(screen.getByLabelText('งานถัดไป *')).not.toBeDisabled();
        expect(readLeadWorkPending(USER, scope)).toBeNull(); submit();
        await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
        expect(save.mock.calls[0][0].requestId).not.toBe(save.mock.calls[1][0].requestId);
    });
    it.each([
        ['FORBIDDEN', 403], ['FEATURE_DISABLED', 503], ['IDEMPOTENCY_CONFLICT', 409], ['ACTOR_CHANGED', 409],
    ])('never discards earlier uncertainty after retry %s', async (code, status) => {
        const save = vi.fn().mockRejectedValueOnce(new Error('private network diagnostic'))
            .mockRejectedValueOnce(new LeadWorkApiError(String(code), 'ให้ Admin ตรวจสอบคำขอเดิม', Number(status)));
        form(snapshot(), save); fill(); submit();
        await screen.findByRole('button', { name: 'ส่งซ้ำด้วยคำขอเดิม' }); submit();
        await screen.findByText('ให้ Admin ตรวจสอบคำขอเดิม');
        expect(screen.getByLabelText('งานถัดไป *')).toBeDisabled();
        expect(save.mock.calls[1][0]).toEqual(save.mock.calls[0][0]);
        expect(readLeadWorkPending(USER, scope)).toEqual(save.mock.calls[0][0]);
        expect(screen.queryByText('private network diagnostic')).not.toBeInTheDocument();
    });
    it('recovers exact pending payload after remount despite changed currentAction, with no automatic retry', async () => {
        const save = vi.fn().mockRejectedValue(new Error('unknown'));
        const first = form(snapshot(), save); fill(); submit();
        await screen.findByRole('button', { name: 'ส่งซ้ำด้วยคำขอเดิม' });
        const original = save.mock.calls[0][0]; first.unmount();
        const currentAction = { ...scope, id: ACTION, ownerUserId: USER, action: 'แผนใหม่', dueAt: '2026-09-19T09:00:00Z', recordedAt: '2026-09-16T09:00:00Z', status: 'open' as const, closedAt: null, closeReason: null };
        const retry = vi.fn().mockResolvedValue({ ...saved, replayed: true });
        form(snapshot({ currentAction }), retry);
        expect(retry).not.toHaveBeenCalled(); expect(screen.getByLabelText('งานถัดไป *')).toBeDisabled(); submit();
        await waitFor(() => expect(retry).toHaveBeenCalledWith(original));
    });
    it('preserves and displays pending request for Admin review when write permission is lost', () => {
        writeLeadWorkPending(USER, scope, command()); const { save } = form(snapshot({ canWrite: false }));
        expect(screen.getByText(REQUEST)).toBeInTheDocument(); expect(screen.getByText(/ให้ Admin ตรวจรหัสคำขอนี้/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'ส่งซ้ำด้วยคำขอเดิม' })).toBeDisabled(); submit(); expect(save).not.toHaveBeenCalled();
        expect(readLeadWorkPending(USER, scope)).toEqual(command());
    });
    it('requires a successful explicit refresh after stale-action rejection before any new write', async () => {
        const save = vi.fn().mockRejectedValue(new LeadWorkApiError('STALE_ACTION', 'แผนเปลี่ยนแล้ว', 409));
        const { onRefreshRequired } = form(snapshot(), save); fill(); submit();
        await screen.findByRole('button', { name: 'โหลดสถานะล่าสุดก่อนแก้ไข' }); submit(); expect(save).toHaveBeenCalledTimes(1);
        expect(screen.getByLabelText('งานถัดไป *')).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'โหลดสถานะล่าสุดก่อนแก้ไข' }));
        await waitFor(() => expect(screen.getByLabelText('งานถัดไป *')).not.toBeDisabled());
        expect(onRefreshRequired).toHaveBeenCalledTimes(1);
    });
    it.each([['ACTOR_CHANGED', 409], ['FORBIDDEN', 403], ['INACTIVE_OWNER', 409], ['SCOPE_CLOSED', 409], ['UNAUTHENTICATED', 401]])(
        'requires a new read after first definitive %s without losing a prior uncertain receipt', async (code, status) => {
            const save = vi.fn().mockRejectedValue(new LeadWorkApiError(String(code), 'ตรวจสิทธิ์ล่าสุด', Number(status)));
            form(snapshot(), save); fill(); submit();
            await screen.findByRole('button', { name: 'โหลดสถานะล่าสุดก่อนแก้ไข' });
            expect(screen.getByLabelText('งานถัดไป *')).toBeDisabled();
            expect(readLeadWorkPending(USER, scope)).toBeNull(); submit(); expect(save).toHaveBeenCalledTimes(1);
        },
    );
    it('blocks denied storage before sending and preserves corrupt storage instead of overwriting', () => {
        const denied = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
        const { save, unmount } = form(); fill(); submit(); expect(save).not.toHaveBeenCalled();
        expect(screen.getByRole('alert')).toHaveTextContent('ห้ามล้างข้อมูลแท็บ'); denied.mockRestore(); unmount();
        sessionStorage.setItem(leadWorkPendingKey(USER, scope), '{corrupt');
        const second = form(); expect(screen.getByRole('alert')).toHaveTextContent('Admin');
        expect(second.save).not.toHaveBeenCalled(); expect(sessionStorage.getItem(leadWorkPendingKey(USER, scope))).toBe('{corrupt');
    });
    it('does not replay another actor or project receipt', () => {
        writeLeadWorkPending(USER, scope, command());
        form(snapshot({ actor: { userId: OTHER, role: 'admin' }, scope: { ...scope, interestId: OTHER } }));
        expect(screen.queryByText(REQUEST)).not.toBeInTheDocument(); expect(screen.getByLabelText('งานถัดไป *')).toHaveValue('');
        expect(readLeadWorkPending(USER, scope)).toEqual(command());
    });
});

describe('lead work workspace', () => {
    it('shows cancelled history as closure, not completion, preserving due date and former owner', async () => {
        const closed = { ...scope, id: ACTION, ownerUserId: USER, action: 'งานก่อนปิด Lead', dueAt: '2026-09-16T10:00:00+07:00',
            recordedAt: '2026-09-15T09:00:00+07:00', status: 'cancelled' as const, closedAt: '2026-09-16T11:00:00+07:00', closeReason: 'ไม่สนใจแล้ว' };
        const api = { read: vi.fn().mockResolvedValue(snapshot({ scopeClosed: true, canWrite: false, actions: [closed] })), save: vi.fn() };
        render(<LeadWorkView scope={scope} api={api} />);
        await screen.findByText('ลูกค้า A');
        expect(screen.getByText(/ปิดงานตามขอบเขต Lead \(ไม่ใช่ทำสำเร็จ\)/)).toBeInTheDocument();
        expect(screen.getByText(`ผู้รับผิดชอบแผนรุ่นนี้: ${USER}`)).toBeInTheDocument();
        expect(screen.getByText(/กำหนดเดิม:/)).toBeInTheDocument();
        expect(screen.queryByRole('form')).not.toBeInTheDocument();
        expect(api.save).not.toHaveBeenCalled();
    });
    it('shows server-time overdue, prior reasons, capped history and honest no-answer/unknown evidence', async () => {
        const currentAction = { ...scope, id: ACTION, ownerUserId: USER, action: 'โทรเลยกำหนด', dueAt: '2026-09-16T10:00:00+07:00', recordedAt: '2026-09-15T09:00:00+07:00', status: 'open' as const, closedAt: null, closeReason: null };
        const data = snapshot({ currentAction, history: { limit: 20, actionsHasMore: true, activitiesHasMore: true },
            actions: [{ ...currentAction, id: OTHER, action: 'แผนเก่า', status: 'superseded', closedAt: '2026-09-16T09:00:00+07:00', closeReason: 'ลูกค้าขอเลื่อน' }],
            activities: [{ ...scope, id: REQUEST, activityType: 'follow_up', action: 'โทรแล้วไม่รับ', channel: 'phone', result: 'no_answer',
                occurredAt: '2026-09-16T10:00:00+07:00', recordedAt: '2026-09-16T10:01:00+07:00', performedByUserId: USER, recordedByUserId: USER, note: null }] });
        render(<LeadWorkView scope={scope} api={{ read: vi.fn().mockResolvedValue(data), save: vi.fn() }} />);
        await screen.findByText('ลูกค้า A');
        expect(screen.getByText(/เลยกำหนด ณ เวลาโหลดข้อมูล/)).toBeInTheDocument();
        expect(screen.getByText(/เหตุผลเปลี่ยนแผน: ลูกค้าขอเลื่อน/)).toBeInTheDocument();
        expect(screen.getByText(/ไม่รับสาย \/ ไม่ตอบ \(ไม่ใช่ติดต่อสำเร็จ\)/)).toBeInTheDocument();
        expect(screen.getAllByText(/แสดงล่าสุดไม่เกิน 20 รายการ/)).toHaveLength(2);
        expect(screen.getByText('ไม่ทราบเบอร์ (ข้อมูลเก่า)')).toBeInTheDocument();
    });
    it.each(['FEATURE_DISABLED', 'SETUP_REQUIRED'])('shows disabled state %s without legacy fallback', async code => {
        const api = { read: vi.fn().mockRejectedValue(new LeadWorkApiError(code, 'ยังไม่เปิด', 503)), save: vi.fn() };
        render(<LeadWorkView scope={scope} api={api} />); await screen.findByText('ยังไม่เปิดระบบติดตาม Lead ใหม่');
        expect(screen.queryByRole('form')).not.toBeInTheDocument(); expect(api.save).not.toHaveBeenCalled();
    });
    it('ignores an old scope read resolving after a new scope, with no leaked customer or pending payload', async () => {
        writeLeadWorkPending(USER, scope, command());
        let oldRead!: (data: LeadWorkSnapshot) => void;
        const otherScope = { customerId: OTHER, interestId: null };
        const api = { read: vi.fn().mockImplementationOnce(() => new Promise<LeadWorkSnapshot>(resolve => { oldRead = resolve; }))
            .mockResolvedValueOnce(snapshot({ scope: otherScope, customer: { id: OTHER, name: 'ลูกค้า B', phone: null, leadCreatedAt: null } })), save: vi.fn() };
        const { rerender } = render(<LeadWorkView scope={scope} api={api} />);
        await waitFor(() => expect(api.read).toHaveBeenCalledTimes(1));
        rerender(<LeadWorkView scope={otherScope} api={api} />); await screen.findByText('ลูกค้า B');
        await act(async () => oldRead(snapshot()));
        expect(screen.queryByText('ลูกค้า A')).not.toBeInTheDocument(); expect(screen.queryByText(REQUEST)).not.toBeInTheDocument();
        expect(screen.getByLabelText('งานถัดไป *')).toHaveValue('');
    });
    it('locks refresh/back during pending and binds the loaded actor to save', async () => {
        const api = { read: vi.fn().mockResolvedValue(snapshot()), save: vi.fn().mockRejectedValue(new Error('network')) };
        render(<LeadWorkView scope={scope} api={api} />); await screen.findByText('ลูกค้า A'); fill(); submit();
        await screen.findByRole('button', { name: 'ส่งซ้ำด้วยคำขอเดิม' });
        expect(screen.getByRole('button', { name: 'รีเฟรชข้อมูล' })).toBeDisabled();
        expect(screen.queryByRole('link', { name: /กลับ Lead ส่วนกลาง/ })).not.toBeInTheDocument();
        expect(api.save).toHaveBeenCalledWith(expect.any(Object), USER);
    });
    it('preserves success independently of a failed refresh and never resubmits the save', async () => {
        const api = { read: vi.fn().mockResolvedValueOnce(snapshot()).mockRejectedValueOnce(new Error('refresh failed')), save: vi.fn().mockResolvedValue(saved) };
        render(<LeadWorkView scope={scope} api={api} />); await screen.findByText('ลูกค้า A'); fill(); submit();
        await screen.findByRole('alert');
        expect(screen.getByRole('status')).toHaveTextContent('บันทึกงานติดตามสำเร็จแล้ว');
        expect(api.save).toHaveBeenCalledTimes(1); expect(readLeadWorkPending(USER, scope)).toBeNull();
    });
    it('keeps a saved form read-only while refreshing and respects changed permissions afterwards', async () => {
        let finish!: (value: LeadWorkSnapshot) => void;
        const api = { read: vi.fn().mockResolvedValueOnce(snapshot())
            .mockImplementationOnce(() => new Promise<LeadWorkSnapshot>(resolve => { finish = resolve; })), save: vi.fn().mockResolvedValue(saved) };
        render(<LeadWorkView scope={scope} api={api} />); await screen.findByText('ลูกค้า A'); fill(); submit();
        await screen.findByText(/บันทึกงานติดตามสำเร็จแล้ว/);
        expect(screen.queryByRole('button', { name: 'บันทึกงานติดตาม' })).not.toBeInTheDocument();
        await act(async () => finish(snapshot({ owner: { userId: OTHER, displayName: 'เจ้าของใหม่', active: true }, canWrite: false })));
        expect(screen.getByText(/อ่านอย่างเดียว:/)).toBeInTheDocument();
        expect(screen.queryByRole('form')).not.toBeInTheDocument(); expect(api.save).toHaveBeenCalledTimes(1);
    });
});
