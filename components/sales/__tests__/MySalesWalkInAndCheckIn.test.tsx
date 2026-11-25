import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MySalesWorkspace from '../MySalesWorkspace';
import type { SalesStartupData } from '@/types/salesStartup';

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      select: mocks.select,
      insert: (rows: unknown) => {
        mocks.insert(table, rows);
        return {
          select: () => ({
            single: async () => ({ data: { id: 'new-lead-id' }, error: null }),
          }),
        };
      },
      update: (patch: unknown) => ({
        eq: async (col: string, val: unknown) => {
          mocks.update(table, patch, col, val);
          return { error: null };
        },
      }),
    }),
  },
}));

vi.mock('@/lib/sales/fetchWithoutLimit', () => ({ fetchSalesWithoutLimit: mocks.read }));
vi.mock('next/dynamic', () => ({ default: () => () => null }));

const user = { id: 'U1', username: 'FIELD', role: 'Sales' };
const projects = [{ name: 'ไอลิน 4' }, { name: 'ไอลิน6' }];

const baseData: SalesStartupData = {
  plots: [],
  leads: [
    {
      id: 'L-EMMA',
      customer_name: 'คุณเอมม่า',
      project_name: 'ไอลิน 4',
      interested_plot_name: '81',
      channel: 'Walk in',
      sales_owner: 'FIELD',
      status: 'New',
      crm_status: 'Follow-up — อยู่ระหว่างติดตาม',
      created_at: '2026-11-20T03:00:00Z',
    },
    {
      id: 'L-VISITED',
      customer_name: 'คุณเข้าชมแล้ว',
      project_name: 'ไอลิน 4',
      channel: 'Walk in',
      sales_owner: 'FIELD',
      status: 'Visit',
      crm_status: 'Considering — กำลังพิจารณา / เปรียบเทียบ',
      actual_visit_date: '2026-11-24T05:00:00Z',
      created_at: '2026-11-24T05:00:00Z',
    },
    {
      id: 'L-MIND',
      customer_name: 'น้องมายด์',
      project_name: 'ไอลิน6',
      channel: 'Walk in',
      sales_owner: 'FIELD',
      status: 'Interested',
      crm_status: 'Interested',
      actual_visit_date: '2026-06-22T05:00:00Z',
      created_at: '2026-06-22T05:00:00Z',
    },
    {
      id: 'L-APPT',
      customer_name: 'คุณนัดชมยังไม่มา',
      project_name: 'ไอลิน6',
      channel: 'Line OA',
      sales_owner: 'FIELD',
      status: 'New',
      crm_status: 'Appointment — นัดหมายเข้าชมโครงการ',
      appointment_date: '2026-11-28T03:00:00Z',
      created_at: '2026-11-20T03:00:00Z',
    },
    {
      id: 'L-LOAN',
      customer_name: 'คุณยื่นกู้',
      project_name: 'ไอลิน 4',
      channel: 'Facebook',
      sales_owner: 'FIELD',
      status: 'Loan',
      crm_status: 'ยื่นกู้ธนาคาร',
      created_at: '2026-11-20T03:00:00Z',
    },
    {
      id: 'L-BOOKED',
      customer_name: 'คุณจองแล้ว',
      project_name: 'ไอลิน 4',
      channel: 'Facebook',
      sales_owner: 'FIELD',
      status: 'Booked',
      crm_status: 'วางเงินจองแปลงแล้ว',
      booking_date: '2026-11-20T03:00:00Z',
      created_at: '2026-11-20T03:00:00Z',
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.select.mockResolvedValue({ data: [{ id: 'U1', username: 'FIELD', role: 'Sales' }], error: null });
  mocks.read.mockResolvedValue([]);
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  vi.spyOn(window, 'alert').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('MySalesWorkspace Walk-in auto-visit & direct Check-in', () => {
  it('auto-records Visit and actual_visit_date when creating a Walk in lead', async () => {
    render(<MySalesWorkspace currentUser={user} projects={projects} loadStartupData={vi.fn().mockResolvedValue(baseData)} />);
    await screen.findByText('คุณเอมม่า');

    fireEvent.click(screen.getByRole('button', { name: /เพิ่ม Lead ใหม่/ }));
    fireEvent.change(screen.getByPlaceholderText('เช่น คุณสมชาย รักดี'), { target: { value: 'คุณวอล์คอิน ใหม่' } });

    const channelSelect = screen.getByDisplayValue('Facebook');
    fireEvent.change(channelSelect, { target: { value: 'Walk in' } });

    expect(screen.getByText(/นับเป็นการเข้าชมโครงการ \(Visit\) ให้อัตโนมัติทันที/)).toBeInTheDocument();

    fireEvent.submit(screen.getByPlaceholderText('เช่น คุณสมชาย รักดี').closest('form')!);

    await waitFor(() => expect(mocks.insert).toHaveBeenCalledTimes(1));
    const [table, rows] = mocks.insert.mock.calls[0];
    expect(table).toBe('leads');
    expect(rows[0]).toMatchObject({
      customer_name: 'คุณวอล์คอิน ใหม่',
      channel: 'Walk in',
      source: 'Walk in',
      status: 'Visit',
      auto_status: 'เข้าชมแล้ว',
      crm_status: 'Considering — กำลังพิจารณา / เปรียบเทียบ',
    });
    expect(rows[0].actual_visit_date).toEqual(expect.any(String));
    expect(rows[0].appointment_date).toBeUndefined();
  });

  it('keeps non-Walk-in leads as New Follow-up without actual_visit_date', async () => {
    render(<MySalesWorkspace currentUser={user} projects={projects} loadStartupData={vi.fn().mockResolvedValue(baseData)} />);
    await screen.findByText('คุณเอมม่า');

    fireEvent.click(screen.getByRole('button', { name: /เพิ่ม Lead ใหม่/ }));
    fireEvent.change(screen.getByPlaceholderText('เช่น คุณสมชาย รักดี'), { target: { value: 'คุณเฟซบุ๊ก' } });
    fireEvent.submit(screen.getByPlaceholderText('เช่น คุณสมชาย รักดี').closest('form')!);

    await waitFor(() => expect(mocks.insert).toHaveBeenCalledTimes(1));
    const [, rows] = mocks.insert.mock.calls[0];
    expect(rows[0]).toMatchObject({
      customer_name: 'คุณเฟซบุ๊ก',
      channel: 'Facebook',
      status: 'New',
      auto_status: 'Lead เข้า',
      crm_status: 'Follow-up — อยู่ระหว่างติดตาม',
    });
    expect(rows[0].actual_visit_date).toBeUndefined();
  });

  it('allows direct Check-in from My Sales Hub table for unvisited follow-up leads and hides it for visited/booked leads', async () => {
    render(<MySalesWorkspace currentUser={user} projects={projects} loadStartupData={vi.fn().mockResolvedValue(baseData)} />);
    await screen.findByText('คุณเอมม่า');

    const emmaRow = within(screen.getByText('คุณเอมม่า').closest('tr')!);
    const checkInBtn = emmaRow.getByRole('button', { name: 'เช็คอิน' });
    expect(checkInBtn).toBeEnabled();

    const visitedRow = within(screen.getByText('คุณเข้าชมแล้ว').closest('tr')!);
    expect(visitedRow.queryByRole('button', { name: 'เช็คอิน' })).not.toBeInTheDocument();
    expect(visitedRow.getByText(/เข้าชมแล้ว:/)).toBeInTheDocument();

    const bookedRow = within(screen.getByText('คุณจองแล้ว').closest('tr')!);
    expect(bookedRow.queryByRole('button', { name: 'เช็คอิน' })).not.toBeInTheDocument();

    fireEvent.click(checkInBtn);

    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
    const [table, patch, col, val] = mocks.update.mock.calls[0];
    expect(table).toBe('leads');
    expect(col).toBe('id');
    expect(val).toBe('L-EMMA');
    expect(patch).toMatchObject({
      status: 'Visit',
      auto_status: 'เข้าชมแล้ว',
      crm_status: 'Considering — กำลังพิจารณา / เปรียบเทียบ',
    });
    expect(patch.actual_visit_date).toEqual(expect.any(String));
  });

  it('preserves loan stage while recording actual_visit_date on Check-in', async () => {
    render(<MySalesWorkspace currentUser={user} projects={projects} loadStartupData={vi.fn().mockResolvedValue(baseData)} />);
    await screen.findByText('คุณยื่นกู้');

    const loanRow = within(screen.getByText('คุณยื่นกู้').closest('tr')!);
    fireEvent.click(loanRow.getByRole('button', { name: 'เช็คอิน' }));

    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
    const [, patch] = mocks.update.mock.calls[0];
    expect(patch.actual_visit_date).toEqual(expect.any(String));
    expect(patch.auto_status).toBe('เข้าชมแล้ว');
    expect(patch.status).toBeUndefined();
    expect(patch.crm_status).toBeUndefined();
  });

  it('offers Check-in on unvisited Kanban cards and shows visited badge when already checked in', async () => {
    render(<MySalesWorkspace currentUser={user} projects={projects} loadStartupData={vi.fn().mockResolvedValue(baseData)} />);
    await screen.findByText('คุณเอมม่า');

    fireEvent.click(screen.getByTitle('มุมมองการ์ดบอร์ด (Kanban View)'));

    const emmaCard = screen.getByText('คุณเอมม่า').closest<HTMLElement>('[class*="rounded-xl"]')!;
    expect(within(emmaCard).getByRole('button', { name: 'เช็คอิน' })).toBeInTheDocument();

    const visitedCard = screen.getByText('คุณเข้าชมแล้ว').closest<HTMLElement>('[class*="rounded-xl"]')!;
    expect(within(visitedCard).queryByRole('button', { name: 'เช็คอิน' })).not.toBeInTheDocument();
    expect(within(visitedCard).getByText(/เข้าชมแล้ว:/)).toBeInTheDocument();
    expect(within(visitedCard).getByRole('button', { name: /จอง/ })).toBeInTheDocument();
    expect(within(visitedCard).getByRole('button', { name: /เช่า/ })).toBeInTheDocument();
  });

  it('separates visited leads (including Interested with actual_visit_date) into the เข้าชมแล้ว tab away from active and appointment tabs', async () => {
    let checkedInPatch: Record<string, unknown> | null = null;
    mocks.update.mockImplementation((_table: string, patch: Record<string, unknown>) => {
      checkedInPatch = patch;
    });
    const loadStartupData = vi.fn().mockImplementation(async () => ({
      ...baseData,
      leads: baseData.leads.map(l => (l.id === 'L-EMMA' && checkedInPatch ? { ...l, ...checkedInPatch } : l)),
    }));

    render(<MySalesWorkspace currentUser={user} projects={projects} loadStartupData={loadStartupData} />);
    await screen.findByText('คุณเอมม่า');

    // Active tab: should contain unvisited คุณเอมม่า, NOT น้องมายด์ or คุณนัดชมยังไม่มา
    fireEvent.click(screen.getByRole('button', { name: /กำลังติดตาม \/ สนใจ/ }));
    expect(screen.getByText('คุณเอมม่า')).toBeInTheDocument();
    expect(screen.queryByText('น้องมายด์')).not.toBeInTheDocument();
    expect(screen.queryByText('คุณเข้าชมแล้ว')).not.toBeInTheDocument();
    expect(screen.queryByText('คุณนัดชมยังไม่มา')).not.toBeInTheDocument();

    // Appointment tab: should contain unvisited appointment only
    fireEvent.click(screen.getByRole('button', { name: /^📅 นัดชมโครงการ \d+$/ }));
    expect(screen.getByText('คุณนัดชมยังไม่มา')).toBeInTheDocument();
    expect(screen.queryByText('น้องมายด์')).not.toBeInTheDocument();
    expect(screen.queryByText('คุณเข้าชมแล้ว')).not.toBeInTheDocument();

    // Visited tab: should contain both น้องมายด์ (Interested + actual_visit_date) and คุณเข้าชมแล้ว
    fireEvent.click(screen.getByRole('button', { name: /✅ เข้าชมแล้ว/ }));
    expect(screen.getByText('น้องมายด์')).toBeInTheDocument();
    expect(screen.getByText('คุณเข้าชมแล้ว')).toBeInTheDocument();
    expect(screen.queryByText('คุณเอมม่า')).not.toBeInTheDocument();
    expect(screen.queryByText('คุณนัดชมยังไม่มา')).not.toBeInTheDocument();

    // Checking in คุณเอมม่า from Active tab moves her directly into เข้าชมแล้ว tab
    fireEvent.click(screen.getByRole('button', { name: /กำลังติดตาม \/ สนใจ/ }));
    fireEvent.click(within(screen.getByText('คุณเอมม่า').closest('tr')!).getByRole('button', { name: 'เช็คอิน' }));
    await waitFor(() => expect(screen.queryByText('คุณเอมม่า')).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /✅ เข้าชมแล้ว/ }));
    expect(screen.getByText('คุณเอมม่า')).toBeInTheDocument();
  });
});
