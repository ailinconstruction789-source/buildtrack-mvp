import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
import PostBookingForm from '../PostBookingForm';
import type { PostBookingSnapshot } from '@/lib/sales/postBookingContracts';
import type { SaleStage } from '@/lib/sales/workflow';
import { attemptId, customerId, otherActorId, postBookingSnapshot, revisionId, saleId } from './postBookingFixtures';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function form(snapshot = postBookingSnapshot(), target: SaleStage = 'contracted', disabled = false) {
  const onSubmit = vi.fn(), onClose = vi.fn();
  render(<PostBookingForm snapshot={snapshot} target={target} disabled={disabled} onSubmit={onSubmit} onClose={onClose} />);
  return { onSubmit, onClose };
}
function fillEvidence() {
  fireEvent.change(screen.getByLabelText('วันเวลาเกิดเหตุการณ์ (เวลากรุงเทพฯ) *'), { target: { value: '2026-09-21T10:00' } });
  fireEvent.change(screen.getByLabelText('เหตุผล *'), { target: { value: 'ลูกค้ายืนยันแล้ว' } });
  fireEvent.change(screen.getByLabelText('รายละเอียดหลักฐานที่ผู้บันทึกอ้างอิง *'), { target: { value: 'เอกสารเลขที่ทดสอบ 01' } });
}
const submit = () => fireEvent.submit(screen.getByRole('form', { name: 'บันทึกงานหลังจอง' }));

