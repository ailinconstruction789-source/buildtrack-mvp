import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BillingQueueView from '../BillingQueueView';

const db = vi.hoisted(() => ({ from: vi.fn(), update: vi.fn(), eq: vi.fn(), select: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: db.from } }));
const makeItem = (id: string, billed = false) => ({
  assignment_id: id, plot_id: 'A', task_template_id: 'T', task_name: `Task ${id}`,
  latest_action: 'QC อนุมัติผ่าน', latest_update_created_at: '2026-10-08T00:00:00Z',
  billing_status: billed ? 'billed' : null, task_cost: 10, project_name: 'Project',
});
const props = {
  billingData: [makeItem('1'), makeItem('2')], setBillingData: vi.fn(), loading: false,
  onRefresh: vi.fn(), allUpdatesRecord: [], showAlert: vi.fn(), showToast: vi.fn(),
  currentUserRole: 'Procurement', taskTemplates: [{ id: 'T', require_qc: true }],
};
const openFirst = () => {
  fireEvent.click(screen.getAllByRole('button', { name: 'ตั้งเบิกแล้ว' })[0]);
  fireEvent.change(screen.getByPlaceholderText('กรอกเลขที่เอกสารอ้างอิง...'), { target: { value: 'INV-1' } });
  return screen.getByRole('button', { name: 'บันทึกการตั้งเบิก' }).closest('form')!;
};

beforeEach(() => {
  vi.clearAllMocks();
  db.from.mockReturnValue({ update: db.update });
  db.update.mockReturnValue({ eq: db.eq });
  db.eq.mockReturnValue({ select: db.select });
  db.select.mockResolvedValue({ data: [{ id: '1' }], error: null });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('construction billing queue', () => {
  it('shows persisted task text in history and retains the legacy note fallback', () => {
    const update = { plot_id: 'A', task_template_id: 'T', created_at: '2026-10-08T00:00:00Z', progress: 100, text_content: 'ตรวจหลังคาตามแบบ', note: 'legacy' };
    const { rerender } = render(<BillingQueueView {...props} allUpdatesRecord={[update]} />);
    fireEvent.click(screen.getAllByTitle('ดูประวัติการตรวจ')[0]);
    expect(screen.getByText('ตรวจหลังคาตามแบบ')).toBeInTheDocument();
    expect(screen.queryByText('legacy')).not.toBeInTheDocument();
    rerender(<BillingQueueView {...props} allUpdatesRecord={[{ ...update, text_content: '' }]} />);
    expect(screen.getByText('legacy')).toBeInTheDocument();
  });

  it('clamps refreshed billed results to a valid page', () => {
    const rows = Array.from({ length: 61 }, (_, i) => makeItem(String(i), true));
    const { rerender } = render(<BillingQueueView {...props} billingData={rows} />);
    fireEvent.click(screen.getByRole('button', { name: /ประวัติการตั้งเบิก/ }));
    fireEvent.click(screen.getByRole('button', { name: 'ถัดไป' }));
    expect(screen.getByText('A - Task 50')).toBeInTheDocument();
    rerender(<BillingQueueView {...props} billingData={rows.slice(0, 10)} />);
    expect(screen.getByText('A - Task 0')).toBeInTheDocument();
    expect(screen.queryByText('A - Task 50')).not.toBeInTheDocument();
  });

  it('verifies the updated assignment before reporting success', async () => {
    render(<BillingQueueView {...props} />);
    fireEvent.submit(openFirst());
    await waitFor(() => expect(props.showToast).toHaveBeenCalledWith('บันทึกการตั้งเบิกเรียบร้อย', 'success'));
    expect(db.from).toHaveBeenCalledWith('plot_task_assignments');
    expect(db.eq).toHaveBeenCalledWith('id', '1');
    expect(db.select).toHaveBeenCalledWith('id');
    expect(props.onRefresh).toHaveBeenCalledOnce();
  });

  it('keeps the form and reports error on a zero-row update instead of false success', async () => {
    db.select.mockResolvedValue({ data: [], error: null });
    render(<BillingQueueView {...props} />);
    fireEvent.submit(openFirst());
    await waitFor(() => expect(props.showAlert).toHaveBeenCalledWith('ข้อผิดพลาด', expect.stringContaining('ไม่พบรายการที่บันทึกได้')));
    expect(props.showToast).not.toHaveBeenCalled();
    expect(props.onRefresh).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue('INV-1')).toBeInTheDocument();
  });

  it('keeps error handling for rejected database writes', async () => {
    db.select.mockResolvedValue({ data: null, error: { message: 'Denied by policy' } });
    render(<BillingQueueView {...props} />);
    fireEvent.submit(openFirst());
    await waitFor(() => expect(props.showAlert).toHaveBeenCalledWith('ข้อผิดพลาด', expect.stringContaining('Denied by policy')));
    expect(props.showToast).not.toHaveBeenCalled();
  });

  it('does not close or clear a newer billing form when the previous save completes', async () => {
    let finish!: (value: { data: { id: string }[]; error: null }) => void;
    db.select.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    render(<BillingQueueView {...props} />);
    const form = openFirst();
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(db.update).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'ยกเลิก' }));
    const secondRow = screen.getAllByRole('row').find(row => within(row).queryByText('A - Task 2'))!;
    fireEvent.click(within(secondRow).getByRole('button', { name: 'ตั้งเบิกแล้ว' }));
    fireEvent.change(screen.getByPlaceholderText('กรอกเลขที่เอกสารอ้างอิง...'), { target: { value: 'INV-2' } });
    await act(async () => { finish({ data: [{ id: '1' }], error: null }); });
    expect(screen.getByDisplayValue('INV-2')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'ยืนยันการตั้งเบิก' })).toBeInTheDocument();
    expect(props.onRefresh).toHaveBeenCalledOnce();
  });

  it('does not notify or refresh an unmounted queue after a pending save resolves', async () => {
    let finish!: (value: { data: { id: string }[]; error: null }) => void;
    db.select.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const { unmount } = render(<BillingQueueView {...props} />);
    fireEvent.submit(openFirst());
    unmount();
    await act(async () => { finish({ data: [{ id: '1' }], error: null }); });
    expect(props.showToast).not.toHaveBeenCalled();
    expect(props.onRefresh).not.toHaveBeenCalled();
  });
});
