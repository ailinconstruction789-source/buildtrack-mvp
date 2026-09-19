import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: vi.fn() } } }));
vi.mock('@/lib/sales/plotAvailabilityClient', () => ({ loadAvailablePlots: vi.fn().mockResolvedValue([]) }));
import CentralLeadsView from '../CentralLeadsView';
import { CentralApiError } from '@/lib/sales/centralClient';
import type { CentralSnapshot } from '@/lib/sales/centralContracts';

const USER = '00000000-0000-4000-8000-000000000001';
function snapshot(role: CentralSnapshot['actor']['role'] = 'sales'): CentralSnapshot {
  const customer = { id: 'customer-1', name: 'ลูกค้าส่วนกลาง', phone: '0812345678', channel: 'โทร', notes: '', ownerUserId: USER, leadCreatedAt: null, intakeStatus: 'new' };
  const interest = { id: 'interest-1', projectName: 'โครงการ A', ownerUserId: USER, engagementStatus: 'new', plotId: null };
  return { actor: { userId: USER, role }, projects: [{ name: 'โครงการ A' }], salesOwners: [{ userId: USER, displayName: 'ฝ่ายขาย A' }],
    page: 0, hasMore: true, customers: [
      { ...customer, interests: [] },
      { ...customer, id: 'customer-2', name: 'ลูกค้าเข้าโครงการแล้ว', interests: [{ ...interest, workspaceState: 'project_active' }] },
      { ...customer, id: 'customer-3', name: 'ลูกค้าสนใจสองโครงการ', interests: [{ ...interest, workspaceState: 'project_active' },
        { ...interest, id: 'interest-2', projectName: 'โครงการ B', workspaceState: 'central_interest' }] },
    ] };
}
afterEach(cleanup);

