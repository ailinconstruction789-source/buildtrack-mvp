import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: vi.fn() } } }));
import LeadOperations from '../LeadOperations';
import LeadWorkView from '../LeadWorkView';
import type { LeadWorkSnapshot } from '@/lib/sales/leadWorkReadContracts';
import type { LeadWorkInput } from '@/lib/sales/leadWorkContracts';
import type { LeadLifecycleInput } from '@/lib/sales/leadLifecycleContracts';
import type { LeadLifecycleContext } from '@/lib/sales/leadLifecycleReadContracts';
import { LeadLifecycleApiError } from '@/lib/sales/leadLifecycleClient';
import { readLeadWorkPending, writeLeadWorkPending } from '@/lib/sales/leadWorkPending';
import { leadLifecyclePendingKey, readLeadLifecyclePending, writeLeadLifecyclePending } from '@/lib/sales/leadLifecyclePending';

const ADMIN = '00000000-0000-4000-8000-000000000001';
const CUSTOMER = '00000000-0000-4000-8000-000000000002';
const OWNER = '00000000-0000-4000-8000-000000000003';
const TARGET = '00000000-0000-4000-8000-000000000004';
const REV = '00000000-0000-4000-8000-000000000005';
const REQUEST = '00000000-0000-4000-8000-000000000006';
const INTEREST = '00000000-0000-4000-8000-000000000007';
const scope = { customerId: CUSTOMER, interestId: null };
function snapshot(): LeadWorkSnapshot {
    return { actor: { userId: ADMIN, role: 'admin' }, scope, customer: { id: CUSTOMER, name: 'ลูกค้าทดสอบ', phone: null, leadCreatedAt: null },
        projectName: null, owner: { userId: OWNER, displayName: 'Sales เดิม', active: true }, scopeClosed: false,
        lifecycleRevision: REV, canWrite: true, asOf: '2026-09-16T12:00:00+07:00', currentAction: null,
        actions: [], activities: [], history: { limit: 20, actionsHasMore: false, activitiesHasMore: false } };
}
function context(): LeadLifecycleContext {
    return { work: snapshot(), candidates: [{ userId: TARGET, displayName: 'Sales ใหม่' }], candidatesTruncated: false,
        canReassign: true, canClose: true, blockers: { hasBookingHistory: false, hasOpenInterests: false },
        impact: { openSlaCount: 1, pendingNotificationCount: 2 } };
}
function lifecycle(): LeadLifecycleInput {
    return { requestId: REQUEST, command: 'reassign_owner', ...scope, expectedRevision: REV, expectedActionId: null,
        newOwnerUserId: TARGET, reason: 'ส่งต่องาน' };
}
function work(): LeadWorkInput {
    return { requestId: REV, command: 'set_next_action', ...scope, expectedActionId: null, reason: 'ติดตามต่อ',
        nextAction: { action: 'โทรสอบถาม', dueAt: '2026-09-18T09:00:00+07:00' } };
}
function setup(overrides: Partial<React.ComponentProps<typeof LeadOperations>> = {}) {
    const data = context();
    const props = { snapshot: data.work, context: data, lifecycleEnabled: true, disabled: false,
        workApi: { read: vi.fn().mockResolvedValue(data.work), save: vi.fn() },
        lifecycleApi: { read: vi.fn().mockResolvedValue(data), save: vi.fn() },
        onSaved: vi.fn(), onLockedChange: vi.fn(), onRefreshRequired: vi.fn().mockResolvedValue(undefined), ...overrides };
    return { ...render(<LeadOperations {...props} />), props };
}
function selectLifecycle() { fireEvent.click(screen.getByRole('button', { name: 'เปลี่ยนผู้ดูแล / ปิด Lost' })); }
function reviewLifecycle() {
    fireEvent.change(screen.getByLabelText('Sales ผู้ดูแลคนใหม่ *'), { target: { value: TARGET } });
    fireEvent.change(screen.getByLabelText('เหตุผลการเปลี่ยนแปลง *'), { target: { value: 'ส่งต่องาน' } });
    fireEvent.submit(screen.getByRole('form', { name: 'ตรวจทานการเปลี่ยนแปลง Lead' }));
}
beforeEach(() => { sessionStorage.clear(); vi.restoreAllMocks(); });
afterEach(cleanup);

