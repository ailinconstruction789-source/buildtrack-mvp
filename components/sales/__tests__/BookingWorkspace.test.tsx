import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('@/lib/sales/plotAvailabilityClient', () => ({ loadAvailablePlots: vi.fn().mockResolvedValue([]) }));
import BookingWorkspace from '../BookingWorkspace';
import SalesWorkspaceModeProvider from '../SalesWorkspaceModeProvider';
import { BookingApiError, type BookingApi } from '@/lib/sales/bookingClient';
import { bookingPendingKey, readBookingPending, writeBookingPending } from '@/lib/sales/bookingPending';
import { actorId, bookingContext, bookingResult, cancelInput, customerId, otherSaleId } from './bookingFixtures';
const apiFor = (customer = true) => ({ read: vi.fn().mockResolvedValue(bookingContext(customer)), search: vi.fn().mockResolvedValue({ customers: [], page: 0, hasMore: false }), save: vi.fn().mockResolvedValue(bookingResult()) });
const renderWorkspace = (api: BookingApi, customer = true) => render(<BookingWorkspace api={api} initialCustomerId={customer ? customerId : null} />);
async function startCancel() {
  fireEvent.click(await screen.findByRole('button', { name: 'ยกเลิกจองรอบ 2' }));
  fireEvent.change(screen.getByLabelText('เหตุผล *'), { target: { value: 'ลูกค้าขอยกเลิก' } });
  await act(async () => { fireEvent.submit(screen.getByRole('form', { name: 'ยกเลิกการจอง' })); });
}
beforeEach(() => { sessionStorage.clear(); vi.clearAllMocks(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe('central booking workspace', () => {
  it('shows imported days and unknown round without fabricating time or post-booking readiness', async () => {
    const api = apiFor(), context = bookingContext();
    context.sales = [context.sales[0]];
    Object.assign(context.sales[0], { bookingRound: null, canResume: false,
      importedHistory: { source: 'customer_sheet', batchId: otherSaleId, sourceRow: 966, sourceStage: 'cancelled',
        bookedDate: '2024-07-22', cancelledDate: '2024-09-23', transferredDate: null } });
    api.read.mockResolvedValue(context);
    render(<SalesWorkspaceModeProvider mode="central" postBookingEnabled><BookingWorkspace api={api} initialCustomerId={customerId} /></SalesWorkspaceModeProvider>);
    const article = await screen.findByRole('article', { name: /รอบไม่ทราบ \(ข้อมูลเดิม\)/ });
    expect(article).toHaveTextContent('22/07/2567 (ข้อมูลเดิม — ไม่ทราบเวลา)');
    expect(article).toHaveTextContent('23/09/2567 (ข้อมูลเดิม — ไม่ทราบเวลา)');
    expect(article).toHaveTextContent('อ้างอิงแถว 966 ในชีต');
    expect(article).toHaveTextContent('ยกเลิกเก่า');
    expect(article).not.toHaveTextContent('00:00');
    expect(screen.queryByRole('link', { name: /งานสัญญา/ })).not.toBeInTheDocument();
    expect(api.save).not.toHaveBeenCalled();
  });
  it('exposes post-booking links per round and hides them while cancellation outcome is uncertain', async () => {
    const api = apiFor(); api.save.mockRejectedValue(new Error('network interrupted'));
    render(<SalesWorkspaceModeProvider mode="central" postBookingEnabled><BookingWorkspace api={api} initialCustomerId={customerId} /></SalesWorkspaceModeProvider>);
    const links = await screen.findAllByRole('link', { name: /งานสัญญา/ });
    expect(links).toHaveLength(2);
    expect(links.some(link => link.getAttribute('href') === `/sales-crm/post-booking?saleId=${otherSaleId}`)).toBe(true);
    await startCancel(); await screen.findByRole('alert');
    expect(screen.queryByRole('link', { name: /งานสัญญา/ })).not.toBeInTheDocument();
  });
  it('submits a permitted imported cancellation without sending historical evidence', async () => {
    const api = apiFor(), context = bookingContext();
    context.sales = [context.sales[1]];
    Object.assign(context.sales[0], { bookingRound: null, bookedAt: null, listPrice: null, discountAmount: null, canResume: false,
      importedHistory: { source: 'customer_sheet', batchId: otherSaleId, sourceRow: 966, sourceStage: 'booked',
        bookedDate: '2024-07-22', cancelledDate: null, transferredDate: null } });
    api.read.mockResolvedValue(context); renderWorkspace(api);
    fireEvent.click(await screen.findByRole('button', { name: 'ยกเลิกจองรอบไม่ทราบ (ข้อมูลเดิม)' }));
    expect(screen.getByText(/เลขรอบคือลำดับที่ระบบบันทึกได้/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('เหตุผล *'), { target: { value: 'ลูกค้าขอยกเลิกข้อมูลจองเดิม' } });
    await act(async () => { fireEvent.submit(screen.getByRole('form', { name: 'ยกเลิกการจอง' })); });
    expect(api.save).toHaveBeenCalledWith(expect.objectContaining({ command: 'cancel', saleId: otherSaleId,
      expectedSaleRevision: context.sales[0].revision, reason: 'ลูกค้าขอยกเลิกข้อมูลจองเดิม' }), actorId);
    expect(api.save.mock.calls[0][0]).not.toHaveProperty('importedHistory');
    expect(api.save.mock.calls[0][0]).not.toHaveProperty('bookedAt');
  });
  it('preserves every history row, cancellation reason and unknown values', async () => {
    renderWorkspace(apiFor()); expect(await screen.findByRole('article', { name: /รอบ 1 A ไม่ทราบแปลง/ })).toHaveTextContent('ยกเลิกเก่า');
    expect(screen.getAllByRole('article')).toHaveLength(2); expect(screen.getAllByText('ไม่ทราบ').length).toBeGreaterThan(3);
    expect(screen.getByText('1,990,000.00 บาท')).toBeInTheDocument();
  });
  it('requires successful global search and explicit distinct-person choice before new intake', async () => {
    const api = apiFor(false); api.search.mockResolvedValue({ customers: [{ id: customerId, name: 'ชื่อเหมือนกัน', phone: '0000000000' }], page: 0, hasMore: false });
    renderWorkspace(api, false); const query = await screen.findByLabelText(/ชื่อหรือเบอร์โทร/);
    expect(screen.queryByRole('button', { name: /สร้าง Lead พร้อมจอง/ })).not.toBeInTheDocument();
    fireEvent.change(query, { target: { value: 'ชื่อ' } }); fireEvent.click(screen.getByRole('button', { name: 'ค้นหาลูกค้า' }));
    const create = await screen.findByRole('button', { name: /ตรวจแล้วว่าไม่ใช่ลูกค้าคนเดียวกัน/ });
    expect(api.search).toHaveBeenCalledWith('ชื่อ', 0); expect(screen.getByText(`รหัสลูกค้า ${customerId}`)).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'บันทึกการจองส่วนกลาง' })).not.toBeInTheDocument(); fireEvent.click(create);
    expect(screen.getByRole('form', { name: 'บันทึกการจองส่วนกลาง' })).toBeInTheDocument();
    fireEvent.change(query, { target: { value: 'คนใหม่' } }); expect(screen.queryByRole('form', { name: 'บันทึกการจองส่วนกลาง' })).not.toBeInTheDocument();
  });
  it('suppresses a late search for a previous query', async () => {
    const api = apiFor(false); let resolve!: (value: unknown) => void; api.search.mockImplementation(() => new Promise(done => { resolve = done; }));
    renderWorkspace(api, false); const query = await screen.findByLabelText(/ชื่อหรือเบอร์โทร/);
    fireEvent.change(query, { target: { value: 'คนเก่า' } }); fireEvent.click(screen.getByRole('button', { name: 'ค้นหาลูกค้า' }));
    fireEvent.change(query, { target: { value: 'คนใหม่' } }); await act(async () => resolve({ customers: [{ id: customerId, name: 'ผลเก่า', phone: null }], page: 0, hasMore: false }));
    expect(screen.queryByText('ผลเก่า')).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: /สร้าง Lead พร้อมจอง/ })).not.toBeInTheDocument();
  });
  it('writes ahead before saving, prevents double submit, clears receipt on success', async () => {
    const api = apiFor(); let resolve!: (value: ReturnType<typeof bookingResult>) => void;
    api.save.mockImplementation((input, actor) => {
      expect(actor).toBe(actorId); expect(readBookingPending(actorId)).toEqual(input);
      return new Promise(done => { resolve = done; });
    });
    renderWorkspace(api); await startCancel(); fireEvent.submit(screen.getByRole('form', { name: 'ยกเลิกการจอง' }));
    expect(api.save).toHaveBeenCalledTimes(1); expect(screen.getByRole('button', { name: 'เพิ่มรอบจองใหม่' })).toBeDisabled();
    await act(async () => resolve(bookingResult())); await waitFor(() => expect(readBookingPending(actorId)).toBeNull());
  });
  it('keeps an uncertain command across refresh and retries identical input even after a later definitive error', async () => {
    const first = apiFor(); first.save.mockRejectedValue(new Error('network interrupted'));
    const ui = renderWorkspace(first); await startCancel(); await screen.findByRole('button', { name: 'ตรวจผลซ้ำด้วยคำขอเดิม' });
    const pending = first.save.mock.calls[0][0]; ui.unmount();
    const next = apiFor(); next.save.mockRejectedValue(new BookingApiError('UNAUTHENTICATED', 'กลับเข้าบัญชีเดิม', 401)); renderWorkspace(next);
    fireEvent.click(await screen.findByRole('button', { name: 'ตรวจผลซ้ำด้วยคำขอเดิม' }));
    await waitFor(() => expect(next.save).toHaveBeenCalledWith(pending, actorId));
    expect(await screen.findByRole('alert')).toHaveTextContent('กลับเข้าบัญชีเดิม'); expect(readBookingPending(actorId)).toEqual(pending);
    expect(screen.getByRole('button', { name: 'ค้นหาลูกค้าคนอื่น' })).toBeDisabled();
  });
  it('permits correction only after a definitive first rejection', async () => {
    const api = apiFor(); api.save.mockRejectedValue(new BookingApiError('PLOT_UNAVAILABLE', 'ไม่ว่างแล้ว', 409));
    renderWorkspace(api); await startCancel(); await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('ไม่ว่างแล้ว'));
    expect(readBookingPending(actorId)).toBeNull(); expect(screen.getByLabelText('เหตุผล *')).not.toBeDisabled();
  });
  it('does not resend a successful write when the subsequent read fails', async () => {
    const api = apiFor(); api.read.mockResolvedValueOnce(bookingContext()).mockRejectedValue(new Error('อ่านล่าสุดไม่ได้'));
    renderWorkspace(api); await startCancel(); expect(await screen.findByRole('alert')).toHaveTextContent('อ่านล่าสุดไม่ได้');
    expect(screen.getByText(/บันทึกสำเร็จแล้ว/)).toBeInTheDocument(); expect(api.save).toHaveBeenCalledTimes(1); expect(readBookingPending(actorId)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'โหลดข้อมูลใหม่' })); await waitFor(() => expect(api.read).toHaveBeenCalledTimes(3)); expect(api.save).toHaveBeenCalledTimes(1);
  });
  it('recovers pending commands from a different customer scope before any new write', async () => {
    writeBookingPending(actorId, cancelInput); const api = apiFor(false); renderWorkspace(api, false);
    const retry = await screen.findByRole('button', { name: 'ตรวจผลซ้ำด้วยคำขอเดิม' });
    expect(screen.getByLabelText(/ชื่อหรือเบอร์โทร/)).toBeDisabled(); fireEvent.click(retry);
    await waitFor(() => expect(api.save).toHaveBeenCalledWith(cancelInput, actorId));
  });
  it('blocks writes and retains corrupt pending records', async () => {
    sessionStorage.setItem(bookingPendingKey(actorId), '{broken'); const api = apiFor(); renderWorkspace(api);
    expect(await screen.findByRole('alert')).toHaveTextContent('ห้ามล้างข้อมูล'); expect(screen.getByRole('button', { name: 'เพิ่มรอบจองใหม่' })).toBeDisabled();
    expect(api.save).not.toHaveBeenCalled(); expect(sessionStorage.getItem(bookingPendingKey(actorId))).toBe('{broken');
  });
  it('blocks send when write-ahead storage fails', async () => {
    const api = apiFor(); renderWorkspace(api); await screen.findByText('ลูกค้าเดิม');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); }); await startCancel();
    expect(api.save).not.toHaveBeenCalled(); expect(screen.getByRole('alert')).toHaveTextContent('หยุดบันทึก');
  });
  it('never offers writes to Owner even if a mocked row incorrectly grants permission', async () => {
    const api = apiFor(), context = bookingContext(); context.actor.role = 'owner'; api.read.mockResolvedValue(context); renderWorkspace(api);
    await screen.findByText('ลูกค้าเดิม'); expect(screen.getByRole('button', { name: 'เพิ่มรอบจองใหม่' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'ยกเลิกจองรอบ 2' })).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: /กลับมาติดตามต่อจากรอบ/ })).not.toBeInTheDocument();
  });
  it('keeps cancellation and resume tied to explicit sale and revision', async () => {
    const api = apiFor(); renderWorkspace(api); await startCancel();
    await waitFor(() => expect(api.save).toHaveBeenCalledWith(expect.objectContaining({ command: 'cancel', saleId: otherSaleId }), actorId));
  });
});