describe('central lead workspace', () => {
  it.each(['sales', 'owner', 'admin'] as const)('only offers manual SLA processing to an enabled Admin, checking %s', async role => {
    render(<CentralLeadsView api={{ read: vi.fn().mockResolvedValue(snapshot(role)), create: vi.fn() }} slaPreviewEnabled />);
    await screen.findByRole('table');
    const link = screen.queryByRole('link', { name: 'ประมวลผลและตรวจใบรับ (Admin) →' });
    if (role === 'admin') expect(link).toHaveAttribute('href', '/sales-crm/sla-processing');
    else expect(link).not.toBeInTheDocument();
  });
  it('hides manual SLA processing by default and during central intake', async () => {
    const api = { read: vi.fn().mockResolvedValue(snapshot('admin')), create: vi.fn() };
    const { rerender } = render(<CentralLeadsView api={api} />); await screen.findByRole('table');
    expect(screen.queryByRole('link', { name: 'ประมวลผลและตรวจใบรับ (Admin) →' })).not.toBeInTheDocument();
    rerender(<CentralLeadsView api={api} slaPreviewEnabled />);
    fireEvent.click(screen.getByRole('button', { name: '+ บันทึก Lead ใหม่' }));
    expect(screen.queryByRole('link', { name: 'ประมวลผลและตรวจใบรับ (Admin) →' })).not.toBeInTheDocument();
  });
  it.each(['sales', 'owner', 'admin'] as const)('only offers SLA preview to an enabled Admin, checking %s', async role => {
    render(<CentralLeadsView api={{ read: vi.fn().mockResolvedValue(snapshot(role)), create: vi.fn() }} slaPreviewEnabled />);
    await screen.findByRole('table');
    const link = screen.queryByRole('link', { name: 'ตรวจแผนแจ้งเตือน (Admin) →' });
    if (role === 'admin') expect(link).toHaveAttribute('href', '/sales-crm/sla-preview');
    else expect(link).not.toBeInTheDocument();
  });
  it('hides SLA preview by default and during central intake', async () => {
    const api = { read: vi.fn().mockResolvedValue(snapshot('admin')), create: vi.fn() };
    const { rerender } = render(<CentralLeadsView api={api} />); await screen.findByRole('table');
    expect(screen.queryByRole('link', { name: 'ตรวจแผนแจ้งเตือน (Admin) →' })).not.toBeInTheDocument();
    rerender(<CentralLeadsView api={api} slaPreviewEnabled />); fireEvent.click(screen.getByRole('button', { name: '+ บันทึก Lead ใหม่' }));
    expect(screen.queryByRole('link', { name: 'ตรวจแผนแจ้งเตือน (Admin) →' })).not.toBeInTheDocument();
  });
  it.each(['sales', 'owner', 'admin'] as const)('offers only the own-inbox link to %s when enabled', async role => {
    render(<CentralLeadsView api={{ read: vi.fn().mockResolvedValue(snapshot(role)), create: vi.fn() }} notificationsEnabled />);
    await screen.findByRole('table');
    expect(screen.getByRole('link', { name: 'การแจ้งเตือนของฉัน →' })).toHaveAttribute('href', '/sales-crm/notifications');
  });
  it('hides the inbox while disabled or an intake form is open', async () => {
    const api = { read: vi.fn().mockResolvedValue(snapshot()), create: vi.fn() };
    const { rerender } = render(<CentralLeadsView api={api} />); await screen.findByRole('table');
    expect(screen.queryByRole('link', { name: 'การแจ้งเตือนของฉัน →' })).not.toBeInTheDocument();
    rerender(<CentralLeadsView api={api} notificationsEnabled />);
    fireEvent.click(screen.getByRole('button', { name: '+ บันทึก Lead ใหม่' }));
    expect(screen.queryByRole('link', { name: 'การแจ้งเตือนของฉัน →' })).not.toBeInTheDocument();
  });
  it.each(['sales', 'owner', 'admin'] as const)('only shows enabled work schedule entry to Admin, not %s by assumption', async role => {
    render(<CentralLeadsView api={{ read: vi.fn().mockResolvedValue(snapshot(role)), create: vi.fn() }} workScheduleEnabled />);
    await screen.findByRole('table');
    const link = screen.queryByRole('link', { name: 'จัดเวรฝ่ายขาย (Admin) →' });
    if (role === 'admin') expect(link).toHaveAttribute('href', '/sales-crm/work-schedule');
    else expect(link).not.toBeInTheDocument();
  });
  it('does not show schedule entry to Admin while disabled or while the intake form is open', async () => {
    const api = { read: vi.fn().mockResolvedValue(snapshot('admin')), create: vi.fn() };
    const { rerender } = render(<CentralLeadsView api={api} />); await screen.findByRole('table');
    expect(screen.queryByRole('link', { name: 'จัดเวรฝ่ายขาย (Admin) →' })).not.toBeInTheDocument();
    rerender(<CentralLeadsView api={api} workScheduleEnabled />);
    fireEvent.click(screen.getByRole('button', { name: '+ บันทึก Lead ใหม่' }));
    expect(screen.queryByRole('link', { name: 'จัดเวรฝ่ายขาย (Admin) →' })).not.toBeInTheDocument();
  });
  it('keeps new follow-up navigation hidden by default', async () => {
    render(<CentralLeadsView api={{ read: vi.fn().mockResolvedValue(snapshot()), create: vi.fn() }} />);
    await screen.findByRole('table');
    expect(screen.queryByRole('link', { name: /งานส่วนกลางของ/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /ติดตามโครงการ/ })).not.toBeInTheDocument();
  });
  it('links central and project scopes separately when explicitly enabled, including read-only Owner', async () => {
    const api = { read: vi.fn().mockResolvedValue(snapshot('owner')), create: vi.fn() };
    render(<CentralLeadsView api={api} leadWorkEnabled />);
    await screen.findByRole('table');
    expect(screen.getByRole('link', { name: 'งานส่วนกลางของ ลูกค้าส่วนกลาง' })).toHaveAttribute('href', '/sales-crm/customer-1');
    expect(screen.getByRole('link', { name: 'ติดตามโครงการ โครงการ B ของ ลูกค้าสนใจสองโครงการ' }))
      .toHaveAttribute('href', '/sales-crm/customer-3?interestId=interest-2');
    expect(api.create).not.toHaveBeenCalled();
  });
  it.each(['FEATURE_DISABLED', 'SETUP_REQUIRED'])('shows a setup state for %s, not an empty list', async code => {
    const api = { read: vi.fn().mockRejectedValue(new CentralApiError(code, 'ระบบยังไม่เปิด', 503)), create: vi.fn() };
    render(<CentralLeadsView api={api} />);
    await screen.findByText('ยังไม่เปิดการบันทึก Lead ส่วนกลาง');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ บันทึก Lead ใหม่' })).toBeDisabled();
    expect(api.create).not.toHaveBeenCalled();
  });
  it('keeps a prospect visible centrally when another project is already active', async () => {
    render(<CentralLeadsView api={{ read: vi.fn().mockResolvedValue(snapshot()), create: vi.fn() }} />);
    await screen.findByText('ลูกค้าสนใจสองโครงการ');
    expect(screen.queryByText('ลูกค้าเข้าโครงการแล้ว')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'ลูกค้าทั้งหมด' }));
    expect(screen.getByText('ลูกค้าเข้าโครงการแล้ว')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('ค้นหาลูกค้าในหน้านี้'), { target: { value: 'ลูกค้าส่วนกลาง' } });
    expect(screen.getByText('ลูกค้าส่วนกลาง')).toBeInTheDocument();
    expect(screen.queryByText('ลูกค้าสนใจสองโครงการ')).not.toBeInTheDocument();
  });
  it('allows Owner to read but not create', async () => {
    render(<CentralLeadsView api={{ read: vi.fn().mockResolvedValue(snapshot('owner')), create: vi.fn() }} />);
    await screen.findByRole('table');
    expect(screen.getByRole('button', { name: '+ บันทึก Lead ใหม่' })).toBeDisabled();
  });
  it('shows unknown historical phone without fabricating a number', async () => {
    const data = snapshot();
    data.customers[0].phone = null;
    render(<CentralLeadsView api={{ read: vi.fn().mockResolvedValue(data), create: vi.fn() }} />);
    await screen.findByText('ไม่ทราบ (ข้อมูลเก่า)');
    expect(screen.getByText('ลูกค้าส่วนกลาง')).toBeInTheDocument();
    expect(screen.getByText('0812345678')).toBeInTheDocument();
    expect(screen.queryByText('null')).not.toBeInTheDocument();
  });
  it('searches a null phone as empty while preserving name and real-phone searches', async () => {
    const data = snapshot();
    data.customers[0].phone = null;
    render(<CentralLeadsView api={{ read: vi.fn().mockResolvedValue(data), create: vi.fn() }} />);
    await screen.findByText('ไม่ทราบ (ข้อมูลเก่า)');
    const search = screen.getByLabelText('ค้นหาลูกค้าในหน้านี้');
    fireEvent.change(search, { target: { value: 'null' } });
    expect(screen.queryByText('ลูกค้าส่วนกลาง')).not.toBeInTheDocument();
    expect(screen.getByText('ไม่พบรายการในหน้านี้ตามเงื่อนไข')).toBeInTheDocument();
    fireEvent.change(search, { target: { value: 'ลูกค้าส่วนกลาง' } });
    expect(screen.getByText('ลูกค้าส่วนกลาง')).toBeInTheDocument();
    expect(screen.getByText('ไม่ทราบ (ข้อมูลเก่า)')).toBeInTheDocument();
    fireEvent.change(search, { target: { value: '0812345678' } });
    expect(screen.queryByText('ลูกค้าส่วนกลาง')).not.toBeInTheDocument();
    expect(screen.getByText('ลูกค้าสนใจสองโครงการ')).toBeInTheDocument();
  });
  it('requests another bounded page and never displays old page data as current', async () => {
    const read = vi.fn().mockResolvedValueOnce(snapshot()).mockResolvedValueOnce({ ...snapshot(), page: 1, hasMore: false, customers: [] });
    render(<CentralLeadsView api={{ read, create: vi.fn() }} />);
    await screen.findByRole('table'); fireEvent.click(screen.getByRole('button', { name: 'ถัดไป →' }));
    await waitFor(() => expect(read).toHaveBeenLastCalledWith(1));
    await screen.findByText('หน้า 2 · หน้าละ 50 รายการ');
    expect(screen.queryByText('ลูกค้าส่วนกลาง')).not.toBeInTheDocument();
  });
  it('preserves successful save feedback if the subsequent list refresh fails', async () => {
    const read = vi.fn().mockResolvedValueOnce(snapshot()).mockRejectedValueOnce(new Error('โหลดรายการล้มเหลว'));
    const create = vi.fn().mockResolvedValue({ customerId: USER, replayed: false });
    render(<CentralLeadsView api={{ read, create }} />);
    await screen.findByRole('table'); fireEvent.click(screen.getByRole('button', { name: '+ บันทึก Lead ใหม่' }));
    fireEvent.change(screen.getByLabelText('ชื่อลูกค้า *'), { target: { value: 'ลูกค้าใหม่' } });
    fireEvent.change(screen.getByLabelText('เบอร์โทร *'), { target: { value: '0812345678' } });
    fireEvent.submit(screen.getByRole('form', { name: 'บันทึก Lead ส่วนกลาง' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('status')).toHaveTextContent('บันทึก Lead ส่วนกลางแล้ว');
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
    expect(create).toHaveBeenCalledTimes(1);
  });
});
