import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
import SalesReportsWorkspace from '../SalesReportsWorkspace';
import { SalesReportsApiError } from '@/lib/sales/salesReportsClient';
import type { SalesReportScope, SalesReportSnapshot } from '@/lib/sales/salesReportsContracts';
import { reportScope, reportSnapshot } from '@/lib/sales/__tests__/salesReportsFixtures';
const apiFor = () => ({ read: vi.fn<(scope: SalesReportScope) => Promise<SalesReportSnapshot>>().mockImplementation(async scope => reportSnapshot(scope)) });
const ready = () => screen.findByRole('region', { name: 'ผลรายงาน' });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('central booking aggregate report', () => {
  it('renders server totals beyond a page, net bookings and separate transferred subset', async () => {
    const api = apiFor(); render(<SalesReportsWorkspace api={api} />); await ready();
    expect(api.read).toHaveBeenCalledWith(reportScope());
    const value = (label: string) => screen.getByText(label, { selector: 'dt' }).parentElement!;
    expect(within(value('จองทั้งหมด')).getByRole('definition')).toHaveTextContent('70');
    expect(within(value('จองสุทธิ (หลัง)')).getByRole('definition')).toHaveTextContent('61');
    expect(within(value('โอน / ส่งมอบแล้ว')).getByRole('definition')).toHaveTextContent('11');
    expect(screen.getByText('999,999,999,999,999.91 บาท')).toBeInTheDocument();
    expect(screen.getByText(/ยังไม่ทราบราคา 3 รายการ/)).toBeInTheDocument();
    expect(screen.getByText(/ไม่ยกเครดิตย้อนหลัง/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /บันทึก|แก้ไข|ยืนยันโอน/ })).not.toBeInTheDocument();
  });
  it('applies original lead date cohort only on submit and exposes unknown exclusions', async () => {
    const api = apiFor(); render(<SalesReportsWorkspace api={api} />); await ready();
    fireEvent.change(screen.getByLabelText('โครงการ'), { target: { value: 'โครงการ & B' } });
    fireEvent.change(screen.getByLabelText('วันที่เริ่มเป็น Lead ตั้งแต่ (ค.ศ.)'), { target: { value: '2024-02-29' } });
    fireEvent.change(screen.getByLabelText('ถึงวันที่ (ค.ศ.)'), { target: { value: '2024-03-01' } });
    expect(api.read).toHaveBeenCalledTimes(1);
    fireEvent.submit(screen.getByRole('form', { name: 'ตัวกรองรายงาน' })); await ready();
    expect(api.read).toHaveBeenLastCalledWith(reportScope({ projectName: 'โครงการ & B', fromDate: '2024-02-29', toDate: '2024-03-01' }));
    expect(screen.getByText(/ตัดออกจากช่วงวันที่ที่เลือก.*5 ลูกค้า/)).toBeInTheDocument();
    expect(screen.getByText(/ไม่ใช่ภาพย้อนหลัง/)).toBeInTheDocument();
    const detail = screen.getByRole('link', { name: /เปิดรายละเอียดการจอง/ }).getAttribute('href')!;
    expect(Object.fromEntries(new URL(detail, 'https://test.invalid').searchParams)).toEqual({ projectName: 'โครงการ & B', tab: 'all' });
    fireEvent.click(screen.getByText('ทุกวันที่ Lead')); await ready();
    expect(api.read).toHaveBeenLastCalledWith(reportScope({ projectName: 'โครงการ & B' }));
  });
  it('rejects incomplete/reversed date filters without a request or replacing current totals', async () => {
    const api = apiFor(); render(<SalesReportsWorkspace api={api} />); await ready();
    fireEvent.change(screen.getByLabelText('วันที่เริ่มเป็น Lead ตั้งแต่ (ค.ศ.)'), { target: { value: '2026-09-01' } });
    fireEvent.submit(screen.getByRole('form', { name: 'ตัวกรองรายงาน' })); expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('ถึงวันที่ (ค.ศ.)'), { target: { value: '2026-08-01' } });
    fireEvent.submit(screen.getByRole('form', { name: 'ตัวกรองรายงาน' })); expect(api.read).toHaveBeenCalledTimes(1);
  });
  it('hides previous totals immediately while loading and after failures; explicit retry recovers', async () => {
    const api = apiFor(); render(<SalesReportsWorkspace api={api} />); await ready();
    let reject!: (reason: unknown) => void;
    api.read.mockReturnValueOnce(new Promise((_, fail) => { reject = fail; }));
    fireEvent.click(screen.getByText('โหลดรายงานล่าสุด'));
    expect(screen.queryByRole('region', { name: 'ผลรายงาน' })).not.toBeInTheDocument();
    await act(async () => reject(new SalesReportsApiError('SETUP_REQUIRED', 'ข้อมูลเก่ายังไม่พร้อม')));
    expect(screen.getByRole('alert')).toHaveTextContent('ข้อมูลเก่ายังไม่พร้อม');
    expect(screen.queryByText('จองสุทธิ (หลัง)')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('ลองโหลดใหม่')); await ready(); expect(api.read).toHaveBeenCalledTimes(3);
  });
  it('ignores out-of-order responses from a previous filter', async () => {
    const api = apiFor(); let resolve!: (value: SalesReportSnapshot) => void;
    api.read.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    render(<SalesReportsWorkspace api={api} />);
    fireEvent.change(screen.getByLabelText('วันที่เริ่มเป็น Lead ตั้งแต่ (ค.ศ.)'), { target: { value: '2026-09-01' } });
    fireEvent.change(screen.getByLabelText('ถึงวันที่ (ค.ศ.)'), { target: { value: '2026-09-30' } });
    fireEvent.submit(screen.getByRole('form', { name: 'ตัวกรองรายงาน' })); await ready();
    await act(async () => resolve(reportSnapshot()));
    expect(screen.getByText('กลุ่ม Lead วันที่ 2026-09-01 ถึง 2026-09-30 (เวลาไทย)')).toBeInTheDocument();
    expect(screen.queryByText('ทุกวันที่ Lead รวมข้อมูลที่ไม่ทราบวันเริ่ม')).not.toBeInTheDocument();
  });
  it('displays unknown, not zero, when all surviving bookings have unknown prices', async () => {
    const api = apiFor(); const data = reportSnapshot(); data.totals.knownNetSaleValue = '0.00'; data.totals.unknownNetSaleValueCount = 61;
    api.read.mockResolvedValue(data); render(<SalesReportsWorkspace api={api} />); await ready();
    expect(screen.getByText('ไม่ทราบมูลค่า')).toBeInTheDocument(); expect(screen.queryByText('0.00 บาท')).not.toBeInTheDocument();
  });
  it('supports all trusted read roles without offering employee score or mutation controls', async () => {
    const api = apiFor(); const data = reportSnapshot(); data.actor.role = 'owner'; api.read.mockResolvedValue(data);
    const back = vi.fn(); render(<SalesReportsWorkspace api={api} onBack={back} />); await ready();
    expect(screen.getByRole('link', { name: 'Lead ส่วนกลาง →' })).toHaveAttribute('href', '/sales-crm');
    fireEvent.click(screen.getByText('← กลับหน้าก่อนหน้า')); expect(back).toHaveBeenCalledOnce();
  });
});
