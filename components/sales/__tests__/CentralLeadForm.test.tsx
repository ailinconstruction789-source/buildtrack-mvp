import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: vi.fn() } } }));
const { loadAvailablePlots } = vi.hoisted(() => ({ loadAvailablePlots: vi.fn() }));
vi.mock('@/lib/sales/plotAvailabilityClient', () => ({ loadAvailablePlots }));
import CentralLeadForm from '../CentralLeadForm';
import { CentralApiError } from '@/lib/sales/centralClient';
import type { CentralSnapshot } from '@/lib/sales/centralContracts';

const SALES = '00000000-0000-4000-8000-000000000001';
const CUSTOMER = '00000000-0000-4000-8000-000000000002';
function snapshot(role: CentralSnapshot['actor']['role'] = 'sales'): CentralSnapshot {
  return { actor: { userId: SALES, role }, projects: [{ name: 'โครงการ A' }, { name: 'โครงการ B' }],
    salesOwners: [{ userId: SALES, displayName: 'ฝ่ายขาย A' }], customers: [], page: 0, hasMore: false };
}
function setup(role: CentralSnapshot['actor']['role'] = 'sales', save = vi.fn().mockResolvedValue({ customerId: CUSTOMER, replayed: false })) {
  const onSaved = vi.fn(); const onClose = vi.fn();
  render(<CentralLeadForm snapshot={snapshot(role)} save={save} onSaved={onSaved} onClose={onClose} />);
  return { save, onSaved, onClose };
}
function fill() {
  fireEvent.change(screen.getByLabelText('ชื่อลูกค้า *'), { target: { value: 'ลูกค้าใหม่' } });
  fireEvent.change(screen.getByLabelText('เบอร์โทร *'), { target: { value: '0812345678' } });
}
function submit() { fireEvent.submit(screen.getByRole('form', { name: 'บันทึก Lead ส่วนกลาง' })); }
beforeEach(() => {
  vi.clearAllMocks();
  loadAvailablePlots.mockImplementation(async (project: string) => [{ id: `${project}-A1`, plot_name: 'A1', project_name: project, has_customer: false, sale_status: 'active' }]);
});
afterEach(cleanup);

describe('central intake form', () => {
  it('creates with only name/phone, optional projects, and no client-supplied Sales owner', async () => {
    const { save, onSaved } = setup(); fill(); submit();
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][0]).toMatchObject({ name: 'ลูกค้าใหม่', phone: '0812345678', interests: [], requestId: expect.any(String) });
    expect(save.mock.calls[0][0]).not.toHaveProperty('assignedSalesUserId');
    expect(loadAvailablePlots).not.toHaveBeenCalled();
  });
  it('requires an Admin to select an active Sales owner explicitly', async () => {
    const { save } = setup('admin'); fill(); submit();
    expect(await screen.findByRole('alert')).toHaveTextContent('Sales');
    expect(save).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Sales ผู้ดูแล *'), { target: { value: SALES } }); submit();
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ assignedSalesUserId: SALES })));
  });
  it('keeps multiple optional project interests and selects a TEXT plot ID', async () => {
    const { save } = setup(); fill();
    fireEvent.change(screen.getByLabelText('เพิ่มโครงการที่สนใจ'), { target: { value: 'โครงการ A' } });
    fireEvent.focus(screen.getByRole('combobox', { name: 'แปลงที่เล็งไว้ (ถ้ามี)' }));
    fireEvent.click(await screen.findByRole('option', { name: /A1/ }));
    fireEvent.change(screen.getByLabelText('เพิ่มโครงการที่สนใจ'), { target: { value: 'โครงการ B' } });
    submit();
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({
      interests: [{ projectName: 'โครงการ A', plotId: 'โครงการ A-A1' }, { projectName: 'โครงการ B', plotId: null }],
    })));
  });
  it('does not offer creation to Owner', () => {
    setup('owner');
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
  });
  it('keeps validation errors editable without starting a request', async () => {
    const { save } = setup(); submit();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByLabelText('ชื่อลูกค้า *')).not.toBeDisabled();
  });
  it('prevents simultaneous double submission', async () => {
    let resolve!: (result: { customerId: string; replayed: boolean }) => void;
    const save = vi.fn(() => new Promise<{ customerId: string; replayed: boolean }>(done => { resolve = done; }));
    setup('sales', save); fill(); submit(); submit();
    expect(save).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('ชื่อลูกค้า *')).toBeDisabled();
    await act(async () => resolve({ customerId: CUSTOMER, replayed: false }));
  });
  it('freezes an uncertain request and retries the exact same ID and payload', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('network interrupted')).mockResolvedValueOnce({ customerId: CUSTOMER, replayed: true });
    const { onSaved } = setup('sales', save); fill(); submit();
    await screen.findByRole('button', { name: 'ลองบันทึกซ้ำด้วยคำขอเดิม' });
    expect(screen.getByLabelText('ชื่อลูกค้า *')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'ยกเลิก' })).toBeDisabled();
    submit();
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ customerId: CUSTOMER, replayed: true }));
    expect(save.mock.calls[1][0]).toEqual(save.mock.calls[0][0]);
  });
  it('does not discard an earlier uncertain request when a retry then returns 401', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('network interrupted'))
      .mockRejectedValueOnce(new CentralApiError('UNAUTHENTICATED', 'เข้าสู่ระบบใหม่', 401));
    setup('sales', save); fill(); submit();
    await screen.findByRole('button', { name: 'ลองบันทึกซ้ำด้วยคำขอเดิม' }); submit();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('เข้าสู่ระบบใหม่'));
    expect(screen.getByLabelText('ชื่อลูกค้า *')).toBeDisabled();
    expect(save.mock.calls[1][0]).toEqual(save.mock.calls[0][0]);
  });
  it('allows correction after a definitive duplicate rejection, without auto-merging', async () => {
    const save = vi.fn().mockRejectedValue(new CentralApiError('DUPLICATE_REVIEW_REQUIRED', 'ให้ Admin ตรวจเบอร์ซ้ำ', 409));
    setup('sales', save); fill(); submit();
    await screen.findByRole('alert');
    expect(screen.getByLabelText('ชื่อลูกค้า *')).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'ยกเลิก' })).not.toBeDisabled();
    expect(save).toHaveBeenCalledTimes(1);
  });
});
