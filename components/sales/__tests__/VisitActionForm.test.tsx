import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
import VisitActionForm from '../VisitActionForm';
import type { VisitCommand, VisitsSnapshot } from '@/lib/sales/visitsContracts';
import { appointmentId, customerId, interestId, vid, visitId, visitsSnapshot } from './visitsFixtures';
afterEach(cleanup);
function renderForm(action: VisitCommand = 'schedule', snapshot = visitsSnapshot(), withAppointment = false, disabled = false) {
  const onSubmit = vi.fn(), onClose = vi.fn();
  render(<VisitActionForm snapshot={snapshot} action={action} appointment={withAppointment ? snapshot.appointments[0] : undefined}
    visit={action === 'cancel_visit' ? snapshot.visits[0] : undefined} disabled={disabled} onSubmit={onSubmit} onClose={onClose} />);
  return { onSubmit, onClose };
}
function fillReason() {
  fireEvent.change(screen.getByLabelText('วันเวลาเกิดเหตุการณ์จริง (เวลากรุงเทพฯ) *'), { target: { value: '2026-09-23T09:00' } });
  fireEvent.change(screen.getByLabelText('เหตุผล *'), { target: { value: 'ลูกค้ายืนยันแล้ว' } });
}
const submit = () => fireEvent.submit(screen.getByRole('form', { name: 'บันทึกนัดหมายและเข้าชม' }));
describe('visit action form', () => {
  it('never guesses event or appointment times and requires explicit evidence of the event', () => {
    const { onSubmit } = renderForm();
    expect(screen.getByLabelText('วันเวลาเกิดเหตุการณ์จริง (เวลากรุงเทพฯ) *')).toHaveValue('');
    expect(screen.getByLabelText('วันเวลาเริ่มนัด (เวลากรุงเทพฯ) *')).toHaveValue('');
    submit(); expect(onSubmit).not.toHaveBeenCalled(); expect(screen.getByRole('alert')).toBeInTheDocument();
  });
  it('schedules for this interest with Bangkok times and an explicitly unknown end time', () => {
    const { onSubmit } = renderForm(); fillReason();
    fireEvent.change(screen.getByLabelText('วันเวลาเริ่มนัด (เวลากรุงเทพฯ) *'), { target: { value: '2026-09-24T10:00' } }); submit();
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ command: 'schedule', customerId, interestId, expectedInterestRevision: vid(9),
      startsAt: '2026-09-24T10:00:00+07:00', endsAt: null, occurredAt: '2026-09-23T09:00:00+07:00', reason: 'ลูกค้ายืนยันแล้ว' }));
  });
  it('reschedules the same appointment and revision without silently overwriting the original', () => {
    const { onSubmit } = renderForm('reschedule', visitsSnapshot(), true); fillReason();
    fireEvent.change(screen.getByLabelText('วันเวลาเริ่มนัด (เวลากรุงเทพฯ) *'), { target: { value: '2026-09-24T11:00' } });
    fireEvent.change(screen.getByLabelText('วันเวลาสิ้นสุดนัด (ถ้าทราบ)'), { target: { value: '2026-09-24T12:00' } }); submit();
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ command: 'reschedule', appointmentId, expectedAppointmentRevision: vid(5),
      startsAt: '2026-09-24T11:00:00+07:00', endsAt: '2026-09-24T12:00:00+07:00' }));
  });
  it('rejects an end time before the start', () => {
    const { onSubmit } = renderForm(); fillReason();
    fireEvent.change(screen.getByLabelText('วันเวลาเริ่มนัด (เวลากรุงเทพฯ) *'), { target: { value: '2026-09-24T12:00' } });
    fireEvent.change(screen.getByLabelText('วันเวลาสิ้นสุดนัด (ถ้าทราบ)'), { target: { value: '2026-09-24T11:00' } }); submit(); expect(onSubmit).not.toHaveBeenCalled();
  });
  it.each(['cancel_appointment', 'no_show', 'check_in'] as const)('binds %s to the explicit appointment', action => {
    const { onSubmit } = renderForm(action, visitsSnapshot(), true); fillReason(); submit();
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ command: action, appointmentId, expectedAppointmentRevision: vid(5) }));
  });
  it('records a walk-in with no fabricated appointment or successful Visit', () => {
    const { onSubmit } = renderForm('check_in'); fillReason(); submit();
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ command: 'check_in', appointmentId: null, expectedAppointmentRevision: null }));
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty('status'); expect(screen.getByText(/ยังไม่ถือว่า Visit สำเร็จ/)).toBeInTheDocument();
  });
  it('cancels only an awaiting-voice Visit with its exact revision', () => {
    const { onSubmit } = renderForm('cancel_visit'); fillReason(); submit();
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ command: 'cancel_visit', visitId, expectedVisitRevision: vid(7) }));
  });
  it.each(['owner', 'other-sales', 'lost', 'closed-appointment', 'busy'] as const)('blocks %s even for synthetic form submit', restriction => {
    const snapshot = visitsSnapshot();
    if (restriction === 'owner') snapshot.actor.role = 'owner';
    if (restriction === 'other-sales') snapshot.scope.ownerUserId = vid(90);
    if (restriction === 'lost') snapshot.scope.engagementStatus = 'lost';
    if (restriction === 'closed-appointment') snapshot.appointments[0].status = 'cancelled';
    const { onSubmit, onClose } = renderForm('check_in', snapshot, true, restriction === 'busy'); fillReason(); submit();
    fireEvent.click(screen.getByRole('button', { name: 'ปิดแบบฟอร์ม' })); expect(onSubmit).not.toHaveBeenCalled(); expect(onClose).not.toHaveBeenCalled();
  });
  it('requires a reason and never exposes a manual-complete command', () => {
    const { onSubmit } = renderForm('check_in'); fillReason(); fireEvent.change(screen.getByLabelText('เหตุผล *'), { target: { value: '' } });
    submit(); expect(onSubmit).not.toHaveBeenCalled(); expect(screen.queryByRole('button', { name: /สำเร็จ/ })).not.toBeInTheDocument();
  });
  it('allows Admin assigned to another salesperson to record a permitted event', () => {
    const snapshot: VisitsSnapshot = visitsSnapshot(); snapshot.actor.role = 'admin'; snapshot.scope.ownerUserId = vid(90);
    const { onSubmit } = renderForm('check_in', snapshot); fillReason(); submit(); expect(onSubmit).toHaveBeenCalledOnce();
  });
});
