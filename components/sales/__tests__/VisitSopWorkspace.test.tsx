import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
import VisitSopWorkspace from '../VisitSopWorkspace';
import { VisitSopApiError, type VisitSopApi } from '@/lib/sales/visitSopClient';
import { readVisitSopPending, writeVisitSopPending, visitSopPendingKey } from '@/lib/sales/visitSopPending';
import { sopAnchor, sopId, sopInput, sopResult, sopRun, sopSnapshot } from '@/lib/sales/__tests__/visitSopFixtures';
import type { VisitSopResult, VisitSopSnapshot } from '@/lib/sales/visitSopContracts';
const apiFor = () => ({ read: vi.fn<VisitSopApi['read']>().mockResolvedValue(sopSnapshot()), save: vi.fn<VisitSopApi['save']>().mockImplementation(async input => sopResult(input)),
  watchIdentity: vi.fn<NonNullable<VisitSopApi['watchIdentity']>>().mockReturnValue(vi.fn()) });
const mount = (api: VisitSopApi) => render(<VisitSopWorkspace anchor={sopAnchor()} api={api} />);
async function fillStart() {
  fireEvent.change(await screen.findByLabelText('บ้าน / แปลงที่จะพาชม *'), { target: { value: 'SYNTHETIC-HOUSE' } });
  fireEvent.change(screen.getByLabelText('วันเวลาที่ทำรายการจริง (กรุงเทพฯ) *'), { target: { value: '2026-09-24T12:00:00' } });
  fireEvent.change(screen.getByLabelText('เหตุผล / บันทึกการทำงานครั้งนี้ *'), { target: { value: 'ทำตามจริง' } });
}
async function submit() { await act(async () => { fireEvent.submit(screen.getByRole('form', { name: 'บันทึก SOP พาชม' })); }); }
beforeEach(() => { sessionStorage.clear(); vi.clearAllMocks(); }); afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe('SOP workspace and command safety', () => {
  it('shows real next action, links only to narrow follow-up when enabled, and states SOP cannot complete Visit', async () => {
    const api = apiFor(); render(<VisitSopWorkspace anchor={sopAnchor()} api={api} followUpEnabled />); await screen.findByText('ลูกค้าสมมติ SOP');
    expect(screen.getByRole('region', { name: 'งานติดตามจริง' })).toHaveTextContent('โทรติดตาม');
    expect(screen.getByRole('link', { name: 'ดู / กำหนดงานติดตามครั้งถัดไป' })).toHaveAttribute('href', `/sales-crm/visit-follow-up?customerId=${sopId(1)}&interestId=${sopId(2)}`);
    expect(screen.getByText(/การทำ SOP ครบไม่ทำให้ Visit สำเร็จ/)).toBeInTheDocument(); expect(api.save).not.toHaveBeenCalled();
  });
  it('does not link generic lead-work when follow-up is disabled', async () => {
    mount(apiFor()); await screen.findByText('ลูกค้าสมมติ SOP');
    expect(screen.queryByRole('link', { name: 'ดู / กำหนดงานติดตามครั้งถัดไป' })).not.toBeInTheDocument();
  });
  it('hides the follow-up link while SOP has an unresolved write', async () => {
    const api = apiFor(); api.save.mockRejectedValue(new Error('unknown'));
    render(<VisitSopWorkspace anchor={sopAnchor()} api={api} followUpEnabled />);
    await fillStart(); await submit();
    expect(screen.queryByRole('link', { name: 'ดู / กำหนดงานติดตามครั้งถัดไป' })).not.toBeInTheDocument();
  });
  it.each(['admin', 'owner'] as const)('keeps %s read-only with no manual correction or impersonation', async role => {
    const api = apiFor(), snapshot = sopSnapshot(); snapshot.actor.role = role; snapshot.scope.canWrite = false; snapshot.run = sopRun(); api.read.mockResolvedValue(snapshot); mount(api);
    await screen.findByText('ลูกค้าสมมติ SOP'); expect(screen.queryByRole('form')).not.toBeInTheDocument(); expect(screen.getByText(/ยังไม่มีเครื่องมือแก้หลักฐานย้อนหลัง/)).toBeInTheDocument();
  });
  it('writes ahead before sending, prevents double submit, and blocks navigation until resolved', async () => {
    const api = apiFor(); let resolve!: (value: VisitSopResult) => void;
    api.save.mockImplementation((input, actor) => { expect(readVisitSopPending(actor)).toEqual(input); return new Promise(done => { resolve = done; }); });
    mount(api); await fillStart(); await submit(); fireEvent.submit(screen.getByRole('form')); expect(api.save).toHaveBeenCalledOnce();
    expect(screen.getByLabelText('เหตุผล / บันทึกการทำงานครั้งนี้ *')).toBeDisabled(); const unload = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(unload); expect(unload.defaultPrevented).toBe(true);
    await act(async () => resolve(sopResult(api.save.mock.calls[0][0]))); expect(readVisitSopPending(sopId(5))).toBeNull();
  });
  it('recovers immutable pending input without auto-send and retains it after a later forbidden response', async () => {
    const first = apiFor(); first.save.mockRejectedValue(new Error('unknown')); const view = mount(first); await fillStart(); await submit(); const input = first.save.mock.calls[0][0]; view.unmount();
    const next = apiFor(); next.save.mockRejectedValue(new VisitSopApiError('FORBIDDEN', 'สิทธิ์เปลี่ยนแล้ว', 403)); mount(next);
    const retry = await screen.findByRole('button', { name: 'ตรวจผลซ้ำด้วยคำขอเดิม' }); expect(next.save).not.toHaveBeenCalled(); await act(async () => { fireEvent.click(retry); });
    expect(next.save).toHaveBeenCalledWith(input, sopId(5)); expect(readVisitSopPending(sopId(5))).toEqual(input); expect(screen.getByRole('alert')).toHaveTextContent('สิทธิ์เปลี่ยนแล้ว');
  });
  it('allows editing after only a definitive first rejection', async () => {
    const api = apiFor(); api.save.mockRejectedValue(new VisitSopApiError('ALREADY_STARTED', 'โหลดรายการเดิม', 409)); mount(api); await fillStart(); await submit();
    expect(readVisitSopPending(sopId(5))).toBeNull(); expect(screen.getByLabelText('เหตุผล / บันทึกการทำงานครั้งนี้ *')).not.toBeDisabled();
  });
  it('never resends successful save on refresh failure and links the pending result to its own customer/anchor', async () => {
    const input = sopInput({ customerId: sopId(88), appointmentId: null, visitId: sopId(89) }); writeVisitSopPending(sopId(5), input);
    const api = apiFor(); api.read.mockResolvedValueOnce(sopSnapshot()).mockRejectedValue(new Error('โหลดล่าสุดไม่ได้')); mount(api);
    const retry = await screen.findByRole('button', { name: 'ตรวจผลซ้ำด้วยคำขอเดิม' }); await act(async () => { fireEvent.click(retry); });
    expect(screen.getByRole('alert')).toHaveTextContent('โหลดล่าสุดไม่ได้'); expect(screen.queryByRole('form')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'เปิด SOP ที่บันทึกสำเร็จ' })).toHaveAttribute('href', `/sales-crm/sop?customerId=${sopId(88)}&interestId=${sopId(2)}&visitId=${sopId(89)}`);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'โหลดข้อมูลใหม่' })); }); expect(api.save).toHaveBeenCalledOnce();
  });
  it('keeps a confirmed result non-resendable when receipt cleanup fails', async () => {
    const api = apiFor(); mount(api); await fillStart(); vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('denied'); }); await submit();
    expect(screen.getByText('บันทึก SOP สำเร็จแล้ว ห้ามส่งซ้ำ')).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'ตรวจผลซ้ำด้วยคำขอเดิม' })).toBeDisabled(); fireEvent.submit(screen.getByRole('form')); expect(api.save).toHaveBeenCalledOnce();
  });
  it('blocks sends for broken storage and preserves corrupt evidence', async () => {
    const raw = '{broken'; sessionStorage.setItem(visitSopPendingKey(sopId(5)), raw); const api = apiFor(); mount(api);
    expect(await screen.findByRole('alert')).toHaveTextContent('ห้ามล้างข้อมูลแท็บ'); expect(screen.getByRole('button', { name: 'เริ่ม SOP' })).toBeDisabled(); expect(api.save).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(visitSopPendingKey(sopId(5)))).toBe(raw);
  });
  it('hides old customer, recap and forms immediately on identity change, discarding late save UI', async () => {
    const api = apiFor(); let changed!: () => void, resolve!: (result: VisitSopResult) => void, nextRead!: (snapshot: VisitSopSnapshot) => void;
    api.watchIdentity.mockImplementation(callback => { changed = callback; return vi.fn(); }); api.save.mockImplementation(() => new Promise(done => { resolve = done; }));
    api.read.mockResolvedValueOnce(sopSnapshot()).mockImplementationOnce(() => new Promise(done => { nextRead = done; }));
    mount(api); await fillStart(); await submit(); const input = api.save.mock.calls[0][0]; act(() => changed());
    expect(screen.queryByText('ลูกค้าสมมติ SOP')).not.toBeInTheDocument(); expect(screen.queryByRole('form')).not.toBeInTheDocument(); expect(screen.queryByRole('region', { name: 'คำขอ SOP ค้าง' })).not.toBeInTheDocument();
    const snapshot = sopSnapshot(); snapshot.actor = { userId: sopId(99), role: 'admin' }; snapshot.scope.canWrite = false;
    await act(async () => { nextRead(snapshot); resolve(sopResult(input)); });
    expect(screen.queryByRole('link', { name: 'เปิด SOP ที่บันทึกสำเร็จ' })).not.toBeInTheDocument(); expect(readVisitSopPending(sopId(5))).toBeNull();
  });
  it('pages event evidence without old editable data and ignores late old-anchor reads', async () => {
    const api = apiFor(), snapshot = sopSnapshot(); snapshot.run = sopRun(); snapshot.eventsHasMore = true;
    snapshot.events = Array.from({ length: 50 }, (_, i) => ({ id: sopId(100 + i), command: 'save_stage', stage: 'stage_a', occurredAt: '2026-09-24T02:00:00Z', recordedAt: '2026-09-24T02:01:00Z', actorUserId: sopId(5), reason: 'ตรวจแล้ว' }));
    let resolve!: (snapshot: VisitSopSnapshot) => void; api.read.mockResolvedValueOnce(snapshot).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const view = mount(api); fireEvent.click(await screen.findByRole('button', { name: 'ประวัติ SOP ถัดไป' })); expect(screen.queryByRole('form')).not.toBeInTheDocument();
    expect(api.read).toHaveBeenLastCalledWith({ ...sopAnchor(), eventPage: 1 });
    const next = sopSnapshot(); next.scope = { ...next.scope, appointmentId: sopId(88), customerName: 'ลูกค้าใหม่' }; api.read.mockResolvedValueOnce(next);
    view.rerender(<VisitSopWorkspace anchor={{ ...sopAnchor(), appointmentId: sopId(88) }} api={api} />); await screen.findByText('ลูกค้าใหม่');
    await act(async () => resolve({ ...snapshot, eventPage: 1 })); expect(screen.queryByText('ลูกค้าสมมติ SOP')).not.toBeInTheDocument();
  });
});
