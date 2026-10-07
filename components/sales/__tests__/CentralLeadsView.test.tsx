import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: vi.fn() } } }));
vi.mock('@/lib/sales/plotAvailabilityClient', () => ({ loadAvailablePlots: vi.fn().mockResolvedValue([]) }));
import CentralLeadsView from '../CentralLeadsView';
import { CentralApiError } from '@/lib/sales/centralClient';
import { CENTRAL_SEARCH_CONTRACT_VERSION, EMPTY_CENTRAL_SEARCH, type CentralSearchSnapshot, type CentralSearchFilters } from '@/lib/sales/centralContracts';
import { filterCentralTracker } from '@/lib/sales/centralTracker';

const USER = '00000000-0000-4000-8000-000000000001';
function snapshot(role: CentralSearchSnapshot['actor']['role'] = 'sales'): CentralSearchSnapshot {
  const customer = { id: 'customer-1', name: 'ลูกค้าส่วนกลาง', phone: '0812345678', channel: 'โทร', notes: '', ownerUserId: USER, leadCreatedAt: null, intakeStatus: 'new' };
  const interest = { id: 'interest-1', projectName: 'โครงการ A', ownerUserId: USER, engagementStatus: 'new', plotId: null };
  return { actor: { userId: USER, role }, projects: [{ name: 'โครงการ A' }], salesOwners: [{ userId: USER, displayName: 'ฝ่ายขาย A' }],
    page: 0, hasMore: true,
    search: { contractVersion: CENTRAL_SEARCH_CONTRACT_VERSION, filters: { ...EMPTY_CENTRAL_SEARCH }, projects: ['โครงการ A', 'โครงการ B'],
      owners: [{ userId: USER, displayName: 'ฝ่ายขาย A' }], channels: ['โทร', 'นอกหน้าปัจจุบัน'], hasMoreChannels: false }, customers: [
      { ...customer, interests: [] },
      { ...customer, id: 'customer-2', name: 'ลูกค้าเข้าโครงการแล้ว', interests: [{ ...interest, workspaceState: 'project_active' }] },
      { ...customer, id: 'customer-3', name: 'ลูกค้าสนใจสองโครงการ', interests: [{ ...interest, workspaceState: 'project_active' },
        { ...interest, id: 'interest-2', projectName: 'โครงการ B', workspaceState: 'central_interest' }] },
    ] };
}
function readSnapshot(data = snapshot()) {
  return vi.fn().mockImplementation(async (page: number, filters: CentralSearchFilters = EMPTY_CENTRAL_SEARCH) => ({
    ...data, page, search: { ...data.search, filters }, customers: filterCentralTracker(data.customers, filters),
  }));
}
const apply = () => fireEvent.click(screen.getByRole('button', { name: 'ค้นหา / ใช้ตัวกรอง' }));
beforeEach(() => window.sessionStorage.clear());
afterEach(cleanup);

