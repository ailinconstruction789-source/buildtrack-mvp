import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Lead } from '@/types/sales';

const mocks = vi.hoisted(() => ({ from: vi.fn(), recheck: vi.fn(), writes: [] as { table: string; payload: unknown }[],
  sales: [] as { id: string }[], writeError: null as { message: string } | null }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: mocks.from } }));
vi.mock('@/lib/sales/plotAvailabilityClient', () => ({ recheckInterestedPlot: mocks.recheck }));
vi.mock('../CustomerVoicesModal', () => ({ default: () => null }));
vi.mock('../HouseVisitChecklistModal', () => ({ default: () => null }));
vi.mock('../AvailablePlotSelect', () => ({
  default: ({ projectName, onChange }: { projectName: string; onChange: (plot: unknown) => void }) =>
    <button type="button" onClick={() => onChange({ id: 'text-plot-A1', plot_name: 'A1', project_name: projectName })}>เลือกแปลงว่างทดสอบ</button>,
}));
import LeadTrackerView from '../LeadTrackerView';

const lead: Lead = { id: 'lead-1', customer_name: 'ลูกค้าทดสอบ', phone: '0812345678', project_name: 'โครงการ A',
  interested_plot_id: 'text-plot-A1', interested_plot_name: 'A1', created_at: '2026-09-01T02:00:00Z' };

function mount(leads: Lead[] = []) {
  const refresh = vi.fn();
  render(<LeadTrackerView leads={leads} projects={[{ name: 'โครงการ A' }]}
    selectedProjectName="โครงการ A" user={{ username: 'Sales A', role: 'Sales' }} onRefresh={refresh} />);
  return refresh;
}

beforeEach(() => {
  vi.clearAllMocks(); mocks.writes.length = 0; mocks.sales = []; mocks.writeError = null;
  vi.spyOn(window, 'alert').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  mocks.recheck.mockImplementation(async (_project: string, id: string | null) => id ? {
    id, plot_name: 'A1', project_name: 'โครงการ A', has_customer: false, sale_status: 'active',
  } : null);
  mocks.from.mockImplementation((table: string) => ({
    insert: async (payload: unknown) => { mocks.writes.push({ table, payload }); return { error: mocks.writeError }; },
    update: (payload: unknown) => ({ eq: async () => { mocks.writes.push({ table, payload }); return { error: mocks.writeError }; } }),
    select: () => ({ eq: () => ({ limit: async () => ({ data: mocks.sales, error: null }) }) }),
  }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('legacy forms during V2 preparation (all database operations mocked)', () => {
  it('stores optional plot identity without reserving it, uses the recorder, and does not invent first contact', async () => {
    const refresh = mount();
    fireEvent.click(screen.getByRole('button', { name: /เพิ่ม Lead ใหม่/ }));
    fireEvent.change(screen.getByPlaceholderText('เช่น คุณสมชาย ใจดี'), { target: { value: ' ลูกค้าทดสอบ ' } });
    fireEvent.change(screen.getByPlaceholderText('081-xxx-xxxx'), { target: { value: '0812345678' } });
    fireEvent.click(screen.getByRole('button', { name: 'เลือกแปลงว่างทดสอบ' }));
    fireEvent.submit(screen.getByRole('button', { name: 'บันทึก Lead' }).closest('form')!);
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(mocks.writes).toHaveLength(1);
    expect(mocks.writes[0]).toMatchObject({ table: 'leads', payload: [{
      customer_name: 'ลูกค้าทดสอบ', phone: '0812345678', agent_name: 'Sales A', created_by_agent: 'Sales A',
      interested_plot_id: 'text-plot-A1', interested_plot_name: 'A1', contacted_date: null, auto_status: 'Lead เข้า',
    }] });
    expect(mocks.recheck).toHaveBeenCalledWith('โครงการ A', 'text-plot-A1');
  });

  it('requires phone and stops before writing if the chosen plot is no longer available', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: /เพิ่ม Lead ใหม่/ }));
    fireEvent.change(screen.getByPlaceholderText('เช่น คุณสมชาย ใจดี'), { target: { value: 'ลูกค้า' } });
    fireEvent.submit(screen.getByRole('button', { name: 'บันทึก Lead' }).closest('form')!);
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith('กรุณาระบุชื่อและเบอร์โทรก่อนสร้าง Lead'));
    expect(mocks.writes).toHaveLength(0);
    fireEvent.change(screen.getByPlaceholderText('081-xxx-xxxx'), { target: { value: '0812345678' } });
    mocks.recheck.mockRejectedValueOnce(new Error('แปลงไม่ว่างแล้ว'));
    fireEvent.submit(screen.getByRole('button', { name: 'บันทึก Lead' }).closest('form')!);
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith('แปลงไม่ว่างแล้ว'));
    expect(mocks.writes).toHaveLength(0);
  });

  it('prebooking Lost never releases an interested plot or cancels another sale', async () => {
    const refresh = mount([lead]);
    fireEvent.click(screen.getByTitle('ระบุเป็น Lost / ยกเลิก'));
    fireEvent.submit(screen.getByRole('button', { name: /บันทึก Lost ก่อนจอง/ }).closest('form')!);
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(mocks.writes).toHaveLength(1);
    expect(mocks.writes[0].table).toBe('leads');
    expect(mocks.from.mock.calls.some(([table]) => table === 'plots')).toBe(false);
  });

  it('blocks prebooking Lost when the customer already has a sale', async () => {
    mocks.sales = [{ id: 'sale-1' }];
    const refresh = mount([lead]);
    fireEvent.click(screen.getByTitle('ระบุเป็น Lost / ยกเลิก'));
    fireEvent.submit(screen.getByRole('button', { name: /บันทึก Lost ก่อนจอง/ }).closest('form')!);
    await waitFor(() => expect(window.alert).toHaveBeenCalled());
    expect(mocks.writes).toHaveLength(0);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('checking in a booked customer does not reset the sale stage', async () => {
    mocks.sales = [{ id: 'sale-1' }];
    const refresh = mount([{ ...lead, status: 'Contracted', crm_status: 'Contracted — ทำสัญญาแล้ว' }]);
    fireEvent.click(screen.getByRole('button', { name: /เช็คอินเข้าชม/ }));
    fireEvent.click(screen.getByRole('button', { name: 'เลือกแปลงว่างทดสอบ' }));
    fireEvent.submit(screen.getByRole('button', { name: 'ยืนยันการเข้าชมจริง' }).closest('form')!);
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(mocks.writes).toHaveLength(1);
    expect(mocks.writes[0]).toMatchObject({ table: 'leads', payload: { interested_plot_id: 'text-plot-A1' } });
    expect(mocks.writes[0].payload).not.toHaveProperty('crm_status');
    expect(mocks.writes[0].payload).not.toHaveProperty('status');
  });

  it('a database update error does not close the Visit form or report success', async () => {
    mocks.writeError = { message: 'denied' };
    const refresh = mount([lead]);
    fireEvent.click(screen.getByRole('button', { name: /เช็คอินเข้าชม/ }));
    fireEvent.submit(screen.getByRole('button', { name: 'ยืนยันการเข้าชมจริง' }).closest('form')!);
    await waitFor(() => expect(window.alert).toHaveBeenCalled());
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'ยืนยันการเข้าชมจริง' })).toBeInTheDocument();
  });
});
