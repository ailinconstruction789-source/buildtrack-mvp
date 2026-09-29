import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
const { loadAvailablePlots } = vi.hoisted(() => ({ loadAvailablePlots: vi.fn() }));
vi.mock('@/lib/sales/plotAvailabilityClient', () => ({ loadAvailablePlots }));
import BookingForm from '../BookingForm';
import BookingActionForm from '../BookingActionForm';
import { actorId, bookingContext, customerId, interestId, otherSaleId, revisionId, saleId } from './bookingFixtures';

afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); loadAvailablePlots.mockImplementation(async (project: string) => [{ id: `${project}-1`, plot_name: '1', project_name: project, has_customer: false, sale_status: 'available' }]); });
async function fillBooking() {
  fireEvent.change(screen.getByLabelText('โครงการที่จอง *'), { target: { value: 'A' } });
  fireEvent.focus(screen.getByRole('combobox', { name: 'แปลงที่จะจอง *' }));
  fireEvent.click(await screen.findByRole('option', { name: /^1\s*A$/ }));
  fireEvent.change(screen.getByLabelText('ราคาก่อนส่วนลด (บาท) *'), { target: { value: '2000000.10' } });
  fireEvent.change(screen.getByLabelText('ส่วนลด (บาท ใส่ 0 ถ้าไม่มี) *'), { target: { value: '0.01' } });
  fireEvent.change(screen.getByLabelText('เงินจองที่รับ (บาท ใส่ 0 ถ้าไม่มี) *'), { target: { value: '5000' } });
  fireEvent.change(screen.getByLabelText('เหตุผลการจองโดยไม่มี Visit ที่สำเร็จ *'), { target: { value: 'ลูกค้าขอจองทันที' } });
}
const submit = () => fireEvent.submit(screen.getByRole('form', { name: 'บันทึกการจองส่วนกลาง' }));
describe('central booking form', () => {
  it('reuses the customer and project revision, exact satang, no automatic previous booking', async () => {
    const save = vi.fn(); render(<BookingForm context={bookingContext()} newCustomer={false} disabled={false} onSubmit={save} onClose={vi.fn()} />);
    await fillBooking(); submit();
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ customerId, newCustomer: null, expectedInterestRevision: revisionId,
      listPriceSatang: 200000010, discountSatang: 1, depositSatang: 500000, previousSaleId: null, bookingRoute: 'without_visit', visitId: null }));
  });
  it('creates central Lead and booking as one command, Sales is not chosen client-side', async () => {
    const save = vi.fn(); render(<BookingForm context={bookingContext(false)} newCustomer disabled={false} onSubmit={save} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('ชื่อลูกค้า *'), { target: { value: 'ใหม่' } });
    fireEvent.change(screen.getByLabelText('เบอร์โทร *'), { target: { value: '0812345678' } });
    await fillBooking(); submit();
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ customerId: null, expectedInterestRevision: null, newCustomer: expect.objectContaining({ name: 'ใหม่', assignedSalesUserId: null }) }));
  });
  it('requires an explicit Sales assignee for Admin creating a customer', async () => {
    const context = bookingContext(false); context.actor.role = 'admin'; const save = vi.fn();
    render(<BookingForm context={context} newCustomer disabled={false} onSubmit={save} onClose={vi.fn()} />);
    await fillBooking(); submit(); expect(screen.getByRole('alert')).toHaveTextContent('Sales'); expect(save).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('ชื่อลูกค้า *'), { target: { value: 'ใหม่' } });
    fireEvent.change(screen.getByLabelText('เบอร์โทร *'), { target: { value: '0812345678' } });
    fireEvent.change(screen.getByLabelText('Sales ผู้ดูแล *'), { target: { value: actorId } }); submit();
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ newCustomer: expect.objectContaining({ assignedSalesUserId: actorId }) }));
  });
  it('requires an actual selected plot, does not accept free text', async () => {
    const save = vi.fn(); render(<BookingForm context={bookingContext()} newCustomer={false} disabled={false} onSubmit={save} onClose={vi.fn()} />);
    await fillBooking(); fireEvent.change(screen.getByRole('combobox', { name: 'แปลงที่จะจอง *' }), { target: { value: 'free text' } }); submit();
    expect(screen.getByRole('alert')).toHaveTextContent('เลือกแปลง'); expect(save).not.toHaveBeenCalled();
  });
  it('does not round invalid money and allows explicit cancelled predecessor only', async () => {
    const save = vi.fn(); render(<BookingForm context={bookingContext()} newCustomer={false} disabled={false} onSubmit={save} onClose={vi.fn()} />);
    await fillBooking(); fireEvent.change(screen.getByLabelText('ส่วนลด (บาท ใส่ 0 ถ้าไม่มี) *'), { target: { value: '0.001' } }); submit();
    expect(save).not.toHaveBeenCalled(); fireEvent.change(screen.getByLabelText('ส่วนลด (บาท ใส่ 0 ถ้าไม่มี) *'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText(/อ้างอิงจองที่ยกเลิก/), { target: { value: saleId } }); submit();
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ previousSaleId: saleId }));
  });
  it('only uses completed visits returned for the selected interest', async () => {
    const save = vi.fn(); render(<BookingForm context={bookingContext()} newCustomer={false} disabled={false} onSubmit={save} onClose={vi.fn()} />);
    await fillBooking(); fireEvent.change(screen.getByLabelText('เส้นทางการจอง'), { target: { value: 'visited' } }); submit();
    expect(save).not.toHaveBeenCalled(); fireEvent.change(screen.getByLabelText('Visit ที่ส่ง Customer Voices แล้ว *'), { target: { value: otherSaleId } }); submit();
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ bookingRoute: 'visited', visitId: otherSaleId }));
  });
  it('hides new-interest projects from a Sales who only owns another project', () => {
    const context = bookingContext(); context.customer!.ownerUserId = otherSaleId;
    render(<BookingForm context={context} newCustomer={false} disabled={false} onSubmit={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole('option', { name: 'A' })).toBeInTheDocument(); expect(screen.queryByRole('option', { name: 'B' })).not.toBeInTheDocument();
  });
  it('Owner has no booking form', () => {
    const context = bookingContext(); context.actor.role = 'owner'; render(<BookingForm context={context} newCustomer={false} disabled={false} onSubmit={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
  });
});
describe('booking lifecycle forms', () => {
  it('requires reason and sends cancellation category and sale revision', () => {
    const context = bookingContext(), save = vi.fn(); render(<BookingActionForm context={context} sale={context.sales[1]} action="cancel" disabled={false} onSubmit={save} onClose={vi.fn()} />);
    fireEvent.submit(screen.getByRole('form')); expect(save).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('เหตุผล *'), { target: { value: 'ลูกค้าขอยกเลิก' } });
    fireEvent.change(screen.getByLabelText('ประเภทการยกเลิก'), { target: { value: 'downpayment_abandoned' } }); fireEvent.submit(screen.getByRole('form'));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ command: 'cancel', saleId: otherSaleId, expectedSaleRevision: revisionId, cancellationCategory: 'downpayment_abandoned' }));
  });
  it('resumes with Bangkok dueAt and interest/action revisions, never reopens the sale', async () => {
    const context = bookingContext(), save = vi.fn(); context.interests[0].currentActionId = interestId;
    render(<BookingActionForm context={context} sale={context.sales[0]} action="resume_follow_up" disabled={false} onSubmit={save} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('เหตุผล *'), { target: { value: 'สนใจอีกครั้ง' } });
    fireEvent.change(screen.getByLabelText('งานติดตามถัดไป *'), { target: { value: 'โทรนัดชม' } });
    fireEvent.change(screen.getByLabelText('กำหนดติดตาม (เวลากรุงเทพฯ) *'), { target: { value: '2026-10-01T09:30' } }); fireEvent.submit(screen.getByRole('form'));
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ command: 'resume_follow_up', saleId, expectedSaleRevision: revisionId,
      expectedInterestRevision: revisionId, expectedActionId: interestId, nextAction: { action: 'โทรนัดชม', dueAt: '2026-10-01T09:30:00+07:00' } })));
    expect(context.sales[0].stage).toBe('cancelled');
  });
});