describe('post-booking form', () => {
  it('requires explicit event time without defaulting to now and explains the limits of evidence notes', () => {
    const { onSubmit } = form();
    expect(screen.getByLabelText('วันเวลาเกิดเหตุการณ์ (เวลากรุงเทพฯ) *')).toHaveValue('');
    expect(screen.getByText(/ยังไม่ใช่การอัปโหลดหรือตรวจยืนยัน/)).toBeInTheDocument();
    submit(); expect(onSubmit).not.toHaveBeenCalled(); expect(screen.getByRole('alert')).toHaveTextContent('กรุณาระบุวันเวลา');
  });
  it('submits the selected sale and both revisions, with an explicit Bangkok timestamp', () => {
    const { onSubmit } = form(); fillEvidence(); submit();
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ command: 'advance', nextStage: 'contracted', customerId, saleId,
      expectedSaleRevision: revisionId, expectedInterestRevision: revisionId, occurredAt: '2026-09-21T10:00:00+07:00',
      reason: 'ลูกค้ายืนยันแล้ว', evidenceNote: 'เอกสารเลขที่ทดสอบ 01', requestId: expect.any(String) }));
  });
  it.each(['เหตุผล *', 'รายละเอียดหลักฐานที่ผู้บันทึกอ้างอิง *'])('requires %s', label => {
    const { onSubmit } = form(); fillEvidence(); fireEvent.change(screen.getByLabelText(label), { target: { value: '' } });
    submit(); expect(onSubmit).not.toHaveBeenCalled(); expect(screen.getByRole('alert')).toBeInTheDocument();
  });
  it('submits a new loan round with the bank name after a rejected round, without overwriting its ID', () => {
    const { onSubmit } = form(postBookingSnapshot('loan_rejected'), 'loan_submitted'); fillEvidence();
    fireEvent.change(screen.getByLabelText('ชื่อธนาคาร *'), { target: { value: 'ธนาคารใหม่' } }); submit();
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ command: 'submit_loan', bankName: 'ธนาคารใหม่' }));
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty('loanAttemptId');
    expect(screen.getByText(/เก็บผลของทุกรอบเดิมไว้/)).toBeInTheDocument();
  });
  it('ties approval to the latest attempt and converts exact baht into integer satang', () => {
    const { onSubmit } = form(postBookingSnapshot('loan_submitted'), 'loan_approved'); fillEvidence();
    fireEvent.change(screen.getByLabelText('วงเงินอนุมัติจริง (บาท) *'), { target: { value: '1900000.25' } }); submit();
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ command: 'loan_result', result: 'approved', loanAttemptId: attemptId, approvedAmountSatang: 190000025 }));
  });
  it.each(['0', '-1', '1.001', 'NaN'])('rejects invalid approved amount %s', amount => {
    const { onSubmit } = form(postBookingSnapshot('loan_submitted'), 'loan_approved'); fillEvidence();
    fireEvent.change(screen.getByLabelText('วงเงินอนุมัติจริง (บาท) *'), { target: { value: amount } }); submit(); expect(onSubmit).not.toHaveBeenCalled();
  });
  it('records a rejection with a null amount rather than a fabricated zero', () => {
    const { onSubmit } = form(postBookingSnapshot('loan_submitted'), 'loan_rejected'); fillEvidence(); submit();
    expect(screen.queryByLabelText('วงเงินอนุมัติจริง (บาท) *')).not.toBeInTheDocument();
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ command: 'loan_result', result: 'rejected', loanAttemptId: attemptId, approvedAmountSatang: null }));
  });
  it.each([
    ['owner', (snapshot: PostBookingSnapshot) => { snapshot.actor.role = 'owner'; }, 'contracted'],
    ['cannot edit', (snapshot: PostBookingSnapshot) => { snapshot.sale.canEdit = false; }, 'contracted'],
    ['unknown payment', (snapshot: PostBookingSnapshot) => { snapshot.sale.paymentMethod = null; }, 'contracted'],
    ['unallowed target', () => {}, 'handover'],
  ] as const)('does not submit for %s even with a synthetic submit event', (_name, mutate, target) => {
    const snapshot = postBookingSnapshot(); mutate(snapshot);
    const { onSubmit } = form(snapshot, target); fillEvidence(); submit(); expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'ยืนยันบันทึกงานหลังจอง' })).toBeDisabled();
  });
  it('does not invent a loan attempt when its latest reference is missing', () => {
    const snapshot = postBookingSnapshot('loan_submitted'); snapshot.latestAttempt = null;
    const { onSubmit } = form(snapshot, 'loan_approved'); fillEvidence(); submit(); expect(onSubmit).not.toHaveBeenCalled();
  });
  it('stays frozen while a command is pending', () => {
    const { onSubmit, onClose } = form(postBookingSnapshot(), 'contracted', true); fillEvidence(); submit();
    fireEvent.click(screen.getByRole('button', { name: 'ปิดแบบฟอร์ม' }));
    expect(onSubmit).not.toHaveBeenCalled(); expect(onClose).not.toHaveBeenCalled();
  });
  it('asks only for an explicit transfer date and reason, without default time or document fields', () => {
    const { onSubmit } = form(postBookingSnapshot('transfer_pending'), 'transferred');
    expect(screen.getByLabelText('วันโอนจริง *')).toHaveAttribute('type', 'date');
    expect(screen.getByLabelText('วันโอนจริง *')).toHaveValue('');
    expect(screen.getByLabelText('เหตุผล *')).toHaveValue('');
    expect(screen.queryByLabelText('วันเวลาเกิดเหตุการณ์ (เวลากรุงเทพฯ) *')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('รายละเอียดหลักฐานที่ผู้บันทึกอ้างอิง *')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('ชื่อธนาคาร *')).not.toBeInTheDocument();
    expect(document.querySelector('input[type="file"]')).toBeNull();
    submit(); expect(onSubmit).not.toHaveBeenCalled(); expect(screen.getByRole('alert')).toBeInTheDocument();
  });
  it('sends a date-only transfer payload with no evidence note or invented timestamp', () => {
    const { onSubmit } = form(postBookingSnapshot('transfer_pending', 'cash'), 'transferred');
    fireEvent.change(screen.getByLabelText('วันโอนจริง *'), { target: { value: '2026-09-21' } });
    fireEvent.change(screen.getByLabelText('เหตุผล *'), { target: { value: 'โอนกรรมสิทธิ์เสร็จแล้ว' } });
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันวันโอนจริง' }));
    expect(onSubmit).toHaveBeenCalledWith({ requestId: expect.any(String), command: 'confirm_transfer', customerId, saleId,
      expectedSaleRevision: revisionId, expectedInterestRevision: revisionId, reason: 'โอนกรรมสิทธิ์เสร็จแล้ว', transferDate: '2026-09-21' });
  });
  it('still requires a reason when the transfer date is provided', () => {
    const { onSubmit } = form(postBookingSnapshot('transfer_pending'), 'transferred');
    fireEvent.change(screen.getByLabelText('วันโอนจริง *'), { target: { value: '2026-09-21' } }); submit();
    expect(onSubmit).not.toHaveBeenCalled(); expect(screen.getByRole('alert')).toBeInTheDocument();
  });
  it.each(['booked', 'contracted', 'loan_approved', 'loan_rejected', 'transferred', 'cancelled', 'handover'] as SaleStage[])(
    'cannot confirm transfer from %s even with a synthetic submit', stage => {
      const { onSubmit } = form(postBookingSnapshot(stage), 'transferred');
      fireEvent.change(screen.getByLabelText('วันโอนจริง *'), { target: { value: '2026-09-21' } });
      fireEvent.change(screen.getByLabelText('เหตุผล *'), { target: { value: 'โอนแล้ว' } }); submit();
      expect(onSubmit).not.toHaveBeenCalled(); expect(screen.getByRole('button', { name: 'ยืนยันวันโอนจริง' })).toBeDisabled();
    });
  it.each(['owner', 'other-sales', 'unknown-payment', 'pending'] as const)('blocks transfer for %s', restriction => {
    const snapshot = postBookingSnapshot('transfer_pending');
    if (restriction === 'owner') snapshot.actor.role = 'owner';
    if (restriction === 'other-sales') snapshot.sale.ownerUserId = otherActorId;
    if (restriction === 'unknown-payment') snapshot.sale.paymentMethod = null;
    const { onSubmit } = form(snapshot, 'transferred', restriction === 'pending');
    fireEvent.change(screen.getByLabelText('วันโอนจริง *'), { target: { value: '2026-09-21' } });
    fireEvent.change(screen.getByLabelText('เหตุผล *'), { target: { value: 'โอนแล้ว' } }); submit();
    expect(onSubmit).not.toHaveBeenCalled(); expect(screen.getByRole('button', { name: 'ยืนยันวันโอนจริง' })).toBeDisabled();
  });
  it('allows Admin to confirm a permitted transfer owned by another salesperson', () => {
    const snapshot = postBookingSnapshot('transfer_pending'); snapshot.actor.role = 'admin'; snapshot.sale.ownerUserId = otherActorId;
    const { onSubmit } = form(snapshot, 'transferred');
    fireEvent.change(screen.getByLabelText('วันโอนจริง *'), { target: { value: '2026-09-21' } });
    fireEvent.change(screen.getByLabelText('เหตุผล *'), { target: { value: 'โอนแล้ว' } }); submit();
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ command: 'confirm_transfer', transferDate: '2026-09-21' }));
  });
});
