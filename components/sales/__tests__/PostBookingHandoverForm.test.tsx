import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
import PostBookingForm from '../PostBookingForm';
import { postBookingSnapshot, otherActorId } from './postBookingFixtures';

afterEach(cleanup);
function form(restriction?: string) {
  const snapshot = postBookingSnapshot('transferred', null);
  if (restriction === 'owner') snapshot.actor.role = 'owner';
  if (restriction === 'other-sales') snapshot.sale.ownerUserId = otherActorId;
  if (restriction === 'no-write') snapshot.sale.canEdit = false;
  if (restriction === 'wrong-stage') snapshot.sale.stage = 'booked';
  const onSubmit = vi.fn();
  render(<PostBookingForm snapshot={snapshot} target="handover" disabled={restriction === 'busy'} onSubmit={onSubmit} onClose={vi.fn()} />);
  return onSubmit;
}
const submit = () => fireEvent.submit(screen.getByRole('form', { name: 'บันทึกงานหลังจอง' }));
describe('explicit historical handover form', () => {
  it('starts empty and requires a date without asking to recreate missing transfer evidence', () => {
    const onSubmit = form();
    expect(screen.getByLabelText('วันรับมอบจริง *')).toHaveValue('');
    expect(screen.queryByLabelText(/วันเวลาเกิดเหตุการณ์/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/รายละเอียดหลักฐาน/)).not.toBeInTheDocument();
    submit(); expect(onSubmit).not.toHaveBeenCalled(); expect(screen.getByRole('alert')).toBeInTheDocument();
  });
  it('submits the exact deal, revisions and entered day with no invented timestamp', () => {
    const onSubmit = form();
    fireEvent.change(screen.getByLabelText('วันรับมอบจริง *'), { target: { value: '2026-09-23' } });
    fireEvent.change(screen.getByLabelText('เหตุผล *'), { target: { value: 'ลูกค้ารับมอบแล้ว' } }); submit();
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ command: 'confirm_handover', handoverDate: '2026-09-23', requestId: expect.any(String) }));
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty('occurredAt'); expect(onSubmit.mock.calls[0][0]).not.toHaveProperty('transferDate');
  });
  it.each(['owner', 'other-sales', 'no-write', 'wrong-stage', 'busy'])('prevents synthetic submit for %s', restriction => {
    const onSubmit = form(restriction);
    fireEvent.change(screen.getByLabelText('วันรับมอบจริง *'), { target: { value: '2026-09-23' } });
    fireEvent.change(screen.getByLabelText('เหตุผล *'), { target: { value: 'ทดสอบ' } }); submit();
    expect(onSubmit).not.toHaveBeenCalled(); expect(screen.getByRole('button', { name: 'ยืนยันวันรับมอบจริง' })).toBeDisabled();
  });
});