describe('one write workspace per actor and scope', () => {
    it('mounts just one form and requires a separate lifecycle confirmation', () => {
        const { props } = setup();
        expect(screen.getAllByRole('form')).toHaveLength(1);
        selectLifecycle();
        expect(screen.queryByRole('form', { name: 'บันทึกงานติดตาม Lead' })).not.toBeInTheDocument();
        reviewLifecycle();
        expect(screen.getByRole('region', { name: 'ผลกระทบก่อนยืนยัน' })).toBeInTheDocument();
        expect(props.lifecycleApi.save).not.toHaveBeenCalled();
        expect(props.workApi.save).not.toHaveBeenCalled();
    });
    it('binds confirmation to loaded actor and locks switching synchronously', async () => {
        const { props } = setup(); vi.mocked(props.lifecycleApi.save).mockImplementation(() => new Promise(() => undefined));
        selectLifecycle(); reviewLifecycle();
        act(() => {
            fireEvent.click(screen.getByRole('button', { name: 'ยืนยันการเปลี่ยนแปลง Lead' }));
            fireEvent.click(screen.getByRole('button', { name: 'บันทึกการติดตาม' }));
        });
        await waitFor(() => expect(props.lifecycleApi.save).toHaveBeenCalledTimes(1));
        expect(props.lifecycleApi.save).toHaveBeenCalledWith(expect.objectContaining({ command: 'reassign_owner', expectedRevision: REV }), ADMIN);
        expect(screen.queryByRole('form', { name: 'บันทึกงานติดตาม Lead' })).not.toBeInTheDocument();
        expect(readLeadLifecyclePending(ADMIN, scope)).not.toBeNull();
        expect(props.onLockedChange).toHaveBeenCalledWith(true);
    });
    it('also locks the mode selector before the first work POST resolves', async () => {
        const { props } = setup(); vi.mocked(props.workApi.save).mockImplementation(() => new Promise(() => undefined));
        fireEvent.change(screen.getByLabelText('งานถัดไป *'), { target: { value: 'โทรสอบถาม' } });
        fireEvent.change(screen.getByLabelText('กำหนดงานถัดไป (กรุงเทพฯ UTC+07:00) *'), { target: { value: '2026-09-18T09:00:00' } });
        fireEvent.change(screen.getByLabelText('เหตุผล / รายละเอียดประกอบ *'), { target: { value: 'นัดหมาย' } });
        act(() => {
            fireEvent.submit(screen.getByRole('form', { name: 'บันทึกงานติดตาม Lead' }));
            selectLifecycle();
        });
        await waitFor(() => expect(props.workApi.save).toHaveBeenCalledTimes(1));
        expect(screen.queryByRole('form', { name: 'ตรวจทานการเปลี่ยนแปลง Lead' })).not.toBeInTheDocument();
        expect(props.lifecycleApi.save).not.toHaveBeenCalled();
    });
    it('recovers a lifecycle queue before permitting a work command', () => {
        writeLeadLifecyclePending(ADMIN, scope, lifecycle()); setup();
        expect(screen.getByText(REQUEST)).toBeInTheDocument();
        expect(screen.queryByRole('form', { name: 'บันทึกงานติดตาม Lead' })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'บันทึกการติดตาม' })).toBeDisabled();
    });
    it('does not enter a false pending-command block before lifecycle context is available', () => {
        const { props } = setup({ context: null }); selectLifecycle();
        expect(screen.getByRole('button', { name: 'เปลี่ยนผู้ดูแล / ปิด Lost' })).toBeDisabled();
        expect(screen.getByRole('form', { name: 'บันทึกงานติดตาม Lead' })).toBeInTheDocument();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(props.onLockedChange).not.toHaveBeenCalledWith(true);
        expect(props.lifecycleApi.save).not.toHaveBeenCalled();
    });
    it('recovers work without permitting a second lifecycle command', () => {
        writeLeadWorkPending(ADMIN, scope, work()); setup();
        expect(screen.getByRole('button', { name: 'เปลี่ยนผู้ดูแล / ปิด Lost' })).toBeDisabled();
        expect(screen.queryByRole('form', { name: 'ตรวจทานการเปลี่ยนแปลง Lead' })).not.toBeInTheDocument();
    });
    it('never bypasses a lifecycle queue just because that feature has been switched off', () => {
        writeLeadLifecyclePending(ADMIN, scope, lifecycle()); const { props } = setup({ lifecycleEnabled: false, context: null });
        expect(screen.getByRole('alert')).toHaveTextContent('มีคำขอเปลี่ยนผู้ดูแล/ปิด Lead ค้าง');
        expect(screen.getByText(REQUEST)).toBeInTheDocument(); expect(screen.queryByRole('form')).not.toBeInTheDocument();
        expect(props.lifecycleApi.read).not.toHaveBeenCalled(); expect(props.workApi.save).not.toHaveBeenCalled();
        expect(readLeadLifecyclePending(ADMIN, scope)).toEqual(lifecycle());
    });
    it('blocks both queues rather than guessing which one failed', () => {
        writeLeadLifecyclePending(ADMIN, scope, lifecycle()); writeLeadWorkPending(ADMIN, scope, work()); setup();
        expect(screen.getByRole('alert')).toHaveTextContent('พบคำขอค้างทั้ง');
        expect(screen.queryByRole('form')).not.toBeInTheDocument();
        expect(readLeadLifecyclePending(ADMIN, scope)).toEqual(lifecycle());
        expect(readLeadWorkPending(ADMIN, scope)).toEqual(work());
    });
    it('fails closed for a corrupt or inaccessible sibling queue, even while lifecycle is disabled', () => {
        sessionStorage.setItem(leadLifecyclePendingKey(ADMIN, scope), '{bad');
        setup({ lifecycleEnabled: false, context: null });
        expect(screen.getByRole('alert')).toHaveTextContent('ห้ามล้าง'); expect(screen.queryByRole('form')).not.toBeInTheDocument();
    });
    it('rechecks storage before switching after an external queue appears', () => {
        setup(); writeLeadLifecyclePending(ADMIN, scope, lifecycle()); selectLifecycle();
        expect(screen.getByRole('alert')).toHaveTextContent('พบคำขอค้างหลังเปิดหน้า');
        expect(screen.queryByRole('form')).not.toBeInTheDocument();
    });
    it('isolates a queue belonging to another user or project', () => {
        writeLeadLifecyclePending(TARGET, scope, lifecycle());
        writeLeadWorkPending(ADMIN, { ...scope, interestId: INTEREST }, { ...work(), interestId: INTEREST });
        setup(); expect(screen.getByRole('form', { name: 'บันทึกงานติดตาม Lead' })).toBeInTheDocument();
        expect(screen.queryByText(REQUEST)).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'เปลี่ยนผู้ดูแล / ปิด Lost' })).not.toBeDisabled();
    });
});

