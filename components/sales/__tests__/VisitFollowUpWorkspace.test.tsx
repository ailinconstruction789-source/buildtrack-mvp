import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('@/lib/sales/visitFollowUpClient', () => ({ visitFollowUpApi: {} }));
import VisitFollowUpWorkspace from '../VisitFollowUpWorkspace';
import { LeadWorkApiError, type LeadWorkApi } from '@/lib/sales/leadWorkClient';
import type { LeadWorkSnapshot } from '@/lib/sales/leadWorkReadContracts';
import { parseLeadWorkInput, type LeadWorkResult } from '@/lib/sales/leadWorkContracts';
import { leadWorkPendingKey, readLeadWorkPending, writeLeadWorkPending } from '@/lib/sales/leadWorkPending';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scope = { customerId: id(1), interestId: id(2) };
const result: LeadWorkResult = { nextActionId: id(6), activityId: null, replayed: false };
function snapshot(change: Partial<LeadWorkSnapshot> = {}): LeadWorkSnapshot {
  return { actor: { userId: id(3), role: 'sales' }, scope, customer: { id: id(1), name: 'ลูกค้าทดสอบติดตาม', phone: null, leadCreatedAt: null },
    projectName: 'โครงการทดสอบ', owner: { userId: id(3), displayName: 'Sales ทดสอบ', active: true }, canWrite: true,
    scopeClosed: false, lifecycleRevision: id(4), asOf: '2026-09-29T02:00:00Z', currentAction: null, actions: [], activities: [],
    history: { limit: 20, actionsHasMore: false, activitiesHasMore: false }, ...change };
}
const apiFor = () => ({ read: vi.fn<LeadWorkApi['read']>().mockResolvedValue(snapshot()), save: vi.fn<LeadWorkApi['save']>().mockResolvedValue(result),
  watchIdentity: vi.fn<(callback: () => void) => () => void>().mockReturnValue(vi.fn()) });
