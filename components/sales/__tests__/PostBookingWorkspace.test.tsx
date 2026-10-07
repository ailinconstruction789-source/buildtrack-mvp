import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
import PostBookingWorkspace from '../PostBookingWorkspace';
import { PostBookingApiError, type PostBookingApi } from '@/lib/sales/postBookingClient';
import { postBookingPendingKey, readPostBookingPending, writePostBookingPending } from '@/lib/sales/postBookingPending';
import { displayTransferDate, type PostBookingSnapshot } from '@/lib/sales/postBookingContracts';
import type { PaymentMethod, SaleStage } from '@/lib/sales/workflow';
import { actorId, advanceInput, eventId, otherActorId, otherSaleId, postBookingResult, postBookingSnapshot, saleId, transferInput, transferredSnapshot } from './postBookingFixtures';

const apiFor = (snapshot = postBookingSnapshot()) => ({
  read: vi.fn<PostBookingApi['read']>().mockResolvedValue(snapshot),
  save: vi.fn<PostBookingApi['save']>().mockImplementation(async input => postBookingResult(input)),
});
const renderWorkspace = (api: PostBookingApi, id = saleId) => render(<PostBookingWorkspace api={api} saleId={id} />);
async function startContract() {
  fireEvent.click(await screen.findByRole('button', { name: 'บันทึกทำสัญญา' }));
  fireEvent.change(screen.getByLabelText('วันเวลาเกิดเหตุการณ์ (เวลากรุงเทพฯ) *'), { target: { value: '2026-09-21T10:00' } });
  fireEvent.change(screen.getByLabelText('เหตุผล *'), { target: { value: 'ลูกค้าลงนามแล้ว' } });
  fireEvent.change(screen.getByLabelText('รายละเอียดหลักฐานที่ผู้บันทึกอ้างอิง *'), { target: { value: 'สัญญาทดสอบ 01' } });
  await act(async () => { fireEvent.submit(screen.getByRole('form', { name: 'บันทึกงานหลังจอง' })); });
}
async function startTransfer() {
  fireEvent.click(await screen.findByRole('button', { name: 'ยืนยันโอนจริง' }));
  fireEvent.change(screen.getByLabelText('วันโอนจริง *'), { target: { value: '2026-09-21' } });
  fireEvent.change(screen.getByLabelText('เหตุผล *'), { target: { value: 'โอนกรรมสิทธิ์เสร็จแล้ว' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'ยืนยันวันโอนจริง' })); });
}

