import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import HouseVisitChecklistModal from '../HouseVisitChecklistModal';
import CustomerVoicesModal from '../CustomerVoicesModal';
import DailyHouseInspectionModal from '../DailyHouseInspectionModal';
import DailyVisitsScheduleView from '../DailyVisitsScheduleView';
import type { Lead } from '@/types/sales';

const mocks = vi.hoisted(() => ({ insert: vi.fn(), update: vi.fn(), readSurvey: vi.fn(), read: vi.fn() }));
vi.mock('@/lib/sales/leadActivity', () => ({
  readLeadActivitySnapshot: async (lead: unknown) => ({ lead, historyExists: false }),
  writeLeadActivitySummary: async (snapshot: { lead: { id: string } }, payload: unknown) => {
    const result = await mocks.update('leads', payload, 'id', snapshot.lead.id);
    if (result.error) throw result.error;
  },
}));
vi.mock('@/lib/supabase', () => ({ supabase: { from: (table: string) => ({
  insert: (payload: unknown) => mocks.insert(table, payload),
  update: (payload: unknown) => ({ eq: (column: string, id: string) => mocks.update(table, payload, column, id) }),
  select: () => ({ eq: () => ({ maybeSingle: () => mocks.readSurvey() }) }),
}) } }));
vi.mock('@/lib/sales/fetchWithoutLimit', () => ({ fetchSalesWithoutLimit: mocks.read }));
vi.mock('@/lib/sales/sampleHouseHelper', () => ({
  isSampleHouse: () => false,
  fetchTodayInspectionMap: () => Promise.resolve({}),
  fetchTodayInspectionStatus: () => Promise.resolve({ status: 'pending', badgeLabel: 'Pending', badgeColor: '', badgeBg: '', icon: 'alert' }),
}));

