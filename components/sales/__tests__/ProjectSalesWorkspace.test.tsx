import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
import ProjectSalesWorkspace from '../ProjectSalesWorkspace';
import SalesWorkspaceModeProvider from '../SalesWorkspaceModeProvider';
import type { ProjectSalesApi } from '@/lib/sales/projectSalesClient';
import type { ProjectSalesScope, ProjectSalesSnapshot } from '@/lib/sales/projectSalesContracts';
import { oldProjectSaleId, newProjectSaleId, projectCustomerId, projectSalesSnapshot, projectScope } from './projectSalesFixtures';

const apiFor = () => ({ read: vi.fn<(scope: ProjectSalesScope) => Promise<ProjectSalesSnapshot>>().mockImplementation(async scope => projectSalesSnapshot(scope)) });
const renderWorkspace = (api: ProjectSalesApi, initialProjectName: string | null = 'โครงการ A') => render(<ProjectSalesWorkspace api={api} initialProjectName={initialProjectName} />);
const rows = () => screen.queryAllByRole('row', { name: /^การจอง / });
const searchField = () => screen.getByLabelText('ค้นหาชื่อ เบอร์โทร หรือแปลง');
async function ready() { return screen.findByRole('region', { name: 'รายการจองโครงการ โครงการ A' }); }
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; }
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('read-only project booked customers', () => {
  it('keeps project history but hides aggregate reports in the bounded release', async () => {
    const api = apiFor();
    render(<SalesWorkspaceModeProvider mode="central" reportsEnabled={false}><ProjectSalesWorkspace api={api} initialProjectName="โครงการ A" /></SalesWorkspaceModeProvider>);
    await ready(); expect(rows().length).toBeGreaterThan(0);
    expect(screen.queryByRole('link', { name: 'รายงานจองจากส่วนกลาง →' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Lead ส่วนกลาง →' })).toBeInTheDocument();
  });
  it('connects imported sale to central booking history with source dates and no prepared banner', async () => {
    const api = apiFor();
    api.read.mockImplementation(async scope => {
      const snapshot = projectSalesSnapshot(scope);
      snapshot.rows = [snapshot.rows[0]];
      Object.assign(snapshot.rows[0], { stage: 'transferred', bookingRound: null, bookedAt: null, previousSaleId: null,
        importedHistory: { source: 'customer_sheet', batchId: oldProjectSaleId, sourceRow: 966, sourceStage: 'transferred',
          bookedDate: '2024-07-22', cancelledDate: null, transferredDate: '2026-09-26' } });
      return snapshot;
    });
    render(<SalesWorkspaceModeProvider mode="central" postBookingEnabled><ProjectSalesWorkspace api={api} initialProjectName="โครงการ A" initialTab="all" /></SalesWorkspaceModeProvider>);
    await ready();
    const row = within(rows()[0]);
    expect(row.getByText('รอบจอง: ไม่ทราบ')).toBeInTheDocument();
    expect(row.getByText('วันที่จอง: 22/07/2567 (ข้อมูลเดิม — ไม่ทราบเวลา)')).toBeInTheDocument();
    expect(row.getByText('วันที่โอนตามข้อมูลเดิม: 26/09/2569 (ข้อมูลเดิม — ไม่ทราบเวลา)')).toBeInTheDocument();
    expect(row.getByText(/อ้างอิงแถว 966 ในชีต/)).toBeInTheDocument();
    expect(row.getByRole('link', { name: /ประวัติการจองของ.*รอบไม่ทราบ/ })).toHaveAttribute('href', `/sales-crm/bookings?customerId=${projectCustomerId}`);
    expect(screen.queryByRole('region', { name: 'ตัวอย่างข้อมูลเตรียมนำเข้า' })).not.toBeInTheDocument();
    expect(row.queryByRole('link', { name: /งานสัญญา/ })).not.toBeInTheDocument();
  });
  it('labels prepared history, date-only evidence and held rows without operational links', async () => {
    const api = apiFor();
    api.read.mockImplementation(async scope => {
      const snapshot = projectSalesSnapshot(scope);
      const prepared: ProjectSalesSnapshot = {
        ...snapshot,
        prepared: { batchId: '19000000-0000-4000-8000-000000000006', snapshotDate: '2026-09-28', pendingUnlinkedHistories: 3 },
        rows: snapshot.rows.map((sale, index) => ({ ...sale, bookingRound: null,
          stage: index === 0 ? 'cancelled' : 'transferred',
          historyEvidence: { sourceRow: index === 0 ? 171 : 193, bookedDate: '2024-07-22',
            cancelledDate: index === 0 ? '2024-09-23' : null,
            transferredDate: index === 1 ? '2026-09-26' : null, held: index === 0 },
        })),
      };
      return prepared;
    });
    render(<SalesWorkspaceModeProvider mode="central" postBookingEnabled><ProjectSalesWorkspace api={api} initialProjectName="โครงการ A" initialTab="all" /></SalesWorkspaceModeProvider>);
    await ready();
    const banner = within(screen.getByRole('region', { name: 'ตัวอย่างข้อมูลเตรียมนำเข้า' }));
    expect(banner.getByText(/อ่านอย่างเดียว ยังไม่ใช่รายการขายที่เปิดใช้งาน/)).toBeInTheDocument();
    expect(banner.getByText(/28\/09\/2026 \(ค.ศ.\)/)).toBeInTheDocument();
    expect(banner.getByText(/รอ Admin ตรวจทั้งชุด: 3 รายการ/)).toBeInTheDocument();
    expect(banner.getByText(/ไม่ทราบเวลาเกิดเหตุการณ์/)).toBeInTheDocument();
    const cancelled = within(screen.getByRole('row', { name: `การจอง ${oldProjectSaleId}` }));
    expect(cancelled.getByText('วันที่จอง: 22/07/2024')).toBeInTheDocument();
    expect(cancelled.getByText('วันที่ยกเลิก: 23/09/2024')).toBeInTheDocument();
    expect(cancelled.getByText('หลักฐาน: แถว 171 ในสำเนาชีต')).toBeInTheDocument();
    expect(cancelled.getByText('พักรายการไว้ รอ Admin ตรวจ')).toBeInTheDocument();
    const transferred = within(screen.getByRole('row', { name: `การจอง ${newProjectSaleId}` }));
    expect(transferred.getByText('วันที่โอน: 26/09/2026')).toBeInTheDocument();
    expect(transferred.getByText('หลักฐาน: แถว 193 ในสำเนาชีต')).toBeInTheDocument();
    expect(transferred.queryByText('พักรายการไว้ รอ Admin ตรวจ')).not.toBeInTheDocument();
    expect(screen.getAllByText('รอบจอง: ไม่ทราบ')).toHaveLength(2);
    expect(screen.queryByRole('link', { name: /ประวัติการจองของ|สัญญา|รายงานจองจากส่วนกลาง/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /บันทึก|ยกเลิกจอง|นำเข้า|ลบ/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'โหลดล่าสุด' }));
    expect(screen.queryByRole('link', { name: /รายงานจองจากส่วนกลาง/ })).not.toBeInTheDocument();
    await ready();
  });

  it('keeps unknown prepared dates unknown rather than falling back to operational timestamps', async () => {
    const api = apiFor();
    api.read.mockImplementation(async scope => ({ ...projectSalesSnapshot(scope),
      prepared: { batchId: '19000000-0000-4000-8000-000000000006', snapshotDate: '2026-09-28', pendingUnlinkedHistories: 0 },
      rows: projectSalesSnapshot(scope).rows.map((sale, index) => ({ ...sale, bookingRound: null,
        stage: index === 0 ? 'cancelled' : 'transferred', bookedAt: '2026-09-28T01:00:00Z', cancelledAt: '2026-09-28T01:00:00Z',
        historyEvidence: { sourceRow: index + 2, bookedDate: null, cancelledDate: null, transferredDate: null, held: false },
      })),
    }));
    renderWorkspace(api); await ready();
    expect(screen.getAllByText('วันที่จอง: ไม่ทราบ')).toHaveLength(2);
    expect(screen.getByText('วันที่ยกเลิก: ไม่ทราบ')).toBeInTheDocument();
    expect(screen.getByText('วันที่โอน: ไม่ทราบ')).toBeInTheDocument();
    expect(screen.getByText(/รอ Admin ตรวจทั้งชุด: 0 รายการ/)).toBeInTheDocument();
    expect(screen.queryByText(/วันที่จอง:.*2026/)).not.toBeInTheDocument();
  });

  it('shows unlinked prepared history counts even before a project is selected', async () => {
    const api = apiFor(); api.read.mockImplementation(async scope => ({ ...projectSalesSnapshot(scope),
      prepared: { batchId: '19000000-0000-4000-8000-000000000006', snapshotDate: '2026-09-28', pendingUnlinkedHistories: 1 },
    }));
    renderWorkspace(api, null);
    expect(await screen.findByText(/รอ Admin ตรวจทั้งชุด: 1 รายการ/)).toBeInTheDocument();
    expect(rows()).toHaveLength(0);
    expect(screen.queryByRole('link', { name: /รายงานจองจากส่วนกลาง/ })).not.toBeInTheDocument();
  });

  it('links each original round to its own post-booking history only when enabled', async () => {
    render(<SalesWorkspaceModeProvider mode="central" postBookingEnabled><ProjectSalesWorkspace api={apiFor()} initialProjectName="โครงการ A" initialTab="all" /></SalesWorkspaceModeProvider>);
    await ready();
    for (const id of [oldProjectSaleId, newProjectSaleId]) {
      const row = within(screen.getByRole('row', { name: `การจอง ${id}` }));
      expect(row.getByRole('link', { name: /สัญญา/ })).toHaveAttribute('href', `/sales-crm/post-booking?saleId=${id}`);
    }
  });
  it('loads authorized project choices without picking a project automatically', async () => {
    const api = apiFor(); renderWorkspace(api, null);
    expect(await screen.findByText('เลือกโครงการเพื่อดูรายการจองและประวัติ')).toBeInTheDocument();
    expect(api.read).toHaveBeenCalledWith({ projectName: null, tab: 'booked', query: '', page: 0 });
    expect(rows()).toHaveLength(0); expect(screen.getByRole('button', { name: 'ค้นหา' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('โครงการ'), { target: { value: 'โครงการ B' } });
    await screen.findByRole('region', { name: 'รายการจองโครงการ โครงการ B' });
    expect(api.read).toHaveBeenLastCalledWith({ projectName: 'โครงการ B', tab: 'booked', query: '', page: 0 });
  });

  it('keeps separate booking rounds for the same customer with unknown historical evidence', async () => {
    const api = apiFor(); render(<ProjectSalesWorkspace api={api} initialProjectName="โครงการ A" initialTab="all" />); await ready();
    expect(rows()).toHaveLength(2);
    const old = within(screen.getByRole('row', { name: `การจอง ${oldProjectSaleId}` }));
    expect(old.getByText('ไม่ทราบแปลง')).toBeInTheDocument(); expect(old.getByText('ไม่ทราบเบอร์โทร')).toBeInTheDocument();
    expect(old.getByText('ราคาขายบ้าน: ไม่ทราบ')).toBeInTheDocument(); expect(old.getByText('วันที่จอง: ไม่ทราบเวลา')).toBeInTheDocument();
    expect(old.getByText(/ลูกค้าขอยกเลิกรอบแรก/)).toBeInTheDocument(); expect(old.getByText(/วันที่ยกเลิก:/)).not.toHaveTextContent('ไม่ทราบเวลา');
    const current = within(screen.getByRole('row', { name: `การจอง ${newProjectSaleId}` }));
    expect(current.getByText('ราคาขายบ้าน: 1,990,000.00 บาท')).toBeInTheDocument();
    expect(current.getByText(`อ้างอิงจองเดิม ${oldProjectSaleId}`)).toBeInTheDocument();
    expect(screen.getAllByText('Sales ผู้ดูแล (คุณ)')).toHaveLength(2);
    expect(screen.getByText(/ไม่ใช่ยอดรวม \/ KPI/)).toBeInTheDocument();
    for (const link of screen.getAllByRole('link', { name: /ประวัติการจองของ/ })) expect(link).toHaveAttribute('href', `/sales-crm/bookings?customerId=${projectCustomerId}`);
    expect(screen.getByRole('link', { name: /Lead ส่วนกลาง/ })).toHaveAttribute('href', '/sales-crm');
  });

  it('offers no project Lead or mutation actions even for Admin', async () => {
    const api = apiFor(); api.read.mockImplementation(async scope => ({ ...projectSalesSnapshot(scope), actor: { ...projectSalesSnapshot(scope).actor, role: 'admin' } }));
    renderWorkspace(api); await ready();
    expect(screen.queryByRole('tab', { name: /Lead/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /สร้าง|เพิ่มลูกค้า|บันทึก|ยกเลิกจอง|ลบ|นำเข้า|Import|Clear Data/ })).not.toBeInTheDocument();
    expect(screen.getByText(/แบบสอบถาม เตรียมบ้าน และโมดูลโครงการส่วนอื่นยังไม่เปิดในรอบนี้/)).toBeInTheDocument();
  });

  it('allows Owner to read every round and follow customer history links', async () => {
    const api = apiFor(); api.read.mockImplementation(async scope => ({ ...projectSalesSnapshot(scope), actor: { ...projectSalesSnapshot(scope).actor, role: 'owner' } }));
    renderWorkspace(api); await ready(); expect(rows()).toHaveLength(2);
    expect(screen.getAllByRole('link', { name: /ประวัติการจองของ/ })).toHaveLength(2);
  });

  it('sends submitted search to the API instead of filtering the loaded page', async () => {
    const api = apiFor(); renderWorkspace(api); await ready();
    fireEvent.change(searchField(), { target: { value: ' คนที่ยังไม่อยู่หน้านี้ ' } });
    expect(api.read).toHaveBeenCalledTimes(1); expect(rows()).toHaveLength(2);
    fireEvent.submit(screen.getByRole('form', { name: 'ค้นหาการจองในโครงการ' }));
    await waitFor(() => expect(api.read).toHaveBeenLastCalledWith({ ...projectScope, query: 'คนที่ยังไม่อยู่หน้านี้' }));
    expect(await screen.findByText('ผลค้นหา: คนที่ยังไม่อยู่หน้านี้')).toBeInTheDocument();
    expect(rows()).toHaveLength(2);
  });

  it.each(['ก', '😀', 'ก'.repeat(201)])('does not request invalid Unicode query %s', async value => {
    const api = apiFor(); renderWorkspace(api); await ready();
    fireEvent.change(searchField(), { target: { value } }); fireEvent.click(screen.getByRole('button', { name: 'ค้นหา' }));
    expect(screen.getByRole('alert')).toHaveTextContent('2–200'); expect(api.read).toHaveBeenCalledTimes(1);
  });

  it('clears search and resets pagination for each filter change', async () => {
    const api = apiFor(); api.read.mockImplementation(async scope => ({ ...projectSalesSnapshot(scope), hasMore: true }));
    renderWorkspace(api); await ready();
    fireEvent.click(screen.getByRole('button', { name: 'หน้าถัดไป' }));
    await waitFor(() => expect(api.read).toHaveBeenLastCalledWith({ ...projectScope, page: 1 })); await ready();
    fireEvent.change(searchField(), { target: { value: 'ลูกค้า' } }); fireEvent.click(screen.getByRole('button', { name: 'ค้นหา' }));
    await waitFor(() => expect(api.read).toHaveBeenLastCalledWith({ ...projectScope, query: 'ลูกค้า' })); await ready();
    fireEvent.click(screen.getByRole('button', { name: 'หน้าถัดไป' })); await waitFor(() => expect(api.read).toHaveBeenLastCalledWith({ ...projectScope, query: 'ลูกค้า', page: 1 })); await ready();
    fireEvent.click(screen.getByRole('tab', { name: 'ประวัติยกเลิก' })); await waitFor(() => expect(api.read).toHaveBeenLastCalledWith({ ...projectScope, tab: 'cancelled', query: 'ลูกค้า' })); await ready();
    fireEvent.click(screen.getByRole('button', { name: 'ล้างค้นหา' })); await waitFor(() => expect(api.read).toHaveBeenLastCalledWith({ ...projectScope, tab: 'cancelled' })); await ready();
    fireEvent.change(searchField(), { target: { value: 'ร่างค้นหา' } });
    fireEvent.change(screen.getByLabelText('โครงการ'), { target: { value: 'โครงการ B' } });
    await waitFor(() => expect(api.read).toHaveBeenLastCalledWith({ projectName: 'โครงการ B', tab: 'cancelled', query: '', page: 0 }));
    expect(searchField()).toHaveValue('');
  });

  it('hides old rows during a newer request and ignores late project and tab replies', async () => {
    const api = apiFor(), oldRequest = deferred<ProjectSalesSnapshot>(), newRequest = deferred<ProjectSalesSnapshot>();
    renderWorkspace(api); await ready();
    api.read.mockImplementationOnce(() => oldRequest.promise).mockImplementationOnce(() => newRequest.promise);
    fireEvent.click(screen.getByRole('tab', { name: 'ประวัติยกเลิก' })); expect(rows()).toHaveLength(0);
    fireEvent.change(screen.getByLabelText('โครงการ'), { target: { value: 'โครงการ B' } });
    const scopeB = { ...projectScope, projectName: 'โครงการ B', tab: 'cancelled' as const };
    await act(async () => newRequest.resolve(projectSalesSnapshot(scopeB)));
    expect(screen.getByRole('region', { name: 'รายการจองโครงการ โครงการ B' })).toBeInTheDocument();
    await act(async () => oldRequest.resolve(projectSalesSnapshot({ ...projectScope, tab: 'cancelled' })));
    expect(screen.queryByRole('region', { name: 'รายการจองโครงการ โครงการ A' })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'ประวัติยกเลิก' })).toHaveAttribute('aria-selected', 'true');
  });

  it('ignores late page data after changing the search', async () => {
    const api = apiFor(), pendingPage = deferred<ProjectSalesSnapshot>();
    api.read.mockImplementation(async scope => ({ ...projectSalesSnapshot(scope), hasMore: true }));
    renderWorkspace(api); await ready(); api.read.mockImplementationOnce(() => pendingPage.promise);
    fireEvent.click(screen.getByRole('button', { name: 'หน้าถัดไป' })); expect(rows()).toHaveLength(0);
    fireEvent.change(searchField(), { target: { value: 'ใหม่' } }); fireEvent.click(screen.getByRole('button', { name: 'ค้นหา' }));
    expect(await screen.findByText('ผลค้นหา: ใหม่')).toBeInTheDocument();
    await act(async () => pendingPage.resolve(projectSalesSnapshot({ ...projectScope, page: 1 })));
    expect(screen.getByText('ผลค้นหา: ใหม่')).toBeInTheDocument(); expect(screen.getByText(/หน้า 1 · แสดง/)).toBeInTheDocument();
  });

  it('clears customer rows on read error, retries GET only and never displays raw generic errors', async () => {
    const api = apiFor(); renderWorkspace(api); await ready();
    api.read.mockRejectedValueOnce(new Error('SQL error with private diagnostic data'));
    fireEvent.click(screen.getByRole('button', { name: 'โหลดล่าสุด' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('อ่านข้อมูลไม่ได้');
    expect(rows()).toHaveLength(0); expect(screen.queryByText(/private diagnostic data/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'ลองโหลดใหม่' })); await ready();
    expect(api.read).toHaveBeenCalledTimes(3); expect(api.read).toHaveBeenLastCalledWith(projectScope);
  });

  it('does not let late failures replace a successful newer scope', async () => {
    const api = apiFor(), old = deferred<ProjectSalesSnapshot>(); renderWorkspace(api); await ready();
    api.read.mockImplementationOnce(() => old.promise); fireEvent.click(screen.getByRole('tab', { name: 'ประวัติยกเลิก' }));
    fireEvent.click(screen.getByRole('tab', { name: 'โอนแล้ว / ส่งมอบ' })); await ready();
    await act(async () => old.reject(new Error('late failure')));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument(); expect(rows()).toHaveLength(2);
    expect(screen.getByRole('tab', { name: 'โอนแล้ว / ส่งมอบ' })).toHaveAttribute('aria-selected', 'true');
  });

  it('shows empty results without inventing a booking or total count', async () => {
    const api = apiFor(); api.read.mockImplementation(async scope => ({ ...projectSalesSnapshot(scope), rows: [] }));
    renderWorkspace(api); await ready();
    expect(screen.getByText('ไม่พบการจองตามเงื่อนไขนี้')).toBeInTheDocument(); expect(rows()).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'หน้าก่อนหน้า' })).toBeDisabled(); expect(screen.getByRole('button', { name: 'หน้าถัดไป' })).toBeDisabled();
  });

  it('handles changed incoming project props and an optional parent back action', async () => {
    const api = apiFor(), back = vi.fn(); const view = render(<SalesWorkspaceModeProvider mode="central"><ProjectSalesWorkspace api={api} initialProjectName="โครงการ A" onBack={back} /></SalesWorkspaceModeProvider>); await ready();
    fireEvent.click(screen.getByRole('button', { name: /กลับหน้าก่อนหน้า/ })); expect(back).toHaveBeenCalledTimes(1);
    view.rerender(<SalesWorkspaceModeProvider mode="central"><ProjectSalesWorkspace api={api} initialProjectName="โครงการ B" initialTab="transferred" onBack={back} /></SalesWorkspaceModeProvider>);
    await screen.findByRole('region', { name: 'รายการจองโครงการ โครงการ B' });
    expect(api.read).toHaveBeenLastCalledWith({ projectName: 'โครงการ B', tab: 'transferred', query: '', page: 0 });
    const reportLink = screen.getByRole('link', { name: 'รายงานจองจากส่วนกลาง →' }).getAttribute('href')!;
    expect(new URL(reportLink, 'https://test.invalid').searchParams.get('projectName')).toBe('โครงการ B');
  });
});