beforeEach(() => { sessionStorage.clear(); vi.clearAllMocks(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('post-booking workspace', () => {
  it('shows central identity, dates and immutable history without allowing a premature transfer', async () => {
    const api = apiFor(postBookingSnapshot('loan_rejected')); renderWorkspace(api);
    await screen.findByText('ลูกค้าทดสอบ');
    expect(screen.getByLabelText('ข้อมูลรอบจอง')).toHaveTextContent('โครงการทดสอบ A');
    expect(screen.getByRole('article', { name: 'ยื่นกู้รอบ 1' })).toHaveTextContent('เอกสารไม่ครบ');
    expect(screen.getByRole('article', { name: `เหตุการณ์ ${eventId}` })).toHaveTextContent('สัญญาเลขที่ทดสอบ 01');
    expect(screen.getAllByText('ไม่ทราบเวลา').length).toBeGreaterThan(0);
    expect(screen.getByText(/ยังไม่เปิดส่งมอบ/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ยืนยันโอน|ส่งมอบ|ลบ|แก้ไขประวัติ/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'ประวัติจอง / ยกเลิกจอง' })).toHaveAttribute('href', `/sales-crm/bookings?customerId=${advanceInput.customerId}`);
    expect(api.save).not.toHaveBeenCalled();
  });
  it.each([
    ['booked', 'mortgage', ['บันทึกทำสัญญา']],
    ['contracted', 'mortgage', ['บันทึกดาวน์', 'บันทึกเตรียมเอกสาร']],
    ['contracted', 'cash', ['บันทึกดาวน์', 'บันทึกเตรียมเอกสาร', 'บันทึกรอโอน']],
    ['document_prep', 'cash', ['บันทึกรอโอน']],
    ['document_prep', 'mortgage', ['บันทึกยื่นกู้']],
    ['loan_rejected', 'mortgage', ['บันทึกยื่นกู้']],
    ['loan_submitted', 'mortgage', ['บันทึกกู้อนุมัติ', 'บันทึกกู้ถูกปฏิเสธ']],
    ['loan_approved', 'mortgage', ['บันทึกรอโอน']],
    ['transfer_pending', 'cash', ['ยืนยันโอนจริง']],
    ['transfer_pending', 'mortgage', ['ยืนยันโอนจริง']],
    ['transferred', 'mortgage', []],
    ['handover', 'mortgage', []],
    ['cancelled', 'mortgage', []],
  ] as [SaleStage, PaymentMethod, string[]][])('offers only safe targets for %s / %s', async (stage, method, expected) => {
    renderWorkspace(apiFor(postBookingSnapshot(stage, method))); await screen.findByText('ลูกค้าทดสอบ');
    expect(screen.queryAllByRole('button', { name: /^(บันทึก|ยืนยันโอนจริง$)/ }).map(button => button.textContent)).toEqual(expected);
  });
  it.each(['owner', 'not-owner', 'unknown-payment'] as const)('stays read-only for %s', async reason => {
    const snapshot = postBookingSnapshot();
    if (reason === 'owner') snapshot.actor.role = 'owner';
    if (reason === 'not-owner') { snapshot.sale.ownerUserId = otherActorId; snapshot.sale.canEdit = false; }
    if (reason === 'unknown-payment') snapshot.sale.paymentMethod = null;
    const api = apiFor(snapshot); renderWorkspace(api); await screen.findByText('ลูกค้าทดสอบ');
    expect(screen.queryAllByRole('button', { name: /^บันทึก/ })).toHaveLength(0); expect(api.save).not.toHaveBeenCalled();
    if (reason === 'unknown-payment') expect(screen.getByText(/กรุณาให้ Admin ตรวจสอบหลักฐาน/)).toBeInTheDocument();
  });
  it('persists before sending, blocks a second submit, and clears the receipt only on confirmed success', async () => {
    const api = apiFor(); let resolve!: (result: ReturnType<typeof postBookingResult>) => void;
    api.save.mockImplementation((input, actor) => {
      expect(actor).toBe(actorId); expect(readPostBookingPending(actorId)).toEqual(input);
      return new Promise(done => { resolve = done; });
    });
    renderWorkspace(api); await startContract(); fireEvent.submit(screen.getByRole('form', { name: 'บันทึกงานหลังจอง' }));
    expect(api.save).toHaveBeenCalledTimes(1); expect(screen.getByRole('button', { name: 'โหลดประวัติล่าสุด' })).toBeDisabled();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    await act(async () => resolve(postBookingResult(api.save.mock.calls[0][0])));
    await waitFor(() => expect(readPostBookingPending(actorId)).toBeNull());
    expect(screen.getByText(/บันทึกสำเร็จแล้ว/)).toBeInTheDocument();
  });
  it('freezes the original ID and payload across uncertain failure, refresh, and a later definitive error', async () => {
    const first = apiFor(); first.save.mockRejectedValue(new Error('เครือข่ายขัดข้อง'));
    const ui = renderWorkspace(first); await startContract();
    expect(await screen.findByRole('alert')).toHaveTextContent('เครือข่ายขัดข้อง');
    const pending = first.save.mock.calls[0][0]; expect(readPostBookingPending(actorId)).toEqual(pending); ui.unmount();
    const next = apiFor(); next.save.mockRejectedValue(new PostBookingApiError('STALE_STATE', 'ต้องตรวจคำขอเดิม', 409)); renderWorkspace(next);
    fireEvent.click(await screen.findByRole('button', { name: 'ตรวจผลซ้ำด้วยคำขอเดิม' }));
    await waitFor(() => expect(next.save).toHaveBeenCalledWith(pending, actorId));
    expect(await screen.findByRole('alert')).toHaveTextContent('ต้องตรวจคำขอเดิม');
    expect(readPostBookingPending(actorId)).toEqual(pending);
    expect(screen.getByRole('button', { name: 'บันทึกทำสัญญา' })).toBeDisabled();
  });
  it('allows correction after a definitive rejection of the very first send only', async () => {
    const api = apiFor(); api.save.mockRejectedValue(new PostBookingApiError('INVALID_INPUT', 'หลักฐานไม่ครบ', 400));
    renderWorkspace(api); await startContract(); expect(await screen.findByRole('alert')).toHaveTextContent('หลักฐานไม่ครบ');
    expect(readPostBookingPending(actorId)).toBeNull(); expect(screen.getByLabelText('เหตุผล *')).not.toBeDisabled();
  });
  it('recovers another sale’s command and retries that exact sale without autosaving on read', async () => {
    writePostBookingPending(actorId, advanceInput);
    const snapshot = postBookingSnapshot(); snapshot.sale.id = otherSaleId; const api = apiFor(snapshot);
    renderWorkspace(api, otherSaleId); await screen.findByText(/คำขอนี้เป็นของรอบจองอื่น/);
    expect(api.save).not.toHaveBeenCalled(); expect(screen.getByRole('button', { name: 'บันทึกทำสัญญา' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'ตรวจผลซ้ำด้วยคำขอเดิม' }));
    await waitFor(() => expect(api.save).toHaveBeenCalledWith(advanceInput, actorId));
    expect(screen.getByText(/บันทึกสำเร็จแล้ว/)).toHaveTextContent(saleId);
  });
  it('blocks corruption without discarding its record', async () => {
    const key = postBookingPendingKey(actorId); sessionStorage.setItem(key, '{broken'); const api = apiFor(); renderWorkspace(api);
    expect(await screen.findByRole('alert')).toHaveTextContent('ห้ามล้างข้อมูล');
    expect(screen.getByRole('button', { name: 'บันทึกทำสัญญา' })).toBeDisabled(); expect(api.save).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(key)).toBe('{broken');
  });
  it('never sends when write-ahead storage fails and guards navigation even without a pending state', async () => {
    const api = apiFor(); renderWorkspace(api); await screen.findByText('ลูกค้าทดสอบ');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); }); await startContract();
    expect(api.save).not.toHaveBeenCalled(); expect(screen.getByRole('alert')).toBeInTheDocument();
    const unload = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(unload); expect(unload.defaultPrevented).toBe(true);
    const anchor = document.createElement('a'); anchor.href = '/other'; document.body.append(anchor);
    const click = new MouseEvent('click', { bubbles: true, cancelable: true }); anchor.dispatchEvent(click); expect(click.defaultPrevented).toBe(true); anchor.remove();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
  it('does not resend a confirmed write when clearing its receipt fails', async () => {
    const api = apiFor(); renderWorkspace(api); await screen.findByText('ลูกค้าทดสอบ');
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('storage'); }); await startContract();
    expect(screen.getByText(/บันทึกสำเร็จแล้ว/)).toHaveTextContent('ห้ามส่งซ้ำ');
    const retry = screen.getByRole('button', { name: 'ตรวจผลซ้ำด้วยคำขอเดิม' }); expect(retry).toBeDisabled(); fireEvent.click(retry);
    expect(api.save).toHaveBeenCalledTimes(1); expect(readPostBookingPending(actorId)).not.toBeNull();
    expect(screen.getByRole('button', { name: 'โหลดประวัติล่าสุด' })).toBeDisabled();
  });
  it('keeps a confirmed-save notice if refresh fails and subsequent reads do not resend', async () => {
    const api = apiFor(); api.read.mockResolvedValueOnce(postBookingSnapshot()).mockRejectedValue(new Error('อ่านล่าสุดไม่ได้'));
    renderWorkspace(api); await startContract(); expect(await screen.findByRole('alert')).toHaveTextContent('อ่านล่าสุดไม่ได้');
    expect(screen.getByText(/บันทึกสำเร็จแล้ว/)).toBeInTheDocument(); expect(screen.queryByText('ลูกค้าทดสอบ')).not.toBeInTheDocument();
    expect(readPostBookingPending(actorId)).toBeNull(); fireEvent.click(screen.getByRole('button', { name: 'โหลดข้อมูลใหม่' }));
    await waitFor(() => expect(api.read).toHaveBeenCalledTimes(3)); expect(api.save).toHaveBeenCalledTimes(1);
  });
  it('blocks an actor switch while the original actor has a pending command', async () => {
    writePostBookingPending(actorId, advanceInput); const first = apiFor(); const ui = renderWorkspace(first);
    await screen.findByRole('button', { name: 'ตรวจผลซ้ำด้วยคำขอเดิม' });
    const snapshot = postBookingSnapshot(); snapshot.actor.userId = otherActorId; snapshot.sale.ownerUserId = otherActorId;
    const next = apiFor(snapshot); ui.rerender(<PostBookingWorkspace api={next} saleId={saleId} />);
    await screen.findByRole('alert'); expect(screen.getByRole('button', { name: 'ตรวจผลซ้ำด้วยคำขอเดิม' })).toBeDisabled();
    expect(next.save).not.toHaveBeenCalled(); expect(readPostBookingPending(actorId)).toEqual(advanceInput);
  });
  it('ignores a late response for an old sale scope', async () => {
    const api = apiFor(); let resolve!: (snapshot: PostBookingSnapshot) => void;
    const other = postBookingSnapshot(); other.sale.id = otherSaleId; other.sale.customerName = 'ลูกค้ารอบจองใหม่';
    api.read.mockImplementation(scope => scope.saleId === saleId ? new Promise(done => { resolve = done; }) : Promise.resolve(other));
    const ui = renderWorkspace(api); ui.rerender(<PostBookingWorkspace api={api} saleId={otherSaleId} />);
    await screen.findByText('ลูกค้ารอบจองใหม่'); await act(async () => resolve(postBookingSnapshot()));
    expect(screen.queryByText('ลูกค้าทดสอบ')).not.toBeInTheDocument(); expect(api.save).not.toHaveBeenCalled();
  });
  it('paginates loan attempts and status history independently, hiding rows while a page loads', async () => {
    const snapshot = postBookingSnapshot('loan_submitted'); snapshot.latestAttempt!.attemptNumber = 50;
    snapshot.attempts = Array.from({ length: 50 }, (_, index) => ({ ...snapshot.latestAttempt!,
      id: `20000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, attemptNumber: 50 - index }));
    snapshot.latestAttempt = snapshot.attempts[0]; snapshot.attemptsHasMore = true;
    snapshot.events = Array.from({ length: 50 }, (_, index) => ({ ...snapshot.events[0], id: `30000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}` }));
    snapshot.eventsHasMore = true;
    const api = apiFor(snapshot); let resolve!: (snapshot: PostBookingSnapshot) => void;
    renderWorkspace(api); await screen.findByText('ลูกค้าทดสอบ');
    api.read.mockImplementation(() => new Promise(done => { resolve = done; }));
    fireEvent.click(screen.getByRole('button', { name: 'รอบกู้ถัดไป' }));
    expect(screen.queryByText('ลูกค้าทดสอบ')).not.toBeInTheDocument(); expect(screen.getByText('กำลังโหลดข้อมูลหลังจอง…')).toBeInTheDocument();
    expect(api.read).toHaveBeenLastCalledWith({ saleId, attemptPage: 1, eventPage: 0 });
    const second = { ...snapshot, attemptPage: 1, attempts: [], attemptsHasMore: false };
    await act(async () => resolve(second)); fireEvent.click(screen.getByRole('button', { name: 'เหตุการณ์ถัดไป' }));
    expect(api.read).toHaveBeenLastCalledWith({ saleId, attemptPage: 1, eventPage: 1 });
  });
  it('confirms the explicit transfer date, then shows day-only history with no further transfer or handover action', async () => {
    const api = apiFor(postBookingSnapshot('transfer_pending', 'cash'));
    api.read.mockResolvedValueOnce(postBookingSnapshot('transfer_pending', 'cash')).mockResolvedValue(transferredSnapshot());
    renderWorkspace(api); await startTransfer();
    expect(api.save).toHaveBeenCalledWith(expect.objectContaining({ command: 'confirm_transfer', transferDate: '2026-09-21' }), actorId);
    const input = api.save.mock.calls[0][0]; expect(input).not.toHaveProperty('occurredAt'); expect(input).not.toHaveProperty('evidenceNote');
    await screen.findByText(`วันโอนจริง: ${displayTransferDate('2026-09-21')}`);
    expect(screen.getByLabelText('ข้อมูลรอบจอง')).toHaveTextContent(displayTransferDate('2026-09-21'));
    const history = screen.getByRole('article', { name: `เหตุการณ์ ${eventId}` });
    expect(history).toHaveTextContent('บันทึกเข้าระบบ:'); expect(history).toHaveTextContent('โอนกรรมสิทธิ์เสร็จแล้ว');
    expect(history).not.toHaveTextContent('เกิดเหตุการณ์:'); expect(history).not.toHaveTextContent('หลักฐานที่ผู้บันทึกอ้างอิง:');
    expect(screen.getByText(`วันโอนจริง: ${displayTransferDate('2026-09-21')}`)).not.toHaveTextContent(/\d{2}:\d{2}/);
    expect(screen.queryByRole('button', { name: /ยืนยันโอน|ยืนยันวันโอน|ส่งมอบ/ })).not.toBeInTheDocument();
    expect(readPostBookingPending(actorId)).toBeNull();
  });
  it.each(['owner', 'other-sales', 'unknown-payment'] as const)('does not expose transfer confirmation for %s', async restriction => {
    const snapshot = postBookingSnapshot('transfer_pending');
    if (restriction === 'owner') snapshot.actor.role = 'owner';
    if (restriction === 'other-sales') snapshot.sale.ownerUserId = otherActorId;
    if (restriction === 'unknown-payment') snapshot.sale.paymentMethod = null;
    const api = apiFor(snapshot); renderWorkspace(api); await screen.findByText('ลูกค้าทดสอบ');
    expect(screen.queryByRole('button', { name: 'ยืนยันโอนจริง' })).not.toBeInTheDocument(); expect(api.save).not.toHaveBeenCalled();
  });
  it('freezes the date-only transfer command after network uncertainty and retries its original ID and payload', async () => {
    const api = apiFor(postBookingSnapshot('transfer_pending')); api.save.mockRejectedValue(new Error('เครือข่ายขัดข้อง'));
    const ui = renderWorkspace(api); await startTransfer(); await screen.findByRole('alert');
    const input = api.save.mock.calls[0][0]; expect(readPostBookingPending(actorId)).toEqual(input);
    expect(screen.getByLabelText('วันโอนจริง *')).toBeDisabled(); expect(screen.getByLabelText('เหตุผล *')).toBeDisabled();
    ui.unmount();
    const next = apiFor(transferredSnapshot()); next.save.mockRejectedValue(new PostBookingApiError('FORBIDDEN', 'ตรวจคำขอเดิมก่อน', 403));
    renderWorkspace(next); fireEvent.click(await screen.findByRole('button', { name: 'ตรวจผลซ้ำด้วยคำขอเดิม' }));
    await waitFor(() => expect(next.save).toHaveBeenCalledWith(input, actorId));
    expect(readPostBookingPending(actorId)).toEqual(input); expect(input).toEqual(expect.objectContaining({ transferDate: '2026-09-21', command: 'confirm_transfer' }));
    expect(input).not.toHaveProperty('occurredAt'); expect(input).not.toHaveProperty('evidenceNote');
  });
  it('can recover a saved transfer command from another sale without adapting its day to the current sale', async () => {
    writePostBookingPending(actorId, transferInput);
    const snapshot = postBookingSnapshot('transfer_pending'); snapshot.sale.id = otherSaleId; const api = apiFor(snapshot);
    renderWorkspace(api, otherSaleId); await screen.findByText(/คำขอนี้เป็นของรอบจองอื่น/);
    fireEvent.click(screen.getByRole('button', { name: 'ตรวจผลซ้ำด้วยคำขอเดิม' }));
    await waitFor(() => expect(api.save).toHaveBeenCalledWith(transferInput, actorId));
    expect(api.save.mock.calls[0][0]).not.toHaveProperty('occurredAt');
  });
});
