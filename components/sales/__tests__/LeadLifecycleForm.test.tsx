import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: vi.fn() } } }));
import LeadLifecycleForm from '../LeadLifecycleForm';
import { LeadLifecycleApiError } from '@/lib/sales/leadLifecycleClient';
import { parseLeadLifecycleInput, type LeadLifecycleInput, type LeadLifecycleResult } from '@/lib/sales/leadLifecycleContracts';
import type { LeadLifecycleContext } from '@/lib/sales/leadLifecycleReadContracts';
import { leadLifecyclePendingKey, readLeadLifecyclePending, writeLeadLifecyclePending } from '@/lib/sales/leadLifecyclePending';

const ADMIN = '00000000-0000-4000-8000-000000000001';
const OWNER = '00000000-0000-4000-8000-000000000002';
const TARGET = '00000000-0000-4000-8000-000000000003';
const CUSTOMER = '00000000-0000-4000-8000-000000000004';
const REVISION = '00000000-0000-4000-8000-000000000005';
const ACTION = '00000000-0000-4000-8000-000000000006';
const REQUEST = '00000000-0000-4000-8000-000000000007';
const scope = { customerId: CUSTOMER, interestId: null };
const success = { revision: TARGET, nextActionId: REQUEST, replayed: false };

function context(): LeadLifecycleContext {
    return { work: { actor: { userId: ADMIN, role: 'admin' }, scope, customer: { id: CUSTOMER, name: 'ลูกค้าตรวจทาน', phone: '0812345678', leadCreatedAt: '2026-09-01T10:00:00+07:00' },
        projectName: null, owner: { userId: OWNER, displayName: 'ผู้ดูแลเดิม', active: true }, scopeClosed: false, canWrite: true,
        lifecycleRevision: REVISION, asOf: '2026-09-16T12:00:00+07:00',
        currentAction: { ...scope, id: ACTION, ownerUserId: OWNER, action: 'โทรติดตามเดิม', dueAt: '2026-09-15T10:00:00+07:00', recordedAt: '2026-09-14T10:00:00+07:00', status: 'open', closedAt: null, closeReason: null },
        actions: [], activities: [], history: { limit: 20, actionsHasMore: false, activitiesHasMore: false } },
        candidates: [{ userId: OWNER, displayName: 'ผู้ดูแลเดิม' }, { userId: TARGET, displayName: 'ฝ่ายขายใหม่' }], candidatesTruncated: false,
        canReassign: true, canClose: true, blockers: { hasBookingHistory: false, hasOpenInterests: false }, impact: { openSlaCount: 3, pendingNotificationCount: 5 } };
}
function pending(command: LeadLifecycleInput['command'] = 'reassign_owner'): LeadLifecycleInput {
    return parseLeadLifecycleInput({ command, ...scope, requestId: REQUEST, expectedRevision: REVISION, expectedActionId: ACTION,
        reason: 'เหตุผลคำขอเดิม', ...(command === 'reassign_owner' ? { newOwnerUserId: TARGET } : {}) });
}
function setup(data = context(), extra: Partial<React.ComponentProps<typeof LeadLifecycleForm>> = {}) {
    const props = { context: data, save: vi.fn().mockResolvedValue(success), onSaved: vi.fn(), onLockedChange: vi.fn(), onRefreshRequired: vi.fn().mockResolvedValue(undefined), ...extra };
    const rendered = render(<LeadLifecycleForm {...props} />);
    return { ...rendered, ...props };
}
function fill() {
    fireEvent.change(screen.getByLabelText('Sales ผู้ดูแลคนใหม่ *'), { target: { value: TARGET } });
    fireEvent.change(screen.getByLabelText('เหตุผลการเปลี่ยนแปลง *'), { target: { value: 'จัดผู้รับผิดชอบใหม่' } });
}
function review() { fireEvent.submit(screen.getByRole('form', { name: 'ตรวจทานการเปลี่ยนแปลง Lead' })); }
function confirm() { fireEvent.click(screen.getByRole('button', { name: 'ยืนยันการเปลี่ยนแปลง Lead' })); }
beforeEach(() => { sessionStorage.clear(); vi.restoreAllMocks(); });
afterEach(cleanup);