const lead: Lead = { id: 'lead-1', customer_name: 'Test customer', agent_name: 'Sales One', project_name: 'A', created_at: '2026-01-01T00:00:00.000Z' };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.insert.mockResolvedValue({ error: null });
  mocks.update.mockResolvedValue({ error: null });
  mocks.readSurvey.mockResolvedValue({ data: null, error: null });
  mocks.read.mockResolvedValue([]);
  vi.spyOn(window, 'alert').mockImplementation(() => {});
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('visit workflow preserves deal stages and handles resolved API errors', () => {
  it.each(['Booked', 'Transferred', 'Rented', 'Cancelled', 'Loan'])('SOP activity cannot replace %s deal fields', async status => {
    const onSaved = vi.fn();
    render(<HouseVisitChecklistModal isOpen onClose={vi.fn()} onSaved={onSaved} lead={{ ...lead, status, crm_status: status }} initialStage="stage_c" />);
    fireEvent.click(screen.getByRole('button', { name: /เสร็จสิ้น SOP/ }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    const [, patch] = mocks.update.mock.calls[0];
    expect(patch).not.toHaveProperty('status');
    expect(patch).not.toHaveProperty('crm_status');
    expect(patch.actual_visit_date).toEqual(expect.any(String));
  });

  it('still updates visit status for a pre-booking customer', async () => {
    render(<HouseVisitChecklistModal isOpen onClose={vi.fn()} lead={lead} initialStage="stage_c" />);
    fireEvent.click(screen.getByRole('button', { name: /เสร็จสิ้น SOP/ }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledOnce());
    expect(mocks.update.mock.calls[0][1]).toMatchObject({ status: 'Visit', crm_status: expect.stringContaining('Considering') });
  });

  it('stops before lead sync when checklist insert resolves an error', async () => {
    mocks.insert.mockResolvedValue({ error: { message: 'Denied' } });
    const onSaved = vi.fn(), onClose = vi.fn();
    render(<HouseVisitChecklistModal isOpen onClose={onClose} onSaved={onSaved} lead={lead} initialStage="stage_c" />);
    fireEvent.click(screen.getByRole('button', { name: /เสร็จสิ้น SOP/ }));
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith('บันทึก Checklist ไม่สำเร็จ โปรดลองอีกครั้ง'));
    expect(mocks.update).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('reports partial save and retries the same checklist without another insert', async () => {
    mocks.update.mockResolvedValueOnce({ error: { message: 'lead sync denied' } });
    const onSaved = vi.fn(), onClose = vi.fn();
    render(<HouseVisitChecklistModal isOpen onClose={onClose} onSaved={onSaved} lead={lead} initialStage="stage_c" />);
    const save = screen.getByRole('button', { name: /เสร็จสิ้น SOP/ });
    fireEvent.click(save);
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('บันทึก Checklist แล้ว แต่อัปเดตข้อมูลลูกค้าไม่สำเร็จ')));
    expect(onClose).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    fireEvent.click(save);
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(mocks.insert).toHaveBeenCalledOnce();
    const insertedId = mocks.insert.mock.calls[0][1][0].id;
    expect(mocks.update.mock.calls[1]).toEqual(['house_visit_checklists', expect.any(Object), 'id', insertedId]);
    expect(mocks.update.mock.calls[2][0]).toBe('leads');
  });

  it.each([false, true])('survey %s insert/update errors retain the form and do not invoke success', async existing => {
    if (existing) mocks.readSurvey.mockResolvedValue({ data: { id: 'survey-1', customer_name: 'Test customer' }, error: null });
    mocks.insert.mockResolvedValue({ error: { message: 'Denied' } });
    mocks.update.mockResolvedValue({ error: { message: 'Denied' } });
    const onSaved = vi.fn(), onClose = vi.fn();
    render(<CustomerVoicesModal isOpen lead={lead} onClose={onClose} onSaved={onSaved} />);
    const save = await screen.findByRole('button', { name: /บันทึกแบบสอบถาม/ });
    fireEvent.submit(save.closest('form')!);
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith('บันทึกแบบสำรวจไม่สำเร็จ'));
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(save).toBeInTheDocument();
  });

  it('inspection defaults to the actual user and never silently uses Bell', () => {
    const { rerender } = render(<DailyHouseInspectionModal isOpen onClose={vi.fn()} user={{ username: 'PIEW' }} />);
    expect(screen.getByDisplayValue('PIEW')).toBeInTheDocument();
    rerender(<DailyHouseInspectionModal isOpen onClose={vi.fn()} />);
    expect(screen.queryByDisplayValue('Bell')).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('PIEW')).not.toBeInTheDocument();
  });

  it('completed visit action opens Stage C, while opening and closing a survey preserves SOP notes/stage', async () => {
    render(<DailyVisitsScheduleView projects={[{ name: 'A' }]} leads={[{ ...lead, actual_visit_date: new Date().toISOString() }]} />);
    fireEvent.click(screen.getByRole('button', { name: /สรุปผลการขาย \(Stage C\)/ }));
    expect(screen.getByRole('button', { name: /เสร็จสิ้น SOP/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /ย้อนกลับ Stage B/ }));
    const notes = screen.getByPlaceholderText(/เช่น ลูกค้าชอบห้องนั่งเล่น/);
    fireEvent.change(notes, { target: { value: 'unsaved tour notes' } });
    fireEvent.click(screen.getByRole('button', { name: /เปิดแบบสอบถาม Customer Voices/ }));
    expect(screen.queryByRole('button', { name: /ปิด SOP พาชมบ้าน/ })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'ปิดแบบสอบถาม Customer Voices' }));
    expect(screen.getByDisplayValue('unsaved tour notes')).toBeInTheDocument();
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('check-in omits booked deal fields and does not refresh on a resolved error', async () => {
    mocks.update.mockResolvedValue({ error: { message: 'Denied' } });
    const onRefresh = vi.fn();
    render(<DailyVisitsScheduleView projects={[{ name: 'A' }]} onRefresh={onRefresh} leads={[{ ...lead, status: 'Booked', crm_status: 'Booked', appointment_date: new Date().toISOString() }]} />);
    fireEvent.click(screen.getByRole('button', { name: /เช็คอิน/ }));
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith('เช็คอินไม่สำเร็จ'));
    expect(mocks.update.mock.calls[0][1]).not.toHaveProperty('crm_status');
    expect(onRefresh).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it.each([true, false])('reschedule preserves a rented deal and reports a resolved error (%s)', async shouldFail => {
    if (shouldFail) mocks.update.mockResolvedValue({ error: { message: 'Denied' } });
    const onRefresh = vi.fn();
    render(<DailyVisitsScheduleView projects={[{ name: 'A' }]} onRefresh={onRefresh} leads={[{ ...lead, status: 'Rented', crm_status: 'Rented', appointment_date: new Date().toISOString() }]} />);
    fireEvent.click(await screen.findByTitle('เลื่อนนัดหมาย'));
    fireEvent.click(screen.getByRole('button', { name: /บันทึกวันนัดใหม่/ }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledOnce());
    const [, patch] = mocks.update.mock.calls[0];
    expect(patch).not.toHaveProperty('crm_status');
    expect(patch.appointment_date).toEqual(expect.any(String));
    if (shouldFail) {
      expect(window.alert).toHaveBeenCalledWith('เลื่อนนัดหมายไม่สำเร็จ');
      expect(screen.getByRole('button', { name: /บันทึกวันนัดใหม่/ })).toBeInTheDocument();
      expect(onRefresh).not.toHaveBeenCalled();
    } else {
      expect(screen.queryByRole('button', { name: /บันทึกวันนัดใหม่/ })).not.toBeInTheDocument();
      expect(onRefresh).toHaveBeenCalledOnce();
    }
  });
});
