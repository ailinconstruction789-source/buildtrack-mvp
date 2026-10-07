import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Mock recharts
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: any) => <div>{children}</div>,
  ComposedChart: ({ children }: any) => <div>{children}</div>,
  CartesianGrid: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  Legend: () => null,
  Area: () => null,
  Line: () => null,
  Bar: () => null,
  LabelList: () => null,
}));

const mockSales = [
  // Plot 1: Waiting plot scheduled for September 2026 (target month)
  {
    saleId: 'sale-sept',
    plotId: 'plot-1',
    plotName: 'แปลง 1',
    projectName: 'โครงการไอลิน 4',
    customerName: 'คุณสมศักดิ์ นัดโอนเดือนนี้',
    ownerName: 'Sales A',
    salePrice: 3000000,
    tdPrice: 3000000,
    stage: 'booked',
    bookedAt: '2026-07-01T00:00:00Z',
    expectedTransferDate: '2026-09-25',
  },
  // Plot 2: Waiting plot overdue from August 2026 (carried over)
  {
    saleId: 'sale-aug',
    plotId: 'plot-2',
    plotName: 'แปลง 2',
    projectName: 'โครงการไอลิน 4',
    customerName: 'คุณสมหญิง ตกค้างเดือนก่อน',
    ownerName: 'Sales B',
    salePrice: 3200000,
    tdPrice: 3200000,
    stage: 'contracted',
    bookedAt: '2026-06-01T00:00:00Z',
    expectedTransferDate: '2026-08-20',
  },
  // Plot 3: Waiting plot with NO expected transfer date set
  {
    saleId: 'sale-nodate',
    plotId: 'plot-3',
    plotName: 'แปลง 3',
    projectName: 'โครงการไอลิน 4',
    customerName: 'คุณวิชัย ยังไม่ระบุวันโอน',
    ownerName: 'Sales C',
    salePrice: 2800000,
    tdPrice: 2800000,
    stage: 'booked',
    bookedAt: '2026-08-15T00:00:00Z',
    expectedTransferDate: null,
  },
  // Plot 4: Waiting plot scheduled for future month November 2026
  {
    saleId: 'sale-future',
    plotId: 'plot-4',
    plotName: 'แปลง 4',
    projectName: 'โครงการไอลิน 4',
    customerName: 'คุณธิดา นัดโอนเดือนหน้า',
    ownerName: 'Sales D',
    salePrice: 3500000,
    tdPrice: 3500000,
    stage: 'booked',
    bookedAt: '2026-08-20T00:00:00Z',
    expectedTransferDate: '2026-11-15',
  },
];

const mockPlots = [
  { id: 'plot-1', plot_name: 'แปลง 1', project_name: 'โครงการไอลิน 4', selling_price: 3000000, land_appraisal_price: 3000000 },
  { id: 'plot-2', plot_name: 'แปลง 2', project_name: 'โครงการไอลิน 4', selling_price: 3200000, land_appraisal_price: 3200000 },
  { id: 'plot-3', plot_name: 'แปลง 3', project_name: 'โครงการไอลิน 4', selling_price: 2800000, land_appraisal_price: 2800000 },
  { id: 'plot-4', plot_name: 'แปลง 4', project_name: 'โครงการไอลิน 4', selling_price: 3500000, land_appraisal_price: 3500000 },
];

const mockProjects = [
  { name: 'โครงการไอลิน 4', is_closed: false },
];

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      select: () => {
        let result: any = Promise.resolve({ data: [], error: null });
        if (table === 'plots') result = Promise.resolve({ data: mockPlots, error: null });
        if (table === 'house_types') result = Promise.resolve({ data: [], error: null });
        if (table === 'projects') result = Promise.resolve({ data: mockProjects, error: null });
        if (table === 'leads') result = Promise.resolve({ data: [], error: null });
        
        result.order = () => Promise.resolve({ data: mockProjects, error: null });
        result.in = () => Promise.resolve({ data: [], error: null });
        result.eq = () => result;
        return result;
      }
    }),
    rpc: (name: string) => {
      if (name === 'crm_v2_project_sales') {
        return Promise.resolve({ data: { rows: mockSales, hasMore: false }, error: null });
      }
      if (name === 'crm_v2_excel_evidence') {
        return Promise.resolve({ data: { legacyVisits: [], completedVisits: [], unassignedLegacyVisits: [] }, error: null });
      }
      if (name === 'crm_v2_excel_booking_amounts') {
        return Promise.resolve({ data: { rows: [] }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    }
  }
}));

import SalesDashboardExcelStyle from '../SalesDashboardExcelStyle';

afterEach(cleanup);

describe('SalesDashboardExcelStyle - Expected Transfer Target Partitioning', () => {
  it('correctly partitions waiting plots into this month, carried over, and unscheduled/future', async () => {
    const { container } = render(<SalesDashboardExcelStyle />);

    // Wait for the dashboard to finish loading
    await screen.findByText(/Monthly Sale Report 2026/);

    // Set date picker to September 2026 (2026-09-30)
    const dateInput = container.querySelector('input[type="date"]') as HTMLInputElement;
    expect(dateInput).not.toBeNull();
    fireEvent.change(dateInput, { target: { value: '2026-09-30' } });

    // Total waiting plots header should show all 4 plots
    expect(screen.getByText('เป้าหมายทั้งหมด 4 แปลง')).toBeInTheDocument();

    // 1. คาดโอนตามเป้าหมายเดือนนี้ (Target Month = September 2026)
    // Should ONLY contain plot-1 (scheduled for 2026-09-25)
    expect(screen.getByText(/คาดโอนตามเป้าหมายเดือนนี้ \(1 แปลง\)/)).toBeInTheDocument();
    expect(screen.getAllByText(/คุณสมศักดิ์ นัดโอนเดือนนี้/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/คาดการณ์: 25 ก\.ย\. 2569/)).toBeInTheDocument();

    // 2. คาดโอนตกค้างจากเดือนก่อน (Carried Over < 2026-09)
    // Should ONLY contain plot-2 (scheduled for 2026-08-20)
    expect(screen.getByText(/คาดโอนตกค้างจากเดือนก่อน \(1 แปลง\)/)).toBeInTheDocument();
    expect(screen.getAllByText(/คุณสมหญิง ตกค้างเดือนก่อน/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/คาดการณ์: 20 ส\.ค\. 2569/)).toBeInTheDocument();

    // 3. รอโอน - ยังไม่ระบุวันโอน / นัดหมายเดือนอื่น
    // Should contain plot-3 (no date) and plot-4 (scheduled for November 2026) -> 2 plots
    expect(screen.getByText(/รอโอน - ยังไม่ระบุวันโอน \/ นัดหมายเดือนอื่น \(2 แปลง\)/)).toBeInTheDocument();
    expect(screen.getAllByText(/คุณวิชัย ยังไม่ระบุวันโอน/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/คุณธิดา นัดโอนเดือนหน้า/).length).toBeGreaterThanOrEqual(1);
  });
});
