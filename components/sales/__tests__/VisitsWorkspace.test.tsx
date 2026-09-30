import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
import VisitsWorkspace from '../VisitsWorkspace';
import { VisitsApiError, type VisitsApi } from '@/lib/sales/visitsClient';
import { readVisitsPending, visitsPendingKey, writeVisitsPending } from '@/lib/sales/visitsPending';
import type { VisitsSnapshot } from '@/lib/sales/visitsContracts';
import { actorId, appointmentId, customerId, interestId, vid, visitId, visitInput, visitResult, visitsScope, visitsSnapshot } from './visitsFixtures';
const apiFor = (snapshot = visitsSnapshot()) => ({ read: vi.fn<VisitsApi['read']>().mockResolvedValue(snapshot),
  save: vi.fn<VisitsApi['save']>().mockImplementation(async input => visitResult(input)) });
const renderWorkspace = (api: VisitsApi, selectedInterest = interestId) => render(<VisitsWorkspace api={api} customerId={customerId} interestId={selectedInterest} />);
async function walkIn() {
  fireEvent.click(await screen.findByRole('button', { name: 'เช็คอิน Walk-in ไม่มีนัด' }));
  fireEvent.change(screen.getByLabelText('วันเวลาเกิดเหตุการณ์จริง (เวลากรุงเทพฯ) *'), { target: { value: '2026-09-23T09:00' } });
  fireEvent.change(screen.getByLabelText('เหตุผล *'), { target: { value: 'ลูกค้ามาถึงโครงการแล้ว' } });
  await act(async () => { fireEvent.submit(screen.getByRole('form', { name: 'บันทึกนัดหมายและเข้าชม' })); });
}
beforeEach(() => { sessionStorage.clear(); vi.clearAllMocks(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe('central appointments and visits workspace', () => {
  it('links each unfinished Visit to QR, completed Visit to its own response, and no cancelled link', async () => {
    const snapshot = visitsSnapshot();
    snapshot.visits.push({ ...snapshot.visits[0], id: vid(81), status: 'completed', completedAt: '2026-09-23T10:00:00+07:00', completedVoiceId: vid(82) });
    snapshot.visits.push({ ...snapshot.visits[0], id: vid(83), status: 'cancelled' });
    const api = apiFor(snapshot); const view = render(<VisitsWorkspace api={api} customerId={customerId} interestId={interestId} voicesEnabled />);
    expect(await screen.findByRole('link', { name: 'QR แบบประเมิน Customer Voices' })).toHaveAttribute('href', `/sales-crm/customer-voices?customerId=${customerId}&interestId=${interestId}&visitId=${visitId}`);
    expect(screen.getByRole('link', { name: 'ดู Customer Voices ของครั้งนี้' })).toHaveAttribute('href', `/sales-crm/customer-voices?customerId=${customerId}&interestId=${interestId}&visitId=${vid(81)}`);
    expect(within(screen.getByRole('article', { name: `การเข้าชม ${vid(83)}` })).queryByRole('link')).not.toBeInTheDocument();
    view.rerender(<VisitsWorkspace api={api} customerId={customerId} interestId={interestId} />);
    expect(screen.queryByRole('link', { name: /Customer Voices/ })).not.toBeInTheDocument();
  });
  it('links both appointment and Visit to the same SOP workflow only when enabled', async () => {
    const api = apiFor(); const view = render(<VisitsWorkspace api={api} customerId={customerId} interestId={interestId} sopEnabled />);
    expect(await screen.findByRole('link', { name: `SOP เตรียมบ้าน / ประวัติของนัด ${appointmentId}` })).toHaveAttribute('href', `/sales-crm/sop?customerId=${customerId}&interestId=${interestId}&appointmentId=${appointmentId}`);
    expect(screen.getByRole('link', { name: `SOP พาชม / ปิดบ้าน / ประวัติ Visit ${visitId}` })).toHaveAttribute('href', `/sales-crm/sop?customerId=${customerId}&interestId=${interestId}&visitId=${visitId}`);
    view.rerender(<VisitsWorkspace api={api} customerId={customerId} interestId={interestId} />);
    expect(screen.queryByRole('link', { name: /SOP/ })).not.toBeInTheDocument();
  });
  it('hides SOP navigation while editing or retaining an uncertain Visit command', async () => {
    const api = apiFor(); api.save.mockRejectedValue(new Error('offline'));
    render(<VisitsWorkspace api={api} customerId={customerId} interestId={interestId} sopEnabled />);
    await walkIn(); expect(await screen.findByRole('button', { name: 'ตรวจผลซ้ำด้วยคำขอเดิม' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /SOP/ })).not.toBeInTheDocument();
  });
  it('shows scoped appointment, Visit and event histories without treating check-in as successful', async () => {
    renderWorkspace(apiFor()); await screen.findByText('ลูกค้านัดชม');
    expect(screen.getByLabelText('ลูกค้าและโครงการที่สนใจ')).toHaveTextContent('โครงการทดสอบ A');
    expect(screen.getByRole('article', { name: `การเข้าชม ${visitId}` })).toHaveTextContent('รอ Customer Voices — ยังไม่สำเร็จ');
    expect(screen.getByRole('article', { name: `เหตุการณ์ ${vid(8)}` })).toHaveTextContent('ลูกค้ายืนยันนัดหมาย');
    expect(screen.queryByRole('button', { name: /สำเร็จ|ลบ/ })).not.toBeInTheDocument();
  });
  it('offers appointment actions only for scheduled/rescheduled rows, not attended or cancelled ones', async () => {
    const snapshot = visitsSnapshot(); snapshot.appointments.push({ ...snapshot.appointments[0], id: vid(50), status: 'cancelled' });
    renderWorkspace(apiFor(snapshot)); await screen.findByText('ลูกค้านัดชม');
    expect(within(screen.getByRole('article', { name: `นัดหมาย ${appointmentId}` })).getAllByRole('button')).toHaveLength(4);
    expect(within(screen.getByRole('article', { name: `นัดหมาย ${vid(50)}` })).queryAllByRole('button')).toHaveLength(0);
  });
  it('shows validated completion evidence without a manual-complete or cancel-completed control', async () => {
    const snapshot = visitsSnapshot(); snapshot.visits[0] = { ...snapshot.visits[0], status: 'completed', completedAt: '2026-09-23T10:00:00+07:00', completedVoiceId: vid(80) };
    renderWorkspace(apiFor(snapshot)); await screen.findByText('ลูกค้านัดชม');
    const row = screen.getByRole('article', { name: `การเข้าชม ${visitId}` }); expect(row).toHaveTextContent(vid(80)); expect(row).toHaveTextContent('Visit สำเร็จ');
    expect(within(row).queryByRole('button')).not.toBeInTheDocument();
  });
  it.each(['owner', 'other-sales', 'lost'] as const)('is read-only for %s despite an overly permissive mock flag', async restriction => {
    const snapshot = visitsSnapshot();
    if (restriction === 'owner') snapshot.actor.role = 'owner';
    if (restriction === 'other-sales') snapshot.scope.ownerUserId = vid(90);
    if (restriction === 'lost') snapshot.scope.engagementStatus = 'lost';
    const api = apiFor(snapshot); renderWorkspace(api); await screen.findByText('ลูกค้านัดชม');
    expect(screen.queryByRole('button', { name: 'สร้างนัดหมาย' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'เช็คอิน Walk-in ไม่มีนัด' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'ยกเลิกการเข้าชม' })).not.toBeInTheDocument(); expect(api.save).not.toHaveBeenCalled();
  });
  it('persists the exact command before sending, blocks double submits, then clears on confirmed success', async () => {
    const api = apiFor(); let resolve!: (value: ReturnType<typeof visitResult>) => void;
    api.save.mockImplementation((input, actor) => { expect(actor).toBe(actorId); expect(readVisitsPending(actorId)).toEqual(input); return new Promise(done => { resolve = done; }); });
    renderWorkspace(api); await walkIn(); fireEvent.submit(screen.getByRole('form', { name: 'บันทึกนัดหมายและเข้าชม' }));
    expect(api.save).toHaveBeenCalledOnce(); expect(screen.getByRole('button', { name: 'สร้างนัดหมาย' })).toBeDisabled();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    await act(async () => resolve(visitResult(api.save.mock.calls[0][0]))); await waitFor(() => expect(readVisitsPending(actorId)).toBeNull());
  });
  it('recovers and retries the frozen payload after network failure, retaining it after a later definitive rejection', async () => {
    const api = apiFor(); api.save.mockRejectedValue(new Error('เครือข่ายขัดข้อง')); const ui = renderWorkspace(api); await walkIn();
    await screen.findByRole('alert'); const pending = api.save.mock.calls[0][0]; ui.unmount();
    const next = apiFor(); next.save.mockRejectedValue(new VisitsApiError('SCOPE_CLOSED', 'ปิดสถานะแล้ว ต้องตรวจคำขอเดิม', 409)); renderWorkspace(next);
    fireEvent.click(await screen.findByRole('button', { name: 'ตรวจผลซ้ำด้วยคำขอเดิม' }));
    await waitFor(() => expect(next.save).toHaveBeenCalledWith(pending, actorId)); await screen.findByRole('alert'); expect(readVisitsPending(actorId)).toEqual(pending);
    expect(screen.getByRole('button', { name: 'สร้างนัดหมาย' })).toBeDisabled();
  });
  it('allows correction only after the first definitive rejection and never calls a read a retry', async () => {
    const api = apiFor(); api.save.mockRejectedValue(new VisitsApiError('INVALID_INPUT', 'เวลายังไม่ถูกต้อง', 400));
    renderWorkspace(api); await walkIn(); expect(await screen.findByRole('alert')).toHaveTextContent('เวลายังไม่ถูกต้อง');
    expect(readVisitsPending(actorId)).toBeNull(); expect(screen.getByLabelText('เหตุผล *')).not.toBeDisabled();
  });
  it('recovers another interest’s pending command instead of silently retargeting it', async () => {
    const input = visitInput(); writeVisitsPending(actorId, input); const scope = visitsScope({ interestId: vid(90) });
    const api = apiFor(visitsSnapshot(scope)); renderWorkspace(api, scope.interestId);
    await screen.findByText(/คำขอนี้เป็นของลูกค้าหรือโครงการอื่น/); expect(api.save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'ตรวจผลซ้ำด้วยคำขอเดิม' }));
    await waitFor(() => expect(api.save).toHaveBeenCalledWith(input, actorId));
  });
  it('blocks storage corruption and retains the broken record', async () => {
    const key = visitsPendingKey(actorId); sessionStorage.setItem(key, '{broken'); const api = apiFor(); renderWorkspace(api);
    await screen.findByRole('alert'); expect(screen.getByRole('button', { name: 'สร้างนัดหมาย' })).toBeDisabled(); expect(api.save).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(key)).toBe('{broken');
  });
  it('does not send when storage cannot persist and protects navigation', async () => {
    const api = apiFor(); renderWorkspace(api); await screen.findByText('ลูกค้านัดชม');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); }); await walkIn(); expect(api.save).not.toHaveBeenCalled();
    const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
  it('blocks re-sending a confirmed result if clearing the receipt fails', async () => {
    const api = apiFor(); renderWorkspace(api); await screen.findByText('ลูกค้านัดชม');
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('storage'); }); await walkIn();
    expect(screen.getByText('บันทึกสำเร็จแล้ว ห้ามส่งซ้ำ')).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'ตรวจผลซ้ำด้วยคำขอเดิม' })).toBeDisabled();
    expect(api.save).toHaveBeenCalledOnce();
  });
  it('truthfully retains success if refresh fails and does not resend on reload', async () => {
    const api = apiFor(); api.read.mockResolvedValueOnce(visitsSnapshot()).mockRejectedValue(new Error('โหลดไม่ได้'));
    renderWorkspace(api); await walkIn(); expect(await screen.findByRole('alert')).toHaveTextContent('โหลดไม่ได้'); expect(screen.getByText(/บันทึกสำเร็จแล้ว/)).toBeInTheDocument();
    expect(screen.queryByText('ลูกค้านัดชม')).not.toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: 'โหลดข้อมูลใหม่' }));
    await waitFor(() => expect(api.read).toHaveBeenCalledTimes(3)); expect(api.save).toHaveBeenCalledOnce();
  });
  it('blocks a changed account while preserving the original account’s pending command', async () => {
    writeVisitsPending(actorId, visitInput()); const api = apiFor(); const ui = renderWorkspace(api); await screen.findByRole('button', { name: 'ตรวจผลซ้ำด้วยคำขอเดิม' });
    const snapshot = visitsSnapshot(); snapshot.actor.userId = vid(99); snapshot.scope.ownerUserId = vid(99); const next = apiFor(snapshot);
    ui.rerender(<VisitsWorkspace api={next} customerId={customerId} interestId={interestId} />); await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: 'ตรวจผลซ้ำด้วยคำขอเดิม' })).toBeDisabled(); expect(next.save).not.toHaveBeenCalled(); expect(readVisitsPending(actorId)).toEqual(visitInput());
  });
  it('ignores a late read after the selected interest changes', async () => {
    const api = apiFor(); let resolve!: (value: VisitsSnapshot) => void;
    const other = visitsSnapshot(visitsScope({ interestId: vid(99) })); other.scope.customerName = 'ขอบเขตใหม่';
    api.read.mockImplementation(scope => scope.interestId === interestId ? new Promise(done => { resolve = done; }) : Promise.resolve(other));
    const ui = renderWorkspace(api); ui.rerender(<VisitsWorkspace api={api} customerId={customerId} interestId={vid(99)} />); await screen.findByText('ขอบเขตใหม่');
    await act(async () => resolve(visitsSnapshot())); expect(screen.queryByText('ลูกค้านัดชม')).not.toBeInTheDocument();
  });
  it('keeps three independent history cursors and hides stale rows between pages', async () => {
    const snapshot = visitsSnapshot();
    snapshot.appointments = Array.from({ length: 50 }, (_, index) => ({ ...snapshot.appointments[0], id: vid(100 + index) })); snapshot.appointmentsHasMore = true;
    snapshot.visits = Array.from({ length: 50 }, (_, index) => ({ ...snapshot.visits[0], id: vid(200 + index) })); snapshot.visitsHasMore = true;
    snapshot.events = Array.from({ length: 50 }, (_, index) => ({ ...snapshot.events[0], id: vid(300 + index) })); snapshot.eventsHasMore = true;
    const api = apiFor(snapshot); let resolve!: (value: VisitsSnapshot) => void; renderWorkspace(api); await screen.findByText('ลูกค้านัดชม');
    api.read.mockImplementation(() => new Promise(done => { resolve = done; }));
    fireEvent.click(screen.getByRole('button', { name: 'นัดถัดไป' })); expect(screen.queryByText('ลูกค้านัดชม')).not.toBeInTheDocument();
    expect(api.read).toHaveBeenLastCalledWith(visitsScope({ appointmentPage: 1 }));
    await act(async () => resolve({ ...snapshot, appointmentPage: 1 })); fireEvent.click(screen.getByRole('button', { name: 'Visit ถัดไป' }));
    expect(api.read).toHaveBeenLastCalledWith(visitsScope({ appointmentPage: 1, visitPage: 1 }));
    await act(async () => resolve({ ...snapshot, appointmentPage: 1, visitPage: 1 })); fireEvent.click(screen.getByRole('button', { name: 'เหตุการณ์ถัดไป' }));
    expect(api.read).toHaveBeenLastCalledWith(visitsScope({ appointmentPage: 1, visitPage: 1, eventPage: 1 }));
  });
});
