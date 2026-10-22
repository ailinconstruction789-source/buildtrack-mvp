import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MySalesWorkspace from '../MySalesWorkspace';
import type { SalesStartupData } from '@/types/salesStartup';

const mocks = vi.hoisted(() => ({ from: vi.fn(), read: vi.fn(), select: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: mocks.from } }));
vi.mock('@/lib/sales/fetchWithoutLimit', () => ({ fetchSalesWithoutLimit: mocks.read }));
vi.mock('next/dynamic', () => ({ default: () => function DynamicComponent() { return null; } }));

const user = { username: 'PIEW', role: 'Sales', id: 'U1' };
const projects = [{ name: 'Project A' }];
const getBase = (): SalesStartupData => ({
  leads: [{
    id: 'L1',
    customer_name: 'คุณแบม',
    phone: '0812345678',
    project_name: 'Project A',
    interested_plot_id: 'P1',
    sales_owner: 'PIEW',
    status: 'New',
    booking_date: '2026-01-01',
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
  }],
  plots: [{
    id: 'P1',
    plot_name: '1',
    project_name: 'Project A',
    customer_name: 'คุณแบม',
    customer_phone: '0812345678',
    highlight_note: 'จอง: คุณแบม',
    house_types: { type_name: 'Type A' }
  }],
});

let base: SalesStartupData;

beforeEach(() => {
  vi.clearAllMocks();
  base = getBase();
  mocks.read.mockImplementation((table: string) => Promise.resolve(table === 'leads' ? base.leads : table === 'plots' ? base.plots : []));
  mocks.select.mockResolvedValue({ data: [{ id: 1, username: 'PIEW', role: 'Sales' }], error: null });
  mocks.from.mockReturnValue({ select: mocks.select });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Customer Name & Phone Editing in My Sales Workspace', () => {
  it('renders edit button and opens the edit modal with current name and phone', async () => {
    render(<MySalesWorkspace currentUser={user} projects={projects} />);
    await screen.findByText('คุณแบม');

    const editBtn = screen.getByTitle('แก้ไขชื่อและเบอร์โทรลูกค้า');
    expect(editBtn).toBeInTheDocument();

    fireEvent.click(editBtn);

    expect(await screen.findByRole('heading', { name: 'แก้ไขข้อมูลลูกค้า' })).toBeInTheDocument();
    const nameInput = screen.getByPlaceholderText('เช่น นาย สมชาย ใจดี หรือ คุณสมชาย') as HTMLInputElement;
    const phoneInput = screen.getByPlaceholderText('เช่น 0812345678') as HTMLInputElement;

    expect(nameInput.value).toBe('คุณแบม');
    expect(phoneInput.value).toBe('0812345678');
  });

  it('successfully updates customer_name and phone in leads and plots tables and updates UI', async () => {
    const updateLead = vi.fn().mockImplementation((payload: any) => ({
      eq: vi.fn().mockImplementation(() => {
        Object.assign(base.leads[0], payload);
        return Promise.resolve({ error: null });
      })
    }));
    const updatePlot = vi.fn().mockImplementation((payload: any) => ({
      eq: vi.fn().mockImplementation(() => {
        Object.assign(base.plots[0], payload);
        return Promise.resolve({ error: null });
      })
    }));

    mocks.from.mockImplementation((table: string) => {
      if (table === 'leads') {
        return { update: updateLead, select: mocks.select };
      }
      if (table === 'plots') {
        return { update: updatePlot, select: mocks.select };
      }
      return { select: mocks.select };
    });

    const dispatchEventSpy = vi.spyOn(window, 'dispatchEvent');

    render(<MySalesWorkspace currentUser={user} projects={projects} />);
    await screen.findByText('คุณแบม');

    fireEvent.click(screen.getByTitle('แก้ไขชื่อและเบอร์โทรลูกค้า'));

    const nameInput = await screen.findByPlaceholderText('เช่น นาย สมชาย ใจดี หรือ คุณสมชาย');
    const phoneInput = screen.getByPlaceholderText('เช่น 0812345678');

    fireEvent.change(nameInput, { target: { value: 'นางสาว แบม สุภาพร' } });
    fireEvent.change(phoneInput, { target: { value: '0899999999' } });

    fireEvent.click(screen.getByRole('button', { name: 'บันทึกการแก้ไข' }));

    await waitFor(() => {
      expect(updateLead).toHaveBeenCalledWith(expect.objectContaining({
        customer_name: 'นางสาว แบม สุภาพร',
        phone: '0899999999',
      }));
    });

    // Check plot update
    await waitFor(() => {
      expect(updatePlot).toHaveBeenCalledWith(expect.objectContaining({
        customer_name: 'นางสาว แบม สุภาพร',
        customer_phone: '0899999999',
        highlight_note: 'จอง: นางสาว แบม สุภาพร',
      }));
    });

    // Check UI optimistic update
    expect(await screen.findByText('นางสาว แบม สุภาพร')).toBeInTheDocument();
    expect(await screen.findByText('0899999999')).toBeInTheDocument();

    // Check notice
    expect(await screen.findByText(/อัปเดตข้อมูลลูกค้าเป็น "นางสาว แบม สุภาพร" สำเร็จเรียบร้อยแล้ว/)).toBeInTheDocument();

    // Check sync event dispatched
    expect(dispatchEventSpy).toHaveBeenCalledWith(expect.objectContaining({
      type: 'buildtrack:sales_sync',
    }));
  });

  it('rejects saving when customer name is empty', async () => {
    render(<MySalesWorkspace currentUser={user} projects={projects} />);
    await screen.findByText('คุณแบม');

    fireEvent.click(screen.getByTitle('แก้ไขชื่อและเบอร์โทรลูกค้า'));

    const nameInput = await screen.findByPlaceholderText('เช่น นาย สมชาย ใจดี หรือ คุณสมชาย');
    fireEvent.change(nameInput, { target: { value: '   ' } });

    // The submit button is disabled when customerName.trim() is empty
    const submitBtn = screen.getByRole('button', { name: 'บันทึกการแก้ไข' });
    expect(submitBtn).toBeDisabled();
  });
});