describe('lifecycle review and command authority', () => {
    it('does not send or persist on review and clearly describes impact/unchanged history before explicit confirmation', async () => {
        const { save } = setup(); fill(); review();
        expect(save).not.toHaveBeenCalled(); expect(readLeadLifecyclePending(ADMIN, scope)).toBeNull();
        expect(screen.getByRole('region', { name: 'ผลกระทบก่อนยืนยัน' })).toBeInTheDocument();
        expect(screen.getByText(/ลูกค้า: ลูกค้าตรวจทาน/)).toBeInTheDocument();
        expect(screen.getByText(/ผู้ดูแลคนใหม่: ฝ่ายขายใหม่/)).toBeInTheDocument();
        expect(screen.getByText(/เลยกำหนดแล้ว ณ เวลาโหลดข้อมูล/)).toBeInTheDocument();
        expect(screen.getByText(/งาน SLA ที่เปิดอยู่: 3 รายการ/)).toHaveTextContent('ซึ่งจะถอน: 5 รายการ');
        expect(screen.getByText(/สิ่งที่ไม่เปลี่ยน:/)).toHaveTextContent('กำหนดบริการเดิม');
        confirm(); await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
        expect(save).toHaveBeenCalledWith(expect.objectContaining({ command: 'reassign_owner', expectedRevision: REVISION, expectedActionId: ACTION, newOwnerUserId: TARGET }));
    });
    it('keeps old inactive Sales transferable by Admin', async () => {
        const data = context(); const altered = { ...data, work: { ...data.work, owner: { ...data.work.owner, active: false }, canWrite: false } };
        const { save } = setup(altered); fill(); review(); expect(screen.getByText(/ผู้ดูแลปัจจุบัน: ผู้ดูแลเดิม \(ไม่พร้อมใช้งาน\)/)).toBeInTheDocument();
        confirm(); await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    });
    it.each(['owner', 'other_sales'])('ignores permissive flags for read-only %s', kind => {
        const data = context(); const changed = { ...data, work: { ...data.work, actor: { userId: TARGET, role: kind === 'owner' ? 'owner' as const : 'sales' as const } } };
        const { save } = setup(changed); expect(screen.getByText(/อ่านอย่างเดียว:/)).toBeInTheDocument();
        expect(screen.queryByRole('form')).not.toBeInTheDocument(); expect(save).not.toHaveBeenCalled();
    });
    it('allows only owned Sales close and never allows their reassign option', async () => {
        const data = context(); const changed = { ...data, work: { ...data.work, actor: { userId: OWNER, role: 'sales' as const } }, candidates: [] };
        const { save } = setup(changed, { save: vi.fn().mockResolvedValue({ ...success, nextActionId: null }) });
        expect(screen.getByRole('option', { name: 'ย้ายผู้ดูแล (Admin)' })).toBeDisabled();
        fireEvent.change(screen.getByLabelText('เหตุผลการเปลี่ยนแปลง *'), { target: { value: 'ลูกค้าไม่สนใจแล้ว' } }); review();
        expect(screen.getByText(/ไม่ถือว่าทำงานสำเร็จ/)).toBeInTheDocument(); confirm();
        await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ command: 'close_lost' })));
        expect((save as ReturnType<typeof vi.fn>).mock.calls[0][0]).not.toHaveProperty('newOwnerUserId');
    });
    it.each(['booking', 'open_interests', 'closed', 'scope_mismatch'])('blocks close when %s despite canClose', blocker => {
        const data = context();
        const changed = { ...data, canReassign: false, blockers: { hasBookingHistory: blocker === 'booking', hasOpenInterests: blocker === 'open_interests' },
            work: { ...data.work, scopeClosed: blocker === 'closed', customer: { ...data.work.customer, id: blocker === 'scope_mismatch' ? TARGET : CUSTOMER } } };
        setup(changed); expect(screen.queryByRole('form')).not.toBeInTheDocument();
    });
    it('filters loaded candidates, omits current owner and reports truncation with no free UUID entry', () => {
        const data = context(); setup({ ...data, candidatesTruncated: true });
        expect(screen.queryByRole('option', { name: 'ผู้ดูแลเดิม' })).not.toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('ค้นหา Sales ในรายชื่อที่โหลด'), { target: { value: 'ไม่พบ' } });
        expect(screen.getByText(/ห้ามกรอกรหัสผู้ใช้เอง/)).toBeInTheDocument();
        expect(screen.getByText(/รายชื่อที่โหลดเป็นเพียงบางส่วน/)).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('ค้นหา Sales ในรายชื่อที่โหลด'), { target: { value: 'ฝ่ายขายใหม่' } });
        expect(screen.getByRole('option', { name: 'ฝ่ายขายใหม่' })).toBeInTheDocument();
    });
    it('requires a real different candidate and a valid bounded reason before review', () => {
        const { save } = setup(); review(); expect(screen.getByRole('alert')).toHaveTextContent('เลือก Sales คนใหม่');
        fill(); fireEvent.change(screen.getByLabelText('เหตุผลการเปลี่ยนแปลง *'), { target: { value: 'ก'.repeat(1001) } }); review();
        expect(screen.getByRole('alert')).toHaveTextContent('1,000'); expect(save).not.toHaveBeenCalled();
        expect(screen.queryByRole('button', { name: 'ยืนยันการเปลี่ยนแปลง Lead' })).not.toBeInTheDocument();
    });
    it.each(['reason', 'target', 'search', 'command'])('invalidates preview after changing field %s', field => {
        setup(); fill(); review();
        if (field === 'reason') fireEvent.change(screen.getByLabelText('เหตุผลการเปลี่ยนแปลง *'), { target: { value: 'เหตุผลใหม่' } });
        if (field === 'target') fireEvent.change(screen.getByLabelText('Sales ผู้ดูแลคนใหม่ *'), { target: { value: '' } });
        if (field === 'search') fireEvent.change(screen.getByLabelText('ค้นหา Sales ในรายชื่อที่โหลด'), { target: { value: 'ใหม่' } });
        if (field === 'command') fireEvent.change(screen.getByLabelText('รายการที่ต้องการทำ'), { target: { value: 'close_lost' } });
        expect(screen.queryByRole('button', { name: 'ยืนยันการเปลี่ยนแปลง Lead' })).not.toBeInTheDocument();
    });
    it.each(['revision', 'action', 'owner', 'impact'])('invalidates preview permanently when context %s changes then reverts', field => {
        const first = context(); const view = setup(first); fill(); review();
        const changed = { ...first, impact: field === 'impact' ? { ...first.impact, openSlaCount: 4 } : first.impact,
            work: { ...first.work, lifecycleRevision: field === 'revision' ? TARGET : REVISION,
                owner: field === 'owner' ? { ...first.work.owner, userId: REQUEST } : first.work.owner,
                currentAction: field === 'action' ? null : first.work.currentAction } };
        view.rerender(<LeadLifecycleForm {...view} context={changed} />);
        expect(screen.queryByRole('button', { name: 'ยืนยันการเปลี่ยนแปลง Lead' })).not.toBeInTheDocument();
        view.rerender(<LeadLifecycleForm {...view} context={first} />);
        expect(screen.queryByRole('button', { name: 'ยืนยันการเปลี่ยนแปลง Lead' })).not.toBeInTheDocument(); expect(view.save).not.toHaveBeenCalled();
    });
    it('isolates actor and scope on rerender rather than carrying preview/payload into another identity', () => {
        const first = context(); const view = setup(first); fill(); review();
        const changed = { ...first, work: { ...first.work, actor: { userId: TARGET, role: 'admin' as const }, scope: { customerId: REQUEST, interestId: null }, customer: { ...first.work.customer, id: REQUEST }, currentAction: null } };
        view.rerender(<LeadLifecycleForm {...view} context={changed} />);
        expect(screen.queryByRole('button', { name: 'ยืนยันการเปลี่ยนแปลง Lead' })).not.toBeInTheDocument();
        expect(screen.getByLabelText('เหตุผลการเปลี่ยนแปลง *')).toHaveValue(''); expect(view.save).not.toHaveBeenCalled();
    });
    it('disabled blocks review/confirm, invalidates old preview and blocks pending retry', () => {
        const view = setup(); fill(); review(); view.rerender(<LeadLifecycleForm {...view} disabled />);
        expect(screen.queryByRole('button', { name: 'ยืนยันการเปลี่ยนแปลง Lead' })).not.toBeInTheDocument(); review(); expect(view.save).not.toHaveBeenCalled();
        view.rerender(<LeadLifecycleForm {...view} disabled={false} />);
        expect(screen.queryByRole('button', { name: 'ยืนยันการเปลี่ยนแปลง Lead' })).not.toBeInTheDocument(); view.unmount();
        writeLeadLifecyclePending(ADMIN, scope, pending()); const other = setup(context(), { disabled: true });
        expect(screen.getByRole('button', { name: 'ส่งคำขอเปลี่ยนแปลงเดิมซ้ำ' })).toBeDisabled(); expect(other.save).not.toHaveBeenCalled();
    });
});