describe('central lead workspace', () => {
  it('keeps central intake button and modal operational', async () => {
    render(<CentralLeadsView api={{ read: readSnapshot(), create: vi.fn() }} bookingEnabled projectSalesEnabled reportsEnabled={false} leadWorkEnabled={false} />);
    await screen.findByText('ลูกค้าส่วนกลาง');
    expect(screen.getByRole('button', { name: '+ บันทึก Lead ใหม่' })).toBeEnabled();
    expect(screen.queryByRole('link', { name: 'รายงานจองจากส่วนกลาง →' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /งานส่วนกลางของ/ })).not.toBeInTheDocument();
  });
  it('applies filters explicitly against the whole registry and resets pagination', async () => {
    const read = readSnapshot();
    render(<CentralLeadsView api={{ read, create: vi.fn() }} />);
    await screen.findByRole('table'); fireEvent.click(screen.getByRole('button', { name: 'ถัดไป →' }));
    await screen.findByText('หน้า 2 · หน้าละ 50 รายการ');
    fireEvent.change(screen.getByLabelText('ค้นหาลูกค้าทั้งทะเบียน'), { target: { value: 'ลูกค้าส่วนกลาง' } });
    expect(read).toHaveBeenCalledTimes(2);
    expect(screen.getByText('ลูกค้าสนใจสองโครงการ')).toBeInTheDocument();
    apply(); await screen.findByText('หน้า 1 · หน้าละ 50 รายการ');
    expect(read).toHaveBeenLastCalledWith(0, { ...EMPTY_CENTRAL_SEARCH, search: 'ลูกค้าส่วนกลาง' });
    expect(screen.queryByText('ลูกค้าสนใจสองโครงการ')).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'นอกหน้าปัจจุบัน', hidden: true })).toBeInTheDocument();
  });
  it('allows exact channel text outside the bounded global suggestions', async () => {
    const data = snapshot(); data.search.hasMoreChannels = true;
    const read = readSnapshot(data);
    render(<CentralLeadsView api={{ read, create: vi.fn() }} />); await screen.findByRole('table');
    expect(screen.getByText(/200 ชื่อแรก/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('ช่องทางรับ Lead'), { target: { value: 'ช่องทางที่ 201' } });
    apply(); await screen.findByRole('table');
    expect(read).toHaveBeenLastCalledWith(0, { ...EMPTY_CENTRAL_SEARCH, channel: 'ช่องทางที่ 201' });
  });
  it('rejects overlong filters before requesting another page', async () => {
    const read = readSnapshot(); render(<CentralLeadsView api={{ read, create: vi.fn() }} />);
    await screen.findByRole('table'); fireEvent.change(screen.getByLabelText('ค้นหาลูกค้าทั้งทะเบียน'), { target: { value: 'a'.repeat(201) } });
    apply(); expect(screen.getByRole('alert')).toBeInTheDocument(); expect(read).toHaveBeenCalledTimes(1);
  });
  it('clears old account data immediately and ignores its late response', async () => {
    let changed = () => {};
    let resolveOld!: (data: CentralSearchSnapshot) => void;
    const late = new Promise<CentralSearchSnapshot>(resolve => { resolveOld = resolve; });
    const read = vi.fn().mockResolvedValueOnce(snapshot()).mockReturnValueOnce(late)
      .mockRejectedValueOnce(new CentralApiError('UNAUTHENTICATED', 'กรุณาเข้าสู่ระบบ', 401));
    const unsubscribe = vi.fn();
    const api = { read, create: vi.fn(), watchIdentity: (callback: () => void) => { changed = callback; return unsubscribe; } };
    const view = render(<CentralLeadsView api={api} />); await screen.findByRole('table');
    fireEvent.click(screen.getByRole('button', { name: 'ถัดไป →' }));
    act(() => changed()); await screen.findByText('เข้าสู่ระบบก่อนใช้งาน');
    await act(async () => resolveOld({ ...snapshot(), page: 1 }));
    expect(screen.queryByText('ลูกค้าส่วนกลาง')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    view.unmount(); expect(unsubscribe).toHaveBeenCalledOnce();
  });
  it('keeps booking integration hidden by default and opens booking drawer when enabled', async () => {
    const api = { read: readSnapshot(), create: vi.fn() };
    const { rerender } = render(<CentralLeadsView api={api} />);
    await screen.findByRole('table');
    fireEvent.click(screen.getByRole('button', { name: 'ข้อมูลด่วนและจัดการ ลูกค้าส่วนกลาง' }));
    expect(screen.queryByRole('button', { name: /จองและประวัติของ/ })).not.toBeInTheDocument();
    rerender(<CentralLeadsView api={api} bookingEnabled />);
    fireEvent.click(screen.getByRole('button', { name: 'ข้อมูลด่วนและจัดการ ลูกค้าส่วนกลาง' }));
    expect(screen.getByRole('button', { name: 'จองและประวัติของ ลูกค้าส่วนกลาง' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '+ บันทึก Lead ใหม่' }));
    expect(screen.queryByRole('button', { name: /จองและประวัติของ/ })).not.toBeInTheDocument();
  });
  it.each(['sales', 'owner', 'admin'] as const)('only offers queue monitoring to enabled Admin, checking %s', async role => {
    render(<CentralLeadsView api={{ read: readSnapshot(snapshot(role)), create: vi.fn() }} queueMonitorEnabled />);
    await screen.findByRole('table');
    const link = screen.queryByRole('link', { name: 'ตรวจคิวแจ้งเตือน (Admin) →' });
    if (role === 'admin') expect(link).toHaveAttribute('href', '/sales-crm/queue-monitor');
    else expect(link).not.toBeInTheDocument();
  });
  it('hides queue monitoring by default and during intake without reading the queue', async () => {
    const api = { read: readSnapshot(snapshot('admin')), create: vi.fn() };
    const { rerender } = render(<CentralLeadsView api={api} />); await screen.findByRole('table');
    expect(screen.queryByRole('link', { name: 'ตรวจคิวแจ้งเตือน (Admin) →' })).not.toBeInTheDocument();
    rerender(<CentralLeadsView api={api} queueMonitorEnabled />);
    expect(screen.getByRole('link', { name: 'ตรวจคิวแจ้งเตือน (Admin) →' })).toHaveAttribute('href', '/sales-crm/queue-monitor');
    fireEvent.click(screen.getByRole('button', { name: '+ บันทึก Lead ใหม่' }));
    expect(screen.queryByRole('link', { name: 'ตรวจคิวแจ้งเตือน (Admin) →' })).not.toBeInTheDocument();
    expect(api.read).toHaveBeenCalledTimes(1);
  });
  it.each(['sales', 'owner', 'admin'] as const)('only offers manual SLA processing to an enabled Admin, checking %s', async role => {
    render(<CentralLeadsView api={{ read: readSnapshot(snapshot(role)), create: vi.fn() }} slaPreviewEnabled />);
    await screen.findByRole('table');
    const link = screen.queryByRole('link', { name: 'ประมวลผลและตรวจใบรับ (Admin) →' });
    if (role === 'admin') expect(link).toHaveAttribute('href', '/sales-crm/sla-processing');
    else expect(link).not.toBeInTheDocument();
  });
  it('hides manual SLA processing by default and during central intake', async () => {
    const api = { read: readSnapshot(snapshot('admin')), create: vi.fn() };
    const { rerender } = render(<CentralLeadsView api={api} />); await screen.findByRole('table');
    expect(screen.queryByRole('link', { name: 'ประมวลผลและตรวจใบรับ (Admin) →' })).not.toBeInTheDocument();
    rerender(<CentralLeadsView api={api} slaPreviewEnabled />);
    fireEvent.click(screen.getByRole('button', { name: '+ บันทึก Lead ใหม่' }));
    expect(screen.queryByRole('link', { name: 'ประมวลผลและตรวจใบรับ (Admin) →' })).not.toBeInTheDocument();
  });
  it.each(['sales', 'owner', 'admin'] as const)('only offers SLA preview to an enabled Admin, checking %s', async role => {
    render(<CentralLeadsView api={{ read: readSnapshot(snapshot(role)), create: vi.fn() }} slaPreviewEnabled />);
    await screen.findByRole('table');
    const link = screen.queryByRole('link', { name: 'ตรวจแผนแจ้งเตือน (Admin) →' });
    if (role === 'admin') expect(link).toHaveAttribute('href', '/sales-crm/sla-preview');
    else expect(link).not.toBeInTheDocument();
  });
  it('hides SLA preview by default and during central intake', async () => {
    const api = { read: readSnapshot(snapshot('admin')), create: vi.fn() };
    const { rerender } = render(<CentralLeadsView api={api} />); await screen.findByRole('table');
    expect(screen.queryByRole('link', { name: 'ตรวจแผนแจ้งเตือน (Admin) →' })).not.toBeInTheDocument();
    rerender(<CentralLeadsView api={api} slaPreviewEnabled />); fireEvent.click(screen.getByRole('button', { name: '+ บันทึก Lead ใหม่' }));
    expect(screen.queryByRole('link', { name: 'ตรวจแผนแจ้งเตือน (Admin) →' })).not.toBeInTheDocument();
  });
  it.each(['sales', 'owner', 'admin'] as const)('offers only the own-inbox link to %s when enabled', async role => {
    render(<CentralLeadsView api={{ read: readSnapshot(snapshot(role)), create: vi.fn() }} notificationsEnabled />);
    await screen.findByRole('table');
    expect(screen.getByRole('link', { name: 'การแจ้งเตือนของฉัน →' })).toHaveAttribute('href', '/sales-crm/notifications');
  });
  it('hides the inbox while disabled or an intake form is open', async () => {
    const api = { read: readSnapshot(), create: vi.fn() };
    const { rerender } = render(<CentralLeadsView api={api} />); await screen.findByRole('table');
    expect(screen.queryByRole('link', { name: 'การแจ้งเตือนของฉัน →' })).not.toBeInTheDocument();
    rerender(<CentralLeadsView api={api} notificationsEnabled />);
    fireEvent.click(screen.getByRole('button', { name: '+ บันทึก Lead ใหม่' }));
    expect(screen.queryByRole('link', { name: 'การแจ้งเตือนของฉัน →' })).not.toBeInTheDocument();
  });
  it.each(['sales', 'owner', 'admin'] as const)('only shows enabled work schedule entry to Admin, not %s by assumption', async role => {
    render(<CentralLeadsView api={{ read: readSnapshot(snapshot(role)), create: vi.fn() }} workScheduleEnabled />);
    await screen.findByRole('table');
    const link = screen.queryByRole('link', { name: 'จัดเวรฝ่ายขาย (Admin) →' });
    if (role === 'admin') expect(link).toHaveAttribute('href', '/sales-crm/work-schedule');
    else expect(link).not.toBeInTheDocument();
  });
  it('does not show schedule entry to Admin while disabled or while the intake form is open', async () => {
    const api = { read: readSnapshot(snapshot('admin')), create: vi.fn() };
    const { rerender } = render(<CentralLeadsView api={api} />); await screen.findByRole('table');
    expect(screen.queryByRole('link', { name: 'จัดเวรฝ่ายขาย (Admin) →' })).not.toBeInTheDocument();
    rerender(<CentralLeadsView api={api} workScheduleEnabled />);
    fireEvent.click(screen.getByRole('button', { name: '+ บันทึก Lead ใหม่' }));
    expect(screen.queryByRole('link', { name: 'จัดเวรฝ่ายขาย (Admin) →' })).not.toBeInTheDocument();
  });
  it('keeps new follow-up navigation hidden by default', async () => {
    render(<CentralLeadsView api={{ read: readSnapshot(), create: vi.fn() }} />);
    await screen.findByRole('table');
    expect(screen.queryByRole('button', { name: /งานส่วนกลางของ/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ติดตามโครงการ/ })).not.toBeInTheDocument();
  });
  it('links central and project scopes separately when explicitly enabled, including read-only Owner', async () => {
    const api = { read: readSnapshot(snapshot('owner')), create: vi.fn() };
    render(<CentralLeadsView api={api} leadWorkEnabled />);
    await screen.findByRole('table');
    fireEvent.click(screen.getByRole('button', { name: 'ข้อมูลด่วนและจัดการ ลูกค้าส่วนกลาง' }));
    expect(screen.getByRole('button', { name: 'งานส่วนกลางของ ลูกค้าส่วนกลาง' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'ปิดแผงข้อมูล' }));
    fireEvent.click(screen.getByRole('button', { name: 'ข้อมูลด่วนและจัดการ ลูกค้าสนใจสองโครงการ' }));
    expect(screen.getByRole('button', { name: 'ติดตามโครงการ โครงการ B ของ ลูกค้าสนใจสองโครงการ' }))
      .toBeInTheDocument();
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
  it('keeps every customer centrally by default, including old project-active flags', async () => {
    render(<CentralLeadsView api={{ read: readSnapshot(), create: vi.fn() }} />);
    await screen.findByText('ลูกค้าสนใจสองโครงการ');
    expect(screen.getByText('ลูกค้าเข้าโครงการแล้ว')).toBeInTheDocument();
    expect(screen.queryByText('รอเข้าโครงการ')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('ค้นหาลูกค้าทั้งทะเบียน'), { target: { value: 'ลูกค้าส่วนกลาง' } });
    apply(); await screen.findByRole('table');
    expect(screen.getByText('ลูกค้าส่วนกลาง')).toBeInTheDocument();
    expect(screen.queryByText('ลูกค้าสนใจสองโครงการ')).not.toBeInTheDocument();
  });
  it('allows Owner to read but not create', async () => {
    render(<CentralLeadsView api={{ read: readSnapshot(snapshot('owner')), create: vi.fn() }} />);
    await screen.findByRole('table');
    expect(screen.getByRole('button', { name: '+ บันทึก Lead ใหม่' })).toBeDisabled();
  });

  it('shows unknown historical phone without fabricating a number', async () => {
    const data = snapshot();
    data.customers[0].phone = null;
    render(<CentralLeadsView api={{ read: readSnapshot(data), create: vi.fn() }} />);
    await screen.findByText('ไม่ทราบ (ข้อมูลเก่า)');
    expect(screen.getByText('ลูกค้าส่วนกลาง')).toBeInTheDocument();
    expect(screen.getAllByText('0812345678')).toHaveLength(2);
    expect(screen.queryByText('null')).not.toBeInTheDocument();
  });
  it('searches a null phone as empty while preserving name and real-phone searches', async () => {
    const data = snapshot();
    data.customers[0].phone = null;
    render(<CentralLeadsView api={{ read: readSnapshot(data), create: vi.fn() }} />);
    await screen.findByText('ไม่ทราบ (ข้อมูลเก่า)');
    const search = screen.getByLabelText('ค้นหาลูกค้าทั้งทะเบียน');
    fireEvent.change(search, { target: { value: 'null' } }); apply(); await screen.findByRole('table');
    expect(screen.queryByText('ลูกค้าส่วนกลาง')).not.toBeInTheDocument();
    expect(screen.getByText('ไม่พบรายการตามเงื่อนไขในหน้านี้')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('ค้นหาลูกค้าทั้งทะเบียน'), { target: { value: 'ลูกค้าส่วนกลาง' } }); apply(); await screen.findByRole('table');
    expect(screen.getByText('ลูกค้าส่วนกลาง')).toBeInTheDocument();
    expect(screen.getByText('ไม่ทราบ (ข้อมูลเก่า)')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('ค้นหาลูกค้าทั้งทะเบียน'), { target: { value: '0812345678' } }); apply(); await screen.findByRole('table');
    expect(screen.queryByText('ลูกค้าส่วนกลาง')).not.toBeInTheDocument();
    expect(screen.getByText('ลูกค้าสนใจสองโครงการ')).toBeInTheDocument();
  });
  it('requests another bounded page and never displays old page data as current', async () => {
    const read = vi.fn().mockResolvedValueOnce(snapshot()).mockResolvedValueOnce({ ...snapshot(), page: 1, hasMore: false, customers: [] });
    render(<CentralLeadsView api={{ read, create: vi.fn() }} />);
    await screen.findByRole('table'); fireEvent.click(screen.getByRole('button', { name: 'ถัดไป →' }));
    await waitFor(() => expect(read).toHaveBeenLastCalledWith(1, EMPTY_CENTRAL_SEARCH));
    await screen.findByText('หน้า 2 · หน้าละ 50 รายการ');
    expect(screen.queryByText('ลูกค้าส่วนกลาง')).not.toBeInTheDocument();
  });
  it('reuses the tracker layout and filters interests without duplicating the customer', async () => {
    render(<CentralLeadsView api={{ read: readSnapshot(), create: vi.fn() }} leadWorkEnabled />);
    await screen.findByRole('table');
    expect(screen.getByRole('heading', { name: /Lead Tracker/ })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'แปลงที่เล็ง' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('โครงการที่สนใจ'), { target: { value: 'โครงการ B' } }); apply(); await screen.findByRole('table');
    expect(screen.getAllByText('ลูกค้าสนใจสองโครงการ')).toHaveLength(1);
    expect(screen.queryByText('ลูกค้าเข้าโครงการแล้ว')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'ข้อมูลด่วนและจัดการ ลูกค้าสนใจสองโครงการ' }));
    expect(screen.getByRole('button', { name: 'ติดตามโครงการ โครงการ B ของ ลูกค้าสนใจสองโครงการ' }))
      .toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'ปิดแผงข้อมูล' }));
    fireEvent.click(screen.getByLabelText('ยังไม่ระบุโครงการเท่านั้น')); apply(); await screen.findByRole('table');
    expect(screen.getByText('ลูกค้าส่วนกลาง')).toBeInTheDocument();
    expect(screen.queryByText('ลูกค้าสนใจสองโครงการ')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'ล้างตัวกรอง' })); await screen.findByRole('table');
    expect(screen.getByText('ลูกค้าสนใจสองโครงการ')).toBeInTheDocument();
  });
  it('does not expose old booking, deletion or import writes through the central table', async () => {
    const create = vi.fn();
    render(<CentralLeadsView api={{ read: readSnapshot(), create }} leadWorkEnabled />);
    await screen.findByRole('table');
    expect(screen.queryByRole('button', { name: /จองแปลง|นำเข้า Excel|Clear Data|กลับมาติดตามต่อ/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '+ บันทึก Lead ใหม่' }));
    expect(screen.queryByRole('button', { name: /งานส่วนกลางของ|ติดตามโครงการ/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText('ค้นหาลูกค้าทั้งทะเบียน')).toBeDisabled();
    expect(create).not.toHaveBeenCalled();
  });
  it('keeps applied whole-registry filters on page changes and does not claim total count', async () => {
    const read = readSnapshot();
    render(<CentralLeadsView api={{ read, create: vi.fn() }} />);
    await screen.findByRole('table');
    fireEvent.change(screen.getByLabelText('โครงการที่สนใจ'), { target: { value: 'โครงการ B' } }); apply(); await screen.findByRole('table');
    fireEvent.click(screen.getByRole('button', { name: 'ถัดไป →' }));
    await screen.findByText('หน้า 2 · หน้าละ 50 รายการ');
    expect(screen.getByLabelText('โครงการที่สนใจ')).toHaveValue('โครงการ B');
    expect(screen.getByText(/ค้นหาและกรองจาก Lead ทั้งทะเบียนก่อนแบ่งหน้า/)).toBeInTheDocument();
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
    expect(screen.queryByRole('form', { name: 'บันทึก Lead ส่วนกลาง' })).not.toBeInTheDocument();
    expect(create).toHaveBeenCalledTimes(1);
  });
});
