import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
import ProjectSalesMap from '../ProjectSalesMap';
import type { ProjectMapSnapshot } from '@/lib/sales/projectMapContracts';
import { projectCustomerId, projectSalesSnapshot } from './projectSalesFixtures';

function fixture(projectName = 'โครงการ A'): ProjectMapSnapshot {
  const page = projectSalesSnapshot({ projectName, tab: 'all', query: '', page: 0 });
  page.rows[0].plotId = 'A-2'; page.rows[0].plotName = '2';
  page.rows[1].salePrice = null; page.rows[1].bookedAt = null; page.rows[1].bookingRound = null;
  return { projectName, actor: page.actor,
    layout: { cols: 8, rows: 4, cells: [
      { x: 0, y: 0, type: 'plot', plotId: 'A-1' },
      { x: 2, y: 1, type: 'plot', plotId: 'A-2' }, { x: 3, y: 1, type: 'plot', plotId: 'A-2' },
      { x: 4, y: 1, type: 'road' }, { x: 5, y: 1, type: 'park' },
      { x: 0, y: 3, type: 'fence-h' }, { x: 1, y: 3, type: 'fence-v' }, { x: 2, y: 3, type: 'infra-h' },
    ] },
    plots: [
      { id: 'A-1', name: '1', hasCustomer: false, isCompleted: true, saleStatus: 'ready_for_sale' },
      { id: 'A-2', name: '2', hasCustomer: true, isCompleted: true, saleStatus: 'active' },
    ], salePages: [page] };
}
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; }
const apiFor = () => ({ read: vi.fn(async (projectName: string) => fixture(projectName)) });
const bookedButton = () => screen.findByRole('button', { name: 'แปลง 2 — จอง / อยู่ระหว่างดำเนินการ' });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('central booking read-only project map', () => {
  it('preserves saved geometry with current customer and cancellation history', async () => {
    const api = apiFor(); render(<ProjectSalesMap projectName="โครงการ A" api={api} />);
    const plot = await bookedButton();
    expect(plot).toHaveStyle({ left: '80px', top: '40px', width: '80px', height: '40px' });
    expect(screen.getByTestId('saved-project-layout')).toHaveStyle({ width: '320px', height: '160px' });
    expect(screen.getByTestId('map-road')).toHaveStyle({ left: '160px', top: '40px' });
    for (const type of ['park', 'fence-h', 'fence-v', 'infra-h']) expect(screen.getByTestId(`map-${type}`)).toBeInTheDocument();
    fireEvent.click(plot);
    const detail = within(screen.getByRole('complementary', { name: 'รายละเอียดแปลง 2' }));
    const current = within(detail.getByRole('region', { name: 'ลูกค้าปัจจุบัน' }));
    expect(current.getByText('ลูกค้าคนเดิม')).toBeInTheDocument();
    expect(current.getByText('ผู้ดูแล: Sales ผู้ดูแล')).toBeInTheDocument();
    expect(current.getByText('ราคาขาย: ไม่ทราบ')).toBeInTheDocument();
    expect(current.getByText('วันที่จอง: ไม่ทราบเวลา')).toBeInTheDocument();
    expect(current.getByText('รอบไม่ทราบ (ข้อมูลเดิม)')).toBeInTheDocument();
    expect(current.getByRole('link')).toHaveAttribute('href', `/sales-crm/bookings?customerId=${projectCustomerId}`);
    const history = within(detail.getByRole('region', { name: 'ประวัติของแปลง' }));
    expect(history.getByText('ยกเลิกจอง')).toBeInTheDocument();
    expect(history.getByText('เหตุผลยกเลิก: ลูกค้าขอยกเลิกรอบแรก')).toBeInTheDocument();
    expect(api.read).toHaveBeenCalledExactlyOnceWith('โครงการ A');
  });
  it('keeps construction separate and provides central lead navigation for vacancy', async () => {
    render(<ProjectSalesMap projectName="โครงการ A" api={apiFor()} />); await bookedButton();
    fireEvent.click(screen.getByRole('button', { name: 'แปลง 1 — ว่าง' }));
    const detail = within(screen.getByRole('complementary', { name: 'รายละเอียดแปลง 1' }));
    expect(detail.getByText('งานก่อสร้าง: สร้างเสร็จ (แยกจากสถานะการขาย)')).toBeInTheDocument();
    expect(detail.getByRole('link', { name: 'Lead ส่วนกลาง →' })).toHaveAttribute('href', '/sales-crm');
    expect(screen.queryByRole('button', { name: /บันทึก|ยกเลิกจอง|เตรียมบ้าน|แบบสอบถาม/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
  it('shows cancelled-only plot as vacant while retaining cancellation history', async () => {
    const api = apiFor(); api.read.mockImplementation(async () => { const data = fixture(); data.salePages[0].rows.pop(); data.plots[1].hasCustomer = false; data.plots[1].saleStatus = 'ready_for_sale'; return data; });
    render(<ProjectSalesMap projectName="โครงการ A" api={api} />);
    fireEvent.click(await screen.findByRole('button', { name: 'แปลง 2 — ว่าง' }));
    expect(screen.getByText('ยกเลิกจอง')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'ลูกค้าปัจจุบัน' })).not.toBeInTheDocument();
  });
  it('ignores late responses from previous projects', async () => {
    const a = deferred<ProjectMapSnapshot>(), b = deferred<ProjectMapSnapshot>();
    const api = { read: vi.fn((project: string) => project === 'โครงการ A' ? a.promise : b.promise) };
    const view = render(<ProjectSalesMap projectName="โครงการ A" api={api} />);
    await act(async () => {});
    view.rerender(<ProjectSalesMap projectName="โครงการ B" api={api} />);
    const dataB = fixture('โครงการ B'); dataB.plots[1].name = 'B-unique';
    await act(async () => { b.resolve(dataB); });
    expect(await screen.findByRole('button', { name: /แปลง B-unique/ })).toBeInTheDocument();
    await act(async () => { a.resolve(fixture()); });
    expect(screen.queryByRole('button', { name: /^แปลง 2 / })).not.toBeInTheDocument();
  });
  it('clears displayed customer details immediately on project switch', async () => {
    const pending = deferred<ProjectMapSnapshot>(); const api = apiFor();
    api.read.mockImplementation(project => project === 'โครงการ A' ? Promise.resolve(fixture()) : pending.promise);
    const view = render(<ProjectSalesMap projectName="โครงการ A" api={api} />);
    fireEvent.click(await bookedButton()); expect(screen.getAllByText('ลูกค้าคนเดิม').length).toBeGreaterThan(0);
    view.rerender(<ProjectSalesMap projectName="โครงการ B" api={api} />);
    expect(screen.queryByText('ลูกค้าคนเดิม')).not.toBeInTheDocument();
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  });
  it('hides stale data on refresh and sanitizes failure', async () => {
    const pending = deferred<ProjectMapSnapshot>(); const api = apiFor();
    api.read.mockImplementationOnce(async () => fixture()).mockImplementationOnce(() => pending.promise);
    render(<ProjectSalesMap projectName="โครงการ A" api={api} />); fireEvent.click(await bookedButton());
    fireEvent.click(screen.getByRole('button', { name: 'โหลดผังล่าสุด' }));
    expect(screen.queryByText('ลูกค้าคนเดิม')).not.toBeInTheDocument();
    expect(screen.queryByTestId('saved-project-layout')).not.toBeInTheDocument();
    await act(async () => { pending.reject(new Error('private customer and SQL failure')); });
    expect(await screen.findByRole('alert')).toHaveTextContent('อ่านผังโครงการไม่ได้');
    expect(screen.queryByText(/private customer/)).not.toBeInTheDocument();
  });
  it('shows unmapped selectable list without inventing layout', async () => {
    const api = apiFor(); api.read.mockImplementation(async () => ({ ...fixture(), layout: { cols: 8, rows: 4, cells: [] } }));
    render(<ProjectSalesMap projectName="โครงการ A" api={api} />);
    expect(await screen.findByText(/ยังไม่มีผังที่บันทึกไว้/)).toBeInTheDocument();
    expect(screen.queryByTestId('saved-project-layout')).not.toBeInTheDocument();
    fireEvent.click(await bookedButton());
    expect(screen.getByRole('complementary', { name: 'รายละเอียดแปลง 2' })).toBeInTheDocument();
  });
  it('marks ambiguous occupied plots for review and exposes native buttons and zoom', async () => {
    const api = apiFor(); api.read.mockImplementation(async () => { const data = fixture(); data.plots[0].hasCustomer = true; return data; });
    render(<ProjectSalesMap projectName="โครงการ A" api={api} />); await bookedButton();
    const unknown = screen.getByRole('button', { name: 'แปลง 1 — ต้องตรวจสอบ' });
    unknown.focus(); expect(unknown).toHaveFocus(); expect(unknown.tagName).toBe('BUTTON');
    fireEvent.click(unknown); expect(unknown).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/ไม่ถือเป็นแปลงว่าง/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'ขยายผัง' }));
    expect(screen.getByRole('button', { name: 'คืนขนาดผัง 100%' })).toHaveTextContent('125%');
    fireEvent.click(screen.getByRole('button', { name: 'ย่อผัง' }));
    expect(screen.getByRole('button', { name: 'คืนขนาดผัง 100%' })).toHaveTextContent('100%');
    expect(screen.getByRole('region', { name: 'พื้นที่ผังแปลง เลื่อนเพื่อดูทั้งโครงการ' })).toHaveAttribute('tabindex', '0');
  });
});
