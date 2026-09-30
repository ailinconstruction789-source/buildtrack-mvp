import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { ExcelReportData } from '@/lib/sales/excelReportContracts';
import { projectSalesSnapshot } from './projectSalesFixtures';
vi.mock('recharts', () => {
  const Container = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  const Empty = () => null;
  return { ResponsiveContainer: Container, ComposedChart: Container, CartesianGrid: Empty, XAxis: Empty, YAxis: Empty,
    Tooltip: Empty, Legend: Empty, Area: Empty, Bar: Empty };
});
import CentralExcelReportView from '../CentralExcelReportView';

function fixture(): ExcelReportData {
  const page = projectSalesSnapshot({ projectName: 'โครงการ A', tab: 'all', query: '', page: 0 });
  page.rows[0].plotId = 'A-2'; page.rows[0].plotName = '2';
  page.rows[1].plotName = '2'; page.rows[1].salePrice = null;
  return { loadedAt: '2026-09-30T06:00:00Z', projects: [{ map: { projectName: 'โครงการ A', actor: page.actor,
    layout: { cols: 3, rows: 1, cells: [{ x: 0, y: 0, type: 'plot', plotId: 'A-1' }, { x: 1, y: 0, type: 'plot', plotId: 'A-2' }] },
    plots: [{ id: 'A-1', name: '1', hasCustomer: false, saleStatus: 'ready_for_sale', isCompleted: true },
      { id: 'A-2', name: '2', hasCustomer: true, saleStatus: 'active', isCompleted: true }], salePages: [page] },
    evidence: { contractVersion: 'excel_evidence_v1', projectName: 'โครงการ A', actor: page.actor,
      legacyVisits: [{ key: 'source-row-2', customerId: page.rows[1].customerId, visitDate: '2026-09-10', leadDate: '2026-09-10' }],
      completedVisits: [{ key: 'visit-1', customerId: page.rows[1].customerId, visitDate: '2026-09-25' }],
      forecasts: [{ saleId: page.rows[1].saleId, expectedTransferDate: '2026-09-29' }], pendingLegacyRows: 2, pendingLegacyKeys: ['batch:3', 'batch:4'], unknownLegacyDates: 0,
      unassignedLegacyVisits: [], unknownUnassignedLegacyDates: 0 },
    catalog: [{ plotId: 'A-1', basePrice: 2000000, appraisalPrice: null, isInfrastructure: false },
      { plotId: 'A-2', basePrice: 2000000, appraisalPrice: null, isInfrastructure: false }] }] };
}
afterEach(cleanup);
describe('central Excel report presentation', () => {
  it('preserves dashboard sections and history without counting leads as visits', () => {
    render(<CentralExcelReportView data={fixture()} surface="dashboard" projectName={null} onProjectChange={vi.fn()} onRefresh={vi.fn()}/>);
    expect(screen.getByRole('heading', { name: 'Monthly Sale Report 2026' })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'สถานะแปลงแยกโครงการ' })).toBeInTheDocument();
    const history = within(screen.getByRole('table', { name: 'ประวัติการจองลูกค้า' }));
    expect(history.getAllByText('ลูกค้าคนเดิม')).toHaveLength(2);
    expect(history.getByText('ยกเลิกจอง')).toBeInTheDocument();
    expect(history.getByText('จองแล้ว')).toBeInTheDocument();
    expect(history.getAllByText('ไม่ทราบ').length).toBeGreaterThan(0);
    expect(screen.getByText(/ไม่ใช้จำนวน Lead แทนยอดเข้าชม/)).toBeInTheDocument();
    expect(screen.getByText(/ข้อมูลเดิม 1 ครั้ง.*Customer Voices แล้ว 1 ครั้ง/)).toBeInTheDocument();
    expect(screen.getByText(/ข้อมูลเดิมรอ Admin ตรวจ 2 รายการ/)).toBeInTheDocument();
    expect(screen.getByText('คาดการณ์รอโอนในเดือน: 1 หลัง')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'วันที่ที่ไม่ทราบ' })).toHaveTextContent('ไม่ทราบวันจอง 0 รายการ');
  });
  it('preserves nine-column summary and unknown values, not zero amounts', () => {
    render(<CentralExcelReportView data={fixture()} surface="summary" projectName="โครงการ A" onProjectChange={vi.fn()} onRefresh={vi.fn()}/>);
    const table = within(screen.getByRole('table', { name: 'ตารางสรุปฝั่งขาย' }));
    expect(table.getAllByRole('columnheader')).toHaveLength(9);
    expect(table.getByText('ไม่มีลูกค้า')).toBeInTheDocument();
    expect(table.getByText('ลูกค้าคนเดิม')).toBeInTheDocument();
    expect(table.getAllByText('ไม่ทราบ')).toHaveLength(3);
    expect(table.getByText('2026-09-29')).toBeInTheDocument();
    expect(table.queryByText(/฿0/)).not.toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'ประวัติการจองลูกค้า' })).not.toBeInTheDocument();
  });
  it('project and refresh controls delegate to reader and do not write data', () => {
    const change = vi.fn(), refresh = vi.fn();
    render(<CentralExcelReportView data={fixture()} surface="summary" projectName={null} onProjectChange={change} onRefresh={refresh}/>);
    fireEvent.change(screen.getByRole('combobox', { name: 'เลือกโครงการ' }), { target: { value: 'โครงการ A' } });
    expect(change).toHaveBeenCalledExactlyOnceWith('โครงการ A');
    fireEvent.click(screen.getByRole('button', { name: 'โหลดใหม่' }));
    expect(refresh).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: /บันทึก|ยกเลิกจอง|นำเข้า/ })).not.toBeInTheDocument();
  });
  it('expands project plots and opens the original stock breakdown interaction', () => {
    render(<CentralExcelReportView data={fixture()} surface="dashboard" projectName={null} onProjectChange={vi.fn()} onRefresh={vi.fn()}/>);
    const expand = screen.getByRole('button', { name: 'โครงการ A' });
    expect(expand).toHaveAttribute('aria-expanded', 'false'); fireEvent.click(expand);
    expect(expand).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('รายชื่อแปลง:')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /บ้านทั้งหมด.*ดูรายละเอียด/ }));
    expect(screen.getByRole('dialog', { name: 'รายละเอียดรวมบ้านทั้งหมด' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'ปิดรายละเอียด' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('never imports legacy readers or the nested construction writer', () => {
    const source = readFileSync('components/sales/CentralExcelReportView.tsx', 'utf8');
    for (const unsafe of ['WaitingForTransferDetails', '@/lib/supabase', '.from(', '.update(', '.insert(', 'fetch(']) expect(source).not.toContain(unsafe);
  });
});
