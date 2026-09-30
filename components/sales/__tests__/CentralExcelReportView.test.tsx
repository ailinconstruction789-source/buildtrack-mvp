import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { ExcelReportData } from '@/lib/sales/excelReportContracts';
import { projectSalesSnapshot } from './projectSalesFixtures';
vi.mock('recharts', () => {
  const Container = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  const Empty = () => null;
  const Chart = ({ children, data }: { children?: React.ReactNode; data: unknown }) => <div data-testid="chart" data-chart-data={JSON.stringify(data)}>{children}</div>;
  const Series = ({ children, dataKey, stroke, strokeWidth, dot }: { children?: React.ReactNode; dataKey: string; stroke?: string; strokeWidth?: number; dot?: unknown }) => <div data-testid="series" data-key={dataKey} data-stroke={stroke} data-width={strokeWidth} data-dot={JSON.stringify(dot)}>{children}</div>;
  return { ResponsiveContainer: Container, ComposedChart: Chart, CartesianGrid: Empty, XAxis: Empty, YAxis: Empty,
    Tooltip: Empty, Legend: Empty, Area: Series, Line: Series, Bar: Empty,
    LabelList: ({ dataKey }: { dataKey: string }) => <span data-testid="chart-value-label" data-key={dataKey}/> };
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
    expect(screen.getByText('รอโอน (1)')).toBeInTheDocument();
    expect(screen.getByText(/ไม่ทราบวันจอง 0/)).toBeInTheDocument();
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
    for (const file of ['CentralExcelReportView', 'CentralLegacyDashboard', 'CentralLegacyWaitingDetails']) {
      const source = readFileSync(`components/sales/${file}.tsx`, 'utf8');
      for (const unsafe of ["from './WaitingForTransferDetails'", '@/lib/supabase', '.from(', '.update(', '.insert(', 'fetch(']) expect(source).not.toContain(unsafe);
    }
  });
  it('restores original chart order, four comparison years, full-width visits and cumulative labels', () => {
    render(<CentralExcelReportView data={fixture()} surface="dashboard" projectName={null} onProjectChange={vi.fn()} onRefresh={vi.fn()}/>);
    const comparison = screen.getByRole('heading', { name: 'สรุปยอดจองและยอดโอน บจก. สมสมัย' });
    const cumulative = screen.getByRole('heading', { name: 'สรุปยอดสะสม (Cumulative) ประจำปี' });
    expect(comparison.compareDocumentPosition(cumulative) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const titles = screen.getAllByRole('heading', { level: 3 }).map(element => element.textContent);
    expect(titles.filter(title => /ปี 2023 - 2026/.test(title ?? ''))).toEqual([
      'ยอดโอน ปี 2023 - 2026 (หลัง)', 'ยอดจอง ปี 2023 - 2026 (หลัง)', 'ยอดเข้าชม ปี 2023 - 2026 (ครั้ง)',
    ]);
    const charts = screen.getAllByTestId('chart');
    expect(charts).toHaveLength(7);
    for (const chart of charts.slice(1, 4)) {
      expect(within(chart).getAllByTestId('series').map(series => series.dataset.key)).toEqual(['y2023', 'y2024', 'y2025', 'y2026']);
      const latest = within(chart).getAllByTestId('series')[3];
      expect(latest).toHaveAttribute('data-stroke', '#6366f1');
      expect(latest).toHaveAttribute('data-width', '4');
      expect(JSON.parse(latest.dataset.dot!)).toMatchObject({ r: 5, fill: '#ffffff' });
    }
    expect(screen.getAllByTestId('chart-value-label')).toHaveLength(3);
    expect(screen.queryByRole('spinbutton', { name: 'ปีกราฟสะสม' })).not.toBeInTheDocument();
    const select = screen.getByRole('combobox', { name: 'ปีกราฟสะสม' });
    expect(within(select).getAllByRole('option').map(option => option.textContent)).toEqual(['2023', '2024', '2025', '2026']);
    for (const name of ['ยอดเข้าชม ปี 2023 - 2026 (ครั้ง)', 'ยอดเข้าชมสะสม ปี 2026 (ครั้ง)']) {
      const card = screen.getByRole('heading', { name }).parentElement!;
      expect(card).toHaveClass('h-80');
      expect(card.parentElement).not.toHaveClass('md:grid-cols-2');
    }
  });
  it('keeps A/Voices evidence and cutoff in comparative charts when changing cumulative year', () => {
    const data = fixture();
    data.projects[0].evidence.legacyVisits.push(
      { key: 'old-year', customerId: 'old', visitDate: '2025-09-10', leadDate: '2025-09-10' },
      { key: 'future-visit', customerId: 'future', visitDate: '2026-10-01', leadDate: '2026-10-01' },
    );
    render(<CentralExcelReportView data={data} surface="dashboard" projectName={null} onProjectChange={vi.fn()} onRefresh={vi.fn()}/>);
    const chartData = (index: number) => JSON.parse(screen.getAllByTestId('chart')[index].dataset.chartData!);
    expect(chartData(3)[8]).toMatchObject({ month: 'กันยายน', y2025: 1, y2026: 2 });
    expect(chartData(3)[9].y2026).toBeNull();
    expect(chartData(2)[8].y2026).toBe(1);
    expect(chartData(6)[8].cumulative).toBe(2);
    fireEvent.change(screen.getByRole('combobox', { name: 'ปีกราฟสะสม' }), { target: { value: '2025' } });
    expect(screen.getByRole('heading', { name: 'ยอดโอนสะสม ปี 2025 (หลัง)' })).toBeInTheDocument();
    expect(chartData(6)[8].cumulative).toBe(1);
    expect(chartData(3)[8].y2026).toBe(2);
    fireEvent.change(screen.getByLabelText('ข้อมูลเหตุการณ์ถึงวันที่'), { target: { value: '2026-09-15' } });
    expect(chartData(3)[8].y2026).toBe(1);
    expect(chartData(2)[8].y2026).toBe(0);
  });
  it('does not substitute catalog base price or appraisal for unknown contract amounts', () => {
    render(<CentralExcelReportView data={fixture()} surface="dashboard" projectName={null} onProjectChange={vi.fn()} onRefresh={vi.fn()}/>);
    const total = screen.getByText('ยอดขายทั้งปี 2026 (รวมยกเลิก)').parentElement!;
    expect(total).toHaveTextContent('ไม่ทราบ');
    expect(total).not.toHaveTextContent('2,000,000');
    expect(screen.getByText('ยอด ท.ด. ปี 2026 (รวมยกเลิก)').parentElement!).toHaveTextContent('ไม่ทราบ');
    expect(screen.getByText(/ประวัติการจองที่ไม่ทราบวันจอง รวมยกเลิก 1 รายการ/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /บ้านทั้งหมด.*ดูรายละเอียด/ }));
    const dialog = within(screen.getByRole('dialog', { name: 'รายละเอียดรวมบ้านทั้งหมด' }));
    expect(dialog.getAllByRole('columnheader').map(cell => cell.textContent)).toEqual(['แปลง', 'สถานะ', 'ราคาตั้งต้น']);
    expect(dialog.getAllByText(/2,000,000/)).toHaveLength(2);
  });
  it('connects annual gross sale and column N amounts while retaining net chart counts', () => {
    const data = fixture(), project = data.projects[0], [cancelled, active] = project.map.salePages[0].rows;
    cancelled.bookedAt = '2026-09-01T01:00:00Z'; cancelled.salePrice = 1500000; active.salePrice = 1900000;
    project.evidence.bookingAmounts = [{ saleId: cancelled.saleId, tdPrice: 800000 }, { saleId: active.saleId, tdPrice: 900000 }];
    render(<CentralExcelReportView data={data} surface="dashboard" projectName={null} onProjectChange={vi.fn()} onRefresh={vi.fn()}/>);
    const gross = screen.getByText('ยอดขายทั้งปี 2026 (รวมยกเลิก)').parentElement!;
    expect(gross).toHaveTextContent('3,400,000'); expect(gross).toHaveTextContent('2 รายการจอง');
    expect(screen.getByText('ยอด ท.ด. ปี 2026 (รวมยกเลิก)').parentElement!).toHaveTextContent('1,700,000');
    expect(screen.getByText(/ยอดจองในการ์ดและกราฟยังหักรายการยกเลิก/)).toBeInTheDocument();
    expect(JSON.parse(screen.getAllByTestId('chart')[2].dataset.chartData!)[8].y2026).toBe(1);
    fireEvent.change(screen.getByLabelText('ข้อมูลเหตุการณ์ถึงวันที่'), { target: { value: '2026-09-15' } });
    expect(gross).toHaveTextContent('1,500,000'); expect(gross).toHaveTextContent('1 รายการจอง');
    expect(screen.getByText('ยอด ท.ด. ปี 2026 (รวมยกเลิก)').parentElement!).toHaveTextContent('800,000');
    fireEvent.change(screen.getByLabelText('ข้อมูลเหตุการณ์ถึงวันที่'), { target: { value: '2025-12-31' } });
    expect(screen.getByText('ยอดขายทั้งปี 2025 (รวมยกเลิก)').parentElement!).toHaveTextContent('0 รายการจอง');
  });
});