const mount = (api = apiFor()) => render(<VisitFollowUpWorkspace scope={scope} api={api} />);
async function fill() {
  fireEvent.change(await screen.findByLabelText('งานถัดไป *'), { target: { value: 'โทรนัดรอบถัดไป' } });
  fireEvent.change(screen.getByLabelText('กำหนดงานถัดไป (กรุงเทพฯ UTC+07:00) *'), { target: { value: '2026-09-30T10:30:00' } });
  fireEvent.change(screen.getByLabelText('เหตุผล / รายละเอียดประกอบ *'), { target: { value: 'ลูกค้าขอพิจารณา' } });
}
async function submit() { await act(async () => { fireEvent.submit(screen.getByRole('form')); }); }
beforeEach(() => { sessionStorage.clear(); vi.clearAllMocks(); }); afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe('interest-only visit follow-up', () => {
  it('only exposes next-action controls and writes Sales-owned scope with a prior receipt', async () => {
    const api = apiFor(); api.save.mockImplementation(async (input, actor) => { expect(readLeadWorkPending(actor, scope)).toEqual(input); return result; });
    mount(api); await fill(); expect(screen.queryByLabelText('ประเภทการบันทึก')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('สิ่งที่ทำจริง *')).not.toBeInTheDocument(); await submit();
    expect(api.save).toHaveBeenCalledWith(expect.objectContaining({ ...scope, command: 'set_next_action', expectedActionId: null }), id(3));
    expect(api.save.mock.calls[0][0]).not.toHaveProperty('attempt'); expect(readLeadWorkPending(id(3), scope)).toBeNull();
  });
  it.each(['admin', 'owner'] as const)('keeps %s read-only even if the response claims canWrite=true', async role => {
    const api = apiFor(); api.read.mockResolvedValue(snapshot({ actor: { userId: id(3), role } })); mount(api);
    await screen.findByText('ลูกค้าทดสอบติดตาม'); expect(screen.queryByRole('form')).not.toBeInTheDocument();
    expect(screen.getByText(/Admin และ Owner ดูได้อย่างเดียว/)).toBeInTheDocument(); expect(api.save).not.toHaveBeenCalled();
  });
  it('keeps another Sales read-only', async () => {
    const api = apiFor(); api.read.mockResolvedValue(snapshot({ actor: { userId: id(90), role: 'sales' } })); mount(api);
    await screen.findByText('ลูกค้าทดสอบติดตาม'); expect(screen.queryByRole('form')).not.toBeInTheDocument();
  });
  it('does not send or delete an old record_attempt receipt', async () => {
    const input = parseLeadWorkInput({ requestId: id(7), command: 'record_attempt', ...scope, expectedActionId: null,
      nextAction: { action: 'ติดตาม', dueAt: '2026-09-30T02:00:00Z' }, reason: 'เดิม', attempt: { action: 'โทร', channel: 'phone', result: 'no_answer', occurredAt: '2026-09-29T01:00:00Z' } });
    writeLeadWorkPending(id(3), scope, input); const api = apiFor(); mount(api);
    expect(await screen.findByRole('alert')).toHaveTextContent('อีกประเภท'); expect(readLeadWorkPending(id(3), scope)).toEqual(input);
    expect(screen.getByRole('button', { name: 'บันทึกงานติดตาม' })).toBeDisabled(); expect(api.save).not.toHaveBeenCalled();
  });
  it('freezes unknown outcomes and retries only the same receipt after explicit input', async () => {
    const api = apiFor(); api.save.mockRejectedValueOnce(new Error('network')).mockRejectedValueOnce(new LeadWorkApiError('FORBIDDEN', 'สิทธิ์เปลี่ยน', 403));
    mount(api); await fill(); await submit(); const input = api.save.mock.calls[0][0];
    expect(screen.getByLabelText('งานถัดไป *')).toBeDisabled(); expect(screen.queryByRole('link')).not.toBeInTheDocument();
    const unload = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(unload); expect(unload.defaultPrevented).toBe(true);
    await submit(); expect(api.save.mock.calls[1][0]).toEqual(input); expect(readLeadWorkPending(id(3), scope)).toEqual(input);
  });
  it('does not automatically send a recovered receipt', async () => {
    const input = parseLeadWorkInput({ requestId: id(7), command: 'set_next_action', ...scope, expectedActionId: null,
      nextAction: { action: 'ติดตาม', dueAt: '2026-09-30T02:00:00Z' }, reason: 'เดิม' });
    writeLeadWorkPending(id(3), scope, input); const api = apiFor(); mount(api);
    await screen.findByRole('button', { name: 'ส่งซ้ำด้วยคำขอเดิม' }); expect(api.save).not.toHaveBeenCalled();
  });
  it('never resends a confirmed success if refreshing the current plan fails', async () => {
    const api = apiFor(); api.read.mockResolvedValueOnce(snapshot()).mockRejectedValue(new Error('โหลดไม่ได้')); mount(api); await fill(); await submit();
    fireEvent.click(screen.getByRole('button', { name: 'โหลดสถานะล่าสุดก่อนแก้ไข' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('โหลดไม่ได้'); expect(api.save).toHaveBeenCalledOnce();
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
  });
  it('blocks retries after successful save with failed receipt cleanup', async () => {
    const api = apiFor(); mount(api); await fill(); vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('denied'); }); await submit();
    expect(screen.getByRole('alert')).toHaveTextContent('บันทึกสำเร็จแล้ว'); expect(screen.queryByRole('button', { name: 'ส่งซ้ำด้วยคำขอเดิม' })).not.toBeInTheDocument();
    expect(api.save).toHaveBeenCalledOnce();
  });
  it('fails closed on malformed pending storage without erasing it', async () => {
    sessionStorage.setItem(leadWorkPendingKey(id(3), scope), '{broken'); const api = apiFor(); mount(api);
    expect(await screen.findByRole('alert')).toHaveTextContent('ห้ามล้าง'); expect(api.save).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(leadWorkPendingKey(id(3), scope))).toBe('{broken');
  });
  it('rejects a mismatched scope and keeps snapshots hidden on identity changes', async () => {
    const api = apiFor(); let changed!: () => void, resolve!: (value: LeadWorkSnapshot) => void;
    api.watchIdentity.mockImplementation(callback => { changed = callback; return vi.fn(); });
    api.read.mockResolvedValueOnce(snapshot()).mockImplementationOnce(() => new Promise(done => { resolve = done; })); mount(api);
    await screen.findByText('ลูกค้าทดสอบติดตาม'); act(() => changed()); expect(screen.queryByText('ลูกค้าทดสอบติดตาม')).not.toBeInTheDocument();
    await waitFor(() => expect(api.read).toHaveBeenCalledTimes(2));
    await act(async () => resolve(snapshot({ scope: { ...scope, interestId: id(88) } })));
    expect(screen.getByRole('alert')).toHaveTextContent('ไม่ตรง'); expect(screen.queryByRole('form')).not.toBeInTheDocument();
  });
  it('never reads an unscoped central customer', async () => {
    const api = apiFor(); render(<VisitFollowUpWorkspace scope={{ ...scope, interestId: null }} api={api} />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('ต้องเลือกโครงการ')); expect(api.read).not.toHaveBeenCalled();
  });
});