describe('integrated lifecycle read and refresh boundary', () => {
    it('uses a single coherent lifecycle read when enabled, not an independently loaded work snapshot', async () => {
        const data = context(); const api = { read: vi.fn(), save: vi.fn() };
        const lifecycleApi = { read: vi.fn().mockResolvedValue(data), save: vi.fn() };
        render(<LeadWorkView scope={scope} api={api} lifecycleEnabled lifecycleApi={lifecycleApi} />);
        await screen.findByText('ลูกค้าทดสอบ');
        expect(lifecycleApi.read).toHaveBeenCalledWith(scope); expect(api.read).not.toHaveBeenCalled();
    });
    it('does not call lifecycle GET or expose controls when the server flag is off', async () => {
        const api = { read: vi.fn().mockResolvedValue(snapshot()), save: vi.fn() };
        const lifecycleApi = { read: vi.fn(), save: vi.fn() };
        render(<LeadWorkView scope={scope} api={api} lifecycleApi={lifecycleApi} />);
        await screen.findByText('ลูกค้าทดสอบ');
        expect(lifecycleApi.read).not.toHaveBeenCalled();
        expect(screen.queryByRole('button', { name: 'เปลี่ยนผู้ดูแล / ปิด Lost' })).not.toBeInTheDocument();
    });
    it('does not fall back when enabled lifecycle read fails', async () => {
        const api = { read: vi.fn(), save: vi.fn() };
        const lifecycleApi = { read: vi.fn().mockRejectedValue(new LeadLifecycleApiError('SETUP_REQUIRED', 'ยังไม่พร้อม', 503)), save: vi.fn() };
        render(<LeadWorkView scope={scope} api={api} lifecycleEnabled lifecycleApi={lifecycleApi} />);
        await screen.findByRole('alert'); expect(api.read).not.toHaveBeenCalled(); expect(screen.queryByRole('form')).not.toBeInTheDocument();
    });
    it('retains confirmed success when the next GET fails without posting again', async () => {
        const lifecycleApi = { read: vi.fn().mockResolvedValueOnce(context()).mockRejectedValueOnce(new Error('read failed')),
            save: vi.fn().mockResolvedValue({ revision: TARGET, nextActionId: null, replayed: false }) };
        render(<LeadWorkView scope={scope} api={{ read: vi.fn(), save: vi.fn() }} lifecycleEnabled lifecycleApi={lifecycleApi} />);
        await screen.findByText('ลูกค้าทดสอบ'); selectLifecycle(); reviewLifecycle();
        fireEvent.click(screen.getByRole('button', { name: 'ยืนยันการเปลี่ยนแปลง Lead' }));
        await screen.findByRole('alert');
        expect(screen.getByRole('status')).toHaveTextContent('ทำรายการ Lead สำเร็จแล้ว');
        expect(lifecycleApi.save).toHaveBeenCalledTimes(1); expect(readLeadLifecyclePending(ADMIN, scope)).toBeNull();
    });
});