describe('lifecycle durable uncertainty', () => {
    it('persists and synchronously locks the parent before sending, with a strict double-click guard', async () => {
        const onLockedChange = vi.fn(); let finish!: (value: LeadLifecycleResult) => void;
        const save = vi.fn((input: LeadLifecycleInput) => {
            expect(onLockedChange).toHaveBeenLastCalledWith(true);
            expect(readLeadLifecyclePending(ADMIN, scope)).toEqual(input);
            return new Promise<LeadLifecycleResult>(resolve => { finish = resolve; });
        });
        setup(context(), { save, onLockedChange }); fill(); review();
        const button = screen.getByRole('button', { name: 'ยืนยันการเปลี่ยนแปลง Lead' });
        fireEvent.click(button); fireEvent.click(button); expect(save).toHaveBeenCalledTimes(1);
        expect(screen.getByLabelText('เหตุผลการเปลี่ยนแปลง *')).toBeDisabled();
        const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
        await act(async () => finish(success)); expect(readLeadLifecyclePending(ADMIN, scope)).toBeNull();
    });
    it('restores after reload and retries original action/revision/key despite fresh context changes', async () => {
        const save = vi.fn().mockRejectedValue(new Error('private diagnostic'));
        const first = setup(context(), { save }); fill(); review(); confirm();
        await screen.findByRole('button', { name: 'ส่งคำขอเปลี่ยนแปลงเดิมซ้ำ' }); const sent = save.mock.calls[0][0]; first.unmount();
        const data = context(); const changed = { ...data, work: { ...data.work, lifecycleRevision: TARGET, currentAction: null, owner: { ...data.work.owner, userId: TARGET, displayName: 'ฝ่ายขายใหม่' } } };
        const retry = vi.fn().mockResolvedValue({ ...success, replayed: true }); setup(changed, { save: retry });
        expect(retry).not.toHaveBeenCalled(); expect(screen.queryByText('private diagnostic')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'ส่งคำขอเปลี่ยนแปลงเดิมซ้ำ' }));
        await waitFor(() => expect(retry).toHaveBeenCalledWith(sent));
    });
    it.each([['FORBIDDEN', 403], ['ACTOR_CHANGED', 409], ['STALE_SCOPE', 409], ['FEATURE_DISABLED', 503], ['IDEMPOTENCY_CONFLICT', 409]])(
        'keeps an earlier uncertain receipt frozen after later %s', async (code, status) => {
            const save = vi.fn().mockRejectedValueOnce(new Error('network')).mockRejectedValueOnce(new LeadLifecycleApiError(String(code), 'ตรวจคำขอเดิม', Number(status)));
            setup(context(), { save }); fill(); review(); confirm();
            await screen.findByRole('button', { name: 'ส่งคำขอเปลี่ยนแปลงเดิมซ้ำ' });
            fireEvent.click(screen.getByRole('button', { name: 'ส่งคำขอเปลี่ยนแปลงเดิมซ้ำ' })); await screen.findByText('ตรวจคำขอเดิม');
            expect(readLeadLifecyclePending(ADMIN, scope)).toEqual(save.mock.calls[0][0]);
            expect(save.mock.calls[1][0]).toEqual(save.mock.calls[0][0]); expect(screen.getByLabelText('เหตุผลการเปลี่ยนแปลง *')).toBeDisabled();
        },
    );
    it.each([['STALE_SCOPE', 409], ['STALE_ACTION', 409], ['FORBIDDEN', 403], ['ACTOR_CHANGED', 409], ['SCOPE_CLOSED', 409]])(
        'requires fresh context after first definitive %s before another review', async (code, status) => {
            const save = vi.fn().mockRejectedValue(new LeadLifecycleApiError(String(code), 'ข้อมูลเปลี่ยนแล้ว', Number(status)));
            const view = setup(context(), { save }); fill(); review(); confirm();
            await screen.findByRole('button', { name: 'โหลดสถานะล่าสุดก่อนทำรายการใหม่' });
            expect(readLeadLifecyclePending(ADMIN, scope)).toBeNull(); review(); expect(save).toHaveBeenCalledTimes(1);
            expect(screen.getByLabelText('เหตุผลการเปลี่ยนแปลง *')).toBeDisabled();
            fireEvent.click(screen.getByRole('button', { name: 'โหลดสถานะล่าสุดก่อนทำรายการใหม่' }));
            await waitFor(() => expect(screen.getByLabelText('เหตุผลการเปลี่ยนแปลง *')).not.toBeDisabled()); expect(view.onRefreshRequired).toHaveBeenCalledTimes(1);
        },
    );
    it('keeps normal first validation rejection editable, requiring another review rather than reusing old confirmation', async () => {
        const save = vi.fn().mockRejectedValue(new LeadLifecycleApiError('INVALID_INPUT', 'แก้เหตุผล', 400));
        setup(context(), { save }); fill(); review(); confirm(); await screen.findByText('แก้เหตุผล');
        expect(readLeadLifecyclePending(ADMIN, scope)).toBeNull(); expect(screen.getByLabelText('เหตุผลการเปลี่ยนแปลง *')).not.toBeDisabled();
        expect(screen.queryByRole('button', { name: 'ยืนยันการเปลี่ยนแปลง Lead' })).not.toBeInTheDocument();
    });
    it('preserves close receipt when the latest scope is now closed without claiming the original failed', () => {
        writeLeadLifecyclePending(ADMIN, scope, pending('close_lost'));
        const data = context(); const { save } = setup({ ...data, work: { ...data.work, scopeClosed: true }, canClose: false, canReassign: false });
        expect(screen.getByText(REQUEST)).toBeInTheDocument(); expect(screen.getByText(/ไม่ได้แปลว่าคำขอเดิมล้มเหลว/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'ส่งคำขอเปลี่ยนแปลงเดิมซ้ำ' })).toBeDisabled(); expect(save).not.toHaveBeenCalled();
        expect(readLeadLifecyclePending(ADMIN, scope)).toEqual(pending('close_lost'));
    });
    it('blocks writes on storage denial/corruption and provides no discard control', () => {
        const deny = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
        const first = setup(); fill(); review(); confirm(); expect(first.save).not.toHaveBeenCalled();
        expect(screen.getByRole('alert')).toHaveTextContent('ห้ามล้างข้อมูลแท็บ'); deny.mockRestore(); first.unmount();
        sessionStorage.setItem(leadLifecyclePendingKey(ADMIN, scope), '{corrupt'); const other = setup();
        expect(screen.getByRole('alert')).toHaveTextContent('Admin'); expect(other.save).not.toHaveBeenCalled();
        expect(screen.queryByRole('button', { name: /ล้าง|ทิ้งคำขอ/ })).not.toBeInTheDocument();
    });
    it('never restores another actor/scope receipt', () => {
        writeLeadLifecyclePending(ADMIN, scope, pending()); const data = context();
        setup({ ...data, work: { ...data.work, actor: { userId: TARGET, role: 'admin' } } });
        expect(screen.queryByText(REQUEST)).not.toBeInTheDocument(); expect(screen.getByLabelText('เหตุผลการเปลี่ยนแปลง *')).toHaveValue('');
        expect(readLeadLifecyclePending(ADMIN, scope)).toEqual(pending());
    });
    it('keeps a confirmed save separate from failing refresh callback and never sends it again', async () => {
        const save = vi.fn().mockResolvedValue(success);
        setup(context(), { save, onSaved: () => { throw new Error('refresh failed'); }, onRefreshRequired: vi.fn().mockRejectedValue(new Error('still offline')) });
        fill(); review(); confirm(); await screen.findByText(/ยืนยันว่าบันทึกการเปลี่ยนแปลงสำเร็จแล้ว/);
        expect(readLeadLifecyclePending(ADMIN, scope)).toBeNull(); expect(screen.getByRole('alert')).toHaveTextContent('บันทึกสำเร็จแล้ว');
        fireEvent.click(screen.getByRole('button', { name: 'โหลดสถานะล่าสุดก่อนทำรายการใหม่' }));
        await screen.findByText(/โหลดสถานะล่าสุดไม่สำเร็จ/); expect(save).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('button', { name: 'ยืนยันการเปลี่ยนแปลง Lead' })).not.toBeInTheDocument();
    });
});
